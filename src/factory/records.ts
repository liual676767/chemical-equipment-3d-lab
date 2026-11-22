/**
 * 教学工厂本地记录（与实训室/工坊的记录键完全隔离）。
 * 仅保存：到访过的设备、样板任务进度、法兰练习完成情况。
 */

export const FACTORY_STORE_KEY = 'chem3d-factory:v1';

export interface JointRecord {
  done: boolean;
  at: number;
  /** 实际装入的零件（练习完成时记录） */
  items: string[];
  attempts: number;
}

export interface FactoryTaskStep {
  id: string;
  title: string;
  hint: string;
  target?: string;
}

export interface FactoryTaskState {
  step: number;
  done: { id: string; note: string; at: number }[];
  startedAt?: number;
  finishedAt?: number;
}

export interface FactoryRecords {
  schema: 1;
  visited: Record<string, number>;
  task: FactoryTaskState;
  joints: Record<string, JointRecord>;
  updatedAt: number;
}

/** 样板任务：追踪一批物料从调配罐到灌装机（10 步，进度按实际操作推进） */
export const SAMPLE_TASK_STEPS: FactoryTaskStep[] = [
  { id: 'find-R-202', title: '找到调配罐 R-202', hint: '在厂区点击调配罐，或从左侧工序「调配」进入。', target: 'R-202' },
  { id: 'down-P-202', title: '沿下游找到气动双隔膜泵 P-202', hint: '选中 R-202 后点「沿下游查看」，再点高亮管线上的 P-202。', target: 'P-202' },
  { id: 'appearance', title: '查看 P-202 外观参照', hint: '点「走近查看」进入细节，再点「外观参照」，对比同视角下的外观模型。', target: 'P-202' },
  { id: 'structure', title: '切回内部教学结构', hint: '点「内部教学结构」回到教学模型，观察泵体内部。', target: 'P-202' },
  { id: 'ports', title: '识别液体进口与出口', hint: '在细节浮层的接口清单（或场景热区）中识别进口总管与出口总管。', target: 'P-202' },
  { id: 'exit-detail', title: '退出设备细节（仍聚焦 P-202）', hint: '点「返回厂区」关闭细节，相机回到进入前的位置。', target: 'P-202' },
  { id: 'down-F-201', title: '沿下游找到袋式过滤器 F-201', hint: '在 P-202 卡片点「沿下游查看」，选择 F-201。', target: 'F-201' },
  { id: 'open-joint', title: '打开泵—过滤器法兰接头', hint: '点击管线上的琥珀色法兰接头标记（JOINT-201）。', target: 'JOINT-201' },
  { id: 'complete-joint', title: '完成法兰连接练习', hint: '装入 1 片密封垫片、4 条 M16 螺栓、4 个 M16 螺母。', target: 'JOINT-201' },
  { id: 'down-FL-201', title: '继续到灌装机 FL-201', hint: '返回厂区，在 F-201 卡片沿下游进入灌装机。', target: 'FL-201' }
];

export function emptyTask(): FactoryTaskState {
  return { step: 0, done: [] };
}

export function emptyRecords(): FactoryRecords {
  return { schema: 1, visited: {}, task: emptyTask(), joints: {}, updatedAt: Date.now() };
}

export function loadFactoryRecords(): FactoryRecords {
  try {
    const raw = localStorage.getItem(FACTORY_STORE_KEY);
    if (!raw) return emptyRecords();
    const parsed = JSON.parse(raw) as Partial<FactoryRecords>;
    if (!parsed || parsed.schema !== 1) return emptyRecords();
    const task = parsed.task && typeof parsed.task.step === 'number'
      ? { ...emptyTask(), ...parsed.task, step: Math.max(0, Math.min(SAMPLE_TASK_STEPS.length, parsed.task.step)) }
      : emptyTask();
    return {
      schema: 1,
      visited: parsed.visited && typeof parsed.visited === 'object' ? parsed.visited : {},
      task,
      joints: parsed.joints && typeof parsed.joints === 'object' ? parsed.joints : {},
      updatedAt: parsed.updatedAt ?? Date.now()
    };
  } catch {
    return emptyRecords();
  }
}

