/**
 * 微沸喷烧流体教学示意渲染（Phase 4）。
 *
 * - 每条管线一组表面示踪粒子 + 合并的流向箭头 + 阀门状态灯；
 * - 粒子沿管线中心线（直段 + 与弯头几何一致的二次贝塞尔弯头）运动，
 *   贴在管外壁表面，避免与不透明管壁互相遮挡；不是流体仿真；
 * - 阀门关闭：粒子停在阀位之前、该管及下游断流；部分开度：减速；
 * - 不显示温度、压力、流量、停留时间等工艺数值，仅表示流向与通断。
 *
 * 只用于内部预览，不进入站点路由。
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BOIL_PIPE_SIZES, type PipeRouteResult } from '../process/piping';
import { pipelineValveT, type BoilPipeFlow, type ValveState } from '../process/fluid';

const UP = new THREE.Vector3(0, 1, 0);
const VALVE_COLORS: Record<ValveState, number> = {
  open: 0x34d399,
  partial: 0xfbbf24,
  closed: 0xf87171
};
const THROTTLE_FACTOR = 0.45;

export interface BoilFluidRun {
  pipelineId: string;
  medium: string;
  size: string;
  length: number;
  valveId: string;
  valveT: number;
  particles: number;
  arrows: number;
}

export interface BoilFluidRunRuntime {
  pipelineId: string;
  medium: string;
  flowState: string;
  throttle: boolean;
  valveState: ValveState;
  valveT: number;
  particles: number;
  arrows: number;
  progress: number;
  maxU: number;
  particlesVisible: boolean;
  arrowsVisible: boolean;
}

export interface BoilFluidStats {
  runs: number;
  particles: number;
  arrows: number;
  valves: number;
  paused: boolean;
  speed: number;
  arrowsEnabled: boolean;
  /** 区域/设备/管线聚焦时被弱化的管线数量；null 表示未设置聚焦。 */
  dimmedPipelines: number;
  perRun: BoilFluidRunRuntime[];
}

interface RunInternal {
  pipelineId: string;
  medium: string;
  size: string;
  curve: THREE.CurvePath<THREE.Vector3>;
  length: number;
  radius: number;
  valveId: string;
  valveT: number;
  points: THREE.Points;
  pointMaterial: THREE.PointsMaterial;
  offsets: Float32Array;
  progress: number;
  baseSpeed: number;
  arrows: THREE.Mesh;
  arrowMaterial: THREE.MeshStandardMaterial;
  arrowCount: number;
  valveLight: THREE.Mesh;
  valveLightMaterial: THREE.MeshBasicMaterial;
  flow: BoilPipeFlow | null;
  valveState: ValveState;
  maxU: number;
}

function makeDotTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(32, 32, 30, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 管线中心线：直段按段内缩弯头半径，弯头用与 Phase 3 弯头几何一致的二次贝塞尔。
 * 用于示踪粒子与流向箭头，沿路由生成，不是新的工程管线。
 */
function buildRouteCurve(route: PipeRouteResult): THREE.CurvePath<THREE.Vector3> {
  const curve = new THREE.CurvePath<THREE.Vector3>();
  const points = route.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  if (points.length < 2) return curve;
  const bendAt = new Map(route.bends.map((bend) => [bend.index, bend]));
  let current = points[0].clone();

  for (let i = 0; i + 1 < points.length; i++) {
    const from = points[i];
    const to = points[i + 1];
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 1e-6) continue;
    dir.normalize();
    const startInset = bendAt.get(i)?.radius ?? 0;
    const endInset = bendAt.get(i + 1)?.radius ?? 0;
    const a = from.clone().addScaledVector(dir, startInset);
    const b = to.clone().addScaledVector(dir, -endInset);
    if (current.distanceToSquared(a) > 1e-8) {
      curve.add(new THREE.LineCurve3(current.clone(), a.clone()));
    }
    if (a.distanceToSquared(b) > 1e-8) {
      curve.add(new THREE.LineCurve3(a.clone(), b.clone()));
    }
    current = b.clone();
    const bend = bendAt.get(i + 1);
    if (bend) {
      const bendPoint = new THREE.Vector3(bend.point[0], bend.point[1], bend.point[2]);
      const inDir = new THREE.Vector3(bend.inDir[0], bend.inDir[1], bend.inDir[2]).normalize();
      const outDir = new THREE.Vector3(bend.outDir[0], bend.outDir[1], bend.outDir[2]).normalize();
      const p1 = bendPoint.clone().addScaledVector(inDir, -bend.radius);
      const p2 = bendPoint.clone().addScaledVector(outDir, bend.radius);
      if (current.distanceToSquared(p1) > 1e-8) {
        curve.add(new THREE.LineCurve3(current.clone(), p1.clone()));
      }
      curve.add(new THREE.QuadraticBezierCurve3(p1, bendPoint.clone(), p2));
      current = p2.clone();
    }
  }
  if (current.distanceToSquared(points[points.length - 1]) > 1e-8) {
    curve.add(new THREE.LineCurve3(current, points[points.length - 1].clone()));
  }
  return curve;
}

