/**
 * 微沸喷烧流体教学示意（Phase 4）。
 *
 * 纯数据/逻辑，不依赖 DOM 与 Three.js：
 * - 每条管线有 1 个教学示意阀，阀门状态 open / partial / closed 只影响课堂演示；
 * - 物料流与烟气流按两条独立教学流线传播：关闭阀门时，所在管线在阀位停止、
 *   该流线下游管线断流；partial 状态使所在管线及下游节流；
 * - 不建立物料—烟气耦合、热工计算、流量/压力/温度/停留时间等工艺参数；
 * - 四根喷枪仍为待确认独立件，不进入任何流线。
 *
 * 本模块只用于内部预览与校验，不接入站点路由。
 */

import type { ProcessDefinition } from '../data/processTypes';
import type { PipeRouteResult } from './piping';
import type { ProcessValidationIssue } from './validate';

export type ValveState = 'open' | 'closed' | 'partial';

export type FluidFlowState = 'full' | 'halt' | 'off';

export interface BoilPipeFlow {
  pipelineId: string;
  valveId: string;
  valveState: ValveState;
  /** 阀在管线上的归一化弧长位置（0–1，教学示意，不是现场阀位）。 */
  valveT: number;
  state: FluidFlowState;
  /** 部分开度或上游节流传播（仅影响教学演示速度）。 */
  throttle: boolean;
  /** halt 时示踪粒子可到达的最大归一化弧长位置。 */
  haltT: number;
  flowStreamId: string;
  medium: string;
}

export interface BoilStreamSnapshot {
  id: string;
  name: string;
  sourceEquipment: string;
  suppliedEquipment: string[];
  pipelineIds: string[];
}

export interface BoilFluidSnapshot {
  flows: Record<string, BoilPipeFlow>;
  suppliedEquipment: string[];
  unsuppliedEquipment: string[];
  streams: BoilStreamSnapshot[];
  counts: {
    pipelines: number;
    valves: number;
    streams: number;
    full: number;
    throttle: number;
    halt: number;
    off: number;
    suppliedEquipment: number;
    unsuppliedEquipment: number;
  };
}

export interface FluidExpectations {
  pipelines?: number;
  valves?: number;
  streams?: number;
  fullOnOpen?: number;
  throttleOnOpen?: number;
  suppliedOnOpen?: number;
  unsuppliedOnOpen?: number;
}

export interface FluidValidation {
  ok: boolean;
  errors: ProcessValidationIssue[];
  warnings: ProcessValidationIssue[];
  counts: {
    pipelines: number;
    valves: number;
    streams: number;
    fullOnOpen: number;
    throttleOnOpen: number;
    suppliedOnOpen: number;
    unsuppliedOnOpen: number;
    closedPropagation: number;
    partialPropagation: number;
  };
  initial: BoilFluidSnapshot;
  samples: {
    closedPipeline: string;
    closedFlow: BoilPipeFlow | null;
    partialPipeline: string;
    partialFlow: BoilPipeFlow | null;
  };
}

function issue(level: 'error' | 'warning', code: string, message: string, refs: string[] = []): ProcessValidationIssue {
  return { level, code, message, refs };
}

