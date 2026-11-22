import * as THREE from 'three';
import { cachedGeo, metal } from './industrial';
import {
  BOIL_PIPE_SIZES,
  type PipeRouteResult,
  type RouteBend,
  type RouteSupport,
  type RouteValve
} from '../process/piping';
import type { PipeSizeClass } from '../data/processTypes';
import type { Vec3 } from '../data/types';

/**
 * 微沸喷烧工业管道教学示意几何（Phase 3）。
 *
 * - 直管/弯头/法兰/示意阀/支架按 Phase 3 路由结果程序化生成；
 * - 三通/变径只做部件库演示（本流程拓扑无分支/变径需求，未放置）；
 * - 管径等级、阀门型式/位置、支架均为教学示意，不是工程管道设计；
 * - 所有网格带 userData.component / userData.pipelineId，供预览验证与后续阶段复用。
 */

export type PipingComponentKind =
  | 'straight'
  | 'elbow'
  | 'flange'
  | 'valve-gate'
  | 'valve-butterfly'
  | 'support'
  | 'tee'
  | 'reducer';

export interface PipingMeshCounts {
  pipes: number;
  straight: number;
  /** 中心线直段中，因两端弯头相切而由弯头几何直接覆盖的短段数量。 */
  skippedStraight: number;
  elbows: number;
  flanges: number;
  valves: number;
  supports: number;
}

export interface PipingBuildResult {
  group: THREE.Group;
  counts: PipingMeshCounts;
  pipelines: THREE.Group[];
}

export interface GalleryItemDef {
  key: string;
  component: PipingComponentKind | 'straight';
  label: string;
  position: Vec3;
  size?: PipeSizeClass;
}

const UP = new THREE.Vector3(0, 1, 0);
const MAT = {
  steel: metal(0xb4c0cb, { rough: 0.32, metal: 0.86 }),
  dark: metal(0x3a4553, { rough: 0.55, metal: 0.42 }),
  support: metal(0x7d8a96, { rough: 0.62, metal: 0.45 }),
  bolt: metal(0x2e3842, { rough: 0.5, metal: 0.55 }),
  gasket: metal(0x27313b, { rough: 0.85, metal: 0.15 })
};

const pipeMaterials = new Map<number, THREE.MeshStandardMaterial>();
function pipeMaterial(color: number): THREE.MeshStandardMaterial {
  let mat = pipeMaterials.get(color);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.45 });
    pipeMaterials.set(color, mat);
  }
  return mat;
}

function mark(mesh: THREE.Object3D, component: PipingComponentKind, pipelineId?: string): void {
  mesh.userData.component = component;
  if (pipelineId) mesh.userData.pipelineId = pipelineId;
}

function cylinderGeo(radius: number, len: number, seg = 14): THREE.BufferGeometry {
  return cachedGeo(`bp-cyl|${radius}|${len.toFixed(3)}|${seg}`, () => new THREE.CylinderGeometry(radius, radius, len, seg));
}

