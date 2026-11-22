/**
 * 18 台设备基线盘点：桌面（总览/正视/剖视/透明）+ 手机总览截图，
 * 零件数、三角形、绘制调用、几何数据量、rAF 帧率与控制台错误。
 * 输出 outputs/baseline-2026-11-19/；仅用于验收记录，不进入站点构建。
 */
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASELINE_BASE ?? 'http://127.0.0.1:5190/';
const OUT = path.resolve('outputs/baseline-2026-11-19');
fs.mkdirSync(OUT, { recursive: true });

const DEVICES = [
  'pump', 'gear-pump', 'diaphragm-pump', 'screw-compressor',
  'ball-valve', 'gate-valve', 'butterfly-valve', 'check-valve',
  'exchanger', 'plate-exchanger',
  'reactor', 'packed-tower',
  'bag-filter', 'y-strainer', 'gas-separator', 'cyclone-separator',
  'fixed-roof-tank', 'emf-meter'
];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  ...browserOptions,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion']
});

const summary = [];
const t0 = Date.now();

async function newPage(viewport, mobile = false) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => { page.__errs.push('pageerror: ' + e.message); });
  page.on('console', (m) => { if (m.type() === 'error') page.__errs.push('console: ' + m.text()); });
  page.__errs = [];
  return page;
}

async function loadDevice(page, id) {
  await page.goto(BASE + '#/device/' + id, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.canvas-wrap canvas', { timeout: 30000 });
  await page.waitForFunction((devId) => window.__chem3d?.device?.id === devId, id, { timeout: 30000 });
  await page.waitForFunction(() => {
    const l = document.querySelector('.loading-overlay');
    return !l || getComputedStyle(l).display === 'none';
  }, null, { timeout: 30000 });
  await wait(900);
}

async function metrics(page) {
  return page.evaluate(async () => {
    const s = window.__chem3d.scene;
    const dev = window.__chem3d.device;
    let tris = 0, geos = 0, bytes = 0, meshes = 0;
    for (const [, p] of s.parts) {
      p.group.traverse((o) => {
        if (!o.isMesh) return;
        meshes++;
        const g = o.geometry;
        geos++;
        const pos = g.attributes.position;
        if (pos) bytes += pos.count * 3 * 4;
        if (g.index) { tris += g.index.count / 3; bytes += g.index.count * 4; }
        else if (pos) tris += pos.count / 3;
      });
    }
    const info = s.renderer.info;
    const fps = await new Promise((resolve) => {
      let frames = 0;
      const start = performance.now();
      const tick = () => {
        frames++;
        if (performance.now() - start < 1600) requestAnimationFrame(tick);
        else resolve(Math.round((frames * 1000) / (performance.now() - start)));
      };
      requestAnimationFrame(tick);
    });
    return {
      device: dev.id, name: dev.name, category: dev.categoryLabel,
      contentVersion: dev.contentVersion,
      parts: s.parts.size, meshes,
      triangles: Math.round(tris),
      drawnTriangles: info.render.triangles, drawCalls: info.render.calls,
      geometries: info.memory.geometries, geometryMB: +(bytes / 1048576).toFixed(2),
      fps,
      webgl: s.renderer.getContext().getParameter(s.renderer.getContext().RENDERER)
    };
  });
}

async function clickTab(page, label) {
  await page.evaluate((t) => {
    const b = [...document.querySelectorAll('.mode-tab')].find((x) => x.textContent.includes(t));
    if (b) b.click();
  }, label);
  await wait(650);
}

// ---------- 桌面 ----------
const desktop = await newPage({ width: 1440, height: 900 });
for (const id of DEVICES) {
  const dir = path.join(OUT, id);
  fs.mkdirSync(dir, { recursive: true });
  const row = { id, desktop: null, mobile: null, errors: [] };
  try {
    await loadDevice(desktop, id);
    const m = await metrics(desktop);
    row.desktop = m;
    await desktop.screenshot({ path: path.join(dir, 'd1-overall.png'), timeout: 60000 });
    await desktop.evaluate(() => window.__chem3d.scene.setView('front'));
    await wait(750);
    await desktop.screenshot({ path: path.join(dir, 'd2-front.png'), timeout: 60000 });
    await clickTab(desktop, '剖视');
    await desktop.screenshot({ path: path.join(dir, 'd3-section.png'), timeout: 60000 });
    await clickTab(desktop, '透明观察');
    await desktop.screenshot({ path: path.join(dir, 'd4-xray.png'), timeout: 60000 });
    row.errors = desktop.__errs.filter((e) => !e.includes('favicon'));
    desktop.__errs = [];
  } catch (err) {
    row.desktop = { error: String(err && err.message || err) };
    row.errors = desktop.__errs.slice();
    desktop.__errs = [];
  }
  summary.push(row);
  console.log(`${row.desktop && !row.desktop.error ? 'OK ' : 'ERR'} desktop ${id}  parts=${row.desktop?.parts ?? '?'} tris=${row.desktop?.triangles ?? '?'} fps=${row.desktop?.fps ?? '?'}`);
}
await desktop.close();

// ---------- 手机 ----------
const mobile = await newPage({ width: 390, height: 844 }, true);
for (const id of DEVICES) {
  const dir = path.join(OUT, id);
  const row = summary.find((r) => r.id === id);
  try {
    await loadDevice(mobile, id);
    row.mobile = await metrics(mobile);
    await mobile.screenshot({ path: path.join(dir, 'm1-overall.png'), timeout: 60000 });
    row.errors.push(...mobile.__errs.filter((e) => !e.includes('favicon')).map((e) => 'mobile ' + e));
    mobile.__errs = [];
  } catch (err) {
    row.mobile = { error: String(err && err.message || err) };
  }
  console.log(`${row.mobile && !row.mobile.error ? 'OK ' : 'ERR'} mobile  ${id}  fps=${row.mobile?.fps ?? '?'}`);
}
await mobile.close();
await browser.close();

fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ base: BASE, capturedAt: new Date().toISOString(), devices: summary }, null, 2));
console.log(`\nBaseline done in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${OUT}`);
