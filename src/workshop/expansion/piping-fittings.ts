import * as THREE from 'three';
import type { Spec } from '../layout';
import type { PortDef } from '../types';
import type { Vec3 } from './contract';
import { mechanical } from './contract';
import {
  add, box, curvedTube, flange, flangeFaceDimensions as flangeDims, flangeMesh,
  negativeX, outsideDiameter as odU, profile, roundPlate, solid, X, Y
} from './piping-geometry';

type Material = THREE.MeshStandardMaterial;
type ThreadKind = 'coupling' | 'reducer' | 'nipple' | 'plug';
const metal = new THREE.MeshStandardMaterial({ color: '#9aabb9', metalness: 0.63, roughness: 0.42 });

function fittingEnds(kind: ThreadKind, spec: Spec) {
  const d = odU(spec.dn);
  const span = { coupling: 1.85, reducer: 2.15, nipple: 2.45, plug: 1.08 }[kind] * d;
  return { left: -span / 2, right: span / 2, small: kind === 'reducer' ? (spec.smallDn ?? 25) : spec.dn };
}

export function threadedPorts(kind: ThreadKind, spec: Spec): PortDef[] {
  const { left, right, small } = fittingEnds(kind, spec);
  const threadSex = kind === 'nipple' || kind === 'plug' ? 'external' : 'internal';
  const ports: PortDef[] = [
    { id: 'p1', label: threadSex === 'internal' ? '内螺纹端 A' : '外螺纹端 A', pos: [left, 0, 0], dir: negativeX,
      dn: spec.dn, type: 'thread', standard: 'G', flow: 'both', threadSex, ...(kind === 'plug' ? { blind: true } : {}) }
  ];
  if (kind !== 'plug') {
    ports.push({ id: 'p2', label: `${threadSex === 'internal' ? '内' : '外'}螺纹端 B · DN${small}`,
      pos: [right, 0, 0], dir: X, dn: small, type: 'thread', standard: 'G', flow: 'both', threadSex });
  }
  return ports;
}

function threads(group: THREE.Group, radius: number, x0: number, span: number, material: Material) {
  const points = Array.from({ length: 88 }, (_, index) => {
    const percent = index / 87;
    const angle = 10 * Math.PI * percent;
    return new THREE.Vector3(x0 + span * percent, radius * Math.cos(angle), radius * Math.sin(angle));
  });
  const curve = new THREE.CatmullRomCurve3(points);
  add(group, new THREE.TubeGeometry(curve, 80, radius * 0.035, 6, false), material, [0, 0, 0]);
}

export const buildThreaded = (kind: ThreadKind) => (spec: Spec, material: Material): THREE.Group => {
  const group = new THREE.Group();
  const { left, right, small } = fittingEnds(kind, spec);
  const largeR = odU(spec.dn) / 2;
  const smallR = odU(small) / 2;
  if (kind === 'coupling' || kind === 'reducer') {
    profile(group, [
      [largeR * 0.95, left], [largeR * 1.25, left], [largeR * 1.33, left * 0.77],
      [largeR * 1.33, left * 0.27], [smallR * 1.29, right * 0.39],
      [smallR * 1.29, right * 0.82], [smallR * 1.2, right], [smallR * 0.95, right],
      [smallR * 0.82, right * 0.36], [largeR * 0.82, left * 0.22], [largeR * 0.95, left]
    ], [0, 0, 0], X, material);
    threads(group, largeR * 0.91, left, Math.abs(left) * 0.35, metal);
    threads(group, smallR * 0.91, right, -right * 0.35, metal);
    if (kind === 'coupling') roundPlate(group, largeR * 1.41, largeR * 1.08, largeR * 0.47, [0, 0, 0], X, metal, undefined, 6);
    return group;
  }
  if (kind === 'plug') {
    solid(group, largeR * 0.91, (right - left) * 0.68, [left + (right - left) * 0.34, 0, 0], material, X);
    roundPlate(group, largeR * 1.25, 0, (right - left) * 0.37, [right - (right - left) * 0.185, 0, 0], X, material, undefined, 6);
    threads(group, largeR * 0.94, left, (right - left) * 0.62, metal);
    return group;
  }
  roundPlate(group, largeR * 0.92, largeR * 0.66, right - left, [0, 0, 0], X, material);
  roundPlate(group, largeR * 1.24, largeR * 0.69, largeR * 0.78, [0, 0, 0], X, material, undefined, 6);
  threads(group, largeR * 0.94, left, -left * 0.58, metal);
  threads(group, largeR * 0.94, right, -right * 0.58, metal);
  return group;
};

