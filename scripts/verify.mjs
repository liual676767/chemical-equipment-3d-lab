import { chromium } from 'playwright-core';
import { browserOptions, webglArgs } from './browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.VERIFY_BASE ?? 'http://127.0.0.1:5173/';
const OUT = path.resolve('outputs/verify');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const consoleErrors = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  ...browserOptions,
  headless: true,
  args: [...webglArgs, '--disable-gpu-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion']
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(120000);
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text() + ' @' + (m.location()?.url ?? '')); });

const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), timeout: 60000 });
// 软件渲染下合成帧滞后，截图前强制两帧并等待过渡结束，避免截到旧高亮/入场动画中间态
const settle = async () => {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  await wait(600);
};
const state = () => page.evaluate(() => window.__chem3d?.scene.getPracticeState() ?? null);
// 工作台就绪等待：避免模块增多后固定等待偏短，在场景挂载前访问 window.__chem3d.scene。
const waitWorkbench = async () => {
  await page.waitForSelector('.canvas-wrap canvas', { timeout: 60000 });
  await page.waitForFunction(() => Boolean(window.__chem3d?.scene), null, { timeout: 60000 });
};
const clickTree = (id) => page.evaluate((pid) => {
  const name = window.__chem3d.device.parts.find((p) => p.id === pid).name;
  const item = [...document.querySelectorAll('.tree-item')].find((x) => x.querySelector('.tree-name')?.textContent === name);
  if (!item) throw new Error('tree item not found: ' + pid);
  item.click();
}, id);
const clickAction = (label) => page.evaluate((t) => {
  const b = [...document.querySelectorAll('.practice-actions button')].find((x) => x.textContent === t);
  if (!b) throw new Error('action button not found: ' + t);
  b.click();
}, label);
const clickTool = async (label) => {
  const view = page.locator('.wb-view-options button').filter({ hasText: label });
  if (await view.count()) {
    await page.locator('.tool-menu-btn').click();
    await view.click();
    return;
  }
  await page.evaluate((t) => {
  const b = [...document.querySelectorAll('.wb-bottom button, .canvas-toolbar button')].find((x) => x.textContent.trim() === t);
  if (!b) throw new Error('tool button not found: ' + t);
  b.click();
  }, label);
};
const clickTab = (label) => page.evaluate((t) => {
  const b = [...document.querySelectorAll('.mode-tab')].find((x) => x.textContent.includes(t));
  b.click();
}, label);
const lastToast = () => page.evaluate(() => {
  const t = [...document.querySelectorAll('.toast')].pop();
  return t ? t.textContent : '';
});
const collapseAndWait = async () => {
  await page.evaluate(() => { [...document.querySelectorAll('.wb-bottom button')].find((b) => b.textContent === '合拢复原').click(); });
  try {
    await page.waitForFunction(() => window.__chem3d.scene.getExplode() === 0, null, { timeout: 6000 });
  } catch {
    await page.evaluate(() => window.__chem3d.scene.setExplode(0));
  }
};
const setRange = (v) => page.evaluate((val) => {
  const r = document.querySelector('.wb-bottom input.range');
  r.value = String(val);
  r.dispatchEvent(new Event('input', { bubbles: true }));
}, v);
const screenPos = (world) => page.evaluate((w) => {
  const { scene } = window.__chem3d;
  scene.camera.updateMatrixWorld(true);
  const THREEv = scene.camera.position.clone().set(w[0], w[1], w[2]);
  THREEv.project(scene.camera);
  const rect = scene.renderer.domElement.getBoundingClientRect();
  return { x: rect.left + (THREEv.x * 0.5 + 0.5) * rect.width, y: rect.top + (-THREEv.y * 0.5 + 0.5) * rect.height };
}, world);
const partPos = (id) => page.evaluate((pid) => {
  const p = window.__chem3d.scene.parts.get(pid);
  return [p.group.position.x, p.group.position.y, p.group.position.z];
}, id);

/* ---------- 1 设备库首页（#/library） ---------- */
await page.goto(BASE + '#/library');
await wait(1200);
check('主导航包含五个入口', await page.evaluate(() => [...document.querySelectorAll('.site-links .site-link')].map((a) => a.textContent.trim()).join(',')) === '教学工厂,设备库,组装工坊,工艺流程,高精度模型库');
await page.click('.site-drop-btn');
await wait(250);
check('工艺流程菜单含全流程与微沸喷烧', await page.evaluate(() => [...document.querySelectorAll('.site-drop-label')].map((e) => e.textContent).join(',')) === '化工厂全流程装置,微沸喷烧全流程');
await page.keyboard.press('Escape');
await wait(200);
check('首页 18 张设备卡片', await page.evaluate(() => document.querySelectorAll('.device-card').length) === 18);
check('首页 18 张静态缩略图', await page.evaluate(() => document.querySelectorAll('.card-thumb').length) === 18);
check('首屏首行缩略图已加载', await page.evaluate(() => [...document.querySelectorAll('.card-thumb')].slice(0, 3).every((img) => img.complete && img.naturalWidth > 0)));
check('学习状态单一标记：13 台拆装已开放', await page.evaluate(() => [...document.querySelectorAll('.card-status')].filter((s) => s.textContent === '拆装练习已开放').length) === 13);
await shot('01-home-desktop');
await page.fill('.search-input', '叶轮');
check('搜索「叶轮」仅命中离心泵', await page.evaluate(() => [...document.querySelectorAll('.card-title')].map((e) => e.textContent).join()) === '单级离心泵');
await page.fill('.search-input', '球阀');
check('搜索「球阀」仅命中法兰球阀', await page.evaluate(() => [...document.querySelectorAll('.card-title')].map((e) => e.textContent).join()) === '法兰球阀');
await page.fill('.search-input', '储存设备');
check('搜索匹配分类「储存设备」', await page.evaluate(() => [...document.querySelectorAll('.card-title')].map((e) => e.textContent).join()) === '立式固定顶储罐');
await page.fill('.search-input', 'zzz');
check('搜索无结果显示空状态', await page.evaluate(() => !document.querySelector('.empty-state').hidden));
await page.click('.empty-state button');
check('清除筛选恢复 18 张卡片', await page.evaluate(() => document.querySelectorAll('.device-card').length) === 18);
await page.evaluate(() => [...document.querySelectorAll('.chip')].find((b) => b.textContent === '换热设备').click());
check('分类筛选换热设备=2（管壳式+板式）', await page.evaluate(() => document.querySelectorAll('.device-card').length) === 2);
await page.evaluate(() => [...document.querySelectorAll('.chip')].find((b) => b.textContent === '全部设备').click());
// 收藏与分类、搜索叠加
await page.evaluate(() => { document.querySelector('.device-card[data-device-id="pump"] .fav-btn').click(); });
await page.evaluate(() => { document.querySelector('.chip-fav').click(); });
await wait(200);
check('只看收藏叠加后仅显示收藏设备', await page.evaluate(() => document.querySelectorAll('.device-card').length) === 1);
await page.evaluate(() => [...document.querySelectorAll('.chip')].find((b) => b.textContent === '换热设备').click());
await wait(200);
check('收藏+分类组合无结果显示清除筛选', await page.evaluate(() => document.querySelectorAll('.device-card').length === 0 && !document.querySelector('.empty-state').hidden && document.querySelector('.empty-state button')?.textContent === '清除筛选'));
await page.click('.empty-state button');
await wait(200);
await page.evaluate(() => { document.querySelector('.device-card[data-device-id="pump"] .fav-btn').click(); });

