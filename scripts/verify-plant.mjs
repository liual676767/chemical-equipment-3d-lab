/* 化工厂全流程专项验证（第 8 轮：设备—接口—管线—阀门—流体—工序—工艺层）。
 * 运行：node scripts/verify-plant.mjs（默认 dev server 5173，可用 VERIFY_BASE 覆盖） */
import { chromium } from 'playwright-core';
import { browserOptions, webglArgs } from './browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.VERIFY_BASE ?? 'http://127.0.0.1:5173/';
const OUT = path.resolve('outputs/verify-plant');
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
  args: [...webglArgs, '--disable-gpu-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion']
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 960 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });

const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), timeout: 120000 });
const ev = (fn, arg) => page.evaluate(fn, arg);

/* ---------- 首页入口 ---------- */
await page.goto(BASE + '#/library', { waitUntil: 'networkidle' });
await page.waitForSelector('.device-card', { timeout: 30000 });
check('首页存在化工厂全流程入口', await ev(() => {
  const a = document.querySelector('[data-nav="plant"]');
  return !!a && a.textContent.includes('化工厂全流程装置');
}));
check('全流程入口保留设备目录', await ev(() => document.querySelectorAll('.device-card').length === 18 && !!document.querySelector('.module-entry[data-module="plant"]')));
await shot('plant-01-home');

await ev(() => { document.querySelector('.site-drop-btn').click(); });
await page.waitForTimeout(250);
await ev(() => { document.querySelector('.site-drop-menu [data-nav="plant"]').click(); });
await page.waitForSelector('.plant-page', { timeout: 30000 });
await page.waitForSelector('.plant-canvas', { timeout: 30000 });
await wait(2600);
check('路由进入 #/plant 并渲染页面', await ev(() => location.hash === '#/plant' && !!document.querySelector('.plant-canvas')));

/* ---------- 数据模型与连接关系 ---------- */
const api0 = await ev(() => ({
  nodes: window.__plant?.nodeCount,
  steps: window.__plant?.stepCount,
  pipes: window.__plant?.pipeCount,
  layers: window.__plant?.layerCount,
  running: window.__plant?.isRunning(),
  speed: window.__plant?.speed,
  audit: window.__plant?.audit()
}));
check('设备实例 20 个（18 种设备，储罐/换热器各复用一次）', api0.nodes === 20, String(api0.nodes));
check('工序 11 道、管线 24 根、工艺层 7 层', api0.steps === 11 && api0.pipes === 24 && api0.layers === 7, JSON.stringify({ steps: api0.steps, pipes: api0.pipes, layers: api0.layers }));
check('初始为暂停状态', api0.running === false);
check('流程自检无问题', api0.audit?.issues?.length === 0, JSON.stringify(api0.audit?.issues));
check('设备连接率 / 管线完整率 / 流向完整率 100%', api0.audit?.nodeConnection === 100 && api0.audit?.pipeIntegrity === 100 && api0.audit?.flowDirection === 100, JSON.stringify({ node: api0.audit?.nodeConnection, pipe: api0.audit?.pipeIntegrity, dir: api0.audit?.flowDirection }));
check('设备数据 / 内部结构 / 全开可达性 100%', api0.audit?.nodeData === 100 && api0.audit?.internals === 100 && api0.audit?.flowReach === 100);
check('24 根管线全部构建、37 个接口接入、4 台内联阀、3 台仪表', api0.audit?.runtime?.pipesBuilt === 24 && api0.audit?.runtime?.portsLinked === 37 && api0.audit?.runtime?.valvesInline === 4 && api0.audit?.runtime?.instrumentsBuilt === 3, JSON.stringify(api0.audit?.runtime));

check('设备标签 20 个、内联小件标签 6 个', await ev(() => document.querySelectorAll('.plant-label').length === 20 && document.querySelectorAll('.plant-label.minor').length === 6));
check('管线编号标签 24 个（DOM 就绪）', await ev(() => document.querySelectorAll('.plant-pipe-label').length === 24));
check('工艺层地面分区 9 块、标高尺标签 5 个', await ev(() => document.querySelectorAll('.plant-layer-label').length === 9 && document.querySelectorAll('.plant-ruler-label').length === 5));
check('启动提示收在更多菜单内', await ev(() => document.querySelector('.plant-hint').closest('details:not([open])') !== null));
await page.locator('.plant-more summary').click();
check('可查看启动说明且仍处于暂停', await page.locator('.plant-hint').isVisible() && await ev(() => !window.__plant.isRunning()));
await page.keyboard.press('Escape');
check('Esc 关闭更多菜单', !(await page.locator('.plant-hint').isVisible()));

