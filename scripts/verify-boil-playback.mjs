/**
 * 微沸喷烧 Phase 6：工艺追踪 + 完整流程播放验证。
 *
 * 覆盖 15 项验收：
 * 1. 任意设备追踪上游；2. 追踪下游；3. 多分支；4. 循环识别；
 * 5. 播放完整流程；6. 暂停；7. 停止；8. 重置；9. 速度；
 * 10. 进度条跳转；11. 摄像机平滑；12. 流体同步；13. 四根喷枪；
 * 14. 二维流程图与三维一致；15. 原有区域/管线/流体功能。
 *
 * 运行：node scripts/verify-boil-playback.mjs
 */
import { clickBoilEquipment, pickBoilOption, showBoilTree } from './boil-browser-actions.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = path.join(root, 'outputs', 'verify-boil-playback');
mkdirSync(outDir, { recursive: true });

const results = [];
const consoleErrors = [];
let browser;
let vite;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  /* 验证生产构建 dist（无 HMR，避免与本机其他 Vite 服务的 HMR 端口冲突）。运行前先 npm run build。 */
  const { preview } = await import('vite');
  const input = process.env.SMOKE_BASE;
  if (!input) vite = await preview({ root, preview: { host: '127.0.0.1', port: 0 } });
  const base = input ?? vite?.resolvedUrls?.local?.[0];
  assert.ok(base, '预览服务未分配地址');

  browser = await chromium.launch({
    ...browserOptions,
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
  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  page.setDefaultNavigationTimeout(120000);
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`);
  });

  const shot = async (name) => {
    await page.screenshot({ path: path.join(outDir, name), timeout: 120000 });
  };
  const api = (fn, arg) =>
    page.evaluate(
      ({ body, value }) => {
        const target = window.__boil;
        return new Function('api', 'arg', body)(target, value);
      },
      { body: fn, value: arg }
    );

  await page.goto(`${base}#/boil`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.boil-canvas', { timeout: 120000 });
  await page.waitForFunction(() => Boolean(window.__boil?.ready), { timeout: 120000 });
  await wait(1800);

  /* ---------- 1. 初始数据与同源检查 ---------- */
  const initial = await api(`
    return {
      phase: api.phase,
      map: api.mapInfo(),
      traceAudit: api.traceAudit,
      playbackAudit: { ok: api.playbackAudit.ok, errors: api.playbackAudit.errors, steps: api.playbackAudit.steps },
      playback: api.playback.state,
      perf: api.perf()
    };
  `);
  check(
    'Phase 6 页面加载与数据同源',
    initial.phase === 6 &&
      initial.map.nodes === 18 &&
      initial.map.pipelines === 13 &&
      initial.map.branches === 4 &&
      initial.traceAudit.nodes === 18 &&
      initial.playbackAudit.ok &&
      initial.playback.status === 'idle',
    `地图 ${initial.map.nodes} 节点 / ${initial.map.pipelines} 管线 / ${initial.map.branches} 支路；播放 15 步`
  );
  await shot('p6-01-overview.png');

  /* ---------- 2. 点击设备追踪上游 ---------- */
  await clickBoilEquipment(page, 'eq-wash-tower');
  await wait(900);
  const traceWash = await api(`
    const result = api.traceResult;
    return {
      mode: api.mode,
      root: result.rootId,
      upstreamPath: result.upstream.paths[0].equipmentIds,
      downstreamCount: result.downstream.paths[0].equipmentIds.length,
      overlay: api.overlay(),
      heading: document.querySelector('.boil-detail-heading h2')?.textContent,
      detail: document.querySelector('.boil-detail-body')?.textContent.slice(0, 900)
    };
  `);
  check(
    '点击设备追踪上游',
    traceWash.mode === 'trace' &&
      traceWash.root === 'eq-wash-tower' &&
      traceWash.upstreamPath.join('>') ===
        'eq-smp>eq-crusher>eq-mixer>eq-furnace-pump>eq-secondary-chamber>eq-rotary-kiln>eq-quench-1>eq-baghouse>eq-quench-2>eq-comprehensive-tower>eq-wash-tower',
    `上游 ${traceWash.upstreamPath.length} 台`
  );

  /* ---------- 3. 追踪下游 ---------- */
  await page.locator('.boil-chip', { hasText: '追踪下游' }).click();
  await wait(500);
  const traceDown = await api(`
    const overlay = api.overlay();
    return {
      overlay,
      downstream: api.traceResult.downstream.paths[0].equipmentIds,
      detail: document.querySelector('.boil-detail-body')?.textContent.slice(0, 900)
    };
  `);
  check(
    '点击设备追踪下游',
    traceDown.downstream.join('>') === 'eq-wash-tower>eq-wet-esp>eq-id-fan>eq-stack' &&
      traceDown.overlay.upstreamEquipmentIds.length === 0 &&
      traceDown.overlay.downstreamEquipmentIds.length === 3,
    traceDown.downstream.join(' → ')
  );
  await shot('p6-02-trace-wash.png');

  /* ---------- 4. 多分支与四喷枪平行支路 ---------- */
  await api(`api.enterTrace('eq-secondary-chamber'); return true;`);
  await wait(900);
  const branchState = await api(`
    const result = api.traceResult;
    const map = api.mapInfo();
    return {
      branches: result.full.branches,
      serial: api.traceAudit.serialGunEdges,
      mapBranch: map.highlighted.branch,
      detail: document.querySelector('.boil-detail-body')?.textContent.slice(0, 1200)
    };
  `);
  check(
    '多分支与四喷枪平行支路',
    branchState.branches.length === 1 &&
      branchState.branches[0].equipmentIds.length === 4 &&
      branchState.serial.length === 0 &&
      branchState.mapBranch.length === 4 &&
      branchState.detail.includes('平行支路'),
    `平行支路 ${branchState.branches[0]?.equipmentIds.join(', ')}`
  );

  /* ---------- 5. 循环识别 ---------- */
  const cycleProbe = await api(`return api.traceCycleProbe();`);
  check(
    '循环关系识别与递归保护',
    cycleProbe.cycles > 0 && cycleProbe.terminated && cycleProbe.paths <= 32,
    `合成回流环 ${cycleProbe.cycles} 个 / 路径 ${cycleProbe.paths} 条`
  );

  /* ---------- 6. 完整流程播放 ---------- */
  await page.click('.boil-pb-play');
  await wait(1100);
  const playing = await api(`return { state: api.playback.state, overlay: api.overlay(), mode: api.mode };`);
  check(
    '开始播放并真实推进',
    playing.mode === 'playback' && playing.state.status === 'playing' && playing.state.progress > 0,
    `第 ${playing.state.stepNo} 步 · 进度 ${(playing.state.progress * 100).toFixed(1)}%`
  );
  await shot('p6-03-play-step1.png');

  await pickBoilOption(page, '.boil-pb-speed[data-speed="4"]');
  await wait(300);
  const sequence = [];
  for (let index = 0; index < 15; index += 1) {
    await api(`api.playback.jumpTo(${index}); return true;`);
    await wait(140);
    sequence.push(
      await api(`
        const state = api.playback.state;
        const overlay = api.overlay();
        return { title: state.step.title, no: state.stepNo, current: overlay.currentEquipmentIds };
      `)
    );
  }
  const expectedTitles = [
    'SMP装置',
    '破碎机',
    '混合器',
    '炉塞泵',
    '二燃室',
    '四根喷枪',
    '回转窑',
    '集冷塔一',
    '布袋除尘器',
    '集冷塔二',
    '综合塔',
    '水洗塔',
    '湿电除尘',
    '引风机',
    '烟囱'
  ];
  check(
    '完整流程 15 步顺序与三维同步',
    sequence.every((item, index) => item.title === expectedTitles[index] && item.no === index + 1 && item.current.length > 0),
    sequence.map((item) => item.title).join(' → ')
  );

  /* ---------- 7. 暂停 ---------- */
  await api(`api.playback.jumpTo(10); return true;`);
  await wait(120);
  await page.click('.boil-pb-pause');
  const pausedA = await api(`return { state: api.playback.state, view: api.view(), overlay: api.overlay() };`);
  await wait(800);
  const pausedB = await api(`return { state: api.playback.state, view: api.view(), overlay: api.overlay() };`);
  check(
    '暂停有效（进度/流体/摄像机同时冻结）',
    pausedA.state.status === 'paused' &&
      Math.abs(pausedB.state.progress - pausedA.state.progress) < 1e-9 &&
      pausedB.overlay.paused &&
      pausedA.view.position.every((value, index) => Math.abs(value - pausedB.view.position[index]) < 1e-6),
    `进度差 ${(pausedB.state.progress - pausedA.state.progress).toFixed(8)}`
  );
  await shot('p6-04-paused.png');

  /* ---------- 8. 停止 ---------- */
  await page.click('.boil-pb-stop');
  await wait(500);
  const stopped = await api(`return { mode: api.mode, state: api.playback.state, overlay: api.overlay(), scene: api.state, map: api.mapInfo() };`);
  check(
    '停止回到初始状态',
    stopped.mode === 'normal' &&
      stopped.state.status === 'idle' &&
      stopped.state.progress === 0 &&
      stopped.overlay.kind === null &&
      stopped.scene.mode === 'overview' &&
      stopped.map.highlighted.current.length === 0,
    `场景 ${stopped.scene.mode} / 播放 ${stopped.state.status}`
  );

  /* ---------- 9. 重置 ---------- */
  await pickBoilOption(page, '.boil-pb-speed[data-speed="4"]');
  await pickBoilOption(page, '.boil-labels');
  await api(`api.enterTrace('eq-rotary-kiln'); return true;`);
  await wait(400);
  await page.click('.boil-pb-reset');
  await wait(600);
  const reset = await api(`
    return {
      mode: api.mode,
      state: api.playback.state,
      scene: api.state,
      labels: document.querySelector('.boil-labels')?.textContent,
      map: api.mapInfo()
    };
  `);
  check(
    '重置恢复场景原始视图',
    reset.mode === 'normal' &&
      reset.state.status === 'idle' &&
      reset.state.speed === 1 &&
      reset.scene.mode === 'overview' &&
      reset.labels === '标签：开' &&
      Math.abs(reset.map.view.scale - 1) < 1e-6,
    `速度 ${reset.state.speed}× / 标签 ${reset.labels} / 地图缩放 ${reset.map.view.scale.toFixed(2)}`
  );

  /* ---------- 10. 播放速度 ---------- */
  const speedOneStart = await api(`api.playback.start(); return api.playback.state.progress;`);
  await wait(900);
  const speedOneEnd = await api(`return api.playback.state.progress;`);
  await api(`api.playback.stop(); return true;`);
  await pickBoilOption(page, '.boil-pb-speed[data-speed="4"]');
  await api(`api.playback.start(); return true;`);
  await wait(900);
  const speedFourEnd = await api(`return api.playback.state.progress;`);
  const speedFourState = await api(`return api.playback.state;`);
  await api(`api.playback.stop(); return true;`);
  check(
    '播放速度 0.5/1/2/4 有效',
    speedFourState.speed === 4 &&
      speedFourEnd - speedOneStart > (speedOneEnd - speedOneStart) * 2.5,
    `1× 增量 ${(speedOneEnd - speedOneStart).toFixed(4)} / 4× 增量 ${(speedFourEnd - speedOneStart).toFixed(4)}`
  );

  /* ---------- 11. 进度条跳转 ---------- */
  const progressBox = await page.locator('.boil-pb-progress').boundingBox();
  assert.ok(progressBox, '进度条不可见');
  await page.locator('.boil-pb-progress').click({ position: { x: progressBox.width * 0.5, y: 8 } });
  await wait(400);
  const jumpHalf = await api(`return { state: api.playback.state, mode: api.mode };`);
  await page.locator('.boil-pb-progress').click({ position: { x: progressBox.width * 0.08, y: 8 } });
  await wait(400);
  const jumpStart = await api(`return api.playback.state;`);
  check(
    '进度条点击跳转',
    jumpHalf.mode === 'playback' &&
      jumpHalf.state.stepIndex >= 6 &&
      jumpHalf.state.stepIndex <= 8 &&
      jumpStart.stepIndex <= 2,
    `50% → 第 ${jumpHalf.state.stepNo} 步 / 8% → 第 ${jumpStart.stepNo} 步`
  );
  await api(`api.playback.stop(); return true;`);

  /* ---------- 12. 摄像机平滑 ---------- */
  await api(`api.playback.setSpeed(1); api.playback.start(); api.playback.jumpTo(9); return true;`);
  const cameraA = await api(`return api.view();`);
  await wait(120);
  const cameraMid = await api(`return api.view();`);
  await wait(1300);
  const cameraB = await api(`return api.view();`);
  check(
    '摄像机平滑移动（补间而非瞬移）',
    cameraA.tweening &&
      cameraMid.tweening &&
      !cameraB.tweening &&
      cameraA.position.some((value, index) => Math.abs(value - cameraB.position[index]) > 0.5),
    `补间中 ${cameraA.tweening}/${cameraMid.tweening} → 结束 ${cameraB.tweening}`
  );
  await api(`api.playback.stop(); return true;`);

  /* ---------- 13. 流体与步骤同步 ---------- */
  await api(`api.playback.jumpTo(4); return true;`);
  await wait(500);
  const fluidStep5 = await api(`
    const overlay = api.overlay();
    const runs = api.fluidStats().perRun;
    return {
      active: overlay.activePipelineIds,
      current: overlay.currentPipelineIds,
      full: runs.filter((run) => run.flowState === 'full').map((run) => run.pipelineId),
      off: runs.filter((run) => run.flowState === 'off').map((run) => run.pipelineId),
      visible: runs.filter((run) => run.particlesVisible).length
    };
  `);
  await api(`api.playback.jumpTo(14); return true;`);
  await wait(500);
  const fluidStep15 = await api(`
    const overlay = api.overlay();
    const runs = api.fluidStats().perRun;
    return {
      active: overlay.activePipelineIds,
      full: runs.filter((run) => run.flowState === 'full').length,
      visible: runs.filter((run) => run.particlesVisible).length
    };
  `);
  check(
    '流体动画与当前步骤同步',
    fluidStep5.active.length === 5 &&
      fluidStep5.full.length === 5 &&
      fluidStep5.off.length === 8 &&
      fluidStep5.visible === 5 &&
      fluidStep15.active.length === 13 &&
      fluidStep15.full === 13 &&
      fluidStep15.visible === 13,
    `第 5 步 5 条流动 / 第 15 步 13 条流动`
  );

  /* ---------- 14. 四根喷枪步骤 ---------- */
  await api(`api.playback.jumpTo(5); return true;`);
  await wait(600);
  const gunsStep = await api(`
    const overlay = api.overlay();
    const map = api.mapInfo();
    return {
      title: api.playback.state.step.title,
      current: overlay.currentEquipmentIds,
      branchLinks: overlay.branchLinksVisible,
      mapCurrent: map.highlighted.current,
      mapBranches: document.querySelectorAll('.boil-map-branch').length,
      heading: document.querySelector('.boil-detail-heading h2')?.textContent,
      detail: document.querySelector('.boil-detail-body')?.textContent.slice(0, 700)
    };
  `);
  check(
    '四根喷枪同时显示且不串联',
    gunsStep.title === '四根喷枪' &&
      gunsStep.current.length === 4 &&
      gunsStep.branchLinks &&
      gunsStep.mapCurrent.length === 4 &&
      gunsStep.mapBranches === 4 &&
      gunsStep.heading?.includes('第 6 步') &&
      gunsStep.detail.includes('平行支路'),
    `${gunsStep.current.join(', ')}`
  );
  await shot('p6-05-step6-guns.png');
  await api(`api.playback.stop(); return true;`);

  /* ---------- 15. 二维流程图 ---------- */
  const mapInfo = await api(`return api.mapInfo();`);
  await showBoilTree(page);
  await page.locator('.boil-map-node[data-equipment="eq-rotary-kiln"]').click({ force: true });
  await wait(700);
  const mapClick = await api(`return { mode: api.mode, root: api.traceResult?.rootId, map: api.mapInfo(), overlay: api.overlay() };`);
  await showBoilTree(page);
  await page.locator('.boil-map-zoom-in').click();
  await wait(200);
  const mapZoomed = await api(`return api.mapInfo();`);
  await page.locator('.boil-map-zoom-reset').click();
  const mapReset = await api(`return api.mapInfo();`);
  check(
    '二维流程图与三维同源并可定位/缩放',
    mapInfo.nodes === 18 &&
      mapInfo.pipelines === 13 &&
      mapInfo.branches === 4 &&
      mapClick.mode === 'trace' &&
      mapClick.root === 'eq-rotary-kiln' &&
      mapClick.map.highlighted.current[0] === 'eq-rotary-kiln' &&
      mapZoomed.view.scale > 1 &&
      Math.abs(mapReset.view.scale - 1) < 1e-6,
    `节点 ${mapInfo.nodes} / 管线 ${mapInfo.pipelines} / 点击后 ${mapClick.root}`
  );

  /* ---------- 16. 追踪历史 ---------- */
  await api(`api.enterTrace('eq-mixer'); return true;`);
  await wait(400);
  const history = await api(`
    return {
      history: api.history(),
      chips: [...document.querySelectorAll('.boil-history .boil-chip')].map((el) => el.textContent),
      paths: [...document.querySelectorAll('.boil-history .boil-link')].map((el) => el.textContent)
    };
  `);
  check(
    '追踪历史可快速返回',
    history.history.devices.includes('eq-mixer') &&
      history.history.devices.includes('eq-wash-tower') &&
      history.history.traces.length >= 2 &&
      history.chips.length >= 2 &&
      history.paths.length >= 2,
    `最近设备 ${history.chips.join('、')}`
  );
  await showBoilTree(page);
  await page.locator('.boil-history .boil-chip').first().click();
  await wait(500);
  const historyReturn = await api(`return { mode: api.mode, root: api.traceResult?.rootId };`);
  check('点击历史返回追踪设备', historyReturn.mode === 'trace' && Boolean(historyReturn.root), historyReturn.root);

  /* ---------- 17. 设备信息同步 ---------- */
  await api(`api.playback.jumpTo(11); return true;`);
  await wait(600);
  const infoText = await api(`return document.querySelector('.boil-detail-body')?.textContent ?? '';`);
  check(
    '播放时设备信息同步',
    infoText.includes('水洗塔') &&
      infoText.includes('湿法净化区') &&
      infoText.includes('第 12 步') &&
      infoText.includes('综合塔') &&
      infoText.includes('湿电除尘') &&
      infoText.includes('烟气') &&
      infoText.includes('综合塔 → 水洗塔') &&
      infoText.includes('Simulation / 教学模拟'),
    '设备/区域/步骤/上下游/介质/流向/教学模拟均已显示'
  );
  await api(`api.playback.stop(); return true;`);

  /* ---------- 18. 原有区域/管线/流体功能 ---------- */
  await page.click('[data-area-tab="area-03-cooling"]');
  await wait(500);
  const areaMode = await api(`return api.state;`);
  await api(`api.selectPipeline('pipe-gas-03'); return true;`);
  await wait(500);
  const pipelineMode = await api(`return api.state;`);
  await pickBoilOption(page, '.boil-fluid-arrows');
  const arrowsOff = await api(`return { stats: api.fluidStats(), text: document.querySelector('.boil-fluid-arrows')?.textContent };`);
  await pickBoilOption(page, '.boil-fluid-arrows');
  await pickBoilOption(page, '.boil-labels');
  const labelsOff = await api(`return document.querySelector('.boil-labels')?.textContent;`);
  await pickBoilOption(page, '.boil-labels');
  check(
    '原有区域/管线/流体功能保留',
    areaMode.mode === 'area' &&
      areaMode.areaId === 'area-03-cooling' &&
      pipelineMode.mode === 'pipeline' &&
      pipelineMode.pipelineId === 'pipe-gas-03' &&
      arrowsOff.stats.arrowsEnabled === false &&
      labelsOff === '标签：关',
    `区域 ${areaMode.areaId} / 管线 ${pipelineMode.pipelineId}`
  );

  /* ---------- 19. 性能与内存 ---------- */
  const perfBefore = await api(`return api.perf();`);
  for (let index = 0; index < 3; index += 1) {
    await api(`api.enterTrace('eq-smp'); return true;`);
    await wait(120);
    await api(`api.playback.jumpTo(14); return true;`);
    await wait(120);
    await api(`api.playback.stop(); return true;`);
  }
  const perfAfter = await api(`return api.perf();`);
  check(
    '追踪/播放不重建场景且几何稳定',
    perfAfter.buildCount === perfBefore.buildCount &&
      perfAfter.geometries - perfBefore.geometries <= 4 &&
      perfAfter.textures - perfBefore.textures <= 4,
    `构建 ${perfBefore.buildCount}→${perfAfter.buildCount} / 几何 ${perfBefore.geometries}→${perfAfter.geometries} / 纹理 ${perfBefore.textures}→${perfAfter.textures}`
  );

  /* ---------- 20. 页面错误 ---------- */
  check('无页面/控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'none');

  const failed = results.filter((result) => !result.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'Phase 6 · 工艺追踪与流程播放',
    summary: {
      checks: results.length,
      failed: failed.length,
      trace: initial.traceAudit,
      playbackSteps: initial.playbackAudit.steps,
      map: { nodes: initial.map.nodes, pipelines: initial.map.pipelines, branches: initial.map.branches },
      perfBefore,
      perfAfter
    },
    results,
    consoleErrors
  };
  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n报告：${path.join(outDir, 'report.json')}`);
  console.log(`结果：${failed.length === 0 ? '通过' : '失败'}（${results.length - failed.length}/${results.length}）`);
  if (failed.length > 0) process.exitCode = 1;
} catch (error) {
  console.error('Phase 6 验证执行失败：', error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (vite?.httpServer) await new Promise((resolve) => vite.httpServer.close(resolve));
}
