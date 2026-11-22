/**
 * 工业管道教学示意路由与穿模校验（Phase 3）。
 *
 * 纯数据/几何计算，不依赖 DOM 与 Three.js：
 * - 根据设备教学布局、模型接口锚点与包围盒生成世界接口坐标；
 * - 为每条拓扑管线生成正交候选路由（端口法线定向 + 阶梯/管廊车道），
 *   按长度与弯头数择优，并用简化设备避让盒做穿模检查；
 * - 生成端部法兰、教学示意阀与支架落点，并校验支架不落在设备包络内；
 * - 所有坐标、车道、阀/支架位置均为教学示意，不是工程坐标或管道设计。
 */

import type {
  DataStatus,
  PipeSizeClass,
  PipelineDef,
  ProcessDefinition
} from '../data/processTypes';
import type { Vec3 } from '../data/types';
import {
  BOIL_KEEPOUTS,
  BOIL_LAYOUT,
  type EquipmentPlacementDef,
  type LocalKeepoutBoxDef
} from '../data/boilLayout';
import type { ProcessValidationIssue } from './validate';

export interface PipeSizeSpec {
  id: PipeSizeClass;
  label: string;
  radius: number;
  flange: number;
  note: string;
}

/** 与 boilModels 的接管等级保持一致（教学示意口径）。 */
export const BOIL_PIPE_SIZES: Record<PipeSizeClass, PipeSizeSpec> = {
  main: { id: 'main', label: '主工艺管线', radius: 0.09, flange: 0.17, note: '主工艺等级（教学示意口径，非工程管径）' },
  branch: { id: 'branch', label: '支管', radius: 0.07, flange: 0.14, note: '支管等级（教学示意口径，非工程管径）' },
  utility: { id: 'utility', label: '公用工程管线', radius: 0.055, flange: 0.11, note: '公用工程等级（教学示意口径，非工程管径）' }
};

export interface PipingModelPortSpec {
  id: string;
  pos: Vec3;
  dir: Vec3;
  size: PipeSizeClass;
  role: 'in' | 'out' | 'both';
  media: string[];
  boundary?: boolean;
}

export interface PipingModelSpec {
  key: string;
  bbox: { min: Vec3; max: Vec3 };
  ports: PipingModelPortSpec[];
}

export type PipingModelResolver = (key: string) => PipingModelSpec | undefined;

export interface PipingWorldPort {
  equipmentId: string;
  equipmentName: string;
  portId: string;
  modelPortId: string;
  world: Vec3;
  dir: Vec3;
  size: PipeSizeClass;
  role: 'in' | 'out' | 'both';
  media: string[];
  boundary: boolean;
  dataStatus: DataStatus;
}

export interface PipingWorldKeepout {
  equipmentId: string;
  label: string;
  min: Vec3;
  max: Vec3;
}

export interface PipingEquipmentWorld {
  equipmentId: string;
  name: string;
  modelKey: string;
  position: Vec3;
  rotationY: number;
  /** 模型归一化偏移（x/z 居中、y 落地）。 */
  modelOffset: Vec3;
  /** 模型世界包围盒（含接管法兰）。 */
  modelBox: { min: Vec3; max: Vec3 };
  keepouts: PipingWorldKeepout[];
}

export interface PipingWorld {
  equipment: PipingEquipmentWorld[];
  ports: PipingWorldPort[];
  keepouts: PipingWorldKeepout[];
  errors: ProcessValidationIssue[];
}

export interface RouteSegment {
  index: number;
  from: Vec3;
  to: Vec3;
  length: number;
  axis: 0 | 1 | 2;
  dir: Vec3;
  horizontal: boolean;
}

export interface RouteBend {
  index: number;
  point: Vec3;
  inDir: Vec3;
  outDir: Vec3;
  radius: number;
}

export interface RouteValve {
  id: string;
  kind: 'gate' | 'butterfly';
  point: Vec3;
  axis: Vec3;
  segmentIndex: number;
  dataStatus: DataStatus;
  note: string;
}

export interface RouteSupport {
  id: string;
  point: Vec3;
  segmentIndex: number;
}

export interface RouteTerminalFlange {
  point: Vec3;
  axis: Vec3;
  portKey: string;
}