/* ---------- 2 工作台观察 ---------- */
const tEnter = Date.now();
await page.evaluate(() => { [...document.querySelectorAll('.card-enter')][0].click(); });
await waitWorkbench();
const loadMs = Date.now() - tEnter;
await wait(1200);
check('工作台加载时间（软件渲染环境）', loadMs < 10000, `${loadMs}ms`);
check('进入泵工作台且 WebGL 正常', await page.evaluate(() => !!document.querySelector('.canvas-wrap canvas') && document.querySelector('.webgl-fallback').style.display === 'none'));
check('工作台标注「教学示意模型」', await page.evaluate(() => [...document.querySelectorAll('.badge-model')].some((b) => b.textContent === '教学示意模型')));
await shot('02-pump-observe');
await clickTree('impeller');
await wait(700);
check('目录选择叶轮联动说明面板', await page.evaluate(() => document.querySelector('.info-part-name')?.textContent) === '叶轮');
await shot('03-pump-part-selected');
await clickTool('复位视角');
await wait(1000);
const motorScreen = await page.evaluate(() => {
  const { scene } = window.__chem3d;
  scene.camera.updateMatrixWorld(true);
  const p = scene.parts.get('motor');
  const v = p.group.position.clone(); v.y += 0.2; v.project(scene.camera);
  const rect = scene.renderer.domElement.getBoundingClientRect();
  return { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height };
});
await page.mouse.click(motorScreen.x, motorScreen.y);
await wait(400);
check('点击三维模型选中电机', await page.evaluate(() => document.querySelector('.info-part-name')?.textContent) === '电机');
await clickTool('俯视');
await wait(800);
await shot('04-pump-top-view');
await clickTool('复位视角');
await wait(800);

/* ---------- 3 剖视 ---------- */
await clickTab('剖视');
await wait(400);
await setRange(45);
await wait(400);
await shot('05-pump-section');
check('剖视模式生效（剖切面可见）', await page.evaluate(() => window.__chem3d.scene.sectionActive === true));
check('当前模式标识同步为剖视', await page.evaluate(() => document.querySelector('.canvas-mode-name')?.textContent === '剖视'));
await page.evaluate(() => { [...document.querySelectorAll('.wb-bottom button')].find((b) => b.textContent === '上下剖 (Y)').click(); });
await setRange(55);
await wait(300);
await shot('06-pump-section-y');
await page.evaluate(() => { [...document.querySelectorAll('.wb-bottom button')].find((b) => b.textContent.includes('退出剖视')).click(); });
await wait(300);
check('退出剖视恢复完整设备', await page.evaluate(() => window.__chem3d.scene.sectionActive === false && window.__chem3d.scene.mode === 'observe'));

/* ---------- 4 透明 ---------- */
await clickTab('透明观察');
await wait(300);
await setRange(85);
await wait(300);
await shot('07-pump-xray');
check('透明模式外壳半透明、内部不透明', await page.evaluate(() => {
  const s = window.__chem3d.scene;
  const shell = s.parts.get('casing').materials[0];
  const inner = s.parts.get('impeller').materials[0];
  return shell.transparent && shell.opacity < 0.3 && !inner.transparent;
}));
await page.evaluate(() => { [...document.querySelectorAll('.wb-bottom button')].find((b) => b.textContent === '隐藏外壳').click(); });
await wait(300);
check('隐藏外壳后内部仍可见', await page.evaluate(() => !window.__chem3d.scene.parts.get('casing').group.visible && window.__chem3d.scene.parts.get('impeller').group.visible));
await shot('08-pump-shell-hidden');
await page.evaluate(() => { [...document.querySelectorAll('.wb-bottom button')].find((b) => b.textContent.includes('退出透明')).click(); });

/* ---------- 5 爆炸 ---------- */
await clickTab('爆炸图');
await wait(300);
await setRange(100);
await wait(500);
await shot('09-pump-explode-100');
check('爆炸 100% 引导线可见', await page.evaluate(() => window.__chem3d.scene.guideLines.visible));
await page.evaluate(() => { [...document.querySelectorAll('.wb-bottom button')].find((b) => b.textContent === '合拢复原').click(); });
await page.waitForFunction(() => window.__chem3d.scene.getExplode() === 0, null, { timeout: 10000 });
await wait(300);
const explodeBack = await page.evaluate(() => {
  const s = window.__chem3d.scene;
  return [...s.parts.values()].every((p) => {
    const d = p.def.pos;
    return Math.abs(p.group.position.x - d[0]) < 1e-6 && Math.abs(p.group.position.y - d[1]) < 1e-6 && Math.abs(p.group.position.z - d[2]) < 1e-6;
  });
});
check('合拢后所有零件精确回到装配原位', explodeBack);
await shot('10-pump-explode-restored');

/* ---------- 6 原理 ---------- */
await clickTab('工作原理');
await wait(1200);
await shot('11-pump-principle');
check('原理动画粒子可见', await page.evaluate(() => window.__chem3d.scene.principle.object3d.visible && window.__chem3d.scene.principle.object3d.children.length > 0));
await page.evaluate(() => { [...document.querySelectorAll('.wb-bottom button')].find((b) => b.textContent === '暂停').click(); });
check('原理暂停按钮切换为播放', await page.evaluate(() => [...document.querySelectorAll('.wb-bottom button')].some((b) => b.textContent === '播放')));
await page.evaluate(() => { [...document.querySelectorAll('.wb-bottom button')].find((b) => b.textContent === '播放').click(); });

