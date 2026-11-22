import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
const dir = await mkdtemp(join(tmpdir(), 'bag-fit-'));
try {
  const out = join(dir, 'model.mjs');
  await build({stdin:{contents:"export { buildPart } from './src/engine/builders'; export { DEVICES } from './src/data/devices'; export { BAG_SHELF_INNER, BAG_BASKET_OUTER, BAG_RIM_OUTER } from './src/engine/bagFilterModel';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:out,logLevel:'silent'});
  // Keep Three.js identity consistent with bundled model materials.
  const {buildPart, DEVICES, BAG_SHELF_INNER, BAG_BASKET_OUTER, BAG_RIM_OUTER} = await import(pathToFileURL(out).href);
  const d = DEVICES.find(x => x.id === 'bag-filter');
  const part = id => { const p=d.parts.find(x=>x.id===id), g=buildPart(d.id,id,p.color); g.position.set(...p.pos); g.updateMatrixWorld(true); return g; };
  const shell=part('shell'), basket=part('basket'), bag=part('bag'), seal=part('seal'), cover=part('cover'), bolts=part('coverBolts');
  const bounds = o => new THREE.Box3().setFromObject(o);
  const near=(a,b)=>Math.abs(a-b)<1e-5;
  const check=(n,ok)=>{if(!ok) throw Error(n); console.log('PASS '+n)};
  const shelf=bounds(shell.children[3]), top=bounds(basket.children[0]), rod=bounds(basket.children[1]), floor=bounds(basket.children[35]);
  const fabric=bounds(bag.children[0]), bottom=bounds(bag.children[1]), bagRing=bounds(bag.children[2]);
  const innerSeal=bounds(seal.children[1]), compression=bounds(cover.children[1]);
  const lower=bounds(shell.children[2]), outerSeal=bounds(seal.children[0]), upper=bounds(cover.children[0]);
  check('承托板与篮口环接触且篮体可以穿过承托孔', near(shelf.max.y,top.min.y) && BAG_BASKET_OUTER < BAG_SHELF_INNER && BAG_SHELF_INNER < BAG_RIM_OUTER);
  check('篮竖杆两端连接篮口及底环', near(rod.max.y,top.min.y) && near(rod.min.y,floor.max.y));
  check('滤袋底部放在篮底上且与袋壁接连', near(bottom.min.y,floor.max.y) && near(bottom.max.y,fabric.min.y));
  check('篮底环低于袋壁，避免穿插', floor.max.y <= fabric.min.y + 1e-5);
  check('篮口、袋口、密封、压紧环依序接触', near(top.max.y,bagRing.min.y) && near(bagRing.max.y,innerSeal.min.y) && near(innerSeal.max.y,compression.min.y));
  check('上下法兰之间为主密封垫留有空间', near(lower.max.y,outerSeal.min.y) && near(outerSeal.max.y,upper.min.y));
  let n=0; bolts.traverse(o=>{if(o.userData.hole)n++}); check('紧固件八组',n===8);
  for(const [name,g] of [['筒体',shell],['密封垫',seal],['盖',cover]]) {
    g.traverse(o=>{if(o.isMesh) { for(const mat of Array.isArray(o.material)?o.material:[o.material]) mat.side=THREE.DoubleSide; }});
    for(let i=0;i<8;i++){const a=i*Math.PI/4,x=-Math.cos(a)*0.315,z=Math.sin(a)*0.315; const ray=new THREE.Raycaster(new THREE.Vector3(x,1.18,z),new THREE.Vector3(0,-1,0),0,0.16); if(ray.intersectObject(g,true).length) throw Error(name+' 螺栓孔不贯通 '+i); }
    console.log('PASS '+name+'八孔贯通');
  }
} finally { await rm(dir,{recursive:true,force:true}); }

