import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { Box3 } from 'three';
import { chromium } from 'playwright-core';
import { browserOptions, webglArgs } from './browser-options.mjs';

const BASE = process.env.VERIFY_BASE ?? 'http://127.0.0.1:5173/';
const OUT = resolve(process.env.WORKSHOP_REPORT_DIR ?? 'outputs/workshop-expansion');
await mkdir(OUT, { recursive: true });
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const module = (name) => server.ssrLoadModule('/src/workshop/' + name + '.ts');
const { assemblyAssets } = await module('expansion/index');
const { assemblyLessons, basicLessons } = await module('expansion/lessons');
const { assemblyOrigin, partById, CATALOG } = await module('catalog');
const { buildPart } = await module('geometry');
const { emptyState, makeConnection, portsAligned, validateConnection, livePorts, deleteInstances } = await module('state');
const { validateState, importPlanFile, exportPlan } = await module('storage');
const { WORKSHOP_CONTENT_VERSION } = await module('types');
const { reducerSmall } = await module('specs');
const referencePump = basicLessons.find(lesson => lesson.id === 'basic-pump').reference();
const isolatedStore = new Map();
globalThis.localStorage = { getItem: key => isolatedStore.get(key) ?? null, setItem: (key, value) => isolatedStore.set(key, value) };

function checkRoundTrip(state) {
  isolatedStore.clear();
  const plan = { id: 'test', name: '验收夹具', createdAt: 0, updatedAt: 0,
    contentVersion: WORKSHOP_CONTENT_VERSION, state, taskProgress: {} };
  const exported = exportPlan(plan);
  const restored = importPlanFile(JSON.stringify(exported));
  assert(restored.ok, restored.error);
  assert.deepEqual(restored.plan.state.connections, state.connections);
  assert.deepEqual(restored.plan.state.instances.map(({ uid, partId, pos, rot, spec }) => ({ uid, partId, pos, rot, spec })),
    JSON.parse(JSON.stringify(state.instances.map(({ uid, partId, pos, rot, spec }) => ({ uid, partId, pos, rot, spec })))));
  const bad = structuredClone(exported);
  bad.plan.state.connections[0].a.uid = 'missing';
  assert.equal(importPlanFile(JSON.stringify(bad)).ok, false);
  const legacy = structuredClone(exported);
  if (!state.connections.some(item => item.kind === 'mechanical')) {
    legacy.contentVersion = '2026-11-16.1';
    delete legacy.schemaVersion;
    legacy.plan.state.instances = legacy.plan.state.instances.map(({ uid, partId, pos, rot, spec }) => ({ uid, partId, pos, rot, spec }));
    assert(importPlanFile(JSON.stringify(legacy)).ok);
  }
}

const fixtures = {
  union: ['p1', 'nipple-thread', 'p1', 'thread'],
  'coupling-thread': ['p1', 'nipple-thread', 'p1', 'thread'],
  'coupling-reducing-thread': ['p2', 'nipple-thread', 'p1', 'thread'],
  'nipple-thread': ['p1', 'coupling-thread', 'p1', 'thread'],
  'plug-thread': ['p1', 'coupling-thread', 'p1', 'thread'],
  'joint-bellows-flanged': ['p1', 'flange-so', 'face', 'flange'],
  'flange-so': ['face', 'flange-wn', 'face', 'flange'],
  'flange-wn': ['face', 'flange-so', 'face', 'flange'],
  'flange-blind': ['face', 'flange-so', 'face', 'flange'],
  'flange-lap-ring': ['shoulder', 'flange-lap-stub', 'lap', 'mechanical'],
  'flange-lap-stub': ['lap', 'flange-lap-ring', 'shoulder', 'mechanical'],
  gasket: ['f1', 'flange-so', 'face', 'flange'],
  bolt: ['washer-seat', 'washer-flat', 'bore', 'mechanical'],
  nut: ['thread', 'bolt', 'end', 'nut'],
  'washer-flat': ['bore', 'bolt', 'washer-seat', 'mechanical'],
  clamp: ['mount', 'pipe', 'surface', 'clamp'],
  support: ['mount', 'pipe', 'surface', 'clamp'],
  'saddle-vessel': ['cradle', 'heat-shell-tube', 'shell-saddle', 'mechanical'],
  'instr-pressure': ['process', 'pipe', 'p1', 'thread', { dn: 15, endType: 'thread' }],
  'instr-pressure-transmitter': ['process', 'pipe', 'p1', 'thread', { dn: 15, endType: 'thread' }],
  'instr-thermowell': ['process', 'pipe', 'p1', 'thread', { dn: 15, endType: 'thread' }],
  'instr-float-switch': ['process', 'pipe', 'p1', 'thread', { dn: 15, endType: 'thread' }],
  'instr-temp': ['well', 'instr-thermowell', 'probe', 'mechanical'],
  'instr-thermocouple': ['well', 'instr-thermowell', 'probe', 'mechanical'],
  'instr-magflow': ['in', 'flange-so', 'face', 'flange'],
  'instr-rotameter': ['in', 'flange-so', 'face', 'flange'],
  'instr-level': ['lower', 'tank-vertical', 'lg', 'flange'],
  'instr-orifice': ['in', 'flange-so', 'face', 'flange'],
  'pump-centrifugal': ['in', 'flange-so', 'face', 'flange', { dn: 80 }],
  'tank-vertical': ['out', 'flange-so', 'face', 'flange', { dn: 80 }],
  'heat-shell-tube': ['tubeIn', 'flange-so', 'face', 'flange', { dn: 65 }]
};

