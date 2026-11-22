/* 高精度模型库专项验证：入口、13 件 GLB、视图/剖切/爆炸/选件、设备页互链、移动端。
 * 运行：node scripts/verify-assets.mjs（默认 dev server 5173，可用 VERIFY_BASE 覆盖） */
import { chromium } from 'playwright-core';
import { browserOptions, webglArgs } from './browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.VERIFY_BASE ?? 'http://127.0.0.1:5173/';
const OUT = path.resolve('outputs/verify-assets');
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
  args: [...webglArgs, '--disable-gpu-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion']
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 960 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });

const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), timeout: 120000 });
const ev = (fn, arg) => page.evaluate(fn, arg);
const loadingHidden = () => page.waitForFunction(() => {
  const l = document.querySelector('.assets-loading');
  return !l || getComputedStyle(l).display === 'none';
}, { timeout: 30000 });

/* ---------- 首页入口 ---------- */
await page.goto(BASE + '#/library', { waitUntil: 'networkidle' });
await page.waitForSelector('.device-card', { timeout: 30000 });
check('首页新增高精度模型库入口', await ev(() => {
  const a = document.querySelector('[data-nav="assets"]');
  const m = document.querySelector('.module-entry[data-module="assets"]');
  return !!a && a.textContent.includes('高精度模型库') && !!m && m.textContent.includes('13 件');
}));
check('原有 18 张设备卡片保留', await ev(() => document.querySelectorAll('.device-card').length === 18));
check('工坊/全流程/微沸喷烧入口保留', await ev(() => document.querySelectorAll('.module-entry').length >= 4 && !!document.querySelector('[data-nav="plant"]') && !!document.querySelector('[data-nav="boil"]')));
await shot('assets-01-home');

await ev(() => { document.querySelector('.module-entry[data-module="assets"]').click(); });
await page.waitForSelector('.assets-page', { timeout: 30000 });
await page.waitForSelector('.asset-canvas', { timeout: 30000 });
await loadingHidden();
await wait(600);
check('路由进入 #/assets 并渲染三维舞台', await ev(() => location.hash.startsWith('#/assets') && !!document.querySelector('.asset-canvas')));
check('素材清单 13 件', await ev(() => document.querySelectorAll('.asset-item').length === 13), String(await ev(() => document.querySelectorAll('.asset-item').length)));
check('默认加载卧式离心泵组', await ev(() => document.querySelector('.asset-info-head h2')?.textContent.includes('卧式离心泵组')));
check('画布有实际像素尺寸', await ev(() => { const c = document.querySelector('.asset-canvas'); return c && c.width > 300 && c.height > 200; }));
await shot('assets-02-pump');

/* ---------- 逐个资产加载 ---------- */
const ids = await ev(() => [...document.querySelectorAll('.asset-item')].map((b, i) => i));
let loaded = 0;
for (const i of ids) {
  await ev((idx) => { document.querySelectorAll('.asset-item')[idx].click(); }, i);
  await loadingHidden();
  await wait(250);
  const name = await ev(() => document.querySelector('.asset-info-head h2')?.textContent || '');
  const err = await ev(() => { const e = document.querySelector('.assets-error'); return e && getComputedStyle(e).display !== 'none' ? e.textContent : ''; });
  if (name && !err) loaded++;
  else console.log('LOAD_FAIL', i, name, err);
}
check('13 件资产全部加载成功', loaded === 13, `${loaded}/13`);
await shot('assets-03-last');

