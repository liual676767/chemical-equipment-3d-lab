/**
 * 微沸喷烧 Phase 6：智能上下游工艺追踪引擎。
 *
 * 只从流程数据推导关系，不按页面顺序推断：
 * - 设备 = 节点，管线 = 有向工艺边；
 * - 结构关联父设备（如四根喷枪挂二燃室）= 平行支路边，不与工艺边混用；
 * - 上游/下游/完整路径均支持多分支汇入、多下游与循环保护（visited 集合）；
 * - 四根喷枪按二燃室的四个独立平行支路返回，不会生成喷枪 01→02→03→04 串联；
 * - 待确认接口与支路关系如实返回，不补占位值。
 *
 * 本模块为纯 TypeScript，不依赖 DOM / Three.js。
 */

import type { DataStatus, EquipmentInstanceDef, ProcessDefinition } from '../data/processTypes';

export type TraceEdgeKind = 'process' | 'branch';
export type TraceSideKind = 'upstream' | 'downstream' | 'full';
export type TraceMode = 'upstream' | 'downstream' | 'full';

export interface TraceEdge {
  id: string;
  kind: TraceEdgeKind;
  from: string;
  to: string;
  pipelineId?: string;
  medium?: string;
  flowStreamId?: string;
  dataStatus: DataStatus;
  note?: string;
}

export interface TraceBranchGroup {
  id: string;
  parentEquipmentId: string;
  parentName: string;
  equipmentIds: string[];
  equipmentNames: string[];
  kind: 'parallel-branch';
  dataStatus: DataStatus;
  note: string;
}

export interface TracePath {
  equipmentIds: string[];
  pipelineIds: string[];
}

export interface TraceSide {
  kind: TraceSideKind;
  rootId: string;
  /** 工艺路径上的设备（包含起点设备；支路设备单独放在 branches）。 */
  equipmentIds: string[];
  pipelineIds: string[];
  edgeIds: string[];
  paths: TracePath[];
  branches: TraceBranchGroup[];
  pendingEquipmentIds: string[];
  cycles: string[][];
  truncated: boolean;
}

export interface TracePendingPort {
  equipmentId: string;
  equipmentName: string;
  portId: string;
  portName: string;
  note: string;
  dataStatus: DataStatus;
}

export interface TraceResult {
  rootId: string;
  rootName: string;
  rootAreaId: string;
  upstream: TraceSide;
  downstream: TraceSide;
  full: TraceSide;
  /** 设备的“宿主”结构关联（如喷枪 → 二燃室），不是工艺上游。 */
  structuralParentId?: string;
  structuralParentName?: string;
  structuralNote?: string;
  pendingPorts: TracePendingPort[];
  cycles: string[][];
}

export interface TraceAudit {
  nodes: number;
  processEdges: number;
  branchEdges: number;
  branchGroups: number;
  branchParentIds: string[];
  branchEquipmentIds: string[];
  serialGunEdges: string[];
  pendingPorts: TracePendingPort[];
  cycles: string[][];
  cycleSafe: boolean;
}

const MAX_PATHS = 32;
const MAX_CYCLES = 8;

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function pathKey(path: TracePath): string {
  return `${path.equipmentIds.join('>')}|${path.pipelineIds.join('>')}`;
}

function cycleKey(cycle: string[]): string {
  return cycle.join('>');
}

export class ProcessTraceEngine {
  readonly process: ProcessDefinition;
  private readonly equipmentById = new Map<string, EquipmentInstanceDef>();
  private readonly processEdges: TraceEdge[] = [];
  private readonly branchEdges: TraceEdge[] = [];
  private readonly branchGroups: TraceBranchGroup[] = [];
  private readonly incomingProcess = new Map<string, TraceEdge[]>();
  private readonly outgoingProcess = new Map<string, TraceEdge[]>();
  private readonly incomingAll = new Map<string, TraceEdge[]>();
  private readonly outgoingAll = new Map<string, TraceEdge[]>();
  private readonly edgeByPair = new Map<string, TraceEdge>();
  private readonly pendingPorts: TracePendingPort[] = [];
  private readonly globalCycles: string[][] = [];

  constructor(process: ProcessDefinition) {
    this.process = process;
    for (const equipment of process.equipment) {
      this.equipmentById.set(equipment.id, equipment);
      this.incomingProcess.set(equipment.id, []);
      this.outgoingProcess.set(equipment.id, []);
      this.incomingAll.set(equipment.id, []);
      this.outgoingAll.set(equipment.id, []);
    }

    for (const pipeline of process.pipelines) {
      const edge: TraceEdge = {
        id: pipeline.id,
        kind: 'process',
        from: pipeline.from.equipment,
        to: pipeline.to.equipment,
        pipelineId: pipeline.id,
        medium: pipeline.medium,
        flowStreamId: pipeline.flowStreamId,
        dataStatus: pipeline.dataStatus
      };
      this.processEdges.push(edge);
      this.link(edge, this.incomingProcess, this.outgoingProcess);
      this.link(edge, this.incomingAll, this.outgoingAll);
      this.edgeByPair.set(`${edge.from}>${edge.to}`, edge);
    }

    this.buildBranchGroups();
    this.collectPendingPorts();
    this.globalCycles.push(...this.detectCycles());
  }