/* ---------- 运行控制 ---------- */
await page.locator('.plant-run').click();
await wait(700);
check('点击启动按钮后开始运行', await ev(() => window.__plant.isRunning() === true && document.querySelector('.plant-status').textContent.includes('运行中')));
check('运行按钮切换为暂停', await ev(() => document.querySelector('.plant-run-text').textContent.includes('暂停')));
await wait(1200);

await ev(() => { document.querySelector('.plant-run').click(); });
await wait(300);
check('顶栏按钮可暂停', await ev(() => window.__plant.isRunning() === false && document.querySelector('.plant-status').textContent.includes('已暂停')));
await ev(() => { document.querySelector('.plant-run').click(); });
await wait(300);
check('顶栏按钮可继续运行', await ev(() => window.__plant.isRunning() === true));

await ev(() => {
  const sel = document.querySelector('.plant-speed select');
  sel.value = '2';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
});
check('速度切换为 2×', await ev(() => window.__plant.speed === 2));
await ev(() => {
  const sel = document.querySelector('.plant-speed select');
  sel.value = '1';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
});

/* ---------- 视图模式 ---------- */
const modeClick = async (label) => {
  await ev((l) => { [...document.querySelectorAll('.plant-mode-btn')].find((b) => b.textContent === l)?.click(); }, label);
  await wait(800);
};
await modeClick('管道');
check('管道模式生效（设备弱化、管线标签显示）', await ev(() => window.__plant.mode === 'piping' && document.querySelector('.plant-stage').dataset.mode === 'piping' && [...document.querySelectorAll('.plant-pipe-label')].some((el) => getComputedStyle(el).display !== 'none')));
await shot('plant-04-piping');
await modeClick('流体');
check('流体模式生效（管壁半透明）', await ev(() => window.__plant.mode === 'fluid' && document.querySelector('.plant-label-layer').dataset.mode === 'fluid'));
await shot('plant-05-fluid');
await modeClick('流程');
check('流程模式生效', await ev(() => window.__plant.mode === 'process'));
await modeClick('设备');
check('返回设备模式', await ev(() => window.__plant.mode === 'equipment'));

/* ---------- 内部视图 / 标签 ---------- */
await ev(() => { [...document.querySelectorAll('.plant-topbar .plant-btn')].find((b) => b.textContent.includes('内部视图')).click(); });
await wait(300);
const xrayOn = await ev(() => [...document.querySelectorAll('.plant-topbar .plant-btn')].find((b) => b.textContent.includes('内部视图')).textContent.includes('开'));
check('内部视图（X-Ray）可开启并同步按钮', xrayOn === true);
await ev(() => { [...document.querySelectorAll('.plant-topbar .plant-btn')].find((b) => b.textContent.includes('内部视图')).click(); });

await ev(() => { [...document.querySelectorAll('.plant-topbar .plant-btn')].find((b) => b.textContent.includes('名称标签')).click(); });
check('名称标签可关闭', await ev(() => document.querySelector('.plant-label-layer').classList.contains('labels-off')));
await ev(() => { [...document.querySelectorAll('.plant-topbar .plant-btn')].find((b) => b.textContent.includes('名称标签')).click(); });
check('名称标签可恢复', await ev(() => !document.querySelector('.plant-label-layer').classList.contains('labels-off')));

/* ---------- 工序 / 工艺层 ---------- */
await ev(() => { document.querySelectorAll('.plant-step-head')[6].click(); });
await wait(700);
check('点击工序可聚焦并高亮', await ev(() => document.querySelectorAll('.plant-step')[6].classList.contains('active')));
await shot('plant-07-step-separation');

await ev(() => { document.querySelectorAll('.plant-tab')[1].click(); });
await wait(400);
check('工艺层标签页列出 7 层', await ev(() => document.querySelectorAll('.plant-layer-item').length === 7));
check('流程自检面板显示 100% 指标', await ev(() => {
  const text = document.querySelector('.plant-audit')?.textContent ?? '';
  return text.includes('100%') && text.includes('PASS');
}));
await ev(() => { document.querySelectorAll('.plant-layer-item')[2].click(); });
await wait(700);
check('点击 L2 聚焦并弹出工艺层说明卡', await ev(() => {
  const card = document.querySelector('.plant-card');
  return card && card.style.display !== 'none' && card.textContent.includes('反应层') && card.textContent.includes('本层作用');
}));
await shot('plant-09-layer-focus');

