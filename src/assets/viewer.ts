import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { UploadAsset } from './registry';

export interface SelectedInfo {
  name: string;
  material: string;
  tris: number;
  size: [number, number, number];
}

export interface ViewerCallbacks {
  onSelect: (info: SelectedInfo | null) => void;
  onStatus: (text: string) => void;
  onProgress: (pct: number) => void;
  onReady: (stats: { meshes: number; tris: number; materials: number }) => void;
  onError: (msg: string) => void;
}

interface MeshRecord {
  mesh: THREE.Mesh;
  basePos: THREE.Vector3;
  dir: THREE.Vector3;
  mats: THREE.MeshStandardMaterial[];
  base: {
    emissive: number;
    emissiveIntensity: number;
    transparent: boolean;
    opacity: number;
    wireframe: boolean;
    side: THREE.Side;
    depthWrite: boolean;
    clippingPlanes: THREE.Plane[] | null;
  }[];
}

const ACCENT = 0x1677ff;

export class AssetViewer {
  private container: HTMLElement;
  private cb: ViewerCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  private resizeObs: ResizeObserver;
  private root = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private records: MeshRecord[] = [];
  private selected: THREE.Mesh | null = null;
  private selectedBase: number | null = null;
  private modelSize = new THREE.Vector3(1, 1, 1);
  private modelBox = new THREE.Box3();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private downAt = { x: 0, y: 0, t: 0 };
  private cutPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  private cutHelper: THREE.Mesh;
  private cutAxis: 'x' | 'y' | 'z' = 'x';
  private cutT = 0.5;
  private cutOn = false;
  private xrayOn = false;
  private wireOn = false;
  private explodeT = 0;
  private loadingId = 0;

  constructor(container: HTMLElement, cb: ViewerCallbacks) {
    this.container = container;
    this.cb = cb;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.renderer.localClippingEnabled = true;
    this.renderer.domElement.className = 'asset-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x0d141d);
    this.scene.fog = new THREE.Fog(0x0d141d, 30, 70);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 120);
    this.camera.position.set(4.2, 3.2, 5.2);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 18;
    this.controls.target.set(0, 1, 0);

