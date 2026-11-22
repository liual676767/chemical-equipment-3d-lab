/* 工坊程序化几何：所有模型为教学示意模型。
 * 几何按 partId+规格缓存复用，材质按实例创建以支持独立高亮。 */
import * as THREE from 'three';
import { MM } from './types';
import type { MaterialKind } from './types';
import { dnSpec, flangeSpec } from './specs';
import { GASKET_THICKNESS, nutThickness, odU, pipeLen, elbowR, teeDims, reducerDims, flangeDims, valveF, boltDims, portsFor, weldNeckRadius } from './layout';
import type { Spec } from './layout';
import { assemblyAssetById } from './expansion';

const geoCache = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
export function clearGeoCache() { geoCache.clear(); }

const MAT_PRESET: Record<MaterialKind, { metalness: number; roughness: number }> = {
  'carbon-steel': { metalness: 0.55, roughness: 0.5 },
  stainless: { metalness: 0.75, roughness: 0.3 },
  'cast-iron': { metalness: 0.35, roughness: 0.6 },
  rubber: { metalness: 0.0, roughness: 0.9 },
  alloy: { metalness: 0.8, roughness: 0.35 },
  ptfe: { metalness: 0.0, roughness: 0.7 }
};

export function makeMat(color: string, kind: MaterialKind, extra?: Partial<THREE.MeshStandardMaterialParameters>): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, ...MAT_PRESET[kind], ...extra });
}

const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);

function mesh(g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh {
  const me = new THREE.Mesh(g, m);
  me.castShadow = true;
  me.receiveShadow = true;
  return me;
}

/* 沿 X 轴的圆柱，radiusTop 在 +X 端 */
function cylX(rTop: number, rBot: number, len: number, m: THREE.Material, open = true, seg = 28): THREE.Mesh {
  const g = geo(`cx:${rTop}:${rBot}:${len}:${open}:${seg}`, () => new THREE.CylinderGeometry(rTop, rBot, len, seg, 1, open));
  const me = mesh(g, m);
  me.rotation.z = -Math.PI / 2;
  return me;
}

function ringAt(pos: THREE.Vector3, dir: THREE.Vector3, rIn: number, rOut: number, m: THREE.Material): THREE.Mesh {
  const g = geo(`ring:${rIn}:${rOut}`, () => new THREE.RingGeometry(rIn, rOut, 28));
  const me = mesh(g, m);
  me.position.copy(pos);
  me.quaternion.setFromUnitVectors(Z, dir.clone().normalize());
  return me;
}

/* 有内外壁与开口环的直管段（沿 X，居中） */
function tubeX(r: number, wall: number, L: number, m: THREE.MeshStandardMaterial, key: string): THREE.Group {
  const g = new THREE.Group();
  const outer = cylX(r, r, L, m, true);
  const inner = cylX(r - wall, r - wall, L, makeMat('#3d4a59', 'carbon-steel', { side: THREE.BackSide }), true);
  g.add(outer, inner);
  const rm = makeMat('#5a6b7e', 'carbon-steel');
  g.add(ringAt(new THREE.Vector3(-L / 2, 0, 0), new THREE.Vector3(-1, 0, 0), r - wall, r, rm));
  g.add(ringAt(new THREE.Vector3(L / 2, 0, 0), new THREE.Vector3(1, 0, 0), r - wall, r, rm));
  g.name = key;
  return g;
}

/* 法兰盘（含中心孔与螺栓孔），face 朝 +X，盘体居中 */
function flangeDiscGeo(dn: number, blind: boolean): THREE.BufferGeometry {
  return geo(`fl:${dn}:${blind}`, () => {
    const f = flangeSpec(dn);
    const R = f.d * MM / 2;
    const shape = new THREE.Shape();
    shape.absarc(0, 0, R, 0, Math.PI * 2, false);
    if (!blind) {
      const bore = new THREE.Path();
      bore.absarc(0, 0, dnSpec(dn).od * MM / 2 + 0.015, 0, Math.PI * 2, true);
      shape.holes.push(bore);
    }
    for (let i = 0; i < f.n; i++) {
      const a = Math.PI / 2 + (i * Math.PI * 2) / f.n;
      const h = new THREE.Path();
      h.absarc((f.k * MM / 2) * Math.cos(a), (f.k * MM / 2) * Math.sin(a), f.hole * MM / 2, 0, Math.PI * 2, true);
      shape.holes.push(h);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: f.t * MM, bevelEnabled: false, curveSegments: 24 });
    g.rotateY(Math.PI / 2);
    g.translate(-f.t * MM / 2, 0, 0);
    return g;
  });
}

