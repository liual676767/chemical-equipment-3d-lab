/* 改版前基线记录：入口清单、路由、旧数据结构、桌面与手机截图 */
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASELINE_BASE ?? 'http://127.0.0.1:4175/';
const OUT = path.resolve('outputs/redesign-baseline');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  ...browserOptions,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await wait(2500);
await page.screenshot({ path: path.join(OUT, 'before-home-1440.png'), timeout: 60000 });

const homeRecord = await page.evaluate(() => ({
  hash: location.hash,
  title: document.title,
  navButtons: [...document.querySelectorAll('header button')].map((b) => b.textContent.trim()).filter(Boolean),
  sections: [...document.querySelectorAll('.home > section, .home > header')].map((s) => s.className),
  deviceCards: document.querySelectorAll('.device-card').length,
  chips: [...document.querySelectorAll('.chip')].map((b) => b.textContent.trim()),
  cardTitle: document.querySelector('.card-title')?.textContent,
  cardActions: [...document.querySelectorAll('.device-card')][0] ? [...document.querySelectorAll('.device-card')][0].querySelectorAll('button').length : 0,
  bannerLinks: [...document.querySelectorAll('.ws-banner')].map((b) => ({ cls: b.className, h2: b.querySelector('h2')?.textContent, btn: b.querySelector('button')?.textContent })),
  localStorageKeys: Object.keys(localStorage)
}));

await page.evaluate(() => { [...document.querySelectorAll('.card-enter')][0].click(); });
await page.waitForSelector('.canvas-wrap canvas', { timeout: 30000 });
await wait(2000);
await page.screenshot({ path: path.join(OUT, 'before-workbench-1440.png'), timeout: 60000 });
const wbRecord = await page.evaluate(() => ({
  hash: location.hash,
  deviceName: document.querySelector('.wb-device-name')?.textContent,
  modeTabs: [...document.querySelectorAll('.mode-tab')].map((b) => b.textContent.trim()),
  treeItems: document.querySelectorAll('.tree-item').length,
  canvasToolbar: [...document.querySelectorAll('.canvas-toolbar button')].map((b) => b.textContent.trim()),
  infoHeadings: [...document.querySelectorAll('.info-h4')].map((h) => h.textContent),
  bottomBar: document.querySelector('.wb-bottom')?.textContent.slice(0, 200)
}));

const storeKeys = await page.evaluate(() => {
  localStorage.setItem('chem3d-lab:v1', localStorage.getItem('chem3d-lab:v1') ?? JSON.stringify({ schema: 2, devices: {}, feedback: [] }));
  return { lab: 'chem3d-lab:v1', workshop: 'chem3d-workshop:v1', quality: 'chem3d-lab:quality' };
});

/* 手机基线 */
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mp = await mobile.newPage();
await mp.goto(BASE, { waitUntil: 'networkidle' });
await wait(2200);
await mp.screenshot({ path: path.join(OUT, 'before-home-390.png'), timeout: 60000 });
const mobileRecord = await mp.evaluate(() => ({
  bodyWidth: document.body.scrollWidth,
  viewportWidth: window.innerWidth,
  overflow: document.body.scrollWidth > window.innerWidth,
  headerButtons: [...document.querySelectorAll('header button')].map((b) => b.textContent.trim()).filter(Boolean),
  firstCardTop: document.querySelector('.device-card')?.getBoundingClientRect().top,
  searchVisible: !!document.querySelector('.search-input'),
  chips: [...document.querySelectorAll('.chip')].map((b) => b.textContent.trim())
}));
await mp.evaluate(() => { [...document.querySelectorAll('.card-enter')][0].click(); });
await wait(2200);
await mp.screenshot({ path: path.join(OUT, 'before-workbench-390.png'), timeout: 60000 });
const mobileWb = await mp.evaluate(() => ({
  bodyWidth: document.body.scrollWidth,
  viewportWidth: window.innerWidth,
  overflow: document.body.scrollWidth > window.innerWidth,
  topActions: [...document.querySelectorAll('.wb-top-actions button')].map((b) => b.title || b.textContent.trim()),
  canvasBox: (() => { const r = document.querySelector('.canvas-wrap canvas')?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; })()
}));

/* 路由台账 */
const routes = await page.evaluate(async () => {
  const list = ['#/', '#/device/pump', '#/workshop', '#/plant', '#/boil', '#/assets'];
  return list;
});

const record = {
  base: BASE,
  date: new Date().toISOString(),
  home: homeRecord,
  workbench: wbRecord,
  storeKeys,
  mobileHome: mobileRecord,
  mobileWorkbench: mobileWb,
  routes,
  consoleErrors: errors
};
fs.writeFileSync(path.join(OUT, 'before-record.json'), JSON.stringify(record, null, 2), 'utf8');
console.log(JSON.stringify(record, null, 2));
await browser.close();
