import './boil.css';
import './phase6.css';
import { BOIL_PROCESS } from '../data/boilProcess';
import { BOIL_OBSERVATIONS, BOIL_ORDER_CHECK } from '../data/boilObservation';
import type { DataStatus, EquipmentInstanceDef, PipelineDef } from '../data/processTypes';
import { buildAreaEquipmentTree, equipmentFlowLinks, type AreaPortRef, type ProcessAreaModel } from '../process/areas';
import { createTraceEngine, type TraceMode, type TraceResult, type TraceSide } from '../process/trace';
import {
  PLAYBACK_SPEEDS,
  ProcessPlayback,
  TEACHING_STEP_SECONDS,
  validatePlayback,
  type PlaybackState,
  type PlaybackStatus
} from '../process/playback';
import { BoilScene, type BoilRouteReport, type BoilOverlaySpec, type BoilSelectionState } from './scene';
import { createProcessMap, type ProcessMap } from './map';
import { el, button, icon, ICONS } from '../ui/dom';
import { openRecordsDialog } from '../ui/dialogs';
import { openInspection, supportsInspection } from './inspection';

function mediumShort(id: string): string {
  const medium = BOIL_PROCESS.media.find((item) => item.id === id);
  return (medium?.label ?? id).replace('（教学示意）', '').replace('（待确认）', '');
}

function areaDef(id: string) {
  return BOIL_PROCESS.areas.find((item) => item.id === id);
}

function equipmentDef(id: string): EquipmentInstanceDef | undefined {
  return BOIL_PROCESS.equipment.find((item) => item.id === id);
}

function pipelineDef(id: string): PipelineDef | undefined {
  return BOIL_PROCESS.pipelines.find((item) => item.id === id);
}

function statusText(status: DataStatus): string {
  return status === 'pending-confirmation' ? '待确认' : '教学示意';
}

function statusBadge(status: DataStatus): HTMLElement {
  return el('span', `boil-badge ${status === 'pending-confirmation' ? 'pending' : 'demo'}`, statusText(status));
}

function roleText(role: 'in' | 'out' | 'both'): string {
  return role === 'in' ? '入口' : role === 'out' ? '出口' : '双向';
}

function dimensionText(area: ProcessAreaModel): string {
  if (!area.bounds) return '未建立';
  return area.bounds.size.map((value) => value.toFixed(1)).join(' × ') + ' m';
}

const MODEL_LABELS: Record<string, string> = {
  smp: 'SMP 装置',
  crusher: '破碎机',
  mixer: '混合器',
  'furnace-pump': '炉塞泵',
  'secondary-chamber': '二燃室',
  'spray-gun': '喷枪',
  'rotary-kiln': '回转窑',
  'quench-tower': '集冷塔',
  baghouse: '布袋除尘器',
  'comprehensive-tower': '综合塔',
  'wash-tower': '水洗塔',
  'wet-esp': '湿电除尘',
  'id-fan': '引风机',
  stack: '烟囱'
};

function playbackStatusText(status: PlaybackStatus): string {
  if (status === 'playing') return '播放中';
  if (status === 'paused') return '已暂停';
  if (status === 'completed') return '已完成';
  return '未开始';
}

function traceModeText(mode: TraceMode): string {
  if (mode === 'upstream') return '上游路径';
  if (mode === 'downstream') return '下游路径';
  return '完整路径';
}

