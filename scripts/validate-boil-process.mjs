/**
 * 微沸喷烧流程数据校验入口（Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 5 + Phase 6）。
 *
 * 用 esbuild 打包 TypeScript 数据与校验器后执行，不进入浏览器、不依赖页面。
 * 错误（数据关系不成立/路由穿模/设备重叠/流体传播不成立/区域归属与上下游不成立/
 * 追踪分支或播放顺序不成立）→ 退出码 1；仅有待确认警告 → 退出码 0，但必须列出。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'chem3d-boil-validate-'));
const outfile = join(dir, 'boil-check.mjs');

try {
  await build({
    stdin: {
      contents: `
        export { BOIL_PROCESS } from './src/data/boilProcess';
        export { BOIL_LAYOUT, BOIL_KEEPOUTS } from './src/data/boilLayout';
        export { validateProcess } from './src/process/validate';
        export { validateConnectionRelations } from './src/process/connections';
        export { validatePiping, BOIL_PIPE_SIZES } from './src/process/piping';
        export { validateFluidSystem } from './src/process/fluid';
        export { validateProcessAreas } from './src/process/areas';
        export { createTraceEngine } from './src/process/trace';
        export { ProcessPlayback, PLAYBACK_SPEEDS, TEACHING_STEP_SECONDS, validatePlayback } from './src/process/playback';
        export { BOIL_MODELS, getBoilModelBounds } from './src/engine/boilModels';
      `,
      resolveDir: root,
      sourcefile: 'boil-process-entry.ts',
      loader: 'ts'
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    outfile,
    logLevel: 'silent'
  });

  const {
    BOIL_PROCESS,
    BOIL_LAYOUT,
    BOIL_KEEPOUTS,
    validateProcess,
    validateConnectionRelations,
    validatePiping,
    validateFluidSystem,
    validateProcessAreas,
    createTraceEngine,
    ProcessPlayback,
    PLAYBACK_SPEEDS,
    TEACHING_STEP_SECONDS,
    validatePlayback,
    BOIL_PIPE_SIZES,
    BOIL_MODELS,
    getBoilModelBounds
  } = await import(pathToFileURL(outfile).href);
  const sequences = [
    {
      flowId: 'flow-material',
      equipmentSequence: ['eq-smp', 'eq-crusher', 'eq-mixer', 'eq-furnace-pump', 'eq-secondary-chamber']
    },
    {
      flowId: 'flow-flue-gas',
      equipmentSequence: [
        'eq-secondary-chamber',
        'eq-rotary-kiln',
        'eq-quench-1',
        'eq-baghouse',
        'eq-quench-2',
        'eq-comprehensive-tower',
        'eq-wash-tower',
        'eq-wet-esp',
        'eq-id-fan',
        'eq-stack'
      ]
    }
  ];
  const result = validateProcess(BOIL_PROCESS, {
    areas: 5,
    steps: 15,
    equipment: 18,
    pipelines: 13,
    flowStreams: 2,
    sequences
  });
  const connection = validateConnectionRelations(
    BOIL_PROCESS,
    (key) => BOIL_MODELS[key]?.ports,
    {
      equipment: 18,
      modelInstances: 18,
      modelTypes: 14,
      modelPorts: 28,
      anchoredPorts: 36,
      connectedPorts: 26,
      boundaryPorts: 2,
      pendingPorts: 8,
      edges: 13,
      sequences
    }
  );

  const modelSpecs = {};
  for (const key of Object.keys(BOIL_MODELS)) {
    modelSpecs[key] = {
      key,
      bbox: getBoilModelBounds(key),
      ports: BOIL_MODELS[key].ports.map((port) => ({
        id: port.id,
        pos: port.pos,
        dir: port.dir,
        size: port.size,
        role: port.role,
        media: port.media,
        boundary: port.boundary
      }))
    };
  }
  const piping = validatePiping(
    BOIL_PROCESS,
    (key) => modelSpecs[key],
    {
      equipment: 18,
      placements: 18,
      worldPorts: 36,
      connectedPorts: 26,
      boundaryPorts: 2,
      pendingPorts: 8,
      routedPipelines: 13,
      routedPorts: 26,
      terminalFlanges: 26,
      valves: 13,
      minSupports: 1,
      collisions: 0,
      equipmentOverlaps: 0,
      supportConflicts: 0
    },
    BOIL_LAYOUT,
    BOIL_KEEPOUTS
  );
  const fluid = validateFluidSystem(BOIL_PROCESS, piping.routes, {
    pipelines: 13,
    valves: 13,
    streams: 2,
    fullOnOpen: 13,
    throttleOnOpen: 0,
    suppliedOnOpen: 14,
    unsuppliedOnOpen: 4
  });
  const areas = validateProcessAreas(BOIL_PROCESS, piping.world, { expectedSprayGuns: 4 });

  /* Phase 6：追踪引擎与播放顺序 */
  const traceEngine = createTraceEngine(BOIL_PROCESS);
  const traceAudit = traceEngine.inspect();
  const washTrace = traceEngine.full('eq-wash-tower');
  const secondaryTrace = traceEngine.full('eq-secondary-chamber');
  const gunTrace = traceEngine.full('eq-spray-gun-02');
  const playbackAudit = validatePlayback(BOIL_PROCESS);
  const playbackProbe = new ProcessPlayback(BOIL_PROCESS, { stepDurationSeconds: 1 });
  playbackProbe.start();
  playbackProbe.tick(0.5);
  const playbackMid = playbackProbe.state;
  playbackProbe.setSpeed(4);
  playbackProbe.jumpTo(5);
  const playbackGuns = playbackProbe.state;
  playbackProbe.jumpTo(14);
  playbackProbe.tick(5);
  const playbackEnd = playbackProbe.state;
  playbackProbe.stop();
  const playbackStop = playbackProbe.state;

  const expectedWashUpstream = [
    'eq-smp',
    'eq-crusher',
    'eq-mixer',
    'eq-furnace-pump',
    'eq-secondary-chamber',
    'eq-rotary-kiln',
    'eq-quench-1',
    'eq-baghouse',
    'eq-quench-2',
    'eq-comprehensive-tower',
    'eq-wash-tower'
  ];
  const expectedWashDownstream = ['eq-wash-tower', 'eq-wet-esp', 'eq-id-fan', 'eq-stack'];

  /* 多分支汇入/分流：复制一条 二燃室→集冷塔一 的教学支路做合成验证 */
  const branchyProcess = structuredClone(BOIL_PROCESS);
  const branchBase = branchyProcess.pipelines.find((pipeline) => pipeline.id === 'pipe-gas-02');
  branchyProcess.pipelines.push({
    ...branchBase,
    id: 'pipe-test-branch',
    name: '合成验证支路：二燃室 → 集冷塔一',
    from: { equipment: 'eq-secondary-chamber', port: 'gasOut' },
    to: { equipment: 'eq-quench-1', port: 'gasIn' }
  });
  const branchyTrace = createTraceEngine(branchyProcess).full('eq-secondary-chamber');

  /* 循环保护：合成一条 烟囱→SMP 的回流管线，追踪必须终止并报告环 */
  const cyclicProcess = structuredClone(BOIL_PROCESS);
  const loopBase = cyclicProcess.pipelines[0];
  cyclicProcess.pipelines.push({
    ...loopBase,
    id: 'pipe-test-loop',
    name: '合成验证回流：烟囱 → SMP',
    from: { equipment: 'eq-stack', port: 'emissionOut' },
    to: { equipment: 'eq-smp', port: 'feedIn' }
  });
  const cycleEngine = createTraceEngine(cyclicProcess);
  const cycleTrace = cycleEngine.full('eq-smp');

  const phase6Checks = [];
  const checkPhase6 = (name, ok, detail = '') => {
    phase6Checks.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  };
  console.log('\n工艺追踪与流程播放校验（Phase 6）');
  checkPhase6('追踪图节点/工艺边/支路边', traceAudit.nodes === 18 && traceAudit.processEdges === 13 && traceAudit.branchEdges === 4,
    `节点 ${traceAudit.nodes} / 工艺边 ${traceAudit.processEdges} / 支路边 ${traceAudit.branchEdges}`);
  checkPhase6('四根喷枪为二燃室平行支路', traceAudit.branchGroups === 1 && traceAudit.branchParentIds[0] === 'eq-secondary-chamber' && traceAudit.branchEquipmentIds.length === 4,
    traceAudit.branchEquipmentIds.join(', '));
  checkPhase6('不存在喷枪串联边', traceAudit.serialGunEdges.length === 0, `串联边 ${traceAudit.serialGunEdges.length}`);
  checkPhase6('水洗塔上游完整路径', JSON.stringify(washTrace.upstream.paths[0]?.equipmentIds) === JSON.stringify(expectedWashUpstream),
    `上游 ${washTrace.upstream.paths[0]?.equipmentIds.length ?? 0} 台`);
  checkPhase6('水洗塔下游完整路径', JSON.stringify(washTrace.downstream.paths[0]?.equipmentIds) === JSON.stringify(expectedWashDownstream),
    `下游 ${washTrace.downstream.paths[0]?.equipmentIds.length ?? 0} 台`);
  checkPhase6('完整路径同时包含上下游', washTrace.full.paths[0]?.equipmentIds[0] === 'eq-smp' && washTrace.full.paths[0]?.equipmentIds.at(-1) === 'eq-stack',
    `完整路径 ${washTrace.full.paths.length} 条`);
  checkPhase6('二燃室完整路径包含 4 根平行支路', secondaryTrace.full.branches.length === 1 && secondaryTrace.full.branches[0].equipmentIds.length === 4,
    secondaryTrace.full.branches[0]?.equipmentIds.join(', ') ?? '无');
  checkPhase6('喷枪追踪不伪造工艺上下游', gunTrace.upstream.equipmentIds.length === 1 && gunTrace.downstream.equipmentIds.length === 1 && gunTrace.structuralParentId === 'eq-secondary-chamber',
    `结构宿主 ${gunTrace.structuralParentName}`);
  checkPhase6('多分支路径全部返回', branchyTrace.downstream.paths.length >= 2, `下游路径 ${branchyTrace.downstream.paths.length} 条`);
  checkPhase6('循环关系被识别且不无限递归', cycleTrace.cycles.length > 0 && cycleTrace.full.paths.length <= 32,
    `环 ${cycleTrace.cycles.length} 个 / 路径 ${cycleTrace.full.paths.length} 条`);
  checkPhase6('实际流程无有向环', traceAudit.cycleSafe && traceAudit.cycles.length === 0, `环 ${traceAudit.cycles.length}`);
  checkPhase6('播放顺序 15 步与清单一致', playbackAudit.ok && playbackAudit.steps === 15 && playbackAudit.stepTitles[5] === '四根喷枪',
    playbackAudit.stepTitles.join(' → '));
  checkPhase6('播放步骤覆盖全部设备/管线', playbackAudit.equipmentInSteps === 18 && playbackAudit.pipelinesInSteps === 13,
    `设备 ${playbackAudit.equipmentInSteps}/18 · 管线 ${playbackAudit.pipelinesInSteps}/13`);
  checkPhase6('播放器真实推进与暂停', playbackMid.status === 'playing' && playbackMid.progress > 0,
    `进度 ${(playbackMid.progress * 100).toFixed(1)}%`);
  checkPhase6('4× 速度与四喷枪步骤', playbackGuns.speed === 4 && playbackGuns.stepNo === 6 && playbackGuns.currentEquipmentIds.length === 4,
    `第 ${playbackGuns.stepNo} 步 · ${playbackGuns.currentEquipmentIds.length} 根喷枪`);
  checkPhase6('播放完成与停止复位', playbackEnd.status === 'completed' && Math.abs(playbackEnd.progress - 1) < 1e-9 && playbackStop.status === 'idle' && playbackStop.progress === 0,
    `完成 ${playbackEnd.status} / 停止 ${playbackStop.status}`);
  checkPhase6('速度档位 0.5/1/2/4', PLAYBACK_SPEEDS.join(',') === '0.5,1,2,4' && TEACHING_STEP_SECONDS > 0,
    `${PLAYBACK_SPEEDS.join(' / ')}；教学步长 ${TEACHING_STEP_SECONDS}s`);

  const phase6Errors = [];
  if (!traceAudit.cycleSafe) phase6Errors.push({ code: 'TRACE_CYCLE', message: '实际流程存在有向环' });
  if (traceAudit.serialGunEdges.length > 0) phase6Errors.push({ code: 'TRACE_GUN_SERIES', message: '喷枪被串成连续节点' });
  if (washTrace.upstream.paths.length === 0 || washTrace.downstream.paths.length === 0) {
    phase6Errors.push({ code: 'TRACE_PATH', message: '水洗塔上下游路径缺失' });
  }
  if (!secondaryTrace.full.branches.some((group) => group.equipmentIds.length === 4)) {
    phase6Errors.push({ code: 'TRACE_BRANCH', message: '二燃室平行支路缺失' });
  }
  if (branchyTrace.downstream.paths.length < 2) phase6Errors.push({ code: 'TRACE_MULTI_BRANCH', message: '多分支路径未全部返回' });
  if (cycleTrace.cycles.length === 0) phase6Errors.push({ code: 'TRACE_LOOP_DETECT', message: '循环关系未被识别' });
  if (!playbackAudit.ok) phase6Errors.push(...playbackAudit.errors.map((message) => ({ code: 'PLAYBACK', message })));
  if (playbackEnd.status !== 'completed' || playbackStop.status !== 'idle') {
    phase6Errors.push({ code: 'PLAYBACK_STATE', message: '播放完成/停止状态不正确' });
  }
  console.log(`Phase 6 检查：${phase6Checks.filter((item) => item.ok).length}/${phase6Checks.length} 通过`);

  console.log('微沸喷烧流程数据校验（Phase 1）');
  console.log(
    `工艺区 ${result.counts.areas} / 工序 ${result.counts.steps} / 设备实例 ${result.counts.equipment} / ` +
      `管线 ${result.counts.pipelines} / 流线 ${result.counts.flowStreams} / 介质 ${result.counts.media} / ` +
      `接口 ${result.counts.ports}（已连接 ${result.counts.connectedPorts} / 未连接 ${result.counts.unconnectedPorts}；` +
      `状态待确认 ${result.counts.pendingStatusPorts}）`
  );
  console.log(`错误 ${result.errors.length} / 警告 ${result.warnings.length} / 待确认标记 ${result.pending.length}`);

  console.log('\n设备接口与连接关系校验（Phase 2）');
  console.log(
    `设备 ${connection.counts.equipment} / 建模实例 ${connection.counts.modelInstances} / 模型类型 ${connection.counts.modelTypes} / ` +
      `模型接口 ${connection.counts.modelPorts} / 数据接口 ${connection.counts.dataPorts}（锚定 ${connection.counts.anchoredPorts} / ` +
      `已连接 ${connection.counts.connectedPorts} / 边界 ${connection.counts.boundaryPorts} / 待确认 ${connection.counts.pendingPorts} / ` +
      `未连接 ${connection.counts.unconnectedPorts}）/ 连接边 ${connection.counts.edges} / ` +
      `上下游路径 ${connection.counts.upstreamPaths}+${connection.counts.downstreamPaths}`
  );
  console.log(`错误 ${connection.errors.length} / 警告 ${connection.warnings.length}`);

  console.log('\n工业管道教学示意路由与穿模校验（Phase 3）');
  console.log(
    `教学布局 ${piping.counts.placements} / 世界接口 ${piping.counts.worldPorts}（接管 ${piping.counts.connectedPorts} / ` +
      `边界 ${piping.counts.boundaryPorts} / 待确认 ${piping.counts.pendingPorts}）/ 已路由管线 ${piping.counts.routedPipelines} / ` +
      `端部法兰 ${piping.counts.terminalFlanges} / 直管段 ${piping.counts.straightSegments} / 弯头 ${piping.counts.elbows} / ` +
      `示意阀 ${piping.counts.valves} / 支架 ${piping.counts.supports} / 三通 ${piping.counts.tees} / 变径 ${piping.counts.reducers}`
  );
  console.log(
    `管径等级 ${piping.counts.sizesUsed} 类（${Object.keys(BOIL_PIPE_SIZES).join('/')}）/ 路由总长 ${piping.counts.routeLength.toFixed(1)} m / ` +
      `穿模 ${piping.counts.collisions} / 设备重叠 ${piping.counts.equipmentOverlaps} / 支架冲突 ${piping.counts.supportConflicts}`
  );
  console.log(`错误 ${piping.errors.length} / 警告 ${piping.warnings.length}`);

  console.log('\n流体教学示意系统校验（Phase 4）');
  console.log(
    `管线 ${fluid.counts.pipelines} / 示意阀 ${fluid.counts.valves} / 流线 ${fluid.counts.streams} / ` +
      `全开流动 ${fluid.counts.fullOnOpen} / 全开节流 ${fluid.counts.throttleOnOpen} / ` +
      `供料设备 ${fluid.counts.suppliedOnOpen} / 待确认未供料 ${fluid.counts.unsuppliedOnOpen}`
  );
  console.log(
    `逐阀关闭传播 ${fluid.counts.closedPropagation}/${fluid.counts.pipelines} / ` +
      `逐阀部分开度传播 ${fluid.counts.partialPropagation}/${fluid.counts.pipelines}`
  );
  console.log(`错误 ${fluid.errors.length} / 警告 ${fluid.warnings.length}`);

  console.log('\n工艺区域分层与完整性校验（Phase 5）');
  console.log(
    `工艺区 ${areas.counts.areas} / 设备归属 ${areas.counts.equipment} / 管线归属 ${areas.counts.pipelines} / ` +
      `区域连接 ${areas.counts.links} / 入口管线 ${areas.counts.entryPipelines} / 出口管线 ${areas.counts.exitPipelines} / ` +
      `边界接口 ${areas.counts.boundaryPorts}`
  );
  console.log(
    `三维范围 ${areas.counts.bounds}/${areas.counts.areas} / 教学说明 ${areas.counts.teaching}/${areas.counts.areas} / ` +
      `喷枪 ${areas.counts.sprayGuns} 根（平行支路 ${areas.counts.sprayGunBranches}）/ 流线 ${areas.counts.flowStreams}`
  );
  for (const area of areas.areas) {
    console.log(
      `  ${area.def.no.toString().padStart(2, '0')} ${area.def.name}：设备 ${area.equipment.length} / 管线 ${area.pipelines.length} / ` +
        `上游 ${area.upstreamAreaIds.join(',') || '外部来料'} / 下游 ${area.downstreamAreaIds.join(',') || '厂外'} / ` +
        `范围 ${area.bounds ? area.bounds.size.map((value) => value.toFixed(1)).join('×') + ' m' : '缺失'}`
    );
  }
  console.log(`错误 ${areas.errors.length} / 警告 ${areas.warnings.length}`);

  const errors = [...result.errors, ...connection.errors, ...piping.errors, ...fluid.errors, ...areas.errors, ...phase6Errors];
  const warnings = [
    ...result.warnings,
    ...connection.warnings,
    ...piping.warnings,
    ...fluid.warnings,
    ...areas.warnings,
    ...playbackAudit.warnings.map((message) => ({ code: 'PLAYBACK', message }))
  ];

  if (errors.length > 0) {
    console.log('\n错误：');
    for (const issue of errors) console.log(`  [${issue.code}] ${issue.message}`);
  }
  if (warnings.length > 0) {
    console.log('\n警告（已显式标注的待确认项，不阻断通过）：');
    for (const issue of warnings) console.log(`  [${issue.code}] ${issue.message}`);
  }
  if (result.pending.length > 0) {
    console.log('\n待确认项：');
    for (const item of result.pending) console.log(`  - ${item}`);
  }

  if (!result.ok || !connection.ok || !piping.ok || !fluid.ok || !areas.ok || phase6Errors.length > 0) {
    console.log('\n结果：失败（数据关系、接口/连接关系、管道教学路由、流体传播、区域分层、工艺追踪或播放顺序存在错误，不能进入下一阶段）。');
    process.exitCode = 1;
  } else {
    console.log('\n结果：通过（数据关系完整；接口/连接一致；教学路由避开设备包络；流体传播符合阀门状态；区域归属与上下游完整；喷枪按二燃室四个平行支路挂接；上下游多分支与循环保护有效；15 步流程播放顺序与状态机正确；未提供的信息均已登记为待确认）。');
    process.exitCode = 0;
  }
} catch (error) {
  console.error('校验器执行失败：', error);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
