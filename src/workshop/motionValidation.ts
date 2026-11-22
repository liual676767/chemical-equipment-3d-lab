import { Box3, Mesh, Vector3, type Material } from 'three';
import { partById } from './catalog';
import { boltThreadStart, engagedBoltVolumes, partConvexVolumes } from './collisionVolumes';
import { angularDistance, convexPrism, sweepConvex, type ConvexVolume, type RigidPose } from './collisionSweep';
import { buildPart } from './geometry';
import { axialClearancePrisms, meshPrisms, volutePrisms } from './meshCollision';
import { nutThickness } from './layout';
import { componentOf, quatOf } from './state';
import type { Connection, Instance, WState } from './types';

interface MovingVolume {
  volume: ConvexVolume;
  sweptBox: Box3;
}

interface BodyMotion {
  before: Instance;
  from: RigidPose;
  to: RigidPose;
  moving: boolean;
  travel: Vector3;
  angle: number;
  bounds: Box3;
  pieces: MovingVolume[];
  approximate: boolean;
}

export interface MotionBlock {
  moving: string;
  obstacle: string;
  status: 'collision' | 'unresolved';
  fraction: number;
}

const fallbackVolumes = new Map<string, readonly ConvexVolume[]>();

interface AssemblyMotion {
  rootUid: string;
  members: ReadonlySet<string>;
  from: RigidPose;
  to: RigidPose;
}

function poseOf(instance: Instance): RigidPose {
  return { position: new Vector3(...instance.pos), rotation: quatOf(instance) };
}

/** 把成员的实体表示在参考件坐标内，扫掠时保留绕参考件的圆弧。 */
function inReferenceFrame(volume: ConvexVolume, local: RigidPose): ConvexVolume {
  const points = volume.points.map(point => point.clone().applyQuaternion(local.rotation).add(local.position));
  return {
    points,
    faceAxes: volume.faceAxes.map(axis => axis.clone().applyQuaternion(local.rotation)),
    edgeAxes: volume.edgeAxes.map(axis => axis.clone().applyQuaternion(local.rotation)),
    radius: Math.max(...points.map(point => point.length()))
  };
}

/** 一件零件可以由多个实心几何组成，逐网格外包络；未认证的薄壁和空腔可能保守拒绝。 */
function fallback(instance: Instance): readonly ConvexVolume[] {
  const key = JSON.stringify([instance.partId, instance.spec.dn, instance.spec.length, instance.spec.endType, instance.spec.smallDn]);
  const old = fallbackVolumes.get(key);
  if (old) return old;
  const part = partById(instance.partId);
  if (!part) return [];
  const group = buildPart(part.id, instance.spec, part.color, part.material);
  group.updateMatrixWorld(true);
  const pieces: ConvexVolume[] = [];
  const materials = new Set<Material>();
  group.traverse(object => {
    if (!(object instanceof Mesh)) return;
    object.geometry.computeBoundingBox();
    const bounds = object.geometry.boundingBox?.clone().applyMatrix4(object.matrixWorld);
    const mats = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of mats) materials.add(material);
    const prisms = object.userData.workshopVolute ? volutePrisms(object.geometry, object.matrixWorld)
      : typeof object.userData.workshopBore === 'number'
      ? axialClearancePrisms(object.geometry, object.matrixWorld, object.userData.workshopBore, object.userData.workshopOuterRadius)
      : meshPrisms(object.geometry, object.matrixWorld);
    if (prisms) {
      pieces.push(...prisms);
      return;
    }
    if (!bounds || bounds.isEmpty()) return;
    const { min, max } = bounds;
    if (max.x <= min.x || max.y <= min.y || max.z <= min.z) return;
    pieces.push(convexPrism(min.x, max.x, [[min.y,min.z],[max.y,min.z],[max.y,max.z],[min.y,max.z]]));
  });
  for (const material of materials) material.dispose();
  fallbackVolumes.set(key, pieces);
  return pieces;
}