function cylinderBetween(
  parent: THREE.Object3D,
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  component: PipingComponentKind,
  pipelineId?: string
): THREE.Mesh | null {
  const dir = b.clone().sub(a);
  const len = dir.length();
  if (len < 0.02) return null;
  const mesh = new THREE.Mesh(cylinderGeo(radius, len), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mark(mesh, component, pipelineId);
  parent.add(mesh);
  return mesh;
}

function basisForAxis(axis: THREE.Vector3): { x: THREE.Vector3; y: THREE.Vector3; z: THREE.Vector3 } {
  const x = axis.clone().normalize();
  const hint = Math.abs(x.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const y = hint.clone().addScaledVector(x, -hint.dot(x)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return { x, y, z };
}

function addFlange(
  parent: THREE.Object3D,
  point: THREE.Vector3,
  axis: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  component: PipingComponentKind,
  pipelineId?: string,
  bolts = 4
): void {
  const n = axis.clone().normalize();
  const disc = new THREE.Mesh(cylinderGeo(radius, 0.055, 20), material);
  disc.position.copy(point);
  disc.quaternion.setFromUnitVectors(UP, n);
  disc.castShadow = true;
  disc.receiveShadow = true;
  mark(disc, component, pipelineId);
  parent.add(disc);

  const side = Math.abs(n.x) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(n, side).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  const ring = radius * 0.72;
  const boltGeo = cachedGeo('bp-bolt|0.012|0.09', () => new THREE.CylinderGeometry(0.012, 0.012, 0.09, 6));
  for (let i = 0; i < bolts; i++) {
    const a = (i / bolts) * Math.PI * 2;
    const off = u.clone().multiplyScalar(Math.cos(a) * ring).addScaledVector(v, Math.sin(a) * ring);
    const bolt = new THREE.Mesh(boltGeo, MAT.bolt);
    bolt.position.copy(point).add(off);
    bolt.quaternion.setFromUnitVectors(UP, n);
    mark(bolt, component, pipelineId);
    parent.add(bolt);
  }
}

function elbowGeo(radius: number, bendRadius: number): THREE.BufferGeometry {
  return cachedGeo(`bp-elbow|${radius}|${bendRadius.toFixed(3)}`, () => {
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(bendRadius, 0, 0),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, bendRadius, 0)
    );
    return new THREE.TubeGeometry(curve, 10, radius, 10, false);
  });
}

function addElbow(
  parent: THREE.Object3D,
  bend: RouteBend,
  radius: number,
  material: THREE.Material,
  pipelineId: string
): void {
  const inDir = new THREE.Vector3(bend.inDir[0], bend.inDir[1], bend.inDir[2]).normalize();
  const outDir = new THREE.Vector3(bend.outDir[0], bend.outDir[1], bend.outDir[2]).normalize();
  const x = inDir.clone().negate();
  const y = outDir.clone();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  const matrix = new THREE.Matrix4().makeBasis(x, y, z);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
  const mesh = new THREE.Mesh(elbowGeo(radius, bend.radius), material);
  mesh.position.set(bend.point[0], bend.point[1], bend.point[2]);
  mesh.quaternion.copy(quaternion);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.component = 'elbow';
  mesh.userData.pipelineId = pipelineId;
  mesh.userData.bendIndex = bend.index;
  parent.add(mesh);
}

function addValveGroup(parent: THREE.Object3D, valve: RouteValve, size: PipeSizeClass, pipelineId: string): THREE.Group {
  const spec = BOIL_PIPE_SIZES[size];
  const axis = new THREE.Vector3(valve.axis[0], valve.axis[1], valve.axis[2]).normalize();
  const basis = basisForAxis(axis);
  const matrix = new THREE.Matrix4().makeBasis(basis.x, basis.y, basis.z);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
  const group = new THREE.Group();
  group.position.set(valve.point[0], valve.point[1], valve.point[2]);
  group.quaternion.copy(quaternion);
  group.userData.valveId = valve.id;
  group.userData.valveKind = valve.kind;
  group.userData.dataStatus = valve.dataStatus;
  group.userData.pipelineId = pipelineId;

  const localAxis = new THREE.Vector3(1, 0, 0);
  if (valve.kind === 'gate') {
    const body = new THREE.Mesh(cylinderGeo(spec.radius * 2.0, 0.28, 18), MAT.steel);
    body.rotation.z = Math.PI / 2;
    mark(body, 'valve-gate', pipelineId);
    group.add(body);
    const bonnet = new THREE.Mesh(cylinderGeo(spec.radius * 0.95, 0.24, 14), MAT.steel);
    bonnet.position.y = spec.radius * 2.0 + 0.12;
    mark(bonnet, 'valve-gate', pipelineId);
    group.add(bonnet);
    const stem = new THREE.Mesh(cylinderGeo(0.018, 0.32, 8), MAT.dark);
    stem.position.y = spec.radius * 2.0 + 0.38;
    mark(stem, 'valve-gate', pipelineId);
    group.add(stem);
    const wheel = new THREE.Mesh(cachedGeo('bp-wheel|0.115|0.016', () => new THREE.TorusGeometry(0.115, 0.016, 6, 20)), MAT.dark);
    wheel.position.y = spec.radius * 2.0 + 0.55;
    wheel.rotation.x = Math.PI / 2;
    mark(wheel, 'valve-gate', pipelineId);
    group.add(wheel);
  } else {
    const body = new THREE.Mesh(cylinderGeo(spec.flange * 0.78, 0.14, 20), MAT.steel);
    body.rotation.z = Math.PI / 2;
    mark(body, 'valve-butterfly', pipelineId);
    group.add(body);
    const actuator = new THREE.Mesh(cachedGeo('bp-bfly-act|0.09|0.12', () => new THREE.BoxGeometry(0.18, 0.16, 0.2)), MAT.dark);
    actuator.position.y = spec.flange * 0.78 + 0.1;
    mark(actuator, 'valve-butterfly', pipelineId);
    group.add(actuator);
    const lever = new THREE.Mesh(cachedGeo('bp-bfly-lever|0.06|0.3', () => new THREE.BoxGeometry(0.06, 0.05, 0.34)), MAT.dark);
    lever.position.set(0, spec.flange * 0.78 + 0.2, 0.1);
    mark(lever, 'valve-butterfly', pipelineId);
    group.add(lever);
  }
  addFlange(group, new THREE.Vector3(-0.2, 0, 0), localAxis, spec.flange, MAT.steel, valve.kind === 'gate' ? 'valve-gate' : 'valve-butterfly', pipelineId);
  addFlange(group, new THREE.Vector3(0.2, 0, 0), localAxis, spec.flange, MAT.steel, valve.kind === 'gate' ? 'valve-gate' : 'valve-butterfly', pipelineId);
  parent.add(group);
  return group;
}

function addSupport(
  parent: THREE.Object3D,
  support: RouteSupport,
  radius: number,
  axis: THREE.Vector3,
  pipelineId: string
): void {
  const point = new THREE.Vector3(support.point[0], support.point[1], support.point[2]);
  const height = Math.max(0.28, point.y - radius - 0.06);
  const group = new THREE.Group();
  group.userData.supportId = support.id;
  group.userData.pipelineId = pipelineId;

  const post = new THREE.Mesh(cachedGeo(`bp-support|${height.toFixed(2)}`, () => new THREE.BoxGeometry(0.12, height, 0.12)), MAT.support);
  post.position.set(point.x, height / 2, point.z);
  mark(post, 'support', pipelineId);
  group.add(post);

  const base = new THREE.Mesh(cachedGeo('bp-support-base', () => new THREE.BoxGeometry(0.42, 0.05, 0.42)), MAT.dark);
  base.position.set(point.x, 0.025, point.z);
  mark(base, 'support', pipelineId);
  group.add(base);

  const saddle = new THREE.Mesh(cachedGeo('bp-support-saddle', () => new THREE.BoxGeometry(0.34, 0.06, 0.34)), MAT.steel);
  saddle.position.set(point.x, Math.max(0.12, point.y - radius - 0.03), point.z);
  mark(saddle, 'support', pipelineId);
  group.add(saddle);

  const clamp = new THREE.Mesh(cachedGeo('bp-support-clamp|0.014', () => new THREE.TorusGeometry(radius * 1.35, 0.014, 6, 20)), MAT.dark);
  clamp.position.copy(point);
  clamp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis.clone().normalize());
  mark(clamp, 'support', pipelineId);
  group.add(clamp);
  parent.add(group);
}

