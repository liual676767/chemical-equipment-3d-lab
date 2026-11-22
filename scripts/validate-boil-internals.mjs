/**
 * 微沸喷烧 Phase 7 内部结构数据与几何一致性校验。
 *
 * 用 esbuild 打包 TypeScript 数据/引擎后执行：
 * - 14 类设备的内部结构定义、五种观察模式、部件 id/说明/待确认标注；
 * - 18 个流程设备实例全部映射到已登记的内部结构；
 * - 数据部件清单与参数化几何逐项一致（不多不少）；
 * - 二燃室四根喷枪为独立可选部件；集冷塔一/二、喷枪 1–4 为独立实例；
 * - 检查文本中不含疑似工程参数数值（温度/压力/流量/电气等）。
 *
 * 错误 → 退出码 1；通过 → 退出码 0。
 * 运行：node scripts/validate-boil-internals.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'chem3d-boil-internals-'));
const outfile = join(dir, 'boil-internals-check.mjs');

try {
  await build({
    stdin: {
      contents: `
        export { BOIL_PROCESS } from './src/data/boilProcess';
        export { BOIL_INTERNALS, OBSERVATION_MODES, auditInternalsDefinitions } from './src/data/boilInternals';
        export { buildInternalModel } from './src/engine/boilInternals';
      `,
      resolveDir: root,
      sourcefile: 'boil-internals-entry.ts',
      loader: 'ts'
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    outfile,
    logLevel: 'silent'
  });

  const { BOIL_PROCESS, BOIL_INTERNALS, OBSERVATION_MODES, auditInternalsDefinitions, buildInternalModel } = await import(pathToFileURL(outfile).href);

  const errors = [];
  const warnings = [];
  const audit = auditInternalsDefinitions();
  errors.push(...audit.errors);
  warnings.push(...audit.warnings);

  const expectedModes = ['normal', 'transparent', 'xray', 'cutaway', 'internal'];
  const modeIds = OBSERVATION_MODES.map((m) => m.id);
  for (const id of expectedModes) {
    if (!modeIds.includes(id)) errors.push(`缺少观察模式：${id}`);
  }

  const internalKeys = Object.keys(BOIL_INTERNALS);
  if (internalKeys.length !== 14) errors.push(`内部结构模型应为 14 类，实际 ${internalKeys.length}`);

  const instances = BOIL_PROCESS.equipment.filter((eq) => BOIL_INTERNALS[eq.modelKey]);
  if (instances.length !== 18) errors.push(`应覆盖 18 个流程设备实例，实际 ${instances.length}`);
  for (const eq of BOIL_PROCESS.equipment) {
    if (!BOIL_INTERNALS[eq.modelKey]) errors.push(`流程实例未覆盖内部结构：${eq.id}（${eq.modelKey}）`);
  }

  const gunInstances = instances.filter((eq) => eq.modelKey === 'spray-gun');
  if (gunInstances.length !== 4) errors.push(`喷枪实例应为 4 个，实际 ${gunInstances.length}`);
  const quenchInstances = instances.filter((eq) => eq.modelKey === 'quench-tower');
  if (quenchInstances.length !== 2) errors.push(`集冷塔实例应为 2 个，实际 ${quenchInstances.length}`);
  const chamber = BOIL_INTERNALS['secondary-chamber'];
  for (let i = 1; i <= 4; i += 1) {
    const gun = chamber.parts.find((p) => p.id === `gun-${i}`);
    if (!gun) errors.push(`二燃室缺少 gun-${i}`);
    else if (gun.status !== 'pending-confirmation') errors.push(`gun-${i} 未标注待确认`);
  }

  const rows = [];
  let geometryParts = 0;
  let geometryMeshes = 0;
  let animations = 0;
  for (const key of internalKeys) {
    const def = BOIL_INTERNALS[key];
    let built;
    try {
      built = buildInternalModel(key);
    } catch (err) {
      errors.push(`${key} 内部几何构建失败：${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const dataIds = def.parts.map((p) => p.id).sort();
    const geomIds = [...built.parts.keys()].sort();
    const missing = dataIds.filter((id) => !geomIds.includes(id));
    const extra = geomIds.filter((id) => !dataIds.includes(id));
    if (missing.length) errors.push(`${key} 缺少几何部件：${missing.join('、')}`);
    if (extra.length) errors.push(`${key} 存在未登记几何部件：${extra.join('、')}`);
    errors.push(...built.issues);
    if (built.shells.length === 0) errors.push(`${key} 未识别到外壳网格`);
    if (built.animations.length === 0) warnings.push(`${key} 没有教学动画`);
    let meshes = 0;
    for (const record of built.parts.values()) {
      if (record.meshes.length === 0) errors.push(`${key}.${record.def.id} 没有几何网格`);
      meshes += record.meshes.length;
    }
    geometryParts += built.parts.size;
    geometryMeshes += meshes;
    animations += built.animations.length;
    rows.push({ key, name: def.name, parts: built.parts.size, meshes, animations: built.animations.length, pending: def.parts.filter((p) => p.status === 'pending-confirmation').length });
  }

  if (errors.length === 0) {
    console.log('Phase 7 内部结构校验：通过');
    console.log(`  模型 ${internalKeys.length} 类 · 流程实例 ${instances.length} 个 · 观察模式 ${modeIds.length} 种`);
    console.log(`  部件 ${geometryParts} 个 · 网格 ${geometryMeshes} 个 · 教学动画 ${animations} 条`);
    console.log(`  待确认部件 ${audit.counts.pending} 个 · 缺口标注 ${audit.counts.pending}（按部件状态计）`);
    console.log('');
    console.log('设备模型              部件   网格   动画   待确认');
    for (const row of rows) {
      console.log(`${row.name.padEnd(10, '　')} ${String(row.parts).padStart(6)} ${String(row.meshes).padStart(6)} ${String(row.animations).padStart(6)} ${String(row.pending).padStart(7)}`);
    }
    if (warnings.length) {
      console.log('');
      console.log(`警告 ${warnings.length} 条（不阻断）：`);
      for (const warning of warnings) console.log(`  - ${warning}`);
    }
    console.log('');
    console.log('边界：全部内部结构为参数化教学示意，不是设备图纸；无温度/压力/流量/电气参数。');
    process.exitCode = 0;
  } else {
    console.error(`Phase 7 内部结构校验失败：${errors.length} 个错误`);
    for (const error of errors) console.error(`  ! ${error}`);
    if (warnings.length) {
      for (const warning of warnings) console.error(`  ~ ${warning}`);
    }
    process.exitCode = 1;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
