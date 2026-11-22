/**
 * 内容配置校验：提交/构建前运行 npm run validate:content。
 * 检查必填字段、重复零件编号、角色与连接属性一致性、安装目标与步骤依赖、
 * 观察任务引用，以及建模代码是否覆盖全部零件编号。失败时退出码为 1。
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];
const err = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

const devicesBundle = await build({ entryPoints: [join(root, 'src/data/devices.ts')],
  bundle: true, platform: 'node', format: 'esm', write: false });
const devicesUrl = 'data:text/javascript;base64,' + Buffer.from(devicesBundle.outputFiles[0].text).toString('base64');
const { DEVICES } = await import(devicesUrl);

const JOINTS = ['welded', 'bolted', 'fitted', 'anchor'];
const ROLES = ['fixed', 'removable', 'display'];
const MODES = ['observe', 'section', 'xray', 'explode', 'principle', 'practice', 'endoscope'];
const STR_FIELDS = ['id', 'name', 'category', 'categoryLabel', 'contentVersion', 'use', 'principle', 'structureNote'];
const ARR_FIELDS = ['keywords', 'learningPoints', 'objectives', 'tasks', 'parts'];

const buildersSrc = readFileSync(join(root, 'src/engine/builders.ts'), 'utf8')
  + readFileSync(join(root, 'src/engine/pumpModel.ts'), 'utf8')
  + readFileSync(join(root, 'src/engine/valveModels.ts'), 'utf8')
  + readFileSync(join(root, 'src/engine/exchangerModel.ts'), 'utf8')
  + readFileSync(join(root, 'src/engine/bagFilterModel.ts'), 'utf8')
  + readFileSync(join(root, 'src/engine/plateExchangerModel.ts'), 'utf8');
const deviceIds = new Set();

for (const d of DEVICES) {
  const tag = `[${d.id ?? '?'}]`;
  for (const f of STR_FIELDS) {
    if (typeof d[f] !== 'string' || !d[f].trim()) err(`${tag} 缺少必填字段 ${f}`);
  }
  for (const f of ARR_FIELDS) {
    if (!Array.isArray(d[f]) || d[f].length === 0) err(`${tag} 缺少必填数组 ${f}`);
  }
  if (deviceIds.has(d.id)) err(`${tag} 设备编号重复`);
  deviceIds.add(d.id);
  if (!buildersSrc.includes(`'${d.id}'`) && !buildersSrc.includes(`"${d.id}"`)) {
    err(`${tag} builders.ts 中未找到该设备的建模入口`);
  }

  if (d.id === 'plate-exchanger') {
    if (d.parts.map(p => p.id).join(',') !== 'fixedPlate,guideBars,plates,gaskets,movablePlate,bolts') err(`${tag} 原零件编号发生变化`);
    if (!d.structureNote.includes('演示参数') || !d.structureNote.includes('未验证实际流动或密封性能')) err(`${tag} 缺少演示参数或性能限制说明`);
    if (d.contentVersion === '2026-11-17.1') err(`${tag} 内容版本未升级`);
  }
  if (d.id === 'y-strainer') {
    const ids = d.parts.map(p => p.id);
    if (ids.join(',') !== 'body,screen,gasket,cover,coverBolts,ports') err(`${tag} 原零件编号发生变化`);
    if (d.contentVersion === '2026-11-17.1') err(`${tag} 内容版本未升级`);
    if (!d.structureNote.includes('演示参数')) err(`${tag} 缺少演示参数说明`);
    if (d.assemblyOrder.join(',') !== 'screen,gasket,cover,coverBolts') err(`${tag} 装配顺序错误`);
    const axis = d.parts.filter(p => ['screen', 'gasket', 'cover'].includes(p.id));
    if (axis.some(p => Math.abs(p.rot[2] - Math.PI / 4) > 1e-6 || Math.abs(p.pos[0] + p.pos[1] - 0.5) > 1e-4)) err(`${tag} 滤网、垫片和滤盖必须与支管同轴`);
  }

  const partIds = new Set();
  const byId = new Map();
  for (const p of d.parts ?? []) {
    const pt = `${tag} 零件 ${p.id ?? '?'}`;
    if (!p.id || partIds.has(p.id)) err(`${pt} 编号缺失或重复`);
    partIds.add(p.id);
    byId.set(p.id, p);
    for (const f of ['name', 'desc', 'group']) {
      if (typeof p[f] !== 'string' || !p[f].trim()) err(`${pt} 缺少必填字段 ${f}`);
    }
    if (!Array.isArray(p.pos) || p.pos.length !== 3 || p.pos.some((n) => typeof n !== 'number')) err(`${pt} pos 必须为三元数值数组`);
    if (!Array.isArray(p.explodeDir) || p.explodeDir.length !== 3) err(`${pt} explodeDir 必须为三元数组`);
    if (typeof p.explodeDist !== 'number' || p.explodeDist < 0) err(`${pt} explodeDist 必须为非负数`);
    if (p.explodeDist > 0 && p.explodeDir.every((n) => n === 0)) err(`${pt} explodeDist>0 但 explodeDir 为零向量`);
    if (!JOINTS.includes(p.joint)) err(`${pt} joint 非法：${p.joint}`);
    if (!ROLES.includes(p.role)) err(`${pt} role 非法：${p.role}`);
    if (p.role === 'fixed' && p.fixed !== true) err(`${pt} role=fixed 但 fixed 标记不为 true`);
    if (p.role === 'removable' && p.removable !== true) err(`${pt} role=removable 但 removable 标记不为 true`);
    if (p.role === 'display' && (p.fixed || p.removable)) err(`${pt} role=display 不应带 fixed/removable 标记`);
    if (!buildersSrc.includes(`'${p.id}'`) && !buildersSrc.includes(`"${p.id}"`)) {
      err(`${pt} builders.ts 中未找到对应建模代码（缺少模型）`);
    }
  }
  for (const p of d.parts ?? []) {
    for (const dep of p.prereq ?? []) {
      if (!partIds.has(dep)) err(`${tag} 零件 ${p.id} 的 prereq 引用了不存在的零件 ${dep}`);
    }
    for (const dep of p.removeAfter ?? []) {
      if (!partIds.has(dep)) err(`${tag} 零件 ${p.id} 的 removeAfter 引用了不存在的零件 ${dep}`);
    }
  }

  const order = d.assemblyOrder ?? [];
  const orderSet = new Set(order);
  if (orderSet.size !== order.length) err(`${tag} assemblyOrder 存在重复项`);
  const idx = (id) => order.indexOf(id);
  for (const id of order) {
    const p = byId.get(id);
    if (!p) { err(`${tag} assemblyOrder 引用了不存在的零件 ${id}（无效安装目标）`); continue; }
    if (p.role !== 'removable') err(`${tag} assemblyOrder 含非可拆卸零件 ${id}（role=${p.role}）`);
    for (const dep of p.prereq ?? []) {
      if (!orderSet.has(dep)) err(`${tag} ${id} 的前置 ${dep} 不在安装序列中`);
      else if (idx(dep) > idx(id)) err(`${tag} ${id} 的前置 ${dep} 安装顺序晚于自身（步骤依赖错误）`);
    }
    for (const dep of p.removeAfter ?? []) {
      if (!orderSet.has(dep)) err(`${tag} ${id} 的 removeAfter ${dep} 不在安装序列中`);
      else if (idx(dep) < idx(id)) err(`${tag} ${id} 的 removeAfter ${dep} 拆卸顺序晚于自身（步骤依赖错误）`);
      else if (dep === id) err(`${tag} ${id} 的 removeAfter 含自身`);
    }
  }
  for (const p of d.parts ?? []) {
    if (p.role === 'removable' && order.length && !orderSet.has(p.id)) {
      warn(`${tag} 可拆卸零件 ${p.id} 未列入拆装序列（仅观察用，请确认是否有意）`);
    }
  }

  const taskIds = new Set();
  for (const t of d.tasks ?? []) {
    const tt = `${tag} 任务 ${t.id ?? '?'}`;
    if (!t.id || taskIds.has(t.id)) err(`${tt} 编号缺失或重复`);
    taskIds.add(t.id);
    if (typeof t.text !== 'string' || !t.text.trim()) err(`${tt} 缺少任务文本`);
    if (!MODES.includes(t.mode)) err(`${tt} mode 非法：${t.mode}`);
    if (t.partId && !partIds.has(t.partId)) err(`${tt} partId 引用了不存在的零件 ${t.partId}`);
    if (t.auto && t.auto !== 'practice-completion') err(`${tt} auto 非法：${t.auto}`);
    if (t.auto === 'practice-completion' && !order.length) err(`${tt} 自动任务依赖拆装练习，但该设备未开放练习`);
    if (t.exercise) {
      const ex = t.exercise;
      if (!ex.observe || !ex.identify) err(`${tt} 结构自测缺少 observe/identify 配置`);
      else {
        if (!Number.isInteger(ex.observe.requiredStop) || ex.observe.requiredStop < 0) err(`${tt} 结构自测 requiredStop 非法`);
        if (!['x', 'y', 'z'].includes(ex.identify.axis)) err(`${tt} 结构自测剖切轴非法：${ex.identify.axis}`);
        if (!(ex.identify.position >= 0 && ex.identify.position <= 1)) err(`${tt} 结构自测剖切位置越界`);
        if (!partIds.has(ex.identify.answerPartId)) err(`${tt} 结构自测答案零件不存在：${ex.identify.answerPartId}`);
      }
    }
  }
}

/* ============ 工坊零件库目录校验 ============ */
const wsBundle = await build({
  stdin: {
    contents: "export { CATALOG } from './src/workshop/catalog.ts'; export { buildPart } from './src/workshop/geometry.ts'; export { assemblyAssets } from './src/workshop/expansion/index.ts';",
    resolveDir: root, loader: 'ts'
  },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent'
});
const wsDir = mkdtempSync(join(tmpdir(), 'chem3d-ws-validate-'));
const wsTmp = join(wsDir, 'catalog.mjs');
writeFileSync(wsTmp, wsBundle.outputFiles[0].text);
const { CATALOG, buildPart, assemblyAssets } = await import(pathToFileURL(wsTmp).href);
rmSync(wsDir, { recursive: true, force: true });

