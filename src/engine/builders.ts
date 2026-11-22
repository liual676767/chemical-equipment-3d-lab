import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { flangeHolesX, flangeHolesY, hollowCylX, hollowCylY, boltSetY, weldRing, torus, materialSet, cachedGeo } from './industrial';
import { CSG } from 'three-csg-ts';
import { cleanTriangles, circleHoles, fasteners, orient, ring, plateGeometry } from './processGeometry';
import { plateExchangerModelPart } from './plateExchangerModel';
import { pumpModelPart } from './pumpModel';
import { exchangerModelPart } from './exchangerModel';
import { bagFilterModelPart } from './bagFilterModel';
import { ballValvePart, gateValvePart, butterflyPart, checkValvePart } from './valveModels';

/**
 * 程序化教学模型构建器。
 * 每个零件返回独立 THREE.Group，局部坐标以零件装配位置为原点。
 * 替换正式 GLB 资产时：保持零件 id 与 Group 结构，用加载的网格替换此处几何即可。
 */

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}

export function metal(color: number, opts: { rough?: number; metal?: number; double?: boolean } = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.rough ?? 0.38,
    metalness: opts.metal ?? 0.65,
    side: opts.double ? THREE.DoubleSide : THREE.FrontSide
  });
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const me = new THREE.Mesh(g, m);
  me.position.set(x, y, z);
  me.castShadow = true;
  me.receiveShadow = true;
  return me;
}

/** 沿 X 轴的圆柱 */
function cylX(r: number, len: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 32): THREE.Mesh {
  const g = cached(`cx${r}|${len}|${seg}`, () => new THREE.CylinderGeometry(r, r, len, seg));
  const me = mesh(g, m, x, y, z);
  me.rotation.z = Math.PI / 2;
  return me;
}
function cylY(r: number, len: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 32): THREE.Mesh {
  const g = cached(`cy${r}|${len}|${seg}`, () => new THREE.CylinderGeometry(r, r, len, seg));
  return mesh(g, m, x, y, z);
}
function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const g = cached(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
  return mesh(g, m, x, y, z);
}
/** 法兰盘（沿 X 轴） */
function flangeX(r: number, m: THREE.Material, x: number, y = 0, z = 0): THREE.Mesh {
  return cylX(r, 0.05, m, x, y, z);
}
function flangeY(r: number, m: THREE.Material, x: number, y: number, z = 0): THREE.Mesh {
  return cylY(r, 0.05, m, x, y, z);
}
/** 半球封头，dir=-1 朝 -X，+1 朝 +X，'up' 朝 +Y，'down' 朝 -Y */
function dome(r: number, m: THREE.Material, dir: number | 'up' | 'down', x = 0, y = 0, z = 0): THREE.Mesh {
  const g = cached(`dome${r}`, () => new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2));
  const me = mesh(g, m, x, y, z);
  if (dir === 'up') { /* 默认朝上 */ }
  else if (dir === 'down') me.rotation.x = Math.PI;
  else if (dir === -1) me.rotation.z = Math.PI / 2;
  else me.rotation.z = -Math.PI / 2;
  return me;
}
function boltRingX(count: number, radius: number, boltR: number, len: number, m: THREE.Material, x: number): THREE.Group {
  const grp = new THREE.Group();
  const g = cached(`bolt${boltR}|${len}`, () => new THREE.CylinderGeometry(boltR, boltR, len, 8));
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const b = mesh(g, m, x, Math.cos(a) * radius, Math.sin(a) * radius);
    b.rotation.z = Math.PI / 2;
    grp.add(b);
  }
  return grp;
}

/* ============================ 搅拌反应釜 ============================ */