function expansionEnds(spec: Spec): PortDef[] {
  const length = odU(spec.dn) * 4.25;
  return [flange(spec.dn, [-length / 2, 0, 0], negativeX, 'p1', '法兰端 A'),
    flange(spec.dn, [length / 2, 0, 0], X, 'p2', '法兰端 B')];
}
export { expansionEnds };

export function buildExpansion(spec: Spec, material: Material): THREE.Group {
  const group = new THREE.Group();
  const d = odU(spec.dn);
  const ports = expansionEnds(spec);
  const xa = ports[0].pos[0];
  const xb = ports[1].pos[0];
  const lo = xa + d * 0.36;
  const hi = xb - d * 0.36;
  const points: [number, number][] = [[d * 0.43, xa], [d * 0.56, xa]];
  for (let index = 0; index <= 60; index++) {
    const t = index / 60;
    points.push([d * (0.56 + 0.23 * (1 - Math.cos(t * 14 * Math.PI)) / 2), lo + (hi - lo) * t]);
  }
  points.push([d * 0.56, xb], [d * 0.43, xb], [d * 0.43, xa]);
  profile(group, points, [0, 0, 0], X, metal);
  for (const port of ports) flangeMesh(group, port.dn, port.pos, port.dir, material);
  return group;
}

class ReturnSpine extends THREE.Curve<THREE.Vector3> {
  constructor(private readonly radius: number) { super(); }
  getPoint(t: number, target = new THREE.Vector3()) {
    const angle = Math.PI * t;
    return target.set(this.radius * Math.sin(angle), this.radius * (1 - Math.cos(angle)), 0);
  }
}

const returnRadius = (dn: number) => 1.5 * odU(dn);

export function returnPorts(spec: Spec): PortDef[] {
  return [
    { id: 'p1', label: '对焊端 A', pos: [0, 0, 0], dir: negativeX, dn: spec.dn, type: 'weld', flow: 'both' },
    { id: 'p2', label: '对焊端 B', pos: [0, 2 * returnRadius(spec.dn), 0], dir: negativeX, dn: spec.dn, type: 'weld', flow: 'both' }
  ];
}

export function buildReturn(spec: Spec, material: Material): THREE.Group {
  const group = new THREE.Group();
  const radius = odU(spec.dn) / 2;
  curvedTube(group, new ReturnSpine(returnRadius(spec.dn)), radius, radius * 0.86, material);
  return group;
}

export function lapRingPorts(spec: Spec): PortDef[] {
  return [mechanical('shoulder', '松套法兰承托面', [flangeDims(spec.dn).t / 2, 0, 0], X, `lap-joint-dn${spec.dn}`, 'receive', 'fixed')];
}

export function buildLapRing(spec: Spec, material: Material): THREE.Group {
  const group = new THREE.Group();
  const f = flangeDims(spec.dn);
  roundPlate(group, f.r, odU(spec.dn) * 0.54, f.t, [0, 0, 0], X, material, { count: f.n, pitch: f.k, radius: f.hole });
  return group;
}

export function lapStubPorts(spec: Spec): PortDef[] {
  const d = odU(spec.dn);
  return [
    { id: 'weld', label: '管侧对焊端', pos: [-d * 1.5, 0, 0], dir: negativeX, dn: spec.dn, type: 'weld', flow: 'both' },
    flange(spec.dn, [0.21 * d, 0, 0], X, 'face', '翻边密封面（配松套法兰）'),
    mechanical('lap', '翻边背面', [0, 0, 0], negativeX, `lap-joint-dn${spec.dn}`, 'insert', 'fixed')
  ];
}

export function buildLapStub(spec: Spec, material: Material): THREE.Group {
  const d = odU(spec.dn);
  const group = new THREE.Group();
  profile(group, [[0.43 * d, -1.5 * d], [0.5 * d, -1.5 * d], [0.5 * d, -0.09 * d],
    [0.53 * d, 0], [0.76 * d, 0], [0.76 * d, 0.21 * d], [0.43 * d, 0.21 * d], [0.43 * d, -1.5 * d]], [0, 0, 0], X, material);
  return group;
}

