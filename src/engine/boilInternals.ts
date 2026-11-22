import * as THREE from 'three';
import { cachedGeo, metal } from './industrial';
import { buildBoilModel, type BoilModelKey } from './boilModels';
import {
  BOIL_INTERNALS,
  OBSERVATION_MODE_IDS,
  type EquipmentInternalsDef,
  type InternalPartDef,
  type ObservationMode
} from '../data/boilInternals';

/**
 * 微沸喷烧 Phase 7：核心设备内部结构（参数化教学几何）。
 *
 * - 与 boilModels 的外部模型共用同一局部坐标系；外壳不重复建造，内部结构按
 *   教学示意布置，所有部件带稳定 id，供结构树、拾取、高亮与后续爆炸视图复用；
 * - 五种观察模式在预览层通过材质幽灵化、线框、裁剪平面与外壳隐藏实现；
 * - 所有尺寸、内衬层次、喷淋层数、极板/极线数量均为教学示意，不是设备图纸；
 * - 不包含任何工艺参数、真实转速、电气参数或厂家结构。
 */

export interface AnimationHook {
  label: string;
  update(time: number, dt: number): void;
  sample?: () => number;
}

export interface InternalPartRecord {
  def: InternalPartDef;
  object: THREE.Group;
  meshes: THREE.Mesh[];
  center: THREE.Vector3;
}

export interface InternalBuild {
  key: BoilModelKey;
  def: EquipmentInternalsDef;
  group: THREE.Group;
  external: THREE.Group;
  internals: THREE.Group;
  parts: Map<string, InternalPartRecord>;
  shells: THREE.Mesh[];
  animations: AnimationHook[];
  shellPartId: string;
  issues: string[];
}

const UP = new THREE.Vector3(0, 1, 0);

function imat(color: number, opts: { rough?: number; metal?: number; double?: boolean; opacity?: number; emissive?: number; emissiveIntensity?: number } = {}): THREE.MeshStandardMaterial {
  const m = metal(color, {
    rough: opts.rough ?? 0.6,
    metal: opts.metal ?? 0.3,
    ...(opts.double ? { side: THREE.DoubleSide } : {})
  });
  if (opts.opacity !== undefined) {
    m.transparent = true;
    m.opacity = opts.opacity;
    m.depthWrite = false;
  }
  if (opts.emissive !== undefined) {
    m.emissive = new THREE.Color(opts.emissive);
    m.emissiveIntensity = opts.emissiveIntensity ?? 0.8;
  }
  return m;
}

const IM = {
  brick: imat(0x8a5a44, { rough: 0.92, metal: 0.05, double: true }),
  brickDark: imat(0x6f4534, { rough: 0.94, metal: 0.04, double: true }),
  innerSteel: imat(0x9aa6b2, { rough: 0.42, metal: 0.7, double: true }),
  steel: imat(0xc0c9d4, { rough: 0.28, metal: 0.85 }),
  dark: imat(0x3c4754, { rough: 0.58, metal: 0.4 }),
  bag: imat(0xd8d2c4, { rough: 0.95, metal: 0.02, double: true }),
  plate: imat(0x5a6673, { rough: 0.45, metal: 0.65, double: true }),
  packing: imat(0xb08a52, { rough: 0.85, metal: 0.08, double: true }),
  bed: imat(0x6b5544, { rough: 0.95, metal: 0.02 }),
  cavity: imat(0x7f93a8, { rough: 0.6, metal: 0.2, opacity: 0.14, double: true }),
  gas: imat(0x9fc3e0, { rough: 0.5, metal: 0.1, opacity: 0.12, double: true }),
  gasWarm: imat(0xd9a06a, { rough: 0.5, metal: 0.05, opacity: 0.14, double: true }),
  liquid: imat(0x3f8fc9, { rough: 0.2, metal: 0.15, opacity: 0.34, double: true }),
  flame: imat(0xff7a2f, { rough: 0.8, metal: 0.0, opacity: 0.82, emissive: 0xff5a1a, emissiveIntensity: 1.4 }),
  flameCore: imat(0xffc46a, { rough: 0.7, metal: 0.0, opacity: 0.7, emissive: 0xff9a3c, emissiveIntensity: 1.1 }),
  arc: imat(0x66d9ff, { rough: 0.4, metal: 0.2, emissive: 0x3fbdf0, emissiveIntensity: 1.2 }),
  dust: imat(0xc9a06a, { rough: 0.9, metal: 0.05 })
};

const DROPLET_MAT = new THREE.PointsMaterial({ color: 0x7fc4f0, size: 0.085, transparent: true, opacity: 0.9, depthWrite: false });
const DUST_MAT = new THREE.PointsMaterial({ color: 0xc9a06a, size: 0.075, transparent: true, opacity: 0.9, depthWrite: false });
const FLOW_MAT = imat(0x8fd8ff, { rough: 0.5, metal: 0.1, opacity: 0.85, emissive: 0x3fbdf0, emissiveIntensity: 0.6 });

function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  return cachedGeo(`boil-int|${key}`, make);
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

function cylY(parent: THREE.Object3D, rTop: number, rBottom: number, h: number, material: THREE.Material, x = 0, y = 0, z = 0, seg = 24): THREE.Mesh {
  return put(parent, geo(`cy|${rTop}|${rBottom}|${h}|${seg}`, () => new THREE.CylinderGeometry(rTop, rBottom, h, seg)), material, x, y, z);
}

function openCylY(parent: THREE.Object3D, rTop: number, rBottom: number, h: number, material: THREE.Material, x = 0, y = 0, z = 0, seg = 32): THREE.Mesh {
  return put(parent, geo(`oy|${rTop}|${rBottom}|${h}|${seg}`, () => new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, true)), material, x, y, z);
}

function cylX(parent: THREE.Object3D, r: number, len: number, material: THREE.Material, x = 0, y = 0, z = 0, seg = 20): THREE.Mesh {
  const m = put(parent, geo(`cx|${r}|${len}|${seg}`, () => new THREE.CylinderGeometry(r, r, len, seg)), material, x, y, z);
  m.rotation.z = Math.PI / 2;
  return m;
}

function openCylX(parent: THREE.Object3D, r: number, len: number, material: THREE.Material, x = 0, y = 0, z = 0, seg = 32): THREE.Mesh {
  const m = put(parent, geo(`ox|${r}|${len}|${seg}`, () => new THREE.CylinderGeometry(r, r, len, seg, 1, true)), material, x, y, z);
  m.rotation.z = Math.PI / 2;
  return m;
}

function cylZ(parent: THREE.Object3D, r: number, len: number, material: THREE.Material, x = 0, y = 0, z = 0, seg = 20): THREE.Mesh {
  const m = put(parent, geo(`cz|${r}|${len}|${seg}`, () => new THREE.CylinderGeometry(r, r, len, seg)), material, x, y, z);
  m.rotation.x = Math.PI / 2;
  return m;
}

function torusX(parent: THREE.Object3D, radius: number, tube: number, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = put(parent, geo(`tx|${radius}|${tube}`, () => new THREE.TorusGeometry(radius, tube, 8, 36)), material, x, y, z);
  m.rotation.y = Math.PI / 2;
  return m;
}

