import * as THREE from 'three';
import { materialSet, box, cylY } from './industrial';
import { circleHoles, disk, drill, fasteners, head, nozzle, orient, ring, tube } from './processGeometry';

export const BAG_BOLTS = circleHoles(8, 0.315, 0.016);
export const BAG_SHELF_INNER = 0.220;
export const BAG_BASKET_OUTER = 0.219;
export const BAG_RIM_OUTER = 0.225;
export function bagFilterModelPart(id: string, color: number): THREE.Group {
  const g = new THREE.Group(), m = materialSet(color);
  switch (id) {
    case 'shell': {
      const body = orient(tube(0.27, 0.018, 0.9, m.cast), 'y');
      g.add(drill('bag-shell-v1', body, [
        { pos: [-0.27, -0.27, 0], axis: 'x', r: 0.065, length: 0.15 }
      ]));
      const bottom = head(0.27, 0.13, 0.018, m.cast);
      bottom.rotation.z = -Math.PI / 2; bottom.position.y = -0.45;
      g.add(drill('bag-bottom-v1', bottom, [{ pos: [0, -0.57, 0], axis: 'y', r: 0.035, length: 0.15 }]));
      const f = disk(0.35, 0.035, [{ u: 0, v: 0, r: 0.252 }, ...BAG_BOLTS], m.machined);
      orient(f, 'y', [0, 0.465, 0]); f.userData.boltHoles = 8; g.add(f);
      g.add(orient(ring(0.252, BAG_SHELF_INNER, 0.015, m.machined), 'y', [0, 0.3725, 0]));
      break;
    }
    case 'basket': {
      const top = orient(ring(0.225, 0.206, 0.025, m.machined), 'y', [0, 0.4125, 0]); g.add(top);
      for (let i = 0; i < 24; i++) {
        const a = i * Math.PI * 2 / 24;
        g.add(cylY(0.004, 0.77, m.machined, Math.cos(a) * 0.215, 0.015, Math.sin(a) * 0.215, 8));
      }
      for (let i = 0; i < 10; i++) {
        const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.004, 6, 48), m.machined);
        hoop.rotation.x = Math.PI / 2; hoop.position.y = -0.34 + i * 0.08; g.add(hoop);
      }
      const floor = orient(ring(0.215, 0.19, 0.015, m.machined), 'y', [0, -0.3775, 0]); g.add(floor);
      for (let i = -2; i <= 2; i++) g.add(box(0.012, 0.012, 2 * Math.sqrt(0.19 ** 2 - (i * 0.07) ** 2), m.machined, i * 0.07, -0.376, 0));
      break;
    }
    case 'bag': {
      const fabric = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
      g.add(orient(tube(0.205, 0.004, 0.789, fabric), 'y', [0, 0.0305, 0]));
      const bottom = orient(disk(0.205, 0.006, [], fabric), 'y', [0, -0.367, 0]); g.add(bottom);
      g.add(orient(ring(0.225, 0.201, 0.018, m.machined), 'y', [0, 0.434, 0]));
      break;
    }
    case 'seal':
      g.add(orient(disk(0.348, 0.008, [{ u: 0, v: 0, r: 0.252 }, ...BAG_BOLTS], m.rubber), 'y', [0, 0.0865, 0]));
      g.add(orient(ring(0.225, 0.205, 0.008, m.rubber), 'y', [0, 0.027, 0]));
      break;
    case 'cover': {
      const f = disk(0.35, 0.035, [{ u: 0, v: 0, r: 0.252 }, ...BAG_BOLTS], m.machined);
      orient(f, 'y', [0, 0.04, 0]); f.userData.boltHoles = 8; g.add(f);
      g.add(orient(ring(0.225, 0.205, 0.008, m.machined), 'y', [0, -0.033, 0]));
      // Four radial brackets connect the lower compression ring to the cover flange.
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        g.add(cylY(0.005, 0.0515, m.machined, Math.cos(a) * 0.215, -0.00325, Math.sin(a) * 0.215, 8));
        const arm = box(0.05, 0.008, 0.01, m.machined, Math.cos(a) * 0.237, 0.0185, Math.sin(a) * 0.237);
        arm.rotation.y = -a; g.add(arm);
      }

      const cap = head(0.27, 0.14, 0.018, m.cast);
      cap.rotation.z = Math.PI / 2; cap.position.y = 0.055;
      g.add(drill('bag-cover-top-v1', cap, [{ pos: [0, 0.19, 0], axis: 'y', r: 0.065, length: 0.15 }]));
      g.add(orient(nozzle(0.085, 0.02, 0.20, color), 'y', [0, 0.27, 0]));
      break;
    }
    case 'nozzles': {
      const out = nozzle(0.085, 0.02, 0.30, color); out.rotation.y = Math.PI; out.position.set(-0.39, 0.35, 0); g.add(out);
      const drain = orient(nozzle(0.05, 0.015, 0.15, color), 'y', [0, 0.025, 0]); drain.rotation.z = -Math.PI / 2; g.add(drain);
      break;
    }
    case 'coverBolts': g.add(orient(fasteners(BAG_BOLTS, 0.078, 0.012, m.machined), 'y')); break;
    default: throw new Error('袋式过滤器缺少几何：' + id);
  }
  return g;
}
