/* 工坊真实操作验证：覆盖需求第 13 条最小清单 + UI/持久化/响应式。
 * 运行：node scripts/verify-workshop.mjs （默认 dev server 5173，可用 VERIFY_BASE 覆盖） */
import { chromium } from 'playwright-core';
import { browserOptions, webglArgs } from './browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.VERIFY_BASE ?? 'http://127.0.0.1:5173/';
const OUT = path.resolve('outputs/verify-workshop');
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => { consoleErrors.push('pageerror: ' + e.message); console.log('pageerror:', e.message); });
page.on('console', (m) => { if (m.type() === 'error') { consoleErrors.push('console: ' + m.text()); console.log('console:', m.text()); } });
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? '验证方案B' : undefined));

const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), timeout: 60000 });
const settle = async () => {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  await wait(400);
};
const ev = (fn, ...args) => page.evaluate(({ src, args }) => (0, eval)('(' + src + ')')(...args), { src: fn.toString(), args });
const clickText = (sel, text) => ev(({ sel, text }) => {
  const b = [...document.querySelectorAll(sel)].find((x) => x.textContent.trim() === text);
  if (!b) throw new Error('button not found: ' + text);
  b.click();
}, { sel, text });

/* 语义用例由开发环境夹具预置，包括专门用于导入诊断的既存相交。真实落位另从画布验证。 */
const installHelpers = () => ev(() => {
  window.__t = {
    add(partId, pos, spec) {
      const added = window.__ws.seedInstanceAt(partId, pos, spec);
      if (!added) throw new Error('Fixture part could not be created: ' + partId);
      return window.__ws.state.instances.at(-1).uid;
    },
    conn(a, b) { return window.__ws.makeConnection(a, b); },
    wp(uid, port) {
      const w = window.__ws;
      const i = w.state.instances.find((x) => x.uid === uid);
      const p = w.portsOf(uid).find((x) => x.id === port);
      const [x, y, z] = i.rot;
      const c1 = Math.cos(x / 2), s1 = Math.sin(x / 2), c2 = Math.cos(y / 2), s2 = Math.sin(y / 2), c3 = Math.cos(z / 2), s3 = Math.sin(z / 2);
      const q = { x: s1 * c2 * c3 + c1 * s2 * s3, y: c1 * s2 * c3 - s1 * c2 * s3, z: c1 * c2 * s3 + s1 * s2 * c3, w: c1 * c2 * c3 - s1 * s2 * s3 };
      const [vx, vy, vz] = p.pos;
      const ix = q.w * vx + q.y * vz - q.z * vy, iy = q.w * vy + q.z * vx - q.x * vz, iz = q.w * vz + q.x * vy - q.y * vx, iw = -q.x * vx - q.y * vy - q.z * vz;
      return [
        i.pos[0] + ix * q.w - iw * q.x - iy * q.z + iz * q.y,
        i.pos[1] + iy * q.w - iw * q.y - iz * q.x + ix * q.z,
        i.pos[2] + iz * q.w - iw * q.z - ix * q.y + iy * q.x
      ];
    },
    screen(uid) {
      const w = window.__ws;
      const i = w.state.instances.find((x) => x.uid === uid);
      const ps = w.portsOf(uid);
      let cx = i.pos[0], cy = i.pos[1], cz = i.pos[2];
      if (ps.length) {
        let sx = 0, sy = 0, sz = 0;
        for (const p of ps) { const q = window.__t.wp(uid, p.id); sx += q[0]; sy += q[1]; sz += q[2]; }
        cx = sx / ps.length; cy = sy / ps.length; cz = sz / ps.length;
      }
      const v = w.engine.camera.position.clone();
      v.set(cx, cy, cz);
      v.project(w.engine.camera);
      const r = document.querySelector('.ws-canvas').getBoundingClientRect();
      return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
    },
    counts() { const s = window.__ws.state; return { i: s.instances.length, c: s.connections.length, g: s.groups.length }; },
    soloTarget() {
      const w = window.__ws; const s = w.state;
      for (const i of s.instances) {
        const cc = s.connections.filter((c) => (c.a.uid === i.uid || c.b.uid === i.uid) && (c.kind === 'flange' || c.kind === 'thread' || c.kind === 'weld')).length;
        if (!cc) continue;
        const sp = window.__t.screen(i.uid);
        if (sp[0] < 2 || sp[1] < 2 || sp[0] > window.innerWidth - 2 || sp[1] > window.innerHeight - 2) continue;
        const hit = w.engine.pickUid({ clientX: sp[0], clientY: sp[1] });
        if (hit && hit.uid === i.uid) return { uid: i.uid, sp, cc };
      }
      return null;
    },
    hash() { return JSON.stringify(window.__ws.state); }
  };
});
await page.goto(BASE + '#/workshop', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await installHelpers();
const T = (fn, ...a) => ev(fn, ...a);

/* ---------- A 首页入口与页面加载 ---------- */
await page.goto(BASE + '#/library', { waitUntil: 'networkidle' });
await ev(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await wait(600);
const banner = await ev(() => !!document.querySelector('.module-entry[data-module="workshop"]'));
check('首页含工坊入口', banner);
await ev(() => { document.querySelector('.module-entry[data-module="workshop"]').click(); });
await page.waitForTimeout(900);
const loaded = await ev(() => ({
  hash: location.hash, canvas: !!document.querySelector('.ws-canvas canvas'),
  items: document.querySelectorAll('.ws-part').length,
  ready: document.querySelectorAll('.ws-part-status.ready').length,
  dev: document.querySelectorAll('.ws-part-status.dev').length,
  coded: [...document.querySelectorAll('.ws-part-cat')].filter((tag) => /^P\d{3}\s/.test(tag.textContent)).length,
  declared: document.querySelector('.ws-lib-count').textContent.match(/\d+/g).map(Number)
}));
check('入口跳转到工坊且三维画布就绪', loaded.hash.includes('/workshop') && loaded.canvas, JSON.stringify(loaded));
const statusFilter = page.getByRole('combobox', { name: '零件可用状态' });
await statusFilter.selectOption('dev');
const devCards = await ev(() => ({
  items: document.querySelectorAll('.ws-part').length,
  addButtons: document.querySelectorAll('.ws-part-actions button').length,
  dev: document.querySelectorAll('.ws-part-status.dev').length
}));
await statusFilter.selectOption('ready');
check('零件库默认列出已上线模型，开发中条目在独立筛选中',
  loaded.items === loaded.ready && loaded.ready === loaded.declared[0] && loaded.coded >= 50 && loaded.dev === 0
  && devCards.items === loaded.declared[1] && devCards.dev === devCards.items && devCards.addButtons === 0,
  JSON.stringify({ loaded, devCards }));
await installHelpers();

/* 搜索与分类过滤 */
await page.fill('.ws-lib-searchwrap input', '球阀');
await wait(200);
const searched = await ev(() => [...document.querySelectorAll('.ws-part-name')].map((x) => x.textContent));
check('零件库搜索「球阀」命中', searched.some((t) => t.includes('球阀')) && searched.length < 10, searched.join(','));
await page.fill('.ws-lib-searchwrap input', '');
await clickText('.ws-lib-chips .chip', '阀门');
await wait(200);
const catOnly = await ev(() => {
  const tags = [...document.querySelectorAll('.ws-part-cat')];
  return tags.length >= 10 && tags.every((tag) => tag.textContent.includes('阀门'));
});
check('分类过滤仅显示阀门', catOnly);
await clickText('.ws-lib-chips .chip', '全部');

/* 点击添加 → 放置模式 → 画布点击落位 */
await page.locator('.ws-part[data-part-id="pipe"]').getByRole('button', { name: '添加到场景' }).click();
await wait(300);
const hint = await ev(() => !!document.querySelector('.ws-place-hint'));
const canvasBox = await ev(() => { const r = document.querySelector('.ws-canvas').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
await page.mouse.move(canvasBox[0], canvasBox[1]);
await wait(200);
await page.mouse.click(canvasBox[0], canvasBox[1]);
await wait(400);
const placed = await T(() => window.__t.counts());
check('点击添加进入放置模式并落位成功', hint && placed.i === 1, JSON.stringify(placed));
const pipeA = await ev(() => window.__ws.state.instances[0].uid);

/* ---------- B 管道拼接与设备连接 ---------- */
const elbow = await T((uid) => window.__t.add('elbow90', [6, 1, 0]), pipeA);
const c1 = await T((a, b) => window.__t.conn({ uid: a, port: 'p2' }, { uid: b, port: 'p1' }), pipeA, elbow);
const gap1 = await T((a, b) => {
  const p = window.__t.wp(a, 'p2'), q = window.__t.wp(b, 'p1');
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}, pipeA, elbow);
check('直管+90°弯头连接并自动对齐', c1.ok && gap1 < 1e-4, `gap=${gap1.toExponential(2)}`);

const tee = await T(() => window.__t.add('tee', [0, 6, 0]));
const pipeB = await T(() => window.__t.add('pipe', [0, 9, 0]));
const c2 = await T((a, b) => window.__t.conn({ uid: a, port: 'p2' }, { uid: b, port: 'p1' }), elbow, tee);
const c3 = await T((a, b) => window.__t.conn({ uid: a, port: 'p3' }, { uid: b, port: 'p1' }), tee, pipeB);
check('三通支管连接（主管+支管）', c2.ok && c3.ok, `${c2.reason ?? ''}${c3.reason ?? ''}`);

const bigPipe = await T(() => window.__t.add('pipe', [-6, 1, 0], { dn: 80 }));
const red = await T(() => window.__t.add('reducer-conc', [-3, 1, 0], { dn: 80 }));
const smallPipe = await T(() => window.__t.add('pipe', [-1, 1, 0], { dn: 50 }));
const c4 = await T((a, b) => window.__t.conn({ uid: a, port: 'p2' }, { uid: b, port: 'p1' }), bigPipe, red);
const c5 = await T((a, b) => window.__t.conn({ uid: a, port: 'p2' }, { uid: b, port: 'p1' }), red, smallPipe);
check('异径管 DN80→DN50 过渡连接', c4.ok && c5.ok, `${c4.reason ?? ''}${c5.reason ?? ''}`);
const badDn = await T((a, b) => window.__t.conn({ uid: a, port: 'p1' }, { uid: b, port: 'p2' }), bigPipe, smallPipe);
check('DN 不匹配给出具体原因', !badDn.ok && /尺寸不匹配/.test(badDn.reason ?? ''), badDn.reason);

const fl = await T(() => window.__t.add('flange-so', [3, 4, 0]));
const badType = await T((a, b) => window.__t.conn({ uid: a, port: 'p2' }, { uid: b, port: 'face' }), pipeB, fl);
check('接口类型不同给出具体原因', !badType.ok && /连接类型不同/.test(badType.reason ?? ''), badType.reason);
const dup = await T((a, b) => window.__t.conn({ uid: a, port: 'p2' }, { uid: b, port: 'p1' }), pipeA, elbow);
check('重复连接被拒绝（接口已占用）', !dup.ok && /已占用/.test(dup.reason ?? ''), dup.reason);

/* 法兰—垫片—法兰 + 螺栓螺母 */
const pipeC = await T(() => window.__t.add('pipe', [8, 1, 0]));
const fa = await T(() => window.__t.add('flange-so', [10, 1, 0]));
const gk = await T(() => window.__t.add('gasket', [11, 1, 0]));
const fb = await T(() => window.__t.add('flange-so', [12, 1, 0]));
const pipeD = await T(() => window.__t.add('pipe', [14, 1, 0]));
const f1 = await T((a, b) => window.__t.conn({ uid: a, port: 'p2' }, { uid: b, port: 'weld' }), pipeC, fa);
const f2 = await T((a, b) => window.__t.conn({ uid: a, port: 'face' }, { uid: b, port: 'f1' }), fa, gk);
const f3 = await T((a, b) => window.__t.conn({ uid: a, port: 'f2' }, { uid: b, port: 'face' }), gk, fb);
const f4 = await T((a, b) => window.__t.conn({ uid: a, port: 'weld' }, { uid: b, port: 'p1' }), fb, pipeD);
check('法兰焊接+垫片+法兰配对序列', f1.ok && f2.ok && f3.ok && f4.ok, [f1, f2, f3, f4].map((x) => x.reason ?? '').join('|'));
const flangeConnId = await ev(() => window.__ws.state.connections.find((c) => c.kind === 'flange' && c.a.uid === window.__ws.state.instances.find((i) => i.partId === 'flange-so')?.uid)?.id
  ?? window.__ws.state.connections.find((c) => c.kind === 'flange')?.id);
await T((id) => window.__ws.quickFasteners(id), flangeConnId);
const kit = await T(() => {
  const s = window.__ws.state;
  return { bolts: s.instances.filter((i) => i.partId === 'bolt').length, nuts: s.instances.filter((i) => i.partId === 'nut').length };
});
const t4 = await T(() => window.__ws.taskResult('t4-flange'));
check('一键紧固装满孔位（螺栓+螺母）', kit.bolts === 4 && kit.nuts === 4, JSON.stringify(kit));
check('任务4 法兰组装判定通过', t4?.done === true, JSON.stringify(t4?.items?.map((i) => i.ok)));

/* 止回阀方向 */
const pipeE = await T(() => window.__t.add('pipe', [0, -4, 0], { endType: 'flange' }));
const chk = await T(() => window.__t.add('valve-check', [2, -4, 0]));
const pipeF = await T(() => window.__t.add('pipe', [5, -4, 0], { endType: 'flange' }));
const v1 = await T((a, b) => window.__t.conn({ uid: a, port: 'p2' }, { uid: b, port: 'p1' }), pipeE, chk);
const v2 = await T((a, b) => window.__t.conn({ uid: a, port: 'p2' }, { uid: b, port: 'p1' }), chk, pipeF);
const flowOk = await T((a, b) => !!window.__ws.findPath({ uid: a, port: 'p1' }, { uid: b, port: 'p2' }), pipeE, pipeF);
check('止回阀正向安装且连通', v1.ok && v2.ok && flowOk);
const pipeG = await T(() => window.__t.add('pipe', [0, -8, 0], { endType: 'flange' }));
const chk2 = await T(() => window.__t.add('valve-check', [2, -8, 0]));
const pipeH = await T(() => window.__t.add('pipe', [5, -8, 0], { endType: 'flange' }));
const g1 = await T((a, b) => window.__t.conn({ uid: a, port: 'p2' }, { uid: b, port: 'p2' }), pipeG, chk2);
const g2 = await T((a, b) => window.__t.conn({ uid: a, port: 'p1' }, { uid: b, port: 'p1' }), chk2, pipeH);
const flowRev = await T((a, b) => {
  const r = window.__ws.findPath({ uid: a, port: 'p1' }, { uid: b, port: 'p2' });
  const s = window.__ws.state;
  return { ok: r.ok, path: r.path.map((p) => (s.instances.find((i) => i.uid === p.uid)?.partId ?? p.uid) + ':' + p.port) };
}, pipeG, pipeH);
check('止回阀反装连通检查失败', g1.ok && g2.ok && flowRev.ok === false, `g1=${g1.ok} g2=${g2.ok} rev=${flowRev.ok} path=${flowRev.path.join('>')}`);

/* 储罐→立管→弯头→水平管→泵 */
const tank = await T(() => window.__t.add('tank-vertical', [6, 0, 6]));
const down = await T(() => window.__t.add('pipe', [6, 3, 6], { dn: 80, length: 400, endType: 'flange' }));
const el2 = await T(() => window.__t.add('elbow90', [6, 1, 6], { dn: 80, endType: 'flange' }));
const run = await T(() => window.__t.add('pipe', [0, 1, 6], { dn: 80, length: 1000, endType: 'flange' }));
const pump = await T(() => window.__t.add('pump-centrifugal', [-8, 0, 6]));
const k1 = await T((a, b) => window.__t.conn({ uid: a, port: 'out' }, { uid: b, port: 'p1' }), tank, down);
const k2 = await T((a, b) => window.__t.conn({ uid: a, port: 'p2' }, { uid: b, port: 'p1' }), down, el2);
const k3 = await T((a, b) => window.__t.conn({ uid: a, port: 'p2' }, { uid: b, port: 'p1' }), el2, run);
const k4 = await T((a, b) => window.__t.conn({ uid: a, port: 'p2' }, { uid: b, port: 'in' }), run, pump);
const tankPath = await T((a, b) => !!window.__ws.findPath({ uid: a, port: 'in' }, { uid: b, port: 'out' }), tank, pump);
const t7 = await T(() => window.__ws.taskResult('t7-tank-pump'));
check('储罐→泵整链连接并连通', k1.ok && k2.ok && k3.ok && k4.ok && tankPath, [k1, k2, k3, k4].map((x) => x.reason ?? '').join('|'));
check('任务7 储罐到泵判定通过', t7?.done === true);
const badFlow = await T((a, b) => window.__t.conn({ uid: a, port: 'out' }, { uid: b, port: 'p2' }), pump, await T(() => window.__t.add('valve-check', [9, -8, 0], { dn: 65 })));
check('泵出口对止回阀出口被流向规则拒绝', !badFlow.ok && /流向/.test(badFlow.reason ?? ''), badFlow.reason);
await settle();
await shot('01-network');

/* ---------- C 连通检查 / 干涉检查对话框 ---------- */
await clickText('.ws-tool', '连通检查');
await wait(300);
const dlg1 = await ev(() => !!document.querySelector('.ws-modal'));
await ev(({ a, b }) => {
  const sels = document.querySelectorAll('.ws-connect-selects select');
  sels[0].value = a; sels[1].value = b;
}, { a: `${tank}|in`, b: `${pump}|out` });
await clickText('.ws-modal button', '检查连通');
await wait(300);
const connResult = await ev(() => document.querySelector('.ws-connect-result')?.textContent ?? '');
check('连通检查对话框给出路径与流向示意', dlg1 && connResult.includes('连通成立'), connResult.slice(0, 60));
await shot('02-connect-dialog');
await clickText('.ws-modal button', '关闭');

const ovA = await T(() => window.__t.add('pipe', [20, 1, 20]));
const ovB = await T(() => window.__t.add('pipe', [20.2, 1, 20]));
await clickText('.ws-tool', '干涉检查');
await wait(300);
const spatialTxt = await ev(() => document.querySelector('.ws-modal-body')?.textContent ?? '');
const listsOverlap = spatialTxt.includes('直管') && spatialTxt.includes('查看');
check('干涉检查识别重叠且排除正确连接', listsOverlap, spatialTxt.slice(0, 80));
await clickText('.ws-modal button', '关闭');
await T((a, b) => { window.__ws.select([a, b]); window.__ws.deleteSelection(); }, ovA, ovB);

/* ---------- D 真实指针拖拽 ---------- */
await clickText('.ws-tool', '适配视图');
await settle();
await clickText('.ws-tool', '移动');

/* 夹在垫片与直管之间的法兰不能沿斜向穿过直管，保持原连接。 */
const solo = await T(() => window.__t.soloTarget());
const cBefore = solo?.cc ?? 0;
const sp2 = solo?.sp ?? [0, 0];
await page.keyboard.down('Alt');
await page.mouse.move(sp2[0], sp2[1]);
await page.mouse.down();
await page.mouse.move(sp2[0] + 60, sp2[1] - 30, { steps: 8 });
const soloMid = await ev(() => ({
  uid: window.__ws.engine.drag?.uid,
  warning: document.querySelector('.ws-drag-chip')?.textContent ?? ''
}));
await page.mouse.up();
await page.keyboard.up('Alt');
await wait(400);
const cAfter = await T((u) => window.__ws.state.connections.filter((c) => c.a.uid === u || c.b.uid === u).length, solo?.uid ?? '');
check('Alt 斜拖受阻后保留连接并提示', cBefore > 0 && cAfter === cBefore && soloMid?.warning.includes('阻挡') && soloMid?.uid === solo?.uid, `${cBefore}→${cAfter} hit=${soloMid?.uid === solo?.uid}`);

/* 整体拖拽连通管组（重新适配视图后） */
await clickText('.ws-tool', '适配视图');
await settle();
const before = await T((u) => {
  const s = window.__ws.state;
  const t = s.instances.find((i) => i.uid === u);
  const p = s.instances.find((i) => i.partId === 'pump-centrifugal');
  return { tank: [...t.pos], pump: [...p.pos], c: s.connections.length };
}, tank);
const sp = await T((u) => window.__t.screen(u), tank);
await page.mouse.move(sp[0], sp[1]);
await page.mouse.down();
await page.mouse.move(sp[0] + 70, sp[1] + 20, { steps: 10 });
const midDrag = await ev(() => { const d = window.__ws.engine.drag; return d ? { uid: d.uid, kind: d.kind, moved: d.moved, n: d.uids.length, solo: d.solo } : null; });
await page.mouse.up();
await wait(400);
const after = await T((u) => {
  const s = window.__ws.state;
  const t = s.instances.find((i) => i.uid === u);
  const p = s.instances.find((i) => i.partId === 'pump-centrifugal');
  return { tank: [...t.pos], pump: [...p.pos], c: s.connections.length };
}, tank);
const dTank = [after.tank[0] - before.tank[0], after.tank[2] - before.tank[2]];
const dPump = [after.pump[0] - before.pump[0], after.pump[2] - before.pump[2]];
const moved = Math.hypot(...dTank) > 0.4;
const whole = Math.abs(dTank[0] - dPump[0]) < 1e-6 && Math.abs(dTank[1] - dPump[1]) < 1e-6 && after.c === before.c;
check('拖拽移动连通管组整体且连接保留', moved && whole && midDrag?.uid === tank && midDrag?.n === 5, `d=${dTank.map((v) => v.toFixed(2))} conns ${before.c}→${after.c} n=${midDrag?.n}`);

/* ---------- E 参数编辑 ---------- */
const freePipe = await T(() => window.__t.add('pipe', [20, 0, 32]));
await T((u) => window.__ws.select([u]), freePipe);
await wait(200);
const dnBefore = await T((u) => window.__ws.state.instances.find((i) => i.uid === u).spec.dn, freePipe);
await ev(() => {
  const sel = document.querySelector('.ws-spec select');
  sel.value = '80';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
});
await wait(300);
const dnAfter = await T((u) => window.__ws.state.instances.find((i) => i.uid === u).spec.dn, freePipe);
check('规格面板修改 DN 生效', dnBefore === 50 && dnAfter === 80, `${dnBefore}→${dnAfter}`);
await ev(() => {
  const r = document.querySelector('.ws-spec input[type="range"]');
  r.value = '900';
  r.dispatchEvent(new Event('change', { bubbles: true }));
});
await wait(300);
const lenAfter = await T((u) => window.__ws.state.instances.find((i) => i.uid === u).spec.length, freePipe);
check('长度滑杆修改生效', lenAfter === 900, String(lenAfter));

/* ---------- F 撤销/重做/复制/删除/分组 ---------- */
const n0 = await T(() => window.__t.hash());
await clickText('.ws-tool', '撤销');
await wait(250);
const n1 = await T(() => window.__t.hash());
await clickText('.ws-tool', '重做');
await wait(250);
const n2 = await T(() => window.__t.hash());
check('工具栏撤销/重做恢复状态', n1 !== n0 && n2 === n0);

const copyMate = await T(() => window.__t.add('pipe', [29.5, 0, 32], { dn: 80 }));
const copyJoint = await T((uid, mate) => {
  window.__ws.tryConnect({ uid, port: 'p2' }, { uid: mate, port: 'p1' });
  return window.__ws.state.connections.some(link => link.a.uid === uid && link.b.uid === mate);
}, freePipe, copyMate);
if (!copyJoint) throw new Error('Copy fixture needs a valid pipe connection');
const compBefore = await T((u) => {
  const s = window.__ws.state;
  const ids = new Set([u]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of s.connections) {
      if (ids.has(c.a.uid) && !ids.has(c.b.uid) && !c.b.uid.startsWith('joint:')) { ids.add(c.b.uid); grew = true; }
      if (ids.has(c.b.uid) && !ids.has(c.a.uid) && !c.a.uid.startsWith('joint:')) { ids.add(c.a.uid); grew = true; }
    }
  }
  return { n: ids.size, c: s.connections.length, i: s.instances.length };
}, freePipe);
await T((u) => { window.__ws.select([u]); window.__ws.duplicateSelection(); }, freePipe);
await wait(300);
const compAfter = await T(() => window.__t.counts());
check('复制连通整体（含连接 remap）', compAfter.i === compBefore.i + compBefore.n && compAfter.c > compBefore.c, `+${compAfter.i - compBefore.i} 件 / 连接 ${compBefore.c}→${compAfter.c}`);

const teeConnsBefore = await T((u) => window.__ws.state.connections.filter((c) => c.a.uid === u || c.b.uid === u).length, tee);
await T((u) => { window.__ws.select([u]); window.__ws.deleteSelection(); }, tee);
await wait(300);
const teeGone = await T((u) => !window.__ws.state.instances.some((i) => i.uid === u), tee);
const teeConnsAfter = await T((u) => window.__ws.state.connections.filter((c) => c.a.uid === u || c.b.uid === u).length, tee);
check('删除已连接零件级联清理连接', teeGone && teeConnsBefore > 0 && teeConnsAfter === 0, `${teeConnsBefore}→${teeConnsAfter}`);

await clickText('.ws-side-tab', '分组');
await wait(200);
await clickText('.ws-side-body button', '按连通管段自动分组');
await wait(300);
const groupRows = await ev(() => document.querySelectorAll('.ws-group-row').length);
check('按连通管段自动分组', groupRows >= 1, String(groupRows));
await ev(() => document.querySelector('.ws-group-row button').click());
await wait(250);
const hiddenN = await T(() => window.__ws.state.instances.filter((i) => i.hidden).length);
await ev(() => document.querySelector('.ws-group-row button').click());
await wait(250);
const hiddenN2 = await T(() => window.__ws.state.instances.filter((i) => i.hidden).length);
check('分组整体隐藏/显示', hiddenN > 0 && hiddenN2 === 0, `${hiddenN}→${hiddenN2}`);

/* ---------- G 任务流程 ---------- */
await clickText('.ws-side-tab', '组装任务');
await wait(200);
await ev(() => {
  const row = [...document.querySelectorAll('.ws-task-row')].find((r) => r.textContent.includes('任务 1'));
  row.querySelector('button').click();
});
await wait(300);
const taskGoal = await ev(() => document.querySelector('.ws-task-goal')?.textContent ?? '');
check('任务1 开启并显示目标/步骤', taskGoal.length > 8 && (await ev(() => document.querySelectorAll('.ws-steps li').length)) >= 3);
await clickText('.ws-side-body button', '显示参考方案');
await wait(300);
const refBtn = await ev(() => [...document.querySelectorAll('.ws-side-body button')].some((b) => b.textContent === '隐藏参考方案'));
check('参考方案半透明叠加可切换', refBtn);
await shot('03-task-reference');
await clickText('.ws-side-body button', '重新开始');
await wait(400);
const cleared = await T(() => window.__t.counts());
check('任务重新开始清空场景', cleared.i === 0 && cleared.c === 0, JSON.stringify(cleared));
const tp1 = await T(() => window.__t.add('pipe', [-3, 1, 0]));
const te = await T(() => window.__t.add('elbow90', [0, 1, 0]));
const tp2 = await T(() => window.__t.add('pipe', [0, 5, 0]));
await T((a, b) => window.__t.conn({ uid: a, port: 'p2' }, { uid: b, port: 'p1' }), tp1, te);
await T((a, b) => window.__t.conn({ uid: a, port: 'p2' }, { uid: b, port: 'p1' }), te, tp2);
await clickText('.ws-side-body button', '检查完成情况');
await wait(300);
const doneBox = await ev(() => !!document.querySelector('.ws-task-result.done'));
check('任务1 完成判定与反馈', doneBox);
await shot('04-task-done');
await clickText('.ws-side-body button', '退出任务');

/* ---------- H 保存 / 重开 / 方案管理 ---------- */
const savedCounts = await T(() => { window.__ws.saveNow(); return window.__t.counts(); });
const planName = await ev(() => document.querySelector('.ws-plan-name').value);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await installHelpers();
const reopened = await T(() => window.__t.counts());
const name2 = await ev(() => document.querySelector('.ws-plan-name').value);
check('保存后刷新恢复装置与方案名', reopened.i === savedCounts.i && reopened.c === savedCounts.c && name2 === planName, `${reopened.i} 件 / ${reopened.c} 连接`);

await clickText('.ws-top button', '方案管理');
await wait(300);
await clickText('.ws-modal button', '新建方案');
await wait(400);
await clickText('.ws-top button', '方案管理');
await wait(300);
const plansN = await ev(() => document.querySelectorAll('.ws-plan-row').length);
check('新建方案并出现在方案列表', plansN === 2, String(plansN));
/* 导出旧方案（非当前行：含「打开」按钮的那一行） */
const [download] = await Promise.all([
  page.waitForEvent('download'),
  ev(() => {
    const row = [...document.querySelectorAll('.ws-plan-row')].find((r) => [...r.querySelectorAll('button')].some((b) => b.textContent === '打开'));
    [...row.querySelectorAll('button')].forEach((b) => { if (b.textContent === '导出') b.click(); });
  })
]);
const exportPath = path.join(OUT, 'plan-export.json');
await download.saveAs(exportPath);
const exportJson = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
check('导出方案文件含版本与状态', exportJson.app === 'chem3d-workshop-plan' && (exportJson.plan?.state?.instances?.length ?? 0) > 0, exportJson.contentVersion);
/* 导入导出文件（成功后对话框关闭，需重开计数） */
await page.setInputFiles('.ws-modal input[type="file"]', exportPath);
await wait(500);
await clickText('.ws-top button', '方案管理');
await wait(300);
const plansN2 = await ev(() => document.querySelectorAll('.ws-plan-row').length);
check('导入方案文件生成新方案', plansN2 === 3, String(plansN2));
/* 非法文件 */
const badPath = path.join(OUT, 'bad-plan.json');
fs.writeFileSync(badPath, JSON.stringify({ app: 'other', schema: 1 }));
await page.setInputFiles('.ws-modal input[type="file"]', badPath);
await wait(400);
const badToast = await ev(() => [...document.querySelectorAll('.ws-toast-err')].map((t) => t.textContent).join('|'));
check('非法导入文件被校验拒绝', badToast.length > 0, badToast.slice(0, 60));
/* 打开旧方案恢复（按零件数定位原方案行，避免排序歧义） */
await ev((n) => {
  const row = [...document.querySelectorAll('.ws-plan-row')].find((r) => r.querySelector('.ws-plan-sub')?.textContent.startsWith(`${n} 零件`) && [...r.querySelectorAll('button')].some((b) => b.textContent === '打开'));
  [...row.querySelectorAll('button')].find((x) => x.textContent === '打开').click();
}, savedCounts.i);
await wait(600);
const backCounts = await T(() => window.__t.counts());
check('方案切换恢复对应装置', backCounts.i === savedCounts.i, `${backCounts.i} vs ${savedCounts.i}`);
await shot('05-reopened');

/* ---------- J 任务9/10：换热器双流路与储罐输送教学装置 ---------- */
await clickText('.ws-side-tab', '组装任务');
await wait(200);
const taskRows = await ev(() => ({
  total: document.querySelectorAll('.ws-task-row').length,
  locked: document.querySelectorAll('.ws-task-row.locked').length,
  legacy: [...document.querySelectorAll('.ws-task-row')].map((row) => Number(row.textContent.match(/^任务\s+(\d+)\s+·/)?.[1])).filter(Number.isFinite),
  t10: [...document.querySelectorAll('.ws-task-row')].some((r) => r.textContent.includes('储罐输送教学装置'))
}));
check('保留 10 项原有任务，包含第二批与储罐输送教学',
  taskRows.total >= 10 && taskRows.locked === 1 && taskRows.t10
  && Array.from({ length: 10 }, (_, index) => index + 1).every((index) => taskRows.legacy.includes(index)), JSON.stringify(taskRows));

await T(() => window.__ws.loadReference('t9-heat'));
await wait(300);
const t9 = await T(() => window.__ws.taskResult('t9-heat'));
check('任务9 换热器双流路参考方案判定通过', t9?.done === true, JSON.stringify(t9?.items?.map((i) => i.ok)));
const t9paths = await T(() => {
  const s = window.__ws.state;
  const hx = s.instances.find((i) => i.partId === 'heat-shell-tube');
  return {
    tube: window.__ws.findPath({ uid: hx.uid, port: 'tubeIn' }, { uid: hx.uid, port: 'tubeOut' }).ok,
    shell: window.__ws.findPath({ uid: hx.uid, port: 'shellIn' }, { uid: hx.uid, port: 'shellOut' }).ok
  };
});
check('换热器管程/壳程各自连通', t9paths.tube && t9paths.shell, JSON.stringify(t9paths));
await shot('09-task9-heat');

await T(() => window.__ws.loadReference('t10-loop'));
await wait(300);
const t10 = await T(() => window.__ws.taskResult('t10-loop'));
check('任务10 储罐输送装置参考方案判定通过', t10?.done === true, JSON.stringify(t10?.items?.map((i) => i.ok)));
const t10info = await T(() => {
  const s = window.__ws.state;
  const tanks = s.instances.filter((i) => i.partId === 'tank-vertical');
  const src = tanks.find((t) => t.pos[0] > 0), dst = tanks.find((t) => t.pos[0] < 0);
  return {
    tanks: tanks.length, i: s.instances.length, c: s.connections.length,
    full: !!(src && dst && window.__ws.findPath({ uid: src.uid, port: 'out' }, { uid: dst.uid, port: 'in' }).ok)
  };
});
check('输送装置两台储罐全程连通（29 件 / 28 连接）', t10info.tanks === 2 && t10info.full && t10info.i === 29 && t10info.c === 28, JSON.stringify(t10info));
await shot('10-task10-transfer');

const closedBall = await T(() => {
  const s = window.__ws.state;
  const ball = s.instances.find((i) => i.partId === 'valve-ball');
  ball.open = false;
  const r = window.__ws.taskResult('t10-loop');
  ball.open = true;
  return { done: r.done, problems: r.problems };
});
check('球阀关闭时判定失败并给出开启提示', !closedBall.done && closedBall.problems.some((p) => p.includes('球阀处于关闭状态')), closedBall.problems.join('|').slice(0, 80));

const reversedCheck = await T(() => {
  const s = window.__ws.state;
  const chk = s.instances.find((i) => i.partId === 'valve-check');
  const swap = (p) => { if (p.uid === chk.uid) p.port = p.port === 'p1' ? 'p2' : 'p1'; };
  s.connections.forEach((c) => { swap(c.a); swap(c.b); });
  const r = window.__ws.taskResult('t10-loop');
  s.connections.forEach((c) => { swap(c.a); swap(c.b); });
  return { done: r.done, problems: r.problems };
});
check('止回阀反装给出方向性错误提示', !reversedCheck.done && reversedCheck.problems.some((p) => p.includes('止回阀可能装反')), reversedCheck.problems.join('|').slice(0, 100));
const t10restored = await T(() => window.__ws.taskResult('t10-loop'));
check('恢复后输送装置判定重新通过', t10restored?.done === true);

/* ---------- I 移动端抽屉 ---------- */
const mp = await ctx.newPage();
mp.on('pageerror', (e) => consoleErrors.push('mobile pageerror: ' + e.message));
await mp.setViewportSize({ width: 390, height: 844 });
await mp.goto(BASE + '#/workshop', { waitUntil: 'networkidle' });
await mp.waitForTimeout(1000);
const mob = await mp.evaluate(() => ({
  drawers: [...document.querySelectorAll('.ws-top .ws-drawer-btn')].filter((b) => getComputedStyle(b).display !== 'none').length,
  overflow: document.scrollingElement.scrollWidth > window.innerWidth + 1
}));
await mp.evaluate(() => [...document.querySelectorAll('.ws-drawer-btn')].find((b) => b.textContent === '零件库').click());
await mp.waitForTimeout(400);
const libOpen = await mp.evaluate(() => document.querySelector('.ws').classList.contains('lib-open'));
await mp.screenshot({ path: path.join(OUT, '06-mobile-lib.png') });
await mp.evaluate(() => [...document.querySelectorAll('.ws-drawer-btn')].find((b) => b.textContent === '面板').click());
await mp.waitForTimeout(400);
await mp.screenshot({ path: path.join(OUT, '07-mobile-side.png') });
check('移动端抽屉与无横向溢出', mob.drawers === 2 && !mob.overflow && libOpen, JSON.stringify(mob));
await mp.close();
await settle();
await shot('08-final');
await ctx.close();

/* 低高度视口与断点两侧均须能从界面搜索、筛选并进入放置模式。 */
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1000, height: 700 },
  { width: 800, height: 469 },
  { width: 533, height: 469 },
  { width: 390, height: 844 },
]) {
  const responsive = await browser.newPage({ viewport });
  responsive.on('pageerror', (error) => consoleErrors.push('pageerror: ' + error.message));
  responsive.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push('console: ' + message.text());
  });
  try {
    await responsive.goto(BASE + '#/workshop', { waitUntil: 'networkidle' });
    const search = responsive.getByRole('searchbox', { name: '搜索零件' });
    const toggle = responsive.getByRole('button', { name: '零件库', exact: true });
    const usesDrawer = await toggle.isVisible();
    const hiddenWhenClosed = !usesDrawer || await search.isHidden();
    if (usesDrawer) await toggle.press('Enter');
    await search.focus();
    const layout = await search.evaluate((input) => {
      const wrapper = input.parentElement.getBoundingClientRect();
      const library = input.closest('.ws-lib').getBoundingClientRect();
      const firstPart = document.querySelector('.ws-lib-list .ws-part').getBoundingClientRect();
      return {
        focused: document.activeElement === input,
        compact: wrapper.height - input.getBoundingClientRect().height <= 8,
        firstPartVisible: firstPart.top + 24 <= Math.min(library.bottom, window.innerHeight),
        noPageOverflow: document.scrollingElement.scrollWidth <= window.innerWidth + 1
      };
    });
    if (viewport.height <= 469) {
      await responsive.locator('.ws-lib').hover();
      await responsive.mouse.wheel(0, 10000);
      await responsive.waitForFunction(() => {
        const library = document.querySelector('.ws-lib').getBoundingClientRect();
        const lastPart = document.querySelector('.ws-lib-list .ws-part:last-child').getBoundingClientRect();
        return lastPart.top >= library.top && lastPart.bottom <= library.bottom;
      }, null, { timeout: 5000 });
      await responsive.mouse.wheel(0, -10000);
      await responsive.waitForFunction(() => document.querySelector('.ws-lib').scrollTop === 0, null, { timeout: 5000 });
    }
    await search.fill('球阀');
    await responsive.getByRole('button', { name: '阀门', exact: true }).click();
    const card = responsive.locator('.ws-part').filter({ hasText: '球阀' }).filter({ hasText: '可用' }).first();
    await card.getByRole('button', { name: '添加到场景' }).click({ timeout: 5000 });
    const hint = await responsive.locator('.ws-place-hint').textContent();
    const closedAfterAdd = !usesDrawer || (await search.isHidden()
      && await responsive.locator('[aria-controls=ws-part-library]').getAttribute('aria-expanded') === 'false');
    const placementStarted = hint.includes('放置「') && hint.includes('球阀');
    check(`零件库可操作 ${viewport.width}×${viewport.height}`,
      hiddenWhenClosed && Object.values(layout).every(Boolean) && closedAfterAdd && placementStarted,
      JSON.stringify({ ...layout, hiddenWhenClosed, closedAfterAdd, placementStarted }));
  } catch (error) {
    check(`零件库可操作 ${viewport.width}×${viewport.height}`, false, error.message);
  } finally {
    await responsive.close();
  }
}

/* ---------- 汇总 ---------- */
check('全程无运行时/控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '));
const failed = results.filter((r) => !r.ok);
console.log(`\n工坊验证：${results.length - failed.length}/${results.length} 通过`);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, consoleErrors }, null, 2));
await browser.close();
process.exit(failed.length ? 1 : 0);
