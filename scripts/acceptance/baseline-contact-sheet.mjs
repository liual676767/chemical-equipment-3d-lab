/** 将基线截图拼成两张联络表，便于逐台检查（仅验收用，不进入站点）。 */
import { chromium } from 'playwright-core';
import { browserOptions } from '../browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('outputs/baseline-2026-11-19');
const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'summary.json'), 'utf8'));
const names = Object.fromEntries(s.devices.map((d) => [d.id, d.desktop?.name ?? d.id]));
const groups = [s.devices.slice(0, 9), s.devices.slice(9)];
const browser = await chromium.launch({ ...browserOptions, headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 2000 } });
for (let gi = 0; gi < groups.length; gi++) {
  const rows = groups[gi].map((d) => {
    const imgs = ['d1-overall', 'd2-front', 'd3-section', 'd4-xray', 'm1-overall'].map((n) => {
      const p = path.join(ROOT, d.id, n + '.png');
      return fs.existsSync(p) ? `<img src="file:///${p.replace(/\\/g, '/')}">` : '<span class="missing">缺图</span>';
    }).join('');
    return `<section><h2>${d.id} · ${names[d.id]}</h2><div class="row">${imgs}</div></section>`;
  }).join('');
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#111;color:#eee;font-family:Segoe UI,sans-serif}
    section{padding:6px 10px;border-bottom:1px solid #333}
    h2{font-size:15px;margin:2px 0 4px;color:#7fc4ff}
    .row{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}
    img{width:100%;display:block;border:1px solid #444}
    .missing{display:flex;height:180px;align-items:center;justify-content:center;color:#f66}
  </style>${rows}`;
  const f = path.join(ROOT, `sheet-${gi + 1}.html`);
  fs.writeFileSync(f, html);
  await page.goto('file:///' + f.replace(/\\/g, '/'));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(ROOT, `sheet-${gi + 1}.png`), fullPage: true, timeout: 120000 });
  console.log('sheet', gi + 1);
}
await browser.close();
