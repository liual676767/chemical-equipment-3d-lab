/**
 * 微沸喷烧 Phase 3 工业管道教学示意预览验证。
 *
 * 启动临时 Vite 服务与 headless Edge，渲染 scripts/preview/boil-piping.html：
 * - 校核 18 个教学布局、36 个世界接口（26 接管 / 2 边界 / 8 待确认）、13 条路由；
 * - 校核端部法兰、弯头、示意阀、支架数量与 0 穿模/0 设备重叠/0 支架冲突；
 * - 校核网格几何（直管/弯头/法兰/阀/支架）与部件库（含三通/变径/三档管径）；
 * - 截取整线、两条聚焦管线与部件库截图；
 * - 不接入站点路由、不发布。
 *
 * 运行：node scripts/verify-boil-piping.mjs
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
const outDir = path.join(root, 'outputs', 'verify-boil-piping');
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

  const url = `${base}scripts/preview/boil-piping.html`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body[data-preview-ready="1"]', { timeout: 120000 });
  await wait(700);

  const report = await page.evaluate(() => window.__boilPiping);
  assert.ok(report && report.ready, '预览页未报告 ready');

  check('整线预览模式加载', report.mode === 'overview', report.mode);
  check('设备教学布局 18 个', report.counts.placements === 18, String(report.counts.placements));
  check('世界接口 36 个', report.counts.worldPorts === 36, String(report.counts.worldPorts));
  check('接口分类 26 接管 / 2 边界 / 8 待确认',
    report.counts.connectedPorts === 26 && report.counts.boundaryPorts === 2 && report.counts.pendingPorts === 8,
    `${report.counts.connectedPorts}/${report.counts.boundaryPorts}/${report.counts.pendingPorts}`);
  check('已路由管线 13 条 / 端口 26 个',
    report.counts.routedPipelines === 13 && report.counts.routedPorts === 26,
    `${report.counts.routedPipelines}/${report.counts.routedPorts}`);
  check('端部法兰 26 / 弯头 41 / 示意阀 13 / 支架 24',
    report.counts.terminalFlanges === 26 && report.counts.elbows === 41 && report.counts.valves === 13 && report.counts.supports === 24,
    `${report.counts.terminalFlanges}/${report.counts.elbows}/${report.counts.valves}/${report.counts.supports}`);
  check('穿模 0 / 设备重叠 0 / 支架冲突 0',
    report.counts.collisions === 0 && report.counts.equipmentOverlaps === 0 && report.counts.supportConflicts === 0,
    `${report.counts.collisions}/${report.counts.equipmentOverlaps}/${report.counts.supportConflicts}`);
  check('工艺管线三通 0 / 变径 0', report.counts.tees === 0 && report.counts.reducers === 0,
    `${report.counts.tees}/${report.counts.reducers}`);
  check('Phase 3 校验 0 错误', report.errorCount === 0, report.errors.map((e) => e.code).join(', '));

  const routeIssues = [];
  for (const route of report.routes) {
    if (route.segments < 1) routeIssues.push(`${route.pipelineId} 直管段 ${route.segments}`);
    if (route.flanges !== 2) routeIssues.push(`${route.pipelineId} 端部法兰 ${route.flanges}`);
    if (route.valves !== 1) routeIssues.push(`${route.pipelineId} 示意阀 ${route.valves}`);
    if (!(route.length > 0.5)) routeIssues.push(`${route.pipelineId} 长度 ${route.length}`);
    if (!route.fromPortKey || !route.toPortKey) routeIssues.push(`${route.pipelineId} 端点缺失`);
  }
  check('13 条路由端点/法兰/示意阀完整', routeIssues.length === 0, routeIssues.join('；'));

  const mesh = report.meshCounts;
  check('管道网格：13 组 / 直管 52+2 合并 / 弯头 41 / 法兰 26 / 阀 13 / 支架 24',
    mesh && mesh.pipes === 13 && mesh.straight + mesh.skippedStraight === report.counts.straightSegments &&
      mesh.straight === 52 && mesh.skippedStraight === 2 &&
      mesh.elbows === 41 && mesh.flanges === 26 && mesh.valves === 13 && mesh.supports === 24,
    mesh ? `${mesh.pipes}/${mesh.straight}+${mesh.skippedStraight}/${mesh.elbows}/${mesh.flanges}/${mesh.valves}/${mesh.supports}` : 'missing');
  check('管线分组 13 个', report.pipelineGroups.length === 13, String(report.pipelineGroups.length));
  check('页面无 JS/控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 6).join(' | '));

  await page.screenshot({ path: path.join(outDir, 'boil-p3-overview.png'), timeout: 120000 });

  /* 聚焦物料管与烟气管 */
  for (const pipeId of ['pipe-material-04', 'pipe-gas-08']) {
    await page.goto(`${url}?pipe=${encodeURIComponent(pipeId)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('body[data-preview-ready="1"]', { timeout: 120000 });
    await wait(500);
    const focus = await page.evaluate(() => window.__boilPiping);
    check(`聚焦管线 ${pipeId}`, focus && focus.mode === 'focus' && focus.focusPipe === pipeId, focus ? `${focus.mode}/${focus.focusPipe}` : 'missing');
    await page.screenshot({ path: path.join(outDir, `boil-p3-${pipeId}.png`), timeout: 120000 });
  }

  /* 部件库 */
  await page.goto(`${url}?gallery=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body[data-preview-ready="1"]', { timeout: 120000 });
  await wait(500);
  const gallery = await page.evaluate(() => window.__boilPiping);
  check('部件库模式加载', gallery && gallery.mode === 'gallery', gallery ? gallery.mode : 'missing');
  const items = gallery?.gallery?.items ?? [];
  const keys = new Set(items.map((item) => item.key));
  const required = ['straight-main', 'straight-branch', 'straight-utility', 'elbow', 'tee', 'reducer', 'flange', 'valve-gate', 'valve-butterfly', 'support'];
  const missing = required.filter((key) => !keys.has(key));
  check('部件库 10 项齐全（含三通/变径/三档管径）', items.length === 10 && missing.length === 0, missing.join(', '));
  const emptyItems = items.filter((item) => !(item.meshes > 0));
  check('部件库各部件均有几何网格', emptyItems.length === 0, emptyItems.map((item) => item.key).join(', '));
  check('部件库模式仍报告 0 错误', gallery.errorCount === 0, gallery.errors.map((e) => e.code).join(', '));
  await page.screenshot({ path: path.join(outDir, 'boil-p3-gallery.png'), timeout: 120000 });

  check('全流程无页面错误/控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 6).join(' | '));

  const failed = results.filter((r) => !r.ok);
  const reportOut = {
    generatedAt: new Date().toISOString(),
    mode: 'Phase 3 · 工业管道教学示意（内部预览）',
    summary: {
      routes: report.counts.routedPipelines,
      ports: report.counts.worldPorts,
      connected: report.counts.connectedPorts,
      boundary: report.counts.boundaryPorts,
      pending: report.counts.pendingPorts,
      flanges: report.counts.terminalFlanges,
      elbows: report.counts.elbows,
      valves: report.counts.valves,
      supports: report.counts.supports,
      collisions: report.counts.collisions,
      failed: failed.length
    },
    results,
    consoleErrors,
    overview: {
      counts: report.counts,
      routes: report.routes,
      equipment: report.equipment,
      worldPorts: report.worldPorts,
      meshCounts: report.meshCounts
    },
    gallery: gallery?.gallery ?? null
  };
  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(reportOut, null, 2));
  console.log(`\n报告：${path.join(outDir, 'report.json')}`);
  console.log(`结果：${failed.length === 0 ? '通过' : '失败'}（${results.length - failed.length}/${results.length}）`);
  if (failed.length > 0) process.exitCode = 1;
} catch (error) {
  console.error('工业管道预览验证执行失败：', error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (server) await new Promise((resolve) => server.close(resolve));
  if (vite) await vite.close().catch(() => undefined);
}