/* 在 pos 处放置法兰，使密封面恰好位于 pos、朝向 dir */
function addFlange(group: THREE.Group, dn: number, pos: [number, number, number], dir: [number, number, number], m: THREE.Material, blind = false) {
  const me = mesh(flangeDiscGeo(dn, blind), m);
  const d = new THREE.Vector3(...dir).normalize();
  me.quaternion.setFromUnitVectors(X, d);
  const t = flangeSpec(dn).t * MM;
  me.position.set(...pos).addScaledVector(d, -t / 2);
  group.add(me);
  return me;
}

function hexGeo(r: number, depth: number, holeR: number): THREE.BufferGeometry {
  return geo(`hex:${r}:${depth}:${holeR}`, () => {
    const shape = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const x = r * Math.cos(a), y = r * Math.sin(a);
      if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    shape.closePath();
    if (holeR > 0) {
      const h = new THREE.Path();
      h.absarc(0, 0, holeR, 0, Math.PI * 2, true);
      shape.holes.push(h);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    g.rotateY(Math.PI / 2);
    g.translate(-depth / 2, 0, 0);
    return g;
  });
}

/* ============ 各零件构建器 ============ */

function buildPipe(spec: Spec, m: THREE.MeshStandardMaterial): THREE.Group {
  const s = dnSpec(spec.dn);
  return tubeX(s.od * MM / 2, s.wall * MM, pipeLen(spec), m, 'pipe');
}

function buildElbow(spec: Spec, m: THREE.MeshStandardMaterial, deg: 90 | 45): THREE.Group {
  const g = new THREE.Group();
  const r = odU(spec.dn) / 2;
  const wall = dnSpec(spec.dn).wall * MM;
  const R = elbowR(spec.dn);
  const arc = (deg * Math.PI) / 180;
  const outer = mesh(geo(`el:${deg}:${spec.dn}`, () => new THREE.TorusGeometry(R, r, 18, 26, arc)), m);
  outer.rotation.z = -Math.PI / 2;
  outer.position.set(0, R, 0);
  const inner = mesh(geo(`eli:${deg}:${spec.dn}`, () => new THREE.TorusGeometry(R, r - wall, 18, 26, arc)), makeMat('#3d4a59', 'carbon-steel', { side: THREE.BackSide }));
  inner.rotation.z = -Math.PI / 2;
  inner.position.set(0, R, 0);
  g.add(outer, inner);
  const rm = makeMat('#5a6b7e', 'carbon-steel');
  g.add(ringAt(new THREE.Vector3(0, 0, 0), new THREE.Vector3(-1, 0, 0), r - wall, r, rm));
  const endA = -Math.PI / 2 + arc;
  const p2 = new THREE.Vector3(R * Math.cos(endA), R + R * Math.sin(endA), 0);
  const d2 = new THREE.Vector3(-Math.sin(endA), Math.cos(endA), 0);
  g.add(ringAt(p2, d2, r - wall, r, rm));
  return g;
}

function buildTee(spec: Spec, m: THREE.MeshStandardMaterial, reducing: boolean): THREE.Group {
  const g = new THREE.Group();
  const { L, H } = teeDims(spec.dn);
  const r = odU(spec.dn) / 2;
  const wall = dnSpec(spec.dn).wall * MM;
  const main = tubeX(r, wall, L, m, 'tee-main');
  g.add(main);
  const branchDn = reducing ? reducerDims(spec).small : spec.dn;
  const br = odU(branchDn) / 2;
  const bw = dnSpec(branchDn).wall * MM;
  const bg = geo(`cy:${br}:${H}`, () => new THREE.CylinderGeometry(br, br, H, 24, 1, true));
  const bm = mesh(bg, m);
  bm.position.set(0, H / 2, 0);
  const bi = mesh(geo(`cyi:${br}:${H}`, () => new THREE.CylinderGeometry(br - bw, br - bw, H, 20, 1, true)), makeMat('#3d4a59', 'carbon-steel', { side: THREE.BackSide }));
  bi.position.set(0, H / 2, 0);
  g.add(bm, bi);
  g.add(ringAt(new THREE.Vector3(0, H, 0), new THREE.Vector3(0, 1, 0), br - bw, br, makeMat('#5a6b7e', 'carbon-steel')));
  return g;
}

function buildCross(spec: Spec, m: THREE.MeshStandardMaterial): THREE.Group {
  const g = new THREE.Group();
  const { L } = teeDims(spec.dn);
  const r = odU(spec.dn) / 2;
  const wall = dnSpec(spec.dn).wall * MM;
  g.add(tubeX(r, wall, L, m, 'cross-x'));
  const vert = tubeX(r, wall, L, m, 'cross-y');
  vert.rotation.z = Math.PI / 2;
  g.add(vert);
  return g;
}

function buildReducer(spec: Spec, m: THREE.MeshStandardMaterial, ecc: boolean): THREE.Group {
  const g = new THREE.Group();
  const { L, r1, r2 } = reducerDims(spec);
  const w1 = dnSpec(spec.dn).wall * MM;
  const key = `rd:${spec.dn}:${ecc}`;
  const outerG = geo(key, () => {
    const c = new THREE.CylinderGeometry(r2, r1, L, 28, 1, true);
    if (ecc) {
      const p = c.attributes.position;
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) > L / 2 - 1e-4) p.setX(i, p.getX(i) + (r1 - r2));
      }
      p.needsUpdate = true;
      c.computeVertexNormals();
    }
    return c;
  });
  const outer = mesh(outerG, m);
  outer.rotation.z = -Math.PI / 2;
  const innerG = geo(key + ':i', () => {
    const c = new THREE.CylinderGeometry(r2 - w1, r1 - w1, L, 24, 1, true);
    if (ecc) {
      const p = c.attributes.position;
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) > L / 2 - 1e-4) p.setX(i, p.getX(i) + (r1 - r2));
      }
      p.needsUpdate = true;
    }
    return c;
  });
  const inner = mesh(innerG, makeMat('#3d4a59', 'carbon-steel', { side: THREE.BackSide }));
  inner.rotation.z = -Math.PI / 2;
  g.add(outer, inner);
  const rm = makeMat('#5a6b7e', 'carbon-steel');
  g.add(ringAt(new THREE.Vector3(-L / 2, 0, 0), new THREE.Vector3(-1, 0, 0), r1 - w1, r1, rm));
  const off = ecc ? -(r1 - r2) : 0;
  g.add(ringAt(new THREE.Vector3(L / 2, off, 0), new THREE.Vector3(1, 0, 0), r2 - w1, r2, rm));
  return g;
}