function reactorPart(id: string, color: number): THREE.Group {
  const g = new THREE.Group();
  const ms = materialSet(color);
  const m = ms.cast;
  const mDouble = ms.castDouble;
  const mSteel = ms.machined;
  const mIn = ms.machinedIn;
  const mDark = ms.dark;
  const mWeld = metal(0x6b7684, { rough: 0.55, metal: 0.4 });
  switch (id) {
    case 'vessel': {
      // 中空筒体：外壁 + 内壁 + 环形端面，壁厚 0.022（教学演示值）
      g.add(hollowCylY(0.55, 0.022, 1.1, mDouble, mIn, mSteel, 0, 0, 0, 48));
      // 椭圆（半球）封底：外表面 + 内表面
      const headOut = cached('r15vheado', () => new THREE.SphereGeometry(0.55, 40, 18, 0, Math.PI * 2, 0, Math.PI / 2));
      const headIn = cached('r15vheadi', () => new THREE.SphereGeometry(0.528, 40, 18, 0, Math.PI * 2, 0, Math.PI / 2));
      const bo = mesh(headOut, mDouble, 0, -0.55, 0); bo.rotation.x = Math.PI; g.add(bo);
      const bi = mesh(headIn, mIn, 0, -0.548, 0); bi.rotation.x = Math.PI; g.add(bi);
      g.add(weldRing(0.55, mWeld, -0.55, 'y'));
      // 釜体法兰：12 个真实螺栓孔，与釜盖法兰配对
      const bf = flangeHolesY(0.62, 0.05, 0.014, 12, 0.585, m, 0.575, 0.528);
      g.add(bf);
      g.userData.hollowVessel = true;
      g.userData.wallThickness = 0.022;
      g.userData.innerRadius = 0.528;
      g.userData.bodyFlangeBolts = 12;
      break;
    }
    case 'jacket': {
      // 夹套筒体：外壁 + 内壁，与釜壁间形成密闭热媒腔
      g.add(hollowCylY(0.68, 0.018, 0.95, mDouble, mIn, mSteel, 0, 0, 0, 48));
      const ringGeo = cached('r15jring', () => new THREE.RingGeometry(0.55, 0.68, 48));
      for (const y of [0.475, -0.475]) {
        const r = mesh(ringGeo, mDouble, 0, y, 0);
        r.rotation.x = -Math.PI / 2;
        g.add(r);
        g.add(weldRing(0.68, mWeld, y, 'y'));
      }
      // 热媒进出口：中空接管 + 真孔法兰（上进口 y+0.3 / 下出口 y-0.3，与全流程接口一致）
      for (const y of [0.3, -0.3]) {
        g.add(hollowCylX(0.06, 0.012, 0.14, m, mIn, mSteel, 0.73, y, 0, 24));
        g.add(flangeHolesX(0.1, 0.035, 0.009, 4, 0.078, m, 0.8, 0.048).translateY(y));
      }
      g.userData.jacketCavity = true;
      g.userData.cavityGap = 0.112;
      g.userData.heatIn = 'y+';
      g.userData.heatOut = 'y-';
      break;
    }
    case 'head': {
      // 椭圆釜盖：外表面 + 内表面
      const headOut = cached('r15hheado', () => new THREE.SphereGeometry(0.55, 40, 18, 0, Math.PI * 2, 0, Math.PI / 2));
      const headIn = cached('r15hheadi', () => new THREE.SphereGeometry(0.528, 40, 18, 0, Math.PI * 2, 0, Math.PI / 2));
      g.add(mesh(headOut, mDouble));
      g.add(mesh(headIn, mIn, 0, 0.002, 0));
      // 釜盖法兰 + 12 条连接螺栓（与釜体法兰配对）
      g.add(flangeHolesY(0.62, 0.05, 0.014, 12, 0.585, m, -0.025, 0.528));
      g.add(boltSetY(12, 0.585, 0.013, 0.11, -0.025, mSteel, mDark));
      // 顶部辅料口：中空接管 + 真孔法兰（法兰面世界高度 2.19，与全流程 topAux 接口一致）
      g.add(hollowCylY(0.07, 0.012, 0.16, m, mIn, mSteel, 0.3, 0.46, 0, 24));
      g.add(flangeHolesY(0.12, 0.035, 0.009, 4, 0.095, m, 0.54, 0.058).translateX(0.3));
      // 人孔：中空短节 + 螺栓盲盖（教学模型将人孔并入釜盖表示）
      const mx = -0.26, mz = 0.18;
      g.add(hollowCylY(0.11, 0.015, 0.16, m, mIn, mSteel, mx, 0.48, mz, 28));
      g.add(flangeHolesY(0.16, 0.035, 0.011, 8, 0.135, m, 0.56, 0.095).translateX(mx).translateZ(mz));
      const cover = cylY(0.16, 0.03, mSteel, mx, 0.595, mz, 28);
      cover.userData.manholeCover = true;
      g.add(cover);
      g.add(boltSetY(8, 0.135, 0.01, 0.075, 0.575, mSteel, mDark, mx, mz));
      g.add(box(0.05, 0.05, 0.16, mDark, mx, 0.63, mz));
      // 仪表口：中空短节 + 小法兰
      g.add(hollowCylY(0.045, 0.01, 0.12, m, mIn, mSteel, -0.1, 0.46, -0.32, 20));
      g.add(flangeHolesY(0.08, 0.03, 0.007, 4, 0.062, m, 0.52, 0.035).translateX(-0.1).translateZ(-0.32));
      // 中心密封座短节：中空，供搅拌轴穿过，顶法兰与机械密封压盖配对
      g.add(hollowCylY(0.12, 0.015, 0.15, m, mIn, mSteel, 0, 0.515, 0, 28));
      g.add(flangeHolesY(0.17, 0.035, 0.011, 8, 0.145, m, 0.59, 0.05));
      g.userData.manhole = true;
      g.userData.headBolts = 12;
      g.userData.nozzlesHollow = true;
      break;
    }
    case 'shaft': {
      // 阶梯搅拌轴：轴身 + 上轴颈 + 联轴器毂 + 下端桨毂锁紧螺母
      g.add(cylY(0.045, 2.0, mSteel, 0, 0, 0, 24));
      g.add(cylY(0.055, 0.18, mSteel, 0, 0.91, 0, 24));
      const coupling = cylY(0.085, 0.12, mDark, 0, 0.99, 0, 24);
      coupling.userData.coupling = true;
      g.add(coupling);
      g.add(boltSetY(4, 0.065, 0.007, 0.05, 0.99, mSteel, mDark));
      g.add(cylY(0.06, 0.12, mSteel, 0, -0.94, 0, 20));
      g.add(cylY(0.05, 0.05, mDark, 0, -0.98, 0, 6));
      g.userData.shaftSteps = true;
      break;
    }
    case 'paddles': {
      // 双层四叶 45° 斜桨：桨毂 + 螺栓紧固，叶片与旋转平面成 45°
      const mP = metal(color, { rough: 0.3, metal: 0.75 });
      const bladeGeo = cached('r15pblade', () => new THREE.BoxGeometry(0.26, 0.018, 0.12));
      for (const y of [-0.25, 0.15]) {
        g.add(cylY(0.08, 0.1, mP, 0, y, 0, 24));
        g.add(boltSetY(4, 0.062, 0.007, 0.045, y + 0.05, mSteel, mDark));
        for (let i = 0; i < 4; i++) {
          const holder = new THREE.Group();
          const b = mesh(bladeGeo, mP, 0.21, y, 0);
          b.rotation.x = Math.PI / 4;
          b.userData.pitchDeg = 45;
          holder.add(b);
          holder.rotation.y = (i / 4) * Math.PI * 2 + (y > 0 ? Math.PI / 4 : 0);
          g.add(holder);
        }
      }
      g.userData.bladeCount = 4;
      g.userData.tiers = 2;
      g.userData.pitchDeg = 45;
      break;
    }
    case 'baffles': {
      // 4 块竖直挡板，与釜壁留教学间隙，壁侧焊支撑角钢
      const mB = metal(color, { rough: 0.5 });
      const bGeo = cached('r15rbaffle', () => new THREE.BoxGeometry(0.02, 0.95, 0.1));
      const bracketGeo = cached('r15rbracket', () => new THREE.BoxGeometry(0.05, 0.04, 0.08));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const b = mesh(bGeo, mB, Math.cos(a) * 0.47, 0, Math.sin(a) * 0.47);
        b.rotation.y = -a;
        g.add(b);
        for (const y of [-0.35, 0.35]) {
          const br = mesh(bracketGeo, mB, Math.cos(a) * 0.505, y, Math.sin(a) * 0.505);
          br.rotation.y = -a;
          g.add(br);
        }
      }
      g.userData.baffleCount = 4;
      g.userData.wallGap = 0.048;
      break;
    }
    case 'seal': {
      // 机械密封：压盖法兰（8 螺栓）+ 密封腔 + 动环/静环/弹簧（剖视可见）+ 轴套
      const mS = metal(color, { rough: 0.45 });
      g.add(flangeHolesY(0.17, 0.04, 0.011, 8, 0.145, mS, -0.04, 0.05));
      g.add(boltSetY(8, 0.145, 0.01, 0.07, -0.04, mSteel, mDark));
      g.add(hollowCylY(0.11, 0.02, 0.24, mS, mIn, mSteel, 0, 0.1, 0, 28));
      const stationary = torus(0.062, 0.014, metal(0x2f6f5f, { rough: 0.3, metal: 0.6 }), 0, 0.03, 0, Math.PI * 2, 10, 28);
      stationary.rotation.x = Math.PI / 2;
      stationary.userData.stationaryRing = true;
      g.add(stationary);
      const rotating = torus(0.062, 0.014, mSteel, 0, 0.075, 0, Math.PI * 2, 10, 28);
      rotating.rotation.x = Math.PI / 2;
      rotating.userData.rotatingRing = true;
      g.add(rotating);
      const spring = torus(0.075, 0.009, mSteel, 0, 0.14, 0, Math.PI * 2, 8, 28);
      spring.rotation.x = Math.PI / 2;
      spring.userData.spring = true;
      g.add(spring);
      g.add(cylY(0.05, 0.3, mIn, 0, 0.08, 0, 20));
      g.add(flangeHolesY(0.13, 0.03, 0.009, 4, 0.105, mS, 0.23, 0.05));
      g.userData.sealType = 'mechanical';
      g.userData.glandBolts = 8;
      break;
    }
    case 'drive': {
      // 驱动组件：机架（底板 + 4 立柱）+ 摆线针轮减速机（教学外形）+ 立式电机（散热筋/风罩/接线盒）
      const mD = metal(color, { rough: 0.42, metal: 0.55 });
      const plateGeo = cached('r15dplate', () => {
        const shape = new THREE.Shape();
        shape.moveTo(-0.23, -0.23); shape.lineTo(0.23, -0.23); shape.lineTo(0.23, 0.23); shape.lineTo(-0.23, 0.23); shape.closePath();
        const hole = new THREE.Path();
        hole.absarc(0, 0, 0.185, 0, Math.PI * 2, true);
        shape.holes.push(hole);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false, curveSegments: 24 });
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, -0.02, 0);
        return geo;
      });
      g.add(mesh(plateGeo, mD, 0, -0.48, 0));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        g.add(box(0.04, 0.36, 0.04, mD, Math.cos(a) * 0.17, -0.28, Math.sin(a) * 0.17));
      }
      // 减速机：箱体 + 输出轴
      g.add(cylY(0.15, 0.22, mD, 0, -0.02, 0, 28));
      g.add(box(0.32, 0.1, 0.32, mD, 0, -0.09, 0));
      g.add(cylY(0.04, 0.18, mSteel, 0, -0.21, 0, 20));
      // 电机：机身 + 散热筋 + 风罩 + 接线盒 + 吊环
      g.add(cylY(0.17, 0.45, mD, 0, 0.3, 0, 32));
      const finGeo = cached('r15dfin', () => new THREE.BoxGeometry(0.018, 0.4, 0.045));
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const f = mesh(finGeo, mD, Math.cos(a) * 0.18, 0.3, Math.sin(a) * 0.18);
        f.rotation.y = -a;
        g.add(f);
      }
      g.add(cylY(0.13, 0.07, mDark, 0, 0.56, 0, 28));
      g.add(box(0.12, 0.1, 0.09, mDark, 0.2, 0.32, 0));
      const eye = torus(0.03, 0.008, mSteel, 0, 0.62, 0, Math.PI * 2, 8, 16);
      g.add(eye);
      g.userData.framePosts = 4;
      g.userData.reducer = 'cycloidal-teaching';
      g.userData.motorFins = 12;
      break;
    }
    case 'nozzles': {
      // 侧壁进料口：中空接管 + 真孔法兰（法兰面 x=0.82 / y=0.22，与全流程 feed 接口一致）
      g.add(hollowCylX(0.075, 0.014, 0.42, m, mIn, mSteel, 0.61, 0.22, 0, 28));
      g.add(flangeHolesX(0.13, 0.04, 0.011, 8, 0.105, m, 0.82, 0.061).translateY(0.22));
      // 底部中心出料口：中空接管穿过封底 + 真孔法兰
      g.add(hollowCylY(0.06, 0.012, 0.18, m, mIn, mSteel, 0, 0.07, 0, 24));
      g.add(flangeHolesY(0.1, 0.035, 0.009, 4, 0.078, m, -0.02, 0.048));
      g.userData.feedPort = 'x+';
      g.userData.dischargePort = 'y-';
      g.userData.nozzlesHollow = true;
      break;
    }
    case 'legs': {
      // 4 条支腿 + 底板 + 地脚螺栓 + 加强筋
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const x = Math.cos(a) * 0.45, z = Math.sin(a) * 0.45;
        g.add(box(0.08, 0.55, 0.08, m, x, 0, z));
        g.add(box(0.18, 0.04, 0.18, mDark, x, -0.27, z));
        for (const sx of [-0.065, 0.065]) for (const sz of [-0.065, 0.065]) {
          g.add(cylY(0.011, 0.06, mSteel, x + sx, -0.25, z + sz, 8));
        }
        const gusset = box(0.06, 0.1, 0.02, m, x, 0.2, z);
        gusset.rotation.y = -a;
        g.add(gusset);
      }
      g.userData.legCount = 4;
      g.userData.anchorBolts = 16;
      break;
    }
  }
  return g;
}

