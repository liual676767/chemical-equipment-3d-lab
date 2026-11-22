import * as THREE from 'three';
import { cachedGeo, metal } from './industrial';
import type { PortRole } from '../data/processTypes';
import type { Vec3 } from '../data/types';

/**
 * 微沸喷烧流程设备外部教学模型（Phase 2）。
 *
 * - 仅建立设备外部形体、支腿/裙座与法兰接管口，不建内部结构（Phase 6）；
 * - 全部为参数化低面数教学模型，外形比例与接口位置为教学示意，不是工程尺寸；
 * - 每个模型声明接口锚点（局部坐标 + 外法线），数据侧按接口 id 引用并校验一致性；
 * - 不包含任何温度、压力、流量、型号、材料牌号等工程参数。
 */

export type BoilModelKey =
  | 'smp'
  | 'crusher'
  | 'mixer'
  | 'furnace-pump'
  | 'secondary-chamber'
  | 'spray-gun'
  | 'rotary-kiln'
  | 'quench-tower'
  | 'baghouse'
  | 'comprehensive-tower'
  | 'wash-tower'
  | 'wet-esp'
  | 'id-fan'
  | 'stack';

export type BoilPortSize = 'main' | 'branch' | 'utility';

export interface BoilModelPort {
  id: string;
  name: string;
  role: PortRole;
  media: string[];
  pos: Vec3;
  dir: Vec3;
  size: BoilPortSize;
  boundary?: boolean;
  note?: string;
}

export interface BoilModelDef {
  key: BoilModelKey;
  name: string;
  note: string;
  ports: BoilModelPort[];
  build: () => THREE.Group;
}

const UP = new THREE.Vector3(0, 1, 0);
const MAT = {
  shell: metal(0x5b7f9e, { rough: 0.55, metal: 0.35 }),
  shellAlt: metal(0x527a70, { rough: 0.58, metal: 0.3 }),
  shellWarm: metal(0x9a6b52, { rough: 0.6, metal: 0.28 }),
  steel: metal(0x9aa6b2, { rough: 0.3, metal: 0.82 }),
  dark: metal(0x36424f, { rough: 0.52, metal: 0.35 }),
  rubber: metal(0x202833, { rough: 0.9, metal: 0.05 }),
  concrete: metal(0x6b7379, { rough: 0.96, metal: 0.02 }),
  accent: metal(0x3f7fbf, { rough: 0.42, metal: 0.5 }),
  hot: metal(0x9b5b45, { rough: 0.65, metal: 0.25 })
};

const PORT_GEOM: Record<BoilPortSize, { stub: number; r: number; flange: number }> = {
  main: { stub: 0.22, r: 0.09, flange: 0.17 },
  branch: { stub: 0.2, r: 0.07, flange: 0.14 },
  utility: { stub: 0.18, r: 0.055, flange: 0.11 }
};

function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  return cachedGeo(`boil|${key}`, make);
}