    const hemi = new THREE.HemisphereLight(0xe8f2ff, 0x1a2633, 0.72);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.75);
    key.position.set(5, 8, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 40;
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -8;
    key.shadow.bias = -0.0004;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x9cc4ff, 0.4);
    fill.position.set(-6, 4, -5);
    this.scene.add(fill);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(env, 0.04).texture;
    pmrem.dispose();

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(14, 64),
      new THREE.MeshStandardMaterial({ color: 0x111b26, roughness: 0.92, metalness: 0.05 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.002;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(28, 28, 0x2a4056, 0x1b2a3a);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.6;
    this.scene.add(grid);

    this.cutHelper = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false })
    );
    this.cutHelper.visible = false;
    this.scene.add(this.cutHelper);

    this.scene.add(this.root);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointerleave', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    this.loop();
  }

  async load(asset: UploadAsset) {
    const id = ++this.loadingId;
    this.clearModel();
    this.cb.onStatus('正在下载外观模型…');
    this.cb.onProgress(2);
    try {
      await MeshoptDecoder.ready;
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync(asset.file, (ev) => {
        if (ev.total) this.cb.onProgress(Math.min(96, Math.round((ev.loaded / ev.total) * 90) + 2));
      });
      if (id !== this.loadingId || this.disposed) return;
      this.model = gltf.scene;
      this.prepareModel();
      this.cb.onProgress(100);
      this.cb.onStatus('');
    } catch (err) {
      if (id !== this.loadingId || this.disposed) return;
      console.error(err);
      this.cb.onStatus('');
      this.cb.onError('模型加载失败，请确认网络后重试。');
    }
  }

  private prepareModel() {
    if (!this.model) return;
    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const scale = 2.5 / maxDim;
    this.model.position.set(-center.x, -box.min.y, -center.z);
    this.root.scale.setScalar(scale);
    this.root.add(this.model);
    this.root.updateMatrixWorld(true);

    this.modelBox.setFromObject(this.root);
    this.modelSize.copy(this.modelBox.getSize(new THREE.Vector3()));

    let meshes = 0;
    let tris = 0;
    const matSet = new Set<string>();
    this.records = [];
    this.model.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      meshes++;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const geo = mesh.geometry as THREE.BufferGeometry;
      const index = geo.getIndex();
      tris += index ? index.count / 3 : (geo.getAttribute('position')?.count || 0) / 3;
      const src = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
      const mats = src.map((m) => {
        matSet.add(m.name || '未命名材质');
        const c = m.clone() as THREE.MeshStandardMaterial;
        if (c.isMeshStandardMaterial) {
          c.envMapIntensity = 0.5;
          if (c.roughness < 0.4) c.roughness = 0.4;
          if (c.metalness > 0.85) c.metalness = 0.85;
        }
        return c;
      });
      mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
      const worldCenter = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
      const dirWorld = worldCenter.clone();
      if (dirWorld.lengthSq() < 1e-8) dirWorld.set(0, 1, 0);
      dirWorld.normalize();
      const parent = mesh.parent || this.model!;
      const localCenter = parent.worldToLocal(worldCenter.clone());
      const localAhead = parent.worldToLocal(worldCenter.clone().add(dirWorld.clone().multiplyScalar(Math.max(this.modelSize.length(), 0.5))));
      const dirLocal = localAhead.sub(localCenter);
      if (dirLocal.lengthSq() < 1e-8) dirLocal.set(0, 1, 0);
      dirLocal.normalize();
      this.records.push({
        mesh,
        basePos: mesh.position.clone(),
        dir: dirLocal,
        mats,
        base: mats.map((m) => ({
          emissive: m.emissive ? m.emissive.getHex() : 0,
          emissiveIntensity: m.emissiveIntensity ?? 0,
          transparent: m.transparent,
          opacity: m.opacity,
          wireframe: m.wireframe,
          side: m.side,
          depthWrite: m.depthWrite,
          clippingPlanes: m.clippingPlanes
        }))
      });
    });

    this.cb.onReady({ meshes, tris: Math.round(tris), materials: matSet.size });
    this.applyCut();
    this.applyExplode();
    this.applyXray();
    this.applyWireframe();
    this.resetView();
  }

  resetView() {
    const h = this.modelSize.y || 2;
    const maxDim = Math.max(this.modelSize.x, this.modelSize.y, this.modelSize.z);
    this.camera.position.set(maxDim * 0.95, h * 0.72 + maxDim * 0.26, maxDim * 1.12);
    this.controls.target.set(0, h * 0.42, 0);
    this.controls.update();
  }

  fitView() {
    this.resetView();
  }

  setAutoRotate(on: boolean) {
    this.controls.autoRotate = on;
    this.controls.autoRotateSpeed = 1.1;
  }

  setWireframe(on: boolean) {
    this.wireOn = on;
    this.applyWireframe();
  }

  setXray(on: boolean) {
    this.xrayOn = on;
    this.applyXray();
  }

  setExplode(t: number) {
    this.explodeT = Math.max(0, Math.min(1, t));
    this.applyExplode();
  }

  setCutAxis(axis: 'x' | 'y' | 'z') {
    this.cutAxis = axis;
    this.applyCut();
  }

  setCut(t: number, on: boolean) {
    this.cutT = Math.max(0, Math.min(1, t));
    this.cutOn = on;
    this.applyCut();
  }

  hideSelected() {
    if (this.selected) {
      this.selected.visible = false;
      this.select(null);
    }
  }

  showAll() {
    for (const r of this.records) r.mesh.visible = true;
  }

  private applyWireframe() {
    for (const r of this.records) {
      for (const m of r.mats) {
        m.wireframe = this.wireOn;
        m.needsUpdate = true;
      }
    }
  }

  private applyXray() {
    for (const r of this.records) {
      r.mats.forEach((m, i) => {
        const b = r.base[i];
        if (this.xrayOn) {
          m.transparent = true;
          m.opacity = 0.2;
          m.depthWrite = false;
          m.side = THREE.DoubleSide;
        } else {
          m.transparent = b.transparent;
          m.opacity = b.opacity;
          m.depthWrite = b.depthWrite;
          m.side = b.side;
        }
        m.needsUpdate = true;
      });
    }
  }

  private applyExplode() {
    const dist = Math.max(this.modelSize.length() * 0.35, 0.2);
    for (const r of this.records) {
      r.mesh.position.copy(r.basePos).addScaledVector(r.dir, dist * this.explodeT);
    }
    this.root.updateMatrixWorld(true);
  }

  private applyCut() {
    const axis = this.cutAxis;
    const center = this.modelBox.getCenter(new THREE.Vector3());
    const size = this.modelSize;
    const pos = center[axis] + (this.cutT - 0.5) * size[axis];
    const normal = new THREE.Vector3(axis === 'x' ? -1 : 0, axis === 'y' ? -1 : 0, axis === 'z' ? -1 : 0);
    this.cutPlane.normal.copy(normal);
    this.cutPlane.constant = pos;
    const planes = this.cutOn ? [this.cutPlane] : null;
    for (const r of this.records) {
      r.mats.forEach((m, i) => {
        m.clippingPlanes = planes;
        m.clipShadows = true;
        if (this.cutOn && !this.xrayOn) m.side = THREE.DoubleSide;
        else if (!this.xrayOn) m.side = r.base[i].side;
        m.needsUpdate = true;
      });
    }
    const maxOther = Math.max(size.x, size.y, size.z) * 1.2;
    this.cutHelper.visible = this.cutOn;
    if (this.cutOn) {
      this.cutHelper.position.set(0, 0, 0);
      this.cutHelper.rotation.set(0, 0, 0);
      this.cutHelper.scale.set(maxOther, maxOther, 1);
      if (axis === 'x') {
        this.cutHelper.position.x = pos;
        this.cutHelper.rotation.y = Math.PI / 2;
      } else if (axis === 'y') {
        this.cutHelper.position.y = pos;
        this.cutHelper.rotation.x = -Math.PI / 2;
      } else {
        this.cutHelper.position.z = pos;
      }
    }
  }

  private select(mesh: THREE.Mesh | null) {
    if (this.selected === mesh) return;
    if (this.selected) {
      const rec = this.records.find((r) => r.mesh === this.selected);
      if (rec) {
        rec.mats.forEach((m, i) => {
          m.emissive.setHex(rec.base[i].emissive);
          m.emissiveIntensity = rec.base[i].emissiveIntensity;
        });
      }
    }
    this.selected = mesh;
    if (!mesh) {
      this.cb.onSelect(null);
      return;
    }
    const rec = this.records.find((r) => r.mesh === mesh);
    if (!rec) return;
    rec.mats.forEach((m) => {
      m.emissive.setHex(ACCENT);
      m.emissiveIntensity = 0.55;
    });
    const geo = mesh.geometry as THREE.BufferGeometry;
    const index = geo.getIndex();
    const tris = Math.round((index ? index.count : geo.getAttribute('position')?.count || 0) / 3);
    const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
    const mat = rec.mats[0];
    this.cb.onSelect({
      name: mesh.name || '未命名网格',
      material: mat?.name || '未命名材质',
      tris,
      size: [size.x, size.y, size.z]
    });
  }

  private onDown = (ev: PointerEvent) => {
    this.downAt = { x: ev.clientX, y: ev.clientY, t: performance.now() };
  };

  private onUp = (ev: PointerEvent) => {
    if (!this.model) return;
    const dx = ev.clientX - this.downAt.x;
    const dy = ev.clientY - this.downAt.y;
    if (Math.hypot(dx, dy) > 6 || performance.now() - this.downAt.t > 700) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.root, true).filter((h) => (h.object as THREE.Mesh).isMesh);
    if (!hits.length) {
      this.select(null);
      return;
    }
    this.select(hits[0].object as THREE.Mesh);
  };

  private resize() {
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.clock.getDelta();
  };

  private clearModel() {
    if (this.model) {
      this.root.remove(this.model);
      this.model.traverse((o) => {
        const me = o as THREE.Mesh;
        if (me.isMesh) {
          me.geometry?.dispose();
          const mats = Array.isArray(me.material) ? me.material : [me.material];
          for (const m of mats) m.dispose();
        }
      });
      this.model = null;
    }
    this.records = [];
    this.selected = null;
    this.cb.onSelect(null);
    this.cutOn = false;
    this.xrayOn = false;
    this.wireOn = false;
    this.explodeT = 0;
    this.cutHelper.visible = false;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.clearModel();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointerleave', this.onUp);
    el.removeEventListener('pointercancel', this.onUp);
    this.controls.dispose();
    this.cutHelper.geometry.dispose();
    (this.cutHelper.material as THREE.Material).dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    el.remove();
  }
}
