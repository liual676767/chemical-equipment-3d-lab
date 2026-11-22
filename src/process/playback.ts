/**
 * 微沸喷烧 Phase 6：完整流程播放状态机（纯 TypeScript）。
 *
 * - 15 道教学工序严格按 BOIL_PROCESS.steps 的顺序播放；
 * - 开始/暂停/继续/停止/上一步/下一步/跳转均为真实状态推进，
 *   不是按钮文案切换；
 * - 0.5× / 1× / 2× / 4× 同时用于步骤计时与三维流体演示速度；
 * - 每步时长是**教学演示节奏**，不是工艺停留时间，界面必须标注；
 * - 播放进度、当前/已完成设备与管线由状态机统一提供给三维场景、二维地图和信息面板。
 */

import type { ProcessDefinition, ProcessStepDef } from '../data/processTypes';

export const PLAYBACK_SPEEDS = [0.5, 1, 2, 4] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** 教学演示节奏：每步 4 秒（1×）。不是停留时间或工艺参数。 */
export const TEACHING_STEP_SECONDS = 4;

export type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'completed';

export interface PlaybackState {
  status: PlaybackStatus;
  stepIndex: number;
  stepNo: number;
  totalSteps: number;
  step: ProcessStepDef | null;
  stepElapsed: number;
  stepDuration: number;
  speed: PlaybackSpeed;
  progress: number;
  currentEquipmentIds: string[];
  completedEquipmentIds: string[];
  currentPipelineIds: string[];
  completedPipelineIds: string[];
  activePipelineIds: string[];
}

export interface PlaybackTick {
  state: PlaybackState;
  stepChanged: boolean;
  statusChanged: boolean;
}

export interface PlaybackOptions {
  stepDurationSeconds?: number;
  speed?: PlaybackSpeed;
  /** 步骤切换或状态变化时回调；进度每帧通过 state 读取。 */
  onChange?: (state: PlaybackState, event: { stepChanged: boolean; statusChanged: boolean }) => void;
}

export interface PlaybackAudit {
  ok: boolean;
  errors: string[];
  warnings: string[];
  steps: number;
  equipment: number;
  pipelines: number;
  equipmentInSteps: number;
  pipelinesInSteps: number;
  duplicateEquipment: string[];
  duplicatePipelines: string[];
  sprayStepIndex: number;
  stepTitles: string[];
}

