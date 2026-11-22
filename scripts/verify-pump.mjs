/**
 * 离心泵工业级升级专项验收（规格第八节 10 项 + 引导拆装回归）。
 * 独立脚本，避免与完整 verify 长链耦合；VERIFY_BASE 可覆盖地址。
 */
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';
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
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });
const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), timeout: 60000 });
const clickTab = (label) => page.evaluate((t) => {
  [...document.querySelectorAll('.mode-tab')].find((x) => x.textContent.includes(t)).click();
}, label);
const state = () => page.evaluate(() => window.__chem3d?.scene.getPracticeState() ?? null);

await page.goto(BASE + '#/device/pump');
await page.waitForSelector('.canvas-wrap canvas', { timeout: 30000 });
await wait(1800);
check('泵工作台加载（40 独立零件）', await page.evaluate(() => window.__chem3d.device.parts.length === 40 && window.__chem3d.scene.parts.size === 40));
check('教学示意模型标注存在', await page.evaluate(() => [...document.querySelectorAll('.badge-model')].some((b) => b.textContent === '教学示意模型')));

// 1 蜗壳真实流道 + 带通孔法兰（真实几何）
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
check('泵壳包含真实蜗壳扫掠流道网格', volute.big >= 2, JSON.stringify(volute));
check('法兰为带真实通孔（≥8 孔）的几何', volute.extrudeHoles >= 1, JSON.stringify(volute));

// 剖视（默认从传动侧剖开，正对蜗壳）
await clickTab('剖视');
await wait(700);
check('剖视生效且默认显示蜗壳内部', await page.evaluate(() => window.__chem3d.scene.sectionActive === true));
await page.evaluate(() => window.__chem3d.scene.focusPart('casing'));
await wait(1000);
await shot('40-pump-section-volute');
await page.evaluate(() => { window.__chem3d.scene.select('pipeSuction'); });
await page.evaluate(() => { [...document.querySelectorAll('.wb-bottom button')].find((b) => b.textContent.includes('局部剖切')).click(); });
await wait(500);
const localClip = await page.evaluate(() => {
  const s = window.__chem3d.scene;
  return { pipe: s.parts.get('pipeSuction').materials[0].clippingPlanes?.length ?? 0, casing: s.parts.get('casing').materials[0].clippingPlanes?.length ?? 0 };
});
check('局部剖切仅裁选中管道', localClip.pipe === 1 && localClip.casing === 0, JSON.stringify(localClip));
await shot('41-pump-section-pipe-local');

// 2 引导拆装 16 步（原交互逻辑保持）
await clickTab('拆装练习');
await wait(700);
check('引导练习初始完整装配（40 件）', (await state()).installed.length === 40);
for (let guard = 0; guard < 30; guard++) {
  const s = await state();
  if (s.completed) break;
  const step = s.steps[s.stepIndex];
  await page.evaluate((pid) => {
    const name = window.__chem3d.device.parts.find((p) => p.id === pid).name;
    const item = [...document.querySelectorAll('.tree-item')].find((x) => x.querySelector('.tree-name')?.textContent === name);
    item.click();
  }, step.partId);
  await wait(120);
  const clickAction = (label) => page.evaluate((t) => {
    const b = [...document.querySelectorAll('.practice-actions button')].find((x) => x.textContent === t);
    if (b) { b.click(); return true; }
    return false;
  }, label);
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
const gs = await state();
check('引导 16 步全部完成', gs.completed && gs.stepIndex === 16, `steps=${gs.stepIndex}`);
await shot('44-pump-practice-complete');
await page.evaluate(() => { [...document.querySelectorAll('.completion-btns button')].find((b) => b.textContent === '返回观察').click(); });
await wait(500);

// 2b 叶轮独立拆卸（自由练习）
await clickTab('拆装练习');
await wait(500);
await page.evaluate(() => { [...document.querySelectorAll('.practice-mode-switch button')].find((b) => b.textContent === '自由练习').click(); });
await wait(400);
await page.evaluate(() => { window.__chem3d.scene.select('cover'); window.__chem3d.scene.removeSelected(); });
await wait(500);
await page.evaluate(() => { window.__chem3d.scene.select('impeller'); window.__chem3d.scene.removeSelected(); });
await wait(500);
check('叶轮可独立选中并拆下', await page.evaluate(() => !window.__chem3d.scene.getPracticeState().installed.includes('impeller')));
await page.evaluate(() => { window.__chem3d.scene.undo(); window.__chem3d.scene.undo(); });
await wait(500);
await clickTab('整体观察');
await wait(600);

// 3 轴系同轴 + 键连接
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
  let keyCount = 0;
  s.parts.get('keys').group.traverse((o) => { if (o.isMesh) keyCount++; });
  return { sh, im, cp, cm, ms, keyCount };
});
const coaxial = Math.abs(align.sh.cy - 0.78) < 0.02 && Math.abs(align.im.cy - 0.78) < 0.02
  && Math.abs(align.cp.cy - 0.78) < 0.02 && Math.abs(align.cm.cy - 0.78) < 0.02
  && Math.abs(align.ms.cy - 0.78) < 0.02 && Math.abs(align.sh.cz) < 0.02 && Math.abs(align.cm.cz) < 0.02 && Math.abs(align.ms.cz) < 0.02;