export function buildPipingRoutes(
  routes: PipeRouteResult[],
  mediumColors: Record<string, number>
): PipingBuildResult {
  const root = new THREE.Group();
  root.name = 'boil-piping';
  const pipelines: THREE.Group[] = [];
  const counts: PipingMeshCounts = { pipes: 0, straight: 0, skippedStraight: 0, elbows: 0, flanges: 0, valves: 0, supports: 0 };

  for (const route of routes) {
    const spec = BOIL_PIPE_SIZES[route.size];
    const material = pipeMaterial(mediumColors[route.medium] ?? 0x9aa6b2);
    const group = new THREE.Group();
    group.name = route.pipelineId;
    group.userData.pipelineId = route.pipelineId;
    group.userData.pipelineName = route.name;
    group.userData.medium = route.medium;

    const points = route.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const bendAt = new Map<number, RouteBend>();
    for (const bend of route.bends) bendAt.set(bend.index, bend);

    for (let i = 0; i + 1 < points.length; i++) {
      const from = points[i];
      const to = points[i + 1];
      const dir = to.clone().sub(from).normalize();
      const startInset = bendAt.get(i)?.radius ?? 0.04;
      const endInset = bendAt.get(i + 1)?.radius ?? 0.04;
      const len = from.distanceTo(to);
      if (len - startInset - endInset < 0.04) {
        counts.skippedStraight += 1;
        continue;
      }
      const a = from.clone().addScaledVector(dir, startInset);
      const b = to.clone().addScaledVector(dir, -endInset);
      const leg = cylinderBetween(group, a, b, spec.radius, material, 'straight', route.pipelineId);
      if (leg) counts.straight += 1;
    }
    for (const bend of route.bends) {
      addElbow(group, bend, spec.radius, material, route.pipelineId);
      counts.elbows += 1;
    }
    for (const flange of route.terminalFlanges) {
      addFlange(
        group,
        new THREE.Vector3(flange.point[0], flange.point[1], flange.point[2]),
        new THREE.Vector3(flange.axis[0], flange.axis[1], flange.axis[2]),
        spec.flange,
        MAT.steel,
        'flange',
        route.pipelineId
      );
      counts.flanges += 1;
    }
    for (const valve of route.valves) {
      addValveGroup(group, valve, route.size, route.pipelineId);
      counts.valves += 1;
    }
    for (const support of route.supports) {
      const segment = route.segments[support.segmentIndex];
      const axis = new THREE.Vector3(segment.dir[0], segment.dir[1], segment.dir[2]);
      addSupport(group, support, spec.radius, axis, route.pipelineId);
      counts.supports += 1;
    }

    group.userData.counts = {
      straight: group.children.filter((c) => c.userData.component === 'straight').length,
      elbows: route.bends.length,
      flanges: route.terminalFlanges.length,
      valves: route.valves.length,
      supports: route.supports.length
    };
    root.add(group);
    pipelines.push(group);
    counts.pipes += 1;
  }

  root.userData.counts = counts;
  return { group: root, counts, pipelines };
}