/* ---------- 7 引导拆装 ---------- */
await clickTab('拆装练习');
await wait(600);
check('引导学习初始为完整装配', await page.evaluate(() => window.__chem3d.scene.getPracticeState().installed.length === window.__chem3d.device.parts.length));
check('右侧显示练习步骤并高亮当前步', await page.evaluate(() => document.querySelectorAll('.step-item').length === 16 && !!document.querySelector('.step-item.current')));
await shot('12-practice-guided-start');
// 错误：第一步试图拆泵壳
await clickTree('casing');
await clickAction('拆下选中零件');
await wait(300);
check('引导模式错误操作被拦截并提示', (await lastToast()).includes('引导模式'));
check('错误计数=1', (await state()).errors === 1);
// 正确：拆联轴器
await clickTree('coupling');
await clickAction('拆下选中零件');
await wait(600);
check('第一步拆下联轴器进入第二步', (await state()).stepIndex === 1);
// 撤销
await page.evaluate(() => { [...document.querySelectorAll('.wb-bottom button')].find((b) => b.textContent.includes('撤销')).click(); });
await wait(600);
check('撤销回到第一步', (await state()).stepIndex === 0 && (await state()).installed.includes('coupling'));
await clickTree('coupling');
await clickAction('拆下选中零件');
await wait(500);
// 提示一次
await page.evaluate(() => { [...document.querySelectorAll('.wb-bottom button')].find((b) => b.textContent.includes('提示')).click(); });
await wait(300);
check('提示计数=1', (await state()).hints === 1);
// 完成剩余引导步骤
for (let guard = 0; guard < 20; guard++) {
  const s = await state();
  if (s.completed) break;
  const step = s.steps[s.stepIndex];
  await clickTree(step.partId);
  await wait(120);
  if (step.action === 'remove') {
    await clickAction('拆下选中零件');
  } else {
    const orient = await page.evaluate((pid) => window.__chem3d.device.parts.find((p) => p.id === pid).orientable, step.partId);
    if (orient) { for (let i = 0; i < 3; i++) { await clickAction('旋转 90°'); await wait(60); } }
    await clickAction('安装到位置');
  }
  await wait(500);
}
const gs = await state();
check('引导流程 16 步全部完成', gs.completed && gs.stepIndex === 16, `steps=${gs.stepIndex}`);
check('完成弹窗显示统计与需重学步骤', await page.evaluate(() => document.querySelector('.completion-overlay').style.display !== 'none' && !!document.querySelector('.error-steps')));
await settle();
await shot('13-practice-completion');
check('完成记录写入本地存储', await page.evaluate(() => JSON.parse(localStorage.getItem('chem3d-lab:v1')).devices.pump.completions >= 1));

/* ---------- 8 自由练习 + 拖拽 + 刷新恢复 ---------- */
await page.evaluate(() => { [...document.querySelectorAll('.completion-btns button')].find((b) => b.textContent === '重新练习').click(); });
await wait(500);
await page.evaluate(() => { [...document.querySelectorAll('.practice-mode-switch button')].find((b) => b.textContent === '自由练习').click(); });
await wait(500);
// 拆下全部
const order = await page.evaluate(() => [...window.__chem3d.device.assemblyOrder].reverse());
for (const id of order) {
  await clickTree(id);
  await wait(100);
  await clickAction('拆下选中零件');
  await wait(450);
}
check('自由练习拆下全部 8 个可拆零件', (await state()).installed.length === (await page.evaluate(() => window.__chem3d.device.parts.length - window.__chem3d.device.assemblyOrder.length)));
// 刷新恢复
await page.reload();
await waitWorkbench();
await wait(1200);
await clickTab('拆装练习');
await wait(600);
check('刷新后自动恢复练习进度', (await lastToast()).includes('恢复') && (await state()).totalRemovals === 8);
await shot('14-practice-resumed');
// 先装泵壳（motor 的前置），便于后续方向/距离错误测试
await clickTree('casing');
await wait(150);
await clickAction('安装到位置');
await wait(500);
// 拖拽错误：motor 拖到 casing 安装位（先居中保证零件区与设备都在视野内）
await clickTool('复位视角');
await wait(1000);
const motorTray = await partPos('motor');
const casingTarget = await page.evaluate(() => window.__chem3d.device.parts.find((p) => p.id === 'casing').pos);
const a = await screenPos([motorTray[0], motorTray[1] + 0.2, motorTray[2]]);
const b = await screenPos([casingTarget[0], casingTarget[1] + 0.2, casingTarget[2]]);
console.log('drag1 coords', JSON.stringify({ a, b, motorTray }));
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.mouse.move(a.x + 8, a.y + 4, { steps: 2 });
await page.mouse.move(b.x, b.y, { steps: 15 });
console.log('drag1 mid', JSON.stringify(await page.evaluate(() => {
  const s = window.__chem3d.scene;
  const p = s.parts.get('motor').group.position;
  return { dragging: s.dragging, dragPart: s.dragPart?.def.id ?? null, pos: [p.x.toFixed(2), p.y.toFixed(2), p.z.toFixed(2)] };
})));
await page.mouse.up();
await wait(700);
console.log('drag1 toast', await lastToast());
check('拖到错误安装位提示「不属于此安装位置」', (await lastToast()).includes('不属于此安装位置'));
check('错位提示附下一步操作', (await lastToast()).includes('请把') && (await lastToast()).includes('虚线轮廓'));
// 方向错误（rotStep=1）
await clickTree('motor');
await wait(200);
await clickAction('安装到位置');
await wait(400);
check('方向不匹配被拦截', (await lastToast()).includes('方向不匹配'));
check('方向提示附下一步操作', (await lastToast()).includes('旋转 90°'));
// 转回 0° 后做距离错误测试
for (let i = 0; i < 3; i++) { await clickAction('旋转 90°'); await wait(60); }
await clickTool('复位视角');
await wait(1000);
const far = await screenPos([0.2, 0.3, 2.2]);
const a2 = await screenPos(await partPos('motor').then((p) => [p[0], p[1] + 0.2, p[2]]));
console.log('drag2 coords', JSON.stringify({ a2, far }));
await page.mouse.move(a2.x, a2.y);
await page.mouse.down();
await page.mouse.move(a2.x + 8, a2.y + 4, { steps: 2 });
await page.mouse.move(far.x, far.y, { steps: 12 });
await page.mouse.up();
await wait(700);
console.log('drag2 toast', await lastToast());
check('距离过远提示靠近安装位置', (await lastToast()).includes('位置还不够接近'));
check('距离提示附下一步操作', (await lastToast()).includes('安装到位置'));
// 正确拖拽吸附：motor 拖到自身安装位
await clickTool('复位视角');
await wait(1000);
const motorTarget = await page.evaluate(() => window.__chem3d.device.parts.find((p) => p.id === 'motor').pos);
const a3 = await screenPos(await partPos('motor').then((p) => [p[0], p[1] + 0.2, p[2]]));
const b3 = await screenPos([motorTarget[0], motorTarget[1] + 0.2, motorTarget[2]]);
console.log('drag3 coords', JSON.stringify({ a3, b3 }));
await page.mouse.move(a3.x, a3.y);
await page.mouse.down();
await page.mouse.move(a3.x + 8, a3.y + 4, { steps: 2 });
await page.mouse.move(b3.x, b3.y, { steps: 15 });
await page.mouse.up();
await wait(800);
console.log('drag3 toast', await lastToast());
const motorInstalled = await page.evaluate(() => {
  const s = window.__chem3d.scene;
  const p = s.parts.get('motor');
  const d = p.def.pos;
  return p.state === 'installed' && Math.abs(p.group.position.x - d[0]) < 0.01 && Math.abs(p.group.position.z - d[2]) < 0.01;
});
check('正确拖拽自动吸附到安装位', motorInstalled);
await shot('15-practice-drag-snap');
// 前置依赖错误：coupling 需 motor+shaft，shaft 未装
await clickTree('coupling');
await wait(150);
for (let i = 0; i < 3; i++) { await clickAction('旋转 90°'); await wait(50); }
await clickAction('安装到位置');
await wait(400);
check('前置部件未完成被拦截', (await lastToast()).includes('请先安装前置部件'));
check('前置提示附下一步操作', (await lastToast()).includes('可在零件区先选中'));
// 装完其余
for (let guard = 0; guard < 12; guard++) {
  const s = await state();
  if (s.completed) break;
  const next = await page.evaluate(() => {
    const s = window.__chem3d.scene;
    const cand = [...s.parts.values()].find((p) => p.def.removable && p.state === 'tray' && (p.def.prereq ?? []).every((id) => s.parts.get(id).state === 'installed'));
    return cand ? cand.def.id : null;
  });
  if (!next) break;
  await clickTree(next);
  await wait(120);
  const orient = await page.evaluate((pid) => window.__chem3d.device.parts.find((p) => p.id === pid).orientable, next);
  if (orient) {
    const rs = await page.evaluate((pid) => window.__chem3d.scene.parts.get(pid).rotStep, next);
    for (let i = 0; i < (4 - rs) % 4; i++) { await clickAction('旋转 90°'); await wait(50); }
  }
  await clickAction('安装到位置');
  await wait(450);
}
const fs2 = await state();
check('自由练习完成（独立完成）', fs2.completed && !fs2.assisted, `errors=${fs2.errors} hints=${fs2.hints}`);
await settle();
await shot('16-practice-free-completion');