/* ---------- 设备信息卡与接口 ---------- */
await ev(() => { document.querySelectorAll('.plant-tab')[0].click(); });
await ev(() => {
  const label = [...document.querySelectorAll('.plant-label')].find((b) => b.textContent.includes('T-102'));
  label.click();
});
await wait(600);
check('点击设备标签弹出信息卡', await ev(() => {
  const card = document.querySelector('.plant-card');
  return card && card.style.display !== 'none' && card.textContent.includes('分离塔') && card.textContent.includes('T-102');
}));
check('信息卡列出设备接口与连接管线', await ev(() => {
  const card = document.querySelector('.plant-card');
  return card.textContent.includes('上部进液口') && card.textContent.includes('塔顶气相出口') && card.textContent.includes('PL-107') && card.textContent.includes('PL-108');
}));
check('信息卡列出上下游与内部结构', await ev(() => {
  const text = document.querySelector('.plant-card').textContent;
  return text.includes('上下游（直接连接）') && text.includes('E-102') && text.includes('E-103') && text.includes('填料');
}));
check('信息卡提供追踪与工作台入口', await ev(() => {
  const card = document.querySelector('.plant-card');
  const link = card.querySelector('.plant-card-actions a');
  return [...card.querySelectorAll('.plant-card-actions button')].some((b) => b.textContent.includes('追踪上游'))
    && [...card.querySelectorAll('.plant-card-actions button')].some((b) => b.textContent.includes('下游'))
    && link && link.getAttribute('href') === '#/device/packed-tower';
}));
await shot('plant-10-card');

/* ---------- 上下游追踪 ---------- */
const up = await ev(() => window.__plant.trace('T-102', 'up'));
check('上游追踪覆盖 E-102/R-101 与反应管线', up.nodes.includes('E-102') && up.nodes.includes('R-101') && up.pipes.includes('PL-106') && up.pipes.includes('PL-107'), JSON.stringify({ nodes: up.nodes.length, pipes: up.pipes.length }));
const down = await ev(() => window.__plant.trace('T-102', 'down'));
check('下游追踪覆盖 E-103/V-102 与冷凝管线', down.nodes.includes('E-103') && down.nodes.includes('V-102') && down.pipes.includes('PL-108') && down.pipes.includes('PL-109'));
const both = await ev(() => window.__plant.trace('T-102', 'both'));
check('完整路径含产品与回收分支', both.nodes.includes('F-101') && both.nodes.includes('CY-101') && both.nodes.includes('P-103'), JSON.stringify({ nodes: both.nodes.length, pipes: both.pipes.length }));

/* ---------- 管线信息卡 ---------- */
await ev(() => window.__plant.clearFocus());
await ev(() => window.__plant.selectPipe('PL-107'));
await wait(500);
check('管线卡显示编号/介质/管径等级/层/起终点', await ev(() => {
  const text = document.querySelector('.plant-card')?.textContent ?? '';
  return text.includes('PL-107') && text.includes('反应液') && text.includes('主工艺管线') && text.includes('E-102') && text.includes('T-102') && text.includes('L3');
}));
await ev(() => window.__plant.selectPipe('PL-102'));
await wait(400);
check('进料管线卡关联 4 台线上设备与仪表', await ev(() => {
  const text = document.querySelector('.plant-card')?.textContent ?? '';
  return text.includes('CV-101') && text.includes('ST-101') && text.includes('FT-101') && text.includes('BV-101') && text.includes('PG-101');
}));