export interface PipeRouteResult {
  pipelineId: string;
  name: string;
  medium: string;
  size: PipeSizeClass;
  fromPortKey: string;
  toPortKey: string;
  points: Vec3[];
  segments: RouteSegment[];
  bends: RouteBend[];
  valves: RouteValve[];
  supports: RouteSupport[];
  terminalFlanges: RouteTerminalFlange[];
  length: number;
  skippedValveReason?: string;
}

export interface PipingValidationCounts {
  equipment: number;
  placements: number;
  worldPorts: number;
  connectedPorts: number;
  boundaryPorts: number;
  pendingPorts: number;
  routedPipelines: number;
  routedPorts: number;
  terminalFlanges: number;
  straightSegments: number;
  elbows: number;
  valves: number;
  supports: number;
  tees: number;
  reducers: number;
  collisions: number;
  equipmentOverlaps: number;
  supportConflicts: number;
  sizesUsed: number;
  routeLength: number;
}

export interface PipingExpectations {
  equipment?: number;
  placements?: number;
  worldPorts?: number;
  connectedPorts?: number;
  boundaryPorts?: number;
  pendingPorts?: number;
  routedPipelines?: number;
  routedPorts?: number;
  terminalFlanges?: number;
  elbows?: number;
  valves?: number;
  minSupports?: number;
  collisions?: number;
  equipmentOverlaps?: number;
  supportConflicts?: number;
}

export interface PipingValidation {
  ok: boolean;
  world: PipingWorld;
  routes: PipeRouteResult[];
  errors: ProcessValidationIssue[];
  warnings: ProcessValidationIssue[];
  counts: PipingValidationCounts;
}

const PORT_STUB = 0.75;
const CLEARANCE = 0.3;
const MIN_SEGMENT = 0.15;
const VALVE_MIN_SEGMENT = 0.7;
const VALVE_HALF_LENGTH = 0.32;
const SUPPORT_STEP_FALLBACK = 4.5;
const BEND_FACTOR = 3.2;

function issue(level: 'error' | 'warning', code: string, message: string, refs: string[] = []): ProcessValidationIssue {
  return { level, code, message, refs };
}

