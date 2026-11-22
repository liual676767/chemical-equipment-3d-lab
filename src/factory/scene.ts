import { actOnCoatingBatch, initialCoatingBatch, type CoatingAction } from '../process/coatingBatch';
import { factoryFlow, FACTORY_EQUIPMENT_CONTROLS } from '../data/factory';
import type { PipeFlowState } from '../process/teachingFlow';
import { pumpStatus, type EquipmentStatus } from '../process/equipmentCommand';
import { VALVE_OPERATIONS, VALVE_STATE_LABEL } from '../data/valveOperations';
import { deck as platform, stairCount, tread, stepGeometry, walkSurface, stairApproach, walkerRadius } from './platform';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildPart } from '../engine/builders';
import {
  FACTORY_MEDIA, FACTORY_NODES, FACTORY_PIPES, FACTORY_INSTRUMENTS, FACTORY_STEPS, FACTORY_ZONES, FACTORY_JOINTS,
  PORT_STUB, PIPE_SIZES,
  catalogDeviceOfNode, getNodeByUid, getZone, inlineNodesOfPipe, valvesOfPipe,
  auditFactoryData, traceFrom,
  type FactoryNodeDef, type FactoryPipelineDef, type FactoryJointDef, type FactoryStepDef,
  type ZoneId, type FactoryMediumId, type PortDef, type ValveState, type TraceResult
} from '../data/factory';
import {
  roundedPath, makeDotTexture, makeStripeTexture, steelMat, mergedMesh,
  cylinderGeo, discGeo, boxGeo
} from '../plant/scene';

/**
 * 三维教学工厂 · 水性涂料调配车间场景。
 * 轻工业配色与站点一致；设备整机由实训室零件级构建器组装，
 * 接口 → 法兰 → 管线 → 内联阀/仪表全部数据驱动；
 * 远景使用简化外形（保留选中身份），近景显示位号，选中显示接口热区；
 * 走道/平台/楼梯为教学示意布置。
 */

export interface FactoryCallbacks {
  onSelectNode: (uid: string | null) => void;
  onSelectPipe: (pipeId: string | null) => void;
  onPortPick?: (uid: string, portId: string) => void;
  onJointPick?: (jointId: string) => void;
  onFlowsChanged?: () => void;
  onWalkChange?: (on: boolean) => void;
  onStatus?: (text: string) => void;
}

interface RotorSpec { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number; }
interface MeshBase { opacity: number; transparent: boolean; depthWrite: boolean; }

interface NodeRuntime {
  def: FactoryNodeDef;
  group: THREE.Group;
  size: THREE.Vector3;
  center: THREE.Vector3;
  box: THREE.Box3;
  label: HTMLButtonElement;
  ring: THREE.Mesh;
  glow?: THREE.Mesh;
  stateLight?: THREE.Mesh;
  rotors: RotorSpec[];
  stroke: { obj: THREE.Object3D; origin: number }[];
  liquids: THREE.Mesh[];
  liquidPhase: number;
  meshes: THREE.Mesh[];
  shellPartIds: Set<string>;
  dimmed: boolean;
  active: boolean;
  proxy?: THREE.Mesh;
  appearance?: { wrapper: THREE.Group; url: string };
  inlinePoint?: THREE.Vector3;
}

interface RunRuntime {
  def: FactoryPipelineDef;
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
}

const UP = new THREE.Vector3(0, 1, 0);
const GEN_X = new THREE.Vector3(1, 0, 0);

const SELECT_COLOR = 0x1d4ed8;
const ARROW_COLOR = 0xeaa23b;

const TRANSPARENT_DEVICES = new Set(['fixed-roof-tank', 'reactor', 'packed-tower', 'gas-separator', 'cyclone-separator']);

const MEDIUM_SPEED: Record<FactoryMediumId, number> = {
  feed: 1.15, premix: 1.05, product: 1.05, packed: 0.85, sample: 0.85, air: 1.65, clean: 0.9, aux: 0.95
};
const MEDIUM_SPACING: Record<FactoryMediumId, number> = {
  feed: 0.5, premix: 0.5, product: 0.5, packed: 1.05, sample: 0.55, air: 0.95, clean: 0.65, aux: 0.55
};

const PROXY_SHAPE: Record<string, 'cylinder' | 'box'> = {
  'fixed-roof-tank': 'cylinder', reactor: 'cylinder', 'bag-filter': 'cylinder', 'clean-drum': 'cylinder',
  'screw-compressor': 'box', pump: 'box', 'diaphragm-pump': 'box', filler: 'box', 'storage-area': 'box'
};

const LOD_DIST = 30;
const NEAR_DIST = 34;
const EYE_HEIGHT = 1.7;
const WALK_SPEED = 3.4;
const BOUNDS = { x1: -19.4, x2: 24.9, z1: -10.4, z2: 12.4 };
const ROOM = { x1: -20, x2: 25.5, z1: -11, z2: 13, h: 8 };

interface WalkKeys { f: boolean; b: boolean; l: boolean; r: boolean; }

export class FactoryScene {
  private container: HTMLElement;
  private cb: FactoryCallbacks;
  private renderer: THREE.WebGLRenderer;
  private readonly environmentTarget: THREE.WebGLRenderTarget;
  private disposed = false;
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
  private running = true;
  private speedMul = 1;
  private fps = 0;
  private fpsFrames = 0;
  private fpsMark = performance.now();
  private labelsOn = true;
  private selectedNode: string | null = null;
  private selectedPipe: string | null = null;
  private trace: TraceResult | null = null;
  private zoneFocus: ZoneId | null = null;
  private stepFocus: string | null = null;
  private nodePickables: THREE.Object3D[] = [];
  private pipePickables: THREE.Object3D[] = [];
  private jointPickables: THREE.Object3D[] = [];
  private raycaster = new THREE.Raycaster();
  private pointerDown = { x: 0, y: 0 };
  private pointerActive = false;
  private camTween: {
    t0: number; dur: number;
    fromPos: THREE.Vector3; toPos: THREE.Vector3;
    fromTarget: THREE.Vector3; toTarget: THREE.Vector3;
  } | null = null;
  private zoneLabels: { el: HTMLDivElement; pos: THREE.Vector3; zone: ZoneId; pad: THREE.Mesh; border: THREE.LineLoop }[] = [];
  private pipeLabels: { run: RunRuntime; el: HTMLButtonElement }[] = [];
  private instrumentLabels: { el: HTMLDivElement; pos: THREE.Vector3; pipe: string; cap: boolean }[] = [];
  private jointLabels: { el: HTMLButtonElement; pos: THREE.Vector3; joint: string; pipe: string }[] = [];
  private portMarkers: { el: HTMLButtonElement; pos: THREE.Vector3; uid: string; portId: string }[] = [];
  private nodeAnchors: { x: number; z: number; r: number }[] = [];
  private occl = new Map<string, boolean>();
  private occlStrikes = new Map<string, number>();
  private occlCursor = 0;
  private frameNo = 0;
  private userInteracted = false;
  private valveStates = new Map<string, ValveState>();
  private flows = new Map<string, PipeFlowState>();
  private deviceCommands = new Map<string, boolean>();
  private solvedFlow: ReturnType<typeof factoryFlow> | null = null;
  private coating = initialCoatingBatch();
  private runtimeIssues: string[] = [];
  private frontWall!: THREE.Group;
  private roof!: THREE.Group;
  private sharedProxyMat: THREE.MeshStandardMaterial;
  private appearanceCache = new Map<string, THREE.Group>();
  private gltfLoader = new GLTFLoader();
  private walkOn = false;
  private walkPos = new THREE.Vector3();
  private walkYaw = 0;
  private walkPitch = 0;
  private walkKeys: WalkKeys = { f: false, b: false, l: false, r: false };
  private walkPad = { x: 0, y: 0 };
  private walkSaved: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private fitSteel = steelMat(0x8b97a5, 0.4, 0.7);
  private fitCast = steelMat(0x64707e, 0.6, 0.4);
  private supportSteel = steelMat(0x59687a, 0.6, 0.45);
  private supportDark = steelMat(0x3a4552, 0.7, 0.3);

  constructor(container: HTMLElement, cb: FactoryCallbacks) {
    this.container = container;
    this.cb = cb;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(container.clientWidth || 800, container.clientHeight || 600);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.classList.add('factory-canvas');

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'factory-label-layer';
    container.appendChild(this.labelLayer);

    this.scene.background = new THREE.Color(0xd6e2ee);
    this.scene.fog = new THREE.Fog(0xd6e2ee, 58, 135);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environmentTarget = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environmentTarget.texture;
    room.dispose();
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.08, 320);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 2.6;
    this.controls.maxDistance = 95;
    this.controls.addEventListener('start', () => { this.camTween = null; this.userInteracted = true; });