/* ============================ 部件库（三通/变径等） ============================ */

function addTee(parent: THREE.Object3D, radius: number, material: THREE.Material): void {
  const main = new THREE.Mesh(cylinderGeo(radius, 1.4, 16), material);
  main.rotation.z = Math.PI / 2;
  main.position.y = 0.55;
  mark(main, 'tee');
  parent.add(main);
  const branch = new THREE.Mesh(cylinderGeo(radius, 0.9, 16), material);
  branch.position.set(0, 0.55 + 0.45, 0);
  mark(branch, 'tee');
  parent.add(branch);
  const pad = new THREE.Mesh(cachedGeo(`bp-tee-pad|${radius}`, () => new THREE.SphereGeometry(radius * 1.7, 14, 10)), MAT.steel);
  pad.position.set(0, 0.55, 0);
  mark(pad, 'tee');
  parent.add(pad);
  addFlange(parent, new THREE.Vector3(-0.7, 0.55, 0), new THREE.Vector3(1, 0, 0), radius * 2.0, MAT.steel, 'tee');
  addFlange(parent, new THREE.Vector3(0.7, 0.55, 0), new THREE.Vector3(1, 0, 0), radius * 2.0, MAT.steel, 'tee');
  addFlange(parent, new THREE.Vector3(0, 1.45, 0), new THREE.Vector3(0, 1, 0), radius * 2.0, MAT.steel, 'tee');
}

function addReducer(parent: THREE.Object3D, radiusLarge: number, radiusSmall: number, material: THREE.Material): void {
  const large = new THREE.Mesh(cylinderGeo(radiusLarge, 0.6, 18), material);
  large.rotation.z = Math.PI / 2;
  large.position.set(-0.35, 0.55, 0);
  mark(large, 'reducer');
  parent.add(large);
  const cone = new THREE.Mesh(
    cachedGeo(`bp-reducer|${radiusLarge}|${radiusSmall}`, () => new THREE.CylinderGeometry(radiusSmall, radiusLarge, 0.34, 18)),
    material
  );
  cone.rotation.z = Math.PI / 2;
  cone.position.set(0, 0.55, 0);
  mark(cone, 'reducer');
  parent.add(cone);
  const small = new THREE.Mesh(cylinderGeo(radiusSmall, 0.6, 16), material);
  small.rotation.z = Math.PI / 2;
  small.position.set(0.35, 0.55, 0);
  mark(small, 'reducer');
  parent.add(small);
  addFlange(parent, new THREE.Vector3(-0.65, 0.55, 0), new THREE.Vector3(1, 0, 0), radiusLarge * 2.0, MAT.steel, 'reducer');
  addFlange(parent, new THREE.Vector3(0.65, 0.55, 0), new THREE.Vector3(1, 0, 0), radiusSmall * 2.0, MAT.steel, 'reducer');
}

