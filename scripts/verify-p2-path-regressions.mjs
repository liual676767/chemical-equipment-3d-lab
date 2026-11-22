import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { Quaternion, Raycaster, Vector3 } from 'three';

const server = await createServer({ server: { middlewareMode: true }, cacheDir: 'outputs/verify-p2/vite-path-check' });
const failures = [];
function check(label, run) {
  try {
    run();
    console.log('PASS ' + label);
  } catch (error) {
    failures.push(error);
    console.error('FAIL ' + label + ': ' + error.message);
  }
}

try {
  const { planConnection } = await server.ssrLoadModule('/src/workshop/assemblyPlan.ts');
  const { makeConnection, emptyState } = await server.ssrLoadModule('/src/workshop/state.ts');
  const { findPoseConflicts } = await server.ssrLoadModule('/src/workshop/motionValidation.ts');
  const { findDockTarget } = await server.ssrLoadModule('/src/workshop/nearConnection.ts');
  const { convexPrism, sweepConvex } = await server.ssrLoadModule('/src/workshop/collisionSweep.ts');
  const { partConvexVolumes } = await server.ssrLoadModule('/src/workshop/collisionVolumes.ts');
  const { buildPart } = await server.ssrLoadModule('/src/workshop/geometry.ts');
  const ref = (uid, port) => ({ uid, port });
  const pipe = (uid, pos, z = 0) => ({ uid, partId: 'pipe', spec: { dn: 50, length: 500 }, pos, rot: [0, 0, z] });
  const bolt = (uid, pos, z = 0) => ({ uid, partId: 'bolt', spec: { dn: 12 }, pos, rot: [0, 0, z], hidden: true });

  const swing = emptyState();
  swing.instances = [pipe('fixed', [-9, 0, 0]), pipe('pivot', [0, 0, 0], Math.PI / 2), pipe('far', [0, 5, 0], Math.PI / 2)];
  assert.ok(makeConnection(swing, ref('pivot', 'p2'), ref('far', 'p1')).ok);
  const rotateToConnect = state => planConnection(state, ref('fixed', 'p2'), ref('pivot', 'p1'), {
    entryOffset: new Vector3(0.12, 0, 0)
  });
  check('空旷时两根已连接的直管能作为刚体转动', () => {
    const accepted = rotateToConnect(swing);
    assert.equal(accepted.ok, true, accepted.reason);
    assert.equal(accepted.state.connections.length, 2);
    assert.equal(swing.connections.length, 1);
  });
  const arcBlocked = structuredClone(swing);
  arcBlocked.instances.push(bolt('hidden-in-arc', [3.15, 5.24, 0.27], Math.PI / 4));
  check('远端件的圆弧扫掠会碰到隐藏障碍', () => {
    assert.equal(findPoseConflicts(arcBlocked).length, 0, 'the arc obstacle must not touch the start');
    const obstructed = rotateToConnect(arcBlocked);
    assert.equal(obstructed.ok, false);
    assert.match(obstructed.reason, /螺栓/);
    assert.equal(arcBlocked.connections.length, 1);
  });

  const near = emptyState();
  near.instances = [pipe('closest', [-5.08, 0, 0]), pipe('moving', [0, 0, 0]), pipe('reachable', [5.11, 0, 0])];
  near.instances.push(bolt('hidden-at-near-end', [-2.64, 0.29, 0], Math.PI / 2));
  check('最近接口路径受阻时仍可预览次近的可达接口', () => {
    const closest = planConnection(near, ref('closest', 'p2'), ref('moving', 'p1'), { near: true });
    const other = planConnection(near, ref('reachable', 'p1'), ref('moving', 'p2'), { near: true });
    assert.equal(closest.ok, false, 'fixture must block the closest port');
    assert.equal(other.ok, true, other.reason);
    assert.equal(findDockTarget(near, new Set(['moving']), () => true, null)?.fixed.uid, 'reachable');
    assert.equal(near.connections.length, 0);
  });

  check('完全包在盲板内部的实体也算干涉', () => {
    const solid = emptyState();
    solid.instances = [
      { uid: 'plate', partId: 'flange-blind', spec: { dn: 50 }, pos: [0, 0, 0], rot: [0, 0, 0] },
      { uid: 'insert', partId: 'pipe', spec: { dn: 15, length: 2 }, pos: [0, 0, 0], rot: [0, 0, 0] }
    ];
    assert.equal(findPoseConflicts(solid)[0]?.status, 'collision');
  });
  check('接口背面不吸附，且说明正确入口方向', () => {
    const state = emptyState();
    state.instances = [pipe('fixed', [0, 0, 0]), pipe('moving', [0.07, 0, 0], Math.PI)];
    const reasons = [];
    const target = findDockTarget(state, new Set(['moving']), () => true, null, {
      onRejected: reason => reasons.push(reason)
    });
    assert.equal(target, null);
    assert.match(reasons[0], /正面/);
    assert.equal(state.connections.length, 0);
  });
  check('螺栓六角头和圆杆的投影与教学网格同相', () => {
    const pose = { position: new Vector3(), rotation: new Quaternion() };
    const pieces = partConvexVolumes('bolt', { dn: 12 });
    const mesh = buildPart('bolt', { dn: 12 }, '#6b7684', 'alloy');
    mesh.updateMatrixWorld(true);
    const overlaps = (x, z) => {
      const ray = new Raycaster(new Vector3(x, 0, 0.2), new Vector3(0, 0, -1));
      const [surface] = ray.intersectObject(mesh, true);
      assert.ok(surface?.point.z > z + 0.0001, 'Probe must be inside the displayed mesh');
      const test = convexPrism(x - 0.0001, x + 0.0001,
        [[-0.0001, z], [0.0001, z], [0.0001, z + 0.0001], [-0.0001, z + 0.0001]]);
      return pieces.some(piece => sweepConvex(piece, pose, pose, test, pose, pose).status === 'collision');
    };
    assert.ok(overlaps(-0.04, 0.103), 'The widest rendered part of the M12 hex head occupies this region');
    assert.ok(overlaps(0.1, 0.0595), 'The rendered M12 shank occupies this region');
  });
  assert.equal(failures.length, 0, 'P2 path regressions');
} finally {
  await server.close();
}
