import { Euler, Vector3 } from 'three';
import { partById } from './catalog';
import { angularDistance } from './collisionSweep';
import { boltDims, nutThickness } from './layout';
import { findMotionBlock } from './motionValidation';
import { BOLT_DN } from './specs';
import {
  cloneState, componentOf, describeBoltStack, instOf, jointSlots, makeConnection, newUid,
  portDef, portWorld, quatOf, slotOccupied, slotWorld, type PortRef
} from './state';
import type { Connection, Instance, WState } from './types';

type Failure = { ok: false; reason: string };
type ConnectionDraft = { ok: true; state: WState; connection: Connection } | Failure;

export function resolveConnectionDraft(before: WState, a: PortRef, b: PortRef): ConnectionDraft {
  const next = cloneState(before);
  const joint = [a, b].find(ref => ref.uid.startsWith('joint:'));
  if (joint) {
    const id = joint.uid.slice(6);
    const link = next.connections.find(connection => connection.id === id);
    const stack = describeBoltStack(next, id);
    if (link && !stack) return { ok: false, reason: '先完成垫片另一侧的法兰连接，再安装紧固件。' };
    if (link && stack) {
      const bolts = next.connections.filter(connection => connection.kind === 'bolt-slot');
      if (stack.peerId && bolts.some(connection => connection.b.uid === 'joint:' + stack.peerId)) {
        return { ok: false, reason: '这对法兰已从垫片另一侧安装紧固件。' };
      }
      if (!link.meta?.boltStack && bolts.some(connection => connection.b.uid === joint.uid)) {
        return { ok: false, reason: '此接头已有旧方案紧固件，需先拆下该接头的旧紧固件，再按贯穿两片法兰的孔位安装。' };
      }
      link.meta = { ...link.meta, boltStack: { underHead: stack.underHead, grip: stack.grip } };
    }
  }
  const result = makeConnection(next, a, b);
  if (!result.ok || !result.conn) return { ok: false, reason: result.reason ?? '接口无法连接。' };
  return { ok: true, state: next, connection: result.conn };
}

function entryOffset(draft: Extract<ConnectionDraft, { ok: true }>): Vector3 | null {
  const { state, connection: link } = draft;
  if (link.kind === 'bolt-slot') {
    const bolt = instOf(state, link.a.uid);
    const slot = slotWorld(state, link.b.uid.slice(6), Number(link.b.port.slice(4)));
    return bolt && slot ? slot.dir.multiplyScalar(-boltDims(bolt.spec.dn).len - 0.05) : null;
  }
  const fixed = instOf(state, link.a.uid);
  if (!fixed) return null;
  if (link.a.port === 'case-pad') return new Vector3(-0.75, 0, 0).applyQuaternion(quatOf(fixed));
  if (link.kind === 'clamp') return new Vector3(0, -1, 0).applyQuaternion(quatOf(fixed)).multiplyScalar(0.8);
  const outward = portWorld(fixed, link.a.port)?.dir;
  if (!outward) return null;
  if (link.kind === 'nut') return outward.multiplyScalar(nutThickness(fixed.spec.dn) * 2 + 0.05);
  if (fixed.partId === 'P045' && link.a.port === 'inner') return outward.multiplyScalar(0.95);
  if (fixed.partId === 'P042' && link.a.port === 'sleeve') return outward.multiplyScalar(0.85);
  if (link.a.port === 'washer-seat') return outward.multiplyScalar(boltDims(fixed.spec.dn).len + 0.05);
  return outward.multiplyScalar(0.4);
}

function retreat(before: WState, draft: Extract<ConnectionDraft, { ok: true }>, offset?: Vector3): WState | null {
  const direction = offset ?? entryOffset(draft);
  if (!direction) return null;
  const staging = cloneState(before);
  for (const item of staging.instances) {
    const pose = instOf(draft.state, item.uid);
    if (!pose || (!item.pos.some((x, i) => x !== pose.pos[i]) && !item.rot.some((x, i) => x !== pose.rot[i]))) continue;
    item.pos = new Vector3(...pose.pos).add(direction).toArray();
    item.rot = [...pose.rot];
  }
  return staging;
}

type Pose = Pick<Instance, 'pos' | 'rot'>;
export interface ConnectionPath {
  entryOffset?: Vector3;
  waypoints?: (initial: Pose, entry: Pose) => Pose[];
  allowLift?: boolean;
}

function checkPath(before: WState, states: readonly WState[], rigidRoot?: string): Failure | null {
  let previous = before;
  for (const state of states) {
    const block = findMotionBlock(previous, state, rigidRoot);
    if (block) {
      const obstacle = instOf(before, block.obstacle);
      const label = obstacle && (partById(obstacle.partId)?.name ?? obstacle.partId);
      return { ok: false, reason: label
        ? '安装路径在「' + label + '」处受阻。请检查入口方向与周边零件。'
        : '无法验证安装路径。请检查入口方向与周边零件。' };
    }
    previous = state;
  }
  return null;
}

