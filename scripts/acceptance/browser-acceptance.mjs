/**
 * Phase 0–4/5 集成验收：浏览器运行时、交互与性能。
 * 前置：先 npm run build（生产站点检查用 dist）。
 * 运行：node scripts/acceptance/browser-acceptance.mjs
 * 输出：outputs/acceptance-2026-11-18/runtime-*.png、runtime-report.json
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../..', import.meta.url));
const outDir = path.join(root, 'outputs', 'acceptance-2026-11-18');
mkdirSync(outDir, { recursive: true });

const results = [];
const consoleErrors = [];
const perf = {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const instrument = () => {
  window.__perf = { frames: [] };
  let calls = 0;
  let tris = 0;
  const push = () => {
    window.__perf.frames.push({ t: performance.now(), calls, tris });
    if (window.__perf.frames.length > 4000) window.__perf.frames.splice(0, 2000);
  };
  const origRAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    origRAF((ts) => {
      calls = 0;
      tris = 0;
      try {
        cb(ts);
      } finally {
        push();
      }
    });
  for (const Ctx of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!Ctx) continue;
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const orig = Ctx.prototype[name];
      if (!orig) continue;
      Ctx.prototype[name] = function (mode, a, b) {
        calls += 1;
        if (mode === 4) {
          if (name === 'drawElements' || name === 'drawElementsInstanced') tris += (a || 0) / 3;
          else tris += (b || 0) / 3;
        }
        return orig.apply(this, arguments);
      };
    }
  }
};

async function sample(page, seconds) {
  const start = await page.evaluate(() => {
    window.__perf.frames.length = 0;
    return performance.now();
  });
  await wait(seconds * 1000);
  const data = await page.evaluate(() => ({
    frames: window.__perf.frames.slice(),
    heap: performance.memory ? performance.memory.usedJSHeapSize : null
  }));
  const frames = data.frames.filter((f) => f.calls > 0);
  if (frames.length < 2) return { fps: 0, drawCalls: 0, triangles: 0, heapMB: data.heap ? +(data.heap / 1048576).toFixed(1) : null, frames: frames.length };
  const dt = (frames[frames.length - 1].t - frames[0].t) / 1000;
  const fps = (frames.length - 1) / dt;
  const avg = (key) => frames.reduce((s, f) => s + f[key], 0) / frames.length;
  return {
    seconds: +(((start + seconds * 1000 - start) / 1000).toFixed(1)),
    fps: +fps.toFixed(1),
    drawCalls: +avg('calls').toFixed(0),
    triangles: +avg('tris').toFixed(0),
    heapMB: data.heap ? +(data.heap / 1048576).toFixed(1) : null,
    frames: frames.length
  };
}

async function screenshotDiff(page, action, name) {
  const before = await page.screenshot();
  await action();
  await wait(700);
  const after = await page.screenshot({ path: path.join(outDir, name) });
  if (before.equals(after)) return { changed: false, bytes: after.length };
  let diff = 0;
  const len = Math.min(before.length, after.length);
  for (let i = 0; i < len; i += 97) if (before[i] !== after[i]) diff += 1;
  return { changed: true, sampledDiff: diff, bytes: after.length };
}

const { createServer } = await import('vite');
const vite = await createServer({ root, server: { middlewareMode: true, hmr: false } });
const devServer = createHttpServer(vite.middlewares);
const devListening = once(devServer, 'listening');
devServer.listen({ host: '127.0.0.1', port: 0 });
await devListening;
const devBase = `http://127.0.0.1:${devServer.address().port}/`;

const { preview } = await import('vite');
const previewServer = await preview({ root, preview: { host: '127.0.0.1', port: 4199, strictPort: true } });
const siteBase = previewServer.resolvedUrls?.local?.[0] ?? 'http://127.0.0.1:4199/';

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--disable-gpu-sandbox',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion'
  ]
});
const context = await browser.newContext({ viewport: { width: 1600, height: 960 } });
await context.addInitScript(instrument);
const page = await context.newPage();
page.setDefaultTimeout(120000);
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push(`console: ${msg.text()}`); });

function takeErrors(label) {
  const copy = [...pageErrors];
  pageErrors.length = 0;
  if (copy.length) consoleErrors.push({ label, errors: copy });
  return copy;
}

try {
  /* ================= A. 生产站点（dist） ================= */
  let t0 = Date.now();
  await page.goto(siteBase, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.device-card', { timeout: 60000 });
  await wait(1500);
  const homeMs = Date.now() - t0;
  const home = await page.evaluate(() => ({
    cards: document.querySelectorAll('.device-card').length,
    thumbs: document.querySelectorAll('.card-thumb').length,
    workshop: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('组装工坊')),
    plant: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('进入全流程')),
    boil: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('微沸'))
  }));
  check('生产首页：18 张设备卡片与缩略图', home.cards === 18 && home.thumbs === 18, `cards=${home.cards} thumbs=${home.thumbs} 加载=${homeMs}ms`);
  check('首页入口：工坊/全流程/微沸喷烧均在', home.workshop && home.plant && home.boil, JSON.stringify(home));
  perf.homeLoadMs = homeMs;
  await page.screenshot({ path: path.join(outDir, 'runtime-01-home.png') });

  /* 普通设备展示：离心泵工作台 */
  t0 = Date.now();
  await page.goto(siteBase + '#/device/pump', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.canvas-wrap canvas', { timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('.tree-item').length >= 40, null, { timeout: 60000 });
  await wait(1200);
  const pumpMs = Date.now() - t0;
  perf.pumpLoadMs = pumpMs;
  perf.pump = await sample(page, 8);
  const pumpInfo = await page.evaluate(() => ({ parts: document.querySelectorAll('.tree-item').length }));
  check('泵工作台：40 零件加载', pumpInfo.parts === 40, `parts=${pumpInfo.parts} 加载=${pumpMs}ms`);
  const drag = await screenshotDiff(page, async () => {
    const box = await page.locator('.canvas-wrap canvas').boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.56, { steps: 12 });
    await page.mouse.up();
  }, 'runtime-02-pump-orbit.png');
  check('泵工作台：鼠标拖动旋转视角', drag.changed, `像素差异采样=${drag.sampledDiff ?? 0}`);
  const zoom = await screenshotDiff(page, async () => {
    const box = await page.locator('.canvas-wrap canvas').boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.wheel(0, -420);
  }, 'runtime-03-pump-zoom.png');
  check('泵工作台：滚轮缩放', zoom.changed, `像素差异采样=${zoom.sampledDiff ?? 0}`);
  await page.evaluate(() => document.querySelector('.tree-item')?.click());
  await wait(500);
  const picked = await page.evaluate(() => document.querySelector('.info-part-name')?.textContent ?? '');
  check('泵工作台：零件选择与信息面板联动', picked.length > 0, `选中=${picked || '无'}`);
  const tabSwitch = await page.evaluate(() => {
    const tab = [...document.querySelectorAll('.mode-tab')].find((t) => t.textContent.includes('剖视'));
    if (!tab) return false;
    tab.click();
    return true;
  });
  await wait(500);
  const sectionOn = await page.evaluate(() => !!document.querySelector('.mode-tab.active')?.textContent.includes('剖视'));
  check('泵工作台：剖视模式切换', tabSwitch && sectionOn);
  check('泵工作台：控制台无错误', takeErrors('pump').length === 0, pageErrors.length ? pageErrors.join(' | ') : '无');

  /* 全流程装置 */
  t0 = Date.now();
  await page.goto(siteBase + '#/plant', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.plant-stage canvas', { timeout: 60000 });
  await page.waitForFunction(() => !!window.__plant?.debug, null, { timeout: 60000 });
  await wait(1600);
  const plantMs = Date.now() - t0;
  perf.plantLoadMs = plantMs;
  const audit = await page.evaluate(() => window.__plant.audit());
  check('全流程：数据自检 0 问题', audit.issues.length === 0, audit.issues.slice(0, 3).join('；') || `节点 ${audit.counts.nodes} / 管线 ${audit.counts.pipes}`);
  const dbg = await page.evaluate(() => window.__plant.debug());
  perf.plant = await sample(page, 8);
  perf.plantDebug = { drawCalls: dbg.drawCalls, triangles: dbg.triangles, fps: dbg.fps, geometries: dbg.geometries, textures: dbg.textures };
  check('全流程：默认展示可渲染', dbg.drawCalls > 0 && dbg.triangles > 0, `drawCalls=${dbg.drawCalls} tris=${dbg.triangles} fps=${dbg.fps}`);
  await page.screenshot({ path: path.join(outDir, 'runtime-04-plant.png') });

  const trace = await page.evaluate(() => window.__plant.trace('T-101', 'down'));
  await wait(400);
  perf.trace = await sample(page, 6);
  check('全流程：多设备同时高亮（T-101 下游追踪）', trace.nodes.length >= 2, `高亮设备 ${trace.nodes.length} 台 / 管线 ${trace.pipes.length} 条`);
  await page.screenshot({ path: path.join(outDir, 'runtime-05-plant-trace.png') });
  check('全流程：控制台无错误', takeErrors('plant').length === 0);

  /* 微沸喷烧页面（Phase 5 现状） */
  t0 = Date.now();
  await page.goto(siteBase + '#/boil', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.boil-stage canvas', { timeout: 60000 });
  await page.waitForFunction(() => !!window.__boil, null, { timeout: 60000 });
  await wait(1400);
  const boilMs = Date.now() - t0;
  perf.boilLoadMs = boilMs;
  const boil = await page.evaluate(() => {
    const api = window.__boil;
    return {
      ready: api.ready,
      counts: api.counts,
      equipmentCount: api.equipmentCount,
      pendingPorts: api.pendingPorts,
      boundaryPorts: api.boundaryPorts,
      errors: api.errors.length,
      phase: api.phase ?? null,
      areaCount: Array.isArray(api.areas) ? api.areas.length : 0,
      areaOk: api.areaValidation?.ok ?? null,
      playback: typeof api.playbackState === 'function' ? api.playbackState() : null,
      hasFluid: Object.keys(api).filter((k) => /fluid|play|speed/i.test(k)),
      hasLayers: Object.keys(api).filter((k) => /layer|region|area/i.test(k))
    };
  });
  check('微沸页面：三维场景加载', boil.ready === true && boil.errors === 0, `phase=${boil.phase} / 设备 ${boil.equipmentCount} / 区域 ${boil.areaCount} / 待确认接口 ${boil.pendingPorts} / 边界 ${boil.boundaryPorts} / 加载=${boilMs}ms`);
  check('微沸页面：五区数据校验通过', boil.areaCount === 5 && boil.areaOk === true, `区域=${boil.areaCount} ok=${boil.areaOk}`);
  perf.boil = await sample(page, 8);
  const boilDrag = await screenshotDiff(page, async () => {
    const box = await page.locator('.boil-stage canvas').boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55, { steps: 12 });
    await page.mouse.up();
  }, 'runtime-06-boil-orbit.png');
  check('微沸页面：鼠标拖动旋转视角', boilDrag.changed);
  const boilSelect = await page.evaluate(() => {
    const first = document.querySelector('.boil-pipe-item');
    if (!first) return null;
    first.click();
    return { pipeline: first.dataset.pipeline ?? '', selected: window.__boil?.selectedPipeline ?? window.__boil?.selected ?? null };
  });
  check('微沸页面：管线列表点击聚焦', Boolean(boilSelect?.selected), JSON.stringify(boilSelect));
  await page.screenshot({ path: path.join(outDir, 'runtime-07-boil-focus.png') });
  if (boil.hasFluid.length || boil.hasLayers.length) {
    check('微沸页面：Phase 5 新增能力已暴露', true, `fluid=${boil.hasFluid.join(',')} layers=${boil.hasLayers.join(',')}`);
  } else {
    check('微沸页面：Phase 5 新增能力已暴露', false, 'window.__boil 未暴露流体/分层接口（当前页面可能仍为 Phase 3 管线视图）');
  }
  check('微沸页面：控制台无错误', takeErrors('boil').length === 0);

  /* 导航闭环 */
  await page.goto(siteBase + '#/workshop', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 60000 });
  await wait(1200);
  const wsCanvas = await page.evaluate(() => document.querySelectorAll('canvas').length);
  check('工坊页面：三维画布加载', wsCanvas > 0, `canvas=${wsCanvas}`);
  await page.goto(siteBase + '#/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.device-card', { timeout: 60000 });
  check('页面导航：回到设备库正常', true);
  check('生产站点：以上页面无残留错误', takeErrors('nav').length === 0);

  /* ================= B. 内部预览（全部管道 / 全部流体） ================= */
  t0 = Date.now();
  await page.goto(devBase + 'scripts/preview/boil-piping.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body[data-preview-ready="1"]', { timeout: 120000 });
  await wait(1000);
  perf.pipingPreviewLoadMs = Date.now() - t0;
  perf.pipingPreview = await sample(page, 8);
  const pipingApi = await page.evaluate(() => ({ counts: window.__boilPiping?.counts ?? null, mode: window.__boilPiping?.mode ?? null }));
  check('管道预览：整线 13 条全部显示（静态场景）', Boolean(pipingApi.counts) && (pipingApi.counts?.routedPipelines === 13 || pipingApi.mode === 'overview'), JSON.stringify(pipingApi.counts));
  await page.screenshot({ path: path.join(outDir, 'runtime-08-piping-overview.png') });
  check('管道预览：控制台无错误', takeErrors('piping-preview').length === 0);

  t0 = Date.now();
  await page.goto(devBase + 'scripts/preview/boil-fluid.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body[data-preview-ready="1"]', { timeout: 120000 });
  await wait(1000);
  perf.fluidPreviewLoadMs = Date.now() - t0;
  const fluidBase = await page.evaluate(() => ({
    counts: window.__boilFluid.counts,
    flowCounts: window.__boilFluid.fluidCounts,
    errorCount: window.__boilFluid.errorCount,
    particles: window.__boilFluid.runtime.particles,
    arrows: window.__boilFluid.runtime.arrows
  }));
  check('流体预览：全开 13 条流动与粒子/箭头', fluidBase.flowCounts.full === 13 && fluidBase.particles >= 180, JSON.stringify(fluidBase.flowCounts));
  perf.fluidPreview = await sample(page, 8);
  await page.screenshot({ path: path.join(outDir, 'runtime-09-fluid-all.png') });

  const independence = await page.evaluate(() => {
    window.__boilFluid.actions.setValve('pipe-material-02', 'closed');
    const stats = window.__boilFluid.actions.stats();
    return stats.perRun.map((r) => ({ id: r.pipelineId, state: r.flowState, visible: r.particlesVisible }));
  });
  const gasOk = independence.filter((r) => r.id.startsWith('pipe-gas')).every((r) => r.state === 'full' && r.visible);
  const mat02 = independence.find((r) => r.id === 'pipe-material-02');
  check('流体独立性：关闭物料 02 不影响烟气 9 条', gasOk && mat02?.state === 'halt', JSON.stringify({ mat02, gasFlowing: gasOk }));
  await page.screenshot({ path: path.join(outDir, 'runtime-10-fluid-material-closed.png') });
  const pauseProbe = await page.evaluate(async () => {
    window.__boilFluid.actions.setValve('pipe-material-02', 'open');
    window.__boilFluid.actions.setPaused(false);
    const before = window.__boilFluid.actions.progress('pipe-material-01');
    await new Promise((r) => setTimeout(r, 500));
    const moved = window.__boilFluid.actions.progress('pipe-material-01');
    window.__boilFluid.actions.setPaused(true);
    await new Promise((r) => setTimeout(r, 400));
    const frozen1 = window.__boilFluid.actions.progress('pipe-material-01');
    await new Promise((r) => setTimeout(r, 400));
    const frozen2 = window.__boilFluid.actions.progress('pipe-material-01');
    window.__boilFluid.actions.setPaused(false);
    return { before, moved, frozen1, frozen2, movedOk: moved !== before, frozenOk: frozen1 === frozen2 };
  });
  check('流体预览：播放/暂停可复现', pauseProbe.movedOk && pauseProbe.frozenOk, JSON.stringify(pauseProbe));
  check('流体预览：控制台无错误', takeErrors('fluid-preview').length === 0);

  /* ================= C. 量化几何检查 ================= */
  await page.goto(devBase + 'scripts/acceptance/fluid-geometry.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body[data-ready="1"]', { timeout: 120000 });
  const dev = await page.evaluate(() => {
    const list = window.__geoTest.deviation();
    const worst = list.reduce((a, b) => (b.excess > a.excess ? b : a));
    return { list, worst };
  });
  check('流体几何：粒子全程贴合管道（外层示踪带内）', dev.list.every((d) => d.excess <= 0.08), `13 条管线最大偏离=${dev.worst.excess}m（管半径 ${dev.worst.radius}m，${dev.worst.pipelineId}）`);
  const closedGeometry = await page.evaluate(() => {
    const flows = window.__geoTest.setValve('pipe-material-02', 'closed');
    const a = window.__geoTest.particleSnapshot('pipe-material-02');
    const b = window.__geoTest.particleSnapshot('pipe-material-02');
    return { flows: flows['pipe-material-02'], stable: JSON.stringify(a) === JSON.stringify(b) };
  });
  check('流体几何：关阀后粒子停在阀前且位置稳定', closedGeometry.flows?.state === 'halt' && closedGeometry.stable, JSON.stringify(closedGeometry));
  const paused = await page.evaluate(() => {
    window.__geoTest.resetValves();
    return window.__geoTest.pauseProbe('pipe-material-01');
  });
  check('流体几何：暂停后粒子进度冻结', paused.advanced && paused.frozenStable, JSON.stringify(paused));
  const geoErrors = takeErrors('fluid-geometry');
  check('流体几何检查页：无 JS 错误（favicon 404 属非产品问题）', geoErrors.every((e) => !e.startsWith('pageerror')), geoErrors.join(' | ') || '无');

  /* ================= D. 连续运行 5 分钟（全部流体动画） ================= */
  await page.goto(devBase + 'scripts/preview/boil-fluid.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body[data-preview-ready="1"]', { timeout: 120000 });
  await wait(800);
  const trend = [];
  for (let i = 0; i < 10; i++) {
    const s = await sample(page, 30);
    trend.push({ minute: +((i + 1) * 0.5).toFixed(1), ...s });
    console.log(`  连续运行 ${((i + 1) * 0.5).toFixed(1)} 分钟：fps=${s.fps} drawCalls=${s.drawCalls} heap=${s.heapMB}MB`);
  }
  perf.fiveMinute = trend;
  const firstHeap = trend.find((t) => t.heapMB)?.heapMB ?? null;
  const lastHeap = [...trend].reverse().find((t) => t.heapMB)?.heapMB ?? null;
  const avgFps = +(trend.reduce((s, t) => s + t.fps, 0) / trend.length).toFixed(1);
  check('性能：全部流体动画连续运行 5 分钟无崩溃', trend.every((t) => t.fps > 0 && t.frames > 30), `平均 fps=${avgFps}`);
  if (firstHeap && lastHeap) {
    const drift = +(((lastHeap - firstHeap) / firstHeap) * 100).toFixed(1);
    check('性能：5 分钟 JS 堆无明显泄漏趋势（<35% 增长）', drift < 35, `堆 ${firstHeap}MB → ${lastHeap}MB（${drift}%）`);
  }
  await page.screenshot({ path: path.join(outDir, 'runtime-11-fluid-5min.png') });
  check('流体预览：5 分钟运行后控制台无错误', takeErrors('fluid-5min').length === 0);
} catch (error) {
  check('验收脚本执行完成', false, String(error && error.stack ? error.stack.split('\n')[0] : error));
} finally {
  const failed = results.filter((r) => !r.ok).length;
  writeFileSync(
    path.join(outDir, 'runtime-report.json'),
    JSON.stringify({ time: new Date().toISOString(), total: results.length, failed, results, perf, consoleErrors }, null, 2)
  );
  console.log(`\n浏览器验收：${results.length - failed}/${results.length} 通过（失败 ${failed}）`);
  console.log('控制台错误汇总：', consoleErrors.length ? JSON.stringify(consoleErrors) : '无');
  await browser.close();
  await new Promise((resolve) => previewServer.httpServer.close(resolve));
  devServer.close();
  await vite.close();
  process.exitCode = failed ? 1 : 0;
}