/* ---------- 8.5 学习任务 / 画质 / 反馈 / 记录管理 ---------- */
check('完成练习自动记录观察任务', await page.evaluate(() => JSON.parse(localStorage.getItem('chem3d-lab:v1')).devices.pump.tasks?.['p-practice'] === true));
await page.evaluate(() => { [...document.querySelectorAll('.completion-btns button')].find((b) => b.textContent === '返回观察').click(); });
await wait(600);
check('总览显示学习目标与观察任务清单', await page.evaluate(() => {
  const hs = [...document.querySelectorAll('.info-h4')].map((h) => h.textContent);
  return hs.includes('学习目标') && hs.some((h) => h.startsWith('观察任务（手动 1/5') && h.includes('自测 0/1'));
}));
check('自动任务勾选框禁用且已勾选', await page.evaluate(() => {
  const r = [...document.querySelectorAll('.task-row')].find((x) => x.textContent.includes('完成练习后自动记录'));
  const cb = r?.querySelector('input');
  return !!cb && cb.disabled && cb.checked;
}));
await settle();
await shot('28-task-checklist');
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.task-row')].find((r) => r.textContent.includes('用透明观察查看蜗壳内部流道'));
  row.querySelector('input').click();
});
await wait(200);
check('观察任务勾选写入本地存储', await page.evaluate(() => JSON.parse(localStorage.getItem('chem3d-lab:v1')).devices.pump.tasks?.['p-xray-casing'] === true));
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.task-row')].find((r) => r.textContent.includes('用透明观察查看蜗壳内部流道'));
  row.querySelector('.task-go').click();
});
await wait(600);
check('任务「前往」跳转透明模式并选中蜗壳', await page.evaluate(() => window.__chem3d.scene.mode === 'xray' && window.__chem3d.scene.selected === 'casing'));
await clickTab('整体观察');
await wait(400);
check('目录角色标签（固定/可拆）', await page.evaluate(() => {
  const tags = [...document.querySelectorAll('.tree-tag')].map((t) => t.textContent);
  return tags.includes('固定') && tags.includes('可拆');
}));
await clickTree('base');
await wait(400);
check('零件信息含角色与连接方式徽章', await page.evaluate(() => {
  const t = [...document.querySelectorAll('.info-tags .badge')].map((b) => b.textContent);
  return t.includes('固定结构') && t.includes('基础固定');
}));
// 画质等低频设置集中在工具菜单
await page.evaluate(() => document.querySelector('.tool-menu-btn').click());
await wait(200);
check('工具菜单集中低频设置', await page.evaluate(() => {
  const t = document.querySelector('.tool-menu-pop')?.textContent ?? '';
  return ['零件标注', '画质', '全屏查看', '学习记录', '操作帮助'].every((x) => t.includes(x));
}));
await page.evaluate(() => { [...document.querySelectorAll('.tool-menu-pop button')].find((b) => b.getAttribute('aria-label')?.startsWith('画质')).click(); });
await wait(300);
check('低画质：像素比=1 且阴影关闭', await page.evaluate(() => {
  const r = window.__chem3d.scene.renderer;
  return r.getPixelRatio() === 1 && r.shadowMap.enabled === false;
}));
check('画质选择写入本地存储', await page.evaluate(() => localStorage.getItem('chem3d-lab:quality') === 'low'));
await page.evaluate(() => { [...document.querySelectorAll('.tool-menu-pop button')].find((b) => b.getAttribute('aria-label')?.startsWith('画质')).click(); });
await wait(300);
check('切回高画质恢复阴影', await page.evaluate(() => window.__chem3d.scene.renderer.shadowMap.enabled === true));
await page.keyboard.press('Escape');
// 反馈入口
const pumpVersion = await page.evaluate(() => window.__chem3d.device.contentVersion);
await page.evaluate(() => document.querySelector('.wb-top-actions button[title="问题反馈"]').click());
await wait(300);
check('反馈对话框带设备/模式/版本上下文', await page.evaluate((ver) => {
  const c = document.querySelector('.feedback-context');
  return !!c && c.textContent.includes('单级离心泵') && c.textContent.includes('整体观察') && c.textContent.includes(ver);
}, pumpVersion), pumpVersion);
await page.fill('.feedback-input', '验收测试反馈：叶轮说明清晰。');
await page.evaluate(() => { [...document.querySelectorAll('.modal-card button')].find((b) => b.textContent === '提交反馈').click(); });
await wait(300);
check('反馈保存到本地并带上下文', await page.evaluate((ver) => {
  const fb = JSON.parse(localStorage.getItem('chem3d-lab:v1')).feedback;
  const f = fb[fb.length - 1];
  return !!f && f.deviceId === 'pump' && f.mode === 'observe' && f.contentVersion === ver && f.text.includes('验收测试');
}, pumpVersion), pumpVersion);
await wait(1200);
// 记录管理（设备库入口）
await page.goto(BASE + '#/library');
await wait(1200);
await page.evaluate(() => { [...document.querySelectorAll('.home-header button')].find((b) => b.textContent === '学习记录').click(); });
await wait(300);
check('记录管理说明本地存储与版本规则', await page.evaluate(() => document.querySelector('.modal-note')?.textContent.includes('当前浏览器')));
check('记录汇总含完成次数', await page.evaluate(() => document.querySelector('.records-summary')?.textContent.includes('累计完成练习 2 次')));
await settle();
await shot('29-records-dialog');
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.evaluate(() => { [...document.querySelectorAll('.modal-card button')].find((b) => b.textContent === '导出记录（JSON）').click(); })
]);
const dlPath = path.join(OUT, 'records-export-test.json');
await download.saveAs(dlPath);
const exported = JSON.parse(fs.readFileSync(dlPath, 'utf8'));
check('导出 JSON 含 app 标识/设备/反馈', exported.app === 'chem3d-lab' && !!exported.devices.pump && exported.feedback.length >= 1);
await page.setInputFiles('.records-import input[type=file]', dlPath);
await wait(500);
check('导入成功提示', await page.evaluate(() => document.querySelector('.modal-msg')?.textContent.includes('导入成功')));
await page.evaluate(() => { [...document.querySelectorAll('.modal-card button')].find((b) => b.textContent === '清除全部记录').click(); });
await wait(150);
check('清除需二次确认（首次点击不清空）', await page.evaluate(() => {
  const armed = [...document.querySelectorAll('.modal-card button')].some((b) => b.textContent === '再次点击确认清除');
  const s = JSON.parse(localStorage.getItem('chem3d-lab:v1'));
  return armed && s.devices.pump?.completions >= 1;
}));
await page.evaluate(() => { [...document.querySelectorAll('.modal-card button')].find((b) => b.textContent === '再次点击确认清除').click(); });
await wait(300);
check('二次确认后记录清空', await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('chem3d-lab:v1'));
  return Object.values(s.devices).every((r) => !r.completions && !r.favorite && !r.practice) && s.feedback.length === 0;
}));
await page.keyboard.press('Escape');
await wait(200);
// 旧内容版本进度不兼容（先让工作台挂载，再注入旧记录并整页刷新，避免内存态覆盖注入）
await page.goto(BASE + '#/device/pump');
await waitWorkbench();
await wait(800);
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('chem3d-lab:v1'));
  s.devices.pump = {
    favorite: false, lastVisited: Date.now(), completions: 0,
    practice: { mode: 'guided', completed: false, installed: [], stepIndex: 0 },
    contentVersion: '2026-01-01.1'
  };
  localStorage.setItem('chem3d-lab:v1', JSON.stringify(s));
});
await page.reload();
await waitWorkbench();
await wait(1000);
await clickTab('拆装练习');
await wait(600);
check('旧版本进度不兼容提示并重新开始', (await lastToast()).includes('不兼容') && (await state()).installed.length === (await page.evaluate(() => window.__chem3d.device.parts.length)));
await clickTab('整体观察');
await wait(300);

