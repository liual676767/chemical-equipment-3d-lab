/* 方案存储：保存在当前浏览器 localStorage，明确告知用户保存位置。
 * 跨设备同步（账户/云端）按用户要求留待后续需要时再建设。 */
import type { Instance, Plan, WState } from './types';
import { WORKSHOP_CONTENT_VERSION } from './types';
import { partById } from './catalog';
import { reducerSmallValid } from './specs';
import { emptyState, newUid, livePorts, portsAligned, quatOf, validateConnection } from './state';

const KEY = 'chem3d-workshop:v1';
const SCHEMA = 1;

interface StoreShape { schema: number; plans: Plan[]; lastPlanId: string | null }

export let workshopStorageWarning: string | null = null;
type WriteResult = { ok: true } | { ok: false; error: string };
type ReadResult = { ok: true; store: StoreShape } | { ok: false; error: string };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function storedPlan(plan: Plan) {
  return {
    ...plan,
    state: { ...plan.state, instances: plan.state.instances.map(instance => ({
      ...instance, instanceId: instance.uid, partTypeId: instance.partId,
      variantId: JSON.stringify([instance.spec.dn, instance.spec.smallDn ?? null, instance.spec.length ?? null, instance.spec.endType ?? null]),
      quaternion: quatOf(instance).toArray(), scale: [1, 1, 1]
    })) }
  };
}

function load(): ReadResult {
  let raw: string | null;
  try { raw = localStorage.getItem(KEY); }
  catch { return { ok: false, error: '无法访问浏览器的本地工坊存储。' }; }
  if (raw === null) return { ok: true, store: { schema: SCHEMA, plans: [], lastPlanId: null } };
  try {
    const s = JSON.parse(raw) as StoreShape;
    if (s?.schema === SCHEMA && Array.isArray(s.plans) && (s.lastPlanId == null || typeof s.lastPlanId === 'string')
      && s.plans.every(p => record(p) && typeof p.id === 'string' && typeof p.name === 'string')) {
      return { ok: true, store: { ...s, lastPlanId: s.lastPlanId === undefined ? s.plans[0]?.id ?? null : s.lastPlanId } };
    }
  } catch { /* Preserve malformed JSON for recovery. */ }
  return { ok: false, error: '本机工坊存档格式有误，原始存档已保留。' };
}

function update(change: (store: StoreShape) => WriteResult | void): WriteResult {
  const current = load();
  if (!current.ok) return current;
  const outcome = change(current.store);
  if (outcome && !outcome.ok) return outcome;
  try {
    localStorage.setItem(KEY, JSON.stringify(current.store));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof DOMException && error.name === 'QuotaExceededError'
      ? '浏览器的本地存储容量不足，可以导出当前方案。'
      : '无法写入浏览器的本地存储，可以导出当前方案。' };
  }
}

export function listPlans(): Plan[] {
  const data = load();
  return data.ok ? data.store.plans.sort((a, b) => b.updatedAt - a.updatedAt) : [];
}

export function lastPlanId(): string | null {
  const data = load();
  return data.ok ? data.store.lastPlanId : null;
}

export function getPlan(id: string): Plan | undefined {
  const plan = listPlans().find(p => p.id === id);
  if (!plan) return undefined;
  const problem = validateState(plan.state);
  if (problem) {
    workshopStorageWarning = '无法载入「' + plan.name + '」：' + problem + ' 原方案保留。';
    return undefined;
  }
  return { ...plan, taskProgress: record(plan.taskProgress) ? plan.taskProgress : {} };
}

export function newPlan(name: string) {
  const plan: Plan = {
    id: newUid(), name, createdAt: Date.now(), updatedAt: Date.now(),
    contentVersion: WORKSHOP_CONTENT_VERSION, state: emptyState(), taskProgress: {}
  };
  return { plan, write: savePlan(plan) };
}

export function savePlan(plan: Plan): WriteResult {
  return update(store => {
    const idx = store.plans.findIndex(p => p.id === plan.id);
    const persisted = storedPlan({ ...plan, updatedAt: Date.now(), contentVersion: WORKSHOP_CONTENT_VERSION });
    if (idx >= 0) store.plans[idx] = persisted; else store.plans.push(persisted);
    store.lastPlanId = plan.id;
  });
}

