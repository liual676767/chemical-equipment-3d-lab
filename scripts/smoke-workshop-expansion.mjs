import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserOptions, webglArgs } from './browser-options.mjs';

const base = process.env.SMOKE_BASE ?? 'http://127.0.0.1:4188/';
const browser = await chromium.launch({ ...browserOptions, args: webglArgs });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const key = 'chem3d-workshop:v1';
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, JSON.stringify({
      schema: 1, lastPlanId: 'old-example',
      plans: [{
        id: 'old-example', name: '旧版工坊方案', createdAt: 1, updatedAt: 1, contentVersion: '2026-11-16.1',
        state: {
          instances: [
            { uid: 'old-pipe', partId: 'pipe', pos: [0, 2, 0], rot: [0, 0, 0], spec: { dn: 50, length: 500, endType: 'weld' } },
            { uid: 'old-elbow', partId: 'elbow90', pos: [2.5, 2, 0], rot: [0, 0, 0], spec: { dn: 50, endType: 'weld' } }
          ],
          connections: [{ id: 'old-edge', kind: 'weld', a: { uid: 'old-pipe', port: 'p2' }, b: { uid: 'old-elbow', port: 'p1' } }],
          groups: []
        }, taskProgress: {}
      }]
    }));
  });
  await page.goto(new URL('#/workshop', base).href);
  assert.equal(await page.getByLabel('方案名称').inputValue(), '旧版工坊方案');
  for (const code of ['P053', 'P059']) {
    await page.getByRole('searchbox', { name: '搜索零件' }).fill(code);
    await page.getByRole('button', { name: '添加到场景', exact: true }).click();
    await page.getByRole('button', { name: '在视图中心放置' }).click();
  }
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const readPlan = () => page.evaluate(() => JSON.parse(localStorage.getItem('chem3d-workshop:v1')).plans[0]);
  const plan = await readPlan();
  const well = plan.state.instances.find(item => item.partId === 'instr-thermowell');
  const sensor = plan.state.instances.find(item => item.partId === 'instr-thermocouple');
  assert(well && sensor);
  await page.getByRole('button', { name: '接口连接', exact: true }).click();
  await page.getByLabel('选择场景零件').selectOption(well.uid);
  await page.locator('.ws-port-row[data-port="probe"]').getByRole('button', { name: '开始连接' }).click();
  await page.locator(`.ws-cand-row[data-uid="${sensor.uid}"][data-port="well"]`).getByRole('button', { name: '连接', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.reload();
  assert.equal(await page.getByLabel('方案名称').inputValue(), '旧版工坊方案');
  const restored = await readPlan();
  assert.equal(restored.state.instances.length, 4);
  assert.equal(restored.state.connections.length, 2);
  assert.equal(restored.state.connections[1].kind, 'mechanical');
  assert.deepEqual(errors, []);
  console.log('PASS production UI restored an old weld and a new thermowell–thermocouple assembly in the same legacy plan.');
} finally {
  await browser.close();
}