    const hemi = new THREE.HemisphereLight(0xeef5fd, 0xb7c2cf, 0.9);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff4e2, 2.0);
    key.position.set(16, 30, 20);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -30; key.shadow.camera.right = 30;
    key.shadow.camera.top = 26; key.shadow.camera.bottom = -26;
    key.shadow.camera.far = 100;
    key.shadow.bias = -0.0006;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdbe8ff, 0.5);
    fill.position.set(-20, 14, -18);
    this.scene.add(fill);

    this.dotTexture = makeDotTexture();
    this.stripeTexture = makeStripeTexture();
    this.sharedProxyMat = new THREE.MeshStandardMaterial({ color: 0x9aabbd, roughness: 0.85, metalness: 0.08 });
    MeshoptDecoder.ready.catch(() => undefined);
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);

    this.buildSite();
    this.buildWalkways();
    this.buildPlatform();
    for (const def of FACTORY_NODES) {
      const node = this.buildNode(def);
      this.nodes.push(node);
      this.nodeByUid.set(def.uid, node);
      if (node.def.inline?.valve) this.valveStates.set(def.uid, 'open');
    }
    for (const def of FACTORY_PIPES) {
      const run = this.buildRun(def);
      if (!run) continue;
      this.runs.push(run);
      this.runById.set(def.id, run);
    }
    this.collectPorts();
    this.placeInlineNodes();
    this.buildJointMarkers();
    this.buildZonePads();
    this.buildInstrumentMeshes();
    this.recomputeFlows();
    this.applyAllAppearance();
    this.fitView(true);

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.loop();
  }

  /* ============================ 厂房外壳 ============================ */

  private buildSite() {
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(ROOM.x2 - ROOM.x1, 0.12, ROOM.z2 - ROOM.z1),
      new THREE.MeshStandardMaterial({ color: 0xc7d1dd, roughness: 0.95, metalness: 0.02 })
    );
    slab.position.set((ROOM.x1 + ROOM.x2) / 2, -0.06, (ROOM.z1 + ROOM.z2) / 2);
    slab.receiveShadow = true;
    this.scene.add(slab);

    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(78, 46),
      new THREE.MeshStandardMaterial({ color: 0xacb8c5, roughness: 0.98, metalness: 0.0 })
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.set((ROOM.x1 + ROOM.x2) / 2, -0.13, (ROOM.z1 + ROOM.z2) / 2);
    apron.receiveShadow = true;
    this.scene.add(apron);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0xe9eef4, roughness: 0.9, metalness: 0.02 });
    const skirtMat = new THREE.MeshStandardMaterial({ color: 0x93a3b5, roughness: 0.9, metalness: 0.04 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xd7ecfa, emissive: 0x8db9d6, emissiveIntensity: 0.3, roughness: 0.35, metalness: 0.1 });
    const colMat = steelMat(0x7e8fa2, 0.6, 0.35);

    const wallGeos: THREE.BufferGeometry[] = [];
    const skirtGeos: THREE.BufferGeometry[] = [];
    const glassGeos: THREE.BufferGeometry[] = [];
    const colGeos: THREE.BufferGeometry[] = [];

    /* 后墙与两侧墙（固定）；前墙单独成组可隐藏 */
    const addWall = (cx: number, cz: number, w: number, d: number) => {
      wallGeos.push(boxGeo(w, ROOM.h, d, cx, ROOM.h / 2, cz));
      skirtGeos.push(boxGeo(w + 0.02, 1.0, d + 0.02, cx, 0.5, cz));
    };
    addWall((ROOM.x1 + ROOM.x2) / 2, ROOM.z1 - 0.09, ROOM.x2 - ROOM.x1 + 0.36, 0.18);
    addWall(ROOM.x1 - 0.09, (ROOM.z1 + ROOM.z2) / 2, 0.18, ROOM.z2 - ROOM.z1);
    addWall(ROOM.x2 + 0.09, (ROOM.z1 + ROOM.z2) / 2, 0.18, ROOM.z2 - ROOM.z1);

    /* 高窗带 */
    const bandY = 5.6;
    glassGeos.push(boxGeo(ROOM.x2 - ROOM.x1 - 1.6, 1.5, 0.06, (ROOM.x1 + ROOM.x2) / 2, bandY, ROOM.z1 + 0.03));
    for (let x = ROOM.x1 + 1.2; x < ROOM.x2 - 0.8; x += 2.6) {
      colGeos.push(boxGeo(0.08, 1.6, 0.1, x, bandY, ROOM.z1 + 0.06));
    }
    for (const side of [ROOM.x1 + 0.03, ROOM.x2 - 0.03]) {
      glassGeos.push(boxGeo(0.06, 1.5, ROOM.z2 - ROOM.z1 - 1.6, side, bandY, (ROOM.z1 + ROOM.z2) / 2));
      for (let z = ROOM.z1 + 1.2; z < ROOM.z2 - 0.8; z += 2.6) {
        colGeos.push(boxGeo(0.1, 1.6, 0.08, side, bandY, z));
      }
    }

    /* 周边立柱 */
    for (let x = ROOM.x1; x <= ROOM.x2 + 0.01; x += (ROOM.x2 - ROOM.x1) / 6) {
      colGeos.push(boxGeo(0.26, ROOM.h, 0.26, x, ROOM.h / 2, ROOM.z1 + 0.13));
      colGeos.push(boxGeo(0.26, ROOM.h, 0.26, x, ROOM.h / 2, ROOM.z2 - 0.13));
    }
    for (const z of [ROOM.z1 + 2.4, (ROOM.z1 + ROOM.z2) / 2, ROOM.z2 - 2.4]) {
      colGeos.push(boxGeo(0.26, ROOM.h, 0.26, ROOM.x1 + 0.13, ROOM.h / 2, z));
      colGeos.push(boxGeo(0.26, ROOM.h, 0.26, ROOM.x2 - 0.13, ROOM.h / 2, z));
    }

    this.scene.add(mergedMesh(wallGeos, wallMat, true));
    this.scene.add(mergedMesh(skirtGeos, skirtMat, false));
    this.scene.add(mergedMesh(glassGeos, glassMat, false));
    this.scene.add(mergedMesh(colGeos, colMat, false));

    /* 前墙（默认隐藏） */
    this.frontWall = new THREE.Group();
    const fw: THREE.BufferGeometry[] = [];
    const fw2: THREE.BufferGeometry[] = [];
    const fwWindow: THREE.BufferGeometry[] = [];
    fw.push(boxGeo(ROOM.x2 - ROOM.x1 + 0.36, ROOM.h, 0.18, (ROOM.x1 + ROOM.x2) / 2, ROOM.h / 2, ROOM.z2 + 0.09));
    fw2.push(boxGeo(ROOM.x2 - ROOM.x1 + 0.38, 1.0, 0.2, (ROOM.x1 + ROOM.x2) / 2, 0.5, ROOM.z2 + 0.09));
    fwWindow.push(boxGeo(ROOM.x2 - ROOM.x1 - 1.6, 1.5, 0.06, (ROOM.x1 + ROOM.x2) / 2, bandY, ROOM.z2 - 0.03));
    this.frontWall.add(mergedMesh(fw, wallMat, true));
    this.frontWall.add(mergedMesh(fw2, skirtMat, false));
    this.frontWall.add(mergedMesh(fwWindow, glassMat, false));
    this.frontWall.visible = false;
    this.scene.add(this.frontWall);

    /* 屋顶与桁架（默认隐藏） */
    this.roof = new THREE.Group();
    const trussGeos: THREE.BufferGeometry[] = [];
    for (let x = ROOM.x1 + 1; x < ROOM.x2; x += 4.4) {
      trussGeos.push(boxGeo(0.14, 0.14, ROOM.z2 - ROOM.z1 - 0.5, x, ROOM.h - 0.5, (ROOM.z1 + ROOM.z2) / 2));
      trussGeos.push(boxGeo(0.1, 0.1, ROOM.z2 - ROOM.z1 - 0.5, x, ROOM.h - 1.25, (ROOM.z1 + ROOM.z2) / 2));
      for (let z = ROOM.z1 + 1; z < ROOM.z2; z += 2.2) {
        trussGeos.push(boxGeo(0.07, 0.75, 0.07, x, ROOM.h - 0.88, z));
      }
    }
    for (let z = ROOM.z1 + 1.4; z < ROOM.z2; z += 2.4) {
      trussGeos.push(boxGeo(ROOM.x2 - ROOM.x1 - 0.4, 0.08, 0.08, (ROOM.x1 + ROOM.x2) / 2, ROOM.h - 0.22, z));
    }
    this.roof.add(mergedMesh(trussGeos, colMat, false));
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(ROOM.x2 - ROOM.x1 + 0.4, 0.06, ROOM.z2 - ROOM.z1 + 0.4),
      new THREE.MeshStandardMaterial({ color: 0xdfe8f1, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide })
    );
    panel.position.set((ROOM.x1 + ROOM.x2) / 2, ROOM.h + 0.05, (ROOM.z1 + ROOM.z2) / 2);
    panel.receiveShadow = false;
    this.roof.add(panel);
    this.roof.visible = false;
    this.scene.add(this.roof);
  }

  private buildWalkways() {
    const walkMat = new THREE.MeshStandardMaterial({ color: 0xb6c2d0, roughness: 0.92, metalness: 0.02 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: ARROW_COLOR, roughness: 0.6, metalness: 0.05 });
    const walkGeos: THREE.BufferGeometry[] = [];
    const stripeGeos: THREE.BufferGeometry[] = [];
    const segment = (cx: number, cz: number, w: number, d: number) => {
      walkGeos.push(boxGeo(w, 0.06, d, cx, 0.03, cz));
      if (w >= d) {
        stripeGeos.push(boxGeo(w, 0.012, 0.08, cx, 0.066, cz - d / 2 + 0.05));
        stripeGeos.push(boxGeo(w, 0.012, 0.08, cx, 0.066, cz + d / 2 - 0.05));
      } else {
        stripeGeos.push(boxGeo(0.08, 0.012, d, cx - w / 2 + 0.05, 0.066, cz));
        stripeGeos.push(boxGeo(0.08, 0.012, d, cx + w / 2 - 0.05, 0.066, cz));
      }
    };
    segment(3.2, 2.5, 42.4, 1.2);
    segment(4, -6.8, 24, 1.2);
    segment(-8, -2.15, 1.2, 10.5);
    segment(24.6, -2.15, 1.2, 10.5);
    segment(12, 0.75, 1.2, 2.3);
    segment(17, 0.75, 1.2, 2.3);
    segment(14.5, -5.6, 1.2, 1.2);
    segment(-2.7, -5.5, 2.2, 1.2);
    this.scene.add(mergedMesh(walkGeos, walkMat, false));
    this.scene.add(mergedMesh(stripeGeos, stripeMat, false));
  }

  private buildPlatform() {
    const yellow = new THREE.MeshStandardMaterial({ color: ARROW_COLOR, roughness: 0.6, metalness: 0.05 });
    const steel = steelMat(0x7c8b9c, 0.55, 0.4);
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x9fb0c1, roughness: 0.8, metalness: 0.15 });

    const deckGeos: THREE.BufferGeometry[] = [];
    const railGeos: THREE.BufferGeometry[] = [];
    const stepGeos: THREE.BufferGeometry[] = [];

    /* 平台 z[-4.85,-6.15] x[-6.8,-3.8]，高 2.3 */
    deckGeos.push(boxGeo(platform.width, 0.1, platform.depth, platform.x, platform.centerY, platform.z));
    for (const x of [-6.7, -3.9]) {
      deckGeos.push(boxGeo(0.09, 2.25, 0.09, x, 1.125, -4.95));
      deckGeos.push(boxGeo(0.09, 2.25, 0.09, x, 1.125, -6.05));
    }
    deckGeos.push(boxGeo(0.09, 2.25, 0.09, -6.75, 1.125, -5.5));
    deckGeos.push(boxGeo(0.09, 2.25, 0.09, -3.85, 1.125, -5.5));
    /* 栏杆：北侧与西侧 */
    const railRun = (x1: number, z1: number, x2: number, z2: number) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.05) return;
      const q = new THREE.Quaternion().setFromUnitVectors(GEN_X, new THREE.Vector3(x2 - x1, 0, z2 - z1).normalize());
      for (const y of [2.85, 3.35]) {
        railGeos.push(boxGeo(len, 0.06, 0.06, (x1 + x2) / 2, y, (z1 + z2) / 2, q));
      }
      const posts = Math.max(2, Math.round(len / 0.9) + 1);
      for (let i = 0; i < posts; i++) {
        const t = i / (posts - 1);
        railGeos.push(boxGeo(0.05, 1.05, 0.05, x1 + (x2 - x1) * t, 2.82, z1 + (z2 - z1) * t));
      }
    };
    railRun(-6.75, -6.05, -3.85, -6.05);
    railRun(-6.75, -4.95, -6.75, -6.05);

    /* 楼梯：平台东侧向东下至地面 */
    for (let i = 1; i <= stairCount; i++) {
      const step = stepGeometry(i);
      stepGeos.push(boxGeo(tread, step.height, platform.depth, step.x, step.height / 2, platform.z));
    }
    const runLen = Math.hypot(2.4, 2.3);
    const slopeQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.atan2(-2.3, 2.4));
    for (const z of [-4.93, -6.07]) {
      stepGeos.push(boxGeo(runLen, 0.08, 0.08, -2.7, 1.12, z, slopeQ));
      railGeos.push(boxGeo(runLen, 0.055, 0.055, -2.7, 2.1, z, slopeQ));
      railGeos.push(boxGeo(0.05, 0.95, 0.05, -3.85, 2.75, z));
      railGeos.push(boxGeo(0.05, 0.95, 0.05, -1.6, 0.45, z));
    }

    this.scene.add(mergedMesh(deckGeos, steel, false));
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.9, platform.finishThickness, 1.2), deckMat);
    deck.position.set(platform.x, platform.finishY, platform.z);
    deck.receiveShadow = true;
    this.scene.add(deck);
    this.scene.add(mergedMesh(railGeos, steel, false));
    this.scene.add(mergedMesh(stepGeos, steel, false));

    /* 平台边缘警示条 */
    const edge = mergedMesh([
      boxGeo(3.0, 0.014, 0.09, -5.3, 2.39, -4.92),
      boxGeo(3.0, 0.014, 0.09, -5.3, 2.39, -6.08)
    ], yellow, false);
    this.scene.add(edge);
  }

  /* ============================ 设备 ============================ */

  private buildNode(def: FactoryNodeDef): NodeRuntime {
    const group = new THREE.Group();
    group.position.set(def.pos[0], 0, def.pos[1]);
    group.rotation.y = def.rotY ?? 0;
    group.userData.nodeUid = def.uid;

    const partGroups = new Map<string, THREE.Group>();
    const shellPartIds = new Set<string>();
    const device = catalogDeviceOfNode(def);
    if (device) {
      for (const p of device.parts) {
        const pg = buildPart(device.id, p.id, p.color);
        pg.position.set(p.pos[0], p.pos[1], p.pos[2]);
        if (p.rot) pg.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
        group.add(pg);
        partGroups.set(p.id, pg);
        if (p.shell) shellPartIds.add(p.id);
      }
    } else {
      group.add(this.buildProcedural(def.deviceId));
    }
    group.updateMatrixWorld(true);

    let size = new THREE.Vector3();
    let center = new THREE.Vector3();
    let box = new THREE.Box3();
    if (!def.inline) {
      box = new THREE.Box3().setFromObject(group);
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
      center.y = Math.max(0.9, center.y);

      if (device && TRANSPARENT_DEVICES.has(device.id)) {
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
        new THREE.MeshStandardMaterial({ color: 0xa9b6c4, roughness: 0.92, metalness: 0.03 })
      );
      pad.position.set(def.pos[0], 0.035, def.pos[1]);
      pad.receiveShadow = true;
      this.scene.add(pad);
    }

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
    if (device?.id === 'reactor') {
      const mat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.4, roughness: 0.25, metalness: 0.1, depthWrite: false });
      const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.78, 28), mat);
      liquid.position.set(0, 1.0, 0);
      liquid.name = 'factory-demo-liquid';
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
    if (def.anim === 'compressor') { addRotors(['maleRotor'], 'x', 9); addRotors(['femaleRotor'], 'x', -7.5); }
    if (def.anim === 'agitator') { addRotors(['shaft'], 'y', 2.4); addRotors(['paddles'], 'y', 2.4); }

    /* 选中环（落地设备） */
    const ringR = Math.max(size.x, size.z) / 2 * 0.82 + 0.22;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(ringR, ringR + 0.1, 48),
      new THREE.MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(def.pos[0], 0.02, def.pos[1]);
    ring.visible = false;
    this.scene.add(ring);

    /* 远景简化外形（保留拾取身份） */
    let proxy: THREE.Mesh | undefined;
    if (!def.inline) {
      const shape = PROXY_SHAPE[def.deviceId] ?? 'box';
      const geo = shape === 'cylinder'
        ? new THREE.CylinderGeometry(Math.max(0.2, Math.max(size.x, size.z) / 2 * 0.82), Math.max(0.2, Math.max(size.x, size.z) / 2 * 0.82), Math.max(0.4, size.y * 0.92), 14)
        : new THREE.BoxGeometry(Math.max(0.3, size.x * 0.85), Math.max(0.3, size.y * 0.85), Math.max(0.3, size.z * 0.85));
      proxy = new THREE.Mesh(geo, this.sharedProxyMat);
      proxy.position.copy(center);
      proxy.castShadow = true;
      proxy.receiveShadow = true;
      proxy.userData.nodeUid = def.uid;
      proxy.userData.proxy = true;
      proxy.visible = false;
      this.scene.add(proxy);
      this.nodePickables.push(proxy);
    }

    /* 名称标签 */
    const stroke = def.deviceId === 'diaphragm-pump' ? ['link', 'diaphragmL', 'diaphragmR'].flatMap(id => {
      const obj = partGroups.get(id);
      return obj ? [{ obj, origin: obj.position.x }] : [];
    }) : [];

    const label = document.createElement('button');
    label.type = 'button';
    label.className = `factory-label${def.inline ? ' minor' : ''}`;
    label.title = `${def.tag} ${def.label}`;
    const tagEl = document.createElement('span');
    tagEl.className = 'factory-label-tag';
    tagEl.textContent = def.tag;
    label.appendChild(tagEl);
    if (!def.inline) {
      const nameEl = document.createElement('span');
      nameEl.className = 'factory-label-name';
      nameEl.textContent = def.label;
      label.appendChild(nameEl);
    }
    if (FACTORY_EQUIPMENT_CONTROLS[def.uid]) {
      const status = document.createElement('span');
      status.className = 'factory-equipment-state factory-label-state';
      label.appendChild(status);
    }
    if (def.inline?.valve) {
      const st = document.createElement('span');
      st.className = 'factory-label-state is-open';
      st.textContent = 'OPEN';
      label.appendChild(st);
    }
    label.addEventListener('click', (e) => {
      e.stopPropagation();
      this.select(def.uid);
    });
    this.labelLayer.appendChild(label);

    const node: NodeRuntime = {
      def, group, size, center, box, label, ring, rotors, stroke, liquids,
      liquidPhase: Math.random() * Math.PI * 2,
      meshes, shellPartIds, dimmed: false, active: true, proxy
    };
    return node;
  }

  /** 场景内教学模型（灌装机 / 成品暂存区 / 清洗液收集桶） */
  private buildProcedural(deviceId: string): THREE.Group {
    const g = new THREE.Group();
    const steel = steelMat(0x7f93aa, 0.55, 0.4);
    const dark = steelMat(0x54606e, 0.7, 0.25);
    const steelGeos: THREE.BufferGeometry[] = [];
    const darkGeos: THREE.BufferGeometry[] = [];
    const accent = new THREE.MeshStandardMaterial({ color: ARROW_COLOR, roughness: 0.65, metalness: 0.05 });

    if (deviceId === 'filler') {
      steelGeos.push(boxGeo(3.2, 0.1, 0.55, 0, 0.72, 0));
      for (const x of [-1.5, 1.5]) for (const z of [-0.22, 0.22]) {
        steelGeos.push(boxGeo(0.07, 0.67, 0.07, x, 0.335, z));
      }
      for (let x = -1.4; x <= 1.41; x += 0.28) {
        const roll = new THREE.CylinderGeometry(0.05, 0.05, 0.5, 10);
        roll.rotateX(Math.PI / 2);
        roll.translate(x, 0.79, 0);
        darkGeos.push(roll);
      }
      for (const x of [-1.25, -0.75, -0.25, 0.85, 1.35]) {
        const bottle = new THREE.CylinderGeometry(0.085, 0.085, 0.28, 12);
        bottle.translate(x, 0.95, 0);
        g.add(new THREE.Mesh(bottle, new THREE.MeshStandardMaterial({ color: 0x9fc6e8, transparent: true, opacity: 0.75, roughness: 0.2, metalness: 0.05 })));
      }
      steelGeos.push(boxGeo(0.66, 0.5, 0.6, 0, 1.95, 0));
      for (const x of [-0.2, 0, 0.2]) {
        const nozzle = cylinderGeo(new THREE.Vector3(x, 1.7, 0), new THREE.Vector3(x, 1.52, 0), 0.035);
        if (nozzle) darkGeos.push(nozzle);
      }
      steelGeos.push(boxGeo(0.14, 2.3, 0.14, 0.55, 1.15, -0.42));
      steelGeos.push(boxGeo(0.5, 0.08, 0.5, 0.55, 0.04, -0.42));
      steelGeos.push(boxGeo(0.5, 0.06, 0.5, 0, 0.03, 0));
      const stripe = boxGeo(0.66, 0.08, 0.62, 0, 2.16, 0);
      g.add(new THREE.Mesh(stripe, accent));
    } else if (deviceId === 'storage-area') {
      for (const [px, pz] of [[-0.45, -0.6], [0.55, 0.55]] as const) {
        const pallet = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.9), steelMat(0xb08a5a, 0.85, 0.02));
        pallet.position.set(px, 0.06, pz);
        pallet.castShadow = true;
        g.add(pallet);
        for (const dx of [-0.4, 0, 0.4]) {
          const drum = new THREE.Mesh(
            new THREE.CylinderGeometry(0.16, 0.16, 0.46, 12),
            new THREE.MeshStandardMaterial({ color: 0x4d9f78, roughness: 0.5, metalness: 0.2 })
          );
          drum.position.set(px + dx, 0.35, pz);
          drum.castShadow = true;
          g.add(drum);
          const band = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.05, 12), surfaceBandMat());
          band.position.set(px + dx, 0.42, pz);
          g.add(band);
        }
      }
      const border = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-1.2, 0.02, -1.2), new THREE.Vector3(1.2, 0.02, -1.2),
          new THREE.Vector3(1.2, 0.02, 1.2), new THREE.Vector3(-1.2, 0.02, 1.2)
        ]),
        new THREE.LineBasicMaterial({ color: ARROW_COLOR, transparent: true, opacity: 0.7 })
      );
      g.add(border);
      const floorPad = new THREE.Mesh(
        new THREE.PlaneGeometry(2.4, 2.4),
        new THREE.MeshBasicMaterial({ color: ARROW_COLOR, transparent: true, opacity: 0.06, depthWrite: false })
      );
      floorPad.rotation.x = -Math.PI / 2;
      floorPad.position.y = 0.012;
      g.add(floorPad);
    } else if (deviceId === 'clean-drum') {
      steelGeos.push(boxGeo(1.15, 0.1, 1.15, 0, 0.05, 0));
      steelGeos.push(boxGeo(1.2, 0.06, 0.08, 0, 0.1, -0.56));
      steelGeos.push(boxGeo(1.2, 0.06, 0.08, 0, 0.1, 0.56));
      steelGeos.push(boxGeo(0.08, 0.06, 1.2, -0.56, 0.1, 0));
      steelGeos.push(boxGeo(0.08, 0.06, 1.2, 0.56, 0.1, 0));
      const drum = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 0.92, 18),
        new THREE.MeshStandardMaterial({ color: 0x5b7f94, roughness: 0.45, metalness: 0.3 })
      );
      drum.position.y = 0.56;
      drum.castShadow = true;
      g.add(drum);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.04, 18), steelMat(0x46617e, 0.5, 0.4));
      lid.position.y = 1.04;
      g.add(lid);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.425, 0.425, 0.14, 18), new THREE.MeshStandardMaterial({ color: 0xe8c96a, roughness: 0.6, metalness: 0.05 }));
      band.position.y = 0.72;
      g.add(band);
    }

    if (steelGeos.length) g.add(mergedMesh(steelGeos, steel, true));
    if (darkGeos.length) g.add(mergedMesh(darkGeos, dark, false));
    return g;
  }

  /* ============================ 管线与接口 ============================ */

  private resolvePort(nodeUid: string, portId: string): { world: THREE.Vector3; dir: THREE.Vector3; node: FactoryNodeDef; port: PortDef; runtime: NodeRuntime } | null {
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

  private buildRun(def: FactoryPipelineDef): RunRuntime | null {
    try {
      let start: THREE.Vector3;
      let end: THREE.Vector3;
      let startPort: ReturnType<FactoryScene['resolvePort']> = null;
      let endPort: ReturnType<FactoryScene['resolvePort']> = null;
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
      const color = FACTORY_MEDIA[def.medium].color;
      const tubular = Math.max(20, Math.min(260, Math.round(length * 9)));

      const outerMat = new THREE.MeshStandardMaterial({ color, roughness: 0.52, metalness: 0.42, envMapIntensity: 0.7 });
      const outer = new THREE.Mesh(new THREE.TubeGeometry(curve, tubular, radius, 9, false), outerMat);
      outer.castShadow = true; outer.receiveShadow = true;
      outer.userData.pipeId = def.id;
      this.scene.add(outer);
      this.pipePickables.push(outer);

      const pulseTex = this.stripeTexture.clone();
      pulseTex.needsUpdate = true;
      pulseTex.wrapS = THREE.RepeatWrapping;
      pulseTex.wrapT = THREE.ClampToEdgeWrapping;
      pulseTex.repeat.set(Math.max(2, length / 1.1), 1);
      const coreMat = new THREE.MeshBasicMaterial({
        color, map: pulseTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.FrontSide
      });
      const core = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, Math.round(tubular / 2)), radius * 0.6, 6, false), coreMat);
      core.visible = false;
      core.renderOrder = 2;
      this.scene.add(core);

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
        size: def.size === 'utility' ? 0.075 : 0.105,
        map: this.dotTexture,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        sizeAttenuation: true
      });
      const points = new THREE.Points(geo, pointsMat);
      points.frustumCulled = false;
      this.scene.add(points);

      /* 统一流向箭头（琥珀色，全站一套） */
      const arrowMat = new THREE.MeshStandardMaterial({
        color: ARROW_COLOR, roughness: 0.45, metalness: 0.2,
        emissive: new THREE.Color(ARROW_COLOR), emissiveIntensity: 0.22,
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
        const g = arrowGeo.clone();
        g.applyMatrix4(new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)));
        arrowGeos.push(g);
      }
      const arrows = mergedMesh(arrowGeos, arrowMat, false);
      this.scene.add(arrows);

      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'factory-pipe-label';
      label.textContent = `${def.id} · ${FACTORY_MEDIA[def.medium].label}`;
      label.title = `${def.name}（${PIPE_SIZES[def.size].label}）`;
      label.addEventListener('click', (e) => { e.stopPropagation(); this.selectPipe(def.id); });
      this.labelLayer.appendChild(label);

      const run: RunRuntime = {
        def, curve, length, radius, outer, outerMat, core, pulseTex, points, offsets,
        baseSpeed: MEDIUM_SPEED[def.medium], progress: Math.random(),
        arrows, arrowMat, label,
        labelPos: curve.getPointAt(0.5).add(new THREE.Vector3(0, 0.4, 0)),
        dimmed: false
      };
      this.pipeLabels.push({ run, el: label });

      if (startPort) this.addPortFitting(startPort, start, curve.getTangentAt(0.0001));
      else this.addBlindCap(start, curve.getTangentAt(0.0001), radius, def.from.type === 'cap' ? def.from.label : '');
      if (endPort) this.addPortFitting(endPort, end, curve.getTangentAt(0.9999));
      else this.addBlindCap(end, curve.getTangentAt(0.9999), radius, def.to.type === 'cap' ? def.to.label : '');

      this.addSupports(run, def);

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

  private addPortFitting(link: NonNullable<ReturnType<FactoryScene['resolvePort']>>, junction: THREE.Vector3, pipeTangent: THREE.Vector3) {
    const r = PIPE_SIZES[link.port.size].radius;
    const fr = PIPE_SIZES[link.port.size].flange;
    const castGeos: THREE.BufferGeometry[] = [];
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
    this.addFlangeDisc(link.world.clone().addScaledVector(link.dir, 0.015), link.dir, fr, 4);
    this.addFlangeDisc(junction, pipeTangent, fr, 4);
    this.ports.push({
      nodeUid: link.node.uid,
      port: link.port,
      world: link.world.clone(),
      dir: link.dir.clone(),
      junction: junction.clone()
    });
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
      el.className = 'factory-cap-label';
      el.textContent = labelText;
      this.labelLayer.appendChild(el);
      this.instrumentLabels.push({ el, pos: center.clone().add(new THREE.Vector3(0, 0.3, 0)), pipe: '', cap: true });
    }
  }

  private addSupports(run: RunRuntime, def: FactoryPipelineDef) {
    const step = 3.4;
    const valveTs = inlineNodesOfPipe(def.id).map((n) => n.inline!.t)
      .concat(FACTORY_INSTRUMENTS.filter((i) => i.pipe === def.id).map((i) => i.t))
      .concat(FACTORY_JOINTS.filter((j) => j.pipe === def.id).map((j) => j.t));
    for (let s = 1.6; s < run.length - 1.4; s += step) {
      const t = s / run.length;
      if (valveTs.some((vt) => Math.abs(vt - t) < 0.07)) continue;
      const p = run.curve.getPointAt(t);
      const tangent = run.curve.getTangentAt(t).normalize();
      if (Math.abs(tangent.y) > 0.55) continue;
      if (p.y < 0.38 || p.y > 2.72) continue;
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
    this.scene.add(mergedMesh(geos, this.supportSteel, false));
    const clamp = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.35, 0.012, 6, 20), this.supportDark);
    clamp.position.copy(p);
    clamp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(side.z, 0, -side.x));
    this.scene.add(clamp);
  }

  private collectPorts() {
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
      node.box = box;
      node.inlinePoint = point.clone();
      node.ring.visible = false;

      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(1, 20, 14),
        new THREE.MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.14, depthWrite: false })
      );
      glow.scale.setScalar(Math.max(0.28, Math.max(node.size.x, node.size.y, node.size.z) * 0.62));
      glow.position.copy(node.center);
      glow.visible = false;
      this.scene.add(glow);
      node.glow = glow;

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

  private buildJointMarkers() {
    for (const joint of FACTORY_JOINTS) {
      const run = this.runById.get(joint.pipe);
      if (!run) continue;
      const t = Math.max(0.02, Math.min(0.98, joint.t));
      const point = run.curve.getPointAt(t);
      const tangent = run.curve.getTangentAt(t).normalize();
      const fr = PIPE_SIZES.main.flange;

      const geos: THREE.BufferGeometry[] = [];
      for (const sgn of [-1, 1]) {
        const c = point.clone().addScaledVector(tangent, 0.055 * sgn);
        geos.push(discGeo(c, tangent, fr));
        const n = tangent.clone();
        const side = new THREE.Vector3(-n.z, 0, n.x).normalize();
        if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
        const up2 = new THREE.Vector3().crossVectors(n, side).normalize();
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          const offset = side.clone().multiplyScalar(Math.cos(a) * fr * 0.72).addScaledVector(up2, Math.sin(a) * fr * 0.72);
          const g = cylinderGeo(c.clone().add(offset).addScaledVector(n, -0.04), c.clone().add(offset).addScaledVector(n, 0.04), 0.013, 6);
          if (g) geos.push(g);
        }
      }
      const mesh = mergedMesh(geos, this.fitSteel, false);
      mesh.userData.jointId = joint.id;
      this.scene.add(mesh);
      this.jointPickables.push(mesh);

      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(fr * 1.28, 0.014, 8, 28),
        new THREE.MeshBasicMaterial({ color: ARROW_COLOR, transparent: true, opacity: 0.85 })
      );
      halo.position.copy(point);
      halo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
      halo.userData.jointId = joint.id;
      this.scene.add(halo);
      this.jointPickables.push(halo);

      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'factory-joint-label';
      el.textContent = `${joint.id} 法兰接头 · 可练习`;
      el.title = joint.note;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cb.onJointPick?.(joint.id);
      });
      this.labelLayer.appendChild(el);
      this.jointLabels.push({ el, pos: point.clone().add(new THREE.Vector3(0, 0.42, 0)), joint: joint.id, pipe: joint.pipe });
    }
  }

  private buildZonePads() {
    for (const zone of FACTORY_ZONES) {
      for (const [x1, z1, x2, z2] of zone.zones) {
        const w = Math.abs(x2 - x1), d = Math.abs(z2 - z1);
        const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
        const pad = new THREE.Mesh(
          new THREE.PlaneGeometry(w, d),
          new THREE.MeshBasicMaterial({ color: zone.color, transparent: true, opacity: 0.08, depthWrite: false })
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
          new THREE.LineBasicMaterial({ color: zone.color, transparent: true, opacity: 0.5 })
        );
        this.scene.add(border);
        const el = document.createElement('div');
        el.className = 'factory-zone-label';
        el.textContent = `${zone.id} · ${zone.short}`;
        el.style.color = `#${zone.color.toString(16).padStart(6, '0')}`;
        this.labelLayer.appendChild(el);
        this.zoneLabels.push({ el, pos: new THREE.Vector3(cx, 0.03, cz), zone: zone.id, pad, border });
      }
    }
  }

  private buildInstrumentMeshes() {
    for (const inst of FACTORY_INSTRUMENTS) {
      const run = this.runById.get(inst.pipe);
      if (!run) continue;
      const t = Math.max(0.02, Math.min(0.98, inst.t));
      const p = run.curve.getPointAt(t);
      const tangent = run.curve.getTangentAt(t).normalize();
      const normal = this.surfaceNormal(tangent);
      const stemTop = p.clone().addScaledVector(normal, 0.24);
      const stem = cylinderGeo(p, stemTop, 0.018, 10);
      if (stem) this.scene.add(new THREE.Mesh(stem, this.fitSteel));
      const dial = new THREE.Mesh(
        new THREE.CylinderGeometry(0.085, 0.085, 0.035, 20),
        new THREE.MeshStandardMaterial({ color: 0xf2f5f8, roughness: 0.35, metalness: 0.1 })
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
      el.className = 'factory-instrument-label';
      el.textContent = `${inst.tag} ${inst.name}`;
      this.labelLayer.appendChild(el);
      this.instrumentLabels.push({ el, pos: dial.position.clone().add(new THREE.Vector3(0, 0.19, 0)), pipe: inst.pipe, cap: false });
    }
  }

  /* ============================ 选择与焦点 ============================ */

  private hitVisible(obj: THREE.Object3D): boolean {
    let o: THREE.Object3D | null = obj;
    while (o) {
      if (o.visible === false) return false;
      o = o.parent;
    }
    return true;
  }

  private onPointerDown = (e: PointerEvent) => {
    this.pointerDown.x = e.clientX;
    this.pointerDown.y = e.clientY;
    this.pointerActive = true;
    if (this.walkOn) {
      const el = this.renderer.domElement;
      try { el.setPointerCapture(e.pointerId); } catch { /* 无指针捕获时忽略 */ }
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.walkOn || !this.pointerActive) return;
    const dx = e.clientX - this.pointerDown.x;
    const dy = e.clientY - this.pointerDown.y;
    if (dx * dx + dy * dy < 4) return;
    this.pointerDown.x = e.clientX;
    this.pointerDown.y = e.clientY;
    this.walkYaw -= dx * 0.004;
    this.walkPitch = Math.max(-1.25, Math.min(1.25, this.walkPitch - dy * 0.0035));
  };

  private onPointerUp = (e: PointerEvent) => {
    this.pointerActive = false;
    const dx = e.clientX - this.pointerDown.x;
    const dy = e.clientY - this.pointerDown.y;
    if (dx * dx + dy * dy > 36) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.nodePickables, ...this.pipePickables, ...this.jointPickables], false)
      .filter((h) => this.hitVisible(h.object));
    for (const hit of hits) {
      const uid = hit.object.userData.nodeUid as string | undefined;
      if (uid) { this.select(uid); return; }
      const jid = hit.object.userData.jointId as string | undefined;
      if (jid) { this.cb.onJointPick?.(jid); return; }
      const pid = hit.object.userData.pipeId as string | undefined;
      if (pid) { this.selectPipe(pid); return; }
    }
    this.clearSelection();
  };

  select(uid: string | null) {
    this.selectedNode = uid;
    this.selectedPipe = null;
    this.applySelectionVisual();
    this.rebuildPortMarkers();
    this.cb.onSelectNode(uid);
    this.cb.onSelectPipe(null);
  }

  selectPipe(pipeId: string | null) {
    this.selectedPipe = pipeId;
    this.selectedNode = null;
    this.applySelectionVisual();
    this.rebuildPortMarkers();
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

  setZoneFocus(zoneId: ZoneId | null) {
    this.zoneFocus = zoneId;
    this.applyFocusVisual();
  }

  private applySelectionVisual() {
    for (const n of this.nodes) {
      const selected = n.def.uid === this.selectedNode;
      n.ring.visible = selected && !n.def.inline;
      if (n.glow) n.glow.visible = selected && !!n.def.inline;
      n.label.classList.toggle('active', selected);
    }
    for (const run of this.runs) {
      const selected = run.def.id === this.selectedPipe;
      run.outerMat.emissive.setHex(selected ? SELECT_COLOR : 0x000000);
      run.outerMat.emissiveIntensity = selected ? 0.4 : 0;
      run.label.classList.toggle('active', selected);
    }
    this.applyFocusVisual();
  }

  private focusSets(): { nodes: Set<string>; pipes: Set<string> } | null {
    if (this.trace) return this.trace;
    if (this.stepFocus) {
      const step = FACTORY_STEPS.find((s) => s.id === this.stepFocus);
      if (!step) return null;
      const nodes = new Set<string>(step.nodes);
      const pipes = new Set<string>(step.pipes);
      for (const pid of step.pipes) for (const n of inlineNodesOfPipe(pid)) nodes.add(n.uid);
      return { nodes, pipes };
    }
    if (this.zoneFocus) {
      const zone = getZone(this.zoneFocus);
      const nodes = new Set<string>(zone.devices);
      const pipes = new Set<string>();
      for (const uid of zone.devices) {
        for (const p of this.pipesOfNode(uid)) {
          pipes.add(p.id);
          for (const n of inlineNodesOfPipe(p.id)) nodes.add(n.uid);
        }
      }
      return { nodes, pipes };
    }
    return null;
  }

  private pipesOfNode(uid: string): FactoryPipelineDef[] {
    const node = getNodeByUid(uid);
    if (node?.inline) {
      const host = this.runById.get(node.inline.pipe);
      return host ? [host.def] : [];
    }
    return FACTORY_PIPES.filter((p) =>
      (p.from.type === 'port' && p.from.node === uid) || (p.to.type === 'port' && p.to.node === uid)
    );
  }

  private applyFocusVisual() {
    const focus = this.focusSets();
    for (const n of this.nodes) {
      const dim = !!focus && !focus.nodes.has(n.def.uid);
      if (n.dimmed !== dim) { n.dimmed = dim; this.refreshNodeMaterials(n); }
      n.label.classList.toggle('dimmed', dim);
    }
    for (const run of this.runs) {
      run.dimmed = !!focus && !focus.pipes.has(run.def.id);
    }
    for (const z of this.zoneLabels) {
      const active = this.zoneFocus === z.zone;
      z.el.classList.toggle('active', active);
      (z.pad.material as THREE.MeshBasicMaterial).opacity = active ? 0.16 : 0.08;
      (z.border.material as THREE.LineBasicMaterial).opacity = active ? 0.9 : 0.5;
    }
    this.applyPipeVisuals();
  }

  private applyAllAppearance() {
    for (const n of this.nodes) this.refreshNodeMaterials(n);
    this.applyFocusVisual();
  }

  private refreshNodeMaterials(node: NodeRuntime) {
    const device = catalogDeviceOfNode(node.def);
    const transparentDevice = device ? TRANSPARENT_DEVICES.has(device.id) : false;
    for (const mesh of node.meshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat) continue;
      if (!mat.userData.factoryBase) {
        const base: MeshBase = {
          opacity: mat.opacity,
          transparent: mat.transparent,
          depthWrite: mat.depthWrite
        };
        mat.userData.factoryBase = base;
      }
      const base = mat.userData.factoryBase as MeshBase;
      const partShell = node.shellPartIds.has(mesh.userData.partId as string);
      let opacity = base.opacity;
      let transparent = base.transparent;
      let depthWrite = base.depthWrite;
      if (partShell && transparentDevice) {
        transparent = true;
        opacity = Math.min(opacity, 0.3);
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
      const state = this.valveStates.get(node.def.uid) ?? 'open';
      const color = state === 'open' ? 0x34d399 : state === 'partial' ? 0xfbbf24 : 0xf87171;
      (node.stateLight.material as THREE.MeshBasicMaterial).color.setHex(color);
    }
  }

  private applyPipeVisuals() {
    for (const run of this.runs) {
      const dim = run.dimmed;
      const flow = this.flows.get(run.def.id);
      run.outerMat.transparent = dim;
      run.outerMat.opacity = dim ? 0.12 : 1;
      run.outerMat.depthWrite = !dim;
      run.outerMat.needsUpdate = true;
      run.core.visible = false;
      run.points.visible = flow?.state !== 'off' && !dim;
      run.points.material.opacity = dim ? 0.12 : 0.95;
      run.arrowMat.opacity = dim ? 0.08 : 0.9;
      run.arrows.visible = !dim && flow?.state !== 'halt' && flow?.state !== 'off';
    }
  }

  /* ============================ 流动计算 ============================ */

  setValveState(uid: string, state: ValveState) {
    const node = getNodeByUid(uid);
    const kind = node?.inline?.valve;
    if (!kind || !VALVE_OPERATIONS[kind].commands.includes(state)) return;
    this.valveStates.set(uid, state);
    const runtime = this.nodeByUid.get(uid);
    if (runtime) {
      const label = runtime.label.querySelector('.factory-label-state');
      if (label) {
        label.className = `factory-label-state is-${state}`;
        label.textContent = VALVE_STATE_LABEL[state];
      }
      this.refreshNodeMaterials(runtime);
    }
    this.recomputeFlows();
    this.applyFlowVisuals();
    this.cb.onFlowsChanged?.();
  }

  getValveState(uid: string): ValveState {
    return this.valveStates.get(uid) ?? 'open';
  }

  getPipeFlow(pipeId: string): PipeFlowState | null {
    return this.flows.get(pipeId) ?? null;
  }

  setEquipmentCommand(uid: string, enabled: boolean) {
    if (!FACTORY_EQUIPMENT_CONTROLS[uid]) return;
    this.deviceCommands.set(uid, enabled);
    this.recomputeFlows();
    this.applyFlowVisuals();
    this.cb.onFlowsChanged?.();
  }

  getEquipmentStatus(uid: string): EquipmentStatus | null {
    const control = FACTORY_EQUIPMENT_CONTROLS[uid];
    if (!control) return null;
    const enabled = this.deviceCommands.get(uid) ?? true;
    if (['P-201', 'P-202', 'P-203'].includes(uid)) {
      const solved = this.solvedFlow;
      const pneumatic = control === 'air';
      const air = !pneumatic || !!solved?.inlet(uid, 'airIn');
      const hasMaterial = !!solved?.inlet(uid, 'suction');
      const hasOutlet = FACTORY_PIPES.some(pipe =>
        pipe.from.type === 'port' && pipe.from.node === uid && pipe.from.port === 'discharge'
        && solved?.flows.get(pipe.id)?.state === 'full');
      return pumpStatus(enabled, air, hasMaterial, hasOutlet, pneumatic);
    }
    return { enabled, active: enabled, description: enabled ? '运行中' : '已停止' };
  }

  get coatingBatch() { return { ...this.coating }; }

  operateCoatingBatch(action: CoatingAction): string {
    const result = actOnCoatingBatch(this.coating, action, {
      canTransfer: pipe => this.flows.get(pipe)?.state === 'full',
      disperserRunning: this.deviceCommands.get('R-201') ?? true,
      mixerRunning: this.deviceCommands.get('R-202') ?? true
    });
    if (this.coating !== result.state) {
      this.coating = result.state;
      this.recomputeFlows();
      this.applyFlowVisuals();
      this.cb.onFlowsChanged?.();
    }
    return result.message;
  }

  recomputeFlows() {
    const solved = factoryFlow(uid => this.valveStates.get(uid) ?? 'open', uid => this.deviceCommands.get(uid) ?? true, this.coating);
    this.solvedFlow = solved;
    this.flows = solved.flows;
    for (const node of this.nodes) {
      const control = this.getEquipmentStatus(node.def.uid);
      const host = node.def.inline && this.flows.get(node.def.inline.pipe);
      const source = node.def.uid === 'T-201' && this.coating.mode === 'production' && this.coating.raw > 0;
      node.active = control ? control.active : host ? host.state !== 'off' : source || solved.supplied.has(node.def.uid);
    }
  }

  private applyFlowVisuals() {
    for (const node of this.nodes) {
      const status = this.getEquipmentStatus(node.def.uid);
      const badge = node.label.querySelector('.factory-equipment-state');
      if (status && badge) {
        badge.textContent = status.active ? '运行' : status.enabled ? '待供给' : '停止';
        badge.setAttribute('title', status.description);
      }
      const starved = !node.active && !node.def.inline;
      node.label.classList.toggle('starved', starved);
    }
    this.applyPipeVisuals();
  }

  /* ============================ 相机与视图 ============================ */

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
    return toScreen(node.center);
  }

  focusNode(uid: string) {
    const node = this.nodeByUid.get(uid);
    if (!node) return;
    const dist = Math.max(5.4, Math.max(node.size.x, node.size.y, node.size.z) * 2.2);
    const dir = new THREE.Vector3(0.55, 0.48, 0.68).normalize();
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
    const step = FACTORY_STEPS.find((s) => s.id === stepId);
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

  focusZone(zoneId: ZoneId) {
    const zone = getZone(zoneId);
    const nodes = zone.devices.map((uid) => this.nodeByUid.get(uid)).filter((n): n is NodeRuntime => !!n);
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
    const target = new THREE.Vector3(2.2, 1.5, -2.6);
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hTan = Math.tan(vFov / 2) * Math.max(0.5, this.camera.aspect);
    const distW = Math.min(92, 21.2 / hTan);
    const distH = 10.5 / Math.tan(vFov / 2);
    const dist = Math.max(28, distW, distH);
    const dir = new THREE.Vector3(0.5, 0.5, 0.72).normalize();
    const pos = target.clone().addScaledVector(dir, dist);
    if (instant) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      this.camera.updateMatrixWorld(true);
      this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
      return;
    }
    this.tweenCamera(pos, target);
  }

  getViewState() {
    return {
      pos: this.camera.position.toArray() as [number, number, number],
      target: this.controls.target.toArray() as [number, number, number],
      selected: this.selectedNode,
      pipe: this.selectedPipe
    };
  }

  setViewState(state: { pos: [number, number, number]; target: [number, number, number]; selected?: string | null; pipe?: string | null }, instant = true) {
    this.camTween = null;
    this.userInteracted = true;
    this.camera.position.set(state.pos[0], state.pos[1], state.pos[2]);
    this.controls.target.set(state.target[0], state.target[1], state.target[2]);
    if (instant) {
      this.controls.update();
      this.camera.updateMatrixWorld(true);
    } else {
      this.tweenCamera(this.camera.position.clone(), this.controls.target.clone());
    }
    if (state.selected) this.select(state.selected);
    else if (state.pipe) this.selectPipe(state.pipe);
    else this.clearSelection();
  }

  get navigationState() {
    return {
      view: this.getViewState(),
      trace: this.trace,
      step: this.stepFocus,
      zone: this.zoneFocus,
      shell: this.shellState,
      labels: this.labelsOn,
      valves: [...this.valveStates],
      equipment: [...this.deviceCommands],
      coating: this.coatingBatch,
      running: this.running,
      speed: this.speedMul
    };
  }

  restoreNavigation(state: FactoryScene['navigationState']) {
    this.coating = { ...initialCoatingBatch(), ...state.coating };
    for (const [uid, value] of state.valves) this.setValveState(uid, value);
    for (const [uid, enabled] of state.equipment) this.setEquipmentCommand(uid, enabled);
    this.setSpeed(state.speed);
    this.setFrontWall(state.shell.front);
    this.setRoof(state.shell.roof);
    this.toggleLabels(state.labels);
    this.setTrace(state.trace);
    this.setStepFocus(state.step);
    this.setZoneFocus(state.zone);
    this.setViewState(state.view);
    this.running = state.running;
    this.recomputeFlows();
    this.applyFlowVisuals();
    this.cb.onFlowsChanged?.();
  }

  setFrontWall(on: boolean) {
    this.frontWall.visible = on;
  }

  setRoof(on: boolean) {
    this.roof.visible = on;
  }

  get shellState() {
    return { front: this.frontWall.visible, roof: this.roof.visible };
  }

  /* ============================ 行走模式 ============================ */

  get walkActive() { return this.walkOn; }

  enterWalk() {
    if (this.walkOn) return;
    this.walkSaved = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
    this.walkOn = true;
    this.controls.enabled = false;
    this.camTween = null;
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    this.walkYaw = Math.atan2(-dir.x, -dir.z);
    this.walkPitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    this.walkPos.copy(this.camera.position);
    const surface = walkSurface(this.walkPos.x, this.walkPos.z);
    if (surface === null) this.goToStairApproach();
    else this.walkPos.y = EYE_HEIGHT + surface;
    this.walkKeys = { f: false, b: false, l: false, r: false };
    this.walkPad = { x: 0, y: 0 };
    this.cb.onWalkChange?.(true);
  }

  goToStairApproach() {
    if (!this.walkOn) return;
    this.walkPos.set(stairApproach.x, EYE_HEIGHT, stairApproach.z);
    this.walkYaw = Math.PI / 2;
    this.walkPitch = 0;
  }

  exitWalk() {
    if (!this.walkOn) return;
    this.walkOn = false;
    if (this.walkSaved) {
      this.camera.position.copy(this.walkSaved.pos);
      this.controls.target.copy(this.walkSaved.target);
    }
    this.controls.enabled = true;
    this.controls.update();
    this.walkSaved = null;
    this.cb.onWalkChange?.(false);
  }

  setWalkPad(x: number, y: number) {
    this.walkPad.x = Math.max(-1, Math.min(1, x));
    this.walkPad.y = Math.max(-1, Math.min(1, y));
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.walkOn) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (e.key === 'Escape') { this.exitWalk(); return; }
    const k = e.key.toLowerCase();
    if (k === 'w' || e.key === 'ArrowUp') { this.walkKeys.f = true; e.preventDefault(); }
    if (k === 's' || e.key === 'ArrowDown') { this.walkKeys.b = true; e.preventDefault(); }
    if (k === 'a' || e.key === 'ArrowLeft') { this.walkKeys.l = true; e.preventDefault(); }
    if (k === 'd' || e.key === 'ArrowRight') { this.walkKeys.r = true; e.preventDefault(); }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (!this.walkOn) return;
    const k = e.key.toLowerCase();
    if (k === 'w' || e.key === 'ArrowUp') this.walkKeys.f = false;
    if (k === 's' || e.key === 'ArrowDown') this.walkKeys.b = false;
    if (k === 'a' || e.key === 'ArrowLeft') this.walkKeys.l = false;
    if (k === 'd' || e.key === 'ArrowRight') this.walkKeys.r = false;
  };

  private applyWalk(dt: number) {
    let ix = this.walkPad.x + (this.walkKeys.r ? 1 : 0) - (this.walkKeys.l ? 1 : 0);
    let iy = this.walkPad.y + (this.walkKeys.f ? 1 : 0) - (this.walkKeys.b ? 1 : 0);
    const len = Math.hypot(ix, iy);
    if (len < 0.05) {
      this.camera.position.copy(this.walkPos);
      this.camera.rotation.set(this.walkPitch, this.walkYaw, 0, 'YXZ');
      return;
    }
    if (len > 1) { ix /= len; iy /= len; }
    const sin = Math.sin(this.walkYaw), cos = Math.cos(this.walkYaw);
    const dx = (cos * ix - sin * iy) * WALK_SPEED * dt;
    const dz = (-sin * ix - cos * iy) * WALK_SPEED * dt;
    let x = Math.max(BOUNDS.x1, Math.min(BOUNDS.x2, this.walkPos.x + dx));
    let z = Math.max(BOUNDS.z1, Math.min(BOUNDS.z2, this.walkPos.z + dz));
    for (const a of this.nodeAnchors) {
      const ox = x - a.x, oz = z - a.z;
      const d2 = ox * ox + oz * oz;
      const min = a.r + walkerRadius;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        x = a.x + (ox / d) * min;
        z = a.z + (oz / d) * min;
      }
    }
    // Slide along a blocked edge. Each move is shorter than a tread (dt <= 0.05).
    if (walkSurface(x, this.walkPos.z) !== null) this.walkPos.x = x;
    const surface = walkSurface(this.walkPos.x, z);
    if (surface !== null) this.walkPos.z = z;
    this.walkPos.y = EYE_HEIGHT + (surface ?? walkSurface(this.walkPos.x, this.walkPos.z) ?? 0);
    this.camera.position.copy(this.walkPos);
    this.camera.rotation.set(this.walkPitch, this.walkYaw, 0, 'YXZ');
  }

  /* ============================ 外观参照 ============================ */

  async setAppearance(uid: string, on: boolean, url: string): Promise<boolean> {
    const node = this.nodeByUid.get(uid);
    if (!node || node.def.inline) return false;
    if (!on) {
      if (node.appearance) {
        this.scene.remove(node.appearance.wrapper);
        node.appearance = undefined;
      }
      node.group.visible = true;
      if (node.proxy) node.proxy.visible = false;
      return true;
    }
    if (node.appearance && node.appearance.url === url) return true;
    this.cb.onStatus?.('正在加载外观参照…');
    try {
      let src = this.appearanceCache.get(url);
      if (!src) {
        const gltf = await this.gltfLoader.loadAsync(url);
        if (this.disposed) {
          disposeFactoryResources([gltf.scene]);
          return false;
        }
        src = gltf.scene;
        this.appearanceCache.set(url, src);
      }
      const clone = src.clone(true);
      const wrapper = new THREE.Group();
      wrapper.add(clone);
      clone.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(clone);
      const size = box.getSize(new THREE.Vector3());
      const targets = this.nodeTargets(node);
      const maxSrc = Math.max(size.x, size.y, size.z, 0.001);
      const scale = targets.maxDim / maxSrc;
      clone.scale.setScalar(scale);
      clone.updateMatrixWorld(true);
      box.setFromObject(clone);
      const center = box.getCenter(new THREE.Vector3());
      clone.position.x += targets.center.x - center.x;
      clone.position.y += targets.boxMinY - box.min.y;
      clone.position.z += targets.center.z - center.z;
      clone.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.nodeUid = uid;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat && 'envMapIntensity' in mat) mat.envMapIntensity = 0.55;
        this.nodePickables.push(mesh);
      });
      if (node.appearance) this.scene.remove(node.appearance.wrapper);
      node.group.visible = false;
      if (node.proxy) node.proxy.visible = false;
      this.scene.add(wrapper);
      node.appearance = { wrapper, url };
      this.cb.onStatus?.('');
      return true;
    } catch (err) {
      console.error(err);
      this.cb.onStatus?.('外观参照加载失败，已保留教学结构。');
      node.group.visible = true;
      return false;
    }
  }

  private nodeTargets(node: NodeRuntime) {
    return {
      center: node.center,
      boxMinY: node.box.min.y,
      maxDim: Math.max(node.size.x, node.size.y, node.size.z)
    };
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
  }

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
    if (this.walkOn) {
      this.applyWalk(dt);
    } else {
      if (this.camTween) {
        const t = Math.min(1, (performance.now() - this.camTween.t0) / this.camTween.dur);
        const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        this.camera.position.lerpVectors(this.camTween.fromPos, this.camTween.toPos, k);
        this.controls.target.lerpVectors(this.camTween.fromTarget, this.camTween.toTarget, k);
        if (t >= 1) this.camTween = null;
      }
      this.controls.update();
    }
    this.updateLod();
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

  private updateLod() {
    const camPos = this.camera.position;
    for (const n of this.nodes) {
      if (n.def.inline) continue;
      if (n.appearance) {
        n.group.visible = false;
        if (n.proxy) n.proxy.visible = false;
        continue;
      }
      const dist = camPos.distanceTo(n.center);
      const proxy = dist > LOD_DIST && n.def.uid !== this.selectedNode;
      n.group.visible = !proxy;
      if (n.proxy) n.proxy.visible = proxy;
    }
  }

  private animate(dt: number) {
    const t = this.elapsed;
    for (const n of this.nodes) {
      if (!n.active) continue;
      for (const r of n.rotors) r.obj.rotation[r.axis] += r.speed * dt;
      for (const part of n.stroke) part.obj.position.x = part.origin + 0.035 * Math.sin(t * 5);
      for (const mesh of n.liquids) {
        const baseH = (mesh.userData.baseH as number | undefined) ?? 0.78;
        const bottomY = (mesh.userData.bottomY as number | undefined) ?? (mesh.position.y - baseH / 2);
        const lvl = 0.32 + 0.4 * (0.5 + 0.5 * Math.sin(t * 0.35 + n.liquidPhase));
        const h = baseH * lvl;
        mesh.scale.y = h / baseH;
        mesh.position.y = bottomY + h / 2;
      }
    }
    for (const run of this.runs) {
      const flow = this.flows.get(run.def.id);
      if (!flow || flow.state === 'off') continue;
      const factor = flow.throttle ? 0.45 : 1;
      run.progress = (run.progress + (run.baseSpeed / Math.max(0.6, run.length)) * dt * factor) % 1;
      const attr = run.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const p = new THREE.Vector3();
      for (let i = 0; i < run.offsets.length; i++) {
        let u = (run.offsets[i] + run.progress) % 1;
        if (flow.state === 'halt') u = u % Math.max(0.02, flow.haltT - 0.01);
        run.curve.getPointAt(u, p);
        const tangent = run.curve.getTangentAt(u).normalize();
        p.add(this.surfaceNormal(tangent).multiplyScalar(run.radius + 0.03));
        attr.setXYZ(i, p.x, p.y, p.z);
      }
      attr.needsUpdate = true;
      run.pulseTex.offset.x -= dt * run.baseSpeed * 0.55 * factor;
      run.arrowMat.opacity = 0.62 + 0.28 * (0.5 + 0.5 * Math.sin(t * 3.1));
    }
  }

  /* ============================ 标签与热区 ============================ */

  private rebuildPortMarkers() {
    for (const m of this.portMarkers) m.el.remove();
    this.portMarkers = [];
    const uid = this.selectedNode;
    if (!uid) return;
    const node = this.nodeByUid.get(uid);
    if (!node || node.def.inline) return;
    for (const port of node.def.ports) {
      const link = this.resolvePort(uid, port.id);
      if (!link) continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `factory-port-dot${port.added ? ' is-added' : ''}`;
      el.title = `${port.name}（${port.role === 'in' ? '入口' : port.role === 'out' ? '出口' : '连接口'}，${PIPE_SIZES[port.size].label}）`;
      const dot = document.createElement('span');
      dot.className = 'dot';
      const txt = document.createElement('span');
      txt.className = 'txt';
      txt.textContent = port.name;
      el.appendChild(dot);
      el.appendChild(txt);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cb.onPortPick?.(uid, port.id);
      });
      this.labelLayer.appendChild(el);
      this.portMarkers.push({ el, pos: link.world.clone().addScaledVector(link.dir, 0.12), uid, portId: port.id });
    }
  }

  flashPort(uid: string, portId: string, state: 'ok' | 'wrong') {
    const m = this.portMarkers.find((p) => p.uid === uid && p.portId === portId);
    if (!m) return;
    m.el.classList.add(state === 'ok' ? 'is-picked' : 'is-wrong');
    window.setTimeout(() => m.el.classList.remove('is-picked', 'is-wrong'), 1600);
  }

  private updateLabels() {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;
    const v = new THREE.Vector3();
    interface Cand { el: HTMLElement; x: number; y: number; w: number; h: number; priority: number; offsets: readonly number[] }
    const cands: Cand[] = [];
    const shortOffsets = [0, -28, 28];
    const expandedOffsets = [0, -28, 28, -56, 56, -84, 84, -112, 112, -140, 140];
    const horizontalOffsets = [0, -48, 48, -96, 96, -144, 144];
    const hide = (el: HTMLElement) => { el.style.visibility = 'hidden'; };
    const push = (el: HTMLElement, pos: THREE.Vector3, priority: number, offsets = shortOffsets, centered = false) => {
      v.copy(pos).project(this.camera);
      if (!(v.z < 1 && v.z > -1 && Math.abs(v.x) <= 1.1 && Math.abs(v.y) <= 1.1)) { hide(el); return; }
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      cands.push({ el, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h + (centered ? height / 2 : 0),
        w: width, h: height, priority, offsets });
    };

    const camTarget = this.walkOn ? this.camera.position : this.controls.target;
    const dist = this.camera.position.distanceTo(camTarget);
    const near = dist < NEAR_DIST;
    this.labelLayer.dataset.tier = near ? 'near' : 'far';

    /* 标签遮挡剔除：分批射线检测，设备挡住位号时隐藏该标签（选中标签始终保留） */
    if (near && this.labelsOn) {
      this.frameNo += 1;
      if (this.frameNo % 2 === 0) {
        const testable = this.nodes.filter((n) => !n.def.inline && n.def.uid !== this.selectedNode);
        const count = Math.min(4, testable.length);
        for (let k = 0; k < count; k++) {
          const n = testable[this.occlCursor++ % testable.length];
          const target = n.center.clone();
          target.y += Math.min(0.4, n.size.y * 0.2);
          const delta = target.clone().sub(this.camera.position);
          const len = delta.length();
          if (len < 0.2) continue;
          this.raycaster.set(this.camera.position.clone(), delta.normalize());
          this.raycaster.far = len - 0.2;
          const hits = this.raycaster.intersectObjects(this.nodePickables, false).filter((h) => this.hitVisible(h.object));
          this.raycaster.far = Infinity;
          const blocked = hits.length > 0 && hits[0].object.userData.nodeUid !== n.def.uid;
          const strikes = this.occlStrikes.get(n.def.uid) ?? 0;
          if (blocked) {
            this.occlStrikes.set(n.def.uid, strikes + 1);
            if (strikes + 1 >= 2) this.occl.set(n.def.uid, true);
          } else {
            this.occlStrikes.set(n.def.uid, 0);
            this.occl.set(n.def.uid, false);
          }
        }
      }
    }

    if (!this.labelsOn) return;
    for (const n of this.nodes) {
      const selected = n.def.uid === this.selectedNode;
      const inline = !!n.def.inline;
      if (!selected && (!near || this.occl.get(n.def.uid))) { hide(n.label); continue; }
      const anchor = n.center.clone();
      anchor.y += n.size.y / 2 + 0.2 + (n.def.labelLift ?? 0);
      push(n.label, anchor, selected ? 0 : inline ? 2 : n.dimmed ? 4 : 3, inline ? expandedOffsets : shortOffsets);
    }
    for (const marker of this.portMarkers) push(marker.el, marker.pos, 1, expandedOffsets, true);
    for (const p of this.pipeLabels) {
      const selected = this.selectedPipe === p.run.def.id;
      const show = selected || (near && this.camera.position.distanceTo(p.run.labelPos) < 16);
      if (show) push(p.el, p.run.labelPos, selected ? 0 : 6); else hide(p.el);
    }
    for (const ins of this.instrumentLabels) {
      if (near || (!!ins.pipe && this.selectedPipe === ins.pipe)) push(ins.el, ins.pos, 5); else hide(ins.el);
    }
    for (const joint of this.jointLabels) {
      if (near || this.selectedPipe === joint.pipe) push(joint.el, joint.pos, 3, expandedOffsets); else hide(joint.el);
    }
    for (const zone of this.zoneLabels) push(zone.el, zone.pos, 7, shortOffsets, true);

    cands.sort((a, b) => a.priority - b.priority || a.y - b.y);
    const stage = this.container.getBoundingClientRect();
    const placed = [...this.container.querySelectorAll<HTMLElement>(
      '.factory-info, .factory-task, .factory-diagram-float, .factory-titlebox, .factory-top-actions, .factory-left'
    )].filter(el => el.offsetWidth && el.offsetHeight && getComputedStyle(el).pointerEvents !== 'none').map(el => {
      const rect = el.getBoundingClientRect();
      return { left: rect.left - stage.left, right: rect.right - stage.left, top: rect.top - stage.top, bottom: rect.bottom - stage.top };
    });
    for (const c of cands) {
      const x = THREE.MathUtils.clamp(c.x, c.w / 2 + 2, w - c.w / 2 - 2);
      const y = THREE.MathUtils.clamp(c.y, c.h + 2, h - 2);
      let position: (typeof placed)[number] | undefined;
      for (const dx of (c.offsets === expandedOffsets || c.priority === 0 ? horizontalOffsets : [0])) {
        const left = x + dx - c.w / 2, right = left + c.w;
        if (left < 0 || right > w) continue;
        const offset = c.offsets.find(delta => {
          const bottom = y + delta, top = bottom - c.h;
          return top >= 0 && bottom <= h && !placed.some(p =>
            left < p.right + 3 && right > p.left - 3 && top < p.bottom + 3 && bottom > p.top - 3);
        });
        if (offset === undefined) continue;
        position = { left, right, top: y + offset - c.h, bottom: y + offset };
        break;
      }
      if (!position) { hide(c.el); continue; }
      placed.push(position);
      c.el.style.visibility = '';
      c.el.style.transform = 'translate(' + position.left.toFixed(1) + 'px, ' + position.top.toFixed(1) + 'px)';
    }
  }

  /* ============================ 检查/调试 ============================ */

  get debugState() {
    const render = this.renderer.info.render;
    return {
      pos: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      aspect: this.camera.aspect,
      size: [this.renderer.domElement.width, this.renderer.domElement.height],
      selected: this.selectedNode,
      selectedPipe: this.selectedPipe,
      walk: this.walkOn,
      shell: this.shellState,
      fps: Math.round(this.fps),
      drawCalls: render.calls,
      triangles: render.triangles,
      points: render.points,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures
    };
  }

  audit() {
    const base = auditFactoryData();
    const issues = [...base.issues, ...this.runtimeIssues];
    const missingRuns = FACTORY_PIPES.filter((p) => !this.runById.has(p.id)).map((p) => p.id);
    if (missingRuns.length) issues.push(`未构建管线：${missingRuns.join('、')}`);
    const inlineMissing = FACTORY_NODES.filter((n) => n.inline && !this.runById.has(n.inline.pipe)).map((n) => n.uid);
    if (inlineMissing.length) issues.push(`内联件未挂接：${inlineMissing.join('、')}`);
    return {
      ...base,
      issues,
      runtime: {
        pipesBuilt: this.runs.length,
        portsLinked: this.ports.length,
        valvesInline: this.valveStates.size,
        instrumentsBuilt: FACTORY_INSTRUMENTS.length,
        jointsBuilt: FACTORY_JOINTS.length,
        walk: this.walkOn,
        frontWall: this.frontWall.visible,
        roof: this.roof.visible
      }
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.controls.dispose();
    disposeFactoryResources([this.scene, ...this.appearanceCache.values()]);
    this.appearanceCache.clear();
    this.dotTexture.dispose();
    this.stripeTexture.dispose();
    this.environmentTarget.dispose();
    this.scene.environment = null;
    this.labelLayer.remove();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    el.remove();
  }
}

function disposeFactoryResources(roots: readonly THREE.Object3D[]) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  for (const root of roots) {
    root.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
      if (object instanceof THREE.DirectionalLight || object instanceof THREE.PointLight || object instanceof THREE.SpotLight) {
        object.shadow.dispose();
      }
    });
  }
  for (const material of materials) {
    for (const map of Object.values(material)) {
      if (map instanceof THREE.Texture) textures.add(map);
    }
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
  for (const geometry of geometries) geometry.dispose();
}

function surfaceBandMat() {
  return new THREE.MeshStandardMaterial({ color: 0xd9e6ee, roughness: 0.6, metalness: 0.1 });
}