import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { DeviceDef, PartDef, AssemblyStep } from '../data/types';
import { buildSteps } from '../data/types';
import { buildPart } from './builders';
import { plateExchangerPracticeWaypoint, plateExchangerBoltPracticePose } from './plateExchangerModel';
import { PrincipleAnim } from './principle';
import { INTERACTIONS, resetInteraction } from './interactions';
import { ENDOSCOPES, type EndoscopeStop } from './endoscope';
import { setPumpDetail } from './pumpModel';

export type Mode = 'observe' | 'section' | 'xray' | 'explode' | 'principle' | 'practice' | 'endoscope';
export type ViewName = 'front' | 'side' | 'top' | 'iso';

/** 内部小件默认不显示标注，避免遮挡主体结构；选中时仍显示 */
const QUIET_LABELS = new Set([
  'wearRing', 'keys', 'sealStatic', 'sealRotary', 'sealSpring', 'sealSleeve', 'sealOrings',
  'brgOuter', 'brgInner', 'brgRollers', 'brgCage', 'brgCovers', 'couplingBolts',
  'motorStator', 'motorRotor', 'motorShaft', 'motorEnds', 'motorFan', 'motorTerminalCover',
  'pipeGaskets', 'pipeBolts'
]);

export interface PracticeSnapshot {
  mode: 'guided' | 'free';
  installed: string[];
  rotSteps: Record<string, number>;
  stepIndex: number;
  errors: number;
  hints: number;
  assisted: boolean;
  elapsed: number;
  totalRemovals: number;
  completed: boolean;
  errorSteps: number[];
  history: { action: 'install' | 'remove'; partId: string }[];
}

export interface PracticeState extends PracticeSnapshot {
  steps: AssemblyStep[];
  canUndo: boolean;
}

export interface EndoscopeState {
  active: boolean;
  supported: boolean;
  index: number;
  count: number;
  stop: EndoscopeStop | null;
  entryNote: string;
}

export interface SceneCallbacks {
  onSelect: (partId: string | null) => void;
  onHover: (partId: string | null) => void;
  onPractice: (s: PracticeState) => void;
  onToast: (kind: 'success' | 'error' | 'info' | 'warn', msg: string) => void;
  onEndoscope?: (s: EndoscopeState) => void;
}

interface PartRuntime {
  def: PartDef;
  group: THREE.Group;
  materials: THREE.MeshStandardMaterial[];
  state: 'installed' | 'tray';
  rotStep: number;
  trayPos: THREE.Vector3;
}

interface Tween {
  obj: THREE.Object3D;
  from: THREE.Vector3;
  to: THREE.Vector3;
  via?: THREE.Vector3;
  pheBolts?: 'remove' | 'install';
  rotFrom?: number;
  rotTo?: number;
  rotAxis?: 'x' | 'y';
  t0: number;
  dur: number;
  onDone?: () => void;
}