function buildCap(spec: Spec, m: THREE.MeshStandardMaterial): THREE.Group {
  const g = new THREE.Group();
  const r = odU(spec.dn) / 2;
  const wall = dnSpec(spec.dn).wall * MM;
  const stub = cylX(r, r, r * 0.6, m, true);
  stub.position.x = r * 0.3;
  const head = mesh(geo(`cap:${spec.dn}`, () => new THREE.SphereGeometry(r, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2)), m);
  head.rotation.z = -Math.PI / 2;
  head.scale.set(1, 0.7, 1);
  head.position.x = r * 0.6;
  g.add(stub, head);
  g.add(ringAt(new THREE.Vector3(0, 0, 0), new THREE.Vector3(-1, 0, 0), r - wall, r, makeMat('#5a6b7e', 'carbon-steel')));
  return g;
}

function buildUnion(spec: Spec, m: THREE.MeshStandardMaterial): THREE.Group {
  const g = new THREE.Group();
  const r = odU(spec.dn) / 2;
  const L = 2.2 * odU(spec.dn);
  const a = cylX(r * 1.15, r * 1.15, L / 3, m, false);
  a.position.x = -L / 3;
  const b = cylX(r * 1.15, r * 1.15, L / 3, m, false);
  b.position.x = L / 3;
  const nut = mesh(hexGeo(r * 1.5, L / 3, r * 0.9), makeMat('#a8b2bf', 'carbon-steel'));
  g.add(a, b, nut);
  const rm = makeMat('#5a6b7e', 'carbon-steel');
  g.add(ringAt(new THREE.Vector3(-L / 2, 0, 0), new THREE.Vector3(-1, 0, 0), r * 0.7, r * 1.15, rm));
  g.add(ringAt(new THREE.Vector3(L / 2, 0, 0), new THREE.Vector3(1, 0, 0), r * 0.7, r * 1.15, rm));
  return g;
}

function buildFlange(spec: Spec, m: THREE.MeshStandardMaterial, kind: 'so' | 'wn' | 'blind'): THREE.Group {
  const g = new THREE.Group();
  const { t, hub } = flangeDims(spec.dn);
  const disc = mesh(flangeDiscGeo(spec.dn, kind === 'blind'), m);
  g.add(disc);
  if (kind !== 'blind') {
    const r = odU(spec.dn) / 2 + 0.02;
    if (kind === 'so') {
      const h = cylX(r, r, hub, m, true);
      h.position.x = -(t / 2 + hub / 2);
      g.add(h);
    } else {
      const h = cylX(weldNeckRadius(spec.dn), r, hub, m, true);
      h.position.x = -(t / 2 + hub / 2);
      g.add(h);
    }
    g.add(ringAt(new THREE.Vector3(-(t / 2 + hub), 0, 0), new THREE.Vector3(-1, 0, 0), r - 0.03, r, makeMat('#5a6b7e', 'carbon-steel')));
  }
  return g;
}

