/* 接口布局：几何与接口位置的单一来源。
 * catalog 与 engine 都从这里取接口定义，保证模型与连接数据一致。 */
import type { PortDef, EndType } from './types';
import { MM } from './types';
import { dnSpec, flangeSpec, reducerSmall, reducerSmallValid } from './specs';
import { assemblyAssetById } from './expansion';
import { mechanical } from './expansion/contract';

export interface Spec { dn: number; length?: number; endType?: EndType; smallDn?: number }

const V = (x: number, y: number, z: number): [number, number, number] => [x, y, z];

export function odU(dn: number): number { return dnSpec(dn).od * MM; }

export function pipeLen(spec: Spec): number { return (spec.length ?? 500) * MM; }

export function elbowR(dn: number): number { return 1.5 * odU(dn); }

export function teeDims(dn: number): { L: number; H: number } {
  return { L: 2.6 * odU(dn), H: 1.3 * odU(dn) };
}

export function reducerDims(spec: Spec): { L: number; r1: number; r2: number; small: number } {
  const small = spec.smallDn !== undefined && reducerSmallValid(spec.dn, spec.smallDn) ? spec.smallDn : reducerSmall(spec.dn);
  const r1 = odU(spec.dn) / 2;
  const r2 = odU(small) / 2;
  return { L: 2 * (r1 - r2) + 0.8 * r1, r1, r2, small };
}

export function flangeDims(dn: number): { t: number; hub: number; r: number; k: number; n: number; hole: number } {
  const f = flangeSpec(dn);
  return { t: f.t * MM, hub: 0.9 * odU(dn), r: f.d * MM / 2, k: f.k * MM / 2, n: f.n, hole: f.hole * MM / 2 };
}

/** 对焊颈从法兰背面向焊口收窄，保留紧固件的外部安装空间。 */
export function weldNeckRadius(dn: number): number {
  const { k } = flangeDims(dn);
  const bolt = Number(flangeSpec(dn).bolt.replace('M', ''));
  const pipeRadius = odU(dn) / 2 + 0.02;
  return Math.min(pipeRadius * 1.6, k - boltDims(bolt).r * 1.89);
}
export function valveF(dn: number): number { return 3.2 * odU(dn); }

export const GASKET_THICKNESS = 3 * MM;

export function nutThickness(dn: number): number { return 0.8 * dn * MM; }

export function boltDims(db: number): { head: number; len: number; r: number } {
  return { head: 0.7 * db * MM, len: 3.2 * db * MM, r: db * MM / 2 };
}

function endPort(id: string, label: string, x: number, dirX: number, spec: Spec): PortDef {
  const end: EndType = spec.endType ?? 'weld';
  const base = { id, label, pos: V(x, 0, 0), dir: V(dirX, 0, 0), dn: spec.dn };
  if (end === 'thread') return { ...base, type: 'thread', standard: 'G', flow: 'both', threadSex: dirX < 0 ? 'internal' : 'external' };
  if (end === 'flange') {
    const f = flangeSpec(spec.dn);
    return { ...base, type: 'flange', standard: 'PN16', boltCount: f.n, flow: 'both' };
  }
  return { ...base, type: 'weld', flow: 'both' };
}

function flangeFace(id: string, label: string, x: number, dirX: number, dn: number, flow: 'in' | 'out' | 'both', blind = false): PortDef {
  const f = flangeSpec(dn);
  return { id, label, pos: V(x, 0, 0), dir: V(dirX, 0, 0), dn, type: 'flange', standard: 'PN16', boltCount: f.n, flow, blind };
}

/* 管件端部形式随规格设置：焊接 / 螺纹 / 法兰（与直管同一套预设） */
function withEnd(p: PortDef, spec: Spec, dn: number): PortDef {
  const end: EndType = spec.endType ?? 'weld';
  if (end === 'thread') return { ...p, type: 'thread', standard: 'G' };
  if (end === 'flange') {
    const f = flangeSpec(dn);
    return { ...p, type: 'flange', standard: 'PN16', boltCount: f.n };
  }
  return p;
}