const ACCENT = 0x1677ff;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private exteriorView: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private cameraMove = 0;
  private pumpExteriorDetail = false;
  private controls: OrbitControls;
  private container: HTMLElement;
  private labelLayer: HTMLElement;
  private deviceRoot = new THREE.Group();
  private ghostRoot = new THREE.Group();
  private parts = new Map<string, PartRuntime>();
  private device: DeviceDef | null = null;
  private cb: SceneCallbacks;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private tweens: Tween[] = [];
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;

  mode: Mode = 'observe';
  selected: string | null = null;
  hovered: string | null = null;
  labelsOn = true;
  private labels = new Map<string, HTMLDivElement>();

  // 剖视
  private clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  private sectionAxis: 'x' | 'y' | 'z' = 'x';
  private sectionT = 0.5;
  private sectionFlip = false;
  private sectionHelper: THREE.Mesh;
  private sectionActive = false;
  private sectionLocal = false;
  private pipeOuterHidden = false;
  private hiddenParts = new Set<string>();
  private origSides = new Map<THREE.MeshStandardMaterial, THREE.Side>();

  // 透明
  private shellOpacity = 0.22;
  private shellsHidden = false;

  // 爆炸
  private explodeT = 0;
  interactionT = 0;
  private guideLines: THREE.LineSegments;
  private guidePositions: Float32Array;

  // 原理
  private principle: PrincipleAnim | null = null;
  private quality: 'high' | 'low' = 'high';

  // 内窥
  endoscopeActive = false;
  private endoscopeStopIndex = 0;
  private endoStops: EndoscopeStop[] = [];
  private endoGuide: THREE.Group | null = null;
  private endoDrag: { x: number; y: number } | null = null;
  private endoYaw = 0;
  private endoPitch = 0;
  private endoLook = new THREE.Vector3();
  private endoTween: { from: THREE.Vector3; to: THREE.Vector3; fromLook: THREE.Vector3; toLook: THREE.Vector3; t0: number } | null = null;
  private endoLight: THREE.PointLight | null = null;

  // 拆装
  practiceActive = false;
  private pMode: 'guided' | 'free' = 'guided';
  private steps: AssemblyStep[] = [];
  private stepIndex = 0;
  private errors = 0;
  private hints = 0;
  private assisted = false;
  private elapsed = 0;
  private totalRemovals = 0;
  private completed = false;
  private errorSteps: number[] = [];
  private history: { action: 'install' | 'remove'; partId: string }[] = [];
  private ghosts = new Map<string, THREE.Group>();
  private trayZone: THREE.LineLoop;
  private trayLabel: HTMLDivElement;
  private lastPracticeEmit = 0;

  // 拖拽
  private dragPart: PartRuntime | null = null;
  private dragPointer: number | null = null;
  private dragPlane = new THREE.Plane();
  private dragOffset = new THREE.Vector3();
  private downXY: [number, number] = [0, 0];
  private moved = false;
  private dragging = false;
  private resizeObs: ResizeObserver;

  constructor(container: HTMLElement, cb: SceneCallbacks) {
    this.container = container;
    this.cb = cb;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'label-layer';
    container.appendChild(this.labelLayer);

    this.scene.background = new THREE.Color(0xf4f6f8);
    this.scene.fog = new THREE.Fog(0xf4f6f8, 20, 38);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 120);
    this.camera.position.set(4, 3, 5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = 1.52;
    this.controls.minDistance = 0.6;
    this.controls.maxDistance = 24;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x9aa7b4, 0.55);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(5, 9, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -6; key.shadow.camera.right = 6;
    key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
    key.shadow.camera.far = 30;
    key.shadow.bias = -0.0006;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5);
    fill.position.set(-5, 3, -6);
    this.scene.add(fill);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(16, 48),
      new THREE.MeshStandardMaterial({ color: 0xe9edf1, roughness: 0.95, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.002;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(26, 26, 0xc3cfda, 0xd9e1e9);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    this.scene.add(grid);

    this.scene.add(this.deviceRoot);
    this.scene.add(this.ghostRoot);

    this.sectionHelper = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false })
    );
    this.sectionHelper.visible = false;
    this.scene.add(this.sectionHelper);

    this.guidePositions = new Float32Array(64 * 6);
    const guideGeo = new THREE.BufferGeometry();
    guideGeo.setAttribute('position', new THREE.BufferAttribute(this.guidePositions, 3));
    this.guideLines = new THREE.LineSegments(guideGeo, new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.4 }));
    this.guideLines.visible = false;
    this.guideLines.frustumCulled = false;
    this.scene.add(this.guideLines);

    const zoneGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-2.3, 0.01, 1.25), new THREE.Vector3(2.7, 0.01, 1.25),
      new THREE.Vector3(2.7, 0.01, 2.35), new THREE.Vector3(-2.3, 0.01, 2.35)
    ]);
    this.trayZone = new THREE.LineLoop(zoneGeo, new THREE.LineBasicMaterial({ color: 0x8fa6bc }));
    this.trayZone.visible = false;
    this.scene.add(this.trayZone);
    this.trayLabel = document.createElement('div');
    this.trayLabel.className = 'scene-label tray-label';
    this.trayLabel.textContent = '零件区';
    this.trayLabel.style.display = 'none';
    this.labelLayer.appendChild(this.trayLabel);

    const el = this.renderer.domElement;
    el.tabIndex = 0;
    el.setAttribute('aria-label', '三维设备视窗');
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('lostpointercapture', this.onPointerUp);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.loop();
  }

  /* ---------------- 设备加载 ---------------- */

  loadDevice(device: DeviceDef) {
    this.clearDevice();
    this.device = device;
    const removable = device.parts.filter((p) => p.removable);
    device.parts.forEach((def) => {
      const group = buildPart(device.id, def.id, def.color);
      group.position.set(...def.pos);
      if (def.rot) group.rotation.set(...def.rot);
      this.deviceRoot.add(group);
      const materials: THREE.MeshStandardMaterial[] = [];
      group.traverse((o) => {
        const me = o as THREE.Mesh;
        if (me.isMesh) {
          const mats = Array.isArray(me.material) ? me.material : [me.material];
          for (const mm of mats) if (!materials.includes(mm as THREE.MeshStandardMaterial)) materials.push(mm as THREE.MeshStandardMaterial);
        }
      });
      const idx = Math.max(removable.indexOf(def), 0);
      const trayPos = new THREE.Vector3(-1.9 + (idx % 8) * 0.62, 0.5 + Math.floor(idx / 8) * 0.5, device.trayZ);
      this.parts.set(def.id, { def, group, materials, state: 'installed', rotStep: 0, trayPos });
      const label = document.createElement('div');
      label.className = 'scene-label';
      label.textContent = def.name;
      this.labelLayer.appendChild(label);
      this.labels.set(def.id, label);
    });
    this.principle = new PrincipleAnim(device, new Map([...this.parts].map(([id, p]) => [id, p.group])));
    this.scene.add(this.principle.object3d);
    this.practiceActive = false;
    this.mode = 'observe';
    this.selected = null;
    this.fitView(false);
  }

  private clearDevice() {
    this.teardownEndoscope();
    for (const [, p] of this.parts) {
      p.materials.forEach((m) => m.dispose());
      this.deviceRoot.remove(p.group);
    }
    this.parts.clear();
    this.labels.forEach((l) => l.remove());
    this.labels.clear();
    this.ghosts.forEach((g) => {
      g.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh) (me.material as THREE.Material).dispose(); });
      this.ghostRoot.remove(g);
    });
    this.ghosts.clear();
    if (this.principle) { this.scene.remove(this.principle.object3d); this.principle.dispose(); this.principle = null; }
    this.tweens = [];
    this.clearEffects();
    this.practiceActive = false;
    this.trayZone.visible = false;
    this.trayLabel.style.display = 'none';
  }

  /* ---------------- 模式与效果 ---------------- */

  setMode(mode: Mode) {
    if (this.mode === mode) return;
    if (this.dragPointer !== null) this.finishPracticeDrag(true);
    if (this.mode === 'endoscope') this.teardownEndoscope();
    this.setPumpExteriorDetail(this.pumpExteriorDetail, mode);
    if (mode === 'endoscope') {
      this.cameraMove++;
      this.exteriorView = { position: this.camera.position.clone(), target: this.controls.target.clone() };
    }
    this.clearEffects();
    if (this.practiceActive && (this.mode === 'practice' || mode === 'practice')) {
      this.syncPracticePose(mode === 'practice');
    }
    this.mode = mode;
    if (mode === 'section') this.applySection();
    if (mode === 'xray') this.applyXray();
    if (mode === 'explode') this.applyExplode();
    if (mode === 'endoscope') this.enterEndoscope(0);
    if (mode === 'principle' && this.principle) {
      this.principle.setActive(true);
      for (const [, p] of this.parts) {
        if (!p.def.shell) continue;
        for (const m of p.materials) { m.transparent = true; m.opacity = 0.28; m.depthWrite = false; m.needsUpdate = true; }
      }
    }
    if (mode === 'practice') {
      if (this.practiceActive) { this.ghostRoot.visible = true; this.updateGhostVisibility(); }
      this.trayZone.visible = true;
      this.trayLabel.style.display = '';
    } else {
      this.trayZone.visible = false;
      this.trayLabel.style.display = 'none';
    }
  }

  cancelPracticeInput() {
    if (this.dragPointer === null) return false;
    this.finishPracticeDrag(true);
    return true;
  }

  setPumpExteriorDetail(enabled: boolean, mode = this.mode) {
    this.pumpExteriorDetail = enabled;
    const casing = this.device?.id === 'pump' ? this.parts.get('casing') : undefined;
    if (casing) setPumpDetail(casing.group, enabled || mode !== 'observe' ? 'study' : 'overview');
  }

  private clearEffects() {
    this.sectionActive = false;
    this.sectionHelper.visible = false;
    for (const [m, side] of this.origSides) { m.side = side; m.needsUpdate = true; }
    this.origSides.clear();
    for (const [, p] of this.parts) {
      for (const m of p.materials) {
        if (m.clippingPlanes && m.clippingPlanes.length) { m.clippingPlanes = []; m.needsUpdate = true; }
        m.transparent = false; m.opacity = 1; m.depthWrite = true; m.needsUpdate = true;
      }
      p.group.visible = true;
      if (this.mode !== 'practice' || !this.practiceActive) {
        p.group.rotation.set(0, 0, 0);
        if (p.def.rot) p.group.rotation.set(...p.def.rot);
      }
    }
    this.shellsHidden = false;
    this.sectionLocal = false;
    this.setPipeOuterHidden(false);
    this.hiddenParts.clear();
    this.explodeT = 0;
    this.interactionT = 0;
    this.guideLines.visible = false;
    for (const [, p] of this.parts) {
      if (p.state === 'installed') p.group.position.set(...p.def.pos);
    }
    if (this.mode !== 'practice' || !this.practiceActive) {
      resetInteraction(new Map([...this.parts].map(([id, p]) => [id, p.group])));
    }
    if (this.principle) this.principle.setActive(false);
    this.ghostRoot.visible = false;
    this.updateHighlights(0);
  }

  /* ---------------- 剖视 ---------------- */

  setSection(axis: 'x' | 'y' | 'z', t: number, flip: boolean) {
    this.sectionAxis = axis; this.sectionT = t; this.sectionFlip = flip;
    if (this.mode === 'section') this.applySection();
  }

  private applySection() {
    if (!this.device) return;
    this.sectionActive = true;
    // 剖切时临时将材质改为双面，避免单面实体剖开后内部件不可见
    for (const [, p] of this.parts) {
      for (const m of p.materials) {
        if (!this.origSides.has(m)) this.origSides.set(m, m.side);
        if (m.side !== THREE.DoubleSide) { m.side = THREE.DoubleSide; m.needsUpdate = true; }
      }
    }
    const box = this.deviceBox();
    const min = box.min, max = box.max;
    const axis = this.sectionAxis;
    const lo = axis === 'x' ? min.x : axis === 'y' ? min.y : min.z;
    const hi = axis === 'x' ? max.x : axis === 'y' ? max.y : max.z;
    const cut = lo + (hi - lo) * this.sectionT;
    const n = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
    if (this.sectionFlip) n.negate();
    this.clipPlane.normal.copy(n);
    this.clipPlane.constant = -n.dot(new THREE.Vector3(axis === 'x' ? cut : 0, axis === 'y' ? cut : 0, axis === 'z' ? cut : 0));
    for (const [id, p] of this.parts) {
      const clip = this.sectionLocal ? (id === this.selected ? [this.clipPlane] : []) : [this.clipPlane];
      for (const m of p.materials) { m.clippingPlanes = clip; m.clipShadows = true; m.needsUpdate = true; }
    }
    const size = new THREE.Vector3().subVectors(max, min);
    const center = box.getCenter(new THREE.Vector3());
    this.sectionHelper.visible = true;
    this.sectionHelper.scale.set(
      axis === 'x' ? size.z + 0.4 : size.x + 0.4,
      axis === 'y' ? size.z + 0.4 : size.y + 0.4, 1
    );
    this.sectionHelper.position.set(axis === 'x' ? cut : center.x, axis === 'y' ? cut : center.y, axis === 'z' ? cut : center.z);
    this.sectionHelper.rotation.set(axis === 'y' ? -Math.PI / 2 : 0, axis === 'x' ? Math.PI / 2 : 0, 0);
  }

  /* ---------------- 透明观察 ---------------- */

  setShellOpacity(v: number) { this.shellOpacity = v; if (this.mode === 'xray') this.applyXray(); }

  /* ---------------- 结构专属互动 ---------------- */

  setInteraction(t: number) {
    this.interactionT = THREE.MathUtils.clamp(t, 0, 1);
    if (!this.device || (this.mode !== 'observe' && this.mode !== 'xray')) return;
    const def = INTERACTIONS[this.device.id];
    if (!def) return;
    def.apply(this.interactionT, new Map([...this.parts].map(([id, p]) => [id, p.group])));
  }
  setShellsHidden(h: boolean) { this.shellsHidden = h; if (this.mode === 'xray') this.applyXray(); }

  /* ---------------- 逐件操作（隐藏/透明/管道外壁/局部剖切） ---------------- */

  setPartHidden(id: string, hidden: boolean) {
    const p = this.parts.get(id);
    if (!p) return;
    if (hidden) this.hiddenParts.add(id); else this.hiddenParts.delete(id);
    p.group.visible = !hidden;
  }

  setPartOpacity(id: string, opacity: number) {
    const p = this.parts.get(id);
    if (!p) return;
    const op = THREE.MathUtils.clamp(opacity, 0.05, 1);
    for (const m of p.materials) {
      m.transparent = op < 1;
      m.opacity = op;
      m.depthWrite = op >= 0.98;
      m.needsUpdate = true;
    }
  }

  setPipeOuterHidden(hidden: boolean) {
    this.pipeOuterHidden = hidden;
    this.deviceRoot.traverse((o) => {
      if (o.userData && o.userData.outerWall === 'pipe') o.visible = !hidden;
    });
  }

  setSectionLocal(local: boolean) {
    this.sectionLocal = local;
    if (this.mode === 'section') this.applySection();
  }

  isPartHidden(id: string) { return this.hiddenParts.has(id); }

  resetPartEffects() {
    for (const [id, p] of this.parts) {
      p.group.visible = true;
      for (const m of p.materials) { m.transparent = false; m.opacity = 1; m.depthWrite = true; m.needsUpdate = true; }
      this.hiddenParts.delete(id);
    }
    this.setPipeOuterHidden(false);
    this.shellsHidden = false;
    if (this.mode === 'xray') this.applyXray();
  }

  private applyXray() {
    for (const [, p] of this.parts) {
      if (p.def.shell) {
        p.group.visible = !this.shellsHidden && !this.hiddenParts.has(p.def.id);
        for (const m of p.materials) {
          m.transparent = true; m.opacity = this.shellOpacity; m.depthWrite = this.shellOpacity > 0.9; m.needsUpdate = true;
        }
      }
    }
  }

  /* ---------------- 爆炸图 ---------------- */

  setExplode(t: number) {
    this.explodeT = THREE.MathUtils.clamp(t, 0, 1);
    this.lastExplodeChange = performance.now();
    if (this.mode === 'explode') this.applyExplode();
  }
  getExplode() { return this.explodeT; }
  private lastExplodeChange = 0;

  /** 爆炸展开时自动向后取景，保证所有零件留在视野内；只拉远不推近，保留用户视角方向 */
  private autoFrameExplode(now: number) {
    if (now - this.lastExplodeChange > 700) return;
    const box = this.deviceBox();
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const need = (maxDim / (2 * Math.tan((this.camera.fov * Math.PI) / 360))) * 1.22;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const dist = offset.length();
    if (need <= dist * 1.02) return;
    const dir = offset.normalize();
    const nd = THREE.MathUtils.lerp(dist, need, 0.14);
    this.controls.target.lerp(center, 0.14);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, nd);
  }

  private applyExplode() {
    const dir = new THREE.Vector3();
    let li = 0;
    for (const [, p] of this.parts) {
      if (p.state !== 'installed') continue;
      dir.set(...p.def.explodeDir);
      if (dir.lengthSq() > 0) dir.normalize();
      const base = new THREE.Vector3(...p.def.pos);
      p.group.position.copy(base).addScaledVector(dir, p.def.explodeDist * this.explodeT);
      if (p.def.explodeDist > 0 && li < 64) {
        this.guidePositions.set([base.x, base.y, base.z, p.group.position.x, p.group.position.y, p.group.position.z], li * 6);
        li++;
      }
    }
    this.guideLines.geometry.setDrawRange(0, li * 2);
    (this.guideLines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.guideLines.visible = this.explodeT > 0.02;
  }

  /* ---------------- 原理动画 ---------------- */

  setPlaying(on: boolean) { if (this.principle) this.principle.playing = on; }
  setPrincipleSpeed(v: number) { if (this.principle) this.principle.speed = v; }
  setPrincipleTime(t: number) { this.principle?.setTime(t); }
  getPrincipleTime(): number { return this.principle?.getTime() ?? 0; }
  replayPrinciple() { if (this.principle) this.principle.replay(); }

  /* ---------------- 内窥（内部教学视点） ---------------- */

  hasEndoscope(): boolean { return !!(this.device && ENDOSCOPES[this.device.id]); }
  getEndoscopeDef() { return this.device ? ENDOSCOPES[this.device.id] ?? null : null; }

  getEndoscopeState(): EndoscopeState {
    const def = this.getEndoscopeDef();
    return {
      active: this.endoscopeActive,
      supported: !!def,
      index: this.endoscopeStopIndex,
      count: def?.stops.length ?? 0,
      stop: this.endoscopeActive ? def?.stops[this.endoscopeStopIndex] ?? null : null,
      entryNote: def?.entryNote ?? ''
    };
  }

  enterEndoscope(stop = 0): boolean {
    const def = this.getEndoscopeDef();
    if (!def || !def.stops.length) return false;
    this.endoscopeActive = true;
    this.endoStops = def.stops;
    this.endoYaw = 0;
    this.endoPitch = 0;
    this.camera.near = 0.01;
    this.camera.updateProjectionMatrix();
    this.renderer.toneMappingExposure = 0.72;
    this.controls.enabled = false;
    this.controls.enablePan = false;
    this.buildEndoGuide(def);
    if (!this.endoLight) {
      this.endoLight = new THREE.PointLight(0xfff6e8, 0.22, 2.2, 2);
      this.scene.add(this.endoLight);
    }
    this.setEndoscopeStop(stop, true);
    return true;
  }

  setEndoscopeStop(index: number, instant = false) {
    if (!this.endoscopeActive || !this.endoStops.length) return;
    const i = Math.max(0, Math.min(index, this.endoStops.length - 1));
    this.endoscopeStopIndex = i;
    this.endoYaw = 0;
    this.endoPitch = 0;
    const s = this.endoStops[i];
    const pos = new THREE.Vector3(...s.pos);
    const look = new THREE.Vector3(...s.look);
    this.endoLook.copy(look);
    this.updateEndoArrow(s);
    if (instant) {
      this.camera.position.copy(pos);
      this.camera.lookAt(look);
      this.endoTween = null;
    } else {
      this.endoTween = {
        from: this.camera.position.clone(), to: pos,
        fromLook: this.camera.position.clone().add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(0.6)),
        toLook: look, t0: performance.now()
      };
    }
    this.cb.onEndoscope?.(this.getEndoscopeState());
  }

  nextEndoscopeStop() { this.setEndoscopeStop(this.endoscopeStopIndex + 1); }
  prevEndoscopeStop() { this.setEndoscopeStop(this.endoscopeStopIndex - 1); }
  resetEndoscope() { this.setEndoscopeStop(this.endoscopeStopIndex, true); }

  /** 当前液流方向在屏幕上的角度（0 = 屏幕向上，顺时针为正），用于 HUD 方向提示 */
  getEndoFlowScreenAngle(): number {
    const s = this.endoStops[this.endoscopeStopIndex];
    if (!s) return 0;
    this.camera.updateMatrixWorld();
    const flow = new THREE.Vector3(...s.flow).normalize();
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const x = flow.dot(right);
    const y = flow.dot(up);
    return Math.round((Math.atan2(x, y) * 180) / Math.PI);
  }

  private applyEndoLook() {
    const s = this.endoStops[this.endoscopeStopIndex];
    if (!s) return;
    const base = new THREE.Vector3(...s.look).sub(new THREE.Vector3(...s.pos)).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const dir = base.clone().applyAxisAngle(up, this.endoYaw);
    const right = new THREE.Vector3().crossVectors(dir, up);
    if (right.lengthSq() < 1e-4) right.set(0, 0, 1);
    right.normalize();
    dir.applyAxisAngle(right, this.endoPitch);
    this.camera.lookAt(this.camera.position.clone().add(dir));
  }

  private buildEndoGuide(def: { flowPath: [number, number, number][] }) {
    this.disposeEndoGuide();
    const g = new THREE.Group();
    const pts = def.flowPath.map((p) => new THREE.Vector3(...p));
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({
      color: 0x2f8fe6, dashSize: 0.05, gapSize: 0.035, transparent: true, opacity: 0.62, depthTest: false
    }));
    line.computeLineDistances();
    line.renderOrder = 30;
    g.add(line);
    const dotGeo = new THREE.SphereGeometry(0.009, 8, 6);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x1677ff, transparent: true, opacity: 0.85, depthTest: false });
    this.endoStops.forEach((s, i) => {
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.set(...s.pos);
      dot.name = `endo-dot-${i}`;
      dot.renderOrder = 31;
      g.add(dot);
    });
    const arrow = new THREE.Group();
    arrow.name = 'endo-current-arrow';
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.003, 0.003, 0.09, 8),
      new THREE.MeshBasicMaterial({ color: 0x1677ff, depthTest: false, transparent: true, opacity: 0.65 })
    );
    shaft.position.y = 0.045;
    const head = new THREE.Mesh(
      new THREE.ConeGeometry(0.016, 0.05, 10),
      new THREE.MeshBasicMaterial({ color: 0x1677ff, depthTest: false, transparent: true, opacity: 0.65 })
    );
    head.position.y = 0.115;
    arrow.add(shaft, head);
    arrow.renderOrder = 32;
    g.add(arrow);
    this.scene.add(g);
    this.endoGuide = g;
  }

  private updateEndoArrow(s: EndoscopeStop) {
    if (!this.endoGuide) return;
    const arrow = this.endoGuide.getObjectByName('endo-current-arrow');
    if (!arrow) return;
    const flow = new THREE.Vector3(...s.flow).normalize();
    arrow.position.set(s.pos[0] + flow.x * 0.28, s.pos[1] + flow.y * 0.28, s.pos[2] + flow.z * 0.28);
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), flow);
    for (let i = 0; i < this.endoStops.length; i++) {
      const dot = this.endoGuide.getObjectByName(`endo-dot-${i}`);
      if (dot) dot.visible = i !== this.endoscopeStopIndex;
    }
  }

  private disposeEndoGuide() {
    if (!this.endoGuide) return;
    this.scene.remove(this.endoGuide);
    const disposed = new Set<THREE.BufferGeometry | THREE.Material>();
    this.endoGuide.traverse((o) => {
      const me = o as THREE.Mesh;
      if (!me.isMesh) return;
      if (!disposed.has(me.geometry)) { disposed.add(me.geometry); me.geometry.dispose(); }
      const mats = Array.isArray(me.material) ? me.material : [me.material];
      for (const m of mats) {
        if (!disposed.has(m)) { disposed.add(m); m.dispose(); }
      }
    });
    this.endoGuide = null;
  }

  private teardownEndoscope() {
    if (!this.endoscopeActive && !this.endoGuide) return;
    this.endoscopeActive = false;
    this.endoTween = null;
    this.endoDrag = null;
    this.endoYaw = 0;
    this.endoPitch = 0;
    this.endoStops = [];
    this.camera.near = 0.05;
    this.camera.updateProjectionMatrix();
    this.renderer.toneMappingExposure = 1.05;
    this.controls.enabled = true;
    this.controls.enablePan = true;
    this.controls.minDistance = 0.6;
    this.controls.maxDistance = 24;
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = 1.52;
    this.disposeEndoGuide();
    if (this.exteriorView) {
      this.moveCamera(this.exteriorView.position, this.exteriorView.target, false);
      this.exteriorView = null;
    }
    if (this.endoLight) {
      this.scene.remove(this.endoLight);
      this.endoLight.dispose();
      this.endoLight = null;
    }
    this.cb.onEndoscope?.(this.getEndoscopeState());
  }

  /* ---------------- 视角 ---------------- */

  private deviceBox(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const [, p] of this.parts) {
      if (p.group.visible) box.expandByObject(p.group);
    }
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(2, 2, 2));
    return box;
  }

  fitView(animate = true) {
    const box = this.deviceBox();
    if (this.mode === 'practice') {
      // Include the source and destination of each removable component in the fit.
      for (const part of this.removableParts()) box.union(this.practicePartBounds(part));
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dir = new THREE.Vector3(1, 0.62, 1.15).normalize();
    const dist = Math.max(
      (maxDim / (2 * Math.tan((this.camera.fov * Math.PI) / 360))) * 1.3,
      this.distanceForBounds(box, center, dir)
    );
    this.moveCamera(center.clone().addScaledVector(dir, dist), center, animate);
  }

  setView(name: ViewName) {
    const box = this.deviceBox();
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const dist = Math.max(size.x, size.y, size.z) * 1.6;
    const dirs: Record<ViewName, THREE.Vector3> = {
      front: new THREE.Vector3(0, 0.06, 1),
      side: new THREE.Vector3(1, 0.06, 0),
      top: new THREE.Vector3(0.001, 1, 0.001),
      iso: new THREE.Vector3(1, 0.62, 1.15)
    };
    this.moveCamera(center.clone().addScaledVector(dirs[name].normalize(), dist), center, true);
  }

  focusPart(id: string) {
    const p = this.parts.get(id);
    if (!p) return;
    const box = this.mode === 'practice' && p.def.removable
      ? this.practicePartBounds(p)
      : new THREE.Box3().setFromObject(p.group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = Math.max(Math.max(size.x, size.y, size.z) * 2.4, 1.4, this.distanceForBounds(box, center, dir));
    this.moveCamera(center.clone().addScaledVector(dir, dist), center, true);
  }

  private practicePartBounds(part: PartRuntime) {
    const bounds = new THREE.Box3().setFromObject(part.group);
    const offset = new THREE.Vector3();
    const atTray = bounds.clone().translate(offset.copy(part.trayPos).sub(part.group.position));
    const atMount = bounds.clone().translate(offset.set(...part.def.pos).sub(part.group.position));
    return bounds.union(atTray).union(atMount);
  }

  private distanceForBounds(box: THREE.Box3, center: THREE.Vector3, dir: THREE.Vector3) {
    const right = new THREE.Vector3().crossVectors(this.camera.up, dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right);
    const corner = new THREE.Vector3();
    const halfHeight = Math.tan((this.camera.fov * Math.PI) / 360) * 0.84;
    const aspect = Math.max(1, this.container.clientWidth) / Math.max(1, this.container.clientHeight);
    const halfWidth = halfHeight * aspect;
    let distance = 0;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          corner.set(x, y, z).sub(center);
          distance = Math.max(distance, corner.dot(dir) + Math.max(
            Math.abs(corner.dot(right)) / halfWidth,
            Math.abs(corner.dot(up)) / halfHeight
          ));
        }
      }
    }
    return distance;
  }

  private moveCamera(pos: THREE.Vector3, target: THREE.Vector3, animate: boolean) {
    const move = ++this.cameraMove;
    if (!animate) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    const fromP = this.camera.position.clone();
    const fromT = this.controls.target.clone();
    const t0 = performance.now();
    const dur = 550;
    const step = () => {
      if (this.disposed || move !== this.cameraMove) return;
      const k = Math.min((performance.now() - t0) / dur, 1);
      const e = easeInOut(k);
      this.camera.position.lerpVectors(fromP, pos, e);
      this.controls.target.lerpVectors(fromT, target, e);
      if (k < 1) requestAnimationFrame(step);
    };
    step();
  }

  /* ---------------- 选择与高亮 ---------------- */

  select(id: string | null, focus = false) {
    this.selected = id;
    this.updateHighlights(0);
    if (id && focus) this.focusPart(id);
    this.cb.onSelect(id);
    this.updateGhostVisibility();
    if (this.mode === 'section' && this.sectionLocal) this.applySection();
  }

  /** 清掉选中与悬停高亮：用于自测开始，避免答案被自动高亮。 */
  clearSelectionAndHover() {
    this.selected = null;
    this.hovered = null;
    this.updateHighlights(0);
    this.cb.onSelect(null);
    this.updateGhostVisibility();
    if (this.mode === 'section' && this.sectionLocal) this.applySection();
  }

  private updateHighlights(time: number) {
    const guidedPart = this.mode === 'practice' && this.practiceActive && this.pMode === 'guided' && !this.completed
      ? this.steps[this.stepIndex]?.partId : null;
    for (const [id, p] of this.parts) {
      let intensity = 0;
      let color = ACCENT;
      if (id === this.selected) intensity = 0.5;
      else if (id === this.hovered) intensity = 0.22;
      if (id === guidedPart) {
        intensity = Math.max(intensity, 0.3 + 0.25 * Math.sin(time * 4));
        color = 0xeaa23b;
      }
      for (const m of p.materials) {
        m.emissive.setHex(intensity > 0 ? color : 0x000000);
        m.emissiveIntensity = intensity;
      }
    }
  }

  setLabels(on: boolean) { this.labelsOn = on; }

  /** 画质开关：低画质降低像素比并关闭阴影，供触屏/低性能设备使用 */
  setQuality(q: 'high' | 'low') {
    this.quality = q;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio, 2) : 1);
    this.renderer.shadowMap.enabled = q === 'high';
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
    });
    this.resize();
  }

  getQuality(): 'high' | 'low' { return this.quality; }

  private updateLabels() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const v = new THREE.Vector3();
    const placed: { left: number; right: number; top: number; bottom: number }[] = [];
    const entries: { left: number; top: number; dist: number; priority: number; el: HTMLDivElement }[] = [];
    const practice = this.mode === 'practice';
    const taskId = practice && this.pMode === 'guided' && !this.completed ? this.steps[this.stepIndex]?.partId : undefined;
    function add(el: HTMLDivElement, position: THREE.Vector3, priority: number, camera: THREE.Camera) {
      const dist = position.distanceTo(camera.position);
      position.project(camera);
      if (position.z < -1 || position.z > 1 || Math.abs(position.x) > 1 || Math.abs(position.y) > 1) {
        el.style.display = 'none';
        return;
      }
      entries.push({ left: (position.x + 1) * w / 2, top: (1 - position.y) * h / 2, dist, priority, el });
    }

    for (const [id, p] of this.parts) {
      const el = this.labels.get(id)!;
      const selected = id === this.selected || id === this.dragPart?.def.id;
      const taskPart = id === taskId;
      if (!this.labelsOn || this.endoscopeActive || !p.group.visible ||
        (!selected && !taskPart && (practice || QUIET_LABELS.has(id)))) {
        el.style.display = 'none';
        continue;
      }
      v.copy(p.group.position);
      if (p.def.labelOffset) v.add(new THREE.Vector3(...p.def.labelOffset));
      el.classList.toggle('selected', selected);
      el.classList.toggle('tray-part', p.state === 'tray');
      add(el, v, selected ? 0 : taskPart ? 1 : 3, this.camera);
    }
    if (practice && this.labelsOn) add(this.trayLabel, v.set(0.2, 0.05, this.device?.trayZ ?? 1.7), 2, this.camera);
    else this.trayLabel.style.display = 'none';
    entries.sort((a, b) => a.priority - b.priority || a.dist - b.dist);
    const limit = Math.min(16, Math.max(4, Math.floor(w * h / 28000)));
    for (const e of entries) {
      const width = (e.el.textContent?.length ?? 0) * 12 + 18;
      const height = 23;
      const left = THREE.MathUtils.clamp(e.left - width / 2, 4, w - width - 4);
      let rect;
      if (placed.length < limit && w > width + 8) {
        for (const offset of [-height - 6, 7, -2 * height - 10]) {
          const top = e.top + offset;
          const next = { left, top, right: left + width, bottom: top + height };
          if (top < 4 || next.bottom > h - 4) continue;
          if (placed.some(other => left < other.right + 4 && next.right > other.left - 4 &&
            top < other.bottom + 3 && next.bottom > other.top - 3)) continue;
          rect = next;
          break;
        }
      }
      if (!rect) { e.el.style.display = 'none'; continue; }
      placed.push(rect);
      e.el.style.display = '';
      e.el.style.transform = `translate(${rect.left.toFixed(1)}px,${rect.top.toFixed(1)}px)`;
    }
  }

  /* ---------------- 拆装练习 ---------------- */

  startPractice(mode: 'guided' | 'free', snapshot?: PracticeSnapshot | null) {
    if (this.dragPointer !== null) this.finishPracticeDrag(true);
    if (!this.device || this.device.assemblyOrder.length === 0) return;
    this.tweens = [];
    this.pMode = mode;
    this.steps = buildSteps(this.device);
    this.practiceActive = true;
    this.completed = false;
    this.ghostRoot.visible = true;
    this.ensureGhosts();
    if (snapshot && snapshot.mode === mode) {
      this.stepIndex = snapshot.stepIndex;
      this.errors = snapshot.errors;
      this.hints = snapshot.hints;
      this.assisted = snapshot.assisted;
      this.elapsed = snapshot.elapsed;
      this.totalRemovals = snapshot.totalRemovals;
      this.completed = snapshot.completed;
      this.errorSteps = [...snapshot.errorSteps];
      this.history = [...snapshot.history];
      const installedSet = new Set(snapshot.installed);
      for (const [id, p] of this.parts) {
        if (!p.def.removable) continue;
        if (installedSet.has(id)) {
          p.state = 'installed';
          p.group.position.set(...p.def.pos);
          p.group.rotation.set(0, 0, 0);
          p.rotStep = 0;
        } else {
          p.state = 'tray';
          p.rotStep = snapshot.rotSteps[id] ?? 0;
          p.group.position.copy(p.trayPos);
          p.group.rotation.set(p.def.orientable ? (p.rotStep * Math.PI) / 2 : 0, 0, 0);
        }
      }
    } else {
      this.stepIndex = 0; this.errors = 0; this.hints = 0; this.assisted = false;
      this.elapsed = 0; this.totalRemovals = 0; this.errorSteps = []; this.history = [];
      for (const [, p] of this.parts) {
        p.state = 'installed';
        p.rotStep = 0;
        p.group.position.set(...p.def.pos);
        p.group.rotation.set(0, 0, 0);
      }
    }
    if (this.device.id === 'plate-exchanger') this.syncPracticePose(true);
    this.updateGhostVisibility();
    this.emitPractice();
  }

  private ensureGhosts() {
    if (!this.device) return;
    for (const def of this.device.parts) {
      if (!def.removable || this.ghosts.has(def.id)) continue;
      const src = this.parts.get(def.id)!.group;
      const ghost = src.clone(true);
      ghost.traverse((o) => {
        const me = o as THREE.Mesh;
        if (me.isMesh) {
          me.material = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.16, depthWrite: false });
          me.castShadow = false; me.receiveShadow = false;
        }
      });
      ghost.position.set(...def.pos);
      ghost.visible = false;
      this.ghostRoot.add(ghost);
      this.ghosts.set(def.id, ghost);
    }
  }

  private updateGhostVisibility() {
    for (const [id, g] of this.ghosts) {
      const p = this.parts.get(id)!;
      let show = false;
      if (this.mode === 'practice' && this.practiceActive && !this.completed) {
        if (this.dragPart?.def.id === id) show = true;
        else if (this.selected === id && p.state === 'tray') show = true;
        else if (this.pMode === 'guided' && this.steps[this.stepIndex]?.partId === id && this.steps[this.stepIndex]?.action === 'install') show = true;
      }
      g.visible = show;
    }
  }

  private removableParts() { return [...this.parts.values()].filter((p) => p.def.removable); }

  private installedBlockers(id: string): string[] {
    const p = this.parts.get(id)!;
    const out: string[] = [];
    for (const other of this.parts.values()) {
      if (other.state !== 'installed' || other.def.id === id) continue;
      if ((other.def.prereq ?? []).includes(id)) out.push(other.def.name);
    }
    for (const bid of p.def.removeAfter ?? []) {
      const b = this.parts.get(bid);
      if (b && b.state === 'installed' && !out.includes(b.def.name)) out.push(b.def.name);
    }
    return out;
  }

  private missingPrereq(id: string): string[] {
    const p = this.parts.get(id)!;
    return (p.def.prereq ?? [])
      .map((x) => this.parts.get(x)!)
      .filter((x) => x.state !== 'installed')
      .map((x) => x.def.name);
  }

  private syncPracticePose(showPractice: boolean) {
    this.tweens = [];
    if (this.dragPointer !== null) this.finishPracticeDrag(true);
    this.dragPart = null;
    this.dragging = false;
    this.controls.enabled = true;
    for (const p of this.removableParts()) {
      const inTray = showPractice && p.state === 'tray';
      if (inTray) p.group.position.copy(p.trayPos);
      else p.group.position.set(...p.def.pos);
      p.group.rotation.set(...(p.def.rot ?? [0, 0, 0] as const));
      if (inTray && p.def.orientable) p.group.rotation.x = p.rotStep * Math.PI / 2;
      if (this.device?.id === 'plate-exchanger' && p.def.id === 'bolts') {
        plateExchangerBoltPracticePose(p.group, inTray ? 1 : 0);
      }
    }
  }

  private plateMotionBusy(): boolean {
    if (this.device?.id !== 'plate-exchanger' || this.tweens.length === 0) return false;
    this.cb.onToast('info', '请等待当前零件移动完成后继续操作。');
    return true;
  }

  removeSelected() {
    if (this.plateMotionBusy()) return;
    if (!this.practiceActive || this.completed) return;
    const id = this.selected;
    if (!id) { this.cb.onToast('info', '请先点击选择一个要拆卸的零件。'); return; }
    const p = this.parts.get(id)!;
    if (p.def.fixed || !p.def.removable) { this.cb.onToast('warn', `「${p.def.name}」为固定连接件，教学模型中不可拆卸。`); return; }
    if (p.state === 'tray') { this.cb.onToast('info', `「${p.def.name}」已在零件区，请进行安装操作。`); return; }
    if (this.pMode === 'guided') {
      const step = this.steps[this.stepIndex];
      if (!step || step.action !== 'remove' || step.partId !== id) {
        this.registerError(`引导模式：当前步骤是「${step?.title ?? '已完成'}」。打开「步骤」可查看操作指引。`);
        return;
      }
    }
    const blockers = this.installedBlockers(id);
    if (blockers.length) {
      this.registerError(`请先拆卸：${blockers.join('、')}，再拆「${p.def.name}」。`);
      return;
    }
    this.doRemove(p, true);
  }

  private doRemove(p: PartRuntime, byUser: boolean) {
    p.state = 'tray';
    p.rotStep = p.def.orientable ? 1 : 0;
    this.totalRemovals++;
    this.history.push({ action: 'remove', partId: p.def.id });
    this.tweenPart(p, p.trayPos, (p.rotStep * Math.PI) / 2);
    if (byUser && this.pMode === 'guided') this.stepIndex++;
    this.cb.onToast('success', `已拆下「${p.def.name}」，放入零件区。`);
    this.afterAction();
  }

  installSelected() {
    if (this.plateMotionBusy()) return;
    if (!this.practiceActive || this.completed) return;
    const id = this.selected;
    if (!id) { this.cb.onToast('info', '请先在零件区或目录中选择一个零件。'); return; }
    const p = this.parts.get(id)!;
    if (p.state === 'installed') { this.cb.onToast('info', `「${p.def.name}」已安装到位。`); return; }
    this.attemptInstall(p, null);
  }

  rotateSelected() {
    if (this.plateMotionBusy()) return;
    if (!this.practiceActive) return;
    const p = this.selected ? this.parts.get(this.selected) : null;
    if (!p || p.state !== 'tray') { this.cb.onToast('info', '请先选择零件区中的一个零件。'); return; }
    if (!p.def.orientable) { this.cb.onToast('info', `「${p.def.name}」为对称件，无方向要求。`); return; }
    p.rotStep = (p.rotStep + 1) % 4;
    p.group.rotation.x = (p.rotStep * Math.PI) / 2;
    this.cb.onToast('info', p.rotStep === 0 ? `「${p.def.name}」方向已对准安装位置。` : `已旋转 90°（当前方向 ${p.rotStep * 90}°，需转回 0°）。`);
    this.emitPractice();
  }

  /** dropPos 为 null 表示「选中后点击安装」辅助方式 */
  private attemptInstall(p: PartRuntime, dropPos: THREE.Vector3 | null) {
    if (this.plateMotionBusy() || p.def.fixed || !p.def.removable) return;
    if (this.pMode === 'guided') {
      const step = this.steps[this.stepIndex];
      if (!step || step.action !== 'install' || step.partId !== p.def.id) {
        this.registerError(`引导模式：当前步骤是「${step?.title ?? '已完成'}」。打开「步骤」可查看操作指引。`);
        this.returnToTray(p);
        return;
      }
    }
    const target = new THREE.Vector3(...p.def.pos);
    if (dropPos) {
      for (const other of this.parts.values()) {
        if (other.def.id === p.def.id || !other.def.removable) continue;
        const ot = new THREE.Vector3(...other.def.pos);
        if (this.screenPlaneDist(dropPos, ot) < 0.4 && this.screenPlaneDist(dropPos, target) > 0.72) {
          this.registerError(`该零件不属于此安装位置：这里是「${other.def.name}」的位置。请把「${p.def.name}」拖到它自己的虚线轮廓处。`);
          this.returnToTray(p);
          return;
        }
      }
    }
    const missing = this.missingPrereq(p.def.id);
    if (missing.length) {
      this.registerError(`请先安装前置部件：${missing.join('、')}。可在零件区先选中它们并按顺序安装。`);
      this.returnToTray(p);
      return;
    }
    if (p.def.orientable && p.rotStep % 4 !== 0) {
      this.registerError('当前安装方向不匹配，请用「旋转 90°」按钮把方向转回 0° 后再安装。');
      this.returnToTray(p);
      return;
    }
    if (dropPos && this.screenPlaneDist(dropPos, target) > 0.72) {
      this.registerError('位置还不够接近：请把零件拖到虚线轮廓（安装位置）附近再松开，或选中零件后点「安装到位置」。');
      this.returnToTray(p);
      return;
    }
    p.state = 'installed';
    p.rotStep = 0;
    this.history.push({ action: 'install', partId: p.def.id });
    this.tweenPart(p, target, 0);
    if (this.pMode === 'guided') this.stepIndex++;
    this.cb.onToast('success', `「${p.def.name}」安装到位，已自动吸附。`);
    this.afterAction();
  }

  private returnToTray(p: PartRuntime) {
    this.tweenPart(p, p.trayPos, (p.rotStep * Math.PI) / 2);
  }

  /** 拖拽发生在面向相机的平面上，深度差不可消除，故按屏幕平面内的距离判断接近程度 */
  private screenPlaneDist(a: THREE.Vector3, b: THREE.Vector3): number {
    const n = this.camera.getWorldDirection(new THREE.Vector3());
    const d = a.clone().sub(b);
    return d.sub(n.multiplyScalar(d.dot(n))).length();
  }

  private tweenPart(p: PartRuntime, to: THREE.Vector3, rotTo: number) {
    this.tweens = this.tweens.filter((t) => t.obj !== p.group);
    const installed = new THREE.Vector3(...p.def.pos);
    const fromInstalled = p.group.position.distanceTo(installed) < 0.001;
    const toInstalled = to.distanceTo(installed) < 0.001;
    const via = this.device?.id === 'plate-exchanger' && (fromInstalled || toInstalled)
      ? plateExchangerPracticeWaypoint(p.def.id, installed) ?? undefined : undefined;
    const pheBolts = this.device?.id === 'plate-exchanger' && p.def.id === 'bolts'
      ? (toInstalled ? 'install' : fromInstalled ? 'remove' : undefined) : undefined;
    this.tweens.push({
      obj: p.group, from: p.group.position.clone(), to: to.clone(), via, pheBolts,
      rotFrom: p.group.rotation.x, rotTo, rotAxis: 'x',
      t0: performance.now(), dur: pheBolts ? 1050 : 380
    });
  }

  private registerError(msg: string) {
    this.errors++;
    if (this.pMode === 'guided') this.errorSteps.push(this.stepIndex);
    this.cb.onToast('error', msg);
    this.emitPractice();
  }

  private afterAction() {
    if (this.pMode === 'guided') {
      if (this.stepIndex >= this.steps.length) this.finish();
    } else {
      const allIn = this.removableParts().every((p) => p.state === 'installed');
      if (allIn && this.totalRemovals > 0) {
        let needsFullDisassembly = this.device?.id === 'plate-exchanger';
        if (needsFullDisassembly) {
          const tray = new Set<string>();
          const count = this.removableParts().length;
          for (const entry of this.history) {
            if (entry.action === 'remove') tray.add(entry.partId);
            else tray.delete(entry.partId);
            if (tray.size === count) { needsFullDisassembly = false; break; }
          }
        }
        if (!needsFullDisassembly) this.finish();
      }
    }
    this.updateGhostVisibility();
    this.emitPractice();
  }

  private finish() {
    this.completed = true;
    this.ghostRoot.visible = false;
    this.cb.onToast('success', this.assisted ? '设备已复原（本次记为辅助完成）。' : '恭喜！拆装练习完成。');
  }

  undo() {
    if (this.plateMotionBusy()) return;
    if (!this.practiceActive || this.history.length === 0) { this.cb.onToast('info', '没有可撤销的操作。'); return; }
    const last = this.history.pop()!;
    const p = this.parts.get(last.partId)!;
    const countedAction = this.device?.id === 'plate-exchanger' ? 'remove' : 'install';
    if (last.action === countedAction) this.totalRemovals = Math.max(0, this.totalRemovals - 1);
    if (last.action === 'install') {
      p.state = 'tray';
      this.returnToTray(p);
    } else {
      p.state = 'installed';
      p.rotStep = 0;
      this.tweenPart(p, new THREE.Vector3(...p.def.pos), 0);
    }
    if (this.pMode === 'guided' && this.stepIndex > 0) this.stepIndex--;
    this.completed = false;
    this.cb.onToast('info', `已撤销：${last.action === 'install' ? '安装' : '拆卸'}「${p.def.name}」。`);
    this.updateGhostVisibility();
    this.emitPractice();
  }

  hint() {
    if (!this.practiceActive || this.completed) return;
    this.hints++;
    this.assisted = true;
    let msg: string;
    let focusId: string | null = null;
    if (this.pMode === 'guided') {
      const step = this.steps[this.stepIndex];
      msg = step ? step.instruction : '所有步骤已完成。';
      focusId = step?.partId ?? null;
    } else {
      const candidate = this.removableParts().find((p) => p.state === 'tray' && this.missingPrereq(p.def.id).length === 0 && (!p.def.orientable || p.rotStep % 4 === 0));
      if (candidate) {
        msg = `建议：把「${candidate.def.name}」拖到它的虚线安装位置。`;
        focusId = candidate.def.id;
      } else {
        const next = [...this.device!.assemblyOrder].reverse()
          .map((id) => this.parts.get(id)!)
          .find((p) => p.state === 'installed' && this.installedBlockers(p.def.id).length === 0);
        if (next) { msg = `建议：先拆下「${next.def.name}」。`; focusId = next.def.id; }
        else msg = '检查零件方向：选中零件区零件，用「旋转 90°」转回 0°。';
      }
    }
    this.cb.onToast('info', msg);
    if (focusId) this.select(focusId);
    this.emitPractice();
  }

  restart() {
    if (!this.device) return;
    this.startPractice(this.pMode);
    this.cb.onToast('info', '已重新开始：设备恢复完整装配，计时与统计清零。');
  }

  restoreAll() {
    if (this.plateMotionBusy()) return;
    if (!this.practiceActive) return;
    this.assisted = true;
    if (this.device?.id === 'plate-exchanger') this.history = [];
    for (const p of this.removableParts()) {
      if (p.state !== 'installed') {
        p.state = 'installed';
        p.rotStep = 0;
        if (this.device?.id !== 'plate-exchanger') this.tweenPart(p, new THREE.Vector3(...p.def.pos), 0);
      }
    }
    if (this.device?.id === 'plate-exchanger') this.syncPracticePose(true);
    this.updateGhostVisibility();
    if (this.pMode === 'guided') this.stepIndex = this.steps.length;
    this.finish();
    this.emitPractice();
  }

  getPracticeState(): PracticeState {
    return {
      mode: this.pMode,
      steps: this.steps,
      stepIndex: this.stepIndex,
      installed: [...this.parts.values()].filter((p) => p.state === 'installed').map((p) => p.def.id),
      rotSteps: Object.fromEntries([...this.parts.values()].filter((p) => p.state === 'tray').map((p) => [p.def.id, p.rotStep])),
      errors: this.errors,
      hints: this.hints,
      assisted: this.assisted,
      elapsed: this.elapsed,
      totalRemovals: this.totalRemovals,
      completed: this.completed,
      errorSteps: [...this.errorSteps],
      history: [...this.history],
      canUndo: this.history.length > 0
    };
  }

  private emitPractice() { this.cb.onPractice(this.getPracticeState()); }

  /* ---------------- 指针交互 ---------------- */

  private pick(ev: PointerEvent): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.deviceRoot.children, true);
    for (const h of hits) {
      const id = h.object.userData.partId as string | undefined;
      if (id) {
        const p = this.parts.get(id);
        if (p && p.group.visible) return id;
      }
    }
    return null;
  }

  private onPointerDown = (ev: PointerEvent) => {
    if (this.dragPointer !== null) return;
    if (this.mode === 'endoscope' && this.endoscopeActive) {
      this.endoDrag = { x: ev.clientX, y: ev.clientY };
      (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
      return;
    }
    if (this.mode === 'practice' && this.plateMotionBusy()) return;
    this.downXY = [ev.clientX, ev.clientY];
    this.moved = false;
    this.dragging = false;
    if (this.mode === 'practice' && this.practiceActive && !this.completed && ev.button === 0) {
      const id = this.pick(ev);
      if (id) {
        const p = this.parts.get(id)!;
        if (p.state === 'tray' && p.def.removable) {
          this.dragPart = p;
          this.dragPointer = ev.pointerId;
          this.renderer.domElement.setPointerCapture(ev.pointerId);
          const normal = this.camera.getWorldDirection(new THREE.Vector3()).negate();
          this.dragPlane.setFromNormalAndCoplanarPoint(normal, p.group.position);
          const hit = new THREE.Vector3();
          this.raycaster.setFromCamera(this.pointer, this.camera);
          if (this.raycaster.ray.intersectPlane(this.dragPlane, hit)) {
            this.dragOffset.copy(p.group.position).sub(hit);
          } else this.dragOffset.set(0, 0, 0);
          this.controls.enabled = false;
        }
      }
    }
  };

  private onPointerMove = (ev: PointerEvent) => {
    if (this.dragPointer !== null && ev.pointerId !== this.dragPointer) return;
    if (this.endoDrag && this.mode === 'endoscope') {
      if (ev.buttons > 0) {
        const dx = ev.clientX - this.endoDrag.x;
        const dy = ev.clientY - this.endoDrag.y;
        this.endoYaw = THREE.MathUtils.clamp(this.endoYaw + dx * 0.0045, -1.2, 1.2);
        this.endoPitch = THREE.MathUtils.clamp(this.endoPitch - dy * 0.0045, -0.9, 0.9);
        this.applyEndoLook();
      }
      this.endoDrag = { x: ev.clientX, y: ev.clientY };
      return;
    }
    if (this.mode === 'endoscope' && this.endoscopeActive) return;
    const dx = ev.clientX - this.downXY[0], dy = ev.clientY - this.downXY[1];
    if (Math.abs(dx) + Math.abs(dy) > 6) this.moved = true;
    if (this.dragPart && this.moved && ev.buttons > 0) {
      if (!this.dragging) {
        this.dragging = true;
        this.controls.enabled = false;
        this.select(this.dragPart.def.id);
        this.renderer.domElement.style.cursor = 'grabbing';
        if (this.device?.id === 'plate-exchanger' && ['plates', 'gaskets', 'movablePlate', 'bolts'].includes(this.dragPart.def.id)) this.cb.onToast('info', '松开后将按正确路径自动安装；移出画布可取消。');
      }
      if (this.device?.id === 'plate-exchanger' && ['plates', 'gaskets', 'movablePlate', 'bolts'].includes(this.dragPart.def.id)) {
        this.updateGhostVisibility();
        return;
      }
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.dragPlane, hit)) {
        const pos = hit.add(this.dragOffset);
        pos.y = Math.max(pos.y, 0.18);
        pos.x = THREE.MathUtils.clamp(pos.x, -4.2, 4.4);
        pos.z = THREE.MathUtils.clamp(pos.z, -2.9, 3.4);
        this.dragPart.group.position.copy(pos);
        this.updateGhostVisibility();
      }
      return;
    }
    if (!this.dragging) {
      const id = this.pick(ev);
      if (id !== this.hovered) {
        this.hovered = id;
        this.renderer.domElement.style.cursor = id ? 'pointer' : '';
        this.cb.onHover(id);
      }
    }
  };

  private finishPracticeDrag(cancelled: boolean, ev?: PointerEvent) {
    const part = this.dragPart;
    const dragging = this.dragging;
    const pointer = this.dragPointer;
    this.dragPart = null;
    this.dragging = false;
    this.dragPointer = null;
    this.controls.enabled = true;
    const canvas = this.renderer.domElement;
    canvas.style.cursor = '';
    if (pointer !== null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
    if (!part) return;
    if (cancelled) {
      part.group.position.copy(part.trayPos);
      this.updateGhostVisibility();
      if (dragging) this.cb.onToast('info', '已取消拖放，零件留在零件区。');
    } else if (dragging) {
      const guidedPlate = this.device?.id === 'plate-exchanger' && ['plates', 'gaskets', 'movablePlate', 'bolts'].includes(part.def.id);
      this.attemptInstall(part, guidedPlate ? null : part.group.position.clone());
    } else if (ev) {
      this.select(this.pick(ev));
    }
  }

  private onPointerUp = (ev: PointerEvent) => {
    if (this.endoDrag) { this.endoDrag = null; return; }
    if (this.dragPointer !== null) {
      if (ev.pointerId !== this.dragPointer) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      const outside = ev.clientX < rect.left || ev.clientX > rect.right || ev.clientY < rect.top || ev.clientY > rect.bottom;
      this.finishPracticeDrag(ev.type !== 'pointerup' || outside, ev);
      return;
    }
    if (ev.type !== 'pointerup') return;
    this.controls.enabled = true;
    if (!this.moved) this.select(this.pick(ev));
  };

  /* ---------------- 主循环 ---------------- */

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const now = performance.now();
    if (!this.endoscopeActive) this.controls.update();
    if (this.endoLight) this.endoLight.position.copy(this.camera.position);
    if (this.endoTween) {
      const k = Math.min((now - this.endoTween.t0) / 520, 1);
      const e = easeInOut(k);
      this.camera.position.lerpVectors(this.endoTween.from, this.endoTween.to, e);
      this.endoLook.lerpVectors(this.endoTween.fromLook, this.endoTween.toLook, e);
      this.camera.lookAt(this.endoLook);
      if (k >= 1) this.endoTween = null;
    }
    if (this.mode === 'explode') this.autoFrameExplode(now);

    this.tweens = this.tweens.filter((t) => {
      const k = Math.min((now - t.t0) / t.dur, 1);
      const e = easeInOut(k);
      if (t.pheBolts) {
        const progress = t.pheBolts === 'remove' ? e : 1 - e;
        const travel = plateExchangerBoltPracticePose(t.obj, progress);
        if (t.pheBolts === 'remove') t.obj.position.lerpVectors(t.from, t.to, travel);
        else t.obj.position.lerpVectors(t.to, t.from, travel);
      } else if (t.via) {
        if (e < 0.5) t.obj.position.lerpVectors(t.from, t.via, e * 2);
        else t.obj.position.lerpVectors(t.via, t.to, (e - 0.5) * 2);
      } else t.obj.position.lerpVectors(t.from, t.to, e);
      if (t.rotFrom !== undefined && t.rotTo !== undefined && t.rotAxis) {
        t.obj.rotation[t.rotAxis] = t.rotFrom + (t.rotTo - t.rotFrom) * e;
      }
      return k < 1;
    });

    if (this.mode === 'principle' && this.principle) this.principle.update(dt);
    if (this.mode === 'practice' && this.practiceActive && !this.completed) {
      this.elapsed += dt;
      if (now - this.lastPracticeEmit > 800) { this.lastPracticeEmit = now; this.emitPractice(); }
    }
    this.updateHighlights(now / 1000);
    this.updateLabels();
    this.renderer.render(this.scene, this.camera);
  };

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('lostpointercapture', this.onPointerUp);
    this.clearDevice();
    this.controls.dispose();
    this.renderer.dispose();
    el.remove();
    this.labelLayer.remove();
  }
}

/** 首页缩略图：离屏渲染三台设备 */
export function renderThumbnails(devices: DeviceDef[]): Record<string, string> {
  const out: Record<string, string> = {};
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return out;
  }
  renderer.setSize(440, 260);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa7b4, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(4, 7, 5);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(40, 440 / 260, 0.1, 60);
  for (const d of devices) {
    const root = new THREE.Group();
    for (const p of d.parts) {
      const g = buildPart(d.id, p.id, p.color);
      g.position.set(...p.pos);
      root.add(g);
    }
    scene.add(root);
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const dist = (Math.max(size.x, size.y, size.z) / (2 * Math.tan((40 * Math.PI) / 360))) * 1.22;
    camera.position.copy(center).addScaledVector(new THREE.Vector3(1, 0.55, 1.2).normalize(), dist);
    camera.lookAt(center);
    renderer.render(scene, camera);
    out[d.id] = renderer.domElement.toDataURL('image/png');
    scene.remove(root);
    root.traverse((o) => {
      const me = o as THREE.Mesh;
      if (me.isMesh) {
        const mats = Array.isArray(me.material) ? me.material : [me.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }
  renderer.dispose();
  return out;
}
