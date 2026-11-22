import { hullVolume, transformVolume } from './meshCollision';
import { Matrix4, Quaternion, ShapeUtils, Vector2, Vector3 } from 'three';
import { boltDims, elbowR, flangeDims, GASKET_THICKNESS, nutThickness, odU, pipeLen, portsFor, reducerDims, teeDims, weldNeckRadius, type Spec } from './layout';
import { dnSpec } from './specs';
import { MM } from './types';
import { annularPrisms, convexPrism, type ConvexVolume } from './collisionSweep';
import { assemblyAssetById } from './expansion';

type SectionPoint = [number, number];
const cache = new Map<string, readonly ConvexVolume[]>();
const TAU = Math.PI * 2;
// 与 geometry.ts 中 hexGeo / cylX 变换后的局部截面一致。
const HEX_PHASE = -Math.PI / 2;
const SHANK_PHASE = Math.PI / 2;
const NUT_HOLE_SIDES = 24;

function circle(radius: number, count: number, center: SectionPoint = [0, 0], phase = 0): SectionPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = phase + TAU * i / count;
    return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
  });
}

function plate(xMin: number, xMax: number, contour: SectionPoint[], holes: SectionPoint[][]): ConvexVolume[] {
  const asVector = ([y, z]: SectionPoint) => new Vector2(y, z);
  const faces = ShapeUtils.triangulateShape(contour.map(asVector), holes.map(ring => ring.map(asVector)));
  const vertices = contour.concat(...holes);
  return faces.map(face => convexPrism(xMin, xMax, face.map(i => vertices[i])));
}

function flange(dn: number, face: number, direction: -1 | 1, blind = false): ConvexVolume[] {
  const { t, r, k, n, hole } = flangeDims(dn);
  const back = face - direction * t;
  const holes = Array.from({ length: n }, (_, i) => {
    const angle = TAU * i / n;
    return circle(hole, 24, [k * Math.cos(angle), k * Math.sin(angle)]);
  });
  if (!blind) holes.unshift(circle(odU(dn) / 2 + 0.015, 48));
  return plate(Math.min(face, back), Math.max(face, back), circle(r, 48), holes);
}


function oriented(volumes: ConvexVolume[], direction: Vector3, position: Vector3) {
  const matrix = new Matrix4().makeRotationFromQuaternion(
    new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), direction));
  matrix.setPosition(position);
  return volumes.map(volume => transformVolume(volume, matrix));
}

function portFlanges(partId: string, spec: Spec): ConvexVolume[] {
  return spec.endType !== 'flange' ? [] : portsFor(partId, spec).flatMap(port =>
    oriented(flange(port.dn, 0, 1), new Vector3(...port.dir), new Vector3(...port.pos)));
}

function reducingWall(start: number, end: number, inner: number, small: number, large: number): ConvexVolume[] {
  const sides = 28;
  const vertices = (x: number, radius: number, side: number) => {
    const angle = TAU * side / sides + SHANK_PHASE;
    return new Vector3(x, radius * Math.cos(angle), radius * Math.sin(angle));
  };
  return Array.from({length:sides}, (_, side) => hullVolume([[start, small], [end, large]].flatMap(([x, outer]) =>
    [side, side+1].flatMap(index => [vertices(x, inner, index), vertices(x, outer, index)]))));
}
function elbowVolumes(spec: Spec, degrees: 45 | 90): ConvexVolume[] {
  const bend = elbowR(spec.dn);
  const outer = odU(spec.dn) / 2;
  const inner = outer - dnSpec(spec.dn).wall * MM;
  const stations = 26;
  const sides = 18;
  const point = (station: number, side: number, radius: number) => {
    const turn = (degrees * station / stations - 90) * Math.PI / 180;
    const around = TAU * side / sides;
    const radial = bend + radius * Math.cos(around);
    return new Vector3(radial * Math.cos(turn), bend + radial * Math.sin(turn), radius * Math.sin(around));
  };
  const result: ConvexVolume[] = [];
  for (let station = 0; station < stations; station++) {
    for (let side = 0; side < sides; side++) {
      const vertices = [station, station + 1].flatMap(s => [side, side + 1]
        .flatMap(angle => [point(s, angle, inner), point(s, angle, outer)]));
      result.push(hullVolume(vertices));
    }
  }
  return result;
}

