import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { BoxGeometry, ExtrudeGeometry, LatheGeometry, ShapeUtils, Matrix3, Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three';
import { convexPrism, type ConvexVolume } from './collisionSweep';

const xAxis = new Vector3(1, 0, 0);

export function transformVolume(volume: ConvexVolume, matrix: Matrix4): ConvexVolume {
  const normalMatrix = new Matrix3().getNormalMatrix(matrix);
  const points = volume.points.map(point => point.applyMatrix4(matrix));
  return {
    points,
    faceAxes: volume.faceAxes.map(axis => axis.applyNormalMatrix(normalMatrix)),
    edgeAxes: volume.edgeAxes.map(axis => axis.transformDirection(matrix)),
    radius: Math.max(...points.map(point => point.length()))
  };
}

/** Preserve the holes and the rotated faces present in the actual rendered geometry. */
export function meshPrisms(geometry: BufferGeometry, matrix: Matrix4): ConvexVolume[] | null {
  if (geometry instanceof BoxGeometry) {
    geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox!;
    return [transformVolume(convexPrism(min.x, max.x, [[min.y, min.z], [max.y, min.z], [max.y, max.z], [min.y, max.z]]), matrix)];
  }
  if (geometry instanceof LatheGeometry) {
    const { points: section, segments } = geometry.parameters;
    if (section.length < 4 || !section[0].equals(section[section.length - 1])) return null;
    const triangles = ShapeUtils.triangulateShape(section.slice(0, -1), []);
    const positions = geometry.getAttribute('position');
    const result: ConvexVolume[] = [];
    for (let ring = 0; ring < segments; ring++) {
      for (const triangle of triangles) {
        const vertices = [ring, ring + 1].flatMap(station => triangle.map(index =>
          new Vector3().fromBufferAttribute(positions, station * section.length + index).applyMatrix4(matrix)));
        result.push(hullVolume(vertices));
      }
    }
    return result;
  }
  if (!(geometry instanceof ExtrudeGeometry) || geometry.index) return null;
  const { options } = geometry.parameters;
  if (options.bevelEnabled !== false || options.extrudePath || (options.steps ?? 1) !== 1) return null;
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const cap = geometry.groups.find(group => group.materialIndex === 0);
  if (!cap || cap.count < 6) return null;

  const extrusion = new Vector3().fromBufferAttribute(normals, cap.start).normalize().negate();
  const orientation = new Quaternion().setFromUnitVectors(xAxis, extrusion);
  const inverse = orientation.clone().invert();
  const projected = new Vector3();
  const axis = new Vector3();
  const transformed = new Matrix4().makeRotationFromQuaternion(orientation).premultiply(matrix);
  const prisms: ConvexVolume[] = [];
  const end = cap.start + cap.count;
  for (let index = cap.start; index < end; index += 3) {
    if (axis.fromBufferAttribute(normals, index).dot(extrusion) >= 0) continue;
    const section: [number, number][] = [];
    let start = 0;
    for (let vertex = index; vertex < index + 3; vertex++) {
      projected.fromBufferAttribute(positions, vertex).applyQuaternion(inverse);
      start += projected.x / 3;
      section.push([projected.y, projected.z]);
    }
    prisms.push(transformVolume(convexPrism(start, start + (options.depth ?? 1), section), transformed));
  }
  return prisms.length ? prisms : null;
}

export function hullVolume(points: Vector3[]): ConvexVolume {
  const hull = new ConvexHull().setFromPoints(points);
  const edgeAxes: Vector3[] = [];
  for (const face of hull.faces) {
    let edge = face.edge;
    do {
      if (Math.abs(face.normal.dot(edge.twin.face.normal)) < 1 - 1e-10) {
        const direction = edge.head().point.clone().sub(edge.tail().point).normalize();
        if (!edgeAxes.some(axis => Math.abs(axis.dot(direction)) > 1 - 1e-10)) edgeAxes.push(direction);
      }
      edge = edge.next;
    } while (edge !== face.edge);
  }
  return { points, edgeAxes, faceAxes: hull.faces.map(face => face.normal), radius: Math.max(...points.map(point => point.length())) };
}

type Section = [number, number][];

function clip(section: Section, normalY: number, normalZ: number, threshold = 0): Section {
  const result: Section = [];
  for (const [index, point] of section.entries()) {
    const next = section[(index + 1) % section.length];
    const distance = normalY * point[0] + normalZ * point[1] - threshold;
    const nextDistance = normalY * next[0] + normalZ * next[1] - threshold;
    if (distance >= 0) result.push(point);
    if ((distance < 0) !== (nextDistance < 0)) {
      const t = distance / (distance - nextDistance);
      result.push([point[0] + (next[0] - point[0]) * t, point[1] + (next[1] - point[1]) * t]);
    }
  }
  return result;
}

/** Enclose the external mesh without filling a known coaxial opening. */
function prismOutsideBore(geometry: BufferGeometry, world: Matrix4, ranges: readonly [number, number, number][], outerRadius?: number) {
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox!;
  const outline: Section = [[min.y,min.z],[max.y,min.z],[max.y,max.z],[min.y,max.z]];
  const sides = 40;
  const delta = 2 * Math.PI / sides;
  return ranges.flatMap(([left,right,bore]) => {
    const start = Math.max(left, min.x), end = Math.min(right, max.x);
    if (start >= end) return [];
    return Array.from({length:sides}, (_,i) => {
      const a = i * delta, b = a + delta, mid = (a + b) / 2;
      const sector = clip(clip(outline, -Math.sin(a), Math.cos(a)), Math.sin(b), -Math.cos(b));
      const wall = clip(sector, Math.cos(mid), Math.sin(mid), bore * Math.cos(delta / 2));
      const material = outerRadius === undefined ? wall : clip(wall, -Math.cos(mid), -Math.sin(mid), -outerRadius);
      return material.length < 3 ? [] : [transformVolume(convexPrism(start,end,material),world)];
    }).flat();
  });
}

export function axialClearancePrisms(geometry: BufferGeometry, world: Matrix4, bore: number, outerRadius?: number) {
  return prismOutsideBore(geometry, world, [[-Infinity, Infinity, bore]], outerRadius);
}

export function volutePrisms(geometry: BufferGeometry, world: Matrix4) {
  return prismOutsideBore(geometry, world, [[-Infinity,-0.156,0.16],[-0.156,Infinity,0.422]]);
}


