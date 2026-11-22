import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, cacheDir: 'node_modules/.vite-coating-check' });
try {
  const { actOnCoatingBatch, initialCoatingBatch } = await server.ssrLoadModule('/src/process/coatingBatch.ts');
  const { factoryFlow, FACTORY_MEDIA, FACTORY_PIPES } = await server.ssrLoadModule('/src/data/factory.ts');
  let state = initialCoatingBatch();
  const controls = { 'SV-201': 'closed' };
  const equipment = {};
  const evaluate = () => factoryFlow(id => controls[id] ?? 'open', id => equipment[id] ?? true, state).flows;
  const flow = id => evaluate().get(id);
  const inventoryKeys = ['raw', 'premix', 'blend', 'filter', 'packed', 'staged', 'quarantined', 'samples', 'collected', 'rinse'];
  let total = inventoryKeys.reduce((sum, key) => sum + state[key], 0);

  function act(action) {
    const flows = evaluate();
    const old = state;
    const result = actOnCoatingBatch(state, action, {
      canTransfer: id => flows.get(id)?.state === 'full',
      disperserRunning: equipment['R-201'] ?? true,
      mixerRunning: equipment['R-202'] ?? true
    });
    state = result.state;
    assert.equal(inventoryKeys.reduce((sum, key) => sum + state[key], 0), total);
    assert.ok(inventoryKeys.every(key => state[key] >= 0));
    return state !== old;
  }

  assert.equal(flow('PL-207').state, 'off');
  assert.equal(flow('PL-211').state, 'full');
  assert.equal(act('release'), false);
  assert.equal(act('sample'), false);
  controls['SV-201'] = 'open';
  equipment['R-202'] = false;
  assert.equal(act('sample'), false);
  equipment['R-202'] = true;
  assert.equal(act('sample'), true);
  assert.equal(flow('PL-207').state, 'off');
  assert.equal(act('hold'), true);
  assert.equal(flow('PL-207').state, 'off');
  assert.equal(state.blend, 1);
  assert.equal(act('release'), false);
  assert.equal(act('next-batch'), false);
  assert.equal(act('quarantine'), true);
  assert.equal(state.blend, 0);
  assert.equal(state.quarantined, 1);
  assert.equal(state.packed + state.staged, 0);
  assert.equal(act('next-batch'), true);

  act('reset');
  act('sample');
  act('release');
  assert.equal(flow('PL-207').state, 'full');
  equipment['C-201'] = false;
  assert.equal(flow('PL-211').state, 'off');
  assert.equal(flow('PL-208').state, 'off');
  assert.equal(state.blend, 1);
  equipment['C-201'] = true;
  act('loaded');
  assert.equal(flow('PL-208').throttle, true);
  act('blocked');
  assert.equal(flow('PL-208').state, 'off');
  act('clear');
  act('advance');
  assert.deepEqual([state.raw, state.blend, state.filter, state.packed], [3, 0, 1, 0]);
  controls['BV-204'] = 'closed';
  act('advance');
  assert.equal(state.filter, 1);
  assert.equal(state.packed, 0);
  controls['BV-204'] = 'open';
  act('advance');
  assert.equal(state.filter, 0);
  assert.equal(state.packed, 1);
  assert.equal(state.staged, 0);
  assert.equal(flow('PL-209').state, 'off');
  assert.equal(flow('PL-210').state, 'full');
  act('advance');
  assert.equal(state.packed, 0);
  assert.equal(state.staged, 1);
  assert.equal(flow('PL-210').state, 'off');
  act('advance');
  assert.equal(state.raw, 0);
  assert.equal(flow('PL-201').state, 'off');
  assert.equal(state.premix, 4);
  act('next-batch');
  act('advance');
  assert.equal(state.blend, 1);
  assert.equal(state.premix, 3);

  act('reset');
  act('sample');
  act('release');
  act('advance');
  act('drain');
  assert.equal(flow('PL-209').state, 'off');
  assert.equal(flow('PL-212').state, 'full');
  assert.equal(flow('PL-213').state, 'off');
  act('advance');
  assert.equal(state.collected, 1);
  act('rinse');
  assert.equal(flow('PL-212').state, 'off');
  assert.equal(flow('PL-213').state, 'full');
  act('advance');
  assert.equal(state.collected, 2);
  assert.equal(flow('PL-213').state, 'off');
  assert.equal(act('advance'), false);
  // Verify the physical endpoint and material for the separate packaged-products route.
  const packing = FACTORY_PIPES.find(pipe => pipe.id === 'PL-209');
  const staging = FACTORY_PIPES.find(pipe => pipe.id === 'PL-210');
  assert.deepEqual([packing.from.node, packing.to.node], ['F-201', 'FL-201']);
  assert.deepEqual([staging.from.node, staging.to.node], ['FL-201', 'ST-201']);
  assert.equal(FACTORY_MEDIA[packing.medium].phase, 'liquid');
  assert.equal(FACTORY_MEDIA[staging.medium].phase, 'packaged');

  const startup = actOnCoatingBatch(state, 'start-raw', {
    canTransfer: () => false, disperserRunning: true, mixerRunning: true
  });
  state = startup.state;
  assert.equal(state.blend, 0);
  total = state.raw + state.rinse;
  assert.equal(act('sample'), false);
  for (let round = 0; round < 5; round++) assert.equal(act('advance'), true);
  assert.deepEqual([state.raw, state.premix, state.blend], [0, 0, 4]);
  assert.equal(act('sample'), true);
  assert.equal(act('release'), true);
  for (let round = 0; round < 5; round++) assert.equal(act('advance'), true);
  assert.deepEqual([state.blend, state.filter, state.packed, state.staged, state.samples], [0, 0, 0, 3, 1]);
  assert.equal(act('advance'), false);
  console.log('PASS: finite intake, batch isolation and conservation, independent air, filter restriction, packing and staging, drain and rinse');
} finally {
  await server.close();
}