/* ===================== 第三批扩展设备（教学示意） ===================== */

function torusX(r: number, tube: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 28): THREE.Mesh {
  const t = mesh(cached(`tx${r}|${tube}|${seg}`, () => new THREE.TorusGeometry(r, tube, 10, seg)), m, x, y, z);
  t.rotation.y = Math.PI / 2;
  return t;
}
function torusY(r: number, tube: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 28): THREE.Mesh {
  const t = mesh(cached(`ty${r}|${tube}|${seg}`, () => new THREE.TorusGeometry(r, tube, 10, seg)), m, x, y, z);
  t.rotation.x = Math.PI / 2;
  return t;
}
/** 齿轮：沿 X 轴的齿圈 */
function gearMesh(r: number, len: number, teeth: number, m: THREE.Material): THREE.Group {
  const grp = new THREE.Group();
  grp.add(cylX(r, len, m));
  grp.add(cylX(r * 0.32, len + 0.04, metal(0x374151, { rough: 0.5 })));
  const toothGeo = cached(`tooth${r}|${len}`, () => new THREE.BoxGeometry(len, r * 0.24, r * 0.2));
  for (let i = 0; i < teeth; i++) {
    const holder = new THREE.Group();
    holder.add(mesh(toothGeo, m, 0, r + r * 0.1, 0));
    holder.rotation.x = (i / teeth) * Math.PI * 2;
    grp.add(holder);
  }
  return grp;
}
/** 液位演示网格：interaction 按 userData 调节高度 */
function liquidMesh(r: number, maxH: number, bottomY: number, color = 0x2e9bd6): THREE.Mesh {
  const me = cylY(r, maxH, metal(color, { rough: 0.15, metal: 0.1 }), 0, bottomY + maxH / 2, 0, 28);
  me.name = 'demo-liquid';
  me.userData.baseH = maxH;
  me.userData.bottomY = bottomY;
  me.castShadow = false;
  return me;
}

const GEAR_TAU = Math.PI * 2;

/** 两个等半径圆相交的外轮廓（形状 x→世界 Y，形状 y→世界 Z），用于 8 字形泵体与端盖。 */
function figure8Shape(radius: number, half: number): THREE.Shape {
  const y = Math.sqrt(Math.max(1e-6, radius * radius - half * half));
  const rightUpper = Math.atan2(y, -half);
  const rightLower = Math.atan2(-y, -half);
  const leftLower = Math.atan2(-y, half);
  const leftUpper = Math.atan2(y, half);
  const pts: THREE.Vector2[] = [];
  const arc = (cx: number, a0: number, a1: number, n: number) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      pts.push(new THREE.Vector2(cx + Math.cos(a) * radius, Math.sin(a) * radius));
    }
  };
  arc(half, rightUpper, rightLower - GEAR_TAU, 64);
  arc(-half, leftLower, leftUpper - GEAR_TAU, 64);
  const unique: THREE.Vector2[] = [];
  for (const p of pts) if (!unique.length || p.distanceTo(unique[unique.length - 1]) > 1e-5) unique.push(p);
  if (unique.length > 1 && unique[0].distanceTo(unique[unique.length - 1]) < 1e-5) unique.pop();
  const shape = new THREE.Shape();
  shape.moveTo(unique[0].x, unique[0].y);
  for (let i = 1; i < unique.length; i++) shape.lineTo(unique[i].x, unique[i].y);
  shape.closePath();
  return shape;
}

/** 直齿圆柱齿轮的教学型线（梯形齿，非厂商型线），轴线沿 X。 */
function spurGearGeometry(key: string, pitchR: number, teeth: number, phase: number, thickness: number): THREE.BufferGeometry {
  return cached(key, () => {
    const tipR = pitchR + 0.022;
    const rootR = pitchR - 0.022;
    const pitch = GEAR_TAU / teeth;
    const rootHalf = pitch * 0.30;
    const tipHalf = pitch * 0.20;
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < teeth; i++) {
      const a = phase + i * pitch;
      pts.push(new THREE.Vector2(Math.cos(a - rootHalf) * rootR, Math.sin(a - rootHalf) * rootR));
      pts.push(new THREE.Vector2(Math.cos(a - tipHalf) * tipR, Math.sin(a - tipHalf) * tipR));
      pts.push(new THREE.Vector2(Math.cos(a + tipHalf) * tipR, Math.sin(a + tipHalf) * tipR));
      pts.push(new THREE.Vector2(Math.cos(a + rootHalf) * rootR, Math.sin(a + rootHalf) * rootR));
      const gapStart = a + rootHalf;
      const gapEnd = a + pitch - rootHalf;
      for (let s = 1; s <= 3; s++) {
        const ang = gapStart + (gapEnd - gapStart) * (s / 3);
        pts.push(new THREE.Vector2(Math.cos(ang) * rootR, Math.sin(ang) * rootR));
      }
    }
    const shape = new THREE.Shape();
    shape.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].y);
    shape.closePath();
    const bore = new THREE.Path();
    bore.absarc(0, 0, 0.045, 0, GEAR_TAU, true);
    shape.holes.push(bore);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 2 });
    geo.translate(0, 0, -thickness / 2);
    geo.rotateY(Math.PI / 2);
    return geo;
  });
}

function gearPort(zSign: 1 | -1, color: number, mBody: THREE.Material, mSteel: THREE.Material): THREE.Group {
  const grp = new THREE.Group();
  const accent = metal(color, { rough: 0.4, metal: 0.35 });
  const pipe = ring(0.115, 0.09, 0.18, mBody);
  orient(pipe, 'z', [0, 0, zSign * 0.33]);
  grp.add(pipe);
  const flange = ring(0.16, 0.09, 0.035, mSteel);
  orient(flange, 'z', [0, 0, zSign * 0.43]);
  grp.add(flange);
  const band = ring(0.125, 0.115, 0.035, accent);
  orient(band, 'z', [0, 0, zSign * 0.30]);
  grp.add(band);
  for (const [bx, by] of [[0.13, 0], [-0.13, 0], [0, 0.13], [0, -0.13]]) {
    const bolt = new THREE.Mesh(cached('gear-port-bolt', () => new THREE.CylinderGeometry(0.012, 0.012, 0.05, 8)), mSteel);
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(bx, by, zSign * 0.44);
    bolt.castShadow = true;
    grp.add(bolt);
  }
  return grp;
}