function buildGasket(spec: Spec): THREE.Group {
  const g = new THREE.Group();
  const f = flangeSpec(spec.dn);
  const rOut = f.k * MM / 2 - f.hole * MM / 2 - 0.03;
  const rIn = odU(spec.dn) / 2 - 0.02;
  const me = mesh(geo(`gk:${spec.dn}`, () => {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, rOut, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, rIn, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const gg = new THREE.ExtrudeGeometry(shape, { depth: GASKET_THICKNESS, bevelEnabled: false, curveSegments: 24 });
    gg.rotateY(Math.PI / 2);
    gg.translate(-GASKET_THICKNESS / 2, 0, 0);
    return gg;
  }), makeMat('#d98e32', 'rubber'));
  g.add(me);
  return g;
}

function buildBolt(spec: Spec): THREE.Group {
  const g = new THREE.Group();
  const { head, len, r } = boltDims(spec.dn);
  const m = makeMat('#6b7684', 'alloy');
  const hm = mesh(hexGeo(r * 1.75, head, 0), m);
  hm.position.x = -head / 2;
  const shank = cylX(r, r, len, m, false, 14);
  shank.position.x = len / 2;
  g.add(hm, shank);
  return g;
}

function buildNut(spec: Spec): THREE.Group {
  const g = new THREE.Group();
  const { r } = boltDims(spec.dn);
  const th = nutThickness(spec.dn);
  g.add(mesh(hexGeo(r * 1.75, th, r * 0.92), makeMat('#5d6774', 'alloy')));
  return g;
}

function buildClamp(spec: Spec, support: boolean): THREE.Group {
  const g = new THREE.Group();
  const r = odU(spec.dn) / 2;
  const m = makeMat(support ? '#c9a15f' : '#eaa23b', 'carbon-steel');
  const band = mesh(geo(`cl:${spec.dn}:${support}`, () => new THREE.TorusGeometry(r + 0.06, 0.05, 10, 22, Math.PI)), m);
  band.rotation.y = Math.PI / 2;
  band.rotation.x = 0;
  band.rotation.z = Math.PI / 2;
  g.add(band);
  const base = mesh(geo(`clb:${support}`, () => new THREE.BoxGeometry(0.5, 0.12, 0.7)), m);
  base.position.y = -(r + 0.16);
  g.add(base);
  if (support) {
    const col = mesh(geo('clcol', () => new THREE.BoxGeometry(0.22, 2.6, 0.22)), m);
    col.position.y = -(r + 0.16) - 1.3;
    const foot = mesh(geo('clfoot', () => new THREE.BoxGeometry(0.9, 0.1, 0.9)), m);
    foot.position.y = -(r + 0.16) - 2.6;
    g.add(col, foot);
  } else {
    for (const s of [-1, 1]) {
      const bolt = cylX(0.04, 0.04, 0.3, makeMat('#6b7684', 'alloy'), false, 8);
      bolt.rotation.set(0, 0, Math.PI / 2);
      bolt.position.set(0, 0, s * (r + 0.14));
      g.add(bolt);
    }
  }
  return g;
}

/* 阀门公共：两端法兰 + 流向标识 */
function valveEnds(g: THREE.Group, spec: Spec, m: THREE.Material) {
  const F = valveF(spec.dn);
  addFlange(g, spec.dn, [-F / 2, 0, 0], [-1, 0, 0], m);
  addFlange(g, spec.dn, [F / 2, 0, 0], [1, 0, 0], m);
}

function flowArrow(g: THREE.Group, y: number): THREE.Group {
  const a = new THREE.Group();
  const m = makeMat('#2e9d74', 'rubber', { emissive: '#1d6b4f', emissiveIntensity: 0.4 });
  const shaft = mesh(geo('fa:s', () => new THREE.CylinderGeometry(0.05, 0.05, 0.7, 10)), m);
  shaft.rotation.z = -Math.PI / 2;
  const tip = mesh(geo('fa:t', () => new THREE.ConeGeometry(0.13, 0.3, 12)), m);
  tip.rotation.z = -Math.PI / 2;
  tip.position.x = 0.5;
  a.add(shaft, tip);
  a.position.y = y;
  a.name = 'flow-arrow';
  g.add(a);
  return a;
}