function addStraightSample(parent: THREE.Object3D, size: PipeSizeClass): void {
  const spec = BOIL_PIPE_SIZES[size];
  const mat = pipeMaterial(0x9ab0c4);
  const pipe = new THREE.Mesh(cylinderGeo(spec.radius, 1.4, 16), mat);
  pipe.rotation.z = Math.PI / 2;
  pipe.position.y = 0.55;
  mark(pipe, 'straight');
  parent.add(pipe);
  addFlange(parent, new THREE.Vector3(-0.7, 0.55, 0), new THREE.Vector3(1, 0, 0), spec.flange, MAT.steel, 'flange');
  addFlange(parent, new THREE.Vector3(0.7, 0.55, 0), new THREE.Vector3(1, 0, 0), spec.flange, MAT.steel, 'flange');
}

function addElbowSample(parent: THREE.Object3D): void {
  const radius = BOIL_PIPE_SIZES.main.radius;
  const mat = pipeMaterial(0x9ab0c4);
  const bendRadius = 0.3;
  const bend: RouteBend = {
    index: 1,
    point: [0, 0.55, 0],
    inDir: [1, 0, 0],
    outDir: [0, 1, 0],
    radius: bendRadius
  };
  cylinderBetween(parent, new THREE.Vector3(-0.8, 0.55, 0), new THREE.Vector3(-bendRadius, 0.55, 0), radius, mat, 'elbow');
  addElbow(parent, bend, radius, mat, 'gallery-elbow');
  const vertical = cylinderBetween(parent, new THREE.Vector3(0, 0.55 + bendRadius, 0), new THREE.Vector3(0, 1.45, 0), radius, mat, 'elbow');
  if (vertical) vertical.userData.pipelineId = 'gallery-elbow';
  addFlange(parent, new THREE.Vector3(-0.8, 0.55, 0), new THREE.Vector3(1, 0, 0), BOIL_PIPE_SIZES.main.flange, MAT.steel, 'flange');
  addFlange(parent, new THREE.Vector3(0, 1.45, 0), new THREE.Vector3(0, 1, 0), BOIL_PIPE_SIZES.main.flange, MAT.steel, 'flange');
}

function addFlangePairSample(parent: THREE.Object3D): void {
  const spec = BOIL_PIPE_SIZES.main;
  addFlange(parent, new THREE.Vector3(-0.035, 0.55, 0), new THREE.Vector3(1, 0, 0), spec.flange, MAT.steel, 'flange');
  addFlange(parent, new THREE.Vector3(0.035, 0.55, 0), new THREE.Vector3(-1, 0, 0), spec.flange, MAT.steel, 'flange');
  const gasket = new THREE.Mesh(cylinderGeo(spec.flange * 0.92, 0.018, 20), MAT.gasket);
  gasket.rotation.z = Math.PI / 2;
  gasket.position.y = 0.55;
  mark(gasket, 'flange');
  parent.add(gasket);
}

function addSupportSample(parent: THREE.Object3D): void {
  const radius = BOIL_PIPE_SIZES.main.radius;
  const mat = pipeMaterial(0x9ab0c4);
  const pipe = new THREE.Mesh(cylinderGeo(radius, 1.6, 16), mat);
  pipe.rotation.z = Math.PI / 2;
  pipe.position.y = 1.25;
  mark(pipe, 'support');
  parent.add(pipe);
  addSupport(
    parent,
    { id: 'gallery-support', point: [0, 1.25, 0], segmentIndex: 0 },
    radius,
    new THREE.Vector3(1, 0, 0),
    'gallery-support'
  );
}