export function portsFor(partId: string, spec: Spec): PortDef[] {
  const registered = assemblyAssetById.get(partId)?.ports;
  if (registered) return registered(spec);
  switch (partId) {
    case 'pipe': {
      const L = pipeLen(spec);
      return [endPort('p1', '接口 A', -L / 2, -1, spec), endPort('p2', '接口 B', L / 2, 1, spec)];
    }
    case 'elbow90': {
      const R = elbowR(spec.dn);
      return [
        withEnd({ id: 'p1', label: '进口端', pos: V(0, 0, 0), dir: V(-1, 0, 0), dn: spec.dn, type: 'weld', flow: 'both' }, spec, spec.dn),
        withEnd({ id: 'p2', label: '出口端（转向 90°）', pos: V(R, R, 0), dir: V(0, 1, 0), dn: spec.dn, type: 'weld', flow: 'both' }, spec, spec.dn)
      ];
    }
    case 'elbow45': {
      const R = elbowR(spec.dn);
      const s = Math.SQRT1_2;
      return [
        withEnd({ id: 'p1', label: '进口端', pos: V(0, 0, 0), dir: V(-1, 0, 0), dn: spec.dn, type: 'weld', flow: 'both' }, spec, spec.dn),
        withEnd({ id: 'p2', label: '出口端（转向 45°）', pos: V(R * s, R * (1 - s), 0), dir: V(s, s, 0), dn: spec.dn, type: 'weld', flow: 'both' }, spec, spec.dn)
      ];
    }
    case 'tee': case 'tee-reducing': {
      const { L, H } = teeDims(spec.dn);
      const branchDn = partId === 'tee-reducing' ? reducerSmall(spec.dn) : spec.dn;
      return [
        withEnd({ id: 'p1', label: '主管 A', pos: V(-L / 2, 0, 0), dir: V(-1, 0, 0), dn: spec.dn, type: 'weld', flow: 'both' }, spec, spec.dn),
        withEnd({ id: 'p2', label: '主管 B', pos: V(L / 2, 0, 0), dir: V(1, 0, 0), dn: spec.dn, type: 'weld', flow: 'both' }, spec, spec.dn),
        withEnd({ id: 'p3', label: partId === 'tee-reducing' ? `支管（DN${branchDn}）` : '支管', pos: V(0, H, 0), dir: V(0, 1, 0), dn: branchDn, type: 'weld', flow: 'both' }, spec, branchDn)
      ];
    }
    case 'cross': {
      const { L } = teeDims(spec.dn);
      return [
        withEnd({ id: 'p1', label: '接口 A', pos: V(-L / 2, 0, 0), dir: V(-1, 0, 0), dn: spec.dn, type: 'weld', flow: 'both' }, spec, spec.dn),
        withEnd({ id: 'p2', label: '接口 B', pos: V(L / 2, 0, 0), dir: V(1, 0, 0), dn: spec.dn, type: 'weld', flow: 'both' }, spec, spec.dn),
        withEnd({ id: 'p3', label: '接口 C', pos: V(0, L / 2, 0), dir: V(0, 1, 0), dn: spec.dn, type: 'weld', flow: 'both' }, spec, spec.dn),
        withEnd({ id: 'p4', label: '接口 D', pos: V(0, -L / 2, 0), dir: V(0, -1, 0), dn: spec.dn, type: 'weld', flow: 'both' }, spec, spec.dn)
      ];
    }
    case 'reducer-conc': case 'reducer-ecc': {
      const { L, r1, r2, small } = reducerDims(spec);
      const off = partId === 'reducer-ecc' ? -(r1 - r2) : 0;
      return [
        withEnd({ id: 'p1', label: `大端 DN${spec.dn}`, pos: V(-L / 2, 0, 0), dir: V(-1, 0, 0), dn: spec.dn, type: 'weld', flow: 'both' }, spec, spec.dn),
        withEnd({ id: 'p2', label: `小端 DN${small}`, pos: V(L / 2, off, 0), dir: V(1, 0, 0), dn: small, type: 'weld', flow: 'both' }, spec, small)
      ];
    }
    case 'cap':
      return [withEnd({ id: 'p1', label: '管端接口', pos: V(0, 0, 0), dir: V(-1, 0, 0), dn: spec.dn, type: 'weld', flow: 'both' }, spec, spec.dn)];
    case 'union': {
      const L = 2.2 * odU(spec.dn);
      return [
        { id: 'p1', label: '内螺纹端 A', pos: V(-L / 2, 0, 0), dir: V(-1, 0, 0), dn: spec.dn, type: 'thread', standard: 'G', flow: 'both', threadSex: 'internal' },
        { id: 'p2', label: '内螺纹端 B', pos: V(L / 2, 0, 0), dir: V(1, 0, 0), dn: spec.dn, type: 'thread', standard: 'G', flow: 'both', threadSex: 'internal' }
      ];
    }
    case 'flange-so': case 'flange-wn': {
      const { t, hub } = flangeDims(spec.dn);
      return [
        flangeFace('face', '法兰密封面', t / 2, 1, spec.dn, 'both'),
        { id: 'weld', label: '管侧焊接端', pos: V(-(t / 2 + hub), 0, 0), dir: V(-1, 0, 0), dn: spec.dn, type: 'weld', flow: 'both' }
      ];
    }
    case 'flange-blind': {
      const { t } = flangeDims(spec.dn);
      return [flangeFace('face', '盲板密封面', t / 2, 1, spec.dn, 'both', true)];
    }
    case 'gasket': {
      const th = GASKET_THICKNESS;
      const f = flangeSpec(spec.dn);
      return [
        { id: 'f1', label: '密封面 A', pos: V(-th / 2, 0, 0), dir: V(-1, 0, 0), dn: spec.dn, type: 'flange', standard: 'PN16', boltCount: f.n, flow: 'both' },
        { id: 'f2', label: '密封面 B', pos: V(th / 2, 0, 0), dir: V(1, 0, 0), dn: spec.dn, type: 'flange', standard: 'PN16', boltCount: f.n, flow: 'both' }
      ];
    }
    case 'bolt': {
      const { len } = boltDims(spec.dn);
      return [
        { id: 'shank', label: '螺栓杆（穿入螺栓孔）', pos: V(0, 0, 0), dir: V(1, 0, 0), dn: spec.dn, type: 'bolt', standard: 'M' },
        { id: 'end', label: '螺纹端（配螺母）', pos: V(len, 0, 0), dir: V(1, 0, 0), dn: spec.dn, type: 'thread', standard: 'M' },
        mechanical('washer-seat', '螺栓头下垫圈位', V(0, 0, 0), V(1, 0, 0), `bolt-washer-m${spec.dn}`, 'insert')
      ];
    }
    case 'nut':
      return [{ id: 'thread', label: '内螺纹', pos: V(0, 0, 0), dir: V(-1, 0, 0), dn: spec.dn, type: 'nut', standard: 'M' }];
    case 'clamp': case 'support':
      return [{ id: 'mount', label: '管道安装位', pos: V(0, 0, 0), dir: V(0, -1, 0), dn: spec.dn, type: 'clamp' }];
    case 'valve-ball': case 'valve-gate': case 'valve-check': {
      const F = valveF(spec.dn);
      return [
        flangeFace('p1', '进口（流向 →）', -F / 2, -1, spec.dn, 'in'),
        flangeFace('p2', '出口（流向 →）', F / 2, 1, spec.dn, 'out')
      ];
    }
    case 'pump-centrifugal':
      return [
        { ...flangeFace('in', '泵入口 DN80', -1.9, -1, 80, 'in'), pos: V(-1.9, 1.0, 0) },
        { ...flangeFace('out', '泵出口 DN65', 0, 1, 65, 'out'), pos: V(-0.55, 2.15, 0), dir: V(0, 1, 0) }
      ];
    case 'tank-vertical':
      return [
        { ...flangeFace('in', '顶部进料口 DN50', 0, 1, 50, 'both'), pos: V(0, 24.6, 0), dir: V(0, 1, 0) },
        { ...flangeFace('out', '底部出料口 DN80', 0, -1, 80, 'both'), pos: V(0, 5.0, 0), dir: V(0, -1, 0) },
        { ...flangeFace('lg', '液位计接口 DN25', 1, 0, 25, 'both'), pos: V(6.3, 15, 0), dir: V(1, 0, 0) }
      ];
    case 'heat-shell-tube':
      return [
        { ...flangeFace('tubeIn', '管程进口 DN65', 5, 1, 65, 'in'), pos: V(5, 1.5, 0), dir: V(1, 0, 0) },
        { ...flangeFace('tubeOut', '管程出口 DN65', -5, -1, 65, 'out'), pos: V(-5, 1.5, 0), dir: V(-1, 0, 0) },
        { ...flangeFace('shellIn', '壳程进口 DN50', -2, 1, 50, 'in'), pos: V(-2, 2.9, 0), dir: V(0, 1, 0) },
        { ...flangeFace('shellOut', '壳程出口 DN50', 2, -1, 50, 'out'), pos: V(2, 0.1, 0), dir: V(0, -1, 0) },
        mechanical('shell-saddle', '筒体下缘鞍座定位面', V(0, 0.3, 0), V(0, -1, 0), 'cylindrical-saddle-240', 'insert', 'fixed')
      ];
    default:
      return [];
  }
}

/* 法兰螺栓孔相位参考：垂直于接口轴线的局部 +Y（轴线平行 Y 时用 +Z） */
export function phaseRef(dir: [number, number, number]): [number, number, number] {
  return Math.abs(dir[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
}

