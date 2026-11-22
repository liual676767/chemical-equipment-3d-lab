/**
 * 微沸喷烧 Phase 7 核心设备内部结构预览验证。
 *
 * 启动临时 Vite 服务与 headless Edge，渲染 scripts/preview/boil-internals.html：
 * - 五种观察模式（正常/透明/X 射线/局部剖切/内部观察）与外壳材质、裁剪平面状态；
 * - 14 类教学模型 × 18 个流程实例映射、数据与几何部件逐项一致；
 * - 二燃室四根喷枪独立选择、结构树与三维拾取高亮；
 * - 回转窑/布袋除尘器/湿电除尘/引风机等关键内部结构与教学动画；
 * - 截图与报告输出；不接入站点路由、不发布。
 *
 * 运行：node scripts/verify-boil-internals.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = path.join(root, 'outputs', 'verify-boil-internals');
mkdirSync(outDir, { recursive: true });

const results = [];
const errors = [];
let browser;
let server;
let vite;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const { createServer } = await import('vite');
  const hmrPort = await new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.listen(0, '127.0.0.1', () => {
      const assigned = probe.address();
      const port = assigned && typeof assigned === 'object' ? assigned.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error('未能分配 HMR 端口'))));
    });
    probe.on('error', reject);
  });
  vite = await createServer({
    root,
    server: {
      middlewareMode: true,
      hmr: { host: '127.0.0.1', port: hmrPort },
      watch: { ignored: ['**/outputs/**', '**/dist/**', '**/dist-backup*/**', '**/project-backup*/**'] }
    }
  });
  server = createHttpServer(vite.middlewares);
  const listening = once(server, 'listening');
  server.listen({ host: '127.0.0.1', port: 0 });
  await listening;
  const address = server.address();
  assert.ok(address && typeof address === 'object', '临时服务未分配端口');
  const base = `http://127.0.0.1:${address.port}/`;

  browser = await chromium.launch({
    ...browserOptions,
    headless: true,
    args: [
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--disable-gpu-sandbox',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows'
    ]
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(180000);
  page.setDefaultNavigationTimeout(180000);
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });

  await page.goto(`${base}scripts/preview/boil-internals.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body[data-preview-ready="1"]', { timeout: 180000 });
  await wait(900);

  const state = () => page.evaluate(() => window.__boilInternals.getState());
  const call = (fn, ...args) => page.evaluate(({ fn, args }) => window.__boilInternals[fn](...args), { fn, args });
  const shot = async (name) => {
    await wait(420);
    await page.screenshot({ path: path.join(outDir, name) });
  };

  let s = await state();
  check('预览页就绪', Boolean(s.ready));
  check('18 个流程设备实例可选', s.equipmentList.length === 18, `实际 ${s.equipmentList.length}`);
  check('五种观察模式', s.modes.length === 5 && s.modes.map((m) => m.id).join(',') === 'normal,transparent,xray,cutaway,internal');
  check('HUD 标注教学示意', (await page.locator('#hud').innerText()).includes('教学示意'));

  check('内部结构覆盖 14 类模型', s.audit.models === 14, `实际 ${s.audit.models}`);
  check('数据与几何部件完全一致', s.audit.mismatches.length === 0, JSON.stringify(s.audit.mismatches));
  check('总部件数不少于 100', s.audit.totalParts >= 100, `实际 ${s.audit.totalParts}`);
  check('二燃室 10 个内部部件', s.parts.length === 10, `实际 ${s.parts.length}`);
  const gunIds = s.parts.filter((p) => p.kind === 'gun').map((p) => p.id);
  check('四根喷枪独立部件', gunIds.join(',') === 'gun-1,gun-2,gun-3,gun-4', gunIds.join(','));

  const defaultInfo = (await state()).modeInfo;
  check('默认正常外观：内部隐藏', defaultInfo.mode === 'normal' && !defaultInfo.internalsVisible && defaultInfo.shellVisible);
  await shot('01-secondary-normal.png');

  await call('setMode', 'transparent');
  s = await state();
  check('透明观察：内部可见、外壳半透明', s.modeInfo.internalsVisible && s.modeInfo.shellOpacity <= 0.2, `opacity=${s.modeInfo.shellOpacity}`);
  await shot('02-secondary-transparent.png');

  await call('setMode', 'xray');
  s = await state();
  check('X 射线：外壳线框幽灵', s.modeInfo.shellWireframe && s.modeInfo.internalsVisible);
  await shot('03-secondary-xray.png');

  await call('setMode', 'cutaway');
  s = await state();
  check('局部剖切：裁剪平面生效', s.modeInfo.clippingPlanes === 1 && s.modeInfo.internalsVisible, `planes=${s.modeInfo.clippingPlanes}`);
  await call('selectGun', 2);
  s = await state();
  check('喷枪 2 可独立选择', s.selectedPart === 'gun-2' && s.selectedDetail?.name === '喷枪 2');
  check('喷枪 2 标注待确认', s.selectedDetail?.status === 'pending-confirmation');
  check('选中部件有三维高亮框', s.modeInfo.highlighted === true);
  await page.click('[data-part-id="gun-3"]');
  s = await state();
  check('结构树点击喷枪 3 生效', s.selectedPart === 'gun-3');
  await call('setLabels', true);
  s = await state();
  check('部件标签可显示', s.labels.on && s.labels.visible > 0, `visible=${s.labels.visible}`);
  await shot('04-secondary-cutaway-gun3.png');

  await call('setMode', 'internal');
  s = await state();
  check('内部观察：外壳隐藏', !s.modeInfo.shellVisible && s.modeInfo.internalsVisible);
  await call('setAnimation', false);
  await shot('05-secondary-internal.png');

  await call('setMode', 'normal');
  s = await state();
  check('恢复正常外观', s.modeInfo.mode === 'normal' && !s.modeInfo.internalsVisible && !s.modeInfo.highlighted);

  await call('setEquipment', 'eq-rotary-kiln');
  await call('setMode', 'cutaway');
  s = await state();
  const kilnIds = s.parts.map((p) => p.id);
  check('回转窑 12 个内部部件', s.parts.length === 12, `实际 ${s.parts.length}`);
  check('回转窑含内衬与驱动结构', ['refractory-lining', 'support-rings', 'support-rollers', 'drive-ring', 'drive-motor', 'gas-flow'].every((id) => kilnIds.includes(id)));
  await shot('06-kiln-cutaway.png');

  await call('setEquipment', 'eq-baghouse');
  await call('setMode', 'transparent');
  s = await state();
  const bagPart = s.parts.find((p) => p.id === 'filter-bags');
  check('布袋除尘器 11 个内部部件', s.parts.length === 11, `实际 ${s.parts.length}`);
  check('滤袋组为 12 条教学布置', bagPart && bagPart.meshes >= 24, `meshes=${bagPart?.meshes}`);
  check('粉尘捕集示踪存在', s.parts.some((p) => p.id === 'dust-capture'));
  await shot('07-baghouse-transparent.png');

  await call('setEquipment', 'eq-wet-esp');
  await call('setMode', 'xray');
  s = await state();
  const plates = s.parts.find((p) => p.id === 'collecting-plates');
  const wires = s.parts.find((p) => p.id === 'discharge-wires');
  check('湿电除尘含极板与极线', plates?.meshes === 5 && wires?.meshes === 4, `plates=${plates?.meshes}, wires=${wires?.meshes}`);
  check('湿电除尘无电气参数文本', !/kV|kW|电流|电压\s*[0-9]/i.test(JSON.stringify(s.parts)));
  await shot('08-wet-esp-xray.png');

  await call('setEquipment', 'eq-quench-1');
  const quench1 = await state();
  await call('setEquipment', 'eq-quench-2');
  const quench2 = await state();
  check('集冷塔一/二为独立实例', quench1.equipment.id === 'eq-quench-1' && quench2.equipment.id === 'eq-quench-2' && quench1.equipment.name !== quench2.equipment.name);
  check('集冷塔 10 个内部部件', quench2.parts.length === 10, `实际 ${quench2.parts.length}`);
  await call('setMode', 'cutaway');
  await shot('09-quench-2-cutaway.png');

  await call('setEquipment', 'eq-stack');
  await call('setMode', 'internal');
  s = await state();
  check('烟囱含内筒与采样接口', s.parts.length === 5 && s.parts.some((p) => p.id === 'inner-flue') && s.parts.some((p) => p.id === 'sampling-port'));
  await shot('10-stack-internal.png');

  await call('setEquipment', 'eq-id-fan');
  await call('setMode', 'internal');
  await call('setAnimation', true);
  await wait(500);
  const position = await page.evaluate(() => window.__boilInternals.projectPart('impeller'));
  check('叶轮可投影到屏幕坐标', position && position.x > 620 && position.x < 1580 && position.y > 20 && position.y < 940, JSON.stringify(position));
  const picked = await page.evaluate(({ x, y }) => window.__boilInternals.pickAt(x, y), position);
  check('三维拾取命中内部部件', Boolean(picked), String(picked));
  if (position) {
    await page.mouse.click(position.x, position.y);
    await wait(250);
    const clicked = await state();
    check('点击三维部件可选中', clicked.selectedPart === picked, `clicked=${clicked.selectedPart}, picked=${picked}`);
  } else {
    check('点击三维部件可选中', false, '无投影坐标');
  }
  const snap1 = (await state()).animation.snapshot;
  await wait(650);
  const snap2 = (await state()).animation.snapshot;
  check('教学动画运行（叶轮旋转）', snap1.join(',') !== snap2.join(','), `${snap1} → ${snap2}`);
  await call('setAnimation', false);
  await wait(200);
  const snap3 = (await state()).animation.snapshot;
  await wait(550);
  const snap4 = (await state()).animation.snapshot;
  check('暂停动画后状态冻结', snap3.join(',') === snap4.join(','), `${snap3} → ${snap4}`);
  await call('setAnimation', true);
  await call('selectPart', 'impeller');
  await shot('11-id-fan-internal.png');

  let instancesOk = true;
  let instanceDetail = '';
  for (const eq of s.equipmentList) {
    await call('setEquipment', eq.id);
    const st = await state();
    if (!st.ready || st.equipment.id !== eq.id || st.parts.length < 4) {
      instancesOk = false;
      instanceDetail = `${eq.id} parts=${st.parts?.length}`;
      break;
    }
  }
  check('18 个实例均可加载内部结构', instancesOk, instanceDetail);

  s = await state();
  check('待确认部件有显式标注', s.parts.some((p) => p.status === 'pending-confirmation'));
  const pendingTotal = s.audit.totalParts >= 100;
  check('部件状态完整', pendingTotal);
  const hudText = await page.locator('#hud').innerText();
  check('模式说明包含剖切限制', hudText.includes('裁剪面未做封口填充'));
  check('预览页标注未接入站点路由', hudText.includes('未接入站点路由'));
  check('页面无脚本错误', errors.length === 0 && s.pageErrors.length === 0, [...errors, ...s.pageErrors].join(' | '));

  const shots = readdirSync(outDir).filter((name) => name.endsWith('.png'));
  check('关键场景截图已生成', shots.length >= 10, `${shots.length} 张`);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const report = {
    generatedAt: new Date().toISOString(),
    passed,
    failed,
    total: results.length,
    results,
    audit: s.audit,
    screenshots: shots.sort(),
    pageErrors: errors
  };
  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n结果：${passed}/${results.length} 通过`);
  if (failed > 0) {
    console.error(`失败 ${failed} 项，详见 ${path.join(outDir, 'report.json')}`);
    process.exitCode = 1;
  } else {
    console.log(`全部通过，截图与报告：${outDir}`);
    process.exitCode = 0;
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
  if (vite) await vite.close().catch(() => {});
}
