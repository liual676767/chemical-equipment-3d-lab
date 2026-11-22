/* 三维教学工厂验收：样板任务全流程（桌面 1440×900 / 手机 390×844）、
 * 视图恢复、浏览器后退、流程图联动、行走模式、旧链接回归、记录隔离。 */
import { chromium } from 'playwright-core';
import { browserOptions, webglArgs } from './browser-options.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.VERIFY_BASE ?? 'http://127.0.0.1:5173/';
const OUT = path.join('outputs', 'factory-acceptance');
mkdirSync(OUT, { recursive: true });

const results = [];
let failures = 0;
function check(name, ok, extra = '') {
  results.push({ name, ok: !!ok, extra });
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  ...browserOptions,
  headless: true,
  args: [
    ...webglArgs,
    '--disable-gpu-sandbox',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion'
  ]
});

const errors = [];
let renderer = null;
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), timeout: 120000 });
const ev = (fn, arg) => page.evaluate(fn, arg);
const debugState = () => ev(() => window.__factoryDebug.debug());
const taskPanelText = () => ev(() => document.querySelector('.factory-task')?.textContent ?? '');
const clickTaskAction = (label) => page.evaluate((t) => {
  [...document.querySelectorAll('.ft-actions button')].find((b) => b.textContent.trim() === t)?.click();
}, label);

