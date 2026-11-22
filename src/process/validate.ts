/**
 * 流程数据校验器（Phase 1）。
 *
 * 只检查数据关系，不检查三维几何、管道路由或工艺参数：
 * - id 唯一与必填字段；
 * - 工艺区 / 工序 / 设备 / 管线 / 流线 的引用一致；
 * - 管线端点存在、接口方向合理、介质与接口声明一致；
 * - 流线的设备顺序与管线端点逐一对应，缺管线即报错；
 * - 未连接接口、不在流线中的设备必须显式标 pending-confirmation；
 * - 汇总所有待确认缺口，供页面/文档展示。
 *
 * 校验结果中 error 表示数据关系错误（退出码 1）；
 * warning 表示已显式标注的待确认项（允许通过，但必须列出）。
 */

import type {
  DataStatus,
  EquipmentInstanceDef,
  FlowStreamDef,
  PipelineDef,
  ProcessDefinition
} from '../data/processTypes';

export interface ProcessValidationIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  refs: string[];
}

export interface ProcessValidationCounts {
  areas: number;
  steps: number;
  equipment: number;
  pipelines: number;
  flowStreams: number;
  media: number;
  gaps: number;
  ports: number;
  connectedPorts: number;
  unconnectedPorts: number;
  pendingStatusPorts: number;
  pendingObjects: number;
}

export interface ProcessValidation {
  ok: boolean;
  counts: ProcessValidationCounts;
  errors: ProcessValidationIssue[];
  warnings: ProcessValidationIssue[];
  pending: string[];
}

export interface ProcessExpectations {
  areas?: number;
  steps?: number;
  equipment?: number;
  pipelines?: number;
  flowStreams?: number;
  sequences?: { flowId: string; equipmentSequence: string[] }[];
}