/* ---------- 9 其他设备 ---------- */
await page.goto(BASE + '#/device/exchanger');
await waitWorkbench();
await wait(800);
check('换热器工作台加载', await page.evaluate(() => window.__chem3d?.device.id === 'exchanger'));
check('换热器焊接件标为「展开」、鞍座「固定」', await page.evaluate(() => {
  const tags = [...document.querySelectorAll('.tree-tag')].map((t) => t.textContent);
  return tags.includes('展开') && tags.includes('固定');
}));
await clickTree('shell');
await wait(400);
check('焊接件信息含「仅用于结构展开」徽章', await page.evaluate(() => {
  const t = [...document.querySelectorAll('.info-tags .badge')].map((b) => b.textContent);
  return t.includes('仅用于结构展开') && t.includes('焊接连接');
}));
await shot('17-exchanger-observe');
await clickTab('拆装练习');
await wait(300);
check('换热器拆装标记开发中并提示', (await lastToast()).includes('开发中'));
await clickTab('剖视');
await setRange(50);
await wait(400);
await shot('18-exchanger-section');
await clickTab('爆炸图');
await setRange(100);
await wait(500);
await shot('19-exchanger-explode');
await clickTab('工作原理');
await wait(1200);
await settle();
await shot('20-exchanger-principle');
check('换热器双色流路粒子', await page.evaluate(() => {
  let n = 0;
  window.__chem3d.scene.principle.object3d.traverse((o) => { if (o.isMesh) n++; });
  return n >= 28;
}));

await page.goto(BASE + '#/device/reactor');
await waitWorkbench();
await wait(900);
check('反应釜工作台加载', await page.evaluate(() => window.__chem3d?.device.id === 'reactor'));
await clickTab('透明观察');
await setRange(80);
await wait(400);
await shot('21-reactor-xray');
await clickTab('工作原理');
await wait(1200);
await settle();
await shot('22-reactor-principle');
await clickTab('爆炸图');
await setRange(100);
await wait(500);
await shot('23-reactor-explode');
// 连续切换模式后状态一致
await clickTab('整体观察');
await wait(400);
check('切换设备与模式后选择状态清空一致', await page.evaluate(() => window.__chem3d.scene.selected === null && window.__chem3d.scene.getExplode() === 0));

/* ---------- 9.5 全部 18 台设备：加载 / 爆炸精确复原 / 原理动画 ---------- */
const ALL_DEVICES = [
  ['pump', 40], ['exchanger', 12], ['reactor', 10],
  ['ball-valve', 9], ['gate-valve', 8], ['butterfly-valve', 6], ['check-valve', 7],
  ['gear-pump', 7], ['diaphragm-pump', 9], ['plate-exchanger', 6],
  ['bag-filter', 7], ['y-strainer', 6], ['fixed-roof-tank', 8],
  ['gas-separator', 7], ['packed-tower', 7], ['cyclone-separator', 6],
  ['screw-compressor', 8], ['emf-meter', 6]
];
for (const [id, partCount] of ALL_DEVICES) {
  await page.goto(BASE + '#/device/' + id);
  await waitWorkbench();
  await wait(700);
  const loaded = await page.evaluate(() => ({
    id: window.__chem3d?.device.id ?? null,
    parts: window.__chem3d?.scene.parts.size ?? 0,
    canvas: !!document.querySelector('.canvas-wrap canvas'),
    fallback: document.querySelector('.webgl-fallback')?.style.display !== 'none',
    demoBadge: [...document.querySelectorAll('.badge-model')].some((b) => b.textContent === '教学示意模型')
  }));
  check(`${id} 工作台加载 / 零件数 / 教学示意标注`, loaded.id === id && loaded.parts === partCount && loaded.canvas && !loaded.fallback && loaded.demoBadge, JSON.stringify(loaded));
  await clickTab('爆炸图');
  await wait(300);
  await setRange(100);
  await wait(450);
  if (id === 'diaphragm-pump') await shot('32-diaphragm-pump-explode');
  await collapseAndWait();
  const back = await page.evaluate(() => [...window.__chem3d.scene.parts.values()].every((p) => {
    const d = p.def.pos;
    return Math.abs(p.group.position.x - d[0]) < 1e-6 && Math.abs(p.group.position.y - d[1]) < 1e-6 && Math.abs(p.group.position.z - d[2]) < 1e-6;
  }));
  check(`${id} 爆炸后合拢精确复原`, back);
  await clickTab('工作原理');
  await wait(1000);
  const pr = await page.evaluate(() => ({ vis: window.__chem3d.scene.principle.object3d.visible, n: window.__chem3d.scene.principle.object3d.children.length }));
  check(`${id} 原理动画运行`, pr.vis && pr.n > 0, JSON.stringify(pr));
  if (id === 'gear-pump') await shot('31-gear-pump-principle');
  if (id === 'packed-tower') await shot('34-packed-tower-principle');
  if (id === 'cyclone-separator') await shot('35-cyclone-principle');
  await clickTab('整体观察');
  await wait(300);
  if (id === 'ball-valve') await shot('30-ball-valve-observe');
  if (id === 'plate-exchanger') await shot('33-plate-exchanger-observe');
  if (id === 'emf-meter') await shot('36-emf-observe');
}