function sweptBounds(volume: ConvexVolume, from: RigidPose, to: RigidPose, angle: number): Box3 {
  const bounds = new Box3();
  const point = new Vector3();
  for (const local of volume.points) {
    bounds.expandByPoint(point.copy(local).applyQuaternion(from.rotation).add(from.position));
    bounds.expandByPoint(point.copy(local).applyQuaternion(to.rotation).add(to.position));
  }
  // 中间位姿与端点对应顶点线性插值的偏差上界。
  return bounds.expandByScalar(angle * volume.radius);
}

function motion(before: Instance, after: Instance, assembly?: AssemblyMotion): BodyMotion {
  const localPose = poseOf(before);
  const from = assembly?.from ?? localPose;
  const to = assembly?.to ?? poseOf(after);
  const angle = angularDistance(from.rotation, to.rotation);
  const proxy = partConvexVolumes(before.partId, before.spec);
  const volumes = proxy ?? fallback(before);
  const inverse = assembly?.from.rotation.clone().invert();
  const local = inverse && {
    position: localPose.position.clone().sub(from.position).applyQuaternion(inverse),
    rotation: localPose.rotation.clone().premultiply(inverse)
  };
  const pieces = volumes.map(shape => {
    const volume = local ? inReferenceFrame(shape, local) : shape;
    return { volume, sweptBox: sweptBounds(volume, from, to, angle) };
  });
  const bounds = pieces.reduce((box, piece) => box.union(piece.sweptBox), new Box3());
  const travel = to.position.clone().sub(from.position);
  return { before, from, to, moving: travel.lengthSq() > 1e-14 || angle > 1e-8, travel, angle, bounds, pieces, approximate: proxy === null };
}

function threadContact(a: BodyMotion, b: BodyMotion, edge: Connection): string | null {
  const bolt = a.before.uid === edge.a.uid && b.before.uid === edge.b.uid ? a
    : b.before.uid === edge.a.uid && a.before.uid === edge.b.uid ? b : null;
  if (!bolt) return null;
  const nut = bolt === a ? b : a;
  const dn = bolt.before.spec.dn;
  if (bolt.before.partId !== 'bolt' || nut.before.partId !== 'nut' || nut.before.spec.dn !== dn
      || edge.a.port !== 'end' || edge.b.port !== 'thread' || bolt.angle > 1e-8 || nut.angle > 1e-8) return null;
  const axis = new Vector3(1, 0, 0).applyQuaternion(bolt.from.rotation);
  if (axis.dot(new Vector3(1, 0, 0).applyQuaternion(nut.from.rotation)) < 1 - 1e-8) return null;
  for (const [nutPose, boltPose] of [[nut.from, bolt.from], [nut.to, bolt.to]]) {
    const diff = nutPose.position.clone().sub(boltPose.position);
    const axial = diff.dot(axis);
    if (axial - nutThickness(dn) / 2 < boltThreadStart(dn) - 1e-8
        || diff.addScaledVector(axis, -axial).lengthSq() > 1e-14) return null;
  }
  return bolt.before.uid;
}

function pairPieces(a: BodyMotion, b: BodyMotion, relations: readonly Connection[]) {
  let bolt: string | null = null;
  for (const edge of relations) {
    bolt = threadContact(a, b, edge);
    if (bolt) break;
  }
  const pieces = (body: BodyMotion) => bolt === body.before.uid
    ? engagedBoltVolumes(body.before.spec.dn).map(volume => ({
      volume, sweptBox: sweptBounds(volume, body.from, body.to, body.angle)
    })) : body.pieces;
  return [pieces(a), pieces(b)] as const;
}

