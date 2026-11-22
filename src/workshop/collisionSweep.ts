import { Quaternion, Vector3 } from 'three';

export interface ConvexVolume {
  points: Vector3[];
  faceAxes: Vector3[];
  edgeAxes: Vector3[];
  radius: number;
}

export interface RigidPose {
  position: Vector3;
  rotation: Quaternion;
}

/** 相对四元数的向量部分在极小转角时比 acos 点积稳定。 */
export function angularDistance(a: Quaternion, b: Quaternion): number {
  const delta = a.clone().invert().multiply(b);
  return 2 * Math.atan2(Math.hypot(delta.x, delta.y, delta.z), Math.abs(delta.w));
}

/* 仅用于浮点比较。单位沿用工坊场景坐标（1 单位＝100 mm）。 */
const EPSILON = 1e-8;

/** 平板、管壁分段与带孔截面的三角形都可用凸棱柱表达。 */
export function convexPrism(xMin: number, xMax: number, section: readonly (readonly [number, number])[]): ConvexVolume {
  const axial = new Vector3(1, 0, 0);
  const points = [xMin, xMax].flatMap(x => section.map(([y, z]) => new Vector3(x, y, z)));
  const edges = section.map(([y, z], index) => {
    const [ny, nz] = section[(index + 1) % section.length];
    return new Vector3(0, ny - y, nz - z).normalize();
  });
  return {
    points,
    faceAxes: [axial, ...edges.map(edge => new Vector3(0, -edge.z, edge.y))],
    edgeAxes: [axial, ...edges],
    radius: Math.max(...points.map(point => point.length()))
  };
}

export function radialSection(radius: number, sides: number): [number, number][] {
  return Array.from({ length: sides }, (_, i) => {
    const angle = 2 * Math.PI * i / sides;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
}

export function annularPrisms(xMin: number, xMax: number, inner: number, outer: number, sides: number): ConvexVolume[] {
  const inside = radialSection(inner, sides);
  const outside = radialSection(outer, sides);
  return outside.map((point, i) => {
    const next = (i + 1) % sides;
    return convexPrism(xMin, xMax, [inside[i], point, outside[next], inside[next]]);
  });
}

function place(volume: ConvexVolume, pose: RigidPose): ConvexVolume {
  return {
    points: volume.points.map(point => point.clone().applyQuaternion(pose.rotation).add(pose.position)),
    faceAxes: volume.faceAxes.map(axis => axis.clone().applyQuaternion(pose.rotation)),
    edgeAxes: volume.edgeAxes.map(axis => axis.clone().applyQuaternion(pose.rotation)),
    radius: volume.radius
  };
}

function* separatingAxes(a: ConvexVolume, b: ConvexVolume): Generator<Vector3> {
  const accepted: Vector3[] = [];
  function add(axis: Vector3): boolean {
    if (axis.lengthSq() < EPSILON * EPSILON) return false;
    axis.normalize();
    if (accepted.some(other => Math.abs(other.dot(axis)) > 1 - EPSILON)) return false;
    accepted.push(axis);
    return true;
  }
  for (const source of [...a.faceAxes, ...b.faceAxes]) {
    const axis = source.clone();
    if (add(axis)) yield axis;
  }
  for (const edgeA of a.edgeAxes) for (const edgeB of b.edgeAxes) {
    const axis = new Vector3().crossVectors(edgeA, edgeB);
    if (add(axis)) yield axis;
  }
}
function range(points: readonly Vector3[], axis: Vector3) {
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    const value = point.dot(axis);
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

function separation(a: ConvexVolume, b: ConvexVolume): number {
  let gap = -Infinity;
  for (const axis of separatingAxes(a, b)) {
    const ra = range(a.points, axis);
    const rb = range(b.points, axis);
    gap = Math.max(gap, ra.min - rb.max, rb.min - ra.max);
  }
  return gap;
}

/** 线性移动的连续 SAT。仅当重叠区间具有正长度时报告进入重叠的时间。 */
function linearImpact(a: ConvexVolume, b: ConvexVolume, relative: Vector3): number | null {
  let enter = 0;
  let exit = 1;
  for (const axis of separatingAxes(a, b)) {
    const ra = range(a.points, axis);
    const rb = range(b.points, axis);
    const speed = relative.dot(axis);
    if (Math.abs(speed) < EPSILON) {
      if (ra.max <= rb.min + EPSILON || rb.max <= ra.min + EPSILON) return null;
      continue;
    }
    const t0 = (rb.min + EPSILON - ra.max) / speed;
    const t1 = (rb.max - EPSILON - ra.min) / speed;
    enter = Math.max(enter, Math.min(t0, t1));
    exit = Math.min(exit, Math.max(t0, t1));
    if (enter >= exit) return null;
  }
  return enter;
}

function interpolate(from: RigidPose, to: RigidPose, fraction: number): RigidPose {
  return {
    position: from.position.clone().lerp(to.position, fraction),
    rotation: from.rotation.clone().slerp(to.rotation, fraction)
  };
}

/**
 * 检查两凸体在指定运动区间的实体穿入。
 * 纯平移使用解析进入时间。含旋转时，以平移幅度和角位移×外接半径
 * 约束区间内顶点的最大运动，无法证明分离的区间向下细分并保守拒绝。
 */
export function sweepConvex(
  a: ConvexVolume, aFrom: RigidPose, aTo: RigidPose,
  b: ConvexVolume, bFrom: RigidPose, bTo: RigidPose
): { status: 'clear' } | { status: 'collision' | 'unresolved'; fraction: number } {
  const aAngle = angularDistance(aFrom.rotation, aTo.rotation);
  const bAngle = angularDistance(bFrom.rotation, bTo.rotation);
  const relative = aTo.position.clone().sub(aFrom.position).sub(bTo.position.clone().sub(bFrom.position));
  if (aAngle < EPSILON && bAngle < EPSILON) {
    const impact = linearImpact(place(a, aFrom), place(b, bFrom), relative);
    return impact === null ? { status: 'clear' } : { status: 'collision', fraction: impact };
  }

  const movementBound = relative.length() + aAngle * a.radius + bAngle * b.radius;
  function check(low: number, high: number, depth: number): ReturnType<typeof sweepConvex> {
    const middle = (low + high) / 2;
    const gap = separation(place(a, interpolate(aFrom, aTo, middle)), place(b, interpolate(bFrom, bTo, middle)));
    if (gap > movementBound * (high - low) / 2 + EPSILON) return { status: 'clear' };
    if (gap < -EPSILON) return { status: 'collision', fraction: middle };
    if (depth === 0) return { status: 'unresolved', fraction: low };
    const first = check(low, middle, depth - 1);
    return first.status === 'clear' ? check(middle, high, depth - 1) : first;
  }

  return check(0, 1, 16);
}

