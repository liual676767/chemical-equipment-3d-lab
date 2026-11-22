import type { PracticeSnapshot } from '../engine/SceneManager';
import { deviceById } from '../data/devices';

export interface CompletionRecord {
  elapsed: number;
  errors: number;
  hints: number;
  assisted: boolean;
  date: number;
  mode: 'guided' | 'free';
}

export interface SelfCheckRecord {
  done: boolean;
  attempts: number;
  date: number;
}

export interface DeviceRecord {
  favorite: boolean;
  lastVisited: number;
  practice?: PracticeSnapshot;
  best?: CompletionRecord;
  completions: number;
  /** 记录对应的内容版本；与设备当前版本不一致时练习进度按不兼容处理 */
  contentVersion?: string;
  /** 观察任务完成状态（按内容版本保存） */
  tasks?: Record<string, boolean>;
  taskVersion?: string;
  /** 结构自测成绩：与手动勾选分开保存，重复完成不重复计数 */
  checks?: Record<string, SelfCheckRecord>;
  checkVersion?: string;
}

export interface FeedbackEntry {
  id: string;
  date: number;
  deviceId: string;
  deviceName: string;
  mode: string;
  contentVersion: string;
  text: string;
  ua: string;
}

interface PersistState {
  schema: number;
  devices: Record<string, DeviceRecord>;
  feedback: FeedbackEntry[];
}

const KEY = 'chem3d-lab:v1';
const SCHEMA = 2;

function load(): PersistState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistState> & { devices?: Record<string, DeviceRecord> };
      const devices = parsed.devices ?? {};
      if ((parsed.schema ?? 1) < SCHEMA) {
        // 旧版记录：保留收藏/成绩，无版本标记的练习进度视为不兼容并丢弃
        for (const r of Object.values(devices)) {
          if (r.practice && !r.contentVersion) delete r.practice;
        }
      }
      return { schema: SCHEMA, devices, feedback: parsed.feedback ?? [] };
    }
  } catch { /* 损坏数据按空处理 */ }
  return { schema: SCHEMA, devices: {}, feedback: [] };
}

let state = load();

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 存储已满时静默降级 */ }
}

export function getRecord(deviceId: string): DeviceRecord {
  if (!state.devices[deviceId]) {
    state.devices[deviceId] = { favorite: false, lastVisited: 0, completions: 0 };
  }
  return state.devices[deviceId];
}

export function toggleFavorite(deviceId: string): boolean {
  const r = getRecord(deviceId);
  r.favorite = !r.favorite;
  persist();
  return r.favorite;
}

export function touchDevice(deviceId: string) {
  getRecord(deviceId).lastVisited = Date.now();
  persist();
}

export function savePractice(deviceId: string, snap: PracticeSnapshot) {
  const r = getRecord(deviceId);
  r.practice = snap;
  r.contentVersion = deviceById(deviceId)?.contentVersion;
  persist();
}

export function clearPractice(deviceId: string) {
  const r = getRecord(deviceId);
  delete r.practice;
  persist();
}

/** 练习进度是否仍适用于当前内容版本 */
export function practiceCompatible(deviceId: string): boolean {
  const r = getRecord(deviceId);
  return !!r.practice && r.contentVersion === deviceById(deviceId)?.contentVersion;
}

export function saveCompletion(deviceId: string, rec: CompletionRecord) {
  const r = getRecord(deviceId);
  r.completions++;
  const better = !r.best || (!rec.assisted && r.best.assisted) ||
    (rec.assisted === r.best.assisted && rec.elapsed < r.best.elapsed);
  if (better) r.best = rec;
  delete r.practice;
  r.contentVersion = deviceById(deviceId)?.contentVersion;
  persist();
}

export function recentDevices(): string[] {
  return Object.entries(state.devices)
    .filter(([, r]) => r.lastVisited > 0)
    .sort((a, b) => b[1].lastVisited - a[1].lastVisited)
    .map(([id]) => id);
}

/* ---------- 观察任务 ---------- */

export function taskState(deviceId: string): Record<string, boolean> {
  const r = getRecord(deviceId);
  const ver = deviceById(deviceId)?.contentVersion;
  if (r.taskVersion !== ver) {
    r.tasks = {};
    r.taskVersion = ver;
    persist();
  }
  return r.tasks ?? {};
}

export function setTask(deviceId: string, taskId: string, done: boolean) {
  const tasks = taskState(deviceId);
  tasks[taskId] = done;
  getRecord(deviceId).tasks = tasks;
  persist();
}

