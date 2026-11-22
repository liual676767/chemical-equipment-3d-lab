import * as THREE from 'three';
import {
  materialSet, mesh, cylX, cylY, box, torus, cachedGeo,
  hollowCylX, hollowCylY, flangeHolesX, flangeHolesY, thickRing,
  boltSetX, boltSetY, weldRing, sphereWithBore
} from './industrial';

/** 四种阀门的工业级教学示意重建（第五轮批次 A）。流道沿 X，阀杆沿 Y。 */

export function ballValvePart(id: string, color: number): THREE.Group {
  const g = new THREE.Group();
  const M = materialSet(color);
  switch (id) {
    case 'body': {
      // 承压壳体：中空流道 + 球形腔（真实开口）+ 带孔法兰 + 阀杆颈部
      g.add(hollowCylX(0.14, 0.05, 0.44, M.cast, M.machinedIn, M.cut, 0));
      g.add(sphereWithBore(0.17, 0.09, 'x', M.castDouble, M.machinedIn));
      g.add(flangeHolesX(0.22, 0.045, 0.018, 4, 0.16, M.cast, -0.245, 0.09));
      g.add(flangeHolesX(0.22, 0.045, 0.018, 4, 0.16, M.cast, 0.245, 0.09));
      g.add(hollowCylY(0.075, 0.02, 0.16, M.cast, M.machinedIn, M.cut, 0, 0.19));
      g.add(flangeHolesY(0.115, 0.03, 0.012, 4, 0.085, M.cast, 0.265, 0.045));
      g.add(weldRing(0.145, M.dark, -0.21, 'x'));
      g.add(weldRing(0.145, M.dark, 0.21, 'x'));
      g.add(box(0.1, 0.04, 0.09, M.cast, 0, -0.17, 0));
      break;
    }
    case 'seats': {
      g.add(thickRing(0.045, 0.082, 0.02, M.machined, -0.095));
      g.add(thickRing(0.045, 0.082, 0.02, M.machined, 0.095));
      break;
    }
    case 'ball': {
      // 球体真实通孔：球面区域 + 内孔壁
      g.add(sphereWithBore(0.1, 0.045, 'x', M.machined, M.machinedIn));
      g.add(box(0.05, 0.03, 0.03, M.dark, 0, 0.09, 0));
      break;
    }
    case 'stem': {
      g.add(box(0.05, 0.055, 0.05, M.machined, 0, -0.1, 0));
      g.add(cylY(0.022, 0.2, M.machined, 0, 0, 0, 20));
      g.add(box(0.034, 0.03, 0.034, M.machined, 0, 0.105, 0));
      break;
    }
    case 'seals': {
      for (const sx of [-0.095, 0.095]) {
        const seatSeal = torus(0.052, 0.008, M.rubber, sx, 0, 0, Math.PI * 2, 6, 32);
        seatSeal.rotation.y = Math.PI / 2;
        g.add(seatSeal);
      }
      for (const sy of [-0.03, 0.005]) {
        const o = torus(0.03, 0.006, M.rubber, 0, sy, 0, Math.PI * 2, 6, 28);
        o.rotation.x = Math.PI / 2;
        g.add(o);
      }
      break;
    }
    case 'packing': {
      for (const y of [-0.05, -0.02, 0.01]) {
        const r = torus(0.036, 0.008, M.rubber, 0, y, 0, Math.PI * 2, 6, 28);
        r.rotation.x = Math.PI / 2;
        g.add(r);
      }
      break;
    }
    case 'bonnet': {
      g.add(hollowCylY(0.075, 0.02, 0.08, M.cast, M.machinedIn, M.cut, 0, 0.02));
      g.add(flangeHolesY(0.115, 0.028, 0.012, 4, 0.085, M.cast, -0.02, 0.045));
      g.add(flangeHolesY(0.07, 0.02, 0.01, 4, 0.05, M.cast, 0.07, 0.036));
      break;
    }
    case 'bolts': {
      g.add(boltSetY(4, 0.085, 0.009, 0.07, 0.02, M.machined, M.dark));
      g.add(boltSetY(4, 0.05, 0.007, 0.04, 0.09, M.machined, M.dark));
      break;
    }
    case 'handle': {
      g.add(cylY(0.04, 0.03, M.cast, 0, -0.01, 0, 20));
      g.add(box(0.26, 0.018, 0.05, M.cast, 0.1, 0, 0));
      g.add(cylY(0.012, 0.024, M.dark, 0, 0.03, 0, 12));
      break;
    }
  }
  return g;
}

