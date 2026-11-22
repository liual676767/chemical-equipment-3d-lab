/**
 * 发布后走查：线上环境完整「进入 → 离心泵引导拆装 16 步 → 完成」流程，
 * 以及组装工坊「入口 → 零件库 → 放置两根直管 → 接口连接 → 任务面板 → 保存重开」。
 * 纯 DOM 操作（生产构建无调试句柄）。WALK_BASE 覆盖地址。
 */
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.WALK_BASE ?? 'https://chem-equipment-3d-lab-r44x9hkn4ne.qoder.zone/';
const OUT = path.resolve('outputs/verify');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const consoleErrors = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  ...browserOptions, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });
const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), timeout: 60000 });

await page.goto(BASE + '#/library');
await page.waitForSelector('.device-card', { timeout: 30000 });
await wait(1500);
check('线上设备库可访问且 18 张卡片齐全', await page.evaluate(() => document.querySelectorAll('.device-card').length) === 18);
await shot('published-01-home');

await page.evaluate(() => { [...document.querySelectorAll('.card-enter')][0].click(); });
await page.waitForSelector('.canvas-wrap canvas', { timeout: 30000 });
await wait(1500);
check('线上进入离心泵工作台', await page.evaluate(() => document.querySelector('.wb-device-name')?.textContent.includes('离心泵')));
await page.evaluate(() => { [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.includes('拆装练习')).click(); });
await wait(800);
check('线上引导练习启动（步骤 1/16）', await page.evaluate(() => document.querySelector('.step-text')?.textContent.includes('1 / 16')));
await shot('published-02-practice-start');

const clickAction = (label) => page.evaluate((t) => {
  const b = [...document.querySelectorAll('.practice-actions button')].find((x) => x.textContent === t);
  if (b) { b.click(); return true; }
  return false;
}, label);

for (let i = 0; i < 20; i++) {
  const done = await page.evaluate(() => document.querySelector('.completion-overlay')?.style.display !== 'none');
  if (done) break;
  const step = await page.evaluate(() => {
    const inst = document.querySelector('.practice-instruction');
    const title = inst?.querySelector('strong')?.textContent ?? '';
    const m = title.match(/^(拆卸|安装)\s*(.+?)：?$/);
    return m ? { action: m[1], name: m[2].replace(/：$/, '') } : null;
  });
  if (!step) { console.log('no step parsed, stop'); break; }
  await page.evaluate((name) => {
    const item = [...document.querySelectorAll('.tree-item')].find((x) => x.querySelector('.tree-name')?.textContent === name) ?? [...document.querySelectorAll('.tree-item')].find((x) => x.textContent.includes(name));
    if (!item) throw new Error('tree item not found: ' + name);
    item.click();
  }, step.name);
  await wait(250);
  if (step.action === '拆卸') {
    await clickAction('拆下选中零件');
  } else {
    for (let k = 0; k < 3; k++) { if (await clickAction('旋转 90°')) await wait(120); }
    await clickAction('安装到位置');
  }
  await wait(650);
}
await wait(800);
check('线上引导拆装 16 步完成弹窗', await page.evaluate(() => document.querySelector('.completion-overlay')?.style.display !== 'none'));
check('线上完成统计可见', await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.completion-stat .cs-label')].map((x) => x.textContent);
  const hasAll = ['用时', '错误次数', '提示次数', '完成方式'].every((t) => cells.includes(t));
  const errs = [...document.querySelectorAll('.completion-stat')].find((c) => c.querySelector('.cs-label')?.textContent === '错误次数')?.querySelector('.cs-value')?.textContent;
  const reviewBlock = !!document.querySelector('.error-steps');
  return hasAll && (errs === '0' ? !reviewBlock : reviewBlock);
}));
const settle = async () => {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  await wait(600);
};
await settle();
await shot('published-03-completion');
check('线上完成记录写入本地存储', await page.evaluate(() => (JSON.parse(localStorage.getItem('chem3d-lab:v1'))?.devices?.pump?.completions ?? 0) >= 1));
check('线上观察任务自动记录', await page.evaluate(() => JSON.parse(localStorage.getItem('chem3d-lab:v1'))?.devices?.pump?.tasks?.['p-practice'] === true));

