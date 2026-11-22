import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserOptions, webglArgs } from './browser-options.mjs';

const base = process.env.VERIFY_BASE ?? 'http://127.0.0.1:48118/';
const browser = await chromium.launch({ ...browserOptions, headless: true, args: webglArgs });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  await page.goto(base + '#/device/pump');
  await page.locator('.mode-tab').filter({ hasText: '拆装练习' }).click();
  await page.locator('.practice-mode-switch').getByRole('button', { name: '自由练习', exact: true }).click();
  const coupling = page.locator('.tree-item').filter({ hasText: '半联轴器（泵侧）' });
  await page.locator('[data-action=parts]').click();
  await coupling.click();
  await page.getByRole('button', { name: '拆下选中零件', exact: true }).click();
  await page.waitForFunction(() => {
    const part = window.__chem3d.scene.parts.get('coupling');
    return part.state === 'tray' && part.group.position.distanceTo(part.trayPos) < 1e-4;
  });
  await coupling.click();
  await page.locator('.left-panel .panel-collapse').click();
  await page.waitForTimeout(750);
  const state = () => page.evaluate(() => {
    const scene = window.__chem3d.scene;
    const part = scene.parts.get('coupling');
    return { state: part.state, position: part.group.position.toArray(), dragging: scene.dragging, capture: scene.dragPointer,
      history: scene.history.length, controls: scene.controls.enabled };
  });
  const initial = await state();
  const center = await page.evaluate(() => {
    const scene = window.__chem3d.scene;
    const part = scene.parts.get('coupling');
    const canvas = scene.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const point = part.group.position.clone().project(scene.camera);
    const centerX = rect.left + rect.width * (point.x + 1) / 2;
    const centerY = rect.top + rect.height * (1 - point.y) / 2;
    for (const dx of [0, 8, -8, 16, -16, 24]) for (const dy of [0, 8, -8, 16, -16, 24]) {
      const x = centerX + dx, y = centerY + dy;
      if (document.elementFromPoint(x, y) === canvas && scene.pick({ clientX: x, clientY: y }) === 'coupling') {
        return [x, y];
      }
    }
    return null;
  });
  assert.ok(center, 'The exposed tray part can be picked in the canvas');
  const [x, y] = center;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, a, b) => cdp.send('Input.dispatchTouchEvent', { type,
    touchPoints: a === undefined ? [] : [{ x: a, y: b, id: 1 }] });
  await touch('touchStart', x, y);
  await touch('touchMove', x + 54, y - 22);
  assert.equal((await state()).dragging, true);
  await touch('touchCancel');
  assert.deepEqual(await state(), initial);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 45, y - 40, { steps: 3 });
  assert.equal((await state()).dragging, true);
  await page.mouse.move(-10, y);
  await page.mouse.up();
  assert.deepEqual(await state(), initial);
  console.log('PASS: workbench tray pickup, captured touch cancel, outside release, pose and history rollback');
} finally {
  await browser.close();
}
