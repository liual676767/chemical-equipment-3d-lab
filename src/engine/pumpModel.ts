import * as THREE from 'three';
import { CSG } from 'three-csg-ts';
import { cleanTriangles } from './processGeometry';

/**
 * 离心泵工业级教学示意重建（40 个独立零件）。
 * 坐标：泵轴沿 X，Y 向上，单位约米；各零件 Group 原点按 devices.ts 的 pos 装配。
 * 所有几何为程序化教学示意，非制造数据；演示尺寸在界面文案中标注。
 */

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
function metal(color: number, opts: { rough?: number; metal?: number; double?: boolean; side?: THREE.Side } = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.rough ?? 0.4,
    metalness: opts.metal ?? 0.6,
    side: opts.side ?? (opts.double ? THREE.DoubleSide : THREE.FrontSide)
  });
}
function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const me = new THREE.Mesh(g, m);
  me.position.set(x, y, z);
  me.castShadow = true;
  me.receiveShadow = true;
  return me;
}
function cylX(r: number, len: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 32): THREE.Mesh {
  const me = mesh(cached(`px${r}|${len}|${seg}`, () => new THREE.CylinderGeometry(r, r, len, seg)), m, x, y, z);
  me.rotation.z = Math.PI / 2;
  return me;
}
function cylY(r: number, len: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 32): THREE.Mesh {
  return mesh(cached(`py${r}|${len}|${seg}`, () => new THREE.CylinderGeometry(r, r, len, seg)), m, x, y, z);
}
function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  return mesh(cached(`pb${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d)), m, x, y, z);
}
function torus(radius: number, tube: number, m: THREE.Material, x = 0, y = 0, z = 0, arc = Math.PI * 2, seg = 10, tseg = 36): THREE.Mesh {
  return mesh(cached(`pt${radius}|${tube}|${arc}|${seg}|${tseg}`, () => new THREE.TorusGeometry(radius, tube, seg, tseg, arc)), m, x, y, z);
}
function boltRingX(count: number, radius: number, boltR: number, len: number, m: THREE.Material, x: number): THREE.Group {
  const grp = new THREE.Group();
  const g = cached(`pbolt${boltR}|${len}`, () => new THREE.CylinderGeometry(boltR, boltR, len, 8));
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const b = mesh(g, m, x, Math.cos(a) * radius, Math.sin(a) * radius);
    b.rotation.z = Math.PI / 2;
    grp.add(b);
  }
  return grp;
}

/** 真实中空直管：外壁（FrontSide）+ 内壁（BackSide）+ 两端环形端面，可看到管口与壁厚 */
export const sealSleeveProfile = { outside: 0.087, wall: 0.011, length: 0.2 } as const;

function hollowCylX(rOut: number, wall: number, len: number, mOut: THREE.MeshStandardMaterial, mIn: THREE.MeshStandardMaterial, mCap: THREE.Material, x = 0, y = 0, z = 0, seg = 40, tagPipe = false): THREE.Group {
  const g = new THREE.Group();
  const outer = mesh(cached(`hox${rOut}|${len}|${seg}`, () => new THREE.CylinderGeometry(rOut, rOut, len, seg, 1, true)), mOut, x, y, z);
  outer.rotation.z = Math.PI / 2;
  if (tagPipe) outer.userData.outerWall = 'pipe';
  g.add(outer);
  const inner = mesh(cached(`hix${rOut}|${wall}|${len}|${seg}`, () => new THREE.CylinderGeometry(rOut - wall, rOut - wall, len - 0.0004, seg, 1, true)), mIn, x, y, z);
  inner.rotation.z = Math.PI / 2;
  g.add(inner);
  const capGeo = cached(`rgx${rOut}|${wall}|${seg}`, () => new THREE.RingGeometry(rOut - wall, rOut, seg));
  for (const side of [-1, 1]) {
    const cap = mesh(capGeo, mCap, x + side * len / 2, y, z);
    cap.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(cap);
  }
  return g;
}
function hollowCylY(rOut: number, wall: number, len: number, mOut: THREE.MeshStandardMaterial, mIn: THREE.MeshStandardMaterial, mCap: THREE.Material, x = 0, y = 0, z = 0, seg = 40, tagPipe = false): THREE.Group {
  const g = new THREE.Group();
  const outer = mesh(cached(`hoy${rOut}|${len}|${seg}`, () => new THREE.CylinderGeometry(rOut, rOut, len, seg, 1, true)), mOut, x, y, z);
  if (tagPipe) outer.userData.outerWall = 'pipe';
  g.add(outer);
  const inner = mesh(cached(`hiy${rOut}|${wall}|${len}|${seg}`, () => new THREE.CylinderGeometry(rOut - wall, rOut - wall, len - 0.0004, seg, 1, true)), mIn, x, y, z);
  g.add(inner);
  const capGeo = cached(`rgy${rOut}|${wall}|${seg}`, () => new THREE.RingGeometry(rOut - wall, rOut, seg));
  for (const side of [-1, 1]) {
    const cap = mesh(capGeo, mCap, x, y + side * len / 2, z);
    cap.rotation.x = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(cap);
  }
  return g;
}
/** 真实带通孔法兰（孔为几何孔） */
function flangeHolesX(rOut: number, thickness: number, holeR: number, holeCount: number, holeRingR: number, m: THREE.Material, x = 0, bore = 0): THREE.Mesh {
  const geo = cached(`fhx${rOut}|${thickness}|${holeR}|${holeCount}|${holeRingR}|${bore}`, () => {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, rOut, 0, Math.PI * 2, false);
    if (bore > 0) {
      const hole = new THREE.Path();
      hole.absarc(0, 0, bore, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
    for (let i = 0; i < holeCount; i++) {
      const a = (i / holeCount) * Math.PI * 2;
      const h = new THREE.Path();
      h.absarc(Math.cos(a) * holeRingR, Math.sin(a) * holeRingR, holeR, 0, Math.PI * 2, true);
      shape.holes.push(h);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 28 });
    g.translate(0, 0, -thickness / 2);
    g.rotateY(Math.PI / 2);
    return g;
  });
  const me = mesh(geo, m, x);
  me.userData.boltHoles = holeCount;
  return me;
}
function flangeHolesY(rOut: number, thickness: number, holeR: number, holeCount: number, holeRingR: number, m: THREE.Material, y = 0, bore = 0): THREE.Mesh {
  const geo = cached(`fhy${rOut}|${thickness}|${holeR}|${holeCount}|${holeRingR}|${bore}`, () => {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, rOut, 0, Math.PI * 2, false);
    if (bore > 0) {
      const hole = new THREE.Path();
      hole.absarc(0, 0, bore, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
    for (let i = 0; i < holeCount; i++) {
      const a = (i / holeCount) * Math.PI * 2;
      const h = new THREE.Path();
      h.absarc(Math.cos(a) * holeRingR, Math.sin(a) * holeRingR, holeR, 0, Math.PI * 2, true);
      shape.holes.push(h);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 28 });
    g.translate(0, 0, -thickness / 2);
    g.rotateX(-Math.PI / 2);
    return g;
  });
  const me = mesh(geo, m, 0, y);
  me.userData.boltHoles = holeCount;
  return me;
}
/** 中空 90° 弯头：TorusGeometry 内外双面 + 两端环形端面。arc 起点角由 rotation.z 控制。 */
function hollowElbow(R: number, rOut: number, wall: number, mOut: THREE.MeshStandardMaterial, mIn: THREE.MeshStandardMaterial, mCap: THREE.Material, cx = 0, cy = 0, rotZ = 0): THREE.Group {
  const g = new THREE.Group();
  const outer = mesh(cached(`heo${R}|${rOut}`, () => new THREE.TorusGeometry(R, rOut, 14, 36, Math.PI / 2)), mOut);
  outer.userData.outerWall = 'pipe';
  const inner = mesh(cached(`hei${R}|${rOut}|${wall}`, () => new THREE.TorusGeometry(R, rOut - wall, 12, 36, Math.PI / 2)), mIn);
  const capGeo = cached(`hec${R}|${rOut}|${wall}`, () => new THREE.RingGeometry(rOut - wall, rOut, 24));
  const capA = mesh(capGeo, mCap);
  const capB = mesh(capGeo, mCap);
  const grp = new THREE.Group();
  grp.add(outer, inner);
  grp.position.set(cx, cy, 0);
  grp.rotation.z = rotZ;
  g.add(grp);
  // 端面按弧端切向摆放（局部坐标，随 group 旋转）
  capA.position.set(R, 0, 0);
  capA.rotation.x = Math.PI / 2;
  capB.position.set(0, R, 0);
  capB.rotation.y = -Math.PI / 2;
  grp.add(capA, capB);
  return g;
}
/** 闭式叶轮叶片：前后盖板间的三维曲面（径向放样 + 后弯） */
function bladeSurface(rIn: number, rOut: number, halfW: number, sweep: number, m: THREE.Material): THREE.Mesh {
  const geo = cached(`blade${rIn}|${rOut}|${halfW}|${sweep}`, () => {
    const uSeg = 12, vSeg = 5;
    const pos: number[] = [], idx: number[] = [];
    for (let i = 0; i <= uSeg; i++) {
      const u = i / uSeg;
      const r = rIn + (rOut - rIn) * u;
      const phi0 = sweep * Math.pow(u, 0.85);
      for (let j = 0; j <= vSeg; j++) {
        const v = j / vSeg;
        const x = -halfW + 2 * halfW * v;
        const phi = phi0 + 0.22 * v;
        pos.push(x, r * Math.cos(phi), r * Math.sin(phi));
      }
    }
    for (let i = 0; i < uSeg; i++) for (let j = 0; j < vSeg; j++) {
      const a = i * (vSeg + 1) + j, b = a + vSeg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
  return mesh(geo, m);
}
type PumpDetail = 'overview' | 'study';
const casings = new WeakSet<THREE.Mesh>();

export function setPumpDetail(casing: THREE.Group, detail: PumpDetail) {
  casing.traverse((object) => {
    if (object instanceof THREE.Mesh && casings.has(object)) {
      object.geometry = voluteShell(detail === 'study' ? 88 : 40);
    }
  });
}

/** 将进、排腔与叶轮室连成一体。全部尺寸为同一米制教学坐标。 */
function voluteShell(segments: number, openBack = false) {
  return cached(`pump-casing-${segments}-${openBack}`, () => {
    const profile = (wall: number, depth: number, x: number) => {
      const shape = new THREE.Shape();
      for (let i = 0; i <= segments; i++) {
        const fraction = i / segments;
        const angle = fraction * Math.PI * 2;
        const radius = 0.425 + fraction * 0.215 + wall;
        const y = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        if (i === 0) shape.moveTo(y, z);
        else shape.lineTo(y, z);
      }
      shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
      geometry.applyMatrix4(new THREE.Matrix4().set(
        0, 0, 1, x,
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 0, 1
      ));
      return solid(geometry);
    };
    const solid = (geometry: THREE.BufferGeometry) => {
      const result = CSG.fromGeometry(geometry);
      geometry.dispose();
      return result;
    };
    const pipe = (axis: 'x' | 'y', radius: number, from: number, to: number) => {
      const geometry = new THREE.CylinderGeometry(radius, radius, to - from, segments / 2);
      const center = (from + to) / 2;
      if (axis === 'x') {
        geometry.rotateZ(Math.PI / 2);
        geometry.translate(center, 0, 0);
      } else {
        geometry.translate(0, center, 0);
      }
      return solid(geometry);
    };
    const shell = profile(0.022, 0.399, -0.18)
      .union(pipe('x', 0.19, -0.658, -0.146))
      .union(pipe('y', 0.145, 0.42, 0.874));
    const cavity = profile(0, openBack ? 0.43 : 0.317, -0.156)
      .union(pipe('x', 0.165, -0.72, -0.133))
      .union(pipe('x', 0.111, 0.143, 0.268))
      .union(pipe('y', 0.123, 0.518, 0.925));
    return cleanTriangles(CSG.toGeometry(shell.subtract(cavity), new THREE.Matrix4()));
  });
}

/** 阶梯轴段带键槽（真实减料凹槽） */
function keyedCylX(r: number, len: number, keyW: number, keyDepth: number, m: THREE.Material, x: number): THREE.Mesh {
  const geo = cached(`keyed${r}|${len}|${keyW}|${keyDepth}`, () => {
    const seg = 36;
    const pts: THREE.Vector2[] = [];
    const half = keyW / 2;
    const yTop = Math.sqrt(Math.max(r * r - half * half, 0));
    const a1 = Math.atan2(yTop, half);
    for (let i = 0; i <= seg; i++) {
      const a = Math.PI - a1 + (Math.PI + 2 * a1) * i / seg;
      pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
    }
    pts.push(new THREE.Vector2(half, yTop - keyDepth), new THREE.Vector2(-half, yTop - keyDepth));
    const shape = new THREE.Shape(pts);
    const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 32 });
    g.translate(0, 0, -len / 2);
    g.rotateY(Math.PI / 2);
    return g;
  });
  return mesh(geo, m, x);
}
/** 螺旋弹簧（沿 X 轴） */
class HelixCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private len: number, private coilR: number, private turns: number, private x0: number) { super(); }
  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const a = t * this.turns * Math.PI * 2;
    return target.set(this.x0 + t * this.len, Math.cos(a) * this.coilR, Math.sin(a) * this.coilR);
  }
}
function springX(len: number, coilR: number, turns: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const geo = new THREE.TubeGeometry(new HelixCurve(len, coilR, turns, 0), Math.ceil(turns * 14), 0.0075, 6, false);
  return mesh(geo, m, x, y, z);
}
/** 带厚度圆环盘（lathe 盘 + 孔），用于盖板/端盖 */
function thickRing(rIn: number, rOut: number, thick: number, m: THREE.Material, x = 0): THREE.Group {
  const g = new THREE.Group();
  const capGeo = cached(`tr${rIn}|${rOut}`, () => new THREE.RingGeometry(rIn, rOut, 48));
  for (const s of [-1, 1]) {
    const c = mesh(capGeo, m, x + s * thick / 2);
    c.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(c);
  }
  const rim = mesh(cached(`trrim${rOut}|${thick}`, () => new THREE.CylinderGeometry(rOut, rOut, thick, 48, 1, true)), m, x);
  rim.rotation.z = Math.PI / 2;
  g.add(rim);
  return g;
}

export function pumpModelPart(id: string, color: number, openWorkshopCasing = false): THREE.Group {
  const g = new THREE.Group();
  const paint = metal(color, { rough: 0.62, metal: 0.32 });
  const mDark = metal(0x374151, { rough: 0.5 });
  const mSteel = metal(0xc7ccd4, { rough: 0.24, metal: 0.9 });
  const mSteelIn = metal(0xc9d2dc, { rough: 0.42, metal: 0.5, side: THREE.BackSide });
  const mCut = metal(0x9aa5b1, { rough: 0.45, metal: 0.7, double: true });
  const mCopper = metal(0xb87333, { rough: 0.35, metal: 0.8 });
  const mRubber = metal(0x1f2937, { rough: 0.85, metal: 0.05 });
  const mSeal = metal(color, { rough: 0.45, metal: 0.6 });
  const mSealDark = metal(0x2f6f55, { rough: 0.55, metal: 0.4 });

  switch (id) {
    case 'base': {
      // 安装基准：主板上表面（世界 y≈0.135），设备支脚/垫板均落在该面
      g.userData.mountY = 0.135;
      g.add(box(3.6, 0.06, 1.1, mDark, 0, 0.03, 0));
      g.add(box(3.6, 0.05, 0.14, paint, 0, 0.1, 0.48));
      g.add(box(3.6, 0.05, 0.14, paint, 0, 0.1, -0.48));
      g.add(box(3.6, 0.1, 0.05, paint, 0, 0.0, 0.48));
      g.add(box(3.6, 0.1, 0.05, paint, 0, 0.0, -0.48));
      for (const x of [-1.55, -0.4, 0.8, 1.95]) g.add(box(0.05, 0.09, 0.96, paint, x, 0.06, 0));
      for (const x of [-1.55, 1.95]) for (const z of [-0.42, 0.42]) {
        g.add(cylY(0.035, 0.1, mSteel, x, 0, z, 12));
        g.add(cylY(0.06, 0.02, mSteel, x, 0.06, z, 12));
      }
      for (const x of [-1.0, 0.5]) for (const s of [-1, 1]) {
        const w = box(0.16, 0.06, 0.02, mDark, x, 0.11, s * 0.4);
        w.rotation.z = 0.5;
        g.add(w);
      }
      break;
    }
    case 'casing': {
      g.userData.voluteThroat = 'top';
      const shell = mesh(voluteShell(40, openWorkshopCasing), paint);
      if (openWorkshopCasing) shell.userData.workshopVolute = true;
      casings.add(shell);
      g.add(shell);
      g.add(flangeHolesX(0.58, 0.05, 0.022, 8, 0.5, paint, 0.23, openWorkshopCasing ? 0.435 : 0.111));
      g.add(flangeHolesX(0.28, 0.05, 0.022, 8, 0.21, paint, -0.68, 0.155));
      g.add(flangeHolesY(0.22, 0.05, 0.02, 8, 0.16, paint, 0.89, 0.115));
      // 铸造加强筋（径向薄板，贴合壳体外部）
      for (let i = 0; i < 4; i++) {
        const a = Math.PI * 0.25 + i * Math.PI * 0.5;
        const radius = 0.425 + 0.215 * a / (Math.PI * 2) + 0.022 + 0.067;
        const rib = box(0.3, 0.16, 0.025, paint, 0.1, Math.cos(a) * radius, Math.sin(a) * radius);
        rib.rotation.x = a;
        g.add(rib);
      }
      // 支座脚 + 安装垫板（落在公共底座主板上表面）
      g.add(box(0.42, 0.1, 0.4, mDark, 0, -0.62, 0));
      g.add(box(0.24, 0.12, 0.3, mDark, 0, -0.53, 0));
      g.add(box(0.42, 0.02, 0.4, mDark, 0, -0.675, 0));
      break;
    }
    case 'impeller': {
      // 叶轮采用铜色系（与零件目录色一致），便于与钢制轴系区分
      const mBronze = metal(color, { rough: 0.38, metal: 0.6 });
      const mBronzeDouble = metal(color, { rough: 0.38, metal: 0.6, double: true });
      // 轮毂（带轴孔与键槽）
      g.add(hollowCylX(0.09, 0.028, 0.24, mBronze, mSteelIn, mCut, 0, 0, 0, 32, false));
      // 前盖板（带进口开孔）+ 后盖板
      g.add(thickRing(0.16, 0.4, 0.02, mBronze, -0.095));
      g.add(thickRing(0.085, 0.4, 0.024, mBronze, 0.095));
      // 进口眼环
      const eye = torus(0.165, 0.014, mBronze, -0.105, 0, 0, Math.PI * 2, 8, 40);
      eye.rotation.y = Math.PI / 2;
      g.add(eye);
      // 6 片三维后弯叶片（前后盖板之间，双面可见）
      for (let i = 0; i < 6; i++) {
        const b = bladeSurface(0.145, 0.385, 0.075, 1.05, mBronzeDouble);
        b.rotation.x = (i / 6) * Math.PI * 2;
        g.add(b);
      }
      // 轮毂键槽（凹槽示意）与轴端螺母
      g.add(box(0.03, 0.014, 0.016, mDark, -0.11, 0.088, 0));
      g.add(cylX(0.045, 0.03, mDark, -0.125));
      break;
    }
    case 'cover': {
      g.userData.coverBolts = 8;
      g.userData.coverGasket = true;
      g.add(thickRing(0.11, 0.52, 0.12, paint, -0.02));
      g.add(thickRing(0.105, 0.16, 0.1, paint, -0.1));
      // 密封腔止口
      g.add(thickRing(0.105, 0.17, 0.05, paint, 0.06));
      // 与泵壳法兰对中的螺栓孔法兰面（孔距与泵壳法兰一致）
      g.add(flangeHolesX(0.58, 0.05, 0.022, 8, 0.5, paint, -0.115, 0.105));
      // 泵壳-泵盖结合面垫片（教学示意）
      const gasket = torus(0.36, 0.011, mRubber, -0.095, 0, 0, Math.PI * 2, 6, 48);
      gasket.rotation.y = Math.PI / 2;
      g.add(gasket);
      // 8 条可辨认的连接螺栓（头/杆/螺母）
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const by = Math.cos(a) * 0.5, bz = Math.sin(a) * 0.5;
        g.add(cylX(0.016, 0.18, mSteel, -0.085, by, bz, 8));
        g.add(cylX(0.027, 0.022, mDark, -0.175, by, bz, 6));
        g.add(cylX(0.026, 0.02, mDark, 0.005, by, bz, 6));
      }
      // 密封结合面环槽
      const groove = torus(0.33, 0.008, mDark, -0.08, 0, 0, Math.PI * 2, 6, 48);
      groove.rotation.y = Math.PI / 2;
      g.add(groove);
      break;
    }
    case 'wearRing': {
      const front = torus(0.158, 0.012, mSteel, -0.16, 0, 0, Math.PI * 2, 8, 40);
      front.rotation.y = Math.PI / 2;
      g.add(front);
      const back = torus(0.15, 0.011, mSteel, 0.14, 0, 0, Math.PI * 2, 8, 40);
      back.rotation.y = Math.PI / 2;
      g.add(back);
      break;
    }
    case 'seal': {
      // 密封腔座（含静环座与压盖螺栓座），以筒形腔体与泵盖后端面相连
      g.add(hollowCylX(0.135, 0.02, 0.18, mSeal, mSteelIn, mCut, -0.03, 0, 0, 32));
      const body = torus(0.135, 0.022, mSeal, 0.04, 0, 0, Math.PI * 2, 10, 40);
      body.rotation.y = Math.PI / 2;
      g.add(body);
      g.add(thickRing(0.095, 0.17, 0.05, mSeal, 0.08));
      g.add(boltRingX(4, 0.13, 0.014, 0.08, mSteel, 0.1));
      break;
    }
    case 'sealStatic': {
      const r1 = torus(0.108, 0.012, mSealDark, 0.015, 0, 0, Math.PI * 2, 8, 40);
      r1.rotation.y = Math.PI / 2;
      g.add(r1);
      g.add(cylX(0.012, 0.02, mSteel, 0.02, 0.108, 0));
      break;
    }
    case 'sealRotary': {
      const r1 = torus(0.104, 0.012, mSteel, -0.015, 0, 0, Math.PI * 2, 8, 40);
      r1.rotation.y = Math.PI / 2;
      g.add(r1);
      g.add(cylX(0.03, 0.02, mSealDark, -0.02, 0.1, 0));
      break;
    }
    case 'sealSpring': {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.add(springX(0.06, 0.009, 4, mSteel, -0.05, Math.cos(a) * 0.1, Math.sin(a) * 0.1));
      }
      break;
    }
    case 'sealGland': {
      g.add(thickRing(0.092, 0.165, 0.035, paint, 0));
      g.add(boltRingX(4, 0.13, 0.016, 0.06, mSteel, 0.03));
      g.add(cylY(0.02, 0.08, mSteel, 0.09, -0.12, 0));
      break;
    }
    case 'sealSleeve': {
      const { outside, wall, length } = sealSleeveProfile;
      g.add(hollowCylX(outside, wall, length, mSteel, mSteelIn, mCut, 0));
      break;
    }
    case 'sealOrings': {
      for (const x of [-0.02, 0.03]) {
        const o = torus(0.118, 0.006, mRubber, x, 0, 0, Math.PI * 2, 6, 40);
        o.rotation.y = Math.PI / 2;
        g.add(o);
      }
      break;
    }
    case 'shaft': {
      // 阶梯轴：叶轮轴端（带键槽）→ 密封/轴承座 → 联轴器端（带键槽）
      g.add(keyedCylX(0.055, 0.17, 0.012, 0.006, mSteel, -0.865));
      g.add(cylX(0.075, 0.5, mSteel, -0.53));
      g.add(cylX(0.09, 0.16, mSteel, -0.2));
      g.add(cylX(0.08, 0.12, mSteel, -0.06));
      g.add(cylX(0.065, 0.68, mSteel, 0.34));
      g.add(cylX(0.07, 0.06, mSteel, 0.71));
      g.add(cylX(0.055, 0.12, mSteel, 0.8));
      g.add(keyedCylX(0.05, 0.14, 0.012, 0.006, mSteel, 0.93));
      g.add(cylX(0.045, 0.02, mDark, -0.94));
      break;
    }
    case 'keys': {
      g.add(box(0.1, 0.012, 0.018, mSteel, -0.86, 0.05, 0));
      g.add(box(0.08, 0.012, 0.018, mSteel, 0.93, 0.045, 0));
      break;
    }
    case 'bearing': {
      g.userData.pedestalContact = true;
      g.add(hollowCylX(0.17, 0.03, 0.56, paint, metal(0x516d8c, { rough: 0.6, metal: 0.3, side: THREE.BackSide }), mCut, 0));
      for (const seat of [-0.15, 0.15]) g.add(thickRing(0.125, 0.144, 0.039, paint, seat));
      g.add(box(0.26, 0.2, 0.24, paint, 0, -0.26, 0));
      g.add(box(0.44, 0.06, 0.34, mDark, 0, -0.38, 0));
      g.add(box(0.05, 0.05, 0.36, mDark, -0.16, -0.41, 0));
      g.add(box(0.05, 0.05, 0.36, mDark, 0.16, -0.41, 0));
      // 轴承箱支座：延伸到公共底座主板上表面（世界 y≈0.105），消除悬空
      g.add(box(0.26, 0.2, 0.14, paint, 0, -0.47, 0));
      g.add(box(0.24, 0.12, 0.22, paint, 0, -0.6, 0));
      g.add(box(0.34, 0.03, 0.30, mDark, 0, -0.66, 0));
      for (const zs of [-0.1, 0.1]) {
        const rib = box(0.035, 0.2, 0.02, paint, 0, -0.47, zs);
        rib.rotation.z = 0.18;
        g.add(rib);
      }
      g.add(cylY(0.03, 0.06, mSteel, 0.1, 0.17, 0, 16));
      g.add(cylY(0.018, 0.03, metal(0xd9a441, { rough: 0.25, metal: 0.1 }), 0.1, 0.215, 0, 16));
      g.add(cylY(0.02, 0.05, mDark, -0.12, 0.2, 0, 12));
      break;
    }
    case 'brgOuter':
    case 'brgInner':
    case 'brgRollers':
    case 'brgCage': {
      for (const bx of [-0.15, 0.15]) {
        if (id === 'brgOuter') {
          g.add(thickRing(0.104, 0.125, 0.036, mSteel, bx));
        } else if (id === 'brgInner') {
          g.add(thickRing(0.065, 0.08, 0.034, mSteel, bx));
        } else if (id === 'brgRollers') {
          for (let i = 0; i < 9; i++) {
            const a = (i / 9) * Math.PI * 2;
            g.add(mesh(cached('pball', () => new THREE.SphereGeometry(0.012, 10, 8)), mSteel, bx, Math.cos(a) * 0.092, Math.sin(a) * 0.092));
          }
        } else {
          const c = torus(0.092, 0.0035, mDark, bx, 0, 0, Math.PI * 2, 6, 40);
          c.rotation.y = Math.PI / 2;
          g.add(c);
        }
      }
      break;
    }
    case 'brgCovers': {
      for (const bx of [-0.3, 0.3]) {
        g.add(thickRing(0.085, 0.185, 0.04, paint, bx));
        g.add(boltRingX(6, 0.165, 0.011, 0.05, mSteel, bx));
      }
      break;
    }
    case 'coupling': {
      g.add(thickRing(0.056, 0.1, 0.14, metal(color, { rough: 0.4, metal: 0.5 }), -0.06));
      g.add(thickRing(0.056, 0.18, 0.032, metal(color, { rough: 0.4, metal: 0.5 }), 0.01));
      break;
    }
    case 'couplingMotor': {
      g.add(cylX(0.1, 0.14, metal(color, { rough: 0.4, metal: 0.5 }), 0.06));
      g.add(thickRing(0.045, 0.18, 0.032, metal(color, { rough: 0.4, metal: 0.5 }), -0.01));
      g.add(box(0.07, 0.012, 0.016, mSteel, 0.1, 0.055, 0));
      break;
    }
    case 'couplingBolts': {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        g.add(cylX(0.013, 0.12, mSteel, 0, Math.cos(a) * 0.135, Math.sin(a) * 0.135, 8));
        g.add(cylX(0.02, 0.016, mDark, -0.065, Math.cos(a) * 0.135, Math.sin(a) * 0.135, 8));
      }
      break;
    }
    case 'motor': {
      g.userData.mountShim = true;
      g.add(hollowCylX(0.335, 0.035, 0.98, paint, metal(0x33506f, { rough: 0.6, metal: 0.3, side: THREE.BackSide }), mCut, 0));
      // 散热筋
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const f = box(0.9, 0.055, 0.022, paint, 0, Math.cos(a) * 0.355, Math.sin(a) * 0.355);
        f.rotation.x = -a;
        g.add(f);
      }
      g.add(cylX(0.335, 0.05, paint, -0.5));
      g.add(cylX(0.335, 0.05, paint, 0.5));
      // 接线盒座 + 底脚 + 吊环
      g.add(box(0.24, 0.14, 0.22, paint, 0, 0.42, 0));
      g.add(box(0.9, 0.22, 0.12, paint, 0, -0.48, 0.26));
      g.add(box(0.9, 0.22, 0.12, paint, 0, -0.48, -0.26));
      g.add(box(0.7, 0.04, 0.8, mDark, 0, -0.6, 0));
      // 安装垫板：填平电机底脚与公共底座主板上表面之间的间隙
      g.add(box(0.72, 0.06, 0.82, mDark, 0, -0.645, 0));
      const eye = torus(0.045, 0.014, mSteel, 0, 0.53, 0, Math.PI * 2, 8, 16);
      g.add(eye);
      break;
    }
    case 'motorStator': {
      g.add(hollowCylX(0.29, 0.05, 0.78, metal(0x4a6285, { rough: 0.5, metal: 0.4, side: THREE.DoubleSide }), metal(0x3a4f6c, { rough: 0.55, metal: 0.4, side: THREE.BackSide }), mCut, 0));
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const t = box(0.72, 0.045, 0.028, metal(0x54698a, { rough: 0.5, metal: 0.45 }), 0, Math.cos(a) * 0.235, Math.sin(a) * 0.235);
        t.rotation.x = -a;
        g.add(t);
      }
      for (const x of [-0.36, 0.36]) {
        const w = torus(0.25, 0.02, mCopper, x, 0, 0, Math.PI * 2, 8, 40);
        w.rotation.y = Math.PI / 2;
        g.add(w);
      }
      break;
    }
    case 'motorRotor': {
      for (let i = 0; i < 11; i++) {
        g.add(cylX(0.215, 0.055, metal(i % 2 ? 0x9aa5b1 : 0x8a94a0, { rough: 0.35, metal: 0.8 }), -0.35 + i * 0.07));
      }
      break;
    }
    case 'motorShaft': {
      g.add(cylX(0.045, 1.32, mSteel, -0.1));
      g.add(cylX(0.055, 0.06, mSteel, 0.42));
      g.add(box(0.07, 0.012, 0.016, mSteel, -0.66, 0.05, 0));
      break;
    }
    case 'motorEnds': {
      for (const x of [-0.51, 0.51]) {
        g.add(thickRing(0.06, 0.3, 0.05, paint, x));
        g.add(cylX(0.09, 0.06, paint, x + (x < 0 ? -0.04 : 0.04)));
        g.add(boltRingX(4, 0.24, 0.012, 0.06, mSteel, x));
      }
      break;
    }
    case 'motorFan': {
      g.add(cylX(0.032, 0.1, mSteel, 0));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const b = box(0.06, 0.16, 0.012, mDark, 0, Math.cos(a) * 0.12, Math.sin(a) * 0.12);
        b.rotation.x = -a + 0.35;
        g.add(b);
      }
      break;
    }
    case 'motorFanCover': {
      g.add(hollowCylX(0.33, 0.02, 0.16, paint, metal(0x33506f, { rough: 0.6, metal: 0.3, side: THREE.BackSide }), mCut, 0));
      const cap = mesh(cached('fancap', () => new THREE.SphereGeometry(0.33, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2)), paint);
      cap.rotation.z = -Math.PI / 2;
      g.add(cap);
      for (const x of [-0.06, 0, 0.06]) {
        const r = torus(0.33, 0.006, paint, x, 0, 0, Math.PI * 2, 6, 40);
        r.rotation.y = Math.PI / 2;
        g.add(r);
      }
      break;
    }
    case 'motorTerminalCover': {
      g.add(box(0.26, 0.035, 0.22, paint, 0, 0.02, 0));
      g.add(boltRingX(2, 0.1, 0.008, 0.04, mSteel, 0.03));
      break;
    }
    case 'pipeSuction': {
      g.add(hollowCylX(0.14, 0.02, 1.17, paint, mSteelIn, mCut, 0, 0, 0, 40, true));
      g.add(flangeHolesX(0.22, 0.045, 0.018, 8, 0.17, paint, 0.6, 0.12));
      g.add(flangeHolesX(0.22, 0.045, 0.018, 8, 0.17, paint, -0.6, 0.12));
      break;
    }
    case 'pipeElbowIn': {
      // 水平（来自泵）→ 向下：arc [90°,180°]，圆心 (-0.05,0)
      g.add(hollowElbow(0.23, 0.14, 0.02, paint, mSteelIn, mCut, -0.05, 0, Math.PI / 2));
      // 立管段 + 底部法兰
      g.add(hollowCylY(0.14, 0.02, 0.34, paint, mSteelIn, mCut, -0.28, -0.18, 0, 40, true));
      g.add(flangeHolesY(0.22, 0.045, 0.018, 8, 0.17, paint, -0.36, 0.12));
      break;
    }
    case 'pipeDischargeV': {
      g.add(hollowCylY(0.12, 0.018, 0.414, paint, mSteelIn, mCut, 0, -0.106, 0, 40, true));
      // 下法兰与泵出口法兰同径同孔距（孔圈 0.16）
      g.add(flangeHolesY(0.22, 0.045, 0.016, 8, 0.16, paint, -0.33, 0.1));
      break;
    }
    case 'pipeElbowOut': {
      // 竖直排出管顶端 → 水平排出管：圆心在弯头内下侧，端部与两段管轴线相切
      const elbow = hollowElbow(0.23, 0.12, 0.018, paint, mSteelIn, mCut, 0.23, -0.23, Math.PI / 2);
      g.add(elbow);
      break;
    }
    case 'pipeDischargeH': {
      g.add(hollowCylX(0.105, 0.016, 1.16, paint, mSteelIn, mCut, 0, 0, 0, 40, true));
      break;
    }
    case 'pipeReducer': {
      const reducer = mesh(cached('reducer', () => new THREE.CylinderGeometry(0.105, 0.088, 0.22, 36, 1, true)), paint);
      reducer.rotation.z = Math.PI / 2;
      g.add(reducer);
      const inner = mesh(cached('reducerIn', () => new THREE.CylinderGeometry(0.089, 0.072, 0.2196, 36, 1, true)), mSteelIn);
      inner.rotation.z = Math.PI / 2;
      g.add(inner);
      const cap = mesh(cached('reducerCap', () => new THREE.RingGeometry(0.072, 0.088, 36)), mCut, 0.11);
      cap.rotation.y = Math.PI / 2;
      g.add(cap);
      g.add(flangeHolesX(0.15, 0.04, 0.012, 6, 0.115, paint, -0.13, 0.1));
      g.add(flangeHolesX(0.13, 0.04, 0.012, 6, 0.1, paint, 0.13, 0.085));
      break;
    }
    case 'pipeGaskets': {
      for (const p of [[-1.68, 0.78, 0] as const, [-1.0, 1.7, 0] as const]) {
        const isX = p[0] < -1.2;
        const ring = isX
          ? (() => { const r = torus(0.155, 0.014, mRubber, p[0] + 1.3, p[1] - 1.24, 0, Math.PI * 2, 6, 40); r.rotation.y = Math.PI / 2; return r; })()
          : (() => { const r = torus(0.125, 0.012, mRubber, p[0] + 1.3, p[1] - 1.24, 0, Math.PI * 2, 6, 40); r.rotation.x = Math.PI / 2; return r; })();
        g.add(ring);
      }
      break;
    }
    case 'pipeBolts': {
      for (const set of [
        { x: -1.68, y: 0.78, axis: 'x', ring: 0.21, n: 8 },
        { x: -1.0, y: 1.7, axis: 'y', ring: 0.16, n: 8 }
      ] as const) {
        for (let i = 0; i < set.n; i++) {
          const a = (i / set.n) * Math.PI * 2;
          if (set.axis === 'x') {
            g.add(cylX(0.012, 0.16, mSteel, set.x + 1.3, set.y - 1.24 + Math.cos(a) * set.ring, Math.sin(a) * set.ring, 8));
            g.add(cylX(0.02, 0.018, mDark, set.x + 1.3 - 0.08, set.y - 1.24 + Math.cos(a) * set.ring, Math.sin(a) * set.ring, 8));
          } else {
            g.add(cylY(0.011, 0.16, mSteel, set.x + 1.3 + Math.cos(a) * set.ring, set.y - 1.24, Math.sin(a) * set.ring, 8));
            g.add(cylY(0.018, 0.018, mDark, set.x + 1.3 + Math.cos(a) * set.ring, set.y - 1.24 + 0.08, Math.sin(a) * set.ring, 8));
          }
        }
      }
      break;
    }
    case 'pipeSupports': {
      g.userData.supportPoints = [[-2.0, 0.78], [0.0, 2.35]];
      // 吸入水平管支架（世界 x≈-2.0）与排出水平管支架（世界 x≈0.0）
      g.add(cylY(0.035, 0.63, mDark, -0.6, 0.015, 0));
      g.add(box(0.24, 0.03, 0.24, mDark, -0.6, -0.285, 0));
      const clampL = torus(0.155, 0.012, mDark, -0.6, 0.48, 0, Math.PI * 2, 6, 40);
      clampL.rotation.y = Math.PI / 2;
      g.add(clampL);
      // 排出管支架立在公共底座主板上表面，不再穿过底座板
      g.add(cylY(0.04, 2.175, mDark, 1.4, 0.9225, 0));
      g.add(box(0.26, 0.03, 0.26, mDark, 1.4, -0.15, 0));
      const clampR = torus(0.115, 0.012, mDark, 1.4, 2.05, 0, Math.PI * 2, 6, 40);
      clampR.rotation.y = Math.PI / 2;
      g.add(clampR);
      break;
    }
  }
  return g;
}

