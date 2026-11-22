import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
let failures = 0;
function check(label, run) {
  try { run(); console.log('PASS ' + label); }
  catch (error) { failures++; console.error('FAIL ' + label + '  ' + error.message); }
}

try {
  const { FactoryScene } = await server.ssrLoadModule('/src/factory/scene.ts');
  const { actOnCoatingBatch, initialCoatingBatch } = await server.ssrLoadModule('/src/process/coatingBatch.ts');
  const state = await server.ssrLoadModule('/src/workshop/state.ts');
  const storage = await server.ssrLoadModule('/src/workshop/storage.ts');
  const { VALVE_OPERATIONS } = await server.ssrLoadModule('/src/data/valveOperations.ts');
  const key = 'chem3d-workshop:v1';
  let raw = null;
  let failRead = false;
  let failWrite = false;
  globalThis.localStorage = {
    getItem() { if (failRead) throw new DOMException('Blocked', 'SecurityError'); return raw; },
    setItem(_, value) { if (failWrite) throw new DOMException('Full', 'QuotaExceededError'); raw = value; }
  };
  const available = { canTransfer: () => true, disperserRunning: true, mixerRunning: true };
  const sampled = actOnCoatingBatch(initialCoatingBatch(), 'sample', available).state;
  const coating = actOnCoatingBatch(sampled, 'release', available).state;
  assert.equal(coating.release, 'released');
  const fixture = { coating, nodes: [], valveStates: new Map([['BV-202', 'closed']]), deviceCommands: new Map() };
  check('E 关闭 BV-202 后空气仍通，产品线停止', () => {
    FactoryScene.prototype.recomputeFlows.call(fixture);
    assert.equal(fixture.flows.get('PL-211').state, 'full');
    assert.equal(fixture.flows.get('PL-207').state, 'halt');
    assert.equal(fixture.flows.get('PL-208').state, 'off');
    assert.equal(fixture.flows.get('PL-209').state, 'off');
  });
  check('E 空压机停机只撤去动力，成品泵没有输送', () => {
    fixture.valveStates.clear();
    fixture.deviceCommands.set('C-201', false);
    FactoryScene.prototype.recomputeFlows.call(fixture);
    assert.equal(fixture.flows.get('PL-211').state, 'off');
    assert.equal(fixture.flows.get('PL-207').state, 'full');
    assert.equal(fixture.flows.get('PL-208').state, 'off');
  });
  check('C 五种阀型各自限制操作', () => {
    assert.deepEqual(VALVE_OPERATIONS.gate.commands, ['open', 'closed']);
    assert.deepEqual(VALVE_OPERATIONS.ball.commands, ['open', 'closed']);
    assert.deepEqual(VALVE_OPERATIONS.check.commands, []);
    assert(VALVE_OPERATIONS.butterfly.commands.includes('partial'));
    assert(VALVE_OPERATIONS.control.commands.includes('partial'));
  });
  const planResult = storage.newPlan('测试方案');
  const plan = planResult.plan ?? planResult;
  check('F 保存成功且确实写入', () => {
    plan.name = '已修改';
    assert.equal(storage.savePlan(plan)?.ok, true);
    assert.equal(JSON.parse(raw).plans[0].name, '已修改');
  });
  check('F 存储容量不足时返回失败', () => {
    failWrite = true;
    try { assert.match(storage.savePlan(plan).error, /容量/); } finally { failWrite = false; }
  });
  check('F 浏览器拒绝访问存储时返回失败', () => {
    failRead = true;
    try { assert.match(storage.savePlan(plan).error, /无法访问/); } finally { failRead = false; }
  });
  check('F 损坏存档逐字保留', () => {
    raw = '{损坏';
    assert.equal(storage.savePlan(plan)?.ok, false);
    assert.equal(localStorage.getItem(key), '{损坏');
  });
  raw = null;

  function joinedPipes(endType) {
    const assembly = state.emptyState();
    const make = (uid, x) => ({ uid, partId: 'pipe', pos: [x, 0, 0], rot: [0, 0, 0], spec: { dn: 50, length: 500, endType } });
    assembly.instances.push(make('left', 0), make('right', 5));
    const connected = state.makeConnection(assembly, { uid: 'left', port: 'p2' }, { uid: 'right', port: 'p1' });
    assert(connected.ok, connected.reason);
    return assembly;
  }
  function joinedThread() {
    const assembly = state.emptyState();
    assembly.instances.push(
      { uid: 'left', partId: 'nipple-thread', pos: [0, 0, 0], rot: [0, 0, 0], spec: { dn: 25 } },
      { uid: 'right', partId: 'coupling-thread', pos: [3, 0, 0], rot: [0, 0, 0], spec: { dn: 25 } });
    const connected = state.makeConnection(assembly, { uid: 'left', port: 'p1' }, { uid: 'right', port: 'p1' });
    assert(connected.ok, connected.reason);
    return assembly;
  }
  for (const kind of ['weld', 'flange', 'thread']) {
    const valid = kind === 'thread' ? joinedThread() : joinedPipes(kind);
    const cases = [
      ['规格', state => { state.instances[1].spec.dn = 80; }, /尺寸|规格/],
      ['轴向', state => { state.instances[1].rot[2] += Math.PI; }, /位置|方向/],
      ['位置', state => { state.instances[1].pos[1] += 1; }, /位置|方向/],
      ['占用', state => { state.connections.push({ ...state.connections[0], id: 'duplicate' }); }, /占用/],
      ['缺失实例', state => { state.instances.pop(); }, /不存在/]
    ];
    check('G ' + kind + ' 合法旧状态可载入', () => assert.equal(storage.validateState(valid), null));
    for (const [name, mutate, message] of cases) {
      check('G ' + kind + ' 拒绝错误' + name, () => {
        const invalid = structuredClone(valid);
        mutate(invalid);
        assert.match(storage.validateState(invalid), message);
      });
    }
  }
} finally {
  delete globalThis.localStorage;
  await server.close();
}
process.exitCode = failures ? 1 : 0;