function gearPumpPart(id: string, color: number): THREE.Group {
  const g = new THREE.Group();
  const m = metal(color);
  const mSteel = metal(0xc7ccd4, { rough: 0.25, metal: 0.85 });
  const mDark = metal(0x374151, { rough: 0.5 });
  switch (id) {
    case 'casing': {
      const mS = metal(color, { rough: 0.58, metal: 0.25, double: true });
      const body = new THREE.Mesh(plateGeometry('gear-casing-v2', figure8Shape(0.30, 0.34), 0.26), mS);
      body.updateMatrix();
      let solid = CSG.fromMesh(body);
      for (const cy of [0.17, -0.17]) {
        const bore = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.34, 40), mS);
        bore.rotation.z = Math.PI / 2;
        bore.position.set(0, cy, 0);
        bore.updateMatrix();
        solid = solid.subtract(CSG.fromMesh(bore));
        bore.geometry.dispose();
      }
      for (const zSign of [1, -1]) {
        const channel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.34, 24), mS);
        channel.rotation.x = Math.PI / 2;
        channel.position.set(0, 0, zSign * 0.17);
        channel.updateMatrix();
        solid = solid.subtract(CSG.fromMesh(channel));
        channel.geometry.dispose();
      }
      const cut = toCreasedNormals(cleanTriangles(CSG.toGeometry(solid, new THREE.Matrix4())), Math.PI / 4);
      const shell = new THREE.Mesh(cut, mS);
      shell.castShadow = true;
      shell.receiveShadow = true;
      g.add(shell);

      const rearShape = figure8Shape(0.30, 0.34);
      const driveHole = new THREE.Path(); driveHole.absarc(0.17, 0, 0.05, 0, GEAR_TAU, true);
      const idlerHole = new THREE.Path(); idlerHole.absarc(-0.17, 0, 0.04, 0, GEAR_TAU, true);
      rearShape.holes.push(driveHole, idlerHole);
      const rear = new THREE.Mesh(plateGeometry('gear-rear-plate-v2', rearShape, 0.03), m);
      rear.position.x = -0.145;
      rear.castShadow = true;
      rear.receiveShadow = true;
      g.add(rear);
      g.add(cylX(0.085, 0.06, m, -0.175, 0.17, 0));

      g.add(gearPort(1, 0x2f8fe6, m, mSteel));
      g.add(gearPort(-1, 0xd97706, m, mSteel));

      g.add(box(0.5, 0.07, 0.42, mDark, 0, -0.52, 0));
      g.add(box(0.64, 0.03, 0.52, mDark, 0, -0.565, 0));
      g.userData.suctionPort = 'z+';
      g.userData.dischargePort = 'z-';
      g.userData.boreRadius = 0.205;
      g.userData.centerDistance = 0.34;
      g.userData.gearTipClearance = 0.013;
      break;
    }
    case 'idlerGear': {
      const gear = new THREE.Mesh(spurGearGeometry('gear-idler-v2', 0.17, 12, Math.PI / 12, 0.16), metal(color, { rough: 0.28, metal: 0.8 }));
      gear.castShadow = true;
      gear.receiveShadow = true;
      g.add(gear);
      g.add(cylX(0.058, 0.19, mSteel));
      g.add(cylX(0.038, 0.32, mSteel));
      g.userData.teeth = 12;
      g.userData.phase = Math.PI / 12;
      g.userData.teachingToothProfile = true;
      break;
    }
    case 'driveGear': {
      const gear = new THREE.Mesh(spurGearGeometry('gear-drive-v2', 0.17, 12, 0, 0.16), metal(color, { rough: 0.28, metal: 0.8 }));
      gear.castShadow = true;
      gear.receiveShadow = true;
      g.add(gear);
      g.add(cylX(0.058, 0.20, mSteel));
      g.add(box(0.10, 0.012, 0.022, mDark, 0, 0.05, 0));
      g.userData.teeth = 12;
      g.userData.phase = 0;
      g.userData.teachingToothProfile = true;
      break;
    }
    case 'shaft': {
      g.add(cylX(0.038, 0.8, mSteel, -0.075));
      g.add(cylX(0.05, 0.10, mSteel, 0.24));
      g.add(cylX(0.05, 0.08, mSteel, -0.34));
      g.add(box(0.10, 0.012, 0.022, mDark, -0.3, 0.042, 0));
      break;
    }
    case 'seal': {
      const mS = metal(color, { rough: 0.5 });
      g.add(cylX(0.078, 0.06, mS));
      g.add(torusX(0.052, 0.012, mDark, 0.03));
      break;
    }
    case 'bearing': {
      g.add(cylX(0.088, 0.08, m));
      g.add(torusX(0.062, 0.02, mSteel));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.add(mesh(cached('gpball', () => new THREE.SphereGeometry(0.014, 10, 8)), mSteel, 0, Math.cos(a) * 0.062, Math.sin(a) * 0.062));
      }
      break;
    }
    case 'cover': {
      const mC = metal(color, { rough: 0.5, metal: 0.3, double: true });
      const shape = figure8Shape(0.30, 0.34);
      const driveHole = new THREE.Path(); driveHole.absarc(0.17, 0, 0.05, 0, GEAR_TAU, true);
      const idlerHole = new THREE.Path(); idlerHole.absarc(-0.17, 0, 0.04, 0, GEAR_TAU, true);
      shape.holes.push(driveHole, idlerHole);
      const plateMesh = new THREE.Mesh(plateGeometry('gear-cover-v2', shape, 0.06), mC);
      plateMesh.castShadow = true;
      plateMesh.receiveShadow = true;
      g.add(plateMesh);
      const gasket = new THREE.Mesh(plateGeometry('gear-cover-gasket-v2', figure8Shape(0.295, 0.34), 0.012), mDark);
      gasket.position.x = -0.036;
      g.add(gasket);
      const boss = ring(0.10, 0.05, 0.20, m);
      orient(boss, 'x', [0.07, 0.17, 0]);
      g.add(boss);
      const idlerBoss = ring(0.07, 0.038, 0.06, m);
      orient(idlerBoss, 'x', [-0.01, -0.17, 0]);
      g.add(idlerBoss);
      for (const cy of [0.17, -0.17]) {
        for (const deg of [45, 135, 225, 315]) {
          const a = (deg * Math.PI) / 180;
          g.add(cylX(0.016, 0.05, mSteel, 0.045, cy + Math.cos(a) * 0.25, Math.sin(a) * 0.25));
        }
      }
      g.userData.boltCount = 8;
      break;
    }
  }
  return g;
}

function checkValveUnit(
  x: number, y: number, chamber: 'L' | 'R', line: 'in' | 'out',
  mBody: THREE.Material, mSteel: THREE.Material, mSeat: THREE.Material
): THREE.Group {
  const grp = new THREE.Group();
  const len = 0.16;
  const lower = y - len / 2;
  const upper = y + len / 2;
  grp.add(torusY(0.075, 0.008, mBody, x, lower));
  grp.add(torusY(0.075, 0.008, mBody, x, upper));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    grp.add(cylY(0.006, len, mBody, x + Math.cos(a) * 0.075, y, Math.sin(a) * 0.075));
  }
  grp.add(torusY(0.06, 0.009, mSeat, x, lower + 0.012));
  const ball = new THREE.Mesh(cached('dp-ball-v2', () => new THREE.SphereGeometry(0.045, 18, 14)), mSteel);
  ball.position.set(x, lower + 0.055, 0);
  ball.castShadow = true;
  ball.receiveShadow = true;
  ball.userData.valve = { chamber, line, restY: lower + 0.055, openY: lower + 0.09 };
  grp.add(ball);
  return grp;
}

function diaphragmPart(id: string, color: number): THREE.Group {
  const g = new THREE.Group();
  const m = metal(color);
  const mSteel = metal(0xc7ccd4, { rough: 0.25, metal: 0.85 });
  const mDark = metal(0x374151, { rough: 0.5 });
  switch (id) {
    case 'airChamber': {
      const mS = metal(color, { rough: 0.55, metal: 0.3, double: true });
      g.add(box(0.28, 0.42, 0.3, mS));
      for (const s of [-1, 1]) {
        const tube = ring(0.24, 0.225, 0.21, mS);
        orient(tube, 'x', [s * 0.245, 0, 0]);
        g.add(tube);
        const flange = ring(0.27, 0.215, 0.03, mSteel);
        orient(flange, 'x', [s * 0.35, 0, 0]);
        g.add(flange);
        g.add(boltRingX(6, 0.245, 0.013, 0.05, mSteel, s * 0.36));
      }
      const airPipe = ring(0.06, 0.045, 0.18, m);
      orient(airPipe, 'z', [0, 0, 0.24]);
      g.add(airPipe);
      const airFlange = ring(0.09, 0.045, 0.03, mSteel);
      orient(airFlange, 'z', [0, 0, 0.33]);
      g.add(airFlange);
      for (const [bx, by] of [[0.06, 0], [-0.06, 0], [0, 0.06], [0, -0.06]] as [number, number][]) {
        const bolt = new THREE.Mesh(cached('dp-air-bolt', () => new THREE.CylinderGeometry(0.009, 0.009, 0.04, 8)), mSteel);
        bolt.rotation.x = Math.PI / 2;
        bolt.position.set(bx, by, 0.34);
        g.add(bolt);
      }
      g.add(box(1.15, 0.06, 0.4, mDark, 0, -0.5, 0));
      for (const s of [-1, 1]) g.add(box(0.1, 0.06, 0.3, mDark, s * 0.45, -0.55, 0));
      g.add(box(0.3, 0.26, 0.28, mDark, 0, -0.38, 0));
      g.userData.airInlet = 'z+';
      g.userData.baseY = 0.19;
      break;
    }
    case 'link': {
      g.add(cylX(0.03, 0.74, mSteel));
      g.add(cylX(0.05, 0.06, mSteel, -0.37));
      g.add(cylX(0.05, 0.06, mSteel, 0.37));
      break;
    }
    case 'diaphragmL':
    case 'diaphragmR': {
      const mD = metal(color, { rough: 0.6, metal: 0.1 });
      const rim = ring(0.245, 0.215, 0.03, mD);
      orient(rim, 'x', [0, 0, 0]);
      g.add(rim);
      const center = new THREE.Group();
      center.userData.diaphragmCenter = true;
      center.add(cylX(0.215, 0.03, mD));
      center.add(torusX(0.20, 0.012, mD, 0.02));
      center.add(torusX(0.15, 0.012, mD, 0.02));
      center.add(cylX(0.05, 0.06, mSteel));
      g.add(center);
      g.userData.clampedEdge = 0.245;
      break;
    }
    case 'chamberL':
    case 'chamberR': {
      const s = id === 'chamberL' ? -1 : 1;
      const mS = metal(color, { rough: 0.55, metal: 0.3, double: true });
      const tubeMesh = ring(0.26, 0.245, 0.18, mS);
      tubeMesh.updateMatrix();
      let solid = CSG.fromMesh(tubeMesh);
      for (const ys of [1, -1]) {
        const tool = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 24), mS);
        tool.position.set(0, ys * 0.25, 0);
        tool.updateMatrix();
        solid = solid.subtract(CSG.fromMesh(tool));
        tool.geometry.dispose();
      }
      const shellGeo = toCreasedNormals(cleanTriangles(CSG.toGeometry(solid, new THREE.Matrix4())), Math.PI / 4);
      const shell = new THREE.Mesh(shellGeo, mS);
      shell.castShadow = true;
      shell.receiveShadow = true;
      g.add(shell);
      const innerX = -s * 0.09;
      const flange = ring(0.27, 0.215, 0.03, m);
      orient(flange, 'x', [innerX, 0, 0]);
      g.add(flange);
      g.add(dome(0.26, mS, s, s * 0.09));
      for (const ys of [1, -1]) {
        const neck = ring(0.075, 0.058, 0.14, m);
        orient(neck, 'y', [0, ys * 0.30, 0]);
        g.add(neck);
        const fl = ring(0.10, 0.058, 0.03, mSteel);
        orient(fl, 'y', [0, ys * 0.37, 0]);
        g.add(fl);
      }
      g.userData.portBore = 0.058;
      g.userData.clampedEdge = 0.245;
      break;
    }
    case 'checkBalls': {
      const mB = metal(color, { rough: 0.35, metal: 0.5 });
      const mSeat = metal(0x374151, { rough: 0.6 });
      for (const x of [-0.47, 0.47]) {
        for (const y of [-0.28, 0.28]) {
          g.add(checkValveUnit(x, y, x < 0 ? 'L' : 'R', y < 0 ? 'in' : 'out', mB, mSteel, mSeat));
        }
      }
      g.userData.valveCount = 4;
      break;
    }
    case 'manifoldIn':
    case 'manifoldOut': {
      const pipe = ring(0.08, 0.06, 1.15, m);
      orient(pipe, 'x', [0, 0, 0]);
      g.add(pipe);
      for (const xs of [-0.58, 0.58]) {
        g.add(flangeHolesX(0.12, 0.04, 0.016, 4, 0.09, mSteel, xs, 0.06));
      }
      const dir = id === 'manifoldIn' ? 1 : -1;
      for (const x of [-0.47, 0.47]) {
        const stub = ring(0.07, 0.055, 0.10, m);
        orient(stub, 'y', [x, dir * 0.05, 0]);
        g.add(stub);
      }
      g.userData.branchCount = 2;
      break;
    }
  }
  return g;
}