function buildBallValve(spec: Spec, color: string): THREE.Group {
  const g = new THREE.Group();
  const r = odU(spec.dn) / 2;
  const bodyM = makeMat(color, 'cast-iron');
  valveEnds(g, spec, bodyM);
  const F = valveF(spec.dn);
  const neck = cylX(r * 1.05, r * 1.05, F - 0.4, bodyM, false);
  g.add(neck);
  const body = mesh(geo(`vb:${spec.dn}`, () => new THREE.SphereGeometry(r * 1.9, 26, 18)), bodyM.clone());
  body.scale.set(1.15, 1, 1);
  body.userData.shell = true;
  g.add(body);
  const pivot = new THREE.Group();
  pivot.name = 'pivot';
  const ball = mesh(geo(`vbb:${spec.dn}`, () => new THREE.SphereGeometry(r * 1.35, 22, 16)), makeMat('#c8d2dc', 'stainless'));
  const bore = cylX(r * 0.85, r * 0.85, r * 2.9, makeMat('#22303f', 'carbon-steel'), false, 18);
  const stem = mesh(geo(`vbs:${spec.dn}`, () => new THREE.CylinderGeometry(r * 0.22, r * 0.22, r * 2.4, 12)), makeMat('#9aa7b6', 'alloy'));
  stem.position.y = r * 1.9;
  const handle = mesh(geo(`vbh:${spec.dn}`, () => new THREE.BoxGeometry(r * 3.4, r * 0.22, r * 0.5)), makeMat('#d64545', 'rubber'));
  handle.position.y = r * 3.0;
  pivot.add(ball, bore, stem, handle);
  g.add(pivot);
  flowArrow(g, -(r * 2.4));
  return g;
}

function buildGateValve(spec: Spec, color: string): THREE.Group {
  const g = new THREE.Group();
  const r = odU(spec.dn) / 2;
  const bodyM = makeMat(color, 'cast-iron');
  valveEnds(g, spec, bodyM);
  const F = valveF(spec.dn);
  const neck = cylX(r * 1.05, r * 1.05, F - 0.4, bodyM, false);
  g.add(neck);
  const body = mesh(geo(`vg:${spec.dn}`, () => new THREE.SphereGeometry(r * 1.8, 26, 18)), bodyM.clone());
  body.scale.set(1.1, 1.35, 0.9);
  body.userData.shell = true;
  g.add(body);
  const bonnet = mesh(geo(`vgb:${spec.dn}`, () => new THREE.CylinderGeometry(r * 0.75, r * 1.05, r * 1.6, 18)), bodyM);
  bonnet.position.y = r * 2.2;
  bonnet.userData.shell = true;
  const stem = mesh(geo(`vgs:${spec.dn}`, () => new THREE.CylinderGeometry(r * 0.16, r * 0.16, r * 2.6, 10)), makeMat('#9aa7b6', 'alloy'));
  stem.position.y = r * 3.4;
  const wheel = mesh(geo(`vgw:${spec.dn}`, () => new THREE.TorusGeometry(r * 1.05, r * 0.12, 10, 22)), makeMat('#d64545', 'rubber'));
  wheel.rotation.x = Math.PI / 2;
  wheel.position.y = r * 4.5;
  g.add(bonnet, stem, wheel);
  const gate = mesh(geo(`vgg:${spec.dn}`, () => new THREE.BoxGeometry(r * 0.35, r * 2.3, r * 2.1)), makeMat('#c8d2dc', 'stainless'));
  gate.name = 'demo-gate';
  gate.position.y = 0;
  g.add(gate);
  flowArrow(g, -(r * 2.6));
  return g;
}

function buildCheckValve(spec: Spec, color: string): THREE.Group {
  const g = new THREE.Group();
  const r = odU(spec.dn) / 2;
  const bodyM = makeMat(color, 'cast-iron');
  valveEnds(g, spec, bodyM);
  const F = valveF(spec.dn);
  const neck = cylX(r * 1.05, r * 1.05, F - 0.4, bodyM, false);
  g.add(neck);
  const body = mesh(geo(`vc:${spec.dn}`, () => new THREE.SphereGeometry(r * 1.85, 26, 18)), bodyM.clone());
  body.scale.set(1.15, 1.05, 1);
  body.userData.shell = true;
  g.add(body);
  const cap = mesh(geo(`vcc:${spec.dn}`, () => new THREE.CylinderGeometry(r * 0.8, r * 0.95, r * 0.7, 18)), bodyM);
  cap.position.y = r * 1.8;
  cap.userData.shell = true;
  g.add(cap);
  const pivot = new THREE.Group();
  pivot.name = 'pivot';
  pivot.position.set(-r * 0.4, r * 1.15, 0);
  const disc = mesh(geo(`vcd:${spec.dn}`, () => new THREE.CylinderGeometry(r * 1.05, r * 1.05, r * 0.22, 22)), makeMat('#c8d2dc', 'stainless'));
  disc.rotation.z = Math.PI / 2;
  disc.position.set(r * 0.4, -r * 1.05, 0);
  const arm = mesh(geo(`vca:${spec.dn}`, () => new THREE.BoxGeometry(r * 0.18, r * 1.1, r * 0.3)), makeMat('#9aa7b6', 'alloy'));
  arm.position.set(r * 0.2, -r * 0.5, 0);
  pivot.add(disc, arm);
  g.add(pivot);
  flowArrow(g, r * 2.6);
  return g;
}