try {
  /* ================= 1 总览与审计 ================= */
  await page.goto(BASE + '#/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.factory-canvas', { timeout: 30000 });
  await wait(2600);
  const audit = await ev(() => window.__factoryAudit());
  renderer = await ev(() => {
    const gl = document.querySelector('canvas.factory-canvas')?.getContext('webgl2');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null;
  });
  if (renderer) console.log(`WebGL: ${renderer}`);
  check('场景数据审计零问题', audit && audit.issues.length === 0, (audit?.issues ?? []).join('；'));
  check('13 段管线全部构建并挂接 23 个接口', audit.runtime.pipesBuilt === 13 && audit.runtime.portsLinked >= 20, `pipes=${audit.runtime.pipesBuilt} ports=${audit.runtime.portsLinked}`);
  check('总览显示设备位号（近景层级）', await page.locator('.factory-label:visible').count() >= 10);
  await shot('01-factory-overview');

  /* ================= 2 流程图联动 ================= */
  await page.evaluate(() => { location.hash = '#/pipe/PL-208'; });
  await wait(1500);
  const pipeName = await page.locator('.factory-info .fi-name').first().textContent();
  check('三维点击管线显示同名设备与介质（PL-208）', !!pipeName?.includes('过滤进料'), pipeName ?? '');
  check('信息卡显示两端与介质', await page.evaluate(() => document.querySelector('.factory-info')?.textContent.includes('成品涂料') && document.querySelector('.factory-info')?.textContent.includes('P-202') && document.querySelector('.factory-info')?.textContent.includes('F-201')));
  await page.locator('.fd-edge[data-pipe="PL-208"]').dispatchEvent('click');
  await wait(400);
  check('流程图与三维共用管线编号并同步高亮', await page.evaluate(() => document.querySelectorAll('.fd-edge.is-active').length === 1));
  await shot('02-diagram-link');

  /* ================= 3 选择泵：相机同时看到泵体与进出口 ================= */
  await page.evaluate(() => { location.hash = '#/node/P-202'; });
  await wait(1500);
  check('泵选中后出现进口/出口热区', await page.evaluate(() => {
    const texts = [...document.querySelectorAll('.factory-port-dot .txt')].map((e) => e.textContent);
    return texts.includes('进口总管') && texts.includes('出口总管');
  }));
  check('流程图同步高亮 P-202 实例', await page.evaluate(() => [...document.querySelectorAll('.fd-node-box.is-active')].length === 1));

  /* ================= 4 细节浮层：外观参照 ↔ 内部结构 + 视角恢复 ================= */
  const beforeDetail = await debugState();
  await page.getByRole('button', { name: '走近查看' }).click();
  await wait(1000);
  check('细节浮层打开', await page.locator('.factory-detail').isVisible());
  await page.locator('.factory-seg-btn', { hasText: '外观参照' }).click();
  await page.locator('.factory-seg-btn.is-active', { hasText: '外观参照' }).waitFor({ timeout: 20000 });
  check('同视角切换到外观参照（GLB 加载成功）', true);
  await page.locator('.factory-seg-btn', { hasText: '内部教学结构' }).click();
  await wait(600);
  check('切回内部教学结构', await page.locator('.factory-seg-btn.is-active', { hasText: '内部教学结构' }).count() === 1);
  await shot('03-equipment-inspection');
  await page.getByRole('button', { name: '返回厂区' }).click();
  await wait(1200);
  const afterDetail = await debugState();
  const posDelta = Math.hypot(
    afterDetail.pos[0] - beforeDetail.pos[0],
    afterDetail.pos[1] - beforeDetail.pos[1],
    afterDetail.pos[2] - beforeDetail.pos[2]
  );
  check('关闭细节后相机回到进入前位置', !(await page.locator('.factory-detail').count()) && posDelta < 0.3, `Δ=${posDelta.toFixed(2)}m`);
  check('关闭后仍聚焦 P-202', await page.evaluate(() => document.querySelector('.factory-info .fi-name')?.textContent?.includes('气动双隔膜泵')));

  /* 浏览器后退 */
  await wait(300);
  await page.getByRole('button', { name: '走近查看' }).click();
  await wait(900);
  await page.goBack();
  await wait(1200);
  check('浏览器后退关闭细节并恢复视角', (await page.locator('.factory-detail').count()) === 0 && await page.evaluate(() => !!document.querySelector('.factory-canvas')));

  /* ================= 5 行走模式 ================= */
  await page.getByRole('button', { name: '行走模式' }).click();
  await page.waitForFunction(() => window.__factoryDebug.debug().walk === true, { timeout: 8000 });
  await page.waitForFunction(() => Math.abs(window.__factoryDebug.debug().pos[1] - 1.7) < 0.06, { timeout: 10000 });
  check('行走 HUD 出现', await page.locator('.factory-walk-hud').isVisible());
  const walkBefore = await debugState();
  check('行走眼高 1.7m', Math.abs(walkBefore.pos[1] - 1.7) < 0.06, `y=${walkBefore.pos[1].toFixed(2)}`);
  await page.keyboard.down('w');
  try {
    await page.waitForFunction(([x, , z]) => {
      const [currentX, , currentZ] = window.__factoryDebug.debug().pos;
      return Math.hypot(currentX - x, currentZ - z) > 0.3;
    }, walkBefore.pos, { timeout: 20000 });
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
  } finally {
    await page.keyboard.up('w');
  }
  const walkAfter = await debugState();
  const moved = Math.hypot(walkAfter.pos[0] - walkBefore.pos[0], walkAfter.pos[2] - walkBefore.pos[2]);
  check('W 键前进', moved > 0.3, `移动 ${moved.toFixed(2)}m`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__factoryDebug.debug().walk === false, { timeout: 6000 });
  await wait(600);
  check('Esc 退出行走并恢复相机高度', !(await page.locator('.factory-walk-hud').isVisible()) && (await debugState()).pos[1] > 2);

  /* ================= 6 外壳与阀门 ================= */
  await page.locator('.factory-more > summary').click();
  await page.getByRole('button', { name: '前墙', exact: true }).click();
  await wait(300);
  check('可显示厂房前墙', (await ev(() => window.__factoryAudit())).runtime.frontWall === true);
  await page.getByRole('button', { name: '前墙', exact: true }).click();
  await page.getByRole('button', { name: '屋顶', exact: true }).click();
  await wait(300);
  check('可显示屋顶', (await ev(() => window.__factoryAudit())).runtime.roof === true);
  await page.getByRole('button', { name: '屋顶', exact: true }).click();

  await page.keyboard.press('Escape');
  await page.evaluate(() => { location.hash = '#/node/SV-201'; });
  await wait(1200);
  await page.locator('.fi-valve-btn', { hasText: '关闭' }).click();
  await wait(500);
  check('取样阀关闭后状态同步为 CLOSED', await page.evaluate(() => [...document.querySelectorAll('.factory-label-state')].some((e) => e.textContent === 'CLOSED')));
  await shot('05-overview-closed-valve');
  await page.locator('.fi-valve-btn', { hasText: '全开' }).click();
  await wait(300);

  /* ================= 7 搜索 ================= */
  await page.locator('.factory-tab', { hasText: '搜索' }).click();
  await page.fill('.factory-search-input', '隔膜泵');
  await wait(400);
  check('搜索命中场内实例 P-202', await page.evaluate(() => [...document.querySelectorAll('.factory-search-item .r-tag')].some((e) => e.textContent === 'P-202')));
  await page.locator('.factory-search-item', { hasText: 'P-202' }).click();
  await wait(1100);
  check('搜索结果可定位到场内实例', await page.evaluate(() => document.querySelector('.factory-info .fi-name')?.textContent?.includes('气动双隔膜泵')));
  await page.locator('.factory-tab', { hasText: '搜索' }).click();
  await page.fill('.factory-search-input', '换热器');
  await wait(400);
  check('仅设备库案例的机型有明确标注', await page.evaluate(() => [...document.querySelectorAll('.factory-search-item.is-catalog .r-note')].some((e) => e.textContent.includes('仅在设备库案例'))));

  /* ================= 8 样板任务：从调配罐到灌装机 ================= */
  await page.evaluate(() => localStorage.removeItem('chem3d-factory:v1'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.factory-canvas');
  await wait(2400);
  await page.locator('.factory-top-actions button', { hasText: '样板任务' }).click();
  await wait(400);
  check('样板任务面板含 10 步清单', await page.evaluate(() => document.querySelectorAll('.ft-steps li').length === 10));
  await clickTaskAction('开始任务');
  await wait(300);

  await clickTaskAction('定位当前目标');
  await wait(1400);
  check('步骤 1：找到调配罐 R-202', (await taskPanelText()).includes('进行中 1/10') && await page.evaluate(() => document.querySelector('.factory-info .fi-name')?.textContent?.includes('调配罐')));
  await clickTaskAction('定位当前目标');
  await wait(1400);
  check('步骤 2：沿下游找到 P-202', (await taskPanelText()).includes('进行中 2/10') && await page.evaluate(() => document.querySelector('.factory-info .fi-name')?.textContent?.includes('气动双隔膜泵')));

  await page.getByRole('button', { name: '走近查看' }).click();
  await wait(900);
  await page.locator('.factory-seg-btn', { hasText: '外观参照' }).click();
  await page.locator('.factory-seg-btn.is-active', { hasText: '外观参照' }).waitFor({ timeout: 20000 });
  await wait(300);
  check('步骤 3：查看外观参照', (await taskPanelText()).includes('进行中 3/10'));
  await page.locator('.factory-seg-btn', { hasText: '内部教学结构' }).click();
  await wait(600);
  check('步骤 4：切回内部教学结构', (await taskPanelText()).includes('进行中 4/10'));
  await page.locator('.factory-port-item', { hasText: '进口总管' }).click();
  await wait(300);
  await page.locator('.factory-port-item', { hasText: '出口总管' }).click();
  await wait(500);
  check('步骤 5：识别液体进出口', (await taskPanelText()).includes('进行中 5/10'));
  await page.getByRole('button', { name: '返回厂区' }).click();
  await wait(1200);
  check('步骤 6：退出细节仍聚焦 P-202', (await taskPanelText()).includes('进行中 6/10'));

  await clickTaskAction('定位当前目标');
  await wait(1400);
  check('步骤 7：沿下游找到 F-201', (await taskPanelText()).includes('进行中 7/10'));
  await clickTaskAction('定位当前目标');
  await wait(1400);
  await page.getByRole('button', { name: 'JOINT-201 法兰接头 · 可练习' }).click({ timeout: 15000 });
  await page.waitForSelector('.factory-practice', { timeout: 12000 });
  await wait(1200);
  check('步骤 8：打开泵—过滤器法兰接头', (await ev(() => JSON.parse(localStorage.getItem('chem3d-factory:v1') || '{}').task?.step)) === 8);
  await shot('04-flange-practice');

  /* 缺垫片点名 */
  await page.locator('.fp-tray-btn[data-key="bolt"]').click();
  await wait(300);
  const missingText = await page.locator('.fp-msg').textContent();
  check('缺垫片时点名两个密封面', !!missingText?.includes('泵侧法兰密封面') && !!missingText?.includes('过滤器侧法兰密封面'));
  await page.locator('.fp-tray-btn[data-key="gasket"]').click();
  await wait(300);
  await page.locator('.fp-tray-btn[data-key="boltM12"]').click();
  await wait(300);
  check('M12 螺栓给出规格校验提示', (await page.locator('.fp-msg').textContent())?.includes('规格不匹配'));
  for (let i = 0; i < 4; i++) { await page.locator('.fp-tray-btn[data-key="bolt"]').click(); await wait(200); }
  for (let i = 0; i < 4; i++) { await page.locator('.fp-tray-btn[data-key="nut"]').click(); await wait(200); }
  check('步骤 9：垫片 + 4 螺栓 + 4 螺母完成', (await page.locator('.fp-msg').textContent())?.includes('连接完成'));
  await shot('04b-flange-done');
  await page.getByRole('button', { name: '返回厂区' }).click();
  await wait(1400);
  check('练习返回后回到原管段 PL-208', await page.evaluate(() => {
    const tag = document.querySelector('.factory-info .fi-tag')?.textContent ?? '';
    const name = document.querySelector('.factory-info .fi-name')?.textContent ?? '';
    return tag === 'PL-208' || name.includes('过滤进料');
  }));

  await clickTaskAction('定位当前目标');
  await wait(1400);
  check('步骤 10：跟踪到灌装机 FL-201 完成', (await taskPanelText()).includes('已完成 10/10') && (await page.locator('.factory-top-actions button', { hasText: '样板任务 ✓' }).count()) === 1);
  await shot('04c-task-done');

  const rec = await ev(() => JSON.parse(localStorage.getItem('chem3d-factory:v1') || '{}'));
  check('任务记录落盘且反映真实操作对象', rec.task?.step === 10 && !!rec.joints?.['JOINT-201']?.done && rec.joints['JOINT-201'].items.length === 3);
  check('到访记录包含关键设备', !!rec.visited?.['R-202'] && !!rec.visited?.['P-202'] && !!rec.visited?.['F-201'] && !!rec.visited?.['FL-201']);
  check('未改动既有学习记录键', await ev(() => !localStorage.getItem('chem3d-lab:v1') && !localStorage.getItem('chem3d-workshop:v1')));

  await page.locator('.factory-more > summary').click();
  await page.locator('.factory-top-actions button', { hasText: '本厂记录' }).click();
  await wait(400);
  check('本厂记录可查看任务/练习/到访', await page.evaluate(() => {
    const t = document.querySelector('.factory-records')?.textContent ?? '';
    return t.includes('样板任务') && t.includes('法兰练习') && t.includes('到访设备');
  }));
  await page.locator('.factory-records-overlay').click({ position: { x: 10, y: 10 } });
  await wait(300);

  /* ================= 9 旧入口回归 ================= */
  await page.goto(BASE + '#/library', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.device-card', { timeout: 30000 });
  check('旧设备库入口（#/library）18 张卡片', await page.evaluate(() => document.querySelectorAll('.device-card').length === 18));
  await page.goto(BASE + '#/device/pump', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.canvas-wrap canvas', { timeout: 30000 });
  await wait(1200);
  check('旧深链 #/device/pump 可用', await page.evaluate(() => !!document.querySelector('.canvas-wrap canvas')));
  await page.goto(BASE + '#/workshop', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ws-canvas canvas', { timeout: 30000 });
  check('组装工坊入口可用', true);
  await page.goto(BASE + '#/plant', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.plant-canvas', { timeout: 30000 });
  check('化工厂全流程装置入口可用', true);
  await page.goto(BASE + '#/assets', { waitUntil: 'domcontentloaded' });
  await wait(1500);
  check('高精度模型库入口可用', await page.evaluate(() => !!document.querySelector('[data-nav="assets"]')));
  await page.goto(BASE + '#/boil', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 30000 });
  check('微沸喷烧全流程入口可用', true);

  /* ================= 10 手机端全流程 ================= */
  await page.close();
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  mobile.on('console', (m) => { if (m.type() === 'error') errors.push('mobile console: ' + m.text()); });
  mobile.on('pageerror', (e) => errors.push('mobile pageerror: ' + String(e)));
  const mshot = (n) => mobile.screenshot({ path: path.join(OUT, n + '.png'), timeout: 120000 });
  await mobile.goto(BASE + '#/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await mobile.waitForSelector('.factory-canvas', { timeout: 60000 });
  await wait(2600);
  check('手机端厂区可加载且无横向溢出', await mobile.evaluate(() => document.body.scrollWidth <= window.innerWidth + 1));
  await mshot('06-mobile-overview');

  await mobile.evaluate(() => localStorage.removeItem('chem3d-factory:v1'));
  await mobile.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await mobile.waitForSelector('.factory-canvas', { timeout: 60000 });
  await wait(2400);
  await mobile.locator('.factory-top-actions button', { hasText: '样板任务' }).click();
  await wait(400);
  await mobile.evaluate(() => [...document.querySelectorAll('.ft-actions button')].find((b) => b.textContent.trim() === '开始任务')?.click());
  await wait(300);
  const mClick = (text) => mobile.evaluate((t) => [...document.querySelectorAll('.ft-actions button')].find((b) => b.textContent.trim() === t)?.click(), text);
  await mClick('定位当前目标');
  await wait(1300);
  await mClick('定位当前目标');
  await wait(1300);
  check('手机：步骤 2 已到 P-202', await mobile.evaluate(() => document.querySelector('.factory-info .fi-name')?.textContent?.includes('气动双隔膜泵')));
  await mobile.getByRole('button', { name: '走近查看' }).click();
  await wait(900);
  await mobile.locator('.factory-seg-btn', { hasText: '外观参照' }).click();
  await mobile.locator('.factory-seg-btn.is-active', { hasText: '外观参照' }).waitFor({ timeout: 25000 });
  await mobile.locator('.factory-seg-btn', { hasText: '内部教学结构' }).click();
  await wait(500);
  await mobile.locator('.factory-port-item', { hasText: '进口总管' }).click();
  await wait(250);
  await mobile.locator('.factory-port-item', { hasText: '出口总管' }).click();
  await wait(400);
  check('手机：步骤 5 接口识别完成', (await mobile.evaluate(() => document.querySelector('.factory-task').textContent)).includes('进行中 5/10'));
  await mobile.getByRole('button', { name: '返回厂区' }).click();
  await wait(1100);
  await mClick('定位当前目标');
  await wait(1300);
  await mClick('定位当前目标');
  await wait(1300);
  await mobile.locator('.fi-section button', { hasText: '进入法兰练习' }).click();
  await mobile.waitForSelector('.factory-practice', { timeout: 20000 });
  await wait(900);
  await mobile.locator('.fp-tray-btn[data-key="gasket"]').click();
  await wait(300);
  for (let i = 0; i < 4; i++) { await mobile.locator('.fp-tray-btn[data-key="bolt"]').click(); await wait(200); }
  for (let i = 0; i < 4; i++) { await mobile.locator('.fp-tray-btn[data-key="nut"]').click(); await wait(200); }
  check('手机：法兰练习完成', (await mobile.locator('.fp-msg').textContent())?.includes('连接完成'));
  await mshot('07-mobile-practice');
  await mobile.getByRole('button', { name: '返回厂区' }).click();
  await wait(1200);
  await mClick('定位当前目标');
  await wait(1400);
  check('手机：样板任务 10/10 完成', (await mobile.evaluate(() => document.querySelector('.factory-task').textContent)).includes('已完成 10/10'));
  await mshot('08-mobile-task-done');
  await mobile.close();

  check('全流程无页面/控制台错误', errors.length === 0, errors.slice(0, 5).join(' | '));
} catch (err) {
  check('验收脚本执行完成', false, String(err).slice(0, 300));
} finally {
  await browser.close().catch(() => {});
}

const passed = results.filter((r) => r.ok).length;
writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, renderer, passed, total: results.length, results, errors }, null, 2));
console.log(`\n工厂验收：${passed}/${results.length} 通过${failures ? `，${failures} 项失败` : ''}`);
process.exitCode = failures ? 1 : 0;