function bagFilterPart(id: string, color: number): THREE.Group {
  const g = new THREE.Group();
  const m = metal(color);
  const mSteel = metal(0xc7ccd4, { rough: 0.25, metal: 0.85 });
  const mDark = metal(0x374151, { rough: 0.5 });
  switch (id) {
    case 'shell': {
      const mS = metal(color, { double: true });
      const tube = cached('bftube', () => new THREE.CylinderGeometry(0.26, 0.26, 0.78, 32, 1, true));
      g.add(mesh(tube, mS));
      g.add(dome(0.26, mS, 'down', 0, -0.39));
      g.add(flangeY(0.3, m, 0, 0.4));
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        g.add(box(0.06, 0.3, 0.06, mDark, Math.cos(a) * 0.24, -0.55, Math.sin(a) * 0.24));
      }
      break;
    }
    case 'basket': {
      const mB = metal(color, { rough: 0.4, double: true });
      const tube = cached('bfbasket', () => new THREE.CylinderGeometry(0.2, 0.2, 0.6, 24, 1, true));
      g.add(mesh(tube, mB));
      for (const y of [-0.25, -0.1, 0.05, 0.2]) g.add(torusY(0.2, 0.01, mB, 0, y));
      g.add(cylY(0.2, 0.02, mB, 0, -0.3));
      g.add(torusY(0.21, 0.015, mSteel, 0, 0.3));
      break;
    }
    case 'bag': {
      const mF = metal(color, { rough: 0.8, metal: 0.02, double: true });
      const tube = cached('bfbag', () => new THREE.CylinderGeometry(0.175, 0.16, 0.58, 24, 1, true));
      g.add(mesh(tube, mF, 0, -0.02));
      g.add(cylY(0.16, 0.02, mF, 0, -0.31));
      g.add(torusY(0.18, 0.018, mSteel, 0, 0.28));
      break;
    }
    case 'seal': {
      g.add(torusY(0.27, 0.02, metal(color, { rough: 0.6, metal: 0.05 })));
      break;
    }
    case 'cover': {
      const mC = metal(color, { double: true });
      g.add(dome(0.28, mC, 'up'));
      g.add(flangeY(0.3, m, 0, -0.01));
      g.add(boltRingX(6, 0.27, 0.016, 0.07, mSteel, 0).rotateX(Math.PI / 2));
      g.add(cylY(0.025, 0.16, mSteel, 0, 0.3));
      g.add(box(0.2, 0.03, 0.04, mDark, 0.08, 0.38));
      g.add(box(0.04, 0.3, 0.04, m, -0.26, 0.1));
      break;
    }
    case 'nozzles': {
      g.add(cylX(0.07, 0.16, m, 0.32, 0.88));
      g.add(flangeX(0.11, m, 0.4, 0.88));
      g.add(cylX(0.07, 0.16, m, 0.32, 0.32));
      g.add(flangeX(0.11, m, 0.4, 0.32));
      g.add(cylY(0.04, 0.1, m, 0, 0.14));
      break;
    }
  }
  return g;
}

const Y_STRAINER_BOLTS = circleHoles(4, 0.115, 0.012);
function yStrainerPart(id: string, color: number): THREE.Group {
  const g = new THREE.Group();
  const m = materialSet(color);
  const angle = Math.PI / 4;
  switch (id) {
    case 'body': {
      const shellGeo = cachedGeo('y-strainer-shell-v2', () => {
        const cylinder = (radius: number, length: number, x: number, y: number, rotation: number) => {
          const item = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 48));
          item.position.set(x, y, 0); item.rotation.z = rotation; item.updateMatrix();
          return item;
        };
        const outerMain = cylinder(0.11, 0.5, 0, 0, Math.PI / 2);
        const outerBranch = cylinder(0.095, 0.36, 0.127279, -0.127279, angle);
        const innerMain = cylinder(0.092, 0.55, 0, 0, Math.PI / 2);
        const innerBranch = cylinder(0.08, 0.44, 0.127279, -0.127279, angle);
        const solid = CSG.fromMesh(outerMain).union(CSG.fromMesh(outerBranch))
          .subtract(CSG.fromMesh(innerMain)).subtract(CSG.fromMesh(innerBranch));
        return cleanTriangles(CSG.toGeometry(solid, new THREE.Matrix4()));
      });
      g.add(mesh(shellGeo, m.castDouble));
      // A transverse divider directs the inlet through the screen opening.
      const dividerGeo = cachedGeo('y-strainer-divider-v3', () => {
        const main = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.092, 0.55, 48));
        main.rotation.z = Math.PI / 2; main.updateMatrix();
        const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.44, 48));
        branch.rotation.z = angle; branch.position.set(0.127279, -0.127279, 0); branch.updateMatrix();
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.6, 0.4));
        plate.position.x = 0.04243; plate.updateMatrix();
        const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.074, 0.074, 0.8, 48));
        hole.rotation.z = angle; hole.position.set(0.127279, -0.127279, 0); hole.updateMatrix();
        const voids = CSG.fromMesh(main).union(CSG.fromMesh(branch));
        return cleanTriangles(CSG.toGeometry(CSG.fromMesh(plate).intersect(voids).subtract(CSG.fromMesh(hole)), new THREE.Matrix4()));
      });
      g.add(mesh(dividerGeo, m.castDouble));
      const sleeve = hollowCylY(0.074, 0.004, 0.17, m.castDouble, m.machinedIn, m.cut);
      sleeve.rotation.z = angle; sleeve.position.set(0.0424264, -0.0424264, 0);
      g.add(sleeve);
      const flange = flangeHolesY(0.14, 0.025, Y_STRAINER_BOLTS[0].r, Y_STRAINER_BOLTS.length, Y_STRAINER_BOLTS[0].u, m.cast, 0, 0.08);
      flange.rotation.z = angle; flange.position.set(0.25456, -0.25456, 0); g.add(flange);
      break;
    }
    case 'screen': {
      const material = metal(color, { rough: 0.35, double: true });
      // Open wire lattice illustrates perforations without implying a mesh specification.
      for (let i = 0; i < 24; i++) {
        const a = i * Math.PI * 2 / 24;
        g.add(cylY(0.0015, 0.22, material, Math.cos(a) * 0.072, -0.04, Math.sin(a) * 0.072));
      }
      for (let y = -0.15; y <= 0.071; y += 0.02) g.add(torusY(0.072, 0.0015, material, 0, y));
      g.add(cylY(0.072, 0.008, material, 0, -0.15));
      break;
    }
    case 'gasket': g.add(torusY(0.099, 0.008, m.rubber)); break;
    case 'cover': {
      g.add(flangeHolesY(0.14, 0.035, Y_STRAINER_BOLTS[0].r, Y_STRAINER_BOLTS.length, Y_STRAINER_BOLTS[0].u, m.cast));
      g.add(cylY(0.025, 0.025, m.dark, 0, -0.03));
      break;
    }
    case 'coverBolts': {
      g.add(orient(fasteners(Y_STRAINER_BOLTS, 0.065, 0.009, m.machined), 'y'));
      break;
    }
    case 'ports': {
      g.add(flangeHolesX(0.16, 0.035, 0.012, 4, 0.13, m.cast, -0.26, 0.092));
      g.add(flangeHolesX(0.16, 0.035, 0.012, 4, 0.13, m.cast, 0.26, 0.092));
      break;
    }
    default: throw new Error('Y型过滤器缺少几何：' + id);
  }
  return g;
}