function buildPump(spec: Spec): THREE.Group {
  const g = new THREE.Group();
  const voluteM = makeMat('#2e6f9e', 'cast-iron');
  const motorM = makeMat('#5b6b7c', 'cast-iron');
  const baseM = makeMat('#37475a', 'carbon-steel');
  const base = mesh(geo('pump:base', () => new THREE.BoxGeometry(5.4, 0.3, 2.4)), baseM);
  base.position.y = 0.15;
  g.add(base);
  const r80 = odU(80) / 2;
  const r65 = odU(65) / 2;
  /* 蜗壳 */
  const volute = mesh(geo('pump:volute', () => new THREE.CylinderGeometry(1.05, 1.05, 0.95, 30)), voluteM.clone());
  volute.rotation.z = Math.PI / 2;
  volute.position.set(-0.55, 1.0, 0);
  volute.userData.shell = true;
  g.add(volute);
  const scroll = mesh(geo('pump:scroll', () => new THREE.TorusGeometry(0.95, 0.22, 12, 26)), voluteM);
  scroll.rotation.y = Math.PI / 2;
  scroll.position.set(-0.55, 1.0, 0);
  scroll.userData.shell = true;
  g.add(scroll);
  /* 入口管段 + 法兰 */
  const inlet = cylX(r80, r80, 0.9, voluteM, true);
  inlet.position.set(-1.45, 1.0, 0);
  g.add(inlet);
  addFlange(g, 80, [-1.9, 1.0, 0], [-1, 0, 0], makeMat('#9aa7b6', 'carbon-steel'));
  /* 出口立管 + 法兰 */
  const outlet = mesh(geo(`pump:out:${r65}`, () => new THREE.CylinderGeometry(r65, r65, 0.75, 22, 1, true)), voluteM);
  outlet.position.set(-0.55, 1.78, 0);
  g.add(outlet);
  addFlange(g, 65, [-0.55, 2.15, 0], [0, 1, 0], makeMat('#9aa7b6', 'carbon-steel'));
  /* 电机与联轴器 */
  const motor = mesh(geo('pump:motor', () => new THREE.CylinderGeometry(0.72, 0.72, 2.3, 26)), motorM);
  motor.rotation.z = Math.PI / 2;
  motor.position.set(1.75, 1.0, 0);
  g.add(motor);
  const fan = mesh(geo('pump:fan', () => new THREE.CylinderGeometry(0.76, 0.76, 0.35, 26)), motorM);
  fan.rotation.z = Math.PI / 2;
  fan.position.set(3.0, 1.0, 0);
  g.add(fan);
  const coupling = mesh(geo('pump:coupling', () => new THREE.CylinderGeometry(0.32, 0.32, 0.6, 16)), makeMat('#9aa7b6', 'alloy'));
  coupling.rotation.z = Math.PI / 2;
  coupling.position.set(0.35, 1.0, 0);
  g.add(coupling);
  const feet = mesh(geo('pump:feet', () => new THREE.BoxGeometry(2.6, 0.5, 1.6)), baseM);
  feet.position.set(1.75, 0.5, 0);
  g.add(feet);
  /* 叶轮（内部演示） */
  const pivot = new THREE.Group();
  pivot.name = 'pivot';
  pivot.position.set(-0.55, 1.0, 0);
  const hub = mesh(geo('pump:hub', () => new THREE.CylinderGeometry(0.2, 0.2, 0.7, 14)), makeMat('#c8d2dc', 'stainless'));
  hub.rotation.z = Math.PI / 2;
  pivot.add(hub);
  for (let i = 0; i < 6; i++) {
    const blade = mesh(geo('pump:blade', () => new THREE.BoxGeometry(0.5, 0.62, 0.08)), makeMat('#c8d2dc', 'stainless'));
    const a = (i * Math.PI) / 3;
    blade.position.set(0, Math.cos(a) * 0.55, Math.sin(a) * 0.55);
    blade.rotation.x = -a;
    pivot.add(blade);
  }
  g.add(pivot);
  return g;
}