/* ---------- 阀门状态联动 ---------- */
await ev(() => window.__plant.select('BV-101'));
await wait(400);
check('切断球阀只显示 OPEN/CLOSED 控制', await ev(() => {
  const text = document.querySelector('.plant-card')?.textContent ?? '';
  return text.includes('阀门状态') && text.includes('OPEN') && text.includes('CLOSED') && !document.querySelector('.plant-valve-btn.is-partial') && text.includes('PL-102');
}));
await ev(() => window.__plant.setValveState('BV-101', 'closed'));
await wait(500);
const closed = await ev(() => ({
  bv: window.__plant.pipeFlow('PL-102'),
  downstream: window.__plant.pipeFlow('PL-103'),
  state: window.__plant.valveState('BV-101'),
  label: [...document.querySelectorAll('.plant-label')].find((b) => b.textContent.includes('BV-101'))?.textContent
}));
check('关闭阀门：本管线在阀处停止、下游管线断流', closed.state === 'closed' && closed.bv?.state === 'halt' && closed.downstream?.state === 'off', JSON.stringify(closed));
check('阀门标签同步 CLOSED', (closed.label ?? '').includes('CLOSED'), closed.label);
await shot('plant-13-valve-closed');
await ev(() => window.__plant.setValveState('BV-101', 'partial'));
check('切断球阀拒绝 PARTIAL 命令', await ev(() => window.__plant.valveState('BV-101') === 'closed'));
await ev(() => window.__plant.setValveState('BV-101', 'open'));
await ev(() => window.__plant.select('T-102'));
await page.locator('[data-scenario="towerGasDemo"]').check();
await ev(() => window.__plant.select('BV-102'));
await page.getByRole('button', { name: 'PARTIAL', exact: true }).click();
const partial = await ev(() => window.__plant.pipeFlow('PL-111'));
check('蝶阀 PARTIAL 使本管线示踪节流', partial?.throttle === true, JSON.stringify(partial));
await page.getByRole('button', { name: 'OPEN', exact: true }).click();
const reopened = await ev(() => ({ bv: window.__plant.pipeFlow('PL-102'), downstream: window.__plant.pipeFlow('PL-103'), audit: window.__plant.audit().issues.length }));
check('恢复 OPEN 后流动与自检正常', reopened.bv?.state === 'full' && reopened.downstream?.state === 'full' && reopened.audit === 0);

/* ---------- 三维拾取 ---------- */
await ev(() => window.__plant.clearFocus());
await ev(() => window.__plant.resetView(true));
await wait(400);
const pumpPt = await ev(() => window.__plant.screenPosition('P-101'));
check('可取得设备屏幕坐标用于点击', !!pumpPt && pumpPt.x > 0 && pumpPt.y > 0, JSON.stringify(pumpPt));
if (pumpPt) {
  await page.mouse.click(pumpPt.x, pumpPt.y);
  await wait(500);
  check('在画布上点击设备可选中', await ev(() => window.__plant.selected === 'P-101'));
  check('画布选中后信息卡切到该设备', await ev(() => document.querySelector('.plant-card').textContent.includes('原料进料泵')));
}
await page.mouse.click(1200, 200);
await wait(400);
check('点击空白处取消选择并收起信息卡', await ev(() => window.__plant.selected === null && document.querySelector('.plant-card').style.display === 'none'));

/* ---------- 管线点选（标签入口） ---------- */
await ev(() => {
  const mode = [...document.querySelectorAll('.plant-mode-btn')].find((b) => b.textContent === '管道');
  mode.click();
});
await wait(500);
await ev(() => {
  const label = [...document.querySelectorAll('.plant-pipe-label')].find((el) => el.textContent.includes('PL-110'));
  label.click();
});
await wait(500);
check('点击管线标签可打开管线卡', await ev(() => window.__plant.selectedPipe === 'PL-110' && document.querySelector('.plant-card').textContent.includes('冷凝液精滤管线')));
await ev(() => {
  const mode = [...document.querySelectorAll('.plant-mode-btn')].find((b) => b.textContent === '设备');
  mode.click();
});

/* ---------- 教学模式 ---------- */
await ev(() => window.__plant.teaching.start());
await wait(800);
check('教学模式启动并高亮第 1 道工序', await ev(() => {
  const banner = document.querySelector('.plant-teach-banner');
  return window.__plant.teaching.active === true && getComputedStyle(banner).display !== 'none' && banner.textContent.includes('01 原料储存与切断') && document.querySelectorAll('.plant-step')[0].classList.contains('active');
}));
await shot('plant-15-teaching');
const teachNext = await ev(() => {
  const before = window.__plant.teaching.index;
  window.__plant.teaching.next();
  return {
    before,
    after: window.__plant.teaching.index,
    banner: document.querySelector('.plant-teach-banner').textContent
  };
});
check('教学可切到下一道工序', teachNext.after === Math.min(teachNext.before + 1, 10) && teachNext.banner.includes(String(teachNext.after + 1).padStart(2, '0')), JSON.stringify(teachNext));
await ev(() => window.__plant.teaching.stop());
await wait(300);
check('退出教学后恢复普通视图', await ev(() => window.__plant.teaching.active === false && getComputedStyle(document.querySelector('.plant-teach-banner')).display === 'none'));

