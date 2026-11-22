import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { browserOptions, webglArgs } from '../browser-options.mjs';

const bases = {
  baseline: process.env.BASELINE_BASE ?? 'http://127.0.0.1:48119/',
  current: process.env.VERIFY_BASE ?? 'http://127.0.0.1:48120/'
};
const target = 'outputs/verify-p5';
mkdirSync(target, { recursive: true });
const viewport = { width: 1280, height: 720 };
const exits = 8;
const browser = await chromium.launch({ ...browserOptions, headless: true, args: webglArgs });
const metrics = { browser: browser.version(), viewport, scale: 1, runs: {} };
const percentile = (sorted, p) => sorted[Math.ceil(sorted.length * p) - 1];
const files = await Promise.all(Object.entries(bases).map(async ([name, base]) => {
  const html = await (await fetch(base)).text();
  const entry = html.match(/assets\/index-[\w-]+\.js/)?.[0];
  assert.ok(entry, 'Build entry could not be determined at ' + base);
  return [name, entry];
}));
metrics.entryFiles = Object.fromEntries(files);

try {
  for (const [name, base] of Object.entries(bases)) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const session = await page.context().newCDPSession(page);
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await session.send('Network.enable');
    await session.send('Network.setCacheDisabled', { cacheDisabled: true });
    const start = performance.now();
    await page.goto(base + '#/plant', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window.__plant?.debug()?.drawCalls ?? 0) > 0);
    const interactiveMs = Math.round(performance.now() - start);
    assert.equal(await page.locator('.plant-run').isEnabled(), true);
    const statistics = await page.evaluate(async () => {
      const canvas = document.querySelector('.plant-canvas');
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      const extension = gl?.getExtension('WEBGL_debug_renderer_info');
      const renderer = extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER);
      const times = [];
      let previous = await new Promise(requestAnimationFrame);
      for (let i = 0; i < 24; i++) {
        const now = await new Promise(requestAnimationFrame);
        times.push(now - previous);
        previous = now;
      }
      const debug = window.__plant.debug();
      return { renderer, times, calls: debug.drawCalls, triangles: debug.triangles,
        geometries: debug.geometries, textures: debug.textures, eye: debug.pos, target: debug.target };
    });
    await page.screenshot({ path: target + '/performance-plant-' + name + '.png', timeout: 90000 });
    const sorted = statistics.times.sort((a, b) => a - b);
    const heap = [];
    for (let i = 0; i < exits; i++) {
      await page.locator('.plant-topbar button[title="返回设备库"]').click();
      await page.locator('.device-card').first().waitFor();
      await session.send('HeapProfiler.collectGarbage');
      const measurement = await session.send('Runtime.getHeapUsage');
      heap.push(measurement.usedSize);
      if (i === exits - 1) break;
      await page.evaluate(() => { location.hash = '#/plant'; });
      await page.waitForFunction(() => (window.__plant?.debug()?.drawCalls ?? 0) > 0);
    }
    assert.deepEqual(errors, []);
    metrics.runs[name] = {
      renderer: statistics.renderer, interactiveMs, samples: sorted.length,
      p50Ms: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95),
      drawCalls: statistics.calls, triangles: statistics.triangles,
      renderGeometries: statistics.geometries, renderTextures: statistics.textures,
      eye: statistics.eye, target: statistics.target, heapBytesAfterExit: heap
    };
    await page.close();
  }
  writeFileSync(target + '/performance-plant-' + (process.env.VERIFY_GPU === '1' ? 'hardware-requested' : 'software') + '.json',
    JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics, null, 2));
} finally {
  await browser.close();
}