export function planConnection(before: WState, a: PortRef, b: PortRef, options: ConnectionPath & { near?: boolean } = {}): ConnectionDraft {
  const draft = resolveConnectionDraft(before, a, b);
  if (!draft.ok) return draft;
  const { connection } = draft;
  const moving = connection.kind === 'bolt-slot' ? connection.a : connection.b;
  const from = instOf(before, moving.uid);
  const to = instOf(draft.state, moving.uid);
  const fastener = connection.kind === 'bolt-slot' || connection.kind === 'nut';
  const axial = fastener || connection.a.port === 'washer-seat' || connection.a.port === 'case-pad' ||
    (connection.kind === 'mechanical' && from && portDef(from, moving.port)?.mate?.mode === 'axial');
  const rigidRoot = connection.kind === 'nut' || connection.kind === 'clamp' ? undefined : moving.uid;
  const turn = from && to ? angularDistance(quatOf(from), quatOf(to)) : 0;
  let direct: Failure | null = null;
  if (!options.waypoints && !axial && (!options.allowLift || turn < 1e-8)) {
    direct = checkPath(before, [draft.state], rigidRoot);
    if (!direct) return draft;
    if (options.near && turn < 1e-8) return direct;
  }
  if (axial && !options.waypoints) {
    const outward = entryOffset(draft)?.normalize();
    if (from && to && outward) {
      const offset = new Vector3(...from.pos).sub(new Vector3(...to.pos));
      const along = offset.dot(outward);
      if (along >= -1e-8 && offset.addScaledVector(outward, -along).lengthSq() <= 1e-14
          && turn < 1e-8 && !checkPath(before, [draft.state], rigidRoot)) return draft;
    }
  }
  const staging = retreat(before, draft, options.entryOffset ?? (options.near && !fastener
    ? entryOffset(draft)?.setLength(0.12)
    : undefined));
  if (!staging) return direct ?? { ok: false, reason: '无法确定装配入口。' };
  if (options.near) {
    const drifting = staging.instances.some((item, index) =>
      new Vector3(...item.pos).distanceTo(new Vector3(...before.instances[index].pos)) > 0.25);
    if (drifting) return direct ?? { ok: false, reason: '请把零件移近轴向入口。' };
  }
  const states: WState[] = [];
  if (options.waypoints) {
    const changed = staging.instances.filter((item, index) => {
      const old = before.instances[index];
      return item.pos.some((x, i) => x !== old.pos[i]) || item.rot.some((x, i) => x !== old.rot[i]);
    });
    if (changed.length !== 1) return { ok: false, reason: '练习托盘一次只能取放一个零件。' };
    const entry = changed[0];
    const origin = instOf(before, entry.uid)!;
    for (const pose of options.waypoints(origin, entry)) {
      const point = cloneState(before);
      Object.assign(instOf(point, entry.uid)!, pose);
      states.push(point);
    }
  }
  if (options.allowLift && !options.waypoints) {
    const finalApproach = checkPath(staging, [draft.state], rigidRoot);
    if (finalApproach) return finalApproach;
  }
  const blocked = options.allowLift && turn > 1e-8 && !options.waypoints
    ? { ok: false as const, reason: '无法从当前位置沿装配轴线进入。请移开周围零件或调整零件方向。' }
    : checkPath(before, [...states, staging, draft.state], rigidRoot);
  if (!blocked) return draft;
  if (!options.allowLift || options.near || options.waypoints || !from || !to) return blocked;

  const entry = instOf(staging, moving.uid);
  if (!entry) return blocked;
  const members = rigidRoot ? componentOf(before, moving.uid) : new Set([moving.uid]);
  const fixed = instOf(before, connection.kind === 'bolt-slot' ? (draft.state.connections.find(link =>
    'joint:' + link.id === connection.b.uid)?.a.uid ?? '') : connection.a.uid);
  const below = fixed && entry.pos[1] < fixed.pos[1];
  const directions = below ? [[1,-1],[1,1],[2,1],[2,-1]] : [[1,1],[1,-1],[2,1],[2,-1]];
  for (const [axis, direction] of directions) {
    const outer = direction * (Math.max(direction * from.pos[axis], direction * entry.pos[axis]) + 3);
    const lift = (state: WState, reference: Instance) => {
      const moved = cloneState(state);
      for (const member of moved.instances) {
        if (members.has(member.uid)) member.pos[axis] += outer - reference.pos[axis];
      }
      return moved;
    };
    if (!checkPath(before, [lift(before, from), lift(staging, entry), staging, draft.state], rigidRoot)) return draft;
  }
  return blocked;
}