/** 从工坊现有毫米规格构造保留通孔的实体代理。尚未定义的几何由调用者处理。 */
export function partConvexVolumes(partId: string, spec: Spec): readonly ConvexVolume[] | null {
  const key = JSON.stringify([partId, spec.dn, spec.length, spec.endType, spec.smallDn]);
  const existing = cache.get(key);
  if (existing) return existing;

  let volumes: ConvexVolume[];
  switch (partId) {
    case 'elbow90':
    case 'elbow45':
      volumes = [...elbowVolumes(spec, partId === 'elbow90' ? 90 : 45), ...portFlanges(partId, spec)];
      break;
    case 'tee':
    case 'tee-reducing': {
      const { L, H } = teeDims(spec.dn);
      const r = odU(spec.dn) / 2;
      const branchDn = partId === 'tee' ? spec.dn : reducerDims(spec).small;
      const branch = odU(branchDn) / 2;
      volumes = [
        ...annularPrisms(-L/2, L/2, r - dnSpec(spec.dn).wall * MM, r, 28),
        ...oriented(annularPrisms(0, H, branch - dnSpec(branchDn).wall * MM, branch, 24), new Vector3(0,1,0), new Vector3()),
        ...portFlanges(partId, spec)
      ];
      break;
    }
    case 'pipe': {
      const half = pipeLen(spec) / 2;
      const radius = odU(spec.dn) / 2;
      volumes = annularPrisms(-half, half, radius - dnSpec(spec.dn).wall * MM, radius, 28);
      if (spec.endType === 'flange') {
        volumes.push(...flange(spec.dn, -half, -1), ...flange(spec.dn, half, 1));
      }
      break;
    }
    case 'flange-so':
    case 'flange-wn':
    case 'flange-blind': {
      const { t, hub } = flangeDims(spec.dn);
      volumes = flange(spec.dn, t / 2, 1, partId === 'flange-blind');
      if (partId !== 'flange-blind') {
        const pipeRadius = odU(spec.dn) / 2;

        const weldEnd = pipeRadius + 0.02;
        volumes.push(...reducingWall(-t / 2 - hub, -t / 2, pipeRadius - 0.01, weldEnd,
          partId === 'flange-wn' ? weldNeckRadius(spec.dn) : weldEnd));
      }
      break;
    }
    case 'gasket': {
      const { k, hole } = flangeDims(spec.dn);
      const half = GASKET_THICKNESS / 2;
      volumes = annularPrisms(-half, half, odU(spec.dn) / 2 - 0.02, k - hole - 0.03, 48);
      break;
    }
    case 'bolt': {
      const { head, len, r } = boltDims(spec.dn);
      volumes = [
        convexPrism(-head, 0, circle(r * 1.75, 6, [0, 0], HEX_PHASE)),
        convexPrism(0, len, circle(r, 14, [0, 0], SHANK_PHASE))
      ];
      break;
    }
    case 'nut': {
      const { r } = boltDims(spec.dn);
      const half = nutThickness(spec.dn) / 2;
      volumes = plate(-half, half, circle(r * 1.75, 6, [0, 0], HEX_PHASE), [circle(r * 0.92, NUT_HOLE_SIDES)]);
      break;
    }
    default: {
      const build = assemblyAssetById.get(partId)?.collisionVolumes;
      if (!build) return null;
      volumes = build(spec);
    }
  }
  cache.set(key, volumes);
  return volumes;
}

export function boltThreadStart(dn: number) {
  return boltDims(dn).len - 2 * nutThickness(dn);
}

/** 只用于已验证螺纹配合的接触区，保留头部和非螺纹杆的全部体积。 */
export function engagedBoltVolumes(dn: number): readonly ConvexVolume[] {
  const key = 'engaged-bolt:' + dn;
  const old = cache.get(key);
  if (old) return old;
  const { head, len, r } = boltDims(dn);
  const start = boltThreadStart(dn);
  const threadCore = r * 0.92 * Math.cos(Math.PI / NUT_HOLE_SIDES);
  const result = [
    convexPrism(-head, 0, circle(r * 1.75, 6, [0, 0], HEX_PHASE)),
    convexPrism(0, start, circle(r, 14, [0, 0], SHANK_PHASE)),
    convexPrism(start, len, circle(threadCore, 14, [0, 0], SHANK_PHASE))
  ];
  cache.set(key, result);
  return result;
}