const missingPlan = { ok: false, error: '方案已不存在。' } as const;

export function renamePlan(id: string, name: string): WriteResult {
  return update(store => {
    const plan = store.plans.find(p => p.id === id);
    if (!plan) return missingPlan;
    plan.name = name;
    plan.updatedAt = Date.now();
  });
}

export function duplicatePlan(id: string): WriteResult {
  return update(store => {
    const plan = store.plans.find(p => p.id === id);
    if (!plan) return missingPlan;
    const now = Date.now();
    store.plans.push({ ...plan, id: newUid(), name: plan.name + '（副本）', createdAt: now, updatedAt: now });
  });
}

export function deletePlan(id: string): WriteResult {
  return update(store => {
    store.plans = store.plans.filter(p => p.id !== id);
    if (store.lastPlanId === id) store.lastPlanId = store.plans[0]?.id ?? null;
  });
}

export function setLastPlan(id: string): WriteResult {
  return update(store => { store.lastPlanId = id; });
}

/* ---------- 导入 / 导出 ---------- */

export interface ExportFile {
  app: 'chem3d-workshop-plan';
  schema: number;
  schemaVersion?: number;
  contentVersion: string;
  exportedAt: string;
  plan: Plan;
}

export function exportPlan(plan: Plan): ExportFile {
  return {
    app: 'chem3d-workshop-plan', schema: SCHEMA, schemaVersion: SCHEMA,
    contentVersion: WORKSHOP_CONTENT_VERSION,
    exportedAt: new Date().toISOString(), plan: validateState(plan.state) ? plan : storedPlan(plan)
  };
}

const supportedKinds = new Set(['flange', 'thread', 'weld', 'bolt-slot', 'nut', 'clamp', 'mechanical']);
const tuple = (v: unknown, length: number, limit: number) => Array.isArray(v) && v.length === length
  && v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= limit);
const validId = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(value);