interface PortRef {
  pipeline: PipelineDef;
  side: 'from' | 'to';
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDataStatus(value: unknown): value is DataStatus {
  return value === 'teaching-demo' || value === 'pending-confirmation';
}

function isPortRole(value: unknown): boolean {
  return value === 'in' || value === 'out' || value === 'both';
}

function isMediumPhase(value: unknown): boolean {
  return value === 'solid' || value === 'liquid' || value === 'gas' || value === 'mixed' || value === 'utility';
}

function isModelSource(value: unknown): boolean {
  return value === 'existing' || value === 'procedural' || value === 'pending';
}

function isModelStatus(value: unknown): boolean {
  return value === 'available' || value === 'not-built';
}

export function validateProcess(
  process: ProcessDefinition,
  expectations: ProcessExpectations = {}
): ProcessValidation {
  const errors: ProcessValidationIssue[] = [];
  const warnings: ProcessValidationIssue[] = [];
  const pending = new Set<string>();

  const report = (level: 'error' | 'warning', code: string, message: string, refs: string[] = []): void => {
    (level === 'error' ? errors : warnings).push({ level, code, message, refs });
  };

  const markPending = (id: string): void => {
    pending.add(`status:${id}`);
  };

  const requireText = (value: unknown, ref: string, field: string): void => {
    if (!hasText(value)) report('error', 'FIELD_TEXT', `${ref} 缺少必填字段 ${field}`, [ref]);
  };

  const requireArray = (value: unknown, ref: string, field: string): void => {
    if (!Array.isArray(value)) report('error', 'FIELD_ARRAY', `${ref} 缺少数组字段 ${field}`, [ref]);
  };

  const media = Array.isArray(process.media) ? process.media : [];
  const areas = Array.isArray(process.areas) ? process.areas : [];
  const steps = Array.isArray(process.steps) ? process.steps : [];
  const equipment = Array.isArray(process.equipment) ? process.equipment : [];
  const pipelines = Array.isArray(process.pipelines) ? process.pipelines : [];
  const flowStreams = Array.isArray(process.flowStreams) ? process.flowStreams : [];
  const gaps = Array.isArray(process.gaps) ? process.gaps : [];

  const mediaById = new Map(media.map((m) => [m.id, m]));
  const areasById = new Map(areas.map((a) => [a.id, a]));
  const stepsById = new Map(steps.map((s) => [s.id, s]));
  const equipmentById = new Map(equipment.map((e) => [e.id, e]));
  const pipelinesById = new Map(pipelines.map((p) => [p.id, p]));
  const flowStreamsById = new Map(flowStreams.map((f) => [f.id, f]));
  const gapIdSet = new Set(gaps.map((g) => g.id));

  const checkIds = <T>(items: T[], label: string, idOf: (item: T) => string, code: string): void => {
    const seen = new Set<string>();
    for (const item of items) {
      const id = idOf(item);
      if (!hasText(id)) {
        report('error', code, `${label}缺少 id`, []);
        continue;
      }
      if (seen.has(id)) report('error', code, `${label} id 重复：${id}`, [id]);
      seen.add(id);
    }
  };

  const checkGapRefs = (gapIds: unknown, ref: string): void => {
    if (!Array.isArray(gapIds)) {
      report('error', 'GAP_ARRAY', `${ref} 缺少 gapIds 数组`, [ref]);
      return;
    }
    for (const gapId of gapIds) {
      const id = String(gapId);
      if (!gapIdSet.has(id)) report('error', 'GAP_UNKNOWN', `${ref} 引用了不存在的缺口 ${id}`, [ref, id]);
      else pending.add(`gap:${id}`);
    }
  };

  const checkDataStatus = (value: unknown, id: string): void => {
    if (!isDataStatus(value)) {
      report('error', 'STATUS_INVALID', `${id} 的 dataStatus 无效：${String(value)}`, [id]);
      return;
    }
    if (value === 'pending-confirmation') markPending(id);
  };

  /* ---------- 1. 流程级字段与 id 唯一性 ---------- */

  requireText(process.id, '流程', 'id');
  requireText(process.name, '流程', 'name');
  requireText(process.dataVersion, '流程', 'dataVersion');
  requireText(process.description, '流程', 'description');
  requireText(process.boundary, '流程', 'boundary');
  requireText(process.sourceNote, '流程', 'sourceNote');
  checkDataStatus(process.dataStatus, process.id);

  checkIds(media, '介质', (m) => m.id, 'MEDIA_ID');
  checkIds(areas, '工艺区', (a) => a.id, 'AREA_ID');
  checkIds(steps, '工序', (s) => s.id, 'STEP_ID');
  checkIds(equipment, '设备实例', (e) => e.id, 'EQUIPMENT_ID');
  checkIds(pipelines, '管线', (p) => p.id, 'PIPE_ID');
  checkIds(flowStreams, '流线', (f) => f.id, 'FLOW_ID');
  checkIds(gaps, '缺口', (g) => g.id, 'GAP_ID');

  /* ---------- 2. 介质 ---------- */

  for (const m of media) {
    const ref = `介质 ${m.id ?? '?'}`;
    requireText(m.id, ref, 'id');
    requireText(m.label, ref, 'label');
    requireText(m.description, ref, 'description');
    if (!isMediumPhase(m.phase)) report('error', 'MEDIUM_PHASE', `${ref} 的 phase 无效：${String(m.phase)}`, [m.id]);
    checkDataStatus(m.dataStatus, m.id);
    checkGapRefs(m.gapIds, ref);
  }

  /* ---------- 3. 工艺区与工序基础字段 ---------- */

  for (const area of areas) {
    const ref = `工艺区 ${area.id ?? '?'}`;
    requireText(area.id, ref, 'id');
    requireText(area.name, ref, 'name');
    requireText(area.function, ref, 'function');
    requireArray(area.equipmentInstanceIds, ref, 'equipmentInstanceIds');
    requireArray(area.stepIds, ref, 'stepIds');
    checkDataStatus(area.dataStatus, area.id);
    checkGapRefs(area.gapIds, ref);
  }

  for (const step of steps) {
    const ref = `工序 ${step.id ?? '?'}`;
    requireText(step.id, ref, 'id');
    requireText(step.title, ref, 'title');
    requireText(step.description, ref, 'description');
    requireArray(step.equipmentInstanceIds, ref, 'equipmentInstanceIds');
    requireArray(step.pipelineIds, ref, 'pipelineIds');
    checkDataStatus(step.dataStatus, step.id);
    checkGapRefs(step.gapIds, ref);
  }

  /* ---------- 4. 设备与接口 ---------- */

  let portCount = 0;
  let pendingStatusPortCount = 0;

  for (const eq of equipment) {
    const ref = `设备 ${eq.id ?? '?'}`;
    requireText(eq.id, ref, 'id');
    requireText(eq.name, ref, 'name');
    requireText(eq.function, ref, 'function');
    requireText(eq.internals, ref, 'internals');
    requireText(eq.sourceNote, ref, 'sourceNote');
    if (!isModelSource(eq.modelSource)) {
      report('error', 'MODEL_SOURCE', `${ref} 的 modelSource 无效：${String(eq.modelSource)}`, [eq.id]);
    }
    if (!isModelStatus(eq.modelStatus)) {
      report('error', 'MODEL_STATUS', `${ref} 的 modelStatus 无效：${String(eq.modelStatus)}`, [eq.id]);
    }
    checkDataStatus(eq.dataStatus, eq.id);
    checkGapRefs(eq.gapIds, ref);

    if (!Array.isArray(eq.ports) || eq.ports.length === 0) {
      report('error', 'PORT_MISSING', `${ref} 缺少设备接口`, [eq.id]);
      continue;
    }

    const portIds = new Set<string>();
    for (const port of eq.ports) {
      const portRef = `${eq.id}.${port.id ?? '?'}`;
      portCount += 1;
      if (!hasText(port.id)) report('error', 'PORT_ID', `${ref} 存在缺少 id 的接口`, [eq.id]);
      else if (portIds.has(port.id)) report('error', 'PORT_ID', `接口 id 重复：${portRef}`, [portRef]);
      else portIds.add(port.id);
      requireText(port.name, portRef, 'name');
      if (!isPortRole(port.role)) {
        report('error', 'PORT_ROLE', `接口 ${portRef} 的 role 无效：${String(port.role)}`, [portRef]);
      }
      if (!Array.isArray(port.media)) {
        report('error', 'PORT_MEDIA', `接口 ${portRef} 缺少 media 数组`, [portRef]);
      } else {
        for (const mediumId of port.media) {
          if (!mediaById.has(mediumId)) {
            report('error', 'PORT_MEDIA_UNKNOWN', `接口 ${portRef} 引用了不存在的介质 ${mediumId}`, [portRef, mediumId]);
          }
        }
      }
      checkDataStatus(port.dataStatus, portRef);
      if (port.dataStatus === 'pending-confirmation') pendingStatusPortCount += 1;
      checkGapRefs(port.gapIds, portRef);
    }
  }

  /* ---------- 5. 管线端点、方向与介质 ---------- */

  const portRefs = new Map<string, PortRef[]>();
  const addPortRef = (equipmentId: string, portId: string, ref: PortRef): void => {
    const key = `${equipmentId}.${portId}`;
    const list = portRefs.get(key) ?? [];
    list.push(ref);
    portRefs.set(key, list);
  };

  for (const pipe of pipelines) {
    const ref = `管线 ${pipe.id ?? '?'}`;
    requireText(pipe.id, ref, 'id');
    requireText(pipe.name, ref, 'name');
    requireText(pipe.designNote, ref, 'designNote');
    if (!pipe.from || !pipe.to) {
      report('error', 'PIPE_ENDPOINT', `${ref} 缺少起点或终点`, [pipe.id]);
      continue;
    }
    if (!areasById.has(pipe.areaId)) {
      report('error', 'PIPE_AREA', `${ref} 引用了不存在的工艺区 ${pipe.areaId}`, [pipe.id, pipe.areaId]);
    }
    if (!mediaById.has(pipe.medium)) {
      report('error', 'PIPE_MEDIUM', `${ref} 引用了不存在的介质 ${pipe.medium}`, [pipe.id, pipe.medium]);
    }
    if (pipe.flowStreamId && !flowStreamsById.has(pipe.flowStreamId)) {
      report('error', 'PIPE_FLOW', `${ref} 引用了不存在的流线 ${pipe.flowStreamId}`, [pipe.id, pipe.flowStreamId]);
    }
    checkDataStatus(pipe.dataStatus, pipe.id);
    checkGapRefs(pipe.gapIds, ref);

    if (pipe.from.equipment === pipe.to.equipment && pipe.from.port === pipe.to.port) {
      report('error', 'PIPE_SELF_LOOP', `${ref} 的起点与终点是同一接口`, [pipe.id]);
    }

    const fromEq = equipmentById.get(pipe.from.equipment);
    const toEq = equipmentById.get(pipe.to.equipment);
    if (!fromEq) {
      report('error', 'PIPE_FROM_EQ', `${ref} 的起点设备不存在：${pipe.from.equipment}`, [pipe.id, pipe.from.equipment]);
    }
    if (!toEq) {
      report('error', 'PIPE_TO_EQ', `${ref} 的终点设备不存在：${pipe.to.equipment}`, [pipe.id, pipe.to.equipment]);
    }
    const fromPort = fromEq?.ports.find((p) => p.id === pipe.from.port);
    const toPort = toEq?.ports.find((p) => p.id === pipe.to.port);
    if (fromEq && !fromPort) {
      report('error', 'PIPE_FROM_PORT', `${ref} 的起点接口不存在：${pipe.from.equipment}.${pipe.from.port}`, [pipe.id]);
    }
    if (toEq && !toPort) {
      report('error', 'PIPE_TO_PORT', `${ref} 的终点接口不存在：${pipe.to.equipment}.${pipe.to.port}`, [pipe.id]);
    }
    if (fromPort && fromPort.role !== 'out' && fromPort.role !== 'both') {
      report('error', 'PIPE_FROM_ROLE', `${ref} 的起点接口不是出口：${pipe.from.equipment}.${pipe.from.port}`, [pipe.id]);
    }
    if (toPort && toPort.role !== 'in' && toPort.role !== 'both') {
      report('error', 'PIPE_TO_ROLE', `${ref} 的终点接口不是入口：${pipe.to.equipment}.${pipe.to.port}`, [pipe.id]);
    }
    if (fromPort && Array.isArray(fromPort.media) && fromPort.media.length > 0 && !fromPort.media.includes(pipe.medium)) {
      report('error', 'PIPE_FROM_MEDIA', `${ref} 的介质 ${pipe.medium} 未在起点接口声明`, [pipe.id]);
    }
    if (toPort && Array.isArray(toPort.media) && toPort.media.length > 0 && !toPort.media.includes(pipe.medium)) {
      report('error', 'PIPE_TO_MEDIA', `${ref} 的介质 ${pipe.medium} 未在终点接口声明`, [pipe.id]);
    }

    if (fromEq && fromPort) addPortRef(pipe.from.equipment, pipe.from.port, { pipeline: pipe, side: 'from' });
    if (toEq && toPort) addPortRef(pipe.to.equipment, pipe.to.port, { pipeline: pipe, side: 'to' });
  }

  /* ---------- 6. 接口连通性 ---------- */

  let connectedPortCount = 0;
  for (const eq of equipment) {
    for (const port of eq.ports ?? []) {
      const key = `${eq.id}.${port.id}`;
      const refs = portRefs.get(key) ?? [];
      if (refs.length === 0) {
        if (port.boundary) {
          continue;
        }
        if (port.dataStatus === 'pending-confirmation') {
          markPending(key);
          report('warning', 'PORT_PENDING', `接口 ${key} 未连接管线，已标待确认`, [key]);
          continue;
        }
        report('error', 'PORT_ORPHAN', `接口 ${key} 未连接管线且未标待确认`, [key]);
        continue;
      }
      connectedPortCount += 1;
      if (port.boundary) {
        report('warning', 'PORT_BOUNDARY_LINKED', `边界接口 ${key} 仍连接了内部管线，请确认`, [key]);
      }
      if (refs.length > 1) {
        report('warning', 'PORT_MULTI', `接口 ${key} 连接了 ${refs.length} 条管线，请确认是否为汇管`, [key]);
      }
      for (const ref of refs) {
        if (ref.side === 'from' && port.role === 'in') {
          report('error', 'PORT_OUT_FROM_IN', `管线 ${ref.pipeline.id} 从入口 ${key} 出发`, [ref.pipeline.id, key]);
        }
        if (ref.side === 'to' && port.role === 'out') {
          report('error', 'PORT_IN_TO_OUT', `管线 ${ref.pipeline.id} 接到出口 ${key}`, [ref.pipeline.id, key]);
        }
      }
    }
  }

  /* ---------- 7. 工艺区 / 工序 / 设备归属一致性 ---------- */

  for (const area of areas) {
    for (const eqId of area.equipmentInstanceIds ?? []) {
      const eq = equipmentById.get(eqId);
      if (!eq) report('error', 'AREA_EQ', `工艺区 ${area.id} 引用了不存在的设备 ${eqId}`, [area.id, eqId]);
      else if (eq.areaId !== area.id) report('error', 'AREA_EQ_MISMATCH', `设备 ${eqId} 的 areaId 与工艺区 ${area.id} 不一致`, [area.id, eqId]);
    }
    for (const stepId of area.stepIds ?? []) {
      const step = stepsById.get(stepId);
      if (!step) report('error', 'AREA_STEP', `工艺区 ${area.id} 引用了不存在的工序 ${stepId}`, [area.id, stepId]);
      else if (step.areaId !== area.id) report('error', 'AREA_STEP_MISMATCH', `工序 ${stepId} 的 areaId 与工艺区 ${area.id} 不一致`, [area.id, stepId]);
    }
  }

  for (const step of steps) {
    if (!areasById.has(step.areaId)) {
      report('error', 'STEP_AREA', `工序 ${step.id} 引用了不存在的工艺区 ${step.areaId}`, [step.id, step.areaId]);
    }
    for (const eqId of step.equipmentInstanceIds ?? []) {
      const eq = equipmentById.get(eqId);
      if (!eq) report('error', 'STEP_EQ', `工序 ${step.id} 引用了不存在的设备 ${eqId}`, [step.id, eqId]);
      else if (eq.stepId !== step.id) report('error', 'STEP_EQ_MISMATCH', `设备 ${eqId} 的 stepId 与工序 ${step.id} 不一致`, [step.id, eqId]);
    }
  }

  for (const eq of equipment) {
    const area = areasById.get(eq.areaId);
    if (!area) report('error', 'EQ_AREA', `设备 ${eq.id} 引用了不存在的工艺区 ${eq.areaId}`, [eq.id, eq.areaId]);
    else if (!(area.equipmentInstanceIds ?? []).includes(eq.id)) {
      report('error', 'EQ_AREA_LIST', `设备 ${eq.id} 未列入工艺区 ${area.id} 的设备清单`, [eq.id, area.id]);
    }
    const step = stepsById.get(eq.stepId);
    if (!step) report('error', 'EQ_STEP', `设备 ${eq.id} 引用了不存在的工序 ${eq.stepId}`, [eq.id, eq.stepId]);
    else if (!(step.equipmentInstanceIds ?? []).includes(eq.id)) {
      report('error', 'EQ_STEP_LIST', `设备 ${eq.id} 未列入工序 ${step.id} 的设备清单`, [eq.id, step.id]);
    }
  }

  /* ---------- 8. 流线连续性与归属 ---------- */

  const assignedPipelines = new Set<string>();
  const equipmentInFlow = new Set<string>();

  for (const flow of flowStreams) {
    const ref = `流线 ${flow.id ?? '?'}`;
    requireText(flow.id, ref, 'id');
    requireText(flow.name, ref, 'name');
    requireText(flow.description, ref, 'description');
    if (!mediaById.has(flow.medium)) {
      report('error', 'FLOW_MEDIUM', `${ref} 引用了不存在的介质 ${flow.medium}`, [flow.id, flow.medium]);
    }
    checkDataStatus(flow.dataStatus, flow.id);
    checkGapRefs(flow.gapIds, ref);

    const sequence = Array.isArray(flow.equipmentSequence) ? flow.equipmentSequence : [];
    if (sequence.length < 2) report('error', 'FLOW_SHORT', `${ref} 的设备顺序少于 2 个`, [flow.id]);

    const sequenceSet = new Set<string>();
    for (const eqId of sequence) {
      if (!equipmentById.has(eqId)) {
        report('error', 'FLOW_EQ', `${ref} 引用了不存在的设备 ${eqId}`, [flow.id, eqId]);
      }
      if (sequenceSet.has(eqId)) report('warning', 'FLOW_EQ_DUP', `${ref} 的设备顺序中存在重复设备 ${eqId}`, [flow.id, eqId]);
      sequenceSet.add(eqId);
      equipmentInFlow.add(eqId);
    }

    const flowPipes: PipelineDef[] = [];
    for (const pipeId of flow.pipelineIds ?? []) {
      const pipe = pipelinesById.get(pipeId);
      if (!pipe) {
        report('error', 'FLOW_PIPE', `${ref} 引用了不存在的管线 ${pipeId}`, [flow.id, pipeId]);
        continue;
      }
      if (pipe.medium !== flow.medium) {
        report('error', 'FLOW_PIPE_MEDIUM', `管线 ${pipeId} 的介质与流线 ${flow.id} 不一致`, [flow.id, pipeId]);
      }
      if (pipe.flowStreamId !== flow.id) {
        report('error', 'FLOW_PIPE_LINK', `管线 ${pipeId} 的 flowStreamId 不是 ${flow.id}`, [flow.id, pipeId]);
      }
      if (assignedPipelines.has(pipeId)) {
        report('error', 'FLOW_PIPE_DUP', `管线 ${pipeId} 被多个流线引用`, [pipeId]);
      } else {
        assignedPipelines.add(pipeId);
      }
      flowPipes.push(pipe);
    }

    const expectedPairs = new Set<string>();
    for (let i = 0; i + 1 < sequence.length; i += 1) {
      expectedPairs.add(`${sequence[i]}->${sequence[i + 1]}`);
    }
    for (const pipe of flowPipes) {
      const pair = `${pipe.from.equipment}->${pipe.to.equipment}`;
      if (!expectedPairs.has(pair)) {
        report('error', 'FLOW_PAIR_EXTRA', `管线 ${pipe.id} 的端点 ${pair} 不属于流线 ${flow.id} 的相邻设备对`, [flow.id, pipe.id]);
      }
    }
    for (const pair of expectedPairs) {
      if (!flowPipes.some((pipe) => `${pipe.from.equipment}->${pipe.to.equipment}` === pair)) {
        report('error', 'FLOW_PAIR_MISSING', `流线 ${flow.id} 缺少相邻设备对 ${pair} 的管线`, [flow.id]);
      }
    }
  }

  for (const pipe of pipelines) {
    if (pipe.flowStreamId) {
      if (!flowStreamsById.has(pipe.flowStreamId)) {
        continue;
      }
      if (!assignedPipelines.has(pipe.id)) {
        report('error', 'PIPE_FLOW_LIST', `管线 ${pipe.id} 未被其流线 ${pipe.flowStreamId} 收录`, [pipe.id, pipe.flowStreamId]);
      }
    } else {
      report('warning', 'PIPE_UNASSIGNED', `管线 ${pipe.id} 未归属流线`, [pipe.id]);
    }
  }

  for (const eq of equipment) {
    if (equipmentInFlow.has(eq.id)) continue;
    if (eq.dataStatus === 'pending-confirmation') {
      markPending(eq.id);
      report('warning', 'EQ_PENDING_FLOW', `设备 ${eq.id} 不在任何流线中，已标待确认`, [eq.id]);
    } else {
      report('error', 'EQ_ORPHAN_FLOW', `设备 ${eq.id} 不在任何流线中且未标待确认`, [eq.id]);
    }
  }

  /* ---------- 9. 工序对管线的覆盖 ---------- */

  const pipeStepCount = new Map<string, number>();
  for (const step of steps) {
    for (const pipeId of step.pipelineIds ?? []) {
      if (!pipelinesById.has(pipeId)) {
        report('error', 'STEP_PIPE', `工序 ${step.id} 引用了不存在的管线 ${pipeId}`, [step.id, pipeId]);
        continue;
      }
      pipeStepCount.set(pipeId, (pipeStepCount.get(pipeId) ?? 0) + 1);
    }
  }
  for (const pipe of pipelines) {
    if (!pipeStepCount.has(pipe.id)) {
      report('error', 'PIPE_NO_STEP', `管线 ${pipe.id} 未归入任何工序`, [pipe.id]);
    }
  }
  for (const [pipeId, count] of pipeStepCount) {
    if (count > 1) report('warning', 'PIPE_MULTI_STEP', `管线 ${pipeId} 出现在 ${count} 个工序中，请确认教学播放顺序`, [pipeId]);
  }

  /* ---------- 10. 序号连续性 ---------- */

  const checkSequence = (numbers: number[], label: string): void => {
    if (new Set(numbers).size !== numbers.length) {
      report('error', 'SEQ_DUP', `${label}序号存在重复`, []);
    }
    const sorted = [...numbers].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i += 1) {
      if (sorted[i] !== i + 1) {
        report('error', 'SEQ_GAP', `${label}序号应从 1 连续（当前为 ${sorted.join(', ')}）`, []);
        break;
      }
    }
  };
  checkSequence(areas.map((a) => a.no), '工艺区');
  checkSequence(steps.map((s) => s.no), '工序');

