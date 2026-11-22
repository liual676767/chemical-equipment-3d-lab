/**
 * 阶段二验收：离心泵「沿吸入口观察 → 剖视图指出叶轮」结构自测。
 * 运行：node scripts/verify-pump-exercise.mjs（需 dev server；VERIFY_BASE 可覆盖）
 */
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.VERIFY_BASE ?? 'http://127.0.0.1:5173/';
const OUT = path.resolve('outputs/verify-pump-exercise');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
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

const errors = [];
async function newPage(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE + '#/device/pump', { timeout: 90000, waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.canvas-wrap canvas');
  await page.waitForFunction(() => window.__chem3d?.device?.id === 'pump');
  await wait(1500);
  return { ctx, page };
}
const store = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('chem3d-lab:v1') || '{}'));
const sceneState = (page) => page.evaluate(() => {
  const s = window.__chem3d.scene;
  const imp = s.parts.get('impeller');
  return {
    selected: s.selected,
    mode: s.mode,
    endoIndex: s.getEndoscopeState().index,
    endoName: s.getEndoscopeState().stop?.name ?? null,
    impellerEmissive: imp ? imp.materials.map((m) => m.emissive.getHex()) : [],
    drawers: {
      left: document.querySelector('.left-panel')?.classList.contains('drawer-open'),
      right: document.querySelector('.right-panel')?.classList.contains('drawer-open'),
      leftInert: document.querySelector('.left-panel')?.inert,
      rightInert: document.querySelector('.right-panel')?.inert
    },
    cam: s.camera ? s.camera.position.toArray().map((n) => +n.toFixed(4)) : null,
    quat: s.camera ? s.camera.quaternion.toArray().map((n) => +n.toFixed(4)) : null
  };
});
const treeItem = (page, name) => page.locator('.tree-item').filter({ hasText: name }).first();

