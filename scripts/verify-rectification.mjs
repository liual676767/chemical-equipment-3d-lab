import { clickBoilEquipment } from './boil-browser-actions.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { browserOptions, webglArgs } from './browser-options.mjs';

const base = process.env.VERIFY_BASE ?? 'http://127.0.0.1:5173/';
const output = resolve('outputs/codex-rectification-20261121/regression');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, args: webglArgs });
const reports = [], errors = [];
let performanceSample = null;
const key = 'chem3d-workshop:v1';
const button = (page, name) => page.getByRole('button', { name, exact: true });
async function visit(page, hash) { await page.goto(new URL('#/' + hash, base).href); }
async function screenshot(page, name) { await page.screenshot({ path: resolve(output, name + '.png'), timeout: 30000 }); }
async function contains(locator, text) {
  await locator.filter({ hasText: text }).first().waitFor({ state: 'visible' });
}
async function hitTarget(element) {
  return element.evaluate(el => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return el.contains(hit);
  });
}
async function check(label, run, options) {
  const page = await browser.newPage(options);
  page.setDefaultTimeout(18000);
  page.on('pageerror', error => errors.push({ label, error: error.message }));
  page.on('console', event => { if (event.type() === 'error') errors.push({ label, error: event.text() }); });
  page.on('response', response => {
    if (response.status() >= 400 && response.url().startsWith(base)) errors.push({ label, error: response.status() + ' ' + response.url() });
  });
  try {
    await run(page);
    reports.push({ label, ok: true });
    console.log('PASS ' + label);
  } catch (error) {
    reports.push({ label, ok: false, error: error.message });
    console.error('FAIL ' + label + ' ' + error.message);
    try { await screenshot(page, 'failure-' + reports.length); } catch {}
  } finally { await page.close(); }
}