function modelAndFit(asset) {
  const part = partById(asset.id);
  const model = buildPart(asset.id, asset.spec, part.color, part.material);
  const bounds = new Box3().setFromObject(model);
  assert(!bounds.isEmpty() && [...bounds.min, ...bounds.max].every(Number.isFinite));
  let meshes = 0, triangles = 0, meshBytes = 0;
  const materials = new Set(), geometries = new Set();
  model.traverse(mesh => {
    if (!mesh.isMesh) return;
    meshes++;
    const position = mesh.geometry.attributes.position;
    assert(position.array.every(Number.isFinite));
    triangles += (mesh.geometry.index?.count ?? position.count) / 3;
    if (!geometries.has(mesh.geometry)) {
      geometries.add(mesh.geometry);
      for (const buffer of Object.values(mesh.geometry.attributes)) meshBytes += buffer.array.byteLength;
      meshBytes += mesh.geometry.index?.array.byteLength ?? 0;
    }
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
  });
  assert(meshes > 0 && asset.sources.every(source => source.title && source.basis));
  const related = { meshes, triangles, geometryBytes: meshBytes, materials: materials.size, source: asset.sources,
    teachingBoundsMm: [...bounds.max.clone().sub(bounds.min).multiplyScalar(100)].map(value => Math.round(value * 100) / 100),
    fidelity: '教学简化', licenseStatus: '项目内原创参数化网格；公共资料仅引用',
    fluidPorts: part.ports.filter(port => ['flange', 'thread', 'weld'].includes(port.type) && port.standard !== 'M'),
    mechanicalMates: part.ports.filter(port => ['mechanical', 'bolt', 'nut', 'clamp'].includes(port.type)),
    signal: asset.signal, mounting: asset.mounting, defaultSpec: asset.spec,
    baseTransform: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] } };
  if (asset.course === 'pump') {
    const instance = referencePump.instances.find(item => item.partId === asset.id);
    const matches = referencePump.connections.filter(connection => [connection.a.uid, connection.b.uid].includes(instance.uid));
    assert(matches.length && matches.every(link => portsAligned(referencePump, link.a, link.b)));
    const incompatible = referencePump.instances.find(item => item.uid !== instance.uid);
    assert(!validateConnection(referencePump, { uid: instance.uid, port: livePorts(instance)[0].id },
      { uid: incompatible.uid, port: livePorts(incompatible)[0].id }).ok);
    checkRoundTrip(referencePump);
    return { ...related, fixture: matches.map(link => {
      const end = link.a.uid === instance.uid ? link.b : link.a;
      return referencePump.instances.find(item => item.uid === end.uid)?.partId + ':' + end.port;
    }) };
  }
  const [port, fixture, target, kind, override] = fixtures[asset.id] ?? (asset.category === 'valve' ?
    ['p1', 'flange-so', 'face', 'flange'] : ['p1', 'pipe', 'p2', 'weld']);
  const state = emptyState();
  state.instances = [
    { uid: 'object', partId: asset.id, pos: [1, 2, 3], rot: [0, 0, 0], spec: { ...asset.spec } },
    { uid: 'fixture', partId: fixture, pos: [3, 2, 1], rot: [0, 0, 0],
      spec: { ...partById(fixture).defaultSpec, ...((fixture === 'flange-so' || fixture === 'pipe') ? { dn: asset.spec.dn } : {}), ...override } }
  ];
  const a = { uid: 'object', port }, b = { uid: 'fixture', port: target };
  const result = makeConnection(state, a, b);
  assert(result.ok, result.reason);
  assert.equal(result.conn.kind, kind);
  if (kind !== 'clamp' && kind !== 'nut') assert(portsAligned(state, a, b));
  assert(!validateConnection(state, a, b).ok, 'occupied mate must be rejected');
  assert.equal(validateState(state), null);
  checkRoundTrip(state);
  assert.equal(deleteInstances(state, ['object']).conns, 1);
  return { ...related, fixture: [fixture + ':' + target] };
}

