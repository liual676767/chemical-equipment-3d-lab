import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { browserOptions, webglArgs } from './browser-options.mjs';

const server = await createServer({ server: { middlewareMode: true }, cacheDir: 'node_modules/.vite-plant-conditions' });
try {
  const { plantFlow, DEFAULT_PLANT_SCENARIO, PIPELINES, MEDIA } = await server.ssrLoadModule('/src/data/plant.ts');
  const initial = { ...DEFAULT_PLANT_SCENARIO };
  const read = (id, scenario = initial, excluded = []) => plantFlow(() => 'open', uid => !excluded.includes(uid), scenario).flows.get(id);
  assert.equal(read('PL-107').state, 'full');
  assert.equal(read('PL-108').state, 'off');
  assert.equal(read('PL-114').state, 'full');
  assert.equal(read('PL-114', { ...initial, recoveryAir: false }).state, 'full');
  assert.equal(read('PL-115', { ...initial, recoveryAir: false }).state, 'off');
  assert.equal(read('PL-119', { ...initial, recoveryAir: false }).state, 'full');
  assert.equal(read('PL-102', initial, ['P-101']).state, 'off');
  assert.equal(read('PL-101', { ...initial, feedAvailable: false }).state, 'off');
  assert.equal(read('PL-108', { ...initial, feedAvailable: false, towerGasDemo: true }).state, 'full');
  assert.equal(read('PL-110', { ...initial, towerGasDemo: true }).state, 'full');
  assert.equal(read('PL-110', { ...initial, towerGasDemo: true, condenserWater: false }).state, 'off');
  const noPreheat = { ...initial, preheatMedium: false };
  assert.equal(read('PL-103', noPreheat).state, 'full');
  for (const line of ['PL-116', 'PL-116R']) assert.equal(read(line, noPreheat).state, 'off');
  const noCooling = { ...initial, coolingWater: false };
  assert.equal(read('PL-107', noCooling).state, 'full');
  for (const line of ['PL-117', 'PL-117R']) assert.equal(read(line, noCooling).state, 'off');
  const line = id => PIPELINES.find(pipe => pipe.id === id);
  for (const [id, device, port] of [
    ['PL-116', 'E-101', 'heatIn'], ['PL-117', 'E-102', 'tubeIn'], ['PL-118', 'E-103', 'tubeIn']
  ]) {
    assert.deepEqual(line(id).to, { type: 'port', node: device, port });
    assert.equal(MEDIA[line(id).medium].phase, 'utility');
  }
  assert.deepEqual(line('PL-108').from, { type: 'port', node: 'T-102', port: 'overhead' });
  assert.equal(MEDIA[line('PL-108').medium].phase, 'gas');
  console.log('PASS: process and utility phases and ports, isolated tower source, thermal utility loss, empty source and independent drive');
} finally {
  await server.close();
}

const base = process.env.VERIFY_BASE ?? 'http://127.0.0.1:48118/';
const browser = await chromium.launch({ ...browserOptions, headless: true, args: webglArgs });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const flow = id => page.evaluate(pipe => window.__plant.pipeFlow(pipe), id);
  async function select(step, uid) {
    const item = page.locator('.plant-step[data-step="' + step + '"]');
    await item.locator('.plant-step-head').click();
    await item.locator('.plant-chip').filter({ hasText: uid }).click();
    assert.equal(await page.evaluate(() => window.__plant.selected), uid);
  }

  await page.goto(base + '#/plant');
  await page.locator('.plant-run').click();
  assert.equal((await flow('PL-108')).state, 'off');
  await page.waitForFunction(() => window.__plant.debug().towerTracers?.heights.some(y => y > 1));
  const tracers = () => page.evaluate(() => window.__plant.debug().towerTracers);
  const beforeTrace = await tracers();
  await page.waitForTimeout(250);
  const afterTrace = await tracers();
  assert.equal(beforeTrace.visible, true);
  assert.ok(beforeTrace.heights.some((height, index) =>
    height > 0.8 && height < 1.8 && afterTrace.heights[index] < height));
  assert.ok(beforeTrace.heights.every((height, index) =>
    height < 0.8 || afterTrace.heights[index] <= height));
  const map = page.getByRole('button', { name: '流程图', exact: true });
  await map.click();
  assert.equal(await page.locator('.plant-map-route[data-pipe="PL-108"]').getAttribute('data-flow'), 'off');
  await map.click();
  await select('preheat', 'E-101');
  await page.locator('[data-scenario="preheatMedium"]').uncheck();
  assert.equal((await flow('PL-103')).state, 'full');
  assert.equal((await flow('PL-116R')).state, 'off');
  await select('cooling', 'E-102');
  await page.locator('[data-scenario="coolingWater"]').uncheck();
  assert.equal((await flow('PL-107')).state, 'full');
  assert.equal((await flow('PL-117R')).state, 'off');
  await select('separation', 'T-102');
  await page.locator('[data-scenario="towerGasDemo"]').check();
  assert.equal((await flow('PL-108')).state, 'full');
  await map.click();
  const towerRoute = page.getByRole('button', { name: 'PL-108 塔顶气相管线 · 通路可用', exact: true });
  assert.equal(await page.locator('.plant-map-route[data-pipe="PL-108"]').getAttribute('data-flow'), 'full');
  await towerRoute.focus();
  await towerRoute.press('Enter');
  await page.locator('.plant-path-condition').waitFor();
  assert.equal(await page.locator('.plant-path-condition').textContent(), '通路可用');
  assert.equal((await flow('PL-110')).state, 'full');
  await select('overhead', 'E-103');
  await page.locator('[data-scenario="condenserWater"]').uncheck();
  assert.equal((await flow('PL-108')).state, 'full');
  assert.equal((await flow('PL-118')).state, 'off');
  assert.equal((await flow('PL-110')).state, 'off');
  await select('utility', 'P-103');
  await page.locator('[data-scenario="recoveryAir"]').uncheck();
  assert.equal((await flow('PL-114')).state, 'full');
  assert.equal((await flow('PL-115')).state, 'off');
  assert.equal((await flow('PL-119')).state, 'full');
  await select('storage', 'T-101');
  await page.locator('[data-scenario="feedAvailable"]').uncheck();
  assert.equal((await flow('PL-101')).state, 'off');
  assert.equal((await flow('PL-108')).state, 'full');
  assert.equal((await tracers()).visible, false);
  assert.deepEqual(errors, []);
  console.log('PASS: real directory and scenario controls exercise all six conditions and map synchronization');
} finally {
  await browser.close();
}