function buildTank(spec: Spec): THREE.Group {
  const g = new THREE.Group();
  const shellM = makeMat('#7f9bb3', 'carbon-steel');
  const legM = makeMat('#4a5a6c', 'carbon-steel');
  const flM = makeMat('#9aa7b6', 'carbon-steel');
  const R = 6;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = mesh(geo('tank:leg', () => new THREE.CylinderGeometry(0.22, 0.28, 8, 14)), legM);
    leg.position.set(sx * 3.6, 4, sz * 3.6);
    g.add(leg);
    const pad = mesh(geo('tank:pad', () => new THREE.BoxGeometry(0.9, 0.15, 0.9)), legM);
    pad.position.set(sx * 3.6, 0.08, sz * 3.6);
    g.add(pad);
  }
  const shell = mesh(geo('tank:shell', () => new THREE.CylinderGeometry(R, R, 14, 40, 1, true)), shellM.clone());
  shell.position.y = 15;
  shell.userData.shell = true;
  g.add(shell);
  const topHead = mesh(geo('tank:head', () => new THREE.SphereGeometry(R, 36, 16, 0, Math.PI * 2, 0, Math.PI / 2)), shellM.clone());
  topHead.scale.y = 0.35;
  topHead.position.y = 22;
  topHead.userData.shell = true;
  const botHead = mesh(geo('tank:headb', () => new THREE.SphereGeometry(R, 36, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)), shellM.clone());
  botHead.scale.y = 0.35;
  botHead.position.y = 8;
  botHead.userData.shell = true;
  g.add(topHead, botHead);
  /* 接口短节 + 法兰 */
  const stubIn = mesh(geo('tank:stin', () => new THREE.CylinderGeometry(odU(50) / 2, odU(50) / 2, 0.9, 18)), shellM);
  stubIn.position.set(0, 24.1, 0);
  g.add(stubIn);
  addFlange(g, 50, [0, 24.6, 0], [0, 1, 0], flM);
  const stubOut = mesh(geo('tank:stout', () => new THREE.CylinderGeometry(odU(80) / 2, odU(80) / 2, 0.9, 18)), shellM);
  stubOut.position.set(0, 5.5, 0);
  g.add(stubOut);
  addFlange(g, 80, [0, 5.0, 0], [0, -1, 0], flM);
  const stubLg = cylX(odU(25) / 2, odU(25) / 2, 0.4, shellM, false);
  stubLg.position.set(6.15, 15, 0);
  g.add(stubLg);
  addFlange(g, 25, [6.3, 15, 0], [1, 0, 0], flM);
  /* 演示液位（内部） */
  const liquid = mesh(geo('tank:liquid', () => new THREE.CylinderGeometry(R - 0.3, R - 0.3, 1, 32)), makeMat('#3f8fbf', 'rubber', { transparent: true, opacity: 0.75 }));
  liquid.name = 'demo-liquid';
  liquid.scale.y = 7;
  liquid.position.y = 8.5 + 3.5;
  g.add(liquid);
  /* 液位计外玻璃管（示意） */
  const gauge = mesh(geo('tank:gauge', () => new THREE.CylinderGeometry(0.12, 0.12, 12, 10)), makeMat('#bcd7e8', 'stainless', { transparent: true, opacity: 0.6 }));
  gauge.position.set(6.9, 15, 0);
  g.add(gauge);
  return g;
}