  private link(
    edge: TraceEdge,
    incoming: Map<string, TraceEdge[]>,
    outgoing: Map<string, TraceEdge[]>
  ): void {
    const inList = incoming.get(edge.to);
    if (inList) inList.push(edge);
    const outList = outgoing.get(edge.from);
    if (outList) outList.push(edge);
  }

  private buildBranchGroups(): void {
    const groups = new Map<string, EquipmentInstanceDef[]>();
    for (const equipment of this.process.equipment) {
      if (!equipment.parentEquipmentId) continue;
      if (equipment.relationKind !== 'parallel-branch') continue;
      const list = groups.get(equipment.parentEquipmentId) ?? [];
      list.push(equipment);
      groups.set(equipment.parentEquipmentId, list);
    }
    for (const [parentId, children] of groups) {
      const parent = this.equipmentById.get(parentId);
      const pending = children.every((child) => child.relationStatus === 'pending-confirmation');
      const group: TraceBranchGroup = {
        id: `branch-group-${parentId}`,
        parentEquipmentId: parentId,
        parentName: parent?.name ?? parentId,
        equipmentIds: children.map((child) => child.id),
        equipmentNames: children.map((child) => child.name),
        kind: 'parallel-branch',
        dataStatus: pending ? 'pending-confirmation' : 'teaching-demo',
        note:
          children.find((child) => child.relationNote)?.relationNote ??
          '结构关联支路；具体接入位置与介质待现场确认。'
      };
      this.branchGroups.push(group);
      for (const child of children) {
        const edge: TraceEdge = {
          id: `branch:${parentId}->${child.id}`,
          kind: 'branch',
          from: parentId,
          to: child.id,
          dataStatus: child.relationStatus ?? child.dataStatus,
          note: group.note
        };
        this.branchEdges.push(edge);
        this.link(edge, this.incomingAll, this.outgoingAll);
      }
    }
  }

  private collectPendingPorts(): void {
    const connected = new Set<string>();
    for (const pipeline of this.process.pipelines) {
      connected.add(`${pipeline.from.equipment}.${pipeline.from.port}`);
      connected.add(`${pipeline.to.equipment}.${pipeline.to.port}`);
    }
    for (const equipment of this.process.equipment) {
      for (const port of equipment.ports) {
        if (port.boundary) continue;
        if (connected.has(`${equipment.id}.${port.id}`)) continue;
        if (port.dataStatus !== 'pending-confirmation') continue;
        this.pendingPorts.push({
          equipmentId: equipment.id,
          equipmentName: equipment.name,
          portId: port.id,
          portName: port.name,
          note: port.note ?? '接口接入关系待现场资料确认。',
          dataStatus: port.dataStatus
        });
      }
    }
  }

  private detectCycles(): string[][] {
    const color = new Map<string, 'white' | 'gray' | 'black'>();
    for (const equipment of this.process.equipment) color.set(equipment.id, 'white');
    const stack: string[] = [];
    const cycles: string[][] = [];
    const seen = new Set<string>();

    const visit = (id: string): void => {
      color.set(id, 'gray');
      stack.push(id);
      for (const edge of this.outgoingAll.get(id) ?? []) {
        if (cycles.length >= MAX_CYCLES) break;
        const next = edge.to;
        const state = color.get(next) ?? 'white';
        if (state === 'gray') {
          const index = stack.indexOf(next);
          const cycle = index >= 0 ? [...stack.slice(index), next] : [id, next];
          const key = cycleKey(cycle);
          if (!seen.has(key)) {
            seen.add(key);
            cycles.push(cycle);
          }
        } else if (state === 'white') {
          visit(next);
        }
      }
      stack.pop();
      color.set(id, 'black');
    };

    for (const equipment of this.process.equipment) {
      if (color.get(equipment.id) === 'white') visit(equipment.id);
      if (cycles.length >= MAX_CYCLES) break;
    }
    return cycles;
  }

  private branchGroupsFor(equipmentSet: Set<string>, side: 'upstream' | 'downstream' | 'full'): TraceBranchGroup[] {
    return this.branchGroups.filter((group) => {
      const parentHit = equipmentSet.has(group.parentEquipmentId);
      const childHit = group.equipmentIds.some((id) => equipmentSet.has(id));
      if (side === 'upstream') return childHit;
      if (side === 'downstream') return parentHit;
      return parentHit || childHit;
    });
  }