export const BOIL_GALLERY_ITEMS: GalleryItemDef[] = [
  { key: 'straight-main', component: 'straight', label: '直管 · 主工艺', position: [-6.4, 0, 0], size: 'main' },
  { key: 'straight-branch', component: 'straight', label: '直管 · 支管', position: [-3.2, 0, 0], size: 'branch' },
  { key: 'straight-utility', component: 'straight', label: '直管 · 公用工程', position: [0, 0, 0], size: 'utility' },
  { key: 'elbow', component: 'elbow', label: '90° 弯头', position: [3.2, 0, 0] },
  { key: 'tee', component: 'tee', label: '三通（部件库演示）', position: [6.4, 0, 0] },
  { key: 'reducer', component: 'reducer', label: '变径（部件库演示）', position: [-6.4, 0, 3.4] },
  { key: 'flange', component: 'flange', label: '法兰对', position: [-3.2, 0, 3.4] },
  { key: 'valve-gate', component: 'valve-gate', label: '闸阀（教学示意）', position: [0, 0, 3.4] },
  { key: 'valve-butterfly', component: 'valve-butterfly', label: '蝶阀（教学示意）', position: [3.2, 0, 3.4] },
  { key: 'support', component: 'support', label: '支架（教学示意）', position: [6.4, 0, 3.4] }
];

export function buildPipingGallery(): { group: THREE.Group; counts: Record<string, number> } {
  const root = new THREE.Group();
  root.name = 'boil-piping-gallery';
  const counts: Record<string, number> = {};
  for (const item of BOIL_GALLERY_ITEMS) {
    const holder = new THREE.Group();
    holder.position.set(item.position[0], item.position[1], item.position[2]);
    holder.userData.galleryKey = item.key;
    if (item.key.startsWith('straight-')) {
      addStraightSample(holder, item.size ?? 'main');
    } else if (item.key === 'elbow') {
      addElbowSample(holder);
    } else if (item.key === 'tee') {
      addTee(holder, BOIL_PIPE_SIZES.main.radius, pipeMaterial(0x9ab0c4));
    } else if (item.key === 'reducer') {
      addReducer(holder, BOIL_PIPE_SIZES.main.radius, BOIL_PIPE_SIZES.branch.radius, pipeMaterial(0x9ab0c4));
    } else if (item.key === 'flange') {
      addFlangePairSample(holder);
    } else if (item.key === 'valve-gate') {
      addValveGroup(holder, {
        id: 'gallery-gate',
        kind: 'gate',
        point: [0, 0.55, 0],
        axis: [1, 0, 0],
        segmentIndex: 0,
        dataStatus: 'teaching-demo',
        note: '部件库演示，非流程配置。'
      }, 'main', 'gallery-gate');
      const body = new THREE.Mesh(cylinderGeo(BOIL_PIPE_SIZES.main.radius, 0.9, 16), pipeMaterial(0x9ab0c4));
      body.rotation.z = Math.PI / 2;
      body.position.y = 0.55;
      mark(body, 'straight');
      holder.add(body);
    } else if (item.key === 'valve-butterfly') {
      addValveGroup(holder, {
        id: 'gallery-butterfly',
        kind: 'butterfly',
        point: [0, 0.55, 0],
        axis: [1, 0, 0],
        segmentIndex: 0,
        dataStatus: 'teaching-demo',
        note: '部件库演示，非流程配置。'
      }, 'main', 'gallery-butterfly');
      const body = new THREE.Mesh(cylinderGeo(BOIL_PIPE_SIZES.main.radius, 0.9, 16), pipeMaterial(0x9ab0c4));
      body.rotation.z = Math.PI / 2;
      body.position.y = 0.55;
      mark(body, 'straight');
      holder.add(body);
    } else if (item.key === 'support') {
      addSupportSample(holder);
    }
    let meshes = 0;
    holder.traverse((obj) => { if ((obj as THREE.Mesh).isMesh) meshes += 1; });
    counts[item.key] = meshes;
    root.add(holder);
  }
  root.userData.counts = counts;
  return { group: root, counts };
}
