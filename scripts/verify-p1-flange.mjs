import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { DoubleSide, Raycaster, Vector3 } from 'three';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true, hmr: false } });
try {
  const { getJoint } = await vite.ssrLoadModule('/src/data/factory.ts');
  const { buildPart } = await vite.ssrLoadModule('/src/workshop/geometry.ts');
  const { flangeDims, GASKET_THICKNESS, boltDims } = await vite.ssrLoadModule('/src/workshop/layout.ts');
  const { MM } = await vite.ssrLoadModule('/src/workshop/types.ts');
  const { emptyState, makeConnection, portsAligned, portWorld, slotWorld } = await vite.ssrLoadModule('/src/workshop/state.ts');
  const joint = getJoint('JOINT-201');
  assert.equal(joint.dn, 50);
  const spec = { dn: joint.dn };
  const dims = flangeDims(joint.dn);
  const state = emptyState();
  const gap = GASKET_THICKNESS;
  const faceCenter = (gap + dims.t) / 2;
  const left = { uid: 'left', partId: 'flange-so', spec, pos: [-faceCenter, 0.95, 0], rot: [0, 0, 0] };
  const right = { uid: 'right', partId: 'flange-so', spec, pos: [faceCenter, 0.95, 0], rot: [0, Math.PI, 0] };
  const gasket = { uid: 'gasket', partId: 'gasket', spec, pos: [0, 0.2, 0], rot: [0, 0, 0] };
  const wrongBolt = { uid: 'wrong', partId: 'bolt', spec: { dn: 12 }, pos: [0, 0.2, 1], rot: [0, 0, 0] };
  const bolt = { uid: 'bolt', partId: 'bolt', spec: { dn: 16 }, pos: [0, 0.2, 1], rot: [0, 0, 0] };
  const wrongGasket = { uid: 'wrong-gasket', partId: 'gasket', spec: { dn: 65 }, pos: [0, 0.3, 1], rot: [0, 0, 0] };
  state.instances.push(left, right, gasket, bolt, wrongBolt, wrongGasket);
  const leftFace = { uid: left.uid, port: 'face' };
  const rightFace = { uid: right.uid, port: 'face' };
  const gasketLeft = { uid: gasket.uid, port: 'f1' };
  const gasketRight = { uid: gasket.uid, port: 'f2' };
  assert.ok(Math.abs(portWorld(left, 'face').pos.distanceTo(portWorld(right, 'face').pos) / MM - 3) < 1e-8);
  assert.equal(makeConnection(state, leftFace, { uid: wrongGasket.uid, port: 'f1' }).ok, false);
  assert.equal(state.connections.length, 0);
  const first = makeConnection(state, leftFace, gasketLeft);
  assert.equal(first.ok, true);
  assert.ok(portsAligned(state, leftFace, gasketLeft));
  assert.ok(portsAligned(state, gasketRight, rightFace));
  right.rot[0] = Math.PI / 4;
  assert.equal(portsAligned(state, gasketRight, rightFace), false, 'half-pitch hole offset should fail');
  right.rot[0] = 0;
  const rightBefore = right.pos.slice();
  assert.equal(makeConnection(state, gasketRight, rightFace).ok, true);
  assert.ok(right.pos.every((value, index) => Math.abs(value - rightBefore[index]) < 1e-8));
  const grip = 2 * dims.t + gap;
  first.conn.meta = { boltStack: { underHead: dims.t, grip } };
  const firstSlot = { uid: 'joint:' + first.conn.id, port: 'slot0' };
  const before = state.connections.length;
  assert.equal(makeConnection(state, { uid: wrongBolt.uid, port: 'shank' }, firstSlot).ok, false);
  assert.equal(state.connections.length, before);
  assert.equal(makeConnection(state, { uid: bolt.uid, port: 'shank' }, firstSlot).ok, true);
  assert.ok(portWorld(bolt, 'shank').pos.distanceTo(slotWorld(state, first.conn.id, 0).pos) < 1e-8);

  const fitting = [left, right, gasket].map(instance => {
    const mesh = buildPart(instance.partId, instance.spec, '#64748b', 'carbon-steel');
    mesh.position.set(...instance.pos);
    mesh.rotation.set(...instance.rot);
    mesh.traverse(object => {
      if (object.isMesh) object.material.side = DoubleSide;
    });
    mesh.updateMatrixWorld(true);
    return mesh;
  });
  function rayHits(pos, dir) {
    return new Raycaster(pos.clone().addScaledVector(dir, -0.001), dir, 0, grip + 0.002)
      .intersectObjects(fitting, true).length;
  }
  const direction = new Vector3(1, 0, 0);
  for (let i = 0; i < dims.n; i++) {
    const hole = slotWorld(state, first.conn.id, i);
    assert.ok(Math.abs(Math.hypot(hole.pos.y - left.pos[1], hole.pos.z) - dims.k) < 1e-8);
    assert.equal(rayHits(hole.pos, hole.dir), 0, 'hole center intersects flange or gasket');
    for (let j = 0; j < 8; j++) {
      const angle = 2 * Math.PI * j / 8;
      const r = boltDims(16).r;
      const edge = hole.pos.clone().add(new Vector3(0, r * Math.cos(angle), r * Math.sin(angle)));
      assert.equal(rayHits(edge, hole.dir), 0, 'bolt shank envelope intersects flange or gasket');
    }
  }
  const firstHole = slotWorld(state, first.conn.id, 0).pos;
  assert.equal(rayHits(new Vector3(firstHole.x, left.pos[1], 0), direction), 0, 'central bore should be open');
  const betweenHoles = dims.k / Math.SQRT2;
  assert.ok(rayHits(new Vector3(firstHole.x, left.pos[1] + betweenHoles, betweenHoles), direction) > 0);
  const result = { id: joint.id, dn: joint.dn, mmPerUnit: 1 / MM, gasketMm: gap / MM,
    holes: dims.n, pitchCircleMm: 2 * dims.k / MM, holeDiameterMm: 2 * dims.hole / MM,
    boltGripMm: grip / MM, raysPerHole: 9, boreOpen: true,
    invalid: ['DN65 gasket', '45-degree hole offset', 'M12 bolt'] };
  await writeFile('outputs/verify-p1/flange-geometry.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await vite.close();
}