/* ---------- 结构自测（与手动勾选分开保存） ---------- */

export function checkState(deviceId: string): Record<string, SelfCheckRecord> {
  const r = getRecord(deviceId);
  const ver = deviceById(deviceId)?.contentVersion;
  if (r.checkVersion !== ver) {
    r.checks = {};
    r.checkVersion = ver;
    persist();
  }
  return r.checks ?? {};
}

export function getSelfCheck(deviceId: string, checkId: string): SelfCheckRecord | undefined {
  return checkState(deviceId)[checkId];
}

/** 已完成的自测重复完成时保留首次完成时间，不重复计数。 */
export function saveSelfCheck(deviceId: string, checkId: string, attempts: number): SelfCheckRecord {
  const checks = checkState(deviceId);
  const prev = checks[checkId];
  const rec: SelfCheckRecord = prev?.done
    ? { done: true, attempts: Math.max(prev.attempts, attempts), date: prev.date }
    : { done: true, attempts: Math.max(1, attempts), date: Date.now() };
  checks[checkId] = rec;
  getRecord(deviceId).checks = checks;
  persist();
  return rec;
}

/* ---------- 反馈 ---------- */

export function addFeedback(entry: Omit<FeedbackEntry, 'id' | 'date' | 'ua'>): FeedbackEntry {
  const full: FeedbackEntry = {
    ...entry,
    id: `fb-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    date: Date.now(),
    ua: navigator.userAgent
  };
  state.feedback.push(full);
  persist();
  return full;
}

export function getFeedback(): FeedbackEntry[] {
  return state.feedback;
}

/* ---------- 导出 / 导入 / 清除 ---------- */

export function exportRecords(): string {
  return JSON.stringify({
    app: 'chem3d-lab',
    schema: SCHEMA,
    exportedAt: new Date().toISOString(),
    contentVersions: Object.fromEntries(
      Object.keys(state.devices).map((id) => [id, deviceById(id)?.contentVersion ?? null])
    ),
    devices: state.devices,
    feedback: state.feedback
  }, null, 2);
}

export function importRecords(json: string): { ok: boolean; error?: string; devices?: number } {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return { ok: false, error: '文件不是合法的 JSON。' }; }
  const obj = parsed as Partial<PersistState> & { app?: string };
  if (obj.app !== 'chem3d-lab' || typeof obj.devices !== 'object' || obj.devices === null) {
    return { ok: false, error: '不是本实训室导出的记录文件（缺少 app/devices 字段）。' };
  }
  const devices: Record<string, DeviceRecord> = {};
  for (const [id, r] of Object.entries(obj.devices)) {
    if (!r || typeof r !== 'object') continue;
    const rec = r as DeviceRecord;
    devices[id] = {
      favorite: !!rec.favorite,
      lastVisited: Number(rec.lastVisited) || 0,
      completions: Number(rec.completions) || 0,
      practice: rec.practice && typeof rec.practice === 'object' ? rec.practice : undefined,
      best: rec.best && typeof rec.best === 'object' ? rec.best : undefined,
      contentVersion: typeof rec.contentVersion === 'string' ? rec.contentVersion : undefined,
      tasks: rec.tasks && typeof rec.tasks === 'object' ? rec.tasks : undefined,
      taskVersion: typeof rec.taskVersion === 'string' ? rec.taskVersion : undefined,
      checks: rec.checks && typeof rec.checks === 'object' ? rec.checks : undefined,
      checkVersion: typeof rec.checkVersion === 'string' ? rec.checkVersion : undefined
    };
    if (devices[id].practice && devices[id].contentVersion !== deviceById(id)?.contentVersion) {
      delete devices[id].practice;
    }
  }
  state = {
    schema: SCHEMA,
    devices,
    feedback: Array.isArray(obj.feedback) ? (obj.feedback as FeedbackEntry[]).filter((f) => f && typeof f.text === 'string') : []
  };
  persist();
  return { ok: true, devices: Object.keys(devices).length };
}

export function clearRecords() {
  state = { schema: SCHEMA, devices: {}, feedback: [] };
  persist();
}

export function recordsSummary(): { devices: number; completions: number; feedback: number } {
  const rs = Object.values(state.devices);
  return {
    devices: rs.filter((r) => r.lastVisited > 0 || r.completions > 0 || r.favorite).length,
    completions: rs.reduce((n, r) => n + r.completions, 0),
    feedback: state.feedback.length
  };
}

export function fmtTime(sec: number): string {
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60)}`;
}