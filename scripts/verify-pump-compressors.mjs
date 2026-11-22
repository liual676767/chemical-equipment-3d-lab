/**
 * 第三阶段验收：齿轮泵、双隔膜泵、双螺杆压缩机的结构与教学演示。
 * 运行：node scripts/verify-pump-compressors.mjs（需 dev server；VERIFY_BASE 可覆盖）
 */
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.VERIFY_BASE ?? 'http://127.0.0.1:5173/';
const OUT = path.resolve('outputs/verify-pump-compressors');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const errors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const browser = await chromium.launch({
  ...browserOptions, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

async function load(id) {
  await page.goto(`${BASE}#/device/${id}`, { timeout: 90000, waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.canvas-wrap canvas');
  await page.waitForFunction((x) => window.__chem3d?.device?.id === x, id);
  await wait(1500);
}
async function tab(text) {
  await page.evaluate((t) => { [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.includes(t))?.click(); }, text);
  await wait(1300);
}
const bbox = (id) => page.evaluate((partId) => {
  const s = window.__chem3d.scene;
  const p = s.parts.get(partId);
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
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], size: [maxX - minX, maxY - minY, maxZ - minZ] };
}, id);
const activeAxis = () => page.evaluate(() => {
  const btns = [...document.querySelectorAll('.wb-bottom .tool-btn')];
  const axis = btns.find((b) => b.classList.contains('active') && /剖 \((X|Y|Z)\)/.test(b.textContent));
  const flip = btns.find((b) => b.textContent.includes('反向剖切'));
  const slider = document.querySelector('.wb-bottom input.range');
  return { axis: axis?.textContent ?? '', flip: flip?.classList.contains('active') ?? false, slider: slider?.value ?? '' };
});

/* ==================== 齿轮泵 ==================== */
{
  await load('gear-pump');
  const info = await page.evaluate(() => {
    const s = window.__chem3d.scene;
    const c = s.parts.get('casing').group;
    return {
      version: window.__chem3d.device.contentVersion,
      parts: s.parts.size,
      order: window.__chem3d.device.assemblyOrder.length,
      suction: c.userData.suctionPort,
      discharge: c.userData.dischargePort,
      bore: c.userData.boreRadius,
      center: c.userData.centerDistance,
      clearance: c.userData.gearTipClearance,
      driveTeeth: s.parts.get('driveGear').group.userData.teeth,
      idlerTeeth: s.parts.get('idlerGear').group.userData.teeth,
      drivePhase: s.parts.get('driveGear').group.userData.phase,
      idlerPhase: s.parts.get('idlerGear').group.userData.phase,
      teaching: s.parts.get('driveGear').group.userData.teachingToothProfile
    };
  });
  check('G1 齿轮泵 7 零件与 14 步拆装保持不变', info.parts === 7 && info.order === 7);
  check('G2 内容版本已升级', info.version === '2026-11-20.1', info.version);
  check('G3 泵体标注 +Z 吸入、-Z 排出与 8 字形孔径/中心距', info.suction === 'z+' && info.discharge === 'z-' && info.bore > 0.19 && info.center > 0.3, JSON.stringify(info));
  check('G4 两齿轮 12 齿、15° 相位差、教学型线', info.driveTeeth === 12 && info.idlerTeeth === 12 && Math.abs(info.idlerPhase - info.drivePhase - Math.PI / 12) < 1e-6 && info.teaching === true);
  const housingBox = await bbox('casing');
  check('G5 泵体为纵向 8 字形外形（高度 > 0.85，宽度 > 0.5）', housingBox.size[1] > 0.85 && housingBox.size[2] > 0.5, JSON.stringify(housingBox.size));
  check('G6 吸入口与排出口法兰均伸出泵体（Z 向 > ±0.4）', housingBox.max[2] > 0.4 && housingBox.min[2] < -0.4, `${housingBox.min[2]}..${housingBox.max[2]}`);

  await page.evaluate(() => window.__chem3d.scene.setQuality('high'));
  await page.locator('.canvas-toolbar,.canvas-mode-chip,.endo-hud,.toast-stack,.loading-overlay').evaluateAll((els) => els.forEach((e) => (e.style.display = 'none')));
  await tab('剖视');
  const ax = await activeAxis();
  check('G7 齿轮泵剖视预设为 X 向、32%、反向', ax.axis.includes('X') && ax.flip === true && ax.slider === '32', JSON.stringify(ax));
  const camX = await page.evaluate(() => +window.__chem3d.scene.camera.position.x.toFixed(3));
  check('G8 剖视预设从 +X 轴向观察齿轮', camX > 1.2, String(camX));
  await page.locator('.canvas-wrap').screenshot({ path: path.join(OUT, 'gear-section.png') });

  await tab('工作原理');
  const particles = await page.evaluate(() => window.__chem3d.scene.principle.particles.length);
  check('G9 齿轮泵原理动画包含两路齿间输送粒子', particles >= 22, String(particles));
  const minMeshDist = await page.evaluate(async () => {
    const ps = window.__chem3d.scene.principle.particles;
    let min = 1e9;
    for (let n = 0; n < 12; n++) {
      for (const p of ps) min = Math.min(min, Math.hypot(p.position.x, p.position.y - 0.72, p.position.z));
      await new Promise((r) => setTimeout(r, 100));
    }
    return +min.toFixed(3);
  });
  check('G10 示踪粒子不穿过两齿轮啮合中心（最小距离 > 0.15）', minMeshDist > 0.15, String(minMeshDist));
  const rot0 = await page.evaluate(() => window.__chem3d.scene.parts.get('driveGear').group.rotation.x);
  await page.waitForFunction((r0) => Math.abs(window.__chem3d.scene.parts.get('driveGear').group.rotation.x - r0) > 0.1, rot0, { timeout: 10000 }).catch(() => {});
  const rot1 = await page.evaluate(() => window.__chem3d.scene.parts.get('driveGear').group.rotation.x);
  check('G11 原理模式下齿轮持续旋转', Math.abs(rot1 - rot0) > 0.1, `${rot0} -> ${rot1}`);
  await page.locator('.canvas-wrap').screenshot({ path: path.join(OUT, 'gear-principle.png') });

  await tab('整体观察');
  await page.locator('[data-action=parts]').click();
  await page.locator('.tree-item').filter({ hasText: '泵体' }).first().click();
  await wait(500);
  const sel = await page.evaluate(() => {
    const s = window.__chem3d.scene;
    return { selected: s.selected, emissive: s.parts.get('casing').materials.some((m) => m.emissive.getHex() !== 0) };
  });
  check('G12 泵体仍可点选并高亮', sel.selected === 'casing' && sel.emissive, JSON.stringify(sel));
}

/* ==================== 双隔膜泵 ==================== */
{
  await load('diaphragm-pump');
  const info = await page.evaluate(() => {
    const s = window.__chem3d.scene;
    const valves = [];
    s.parts.get('checkBalls').group.traverse((o) => { if (o.userData.valve) valves.push(o.userData.valve); });
    const flex = [];
    for (const id of ['diaphragmL', 'diaphragmR']) {
      s.parts.get(id).group.traverse((o) => { if (o.userData.diaphragmCenter) flex.push(id); });
    }
    return {
      version: window.__chem3d.device.contentVersion,
      parts: s.parts.size,
      order: window.__chem3d.device.assemblyOrder.length,
      diaL: s.parts.get('diaphragmL').group.position.x,
      diaR: s.parts.get('diaphragmR').group.position.x,
      chL: s.parts.get('chamberL').group.position.x,
      chR: s.parts.get('chamberR').group.position.x,
      valveCount: s.parts.get('checkBalls').group.userData.valveCount,
      valves: valves.length,
      flex,
      portBore: s.parts.get('chamberL').group.userData.portBore,
      clamp: s.parts.get('chamberL').group.userData.clampedEdge,
      airInlet: s.parts.get('airChamber').group.userData.airInlet,
      branches: s.parts.get('manifoldIn').group.userData.branchCount
    };
  });
  check('D1 隔膜泵 9 零件与 16 步拆装保持不变', info.parts === 9 && info.order === 8);
  check('D2 内容版本已升级', info.version === '2026-11-20.1', info.version);
  check('D3 隔膜移到夹紧位置、隔膜腔与之贴合', Math.abs(info.diaL + 0.37) < 1e-6 && Math.abs(info.diaR - 0.37) < 1e-6 && Math.abs(info.chL + 0.47) < 1e-6 && Math.abs(info.chR - 0.47) < 1e-6, JSON.stringify(info));
  check('D4 四只独立止回阀、带夹紧外缘与真实腔口', info.valveCount === 4 && info.valves === 4 && info.flex.length === 2 && info.portBore > 0.05 && info.clamp > 0.2);
  check('D5 气室前侧进气、两腔总管各两根支管', info.airInlet === 'z+' && info.branches === 2);

  await page.evaluate(() => window.__chem3d.scene.setQuality('high'));
  await page.locator('.canvas-toolbar,.canvas-mode-chip,.endo-hud,.toast-stack,.loading-overlay').evaluateAll((els) => els.forEach((e) => (e.style.display = 'none')));
  await tab('剖视');
  await page.locator('.canvas-wrap').screenshot({ path: path.join(OUT, 'diaphragm-section.png') });

  await tab('工作原理');
  const readState = () => page.evaluate(() => {
    const s = window.__chem3d.scene;
    const balls = [];
    s.parts.get('checkBalls').group.traverse((o) => { if (o.userData.valve) { const v = o.userData.valve; balls.push({ c: v.chamber, l: v.line, open: Math.abs(o.position.y - v.openY) < 1e-4 }); } });
    const flex = [];
    for (const id of ['diaphragmL', 'diaphragmR']) s.parts.get(id).group.traverse((o) => { if (o.userData.diaphragmCenter) flex.push(+o.position.x.toFixed(4)); });
    return { t: +s.getPrincipleTime().toFixed(3), playing: s.principle.playing, balls, flex, readout: document.querySelector('.diaphragm-state')?.textContent ?? '', diaL: s.parts.get('diaphragmL').group.position.x, diaR: s.parts.get('diaphragmR').group.position.x };
  });
  await page.locator('.toolbar-group button', { hasText: '左腔吸入' }).click();
  await wait(500);
  let st = await readState();
  const open = (c, l) => st.balls.find((b) => b.c === c && b.l === l)?.open;
  check('D6 左腔吸入行程：左进开/左出关、右进关/右出开', open('L', 'in') === true && open('L', 'out') === false && open('R', 'in') === false && open('R', 'out') === true, JSON.stringify(st.balls));
  check('D7 左腔吸入行程：两隔膜中心同向移动且边缘夹紧位置不变', Math.abs(st.flex[0] - 0.03) < 1e-4 && Math.abs(st.flex[1] - 0.03) < 1e-4 && Math.abs(st.diaL + 0.37) < 1e-6 && Math.abs(st.diaR - 0.37) < 1e-6, JSON.stringify(st));
  check('D8 左腔吸入行程读数正确', st.readout.includes('左腔吸入') && st.readout.includes('左进口开'), st.readout);
  check('D9 分步按钮暂停动画', st.playing === false);
  await page.screenshot({ path: path.join(OUT, 'diaphragm-left-stroke.png') });

  await page.locator('.toolbar-group button', { hasText: '右腔吸入' }).click();
  await wait(500);
  st = await readState();
  check('D10 右腔吸入行程：右进开/右出关、左进关/左出开', open('R', 'in') === true && open('R', 'out') === false && open('L', 'in') === false && open('L', 'out') === true, JSON.stringify(st.balls));
  check('D11 右腔吸入行程读数正确', st.readout.includes('右腔吸入') && st.readout.includes('右进口开'), st.readout);
  await page.screenshot({ path: path.join(OUT, 'diaphragm-right-stroke.png') });

  await page.locator('.wb-bottom button', { hasText: '播放' }).click();
  await wait(600);
  st = await readState();
  check('D12 从分步行继续播放', st.playing === true);
  await tab('整体观察');
  const slider = page.locator('.wb-bottom input.range').first();
  await slider.evaluate((el) => { el.value = '100'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(400);
  st = await readState();
  check('D13 观察模式行程滑杆同步止回阀与隔膜', open('L', 'in') === true && open('R', 'out') === true && Math.abs(st.flex[0] - 0.03) < 1e-4, JSON.stringify(st));
  await slider.evaluate((el) => { el.value = '50'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(300);
}

/* ==================== 双螺杆压缩机 ==================== */
{
  await load('screw-compressor');
  const info = await page.evaluate(() => {
    const s = window.__chem3d.scene;
    const h = s.parts.get('housing').group;
    const vertices = (id) => { let n = 0; s.parts.get(id).group.traverse((o) => { if (o.isMesh) n += o.geometry.getAttribute('position')?.count ?? 0; }); return n; };
    return {
      version: window.__chem3d.device.contentVersion,
      parts: s.parts.size,
      order: window.__chem3d.device.assemblyOrder.length,
      boreMale: h.userData.boreMale,
      boreFemale: h.userData.boreFemale,
      center: h.userData.centerDistance,
      teaching: h.userData.teachingProfile,
      inletPort: h.userData.inletPort,
      outletPort: h.userData.outletPort,
      maleLobes: s.parts.get('maleRotor').group.userData.lobes,
      femaleLobes: s.parts.get('femaleRotor').group.userData.lobes,
      maleVerts: vertices('maleRotor'),
      femaleVerts: vertices('femaleRotor'),
      baseClear: s.parts.get('base').group.userData.outletClearance,
      maleY: s.parts.get('maleRotor').group.position.y,
      femaleY: s.parts.get('femaleRotor').group.position.y,
      outletY: s.parts.get('outlet').group.position.y
    };
  });
  check('S1 螺杆压缩机 8 零件保持不变', info.parts === 8);
  check('S2 内容版本已升级', info.version === '2026-11-20.1', info.version);
  check('S3 双孔机壳、中心距、教学型线与进出气端标注', info.boreMale > 0.14 && info.boreFemale > 0.13 && info.center > 0.2 && info.teaching && info.inletPort.includes('top') && info.outletPort.includes('bottom'), JSON.stringify(info));
  check('S4 4/6 瓣螺旋转子有真实螺旋几何', info.maleLobes === 4 && info.femaleLobes === 6 && info.maleVerts > 2000 && info.femaleVerts > 2000, `${info.maleVerts}/${info.femaleVerts}`);
  check('S5 转子中心、出口位置与底架排气开口', Math.abs(info.maleY - 0.825) < 1e-6 && Math.abs(info.femaleY - 0.575) < 1e-6 && Math.abs(info.outletY - 0.30) < 1e-6 && info.baseClear === true);

  const hb = await bbox('housing');
  const ob = await bbox('outlet');
  const baseB = await bbox('base');
  check('S6 机壳包住双孔（高度 > 0.6、宽度 > 0.5）', hb.size[1] > 0.6 && hb.size[2] > 0.5, JSON.stringify(hb.size));
  check('S7 排气管伸到底架下方，不被底座封死', ob.min[1] < baseB.max[1] && ob.max[1] > 0.4, `outlet ${ob.min[1]}..${ob.max[1]} / base top ${baseB.max[1].toFixed(3)}`);

  await page.evaluate(() => window.__chem3d.scene.setQuality('high'));
  await page.locator('.canvas-toolbar,.canvas-mode-chip,.endo-hud,.toast-stack,.loading-overlay').evaluateAll((els) => els.forEach((e) => (e.style.display = 'none')));
  await tab('剖视');
  const ax = await activeAxis();
  check('S8 螺杆压缩机剖视预设为 Z 向、50%、反向', ax.axis.includes('Z') && ax.flip === true && ax.slider === '50', JSON.stringify(ax));
  const camZ = await page.evaluate(() => +window.__chem3d.scene.camera.position.z.toFixed(3));
  check('S9 剖视预设从 +Z 纵向观察', camZ > 1.2, String(camZ));
  await page.locator('.canvas-wrap').screenshot({ path: path.join(OUT, 'screw-section.png') });

  await tab('工作原理');
  const pathInfo = await page.evaluate(() => {
    const p = window.__chem3d.scene.principle;
    const a = p.paths[0](0, 0); const b = p.paths[0](1, 0);
    return { start: [a.x, a.y, a.z], end: [b.x, b.y, b.z], particles: p.particles.length };
  });
  check('S10 原理气体路径从顶部进气端到底部排气端', pathInfo.start[1] > 1.0 && pathInfo.end[1] < 0.25 && pathInfo.start[0] < -0.3 && pathInfo.end[0] > 0.3, JSON.stringify(pathInfo));
  const rot0 = await page.evaluate(() => ({ m: window.__chem3d.scene.parts.get('maleRotor').group.rotation.x, f: window.__chem3d.scene.parts.get('femaleRotor').group.rotation.x }));
  await page.waitForFunction((r0) => window.__chem3d.scene.parts.get('maleRotor').group.rotation.x > r0 + 0.05, rot0.m, { timeout: 10000 }).catch(() => {});
  const rot1 = await page.evaluate(() => ({ m: window.__chem3d.scene.parts.get('maleRotor').group.rotation.x, f: window.__chem3d.scene.parts.get('femaleRotor').group.rotation.x }));
  check('S11 阴阳转子反向旋转', rot1.m > rot0.m && rot1.f < rot0.f, JSON.stringify({ rot0, rot1 }));
  await page.locator('.canvas-wrap').screenshot({ path: path.join(OUT, 'screw-principle.png') });

  await tab('整体观察');
  await page.locator('[data-action=parts]').click();
  await page.locator('.tree-item').filter({ hasText: '排气口' }).first().click();
  await wait(400);
  const sel = await page.evaluate(() => {
    const s = window.__chem3d.scene;
    return { selected: s.selected, emissive: s.parts.get('outlet').materials.some((m) => m.emissive.getHex() !== 0) };
  });
  check('S12 排气口可点选并高亮', sel.selected === 'outlet' && sel.emissive, JSON.stringify(sel));
}

await browser.close();
check('Z 全程无控制台错误', errors.length === 0, errors.join(' | '));
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ results, errors }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
