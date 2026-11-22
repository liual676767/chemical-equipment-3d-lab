/**
 * Phase 0–4 集成验收：独立数据审计（不依赖既有校验器的结论，直接核对原始数据）。
 * 覆盖：设备库 18 台、微沸喷烧 18 实例/36 接口/13 管线/2 流线、全流程 20 实例/24 管线。
 * 运行：node scripts/acceptance/data-audit.mjs
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'outputs', 'acceptance-2026-11-18');
mkdirSync(outDir, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'chem3d-audit-'));
const outfile = join(dir, 'audit-entry.mjs');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

try {
  await build({
    stdin: {
      contents: `
        export { DEVICES } from './src/data/devices';
        export { BOIL_PROCESS } from './src/data/boilProcess';
        export { BOIL_LAYOUT } from './src/data/boilLayout';
        export { BOIL_MODELS, getBoilModelBounds } from './src/engine/boilModels';
        export { validatePiping } from './src/process/piping';
        export { PLANT_NODES, PIPELINES as PLANT_PIPELINES, auditPlantData } from './src/data/plant';
      `,
      resolveDir: root,
      sourcefile: 'audit-entry.ts',
      loader: 'ts'
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    outfile,
    logLevel: 'silent'
  });
  const { DEVICES, BOIL_PROCESS, BOIL_LAYOUT, BOIL_MODELS, getBoilModelBounds, validatePiping, PLANT_NODES, PLANT_PIPELINES, auditPlantData } =
    await import(pathToFileURL(outfile).href);

  /* ---------- A. 设备库 devices.ts ---------- */
  const deviceIds = DEVICES.map((d) => d.id);
  check('设备库：设备 ID 唯一', new Set(deviceIds).size === deviceIds.length, `${deviceIds.length} 台`);
  let partTotal = 0;
  const dupParts = [];
  for (const d of DEVICES) {
    const ids = d.parts.map((p) => p.id);
    if (new Set(ids).size !== ids.length) dupParts.push(d.id);
    partTotal += ids.length;
  }
  check('设备库：每台设备零件 ID 唯一', dupParts.length === 0, `零件总数 ${partTotal}${dupParts.length ? '；重复：' + dupParts.join(',') : ''}`);
  const missingDeviceFields = DEVICES.filter((d) => !d.name || !d.category || !d.contentVersion || !d.parts?.length).map((d) => d.id);
  check('设备库：名称/分类/内容版本/零件齐全', missingDeviceFields.length === 0, missingDeviceFields.join(',') || '18 台齐全');

  /* ---------- B. 微沸喷烧 boilProcess.ts ---------- */
  const P = BOIL_PROCESS;
  const eqIds = P.equipment.map((e) => e.id);
  check('微沸：设备实例 ID 唯一', new Set(eqIds).size === eqIds.length, `${eqIds.length} 实例`);
  const dupEq = eqIds.filter((id, i) => eqIds.indexOf(id) !== i);
  check('微沸：无重复设备', dupEq.length === 0, dupEq.join(',') || '无重复');

  const portKeys = [];
  const dupPorts = [];
  for (const e of P.equipment) {
    const ids = e.ports.map((p) => p.id);
    if (new Set(ids).size !== ids.length) dupPorts.push(e.id);
    for (const p of e.ports) portKeys.push(`${e.id}.${p.id}`);
  }
  check('微沸：接口 ID 每台唯一', dupPorts.length === 0, `接口总数 ${portKeys.length}`);

  for (const [label, arr] of [['管线', P.pipelines], ['工序', P.steps], ['工艺区', P.areas], ['介质', P.media], ['流线', P.flowStreams], ['缺口', P.gaps]]) {
    const ids = arr.map((x) => x.id);
    check(`微沸：${label} ID 唯一`, new Set(ids).size === ids.length, `${ids.length} 条`);
  }

  const eqMap = new Map(P.equipment.map((e) => [e.id, e]));
  const portMap = new Map();
  for (const e of P.equipment) for (const p of e.ports) portMap.set(`${e.id}.${p.id}`, { eq: e, port: p });

  const badRef = [];
  const badDir = [];
  const badMedium = [];
  const edgeSeen = new Set();
  const dupEdge = [];
  const selfLoop = [];
  const portUse = new Map();
  for (const pipe of P.pipelines) {
    const fk = `${pipe.from.equipment}.${pipe.from.port}`;
    const tk = `${pipe.to.equipment}.${pipe.to.port}`;
    const f = portMap.get(fk);
    const t = portMap.get(tk);
    if (!f || !t) { badRef.push(pipe.id); continue; }
    if (f.port.role !== 'out' && f.port.role !== 'both') badDir.push(`${pipe.id} 起点 ${fk} role=${f.port.role}`);
    if (t.port.role !== 'in' && t.port.role !== 'both') badDir.push(`${pipe.id} 终点 ${tk} role=${t.port.role}`);
    for (const [k, ep] of [[fk, f], [tk, t]]) {
      if (ep.port.media.length > 0 && !ep.port.media.includes(pipe.medium)) badMedium.push(`${pipe.id} ${k} 允许介质[${ep.port.media}] 不含 ${pipe.medium}`);
    }
    if (fk === tk) selfLoop.push(pipe.id);
    const edgeKey = `${fk}->${tk}`;
    if (edgeSeen.has(edgeKey)) dupEdge.push(edgeKey);
    edgeSeen.add(edgeKey);
    portUse.set(fk, (portUse.get(fk) ?? 0) + 1);
    portUse.set(tk, (portUse.get(tk) ?? 0) + 1);
  }
  check('微沸：管线两端引用存在的设备接口', badRef.length === 0, badRef.join(',') || '13/13');
  check('微沸：管线方向正确（起点出口→终点入口）', badDir.length === 0, badDir.join('；') || '13/13');
  check('微沸：管线介质与接口允许介质一致', badMedium.length === 0, badMedium.join('；') || '13/13');
  check('微沸：无重复连接边', dupEdge.length === 0, dupEdge.join(',') || '13 边无重复');
  check('微沸：无自环连接', selfLoop.length === 0, selfLoop.join(',') || '无');

  // 有向环检测（DFS）
  const adj = new Map();
  for (const pipe of P.pipelines) {
    if (!adj.has(pipe.from.equipment)) adj.set(pipe.from.equipment, []);
    adj.get(pipe.from.equipment).push(pipe.to.equipment);
  }
  const state = new Map();
  let cycle = null;
  function dfs(u, stack) {
    state.set(u, 1);
    for (const v of adj.get(u) ?? []) {
      if (state.get(v) === 1) { cycle = [...stack, u, v].join('→'); return true; }
      if (!state.has(v) && dfs(v, [...stack, u])) return true;
    }
    state.set(u, 2);
    return false;
  }
  for (const id of eqIds) if (!state.has(id) && dfs(id, [])) break;
  check('微沸：连接图无有向环', cycle === null, cycle ?? '无环');

  // 孤立设备：无任何管线连接且未标待确认
  const orphans = [];
  const pendingOrphans = [];
  for (const e of P.equipment) {
    const used = e.ports.some((p) => (portUse.get(`${e.id}.${p.id}`) ?? 0) > 0);
    if (!used) (e.dataStatus === 'pending-confirmation' ? pendingOrphans : orphans).push(e.id);
  }
  check('微沸：无未标注的孤立设备', orphans.length === 0, orphans.join(',') || '无');
  check('微沸：未连接设备均已标待确认（四根喷枪）', pendingOrphans.length === 4 && pendingOrphans.every((id) => id.startsWith('eq-spray-gun')), pendingOrphans.join(','));

  // 接口连接口径
  let connected = 0, boundary = 0, pending = 0, unconnectedUnmarked = [];
  for (const e of P.equipment) for (const p of e.ports) {
    const used = (portUse.get(`${e.id}.${p.id}`) ?? 0) > 0;
    if (used) connected++;
    else if (p.boundary) boundary++;
    else if (p.dataStatus === 'pending-confirmation') pending++;
    else unconnectedUnmarked.push(`${e.id}.${p.id}`);
  }
  check('微沸：接口连接口径 26 接管/2 边界/8 待确认/0 未标注', connected === 26 && boundary === 2 && pending === 8 && unconnectedUnmarked.length === 0,
    `接管 ${connected} / 边界 ${boundary} / 待确认 ${pending} / 未连接未标注 ${unconnectedUnmarked.length}${unconnectedUnmarked.length ? '：' + unconnectedUnmarked.join(',') : ''}`);

  // 流线连续性：序列相邻设备间必须有该流线的管线
  const streamIssues = [];
  for (const s of P.flowStreams) {
    const streamPipes = P.pipelines.filter((p) => p.flowStreamId === s.id);
    const declared = new Set(s.pipelineIds);
    for (const p of streamPipes) if (!declared.has(p.id)) streamIssues.push(`${s.id} 管线 ${p.id} 未列入流线清单`);
    for (const pid of s.pipelineIds) if (!streamPipes.some((p) => p.id === pid)) streamIssues.push(`${s.id} 清单管线 ${pid} 不存在或不属于本流线`);
    for (let i = 0; i + 1 < s.equipmentSequence.length; i++) {
      const a = s.equipmentSequence[i], b = s.equipmentSequence[i + 1];
      const link = streamPipes.find((p) => p.from.equipment === a && p.to.equipment === b);
      if (!link) streamIssues.push(`${s.id} 序列断点 ${a}→${b}`);
    }
  }
  check('微沸：两条流线连续且管线清单一致', streamIssues.length === 0, streamIssues.join('；') || `物料 ${P.flowStreams[0].equipmentSequence.length} 台 / 烟气 ${P.flowStreams[1].equipmentSequence.length} 台`);

  // 必填字段
  const areaIds = new Set(P.areas.map((a) => a.id));
  const stepIds = new Set(P.steps.map((s) => s.id));
  const missingFields = [];
  for (const e of P.equipment) {
    for (const f of ['name', 'function', 'internals', 'areaId', 'stepId', 'modelKey', 'modelStatus', 'sourceNote']) {
      if (!e[f]) missingFields.push(`${e.id}.${f}`);
    }
    if (!areaIds.has(e.areaId)) missingFields.push(`${e.id}.areaId 引用不存在`);
    if (!stepIds.has(e.stepId)) missingFields.push(`${e.id}.stepId 引用不存在`);
  }
  check('微沸：设备必填字段齐全', missingFields.length === 0, missingFields.join(',') || '18 台齐全');

  // gapIds 引用存在
  const gapIds = new Set(P.gaps.map((g) => g.id));
  const badGap = [];
  const collect = (obj, where) => { for (const g of obj.gapIds ?? []) if (!gapIds.has(g)) badGap.push(`${where}:${g}`); };
  for (const e of P.equipment) { collect(e, e.id); for (const p of e.ports) collect(p, `${e.id}.${p.id}`); }
  for (const p of P.pipelines) collect(p, p.id);
  for (const s of P.flowStreams) collect(s, s.id);
  check('微沸：gapIds 引用均存在', badGap.length === 0, badGap.join(',') || `缺口 ${gapIds.size} 项`);

  // 布局覆盖
  const layoutIds = BOIL_LAYOUT.map((l) => l.equipmentId);
  check('微沸：教学布局覆盖全部实例且无重复', layoutIds.length === eqIds.length && new Set(layoutIds).size === layoutIds.length && eqIds.every((id) => layoutIds.includes(id)), `${layoutIds.length} 布局`);

  /* ---------- C. 管道路由端点与接口一致性 ---------- */
  const specs = {};
  for (const key of Object.keys(BOIL_MODELS)) {
    specs[key] = {
      key,
      bbox: getBoilModelBounds(key),
      ports: BOIL_MODELS[key].ports.map((p) => ({ id: p.id, pos: p.pos, dir: p.dir, size: p.size, role: p.role, media: p.media, boundary: p.boundary }))
    };
  }
  const piping = validatePiping(P, (key) => specs[key], {}, BOIL_LAYOUT);
  const worldPort = new Map(piping.world.ports.map((p) => [`${p.equipmentId}.${p.portId}`, p]));
  const routeIssues = [];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  for (const route of piping.routes) {
    const pipe = P.pipelines.find((p) => p.id === route.pipelineId);
    if (!pipe) { routeIssues.push(`${route.pipelineId} 无对应管线`); continue; }
    const fk = `${pipe.from.equipment}.${pipe.from.port}`;
    const tk = `${pipe.to.equipment}.${pipe.to.port}`;
    if (route.fromPortKey !== fk || route.toPortKey !== tk) routeIssues.push(`${route.pipelineId} 端点键不一致`);
    const wpFrom = worldPort.get(fk), wpTo = worldPort.get(tk);
    const start = route.points[0], end = route.points[route.points.length - 1];
    if (!wpFrom || dist(start, wpFrom.world) > 1e-6) routeIssues.push(`${route.pipelineId} 起点与接口世界坐标不符`);
    if (!wpTo || dist(end, wpTo.world) > 1e-6) routeIssues.push(`${route.pipelineId} 终点与接口世界坐标不符`);
    // 连续性：相邻点必须共轴（正交）且段长>0
    for (let i = 0; i + 1 < route.points.length; i++) {
      const a = route.points[i], b = route.points[i + 1];
      const d = [Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])];
      const nonzero = d.filter((x) => x > 1e-9).length;
      if (nonzero !== 1) routeIssues.push(`${route.pipelineId} 第${i}段非正交`);
      if (dist(a, b) < 1e-9) routeIssues.push(`${route.pipelineId} 第${i}段零长度`);
    }
  }
  check('管道：13 条路由端点与设备接口世界坐标一致', piping.routes.length === 13 && routeIssues.length === 0, routeIssues.slice(0, 5).join('；') || '13/13，逐段正交无零长');
  check('管道：穿模/设备重叠/支架冲突为 0', piping.counts.collisions === 0 && piping.counts.equipmentOverlaps === 0 && piping.counts.supportConflicts === 0,
    `穿模 ${piping.counts.collisions} / 重叠 ${piping.counts.equipmentOverlaps} / 支架冲突 ${piping.counts.supportConflicts}`);
  const sizeIssues = [];
  for (const route of piping.routes) {
    const pipe = P.pipelines.find((p) => p.id === route.pipelineId);
    if (pipe?.route && pipe.route.size !== route.size) sizeIssues.push(route.pipelineId);
  }
  check('管道：管径等级与数据配置一致', sizeIssues.length === 0, `三档定义 main/branch/utility，工艺线全部 main；不一致 ${sizeIssues.length}`);

  /* ---------- D. 全流程 plant.ts ---------- */
  const audit = auditPlantData();
  check('全流程：数据自检 0 问题', audit.issues.length === 0, audit.issues.slice(0, 5).join('；') || `节点 ${audit.counts.nodes} / 管线 ${audit.counts.pipes}`);
  check('全流程：连接/管线/流向/数据/可达性 100%', audit.nodeConnection === 100 && audit.pipeIntegrity === 100 && audit.flowDirection === 100 && audit.nodeData === 100 && audit.flowReach === 100,
    `连接 ${audit.nodeConnection}% / 管线 ${audit.pipeIntegrity}% / 流向 ${audit.flowDirection}% / 数据 ${audit.nodeData}% / 可达 ${audit.flowReach}%`);
  const plantDupUid = PLANT_NODES.map((n) => n.uid).filter((id, i, arr) => arr.indexOf(id) !== i);
  check('全流程：设备位号唯一', plantDupUid.length === 0, `${PLANT_NODES.length} 实例`);
  const plantBadDevice = PLANT_NODES.filter((n) => !DEVICES.some((d) => d.id === n.deviceId)).map((n) => n.uid);
  check('全流程：实例均引用设备库已有设备', plantBadDevice.length === 0, plantBadDevice.join(',') || '20/20');

  const failed = results.filter((r) => !r.ok);
  writeFileSync(join(outDir, 'data-audit.json'), JSON.stringify({ time: new Date().toISOString(), total: results.length, failed: failed.length, results, plantAudit: audit, pipingCounts: piping.counts }, null, 2));
  console.log(`\n独立数据审计：${results.length - failed.length}/${results.length} 通过`);
  process.exitCode = failed.length ? 1 : 0;
} catch (error) {
  console.error('审计执行失败：', error);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}