function surfaceNormal(tangent: THREE.Vector3): THREE.Vector3 {
  const normal = UP.clone().addScaledVector(tangent, -UP.dot(tangent));
  if (normal.lengthSq() < 1e-4) return new THREE.Vector3(0, 0, 1);
  return normal.normalize();
}

/**
 * CurvePath.getTangentAt 在 t≈1 时会因弧长累计误差取到 null，
 * 这里改用两端采样并夹紧到安全区间。
 */
function sampleTangent(
  curve: THREE.CurvePath<THREE.Vector3>,
  u: number,
  target: THREE.Vector3,
  scratchA: THREE.Vector3,
  scratchB: THREE.Vector3
): THREE.Vector3 {
  const eps = 0.001;
  const u1 = Math.max(0, u - eps);
  const u2 = Math.min(0.9995, u + eps);
  curve.getPointAt(u1, scratchA);
  curve.getPointAt(u2, scratchB);
  return target.copy(scratchB).sub(scratchA).normalize();
}

export class BoilFluidOverlay {
  readonly group: THREE.Group;
  private runs: RunInternal[] = [];
  private dotTexture: THREE.Texture;
  private paused = false;
  private speed = 1;
  private arrowsEnabled = true;
  private emphasis: Set<string> | null = null;
  private elapsed = 0;
  private tempPoint = new THREE.Vector3();
  private tempTangent = new THREE.Vector3();
  private tangentScratchA = new THREE.Vector3();
  private tangentScratchB = new THREE.Vector3();

  constructor(routes: PipeRouteResult[], mediumColors: Record<string, number>) {
    this.group = new THREE.Group();
    this.group.name = 'boil-fluid';
    this.dotTexture = makeDotTexture();
    for (const route of routes) this.buildRun(route, mediumColors[route.medium] ?? 0x9aa6b2);
  }

  private buildRun(route: PipeRouteResult, color: number): void {
    const traceColor = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35).getHex();
    const curve = buildRouteCurve(route);
    const length = curve.getLength();
    const spec = BOIL_PIPE_SIZES[route.size];
    const radius = spec.radius;
    const valveT = pipelineValveT(route);
    const valve = route.valves[0];
    const count = Math.max(3, Math.min(70, Math.round(length / 0.9)));
    const offsets = new Float32Array(count);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      offsets[i] = i / count;
      curve.getPointAt(offsets[i], this.tempPoint);
      positions[i * 3] = this.tempPoint.x;
      positions[i * 3 + 1] = this.tempPoint.y;
      positions[i * 3 + 2] = this.tempPoint.z;
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const pointMaterial = new THREE.PointsMaterial({
      color: traceColor,
      size: 0.14,
      map: this.dotTexture,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      sizeAttenuation: true
    });
    const points = new THREE.Points(particleGeometry, pointMaterial);
    points.frustumCulled = false;
    points.renderOrder = 6;
    points.visible = false;
    points.userData.component = 'fluid-particles';
    points.userData.pipelineId = route.pipelineId;
    this.group.add(points);