/* ---------- 9.6 新设备结构专属互动 ---------- */
await page.goto(BASE + '#/device/ball-valve');
await waitWorkbench();
await wait(700);
check('球阀观察模式含「阀门开度」互动滑杆', await page.evaluate(() => document.querySelector('.wb-bottom')?.textContent.includes('阀门开度')));
const ballRot = await page.evaluate(() => {
  const s = window.__chem3d.scene;
  const before = s.parts.get('ball').group.rotation.y;
  s.setInteraction(1);
  const delta = s.parts.get('ball').group.rotation.y - before;
  const handleMoved = Math.abs(s.parts.get('handle').group.rotation.y - before) > 1;
  s.setInteraction(0);
  return { delta, handleMoved, restored: Math.abs(s.parts.get('ball').group.rotation.y - before) < 1e-6 };
});
check('球阀开度互动：阀球与手柄转 90° 且可复原', Math.abs(ballRot.delta - Math.PI / 2) < 1e-3 && ballRot.handleMoved && ballRot.restored, JSON.stringify(ballRot));

await page.goto(BASE + '#/device/gate-valve');
await waitWorkbench();
await wait(700);
const gateLift = await page.evaluate(() => {
  const s = window.__chem3d.scene;
  const g0 = s.parts.get('gate').group.position.y;
  const st0 = s.parts.get('stem').group.position.y;
  s.setInteraction(1);
  const dGate = s.parts.get('gate').group.position.y - g0;
  const dStem = s.parts.get('stem').group.position.y - st0;
  s.setInteraction(0);
  return { dGate, dStem, restored: Math.abs(s.parts.get('gate').group.position.y - g0) < 1e-6 };
});
check('闸阀行程互动：明杆随闸板同步升降', Math.abs(gateLift.dGate - 0.3) < 1e-3 && Math.abs(gateLift.dStem - 0.3) < 1e-3 && gateLift.restored, JSON.stringify(gateLift));

await page.goto(BASE + '#/device/gear-pump');
await waitWorkbench();
await wait(700);
const gears = await page.evaluate(() => {
  const s = window.__chem3d.scene;
  const a0 = s.parts.get('driveGear').group.rotation.x;
  const b0 = s.parts.get('idlerGear').group.rotation.x;
  s.setInteraction(0.25);
  const da = s.parts.get('driveGear').group.rotation.x - a0;
  const db = s.parts.get('idlerGear').group.rotation.x - b0;
  s.setInteraction(0);
  return { da, db };
});
check('齿轮泵互动：主/从动齿轮反向啮合旋转', gears.da > 1.5 && gears.db < -1.5, JSON.stringify(gears));

await page.goto(BASE + '#/device/bag-filter');
await waitWorkbench();
await wait(700);
const bagSeq = await page.evaluate(() => {
  const s = window.__chem3d.scene;
  const c0 = s.parts.get('cover').group.position.y;
  const b0 = s.parts.get('bag').group.position.y;
  s.setInteraction(0.3);
  const coverFirst = s.parts.get('cover').group.position.y > c0 + 0.1 && Math.abs(s.parts.get('bag').group.position.y - b0) < 1e-6;
  s.setInteraction(1);
  const bagLift = Math.abs(s.parts.get('bag').group.position.y - b0 - 0.75) < 1e-3;
  s.setInteraction(0);
  return { coverFirst, bagLift };
});
check('袋式过滤器互动：先开盖后提袋', bagSeq.coverFirst && bagSeq.bagLift, JSON.stringify(bagSeq));

await page.goto(BASE + '#/device/cyclone-separator');
await waitWorkbench();
await wait(700);
await clickTab('拆装练习');
await wait(300);
check('旋风分离器拆装标记开发中并提示', (await lastToast()).includes('开发中'));
await clickTab('整体观察');
await wait(300);

/* ---------- 9.7 新设备引导式拆装全流程（球阀 / 齿轮泵） ---------- */
async function guidedPractice(id, installedCount, stepCount, shotName) {
  await page.goto(BASE + '#/device/' + id);
  await waitWorkbench();
  await wait(800);
  await clickTab('拆装练习');
  await wait(600);
  check(`${id} 引导初始为完整装配`, (await state()).installed.length === installedCount);
  for (let guard = 0; guard < 40; guard++) {
    const s = await state();
    if (s.completed) break;
    const step = s.steps[s.stepIndex];
    await clickTree(step.partId);
    await wait(100);
    if (step.action === 'remove') {
      await clickAction('拆下选中零件');
    } else {
      const orient = await page.evaluate((pid) => window.__chem3d.device.parts.find((p) => p.id === pid).orientable, step.partId);
      if (orient) {
        const rs = await page.evaluate((pid) => window.__chem3d.scene.parts.get(pid).rotStep, step.partId);
        for (let i = 0; i < (4 - rs) % 4; i++) { await clickAction('旋转 90°'); await wait(50); }
      }
      await clickAction('安装到位置');
    }
    await wait(450);
  }
  const s = await state();
  check(`${id} 引导 ${stepCount} 步全部完成`, s.completed && s.stepIndex === stepCount, `steps=${s.stepIndex} errors=${s.errors}`);
  check(`${id} 完成记录写入本地存储`, await page.evaluate((k) => JSON.parse(localStorage.getItem('chem3d-lab:v1')).devices[k]?.completions >= 1, id));
  await settle();
  await shot(shotName);
  await page.evaluate(() => { [...document.querySelectorAll('.completion-btns button')].find((b) => b.textContent === '返回观察').click(); });
  await wait(400);
}
await guidedPractice('ball-valve', 9, 14, '37-ball-valve-practice');
await guidedPractice('gear-pump', 7, 14, '38-gear-pump-practice');