export function findPoseConflicts(state: WState, limit = 32, affected?: ReadonlySet<string>): MotionBlock[] {
  const bodies = state.instances.map(instance => motion(instance, instance));
  const threads = state.connections.filter(c => c.kind === 'nut');
  const conflicts: MotionBlock[] = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      if (affected && !affected.has(a.before.uid) && !affected.has(b.before.uid)) continue;
      if (!a.bounds.intersectsBox(b.bounds)) continue;
      const [ap, bp] = pairPieces(a, b, threads);
      if (!ap.some(pa => bp.some(pb => pa.sweptBox.intersectsBox(pb.sweptBox)
        && sweepConvex(pa.volume, a.from, a.to, pb.volume, b.from, b.to).status !== 'clear'))) continue;
      conflicts.push({
        moving: a.before.uid, obstacle: b.before.uid,
        status: a.approximate || b.approximate ? 'unresolved' : 'collision', fraction: 0
      });
      if (conflicts.length >= limit) return conflicts;
    }
  }
  return conflicts;
}

/** 检查从现态到候选位姿的扫掠。显示、分组、连接与紧固件类型均不影响入检。 */
export function findMotionBlock(before: WState, after: WState, rigidRootUid?: string): MotionBlock | null {
  const afterByUid = new Map(after.instances.map(instance => [instance.uid, instance]));
  const root = before.instances.find(instance => instance.uid === rigidRootUid);
  const endRoot = rigidRootUid === undefined ? undefined : afterByUid.get(rigidRootUid);
  const assembly: AssemblyMotion | undefined = root && endRoot
    ? { rootUid: root.uid, members: componentOf(before, root.uid), from: poseOf(root), to: poseOf(endRoot) }
    : undefined;
  const rotationDelta = assembly?.to.rotation.clone().multiply(assembly.from.rotation.clone().invert());
  if (assembly && rotationDelta) {
    for (const item of before.instances) {
      if (!assembly.members.has(item.uid)) continue;
      const end = afterByUid.get(item.uid);
      const expected = new Vector3(...item.pos).sub(assembly.from.position)
        .applyQuaternion(rotationDelta).add(assembly.to.position);
      if (!end || expected.distanceToSquared(new Vector3(...end.pos)) > 1e-14
        || angularDistance(quatOf(item).premultiply(rotationDelta), quatOf(end)) > 1e-7) {
        return { moving: assembly.rootUid, obstacle: item.uid, status: 'unresolved', fraction: 0 };
      }
    }
  }
  const bodies = before.instances.flatMap(instance => {
    const destination = afterByUid.get(instance.uid);
    return destination ? [motion(instance, destination, assembly?.members.has(instance.uid) ? assembly : undefined)] : [];
  });
  const threads = [...before.connections, ...after.connections].filter(c => c.kind === 'nut');
  let first: MotionBlock | null = null;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      if ((!a.moving && !b.moving) || !a.bounds.intersectsBox(b.bounds)) continue;
      // 已验证为同一刚体变换时，相对几何恒定。静态检查仍会报告既存自交。
      if (assembly?.members.has(a.before.uid) && assembly.members.has(b.before.uid)) continue;
      // 同向等量纯平移前后相对姿态恒定。这一对不会新增干涉，
      // 既存相交仍应由方案静态诊断报告。
      if (a.angle < 1e-8 && b.angle < 1e-8 && a.travel.distanceToSquared(b.travel) < 1e-14) continue;
      const [ap, bp] = pairPieces(a, b, threads);
      for (const pa of ap) {
        for (const pb of bp) {
          if (!pa.sweptBox.intersectsBox(pb.sweptBox)) continue;
          const hit = sweepConvex(pa.volume, a.from, a.to, pb.volume, b.from, b.to);
          if (hit.status === 'clear' || (first && first.fraction <= hit.fraction)) continue;
          first = {
            moving: a.moving ? a.before.uid : b.before.uid,
            obstacle: a.moving ? b.before.uid : a.before.uid,
            status: a.approximate || b.approximate ? 'unresolved' : hit.status,
            fraction: hit.fraction
          };
          if (first.fraction === 0) return first;
        }
      }
    }
  }
  return first;
}




