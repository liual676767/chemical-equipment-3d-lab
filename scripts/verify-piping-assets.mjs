import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { createServer } from 'vite';
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
try {
  const { pipingAssets }=await vite.ssrLoadModule('/src/workshop/expansion/piping.ts');
  await vite.ssrLoadModule('/src/workshop/expansion/index.ts');
  const { portsFor }=await vite.ssrLoadModule('/src/workshop/layout.ts');
  const { buildPart }=await vite.ssrLoadModule('/src/workshop/geometry.ts');
  assert.equal(pipingAssets.length, 38);
  assert.equal(new Set(pipingAssets.map(asset => asset.id)).size, 38);
  const { partById }=await vite.ssrLoadModule('/src/workshop/catalog.ts');
  const { makeConnection, emptyState, findPath, portsAligned }=await vite.ssrLoadModule('/src/workshop/state.ts');
  const pipeFixtures={
    'union':['p1','nipple-thread','p1','thread'],
    'coupling-thread':['p1','nipple-thread','p1','thread'],
    'coupling-reducing-thread':['p2','nipple-thread','p1','thread'],
    'nipple-thread':['p1','coupling-thread','p1','thread'],
    'plug-thread':['p1','coupling-thread','p1','thread'],
    'joint-bellows-flanged':['p1','flange-so','face','flange'],
    'flange-so':['face','flange-wn','face','flange'],
    'flange-wn':['face','flange-so','face','flange'],
    'flange-blind':['face','flange-so','face','flange'],
    'flange-lap-ring':['shoulder','flange-lap-stub','lap','mechanical'],
    'flange-lap-stub':['lap','flange-lap-ring','shoulder','mechanical'],
    'gasket':['f1','flange-so','face','flange'],
    'bolt':['washer-seat','washer-flat','bore','mechanical'],
    'nut':['thread','bolt','end','nut'],
    'washer-flat':['bore','bolt','washer-seat','mechanical'],
    'clamp':['mount','pipe','surface','clamp'],
    'support':['mount','pipe','surface','clamp'],
    'saddle-vessel':['cradle','heat-shell-tube','shell-saddle','mechanical']
  };
  const add=(state,uid,partId,spec={})=>state.instances.push({uid,partId,pos:uid==='fixture'?[5,1,2]:[0,0,0],rot:uid==='fixture'?[0.2,0.8,0.6]:[0,0,0],spec:{...partById(partId).defaultSpec,...spec}});
  for (const asset of pipingAssets) {
    const model = buildPart(asset.id, asset.spec, '#9aabb9', 'carbon-steel');
    const bounds = new Box3().setFromObject(model);
    const ports = portsFor(asset.id, asset.spec);
    assert(!bounds.isEmpty() && [...bounds.min, ...bounds.max].every(Number.isFinite), asset.id + ' model bounds');
    assert(ports.length > 0, asset.id + ' has interfaces');
    for (const port of ports) {
      assert(port.pos.every(Number.isFinite), asset.id + ' ' + port.id);
      assert(Math.abs(new Vector3(...port.dir).length() - 1) < 1e-5, asset.id + ' ' + port.id);
      assert(bounds.clone().expandByScalar(0.04).containsPoint(new Vector3(...port.pos)), asset.id + ' ' + port.id);
    }
    for (const ends of asset.passages ?? []) {
      assert(ends.every(id => ports.some(port => port.id === id)), asset.id + ' passage references');
    }
    assert(asset.sources.length > 0 && asset.sources.every(source => source.url?.startsWith('https://') && source.basis), asset.id + ' sources');
    const state=emptyState();
    const [pa, fixture, pb, kind]=pipeFixtures[asset.id]??(asset.category==='valve'?['p1','flange-so','face','flange']:['p1','pipe','p2','weld']);
    const spec={};
    if (fixture==='flange-so'||fixture==='pipe') spec.dn=asset.spec.dn;
    add(state,'part',asset.id);
    add(state,'fixture',fixture,spec);
    const a={uid:'part',port:pa}, b={uid:'fixture',port:pb};
    const result=makeConnection(state,a,b);
    assert(result.ok,asset.id+' / '+fixture+': '+result.reason);
    assert.equal(result.conn.kind,kind,asset.id);
    if (kind!=='clamp') assert(portsAligned(state,a,b),asset.id+' alignment');
  }
  function continuity(id) {
    const state=emptyState();
    add(state,'part',id);
    const a={uid:'part',port:'p1'}, b={uid:'part',port:'p2'};
    return [findPath(state,a,b).ok,findPath(state,b,a).ok];
  }
  assert.deepEqual(continuity('valve-check-lift'),[true,false]);
  assert.deepEqual(continuity('valve-safety'),[false,false]);
  assert.deepEqual(continuity('valve-ball'),[true,true]);
  assert.deepEqual(continuity('valve-gate'),[true,true]);
  console.log('38/38 valid directional, fluid or mechanical assembly fixtures; 4 continuity cases passed');
} finally { await vite.close(); }