function buildHeatExchanger(): THREE.Group {
  const g = new THREE.Group();
  const shellM = makeMat('#7f9bb3', 'carbon-steel');
  const flM = makeMat('#9aa7b6', 'carbon-steel');
  const tubeM = makeMat('#c08a4a', 'stainless');
  const saddleM = makeMat('#4a5a6c', 'carbon-steel');
  const r65 = odU(65) / 2;
  const r50 = odU(50) / 2;
  /* 筒体（轴向 X，中心 y=1.5） */
  const shell = cylX(1.2, 1.2, 8, shellM.clone(), true, 36);
  shell.position.set(0, 1.5, 0);
  shell.userData.shell = true;
  g.add(shell);
  /* 管板 */
  for (const sx of [-1, 1]) {
    const sheet = cylX(1.2, 1.2, 0.15, flM, false, 36);
    sheet.position.set(sx * 4, 1.5, 0);
    g.add(sheet);
  }
  /* 管箱 + 轴向管程接口 */
  for (const sx of [-1, 1]) {
    const barrel = cylX(1.2, 1.2, 0.6, shellM.clone(), true, 36);
    barrel.position.set(sx * 4.3, 1.5, 0);
    barrel.userData.shell = true;
    g.add(barrel);
    const cap = mesh(geo('hx:cap', () => new THREE.SphereGeometry(1.2, 30, 14, 0, Math.PI * 2, 0, Math.PI / 2)), shellM.clone());
    cap.rotation.z = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
    cap.scale.y = 0.35;
    cap.position.set(sx * 4.6, 1.5, 0);
    cap.userData.shell = true;
    g.add(cap);
    const stub = cylX(r65, r65, 0.4, shellM, true);
    stub.position.set(sx * 4.8, 1.5, 0);
    g.add(stub);
    addFlange(g, 65, [sx * 5, 1.5, 0], [sx, 0, 0], flM);
  }
  /* 壳程接口：顶部进、底部出 */
  const stubIn = mesh(geo('hx:stin', () => new THREE.CylinderGeometry(r50, r50, 0.4, 20)), shellM);
  stubIn.position.set(-2, 2.7, 0);
  g.add(stubIn);
  addFlange(g, 50, [-2, 2.9, 0], [0, 1, 0], flM);
  const stubOut = mesh(geo('hx:stout', () => new THREE.CylinderGeometry(r50, r50, 0.4, 20)), shellM);
  stubOut.position.set(2, 0.2, 0);
  g.add(stubOut);
  addFlange(g, 50, [2, 0.1, 0], [0, -1, 0], flM);
  /* 鞍座 */
  for (const sx of [-1, 1]) {
    const saddle = mesh(geo('hx:saddle', () => new THREE.BoxGeometry(0.8, 0.3, 2.2)), saddleM);
    saddle.position.set(sx * 2.5, 0.15, 0);
    g.add(saddle);
    const web = mesh(geo('hx:web', () => new THREE.BoxGeometry(0.8, 0.5, 0.25)), saddleM);
    web.position.set(sx * 2.5, 0.5, 0);
    g.add(web);
  }
  /* 内部管束（剖视可见） */
  const offs: [number, number][] = [[0, 0], [0.45, 0], [-0.45, 0], [0.22, 0.4], [-0.22, 0.4], [0.22, -0.4], [-0.22, -0.4]];
  for (const [dy, dz] of offs) {
    const tube = cylX(0.09, 0.09, 7.8, tubeM, true, 12);
    tube.position.set(0, 1.5 + dy, dz);
    g.add(tube);
  }
  /* 折流板（教学示意：圆缺形简化为整圆） */
  for (const x of [-2, 0, 2]) {
    const baffle = cylX(1.08, 1.08, 0.06, makeMat('#8fa6bc', 'carbon-steel'), false, 30);
    baffle.position.set(x, 1.5, 0);
    g.add(baffle);
  }
  return g;
}

/* ============ 分发 ============ */

export function buildPart(partId: string, spec: Spec, color: string, kind: MaterialKind): THREE.Group {
  const m = makeMat(color, kind);
  let g: THREE.Group;
  const registered = assemblyAssetById.get(partId)?.build;
  if (registered) g = registered(spec, m);
  else switch (partId) {
    case 'pipe': g = buildPipe(spec, m); break;
    case 'elbow90': g = buildElbow(spec, m, 90); break;
    case 'elbow45': g = buildElbow(spec, m, 45); break;
    case 'tee': g = buildTee(spec, m, false); break;
    case 'tee-reducing': g = buildTee(spec, m, true); break;
    case 'cross': g = buildCross(spec, m); break;
    case 'reducer-conc': g = buildReducer(spec, m, false); break;
    case 'reducer-ecc': g = buildReducer(spec, m, true); break;
    case 'cap': g = buildCap(spec, m); break;
    case 'union': g = buildUnion(spec, m); break;
    case 'flange-so': g = buildFlange(spec, m, 'so'); break;
    case 'flange-wn': g = buildFlange(spec, m, 'wn'); break;
    case 'flange-blind': g = buildFlange(spec, m, 'blind'); break;
    case 'gasket': g = buildGasket(spec); break;
    case 'bolt': g = buildBolt(spec); break;
    case 'nut': g = buildNut(spec); break;
    case 'clamp': g = buildClamp(spec, false); break;
    case 'support': g = buildClamp(spec, true); break;
    case 'valve-ball': g = buildBallValve(spec, color); break;
    case 'valve-gate': g = buildGateValve(spec, color); break;
    case 'valve-check': g = buildCheckValve(spec, color); break;
    case 'pump-centrifugal': g = buildPump(spec); break;
    case 'tank-vertical': g = buildTank(spec); break;
    case 'heat-shell-tube': g = buildHeatExchanger(); break;
    default: throw new Error(`工坊几何未实现：${partId}`);
  }
  if (spec.endType === 'flange' && FLANGE_END_PARTS.has(partId)) {
    for (const p of portsFor(partId, spec)) {
      if (p.type === 'flange') addFlange(g, p.dn, p.pos, p.dir, m);
    }
  }
  g.traverse((o) => { o.userData.partRoot = true; });
  return g;
}

const FLANGE_END_PARTS = new Set(['pipe', 'elbow90', 'elbow45', 'tee', 'tee-reducing', 'cross', 'reducer-conc', 'reducer-ecc', 'cap']);


