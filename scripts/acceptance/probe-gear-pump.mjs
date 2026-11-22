/**
 * 复现探针：gear-pump 引导拆装首步 window.__chem3d 为空的问题。
 * 运行：node scripts/acceptance/probe-gear-pump.mjs
 */
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../..', import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

const { createServer } = await import('vite');
const vite = await createServer({ root, server: { middlewareMode: true, hmr: false } });
const server = createHttpServer(vite.middlewares);
const listening = once(server, 'listening');
server.listen({ host: '127.0.0.1', port: 0 });
await listening;
const { port } = server.address();
const base = `http://127.0.0.1:${port}/`;
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

try {
  for (let round = 1; round <= 3; round++) {
    await page.goto(base + '#/device/gear-pump');
    await wait(1400);
    await page.evaluate(() => [...document.querySelectorAll('.mode-tab')].find((x) => x.textContent.includes('拆装练习')).click());
    await wait(600);
    for (let i = 0; i < 10; i++) {
      const s = await page.evaluate(() => window.__chem3d?.scene.getPracticeState() ?? null);
      if (!s) { console.log(`round ${round} sample ${i}: __chem3d 缺失`); break; }
      if (i === 0) console.log(`round ${round} 初始 installed=${s.installed.length} step=${s.stepIndex}`);
      await wait(120);
    }
    const step = await page.evaluate(() => {
      const s = window.__chem3d?.scene.getPracticeState();
      if (!s) return null;
      return s.steps[s.stepIndex];
    });
    if (!step) { console.log(`round ${round}: 拿不到首步`); continue; }
    console.log(`round ${round} 首步 ${step.action} ${step.partId}`);
    await page.evaluate((pid) => {
      const name = window.__chem3d.device.parts.find((p) => p.id === pid).name;
      [...document.querySelectorAll('.tree-item')].find((x) => x.querySelector('.tree-name')?.textContent === name).click();
    }, step.partId);
    await wait(100);
    const label = step.action === 'remove' ? '拆下选中零件' : '安装到位置';
    if (step.action === 'install') {
      const orient = await page.evaluate((pid) => window.__chem3d.device.parts.find((p) => p.id === pid).orientable, step.partId);
      if (orient) {
        const rs = await page.evaluate((pid) => window.__chem3d.scene.parts.get(pid).rotStep, step.partId);
        for (let i = 0; i < (4 - rs) % 4; i++) {
          await page.evaluate(() => [...document.querySelectorAll('.practice-actions button')].find((b) => b.textContent === '旋转 90°').click());
          await wait(50);
        }
      }
    }
    await page.evaluate((t) => [...document.querySelectorAll('.practice-actions button')].find((b) => b.textContent === t).click(), label);
    await wait(450);
    const after = await page.evaluate(() => window.__chem3d?.scene.getPracticeState() ?? null);
    console.log(`round ${round} 第一步后 state=${after ? `step=${after.stepIndex} errors=${after.errors} installed=${after.installed.length}` : 'null'}`);
  }
  console.log('控制台错误：', errors.length ? errors.join(' | ') : '无');
} finally {
  await browser.close();
  server.close();
  await vite.close();
}