    const arrowMaterial = new THREE.MeshStandardMaterial({
      color: traceColor,
      roughness: 0.45,
      metalness: 0.25,
      emissive: new THREE.Color(traceColor),
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.9
    });
    const arrowCount = Math.max(1, Math.min(4, Math.floor(length / 3.2)));
    const arrowGeometry = new THREE.ConeGeometry(Math.max(0.08, radius * 1.1), Math.max(0.26, radius * 3.4), 6);
    const arrowParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < arrowCount; i++) {
      const t = (i + 0.5) / arrowCount;
      curve.getPointAt(t, this.tempPoint);
      sampleTangent(curve, t, this.tempTangent, this.tangentScratchA, this.tangentScratchB);
      const pos = this.tempPoint.clone().addScaledVector(surfaceNormal(this.tempTangent), radius + 0.08);
      const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, this.tempTangent.clone().normalize());
      const geometry = arrowGeometry.clone();
      geometry.applyMatrix4(new THREE.Matrix4().compose(pos, quaternion, new THREE.Vector3(1, 1, 1)));
      arrowParts.push(geometry);
    }
    arrowGeometry.dispose();
    const arrows = new THREE.Mesh(mergeGeometries(arrowParts, false) ?? arrowParts[0], arrowMaterial);
    arrows.castShadow = false;
    arrows.receiveShadow = false;
    arrows.visible = false;
    arrows.renderOrder = 5;
    arrows.userData.component = 'fluid-arrows';
    arrows.userData.pipelineId = route.pipelineId;
    this.group.add(arrows);

    const valveLightMaterial = new THREE.MeshBasicMaterial({ color: VALVE_COLORS.open });
    const valveLight = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 8), valveLightMaterial);
    if (valve) {
      valveLight.position.set(valve.point[0], valve.point[1] + 0.52, valve.point[2]);
    } else {
      curve.getPointAt(valveT, valveLight.position);
      valveLight.position.y += 0.52;
    }
    valveLight.userData.component = 'valve-state-light';
    valveLight.userData.pipelineId = route.pipelineId;
    valveLight.userData.valveState = 'open';
    this.group.add(valveLight);

    this.runs.push({
      pipelineId: route.pipelineId,
      medium: route.medium,
      size: route.size,
      curve,
      length,
      radius,
      valveId: valve?.id ?? `valve-${route.pipelineId}`,
      valveT,
      points,
      pointMaterial,
      offsets,
      progress: (this.runs.length * 0.137) % 1,
      baseSpeed: route.medium === 'media-flue-gas' ? 1.5 : 1.15,
      arrows,
      arrowMaterial,
      arrowCount,
      valveLight,
      valveLightMaterial,
      flow: null,
      valveState: 'open',
      maxU: 0
    });
  }

  setFlows(flows: Record<string, BoilPipeFlow>): void {
    for (const run of this.runs) {
      const flow = flows[run.pipelineId] ?? null;
      run.flow = flow;
      if (flow) this.setValveState(run.pipelineId, flow.valveState);
      const active = flow?.state === 'full';
      run.points.visible = Boolean(flow) && flow?.state !== 'off';
      run.arrows.visible = Boolean(active && this.arrowsEnabled);
      this.applyRunStyle(run);
    }
  }

  /**
   * 区域/设备/管线聚焦时弱化其他流线（不删除、不重建）。
   * null 表示恢复全部正常显示。
   */
  setEmphasis(pipelineIds: ReadonlySet<string> | null): void {
    this.emphasis = pipelineIds ? new Set(pipelineIds) : null;
    for (const run of this.runs) this.applyRunStyle(run);
  }

  private isDimmed(pipelineId: string): boolean {
    return this.emphasis !== null && !this.emphasis.has(pipelineId);
  }

  private applyRunStyle(run: RunInternal): void {
    const dim = this.isDimmed(run.pipelineId);
    const active = run.flow?.state === 'full';
    run.pointMaterial.opacity = dim
      ? 0.09
      : active
        ? (run.flow?.throttle ? 0.72 : 0.95)
        : 0.85;
    run.arrowMaterial.opacity = dim ? 0.05 : 0.9;
    run.valveLightMaterial.transparent = true;
    run.valveLightMaterial.opacity = dim ? 0.16 : 1;
  }

  setValveState(pipelineId: string, state: ValveState): void {
    const run = this.runs.find((candidate) => candidate.pipelineId === pipelineId);
    if (!run) return;
    run.valveState = state;
    run.valveLightMaterial.color.setHex(VALVE_COLORS[state]);
    run.valveLight.userData.valveState = state;
    run.valveLight.scale.setScalar(state === 'closed' ? 1.25 : 1);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0.1, Math.min(4, speed));
  }

  setArrowsVisible(visible: boolean): void {
    this.arrowsEnabled = visible;
    for (const run of this.runs) {
      run.arrows.visible = Boolean(visible && run.flow?.state === 'full');
      this.applyRunStyle(run);
    }
  }

  update(dt: number): void {
    if (!this.paused) this.elapsed += dt;
    for (const run of this.runs) {
      const flow = run.flow;
      if (!flow || flow.state === 'off') continue;
      const attribute = run.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      if (flow.state === 'full') {
        if (!this.paused) {
          const factor = flow.throttle ? THROTTLE_FACTOR : 1;
          run.progress = (run.progress + (run.baseSpeed / Math.max(0.6, run.length)) * dt * factor * this.speed) % 1;
        }
        let maxU = 0;
        for (let i = 0; i < run.offsets.length; i++) {
          const u = (run.offsets[i] + run.progress) % 1;
          maxU = Math.max(maxU, u);
          run.curve.getPointAt(u, this.tempPoint);
          sampleTangent(run.curve, u, this.tempTangent, this.tangentScratchA, this.tangentScratchB);
          this.tempPoint.addScaledVector(surfaceNormal(this.tempTangent), run.radius + 0.035);
          attribute.setXYZ(i, this.tempPoint.x, this.tempPoint.y, this.tempPoint.z);
        }
        run.maxU = maxU;
      } else {
        /* 关闭：示踪粒子停在阀前管段内，不再前进。 */
        const limit = Math.max(0.01, flow.haltT - 0.01);
        let maxU = 0;
        for (let i = 0; i < run.offsets.length; i++) {
          const u = run.offsets[i] * limit;
          maxU = Math.max(maxU, u);
          run.curve.getPointAt(u, this.tempPoint);
          sampleTangent(run.curve, u, this.tempTangent, this.tangentScratchA, this.tangentScratchB);
          this.tempPoint.addScaledVector(surfaceNormal(this.tempTangent), run.radius + 0.035);
          attribute.setXYZ(i, this.tempPoint.x, this.tempPoint.y, this.tempPoint.z);
        }
        run.maxU = maxU;
      }
      attribute.needsUpdate = true;
      if (run.arrows.visible) {
        run.arrowMaterial.opacity = this.isDimmed(run.pipelineId)
          ? 0.05
          : 0.62 + 0.28 * (0.5 + 0.5 * Math.sin(this.elapsed * 3.1));
      }
    }
  }

  stats(): BoilFluidStats {
    let particles = 0;
    let arrows = 0;
    const perRun: BoilFluidRunRuntime[] = this.runs.map((run) => {
      particles += run.offsets.length;
      arrows += run.arrowCount;
      return {
        pipelineId: run.pipelineId,
        medium: run.medium,
        flowState: run.flow?.state ?? 'off',
        throttle: Boolean(run.flow?.throttle),
        valveState: run.valveState,
        valveT: Number(run.valveT.toFixed(4)),
        particles: run.offsets.length,
        arrows: run.arrowCount,
        progress: Number(run.progress.toFixed(4)),
        maxU: Number(run.maxU.toFixed(4)),
        particlesVisible: run.points.visible,
        arrowsVisible: run.arrows.visible
      };
    });
    return {
      runs: this.runs.length,
      particles,
      arrows,
      valves: this.runs.length,
      paused: this.paused,
      speed: this.speed,
      arrowsEnabled: this.arrowsEnabled,
      dimmedPipelines: this.emphasis
        ? this.runs.filter((run) => !this.emphasis!.has(run.pipelineId)).length
        : 0,
      perRun
    };
  }

  descriptors(): BoilFluidRun[] {
    return this.runs.map((run) => ({
      pipelineId: run.pipelineId,
      medium: run.medium,
      size: run.size,
      length: Number(run.length.toFixed(2)),
      valveId: run.valveId,
      valveT: Number(run.valveT.toFixed(4)),
      particles: run.offsets.length,
      arrows: run.arrowCount
    }));
  }
}

export function createBoilFluidOverlay(
  routes: PipeRouteResult[],
  mediumColors: Record<string, number>
): BoilFluidOverlay {
  return new BoilFluidOverlay(routes, mediumColors);
}