export function validateState(state: WState): string | null {
  if (!record(state) || !Array.isArray(state.instances) || !Array.isArray(state.connections) || !Array.isArray(state.groups)) {
    return '文件缺少零件实例、连接或分组数据。';
  }
  if (state.instances.length > 2500 || state.connections.length > 10000 || state.groups.length > 2500) return '方案超过可载入的数量上限。';
  const groupIds = new Set<string>();
  for (const group of state.groups) {
    if (!record(group) || !validId(group.id) || groupIds.has(group.id) || typeof group.name !== 'string' || typeof group.color !== 'string') return '分组数据无效。';
    groupIds.add(group.id);
  }
  const instances = new Map<string, Instance>();
  for (const item of state.instances) {
    if (!record(item) || !validId(item.uid) || instances.has(item.uid)) return '存在重复或缺失的零件实例标识。';
    if (typeof item.partId !== 'string') return '零件类型编号无效。';
    const part = partById(item.partId);
    if (!part || part.status !== 'ready') return `缺少可用零件资源：${item.partId}。`;
    if (!tuple(item.pos, 3, 2000) || !tuple(item.rot, 3, 10000)) return '零件位置或旋转数据无效。';
    if (item.scale !== undefined && (!tuple(item.scale, 3, 1) || !Array.isArray(item.scale) || item.scale.some(n => n !== 1))) return '工坊仅允许单位缩放。';
    if (item.quaternion !== undefined && (!tuple(item.quaternion, 4, 1.000001) || !Array.isArray(item.quaternion)
      || Math.abs(Math.hypot(...item.quaternion) - 1) > 0.00001)) return '旋转四元数数据无效。';
    if (!record(item.spec) || !Number.isInteger(item.spec.dn) || item.spec.dn < 0 || item.spec.dn > 1000) return '零件规格数据无效。';
    if (item.spec.endType !== undefined && !['weld', 'thread', 'flange'].includes(item.spec.endType)) return '端部连接形式无效。';
    if (item.spec.length !== undefined && (!Number.isFinite(item.spec.length) || item.spec.length < 1 || item.spec.length > 10000)) return '零件长度超出范围。';
    if (item.spec.smallDn !== undefined && (item.partId === 'coupling-reducing-thread'
      ? item.spec.dn !== part.defaultSpec.dn || item.spec.smallDn !== part.defaultSpec.smallDn
      : !reducerSmallValid(item.spec.dn, item.spec.smallDn))) return '异径件小端规格不在教学配对表中。';
    if (item.groupId !== undefined && !groupIds.has(item.groupId)) return '零件引用了不存在的分组。';
    try { livePorts(item); } catch { return `零件 ${part.name} 的规格无效。`; }
    instances.set(item.uid, item);
  }
  const connectionIds = new Set<string>();
  const occupying = new Set<string>();
  for (const c of state.connections) {
    if (!record(c) || !validId(c.id) || connectionIds.has(c.id) || !supportedKinds.has(c.kind)) return '存在重复或无效的连接标识。';
    connectionIds.add(c.id);
    for (const end of [c.a, c.b]) {
      if (!record(end) || !validId(end.uid) || !validId(end.port)) return '连接端点标识无效。';
      if (end.port !== 'surface') {
        const key = `${end.uid}|${end.port}`;
        if (occupying.has(key)) return '同一安装位置被重复占用。';
        occupying.add(key);
      }
      if (end.uid.startsWith('joint:')) {
        const joint = state.connections.find(x => record(x) && x.id === end.uid.slice(6));
        if (c.kind !== 'bolt-slot' || joint?.kind !== 'flange' || !/^slot\d+$/.test(end.port)) return '螺栓孔位引用了不存在的法兰连接。';
        continue;
      }
      const inst = instances.get(end.uid);
      if (!inst) return '连接引用了不存在的零件实例。';
      if (end.port === 'surface' && (c.kind !== 'clamp' || inst.partId !== 'pipe')) return '管夹引用了无效的外壁。';
      if (end.port !== 'surface' && !livePorts(inst).some(p => p.id === end.port)) return `连接引用了不存在的接口：${end.port}。`;
    }
    if (c.a.uid === c.b.uid) return '连接不能引用同一零件。';
  }
  for (const c of state.connections) {
    const checked = validateConnection(state, c.a, c.b, false, c.id);
    if (!checked.ok) return '连接 ' + c.id + '：' + checked.reason;
    if (checked.kind !== c.kind) return '连接 ' + c.id + ' 的连接类型与接口不符。';
    if (['mechanical', 'flange', 'thread', 'weld'].includes(c.kind) && !portsAligned(state, c.a, c.b)) {
      return '连接 ' + c.id + ' 的位置、方向或法兰孔位未对齐。';
    }
  }
  return null;
}

export function importPlanFile(text: string): { ok: true; plan: Plan } | { ok: false; error: string } {
  let data: ExportFile;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: '文件不是有效的 JSON。' };
  }
  if (!record(data) || data.app !== 'chem3d-workshop-plan') return { ok: false, error: '文件不是工坊方案文件（缺少 app 标识）。' };
  if (data.schema !== SCHEMA) return { ok: false, error: `方案文件版本不兼容：文件 schema=${data.schema}，当前支持 schema=${SCHEMA}。` };
  if (data.schemaVersion !== undefined && data.schemaVersion !== SCHEMA) return { ok: false, error: '方案 schemaVersion 不兼容。' };
  if (!record(data.plan) || typeof data.plan.name !== 'string' || data.plan.name.length > 160 || !data.plan.state) return { ok: false, error: '文件缺少方案数据。' };
  const err = validateState(data.plan.state);
  if (err) return { ok: false, error: err };
  if (data.contentVersion !== WORKSHOP_CONTENT_VERSION && data.contentVersion !== '2026-11-16.1') return { ok: false, error: '不支持该内容版本。' };
  const plan: Plan = JSON.parse(JSON.stringify(data.plan));
  plan.id = newUid();
  plan.createdAt = Date.now();
  plan.updatedAt = Date.now();
  const validProgress = (value: unknown) => record(value) && Number.isFinite(value.completedAt) && Number.isInteger(value.attempts);
  plan.taskProgress = record(plan.taskProgress) ? Object.fromEntries(Object.entries(plan.taskProgress).filter(([key, value]) => validId(key) && validProgress(value))) : {};
  plan.activeTask = validId(plan.activeTask) ? plan.activeTask : undefined;
  const write = savePlan(plan);
  return write.ok ? { ok: true, plan } : write;
}