/* ---------- A. 桌面键盘全程 ---------- */
{
  const { ctx, page } = await newPage();
  check('A1 离心泵存在结构自测任务（与手动勾选分开显示）',
    (await page.locator('.task-exercise .badge', { hasText: '结构自测' }).count()) === 1 &&
    (await page.locator('.task-kind', { hasText: '手动勾选' }).count()) >= 1);

  // 先选中叶轮，制造会被自动带进练习的高亮
  await page.locator('[data-action=info]').click();
  const findImpellerRow = page.locator('.task-row').filter({ hasText: '在整体观察中找到叶轮' });
  await findImpellerRow.locator('.task-go').click();
  await wait(700);
  let st = await sceneState(page);
  check('A2 预置：叶轮被选中并高亮', st.selected === 'impeller' && st.impellerEmissive.some((v) => v !== 0), JSON.stringify(st.impellerEmissive));

  // 回到总览，再制造一个悬停高亮（模拟鼠标停在叶轮上），验证开始自测会清除
  await page.evaluate(() => window.__chem3d.scene.select(null));
  await wait(300);
  await page.evaluate(() => { window.__chem3d.scene.hovered = 'impeller'; });
  await wait(300);
  st = await sceneState(page);
  check('A2b 预置：悬停高亮已出现', st.selected === null && st.impellerEmissive.some((v) => v !== 0), JSON.stringify(st.impellerEmissive));

  await page.locator('[data-action=info]').click();
  await page.locator('.exercise-start').click();
  await wait(900);
  st = await sceneState(page);
  check('A3 开始自测后进入内窥入口（1/8）', st.mode === 'endoscope' && st.endoIndex === 0 && st.endoName.includes('吸入口'), JSON.stringify({ mode: st.mode, idx: st.endoIndex }));
  check('A4 开始自测清除选中与答案高亮', st.selected === null && st.impellerEmissive.every((v) => v === 0));
  check('A5 未到叶轮眼时「回到剖视图辨认」不可用', await page.locator('.exercise-enter-identify').isDisabled());
  const focusedNext = await page.evaluate(() => document.activeElement?.dataset?.endoNav === 'next');
  check('A6 键盘起点：焦点在内窥「下一站」', focusedNext);

  for (let i = 0; i < 4; i++) {
    await page.locator('[data-endo-nav="next"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction((idx) => window.__chem3d.scene.getEndoscopeState().index === idx, i + 1, { timeout: 5000 });
    await wait(300);
  }
  await page.waitForFunction(() => document.activeElement?.classList.contains('exercise-enter-identify'), null, { timeout: 5000 }).catch(() => {});
  await wait(300);
  st = await sceneState(page);
  check('A7 沿吸入口到达叶轮眼（5/8）', st.endoIndex === 4 && st.endoName.includes('叶轮进口'), st.endoName ?? '');
  check('A8 到达后「回到剖视图辨认」可用', !(await page.locator('.exercise-enter-identify').isDisabled()));
  check('A9 到达后焦点自动落到「回到剖视图辨认」', await page.evaluate(() => document.activeElement?.classList.contains('exercise-enter-identify')));

  await page.keyboard.press('Enter');
  await wait(900);
  st = await sceneState(page);
  check('A10 进入轴向剖视且不预选任何零件', st.mode === 'section' && st.selected === null);
  check('A11 辨认步骤焦点落在零件目录', await page.evaluate(() => document.activeElement?.classList.contains('tree-item')));
  await page.screenshot({ path: path.join(OUT, 'a-identify-section.png') });

  const casing = treeItem(page, '泵壳');
  await casing.focus();
  await page.keyboard.press('Enter');
  await wait(500);
  let data = await store(page);
  check('A12 选错蜗壳给出结构线索且不保存成绩',
    (await page.locator('.exercise-feedback').innerText()).includes('唯一对液体做功') &&
    !data.devices?.pump?.checks?.['p-route-impeller']);
  await page.screenshot({ path: path.join(OUT, 'a-wrong-clue.png') });

  const impeller = treeItem(page, '叶轮');
  await impeller.focus();
  await page.keyboard.press('Enter');
  await wait(700);
  data = await store(page);
  st = await sceneState(page);
  check('A13 选中叶轮后显示解释并保存自测成绩',
    (await page.locator('.exercise-success').innerText()).includes('叶轮眼轴向进入') &&
    data.devices?.pump?.checks?.['p-route-impeller']?.done === true);
  check('A14 选对后选中叶轮（学生主动选择的结果）', st.selected === 'impeller');
  check('A15 完成后焦点在「结束练习，自由观察」', await page.evaluate(() => document.activeElement?.classList.contains('exercise-finish')));
  await page.screenshot({ path: path.join(OUT, 'a-success.png') });

  const firstDate = data.devices.pump.checks['p-route-impeller'].date;
  await page.keyboard.press('Enter');
  await wait(700);
  st = await sceneState(page);
  check('A16 结束自测回到自由观察', st.mode === 'observe');
  check('A17 任务清单显示自测已通过', (await page.locator('.task-exercise .badge-ok', { hasText: '已通过' }).count()) === 1);
  check('A18 手动勾选项仍独立存在', (await page.locator('.task-kind', { hasText: '手动勾选' }).count()) >= 1);

  // 手动勾选与自测成绩分开保存
  const manualRow = page.locator('.task-row').filter({ hasText: '在整体观察中找到叶轮' });
  await manualRow.locator('input[type="checkbox"]').check();
  await wait(300);
  data = await store(page);
  check('A19 手动勾选写入 tasks，自测成绩保留在 checks',
    data.devices?.pump?.tasks?.['p-find-impeller'] === true &&
    data.devices?.pump?.checks?.['p-route-impeller']?.done === true);

  // 刷新保留
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.canvas-wrap canvas');
  await page.waitForFunction(() => window.__chem3d?.device?.id === 'pump');
  await wait(1500);
  check('A20 刷新后自测仍显示已通过', (await page.locator('.task-exercise .badge-ok', { hasText: '已通过' }).count()) === 1);
  check('A21 刷新后手动勾选仍保留', await page.locator('.task-row').filter({ hasText: '在整体观察中找到叶轮' }).locator('input[type="checkbox"]').isChecked());
  await page.screenshot({ path: path.join(OUT, 'a-refresh-persist.png') });

  // 重复完成：去重
  await page.locator('[data-action=info]').click();
  await page.locator('.task-exercise .exercise-start').click();
  await wait(700);
  await page.locator('[data-endo-stop="4"]').click();
  await wait(600);
  await page.locator('.exercise-enter-identify').click();
  await wait(700);
  await treeItem(page, '叶轮').focus();
  await page.keyboard.press('Enter');
  await wait(600);
  data = await store(page);
  check('A22 重复完成保留首次完成时间、不重复计数',
    data.devices?.pump?.checks?.['p-route-impeller']?.date === firstDate);
  await ctx.close();
}

/* ---------- B. 手机：抽屉收起后继续旋转与完成自测 ---------- */
{
  const { ctx, page } = await newPage({ width: 390, height: 844 });
  await page.locator('.mobile-panel-btn[data-action="info"]').click();
  await wait(400);
  await page.locator('.exercise-start').click();
  await wait(800);
  await page.locator('[data-endo-stop="4"]').click();
  await wait(500);
  await page.locator('.exercise-enter-identify').click();
  await wait(800);
  let st = await sceneState(page);
  check('B1 手机端辨认步骤打开说明抽屉', st.mode === 'section' && st.drawers.right === true);
  await page.screenshot({ path: path.join(OUT, 'b-mobile-identify.png') });

  await page.locator('.right-panel .panel-collapse').click();
  await wait(400);
  st = await sceneState(page);
  check('B2 收起抽屉后左右面板均不可聚焦', st.drawers.left === false && st.drawers.right === false && st.drawers.leftInert === true && st.drawers.rightInert === true);

  const canvas = page.locator('.canvas-wrap canvas');
  const box = await canvas.boundingBox();
  const camBefore = (await sceneState(page)).cam;
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.42, { steps: 12 });
  await page.mouse.up();
  await wait(700);
  const camAfter = (await sceneState(page)).cam;
  const moved = camBefore && camAfter && camBefore.some((v, i) => Math.abs(v - camAfter[i]) > 0.01);
  check('B3 抽屉收起后拖动仍能旋转模型', !!moved, `${camBefore} -> ${camAfter}`);
  await page.screenshot({ path: path.join(OUT, 'b-mobile-drawer-closed-rotate.png') });

  await page.locator('.mobile-panel-btn[data-action="info"]').click();
  await wait(400);
  await page.locator('.exercise-actions button', { hasText: '打开零件目录' }).click();
  await wait(400);
  await page.locator('.tree-item').filter({ hasText: '叶轮' }).first().click();
  await wait(700);
  const data = await store(page);
  check('B4 手机端可通过零件目录完成自测并保存', data.devices?.pump?.checks?.['p-route-impeller']?.done === true);
  await page.screenshot({ path: path.join(OUT, 'b-mobile-success.png') });
  await ctx.close();
}

await browser.close();
check('Z 全程无控制台错误', errors.length === 0, errors.join(' | '));

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ results, errors }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
