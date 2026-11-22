import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { browserOptions, webglArgs } from './browser-options.mjs';

const base = process.env.VERIFY_BASE ?? 'http://127.0.0.1:48118/';
const output = 'outputs/verify-p3';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true, args: webglArgs });
const report = [];

async function hit(locator) {
  return locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { rect: [rect.x, rect.y, rect.width, rect.height], direct: element.contains(target) };
  });
}

try {
  const page = await browser.newPage({ viewport: { width: 534, height: 469 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(base + '#/plant');
  const label = page.locator('.plant-label').filter({ hasText: 'GV-101' });
  await label.waitFor();
  await page.screenshot({ path: output + '/gv101-label-534x469.png' });
  const labelHit = await hit(label);
  assert.equal(labelHit.direct, true, 'The GV-101 3D label receives the pointer');
  await label.click();
  assert.equal(await page.evaluate(() => window.__plant.selected), 'GV-101');
  assert.equal(await page.evaluate(() => window.__plant.isRunning()), false);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.plant-card').isVisible(), false);

  await page.locator('.plant-steps-toggle').click();
  const step = page.locator('.plant-step[data-step=storage]');
  await step.locator('.plant-step-head').click();
  const row = step.locator('.plant-chip').filter({ hasText: 'GV-101' });
  await row.scrollIntoViewIfNeeded();
  const rowHit = await hit(row);
  assert.equal(rowHit.direct, true, 'The GV-101 directory item receives the pointer');
  await page.screenshot({ path: output + '/gv101-directory-534x469.png' });
  await row.click();
  assert.equal(await page.locator('.plant-steps').isVisible(), false);
  assert.equal(await page.evaluate(() => window.__plant.selected), 'GV-101');

  const link = page.locator('.plant-card-actions a');
  await link.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  const original = await page.evaluate(() => window.__plant.debug());
  await link.click();
  await page.locator('.workbench').waitFor();
  await page.locator('.back-btn').click();
  await page.locator('.plant-card').waitFor();
  const returned = await page.evaluate(() => window.__plant.debug());
  const positionError = Math.hypot(...original.pos.map((value, index) => returned.pos[index] - value));
  const targetError = Math.hypot(...original.target.map((value, index) => returned.target[index] - value));
  assert.equal(returned.selected, 'GV-101');
  assert.ok(positionError < 0.001 && targetError < 0.001, JSON.stringify({ positionError, targetError }));
  assert.equal(await page.evaluate(() => window.__plant.isRunning()), false);
  await page.goForward();
  await page.locator('.workbench').waitFor();
  await page.goBack();
  await page.locator('.plant-card').waitFor();
  assert.equal(await page.evaluate(() => window.__plant.selected), 'GV-101');
  report.push({ labelHit, rowHit, positionError, targetError });

  await page.keyboard.press('Escape');
  for (const [width, height] of [[1440,900],[1280,720],[768,1024],[390,844],[360,800],[534,469]]) {
    await page.setViewportSize({ width, height });
    const toolbar = await page.locator('.plant-topbar').evaluate(top => ({
      overflows: top.scrollWidth > window.innerWidth,
      interactive: [...top.querySelectorAll('button,summary')].filter(element => element.checkVisibility()).length
    }));
    assert.equal(toolbar.overflows, false, 'Toolbar overflows at ' + width);
    assert.ok(toolbar.interactive > 0);
    report.push({ width, height, ...toolbar });
  }
  assert.deepEqual(errors, []);
  writeFileSync(output + '/plant-navigation.json', JSON.stringify(report, null, 2));
  console.log('PASS: GV-101 label and directory click, Escape, return and forward/back, six viewport widths');
} finally {
  await browser.close();
}
