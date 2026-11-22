/**
 * 单级离心泵样板验收：结构接触/连接、剖视可辨认、内窥视点与交互、手机端、练习残留回归。
 * 运行：node scripts/verify-pump-template.mjs（需 dev server；VERIFY_BASE 可覆盖）
 */
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.VERIFY_BASE ?? 'http://127.0.0.1:5190/';
const OUT = path.resolve('outputs/verify-pump-template');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const consoleErrors = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  ...browserOptions, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });
const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), timeout: 60000 });
const tab = async (t) => {
  await page.evaluate((x) => { [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.includes(x))?.click(); }, t);
  await wait(800);
};

await page.goto(BASE + '#/device/pump');
await page.waitForSelector('.canvas-wrap canvas');
await page.waitForFunction(() => window.__chem3d?.device?.id === 'pump');
await wait(1500);

/* ---------- A. 结构与数据 ---------- */
check('泵 40 零件未增减（保留学习记录兼容）', await page.evaluate(() => window.__chem3d.device.parts.length === 40 && window.__chem3d.scene.parts.size === 40));
check('内容版本升为 2026-11-20.1（观察自测）', await page.evaluate(() => window.__chem3d.device.contentVersion === '2026-11-20.1'), await page.evaluate(() => window.__chem3d.device.contentVersion));
const tags = await page.evaluate(() => {
  const s = window.__chem3d.scene;
  return {
    coverBolts: s.parts.get('cover').group.userData.coverBolts,
    coverGasket: !!s.parts.get('cover').group.userData.coverGasket,
    voluteThroat: s.parts.get('casing').group.userData.voluteThroat,
    bearingPedestal: !!s.parts.get('bearing').group.userData.pedestalContact,
    motorShim: !!s.parts.get('motor').group.userData.mountShim
  };
});
check('泵盖 8 条连接螺栓与结合面垫片已建模', tags.coverBolts === 8 && tags.coverGasket, JSON.stringify(tags));
check('蜗壳喉部朝向排出接管', tags.voluteThroat === 'top');
check('轴承箱支座与电机垫板已建模', tags.bearingPedestal && tags.motorShim);

const boxes = await page.evaluate(() => {
  const s = window.__chem3d.scene;
  // 直接遍历几何包围盒角点求世界包围盒
  const bounds = (id) => {
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
    return { minX, minY, minZ, maxX, maxY, maxZ };
  };
  // 排出管支架（x≈0 的立柱与管夹）底部高度
  let rightSupportMinY = 1e9;
  const sp = s.parts.get('pipeSupports');
  sp.group.updateWorldMatrix(true, true);
  sp.group.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    const e = o.matrixWorld.elements;
    const cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2, cz = (bb.min.z + bb.max.z) / 2;
    const wx = e[0] * cx + e[4] * cy + e[8] * cz + e[12];
    const wy = e[1] * cx + e[5] * cy + e[9] * cz + e[13];
    if (Math.abs(wx) > 0.2 || wy < 1.0) return;
    for (const xx of [bb.min.x, bb.max.x]) for (const yy of [bb.min.y, bb.max.y]) for (const zz of [bb.min.z, bb.max.z]) {
      rightSupportMinY = Math.min(rightSupportMinY, e[1] * xx + e[5] * yy + e[9] * zz + e[13]);
    }
  });
  return {
    mountY: s.parts.get('base').group.userData.mountY,
    base: bounds('base'), casing: bounds('casing'), bearing: bounds('bearing'), motor: bounds('motor'),
    pipeV: bounds('pipeDischargeV'), elbow: bounds('pipeElbowOut'), pipeH: bounds('pipeDischargeH'),
    support: bounds('pipeSupports'), rightSupportMinY, pipeSuction: bounds('pipeSuction')
  };
});
const crossesMount = (b) => b.minY <= boxes.mountY + 0.005 && b.maxY > boxes.mountY + 0.02;
check('泵体支脚与底座安装面接触（无悬空）', crossesMount(boxes.casing), `casing.minY=${boxes.casing.minY.toFixed(3)} mountY=${boxes.mountY}`);
check('轴承箱支座与底座安装面接触（无悬空）', crossesMount(boxes.bearing), `bearing.minY=${boxes.bearing.minY.toFixed(3)} mountY=${boxes.mountY}`);
check('电机垫板与底座安装面接触（无悬空）', crossesMount(boxes.motor), `motor.minY=${boxes.motor.minY.toFixed(3)} mountY=${boxes.mountY}`);
check('排出管支架立在底座上（不穿过底板）', boxes.rightSupportMinY >= boxes.mountY - 0.01, `rightSupport.minY=${boxes.rightSupportMinY.toFixed(3)} mountY=${boxes.mountY}`);
const overlap = (a, b) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
check('排出立管与排出弯头几何连通', overlap(boxes.pipeV, boxes.elbow), JSON.stringify({ vY: [boxes.pipeV.minY, boxes.pipeV.maxY], eY: [boxes.elbow.minY, boxes.elbow.maxY] }));
check('排出弯头与水平排出管几何连通', overlap(boxes.elbow, boxes.pipeH));
const supportHits = (p) => p.x >= boxes.support.minX && p.x <= boxes.support.maxX && p.y >= boxes.support.minY && p.y <= boxes.support.maxY && p.z >= boxes.support.minZ && p.z <= boxes.support.maxZ;
check('排出水平管支架夹持管身（x=0, y=2.35）', supportHits({ x: 0, y: 2.35, z: 0 }), JSON.stringify({ minY: boxes.support.minY, maxY: boxes.support.maxY }));
check('吸入管支架夹持管身（x=-2.0, y=0.78）', supportHits({ x: -2.0, y: 0.78, z: 0 }));

