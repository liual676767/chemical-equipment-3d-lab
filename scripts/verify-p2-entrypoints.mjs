import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { browserOptions, webglArgs } from './browser-options.mjs';

const base = process.env.VERIFY_BASE ?? 'http://127.0.0.1:48123/';
const output = 'outputs/verify-p2';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true, args: webglArgs });
const results = {};

try {
  for (const action of ['numeric', 'rotate']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(base + '#/workshop');
      await page.waitForFunction(() => window.__ws?.engine.renderer.domElement.width > 0);
      await page.evaluate(action => {
        const ws = window.__ws;
        ws.seedInstanceAt('bolt', action === 'rotate' ? [1.35, 1.35, 0.28] : [0, 0.28, 0], { dn: 12 });
        ws.seedInstanceAt('pipe', action === 'rotate' ? [0, 0, 0] : [-8, 0, 0], { dn: 50, length: 500 });
        ws.state.instances[0].hidden = true;
        ws.engine.setState(ws.state);
        ws.engine.fitAll();
      }, action);
      const state = () => page.evaluate(() => structuredClone(window.__ws.state));
      const before = await state();
      if (action === 'numeric') {
        const input = page.getByLabel('X 位置（场景单位）');
        await input.fill('8');
        await input.press('Tab');
      } else {
        await page.getByRole('button', { name: 'Z +90°', exact: true }).click();
      }
      assert.deepEqual(await state(), before, 'Rejected action must preserve positions and graph');
      const notices = await page.locator('.ws-toast').allTextContents();
      const message = notices.find(text => /路径.*螺栓.*阻挡/.test(text));
      assert.ok(message, action + ': ' + JSON.stringify(notices));
      results[action] = { message, pose: before.instances[1] };
      await page.screenshot({ path: output + '/blocked-' + action + '.png' });
    } finally {
      await page.close();
    }
  }
  await writeFile(output + '/entrypoints.json', JSON.stringify(results, null, 2));
  console.log('PASS: numeric translation and 90-degree rotation reject a hidden blocker and preserve state');
} finally {
  await browser.close();
}
