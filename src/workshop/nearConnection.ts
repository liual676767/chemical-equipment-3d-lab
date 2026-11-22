import type { Vector3 } from 'three';
import { boltDims } from './layout';
import {
  describeBoltStack, instOf, jointSlots, livePorts, portWorld, slotOccupied,
  slotWorld, validateConnection, type PortRef
} from './state';
import { planConnection } from './assemblyPlan';
import { MM, type WState } from './types';

export const DOCK_RELEASE_DISTANCE = 19 * MM;

export interface DockTarget {
  fixed: PortRef;
  moving: PortRef;
  distance: number;
  state: WState;
}

function equal(a: PortRef, b: PortRef) {
  return a.uid === b.uid && a.port === b.port;
}

interface Target {
  ref: PortRef;
  ownerUid: string;
  pos: Vector3;
  dir: Vector3;
}

interface DockOptions {
  preferredParts?: ReadonlySet<string>;
  onRejected?: (reason: string) => void;
}

function availableBoltTargets(state: WState, moving: ReadonlySet<string>): Target[] {
  const result: Target[] = [];
  const links = state.connections.filter(link => link.kind === 'flange');
  links.sort((a, b) => Number(instOf(state, a.a.uid)?.partId === 'gasket') - Number(instOf(state, b.a.uid)?.partId === 'gasket'));
  const tightened = new Set(state.connections.filter(link => link.kind === 'bolt-slot').map(link => link.b.uid.slice(6)));
  for (const link of links) {
    const owner = instOf(state, link.a.uid);
    if (!owner || owner.hidden || moving.has(owner.uid) || moving.has(link.b.uid)) continue;
    const spec = jointSlots(state, link.id);
    const stack = spec && describeBoltStack(state, link.id);
    if (!spec || !stack || (stack.peerId && tightened.has(stack.peerId))) continue;
    for (let slot = 0; slot < spec.count; slot++) {
      if (slotOccupied(state, link.id, slot)) continue;
      const world = slotWorld(state, link.id, slot, stack.underHead);
      if (!world) continue;
      const outward = world.dir.negate();
      const peer = 'joint:' + stack.peerId;
      if (stack.peerId && result.some(target => target.ref.uid === peer &&
          target.pos.distanceToSquared(world.pos) < 1e-14 && target.dir.dot(outward) > 1 - 1e-8)) continue;
      result.push({
        ref: { uid: 'joint:' + link.id, port: 'slot' + slot },
        ownerUid: owner.uid, pos: world.pos, dir: outward
      });
    }
  }
  return result;
}

export function findDockTarget(
  state: WState, moving: ReadonlySet<string>,
  visible: (ownerUid: string, position: Vector3, outward: Vector3) => boolean,
  previous: DockTarget | null, options: DockOptions = {}
): DockTarget | null {
  const candidates: (Omit<DockTarget, 'state'> & { rank: number; preferred: boolean })[] = [];
  let rejection: { distance: number; reason: string } | undefined;
  const reject = (distance: number, reason: string) => {
    if (!rejection || distance < rejection.distance) rejection = { distance, reason };
  };
  const regular: Target[] = [];
  for (const target of state.instances) {
    if (moving.has(target.uid) || target.hidden) continue;
    for (const port of livePorts(target)) {
      const pose = portWorld(target, port.id);
      if (pose) regular.push({ ref: { uid: target.uid, port: port.id }, ownerUid: target.uid, ...pose });
    }
  }
  let boltHoles: Target[] | undefined;
  for (const item of state.instances) {
    if (!moving.has(item.uid) || item.hidden) continue;
    for (const from of livePorts(item)) {
      const fromPose = portWorld(item, from.id);
      if (!fromPose) continue;
      const movingPort = { uid: item.uid, port: from.id };
      const boltShank = from.type === 'bolt';
      const targets = boltShank ? (boltHoles ??= availableBoltTargets(state, moving)) : regular;
      const tip = boltShank ? fromPose.pos.clone().addScaledVector(fromPose.dir, boltDims(item.spec.dn).len) : fromPose.pos;
      for (const target of targets) {
        const gap = target.pos.clone().sub(tip);
        const distance = gap.length();
        const retained = previous && equal(previous.fixed, target.ref) && equal(previous.moving, movingPort);
        // 进入/脱离半径是手势阈值，独立于零件的装配尺寸与几何容差。
        if (distance > (retained ? DOCK_RELEASE_DISTANCE : 12 * MM)) continue;
        if (!visible(target.ownerUid, target.pos, target.dir)) continue;
        const along = gap.dot(fromPose.dir);
        const opposition = -fromPose.dir.dot(target.dir);
        const lateral = gap.addScaledVector(fromPose.dir, -along).length();
        const legal = validateConnection(state, target.ref, movingPort);
        if (!legal.ok) { reject(distance, legal.reason); continue; }
        if (opposition < 0.94 || along < -1e-6 || lateral > 8 * MM) {
          reject(distance, '请从接口正面靠近，并对准轴线。');
          continue;
        }
        const owner = instOf(state, target.ownerUid);
        const preferred = Boolean(owner && options.preferredParts?.has(owner.partId) && options.preferredParts.has(item.partId));
        candidates.push({ fixed: target.ref, moving: movingPort, distance, preferred, rank: distance + (1 - opposition) * 8 * MM });
      }
    }
  }

  candidates.sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.rank - b.rank);
  const retained = previous && candidates.find(candidate => equal(candidate.fixed, previous.fixed) && equal(candidate.moving, previous.moving));
  const ordered = retained ? [retained, ...candidates.filter(candidate => candidate !== retained)] : candidates;
  let first: { target: DockTarget; preferred: boolean; rank: number } | undefined;
  for (const candidate of ordered) {
    if (first && (first.preferred !== candidate.preferred || candidate.rank - first.rank >= 2 * MM)) break;
    const { fixed, moving: movingPort, distance, rank, preferred } = candidate;
    const alignment = planConnection(state, fixed, movingPort, { near: true });
    if (!alignment.ok) { reject(distance, alignment.reason); continue; }
    const target = { fixed, moving: movingPort, distance, state: alignment.state };
    if (candidate === retained) return target;
    if (first) {
      options.onRejected?.('附近有多个可装接口，请再靠近要连接的一个。');
      return null;
    }
    first = { target, preferred, rank };
  }
  if (first) return first.target;
  if (rejection) options.onRejected?.(rejection.reason);
  return null;
}