/* ---------- B. 剖视 ---------- */
await tab('剖视');
const sec = await page.evaluate(() => {
  const s = window.__chem3d.scene;
  const imp = s.parts.get('impeller').materials[0];
  const axisBtn = [...document.querySelectorAll('.wb-bottom button')].find((b) => b.classList.contains('active') && b.textContent.includes('剖'));
  return { axis: s.sectionAxis, side: imp.side, axisLabel: axisBtn?.textContent ?? '' };
});
check('泵剖视默认沿轴向（Z）且可切换', sec.axis === 'z' && sec.axisLabel.includes('前后剖'), JSON.stringify(sec));
check('剖视内部件双面可见（叶轮材质临时双面）', sec.side === 2, `side=${sec.side}`);
await page.evaluate(() => window.__chem3d.scene.setView('front'));
await wait(700);
await shot('section-axial');
await tab('整体观察');
check('退出剖视后材质面恢复', await page.evaluate(() => window.__chem3d.scene.parts.get('impeller').materials[0].side === 0));

/* ---------- C. 内窥 ---------- */
await tab('内窥');
await wait(700);
const endo0 = await page.evaluate(() => {
  const s = window.__chem3d.scene;
  const st = s.getEndoscopeState();
  return { active: s.endoscopeActive, near: s.camera.near, controls: s.controls.enabled, count: st.count, index: st.index, hud: !document.querySelector('.endo-hud')?.hidden, hudText: document.querySelector('.endo-hud')?.textContent ?? '', guide: !!s.endoGuide, exposure: s.renderer.toneMappingExposure, pos: st.stop?.pos };
});
check('内窥页签可进入（泵）', endo0.active && endo0.count === 8 && endo0.index === 0, JSON.stringify({ active: endo0.active, count: endo0.count }));
check('内窥相机近裁剪面 0.01、轨道控制器停用', Math.abs(endo0.near - 0.01) < 1e-6 && endo0.controls === false);
check('内窥 HUD 显示当前位置', endo0.hud && endo0.hudText.includes('吸入口') && endo0.hudText.includes('1 / 8'));
check('教学流线与方向箭头已建立', endo0.guide);
await shot('endo-1-entry');

