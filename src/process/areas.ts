/**
 * 微沸喷烧 Phase 5：工艺区域模型与区域完整性校验。
 *
 * 本模块不新建任何设备/管线数据，只从已有数据推导：
 * - 每个区域的设备、管线、流体种类、上下游与教学说明；
 * - 三维区域范围（由教学布局设备模型包络推导，含教学缓冲，不是工程坐标）；
 * - 区域入口/出口管线与边界接口；
 * - 工艺流程树所需的父子关系（喷枪作为二燃室的四个独立平行支路）。
 *
 * ProcessAreaValidator 检查：设备无归属/区域无设备/重复归属/管线归属错误/
 * 区域上下游声明与实际跨区管线不一致/上下游不对称/成环/边界接口缺失/
 * 四根喷枪未正确挂到二燃室或被串成连续节点。
 */

import type {
  DataStatus,
  EquipmentInstanceDef,
  PipelineDef,
  ProcessAreaDef,
  ProcessDefinition,
  ProcessGap
} from '../data/processTypes';
import type { Vec3 } from '../data/types';
import type { PipingWorld } from './piping';
import type { ProcessValidationIssue } from './validate';

export interface AreaBounds {
  min: Vec3;
  max: Vec3;
  size: Vec3;
}

export interface AreaPortRef {
  equipmentId: string;
  equipmentName: string;
  portId: string;
  portName: string;
  role: 'in' | 'out' | 'both';
  boundary: boolean;
  dataStatus: DataStatus;
}

export interface AreaLink {
  from: string;
  to: string;
  pipelineIds: string[];
}

export interface ProcessAreaModel {
  def: ProcessAreaDef;
  equipment: EquipmentInstanceDef[];
  pipelines: PipelineDef[];
  mediaIds: string[];
  flowStreamIds: string[];
  upstreamAreaIds: string[];
  downstreamAreaIds: string[];
  entryPipelines: PipelineDef[];
  exitPipelines: PipelineDef[];
  entryPorts: AreaPortRef[];
  exitPorts: AreaPortRef[];
  bounds: AreaBounds | null;
}

export interface ProcessAreaValidationCounts {
  areas: number;
  equipment: number;
  pipelines: number;
  links: number;
  entryPipelines: number;
  exitPipelines: number;
  boundaryPorts: number;
  media: number;
  flowStreams: number;
  bounds: number;
  teaching: number;
  sprayGuns: number;
  sprayGunBranches: number;
}

export interface ProcessAreaValidation {
  ok: boolean;
  errors: ProcessValidationIssue[];
  warnings: ProcessValidationIssue[];
  counts: ProcessAreaValidationCounts;
  areas: ProcessAreaModel[];
  adjacency: AreaLink[];
  byEquipmentId: Map<string, string>;
  byPipelineId: Map<string, string>;
}

export interface ProcessAreaValidationOptions {
  /** 区域范围教学缓冲（m），只用于镜头取景与高亮，不是工程间距。 */
  padding?: number;
  sprayGunParentId?: string;
  expectedSprayGuns?: number;
}

const DEFAULT_PADDING = 0.4;
const DEFAULT_GUN_PARENT = 'eq-secondary-chamber';
const COMBUSTION_AREA = 'area-02-combustion';

function issue(
  level: 'error' | 'warning',
  code: string,
  message: string,
  refs: string[] = []
): ProcessValidationIssue {
  return { level, code, message, refs };
}

function uniquePush(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) {
    if (!list.includes(value)) list.push(value);
  } else {
    map.set(key, [value]);
  }
}

function equalSets(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function formatSetDiff(expected: Set<string>, actual: Set<string>): string {
  const missing = [...expected].filter((id) => !actual.has(id));
  const extra = [...actual].filter((id) => !expected.has(id));
  return `${missing.length ? `缺少 ${missing.join(', ')}` : ''}${missing.length && extra.length ? '；' : ''}${
    extra.length ? `多余 ${extra.join(', ')}` : ''
  }`;
}

function unionBounds(
  boxes: { min: Vec3; max: Vec3 }[],
  padding: number
): AreaBounds | null {
  if (boxes.length === 0) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (let i = 0; i < 3; i += 1) {
      min[i] = Math.min(min[i], box.min[i]);
      max[i] = Math.max(max[i], box.max[i]);
    }
  }
  min[0] -= padding;
  min[2] -= padding;
  max[0] += padding;
  max[2] += padding;
  min[1] = Math.max(0, min[1]);
  return {
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  };
}

