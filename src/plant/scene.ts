import { DEFAULT_PLANT_SCENARIO, type PlantScenario } from '../data/plant';
import { plantFlow, PLANT_EQUIPMENT_CONTROLS } from '../data/plant';
import type { PipeFlowState } from '../process/teachingFlow';
import { pumpStatus, type EquipmentStatus } from '../process/equipmentCommand';
import { VALVE_OPERATIONS, VALVE_STATE_LABEL } from '../data/valveOperations';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildPart } from '../engine/builders';
import {
  MEDIA, PIPE_SIZES, PLANT_NODES, PIPELINES, INSTRUMENTS, PROCESS_STEPS, PROCESS_LAYERS, PORT_STUB,
  deviceOfNode, getNodeByUid, getPipe, getLayer, inlineNodesOfPipe, valvesOfPipe,
  auditPlantData, traceFrom,
  type MediumId, type PipeSizeId, type PipelineDef, type PlantNodeDef, type PortDef,
  type ValveState, type LayerId, type TraceResult, type ProcessStepDef
} from '../data/plant';

/**
 * 化工厂全流程三维场景（教学示意）。
 * 设备整机由实训室零件级构建器组装；设备接口 → 法兰 → 弯头件 → 管线 → 内联阀/仪表
 * 全部由数据驱动；流体、阀门状态与上下游联动为教学演示，不代表真实工艺状态。
 */

export type PlantViewMode = 'equipment' | 'process' | 'piping' | 'fluid';

export interface PlantCallbacks {
  onSelectNode: (uid: string | null) => void;
  onSelectPipe: (pipeId: string | null) => void;
  onFlowsChanged: () => void;
}

interface RotorSpec { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number; }
interface InternalFlow {
  kind: 'tower' | 'separator' | 'cyclone';
  points: THREE.Points;
  phases: Float32Array;
  seeds: Float32Array;
}
interface MeshBase { opacity: number; transparent: boolean; depthWrite: boolean; }

interface NodeRuntime {
  def: PlantNodeDef;
  group: THREE.Group;
  size: THREE.Vector3;
  center: THREE.Vector3;
  label: HTMLButtonElement;
  ring: THREE.Mesh;
  glow?: THREE.Mesh;
  stateLight?: THREE.Mesh;
  rotors: RotorSpec[];
  stroke: { obj: THREE.Object3D; origin: number }[];
  liquids: THREE.Mesh[];
  internal?: InternalFlow;
  meshes: THREE.Mesh[];
  shellPartIds: Set<string>;
  dimmed: boolean;
  active: boolean;
  inlinePoint?: THREE.Vector3;
}

interface RunRuntime {
  def: PipelineDef;
  curve: THREE.CurvePath<THREE.Vector3>;
  length: number;
  radius: number;
  outer: THREE.Mesh;
  outerMat: THREE.MeshStandardMaterial;
  core: THREE.Mesh;
  pulseTex: THREE.Texture;
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  offsets: Float32Array;
  baseSpeed: number;
  progress: number;
  arrows: THREE.Mesh;
  arrowMat: THREE.MeshStandardMaterial;
  label: HTMLButtonElement;
  labelPos: THREE.Vector3;
  dimmed: boolean;
}

interface PortLink {
  nodeUid: string;
  port: PortDef;
  world: THREE.Vector3;
  dir: THREE.Vector3;
  junction: THREE.Vector3;
  pipes: { id: string; media: MediumId }[];
}

const GEN_X = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

const TRANSPARENT_DEVICES = new Set(['fixed-roof-tank', 'reactor', 'packed-tower', 'gas-separator', 'cyclone-separator']);

const MEDIUM_SPEED: Record<MediumId, number> = {
  feed: 1.15, aux: 0.95, reaction: 1.05, overhead: 1.35, condensate: 1.1,
  product: 1.05, recovery: 0.95, offgas: 1.55, utility: 0.7
};
const MEDIUM_SPACING: Record<MediumId, number> = {
  feed: 0.5, aux: 0.55, reaction: 0.5, overhead: 0.46, condensate: 0.5,
  product: 0.5, recovery: 0.58, offgas: 0.4, utility: 0.95
};
const RACKED_PIPES = new Set(['PL-115', 'PL-119']);

export function roundedPath(points: THREE.Vector3[], radius = 0.18): THREE.CurvePath<THREE.Vector3> {
  const path = new THREE.CurvePath<THREE.Vector3>();
  if (points.length < 2) return path;
  if (points.length === 2) { path.add(new THREE.LineCurve3(points[0], points[1])); return path; }
  let current = points[0].clone();
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const dirIn = b.clone().sub(a);
    const dirOut = c.clone().sub(b);
    const lenIn = dirIn.length(), lenOut = dirOut.length();
    if (lenIn < 1e-6 || lenOut < 1e-6) continue;
    dirIn.normalize(); dirOut.normalize();
    const r = Math.min(radius, lenIn / 2, lenOut / 2);
    const p1 = b.clone().addScaledVector(dirIn, -r);
    const p2 = b.clone().addScaledVector(dirOut, r);
    if (current.distanceToSquared(p1) > 1e-8) path.add(new THREE.LineCurve3(current, p1));
    path.add(new THREE.QuadraticBezierCurve3(p1, b.clone(), p2));
    current = p2;
  }
  path.add(new THREE.LineCurve3(current, points[points.length - 1]));
  return path;
}

export function makeDotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(32, 32, 30, 0, Math.PI * 2); ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeStripeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 8;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 8);
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 8);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function steelMat(color = 0x6b7889, rough = 0.55, metal = 0.45) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

/** 将若干已带变换的几何合并为单网格，减少绘制调用。 */
export function mergedMesh(geometries: THREE.BufferGeometry[], material: THREE.Material, cast = false): THREE.Mesh {
  const merged = mergeGeometries(geometries, false);
  const mesh = new THREE.Mesh(merged ?? geometries[0], material);
  mesh.castShadow = cast;
  mesh.receiveShadow = cast;
  return mesh;
}

export function cylinderGeo(from: THREE.Vector3, to: THREE.Vector3, radius: number, seg = 12): THREE.BufferGeometry | null {
  const delta = to.clone().sub(from);
  const len = delta.length();
  if (len < 1e-5) return null;
  const geo = new THREE.CylinderGeometry(radius, radius, len, seg, 1, false);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, delta.clone().normalize());
  const mid = from.clone().addScaledVector(delta, 0.5);
  geo.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
  return geo;
}

export function discGeo(center: THREE.Vector3, axis: THREE.Vector3, radius: number, thickness = 0.045): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(radius, radius, thickness, 20);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, axis.clone().normalize());
  geo.applyMatrix4(new THREE.Matrix4().compose(center, q, new THREE.Vector3(1, 1, 1)));
  return geo;
}

export function boxGeo(w: number, h: number, d: number, x: number, y: number, z: number, quaternion?: THREE.Quaternion): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    quaternion ?? new THREE.Quaternion(),
    new THREE.Vector3(1, 1, 1)
  );
  geo.applyMatrix4(m);
  return geo;
}

export class PlantScene {
  private container: HTMLElement;
  private cb: PlantCallbacks;
  private renderer: THREE.WebGLRenderer;
  private readonly environmentTarget: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private labelLayer: HTMLDivElement;
  private nodes: NodeRuntime[] = [];
  private nodeByUid = new Map<string, NodeRuntime>();
  private runs: RunRuntime[] = [];
  private runById = new Map<string, RunRuntime>();
  private ports: PortLink[] = [];
  private dotTexture: THREE.Texture;
  private stripeTexture: THREE.Texture;
  private resizeObs: ResizeObserver;
  private raf = 0;
  private clock = new THREE.Clock();
  private elapsed = 0;
  private running = false;
  private speedMul = 1;
  private fps = 0;
  private fpsFrames = 0;
  private fpsMark = performance.now();
  private mode: PlantViewMode = 'equipment';
  private xray = false;
  private labelsOn = true;
  private selectedNode: string | null = null;
  private selectedPipe: string | null = null;
  private trace: TraceResult | null = null;
  private layerFocus: LayerId | null = null;
  private stepFocus: string | null = null;
  private nodePickables: THREE.Object3D[] = [];
  private pipePickables: THREE.Object3D[] = [];
  private raycaster = new THREE.Raycaster();
  private pointerDown = { x: 0, y: 0 };
  private camTween: {
    t0: number; dur: number;
    fromPos: THREE.Vector3; toPos: THREE.Vector3;
    fromTarget: THREE.Vector3; toTarget: THREE.Vector3;
  } | null = null;
  private zoneLabels: { el: HTMLDivElement; pos: THREE.Vector3; layer: LayerId; pad: THREE.Mesh; border: THREE.LineLoop }[] = [];
  private rulerLabels: { el: HTMLDivElement; pos: THREE.Vector3 }[] = [];
  private pipeLabels: { run: RunRuntime; el: HTMLButtonElement }[] = [];
  private instrumentLabels: { el: HTMLDivElement; pos: THREE.Vector3; pipe: string }[] = [];
  private nodeAnchors: { x: number; z: number; r: number }[] = [];
  private userInteracted = false;
  private valveStates = new Map<string, ValveState>();
  private flows = new Map<string, PipeFlowState>();
  private deviceCommands = new Map<string, boolean>();
  private scenario: PlantScenario = { ...DEFAULT_PLANT_SCENARIO };
  private solvedFlow: ReturnType<typeof plantFlow> | null = null;
  private runtimeIssues: string[] = [];
  private hemi: THREE.HemisphereLight;
  private fitSteel = steelMat(0x8b97a5, 0.4, 0.7);
  private fitCast = steelMat(0x64707e, 0.6, 0.4);
  private boltSteel = steelMat(0x3d4653, 0.4, 0.75);
  private supportSteel = steelMat(0x59687a, 0.6, 0.45);
  private supportDark = steelMat(0x3a4552, 0.7, 0.3);

