import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';

const base = process.env.VERIFY_BASE ?? 'http://127.0.0.1:48118/';
const output = 'outputs/verify-p5';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true, args: ['--enable-gpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(base + '#/device/pump');
  await page.locator('.mode-tab').filter({ hasText: '拆装练习' }).click();
  const launcher = page.getByRole('button', { name: '轴与轴套装配', exact: true });
  await launcher.click();
  const dialog = page.getByRole('dialog', { name: '离心泵轴与轴套装配' });
  const assist = dialog.getByRole('button', { name: '沿轴线安装' });
  const status = dialog.getByRole('status');
  const canvas = dialog.locator('canvas');
  await canvas.waitFor();
  await page.waitForTimeout(500);
  const box = await canvas.boundingBox();
  assert.ok(box);
  const start = [box.x + box.width * 0.56, box.y + box.height * 0.526];
  await page.screenshot({ path: output + '/pump-fit-initial.png' });
  await page.mouse.move(...start);
  await page.mouse.down();
  for (let delta = 12; delta <= 300; delta += 5) {
    await page.mouse.move(start[0] - delta, start[1] - delta * 0.27);
    if ((await status.textContent()).includes('松手安装')) break;
  }
  assert.match(await status.textContent(), /已对准轴套止口/);
  assert.equal(await assist.isDisabled(), false, 'The green target is a preview');
  await page.screenshot({ path: output + '/pump-fit-preview.png' });
  await page.mouse.up();
  assert.equal(await assist.isDisabled(), true);
  assert.match(await status.textContent(), /沿同轴路径装入/);
  await page.screenshot({ path: output + '/pump-fit-installed.png' });

  await dialog.getByRole('button', { name: '重置配合' }).click();
  await page.waitForTimeout(350);
  await page.mouse.move(...start);
  await page.mouse.down();
  await page.mouse.move(start[0] - 300, start[1] - 85);
  assert.match(await status.textContent(), /停止移动/);
  await page.mouse.up();
  assert.equal(await assist.isDisabled(), false);
  await assist.click();
  assert.equal(await assist.isDisabled(), true);

  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await launcher.evaluate(button => button === document.activeElement), true);
  assert.equal(new URL(page.url()).hash, '#/device/pump');
  assert.deepEqual(errors, []);
  console.log('PASS: same-workbench shaft preview, axial drag, shoulder sweep stop, assisted fit and return');
} finally {
  await browser.close();
}
