import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import * as THREE from 'three';
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';

const target = process.argv[2] ?? 'exchanger';
const out = path.resolve('outputs/process', target);
fs.mkdirSync(out, { recursive: true });
const bundle = path.resolve('outputs/process/models.mjs');
await build({ stdin: { contents: "export { buildPart } from './src/engine/builders'; export { DEVICES } from './src/data/devices'; export { HX_TUBES, HX_BOLTS } from './src/engine/exchangerModel'; export { BAG_BOLTS } from './src/engine/bagFilterModel'; export { INTERACTIONS } from './src/engine/interactions';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: bundle, logLevel: 'silent' });
const { buildPart, DEVICES, HX_TUBES, HX_BOLTS, BAG_BOLTS, INTERACTIONS } = await import(pathToFileURL(bundle).href);
const d = DEVICES.find(d => d.id === target);
if (!d) throw new Error('Unknown device');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' ' + detail : '')); };
const groups = new Map(d.parts.map(p => [p.id, buildPart(d.id, p.id, p.color)]));
function hits(group, start, direction, far) {
  group.updateMatrixWorld(true);
  group.traverse(o => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.side = THREE.DoubleSide; });
  return new THREE.Raycaster(new THREE.Vector3(...start), new THREE.Vector3(...direction).normalize(), 0.00001, far).intersectObject(group, true).length;
}
if (target === 'bag-filter') {
  check('上盖顶部进口开孔', hits(groups.get('cover'), [0, 0.5, 0], [0, -1, 0], 0.5) === 0);
  check('筒体下侧出口开孔', hits(groups.get('shell'), [-0.36, -0.27, 0], [1, 0, 0], 0.16) === 0);
  check('滤袋顶部开放', hits(groups.get('bag'), [0, 0.6, 0], [0, -1, 0], 0.3) === 0);
  check('滤袋底部封闭', hits(groups.get('bag'), [0, -0.6, 0], [0, 1, 0], 0.3) > 0);
  check('紧固件为八组', (() => { let n = 0; groups.get('coverBolts').traverse(o => { if (o.userData.hole) n++; }); return n === BAG_BOLTS.length; })());
  for (const [id, top, distance] of [['shell', 0.51, 0.09], ['cover', 0.09, 0.09], ['seal', 0.10, 0.04]]) {
    const clear = BAG_BOLTS.every(h => hits(groups.get(id), [-h.u, top, h.v], [0, -1, 0], distance) === 0);
    const solid = BAG_BOLTS.every(h => hits(groups.get(id), [-h.u * (0.34 / 0.315), top, h.v * (0.34 / 0.315)], [0, -1, 0], distance) > 0);
    check(id + ' 八孔贯通且孔周有实体', clear && solid);
  }
  check('侧出口周围筒壁存在', hits(groups.get('shell'), [-0.36, -0.17, 0], [1, 0, 0], 0.16) > 0);
}
check('每个数据零件都有非空真实几何', [...groups.values()].every(g => { let n = 0; g.traverse(o => { if (o.isMesh && o.geometry.getAttribute('position')?.count > 0) n++; }); return n > 0; }));
if (target === 'exchanger') {
  check('19 根独立中空管', HX_TUBES.length === 19 && groups.get('tubes').children.length === 19);
  for (const id of ['tubes', 'tubesheetF', 'tubesheetR', 'baffles']) {
    check(id + '：19 条管孔轴线实际射线贯通', HX_TUBES.every(h => hits(groups.get(id), [-2, h.u, h.v], [1, 0, 0], 4) === 0));
  }
  check('管板实体区域能拦截射线，排除整板缺失', hits(groups.get('tubesheetF'), [-0.1, 0.32, 0], [1, 0, 0], 0.2) > 0);
  check('管壁区域存在实体', hits(groups.get('tubes'), [-1.3, 0.029, 0], [1, 0, 0], 2.6) > 0);
  for (const id of ['channel', 'tubesheetF']) {
    const start = id === 'channel' ? 0.19 : -0.06;
    check(id + '：12 个紧固孔实际贯通', HX_BOLTS.every(h => hits(groups.get(id), [start, h.u, h.v], [1, 0, 0], 0.12) === 0));
  }
  const bolts = []; groups.get('channelBolts').traverse(o => { if (o.userData.hole) bolts.push(o); });
  check('紧固件与孔群逐孔同轴', bolts.length === 12 && bolts.every((u, i) => Math.abs(u.position.y - HX_BOLTS[i].u) < 1e-8 && Math.abs(u.position.z - HX_BOLTS[i].v) < 1e-8 && u.userData.shaftR < HX_BOLTS[i].r));
  check('壳体上接管真实开口', hits(groups.get('shell'), [-0.7, 0.55, 0], [0, -1, 0], 0.20) === 0);
  check('壳体下接管真实开口', hits(groups.get('shell'), [0.7, -0.55, 0], [0, 1, 0], 0.20) === 0);
  check('管箱进口切穿筒壁', hits(groups.get('channel'), [0.04, 0.85, 0], [0, -1, 0], 0.55) === 0);
  const before = groups.get('tubes').position.clone();
  INTERACTIONS[target].apply(1, groups);
  check('固定管束不会被检修滑杆抽出', groups.get('tubes').position.equals(before));
  check('管箱检修先退出紧固件', groups.get('channelBolts').position.x < groups.get('channel').position.x);
}
const browser = await chromium.launch({ ...browserOptions, headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto((process.env.VERIFY_BASE ?? 'http://127.0.0.1:5175/') + '#/device/' + target);
  await page.waitForFunction(id => window.__chem3d?.device.id === id, target, { timeout: 30000 });
  for (const [mode, label] of [['observe', '整体观察'], ['xray', '透明观察'], ['section', '剖视'], ['explode', '爆炸图']]) {
    await page.locator('.mode-tab').filter({ hasText: label }).click();
    if (mode === 'explode') await page.evaluate(() => window.__chem3d.scene.setExplode(1));
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, mode + '.png') });
  }
  await page.evaluate(() => window.__chem3d.scene.setExplode(0));
  await page.waitForTimeout(800);
  check('爆炸复原保持所有装配坐标', await page.evaluate(() => [...window.__chem3d.scene.parts.values()].every(p => p.group.position.distanceTo({ x: p.def.pos[0], y: p.def.pos[1], z: p.def.pos[2] }) < 1e-6)));
  check('浏览器无运行错误', errors.length === 0, errors.join('; '));
} finally { await browser.close(); }
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ device: target, contentVersion: d.contentVersion, results }, null, 2));
console.log(results.filter(r => r.ok).length + '/' + results.length + ' passed');
if (results.some(r => !r.ok)) process.exitCode = 1;
