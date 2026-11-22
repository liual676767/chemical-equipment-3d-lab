/**
 * 第四阶段性能验收：入口耗时（冷启动/缓存命中各 3 次）、转动/点选/动画帧时间与渲染统计、
 * 桌面与手机模拟视口的抽屉/高亮/按钮可达性。
 * 运行：DEVICES=pump,gear-pump,exchanger node scripts/acceptance/perf-acceptance.mjs
 * 环境：PERF_SET=before|after（仅用于输出目录命名）
 */
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.VERIFY_BASE ?? 'http://127.0.0.1:5173/';
const SET = process.env.PERF_SET ?? 'current';
const DEVICES = (process.env.DEVICES ?? 'pump,gear-pump,exchanger').split(',').map((s) => s.trim()).filter(Boolean);
const OUT = path.resolve('outputs/perf', SET);
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SELECT_PART = { pump: 'impeller', 'gear-pump': 'casing', exchanger: 'tubes' };
const results = [];
const errors = [];
const log = (...a) => console.log(...a);

const browser = await chromium.launch({
  ...browserOptions, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion']
});

async function newContext(viewport, cacheDisabled, mobile = false) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  if (cacheDisabled) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  }
  return { ctx, page };
}

async function measureEntry(page, id) {
  const t0 = Date.now();
  await page.goto(`${BASE}#/device/${id}`, { timeout: 90000, waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.canvas-wrap canvas');
  await page.waitForFunction((x) => window.__chem3d?.device?.id === x && document.querySelector('.loading-overlay')?.style.display === 'none', id, { timeout: 90000 });
  return Date.now() - t0;
}
async function measureReload(page, id) {
  const t0 = Date.now();
  await page.reload({ timeout: 90000, waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.canvas-wrap canvas');
  await page.waitForFunction((x) => window.__chem3d?.device?.id === x && document.querySelector('.loading-overlay')?.style.display === 'none', id, { timeout: 90000 });
  return Date.now() - t0;
}

async function startSampler(page) {
  await page.evaluate(() => {
    window.__perfTimes = [];
    let last = performance.now();
    const step = (now) => {
      window.__perfTimes.push(now - last);
      last = now;
      window.__perfRaf = requestAnimationFrame(step);
    };
    window.__perfRaf = requestAnimationFrame(step);
  });
}
async function stopSampler(page) {
  const times = await page.evaluate(() => {
    cancelAnimationFrame(window.__perfRaf);
    return window.__perfTimes;
  });
  const filtered = times.filter((t) => t > 0 && t < 5000);
  if (!filtered.length) return { frames: 0, mean: 0, median: 0, p95: 0, min: 0, max: 0 };
  const sum = filtered.reduce((a, b) => a + b, 0);
  const sorted = [...filtered].sort((a, b) => a - b);
  return {
    frames: filtered.length,
    mean: +(sum / filtered.length).toFixed(1),
    median: +sorted[Math.floor(sorted.length / 2)].toFixed(1),
    p95: +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))].toFixed(1),
    min: +sorted[0].toFixed(1),
    max: +sorted[sorted.length - 1].toFixed(1)
  };
}
const renderInfo = (page) => page.evaluate(() => ({
  calls: window.__chem3d.scene.renderer.info.render.calls,
  triangles: window.__chem3d.scene.renderer.info.render.triangles,
  geometries: window.__chem3d.scene.renderer.info.memory.geometries,
  textures: window.__chem3d.scene.renderer.info.memory.textures
}));
const glInfo = (page) => page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return {
    vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : 'unknown',
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'
  };
});
async function openPerf(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  return cdp;
}
async function cdpMetrics(cdp) {
  const m = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(m.metrics.map((x) => [x.name, x.value]));
}
function diffMetrics(a, b) {
  return {
    taskMs: +(((b.TaskDuration ?? 0) - (a.TaskDuration ?? 0)) * 1000).toFixed(1),
    scriptMs: +(((b.ScriptDuration ?? 0) - (a.ScriptDuration ?? 0)) * 1000).toFixed(1),
    layoutMs: +(((b.LayoutDuration ?? 0) - (a.LayoutDuration ?? 0)) * 1000).toFixed(1),
    styleMs: +(((b.RecalcStyleDuration ?? 0) - (a.RecalcStyleDuration ?? 0)) * 1000).toFixed(1),
    heapDeltaMB: +(((b.JSHeapUsedSize ?? 0) - (a.JSHeapUsedSize ?? 0)) / 1048576).toFixed(2)
  };
}