try {
  for (const [width, height] of [[390, 844], [768, 1024], [1366, 768], [1920, 1080], [534, 469]]) {
    const touch = width < 1024;
    await check('A / D 工坊放置和取消 ' + width + '×' + height, async page => {
      await visit(page, 'workshop');
      const panel = button(page, '面板'), library = button(page, '零件库');
      if (touch) await panel.tap();
      await button(page, '组装任务').click();
      await page.locator('.ws-task-row').filter({ hasText: '基础课 · 法兰连接装配' }).getByRole('button', { name: '开始', exact: true }).click();
      const add = async keyboard => {
        if (touch) await library.tap();
        const trigger = page.locator('.ws-part[data-part-id=pipe]').getByRole('button', { name: '添加到场景' });
        if (keyboard) await trigger.press('Enter');
        else if (touch) await trigger.tap();
        else await trigger.click();
      };
      await add(false);
      const center = button(page, '在视图中心放置'), cancel = button(page, '取消放置');
      assert(await hitTarget(center));
      assert(await hitTarget(cancel));
      await contains(page.locator('.ws-place-caption'), '基础课 · 法兰连接装配');
      if (width === 534) await screenshot(page, '01-workshop-534x469');
      if (touch) await center.tap(); else await center.click();
      await page.waitForFunction(() => document.querySelector('.ws-place-hint').hidden);
      if (touch) await panel.tap();
      await button(page, '选中对象').click();
      const dimensions = page.locator('.ws-spec-note').filter({ hasText: '内径约' });
      assert.doesNotMatch(await dimensions.innerText(), /mm mm/);
      await add(true);
      assert(await center.evaluate(el => el === document.activeElement));
      await page.keyboard.press('Tab');
      assert(await cancel.evaluate(el => el === document.activeElement));
      await page.keyboard.press('Enter');
      assert(await center.isHidden());
      await add(true);
      await page.keyboard.press('Enter');
      assert(await center.isHidden());
    }, { viewport: { width, height }, hasTouch: touch });
  }

  await check('B / E 调配罐附近实际点击 BV-202，空气与物料分开', async page => {
    await visit(page, '');
    await page.getByRole('button', { name: /^样板任务/ }).click();
    await button(page, '开始任务').click();
    await button(page, '定位当前目标').click();
    await contains(page.locator('.factory-info .fi-name'), '调配罐');
    await page.locator('.factory-task').getByRole('button', { name: '收起', exact: true }).click();
    await page.locator('[data-coating-action="sample"]').click();
    await page.locator('[data-coating-action="release"]').click();
    const collapse = page.locator('.fi-collapse');
    if (await collapse.isVisible()) await collapse.click();
    const valve = page.locator('.factory-label').filter({ hasText: 'BV-202' });
    await valve.waitFor();
    await valve.click({ trial: true });
    assert(await hitTarget(valve));
    await screenshot(page, '02-factory-valve-hit');
    await valve.click();
    await contains(page.locator('.factory-info .fi-tag'), 'BV-202');
    if (await collapse.isVisible() && !await page.locator('.fi-valve-row').isVisible()) await collapse.click();
    await page.locator('.fi-valve-row').getByRole('button', { name: '关闭', exact: true }).click();
    await visit(page, 'pipe/PL-208');
    await contains(page.locator('.factory-flow-status'), '无上游供给');
    await visit(page, 'pipe/PL-211');
    await contains(page.locator('.factory-flow-status'), '可通行');
    await visit(page, 'node/P-202');
    await contains(page.locator('.factory-equipment-status'), '入口无料');
    await screenshot(page, '03-air-without-product');
    await button(page, '关闭泵供气').click();
    await contains(page.locator('.factory-equipment-status'), '供气指令已关闭');
    await button(page, '接通泵供气').click();
    await visit(page, 'node/BV-202');
    await page.locator('.fi-valve-row').getByRole('button', { name: '全开', exact: true }).click();
    await visit(page, 'pipe/PL-208');
    await contains(page.locator('.factory-flow-status'), '可通行');
  }, { viewport: { width: 1440, height: 900 } });

  await check('C / 单设备控制 阀型与 P-103 启停', async page => {
    await visit(page, 'plant');
    await page.waitForFunction(() => !!window.__plant);
    const select = uid => page.evaluate(uid => window.__plant.select(uid), uid);
    await select('GV-101');
    assert.equal(await page.locator('.plant-valve-btn').count(), 2);
    await page.evaluate(() => window.__plant.setValveState('GV-101', 'partial'));
    assert.equal(await page.evaluate(() => window.__plant.valveState('GV-101')), 'open');
    await button(page, 'CLOSED').click();
    await select('CV-101');
    assert.equal(await page.locator('.plant-valve-btn').count(), 0);
    assert.equal(await page.evaluate(() => window.__plant.valveState('CV-101')), 'closed');
    await select('GV-101');
    await button(page, 'OPEN').click();
    await select('T-102');
    await page.locator('[data-scenario="towerGasDemo"]').check();
    await select('BV-102');
    await button(page, 'PARTIAL').click();
    assert.equal(await page.evaluate(() => window.__plant.pipeFlow('PL-111').throttle), true);
    await select('P-103');
    await button(page, '关闭示意供气').click();
    await page.locator('.plant-run-text').click();
    await page.locator('.plant-run-text').click();
    await contains(page.locator('.plant-equipment-status'), '供气指令已关闭');
    assert.equal(await page.evaluate(() => window.__plant.pipeFlow('PL-115').state), 'off');
    await button(page, '接通示意供气').click();
    assert.equal(await page.evaluate(() => window.__plant.pipeFlow('PL-115').state), 'full');
    await screenshot(page, '04-plant-pump-control');
    await select('T-101');
    assert.equal(await page.locator('.plant-equipment-command').count(), 0);
  }, { viewport: { width: 1440, height: 900 } });

  for (const failure of ['corrupt', 'quota', 'denied']) {
    await check('F 工坊手动和自动保存 ' + failure, async page => {
      await page.addInitScript(({ failure, key }) => {
        const read = Storage.prototype.getItem, write = Storage.prototype.setItem;
        if (failure === 'corrupt') write.call(localStorage, key, '{损坏');
        Storage.prototype.getItem = function (name) {
          if (name === key && failure === 'denied') throw new DOMException('Blocked', 'SecurityError');
          return read.call(this, name);
        };
        Storage.prototype.setItem = function (name, value) {
          if (name === key && failure === 'quota') throw new DOMException('Full', 'QuotaExceededError');
          return write.call(this, name, value);
        };
      }, { failure, key });
      await visit(page, 'workshop');
      await contains(page.locator('.ws-save-note'), '未保存');
      await page.locator('.ws-part[data-part-id=pipe]').getByRole('button', { name: '添加到场景' }).click();
      await button(page, '在视图中心放置').click();
      await page.waitForTimeout(1150);
      await contains(page.locator('.ws-save-note'), '未保存');
      await button(page, '保存').click();
      await contains(page.locator('.ws-toast-err'), '保存失败');
      assert.equal(await page.locator('.ws-toast-ok').filter({ hasText: '方案已保存到本机浏览器' }).count(), 0);
      if (failure === 'corrupt') {
        assert.equal(await page.evaluate(key => localStorage.getItem(key), key), '{损坏');
        await screenshot(page, '05-workshop-save-failure');
      }
    }, { viewport: { width: 1366, height: 768 } });
  }

  await check('喷烧引风机独立示踪和待确认提示', async page => {
    await visit(page, 'boil');
    await clickBoilEquipment(page, 'eq-id-fan');
    await contains(page.locator('.boil-detail'), '现场操作规程');
    const fanFlow = () => page.evaluate(() => window.__boil.fluidStats().perRun.find(run => run.pipelineId === 'pipe-gas-09')?.flowState);
    await button(page, '停止引风机示踪').click();
    await contains(page.locator('.boil-detail'), '示踪已停止');
    assert.equal(await fanFlow(), 'off');
    await page.waitForTimeout(1000);
    await screenshot(page, '06-boil-fan');
    await button(page, '启动引风机示踪').click();
    await contains(page.locator('.boil-detail'), '烟气路径示踪开启');
    assert.equal(await fanFlow(), 'full');
  }, { viewport: { width: 1440, height: 900 } });
  if (process.env.RECTIFY_SOAK === '1') {
    await check('工坊 100 实例连续操作', async page => {
      await visit(page, 'workshop');
      await page.waitForFunction(() => Boolean(window.__ws));
      const readScene = () => page.evaluate(() => {
        const { renderer } = window.__ws.engine;
        return { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
          draws: renderer.info.render.calls, triangles: renderer.info.render.triangles };
      });
      await page.evaluate(() => {
        const { addInstanceAt, engine } = window.__ws;
        const types = ['pipe', 'elbow90', 'valve-ball', 'P041', 'instr-magflow'];
        for (let i = 0; i < 100; i++) addInstanceAt(types[i % types.length], [(i % 10) * 4, 0, Math.floor(i / 10) * 4]);
        engine.fitAll();
      });
      await page.waitForTimeout(800);
      const before = await readScene();
      await page.evaluate(() => {
        const start = performance.now();
        const samples = [];
        let prior = start;
        window.rectificationSample = new Promise(resolve => {
          function frame(now) {
            samples.push(now - prior);
            prior = now;
            if (now - start < 60000) requestAnimationFrame(frame);
            else resolve({ samples, elapsed: now - start });
          }
          requestAnimationFrame(frame);
        });
      });
      for (let i = 0; i < 12; i++) {
        await button(page, i % 2 === 0 ? '高画质' : '流畅').click();
        await button(page, '适配视图').click();
        await page.waitForTimeout(4800);
      }
      const { samples, elapsed } = await page.evaluate(() => window.rectificationSample);
      const after = await readScene();
      const sorted = samples.toSorted((a, b) => a - b);
      performanceSample = { elapsedMs: elapsed, frames: samples.length, fps: samples.length * 1000 / elapsed,
        p95FrameMs: sorted[Math.floor(sorted.length * 0.95)], maxFrameMs: sorted.at(-1), before, after };
      const snapshot = () => page.evaluate(() => window.__ws.state.instances.map(({ uid, partId, pos, rot }) => ({ uid, partId, pos, rot })));
      const saved = await snapshot();
      assert.equal(saved.length, 100);
      await button(page, '保存').click();
      await page.reload();
      await page.waitForFunction(() => Boolean(window.__ws));
      assert.deepEqual(await snapshot(), saved);
    }, { viewport: { width: 1366, height: 768 } });
  }
} finally {
  await browser.close();
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ base, reports, errors, performanceSample }, null, 2));
}
process.exitCode = reports.some(report => !report.ok) || errors.length ? 1 : 0;
