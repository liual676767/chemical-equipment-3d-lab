/** 泵样板优化后截图：与基线同角度 + 轴向剖视 + 内窥 8 站 + 手机总览。 */
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.CAPTURE_BASE ?? 'http://127.0.0.1:5190/';
const OUT = path.resolve('outputs/pump-template/after');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  ...browserOptions, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE + '#/device/pump');
await page.waitForSelector('.canvas-wrap canvas');
await page.waitForFunction(() => window.__chem3d?.device?.id === 'pump');
await wait(1600);
const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), timeout: 90000 });
const tab = async (t) => { await page.evaluate((x) => { [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.includes(x))?.click(); }, t); await wait(900); };

await shot('d1-overall');
await page.evaluate(() => window.__chem3d.scene.setView('front'));
await wait(800);
await shot('d2-front');

await tab('剖视');
await page.evaluate(() => window.__chem3d.scene.setView('front'));
await wait(700);
await shot('d3-section-axial-z');
// 与基线一致的 X 剖面（42%），便于前后同角度对照
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.wb-bottom button')];
  btns.find((b) => b.textContent.includes('左右剖'))?.click();
  const range = document.querySelector('.wb-bottom input.range');
  if (range) { range.value = '42'; range.dispatchEvent(new Event('input', { bubbles: true })); }
  window.__chem3d.scene.setView('iso');
});
await wait(800);
await shot('d3b-section-x42-baseline-angle');

await tab('透明观察');
await page.evaluate(() => {
  const s = window.__chem3d.scene;
  s.setShellsHidden(true);
  s.setPartHidden('pipeSuction', true);
  s.setPartHidden('pipeElbowIn', true);
});
await wait(700);
await shot('d4-xray-internals');

await tab('内窥');
await wait(900);
for (let i = 0; i < 8; i++) {
  if (i > 0) {
    await page.evaluate(() => { document.querySelector('.endo-stops .endo-chip.active')?.nextElementSibling?.click(); });
    await page.waitForFunction(() => !window.__chem3d.scene.endoTween, null, { timeout: 4000 });
    await wait(150);
  }
  const name = await page.evaluate(() => window.__chem3d.scene.getEndoscopeState().stop?.name ?? '');
  await shot(`e${i + 1}-${name.replace(/[（）()·\s]/g, '').slice(0, 6)}`);
}

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
await mobile.goto(BASE + '#/device/pump');
await mobile.waitForSelector('.canvas-wrap canvas');
await mobile.waitForFunction(() => window.__chem3d?.device?.id === 'pump');
await wait(1600);
await mobile.screenshot({ path: path.join(OUT, 'm1-overall.png'), timeout: 60000 });
await mobile.locator('.mode-tab').filter({ hasText: '内窥' }).click();
await wait(1200);
await mobile.screenshot({ path: path.join(OUT, 'm2-endoscope.png'), timeout: 60000 });
await mobile.close();
await browser.close();
console.log('after screenshots ->', OUT);