  /* ---------- 11. 验收口径 ---------- */

  const checkExpectedCount = (label: string, actual: number, expected: number | undefined, code: string): void => {
    if (expected !== undefined && actual !== expected) {
      report('error', code, `${label}数量应为 ${expected}，实际为 ${actual}`, []);
    }
  };
  checkExpectedCount('工艺区', areas.length, expectations.areas, 'EXPECT_AREA');
  checkExpectedCount('工序', steps.length, expectations.steps, 'EXPECT_STEP');
  checkExpectedCount('设备实例', equipment.length, expectations.equipment, 'EXPECT_EQUIPMENT');
  checkExpectedCount('管线', pipelines.length, expectations.pipelines, 'EXPECT_PIPE');
  checkExpectedCount('流线', flowStreams.length, expectations.flowStreams, 'EXPECT_FLOW');

  for (const expected of expectations.sequences ?? []) {
    const flow = flowStreamsById.get(expected.flowId);
    if (!flow) {
      report('error', 'EXPECT_FLOW_ID', `验收口径引用了不存在的流线 ${expected.flowId}`, [expected.flowId]);
      continue;
    }
    if (flow.equipmentSequence.join('>') !== expected.equipmentSequence.join('>')) {
      report(
        'error',
        'EXPECT_SEQUENCE',
        `流线 ${expected.flowId} 的设备顺序与验收口径不一致：${flow.equipmentSequence.join(' → ')}`,
        [expected.flowId]
      );
    }
  }

