/** 泵样板过程检查：整体 / 轴向剖视 / 透明近景 / 内窥各站截图（仅开发验收）。 */
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.INSPECT_BASE ?? 'http://127.0.0.1:5190/';
const OUT = path.resolve('outputs/pump-inspect');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  ...browserOptions, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(BASE + '#/device/pump');
await page.waitForSelector('.canvas-wrap canvas');
await page.waitForFunction(() => window.__chem3d?.device?.id === 'pump');
await wait(1500);

const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), timeout: 90000 });
const tab = async (t) => { await page.evaluate((x) => { [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.includes(x))?.click(); }, t); await wait(900); };
const cam = (pos, target) => page.evaluate(([p, t]) => {
  const s = window.__chem3d.scene;
  s.camera.position.set(...p);
  s.controls.target.set(...t);
  s.controls.update();
}, [pos, target]);

// 1 整体与近景（泵头 + 支座 + 底座）
await shot('01-overall');
await cam([-2.6, 1.7, 2.4], [-0.55, 0.6, 0]);
await wait(300);
await shot('02-head-closeup');
await cam([1.4, 1.5, 2.6], [0.3, 0.6, 0]);
await wait(300);
await shot('03-drive-closeup');

// 2 轴向剖视（默认 Z，前方视角）
await tab('剖视');
await page.evaluate(() => window.__chem3d.scene.setView('front'));
await wait(800);
await shot('04-section-front');
await cam([-1.0, 0.9, 4.2], [-1.0, 0.9, 0]);
await wait(400);
await shot('05-section-front-zoom');

// 3 透明近景：隐藏外壳，观察叶轮/密封/轴承
await tab('透明观察');
await page.evaluate(() => {
  const s = window.__chem3d.scene;
  s.setShellsHidden(true);
  s.setPartHidden('pipeSuction', true);
  s.setPartHidden('pipeElbowIn', true);
});
await cam([-1.6, 1.2, 2.0], [-0.55, 0.78, 0]);
await wait(500);
await shot('06-xray-internals');
await page.evaluate(() => window.__chem3d.scene.resetPartEffects());

// 4 内窥各站
await tab('内窥');
await wait(900);
await shot('07-endo-1-suction-mouth');
const count = await page.evaluate(() => window.__chem3d.scene.getEndoscopeState().count);
for (let i = 1; i < count; i++) {
  await page.evaluate((k) => window.__chem3d.scene.setEndoscopeStop(k), i);
  await wait(900);
  await shot(`08-endo-${i + 1}-stop`);
}
const st = await page.evaluate(() => window.__chem3d.scene.getEndoscopeState());
console.log('endoscope state', JSON.stringify(st, null, 1));
await browser.close();