function installNewFastener(state: WState, partId: 'bolt' | 'nut', dn: number, fixed: PortRef): ConnectionDraft {
  const item: Instance = { uid: newUid(), partId, pos: [0, 0, 0], rot: [0, 0, 0], spec: { dn } };
  const created = cloneState(state);
  created.instances.push(item);
  const moving = { uid: item.uid, port: partId === 'bolt' ? 'shank' : 'thread' };
  const draft = resolveConnectionDraft(created, fixed, moving);
  if (!draft.ok) return draft;
  const aligned = instOf(draft.state, item.uid);
  const offset = entryOffset(draft);
  if (!aligned || !offset) return { ok: false, reason: '紧固件的轴向装配位无法确定。' };
  item.pos = new Vector3(...aligned.pos).add(offset).toArray();
  item.rot = [...aligned.rot];
  return findMotionBlock(created, draft.state)
    ? { ok: false, reason: '紧固件的轴向进入空间被占用，未提交紧固件。' }
    : draft;
}

/** 为一个接头检查全套紧固件，任一孔位失败时返回前态。 */
export function planFasteners(before: WState, connId: string): { ok: true; state: WState; installed: number; size: string } | Failure {
  const spec = jointSlots(before, connId);
  if (!spec) return { ok: false, reason: '该连接不支持螺栓紧固。' };
  let draft = before;
  let installed = 0;
  for (let slot = 0; slot < spec.count; slot++) {
    const occupied = slotOccupied(draft, connId, slot);
    let boltUid = occupied?.a.uid;
    if (!boltUid) {
      const result = installNewFastener(draft, 'bolt', BOLT_DN[spec.bolt], { uid: 'joint:' + connId, port: 'slot' + slot });
      if (!result.ok) return result;
      boltUid = result.connection.a.uid;
      draft = result.state;
    }
    const hasNut = draft.connections.some(connection => connection.kind === 'nut' && connection.a.uid === boltUid);
    if (hasNut) continue;
    const result = installNewFastener(draft, 'nut', BOLT_DN[spec.bolt], { uid: boltUid, port: 'end' });
    if (!result.ok) return result;
    draft = result.state;
    installed++;
  }
  return { ok: true, state: draft, installed, size: spec.bolt };
}

/** Place the unfastened ring assembly through the open shaft end before installing the impeller. */
export function stagePumpRingAssembly(before: WState, uid: string): WState | null {
  const part = instOf(before, uid);
  if (part?.partId !== 'P040' && part?.partId !== 'P048') return null;
  const members = componentOf(before, uid);
  const group = before.instances.filter(item => members.has(item.uid));
  if (group.some(item => item.uid !== uid && item.partId !== 'P047')) return null;
  if (part.partId === 'P048' && !group.some(item => item.partId === 'P047')) return null;
  const shafts = before.instances.filter(item => item.partId === 'P042' &&
    before.connections.some(link => link.b.uid === item.uid && link.b.port === 'journal'));
  if (shafts.length !== 1) return null;

  const shaft = shafts[0];
  const rotation = quatOf(shaft);
  const origin = new Vector3(...part.pos);
  const center = part.partId === 'P040' ? -0.605 : -0.4;
  const targetPos = new Vector3(center, 0, 0).applyQuaternion(rotation).add(new Vector3(...shaft.pos));
  const start = new Vector3(-1.4, 0, 0).applyQuaternion(rotation).add(new Vector3(...shaft.pos));
  const inverse = quatOf(part).invert();
  const stateAt = (position: Vector3, quaternion = rotation) => {
    const draft = cloneState(before);
    const delta = quaternion.clone().multiply(inverse);
    for (const item of draft.instances) {
      if (!members.has(item.uid)) continue;
      item.pos = new Vector3(...item.pos).sub(origin).applyQuaternion(delta).add(position).toArray();
      const euler = new Euler().setFromQuaternion(quatOf(item).premultiply(delta), 'XYZ');
      item.rot = [euler.x, euler.y, euler.z];
    }
    return draft;
  };
  const entry = stateAt(start);
  const target = stateAt(targetPos);
  if (checkPath(entry, [target], uid)) return null;
  for (const [axis, sign] of [[1,1],[1,-1],[2,1],[2,-1]]) {
    const aboveStart = origin.clone();
    const aboveEntry = start.clone();
    const coordinate = (Math.max(origin.getComponent(axis) * sign, start.getComponent(axis) * sign) + 3) * sign;
    aboveStart.setComponent(axis, coordinate);
    aboveEntry.setComponent(axis, coordinate);
    if (!checkPath(before, [stateAt(aboveStart, quatOf(part)), stateAt(aboveEntry), entry, target], uid)) return target;
  }
  return null;
}

