import * as THREE from 'three';
import { CSG } from 'three-csg-ts';
import { cachedGeo, mesh, materialSet } from './industrial';

/** Demonstration coordinates only; no manufacturer dimensions are claimed. */
export type Hole = { u: number; v: number; r: number };
export type Bore = { pos: [number, number, number]; axis: 'x' | 'y' | 'z'; r: number; length: number };
export const TAU = Math.PI * 2;
/** Remove zero-area pole/Boolean sliver triangles before rendering and picking. */
export function cleanTriangles(input: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = input.index ? input.toNonIndexed() : input;
  const p = g.getAttribute('position'), keep: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    if (b.sub(a).cross(c.sub(a)).lengthSq() > 1e-18) keep.push(i, i + 1, i + 2);
  }
  const result = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const values: number[] = [];
    for (const i of keep) for (let k = 0; k < attr.itemSize; k++) values.push(k === 0 ? attr.getX(i) : k === 1 ? attr.getY(i) : k === 2 ? attr.getZ(i) : attr.getW(i));
    result.setAttribute(name, new THREE.Float32BufferAttribute(values, attr.itemSize));
  }
  result.computeBoundingBox(); result.computeBoundingSphere(); return result;
}
export function circleHoles(count: number, radius: number, holeR: number): Hole[] {
  return Array.from({ length: count }, (_, i) => ({ u: Math.cos(i * TAU / count) * radius, v: Math.sin(i * TAU / count) * radius, r: holeR }));
}
function pathHole(h: Hole) {
  const p = new THREE.Path(); p.absarc(h.u, h.v, h.r, 0, TAU, true); return p;
}
/** Shape coordinates map to world Y/Z; thickness runs along X. */
export function plateGeometry(key: string, shape: THREE.Shape, thickness: number): THREE.BufferGeometry {
  return cachedGeo(key, () => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 20 });
    g.translate(0, 0, -thickness / 2);
    g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
    return g;
  });
}
export function disk(radius: number, thickness: number, holes: Hole[], material: THREE.Material, x = 0): THREE.Mesh {
  const shape = new THREE.Shape(); shape.absarc(0, 0, radius, 0, TAU, false);
  holes.forEach(h => shape.holes.push(pathHole(h)));
  const m = mesh(plateGeometry(`process-disk:${radius}:${thickness}:${JSON.stringify(holes)}`, shape, thickness), material, x);
  m.userData.holes = holes; m.userData.thickness = thickness;
  return m;
}
export function ring(rOut: number, rIn: number, thickness: number, material: THREE.Material, x = 0) {
  return disk(rOut, thickness, [{ u: 0, v: 0, r: rIn }], material, x);
}
export function tube(rOut: number, wall: number, length: number, material: THREE.Material): THREE.Mesh {
  const m = ring(rOut, rOut - wall, length, material);
  m.userData.wall = wall; m.userData.bore = rOut - wall; m.userData.outerWall = 'pipe';
  return m;
}
export function orient<T extends THREE.Object3D>(o: T, axis: 'x' | 'y' | 'z', pos: [number, number, number] = [0, 0, 0]): T {
  if (axis === 'y') o.rotation.z = Math.PI / 2;
  if (axis === 'z') o.rotation.y = -Math.PI / 2;
  o.position.set(...pos); return o;
}
/** Subtraction cuts the actual shell, including the inner wall, at every nozzle. */
export function drill(key: string, body: THREE.Mesh, bores: Bore[]): THREE.Mesh {
  const geometry = cachedGeo(`drilled:${key}`, () => {
    body.updateMatrix();
    let result = CSG.fromMesh(body);
    for (const b of bores) {
      const tool = new THREE.Mesh(new THREE.CylinderGeometry(b.r, b.r, b.length, 32));
      if (b.axis === 'x') tool.rotation.z = Math.PI / 2;
      if (b.axis === 'z') tool.rotation.x = Math.PI / 2;
      tool.position.set(...b.pos); tool.updateMatrix();
      result = result.subtract(CSG.fromMesh(tool)); tool.geometry.dispose();
    }
    return cleanTriangles(CSG.toGeometry(result, new THREE.Matrix4()));
  });
  const out = new THREE.Mesh(geometry, body.material); out.castShadow = true; out.receiveShadow = true; out.userData.bores = bores; return out;
}
export function nozzle(r: number, wall: number, length: number, color: number): THREE.Group {
  const m = materialSet(color); const g = new THREE.Group();
  g.add(tube(r, wall, length, m.cast));
  const flange = disk(r * 1.65, 0.035, [{ u: 0, v: 0, r: r - wall }, ...circleHoles(4, r * 1.3, r * 0.13)], m.machined, length / 2 - 0.0175);
  flange.userData.boltHoles = 4; g.add(flange); return g;
}
/** Bolt and nut share the same centres as the real flange apertures. */
export function fasteners(holes: Hole[], length: number, shaftR: number, material: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  holes.forEach((h, index) => {
    const unit = new THREE.Group(); unit.name = `fastener-${index + 1}`;
    const shaft = new THREE.Mesh(cachedGeo(`shaft:${shaftR}:${length}`, () => { const a = new THREE.CylinderGeometry(shaftR, shaftR, length + 0.01 + 2 * shaftR, 16); a.rotateZ(Math.PI / 2); return a; }), material);
    shaft.position.x = shaftR * 0.5;
    const head = new THREE.Mesh(cachedGeo(`hex:${shaftR}`, () => { const a = new THREE.CylinderGeometry(shaftR * 1.75, shaftR * 1.75, shaftR * 1.3, 6); a.rotateZ(Math.PI / 2); return a; }), material);
    head.position.x = -length / 2 - 0.005 - shaftR * 0.65;
    const nutShape = new THREE.Shape();
    for (let k = 0; k < 6; k++) { const a = k * TAU / 6; const u = Math.cos(a) * shaftR * 1.75, v = Math.sin(a) * shaftR * 1.75; if (k === 0) nutShape.moveTo(u, v); else nutShape.lineTo(u, v); }
    nutShape.closePath(); nutShape.holes.push(pathHole({ u: 0, v: 0, r: shaftR * 1.03 }));
    const nut = mesh(plateGeometry(`nut:${shaftR}`, nutShape, shaftR * 1.3), material, length / 2 + 0.005 + shaftR * 0.65);
    unit.add(shaft, head, nut);
    for (const s of [-1, 1]) unit.add(ring(shaftR * 1.9, shaftR * 1.08, 0.005, material, s * (length / 2 + 0.0025)));
    unit.position.set(0, h.u, h.v); unit.userData.hole = h; unit.userData.shaftR = shaftR; g.add(unit);
  });
  return g;
}
/** Closed wall section of an elliptical head. Open at the large joining rim. */
export function head(radius: number, depth: number, wall: number, material: THREE.Material): THREE.Mesh {
  const geo = cachedGeo(`elliptic:${radius}:${depth}:${wall}`, () => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 24; i++) { const a = i * Math.PI / 48; pts.push(new THREE.Vector2(radius * Math.cos(a), depth * Math.sin(a))); }
    for (let i = 24; i >= 0; i--) { const a = i * Math.PI / 48; pts.push(new THREE.Vector2((radius - wall) * Math.cos(a), (depth - wall) * Math.sin(a))); }
    pts.push(pts[0].clone());
    const g = new THREE.LatheGeometry(pts, 48); g.rotateZ(-Math.PI / 2); return cleanTriangles(g);
  });
  return mesh(geo, material);
}
/** Plate with an alternating segmental cut and real tube/rod openings. */
export function segmentPlate(radius: number, cut: number, thickness: number, holes: Hole[], material: THREE.Material, sign: number): THREE.Mesh {
  const shape = new THREE.Shape(); const edge = Math.sqrt(radius * radius - cut * cut);
  shape.moveTo(sign * cut, -edge);
  const start = Math.atan2(-edge, cut), end = Math.atan2(edge, cut) - TAU;
  for (let i = 0; i <= 64; i++) { const a = start + (end - start) * i / 64; shape.lineTo(sign * radius * Math.cos(a), radius * Math.sin(a)); }
  shape.closePath();
  holes.filter(h => sign * h.u + h.r < cut).forEach(h => shape.holes.push(pathHole(h)));
  return mesh(plateGeometry(`segment:${radius}:${cut}:${thickness}:${sign}:${JSON.stringify(holes)}`, shape, thickness), material);
}
