import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { Box3, MeshStandardMaterial, Raycaster, Vector3 } from 'three';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { pumpAssets, pumpLessonConnections } = await server.ssrLoadModule('/src/workshop/expansion/pump.ts');
  assert.equal(pumpAssets.length, 12);
  const models = new Map();
  const ports = new Map();
  const upper = 0.795;
  const radiusHit = (code, x) => {
    const hits = new Raycaster(new Vector3(x, upper + 0.4, 0.002), new Vector3(0, -1, 0)).intersectObject(models.get(code));
    assert(hits.length, code + ' missing shaft surface at ' + x);
    return Math.hypot(hits[0].point.y - upper, 0.002);
  };
  const alongX = (code, x, dy, dz, length) =>
    new Raycaster(new Vector3(x, upper + dy, dz), new Vector3(1, 0, 0), 0, length).intersectObject(models.get(code));
  for (const asset of pumpAssets) {
    const model = asset.build(asset.spec, new MeshStandardMaterial());
    model.position.fromArray(asset.lessonPosition);
    model.updateMatrixWorld(true);
    const box = new Box3().setFromObject(model);
    assert(!box.isEmpty() && [...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite), asset.code);
    models.set(asset.code, model);
    for (const p of asset.ports(asset.spec)) {
      ports.set(asset.code + '.' + p.id, { ...p, world: model.localToWorld(new Vector3(...p.pos)) });
    }
  }
  assert.equal(models.size, 12);
  assert.equal(new Set(models.values()).size, 12);
  const used = new Set();
  for (const edge of pumpLessonConnections) {
    const keys = [edge.a.join('.'), edge.b.join('.')];
    const [a, b] = keys.map(k => ports.get(k));
    assert(a.world.distanceTo(b.world) < 1e-8, keys.join(' / '));
    assert.equal(new Vector3(...a.dir).dot(new Vector3(...b.dir)), -1);
    assert.equal(a.mate.family, b.mate.family);
    assert.notEqual(a.mate.gender, b.mate.gender);
    for (const k of keys) { assert(!used.has(k)); used.add(k); }
  }
  assert.equal(used.size, 24);
  console.log('PASS 12 unique meshes/groups, 12 distinct matching interfaces and opposing normals');

  for (const [id, x, dy, max] of [
    ['P040', -0.76, 0.065, 0.28], ['P041', -1.15, 0.057, 0.30],
    ['P043', -0.51, 0.061, 0.22], ['P044', -0.05, 0.08, 0.71],
    ['P045', 0.25, 0.063, 0.1], ['P046', -0.47, 0.07, 0.10],
    ['P047', -0.41, 0.076, 0.10], ['P048', -0.55, 0.085, 0.3],
    ['P049', 0.70, 0.046, 0.32]
  ]) assert.equal(alongX(id, x, dy, 0, max).length, 0, id + ' blocked its mating bore');
  assert.equal(alongX('P041', -1.117, 0.066, 0, 0.22).length, 0, 'impeller keyway blocked');
  assert.equal(alongX('P049', 0.729, 0.055, 0, 0.111).length, 0, 'pump coupling keyway blocked');
  console.log('PASS nine actual bores and both drive keyways admit the matching shaft or sleeve');

  const probes = [[-0.94,0.061],[-0.52,0.0645],[-0.4,0.0645],[-0.29,0.078],[0.27,0.078],[0.28,0.065],[0.74,0.05]];
  for (const [x, radius] of probes) assert(Math.abs(radiusHit('P042',x) - radius) < 0.0005, 'shaft station ' + x);
  // Rays start in the seal-face gap region and go in opposite directions,
  // hitting the real annular faces on the same plane.
  const front = new Raycaster(new Vector3(-0.38, upper + 0.093, 0), new Vector3(-1,0,0)).intersectObject(models.get('P046'));
  const back = alongX('P047', -0.42, 0.093, 0, 0.10);
  assert(front.length && back.length && Math.abs(front[0].point.x - back[0].point.x) < 1e-6);
  console.log('PASS shaft shoulders correspond to sleeve, bearing and coupling; seal faces coincide');

  const baseTop = upper - 0.685;
  for (const [id, x] of [['P039',-1],['P044',0.3]]) {
    const bottom = new Box3().setFromObject(models.get(id)).min.y;
    assert(Math.abs(bottom - baseTop) < 1e-6, id + ' foot elevation');
    const hit = new Raycaster(new Vector3(x, baseTop + 0.05, 0),new Vector3(0,-1,0)).intersectObject(models.get('P050'))[0];
    assert(hit && Math.abs(hit.point.y - bottom) < 1e-6, id + ' foot/base gap');
  }
  console.log('PASS casing and bearing pedestal contact the actual baseplate');
} finally {
  await server.close();
}