export function saveFactoryRecords(records: FactoryRecords) {
  try {
    records.updatedAt = Date.now();
    localStorage.setItem(FACTORY_STORE_KEY, JSON.stringify(records));
  } catch {
    /* 本机存储不可用时静默降级，不影响浏览 */
  }
}

export function markVisited(records: FactoryRecords, uid: string) {
  records.visited[uid] = Date.now();
  saveFactoryRecords(records);
}

export function resetTask(records: FactoryRecords) {
  records.task = emptyTask();
  saveFactoryRecords(records);
}

export interface TaskEvent {
  type: 'select' | 'appearance-on' | 'appearance-off' | 'port' | 'detail-exit' | 'joint-open' | 'joint-complete';
  uid?: string;
  portId?: string;
  jointId?: string;
  note?: string;
}

/**
 * 推进样板任务：只接受与当前步骤匹配的事件，忽略其他浏览动作。
 * 返回推进到的步骤（无推进返回 null）。
 */
export function advanceTask(records: FactoryRecords, ev: TaskEvent): { step: number; finished: boolean } | null {
  const task = records.task;
  if (task.step >= SAMPLE_TASK_STEPS.length) return null;
  const cur = SAMPLE_TASK_STEPS[task.step];
  let match = false;
  let note = '';

  switch (cur.id) {
    case 'find-R-202':
      match = ev.type === 'select' && ev.uid === 'R-202';
      note = '已选中调配罐 R-202';
      break;
    case 'down-P-202':
      match = ev.type === 'select' && ev.uid === 'P-202';
      note = '沿管线找到气动双隔膜泵 P-202';
      break;
    case 'appearance':
      match = ev.type === 'appearance-on' && ev.uid === 'P-202';
      note = '已切换到外观参照';
      break;
    case 'structure':
      match = ev.type === 'appearance-off' && ev.uid === 'P-202';
      note = '已切回内部教学结构';
      break;
    case 'ports':
      match = ev.type === 'port' && ev.uid === 'P-202' && (ev.portId === 'suction' || ev.portId === 'discharge');
      note = ev.portId === 'suction' ? '已识别进口总管（液体吸入侧）' : '已识别出口总管（液体排出侧）';
      if (match) {
        const other = ev.portId === 'suction' ? '出口总管' : '进口总管';
        const already = task.done.some((d) => d.id === 'ports-half-' + ev.portId);
        if (!already) {
          task.done.push({ id: 'ports-half-' + ev.portId, note, at: Date.now() });
          saveFactoryRecords(records);
          const hasBoth = task.done.some((d) => d.id === 'ports-half-suction') && task.done.some((d) => d.id === 'ports-half-discharge');
          if (!hasBoth) return { step: task.step, finished: false };
        }
      }
      break;
    case 'exit-detail':
      match = ev.type === 'detail-exit' && ev.uid === 'P-202';
      note = '已退出细节，仍聚焦 P-202';
      break;
    case 'down-F-201':
      match = ev.type === 'select' && ev.uid === 'F-201';
      note = '沿下游找到袋式过滤器 F-201';
      break;
    case 'open-joint':
      match = ev.type === 'joint-open' && ev.jointId === 'JOINT-201';
      note = '已打开泵—过滤器法兰接头练习';
      break;
    case 'complete-joint':
      match = ev.type === 'joint-complete' && ev.jointId === 'JOINT-201';
      note = '已装入密封垫片与 4 组螺栓螺母';
      break;
    case 'down-FL-201':
      match = ev.type === 'select' && ev.uid === 'FL-201';
      note = '已跟踪到灌装机 FL-201，样板完成';
      break;
    default:
      break;
  }

  if (!match) return null;
  task.done.push({ id: cur.id, note: note || cur.title, at: Date.now() });
  if (!task.startedAt) task.startedAt = Date.now();
  task.step = Math.min(SAMPLE_TASK_STEPS.length, task.step + 1);
  const finished = task.step >= SAMPLE_TASK_STEPS.length;
  if (finished) task.finishedAt = Date.now();
  saveFactoryRecords(records);
  return { step: task.step, finished };
}