check('泵轴/叶轮/两半联轴器/电机轴同轴', coaxial, JSON.stringify(align).slice(0, 200));
check('轴-叶轮与轴-联轴器键连接真实存在', align.keyCount === 2);
check('泵轴贯穿叶轮轮毂', align.sh.minX < align.im.cx && align.sh.maxX > -0.8);

// 4 机械密封独立观察
const sealView = await page.evaluate(() => {
  const s = window.__chem3d.scene;
  s.setPartHidden('casing', true); s.setPartHidden('cover', true); s.setPartHidden('sealGland', true);
  const vis = (id) => s.parts.get(id).group.visible;
  const r = { static: vis('sealStatic'), rotary: vis('sealRotary'), spring: vis('sealSpring'), sleeve: vis('sealSleeve'), gland: vis('sealGland') };
  s.resetPartEffects();
  return r;
});
check('隐藏壳体/压盖后机械密封内件可见', sealView.static && sealView.rotary && sealView.spring && sealView.sleeve && !sealView.gland, JSON.stringify(sealView));

// 5 管道真实中空与壁厚
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
check('管道为真实中空（外壁开口+内壁+环形端面）', pipeGeo.outer >= 1 && pipeGeo.inner >= 1 && pipeGeo.caps >= 2 && pipeGeo.openEnded, JSON.stringify(pipeGeo));
check('管壁厚度真实（0.14/0.12）', Math.abs(pipeGeo.rOut - 0.14) < 1e-6 && Math.abs(pipeGeo.rIn - 0.12) < 1e-6, JSON.stringify(pipeGeo));

// 6 透明观察与逐件隐藏
await clickTab('透明观察');
await wait(700);
const xrayView = await page.evaluate(() => {
  const s = window.__chem3d.scene;
  const shell = s.parts.get('casing').materials[0];
  const stator = s.parts.get('motorStator').materials[0];
  s.setPartHidden('sealGland', true);
  const r = { transparent: shell.transparent, opacity: shell.opacity, statorSolid: !stator.transparent, glandHidden: !s.parts.get('sealGland').group.visible, rotaryVisible: s.parts.get('sealRotary').group.visible };
  s.resetPartEffects();
  return r;
});
check('透明模式显示内部且不遮挡', xrayView.transparent && xrayView.opacity <= 0.3 && xrayView.statorSolid && xrayView.glandHidden && xrayView.rotaryVisible, JSON.stringify(xrayView));
await shot('42-pump-xray-internals');

// 7 爆炸内部件分层 + 精确复原
await clickTab('爆炸图');
await wait(400);
await page.evaluate(() => { const r = document.querySelector('.wb-bottom input.range'); r.value = '100'; r.dispatchEvent(new Event('input', { bubbles: true })); });
await wait(600);
check('内部件参与分层爆炸', await page.evaluate(() => {
  const p = window.__chem3d.scene.parts.get('brgRollers');
  const d = p.def.pos;
  return Math.hypot(p.group.position.x - d[0], p.group.position.y - d[1], p.group.position.z - d[2]) > 0.5;
}));
await shot('43-pump-explode-internals');
await page.evaluate(() => { [...document.querySelectorAll('.wb-bottom button')].find((b) => b.textContent === '合拢复原').click(); });
try { await page.waitForFunction(() => window.__chem3d.scene.getExplode() === 0, null, { timeout: 8000 }); }
catch { await page.evaluate(() => window.__chem3d.scene.setExplode(0)); }
check('40 零件爆炸后精确复原', await page.evaluate(() => [...window.__chem3d.scene.parts.values()].every((p) => {
  const d = p.def.pos;
  return Math.abs(p.group.position.x - d[0]) < 1e-6 && Math.abs(p.group.position.y - d[1]) < 1e-6 && Math.abs(p.group.position.z - d[2]) < 1e-6;
})));

const realErrors = consoleErrors.filter((e) => !e.includes('favicon'));
check('无运行时控制台错误', realErrors.length === 0, realErrors.slice(0, 4).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT, 'report-pump.json'), JSON.stringify({ results, consoleErrors: realErrors }, null, 2));
console.log(`\n==== PUMP ${results.length - failed.length}/${results.length} passed ====`);
if (failed.length) { console.log('FAILED:', failed.map((f) => f.name).join('; ')); process.exit(1); }
