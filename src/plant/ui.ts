import { teachingFlowLabel } from '../process/teachingFlow';
import { PLANT_EQUIPMENT_CONTROLS, type PlantScenario } from '../data/plant';
import { VALVE_OPERATIONS } from '../data/valveOperations';
import './plant.css';
import {
  MEDIA, PIPELINES, PLANT_NODES, PLANT_NOTICE, PROCESS_LAYERS, PROCESS_STEPS, PIPE_SIZES,
  INSTRUMENTS, VALVE_STATE_LABEL, deviceOfNode, getNodeByUid, getLayer, getPipe, stepOfNode, layerOfNode,
  pipesOfNode, inlineNodesOfPipe, valvesOfPipe, instrumentsOfPipe, traceFrom, isValveNode,
  type PlantNodeDef, type PipelineDef, type PortDef, type ValveState, type TraceResult, type LayerId, type ProcessLayerDef
} from '../data/plant';
import { PlantScene, type PlantViewMode } from './scene';
import { el, button, icon, ICONS } from '../ui/dom';
import { openRecordsDialog } from '../ui/dialogs';
import { openSceneDevice, sceneSnapshot } from '../ui/sceneNavigation';
import plantSourcesUrl from '../../docs/plant-process.md?url';

const MODES: { id: PlantViewMode; label: string; title: string }[] = [
  { id: 'equipment', label: '设备', title: '设备模式：观察设备结构与编号标签' },
  { id: 'process', label: '流程', title: '流程模式：突出工艺层分区与主流程设备' },
  { id: 'piping', label: '管道', title: '管道模式：弱化设备，突出管线/阀门/仪表与管线编号' },
  { id: 'fluid', label: '流体', title: '流体模式：管壁半透明，观察内部流体与流向' }
];
type PlantSnapshot = {
  kind: 'plant';
  scene: PlantScene['navigationState'];
  labels: boolean;
  activeStep: string;
  tab: 'steps' | 'layers';
  teachIndex: number | null;
  trace: { uid: string; dir: 'up' | 'down' | 'both' } | null;
};

const TEACH_MS = 9000;
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function hex(color: number) { return `#${color.toString(16).padStart(6, '0')}`; }

function mediumDot(mediumId: keyof typeof MEDIA) {
  const m = MEDIA[mediumId];
  const dot = el('span', 'plant-dot');
  dot.style.background = hex(m.color);
  return dot;
}

function mediumLabel(mediumId: keyof typeof MEDIA) {
  const m = MEDIA[mediumId];
  return `${m.label}${m.phase === 'gas' ? '（气相）' : m.phase === 'utility' ? '（公用工程）' : ''}`;
}

function phaseLabel(mediumId: keyof typeof MEDIA) {
  const phase = MEDIA[mediumId].phase;
  return phase === 'gas' ? '气相' : phase === 'utility' ? '公用工程' : '液相';
}

/** 端点描述 */
function endpointText(endpoint: PipelineDef['from']): string {
  if (endpoint.type === 'cap') return endpoint.label;
  const node = getNodeByUid(endpoint.node);
  if (!node) return endpoint.node;
  const port = node.ports.find((p) => p.id === endpoint.port);
  return `${node.tag} ${node.label} · ${port?.name ?? endpoint.port}`;
}

function endpointTag(endpoint: PipelineDef['from']): string {
  if (endpoint.type === 'cap') return '外部接管';
  return getNodeByUid(endpoint.node)?.tag ?? endpoint.node;
}

function peerOf(pipe: PipelineDef, side: 'from' | 'to'): string {
  const endpoint = pipe[side];
  if (endpoint.type === 'cap') return endpoint.label;
  const node = getNodeByUid(endpoint.node);
  if (!node) return endpoint.node;
  const port = node.ports.find((p) => p.id === endpoint.port);
  return `${node.tag} · ${port?.name ?? endpoint.port}`;
}

