/**
 * 设备接口与连接关系（Phase 2）。
 *
 * 在 Phase 1 拓扑数据上建立可复用的连接图：
 * - 每台设备每个接口的连接管线与对端设备；
 * - 直接上下游、完整上游/下游路径；
 * - 模型接口锚点与数据接口的一致性校验；
 * - 边界口 / 待确认口 / 未连接口的显式分类。
 *
 * 本模块只处理数据关系，不生成管道几何、不做流体动画。
 */

import type {
  EquipmentInstanceDef,
  PipelineDef,
  PortDef,
  ProcessDefinition
} from '../data/processTypes';
import type { ProcessValidationIssue } from './validate';

export interface ModelPortSpec {
  id: string;
  role: 'in' | 'out' | 'both';
  media: string[];
  pos: [number, number, number];
  dir: [number, number, number];
  boundary?: boolean;
}

export type ModelPortResolver = (key: string) => ModelPortSpec[] | undefined;

export interface PortLink {
  pipelineId: string;
  side: 'from' | 'to';
  peerEquipment: string;
  peerPort: string;
  medium: string;
}

export interface EquipmentConnectionSummary {
  equipmentId: string;
  name: string;
  modelKey: string;
  inbound: PortLink[];
  outbound: PortLink[];
  upstream: string[];
  downstream: string[];
  connectedPortIds: string[];
  boundaryPortIds: string[];
  pendingPortIds: string[];
  unconnectedPortIds: string[];
}

export interface ConnectionEdge {
  pipelineId: string;
  fromEquipment: string;
  fromPort: string;
  toEquipment: string;
  toPort: string;
  medium: string;
}

export interface ConnectionGraph {
  equipment: Map<string, EquipmentConnectionSummary>;
  edges: ConnectionEdge[];
  counts: {
    equipment: number;
    connectedPorts: number;
    boundaryPorts: number;
    pendingPorts: number;
    unconnectedPorts: number;
    edges: number;
  };
}

export interface ConnectionExpectations {
  equipment?: number;
  modelInstances?: number;
  modelTypes?: number;
  modelPorts?: number;
  anchoredPorts?: number;
  connectedPorts?: number;
  boundaryPorts?: number;
  pendingPorts?: number;
  edges?: number;
  sequences?: { flowId: string; equipmentSequence: string[] }[];
}

export interface ConnectionValidation {
  ok: boolean;
  graph: ConnectionGraph;
  errors: ProcessValidationIssue[];
  warnings: ProcessValidationIssue[];
  counts: {
    equipment: number;
    modelInstances: number;
    modelTypes: number;
    modelPorts: number;
    dataPorts: number;
    anchoredPorts: number;
    connectedPorts: number;
    boundaryPorts: number;
    pendingPorts: number;
    unconnectedPorts: number;
    edges: number;
    upstreamPaths: number;
    downstreamPaths: number;
  };
}

function portKey(equipmentId: string, portId: string): string {
  return `${equipmentId}.${portId}`;
}

function uniquePush(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

function isFiniteVec3(value: unknown): boolean {
  return Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === 'number' && Number.isFinite(v));
}