/* ---------- 流程图 ---------- */
await ev(() => { [...document.querySelectorAll('.plant-topbar .plant-btn')].find((b) => b.textContent.includes('流程图')).click(); });
await wait(500);
check('流程图面板含 11 个工序列与设备节点', await ev(() => {
  const panel = document.querySelector('.plant-map');
  return panel && panel.style.display !== 'none' && panel.querySelectorAll('.plant-map-node').length === 20 && panel.querySelectorAll('text').length > 20;
}));
await shot('plant-16-map');
await ev(() => { [...document.querySelectorAll('.plant-map-node')].find((g) => g.textContent.includes('T-103'))?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
await wait(500);
check('流程图节点可定位三维设备', await ev(() => window.__plant.selected === 'T-103'));
await ev(() => { [...document.querySelectorAll('.plant-topbar .plant-btn')].find((b) => b.textContent.includes('流程图')).click(); });

/* ---------- 视角重置与渲染统计 ---------- */
await ev(() => window.__plant.clearFocus());
await ev(() => window.__plant.resetView(true));
await wait(300);
const cam = await ev(() => window.__plant.debug());
check('重置视角回到全装置机位', Math.abs(cam.target[0] + 2.7) < 0.2 && Math.abs(cam.target[1] - 1.55) < 0.2 && Math.abs(cam.target[2] + 3.2) < 0.2 && cam.pos[1] > 12, JSON.stringify({ pos: cam.pos, target: cam.target }));
check('渲染统计可获取（绘制调用/三角面）', cam.drawCalls > 0 && cam.triangles > 0, JSON.stringify({ drawCalls: cam.drawCalls, triangles: cam.triangles, fps: cam.fps }));

/* ---------- 跳转工作台与返回 ---------- */
await ev(() => window.__plant.select('T-102'));
await wait(800);
const beforeWorkbench = await ev(() => window.__plant.debug());
await page.locator('.plant-card-actions a').click();
await page.waitForSelector('.workbench canvas', { timeout: 30000 });
check('从信息卡可进入零件级工作台', await ev(() => location.hash === '#/device/packed-tower' && !!document.querySelector('.workbench canvas')));

await page.locator('.back-btn').click();
await page.waitForSelector('.plant-page', { timeout: 30000 });
const restored = await ev(() => window.__plant.debug());
check('返回全流程保留来源与设备', restored.selected === 'T-102' && await page.locator('.plant-card').isVisible());
check('恢复进入前的真实视角', restored.target.every((value, i) => Math.abs(value - beforeWorkbench.target[i]) < 0.01) &&
  restored.pos.every((value, i) => Math.abs(value - beforeWorkbench.pos[i]) < 0.01));
await page.keyboard.press('Escape');
check('Esc 收起信息卡', !(await page.locator('.plant-card').isVisible()));

/* ---------- 移动端 ---------- */
await page.setViewportSize({ width: 820, height: 740 });
await wait(1200);
check('窄屏显示面板开关', await ev(() => {
  const b = document.querySelector('.plant-steps-toggle');
  return b && getComputedStyle(b).display !== 'none';
}));
check('窄屏默认收起左右面板', await ev(() => {
  const p = document.querySelector('.plant-steps');
  return getComputedStyle(p).display === 'none';
}));
await ev(() => document.querySelector('.plant-steps-toggle').click());
await wait(300);
check('窄屏可展开工序面板', await ev(() => document.querySelector('.plant-page').classList.contains('steps-open') && getComputedStyle(document.querySelector('.plant-steps')).display !== 'none'));
await shot('plant-18-mobile');
await page.setViewportSize({ width: 1600, height: 960 });
await wait(700);

/* ---------- 控制台 ---------- */
check('无页面脚本错误', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 300));

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ passed, failed, results, consoleErrors }, null, 2));
console.log(`\n结果：${passed}/${results.length} 通过${failed ? `，${failed} 项失败` : ''}`);
await browser.close();
process.exit(failed ? 1 : 0);
