import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode:true }, cacheDir:'node_modules/.vite-assembly-check' });
try {
  const { planConnection, planFasteners } = await server.ssrLoadModule('/src/workshop/assemblyPlan.ts');
  const { makeConnection, emptyState, instOf } = await server.ssrLoadModule('/src/workshop/state.ts');
  const { findPoseConflicts } = await server.ssrLoadModule('/src/workshop/motionValidation.ts');
  const instance = (uid, partId, x, dn=50, y=0, z=0) => ({uid,partId,spec:{dn},pos:[x,y,z],rot:[0,0,0]});
  const ref = (uid, port) => ({uid,port});
  const pipeSetup = emptyState();
  pipeSetup.instances = [instance('fixed','pipe',0),instance('moving','pipe',-10)];
  const expectWeld = state => planConnection(state, ref('fixed','p1'), ref('moving','p2'));
  const result = expectWeld(pipeSetup);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.state.connections.length,1);
  assert.equal(pipeSetup.connections.length,0);
  assert.deepEqual(instOf(result.state,'moving').pos, [-5,0,0]);
  assert.match(expectWeld(result.state).reason,/占用/);

  const blocked = structuredClone(pipeSetup);
  blocked.instances.push({...instance('wall','flange-blind',-6),hidden:true});
  assert.equal(expectWeld(blocked).ok,false);
  blocked.instances[1].spec.dn=65;
  assert.match(expectWeld(blocked).reason,/尺寸不匹配/);

  const gasket = emptyState();
  gasket.instances = [instance('left','flange-so',0),instance('gasket','gasket',0.4),instance('right','flange-so',1.7)];
  const first = makeConnection(gasket,ref('left','face'),ref('gasket','f1'));
  assert.ok(first.ok);
  const premature = planFasteners(gasket, first.conn.id);
  assert.equal(premature.ok,false);
  assert.match(premature.reason,/另一侧/);
  const second = makeConnection(gasket,ref('gasket','f2'),ref('right','face'));
  assert.ok(second.ok);
  const { findDockTarget } = await server.ssrLoadModule('/src/workshop/nearConnection.ts');
  const { slotWorld, describeBoltStack } = await server.ssrLoadModule('/src/workshop/state.ts');
  const { boltDims } = await server.ssrLoadModule('/src/workshop/layout.ts');
  const ready = structuredClone(gasket);
  const entrance = slotWorld(ready, first.conn.id, 0, describeBoltStack(ready,first.conn.id).underHead);
  const boltStart = entrance.pos.clone().addScaledVector(entrance.dir,-boltDims(16).len-0.06);
  ready.instances.push({uid:'bolt',partId:'bolt',spec:{dn:16},pos:boltStart.toArray(),rot:[0,0,0]});
  const boltDock = findDockTarget(ready, new Set(['bolt']), () => true, null);
  assert.equal(boltDock?.state.connections.at(-1).kind,'bolt-slot');
  assert.equal(ready.connections.length,2);
  const complete = planFasteners(gasket, first.conn.id);
  assert.ok(complete.ok, complete.reason);
  assert.equal(complete.installed,4);
  assert.equal(gasket.instances.length,3);
  assert.equal(complete.state.instances.length,11);
  assert.ok(!findPoseConflicts(complete.state).length,JSON.stringify(findPoseConflicts(complete.state)));
  assert.match(planFasteners(complete.state, second.conn.id).reason,/另一侧/);
  assert.equal(planFasteners(complete.state, first.conn.id).installed,0);

  const obstructed = structuredClone(gasket);
  obstructed.instances.push(instance('hidden','flange-blind',0.45,50,0,-0.625));
  obstructed.instances.at(-1).hidden = true;
  const freeze = JSON.stringify(obstructed);
  assert.equal(planFasteners(obstructed, first.conn.id).ok,false);
  assert.equal(JSON.stringify(obstructed),freeze);
  const shaft = emptyState();
  shaft.instances = [instance('sleeve','P043',-0.4,0),instance('shaft','P042',1.3,0)];
  const insertShaft = state => planConnection(state, ref('sleeve','bore'), ref('shaft','sleeve'));
  const axial = insertShaft(shaft);
  assert.equal(axial.ok,true,axial.reason);
  assert.deepEqual(instOf(axial.state,'shaft').pos,[0,0,0]);
  assert.equal(findPoseConflicts(axial.state).length,0);
  const crossedSleeve = structuredClone(axial.state);
  instOf(crossedSleeve,'shaft').pos[1]=0.03;
  assert.equal(findPoseConflicts(crossedSleeve).some(block => block.status === 'collision'),true);

  const { elbowR, flangeDims } = await server.ssrLoadModule('/src/workshop/layout.ts');
  const { portsAligned } = await server.ssrLoadModule('/src/workshop/state.ts');
  const exactLoop = emptyState();
  const r = elbowR(50);
  exactLoop.instances = [[0,0,0],[r,r,0],[0,2*r,0],[-r,r,0]].map((pos, index) => ({
    ...instance('bend-'+index, 'elbow90', 0), pos, rot: [0,0,index * Math.PI / 2]
  }));
  for (let i=0; i<3; i++) assert.ok(makeConnection(exactLoop, ref('bend-'+i,'p2'), ref('bend-'+(i+1),'p1')).ok);
  const closure = state => planConnection(state, ref('bend-3','p2'), ref('bend-0','p1'));
  const closed = closure(exactLoop);
  assert.equal(closed.ok, true, closed.reason + ' ' + JSON.stringify(exactLoop.instances));
  assert.equal(exactLoop.connections.length, 3);
  const residual = structuredClone(exactLoop);
  instOf(residual,'bend-0').pos[0] += 0.03;
  assert.equal(closure(residual).ok, false);
  assert.equal(residual.connections.length, 3);

  const phase = emptyState();
  phase.instances = [instance('fa','flange-so',0), instance('fb','flange-so',flangeDims(50).t)];
  instOf(phase,'fb').rot = [0,Math.PI,0];
  assert.ok(portsAligned(phase, ref('fa','face'), ref('fb','face')));
  instOf(phase,'fb').rot[0] = Math.PI / 4;
  assert.equal(portsAligned(phase, ref('fa','face'), ref('fb','face')), false);

  const wrongFastener = structuredClone(complete.state);
  const anchor = complete.state.instances.find(item => item.partId === 'bolt').uid;
  const alreadyFitted = wrongFastener.connections.find(link => link.kind === 'nut' && link.a.uid === anchor);
  wrongFastener.connections = wrongFastener.connections.filter(link => link !== alreadyFitted);
  wrongFastener.instances = wrongFastener.instances.filter(item => item.uid !== alreadyFitted.b.uid);
  wrongFastener.instances.push(instance('wrong','nut',3,12));
  assert.match(planConnection(wrongFastener,ref(anchor,'end'),ref('wrong','thread')).reason,/规格不匹配/);

  console.log('PASS: click alignment, hidden obstacle, fit rules, full gasket stack, nut seating, near bolt, atomic fasteners and shaft through the sleeve, closed loop, bolt phase and wrong thread');
} finally {
  await server.close();
}

