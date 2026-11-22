/**
 * 生成首页设备卡静态预览图：用现有真实教学模型在 Edge（SwiftShader）中渲染一次，
 * 输出到 public/thumbs/<deviceId>.png。设备几何变更后重新运行即可。
 * 用法：npm run thumbs
 */
import { createServer as createViteServer } from 'vite';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(ROOT, 'public', 'thumbs');
fs.mkdirSync(OUT, { recursive: true });

const vite = await createViteServer({
  root: ROOT,
  server: { middlewareMode: true, hmr: false },
  logLevel: 'error'
});
const server = createHttpServer(vite.middlewares);
const listening = once(server, 'listening');
server.listen({ host: '127.0.0.1', port: 0 });
await listening;
const address = server.address();
const base = `http://127.0.0.1:${address.port}/`;

const browser = await chromium.launch({
  ...browserOptions,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox']
});
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + 'scripts/preview/thumbs.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__thumbStatus, null, { timeout: 180000 });
  const status = await page.evaluate(() => window.__thumbStatus);
  if (status !== 'done') {
    throw new Error('缩略图渲染失败：' + (await page.evaluate(() => window.__thumbError ?? '未知错误')));
  }
  const thumbs = await page.evaluate(() => window.__thumbs);
  let total = 0;
  for (const [id, dataUrl] of Object.entries(thumbs)) {
    const base64 = String(dataUrl).split(',')[1] ?? '';
    const buf = Buffer.from(base64, 'base64');
    fs.writeFileSync(path.join(OUT, `${id}.png`), buf);
    total += buf.length;
    console.log(`wrote public/thumbs/${id}.png  ${(buf.length / 1024).toFixed(1)} KB`);
  }
  console.log(`\n${Object.keys(thumbs).length} 张缩略图，共 ${(total / 1024).toFixed(1)} KB`);
  if (errors.length) console.log('页面错误：', errors.join(' | '));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await vite.close();
}
