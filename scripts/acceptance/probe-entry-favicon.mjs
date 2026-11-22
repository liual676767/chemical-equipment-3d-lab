/** 探针：首页微沸入口文案 + 流体预览 404 来源 URL。 */
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../..', import.meta.url));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox'] });

const homePage = await browser.newPage();
await homePage.goto('http://127.0.0.1:4175/', { waitUntil: 'domcontentloaded' });
await homePage.waitForSelector('.device-card', { timeout: 60000 });
const entries = await homePage.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /微沸|全流程|工坊/.test(t)));
console.log('首页入口按钮：', JSON.stringify(entries));
await homePage.close();

const { createServer } = await import('vite');
const vite = await createServer({ root, server: { middlewareMode: true, hmr: false } });
const server = createHttpServer(vite.middlewares);
const listening = once(server, 'listening');
server.listen({ host: '127.0.0.1', port: 0 });
await listening;
const base = `http://127.0.0.1:${server.address().port}/`;
const page = await browser.newPage();
const bad = [];
page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
page.on('console', (m) => { if (m.type() === 'error') bad.push('console: ' + m.text()); });
await page.goto(base + 'scripts/preview/boil-fluid.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('body[data-preview-ready="1"]', { timeout: 90000 });
await new Promise((r) => setTimeout(r, 1500));
console.log('流体预览异常响应/控制台：', bad.length ? JSON.stringify(bad) : '无');
await browser.close();
server.close();
await vite.close();