function tankPart(id: string, color: number): THREE.Group {
  const g = new THREE.Group();
  const m = metal(color);
  const mSteel = metal(0xc7ccd4, { rough: 0.25, metal: 0.85 });
  const mDark = metal(0x374151, { rough: 0.5 });
  switch (id) {
    case 'bottom': {
      g.add(cylY(0.7, 0.06, m, 0, 0, 0, 40));
      g.add(torusY(0.68, 0.025, mDark, 0, 0.03));
      break;
    }
    case 'shell': {
      const mS = metal(color, { double: true });
      const tube = cached('tktube', () => new THREE.CylinderGeometry(0.7, 0.7, 1.6, 40, 1, true));
      g.add(mesh(tube, mS));
      for (const y of [-0.4, 0, 0.4]) g.add(torusY(0.705, 0.012, mDark, 0, y));
      g.add(liquidMesh(0.68, 1.5, -0.78));
      break;
    }
    case 'roof': {
      const mR = metal(color, { double: true });
      g.add(mesh(cached('tkroof', () => new THREE.CylinderGeometry(0.08, 0.72, 0.22, 40)), mR));
      g.add(torusY(0.71, 0.02, mDark, 0, -0.11));
      g.add(cylY(0.07, 0.1, mR, 0, 0.14));
      break;
    }
    case 'vent': {
      const mV = metal(color, { rough: 0.4 });
      g.add(cylY(0.07, 0.14, mV));
      g.add(cylY(0.09, 0.04, mV, 0, 0.08));
      g.add(dome(0.09, mV, 'up', 0, 0.1));
      g.add(flangeY(0.11, m, 0, -0.08));
      g.add(cylY(0.05, 0.06, mSteel, 0.08, 0.02));
      break;
    }
    case 'manwayNeck': {
      g.add(cylX(0.16, 0.14, m));
      g.add(flangeX(0.22, m, 0.08));
      g.add(torusX(0.17, 0.015, mDark, -0.06));
      break;
    }
    case 'manwayCover': {
      g.add(cylX(0.21, 0.04, m));
      g.add(boltRingX(8, 0.18, 0.015, 0.07, mSteel, 0));
      g.add(box(0.04, 0.12, 0.03, mDark, 0.03, 0));
      g.add(torusX(0.05, 0.012, mSteel, 0.05, 0.08));
      break;
    }
    case 'nozzles': {
      g.add(cylY(0.07, 0.24, m, 0.3, 1.95));
      g.add(flangeY(0.11, m, 0.3, 2.08));
      g.add(cylX(0.08, 0.18, m, 0.78, 0.28));
      g.add(flangeX(0.13, m, 0.88, 0.28));
      g.add(cylY(0.04, 0.1, m, 0, 0.05));
      break;
    }
    case 'levelGauge': {
      const mG = metal(color, { rough: 0.4 });
      const glass = cylY(0.03, 1.3, metal(0xbfe3f2, { rough: 0.1, metal: 0.05 }), 0, 0, 0, 16);
      glass.name = 'gauge-glass';
      g.add(glass);
      g.add(liquidMesh(0.022, 1.2, -0.63));
      g.add(box(0.05, 1.34, 0.015, metal(0xe8e4d8, { rough: 0.7, metal: 0.05 }), 0, 0, -0.04));
      for (const y of [0.62, -0.62]) {
        g.add(cylX(0.035, 0.14, mG, -0.08, y));
        g.add(box(0.06, 0.06, 0.06, mG, -0.14, y));
      }
      break;
    }
  }
  return g;
}

function separatorPart(id: string, color: number): THREE.Group {
  const g = new THREE.Group();
  const m = metal(color);
  const mSteel = metal(0xc7ccd4, { rough: 0.25, metal: 0.85 });
  const mDark = metal(0x374151, { rough: 0.5 });
  switch (id) {
    case 'legs': {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        g.add(box(0.07, 0.4, 0.07, m, Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32));
        g.add(box(0.16, 0.04, 0.16, mDark, Math.cos(a) * 0.32, -0.2, Math.sin(a) * 0.32));
      }
      break;
    }
    case 'shell': {
      const mS = metal(color, { double: true });
      const tube = cached('gstube', () => new THREE.CylinderGeometry(0.4, 0.4, 1.3, 32, 1, true));
      g.add(mesh(tube, mS));
      g.add(dome(0.4, mS, 'up', 0, 0.65));
      g.add(dome(0.4, mS, 'down', 0, -0.65));
      g.add(liquidMesh(0.38, 0.5, -0.63));
      break;
    }
    case 'inletBaffle': {
      g.add(cylX(0.08, 0.2, m, 0.14));
      g.add(flangeX(0.12, m, 0.24));
      g.add(box(0.02, 0.3, 0.3, metal(color, { double: true }), -0.12, -0.05));
      break;
    }
    case 'demister': {
      const mD = metal(color, { rough: 0.5, double: true });
      g.add(cylY(0.36, 0.12, mD, 0, 0, 0, 28));
      for (const y of [-0.04, 0, 0.04]) g.add(torusY(0.36, 0.008, mSteel, 0, y));
      g.add(torusY(0.36, 0.015, m, 0, 0.06));
      g.add(box(0.1, 0.06, 0.03, mSteel, 0, 0.1));
      break;
    }
    case 'manwayCover': {
      g.add(cylX(0.13, 0.1, m, -0.06));
      g.add(cylX(0.15, 0.04, m, 0.02));
      g.add(boltRingX(6, 0.12, 0.013, 0.06, mSteel, 0.02));
      g.add(box(0.03, 0.09, 0.025, mDark, 0.05, 0));
      break;
    }
    case 'levelGauge': {
      const mG = metal(color, { rough: 0.4 });
      g.add(cylY(0.025, 0.7, metal(0xbfe3f2, { rough: 0.1, metal: 0.05 }), 0, 0, 0, 14));
      g.add(liquidMesh(0.018, 0.6, -0.33));
      for (const y of [0.32, -0.32]) {
        g.add(cylX(0.03, 0.12, mG, -0.07, y));
        g.add(box(0.05, 0.05, 0.05, mG, -0.12, y));
      }
      break;
    }
    case 'nozzles': {
      g.add(cylY(0.08, 0.2, m, 0, 1.72));
      g.add(flangeY(0.12, m, 0, 1.83));
      g.add(cylX(0.06, 0.16, m, 0.36, 0.32));
      g.add(flangeX(0.1, m, 0.45, 0.32));
      g.add(cylY(0.035, 0.08, m, 0, 0.22));
      break;
    }
  }
  return g;
}

function towerPart(id: string, color: number): THREE.Group {
  const g = new THREE.Group();
  const m = metal(color);
  const mSteel = metal(0xc7ccd4, { rough: 0.25, metal: 0.85 });
  const mDark = metal(0x374151, { rough: 0.5 });
  const packingBed = (mm: THREE.Material) => {
    const bed = new THREE.Group();
    const tube = cached('ptbed', () => new THREE.CylinderGeometry(0.3, 0.3, 0.5, 28, 1, true));
    bed.add(mesh(tube, metal(0x8a97a5, { rough: 0.5, double: true })));
    const sheet = cached('ptsheet', () => new THREE.BoxGeometry(0.56, 0.46, 0.012));
    for (let i = 0; i < 6; i++) {
      const s = mesh(sheet, mm, 0, 0, -0.2 + i * 0.08);
      s.rotation.y = i % 2 ? 0.5 : -0.5;
      bed.add(s);
    }
    bed.add(torusY(0.3, 0.015, mSteel, 0, 0.25));
    bed.add(torusY(0.3, 0.015, mSteel, 0, -0.25));
    return bed;
  };
  switch (id) {
    case 'skirt': {
      const tube = cached('ptskirt', () => new THREE.CylinderGeometry(0.36, 0.38, 0.5, 32, 1, true));
      g.add(mesh(tube, metal(color, { double: true })));
      g.add(torusY(0.39, 0.025, mDark, 0, -0.25));
      break;
    }
    case 'shell': {
      const mS = metal(color, { double: true });
      const tube = cached('pttube', () => new THREE.CylinderGeometry(0.35, 0.35, 2.0, 32, 1, true));
      g.add(mesh(tube, mS));
      g.add(flangeY(0.4, m, 0, 1.0));
      g.add(flangeY(0.4, m, 0, -1.0));
      for (const y of [-0.5, 0, 0.5]) g.add(torusY(0.355, 0.01, mDark, 0, y));
      break;
    }
    case 'support': {
      g.add(cylY(0.33, 0.03, metal(color, { double: true }), 0, 0, 0, 28));
      for (let i = 0; i < 5; i++) g.add(box(0.62, 0.05, 0.02, mSteel, 0, -0.03, -0.24 + i * 0.12));
      g.add(torusY(0.33, 0.015, m, 0, 0.02));
      break;
    }
    case 'packing1': {
      g.add(packingBed(metal(color, { rough: 0.35, metal: 0.7 })));
      break;
    }
    case 'packing2': {
      g.add(packingBed(metal(color, { rough: 0.35, metal: 0.7 })));
      break;
    }
    case 'distributor': {
      const mD = metal(color, { rough: 0.4 });
      g.add(cylY(0.32, 0.03, mD, 0, 0, 0, 28));
      for (const z of [-0.16, 0, 0.16]) g.add(box(0.56, 0.07, 0.06, mD, 0, 0.05, z));
      for (let i = 0; i < 7; i++) g.add(cylY(0.015, 0.08, mSteel, -0.24 + i * 0.08, -0.05, 0));
      g.add(cylY(0.05, 0.12, mD, 0, 0.12));
      break;
    }
    case 'nozzles': {
      g.add(cylX(0.09, 0.16, m, 0.42, 0.4));
      g.add(flangeX(0.13, m, 0.5, 0.4));
      g.add(cylY(0.08, 0.18, m, 0, 2.32));
      g.add(flangeY(0.12, m, 0, 2.42));
      g.add(cylX(0.06, 0.16, m, 0.42, 2.0));
      g.add(flangeX(0.1, m, 0.5, 2.0));
      g.add(cylX(0.06, 0.16, m, 0.42, 0.18));
      g.add(flangeX(0.1, m, 0.5, 0.18));
      break;
    }
  }
  return g;
}