const stops = [];
for (let i = 0; i < 8; i++) {
  if (i > 0) {
    await page.evaluate(() => { document.querySelector('.endo-stops .endo-chip.active')?.nextElementSibling?.click(); });
    await page.waitForFunction(() => !window.__chem3d.scene.endoTween, null, { timeout: 4000 });
    await wait(120);
  }
  const st = await page.evaluate(() => {
    const s = window.__chem3d.scene;
    const sst = s.getEndoscopeState();
    return { index: sst.index, name: sst.stop?.name, pos: sst.stop?.pos, flow: sst.stop?.flow, cam: [s.camera.position.x, s.camera.position.y, s.camera.position.z], hudCount: document.querySelector('.endo-hud-count')?.textContent ?? '' };
  });
  stops.push(st);
  if ([0, 4, 5, 7].includes(i)) await shot(`endo-${i + 1}-${st.name?.slice(0, 4) ?? ''}`);
}
const inVoid = (i, p) => {
  const [x, y, z] = p;
  const r = Math.hypot(y - 0.78, z);
  switch (i) {
    case 0: return Math.abs(x + 3.13) < 0.02 && y > 0.24 && y < 0.5 && Math.abs(z) < 0.06;
    case 1: return Math.abs(Math.hypot(x + 2.9, y - 0.55) - 0.23) < 0.12;
    case 2: return Math.abs(y - 0.78) < 0.06 && Math.abs(z) < 0.06 && x > -2.9 && x < -1.71;
    case 3: return r < 0.14 && x > -1.63 && x < -1.17;
    case 4: return r < 0.14 && Math.abs(x + 1.22) < 0.02;
    case 5: return Math.abs(x + 1.0) < 0.15 && Math.abs(r - 0.4925) < 0.09;
    case 6: return Math.abs(x + 1.0) < 0.11 && y > 1.24 && y < 1.62 && Math.abs(z) < 0.09;
    case 7: return Math.abs(y - 2.35) < 0.06 && Math.abs(z) < 0.06 && x > -0.85 && x < 0.3;
    default: return false;
  }
};
const bad = stops.filter((s, i) => !s.pos || !inVoid(i, s.pos));
check('8 个视点均位于对应流体通道空腔内', bad.length === 0, bad.map((b) => `${b.index}:${b.name}`).join('; '));
check('相机与视点坐标一致（切换到位）', stops.every((s, i) => s.cam.every((c, k) => Math.abs(c - s.pos[k]) < 0.005)));
check('HUD 随视点同步（8/8）', stops[7].hudCount === '8 / 8', stops[7].hudCount);
check('终点「下一站」禁用', await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.wb-bottom button')];
  return btns.find((b) => b.textContent === '下一站')?.disabled === true;
}));

// 环顾拖拽
const beforeQ = await page.evaluate(() => window.__chem3d.scene.camera.quaternion.toArray());
const canvasBox = await page.locator('.canvas-wrap').boundingBox();
const cx = canvasBox.x + canvasBox.width / 2, cy = canvasBox.y + canvasBox.height / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 140, cy + 50, { steps: 6 });
await page.mouse.up();
await wait(300);
const afterQ = await page.evaluate(() => window.__chem3d.scene.camera.quaternion.toArray());
const qDiff = Math.abs(beforeQ[0] - afterQ[0]) + Math.abs(beforeQ[1] - afterQ[1]) + Math.abs(beforeQ[2] - afterQ[2]) + Math.abs(beforeQ[3] - afterQ[3]);
check('拖动画布可环顾（限制角度）', qDiff > 0.01, `dq=${qDiff.toFixed(3)}`);
await page.evaluate(() => { [...document.querySelectorAll('.wb-bottom button')].find((b) => b.textContent === '重置视点')?.click(); });
await wait(350);
const resetDir = await page.evaluate(() => {
  const s = window.__chem3d.scene;
  const st = s.getEndoscopeState();
  const dir = s.camera.getWorldDirection(new (s.camera.position.constructor)());
  const look = new (s.camera.position.constructor)(...st.stop.look).sub(new (s.camera.position.constructor)(...st.stop.pos)).normalize();
  return dir.dot(look);
});
check('重置视点恢复初始朝向', resetDir > 0.999, `dot=${resetDir.toFixed(4)}`);

await shot('endo-8-outlet');
await page.evaluate(() => { [...document.querySelectorAll('.wb-bottom button')].find((b) => b.textContent.includes('退出内窥'))?.click(); });
await wait(700);
const exitState = await page.evaluate(() => {
  const s = window.__chem3d.scene;
  return {
    active: s.endoscopeActive, near: s.camera.near, controls: s.controls.enabled,
    guide: !!s.endoGuide, exposure: s.renderer.toneMappingExposure,
    hudHidden: document.querySelector('.endo-hud')?.hidden, observeTab: document.querySelector('.mode-tab.active')?.textContent ?? ''
  };
});
check('退出内窥恢复外部观察与相机参数', !exitState.active && Math.abs(exitState.near - 0.05) < 1e-6 && exitState.controls && !exitState.guide && Math.abs(exitState.exposure - 1.05) < 1e-6);
check('退出后 HUD 隐藏且回到整体观察', exitState.hudHidden && exitState.observeTab.includes('整体观察'), JSON.stringify(exitState));