function v(x: number, y: number, z: number): Vec3 {
  return [x, y, z];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function lengthOf(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function distance(a: Vec3, b: Vec3): number {
  return lengthOf(sub(a, b));
}

function normalize(a: Vec3): Vec3 {
  const len = lengthOf(a);
  if (len < 1e-9) return [0, 0, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function close(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

function samePoint(a: Vec3, b: Vec3, eps = 1e-6): boolean {
  return close(a[0], b[0], eps) && close(a[1], b[1], eps) && close(a[2], b[2], eps);
}

function roundPoint(p: Vec3): Vec3 {
  return [Number(p[0].toFixed(4)), Number(p[1].toFixed(4)), Number(p[2].toFixed(4))];
}

function rotateYPoint(p: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

function applyPlacement(local: Vec3, offset: Vec3, placement: EquipmentPlacementDef): Vec3 {
  const normalized = add(local, offset);
  const rotated = rotateYPoint(normalized, placement.rotationY);
  return add(rotated, placement.position);
}

function applyPlacementDir(localDir: Vec3, placement: EquipmentPlacementDef): Vec3 {
  return normalize(rotateYPoint(localDir, placement.rotationY));
}

function boxCorners(min: Vec3, max: Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) out.push([x, y, z]);
    }
  }
  return out;
}

function boxFromPoints(points: Vec3[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p[i]);
      max[i] = Math.max(max[i], p[i]);
    }
  }
  return { min, max };
}

function transformBox(
  localMin: Vec3,
  localMax: Vec3,
  offset: Vec3,
  placement: EquipmentPlacementDef
): { min: Vec3; max: Vec3 } {
  return boxFromPoints(boxCorners(localMin, localMax).map((p) => applyPlacement(p, offset, placement)));
}

function pointInBox(p: Vec3, min: Vec3, max: Vec3, inflate = 0): boolean {
  return p[0] >= min[0] - inflate && p[0] <= max[0] + inflate &&
    p[1] >= min[1] - inflate && p[1] <= max[1] + inflate &&
    p[2] >= min[2] - inflate && p[2] <= max[2] + inflate;
}

function pointInBoxXZ(p: Vec3, min: Vec3, max: Vec3, inflate = 0): boolean {
  return p[0] >= min[0] - inflate && p[0] <= max[0] + inflate &&
    p[2] >= min[2] - inflate && p[2] <= max[2] + inflate;
}

function boxesOverlap(aMin: Vec3, aMax: Vec3, bMin: Vec3, bMax: Vec3, inflate = 0): boolean {
  return aMin[0] <= bMax[0] + inflate && aMax[0] >= bMin[0] - inflate &&
    aMin[1] <= bMax[1] + inflate && aMax[1] >= bMin[1] - inflate &&
    aMin[2] <= bMax[2] + inflate && aMax[2] >= bMin[2] - inflate;
}

function segmentIntersectsBox(a: Vec3, b: Vec3, min: Vec3, max: Vec3, inflate = 0): boolean {
  const mn: Vec3 = [min[0] - inflate, min[1] - inflate, min[2] - inflate];
  const mx: Vec3 = [max[0] + inflate, max[1] + inflate, max[2] + inflate];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 3; i++) {
    const d = b[i] - a[i];
    if (Math.abs(d) < 1e-9) {
      if (a[i] < mn[i] || a[i] > mx[i]) return false;
      continue;
    }
    let ta = (mn[i] - a[i]) / d;
    let tb = (mx[i] - a[i]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

function modelOffset(bbox: { min: Vec3; max: Vec3 }): Vec3 {
  return [-(bbox.min[0] + bbox.max[0]) / 2, -bbox.min[1], -(bbox.min[2] + bbox.max[2]) / 2];
}

function isAxisAligned(a: Vec3, b: Vec3): boolean {
  const d = sub(b, a);
  const nz = [Math.abs(d[0]) > 1e-6, Math.abs(d[1]) > 1e-6, Math.abs(d[2]) > 1e-6].filter(Boolean).length;
  return nz === 1;
}

function cleanPath(points: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || !samePoint(last, p)) out.push(p);
  }
  let changed = true;
  while (changed && out.length > 2) {
    changed = false;
    for (let i = 1; i < out.length - 1; i++) {
      const d1 = sub(out[i], out[i - 1]);
      const d2 = sub(out[i + 1], out[i]);
      const n1 = normalize(d1);
      const n2 = normalize(d2);
      const cross: Vec3 = [
        n1[1] * n2[2] - n1[2] * n2[1],
        n1[2] * n2[0] - n1[0] * n2[2],
        n1[0] * n2[1] - n1[1] * n2[0]
      ];
      if (lengthOf(cross) < 1e-6 && dot(n1, n2) > 0) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

function buildSegments(points: Vec3[]): RouteSegment[] | null {
  const segments: RouteSegment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const from = points[i];
    const to = points[i + 1];
    if (!isAxisAligned(from, to)) return null;
    const delta = sub(to, from);
    const len = lengthOf(delta);
    if (len < MIN_SEGMENT) return null;
    const axis: 0 | 1 | 2 = Math.abs(delta[0]) > 1e-6 ? 0 : Math.abs(delta[1]) > 1e-6 ? 1 : 2;
    const dir = normalize(delta);
    segments.push({ index: i, from, to, length: len, axis, dir, horizontal: axis !== 1 });
  }
  return segments;
}

function staircase(p1: Vec3, p2: Vec3, order: (0 | 1 | 2)[]): Vec3[] {
  const cur: Vec3 = [p1[0], p1[1], p1[2]];
  const out: Vec3[] = [p1];
  for (const axis of order) {
    if (!close(cur[axis], p2[axis])) {
      cur[axis] = p2[axis];
      out.push([cur[0], cur[1], cur[2]]);
    }
  }
  if (!samePoint(out[out.length - 1], p2)) out.push(p2);
  return out;
}

interface RouteContext {
  a: Vec3;
  b: Vec3;
  p1: Vec3;
  p2: Vec3;
  fromDir: Vec3;
  toDir: Vec3;
  fromEquipment: string;
  toEquipment: string;
  keepouts: PipingWorldKeepout[];
  pipeRadius: number;
}

function evaluateCandidate(points: Vec3[], ctx: RouteContext): { points: Vec3[]; segments: RouteSegment[]; length: number } | null {
  const cleaned = cleanPath(points);
  const segments = buildSegments(cleaned);
  if (!segments || segments.length === 0) return null;
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (dot(first.dir, ctx.fromDir) < 0.999) return null;
  if (dot(last.dir, ctx.toDir) > -0.999) return null;
  for (const seg of segments) {
    for (const keepout of ctx.keepouts) {
      const isFirstOwner = seg.index === 0 && keepout.equipmentId === ctx.fromEquipment;
      const isLastOwner = seg.index === segments.length - 1 && keepout.equipmentId === ctx.toEquipment;
      if (isFirstOwner || isLastOwner) continue;
      if (segmentIntersectsBox(seg.from, seg.to, keepout.min, keepout.max, CLEARANCE)) return null;
    }
  }
  const length = segments.reduce((sum, seg) => sum + seg.length, 0);
  return { points: cleaned, segments, length };
}

function buildBends(points: Vec3[], pipeRadius: number): RouteBend[] {
  const bends: RouteBend[] = [];
  for (let i = 1; i + 1 < points.length; i++) {
    const inDir = normalize(sub(points[i], points[i - 1]));
    const outDir = normalize(sub(points[i + 1], points[i]));
    const prevLen = distance(points[i - 1], points[i]);
    const nextLen = distance(points[i], points[i + 1]);
    const radius = Math.max(0.1, Math.min(pipeRadius * BEND_FACTOR, prevLen / 2 - 0.02, nextLen / 2 - 0.02, 0.55));
    bends.push({ index: i, point: points[i], inDir, outDir, radius });
  }
  return bends;
}

function generateCandidates(ctx: RouteContext): Vec3[][] {
  const { a, b, p1, p2 } = ctx;
  const candidates: Vec3[][] = [];
  const orders: (0 | 1 | 2)[][] = [
    [0, 2, 1], [0, 1, 2], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]
  ];
  for (const order of orders) {
    candidates.push([a, ...staircase(p1, p2, order), b]);
  }
  const fromTop = Math.max(...ctx.keepouts.filter((k) => k.equipmentId === ctx.fromEquipment).map((k) => k.max[1]), 0);
  const toTop = Math.max(...ctx.keepouts.filter((k) => k.equipmentId === ctx.toEquipment).map((k) => k.max[1]), 0);
  const maxTop = Math.max(...ctx.keepouts.map((k) => k.max[1]), 0);
  const minZ = Math.min(...ctx.keepouts.map((k) => k.min[2]), 0);
  const midLaneY = Math.max(ctx.a[1], ctx.b[1], fromTop, toTop) + 0.9;
  const safeLaneY = maxTop + 0.8;
  const zCorridor = minZ - 2.5;
  const laneYs = [...new Set([midLaneY, safeLaneY].map((y) => Number(y.toFixed(3))))];
  for (const laneY of laneYs) {
    const rise1: Vec3 = [p1[0], laneY, p1[2]];
    const drop2: Vec3 = [p2[0], laneY, p2[2]];
    candidates.push([a, p1, rise1, [p2[0], laneY, p1[2]], drop2, p2, b]);
    candidates.push([a, p1, rise1, [p1[0], laneY, p2[2]], drop2, p2, b]);
    candidates.push([a, p1, rise1, [p1[0], laneY, zCorridor], [p2[0], laneY, zCorridor], drop2, p2, b]);
  }
  return candidates;
}

function chooseRoute(pipe: PipelineDef, ctx: RouteContext): { points: Vec3[]; segments: RouteSegment[]; length: number } | null {
  let best: { points: Vec3[]; segments: RouteSegment[]; length: number } | null = null;
  let bestScore = Infinity;
  for (const candidate of generateCandidates(ctx)) {
    const evaluated = evaluateCandidate(candidate, ctx);
    if (!evaluated) continue;
    const score = evaluated.length + Math.max(0, evaluated.segments.length - 1) * 0.18;
    if (score < bestScore) {
      bestScore = score;
      best = evaluated;
    }
  }
  return best;
}

function placeValve(
  pipe: PipelineDef,
  segments: RouteSegment[],
  keepouts: PipingWorldKeepout[],
  warnings: ProcessValidationIssue[]
): RouteValve | null {
  const route = pipe.route;
  if (!route) return null;
  const eligible = segments
    .map((seg, index) => ({ seg, index }))
    .filter(({ seg, index }) => {
      if (seg.length < VALVE_MIN_SEGMENT) return false;
      const midway = add(seg.from, scale(seg.dir, seg.length / 2));
      if (keepouts.some((k) => pointInBox(midway, k.min, k.max, 0.18))) return false;
      const a = add(midway, scale(seg.dir, -VALVE_HALF_LENGTH));
      const b = add(midway, scale(seg.dir, VALVE_HALF_LENGTH));
      if (keepouts.some((k) => pointInBox(a, k.min, k.max, 0.1) || pointInBox(b, k.min, k.max, 0.1))) return false;
      if (index === 0 || index === segments.length - 1) {
        if (seg.length < VALVE_MIN_SEGMENT + VALVE_HALF_LENGTH * 2) return false;
      }
      return true;
    });
  eligible.sort((x, y) => {
    const xMiddle = x.index > 0 && x.index < segments.length - 1 ? 0 : 1;
    const yMiddle = y.index > 0 && y.index < segments.length - 1 ? 0 : 1;
    if (xMiddle !== yMiddle) return xMiddle - yMiddle;
    return y.seg.length - x.seg.length;
  });
  if (eligible.length === 0) {
    warnings.push(issue('warning', 'VALVE_SKIPPED', `管线 ${pipe.id} 没有满足间隙要求的管段，未放置教学示意阀`, [pipe.id]));
    return null;
  }
  const chosen = eligible[0];
  const point = add(chosen.seg.from, scale(chosen.seg.dir, chosen.seg.length / 2));
  return {
    id: `valve-${pipe.id}`,
    kind: route.valve.kind,
    point: roundPoint(point),
    axis: chosen.seg.dir,
    segmentIndex: chosen.index,
    dataStatus: route.valve.dataStatus,
    note: route.valve.note
  };
}

function placeSupports(
  pipe: PipelineDef,
  segments: RouteSegment[],
  valve: RouteValve | null,
  keepouts: PipingWorldKeepout[]
): RouteSupport[] {
  const supports: RouteSupport[] = [];
  const maxSpacing = pipe.route?.supportMaxSpacing ?? SUPPORT_STEP_FALLBACK;
  const used = new Set<string>();
  let counter = 0;
  for (const seg of segments) {
    if (!seg.horizontal || seg.length < 1.2) continue;
    const span = seg.length - 1.0;
    const count = Math.max(1, Math.ceil(span / maxSpacing));
    for (let i = 0; i <= count; i++) {
      const s = 0.5 + (span * i) / count;
      if (s < 0.3 || s > seg.length - 0.3) continue;
      const point = add(seg.from, scale(seg.dir, s));
      if (valve && distance(point, valve.point) < 0.7) continue;
      if (keepouts.some((k) => pointInBoxXZ(point, k.min, k.max, 0.12))) continue;
      const key = `${point[0].toFixed(1)}|${point[2].toFixed(1)}|${point[1].toFixed(1)}`;
      if (used.has(key)) continue;
      used.add(key);
      counter += 1;
      supports.push({ id: `support-${pipe.id}-${counter}`, point: roundPoint(point), segmentIndex: seg.index });
    }
  }
  return supports;
}

export function buildPipingWorld(
  process: ProcessDefinition,
  resolveModel: PipingModelResolver,
  placements: EquipmentPlacementDef[] = BOIL_LAYOUT,
  keepoutDefs: Record<string, LocalKeepoutBoxDef[]> = BOIL_KEEPOUTS
): PipingWorld {
  const errors: ProcessValidationIssue[] = [];
  const equipmentIds = new Set(process.equipment.map((e) => e.id));
  const byId = new Map<string, EquipmentPlacementDef>();
  for (const placement of placements) {
    if (!equipmentIds.has(placement.equipmentId)) {
      errors.push(issue('error', 'PLACEMENT_UNKNOWN', `教学布局引用了不存在的设备 ${placement.equipmentId}`, [placement.equipmentId]));
      continue;
    }
    if (byId.has(placement.equipmentId)) {
      errors.push(issue('error', 'PLACEMENT_DUP', `设备 ${placement.equipmentId} 存在重复教学布局`, [placement.equipmentId]));
      continue;
    }
    byId.set(placement.equipmentId, placement);
  }

  const equipment: PipingEquipmentWorld[] = [];
  const ports: PipingWorldPort[] = [];
  const keepouts: PipingWorldKeepout[] = [];

  for (const eq of process.equipment) {
    const placement = byId.get(eq.id);
    if (!placement) {
      errors.push(issue('error', 'PLACEMENT_MISSING', `设备 ${eq.id} 缺少教学布局`, [eq.id]));
      continue;
    }
    const modelKey = eq.modelKey ?? '';
    const spec = modelKey ? resolveModel(modelKey) : undefined;
    if (!spec) {
      errors.push(issue('error', 'MODEL_SPEC_MISSING', `设备 ${eq.id} 的模型 ${modelKey || '(空)'} 缺少几何规格`, [eq.id, modelKey]));
      continue;
    }
    const offset = modelOffset(spec.bbox);
    const modelBox = transformBox(spec.bbox.min, spec.bbox.max, offset, placement);
    const defs = keepoutDefs[modelKey];
    const localKeepouts: PipingWorldKeepout[] = [];
    if (!defs || defs.length === 0) {
      errors.push(issue('error', 'KEEPOUT_MISSING', `设备 ${eq.id} 的模型 ${modelKey} 缺少教学避让盒`, [eq.id, modelKey]));
    } else {
      for (const def of defs) {
        const world = transformBox(def.min, def.max, offset, placement);
        const entry: PipingWorldKeepout = { equipmentId: eq.id, label: def.label, min: world.min, max: world.max };
        localKeepouts.push(entry);
        keepouts.push(entry);
      }
    }

    for (const port of eq.ports) {
      const modelPortId = port.modelPortId ?? port.id;
      const mp = spec.ports.find((candidate) => candidate.id === modelPortId);
      if (!mp) {
        errors.push(issue('error', 'PORT_WORLD_MISSING', `设备 ${eq.id}.${port.id} 在模型 ${modelKey} 中没有接口锚点`, [eq.id, port.id]));
        continue;
      }
      ports.push({
        equipmentId: eq.id,
        equipmentName: eq.name,
        portId: port.id,
        modelPortId,
        world: roundPoint(applyPlacement(mp.pos, offset, placement)),
        dir: applyPlacementDir(mp.dir, placement),
        size: mp.size,
        role: mp.role,
        media: mp.media,
        boundary: Boolean(port.boundary),
        dataStatus: port.dataStatus
      });
    }

    equipment.push({
      equipmentId: eq.id,
      name: eq.name,
      modelKey,
      position: placement.position,
      rotationY: placement.rotationY,
      modelOffset: offset,
      modelBox,
      keepouts: localKeepouts
    });
  }

  return { equipment, ports, keepouts, errors };
}

function portKey(equipmentId: string, portId: string): string {
  return `${equipmentId}.${portId}`;
}

export function validatePiping(
  process: ProcessDefinition,
  resolveModel: PipingModelResolver,
  expectations: PipingExpectations = {},
  placements: EquipmentPlacementDef[] = BOIL_LAYOUT,
  keepoutDefs: Record<string, LocalKeepoutBoxDef[]> = BOIL_KEEPOUTS
): PipingValidation {
  const errors: ProcessValidationIssue[] = [];
  const warnings: ProcessValidationIssue[] = [];
  const world = buildPipingWorld(process, resolveModel, placements, keepoutDefs);
  errors.push(...world.errors);

  const portWorld = new Map<string, PipingWorldPort>();
  for (const port of world.ports) portWorld.set(portKey(port.equipmentId, port.portId), port);

  const routes: PipeRouteResult[] = [];
  let collisions = 0;
  let supportConflicts = 0;

  for (const pipe of process.pipelines) {
    if (!pipe.route) {
      errors.push(issue('error', 'ROUTE_MISSING', `管线 ${pipe.id} 缺少 Phase 3 教学示意路由配置`, [pipe.id]));
      continue;
    }
    const sizeDef = BOIL_PIPE_SIZES[pipe.route.size];
    if (!sizeDef) {
      errors.push(issue('error', 'ROUTE_SIZE', `管线 ${pipe.id} 的管径等级无效：${String(pipe.route.size)}`, [pipe.id]));
      continue;
    }
    if (pipe.route.valve.kind !== 'gate' && pipe.route.valve.kind !== 'butterfly') {
      errors.push(issue('error', 'VALVE_KIND', `管线 ${pipe.id} 的示意阀类型无效：${String(pipe.route.valve.kind)}`, [pipe.id]));
    }
    if (!(pipe.route.supportMaxSpacing > 0)) {
      errors.push(issue('error', 'SUPPORT_SPACING', `管线 ${pipe.id} 的支架间距上限无效`, [pipe.id]));
    }
    const fromPort = portWorld.get(portKey(pipe.from.equipment, pipe.from.port));
    const toPort = portWorld.get(portKey(pipe.to.equipment, pipe.to.port));
    if (!fromPort || !toPort) {
      errors.push(issue('error', 'ROUTE_PORT', `管线 ${pipe.id} 的端点接口缺少世界坐标`, [pipe.id]));
      continue;
    }
    if (fromPort.size !== pipe.route.size) {
      errors.push(issue('error', 'ROUTE_SIZE_FROM', `管线 ${pipe.id} 管径 ${pipe.route.size} 与起点接口 ${fromPort.size} 不一致（不虚构变径）`, [pipe.id]));
    }
    if (toPort.size !== pipe.route.size) {
      errors.push(issue('error', 'ROUTE_SIZE_TO', `管线 ${pipe.id} 管径 ${pipe.route.size} 与终点接口 ${toPort.size} 不一致（不虚构变径）`, [pipe.id]));
    }

    const a = fromPort.world;
    const b = toPort.world;
    const ctx: RouteContext = {
      a,
      b,
      p1: add(a, scale(fromPort.dir, PORT_STUB)),
      p2: add(b, scale(toPort.dir, PORT_STUB)),
      fromDir: fromPort.dir,
      toDir: toPort.dir,
      fromEquipment: pipe.from.equipment,
      toEquipment: pipe.to.equipment,
      keepouts: world.keepouts,
      pipeRadius: sizeDef.radius
    };
    const chosen = chooseRoute(pipe, ctx);
    if (!chosen) {
      collisions += 1;
      errors.push(issue('error', 'ROUTE_UNRESOLVED', `管线 ${pipe.id} 没有找到避开设备包络的正交路由`, [pipe.id]));
      continue;
    }
    const bends = buildBends(chosen.points, sizeDef.radius);
    const valve = placeValve(pipe, chosen.segments, world.keepouts, warnings);
    const supports = placeSupports(pipe, chosen.segments, valve, world.keepouts);
    for (const support of supports) {
      if (world.keepouts.some((k) => pointInBoxXZ(support.point, k.min, k.max, 0.12))) {
        supportConflicts += 1;
        errors.push(issue('error', 'SUPPORT_CONFLICT', `管线 ${pipe.id} 的支架 ${support.id} 落在设备避让盒内`, [pipe.id, support.id]));
      }
    }
    routes.push({
      pipelineId: pipe.id,
      name: pipe.name,
      medium: pipe.medium,
      size: pipe.route.size,
      fromPortKey: portKey(pipe.from.equipment, pipe.from.port),
      toPortKey: portKey(pipe.to.equipment, pipe.to.port),
      points: chosen.points.map(roundPoint),
      segments: chosen.segments.map((seg) => ({ ...seg, from: roundPoint(seg.from), to: roundPoint(seg.to) })),
      bends,
      valves: valve ? [valve] : [],
      supports,
      terminalFlanges: [
        { point: roundPoint(a), axis: fromPort.dir, portKey: portKey(pipe.from.equipment, pipe.from.port) },
        { point: roundPoint(b), axis: toPort.dir, portKey: portKey(pipe.to.equipment, pipe.to.port) }
      ],
      length: chosen.length,
      skippedValveReason: valve ? undefined : '没有满足间隙要求的管段'
    });
  }

  const routedPortKeys = new Set<string>();
  for (const route of routes) {
    routedPortKeys.add(route.fromPortKey);
    routedPortKeys.add(route.toPortKey);
  }
  let connectedPorts = 0;
  let boundaryPorts = 0;
  let pendingPorts = 0;
  for (const port of world.ports) {
    const key = portKey(port.equipmentId, port.portId);
    if (routedPortKeys.has(key)) connectedPorts += 1;
    else if (port.boundary) boundaryPorts += 1;
    else if (port.dataStatus === 'pending-confirmation') pendingPorts += 1;
  }

  let equipmentOverlaps = 0;
  for (let i = 0; i < world.equipment.length; i++) {
    for (let j = i + 1; j < world.equipment.length; j++) {
      const a = world.equipment[i];
      const b = world.equipment[j];
      for (const boxA of a.keepouts) {
        for (const boxB of b.keepouts) {
          if (boxesOverlap(boxA.min, boxA.max, boxB.min, boxB.max, 0.05)) {
            equipmentOverlaps += 1;
            errors.push(issue('error', 'EQUIP_OVERLAP', `设备 ${a.equipmentId} 与 ${b.equipmentId} 的教学避让盒重叠`, [a.equipmentId, b.equipmentId]));
          }
        }
      }
    }
  }

  const terminalFlanges = routes.reduce((sum, route) => sum + route.terminalFlanges.length, 0);
  const elbows = routes.reduce((sum, route) => sum + route.bends.length, 0);
  const valves = routes.reduce((sum, route) => sum + route.valves.length, 0);
  const supports = routes.reduce((sum, route) => sum + route.supports.length, 0);
  const sizesUsed = new Set(routes.map((route) => route.size)).size;
  const routeLength = routes.reduce((sum, route) => sum + route.length, 0);

  const counts: PipingValidationCounts = {
    equipment: process.equipment.length,
    placements: world.equipment.length,
    worldPorts: world.ports.length,
    connectedPorts,
    boundaryPorts,
    pendingPorts,
    routedPipelines: routes.length,
    routedPorts: routedPortKeys.size,
    terminalFlanges,
    straightSegments: routes.reduce((sum, route) => sum + route.segments.length, 0),
    elbows,
    valves,
    supports,
    tees: 0,
    reducers: 0,
    collisions,
    equipmentOverlaps,
    supportConflicts,
    sizesUsed,
    routeLength
  };

  const checkExpected = (label: string, actual: number, expected: number | undefined, code: string): void => {
    if (expected !== undefined && actual !== expected) {
      errors.push(issue('error', code, `${label}数量应为 ${expected}，实际为 ${actual}`, []));
    }
  };
  checkExpected('设备实例', counts.equipment, expectations.equipment, 'EXPECT_EQUIPMENT');
  checkExpected('教学布局', counts.placements, expectations.placements, 'EXPECT_PLACEMENT');
  checkExpected('世界接口', counts.worldPorts, expectations.worldPorts, 'EXPECT_WORLD_PORT');
  checkExpected('已接管接口', counts.connectedPorts, expectations.connectedPorts, 'EXPECT_CONNECTED');
  checkExpected('流程边界接口', counts.boundaryPorts, expectations.boundaryPorts, 'EXPECT_BOUNDARY');
  checkExpected('待确认接口', counts.pendingPorts, expectations.pendingPorts, 'EXPECT_PENDING');
  checkExpected('已路由管线', counts.routedPipelines, expectations.routedPipelines, 'EXPECT_ROUTED');
  checkExpected('已路由端口', counts.routedPorts, expectations.routedPorts, 'EXPECT_ROUTED_PORT');
  checkExpected('端部法兰', counts.terminalFlanges, expectations.terminalFlanges, 'EXPECT_FLANGE');
  checkExpected('弯头', counts.elbows, expectations.elbows, 'EXPECT_ELBOW');
  checkExpected('示意阀', counts.valves, expectations.valves, 'EXPECT_VALVE');
  checkExpected('穿模', counts.collisions, expectations.collisions, 'EXPECT_COLLISION');
  checkExpected('设备重叠', counts.equipmentOverlaps, expectations.equipmentOverlaps, 'EXPECT_OVERLAP');
  checkExpected('支架冲突', counts.supportConflicts, expectations.supportConflicts, 'EXPECT_SUPPORT_CONFLICT');
  if (expectations.minSupports !== undefined && counts.supports < expectations.minSupports) {
    errors.push(issue('error', 'EXPECT_SUPPORT_MIN', `支架数量应不少于 ${expectations.minSupports}，实际为 ${counts.supports}`, []));
  }

  return {
    ok: errors.length === 0,
    world,
    routes,
    errors,
    warnings,
    counts
  };
}