function cyclonePart(id: string, color: number): THREE.Group {
  const g = new THREE.Group();
  const m = metal(color);
  const mSteel = metal(0xc7ccd4, { rough: 0.25, metal: 0.85 });
  const mDark = metal(0x374151, { rough: 0.5 });
  switch (id) {
    case 'legs': {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        g.add(box(0.06, 0.6, 0.06, m, Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3));
        g.add(box(0.14, 0.04, 0.14, mDark, Math.cos(a) * 0.3, -0.3, Math.sin(a) * 0.3));
      }
      break;
    }
    case 'cylinder': {
      const mS = metal(color, { double: true });
      const tube = cached('cytube', () => new THREE.CylinderGeometry(0.3, 0.3, 0.7, 32, 1, true));
      g.add(mesh(tube, mS));
      g.add(cylY(0.31, 0.03, mS, 0, 0.35));
      g.add(torusY(0.305, 0.012, mDark, 0, -0.35));
      break;
    }
    case 'cone': {
      const mC = metal(color, { double: true });
      g.add(mesh(cached('cycone', () => new THREE.CylinderGeometry(0.3, 0.07, 0.7, 32, 1, true)), mC));
      g.add(torusY(0.075, 0.012, mDark, 0, -0.35));
      break;
    }
    case 'inlet': {
      const mI = metal(color, { double: true });
      const pipe = cylX(0.08, 0.3, mI);
      pipe.rotation.set(0, 0, 0);
      pipe.rotation.y = Math.PI / 2;
      g.add(pipe);
      g.add(box(0.16, 0.18, 0.1, mI, 0, 0, -0.16));
      const f = flangeX(0.12, m, 0, 0, 0.16);
      f.rotation.y = Math.PI / 2;
      g.add(f);
      break;
    }
    case 'vortexFinder': {
      const mV = metal(color, { rough: 0.3, double: true });
      const tube = cached('cyvf', () => new THREE.CylinderGeometry(0.1, 0.1, 0.5, 24, 1, true));
      g.add(mesh(tube, mV));
      g.add(flangeY(0.15, m, 0, 0.25));
      g.add(cylX(0.09, 0.2, mV, 0.12, 0.32));
      const f = flangeX(0.13, m, 0.22, 0.32);
      g.add(f);
      break;
    }
    case 'dustOutlet': {
      g.add(cylY(0.07, 0.16, m));
      g.add(flangeY(0.1, m, 0, -0.08));
      g.add(box(0.14, 0.1, 0.14, mDark, 0, -0.16));
      break;
    }
  }
  return g;
}

function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

/** 教学示意螺旋转子：径向按多瓣余弦型线变化，沿 X 轴扭转；不是厂商型线。 */
function screwRotorGeometry(key: string, lobes: number, tipR: number, rootR: number, length: number, twist: number): THREE.BufferGeometry {
  return cached(key, () => {
    const segX = 56;
    const segA = 96;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= segX; i++) {
      const x = -length / 2 + length * (i / segX);
      const rot = twist * (i / segX);
      for (let j = 0; j < segA; j++) {
        const th = (j / segA) * GEAR_TAU;
        const p = 0.5 + 0.5 * Math.cos(lobes * th);
        const r = rootR + (tipR - rootR) * Math.pow(p, 1.6);
        const a = th + rot;
        pos.push(x, Math.cos(a) * r, Math.sin(a) * r);
      }
    }
    for (let i = 0; i < segX; i++) {
      for (let j = 0; j < segA; j++) {
        const a = i * segA + j;
        const b = i * segA + ((j + 1) % segA);
        const c = (i + 1) * segA + j;
        const d = (i + 1) * segA + ((j + 1) % segA);
        idx.push(a, b, c, b, d, c);
      }
    }
    const capStart = pos.length / 3;
    pos.push(-length / 2, 0, 0);
    const capEnd = pos.length / 3;
    pos.push(length / 2, 0, 0);
    for (let j = 0; j < segA; j++) {
      idx.push(capStart, (j + 1) % segA, j);
      idx.push(capEnd, segX * segA + j, segX * segA + ((j + 1) % segA));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  });
}

