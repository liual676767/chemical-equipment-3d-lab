/** 冒烟：验收检查页 fluid-geometry.html 可加载并给出量化结果。 */
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../..', import.meta.url));
const { createServer } = await import('vite');
const vite = await createServer({ root, server: { middlewareMode: true, hmr: false } });
const server = createHttpServer(vite.middlewares);
const listening = once(server, 'listening');
server.listen({ host: '127.0.0.1', port: 0 });
await listening;
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText ?? '')));
try {
  await page.goto(base + 'scripts/acceptance/fluid-geometry.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body[data-ready="1"]', { timeout: 90000 });
  const r = await page.evaluate(() => {
    const list = window.__geoTest.deviation();
    const worst = list.reduce((a, b) => (b.excess > a.excess ? b : a));
    return { runs: window.__geoTest.runCount, routes: window.__geoTest.routeCount, worst, sample: list[0] };
  });
  console.log('probe:', JSON.stringify(r));
  console.log('errors:', errors.length ? errors.join(' | ') : '无');
} finally {
  await browser.close();
  server.close();
  await vite.close();
}