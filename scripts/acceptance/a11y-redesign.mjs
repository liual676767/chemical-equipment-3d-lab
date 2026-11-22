/* 改版可访问性实测：键盘导航、下拉/菜单焦点、触屏菜单、对比度与可访问名称 */
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.A11Y_BASE ?? 'http://127.0.0.1:5173/';
const OUT = path.resolve('outputs/a11y-redesign');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const errors = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

function luminance(hex) {
  const v = hex.replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const browser = await chromium.launch({
  ...browserOptions,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-background-timer-throttling']
});
try {
  /* ---------- 桌面：首页导航键盘操作 ---------- */
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(new URL('#/library', BASE).href, { waitUntil: 'networkidle' });
  await wait(600);

  await page.focus('.site-drop-btn');
  await page.keyboard.press('Enter');
  await wait(200);
  check('键盘打开工艺流程菜单', await page.evaluate(() => document.querySelector('.site-drop-btn').getAttribute('aria-expanded') === 'true'));
  check('菜单打开后焦点进入首项', await page.evaluate(() => document.activeElement?.textContent?.includes('化工厂全流程装置')));
  await page.keyboard.press('ArrowDown');
  check('方向键在菜单项间移动', await page.evaluate(() => document.activeElement?.textContent?.includes('微沸喷烧全流程')));
  await page.keyboard.press('Escape');
  await wait(150);
  check('Esc 关闭菜单并还原焦点', await page.evaluate(() => document.querySelector('.site-drop-btn').getAttribute('aria-expanded') === 'false' && document.activeElement?.classList.contains('site-drop-btn')));

  await page.focus('.site-brand');
  const activeName = () => page.evaluate(() => {
    const el = document.activeElement;
    return el ? (el.getAttribute('aria-label') || el.textContent.trim() || el.tagName) : '';
  });
  const tabOrder = [await activeName()];
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    tabOrder.push(await activeName());
  }
  check('Tab 可达品牌、四个导航入口与学习记录', ['设备库', '组装工坊', '工艺流程', '高精度模型库', '学习记录'].every((name) => tabOrder.some((t) => t.includes(name))), tabOrder.join(' | '));

  await page.focus('.chips .chip');
  await page.keyboard.press('Space');
  await wait(150);
  check('空格键切换分类筛选', await page.evaluate(() => document.querySelector('.chips .chip').getAttribute('aria-pressed') === 'true'));

  const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, a')].filter((el) => {
    if (el.offsetParent === null) return false;
    const name = (el.getAttribute('aria-label') || el.textContent.trim() || el.getAttribute('title') || '').trim();
    return !name;
  }).map((el) => el.outerHTML.slice(0, 80)));
  check('可见按钮/链接均有可访问名称', unnamed.length === 0, unnamed.slice(0, 3).join(' | '));

  /* ---------- 桌面：工作台键盘 ---------- */
  await page.evaluate(() => { document.querySelector('.device-card[data-device-id="pump"] .card-enter').click(); });
  await page.waitForSelector('.canvas-wrap canvas', { timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.__chem3d?.scene), null, { timeout: 30000 });
  await wait(800);
  const sectionTab = page.locator('.mode-tab').filter({ hasText: '剖视' });
  await sectionTab.focus();
  await page.keyboard.press('Enter');
  await wait(500);
  check('键盘切换剖视并标记 aria-pressed', await page.evaluate(() => {
    const tab = [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.includes('剖视'));
    return tab.getAttribute('aria-pressed') === 'true' && window.__chem3d.scene.mode === 'section' && document.querySelector('.canvas-mode-name')?.textContent === '剖视';
  }));
  await page.focus('.tool-menu-btn');
  await page.keyboard.press('Enter');
  await wait(200);
  check('键盘打开工具菜单并聚焦首项', await page.evaluate(() => document.querySelector('.tool-menu-btn').getAttribute('aria-expanded') === 'true' && !!document.activeElement?.classList.contains('tool-menu-item')));
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  check('工具菜单项可 Tab 聚焦', await page.evaluate(() => document.activeElement?.classList.contains('tool-menu-item')));
  await page.keyboard.press('Escape');
  await wait(150);
  check('Esc 关闭工具菜单并还原焦点', await page.evaluate(() => document.querySelector('.tool-menu-btn').getAttribute('aria-expanded') === 'false' && document.activeElement?.classList.contains('tool-menu-btn')));
  await page.screenshot({ path: path.join(OUT, 'a11y-workbench.png') });

  /* ---------- 手机：菜单键盘与触屏 ---------- */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await ctx.newPage();
  mp.on('pageerror', (e) => errors.push('pageerror(mobile): ' + e.message));
  await mp.goto(new URL('#/library', BASE).href, { waitUntil: 'networkidle' });
  await wait(500);
  await mp.focus('.site-menu-btn');
  await mp.keyboard.press('Enter');
  await wait(200);
  check('手机菜单键盘可打开且焦点入内', await mp.evaluate(() => document.querySelector('.site-menu-btn').getAttribute('aria-expanded') === 'true' && document.activeElement?.classList.contains('site-mobile-link')));
  await mp.keyboard.press('Escape');
  await wait(150);
  check('手机菜单 Esc 关闭并还原焦点', await mp.evaluate(() => document.querySelector('.site-menu-btn').getAttribute('aria-expanded') === 'false' && document.activeElement?.classList.contains('site-menu-btn')));
  await mp.tap('.site-menu-btn');
  await wait(200);
  check('手机菜单触屏可打开', await mp.evaluate(() => !document.querySelector('.site-mobile-menu').hidden));
  await mp.screenshot({ path: path.join(OUT, 'a11y-mobile-menu.png') });

  /* ---------- 对比度 ---------- */
  const pairs = [
    ['正文 #14243A / 背景 #F4F7FB', '#14243A', '#F4F7FB', 4.5],
    ['弱化文字 #52627A / 白卡片', '#52627A', '#FFFFFF', 4.5],
    ['主按钮 #1D4ED8 / 白字', '#1D4ED8', '#FFFFFF', 4.5],
    ['成功状态 #0E7A5F / 浅绿底', '#0E7A5F', '#E7F2EE', 4.5],
    ['提醒状态 #8A5D13 / 浅黄底', '#8A5D13', '#FCF3E3', 4.5]
  ];
  for (const [name, fg, bg, min] of pairs) {
    const ratio = contrast(fg, bg);
    check(`对比度 ${name} ≥ ${min}`, ratio >= min, ratio.toFixed(2));
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ results, errors }, null, 2));
console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
process.exit(failed.length ? 1 : 0);
