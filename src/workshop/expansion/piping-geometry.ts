import * as THREE from 'three';
import { dnSpec, flangeSpec } from '../specs';
import { MM } from '../types';
import type { PortDef } from '../types';
import type { Vec3 } from './contract';

type Material = THREE.MeshStandardMaterial;
export const X: Vec3 = [1, 0, 0];
export const Y: Vec3 = [0, 1, 0];
export const negativeX: Vec3 = [-1, 0, 0];
export const negativeY: Vec3 = [0, -1, 0];

export function outsideDiameter(dn: number): number {
  return dnSpec(dn).od * MM;
}

export function flangeFaceDimensions(dn: number) {
  const spec = flangeSpec(dn);
  return { t: spec.t * MM, r: spec.d * MM / 2, k: spec.k * MM / 2, n: spec.n, hole: spec.hole * MM / 2 };
}

export function flange(dn: number, pos: Vec3, dir: Vec3, id: string, label: string, flow: PortDef['flow'] = 'both'): PortDef {
  return { id, label, pos, dir, dn, type: 'flange', standard: 'PN16', boltCount: flangeFaceDimensions(dn).n, flow };
}

export function flangeMesh(group: THREE.Group, dn: number, face: Vec3, out: Vec3, material: Material) {
  const dimensions = flangeFaceDimensions(dn);
  const center = new THREE.Vector3(...face).addScaledVector(new THREE.Vector3(...out), -dimensions.t / 2);
  return roundPlate(group, dimensions.r, outsideDiameter(dn) * 0.43, dimensions.t, center.toArray(), out, material,
    { count: dimensions.n, pitch: dimensions.k, radius: dimensions.hole });
}

export function add(group: THREE.Group, geometry: THREE.BufferGeometry, material: Material, position: Vec3) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  group.add(mesh);
  return mesh;
}

export function box(group: THREE.Group, size: Vec3, position: Vec3, material: Material) {
  return add(group, new THREE.BoxGeometry(...size), material, position);
}

export function solid(group: THREE.Group, radius: number, height: number, position: Vec3, material: Material, axis: Vec3 = Y, segments = 32) {
  const mesh = add(group, new THREE.CylinderGeometry(radius, radius, height, segments), material, position);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(...Y), new THREE.Vector3(...axis));
  return mesh;
}

export function profile(group: THREE.Group, points: [number, number][], position: Vec3, axis: Vec3, material: Material) {
  const mesh = add(group, new THREE.LatheGeometry(points.map(([radius, distance]) => new THREE.Vector2(radius, distance)), 36), material, position);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(...Y), new THREE.Vector3(...axis));
  return mesh;
}

export function roundPlate(group: THREE.Group, outer: number, bore: number, thickness: number, position: Vec3, axis: Vec3, material: Material,
  bolts?: { count: number; pitch: number; radius: number }, edges = 0) {
  const shape = new THREE.Shape();
  if (edges) {
    for (let index = 0; index < edges; index++) {
      const angle = index * 2 * Math.PI / edges;
      const point: [number, number] = [outer * Math.cos(angle), outer * Math.sin(angle)];
      if (index === 0) shape.moveTo(...point);
      else shape.lineTo(...point);
    }
    shape.closePath();
  } else {
    shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  }
  function hole(x: number, y: number, radius: number) {
    const path = new THREE.Path();
    path.absarc(x, y, radius, 0, Math.PI * 2, true);
    shape.holes.push(path);
  }
  if (bore > 0) hole(0, 0, bore);
  if (bolts) {
    for (let index = 0; index < bolts.count; index++) {
      const angle = Math.PI / 2 + index * Math.PI * 2 / bolts.count;
      hole(bolts.pitch * Math.cos(angle), bolts.pitch * Math.sin(angle), bolts.radius);
    }
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, steps: 1, bevelEnabled: false, curveSegments: 24 });
  geometry.translate(0, 0, -thickness / 2);
  const mesh = add(group, geometry, material, position);
  mesh.rotation.y = Math.PI / 2;
  mesh.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...X), new THREE.Vector3(...axis)));
  return mesh;
}

export function curvedTube(group: THREE.Group, spine: THREE.Curve<THREE.Vector3>, outer: number, inner: number, material: Material) {
  // Inner wall normals face the bore. The two annular end faces close only the wall.
  const outside = new THREE.TubeGeometry(spine, 36, outer, 24, false);
  const inside = new THREE.TubeGeometry(spine, 36, inner, 24, false);
  const index = inside.getIndex()!;
  for (let triangle = 0; triangle < index.count; triangle += 3) {
    const second = index.getX(triangle + 1);
    index.setX(triangle + 1, index.getX(triangle + 2));
    index.setX(triangle + 2, second);
  }
  inside.computeVertexNormals();
  add(group, outside, material, [0, 0, 0]);
  add(group, inside, material, [0, 0, 0]);
  for (const end of [0, 1]) {
    const p = spine.getPoint(end);
    const tangent = spine.getTangent(end).normalize();
    roundPlate(group, outer, inner, 0.012, p.toArray(), tangent.toArray(), material);
  }
}