export function buildConnectionGraph(process: ProcessDefinition): ConnectionGraph {
  const refs = new Map<string, PortLink[]>();
  const edges: ConnectionEdge[] = [];

  for (const pipe of process.pipelines) {
    const fromKey = portKey(pipe.from.equipment, pipe.from.port);
    const toKey = portKey(pipe.to.equipment, pipe.to.port);
    const fromLinks = refs.get(fromKey) ?? [];
    fromLinks.push({
      pipelineId: pipe.id,
      side: 'from',
      peerEquipment: pipe.to.equipment,
      peerPort: pipe.to.port,
      medium: pipe.medium
    });
    refs.set(fromKey, fromLinks);
    const toLinks = refs.get(toKey) ?? [];
    toLinks.push({
      pipelineId: pipe.id,
      side: 'to',
      peerEquipment: pipe.from.equipment,
      peerPort: pipe.from.port,
      medium: pipe.medium
    });
    refs.set(toKey, toLinks);
    edges.push({
      pipelineId: pipe.id,
      fromEquipment: pipe.from.equipment,
      fromPort: pipe.from.port,
      toEquipment: pipe.to.equipment,
      toPort: pipe.to.port,
      medium: pipe.medium
    });
  }

  const equipment = new Map<string, EquipmentConnectionSummary>();
  let connectedPorts = 0;
  let boundaryPorts = 0;
  let pendingPorts = 0;
  let unconnectedPorts = 0;

  for (const eq of process.equipment) {
    const summary: EquipmentConnectionSummary = {
      equipmentId: eq.id,
      name: eq.name,
      modelKey: eq.modelKey ?? '',
      inbound: [],
      outbound: [],
      upstream: [],
      downstream: [],
      connectedPortIds: [],
      boundaryPortIds: [],
      pendingPortIds: [],
      unconnectedPortIds: []
    };

    for (const port of eq.ports) {
      const links = refs.get(portKey(eq.id, port.id)) ?? [];
      if (links.length > 0) {
        connectedPorts += 1;
        summary.connectedPortIds.push(port.id);
        for (const link of links) {
          if (link.side === 'to') {
            summary.inbound.push(link);
            uniquePush(summary.upstream, link.peerEquipment);
          } else {
            summary.outbound.push(link);
            uniquePush(summary.downstream, link.peerEquipment);
          }
        }
        continue;
      }
      if (port.boundary) {
        boundaryPorts += 1;
        summary.boundaryPortIds.push(port.id);
      } else if (port.dataStatus === 'pending-confirmation') {
        pendingPorts += 1;
        summary.pendingPortIds.push(port.id);
      } else {
        unconnectedPorts += 1;
        summary.unconnectedPortIds.push(port.id);
      }
    }

    equipment.set(eq.id, summary);
  }

  return {
    equipment,
    edges,
    counts: {
      equipment: equipment.size,
      connectedPorts,
      boundaryPorts,
      pendingPorts,
      unconnectedPorts,
      edges: edges.length
    }
  };
}

export function traceDownstream(graph: ConnectionGraph, startEquipmentId: string): string[] {
  const path = [startEquipmentId];
  const seen = new Set(path);
  let current = startEquipmentId;
  for (let guard = 0; guard < graph.equipment.size + 1; guard++) {
    const next = graph.equipment.get(current)?.downstream[0];
    if (!next || seen.has(next)) break;
    path.push(next);
    seen.add(next);
    current = next;
  }
  return path;
}

export function traceUpstream(graph: ConnectionGraph, startEquipmentId: string): string[] {
  const path = [startEquipmentId];
  const seen = new Set(path);
  let current = startEquipmentId;
  for (let guard = 0; guard < graph.equipment.size + 1; guard++) {
    const prev = graph.equipment.get(current)?.upstream[0];
    if (!prev || seen.has(prev)) break;
    path.unshift(prev);
    seen.add(prev);
    current = prev;
  }
  return path;
}

export function tracePathBetween(graph: ConnectionGraph, fromEquipmentId: string, toEquipmentId: string): string[] | null {
  if (!graph.equipment.has(fromEquipmentId) || !graph.equipment.has(toEquipmentId)) return null;
  const queue = [fromEquipmentId];
  const prev = new Map<string, string | null>([[fromEquipmentId, null]]);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === toEquipmentId) {
      const path: string[] = [];
      let node: string | null = current;
      while (node) {
        path.unshift(node);
        node = prev.get(node) ?? null;
      }
      return path;
    }
    for (const next of graph.equipment.get(current)?.downstream ?? []) {
      if (prev.has(next)) continue;
      prev.set(next, current);
      queue.push(next);
    }
  }
  return null;
}

