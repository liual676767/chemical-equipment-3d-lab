import * as THREE from 'three';
import { box, cylX, flangeHolesX, hollowCylX, materialSet } from './industrial';
import { drill, ring } from './processGeometry';

const PORTS = [-0.28, 0.28].flatMap(y => [-0.16, 0.16].map(z => ({y,z})));
const BOLTS = [-0.39, 0.39].flatMap(y => [-0.27, 0.27].map(z => ({y,z})));
const plateX = (i: number) => -0.662 + i * 0.022;
export function plateExchangerModelPart(id: string, color: number): THREE.Group {
  const g = new THREE.Group(), m = materialSet(color);
  const block = (w: number,h: number,d: number, holes: {y:number;z:number;r:number}[]) => {
    const body = box(w,h,d,m.castDouble);
    return drill(`phe-${w}-${h}-${d}-${JSON.stringify(holes)}`,body,holes.map(p=>({pos:[0,p.y,p.z],axis:'x' as const,r:p.r,length:w+0.04})));
  };
  const guides = (x: number, target: THREE.Group, mat: THREE.Material) => {
    for (const y of [-0.43,0.43]) { target.add(box(0.016, 0.03, 0.06, mat, x, Math.sign(y) * 0.38)); const ear = ring(0.055,0.033,0.016,mat,x); ear.position.y=y; target.add(ear); }
  };
  switch(id) {
    case 'fixedPlate': {
      g.add(block(0.1,0.95,0.62,[...PORTS.map(p=>({...p,r:0.045})),...BOLTS.map(p=>({...p,r:0.025}))]));
      g.add(box(0.24,0.08,0.7,m.dark,0,-0.52));
      for (const p of PORTS) {
        g.add(hollowCylX(0.055,0.01,0.14,m.castDouble,m.machinedIn,m.cut,-0.12,p.y,p.z));
        const f=flangeHolesX(0.09,0.025,0.009,4,0.071,m.cast,-0.19,0.045); f.position.y=p.y; f.position.z=p.z; g.add(f);
      }
      break;
    }
    case 'guideBars': for(const y of [-0.43,0.43]) g.add(cylX(0.03,1.72,m.machined,0.14,y)); break;
    case 'plates': for(let i=0;i<12;i++) {
      const p=new THREE.Group(); p.position.x=plateX(i); p.userData.plateIdx=i; p.userData.baseX=p.position.x;
      p.add(block(0.016,0.72,0.46,PORTS.map(q=>({...q,r:0.045})))); guides(0,p,m.machined); g.add(p);
    } break;
    case 'gaskets': for(let i=0;i<12;i++) {
      const p=new THREE.Group(); p.position.x=plateX(i)+0.011; p.userData.plateIdx=i; p.userData.baseX=p.position.x;
      for(const z of [-0.215,0.215]) p.add(box(0.006,0.68,0.012,m.rubber,0,0,z));
      for(const y of [-0.334,0.334]) p.add(box(0.006,0.012,0.43,m.rubber,0,y));
      // One pair is isolated by closed rings; the opposite pair opens into this gap.
      const closedZ = i % 2 === 0 ? 0.16 : -0.16;
      for (const y of [-0.28, 0.28]) {
        const seal = ring(0.052, 0.045, 0.006, m.rubber);
        seal.position.set(0,y,closedZ); p.add(seal);
      }
      p.userData.closedZ = closedZ;

      g.add(p);
    } break;
    case 'movablePlate': {
      g.add(block(0.09,0.95,0.62,[...BOLTS.map(p=>({...p,r:0.025})), ...[-0.43,0.43].map(y=>({y,z:0,r:0.033}))]));
      guides(0,g,m.machined); break;
    }
    case 'bolts': for(const p of BOLTS) {
      const unit = new THREE.Group(); unit.position.set(0,p.y,p.z);
      const shaft = cylX(0.02,0.55,m.machined,-0.54); shaft.userData.kind='shaft'; shaft.userData.baseX=shaft.position.x; unit.add(shaft);
      for(const side of [-1,1]) {
        const washer=ring(0.04,0.0205,0.005,m.machined,side<0?-0.7725:-0.3135);
        washer.userData.baseX=washer.position.x; washer.userData.kind='fastener'; washer.userData.side=side; unit.add(washer);
        const nut=ring(0.038,0.0205,0.035,m.machined,side<0?-0.7925:-0.2935);
        nut.userData.baseX=nut.position.x; nut.userData.kind='fastener'; nut.userData.side=side; unit.add(nut);
      }
      g.add(unit);
    } break;
    default: throw new Error('板式换热器缺少几何: '+id);
  }
  return g;
}

/** Closed hanging eyes clear the guide end before moving toward the tray. */
export function plateExchangerPracticeWaypoint(id: string, target: THREE.Vector3): THREE.Vector3 | null {
  if (!['plates','gaskets','movablePlate'].includes(id)) return null;
  if (id === 'gaskets') return new THREE.Vector3(target.x, target.y, 0.8);
  return new THREE.Vector3(id === 'movablePlate' ? 1.06 : 1.75, target.y, target.z);
}

/** Removal progress: loosen nuts, extract shafts along X, then translate the whole group. */
export function plateExchangerBoltPracticePose(group: THREE.Object3D, progress: number) {
  const fastener = Math.max(0, Math.min(progress * 3, 1));
  const shaft = Math.max(0, Math.min((progress - 1/3) * 3, 1));
  group.traverse(o => {
    if (o.userData.kind === 'fastener') o.position.x = o.userData.baseX + (o.userData.side < 0 ? -0.16 : 0.8) * fastener;
    if (o.userData.kind === 'shaft') o.position.x = o.userData.baseX + 1.2 * shaft;
  });
  return Math.max(0, Math.min((progress - 2/3) * 3, 1));
}