/* ---------- 9.8 泵工业级结构验收（规格第八节 10 项） ---------- */
await page.goto(BASE + '#/device/pump');
await waitWorkbench();
await wait(1000);
// 1 泵壳：真实蜗壳扫掠网格 + 带通孔法兰几何
const volute = await page.evaluate(() => {
  const p = window.__chem3d.scene.parts.get('casing');
  let big = 0, extrudeHoles = 0;
  p.group.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    if (pos && pos.count > 900) big++;
    if ((o.userData.boltHoles ?? 0) >= 8) extrudeHoles++;
  });
  return { big, extrudeHoles };
});
check('泵壳包含真实蜗壳流道网格', volute.big >= 2, JSON.stringify(volute));
check('法兰为带真实通孔的几何', volute.extrudeHoles >= 1, JSON.stringify(volute));
await page.evaluate(() => { [...document.querySelectorAll('.mode-tab')].find(b => b.textContent.includes('剖视')).click(); });
await wait(700);
check('泵壳剖视生效（真实几何裁剪）', await page.evaluate(() => window.__chem3d.scene.sectionActive === true));
await shot('40-pump-section-volute');
// 2 叶轮独立选中与拆卸（自由练习：先拆泵盖再拆叶轮，验证后撤销复原）
await page.evaluate(() => { [...document.querySelectorAll('.mode-tab')].find(b => b.textContent.includes('拆装练习')).click(); });
await wait(600);
await page.evaluate(() => { [...document.querySelectorAll('.practice-mode-switch button')].find(b => b.textContent === '自由练习').click(); });
await wait(400);
await page.evaluate(() => { window.__chem3d.scene.select('cover'); window.__chem3d.scene.removeSelected(); });
await wait(500);
await page.evaluate(() => { window.__chem3d.scene.select('impeller'); window.__chem3d.scene.removeSelected(); });
await wait(500);
check('叶轮可独立选中并拆下', await page.evaluate(() => !window.__chem3d.scene.getPracticeState().installed.includes('impeller')));
await page.evaluate(() => { window.__chem3d.scene.undo(); window.__chem3d.scene.undo(); });
await wait(500);
check('撤销后叶轮与泵盖回到装配位', await page.evaluate(() => {
  const s = window.__chem3d.scene.getPracticeState();
  return s.installed.includes('impeller') && s.installed.includes('cover');
}));
await page.evaluate(() => { [...document.querySelectorAll('.mode-tab')].find(b => b.textContent.includes('整体观察')).click(); });
await wait(800);
// 3 轴系同轴与键连接（世界包围盒中心）
const align = await page.evaluate(() => {
  const s = window.__chem3d.scene;
  const center = (id) => {
    const p = s.parts.get(id);
    p.group.updateWorldMatrix(true, true);
    let minX = 1e9, minY = 1e9, minZ = 1e9, maxX = -1e9, maxY = -1e9, maxZ = -1e9;
    const v = { x: 0, y: 0, z: 0 };
    p.group.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      for (const cx of [bb.min.x, bb.max.x]) for (const cy of [bb.min.y, bb.max.y]) for (const cz of [bb.min.z, bb.max.z]) {
        const e = o.matrixWorld.elements;
        v.x = e[0] * cx + e[4] * cy + e[8] * cz + e[12];
        v.y = e[1] * cx + e[5] * cy + e[9] * cz + e[13];
        v.z = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
        minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
      }
    });
    return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, cz: (minZ + maxZ) / 2, minX, maxX };
  };
  const sh = center('shaft'), im = center('impeller'), cp = center('coupling'), cm = center('couplingMotor'), ms = center('motorShaft');
  const keys = s.parts.get('keys');
  let keyCount = 0;
  keys.group.traverse((o) => { if (o.isMesh) keyCount++; });
  return { sh, im, cp, cm, ms, keyCount };
});
const coaxial = Math.abs(align.sh.cy - 0.78) < 0.02 && Math.abs(align.sh.cz) < 0.02
  && Math.abs(align.im.cy - 0.78) < 0.02 && Math.abs(align.cp.cy - 0.78) < 0.02
  && Math.abs(align.cm.cy - 0.78) < 0.02 && Math.abs(align.ms.cy - 0.78) < 0.02
  && Math.abs(align.sh.cz) < 0.02 && Math.abs(align.cm.cz) < 0.02 && Math.abs(align.ms.cz) < 0.02;
check('泵轴/叶轮/联轴器/电机轴保持同轴', coaxial, JSON.stringify(align).slice(0, 220));
check('轴-叶轮键连接真实存在（平键组 2 只）', align.keyCount === 2);
check('泵轴贯穿叶轮轮毂（X 区间覆盖）', align.sh.minX < align.im.cx && align.sh.maxX > -0.8);
// 4 机械密封独立观察（隐藏泵壳/泵盖/密封压盖）
const sealView = await page.evaluate(() => {
  const s = window.__chem3d.scene;
  s.setPartHidden('casing', true);
  s.setPartHidden('cover', true);
  s.setPartHidden('sealGland', true);
  const vis = (id) => s.parts.get(id).group.visible;
  const r = { static: vis('sealStatic'), rotary: vis('sealRotary'), spring: vis('sealSpring'), sleeve: vis('sealSleeve'), gland: vis('sealGland') };
  s.resetPartEffects();
  return r;
});
check('机械密封内件可独立观察（隐藏壳体与压盖后可见）', sealView.static && sealView.rotary && sealView.spring && sealView.sleeve && !sealView.gland, JSON.stringify(sealView));
// 5 管道真实中空：外壁 openEnded + 内壁背面 + 两端环形端面
const pipeGeo = await page.evaluate(() => {
  const p = window.__chem3d.scene.parts.get('pipeSuction');
  let outer = 0, inner = 0, caps = 0, openEnded = false, rOut = 0, rIn = 0;
  p.group.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.outerWall === 'pipe') { outer++; openEnded = !!o.geometry.parameters?.openEnded; rOut = o.geometry.parameters?.radiusTop ?? 0; }
    if (o.material.side === 1) { inner++; rIn = o.geometry.parameters?.radiusTop ?? 0; }
    if (o.geometry.type === 'RingGeometry') caps++;
  });
  return { outer, inner, caps, openEnded, rOut, rIn };
});
check('管道为真实中空管（外壁开口 + 内壁 + 环形端面）', pipeGeo.outer >= 1 && pipeGeo.inner >= 1 && pipeGeo.caps >= 2 && pipeGeo.openEnded, JSON.stringify(pipeGeo));
check('管道壁厚真实（外半径 0.14 / 内半径 0.12）', Math.abs(pipeGeo.rOut - 0.14) < 1e-6 && Math.abs(pipeGeo.rIn - 0.12) < 1e-6, JSON.stringify(pipeGeo));
// 6 管道局部剖切只作用于选中件
await page.evaluate(() => { [...document.querySelectorAll('.mode-tab')].find(b => b.textContent.includes('剖视')).click(); });
await wait(600);
await page.evaluate(() => { window.__chem3d.scene.select('pipeSuction'); });
await page.evaluate(() => { [...document.querySelectorAll('.wb-bottom button')].find(b => b.textContent.includes('局部剖切')).click(); });
await wait(500);
const localClip = await page.evaluate(() => {
  const s = window.__chem3d.scene;
  const pipeMat = s.parts.get('pipeSuction').materials[0];
  const caseMat = s.parts.get('casing').materials[0];
  return { pipe: pipeMat.clippingPlanes?.length ?? 0, casing: caseMat.clippingPlanes?.length ?? 0 };
});
check('局部剖切仅裁选中管道、不裁其他零件', localClip.pipe === 1 && localClip.casing === 0, JSON.stringify(localClip));
await shot('41-pump-section-pipe-local');
await page.evaluate(() => { [...document.querySelectorAll('.mode-tab')].find(b => b.textContent.includes('整体观察')).click(); });
await wait(500);
// 7 透明观察不遮挡内部 + 逐件隐藏
await page.evaluate(() => { [...document.querySelectorAll('.mode-tab')].find(b => b.textContent.includes('透明')).click(); });
await wait(700);
const xrayView = await page.evaluate(() => {
  const s = window.__chem3d.scene;
  const shell = s.parts.get('casing').materials[0];
  const stator = s.parts.get('motorStator').materials[0];
  s.setPartHidden('sealGland', true);
  const glandHidden = !s.parts.get('sealGland').group.visible;
  const sealVisible = s.parts.get('sealRotary').group.visible;
  return { transparent: shell.transparent, opacity: shell.opacity, statorSolid: !stator.transparent, glandHidden, sealVisible };
});
check('透明模式可见内部件且不遮挡', xrayView.transparent && xrayView.opacity <= 0.3 && xrayView.statorSolid && xrayView.glandHidden && xrayView.sealVisible, JSON.stringify(xrayView));
await shot('42-pump-xray-internals');
await page.evaluate(() => { window.__chem3d.scene.resetPartEffects(); });
// 8 爆炸：内部件分层展开并精确复原
await page.evaluate(() => { [...document.querySelectorAll('.mode-tab')].find(b => b.textContent.includes('爆炸')).click(); });
await wait(400);
await page.evaluate(() => { const r = document.querySelector('.wb-bottom input.range'); r.value = '100'; r.dispatchEvent(new Event('input', { bubbles: true })); });
await wait(600);
const rollersMoved = await page.evaluate(() => {
  const s = window.__chem3d.scene;
  const p = s.parts.get('brgRollers');
  const d = p.def.pos;
  return Math.hypot(p.group.position.x - d[0], p.group.position.y - d[1], p.group.position.z - d[2]) > 0.5;
});
check('滚动体等内部件参与分层爆炸', rollersMoved);
await shot('43-pump-explode-internals');
await collapseAndWait();
check('泵 40 零件爆炸后精确复原', await page.evaluate(() => [...window.__chem3d.scene.parts.values()].every((p) => {
  const d = p.def.pos;
  return Math.abs(p.group.position.x - d[0]) < 1e-6 && Math.abs(p.group.position.y - d[1]) < 1e-6 && Math.abs(p.group.position.z - d[2]) < 1e-6;
})));
await page.evaluate(() => { [...document.querySelectorAll('.mode-tab')].find(b => b.textContent.includes('整体观察')).click(); });
await wait(500);