export function gateValvePart(id: string, color: number): THREE.Group {
  const g = new THREE.Group();
  const M = materialSet(color);
  switch (id) {
    case 'body': {
      g.add(hollowCylX(0.15, 0.05, 0.5, M.cast, M.machinedIn, M.cut, 0));
      g.add(hollowCylX(0.17, 0.07, 0.18, M.cast, M.machinedIn, M.cut, 0));
      g.add(flangeHolesX(0.23, 0.045, 0.018, 4, 0.17, M.cast, -0.275, 0.1));
      g.add(flangeHolesX(0.23, 0.045, 0.018, 4, 0.17, M.cast, 0.275, 0.1));
      g.add(hollowCylY(0.09, 0.025, 0.14, M.cast, M.machinedIn, M.cut, 0, 0.2));
      g.add(flangeHolesY(0.13, 0.03, 0.012, 4, 0.1, M.cast, 0.27, 0.05));
      g.add(box(0.14, 0.05, 0.1, M.cast, 0, -0.2, 0));
      break;
    }
    case 'seat': {
      for (const sx of [-0.055, 0.055]) {
        g.add(thickRing(0.05, 0.082, 0.02, M.machined, sx));
      }
      break;
    }
    case 'gate': {
      // 楔式闸板：梯形楔块 + 密封面
      const shape = new THREE.Shape();
      shape.moveTo(-0.09, -0.11);
      shape.lineTo(0.09, -0.11);
      shape.lineTo(0.12, 0.1);
      shape.lineTo(-0.12, 0.1);
      shape.closePath();
      const geo = cachedGeo('wedgeGate', () => {
        const gg = new THREE.ExtrudeGeometry(shape, { depth: 0.045, bevelEnabled: false });
        gg.translate(0, 0, -0.0225);
        return gg;
      });
      g.add(mesh(geo, M.machined));
      g.add(box(0.045, 0.045, 0.05, M.machined, 0, 0.115, 0));
      for (const s of [-1, 1]) {
        const face = box(0.02, 0.16, 0.05, M.cut, s * 0.092, -0.01, 0);
        face.rotation.z = s * 0.06;
        g.add(face);
      }
      break;
    }
    case 'stem': {
      g.add(cylY(0.02, 0.56, M.machined, 0, 0, 0, 20));
      for (let i = 0; i < 12; i++) {
        const t = torus(0.021, 0.0028, M.machined, 0, -0.13 + i * 0.022, 0, Math.PI * 2, 6, 20);
        t.rotation.x = Math.PI / 2;
        g.add(t);
      }
      g.add(box(0.036, 0.035, 0.036, M.machined, 0, 0.28, 0));
      break;
    }
    case 'packing': {
      for (const y of [-0.04, -0.01, 0.02]) {
        const r = torus(0.04, 0.008, M.rubber, 0, y, 0, Math.PI * 2, 6, 28);
        r.rotation.x = Math.PI / 2;
        g.add(r);
      }
      g.add(cylY(0.048, 0.016, M.cast, 0, 0.045, 0, 20));
      break;
    }
    case 'bonnet': {
      g.add(hollowCylY(0.085, 0.022, 0.11, M.cast, M.machinedIn, M.cut, 0, 0.03));
      g.add(flangeHolesY(0.13, 0.03, 0.012, 4, 0.1, M.cast, -0.03, 0.05));
      g.add(flangeHolesY(0.075, 0.02, 0.009, 4, 0.055, M.cast, 0.09, 0.04));
      break;
    }
    case 'bolts': {
      g.add(boltSetY(4, 0.1, 0.01, 0.08, 0, M.machined, M.dark));
      g.add(boltSetY(4, 0.055, 0.008, 0.05, 0.1, M.machined, M.dark));
      break;
    }
    case 'handwheel': {
      const rim = torus(0.14, 0.016, M.cast, 0, 0, 0, Math.PI * 2, 10, 40);
      rim.rotation.x = Math.PI / 2;
      g.add(rim);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const sp = box(0.13, 0.012, 0.028, M.cast, Math.cos(a) * 0.07, 0, Math.sin(a) * 0.07);
        sp.rotation.y = -a;
        g.add(sp);
      }
      g.add(cylY(0.03, 0.05, M.cast, 0, 0, 0, 20));
      break;
    }
  }
  return g;
}

