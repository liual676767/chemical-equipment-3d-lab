import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';

const base = process.env.VERIFY_BASE ?? 'http://127.0.0.1:48118/';
const out = 'outputs/verify-unified-pump';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  ...browserOptions, headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(base + '#/detail/P-201');
  await page.getByRole('link', { name: '进入零件工作台' }).waitFor();
  await page.waitForTimeout(750);
  const source = await page.evaluate(() => window.__factoryDebug.view());
  assert.equal(source.selected, 'P-201');
  await page.getByRole('link', { name: '进入零件工作台' }).click();
  await page.waitForFunction(() => window.__chem3d?.device.id === 'pump');
  assert.equal(new URL(page.url()).hash, '#/device/pump');
  const camera = () => page.evaluate(() => {
    const scene = window.__chem3d.scene;
    return { position: scene.camera.position.toArray(), target: scene.controls.target.toArray(), selected: scene.selected };
  });
  const viewVector = (actual, expected) => assert.ok(actual.every((value, index) => Math.abs(value - expected[index]) < 1e-8), JSON.stringify({ actual, expected }));
  const sameView = (actual, expected) => {
    viewVector(actual.position, expected.position);
    viewVector(actual.target, expected.target);
    assert.equal(actual.selected, expected.selected);
  };
  await page.locator('[data-action=parts]').click();
  await page.locator('.tree-item').filter({ hasText: '叶轮' }).first().click();
  await page.locator('.left-panel .panel-collapse').click();
  await page.waitForTimeout(620);
  const zoom = page.locator('.canvas-wrap canvas');
  await zoom.hover({ position: { x: 300, y: 220 } });
  await page.mouse.wheel(0, -170);
  await page.waitForTimeout(750);
  const closeView = await camera();
  assert.equal(closeView.selected, 'impeller');
  await page.screenshot({ path: out + '/01-pump-overview.png' });
  const exterior = page.getByRole('button', { name: '近看外观', exact: true });
  await exterior.click();
  assert.equal(await exterior.getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: out + '/02-pump-exterior.png' });
  sameView(await camera(), closeView);
  await page.getByRole('button', { name: '剖视', exact: true }).click();
  await page.screenshot({ path: out + '/03-pump-section.png' });
  sameView(await camera(), closeView);
  await page.getByRole('button', { name: '工作原理', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.mode-tab[aria-pressed=true]')?.textContent.includes('工作原理'));
  await page.waitForTimeout(650);
  await page.screenshot({ path: out + '/04-pump-principle.png' });
  await page.getByRole('button', { name: '内窥', exact: true }).click();
  await page.getByRole('button', { name: '退出内窥 · 恢复外部视角' }).click();
  sameView(await camera(), closeView);
  await page.getByRole('button', { name: '拆装练习', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '拆装练习', exact: true }).getAttribute('aria-pressed'), 'true');
  const after = await camera();
  viewVector(after.position, closeView.position);
  viewVector(after.target, closeView.target);
  await page.screenshot({ path: out + '/05-pump-practice.png' });
  await page.getByRole('button', { name: '返回来源场景' }).click();
  await page.getByRole('link', { name: '进入零件工作台' }).waitFor();
  const returned = await page.evaluate(() => window.__factoryDebug.view());
  assert.equal(returned.selected, source.selected);
  viewVector(returned.pos, source.pos);
  viewVector(returned.target, source.target);
  await page.goForward();
  await page.getByRole('button', { name: '返回来源场景' }).waitFor();
  await page.goBack();
  await page.getByRole('link', { name: '进入零件工作台' }).waitFor();
  assert.equal(new URL(page.url()).hash, '#/detail/P-201');
  assert.deepEqual(pageErrors, []);
  await writeFile(out + '/report.json', JSON.stringify({ source, returned, closeView, after, pageErrors }, null, 2));
  console.log('PASS: six views share one pump route, camera stays in place and factory camera is restored');
} finally {
  await browser.close();
}
