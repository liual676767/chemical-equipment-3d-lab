import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';

let base = process.env.CORE_TEST_BASE;
const outputRoot = fileURLToPath(new URL('../outputs/core-flow/', import.meta.url));
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(path.join(outputRoot, 'run-'));
const results = [];
const pageErrors = [];
let vite, server, browser, page;
let currentStep = '启动浏览器';
let screenshot;
let screenshotError;

async function step(name, run) {
  currentStep = name;
  await run();
  results.push({ name, status: 'PASS' });
  console.log('PASS  ' + name);
}

try {
  if (!base) {
    currentStep = '启动本地测试服务';
    const { createServer } = await import('vite');
    vite = await createServer({
      root: fileURLToPath(new URL('..', import.meta.url)),
      server: { middlewareMode: true, hmr: false },
    });
    server = createHttpServer(vite.middlewares);
    const listening = once(server, 'listening');
    server.listen({ host: '127.0.0.1', port: 0 });
    await listening;
    const address = server.address();
    assert.ok(address && typeof address === 'object', '本地测试服务未分配端口');
    base = 'http://127.0.0.1:' + address.port + '/';
  }
  currentStep = '启动浏览器';
  browser = await chromium.launch({
    ...browserOptions,
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);
  page.on('pageerror', error => pageErrors.push(error.message));

  await step('设备库搜索可缩小结果并恢复列表', async () => {
    const response = await page.goto(base + '#/library', { waitUntil: 'domcontentloaded' });
    assert.ok(response?.ok(), '首页应返回成功状态');
    const cards = page.locator('.device-card');
    const pump = cards.filter({ has: page.getByRole('heading', { name: '单级离心泵', exact: true }) });
    await pump.waitFor();
    const total = await cards.count();
    const search = page.locator('.search-input');
    await search.fill('单级离心泵');
    await pump.waitFor();
    const matching = await cards.count();
    assert.ok(matching > 0 && matching < total, '搜索应缩小设备结果范围');
    await search.fill('');
    assert.equal(await cards.count(), total);
  });

  await step('进入单级离心泵并切换剖视与整体观察', async () => {
    const pump = page.locator('.device-card').filter({
      has: page.getByRole('heading', { name: '单级离心泵', exact: true }),
    });
    await pump.getByRole('button', { name: /进入学习/ }).click();
    await page.waitForURL((url) => url.hash === '#/device/pump');
    await page.locator('.canvas-wrap canvas').waitFor();
    await page.locator('.webgl-fallback').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => Boolean(window.__chem3d?.scene), null, { timeout: 60000 });
    assert.match(await page.locator('.wb-device-name').innerText(), /单级离心泵/);
    for (const mode of ['剖视', '整体观察']) {
      await page.getByRole('button', { name: new RegExp(mode) }).and(page.locator('.mode-tab')).click();
      await page.locator('.mode-tab.active').filter({ hasText: mode }).waitFor();
    }
  });

  await step('剖切位置与原理动画速度滑条同步显示数值', async () => {
    await page.locator('.mode-tab').filter({ hasText: '剖视' }).click();
    const section = page.locator('.ctrl-slider').filter({ hasText: '剖切位置' });
    const sectionInput = section.getByRole('slider');
    await sectionInput.press('Home');
    await sectionInput.press('ArrowRight');
    assert.equal(await sectionInput.inputValue(), '1');
    assert.equal(await section.locator('.ctrl-value').innerText(), '1%');

    await page.locator('.mode-tab').filter({ hasText: '工作原理' }).click();
    const speed = page.locator('.ctrl-slider').filter({ hasText: '速度' });
    const speedInput = speed.getByRole('slider');
    await speedInput.press('Home');
    assert.equal(await speedInput.inputValue(), '0.25');
    await speedInput.press('ArrowRight');
    assert.equal(await speedInput.inputValue(), '0.5');
    assert.equal(await speed.locator('.ctrl-value').innerText(), '0.5×');
  });

  await step('完成引导拆装的第一步', async () => {
    await page.locator('.mode-tab').filter({ hasText: '拆装练习' }).click();
    const progress = page.locator('.step-text');
    await progress.filter({ hasText: /^步骤 1\s*\// }).waitFor();
    const title = await page.locator('.practice-instruction strong').innerText();
    const part = title.match(/^拆卸\s*(.+?)：?$/)?.[1];
    assert.ok(part, '第一步应显示要拆卸的零件名称');
    const partName = page.locator('.tree-name').and(page.getByText(part, { exact: true }));
    await page.locator('[data-action=parts]').click();
    await page.locator('.tree-item').filter({ has: partName }).click();
    await page.locator('.practice-actions').getByRole('button', { name: '拆下选中零件', exact: true }).click();
    await progress.filter({ hasText: /^步骤 2\s*\// }).waitFor();
  });

  await step('从设备库打开工坊并在画布放置两根直管', async () => {
    await page.locator('.back-btn').click();
    await page.locator('.site-links [data-nav="workshop"]').click();
    await page.waitForURL((url) => url.hash === '#/workshop');
    const stage = page.locator('.ws-canvas canvas');
    await stage.waitFor();
    await page.locator('.ws-counts').filter({ hasText: /^0 零件/ }).waitFor();
    const pipe = page.locator('.ws-part').filter({
      has: page.locator('.ws-part-name').filter({ hasText: /^直管$/ }),
    });
    const add = pipe.getByRole('button', { name: '添加到场景', exact: true });
    const placementHint = page.locator('.ws-place-hint').filter({ hasText: /放置「直管」/ });
    for (const count of [1, 2]) {
      await add.click();
      await placementHint.waitFor();
      const position = await stage.evaluate((canvas, item) => {
        const { camera, controls } = window.__ws.engine;
        const points = item === 1 ? [[0, 0, 0]] : [[0, 0, 3], [0, 0, -3]];
        const { width, height } = canvas.getBoundingClientRect();
        for (const point of points) {
          const ndc = controls.target.clone().fromArray(point).project(camera);
          if (Math.abs(ndc.x) < 0.85 && Math.abs(ndc.y) < 0.85) {
            return { x: width * (ndc.x + 1) / 2, y: height * (1 - ndc.y) / 2 };
          }
        }
        return null;
      }, count);
      assert.ok(position, '放置目标应在画布可操作区域内');
      await stage.hover({ position });
      await stage.click({ position });
      await placementHint.waitFor({ state: 'hidden' });
      await page.locator('.ws-counts').filter({ hasText: new RegExp('^' + count + ' 零件') }).waitFor();
    }
  });

  await step('在接口面板连接两根直管', async () => {
    const first = await page.evaluate(() => window.__ws.state.instances[0].pos);
    // Stage the second pipe on the other pipe's axis before joining end faces.
    // Diagonal moves toward a pipe end can be rejected by the existing sweep.
    for (const [axis, value] of [['X', first[0] + 6.5], ['Z', first[2]]]) {
      const input = page.getByLabel(axis + ' 位置（场景单位）');
      await input.fill(String(value));
      await input.press('Tab');
    }
    const tabs = page.locator('.ws-side-tabs');
    await tabs.getByRole('button', { name: '接口连接', exact: true }).click();
    await page.locator('.ws-port-row[data-port="p1"]').getByRole('button', { name: '开始连接', exact: true }).click();
    await page.locator('.ws-cand-row[data-port="p2"]').getByRole('button', { name: '连接', exact: true }).click();
    await tabs.getByRole('button', { name: '选中对象', exact: true }).click();
    await page.locator('.ws-conns h3').filter({ hasText: '连接（1）' }).waitFor();
    await page.locator('.ws-counts').filter({ hasText: /^2 零件 · 1 连接$/ }).waitFor();
  });

  await step('保存工坊方案后刷新并恢复两根直管和一条连接', async () => {
    await page.locator('.ws-top').getByRole('button', { name: '保存', exact: true }).click();
    await page.locator('.ws-toast').filter({ hasText: '方案已保存到本机浏览器' }).waitFor();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.ws-canvas canvas').waitFor();
    await page.locator('.ws-counts').filter({ hasText: /^2 零件 · 1 连接$/ }).waitFor();
  });

  await step('未捕获的页面错误为零', async () => {
    assert.deepEqual(pageErrors, []);
  });
} catch (error) {
  results.push({ name: currentStep, status: 'FAIL', detail: error.message });
  console.error('FAIL  ' + currentStep + '\n' + error.message);
  process.exitCode = 1;
  if (page && !page.isClosed()) {
    try {
      console.error('DIAG', JSON.stringify(await page.evaluate(() => ({
        hash: location.hash,
        canvases: document.querySelectorAll('.canvas-wrap canvas').length,
        scene: Boolean(window.__chem3d?.scene),
        loading: document.querySelector('.loading-overlay')?.style.display ?? null,
        fallback: document.querySelector('.webgl-fallback')?.style.display ?? null,
        appChildren: document.getElementById('app')?.children.length ?? -1
      }))));
    } catch { /* 忽略诊断失败 */ }
    try {
      await page.screenshot({ path: path.join(output, 'failure.png'), timeout: 15000 });
      screenshot = 'failure.png';
    } catch (captureError) {
      screenshotError = captureError.message;
    }
  } else {
    screenshotError = '浏览器尚未打开页面或页面已关闭';
  }
} finally {
  const cleanup = await Promise.allSettled([
    (async () => { await browser?.close(); })(),
    (async () => {
      if (!server?.listening) return;
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    })(),
    (async () => { await vite?.close(); })(),
  ]);
  for (const [index, result] of cleanup.entries()) {
    if (result.status === 'rejected') {
      const name = ['关闭浏览器', '关闭本地测试端口', '停止 Vite 服务'][index];
      const detail = String(result.reason);
      results.push({ name, status: 'FAIL', detail });
      console.error('FAIL  ' + name + '\n' + detail);
      process.exitCode = 1;
    }
  }

  await writeFile(path.join(output, 'report.json'), JSON.stringify({
    base: base ?? null, status: process.exitCode ? 'FAIL' : 'PASS',
    results, pageErrors, screenshot, screenshotError,
  }, null, 2) + '\n', 'utf8');
  console.log('测试结果目录 ' + output);
}
