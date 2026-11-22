import * as THREE from 'three';
import { plateExchangerModelPart, plateExchangerPracticeWaypoint, plateExchangerBoltPracticePose } from '../src/engine/plateExchangerModel';
import { PrincipleAnim } from '../src/engine/principle';
import { plateExchanger } from '../src/data/devices';
const make=(id:string)=>{const p=plateExchanger.parts.find(x=>x.id===id)!; const g=plateExchangerModelPart(id,p.color);g.position.set(...p.pos);g.updateMatrixWorld(true);g.traverse(o=>{if(o instanceof THREE.Mesh) for(const m of Array.isArray(o.material)?o.material:[o.material])m.side=THREE.DoubleSide;});return g};
const fixed=make('fixedPlate'), moving=make('movablePlate'), plates=make('plates'), gaskets=make('gaskets'), guides=make('guideBars'), bolts=make('bolts');
const check=(s:string,v:boolean)=>{if(!v)throw Error(s);console.log('PASS',s)};
const ray=(o:THREE.Object3D, x:number,y:number,z:number,far:number)=>new THREE.Raycaster(new THREE.Vector3(x,y,z),new THREE.Vector3(1,0,0),0,far).intersectObject(o,true).length;
for (const [name,g,x,far] of [['固定端板',fixed.children[0],-0.8,0.2],['板片',plates.children[0].children[0],-0.7,0.1]] as const) {
 for(const y of [-0.28,0.28])for(const z of [-0.16,0.16])check(`${name}四角通孔 ${y},${z}`,ray(g,x,0.6+y,z,far)===0);
 check(`${name}孔外有实体`,ray(g,x,0.6,0,far)>0);
}
for(const [name,g,x,far] of [['固定端板',fixed.children[0],-0.8,0.2],['活动压紧板',moving.children[0],-0.43,0.15]] as const)for(const y of [-0.39,0.39])for(const z of [-0.27,0.27])check(`${name}夹紧螺杆孔 ${y},${z}`,ray(g,x,0.6+y,z,far)===0);
const bound=(o:THREE.Object3D)=>new THREE.Box3().setFromObject(o), close=(a:number,b:number)=>Math.abs(a-b)<1e-5;
const first=bound(plates.children[0].children[0]), last=bound(plates.children[11].children[0]), f=bound(fixed.children[0]), m=bound(moving.children[0]);
check('板片组夹紧于端板之间',close(f.max.x,first.min.x)&&close(last.max.x+0.006,m.min.x));
for(let i=0;i<12;i++){const p=bound(plates.children[i].children[0]),g=bound(gaskets.children[i]);check(`垫片${i+1}贴合板面`,close(p.max.x,g.min.x));}
check('两导杆支撑挂耳全行程',guides.children.every(o=>{const b=bound(o);return b.min.x < -0.67 && b.max.x > 0.20;}));
check('四组夹紧螺杆', bolts.children.length===4);
for(const [i,u] of bolts.children.entries()) {
 const c=u.children; const left=bound(c[1]), right=bound(c[3]);
 check(`紧固件${i+1}垫圈贴合两端板`,close(left.max.x,-0.77)&&close(right.min.x,-0.316));
 const p=new THREE.Vector3(); u.getWorldPosition(p);
 for(const j of [1,2,3,4]) check(`紧固件${i+1}零件${j}真实通孔`,ray(c[j],-1, p.y,p.z,1)===0);
 const shaft=bound(c[0]);check(`紧固件${i+1}螺杆贯穿夹持面`,shaft.min.x < -0.77 && shaft.max.x > -0.316);
}
for(const y of [-0.28,0.28])for(const z of [-0.16,0.16])check(`活动板封闭角孔 ${y},${z}`,ray(moving.children[0],-0.43,0.6+y,z,0.15)>0);
const flangeCount=fixed.children.filter(o=>o.userData.boltHoles===4).length;check('四个接管法兰有螺栓孔',flangeCount===4);
check('实际流动和密封性能限制已标注',plateExchanger.structureNote.includes('未验证实际流动或密封性能'));

for(const y of [-0.43,0.43]) check(`活动板导杆孔 ${y}`,ray(moving.children[0],-0.43,0.6+y,0,0.15)===0);