export const washerThickness = (dn: number) => 0.15 * dn * 0.01;
export function washerPorts(spec: Spec): PortDef[] {
  return [mechanical('bore', '垫圈孔 · 螺栓头下面', [-washerThickness(spec.dn) / 2, 0, 0], negativeX,
    `bolt-washer-m${spec.dn}`, 'receive')];
}

export function buildWasher(spec: Spec, material: Material): THREE.Group {
  const group = new THREE.Group();
  const radius = spec.dn * 0.005;
  roundPlate(group, radius * 1.89, radius * 1.08, washerThickness(spec.dn), [0, 0, 0], X, material);
  return group;
}

export function buildUBolt(spec: Spec, material: Material): THREE.Group {
  const group = new THREE.Group();
  const radius = odU(spec.dn) / 2;
  const bar = Math.max(0.026, radius * 0.16);
  const bendR = radius + bar;
  const points = Array.from({ length: 33 }, (_, i) => {
    const angle = i / 32 * Math.PI;
    return new THREE.Vector3(0, bendR * Math.sin(angle), bendR * Math.cos(angle));
  });
  points.unshift(new THREE.Vector3(0, -radius * 1.72, bendR));
  points.push(new THREE.Vector3(0, -radius * 1.72, -bendR));
  add(group, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 48, bar, 11, false), material, [0, 0, 0]);
  box(group, [bar * 5.5, bar * 1.0, (bendR + bar * 2.1) * 2], [0, -radius * 1.28, 0], metal);
  for (const side of [-1, 1]) solid(group, bar * 1.75, bar * 1.35, [0, -radius * 1.48, side * bendR], metal, Y, 6);
  return group;
}

function saddleBand(group: THREE.Group, radius: number, arc: number, thickness: number, length: number, y: number, material: Material) {
  const shape = new THREE.Shape();
  for (const [r, start, finish] of [[radius / Math.cos(arc / 20), -arc, arc], [radius + thickness, arc, -arc]]) {
    for (let index = 0; index <= 20; index++) {
      const angle = start + (finish - start) * index / 20;
      const x = r * Math.sin(angle);
      const yy = radius - r * Math.cos(angle);
      if (start === -arc && index === 0) shape.moveTo(x, yy);
      else shape.lineTo(x, yy);
    }
  }
  shape.closePath();
  const band = add(group, new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false }), material, [-length / 2, y, 0]);
  band.rotation.y = Math.PI / 2;
}

export function buildPipeShoe(spec: Spec, material: Material): THREE.Group {
  const group = new THREE.Group();
  const r = odU(spec.dn) / 2;
  saddleBand(group, r, Math.PI / 3.1, r * 0.24, r * 3.1, -r, metal);
  box(group, [r * 3.1, r * 1.24, r * 0.32], [0, -r * 1.8, 0], material);
  box(group, [r * 3.6, r * 0.18, r * 2.0], [0, -r * 2.49, 0], material);
  return group;
}

export function pipeShoePorts(spec: Spec): PortDef[] {
  return [{ id: 'mount', label: '托板与管底接触面', pos: [0, -odU(spec.dn) / 2, 0], dir: Y, dn: spec.dn, type: 'clamp' }];
}

export function saddlePorts(): PortDef[] {
  return [mechanical('cradle', '鞍座弧面 · 筒壳下方', [0, 0, 0], Y, 'cylindrical-saddle-240', 'receive', 'fixed')];
}

export function buildVesselSaddle(_spec: Spec, material: Material): THREE.Group {
  const group = new THREE.Group();
  saddleBand(group, 1.2, Math.PI / 3.1, 0.105, 0.65, 0, metal);
  box(group, [0.56, 0.21, 1.45], [0, -0.137, 0], material);
  box(group, [0.86, 0.09, 2.03], [0, -0.255, 0], material);
  for (const z of [-0.76, 0.76]) {
    const web = box(group, [0.52, 0.48, 0.16], [0, -0.05, z], material);
    web.rotation.x = z > 0 ? 0.47 : -0.47;
  }
  return group;
}


