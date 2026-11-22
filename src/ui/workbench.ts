import type { DeviceDef, PartDef, ObservationTask } from '../data/types';
import { deviceById, JOINT_LABEL, ROLE_LABEL } from '../data/devices';
import { SceneManager, type Mode, type PracticeState } from '../engine/SceneManager';
import { INTERACTIONS } from '../engine/interactions';
import { getRecord, toggleFavorite, touchDevice, savePractice, saveCompletion, clearPractice, fmtTime, practiceCompatible, setTask, taskState, getSelfCheck, saveSelfCheck } from '../state/store';
import { el, button, icon, ICONS, sliderRow } from './dom';
import { openRecordsDialog, openFeedbackDialog } from './dialogs';
import { assetsForDevice } from '../assets/registry';
import { ENDOSCOPES } from '../engine/endoscope';
import { markDeviceEntry, returnToCatalog } from './catalogState';
import { workbenchOrigin } from './sceneNavigation';
import { openPumpFit } from '../workshop/pumpFit';
import sourcesUrl from '../../docs/sources-and-review.md?url';
import pumpSourcesUrl from '../../docs/p1-unified-pump.md?url';

const MODE_TABS: { id: Mode; label: string; icon: string }[] = [
  { id: 'observe', label: '整体观察', icon: ICONS.cube },
  { id: 'section', label: '剖视', icon: ICONS.cut },
  { id: 'xray', label: '透明观察', icon: ICONS.ghost },
  { id: 'explode', label: '爆炸图', icon: ICONS.layers },
  { id: 'principle', label: '工作原理', icon: ICONS.play },
  { id: 'endoscope', label: '内窥', icon: ICONS.eye },
  { id: 'practice', label: '拆装练习', icon: ICONS.wrench }
];

const PRINCIPLE_TEXT: Record<string, string> = {
  pump: '叶轮高速旋转，液体从轴向吸入口进入叶轮中心，被叶片甩向蜗壳外缘，动能转化为压力能后从上方排出口排出。蓝色小球示意吸入管与蜗壳到排出管的流向。叶道通过叶轮和内窥的教学流线观察。',
  exchanger: '蓝色为管程流体：在换热管内往返流动；橙色为壳程流体：在折流板引导下呈「之」字形横向冲刷管束。两条流路互不混合，热量经管壁传递。',
  reactor: '搅拌轴带动双层斜桨旋转，物料沿釜壁上升、在中心下降，形成整体循环；挡板把切向打旋转化为上下翻动。绿色小球表示流动趋势。',
  'ball-valve': '手柄带动带通孔的阀球旋转 90°：通孔对准流道为全开，转过 90° 后球面切断流道为全关。蓝色小球表示介质，关闭时流路被切断。',
  'gate-valve': '旋转手轮通过阀杆螺母带动楔式闸板升降，明杆结构可从阀杆外露长度判断开度。全开时介质直通、流阻小；关闭时闸板压紧阀座切断介质。',
  'butterfly-valve': '蝶板绕阀轴在阀座内旋转：垂直于流道为关闭，平行于流道为全开。对夹式阀体被夹在两片管道法兰之间，结构长度短、重量轻。',
  'check-valve': '正向流动推开铰链上的阀瓣（蓝色）；停流或倒流时阀瓣靠重力与回流压力落座，自动切断通路（红色表示被阻挡的倒流），无需人工操作。',
  'gear-pump': '主动齿轮与从动齿轮反向旋转：吸入侧齿槽脱离啮合、容积增大吸入液体；液体沿泵体内壁被齿槽携带到排出侧，齿槽进入啮合、容积缩小将液体挤出。',
  'diaphragm-pump': '压缩空气推动连杆往复运动，两侧隔膜交替鼓胀与收缩：一侧腔体增大吸入时另一侧缩小排出，四个球式止回阀随行程交替启闭，实现无轴封连续输送。',
  'plate-exchanger': '热流体（橙红）与冷流体（蓝）在密封垫片分隔的交替流道内逆流流动，热量经薄板片传递；垫片既密封流道周边，又引导流体进入正确流道。',
  'bag-filter': '液体从进口进入滤袋外侧环隙下行，自外向内穿过滤袋壁后从出口排出；杂质（橙色）被截留在袋外表面，支撑篮防止滤袋受压变形。',
  'y-strainer': '介质流经 Y 形支管内的滤网，杂质（橙色）被拦截并聚集在支管底部；拆下滤盖后可沿支管轴线抽出滤网清洗，无需把阀体从管道上拆下。',
  'fixed-roof-tank': '物料从顶部进口进入罐内储存，液位随之升降（演示数据）；底部出口向外供料，呼吸阀随液位变化自动呼气/吸气，维持罐内压力平衡。',
  'gas-separator': '气液混合物撞击入口挡板后折流，大液滴直接落到底部；气体上升穿过丝网除沫器捕集细小液滴，净化气从顶部排出，液体从底部排出。',
  'packed-tower': '液相（蓝）经液体分布器均匀喷淋，沿填料表面成膜下行；气相（青绿）自底部进入、穿过填料空隙上行，气液两相在填料表面逆流接触进行传质传热。',
  'cyclone-separator': '含尘气体（橙）切向进入后沿壁螺旋下行，粉尘受离心力甩向壁面并落入底部排料口；净化气（蓝）在中心形成内旋流螺旋上行，经中心排气管排出。',
  'screw-compressor': '阴阳转子啮合旋转：空气从进气口进入齿间容积，随轴向移动容积逐渐缩小而被压缩；中段喷油（琥珀色油雾）密封、冷却与润滑，压缩后的气体从排气口排出。',
  'emf-meter': '导电液体流过励磁线圈产生的磁场时切割磁力线，两侧电极感应出与流速成正比的电动势（法拉第电磁感应定律），变送器换算为流量读数。本演示中的读数为演示数据。'
};

