import * as THREE from 'three';
import type { DeviceDef } from '../data/types';
import { HX_TUBES } from './exchangerModel';
import { pumpInlet, pumpOutlet } from '../data/pumpPath';

/** 工作原理示意动画：旋转/往复部件 + 流体路径粒子。仅示意，非 CFD 结果。 */
export class PrincipleAnim {
  private particles: THREE.Mesh[] = [];
  private group = new THREE.Group();
  private pathGroups: THREE.Group[] = [];
  private t = 0;
  playing = true;
  speed = 1;
  private rotParts: THREE.Group[] = [];
  private rotAxis: 'x' | 'y' = 'x';
  private paths: ((u: number, i: number) => THREE.Vector3)[] = [];
  private motions: ((t: number) => void)[] = [];
  private resets: (() => void)[] = [];
  private device: DeviceDef;

  constructor(device: DeviceDef, partGroups: Map<string, THREE.Group>) {
    this.device = device;
    const geo = new THREE.SphereGeometry(0.032, 8, 8);
    const add = (color: number, count: number, path: (u: number, i: number) => THREE.Vector3) => {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
      const pg = new THREE.Group();
      this.group.add(pg);
      this.pathGroups.push(pg);
      for (let i = 0; i < count; i++) {
        const m = new THREE.Mesh(geo, mat);
        if (device.principleAnim === 'phe') m.scale.setScalar(0.05);
        m.userData.phase = i / count;
        m.userData.pathIdx = this.paths.length;
        this.particles.push(m);
        pg.add(m);
      }
      this.paths.push(path);
    };
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    /** 注册部件运动：自动记录初始位姿，退出原理模式时复位 */
    const grpMotion = (g: THREE.Group | undefined, fn: (t: number, g: THREE.Group) => void) => {
      if (!g) return;
      const p0 = g.position.clone();
      const r0 = g.rotation.clone();
      this.motions.push((t) => fn(t, g));
      this.resets.push(() => { g.position.copy(p0); g.rotation.copy(r0); });
    };
    const show = (idx: number, on: boolean) => { if (this.pathGroups[idx]) this.pathGroups[idx].visible = on; };
    /** 液位演示：按 userData.baseH/bottomY 调节 demo-liquid 网格 */
    const liquidMotion = (ids: string[], level: (t: number) => number) => {
      const ls: THREE.Mesh[] = [];
      for (const id of ids) {
        partGroups.get(id)?.traverse((o) => { if (o.name === 'demo-liquid') ls.push(o as THREE.Mesh); });
      }
      if (!ls.length) return;
      const base = ls.map((m) => ({ sy: m.scale.y, py: m.position.y }));
      this.motions.push((t) => {
        const k = level(t);
        for (const m of ls) {
          const bh = m.userData.baseH as number;
          const by = m.userData.bottomY as number;
          const h = bh * (0.12 + 0.85 * k);
          m.scale.y = h / bh;
          m.position.y = by + h / 2;
        }
      });
      this.resets.push(() => ls.forEach((m, i) => { m.scale.y = base[i].sy; m.position.y = base[i].py; }));
    };

    const anim = device.principleAnim;
    if (anim === 'pump') {
      this.rotAxis = 'x';
      for (const id of ['impeller', 'shaft', 'keys', 'sealRotary', 'sealSleeve', 'coupling', 'couplingMotor', 'couplingBolts', 'motorShaft', 'motorRotor', 'motorFan']) {
        const g = partGroups.get(id);
        if (g) this.rotParts.push(g);
      }
      // 两股示踪使用同一设备的开口和流道。旋转叶片空间由转动模型示意。
      const inlet = new THREE.CurvePath<THREE.Vector3>();
      const outlet = new THREE.CurvePath<THREE.Vector3>();
      for (const [curve, points] of [[inlet, pumpInlet], [outlet, pumpOutlet]] as const) {
        for (let i = 1; i < points.length; i++) {
          curve.add(new THREE.LineCurve3(new THREE.Vector3(...points[i - 1]), new THREE.Vector3(...points[i])));
        }
        add(0x2f8fe6, 24, (u) => curve.getPoint(u));
      }
    } else if (anim === 'exchanger') {
      // Single pass: particles follow actual open tubes.
      add(0x2f8fe6, 14, (u, i) => {
        const h = HX_TUBES[i % HX_TUBES.length];
        if (u < 0.12) return V(-1.32, 1.7 - u / 0.12 * 0.65, 0);
        if (u < 0.22) { const k = (u - 0.12) / 0.10; return V(-1.32 + k * 0.15, 1.05 + k * (h.u - 0.15), h.v * k); }
        if (u < 0.78) return V(-1.17 + (u - 0.22) / 0.56 * 2.34, 0.9 + h.u, h.v);
        if (u < 0.88) { const k = (u - 0.78) / 0.10; return V(1.17 + k * 0.12, 0.9 + h.u * (1 - k) - 0.15 * k, h.v * (1 - k)); }
        return V(1.29, 0.75 - (u - 0.88) / 0.12 * 0.65, 0);
      });
      // Shell route goes through alternating windows, outside the tube bundle.
      add(0xeaa23b, 14, (u) => {
        const points = [[-0.7,1.745,0],[-0.7,1.22,0],[-0.66,1.22,0],[-0.44,0.9,0.35],[-0.22,0.58,0],[0,0.9,0.35],[0.22,1.22,0],[0.44,0.9,0.35],[0.66,0.58,0],[0.7,0.58,0],[0.7,0.055,0]];
        const f = u * (points.length - 1), j = Math.min(Math.floor(f), points.length - 2), t = f - j;
        const a = points[j], b = points[j + 1];
        return V(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
      });
    } else if (anim === 'reactor') {
      this.rotAxis = 'y';
      for (const id of ['shaft', 'paddles']) {
        const g = partGroups.get(id);
        if (g) this.rotParts.push(g);
      }
      // 釜内循环：中心下降、釜壁上升
      add(0x2fae8f, 26, (u, i) => {
        const th = u * Math.PI * 2;
        const phi = (i / 26) * Math.PI * 2 + th * 0.35;
        const radial = 0.28 - 0.2 * Math.cos(th);
        const y = 1.0 + 0.42 * Math.sin(th);
        return V(Math.cos(phi) * radial, y, Math.sin(phi) * radial);
      });
    } else if (anim === 'ball') {
      // 启闭循环：开 → 关 → 开；全开时介质直通
      const angle = (t: number) => {
        const c = t % 6;
        const k = c < 1.2 ? c / 1.2 : c < 3 ? 1 : c < 4.2 ? 1 - (c - 3) / 1.2 : 0;
        return k * Math.PI / 2;
      };
      for (const id of ['ball', 'stem', 'handle']) {
        grpMotion(partGroups.get(id), (t, g) => { g.rotation.y = angle(t); });
      }
      add(0x2f8fe6, 22, (u) => V(-0.6 + u * 1.2, 0.62, 0));
      this.motions.push((t) => show(0, angle(t) < 0.25));
      this.resets.push(() => show(0, true));
    } else if (anim === 'gate') {
      // 手轮旋转 → 闸板升降；全开时介质直通
      const lift = (t: number) => {
        const c = t % 7;
        return c < 1.5 ? c / 1.5 : c < 3.5 ? 1 : c < 5 ? 1 - (c - 3.5) / 1.5 : 0;
      };
      grpMotion(partGroups.get('gate'), (t, g) => { g.position.y = 0.62 + lift(t) * 0.3; });
      grpMotion(partGroups.get('stem'), (t, g) => { g.position.y = 1.02 + lift(t) * 0.3; });
      grpMotion(partGroups.get('handwheel'), (t, g) => { g.rotation.y = lift(t) * Math.PI * 6; });
      add(0x2f8fe6, 22, (u) => V(-0.55 + u * 1.1, 0.62, 0));
      this.motions.push((t) => show(0, lift(t) > 0.85));
      this.resets.push(() => show(0, true));
    } else if (anim === 'butterfly') {
      const angle = (t: number) => {
        const c = t % 6;
        const k = c < 1.2 ? c / 1.2 : c < 3 ? 1 : c < 4.2 ? 1 - (c - 3) / 1.2 : 0;
        return k * Math.PI / 2;
      };
      for (const id of ['disc', 'shaft', 'handle']) {
        grpMotion(partGroups.get(id), (t, g) => { g.rotation.y = angle(t); });
      }
      add(0x2f8fe6, 22, (u, i) => V(-0.5 + u * 1.0, 0.6 + ((i % 3) - 1) * 0.07, ((i % 2) - 0.5) * 0.1));
      this.motions.push((t) => show(0, angle(t) > 1.2));
      this.resets.push(() => show(0, true));
    } else if (anim === 'check') {
      // 正向流动推开阀瓣；倒流时阀瓣落座切断通路
      const forward = (t: number) => (t % 6) < 3;
      grpMotion(partGroups.get('disc'), (t, g) => { g.rotation.z = forward(t) ? -1.0 : 0; });
      add(0x2f8fe6, 18, (u) => V(-0.5 + u * 1.0, 0.6, 0));
      add(0xe05a3a, 14, (u) => V(0.5 - u * 0.42, 0.6, 0));
      this.motions.push((t) => { show(0, forward(t)); show(1, !forward(t)); });
      this.resets.push(() => { show(0, true); show(1, true); });
    } else if (anim === 'gear') {
      grpMotion(partGroups.get('driveGear'), (t, g) => { g.rotation.x = t * 4; });
      grpMotion(partGroups.get('idlerGear'), (t, g) => { g.rotation.x = -t * 4; });
      // 介质从 +Z 吸入腔进入，沿两只齿轮外周到 -Z 排出腔；不穿过两齿轮啮合中心
      add(0x2f8fe6, 26, (u, i) => {
        const top = i % 2 === 0;
        const cy = top ? 0.89 : 0.55;
        const r = 0.20;
        const a0 = top ? 0.12 : -0.12;
        const a1 = top ? Math.PI - 0.12 : -(Math.PI - 0.12);
        if (u < 0.12) {
          const k = u / 0.12;
          return V(0, 0.72 + (cy - 0.72) * k * 0.9, 0.33 - k * 0.11);
        }
        if (u < 0.84) {
          const k = (u - 0.12) / 0.72;
          const a = a0 + (a1 - a0) * k;
          return V(0, cy + Math.sin(a) * r, Math.cos(a) * r);
        }
        const k = (u - 0.84) / 0.16;
        return V(0, 0.72 + (cy - 0.72) * (1 - k) * 0.9, -0.22 - k * 0.11);
      });
    } else if (anim === 'diaphragm') {
      const s = (t: number) => Math.sin(t * 2.2);
      grpMotion(partGroups.get('link'), (t, g) => { g.position.x = s(t) * 0.03; });
      const flexes: { o: THREE.Object3D; baseX: number }[] = [];
      for (const id of ['diaphragmL', 'diaphragmR']) {
        partGroups.get(id)?.traverse((o) => {
          if (o.userData.diaphragmCenter) flexes.push({ o, baseX: o.position.x });
        });
      }
      this.motions.push((t) => {
        const off = s(t) * 0.03;
        for (const f of flexes) f.o.position.x = f.baseX + off;
      });
      this.resets.push(() => flexes.forEach((f) => { f.o.position.x = f.baseX; }));
      // 左吸右排（s>0）与右吸左排（s<0）交替
      add(0x2f8fe6, 10, (u) => u < 0.5 ? V(-0.75 + u * 0.58, 0.36, 0) : V(-0.46, 0.36 + (u - 0.5) * 0.5, 0));
      add(0x2f8fe6, 10, (u) => u < 0.5 ? V(0.46, 0.85 + u * 0.46, 0) : V(0.46 + (u - 0.5) * 0.6, 1.08, 0));
      add(0x2f8fe6, 10, (u) => u < 0.5 ? V(0.75 - u * 0.58, 0.36, 0) : V(0.46, 0.36 + (u - 0.5) * 0.5, 0));
      add(0x2f8fe6, 10, (u) => u < 0.5 ? V(-0.46, 0.85 + u * 0.46, 0) : V(-0.46 - (u - 0.5) * 0.6, 1.08, 0));
      add(0x9aa7b4, 6, (u) => V(0, 0.95 + Math.sin(u * Math.PI * 2) * 0.06, 0));
      const ballList: THREE.Mesh[] = [];
      partGroups.get('checkBalls')?.traverse((o) => {
        if (o.userData.valve) ballList.push(o as THREE.Mesh);
      });
      this.motions.push((t) => {
        const left = s(t) > 0.04;
        const right = s(t) < -0.04;
        show(0, left); show(1, left); show(2, right); show(3, right);
        for (const b of ballList) {
          const v = b.userData.valve as { chamber: 'L' | 'R'; line: 'in' | 'out'; restY: number; openY: number };
          const open = (v.chamber === 'L' && v.line === 'in' && left)
            || (v.chamber === 'L' && v.line === 'out' && right)
            || (v.chamber === 'R' && v.line === 'in' && right)
            || (v.chamber === 'R' && v.line === 'out' && left);
          b.position.y = open ? v.openY : v.restY;
        }
      });
      this.resets.push(() => {
        for (let i = 0; i < 5; i++) show(i, true);
        for (const b of ballList) {
          const v = b.userData.valve as { restY: number };
          b.position.y = v.restY;
        }
      });
    } else if (anim === 'phe') {
      // Each path stays in one 0.006-wide gap and connects its open corner pair.
      add(0xe05a3a, 12, (u, i) => { const layer = (i % 6) * 2; return V(-0.662 + layer * 0.022 + 0.011, 0.32 + 0.56 * u, -0.16); });
      add(0x2f8fe6, 12, (u, i) => { const layer = (i % 6) * 2 + 1; return V(-0.662 + layer * 0.022 + 0.011, 0.88 - 0.56 * u, 0.16); });
    } else if (anim === 'bag') {
      // Top inlet → bag interior → filter wall → annular outlet.
      add(0x2f8fe6, 22, (u, i) => {
        const a = (i / 22) * Math.PI * 2;
        if (u < 0.3) return V(0, 1.45 - u / 0.3 * 0.65, 0);
        if (u < 0.6) { const k = (u - 0.3) / 0.3; return V(Math.cos(a) * k * 0.23, 0.8 - k * 0.30, Math.sin(a) * k * 0.23); }
        if (u < 0.8) { const k = (u - 0.6) / 0.2; return V(Math.cos(a) * 0.23 * (1 - k) - 0.23 * k, 0.5 - k * 0.15, Math.sin(a) * 0.23 * (1 - k)); }
        return V(-0.23 - (u - 0.8) / 0.2 * 0.31, 0.35, 0);
      });
      // 杂质停留在袋内表面（示意）
      add(0xeaa23b, 8, (u, i) => {
        const a = (i / 8) * Math.PI * 2;
        const k = Math.min(u / 0.6, 1);
        return V(Math.cos(a) * 0.198, 0.85 - k * 0.38, Math.sin(a) * 0.198);
      });
    } else if (anim === 'ystrainer') {
      add(0x2f8fe6, 20, (u, i) => V(-0.45 + u * 0.9, 0.5 + ((i % 3) - 1) * 0.04, ((i % 2) - 0.5) * 0.06));
      // 杂质折入 Y 形支管底部聚集
      add(0xeaa23b, 8, (u) => {
        if (u < 0.5) return V(-0.3 + u * 0.7, 0.5, 0);
        const k = (u - 0.5) / 0.5;
        return V(0.05 + k * 0.18, 0.5 - k * 0.2, 0);
      });
    } else if (anim === 'tank') {
      liquidMotion(['shell', 'levelGauge'], (t) => 0.5 + 0.3 * Math.sin(t * 0.35));
      // 顶部进料
      add(0x2f8fe6, 12, (u, i) => {
        if (u < 0.4) return V(0.3, 2.1 - u * 2.2, 0);
        const k = (u - 0.4) / 0.6;
        const a = (i / 12) * Math.PI * 2;
        return V(0.3 * (1 - k) + Math.cos(a) * 0.4 * k, 1.22 - k * 0.3, Math.sin(a) * 0.4 * k);
      });
      // 底部出料
      add(0x2f8fe6, 10, (u) => u < 0.5 ? V(0.3 + u * 0.9, 0.28, 0) : V(0.75 + (u - 0.5) * 0.6, 0.28, 0));
      // 呼吸阀呼气/吸气
      add(0x9aa7b4, 6, (u, i) => {
        const up = Math.cos(this.t * 0.35) > 0;
        const k = up ? u : 1 - u;
        return V((i % 2 ? 0.03 : -0.03), 2.1 + k * 0.25, 0);
      });
    } else if (anim === 'separator') {
      liquidMotion(['shell', 'levelGauge'], (t) => 0.4 + 0.15 * Math.sin(t * 0.4));
      // 入口混合物撞挡板
      add(0x7fc4f2, 10, (u) => V(0.6 - u * 0.45, 1.25, 0));
      // 液滴下落
      add(0x2f8fe6, 14, (u, i) => {
        const a = (i / 14) * Math.PI * 2;
        const r = 0.3 - u * 0.06;
        return V(Math.cos(a) * r, 1.2 - u * 0.75, Math.sin(a) * r);
      });
      // 气体经除沫器上升
      add(0x39d98a, 14, (u, i) => {
        const a = (i / 14) * Math.PI * 2 + u * 2;
        const r = 0.16 * (1 - u * 0.5);
        return V(Math.cos(a) * r, 1.1 + u * 0.75, Math.sin(a) * r);
      });
    } else if (anim === 'tower') {
      // 气相（青绿）自下而上穿过填料
      add(0x2fae8f, 18, (u, i) => {
        if (u < 0.1) return V(0.5 - u * 5, 0.4, 0);
        const k = (u - 0.1) / 0.8;
        const a = (i / 18) * Math.PI * 2 + k * 3;
        const r = 0.18;
        if (u < 0.9) return V(Math.cos(a) * r, 0.5 + k * 1.6, Math.sin(a) * r);
        return V(0, 2.1 + (u - 0.9) * 3, 0);
      });
      // 液相（蓝）自上而下沿填料表面成膜
      add(0x2f8fe6, 18, (u, i) => {
        const a = (i / 18) * Math.PI * 2;
        if (u < 0.12) return V(Math.cos(a) * u * 2, 1.95 - u * 0.6, Math.sin(a) * u * 2);
        const k = (u - 0.12) / 0.76;
        const r = 0.24 + 0.03 * Math.sin(k * 12 + i);
        if (u < 0.88) return V(Math.cos(a) * r, 1.88 - k * 1.35, Math.sin(a) * r);
        const k2 = (u - 0.88) / 0.12;
        return V(k2 * 0.5, 0.5 - k2 * 0.32, 0);
      });
    } else if (anim === 'cyclone') {
      // 含尘外旋流：切向进入，沿壁螺旋下行至锥底
      add(0xeaa23b, 22, (u, i) => {
        const a = (i / 22) * Math.PI * 2 + u * Math.PI * 6;
        const r = 0.26 - u * 0.18;
        return V(Math.cos(a) * r, 1.5 - u * 1.1, Math.sin(a) * r);
      });
      // 净化内旋流：中心螺旋上行经排气管排出
      add(0x2f8fe6, 16, (u, i) => {
        if (u < 0.75) {
          const k = u / 0.75;
          const a = (i / 16) * Math.PI * 2 - k * Math.PI * 5;
          return V(Math.cos(a) * 0.07, 0.5 + k * 1.3, Math.sin(a) * 0.07);
        }
        const k = (u - 0.75) / 0.25;
        return V(k * 0.35, 1.8 + k * 0.32, 0);
      });
      // 粉尘颗粒落入排料口
      add(0x6b7280, 8, (u, i) => {
        const a = (i / 8) * Math.PI * 2 + u * Math.PI * 4;
        const r = 0.24 - u * 0.2;
        return V(Math.cos(a) * r, 1.4 - u * 1.15, Math.sin(a) * r);
      });
    } else if (anim === 'screw') {
      grpMotion(partGroups.get('maleRotor'), (t, g) => { g.rotation.x = t * 3.5; });
      grpMotion(partGroups.get('femaleRotor'), (t, g) => { g.rotation.x = -t * 3.5 * (4 / 6); });
      // 进气端顶部 → 转子齿间沿轴向 → 排气端底部
      add(0x7fc4f2, 24, (u, i) => {
        if (u < 0.10) {
          const k = u / 0.10;
          return V(-0.35, 1.18 - k * 0.30, 0);
        }
        if (u < 0.76) {
          const k = (u - 0.10) / 0.66;
          const a = (i / 24) * Math.PI * 2 + k * 9;
          const r = 0.065 * (1 - k * 0.35);
          return V(-0.35 + k * 0.70, 0.70 + Math.sin(a) * r, Math.cos(a) * r);
        }
        if (u < 0.86) {
          const k = (u - 0.76) / 0.10;
          return V(0.35, 0.70 - k * 0.22, 0);
        }
        const k = (u - 0.86) / 0.14;
        return V(0.35, 0.48 - k * 0.34, 0);
      });
      // 中段喷油（琥珀色油雾）
      add(0xeaa23b, 8, (u, i) => V(0.05 + ((i % 3) - 1) * 0.04, 1.12 - u * 0.28, ((i % 2) - 0.5) * 0.05));
    } else if (anim === 'emf') {
      // 导电液体沿测量管流动
      add(0x2f8fe6, 20, (u, i) => {
        const a = (i / 20) * Math.PI * 2;
        const r = 0.06;
        return V(-0.45 + u * 0.9, 0.6 + Math.cos(a) * r, Math.sin(a) * r);
      });
      // 磁力线（竖直方向，绿色示意）
      add(0x39d98a, 10, (u, i) => V(-0.15 + (i % 5) * 0.075, 0.45 + u * 0.3, i % 2 ? 0.05 : -0.05));
      // 电极感应信号脉冲
      add(0xc9a227, 4, (u, i) => V(0, 0.6, (i < 2 ? 1 : -1) * (0.11 + u * 0.06)));
    }
    this.group.visible = false;
  }

  get object3d() { return this.group; }

  setActive(on: boolean) {
    this.group.visible = on;
    if (!on) {
      for (const g of this.rotParts) {
        if (this.rotAxis === 'x') g.rotation.x = 0; else g.rotation.y = 0;
      }
      for (const r of this.resets) r();
    }
  }

  replay() { this.t = 0; }

  /** 暂停并停在指定行程（用于分步观察）。 */
  setTime(t: number) {
    this.t = t;
    this.playing = false;
    this.applyFrame();
  }

  getTime() { return this.t; }

  private applyFrame() {
    for (const fn of this.motions) fn(this.t);
    for (const p of this.particles) {
      const u = (this.t * 0.22 + (p.userData.phase as number)) % 1;
      const path = this.paths[p.userData.pathIdx as number];
      p.position.copy(path(u, this.particles.indexOf(p)));
      const s = 0.7 + 0.3 * Math.sin(u * Math.PI);
      p.scale.setScalar(s * (this.device.principleAnim === 'phe' ? 0.05 : this.device.principleAnim === 'pump' ? 0.32 : 1));
    }
  }

  update(dt: number) {
    if (!this.group.visible || !this.playing) return;
    this.t += dt * this.speed;
    const rot = dt * this.speed * (this.device.principleAnim === 'reactor' ? 2.2 : 6);
    for (const g of this.rotParts) {
      if (this.rotAxis === 'x') g.rotation.x += rot; else g.rotation.y += rot;
    }
    this.applyFrame();
  }

  dispose() {
    this.particles.forEach((p) => (p.material as THREE.Material).dispose());
    if (this.particles[0]) this.particles[0].geometry.dispose();
    this.group.clear();
  }
}
