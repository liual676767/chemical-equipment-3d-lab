/* 工厂页面交互冒烟：总览、设备聚焦、细节浮层、法兰练习、记录、手机截图。 */
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.VERIFY_BASE ?? 'http://127.0.0.1:5173/';
const OUT = 'outputs/factory-smoke';
mkdirSync(OUT, { recursive: true });

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

const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

const step = async (name, fn) => {
  try {
    const r = await fn();
    console.log(`OK   ${name}${r ? ' — ' + r : ''}`);
  } catch (err) {
    console.log(`FAIL ${name} — ${String(err).split('\n')[0]}`);
  }
};

await page.goto(BASE + '#/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.factory-canvas', { timeout: 30000 });
await page.waitForTimeout(2600);

await step('总览审计', async () => {
  const a = await page.evaluate(() => window.__factoryAudit?.());
  if (!a || a.issues.length) throw new Error('审计问题：' + JSON.stringify(a?.issues));
  return `pipes ${a.runtime.pipesBuilt} / ports ${a.runtime.portsLinked} / nodes ${a.counts.nodes}`;
});
await step('总览标签', async () => {
  const labels = await page.locator('.factory-label').count();
  const visible = await page.locator('.factory-label:visible').count();
  return `labels ${labels} visible ${visible}`;
});
await page.screenshot({ path: `${OUT}/01-overview.png` });

await step('定位 P-202', async () => {
  await page.evaluate(() => { location.hash = '#/node/P-202'; });
  await page.waitForTimeout(1400);
  const name = await page.locator('.factory-info .fi-name').first().textContent();
  if (!name?.includes('气动双隔膜泵')) throw new Error('信息卡未显示 P-202：' + name);
  return name;
});
await page.screenshot({ path: `${OUT}/02-node-p202.png` });

await step('打开细节', async () => {
  await page.getByRole('button', { name: '走近查看' }).click();
  await page.waitForTimeout(1200);
  const title = await page.locator('.factory-detail-title').textContent();
  return title;
});
await page.screenshot({ path: `${OUT}/03-detail.png` });

await step('外观参照', async () => {
  await page.locator('.factory-seg-btn', { hasText: '外观参照' }).click();
  await page.locator('.factory-seg-btn.is-active', { hasText: '外观参照' }).waitFor({ timeout: 15000 });
  return '外观参照已激活';
});
await page.screenshot({ path: `${OUT}/04-appearance.png` });

await step('切回内部结构', async () => {
  await page.locator('.factory-seg-btn', { hasText: '内部教学结构' }).click();
  await page.waitForTimeout(900);
  const active = await page.locator('.factory-seg-btn.is-active').textContent();
  return active;
});

await step('接口识别热区', async () => {
  const picks = await page.locator('.factory-port-item').count();
  if (picks < 2) throw new Error('接口列表不足');
  await page.locator('.factory-port-item', { hasText: '进口总管' }).click();
  await page.waitForTimeout(300);
  await page.locator('.factory-port-item', { hasText: '出口总管' }).click();
  await page.waitForTimeout(300);
  return `ports ${picks}`;
});

await step('返回厂区恢复视角', async () => {
  await page.getByRole('button', { name: '返回厂区' }).click();
  await page.waitForTimeout(1400);
  const detailGone = await page.locator('.factory-detail').count();
  if (detailGone) throw new Error('细节浮层未关闭');
  const name = await page.locator('.factory-info .fi-name').first().textContent();
  return name;
});
await page.screenshot({ path: `${OUT}/05-returned.png` });

await step('打开法兰练习', async () => {
  await page.evaluate(() => { location.hash = '#/practice/JOINT-201'; });
  await page.waitForSelector('.factory-practice', { timeout: 12000 });
  await page.waitForTimeout(1800);
  return '练习界面已打开';
});
await page.screenshot({ path: `${OUT}/06-practice.png` });

await step('缺垫片点名提示', async () => {
  await page.locator('.fp-tray-btn[data-key="bolt"]').click();
  await page.waitForTimeout(250);
  const text = await page.locator('.fp-msg').textContent();
  if (!text?.includes('密封垫片') || !text?.includes('泵侧法兰密封面')) throw new Error('缺件提示不完整：' + text);
  return text.slice(0, 46) + '…';
});

await step('装入垫片', async () => {
  await page.locator('.fp-tray-btn[data-key="gasket"]').click();
  await page.waitForTimeout(350);
  const text = await page.locator('.fp-msg').textContent();
  return text?.slice(0, 30);
});

await step('M12 规格不符提示', async () => {
  await page.locator('.fp-tray-btn[data-key="boltM12"]').click();
  await page.waitForTimeout(300);
  const text = await page.locator('.fp-msg').textContent();
  if (!text?.includes('M12') && !text?.includes('规格不匹配')) throw new Error('未见规格提示：' + text);
  return text?.slice(0, 50) + '…';
});

await step('穿 4 条 M16 螺栓', async () => {
  for (let i = 0; i < 4; i++) {
    await page.locator('.fp-tray-btn[data-key="bolt"]').click();
    await page.waitForTimeout(220);
  }
  const text = await page.locator('.fp-check li').nth(1).textContent();
  return text;
});

await step('旋 4 个 M16 螺母', async () => {
  for (let i = 0; i < 4; i++) {
    await page.locator('.fp-tray-btn[data-key="nut"]').click();
    await page.waitForTimeout(220);
  }
  const text = await page.locator('.fp-msg').textContent();
  if (!text?.includes('连接完成')) throw new Error('未提示完成：' + text);
  return text.slice(0, 40);
});
await page.screenshot({ path: `${OUT}/07-practice-done.png` });

await step('练习记录落盘', async () => {
  const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('chem3d-factory:v1') || '{}'));
  if (!rec.joints?.['JOINT-201']?.done) throw new Error('缺少 JOINT-201 完成记录');
  return `joints ${Object.keys(rec.joints).length} / task step ${rec.task?.step}`;
});

await step('返回厂区', async () => {
  await page.getByRole('button', { name: '返回厂区' }).click();
  await page.waitForTimeout(1300);
  const practiceGone = await page.locator('.factory-practice').count();
  if (practiceGone) throw new Error('练习层未关闭');
  return '已返回';
});
await page.screenshot({ path: `${OUT}/08-after-practice.png` });

/* 手机端（先关闭桌面页，避免软件渲染占用导致加载超时） */
await page.close();
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
mobile.on('pageerror', (e) => errors.push('mobile: ' + String(e)));
await mobile.goto(BASE + '#/', { waitUntil: 'domcontentloaded', timeout: 90000 });
await mobile.waitForSelector('.factory-canvas', { timeout: 60000 });
await mobile.waitForTimeout(2600);
await mobile.screenshot({ path: `${OUT}/09-mobile-overview.png` });
await step('手机定位泵+信息卡', async () => {
  await mobile.evaluate(() => { location.hash = '#/node/P-202'; });
  await mobile.waitForTimeout(1400);
  const visible = await mobile.locator('.factory-info').isVisible();
  return `info visible ${visible}`;
});
await mobile.screenshot({ path: `${OUT}/10-mobile-info.png` });

await browser.close();
console.log('ERRORS', errors.length ? errors.slice(0, 10) : 'none');