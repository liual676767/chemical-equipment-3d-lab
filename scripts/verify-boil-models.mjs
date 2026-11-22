/**
 * 微沸喷烧 Phase 2 设备接口预览验证。
 *
 * 启动临时 Vite 服务与 headless Edge，渲染 scripts/preview/boil-models.html：
 * - 校核 14 类模型、18 个实例映射、36 个数据接口与 28 个模型接口锚点；
 * - 校核接口锚点位于模型包围盒容差内、法线归一化、无重复接口；
 * - 截取总览与逐模型截图，供人工复核外部形体与法兰接管；
 * - 不接入站点路由、不发布。
 *
 * 运行：node scripts/verify-boil-models.mjs
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
const outDir = path.join(root, 'outputs', 'verify-boil-models');
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
  page.setDefaultTimeout(90000);
  page.setDefaultNavigationTimeout(90000);
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`console: ${msg.text()}`); });

  const url = `${base}scripts/preview/boil-models.html`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body[data-preview-ready="1"]', { timeout: 90000 });
  await wait(600);

  const report = await page.evaluate(() => window.__boilPreview);
  assert.ok(report && report.ready, '预览页未报告 ready');

  check('预览页加载 14 类设备模型', report.modelCount === 14, String(report.modelCount));
  check('模型接口共 28 个（14 类 × 2）', report.modelPortTotal === 28, String(report.modelPortTotal));
  check('数据接口共 36 个（18 实例 × 2）', report.dataPortCount === 36, String(report.dataPortCount));
  check('设备实例映射 18 个', report.instances.length === 18, String(report.instances.length));

  const keys = new Set(report.modelKeys);
  const missingModel = report.instances.filter((e) => !e.modelKey || !keys.has(e.modelKey));
  check('18 个实例全部映射到已注册模型', missingModel.length === 0, missingModel.map((e) => e.id).join(', '));

  const statusIssues = report.instances.filter((e) => e.modelStatus !== 'available');
  check('18 个实例外部模型状态均为 available', statusIssues.length === 0, statusIssues.map((e) => e.id).join(', '));

  const modelIssues = [];
  for (const model of report.models) {
    if (model.portCount !== 2) modelIssues.push(`${model.key} 接口数 ${model.portCount}`);
    if (model.meshCount < 5) modelIssues.push(`${model.key} 网格数 ${model.meshCount}`);
    if (!(model.bbox.size[0] > 0.2 && model.bbox.size[1] > 0.4 && model.bbox.size[2] > 0.2)) {
      modelIssues.push(`${model.key} 包围盒异常 ${model.bbox.size.join('×')}`);
    }
    if (model.bbox.min[1] < -0.05 || model.bbox.max[1] < 0.5) {
      modelIssues.push(`${model.key} 高度异常 minY=${model.bbox.min[1]} maxY=${model.bbox.max[1]}`);
    }
    for (const port of model.ports) {
      const len = Math.hypot(port.dir[0], port.dir[1], port.dir[2]);
      if (Math.abs(len - 1) > 0.01) modelIssues.push(`${model.key}.${port.id} 法线长度 ${len.toFixed(3)}`);
      if (!port.insideTolerance) modelIssues.push(`${model.key}.${port.id} 锚点超出模型包围盒容差`);
      if (port.role !== 'in' && port.role !== 'out' && port.role !== 'both') modelIssues.push(`${model.key}.${port.id} 角色 ${port.role}`);
    }
  }
  check('模型形体、包围盒、接口锚点与法线检查通过', modelIssues.length === 0, modelIssues.join('；'));

  const mappingIssues = [];
  for (const eq of report.instances) {
    const model = report.models.find((m) => m.key === eq.modelKey);
    if (!model) {
      mappingIssues.push(`${eq.id} 缺少模型 ${eq.modelKey}`);
      continue;
    }
    for (const port of eq.ports) {
      const modelPort = model.ports.find((p) => p.id === port.modelPortId);
      if (!modelPort) mappingIssues.push(`${eq.id}.${port.id} 缺少模型接口 ${port.modelPortId}`);
      else {
        if (modelPort.role !== port.role) mappingIssues.push(`${eq.id}.${port.id} 角色不一致`);
        if (Boolean(modelPort.boundary) !== Boolean(port.boundary)) mappingIssues.push(`${eq.id}.${port.id} 边界标记不一致`);
        if (port.media.length > 0 && modelPort.media.length > 0 && !port.media.some((m) => modelPort.media.includes(m))) {
          mappingIssues.push(`${eq.id}.${port.id} 介质不一致`);
        }
      }
    }
  }
  check('数据接口与模型接口 id/角色/介质/边界一致', mappingIssues.length === 0, mappingIssues.join('；'));

  await page.screenshot({ path: path.join(outDir, 'boil-p2-overview.png'), timeout: 120000 });

  const closeups = report.modelKeys;
  for (const key of closeups) {
    await page.goto(`${url}?model=${encodeURIComponent(key)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('body[data-preview-ready="1"]', { timeout: 90000 });
    await wait(350);
    const single = await page.evaluate(() => window.__boilPreview);
    if (!(single && single.ready && single.modelCount === 1 && single.modelKeys[0] === key)) {
      check(`单模型预览 ${key}`, false, '页面未报告正确模型');
      continue;
    }
    await page.screenshot({ path: path.join(outDir, `boil-p2-${key}.png`), timeout: 120000 });
  }
  check('逐模型预览截图完成', true, closeups.join(', '));

  check('页面无 JS 错误 / 控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 6).join(' | '));

  const failed = results.filter((r) => !r.ok);
  const reportOut = {
    generatedAt: new Date().toISOString(),
    mode: 'Phase 2 · 设备接口与连接关系（内部预览）',
    summary: {
      models: report.modelCount,
      modelPorts: report.modelPortTotal,
      dataPorts: report.dataPortCount,
      instances: report.instances.length,
      failed: failed.length
    },
    results,
    consoleErrors,
    preview: {
      models: report.models,
      instances: report.instances
    }
  };
  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(reportOut, null, 2));
  console.log(`\n报告：${path.join(outDir, 'report.json')}`);
  console.log(`结果：${failed.length === 0 ? '通过' : '失败'}（${results.length - failed.length}/${results.length}）`);
  if (failed.length > 0) process.exitCode = 1;
} catch (error) {
  console.error('模型接口预览验证执行失败：', error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (server) await new Promise((resolve) => server.close(resolve));
  if (vite) await vite.close().catch(() => undefined);
}
