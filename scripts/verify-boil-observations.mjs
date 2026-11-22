import { clickBoilEquipment } from './boil-browser-actions.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { browserOptions, webglArgs } from './browser-options.mjs';

const server = await createServer({ server: { middlewareMode: true }, cacheDir: 'node_modules/.vite-boil-observation' });
try {
  const { BOIL_PROCESS } = await server.ssrLoadModule('/src/data/boilProcess.ts');
  const { BOIL_ORDER_CHECK, BOIL_OBSERVATIONS } = await server.ssrLoadModule('/src/data/boilObservation.ts');
  const { BOIL_INTERNALS } = await server.ssrLoadModule('/src/data/boilInternals.ts');
  assert.equal(BOIL_PROCESS.gaps.length, 17);
  const relation = BOIL_PROCESS.pipelines.find(pipe => pipe.id === BOIL_ORDER_CHECK.pipeline);
  assert.equal(relation.from.equipment, BOIL_ORDER_CHECK.equipment[0]);
  assert.equal(relation.to.equipment, BOIL_ORDER_CHECK.equipment[1]);
  for (const id of Object.keys(BOIL_OBSERVATIONS)) {
    const equipment = BOIL_PROCESS.equipment.find(equipment => equipment.id === id);
    assert.ok(BOIL_INTERNALS[equipment.modelKey].parts.some(part => part.id === BOIL_OBSERVATIONS[id].inspect.partId));
    assert.equal(BOIL_OBSERVATIONS[id].outputs.length, 2);
  }
  assert.ok(!BOIL_PROCESS.pipelines.some(pipe => /spray-gun/.test(pipe.from.equipment + pipe.to.equipment)));
  console.log('PASS: original 17 unresolved gaps, verified educational references, preserved relation and spray-gun isolation');
} finally {
  await server.close();
}

const base = process.env.VERIFY_BASE ?? 'http://127.0.0.1:48118/';
const browser = await chromium.launch({ ...browserOptions, headless: true, args: webglArgs });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(base + '#/boil');
  const select = id => clickBoilEquipment(page, id);
  const quiz = page.locator('.boil-observation-check');
  const status = quiz.locator('[role=status]');
  for (const [id, index, text] of [
    ['eq-baghouse', 0, /灰斗/], ['eq-wash-tower', 1, /液路/], ['eq-wet-esp', 2, /冲洗/]
  ]) {
    await select(id);
    const choices = quiz.getByRole('button');
    await choices.nth((index + 1) % 3).click();
    assert.match(await status.textContent(), /重新选择/);
    await choices.nth(index).click();
    assert.match(await status.textContent(), text);
    assert.match(await page.locator('.boil-observation-source').getAttribute('href'), /^https:/);
  }
  await select('eq-secondary-chamber');
  assert.match(await page.locator('.boil-detail-body').textContent(), /典型例子采用回转窑至二次燃烧室/);
  assert.equal(await quiz.count(), 0);
  await select('eq-spray-gun-01');
  assert.equal(await quiz.count(), 0);
  assert.match(await page.locator('.boil-detail-body').textContent(), /待现场资料确认/);
  await select('eq-baghouse');
  await page.getByRole('button', { name: '查看灰斗' }).click();
  const dialog = page.getByRole('dialog', { name: '布袋除尘器结构观察' });
  assert.equal(await dialog.getByRole('combobox', { name: '查找教学部件' }).inputValue(), 'hopper');
  assert.match(await dialog.locator('.boil-inspection-information > p').textContent(), /灰斗/);
  await dialog.getByRole('button', { name: '返回流程' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.ok(await page.getByRole('button', { name: '查看灰斗' }).evaluate(node => node === document.activeElement));
  await select('eq-secondary-chamber');
  await page.locator('.boil-detail-body').getByRole('button', { name: /^pipe-gas-01 ·/ }).first().click();
  assert.match(await page.locator('.boil-detail-body').textContent(), /烟气顺序待核/);
  assert.match(await page.locator('[data-pipeline="pipe-gas-01"] > title').textContent(), /顺序待现场核对/);
  assert.deepEqual(errors, []);
  console.log('PASS: actual equipment rows, three observation questions, physical part focus and return, pipeline and map conflict, unresolved spray-gun boundary');
} finally {
  await browser.close();
}