/* ---------- 新设备线上走查：法兰球阀引导拆装 10 步 ---------- */
await page.goto(BASE + '#/device/ball-valve');
await page.waitForSelector('.canvas-wrap canvas', { timeout: 30000 });
await wait(1500);
check('线上直达法兰球阀工作台', await page.evaluate(() => document.querySelector('.wb-device-name')?.textContent.includes('球阀') && document.querySelectorAll('.tree-item').length === 9));
await page.evaluate(() => { [...document.querySelectorAll('.mode-tab')].find((b) => b.textContent.includes('拆装练习')).click(); });
await wait(800);
check('线上球阀引导练习启动（步骤 1/14）', await page.evaluate(() => document.querySelector('.step-text')?.textContent.includes('1 / 14')));
for (let i = 0; i < 20; i++) {
  const done = await page.evaluate(() => document.querySelector('.completion-overlay')?.style.display !== 'none');
  if (done) break;
  const step = await page.evaluate(() => {
    const inst = document.querySelector('.practice-instruction');
    const title = inst?.querySelector('strong')?.textContent ?? '';
    const m = title.match(/^(拆卸|安装)\s*(.+?)：?$/);
    return m ? { action: m[1], name: m[2].replace(/：$/, '') } : null;
  });
  if (!step) break;
  await page.evaluate((name) => {
    const item = [...document.querySelectorAll('.tree-item')].find((x) => x.textContent.includes(name));
    if (!item) throw new Error('tree item not found: ' + name);
    item.click();
  }, step.name);
  await wait(250);
  if (step.action === '拆卸') {
    await clickAction('拆下选中零件');
  } else {
    for (let k = 0; k < 3; k++) { if (await clickAction('旋转 90°')) await wait(120); }
    await clickAction('安装到位置');
  }
  await wait(650);
}
await wait(800);
check('线上球阀引导拆装 14 步完成弹窗', await page.evaluate(() => document.querySelector('.completion-overlay')?.style.display !== 'none'));
check('线上球阀完成记录写入本地存储', await page.evaluate(() => (JSON.parse(localStorage.getItem('chem3d-lab:v1'))?.devices?.['ball-valve']?.completions ?? 0) >= 1));
await settle();
await shot('published-07-ball-valve-completion');

/* ---------- 组装工坊线上走查 ---------- */
await page.evaluate(() => { location.hash = '#/library'; });
await page.waitForSelector('.module-entry[data-module="workshop"]', { timeout: 30000 });
check('线上首页有组装工坊入口', await page.evaluate(() => document.querySelector('.module-entry[data-module="workshop"]')?.textContent.includes('组装工坊')));
await page.evaluate(() => document.querySelector('.module-entry[data-module="workshop"]').click());
await page.waitForSelector('.ws-canvas canvas', { timeout: 30000 });
await wait(1500);
check('线上工坊零件库 55 对象 / 31 开发中', await page.evaluate(() => document.querySelectorAll('.ws-part').length === 55 && document.querySelectorAll('.ws-part.dev').length === 31));
check('线上开发中对象资料可展开', await page.evaluate(() => {
  const dev = document.querySelector('.ws-part.dev');
  dev.querySelector('.ws-part-name').click();
  return dev.classList.contains('expanded') && dev.querySelector('.ws-part-detail').textContent.includes('用途');
}));
await shot('published-04-workshop-library');

const box = await page.locator('.ws-canvas').boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
const placePipe = async (x, y) => {
  await page.evaluate(() => {
    const item = [...document.querySelectorAll('.ws-part')].find((p) => p.querySelector('.ws-part-name')?.textContent === '直管');
    [...item.querySelectorAll('button')].find((b) => b.textContent === '添加到场景').click();
  });
  await wait(250);
  await page.mouse.move(x, y);
  await wait(200);
  await page.mouse.click(x, y);
  await wait(500);
};
await placePipe(cx, cy);
await placePipe(cx + 160, cy);
const sideTab = (label) => page.evaluate((t) => { [...document.querySelectorAll('.ws-side-tab')].find((b) => b.textContent === t).click(); }, label);
await sideTab('接口连接');
await wait(250);
check('线上选中直管列出两端接口', await page.evaluate(() => document.querySelectorAll('.ws-port-row').length === 2));
await page.evaluate(() => { [...document.querySelectorAll('.ws-port-row button')].find((b) => b.textContent === '开始连接').click(); });
await wait(350);
const candCount = await page.evaluate(() => document.querySelectorAll('.ws-cand-row').length);
check('线上合法连接目标已列出', candCount >= 1, String(candCount));
await page.evaluate(() => { document.querySelector('.ws-cand-row button').click(); });
await wait(700);
await sideTab('选中对象');
await wait(250);
check('线上两根直管完成焊接连接', await page.evaluate(() => document.querySelector('.ws-conns h3')?.textContent.includes('连接（1）')));
await shot('published-05-workshop-connected');
await page.keyboard.press('Escape');
await wait(250);
check('线上场景统计 2 零件 1 连接', await page.evaluate(() => {
  const t = [...document.querySelectorAll('.ws-stat')].map((x) => x.textContent).join('|');
  return t.includes('零件 2') && t.includes('连接 1');
}));
await sideTab('组装任务');
await wait(250);
check('线上 10 个任务 / 1 个第二批锁定', await page.evaluate(() => document.querySelectorAll('.ws-task-row').length === 10 && document.querySelectorAll('.ws-task-row.locked').length === 1));
check('线上含储罐输送教学装置任务且未锁定', await page.evaluate(() => {
  const row = [...document.querySelectorAll('.ws-task-row')].find((r) => r.textContent.includes('储罐输送教学装置'));
  return !!row && !row.classList.contains('locked');
}));
await page.evaluate(() => { [...document.querySelectorAll('.ws-task-row button')].find((b) => b.textContent === '开始').click(); });
await wait(350);
check('线上任务启动显示目标与检查按钮', await page.evaluate(() => !!document.querySelector('.ws-task-goal') && [...document.querySelectorAll('button')].some((b) => b.textContent === '检查完成情况')));
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent === '退出任务').click(); });
await wait(250);
await page.evaluate(() => { [...document.querySelectorAll('.ws-top button')].find((b) => b.textContent === '保存').click(); });
await wait(400);
await page.reload();
await page.waitForSelector('.ws-canvas canvas', { timeout: 30000 });
await wait(1500);
check('线上刷新后零件与连接恢复', await page.evaluate(() => {
  const t = [...document.querySelectorAll('.ws-stat')].map((x) => x.textContent).join('|');
  return t.includes('零件 2') && t.includes('连接 1');
}));
await shot('published-06-workshop-restored');