function screwPart(id: string, color: number): THREE.Group {
  const g = new THREE.Group();
  const m = metal(color);
  const mSteel = metal(0xc7ccd4, { rough: 0.25, metal: 0.85 });
  const mDark = metal(0x374151, { rough: 0.5 });
  switch (id) {
    case 'base': {
      g.add(box(1.05, 0.08, 0.08, m, 0, 0, 0.22));
      g.add(box(1.05, 0.08, 0.08, m, 0, 0, -0.22));
      for (const x of [-0.5, 0.5]) g.add(box(0.08, 0.08, 0.52, m, x, 0, 0));
      for (const x of [-0.45, 0.45]) for (const z of [-0.22, 0.22]) g.add(box(0.12, 0.06, 0.12, mDark, x, -0.07, z));
      g.add(box(0.16, 0.19, 0.42, mDark, -0.35, 0.135, 0));
      g.add(box(0.16, 0.19, 0.42, mDark, 0.05, 0.135, 0));
      g.userData.outletClearance = true;
      break;
    }
    case 'housing': {
      const mS = metal(color, { rough: 0.55, metal: 0.3, double: true });
      const body = new THREE.Mesh(plateGeometry('screw-housing-v2', roundedRectShape(0.64, 0.54, 0.08), 0.9), mS);
      body.updateMatrix();
      let solid = CSG.fromMesh(body);
      for (const [cy, r] of [[0.125, 0.155], [-0.125, 0.145]] as [number, number][]) {
        const bore = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.96, 40), mS);
        bore.rotation.z = Math.PI / 2;
        bore.position.set(0, cy, 0);
        bore.updateMatrix();
        solid = solid.subtract(CSG.fromMesh(bore));
        bore.geometry.dispose();
      }
      const inletCh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.24, 24), mS);
      inletCh.position.set(-0.35, 0.30, 0);
      inletCh.updateMatrix();
      solid = solid.subtract(CSG.fromMesh(inletCh));
      inletCh.geometry.dispose();
      const outletCh = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 24), mS);
      outletCh.position.set(0.35, -0.28, 0);
      outletCh.updateMatrix();
      solid = solid.subtract(CSG.fromMesh(outletCh));
      outletCh.geometry.dispose();
      const oilCh = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 16), mS);
      oilCh.position.set(0.05, 0.30, 0);
      oilCh.updateMatrix();
      solid = solid.subtract(CSG.fromMesh(oilCh));
      oilCh.geometry.dispose();
      const cut = toCreasedNormals(cleanTriangles(CSG.toGeometry(solid, new THREE.Matrix4())), Math.PI / 4);
      const shell = new THREE.Mesh(cut, mS);
      shell.castShadow = true;
      shell.receiveShadow = true;
      g.add(shell);
      const endShape = roundedRectShape(0.64, 0.54, 0.08);
      for (const sy of [-0.125, 0.125]) {
        const h = new THREE.Path();
        h.absarc(sy, 0, 0.045, 0, GEAR_TAU, true);
        endShape.holes.push(h);
      }
      for (const x of [-0.455, 0.455]) {
        const end = new THREE.Mesh(plateGeometry('screw-end-plate-v2', endShape, 0.04), m);
        end.position.x = x;
        end.castShadow = true;
        end.receiveShadow = true;
        g.add(end);
      }
      for (const z of [-0.16, 0.16]) {
        g.add(box(0.9, 0.025, 0.05, mDark, 0, 0.33, z));
        g.add(box(0.9, 0.025, 0.05, mDark, 0, -0.33, z));
      }
      g.userData.boreMale = 0.155;
      g.userData.boreFemale = 0.145;
      g.userData.centerDistance = 0.25;
      g.userData.inletPort = 'top -X';
      g.userData.outletPort = 'bottom +X';
      g.userData.teachingProfile = true;
      break;
    }
    case 'maleRotor': {
      const mM = metal(color, { rough: 0.3, metal: 0.75, double: true });
      const rotor = new THREE.Mesh(screwRotorGeometry('screw-male-v2', 4, 0.14, 0.07, 0.78, 1.5 * Math.PI), mM);
      rotor.castShadow = true;
      rotor.receiveShadow = true;
      g.add(rotor);
      g.add(cylX(0.035, 1.15, mSteel, 0.06));
      g.add(cylX(0.09, 0.06, mSteel, 0.56));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        g.add(cylX(0.012, 0.08, mSteel, 0.60, Math.cos(a) * 0.06, Math.sin(a) * 0.06));
      }
      g.userData.lobes = 4;
      g.userData.teachingProfile = true;
      g.userData.driveEnd = '+X';
      break;
    }
    case 'femaleRotor': {
      const mF = metal(color, { rough: 0.3, metal: 0.75, double: true });
      const rotor = new THREE.Mesh(screwRotorGeometry('screw-female-v2', 6, 0.13, 0.065, 0.78, -1.1 * Math.PI), mF);
      rotor.castShadow = true;
      rotor.receiveShadow = true;
      g.add(rotor);
      g.add(cylX(0.032, 1.0, mSteel));
      g.userData.lobes = 6;
      g.userData.teachingProfile = true;
      break;
    }
    case 'bearings': {
      for (const x of [-0.47, 0.47]) {
        for (const y of [-0.125, 0.125]) {
          const housing = ring(0.075, 0.04, 0.07, m);
          orient(housing, 'x', [x, y, 0]);
          g.add(housing);
          const cap = ring(0.085, 0.04, 0.03, mSteel);
          orient(cap, 'x', [x + Math.sign(x) * 0.04, y, 0]);
          g.add(cap);
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2;
            g.add(cylX(0.01, 0.05, mSteel, x + Math.sign(x) * 0.05, y + Math.cos(a) * 0.065, Math.sin(a) * 0.065));
          }
        }
      }
      g.userData.bearingCount = 4;
      break;
    }
    case 'inlet': {
      const mI = metal(color, { rough: 0.5, metal: 0.3 });
      const pipe = ring(0.09, 0.065, 0.28, mI);
      orient(pipe, 'y', [0, 0, 0]);
      g.add(pipe);
      const fl = ring(0.13, 0.065, 0.035, mSteel);
      orient(fl, 'y', [0, 0.15, 0]);
      g.add(fl);
      const band = ring(0.1, 0.09, 0.035, metal(0x2f8fe6, { rough: 0.4, metal: 0.3 }));
      orient(band, 'y', [0, -0.08, 0]);
      g.add(band);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        g.add(cylY(0.01, 0.04, mSteel, Math.cos(a) * 0.10, 0.16, Math.sin(a) * 0.10));
      }
      g.userData.port = 'inlet';
      break;
    }
    case 'outlet': {
      const mO = metal(color, { rough: 0.5, metal: 0.3 });
      const pipe = ring(0.085, 0.065, 0.40, mO);
      orient(pipe, 'y', [0, 0, 0]);
      g.add(pipe);
      const fl = ring(0.12, 0.065, 0.035, mSteel);
      orient(fl, 'y', [0, -0.16, 0]);
      g.add(fl);
      const band = ring(0.095, 0.085, 0.035, metal(0xd97706, { rough: 0.4, metal: 0.3 }));
      orient(band, 'y', [0, -0.10, 0]);
      g.add(band);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        g.add(cylY(0.01, 0.04, mSteel, Math.cos(a) * 0.09, -0.17, Math.sin(a) * 0.09));
      }
      g.userData.port = 'outlet';
      break;
    }
    case 'oilInject': {
      const mO = metal(color, { rough: 0.4 });
      const pipe = ring(0.045, 0.025, 0.22, mO);
      orient(pipe, 'y', [0, 0, 0]);
      g.add(pipe);
      const fl = ring(0.065, 0.025, 0.03, mSteel);
      orient(fl, 'y', [0, 0.08, 0]);
      g.add(fl);
      const band = ring(0.05, 0.045, 0.035, metal(0xd97706, { rough: 0.3, metal: 0.2 }));
      orient(band, 'y', [0, -0.04, 0]);
      g.add(band);
      g.add(cylY(0.02, 0.10, metal(0xd97706, { rough: 0.3 }), 0, -0.14));
      g.userData.port = 'oil';
      break;
    }
  }
  return g;
}

function emfPart(id: string, color: number): THREE.Group {
  const g = new THREE.Group();
  const m = metal(color);
  const mSteel = metal(0xc7ccd4, { rough: 0.25, metal: 0.85 });
  const mDark = metal(0x374151, { rough: 0.5 });
  switch (id) {
    case 'tube': {
      const mS = metal(color, { double: true });
      g.add(cylX(0.13, 0.55, mS));
      g.add(torusX(0.135, 0.012, mDark, -0.2));
      g.add(torusX(0.135, 0.012, mDark, 0.2));
      break;
    }
    case 'liner': {
      const mL = metal(color, { rough: 0.6, metal: 0.05, double: true });
      const tube = cached('emfliner', () => new THREE.CylinderGeometry(0.105, 0.105, 0.56, 24, 1, true));
      const t = mesh(tube, mL);
      t.rotation.z = Math.PI / 2;
      g.add(t);
      break;
    }
    case 'electrodes': {
      const mE = metal(color, { rough: 0.2, metal: 0.9 });
      for (const s of [-1, 1]) {
        const stud = cylX(0.02, 0.1, mE, 0, 0, s * 0.13);
        stud.rotation.set(Math.PI / 2, 0, 0);
        stud.userData.side = s;
        stud.userData.baseZ = s * 0.13;
        g.add(stud);
        const head = cylX(0.032, 0.03, mE, 0, 0, s * 0.19);
        head.rotation.set(Math.PI / 2, 0, 0);
        head.userData.side = s;
        head.userData.baseZ = s * 0.19;
        g.add(head);
      }
      break;
    }
    case 'coils': {
      const mC = metal(color, { rough: 0.45 });
      for (const s of [-1, 1]) {
        g.add(box(0.3, 0.1, 0.24, mC, 0, s * 0.19));
        for (let i = 0; i < 4; i++) g.add(box(0.32, 0.08, 0.02, metal(0xc9a227, { rough: 0.4 }), 0, s * 0.19, -0.09 + i * 0.06));
      }
      break;
    }
    case 'flanges': {
      g.add(flangeX(0.2, m, -0.3));
      g.add(flangeX(0.2, m, 0.3));
      g.add(boltRingX(4, 0.16, 0.016, 0.07, mSteel, -0.3));
      g.add(boltRingX(4, 0.16, 0.016, 0.07, mSteel, 0.3));
      break;
    }
    case 'transmitter': {
      const mT = metal(color, { rough: 0.4 });
      g.add(cylY(0.05, 0.16, mT, 0, -0.14));
      g.add(box(0.22, 0.18, 0.16, mT, 0, 0.04));
      const face = box(0.16, 0.1, 0.01, metal(0x1f2937, { rough: 0.3, metal: 0.2 }), 0, 0.05, 0.085);
      face.name = 'emf-display';
      g.add(face);
      g.add(box(0.14, 0.06, 0.012, metal(0x39d98a, { rough: 0.3, metal: 0.1 }), 0, 0.05, 0.09));
      g.add(cylY(0.02, 0.2, mDark, 0.08, -0.2));
      break;
    }
  }
  return g;
}

const DEVICE_BUILDERS: Record<string, (id: string, color: number) => THREE.Group> = {
  'pump': pumpModelPart,
  'exchanger': exchangerModelPart,
  'reactor': reactorPart,
  'ball-valve': ballValvePart,
  'gate-valve': gateValvePart,
  'butterfly-valve': butterflyPart,
  'check-valve': checkValvePart,
  'gear-pump': gearPumpPart,
  'diaphragm-pump': diaphragmPart,
  'plate-exchanger': plateExchangerModelPart,
  'bag-filter': bagFilterModelPart,
  'y-strainer': yStrainerPart,
  'fixed-roof-tank': tankPart,
  'gas-separator': separatorPart,
  'packed-tower': towerPart,
  'cyclone-separator': cyclonePart,
  'screw-compressor': screwPart,
  'emf-meter': emfPart
};

export function buildPart(deviceId: string, partId: string, color: number): THREE.Group {
  const fn = DEVICE_BUILDERS[deviceId];
  if (!fn) throw new Error(`未知设备编号：${deviceId}`);
  const g = fn(partId, color);
  g.name = partId;
  g.traverse((o) => { o.userData.partId = partId; });
  return g;
}

/** 首页缩略图：构建整机 */
export function buildDevicePreview(deviceId: string, parts: { id: string; color: number; pos: [number, number, number] }[]): THREE.Group {
  const root = new THREE.Group();
  for (const p of parts) {
    const g = buildPart(deviceId, p.id, p.color);
    g.position.set(...p.pos);
    root.add(g);
  }
  return root;
}