export function renderPlant(root: HTMLElement) {
  root.innerHTML = '';
  const page = el('div', 'plant-page');
  const stage = el('div', 'plant-stage');
  page.appendChild(stage);

  /* ---------- 顶栏 ---------- */
  const top = el('header', 'plant-topbar');
  const back = button('', 'plant-btn plant-btn-ghost', () => { location.hash = '#/library'; }, '返回设备库');
  back.appendChild(icon(ICONS.back, 16));
  back.appendChild(el('span', '', '设备库'));
  top.appendChild(back);

  const title = el('div', 'plant-title');
  title.appendChild(el('h1', '', '化工厂全流程装置'));
  const objectTitle = el('span', 'plant-current-object');
  title.appendChild(objectTitle);
  const status = el('span', 'plant-status', '已暂停');
  title.appendChild(status);
  top.appendChild(title);

  const controls = el('div', 'plant-controls');
  const runBtn = button('', 'plant-btn plant-btn-primary plant-run', () => {
    const now = scene.toggle();
    syncRun(now);
    if (now) more.open = false;
  }, '启动或暂停流程动画');
  const runIcon = icon(ICONS.play, 15);
  runBtn.appendChild(runIcon);
  runBtn.appendChild(el('span', 'plant-run-text', '启动流程'));
  controls.appendChild(runBtn);

  const more = document.createElement('details');
  more.className = 'plant-more';
  more.appendChild(el('summary', 'plant-btn plant-btn-ghost', '更多'));
  const moreBody = el('div', 'plant-more-body');
  more.appendChild(moreBody);

  const speedWrap = el('label', 'plant-speed');
  speedWrap.appendChild(el('span', '', '速度'));
  const speedSel = document.createElement('select');
  speedSel.setAttribute('aria-label', '动画速度');
  for (const v of ['0.5', '1', '2']) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = `${v}×`;
    if (v === '1') opt.selected = true;
    speedSel.appendChild(opt);
  }
  speedSel.addEventListener('change', () => scene.setSpeed(Number(speedSel.value) || 1));
  speedWrap.appendChild(speedSel);
  moreBody.appendChild(speedWrap);

  const modesWrap = el('div', 'plant-modes');
  const modeBtns = new Map<PlantViewMode, HTMLButtonElement>();
  for (const mode of MODES) {
    const b = button(mode.label, 'plant-mode-btn', () => setMode(mode.id), mode.title);
    if (mode.id === 'equipment') b.classList.add('active');
    modeBtns.set(mode.id, b);
    modesWrap.appendChild(b);
  }
  controls.appendChild(modesWrap);

  const xrayBtn = button('内部视图：关', 'plant-btn plant-btn-ghost', () => {
    const on = !scene.xrayEnabled;
    scene.setXray(on);
    xrayBtn.textContent = `内部视图：${on ? '开' : '关'}`;
    xrayBtn.classList.toggle('active', on);
  }, '所有设备外壳半透明，观察内部结构（非剖切封口）');
  moreBody.appendChild(xrayBtn);

  const labelBtn = button('名称标签：开', 'plant-btn plant-btn-ghost', () => {
    labelsOn = !labelsOn;
    scene.setLabelVisibility(labelsOn);
    labelBtn.textContent = `名称标签：${labelsOn ? '开' : '关'}`;
  }, '显示或隐藏设备/管线名称标签');
  moreBody.appendChild(labelBtn);

  const mapBtn = button('流程图', 'plant-btn plant-btn-ghost', () => toggleMap(), '打开流程总览图');
  controls.appendChild(mapBtn);

  const resetBtn = button('重置视角', 'plant-btn plant-btn-ghost', () => scene.fitView(), '把镜头恢复到全装置视角');
  moreBody.appendChild(resetBtn);

  const stepsToggle = button('面板', 'plant-btn plant-btn-ghost plant-steps-toggle', () => {
    const open = !page.classList.contains('steps-open');
    if (open) { closeCard(); toggleMap(false); }
    setStepsOpen(open);
  }, '打开工序/工艺层面板');
  controls.appendChild(stepsToggle);
  moreBody.appendChild(button('学习记录', 'plant-btn plant-btn-ghost', () => openRecordsDialog(), '查看、导出、导入或清除本机学习记录'));
  moreBody.appendChild(el('p', 'plant-hint', '可直接选择设备、管线或工序。使用「启动流程」可观察当前演示状态。'));
  moreBody.appendChild(el('p', 'plant-notice', PLANT_NOTICE));
  const sourceLink = el('a', 'plant-btn plant-btn-ghost', '工艺来源与适用范围');
  sourceLink.href = plantSourcesUrl;
  sourceLink.target = '_blank';
  sourceLink.rel = 'noopener';
  moreBody.appendChild(sourceLink);
  controls.appendChild(more);
  top.appendChild(controls);
  page.appendChild(top);

  /* ---------- 左侧：工序 / 工艺层 ---------- */
  const stepsPanel = el('aside', 'plant-panel plant-steps');
  const stepsHead = el('div', 'plant-panel-head');
  const stepsHeadText = el('div', 'plant-panel-heading');
  stepsHeadText.appendChild(el('h2', '', '工艺流程'));
  stepsHeadText.appendChild(el('span', '', `${PROCESS_STEPS.length} 工序 · ${PROCESS_LAYERS.length} 层 · ${PIPELINES.length} 管线`));
  stepsHead.appendChild(stepsHeadText);
  const teachBtn = button('开始教学', 'plant-btn plant-btn-primary plant-teach-btn', () => toggleTeaching(), '按工序自动播放并讲解');
  stepsHead.appendChild(teachBtn);
  stepsPanel.appendChild(stepsHead);

  const tabs = el('div', 'plant-tabs');
  const tabStepsBtn = button('工序', 'plant-tab active', () => switchTab('steps'));
  const tabLayersBtn = button('工艺层', 'plant-tab', () => switchTab('layers'));
  tabs.appendChild(tabStepsBtn);
  tabs.appendChild(tabLayersBtn);
  stepsPanel.appendChild(tabs);

  const stepsBody = el('div', 'plant-tab-body plant-steps-body');
  const stepsList = el('ol', 'plant-step-list');
  let activeStep = '';
  const stepItems = new Map<string, HTMLLIElement>();
  for (const step of PROCESS_STEPS) {
    const li = el('li', 'plant-step');
    li.dataset.step = step.id;
    const head = el('button', 'plant-step-head');
    head.type = 'button';
    head.appendChild(el('span', 'plant-step-no', String(step.no)));
    const text = el('div', 'plant-step-text');
    text.appendChild(el('span', 'plant-step-title', step.title));
    text.appendChild(el('span', 'plant-step-desc', step.desc));
    head.appendChild(text);
    const layer = getLayer(step.layer);
    const layerChip = el('span', 'plant-layer-chip', layer.id);
    layerChip.style.color = hex(layer.color);
    layerChip.style.borderColor = `${hex(layer.color)}66`;
    head.appendChild(layerChip);
    head.addEventListener('click', () => {
      if (teaching) setTeachingIndex(PROCESS_STEPS.indexOf(step));
      focusStep(step.id, true);
    });
    li.appendChild(head);
    const chips = el('div', 'plant-step-nodes');
    for (const uid of step.nodes) {
      const node = getNodeByUid(uid);
      if (!node) continue;
      const chip = button(`${node.tag} ${node.label}`, 'plant-chip', () => selectDevice(uid));
      chip.title = `选中 ${node.tag} ${node.label}`;
      chips.appendChild(chip);
    }
    for (const pid of step.pipes) {
      const pipe = PIPELINES.find((p) => p.id === pid);
      if (!pipe) continue;
      const chip = button(pid, 'plant-chip plant-chip-pipe', () => selectPipe(pid));
      chip.title = `${pipe.id} ${pipe.name} · ${MEDIA[pipe.medium].label}`;
      chips.appendChild(chip);
    }
    li.appendChild(chips);
    stepsList.appendChild(li);
    stepItems.set(step.id, li);
  }
  stepsBody.appendChild(stepsList);
  stepsBody.appendChild(el('p', 'plant-step-note', '点击工序聚焦相关设备与管线；点击位号或管线编号查看信息卡。'));
  stepsPanel.appendChild(stepsBody);

  const layersBody = el('div', 'plant-tab-body plant-layers-body');
  layersBody.style.display = 'none';
  const layerList = el('div', 'plant-layer-list');
  for (const layer of PROCESS_LAYERS) {
    const item = el('button', 'plant-layer-item');
    item.type = 'button';
    item.style.borderLeftColor = hex(layer.color);
    const head = el('div', 'plant-layer-item-head');
    const name = el('span', 'plant-layer-item-name', `${layer.id} ${layer.name}`);
    name.style.color = hex(layer.color);
    head.appendChild(name);
    head.appendChild(el('span', 'plant-layer-item-count', `${layer.devices.length} 设备`));
    item.appendChild(head);
    item.appendChild(el('p', 'plant-layer-item-desc', layer.function));
    const tags = el('div', 'plant-layer-item-tags');
    for (const uid of layer.devices) {
      const node = getNodeByUid(uid);
      if (node) tags.appendChild(el('span', 'plant-tag', node.tag));
    }
    item.appendChild(tags);
    item.addEventListener('click', () => focusLayer(layer.id, true));
    layerList.appendChild(item);
  }
  layersBody.appendChild(layerList);
  stepsPanel.appendChild(layersBody);

  const layersFooter = el('div', 'plant-audit');
  layersBody.appendChild(layersFooter);
  page.appendChild(stepsPanel);

  /* ---------- 右侧信息卡 ---------- */
  const card = el('aside', 'plant-panel plant-card');
  card.style.display = 'none';
  page.appendChild(card);

  /* ---------- 图例 / 状态条 / 说明 ---------- */
  const consoleBar = el('div', 'plant-console');
  const consoleStep = el('span', 'plant-console-item', '当前工序：—');
  const consoleMedium = el('span', 'plant-console-item', '介质：—');
  const consoleFlow = el('span', 'plant-console-item', '流动：—');
  consoleBar.appendChild(consoleStep);
  consoleBar.appendChild(consoleMedium);
  consoleBar.appendChild(consoleFlow);
  page.appendChild(consoleBar);

  const legend = el('div', 'plant-legend');
  for (const m of Object.values(MEDIA)) {
    const item = el('span', 'plant-legend-item');
    item.title = m.desc;
    item.appendChild(mediumDot(m.id));
    item.appendChild(el('span', '', m.label));
    legend.appendChild(item);
  }
  const lineLegend = el('span', 'plant-legend-line');
  lineLegend.appendChild(el('span', 'plant-legend-linebar main'));
  lineLegend.appendChild(el('span', '', '主工艺'));
  legend.appendChild(lineLegend);
  const lineLegend2 = el('span', 'plant-legend-line');
  lineLegend2.appendChild(el('span', 'plant-legend-linebar utility'));
  lineLegend2.appendChild(el('span', '', '公用/支管'));
  legend.appendChild(lineLegend2);
  legend.appendChild(el('span', 'plant-legend-item', '→ 流向箭头 · ● 流动示踪'));
  page.appendChild(legend);

  /* ---------- 教学横幅 ---------- */
  const banner = el('div', 'plant-teach-banner');
  banner.style.display = 'none';
  const bannerHead = el('div', 'plant-teach-banner-head');
  const bannerLayer = el('span', 'plant-teach-layer', '');
  const bannerProgress = el('span', 'plant-teach-progress', '');
  bannerHead.appendChild(bannerLayer);
  bannerHead.appendChild(bannerProgress);
  const bannerTitle = el('div', 'plant-teach-title', '');
  const bannerDesc = el('p', 'plant-teach-desc', '');
  const bannerActions = el('div', 'plant-teach-actions');
  const prevBtn = button('上一步', 'plant-btn plant-btn-ghost', () => setTeachingIndex(Math.max(0, teachIndex - 1)), '上一道工序');
  const nextBtn = button('下一步', 'plant-btn plant-btn-ghost', () => setTeachingIndex(Math.min(PROCESS_STEPS.length - 1, teachIndex + 1)), '下一道工序');
  const resumeTeachBtn = button('继续自动播放', 'plant-btn plant-btn-ghost', () => applyTeachingStep());
  resumeTeachBtn.hidden = true;
  const exitTeachBtn = button('退出教学', 'plant-btn plant-btn-ghost', () => stopTeaching(), '退出教学模式');
  bannerActions.appendChild(prevBtn);
  bannerActions.appendChild(nextBtn);
  bannerActions.appendChild(resumeTeachBtn);
  bannerActions.appendChild(exitTeachBtn);
  banner.appendChild(bannerHead);
  banner.appendChild(bannerTitle);
  banner.appendChild(bannerDesc);
  banner.appendChild(bannerActions);
  page.appendChild(banner);

  /* ---------- 流程图面板 ---------- */
  const mapPanel = el('div', 'plant-panel plant-map');
  mapPanel.style.display = 'none';
  const mapHead = el('div', 'plant-panel-head');
  mapHead.appendChild(el('h2', '', '流程总览 PROCESS MAP'));
  const mapClose = button('×', 'plant-card-close', () => toggleMap(false), '关闭流程图');
  mapHead.appendChild(mapClose);
  mapPanel.appendChild(mapHead);
  const mapBody = el('div', 'plant-map-body');
  mapBody.appendChild(buildProcessMap());
  mapPanel.appendChild(mapBody);
  mapPanel.appendChild(el('p', 'plant-map-note', '实线可通，虚线受限或被截断，淡线无供给。点击管线看起终点和介质。塔顶分支默认无气源。'));
  page.appendChild(mapPanel);

  root.appendChild(page);

  /* ---------- 状态与场景 ---------- */
  let labelsOn = true;
  let currentUid: string | null = null;
  let currentPipeId: string | null = null;
  let currentTrace: { uid: string; dir: 'up' | 'down' | 'both'; result: TraceResult } | null = null;
  let teaching = false;
  let teachIndex = 0;
  let teachTimer = 0;
  let mapOpen = false;
  let activeTab: 'steps' | 'layers' = 'steps';

  const scene = new PlantScene(stage, {
    onSelectNode: (uid) => { currentUid = uid; renderCard(); },
    onSelectPipe: (pipeId) => { currentPipeId = pipeId; renderCard(); },
    onFlowsChanged: () => { updateStatusLine(); syncMapFlows(); if (currentUid || currentPipeId) renderCard(); }
  });

  setStepsOpen(false);
  mapBtn.setAttribute('aria-expanded', 'false');
  updateStatusLine();
  setActiveStep(PROCESS_STEPS[0]?.id ?? '');
  renderAuditPanel();

  const pageKeys = new AbortController();
  document.addEventListener('pointerdown', event => {
    if (more.open && event.target instanceof Node && !more.contains(event.target)) more.open = false;
  }, { signal: pageKeys.signal });
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.key !== 'Escape') return;
    if (more.open) { more.open = false; more.querySelector('summary')?.focus(); }
    else if (mapOpen) { toggleMap(false); mapBtn.focus(); }
    else if (card.style.display !== 'none') { closeCard(); stage.querySelector('canvas')?.focus(); }
    else if (page.classList.contains('steps-open')) { setStepsOpen(false); stepsToggle.focus(); }
    else if (teaching) { stopTeaching(); teachBtn.focus(); }
    else return;
    event.preventDefault();
  }, { signal: pageKeys.signal });

  function setStepsOpen(on: boolean) {
    page.classList.toggle('steps-open', on);
    stepsToggle.setAttribute('aria-expanded', String(on));
  }

  function closeCard() {
    scene.select(null);
    scene.selectPipe(null);
    currentUid = null;
    currentPipeId = null;
    currentTrace = null;
    scene.setTrace(null);
    card.style.display = 'none';
    if (teaching) banner.style.display = '';
  }

  function showCard() {
    if (matchMedia('(max-width: 1320px)').matches) {
      setStepsOpen(false);
      toggleMap(false);
    }
    card.style.display = '';
    if (teaching) {
      clearTimeout(teachTimer);
      banner.style.display = 'none';
      resumeTeachBtn.hidden = teachIndex >= PROCESS_STEPS.length - 1;
    }
  }

  function syncRun(now: boolean) {
    status.textContent = now ? '运行中' : '已暂停';
    status.classList.toggle('running', now);
    runBtn.classList.toggle('running', now);
    runBtn.querySelector('.plant-run-text')!.textContent = now ? '暂停运行' : '启动流程';
    runIcon.innerHTML = '';
    runIcon.appendChild(pathIcon(now ? ICONS.pause : ICONS.play));
    updateStatusLine();
  }

  function pathIcon(d: string): SVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '15');
    svg.setAttribute('height', '15');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return svg;
  }

  function updateStatusLine() {
    const step = PROCESS_STEPS.find((s) => s.id === activeStep);
    consoleStep.textContent = step ? `当前工序：${String(step.no).padStart(2, '0')} ${step.title}` : '当前工序：—';
    const medium = step ? primaryMediumOfStep(step.id) : null;
    consoleMedium.textContent = `介质：${medium ? MEDIA[medium].label : '—'}`;
    const running = scene.isRunning;
    const parts: string[] = [];
    parts.push(running ? 'RUNNING' : 'PAUSED');
    const closed = [...sceneValveStates()].filter(([, s]) => s === 'closed').length;
    if (closed) parts.push(`${closed} 台阀门关闭`);
    consoleFlow.textContent = `流动：${parts.join(' · ')}`;
  }

  function sceneValveStates(): Map<string, ValveState> {
    const map = new Map<string, ValveState>();
    for (const n of PLANT_NODES) if (isValveNode(n)) map.set(n.uid, scene.getValveState(n.uid));
    return map;
  }

  function primaryMediumOfStep(stepId: string): keyof typeof MEDIA | null {
    const step = PROCESS_STEPS.find((s) => s.id === stepId);
    if (!step) return null;
    for (const pid of step.pipes) {
      const pipe = PIPELINES.find((p) => p.id === pid);
      if (pipe && pipe.medium !== 'utility') return pipe.medium;
    }
    return null;
  }

  function setMode(mode: PlantViewMode) {
    scene.setMode(mode);
    for (const [id, b] of modeBtns) b.classList.toggle('active', id === mode);
  }

  function switchTab(tab: 'steps' | 'layers') {
    activeTab = tab;
    tabStepsBtn.classList.toggle('active', tab === 'steps');
    tabLayersBtn.classList.toggle('active', tab === 'layers');
    stepsBody.style.display = tab === 'steps' ? '' : 'none';
    layersBody.style.display = tab === 'layers' ? '' : 'none';
    if (tab === 'layers') renderAuditPanel();
  }

  function setActiveStep(id: string) {
    activeStep = id;
    for (const [sid, li] of stepItems) li.classList.toggle('active', sid === id);
    updateStatusLine();
  }

  /* ---------- 选择与追踪 ---------- */
  function resetFocusState() {
    currentTrace = null;
    scene.setTrace(null);
    scene.setStepFocus(null);
    scene.setLayerFocus(null);
  }

  function selectDevice(uid: string) {
    resetFocusState();
    scene.select(uid);
    scene.focusNode(uid);
    showCard();
  }

  function selectPipe(pipeId: string) {
    resetFocusState();
    scene.selectPipe(pipeId);
    scene.focusPipe(pipeId);
    showCard();
  }

  function focusStep(stepId: string, fromPanel: boolean) {
    if (teaching && fromPanel) setTeachingIndex(PROCESS_STEPS.findIndex((s) => s.id === stepId));
    scene.select(null);
    currentTrace = null;
    scene.setTrace(null);
    scene.setLayerFocus(null);
    scene.setStepFocus(stepId);
    scene.focusStep(stepId);
    setActiveStep(stepId);

  }

  function focusLayer(layerId: LayerId, fromPanel: boolean) {
    if (teaching) stopTeaching();
    scene.select(null);
    currentTrace = null;
    scene.setTrace(null);
    scene.setStepFocus(null);
    scene.setLayerFocus(layerId);
    scene.focusLayer(layerId);
    const step = PROCESS_STEPS.find((s) => s.layer === layerId);
    if (step) setActiveStep(step.id);
    if (fromPanel) renderLayerCard(layerId);
  }

  function clearAllFocus() {
    stopTeaching();
    scene.select(null);
    currentUid = null;
    currentPipeId = null;
    currentTrace = null;
    scene.setTrace(null);
    scene.setStepFocus(null);
    scene.setLayerFocus(null);
    card.style.display = 'none';
    setActiveStep('');
  }

  function applyTrace(uid: string, dir: 'up' | 'down' | 'both') {
    const result = traceFrom(uid, dir);
    currentTrace = { uid, dir, result };
    scene.setTrace(result);
    renderCard();
  }

  /* ---------- 信息卡 ---------- */
  function renderCard() {
    card.innerHTML = '';
    objectTitle.textContent = currentPipeId ?? (currentUid ? getNodeByUid(currentUid)?.tag ?? '' : '');
    if (currentPipeId) { renderPipeCard(currentPipeId); return; }
    if (!currentUid) {
      card.style.display = 'none';
      if (teaching) banner.style.display = '';
      return;
    }
    const node = getNodeByUid(currentUid);
    if (!node) { card.style.display = 'none'; return; }
    showCard();
    renderNodeCard(node);
  }

  function cardHead(tag: string, color?: string) {
    const head = el('div', 'plant-card-head');
    const tagEl = el('span', 'plant-card-tag', tag);
    if (color) { tagEl.style.color = color; tagEl.style.borderColor = `${color}66`; }
    head.appendChild(tagEl);
    const close = button('×', 'plant-card-close', closeCard, '关闭信息卡');
    head.appendChild(close);
    return head;
  }

  function metaRow(layerId: LayerId, stepTitle: string) {
    const layer = getLayer(layerId);
    const row = el('div', 'plant-card-meta');
    const badge = el('span', 'plant-layer-chip', `${layer.id} ${layer.short}`);
    badge.style.color = hex(layer.color);
    badge.style.borderColor = `${hex(layer.color)}66`;
    row.appendChild(badge);
    row.appendChild(el('span', 'plant-card-step', stepTitle));
    return row;
  }

  function traceResultBlock(uid: string) {
    if (!currentTrace || currentTrace.uid !== uid) return null;
    const { dir, result } = currentTrace;
    const block = el('div', 'plant-card-block plant-trace-result');
    const label = dir === 'up' ? '上游追踪结果' : dir === 'down' ? '下游追踪结果' : '完整路径';
    block.appendChild(el('h3', '', label));
    const tags = [...result.nodes]
      .map((n) => getNodeByUid(n))
      .filter((n): n is PlantNodeDef => !!n)
      .sort((a, b) => {
        const sa = PROCESS_STEPS.findIndex((s) => s.id === a.step);
        const sb = PROCESS_STEPS.findIndex((s) => s.id === b.step);
        return sa - sb;
      });
    const wrap = el('div', 'plant-tag-wrap');
    for (const n of tags) {
      const chip = button(`${n.tag}`, 'plant-tag chip', () => selectDevice(n.uid));
      chip.title = n.label;
      wrap.appendChild(chip);
    }
    block.appendChild(wrap);
    block.appendChild(el('p', 'plant-card-note', `涉及 ${result.nodes.size} 台设备 · ${result.pipes.size} 根管线。高亮范围见三维场景。`));
    return block;
  }

  const scenarioControls: Readonly<Record<string, { key: keyof PlantScenario; label: string; note: string }>> = {
    'T-101': { key: 'feedAvailable', label: '原料罐内有料', note: '空罐时，吸入侧无新料。本示意的停泵状态不计重力倒流或旁通。' },
    'T-102': { key: 'towerGasDemo', label: '启用独立塔顶原理观察', note: '气源、塔用途和推动相变的热量待确认。独立观察从塔顶管线演示假设气相，不从原料液产生气体。' },
    'E-101': { key: 'preheatMedium', label: '预热器热媒可用', note: '关闭热媒会使 PL-116 和 PL-116R 停止示踪，工艺侧仍可通行。预热量与温差待确认。' },
    'E-102': { key: 'coolingWater', label: '冷却器冷却水可用', note: '关闭冷却水会使 PL-117 和 PL-117R 停止示踪，壳程物料仍可通行。出口温度待确认。' },
    'E-103': { key: 'condenserWater', label: '冷凝器冷却水可用', note: '观察两侧通路。失去冷却水时，暂停下游冷凝分离示踪，出口工况待资料确认。' },
    'P-103': { key: 'recoveryAir', label: '独立示意气源可用', note: '本装置没有把 C-101 的 PL-119 接到回收泵。独立气源用作驱动条件。' }
  };

  function scenarioControl(uid: string) {
    const spec = scenarioControls[uid];
    if (!spec) return null;
    const wrap = el('div', 'plant-card-section');
    const label = el('label', 'plant-scenario-control');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = scene.scenarioState[spec.key];
    input.dataset.scenario = spec.key;
    input.addEventListener('change', () => {
      scene.setScenario(spec.key, input.checked);
      card.querySelector<HTMLInputElement>('[data-scenario=' + spec.key + ']')?.focus();
    });
    label.append(input, el('span', '', spec.label));
    wrap.append(label, el('p', 'plant-card-note', spec.note));
    return wrap;
  }

  function renderNodeCard(node: PlantNodeDef) {
    card.appendChild(cardHead(node.tag));
    card.appendChild(el('h2', 'plant-card-title', node.label));
    const device = deviceOfNode(node);
    card.appendChild(el('p', 'plant-card-device', `设备类型：${device.name} · ${device.categoryLabel}`));
    const step = stepOfNode(node);
    card.appendChild(metaRow(node.layer, `${step.no}. ${step.title}`));

    const role = el('div', 'plant-card-block');
    role.appendChild(el('h3', '', '在流程中的作用'));
    role.appendChild(el('p', '', node.role));
    card.appendChild(role);

    const condition = scenarioControl(node.uid);
    if (condition) card.appendChild(condition);
    const equipment = scene.getEquipmentStatus(node.uid);
    if (equipment) {
      const pneumatic = PLANT_EQUIPMENT_CONTROLS[node.uid] === 'air';
      const control = el('div', 'plant-card-block');
      control.appendChild(el('h3', '', '单设备控制'));
      const cmd = button(pneumatic ? (equipment.enabled ? '关闭示意供气' : '接通示意供气')
        : (equipment.enabled ? '停止设备' : '启动设备'), 'btn btn-outline btn-sm plant-equipment-command', () => {
        scene.setEquipmentCommand(node.uid, !equipment.enabled);
        card.querySelector<HTMLButtonElement>('.plant-equipment-command')?.focus();
      });
      control.append(cmd, el('p', 'plant-card-note plant-equipment-status', equipment.description));
      if (pneumatic) control.appendChild(el('p', 'plant-card-note', '采用独立示意气源。实际供气接管与条件待确认。'));
      card.appendChild(control);
    }

    if (node.inline) {
      const host = getPipe(node.inline.pipe);
      const hostBlock = el('div', 'plant-card-block');
      hostBlock.appendChild(el('h3', '', '安装位置'));
      const line = el('p', 'plant-card-line');
      line.appendChild(mediumDot(host.medium));
      line.appendChild(el('span', '', `${host.id} ${host.name} · ${PIPE_SIZES[host.size].label}`));
      hostBlock.appendChild(line);
      hostBlock.appendChild(el('p', 'plant-card-note', '内联安装：无独立基础，随管线走向定位。'));
      card.appendChild(hostBlock);

      if (node.inline.valve) {
        const operation = VALVE_OPERATIONS[node.inline.valve];
        const valveBlock = el('div', 'plant-card-block');
        valveBlock.appendChild(el('h3', '', '阀门状态（影响流动）'));
        const states = el('div', 'plant-valve-states');
        operation.commands.forEach((state) => {
          const b = button(VALVE_STATE_LABEL[state], `plant-valve-btn is-${state}`, () => {
            scene.setValveState(node.uid, state);
            card.querySelector<HTMLButtonElement>('.plant-valve-btn.active')?.focus();
          });
          if (scene.getValveState(node.uid) === state) b.classList.add('active');
          states.appendChild(b);
        });
        if (operation.commands.length) valveBlock.appendChild(states);
        valveBlock.appendChild(el('p', 'plant-card-note', operation.description));
        const flow = scene.getPipeFlow(host.id);
        const flowText = scene.getValveState(node.uid) === 'closed'
          ? node.inline.valve === 'check'
            ? '当前 CLOSED：止回阀已回座。'
            : `当前 CLOSED：${host.id} 的正向流动在此阀处停止。`
          : scene.getValveState(node.uid) === 'partial'
            ? `当前 PARTIAL：${host.id} 节流运行，本管线与下游流速降低。`
            : flow?.state === 'off'
              ? `${host.id} 当前无正向供料。`
              : `当前 OPEN：${host.id} 阀口允许正向流动。`;
        valveBlock.appendChild(el('p', 'plant-card-note', flowText));
        if (!flow) valveBlock.appendChild(el('p', 'plant-card-note', '该管线尚未构建。'));
        card.appendChild(valveBlock);
      }
    } else {
      const portsBlock = el('div', 'plant-card-block');
      portsBlock.appendChild(el('h3', '', '设备接口与连接'));
      const list = el('ul', 'plant-port-list');
      for (const port of node.ports) {
        const links = PIPELINES.filter((p) =>
          (p.from.type === 'port' && p.from.node === node.uid && p.from.port === port.id) ||
          (p.to.type === 'port' && p.to.node === node.uid && p.to.port === port.id)
        );
        const li = el('li', 'plant-port-row');
        const dir = el('span', `plant-port-dir ${port.role}`, port.role === 'in' ? '入口' : port.role === 'out' ? '出口' : '接口');
        li.appendChild(dir);
        li.appendChild(el('span', 'plant-port-name', port.name));
        if (!links.length) {
          li.appendChild(el('span', 'plant-port-unused', '未接入 / 备用'));
        } else {
          const linksWrap = el('span', 'plant-port-links');
          for (const p of links) {
            const chip = button(`${p.id} ${MEDIA[p.medium].label}`, 'plant-chip', () => selectPipe(p.id));
            chip.title = `${p.id} ${p.name} → ${peerOf(p, p.to.type === 'port' && p.to.node === node.uid ? 'from' : 'to')}`;
            linksWrap.appendChild(chip);
          }
          li.appendChild(linksWrap);
        }
        list.appendChild(li);
      }
      portsBlock.appendChild(list);
      card.appendChild(portsBlock);

      const neighbors = directNeighbors(node.uid);
      const neighBlock = el('div', 'plant-card-block');
      neighBlock.appendChild(el('h3', '', '上下游（直接连接）'));
      neighBlock.appendChild(neighborRow('上游', neighbors.up));
      neighBlock.appendChild(neighborRow('下游', neighbors.down));
      card.appendChild(neighBlock);
    }

    const internals = el('div', 'plant-card-block');
    internals.appendChild(el('h3', '', '设备内部（透明视图可见）'));
    internals.appendChild(el('p', '', node.internals));
    card.appendChild(internals);

    const traced = traceResultBlock(node.uid);
    if (traced) card.appendChild(traced);

    const acts = el('div', 'plant-card-actions');
    acts.appendChild(button('定位视角', 'plant-btn plant-btn-ghost', () => scene.focusNode(node.uid)));
    if (!node.inline) {
      acts.appendChild(button('追踪上游', 'plant-btn plant-btn-ghost', () => applyTrace(node.uid, 'up')));
      acts.appendChild(button('追踪下游', 'plant-btn plant-btn-ghost', () => applyTrace(node.uid, 'down')));
      acts.appendChild(button('完整路径', 'plant-btn plant-btn-ghost', () => applyTrace(node.uid, 'both')));
    } else {
      acts.appendChild(button('选中所在管线', 'plant-btn plant-btn-ghost', () => selectPipe(node.inline!.pipe)));
      acts.appendChild(button('完整路径', 'plant-btn plant-btn-ghost', () => applyTrace(node.uid, 'both')));
    }
    const xrayInline = el('button', 'plant-btn plant-btn-ghost', '内部视图：开/关');
    xrayInline.type = 'button';
    xrayInline.addEventListener('click', () => {
      const on = !scene.xrayEnabled;
      scene.setXray(on);
      xrayBtn.textContent = `内部视图：${on ? '开' : '关'}`;
      xrayBtn.classList.toggle('active', on);
    });
    acts.appendChild(xrayInline);
    const link = document.createElement('a');
    link.className = 'plant-btn plant-btn-primary';
    link.href = `#/device/${device.id}`;
    link.textContent = '进入设备工作台 →';
    link.title = '在零件级工作台中学习这台设备';
    link.addEventListener('click', event => openSceneDevice(event, device.id, captureNavigation()));
    acts.appendChild(link);
    card.appendChild(acts);

    card.appendChild(el('p', 'plant-card-note', '设备模型与流程职责为教学示意，接口位置按教学模型标注。'));
    if (!teaching) setActiveStep(node.step);
  }

  function neighborRow(label: string, neighbors: { uid: string; viaPipe: string }[]) {
    const row = el('div', 'plant-neighbor-row');
    row.appendChild(el('span', 'plant-neighbor-label', label));
    if (!neighbors.length) { row.appendChild(el('span', 'plant-neighbor-none', '无（外部接管/端点）')); return row; }
    const wrap = el('span', 'plant-neighbor-tags');
    for (const n of neighbors) {
      const node = getNodeByUid(n.uid);
      if (!node) continue;
      const chip = button(`${node.tag} ${node.label}`, 'plant-tag chip', () => selectDevice(n.uid));
      chip.title = `经 ${n.viaPipe}`;
      wrap.appendChild(chip);
    }
    row.appendChild(wrap);
    return row;
  }

  function directNeighbors(uid: string): { up: { uid: string; viaPipe: string }[]; down: { uid: string; viaPipe: string }[] } {
    const node = getNodeByUid(uid);
    if (node?.inline) {
      const host = getPipe(node.inline.pipe);
      const up = host.from.type === 'port' ? [{ uid: host.from.node, viaPipe: host.id }] : [];
      const down = host.to.type === 'port' ? [{ uid: host.to.node, viaPipe: host.id }] : [];
      return { up, down };
    }
    const up = PIPELINES.filter((p) => p.to.type === 'port' && p.to.node === uid && p.from.type === 'port')
      .map((p) => ({ uid: (p.from as { node: string }).node, viaPipe: p.id }));
    const down = PIPELINES.filter((p) => p.from.type === 'port' && p.from.node === uid && p.to.type === 'port')
      .map((p) => ({ uid: (p.to as { node: string }).node, viaPipe: p.id }));
    return { up, down };
  }

  function renderPipeCard(pipeId: string) {
    const pipe = getPipe(pipeId);
    showCard();
    card.appendChild(cardHead(pipe.id, hex(MEDIA[pipe.medium].color)));
    card.appendChild(el('h2', 'plant-card-title', pipe.name));
    const mediumRow = el('p', 'plant-card-device');
    mediumRow.appendChild(mediumDot(pipe.medium));
    mediumRow.appendChild(el('span', '', ` 介质：${mediumLabel(pipe.medium)} · ${phaseLabel(pipe.medium)}`));
    card.appendChild(mediumRow);
    const flow = scene.getPipeFlow(pipe.id);
    if (flow) card.appendChild(el('p', 'plant-card-note plant-path-condition', teachingFlowLabel(flow)));

    const layer = getLayer(pipe.layer);
    const meta = el('div', 'plant-card-meta');
    const badge = el('span', 'plant-layer-chip', `${layer.id} ${layer.short}`);
    badge.style.color = hex(layer.color);
    badge.style.borderColor = `${hex(layer.color)}66`;
    meta.appendChild(badge);
    meta.appendChild(el('span', 'plant-card-step', PIPE_SIZES[pipe.size].label));
    card.appendChild(meta);

    const route = el('div', 'plant-card-block');
    route.appendChild(el('h3', '', '起点 → 终点'));
    const start = el('p', 'plant-card-line');
    start.appendChild(el('span', 'plant-port-dir out', '起'));
    start.appendChild(el('span', '', endpointText(pipe.from)));
    if (pipe.from.type === 'port') {
      const chip = button('定位设备', 'plant-chip', () => selectDevice((pipe.from as { node: string }).node));
      start.appendChild(chip);
    }
    route.appendChild(start);
    const end = el('p', 'plant-card-line');
    end.appendChild(el('span', 'plant-port-dir in', '终'));
    end.appendChild(el('span', '', endpointText(pipe.to)));
    if (pipe.to.type === 'port') {
      const chip = button('定位设备', 'plant-chip', () => selectDevice((pipe.to as { node: string }).node));
      end.appendChild(chip);
    }
    route.appendChild(end);
    card.appendChild(route);

    const sizeBlock = el('div', 'plant-card-block');
    sizeBlock.appendChild(el('h3', '', '管线参数（教学示意）'));
    sizeBlock.appendChild(el('p', '', `管径等级：${PIPE_SIZES[pipe.size].label}。${PIPE_SIZES[pipe.size].note}。`));
    if (pipe.note) sizeBlock.appendChild(el('p', 'plant-card-note', pipe.note));
    card.appendChild(sizeBlock);

    const valves = valvesOfPipe(pipe.id);
    if (valves.length) {
      const block = el('div', 'plant-card-block');
      block.appendChild(el('h3', '', '线上阀门'));
      const wrap = el('div', 'plant-tag-wrap');
      for (const v of valves) {
        const state = scene.getValveState(v.uid);
        const chip = button(`${v.tag} ${VALVE_STATE_LABEL[state]}`, `plant-tag chip valve is-${state}`, () => selectDevice(v.uid));
        chip.title = v.label;
        wrap.appendChild(chip);
      }
      block.appendChild(wrap);
      card.appendChild(block);
    }

    const instruments = instrumentsOfPipe(pipe.id);
    if (instruments.length) {
      const block = el('div', 'plant-card-block');
      block.appendChild(el('h3', '', '线上仪表（演示，不显示读数）'));
      for (const inst of instruments) block.appendChild(el('p', 'plant-card-line', `${inst.tag} · ${inst.name} —— ${inst.note}`));
      card.appendChild(block);
    }

    const inline = inlineNodesOfPipe(pipe.id).filter((n) => !isValveNode(n));
    if (inline.length) {
      const block = el('div', 'plant-card-block');
      block.appendChild(el('h3', '', '线上设备'));
      const wrap = el('div', 'plant-tag-wrap');
      for (const n of inline) wrap.appendChild(button(`${n.tag} ${n.label}`, 'plant-tag chip', () => selectDevice(n.uid)));
      block.appendChild(wrap);
      card.appendChild(block);
    }

    const acts = el('div', 'plant-card-actions');
    acts.appendChild(button('定位管线', 'plant-btn plant-btn-ghost', () => scene.focusPipe(pipe.id)));
    acts.appendChild(button('上游追踪', 'plant-btn plant-btn-ghost', () => tracePipe(pipe, 'up')));
    acts.appendChild(button('下游追踪', 'plant-btn plant-btn-ghost', () => tracePipe(pipe, 'down')));
    acts.appendChild(button('完整路径', 'plant-btn plant-btn-ghost', () => tracePipe(pipe, 'both')));
    card.appendChild(acts);
    card.appendChild(el('p', 'plant-card-note', '管线走向、管径等级与介质颜色均为教学示意，不代表施工设计。'));
  }

  function tracePipe(pipe: PipelineDef, dir: 'up' | 'down' | 'both') {
    const result: TraceResult = { nodes: new Set(), pipes: new Set([pipe.id]) };
    for (const n of inlineNodesOfPipe(pipe.id)) result.nodes.add(n.uid);
    if (pipe.from.type === 'port') {
      result.nodes.add(pipe.from.node);
      if (dir === 'up' || dir === 'both') mergeTrace(result, traceFrom(pipe.from.node, 'up'));
    }
    if (pipe.to.type === 'port') {
      result.nodes.add(pipe.to.node);
      if (dir === 'down' || dir === 'both') mergeTrace(result, traceFrom(pipe.to.node, 'down'));
    }
    scene.setTrace(result);
    currentTrace = null;
    // 管线追踪结果直接显示在管线卡上
    const old = card.querySelector('.plant-trace-result');
    if (old) old.remove();
    const block = el('div', 'plant-card-block plant-trace-result');
    const label = dir === 'up' ? '上游追踪结果' : dir === 'down' ? '下游追踪结果' : '完整路径';
    block.appendChild(el('h3', '', label));
    const wrap = el('div', 'plant-tag-wrap');
    for (const uid of result.nodes) {
      const node = getNodeByUid(uid);
      if (!node) continue;
      wrap.appendChild(button(node.tag, 'plant-tag chip', () => selectDevice(uid)));
    }
    block.appendChild(wrap);
    block.appendChild(el('p', 'plant-card-note', `涉及 ${result.nodes.size} 台设备 · ${result.pipes.size} 根管线。`));
    const actions = card.querySelector('.plant-card-actions');
    if (actions) card.insertBefore(block, actions);
    else card.appendChild(block);
  }

  function mergeTrace(target: TraceResult, source: TraceResult) {
    for (const n of source.nodes) target.nodes.add(n);
    for (const p of source.pipes) target.pipes.add(p);
  }

  function renderLayerCard(layerId: LayerId) {
    const layer = getLayer(layerId);
    card.innerHTML = '';
    showCard();
    card.appendChild(cardHead(layer.id, hex(layer.color)));
    card.appendChild(el('h2', 'plant-card-title', layer.name));
    card.appendChild(el('p', 'plant-card-device', `工艺层 ${layer.id} · ${layer.devices.length} 台设备`));
    const block = (title: string, text: string) => {
      const b = el('div', 'plant-card-block');
      b.appendChild(el('h3', '', title));
      b.appendChild(el('p', '', text));
      card.appendChild(b);
    };
    block('本层作用', layer.function);
    block('输入', layer.input);
    block('主要过程', layer.process);
    block('输出', layer.output);
    const dev = el('div', 'plant-card-block');
    dev.appendChild(el('h3', '', '关键设备'));
    const wrap = el('div', 'plant-tag-wrap');
    for (const uid of layer.devices) {
      const node = getNodeByUid(uid);
      if (node) wrap.appendChild(button(`${node.tag} ${node.label}`, 'plant-tag chip', () => selectDevice(uid)));
    }
    dev.appendChild(wrap);
    card.appendChild(dev);
    const acts = el('div', 'plant-card-actions');
    acts.appendChild(button('聚焦本层', 'plant-btn plant-btn-primary', () => focusLayer(layerId, false)));
    acts.appendChild(button('全部显示', 'plant-btn plant-btn-ghost', () => clearAllFocus()));
    card.appendChild(acts);
    card.appendChild(el('p', 'plant-card-note', '工艺层为教学分层：L0–L6 表示流程阶段，不是建筑楼层。地面分区与标高均为示意。'));
    setActiveStep(PROCESS_STEPS.find((s) => s.layer === layerId)?.id ?? '');
  }

  /* ---------- 教学 ---------- */
  function toggleTeaching() {
    if (teaching) stopTeaching();
    else startTeaching();
  }

  function startTeaching(index = 0) {
    teaching = true;
    teachIndex = Math.max(0, Math.min(PROCESS_STEPS.length - 1, index));
    teachBtn.textContent = '退出教学';
    teachBtn.classList.add('running');
    banner.style.display = '';
    scene.start();
    syncRun(true);
    card.style.display = 'none';
    applyTeachingStep();
  }

  function stopTeaching() {
    if (!teaching) return;
    teaching = false;
    clearTimeout(teachTimer);
    teachBtn.textContent = '开始教学';
    teachBtn.classList.remove('running');
    banner.style.display = 'none';
    scene.setStepFocus(null);
    setActiveStep('');
  }

  function applyTeachingStep() {
    const step = PROCESS_STEPS[teachIndex];
    if (!step) return;
    banner.style.display = '';
    resumeTeachBtn.hidden = true;
    scene.select(null);
    currentUid = null;
    currentPipeId = null;
    currentTrace = null;
    card.style.display = 'none';
    scene.setTrace(null);
    scene.setLayerFocus(null);
    scene.setStepFocus(step.id);
    scene.focusStep(step.id);
    setActiveStep(step.id);
    const layer = getLayer(step.layer);
    bannerLayer.textContent = `${layer.id} ${layer.name}`;
    bannerLayer.style.color = hex(layer.color);
    bannerProgress.textContent = `教学 ${step.no} / ${PROCESS_STEPS.length}`;
    bannerTitle.textContent = `${String(step.no).padStart(2, '0')} ${step.title}`;
    bannerDesc.textContent = step.desc;
    prevBtn.toggleAttribute('disabled', teachIndex === 0);
    nextBtn.toggleAttribute('disabled', teachIndex === PROCESS_STEPS.length - 1);
    stepItems.get(step.id)?.scrollIntoView({ block: 'nearest' });
    clearTimeout(teachTimer);
    if (teachIndex < PROCESS_STEPS.length - 1) {
      teachTimer = window.setTimeout(() => {
        if (!teaching) return;
        teachIndex += 1;
        applyTeachingStep();
      }, TEACH_MS);
    }
  }

  function setTeachingIndex(index: number) {
    teachIndex = Math.max(0, Math.min(PROCESS_STEPS.length - 1, index));
    if (!teaching) startTeaching(teachIndex);
    else applyTeachingStep();
  }

  /* ---------- 自检 ---------- */
  function renderAuditPanel() {
    layersFooter.innerHTML = '';
    const audit = scene.audit();
    const head = el('div', 'plant-audit-head');
    head.appendChild(el('span', '', '流程自检'));
    const ok = audit.issues.length === 0;
    const badge = el('span', `plant-audit-badge ${ok ? 'ok' : 'warn'}`, ok ? 'PASS' : `${audit.issues.length} 问题`);
    head.appendChild(badge);
    layersFooter.appendChild(head);
    const grid = el('div', 'plant-audit-grid');
    const rows: [string, number][] = [
      ['设备连接率', audit.nodeConnection],
      ['管线完整率', audit.pipeIntegrity],
      ['流向完整率', audit.flowDirection],
      ['设备数据完整率', audit.nodeData],
      ['内部结构完整率', audit.internals],
      ['全开阀可达性', audit.flowReach]
    ];
    for (const [name, value] of rows) {
      const cell = el('div', 'plant-audit-cell');
      cell.appendChild(el('span', 'plant-audit-name', name));
      const val = el('span', `plant-audit-value ${value === 100 ? 'ok' : 'warn'}`, `${value}%`);
      cell.appendChild(val);
      grid.appendChild(cell);
    }
    layersFooter.appendChild(grid);
    if (!ok) {
      const details = el('details', 'plant-audit-issues');
      details.appendChild(el('summary', '', '查看自检问题'));
      for (const issue of audit.issues.slice(0, 12)) details.appendChild(el('p', '', `· ${issue}`));
      layersFooter.appendChild(details);
    }
    layersFooter.appendChild(el('p', 'plant-audit-note', `${audit.runtime.pipesBuilt} 根管线已构建 · ${audit.runtime.portsLinked} 个接口已接入 · 全部为教学示意数据`));
  }

  /* ---------- 流程图 ---------- */
  function buildProcessMap(): SVGSVGElement {
    const colW = 92, chipH = 20, chipGap = 5, headerH = 44, padX = 16;
    const maxRows = Math.max(...PROCESS_STEPS.map((s) => s.nodes.length));
    const height = headerH + maxRows * (chipH + chipGap) + 56;
    const width = padX * 2 + PROCESS_STEPS.length * colW;
    const svg = svgEl('svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.classList.add('plant-map-svg');
    const marker = svgEl('marker');
    marker.setAttribute('id', 'plant-map-arrow');
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '8');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '5');
    marker.setAttribute('markerHeight', '5');
    marker.setAttribute('orient', 'auto-start-reverse');
    const arrowPath = svgEl('path');
    arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
    arrowPath.setAttribute('fill', '#5b7894');
    marker.appendChild(arrowPath);
    svg.appendChild(marker);

    const xOf = (index: number) => padX + index * colW + colW / 2;

    /* 工序 → 设备 → 层色 */
    PROCESS_STEPS.forEach((step, index) => {
      const layer = getLayer(step.layer);
      const x = xOf(index);
      const header = svgEl('text');
      header.setAttribute('x', String(x));
      header.setAttribute('y', '16');
      header.setAttribute('text-anchor', 'middle');
      header.setAttribute('fill', '#9fb3c8');
      header.setAttribute('font-size', '10');
      header.textContent = `${String(step.no).padStart(2, '0')} ${step.title.slice(0, 5)}`;
      svg.appendChild(header);
      const layerText = svgEl('text');
      layerText.setAttribute('x', String(x));
      layerText.setAttribute('y', '30');
      layerText.setAttribute('text-anchor', 'middle');
      layerText.setAttribute('fill', hex(layer.color));
      layerText.setAttribute('font-size', '9');
      layerText.textContent = layer.id;
      svg.appendChild(layerText);
      step.nodes.forEach((uid, row) => {
        const node = getNodeByUid(uid);
        if (!node) return;
        const y = headerH + row * (chipH + chipGap);
        const groupEl = svgEl('g');
        groupEl.setAttribute('class', 'plant-map-node');
        groupEl.setAttribute('data-uid', uid);
        groupEl.style.cursor = 'pointer';
        const rect = svgEl('rect');
        rect.setAttribute('x', String(x - 36));
        rect.setAttribute('y', String(y));
        rect.setAttribute('width', '72');
        rect.setAttribute('height', String(chipH));
        rect.setAttribute('rx', '5');
        rect.setAttribute('fill', '#0e1c2b');
        rect.setAttribute('stroke', `${hex(layer.color)}99`);
        groupEl.appendChild(rect);
        const text = svgEl('text');
        text.setAttribute('x', String(x));
        text.setAttribute('y', String(y + 14));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', '#dbe7f3');
        text.setAttribute('font-size', '9.5');
        text.textContent = node.tag;
        groupEl.appendChild(text);
        const title = svgEl('title');
        title.textContent = `${node.tag} ${node.label}（${step.title}）`;
        groupEl.appendChild(title);
        groupEl.addEventListener('click', () => {
          selectDevice(uid);
          toggleMap(false);
        });
        svg.appendChild(groupEl);
      });
    });

    /* 工序级连线：由管线端点自动推导 */
    const pairs = new Map<string, { a: number; b: number; pipe: PipelineDef }>();
    for (const pipe of PIPELINES) {
      if (pipe.medium === 'utility') continue;
      if (pipe.from.type !== 'port' || pipe.to.type !== 'port') continue;
      const fromNode = getNodeByUid(pipe.from.node);
      const toNode = getNodeByUid(pipe.to.node);
      if (!fromNode || !toNode) continue;
      const a = PROCESS_STEPS.findIndex((s) => s.id === fromNode.step);
      const b = PROCESS_STEPS.findIndex((s) => s.id === toNode.step);
      if (a < 0 || b < 0) continue;
      const key = `${a}-${b}`;
      if (!pairs.has(key)) pairs.set(key, { a, b, pipe });
    }
    for (const pair of pairs.values()) {
      const x1 = xOf(pair.a) + 36;
      const x2 = xOf(pair.b) - 36;
      const backward = pair.b <= pair.a;
      const y = backward ? height - 18 : 36;
      const path = svgEl('path');
      if (backward) {
        const laneY = height - 18 - (pair.a % 2) * 8;
        path.setAttribute('d', `M ${x1} ${headerH + maxRows * (chipH + chipGap) + 4} C ${x1 + 16} ${laneY}, ${x2 - 16} ${laneY}, ${x2} ${headerH + maxRows * (chipH + chipGap) + 4}`);
      } else {
        path.setAttribute('d', `M ${x1} ${y - 14} C ${x1 + 12} ${y - 14}, ${x2 - 12} ${y - 14}, ${x2} ${y - 14}`);
      }
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', `${hex(MEDIA[pair.pipe.medium].color)}`);
      path.setAttribute('stroke-width', backward ? '1.2' : '1.6');
      path.setAttribute('marker-end', 'url(#plant-map-arrow)');
      path.classList.add('plant-map-route');
      path.dataset.pipe = pair.pipe.id;
      path.setAttribute('tabindex', '0');
      path.setAttribute('role', 'button');
      path.appendChild(svgEl('title'));
      const activate = () => { toggleMap(false); selectPipe(pair.pipe.id); };
      path.addEventListener('click', activate);
      path.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate();
      });
      svg.appendChild(path);
    }
    return svg;
  }

  function syncMapFlows() {
    for (const path of mapBody.querySelectorAll<SVGPathElement>('.plant-map-route')) {
      const id = path.dataset.pipe;
      if (!id) continue;
      const flow = scene.getPipeFlow(id);
      if (!flow) continue;
      path.dataset.flow = flow.state;
      path.dataset.restricted = String(flow.throttle);
      const tip = path.querySelector('title');
      const name = id + ' ' + getPipe(id).name + ' · ' + teachingFlowLabel(flow);
      if (tip) tip.textContent = name;
      path.setAttribute('aria-label', name);
    }
  }

  function toggleMap(force?: boolean) {
    mapOpen = force ?? !mapOpen;
    if (mapOpen && matchMedia('(max-width: 1320px)').matches) { setStepsOpen(false); closeCard(); }
    mapBtn.setAttribute('aria-expanded', String(mapOpen));
    mapPanel.style.display = mapOpen ? '' : 'none';
    mapBtn.classList.toggle('active', mapOpen);
    if (mapOpen) {
      mapBody.innerHTML = '';
      mapBody.appendChild(buildProcessMap());
      syncMapFlows();
    }
  }

  function captureNavigation(): PlantSnapshot {
    return {
      kind: 'plant', scene: scene.navigationState, labels: labelsOn, activeStep, tab: activeTab,
      teachIndex: teaching ? teachIndex : null,
      trace: currentTrace ? { uid: currentTrace.uid, dir: currentTrace.dir } : null
    };
  }

  const snapshot = sceneSnapshot() as PlantSnapshot | undefined;
  if (snapshot?.kind === 'plant') {
    if (snapshot.teachIndex !== null) startTeaching(snapshot.teachIndex);
    setMode(snapshot.scene.mode);
    switchTab(snapshot.tab);
    scene.restoreNavigation(snapshot.scene);
    if (snapshot.trace) applyTrace(snapshot.trace.uid, snapshot.trace.dir);
    labelsOn = snapshot.labels;
    scene.setLabelVisibility(labelsOn);
    labelBtn.textContent = labelsOn ? '名称标签：开' : '名称标签：关';
    xrayBtn.textContent = snapshot.scene.xray ? '内部视图：开' : '内部视图：关';
    xrayBtn.classList.toggle('active', snapshot.scene.xray);
    speedSel.value = String(snapshot.scene.speed);
    syncRun(snapshot.scene.running);
    setActiveStep(snapshot.activeStep);
  }

  /* ---------- 对外 API ---------- */
  const api = {
    nodeCount: PLANT_NODES.length,
    stepCount: PROCESS_STEPS.length,
    pipeCount: PIPELINES.length,
    layerCount: PROCESS_LAYERS.length,
    isRunning: () => scene.isRunning,
    get speed() { return scene.speed; },
    get selected() { return scene.selectedUid; },
    get selectedPipe() { return scene.selectedPipeId; },
    get mode() { return scene.viewMode; },
    start: () => { scene.start(); syncRun(true); },
    pause: () => { scene.pause(); syncRun(false); },
    toggle: () => { const now = scene.toggle(); syncRun(now); return now; },
    setSpeed: (v: number) => scene.setSpeed(v),
    select: (uid: string | null) => { if (uid) scene.select(uid); else scene.select(null); },
    selectPipe: (id: string | null) => { if (id) scene.selectPipe(id); else scene.selectPipe(null); },
    focusStep: (id: string) => scene.focusStep(id),
    focusNode: (uid: string) => scene.focusNode(uid),
    focusPipe: (id: string) => scene.focusPipe(id),
    focusLayer: (id: LayerId) => scene.focusLayer(id),
    resetView: (instant = false) => scene.fitView(instant),
    setMode: (mode: PlantViewMode) => setMode(mode),
    setXray: (on: boolean) => scene.setXray(on),
    valveState: (uid: string) => scene.getValveState(uid),
    setValveState: (uid: string, state: ValveState) => { scene.setValveState(uid, state); },
    pipeFlow: (id: string) => scene.getPipeFlow(id),
    scenario: () => scene.scenarioState,
    trace: (uid: string, dir: 'up' | 'down' | 'both') => {
      const result = traceFrom(uid, dir);
      scene.setTrace(result);
      return { nodes: [...result.nodes], pipes: [...result.pipes] };
    },
    clearFocus: () => clearAllFocus(),
    audit: () => scene.audit(),
    teaching: {
      start: () => startTeaching(),
      stop: () => stopTeaching(),
      next: () => setTeachingIndex(teachIndex + 1),
      prev: () => setTeachingIndex(teachIndex - 1),
      get active() { return teaching; },
      get index() { return teachIndex; }
    },
    debug: () => scene.debugState,
    screenPosition: (uid: string) => scene.screenPosition(uid)
  };
  (window as unknown as Record<string, unknown>).__plant = api;

  (root as HTMLElement & { __dispose?: () => void }).__dispose = () => {
    clearTimeout(teachTimer);
    pageKeys.abort();
    scene.dispose();
    if ('__plant' in window) delete (window as unknown as Record<string, unknown>).__plant;
  };
}
