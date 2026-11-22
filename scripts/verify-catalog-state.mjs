/**
 * 阶段一验收：目录搜索/分类/收藏/滚动位置与键盘焦点的返回恢复。
 * 运行：node scripts/verify-catalog-state.mjs（需 dev server；VERIFY_BASE 可覆盖）
 */
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.VERIFY_BASE ?? 'http://127.0.0.1:5173/';
const OUT = path.resolve('outputs/verify-catalog-state');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const browser = await chromium.launch({
  ...browserOptions, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion']
});

const errors = [];
async function newPage(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  return { ctx, page };
}
async function home(page) {
  await page.goto(BASE + '#/library', { timeout: 90000, waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.device-card');
  await wait(500);
}
async function search(page, text) {
  await page.locator('.search-input').fill(text);
  await wait(300);
}
async function enterCard(page, id) {
  await page.evaluate((deviceId) => {
    const card = document.querySelector(`.device-card[data-device-id="${deviceId}"]`);
    (card?.querySelector('.card-enter')).click();
  }, id);
  await page.waitForSelector('.wb-device-name');
  await wait(900);
}
async function cardCount(page) { return page.locator('.device-card').count(); }

/* ---------- A. 搜索 + 浏览器后退：恢复关键词、结果、滚动与焦点 ---------- */
{
  const { ctx, page } = await newPage();
  await home(page);
  check('A0 初始目录 18 台', (await cardCount(page)) === 18);
  const histBefore = await page.evaluate(() => history.length);
  await search(page, '离心泵');
  const histAfter = await page.evaluate(() => history.length);
  check('A1 输入关键词不新增浏览历史', histBefore === histAfter, `${histBefore} -> ${histAfter}`);
  check('A2 搜索「离心泵」仅 1 台', (await cardCount(page)) === 1);
  await enterCard(page, 'pump');
  check('A3 进入单级离心泵', (await page.locator('.wb-device-name').textContent()) === '单级离心泵');
  await page.goBack();
  await page.waitForSelector('.device-card');
  await wait(700);
  check('A4 浏览器后退保留关键词', (await page.locator('.search-input').inputValue()) === '离心泵');
  check('A5 浏览器后退保留筛选结果（1 台）', (await cardCount(page)) === 1);
  check('A6 返回后焦点落在原设备的「进入学习」按钮',
    await page.evaluate(() => document.activeElement?.classList.contains('card-enter') &&
      document.activeElement?.closest('.device-card')?.dataset.deviceId === 'pump'));
  await page.screenshot({ path: path.join(OUT, 'a-back-search.png') });

  /* 滚动位置：在完整目录中滚动后进入设备 */
  await page.evaluate(() => { const s = document.querySelector('.search-input'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(300);
  await page.evaluate(() => window.scrollTo(0, 900));
  await wait(350);
  const beforeScroll = await page.evaluate(() => window.scrollY);
  const visible = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.device-card')];
    const el = cards.find((c) => {
      const r = c.getBoundingClientRect();
      return r.top > 80 && r.bottom < window.innerHeight - 20;
    });
    return el?.dataset.deviceId ?? null;
  });
  check('A7 找到滚动后可见的设备卡', !!visible, visible ?? '无');
  if (visible) {
    await page.evaluate((id) => document.querySelector(`.device-card[data-device-id="${id}"] .card-enter`).click(), visible);
    await page.waitForSelector('.wb-device-name');
    await wait(700);
    await page.goBack();
    await page.waitForSelector('.device-card');
    await wait(700);
    const restoredScroll = await page.evaluate(() => window.scrollY);
    check('A8 浏览器后退恢复滚动位置', Math.abs(restoredScroll - beforeScroll) <= 8, `${beforeScroll} -> ${restoredScroll}`);
    check('A9 返回后焦点落在滚动位置对应的设备', await page.evaluate((id) =>
      document.activeElement?.classList.contains('card-enter') &&
      document.activeElement?.closest('.device-card')?.dataset.deviceId === id, visible));
  }
  await ctx.close();
}

/* ---------- B. 搜索 + 分类 + 只看收藏组合；目标设备被取消收藏 ---------- */
{
  const { ctx, page } = await newPage();
  await home(page);
  await page.locator('.device-card[data-device-id="pump"] .fav-btn').click();
  await wait(250);
  await search(page, '泵');
  await page.locator('.chip[data-cat="pump"]').click();
  await page.locator('.chip-fav').click();
  await wait(300);
  const comboCount = await cardCount(page);
  check('B1 搜索 + 分类 + 只看收藏可叠加', comboCount === 1, `结果 ${comboCount} 台`);
  check('B2 组合筛选只剩离心泵', await page.evaluate(() => document.querySelectorAll('.device-card[data-device-id="pump"]').length === 1));
  await enterCard(page, 'pump');
  await page.locator('.wb-top-actions button[title*="收藏"]').click();
  await wait(300);
  await page.locator('.back-btn').click();
  await page.waitForSelector('.device-card, .empty-state:not([hidden])');
  await wait(700);
  check('B3 站内返回后仍保留搜索关键词', (await page.locator('.search-input').inputValue()) === '泵');
  check('B4 站内返回后保留分类与只看收藏',
    (await page.locator('.chip[data-cat="pump"]').getAttribute('aria-pressed')) === 'true' &&
    (await page.locator('.chip-fav').getAttribute('aria-pressed')) === 'true');
  check('B5 目标设备已取消收藏，不在结果中', (await page.locator('.device-card[data-device-id="pump"]').count()) === 0);
  check('B6 显示返回说明且焦点回到搜索框', (await page.locator('.catalog-restore-note').isVisible()) &&
    await page.evaluate(() => document.activeElement?.classList.contains('search-input')));
  await page.screenshot({ path: path.join(OUT, 'b-unfavorited-target.png') });
  const emptyVisible = await page.locator('.empty-state').isVisible();
  check('B7 空结果提供「清除筛选」', emptyVisible);
  if (emptyVisible) {
    await page.locator('.empty-state button', { hasText: '清除筛选' }).click();
    await wait(400);
    check('B8 清除筛选恢复完整 18 台目录', (await cardCount(page)) === 18);
    check('B9 清除筛选后关键词为空、收藏筛选关闭',
      (await page.locator('.search-input').inputValue()) === '' &&
      (await page.locator('.chip-fav').getAttribute('aria-pressed')) === 'false' &&
      (await page.locator('.chip[data-cat="all"]').getAttribute('aria-pressed')) === 'true');
    check('B10 清除筛选后返回说明隐藏', !(await page.locator('.catalog-restore-note').isVisible()));
  }
  await ctx.close();
}

/* ---------- C. 后退 → 前进 → 站内返回 ---------- */
{
  const { ctx, page } = await newPage();
  await home(page);
  await search(page, '离心泵');
  await enterCard(page, 'pump');
  await page.goBack();
  await page.waitForSelector('.device-card');
  await wait(600);
  check('C1 后退回到带关键词的目录', (await page.locator('.search-input').inputValue()) === '离心泵');
  await page.goForward();
  await page.waitForSelector('.wb-device-name');
  await wait(800);
  check('C2 前进回到同一设备', (await page.locator('.wb-device-name').textContent()) === '单级离心泵');
  await page.locator('.back-btn').click();
  await page.waitForSelector('.device-card');
  await wait(700);
  check('C3 从前进历史进入设备后，站内返回仍保留关键词', (await page.locator('.search-input').inputValue()) === '离心泵');
  check('C4 站内返回后结果仍为 1 台', (await cardCount(page)) === 1);
  await page.screenshot({ path: path.join(OUT, 'c-forward-then-insite.png') });
  await ctx.close();
}

/* ---------- D. 直接打开设备链接：返回完整目录 ---------- */
{
  const { ctx, page } = await newPage();
  await page.goto(BASE + '#/device/pump', { timeout: 90000, waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.wb-device-name');
  await wait(900);
  await page.locator('.back-btn').click();
  await page.waitForSelector('.device-card');
  await wait(500);
  check('D1 直接打开设备链接后返回完整目录', (await cardCount(page)) === 18);
  check('D2 直接打开设备后返回不带搜索关键词', (await page.locator('.search-input').inputValue()) === '');
  check('D3 直接打开设备后返回不显示恢复说明', !(await page.locator('.catalog-restore-note').isVisible()));
  await ctx.close();
}

/* ---------- E. 手机视口：返回恢复筛选与滚动 ---------- */
{
  const { ctx, page } = await newPage({ width: 390, height: 844 });
  await home(page);
  await search(page, '离心泵');
  await enterCard(page, 'pump');
  check('E1 手机端进入设备', (await page.locator('.wb-device-name').textContent()) === '单级离心泵');
  await page.goBack();
  await page.waitForSelector('.device-card');
  await wait(700);
  check('E2 手机端后退保留关键词与结果', (await page.locator('.search-input').inputValue()) === '离心泵' && (await cardCount(page)) === 1);
  await page.screenshot({ path: path.join(OUT, 'e-mobile-back.png') });
  await ctx.close();
}

await browser.close();
check('Z 全程无控制台错误', errors.length === 0, errors.join(' | '));

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ results, errors }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
