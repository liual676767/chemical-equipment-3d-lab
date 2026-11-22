/* 工坊三维引擎：场景渲染、拾取、放置、拖动、框选、接口标记、流动粒子与原理演示。
 * UI 持有状态与历史；引擎从状态同步几何，并通过 hooks 把操作结果交回 UI。 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { WState, Instance, MaterialKind } from './types';
import { buildPart } from './geometry';
import { partById } from './catalog';
import { componentOf } from './state';
import type { PortRef } from './state';

export type EditMode = 'select' | 'move' | 'rotate';
export type AxisLock = 'free' | 'x' | 'y' | 'z';

export interface TransformItem { uid: string; pos: [number, number, number]; rot: [number, number, number] }

export interface EngineHooks {
  onSelect(uids: string[], additive: boolean): void;
  onPortPick(ref: PortRef): void;
  onPortHover(ref: PortRef | null): void;
  onTransformPreview(items: TransformItem[], solo: boolean): string | null;
  onTransformEnd(): void;
  onTransformCancel(): void;
  onPlace(pos: [number, number, number]): void;
  onPlaceCancel(): void;
  onBoxSelect(uids: string[]): void;
  onHover(text: string | null): void;
  onDragInfo(text: string | null): void;
}

export interface PortMarker {
  ref: PortRef;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  color: string;
  r?: number;
}

interface Entry { group: THREE.Group; key: string; inst: Instance }

const FASTENERS = new Set(['bolt', 'nut', 'clamp', 'support', 'gasket']);
const SNAP_STEP = 0.5; /* 50 mm */