  /* ---------- 12. 缺口引用汇总 ---------- */

  const affectedIds = new Set<string>([
    ...mediaById.keys(),
    ...areasById.keys(),
    ...stepsById.keys(),
    ...equipmentById.keys(),
    ...pipelinesById.keys(),
    ...flowStreamsById.keys()
  ]);

  for (const gap of gaps) {
    const ref = `缺口 ${gap.id ?? '?'}`;
    requireText(gap.id, ref, 'id');
    requireText(gap.subject, ref, 'subject');
    requireText(gap.detail, ref, 'detail');
    if (!Array.isArray(gap.affects)) {
      report('error', 'GAP_AFFECTS', `${ref} 缺少 affects 数组`, [gap.id]);
    } else {
      for (const affected of gap.affects) {
        if (!affectedIds.has(affected)) {
          report('error', 'GAP_AFFECT_UNKNOWN', `${ref} 的 affects 引用了不存在的 id ${affected}`, [gap.id, affected]);
        }
      }
    }
    pending.add(`gap:${gap.id}`);
  }

  const pendingObjects = new Set([...pending].filter((entry) => entry.startsWith('status:'))).size;

  const result: ProcessValidation = {
    ok: errors.length === 0,
    counts: {
      areas: areas.length,
      steps: steps.length,
      equipment: equipment.length,
      pipelines: pipelines.length,
      flowStreams: flowStreams.length,
      media: media.length,
      gaps: gaps.length,
      ports: portCount,
      connectedPorts: connectedPortCount,
      unconnectedPorts: portCount - connectedPortCount,
      pendingStatusPorts: pendingStatusPortCount,
      pendingObjects
    },
    errors,
    warnings,
    pending: [...pending].sort()
  };
  return result;
}