function put(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function box(parent: THREE.Object3D, w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  return put(parent, geo(`b|${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d)), material, x, y, z);
}

function cyl(parent: THREE.Object3D, rTop: number, rBottom: number, h: number, material: THREE.Material, x = 0, y = 0, z = 0, seg = 24): THREE.Mesh {
  return put(parent, geo(`cy|${rTop}|${rBottom}|${h}|${seg}`, () => new THREE.CylinderGeometry(rTop, rBottom, h, seg)), material, x, y, z);
}

function cylX(parent: THREE.Object3D, r: number, len: number, material: THREE.Material, x = 0, y = 0, z = 0, seg = 24): THREE.Mesh {
  const m = put(parent, geo(`cx|${r}|${len}|${seg}`, () => new THREE.CylinderGeometry(r, r, len, seg)), material, x, y, z);
  m.rotation.z = Math.PI / 2;
  return m;
}

function cylZ(parent: THREE.Object3D, r: number, len: number, material: THREE.Material, x = 0, y = 0, z = 0, seg = 24): THREE.Mesh {
  const m = put(parent, geo(`cz|${r}|${len}|${seg}`, () => new THREE.CylinderGeometry(r, r, len, seg)), material, x, y, z);
  m.rotation.x = Math.PI / 2;
  return m;
}

function dome(parent: THREE.Object3D, r: number, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  return put(parent, geo(`d|${r}`, () => new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)), material, x, y, z);
}

function torusY(parent: THREE.Object3D, radius: number, tube: number, material: THREE.Material, y = 0, x = 0, z = 0): THREE.Mesh {
  const m = put(parent, geo(`ty|${radius}|${tube}`, () => new THREE.TorusGeometry(radius, tube, 8, 36)), material, x, y, z);
  m.rotation.x = Math.PI / 2;
  return m;
}

function torusX(parent: THREE.Object3D, radius: number, tube: number, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = put(parent, geo(`tx|${radius}|${tube}`, () => new THREE.TorusGeometry(radius, tube, 8, 36)), material, x, y, z);
  m.rotation.y = Math.PI / 2;
  return m;
}

function cylinderBetween(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material, seg = 14): THREE.Mesh {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const m = put(parent, geo(`cb|${radius}|${len.toFixed(3)}|${seg}`, () => new THREE.CylinderGeometry(radius, radius, len, seg)), material);
  m.position.copy(a.clone().add(b).multiplyScalar(0.5));
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  return m;
}

function addLegs(parent: THREE.Object3D, height: number, sx: number, sz: number, material: THREE.Material): void {
  for (const x of [-sx, sx]) {
    for (const z of [-sz, sz]) {
      cyl(parent, 0.08, 0.08, height, material, x, height / 2, z, 10);
      box(parent, 0.46, 0.06, 0.46, material, x, 0.03, z);
    }
  }
}

function addLadder(parent: THREE.Object3D, x: number, z: number, y0: number, y1: number): void {
  for (const s of [-1, 1]) cyl(parent, 0.022, 0.022, y1 - y0, MAT.steel, x + s * 0.18, (y0 + y1) / 2, z, 8);
  const steps = Math.max(2, Math.floor((y1 - y0) / 0.4));
  for (let i = 0; i <= steps; i++) {
    const y = y0 + ((y1 - y0) * i) / steps;
    box(parent, 0.36, 0.028, 0.028, MAT.steel, x, y, z);
  }
}

function addNozzleSet(group: THREE.Group, ports: BoilModelPort[]): void {
  const boltGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.07, 6);
  for (const p of ports) {
    const spec = PORT_GEOM[p.size];
    const dir = new THREE.Vector3(p.dir[0], p.dir[1], p.dir[2]).normalize();
    const anchor = new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]);
    const inner = anchor.clone().addScaledVector(dir, -spec.stub);
    const stub = cylinderBetween(group, inner, anchor, spec.r, MAT.steel, 16);
    stub.userData.portId = p.id;
    const flange = cylinderBetween(group, anchor.clone().addScaledVector(dir, -0.024), anchor.clone().addScaledVector(dir, 0.024), spec.flange, MAT.steel, 20);
    flange.userData.portId = p.id;
    const side = Math.abs(dir.dot(new THREE.Vector3(1, 0, 0))) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(dir, side).normalize();
    const v = new THREE.Vector3().crossVectors(dir, u).normalize();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const off = u.clone().multiplyScalar(Math.cos(a) * spec.flange * 0.72).addScaledVector(v, Math.sin(a) * spec.flange * 0.72);
      const bolt = new THREE.Mesh(boltGeo, MAT.dark);
      bolt.position.copy(anchor).add(off).addScaledVector(dir, 0.035);
      bolt.quaternion.setFromUnitVectors(UP, dir);
      bolt.userData.portId = p.id;
      group.add(bolt);
    }
  }
}

function buildSmp(): THREE.Group {
  const g = new THREE.Group();
  box(g, 4.4, 0.26, 2.8, MAT.dark, 0, 0.13, 0);
  box(g, 3.2, 2.2, 2.2, MAT.shell, -0.2, 1.5, 0);
  box(g, 0.5, 0.7, 0.9, MAT.dark, 1.55, 1.35, 0.55);
  const hopper = cyl(g, 0.55, 0.95, 1.0, MAT.shellAlt, -1.1, 3.0, 0, 4);
  hopper.rotation.y = Math.PI / 4;
  box(g, 1.65, 0.08, 1.65, MAT.steel, -1.1, 2.5, 0);
  box(g, 0.5, 0.06, 0.5, MAT.dark, -1.1, 3.52, 0);
  return g;
}

function buildCrusher(): THREE.Group {
  const g = new THREE.Group();
  box(g, 2.8, 0.3, 2.2, MAT.dark, 0, 0.15, 0);
  box(g, 1.9, 1.6, 1.9, MAT.shellWarm, 0, 1.3, 0);
  const hopper = cyl(g, 0.7, 1.0, 0.9, MAT.shellWarm, 0, 2.55, 0, 4);
  hopper.rotation.y = Math.PI / 4;
  box(g, 0.72, 0.62, 0.72, MAT.dark, -1.32, 1.05, 0);
  box(g, 0.5, 0.16, 0.3, MAT.steel, -0.92, 1.05, 0);
  return g;
}

function buildMixer(): THREE.Group {
  const g = new THREE.Group();
  addLegs(g, 0.8, 0.78, 0.78, MAT.steel);
  cyl(g, 1.05, 0.55, 0.55, MAT.shell, 0, 1.075, 0);
  cyl(g, 1.05, 1.05, 2.0, MAT.shell, 0, 2.35, 0);
  dome(g, 1.05, MAT.shell, 0, 3.35, 0);
  box(g, 0.55, 0.45, 0.55, MAT.dark, 0, 4.56, 0);
  cyl(g, 0.28, 0.28, 0.65, MAT.accent, 0, 5.1, 0);
  torusY(g, 1.06, 0.035, MAT.steel, 1.5);
  return g;
}

function buildFurnacePump(): THREE.Group {
  const g = new THREE.Group();
  box(g, 2.9, 0.26, 1.5, MAT.dark, 0, 0.13, 0);
  cylX(g, 0.5, 1.4, MAT.shellWarm, -0.3, 0.95, 0);
  cylX(g, 0.55, 0.08, MAT.steel, -1.02, 0.95, 0);
  cylX(g, 0.55, 0.08, MAT.steel, 0.42, 0.95, 0);
  cylX(g, 0.36, 1.0, MAT.accent, 1.2, 0.95, 0);
  box(g, 0.35, 0.48, 0.48, MAT.dark, 0.55, 0.95, 0);
  cyl(g, 0.17, 0.17, 0.5, MAT.steel, -0.3, 1.7, 0);
  box(g, 0.42, 0.18, 0.42, MAT.dark, -1.15, 0.3, 0);
  box(g, 0.42, 0.18, 0.42, MAT.dark, 1.55, 0.3, 0);
  return g;
}

function buildSecondaryChamber(): THREE.Group {
  const g = new THREE.Group();
  cyl(g, 1.3, 1.3, 0.7, MAT.dark, 0, 0.35, 0);
  cyl(g, 1.5, 1.5, 4.6, MAT.shellWarm, 0, 3.0, 0);
  dome(g, 1.5, MAT.shellWarm, 0, 5.3, 0);
  for (const y of [1.5, 3.0, 4.5]) torusY(g, 1.51, 0.045, MAT.steel, y);
  cylZ(g, 0.34, 0.12, MAT.steel, 0, 1.15, 1.51);
  addLadder(g, -1.32, -1.0, 0.7, 5.2);
  return g;
}

function buildSprayGun(): THREE.Group {
  const g = new THREE.Group();
  box(g, 1.1, 0.16, 0.7, MAT.dark, 0, 0.08, 0);
  cyl(g, 0.09, 0.09, 1.25, MAT.steel, -0.45, 0.72, 0);
  box(g, 0.22, 0.3, 0.34, MAT.dark, -0.45, 1.4, 0);
  cylX(g, 0.13, 0.55, MAT.shellWarm, -1.0, 1.5, 0);
  cylX(g, 0.07, 2.2, MAT.steel, 0.1, 1.5, 0);
  cylX(g, 0.05, 0.25, MAT.steel, 1.325, 1.5, 0);
  cylX(g, 0.09, 0.18, MAT.dark, 1.45, 1.5, 0);
  cylX(g, 0.16, 0.08, MAT.steel, 0.2, 1.5, 0);
  return g;
}

function buildRotaryKiln(): THREE.Group {
  const g = new THREE.Group();
  for (const x of [-2.2, 2.2]) {
    for (const z of [-0.66, 0.66]) {
      box(g, 0.52, 0.3, 0.42, MAT.concrete, x, 0.15, z);
      box(g, 0.34, 0.5, 0.34, MAT.dark, x, 0.55, z);
      cylZ(g, 0.2, 0.26, MAT.steel, x, 0.86, z);
    }
  }
  cylX(g, 1.2, 7.0, MAT.shellWarm, 0, 2.2, 0, 28);
  for (const x of [-2.2, 2.2]) torusX(g, 1.27, 0.1, MAT.steel, x, 2.2, 0);
  torusX(g, 1.36, 0.12, MAT.dark, 1.0, 2.2, 0);
  box(g, 0.9, 0.62, 0.62, MAT.dark, 1.0, 0.95, 1.55);
  cylX(g, 0.18, 0.38, MAT.steel, 1.0, 1.1, 0.9);
  box(g, 0.6, 1.9, 1.9, MAT.dark, -3.8, 2.2, 0);
  box(g, 0.6, 1.9, 1.9, MAT.dark, 3.8, 2.2, 0);
  for (const x of [-3.4, 3.4]) box(g, 0.5, 1.0, 1.4, MAT.steel, x, 0.5, 0);
  return g;
}

function buildQuenchTower(): THREE.Group {
  const g = new THREE.Group();
  cyl(g, 1.15, 1.15, 0.9, MAT.dark, 0, 0.45, 0);
  cyl(g, 1.3, 0.55, 0.8, MAT.shellAlt, 0, 1.3, 0);
  cyl(g, 1.3, 1.3, 5.6, MAT.shellAlt, 0, 4.5, 0);
  dome(g, 1.3, MAT.shellAlt, 0, 7.3, 0);
  cyl(g, 0.5, 0.5, 1.4, MAT.steel, 0, 9.0, 0);
  torusY(g, 0.51, 0.035, MAT.dark, 9.7);
  for (const y of [2.2, 4.2, 6.2]) torusY(g, 1.31, 0.035, MAT.steel, y);
  addLadder(g, -1.16, -1.0, 0.9, 7.2);
  return g;
}

function buildBaghouse(): THREE.Group {
  const g = new THREE.Group();
  addLegs(g, 1.0, 1.3, 0.9, MAT.steel);
  box(g, 2.9, 0.12, 0.12, MAT.steel, 0, 1.0, -0.9);
  box(g, 2.9, 0.12, 0.12, MAT.steel, 0, 1.0, 0.9);
  box(g, 0.12, 0.12, 1.8, MAT.steel, -1.3, 1.0, 0);
  box(g, 0.12, 0.12, 1.8, MAT.steel, 1.3, 1.0, 0);
  const hopper = cyl(g, 1.9, 0.45, 1.2, MAT.shell, 0, 1.6, 0, 4);
  hopper.rotation.y = Math.PI / 4;
  box(g, 4.0, 3.0, 2.4, MAT.shell, 0, 3.7, 0);
  for (const x of [-1.0, 0, 1.0]) {
    cylZ(g, 0.09, 2.2, MAT.steel, x, 5.4, 0);
    cyl(g, 0.08, 0.08, 0.32, MAT.dark, x, 5.62, 1.05);
  }
  cylX(g, 0.1, 3.2, MAT.steel, 0, 5.4, 1.18);
  box(g, 0.7, 0.9, 0.08, MAT.dark, -1.1, 3.3, 1.22);
  addLadder(g, -1.7, -1.05, 1.0, 5.2);
  return g;
}

function buildComprehensiveTower(): THREE.Group {
  const g = new THREE.Group();
  cyl(g, 1.35, 1.35, 1.0, MAT.dark, 0, 0.5, 0);
  cyl(g, 1.6, 0.7, 0.8, MAT.shell, 0, 1.4, 0);
  cyl(g, 1.6, 1.6, 6.0, MAT.shell, 0, 4.8, 0);
  dome(g, 1.6, MAT.shell, 0, 7.8, 0);
  cyl(g, 0.6, 0.6, 1.3, MAT.steel, 0, 9.0, 0);
  torusY(g, 0.61, 0.04, MAT.dark, 9.65);
  for (const y of [2.4, 4.4, 6.4]) torusY(g, 1.61, 0.04, MAT.steel, y);
  torusY(g, 1.75, 0.05, MAT.dark, 7.0);
  addLadder(g, -1.42, -1.1, 1.0, 7.6);
  return g;
}

function buildWashTower(): THREE.Group {
  const g = new THREE.Group();
  cyl(g, 0.95, 0.95, 0.8, MAT.dark, 0, 0.4, 0);
  cyl(g, 1.15, 0.5, 0.7, MAT.shellAlt, 0, 1.15, 0);
  cyl(g, 1.15, 1.15, 5.0, MAT.shellAlt, 0, 4.0, 0);
  dome(g, 1.15, MAT.shellAlt, 0, 6.5, 0);
  for (const y of [1.9, 3.6, 5.3]) torusY(g, 1.16, 0.03, MAT.steel, y);
  addLadder(g, -1.0, -0.9, 0.8, 6.3);
  return g;
}

function buildWetEsp(): THREE.Group {
  const g = new THREE.Group();
  addLegs(g, 1.0, 1.0, 0.8, MAT.steel);
  box(g, 2.2, 0.12, 0.12, MAT.steel, 0, 1.0, -0.8);
  box(g, 2.2, 0.12, 0.12, MAT.steel, 0, 1.0, 0.8);
  box(g, 0.12, 0.12, 1.6, MAT.steel, -1.0, 1.0, 0);
  box(g, 0.12, 0.12, 1.6, MAT.steel, 1.0, 1.0, 0);
  const hopper = cyl(g, 1.4, 0.4, 1.0, MAT.shellAlt, 0, 1.5, 0, 4);
  hopper.rotation.y = Math.PI / 4;
  box(g, 2.6, 4.8, 2.4, MAT.shellAlt, 0, 4.4, 0);
  for (const x of [-0.6, 0.6]) {
    for (const z of [-0.5, 0.5]) {
      cyl(g, 0.11, 0.11, 0.5, MAT.steel, x, 7.05, z);
      cyl(g, 0.2, 0.2, 0.08, MAT.dark, x, 7.34, z);
    }
  }
  box(g, 0.7, 1.0, 0.08, MAT.dark, -0.7, 3.8, 1.22);
  addLadder(g, -1.1, -1.05, 1.0, 6.6);
  return g;
}

function buildIdFan(): THREE.Group {
  const g = new THREE.Group();
  box(g, 2.8, 0.26, 1.8, MAT.dark, 0, 0.13, 0);
  cylZ(g, 1.05, 0.9, MAT.shell, 0, 1.55, 0, 28);
  cylZ(g, 0.55, 0.5, MAT.steel, 0, 1.55, -0.7, 20);
  cylZ(g, 1.12, 0.08, MAT.steel, 0, 1.55, 0.49, 28);
  box(g, 0.5, 0.6, 0.5, MAT.steel, 0.85, 2.55, 0);
  cyl(g, 0.4, 0.4, 0.7, MAT.steel, 0.85, 3.0, 0);
  box(g, 0.8, 0.7, 0.7, MAT.accent, 0, 1.35, 1.15);
  cylZ(g, 0.12, 0.5, MAT.steel, 0, 1.55, 0.75);
  return g;
}

function buildStack(): THREE.Group {
  const g = new THREE.Group();
  box(g, 3.0, 0.3, 3.0, MAT.concrete, 0, 0.15, 0);
  cyl(g, 0.9, 1.5, 11.0, MAT.shellWarm, 0, 5.8, 0, 28);
  torusY(g, 0.91, 0.06, MAT.dark, 11.3);
  for (const y of [2.6, 5.4, 8.2]) torusY(g, 1.5 - (y - 0.3) * (0.6 / 11), 0.035, MAT.steel, y);
  torusY(g, 1.05, 0.05, MAT.dark, 8.2);
  addLadder(g, 0, -1.35, 0.3, 11.0);
  return g;
}

function p(
  id: string,
  name: string,
  role: PortRole,
  media: string[],
  pos: Vec3,
  dir: Vec3,
  size: BoilPortSize,
  opts: Partial<Pick<BoilModelPort, 'boundary' | 'note'>> = {}
): BoilModelPort {
  return { id, name, role, media, pos, dir, size, ...opts };
}

export const BOIL_MODELS: Record<BoilModelKey, BoilModelDef> = {
  smp: {
    key: 'smp',
    name: 'SMP装置',
    note: 'SMP 组成与内部结构未提供；外部按接收/预处理教学单元示意，不推测具体设备构成。',
    build: buildSmp,
    ports: [
      p('feedIn', '来料入口', 'in', ['media-material'], [-1.1, 3.66, 0], [0, 1, 0], 'main', { boundary: true }),
      p('discharge', '物料出口', 'out', ['media-material'], [1.56, 0.8, 0], [1, 0, 0], 'main')
    ]
  },
  crusher: {
    key: 'crusher',
    name: '破碎机',
    note: '破碎方式与内部结构未提供；外部按进料斗 + 破碎腔 + 驱动教学示意。',
    build: buildCrusher,
    ports: [
      p('materialIn', '物料入口', 'in', ['media-material'], [0, 3.16, 0], [0, 1, 0], 'main'),
      p('materialOut', '物料出口', 'out', ['media-material'], [1.17, 0.65, 0], [1, 0, 0], 'main')
    ]
  },
  mixer: {
    key: 'mixer',
    name: '混合器',
    note: '混合方式与内件未提供；外部按立式混合罐 + 顶部驱动教学示意。',
    build: buildMixer,
    ports: [
      p('materialIn', '物料入口', 'in', ['media-material'], [1.21, 3.0, 0], [1, 0, 0], 'main'),
      p('materialOut', '物料出口', 'out', ['media-material'], [1.15, 0.95, 0], [1, 0, 0], 'main')
    ]
  },
  'furnace-pump': {
    key: 'furnace-pump',
    name: '炉塞泵',
    note: '泵型（柱塞/螺杆/其他）未确认；外部按通用容积泵 + 电机教学示意，不代表具体型式。',
    build: buildFurnacePump,
    ports: [
      p('materialIn', '物料入口', 'in', ['media-material'], [-1.22, 0.95, 0], [-1, 0, 0], 'main'),
      p('materialOut', '物料出口', 'out', ['media-material'], [-0.3, 1.95, 0], [0, 1, 0], 'main')
    ]
  },
  'secondary-chamber': {
    key: 'secondary-chamber',
    name: '二燃室',
    note: '炉膛结构与燃烧组织未提供；外部按立式燃烧室教学示意，不表示实际炉型。',
    build: buildSecondaryChamber,
    ports: [
      p('materialIn', '物料入口', 'in', ['media-material'], [1.66, 2.0, 0], [1, 0, 0], 'main'),
      p('gasOut', '烟气出口', 'out', ['media-flue-gas'], [1.66, 4.9, 0], [1, 0, 0], 'main')
    ]
  },
  'spray-gun': {
    key: 'spray-gun',
    name: '喷枪',
    note: '喷入介质、喷嘴型式与接入位置未确认；外部按喷枪本体 + 支座教学示意。',
    build: buildSprayGun,
    ports: [
      p('feedIn', '喷入介质入口', 'in', ['media-spray-medium'], [-1.5, 1.5, 0], [-1, 0, 0], 'branch'),
      p('nozzleOut', '喷出口', 'out', ['media-spray-medium'], [1.58, 1.5, 0], [1, 0, 0], 'branch')
    ]
  },
  'rotary-kiln': {
    key: 'rotary-kiln',
    name: '回转窑',
    note: '筒体尺寸、倾角、转速与内部运动未提供；外部按筒体 + 轮带 + 托轮 + 传动教学示意。',
    build: buildRotaryKiln,
    ports: [
      p('gasIn', '烟气入口', 'in', ['media-flue-gas'], [-4.26, 2.2, 0], [-1, 0, 0], 'main'),
      p('gasOut', '烟气出口', 'out', ['media-flue-gas'], [4.26, 2.2, 0], [1, 0, 0], 'main')
    ]
  },
  'quench-tower': {
    key: 'quench-tower',
    name: '集冷塔',
    note: '冷却方式与塔内件未提供；外部按立式塔器 + 裙座 + 顶部排气教学示意。',
    build: buildQuenchTower,
    ports: [
      p('gasIn', '烟气入口', 'in', ['media-flue-gas'], [1.46, 3.0, 0], [1, 0, 0], 'main'),
      p('gasOut', '烟气出口', 'out', ['media-flue-gas'], [0, 9.86, 0], [0, 1, 0], 'main')
    ]
  },
  baghouse: {
    key: 'baghouse',
    name: '布袋除尘器',
    note: '滤袋、花板、净气室、灰斗与清灰方式未提供；外部按箱体 + 灰斗 + 顶部喷吹管教学示意。',
    build: buildBaghouse,
    ports: [
      p('gasIn', '烟气入口', 'in', ['media-flue-gas'], [2.12, 2.8, 0], [1, 0, 0], 'main'),
      p('gasOut', '烟气出口', 'out', ['media-flue-gas'], [2.12, 4.7, 0], [1, 0, 0], 'main')
    ]
  },
  'comprehensive-tower': {
    key: 'comprehensive-tower',
    name: '综合塔',
    note: '塔型与吸收/中和工艺未确认；外部按立式塔器教学示意，不表示实际塔型。',
    build: buildComprehensiveTower,
    ports: [
      p('gasIn', '烟气入口', 'in', ['media-flue-gas'], [1.76, 2.7, 0], [1, 0, 0], 'main'),
      p('gasOut', '烟气出口', 'out', ['media-flue-gas'], [0, 9.86, 0], [0, 1, 0], 'main')
    ]
  },
  'wash-tower': {
    key: 'wash-tower',
    name: '水洗塔',
    note: '喷淋方式、水质与循环量未提供；外部按立式水洗塔教学示意。',
    build: buildWashTower,
    ports: [
      p('gasIn', '烟气入口', 'in', ['media-flue-gas'], [1.31, 2.4, 0], [1, 0, 0], 'main'),
      p('gasOut', '烟气出口', 'out', ['media-flue-gas'], [1.31, 6.0, 0], [1, 0, 0], 'main')
    ]
  },
  'wet-esp': {
    key: 'wet-esp',
    name: '湿电除尘',
    note: '电场、集尘极、喷淋冲洗与电气参数未提供；外部按湿式电除尘壳体 + 顶部绝缘子教学示意。',
    build: buildWetEsp,
    ports: [
      p('gasIn', '烟气入口', 'in', ['media-flue-gas'], [1.48, 2.8, 0], [1, 0, 0], 'main'),
      p('gasOut', '烟气出口', 'out', ['media-flue-gas'], [1.48, 6.0, 0], [1, 0, 0], 'main')
    ]
  },
  'id-fan': {
    key: 'id-fan',
    name: '引风机',
    note: '风机型式、叶轮与风量/风压未提供；外部按离心式风机壳体 + 电机教学示意。',
    build: buildIdFan,
    ports: [
      p('gasIn', '烟气入口', 'in', ['media-flue-gas'], [0, 1.55, -1.17], [0, 0, -1], 'main'),
      p('gasOut', '烟气出口', 'out', ['media-flue-gas'], [0.85, 3.36, 0], [0, 1, 0], 'main')
    ]
  },
  stack: {
    key: 'stack',
    name: '烟囱',
    note: '排放高度、内衬、监测与排放参数未提供；外部按锥形烟囱 + 基础教学示意，不表示实际高度。',
    build: buildStack,
    ports: [
      p('gasIn', '烟气入口', 'in', ['media-flue-gas'], [1.66, 1.2, 0], [1, 0, 0], 'main'),
      p('emissionOut', '排放口', 'out', ['media-flue-gas'], [0, 11.5, 0], [0, 1, 0], 'main', { boundary: true })
    ]
  }
};

export const BOIL_MODEL_KEYS = Object.keys(BOIL_MODELS) as BoilModelKey[];

export function buildBoilModel(key: BoilModelKey | string): THREE.Group {
  const def = BOIL_MODELS[key as BoilModelKey];
  if (!def) throw new Error(`未注册的微沸喷烧设备模型：${key}`);
  const group = def.build();
  addNozzleSet(group, def.ports);
  group.userData.boilModel = def.key;
  group.userData.boilModelName = def.name;
  group.updateMatrixWorld(true);
  return group;
}

const boundsCache = new Map<BoilModelKey, { min: Vec3; max: Vec3 }>();

/** 模型原始局部坐标包围盒（含接管法兰，不含额外缩放）；Phase 3 布局归一化与避让检查共用。 */
export function getBoilModelBounds(key: BoilModelKey | string): { min: Vec3; max: Vec3 } {
  const def = BOIL_MODELS[key as BoilModelKey];
  if (!def) throw new Error(`未注册的微沸喷烧设备模型：${key}`);
  const cached = boundsCache.get(def.key);
  if (cached) return cached;
  const group = buildBoilModel(def.key);
  const box = new THREE.Box3().setFromObject(group);
  const bounds: { min: Vec3; max: Vec3 } = {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z]
  };
  boundsCache.set(def.key, bounds);
  return bounds;
}

export function getBoilModelPorts(key: BoilModelKey | string): BoilModelPort[] {
  const def = BOIL_MODELS[key as BoilModelKey];
  return def ? def.ports : [];
}