/* ---------- 10 移动端（同一页面切换视口，避免二次 WebGL 上下文） ---------- */
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(BASE + '#/library');
await wait(1200);
check('手机端无横向溢出', await page.evaluate(() => document.body.scrollWidth <= window.innerWidth));
check('手机首屏可用搜索与分类', await page.evaluate(() => {
  const r = document.querySelector('.home-toolbar')?.getBoundingClientRect();
  return !!r && r.top < window.innerHeight - 60;
}));
check('手机端导航折叠为菜单按钮', await page.evaluate(() => getComputedStyle(document.querySelector('.site-menu-btn')).display !== 'none' && getComputedStyle(document.querySelector('.site-links')).display === 'none'));
await page.click('.site-menu-btn');
await wait(300);
check('手机导航菜单含全部入口', await page.evaluate(() => {
  const items = [...document.querySelectorAll('.site-mobile-menu a, .site-mobile-menu button')].map((a) => a.textContent.trim());
  return ['教学工厂', '设备库', '组装工坊', '化工厂全流程装置', '微沸喷烧全流程', '高精度模型库', '学习记录'].every((x) => items.includes(x));
}));
await shot('24-mobile-home-menu');
await page.keyboard.press('Escape');
await wait(200);
check('Esc 关闭手机导航并还原按钮状态', await page.evaluate(() => document.querySelector('.site-menu-btn').getAttribute('aria-expanded') === 'false' && document.querySelector('.site-mobile-menu').hidden));
await shot('24-mobile-home');
await page.evaluate(() => { [...document.querySelectorAll('.card-enter')][0].click(); });
await waitWorkbench();
await wait(1200);
check('手机端三维视口靠前', await page.evaluate(() => document.querySelector('.canvas-wrap canvas')?.getBoundingClientRect().top < 150));
await shot('25-mobile-workbench');
await page.click('[data-action="parts"]');
await wait(400);
check('移动端目录抽屉可打开', await page.evaluate(() => document.querySelector('.left-panel').classList.contains('drawer-open')));
check('抽屉关闭时不可键盘聚焦', await page.evaluate(() => document.querySelector('.right-panel').inert === true));
await shot('26-mobile-drawer');
await page.evaluate(() => { [...document.querySelectorAll('.tree-item')][1].click(); });
await wait(400);
check('移动端抽屉选择后自动关闭', await page.evaluate(() => !document.querySelector('.left-panel').classList.contains('drawer-open')));
check('选零件后目录高亮与模型选中同步', await page.evaluate(() => {
  const active = document.querySelector('.tree-item.active');
  const selected = window.__chem3d.scene.selected;
  const part = window.__chem3d.device.parts.find((p) => p.id === selected);
  return !!active && !!part && active.querySelector('.tree-name')?.textContent === part.name;
}));
await page.evaluate(() => { [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.includes('拆装练习')).click(); });
await wait(700);
await shot('27-mobile-practice');
check('移动端拆装控制条可见', await page.evaluate(() => !!document.querySelector('.practice-actions')));
check('移动端步骤面板按钮显示为「步骤」', await page.evaluate(() => document.querySelector('[data-action="info"]')?.textContent.includes('步骤')));
await page.click('[data-action="info"]');
await wait(400);
check('移动端步骤面板可展开并显示练习指引', await page.evaluate(() => {
  const open = document.querySelector('.right-panel').classList.contains('drawer-open');
  const block = document.querySelector('.steps-block');
  return open && !!block && (document.querySelectorAll('.step-item').length === 16 || !!block.querySelector('.steps-note'));
}));
await shot('27b-mobile-steps');
await page.click('.right-panel .panel-collapse');
await wait(300);
check('关闭步骤面板后视口仍可操作', await page.evaluate(() => !document.querySelector('.right-panel').classList.contains('drawer-open') && getComputedStyle(document.querySelector('.canvas-wrap canvas')).pointerEvents !== 'none'));
await page.goto(BASE + '#/device/ball-valve');
await waitWorkbench();
await wait(1000);
await page.evaluate(() => { [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.includes('拆装练习')).click(); });
await wait(600);
check('移动端新设备（球阀）拆装控制条可见', await page.evaluate(() => !!document.querySelector('.practice-actions')));
await shot('39-mobile-ball-valve');

/* ---------- 汇总 ---------- */
const realErrors = consoleErrors.filter((e) => !e.includes('favicon'));
check('无运行时控制台错误', realErrors.length === 0, realErrors.slice(0, 5).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ results, consoleErrors: realErrors }, null, 2));
console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
if (failed.length) { console.log('FAILED:', failed.map((f) => f.name).join('; ')); process.exit(1); }
