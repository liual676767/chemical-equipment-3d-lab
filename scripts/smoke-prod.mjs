/**
 * 生产构建冒烟测试（DOM 级，不依赖开发调试句柄）。
 * 先 npm run build && npm run preview，再运行 npm run smoke:prod。
 * 可用 SMOKE_BASE 覆盖地址（默认 http://127.0.0.1:4173/）。
 */
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:4173/';
const OUT = path.resolve('outputs/verify');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const consoleErrors = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  ...browserOptions,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });
const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), timeout: 60000 });
const clickTab = (label) => page.evaluate((t) => {
  [...document.querySelectorAll('.mode-tab')].find((x) => x.textContent.includes(t)).click();
}, label);
const activeTab = () => page.evaluate(() => document.querySelector('.mode-tab.active')?.textContent ?? '');

/* 首页 */
await page.goto(BASE + '#/library');
await page.waitForSelector('.device-card', { timeout: 30000 });
await wait(1500);
check('生产首页 18 张设备卡片', await page.evaluate(() => document.querySelectorAll('.device-card').length) === 18);
check('生产首页静态缩略图', await page.evaluate(() => document.querySelectorAll('.card-thumb').length === 18 && [...document.querySelectorAll('.card-thumb')].slice(0, 3).every((img) => img.complete && img.naturalWidth > 0)));
await page.fill('.search-input', '换热');
check('生产搜索筛选生效（换热=3，含用途含词）', await page.evaluate(() => document.querySelectorAll('.device-card').length) === 3);
await page.fill('.search-input', '');
await shot('prod-01-home');

/* 记录管理入口 */
await page.evaluate(() => { [...document.querySelectorAll('.home-header button')].find((b) => b.textContent === '学习记录').click(); });
await wait(300);
check('生产记录管理对话框可打开', await page.evaluate(() => !!document.querySelector('.modal-card') && document.querySelector('.modal-note')?.textContent.includes('当前浏览器')));
await page.keyboard.press('Escape');
await wait(200);

/* 泵工作台 */
await page.evaluate(() => { [...document.querySelectorAll('.card-enter')][0].click(); });
await page.waitForSelector('.canvas-wrap canvas', { timeout: 30000 });
await wait(1500);
check('生产泵工作台 WebGL 正常', await page.evaluate(() => document.querySelector('.webgl-fallback').style.display === 'none'));
check('生产目录零件数=40', await page.evaluate(() => document.querySelectorAll('.tree-item').length) === 40);
check('生产总览含学习目标与观察任务', await page.evaluate(() => {
  const hs = [...document.querySelectorAll('.info-h4')].map((h) => h.textContent);
  return hs.includes('学习目标') && hs.some((h) => h.startsWith('观察任务（'));
}));
await shot('prod-02-pump-observe');

/* 模式切换 */
for (const [tab, expect] of [['剖视', '剖视'], ['透明观察', '透明'], ['爆炸图', '爆炸'], ['工作原理', '原理'], ['拆装练习', '拆装']]) {
  await clickTab(tab);
  await wait(700);
  check(`生产模式切换「${tab}」`, (await activeTab()).includes(expect));
}
check('生产拆装控制条存在', await page.evaluate(() => !!document.querySelector('.practice-actions') && !!document.querySelector('.step-text')));
await shot('prod-03-pump-practice');
await clickTab('整体观察');
await wait(500);

/* 画质与反馈 */
await page.evaluate(() => document.querySelector('.tool-menu-btn').click());
await wait(200);
await page.evaluate(() => { [...document.querySelectorAll('.tool-menu-pop button')].find((b) => b.getAttribute('aria-label')?.startsWith('画质')).click(); });
await wait(300);
check('生产画质切换按钮生效', await page.evaluate(() => [...document.querySelectorAll('.tool-menu-pop button')].some((b) => b.getAttribute('aria-label')?.startsWith('画质：低'))));
await page.evaluate(() => { [...document.querySelectorAll('.tool-menu-pop button')].find((b) => b.getAttribute('aria-label')?.startsWith('画质')).click(); });
await page.keyboard.press('Escape');
await page.evaluate(() => document.querySelector('.wb-top-actions button[title="问题反馈"]').click());
await wait(300);
check('生产反馈对话框带上下文', await page.evaluate(() => document.querySelector('.feedback-context')?.textContent.includes('单级离心泵')));
await page.keyboard.press('Escape');
await wait(200);

/* 直接链接 + 刷新路由 */
await page.goto(BASE + '#/device/exchanger');
await page.waitForSelector('.canvas-wrap canvas', { timeout: 30000 });
await wait(1200);
check('生产直接链接进入换热器', await page.evaluate(() => document.querySelector('.wb-device-name')?.textContent.includes('换热器')));
await page.reload();
await page.waitForSelector('.canvas-wrap canvas', { timeout: 30000 });
await wait(1200);
check('生产刷新后路由保持', await page.evaluate(() => document.querySelector('.wb-device-name')?.textContent.includes('换热器')));
await shot('prod-04-exchanger');

/* 新设备直接链接（球阀） */
await page.goto(BASE + '#/device/ball-valve');
await page.waitForSelector('.canvas-wrap canvas', { timeout: 30000 });
await wait(1200);
check('生产直接链接进入法兰球阀', await page.evaluate(() => document.querySelector('.wb-device-name')?.textContent.includes('球阀')));
check('生产球阀目录零件数=9 且标注教学示意', await page.evaluate(() => document.querySelectorAll('.tree-item').length === 9 && [...document.querySelectorAll('.badge-model')].some((b) => b.textContent === '教学示意模型')));
await clickTab('拆装练习');
await wait(700);
check('生产球阀拆装控制条存在', await page.evaluate(() => !!document.querySelector('.practice-actions') && !!document.querySelector('.step-text')));
await shot('prod-06-ball-valve');
await clickTab('整体观察');
await wait(400);

/* 移动端视口 */
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(BASE + '#/device/pump');
await page.waitForSelector('.canvas-wrap canvas', { timeout: 30000 });
await wait(1500);
await page.click('[data-action="parts"]');
await wait(400);
check('生产移动端目录抽屉可打开', await page.evaluate(() => document.querySelector('.left-panel').classList.contains('drawer-open')));
await shot('prod-05-mobile');

const realErrors = consoleErrors.filter((e) => !e.includes('favicon'));
check('生产无运行时控制台错误', realErrors.length === 0, realErrors.slice(0, 5).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT, 'report-prod.json'), JSON.stringify({ base: BASE, results, consoleErrors: realErrors }, null, 2));
console.log(`\n==== PROD ${results.length - failed.length}/${results.length} passed ====`);
if (failed.length) { console.log('FAILED:', failed.map((f) => f.name).join('; ')); process.exit(1); }