/* ---------- 桌面：冷启动 / 缓存命中 / 各状态 ---------- */
for (const id of DEVICES) {
  const cold = [];
  for (let i = 0; i < 3; i++) {
    const { ctx, page } = await newContext({ width: 1440, height: 900 }, true);
    cold.push(await measureEntry(page, id));
    await ctx.close();
  }
  const { ctx, page } = await newContext({ width: 1440, height: 900 }, false);
  await measureEntry(page, id); // warm-up
  const warm = [];
  for (let i = 0; i < 3; i++) {
    warm.push(await measureReload(page, id));
  }
  await page.waitForSelector('.canvas-wrap canvas');
  await page.waitForFunction((x) => window.__chem3d?.device?.id === x, id);
  await wait(800);
  await page.evaluate(() => {
    const s = window.__chem3d.scene;
    s.setQuality('high');
    s.setLabels(false);
    s.fitView();
  });
  await wait(700);
  const gl = await glInfo(page);
  const perfCdp = await openPerf(page);
  const states = {};
  // idle
  let m0 = await cdpMetrics(perfCdp);
  await startSampler(page); await wait(2500);
  states.idle = { ...(await stopSampler(page)), ...(await renderInfo(page)), ...diffMetrics(m0, await cdpMetrics(perfCdp)) };
  // rotate
  const box = await page.locator('.canvas-wrap canvas').boundingBox();
  m0 = await cdpMetrics(perfCdp);
  await startSampler(page);
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.30, box.y + box.height * 0.42, { steps: 18 });
  await page.mouse.up();
  await wait(2000);
  states.rotate = { ...(await stopSampler(page)), ...(await renderInfo(page)), ...diffMetrics(m0, await cdpMetrics(perfCdp)) };
  // select + focus
  await page.evaluate((pid) => { const s = window.__chem3d.scene; if (pid) { s.select(pid); s.focusPart(pid); } }, SELECT_PART[id]);
  await wait(900);
  m0 = await cdpMetrics(perfCdp);
  await startSampler(page); await wait(2000);
  states.select = { ...(await stopSampler(page)), ...(await renderInfo(page)), ...diffMetrics(m0, await cdpMetrics(perfCdp)) };
  await page.screenshot({ path: path.join(OUT, `${id}-desktop-select.png`) });
  // principle animation
  await page.evaluate(() => { [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.includes('工作原理'))?.click(); });
  await wait(1000);
  m0 = await cdpMetrics(perfCdp);
  await startSampler(page); await wait(2500);
  states.animate = { ...(await stopSampler(page)), ...(await renderInfo(page)), ...diffMetrics(m0, await cdpMetrics(perfCdp)) };
  await page.screenshot({ path: path.join(OUT, `${id}-desktop-animate.png`) });
  const entry = { cold, warm };
  results.push({ id, viewport: 'desktop', entry, gl, states });
  log(`[desktop] ${id}: cold ${cold.join('/')} ms · warm ${warm.join('/')} ms · idle ${states.idle.mean} ms/frame · calls ${states.idle.calls} · tris ${states.idle.triangles}`);
  await ctx.close();
}

/* ---------- 手机模拟视口：入口、抽屉、高亮、按钮可达性 ---------- */
for (const id of DEVICES) {
  const { ctx, page } = await newContext({ width: 390, height: 844 }, false, true);
  const entry = await measureEntry(page, id);
  await page.waitForFunction((x) => window.__chem3d?.device?.id === x, id);
  await wait(1200);
  const gl = await glInfo(page);
  // 打开零件抽屉并选择零件
  await page.locator('.mobile-panel-btn[data-action="parts"]').click();
  await wait(400);
  const drawerOpen = await page.evaluate(() => document.querySelector('.left-panel')?.classList.contains('drawer-open'));
  const partName = id === 'pump' ? '叶轮' : id === 'gear-pump' ? '泵体' : '管束';
  await page.locator('.tree-item').filter({ hasText: partName }).first().click();
  await wait(700);
  const selected = await page.evaluate((pid) => {
    const s = window.__chem3d.scene;
    return { selected: s.selected, emissive: pid ? s.parts.get(pid)?.materials.some((m) => m.emissive.getHex() !== 0) : false };
  }, SELECT_PART[id]);
  const leftStillOpen = await page.evaluate(() => document.querySelector('.left-panel')?.classList.contains('drawer-open'));
  if (leftStillOpen) {
    await page.locator('.left-panel .panel-collapse').click();
    await wait(400);
  }
  const camBefore = await page.evaluate(() => window.__chem3d.scene.camera.position.toArray().map((n) => +n.toFixed(3)));
  const box = await page.locator('.canvas-wrap canvas').boundingBox();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.4, { steps: 12 });
  await page.mouse.up();
  await wait(700);
  const camAfter = await page.evaluate(() => window.__chem3d.scene.camera.position.toArray().map((n) => +n.toFixed(3)));
  const rotated = camBefore.some((v, i) => Math.abs(v - camAfter[i]) > 0.01);
  await page.locator('.mobile-panel-btn[data-action="info"]').click();
  await wait(400);
  const infoOpen = await page.evaluate(() => document.querySelector('.right-panel')?.classList.contains('drawer-open'));
  // 按钮可达性：模式页签与底部按钮在视口内
  const reach = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.mode-tab, .wb-bottom button, .mobile-panel-btn')];
    const scrollable = (el) => {
      let p = el.parentElement;
      while (p) {
        const s = getComputedStyle(p);
        if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && p.scrollWidth > p.clientWidth) return true;
        p = p.parentElement;
      }
      return false;
    };
    return items.map((el) => {
      const r = el.getBoundingClientRect();
      return { text: (el.textContent ?? '').trim().slice(0, 12), inside: r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1, scrollable: scrollable(el), w: Math.round(r.width), h: Math.round(r.height) };
    });
  });
  await page.evaluate(() => { const el = document.querySelector('.mode-tabs'); if (el) el.scrollLeft = el.scrollWidth; });
  await wait(250);
  const lastTabReachable = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.mode-tab')].pop();
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1;
  });
  const unreachable = reach.filter((x) => !x.inside && !x.scrollable);
  await page.screenshot({ path: path.join(OUT, `${id}-mobile.png`) });
  results.push({
    id, viewport: 'mobile', entry, gl,
    drawer: { open: drawerOpen, infoOpen, selected, rotated, camBefore, camAfter },
    buttons: { total: reach.length, unreachable, lastTabReachable }
  });
  log(`[mobile] ${id}: entry ${entry} ms · drawer ${drawerOpen} · select ${selected.selected}/${selected.emissive} · rotate ${rotated} · unreachable ${unreachable.length}`);
  await ctx.close();
}

await browser.close();
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ set: SET, devices: results, errors }, null, 2));
if (errors.length) {
  console.error('控制台错误：', errors);
  process.exit(1);
}
console.log(`\n报告：${path.join(OUT, 'report.json')}`);