for (let i=0; i<12; i++) {
  const layer=gaskets.children[i]; const x=layer.position.x;
  for(const y of [-0.28,0.28]) for(const z of [-0.16,0.16]) {
    const direction=new THREE.Vector3(0,0,-Math.sign(z));
    const hits=new THREE.Raycaster(new THREE.Vector3(x,0.6+y,z),direction,0.0001,0.12).intersectObject(layer,true).length;
    const sealed = z === layer.userData.closedZ;
    check(`第${i+1}层角孔(${y},${z})${sealed?'隔离':'通向通道'}`,sealed ? hits>0 : hits===0);
    const axial=new THREE.Raycaster(new THREE.Vector3(x-0.01,0.6+y,z),new THREE.Vector3(1,0,0),0,0.02).intersectObject(layer,true).length;
    check(`第${i+1}层角孔(${y},${z})轴向贯通`,axial===0);
  }
  for (const dir of [[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
    const hits=new THREE.Raycaster(new THREE.Vector3(x,0.6,0),new THREE.Vector3(...dir as [number,number,number]),0.0001,0.4).intersectObject(layer,true).length;
    check(`第${i+1}层周边密封 ${dir.join(',')}`,hits>0);
  }
  if (i>0) check(`第${i+1}层交替隔离`,layer.userData.closedZ === -gaskets.children[i-1].userData.closedZ);
}
for(const y of [-0.28,0.28])for(const z of [-0.16,0.16]) {
 check(`活动端角孔封闭 ${y},${z}`,ray(moving.children[0],-0.43,0.6+y,z,0.15)>0);
 check(`固定端与首板贴合阻断端部间隙 ${y},${z}`,close(f.max.x,first.min.x));
}
import { INTERACTIONS } from '../src/engine/interactions';
const groups=new Map([['plates',plates],['gaskets',gaskets],['movablePlate',moving],['bolts',bolts]]);
const nut=bolts.children[0].children[1], shaft=bolts.children[0].children[0];
const initial={nut:nut.position.x,shaft:shaft.position.x,moving:moving.position.x,last:plates.children[11].position.x};
INTERACTIONS['plate-exchanger'].apply(0.15,groups);
check('先沿轴向松开螺母',nut.position.x<initial.nut && shaft.position.x===initial.shaft && moving.position.x===initial.moving);
INTERACTIONS['plate-exchanger'].apply(0.4,groups);
check('螺杆沿轴向退出且活动板尚未移动',shaft.position.x>initial.shaft && moving.position.x===initial.moving);
INTERACTIONS['plate-exchanger'].apply(0.6,groups);
check('活动板先于板片移动',moving.position.x>initial.moving && plates.children[11].position.x===initial.last);
INTERACTIONS['plate-exchanger'].apply(1,groups);
check('板片后展开且始终在导杆范围',plates.children[11].position.x>initial.last && moving.position.x<0.95 && plates.children[11].position.x<0.95);
for (const p of [-0.28,0.28]) for(const z of [-0.16,0.16]) {
  const nozzleFlange = fixed.children.find(o=>o.userData.boltHoles===4 && Math.abs(o.position.y-p)<1e-8 && Math.abs(o.position.z-z)<1e-8)!;
  check(`接管中心开放 ${p},${z}`,ray(nozzleFlange,-1,0.6+p,z,0.2)===0);
  for (const [dy,dz] of [[0.071,0],[-0.071,0],[0,0.071],[0,-0.071]]) check(`法兰螺栓孔 ${p},${z},${dy},${dz}`,ray(nozzleFlange,-1,0.6+p+dy,z+dz,0.2)===0);
  check(`法兰孔周有实体 ${p},${z}`,ray(nozzleFlange,-1,0.6+p+0.058,z,0.2)>0);
}

for(let i=0;i<12;i++) for(const y of [-0.43,0.43]) {
 const frame=plates.children[i]; const x=frame.position.x;
 check(`第${i+1}板挂耳导杆轴向净空 ${y}`,ray(frame,x-0.03,0.6+y,0,0.06)===0);
 for(const z of [-0.029,0,0.029]) check(`第${i+1}板导杆半径净空 ${y},${z}`,ray(frame,x-0.03,0.6+y,z,0.06)===0);
}
for (const id of ['plates','gaskets','movablePlate']) {
 const part=plateExchanger.parts.find(p=>p.id===id)!;
 const waypoint=plateExchangerPracticeWaypoint(id,new THREE.Vector3(...part.pos))!;
 check(`${id}练习路径先避开板片`, id === 'gaskets' ? waypoint.x === part.pos[0] && waypoint.z > 0.5 : waypoint.x > 1.0 && waypoint.y === part.pos[1] && waypoint.z === part.pos[2]);
}
const right=bolts.children[0].children[3];
check('右垫圈在活动板最终位置之外',bound(right).min.x > -0.361+0.55+0.045);
const anim=new PrincipleAnim(plateExchanger,new Map());anim.object3d.visible=true;anim.update(0.5);
const particles:THREE.Mesh[]=[];anim.object3d.traverse(o=>{if(o instanceof THREE.Mesh) particles.push(o)});
check('原理动画粒子存在',particles.length===24);
for(const particle of particles) {
 const x=particle.position.x, layer=Math.round((x+0.662-0.011)/0.022), expected=-0.662+layer*0.022+0.011;
 check('粒子位于对应间隙且半径小于间隙',layer>=0&&layer<12&&Math.abs(x-expected)<1e-8&&particle.scale.x*0.032<0.003);
 check('粒子位于对应开放角孔之间',Math.abs(particle.position.z-(layer%2===0?-0.16:0.16))<1e-8 && particle.position.y>=0.32 && particle.position.y<=0.88);
}
anim.dispose();

const practiceBolts=make('bolts');
for(const progress of [0, 1/6, 1/3, 1/2, 2/3, 5/6, 1]) {
 const travel=plateExchangerBoltPracticePose(practiceBolts,progress);
 const unit=practiceBolts.children[0], shaft=unit.children[0], left=unit.children[1], right=unit.children[3];
 if(progress<=1/3) check(`练习 ${progress} 先松螺母，螺杆不动`,Math.abs(shaft.position.x+0.54)<1e-9 && travel===0);
 if(progress>1/3 && progress<=2/3) check(`练习 ${progress} 仅轴向抽杆`,shaft.position.x>=-0.54 && travel===0 && left.position.x < -0.9 && right.position.x > 0.4);
 if(progress>2/3) check(`练习 ${progress} 抽杆完成才整体移动`,shaft.position.x > 0.65 && travel>0);
}
for (let i=0;i<12;i++) {
 const gap=gaskets.children[i], gx=gap.userData.baseX as number;
 const leftCenter=-0.662+i*0.022, leftFace=leftCenter+0.008;
 const rightFace=i<11 ? leftCenter+0.022-0.008 : -0.406;
 check(`垫片${i+1}侧向退出时的轴向范围位于板间`,gx-0.003 >= leftFace-1e-9 && gx+0.003 <= rightFace+1e-9);
}