/* ---------- 视图/显示控制 ---------- */
await ev(() => { document.querySelectorAll('.asset-item')[0].click(); });
await loadingHidden();
await wait(400);
const btn = (text) => page.locator('.asset-tool', { hasText: text }).first();
await btn('线框').click();
check('线框按钮进入激活态', await ev(() => [...document.querySelectorAll('.asset-tool')].find((b) => b.textContent.includes('线框'))?.classList.contains('active')));
await btn('X 射线').click();
check('X 射线按钮进入激活态', await ev(() => [...document.querySelectorAll('.asset-tool')].find((b) => b.textContent.includes('X 射线'))?.classList.contains('active')));
await btn('剖切').click();
check('剖切按钮进入激活态且滑杆可用', await ev(() => {
  const b = [...document.querySelectorAll('.asset-tool')].find((x) => x.textContent.trim() === '剖切');
  const r = document.querySelector('.assets-page .ctrl-slider input');
  return b?.classList.contains('active') && r && !r.disabled;
}));
await ev(() => {
  const rows = [...document.querySelectorAll('.asset-axis-row .axis-btn')];
  rows[1]?.click();
});
check('剖切坐标轴 Y 向可切换', await ev(() => [...document.querySelectorAll('.asset-axis-row .axis-btn')][1]?.classList.contains('active')));
await ev(() => {
  const inputs = [...document.querySelectorAll('.assets-page .ctrl-slider input')];
  const cut = inputs[0];
  cut.value = '72';
  cut.dispatchEvent(new Event('input', { bubbles: true }));
  const exp = inputs[1];
  exp.value = '60';
  exp.dispatchEvent(new Event('input', { bubbles: true }));
});
await wait(300);
check('剖切位置与爆炸滑杆可调', await ev(() => {
  const vs = [...document.querySelectorAll('.assets-page .ctrl-value')].map((x) => x.textContent);
  return vs.includes('72%') && vs.includes('60%');
}));
await shot('assets-04-cut-explode');

/* ---------- 选件 ---------- */
await btn('复位视角').click();
await btn('显示全部').click();
await wait(500);
const box = await page.locator('.asset-canvas').boundingBox();
let picked = '';
const spots = [[0.5, 0.5], [0.5, 0.58], [0.45, 0.55], [0.55, 0.55], [0.5, 0.65]];
for (const [fx, fy] of spots) {
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  await wait(200);
  picked = await ev(() => document.querySelector('.asset-selected-name')?.textContent || '');
  if (picked) break;
}
check('点击模型可选中零件并显示信息', !!picked, picked || '未命中网格');
await shot('assets-05-select');

/* ---------- 设备页互链 ---------- */
await page.goto(BASE + '#/device/pump', { waitUntil: 'networkidle' });
await page.locator('.tool-menu-btn').click();
await page.locator('.asset-link-btn').waitFor();
check('离心泵工作台按上传外观对照标注素材入口', await ev(() => {
  const b = document.querySelector('.asset-link-btn');
  return !!b && b.textContent.includes('上传外观对照');
}));
check('教学设备的观察、剖视、透明、爆炸、原理、内窥与拆装模式存在', await ev(() => {
  const modes = [...document.querySelectorAll('.mode-tab')].map(tab => tab.textContent);
  return ['整体观察', '剖视', '透明观察', '爆炸图', '工作原理', '内窥', '拆装练习'].every(mode => modes.includes(mode));
}));
await page.locator('.asset-link-btn').click();
await page.waitForSelector('.assets-page', { timeout: 30000 });
await page.waitForSelector('.asset-canvas', { timeout: 30000 });
await loadingHidden();
check('设备页互链进入模型库并定位泵组', await ev(() => location.hash === '#/assets/pump-skid' && document.querySelector('.asset-info-head h2')?.textContent.includes('卧式离心泵组')));

/* ---------- 移动端 ---------- */
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(BASE + '#/assets/gate-valve', { waitUntil: 'networkidle' });
await page.waitForSelector('.assets-page', { timeout: 30000 });
await page.waitForSelector('.asset-canvas', { timeout: 30000 });
await loadingHidden();
await wait(500);
check('移动端模型库可加载', await ev(() => !!document.querySelector('.asset-canvas') && document.querySelector('.asset-info-head h2')?.textContent.includes('闸阀')));
check('移动端无横向溢出', await ev(() => document.documentElement.scrollWidth <= window.innerWidth + 2), String(await ev(() => [document.documentElement.scrollWidth, window.innerWidth])));
await shot('assets-06-mobile');

check('无页面脚本错误 / 控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));

const passed = results.filter((r) => r.ok).length;
console.log(`\nRESULT ${passed}/${results.length}`);
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ results, consoleErrors, passed, total: results.length }, null, 2));
await browser.close();
process.exit(passed === results.length ? 0 : 1);