const assetsById = new Map(assemblyAssets.map(asset => [asset.id, asset]));
const ready = CATALOG.filter(part => part.status === 'ready');
const rows = ready.map(part => assetsById.get(part.id) ?? {
  id: part.id, code: part.id, name: part.name, course: 'standalone', category: part.category,
  sources: [{ title: '工坊既有目录', basis: part.portsDesc }], spec: part.defaultSpec
}).map(asset => {
  const row = { code: asset.code, id: asset.id, name: asset.name, course: asset.course,
    origin: assemblyOrigin(asset.id), model: false, browser: false, restored: false };
  try { Object.assign(row, modelAndFit(asset), { model: true }); }
  catch (error) { row.modelError = error.message; }
  return row;
});
const browser = await chromium.launch({ ...browserOptions, args: [...webglArgs, '--disable-renderer-backgrounding'] });
const errors = [];
const lessons = [], viewports = [], performance = [];
let renderer;
async function open(width = 1366, height = 768) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('#/workshop', BASE).href);
  await page.waitForFunction(() => window.__ws?.engine.renderer.domElement.width > 0);
  page.setDefaultTimeout(20000);
  return page;
}

async function addFromLibrary(page, id, spec = {}) {
  const drawer = page.getByRole('button', { name: '零件库', exact: true });
  if (await drawer.isVisible() && await drawer.getAttribute('aria-expanded') === 'false') await drawer.click();
  const asset = assemblyAssets.find(item => item.id === id);
  const part = page.locator(`.ws-part[data-part-id="${id}"]`);
  await page.getByRole('searchbox', { name: '搜索零件' }).fill(asset?.code ?? partById(id).name);
  const defaultSpec = partById(id).defaultSpec;
  const changeDn = spec.dn !== undefined && spec.dn !== defaultSpec.dn;
  const changeEnd = spec.endType && spec.endType !== defaultSpec.endType;
  if (changeDn || changeEnd || spec.smallDn) {
    await part.locator('.ws-part-name').click();
    if (changeDn) await part.getByLabel('添加规格', { exact: true }).selectOption(String(spec.dn));
    if (changeEnd) await part.getByLabel('添加端部形式', { exact: true }).selectOption(spec.endType);
    if (spec.smallDn) await part.getByLabel('添加小端规格', { exact: true }).selectOption(String(spec.smallDn));
  }
  await part.getByRole('button', { name: '添加到场景' }).click();
  await page.getByRole('button', { name: '在视图中心放置' }).click();
  return page.evaluate(() => window.__ws.selection[0]);
}

function readState(page) { return page.evaluate(() => structuredClone(window.__ws.state)); }
function instance(page, uid) { return page.evaluate(uid => window.__ws.state.instances.find(item => item.uid === uid), uid); }

async function connectUi(page, a, b) {
  await page.getByRole('button', { name: '接口连接', exact: true }).click();
  await page.getByLabel('选择场景零件').selectOption(a.uid);
  await page.locator(`.ws-port-row[data-port="${a.port}"]`).getByRole('button', { name: '开始连接' }).click();
  await page.locator(`.ws-cand-row[data-uid="${b.uid}"][data-port="${b.port}"]`).getByRole('button', { name: '连接', exact: true }).click();
  const state = await readState(page);
  return state.connections.at(-1);
}