function torusY(parent: THREE.Object3D, radius: number, tube: number, material: THREE.Material, y = 0, x = 0, z = 0): THREE.Mesh {
  const m = put(parent, geo(`ty|${radius}|${tube}`, () => new THREE.TorusGeometry(radius, tube, 8, 36)), material, x, y, z);
  m.rotation.x = Math.PI / 2;
  return m;
}

function sphere(parent: THREE.Object3D, r: number, material: THREE.Material, x = 0, y = 0, z = 0, seg = 16): THREE.Mesh {
  return put(parent, geo(`sp|${r}|${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(8, seg / 2))), material, x, y, z);
}

function tubeBetween(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material, seg = 14): THREE.Mesh {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const mesh = put(parent, geo(`tb|${radius}|${len.toFixed(3)}|${seg}`, () => new THREE.CylinderGeometry(radius, radius, len, seg)), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  return mesh;
}

function coneToward(parent: THREE.Object3D, origin: THREE.Vector3, direction: THREE.Vector3, length: number, radius: number, material: THREE.Material, seg = 12): THREE.Mesh {
  const cone = put(parent, geo(`cone|${length}|${radius}|${seg}`, () => new THREE.ConeGeometry(radius, length, seg)), material);
  cone.position.copy(origin).addScaledVector(direction, length / 2);
  cone.quaternion.setFromUnitVectors(UP, direction.clone().normalize());
  return cone;
}

function partGroup(
  parent: THREE.Object3D,
  parts: Map<string, InternalPartRecord>,
  def: EquipmentInternalsDef,
  id: string
): THREE.Group {
  const partDef = def.parts.find((item) => item.id === id);
  if (!partDef) throw new Error(`${def.modelKey} 内部部件未在数据中登记：${id}`);
  const group = new THREE.Group();
  group.userData.partId = id;
  group.name = `part:${id}`;
  parent.add(group);
  parts.set(id, { def: partDef, object: group, meshes: [], center: new THREE.Vector3() });
  return group;
}

function particles(count: number, material: THREE.PointsMaterial, spread: { x: number; y: number; z: number }, origin: { x: number; y: number; z: number }): { points: THREE.Points; positions: Float32Array } {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = origin.x + (Math.random() - 0.5) * spread.x;
    positions[i * 3 + 1] = origin.y + (Math.random() - 0.5) * spread.y;
    positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * spread.z;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geom, material);
  points.frustumCulled = false;
  return { points, positions };
}

function driftParticles(
  points: THREE.Points,
  positions: Float32Array,
  step: (i: number, p: Float32Array) => void,
  reset: (i: number, p: Float32Array) => void
): AnimationHook {
  return {
    label: '粒子示踪',
    update: () => {
      for (let i = 0; i < positions.length / 3; i += 1) {
        step(i, positions);
        if (positions[i * 3 + 1] < -900 || positions[i * 3 + 1] > 900) reset(i, positions);
      }
      (points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    },
    sample: () => positions[1]
  };
}

// ---------------------------------------------------------------------------
// 各设备内部教学几何
// ---------------------------------------------------------------------------

function buildSmpInternals(internals: THREE.Group, parts: Map<string, InternalPartRecord>, def: EquipmentInternalsDef, animations: AnimationHook[]): void {
  const hopper = partGroup(internals, parts, def, 'feed-hopper');
  openCylY(hopper, 0.52, 0.9, 0.9, IM.innerSteel, 0, 2.95, 0, 4).rotation.y = Math.PI / 4;

  const cavity = partGroup(internals, parts, def, 'inner-cavity');
  box(cavity, 2.8, 1.7, 1.7, IM.cavity, -0.2, 1.5, 0);

  const channel = partGroup(internals, parts, def, 'discharge-channel');
  cylX(channel, 0.2, 1.1, IM.innerSteel, 0.9, 1.3, 0);

  box(internals, 3.0, 0.02, 1.9, IM.cavity, -0.2, 0.72, 0);
  animations.push({
    label: '物料出料示踪',
    update: (time) => {
      channel.children[0].position.x = 0.9 + Math.sin(time * 1.4) * 0.12;
    }
  });
}

function buildCrusherInternals(internals: THREE.Group, parts: Map<string, InternalPartRecord>, def: EquipmentInternalsDef, animations: AnimationHook[]): void {
  const hopper = partGroup(internals, parts, def, 'feed-hopper');
  openCylY(hopper, 0.58, 0.92, 0.82, IM.innerSteel, 0, 2.55, 0, 4).rotation.y = Math.PI / 4;

  const cavity = partGroup(internals, parts, def, 'crushing-cavity');
  box(cavity, 1.5, 0.95, 1.5, IM.cavity, 0, 1.15, 0);
  box(cavity, 1.5, 0.06, 1.5, IM.plate, 0, 0.65, 0);

  const rotorAssembly = new THREE.Group();
  rotorAssembly.position.set(0, 0.95, 0);
  internals.add(rotorAssembly);

  const rotor = partGroup(rotorAssembly, parts, def, 'rotor');
  cylZ(rotor, 0.22, 1.4, IM.steel, 0, 0, 0, 18);
  cylZ(rotor, 0.3, 0.12, IM.plate, 0, 0, 0.62, 18);
  cylZ(rotor, 0.3, 0.12, IM.plate, 0, 0, -0.62, 18);

  const hammers = partGroup(rotorAssembly, parts, def, 'hammers');
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const h = box(hammers, 0.42, 0.08, 0.08, IM.dark, Math.cos(angle) * 0.38, Math.sin(angle) * 0.38, 0);
    h.rotation.z = angle;
  }

  const motor = partGroup(internals, parts, def, 'drive-motor');
  box(motor, 0.46, 0.38, 0.38, IM.dark, -1.32, 1.05, 0);
  cylZ(motor, 0.26, 0.07, IM.steel, -1.02, 1.05, 0, 18);
  cylZ(motor, 0.08, 0.42, IM.steel, -1.0, 1.05, 0, 10);

  const outlet = partGroup(internals, parts, def, 'discharge-outlet');
  cylX(outlet, 0.17, 0.9, IM.innerSteel, -0.7, 0.9, 0);

  animations.push({
    label: '转子旋转（教学）',
    update: (time) => {
      rotorAssembly.rotation.z = time * 1.6;
    },
    sample: () => rotorAssembly.rotation.z
  });
}

function buildMixerInternals(internals: THREE.Group, parts: Map<string, InternalPartRecord>, def: EquipmentInternalsDef, animations: AnimationHook[]): void {
  const drive = partGroup(internals, parts, def, 'top-drive');
  box(drive, 0.4, 0.34, 0.4, IM.dark, 0, 4.55, 0);
  cylY(drive, 0.09, 0.09, 0.6, IM.steel, 0, 4.2, 0);

  const shaftAssembly = new THREE.Group();
  shaftAssembly.position.set(0, 0, 0);
  internals.add(shaftAssembly);

  const shaft = partGroup(shaftAssembly, parts, def, 'shaft');
  cylY(shaft, 0.055, 0.055, 2.0, IM.steel, 0, 2.45, 0);

  const impeller = partGroup(shaftAssembly, parts, def, 'impeller');
  cylY(impeller, 0.09, 0.09, 0.2, IM.steel, 0, 1.55, 0);
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    const blade = box(impeller, 0.72, 0.05, 0.12, IM.plate, Math.cos(angle) * 0.38, 1.55, Math.sin(angle) * 0.38);
    blade.rotation.y = -angle;
  }

  const liquid = partGroup(internals, parts, def, 'liquid-level');
  cylY(liquid, 1.0, 1.0, 1.2, IM.liquid, 0, 1.85, 0, 28);

  const outlet = partGroup(internals, parts, def, 'outlet');
  cylX(outlet, 0.12, 0.9, IM.innerSteel, 0.55, 0.95, 0);

  animations.push({
    label: '搅拌桨旋转（教学）',
    update: (time) => {
      shaftAssembly.rotation.y = time * 1.1;
    },
    sample: () => shaftAssembly.rotation.y
  });
}

function buildFurnacePumpInternals(internals: THREE.Group, parts: Map<string, InternalPartRecord>, def: EquipmentInternalsDef, animations: AnimationHook[]): void {
  const pistonGroup = new THREE.Group();
  internals.add(pistonGroup);
  const piston = partGroup(pistonGroup, parts, def, 'piston');
  cylX(piston, 0.3, 0.85, IM.steel, -0.4, 0.95, 0, 20);
  cylX(piston, 0.08, 0.7, IM.steel, 0.3, 0.95, 0, 12);

  const inletValve = partGroup(internals, parts, def, 'inlet-valve');
  sphere(inletValve, 0.1, IM.plate, -0.95, 1.3, 0);
  cylY(inletValve, 0.09, 0.09, 0.4, IM.innerSteel, -0.95, 1.15, 0);

  const outletValve = partGroup(internals, parts, def, 'outlet-valve');
  sphere(outletValve, 0.1, IM.plate, -0.25, 1.55, 0);
  cylY(outletValve, 0.09, 0.09, 0.35, IM.innerSteel, -0.25, 1.45, 0);

  const coupling = partGroup(internals, parts, def, 'coupling');
  cylX(coupling, 0.17, 0.34, IM.plate, 0.66, 0.95, 0);

  const rotor = partGroup(internals, parts, def, 'motor-rotor');
  cylX(rotor, 0.22, 0.8, IM.steel, 1.2, 0.95, 0);
  cylX(rotor, 0.3, 0.1, IM.dark, 0.9, 0.95, 0);

  const inlet = partGroup(internals, parts, def, 'inlet');
  cylX(inlet, 0.12, 0.6, IM.innerSteel, -1.02, 0.95, 0);

  const outlet = partGroup(internals, parts, def, 'outlet');
  cylY(outlet, 0.1, 0.1, 0.8, IM.innerSteel, -0.3, 1.55, 0);

  animations.push({
    label: '柱塞往复（教学）',
    update: (time) => {
      pistonGroup.position.x = Math.sin(time * 2.2) * 0.1;
    },
    sample: () => pistonGroup.position.x
  });
}

function buildSecondaryChamberInternals(internals: THREE.Group, parts: Map<string, InternalPartRecord>, def: EquipmentInternalsDef, animations: AnimationHook[]): void {
  const lining = partGroup(internals, parts, def, 'refractory-lining');
  openCylY(lining, 1.3, 1.3, 4.4, IM.brick, 0, 3.0, 0, 32);
  torusY(lining, 1.28, 0.05, IM.brickDark, 1.05);
  torusY(lining, 1.28, 0.05, IM.brickDark, 4.95);

  const space = partGroup(internals, parts, def, 'combustion-space');
  cylY(space, 1.05, 1.05, 3.6, IM.gasWarm, 0, 3.0, 0, 28);

  const flame = partGroup(internals, parts, def, 'flame-zone');
  cylY(flame, 0.5, 0.62, 2.2, IM.flame, 0, 3.0, 0, 20);
  cylY(flame, 0.22, 0.3, 1.4, IM.flameCore, 0, 2.85, 0, 16);

  const gunFlames: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i += 1) {
    const angle = Math.PI / 4 + (i * Math.PI) / 2;
    const y = 2.2 + i * 0.55;
    const outer = new THREE.Vector3(Math.cos(angle) * 2.0, y, Math.sin(angle) * 2.0);
    const inner = new THREE.Vector3(Math.cos(angle) * 0.58, y, Math.sin(angle) * 0.58);
    const direction = inner.clone().sub(outer).normalize();
    const gun = partGroup(internals, parts, def, `gun-${i + 1}`);
    sphere(gun, 0.15, IM.dark, outer.x, outer.y, outer.z);
    tubeBetween(gun, outer.clone().addScaledVector(direction, 0.25), inner.clone(), 0.06, IM.steel, 12);
    cylY(gun, 0.14, 0.14, 0.36, IM.plate, outer.x, outer.y, outer.z).quaternion.setFromUnitVectors(UP, direction);
    const nozzle = put(gun, geo('nozzle|0.11|0.26', () => new THREE.ConeGeometry(0.11, 0.26, 12)), IM.plate, inner.x, inner.y, inner.z);
    nozzle.quaternion.setFromUnitVectors(UP, direction.clone().negate());
    const flameMesh = coneToward(gun, inner.clone().addScaledVector(direction, 0.08), direction.clone().negate(), 0.52, 0.16, IM.flame, 12);
    gunFlames.push(flameMesh);
  }

  const gasOut = partGroup(internals, parts, def, 'gas-outlet');
  cylX(gasOut, 0.11, 0.7, IM.gas, 1.28, 4.9, 0);
  cylX(gasOut, 0.22, 0.1, IM.innerSteel, 1.55, 4.9, 0, 18);

  const ash = partGroup(internals, parts, def, 'ash-outlet');
  openCylY(ash, 1.05, 0.24, 0.7, IM.dark, 0, 0.65, 0, 20);

  animations.push({
    label: '四支焰流脉动（教学）',
    update: (time) => {
      const puls = 0.85 + Math.sin(time * 2.4) * 0.18;
      for (const f of gunFlames) f.scale.set(1, puls, 1);
      const core = flame.children[1] as THREE.Mesh;
      core.scale.set(1, 0.94 + Math.sin(time * 1.8) * 0.08, 1);
    },
    sample: () => gunFlames[0]?.scale.y ?? 1
  });
}

function buildSprayGunInternals(internals: THREE.Group, parts: Map<string, InternalPartRecord>, def: EquipmentInternalsDef, animations: AnimationHook[]): void {
  const nozzle = partGroup(internals, parts, def, 'nozzle');
  const nozzleMesh = put(nozzle, geo('gun-nozzle|0.1|0.3', () => new THREE.ConeGeometry(0.1, 0.3, 12)), IM.plate, 1.5, 1.5, 0);
  nozzleMesh.rotation.z = -Math.PI / 2;

  const feed = partGroup(internals, parts, def, 'feed-channel');
  cylX(feed, 0.035, 2.3, IM.innerSteel, 0.05, 1.5, 0, 10);
  cylX(feed, 0.08, 0.2, IM.dark, 1.18, 1.5, 0, 12);

  const atomizing = partGroup(internals, parts, def, 'atomizing-channel');
  tubeBetween(atomizing, new THREE.Vector3(-0.55, 1.34, 0.08), new THREE.Vector3(0.95, 1.46, 0.03), 0.02, IM.gas, 8);
  tubeBetween(atomizing, new THREE.Vector3(-0.55, 1.66, -0.08), new THREE.Vector3(0.95, 1.54, -0.03), 0.02, IM.gas, 8);

  const bracket = partGroup(internals, parts, def, 'mounting-bracket');
  box(bracket, 0.16, 1.1, 0.16, IM.dark, -0.45, 0.85, 0);
  box(bracket, 0.9, 0.1, 0.5, IM.dark, -0.45, 0.28, 0);

  const spray = coneToward(internals, new THREE.Vector3(1.64, 1.5, 0), new THREE.Vector3(1, 0, 0), 0.7, 0.2, IM.gas, 12);
  animations.push({
    label: '喷出示踪（教学）',
    update: (time) => {
      spray.scale.set(0.9 + Math.sin(time * 2.1) * 0.1, 1, 0.9 + Math.sin(time * 2.1) * 0.1);
    }
  });
}

function buildRotaryKilnInternals(internals: THREE.Group, parts: Map<string, InternalPartRecord>, def: EquipmentInternalsDef, animations: AnimationHook[]): void {
  const lining = partGroup(internals, parts, def, 'refractory-lining');
  openCylX(lining, 1.1, 6.6, IM.brick, 0, 2.2, 0, 32);
  torusX(lining, 1.06, 0.04, IM.brickDark, -2.9, 2.2, 0);
  torusX(lining, 1.06, 0.04, IM.brickDark, 2.9, 2.2, 0);

  const space = partGroup(internals, parts, def, 'kiln-space');
  cylX(space, 0.95, 6.4, IM.gasWarm, 0, 2.2, 0, 28);

  const bed = partGroup(internals, parts, def, 'material-bed');
  box(bed, 6.0, 0.22, 0.92, IM.bed, 0, 1.56, 0);

  const feed = partGroup(internals, parts, def, 'feed-end');
  openCylX(feed, 0.98, 0.26, IM.innerSteel, -3.52, 2.2, 0, 24);
  box(feed, 0.5, 0.7, 0.7, IM.dark, -3.9, 2.55, 0);

  const discharge = partGroup(internals, parts, def, 'discharge-end');
  openCylX(discharge, 0.98, 0.26, IM.innerSteel, 3.52, 2.2, 0, 24);
  box(discharge, 0.5, 0.6, 0.6, IM.dark, 3.9, 2.0, 0);

  const rings = partGroup(internals, parts, def, 'support-rings');
  torusX(rings, 1.15, 0.06, IM.plate, -2.2, 2.2, 0);
  torusX(rings, 1.15, 0.06, IM.plate, 2.2, 2.2, 0);

  const rollers = partGroup(internals, parts, def, 'support-rollers');
  for (const x of [-2.2, 2.2]) {
    for (const z of [-0.78, 0.78]) {
      cylZ(rollers, 0.16, 0.3, IM.steel, x, 0.9, z, 14);
    }
  }

  const driveRing = partGroup(internals, parts, def, 'drive-ring');
  torusX(driveRing, 1.18, 0.07, IM.dark, 1.0, 2.2, 0);

  const pinion = partGroup(internals, parts, def, 'drive-pinion');
  cylX(pinion, 0.16, 0.36, IM.plate, 1.0, 1.1, 0.95, 16);

  const motor = partGroup(internals, parts, def, 'drive-motor');
  box(motor, 0.62, 0.44, 0.44, IM.dark, 1.0, 0.95, 1.45);
  cylZ(motor, 0.12, 0.3, IM.steel, 1.0, 0.95, 1.2, 12);

  const flow = partGroup(internals, parts, def, 'gas-flow');
  const arrows: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i += 1) {
    const arrow = coneToward(flow, new THREE.Vector3(-2.4 + i * 1.6, 2.65, 0), new THREE.Vector3(1, 0, 0), 0.42, 0.12, FLOW_MAT, 10);
    arrows.push(arrow);
  }

  animations.push({
    label: '窑内烟气流向（教学）',
    update: (time) => {
      for (let i = 0; i < arrows.length; i += 1) {
        arrows[i].position.x = -2.4 + i * 1.6 + ((time * 0.45 + i * 0.2) % 0.6);
      }
    },
    sample: () => arrows[0].position.x
  });
}

function sprayRing(parent: THREE.Object3D, y: number, radius: number, nozzles: number): void {
  torusY(parent, radius, 0.045, IM.steel, y);
  for (let i = 0; i < nozzles; i += 1) {
    const angle = (i / nozzles) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const nozzle = put(parent, geo('spray-nozzle|0.06|0.16', () => new THREE.ConeGeometry(0.06, 0.16, 10)), IM.plate, x, y - 0.1, z);
    nozzle.rotation.x = Math.PI;
  }
}

function buildQuenchInternals(internals: THREE.Group, parts: Map<string, InternalPartRecord>, def: EquipmentInternalsDef, animations: AnimationHook[]): void {
  const gasIn = partGroup(internals, parts, def, 'gas-inlet');
  cylX(gasIn, 0.18, 0.8, IM.gas, 1.0, 3.0, 0);
  box(gasIn, 0.9, 0.08, 0.9, IM.plate, 0.7, 3.1, 0);

  const gasOut = partGroup(internals, parts, def, 'gas-outlet');
  cylY(gasOut, 0.42, 0.42, 0.8, IM.gas, 0, 8.6, 0, 20);

  const upper = partGroup(internals, parts, def, 'spray-upper');
  sprayRing(upper, 5.8, 1.02, 6);
  const middle = partGroup(internals, parts, def, 'spray-middle');
  sprayRing(middle, 4.2, 1.06, 6);
  const lower = partGroup(internals, parts, def, 'spray-lower');
  sprayRing(lower, 2.6, 1.02, 6);

  const contact = partGroup(internals, parts, def, 'contact-zone');
  openCylY(contact, 1.08, 1.08, 3.6, IM.gas, 0, 4.3, 0, 28);

  const circ = partGroup(internals, parts, def, 'circulation-inlet');
  cylX(circ, 0.12, 0.7, IM.innerSteel, 1.15, 2.2, 0);

  const drain = partGroup(internals, parts, def, 'drain-outlet');
  cylX(drain, 0.12, 0.5, IM.innerSteel, 0, 0.7, 0.95);

  const flow = partGroup(internals, parts, def, 'liquid-flow');
  const mist = put(flow, geo('quench-mist|0.55|1.05', () => new THREE.ConeGeometry(0.55, 1.05, 18, 1, true)), IM.gas, 0, 5.05, 0);
  mist.rotation.x = Math.PI;
  const { points, positions } = particles(46, DROPLET_MAT, { x: 1.9, y: 3.3, z: 1.9 }, { x: 0, y: 4.2, z: 0 });
  flow.add(points);
  animations.push(driftParticles(points, positions, (i, p) => {
    p[i * 3 + 1] -= 0.012;
  }, (i, p) => {
    p[i * 3] = (Math.random() - 0.5) * 1.9;
    p[i * 3 + 1] = 5.9;
    p[i * 3 + 2] = (Math.random() - 0.5) * 1.9;
  }));
  (animations[animations.length - 1] as AnimationHook).label = '喷淋液滴（教学）';
}

function buildBaghouseInternals(internals: THREE.Group, parts: Map<string, InternalPartRecord>, def: EquipmentInternalsDef, animations: AnimationHook[]): void {
  const dirty = partGroup(internals, parts, def, 'dirty-chamber');
  box(dirty, 3.8, 1.9, 2.2, IM.gas, 0, 3.25, 0);

  const clean = partGroup(internals, parts, def, 'clean-air-chamber');
  box(clean, 3.8, 0.9, 2.2, IM.cavity, 0, 5.55, 0);

  const sheet = partGroup(internals, parts, def, 'tube-sheet');
  box(sheet, 3.8, 0.08, 2.2, IM.plate, 0, 4.95, 0);

  const bags = partGroup(internals, parts, def, 'filter-bags');
  for (const x of [-1.35, -0.45, 0.45, 1.35]) {
    for (const z of [-0.62, 0, 0.62]) {
      cylY(bags, 0.12, 0.12, 1.7, IM.bag, x, 4.05, z, 12);
      cylY(bags, 0.13, 0.13, 0.06, IM.plate, x, 4.92, z, 12);
    }
  }

  const hopper = partGroup(internals, parts, def, 'hopper');
  openCylY(hopper, 1.75, 0.42, 1.35, IM.innerSteel, 0, 1.65, 0, 4).rotation.y = Math.PI / 4;

  const gasIn = partGroup(internals, parts, def, 'gas-inlet');
  cylX(gasIn, 0.18, 0.9, IM.gas, 1.85, 2.8, 0);

  const gasOut = partGroup(internals, parts, def, 'gas-outlet');
  cylX(gasOut, 0.18, 0.9, IM.gas, 1.85, 4.7, 0);

  const jets = partGroup(internals, parts, def, 'pulse-jets');
  for (const x of [-1.0, 0, 1.0]) {
    cylZ(jets, 0.045, 2.0, IM.steel, x, 5.25, 0, 10);
    for (const z of [-0.62, 0, 0.62]) {
      const nozzle = put(jets, geo('jet-nozzle|0.05|0.12', () => new THREE.ConeGeometry(0.05, 0.12, 8)), IM.plate, x, 5.16, z);
      nozzle.rotation.x = Math.PI;
    }
  }

  const airflow = partGroup(internals, parts, def, 'airflow');
  const airArrows: THREE.Mesh[] = [];
  for (const x of [-1.2, 0, 1.2]) {
    airArrows.push(coneToward(airflow, new THREE.Vector3(x, 2.6, -0.9), new THREE.Vector3(0, 1, 0), 0.36, 0.1, FLOW_MAT, 8));
    airArrows.push(coneToward(airflow, new THREE.Vector3(x, 4.4, -0.9), new THREE.Vector3(0, 1, 0), 0.32, 0.09, FLOW_MAT, 8));
  }

  const dust = partGroup(internals, parts, def, 'dust-capture');
  cylY(dust, 0.08, 0.7, 0.28, IM.dust, 0, 1.12, 0, 18);
  const { points, positions } = particles(40, DUST_MAT, { x: 3.2, y: 1.6, z: 1.6 }, { x: 0, y: 2.8, z: 0 });
  dust.add(points);
  animations.push(driftParticles(points, positions, (i, p) => {
    p[i * 3 + 1] += 0.007;
    if (p[i * 3 + 1] > 4.7) {
      p[i * 3 + 1] = 2.2;
      p[i * 3] = (Math.random() - 0.5) * 3.2;
      p[i * 3 + 2] = (Math.random() - 0.5) * 1.6;
    }
  }, () => undefined));
  (animations[animations.length - 1] as AnimationHook).label = '粉尘捕集示踪（教学）';

  animations.push({
    label: '内部气流示踪（教学）',
    update: (time) => {
      for (let i = 0; i < airArrows.length; i += 1) {
        airArrows[i].position.y += Math.sin(time * 1.5 + i) * 0.0008;
      }
    }
  });
}

function buildComprehensiveInternals(internals: THREE.Group, parts: Map<string, InternalPartRecord>, def: EquipmentInternalsDef, animations: AnimationHook[]): void {
  const gasIn = partGroup(internals, parts, def, 'gas-inlet');
  cylX(gasIn, 0.2, 0.9, IM.gas, 1.5, 2.7, 0);

  const gasOut = partGroup(internals, parts, def, 'gas-outlet');
  cylY(gasOut, 0.5, 0.5, 0.9, IM.gas, 0, 8.6, 0, 20);

  const lower = partGroup(internals, parts, def, 'packing-lower');
  openCylY(lower, 1.45, 1.45, 0.55, IM.packing, 0, 3.3, 0, 28);
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    box(lower, 0.05, 0.55, 1.0, IM.packing, Math.cos(angle) * 0.7, 3.3, Math.sin(angle) * 0.7).rotation.y = -angle;
  }

  const upper = partGroup(internals, parts, def, 'packing-upper');
  openCylY(upper, 1.45, 1.45, 0.55, IM.packing, 0, 5.1, 0, 28);
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    box(upper, 0.05, 0.55, 1.0, IM.packing, Math.cos(angle) * 0.7, 5.1, Math.sin(angle) * 0.7).rotation.y = -angle;
  }

  const sprayLower = partGroup(internals, parts, def, 'spray-lower');
  sprayRing(sprayLower, 3.95, 1.28, 8);
  const sprayUpper = partGroup(internals, parts, def, 'spray-upper');
  sprayRing(sprayUpper, 5.75, 1.28, 8);

  const sump = partGroup(internals, parts, def, 'sump');
  cylY(sump, 1.38, 1.38, 0.6, IM.liquid, 0, 1.0, 0, 28);

  const loop = partGroup(internals, parts, def, 'circulation-loop');
  tubeBetween(loop, new THREE.Vector3(0, 1.0, 1.2), new THREE.Vector3(0, 1.0, 1.75), 0.09, IM.steel, 12);
  tubeBetween(loop, new THREE.Vector3(0, 1.0, 1.75), new THREE.Vector3(0, 3.95, 1.75), 0.09, IM.steel, 12);
  tubeBetween(loop, new THREE.Vector3(0, 3.95, 1.75), new THREE.Vector3(1.1, 3.95, 0.9), 0.09, IM.steel, 12);
  tubeBetween(loop, new THREE.Vector3(0, 4.4, 1.75), new THREE.Vector3(0, 5.75, 1.75), 0.08, IM.steel, 12);

  const gasFlow = partGroup(internals, parts, def, 'gas-flow');
  const arrows: THREE.Mesh[] = [];
  for (const y of [2.2, 3.6, 5.0, 6.4]) arrows.push(coneToward(gasFlow, new THREE.Vector3(0, y, 0), new THREE.Vector3(0, 1, 0), 0.34, 0.1, FLOW_MAT, 8));

  const liquidFlow = partGroup(internals, parts, def, 'liquid-flow');
  const mistCore = put(liquidFlow, geo('comp-mist|0.6|0.9', () => new THREE.ConeGeometry(0.6, 0.9, 18, 1, true)), IM.gas, 0, 5.2, 0);
  mistCore.rotation.x = Math.PI;
  const { points, positions } = particles(36, DROPLET_MAT, { x: 2.2, y: 2.0, z: 2.2 }, { x: 0, y: 4.6, z: 0 });
  liquidFlow.add(points);

  animations.push({
    label: '烟气上升示踪（教学）',
    update: (time) => {
      for (let i = 0; i < arrows.length; i += 1) {
        arrows[i].position.y = 2.2 + i * 1.4 + ((time * 0.35) % 0.5);
      }
    }
  });
  animations.push(driftParticles(points, positions, (i, p) => {
    p[i * 3 + 1] -= 0.01;
  }, (i, p) => {
    p[i * 3] = (Math.random() - 0.5) * 2.2;
    p[i * 3 + 1] = 5.8;
    p[i * 3 + 2] = (Math.random() - 0.5) * 2.2;
  }));
}

function buildWashInternals(internals: THREE.Group, parts: Map<string, InternalPartRecord>, def: EquipmentInternalsDef, animations: AnimationHook[]): void {
  const gasIn = partGroup(internals, parts, def, 'gas-inlet');
  cylX(gasIn, 0.18, 0.8, IM.gas, 1.05, 2.4, 0);

  const gasOut = partGroup(internals, parts, def, 'gas-outlet');
  cylX(gasOut, 0.18, 0.7, IM.gas, 1.0, 6.0, 0);

  const spray = partGroup(internals, parts, def, 'spray-layer');
  sprayRing(spray, 5.35, 0.95, 6);

  const contact = partGroup(internals, parts, def, 'contact-zone');
  openCylY(contact, 1.0, 1.0, 2.6, IM.gas, 0, 3.95, 0, 26);

  const mist = partGroup(internals, parts, def, 'mist-eliminator');
  for (let i = 0; i < 5; i += 1) {
    const plate = box(mist, 1.5, 0.05, 0.24, IM.plate, 0, 5.85, -0.6 + i * 0.3);
    plate.rotation.y = i % 2 === 0 ? 0.35 : -0.35;
  }

  const sump = partGroup(internals, parts, def, 'sump');
  cylY(sump, 1.0, 1.0, 0.55, IM.liquid, 0, 1.05, 0, 26);

  const gasFlow = partGroup(internals, parts, def, 'gas-flow');
  const arrows: THREE.Mesh[] = [];
  for (const y of [2.4, 3.6, 4.8]) arrows.push(coneToward(gasFlow, new THREE.Vector3(0, y, 0), new THREE.Vector3(0, 1, 0), 0.32, 0.09, FLOW_MAT, 8));

  const liquidFlow = partGroup(internals, parts, def, 'liquid-flow');
  const mistCore = put(liquidFlow, geo('wash-mist|0.5|0.8', () => new THREE.ConeGeometry(0.5, 0.8, 18, 1, true)), IM.gas, 0, 4.95, 0);
  mistCore.rotation.x = Math.PI;
  const { points, positions } = particles(30, DROPLET_MAT, { x: 1.7, y: 2.6, z: 1.7 }, { x: 0, y: 4.4, z: 0 });
  liquidFlow.add(points);

  animations.push({
    label: '烟气上升示踪（教学）',
    update: (time) => {
      for (let i = 0; i < arrows.length; i += 1) arrows[i].position.y = 2.4 + i * 1.2 + ((time * 0.3) % 0.4);
    }
  });
  animations.push(driftParticles(points, positions, (i, p) => {
    p[i * 3 + 1] -= 0.012;
  }, (i, p) => {
    p[i * 3] = (Math.random() - 0.5) * 1.7;
    p[i * 3 + 1] = 5.35;
    p[i * 3 + 2] = (Math.random() - 0.5) * 1.7;
  }));
}

function buildWetEspInternals(internals: THREE.Group, parts: Map<string, InternalPartRecord>, def: EquipmentInternalsDef, animations: AnimationHook[]): void {
  const gasIn = partGroup(internals, parts, def, 'gas-inlet');
  cylX(gasIn, 0.18, 0.8, IM.gas, 1.3, 2.8, 0);

  const gasOut = partGroup(internals, parts, def, 'gas-outlet');
  cylX(gasOut, 0.18, 0.8, IM.gas, 1.3, 6.0, 0);

  const field = partGroup(internals, parts, def, 'field-zone');
  box(field, 2.2, 4.2, 2.0, imat(0x4f9fd0, { rough: 0.5, metal: 0.1, opacity: 0.1, double: true, emissive: 0x2a6f9e, emissiveIntensity: 0.35 }), 0, 4.4, 0);

  const plates = partGroup(internals, parts, def, 'collecting-plates');
  const plateMat = imat(0xa8b8c8, { rough: 0.35, metal: 0.7, double: true });
  for (const x of [-0.8, -0.4, 0, 0.4, 0.8]) box(plates, 0.04, 3.8, 1.7, plateMat, x, 4.4, 0);

  const wires = partGroup(internals, parts, def, 'discharge-wires');
  const wireMats: THREE.MeshStandardMaterial[] = [];
  for (const x of [-0.6, -0.2, 0.2, 0.6]) {
    const m = IM.arc.clone();
    wireMats.push(m);
    cylY(wires, 0.015, 0.015, 3.8, m, x, 4.4, 0, 6);
  }

  const header = partGroup(internals, parts, def, 'flushing-header');
  cylZ(header, 0.07, 2.1, IM.steel, 0, 6.55, 0, 12);
  for (const x of [-0.8, -0.4, 0, 0.4, 0.8]) {
    const nozzle = put(header, geo('flush-nozzle|0.05|0.12', () => new THREE.ConeGeometry(0.05, 0.12, 8)), IM.plate, x, 6.42, 0);
    nozzle.rotation.x = Math.PI;
  }

  const hopper = partGroup(internals, parts, def, 'hopper');
  openCylY(hopper, 1.25, 0.35, 1.0, IM.innerSteel, 0, 1.5, 0, 4).rotation.y = Math.PI / 4;

  const gasFlow = partGroup(internals, parts, def, 'gas-flow');
  const arrows: THREE.Mesh[] = [];
  for (const y of [2.9, 4.1, 5.3]) arrows.push(coneToward(gasFlow, new THREE.Vector3(0, y, -0.2), new THREE.Vector3(0, 1, 0), 0.34, 0.1, FLOW_MAT, 8));

  animations.push({
    label: '电场辉光（教学）',
    update: (time) => {
      const glow = 0.9 + Math.sin(time * 2.6) * 0.3;
      for (const m of wireMats) m.emissiveIntensity = glow;
    },
    sample: () => wireMats[0]?.emissiveIntensity ?? 0
  });
  animations.push({
    label: '烟气流向示踪（教学）',
    update: (time) => {
      for (let i = 0; i < arrows.length; i += 1) arrows[i].position.y = 2.9 + i * 1.2 + ((time * 0.3) % 0.4);
    }
  });
}

function buildIdFanInternals(internals: THREE.Group, parts: Map<string, InternalPartRecord>, def: EquipmentInternalsDef, animations: AnimationHook[]): void {
  const impellerGroup = new THREE.Group();
  impellerGroup.position.set(0, 1.55, 0.08);
  internals.add(impellerGroup);

  const impeller = partGroup(impellerGroup, parts, def, 'impeller');
  cylZ(impeller, 0.18, 0.5, IM.steel, 0, 0, 0, 18);
  cylZ(impeller, 0.52, 0.04, IM.plate, 0, 0, -0.02, 24);
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const blade = box(impeller, 0.05, 0.44, 0.2, IM.plate, Math.cos(angle) * 0.4, Math.sin(angle) * 0.4, 0);
    blade.rotation.z = angle;
    blade.rotation.y = 0.4;
  }

  const shaft = partGroup(internals, parts, def, 'shaft');
  cylZ(shaft, 0.08, 1.1, IM.steel, 0, 1.55, 0.45, 12);

  const coupling = partGroup(internals, parts, def, 'coupling');
  cylZ(coupling, 0.16, 0.26, IM.plate, 0, 1.55, 0.88, 16);

  const motor = partGroup(internals, parts, def, 'motor');
  box(motor, 0.5, 0.42, 0.42, IM.dark, 0, 1.35, 1.15);

  const rotor = partGroup(internals, parts, def, 'motor-rotor');
  cylZ(rotor, 0.14, 0.5, IM.steel, 0, 1.35, 1.15, 14);

  const inlet = partGroup(internals, parts, def, 'inlet');
  const bell = put(inlet, geo('fan-bell|0.55|0.34|0.38', () => new THREE.CylinderGeometry(0.55, 0.34, 0.38, 24, 1, true)), IM.innerSteel, 0, 1.55, -0.62);
  bell.rotation.x = Math.PI / 2;
  tubeBetween(inlet, new THREE.Vector3(0, 1.55, -0.52), new THREE.Vector3(0, 1.55, 0.02), 0.3, IM.gas, 20);

  const outlet = partGroup(internals, parts, def, 'outlet');
  tubeBetween(outlet, new THREE.Vector3(0, 1.55, 0.2), new THREE.Vector3(0.55, 2.45, 0), 0.2, IM.gas, 16);
  tubeBetween(outlet, new THREE.Vector3(0.55, 2.45, 0), new THREE.Vector3(0.85, 3.2, 0), 0.2, IM.gas, 16);

  const airflow = partGroup(internals, parts, def, 'airflow');
  const arrows: THREE.Mesh[] = [];
  arrows.push(coneToward(airflow, new THREE.Vector3(0, 1.55, -0.95), new THREE.Vector3(0, 0, 1), 0.4, 0.12, FLOW_MAT, 10));
  arrows.push(coneToward(airflow, new THREE.Vector3(0.25, 1.9, 0.2), new THREE.Vector3(0.4, 1, 0), 0.34, 0.1, FLOW_MAT, 8));
  arrows.push(coneToward(airflow, new THREE.Vector3(0.7, 2.8, 0), new THREE.Vector3(0, 1, 0), 0.34, 0.1, FLOW_MAT, 8));

  animations.push({
    label: '叶轮旋转（教学）',
    update: (time) => {
      impellerGroup.rotation.z = time * 3.0;
      rotor.rotation.z = time * 3.0;
    },
    sample: () => impellerGroup.rotation.z
  });
  animations.push({
    label: '气流方向示踪（教学）',
    update: (time) => {
      arrows[0].position.z = -0.95 + Math.sin(time * 1.4) * 0.08;
    }
  });
}

function buildStackInternals(internals: THREE.Group, parts: Map<string, InternalPartRecord>, def: EquipmentInternalsDef, animations: AnimationHook[]): void {
  const flue = partGroup(internals, parts, def, 'inner-flue');
  const flueMesh = put(flue, geo('stack-flue|0.62|1.12|10.4', () => new THREE.CylinderGeometry(0.62, 1.12, 10.4, 28, 1, true)), IM.brickDark, 0, 5.8, 0);
  flueMesh.material = IM.brickDark;

  const base = partGroup(internals, parts, def, 'base');
  cylY(base, 1.7, 1.7, 0.5, IM.innerSteel, 0, 0.55, 0, 28);

  const sampling = partGroup(internals, parts, def, 'sampling-port');
  cylX(sampling, 0.08, 0.5, IM.innerSteel, 0.95, 8.0, 0);
  cylX(sampling, 0.16, 0.06, IM.plate, 1.22, 8.0, 0, 16);

  const flow = partGroup(internals, parts, def, 'emission-flow');
  const arrows: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i += 1) arrows.push(coneToward(flow, new THREE.Vector3(0, 6.4 + i * 1.5, 0), new THREE.Vector3(0, 1, 0), 0.34, 0.1, FLOW_MAT, 8));

  animations.push({
    label: '排放气流示踪（教学）',
    update: (time) => {
      for (let i = 0; i < arrows.length; i += 1) arrows[i].position.y = 6.4 + i * 1.5 + ((time * 0.4 + i * 0.1) % 0.5);
    },
    sample: () => arrows[0].position.y
  });
}

const BUILDERS: Record<BoilModelKey, (internals: THREE.Group, parts: Map<string, InternalPartRecord>, def: EquipmentInternalsDef, animations: AnimationHook[]) => void> = {
  smp: buildSmpInternals,
  crusher: buildCrusherInternals,
  mixer: buildMixerInternals,
  'furnace-pump': buildFurnacePumpInternals,
  'secondary-chamber': buildSecondaryChamberInternals,
  'spray-gun': buildSprayGunInternals,
  'rotary-kiln': buildRotaryKilnInternals,
  'quench-tower': buildQuenchInternals,
  baghouse: buildBaghouseInternals,
  'comprehensive-tower': buildComprehensiveInternals,
  'wash-tower': buildWashInternals,
  'wet-esp': buildWetEspInternals,
  'id-fan': buildIdFanInternals,
  stack: buildStackInternals
};

export function buildInternalModel(key: BoilModelKey | string): InternalBuild {
  const def = BOIL_INTERNALS[key as BoilModelKey];
  if (!def) throw new Error(`未登记内部结构的设备模型：${key}`);
  const group = new THREE.Group();
  group.name = `internals:${def.modelKey}`;
  const external = buildBoilModel(def.modelKey);
  group.add(external);
  const internals = new THREE.Group();
  internals.name = 'internals';
  group.add(internals);

  const parts = new Map<string, InternalPartRecord>();
  const animations: AnimationHook[] = [];
  const issues: string[] = [];

  const shellDef = def.parts.find((p) => p.id === def.shellPartId);
  if (!shellDef) throw new Error(`${def.modelKey} 缺少外壳部件定义：${def.shellPartId}`);
  external.userData.partId = def.shellPartId;
  parts.set(def.shellPartId, { def: shellDef, object: external as unknown as THREE.Group, meshes: [], center: new THREE.Vector3() });

  const builder = BUILDERS[def.modelKey];
  builder(internals, parts, def, animations);

  for (const partDef of def.parts) {
    if (!parts.has(partDef.id)) issues.push(`缺少内部几何：${def.modelKey}.${partDef.id}`);
  }
  for (const id of parts.keys()) {
    if (!def.parts.some((p) => p.id === id)) issues.push(`未登记的内部几何：${def.modelKey}.${id}`);
  }

  group.updateMatrixWorld(true);
  const shells: THREE.Mesh[] = [];
  external.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) shells.push(obj as THREE.Mesh);
  });
  for (const [id, record] of parts) {
    const meshes: THREE.Mesh[] = [];
    record.object.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh);
    });
    record.meshes = meshes;
    const box = new THREE.Box3();
    for (const mesh of meshes) box.expandByObject(mesh);
    if (!box.isEmpty()) box.getCenter(record.center);
    else record.object.getWorldPosition(record.center);
    // 内部部件的中心按整机局部坐标记录（root 无位移）
    if (id !== def.shellPartId) {
      const local = new THREE.Box3();
      for (const mesh of meshes) {
        mesh.updateWorldMatrix(true, false);
        local.expandByObject(mesh);
      }
      if (!local.isEmpty()) local.getCenter(record.center);
    }
  }

  return { key: def.modelKey, def, group, external, internals, parts, shells, animations, shellPartId: def.shellPartId, issues };
}

// ---------------------------------------------------------------------------
// 观察模式控制（浏览器预览使用；node 校验只使用 buildInternalModel）
// ---------------------------------------------------------------------------

interface ShellState {
  orig: THREE.Material;
  ghost: THREE.MeshStandardMaterial;
  cut: THREE.MeshStandardMaterial;
}

export interface InternalsModeInfo {
  mode: ObservationMode;
  shellVisible: boolean;
  internalsVisible: boolean;
  shellOpacity: number;
  shellWireframe: boolean;
  clippingPlanes: number;
  selected: string | null;
  highlighted: boolean;
}

export class InternalsView {
  readonly build: InternalBuild;
  private mode: ObservationMode = 'normal';
  private shellStates = new Map<THREE.Mesh, ShellState>();
  private clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  private highlight: THREE.BoxHelper | null = null;
  private selected: string | null = null;
  private animationEnabled = true;
  private elapsed = 0;
  private last = 0;

  constructor(key: BoilModelKey | string) {
    this.build = buildInternalModel(key);
    for (const mesh of this.build.shells) {
      const orig = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const ghost = (orig as THREE.MeshStandardMaterial).clone();
      ghost.transparent = true;
      ghost.opacity = 0.16;
      ghost.depthWrite = false;
      ghost.wireframe = false;
      const cut = (orig as THREE.MeshStandardMaterial).clone();
      cut.clippingPlanes = [this.clipPlane];
      cut.clipShadows = true;
      cut.side = THREE.DoubleSide;
      cut.color.setHex(0x6f8092);
      cut.metalness = 0.45;
      cut.roughness = 0.5;
      cut.needsUpdate = true;
      this.shellStates.set(mesh, { orig, ghost, cut });
    }
    this.applyMode('normal');
  }

  get currentMode(): ObservationMode {
    return this.mode;
  }

  get selectedPart(): string | null {
    return this.selected;
  }

  setMode(mode: ObservationMode): void {
    if (!OBSERVATION_MODE_IDS.includes(mode)) throw new Error(`未知观察模式：${mode}`);
    this.applyMode(mode);
  }

  private applyMode(mode: ObservationMode): void {
    this.mode = mode;
    const showShell = mode !== 'internal';
    this.build.external.visible = showShell;
    this.build.internals.visible = mode !== 'normal';
    for (const [mesh, state] of this.shellStates) {
      if (mode === 'normal') {
        mesh.material = state.orig;
      } else if (mode === 'transparent') {
        state.ghost.opacity = 0.16;
        state.ghost.wireframe = false;
        state.ghost.color.setHex(0x9fb8cc);
        state.ghost.emissive.setHex(0x000000);
        state.ghost.emissiveIntensity = 0;
        mesh.material = state.ghost;
      } else if (mode === 'xray') {
        state.ghost.opacity = 0.3;
        state.ghost.wireframe = true;
        state.ghost.color.setHex(0x4f8fc0);
        state.ghost.emissive.setHex(0x1f4a72);
        state.ghost.emissiveIntensity = 0.7;
        mesh.material = state.ghost;
      } else if (mode === 'cutaway') {
        mesh.material = state.cut;
      } else {
        mesh.material = state.orig;
      }
    }
    this.updateHighlight();
  }

  private updateHighlight(): void {
    if (this.highlight) {
      this.build.group.remove(this.highlight);
      this.highlight.geometry.dispose();
      (this.highlight.material as THREE.Material).dispose();
      this.highlight = null;
    }
    if (!this.selected) return;
    const record = this.build.parts.get(this.selected);
    if (!record) return;
    const visibleShell = this.mode !== 'normal';
    if (!visibleShell) return;
    const helper = new THREE.BoxHelper(record.object, 0x7fd8ff);
    helper.renderOrder = 30;
    (helper.material as THREE.LineBasicMaterial).depthTest = false;
    (helper.material as THREE.LineBasicMaterial).transparent = true;
    (helper.material as THREE.LineBasicMaterial).opacity = 0.9;
    this.build.group.add(helper);
    this.highlight = helper;
  }

  selectPart(id: string | null): InternalPartDef | null {
    if (!id) {
      this.selected = null;
      this.updateHighlight();
      return null;
    }
    const record = this.build.parts.get(id);
    if (!record) return null;
    this.selected = id;
    this.updateHighlight();
    return record.def;
  }

  setAnimationEnabled(enabled: boolean): void {
    this.animationEnabled = enabled;
  }

  get animationsEnabled(): boolean {
    return this.animationEnabled;
  }

  update(nowMs: number): void {
    const now = nowMs / 1000;
    if (!this.last) this.last = now;
    const dt = Math.min(0.1, now - this.last);
    this.last = now;
    if (!this.animationEnabled) return;
    this.elapsed += dt;
    for (const hook of this.build.animations) hook.update(this.elapsed, dt);
  }

  animationSnapshot(): number[] {
    return this.build.animations.map((hook) => (hook.sample ? Number(hook.sample().toFixed(4)) : 0));
  }

  pick(raycaster: THREE.Raycaster): string | null {
    const targets: THREE.Object3D[] = [];
    if (this.build.internals.visible) targets.push(this.build.internals);
    if (this.build.external.visible) targets.push(this.build.external);
    const hits = raycaster.intersectObjects(targets, true);
    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj && obj !== this.build.group) {
        const partId = obj.userData?.partId as string | undefined;
        if (partId) return partId;
        obj = obj.parent;
      }
    }
    return null;
  }

  modeInfo(): InternalsModeInfo {
    const first = this.shellStates.values().next().value as ShellState | undefined;
    return {
      mode: this.mode,
      shellVisible: this.build.external.visible,
      internalsVisible: this.build.internals.visible,
      shellOpacity: this.mode === 'normal' ? 1 : first?.ghost.opacity ?? 0,
      shellWireframe: this.mode === 'xray' ? Boolean(first?.ghost.wireframe) : false,
      clippingPlanes: this.mode === 'cutaway' ? first?.cut.clippingPlanes?.length ?? 0 : 0,
      selected: this.selected,
      highlighted: this.highlight !== null
    };
  }

  dispose(): void {
    if (this.highlight) {
      this.build.group.remove(this.highlight);
      this.highlight.geometry.dispose();
      (this.highlight.material as THREE.Material).dispose();
      this.highlight = null;
    }
    for (const state of this.shellStates.values()) {
      state.ghost.dispose();
      state.cut.dispose();
    }
    this.shellStates.clear();
  }
}