const WS_CATS = ['pipe', 'flange', 'valve', 'pump', 'heat', 'react', 'sep', 'tank', 'instr'];
const WS_CAPS = ['observe', 'section', 'connect', 'principle', 'disassemble'];
const WS_STR = ['id', 'name', 'category', 'status', 'summary', 'usage', 'partsDesc', 'portsDesc', 'material', 'color', 'builder'];
const wsIds = new Set();
let wsReady = 0;

for (const p of CATALOG) {
  const tag = `[工坊 ${p.id ?? '?'}]`;
  for (const f of WS_STR) {
    if (typeof p[f] !== 'string' || !p[f].trim()) err(`${tag} 缺少必填字段 ${f}`);
  }
  for (const f of ['learnPoints', 'tags', 'capabilities']) {
    if (!Array.isArray(p[f]) || p[f].length === 0) err(`${tag} 缺少必填数组 ${f}`);
  }
  if (wsIds.has(p.id)) err(`${tag} 零件编号重复`);
  wsIds.add(p.id);
  if (!['ready', 'dev'].includes(p.status)) err(`${tag} status 非法：${p.status}`);
  if (![1, 2, 3].includes(p.batch)) err(`${tag} batch 非法：${p.batch}`);
  if (!WS_CATS.includes(p.category)) err(`${tag} category 非法：${p.category}`);
  for (const c of p.capabilities ?? []) {
    if (!WS_CAPS.includes(c)) err(`${tag} capability 非法：${c}`);
  }
  if (!Number.isFinite(p.defaultSpec?.dn) || p.defaultSpec.dn < 0 || (p.defaultSpec.dn === 0 && p.ports.some(port => port.type !== 'mechanical'))) {
    err(`${tag} 公称尺寸或机械配合的规格字段无效`);
  }
  if (p.status === 'ready') {
    wsReady++;
    try {
      let meshes = 0;
      buildPart(p.id, p.defaultSpec, p.color, p.material).traverse(mesh => {
        if (!mesh.isMesh) return;
        const positions = mesh.geometry?.getAttribute('position');
        if (!positions?.count || !positions.array.every(Number.isFinite)) err(`${tag} 网格顶点无效`);
        else meshes++;
      });
      if (!meshes) err(`${tag} 可用零件无网格`);
    } catch (error) { err(`${tag} 生成模型失败：${error.message}`); }
    if (!Array.isArray(p.ports) || p.ports.length === 0) err(`${tag} 状态为 ready 但未定义连接接口`);
    for (const pt of p.ports ?? []) {
      if (!pt.id || !Array.isArray(pt.pos) || pt.pos.length !== 3 || !Array.isArray(pt.dir) || pt.dir.length !== 3) {
        err(`${tag} 接口 ${pt.id ?? '?'} 缺少 id/pos/dir`);
      }
      const len = Math.hypot(...(pt.dir ?? [0, 0, 0]));
      if (Math.abs(len - 1) > 1e-6) err(`${tag} 接口 ${pt.id} dir 未单位化（|dir|=${len.toFixed(3)}）`);
    }
  }
}
const expectedCodes = new Set(Array.from({ length: 60 }, (_, i) => `P${String(i + 1).padStart(3, '0')}`));
for (const asset of assemblyAssets) {
  if (!expectedCodes.delete(asset.code)) err(`[工坊 ${asset.id}] 编码重复或不在 P001–P060`);
  if (!asset.sources.length || asset.sources.some(source => !source.title || !source.basis)) err(`[工坊 ${asset.id}] 缺少逐件来源`);
}
if (expectedCodes.size) err(`工坊缺少清单编号：${[...expectedCodes].join('、')}`);

console.log(`内容校验：${DEVICES.length} 台设备，${DEVICES.reduce((n, d) => n + d.parts.length, 0)} 个零件，${DEVICES.reduce((n, d) => n + d.tasks.length, 0)} 个观察任务`);
console.log(`工坊目录：${CATALOG.length} 个对象（${wsReady} 个可搭建 / ${CATALOG.length - wsReady} 个开发中），覆盖 ${new Set(CATALOG.map((p) => p.category)).size} 大类`);
for (const w of warnings) console.log(`  警告 ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`  错误 ${e}`);
  console.error(`校验失败：${errors.length} 个错误`);
  process.exit(1);
}
console.log('校验通过：必填字段、编号唯一性、角色/连接一致性、安装目标、步骤依赖、任务引用、建模覆盖均正常。');
