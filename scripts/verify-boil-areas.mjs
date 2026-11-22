/* 微沸喷烧 Phase 5 专项验证：五区分层、流程树、区域联动、镜头、设备/管线定位。
 * 运行：先启动 dev server（默认 127.0.0.1:5173），再 node scripts/verify-boil-areas.mjs
 * 可用 VERIFY_BASE 覆盖地址。 */
import { clickBoilEquipment, pickBoilOption } from './boil-browser-actions.mjs';
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.VERIFY_BASE ?? 'http://127.0.0.1:5173/';
const OUT = path.resolve('outputs/verify-boil-areas');
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
  args: [
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--disable-gpu-sandbox',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion'
  ]
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 960 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });
const shot = (name) => page.screenshot({ path: path.join(OUT, name + '.png'), timeout: 120000 });
const ev = (fn, arg) => page.evaluate(fn, arg);

try {
  /* ---------- 首页入口 ---------- */
  await page.goto(BASE + '#/library', { waitUntil: 'networkidle' });
  await page.waitForSelector('.device-card', { timeout: 30000 });
  check(
    '首页保留微沸喷烧入口，且 18 张设备卡/工坊/全流程入口仍在',
    await ev(
      () =>
        !!document.querySelector('[data-nav="boil"]') &&
        document.querySelectorAll('.device-card').length === 18 &&
        !!document.querySelector('.module-entry[data-module="workshop"]') &&
        !!document.querySelector('[data-nav="plant"]')
    )
  );
  const entryText = await ev(() => document.querySelector('.module-entry[data-module="boil"]')?.textContent ?? '');
  check('首页入口文案覆盖区域/追踪/播放', ['五区', '上下游追踪', '流程播放'].every((text) => entryText.includes(text)));
  await shot('01-home-entry');

  await page.click('.site-drop-btn');
  await page.waitForTimeout(250);
  await page.click('.site-drop-menu [data-nav="boil"]');
  await page.waitForSelector('.boil-canvas', { timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.__boil?.ready), { timeout: 30000 });
  await wait(2200);
  check('从首页进入 #/boil 并完成三维渲染', await ev(() => location.hash === '#/boil' && !!document.querySelector('.boil-canvas')));

  /* ---------- 初始数据与场景 ---------- */
  const initial = await ev(() => ({
    phase: window.__boil.phase,
    state: window.__boil.state,
    areas: window.__boil.areas,
    validation: window.__boil.areaValidation,
    fluid: window.__boil.fluidStats(),
    visual: window.__boil.visual(),
    view: window.__boil.view(),
    tabs: [...document.querySelectorAll('[data-area-tab]')].map((b) => b.textContent?.trim()),
    areaRows: document.querySelectorAll('[data-area-row]').length,
    equipmentRows: document.querySelectorAll('[data-equipment-row]').length,
    gunRows: document.querySelectorAll('[data-area-row="area-02-combustion"] .boil-tree-branch [data-equipment-row]').length,
    topGunRows: [...document.querySelectorAll('[data-equipment-row^="eq-spray-gun"]')].filter((row) => !row.closest('.boil-tree-branch')).length,
    heading: document.querySelector('.boil-detail-heading h2')?.textContent,
    leftHeading: document.querySelector('.boil-panel-heading h2')?.textContent
  }));
  check('学生界面使用工艺追踪与流程播放说明', initial.phase === 6 && (await ev(() =>
    document.querySelector('.boil-sub')?.textContent?.trim() === '工艺追踪与流程播放'
    && !/\bPhase\s+\d/.test(document.querySelector('.boil-detail')?.textContent ?? ''))));
  check('初始为整厂总览，无聚焦', initial.state.mode === 'overview' && initial.state.areaId === null);
  check(
    '五大区域顺序与名称正确',
    initial.areas.length === 5 &&
      initial.areas.map((a) => a.name).join('|') === '物料准备区|燃烧处理区|冷却与除尘区|湿法净化区|尾气排放区',
    initial.areas.map((a) => a.name).join(' / ')
  );
  check(
    '区域校验：0 错误，5 区/18 设备/13 管线/4 区域连接/5 范围/4 喷枪支路',
    initial.validation.ok === true &&
      initial.validation.counts.areas === 5 &&
      initial.validation.counts.equipment === 18 &&
      initial.validation.counts.pipelines === 13 &&
      initial.validation.counts.links === 4 &&
      initial.validation.counts.bounds === 5 &&
      initial.validation.counts.sprayGuns === 4 &&
      initial.validation.counts.sprayGunBranches === 4,
    JSON.stringify(initial.validation.counts)
  );
  check('每个区域都有三维范围/出入口/上下游与教学说明', initial.areas.every((a) => a.bounds && a.equipmentIds.length > 0 && a.pipelineIds.length > 0 && a.flowStreamIds.length > 0 && a.teaching !== undefined));
  check('区域标签为「全部区域 + 5 区」共 6 个', initial.tabs.length === 6 && initial.tabs[0].includes('全部区域'), initial.tabs.join(' / '));
  check('流程树 5 区域 + 18 设备', initial.areaRows === 5 && initial.equipmentRows === 18, `${initial.areaRows} 区域 / ${initial.equipmentRows} 设备`);
  check('四根喷枪挂在二燃室下（子级），不是顶层/串联节点', initial.gunRows === 4 && initial.topGunRows === 0, `${initial.gunRows} 子级 / ${initial.topGunRows} 顶层`);
  check('初始流体全开：13 管线 / 204 粒子 / 37 箭头 / 0 弱化', initial.fluid.runs === 13 && initial.fluid.particles === 204 && initial.fluid.arrows === 37 && initial.fluid.dimmedPipelines === 0, JSON.stringify({ runs: initial.fluid.runs, particles: initial.fluid.particles, arrows: initial.fluid.arrows, dim: initial.fluid.dimmedPipelines }));
  check('初始无设备/管线弱化', initial.visual.highlightedEquipment === 0 && initial.visual.dimmedEquipment === 0 && initial.visual.dimmedPipelines === 0);
  check('左侧为工艺流程树、右侧为整厂总览', initial.leftHeading === '工艺流程树' && initial.heading === '整厂总览', `${initial.leftHeading} / ${initial.heading}`);
  await shot('02-overview');

  await ev(() => {
    window.__keepCanvas = document.querySelector('.boil-canvas');
    window.__keepAreas = window.__boil.areas;
    window.__keepParticles = window.__boil.fluidStats().particles;
  });

  /* ---------- 区域切换：镜头、高亮、弱化、联动 ---------- */
  const viewBefore = initial.view;
  await page.click('[data-area-tab="area-02-combustion"]');
  await wait(120);
  const viewMid = await ev(() => window.__boil.view());
  check('切换区域时镜头进入平滑过渡（tweening）', viewMid.tweening === true && viewMid.position.join(',') !== viewBefore.position.join(','));
  await wait(1500);
  const area02 = await ev(() => ({
    state: window.__boil.state,
    view: window.__boil.view(),
    visual: window.__boil.visual(),
    fluid: window.__boil.fluidStats(),
    activeTab: document.querySelector('[data-area-tab].active')?.textContent?.trim(),
    heading: document.querySelector('.boil-detail-heading h2')?.textContent,
    text: document.querySelector('.boil-detail-body')?.textContent ?? '',
    activeAreaRow: document.querySelector('[data-area-row="area-02-combustion"]')?.classList.contains('active'),
    bounds: window.__boil.areas.find((a) => a.id === 'area-02-combustion')?.bounds
  }));
  check('区域镜头定位到燃烧处理区中心', area02.state.mode === 'area' && area02.state.areaId === 'area-02-combustion' && area02.view.tweening === false);
  const center = [(area02.bounds.min[0] + area02.bounds.max[0]) / 2, (area02.bounds.min[1] + area02.bounds.max[1]) / 2, (area02.bounds.min[2] + area02.bounds.max[2]) / 2];
  const targetDistance = Math.hypot(area02.view.target[0] - center[0], area02.view.target[1] - center[1], area02.view.target[2] - center[2]);
  check('区域镜头目标与区域范围中心一致', targetDistance < 1.5, targetDistance.toFixed(2));
  check('区域标签与流程树同步高亮', area02.activeTab?.includes('燃烧处理区') && area02.activeAreaRow === true);
  check('燃烧处理区 6 台设备高亮、其余 12 台弱化', area02.visual.highlightedEquipment === 6 && area02.visual.dimmedEquipment === 12, JSON.stringify(area02.visual));
  check('本区与跨区管线 3 条高亮、其余 10 条弱化', area02.visual.highlightedPipelines === 3 && area02.visual.dimmedPipelines === 10 && area02.fluid.dimmedPipelines === 10, JSON.stringify({ visual: area02.visual, fluid: area02.fluid.dimmedPipelines }));
  check(
    '右侧区域介绍含目的/输入/输出/上下游/设备/管线/流体/入口出口/三维范围',
    ['工艺目的', '输入', '输出', '上下游关系', '主要设备（6）', '主要管线（2）', '流体种类', '区域入口与出口', '区域三维范围'].every((text) => area02.text.includes(text))
  );
  check('区域联动显示跨区入口/出口管线', area02.text.includes('pipe-material-04') && area02.text.includes('pipe-gas-02'));
  await shot('03-area-combustion');

  /* ---------- 流程树点击设备：喷枪支路 ---------- */
  await clickBoilEquipment(page, 'eq-spray-gun-01');
  await wait(1100);
  const gun = await ev(() => ({
    state: window.__boil.state,
    visual: window.__boil.visual(),
    fluid: window.__boil.fluidStats(),
    heading: document.querySelector('.boil-detail-heading h2')?.textContent,
    text: document.querySelector('.boil-detail-body')?.textContent ?? '',
    activeRow: document.querySelector('[data-equipment-row="eq-spray-gun-01"]')?.classList.contains('active')
  }));
  check('流程树点击喷枪 01 后进入追踪并高亮', await ev(() => window.__boil.mode === 'trace' && window.__boil.traceResult?.rootId === 'eq-spray-gun-01') && gun.activeRow === true);
  check('喷枪与二燃室平行支路高亮、其余设备与流体弱化', gun.visual.highlightedEquipment === 5 && gun.visual.dimmedEquipment === 13 && gun.fluid.dimmedPipelines === 13, JSON.stringify({ visual: gun.visual, fluid: gun.fluid.dimmedPipelines }));
  check('喷枪信息说明二燃室平行支路且接入待确认', gun.text.includes('结构关联') && gun.text.includes('平行支路') && gun.text.includes('待现场资料确认'));
  check('喷枪显示待确认接口且无已确认工艺上下游', gun.text.includes('喷入介质入口') && gun.text.includes('喷出口') && gun.text.includes('无已确认工艺上游') && gun.text.includes('无已确认工艺下游'));
  await shot('04-gun01');

  /* ---------- 流程树点击二燃室：关联管线与上下游 ---------- */
  await clickBoilEquipment(page, 'eq-secondary-chamber');
  await wait(1100);
  const chamber = await ev(() => ({
    state: window.__boil.state,
    visual: window.__boil.visual(),
    text: document.querySelector('.boil-detail-body')?.textContent ?? '',
    heading: document.querySelector('.boil-detail-heading h2')?.textContent
  }));
  check('二燃室追踪定位并高亮', await ev(() => window.__boil.mode === 'trace' && window.__boil.traceResult?.rootId === 'eq-secondary-chamber') && chamber.heading === '二燃室');
  check('二燃室完整路径高亮相关设备与管线', chamber.visual.highlightedEquipment === 18 && chamber.visual.highlightedPipelines === 13, JSON.stringify(chamber.visual));
  check('二燃室面板显示上下游设备与关联管线', chamber.text.includes('炉塞泵') && chamber.text.includes('回转窑') && chamber.text.includes('pipe-material-04') && chamber.text.includes('pipe-gas-01'));
  await shot('05-secondary-chamber');

  /* ---------- 三维设备点选 ---------- */
  await page.click('[data-area-tab="area-02-combustion"]');
  await wait(1300);
  const kilnPoint = await ev(() => window.__boil.screenOfEquipment('eq-rotary-kiln'));
  const canvasBox = await page.locator('.boil-canvas').boundingBox();
  check('回转窑在画布内可投影（准备三维点选）', Boolean(kilnPoint && kilnPoint.x > 0 && kilnPoint.x < 1 && kilnPoint.y > 0 && kilnPoint.y < 1 && canvasBox), JSON.stringify(kilnPoint));
  if (kilnPoint && canvasBox) {
    await page.mouse.click(canvasBox.x + kilnPoint.x * canvasBox.width, canvasBox.y + kilnPoint.y * canvasBox.height);
    await wait(1100);
  }
  const after3d = await ev(() => ({ state: window.__boil.state, heading: document.querySelector('.boil-detail-heading h2')?.textContent }));
  check('三维点击回转窑后进入设备定位', after3d.state.mode === 'equipment' && after3d.state.equipmentId === 'eq-rotary-kiln', JSON.stringify(after3d));
  await shot('06-3d-pick-kiln');

  /* ---------- 三维管线点选 ---------- */
  await page.click('[data-area-tab="area-03-cooling"]');
  await wait(1300);
  const pipePoint = await ev(() => window.__boil.screenOfPipeline('pipe-gas-03'));
  if (pipePoint && canvasBox) {
    await page.mouse.click(canvasBox.x + pipePoint.x * canvasBox.width, canvasBox.y + pipePoint.y * canvasBox.height);
    await wait(1100);
  }
  const afterPipe3d = await ev(() => ({ state: window.__boil.state, heading: document.querySelector('.boil-detail-heading h2')?.textContent }));
  check('三维点击烟气管线后进入管线局部视图', afterPipe3d.state.mode === 'pipeline' && afterPipe3d.state.pipelineId === 'pipe-gas-03', JSON.stringify(afterPipe3d));
  check('管线局部视图显示长度/弯头/阀门/支架与起终点', afterPipe3d.heading?.includes('集冷塔一') && (await ev(() => document.querySelector('.boil-detail-body')?.textContent?.includes('19.6 m'))));
  await shot('07-3d-pick-pipe');

  /* ---------- 空白点击返回区域 ---------- */
  const blankPoint = await ev(() => {
    const canvas = document.querySelector('.boil-canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    for (let y = 0.2; y <= 0.8; y += 0.04) {
      for (let x = 0.3; x <= 0.86; x += 0.04) {
        const px = rect.left + x * rect.width;
        const py = rect.top + y * rect.height;
        if (document.elementFromPoint(px, py) !== canvas) continue;
        if (!window.__boil.pickAt(x, y)) return { x, y };
      }
    }
    return null;
  });
  check('能在画布上找到空白点（避开面板与三维对象）', Boolean(blankPoint), JSON.stringify(blankPoint));
  if (canvasBox) {
    await page.mouse.click(canvasBox.x + canvasBox.width * blankPoint.x, canvasBox.y + canvasBox.height * blankPoint.y);
    await wait(900);
  }
  const afterBlank = await ev(() => window.__boil.state);
  check('点击空白从局部视图返回所属区域', afterBlank.mode === 'area' && afterBlank.areaId === 'area-03-cooling', JSON.stringify(afterBlank));

  /* ---------- 上下游区域跳转 ---------- */
  await page.click('[data-area-tab="area-02-combustion"]');
  await wait(1100);
  await ev(() => {
    const chip = [...document.querySelectorAll('.boil-detail .boil-chip')].find((b) => b.textContent?.includes('下游 · 冷却与除尘区'));
    chip?.click();
  });
  await wait(1100);
  const downstreamState = await ev(() => ({ state: window.__boil.state, heading: document.querySelector('.boil-detail-heading h2')?.textContent }));
  check('区域面板点击下游跳转到冷却与除尘区', downstreamState.state.mode === 'area' && downstreamState.state.areaId === 'area-03-cooling' && downstreamState.heading === '冷却与除尘区');
  await ev(() => {
    const chip = [...document.querySelectorAll('.boil-detail .boil-chip')].find((b) => b.textContent?.includes('上游 · 燃烧处理区'));
    chip?.click();
  });
  await wait(1100);
  check('区域面板点击上游返回燃烧处理区', await ev(() => window.__boil.state.areaId === 'area-02-combustion'));

  /* ---------- 区域设备/管线列表联动 ---------- */
  await ev(() => {
    const section = [...document.querySelectorAll('.boil-detail-section')].find((s) => s.querySelector('h3')?.textContent?.includes('主要设备'));
    const button = [...(section?.querySelectorAll('.boil-link') ?? [])].find((b) => b.textContent?.trim() === '回转窑');
    button?.click();
  });
  await wait(1000);
  check('区域详情设备列表可打开追踪面板', await ev(() => window.__boil.mode === 'trace' && window.__boil.traceResult?.rootId === 'eq-rotary-kiln' && document.querySelector('.boil-detail-heading h2')?.textContent === '回转窑'));

  await page.click('[data-area-tab="area-04-wet"]');
  await wait(1100);
  await ev(() => {
    const button = [...document.querySelectorAll('.boil-detail .boil-link-block')].find((b) => b.textContent?.includes('pipe-gas-06'));
    button?.click();
  });
  await wait(1000);
  check('区域详情管线列表可打开管线面板', await ev(() => window.__boil.state.pipelineId === 'pipe-gas-06'));

  /* ---------- 流体控制 ---------- */
  await pickBoilOption(page, '.boil-fluid-play');
  check('流体暂停按钮生效', await ev(() => window.__boil.fluidStats().paused === true));
  await pickBoilOption(page, '.boil-fluid-play');
  check('流体继续播放', await ev(() => window.__boil.fluidStats().paused === false));
  await pickBoilOption(page, '.boil-fluid-speed');
  check('流体速度切换到 2×', await ev(() => window.__boil.fluidStats().speed === 2));
  await pickBoilOption(page, '.boil-fluid-arrows');
  check('流向箭头可关闭', await ev(() => window.__boil.fluidStats().arrowsEnabled === false));
  await pickBoilOption(page, '.boil-fluid-arrows');
  await pickBoilOption(page, '.boil-labels');
  check('标签开关可关闭', await ev(() => document.querySelector('.boil-labels')?.textContent?.includes('关')));
  await pickBoilOption(page, '.boil-labels');

  /* ---------- 自动复位 / 无重建 ---------- */
  await pickBoilOption(page, '.boil-reset');
  await wait(1400);
  const reset = await ev(() => ({
    state: window.__boil.state,
    visual: window.__boil.visual(),
    fluid: window.__boil.fluidStats(),
    heading: document.querySelector('.boil-detail-heading h2')?.textContent,
    activeTab: document.querySelector('[data-area-tab].active')?.textContent?.trim(),
    sameCanvas: document.querySelector('.boil-canvas') === window.__keepCanvas,
    sameAreas: window.__boil.areas === window.__keepAreas,
    sameParticles: window.__boil.fluidStats().particles === window.__keepParticles,
    view: window.__boil.view()
  }));
  check('自动复位回到整厂总览并清除弱化', reset.state.mode === 'overview' && reset.visual.dimmedEquipment === 0 && reset.visual.dimmedPipelines === 0 && reset.fluid.dimmedPipelines === 0);
  check('复位后区域标签/信息面板恢复总览', reset.activeTab?.includes('全部区域') && reset.heading === '整厂总览');
  const resetDistance = Math.hypot(reset.view.position[0] - viewBefore.position[0], reset.view.position[1] - viewBefore.position[1], reset.view.position[2] - viewBefore.position[2]);
  check('复位镜头回到初始总览位置', resetDistance < 2.5, resetDistance.toFixed(2));
  check('切换区域/设备/管线过程中未重建场景', reset.sameCanvas === true && reset.sameAreas === true && reset.sameParticles === true);
  await shot('08-reset-overview');

  /* ---------- 窄屏抽屉 ---------- */
  const ctx2 = await browser.newContext({ viewport: { width: 900, height: 820 } });
  const page2 = await ctx2.newPage();
  page2.on('pageerror', (e) => consoleErrors.push('narrow pageerror: ' + e.message));
  page2.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('narrow console: ' + m.text()); });
  await page2.goto(BASE + '#/boil', { waitUntil: 'networkidle' });
  await page2.waitForFunction(() => Boolean(window.__boil?.ready), { timeout: 30000 });
  await wait(1800);
  const narrow0 = await page2.evaluate(() => ({
    classes: document.querySelector('.boil-page')?.className,
    tabs: document.querySelectorAll('[data-area-tab]').length,
    canvas: !!document.querySelector('.boil-canvas')
  }));
  check('窄屏初始不强行展开两侧面板', !narrow0.classes.includes('panel-open') && !narrow0.classes.includes('detail-open') && narrow0.tabs === 6 && narrow0.canvas === true, narrow0.classes);
  await page2.click('[data-area-tab="area-05-stack"]');
  await wait(1000);
  const narrow1 = await page2.evaluate(() => ({
    classes: document.querySelector('.boil-page')?.className,
    heading: document.querySelector('.boil-detail-heading h2')?.textContent,
    detailVisible: getComputedStyle(document.querySelector('.boil-detail')).display
  }));
  check('窄屏点区域自动打开信息抽屉', narrow1.classes.includes('detail-open') && narrow1.heading === '尾气排放区' && narrow1.detailVisible === 'flex', JSON.stringify(narrow1));
  await page2.screenshot({ path: path.join(OUT, '09-narrow-area.png'), timeout: 120000 });
  await ctx2.close();

  /* ---------- 390px 手机顶栏换行后区域标签不重叠 ---------- */
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page3 = await ctx3.newPage();
  page3.on('pageerror', (e) => consoleErrors.push('mobile pageerror: ' + e.message));
  page3.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('mobile console: ' + m.text()); });
  await page3.goto(BASE + '#/boil', { waitUntil: 'networkidle' });
  await page3.waitForFunction(() => Boolean(window.__boil?.ready), { timeout: 30000 });
  await wait(1600);
  const mobile = await page3.evaluate(() => {
    const topbar = document.querySelector('.boil-topbar')?.getBoundingClientRect();
    const tabs = document.querySelector('.boil-area-tabs')?.getBoundingClientRect();
    return {
      topbarBottom: topbar?.bottom ?? 0,
      tabsTop: tabs?.top ?? 0,
      overlap: Boolean(topbar && tabs && topbar.bottom > tabs.top),
      tabs: document.querySelectorAll('[data-area-tab]').length
    };
  });
  check('390px 手机顶栏换行后区域标签不重叠', mobile.overlap === false && mobile.tabsTop >= mobile.topbarBottom && mobile.tabs === 6, JSON.stringify(mobile));
  await page3.screenshot({ path: path.join(OUT, '10-mobile-390.png'), timeout: 120000 });
  await ctx3.close();

  check('浏览器控制台无错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (error) {
  check('验证脚本执行', false, String(error));
  await shot('99-error').catch(() => {});
} finally {
  const passed = results.filter((r) => r.ok).length;
  fs.writeFileSync(
    path.join(OUT, 'report.json'),
    JSON.stringify({ base: BASE, time: new Date().toISOString(), passed, total: results.length, results, consoleErrors }, null, 2)
  );
  console.log(`\n结果：${passed}/${results.length} 通过`);
  await browser.close();
  if (passed !== results.length) process.exitCode = 1;
}
