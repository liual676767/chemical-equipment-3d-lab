import * as THREE from 'three';
import { buildPart } from '../src/engine/builders';
const body = buildPart('y-strainer', 'body', 0x5b7089);
body.updateMatrixWorld(true);
const ray = (origin: number[], dir: number[], far: number) => new THREE.Raycaster(new THREE.Vector3(...origin as [number,number,number]), new THREE.Vector3(...dir as [number,number,number]).normalize(), 0, far).intersectObject(body, true).length;
const check = (name: string, ok: boolean) => { if (!ok) throw Error(name); console.log('PASS', name); };
check('主管入口开放', ray([-0.4, 0, 0], [1, 0, 0], 0.20) === 0);
check('主管壁存在', ray([-0.2, 0, 0], [0, 0, 1], 0.2) > 0);
check('主管隔板阻断旁路', ray([-0.04, 0.07, 0], [1, 0, 0], 0.15) > 0);
check('隔板滤网入口开放', ray([-0.04, -0.04243, 0], [1, 0, 0], 0.15) === 0);
check('斜支管口开放', ray([0.32, -0.32, 0], [-1, 1, 0], 0.10) === 0);
const flanges: THREE.Object3D[] = []; body.traverse(o => { if (o.userData.boltHoles === 4) flanges.push(o); });
check('支管法兰四孔', flanges.length === 1);

check('支管下缘的旁路被隔板阻断', ray([-0.02, -0.15, 0], [1, 0, 0], 0.10) > 0);
check('套筒中心通道开放', ray([0.0424264, -0.0424264, 0], [1, -1, 0], 0.04) === 0);
check('套筒侧壁阻挡径向流动', ray([0.0424264, -0.0424264, 0.05], [0, 0, 1], 0.026) > 0);
import { yStrainer } from '../src/data/devices';
const part = (id: string) => { const p = yStrainer.parts.find(x => x.id === id)!; const g = buildPart('y-strainer', id, p.color); g.position.set(...p.pos); if (p.rot) g.rotation.set(...p.rot); g.updateMatrixWorld(true); return g; };
const actualBody = part('body'), cover = part('cover'), bolts = part('coverBolts');
const flange = actualBody.children.find(o => o.userData.boltHoles === 4)!;
const boltUnits: THREE.Object3D[] = [];
bolts.traverse(o => { if (o.userData.hole) boltUnits.push(o); });
check('四组紧固件独立', boltUnits.length === 4);
const axis = new THREE.Vector3(Math.SQRT1_2,-Math.SQRT1_2,0);
for (const [index, unit] of boltUnits.entries()) {
  const p = new THREE.Vector3(); unit.getWorldPosition(p);
  const intersects = (obj: THREE.Object3D, point: THREE.Vector3, far: number) => new THREE.Raycaster(point, axis, 0, far).intersectObject(obj, true).length;
  check(`紧固件${index+1}与两侧法兰孔同轴`, intersects(flange,p.clone().addScaledVector(axis,-0.12),0.24) === 0 && intersects(cover.children[0],p.clone().addScaledVector(axis,-0.12),0.24) === 0);
  const projection = (o: THREE.Object3D) => { const p = new THREE.Vector3(); o.getWorldPosition(p); return p.sub(new THREE.Vector3(0, 0.5, 0)).dot(axis); };
  const washerCenters = [projection(unit.children[3]), projection(unit.children[4])].sort((a,b) => a-b);
  check(`紧固件${index+1}垫圈贴合法兰夹持面`, Math.abs(washerCenters[0] + 0.0025 - 0.3475) < 0.00001 && Math.abs(washerCenters[1] - 0.0025 - 0.4125) < 0.00001);
  const shaft = unit.children[0] as THREE.Mesh, positions = shaft.geometry.getAttribute('position');
  let low = Infinity, high = -Infinity;
  for (let i=0; i<positions.count; i++) { const p = new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(shaft.matrixWorld).sub(new THREE.Vector3(0,0.5,0)).dot(axis); low=Math.min(low,p); high=Math.max(high,p); }
  check(`紧固件${index+1}螺杆贯穿两夹持面`, low < 0.3475 && high > 0.4125);
}
check('装配顺序', yStrainer.assemblyOrder.join(',') === 'screen,gasket,cover,coverBolts');
check('拆盖前需拆紧固件', yStrainer.parts.find(p=>p.id==='cover')!.removeAfter!.includes('coverBolts'));
