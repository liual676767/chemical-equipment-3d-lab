/** 线上泵内窥发布后检查（DOM 级，不含开发调试句柄）。 */
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.ONLINE_BASE ?? 'https://chem-equipment-3d-lab-r44x9hkn4ne.qoder.zone/';
const OUT = path.resolve('outputs/verify-pump-online');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const consoleErrors = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  ...browserOptions, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });
await page.goto(BASE + '#/device/pump', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.canvas-wrap canvas', { timeout: 30000 });
const loading = await page.waitForFunction(() => {
  const l = document.querySelector('.loading-overlay');
  return !l || getComputedStyle(l).display === 'none';
}, null, { timeout: 30000 }).then(() => true).catch(() => false);
check('线上泵工作台加载完成', loading);

const endoTab = page.locator('.mode-tab').filter({ hasText: '内窥' });
check('线上存在「内窥」页签且已开放', (await endoTab.count()) === 1 && !(await endoTab.first().getAttribute('class') ?? '').includes('tab-dev'));
await endoTab.first().click();
await wait(1200);
const hud1 = await page.evaluate(() => {
  const hud = document.querySelector('.endo-hud');
  return { visible: !!hud && !hud.hidden, text: hud?.textContent ?? '', chips: document.querySelectorAll('.endo-chip').length };
});
check('线上内窥 HUD 显示 1/8 与入口名', hud1.visible && hud1.text.includes('1 / 8') && hud1.text.includes('吸入口'), hud1.text.slice(0, 40));
check('线上内窥视点条 8 站', hud1.chips === 8);
await page.screenshot({ path: path.join(OUT, 'online-endo-1.png'), timeout: 60000 });
await page.evaluate(() => { [...document.querySelectorAll('.wb-bottom button')].find((b) => b.textContent === '下一站')?.click(); });
await wait(1400);
const hud2 = await page.evaluate(() => document.querySelector('.endo-hud')?.textContent ?? '');
check('线上「下一站」切换到吸入弯头', hud2.includes('2 / 8') && hud2.includes('吸入弯头'), hud2.slice(0, 30));
await page.evaluate(() => { [...document.querySelectorAll('.wb-bottom button')].find((b) => b.textContent.includes('退出内窥'))?.click(); });
await wait(900);
const exited = await page.evaluate(() => ({
  hudHidden: document.querySelector('.endo-hud')?.hidden ?? true,
  active: document.querySelector('.mode-tab.active')?.textContent ?? ''
}));
check('线上退出内窥并回到整体观察', exited.hudHidden && exited.active.includes('整体观察'), JSON.stringify(exited));
const realErrors = consoleErrors.filter((e) => !e.includes('favicon'));
check('线上内窥检查无控制台错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ base: BASE, results, consoleErrors: realErrors }, null, 2));
console.log(`\n==== ONLINE PUMP ENDOSCOPE ${results.length - failed.length}/${results.length} passed ====`);
if (failed.length) process.exit(1);