  constructor(container: HTMLElement, cb: PlantCallbacks) {
    this.container = container;
    this.cb = cb;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(container.clientWidth || 800, container.clientHeight || 600);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.classList.add('plant-canvas');

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'plant-label-layer';
    container.appendChild(this.labelLayer);

    this.scene.background = new THREE.Color(0x0c1420);
    this.scene.fog = new THREE.Fog(0x0c1420, 46, 100);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environmentTarget = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environmentTarget.texture;
    room.dispose();
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 260);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 80;
    this.controls.addEventListener('start', () => { this.camTween = null; this.userInteracted = true; });

    this.hemi = new THREE.HemisphereLight(0xbcd3ff, 0x1b2432, 0.6);
    this.scene.add(this.hemi);
    const key = new THREE.DirectionalLight(0xfff1d8, 1.7);
    key.position.set(16, 24, 12);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -28; key.shadow.camera.right = 28;
    key.shadow.camera.top = 22; key.shadow.camera.bottom = -22;
    key.shadow.camera.far = 75;
    key.shadow.bias = -0.0006;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdbe8ff, 0.55);
    fill.position.set(-16, 10, -18);
    this.scene.add(fill);

    this.dotTexture = makeDotTexture();
    this.stripeTexture = makeStripeTexture();
    this.buildSite();
    for (const def of PLANT_NODES) {
      const node = this.buildNode(def);
      this.nodes.push(node);
      this.nodeByUid.set(def.uid, node);
      if (node.def.inline?.valve) this.valveStates.set(def.uid, 'open');
    }
    for (const def of PIPELINES) {
      const run = this.buildRun(def);
      if (!run) continue;
      this.runs.push(run);
      this.runById.set(def.id, run);
    }
    this.collectPorts();
    this.placeInlineNodes();
    this.buildLayerZones();
    this.buildRuler();
    this.buildRacks();
    this.buildInstrumentMeshes();
    this.recomputeFlows();
    this.applyAllAppearance();
    this.fitView(true);

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.loop();
  }

  /* ============================ 场地与设备 ============================ */

  private buildSite() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 46),
      new THREE.MeshStandardMaterial({ color: 0x262f3b, roughness: 0.96, metalness: 0.02 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0.5, 0, -3.4);
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(80, 80, 0x3c4d61, 0x2b3642);
    const gm = grid.material as THREE.Material;
    gm.transparent = true;
    gm.opacity = 0.3;
    grid.position.set(0.5, 0.012, -3.4);
    this.scene.add(grid);
  }

  private buildNode(def: PlantNodeDef): NodeRuntime {
    const device = deviceOfNode(def);
    const group = new THREE.Group();
    group.position.set(def.pos[0], 0, def.pos[1]);
    group.rotation.y = def.rotY ?? 0;
    group.userData.nodeUid = def.uid;

    const partGroups = new Map<string, THREE.Group>();
    for (const p of device.parts) {
      const pg = buildPart(device.id, p.id, p.color);
      pg.position.set(p.pos[0], p.pos[1], p.pos[2]);
      if (p.rot) pg.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
      group.add(pg);
      partGroups.set(p.id, pg);
    }
    group.updateMatrixWorld(true);

    let size = new THREE.Vector3();
    let center = new THREE.Vector3();
    if (!def.inline) {
      const box = new THREE.Box3().setFromObject(group);
      const shift = -box.min.y;
      if (Math.abs(shift) > 0.0005) {
        group.position.y += shift;
        box.translate(new THREE.Vector3(0, shift, 0));
      }
      if (def.lift) {
        group.position.y += def.lift;
        box.translate(new THREE.Vector3(0, def.lift, 0));
      }
      size = box.getSize(new THREE.Vector3());
      center = box.getCenter(new THREE.Vector3());
      center.y = Math.max(1, center.y);

      /* 抬高设备的混凝土支墩 */
      if (def.lift) {
        const concrete = new THREE.MeshStandardMaterial({ color: 0x4b5359, roughness: 0.96, metalness: 0.02 });
        const capMat = new THREE.MeshStandardMaterial({ color: 0x6b737a, roughness: 0.85, metalness: 0.08 });
        for (const sx of [-0.7, 0.7]) {
          const pier = new THREE.Mesh(new THREE.BoxGeometry(0.46, def.lift - 0.04, 0.62), concrete);
          pier.position.set(def.pos[0] + sx, (def.lift - 0.04) / 2, def.pos[1]);
          pier.castShadow = true; pier.receiveShadow = true;
          this.scene.add(pier);
          const cap = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.04, 0.72), capMat);
          cap.position.set(def.pos[0] + sx, def.lift - 0.02, def.pos[1]);
          cap.receiveShadow = true;
          this.scene.add(cap);
        }
      }

      /* 容器/塔器等默认半透明外壳 */
      if (TRANSPARENT_DEVICES.has(device.id)) {
        for (const p of device.parts) {
          if (!p.shell) continue;
          partGroups.get(p.id)?.traverse((o) => {
            const mesh = o as THREE.Mesh;
            const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
            if (!mat || !('opacity' in mat)) return;
            mat.transparent = true;
            mat.opacity = 0.3;
            mat.depthWrite = false;
            mat.side = THREE.DoubleSide;
            mat.needsUpdate = true;
          });
        }
      }
    }

    const shellPartIds = new Set(device.parts.filter((p) => p.shell).map((p) => p.id));
    const meshes: THREE.Mesh[] = [];
    group.traverse((o) => {
      o.userData.nodeUid = def.uid;
      if ((o as THREE.Mesh).isMesh) {
        this.nodePickables.push(o);
        meshes.push(o as THREE.Mesh);
      }
    });
    this.scene.add(group);
    if (!def.inline) this.nodeAnchors.push({ x: def.pos[0], z: def.pos[1], r: Math.max(size.x, size.z) / 2 + 0.3 });

    /* 基础底座 */
    if (!def.inline) {
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(size.x + 0.7, 0.07, size.z + 0.7),
        new THREE.MeshStandardMaterial({ color: 0x333e4c, roughness: 0.9, metalness: 0.05 })
      );
      pad.position.set(def.pos[0], 0.035, def.pos[1]);
      pad.receiveShadow = true;
      this.scene.add(pad);
    }

    /* 液位演示网格 */
    const liquids: THREE.Mesh[] = [];
    group.traverse((o) => {
      if (o.name === 'demo-liquid' && (o as THREE.Mesh).isMesh) {
        const mesh = o as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.transparent = true;
        mat.opacity = 0.6;
        mat.depthWrite = false;
        liquids.push(mesh);
      }
      if (o.name === 'gauge-glass') {
        const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.transparent = true;
        mat.opacity = 0.55;
      }
    });
    if (device.id === 'reactor') {
      const mat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.4, roughness: 0.25, metalness: 0.1, depthWrite: false });
      const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.78, 28), mat);
      liquid.position.set(0, 1.0, 0);
      liquid.name = 'plant-demo-liquid';
      group.add(liquid);
      liquids.push(liquid);
    }
    if (device.id === 'packed-tower') {
      const mat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.45, roughness: 0.25, metalness: 0.1, depthWrite: false });
      const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.18, 24), mat);
      liquid.position.set(0, 0.4, 0);
      liquid.name = 'plant-demo-liquid';
      group.add(liquid);
      liquids.push(liquid);
    }

    /* 转动件 */
    const rotors: RotorSpec[] = [];
    const addRotors = (ids: string[], axis: 'x' | 'y' | 'z', speed: number) => {
      for (const id of ids) {
        const pg = partGroups.get(id);
        if (pg) rotors.push({ obj: pg, axis, speed });
      }
    };
    if (def.anim === 'pump') addRotors(['impeller', 'shaft', 'keys', 'coupling', 'couplingMotor', 'couplingBolts'], 'x', 7.5);
    if (def.anim === 'gearPump') { addRotors(['driveGear'], 'x', 4.2); addRotors(['idlerGear'], 'x', -4.2); }
    if (def.anim === 'compressor') { addRotors(['maleRotor'], 'x', 9); addRotors(['femaleRotor'], 'x', -7.5); }
    if (def.anim === 'agitator') { addRotors(['shaft'], 'y', 2.4); addRotors(['paddles'], 'y', 2.4); }

    const stroke = def.deviceId === 'diaphragm-pump' ? ['link', 'diaphragmL', 'diaphragmR'].flatMap(id => {
      const obj = partGroups.get(id);
      return obj ? [{ obj, origin: obj.position.x }] : [];
    }) : [];

    /* 选中环（落地设备） */
    const ringR = Math.max(size.x, size.z) / 2 + 0.42;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(ringR, ringR + 0.12, 48),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(def.pos[0], 0.02, def.pos[1]);
    ring.visible = false;
    this.scene.add(ring);

    /* 名称标签 */
    const label = document.createElement('button');
    label.type = 'button';
    label.className = `plant-label${def.inline ? ' minor' : ''}`;
    label.title = `${def.tag} ${def.label}`;
    const tagEl = document.createElement('span');
    tagEl.className = 'plant-label-tag';
    tagEl.textContent = def.tag;
    label.appendChild(tagEl);
    if (!def.inline) {
      const nameEl = document.createElement('span');
      nameEl.className = 'plant-label-name';
      nameEl.textContent = def.label;
      label.appendChild(nameEl);
    }
    if (PLANT_EQUIPMENT_CONTROLS[def.uid]) {
      const status = document.createElement('span');
      status.className = 'plant-equipment-state plant-label-state';
      label.appendChild(status);
    }
    if (def.inline?.valve) {
      const st = document.createElement('span');
      st.className = 'plant-label-state is-open';
      st.textContent = 'OPEN';
      label.appendChild(st);
    }
    label.addEventListener('click', (e) => {
      e.stopPropagation();
      this.select(def.uid);
    });
    this.labelLayer.appendChild(label);

    const node: NodeRuntime = {
      def, group, size, center, label, ring, rotors, stroke, liquids,
      meshes, shellPartIds, dimmed: false, active: true
    };
    this.addInternalFlow(node);
    return node;
  }

  private addInternalFlow(node: NodeRuntime) {
    const kind = node.def.anim;
    if (kind !== 'tower' && kind !== 'separator' && kind !== 'cyclone') return;
    const count = { tower: 15, separator: 30, cyclone: 42 }[kind];
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const seeds = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      phases[i] = Math.random();
      seeds[i * 2] = Math.random() * Math.PI * 2;
      seeds[i * 2 + 1] = 0.25 + Math.random() * 0.6;
      const isGas = kind !== 'tower' && i % 2 === 0;
      const c = new THREE.Color(isGas ? 0x7dd3fc : 0x3b82f6);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      pos[i * 3] = 0; pos[i * 3 + 1] = 0.5; pos[i * 3 + 2] = 0;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: kind === 'cyclone' ? 0.085 : 0.08,
      map: this.dotTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      sizeAttenuation: true
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    node.group.add(points);
    node.internal = { kind, points, phases, seeds };
  }

  /* ============================ 管线与接口 ============================ */

  private resolvePort(nodeUid: string, portId: string): { world: THREE.Vector3; dir: THREE.Vector3; node: PlantNodeDef; port: PortDef; runtime: NodeRuntime } | null {
    const node = getNodeByUid(nodeUid);
    const runtime = this.nodeByUid.get(nodeUid);
    if (!node || !runtime) return null;
    const port = node.ports.find((p) => p.id === portId);
    if (!port) return null;
    runtime.group.updateMatrixWorld(true);
    const world = runtime.group.localToWorld(new THREE.Vector3(port.pos[0], port.pos[1], port.pos[2]));
    const dir = new THREE.Vector3(port.dir[0], port.dir[1], port.dir[2]).applyQuaternion(runtime.group.quaternion).normalize();
    return { world, dir, node, port, runtime };
  }

  private buildRun(def: PipelineDef): RunRuntime | null {
    try {
      let start: THREE.Vector3;
      let end: THREE.Vector3;
      let startPort: ReturnType<PlantScene['resolvePort']> = null;
      let endPort: ReturnType<PlantScene['resolvePort']> = null;
      if (def.from.type === 'port') {
        startPort = this.resolvePort(def.from.node, def.from.port);
        if (!startPort) throw new Error(`起点接口不存在：${def.from.node}.${def.from.port}`);
        start = startPort.world.clone().addScaledVector(startPort.dir, PORT_STUB);
      } else {
        start = new THREE.Vector3(...def.from.pos);
      }
      if (def.to.type === 'port') {
        endPort = this.resolvePort(def.to.node, def.to.port);
        if (!endPort) throw new Error(`终点接口不存在：${def.to.node}.${def.to.port}`);
        end = endPort.world.clone().addScaledVector(endPort.dir, PORT_STUB);
      } else {
        end = new THREE.Vector3(...def.to.pos);
      }

      const route = [start.clone()];
      for (const w of def.waypoints) {
        const p = new THREE.Vector3(...w);
        if (p.distanceToSquared(route[route.length - 1]) > 1e-6) route.push(p);
      }
      if (end.distanceToSquared(route[route.length - 1]) > 1e-6) route.push(end.clone());
      const curve = roundedPath(route);
      const length = curve.getLength();
      if (length < 0.05) throw new Error('管线长度异常');

      const sizeDef = PIPE_SIZES[def.size];
      const radius = sizeDef.radius;
      const color = MEDIA[def.medium].color;
      const tubular = Math.max(20, Math.min(260, Math.round(length * 9)));

      const outerMat = new THREE.MeshStandardMaterial({
        color, roughness: 0.52, metalness: 0.42, envMapIntensity: 0.7
      });
      const outer = new THREE.Mesh(new THREE.TubeGeometry(curve, tubular, radius, 9, false), outerMat);
      outer.castShadow = true; outer.receiveShadow = true;
      outer.userData.pipeId = def.id;
      this.scene.add(outer);
      this.pipePickables.push(outer);

      /* 内部流体芯（流体观察模式显示）+ 流动纹理 */
      const pulseTex = this.stripeTexture.clone();
      pulseTex.needsUpdate = true;
      pulseTex.wrapS = THREE.RepeatWrapping;
      pulseTex.wrapT = THREE.ClampToEdgeWrapping;
      pulseTex.repeat.set(Math.max(2, length / 1.1), 1);
      const coreMat = new THREE.MeshBasicMaterial({
        color, map: pulseTex, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.FrontSide
      });
      const core = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, Math.round(tubular / 2)), radius * 0.6, 6, false), coreMat);
      core.visible = false;
      core.renderOrder = 2;
      this.scene.add(core);

      /* 表面流动示踪粒子（普通模式贴着管外壁，流体模式回到管中心） */
      const spacing = MEDIUM_SPACING[def.medium];
      const count = Math.max(4, Math.min(110, Math.round(length / spacing)));
      const offsets = new Float32Array(count);
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        offsets[i] = i / count;
        const p = curve.getPointAt(offsets[i]);
        positions[i * 3] = p.x; positions[i * 3 + 1] = p.y; positions[i * 3 + 2] = p.z;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const pointsMat = new THREE.PointsMaterial({
        color,
        size: def.medium === 'utility' ? 0.075 : def.medium === 'offgas' ? 0.085 : 0.11,
        map: this.dotTexture,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        sizeAttenuation: true
      });
      const points = new THREE.Points(geo, pointsMat);
      points.frustumCulled = false;
      this.scene.add(points);

      /* 流向箭头（每根管线合并为一个网格） */
      const arrowMat = new THREE.MeshStandardMaterial({
        color, roughness: 0.45, metalness: 0.25,
        emissive: new THREE.Color(color), emissiveIntensity: 0.18,
        transparent: true, opacity: 0.9
      });
      const arrowGeos: THREE.BufferGeometry[] = [];
      const arrowGeo = new THREE.ConeGeometry(Math.max(0.05, radius * 0.85), radius * 2.6, 6);
      const countArrows = Math.max(1, Math.min(4, Math.floor(length / 3.2)));
      for (let i = 0; i < countArrows; i++) {
        const t = (i + 0.5) / countArrows;
        const point = curve.getPointAt(t);
        const tangent = curve.getTangentAt(t).normalize();
        const pos = point.clone().add(this.surfaceNormal(tangent).multiplyScalar(radius + 0.075));
        const q = new THREE.Quaternion().setFromUnitVectors(UP, tangent);
        const geo = arrowGeo.clone();
        geo.applyMatrix4(new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)));
        arrowGeos.push(geo);
      }
      const arrows = mergedMesh(arrowGeos, arrowMat, false);
      this.scene.add(arrows);

      /* 管线编号标签 */
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'plant-pipe-label';
      label.textContent = `${def.id} · ${MEDIA[def.medium].label}`;
      label.title = `${def.name}（${PIPE_SIZES[def.size].label}）`;
      label.addEventListener('click', (e) => { e.stopPropagation(); this.selectPipe(def.id); });
      this.labelLayer.appendChild(label);

      const run: RunRuntime = {
        def, curve, length, radius, outer, outerMat, core, pulseTex, points, offsets,
        baseSpeed: MEDIUM_SPEED[def.medium], progress: Math.random(),
        arrows, arrowMat, label,
        labelPos: curve.getPointAt(0.5).add(new THREE.Vector3(0, 0.45, 0)),
        dimmed: false
      };
      this.pipeLabels.push({ run, el: label });

      /* 端部接管、法兰与弯头件 */
      if (startPort) this.addPortFitting(startPort, start, curve.getTangentAt(0.0001));
      else this.addBlindCap(start, curve.getTangentAt(0.0001), radius, def.from.type === 'cap' ? def.from.label : '');
      if (endPort) this.addPortFitting(endPort, end, curve.getTangentAt(0.9999));
      else this.addBlindCap(end, curve.getTangentAt(0.9999), radius, def.to.type === 'cap' ? def.to.label : '');

      /* 自动支吊架（长距离管廊管线由管廊支承） */
      if (!RACKED_PIPES.has(def.id)) this.addSupports(run, def);

      return run;
    } catch (err) {
      this.runtimeIssues.push(`管线 ${def.id} 构建失败：${(err as Error).message}`);
      return null;
    }
  }

  private surfaceNormal(tangent: THREE.Vector3): THREE.Vector3 {
    const up = UP.clone().sub(tangent.clone().multiplyScalar(UP.dot(tangent)));
    if (up.lengthSq() < 1e-4) return new THREE.Vector3(0, 0, 1);
    return up.normalize();
  }

  private addPortFitting(link: NonNullable<ReturnType<PlantScene['resolvePort']>>, junction: THREE.Vector3, pipeTangent: THREE.Vector3) {
    const r = PIPE_SIZES[link.port.size].radius;
    const fr = PIPE_SIZES[link.port.size].flange;

    const castGeos: THREE.BufferGeometry[] = [];
    /* 设备补充接管（模型未建该口时） */
    if (link.port.added) {
      const g = cylinderGeo(link.world.clone().addScaledVector(link.dir, -0.22), link.world, r * 1.2);
      if (g) castGeos.push(g);
    }
    const stub = cylinderGeo(link.world, junction, r * 1.05);
    if (stub) castGeos.push(stub);
    const bend = new THREE.SphereGeometry(fr * 0.78, 14, 10);
    bend.translate(junction.x, junction.y, junction.z);
    castGeos.push(bend);
    this.scene.add(mergedMesh(castGeos, this.fitCast, false));
    /* 配对法兰（贴合设备口）与管道端法兰（含螺栓，合并为单网格） */
    this.addFlangeDisc(link.world.clone().addScaledVector(link.dir, 0.015), link.dir, fr, 4);
    this.addFlangeDisc(junction, pipeTangent, fr, 4);

    const pipeRefs = PIPELINES.filter((p) =>
      (p.from.type === 'port' && p.from.node === link.node.uid && p.from.port === link.port.id) ||
      (p.to.type === 'port' && p.to.node === link.node.uid && p.to.port === link.port.id)
    ).map((p) => ({ id: p.id, media: p.medium }));
    this.ports.push({ nodeUid: link.node.uid, port: link.port, world: link.world.clone(), dir: link.dir.clone(), junction: junction.clone(), pipes: pipeRefs });
  }

  private addCylinder(from: THREE.Vector3, to: THREE.Vector3, radius: number, material: THREE.Material) {
    const geo = cylinderGeo(from, to, radius, 12);
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = false; mesh.receiveShadow = false;
    this.scene.add(mesh);
  }

  private addFlangeDisc(center: THREE.Vector3, axis: THREE.Vector3, radius: number, bolts = 4) {
    const geos: THREE.BufferGeometry[] = [discGeo(center, axis, radius)];
    const n = axis.clone().normalize();
    for (let i = 0; i < bolts; i++) {
      const a = (i / bolts) * Math.PI * 2;
      const side = new THREE.Vector3(-n.z, 0, n.x).normalize();
      if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
      const up = new THREE.Vector3().crossVectors(n, side).normalize();
      const offset = side.clone().multiplyScalar(Math.cos(a) * radius * 0.72)
        .addScaledVector(up, Math.sin(a) * radius * 0.72);
      const g = cylinderGeo(
        center.clone().add(offset).addScaledVector(n, -0.035),
        center.clone().add(offset).addScaledVector(n, 0.035),
        0.011, 6
      );
      if (g) geos.push(g);
    }
    this.scene.add(mergedMesh(geos, this.fitSteel, false));
  }

  private addBlindCap(center: THREE.Vector3, tangent: THREE.Vector3, radius: number, labelText: string) {
    const fr = Math.max(radius * 2.1, 0.09);
    this.addFlangeDisc(center, tangent, fr, 4);
    if (labelText) {
      const el = document.createElement('div');
      el.className = 'plant-cap-label';
      el.textContent = labelText;
      this.labelLayer.appendChild(el);
      this.instrumentLabels.push({ el, pos: center.clone().add(new THREE.Vector3(0, 0.32, 0)), pipe: '' });
    }
  }

  private addFlowClassRing(point: THREE.Vector3, tangent: THREE.Vector3, radius: number) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 1.35, 0.012, 6, 24),
      new THREE.MeshStandardMaterial({ color: 0xb9c6d3, roughness: 0.35, metalness: 0.75 })
    );
    ring.position.copy(point);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent.clone().normalize());
    this.scene.add(ring);
  }

  private addSupports(run: RunRuntime, def: PipelineDef) {
    const step = 3.4;
    const valveTs = inlineNodesOfPipe(def.id).map((n) => n.inline!.t)
      .concat(INSTRUMENTS.filter((i) => i.pipe === def.id).map((i) => i.t));
    for (let s = 1.6; s < run.length - 1.4; s += step) {
      const t = s / run.length;
      if (valveTs.some((vt) => Math.abs(vt - t) < 0.06)) continue;
      const p = run.curve.getPointAt(t);
      const tangent = run.curve.getTangentAt(t).normalize();
      if (Math.abs(tangent.y) > 0.55) continue;
      if (p.y < 0.38 || p.y > 2.7) continue;
      if (this.nodeAnchors.some((a) => (a.x - p.x) ** 2 + (a.z - p.z) ** 2 < (a.r + 0.25) ** 2)) continue;
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      this.addPipeSupport(p, run.radius, side, p.y > 1.6);
    }
  }

  private addPipeSupport(p: THREE.Vector3, radius: number, side: THREE.Vector3, tall: boolean) {
    const geos: THREE.BufferGeometry[] = [];
    if (tall) {
      geos.push(boxGeo(0.1, p.y, 0.1, p.x + side.x * 0.36, p.y / 2, p.z + side.z * 0.36));
      const armQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), side.clone().normalize());
      geos.push(boxGeo(0.42, 0.07, 0.08, p.x + side.x * 0.18, p.y - 0.09, p.z + side.z * 0.18, armQ));
      geos.push(boxGeo(0.24, 0.04, 0.24, p.x + side.x * 0.36, 0.02, p.z + side.z * 0.36));
    } else {
      const h = Math.max(0.2, p.y - radius - 0.02);
      for (const sgn of [-1, 1]) {
        geos.push(boxGeo(0.07, h, 0.07, p.x + side.x * sgn * 0.16, h / 2, p.z + side.z * sgn * 0.16));
        geos.push(boxGeo(0.16, 0.035, 0.16, p.x + side.x * sgn * 0.16, 0.018, p.z + side.z * sgn * 0.16));
      }
      const beamQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), side.clone().normalize());
      geos.push(boxGeo(0.42, 0.055, 0.075, p.x, h + 0.01, p.z, beamQ));
    }
    const support = mergedMesh(geos, this.supportSteel, false);
    this.scene.add(support);
    const clamp = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.35, 0.012, 6, 20), this.supportDark);
    clamp.position.copy(p);
    clamp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(side.z, 0, -side.x));
    clamp.castShadow = false;
    this.scene.add(clamp);
  }

  private buildRacks() {
    /* 回收液长距离管廊（z = -7.8，y = 2.45） */
    for (const x of [3.6, -0.8, -5.2, -9.6, -13.6]) {
      const geos: THREE.BufferGeometry[] = [];
      for (const dz of [-0.55, 0.55]) {
        geos.push(boxGeo(0.14, 2.55, 0.14, x, 1.275, -7.8 + dz));
        geos.push(boxGeo(0.3, 0.05, 0.3, x, 0.025, -7.8 + dz));
      }
      geos.push(boxGeo(0.12, 0.14, 1.24, x, 2.5, -7.8));
      geos.push(boxGeo(0.1, 0.12, 1.24, x, 1.55, -7.8));
      this.scene.add(mergedMesh(geos, this.supportSteel, false));
      const clamp = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 6, 18), this.supportDark);
      clamp.position.set(x, 2.45, -7.8);
      clamp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0));
      clamp.castShadow = false;
      this.scene.add(clamp);
    }
    /* 仪表空气总管支架（z = -5.6，y = 2.35） */
    for (const x of [-11.0, -6.8, -3.4]) {
      const geos: THREE.BufferGeometry[] = [
        boxGeo(0.1, 2.4, 0.1, x, 1.2, -5.6),
        boxGeo(0.36, 0.06, 0.07, x, 2.3, -5.6 - 0.12),
        boxGeo(0.24, 0.04, 0.24, x, 0.02, -5.6)
      ];
      this.scene.add(mergedMesh(geos, this.supportSteel, false));
      const clamp = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.011, 6, 16), this.supportDark);
      clamp.position.set(x, 2.35, -5.6);
      clamp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0));
      clamp.castShadow = false;
      this.scene.add(clamp);
    }
  }

  private collectPorts() {
    /* 端口对象在 buildRun 时逐个加入，这里只做去重（同一接口可能被多根管线引用） */
    const seen = new Set<string>();
    this.ports = this.ports.filter((p) => {
      const key = `${p.nodeUid}.${p.port.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private placeInlineNodes() {
    for (const node of this.nodes) {
      const mount = node.def.inline;
      if (!mount) continue;
      const run = this.runById.get(mount.pipe);
      if (!run) { this.runtimeIssues.push(`${node.def.uid} 的内联管线 ${mount.pipe} 不存在`); continue; }
      const t = Math.max(0, Math.min(1, mount.t));
      const point = run.curve.getPointAt(t);
      const tangent = run.curve.getTangentAt(t).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(GEN_X, tangent);
      const offset = new THREE.Vector3(0, mount.bodyY, 0).applyQuaternion(q);
      node.group.quaternion.copy(q);
      node.group.position.copy(point).sub(offset);
      node.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(node.group);
      node.size = box.getSize(new THREE.Vector3());
      node.center = box.getCenter(new THREE.Vector3());
      node.inlinePoint = point.clone();
      node.ring.visible = false;

      /* 选中高亮球 */
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(1, 20, 14),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.14, depthWrite: false })
      );
      glow.scale.setScalar(Math.max(0.28, Math.max(node.size.x, node.size.y, node.size.z) * 0.62));
      glow.position.copy(node.center);
      glow.visible = false;
      this.scene.add(glow);
      node.glow = glow;

      /* 阀门状态指示点 */
      if (mount.valve) {
        const light = new THREE.Mesh(
          new THREE.SphereGeometry(0.045, 12, 10),
          new THREE.MeshBasicMaterial({ color: 0x34d399 })
        );
        light.position.copy(node.center).add(new THREE.Vector3(0, node.size.y / 2 + 0.1, 0));
        this.scene.add(light);
        node.stateLight = light;
      }
    }
  }

  /* ============================ 工艺层与辅助 ============================ */

  private buildLayerZones() {
    for (const layer of PROCESS_LAYERS) {
      for (const zone of layer.zones) {
        const [x1, z1, x2, z2] = zone;
        const w = Math.abs(x2 - x1), d = Math.abs(z2 - z1);
        const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
        const pad = new THREE.Mesh(
          new THREE.PlaneGeometry(w, d),
          new THREE.MeshBasicMaterial({ color: layer.color, transparent: true, opacity: 0.05, depthWrite: false })
        );
        pad.rotation.x = -Math.PI / 2;
        pad.position.set(cx, 0.008, cz);
        this.scene.add(pad);
        const pts = [
          new THREE.Vector3(x1, 0.02, z1), new THREE.Vector3(x2, 0.02, z1),
          new THREE.Vector3(x2, 0.02, z2), new THREE.Vector3(x1, 0.02, z2)
        ];
        const border = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: layer.color, transparent: true, opacity: 0.35 })
        );
        this.scene.add(border);
        const el = document.createElement('div');
        el.className = 'plant-layer-label';
        el.textContent = `${layer.id} · ${layer.short}`;
        el.style.color = `#${layer.color.toString(16).padStart(6, '0')}`;
        this.labelLayer.appendChild(el);
        this.zoneLabels.push({ el, pos: new THREE.Vector3(cx, 0.03, cz), layer: layer.id, pad, border });
      }
    }
  }

  private buildRuler() {
    const x = -17.4, z = 3.1;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.4, 0.08), steelMat(0x7c8b9c, 0.6, 0.4));
    post.position.set(x, 1.7, z);
    this.scene.add(post);
    const marks: [number, string][] = [[0, '±0.000'], [1, '+1.0'], [2, '+2.0'], [3, '+3.0']];
    for (const [h, text] of marks) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.025, 0.025), steelMat(0xa8b6c5, 0.5, 0.5));
      tick.position.set(x + 0.2, h, z);
      this.scene.add(tick);
      const el = document.createElement('div');
      el.className = 'plant-ruler-label';
      el.textContent = text;
      this.labelLayer.appendChild(el);
      this.rulerLabels.push({ el, pos: new THREE.Vector3(x + 0.55, h, z) });
    }
    const note = document.createElement('div');
    note.className = 'plant-ruler-label plant-ruler-note';
    note.textContent = '示意标高 / m';
    this.labelLayer.appendChild(note);
    this.rulerLabels.push({ el: note, pos: new THREE.Vector3(x + 0.55, 3.4, z) });
  }

  private buildInstrumentMeshes() {
    for (const inst of INSTRUMENTS) {
      const run = this.runById.get(inst.pipe);
      if (!run) continue;
      const t = Math.max(0.02, Math.min(0.98, inst.t));
      const p = run.curve.getPointAt(t);
      const tangent = run.curve.getTangentAt(t).normalize();
      const normal = this.surfaceNormal(tangent);
      const stemTop = p.clone().addScaledVector(normal, 0.24);
      this.addCylinder(p, stemTop, 0.018, steelMat(0x8b97a5, 0.4, 0.7));
      const dial = new THREE.Mesh(
        new THREE.CylinderGeometry(0.085, 0.085, 0.035, 20),
        new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: 0.35, metalness: 0.1 })
      );
      dial.position.copy(stemTop).addScaledVector(normal, 0.03);
      dial.quaternion.setFromUnitVectors(UP, new THREE.Vector3(0, 0, 1));
      dial.castShadow = true;
      dial.userData.pipeId = inst.pipe;
      this.scene.add(dial);
      this.pipePickables.push(dial);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 6, 20), steelMat(0x5a6674, 0.5, 0.5));
      rim.position.copy(dial.position).add(new THREE.Vector3(0, 0, 0.017));
      this.scene.add(rim);
      const needle = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.06, 0.004), new THREE.MeshBasicMaterial({ color: 0xb45331 }));
      needle.position.copy(dial.position).add(new THREE.Vector3(0, 0.018, 0.02));
      this.scene.add(needle);
      const el = document.createElement('div');
      el.className = 'plant-instrument-label';
      el.textContent = `${inst.tag} ${inst.name}`;
      this.labelLayer.appendChild(el);
      this.instrumentLabels.push({ el, pos: dial.position.clone().add(new THREE.Vector3(0, 0.19, 0)), pipe: inst.pipe });
    }
  }

  /* ============================ 选择、视图与追踪 ============================ */

  private onPointerDown = (e: PointerEvent) => {
    this.pointerDown.x = e.clientX;
    this.pointerDown.y = e.clientY;
  };

  private onPointerUp = (e: PointerEvent) => {
    const dx = e.clientX - this.pointerDown.x;
    const dy = e.clientY - this.pointerDown.y;
    if (dx * dx + dy * dy > 36) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.nodePickables, ...this.pipePickables], false);
    for (const hit of hits) {
      const uid = hit.object.userData.nodeUid as string | undefined;
      if (uid) { this.select(uid); return; }
      const pid = hit.object.userData.pipeId as string | undefined;
      if (pid) { this.selectPipe(pid); return; }
    }
    this.clearSelection();
  };

  select(uid: string | null) {
    this.selectedNode = uid;
    this.selectedPipe = null;
    this.applySelectionVisual();
    this.cb.onSelectNode(uid);
    this.cb.onSelectPipe(null);
  }

  selectPipe(pipeId: string | null) {
    this.selectedPipe = pipeId;
    this.selectedNode = null;
    this.applySelectionVisual();
    this.cb.onSelectPipe(pipeId);
    this.cb.onSelectNode(null);
  }

  clearSelection() {
    this.select(null);
  }

  get selectedUid() { return this.selectedNode; }
  get selectedPipeId() { return this.selectedPipe; }

  setTrace(result: TraceResult | null) {
    this.trace = result;
    this.applyFocusVisual();
  }

  getTrace() { return this.trace; }

  setStepFocus(stepId: string | null) {
    this.stepFocus = stepId;
    this.applyFocusVisual();
  }

  setLayerFocus(layerId: LayerId | null) {
    this.layerFocus = layerId;
    this.applyFocusVisual();
  }

  setMode(mode: PlantViewMode) {
    this.mode = mode;
    this.container.dataset.mode = mode;
    this.labelLayer.dataset.mode = mode;
    this.applyAllAppearance();
    this.updateLabelVisibility();
    this.updateLabels();
  }
  get viewMode() { return this.mode; }

  setXray(on: boolean) {
    this.xray = on;
    this.applyNodeAppearance();
  }
  get xrayEnabled() { return this.xray; }

  private applySelectionVisual() {
    for (const n of this.nodes) {
      const selected = n.def.uid === this.selectedNode;
      n.ring.visible = selected && !n.def.inline;
      if (n.glow) n.glow.visible = selected && !!n.def.inline;
      n.label.classList.toggle('active', selected);
    }
    for (const run of this.runs) {
      const selected = run.def.id === this.selectedPipe;
      run.outerMat.emissive.setHex(selected ? MEDIA[run.def.medium].color : 0x000000);
      run.outerMat.emissiveIntensity = selected ? 0.45 : 0;
      run.label.classList.toggle('active', selected);
    }
    this.applyFocusVisual();
  }

  private focusSets(): { nodes: Set<string>; pipes: Set<string> } | null {
    if (this.trace) return this.trace;
    if (this.stepFocus) {
      const step = PROCESS_STEPS.find((s) => s.id === this.stepFocus);
      if (!step) return null;
      const nodes = new Set<string>(step.nodes);
      const pipes = new Set<string>(step.pipes);
      for (const pid of step.pipes) for (const n of inlineNodesOfPipe(pid)) nodes.add(n.uid);
      return { nodes, pipes };
    }
    if (this.layerFocus) {
      const layer = getLayer(this.layerFocus);
      const nodes = new Set<string>(layer.devices);
      const pipes = new Set<string>();
      for (const uid of layer.devices) {
        for (const p of this.pipesOfNode(uid)) {
          pipes.add(p.id);
          for (const n of inlineNodesOfPipe(p.id)) nodes.add(n.uid);
        }
      }
      return { nodes, pipes };
    }
    return null;
  }

  private pipesOfNode(uid: string): PipelineDef[] {
    const node = getNodeByUid(uid);
    if (node?.inline) {
      const host = this.runById.get(node.inline.pipe);
      return host ? [host.def] : [];
    }
    return PIPELINES.filter((p) =>
      (p.from.type === 'port' && p.from.node === uid) || (p.to.type === 'port' && p.to.node === uid)
    );
  }

  private applyFocusVisual() {
    const focus = this.focusSets();
    const piping = this.mode === 'piping';
    for (const n of this.nodes) {
      const dim = (!!focus && !focus.nodes.has(n.def.uid))
        || (piping && !n.def.inline && n.def.uid !== this.selectedNode);
      if (n.dimmed !== dim) { n.dimmed = dim; this.refreshNodeMaterials(n); }
      n.label.classList.toggle('dimmed', dim);
    }
    for (const run of this.runs) {
      run.dimmed = !!focus && !focus.pipes.has(run.def.id);
    }
    for (const z of this.zoneLabels) {
      const active = this.layerFocus === z.layer;
      z.el.classList.toggle('active', active);
      const base = active ? 0.14 : this.mode === 'process' ? 0.1 : 0.05;
      (z.pad.material as THREE.MeshBasicMaterial).opacity = base;
      (z.border.material as THREE.LineBasicMaterial).opacity = active ? 0.85 : this.mode === 'process' ? 0.55 : 0.32;
    }
    this.applyPipeVisuals();
  }

  private applyAllAppearance() {
    for (const n of this.nodes) this.refreshNodeMaterials(n);
    this.applyFocusVisual();
    this.updateLabelVisibility();
  }

  private applyNodeAppearance() {
    for (const n of this.nodes) this.refreshNodeMaterials(n);
  }

  private refreshNodeMaterials(node: NodeRuntime) {
    const device = deviceOfNode(node.def);
    const transparentDevice = TRANSPARENT_DEVICES.has(device.id);
    for (const mesh of node.meshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat) continue;
      if (!mat.userData.plantBase) {
        const base: MeshBase = {
          opacity: mat.opacity,
          transparent: mat.transparent,
          depthWrite: mat.depthWrite
        };
        mat.userData.plantBase = base;
      }
      const base = mat.userData.plantBase as MeshBase;
      const partShell = node.shellPartIds.has(mesh.userData.partId as string);
      let opacity = base.opacity;
      let transparent = base.transparent;
      let depthWrite = base.depthWrite;
      if (partShell && (this.xray || transparentDevice)) {
        transparent = true;
        opacity = Math.min(opacity, this.xray ? 0.32 : 0.3);
        depthWrite = false;
      }
      if (node.dimmed) {
        transparent = true;
        opacity = Math.min(opacity, 0.13);
        depthWrite = false;
      }
      if (mat.transparent !== transparent || Math.abs(mat.opacity - opacity) > 0.001 || mat.depthWrite !== depthWrite) {
        mat.transparent = transparent;
        mat.opacity = opacity;
        mat.depthWrite = depthWrite;
        mat.needsUpdate = true;
      }
    }
    if (node.stateLight) {
      const state = this.getValveState(node.def.uid);
      const color = state === 'open' ? 0x34d399 : state === 'partial' ? 0xfbbf24 : 0xf87171;
      (node.stateLight.material as THREE.MeshBasicMaterial).color.setHex(color);
    }
  }

  private applyPipeVisuals() {
    const fluid = this.mode === 'fluid';
    const processMode = this.mode === 'process';
    for (const run of this.runs) {
      const dim = run.dimmed;
      const quiet = processMode && run.def.medium === 'utility';
      const flow = this.flows.get(run.def.id);
      run.outerMat.transparent = fluid || dim || quiet;
      run.outerMat.opacity = dim ? 0.12 : fluid ? 0.28 : quiet ? 0.32 : 1;
      run.outerMat.depthWrite = !(fluid || dim || quiet);
      run.outerMat.needsUpdate = true;
      run.core.visible = fluid && !dim;
      (run.core.material as THREE.MeshBasicMaterial).opacity = 0.9;
      run.points.visible = flow?.state !== 'off' && !dim;
      run.points.material.opacity = dim ? 0.12 : quiet ? 0.3 : 0.95;
      run.arrowMat.opacity = dim ? 0.08 : quiet ? 0.22 : 0.9;
      run.arrows.visible = !dim && !quiet && flow?.state !== 'halt' && flow?.state !== 'off';
    }
    this.updateLabelVisibility();
  }

  /* ============================ 流动计算 ============================ */

  setValveState(uid: string, state: ValveState) {
    const node = getNodeByUid(uid);
    const kind = node?.inline?.valve;
    if (!kind || !VALVE_OPERATIONS[kind].commands.includes(state)) return;
    this.valveStates.set(uid, state);
    const runtime = this.nodeByUid.get(uid);
    if (runtime) {
      const label = runtime.label.querySelector('.plant-label-state');
      if (label) {
        label.className = `plant-label-state is-${state}`;
        label.textContent = VALVE_STATE_LABEL[state];
      }
      this.refreshNodeMaterials(runtime);
    }
    this.recomputeFlows();
    this.applyFlowVisuals();
    this.cb.onFlowsChanged();
  }

  getValveState(uid: string): ValveState {
    const inline = getNodeByUid(uid)?.inline;
    if (inline?.valve === 'check') {
      const flow = this.flows.get(inline.pipe);
      return flow && flow.state !== 'off' && (flow.state !== 'halt' || flow.haltT > inline.t) ? 'open' : 'closed';
    }
    return this.valveStates.get(uid) ?? 'open';
  }

  getPipeFlow(pipeId: string): PipeFlowState | null {
    return this.flows.get(pipeId) ?? null;
  }

  setEquipmentCommand(uid: string, enabled: boolean) {
    if (!PLANT_EQUIPMENT_CONTROLS[uid]) return;
    this.deviceCommands.set(uid, enabled);
    this.recomputeFlows();
    this.applyFlowVisuals();
    this.cb.onFlowsChanged();
  }

  getEquipmentStatus(uid: string): EquipmentStatus | null {
    const control = PLANT_EQUIPMENT_CONTROLS[uid];
    if (!control) return null;
    const enabled = this.deviceCommands.get(uid) ?? true;
    if (['P-101', 'P-102', 'P-103'].includes(uid)) {
      const solved = this.solvedFlow;
      const pneumatic = control === 'air';
      const air = !pneumatic || this.scenario.recoveryAir;
      const hasMaterial = !!solved?.inlet(uid, 'suction');
      const hasOutlet = PIPELINES.some(pipe =>
        pipe.from.type === 'port' && pipe.from.node === uid && pipe.from.port === 'discharge'
        && solved?.flows.get(pipe.id)?.state === 'full');
      return pumpStatus(enabled, air, hasMaterial, hasOutlet, pneumatic);
    }
    return { enabled, active: enabled, description: enabled ? '运行中' : '已停止' };
  }

  get scenarioState() { return { ...this.scenario }; }

  setScenario(key: keyof PlantScenario, on: boolean) {
    if (this.scenario[key] === on) return;
    this.scenario[key] = on;
    this.recomputeFlows();
    this.applyFlowVisuals();
    this.cb.onFlowsChanged();
  }

  recomputeFlows() {
    const solved = plantFlow(uid => this.valveStates.get(uid) ?? 'open', uid => this.deviceCommands.get(uid) ?? true, this.scenario);
    this.solvedFlow = solved;
    this.flows = solved.flows;
    for (const node of this.nodes) {
      const control = this.getEquipmentStatus(node.def.uid);
      const host = node.def.inline && this.flows.get(node.def.inline.pipe);
      const source = node.def.uid === 'T-101' && this.scenario.feedAvailable;
      node.active = control ? control.active : host ? host.state !== 'off' : source || solved.supplied.has(node.def.uid);
    }
  }

  private applyFlowVisuals() {
    for (const node of this.nodes) {
      const status = this.getEquipmentStatus(node.def.uid);
      const badge = node.label.querySelector('.plant-equipment-state');
      if (status && badge) {
        badge.textContent = status.active ? '运行' : status.enabled ? '待供给' : '停止';
        badge.setAttribute('title', status.description);
      }
      if (node.internal) node.internal.points.visible = this.running && node.active;
      if (node.def.uid === 'T-101') {
        for (const liquid of node.liquids) liquid.visible = this.scenario.feedAvailable;
      }
      const starved = !node.active && !node.def.inline;
      node.label.classList.toggle('starved', starved);
      if (node.def.inline?.valve === 'check') {
        const state = this.getValveState(node.def.uid);
        const label = node.label.querySelector('.plant-label-state');
        if (label) {
          label.className = 'plant-label-state is-' + state;
          label.textContent = VALVE_STATE_LABEL[state];
        }
        if (node.stateLight) this.refreshNodeMaterials(node);
      }
    }
    this.applyPipeVisuals();
  }

  /* ============================ 相机 ============================ */

  screenPosition(uid: string) {
    const node = this.nodeByUid.get(uid);
    if (!node) return null;
    this.camera.updateMatrixWorld(true);
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
    const rect = this.renderer.domElement.getBoundingClientRect();
    const toScreen = (p: THREE.Vector3) => {
      const v = p.clone().project(this.camera);
      return { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height };
    };
    const hitsAt = (s: { x: number; y: number }) => {
      const ndc = new THREE.Vector2(
        ((s.x - rect.left) / rect.width) * 2 - 1,
        -((s.y - rect.top) / rect.height) * 2 + 1
      );
      this.raycaster.setFromCamera(ndc, this.camera);
      return this.raycaster.intersectObjects(this.nodePickables, false);
    };
    for (const off of [0, -0.15, 0.15, -0.3, 0.3, -0.45, 0.45]) {
      const p = node.center.clone();
      p.y += node.size.y * off;
      const s = toScreen(p);
      if (hitsAt(s).some((h) => h.object.userData.nodeUid === uid)) return s;
    }
    return toScreen(node.center);
  }

  focusNode(uid: string) {
    const node = this.nodeByUid.get(uid);
    if (!node) return;
    const dist = Math.max(5.2, Math.max(node.size.x, node.size.y, node.size.z) * 2.1);
    const dir = new THREE.Vector3(0.55, 0.5, 0.9).normalize();
    const toTarget = node.center.clone();
    const toPos = toTarget.clone().addScaledVector(dir, dist);
    this.tweenCamera(toPos, toTarget);
  }

  focusPipe(pipeId: string) {
    const run = this.runById.get(pipeId);
    if (!run) return;
    const target = run.curve.getPointAt(0.5);
    const dist = Math.max(7, Math.min(22, run.length * 0.9));
    const dir = new THREE.Vector3(0.45, 0.55, 0.95).normalize();
    this.tweenCamera(target.clone().addScaledVector(dir, dist), target);
  }

  focusStep(stepId: string) {
    const step = PROCESS_STEPS.find((s) => s.id === stepId);
    if (!step) return;
    const nodes = step.nodes.map((uid) => this.nodeByUid.get(uid)).filter((n): n is NodeRuntime => !!n);
    if (!nodes.length) return;
    const target = new THREE.Vector3();
    for (const n of nodes) target.add(n.center);
    target.multiplyScalar(1 / nodes.length);
    const spread = Math.max(...nodes.map((n) => n.center.distanceTo(target)));
    const dist = Math.max(9, spread * 2.6 + 6);
    const dir = new THREE.Vector3(0.5, 0.55, 0.95).normalize();
    this.tweenCamera(target.clone().addScaledVector(dir, dist), target);
  }

  focusLayer(layerId: LayerId) {
    const layer = getLayer(layerId);
    const nodes = layer.devices.map((uid) => this.nodeByUid.get(uid)).filter((n): n is NodeRuntime => !!n);
    if (!nodes.length) return;
    const target = new THREE.Vector3();
    for (const n of nodes) target.add(n.center);
    target.multiplyScalar(1 / nodes.length);
    const spread = Math.max(...nodes.map((n) => n.center.distanceTo(target)));
    const dist = Math.max(10, spread * 2.4 + 7);
    const dir = new THREE.Vector3(0.5, 0.55, 0.95).normalize();
    this.tweenCamera(target.clone().addScaledVector(dir, dist), target);
  }

  private tweenCamera(toPos: THREE.Vector3, toTarget: THREE.Vector3) {
    this.camTween = {
      t0: performance.now(), dur: 650,
      fromPos: this.camera.position.clone(), toPos,
      fromTarget: this.controls.target.clone(), toTarget
    };
  }

  fitView(instant = false) {
    const target = new THREE.Vector3(-2.7, 1.55, -3.2);
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hTan = Math.tan(vFov / 2) * Math.max(0.5, this.camera.aspect);
    const distW = 25.5 / hTan;
    const distH = 8.2 / Math.tan(vFov / 2);
    const dist = Math.max(30.5, distW, distH);
    const dir = new THREE.Vector3(0, 0.34, 0.95).normalize();
    const pos = target.clone().addScaledVector(dir, dist);
    if (instant) {
      this.camTween = null;
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      this.camera.updateMatrixWorld(true);
      this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
      return;
    }
    this.tweenCamera(pos, target);
  }

  get navigationState() {
    return {
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      selected: this.selectedNode,
      selectedPipe: this.selectedPipe,
      stepFocus: this.stepFocus,
      layerFocus: this.layerFocus,
      mode: this.mode,
      xray: this.xrayEnabled,
      speed: this.speedMul,
      running: this.running,
      valves: [...this.valveStates],
      equipment: [...this.deviceCommands],
      scenario: this.scenarioState
    };
  }

  restoreNavigation(state: PlantScene['navigationState']) {
    this.scenario = { ...DEFAULT_PLANT_SCENARIO, ...state.scenario };
    for (const [uid, value] of state.valves) this.setValveState(uid, value);
    for (const [uid, enabled] of state.equipment) this.setEquipmentCommand(uid, enabled);
    this.setXray(state.xray);
    this.setStepFocus(state.stepFocus);
    this.setLayerFocus(state.layerFocus);
    this.setSpeed(state.speed);
    if (state.selectedPipe) this.selectPipe(state.selectedPipe);
    else this.select(state.selected);
    this.running = state.running;
    this.recomputeFlows();
    this.applyFlowVisuals();
    this.cb.onFlowsChanged();
    this.camTween = null;
    this.userInteracted = true;
    this.camera.position.fromArray(state.position);
    this.controls.target.fromArray(state.target);
    this.controls.update();
    this.updateLabels();
  }

  /* ============================ 运行控制 ============================ */

  start() { this.running = true; this.recomputeFlows(); this.applyFlowVisuals(); }
  pause() { this.running = false; this.applyFlowVisuals(); }
  toggle() { this.running = !this.running; if (this.running) this.recomputeFlows(); this.applyFlowVisuals(); return this.running; }
  get isRunning() { return this.running; }

  setSpeed(mul: number) { this.speedMul = mul; }
  get speed() { return this.speedMul; }

  toggleLabels(on: boolean) {
    this.labelsOn = on;
    this.labelLayer.classList.toggle('labels-off', !on);
    this.updateLabelVisibility();
  }

  setLabelVisibility(on: boolean) { this.toggleLabels(on); }

  private resize() {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    if (!this.userInteracted) this.fitView(true);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.running) {
      this.elapsed += dt * this.speedMul;
      this.animate(dt * this.speedMul);
    }
    if (this.camTween) {
      const t = Math.min(1, (performance.now() - this.camTween.t0) / this.camTween.dur);
      const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.camera.position.lerpVectors(this.camTween.fromPos, this.camTween.toPos, k);
      this.controls.target.lerpVectors(this.camTween.fromTarget, this.camTween.toTarget, k);
      if (t >= 1) this.camTween = null;
    }
    this.controls.update();
    this.updateLabels();
    this.renderer.render(this.scene, this.camera);
    this.fpsFrames += 1;
    const now = performance.now();
    if (now - this.fpsMark >= 1000) {
      this.fps = (this.fpsFrames * 1000) / (now - this.fpsMark);
      this.fpsFrames = 0;
      this.fpsMark = now;
    }
  };

  private animate(dt: number) {
    const t = this.elapsed;
    for (const n of this.nodes) {
      if (n.active) {
        for (const r of n.rotors) r.obj.rotation[r.axis] += r.speed * dt;
        for (const part of n.stroke) part.obj.position.x = part.origin + 0.035 * Math.sin(t * 5);
        if (n.internal) this.updateInternal(n.internal, t, dt);
      }
    }
    for (const run of this.runs) {
      const flow = this.flows.get(run.def.id);
      if (!flow || flow.state === 'off') continue;
      const factor = flow.throttle ? 0.45 : 1;
      run.progress = (run.progress + (run.baseSpeed / Math.max(0.6, run.length)) * dt * factor) % 1;
      const attr = run.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const p = new THREE.Vector3();
      const fluid = this.mode === 'fluid';
      for (let i = 0; i < run.offsets.length; i++) {
        let u = (run.offsets[i] + run.progress) % 1;
        if (flow.state === 'halt') u = u % Math.max(0.02, flow.haltT - 0.01);
        run.curve.getPointAt(u, p);
        if (!fluid) {
          const tangent = run.curve.getTangentAt(u).normalize();
          p.add(this.surfaceNormal(tangent).multiplyScalar(run.radius + 0.03));
        }
        attr.setXYZ(i, p.x, p.y, p.z);
      }
      attr.needsUpdate = true;
      run.pulseTex.offset.x -= dt * run.baseSpeed * 0.55 * factor;
      run.arrowMat.opacity = 0.62 + 0.28 * (0.5 + 0.5 * Math.sin(t * 3.1));
    }
  }

  private updateInternal(f: InternalFlow, t: number, dt: number) {
    const attr = f.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const count = f.phases.length;
    for (let i = 0; i < count; i++) {
      let ph = f.phases[i];
      const isGas = i % 2 === 0;
      const seedA = f.seeds[i * 2];
      const seedR = f.seeds[i * 2 + 1];
      if (f.kind === 'tower') {
        // The tower has a liquid feed only. The independent gas lesson starts at its top pipe.
        ph = (ph + dt * 0.12) % 1;
        const y = 2.25 - ph * 1.75;
        const r = 0.315 + (seedR - 0.55) * 0.02;
        attr.setXYZ(i, Math.cos(seedA + t * 0.6) * r, y, Math.sin(seedA + t * 0.6) * r);
      } else if (f.kind === 'separator') {
        ph = (ph + dt * (isGas ? 0.18 : 0.22)) % 1;
        const y = isGas ? 0.8 + ph * 0.6 : 1.35 - ph * 0.75;
        const r = 0.22 * seedR;
        attr.setXYZ(i, Math.cos(seedA) * r, y, Math.sin(seedA) * r);
      } else {
        ph = (ph + dt * 0.3) % 1;
        const y = 1.62 - ph * 1.1;
        const r = 0.26 * (0.45 + 0.55 * (y - 0.5) / 1.1);
        const a = seedA + t * 3.4 + ph * Math.PI * 4;
        attr.setXYZ(i, Math.cos(a) * r, y, Math.sin(a) * r);
      }
      f.phases[i] = ph;
    }
    attr.needsUpdate = true;
  }

  /* ============================ 标签 ============================ */

  private updateLabelVisibility() {
    for (const run of this.runs) {
      const show = this.labelsOn && (this.mode === 'piping' || this.mode === 'fluid' || this.selectedPipe === run.def.id);
      run.label.dataset.show = show ? '1' : '0';
      if (!show) run.label.style.display = 'none';
    }
  }

  private updateLabels() {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;
    const v = new THREE.Vector3();
    interface Cand { el: HTMLElement; x: number; y: number; w: number; h: number; prio: number; centerY?: boolean; }
    const cands: Cand[] = [];
    const estimate = (text: string | null, base: number, per: number, max: number) =>
      Math.min(max, base + (text?.length ?? 0) * per);
    const push = (el: HTMLElement, pos: THREE.Vector3, prio: number, cw: number, ch: number, centerY = false) => {
      v.copy(pos).project(this.camera);
      if (!(v.z < 1 && v.z > -1)) { el.style.display = 'none'; return; }
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      if (x < -90 || x > w + 90 || y < -50 || y > h + 50) { el.style.display = 'none'; return; }
      cands.push({ el, x, y, w: cw, h: ch, prio, centerY });
    };

    if (this.labelsOn) {
      for (const n of this.nodes) {
        v.copy(n.center);
        v.y = n.center.y + n.size.y / 2 + 0.22 + (n.def.labelLift ?? 0);
        const selected = n.def.uid === this.selectedNode;
        let prio: number;
        if (selected) prio = 0;
        else if (n.def.inline) prio = this.mode === 'piping' || this.mode === 'fluid' ? 3 : 2;
        else prio = this.mode === 'piping' || this.mode === 'fluid' ? 4 : 1;
        if (n.dimmed) prio += 2;
        const cw = n.def.inline ? estimate(n.label.textContent, 42, 5.2, 90) : estimate(n.label.textContent, 22, 5.6, 170);
        const ch = n.def.inline ? 24 : 34;
        push(n.label, v.clone(), prio, cw, ch);
      }
      for (const p of this.pipeLabels) {
        if (p.el.dataset.show !== '1') { p.el.style.display = 'none'; continue; }
        const selected = this.selectedPipe === p.run.def.id;
        const prio = selected ? 0 : this.mode === 'piping' || this.mode === 'fluid' ? 1 : 6;
        push(p.el, p.run.labelPos, prio, estimate(p.el.textContent, 16, 5.6, 170), 20);
      }
      for (const ins of this.instrumentLabels) {
        const show = this.mode === 'piping' || this.mode === 'fluid' || (!!ins.pipe && this.selectedPipe === ins.pipe);
        if (!show) { ins.el.style.display = 'none'; continue; }
        push(ins.el, ins.pos, 5, estimate(ins.el.textContent, 10, 5.2, 170), 19);
      }
    } else {
      for (const n of this.nodes) n.label.style.display = 'none';
      for (const p of this.pipeLabels) p.el.style.display = 'none';
      for (const ins of this.instrumentLabels) ins.el.style.display = 'none';
    }

    cands.sort((a, b) => a.prio - b.prio || a.y - b.y);
    const placed: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const c of cands) {
      const rect = c.centerY
        ? { x1: c.x - c.w / 2, y1: c.y - c.h / 2, x2: c.x + c.w / 2, y2: c.y + c.h / 2 }
        : { x1: c.x - c.w / 2, y1: c.y - c.h, x2: c.x + c.w / 2, y2: c.y };
      const hit = placed.some((p) => !(rect.x2 < p.x1 - 1 || rect.x1 > p.x2 + 1 || rect.y2 < p.y1 - 1 || rect.y1 > p.y2 + 1));
      if (hit) { c.el.style.display = 'none'; continue; }
      placed.push(rect);
      c.el.style.display = '';
      c.el.style.transform = `translate(-50%, ${c.centerY ? '-50%' : '-100%'}) translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px)`;
    }

    for (const z of this.zoneLabels) {
      v.copy(z.pos).project(this.camera);
      const visible = v.z < 1 && v.z > -1;
      z.el.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      z.el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
    for (const r of this.rulerLabels) {
      v.copy(r.pos).project(this.camera);
      const visible = v.z < 1 && v.z > -1;
      r.el.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      r.el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }

  /* ============================ 检查/调试 ============================ */

  get debugState() {
    const render = this.renderer.info.render;
    const tower = this.nodeByUid.get('T-102')?.internal?.points;
    return {
      pos: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      aspect: this.camera.aspect,
      size: [this.renderer.domElement.width, this.renderer.domElement.height],
      mode: this.mode,
      selected: this.selectedNode,
      selectedPipe: this.selectedPipe,
      towerTracers: tower && {
        visible: tower.visible,
        heights: Array.from({ length: tower.geometry.attributes.position.count },
          (_, index) => tower.geometry.attributes.position.getY(index))
      },
      fps: Math.round(this.fps),
      drawCalls: render.calls,
      triangles: render.triangles,
      lines: render.lines,
      points: render.points,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures
    };
  }

  audit() {
    const base = auditPlantData();
    const issues = [...base.issues, ...this.runtimeIssues];
    const missingRuns = PIPELINES.filter((p) => !this.runById.has(p.id)).map((p) => p.id);
    if (missingRuns.length) issues.push(`未构建管线：${missingRuns.join('、')}`);
    const inlineMissing = PLANT_NODES.filter((n) => n.inline && !this.runById.has(n.inline.pipe)).map((n) => n.uid);
    if (inlineMissing.length) issues.push(`内联件未挂接：${inlineMissing.join('、')}`);
    return {
      ...base,
      issues,
      runtime: {
        pipesBuilt: this.runs.length,
        portsLinked: this.ports.length,
        valvesInline: [...this.valveStates.keys()].length,
        instrumentsBuilt: INSTRUMENTS.length,
        mode: this.mode
      }
    };
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.controls.dispose();
    this.labelLayer.remove();

    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
      if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
    });
    // 缓存中的几何体保留顶点数据，dispose 解除当前渲染器的 GPU 缓冲及事件引用。
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.dotTexture.dispose();
    this.stripeTexture.dispose();
    this.environmentTarget.dispose();
    this.scene.environment = null;
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
