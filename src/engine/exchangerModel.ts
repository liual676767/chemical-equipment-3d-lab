import * as THREE from 'three';
import { box, cylX, materialSet } from './industrial';
import { circleHoles, disk, drill, fasteners, head, nozzle, orient, plateGeometry, ring, segmentPlate, tube, type Hole } from './processGeometry';

// Single-pass, fixed-tubesheet teaching layout. One array drives tubes and all tube holes.
export const HX_TUBES: Hole[] = [];
for (let row = -2; row <= 2; row++) for (let col = -2; col <= 2; col++) {
  const u = row * 0.11 * Math.sqrt(3) / 2, v = (col + row / 2) * 0.11;
  if (Math.hypot(u, v) < 0.225) HX_TUBES.push({ u, v, r: 0.032 });
}
export const HX_BOLTS = circleHoles(12, 0.445, 0.018);
const RODS = [{ u: -0.19, v: -0.25, r: 0.012 }, { u: -0.19, v: 0.25, r: 0.012 }, { u: 0.19, v: -0.25, r: 0.012 }, { u: 0.19, v: 0.25, r: 0.012 }];

export function exchangerModelPart(id: string, color: number): THREE.Group {
  const g = new THREE.Group(), m = materialSet(color);
  switch (id) {
    case 'shell': {
      g.add(drill('hx-shell-v1', tube(0.42, 0.024, 2.15, m.cast), [
        { pos: [-0.7, 0.42, 0], axis: 'y', r: 0.09, length: 0.2 },
        { pos: [0.7, -0.42, 0], axis: 'y', r: 0.09, length: 0.2 }
      ]));
      break;
    }
    case 'nozzles':
      for (const s of [-1, 1]) {
        const p = orient(nozzle(0.11, 0.02, 0.45, color), 'y', [-s * 0.7, s * 0.62, 0]);
        if (s < 0) p.rotation.z = -Math.PI / 2; g.add(p);
      }
      break;
    case 'tubes': {
      const base = tube(0.032, 0.006, 2.34, m.copper);
      const inst = new THREE.InstancedMesh(base.geometry, m.copper, HX_TUBES.length);
      inst.name = 'tubes-instanced';
      inst.castShadow = true;
      inst.receiveShadow = true;
      const dummy = new THREE.Object3D();
      HX_TUBES.forEach((h, i) => {
        dummy.position.set(0, h.u, h.v);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      g.add(inst);
      g.userData.tubeCount = HX_TUBES.length;
      g.userData.instanced = true;
      break;
    }
    case 'tubesheetF': case 'tubesheetR': {
      const p = disk(0.485, 0.09, [...HX_TUBES, ...HX_BOLTS], m.machined); p.userData.boltHoles = 12; g.add(p); break;
    }
    case 'baffles': {
      const baffleHoles = [...HX_TUBES.map((h) => ({ ...h, r: 0.034 })), ...RODS];
      const xs = [-0.66, -0.22, 0.22, 0.66];
      const dummy = new THREE.Object3D();
      for (const sign of [1, -1]) {
        const base = segmentPlate(0.392, 0.245, 0.022, baffleHoles, m.machined, sign);
        const groupX = xs.filter((_, i) => (i % 2 ? -1 : 1) === sign);
        const inst = new THREE.InstancedMesh(base.geometry, m.machined, groupX.length);
        inst.name = `baffles-instanced-${sign > 0 ? 'a' : 'b'}`;
        inst.castShadow = true;
        inst.receiveShadow = true;
        groupX.forEach((x, i) => {
          dummy.position.set(x, 0, 0);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix);
        });
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        g.add(inst);
      }
      g.userData.baffleCount = 4;
      g.userData.instanced = true;
      break;
    }
    case 'tieRods': {
      const dummy = new THREE.Object3D();
      const rodBase = cylX(0.01, 2.15, m.machined);
      const rodInst = new THREE.InstancedMesh(rodBase.geometry, m.machined, RODS.length);
      rodInst.name = 'tie-rods-instanced';
      rodInst.castShadow = true;
      rodInst.receiveShadow = true;
      RODS.forEach((h, i) => {
        dummy.position.set(0, h.u, h.v);
        dummy.rotation.set(0, 0, Math.PI / 2);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        rodInst.setMatrixAt(i, dummy.matrix);
      });
      rodInst.instanceMatrix.needsUpdate = true;
      rodInst.computeBoundingSphere();
      g.add(rodInst);
      const spacerBase = tube(0.018, 0.006, 0.41, m.machined);
      const spacerInst = new THREE.InstancedMesh(spacerBase.geometry, m.machined, RODS.length * 5);
      spacerInst.name = 'tie-spacers-instanced';
      spacerInst.castShadow = true;
      spacerInst.receiveShadow = true;
      let idx = 0;
      for (const h of RODS) {
        for (const x of [-0.86, -0.44, 0, 0.44, 0.86]) {
          dummy.position.set(x, h.u, h.v);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          spacerInst.setMatrixAt(idx++, dummy.matrix);
        }
      }
      spacerInst.instanceMatrix.needsUpdate = true;
      spacerInst.computeBoundingSphere();
      g.add(spacerInst);
      g.userData.rodCount = RODS.length;
      g.userData.spacerCount = RODS.length * 5;
      g.userData.instanced = true;
      break;
    }
    case 'channel': {
      const body = tube(0.42, 0.024, 0.35, m.cast); body.position.x = 0.075;
      g.add(drill('hx-channel-v2', body, [{ pos: [0.04, 0.42, 0], axis: 'y', r: 0.09, length: 0.2 }]));
      const dome = head(0.42, 0.2, 0.024, m.cast); dome.rotation.y = Math.PI; dome.position.x = -0.1; g.add(dome);
      const face = disk(0.485, 0.05, [{ u: 0, v: 0, r: 0.396 }, ...HX_BOLTS], m.machined, 0.225); face.userData.boltHoles = 12; g.add(face);
      g.add(orient(nozzle(0.11, 0.02, 0.4, color), 'y', [0.04, 0.60, 0])); break;
    }
    case 'rearhead': {
      const body = tube(0.42, 0.024, 0.24, m.cast); body.position.x = -0.075;
      g.add(drill('hx-rear-v1', body, [{ pos: [-0.07, -0.42, 0], axis: 'y', r: 0.09, length: 0.2 }]));
      const dome = head(0.42, 0.2, 0.024, m.cast); dome.position.x = 0.045; g.add(dome);
      const out = orient(nozzle(0.11, 0.02, 0.4, color), 'y', [-0.07, -0.60, 0]); out.rotation.z = -Math.PI / 2; g.add(out); break;
    }
    case 'channelGasket': g.add(ring(0.418, 0.396, 0.005, m.rubber)); break;
    case 'channelBolts': g.add(fasteners(HX_BOLTS, 0.145, 0.014, m.machined)); break;
    case 'saddles':
      for (const x of [-0.7, 0.7]) {
        const plate = new THREE.Shape(); plate.moveTo(-0.15, -0.45); plate.lineTo(0.15, -0.45); plate.lineTo(0.15, 0.45); plate.lineTo(-0.15, 0.45); plate.closePath();
        for (const z of [-0.34, 0.34]) {
          const h = new THREE.Path();
          if (x > 0) { h.absarc(-0.025, z, 0.022, Math.PI / 2, Math.PI * 1.5, false); h.absarc(0.025, z, 0.022, -Math.PI / 2, Math.PI / 2, false); h.closePath(); }
          else h.absarc(0, z, 0.022, 0, Math.PI * 2, true);
          plate.holes.push(h);
        }
        const geo = new THREE.ExtrudeGeometry(plate, { depth: 0.04, bevelEnabled: false, curveSegments: 16 }); geo.rotateX(Math.PI / 2);
        const foot = new THREE.Mesh(geo, m.machined); foot.position.set(x, -0.20, 0); g.add(foot);
        g.add(box(0.12, 0.38, 0.08, m.cast, x, 0.01, -0.32), box(0.12, 0.38, 0.08, m.cast, x, 0.01, 0.32));
        const shape = new THREE.Shape();
        for (let i = 0; i <= 32; i++) { const a = Math.PI * 0.65 + i * Math.PI * 0.7 / 32; const u = Math.cos(a) * 0.444, v = Math.sin(a) * 0.444; if (!i) shape.moveTo(u, v); else shape.lineTo(u, v); }
        for (let i = 32; i >= 0; i--) { const a = Math.PI * 0.65 + i * Math.PI * 0.7 / 32; shape.lineTo(Math.cos(a) * 0.42, Math.sin(a) * 0.42); } shape.closePath();
        const cradle = new THREE.Mesh(plateGeometry('hx-cradle', shape, 0.14), m.cast); cradle.position.set(x, 0.62, 0); g.add(cradle);
        g.add(box(0.16, 0.06, 0.64, m.cast, x, 0.20, 0));
      } break;
    default: throw new Error(`换热器缺少几何: ${id}`);
  }
  return g;
}
