import { InternalsView } from '../engine/boilInternals';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BOIL_MODELS, BOIL_MODEL_KEYS, buildBoilModel, getBoilModelBounds } from '../engine/boilModels';
import { buildPipingRoutes } from '../engine/boilPiping';
import { createBoilFluidOverlay, type BoilFluidOverlay, type BoilFluidStats } from '../engine/boilFluid';
import { BOIL_PROCESS } from '../data/boilProcess';
import { BOIL_KEEPOUTS, BOIL_LAYOUT } from '../data/boilLayout';
import { computeBoilFluid, type BoilPipeFlow } from '../process/fluid';
import {
  equipmentFlowLinks,
  validateProcessAreas,
  type ProcessAreaModel,
  type ProcessAreaValidation
} from '../process/areas';
import {
  BOIL_PIPE_SIZES,
  validatePiping,
  type PipingModelSpec,
  type PipingValidationCounts,
  type PipeRouteResult
} from '../process/piping';

export interface BoilRouteReport {
  pipelineId: string;
  name: string;
  medium: string;
  mediumLabel: string;
  sizeLabel: string;
  length: number;
  elbows: number;
  valves: number;
  valveKind: string;
  supports: number;
  flanges: number;
  fromPortKey: string;
  toPortKey: string;
}

export type BoilViewMode = 'overview' | 'area' | 'equipment' | 'pipeline';

export interface BoilSelectionState {
  mode: BoilViewMode;
  areaId: string | null;
  equipmentId: string | null;
  pipelineId: string | null;
}

/** Phase 6 追踪/播放叠加态；不改变基础选择，只叠加高亮、流体范围与镜头。 */
export type BoilOverlayKind = 'trace' | 'playback';

export interface BoilOverlaySpec {
  kind: BoilOverlayKind;
  currentEquipmentIds?: string[];
  upstreamEquipmentIds?: string[];
  downstreamEquipmentIds?: string[];
  branchEquipmentIds?: string[];
  completedEquipmentIds?: string[];
  currentPipelineIds?: string[];
  upstreamPipelineIds?: string[];
  downstreamPipelineIds?: string[];
  completedPipelineIds?: string[];
  activePipelineIds?: string[];
  focusEquipmentIds?: string[];
  flowScope?: string[] | null;
  areaId?: string | null;
}

export interface BoilOverlayInfo {
  kind: BoilOverlayKind | null;
  currentEquipmentIds: string[];
  upstreamEquipmentIds: string[];
  downstreamEquipmentIds: string[];
  branchEquipmentIds: string[];
  completedEquipmentIds: string[];
  currentPipelineIds: string[];
  activePipelineIds: string[];
  focusEquipmentIds: string[];
  flowScopeCount: number | null;
  branchLinksVisible: boolean;
  paused: boolean;
}

interface MaterialRuntime {
  material: THREE.Material;
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
  emissive: THREE.Color | null;
  emissiveIntensity: number;
}

interface GroupVisual {
  root: THREE.Object3D;
  materials: MaterialRuntime[];
}

interface CameraTween {
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  control: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  start: number;
  duration: number;
  near: number;
  far: number;
  pausedAt: number | null;
}

interface AreaFrameVisual {
  line: THREE.LineLoop;
  material: THREE.LineBasicMaterial;
  label: THREE.Sprite;
}

interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  near: number;
  far: number;
}

const OVERVIEW: BoilSelectionState = {
  mode: 'overview',
  areaId: null,
  equipmentId: null,
  pipelineId: null
};
const HIGHLIGHT_EQUIPMENT = new THREE.Color(0x4ea1ff);
const HIGHLIGHT_PIPELINE = new THREE.Color(0x38bdf8);
const HIGHLIGHT_AREA = new THREE.Color(0x1d4ed8);
const HIGHLIGHT_CURRENT = new THREE.Color(0x7dd3fc);
const HIGHLIGHT_UPSTREAM = new THREE.Color(0xfbbf24);
const HIGHLIGHT_DOWNSTREAM = new THREE.Color(0x34d399);
const HIGHLIGHT_BRANCH = new THREE.Color(0xd8739a);
const HIGHLIGHT_COMPLETED = new THREE.Color(0x2f9e7a);
const DIM_OPACITY = 0.16;

function collectMaterials(root: THREE.Object3D): MaterialRuntime[] {
  const cache = new Map<string, THREE.Material>();
  const states: MaterialRuntime[] = [];
  const register = (material: THREE.Material): THREE.Material => {
    const cached = cache.get(material.uuid);
    if (cached) return cached;
    const clone = material.clone();
    cache.set(material.uuid, clone);
    const standard = clone as THREE.MeshStandardMaterial;
    const hasEmissive = Boolean(standard.emissive);
    states.push({
      material: clone,
      opacity: clone.opacity,
      transparent: clone.transparent,
      depthWrite: clone.depthWrite,
      emissive: hasEmissive ? standard.emissive.clone() : null,
      emissiveIntensity: typeof standard.emissiveIntensity === 'number' ? standard.emissiveIntensity : 0
    });
    return clone;
  };
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((material) => register(material));
    } else if (mesh.material) {
      mesh.material = register(mesh.material);
    }
  });
  return states;
}

function styleMaterial(state: MaterialRuntime, dim: boolean, highlight: THREE.Color | null): void {
  const material = state.material;
  if (dim) {
    material.transparent = true;
    material.opacity = Math.max(0.05, state.opacity * DIM_OPACITY);
    material.depthWrite = false;
    if (state.emissive) {
      const standard = material as THREE.MeshStandardMaterial;
      standard.emissive.copy(state.emissive);
      standard.emissiveIntensity = 0;
    }
  } else {
    material.transparent = state.transparent;
    material.opacity = state.opacity;
    material.depthWrite = state.depthWrite;
    if (state.emissive) {
      const standard = material as THREE.MeshStandardMaterial;
      standard.emissive.copy(highlight ?? state.emissive);
      standard.emissiveIntensity = highlight ? 0.62 : state.emissiveIntensity;
    }
  }
  material.needsUpdate = true;
}

function disposeObject(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    const renderable = object as THREE.Mesh & THREE.Line & THREE.Points & THREE.Sprite;
    if (renderable.geometry) renderable.geometry.dispose();
    const material = renderable.material;
    const list = Array.isArray(material) ? material : material ? [material] : [];
    for (const item of list) {
      const map = (item as THREE.SpriteMaterial).map;
      if (map && !textures.has(map)) {
        textures.add(map);
        map.dispose();
      }
      item.dispose();
    }
  });
}

/**
 * 微沸喷烧 Phase 5 教学场景。
 *
 * 在 Phase 3（设备布局 + 工业管道）与 Phase 4（流体示踪）之上增加：
 * - 五个工艺区域的三维范围、区域高亮/弱化；
 * - 设备/管线拾取与平滑镜头定位；
 * - 区域、设备、管线的关联流体显示。
 * 所有区域/设备关系来自 BOIL_PROCESS 与 process/areas.ts，场景不手写关系；
 * 切换区域只更新材质与镜头，不重建场景。
 */