function boundsContain(outer: AreaBounds, inner: { min: Vec3; max: Vec3 }, tolerance = 1e-6): boolean {
  for (let i = 0; i < 3; i += 1) {
    if (inner.min[i] < outer.min[i] - tolerance) return false;
    if (inner.max[i] > outer.max[i] + tolerance) return false;
  }
  return true;
}

function boundsOverlap(a: AreaBounds, b: AreaBounds, tolerance = 0.02): boolean {
  const overlapX = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
  const overlapY = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
  const overlapZ = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);
  return overlapX > tolerance && overlapY > tolerance && overlapZ > tolerance;
}

function hasText(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 区域内的设备树：只处理“结构关联父设备”（如喷枪挂二燃室），
 * 不把设备调用顺序当作父子关系。
 */
export interface AreaEquipmentTreeEntry {
  equipment: EquipmentInstanceDef;
  children: EquipmentInstanceDef[];
}

export function buildAreaEquipmentTree(area: ProcessAreaModel): AreaEquipmentTreeEntry[] {
  const ids = new Set(area.equipment.map((equipment) => equipment.id));
  const children = new Map<string, EquipmentInstanceDef[]>();
  const roots: EquipmentInstanceDef[] = [];
  for (const equipment of area.equipment) {
    const parent = equipment.parentEquipmentId;
    if (parent && parent !== equipment.id && ids.has(parent)) {
      const list = children.get(parent);
      if (list) list.push(equipment);
      else children.set(parent, [equipment]);
    } else {
      roots.push(equipment);
    }
  }
  return roots.map((equipment) => ({
    equipment,
    children: children.get(equipment.id) ?? []
  }));
}

/**
 * 设备在工艺拓扑中的直接上游/下游（由管线端点推导，不手写）。
 * parentEquipmentId 不参与该结果：喷枪是结构支路，不是工艺串联。
 */
export interface EquipmentFlowLink {
  equipmentId: string;
  pipelineId: string;
  direction: 'upstream' | 'downstream';
}

export function equipmentFlowLinks(
  process: ProcessDefinition,
  equipmentId: string
): EquipmentFlowLink[] {
  const links: EquipmentFlowLink[] = [];
  for (const pipeline of process.pipelines) {
    if (pipeline.to.equipment === equipmentId) {
      links.push({ equipmentId: pipeline.from.equipment, pipelineId: pipeline.id, direction: 'upstream' });
    }
    if (pipeline.from.equipment === equipmentId) {
      links.push({ equipmentId: pipeline.to.equipment, pipelineId: pipeline.id, direction: 'downstream' });
    }
  }
  return links;
}

export class ProcessAreaValidator {
  private readonly process: ProcessDefinition;
  private readonly world: PipingWorld;
  private readonly options: Required<ProcessAreaValidationOptions>;

  constructor(
    process: ProcessDefinition,
    world: PipingWorld,
    options: ProcessAreaValidationOptions = {}
  ) {
    this.process = process;
    this.world = world;
    this.options = {
      padding: options.padding ?? DEFAULT_PADDING,
      sprayGunParentId: options.sprayGunParentId ?? DEFAULT_GUN_PARENT,
      expectedSprayGuns: options.expectedSprayGuns ?? 4
    };
  }

  validate(): ProcessAreaValidation {
    const errors: ProcessValidationIssue[] = [];
    const warnings: ProcessValidationIssue[] = [];
    const process = this.process;
    const world = this.world;
    const areaById = new Map<string, ProcessAreaDef>();
    const equipmentById = new Map<string, EquipmentInstanceDef>();
    const pipelineById = new Map<string, PipelineDef>();
    const gapById = new Map<string, ProcessGap>(process.gaps.map((gap) => [gap.id, gap]));
    const worldEquipmentById = new Map(world.equipment.map((equipment) => [equipment.equipmentId, equipment]));

    /* ---------- 基础唯一性 ---------- */
    for (const area of process.areas) {
      if (areaById.has(area.id)) {
        errors.push(issue('error', 'AREA_DUP_ID', `工艺区 id 重复：${area.id}`, [area.id]));
      } else {
        areaById.set(area.id, area);
      }
    }
    for (const equipment of process.equipment) {
      if (equipmentById.has(equipment.id)) {
        errors.push(issue('error', 'AREA_EQUIPMENT_DUP_ID', `设备实例 id 重复：${equipment.id}`, [equipment.id]));
      } else {
        equipmentById.set(equipment.id, equipment);
      }
    }
    for (const pipeline of process.pipelines) {
      if (pipelineById.has(pipeline.id)) {
        errors.push(issue('error', 'AREA_PIPELINE_DUP_ID', `管线 id 重复：${pipeline.id}`, [pipeline.id]));
      } else {
        pipelineById.set(pipeline.id, pipeline);
      }
    }

    /* ---------- 设备归属 ---------- */
    const listedAreaByEquipment = new Map<string, string[]>();
    const equipmentAreaById = new Map<string, string>();
    for (const equipment of process.equipment) {
      const area = areaById.get(equipment.areaId);
      if (!area) {
        errors.push(
          issue('error', 'EQUIPMENT_NO_AREA', `设备 ${equipment.id} 的 areaId ${equipment.areaId || '(空)'} 不存在`, [equipment.id])
        );
      } else {
        equipmentAreaById.set(equipment.id, area.id);
      }
    }
    for (const area of process.areas) {
      const listed = new Set<string>();
      for (const equipmentId of area.equipmentInstanceIds) {
        if (listed.has(equipmentId)) {
          errors.push(
            issue('error', 'AREA_EQUIPMENT_DUP', `区域 ${area.id} 的 equipmentInstanceIds 中重复列出 ${equipmentId}`, [area.id, equipmentId])
          );
        }
        listed.add(equipmentId);
        uniquePush(listedAreaByEquipment, equipmentId, area.id);
        if (!equipmentById.has(equipmentId)) {
          errors.push(issue('error', 'AREA_EQUIPMENT_UNKNOWN', `区域 ${area.id} 引用了不存在的设备 ${equipmentId}`, [area.id, equipmentId]));
        }
      }
      const expected = new Set(
        process.equipment.filter((equipment) => equipment.areaId === area.id).map((equipment) => equipment.id)
      );
      if (!equalSets(expected, listed)) {
        errors.push(
          issue(
            'error',
            'AREA_EQUIPMENT_MISMATCH',
            `区域 ${area.id} 的设备清单与设备 areaId 不一致：${formatSetDiff(expected, listed)}`,
            [area.id]
          )
        );
      }
      if (area.equipmentInstanceIds.length === 0) {
        errors.push(issue('error', 'AREA_NO_EQUIPMENT', `区域 ${area.id} 没有任何设备`, [area.id]));
      }
    }
    for (const [equipmentId, areaIds] of listedAreaByEquipment) {
      if (areaIds.length > 1) {
        errors.push(
          issue('error', 'EQUIPMENT_DUP_OWNERSHIP', `设备 ${equipmentId} 被多个区域重复归属：${areaIds.join(', ')}`, [equipmentId, ...areaIds])
        );
      }
    }

    /* ---------- 管线归属与介质 ---------- */
    const listedAreaByPipeline = new Map<string, string[]>();
    for (const pipeline of process.pipelines) {
      if (!equipmentById.has(pipeline.from.equipment)) {
        errors.push(
          issue('error', 'AREA_PIPELINE_ENDPOINT', `管线 ${pipeline.id} 的起点设备 ${pipeline.from.equipment} 不存在`, [pipeline.id])
        );
      }
      if (!equipmentById.has(pipeline.to.equipment)) {
        errors.push(
          issue('error', 'AREA_PIPELINE_ENDPOINT', `管线 ${pipeline.id} 的终点设备 ${pipeline.to.equipment} 不存在`, [pipeline.id])
        );
      }
      if (!process.media.some((medium) => medium.id === pipeline.medium)) {
        errors.push(issue('error', 'AREA_PIPELINE_MEDIUM', `管线 ${pipeline.id} 的介质 ${pipeline.medium} 不存在`, [pipeline.id]));
      }
      const fromArea = equipmentAreaById.get(pipeline.from.equipment);
      const toArea = equipmentAreaById.get(pipeline.to.equipment);
      if (fromArea && toArea) {
        const expectedArea = fromArea === toArea ? fromArea : toArea;
        if (pipeline.areaId !== expectedArea) {
          errors.push(
            issue(
              'error',
              'PIPELINE_AREA_MISMATCH',
              `管线 ${pipeline.id} 归属 ${pipeline.areaId}，按端点应为 ${expectedArea}（跨区管线归下游区）`,
              [pipeline.id, pipeline.areaId, expectedArea]
            )
          );
        }
      }
    }
    for (const area of process.areas) {
      const listed = new Set<string>();
      for (const pipelineId of area.pipelineIds) {
        if (listed.has(pipelineId)) {
          errors.push(
            issue('error', 'AREA_PIPELINE_DUP', `区域 ${area.id} 的 pipelineIds 中重复列出 ${pipelineId}`, [area.id, pipelineId])
          );
        }
        listed.add(pipelineId);
        uniquePush(listedAreaByPipeline, pipelineId, area.id);
        if (!pipelineById.has(pipelineId)) {
          errors.push(issue('error', 'AREA_PIPELINE_UNKNOWN', `区域 ${area.id} 引用了不存在的管线 ${pipelineId}`, [area.id, pipelineId]));
        }
      }
      const expected = new Set(
        process.pipelines.filter((pipeline) => pipeline.areaId === area.id).map((pipeline) => pipeline.id)
      );
      if (!equalSets(expected, listed)) {
        errors.push(
          issue(
            'error',
            'AREA_PIPELINE_LIST_MISMATCH',
            `区域 ${area.id} 的管线清单与管线 areaId 不一致：${formatSetDiff(expected, listed)}`,
            [area.id]
          )
        );
      }
    }
    for (const [pipelineId, areaIds] of listedAreaByPipeline) {
      if (areaIds.length > 1) {
        errors.push(
          issue('error', 'PIPELINE_DUP_OWNERSHIP', `管线 ${pipelineId} 被多个区域重复归属：${areaIds.join(', ')}`, [pipelineId, ...areaIds])
        );
      }
    }

    /* ---------- 区域流线/介质归属 ---------- */
    for (const area of process.areas) {
      const derivedStreams = new Set<string>();
      for (const pipelineId of area.pipelineIds) {
        const pipeline = pipelineById.get(pipelineId);
        if (!pipeline) continue;
        if (!pipeline.flowStreamId) {
          errors.push(issue('error', 'AREA_PIPELINE_STREAM', `管线 ${pipelineId} 没有流线引用，无法归属区域流体`, [area.id, pipelineId]));
          continue;
        }
        if (!process.flowStreams.some((stream) => stream.id === pipeline.flowStreamId)) {
          errors.push(issue('error', 'AREA_PIPELINE_STREAM', `管线 ${pipelineId} 的流线 ${pipeline.flowStreamId} 不存在`, [area.id, pipelineId]));
          continue;
        }
        derivedStreams.add(pipeline.flowStreamId);
      }
      const declaredStreams = new Set(area.flowStreamIds);
      for (const streamId of declaredStreams) {
        if (!process.flowStreams.some((stream) => stream.id === streamId)) {
          errors.push(issue('error', 'AREA_FLOW_UNKNOWN', `区域 ${area.id} 引用了不存在的流线 ${streamId}`, [area.id, streamId]));
        }
      }
      if (!equalSets(derivedStreams, declaredStreams)) {
        errors.push(
          issue(
            'error',
            'AREA_FLOW_MISMATCH',
            `区域 ${area.id} 的流线清单与管线实际流线不一致：${formatSetDiff(derivedStreams, declaredStreams)}`,
            [area.id]
          )
        );
      }
      if (area.pipelineIds.length === 0) {
        errors.push(issue('error', 'AREA_NO_PIPELINE', `区域 ${area.id} 没有任何管线`, [area.id]));
      }
    }

    /* ---------- 区域上下游与实际跨区管线 ---------- */
    const adjacencyMap = new Map<string, AreaLink>();
    for (const pipeline of process.pipelines) {
      const fromArea = equipmentAreaById.get(pipeline.from.equipment);
      const toArea = equipmentAreaById.get(pipeline.to.equipment);
      if (!fromArea || !toArea || fromArea === toArea) continue;
      const key = `${fromArea}->${toArea}`;
      const link = adjacencyMap.get(key);
      if (link) link.pipelineIds.push(pipeline.id);
      else adjacencyMap.set(key, { from: fromArea, to: toArea, pipelineIds: [pipeline.id] });
    }
    const adjacency = [...adjacencyMap.values()];
    const derivedDownstream = new Map<string, Set<string>>();
    const derivedUpstream = new Map<string, Set<string>>();
    for (const link of adjacency) {
      if (!derivedDownstream.has(link.from)) derivedDownstream.set(link.from, new Set());
      derivedDownstream.get(link.from)!.add(link.to);
      if (!derivedUpstream.has(link.to)) derivedUpstream.set(link.to, new Set());
      derivedUpstream.get(link.to)!.add(link.from);
    }

    for (const area of process.areas) {
      const declaredUp = new Set(area.upstreamAreaIds);
      const declaredDown = new Set(area.downstreamAreaIds);
      for (const upstreamId of declaredUp) {
        if (!areaById.has(upstreamId)) {
          errors.push(issue('error', 'AREA_UPSTREAM_UNKNOWN', `区域 ${area.id} 引用了不存在的上游区 ${upstreamId}`, [area.id, upstreamId]));
        }
        if (upstreamId === area.id) {
          errors.push(issue('error', 'AREA_SELF_LINK', `区域 ${area.id} 不能把自己声明为上游`, [area.id]));
        }
      }
      for (const downstreamId of declaredDown) {
        if (!areaById.has(downstreamId)) {
          errors.push(issue('error', 'AREA_DOWNSTREAM_UNKNOWN', `区域 ${area.id} 引用了不存在的下游区 ${downstreamId}`, [area.id, downstreamId]));
        }
        if (downstreamId === area.id) {
          errors.push(issue('error', 'AREA_SELF_LINK', `区域 ${area.id} 不能把自己声明为下游`, [area.id]));
        }
      }
      const actualUp = derivedUpstream.get(area.id) ?? new Set<string>();
      const actualDown = derivedDownstream.get(area.id) ?? new Set<string>();
      if (!equalSets(declaredUp, actualUp)) {
        errors.push(
          issue(
            'error',
            'AREA_UPSTREAM_MISMATCH',
            `区域 ${area.id} 声明的上游与实际跨区管线不一致：${formatSetDiff(actualUp, declaredUp)}`,
            [area.id]
          )
        );
      }
      if (!equalSets(declaredDown, actualDown)) {
        errors.push(
          issue(
            'error',
            'AREA_DOWNSTREAM_MISMATCH',
            `区域 ${area.id} 声明的下游与实际跨区管线不一致：${formatSetDiff(actualDown, declaredDown)}`,
            [area.id]
          )
        );
      }
    }
    for (const link of adjacency) {
      const from = areaById.get(link.from);
      const to = areaById.get(link.to);
      if (from && !from.downstreamAreaIds.includes(link.to)) {
        errors.push(
          issue('error', 'AREA_LINK_UNDECLARED', `存在 ${link.from} → ${link.to} 的跨区管线，但 ${link.from} 未声明该下游`, [link.from, link.to])
        );
      }
      if (to && !to.upstreamAreaIds.includes(link.from)) {
        errors.push(
          issue('error', 'AREA_LINK_UNDECLARED', `存在 ${link.from} → ${link.to} 的跨区管线，但 ${link.to} 未声明该上游`, [link.from, link.to])
        );
      }
    }
    for (const area of process.areas) {
      for (const downstreamId of area.downstreamAreaIds) {
        if (!adjacencyMap.has(`${area.id}->${downstreamId}`)) {
          errors.push(
            issue('error', 'AREA_LINK_NO_PIPELINE', `区域 ${area.id} 声明下游 ${downstreamId}，但两者之间没有跨区管线`, [area.id, downstreamId])
          );
        }
      }
      for (const upstreamId of area.upstreamAreaIds) {
        if (!adjacencyMap.has(`${upstreamId}->${area.id}`)) {
          errors.push(
            issue('error', 'AREA_LINK_NO_PIPELINE', `区域 ${area.id} 声明上游 ${upstreamId}，但两者之间没有跨区管线`, [area.id, upstreamId])
          );
        }
      }
    }

    /* ---------- 有向环与连通性 ---------- */
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const cycleAreas: string[] = [];
    const visit = (areaId: string): boolean => {
      if (visiting.has(areaId)) {
        cycleAreas.push(areaId);
        return true;
      }
      if (visited.has(areaId)) return false;
      visiting.add(areaId);
      for (const next of derivedDownstream.get(areaId) ?? []) {
        if (visit(next)) return true;
      }
      visiting.delete(areaId);
      visited.add(areaId);
      return false;
    };
    for (const area of process.areas) {
      if (visit(area.id)) break;
    }
    if (cycleAreas.length > 0) {
      errors.push(issue('error', 'AREA_GRAPH_CYCLE', `区域上下游存在有向环：${cycleAreas.join(' → ')}`, cycleAreas));
    }
    const rootAreas = process.areas.filter((area) => area.upstreamAreaIds.length === 0);
    if (rootAreas.length !== 1) {
      errors.push(
        issue('error', 'AREA_ROOT_COUNT', `区域上下游应为单一流程链，起点区域数量为 ${rootAreas.length}`, rootAreas.map((area) => area.id))
      );
    }
    const reachable = new Set<string>();
    const queue = rootAreas.map((area) => area.id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const next of derivedDownstream.get(current) ?? []) queue.push(next);
    }
    for (const area of process.areas) {
      if (!reachable.has(area.id)) {
        errors.push(issue('error', 'AREA_GRAPH_DISCONNECTED', `区域 ${area.id} 无法从首端区域经跨区管线到达`, [area.id]));
      }
    }

    /* ---------- 区域入口/出口与边界 ---------- */
    const areaModels: ProcessAreaModel[] = [];
    const byEquipmentId = new Map<string, string>();
    const byPipelineId = new Map<string, string>();
    let entryPipelineCount = 0;
    let exitPipelineCount = 0;
    let boundaryPortCount = 0;
    for (const area of process.areas) {
      const equipment = area.equipmentInstanceIds
        .map((id) => equipmentById.get(id))
        .filter((item): item is EquipmentInstanceDef => Boolean(item));
      const pipelines = area.pipelineIds
        .map((id) => pipelineById.get(id))
        .filter((item): item is PipelineDef => Boolean(item));
      for (const equipmentItem of equipment) byEquipmentId.set(equipmentItem.id, area.id);
      for (const pipeline of pipelines) byPipelineId.set(pipeline.id, area.id);

      const entryPipelines = adjacency.filter((link) => link.to === area.id).flatMap((link) =>
        link.pipelineIds.map((id) => pipelineById.get(id)).filter((item): item is PipelineDef => Boolean(item))
      );
      const exitPipelines = adjacency.filter((link) => link.from === area.id).flatMap((link) =>
        link.pipelineIds.map((id) => pipelineById.get(id)).filter((item): item is PipelineDef => Boolean(item))
      );
      entryPipelineCount += entryPipelines.length;
      exitPipelineCount += exitPipelines.length;

      const processPort = (equipmentId: string, portId: string): AreaPortRef | null => {
        const equipmentDef = equipmentById.get(equipmentId);
        const portDef = equipmentDef?.ports.find((port) => port.id === portId);
        if (!equipmentDef || !portDef) return null;
        return {
          equipmentId,
          equipmentName: equipmentDef.name,
          portId,
          portName: portDef.name,
          role: portDef.role,
          boundary: Boolean(portDef.boundary),
          dataStatus: portDef.dataStatus ?? 'teaching-demo'
        };
      };
      const entryPorts: AreaPortRef[] = [];
      for (const pipeline of entryPipelines) {
        const port = processPort(pipeline.to.equipment, pipeline.to.port);
        if (port) entryPorts.push(port);
      }
      const exitPorts: AreaPortRef[] = [];
      for (const pipeline of exitPipelines) {
        const port = processPort(pipeline.from.equipment, pipeline.from.port);
        if (port) exitPorts.push(port);
      }
      for (const equipmentItem of equipment) {
        for (const port of equipmentItem.ports) {
          if (!port.boundary) continue;
          boundaryPortCount += 1;
          const ref = processPort(equipmentItem.id, port.id);
          if (!ref) continue;
          if (port.role === 'in' || port.role === 'both') entryPorts.push(ref);
          if (port.role === 'out' || port.role === 'both') exitPorts.push(ref);
        }
      }
      if (!area.upstreamAreaIds.length && !entryPorts.some((port) => port.boundary)) {
        errors.push(issue('error', 'AREA_ROOT_NO_BOUNDARY_IN', `首端区域 ${area.id} 没有流程边界入口`, [area.id]));
      }
      if (!area.downstreamAreaIds.length && !exitPorts.some((port) => port.boundary)) {
        errors.push(issue('error', 'AREA_LEAF_NO_BOUNDARY_OUT', `末端区域 ${area.id} 没有流程边界出口`, [area.id]));
      }
      if (area.upstreamAreaIds.length > 0 && entryPipelines.length === 0) {
        errors.push(issue('error', 'AREA_ENTRY_MISSING', `区域 ${area.id} 声明有上游，但没有入口管线`, [area.id]));
      }
      if (area.downstreamAreaIds.length > 0 && exitPipelines.length === 0) {
        errors.push(issue('error', 'AREA_EXIT_MISSING', `区域 ${area.id} 声明有下游，但没有出口管线`, [area.id]));
      }

      const boxes = equipment
        .map((item) => worldEquipmentById.get(item.id)?.modelBox)
        .filter((box): box is { min: Vec3; max: Vec3 } => Boolean(box));
      if (boxes.length !== equipment.length) {
        errors.push(issue('error', 'AREA_EQUIPMENT_BOX_MISSING', `区域 ${area.id} 有设备缺少教学模型包络，无法建立三维范围`, [area.id]));
      }
      const bounds = unionBounds(boxes, this.options.padding);
      if (!bounds) {
        errors.push(issue('error', 'AREA_BOUNDS_MISSING', `区域 ${area.id} 无法建立三维范围`, [area.id]));
      } else {
        for (const box of boxes) {
          if (!boundsContain(bounds, box)) {
            errors.push(issue('error', 'AREA_BOUNDS_NOT_CONTAIN', `区域 ${area.id} 的三维范围未包含其设备包络`, [area.id]));
          }
        }
      }

      const mediaIds = [...new Set(pipelines.map((pipeline) => pipeline.medium))];
      areaModels.push({
        def: area,
        equipment,
        pipelines,
        mediaIds,
        flowStreamIds: area.flowStreamIds,
        upstreamAreaIds: area.upstreamAreaIds,
        downstreamAreaIds: area.downstreamAreaIds,
        entryPipelines,
        exitPipelines,
        entryPorts,
        exitPorts,
        bounds
      });
    }
    const boundsAreas = areaModels.filter((model) => model.bounds);
    for (let i = 0; i < boundsAreas.length; i += 1) {
      for (let j = i + 1; j < boundsAreas.length; j += 1) {
        if (boundsOverlap(boundsAreas[i].bounds!, boundsAreas[j].bounds!)) {
          errors.push(
            issue(
              'error',
              'AREA_BOUNDS_OVERLAP',
              `区域 ${boundsAreas[i].def.id} 与 ${boundsAreas[j].def.id} 的三维范围重叠，无法做区域分层`,
              [boundsAreas[i].def.id, boundsAreas[j].def.id]
            )
          );
        }
      }
    }

    /* ---------- 教学说明与缺口引用 ---------- */
    let teachingCount = 0;
    for (const area of process.areas) {
      const required = [
        area.description,
        area.function,
        area.input,
        area.process,
        area.output,
        area.boundsNote,
        area.teaching?.objective,
        area.teaching?.effect,
        area.teaching?.relation,
        area.teaching?.pendingNote
      ];
      if (required.some((value) => !hasText(value))) {
        errors.push(issue('error', 'AREA_TEACHING_MISSING', `区域 ${area.id} 的说明/教学字段不完整`, [area.id]));
      } else {
        teachingCount += 1;
      }
      for (const gapId of area.gapIds) {
        if (!gapById.has(gapId)) {
          errors.push(issue('error', 'AREA_GAP_UNKNOWN', `区域 ${area.id} 引用了不存在的缺口 ${gapId}`, [area.id, gapId]));
        }
      }
      if (area.dataStatus === 'pending-confirmation') {
        warnings.push(issue('warning', 'AREA_PENDING', `区域 ${area.id} 含待确认工艺信息，界面必须标注`, [area.id]));
      }
    }

    /* ---------- 四根喷枪：二燃室的四个独立平行支路 ---------- */
    const guns = process.equipment.filter((equipment) => equipment.modelKey === 'spray-gun');
    if (guns.length !== this.options.expectedSprayGuns) {
      errors.push(
        issue(
          'error',
          'SPRAY_GUN_COUNT',
          `喷枪实例数量应为 ${this.options.expectedSprayGuns}，实际为 ${guns.length}`,
          guns.map((gun) => gun.id)
        )
      );
    }
    const gunIds = new Set(guns.map((gun) => gun.id));
    let sprayGunBranches = 0;
    for (const gun of guns) {
      if (gun.areaId !== COMBUSTION_AREA) {
        errors.push(issue('error', 'SPRAY_GUN_AREA', `喷枪 ${gun.id} 不在燃烧处理区，实际为 ${gun.areaId}`, [gun.id]));
      }
      if (!gun.parentEquipmentId) {
        errors.push(issue('error', 'SPRAY_GUN_PARENT_MISSING', `喷枪 ${gun.id} 未挂到二燃室支路`, [gun.id]));
        continue;
      }
      if (gun.parentEquipmentId !== this.options.sprayGunParentId) {
        errors.push(
          issue('error', 'SPRAY_GUN_PARENT', `喷枪 ${gun.id} 挂接到 ${gun.parentEquipmentId}，应为 ${this.options.sprayGunParentId}`, [gun.id])
        );
      }
      if (gunIds.has(gun.parentEquipmentId)) {
        errors.push(issue('error', 'SPRAY_GUN_SERIAL_PARENT', `喷枪 ${gun.id} 不能挂在另一根喷枪下`, [gun.id]));
      }
      if (gun.relationKind !== 'parallel-branch') {
        errors.push(issue('error', 'SPRAY_GUN_KIND', `喷枪 ${gun.id} 应建模为平行支路（parallel-branch）`, [gun.id]));
      }
      const parent = equipmentById.get(gun.parentEquipmentId);
      if (!parent) {
        errors.push(issue('error', 'SPRAY_GUN_PARENT_UNKNOWN', `喷枪 ${gun.id} 的父设备 ${gun.parentEquipmentId} 不存在`, [gun.id]));
      } else {
        if (parent.id !== this.options.sprayGunParentId) {
          errors.push(issue('error', 'SPRAY_GUN_PARENT', `喷枪 ${gun.id} 应挂到二燃室`, [gun.id]));
        }
        if (parent.areaId !== COMBUSTION_AREA) {
          errors.push(issue('error', 'SPRAY_GUN_PARENT_AREA', `喷枪 ${gun.id} 的父设备不在燃烧处理区`, [gun.id]));
        }
      }
      if (gun.relationStatus === 'pending-confirmation') {
        warnings.push(issue('warning', 'SPRAY_GUN_BRANCH_PENDING', `喷枪 ${gun.id} 已按平行支路挂接，但接入位置/介质仍待确认`, [gun.id]));
      }
      sprayGunBranches += 1;
    }
    for (const pipeline of process.pipelines) {
      if (gunIds.has(pipeline.from.equipment) && gunIds.has(pipeline.to.equipment)) {
        errors.push(issue('error', 'SPRAY_GUN_SERIES', `喷枪被串成连续节点：${pipeline.id}`, [pipeline.id]));
      }
    }
    for (const stream of process.flowStreams) {
      for (const equipmentId of stream.equipmentSequence) {
        if (!gunIds.has(equipmentId)) continue;
        const gun = equipmentById.get(equipmentId);
        if (gun?.relationStatus === 'pending-confirmation') {
          errors.push(
            issue('error', 'SPRAY_GUN_IN_STREAM', `已标待确认的喷枪 ${equipmentId} 不应进入主流线 ${stream.id}`, [equipmentId, stream.id])
          );
        }
      }
    }

    const counts: ProcessAreaValidationCounts = {
      areas: process.areas.length,
      equipment: process.equipment.length,
      pipelines: process.pipelines.length,
      links: adjacency.length,
      entryPipelines: entryPipelineCount,
      exitPipelines: exitPipelineCount,
      boundaryPorts: boundaryPortCount,
      media: process.media.length,
      flowStreams: process.flowStreams.length,
      bounds: boundsAreas.length,
      teaching: teachingCount,
      sprayGuns: guns.length,
      sprayGunBranches
    };

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      counts,
      areas: areaModels,
      adjacency,
      byEquipmentId,
      byPipelineId
    };
  }
}

export function validateProcessAreas(
  process: ProcessDefinition,
  world: PipingWorld,
  options: ProcessAreaValidationOptions = {}
): ProcessAreaValidation {
  return new ProcessAreaValidator(process, world, options).validate();
}
