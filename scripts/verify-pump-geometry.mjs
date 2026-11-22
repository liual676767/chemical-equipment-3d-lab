import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { Box3, DoubleSide, Mesh, Raycaster, Vector3 } from 'three';

const server = await createServer({ server: { middlewareMode: true }, cacheDir: 'node_modules/.vite-pump-check' });
try {
  const { deviceById } = await server.ssrLoadModule('/src/data/devices.ts');
  const { pumpPath } = await server.ssrLoadModule('/src/data/pumpPath.ts');
  const { pumpModelPart, setPumpDetail } = await server.ssrLoadModule('/src/engine/pumpModel.ts');
  const pump = deviceById('pump');
  const groups = new Map(pump.parts.map((part) => {
    const group = pumpModelPart(part.id, part.color);
    group.name = part.id;
    group.position.set(...part.pos);
    group.traverse((object) => {
      if (object instanceof Mesh) object.material.side = DoubleSide;
    });
    group.updateMatrixWorld(true);
    return [part.id, group];
  }));
  const ray = new Raycaster();
  function crossings(points, models) {
    const hits = [];
    for (let i = 1; i < points.length; i++) {
      const start = new Vector3(...points[i-1]);
      const delta = new Vector3(...points[i]).sub(start);
      if (delta.lengthSq() < 1e-12) continue;
      ray.set(start, delta.clone().normalize());
      ray.near = 1e-6;
      ray.far = delta.length() - 1e-6;
      for (const model of models) {
        const intersection = ray.intersectObject(model, true)[0];
        if (intersection) hits.push([i, model.name, ...intersection.point.toArray()]);
      }
    }
    return hits;
  }
  function triangleCount(group) {
    let count = 0;
    group.traverse((object) => {
      if (object instanceof Mesh) count += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
    });
    return count;
  }
  assert.equal(groups.size, 40);
  assert.equal(pump.parts.find(part => part.id === 'base').fixed, true);
  assert.equal(pump.assemblyOrder.length, 8);
  const casing = groups.get('casing');
  const overview = triangleCount(casing);
  const before = new Box3().setFromObject(casing);
  const wetParts = [...groups.values()].filter(group => [
    'casing','impeller','wearRing','pipeSuction','pipeElbowIn','pipeDischargeV','pipeElbowOut','pipeDischargeH','pipeReducer','pipeGaskets'
  ].includes(group.name));
  assert.deepEqual(crossings(pumpPath, wetParts), [], 'overview fluid path crosses geometry');
  setPumpDetail(casing, 'study');
  const study = triangleCount(casing);
  assert.ok(study > overview, 'study casing should have a finer surface');
  const after = new Box3().setFromObject(casing);
  assert.ok(before.min.distanceTo(after.min) < 0.006 && before.max.distanceTo(after.max) < 0.006, 'LOD changed the casing envelope');
  assert.deepEqual(crossings(pumpPath, wetParts), [], 'study fluid path crosses geometry');
  const shaftBoreParts = ['cover','seal','sealStatic','sealRotary','sealGland','sealSleeve','bearing','brgInner','brgCovers'].map(id => groups.get(id));
  assert.deepEqual(crossings([[-0.88,0.78,0],[0.65,0.78,0]], shaftBoreParts), [], 'passage along the shaft axis is blocked');
  const shaft = groups.get('shaft');
  ray.set(new Vector3(-0.95,0.78,0), new Vector3(0,1,0));
  ray.near = 0;
  ray.far = 0.1;
  for (const x of [-1.02, -0.86, -0.45, -0.16, -0.03, 0.14, 0.435, 0.62, 0.77]) {
    ray.ray.origin.x = x;
    assert.ok(ray.intersectObject(shaft, true).length, 'missing shaft section at ' + x);
  }
  console.log(JSON.stringify({ overviewTriangles: overview, studyTriangles: study, flowSegments: pumpPath.length - 1, parts: groups.size, shaftBoreOpen: true }));
} finally {
  await server.close();
}