function normalizeSpeed(value: number): PlaybackSpeed {
  let best: PlaybackSpeed = PLAYBACK_SPEEDS[1];
  let distance = Infinity;
  for (const speed of PLAYBACK_SPEEDS) {
    const next = Math.abs(speed - value);
    if (next < distance) {
      distance = next;
      best = speed;
    }
  }
  return best;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export class ProcessPlayback {
  readonly steps: ProcessStepDef[];
  private readonly duration: number;
  private index = 0;
  private elapsed = 0;
  private statusValue: PlaybackStatus = 'idle';
  private speedValue: PlaybackSpeed;
  private readonly onChange?: PlaybackOptions['onChange'];

  constructor(
    process: ProcessDefinition,
    options: PlaybackOptions = {}
  ) {
    this.steps = [...process.steps].sort((a, b) => a.no - b.no);
    this.duration = Math.max(0.5, options.stepDurationSeconds ?? TEACHING_STEP_SECONDS);
    this.speedValue = normalizeSpeed(options.speed ?? 1);
    this.onChange = options.onChange;
  }

  get status(): PlaybackStatus {
    return this.statusValue;
  }

  get stepDuration(): number {
    return this.duration;
  }

  get state(): PlaybackState {
    const total = this.steps.length;
    const step = this.steps[this.index] ?? null;
    const prefix = this.steps.slice(0, this.index);
    const completedEquipmentIds = unique(prefix.flatMap((item) => item.equipmentInstanceIds));
    const completedPipelineIds = unique(prefix.flatMap((item) => item.pipelineIds));
    const currentEquipmentIds = step ? [...step.equipmentInstanceIds] : [];
    const currentPipelineIds = step ? [...step.pipelineIds] : [];
    const activePipelineIds = unique([...completedPipelineIds, ...currentPipelineIds]);
    let progress = 0;
    if (total > 0) {
      if (this.statusValue === 'completed') progress = 1;
      else progress = clamp((this.index + clamp(this.elapsed / this.duration, 0, 1)) / total, 0, 1);
    }
    return {
      status: this.statusValue,
      stepIndex: this.index,
      stepNo: step?.no ?? 0,
      totalSteps: total,
      step,
      stepElapsed: this.elapsed,
      stepDuration: this.duration,
      speed: this.speedValue,
      progress,
      currentEquipmentIds,
      completedEquipmentIds,
      currentPipelineIds,
      completedPipelineIds,
      activePipelineIds
    };
  }

  start(): PlaybackState {
    if (this.steps.length === 0) return this.state;
    this.index = 0;
    this.elapsed = 0;
    this.statusValue = 'playing';
    this.emit(true, true);
    return this.state;
  }

  pause(): PlaybackState {
    if (this.statusValue !== 'playing') return this.state;
    this.statusValue = 'paused';
    this.emit(false, true);
    return this.state;
  }

  resume(): PlaybackState {
    if (this.statusValue !== 'paused') return this.state;
    this.statusValue = 'playing';
    this.emit(false, true);
    return this.state;
  }

  stop(): PlaybackState {
    const changed = this.index !== 0 || this.elapsed !== 0 || this.statusValue !== 'idle';
    this.index = 0;
    this.elapsed = 0;
    this.statusValue = 'idle';
    if (changed) this.emit(true, true);
    return this.state;
  }

  next(): PlaybackState {
    return this.jumpTo(this.index + 1);
  }

  previous(): PlaybackState {
    return this.jumpTo(this.index - 1);
  }

  jumpTo(index: number): PlaybackState {
    if (this.steps.length === 0) return this.state;
    const nextIndex = clamp(Math.round(index), 0, this.steps.length - 1);
    const stepChanged = nextIndex !== this.index;
    this.index = nextIndex;
    this.elapsed = 0;
    let statusChanged = false;
    if (this.statusValue === 'idle' || this.statusValue === 'completed') {
      this.statusValue = 'paused';
      statusChanged = true;
    }
    if (stepChanged || statusChanged) this.emit(stepChanged, statusChanged);
    return this.state;
  }

  setSpeed(value: number): PlaybackState {
    const next = normalizeSpeed(value);
    if (next === this.speedValue) return this.state;
    this.speedValue = next;
    this.emit(false, false);
    return this.state;
  }

  stepForEquipment(equipmentId: string): number {
    return this.steps.findIndex((step) => step.equipmentInstanceIds.includes(equipmentId));
  }

  tick(dtSeconds: number): PlaybackTick {
    const dt = clamp(Number.isFinite(dtSeconds) ? dtSeconds : 0, 0, 1);
    if (this.statusValue !== 'playing' || this.steps.length === 0) {
      return { state: this.state, stepChanged: false, statusChanged: false };
    }
    let stepChanged = false;
    let statusChanged = false;
    this.elapsed += dt * this.speedValue;
    let guard = 0;
    while (this.elapsed >= this.duration && guard < this.steps.length + 2) {
      guard += 1;
      if (this.index >= this.steps.length - 1) {
        this.elapsed = this.duration;
        this.statusValue = 'completed';
        statusChanged = true;
        break;
      }
      this.index += 1;
      this.elapsed -= this.duration;
      stepChanged = true;
    }
    if (stepChanged || statusChanged) this.emit(stepChanged, statusChanged);
    return { state: this.state, stepChanged, statusChanged };
  }

  private emit(stepChanged: boolean, statusChanged: boolean): void {
    this.onChange?.(this.state, { stepChanged, statusChanged });
  }
}

const EXPECTED_TITLES = [
  'SMP装置',
  '破碎机',
  '混合器',
  '炉塞泵',
  '二燃室',
  '四根喷枪',
  '回转窑',
  '集冷塔一',
  '布袋除尘器',
  '集冷塔二',
  '综合塔',
  '水洗塔',
  '湿电除尘',
  '引风机',
  '烟囱'
];

export function validatePlayback(process: ProcessDefinition): PlaybackAudit {
  const errors: string[] = [];
  const warnings: string[] = [];
  const steps = [...process.steps].sort((a, b) => a.no - b.no);
  const stepIds = new Set<string>();
  const equipmentIds = new Set<string>();
  const pipelineIds = new Set<string>();
  const duplicateEquipment: string[] = [];
  const duplicatePipelines: string[] = [];

  if (steps.length !== EXPECTED_TITLES.length) {
    errors.push(`工序数量应为 ${EXPECTED_TITLES.length}，实际为 ${steps.length}`);
  }
  steps.forEach((step, index) => {
    if (stepIds.has(step.id)) errors.push(`工序 id 重复：${step.id}`);
    stepIds.add(step.id);
    if (step.no !== index + 1) errors.push(`工序 ${step.id} 的序号应为 ${index + 1}，实际为 ${step.no}`);
    const expectedTitle = EXPECTED_TITLES[index];
    if (expectedTitle && step.title !== expectedTitle) {
      errors.push(`工序 ${index + 1} 标题应为「${expectedTitle}」，实际为「${step.title}」`);
    }
    if (step.equipmentInstanceIds.length === 0) errors.push(`工序 ${step.id} 没有设备`);
    for (const id of step.equipmentInstanceIds) {
      if (!process.equipment.some((equipment) => equipment.id === id)) {
        errors.push(`工序 ${step.id} 引用了不存在的设备 ${id}`);
      }
      if (equipmentIds.has(id) && !duplicateEquipment.includes(id)) duplicateEquipment.push(id);
      equipmentIds.add(id);
    }
    for (const id of step.pipelineIds) {
      if (!process.pipelines.some((pipeline) => pipeline.id === id)) {
        errors.push(`工序 ${step.id} 引用了不存在的管线 ${id}`);
      }
      if (pipelineIds.has(id) && !duplicatePipelines.includes(id)) duplicatePipelines.push(id);
      pipelineIds.add(id);
    }
  });

  const sprayStepIndex = steps.findIndex((step) => step.title === '四根喷枪');
  if (sprayStepIndex < 0) {
    errors.push('缺少「四根喷枪」工序');
  } else {
    const guns = steps[sprayStepIndex].equipmentInstanceIds.filter((id) =>
      process.equipment.find((equipment) => equipment.id === id)?.modelKey === 'spray-gun'
    );
    if (guns.length !== 4) errors.push(`四根喷枪工序应包含 4 根喷枪，实际为 ${guns.length}`);
    if (steps[sprayStepIndex].pipelineIds.length !== 0) {
      warnings.push('四根喷枪工序没有已确认管线，播放时只显示平行支路与待确认标注');
    }
  }
  for (const id of equipmentIds) {
    const sprayGuns = process.equipment.filter((equipment) => equipment.modelKey === 'spray-gun').map((equipment) => equipment.id);
    if (!sprayGuns.includes(id) && !process.equipment.some((equipment) => equipment.id === id)) {
      errors.push(`播放设备 ${id} 不存在`);
    }
  }
  const processEquipment = process.equipment.map((equipment) => equipment.id);
  for (const id of processEquipment) {
    if (!equipmentIds.has(id)) errors.push(`设备 ${id} 未进入任何播放步骤`);
  }
  const processPipelines = process.pipelines.map((pipeline) => pipeline.id);
  for (const id of processPipelines) {
    if (!pipelineIds.has(id)) errors.push(`管线 ${id} 未进入任何播放步骤`);
  }
  for (const id of duplicateEquipment) warnings.push(`设备 ${id} 出现在多个步骤（教学合并展示，需确认）`);
  for (const id of duplicatePipelines) warnings.push(`管线 ${id} 出现在多个步骤（教学合并展示，需确认）`);

  const probe = new ProcessPlayback(process, { stepDurationSeconds: 1 });
  probe.start();
  const afterStart = probe.state;
  if (afterStart.status !== 'playing' || afterStart.stepIndex !== 0) {
    errors.push('播放器启动后应处于播放中且停在第 1 步');
  }
  probe.tick(0.6);
  const midProgress = probe.state.progress;
  probe.pause();
  probe.tick(5);
  if (Math.abs(probe.state.progress - midProgress) > 1e-9) {
    errors.push('暂停后进度不应改变');
  }
  probe.resume();
  probe.setSpeed(4);
  const before = probe.state.progress;
  probe.tick(0.5);
  if (!(probe.state.progress > before)) errors.push('4× 速度下进度应推进');
  probe.jumpTo(steps.length - 1);
  probe.tick(10);
  if (probe.state.status !== 'completed' || Math.abs(probe.state.progress - 1) > 1e-9) {
    errors.push('最后一步播放结束应完成且进度为 100%');
  }
  probe.stop();
  if (probe.state.status !== 'idle' || probe.state.stepIndex !== 0 || probe.state.progress !== 0) {
    errors.push('停止后应回到初始状态');
  }
  if (!PLAYBACK_SPEEDS.includes(probe.state.speed)) errors.push('播放速度不在 0.5/1/2/4 范围内');

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    steps: steps.length,
    equipment: process.equipment.length,
    pipelines: process.pipelines.length,
    equipmentInSteps: equipmentIds.size,
    pipelinesInSteps: pipelineIds.size,
    duplicateEquipment,
    duplicatePipelines,
    sprayStepIndex,
    stepTitles: steps.map((step) => step.title)
  };
}