export function renderWorkbench(root: HTMLElement, deviceId: string) {
  const device = deviceById(deviceId)!;
  if (!device) { location.hash = '#/library'; return; }
  touchDevice(deviceId);
  markDeviceEntry(deviceId);
  root.innerHTML = '';

  const page = el('div', 'workbench');
  let scene: SceneManager | null = null;
  let currentMode: Mode = 'observe';
  let pumpExteriorDetail = false;
  let practice: PracticeState | null = null;
  let completionSaved = false;
  let explodeRaf = 0;
  let explodeDir = 0;
  let principleTimer = 0;
  let lastInfoKey = '';
  let lastScrolledSelected: string | null = null;
  let pendingMode: Mode | null = null;
  let initTimer = 0;
  let pumpFit: ReturnType<typeof openPumpFit> | null = null;
  const sessionSnapshots: Partial<Record<'guided' | 'free', PracticeState>> = {};
  let exerciseTask: ObservationTask | null = null;
  let exercisePhase: 'observe' | 'identify' | 'done' | null = null;
  let exerciseObserved = false;
  let exerciseAttempts = 0;
  let exerciseWrongId: string | null = null;
  let exerciseMessage = '';

  /* ============ 顶栏 ============ */
  const topbar = el('header', 'wb-topbar');
  const origin = workbenchOrigin();
  const returnFromWorkbench = () => {
    if (origin) history.back();
    else returnToCatalog();
  };
  const backBtn = button('', 'btn btn-ghost back-btn', returnFromWorkbench, origin ? '返回来源场景' : '返回设备库');
  backBtn.setAttribute('aria-label', origin ? '返回来源场景' : '返回设备库');
  backBtn.appendChild(icon(ICONS.back, 18));
  backBtn.appendChild(el('span', '', origin ? '来源场景' : '设备库'));
  topbar.appendChild(backBtn);
  const titleBlock = el('div', 'wb-title');
  titleBlock.appendChild(el('h1', 'wb-device-name', device.name));
  const uploadAssets = assetsForDevice(deviceId);
  topbar.appendChild(titleBlock);

  const modesButton = button('整体观察', 'tool-btn wb-modes-button canvas-mode-name', () => setModesOpen(tabs.hidden), '切换学习模式');
  modesButton.setAttribute('aria-label', '切换学习模式，当前为整体观察');
  modesButton.setAttribute('aria-controls', 'wb-modes');
  modesButton.setAttribute('aria-expanded', 'false');
  topbar.appendChild(modesButton);
  const tabs = el('nav', 'mode-tabs');
  tabs.id = 'wb-modes';
  tabs.setAttribute('aria-label', '设备观察与练习模式');
  const tabButtons = new Map<Mode, HTMLButtonElement>();
  for (const t of MODE_TABS) {
    const disabled = (t.id === 'practice' && device.assemblyOrder.length === 0)
      || (t.id === 'endoscope' && !ENDOSCOPES[device.id]);
    const b = button('', 'mode-tab' + (disabled ? ' tab-dev' : ''), () => {
      if (disabled) {
        toast('info', t.id === 'practice'
          ? `「${device.name}」的拆装练习正在开发中，当前可使用观察、剖视、透明、爆炸与原理演示。`
          : `「${device.name}」的内窥视点尚未开放：需先确认连通流道与安全观察位置后逐台补充（当前仅单级离心泵已开放）。`);
        return;
      }
      switchMode(t.id);
      if (compactModes.matches) {
        setModesOpen(false);
        modesButton.focus();
      }
    }, disabled ? `${t.label}开发中` : t.label);
    b.setAttribute('aria-pressed', 'false');
    b.appendChild(icon(t.icon, 15));
    b.appendChild(el('span', '', t.label));
    if (disabled) b.appendChild(el('span', 'dev-mark', '开发中'));
    tabButtons.set(t.id, b);
    tabs.appendChild(b);
  }
  topbar.appendChild(tabs);
  const compactModes = matchMedia('(max-width: 1000px)');
  function setModesOpen(open: boolean) {
    tabs.hidden = compactModes.matches && !open;
    modesButton.setAttribute('aria-expanded', String(compactModes.matches && open));
  }
  setModesOpen(false);

  const topActions = el('div', 'wb-top-actions');
  const rec = getRecord(deviceId);
  const favBtn = button(rec.favorite ? '取消收藏' : '收藏设备', 'tool-menu-item' + (rec.favorite ? ' faved' : ''), () => {
    const on = toggleFavorite(deviceId);
    favBtn.classList.toggle('faved', on);
    favBtn.setAttribute('aria-pressed', String(on));
    favBtn.textContent = on ? '取消收藏' : '收藏设备';
    toast('info', on ? '已收藏该设备。' : '已取消收藏。');
  }, rec.favorite ? '取消收藏' : '收藏设备');
  favBtn.setAttribute('aria-pressed', String(rec.favorite));
  topActions.appendChild(favBtn);
  const feedbackBtn = button('问题反馈', 'tool-menu-item', () => {
    closeToolMenu(true);
    openFeedbackDialog(deviceId, () => currentMode);
  }, '问题反馈');
  topActions.appendChild(feedbackBtn);
  page.appendChild(topbar);

  /* ============ 主区 ============ */
  const main = el('div', 'wb-main');

  /* 左侧目录 */
  const left = el('aside', 'panel left-panel');
  left.id = 'wb-parts';
  const leftHead = el('div', 'panel-head');
  leftHead.appendChild(el('h2', 'panel-title', '零部件目录'));
  const leftCollapse = button('', 'btn btn-ghost icon-btn panel-collapse', () => closePanel('left'), '收起目录');
  leftCollapse.appendChild(icon(ICONS.close, 16));
  leftHead.appendChild(leftCollapse);
  left.appendChild(leftHead);
  const tree = el('div', 'part-tree');
  const treeItems = new Map<string, HTMLButtonElement>();
  const groups: string[] = [];
  for (const p of device.parts) if (!groups.includes(p.group)) groups.push(p.group);
  if (!groups.length) tree.appendChild(el('p', 'tree-empty', '该设备暂无零件数据，三维模型可能未加载完成。'));
  for (const gname of groups) {
    tree.appendChild(el('div', 'tree-group', gname));
    for (const p of device.parts.filter((x) => x.group === gname)) {
      const item = button('', 'tree-item', () => {
        if (currentMode === 'endoscope') {
          toast('info', '内窥模式下相机由视点按钮控制；退出内窥后可聚焦零件。');
          return;
        }
        scene?.select(p.id, true);
        if (isMobileLayout() && openPanel === 'left') closeDrawers(true);
      }, `定位并查看「${p.name}」`);
      const dot = el('span', 'tree-dot');
      dot.style.background = '#' + p.color.toString(16).padStart(6, '0');
      item.appendChild(dot);
      item.appendChild(el('span', 'tree-name', p.name));
      const tag = el('span', 'tree-tag', p.role === 'fixed' ? '固定' : p.role === 'removable' ? '可拆' : '展开');
      item.appendChild(tag);
      treeItems.set(p.id, item);
      tree.appendChild(item);
    }
  }
  left.appendChild(tree);
  const leftFoot = el('div', 'panel-foot');
  leftFoot.textContent = '点击零件名称可定位聚焦。「固定」=固定结构，「可拆」=可拆卸部件，「展开」=仅用于结构展开（焊接/整体件，不参与拆装）。';
  left.appendChild(leftFoot);
  main.appendChild(left);

  /* 中间视窗 */
  const center = el('div', 'wb-center');
  const canvasWrap = el('div', 'canvas-wrap');
  center.appendChild(canvasWrap);

  const canvasToolbar = el('div', 'canvas-toolbar');
  const resetView = button('复位视角', 'tool-btn', () => scene?.fitView(), '恢复默认等轴测视角');
  canvasToolbar.appendChild(resetView);

  /* 低频设置集中到工具菜单：零件标注、画质、全屏、学习记录与帮助 */
  const toolWrap = el('div', 'tool-menu');
  const toolBtn = button('更多', 'tool-btn tool-menu-btn', () => toggleToolMenu(), '更多工具与资料');
  toolBtn.setAttribute('aria-controls', 'wb-tools');
  toolBtn.setAttribute('aria-expanded', 'false');
  const toolPop = el('div', 'tool-menu-pop');
  toolPop.id = 'wb-tools';
  toolPop.hidden = true;
  toolPop.setAttribute('role', 'group');
  toolPop.setAttribute('aria-label', '工具与显示设置');
  const labelItem = button('', 'tool-menu-item', () => {
    if (!scene) return;
    scene.setLabels(!scene.labelsOn);
    syncLabelItem();
  }, '显示或隐藏零件名称标注');
  labelItem.appendChild(el('span', '', '零件标注'));
  const labelState = el('span', 'tool-menu-state', '开');
  labelItem.appendChild(labelState);
  toolPop.appendChild(labelItem);
  const qualityItem = button('', 'tool-menu-item', () => {
    if (!scene) return;
    const next = scene.getQuality() === 'high' ? 'low' : 'high';
    scene.setQuality(next);
    try { localStorage.setItem('chem3d-lab:quality', next); } catch { /* 忽略 */ }
    syncQualityBtn();
    toast('info', next === 'low' ? '已切换低画质：降低像素比并关闭阴影，操作更流畅。' : '已切换高画质：恢复阴影与高分辨率渲染。');
  }, '高画质含阴影与高分辨率；低画质适合触屏与低性能设备');
  qualityItem.appendChild(el('span', '', '画质'));
  const qualityState = el('span', 'tool-menu-state', '高');
  qualityItem.appendChild(qualityState);
  toolPop.appendChild(qualityItem);
  const viewGroup = el('div', 'wb-view-options');
  for (const [name, label] of [['front', '正视'], ['side', '侧视'], ['top', '俯视'], ['iso', '等轴测']] as const) {
    viewGroup.appendChild(button(label, 'tool-menu-item', () => {
      scene?.setView(name);
      closeToolMenu(true);
    }, `切换到${label}视角`));
  }
  toolPop.appendChild(viewGroup);
  if (uploadAssets.length) {
    const asset = uploadAssets[0];
    toolPop.appendChild(button(deviceId === 'pump' ? '上传外观对照' : '高精度外观', 'tool-menu-item asset-link-btn', () => {
      location.hash = '#/assets/' + asset.id;
    }, `查看上传素材中的${asset.name}（外观展示，不含内部结构）`));
  }
  const sourceLink = el('a', 'tool-menu-item', '教学来源与适用范围');
  sourceLink.href = sourcesUrl;
  sourceLink.target = '_blank';
  sourceLink.rel = 'noopener';
  toolPop.appendChild(sourceLink);
  if (deviceId === 'pump') {
    const pumpSource = el('a', 'tool-menu-item', '离心泵样板依据');
    pumpSource.href = pumpSourcesUrl;
    pumpSource.target = '_blank';
    pumpSource.rel = 'noopener';
    toolPop.appendChild(pumpSource);
  }
  toolPop.appendChild(button('全屏查看', 'tool-menu-item', () => {
    closeToolMenu(true);
    if (document.fullscreenElement) document.exitFullscreen();
    else canvasWrap.requestFullscreen?.();
  }, '全屏查看三维视窗'));
  toolPop.appendChild(button('学习记录', 'tool-menu-item', () => {
    closeToolMenu(true);
    openRecordsDialog();
  }, '查看、导出、导入或清除本机学习记录'));
  toolPop.appendChild(button('操作帮助', 'tool-menu-item', () => {
    closeToolMenu(true);
    showHelp();
  }, '查看操作帮助'));
  toolPop.appendChild(topActions);
  toolWrap.appendChild(toolBtn);
  toolWrap.appendChild(toolPop);
  topbar.appendChild(toolWrap);
  function syncLabelItem() {
    const on = scene?.labelsOn ?? true;
    labelState.textContent = on ? '开' : '关';
    labelItem.classList.toggle('active', on);
    labelItem.setAttribute('aria-label', `零件标注：${on ? '开' : '关'}，点击切换`);
  }
  function syncQualityBtn() {
    const q = scene?.getQuality() ?? 'high';
    qualityState.textContent = q === 'high' ? '高' : '低';
    qualityItem.classList.toggle('active', q === 'high');
    qualityItem.setAttribute('aria-label', `画质：${q === 'high' ? '高' : '低'}，点击切换`);
  }
  function toggleToolMenu(force?: boolean) {
    const open = force ?? toolPop.hidden;
    if (open) setModesOpen(false);
    toolPop.hidden = !open;
    toolBtn.setAttribute('aria-expanded', String(open));
    if (open) toolPop.querySelector<HTMLButtonElement>('button')?.focus();
  }
  function closeToolMenu(restoreFocus = false) {
    toolPop.hidden = true;
    toolBtn.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toolBtn.focus({ preventScroll: true });
  }
  const onDocumentClick = (ev: MouseEvent) => {
    if (!(ev.target instanceof Node)) return;
    if (!toolWrap.contains(ev.target)) closeToolMenu();
    if (!tabs.contains(ev.target) && !modesButton.contains(ev.target)) setModesOpen(false);
    const options = narrowPracticeOptions();
    if (options && !options.contains(ev.target)) options.open = false;
  };
  document.addEventListener('click', onDocumentClick);

  /* 内窥 HUD：当前位置、液流方向说明 */
  const endoHud = el('div', 'endo-hud');
  endoHud.hidden = true;
  endoHud.setAttribute('aria-live', 'polite');
  const endoHudTop = el('div', 'endo-hud-top');
  endoHudTop.appendChild(el('span', 'badge badge-model', '内窥 · 教学示意'));
  const endoHudCount = el('span', 'endo-hud-count', '');
  endoHudTop.appendChild(endoHudCount);
  endoHud.appendChild(endoHudTop);
  const endoHudName = el('strong', 'endo-hud-name', '');
  endoHud.appendChild(endoHudName);
  const endoFlowRow = el('div', 'endo-flow-row');
  endoFlowRow.appendChild(el('span', 'endo-flow-label', '液流方向'));
  const endoFlowArrow = el('span', 'endo-flow-arrow', '↑');
  endoFlowRow.appendChild(endoFlowArrow);
  endoFlowRow.appendChild(el('span', 'endo-flow-tip', '箭头指向屏幕上的流动方向'));
  endoHud.appendChild(endoFlowRow);
  const endoHudHint = el('p', 'endo-hud-hint', '');
  endoHud.appendChild(endoHudHint);
  endoHud.appendChild(el('p', 'endo-hud-note', '拖动画面可环顾（限制角度）；视点位于真实连通的通道空腔内，蜗壳段为预设观察点。'));
  center.appendChild(endoHud);

  function syncEndoHud() {
    if (!scene || currentMode !== 'endoscope' || !scene.endoscopeActive) { endoHud.hidden = true; return; }
    const st = scene.getEndoscopeState();
    if (!st.supported || !st.stop) { endoHud.hidden = true; return; }
    endoHud.hidden = false;
    endoHudCount.textContent = `${st.index + 1} / ${st.count}`;
    endoHudName.textContent = st.stop.name;
    endoHudHint.textContent = st.stop.hint;
    endoFlowArrow.style.transform = `rotate(${scene.getEndoFlowScreenAngle()}deg)`;
    syncExerciseObserve();
  }

  const loading = el('div', 'loading-overlay');
  loading.appendChild(el('div', 'spinner'));
  loading.appendChild(el('p', '', '正在构建三维教学模型…'));
  center.appendChild(loading);

  const fallback = el('div', 'webgl-fallback');
  fallback.style.display = 'none';
  center.appendChild(fallback);

  const completion = el('div', 'completion-overlay');
  completion.style.display = 'none';
  center.appendChild(completion);

  /* 手机端：零件与说明/步骤面板入口（视口优先） */
  const rail = el('div', 'wb-rail');
  const mobileBtns = el('div', 'mobile-panel-btns');
  const partsBtn = button('', 'mobile-panel-btn', () => toggleDrawer('left'), '打开零件目录');
  partsBtn.dataset.action = 'parts';
  partsBtn.setAttribute('aria-controls', left.id);
  partsBtn.appendChild(el('span', '', '零件'));
  mobileBtns.appendChild(partsBtn);
  const infoBtn = button('', 'mobile-panel-btn', () => toggleDrawer('right'), '打开说明与步骤面板');
  infoBtn.dataset.action = 'info';
  infoBtn.setAttribute('aria-controls', 'wb-details');
  const infoBtnLabel = el('span', '', '说明与任务');
  infoBtn.appendChild(infoBtnLabel);
  mobileBtns.appendChild(infoBtn);
  rail.append(mobileBtns, canvasToolbar);
  const boundary = '教学示意模型';
  const status = el('div', 'wb-status badge-model', boundary);
  status.setAttribute('role', 'status');
  rail.appendChild(status);
  page.appendChild(rail);
  let statusTimer = 0;
  let statusFallback = boundary;

  main.appendChild(center);

  /* 右侧说明 / 步骤 */
  const right = el('aside', 'panel right-panel');
  right.id = 'wb-details';
  const rightHead = el('div', 'panel-head');
  rightHead.appendChild(el('h2', 'panel-title', '说明与步骤'));
  const rightCollapse = button('', 'btn btn-ghost icon-btn panel-collapse', () => closePanel('right'), '收起说明与步骤');
  rightCollapse.appendChild(icon(ICONS.close, 16));
  rightHead.appendChild(rightCollapse);
  right.appendChild(rightHead);
  const infoBody = el('div', 'info-body');
  right.appendChild(infoBody);
  main.appendChild(right);

  page.appendChild(main);

  /* ============ 底部控制条 ============ */
  const bottom = el('div', 'wb-bottom');
  page.appendChild(bottom);
  root.appendChild(page);

  /* ============ 面板收起 / 抽屉 ============ */
  const isMobileLayout = () => matchMedia('(max-width: 900px)').matches;
  function narrowPracticeOptions() {
    return isMobileLayout() ? bottom.querySelector<HTMLDetailsElement>('.wb-practice-options[open]') : null;
  }
  let openPanel: 'left' | 'right' | 'both' | null = null;
  function setPanel(side: typeof openPanel, focus = false) {
    openPanel = side;
    syncDrawerInert();
    if (focus && side) (side === 'left' ? leftCollapse : rightCollapse).focus({ preventScroll: true });
  }
  function closePanel(side: 'left' | 'right') {
    if (openPanel === 'both') {
      setPanel(side === 'left' ? 'right' : 'left');
      (side === 'left' ? partsBtn : infoBtn).focus({ preventScroll: true });
    } else if (openPanel === side) closeDrawers(true);
  }
  function toggleDrawer(side: 'left' | 'right') {
    if (openPanel === side || openPanel === 'both') closePanel(side);
    else setPanel(side, true);
  }
  function closeDrawers(restoreFocus = false) {
    const previous = openPanel;
    setPanel(null);
    if (restoreFocus && previous) (previous === 'left' ? partsBtn : infoBtn).focus({ preventScroll: true });
  }
  function syncDrawerInert() {
    const narrow = isMobileLayout();
    for (const [side, panel, trigger] of [['left', left, partsBtn], ['right', right, infoBtn]] as const) {
      const open = side === openPanel || openPanel === 'both';
      panel.inert = !open;
      panel.classList.toggle('collapsed', !open);
      panel.classList.toggle('drawer-open', open && narrow);
      trigger.setAttribute('aria-expanded', String(open));
    }
  }
  const layoutQuery = matchMedia('(max-width: 900px)');
  const onLayoutWidth = () => {
    if (isMobileLayout() && openPanel === 'both') setPanel('right');
    else syncDrawerInert();
    const options = bottom.querySelector<HTMLDetailsElement>('.wb-practice-options');
    if (options) options.open = !isMobileLayout();
  };
  layoutQuery.addEventListener('change', onLayoutWidth);
  const onModeWidth = () => setModesOpen(false);
  compactModes.addEventListener('change', onModeWidth);
  page.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const options = narrowPracticeOptions();
    if (scene?.cancelPracticeInput()) {
      event.preventDefault();
      return;
    }
    if (!toolPop.hidden) closeToolMenu(true);
    else if (compactModes.matches && !tabs.hidden) {
      setModesOpen(false);
      modesButton.focus({ preventScroll: true });
    } else if (options) {
      options.open = false;
      options.querySelector('summary')?.focus({ preventScroll: true });
    } else if (openPanel) closeDrawers(true);
    else return;
    event.preventDefault();
  });
  modesButton.addEventListener('click', () => closeToolMenu());
  syncDrawerInert();

  /* ============ Toast ============ */
  function toast(kind: 'success' | 'error' | 'info' | 'warn', msg: string) {
    status.replaceChildren(el('span', 'toast', msg));
    status.title = msg;
    status.dataset.kind = kind;
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      status.textContent = statusFallback;
      status.removeAttribute('title');
      delete status.dataset.kind;
    }, 6200);
  }

  /* ============ 说明与步骤面板 ============ */
  function renderPanel(partId: string | null) {
    infoBody.innerHTML = '';
    if (exercisePhase) renderExerciseBlock(infoBody);
    if (currentMode === 'practice' && practice) renderStepsBlock(infoBody);
    if (currentMode === 'principle') {
      const desc = el('details', 'wb-intro');
      desc.appendChild(el('summary', '', '原理说明'));
      desc.appendChild(el('p', 'info-desc', PRINCIPLE_TEXT[device.id] ?? device.principle));
      infoBody.appendChild(desc);
    }
    if (partId) renderPartInfo(partId);
    else if (currentMode !== 'practice') renderOverview();
  }

  function renderStepsBlock(container: HTMLElement) {
    const s = practice ?? scene?.getPracticeState();
    if (!s) return;
    const block = el('div', 'steps-block');
    const head = el('div', 'steps-head');
    head.appendChild(el('h3', '', s.mode === 'guided' ? '按顺序完成拆卸与组装' : '自由练习'));
    const total = s.steps.length;
    head.appendChild(el('span', 'steps-count',
      s.mode === 'guided' ? `${Math.min(s.stepIndex + 1, total)} / ${total} 步` : `已拆下 ${s.totalRemovals} 次`));
    block.appendChild(head);
    if (s.mode === 'guided') {
      const list = el('ol', 'step-list');
      s.steps.forEach((step, i) => {
        const item = el('li', 'step-item' + (i < s.stepIndex ? ' done' : i === s.stepIndex ? ' current' : ''));
        item.appendChild(el('span', 'step-index', i < s.stepIndex ? '✓' : String(i + 1)));
        item.appendChild(el('span', 'step-title', step.title));
        if (i === s.stepIndex && !s.completed) {
          item.appendChild(button('定位', 'step-locate', () => {
            scene?.select(step.partId, true);
            closeDrawers();
            renderPanel(scene?.selected ?? null);
          }, '选中该步骤对应的零件'));
        }
        list.appendChild(item);
      });
      block.appendChild(list);
      block.appendChild(el('p', 'steps-note', s.completed
        ? '练习已完成，可重新开始或切换自由练习。'
        : '在目录或三维模型中选中零件，用底部按钮拆卸或安装；点「定位」可快速选中当前零件。'));
    } else {
      const removable = device.parts.filter((p) => p.removable).length;
      const installedCount = s.installed.filter((id) => device.parts.find((p) => p.id === id)?.removable).length;
      block.appendChild(el('p', 'steps-note',
        `先把 ${removable} 个可拆零件全部拆下，再按正确顺序装回（已安装 ${installedCount}/${removable}）。拖拽零件到虚线位置，或选中后点「安装到位置」。`));
    }
    container.appendChild(block);
    container.appendChild(el('hr', 'steps-divider'));
  }

  function renderPartInfo(partId: string) {
      const p = device.parts.find((x) => x.id === partId)!;
      const head = el('div', 'info-part-head');
      const dot = el('span', 'info-dot');
      dot.style.background = '#' + p.color.toString(16).padStart(6, '0');
      head.appendChild(dot);
      head.appendChild(el('h3', 'info-part-name', p.name));
      infoBody.appendChild(head);
      const tags = el('div', 'info-tags');
      tags.appendChild(el('span', 'badge badge-soft', p.group));
      tags.appendChild(el('span', p.role === 'fixed' ? 'badge badge-fixed' : 'badge badge-soft', ROLE_LABEL[p.role]));
      tags.appendChild(el('span', 'badge badge-soft', JOINT_LABEL[p.joint]));
      if (p.role === 'removable') {
        const inTray = practice && !practice.installed.includes(p.id);
        tags.appendChild(el('span', 'badge badge-soft', inTray ? '已拆下 · 在零件区' : '可拆装'));
      }
      if (p.shell) tags.appendChild(el('span', 'badge badge-soft', '外壳类'));
      infoBody.appendChild(tags);
      infoBody.appendChild(el('p', 'info-desc', p.desc));
      if (p.role === 'display') {
        infoBody.appendChild(el('p', 'info-note', '该部件为焊接/整体固定结构：爆炸图中展开仅用于理解装配关系，拆装练习中不可拆卸。'));
      }
      if (p.role === 'removable' && !device.assemblyOrder.length) {
        infoBody.appendChild(el('p', 'info-note', '按连接方式该部件可拆卸；本设备的拆装练习流程尚未开放，当前可用于结构观察。'));
      }
      const actions = el('div', 'info-actions');
      actions.appendChild(button('聚焦观察', 'btn btn-outline', () => scene?.focusPart(p.id)));
      if (currentMode !== 'practice') {
        const hiddenBtn = button(scene?.isPartHidden(p.id) ? '显示该零件' : '隐藏该零件', 'btn btn-outline', () => {
          const hide = !scene!.isPartHidden(p.id);
          scene!.setPartHidden(p.id, hide);
          renderPanel(p.id);
        });
        actions.appendChild(hiddenBtn);
        actions.appendChild(button('透明化', 'btn btn-outline', () => {
          scene!.setPartOpacity(p.id, 0.22);
          toast('info', `「${p.name}」已透明化，可继续点选内部零件观察。`);
        }));
        actions.appendChild(button('恢复不透明', 'btn btn-outline', () => {
          scene!.setPartOpacity(p.id, 1);
        }));
        actions.appendChild(button('显示全部零件', 'btn btn-outline', () => {
          scene!.resetPartEffects();
          renderPanel(scene!.selected);
          toast('info', '已恢复全部零件的显示与不透明度。');
        }));
      }
      if (currentMode === 'practice' && p.removable) {
        const inTray = practice && !practice.installed.includes(p.id);
        if (inTray) {
          actions.appendChild(button('安装到位置', 'btn btn-primary', () => scene?.installSelected()));
          if (p.orientable) actions.appendChild(button('旋转 90°', 'btn btn-outline', () => scene?.rotateSelected()));
        } else {
          actions.appendChild(button('拆下该零件', 'btn btn-warn', () => scene?.removeSelected()));
        }
      }
      infoBody.appendChild(actions);
      if (p.prereq?.length) {
        const pre = el('p', 'info-note', `安装前置：${p.prereq.map((id) => device.parts.find((x) => x.id === id)?.name).join('、')}`);
        infoBody.appendChild(pre);
      }
  }

  function renderOverview() {
      const intro = el('details', 'wb-intro');
      intro.appendChild(el('summary', '', '设备介绍与学习目标'));
      intro.appendChild(el('h4', 'info-h4', '用途'));
      intro.appendChild(el('p', 'info-desc', device.use));
      intro.appendChild(el('h4', 'info-h4', '工作原理'));
      intro.appendChild(el('p', 'info-desc', device.principle));
      intro.appendChild(el('h4', 'info-h4', '教学模型结构特点'));
      intro.appendChild(el('p', 'info-desc', device.structureNote));
      intro.appendChild(el('h4', 'info-h4', '学习要点'));
      const ul = el('ul', 'info-points');
      for (const pt of device.learningPoints) ul.appendChild(el('li', '', pt));
      intro.appendChild(ul);
      intro.appendChild(el('h4', 'info-h4', '学习目标'));
      const ol = el('ul', 'info-points');
      for (const ob of device.objectives) ol.appendChild(el('li', '', ob));
      intro.appendChild(ol);
      infoBody.appendChild(intro);
      if (!device.assemblyOrder.length) {
        infoBody.appendChild(el('p', 'info-note', '拆装练习尚未开放：本设备当前可使用整体观察、剖视、透明观察、爆炸图与工作原理演示。'));
      }
      if (exercisePhase) {
        infoBody.appendChild(el('p', 'info-note', '结构自测进行中：请按上方面板完成当前步骤；退出或结束后可继续其他观察任务。'));
      } else {
        renderTasks(infoBody);
      }
      infoBody.appendChild(el('p', 'info-note', '提示：点击三维模型或左侧目录中的零件，这里会显示对应的部件说明。'));
      infoBody.appendChild(el('p', 'info-note', '模型与参数为教学示意：未取得可靠来源的设备参数与工程尺寸标注「待确认」，不作为工程设计依据。'));
  }

  /* ---- 观察任务清单 ---- */
  function taskCounts() {
    const tasks = taskState(deviceId);
    const manual = device.tasks.filter((t) => !t.exercise);
    const checks = device.tasks.filter((t) => t.exercise);
    return {
      manualDone: manual.filter((t) => tasks[t.id]).length,
      manualTotal: manual.length,
      checkDone: checks.filter((t) => getSelfCheck(deviceId, t.id)?.done).length,
      checkTotal: checks.length
    };
  }
  function taskHeaderText() {
    const c = taskCounts();
    return `观察任务（手动 ${c.manualDone}/${c.manualTotal}${c.checkTotal ? ` · 自测 ${c.checkDone}/${c.checkTotal}` : ''}）`;
  }

  function renderTasks(container: HTMLElement) {
    const tasks = taskState(deviceId);
    const head = el('h4', 'info-h4', taskHeaderText());
    container.appendChild(head);
    const list = el('div', 'task-list');
    for (const t of device.tasks) {
      if (t.exercise) {
        const rec = getSelfCheck(deviceId, t.id);
        const row = el('div', 'task-row task-exercise' + (rec?.done ? ' task-done' : ''));
        const main = el('div', 'task-exercise-main');
        const badges = el('div', 'task-exercise-tags');
        badges.appendChild(el('span', 'badge badge-soft', '结构自测'));
        badges.appendChild(el('span', 'badge ' + (rec?.done ? 'badge-ok' : 'badge-soft'), rec?.done ? '已通过' : '未开始'));
        main.appendChild(badges);
        main.appendChild(el('p', 'task-text', t.text));
        main.appendChild(el('p', 'task-note', rec?.done
          ? `成绩已保存（首次完成 ${new Date(rec.date).toLocaleDateString('zh-CN')}，尝试 ${rec.attempts} 次）；重复练习不重复计数。`
          : '与上方手动勾选分开保存；完成后刷新仍保留成绩。'));
        row.appendChild(main);
        row.appendChild(button(rec?.done ? '再练一次' : '开始练习', 'btn btn-outline task-go exercise-start', () => startExercise(t), '进入结构自测：先沿吸入口观察，再到剖视图指出叶轮'));
        list.appendChild(row);
        continue;
      }
      const row = el('div', 'task-row' + (tasks[t.id] ? ' task-done' : ''));
      const kind = el('span', 'task-kind', t.auto ? '自动记录' : '手动勾选');
      row.appendChild(kind);
      const label = el('label', 'task-check');
      const cb = el('input') as HTMLInputElement;
      cb.type = 'checkbox';
      cb.checked = !!tasks[t.id];
      cb.disabled = !!t.auto;
      cb.setAttribute('aria-label', t.text);
      cb.addEventListener('change', () => {
        setTask(deviceId, t.id, cb.checked);
        row.classList.toggle('task-done', cb.checked);
        head.textContent = taskHeaderText();
      });
      label.appendChild(cb);
      label.appendChild(el('span', 'task-text', t.text + (t.auto ? '（完成练习后自动记录）' : '')));
      row.appendChild(label);
      row.appendChild(button('前往', 'btn btn-outline task-go', () => {
        if (!switchMode(t.mode)) return;
        if (t.partId) scene?.select(t.partId, true);
        closeDrawers();
      }, `切换到${t.mode === 'practice' ? '拆装练习' : '对应观察模式'}并定位`));
      list.appendChild(row);
    }
    container.appendChild(list);
  }

  /* ---- 结构自测：沿吸入口观察 → 剖视图辨认叶轮 ---- */
  function startExercise(task: ObservationTask) {
    const ex = task.exercise;
    if (!ex || !scene) return;
    exerciseTask = task;
    exercisePhase = 'observe';
    exerciseObserved = false;
    exerciseAttempts = 0;
    exerciseWrongId = null;
    exerciseMessage = '';
    scene.clearSelectionAndHover();
    scene.resetPartEffects();
    switchMode('endoscope', true);
    scene.setEndoscopeStop(ex.observe.startStop, true);
    renderBottom();
    syncEndoHud();
    renderPanel(scene.selected);
    setPanel('right');
    requestAnimationFrame(() => {
      const nextBtn = bottom.querySelector<HTMLButtonElement>('[data-endo-nav="next"]');
      (nextBtn && !nextBtn.disabled ? nextBtn : infoBody.querySelector<HTMLButtonElement>('.exercise-enter-identify'))?.focus({ preventScroll: true });
    });
    toast('info', '结构自测开始：已清除零件高亮。先沿内窥视点观察液体路线。');
  }

  function enterExerciseIdentify() {
    const ex = exerciseTask?.exercise;
    if (!ex || !scene || !exerciseObserved) return;
    exercisePhase = 'identify';
    exerciseWrongId = null;
    exerciseMessage = '';
    scene.clearSelectionAndHover();
    switchMode('section', true);
    scene.setSection(ex.identify.axis, ex.identify.position, ex.identify.flip);
    renderBottom();
    renderPanel(null);
    syncTree();
    setPanel(isMobileLayout() ? 'right' : 'both');
    requestAnimationFrame(() => {
      if (!isMobileLayout()) {
        tree.querySelector<HTMLButtonElement>('.tree-item')?.focus({ preventScroll: true });
      } else {
        infoBody.querySelector<HTMLElement>('.exercise-prompt')?.focus({ preventScroll: true });
      }
    });
  }

  function judgeExerciseSelection(partId: string) {
    const ex = exerciseTask?.exercise;
    if (!ex || exercisePhase !== 'identify') return;
    if (partId === ex.identify.answerPartId) {
      exerciseAttempts++;
      exercisePhase = 'done';
      exerciseWrongId = null;
      exerciseMessage = ex.identify.successNote;
      saveSelfCheck(deviceId, exerciseTask!.id, exerciseAttempts);
      if (openPanel !== 'both') setPanel('right');
      toast('success', `回答正确：${ex.identify.answerName}。成绩已保存（重复练习不重复计数）。`);
      requestAnimationFrame(() => {
        infoBody.querySelector<HTMLButtonElement>('.exercise-finish')?.focus({ preventScroll: true });
      });
    } else {
      exerciseAttempts++;
      exerciseWrongId = partId;
      exerciseMessage = ex.identify.wrongHint;
      const name = device.parts.find((p) => p.id === partId)?.name ?? '该零件';
      toast('warn', `「${name}」不是叶轮。右侧已给出结构线索，可以再试一次。`);
    }
  }

  function endExercise() {
    const wasDone = exercisePhase === 'done';
    exerciseTask = null;
    exercisePhase = null;
    exerciseObserved = false;
    exerciseAttempts = 0;
    exerciseWrongId = null;
    exerciseMessage = '';
    scene?.clearSelectionAndHover();
    switchMode('observe', true);
    renderPanel(null);
    setPanel('right');
    requestAnimationFrame(() => {
      infoBody.querySelector<HTMLButtonElement>('.exercise-start')?.focus({ preventScroll: true });
    });
    toast('info', wasDone ? '已结束自测，继续自由观察。' : '已退出结构自测，继续自由观察。');
  }

  function syncExerciseObserve() {
    const ex = exerciseTask?.exercise;
    if (!ex || exercisePhase !== 'observe' || !scene) return;
    const st = scene.getEndoscopeState();
    const reached = exerciseObserved || st.index >= ex.observe.requiredStop;
    const firstReached = !exerciseObserved && reached;
    if (firstReached) {
      exerciseObserved = true;
      toast('success', ex.observe.reachedNote);
    }
    renderPanel(scene.selected);
  }

  function renderExerciseBlock(container: HTMLElement) {
    const task = exerciseTask;
    const ex = task?.exercise;
    if (!task || !ex) return;
    const rec = getSelfCheck(deviceId, task.id);
    const block = el('section', 'exercise-block');
    block.setAttribute('aria-label', '结构自测');
    const head = el('div', 'exercise-head');
    head.appendChild(el('h3', 'exercise-title', '结构自测 · 沿吸入口找叶轮'));
    head.appendChild(el('span', 'badge ' + (exercisePhase === 'done' ? 'badge-ok' : 'badge-model'),
      exercisePhase === 'done' ? '已完成' : exercisePhase === 'identify' ? '第 2 步 · 辨认' : '第 1 步 · 观察'));
    block.appendChild(head);

    const outline = el('ol', 'exercise-steps');
    const s1 = el('li', 'exercise-step' + (exercisePhase === 'observe' ? ' current' : exercisePhase ? ' done' : ''));
    s1.appendChild(el('span', 'step-index', exercisePhase === 'observe' ? '1' : '✓'));
    s1.appendChild(el('span', '', '沿吸入口观察液体到达哪里'));
    const s2 = el('li', 'exercise-step' + (exercisePhase === 'identify' ? ' current' : exercisePhase === 'done' ? ' done' : ''));
    s2.appendChild(el('span', 'step-index', exercisePhase === 'done' ? '✓' : '2'));
    s2.appendChild(el('span', '', '回到剖视图指出叶轮'));
    outline.appendChild(s1);
    outline.appendChild(s2);
    block.appendChild(outline);

    if (exercisePhase === 'observe') {
      const st = scene?.getEndoscopeState();
      const reached = exerciseObserved || (st ? st.index >= ex.observe.requiredStop : false);
      const msg = el('p', 'exercise-msg');
      msg.setAttribute('aria-live', 'polite');
      msg.textContent = reached
        ? ex.observe.reachedNote
        : `${ex.observe.prompt} 当前视点：${st?.stop?.name ?? '—'}（${st ? st.index + 1 : 0}/${st?.count ?? 0}）。`;
      block.appendChild(msg);
      const actions = el('div', 'exercise-actions');
      const enter = button('回到剖视图辨认叶轮', 'btn btn-primary exercise-enter-identify', () => enterExerciseIdentify(), '切换到轴向剖视图，自己点选叶轮');
      enter.disabled = !reached;
      actions.appendChild(enter);
      actions.appendChild(button('退出练习', 'btn btn-outline', () => endExercise(), '退出结构自测，恢复自由观察'));
      block.appendChild(actions);
    } else if (exercisePhase === 'identify') {
      const prompt = el('p', 'exercise-msg exercise-prompt', ex.identify.prompt);
      prompt.tabIndex = -1;
      block.appendChild(prompt);
      if (exerciseMessage) {
        const feedback = el('p', 'exercise-feedback', exerciseMessage);
        feedback.setAttribute('role', 'alert');
        block.appendChild(feedback);
      }
      block.appendChild(el('p', 'exercise-note', '点击三维模型，或用 Tab 在左侧零件目录中选择并按 Enter。选错会给出结构线索，可以重试。'));
      const actions = el('div', 'exercise-actions');
      if (openPanel !== 'both') actions.appendChild(button('打开零件目录', 'btn btn-outline', () => toggleDrawer('left'), '打开零件目录'));
      actions.appendChild(button('退出练习', 'btn btn-outline', () => endExercise(), '退出结构自测，恢复自由观察'));
      block.appendChild(actions);
    } else if (exercisePhase === 'done') {
      block.appendChild(el('p', 'exercise-msg exercise-success', exerciseMessage || ex.identify.successNote));
      block.appendChild(el('p', 'exercise-note', `成绩已保存${rec?.done ? `（首次完成 ${new Date(rec.date).toLocaleDateString('zh-CN')}，尝试 ${rec.attempts} 次）` : ''}；重复完成同一题不重复计数。`));
      const actions = el('div', 'exercise-actions');
      actions.appendChild(button('结束练习，自由观察', 'btn btn-primary exercise-finish', () => endExercise(), '结束自测，继续自由观察'));
      actions.appendChild(button('再练一次', 'btn btn-outline', () => startExercise(task), '重新开始同一道结构自测'));
      block.appendChild(actions);
    }
    container.appendChild(block);
    container.appendChild(el('hr', 'steps-divider'));
  }

  function syncTree() {
    for (const [id, item] of treeItems) {
      item.classList.toggle('active', scene?.selected === id);
      const tag = item.querySelector('.tree-tag') as HTMLElement;
      const p = device.parts.find((x) => x.id === id)!;
      if (p.role === 'fixed') tag.textContent = '固定';
      else if (currentMode === 'practice' && practice && p.removable) {
        const inTray = !practice.installed.includes(id);
        tag.textContent = inTray ? '已拆下' : '可拆';
        tag.classList.toggle('tag-tray', inTray);
      } else {
        tag.textContent = p.role === 'removable' ? '可拆' : '展开';
        tag.classList.remove('tag-tray');
      }
    }
    const selected = scene?.selected ?? null;
    if (selected !== lastScrolledSelected) {
      lastScrolledSelected = selected;
      if (selected) treeItems.get(selected)?.scrollIntoView({ block: 'nearest' });
    }
  }

  /* ============ 模式切换 ============ */
  function switchMode(mode: Mode, force = false): boolean {
    if (!scene) {
      pendingMode = mode;
      return true;
    }
    if (mode === currentMode) return true;
    if (!force && exercisePhase && exercisePhase !== 'done') {
      const expected: Mode = exercisePhase === 'observe' ? 'endoscope' : 'section';
      if (mode !== expected) {
        toast('info', '结构自测进行中：请先完成当前步骤，或点「退出练习」后再自由观察。');
        return false;
      }
    }
    stopExplodeAnim();
    if (currentMode === 'practice' && practice && !practice.completed) {
      sessionSnapshots[practice.mode] = practice;
    }
    currentMode = mode;
    page.dataset.mode = mode;
    resetView.hidden = mode === 'endoscope';
    if (mode !== 'practice') {
      statusFallback = boundary;
      if (!status.dataset.kind) status.textContent = statusFallback;
    }
    scene.setMode(mode);
    if (mode === 'section' && device.id === 'gear-pump') scene.setView('side');
    if (mode === 'section' && device.id === 'screw-compressor') scene.setView('front');
    tabButtons.forEach((b, id) => {
      const on = id === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const modeDef = MODE_TABS.find((t) => t.id === mode);
    if (modeDef) {
      modesButton.textContent = modeDef.label;
      modesButton.setAttribute('aria-label', `切换学习模式，当前为${modeDef.label}`);
    }
    infoBtnLabel.textContent = mode === 'practice' ? '步骤' : '说明与任务';
    if (mode === 'practice') {
      if (!scene.practiceActive) {
        const saved = getRecord(deviceId).practice;
        if (saved && !saved.completed && practiceCompatible(deviceId)) {
          scene.startPractice(saved.mode, saved);
          toast('info', '已恢复上次保存的练习进度。');
        } else {
          if (saved && !saved.completed) {
            clearPractice(deviceId);
            toast('warn', '检测到旧内容版本的练习进度，与当前内容不兼容，已开始新的练习。');
          }
          scene.startPractice('guided');
        }
      }
    }
    renderBottom();
    renderPanel(scene.selected);
    syncTree();
    syncEndoHud();
    if (mode === 'practice' || isMobileLayout()) closeDrawers();
    if (mode === 'practice' && isMobileLayout()) scene.fitView(false);
    return true;
  }

  /* ============ 底部控制条 ============ */
  const bottomRefs: Record<string, HTMLElement> = {};

  function focusAfterEndoNav(prefer: 'prev' | 'next' | number, wasObserved: boolean) {
    requestAnimationFrame(() => {
      if (exercisePhase === 'observe' && exerciseObserved && !wasObserved) {
        const cta = infoBody.querySelector<HTMLButtonElement>('.exercise-enter-identify');
        if (cta && !cta.disabled) { cta.focus({ preventScroll: true }); return; }
      }
      if (typeof prefer === 'number') {
        bottom.querySelector<HTMLButtonElement>(`[data-endo-stop="${prefer}"]`)?.focus({ preventScroll: true });
        return;
      }
      const order = prefer === 'next' ? ['next', 'prev'] : ['prev', 'next'];
      for (const k of order) {
        const b = bottom.querySelector<HTMLButtonElement>(`[data-endo-nav="${k}"]`);
        if (b && !b.disabled) { b.focus({ preventScroll: true }); return; }
      }
      bottom.querySelector<HTMLButtonElement>('.endo-stops .tool-btn')?.focus({ preventScroll: true });
    });
  }

  function appendInteraction() {
    const def = INTERACTIONS[device.id];
    if (!def || !scene) return;
    const s = sliderRow(def.label, 0, 100, Math.round(scene.interactionT * 100), 1, (v) => scene!.setInteraction(v / 100), (v) => `${v}%`);
    bottom.appendChild(s.row);
    bottom.appendChild(el('span', 'ctrl-note', def.hint));
  }

  function renderBottom() {
    bottom.innerHTML = '';
    for (const k of Object.keys(bottomRefs)) delete bottomRefs[k];
    if (principleTimer) { clearInterval(principleTimer); principleTimer = 0; }
    if (!scene) return;

    if (currentMode === 'observe') {
      if (deviceId === 'pump') {
        const detail = button('近看外观', 'tool-btn' + (pumpExteriorDetail ? ' active' : ''), () => {
          pumpExteriorDetail = !pumpExteriorDetail;
          scene?.setPumpExteriorDetail(pumpExteriorDetail);
          detail.classList.toggle('active', pumpExteriorDetail);
          detail.setAttribute('aria-pressed', String(pumpExteriorDetail));
        }, '近看外观：细化本教学泵蜗壳，沿用零件和视角');
        detail.setAttribute('aria-pressed', String(pumpExteriorDetail));
        bottom.appendChild(detail);
      }
      appendInteraction();
      const hint = el('div', 'ctrl-hint');
      hint.appendChild(icon(ICONS.info, 15));
      hint.appendChild(el('span', '', '左键拖动旋转 · 滚轮缩放 · 右键（或双指）平移 · 点击零件查看说明。试试上方的剖视、透明、爆炸与原理演示。'));
      bottom.appendChild(hint);
      return;
    }

    if (currentMode === 'section') {
      const axisGroup = el('div', 'toolbar-group');
      axisGroup.appendChild(el('span', 'ctrl-label', '剖切方向'));
      const gearPreset = device.id === 'gear-pump';
      const screwPreset = device.id === 'screw-compressor';
      let axis: 'x' | 'y' | 'z' = device.id === 'pump' || screwPreset ? 'z' : 'x';
      let flip = device.id === 'pump' || gearPreset || screwPreset;
      const defaultT = device.id === 'pump' ? 50 : gearPreset ? 32 : 50;
      const axisBtns: HTMLButtonElement[] = [];
      const apply = () => scene!.setSection(axis, Number(secSlider.input.value) / 100, flip);
      for (const [a, label] of [['x', '左右剖 (X)'], ['y', '上下剖 (Y)'], ['z', '前后剖 (Z)']] as const) {
        const b = button(label, 'tool-btn' + (a === axis ? ' active' : ''), () => {
          axis = a;
          axisBtns.forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
          apply();
        });
        axisBtns.push(b);
        axisGroup.appendChild(b);
      }
      bottom.appendChild(axisGroup);
      const secSlider = sliderRow('剖切位置', 0, 100, defaultT, 1, apply, (v) => `${v}%`);
      bottom.appendChild(secSlider.row);
      const flipBtn = button('反向剖切', 'tool-btn' + (flip ? ' active' : ''), () => {
        flip = !flip;
        flipBtn.classList.toggle('active', flip);
        apply();
      });
      bottom.appendChild(flipBtn);
      const localBtn = button('局部剖切（仅选中件）', 'tool-btn', () => {
        const active = localBtn.classList.toggle('active');
        scene!.setSectionLocal(active);
        if (active && !scene!.selected) toast('info', '局部剖切已开启：先在目录或三维模型中选中一个零件，仅剖切该零件。');
      });
      bottom.appendChild(localBtn);
      bottom.appendChild(el('span', 'ctrl-note', device.id === 'pump'
        ? '真实几何剖切：默认沿轴向（Z）剖开，从 +Z 方向可见吸入—叶轮—蜗壳—排出流道；切面为开口截面（不做封口填充）。'
        : gearPreset
          ? '剖切到齿轮厚度内：从 +X 方向可见两齿轮与 8 字形泵腔；+Z 为吸入侧、-Z 为排出侧（蓝色/橙色接口环）。切面为开口截面（不做封口填充）。'
          : screwPreset
            ? '纵向剖视：从 +Z 方向可见双孔机腔、4/6 瓣转子与顶部进气端、底部排气端；排气管从底架中央开口向下引出。切面为开口截面（不做封口填充）。'
            : '真实几何剖切：可见壳体流道、管道内壁与壁厚；切面为开口截面（不做封口填充）。'));
      bottom.appendChild(button('退出剖视 · 恢复完整设备', 'btn btn-outline', () => switchMode('observe')));
      scene.setSection(axis, defaultT / 100, flip);
      return;
    }

    if (currentMode === 'xray') {
      const opSlider = sliderRow('外壳透明度', 10, 92, 78, 1, (v) => scene!.setShellOpacity(1 - v / 100), (v) => `${v}%`);
      bottom.appendChild(opSlider.row);
      scene.setShellOpacity(0.22);
      const hideBtn = button('隐藏外壳', 'tool-btn', () => {
        const hidden = hideBtn.classList.toggle('active');
        hideBtn.textContent = hidden ? '恢复外壳显示' : '隐藏外壳';
        scene!.setShellsHidden(hidden);
      });
      bottom.appendChild(hideBtn);
      const partOp = sliderRow('选中件不透明度', 5, 100, 22, 1, (v) => {
        if (scene!.selected) scene!.setPartOpacity(scene!.selected, v / 100);
      }, (v) => `${v}%`);
      bottom.appendChild(partOp.row);
      const glandBtn = button('隐藏密封压盖', 'tool-btn', () => {
        const hidden = glandBtn.classList.toggle('active');
        glandBtn.textContent = hidden ? '恢复密封压盖' : '隐藏密封压盖';
        scene!.setPartHidden('sealGland', hidden);
      });
      const pipeBtn = button('隐藏管道外壁', 'tool-btn', () => {
        const hidden = pipeBtn.classList.toggle('active');
        pipeBtn.textContent = hidden ? '恢复管道外壁' : '隐藏管道外壁';
        scene!.setPipeOuterHidden(hidden);
      });
      bottom.appendChild(glandBtn);
      bottom.appendChild(pipeBtn);
      bottom.appendChild(button('显示全部零件', 'tool-btn', () => {
        scene!.resetPartEffects();
        glandBtn.classList.remove('active'); glandBtn.textContent = '隐藏密封压盖';
        pipeBtn.classList.remove('active'); pipeBtn.textContent = '隐藏管道外壁';
      }));
      bottom.appendChild(el('span', 'ctrl-note', '内部零件保持不透明，便于辨认；可选中任一零件单独调节不透明度或隐藏。'));
      appendInteraction();
      bottom.appendChild(button('退出透明模式', 'btn btn-outline', () => switchMode('observe')));
      return;
    }

    if (currentMode === 'explode') {
      const exSlider = sliderRow('展开程度', 0, 100, 0, 1, (v) => {
        stopExplodeAnim();
        scene!.setExplode(v / 100);
      }, (v) => `${v}%`);
      bottom.appendChild(exSlider.row);
      bottomRefs.exSlider = exSlider.input;
      bottomRefs.exVal = exSlider.val;
      const autoBtn = button('自动展开', 'btn btn-primary', () => {
        if (explodeDir !== 0) { stopExplodeAnim(); return; }
        startExplodeAnim(scene!.getExplode() >= 0.99 ? -1 : 1);
        autoBtn.textContent = '暂停';
      });
      bottomRefs.autoBtn = autoBtn;
      bottom.appendChild(autoBtn);
      bottom.appendChild(button('合拢复原', 'btn btn-outline', () => {
        stopExplodeAnim();
        startExplodeAnim(-1);
      }));
      bottom.appendChild(el('span', 'ctrl-note', '零件沿预设装配方向展开，虚线指向原安装位置。'));
      scene.setExplode(0);
      return;
    }

    if (currentMode === 'principle') {
      const playBtn = button('暂停', 'btn btn-primary', () => {
        if (!scene) return;
        const playing = playBtn.textContent === '暂停';
        scene.setPlaying(!playing);
        playBtn.textContent = playing ? '播放' : '暂停';
      });
      bottom.appendChild(playBtn);
      bottom.appendChild(button('重播', 'btn btn-outline', () => {
        scene!.replayPrinciple();
        scene!.setPlaying(true);
        playBtn.textContent = '暂停';
      }));
      const speed = sliderRow('速度', 0.25, 2, 1, 0.25, (v) => scene!.setPrincipleSpeed(v), (v) => `${v}×`);
      bottom.appendChild(speed.row);
      if (device.id === 'diaphragm-pump') {
        const state = el('div', 'ctrl-hint diaphragm-state');
        state.setAttribute('aria-live', 'polite');
        const updateState = () => {
          if (!scene) return;
          const s = Math.sin(scene.getPrincipleTime() * 2.2);
          if (s > 0.04) {
            state.textContent = '左腔吸入 · 右腔排出｜左进口开、左出口关；右进口关、右出口开。';
          } else if (s < -0.04) {
            state.textContent = '右腔吸入 · 左腔排出｜右进口开、右出口关；左进口关、左出口开。';
          } else {
            state.textContent = '换向中 · 两侧止回阀短暂关闭。';
          }
        };
        const steps = el('div', 'toolbar-group');
        steps.appendChild(el('span', 'ctrl-label', '分步观察'));
        steps.appendChild(button('左腔吸入 · 右腔排出', 'tool-btn', () => {
          scene!.setPrincipleTime(Math.PI / (2 * 2.2));
          playBtn.textContent = '播放';
          updateState();
        }, '暂停并停到左腔吸入、右腔排出的行程'));
        steps.appendChild(button('右腔吸入 · 左腔排出', 'tool-btn', () => {
          scene!.setPrincipleTime((3 * Math.PI) / (2 * 2.2));
          playBtn.textContent = '播放';
          updateState();
        }, '暂停并停到右腔吸入、左腔排出的行程'));
        bottom.appendChild(steps);
        bottom.appendChild(state);
        updateState();
        principleTimer = window.setInterval(updateState, 200);
        bottom.appendChild(el('span', 'ctrl-note', '分步按钮会暂停动画并停在指定行程；四只止回阀球在开放式保持架中可见，关闭时落座、打开时离开阀座。'));
      }
      if (device.id === 'emf-meter') {
        const readout = el('div', 'ctrl-hint emf-readout');
        readout.appendChild(el('span', 'badge badge-model', '演示数据'));
        const txt = el('span', '', '');
        readout.appendChild(txt);
        bottom.appendChild(readout);
        const t0 = performance.now();
        const tick = () => {
          const s = (performance.now() - t0) / 1000;
          const v = 2.4 + 0.5 * Math.sin(s * 0.8);
          txt.textContent = `流速 ${v.toFixed(2)} m/s · 体积流量 ${(v * 16.1).toFixed(1)} m³/h · 电极信号 ${(v * 1.9).toFixed(2)} mV`;
        };
        tick();
        principleTimer = window.setInterval(tick, 400);
      }
      scene.setPlaying(true);
      scene.setPrincipleSpeed(1);
      return;
    }

    if (currentMode === 'endoscope') {
      const def = ENDOSCOPES[device.id];
      if (!def) {
        bottom.appendChild(el('span', 'ctrl-note', '该设备暂未开放内窥视点。'));
        return;
      }
      const st = scene.getEndoscopeState();
      const nav = el('div', 'toolbar-group');
      const prev = button('上一站', 'tool-btn', () => {
        const wasObserved = exerciseObserved;
        scene!.prevEndoscopeStop();
        renderBottom();
        syncEndoHud();
        focusAfterEndoNav('prev', wasObserved);
      }, '返回上一个内窥视点');
      prev.dataset.endoNav = 'prev';
      prev.disabled = st.index <= 0;
      const next = button('下一站', 'tool-btn', () => {
        const wasObserved = exerciseObserved;
        scene!.nextEndoscopeStop();
        renderBottom();
        syncEndoHud();
        focusAfterEndoNav('next', wasObserved);
      }, '前往下一个内窥视点');
      next.dataset.endoNav = 'next';
      next.disabled = st.index >= st.count - 1;
      nav.appendChild(prev);
      nav.appendChild(next);
      nav.appendChild(button('重置视点', 'tool-btn', () => {
        scene!.resetEndoscope();
        syncEndoHud();
        toast('info', '已回到当前视点的初始方向。');
      }, '恢复当前视点的初始朝向'));
      bottom.appendChild(nav);
      const chips = el('div', 'toolbar-group endo-stops');
      def.stops.forEach((s, i) => {
        const chip = button(`${i + 1} · ${s.name}`, 'tool-btn endo-chip' + (i === st.index ? ' active' : ''), () => {
          const wasObserved = exerciseObserved;
          scene!.setEndoscopeStop(i);
          renderBottom();
          syncEndoHud();
          focusAfterEndoNav(i, wasObserved);
        }, `移动到内窥视点 ${i + 1}：${s.name}`);
        chip.dataset.endoStop = String(i);
        chips.appendChild(chip);
      });
      bottom.appendChild(chips);
      bottom.appendChild(el('span', 'ctrl-note', def.entryNote));
      bottom.appendChild(button('退出内窥 · 恢复外部视角', 'btn btn-outline', () => switchMode('observe')));
      return;
    }

    if (currentMode === 'practice') {
      renderPracticeBar();
    }
  }

  /* ---- 爆炸自动动画 ---- */
  function startExplodeAnim(dir: number) {
    explodeDir = dir;
    let last = performance.now();
    const step = (now: number) => {
      if (!scene || explodeDir === 0) return;
      const dt = (now - last) / 1000;
      last = now;
      let t = scene.getExplode() + explodeDir * dt * 0.3;
      if (t >= 1) { t = 1; stopExplodeAnim(); }
      if (t <= 0) { t = 0; stopExplodeAnim(); }
      scene.setExplode(t);
      const slider = bottomRefs.exSlider as HTMLInputElement | undefined;
      if (slider) { slider.value = String(Math.round(t * 100)); }
      if (bottomRefs.exVal) bottomRefs.exVal.textContent = `${Math.round(t * 100)}%`;
      if (explodeDir !== 0) explodeRaf = requestAnimationFrame(step);
    };
    explodeRaf = requestAnimationFrame(step);
  }
  function stopExplodeAnim() {
    explodeDir = 0;
    cancelAnimationFrame(explodeRaf);
    const autoBtn = bottomRefs.autoBtn as HTMLButtonElement | undefined;
    if (autoBtn) autoBtn.textContent = '自动展开';
  }

  /* ---- 拆装练习控制条 ---- */
  function renderPracticeBar() {
    const wasOptionsOpen = bottom.querySelector<HTMLDetailsElement>('.wb-practice-options')?.open ?? false;
    bottom.innerHTML = '';
    const s = practice ?? scene?.getPracticeState();
    if (!s) return;

    const options = el('details', 'wb-practice-options');
    options.open = !isMobileLayout() || wasOptionsOpen;
    const optionsSummary = el('summary', 'tool-btn', '练习选项');
    options.appendChild(optionsSummary);
    const extra = el('div', 'wb-practice-extra');
    options.appendChild(extra);
    const modeSwitch = el('div', 'toolbar-group practice-mode-switch');
    for (const [m, label] of [['guided', '引导学习'], ['free', '自由练习']] as const) {
      const b = button(label, 'tool-btn' + (s.mode === m ? ' active' : ''), () => {
        if (practice?.mode === m) return;
        if (practice && !practice.completed) sessionSnapshots[practice.mode] = practice;
        const back = sessionSnapshots[m];
        scene!.startPractice(m, back && !back.completed ? back : undefined);
        for (const choice of modeSwitch.querySelectorAll('button')) {
          const active = choice === b;
          choice.classList.toggle('active', active);
          choice.setAttribute('aria-pressed', String(active));
        }
        toast('info', m === 'guided' ? '已切换到引导学习：按步骤完成拆卸与组装。' : '已切换到自由练习：自行决定拆装顺序。');
      });
      b.setAttribute('aria-pressed', String(s.mode === m));
      modeSwitch.appendChild(b);
    }
    extra.appendChild(modeSwitch);

    const progressWrap = el('div', 'practice-progress');
    const stepText = el('span', 'step-text');
    bottomRefs.stepText = stepText;
    progressWrap.appendChild(stepText);
    const bar = el('div', 'progress-bar');
    const fill = el('div', 'progress-fill');
    bottomRefs.progressFill = fill;
    bar.appendChild(fill);
    progressWrap.appendChild(bar);
    extra.appendChild(progressWrap);
    if (device.id === 'plate-exchanger') extra.appendChild(el('div', 'ctrl-hint', '板片、垫片、活动板和螺栓：拖动后松开即沿预设路径安装；移出画布可取消。'));

    const actions = el('div', 'toolbar-group practice-actions');
    const remove = button('拆下选中零件', 'btn btn-warn', () => scene?.removeSelected(), '把选中的已安装零件拆到零件区');
    remove.setAttribute('aria-label', '拆下选中零件');
    actions.appendChild(remove);
    const install = button('安装到位置', 'btn btn-primary', () => scene?.installSelected(), '把选中的零件区零件安装到虚线位置');
    install.setAttribute('aria-label', '安装到位置');
    actions.appendChild(install);
    actions.appendChild(button('旋转 90°', 'btn btn-outline', () => scene?.rotateSelected(), '调整选中零件的安装方向'));
    if (device.id === 'pump') {
      extra.appendChild(button('轴与轴套装配', 'btn btn-outline pump-fit-open', () => {
        if (pumpFit) return;
        pumpFit = openPumpFit(root, () => {
          pumpFit = null;
          root.querySelector<HTMLButtonElement>('.pump-fit-open')?.focus();
        });
      }));
    }

    const tools = el('div', 'toolbar-group');
    const undoBtn = button('撤销', 'tool-btn', () => scene?.undo(), '撤销上一步操作');
    undoBtn.appendChild(icon(ICONS.undo, 14));
    tools.appendChild(undoBtn);
    const hintBtn = button('提示', 'tool-btn', () => scene?.hint(), '查看当前步骤提示（计入辅助）');
    hintBtn.appendChild(icon(ICONS.hint, 14));
    tools.appendChild(hintBtn);
    tools.appendChild(button('重新开始', 'tool-btn', () => {
      scene?.restart();
      completion.style.display = 'none';
      completionSaved = false;
    }, '设备恢复完整装配，统计清零'));
    tools.appendChild(button('一键复原', 'tool-btn', () => scene?.restoreAll(), '学习辅助：直接恢复完整设备（记为辅助完成）'));
    extra.appendChild(tools);

    const stats = el('div', 'practice-stats');
    const statTime = el('span', 'stat', '');
    const statErr = el('span', 'stat', '');
    const statHint = el('span', 'stat', '');
    bottomRefs.statTime = statTime;
    bottomRefs.statErr = statErr;
    bottomRefs.statHint = statHint;
    stats.appendChild(statTime); stats.appendChild(statErr); stats.appendChild(statHint);
    extra.appendChild(stats);

    const instruction = el('div', 'ctrl-hint practice-instruction');
    bottomRefs.instruction = instruction;
    extra.appendChild(instruction);
    bottom.append(actions, options);

    updatePracticeBar(s);
  }

  function updatePracticeBar(s: PracticeState) {
    const total = s.steps.length;
    const current = s.steps[s.stepIndex];
    statusFallback = s.completed ? '练习已完成' : s.mode === 'guided' && current
      ? `${s.stepIndex + 1}/${total} · ${current.title}`
      : `自由练习 · 已拆 ${s.totalRemovals} 次`;
    if (!status.dataset.kind && status.textContent !== statusFallback) status.textContent = statusFallback;
    if (bottomRefs.stepText) {
      bottomRefs.stepText.textContent = s.mode === 'guided'
        ? (s.completed ? `全部 ${total} 步已完成` : `步骤 ${Math.min(s.stepIndex + 1, total)} / ${total}`)
        : `自由练习 · 已拆下 ${s.totalRemovals} 次`;
    }
    if (bottomRefs.progressFill) {
      const removable = device.parts.filter((p) => p.removable).length;
      const pct = s.mode === 'guided'
        ? (s.stepIndex / total) * 100
        : Math.min(100, ((Math.min(s.totalRemovals, removable) + (s.installed.filter((id) => device.parts.find((p) => p.id === id)?.removable).length - (removable - Math.min(s.totalRemovals, removable)))) / (removable * 2)) * 100);
      (bottomRefs.progressFill as HTMLElement).style.width = `${Math.max(0, Math.min(100, s.completed ? 100 : pct))}%`;
    }
    if (bottomRefs.statTime) bottomRefs.statTime.textContent = `用时 ${fmtTime(s.elapsed)}`;
    if (bottomRefs.statErr) {
      bottomRefs.statErr.textContent = `错误 ${s.errors}`;
      bottomRefs.statErr.classList.toggle('stat-bad', s.errors > 0);
    }
    if (bottomRefs.statHint) bottomRefs.statHint.textContent = `提示 ${s.hints}`;
    if (bottomRefs.instruction) {
      const inst = bottomRefs.instruction;
      inst.innerHTML = '';
      if (s.completed) {
        inst.appendChild(el('span', '', s.assisted ? '本次为辅助完成，可重新练习挑战独立完成。' : '练习完成！可重新开始挑战更快速度。'));
      } else if (s.mode === 'guided') {
        const step = s.steps[s.stepIndex];
        if (step) {
          inst.appendChild(el('strong', '', step.title + '：'));
          inst.appendChild(el('span', '', step.instruction.replace(/^第 \d+ 步：/, '')));
        }
      } else {
        const removable = device.parts.filter((p) => p.removable).length;
        const installedCount = s.installed.filter((id) => device.parts.find((p) => p.id === id)?.removable).length;
        inst.appendChild(el('span', '', device.id === 'plate-exchanger' ? `自由练习：先拆下 ${removable} 个可拆零件，再按顺序装回（已安装 ${installedCount}/${removable}）。拖动板片、垫片、活动板或螺栓后松开，将沿预设路径自动安装；移出画布可取消。` : `自由练习：先把 ${removable} 个可拆零件全部拆下，再按正确顺序装回（已安装 ${installedCount}/${removable}）。拖拽零件到虚线位置，或选中后点「安装到位置」。`));
      }
    }
  }

  /* ---- 完成弹窗 ---- */
  function showCompletion(s: PracticeState) {
    completion.innerHTML = '';
    completion.style.display = '';
    const card = el('div', 'completion-card');
    card.appendChild(el('div', 'completion-icon', s.assisted ? '🛠️' : '🎉'));
    card.appendChild(el('h3', '', s.assisted ? '设备已复原（辅助完成）' : '拆装练习完成！'));
    card.appendChild(el('p', 'completion-sub', s.assisted
      ? '本次使用了提示或一键复原，记为「学习辅助复原」。再试一次，争取独立完成。'
      : '你独立完成了完整的拆卸与组装流程。'));
    const statGrid = el('div', 'completion-stats');
    for (const [label, value] of [['用时', fmtTime(s.elapsed)], ['错误次数', String(s.errors)], ['提示次数', String(s.hints)], ['完成方式', s.assisted ? '辅助完成' : '独立完成']]) {
      const cell = el('div', 'completion-stat');
      cell.appendChild(el('div', 'cs-value', value));
      cell.appendChild(el('div', 'cs-label', label));
      statGrid.appendChild(cell);
    }
    card.appendChild(statGrid);
    if (s.mode === 'guided' && s.errorSteps.length) {
      card.appendChild(el('h4', 'info-h4', '需要重新学习的步骤'));
      const ul = el('ul', 'info-points error-steps');
      const seen = new Set<number>();
      for (const i of s.errorSteps) {
        if (seen.has(i) || !s.steps[i]) continue;
        seen.add(i);
        ul.appendChild(el('li', '', s.steps[i].title));
      }
      card.appendChild(ul);
    }
    const btns = el('div', 'completion-btns');
    btns.appendChild(button('重新练习', 'btn btn-primary', () => {
      completion.style.display = 'none';
      completionSaved = false;
      scene?.restart();
    }));
    btns.appendChild(button('返回观察', 'btn btn-outline', () => {
      completion.style.display = 'none';
      scene?.select(null);
      switchMode('observe');
    }));
    card.appendChild(btns);
    completion.appendChild(card);
  }

  /* ---- 帮助 ---- */
  function showHelp() {
    const mask = el('div', 'modal-mask');
    const modal = el('div', 'modal');
    const head = el('div', 'modal-head');
    head.appendChild(el('h3', '', '操作帮助'));
    head.appendChild(button('', 'btn btn-ghost icon-btn', () => mask.remove(), '关闭'));
    modal.appendChild(head);
    const body = el('div', 'modal-body');
    const rows: [string, string][] = [
      ['旋转视角', '鼠标左键拖动 / 单指拖动'],
      ['缩放', '鼠标滚轮 / 双指捏合'],
      ['平移', '鼠标右键拖动 / 双指拖动'],
      ['选择零件', '点击模型零件或左侧目录'],
      ['剖视 / 透明 / 爆炸', '顶部模式页签切换，底部滑杆调节'],
      ['拆装练习', '选中零件后「拆下」；零件区零件可拖拽到虚线安装位置，或选中后点「安装到位置」'],
      ['安装方向', '部分零件有方向要求，用「旋转 90°」转回 0°'],
      ['部件角色', '「固定」=固定结构；「可拆」=可拆卸部件；「展开」=仅用于结构展开（焊接/整体件，不参与拆装）'],
      ['画质', '从「更多」进入「画质」。低画质关闭阴影并降低渲染分辨率'],
      ['学习记录', '自动保存在本机浏览器，刷新后可继续；可在「学习记录管理」中导出、导入或清除']
    ];
    for (const [k, v] of rows) {
      const row = el('div', 'help-row');
      row.appendChild(el('span', 'help-k', k));
      row.appendChild(el('span', 'help-v', v));
      body.appendChild(row);
    }
    body.appendChild(button('学习记录管理（导出 / 导入 / 清除）', 'btn btn-outline', () => {
      mask.remove();
      openRecordsDialog();
    }));
    modal.appendChild(body);
    mask.appendChild(modal);
    mask.addEventListener('click', (ev) => { if (ev.target === mask) mask.remove(); });
    page.appendChild(mask);
  }

  /* ============ 场景初始化 ============ */
  function initScene() {
    loading.style.display = '';
    fallback.style.display = 'none';
    window.clearTimeout(initTimer);
    initTimer = window.setTimeout(() => {
      try {
        scene = new SceneManager(canvasWrap, {
          onSelect: (id) => {
            if (id && exercisePhase === 'identify') judgeExerciseSelection(id);
            renderPanel(id);
            syncTree();
          },
          onHover: () => { /* 高亮由引擎处理 */ },
          onToast: toast,
          onEndoscope: () => syncEndoHud(),
          onPractice: (s) => {
            const wasCompleted = practice?.completed ?? false;
            const infoKey = `${scene?.selected}|${s.installed.join(',')}|${s.stepIndex}|${s.mode}|${s.totalRemovals}`;
            practice = s;
            if (deviceId === 'plate-exchanger' && s.completed) delete sessionSnapshots[s.mode];
            savePractice(deviceId, s);
            if (currentMode === 'practice') {
              if (!bottomRefs.stepText) renderPracticeBar();
              updatePracticeBar(s);
              syncTree();
              if (infoKey !== lastInfoKey) renderPanel(scene?.selected ?? null);
            }
            lastInfoKey = infoKey;
            if (s.completed && !wasCompleted && !completionSaved) {
              completionSaved = true;
              saveCompletion(deviceId, {
                elapsed: s.elapsed, errors: s.errors, hints: s.hints,
                assisted: s.assisted, date: Date.now(), mode: s.mode
              });
              for (const t of device.tasks) {
                if (t.auto === 'practice-completion') setTask(deviceId, t.id, true);
              }
              showCompletion(s);
            }
            if (!s.completed) completionSaved = false;
          }
        });
        scene.loadDevice(device);
        const storedQuality = localStorage.getItem('chem3d-lab:quality');
        const autoLow = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
        scene.setQuality(storedQuality === 'low' || (!storedQuality && autoLow) ? 'low' : 'high');
        syncQualityBtn();
        if (import.meta.env.DEV) {
          (window as unknown as Record<string, unknown>).__chem3d = { scene, device };
        }
        loading.style.display = 'none';
        tabButtons.forEach((b, id) => {
          const on = id === 'observe';
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', String(on));
        });
        syncLabelItem();
        renderPanel(null);
        renderBottom();
        syncTree();
        if (pendingMode && pendingMode !== 'observe') {
          const queued = pendingMode;
          pendingMode = null;
          switchMode(queued);
        } else {
          pendingMode = null;
        }
      } catch (err) {
        loading.style.display = 'none';
        showFallback(err);
      }
    }, 40);
  }

  function showFallback(err: unknown) {
    fallback.innerHTML = '';
    fallback.style.display = '';
    fallback.appendChild(el('div', 'fallback-icon', '⚠️'));
    fallback.appendChild(el('h3', '', '当前浏览器无法运行三维场景'));
    fallback.appendChild(el('p', 'info-desc', '可能原因：浏览器版本过旧、未开启硬件加速，或 WebGL 被禁用。建议使用最新版 Chrome / Edge，并在浏览器设置中开启硬件加速后重试。'));
    fallback.appendChild(el('p', 'info-note', `错误信息：${err instanceof Error ? err.message : String(err)}`));
    fallback.appendChild(el('h4', 'info-h4', `${device.name} · 文字说明`));
    fallback.appendChild(el('p', 'info-desc', device.use));
    fallback.appendChild(el('p', 'info-desc', device.principle));
    fallback.appendChild(el('p', 'info-desc', device.structureNote));
    const ul = el('ul', 'info-points');
    for (const p of device.parts) ul.appendChild(el('li', '', `${p.name}：${p.desc}`));
    fallback.appendChild(ul);
    const retryRow = el('div', 'info-actions');
    retryRow.appendChild(button('重试加载三维场景', 'btn btn-primary', () => initScene()));
    retryRow.appendChild(button(origin ? '返回来源场景' : '返回设备库', 'btn btn-outline', returnFromWorkbench));
    fallback.appendChild(retryRow);
  }

  initScene();

  /* 清理函数由路由器调用 */
  (root as HTMLElement & { __dispose?: () => void }).__dispose = () => {
    pumpFit?.dispose();
    stopExplodeAnim();
    if (principleTimer) { clearInterval(principleTimer); principleTimer = 0; }
    layoutQuery.removeEventListener('change', onLayoutWidth);
    compactModes.removeEventListener('change', onModeWidth);
    document.removeEventListener('click', onDocumentClick);
    window.clearTimeout(statusTimer);
    window.clearTimeout(initTimer);
    scene?.dispose();
    scene = null;
  };
}
