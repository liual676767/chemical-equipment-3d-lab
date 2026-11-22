/**
 * 发布后线上走查（微沸喷烧 #/boil 页面）。
 *
 * 检查线上首页入口、五区标签、流程树、设备详情/追踪、流程播放控制与无控制台错误。
 * 运行：node scripts/verify-boil-online.mjs
 * 可用 BOIL_ONLINE_BASE 覆盖地址（默认线上站点）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = path.join(root, 'outputs', 'verify-boil-online');
mkdirSync(outDir, { recursive: true });
const BASE = process.env.BOIL_ONLINE_BASE ?? 'https://chem-equipment-3d-lab-r44x9hkn4ne.qoder.zone/';

const results = [];
const errors = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await chromium.launch({
  ...browserOptions,
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--disable-gpu-sandbox',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion'
  ]
});

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  page.setDefaultTimeout(120000);
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });

  await page.goto(BASE + '#/library', { waitUntil: 'networkidle' });
  await page.waitForSelector('.device-card', { timeout: 60000 });
  check('线上首页加载', await page.locator('.device-card').count() >= 18);
  check('首页保留微沸喷烧入口', await page.locator('.site-drop-menu [data-nav="boil"]').count() === 1 && await page.locator('.site-mobile-menu [data-nav="boil"]').count() === 1);

  await page.goto(BASE + '#/boil', { waitUntil: 'networkidle' });
  await page.waitForSelector('.boil-page', { timeout: 60000 });
  await wait(1200);
  check('线上打开微沸喷烧页面', await page.locator('.boil-page').count() === 1);
  check('页面标识 Phase 6 追踪与播放', (await page.locator('.boil-sub').innerText()).includes('Phase 6'));

  const tabs = page.locator('.boil-area-tab');
  check('五个工艺区 + 全部区域标签', await tabs.count() === 6, `实际 ${await tabs.count()}`);

  const equipmentRows = page.locator('[data-equipment-row]');
  check('流程树 18 个设备实例', await equipmentRows.count() === 18, `实际 ${await equipmentRows.count()}`);

  await page.click('[data-area-tab="area-02-combustion"]');
  await wait(700);
  check('区域标签可切换', (await page.locator('[data-area-tab="area-02-combustion"]').getAttribute('class') ?? '').includes('active'));

  await page.click('[data-equipment-row="eq-secondary-chamber"]');
  await wait(900);
  const detailText = await page.locator('.boil-detail').innerText();
  check('设备详情/追踪可用', detailText.includes('二燃室'));
  check('四根喷枪按平行支路展示', detailText.includes('喷枪') || (await page.locator('[data-equipment-row="eq-spray-gun-01"]').count()) === 1);

  check('流程播放控制存在', await page.locator('.boil-pb-play').count() === 1);
  await page.locator('.boil-pb-play').click();
  await wait(1500);
  const stepNo = await page.locator('.boil-pb-progress').getAttribute('aria-valuenow');
  check('流程播放可启动', Number(stepNo) >= 1, `step=${stepNo}`);
  await page.screenshot({ path: path.join(outDir, '01-boil-online.png') });

  check('线上无页面/控制台错误', errors.length === 0, errors.join(' | '));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.device-card', { timeout: 60000 });
  check('可返回首页', true);

  const passed = results.filter((r) => r.ok).length;
  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, passed, total: results.length, results, errors }, null, 2));
  console.log(`\n在线走查：${passed}/${results.length} 通过`);
  process.exitCode = passed === results.length ? 0 : 1;
} finally {
  await browser.close().catch(() => {});
}