/* ---------- 化工厂全流程线上走查 ---------- */
await page.evaluate(() => { location.hash = '#/library'; });
await page.waitForSelector('.device-card', { timeout: 30000 });
await wait(600);
check('线上首页有化工厂全流程入口', await page.evaluate(() => document.querySelector('[data-nav="plant"]')?.textContent.includes('化工厂全流程装置')));
await page.evaluate(() => { document.querySelector('.site-drop-btn').click(); document.querySelector('.site-drop-menu [data-nav="plant"]').click(); });
await page.waitForSelector('.plant-page', { timeout: 30000 });
await wait(2200);
check('线上全流程页渲染画布、20 个设备标签与 11 道工序', await page.evaluate(() =>
  !!document.querySelector('.plant-canvas') && document.querySelectorAll('.plant-label').length === 20 && document.querySelectorAll('.plant-step').length === 11));
await page.evaluate(() => { document.querySelector('.plant-hint .plant-btn').click(); });
await wait(600);
check('线上全流程可启动运行', await page.evaluate(() => document.querySelector('.plant-status')?.textContent.includes('运行中')));
await page.evaluate(() => { [...document.querySelectorAll('.plant-label')].find((b) => b.textContent.includes('T-102'))?.click(); });
await wait(350);
check('线上全流程可选中设备并展示信息卡', await page.evaluate(() => document.querySelector('.plant-card')?.textContent.includes('分离塔')));
check('线上全流程数据关系自检 0 问题且连接/管线/流向 100%', await page.evaluate(() => {
  const a = window.__plant?.audit();
  return !!a && a.issues.length === 0 && a.nodeConnection === 100 && a.pipeIntegrity === 100 && a.flowDirection === 100 && a.runtime?.pipesBuilt === 24;
}));
check('线上全流程 7 层 / 24 管线 / 4 台内联阀', await page.evaluate(() =>
  window.__plant?.layerCount === 7 && window.__plant?.pipeCount === 24 && window.__plant?.audit()?.runtime?.valvesInline === 4));
await page.evaluate(() => window.__plant.setMode('piping'));
await wait(600);
check('线上管道模式与管线编号标签可用', await page.evaluate(() =>
  window.__plant.mode === 'piping' && [...document.querySelectorAll('.plant-pipe-label')].some((el) => getComputedStyle(el).display !== 'none')));
await page.evaluate(() => window.__plant.setValveState('BV-101', 'closed'));
await wait(400);
check('线上阀门关闭后下游断流', await page.evaluate(() =>
  window.__plant.valveState('BV-101') === 'closed' && window.__plant.pipeFlow('PL-102')?.state === 'halt' && window.__plant.pipeFlow('PL-103')?.state === 'off'));
await page.evaluate(() => window.__plant.setValveState('BV-101', 'open'));
await wait(300);
check('线上阀门恢复后流动恢复', await page.evaluate(() => window.__plant.pipeFlow('PL-102')?.state === 'full' && window.__plant.pipeFlow('PL-103')?.state === 'full'));
check('线上上下游追踪可用', await page.evaluate(() => {
  const t = window.__plant.trace('T-102', 'both');
  return t.nodes.includes('F-101') && t.nodes.includes('CY-101') && t.nodes.includes('P-103') && t.pipes.includes('PL-107');
}));
await page.evaluate(() => { [...document.querySelectorAll('.plant-topbar .plant-btn')].find((b) => b.textContent.includes('流程图'))?.click(); });
await wait(500);
check('线上流程图可打开并含 20 个设备节点', await page.evaluate(() => {
  const panel = document.querySelector('.plant-map');
  return panel && panel.style.display !== 'none' && panel.querySelectorAll('.plant-map-node').length === 20;
}));
await shot('published-07-plant');
await page.evaluate(() => { location.hash = '#/library'; });
await page.waitForSelector('.device-card', { timeout: 30000 });
check('线上可返回设备库', await page.evaluate(() => document.querySelectorAll('.device-card').length === 18));

const realErrors = consoleErrors.filter((e) => !e.includes('favicon'));
check('线上走查无控制台错误', realErrors.length === 0, realErrors.slice(0, 5).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT, 'report-published.json'), JSON.stringify({ base: BASE, results, consoleErrors: realErrors }, null, 2));
console.log(`\n==== PUBLISHED ${results.length - failed.length}/${results.length} passed ====`);
if (failed.length) { console.log('FAILED:', failed.map((f) => f.name).join('; ')); process.exit(1); }