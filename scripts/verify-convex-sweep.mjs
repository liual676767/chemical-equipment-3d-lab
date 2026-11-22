import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { Quaternion, Vector3 } from 'three';

const server = await createServer({ server: { middlewareMode: true }, cacheDir: 'node_modules/.vite-motion-check' });
try {
  const { convexPrism, sweepConvex } = await server.ssrLoadModule('/src/workshop/collisionSweep.ts');
  const { partConvexVolumes } = await server.ssrLoadModule('/src/workshop/collisionVolumes.ts');
  const rectangle = (x, y, z) => convexPrism(-x, x, [[-y,-z],[y,-z],[y,z],[-y,z]]);
  const pose = (x, y = 0, z = 0, angle = 0) => ({
    position: new Vector3(x, y, z),
    rotation: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle)
  });
  const wall = rectangle(0.002, 2, 2);
  const part = rectangle(0.05, 0.05, 0.05);
  const fixed = pose(0);
  const crossing = sweepConvex(part, pose(-80), pose(80), wall, fixed, fixed);
  assert.equal(crossing.status, 'collision');
  assert.ok(Math.abs(crossing.fraction - (80 - 0.052) / 160) < 1e-7);
  assert.equal(sweepConvex(part, pose(-80, 2.1), pose(80, 2.1), wall, fixed, fixed).status, 'clear');
  assert.equal(sweepConvex(part, pose(-2), pose(-0.052), wall, fixed, fixed).status, 'clear');

  const arm = rectangle(2.1, 0.05, 0.05);
  const neighbor = pose(1.4, 0);
  const clockwise = sweepConvex(arm, pose(0,0,0,-1), pose(0,0,0,1), part, neighbor, neighbor);
  assert.equal(clockwise.status, 'collision');
  const spaced = pose(3.5);
  assert.equal(sweepConvex(arm, pose(0,0,0,-1), pose(0,0,0,1), part, spaced, spaced).status, 'clear');

  const circularWall = [];
  for (let i = 0; i < 24; i++) {
    const low = Math.PI * i / 12;
    const high = Math.PI * (i + 1) / 12;
    const point = (r, angle) => [r * Math.cos(angle), r * Math.sin(angle)];
    circularWall.push(convexPrism(-0.04, 0.04, [point(0.22,low),point(0.3,low),point(0.3,high),point(0.22,high)]));
  }
  assert.ok(circularWall.every(side => sweepConvex(part, pose(-1), pose(1), side, fixed, fixed).status === 'clear'));
  assert.ok(circularWall.some(side => sweepConvex(part, pose(-1,0.26), pose(1,0.26), side, fixed, fixed).status === 'collision'));
  const flange = partConvexVolumes('flange-so', {dn:50});
  const bolt = partConvexVolumes('bolt', {dn:16});
  const fits = (offset) => bolt.every(piece => flange.every(target => {
    const from = pose(-1.3, 0.625 + offset);
    const to = pose(-0.09, 0.625 + offset);
    return sweepConvex(piece, from, to, target, fixed, fixed).status === 'clear';
  }));
  assert.ok(fits(0), 'M16 bolt should fit the DN50 teaching flange hole');
  assert.ok(!fits(0.05), 'A shifted M16 bolt must hit the solid disc');
  const { findMotionBlock } = await server.ssrLoadModule('/src/workshop/motionValidation.ts');
  const pipe = (uid, pos, hidden = false) => ({ uid, partId:'pipe', spec:{dn:100,length:500}, pos, rot:[0,0,0], hidden });
  const before = {
    instances:[pipe('fixed',[0,0,0],true),pipe('moving',[-8,0,0])],
    connections:[{id:'old-joint',kind:'weld',a:{uid:'fixed',port:'p1'},b:{uid:'moving',port:'p2'}}],
    groups:[]
  };
  const after = structuredClone(before);
  after.instances[1].pos[0] = 8;
  assert.equal(findMotionBlock(before, after)?.obstacle, 'fixed', 'Hidden connected objects are still solid');
  after.instances[1].pos[0] = -5;
  assert.equal(findMotionBlock(before, after), null, 'Touching pipe ends are allowed without overlap');
  const { findDockTarget } = await server.ssrLoadModule('/src/workshop/nearConnection.ts');
  const moving = new Set(['moving']);
  const visible = () => true;
  const fixture = { instances: [pipe('fixed',[0,0,0]),pipe('moving',[-5.06,0,0])],connections:[],groups:[] };
  const candidate = findDockTarget(fixture, moving, visible, null);
  assert.equal(candidate?.state.connections.length, 1);
  assert.equal(candidate?.state.instances[1].pos[0], -5);
  assert.equal(fixture.connections.length, 0, 'Checking a candidate must leave the real graph unchanged');
  assert.equal(findDockTarget(fixture, moving, () => false, null), null);
  fixture.instances[1].pos[0] = -5.16;
  assert.equal(findDockTarget(fixture, moving, visible, null), null);
  assert.equal(findDockTarget(fixture, moving, visible, candidate)?.fixed.uid, 'fixed');
  fixture.instances[1].spec.dn = 50;
  assert.equal(findDockTarget(fixture, moving, visible, candidate), null);
  console.log('PASS: 11 sweep checks and 7 near-interface checks; graph is untouched during candidate evaluation');
} finally {
  await server.close();
}