function equipmentNames(ids: string[]): string {
  return ids.map((id) => equipmentDef(id)?.name ?? id).join('、');
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function renderBoil(root: HTMLElement) {
  root.innerHTML = '';
  let map: ProcessMap | null = null;
  const page = el('div', 'boil-page');
  let drawer: 'tree' | 'details' | null = null;
  const stage = el('div', 'boil-stage');
  page.appendChild(stage);

  /* ---------- 顶栏 ---------- */
  const topbar = el('header', 'boil-topbar');
  const back = button('', 'boil-btn boil-btn-ghost', () => { location.hash = '#/library'; }, '返回设备库');
  back.appendChild(icon(ICONS.back, 16));
  back.appendChild(el('span', '', '设备库'));
  topbar.appendChild(back);

  const title = el('div', 'boil-title');
  title.appendChild(el('h1', '', '微沸喷烧全流程'));
  title.appendChild(el('span', 'boil-teach', '教学示意'));
  title.appendChild(el('span', 'boil-sub', '工艺追踪与流程播放'));
  topbar.appendChild(title);

  const controls = el('div', 'boil-controls');
  const more = document.createElement('details');
  more.className = 'boil-more';
  more.appendChild(el('summary', 'boil-btn boil-btn-ghost', '更多'));
  const moreBody = el('div', 'boil-more-body');
  more.appendChild(moreBody);
  const overviewBtn = button('整厂总览', 'boil-btn boil-btn-ghost boil-overview', () => selectOverview(), '回到整厂总览并退出追踪/播放');
  controls.appendChild(overviewBtn);
  const traceExitBtn = button('退出追踪', 'boil-btn boil-btn-ghost boil-trace-exit', () => exitTrace(), '退出设备追踪并恢复正常场景');
  traceExitBtn.hidden = true;
  controls.appendChild(traceExitBtn);
  const resetBtn = button('自动复位', 'boil-btn boil-btn-ghost boil-reset', () => selectOverview(), '取消聚焦并自动复位镜头');
  moreBody.appendChild(resetBtn);
  const mapBtn = button('流程图', 'boil-btn boil-btn-ghost boil-map-toggle', () => toggleMap(), '展开或收起二维工艺流程图');
  moreBody.appendChild(mapBtn);
  const playBtn = button('流体：暂停', 'boil-btn boil-btn-ghost boil-fluid-play', () => toggleGlobalPause(), '暂停或继续流体；播放中同步暂停流程');
  moreBody.appendChild(playBtn);
  const speedBtn = button('1×', 'boil-btn boil-btn-ghost boil-fluid-speed', () => cycleSpeed(), '切换教学演示速度（0.5/1/2/4 倍）');
  moreBody.appendChild(speedBtn);
  const arrowsBtn = button('箭头：开', 'boil-btn boil-btn-ghost boil-fluid-arrows', () => toggleArrows(), '显示或隐藏流向箭头');
  moreBody.appendChild(arrowsBtn);
  const labelsBtn = button('标签：开', 'boil-btn boil-btn-ghost boil-labels', () => setLabels(!labelsOn), '显示或隐藏设备/管线/区域标签');
  moreBody.appendChild(labelsBtn);
  moreBody.appendChild(button('学习记录', 'boil-btn boil-btn-ghost', () => openRecordsDialog(), '查看、导出、导入或清除本机学习记录'));
  const panelBtn = button('流程树', 'boil-btn boil-btn-ghost boil-panel-toggle', () => {
    setDrawer(drawer === 'tree' ? null : 'tree');
  }, '打开或收起工艺流程树');
  const detailBtn = button('设备信息', 'boil-btn boil-btn-ghost boil-detail-toggle', () => {
    setDrawer(drawer === 'details' ? null : 'details');
  }, '打开或收起区域/设备信息面板');
  controls.append(panelBtn, detailBtn, more);
  topbar.appendChild(controls);
  page.appendChild(topbar);

  /* ---------- 区域标签条 ---------- */
  const areaTabs = el('nav', 'boil-area-tabs');
  areaTabs.setAttribute('aria-label', '工艺区域切换');
  const tabAll = button('全部区域', 'boil-area-tab active', () => selectOverview(), '查看整个微沸喷烧流程');
  tabAll.dataset.areaTab = 'all';
  areaTabs.appendChild(tabAll);
  const tabButtons = new Map<string, HTMLButtonElement>();
  page.appendChild(areaTabs);

  /* ---------- 左侧流程树 ---------- */
  const panel = el('aside', 'boil-panel');
  const panelHead = el('div', 'boil-panel-head');
  const panelHeading = el('div', 'boil-panel-heading');
  panelHeading.appendChild(el('h2', '', '工艺流程树'));
  panelHeading.appendChild(el('span', '', '5 区域 · 18 设备 · 13 管线'));
  panelHead.appendChild(panelHeading);
  const closeBtn = button('×', 'boil-panel-close', () => { setDrawer(null); panelBtn.focus(); }, '收起流程树');
  panelHead.appendChild(closeBtn);
  panel.appendChild(panelHead);
  panel.appendChild(el('p', 'boil-note',
    '设备、管线与上下游关系来自同一数据源；四根喷枪挂在二燃室下，是四个独立平行支路，不是四个串联工艺节点。区域顺序按现场流程清单固定。'));

  const mapCard = el('section', 'boil-map-card');
  const mapHead = el('div', 'boil-map-head');
  const mapHeading = el('div', 'boil-map-heading');
  mapHeading.appendChild(el('span', 'boil-map-title', 'PROCESS MAP'));
  mapHeading.appendChild(el('span', 'boil-map-sub', '二维流程 · 虚线表示待核关系'));
  mapHead.appendChild(mapHeading);
  const mapActions = el('div', 'boil-map-actions');
  const mapZoomOut = button('−', 'boil-map-btn boil-map-zoom-out', () => map?.zoom(1 / 1.3), '缩小流程图');
  const mapZoomIn = button('+', 'boil-map-btn boil-map-zoom-in', () => map?.zoom(1.3), '放大流程图');
  const mapZoomReset = button('⟲', 'boil-map-btn boil-map-zoom-reset', () => map?.resetView(), '复位流程图缩放');
  const mapExpand = button('⤢', 'boil-map-btn boil-map-expand', () => {
    const expanded = page.classList.toggle('map-expanded');
    mapExpand.classList.toggle('active', expanded);
    /* 面板的 backdrop-filter 会成为 fixed 定位的包含块；放大时移到页面层，避免被面板裁剪。 */
    if (expanded) page.appendChild(mapCard);
    else panel.insertBefore(mapCard, tree);
  }, '放大或还原流程图');
  mapActions.append(mapZoomOut, mapZoomIn, mapZoomReset, mapExpand);
  mapHead.appendChild(mapActions);
  const mapHost = el('div', 'boil-map-host');
  mapCard.append(mapHead, mapHost);
  panel.appendChild(mapCard);

  const tree = el('div', 'boil-tree');
  panel.appendChild(tree);
  const areaRows = new Map<string, HTMLElement>();
  const equipmentRows = new Map<string, HTMLButtonElement>();
  const collapsedAreas = new Set<string>();
  let rootCollapsed = false;

  /* ---------- 左侧管线列表（保留原有单管线聚焦） ---------- */
  const pipeSection = el('details', 'boil-pipe-section');
  const pipeSummary = el('summary', 'boil-pipe-summary');
  pipeSummary.appendChild(el('span', '', '管线一览'));
  pipeSummary.appendChild(el('span', 'boil-pipe-summary-count', `${BOIL_PROCESS.pipelines.length} 条`));
  pipeSection.appendChild(pipeSummary);
  const pipeList = el('div', 'boil-pipe-list');
  pipeSection.appendChild(pipeList);
  panel.appendChild(pipeSection);

  const pendingBox = el('div', 'boil-pending');
  pendingBox.appendChild(el('h3', '', '待确认与边界'));
  pendingBox.appendChild(el('p', '', '现场启停顺序、吹扫、联锁及急停条件待确认。当前仅开放流程观察与结构演示。'));
  pendingBox.appendChild(el('p', '', '四根喷枪的 8 个接口未接入管线（接入关系待确认）；SMP 来料口与烟囱排放口为流程边界。'));
  const pendingStat = el('p', 'boil-pending-stat', '正在读取校验结果…');
  pendingBox.appendChild(pendingStat);
  panel.appendChild(pendingBox);

  const historyBox = el('section', 'boil-history');
  historyBox.appendChild(el('h3', '', '追踪历史'));
  const historyCurrent = el('p', 'boil-history-current', '当前选中设备：—');
  const historyStep = el('p', 'boil-history-current', '当前播放步骤：—');
  historyBox.append(historyCurrent, historyStep);
  historyBox.appendChild(el('p', 'boil-history-sub', '最近查看设备'));
  const historyDevices = el('div', 'boil-chip-row');
  historyBox.appendChild(historyDevices);
  historyBox.appendChild(el('p', 'boil-history-sub', '最近追踪路径'));
  const historyPaths = el('div', 'boil-link-list');
  historyBox.appendChild(historyPaths);
  panel.appendChild(historyBox);

  panel.appendChild(el('p', 'boil-footnote', '三通与变径仅内部部件库演示；本流程拓扑无分支/变径需求，工艺线未放置。'));
  page.appendChild(panel);

  /* ---------- 右侧信息面板 ---------- */
  const detail = el('aside', 'boil-detail');
  const detailHead = el('div', 'boil-detail-head');
  const detailHeading = el('div', 'boil-detail-heading');
  detailHeading.appendChild(el('h2', '', '整厂总览'));
  detailHeading.appendChild(el('span', '', '区域 · 设备 · 管线'));
  detailHead.appendChild(detailHeading);
  const detailClose = button('×', 'boil-detail-close', () => { setDrawer(null); detailBtn.focus(); }, '收起设备信息');
  detailHead.appendChild(detailClose);
  detail.appendChild(detailHead);
  const detailBody = el('div', 'boil-detail-body');
  detail.appendChild(detailBody);
  page.appendChild(detail);

  /* ---------- 图例与统计 ---------- */
  const legend = el('div', 'boil-legend');
  legend.appendChild(el('div', 'boil-legend-title', '介质图例'));
  for (const medium of BOIL_PROCESS.media) {
    const item = el('span', 'boil-legend-item');
    const dot = el('i', 'boil-dot');
    dot.style.background = `#${medium.color.toString(16).padStart(6, '0')}`;
    item.appendChild(dot);
    item.appendChild(document.createTextNode(mediumShort(medium.id)));
    legend.appendChild(item);
  }
  const boundaryItem = el('span', 'boil-legend-item');
  boundaryItem.appendChild(el('i', 'boil-dot boil-dot-boundary'));
  boundaryItem.appendChild(document.createTextNode('流程边界'));
  legend.appendChild(boundaryItem);
  const pendingItem = el('span', 'boil-legend-item');
  pendingItem.appendChild(el('i', 'boil-dot boil-dot-pending'));
  pendingItem.appendChild(document.createTextNode('待确认接口'));
  legend.appendChild(pendingItem);
  const stats = el('div', 'boil-stats');
  stats.textContent = '正在读取校验结果…';
  legend.appendChild(stats);
  moreBody.appendChild(legend);

  /* ---------- 底部流程控制面板 ---------- */
  const playbackBar = el('section', 'boil-playback');
  playbackBar.setAttribute('aria-label', 'PROCESS CONTROL 流程播放控制');
  const pbTop = el('div', 'boil-pb-top');
  const pbFields = el('div', 'boil-pb-fields');
  const pbProcess = pbField('工艺');
  const pbArea = pbField('区域');
  const pbDevice = pbField('设备');
  const pbStep = pbField('步骤');
  const pbStatus = pbField('状态');
  const pbSpeed = pbField('速度');
  pbProcess.value.textContent = BOIL_PROCESS.name.replace('（教学示意）', '');
  pbFields.append(pbProcess.wrap, pbArea.wrap, pbDevice.wrap, pbStep.wrap, pbStatus.wrap, pbSpeed.wrap);
  moreBody.appendChild(pbFields);

  const pbActions = el('div', 'boil-pb-actions');
  const pbPrev = button('上一步', 'boil-btn boil-pb-btn boil-pb-prev', () => stepPlayback(-1), '跳到上一步');
  const pbPlay = button('播放', 'boil-btn boil-pb-btn boil-pb-play', () => playOrResume(), '开始或继续教学流程播放');
  const pbPause = button('暂停', 'boil-btn boil-pb-btn boil-pb-pause', () => pausePlayback(), '暂停流程与流体');
  const pbStop = button('停止', 'boil-btn boil-pb-btn boil-pb-stop', () => stopPlayback(), '停止播放并回到初始状态');
  const pbReset = button('重置', 'boil-btn boil-pb-btn boil-pb-reset', () => resetAll(), '重置播放、追踪与场景原始视图');
  const pbNext = button('下一步', 'boil-btn boil-pb-btn boil-pb-next', () => stepPlayback(1), '跳到下一步');
  pbActions.append(pbPrev, pbPlay, pbPause, pbStop, pbReset, pbNext);
  const pbSpeeds = el('div', 'boil-pb-speeds');
  const pbSpeedButtons = new Map<number, HTMLButtonElement>();
  for (const value of PLAYBACK_SPEEDS) {
    const chip = button(`${value}×`, 'boil-btn boil-pb-speed', () => setSpeed(value), `切换为 ${value} 倍教学演示速度`);
    chip.dataset.speed = String(value);
    pbSpeedButtons.set(value, chip);
    pbSpeeds.appendChild(chip);
  }
  moreBody.appendChild(pbSpeeds);
  pbTop.appendChild(pbActions);
  playbackBar.appendChild(pbTop);

  const pbProgressWrap = el('div', 'boil-pb-progress-wrap');
  const pbProgress = el('div', 'boil-pb-progress');
  pbProgress.tabIndex = 0;
  pbProgress.setAttribute('role', 'slider');
  pbProgress.setAttribute('aria-label', '流程播放进度');
  pbProgress.setAttribute('aria-valuemin', '1');
  pbProgress.setAttribute('aria-valuemax', String(BOIL_PROCESS.steps.length));
  const pbFill = el('div', 'boil-pb-fill');
  const pbKnob = el('div', 'boil-pb-knob');
  const pbTicks = el('div', 'boil-pb-ticks');
  const pbTickEls: HTMLElement[] = [];
  for (const step of BOIL_PROCESS.steps) {
    const tick = el('span', 'boil-pb-tick');
    tick.dataset.step = String(step.no);
    tick.title = `第 ${step.no} 步 · ${step.title}`;
    pbTicks.appendChild(tick);
    pbTickEls.push(tick);
  }
  pbProgress.append(pbFill, pbTicks, pbKnob);
  pbProgressWrap.appendChild(pbProgress);
  const pbStepTitle = el('span', 'boil-pb-step-title', '尚未开始');
  pbProgressWrap.appendChild(pbStepTitle);
  playbackBar.appendChild(pbProgressWrap);
  moreBody.appendChild(el('p', 'boil-pb-note',
    'Simulation / 教学模拟：播放节奏、流体示踪与镜头均为教学演示，不含温度、压力、流量等工艺参数；未提供的设备资料标「待现场资料确认」。'));
  page.appendChild(playbackBar);

  pbProgress.addEventListener('pointerdown', (event) => {
    const rect = pbProgress.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
    jumpPlayback(Math.round(ratio * (BOIL_PROCESS.steps.length - 1)));
  });
  pbProgress.addEventListener('keydown', (event) => {
    const current = playback.state.stepIndex;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      jumpPlayback(current - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      jumpPlayback(current + 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      jumpPlayback(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      jumpPlayback(BOIL_PROCESS.steps.length - 1);
    }
  });

  const hint = el('div', 'boil-hint', '拖动旋转 · 滚轮缩放 · 点击设备追踪上下游 · 底部播放完整流程');
  moreBody.appendChild(hint);

  root.appendChild(page);
  const scene = new BoilScene(stage, (state) => syncState(state));

  /* ---------- 顶栏/区域标签/面板随换行自适应 ---------- */
  const syncChromeLayout = (): void => {
    const topbarBottom = Math.ceil(topbar.getBoundingClientRect().bottom);
    areaTabs.style.top = `${topbarBottom + 2}px`;
    const panelTop = Math.ceil(areaTabs.getBoundingClientRect().bottom + 8);
    panel.style.top = panelTop + 'px';
    detail.style.top = panelTop + 'px';
    const below = window.matchMedia('(max-width: 1179px)').matches
      ? Math.ceil(window.innerHeight - playbackBar.getBoundingClientRect().top + 8) + 'px' : '';
    panel.style.bottom = below;
    detail.style.bottom = below;
  };
  const chromeObserver = new ResizeObserver(syncChromeLayout);
  chromeObserver.observe(topbar);
  chromeObserver.observe(areaTabs);
  chromeObserver.observe(playbackBar);
  window.addEventListener('resize', syncChromeLayout);
  requestAnimationFrame(syncChromeLayout);
  map = createProcessMap(mapHost, (equipmentId) => handleMapPick(equipmentId));

  /* ---------- 数据驱动的区域标签与流程树 ---------- */
  for (const area of scene.areas) {
    const tab = button(
      `${area.def.no.toString().padStart(2, '0')} ${area.def.name}`,
      'boil-area-tab',
      () => selectArea(area.def.id),
      `聚焦${area.def.name}`
    );
    tab.dataset.areaTab = area.def.id;
    tabButtons.set(area.def.id, tab);
    areaTabs.appendChild(tab);
  }

  const rootRow = el('div', 'boil-tree-root');
  const rootCaret = button('▾', 'boil-tree-caret', () => {
    rootCollapsed = !rootCollapsed;
    rootCaret.textContent = rootCollapsed ? '▸' : '▾';
    branches.classList.toggle('collapsed', rootCollapsed);
  }, '折叠或展开全部工艺区域');
  const rootLabel = button('', 'boil-tree-root-label', () => selectOverview(), '返回整厂总览');
  rootLabel.appendChild(icon(ICONS.layers, 15));
  rootLabel.appendChild(el('span', '', '微沸喷烧装置'));
  rootLabel.appendChild(el('small', '', `${scene.areas.length} 区域`));
  rootRow.appendChild(rootCaret);
  rootRow.appendChild(rootLabel);
  tree.appendChild(rootRow);
  const branches = el('div', 'boil-tree-branches');
  tree.appendChild(branches);

  function addAreaRow(area: ProcessAreaModel): void {
    const section = el('div', 'boil-tree-area');
    section.dataset.areaRow = area.def.id;
    const row = el('div', 'boil-tree-row boil-tree-area-row');
    const caret = button('▾', 'boil-tree-caret', () => {
      const collapsed = collapsedAreas.has(area.def.id);
      if (collapsed) collapsedAreas.delete(area.def.id);
      else collapsedAreas.add(area.def.id);
      caret.textContent = collapsed ? '▾' : '▸';
      children.classList.toggle('collapsed', !collapsed);
    }, `折叠或展开${area.def.name}`);
    const label = button('', 'boil-tree-area-label', () => selectArea(area.def.id), `聚焦${area.def.name}`);
    label.appendChild(el('span', 'boil-tree-no', area.def.no.toString().padStart(2, '0')));
    label.appendChild(el('span', '', area.def.name));
    label.appendChild(el('small', '', `${area.equipment.length} 设备 · ${area.pipelines.length} 管线`));
    row.appendChild(caret);
    row.appendChild(label);
    section.appendChild(row);

    const children = el('div', 'boil-tree-children');
    for (const entry of buildAreaEquipmentTree(area)) {
      const eqRow = el('div', 'boil-tree-row boil-tree-equipment-row');
      const eqButton = button('', 'boil-tree-equipment', () => selectEquipment(entry.equipment.id), `聚焦${entry.equipment.name}`);
      eqButton.dataset.equipmentRow = entry.equipment.id;
      eqButton.appendChild(icon(ICONS.cube, 13));
      eqButton.appendChild(el('span', '', entry.equipment.name));
      if (entry.equipment.dataStatus === 'pending-confirmation') {
        eqButton.appendChild(el('i', 'boil-tree-dot', '待确认'));
      }
      eqRow.appendChild(eqButton);
      children.appendChild(eqRow);
      equipmentRows.set(entry.equipment.id, eqButton);
      if (entry.children.length > 0) {
        const branch = el('div', 'boil-tree-branch');
        branch.appendChild(el('p', 'boil-tree-branch-note', `平行支路 ×${entry.children.length} · 接入位置与喷入介质待确认`));
        for (const child of entry.children) {
          const childButton = button('', 'boil-tree-equipment boil-tree-child', () => selectEquipment(child.id), `聚焦${child.name}`);
          childButton.dataset.equipmentRow = child.id;
          childButton.appendChild(icon(ICONS.cube, 12));
          childButton.appendChild(el('span', '', child.name));
          childButton.appendChild(el('i', 'boil-tree-dot', '待确认'));
          branch.appendChild(childButton);
          equipmentRows.set(child.id, childButton);
        }
        children.appendChild(branch);
      }
    }
    section.appendChild(children);
    branches.appendChild(section);
    areaRows.set(area.def.id, section);
  }

  for (const area of scene.areas) addAreaRow(area);

  /* ---------- 管线列表 ---------- */
  const reports = new Map<string, BoilRouteReport>();
  const pipeButtons = new Map<string, HTMLButtonElement>();
  for (const report of scene.routeReports) reports.set(report.pipelineId, report);
  for (const report of scene.routeReports) {
    const item = button('', 'boil-pipe-item', () => selectPipeline(report.pipelineId), `${report.pipelineId} ${report.name}`);
    item.dataset.pipelineItem = report.pipelineId;
    const head = el('div', 'boil-pipe-head');
    head.appendChild(el('code', 'boil-pipe-id', report.pipelineId));
    head.appendChild(el('span', 'boil-pipe-medium', mediumShort(report.medium)));
    item.appendChild(head);
    const meta = el('div', 'boil-pipe-meta');
    meta.textContent = `${report.length.toFixed(1)} m · ${report.elbows} 弯头 · ${report.valveKind} · ${report.supports} 支架`;
    item.appendChild(meta);
    pipeList.appendChild(item);
    pipeButtons.set(report.pipelineId, item);
  }

  stats.textContent =
    `${scene.counts.terminalFlanges} 端部法兰 · ${scene.counts.elbows} 弯头 · ${scene.counts.valves} 示意阀 · ` +
    `${scene.counts.supports} 支架 · 区域 ${scene.areas.length} · 设备 ${scene.areaValidation.counts.equipment}`;
  pendingStat.textContent =
    `喷枪待确认接口 ${scene.pendingPorts} · 流程边界 ${scene.boundaryPorts} · 穿模 ${scene.counts.collisions} · ` +
    `设备重叠 ${scene.counts.equipmentOverlaps} · 支架冲突 ${scene.counts.supportConflicts}`;
  if (!scene.areaValidation.ok || scene.validation.errors.length > 0) {
    const errorBox = el('div', 'boil-error');
    errorBox.appendChild(el('strong', '', '区域/管道数据校验存在问题：'));
    errorBox.appendChild(
      el('span', '', [...scene.areaValidation.errors, ...scene.validation.errors].slice(0, 3).map((item) => item.code).join(', '))
    );
    panel.insertBefore(errorBox, panelHead);
  }

  /* ---------- 交互状态 ---------- */
  let labelsOn = true;
  let fluidPaused = false;
  let arrowsOn = true;
  let speed = 1;
  type UiMode = 'normal' | 'trace' | 'playback';
  let uiMode: UiMode = 'normal';
  let traceMode: TraceMode = 'full';
  let traceResult: TraceResult | null = null;
  const traceEngine = createTraceEngine(BOIL_PROCESS);
  const playback = new ProcessPlayback(BOIL_PROCESS, { stepDurationSeconds: TEACHING_STEP_SECONDS });
  const playbackAudit = validatePlayback(BOIL_PROCESS);
  let currentSelected = '—';
  let currentStepText = '—';
  let lastAppliedStep = -1;
  const recentDevices: string[] = [];
  const recentTraces: { rootId: string; mode: TraceMode }[] = [];
  const branchGunIds = traceEngine
    .full('eq-secondary-chamber')
    .full.branches.flatMap((group) => group.equipmentIds);

  function pbField(label: string): { wrap: HTMLElement; value: HTMLElement } {
    const wrap = el('div', 'boil-pb-field');
    wrap.appendChild(el('span', 'boil-pb-label', label));
    const value = el('span', 'boil-pb-value', '—');
    wrap.appendChild(value);
    return { wrap, value };
  }

  function nearestSpeed(value: number): number {
    return PLAYBACK_SPEEDS.reduce((best, candidate) =>
      Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best
    );
  }

  function setSpeed(value: number): void {
    speed = nearestSpeed(value);
    scene.setFluidSpeed(speed);
    playback.setSpeed(speed);
    speedBtn.textContent = `${speed}×`;
    pbSpeed.value.textContent = `${speed}×`;
    for (const [candidate, chip] of pbSpeedButtons) chip.classList.toggle('active', candidate === speed);
    updatePlaybackBar();
  }

  function syncPauseButtons(): void {
    const effectivelyPaused = uiMode === 'playback' ? playback.status !== 'playing' : fluidPaused;
    playBtn.textContent = effectivelyPaused ? '流体：继续' : '流体：暂停';
    playBtn.classList.toggle('active', !effectivelyPaused);
  }

  function toggleGlobalPause(): void {
    if (uiMode === 'playback' && (playback.status === 'playing' || playback.status === 'paused')) {
      if (playback.status === 'playing') pausePlayback();
      else playOrResume();
      return;
    }
    fluidPaused = !fluidPaused;
    scene.setPlaybackPaused(fluidPaused);
    syncPauseButtons();
  }

  function cycleSpeed(): void {
    const index = PLAYBACK_SPEEDS.indexOf(speed as (typeof PLAYBACK_SPEEDS)[number]);
    const next = PLAYBACK_SPEEDS[(index + 1) % PLAYBACK_SPEEDS.length];
    setSpeed(next);
  }

  function toggleArrows(): void {
    arrowsOn = !arrowsOn;
    scene.setFluidArrows(arrowsOn);
    arrowsBtn.textContent = `箭头：${arrowsOn ? '开' : '关'}`;
    arrowsBtn.classList.toggle('active', arrowsOn);
  }

  function setLabels(on: boolean): void {
    labelsOn = on;
    labelsBtn.textContent = `标签：${on ? '开' : '关'}`;
    scene.setLabelVisibility(on);
  }

  function expandTreeForEquipment(equipmentId: string): void {
    const equipment = equipmentDef(equipmentId);
    if (!equipment) return;
    collapsedAreas.delete(equipment.areaId);
    const section = areaRows.get(equipment.areaId);
    section?.querySelector('.boil-tree-children')?.classList.remove('collapsed');
    const caret = section?.querySelector('.boil-tree-caret') as HTMLButtonElement | null;
    if (caret) caret.textContent = '▾';
  }

  function selectOverview(): void {
    leaveOverlays();
    scene.overview();
  }

  function selectArea(areaId: string): void {
    leaveOverlays();
    scene.focusArea(areaId);
    collapsedAreas.delete(areaId);
    const section = areaRows.get(areaId);
    const children = section?.querySelector('.boil-tree-children');
    const caret = section?.querySelector('.boil-tree-caret') as HTMLButtonElement | null;
    children?.classList.remove('collapsed');
    if (caret) caret.textContent = '▾';
  }

  function selectEquipment(equipmentId: string): void {
    if (!equipmentDef(equipmentId)) return;
    expandTreeForEquipment(equipmentId);
    enterTrace(equipmentId);
  }

  function selectPipeline(pipelineId: string): void {
    leaveOverlays();
    scene.focusPipeline(pipelineId);
  }

  function leaveOverlays(): void {
    if (uiMode === 'playback') stopPlayback({ overview: false, silent: true });
    else if (uiMode === 'trace') exitTrace({ overview: false, silent: true });
  }

  function setDrawer(next: typeof drawer): void {
    drawer = next;
    const treeOpen = next === 'tree';
    const detailsOpen = next === 'details';
    page.classList.toggle('panel-open', treeOpen);
    page.classList.toggle('detail-open', detailsOpen);
    panel.hidden = !treeOpen;
    detail.hidden = !detailsOpen;
    panel.inert = !treeOpen;
    detail.inert = !detailsOpen;
    panelBtn.setAttribute('aria-expanded', String(treeOpen));
    detailBtn.setAttribute('aria-expanded', String(detailsOpen));
    if (next !== 'tree' && page.classList.contains('map-expanded')) mapExpand.click();
  }

  function toggleMap(): void {
    const open = drawer !== 'tree' || page.classList.contains('map-collapsed');
    page.classList.toggle('map-collapsed', !open);
    mapBtn.classList.toggle('active', open);
    if (open) { more.open = false; setDrawer('tree'); map?.resetView(); }
    else setDrawer(null);
  }

  /* ---------- 追踪状态 ---------- */
  function enterTrace(equipmentId: string, mode: TraceMode = traceMode): void {
    if (!equipmentDef(equipmentId)) return;
    if (uiMode === 'playback') stopPlayback({ overview: false, silent: true });
    expandTreeForEquipment(equipmentId);
    uiMode = 'trace';
    traceMode = mode;
    traceResult = traceEngine.full(equipmentId);
    currentSelected = traceResult.rootName;
    applyTraceOverlay(true);
    updateTraceButtons();
    renderTraceDetail();
    setDrawer('details');
    pushRecentDevice(equipmentId);
    pushRecentTrace(equipmentId, mode);
    updateHistoryPanel();
  }

  function exitTrace(options: { overview?: boolean; silent?: boolean } = {}): void {
    if (uiMode !== 'trace') return;
    uiMode = 'normal';
    traceResult = null;
    scene.setOverlayPicker(null);
    scene.clearOverlay({ animate: false });
    map?.setState(null);
    currentSelected = '—';
    updateTraceButtons();
    updateHistoryPanel();
    if (options.overview !== false) scene.overview();
    if (!options.silent) renderDetail(scene.state);
  }

  function setTraceMode(mode: TraceMode): void {
    if (uiMode !== 'trace' || !traceResult) return;
    traceMode = mode;
    applyTraceOverlay(false);
    renderTraceDetail();
    updateHistoryPanel();
  }

  function traceBranchIds(
    result: TraceResult,
    mode: TraceMode,
    current: Set<string>,
    upstream: Set<string>,
    downstream: Set<string>
  ): string[] {
    if (mode !== 'full' && !result.structuralParentId) return [];
    const ids: string[] = [];
    for (const group of result.full.branches) {
      for (const id of [group.parentEquipmentId, ...group.equipmentIds]) {
        if (current.has(id) || upstream.has(id) || downstream.has(id)) continue;
        if (!ids.includes(id)) ids.push(id);
      }
    }
    return ids;
  }

  function applyTraceOverlay(animate: boolean): void {
    if (!traceResult) return;
    const result = traceResult;
    const current = new Set([result.rootId]);
    const upstream = new Set(
      traceMode === 'downstream'
        ? []
        : result.upstream.equipmentIds.filter((id) => id !== result.rootId)
    );
    const downstream = new Set(
      traceMode === 'upstream'
        ? []
        : result.downstream.equipmentIds.filter((id) => id !== result.rootId)
    );
    const branchIds = traceBranchIds(result, traceMode, current, upstream, downstream);
    const upstreamPipes = traceMode === 'downstream' ? [] : [...result.upstream.pipelineIds];
    const downstreamPipes = traceMode === 'upstream' ? [] : [...result.downstream.pipelineIds];
    const activePipes = uniqueStrings([...upstreamPipes, ...downstreamPipes]);
    const spec: BoilOverlaySpec = {
      kind: 'trace',
      currentEquipmentIds: [result.rootId],
      upstreamEquipmentIds: [...upstream],
      downstreamEquipmentIds: [...downstream],
      branchEquipmentIds: branchIds,
      currentPipelineIds: [],
      upstreamPipelineIds: upstreamPipes,
      downstreamPipelineIds: downstreamPipes,
      activePipelineIds: activePipes,
      focusEquipmentIds: [result.rootId],
      flowScope: null,
      areaId: result.rootAreaId
    };
    scene.setOverlay(spec, { animate, picker: handleOverlayPick });
    map?.setState({
      currentEquipmentIds: [result.rootId],
      upstreamEquipmentIds: [...upstream],
      downstreamEquipmentIds: [...downstream],
      branchEquipmentIds: branchIds,
      currentPipelineIds: [],
      upstreamPipelineIds: upstreamPipes,
      downstreamPipelineIds: downstreamPipes
    });
    setActiveTree([result.rootId], result.rootAreaId, activePipes);
    currentSelected = result.rootName;
    updateHistoryPanel();
  }

  function updateTraceButtons(): void {
    traceExitBtn.hidden = uiMode !== 'trace';
  }

  /* ---------- 播放状态 ---------- */
  function ensurePlaybackMode(): void {
    if (uiMode === 'playback') return;
    if (uiMode === 'trace') {
      traceResult = null;
      traceExitBtn.hidden = true;
    }
    uiMode = 'playback';
    scene.setOverlayPicker(handleOverlayPick);
    updateTraceButtons();
  }

  function playOrResume(): void {
    ensurePlaybackMode();
    if (playback.status === 'paused') {
      playback.resume();
      scene.setPlaybackPaused(false);
    } else if (playback.status === 'idle' || playback.status === 'completed') {
      playback.start();
      scene.setPlaybackPaused(false);
      applyPlaybackStep(true);
    }
    updatePlaybackBar();
  }

  function pausePlayback(): void {
    if (uiMode !== 'playback' || playback.status !== 'playing') return;
    playback.pause();
    scene.setPlaybackPaused(true);
    updatePlaybackBar();
    syncPauseButtons();
  }

  function stopPlayback(options: { overview?: boolean; silent?: boolean } = {}): void {
    playback.stop();
    scene.setPlaybackPaused(false);
    scene.setOverlayPicker(null);
    scene.clearOverlay({ animate: false });
    uiMode = 'normal';
    lastAppliedStep = -1;
    traceResult = null;
    map?.setState(null);
    playbackBar.classList.remove('completed');
    if (options.overview !== false) scene.overview();
    if (!options.silent) renderDetail(scene.state);
    updateTraceButtons();
    updatePlaybackBar();
    updateHistoryPanel();
  }

  function stepPlayback(delta: number): void {
    ensurePlaybackMode();
    if (delta >= 0) playback.next();
    else playback.previous();
    scene.setPlaybackPaused(playback.status !== 'playing');
    applyPlaybackStep(true);
    updatePlaybackBar();
  }

  function jumpPlayback(index: number): void {
    ensurePlaybackMode();
    playback.jumpTo(index);
    scene.setPlaybackPaused(playback.status !== 'playing');
    applyPlaybackStep(true);
    updatePlaybackBar();
  }

  function jumpToEquipment(equipmentId: string): void {
    const index = playback.stepForEquipment(equipmentId);
    if (index < 0) return;
    ensurePlaybackMode();
    playback.jumpTo(index);
    scene.setPlaybackPaused(playback.status !== 'playing');
    applyPlaybackStep(true);
  }

  function resetAll(): void {
    stopPlayback();
    setSpeed(1);
    setLabels(true);
    arrowsOn = true;
    scene.setFluidArrows(true);
    arrowsBtn.textContent = '箭头：开';
    arrowsBtn.classList.add('active');
    fluidPaused = false;
    scene.setPlaybackPaused(false);
    scene.setFluidPaused(false);
    map?.resetView();
    map?.setState(null);
    currentSelected = '—';
    currentStepText = '—';
    if (mapCard.parentElement !== panel) panel.insertBefore(mapCard, tree);
    page.classList.remove('map-collapsed', 'map-expanded');
    mapBtn.classList.remove('active');
    mapExpand.classList.remove('active');
    updateHistoryPanel();
    updatePlaybackBar();
    syncPauseButtons();
  }

  function applyPlaybackStep(animate: boolean): void {
    const state = playback.state;
    const step = state.step;
    if (!step) return;
    lastAppliedStep = state.stepIndex;
    const current = state.currentEquipmentIds;
    const branchIds =
      step.no === 5 || step.no === 6
        ? branchGunIds.filter((id) => !current.includes(id))
        : [];
    const focusIds = step.no === 6 ? uniqueStrings([...current, 'eq-secondary-chamber']) : [...current];
    const spec: BoilOverlaySpec = {
      kind: 'playback',
      currentEquipmentIds: current,
      completedEquipmentIds: state.completedEquipmentIds,
      branchEquipmentIds: branchIds,
      currentPipelineIds: state.currentPipelineIds,
      completedPipelineIds: state.completedPipelineIds,
      activePipelineIds: state.activePipelineIds,
      focusEquipmentIds: focusIds,
      flowScope: state.activePipelineIds,
      areaId: step.areaId
    };
    scene.setOverlay(spec, { animate, picker: handleOverlayPick });
    scene.setPlaybackPaused(state.status !== 'playing');
    map?.setState({
      currentEquipmentIds: current,
      completedEquipmentIds: state.completedEquipmentIds,
      branchEquipmentIds: branchIds,
      currentPipelineIds: state.currentPipelineIds,
      completedPipelineIds: state.completedPipelineIds
    });
    setActiveTree(current, step.areaId, state.currentPipelineIds);
    currentSelected = equipmentNames(current);
    currentStepText = `第 ${step.no}/${state.totalSteps} 步 · ${step.title}（${playbackStatusText(state.status)}）`;
    playbackBar.classList.toggle('completed', state.status === 'completed');
    renderPlaybackDetail(state);
    updatePlaybackBar();
    updateHistoryPanel();
    syncPauseButtons();
  }

  function updatePlaybackProgress(state: PlaybackState): void {
    const percent = Math.max(0, Math.min(1, state.progress)) * 100;
    pbFill.style.width = `${percent}%`;
    pbKnob.style.left = `${percent}%`;
    pbProgress.setAttribute('aria-valuenow', String(state.stepNo || 1));
  }

  function updatePlaybackBar(): void {
    const state = playback.state;
    const step = state.step;
    pbArea.value.textContent = step ? areaDef(step.areaId)?.name ?? step.areaId : '—';
    pbDevice.value.textContent = step ? equipmentNames(state.currentEquipmentIds) : '—';
    pbStep.value.textContent = `${state.stepNo || 1} / ${state.totalSteps}`;
    pbStatus.value.textContent = playbackStatusText(state.status);
    pbSpeed.value.textContent = `${speed}×`;
    pbStepTitle.textContent = step
      ? `第 ${step.no} 步 · ${step.title} · ${playbackStatusText(state.status)} · 每步 ${TEACHING_STEP_SECONDS} 秒为教学演示节奏`
      : `尚未开始 · 每步 ${TEACHING_STEP_SECONDS} 秒为教学演示节奏，不是停留时间`;
    updatePlaybackProgress(state);
    pbTickEls.forEach((tick, index) => {
      tick.classList.toggle('done', index < state.stepIndex);
      tick.classList.toggle('active', index === state.stepIndex);
    });
    pbPlay.disabled = state.status === 'playing';
    pbPlay.textContent = state.status === 'playing' ? '播放中' : state.status === 'paused' ? '继续' : '播放';
    pbPlay.classList.toggle('active', state.status === 'playing');
    pbPause.disabled = state.status !== 'playing';
    pbStop.disabled = state.status === 'idle';
    pbPrev.disabled = state.stepIndex <= 0;
    pbNext.disabled = state.stepIndex >= state.totalSteps - 1 && state.status !== 'playing';
    for (const [candidate, chip] of pbSpeedButtons) chip.classList.toggle('active', candidate === speed);
    syncPauseButtons();
  }

  function handleOverlayPick(kind: 'equipment' | 'pipeline', id: string): void {
    if (uiMode === 'playback') {
      if (kind === 'equipment') jumpToEquipment(id);
      else {
        stopPlayback({ overview: false });
        scene.focusPipeline(id);
      }
      return;
    }
    if (kind === 'equipment') enterTrace(id);
    else {
      exitTrace({ overview: false });
      scene.focusPipeline(id);
    }
  }

  function handleMapPick(equipmentId: string): void {
    if (uiMode === 'playback') jumpToEquipment(equipmentId);
    else enterTrace(equipmentId);
  }

  function pushRecentDevice(equipmentId: string): void {
    const index = recentDevices.indexOf(equipmentId);
    if (index >= 0) recentDevices.splice(index, 1);
    recentDevices.unshift(equipmentId);
    if (recentDevices.length > 6) recentDevices.length = 6;
  }

  function pushRecentTrace(rootId: string, mode: TraceMode): void {
    const index = recentTraces.findIndex((entry) => entry.rootId === rootId && entry.mode === mode);
    if (index >= 0) recentTraces.splice(index, 1);
    recentTraces.unshift({ rootId, mode });
    if (recentTraces.length > 3) recentTraces.length = 3;
  }

  function updateHistoryPanel(): void {
    historyCurrent.textContent = `当前选中设备：${currentSelected}`;
    historyStep.textContent = `当前播放步骤：${currentStepText}`;
    historyDevices.replaceChildren();
    if (recentDevices.length === 0) {
      historyDevices.appendChild(el('span', 'boil-history-empty', '暂无记录'));
    } else {
      for (const id of recentDevices) {
        historyDevices.appendChild(
          button(equipmentDef(id)?.name ?? id, 'boil-chip', () => enterTrace(id), `追踪${equipmentDef(id)?.name ?? id}`)
        );
      }
    }
    historyPaths.replaceChildren();
    if (recentTraces.length === 0) {
      historyPaths.appendChild(el('span', 'boil-history-empty', '暂无追踪路径'));
    } else {
      for (const entry of recentTraces) {
        const result = traceEngine.full(entry.rootId);
        const label =
          `${result.rootName} · ${traceModeText(entry.mode)} · 上游 ${result.upstream.equipmentIds.length - 1} / ` +
          `下游 ${result.downstream.equipmentIds.length - 1}`;
        historyPaths.appendChild(
          button(label, 'boil-link boil-link-block', () => enterTrace(entry.rootId, entry.mode), '恢复该追踪路径')
        );
      }
    }
  }

  function setActiveTree(equipmentIds: string[], areaId: string | null, pipelineIds: string[] = []): void {
    const equipmentSet = new Set(equipmentIds);
    const pipelineSet = new Set(pipelineIds);
    overviewBtn.classList.toggle('active', !areaId);
    tabAll.classList.toggle('active', !areaId);
    for (const [id, tab] of tabButtons) tab.classList.toggle('active', id === areaId);
    for (const [id, row] of areaRows) {
      row.classList.toggle('active', id === areaId);
      row.classList.toggle('focused', id === areaId);
    }
    for (const [id, row] of equipmentRows) row.classList.toggle('active', equipmentSet.has(id));
    for (const [id, item] of pipeButtons) item.classList.toggle('active', pipelineSet.has(id));
  }

  function syncState(state: BoilSelectionState): void {
    tabAll.classList.toggle('active', state.mode === 'overview');
    for (const [areaId, tab] of tabButtons) tab.classList.toggle('active', areaId === state.areaId);
    overviewBtn.classList.toggle('active', state.mode === 'overview' && uiMode === 'normal');
    for (const [areaId, row] of areaRows) {
      row.classList.toggle('active', areaId === state.areaId);
      row.classList.toggle('focused', state.mode === 'area' && areaId === state.areaId);
    }
    for (const [equipmentId, row] of equipmentRows) {
      row.classList.toggle('active', equipmentId === state.equipmentId);
      const areaId = scene.state.areaId;
      row.classList.toggle('in-area', Boolean(areaId && areaDef(areaId)?.equipmentInstanceIds.includes(equipmentId)));
    }
    for (const [pipelineId, item] of pipeButtons) item.classList.toggle('active', pipelineId === state.pipelineId);
    if (uiMode === 'normal') {
      if (state.mode === 'area' && state.areaId) {
        const area = scene.areas.find((item) => item.def.id === state.areaId);
        map?.setState(
          area
            ? {
                currentEquipmentIds: area.equipment.map((item) => item.id),
                currentPipelineIds: area.pipelines.map((item) => item.id)
              }
            : null
        );
        currentSelected = area?.def.name ?? '—';
      } else if (state.mode === 'pipeline' && state.pipelineId) {
        const pipeline = pipelineDef(state.pipelineId);
        map?.setState(
          pipeline
            ? {
                currentEquipmentIds: [pipeline.from.equipment, pipeline.to.equipment],
                currentPipelineIds: [pipeline.id]
              }
            : null
        );
        currentSelected = pipeline?.name ?? '—';
      } else if (state.mode === 'overview') {
        map?.setState(null);
        currentSelected = '—';
      }
      updateHistoryPanel();
      renderDetail(state);
    }
    if (state.mode !== 'overview' && uiMode !== 'playback') setDrawer('details');
  }

  scene.addFrameListener((dt) => {
    if (uiMode !== 'playback' || playback.status !== 'playing') return;
    const tick = playback.tick(dt);
    if (tick.stepChanged) {
      applyPlaybackStep(true);
    } else if (tick.statusChanged) {
      if (tick.state.status === 'completed') scene.setPlaybackPaused(true);
      updatePlaybackBar();
      renderPlaybackDetail(tick.state);
      syncPauseButtons();
    } else {
      updatePlaybackProgress(tick.state);
    }
  });

  function detailSection(title: string): HTMLElement {
    const section = el('section', 'boil-detail-section');
    section.appendChild(el('h3', '', title));
    return section;
  }

  function metaRow(label: string, value: string | HTMLElement): HTMLElement {
    const row = el('div', 'boil-meta-row');
    row.appendChild(el('span', 'boil-meta-label', label));
    if (typeof value === 'string') row.appendChild(el('span', 'boil-meta-value', value));
    else row.appendChild(value);
    return row;
  }

  function chipRow(items: { label: string; onClick: () => void; active?: boolean; title?: string }[]): HTMLElement {
    const row = el('div', 'boil-chip-row');
    for (const item of items) {
      const chip = button(item.label, 'boil-chip' + (item.active ? ' active' : ''), item.onClick, item.title);
      row.appendChild(chip);
    }
    return row;
  }

  function areaButton(id: string): HTMLButtonElement {
    const area = areaDef(id);
    return button(area ? `${area.no.toString().padStart(2, '0')} ${area.name}` : id, 'boil-link', () => selectArea(id));
  }

  function equipmentButton(id: string): HTMLButtonElement {
    const equipment = equipmentDef(id);
    return button(equipment?.name ?? id, 'boil-link', () => selectEquipment(id));
  }

  function pipelineButton(pipeline: PipelineDef): HTMLButtonElement {
    return button(`${pipeline.id} · ${pipeline.name}`, 'boil-link boil-link-block', () => selectPipeline(pipeline.id));
  }

  function stepForEquipment(equipmentId: string) {
    const equipment = equipmentDef(equipmentId);
    return equipment ? BOIL_PROCESS.steps.find((step) => step.id === equipment.stepId) : undefined;
  }

  function pathRow(path: { equipmentIds: string[]; pipelineIds: string[] }): HTMLElement {
    const row = el('div', 'boil-path-row');
    path.equipmentIds.forEach((id, index) => {
      if (index > 0) row.appendChild(el('span', 'boil-path-arrow', '→'));
      row.appendChild(button(equipmentDef(id)?.name ?? id, 'boil-link', () => enterTrace(id), `追踪${equipmentDef(id)?.name ?? id}`));
    });
    if (path.pipelineIds.length > 0) {
      row.appendChild(el('span', 'boil-path-meta', `${path.pipelineIds.length} 条管线`));
    }
    return row;
  }

  function sourceLink(label: string, href: string) {
    const link = el('a', 'boil-observation-source', label) as HTMLAnchorElement;
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  const answers = new Map<string, number>();
  function orderCheckSection(showPipeline: boolean): HTMLElement {
    const section = detailSection('烟气顺序待核');
    section.append(el('p', '', BOIL_ORDER_CHECK.detail), sourceLink('查看 BREF 图 2.9', BOIL_ORDER_CHECK.url));
    const pipeline = showPipeline ? pipelineDef(BOIL_ORDER_CHECK.pipeline) : undefined;
    if (pipeline) section.appendChild(pipelineButton(pipeline));
    return section;
  }

  function observationSection(equipment: EquipmentInstanceDef): HTMLElement | null {
    if (BOIL_ORDER_CHECK.equipment.includes(equipment.id)) return orderCheckSection(true);
    const lesson = BOIL_OBSERVATIONS[equipment.id];
    if (!lesson) return null;
    const section = detailSection('输入、作用与去向');
    section.append(metaRow('输入', lesson.input), metaRow('作用条件', lesson.drive),
      metaRow('输出去向', lesson.outputs.join(' ')), el('p', 'boil-detail-note', lesson.boundary));
    const references = el('div', 'boil-link-row');
    references.appendChild(sourceLink(lesson.reference.label, lesson.reference.url));
    if (supportsInspection(equipment)) references.appendChild(inspectionButton(equipment, lesson.inspect));
    section.appendChild(references);
    const quiz = document.createElement('fieldset');
    quiz.className = 'boil-observation-check';
    quiz.appendChild(el('legend', '', lesson.check.question));
    const status = el('p', 'boil-detail-note');
    status.setAttribute('role', 'status');
    const choiceButtons: HTMLButtonElement[] = [];
    lesson.check.choices.forEach((choice, index) => {
      const control = button(choice, 'boil-btn boil-btn-ghost', () => {
        answers.set(equipment.id, index);
        refresh();
      });
      choiceButtons.push(control);
      quiz.appendChild(control);
    });
    function refresh() {
      const selected = answers.get(equipment.id);
      choiceButtons.forEach((control, index) => control.setAttribute('aria-pressed', String(index === selected)));
      status.textContent = selected === undefined ? '' : selected === lesson?.check.correct
        ? lesson.check.explanation : '再对照输出去向与内部结构，重新选择。';
    }
    quiz.appendChild(status);
    refresh();
    section.appendChild(quiz);
    return section;
  }

  function deviceInfoSection(
    equipment: EquipmentInstanceDef,
    options: { step?: (typeof BOIL_PROCESS.steps)[number]; pipelineIds?: string[] } = {}
  ): HTMLElement {
    const section = detailSection('设备信息同步');
    if (supportsInspection(equipment)) section.appendChild(inspectionButton(equipment));
    const observation = observationSection(equipment);
    if (observation) section.appendChild(observation);
    const area = areaDef(equipment.areaId);
    const step = options.step ?? stepForEquipment(equipment.id);
    const links = equipmentFlowLinks(BOIL_PROCESS, equipment.id);
    const upstreamIds = uniqueStrings(links.filter((link) => link.direction === 'upstream').map((link) => link.equipmentId));
    const downstreamIds = uniqueStrings(links.filter((link) => link.direction === 'downstream').map((link) => link.equipmentId));
    const pipelineIds = uniqueStrings([...(options.pipelineIds ?? []), ...links.map((link) => link.pipelineId)]);
    const inboundPipeline = pipelineDef(
      links.find((link) => link.direction === 'upstream')?.pipelineId ?? ''
    );
    const outboundPipeline =
      pipelineDef(
        (options.pipelineIds ?? []).find(
          (id) => pipelineDef(id)?.from.equipment === equipment.id
        ) ?? ''
      ) ?? pipelineDef(links.find((link) => link.direction === 'downstream')?.pipelineId ?? '');
    const firstPipeline = outboundPipeline ?? inboundPipeline ?? pipelineDef(pipelineIds[0] ?? '');
    const badges = el('div', 'boil-badge-row');
    badges.appendChild(statusBadge(equipment.dataStatus));
    badges.appendChild(el('span', 'boil-badge sim', 'Simulation / 教学模拟'));
    section.appendChild(badges);

    section.appendChild(metaRow('设备名称', equipment.name));
    section.appendChild(
      metaRow(
        '设备分类',
        `${area?.name ?? '待现场资料确认'} · 外部教学模型（${MODEL_LABELS[equipment.modelKey ?? ''] ?? equipment.modelKey ?? '待确认'}）`
      )
    );
    section.appendChild(metaRow('所属工艺区域', area?.name ?? '待现场资料确认'));
    section.appendChild(metaRow('当前步骤', step ? `第 ${step.no} 步 · ${step.title}` : '待现场资料确认'));
    section.appendChild(metaRow('主要功能', equipment.function));
    const operations = equipmentOperations(equipment);
    if (operations) section.appendChild(operations);
    section.appendChild(
      metaRow(
        '上游设备',
        upstreamIds.length > 0 ? equipmentNames(upstreamIds) : '待现场资料确认（无已确认工艺上游）'
      )
    );
    section.appendChild(
      metaRow(
        '下游设备',
        downstreamIds.length > 0 ? equipmentNames(downstreamIds) : '待现场资料确认（无已确认工艺下游）'
      )
    );
    section.appendChild(
      metaRow(
        '连接管道',
        pipelineIds.length > 0 ? pipelineIds.join('、') : '待现场资料确认'
      )
    );
    section.appendChild(
      metaRow(
        '当前介质',
        firstPipeline
          ? BOIL_PROCESS.media.find((medium) => medium.id === firstPipeline.medium)?.label ?? mediumShort(firstPipeline.medium)
          : '待现场资料确认'
      )
    );
    let flowText = '待现场资料确认';
    if (inboundPipeline && outboundPipeline) {
      flowText = `${equipmentDef(inboundPipeline.from.equipment)?.name ?? inboundPipeline.from.equipment} → ${
        equipment.name
      } → ${equipmentDef(outboundPipeline.to.equipment)?.name ?? outboundPipeline.to.equipment}（${inboundPipeline.id} / ${
        outboundPipeline.id
      }）`;
    } else if (outboundPipeline) {
      flowText = `${equipment.name} → ${
        equipmentDef(outboundPipeline.to.equipment)?.name ?? outboundPipeline.to.equipment
      }（${outboundPipeline.id}）`;
    } else if (inboundPipeline) {
      flowText = `${equipmentDef(inboundPipeline.from.equipment)?.name ?? inboundPipeline.from.equipment} → ${
        equipment.name
      }（${inboundPipeline.id}）`;
    }
    section.appendChild(metaRow('当前流向', flowText));
    section.appendChild(
      el('p', 'boil-detail-note', '设备型号、工程分类与运行参数未提供，均按「待现场资料确认」处理；本页数值只用于教学演示。')
    );

    const related = detailSection('上下游快捷入口');
    related.appendChild(
      chipRow([
        ...upstreamIds.map((id) => ({ label: `上游 · ${equipmentDef(id)?.name ?? id}`, onClick: () => enterTrace(id) })),
        ...downstreamIds.map((id) => ({ label: `下游 · ${equipmentDef(id)?.name ?? id}`, onClick: () => enterTrace(id) })),
        ...(pipelineIds.slice(0, 4).map((id) => ({ label: id, onClick: () => selectPipeline(id) })))
      ])
    );
    detailBody.appendChild(section);
    detailBody.appendChild(related);
    return section;
  }

  function renderTraceDetail(): void {
    if (!traceResult) return;
    detailBody.innerHTML = '';
    const result = traceResult;
    const heading = detailHeading.querySelector('h2');
    const sub = detailHeading.querySelector('span');
    if (heading) heading.textContent = result.rootName;
    if (sub) sub.textContent = `设备追踪 · 上游 ${Math.max(0, result.upstream.equipmentIds.length - 1)} · 下游 ${Math.max(0, result.downstream.equipmentIds.length - 1)}`;
    const root = equipmentDef(result.rootId);
    if (!root) return;
    const head = el('div', 'boil-detail-intro');
    const badges = el('div', 'boil-badge-row');
    badges.appendChild(statusBadge(root.dataStatus));
    badges.appendChild(el('span', 'boil-badge sim', 'Simulation / 教学模拟'));
    badges.appendChild(el('span', 'boil-badge neutral', traceModeText(traceMode)));
    head.appendChild(badges);
    head.appendChild(el('p', '', '上下游关系由管线端点推导，不按页面排列顺序推断。四根喷枪按二燃室平行支路处理，不串成连续节点。'));
    detailBody.appendChild(head);

    const tabs = chipRow([
      { label: '追踪上游', onClick: () => setTraceMode('upstream'), active: traceMode === 'upstream' },
      { label: '追踪下游', onClick: () => setTraceMode('downstream'), active: traceMode === 'downstream' },
      { label: '完整工艺路径', onClick: () => setTraceMode('full'), active: traceMode === 'full' }
    ]);
    detailBody.appendChild(tabs);

    deviceInfoSection(root, { pipelineIds: traceMode === 'full' ? result.full.pipelineIds : undefined });

    const paths = detailSection(traceMode === 'full' ? '完整工艺路径' : traceMode === 'upstream' ? '上游路径' : '下游路径');
    if (traceMode === 'upstream' || traceMode === 'full') {
      paths.appendChild(el('p', 'boil-subhead', '上游路径（源头 → 当前设备）'));
      if (result.upstream.paths.length === 0) {
        paths.appendChild(el('p', 'boil-detail-note', '待现场资料确认：无已确认工艺上游（如喷枪接入关系未确认）。'));
      } else {
        for (const path of result.upstream.paths) paths.appendChild(pathRow(path));
      }
    }
    if (traceMode === 'downstream' || traceMode === 'full') {
      paths.appendChild(el('p', 'boil-subhead', '下游路径（当前设备 → 末端）'));
      if (result.downstream.paths.length === 0) {
        paths.appendChild(el('p', 'boil-detail-note', '待现场资料确认：无已确认工艺下游（如喷枪接入关系未确认）。'));
      } else {
        for (const path of result.downstream.paths) paths.appendChild(pathRow(path));
      }
    }
    if (traceMode === 'full' && result.full.paths.length > 0) {
      paths.appendChild(el('p', 'boil-subhead', '完整路径（含全部支路）'));
      for (const path of result.full.paths) paths.appendChild(pathRow(path));
      if (result.full.truncated) {
        paths.appendChild(el('p', 'boil-detail-note', '路径数量较多，界面只展示前 32 条简单路径；未创建无限递归。'));
      }
    }
    detailBody.appendChild(paths);

    if (result.full.branches.length > 0) {
      const branch = detailSection('平行支路');
      for (const group of result.full.branches) {
        branch.appendChild(
          metaRow(
            '结构关联',
            `${group.parentName} → ${group.equipmentNames.join('、')}（${group.dataStatus === 'pending-confirmation' ? '待现场资料确认' : '教学示意'}）`
          )
        );
        branch.appendChild(
          chipRow(group.equipmentIds.map((id) => ({ label: equipmentDef(id)?.name ?? id, onClick: () => enterTrace(id) })))
        );
        branch.appendChild(el('p', 'boil-detail-note', group.note));
      }
      detailBody.appendChild(branch);
    }

    if (result.pendingPorts.length > 0) {
      const pending = detailSection('待现场资料确认');
      for (const port of result.pendingPorts.slice(0, 6)) {
        pending.appendChild(
          el('p', 'boil-detail-note', `${port.equipmentName} · ${port.portName}（${port.portId}）：${port.note}`)
        );
      }
      detailBody.appendChild(pending);
    }

    const actions = chipRow([
      { label: '退出追踪', onClick: () => exitTrace() },
      { label: '播放完整流程', onClick: () => playOrResume() },
      { label: '查看所属区域', onClick: () => selectArea(root.areaId) },
      { label: '聚焦本设备', onClick: () => scene.focusEquipmentGroup([root.id], true) }
    ]);
    detailBody.appendChild(actions);
  }

  function renderPlaybackDetail(state: PlaybackState): void {
    detailBody.innerHTML = '';
    const step = state.step;
    const heading = detailHeading.querySelector('h2');
    const sub = detailHeading.querySelector('span');
    if (!step) {
      if (heading) heading.textContent = '流程播放';
      if (sub) sub.textContent = '尚未开始';
      return;
    }
    if (heading) heading.textContent = `第 ${step.no} 步 · ${step.title}`;
    if (sub) sub.textContent = `${areaDef(step.areaId)?.name ?? step.areaId} · ${playbackStatusText(state.status)}`;
    const head = el('div', 'boil-detail-intro');
    const badges = el('div', 'boil-badge-row');
    badges.appendChild(el('span', 'boil-badge sim', 'Simulation / 教学模拟'));
    badges.appendChild(el('span', 'boil-badge neutral', playbackStatusText(state.status)));
    badges.appendChild(el('span', 'boil-badge neutral', `${step.no} / ${state.totalSteps}`));
    head.appendChild(badges);
    head.appendChild(el('p', '', step.description));
    detailBody.appendChild(head);

    const stepEquipment = step.equipmentInstanceIds
      .map((id) => equipmentDef(id))
      .filter((equipment): equipment is EquipmentInstanceDef => Boolean(equipment));
    const current = detailSection('本步骤设备');
    current.appendChild(
      chipRow(
        stepEquipment.map((equipment) => ({
          label: equipment.name,
          onClick: () => enterTrace(equipment.id)
        }))
      )
    );
    if (step.no === 6) {
      current.appendChild(
        el('p', 'boil-detail-note', '四根喷枪为二燃室的四个独立平行支路；接入位置、喷入介质与来源待现场资料确认，未串成四个连续工艺节点。')
      );
    }
    current.appendChild(
      el('p', 'boil-detail-note', `当前管道：${step.pipelineIds.length > 0 ? step.pipelineIds.join('、') : '本步骤无已确认管道（平行支路）'}`)
    );
    detailBody.appendChild(current);

    const primary = stepEquipment[0];
    if (primary) {
      deviceInfoSection(primary, { step, pipelineIds: step.pipelineIds });
    }

    if (step.no === 5 || step.no === 6) {
      const branch = detailSection('喷枪平行支路');
      branch.appendChild(
        metaRow('支路关系', `二燃室 → 4 根喷枪（独立平行支路；接入位置与介质待确认）`)
      );
      branch.appendChild(
        chipRow(branchGunIds.map((id) => ({ label: equipmentDef(id)?.name ?? id, onClick: () => enterTrace(id) })))
      );
      branch.appendChild(el('p', 'boil-detail-note', '三维场景以虚线支路示意空间关联；虚线不是已确认工艺管线，不作为管道设计依据。'));
      detailBody.appendChild(branch);
    }

    detailBody.appendChild(
      el('p', 'boil-detail-note', '播放节奏为教学演示节奏（每步约 4 秒，1×），不是工艺停留时间；无温度、压力、流量等运行数据。')
    );
  }

  function renderDetail(state: BoilSelectionState): void {
    if (uiMode === 'trace' && traceResult) {
      renderTraceDetail();
      return;
    }
    if (uiMode === 'playback') {
      renderPlaybackDetail(playback.state);
      return;
    }
    detailBody.innerHTML = '';
    const heading = detailHeading.querySelector('h2');
    const sub = detailHeading.querySelector('span');
    if (state.mode === 'area' && state.areaId) {
      const area = scene.areas.find((item) => item.def.id === state.areaId);
      if (area) {
        if (heading) heading.textContent = area.def.name;
        if (sub) sub.textContent = `工艺区域 ${area.def.no.toString().padStart(2, '0')}`;
        renderAreaDetail(area);
        return;
      }
    }
    if (state.mode === 'equipment' && state.equipmentId) {
      const equipment = equipmentDef(state.equipmentId);
      if (equipment) {
        if (heading) heading.textContent = equipment.name;
        if (sub) sub.textContent = `设备 · ${areaDef(equipment.areaId)?.name ?? equipment.areaId}`;
        renderEquipmentDetail(equipment);
        return;
      }
    }
    if (state.mode === 'pipeline' && state.pipelineId) {
      const pipeline = pipelineDef(state.pipelineId);
      if (pipeline) {
        if (heading) heading.textContent = pipeline.name;
        if (sub) sub.textContent = `管线 · ${pipeline.id}`;
        renderPipelineDetail(pipeline);
        return;
      }
    }
    if (heading) heading.textContent = '整厂总览';
    if (sub) sub.textContent = `${scene.areas.length} 区域 · ${BOIL_PROCESS.equipment.length} 设备 · ${BOIL_PROCESS.pipelines.length} 管线`;
    renderOverviewDetail();
  }

  function renderOverviewDetail(): void {
    const intro = el('div', 'boil-detail-intro');
    intro.appendChild(el('h3', '', '微沸喷烧全流程'));
    intro.appendChild(el('p', '', BOIL_PROCESS.description));
    detailBody.appendChild(intro);

    const chain = detailSection('流程链');
    chain.appendChild(
      chipRow(scene.areas.map((area) => ({ label: `${area.def.no.toString().padStart(2, '0')} ${area.def.name}`, onClick: () => selectArea(area.def.id) })))
    );
    detailBody.appendChild(chain);

    const numbers = detailSection('数据与校验');
    numbers.appendChild(metaRow('工艺区域', `${scene.areas.length} 个`));
    numbers.appendChild(metaRow('设备实例', `${BOIL_PROCESS.equipment.length} 个（含 4 根喷枪支路）`));
    numbers.appendChild(metaRow('管线', `${BOIL_PROCESS.pipelines.length} 条`));
    numbers.appendChild(metaRow('流体', `${BOIL_PROCESS.flowStreams.length} 条教学流线 · ${scene.fluidStats.particles} 个示踪粒子`));
    numbers.appendChild(metaRow('区域自检', scene.areaValidation.ok ? '通过 · 0 错误' : `未通过 · ${scene.areaValidation.errors.length} 错误`));
    numbers.appendChild(metaRow('待确认', `${BOIL_PROCESS.gaps.length} 项，界面已标注`));
    detailBody.appendChild(numbers);

    const note = el('p', 'boil-detail-note',
      '本页为教学示意：设备外形、布局、管线、阀门、支架与流体均为演示，不含温度、压力、流量等工艺参数；四根喷枪与二燃室/回转窑的接入关系仍待现场确认。');
    detailBody.appendChild(note);
  }

  function portList(ports: AreaPortRef[]): HTMLElement {
    const list = el('div', 'boil-port-list');
    if (ports.length === 0) {
      list.appendChild(el('p', 'boil-empty', '无已建立接口'));
      return list;
    }
    for (const port of ports) {
      const row = el('div', 'boil-port-row');
      row.appendChild(el('span', 'boil-port-name', `${port.equipmentName} · ${port.portName}`));
      row.appendChild(el('span', 'boil-port-role', port.boundary ? '流程边界' : roleText(port.role)));
      if (port.dataStatus === 'pending-confirmation') row.appendChild(el('span', 'boil-badge pending', '待确认'));
      list.appendChild(row);
    }
    return list;
  }

  function renderAreaDetail(area: ProcessAreaModel): void {
    const head = el('div', 'boil-detail-intro');
    const badges = el('div', 'boil-badge-row');
    badges.appendChild(statusBadge(area.def.dataStatus));
    badges.appendChild(el('span', 'boil-badge neutral', `设备 ${area.equipment.length}`));
    badges.appendChild(el('span', 'boil-badge neutral', `管线 ${area.pipelines.length}`));
    head.appendChild(badges);
    head.appendChild(el('p', '', area.def.description));
    detailBody.appendChild(head);

    const teaching = detailSection('区域教学说明');
    teaching.appendChild(metaRow('工艺目的', area.def.teaching.objective));
    teaching.appendChild(metaRow('输入', area.def.input));
    teaching.appendChild(metaRow('输出', area.def.output));
    teaching.appendChild(metaRow('工艺作用', area.def.teaching.effect));
    teaching.appendChild(metaRow('上下游关系', area.def.teaching.relation));
    detailBody.appendChild(teaching);

    const relation = detailSection('上下游区域');
    relation.appendChild(
      chipRow([
        ...area.upstreamAreaIds.map((id) => ({ label: `上游 · ${areaDef(id)?.name ?? id}`, onClick: () => selectArea(id) })),
        ...area.downstreamAreaIds.map((id) => ({ label: `下游 · ${areaDef(id)?.name ?? id}`, onClick: () => selectArea(id) }))
      ])
    );
    if (area.upstreamAreaIds.length === 0) relation.appendChild(el('p', 'boil-detail-note', '上游：外部来料（流程边界，来源待确认）。'));
    if (area.downstreamAreaIds.length === 0) relation.appendChild(el('p', 'boil-detail-note', '下游：厂外（流程边界，去向待确认）。'));
    relation.appendChild(
      chipRow([
        { label: '查看本区全部设备', onClick: () => { const first = area.equipment[0]; if (first) selectEquipment(first.id); } },
        { label: '聚焦本区管线', onClick: () => selectArea(area.def.id) }
      ])
    );
    detailBody.appendChild(relation);

    const equipment = detailSection(`主要设备（${area.equipment.length}）`);
    const equipmentList = el('div', 'boil-link-list');
    for (const item of area.equipment) {
      const row = el('div', 'boil-link-row');
      row.appendChild(equipmentButton(item.id));
      if (item.parentEquipmentId) {
        row.appendChild(el('span', 'boil-parent-tag', `↳ ${equipmentDef(item.parentEquipmentId)?.name ?? item.parentEquipmentId} 平行支路`));
      } else {
        row.appendChild(el('span', 'boil-link-meta', statusText(item.dataStatus)));
      }
      equipmentList.appendChild(row);
    }
    equipment.appendChild(equipmentList);
    detailBody.appendChild(equipment);

    const pipelines = detailSection(`主要管线（${area.pipelines.length}）`);
    for (const pipeline of area.pipelines) pipelines.appendChild(pipelineButton(pipeline));
    detailBody.appendChild(pipelines);

    const fluids = detailSection('流体种类');
    fluids.appendChild(
      chipRow(
        area.mediaIds.map((id) => ({
          label: mediumShort(id),
          onClick: () => {
            const pipeline = area.pipelines.find((item) => item.medium === id);
            if (pipeline) selectPipeline(pipeline.id);
          }
        }))
      )
    );
    fluids.appendChild(
      el('p', 'boil-detail-note',
        `包含流线：${area.flowStreamIds.map((id) => BOIL_PROCESS.flowStreams.find((stream) => stream.id === id)?.name ?? id).join('、')}；示踪粒子只表示流向与通断，不是 CFD。`)
    );
    detailBody.appendChild(fluids);

    const ports = detailSection('区域入口与出口');
    ports.appendChild(el('p', 'boil-subhead', '跨区管线'));
    const cross = el('div', 'boil-link-list');
    for (const pipeline of area.entryPipelines) {
      const row = el('div', 'boil-link-row');
      row.appendChild(el('span', 'boil-link-meta', '入口'));
      row.appendChild(pipelineButton(pipeline));
      cross.appendChild(row);
    }
    for (const pipeline of area.exitPipelines) {
      const row = el('div', 'boil-link-row');
      row.appendChild(el('span', 'boil-link-meta', '出口'));
      row.appendChild(pipelineButton(pipeline));
      cross.appendChild(row);
    }
    if (area.entryPipelines.length === 0 && area.exitPipelines.length === 0) {
      cross.appendChild(el('p', 'boil-empty', '无跨区管线（首端/末端按流程边界处理）'));
    }
    ports.appendChild(cross);
    ports.appendChild(el('p', 'boil-subhead', '入口接口'));
    ports.appendChild(portList(area.entryPorts));
    ports.appendChild(el('p', 'boil-subhead', '出口接口'));
    ports.appendChild(portList(area.exitPorts));
    detailBody.appendChild(ports);

    const bounds = detailSection('区域三维范围');
    bounds.appendChild(metaRow('教学范围', dimensionText(area)));
    bounds.appendChild(el('p', 'boil-detail-note', area.def.boundsNote));
    detailBody.appendChild(bounds);

    const pending = el('div', 'boil-detail-pending');
    pending.appendChild(el('strong', '', '待确认'));
    pending.appendChild(el('p', '', area.def.teaching.pendingNote));
    detailBody.appendChild(pending);
  }

  function equipmentOperations(equipment: EquipmentInstanceDef): HTMLElement | null {
    const controlled = ['eq-id-fan', 'eq-mixer', 'eq-furnace-pump', 'eq-rotary-kiln', 'eq-secondary-chamber'];
    if (!controlled.includes(equipment.id)) return null;
    const controls = detailSection('设备操作');
    controls.appendChild(el('p', 'boil-detail-note', '待确认。需现场操作规程及启停、联锁资料，才能开放本设备的现场操作训练。'));
    if (equipment.id === 'eq-id-fan') {
      const control = button('', 'btn btn-outline btn-sm', () => {
        scene.setFanTracing(!scene.fanTracing);
        update();
      });
      const status = el('p', 'boil-detail-note');
      status.setAttribute('role', 'status');
      function update() {
        control.textContent = scene.fanTracing ? '停止引风机示踪' : '启动引风机示踪';
        status.textContent = scene.fanTracing ? '引风机至烟囱的烟气路径示踪开启。' : '叶轮演示暂停，引风机至烟囱的示踪已停止。';
      }
      update();
      controls.append(control, status);
    }
    return controls;
  }

  function renderEquipmentDetail(equipment: EquipmentInstanceDef): void {
    const head = el('div', 'boil-detail-intro');
    const badges = el('div', 'boil-badge-row');
    badges.appendChild(statusBadge(equipment.dataStatus));
    badges.appendChild(
      button(areaDef(equipment.areaId)?.name ?? equipment.areaId, 'boil-badge link', () => selectArea(equipment.areaId), '查看所属区域')
    );
    head.appendChild(badges);
    head.appendChild(el('p', '', equipment.function));
    detailBody.appendChild(head);

    const internals = detailSection('结构与职责');
    internals.appendChild(metaRow('内部结构', equipment.internals));
    internals.appendChild(metaRow('来源说明', equipment.sourceNote));
    if (supportsInspection(equipment)) internals.appendChild(inspectionButton(equipment));
    detailBody.appendChild(internals);
    const observation = observationSection(equipment);
    if (observation) detailBody.appendChild(observation);
    const operations = equipmentOperations(equipment);
    if (operations) detailBody.appendChild(operations);

    if (equipment.parentEquipmentId) {
      const parent = equipmentDef(equipment.parentEquipmentId);
      const relation = detailSection('结构关联');
      relation.appendChild(
        metaRow(
          '挂接方式',
          `${parent?.name ?? equipment.parentEquipmentId} · ${equipment.relationKind === 'parallel-branch' ? '四个独立平行支路之一' : '集成部件'}`
        )
      );
      if (parent) relation.appendChild(chipRow([{ label: `查看 ${parent.name}`, onClick: () => selectEquipment(parent.id) }]));
      relation.appendChild(el('p', 'boil-detail-note', equipment.relationNote ?? '具体接入位置与介质待确认。'));
      detailBody.appendChild(relation);
    }

    const links = equipmentFlowLinks(BOIL_PROCESS, equipment.id);
    const upstream = links.filter((link) => link.direction === 'upstream');
    const downstream = links.filter((link) => link.direction === 'downstream');
    const flow = detailSection('工艺上下游');
    if (links.length === 0) {
      flow.appendChild(el('p', 'boil-detail-note', '暂无已确认的工艺管线（喷枪支路接入关系待确认）。'));
    } else {
      const rows = el('div', 'boil-link-list');
      for (const link of upstream) {
        const row = el('div', 'boil-link-row');
        row.appendChild(el('span', 'boil-link-meta', '上游'));
        row.appendChild(equipmentButton(link.equipmentId));
        row.appendChild(el('span', 'boil-link-meta', link.pipelineId));
        rows.appendChild(row);
      }
      for (const link of downstream) {
        const row = el('div', 'boil-link-row');
        row.appendChild(el('span', 'boil-link-meta', '下游'));
        row.appendChild(equipmentButton(link.equipmentId));
        row.appendChild(el('span', 'boil-link-meta', link.pipelineId));
        rows.appendChild(row);
      }
      flow.appendChild(rows);
    }
    detailBody.appendChild(flow);

    const related = detailSection('关联管线与流体');
    if (links.length === 0) {
      related.appendChild(el('p', 'boil-detail-note', '无关联管线；该设备按待确认支路处理，不参与主流体传播。'));
    } else {
      for (const link of links) {
        const pipeline = pipelineDef(link.pipelineId);
        if (!pipeline) continue;
        const row = el('div', 'boil-link-row');
        row.appendChild(pipelineButton(pipeline));
        row.appendChild(el('span', 'boil-link-meta', mediumShort(pipeline.medium)));
        related.appendChild(row);
      }
    }
    detailBody.appendChild(related);

    const ports = detailSection(`接口（${equipment.ports.length}）`);
    const list = el('div', 'boil-port-list');
    for (const port of equipment.ports) {
      const connected = BOIL_PROCESS.pipelines.some(
        (pipeline) =>
          (pipeline.from.equipment === equipment.id && pipeline.from.port === port.id) ||
          (pipeline.to.equipment === equipment.id && pipeline.to.port === port.id)
      );
      const row = el('div', 'boil-port-row');
      row.appendChild(el('span', 'boil-port-name', port.name));
      row.appendChild(el('span', 'boil-port-role', roleText(port.role)));
      row.appendChild(
        el(
          'span',
          'boil-port-state' + (port.boundary ? ' boundary' : connected ? ' linked' : ' pending'),
          port.boundary ? '流程边界' : connected ? '已连接' : '待确认'
        )
      );
      if (port.media.length) row.appendChild(el('span', 'boil-port-media', port.media.map(mediumShort).join('/')));
      list.appendChild(row);
    }
    ports.appendChild(list);
    detailBody.appendChild(ports);
  }

  function renderPipelineDetail(pipeline: PipelineDef): void {
    const report = reports.get(pipeline.id);
    const medium = BOIL_PROCESS.media.find((item) => item.id === pipeline.medium);
    const stream = BOIL_PROCESS.flowStreams.find((item) => item.id === pipeline.flowStreamId);
    const head = el('div', 'boil-detail-intro');
    const badges = el('div', 'boil-badge-row');
    badges.appendChild(statusBadge(pipeline.dataStatus));
    badges.appendChild(el('span', 'boil-badge neutral', mediumShort(pipeline.medium)));
    badges.appendChild(button(areaDef(pipeline.areaId)?.name ?? pipeline.areaId, 'boil-badge link', () => selectArea(pipeline.areaId)));
    head.appendChild(badges);
    head.appendChild(el('p', '', pipeline.designNote));
    detailBody.appendChild(head);
    if (pipeline.id === BOIL_ORDER_CHECK.pipeline) detailBody.appendChild(orderCheckSection(false));

    const route = detailSection('管线参数（教学示意）');
    route.appendChild(metaRow('管径等级', report?.sizeLabel ?? '教学示意'));
    route.appendChild(metaRow('长度', report ? `${report.length.toFixed(1)} m` : '—'));
    route.appendChild(metaRow('弯头 / 法兰', report ? `${report.elbows} / ${report.flanges}` : '—'));
    route.appendChild(metaRow('阀门', report ? `${report.valveKind}（位置待确认）` : '—'));
    route.appendChild(metaRow('支架', report ? `${report.supports} 个（教学示意）` : '—'));
    route.appendChild(metaRow('流体', stream?.name ?? pipeline.flowStreamId ?? '—'));
    detailBody.appendChild(route);

    const endpoints = detailSection('起终点与上下游');
    const fromRow = el('div', 'boil-link-row');
    fromRow.appendChild(el('span', 'boil-link-meta', '起点'));
    fromRow.appendChild(equipmentButton(pipeline.from.equipment));
    fromRow.appendChild(el('span', 'boil-link-meta', pipeline.from.port));
    endpoints.appendChild(fromRow);
    const toRow = el('div', 'boil-link-row');
    toRow.appendChild(el('span', 'boil-link-meta', '终点'));
    toRow.appendChild(equipmentButton(pipeline.to.equipment));
    toRow.appendChild(el('span', 'boil-link-meta', pipeline.to.port));
    endpoints.appendChild(toRow);
    endpoints.appendChild(
      chipRow([
        { label: '查看上游设备', onClick: () => selectEquipment(pipeline.from.equipment) },
        { label: '查看下游设备', onClick: () => selectEquipment(pipeline.to.equipment) },
        { label: '查看所属区域', onClick: () => selectArea(pipeline.areaId) }
      ])
    );
    detailBody.appendChild(endpoints);

    const note = el('div', 'boil-detail-pending');
    note.appendChild(el('strong', '', '待确认'));
    note.appendChild(el('p', '', '管径等级、阀门型式与位置、支架间距均未从来源确认；三维路由为教学示意，不是工程管道设计。'));
    detailBody.appendChild(note);
  }

  const inspectionRoot = root as HTMLElement & { __boilRoute?: (hash: string) => void; __dispose?: () => void };
  let inspection: ReturnType<typeof openInspection> | null = null;
  let inspectedId: string | null = null;
  let inspectionTrigger: HTMLElement | null = null;

  function inspectionButton(equipment: EquipmentInstanceDef, focus?: { partId: string; label: string }) {
    const control = button(focus?.label ?? '观察设备结构', 'boil-btn boil-btn-ghost', () => {
      inspectionTrigger = control;
      history.pushState({ boilInspectionFromProcess: true, boilInspectionPart: focus?.partId }, '', '#/boil/equipment/' + equipment.id);
      routeInspection(location.hash);
    });
    return control;
  }

  function closeInspectionRoute() {
    if (history.state?.boilInspectionFromProcess === true) history.back();
    else {
      history.replaceState(null, '', '#/boil');
      routeInspection(location.hash);
    }
  }

  function routeInspection(hash: string) {
    const id = /^#\/boil\/equipment\/([\w-]+)$/.exec(hash)?.[1] ?? null;
    if (id === inspectedId) return;
    inspection?.dispose();
    inspection = null;
    inspectedId = null;
    scene.setInspectionActive(false);
    const equipment = id ? equipmentDef(id) : undefined;
    if (!equipment || !supportsInspection(equipment)) {
      inspectionTrigger?.focus();
      inspectionTrigger = null;
      return;
    }
    const part: unknown = history.state?.boilInspectionPart;
    inspection = openInspection(page, equipment, closeInspectionRoute, typeof part === 'string' ? part : undefined);
    inspectedId = equipment.id;
    scene.setInspectionActive(true);
  }

  const pageKeys = new AbortController();
  window.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.key !== 'Escape' || inspection) return;
    if (more.open) { more.open = false; more.querySelector('summary')?.focus(); }
    else if (page.classList.contains('map-expanded')) { mapExpand.click(); mapExpand.focus(); }
    else if (drawer) {
      const toggle = drawer === 'tree' ? panelBtn : detailBtn;
      setDrawer(null);
      toggle.focus();
    } else return;
    event.preventDefault();
  }, { signal: pageKeys.signal });

  inspectionRoot.__boilRoute = routeInspection;

  /* ---------- 外部测试/调试 API ---------- */
  const playbackApi: Record<string, unknown> = {
    start: () => playOrResume(),
    pause: () => pausePlayback(),
    resume: () => playOrResume(),
    stop: () => stopPlayback(),
    reset: () => resetAll(),
    next: () => stepPlayback(1),
    previous: () => stepPlayback(-1),
    jumpTo: (index: number) => jumpPlayback(index),
    setSpeed: (value: number) => setSpeed(value),
    steps: BOIL_PROCESS.steps.map((step) => ({
      id: step.id,
      no: step.no,
      title: step.title,
      equipmentInstanceIds: step.equipmentInstanceIds,
      pipelineIds: step.pipelineIds,
      areaId: step.areaId
    })),
    audit: () => playbackAudit
  };
  Object.defineProperties(playbackApi, {
    state: { get: () => playback.state, enumerable: true },
    status: { get: () => playback.status, enumerable: true }
  });

  const api: Record<string, unknown> = {
    ready: true,
    phase: 6,
    counts: scene.counts,
    equipmentCount: scene.equipmentCount,
    pendingPorts: scene.pendingPorts,
    boundaryPorts: scene.boundaryPorts,
    routes: scene.routeReports,
    errors: scene.validation.errors,
    warnings: scene.validation.warnings,
    areas: scene.areas.map((area) => ({
      id: area.def.id,
      no: area.def.no,
      name: area.def.name,
      equipmentIds: area.equipment.map((item) => item.id),
      pipelineIds: area.pipelines.map((item) => item.id),
      flowStreamIds: area.flowStreamIds,
      upstream: area.upstreamAreaIds,
      downstream: area.downstreamAreaIds,
      mediaIds: area.mediaIds,
      bounds: area.bounds,
      entryPipelines: area.entryPipelines.map((item) => item.id),
      exitPipelines: area.exitPipelines.map((item) => item.id),
      teaching: area.def.teaching,
      boundsNote: area.def.boundsNote
    })),
    areaValidation: {
      ok: scene.areaValidation.ok,
      errors: scene.areaValidation.errors,
      warnings: scene.areaValidation.warnings,
      counts: scene.areaValidation.counts
    },
    traceAudit: traceEngine.inspect(),
    trace: (id: string, mode: TraceMode = 'full') => traceEngine.full(id),
    traceSide: (id: string, mode: 'upstream' | 'downstream') =>
      mode === 'upstream' ? traceEngine.upstream(id) : traceEngine.downstream(id),
    traceCycleProbe: () => {
      const probe = structuredClone(BOIL_PROCESS);
      probe.pipelines.push({
        ...probe.pipelines[0],
        id: 'probe-loop',
        from: { equipment: 'eq-stack', port: 'emissionOut' },
        to: { equipment: 'eq-smp', port: 'feedIn' }
      });
      const result = createTraceEngine(probe).full('eq-smp');
      return { cycles: result.cycles.length, paths: result.full.paths.length, terminated: true };
    },
    enterTrace: (id: string, mode: TraceMode = 'full') => enterTrace(id, mode),
    exitTrace: () => exitTrace(),
    setTraceMode: (mode: TraceMode) => setTraceMode(mode),
    playback: playbackApi,
    playbackState: () => playback.state,
    playbackAudit,
    mapInfo: () => map?.info() ?? null,
    mapClick: (id: string) => handleMapPick(id),
    mapZoom: (factor: number) => map?.zoom(factor),
    mapReset: () => map?.resetView(),
    overlay: () => scene.overlayInfo(),
    perf: () => scene.perfInfo(),
    history: () => ({
      devices: [...recentDevices],
      traces: recentTraces.map((entry) => ({ ...entry })),
      selected: currentSelected,
      step: currentStepText
    }),
    selectArea: (id: string) => selectArea(id),
    selectEquipment: (id: string) => enterTrace(id),
    selectPipeline: (id: string) => selectPipeline(id),
    overview: () => selectOverview(),
    reset: () => resetAll(),
    setLabels,
    setFluidPaused: (paused: boolean) => {
      fluidPaused = paused;
      scene.setPlaybackPaused(paused);
      syncPauseButtons();
    },
    setFluidSpeed: (value: number) => setSpeed(value),
    setFluidArrows: (visible: boolean) => {
      arrowsOn = visible;
      scene.setFluidArrows(visible);
      arrowsBtn.textContent = `箭头：${visible ? '开' : '关'}`;
      arrowsBtn.classList.toggle('active', visible);
    },
    fluidStats: () => scene.fluidStats,
    visual: () => scene.visualInfo(),
    view: () => scene.viewInfo(),
    screenOfEquipment: (id: string) => scene.screenPointOfEquipment(id),
    screenOfPipeline: (id: string) => scene.screenPointOfPipeline(id),
    pickAt: (x: number, y: number) => scene.pickAt(x, y)
  };
  Object.defineProperties(api, {
    state: { get: () => scene.state, enumerable: true },
    activeArea: { get: () => scene.activeArea, enumerable: true },
    selectedEquipment: { get: () => scene.selectedEquipment, enumerable: true },
    selectedPipeline: { get: () => scene.selectedPipeline, enumerable: true },
    mode: { get: () => uiMode, enumerable: true },
    traceResult: { get: () => traceResult, enumerable: true },
    traceMode: { get: () => traceMode, enumerable: true },
    currentStep: { get: () => currentStepText, enumerable: true },
    currentSelected: { get: () => currentSelected, enumerable: true }
  });
  (window as unknown as Record<string, unknown>).__boil = api;

  inspectionRoot.__dispose = () => {
    delete inspectionRoot.__boilRoute;
    pageKeys.abort();
    inspection?.dispose();
    chromeObserver.disconnect();
    window.removeEventListener('resize', syncChromeLayout);
    map?.dispose();
    map = null;
    scene.dispose();
    if ('__boil' in window) delete (window as unknown as Record<string, unknown>).__boil;
  };

  playBtn.classList.add('active');
  arrowsBtn.classList.add('active');
  setSpeed(1);
  updatePlaybackBar();
  updateHistoryPanel();
  updateTraceButtons();
  setDrawer(null);
  syncState(scene.state);
  routeInspection(location.hash);
}
