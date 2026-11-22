/**
 * 设备结构前后对照截图：固定相机、固定画质、固定剖面。
 * 运行：SHOT_SET=before node scripts/acceptance/device-compare.mjs
 *       SHOT_SET=after  node scripts/acceptance/device-compare.mjs
 * 设备可用 DEVICES=gear-pump,diaphragm-pump,screw-compressor 覆盖。
 */
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.VERIFY_BASE ?? 'http://127.0.0.1:5173/';
const SET = process.env.SHOT_SET ?? 'before';
const OUT = path.resolve('outputs/round13-compare', SET);
fs.mkdirSync(OUT, { recursive: true });

const SHOTS = {
  'gear-pump': [
    { name: 'overall', mode: 'observe', cam: [2.6, 1.9, 2.8], target: [0, 0.72, 0] },
    { name: 'section', mode: 'section', axis: 'x', t: 0.32, flip: true, cam: [2.9, 0.72, 0.001], target: [0, 0.72, 0] },
    { name: 'inlet', mode: 'observe', cam: [0.8, 1.05, 1.7], target: [0, 0.72, 0.2] },
    { name: 'outlet', mode: 'observe', cam: [-0.8, 1.05, -1.7], target: [0, 0.72, -0.2] }
  ],
  'diaphragm-pump': [
    { name: 'overall', mode: 'observe', cam: [2.9, 1.95, 2.7], target: [0, 0.72, 0] },
    { name: 'section', mode: 'section', axis: 'z', t: 0.5, flip: true, cam: [0, 0.95, 2.9], target: [0, 0.72, 0] },
    { name: 'inlet', mode: 'observe', cam: [-1.35, 0.75, 1.8], target: [-0.46, 0.4, 0] },
    { name: 'outlet', mode: 'observe', cam: [1.35, 1.2, 1.8], target: [0.46, 1.05, 0] }
  ],
  'screw-compressor': [
    { name: 'overall', mode: 'observe', cam: [2.7, 1.85, 2.7], target: [0, 0.7, 0] },
    { name: 'section', mode: 'section', axis: 'z', t: 0.5, flip: true, cam: [0, 1.05, 2.9], target: [0, 0.68, 0] },
    { name: 'inlet', mode: 'observe', cam: [0.75, 1.65, 1.65], target: [-0.35, 1.05, 0] },
    { name: 'outlet', mode: 'observe', cam: [0.95, 0.75, 1.7], target: [0.35, 0.38, 0] }
  ]
};

const requested = (process.env.DEVICES ?? Object.keys(SHOTS).join(',')).split(',').map((s) => s.trim()).filter(Boolean);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  ...browserOptions, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const report = { set: SET, devices: {}, errors };
for (const id of requested) {
  const shots = SHOTS[id];
  if (!shots) continue;
  await page.goto(`${BASE}#/device/${id}`, { timeout: 90000, waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.canvas-wrap canvas');
  await page.waitForFunction((x) => window.__chem3d?.device?.id === x, id);
  await wait(1500);
  await page.addStyleTag({ content: '.canvas-toolbar,.canvas-mode-chip,.endo-hud,.mobile-panel-btns,.toast-stack,.loading-overlay,.reopen-strip{display:none!important}' });
  const info = [];
  for (const s of shots) {
    await page.evaluate((shot) => {
      const scene = window.__chem3d.scene;
      scene.setQuality('high');
      scene.setLabels(false);
      if (shot.mode === 'section') {
        scene.setMode('section');
        scene.setSection(shot.axis, shot.t, shot.flip);
      } else {
        scene.setMode('observe');
      }
      scene.camera.position.set(shot.cam[0], shot.cam[1], shot.cam[2]);
      scene.controls.target.set(shot.target[0], shot.target[1], shot.target[2]);
      scene.controls.update();
    }, s);
    await wait(900);
    const file = path.join(OUT, `${id}--${s.name}.png`);
    await page.locator('.canvas-wrap').screenshot({ path: file });
    const stats = await page.evaluate(() => ({
      calls: window.__chem3d.scene.renderer.info.render.calls,
      triangles: window.__chem3d.scene.renderer.info.render.triangles,
      selected: window.__chem3d.scene.selected,
      mode: window.__chem3d.scene.mode
    }));
    info.push({ shot: s.name, file: path.relative(process.cwd(), file), ...stats });
    console.log(`${id} ${s.name}: ${stats.calls} calls / ${stats.triangles} tris -> ${file}`);
  }
  report.devices[id] = info;
}

await browser.close();
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
if (errors.length) {
  console.error('控制台错误：', errors);
  process.exit(1);
}
