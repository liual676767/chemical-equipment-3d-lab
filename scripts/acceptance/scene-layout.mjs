import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser-options.mjs';
import { clickBoilEquipment, showBoilTree } from '../boil-browser-actions.mjs';

const base = process.env.VERIFY_BASE ?? 'http://127.0.0.1:48118/';
const output = process.env.LAYOUT_REPORT_DIR ?? 'outputs/verify-p5/layout';
mkdirSync(output, { recursive: true });
const viewports = [[1440,900], [1280,720], [768,1024], [390,844], [360,800], [534,469]];
const scenes = [
  ['factory', '#/', '.factory-stage canvas'],
  ['plant', '#/plant', '.plant-canvas'],
  ['boil', '#/boil', '.boil-canvas']
];
const browser = await chromium.launch({ ...browserOptions, headless: true, args: ['--enable-gpu'] });
const report = [];
const errors = [];

try {
  for (const [width,height] of viewports) {
    const page = await browser.newPage({ viewport: { width,height }, deviceScaleFactor: 1 });
    page.on('pageerror', error => errors.push(String(error)));
    for (const [name, route, selector] of scenes) {
      await page.goto(base + route);
      const canvas = page.locator(selector).first();
      await canvas.waitFor();
      await page.waitForTimeout(450);
      const sample = await canvas.evaluate(element => {
        const box = element.getBoundingClientRect();
        const left = Math.max(0, box.left), top = Math.max(0, box.top);
        const width = Math.min(innerWidth, box.right) - left;
        const height = Math.min(innerHeight, box.bottom) - top;
        let clear = 0;
        const covering = {};
        const steps = 48;
        for (let i = 0; i < steps; i++) for (let j = 0; j < steps; j++) {
          const hit = document.elementFromPoint(left + (i + 0.5) * width / steps, top + (j + 0.5) * height / steps);
          if (hit === element || hit?.closest('.plant-label,.factory-label')) clear++;
          else {
            const node = hit?.closest('aside,header,nav,section,[role=dialog]') ?? hit;
            const label = node?.className?.toString() ?? '(outside)';
            covering[label] = (covering[label] ?? 0) + 1;
          }
        }
        const unobstructed = clear / (steps * steps);
        return { unobstructed, viewportClear: unobstructed * width * height / (innerWidth * innerHeight),
          covering, width, height, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      report.push({ name, viewport: [width,height], ...sample });
      await page.screenshot({ path: output + '/' + name + '-' + width + 'x' + height + '.png' });
      console.log(name, width, height, (sample.viewportClear * 100).toFixed(1) + '% of viewport', sample.overflow ? 'overflow' : '');
    }
    if (width === 390) {
      await clickBoilEquipment(page,'eq-baghouse');
      assert.equal(await page.locator('.boil-panel').isVisible(), false);
      assert.equal(await page.locator('.boil-detail').isVisible(), true);
      await showBoilTree(page);
      assert.equal(await page.locator('.boil-detail').isVisible(), false);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.boil-panel').isVisible(), false);
      assert.equal(await page.locator('.boil-panel-toggle').evaluate(element => element === document.activeElement), true);
    }
    await page.close();
  }
  writeFileSync(output + '/report.json', JSON.stringify({ report, errors }, null, 2));
  assert.deepEqual(errors, []);
  assert.ok(report.every(item => !item.overflow), 'A scene overflows horizontally');
  const missed = report.filter(item => item.viewportClear < (item.viewport[0] >= 1280 ? 0.70 : 0.60));
  assert.deepEqual(missed.map(({ name, viewport, viewportClear }) => ({ name, viewport, viewportClear })), []);
} finally {
  await browser.close();
}
