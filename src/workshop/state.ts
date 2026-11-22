/* 工坊状态核心：连接校验、对齐吸附、连接网络、撤销重做、空间检查。 */
import * as THREE from 'three';
import type { WState, Instance, Connection, PortDef, ConnKind } from './types';
import { PORT_TYPE_LABEL } from './types';
import { flangeDims, GASKET_THICKNESS, nutThickness, odU, pipeLen, portsFor, phaseRef } from './layout';
import { partById } from './catalog';
import { standardCompatible, flangeSpec, BOLT_DN } from './specs';
import { assemblyAssetById } from './expansion';
import { washerThickness } from './expansion/piping-fittings';

export interface PortRef { uid: string; port: string }

let uidCounter = 0;
export function newUid(): string {
  uidCounter += 1;
  return `i${Date.now().toString(36)}${uidCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function instOf(state: WState, uid: string): Instance | undefined {
  return state.instances.find((i) => i.uid === uid);
}

export function livePorts(inst: Instance): PortDef[] {
  return portsFor(inst.partId, inst.spec);
}

export function portDef(inst: Instance, portId: string): PortDef | undefined {
  return livePorts(inst).find((p) => p.id === portId);
}

export function quatOf(inst: Instance): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(inst.rot[0], inst.rot[1], inst.rot[2], 'XYZ'));
}

export function portWorld(inst: Instance, portId: string): { pos: THREE.Vector3; dir: THREE.Vector3 } | null {
  const p = portDef(inst, portId);
  if (!p) return null;
  const q = quatOf(inst);
  return {
    pos: new THREE.Vector3(...p.pos).applyQuaternion(q).add(new THREE.Vector3(...inst.pos)),
    dir: new THREE.Vector3(...p.dir).applyQuaternion(q).normalize()
  };
}

export function isFluidPort(p: PortDef): boolean {
  return p.type === 'flange' || (p.type === 'thread' && p.standard !== 'M') || p.type === 'weld';
}

export function portOccupied(state: WState, uid: string, port: string): Connection | undefined {
  return state.connections.find(
    (c) => (c.a.uid === uid && c.a.port === port) || (c.b.uid === uid && c.b.port === port)
  );
}

export function jointSlots(state: WState, connId: string): { count: number; bolt: string; dn: number } | null {
  const c = state.connections.find((x) => x.id === connId);
  if (!c || c.kind !== 'flange') return null;
  const ia = instOf(state, c.a.uid);
  const ib = instOf(state, c.b.uid);
  if (!ia || !ib) return null;
  const pa = portDef(ia, c.a.port);
  const pb = portDef(ib, c.b.port);
  if (!pa?.boltCount || !pb?.boltCount) return null;
  const f = flangeSpec(pa.dn);
  return { count: pa.boltCount, bolt: f.bolt, dn: pa.dn };
}

export function describeBoltStack(state: WState, connId: string): {
  underHead: number; grip: number; peerId?: string;
} | null {
  const connection = state.connections.find(c => c.id === connId && c.kind === 'flange');
  const spec = jointSlots(state, connId);
  if (!connection || !spec) return null;
  const left = instOf(state, connection.a.uid);
  const right = instOf(state, connection.b.uid);
  const gasket = left?.partId === 'gasket' ? left : right?.partId === 'gasket' ? right : null;
  const { t } = flangeDims(spec.dn);
  if (!gasket) return { underHead: t, grip: t * 2 };
  const current = connection.a.uid === gasket.uid ? connection.a : connection.b;
  const otherPort = current.port === 'f1' ? 'f2' : 'f1';
  const peer = portOccupied(state, gasket.uid, otherPort);
  if (!peer || peer.kind !== 'flange') return null;
  const flange = instOf(state, peer.a.uid === gasket.uid ? peer.b.uid : peer.a.uid);
  if (!flange || flange.partId === 'gasket') return null;
  return { underHead: left === gasket ? t + GASKET_THICKNESS : t, grip: t * 2 + GASKET_THICKNESS, peerId: peer.id };
}

export function slotOccupied(state: WState, connId: string, slot: number): Connection | undefined {
  return state.connections.find((c) => c.kind === 'bolt-slot' && c.b.uid === `joint:${connId}` && c.b.port === `slot${slot}`);
}

export function slotWorld(state: WState, connId: string, slot: number, underHead?: number): { pos: THREE.Vector3; dir: THREE.Vector3 } | null {
  const info = jointSlots(state, connId);
  const c = state.connections.find((x) => x.id === connId);
  if (!info || !c) return null;
  const ia = instOf(state, c.a.uid);
  if (!ia) return null;
  const w = portWorld(ia, c.a.port);
  if (!w) return null;
  const p = portDef(ia, c.a.port)!;
  const phase = new THREE.Vector3(...phaseRef(p.dir)).applyQuaternion(quatOf(ia));
  const k = flangeSpec(p.dn).k * 0.01 / 2;
  const ang = (slot * Math.PI * 2) / info.count;
  const off = phase.clone().applyAxisAngle(w.dir, ang).multiplyScalar(k);
  return { pos: w.pos.clone().add(off).addScaledVector(w.dir, -(underHead ?? c.meta?.boltStack?.underHead ?? 0)), dir: w.dir.clone() };
}

export type ValidationResult = { ok: true; kind: ConnKind } | { ok: false; reason: string };

export function validateConnection(state: WState, a: PortRef, b: PortRef, creating = true, restoredId?: string): ValidationResult {
  const taken = (uid: string, port: string) => state.connections.some(c => c.id !== restoredId
    && ((c.a.uid === uid && c.a.port === port) || (c.b.uid === uid && c.b.port === port)));
  if (a.uid === b.uid && !b.uid.startsWith('joint:')) return { ok: false, reason: '不能把零件连接到它自己的接口。' };
  /* 螺栓 → 法兰连接孔位（两种传入顺序都接受） */
  if (a.uid.startsWith('joint:') || b.uid.startsWith('joint:')) {
    const boltRef = a.uid.startsWith('joint:') ? b : a;
    const jointRef = a.uid.startsWith('joint:') ? a : b;
    const ibolt = instOf(state, boltRef.uid);
    const pbolt = ibolt ? portDef(ibolt, boltRef.port) : undefined;
    if (!pbolt || pbolt.type !== 'bolt') return { ok: false, reason: '只有螺栓能安装到法兰螺栓孔位。' };
    const connId = jointRef.uid.slice(6);
    const slot = /^slot\d+$/.test(jointRef.port) ? Number(jointRef.port.slice(4)) : -1;
    const info = jointSlots(state, connId);
    if (!info) return { ok: false, reason: '该法兰连接不存在或不支持螺栓安装。' };
    if (slot < 0 || slot >= info.count) return { ok: false, reason: '螺栓孔位编号无效。' };
    if (taken(jointRef.uid, jointRef.port)) return { ok: false, reason: '该螺栓孔位已安装螺栓，请选择其他孔位。' };
    if (BOLT_DN[info.bolt] !== pbolt.dn) return { ok: false, reason: `螺栓规格不匹配：该法兰连接需要 ${info.bolt} 螺栓，当前为 M${pbolt.dn}。` };
    if (taken(boltRef.uid, boltRef.port)) return { ok: false, reason: '该螺栓已安装到孔位，请先拆除。' };
    return { ok: true, kind: 'bolt-slot' };
  }

  const ia = instOf(state, a.uid), ib = instOf(state, b.uid);
  if (!ia || !ib) return { ok: false, reason: '接口所属零件不存在。' };
  const pa = portDef(ia, a.port), pb = portDef(ib, b.port);

  /* 螺母 → 螺栓螺纹端 */
  if (pa?.type === 'nut' || pb?.type === 'nut') {
    const nutRef = pa?.type === 'nut' ? a : b;
    const boltRef = pa?.type === 'nut' ? b : a;
    const nut = instOf(state, nutRef.uid)!;
    const bolt = instOf(state, boltRef.uid);
    const bp = bolt ? portDef(bolt, boltRef.port) : undefined;
    if (!bolt || !bp || bp.type !== 'thread' || bp.standard !== 'M') return { ok: false, reason: '螺母只能与螺栓的螺纹端旋合。' };
    if (nut.spec.dn !== bolt.spec.dn) return { ok: false, reason: `螺母规格不匹配：螺栓为 M${bolt.spec.dn}，螺母为 M${nut.spec.dn}。` };
    if (taken(nutRef.uid, nutRef.port)) return { ok: false, reason: '该螺母已旋合到螺栓。' };
    if (taken(boltRef.uid, boltRef.port)) return { ok: false, reason: '该螺栓螺纹端已安装螺母。' };
    return { ok: true, kind: 'nut' };
  }

  /* 管夹/支架 → 直管外壁 */
  if (pa?.type === 'clamp' || pb?.type === 'clamp') {
    const clampRef = pa?.type === 'clamp' ? a : b;
    const pipeRef = pa?.type === 'clamp' ? b : a;
    const clamp = instOf(state, clampRef.uid)!;
    const pipe = instOf(state, pipeRef.uid);
    if (!pipe || pipe.partId !== 'pipe' || pipeRef.port !== 'surface') return { ok: false, reason: '管夹与支架只能安装在直管外壁。' };
    if (taken(clampRef.uid, clampRef.port)) return { ok: false, reason: '此管夹或支架已经安装。' };
    if (clamp.spec.dn !== pipe.spec.dn) return { ok: false, reason: `管夹规格不匹配：管道为 DN${pipe.spec.dn}，管夹为 DN${clamp.spec.dn}。` };
    return { ok: true, kind: 'clamp' };
  }

  if (!pa || !pb) return { ok: false, reason: '接口不存在。' };
  if (pa.type === 'mechanical' || pb.type === 'mechanical') {
    const ma = pa.mate, mb = pb.mate;
    if (!ma || !mb || ma.family !== mb.family || ma.gender === mb.gender || ma.mode !== mb.mode) {
      return { ok: false, reason: '配合不匹配：需要同一教学规格的插入端与承接端。' };
    }
    if (taken(a.uid, a.port) || taken(b.uid, b.port)) {
      return { ok: false, reason: '该机械配合位置已占用，请先解除配合。' };
    }
    if (creating && (a.port === 'washer-seat' || b.port === 'washer-seat')) {
      const bolt = a.port === 'washer-seat' ? ia : ib;
      if (taken(bolt.uid, 'shank') || taken(bolt.uid, 'end')) {
        return { ok: false, reason: '请先将垫圈套到未安装螺栓的头下，再把螺栓送入孔位。' };
      }
    }
    if (creating && ma.family === 'pump-P047-face') {
      const moving = ia.partId === 'P046' ? ia : ib;
      const stationary = ia.partId === 'P047' ? ia : ib;
      if (!taken(moving.uid, 'drive') || !taken(stationary.uid, 'seat')) {
        return { ok: false, reason: '先让动环装到轴套、静环装入座孔，再对合工作面。' };
      }
    }
    if (creating && componentOf(state, a.uid).has(b.uid) && !portsAligned(state, a, b)) {
      return { ok: false, reason: '同一子装配的配合位置未对齐，请检查先前安装的零件。' };
    }
    return { ok: true, kind: 'mechanical' };
  }
  if (!isFluidPort(pa) || !isFluidPort(pb)) return { ok: false, reason: '这两个接口不是管路连接接口。' };
  if (taken(a.uid, a.port)) return { ok: false, reason: `接口已占用：「${ia.partId ? partById(ia.partId)?.name : ''} · ${pa.label}」已有连接，请先断开。` };
  if (taken(b.uid, b.port)) return { ok: false, reason: `接口已占用：「${partById(ib.partId)?.name} · ${pb.label}」已有连接，请先断开。` };
  if (pa.type !== pb.type) {
    return { ok: false, reason: `连接类型不同：${PORT_TYPE_LABEL[pa.type]}与${PORT_TYPE_LABEL[pb.type]}不能直接连接，请改用匹配的接口或过渡件。` };
  }
  if (pa.dn !== pb.dn) {
    return { ok: false, reason: `尺寸不匹配：DN${pa.dn} 与 DN${pb.dn} 不能直接连接，请使用对应规格的异径管过渡。` };
  }
  if (pa.type === 'flange') {
    if (!standardCompatible('flange', pa.standard, pb.standard)) {
      return { ok: false, reason: `法兰标准不兼容：${pa.standard} 与 ${pb.standard} 的螺栓孔中心圆不同，无法配对。` };
    }
    if ((pa.boltCount ?? 0) !== (pb.boltCount ?? 0)) {
      return { ok: false, reason: '两片法兰的螺栓孔数量不一致，无法对齐紧固。' };
    }
  }
  if (pa.type === 'thread' && !standardCompatible('thread', pa.standard, pb.standard)) {
    return { ok: false, reason: `螺纹类型不匹配：${pa.standard} 与 ${pb.standard} 不能旋合。` };
  }
  if (pa.type === 'thread' && pa.threadSex && pa.threadSex === pb.threadSex) {
    return { ok: false, reason: '需要配对的内螺纹和外螺纹。' };
  }
  if (pa.type === 'weld') {
    const ma = partById(ia.partId)?.material;
    const mb = partById(ib.partId)?.material;
    if (ma !== mb) return { ok: false, reason: '焊接材质不匹配（教学规则：同材质才可对接焊）。' };
  }
  if ((pa.flow === 'in' && pb.flow === 'in') || (pa.flow === 'out' && pb.flow === 'out')) {
    return { ok: false, reason: `流向相反：两个接口同为${pa.flow === 'in' ? '进口' : '出口'}，有流向要求的部件需按进口对出口安装。` };
  }
  if (creating && (ia.partId === 'instr-rotameter' || ib.partId === 'instr-rotameter')) {
    // The installed inlet direction is down; the outlet direction is up.
    const installedA = ia.partId === 'instr-rotameter';
    const port = installedA ? pa : pb;
    const fixedAxis = portWorld(ia, a.port)?.dir.y ?? 0;
    const installedAxis = installedA ? fixedAxis : -fixedAxis;
    if (installedAxis * port.dir[1] < 0.99) {
      return { ok: false, reason: '转子流量计必须直立且从下往上进流，请先调整管路或仪表朝向。' };
    }
  }
  if (creating && componentOf(state, a.uid).has(b.uid) && !portsAligned(state, a, b)) {
    return { ok: false, reason: '同一子装配的闭合接口位置或轴向不符，请检查管路布局。' };
  }
  return { ok: true, kind: pa.type === 'flange' ? 'flange' : pa.type === 'thread' ? 'thread' : 'weld' };
}

export function portsAligned(state: WState, a: PortRef, b: PortRef): boolean {
  const ia = instOf(state, a.uid), ib = instOf(state, b.uid);
  if (!ia || !ib) return false;
  const wa = portWorld(ia, a.port), wb = portWorld(ib, b.port);
  if (!wa || !wb || wa.pos.distanceTo(wb.pos) > 0.015 || wa.dir.dot(wb.dir) > -0.999) return false;
  const pa = portDef(ia, a.port), pb = portDef(ib, b.port);
  if (!pa || !pb || (pa.mate?.mode !== 'fixed' && pa.type !== 'flange')) return true;
  const va = new THREE.Vector3(...phaseRef(pa.dir)).applyQuaternion(quatOf(ia));
  const vb = new THREE.Vector3(...phaseRef(pb.dir)).applyQuaternion(quatOf(ib));
  const angle = Math.atan2(va.clone().cross(vb).dot(wa.dir), va.dot(vb));
  const pitch = 2 * Math.PI / (pa.boltCount || 1);
  return Math.abs(angle - Math.round(angle / pitch) * pitch) < 0.035;
}

/* 对齐：把 instB 的 portB 移动到 targetPos、朝向 targetDir（与固定接口反向对接） */
export function alignTransform(
  inst: Instance, portId: string, targetPos: THREE.Vector3, targetDir: THREE.Vector3,
  bolt?: { pitch: number; phase: THREE.Vector3 }
): { pos: [number, number, number]; rot: [number, number, number] } {
  const p = portDef(inst, portId)!;
  const localPos = new THREE.Vector3(...p.pos);
  const localDir = new THREE.Vector3(...p.dir);
  const q0 = quatOf(inst);
  const worldDir = localDir.clone().applyQuaternion(q0);
  const q = new THREE.Quaternion().setFromUnitVectors(worldDir, targetDir.clone().normalize()).multiply(q0);
  if (bolt) {
    const cur = new THREE.Vector3(...phaseRef(p.dir)).applyQuaternion(q);
    const axis = targetDir.clone().normalize();
    const proj = (v: THREE.Vector3) => v.clone().addScaledVector(axis, -v.dot(axis)).normalize();
    const c = proj(cur), t = proj(bolt.phase);
    let ang = Math.atan2(c.clone().cross(t).dot(axis), c.dot(t));
    ang -= Math.round(ang / bolt.pitch) * bolt.pitch;
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, ang));
  }
  const pos = targetPos.clone().sub(localPos.clone().applyQuaternion(q));
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return { pos: [pos.x, pos.y, pos.z], rot: [e.x, e.y, e.z] };
}

function moveAssembly(state: WState, reference: Instance, transform: ReturnType<typeof alignTransform>) {
  const group = componentOf(state, reference.uid);
  const oldPosition = new THREE.Vector3(...reference.pos);
  const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(...transform.rot, 'XYZ')).multiply(quatOf(reference).invert());
  const newPosition = new THREE.Vector3(...transform.pos);
  for (const inst of state.instances) {
    if (!group.has(inst.uid)) continue;
    const position = new THREE.Vector3(...inst.pos).sub(oldPosition).applyQuaternion(delta).add(newPosition);
    const rotation = new THREE.Euler().setFromQuaternion(quatOf(inst).premultiply(delta), 'XYZ');
    inst.pos = [position.x, position.y, position.z];
    inst.rot = [rotation.x, rotation.y, rotation.z];
  }
}

function boltWasherThickness(state: WState, bolt: Instance): number {
  const edge = portOccupied(state, bolt.uid, 'washer-seat');
  const washer = edge && instOf(state, edge.a.uid === bolt.uid ? edge.b.uid : edge.a.uid);
  return washer?.partId === 'washer-flat' ? washerThickness(washer.spec.dn) : 0;
}

function boltSlotPose(state: WState, jointId: string, port: string, bolt: Instance) {
  const slot = slotWorld(state, jointId, Number(port.replace('slot', '')));
  const joint = state.connections.find(connection => connection.id === jointId);
  if (slot && joint?.meta?.boltStack) slot.pos.addScaledVector(slot.dir, -boltWasherThickness(state, bolt));
  return slot;
}

function alignNut(state: WState, connection: Connection) {
  const bolt = instOf(state, connection.a.uid);
  const nut = instOf(state, connection.b.uid);
  if (!bolt || !nut) return;
  const end = portWorld(bolt, connection.a.port);
  if (!end) return;
  const slot = state.connections.find(c => c.kind === 'bolt-slot' && c.a.uid === bolt.uid);
  const joint = slot && state.connections.find(c => c.id === slot.b.uid.slice('joint:'.length));
  const stack = joint?.meta?.boltStack;
  const shank = stack && portWorld(bolt, 'shank');
  const seat = stack && shank ? shank.pos.addScaledVector(end.dir, stack.grip + boltWasherThickness(state, bolt) + nutThickness(nut.spec.dn) / 2) : end.pos;
  const transform = alignTransform(nut, connection.b.port, seat, end.dir.clone().negate());
  nut.pos = transform.pos;
  nut.rot = transform.rot;
}

/* 创建连接：a 为固定侧，b 为移动侧（螺栓/螺母/管夹同样以 a 为基准） */
export function makeConnection(state: WState, a: PortRef, b: PortRef): { ok: boolean; reason?: string; conn?: Connection } {
  const v = validateConnection(state, a, b);
  if (!v.ok) return { ok: false, reason: v.reason };
  const conn: Connection = { id: newUid(), kind: v.kind, a: { ...a }, b: { ...b } };
  if (v.kind === 'bolt-slot') {
    const jointRef = a.uid.startsWith('joint:') ? a : b;
    const boltRef = a.uid.startsWith('joint:') ? b : a;
    const bolt = instOf(state, boltRef.uid)!;
    const w = boltSlotPose(state, jointRef.uid.slice(6), jointRef.port, bolt);
    if (w) {
      const t = alignTransform(bolt, boltRef.port, w.pos, w.dir);
      moveAssembly(state, bolt, t);
    }
    conn.a = { ...boltRef }; conn.b = { ...jointRef };
  } else if (v.kind === 'nut') {
    const nutIsA = portDef(instOf(state, a.uid)!, a.port)?.type === 'nut';
    const nutRef = nutIsA ? a : b;
    const boltRef = nutIsA ? b : a;
    conn.a = { ...boltRef }; conn.b = { ...nutRef };
    alignNut(state, conn);
  } else if (v.kind === 'clamp') {
    const clampIsA = portDef(instOf(state, a.uid)!, a.port)?.type === 'clamp';
    const clampRef = clampIsA ? a : b;
    const pipeRef = clampIsA ? b : a;
    const pipe = instOf(state, pipeRef.uid)!;
    const clamp = instOf(state, clampRef.uid)!;
    const pq = quatOf(pipe);
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(pq);
    const L = pipeLen(pipe.spec);
    const rel = new THREE.Vector3(...clamp.pos).sub(new THREE.Vector3(...pipe.pos));
    const endSpace = pipe.spec.endType === 'flange' ? flangeDims(pipe.spec.dn).t : 0;
    const inset = clamp.partId === 'support' ? Math.min(0.5, (endSpace + 0.9 * odU(pipe.spec.dn)) / L) : 0.05;
    const t = Math.max(inset, Math.min(1 - inset, rel.dot(axis) / L + 0.5));
    conn.meta = { t };
    conn.a = { ...pipeRef, port: 'surface' }; conn.b = { ...clampRef };
    applyClamp(state, conn);
  } else if (!componentOf(state, a.uid).has(b.uid)) {
    const ib = instOf(state, b.uid)!;
    const wa = portWorld(instOf(state, a.uid)!, a.port)!;
    const pa = portDef(instOf(state, a.uid)!, a.port)!;
    const indexed = (pa.type === 'flange' && pa.boltCount) || pa.mate?.mode === 'fixed';
    const boltAlign = indexed
      ? { pitch: (Math.PI * 2) / (pa.boltCount || 1), phase: new THREE.Vector3(...phaseRef(pa.dir)).applyQuaternion(quatOf(instOf(state, a.uid)!)) }
      : undefined;
    const t = alignTransform(ib, b.port, wa.pos, wa.dir.clone().negate(), boltAlign);
    moveAssembly(state, ib, t);
  }
  state.connections.push(conn);
  refreshDependents(state);
  return { ok: true, conn };
}

export function applyClamp(state: WState, conn: Connection) {
  const pipe = instOf(state, conn.a.uid);
  const clamp = instOf(state, conn.b.uid);
  if (!pipe || !clamp) return;
  const pq = quatOf(pipe);
  const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(pq);
  const L = (pipe.spec.length ?? 500) * 0.01;
  const t = conn.meta?.t ?? 0.5;
  const pos = new THREE.Vector3(...pipe.pos).addScaledVector(axis, (t - 0.5) * L);
  clamp.pos = [pos.x, pos.y, pos.z];
  const e = new THREE.Euler().setFromQuaternion(pq, 'XYZ');
  clamp.rot = [e.x, e.y, e.z];
}

/* 依赖件跟随：螺栓在孔位、螺母在螺栓、管夹在管道 */
export function refreshDependents(state: WState) {
  for (const c of state.connections) {
    if (c.kind === 'bolt-slot') {
      const bolt = instOf(state, c.a.uid);
      const w = bolt && boltSlotPose(state, c.b.uid.slice(6), c.b.port, bolt);
      if (w && bolt) {
        const t = alignTransform(bolt, c.a.port, w.pos, w.dir);
        bolt.pos = t.pos; bolt.rot = t.rot;
      }
    } else if (c.kind === 'nut') {
      alignNut(state, c);
    } else if (c.kind === 'clamp') {
      applyClamp(state, c);
    }
  }
}

export function removeConnection(state: WState, connId: string): number {
  const idx = state.connections.findIndex((c) => c.id === connId);
  if (idx < 0) return 0;
  const [c] = state.connections.splice(idx, 1);
  let removed = 1;
  if (c.kind === 'flange') {
    const jointKey = `joint:${connId}`;
    const bolts = state.connections.filter((x) => x.kind === 'bolt-slot' && x.b.uid === jointKey);
    for (const b of bolts) {
      state.connections = state.connections.filter((x) => x.id !== b.id);
      removed += 1;
    }
  }
  return removed;
}

/* 删除零件：连同依赖紧固件与相关连接 */
export function deleteInstances(state: WState, uids: string[]): { parts: number; conns: number } {
  const set = new Set(uids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of state.connections) {
      if (c.kind === 'bolt-slot' && set.has(c.a.uid)) { /* bolt removed below */ }
      if (c.kind === 'nut' && set.has(c.a.uid) && !set.has(c.b.uid)) { set.add(c.b.uid); changed = true; }
      if (c.kind === 'clamp' && set.has(c.a.uid) && !set.has(c.b.uid)) { set.add(c.b.uid); changed = true; }
      if (c.kind === 'bolt-slot') {
        const baseId = c.b.uid.slice(6);
        const base = state.connections.find((x) => x.id === baseId);
        if (base && (set.has(base.a.uid) || set.has(base.b.uid)) && !set.has(c.a.uid)) { set.add(c.a.uid); changed = true; }
      }
    }
  }
  const before = state.connections.length;
  state.connections = state.connections.filter((c) => {
    const aDel = set.has(c.a.uid) || (c.a.uid.startsWith('joint:') && !state.connections.some((x) => x.id === c.a.uid.slice(6)));
    const bDel = set.has(c.b.uid) || (c.b.uid.startsWith('joint:') && !state.connections.some((x) => x.id === c.b.uid.slice(6)));
    return !aDel && !bDel;
  });
  const conns = before - state.connections.length;
  state.instances = state.instances.filter((i) => !set.has(i.uid));
  for (const g of state.groups) { /* groups keep ids; members gone naturally */ void g; }
  refreshDependents(state);
  return { parts: set.size, conns };
}

/* 连通分量（流体连接 + 依赖紧固件），用于整体移动 */
export function componentOf(state: WState, uid: string): Set<string> {
  const set = new Set<string>([uid]);
  const queue = [uid];
  const joints = new Map(state.connections.filter(c => c.kind === 'flange').map(c => [c.id, c]));
  const endpoints = state.connections.map(c => {
    const base = c.kind === 'bolt-slot' ? joints.get(c.b.uid.slice(6)) : undefined;
    return base ? [c.a.uid, base.a.uid, base.b.uid] : [c.a.uid, c.b.uid];
  });
  for (const current of queue) {
    for (const edge of endpoints) {
      if (!edge.includes(current)) continue;
      for (const next of edge) {
        if (set.has(next) || next.startsWith('joint:')) continue;
        set.add(next);
        queue.push(next);
      }
    }
  }
  return set;
}

/* ============ 连接网络与连通检查 ============ */

interface Edge { to: string; toPort: string; directed: boolean }

function internalEdges(inst: Instance): [string, string, boolean][] {
  const ports = livePorts(inst).filter(isFluidPort);
  const part = partById(inst.partId);
  const edges: [string, string, boolean][] = [];
  if (!part) return edges;
  const passages = assemblyAssetById.get(inst.partId)?.passages;
  if (passages) {
    if (part.category === 'valve' && inst.open === false) return [];
    return passages.map(([a, b]) => [a, b, ports.find(port => port.id === a)?.flow === 'in']);
  }
  if (part.category === 'pipe' || part.id === 'gasket' || part.id === 'flange-so' || part.id === 'flange-wn' || part.id === 'tank-vertical') {
    for (let i = 0; i < ports.length; i++) for (let j = i + 1; j < ports.length; j++) {
      edges.push([ports[i].id, ports[j].id, false]);
    }
  } else if (part.id === 'valve-check') {
    edges.push(['p1', 'p2', true]);
  } else if (part.id === 'pump-centrifugal') {
    edges.push(['in', 'out', true]);
  } else if (part.id === 'heat-shell-tube') {
    edges.push(['tubeIn', 'tubeOut', true]);
    edges.push(['shellIn', 'shellOut', true]);
  } else if (part.category === 'valve') {
    if (inst.open !== false) edges.push(['p1', 'p2', false]);
  }
  return edges;
}

export function findPath(state: WState, start: PortRef, end: PortRef): { ok: boolean; path: PortRef[]; reason?: string } {
  const startInst = instOf(state, start.uid);
  const endInst = instOf(state, end.uid);
  if (!startInst || !endInst) return { ok: false, path: [], reason: '起点或终点零件不存在。' };
  const connByPort = new Map<string, { other: PortRef }>();
  for (const c of state.connections) {
    if (c.kind !== 'flange' && c.kind !== 'thread' && c.kind !== 'weld') continue;
    connByPort.set(`${c.a.uid}|${c.a.port}`, { other: c.b });
    connByPort.set(`${c.b.uid}|${c.b.port}`, { other: c.a });
  }
  const key = (r: PortRef) => `${r.uid}|${r.port}`;
  const prev = new Map<string, string>();
  const visited = new Set<string>([key(start)]);
  const queue: PortRef[] = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.uid === end.uid && cur.port === end.port) {
      const path: PortRef[] = [];
      let k: string | undefined = key(cur);
      while (k) {
        const [uid, port] = k.split('|');
        path.unshift({ uid, port });
        k = prev.get(k);
      }
      return { ok: true, path };
    }
    const inst = instOf(state, cur.uid)!;
    const nexts: PortRef[] = [];
    for (const [f, t, directed] of internalEdges(inst)) {
      if (f === cur.port) nexts.push({ uid: cur.uid, port: t });
      if (!directed && t === cur.port) nexts.push({ uid: cur.uid, port: f });
    }
    const link = connByPort.get(key(cur));
    if (link) nexts.push(link.other);
    for (const n of nexts) {
      const k = key(n);
      if (!visited.has(k)) { visited.add(k); prev.set(k, key(cur)); queue.push(n); }
    }
  }
  return { ok: false, path: [], reason: '指定起点与终点之间没有连通路径，请检查缺少的连接或关闭的阀门。' };
}

export function openPorts(state: WState): PortRef[] {
  const out: PortRef[] = [];
  for (const i of state.instances) {
    for (const p of livePorts(i)) {
      if (isFluidPort(p) && !portOccupied(state, i.uid, p.id)) out.push({ uid: i.uid, port: p.id });
    }
  }
  return out;
}

export function pathPositions(state: WState, path: PortRef[]): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (const r of path) {
    const inst = instOf(state, r.uid);
    if (!inst) continue;
    const w = portWorld(inst, r.port);
    if (w) pts.push(w.pos);
    const center = new THREE.Vector3(...inst.pos);
    if (pts.length && pts[pts.length - 1].distanceTo(center) > 0.01) pts.push(center);
  }
  return pts;
}

/* ============ 撤销 / 重做 ============ */

export class History {
  private stack: string[] = [];
  private index = -1;
  constructor(initial: WState) { this.stack.push(JSON.stringify(initial)); this.index = 0; }
  push(state: WState) {
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(JSON.stringify(state));
    if (this.stack.length > 60) this.stack.shift();
    this.index = this.stack.length - 1;
  }
  undo(): WState | null {
    if (this.index <= 0) return null;
    this.index -= 1;
    return JSON.parse(this.stack[this.index]);
  }
  redo(): WState | null {
    if (this.index >= this.stack.length - 1) return null;
    this.index += 1;
    return JSON.parse(this.stack[this.index]);
  }
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.stack.length - 1; }
}

export function emptyState(): WState {
  return { instances: [], connections: [], groups: [] };
}

export function cloneState(s: WState): WState {
  return JSON.parse(JSON.stringify(s));
}