function findPort(eq: EquipmentInstanceDef, portId: string): PortDef | undefined {
  return eq.ports.find((p) => (p.modelPortId ?? p.id) === portId);
}

export function validateConnectionRelations(
  process: ProcessDefinition,
  resolveModelPorts: ModelPortResolver,
  expectations: ConnectionExpectations = {}
): ConnectionValidation {
  const errors: ProcessValidationIssue[] = [];
  const warnings: ProcessValidationIssue[] = [];
  const report = (level: 'error' | 'warning', code: string, message: string, refs: string[] = []): void => {
    (level === 'error' ? errors : warnings).push({ level, code, message, refs });
  };

  let dataPorts = 0;
  let anchoredPorts = 0;
  const modelKeys = new Set<string>();
  let modelInstances = 0;
  let modelPorts = 0;

  for (const eq of process.equipment) {
    const ref = `设备 ${eq.id}`;
    if (!eq.modelKey) {
      report('error', 'EQ_MODEL_KEY', `${ref} 缺少参数化模型键 modelKey`, [eq.id]);
      continue;
    }
    const modelPortsForEq = resolveModelPorts(eq.modelKey);
    if (!modelPortsForEq || modelPortsForEq.length === 0) {
      report('error', 'EQ_MODEL_MISSING', `${ref} 的模型 ${eq.modelKey} 未注册或没有接口锚点`, [eq.id, eq.modelKey]);
      continue;
    }
    modelInstances += 1;
    if (!modelKeys.has(eq.modelKey)) {
      modelKeys.add(eq.modelKey);
      modelPorts += modelPortsForEq.length;
    }
    if (eq.modelStatus !== 'available') {
      report('warning', 'EQ_MODEL_STATUS', `${ref} 已有模型 ${eq.modelKey}，但 modelStatus 不是 available`, [eq.id]);
    }

    const modelPortIds = new Set<string>();
    for (const mp of modelPortsForEq) {
      if (!mp.id) {
        report('error', 'MODEL_PORT_ID', `${ref} 的模型 ${eq.modelKey} 存在缺少 id 的接口`, [eq.modelKey]);
        continue;
      }
      if (modelPortIds.has(mp.id)) {
        report('error', 'MODEL_PORT_DUP', `${ref} 的模型 ${eq.modelKey} 接口 id 重复：${mp.id}`, [eq.id, mp.id]);
      }
      modelPortIds.add(mp.id);
      if (!isFiniteVec3(mp.pos)) report('error', 'MODEL_PORT_POS', `${ref} 的模型接口 ${mp.id} 坐标无效`, [eq.id, mp.id]);
      if (!isFiniteVec3(mp.dir)) {
        report('error', 'MODEL_PORT_DIR', `${ref} 的模型接口 ${mp.id} 法线无效`, [eq.id, mp.id]);
      } else {
        const len = Math.hypot(mp.dir[0], mp.dir[1], mp.dir[2]);
        if (Math.abs(len - 1) > 0.01) report('error', 'MODEL_PORT_DIR_NORM', `${ref} 的模型接口 ${mp.id} 法线未归一化（长度 ${len.toFixed(3)}）`, [eq.id, mp.id]);
      }
    }

    for (const port of eq.ports) {
      dataPorts += 1;
      const mp = modelPortsForEq.find((candidate) => candidate.id === (port.modelPortId ?? port.id));
      if (!mp) {
        report('error', 'PORT_MODEL_MISSING', `${ref}.${port.id} 在模型 ${eq.modelKey} 中没有对应接口锚点`, [eq.id, port.id]);
        continue;
      }
      anchoredPorts += 1;
      if (mp.role !== port.role) {
        report('error', 'PORT_ROLE_MISMATCH', `${ref}.${port.id} 的数据角色 ${port.role} 与模型角色 ${mp.role} 不一致`, [eq.id, port.id]);
      }
      if (port.media.length > 0 && mp.media.length > 0 && !port.media.some((m) => mp.media.includes(m))) {
        report('error', 'PORT_MEDIA_MISMATCH', `${ref}.${port.id} 的数据介质与模型介质不一致`, [eq.id, port.id]);
      }
      if (Boolean(port.boundary) !== Boolean(mp.boundary)) {
        report('error', 'PORT_BOUNDARY_MISMATCH', `${ref}.${port.id} 的边界口标记与模型不一致`, [eq.id, port.id]);
      }
    }

    for (const mp of modelPortsForEq) {
      if (!findPort(eq, mp.id)) {
        report('error', 'MODEL_PORT_UNDECLARED', `${ref} 的模型接口 ${mp.id} 未在数据接口中声明`, [eq.id, mp.id]);
      }
    }
  }

  const graph = buildConnectionGraph(process);

  /* 连接图层面的自洽检查 */
  const edgeKeys = new Set<string>();
  for (const edge of graph.edges) {
    const key = `${edge.fromEquipment}.${edge.fromPort}->${edge.toEquipment}.${edge.toPort}`;
    if (edgeKeys.has(key)) {
      report('error', 'EDGE_DUP', `接口连接重复：${key}`, [edge.pipelineId]);
    }
    edgeKeys.add(key);
  }

  for (const eq of process.equipment) {
    const summary = graph.equipment.get(eq.id);
    if (!summary) continue;
    for (const port of eq.ports) {
      const portLinks = [...summary.inbound, ...summary.outbound].filter((link) => {
        const pipe = process.pipelines.find((candidate) => candidate.id === link.pipelineId);
        if (!pipe) return false;
        return link.side === 'from' ? pipe.from.port === port.id : pipe.to.port === port.id;
      });
      if (portLinks.length > 1) {
        report('warning', 'PORT_MULTI', `接口 ${eq.id}.${port.id} 连接了 ${portLinks.length} 条管线，请确认是否为汇管`, [eq.id, port.id]);
      }
    }
    const unconnected = summary.unconnectedPortIds;
    if (unconnected.length > 0) {
      report('error', 'PORT_UNCONNECTED', `设备 ${eq.id} 存在未连接且未标待确认/边界的接口：${unconnected.join(', ')}`, [eq.id]);
    }
  }

  /* 流线顺序与上下游路径一致性：全局连接图允许物料流汇入烟气流，
     因此流线顺序按“下游路径的前缀 / 上游路径的后缀”校验。 */
  let upstreamPaths = 0;
  let downstreamPaths = 0;
  for (const flow of process.flowStreams) {
    const seq = flow.equipmentSequence ?? [];
    if (seq.length < 2) continue;
    const downstream = traceDownstream(graph, seq[0]);
    const downstreamOk = seq.every((id, index) => downstream[index] === id);
    if (!downstreamOk) {
      report('error', 'FLOW_TRACE_DOWN', `流线 ${flow.id} 的下游追踪与设备顺序不一致：${downstream.join(' → ')}`, [flow.id]);
    } else {
      downstreamPaths += 1;
    }
    const upstream = traceUpstream(graph, seq[seq.length - 1]);
    const upstreamOk = seq.every((id, index) => upstream[upstream.length - seq.length + index] === id);
    if (!upstreamOk) {
      report('error', 'FLOW_TRACE_UP', `流线 ${flow.id} 的上游追踪与设备顺序不一致：${upstream.join(' → ')}`, [flow.id]);
    } else {
      upstreamPaths += 1;
    }
    for (let i = 0; i < seq.length; i++) {
      const summary = graph.equipment.get(seq[i]);
      if (!summary) continue;
      const needsIn = i > 0;
      const needsOut = i < seq.length - 1;
      if (needsIn && summary.inbound.length === 0) {
        report('error', 'FLOW_NODE_IN', `流线 ${flow.id} 的设备 ${seq[i]} 缺少上游连接`, [flow.id, seq[i]]);
      }
      if (needsOut && summary.outbound.length === 0) {
        report('error', 'FLOW_NODE_OUT', `流线 ${flow.id} 的设备 ${seq[i]} 缺少下游连接`, [flow.id, seq[i]]);
      }
    }
  }

  /* 有向环检测：当前教学流程应为单向链 */
  const white = new Set(process.equipment.map((e) => e.id));
  const gray = new Set<string>();
  const black = new Set<string>();
  const visit = (id: string): void => {
    if (gray.has(id)) {
      report('error', 'GRAPH_CYCLE', `连接关系存在有向环，涉及设备 ${id}`, [id]);
      return;
    }
    if (black.has(id)) return;
    gray.add(id);
    for (const next of graph.equipment.get(id)?.downstream ?? []) visit(next);
    gray.delete(id);
    black.add(id);
    white.delete(id);
  };
  for (const id of [...white]) visit(id);

  const counts = {
    equipment: process.equipment.length,
    modelInstances,
    modelTypes: modelKeys.size,
    modelPorts,
    dataPorts,
    anchoredPorts,
    connectedPorts: graph.counts.connectedPorts,
    boundaryPorts: graph.counts.boundaryPorts,
    pendingPorts: graph.counts.pendingPorts,
    unconnectedPorts: graph.counts.unconnectedPorts,
    edges: graph.counts.edges,
    upstreamPaths,
    downstreamPaths
  };

  const checkExpectedCount = (label: string, actual: number, expected: number | undefined, code: string): void => {
    if (expected !== undefined && actual !== expected) {
      report('error', code, `${label}数量应为 ${expected}，实际为 ${actual}`, []);
    }
  };
  checkExpectedCount('设备实例', counts.equipment, expectations.equipment, 'EXPECT_EQUIPMENT');
  checkExpectedCount('建模实例', counts.modelInstances, expectations.modelInstances, 'EXPECT_MODEL_INSTANCE');
  checkExpectedCount('模型类型', counts.modelTypes, expectations.modelTypes, 'EXPECT_MODEL_TYPE');
  checkExpectedCount('模型接口', counts.modelPorts, expectations.modelPorts, 'EXPECT_MODEL_PORT');
  checkExpectedCount('已锚定接口', counts.anchoredPorts, expectations.anchoredPorts, 'EXPECT_ANCHOR');
  checkExpectedCount('已连接接口', counts.connectedPorts, expectations.connectedPorts, 'EXPECT_CONNECTED');
  checkExpectedCount('边界接口', counts.boundaryPorts, expectations.boundaryPorts, 'EXPECT_BOUNDARY');
  checkExpectedCount('待确认接口', counts.pendingPorts, expectations.pendingPorts, 'EXPECT_PENDING');
  checkExpectedCount('连接边', counts.edges, expectations.edges, 'EXPECT_EDGE');

  for (const expected of expectations.sequences ?? []) {
    const flow = process.flowStreams.find((f) => f.id === expected.flowId);
    if (!flow) {
      report('error', 'EXPECT_FLOW_ID', `连接验收引用了不存在的流线 ${expected.flowId}`, [expected.flowId]);
      continue;
    }
    const downstream = traceDownstream(graph, expected.equipmentSequence[0]);
    if (!expected.equipmentSequence.every((id, index) => downstream[index] === id)) {
      report('error', 'EXPECT_SEQUENCE_DOWN', `流线 ${expected.flowId} 的下游路径不符合验收顺序`, [expected.flowId]);
    }
    const upstream = traceUpstream(graph, expected.equipmentSequence[expected.equipmentSequence.length - 1]);
    if (!expected.equipmentSequence.every((id, index) => upstream[upstream.length - expected.equipmentSequence.length + index] === id)) {
      report('error', 'EXPECT_SEQUENCE_UP', `流线 ${expected.flowId} 的上游路径不符合验收顺序`, [expected.flowId]);
    }
  }

  return {
    ok: errors.length === 0,
    graph,
    errors,
    warnings,
    counts
  };
}
