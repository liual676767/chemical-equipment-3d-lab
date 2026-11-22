import * as THREE from 'three';

/**
 * 工业级建模共享几何库（第五轮起统一标准）。
 * 约定：Y 向上（立式设备）或沿 X 为流道（阀门/卧式设备），单位约米。
 * 所有几何为程序化教学示意，演示参数由内容层标注，非制造数据。
 */

const geoCache = new Map<string, THREE.BufferGeometry>();
export function cachedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
export function metal(color: number, opts: { rough?: number; metal?: number; double?: boolean; side?: THREE.Side } = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.rough ?? 0.4,
    metalness: opts.metal ?? 0.6,
    side: opts.side ?? (opts.double ? THREE.DoubleSide : THREE.FrontSide)
  });
}
/** 材质分档：铸造/加工钢/涂装/橡胶/铜绕组 */
export function materialSet(accent: number) {
  return {
    cast: metal(accent, { rough: 0.62, metal: 0.32 }),
    castDouble: metal(accent, { rough: 0.62, metal: 0.32, double: true }),
    machined: metal(0xc7ccd4, { rough: 0.24, metal: 0.9 }),
    machinedIn: metal(0xaeb7c2, { rough: 0.3, metal: 0.85, side: THREE.BackSide }),
    dark: metal(0x374151, { rough: 0.5 }),
    cut: metal(0x9aa5b1, { rough: 0.45, metal: 0.7, double: true }),
    rubber: metal(0x1f2937, { rough: 0.85, metal: 0.05 }),
    copper: metal(0xb87333, { rough: 0.35, metal: 0.8 }),
    glass: metal(0x9fc3d8, { rough: 0.1, metal: 0.1, double: true })
  };
}
export function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const me = new THREE.Mesh(g, m);
  me.position.set(x, y, z);
  me.castShadow = true;
  me.receiveShadow = true;
  return me;
}
export function cylX(r: number, len: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 32): THREE.Mesh {
  const me = mesh(cachedGeo(`ix${r}|${len}|${seg}`, () => new THREE.CylinderGeometry(r, r, len, seg)), m, x, y, z);
  me.rotation.z = Math.PI / 2;
  return me;
}
export function cylY(r: number, len: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 32): THREE.Mesh {
  return mesh(cachedGeo(`iy${r}|${len}|${seg}`, () => new THREE.CylinderGeometry(r, r, len, seg)), m, x, y, z);
}
export function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  return mesh(cachedGeo(`ib${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d)), m, x, y, z);
}
export function torus(radius: number, tube: number, m: THREE.Material, x = 0, y = 0, z = 0, arc = Math.PI * 2, seg = 10, tseg = 36): THREE.Mesh {
  return mesh(cachedGeo(`it${radius}|${tube}|${arc}|${seg}|${tseg}`, () => new THREE.TorusGeometry(radius, tube, seg, tseg, arc)), m, x, y, z);
}
/** 真实中空直管（X 轴）：外壁开口 + 内壁 + 环形端面；tagPipe 供「隐藏管道外壁」 */
export function hollowCylX(rOut: number, wall: number, len: number, mOut: THREE.MeshStandardMaterial, mIn: THREE.MeshStandardMaterial, mCap: THREE.Material, x = 0, y = 0, z = 0, seg = 40, tagPipe = false): THREE.Group {
  const g = new THREE.Group();
  const outer = mesh(cachedGeo(`hox${rOut}|${len}|${seg}`, () => new THREE.CylinderGeometry(rOut, rOut, len, seg, 1, true)), mOut, x, y, z);
  outer.rotation.z = Math.PI / 2;
  if (tagPipe) outer.userData.outerWall = 'pipe';
  g.add(outer);
  const inner = mesh(cachedGeo(`hix${rOut}|${wall}|${len}|${seg}`, () => new THREE.CylinderGeometry(rOut - wall, rOut - wall, len - 0.0004, seg, 1, true)), mIn, x, y, z);
  inner.rotation.z = Math.PI / 2;
  g.add(inner);
  const capGeo = cachedGeo(`rgx${rOut}|${wall}|${seg}`, () => new THREE.RingGeometry(rOut - wall, rOut, seg));
  for (const side of [-1, 1]) {
    const cap = mesh(capGeo, mCap, x + side * len / 2, y, z);
    cap.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(cap);
  }
  return g;
}
export function hollowCylY(rOut: number, wall: number, len: number, mOut: THREE.MeshStandardMaterial, mIn: THREE.MeshStandardMaterial, mCap: THREE.Material, x = 0, y = 0, z = 0, seg = 40, tagPipe = false): THREE.Group {
  const g = new THREE.Group();
  const outer = mesh(cachedGeo(`hoy${rOut}|${len}|${seg}`, () => new THREE.CylinderGeometry(rOut, rOut, len, seg, 1, true)), mOut, x, y, z);
  if (tagPipe) outer.userData.outerWall = 'pipe';
  g.add(outer);
  const inner = mesh(cachedGeo(`hiy${rOut}|${wall}|${len}|${seg}`, () => new THREE.CylinderGeometry(rOut - wall, rOut - wall, len - 0.0004, seg, 1, true)), mIn, x, y, z);
  g.add(inner);
  const capGeo = cachedGeo(`rgy${rOut}|${wall}|${seg}`, () => new THREE.RingGeometry(rOut - wall, rOut, seg));
  for (const side of [-1, 1]) {
    const cap = mesh(capGeo, mCap, x, y + side * len / 2, z);
    cap.rotation.x = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(cap);
  }
  return g;
}
/** 真实带通孔法兰（X 或 Y 轴），标记 boltHoles 供验收 */
export function flangeHolesX(rOut: number, thickness: number, holeR: number, holeCount: number, holeRingR: number, m: THREE.Material, x = 0, bore = 0): THREE.Mesh {
  const geo = cachedGeo(`ifhx${rOut}|${thickness}|${holeR}|${holeCount}|${holeRingR}|${bore}`, () => {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, rOut, 0, Math.PI * 2, false);
    if (bore > 0) { const h = new THREE.Path(); h.absarc(0, 0, bore, 0, Math.PI * 2, true); shape.holes.push(h); }
    for (let i = 0; i < holeCount; i++) {
      const a = (i / holeCount) * Math.PI * 2;
      const h = new THREE.Path();
      h.absarc(Math.cos(a) * holeRingR, Math.sin(a) * holeRingR, holeR, 0, Math.PI * 2, true);
      shape.holes.push(h);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 24 });
    g.translate(0, 0, -thickness / 2);
    g.rotateY(Math.PI / 2);
    return g;
  });
  const me = mesh(geo, m, x);
  me.userData.boltHoles = holeCount;
  return me;
}
export function flangeHolesY(rOut: number, thickness: number, holeR: number, holeCount: number, holeRingR: number, m: THREE.Material, y = 0, bore = 0): THREE.Mesh {
  const geo = cachedGeo(`ifhy${rOut}|${thickness}|${holeR}|${holeCount}|${holeRingR}|${bore}`, () => {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, rOut, 0, Math.PI * 2, false);
    if (bore > 0) { const h = new THREE.Path(); h.absarc(0, 0, bore, 0, Math.PI * 2, true); shape.holes.push(h); }
    for (let i = 0; i < holeCount; i++) {
      const a = (i / holeCount) * Math.PI * 2;
      const h = new THREE.Path();
      h.absarc(Math.cos(a) * holeRingR, Math.sin(a) * holeRingR, holeR, 0, Math.PI * 2, true);
      shape.holes.push(h);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 24 });
    g.translate(0, 0, -thickness / 2);
    g.rotateX(-Math.PI / 2);
    return g;
  });
  const me = mesh(geo, m, 0, y);
  me.userData.boltHoles = holeCount;
  return me;
}
/** 带厚度圆环盘（孔沿 X 轴） */
export function thickRing(rIn: number, rOut: number, thick: number, m: THREE.Material, x = 0): THREE.Group {
  const g = new THREE.Group();
  const capGeo = cachedGeo(`itr${rIn}|${rOut}`, () => new THREE.RingGeometry(rIn, rOut, 48));
  for (const s of [-1, 1]) {
    const c = mesh(capGeo, m, x + s * thick / 2);
    c.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(c);
  }
  const rim = mesh(cachedGeo(`itrrim${rOut}|${thick}`, () => new THREE.CylinderGeometry(rOut, rOut, thick, 48, 1, true)), m, x);
  rim.rotation.z = Math.PI / 2;
  g.add(rim);
  return g;
}
/** 螺栓组（沿 X 或 Y 轴的高度示意，含六角头） */
export function boltSetX(count: number, ring: number, boltR: number, len: number, x: number, mSteel: THREE.Material, mDark: THREE.Material, y = 0, z = 0): THREE.Group {
  const g = new THREE.Group();
  const shank = cachedGeo(`ibs${boltR}|${len}`, () => new THREE.CylinderGeometry(boltR, boltR, len, 8));
  const head = cachedGeo(`ibh${boltR}`, () => new THREE.CylinderGeometry(boltR * 1.7, boltR * 1.7, boltR * 1.2, 6));
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const py = y + Math.cos(a) * ring, pz = z + Math.sin(a) * ring;
    const b = mesh(shank, mSteel, x, py, pz); b.rotation.z = Math.PI / 2; g.add(b);
    const h = mesh(head, mDark, x - len / 2 - boltR * 0.6, py, pz); h.rotation.z = Math.PI / 2; g.add(h);
  }
  return g;
}
export function boltSetY(count: number, ring: number, boltR: number, len: number, y: number, mSteel: THREE.Material, mDark: THREE.Material, x = 0, z = 0): THREE.Group {
  const g = new THREE.Group();
  const shank = cachedGeo(`ibsy${boltR}|${len}`, () => new THREE.CylinderGeometry(boltR, boltR, len, 8));
  const head = cachedGeo(`ibhy${boltR}`, () => new THREE.CylinderGeometry(boltR * 1.7, boltR * 1.7, boltR * 1.2, 6));
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const px = x + Math.cos(a) * ring, pz = z + Math.sin(a) * ring;
    g.add(mesh(shank, mSteel, px, y, pz));
    g.add(mesh(head, mDark, px, y + len / 2 + boltR * 0.6, pz));
  }
  return g;
}
/** 焊缝示意（环形焊道） */
export function weldRing(radius: number, m: THREE.Material, x = 0, axis: 'x' | 'y' = 'x'): THREE.Mesh {
  const t = torus(radius, 0.006, m, x, 0, 0, Math.PI * 2, 6, 40);
  if (axis === 'x') t.rotation.y = Math.PI / 2;
  else t.rotation.x = Math.PI / 2;
  return t;
}
/** 球体真实通孔：球面区域 + 内孔壁（axis: x/y），用于球阀阀球等 */
export function sphereWithBore(R: number, bore: number, axis: 'x' | 'y', mOut: THREE.Material, mIn: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const thetaH = Math.asin(Math.min(bore / R, 0.99));
  const outer = mesh(cachedGeo(`izs${R}|${bore}`, () => new THREE.SphereGeometry(R, 36, 22, 0, Math.PI * 2, thetaH, Math.PI - 2 * thetaH)), mOut);
  const innerLen = 2 * Math.sqrt(Math.max(R * R - bore * bore, 0));
  const inner = mesh(cachedGeo(`izi${R}|${bore}`, () => new THREE.CylinderGeometry(bore, bore, innerLen, 32, 1, true)), mIn);
  if (axis === 'x') { outer.rotation.z = Math.PI / 2; inner.rotation.z = Math.PI / 2; }
  g.add(outer, inner);
  return g;
}