export function butterflyPart(id: string, color: number): THREE.Group {
  const g = new THREE.Group();
  const M = materialSet(color);
  switch (id) {
    case 'body': {
      g.add(hollowCylX(0.175, 0.03, 0.11, M.cast, M.machinedIn, M.cut, 0));
      g.add(flangeHolesX(0.235, 0.035, 0.014, 8, 0.19, M.cast, -0.07, 0.145));
      g.add(flangeHolesX(0.235, 0.035, 0.014, 8, 0.19, M.cast, 0.07, 0.145));
      g.add(cylY(0.045, 0.1, M.cast, 0, 0.15, 0, 20));
      g.add(cylY(0.045, 0.1, M.cast, 0, -0.15, 0, 20));
      break;
    }
    case 'seat': {
      g.add(hollowCylX(0.14, 0.022, 0.11, M.rubber, M.rubber, M.rubber, 0));
      break;
    }
    case 'disc': {
      const plate = cylX(0.115, 0.02, M.machined, 0, 0, 0, 40);
      g.add(plate);
      g.add(cylY(0.024, 0.16, M.machined, 0, 0, 0, 20));
      for (const s of [-1, 1]) {
        const seal = cylX(0.112, 0.004, M.rubber, s * 0.012, 0, 0, 40);
        g.add(seal);
      }
      break;
    }
    case 'shaft': {
      g.add(cylY(0.02, 0.4, M.machined, 0, 0, 0, 20));
      g.add(box(0.03, 0.03, 0.03, M.machined, 0, 0.2, 0));
      g.add(cylY(0.028, 0.06, M.cast, 0, 0.16, 0, 20));
      break;
    }
    case 'handle': {
      g.add(cylY(0.035, 0.04, M.cast, 0, -0.01, 0, 20));
      g.add(box(0.22, 0.018, 0.04, M.cast, 0.1, 0.01, 0));
      g.add(cylY(0.01, 0.03, M.dark, 0, 0.04, 0, 12));
      break;
    }
    case 'bolts': {
      g.add(boltSetX(6, 0.19, 0.009, 0.24, 0, M.machined, M.dark));
      break;
    }
  }
  return g;
}

export function checkValvePart(id: string, color: number): THREE.Group {
  const g = new THREE.Group();
  const M = materialSet(color);
  switch (id) {
    case 'body': {
      g.add(hollowCylX(0.15, 0.05, 0.5, M.cast, M.machinedIn, M.cut, 0));
      g.add(flangeHolesX(0.21, 0.045, 0.016, 4, 0.155, M.cast, -0.285, 0.09));
      g.add(flangeHolesX(0.21, 0.045, 0.016, 4, 0.155, M.cast, 0.285, 0.09));
      g.add(hollowCylY(0.1, 0.025, 0.16, M.cast, M.machinedIn, M.cut, 0, 0.16));
      g.add(flangeHolesY(0.13, 0.03, 0.012, 4, 0.1, M.cast, 0.24, 0.055));
      g.add(weldRing(0.13, M.dark, -0.25, 'x'));
      g.add(weldRing(0.13, M.dark, 0.25, 'x'));
      break;
    }
    case 'seat': {
      const seat = thickRing(0.045, 0.085, 0.02, M.machined, 0);
      seat.rotation.z = 0.16;
      g.add(seat);
      break;
    }
    case 'hinge': {
      g.add(cylX(0.012, 0.13, M.machined, 0, 0.06, 0, 16));
      g.add(box(0.03, 0.1, 0.03, M.machined, 0.0, 0.01, 0));
      g.add(box(0.02, 0.02, 0.1, M.cast, 0, 0.075, 0));
      break;
    }
    case 'disc': {
      const plate = cylX(0.085, 0.014, M.machined, 0, -0.05, 0, 32);
      plate.rotation.z = 0.16;
      g.add(plate);
      const face = cylX(0.08, 0.004, M.rubber, -0.01, -0.05, 0, 32);
      face.rotation.z = 0.16;
      g.add(face);
      g.add(box(0.02, 0.05, 0.02, M.machined, 0, 0.03, 0));
      break;
    }
    case 'gasket': {
      const ring = torus(0.098, 0.006, M.rubber, 0, 0, 0, Math.PI * 2, 6, 32);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      break;
    }
    case 'cover': {
      g.add(flangeHolesY(0.13, 0.03, 0.012, 4, 0.1, M.cast, 0, 0.06));
      const cap = mesh(cachedGeo('cvCap', () => new THREE.SphereGeometry(0.12, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2)), M.cast);
      cap.rotation.z = 0;
      g.add(cap);
      g.add(cylY(0.03, 0.04, M.cast, 0, 0.12, 0, 16));
      break;
    }
    case 'bolts': {
      g.add(boltSetY(4, 0.1, 0.009, 0.06, 0, M.machined, M.dark));
      break;
    }
  }
  return g;
}