/* ---------- D. 练习残留回归 ---------- */
await tab('拆装练习');
await wait(600);
const trayInPractice = await page.evaluate(() => window.__chem3d.scene.trayZone.visible);
await tab('整体观察');
await wait(400);
const trayAfter = await page.evaluate(() => window.__chem3d.scene.trayZone.visible);
check('练习「零件区」仅在练习模式显示', trayInPractice === true && trayAfter === false, `practice=${trayInPractice} observe=${trayAfter}`);

/* ---------- E. 其他设备的内窥入口 ---------- */
await page.goto(BASE + '#/device/gear-pump');
await page.waitForSelector('.canvas-wrap canvas');
await page.waitForFunction(() => window.__chem3d?.device?.id === 'gear-pump');
await wait(1200);
const gearEndo = await page.evaluate(() => {
  const tab = [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.includes('内窥'));
  return { exists: !!tab, dev: tab?.classList.contains('tab-dev') ?? false };
});
check('未开放内窥的设备显示「开发中」标记', gearEndo.exists && gearEndo.dev);

const realErrors = consoleErrors.filter((e) => !e.includes('favicon'));
check('无运行时控制台错误', realErrors.length === 0, realErrors.slice(0, 4).join(' | '));

/* ---------- F. 手机端 ---------- */
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const mErrors = [];
mobile.on('pageerror', (e) => mErrors.push('pageerror: ' + e.message));
mobile.on('console', (m) => { if (m.type() === 'error') mErrors.push('console: ' + m.text()); });
await mobile.goto(BASE + '#/device/pump');
await mobile.waitForSelector('.canvas-wrap canvas');
await mobile.waitForFunction(() => window.__chem3d?.device?.id === 'pump');
await wait(1200);
await mobile.locator('.mode-tab').filter({ hasText: '内窥' }).click();
await wait(900);
const mState = await mobile.evaluate(() => {
  const hud = document.querySelector('.endo-hud');
  const r = hud?.getBoundingClientRect();
  const next = [...document.querySelectorAll('.wb-bottom button')].find((b) => b.textContent === '下一站');
  const nr = next?.getBoundingClientRect();
  return {
    active: window.__chem3d.scene.endoscopeActive,
    hudVisible: !!hud && !hud.hidden && r.width > 100 && r.top >= 0 && r.bottom < window.innerHeight,
    hudCount: document.querySelector('.endo-hud-count')?.textContent,
    nextSize: nr ? { w: nr.width, h: nr.height } : null
  };
});
check('手机端可进入内窥且 HUD 在视口内', mState.active && mState.hudVisible && mState.hudCount === '1 / 8', JSON.stringify(mState));
check('手机端「下一站」按钮可点（高度≥32px）', mState.nextSize && mState.nextSize.h >= 32, JSON.stringify(mState.nextSize));
await mobile.evaluate(() => { [...document.querySelectorAll('.wb-bottom button')].find((b) => b.textContent === '下一站')?.click(); });
await wait(750);
check('手机端视点切换生效', await mobile.evaluate(() => window.__chem3d.scene.getEndoscopeState().index === 1));
await mobile.screenshot({ path: path.join(OUT, 'mobile-endo-2.png'), timeout: 60000 });
await mobile.evaluate(() => { [...document.querySelectorAll('.wb-bottom button')].find((b) => b.textContent.includes('退出内窥'))?.click(); });
await wait(500);
check('手机端退出内窥恢复外部视角', await mobile.evaluate(() => !window.__chem3d.scene.endoscopeActive));
check('手机端无运行时控制台错误', mErrors.filter((e) => !e.includes('favicon')).length === 0, mErrors.slice(0, 3).join(' | '));
await mobile.close();

await browser.close();
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ results, consoleErrors: realErrors }, null, 2));
console.log(`\n==== PUMP TEMPLATE ${results.length - failed.length}/${results.length} passed ====`);
if (failed.length) {
  console.log('FAILED:\n' + failed.map((f) => ` - ${f.name} ${f.detail}`).join('\n'));
  process.exit(1);
}