function isValveState(value: unknown): value is ValveState {
  return value === 'open' || value === 'closed' || value === 'partial';
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * 阀位于某一直管段中点（Phase 3 放置规则）；换算为整条管线的归一化弧长位置。
 * 仅用于示踪粒子在关闭阀前停止，不代表现场阀门安装位置。
 */
export function pipelineValveT(route: PipeRouteResult): number {
  const valve = route.valves[0];
  if (!valve || route.length <= 0) return 0.5;
  let before = 0;
  for (const segment of route.segments) {
    if (segment.index === valve.segmentIndex) {
      const dx = valve.point[0] - segment.from[0];
      const dy = valve.point[1] - segment.from[1];
      const dz = valve.point[2] - segment.from[2];
      const along = Math.hypot(dx, dy, dz);
      return clamp01((before + along) / route.length);
    }
    before += segment.length;
  }
  return 0.5;
}

function valveIdFor(pipelineId: string): string {
  return `valve-${pipelineId}`;
}

/**
 * 按两条独立教学流线计算各管线流动状态。
 * valveStates 以 pipelineId 为键，缺省 open；非法值按 open 处理（校验器会单独报错）。
 */
export function computeBoilFluid(
  process: ProcessDefinition,
  routes: PipeRouteResult[],
  valveStates: Record<string, ValveState> = {}
): BoilFluidSnapshot {
  const routeById = new Map(routes.map((route) => [route.pipelineId, route]));
  const pipeById = new Map(process.pipelines.map((pipe) => [pipe.id, pipe]));
  const flows: Record<string, BoilPipeFlow> = {};
  const suppliedOverall = new Set<string>();
  const streams: BoilStreamSnapshot[] = [];

  for (const stream of process.flowStreams) {
    const source = stream.equipmentSequence[0];
    const supplied = new Set<string>(source ? [source] : []);
    const throttled = new Set<string>();

    let pending = new Set(stream.pipelineIds);
    let guard = 0;
    while (pending.size > 0 && guard < stream.pipelineIds.length + 2) {
      guard += 1;
      let progressed = false;
      for (const pipelineId of [...pending]) {
        const pipe = pipeById.get(pipelineId);
        if (!pipe || !supplied.has(pipe.from.equipment)) continue;
        const route = routeById.get(pipelineId);
        if (!route) continue;
        const rawState = valveStates[pipelineId];
        const valveState: ValveState = isValveState(rawState) ? rawState : 'open';
        const valveT = pipelineValveT(route);
        if (valveState === 'closed') {
          flows[pipelineId] = {
            pipelineId,
            valveId: valveIdFor(pipelineId),
            valveState,
            valveT,
            state: 'halt',
            throttle: false,
            haltT: valveT,
            flowStreamId: stream.id,
            medium: pipe.medium
          };
        } else {
          const throttle = valveState === 'partial' || throttled.has(pipe.from.equipment);
          flows[pipelineId] = {
            pipelineId,
            valveId: valveIdFor(pipelineId),
            valveState,
            valveT,
            state: 'full',
            throttle,
            haltT: 1,
            flowStreamId: stream.id,
            medium: pipe.medium
          };
          supplied.add(pipe.to.equipment);
          if (throttle) throttled.add(pipe.to.equipment);
        }
        pending.delete(pipelineId);
        progressed = true;
      }
      if (!progressed) break;
    }

    for (const pipelineId of pending) {
      const pipe = pipeById.get(pipelineId);
      const route = routeById.get(pipelineId);
      const rawState = valveStates[pipelineId];
      const valveState: ValveState = isValveState(rawState) ? rawState : 'open';
      flows[pipelineId] = {
        pipelineId,
        valveId: valveIdFor(pipelineId),
        valveState,
        valveT: route ? pipelineValveT(route) : 0.5,
        state: 'off',
        throttle: false,
        haltT: 1,
        flowStreamId: stream.id,
        medium: pipe?.medium ?? ''
      };
    }

    for (const equipmentId of supplied) suppliedOverall.add(equipmentId);
    streams.push({
      id: stream.id,
      name: stream.name,
      sourceEquipment: source,
      suppliedEquipment: [...supplied],
      pipelineIds: stream.pipelineIds.filter((id) => Boolean(pipeById.get(id)))
    });
  }

  const equipmentIds = process.equipment.map((equipment) => equipment.id);
  const suppliedEquipment = equipmentIds.filter((id) => suppliedOverall.has(id));
  const unsuppliedEquipment = equipmentIds.filter((id) => !suppliedOverall.has(id));
  const values = Object.values(flows);

  return {
    flows,
    suppliedEquipment,
    unsuppliedEquipment,
    streams,
    counts: {
      pipelines: process.pipelines.length,
      valves: values.length,
      streams: process.flowStreams.length,
      full: values.filter((flow) => flow.state === 'full').length,
      throttle: values.filter((flow) => flow.state === 'full' && flow.throttle).length,
      halt: values.filter((flow) => flow.state === 'halt').length,
      off: values.filter((flow) => flow.state === 'off').length,
      suppliedEquipment: suppliedEquipment.length,
      unsuppliedEquipment: unsuppliedEquipment.length
    }
  };
}

/**
 * Phase 4 流体系统校验：
 * - 13 条管线各有 1 个示意阀与有效阀位；
 * - 两条流线与管线/设备顺序一致，无重复归属；
 * - 全开时全部 13 条管线流动、14 台设备在流线上、4 根喷枪保持待确认；
 * - 逐阀关闭：本管在阀位停止、同流线下游断流、上游与其他流线不受影响；
 * - 逐阀部分开度：本管与同流线下游节流、上游与其他流线不受影响；
 * - 全部关闭：两条流线首管停止、其余断流，供料设备只剩两个流线源。
 */
export function validateFluidSystem(
  process: ProcessDefinition,
  routes: PipeRouteResult[],
  expectations: FluidExpectations = {}
): FluidValidation {
  const errors: ProcessValidationIssue[] = [];
  const warnings: ProcessValidationIssue[] = [];
  const routeById = new Map(routes.map((route) => [route.pipelineId, route]));
  const pipeById = new Map(process.pipelines.map((pipe) => [pipe.id, pipe]));

  if (routes.length !== process.pipelines.length) {
    errors.push(issue('error', 'FLUID_ROUTE_COUNT', `管线路由 ${routes.length} 条，与数据管线 ${process.pipelines.length} 条不一致`, []));
  }

  let valves = 0;
  for (const pipe of process.pipelines) {
    const route = routeById.get(pipe.id);
    if (!route) {
      errors.push(issue('error', 'FLUID_ROUTE_MISSING', `管线 ${pipe.id} 缺少教学示意路由，无法建立流体演示`, [pipe.id]));
      continue;
    }
    if (route.valves.length !== 1) {
      errors.push(issue('error', 'FLUID_VALVE_COUNT', `管线 ${pipe.id} 的示意阀数量应为 1，实际为 ${route.valves.length}`, [pipe.id]));
    } else {
      valves += 1;
      const valve = route.valves[0];
      if (valve.id !== valveIdFor(pipe.id)) {
        errors.push(issue('error', 'FLUID_VALVE_ID', `管线 ${pipe.id} 的示意阀 id 应为 ${valveIdFor(pipe.id)}，实际为 ${valve.id}`, [pipe.id, valve.id]));
      }
      if (pipe.route && valve.kind !== pipe.route.valve.kind) {
        errors.push(issue('error', 'FLUID_VALVE_KIND', `管线 ${pipe.id} 的示意阀型式与路由配置不一致`, [pipe.id]));
      }
      const t = pipelineValveT(route);
      if (!(t > 0.02 && t < 0.98)) {
        errors.push(issue('error', 'FLUID_VALVE_T', `管线 ${pipe.id} 的阀位比例 ${t.toFixed(3)} 超出教学演示范围`, [pipe.id]));
      }
    }
    if (!pipe.flowStreamId || !process.flowStreams.some((stream) => stream.id === pipe.flowStreamId)) {
      errors.push(issue('error', 'FLUID_STREAM_REF', `管线 ${pipe.id} 缺少有效流线引用`, [pipe.id]));
    }
  }

  const seenPipelines = new Set<string>();
  for (const stream of process.flowStreams) {
    if (stream.pipelineIds.length === 0) {
      errors.push(issue('error', 'FLUID_STREAM_EMPTY', `流线 ${stream.id} 没有管线`, [stream.id]));
    }
    let previousEquipment = stream.equipmentSequence[0] ?? '';
    for (const pipelineId of stream.pipelineIds) {
      if (seenPipelines.has(pipelineId)) {
        errors.push(issue('error', 'FLUID_STREAM_DUP', `管线 ${pipelineId} 被多个流线重复引用`, [pipelineId]));
      }
      seenPipelines.add(pipelineId);
      const pipe = pipeById.get(pipelineId);
      if (!pipe) {
        errors.push(issue('error', 'FLUID_STREAM_PIPE', `流线 ${stream.id} 引用了不存在的管线 ${pipelineId}`, [stream.id, pipelineId]));
        continue;
      }
      if (pipe.flowStreamId !== stream.id) {
        errors.push(issue('error', 'FLUID_STREAM_LINK', `管线 ${pipelineId} 的流线引用与流线 ${stream.id} 不一致`, [pipelineId, stream.id]));
      }
      if (pipe.from.equipment !== previousEquipment) {
        errors.push(issue('error', 'FLUID_STREAM_ORDER', `流线 ${stream.id} 的管线 ${pipelineId} 未按设备顺序连接`, [stream.id, pipelineId]));
      }
      previousEquipment = pipe.to.equipment;
    }
    const lastEquipment = stream.equipmentSequence[stream.equipmentSequence.length - 1];
    if (lastEquipment && previousEquipment !== lastEquipment) {
      errors.push(issue('error', 'FLUID_STREAM_END', `流线 ${stream.id} 的管线终点与设备序列末端不一致`, [stream.id]));
    }
  }
  for (const pipe of process.pipelines) {
    if (!seenPipelines.has(pipe.id)) {
      errors.push(issue('error', 'FLUID_STREAM_UNCOVERED', `管线 ${pipe.id} 未归属任何流线`, [pipe.id]));
    }
  }

  const initial = computeBoilFluid(process, routes, {});
  if (initial.counts.full !== process.pipelines.length) {
    errors.push(issue('error', 'FLUID_OPEN_FULL', `全开状态应有 ${process.pipelines.length} 条管线流动，实际为 ${initial.counts.full}`, []));
  }
  if (initial.counts.throttle !== 0 || initial.counts.halt !== 0 || initial.counts.off !== 0) {
    errors.push(issue('error', 'FLUID_OPEN_STATE', '全开状态不应出现节流、停止或断流', []));
  }
  const sprayGuns = process.equipment.filter((equipment) => equipment.modelKey === 'spray-gun').map((equipment) => equipment.id);
  const unsuppliedSet = new Set(initial.unsuppliedEquipment);
  if (initial.unsuppliedEquipment.length !== sprayGuns.length || sprayGuns.some((id) => !unsuppliedSet.has(id))) {
    errors.push(issue('error', 'FLUID_PENDING_EQUIPMENT', '全开状态未供料设备应只有四根待确认喷枪', initial.unsuppliedEquipment));
  }

  const streamById = new Map(process.flowStreams.map((stream) => [stream.id, stream]));
  let closedPropagation = 0;
  let partialPropagation = 0;
  let closedSamplePipeline = '';
  let partialSamplePipeline = '';
  let closedSample: BoilPipeFlow | null = null;
  let partialSample: BoilPipeFlow | null = null;

  for (const pipe of process.pipelines) {
    const stream = streamById.get(pipe.flowStreamId ?? '');
    if (!stream) continue;
    const index = stream.pipelineIds.indexOf(pipe.id);
    if (index < 0) continue;

    const closedSnapshot = computeBoilFluid(process, routes, { [pipe.id]: 'closed' });
    const closedFlow = closedSnapshot.flows[pipe.id];
    const upstreamIds = stream.pipelineIds.slice(0, index);
    const downstreamIds = stream.pipelineIds.slice(index + 1);
    let closedOk = Boolean(closedFlow) && closedFlow.state === 'halt' && Math.abs(closedFlow.haltT - closedFlow.valveT) < 1e-9;
    if (!closedOk) {
      errors.push(issue('error', 'FLUID_CLOSED_HALT', `关闭 ${pipe.id} 的阀门后，本管未在阀位停止`, [pipe.id]));
    }
    for (const upstreamId of upstreamIds) {
      if (closedSnapshot.flows[upstreamId]?.state !== 'full') {
        closedOk = false;
        errors.push(issue('error', 'FLUID_CLOSED_UPSTREAM', `关闭 ${pipe.id} 的阀门后，上游管 ${upstreamId} 不应断流`, [pipe.id, upstreamId]));
      }
    }
    for (const downstreamId of downstreamIds) {
      if (closedSnapshot.flows[downstreamId]?.state !== 'off') {
        closedOk = false;
        errors.push(issue('error', 'FLUID_CLOSED_DOWNSTREAM', `关闭 ${pipe.id} 的阀门后，下游管 ${downstreamId} 应断流`, [pipe.id, downstreamId]));
      }
    }
    for (const otherStream of process.flowStreams) {
      if (otherStream.id === stream.id) continue;
      for (const otherId of otherStream.pipelineIds) {
        if (closedSnapshot.flows[otherId]?.state !== 'full') {
          closedOk = false;
          errors.push(issue('error', 'FLUID_CLOSED_OTHER', `关闭 ${pipe.id} 的阀门不应影响流线 ${otherStream.id} 的管线 ${otherId}`, [pipe.id, otherId]));
        }
      }
    }
    if (closedOk) closedPropagation += 1;

    const partialSnapshot = computeBoilFluid(process, routes, { [pipe.id]: 'partial' });
    const partialFlow = partialSnapshot.flows[pipe.id];
    let partialOk = Boolean(partialFlow) && partialFlow.state === 'full' && partialFlow.throttle;
    if (!partialOk) {
      errors.push(issue('error', 'FLUID_PARTIAL_SELF', `部分开启 ${pipe.id} 的阀门后，本管应节流`, [pipe.id]));
    }
    for (const upstreamId of upstreamIds) {
      const flow = partialSnapshot.flows[upstreamId];
      if (!flow || flow.state !== 'full' || flow.throttle) {
        partialOk = false;
        errors.push(issue('error', 'FLUID_PARTIAL_UPSTREAM', `部分开启 ${pipe.id} 的阀门后，上游管 ${upstreamId} 不应节流`, [pipe.id, upstreamId]));
      }
    }
    for (const downstreamId of downstreamIds) {
      const flow = partialSnapshot.flows[downstreamId];
      if (!flow || flow.state !== 'full' || !flow.throttle) {
        partialOk = false;
        errors.push(issue('error', 'FLUID_PARTIAL_DOWNSTREAM', `部分开启 ${pipe.id} 的阀门后，下游管 ${downstreamId} 应节流`, [pipe.id, downstreamId]));
      }
    }
    for (const otherStream of process.flowStreams) {
      if (otherStream.id === stream.id) continue;
      for (const otherId of otherStream.pipelineIds) {
        const flow = partialSnapshot.flows[otherId];
        if (!flow || flow.state !== 'full' || flow.throttle) {
          partialOk = false;
          errors.push(issue('error', 'FLUID_PARTIAL_OTHER', `部分开启 ${pipe.id} 的阀门不应影响流线 ${otherStream.id} 的管线 ${otherId}`, [pipe.id, otherId]));
        }
      }
    }
    if (partialOk) partialPropagation += 1;
    if (!closedSample) {
      closedSample = closedFlow ?? null;
      closedSamplePipeline = pipe.id;
    }
    if (!partialSample) {
      partialSample = partialFlow ?? null;
      partialSamplePipeline = pipe.id;
    }
  }

  const allClosedStates = Object.fromEntries(process.pipelines.map((pipe) => [pipe.id, 'closed' as ValveState]));
  const allClosed = computeBoilFluid(process, routes, allClosedStates);
  const sourceEquipment = new Set(process.flowStreams.map((stream) => stream.equipmentSequence[0]).filter(Boolean));
  if (allClosed.counts.halt !== process.flowStreams.length) {
    errors.push(issue('error', 'FLUID_ALL_CLOSED_HALT', `全部关闭时应有 ${process.flowStreams.length} 条首管停止，实际为 ${allClosed.counts.halt}`, []));
  }
  if (allClosed.counts.full !== 0) {
    errors.push(issue('error', 'FLUID_ALL_CLOSED_FULL', '全部关闭时不应有管线继续流动', []));
  }
  if (allClosed.suppliedEquipment.some((id) => !sourceEquipment.has(id)) || allClosed.suppliedEquipment.length !== sourceEquipment.size) {
    errors.push(issue('error', 'FLUID_ALL_CLOSED_SUPPLY', '全部关闭时供料设备应只剩两个流线源', allClosed.suppliedEquipment));
  }

  const checkExpected = (label: string, actual: number, expected: number | undefined, code: string): void => {
    if (expected !== undefined && actual !== expected) {
      errors.push(issue('error', code, `${label}数量应为 ${expected}，实际为 ${actual}`, []));
    }
  };
  checkExpected('流体管线', initial.counts.pipelines, expectations.pipelines, 'FLUID_EXPECT_PIPE');
  checkExpected('示意阀', valves, expectations.valves, 'FLUID_EXPECT_VALVE');
  checkExpected('流线', initial.counts.streams, expectations.streams, 'FLUID_EXPECT_STREAM');
  checkExpected('全开流动管线', initial.counts.full, expectations.fullOnOpen, 'FLUID_EXPECT_FULL');
  checkExpected('全开节流管线', initial.counts.throttle, expectations.throttleOnOpen, 'FLUID_EXPECT_THROTTLE');
  checkExpected('全开供料设备', initial.counts.suppliedEquipment, expectations.suppliedOnOpen, 'FLUID_EXPECT_SUPPLY');
  checkExpected('全开未供料设备', initial.counts.unsuppliedEquipment, expectations.unsuppliedOnOpen, 'FLUID_EXPECT_UNSUPPLIED');

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    counts: {
      pipelines: initial.counts.pipelines,
      valves,
      streams: initial.counts.streams,
      fullOnOpen: initial.counts.full,
      throttleOnOpen: initial.counts.throttle,
      suppliedOnOpen: initial.counts.suppliedEquipment,
      unsuppliedOnOpen: initial.counts.unsuppliedEquipment,
      closedPropagation,
      partialPropagation
    },
    initial,
    samples: {
      closedPipeline: closedSamplePipeline,
      closedFlow: closedSample,
      partialPipeline: partialSamplePipeline,
      partialFlow: partialSample
    }
  };
}