try {
  const page = await open();
  renderer = await page.evaluate(() => {
    const gl = window.__ws.engine.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  for (const [index, row] of rows.entries()) {
    try {
      const uid = await addFromLibrary(page, row.id);
      const initial = await instance(page, uid);
      assert.equal(initial.partId, row.id);
      const expected = { ...partById(row.id).defaultSpec };
      if (row.id === 'reducer-conc' || row.id === 'reducer-ecc') expected.smallDn = reducerSmall(expected.dn, expected.smallDn);
      assert.deepEqual(initial.spec, expected);
      row.defaultVariant = initial.spec;
      const actualModel = await page.evaluate(uid => {
        let meshes = 0;
        window.__ws.engine.entries.get(uid)?.group.traverse(item => { if (item.isMesh) meshes++; });
        return meshes;
      }, uid);
      assert(actualModel > 0 && (row.meshes === undefined || actualModel >= row.meshes));
      const position = page.getByLabel('X 位置（场景单位）');
      const x = index % 20 * 2;
      await position.fill(String(x));
      await position.press('Tab');
      assert.equal((await instance(page, uid)).pos[0], x);
      await page.getByRole('button', { name: 'Y +90°', exact: true }).click();
      assert(Math.abs((await instance(page, uid)).rot[1]) >= 1.5);
      await page.locator('.ws-side-body').getByRole('button', { name: '删除', exact: true }).click();
      assert.equal(await instance(page, uid), undefined);
      await page.getByRole('button', { name: '撤销', exact: true }).click();
      row.browser = Boolean(await instance(page, uid));
      row.instanceId = uid;
      console.log(`${row.browser && row.model ? 'PASS' : 'FAIL'} ${row.code} ${row.name}${row.modelError ? ' ' + row.modelError : ''}`);
    } catch (error) {
      row.browserError = error.message;
      console.log(`FAIL ${row.code} ${error.message.split('\n')[0]}`);
    }
  }
  const saved = await readState(page);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__ws));
  const restored = await readState(page);
  for (const row of rows) {
    const before = saved.instances.find(item => item.uid === row.instanceId);
    const after = restored.instances.find(item => item.uid === row.instanceId);
    row.restored = Boolean(before && after && after.instanceId === row.instanceId && after.partTypeId === row.id
      && ['partId', 'spec', 'pos', 'rot'].every(key => JSON.stringify(before[key]) === JSON.stringify(after[key])));
  }
  await page.close();
  for (const lesson of basicLessons) {
    const page = await open(1440, 900);
    try {
      const recipe = assemblyLessons[lesson.id];
      await page.getByRole('button', { name: '组装任务', exact: true }).click();
      await page.locator('.ws-task-row').filter({ hasText: lesson.title }).getByRole('button', { name: '开始', exact: true }).click();
      await page.getByRole('button', { name: '检查完成情况' }).click();
      await page.getByText('尚未完成', { exact: true }).waitFor();
      const used = new Map();
      for (const node of recipe.nodes) used.set(node.key, await addFromLibrary(page, node.type, node.spec));
      const end = ([key, port]) => ({ uid: used.get(key), port });
      for (const link of recipe.links) {
        let a = end(link.a), b = end(link.b);
        if (a.port === 'surface') [a, b] = [b, a];
        const result = await connectUi(page, a, b);
        assert(result, JSON.stringify(link));
        if (link.name) used.set('$' + link.name, 'joint:' + result.id);
      }
      await page.getByRole('button', { name: '组装任务', exact: true }).click();
      await page.getByRole('button', { name: '检查完成情况' }).click();
      await page.getByText('任务完成！', { exact: true }).waitFor();
      const current = await readState(page);
      assert.equal(current.connections.length, recipe.links.length);
      if (lesson.id === 'basic-pump') {
        for (let repeat = 0; repeat < 20; repeat++) {
          await page.getByRole('button', { name: '显示爆炸参考' }).click();
          await page.getByRole('button', { name: '复位爆炸参考' }).click();
        }
        assert.deepEqual(await readState(page), current);
        await page.getByRole('button', { name: '隐藏参考方案' }).click();
      }
      await page.locator('.ws-toast').first().waitFor({ state: 'hidden' });
      await page.screenshot({ path: resolve(OUT, lesson.id + '.png') });
      await page.reload();
      await page.waitForFunction(() => Boolean(window.__ws));
      const reload = await readState(page);
      assert.deepEqual(reload.connections, current.connections);
      assert(await page.evaluate(id => window.__ws.plan.taskProgress[id]?.completedAt > 0, lesson.id));
      lessons.push({ id: lesson.id, passed: true, parts: current.instances.length, connections: current.connections.length });
    } catch (error) {
      lessons.push({ id: lesson.id, passed: false, error: error.message });
    } finally { await page.close(); }
    console.log(lessons.at(-1));
  }
  const valvePage = await open(1366, 768);
  try {
    await valvePage.getByRole('button', { name: '组装任务', exact: true }).click();
    await valvePage.locator('.ws-task-row').filter({ hasText: '任务 5 · 安装球阀' }).getByRole('button', { name: '开始', exact: true }).click();
    const check = valvePage.getByRole('button', { name: '检查完成情况', exact: true });
    await valvePage.getByRole('button', { name: '显示参考方案', exact: true }).click();
    await check.click();
    assert(await valvePage.getByRole('heading', { name: '尚未完成', exact: true }).isVisible());
    const left = await addFromLibrary(valvePage, 'pipe', { endType: 'flange' });
    const valve = await addFromLibrary(valvePage, 'valve-ball');
    const right = await addFromLibrary(valvePage, 'pipe', { endType: 'flange' });
    await connectUi(valvePage, { uid: left, port: 'p2' }, { uid: valve, port: 'p1' });
    await connectUi(valvePage, { uid: valve, port: 'p2' }, { uid: right, port: 'p1' });
    await valvePage.getByRole('button', { name: '组装任务', exact: true }).click();
    await check.click();
    assert(await valvePage.getByRole('heading', { name: '尚未完成', exact: true }).isVisible());
    for (const [index, answer] of ['0', '1', '1', '0', '1'].entries()) {
      await valvePage.locator('.ws-task-question select').nth(index).selectOption(answer);
    }
    await check.click();
    await valvePage.getByRole('heading', { name: '任务完成！', exact: true }).waitFor();
    await valvePage.reload();
    await valvePage.waitForFunction(() => window.__ws?.plan.taskProgress['t5-ball']?.completedAt > 0);
    lessons.push({ id: 't5-ball', passed: true, parts: 3, connections: 2, questions: 5 });
  } catch (error) {
    lessons.push({ id: 't5-ball', passed: false, error: error.message });
  } finally { await valvePage.close(); }
  console.log(lessons.at(-1));
  for (const [width, height] of [[390, 844], [534, 469], [768, 1024], [1366, 768], [1920, 1080]]) {
    const page = await open(width, height);
    try {
      const toggle = page.getByRole('button', { name: '零件库', exact: true });
      const drawer = await toggle.isVisible();
      if (drawer) await toggle.click();
      const first = page.locator('.ws-part').first();
      await first.getByRole('button', { name: '添加到场景' }).waitFor();
      await first.locator('img[src]').waitFor();
      assert(await first.evaluate(card => card.getBoundingClientRect().top < innerHeight));
      const last = page.locator('.ws-part').last();
      await last.getByRole('button', { name: '添加到场景' }).scrollIntoViewIfNeeded();
      assert(await last.evaluate(card => card.getBoundingClientRect().top < innerHeight));
      if (drawer) await page.getByRole('button', { name: '关闭零件库' }).click();
      if (drawer) assert(await page.getByRole('searchbox', { name: '搜索零件' }).isHidden());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await addFromLibrary(page, 'valve-ball');
      viewports.push({ width, height, passed: true });
    } catch (error) { viewports.push({ width, height, passed: false, error: error.message }); }
    finally { await page.close(); }
  }
  for (const count of [50, 100]) {
    const perf = await open();
    performance.push(await perf.evaluate(async count => {
      const ws = window.__ws;
      const begin = window.performance.now();
      const kinds = ['pipe', 'elbow90', 'valve-ball', 'P041', 'instr-magflow'];
      for (let index = 0; index < count; index++) {
        ws.addInstanceAt(kinds[index % kinds.length], [(index % 10) * 4, 0, Math.floor(index / 10) * 4]);
      }
      ws.engine.fitAll();
      await new Promise(requestAnimationFrame);
      const setupMs = window.performance.now() - begin;
      const startedAt = window.performance.now();
      for (let frame = 0; frame < 90; frame++) await new Promise(requestAnimationFrame);
      const frameMs = (window.performance.now() - startedAt) / 90;
      const render = ws.engine.renderer.info.render;
      return { count, setupMs, frameMs, fps: 1000 / frameMs, draws: render.calls, triangles: render.triangles };
    }, count));
    await perf.close();
  }
} finally {
  await browser.close();
  await server.close();
}

const restoredInstanceCount = rows.filter(row => row.restored).length;
const passed = rows.filter(row => row.model && row.browser && row.restored);
const counts = Object.fromEntries(['existing', 'repaired', 'activated', 'new'].map(origin => [origin, passed.filter(row => row.origin === origin).length]));
await writeFile(resolve(OUT, 'report.json'), JSON.stringify({
  renderer, browser: `Edge ${browser.version()}`, base: BASE, validTypes: passed.length,
  counts, catalogReady: ready.length, catalogDev: CATALOG.length - ready.length,
  variantsChecked: rows.filter(row => row.defaultVariant).length, instancesRestored: restoredInstanceCount,
  rows, lessons, viewports, performance, errors
}, null, 2));
console.log({ validTypes: passed.length, counts, lessons, viewports, performance, errors });
process.exitCode = passed.length !== ready.length || lessons.some(lesson => !lesson.passed) || viewports.some(viewport => !viewport.passed) || errors.length ? 1 : 0;