export class BoilScene {
  readonly validation: ReturnType<typeof validatePiping>;
  readonly counts: PipingValidationCounts;
  readonly routeReports: BoilRouteReport[];
  readonly equipmentCount: number;
  readonly pendingPorts: number;
  readonly boundaryPorts: number;
  readonly areaValidation: ProcessAreaValidation;
  readonly areas: ProcessAreaModel[];

  private readonly container: HTMLElement;
  private readonly onChange: (state: BoilSelectionState) => void;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly content = new THREE.Group();
  private readonly modelRoot = new THREE.Group();
  private readonly labelRoot = new THREE.Group();
  private readonly areaFrameRoot = new THREE.Group();
  private readonly equipmentLabelGroup = new THREE.Group();
  private readonly pipeLabelGroup = new THREE.Group();
  private readonly pendingLabelGroup = new THREE.Group();
  private readonly areaLabelGroup = new THREE.Group();
  private readonly equipmentHolders = new Map<string, THREE.Object3D>();
  private readonly equipmentVisuals = new Map<string, GroupVisual>();
  private readonly equipmentLabels = new Map<string, THREE.Sprite>();
  private readonly pipelineGroups = new Map<string, THREE.Group>();
  private readonly pipelineVisuals = new Map<string, GroupVisual>();
  private readonly pipeLabels = new Map<string, THREE.Sprite>();
  private readonly pendingLabels = new Map<string, THREE.Sprite>();
  private readonly areaFrames = new Map<string, AreaFrameVisual>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly resizeObserver: ResizeObserver;
  private readonly disposeFns: (() => void)[] = [];
  private readonly fluid: BoilFluidOverlay;
  private readonly cameraTarget = new THREE.Vector3();
  private readonly areaByEquipmentId = new Map<string, string>();
  private readonly branchLinkGroup = new THREE.Group();
  private readonly branchLinkLabelGroup = new THREE.Group();
  private readonly branchParentIds = new Set<string>();
  private readonly branchChildIds = new Set<string>();
  private readonly frameListeners = new Set<(dt: number) => void>();
  private selection: BoilSelectionState = { ...OVERVIEW };
  private visualStats = { highlightedEquipment: 0, dimmedEquipment: 0, highlightedPipelines: 0, dimmedPipelines: 0 };
  private overlay: BoilOverlaySpec | null = null;
  private overlayPicker: ((kind: 'equipment' | 'pipeline', id: string) => void) | null = null;
  private baseFlows: Record<string, BoilPipeFlow> = {};
  private flowScopeKey = 'all';
  private fanView: InternalsView | null = null;
  private fanOutletOn = true;
  private playbackPaused = false;
  private tween: CameraTween | null = null;
  private frame = 0;
  private labelsOn = true;
  private disposed = false;
  private inspecting = false;
  private downX = 0;
  private downY = 0;
  private sceneTop = 12;
  private lastFrame = performance.now();
  private buildCount = 1;

