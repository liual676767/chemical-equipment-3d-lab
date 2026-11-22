/* 工厂性能快照（SwiftShader 软件渲染环境）：绘制调用/三角面/FPS。仅作本机对照，不代表真实 GPU 或真机。 */
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.VERIFY_BASE ?? 'http://127.0.0.1:5173/';
const OUT = path.join('outputs', 'factory-acceptance');
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  ...browserOptions,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion']
});
const report = { generatedAt: new Date().toISOString(), environment: 'Edge headless + SwiftShader 软件渲染（非真实 GPU）' };

async function sample(page, name) {
  const s = await page.evaluate(() => window.__factoryDebug?.debug?.());
  report[name] = s ? { fps: s.fps, drawCalls: s.drawCalls, triangles: s.triangles, points: s.points, geometries: s.geometries, textures: s.textures, walk: s.walk } : null;
}

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE + '#/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.factory-canvas', { timeout: 60000 });
await wait(3500);
await sample(page, 'desktopOverview');
await page.evaluate(() => { location.hash = '#/node/P-202'; });
await wait(2000);
await sample(page, 'desktopPumpCloseup');
await page.getByRole('button', { name: '走近查看' }).click();
await wait(900);
await page.locator('.factory-seg-btn', { hasText: '外观参照' }).click();
await page.locator('.factory-seg-btn.is-active', { hasText: '外观参照' }).waitFor({ timeout: 25000 });
await wait(1500);
await sample(page, 'desktopAppearanceGLB');
await page.keyboard.press('Escape');
await wait(900);
await page.getByRole('button', { name: '行走模式' }).click();
await page.waitForFunction(() => window.__factoryDebug.debug().walk === true, { timeout: 8000 });
await wait(1800);
await sample(page, 'desktopWalk');
await page.keyboard.press('Escape');
await page.close();

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await mobile.goto(BASE + '#/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await mobile.waitForSelector('.factory-canvas', { timeout: 60000 });
await wait(3500);
await sample(mobile, 'mobileOverview');
await mobile.close();

writeFileSync(path.join(OUT, 'perf.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();