  private pendingEquipmentIds(equipmentSet: Set<string>): string[] {
    return [...equipmentSet].filter((id) =>
      this.pendingPorts.some((port) => port.equipmentId === id)
    );
  }

  private pipelineIdsForPath(equipmentIds: string[]): string[] {
    const pipelineIds: string[] = [];
    for (let i = 0; i + 1 < equipmentIds.length; i += 1) {
      const edge = this.edgeByPair.get(`${equipmentIds[i]}>${equipmentIds[i + 1]}`);
      if (edge?.pipelineId && !pipelineIds.includes(edge.pipelineId)) {
        pipelineIds.push(edge.pipelineId);
      }
    }
    return pipelineIds;
  }

  private collectProcessSide(
    rootId: string,
    direction: 'upstream' | 'downstream'
  ): { equipment: Set<string>; pipelineIds: Set<string>; edgeIds: Set<string> } {
    const equipment = new Set<string>([rootId]);
    const pipelineIds = new Set<string>();
    const edgeIds = new Set<string>();
    const queue = [rootId];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      const edges =
        direction === 'upstream'
          ? this.incomingProcess.get(current) ?? []
          : this.outgoingProcess.get(current) ?? [];
      for (const edge of edges) {
        if (edge.pipelineId) pipelineIds.add(edge.pipelineId);
        edgeIds.add(edge.id);
        const next = direction === 'upstream' ? edge.from : edge.to;
        if (equipment.has(next)) continue;
        equipment.add(next);
        queue.push(next);
      }
    }
    return { equipment, pipelineIds, edgeIds };
  }

  private walkPaths(
    rootId: string,
    direction: 'upstream' | 'downstream'
  ): { paths: TracePath[]; cycles: string[][]; truncated: boolean } {
    const paths: TracePath[] = [];
    const cycles: string[][] = [];
    const stack: string[] = [];
    const onPath = new Set<string>();
    let truncated = false;

    const visit = (node: string): void => {
      if (paths.length >= MAX_PATHS) {
        truncated = true;
        return;
      }
      stack.push(node);
      onPath.add(node);
      const edges =
        direction === 'upstream'
          ? this.incomingProcess.get(node) ?? []
          : this.outgoingProcess.get(node) ?? [];
      if (edges.length === 0) {
        const equipmentIds = direction === 'upstream' ? [...stack].reverse() : [...stack];
        paths.push({ equipmentIds, pipelineIds: this.pipelineIdsForPath(equipmentIds) });
      } else {
        for (const edge of edges) {
          if (paths.length >= MAX_PATHS) {
            truncated = true;
            break;
          }
          const next = direction === 'upstream' ? edge.from : edge.to;
          if (onPath.has(next)) {
            const index = stack.indexOf(next);
            cycles.push([...(index >= 0 ? stack.slice(index) : [node]), next]);
            continue;
          }
          visit(next);
        }
      }
      stack.pop();
      onPath.delete(node);
    };

    visit(rootId);
    return { paths, cycles, truncated };
  }

  upstream(equipmentId: string): TraceSide {
    const { equipment, pipelineIds, edgeIds } = this.collectProcessSide(equipmentId, 'upstream');
    const walked = this.walkPaths(equipmentId, 'upstream');
    return {
      kind: 'upstream',
      rootId: equipmentId,
      equipmentIds: [...equipment],
      pipelineIds: [...pipelineIds],
      edgeIds: [...edgeIds],
      paths: walked.paths,
      branches: this.branchGroupsFor(equipment, 'upstream'),
      pendingEquipmentIds: this.pendingEquipmentIds(equipment),
      cycles: walked.cycles,
      truncated: walked.truncated
    };
  }

  downstream(equipmentId: string): TraceSide {
    const { equipment, pipelineIds, edgeIds } = this.collectProcessSide(equipmentId, 'downstream');
    const walked = this.walkPaths(equipmentId, 'downstream');
    return {
      kind: 'downstream',
      rootId: equipmentId,
      equipmentIds: [...equipment],
      pipelineIds: [...pipelineIds],
      edgeIds: [...edgeIds],
      paths: walked.paths,
      branches: this.branchGroupsFor(equipment, 'downstream'),
      pendingEquipmentIds: this.pendingEquipmentIds(equipment),
      cycles: walked.cycles,
      truncated: walked.truncated
    };
  }

  full(equipmentId: string): TraceResult {
    const upstream = this.upstream(equipmentId);
    const downstream = this.downstream(equipmentId);
    const equipment = new Set<string>([...upstream.equipmentIds, ...downstream.equipmentIds]);
    const pipelineIds = new Set<string>([...upstream.pipelineIds, ...downstream.pipelineIds]);
    const edgeIds = new Set<string>([...upstream.edgeIds, ...downstream.edgeIds]);
    const branches = this.branchGroupsFor(equipment, 'full');
    for (const group of branches) {
      equipment.add(group.parentEquipmentId);
      for (const id of group.equipmentIds) equipment.add(id);
      for (const edge of this.branchEdges) {
        if (edge.from === group.parentEquipmentId && group.equipmentIds.includes(edge.to)) {
          edgeIds.add(edge.id);
        }
      }
    }

    const fullPaths: TracePath[] = [];
    const seen = new Set<string>();
    const addPath = (path: TracePath): void => {
      if (fullPaths.length >= MAX_PATHS) return;
      const key = pathKey(path);
      if (seen.has(key)) return;
      seen.add(key);
      fullPaths.push(path);
    };
    const upPaths = upstream.paths.length > 0 ? upstream.paths : [{ equipmentIds: [equipmentId], pipelineIds: [] }];
    const downPaths =
      downstream.paths.length > 0 ? downstream.paths : [{ equipmentIds: [equipmentId], pipelineIds: [] }];
    for (const up of upPaths) {
      for (const down of downPaths) {
        const ids = [...up.equipmentIds, ...down.equipmentIds.slice(1)];
        const pipes = unique([...up.pipelineIds, ...down.pipelineIds]);
        addPath({ equipmentIds: ids, pipelineIds: pipes });
        if (fullPaths.length >= MAX_PATHS) break;
      }
      if (fullPaths.length >= MAX_PATHS) break;
    }
    if (fullPaths.length === 0) addPath({ equipmentIds: [equipmentId], pipelineIds: [] });

    const cycles = unique([...upstream.cycles, ...downstream.cycles, ...this.globalCycles].map(cycleKey))
      .map((key) => key.split('>'))
      .filter((cycle) => cycle.some((id) => equipment.has(id)));

    const full: TraceSide = {
      kind: 'full',
      rootId: equipmentId,
      equipmentIds: [...equipment],
      pipelineIds: [...pipelineIds],
      edgeIds: [...edgeIds],
      paths: fullPaths,
      branches,
      pendingEquipmentIds: this.pendingEquipmentIds(equipment),
      cycles,
      truncated: upstream.truncated || downstream.truncated || fullPaths.length >= MAX_PATHS
    };

    const equipmentDef = this.equipmentById.get(equipmentId);
    const group = this.branchGroups.find((item) => item.equipmentIds.includes(equipmentId));
    const parent = group ? this.equipmentById.get(group.parentEquipmentId) : undefined;
    const pendingPorts = this.pendingPorts.filter((port) => equipment.has(port.equipmentId));

    return {
      rootId: equipmentId,
      rootName: equipmentDef?.name ?? equipmentId,
      rootAreaId: equipmentDef?.areaId ?? '',
      upstream,
      downstream,
      full,
      structuralParentId: group?.parentEquipmentId,
      structuralParentName: parent?.name ?? group?.parentName,
      structuralNote: group?.note,
      pendingPorts,
      cycles
    };
  }

  side(equipmentId: string, mode: TraceMode): TraceSide | TraceResult {
    if (mode === 'full') return this.full(equipmentId);
    return mode === 'upstream' ? this.upstream(equipmentId) : this.downstream(equipmentId);
  }

  inspect(): TraceAudit {
    const gunIds = new Set(
      this.process.equipment.filter((equipment) => equipment.modelKey === 'spray-gun').map((equipment) => equipment.id)
    );
    const serialGunEdges = [...this.processEdges, ...this.branchEdges]
      .filter((edge) => gunIds.has(edge.from) && gunIds.has(edge.to))
      .map((edge) => edge.id);
    return {
      nodes: this.equipmentById.size,
      processEdges: this.processEdges.length,
      branchEdges: this.branchEdges.length,
      branchGroups: this.branchGroups.length,
      branchParentIds: this.branchGroups.map((group) => group.parentEquipmentId),
      branchEquipmentIds: this.branchGroups.flatMap((group) => group.equipmentIds),
      serialGunEdges,
      pendingPorts: this.pendingPorts,
      cycles: this.globalCycles,
      cycleSafe: this.globalCycles.length === 0
    };
  }

  equipmentName(id: string): string {
    return this.equipmentById.get(id)?.name ?? id;
  }

  equipmentArea(id: string): string {
    return this.equipmentById.get(id)?.areaId ?? '';
  }
}

export function createTraceEngine(process: ProcessDefinition): ProcessTraceEngine {
  return new ProcessTraceEngine(process);
}