  constructor(container: HTMLElement, onChange: (state: BoilSelectionState) => void) {
    this.container = container;
    this.onChange = onChange;
    const specs: Record<string, PipingModelSpec> = {};
    for (const key of BOIL_MODEL_KEYS) {
      const def = BOIL_MODELS[key];
      specs[key] = {
        key,
        bbox: getBoilModelBounds(key),
        ports: def.ports.map((port) => ({
          id: port.id,
          pos: port.pos,
          dir: port.dir,
          size: port.size,
          role: port.role,
          media: port.media,
          boundary: port.boundary
        }))
      };
    }
    this.validation = validatePiping(BOIL_PROCESS, (key) => specs[key], {}, BOIL_LAYOUT, BOIL_KEEPOUTS);
    this.counts = this.validation.counts;
    this.equipmentCount = this.validation.world.equipment.length;
    this.pendingPorts = this.counts.pendingPorts;
    this.boundaryPorts = this.counts.boundaryPorts;
    this.routeReports = this.validation.routes.map((route) => this.reportOf(route));
    this.areaValidation = validateProcessAreas(BOIL_PROCESS, this.validation.world);
    this.areas = this.areaValidation.areas;
    for (const area of this.areas) {
      for (const equipment of area.equipment) this.areaByEquipmentId.set(equipment.id, area.def.id);
    }

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b131b);
    this.scene.fog = new THREE.Fog(0x0b131b, 130, 360);

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 800);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = 'boil-canvas';
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    this.scene.add(new THREE.HemisphereLight(0xbfd6ff, 0x2a3038, 1.15));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
    keyLight.position.set(30, 52, 28);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 220;
    keyLight.shadow.camera.left = -70;
    keyLight.shadow.camera.right = 70;
    keyLight.shadow.camera.top = 60;
    keyLight.shadow.camera.bottom = -60;
    this.scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x88aaff, 0.7);
    fillLight.position.set(-40, 24, -30);
    this.scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0xffd7a0, 0.35);
    rimLight.position.set(0, 18, -60);
    this.scene.add(rimLight);

    const grid = new THREE.GridHelper(150, 75, 0x3a4c60, 0x263342);
    grid.position.set(42, -0.01, 0);
    this.scene.add(grid);

    this.labelRoot.add(
      this.equipmentLabelGroup,
      this.pipeLabelGroup,
      this.pendingLabelGroup,
      this.areaLabelGroup
    );
    this.content.add(this.modelRoot, this.areaFrameRoot, this.labelRoot);
    this.scene.add(this.content);
    this.buildScene();

    const mediumColors = Object.fromEntries(BOIL_PROCESS.media.map((medium) => [medium.id, medium.color]));
    this.fluid = createBoilFluidOverlay(this.validation.routes, mediumColors);
    this.baseFlows = computeBoilFluid(BOIL_PROCESS, this.validation.routes, {}).flows;
    this.fluid.setFlows(this.baseFlows);
    this.modelRoot.add(this.fluid.group);

    this.buildBranchLinks();
    this.applyVisualState();
    this.syncLabelVisibility();
    this.fitView(false, false);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.addPointerListeners();
    this.animate();
  }

  private reportOf(route: PipeRouteResult): BoilRouteReport {
    const medium = BOIL_PROCESS.media.find((item) => item.id === route.medium);
    const valveKind = route.valves[0]?.kind === 'gate' ? '闸阀' : route.valves[0]?.kind === 'butterfly' ? '蝶阀' : '—';
    return {
      pipelineId: route.pipelineId,
      name: route.name,
      medium: route.medium,
      mediumLabel: medium?.label ?? route.medium,
      sizeLabel: BOIL_PIPE_SIZES[route.size].label,
      length: Number(route.length.toFixed(1)),
      elbows: route.bends.length,
      valves: route.valves.length,
      valveKind,
      supports: route.supports.length,
      flanges: route.terminalFlanges.length,
      fromPortKey: route.fromPortKey,
      toPortKey: route.toPortKey
    };
  }

  private buildScene(): void {
    const mediumColors = Object.fromEntries(BOIL_PROCESS.media.map((m) => [m.id, m.color]));

    for (const eq of this.validation.world.equipment) {
      const model = buildBoilModel(eq.modelKey);
      model.position.set(eq.modelOffset[0], eq.modelOffset[1], eq.modelOffset[2]);
      const holder = new THREE.Group();
      holder.position.set(eq.position[0], eq.position[1], eq.position[2]);
      holder.rotation.y = eq.rotationY;
      holder.userData.equipmentId = eq.equipmentId;
      holder.add(model);
      const materials = collectMaterials(model);
      this.modelRoot.add(holder);
      this.equipmentHolders.set(eq.equipmentId, holder);
      this.equipmentVisuals.set(eq.equipmentId, { root: holder, materials });
      this.sceneTop = Math.max(this.sceneTop, eq.modelBox.max[1] + 3);

      const label = this.makeLabel(eq.name, '#eef6ff', 0.9);
      label.position.set(
        (eq.modelBox.min[0] + eq.modelBox.max[0]) / 2,
        eq.modelBox.max[1] + 0.75,
        (eq.modelBox.min[2] + eq.modelBox.max[2]) / 2
      );
      label.userData.equipmentLabel = eq.equipmentId;
      this.equipmentLabels.set(eq.equipmentId, label);
      this.equipmentLabelGroup.add(label);
    }

    const built = buildPipingRoutes(this.validation.routes, mediumColors);
    this.modelRoot.add(built.group);
    for (const group of built.pipelines) {
      const pipelineId = group.userData.pipelineId as string;
      const materials = collectMaterials(group);
      this.pipelineGroups.set(pipelineId, group);
      this.pipelineVisuals.set(pipelineId, { root: group, materials });
    }

    const connected = new Set<string>();
    for (const route of this.validation.routes) {
      connected.add(route.fromPortKey);
      connected.add(route.toPortKey);
      const report = reportById(this.routeReports, route.pipelineId);
      const longest = [...route.segments].sort((a, b) => b.length - a.length)[0];
      if (!longest || !report) continue;
      const mid = [
        (longest.from[0] + longest.to[0]) / 2,
        (longest.from[1] + longest.to[1]) / 2,
        (longest.from[2] + longest.to[2]) / 2
      ];
      const label = this.makeLabel(`${route.pipelineId} · ${report.mediumLabel.replace('（教学示意）', '')}`, '#dfeaf5', 0.78);
      label.position.set(mid[0], mid[1] + 0.5, mid[2]);
      label.userData.pipelineLabel = route.pipelineId;
      this.pipeLabelGroup.add(label);
      this.pipeLabels.set(route.pipelineId, label);
    }

    for (const port of this.validation.world.ports) {
      const key = `${port.equipmentId}.${port.portId}`;
      if (connected.has(key)) continue;
      const color = port.boundary ? 0x9aa6b2 : 0xd8739a;
      const material = new THREE.MeshBasicMaterial({ color, depthTest: false });
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), material);
      marker.position.set(port.world[0], port.world[1], port.world[2]);
      marker.renderOrder = 11;
      this.modelRoot.add(marker);
      const dir = new THREE.Vector3(port.dir[0], port.dir[1], port.dir[2]).normalize();
      const label = this.makeLabel(
        `${port.equipmentName} · ${port.portId} ${port.boundary ? '流程边界' : '待确认'}`,
        port.boundary ? '#c3ccd6' : '#f0a6c0',
        0.72
      );
      label.position.set(
        port.world[0] + dir.x * 0.65,
        port.world[1] + dir.y * 0.65 + 0.25,
        port.world[2] + dir.z * 0.65
      );
      label.userData.pendingLabel = key;
      this.pendingLabelGroup.add(label);
      this.pendingLabels.set(key, label);
    }

    for (const area of this.areas) {
      if (!area.bounds) continue;
      const { min, max } = area.bounds;
      const y = 0.03;
      const points = [
        new THREE.Vector3(min[0], y, min[2]),
        new THREE.Vector3(max[0], y, min[2]),
        new THREE.Vector3(max[0], y, max[2]),
        new THREE.Vector3(min[0], y, max[2])
      ];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: 0x2f6f9f,
        transparent: true,
        opacity: 0.45,
        depthWrite: false
      });
      const line = new THREE.LineLoop(geometry, material);
      line.renderOrder = 2;
      this.areaFrameRoot.add(line);
      const label = this.makeLabel(
        `${area.def.no.toString().padStart(2, '0')} ${area.def.name}`,
        '#8fd0ff',
        1.05
      );
      label.position.set(min[0] + 1.4, 0.85, max[2] + 0.55);
      label.userData.areaLabel = area.def.id;
      this.areaLabelGroup.add(label);
      this.areaFrames.set(area.def.id, { line, material, label });
    }
  }

  /**
   * 四根喷枪与二燃室的结构关联示意：虚线支路，不是已确认工艺管线。
   * 关系来自 equipment.parentEquipmentId + relationKind=parallel-branch，不手写。
   */
  private buildBranchLinks(): void {
    const world = new Map(this.validation.world.equipment.map((item) => [item.equipmentId, item]));
    this.branchLinkGroup.name = 'boil-branch-links';
    this.branchLinkGroup.visible = false;
    const material = new THREE.LineDashedMaterial({
      color: 0xd8739a,
      transparent: true,
      opacity: 0.72,
      dashSize: 0.36,
      gapSize: 0.26,
      depthWrite: false
    });
    const labelPoints: THREE.Vector3[] = [];
    for (const equipment of BOIL_PROCESS.equipment) {
      if (!equipment.parentEquipmentId || equipment.relationKind !== 'parallel-branch') continue;
      const parent = world.get(equipment.parentEquipmentId);
      const child = world.get(equipment.id);
      if (!parent || !child) continue;
      this.branchParentIds.add(parent.equipmentId);
      this.branchChildIds.add(child.equipmentId);
      const parentBox = parent.modelBox;
      const childBox = child.modelBox;
      const origin = new THREE.Vector3(
        (parentBox.min[0] + parentBox.max[0]) / 2,
        Math.max(parentBox.min[1] + 1.2, parentBox.max[1] * 0.62),
        parentBox.max[2] + 0.35
      );
      const target = new THREE.Vector3(
        (childBox.min[0] + childBox.max[0]) / 2,
        childBox.max[1] + 0.15,
        (childBox.min[2] + childBox.max[2]) / 2
      );
      const geometry = new THREE.BufferGeometry().setFromPoints([origin, target]);
      const line = new THREE.Line(geometry, material);
      line.computeLineDistances();
      line.userData.branchLink = equipment.id;
      line.renderOrder = 3;
      this.branchLinkGroup.add(line);
      labelPoints.push(target);
    }
    if (labelPoints.length > 0) {
      const center = labelPoints
        .reduce((acc, point) => acc.add(point), new THREE.Vector3())
        .multiplyScalar(1 / labelPoints.length);
      const label = this.makeLabel('四根平行支路 · 接入位置与介质待确认', '#f0a6c0', 0.72);
      label.position.set(center.x, center.y + 1.15, center.z + 0.4);
      label.userData.branchLinkLabel = true;
      this.branchLinkLabelGroup.add(label);
      this.branchLinkGroup.add(this.branchLinkLabelGroup);
    }
    this.modelRoot.add(this.branchLinkGroup);
  }

  private makeLabel(text: string, color: string, scale: number): THREE.Sprite {
    const pad = 16;
    const font = 44;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    if (!ctx) return new THREE.Sprite();
    ctx.font = `600 ${font}px "Microsoft YaHei", sans-serif`;
    const width = Math.ceil(ctx.measureText(text).width + pad * 2);
    c.width = width;
    c.height = font + pad * 2;
    const ctx2 = c.getContext('2d');
    if (!ctx2) return new THREE.Sprite();
    ctx2.font = `600 ${font}px "Microsoft YaHei", sans-serif`;
    ctx2.fillStyle = 'rgba(6, 12, 19, .8)';
    ctx2.fillRect(0, 0, c.width, c.height);
    ctx2.fillStyle = color;
    ctx2.textBaseline = 'middle';
    ctx2.fillText(text, pad, c.height / 2);
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set((c.width / c.height) * 0.5 * scale, 0.5 * scale, 1);
    sprite.userData.baseScaleX = sprite.scale.x;
    sprite.userData.baseScaleY = sprite.scale.y;
    sprite.renderOrder = 20;
    return sprite;
  }

  get state(): BoilSelectionState {
    return { ...this.selection };
  }

  get selectedPipeline(): string | null {
    return this.selection.pipelineId;
  }

  get selectedEquipment(): string | null {
    return this.selection.equipmentId;
  }

  get activeArea(): string | null {
    return this.selection.areaId;
  }

  get fluidStats(): BoilFluidStats {
    return this.fluid.stats();
  }

  /** 只读镜头状态，供页面测试与验收使用。 */
  viewInfo(): { position: number[]; target: number[]; near: number; far: number; tweening: boolean } {
    return {
      position: this.camera.position.toArray(),
      target: this.cameraTarget.toArray(),
      near: this.camera.near,
      far: this.camera.far,
      tweening: Boolean(this.tween)
    };
  }

  /** 区域分层材质状态计数，供页面测试与验收使用。 */
  visualInfo(): { highlightedEquipment: number; dimmedEquipment: number; highlightedPipelines: number; dimmedPipelines: number } {
    return { ...this.visualStats };
  }

  /** 设备中心在画布上的归一化坐标，用于自动化点选验证。 */
  screenPointOfEquipment(equipmentId: string): { x: number; y: number; z: number } | null {
    const equipment = this.validation.world.equipment.find((item) => item.equipmentId === equipmentId);
    if (!equipment) return null;
    const center = new THREE.Vector3(
      (equipment.modelBox.min[0] + equipment.modelBox.max[0]) / 2,
      (equipment.modelBox.min[1] + equipment.modelBox.max[1]) / 2,
      (equipment.modelBox.min[2] + equipment.modelBox.max[2]) / 2
    );
    const projected = center.project(this.camera);
    return { x: projected.x * 0.5 + 0.5, y: -projected.y * 0.5 + 0.5, z: projected.z };
  }

  /** 管线最长直段中点在画布上的归一化坐标，用于自动化点选验证。 */
  screenPointOfPipeline(pipelineId: string): { x: number; y: number; z: number } | null {
    const route = this.validation.routes.find((item) => item.pipelineId === pipelineId);
    if (!route) return null;
    const segment = [...route.segments].sort((a, b) => b.length - a.length)[0];
    if (!segment) return null;
    const center = new THREE.Vector3(
      (segment.from[0] + segment.to[0]) / 2,
      (segment.from[1] + segment.to[1]) / 2,
      (segment.from[2] + segment.to[2]) / 2
    );
    const projected = center.project(this.camera);
    return { x: projected.x * 0.5 + 0.5, y: -projected.y * 0.5 + 0.5, z: projected.z };
  }

  /** 查询画布归一化坐标下的拾取结果（null 表示空白），供自动化测试选空白点。 */
  pickAt(xRatio: number, yRatio: number): { kind: 'equipment' | 'pipeline'; id: string } | null {
    return this.pickAtRatio(xRatio, yRatio);
  }

  private pickAtRatio(xRatio: number, yRatio: number): { kind: 'equipment' | 'pipeline'; id: string } | null {
    this.pointer.x = xRatio * 2 - 1;
    this.pointer.y = -yRatio * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const objects: THREE.Object3D[] = [];
    for (const holder of this.equipmentHolders.values()) {
      holder.traverse((object) => {
        if ((object as THREE.Mesh).isMesh) objects.push(object);
      });
    }
    for (const group of this.pipelineGroups.values()) {
      group.traverse((object) => {
        if ((object as THREE.Mesh).isMesh) objects.push(object);
      });
    }
    const hits = this.raycaster.intersectObjects(objects, false);
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node && !node.userData.equipmentId && !node.userData.pipelineId) node = node.parent;
      if (!node) continue;
      if (node.userData.equipmentId) {
        return { kind: 'equipment', id: node.userData.equipmentId as string };
      }
      if (node.userData.pipelineId) {
        return { kind: 'pipeline', id: node.userData.pipelineId as string };
      }
    }
    return null;
  }

  /** Phase 6：叠加追踪/播放状态；不重建场景，只更新材质、流体重放范围与镜头。 */
  setOverlay(
    spec: BoilOverlaySpec,
    options: { animate?: boolean; picker?: (kind: 'equipment' | 'pipeline', id: string) => void } = {}
  ): void {
    this.overlay = {
      ...spec,
      currentEquipmentIds: [...(spec.currentEquipmentIds ?? [])],
      upstreamEquipmentIds: [...(spec.upstreamEquipmentIds ?? [])],
      downstreamEquipmentIds: [...(spec.downstreamEquipmentIds ?? [])],
      branchEquipmentIds: [...(spec.branchEquipmentIds ?? [])],
      completedEquipmentIds: [...(spec.completedEquipmentIds ?? [])],
      currentPipelineIds: [...(spec.currentPipelineIds ?? [])],
      upstreamPipelineIds: [...(spec.upstreamPipelineIds ?? [])],
      downstreamPipelineIds: [...(spec.downstreamPipelineIds ?? [])],
      completedPipelineIds: [...(spec.completedPipelineIds ?? [])],
      activePipelineIds: [...(spec.activePipelineIds ?? [])],
      focusEquipmentIds: [...(spec.focusEquipmentIds ?? [])],
      flowScope: spec.flowScope === undefined ? null : spec.flowScope ? [...spec.flowScope] : null
    };
    if (options.picker !== undefined) this.overlayPicker = options.picker;
    this.applyVisualState();
    this.syncLabelVisibility();
    this.syncFanView();
    this.applyFlowScope(this.overlay.flowScope ?? null);
    if (options.animate !== false) {
      const focus = this.overlay.focusEquipmentIds ?? [];
      if (focus.length > 0) this.focusEquipmentGroup(focus, true);
    }
  }

  clearOverlay(options: { animate?: boolean } = {}): void {
    if (!this.overlay) return;
    this.overlay = null;
    this.applyVisualState();
    this.syncLabelVisibility();
    this.syncFanView();
    this.applyFlowScope(null);
    if (options.animate === false) this.setCameraImmediate();
    else this.tweenToSelection();
  }

  get overlayState(): BoilOverlaySpec | null {
    return this.overlay ? { ...this.overlay } : null;
  }

  overlayInfo(): BoilOverlayInfo {
    const overlay = this.overlay;
    return {
      kind: overlay?.kind ?? null,
      currentEquipmentIds: [...(overlay?.currentEquipmentIds ?? [])],
      upstreamEquipmentIds: [...(overlay?.upstreamEquipmentIds ?? [])],
      downstreamEquipmentIds: [...(overlay?.downstreamEquipmentIds ?? [])],
      branchEquipmentIds: [...(overlay?.branchEquipmentIds ?? [])],
      completedEquipmentIds: [...(overlay?.completedEquipmentIds ?? [])],
      currentPipelineIds: [...(overlay?.currentPipelineIds ?? [])],
      activePipelineIds: [...(overlay?.activePipelineIds ?? [])],
      focusEquipmentIds: [...(overlay?.focusEquipmentIds ?? [])],
      flowScopeCount: overlay?.flowScope ? overlay.flowScope.length : null,
      branchLinksVisible: this.branchLinkGroup.visible,
      paused: this.playbackPaused
    };
  }

  setOverlayPicker(picker: ((kind: 'equipment' | 'pipeline', id: string) => void) | null): void {
    this.overlayPicker = picker;
  }

  /** 暂停/继续摄像机补间与流体；用于流程播放暂停。 */
  setPlaybackPaused(paused: boolean): void {
    this.playbackPaused = paused;
    this.fluid.setPaused(paused);
    if (!this.tween) return;
    if (paused && this.tween.pausedAt === null) {
      this.tween.pausedAt = performance.now();
    } else if (!paused && this.tween.pausedAt !== null) {
      this.tween.start += performance.now() - this.tween.pausedAt;
      this.tween.pausedAt = null;
    }
  }

  get animationPaused(): boolean {
    return this.playbackPaused;
  }

  addFrameListener(listener: (dt: number) => void): () => void {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  focusEquipmentGroup(equipmentIds: string[], animate = true): void {
    const box = new THREE.Box3();
    let found = 0;
    for (const id of equipmentIds) {
      const equipment = this.validation.world.equipment.find((item) => item.equipmentId === id);
      if (!equipment) continue;
      found += 1;
      box.expandByPoint(new THREE.Vector3(...equipment.modelBox.min));
      box.expandByPoint(new THREE.Vector3(...equipment.modelBox.max));
    }
    if (found === 0) return;
    if (animate) this.tweenToBox(box, 'group');
    else this.setCameraToBox(box, 'group');
  }

  perfInfo(): { buildCount: number; calls: number; triangles: number; geometries: number; textures: number } {
    return {
      buildCount: this.buildCount,
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures
    };
  }

  overview(): void {
    this.setSelection({ ...OVERVIEW }, true);
  }

  focusArea(areaId: string | null): void {
    if (!areaId) {
      this.overview();
      return;
    }
    if (!this.areas.some((area) => area.def.id === areaId)) return;
    this.setSelection({ mode: 'area', areaId, equipmentId: null, pipelineId: null }, true);
  }

  focusEquipment(equipmentId: string | null): void {
    if (!equipmentId) {
      this.overview();
      return;
    }
    const areaId = this.areaByEquipmentId.get(equipmentId);
    if (!areaId) return;
    this.setSelection({ mode: 'equipment', areaId, equipmentId, pipelineId: null }, true);
  }

  focusPipeline(pipelineId: string | null): void {
    if (!pipelineId) {
      this.overview();
      return;
    }
    const pipeline = BOIL_PROCESS.pipelines.find((item) => item.id === pipelineId);
    if (!pipeline) return;
    this.setSelection(
      { mode: 'pipeline', areaId: pipeline.areaId, equipmentId: null, pipelineId },
      true
    );
  }

  selectArea(areaId: string | null): void {
    this.focusArea(areaId);
  }

  selectEquipment(equipmentId: string | null): void {
    this.focusEquipment(equipmentId);
  }

  selectPipeline(pipelineId: string | null): void {
    this.focusPipeline(pipelineId);
  }

  clearSelection(): void {
    this.overview();
  }

  /** 兼容旧入口：重置视角并回到整厂总览。 */
  fitView(animate = true, notify = true): void {
    this.setSelection({ ...OVERVIEW }, animate, notify);
  }

  setLabelVisibility(on: boolean): void {
    this.labelsOn = on;
    this.syncLabelVisibility();
  }

  setFluidPaused(paused: boolean): void {
    this.fluid.setPaused(paused);
  }

  setFluidSpeed(speed: number): void {
    this.fluid.setSpeed(speed);
  }

  setFluidArrows(visible: boolean): void {
    this.fluid.setArrowsVisible(visible);
  }

  private setSelection(next: BoilSelectionState, animate: boolean, notify = true): void {
    this.selection = next;
    this.syncFanView();
    this.applyVisualState();
    this.syncLabelVisibility();
    if (animate) this.tweenToSelection();
    else this.setCameraImmediate();
    if (notify) this.onChange({ ...this.selection });
  }

  private selectedBox(): THREE.Box3 | null {
    if (this.selection.mode === 'overview') return this.overviewBox();
    if (this.selection.mode === 'area' && this.selection.areaId) {
      const area = this.areas.find((item) => item.def.id === this.selection.areaId);
      if (area?.bounds) return boxOf(area.bounds.min, area.bounds.max);
    }
    if (this.selection.mode === 'equipment' && this.selection.equipmentId) {
      const equipment = this.validation.world.equipment.find(
        (item) => item.equipmentId === this.selection.equipmentId
      );
      if (equipment) return boxOf(equipment.modelBox.min, equipment.modelBox.max);
    }
    if (this.selection.mode === 'pipeline' && this.selection.pipelineId) {
      const group = this.pipelineGroups.get(this.selection.pipelineId);
      if (group) return new THREE.Box3().setFromObject(group);
    }
    return this.overviewBox();
  }

  private overviewBox(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const equipment of this.validation.world.equipment) {
      box.expandByPoint(new THREE.Vector3(equipment.modelBox.min[0], equipment.modelBox.min[1], equipment.modelBox.min[2]));
      box.expandByPoint(new THREE.Vector3(equipment.modelBox.max[0], equipment.modelBox.max[1], equipment.modelBox.max[2]));
    }
    return box;
  }

  private poseFor(box: THREE.Box3, mode: BoilViewMode | 'group' = this.selection.mode): CameraPose {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z, 1);
    let offset: THREE.Vector3;
    if (mode === 'overview') {
      offset = new THREE.Vector3(extent * 0.43, extent * 0.35, extent * 0.78);
    } else if (mode === 'area') {
      offset = new THREE.Vector3(extent * 0.78, extent * 0.62, extent * 1.25);
    } else if (mode === 'equipment') {
      offset = new THREE.Vector3(extent * 1.2, extent * 1.0, extent * 1.7);
    } else if (mode === 'group') {
      offset = new THREE.Vector3(extent * 1.05, extent * 0.9, extent * 1.55);
    } else {
      offset = new THREE.Vector3(extent * 0.95, extent * 0.78, extent * 1.4);
    }
    const target = center.clone();
    if (mode === 'overview') target.x -= size.x * 0.06;
    const position = target.clone().add(offset);
    position.y = Math.max(position.y, target.y + extent * 0.32, 3.2);
    return {
      position,
      target,
      near: Math.max(0.05, extent / 240),
      far: Math.max(700, extent * 18)
    };
  }

  private tweenToSelection(): void {
    const box = this.selectedBox();
    if (!box) {
      this.setCameraImmediate();
      return;
    }
    this.tweenToBox(box, this.selection.mode, this.selection.mode === 'overview' ? 900 : 760);
  }

  private tweenToBox(box: THREE.Box3, mode: BoilViewMode | 'group', duration = 760): void {
    const pose = this.poseFor(box, mode);
    const fromPos = this.camera.position.clone();
    const fromTarget = this.cameraTarget.clone();
    const control = new THREE.Vector3(
      (fromPos.x + pose.position.x) / 2,
      Math.max(fromPos.y, pose.position.y, this.sceneTop + 3),
      (fromPos.z + pose.position.z) / 2
    );
    this.tween = {
      fromPos,
      toPos: pose.position,
      control,
      fromTarget,
      toTarget: pose.target,
      start: performance.now(),
      duration,
      near: pose.near,
      far: pose.far,
      pausedAt: this.playbackPaused ? performance.now() : null
    };
    this.controls.enabled = false;
  }

  private setCameraImmediate(): void {
    this.tween = null;
    const box = this.selectedBox();
    if (!box) return;
    this.setCameraToBox(box, this.selection.mode);
  }

  private setCameraToBox(box: THREE.Box3, mode: BoilViewMode | 'group'): void {
    const pose = this.poseFor(box, mode);
    this.camera.position.copy(pose.position);
    this.cameraTarget.copy(pose.target);
    this.controls.target.copy(pose.target);
    this.camera.near = pose.near;
    this.camera.far = pose.far;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(pose.target);
    this.controls.update();
    this.controls.enabled = true;
  }

  private updateCameraTween(now: number): void {
    if (!this.tween) return;
    if (this.tween.pausedAt !== null) return;
    const t = Math.min(1, Math.max(0, (now - this.tween.start) / this.tween.duration));
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const a = 1 - e;
    const position = new THREE.Vector3(
      a * a * this.tween.fromPos.x + 2 * a * e * this.tween.control.x + e * e * this.tween.toPos.x,
      a * a * this.tween.fromPos.y + 2 * a * e * this.tween.control.y + e * e * this.tween.toPos.y,
      a * a * this.tween.fromPos.z + 2 * a * e * this.tween.control.z + e * e * this.tween.toPos.z
    );
    const target = this.tween.fromTarget.clone().lerp(this.tween.toTarget, e);
    this.camera.position.copy(position);
    this.cameraTarget.copy(target);
    this.camera.near = 0.05;
    this.camera.far = 2000;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(target);
    if (t >= 1) {
      const finished = this.tween;
      this.tween = null;
      this.camera.position.copy(finished.toPos);
      this.cameraTarget.copy(finished.toTarget);
      this.controls.target.copy(finished.toTarget);
      this.camera.near = finished.near;
      this.camera.far = finished.far;
      this.camera.updateProjectionMatrix();
      this.controls.enabled = true;
      this.controls.update();
    }
  }

  private cancelCameraTween(): void {
    if (!this.tween) return;
    this.tween = null;
    this.controls.target.copy(this.cameraTarget);
    this.controls.enabled = true;
    this.camera.near = 0.05;
    this.camera.far = 2000;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private applyVisualState(): void {
    if (this.overlay) {
      this.applyOverlayVisualState(this.overlay);
      return;
    }
    const mode = this.selection.mode;
    let activeEquipment: Set<string> | null = null;
    let activePipelines: Set<string> | null = null;
    let equipmentHighlight: THREE.Color | null = null;
    let pipelineHighlight: THREE.Color | null = null;

    if (mode === 'area' && this.selection.areaId) {
      const area = this.areas.find((item) => item.def.id === this.selection.areaId);
      if (area) {
        activeEquipment = new Set(area.equipment.map((item) => item.id));
        activePipelines = new Set(area.pipelines.map((item) => item.id));
        for (const pipeline of [...area.entryPipelines, ...area.exitPipelines]) {
          activePipelines.add(pipeline.id);
        }
        equipmentHighlight = HIGHLIGHT_AREA;
        pipelineHighlight = HIGHLIGHT_AREA;
      }
    } else if (mode === 'equipment' && this.selection.equipmentId) {
      activeEquipment = new Set([this.selection.equipmentId]);
      const links = equipmentFlowLinks(BOIL_PROCESS, this.selection.equipmentId);
      activePipelines = new Set(links.map((link) => link.pipelineId));
      equipmentHighlight = HIGHLIGHT_EQUIPMENT;
      pipelineHighlight = HIGHLIGHT_PIPELINE;
    } else if (mode === 'pipeline' && this.selection.pipelineId) {
      const pipeline = BOIL_PROCESS.pipelines.find((item) => item.id === this.selection.pipelineId);
      activePipelines = new Set([this.selection.pipelineId]);
      activeEquipment = new Set(pipeline ? [pipeline.from.equipment, pipeline.to.equipment] : []);
      equipmentHighlight = HIGHLIGHT_AREA;
      pipelineHighlight = HIGHLIGHT_PIPELINE;
    }

    this.visualStats = { highlightedEquipment: 0, dimmedEquipment: 0, highlightedPipelines: 0, dimmedPipelines: 0 };
    for (const [equipmentId, visual] of this.equipmentVisuals) {
      const dim = Boolean(activeEquipment && !activeEquipment.has(equipmentId));
      const highlight = activeEquipment?.has(equipmentId) ? equipmentHighlight : null;
      if (dim) this.visualStats.dimmedEquipment += 1;
      if (highlight) this.visualStats.highlightedEquipment += 1;
      for (const state of visual.materials) styleMaterial(state, dim, highlight);
    }
    for (const [pipelineId, visual] of this.pipelineVisuals) {
      const dim = Boolean(activePipelines && !activePipelines.has(pipelineId));
      const highlight = activePipelines?.has(pipelineId) ? pipelineHighlight : null;
      if (dim) this.visualStats.dimmedPipelines += 1;
      if (highlight) this.visualStats.highlightedPipelines += 1;
      for (const state of visual.materials) styleMaterial(state, dim, highlight);
    }

    const activeAreaId = this.selection.areaId;
    for (const [areaId, frame] of this.areaFrames) {
      const active = Boolean(activeAreaId && areaId === activeAreaId);
      frame.material.opacity = mode === 'overview' ? 0.45 : active ? 0.95 : 0.16;
      frame.material.color.setHex(active ? 0x38bdf8 : 0x2f6f9f);
      frame.material.needsUpdate = true;
    }

    this.branchLinkGroup.visible = Boolean(
      activeEquipment &&
        ([...this.branchParentIds, ...this.branchChildIds].some((id) => activeEquipment!.has(id)))
    );
    this.branchLinkLabelGroup.visible = this.branchLinkGroup.visible && this.labelsOn;

    if (mode === 'overview') {
      this.fluid.setEmphasis(null);
    } else {
      this.fluid.setEmphasis(activePipelines ?? new Set());
    }
  }

  private applyOverlayVisualState(overlay: BoilOverlaySpec): void {
    const currentEquipment = new Set(overlay.currentEquipmentIds ?? []);
    const upstreamEquipment = new Set(overlay.upstreamEquipmentIds ?? []);
    const downstreamEquipment = new Set(overlay.downstreamEquipmentIds ?? []);
    const branchEquipment = new Set(overlay.branchEquipmentIds ?? []);
    const completedEquipment = new Set(overlay.completedEquipmentIds ?? []);
    const focusEquipment = new Set(overlay.focusEquipmentIds ?? []);
    const activeEquipment = new Set([
      ...currentEquipment,
      ...upstreamEquipment,
      ...downstreamEquipment,
      ...branchEquipment,
      ...completedEquipment,
      ...focusEquipment
    ]);

    const currentPipelines = new Set(overlay.currentPipelineIds ?? []);
    const upstreamPipelines = new Set(overlay.upstreamPipelineIds ?? []);
    const downstreamPipelines = new Set(overlay.downstreamPipelineIds ?? []);
    const completedPipelines = new Set(overlay.completedPipelineIds ?? []);
    const activePipelines = new Set(overlay.activePipelineIds ?? []);
    for (const id of [...currentPipelines, ...upstreamPipelines, ...downstreamPipelines, ...completedPipelines]) {
      activePipelines.add(id);
    }

    this.visualStats = { highlightedEquipment: 0, dimmedEquipment: 0, highlightedPipelines: 0, dimmedPipelines: 0 };
    for (const [equipmentId, visual] of this.equipmentVisuals) {
      let highlight: THREE.Color | null = null;
      if (currentEquipment.has(equipmentId)) highlight = HIGHLIGHT_CURRENT;
      else if (upstreamEquipment.has(equipmentId)) highlight = HIGHLIGHT_UPSTREAM;
      else if (downstreamEquipment.has(equipmentId)) highlight = HIGHLIGHT_DOWNSTREAM;
      else if (branchEquipment.has(equipmentId)) highlight = HIGHLIGHT_BRANCH;
      else if (completedEquipment.has(equipmentId)) highlight = HIGHLIGHT_COMPLETED;
      else if (activeEquipment.has(equipmentId)) highlight = HIGHLIGHT_EQUIPMENT;
      const dim = !activeEquipment.has(equipmentId);
      if (dim) this.visualStats.dimmedEquipment += 1;
      if (highlight) this.visualStats.highlightedEquipment += 1;
      for (const state of visual.materials) styleMaterial(state, dim, highlight);
    }
    for (const [pipelineId, visual] of this.pipelineVisuals) {
      let highlight: THREE.Color | null = null;
      if (currentPipelines.has(pipelineId)) highlight = HIGHLIGHT_CURRENT;
      else if (upstreamPipelines.has(pipelineId)) highlight = HIGHLIGHT_UPSTREAM;
      else if (downstreamPipelines.has(pipelineId)) highlight = HIGHLIGHT_DOWNSTREAM;
      else if (completedPipelines.has(pipelineId)) highlight = HIGHLIGHT_COMPLETED;
      else if (activePipelines.has(pipelineId)) highlight = HIGHLIGHT_PIPELINE;
      const dim = !activePipelines.has(pipelineId);
      if (dim) this.visualStats.dimmedPipelines += 1;
      if (highlight) this.visualStats.highlightedPipelines += 1;
      for (const state of visual.materials) styleMaterial(state, dim, highlight);
    }

    const activeAreaId = overlay.areaId ?? null;
    for (const [areaId, frame] of this.areaFrames) {
      const active = Boolean(activeAreaId && areaId === activeAreaId);
      frame.material.opacity = active ? 0.9 : 0.12;
      frame.material.color.setHex(active ? 0x38bdf8 : 0x2f6f9f);
      frame.material.needsUpdate = true;
    }

    this.branchLinkGroup.visible = [...this.branchParentIds, ...this.branchChildIds].some((id) =>
      activeEquipment.has(id)
    );
    this.branchLinkLabelGroup.visible = this.branchLinkGroup.visible && this.labelsOn;
    this.fluid.setEmphasis(activePipelines.size > 0 ? activePipelines : new Set());
  }

  get fanTracing(): boolean { return this.fanOutletOn; }

  setFanTracing(enabled: boolean) {
    this.fanOutletOn = enabled;
    const holder = this.equipmentHolders.get('eq-id-fan');
    if (holder && !this.fanView) {
      const view = new InternalsView('id-fan');
      view.setMode('transparent');
      view.build.group.position.copy(holder.children[0].position);
      holder.add(view.build.group);
      this.fanView = view;
    }
    const label = this.equipmentLabels.get('eq-id-fan');
    if (label) {
      const next = this.makeLabel(enabled ? '引风机 · 示踪开启' : '引风机 · 示踪停止', '#eef6ff', 0.9);
      label.material.map?.dispose();
      label.material.map = next.material.map;
      label.material.needsUpdate = true;
      label.userData.baseScaleX = next.userData.baseScaleX;
      next.material.dispose();
    }
    this.syncFanView();
    this.applyFlowScope(this.overlay?.flowScope ?? null);
  }

  private syncFanView() {
    const holder = this.equipmentHolders.get('eq-id-fan');
    if (!holder || !this.fanView) return;
    const inspect = this.overlay
      ? this.overlay.currentEquipmentIds?.includes('eq-id-fan') === true
      : this.selection.equipmentId === 'eq-id-fan';
    holder.children[0].visible = !inspect;
    this.fanView.build.group.visible = inspect;
  }

  private applyFlowScope(scope: string[] | null): void {
    const key = (scope === null ? 'all' : [...scope].sort().join('|')) + ':' + this.fanOutletOn;
    if (key === this.flowScopeKey) return;
    this.flowScopeKey = key;
    const active = scope && new Set(scope);
    const flows: Record<string, BoilPipeFlow> = {};
    for (const [pipelineId, flow] of Object.entries(this.baseFlows)) {
      const fanOutlet = pipelineId === 'pipe-gas-09';
      flows[pipelineId] = (!active || active.has(pipelineId)) && (!fanOutlet || this.fanOutletOn)
        ? flow
        : { ...flow, state: 'off', throttle: false, haltT: 1 };
    }
    this.fluid.setFlows(flows);
  }

  private syncLabelVisibility(): void {
    if (this.overlay) {
      this.syncOverlayLabelVisibility(this.overlay);
      return;
    }
    const mode = this.selection.mode;
    const areaId = this.selection.areaId;
    const equipmentId = this.selection.equipmentId;
    const pipelineId = this.selection.pipelineId;
    const area = areaId ? this.areas.find((item) => item.def.id === areaId) : undefined;
    const areaEquipment = new Set(area?.equipment.map((item) => item.id) ?? []);
    const areaPipelines = new Set(area?.pipelines.map((item) => item.id) ?? []);
    for (const pipeline of [...(area?.entryPipelines ?? []), ...(area?.exitPipelines ?? [])]) {
      areaPipelines.add(pipeline.id);
    }
    const pipeline = pipelineId ? BOIL_PROCESS.pipelines.find((item) => item.id === pipelineId) : undefined;
    const pipelineEquipment = new Set(pipeline ? [pipeline.from.equipment, pipeline.to.equipment] : []);
    const relatedEquipment = new Set(
      equipmentId ? equipmentFlowLinks(BOIL_PROCESS, equipmentId).map((link) => link.equipmentId) : []
    );
    const relatedPipelines = new Set(
      equipmentId ? equipmentFlowLinks(BOIL_PROCESS, equipmentId).map((link) => link.pipelineId) : []
    );

    for (const [id, label] of this.equipmentLabels) {
      let show = this.labelsOn;
      if (mode === 'area') show = show && areaEquipment.has(id);
      else if (mode === 'equipment') show = show && (id === equipmentId || relatedEquipment.has(id));
      else if (mode === 'pipeline') show = show && pipelineEquipment.has(id);
      label.visible = show;
    }
    for (const [id, label] of this.pipeLabels) {
      let show = this.labelsOn;
      if (mode === 'area') show = show && areaPipelines.has(id);
      else if (mode === 'equipment') show = show && relatedPipelines.has(id);
      else if (mode === 'pipeline') show = show && id === pipelineId;
      label.visible = show;
    }
    for (const [key, label] of this.pendingLabels) {
      const [equipment] = key.split('.');
      let show = this.labelsOn;
      if (mode === 'area' || mode === 'pipeline') show = false;
      else if (mode === 'equipment') show = show && equipment === equipmentId;
      label.visible = show;
    }
    for (const [id, frame] of this.areaFrames) {
      frame.label.visible = this.labelsOn && (mode === 'overview' || id === areaId);
    }
    this.branchLinkLabelGroup.visible = this.branchLinkGroup.visible && this.labelsOn;
  }

  private syncOverlayLabelVisibility(overlay: BoilOverlaySpec): void {
    const labeledEquipment = new Set([
      ...(overlay.currentEquipmentIds ?? []),
      ...(overlay.upstreamEquipmentIds ?? []),
      ...(overlay.downstreamEquipmentIds ?? []),
      ...(overlay.branchEquipmentIds ?? []),
      ...(overlay.focusEquipmentIds ?? [])
    ]);
    const activePipelines = new Set(overlay.activePipelineIds ?? []);
    for (const [id, label] of this.equipmentLabels) {
      label.visible = this.labelsOn && labeledEquipment.has(id);
    }
    for (const [id, label] of this.pipeLabels) {
      label.visible = this.labelsOn && activePipelines.has(id);
    }
    for (const [key, label] of this.pendingLabels) {
      const [equipmentId] = key.split('.');
      label.visible =
        this.labelsOn && (labeledEquipment.has(equipmentId) && (overlay.branchEquipmentIds ?? []).includes(equipmentId));
    }
    for (const label of this.areaFrames.values()) label.label.visible = false;
    this.branchLinkLabelGroup.visible = this.branchLinkGroup.visible && this.labelsOn;
  }

  private addPointerListeners(): void {
    const el = this.renderer.domElement;
    const onDown = (event: PointerEvent) => {
      this.downX = event.clientX;
      this.downY = event.clientY;
      this.cancelCameraTween();
    };
    const onUp = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - this.downX, event.clientY - this.downY) > 6) return;
      const rect = el.getBoundingClientRect();
      const hit = this.pickAtRatio(
        (event.clientX - rect.left) / rect.width,
        (event.clientY - rect.top) / rect.height
      );
      if (hit && this.overlay && this.overlayPicker) {
        this.overlayPicker(hit.kind, hit.id);
        return;
      }
      if (this.overlay) return;
      if (hit?.kind === 'equipment') {
        this.focusEquipment(hit.id);
        return;
      }
      if (hit?.kind === 'pipeline') {
        this.focusPipeline(hit.id);
        return;
      }
      if (this.selection.mode === 'equipment' || this.selection.mode === 'pipeline') {
        if (this.selection.areaId) this.focusArea(this.selection.areaId);
        else this.overview();
      } else if (this.selection.mode === 'area') {
        this.overview();
      }
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    this.disposeFns.push(() => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    });
  }

  private resize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  setInspectionActive(active: boolean): void {
    this.inspecting = active;
    if (active) this.tween = null;
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.animate);
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    if (this.inspecting) return;
    if (this.tween) this.updateCameraTween(now);
    else this.controls.update();
    for (const listener of [...this.frameListeners]) listener(dt);
    this.updateLabelScales();
    this.fluid.update(dt);
    if (this.fanView) {
      this.fanView.setAnimationEnabled(this.fanOutletOn && !this.playbackPaused && this.fanView.build.group.visible);
      this.fanView.update(now);
    }
    this.renderer.render(this.scene, this.camera);
  };

  /** 标签随镜头距离缩放，避免近景设备/支路标签铺满画面。 */
  private updateLabelScales(): void {
    const labels: THREE.Sprite[] = [
      ...this.equipmentLabels.values(),
      ...this.pipeLabels.values(),
      ...this.pendingLabels.values()
    ];
    for (const frame of this.areaFrames.values()) labels.push(frame.label);
    const bounds: Record<BoilViewMode, { min: number; max: number }> = {
      overview: { min: 0.9, max: 1.3 },
      area: { min: 0.5, max: 0.95 },
      equipment: { min: 0.32, max: 0.8 },
      pipeline: { min: 0.55, max: 0.95 }
    };
    const limit = bounds[this.selection.mode];
    for (const label of labels) {
      if (!label.visible) continue;
      const distance = label.position.distanceTo(this.camera.position);
      const factor = Math.min(limit.max, Math.max(limit.min, distance / 70));
      label.scale.set(
        (label.userData.baseScaleX as number) * factor,
        (label.userData.baseScaleY as number) * factor,
        1
      );
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.tween = null;
    this.resizeObserver.disconnect();
    for (const fn of this.disposeFns) fn();
    this.controls.dispose();
    this.fanView?.dispose();
    disposeObject(this.content);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.scene.clear();
  }
}

function boxOf(min: [number, number, number], max: [number, number, number]): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(min[0], min[1], min[2]),
    new THREE.Vector3(max[0], max[1], max[2])
  );
}

function reportById(reports: BoilRouteReport[], id: string): BoilRouteReport | undefined {
  return reports.find((report) => report.pipelineId === id);
}