export class WorkshopScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  private scene = new THREE.Scene();
  private controls: OrbitControls;
  private container: HTMLElement;
  private hooks: EngineHooks;
  private state: WState = { instances: [], connections: [], groups: [] };
  private entries = new Map<string, Entry>();
  private partsRoot = new THREE.Group();
  private markersRoot = new THREE.Group();
  private markerMeshes: THREE.Mesh[] = [];
  private grid: THREE.GridHelper;
  private axes: THREE.AxesHelper;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private selection = new Set<string>();
  private hoverUid: string | null = null;

  mode: EditMode = 'select';
  axis: AxisLock = 'free';
  snapOn = true;
  showFasteners = true;
  demoOn = false;
  xrayOn = false;
  quality: 'high' | 'low' = 'high';

  /* 放置幽灵 */
  private ghost: THREE.Group | null = null;

  /* 拖动状态 */
  private drag: null | {
    kind: 'move' | 'rotate' | 'box';
    uid: string;
    uids: string[];
    solo: boolean;
    startClient: [number, number];
    startWorld: THREE.Vector3;
    startPos: Map<string, [number, number, number]>;
    startRot: [number, number, number];
    plane: THREE.Plane;
    moved: boolean;
  } = null;
  private boxDiv: HTMLDivElement;

  /* 流动粒子 */
  private flowPts: THREE.Vector3[] | null = null;
  private flowCum: number[] = [];
  private flowTotal = 0;
  private flowPoints: THREE.Points | null = null;
  private flowT = 0;

  private raf = 0;
  private clock = new THREE.Clock();
  private ro: ResizeObserver;
  private disposed = false;
  private downClient: [number, number] | null = null;

  constructor(container: HTMLElement, hooks: EngineHooks) {
    this.container = container;
    this.hooks = hooks;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = 'none';

    this.scene.background = new THREE.Color('#dfe6ee');
    this.scene.fog = new THREE.Fog('#dfe6ee', 90, 220);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    this.camera.position.set(16, 13, 20);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 3, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 160;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x9aa7b4, 0.6);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(18, 30, 14);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -40; key.shadow.camera.right = 40;
    key.shadow.camera.top = 40; key.shadow.camera.bottom = -40;
    key.shadow.camera.far = 120;
    key.shadow.bias = -0.0004;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5);
    fill.position.set(-16, 12, -18);
    this.scene.add(fill);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: '#e9eef4', roughness: 0.95, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.grid = new THREE.GridHelper(80, 80, 0x8fa3b8, 0xc2cedb);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.55;
    this.scene.add(this.grid);
    this.axes = new THREE.AxesHelper(3);
    this.axes.position.y = 0.01;
    this.scene.add(this.axes);

    this.scene.add(this.partsRoot);
    this.scene.add(this.markersRoot);
    this.scene.add(this.refRoot);

    this.boxDiv = document.createElement('div');
    this.boxDiv.className = 'ws-boxsel';
    this.boxDiv.style.display = 'none';
    container.appendChild(this.boxDiv);

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('lostpointercapture', this.onCancel);
    el.addEventListener('pointerleave', this.onLeave);
    el.addEventListener('contextmenu', this.onCtx);
    window.addEventListener('blur', this.onBlur);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.tick();
  }

  /* ============ 状态同步 ============ */

  setState(state: WState) {
    this.state = state;
    this.rebuild();
  }

  private specKey(i: Instance) { return `${i.partId}|${JSON.stringify(i.spec)}`; }

  rebuild() {
    const live = new Set(this.state.instances.map((i) => i.uid));
    for (const [uid, e] of [...this.entries]) {
      const inst = this.state.instances.find((i) => i.uid === uid);
      if (!live.has(uid) || !inst || this.specKey(inst) !== e.key) {
        this.partsRoot.remove(e.group);
        e.group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) (m.material as THREE.Material).dispose();
        });
        this.entries.delete(uid);
      }
    }
    for (const inst of this.state.instances) {
      let e = this.entries.get(inst.uid);
      if (!e) {
        const part = partById(inst.partId);
        if (!part || part.status !== 'ready') continue;
        const group = buildPart(inst.partId, inst.spec, part.color, part.material as MaterialKind);
        group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.material = (m.material as THREE.MeshStandardMaterial).clone();
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        group.userData.uid = inst.uid;
        this.partsRoot.add(group);
        e = { group, key: this.specKey(inst), inst };
        this.entries.set(inst.uid, e);
      }
      e.inst = inst;
      e.group.position.set(...inst.pos);
      e.group.rotation.set(inst.rot[0], inst.rot[1], inst.rot[2], 'XYZ');
      e.group.visible = !inst.hidden && (this.showFasteners || !FASTENERS.has(inst.partId));
    }
    this.applyHighlight();
    this.applyXray();
  }

  setSelection(uids: string[]) {
    this.selection = new Set(uids);
    this.applyHighlight();
  }

  private applyHighlight() {
    for (const [uid, e] of this.entries) {
      const sel = this.selection.has(uid);
      const hov = this.hoverUid === uid && !sel;
      e.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (!mat.emissive) return;
        if (sel) { mat.emissive.set('#1677ff'); mat.emissiveIntensity = 0.32; }
        else if (hov) { mat.emissive.set('#1677ff'); mat.emissiveIntensity = 0.14; }
        else { mat.emissive.set('#000000'); mat.emissiveIntensity = 0; }
      });
    }
  }

  private applyXray() {
    for (const e of this.entries.values()) {
      e.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.userData.shell) return;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (this.xrayOn) {
          if (mat.userData.origOpacity === undefined) mat.userData.origOpacity = mat.opacity;
          mat.transparent = true;
          mat.opacity = 0.18;
          mat.depthWrite = false;
        } else if (mat.userData.origOpacity !== undefined) {
          mat.opacity = mat.userData.origOpacity;
          mat.transparent = mat.userData.origOpacity < 1;
          mat.depthWrite = true;
        }
        mat.needsUpdate = true;
      });
    }
  }

  /* ============ 显示开关 ============ */

  setGrid(on: boolean) { this.grid.visible = on; }
  setAxes(on: boolean) { this.axes.visible = on; }
  setXray(on: boolean) { this.xrayOn = on; this.applyXray(); }
  setShowFasteners(on: boolean) { this.showFasteners = on; this.rebuild(); }
  setQuality(q: 'high' | 'low') {
    this.quality = q;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio, 2) : 1);
    this.renderer.shadowMap.enabled = q === 'high';
    for (const e of this.entries.values()) {
      e.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.castShadow = q === 'high'; (m.material as THREE.Material).needsUpdate = true; }
      });
    }
  }

  /* ============ 接口标记 ============ */

  setPortMarkers(list: PortMarker[]) {
    for (const m of this.markerMeshes) {
      this.markersRoot.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.markerMeshes = [];
    for (const mk of list) {
      const r = mk.r ?? 0.3;
      const geo = new THREE.TorusGeometry(r, Math.max(0.03, r * 0.16), 10, 28);
      const mat = new THREE.MeshBasicMaterial({ color: mk.color, transparent: true, opacity: 0.95, depthTest: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(mk.pos).addScaledVector(mk.dir, 0.03);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), mk.dir.clone().normalize());
      mesh.renderOrder = 10;
      mesh.userData.portRef = mk.ref;
      this.markersRoot.add(mesh);
      this.markerMeshes.push(mesh);
    }
  }

  /* ============ 放置 ============ */

  startPlacement(partId: string, spec: { dn: number; length?: number; endType?: 'weld' | 'thread' | 'flange' }) {
    this.cancelPlacement(false);
    const part = partById(partId);
    if (!part) return;
    const g = buildPart(partId, spec, part.color, part.material as MaterialKind);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = (m.material as THREE.MeshStandardMaterial).clone();
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.transparent = true;
        mat.opacity = 0.55;
        mat.depthWrite = false;
        if (mat.emissive) { mat.emissive.set('#2e9d74'); mat.emissiveIntensity = 0.25; }
        m.castShadow = false;
      }
      o.userData.ghost = true;
    });
    this.ghost = g;
    this.downClient = null;
    g.visible = false;
    this.scene.add(g);
  }

  cancelPlacement(notify = true) {
    if (this.ghost) {
      this.scene.remove(this.ghost);
      this.ghost.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) (m.material as THREE.Material).dispose();
      });
      this.ghost = null;
      if (notify) this.hooks.onPlaceCancel();
    }
  }

  get placing() { return !!this.ghost; }

  /* 参考方案半透明覆盖 */
  private refRoot = new THREE.Group();
  setReference(refState: WState | null) {
    for (const child of [...this.refRoot.children]) {
      this.refRoot.remove(child);
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) (m.material as THREE.Material).dispose();
      });
    }
    if (!refState) return;
    for (const inst of refState.instances) {
      const part = partById(inst.partId);
      if (!part || part.status !== 'ready') continue;
      const g = buildPart(inst.partId, inst.spec, part.color, part.material as MaterialKind);
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.material = (m.material as THREE.MeshStandardMaterial).clone();
          const mat = m.material as THREE.MeshStandardMaterial;
          mat.transparent = true;
          mat.opacity = 0.3;
          mat.depthWrite = false;
          if (mat.emissive) { mat.emissive.set('#eaa23b'); mat.emissiveIntensity = 0.2; }
          m.castShadow = false;
        }
        o.userData.ref = true;
      });
      g.position.set(...inst.pos);
      g.rotation.set(inst.rot[0], inst.rot[1], inst.rot[2], 'XYZ');
      this.refRoot.add(g);
    }
  }

  /* 连接对齐预览 */
  private preview: THREE.Group | null = null;
  setPreview(partId: string, spec: { dn: number; length?: number; endType?: 'weld' | 'thread' | 'flange' }, pos: [number, number, number], rot: [number, number, number]) {
    this.clearPreview();
    const part = partById(partId);
    if (!part) return;
    const g = buildPart(partId, spec, part.color, part.material as MaterialKind);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = (m.material as THREE.MeshStandardMaterial).clone();
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.transparent = true;
        mat.opacity = 0.45;
        mat.depthWrite = false;
        if (mat.emissive) { mat.emissive.set('#18b57f'); mat.emissiveIntensity = 0.3; }
        m.castShadow = false;
      }
      o.userData.preview = true;
    });
    g.position.set(...pos);
    g.rotation.set(rot[0], rot[1], rot[2], 'XYZ');
    this.preview = g;
    this.scene.add(g);
  }
  clearPreview() {
    if (!this.preview) return;
    this.scene.remove(this.preview);
    this.preview.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) (m.material as THREE.Material).dispose();
    });
    this.preview = null;
  }

  screenToGround(clientX: number, clientY: number): [number, number, number] | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, p)) return null;
    if (this.snapOn) { p.x = Math.round(p.x / SNAP_STEP) * SNAP_STEP; p.z = Math.round(p.z / SNAP_STEP) * SNAP_STEP; }
    return [p.x, 0, p.z];
  }

  /* ============ 流动演示 ============ */

  setFlowPositions(pts: THREE.Vector3[] | null) {
    if (this.flowPoints) {
      this.scene.remove(this.flowPoints);
      this.flowPoints.geometry.dispose();
      (this.flowPoints.material as THREE.Material).dispose();
      this.flowPoints = null;
    }
    this.flowPts = pts && pts.length >= 2 ? pts : null;
    if (!this.flowPts) return;
    this.flowCum = [0];
    this.flowTotal = 0;
    for (let i = 1; i < this.flowPts.length; i++) {
      this.flowTotal += this.flowPts[i].distanceTo(this.flowPts[i - 1]);
      this.flowCum.push(this.flowTotal);
    }
    if (this.flowTotal <= 0) { this.flowPts = null; return; }
    const N = 48;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const mat = new THREE.PointsMaterial({ color: '#18b57f', size: 0.22, sizeAttenuation: true, transparent: true, opacity: 0.95, depthTest: false });
    this.flowPoints = new THREE.Points(geo, mat);
    this.flowPoints.renderOrder = 11;
    this.flowPoints.frustumCulled = false;
    this.scene.add(this.flowPoints);
  }

  private flowAt(t: number): THREE.Vector3 {
    const d = t * this.flowTotal;
    const pts = this.flowPts!;
    for (let i = 1; i < pts.length; i++) {
      if (d <= this.flowCum[i]) {
        const seg = this.flowCum[i] - this.flowCum[i - 1];
        const k = seg > 0 ? (d - this.flowCum[i - 1]) / seg : 0;
        return pts[i - 1].clone().lerp(pts[i], k);
      }
    }
    return pts[pts.length - 1].clone();
  }

  /* ============ 相机 ============ */

  fitAll(distanceScale = 1) {
    const box = new THREE.Box3();
    let any = false;
    for (const e of this.entries.values()) {
      if (!e.group.visible) continue;
      box.expandByObject(e.group);
      any = true;
    }
    if (!any) {
      this.camera.position.set(16, 13, 20);
      this.controls.target.set(0, 3, 0);
      return;
    }
    this.fitBox(box, distanceScale);
  }

  placementCenter(): [number, number, number] {
    const target = this.controls.target;
    return [target.x + 1.5, 0, target.z + 1.5];
  }

  focus(uids: string[]) {
    const box = new THREE.Box3();
    let any = false;
    for (const uid of uids) {
      const e = this.entries.get(uid);
      if (e) { box.expandByObject(e.group); any = true; }
    }
    if (any) this.fitBox(box);
  }

  private fitBox(box: THREE.Box3, distanceScale = 1) {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 2) * 0.75;
    const dist = radius / Math.tan((this.camera.fov * Math.PI) / 360) + radius;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.lengthSq() < 0.01) dir.set(0.6, 0.5, 0.7).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, Math.min(dist * distanceScale, 150));
  }

  boxes(): Map<string, THREE.Box3> {
    const out = new Map<string, THREE.Box3>();
    for (const [uid, e] of this.entries) {
      if (!e.group.visible) continue;
      out.set(uid, new THREE.Box3().setFromObject(e.group));
    }
    return out;
  }

  /* ============ 指针交互 ============ */

  private ndc(ev: PointerEvent): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  }

  private pickUid(ev: PointerEvent): { uid: string; point: THREE.Vector3 } | null {
    this.raycaster.setFromCamera(this.ndc(ev), this.camera);
    const groups = [...this.entries.values()].filter((e) => e.group.visible).map((e) => e.group);
    const hits = this.raycaster.intersectObjects(groups, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        if (o.userData.uid) return { uid: o.userData.uid as string, point: h.point };
        o = o.parent;
      }
    }
    return null;
  }

  private pickPort(ev: PointerEvent): PortRef | null {
    if (!this.markerMeshes.length) return null;
    this.raycaster.setFromCamera(this.ndc(ev), this.camera);
    const hits = this.raycaster.intersectObjects(this.markerMeshes, false);
    return hits.length ? (hits[0].object.userData.portRef as PortRef) : null;
  }

  private groundPoint(ev: PointerEvent, plane?: THREE.Plane): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.ndc(ev), this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane ?? this.groundPlane, p) ? p : null;
  }

  private onCtx = (ev: MouseEvent) => {
    if (this.ghost) { ev.preventDefault(); this.cancelPlacement(); }
  };

  private onDown = (ev: PointerEvent) => {
    if (!ev.isPrimary || this.capturedPointer !== null || ev.button !== 0) return;
    this.downClient = [ev.clientX, ev.clientY];
    if (this.ghost) {
      this.updatePlacementPoint(ev);
      return;
    }

    const port = this.pickPort(ev);
    if (port) {
      this.controls.enabled = false;
      this.drag = null;
      this.pendingPort = port;
      return;
    }

    const hit = this.pickUid(ev);
    if (hit && (this.mode === 'move' || this.mode === 'select' || this.mode === 'rotate')) {
      const inst = this.state.instances.find((i) => i.uid === hit.uid);
      if (!inst) return;
      const solo = ev.altKey;
      let uids: string[];
      if (this.mode === 'rotate' || solo) uids = [hit.uid];
      else {
        const comp = componentOf(this.state, hit.uid);
        if (inst.groupId) {
          for (const item of this.state.instances) {
            if (item.groupId !== inst.groupId || comp.has(item.uid)) continue;
            for (const member of componentOf(this.state, item.uid)) comp.add(member);
          }
        }
        uids = [...comp];
      }
      const startPos = new Map<string, [number, number, number]>();
      for (const uid of uids) {
        const i = this.state.instances.find((x) => x.uid === uid);
        if (i) startPos.set(uid, [...i.pos]);
      }
      let plane: THREE.Plane;
      if (this.axis === 'y') {
        const n = this.camera.getWorldDirection(new THREE.Vector3());
        n.y = 0;
        if (n.lengthSq() < 1e-4) n.set(0, 0, 1);
        n.normalize();
        plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, hit.point);
      } else {
        plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.point.y);
      }
      const startWorld = this.groundPoint(ev, plane) ?? hit.point.clone();
      this.drag = {
        kind: this.mode === 'rotate' ? 'rotate' : 'move',
        uid: hit.uid, uids, solo,
        startClient: [ev.clientX, ev.clientY],
        startWorld, startPos,
        startRot: [...inst.rot],
        plane, moved: false
      };
      this.controls.enabled = false;
      this.renderer.domElement.setPointerCapture(ev.pointerId);
      this.capturedPointer = ev.pointerId;
      return;
    }

    if (!hit && ev.shiftKey) {
      this.drag = {
        kind: 'box', uid: '', uids: [], solo: false,
        startClient: [ev.clientX, ev.clientY],
        startWorld: new THREE.Vector3(), startPos: new Map(), startRot: [0, 0, 0],
        plane: this.groundPlane, moved: false
      };
      this.controls.enabled = false;
      this.renderer.domElement.setPointerCapture(ev.pointerId);
      this.capturedPointer = ev.pointerId;
    }
  };

  private pendingPort: PortRef | null = null;
  private capturedPointer: number | null = null;
  private readonly dockRay = new THREE.Raycaster();

  canSeeDock(fixed: string, moving: ReadonlySet<string>, position: THREE.Vector3, outward: THREE.Vector3): boolean {
    const target = this.entries.get(fixed);
    if (!target?.group.visible) return false;
    const point = position.clone().addScaledVector(outward, 0.015);
    const projected = point.clone().project(this.camera);
    if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || Math.abs(projected.z) > 1) return false;
    const direction = point.sub(this.camera.position);
    this.dockRay.set(this.camera.position, direction.clone().normalize());
    this.dockRay.far = Math.max(0, direction.length() - 0.02);
    const blockers = [...this.entries].filter(([uid, entry]) => entry.group.visible && !moving.has(uid))
      .map(([, entry]) => entry.group);
    return this.dockRay.intersectObjects(blockers, true).length === 0;
  }

  private previewTransform(items: TransformItem[], solo: boolean): string | null {
    const reason = this.hooks.onTransformPreview(items, solo);
    if (reason) return reason;
    for (const item of items) {
      const entry = this.entries.get(item.uid);
      if (!entry) continue;
      entry.group.position.set(...item.pos);
      entry.group.rotation.set(...item.rot, 'XYZ');
    }
    return null;
  }

  cancelMotion(): boolean {
    if (!this.drag && !this.pendingPort) return false;
    this.drag = null;
    this.pendingPort = null;
    this.downClient = null;
    this.controls.enabled = true;
    const captured = this.capturedPointer;
    this.capturedPointer = null;
    if (captured !== null && this.renderer.domElement.hasPointerCapture(captured)) {
      this.renderer.domElement.releasePointerCapture(captured);
    }
    this.boxDiv.style.display = 'none';
    this.clearPreview();
    this.hooks.onDragInfo(null);
    this.hooks.onTransformCancel();
    this.rebuild();
    return true;
  }

  private onCancel = (ev: PointerEvent) => {
    if (!ev.isPrimary || (this.capturedPointer !== null && ev.pointerId !== this.capturedPointer)) return;
    this.downClient = null;
    this.cancelMotion();
  };

  private onBlur = () => { this.cancelMotion(); };

  private hoveredPort: string | null = null;

  private updatePlacementPoint(ev: PointerEvent): THREE.Vector3 | null {
    if (!this.ghost) return null;
    const point = this.groundPoint(ev);
    this.ghost.visible = point !== null;
    if (!point) return null;
    if (this.snapOn) {
      point.x = Math.round(point.x / SNAP_STEP) * SNAP_STEP;
      point.z = Math.round(point.z / SNAP_STEP) * SNAP_STEP;
    }
    this.ghost.position.set(point.x, 0, point.z);
    return this.ghost.position;
  }

  private onMove = (ev: PointerEvent) => {
    if (!ev.isPrimary || (this.capturedPointer !== null && ev.pointerId !== this.capturedPointer)) return;
    if (this.ghost) {
      this.updatePlacementPoint(ev);
      return;
    }
    if (this.drag) {
      const dx = ev.clientX - this.drag.startClient[0];
      const dy = ev.clientY - this.drag.startClient[1];
      if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
      if (this.drag.kind === 'box') {
        const r = this.container.getBoundingClientRect();
        const x0 = Math.min(this.drag.startClient[0], ev.clientX) - r.left;
        const y0 = Math.min(this.drag.startClient[1], ev.clientY) - r.top;
        const w = Math.abs(dx), h = Math.abs(dy);
        Object.assign(this.boxDiv.style, { display: 'block', left: `${x0}px`, top: `${y0}px`, width: `${w}px`, height: `${h}px` });
        return;
      }
      if (!this.drag.moved) return;
      if (this.drag.kind === 'rotate') {
        const inst = this.state.instances.find((i) => i.uid === this.drag!.uid);
        const e = this.entries.get(this.drag.uid);
        if (!inst || !e) return;
        const ry = this.drag.startRot[1] + dx * 0.01;
        const rx = this.drag.startRot[0] + dy * 0.01;
        const snapA = this.snapOn ? Math.PI / 12 : 0;
        const fy = snapA ? Math.round(ry / snapA) * snapA : ry;
        const fx = snapA ? Math.round(rx / snapA) * snapA : rx;
        // 一个指针事件若要求跳过大段旋转，不能用四元数的最短弧替代该动作。
        const angularStep = Math.abs(fx - e.group.rotation.x) + Math.abs(fy - e.group.rotation.y);
        if (angularStep > Math.PI / 2) {
          this.hooks.onDragInfo('旋转幅度过大，请分段转动。');
          return;
        }
        const item: TransformItem = { uid: inst.uid, pos: inst.pos, rot: [fx, fy, inst.rot[2]] };
        const blocked = this.previewTransform([item], true);
        this.hooks.onDragInfo(blocked ?? `旋转 X ${Math.round((fx * 180) / Math.PI)}° · Y ${Math.round((fy * 180) / Math.PI)}°`);
        return;
      }
      const p = this.groundPoint(ev, this.drag.plane);
      if (!p) return;
      const delta = p.clone().sub(this.drag.startWorld);
      if (this.axis === 'x') { delta.y = 0; delta.z = 0; }
      else if (this.axis === 'y') { delta.x = 0; delta.z = 0; }
      else if (this.axis === 'z') { delta.x = 0; delta.y = 0; }
      if (this.snapOn) {
        delta.x = Math.round(delta.x / SNAP_STEP) * SNAP_STEP;
        delta.y = Math.round(delta.y / SNAP_STEP) * SNAP_STEP;
        delta.z = Math.round(delta.z / SNAP_STEP) * SNAP_STEP;
      }
      const items: TransformItem[] = [];
      for (const uid of this.drag.uids) {
        const sp = this.drag.startPos.get(uid);
        const e = this.entries.get(uid);
        if (!sp || !e) continue;
        items.push({ uid, pos: [sp[0] + delta.x, sp[1] + delta.y, sp[2] + delta.z], rot: e.inst.rot });
      }
      const blocked = this.previewTransform(items, this.drag.solo);
      const mm = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}`;
      this.hooks.onDragInfo(blocked ?? `位移 X ${mm(delta.x)} · Y ${mm(delta.y)} · Z ${mm(delta.z)} mm${this.drag.solo ? '（单独移动，将断开连接）' : `（整体 ${this.drag.uids.length} 件）`}`);
      return;
    }
    const port = this.pickPort(ev);
    const key = port ? `${port.uid}|${port.port}` : null;
    if (key !== this.hoveredPort) {
      this.hoveredPort = key;
      this.hooks.onPortHover(port);
    }
    /* 悬停提示 */
    const hit = this.pickUid(ev);
    const uid = hit?.uid ?? null;
    if (uid !== this.hoverUid) {
      this.hoverUid = uid;
      this.applyHighlight();
      if (uid) {
        const inst = this.state.instances.find((i) => i.uid === uid);
        const part = inst ? partById(inst.partId) : undefined;
        this.hooks.onHover(part ? `${part.name} · DN${inst!.spec.dn}` : null);
      } else this.hooks.onHover(null);
    }
  };

  private onUp = (ev: PointerEvent) => {
    if (!ev.isPrimary || (this.capturedPointer !== null && ev.pointerId !== this.capturedPointer)) return;
    const down = this.downClient;
    this.downClient = null;
    if (this.pendingPort) {
      const port = this.pendingPort;
      this.pendingPort = null;
      this.controls.enabled = true;
      const dist = down ? Math.abs(ev.clientX - down[0]) + Math.abs(ev.clientY - down[1]) : 0;
      if (dist < 6) this.hooks.onPortPick(port);
      return;
    }
    if (this.ghost) {
      if (!down || Math.abs(ev.clientX - down[0]) + Math.abs(ev.clientY - down[1]) >= 6) return;
      const point = this.updatePlacementPoint(ev);
      if (point) this.hooks.onPlace(point.toArray());
      return;
    }
    if (!this.drag) {
      /* 空点击：清除选择 */
      const dist = down ? Math.abs(ev.clientX - down[0]) + Math.abs(ev.clientY - down[1]) : 0;
      if (dist < 6 && !ev.shiftKey) {
        const hit = this.pickUid(ev);
        if (hit) this.hooks.onSelect([hit.uid], ev.ctrlKey || ev.metaKey);
        else this.hooks.onSelect([], false);
      }
      return;
    }
    const drag = this.drag;
    this.drag = null;
    this.controls.enabled = true;
    this.hooks.onDragInfo(null);
    this.capturedPointer = null;
    if (this.renderer.domElement.hasPointerCapture(ev.pointerId)) this.renderer.domElement.releasePointerCapture(ev.pointerId);
    if (drag.kind === 'box') {
      this.boxDiv.style.display = 'none';
      if (!drag.moved) { this.hooks.onSelect([], false); return; }
      const r = this.renderer.domElement.getBoundingClientRect();
      const x0 = Math.min(drag.startClient[0], ev.clientX), x1 = Math.max(drag.startClient[0], ev.clientX);
      const y0 = Math.min(drag.startClient[1], ev.clientY), y1 = Math.max(drag.startClient[1], ev.clientY);
      const picked: string[] = [];
      for (const [uid, e] of this.entries) {
        if (!e.group.visible) continue;
        const c = new THREE.Box3().setFromObject(e.group).getCenter(new THREE.Vector3()).project(this.camera);
        const sx = r.left + ((c.x + 1) / 2) * r.width;
        const sy = r.top + ((1 - c.y) / 2) * r.height;
        if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1 && c.z < 1) picked.push(uid);
      }
      this.hooks.onBoxSelect(picked);
      return;
    }
    const canvasBounds = this.renderer.domElement.getBoundingClientRect();
    if (ev.clientX < canvasBounds.left || ev.clientX > canvasBounds.right ||
        ev.clientY < canvasBounds.top || ev.clientY > canvasBounds.bottom) {
      this.hooks.onTransformCancel();
      this.rebuild();
      return;
    }
    if (!drag.moved) {
      this.hooks.onSelect([drag.uid], ev.ctrlKey || ev.metaKey);
      this.rebuild();
      return;
    }
    this.hooks.onTransformEnd();
  };

  private onLeave = () => {
    if (this.hoveredPort) {
      this.hoveredPort = null;
      this.hooks.onPortHover(null);
    }
    if (this.hoverUid) {
      this.hoverUid = null;
      this.applyHighlight();
      this.hooks.onHover(null);
    }
  };

  /* ============ 主循环 ============ */

  private tick = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.controls.update();
    this.animateDemos(dt);
    this.animateFlow(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private animateDemos(dt: number) {
    const k = Math.min(1, dt * 6);
    for (const [uid, e] of this.entries) {
      const inst = e.inst;
      const part = partById(inst.partId);
      if (!part?.demo) continue;
      const open = inst.open !== false;
      const inFlow = this.demoOn;
      if (part.demo === 'ball') {
        const pivot = e.group.getObjectByName('pivot');
        if (pivot) {
          const target = open ? Math.PI / 2 : 0;
          pivot.rotation.y += (target - pivot.rotation.y) * k;
        }
      } else if (part.demo === 'gate') {
        const gate = e.group.getObjectByName('demo-gate');
        if (gate) {
          if (gate.userData.baseY === undefined) gate.userData.baseY = gate.position.y;
          const lift = Math.max(0.5, inst.spec.dn * 0.011);
          const target = (gate.userData.baseY as number) + (open ? lift : 0);
          gate.position.y += (target - gate.position.y) * k;
        }
      } else if (part.demo === 'check') {
        const pivot = e.group.getObjectByName('pivot');
        if (pivot) {
          const target = inFlow ? -0.7 + Math.sin(this.clock.elapsedTime * 2.2) * 0.08 : 0;
          pivot.rotation.z += (target - pivot.rotation.z) * k;
        }
      } else if (part.demo === 'impeller') {
        const pivot = e.group.getObjectByName('pivot');
        if (pivot && inFlow) pivot.rotation.x += dt * 7;
      } else if (part.demo === 'level') {
        const liquid = e.group.getObjectByName('demo-liquid');
        if (liquid && inFlow) {
          const s = 7 + Math.sin(this.clock.elapsedTime * 0.7) * 2.2;
          liquid.scale.y = s;
          liquid.position.y = 8.5 + s / 2;
        }
      }
      void uid;
    }
  }

  private animateFlow(dt: number) {
    if (!this.flowPoints || !this.flowPts) return;
    this.flowT = (this.flowT + dt * 0.12) % 1;
    const attr = this.flowPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const N = attr.count;
    for (let i = 0; i < N; i++) {
      const t = (this.flowT + i / N) % 1;
      const p = this.flowAt(t);
      attr.setXYZ(i, p.x, p.y, p.z);
    }
    attr.needsUpdate = true;
  }

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onCancel);
    el.removeEventListener('lostpointercapture', this.onCancel);
    window.removeEventListener('blur', this.onBlur);
    el.removeEventListener('pointerleave', this.onLeave);
    el.removeEventListener('contextmenu', this.onCtx);
    this.cancelPlacement(false);
    this.setReference(null);
    this.clearPreview();
    this.setFlowPositions(null);
    this.setPortMarkers([]);
    for (const e of this.entries.values()) {
      e.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) (m.material as THREE.Material).dispose();
      });
    }
    this.entries.clear();
    this.controls.dispose();
    this.renderer.dispose();
    this.boxDiv.remove();
    el.remove();
  }
}
