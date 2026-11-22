/* 发布后线上走查：三维教学工厂首页 + 旧入口/深链 + 手机视口。 */
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.WALK_BASE ?? 'https://chem-equipment-3d-lab-r44x9hkn4ne.qoder.zone/';
const OUT = path.resolve('outputs/verify');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const errors = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  ...browserOptions, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(BASE + '#/', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForSelector('.factory-canvas', { timeout: 60000 });
await wait(3200);
check('线上首页为三维教学工厂', await page.evaluate(() => !!document.querySelector('.factory-canvas') && !!document.querySelector('.factory-topbar')));
check('线上工厂显示设备标签与工序面板', await page.evaluate(() => document.querySelectorAll('.factory-label').length >= 10 && document.querySelectorAll('.factory-step-item').length === 8));
check('线上样板任务入口可用', await page.evaluate(() => [...document.querySelectorAll('.factory-top-actions button')].some((b) => b.textContent.includes('样板任务'))));
check('线上教学流程图可见', await page.evaluate(() => !!document.querySelector('.factory-diagram svg')));
await page.screenshot({ path: path.join(OUT, 'published-factory-01.png'), timeout: 60000 });

await page.goto(BASE + '#/library', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForSelector('.device-card', { timeout: 30000 });
check('线上设备库（#/library）18 张卡片', await page.evaluate(() => document.querySelectorAll('.device-card').length === 18));
await page.goto(BASE + '#/device/pump', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForSelector('.canvas-wrap canvas', { timeout: 40000 });
check('线上深链 #/device/pump 可用', true);
await page.goto(BASE + '#/workshop', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForSelector('.ws-canvas canvas', { timeout: 40000 });
check('线上组装工坊可用', true);
await page.goto(BASE + '#/plant', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForSelector('.plant-canvas', { timeout: 40000 });
check('线上全流程装置可用', true);
await page.goto(BASE + '#/assets', { waitUntil: 'domcontentloaded', timeout: 90000 });
await wait(1200);
check('线上高精度模型库可用', await page.evaluate(() => !!document.querySelector('[data-nav="assets"]')));
check('线上无控制台/页面错误', errors.length === 0, errors.slice(0, 3).join(' | '));

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await mobile.goto(BASE + '#/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await mobile.waitForSelector('.factory-canvas', { timeout: 60000 });
await wait(2800);
check('线上手机端工厂可加载且无横向溢出', await mobile.evaluate(() => document.body.scrollWidth <= window.innerWidth + 1));
await mobile.screenshot({ path: path.join(OUT, 'published-factory-02-mobile.png'), timeout: 60000 });
await mobile.close();
await browser.close();

const passed = results.filter((r) => r.ok).length;
fs.writeFileSync(path.join(OUT, 'walk-factory-published.json'), JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, passed, total: results.length, results, errors }, null, 2));
console.log(`\n==== FACTORY PUBLISHED ${passed}/${results.length} passed ====`);
process.exitCode = passed === results.length ? 0 : 1;