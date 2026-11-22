/**
 * 微沸喷烧 Phase 4 流体教学示意预览验证。
 *
 * 启动临时 Vite 服务与 headless Edge，渲染 scripts/preview/boil-fluid.html：
 * - 校核 13 条管线 / 13 个示意阀 / 两条独立流线的初始全开状态；
 * - 校核示踪粒子与流向箭头、阀门状态灯数量与可见性；
 * - 关闭阀门：本管在阀位停止、同流线下游断流、其他流线不受影响；
 * - 部分开度：本管与同流线下游节流、上游不受影响；
 * - 全部关闭/全部开启、暂停/速度/箭头开关、HUD 阀门按钮与三维阀门点击；
 * - 截取全开、物料阀关闭、烟气管节流与全部关闭截图；
 * - 不接入站点路由、不发布。
 *
 * 运行：node scripts/verify-boil-fluid.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = path.join(root, 'outputs', 'verify-boil-fluid');
mkdirSync(outDir, { recursive: true });

const results = [];
const consoleErrors = [];
let browser;
let server;
let vite;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MATERIAL_PIPES = ['pipe-material-01', 'pipe-material-02', 'pipe-material-03', 'pipe-material-04'];
const GAS_PIPES = ['pipe-gas-01', 'pipe-gas-02', 'pipe-gas-03', 'pipe-gas-04', 'pipe-gas-05', 'pipe-gas-06', 'pipe-gas-07', 'pipe-gas-08', 'pipe-gas-09'];

try {
  const { createServer } = await import('vite');
  vite = await createServer({
    root,
    server: { middlewareMode: true, hmr: false }
  });
  server = createHttpServer(vite.middlewares);
  const listening = once(server, 'listening');
  server.listen({ host: '127.0.0.1', port: 0 });
  await listening;
  const address = server.address();
  assert.ok(address && typeof address === 'object', '临时服务未分配端口');
  const base = `http://127.0.0.1:${address.port}/`;

  browser = await chromium.launch({
    ...browserOptions,
    headless: true,
    args: [
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--disable-gpu-sandbox',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows'
    ]
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  page.setDefaultNavigationTimeout(120000);
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`console: ${msg.text()}`); });

  const url = `${base}scripts/preview/boil-fluid.html`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body[data-preview-ready="1"]', { timeout: 120000 });
  await wait(900);

  const report = await page.evaluate(() => window.__boilFluid);
  assert.ok(report && report.ready, '预览页未报告 ready');

  const getState = () => page.evaluate(() => ({
    counts: window.__boilFluid.fluidCounts,
    flows: window.__boilFluid.flows,
    valveStates: window.__boilFluid.valveStates,
    supplied: window.__boilFluid.suppliedEquipment,
    unsupplied: window.__boilFluid.unsuppliedEquipment,
    runtime: window.__boilFluid.runtime
  }));
  const setValve = (pipelineId, state) => page.evaluate(([id, value]) => {
    window.__boilFluid.actions.setValve(id, value);
  }, [pipelineId, state]);
  const setAll = (state) => page.evaluate((value) => {
    window.__boilFluid.actions.setAll(value);
  }, state);

  check('流体预览模式加载', report.mode === 'fluid', report.mode);
  check('13 条管线 / 18 台设备 / 13 个示意阀',
    report.counts.pipelines === 13 && report.counts.equipment === 18 && report.counts.valves === 13,
    `${report.counts.pipelines}/${report.counts.equipment}/${report.counts.valves}`);
  check('示踪粒子 ≥ 180 且每管 ≥ 3',
    report.counts.particles >= 180 && report.runs.every((run) => run.particles >= 3),
    `${report.counts.particles} / min ${Math.min(...report.runs.map((run) => run.particles))}`);
  check('流向箭头每管 ≥ 1',
    report.counts.arrows >= 13 && report.runs.every((run) => run.arrows >= 1),
    `${report.counts.arrows} / min ${Math.min(...report.runs.map((run) => run.arrows))}`);
  check('13 个阀位比例在 0.02–0.98 之间',
    report.runs.every((run) => run.valveT > 0.02 && run.valveT < 0.98),
    report.runs.map((run) => run.valveT).join(', '));
  check('初始全开：13 流动 / 0 节流 / 0 停止 / 0 断流',
    report.fluidCounts.full === 13 && report.fluidCounts.throttle === 0 && report.fluidCounts.halt === 0 && report.fluidCounts.off === 0,
    `${report.fluidCounts.full}/${report.fluidCounts.throttle}/${report.fluidCounts.halt}/${report.fluidCounts.off}`);
  check('初始供料设备 14 / 待确认未供料 4（四根喷枪）',
    report.fluidCounts.suppliedEquipment === 14 && report.fluidCounts.unsuppliedEquipment === 4 &&
      report.unsuppliedEquipment.every((id) => id.startsWith('eq-spray-gun-')),
    `${report.fluidCounts.suppliedEquipment}/${report.fluidCounts.unsuppliedEquipment} ${report.unsuppliedEquipment.join(',')}`);
  check('两条独立教学流线', report.streams.length === 2 && report.streams.every((stream) => stream.pipelineIds.length > 0),
    report.streams.map((stream) => `${stream.id}:${stream.pipelineIds.length}`).join(' / '));
  check('阀门型式：物料闸阀 / 烟气蝶阀',
    report.routes.filter((route) => MATERIAL_PIPES.includes(route.pipelineId)).every((route) => route.valveKind === 'gate') &&
      report.routes.filter((route) => GAS_PIPES.includes(route.pipelineId)).every((route) => route.valveKind === 'butterfly'),
    report.routes.map((route) => `${route.pipelineId}:${route.valveKind}`).join(', '));
  check('初始粒子与箭头全部可见',
    report.runtime.perRun.every((run) => run.particlesVisible && run.arrowsVisible),
    report.runtime.perRun.filter((run) => !(run.particlesVisible && run.arrowsVisible)).map((run) => run.pipelineId).join(', '));
  check('Phase 4 校验 0 错误', report.errorCount === 0, report.errors.map((error) => error.code).join(', '));

  await page.screenshot({ path: path.join(outDir, 'boil-p4-overview-open.png'), timeout: 120000 });

  /* 关闭物料管 02：本管停止、下游 03/04 断流、烟气 9 条保持流动 */
  await setValve('pipe-material-02', 'closed');
  await wait(800);
  let state = await getState();
  let material02 = state.flows['pipe-material-02'];
  check('关闭物料 02：本管在阀位停止',
    material02 && material02.state === 'halt' && Math.abs(material02.haltT - material02.valveT) < 1e-6,
    material02 ? `${material02.state}@${material02.haltT}/${material02.valveT}` : 'missing');
  check('关闭物料 02：上游 01 流动、下游 03/04 断流',
    state.flows['pipe-material-01']?.state === 'full' &&
      state.flows['pipe-material-03']?.state === 'off' && state.flows['pipe-material-04']?.state === 'off',
    `${state.flows['pipe-material-01']?.state}/${state.flows['pipe-material-03']?.state}/${state.flows['pipe-material-04']?.state}`);
  check('关闭物料 02：烟气 9 条不受影响',
    GAS_PIPES.every((id) => state.flows[id]?.state === 'full'),
    GAS_PIPES.map((id) => state.flows[id]?.state).join(','));
  check('关闭物料 02：统计 10 流动 / 1 停止 / 2 断流',
    state.counts.full === 10 && state.counts.halt === 1 && state.counts.off === 2 && state.counts.throttle === 0,
    `${state.counts.full}/${state.counts.throttle}/${state.counts.halt}/${state.counts.off}`);
  check('关闭物料 02：供料设备降为 12（物料侧只剩 SMP/破碎机）',
    state.counts.suppliedEquipment === 12 && !state.supplied.includes('eq-mixer'),
    `${state.counts.suppliedEquipment} ${state.supplied.join(',')}`);
  const haltRun = state.runtime.perRun.find((run) => run.pipelineId === 'pipe-material-02');
  check('关闭阀前粒子停在阀位之前',
    haltRun && haltRun.particlesVisible && !haltRun.arrowsVisible && haltRun.maxU <= haltRun.valveT + 0.001,
    haltRun ? `maxU=${haltRun.maxU} valveT=${haltRun.valveT}` : 'missing');
  await page.screenshot({ path: path.join(outDir, 'boil-p4-material-02-closed.png'), timeout: 120000 });

  await setValve('pipe-material-02', 'open');
  await wait(700);
  state = await getState();
  check('恢复物料 02：全部 13 条恢复流动',
    state.counts.full === 13 && state.counts.halt === 0 && state.counts.off === 0 && state.counts.throttle === 0,
    `${state.counts.full}/${state.counts.throttle}/${state.counts.halt}/${state.counts.off}`);

  /* 烟气 05 部分开度：本管与下游 06–09 节流，物料与上游不受影响 */
  await setValve('pipe-gas-05', 'partial');
  await wait(800);
  state = await getState();
  check('部分开启烟气 05：本管全流且节流',
    state.flows['pipe-gas-05']?.state === 'full' && state.flows['pipe-gas-05']?.throttle === true,
    JSON.stringify(state.flows['pipe-gas-05']));
  check('部分开启烟气 05：下游 06–09 节流',
    ['pipe-gas-06', 'pipe-gas-07', 'pipe-gas-08', 'pipe-gas-09'].every((id) => state.flows[id]?.state === 'full' && state.flows[id]?.throttle),
    ['pipe-gas-06', 'pipe-gas-07', 'pipe-gas-08', 'pipe-gas-09'].map((id) => `${state.flows[id]?.state}:${state.flows[id]?.throttle}`).join(','));
  check('部分开启烟气 05：上游 01–04 与物料 4 条不节流',
    ['pipe-gas-01', 'pipe-gas-02', 'pipe-gas-03', 'pipe-gas-04', ...MATERIAL_PIPES].every((id) => state.flows[id]?.state === 'full' && !state.flows[id]?.throttle),
    ['pipe-gas-04', 'pipe-material-01'].map((id) => `${state.flows[id]?.state}:${state.flows[id]?.throttle}`).join(','));
  check('部分开启烟气 05：统计 13 流动 / 5 节流 / 0 停止',
    state.counts.full === 13 && state.counts.throttle === 5 && state.counts.halt === 0 && state.counts.off === 0,
    `${state.counts.full}/${state.counts.throttle}/${state.counts.halt}/${state.counts.off}`);
  const throttleRun = state.runtime.perRun.find((run) => run.pipelineId === 'pipe-gas-05');
  check('部分开启时箭头仍可见、粒子减速状态记录',
    throttleRun && throttleRun.arrowsVisible && throttleRun.throttle === true,
    throttleRun ? `${throttleRun.arrowsVisible}/${throttleRun.throttle}` : 'missing');
  await page.screenshot({ path: path.join(outDir, 'boil-p4-gas-05-partial.png'), timeout: 120000 });

  await setValve('pipe-gas-05', 'open');
  await wait(600);

  /* 全部关闭：两条流线首管停止、其余断流 */
  await setAll('closed');
  await wait(800);
  state = await getState();
  check('全部关闭：两条流线首管停止（2 halt / 11 断流）',
    state.flows['pipe-material-01']?.state === 'halt' && state.flows['pipe-gas-01']?.state === 'halt' &&
      state.counts.halt === 2 && state.counts.off === 11 && state.counts.full === 0,
    `${state.counts.full}/${state.counts.throttle}/${state.counts.halt}/${state.counts.off}`);
  check('全部关闭：供料设备只剩两个流线源',
    state.counts.suppliedEquipment === 2 && state.supplied.includes('eq-smp') && state.supplied.includes('eq-secondary-chamber'),
    state.supplied.join(','));
  check('全部关闭：所有箭头隐藏',
    state.runtime.perRun.every((run) => !run.arrowsVisible),
    state.runtime.perRun.filter((run) => run.arrowsVisible).map((run) => run.pipelineId).join(','));
  await page.screenshot({ path: path.join(outDir, 'boil-p4-all-closed.png'), timeout: 120000 });

  await page.click('.controls button[data-action="all-open"]');
  await wait(700);
  state = await getState();
  check('HUD 全部开启：恢复 13 条流动',
    state.counts.full === 13 && state.counts.halt === 0 && state.counts.off === 0,
    `${state.counts.full}/${state.counts.halt}/${state.counts.off}`);

  /* HUD 阀门按钮 */
  await page.click('tr[data-pipeline="pipe-material-01"] button[data-state="closed"]');
  await wait(700);
  state = await getState();
  check('HUD 关闭物料 01：本管停止、下游 02–04 断流',
    state.flows['pipe-material-01']?.state === 'halt' &&
      state.flows['pipe-material-02']?.state === 'off' && state.flows['pipe-material-03']?.state === 'off' && state.flows['pipe-material-04']?.state === 'off',
    MATERIAL_PIPES.map((id) => state.flows[id]?.state).join(','));
  await page.click('tr[data-pipeline="pipe-material-01"] button[data-state="open"]');
  await wait(600);

  /* 三维阀门点击：烟气 08 阀从 open → partial */
  const beforeClick = await page.evaluate(() => window.__boilFluid.valveStates['pipe-gas-08'] ?? 'open');
  const screen = await page.evaluate(() => window.__boilFluid.actions.projectValve('pipe-gas-08'));
  if (screen && screen.visible) {
    await page.mouse.move(screen.x, screen.y);
    await page.mouse.down();
    await page.mouse.up();
    await wait(700);
    const afterClick = await page.evaluate(() => window.__boilFluid.valveStates['pipe-gas-08'] ?? 'open');
    check('点击三维阀门切换状态（open → partial）', beforeClick === 'open' && afterClick === 'partial', `${beforeClick} → ${afterClick}`);
    await page.evaluate(() => window.__boilFluid.actions.setValve('pipe-gas-08', 'open'));
    await wait(500);
  } else {
    check('点击三维阀门切换状态（open → partial）', false, '阀位不在视口内，未能点击');
  }

  /* 暂停 / 继续 */
  const readProgress = () => page.evaluate(() => window.__boilFluid.actions.progress('pipe-gas-09'));
  const progressBefore = await readProgress();
  await wait(600);
  const progressMoving = await readProgress();
  await page.evaluate(() => window.__boilFluid.actions.setPaused(true));
  await wait(400);
  const pausedFlag = await page.evaluate(() => window.__boilFluid.actions.isPaused());
  const progressPausedA = await readProgress();
  await wait(700);
  const progressPausedB = await readProgress();
  check('播放中粒子进度前进', progressBefore >= 0 && progressMoving !== progressBefore, `${progressBefore} → ${progressMoving}`);
  check('暂停后粒子进度保持不变', pausedFlag === true && progressPausedA >= 0 && Math.abs(progressPausedB - progressPausedA) < 1e-4, `${progressPausedA} → ${progressPausedB}（paused=${pausedFlag}）`);
  await page.evaluate(() => window.__boilFluid.actions.setPaused(false));

  /* 速度与箭头开关 */
  await page.evaluate(() => window.__boilFluid.actions.setSpeed(2));
  await wait(300);
  const speed = await page.evaluate(() => window.__boilFluid.actions.speed());
  check('速度切换 2× 生效', speed === 2, String(speed));
  await page.evaluate(() => window.__boilFluid.actions.setSpeed(1));
  await page.evaluate(() => window.__boilFluid.actions.setArrows(false));
  await wait(500);
  const arrowsOff = await page.evaluate(() => window.__boilFluid.actions.stats());
  check('关闭箭头开关后全部箭头隐藏', arrowsOff.arrowsEnabled === false && arrowsOff.perRun.every((run) => !run.arrowsVisible),
    arrowsOff.perRun.filter((run) => run.arrowsVisible).map((run) => run.pipelineId).join(','));
  await page.evaluate(() => window.__boilFluid.actions.setArrows(true));
  await wait(500);
  const arrowsOn = await page.evaluate(() => window.__boilFluid.actions.stats().perRun.filter((run) => run.arrowsVisible).length);
  check('恢复箭头开关后 13 条管线箭头可见', arrowsOn === 13, String(arrowsOn));

  /* 视图预设与近景截图 */
  await page.click('.controls button[data-view="material"]');
  await wait(800);
  const viewMaterial = await page.evaluate(() => window.__boilFluid.view);
  check('视图预设：物料段', viewMaterial === 'material', viewMaterial);
  await page.screenshot({ path: path.join(outDir, 'boil-p4-material-closeup.png'), timeout: 120000 });
  await page.click('.controls button[data-view="valve"]');
  await wait(600);
  await page.screenshot({ path: path.join(outDir, 'boil-p4-valve-closeup.png'), timeout: 120000 });
  await page.click('.controls button[data-view="overview"]');
  await wait(500);

  /* 阀门表 13 行 */
  const rowCount = await page.evaluate(() => document.querySelectorAll('#summary tr[data-pipeline]').length);
  check('HUD 阀门状态表 13 行', rowCount === 13, String(rowCount));

  check('页面无 JS/控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 6).join(' | '));

  const failed = results.filter((result) => !result.ok);
  const reportOut = {
    generatedAt: new Date().toISOString(),
    mode: 'Phase 4 · 流体教学示意（内部预览）',
    summary: {
      pipelines: report.counts.pipelines,
      equipment: report.counts.equipment,
      valves: report.counts.valves,
      particles: report.counts.particles,
      arrows: report.counts.arrows,
      initialFull: report.fluidCounts.full,
      supplied: report.fluidCounts.suppliedEquipment,
      unsupplied: report.fluidCounts.unsuppliedEquipment,
      failed: failed.length
    },
    results,
    consoleErrors,
    initial: {
      fluidCounts: report.fluidCounts,
      flows: report.flows,
      suppliedEquipment: report.suppliedEquipment,
      unsuppliedEquipment: report.unsuppliedEquipment,
      runs: report.runs,
      routes: report.routes,
      streams: report.streams
    }
  };
  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(reportOut, null, 2));
  console.log(`\n报告：${path.join(outDir, 'report.json')}`);
  console.log(`结果：${failed.length === 0 ? '通过' : '失败'}（${results.length - failed.length}/${results.length}）`);
  if (failed.length > 0) process.exitCode = 1;
} catch (error) {
  console.error('流体预览验证执行失败：', error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (server) await new Promise((resolve) => server.close(resolve));
  if (vite) await vite.close().catch(() => undefined);
}
