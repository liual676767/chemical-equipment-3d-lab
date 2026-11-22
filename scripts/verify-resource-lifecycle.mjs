import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';

const base = process.env.VERIFY_BASE ?? 'http://127.0.0.1:48120/';
const browser = await chromium.launch({ ...browserOptions, headless: true, args: ['--enable-gpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(() => {
    const handlers = new Map([['keydown', new Set()], ['keyup', new Set()]]);
    for (const action of ['addEventListener', 'removeEventListener']) {
      const original = document[action].bind(document);
      document[action] = function (type, handler, options) {
        const captured = options === true || options?.capture === true;
        if (captured && handler && handlers.has(type)) {
          const recorded = handlers.get(type);
          if (action === 'addEventListener') recorded.add(handler);
          else recorded.delete(handler);
        }
        return original(type, handler, options);
      };
    }
    window.__documentKeyListeners = () => Object.fromEntries([...handlers].map(([type, set]) => [type, set.size]));
  });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(base + '#/library');
  await page.locator('.device-card').first().waitFor();
  const counts = () => page.evaluate(() => window.__documentKeyListeners());
  const initial = await counts();
  for (const [hash, canvas] of [
    ['#/plant', '.plant-canvas'], ['#/', '.factory-stage canvas'], ['#/boil', '.boil-stage canvas'],
    ['#/boil/equipment/eq-baghouse', '.boil-inspection canvas'], ['#/assets', '.assets-page canvas'],
    ['#/workshop', '.ws-canvas'], ['#/device/pump', '.workbench canvas']
  ]) {
    await page.evaluate(value => { location.hash = value; }, hash);
    await page.locator(canvas).first().waitFor();
    assert.ok((await counts()).keydown > initial.keydown, 'Expected an active camera on ' + hash);
    await page.keyboard.down('Control');
    await page.waitForFunction(expected => window.__documentKeyListeners().keyup > expected, initial.keyup);
    await page.evaluate(() => { location.hash = '#/library'; });
    await page.locator('.device-card').first().waitFor();
    assert.deepEqual(await counts(), initial, 'Document listeners remain after leaving ' + hash);
    await page.keyboard.up('Control');
    console.log('PASS ' + hash + ' removes captured key listeners on exit');
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
