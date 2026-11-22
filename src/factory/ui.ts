import { teachingFlowLabel } from '../process/teachingFlow';
import type { CoatingAction, CoatingRelease, CoatingMode } from '../process/coatingBatch';
import { FACTORY_EQUIPMENT_CONTROLS } from '../data/factory';
import { openSceneDevice, sceneSnapshot } from '../ui/sceneNavigation';
import { VALVE_OPERATIONS } from '../data/valveOperations';
import { siteNav } from '../ui/siteNav';
import { openRecordsDialog } from '../ui/dialogs';
import factorySourcesUrl from '../../docs/factory-process.md?url';
import './factory.css';
import { DEVICES } from '../data/devices';
import { assetsForDevice } from '../assets/registry';
import {
  FACTORY_META, FACTORY_NOTICE, FACTORY_ZONES, FACTORY_STEPS, FACTORY_NODES, FACTORY_PIPES,
  FACTORY_MEDIA, PIPE_SIZES, PROCEDURAL_INFO,
  catalogDeviceOfNode, getNodeByUid, getPipe, getJoint, getZone,
  pipesOfNode, valvesOfPipe, instrumentsOfPipe, jointsOfPipe, stepOfNode, zoneOfNode,
  downstreamTargets, upstreamTargets, traceFrom,
  type FactoryNodeDef, type FactoryPipelineDef
} from '../data/factory';
import { FactoryScene } from './scene';
import { createDiagram, type DiagramApi } from './diagram';
import { openDetailOverlay, type DetailOverlay } from './detail';
import { openPracticeOverlay, type PracticeOverlay } from './practice';
import {
  loadFactoryRecords, saveFactoryRecords, markVisited, resetTask, advanceTask,
  SAMPLE_TASK_STEPS, type FactoryRecords, type TaskEvent
} from './records';

/**
 * 三维教学工厂页面：厂区场景 + 工序/分区/搜索 + 设备卡片 + 教学流程图联动 +
 * 样板任务 + 设备细节 + 法兰练习 + 行走模式。全部路由在本页内处理（不重建场景）。
 */

type FactoryNavigationSnapshot = {
  kind: 'factory';
  scene: FactoryScene['navigationState'];
  tab: 'step' | 'zone' | 'search';
  query: string;
  directoryOpen?: boolean;
  task: boolean;
  diagramCollapsed: boolean;
  detail: { uid: string; before: {
    pos: [number, number, number]; target: [number, number, number]; selected?: string | null; pipe?: string | null;
  } | null } | null;
};

type AppRoot = HTMLElement & { __dispose?: () => void; __factory?: (hash: string) => void };

export function renderFactory(root: HTMLElement) {
  const app = root as AppRoot;
  app.innerHTML = '';
  app.classList.add('factory-root');

  const nav = siteNav('factory');
  app.appendChild(nav);

  const shell = document.createElement('div');
  shell.className = 'factory-shell';
  const stage = document.createElement('div');
  stage.className = 'factory-stage';
  shell.appendChild(stage);
  app.appendChild(shell);

  const records: FactoryRecords = loadFactoryRecords();
  let coatingMessage = '';
  const compactDirectory = matchMedia('(max-width: 1360px)');
  const narrowStage = matchMedia('(max-width: 900px)');

  /* ============================ 场景 ============================ */
  const scene = new FactoryScene(stage, {
    onSelectNode: (uid) => {
      if (uid && narrowStage.matches) setDirectoryOpen(false);
      if (uid) markVisited(records, uid);
      syncSelectionUI();
      renderInfo();
      emitTask({ type: 'select', uid: uid ?? undefined });
    },
    onSelectPipe: () => {
      if (scene.selectedPipeId && narrowStage.matches) setDirectoryOpen(false);
      syncSelectionUI();
      renderInfo();
    },
    onPortPick: (uid, portId) => handlePortPick(uid, portId),
    onJointPick: (jointId) => openPractice(jointId),
    onFlowsChanged: () => { syncDiagramFlows(); renderInfo(); },
    onWalkChange: (on) => {
      stage.classList.toggle('is-walk', on);
      walkBtn.classList.toggle('is-active', on);
      walkBtn.textContent = on ? '退出行走' : '行走模式';
      walkHud.hidden = !on;
    },
    onStatus: (text) => { if (text) toast(text); }
  });

  /* ============================ 工具条 ============================ */
  const topbar = document.createElement('div');
  topbar.className = 'factory-topbar';
  const titleBox = document.createElement('div');
  titleBox.className = 'factory-titlebox';
  const title = document.createElement('h1');
  title.textContent = FACTORY_META.name;
  const sub = document.createElement('div');
  sub.className = 'factory-subtitle';
  sub.textContent = `${FACTORY_META.subtitle} · 教学示意`;
  titleBox.appendChild(title);
  titleBox.appendChild(sub);
  const topActions = document.createElement('div');
  topActions.className = 'factory-top-actions';

  const taskBtn = mkBtn('样板任务', 'btn btn-primary', () => toggleTaskPanel());
  const walkBtn = mkBtn('行走模式', 'btn btn-outline', () => {
    if (scene.walkActive) scene.exitWalk(); else scene.enterWalk();
  });
  const frontBtn = mkBtn('前墙', 'btn btn-outline is-active', () => {
    const next = !scene.shellState.front;
    scene.setFrontWall(next);
    frontBtn.classList.toggle('is-active', next);
  }, '显示/隐藏厂房前墙（默认隐藏）');
  const roofBtn = mkBtn('屋顶', 'btn btn-outline is-active', () => {
    const next = !scene.shellState.roof;
    scene.setRoof(next);
    roofBtn.classList.toggle('is-active', next);
  }, '显示/隐藏屋顶（默认隐藏）');
  const labelBtn = mkBtn('标签', 'btn btn-outline is-active', () => {
    const on = !labelBtn.classList.contains('is-active');
    labelBtn.classList.toggle('is-active', on);
    scene.toggleLabels(on);
  });
  const resetBtn = mkBtn('全景', 'btn btn-outline', () => resetOverview());
  const directoryBtn = mkBtn('目录', 'btn btn-outline', () => {
    const open = left.hidden;
    if (open && narrowStage.matches) toggleTaskPanel(false);
    setDirectoryOpen(open);
    if (open) tabStep.focus({ preventScroll: true });
  }, '展开或收起厂区目录');
  directoryBtn.setAttribute('aria-controls', 'factory-directory');
  const more = document.createElement('details');
  more.className = 'factory-more';
  const moreTrigger = document.createElement('summary');
  moreTrigger.className = 'btn btn-outline';
  moreTrigger.textContent = '更多';
  const moreBody = document.createElement('div');
  moreBody.className = 'factory-more-body';
  const recBtn = mkBtn('本厂记录', 'btn btn-outline', () => {
    more.open = false;
    moreTrigger.focus({ preventScroll: true });
    openFactoryRecords();
  });
  const sourceLink = document.createElement('a');
  sourceLink.href = factorySourcesUrl;
  sourceLink.className = 'btn btn-outline';
  sourceLink.textContent = '工艺来源与适用范围';
  sourceLink.target = '_blank';
  sourceLink.rel = 'noopener';
  moreBody.append(frontBtn, roofBtn, labelBtn, recBtn, sourceLink, mkText('p', '', FACTORY_NOTICE));
  more.append(moreTrigger, moreBody);
  topActions.append(taskBtn, walkBtn, directoryBtn, resetBtn, more);
  topbar.appendChild(titleBox);
  topbar.appendChild(topActions);
  stage.appendChild(topbar);

  const notice = document.createElement('div');
  notice.className = 'factory-notice';
  notice.textContent = '厂区与设备操作为教学示意，适用范围见「更多」。';
  shell.appendChild(notice);

  /* ============================ 左面板 ============================ */
  const left = document.createElement('aside');
  left.className = 'factory-left';
  left.id = 'factory-directory';
  const tabs = document.createElement('div');
  tabs.className = 'factory-tabs';
  const tabStep = mkBtn('工序', 'factory-tab is-active', () => setLeftTab('step'));
  const tabZone = mkBtn('分区', 'factory-tab', () => setLeftTab('zone'));
  const tabSearch = mkBtn('搜索', 'factory-tab', () => setLeftTab('search'));
  tabs.appendChild(tabStep);
  tabs.appendChild(tabZone);
  tabs.appendChild(tabSearch);
  const leftBody = document.createElement('div');
  leftBody.className = 'factory-left-body';
  left.appendChild(tabs);
  left.appendChild(leftBody);
  stage.appendChild(left);
  function setDirectoryOpen(open: boolean) {
    const restoreFocus = !open && left.contains(document.activeElement);
    left.hidden = !open;
    directoryBtn.setAttribute('aria-expanded', String(open));
    if (restoreFocus) directoryBtn.focus({ preventScroll: true });
  }
  setDirectoryOpen(!compactDirectory.matches);
  const uiEvents = new AbortController();
  compactDirectory.addEventListener('change', () => setDirectoryOpen(!compactDirectory.matches), { signal: uiEvents.signal });
  document.addEventListener('pointerdown', event => {
    if (more.open && event.target instanceof Node && !more.contains(event.target)) more.open = false;
  }, { signal: uiEvents.signal });
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (more.open) {
      more.open = false;
      moreTrigger.focus({ preventScroll: true });
    } else if (!left.hidden && (document.activeElement === directoryBtn || left.contains(document.activeElement))) {
      setDirectoryOpen(false);
      directoryBtn.focus({ preventScroll: true });
    } else return;
    event.preventDefault();
  }, { signal: uiEvents.signal });

  let leftTab: 'step' | 'zone' | 'search' = 'step';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'factory-search-input';
  searchInput.placeholder = '搜索设备位号 / 名称 / 管线编号…';
  const searchResults = document.createElement('div');
  searchResults.className = 'factory-search-results';

  function setLeftTab(tab: 'step' | 'zone' | 'search') {
    leftTab = tab;
    tabStep.classList.toggle('is-active', tab === 'step');
    tabZone.classList.toggle('is-active', tab === 'zone');
    tabSearch.classList.toggle('is-active', tab === 'search');
    renderLeft();
    if (tab === 'search') searchInput.focus();
  }

  function renderLeft() {
    leftBody.textContent = '';
    if (leftTab === 'step') {
      for (const step of FACTORY_STEPS) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'factory-step-item';
        item.dataset.step = step.id;
        const no = document.createElement('span');
        no.className = 's-no';
        no.textContent = String(step.no).padStart(2, '0');
        const body = document.createElement('span');
        body.className = 's-body';
        const t = document.createElement('span');
        t.className = 's-title';
        t.textContent = step.title;
        const d = document.createElement('span');
        d.className = 's-desc';
        d.textContent = step.desc;
        body.appendChild(t);
        body.appendChild(d);
        item.appendChild(no);
        item.appendChild(body);
        item.addEventListener('click', () => {
          leftBody.querySelectorAll('.factory-step-item').forEach((x) => x.classList.remove('is-active'));
          item.classList.add('is-active');
          scene.setTrace(null);
          scene.setZoneFocus(null);
          scene.setStepFocus(step.id);
          scene.focusStep(step.id);
        });
        leftBody.appendChild(item);
      }
    } else if (leftTab === 'zone') {
      for (const zone of FACTORY_ZONES) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'factory-zone-item';
        const swatch = document.createElement('i');
        swatch.style.background = `#${zone.color.toString(16).padStart(6, '0')}`;
        const body = document.createElement('span');
        body.className = 'z-body';
        const t = document.createElement('span');
        t.className = 'z-title';
        t.textContent = `${zone.id} · ${zone.name}`;
        const d = document.createElement('span');
        d.className = 'z-desc';
        d.textContent = zone.function;
        body.appendChild(t);
        body.appendChild(d);
        item.appendChild(swatch);
        item.appendChild(body);
        item.addEventListener('click', () => {
          leftBody.querySelectorAll('.factory-zone-item').forEach((x) => x.classList.remove('is-active'));
          item.classList.add('is-active');
          scene.setTrace(null);
          scene.setStepFocus(null);
          scene.setZoneFocus(zone.id);
          scene.focusZone(zone.id);
        });
        leftBody.appendChild(item);
      }
    } else {
      leftBody.appendChild(searchInput);
      leftBody.appendChild(searchResults);
      renderSearch();
    }
  }

  /* ============================ 搜索 ============================ */
  interface SearchHit { kind: 'node' | 'pipe' | 'catalog'; uid?: string; pipe?: string; device?: string; tag: string; name: string; note: string; }
  function searchHits(q: string): SearchHit[] {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const hits: SearchHit[] = [];
    for (const n of FACTORY_NODES) {
      const hay = `${n.tag} ${n.label} ${n.role} ${n.deviceId}`.toLowerCase();
      if (hay.includes(term)) hits.push({ kind: 'node', uid: n.uid, tag: n.tag, name: n.label, note: `${zoneOfNode(n).short} · 工序 ${stepOfNode(n).no}` });
    }
    for (const p of FACTORY_PIPES) {
      const hay = `${p.id} ${p.name} ${FACTORY_MEDIA[p.medium].label}`.toLowerCase();
      if (hay.includes(term)) hits.push({ kind: 'pipe', pipe: p.id, tag: p.id, name: p.name, note: `${FACTORY_MEDIA[p.medium].label} · ${PIPE_SIZES[p.size].label}` });
    }
    const inFactory = new Set(FACTORY_NODES.map((n) => n.deviceId));
    for (const d of DEVICES) {
      if (inFactory.has(d.id)) continue;
      const hay = `${d.name} ${d.keywords.join(' ')} ${d.categoryLabel}`.toLowerCase();
      if (hay.includes(term)) hits.push({ kind: 'catalog', device: d.id, tag: '设备库', name: d.name, note: `${d.categoryLabel} · 仅在设备库案例` });
    }
    return hits.slice(0, 14);
  }

  function renderSearch() {
    searchResults.textContent = '';
    const hits = searchHits(searchInput.value);
    if (!searchInput.value.trim()) {
      const hint = document.createElement('p');
      hint.className = 'factory-search-hint';
      hint.textContent = '可搜索：设备位号（如 P-202）、设备名称（如 隔膜泵）、管线编号（如 PL-208）。';
      searchResults.appendChild(hint);
      return;
    }
    if (!hits.length) {
      const empty = document.createElement('p');
      empty.className = 'factory-search-hint';
      empty.textContent = '没有匹配结果。可尝试更短的关键词。';
      searchResults.appendChild(empty);
      return;
    }
    for (const h of hits) {
      const a = document.createElement('button');
      a.type = 'button';
      a.className = 'factory-search-item' + (h.kind === 'catalog' ? ' is-catalog' : '');
      const t = document.createElement('span');
      t.className = 'r-tag';
      t.textContent = h.tag;
      const b = document.createElement('span');
      b.className = 'r-body';
      const n = document.createElement('span');
      n.className = 'r-name';
      n.textContent = h.name;
      const note = document.createElement('span');
      note.className = 'r-note';
      note.textContent = h.note;
      b.appendChild(n);
      b.appendChild(note);
      a.appendChild(t);
      a.appendChild(b);
      a.addEventListener('click', event => {
        if (h.kind === 'node' && h.uid) {
          scene.select(h.uid);
          scene.focusNode(h.uid);
          setHash(`#/node/${h.uid}`);
        } else if (h.kind === 'pipe' && h.pipe) {
          scene.selectPipe(h.pipe);
          scene.focusPipe(h.pipe);
          setHash(`#/pipe/${h.pipe}`);
        } else if (h.kind === 'catalog' && h.device) {
          openSceneDevice(event, h.device, captureNavigation());
        }
      });
      searchResults.appendChild(a);
    }
  }
  searchInput.addEventListener('input', renderSearch);

  /* ============================ 右侧信息卡 ============================ */
  const info = document.createElement('aside');
  info.className = 'factory-info';
  info.hidden = true;
  stage.appendChild(info);

  function renderInfo() {
    const uid = scene.selectedUid;
    const pid = scene.selectedPipeId;
    info.textContent = '';
    if (!uid && !pid) { info.hidden = true; return; }
    info.hidden = false;
    if (uid) renderNodeInfo(uid); else if (pid) renderPipeInfo(pid);
  }

  function decorateInfoHead(head: HTMLElement) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fi-collapse';
    b.textContent = '收起';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const collapsed = info.classList.toggle('is-collapsed');
      b.textContent = collapsed ? '展开' : '收起';
    });
    head.appendChild(b);
    head.addEventListener('click', () => {
      if (info.classList.contains('is-collapsed')) {
        info.classList.remove('is-collapsed');
        b.textContent = '收起';
      }
    });
  }

  function renderCoatingControls(uid: string) {
    const batch = scene.coatingBatch;
    const release: Record<CoatingRelease, string> = {
      'awaiting-sample': '待取样', sampled: '待判定', released: '已教学放行', held: '暂缓放行'
    };
    const modes: Record<CoatingMode, string> = { production: '调配与灌装', drain: '滤器排净', rinse: '独立清洗来液' };
    const section = document.createElement('section');
    section.className = 'fi-section fi-batch';
    section.append(
      mkText('p', 'fi-section-title', '教学批次'),
      mkText('p', 'fi-role', modes[batch.mode] + ' · ' + release[batch.release]),
      mkText('p', 'fi-role', '原料 ' + batch.raw + ' · 预混 ' + batch.premix + ' · 调配 ' + batch.blend +
        ' · 过滤留存 ' + batch.filter + ' · 样品 ' + batch.samples + ' · 待转出灌装桶 ' + batch.packed + ' · 暂存 ' + batch.staged +
        ' · 隔离登记 ' + batch.quarantined + ' · 独立收集 ' + batch.collected)
    );
    const actions = document.createElement('div');
    actions.className = 'fi-actions';
    function command(label: string, action: CoatingAction) {
      const control = mkBtn(label, 'btn btn-outline btn-sm', () => {
        coatingMessage = scene.operateCoatingBatch(action);
        const status = info.querySelector('.fi-batch-message');
        if (status) status.textContent = coatingMessage;
        info.querySelector<HTMLButtonElement>('[data-coating-action=' + action + ']')?.focus();
      });
      control.dataset.coatingAction = action;
      actions.appendChild(control);
    }
    function select(label: string, option: CoatingAction, change: readonly [CoatingAction, string][]) {
      const wrapper = document.createElement('label');
      wrapper.textContent = label + ' ';
      const control = document.createElement('select');
      control.className = 'fi-batch-select';
      for (const [value, title] of change) control.add(new Option(title, value, false, value === option));
      control.addEventListener('change', () => {
        coatingMessage = scene.operateCoatingBatch(control.value as CoatingAction);
        const status = info.querySelector('.fi-batch-message');
        if (status) status.textContent = coatingMessage;
        info.querySelector<HTMLSelectElement>('[data-coating-select=' + label + ']')?.focus();
      });
      control.dataset.coatingSelect = label;
      wrapper.appendChild(control);
      actions.appendChild(wrapper);
    }
    command('推进一轮', 'advance');
    if (uid === 'R-202') {
      command('取样', 'sample');
      command('教学放行', 'release');
      command('暂缓放行', 'hold');
      if (batch.release === 'held') command('登记隔离批', 'quarantine');
      command('开始下一批', 'next-batch');
    }
    if (uid === 'T-201') {
      command('从收料开始', 'start-raw');
      command('重置教学批次', 'reset');
    }
    if (uid === 'F-201' || uid === 'CL-201') {
      select('状态', batch.mode, [['production', modes.production], ['drain', modes.drain], ['rinse', modes.rinse]]);
    }
    if (uid === 'F-201') {
      select('滤路', batch.filterCondition, [['clear', '通畅'], ['loaded', '阻力增大'], ['blocked', '堵塞']]);
    }
    const status = mkText('p', 'fi-role fi-batch-message', coatingMessage || '这是定性因果练习。每次推进把已有的份数移到下一站。');
    status.setAttribute('role', 'status');
    section.append(actions, status, mkText('p', 'fi-role', '份数用于演练，实际取样标准、容量和流量待厂区资料确认。'));
    return section;
  }

  function renderNodeInfo(uid: string) {
    const node = getNodeByUid(uid);
    if (!node) return;
    const zone = zoneOfNode(node);
    const step = stepOfNode(node);
    const device = catalogDeviceOfNode(node);
    const asset = assetsForDevice(node.deviceId)[0];

    const head = document.createElement('div');
    head.className = 'fi-head';
    const tag = document.createElement('span');
    tag.className = 'fi-tag';
    tag.textContent = node.tag;
    const name = document.createElement('span');
    name.className = 'fi-name';
    name.textContent = node.label;
    head.appendChild(tag);
    head.appendChild(name);
    decorateInfoHead(head);
    info.appendChild(head);

    const meta = document.createElement('div');
    meta.className = 'fi-meta';
    meta.textContent = `${zone.short} · 工序 ${step.no} ${step.title}`;
    info.appendChild(meta);

    const role = document.createElement('p');
    role.className = 'fi-role';
    role.textContent = node.role;
    info.appendChild(role);
    if (['T-201', 'R-202', 'F-201', 'CL-201', 'FL-201', 'ST-201'].includes(uid)) {
      info.appendChild(renderCoatingControls(uid));
    }

    const equipment = scene.getEquipmentStatus(node.uid);
    if (equipment) {
      const pneumatic = FACTORY_EQUIPMENT_CONTROLS[node.uid] === 'air';
      const command = pneumatic ? (equipment.enabled ? '关闭泵供气' : '接通泵供气')
        : (equipment.enabled ? '停止设备' : '启动设备');
      info.append(
        mkBtn(command, 'btn btn-outline btn-sm factory-equipment-command', () => {
          scene.setEquipmentCommand(node.uid, !equipment.enabled);
          info.querySelector<HTMLButtonElement>('.factory-equipment-command')?.focus();
        }),
        mkText('p', 'fi-role factory-equipment-status', equipment.description)
      );
    }

    if (node.inline?.valve) {
      const row = document.createElement('div');
      row.className = 'fi-valve-row';
      const state = scene.getValveState(node.uid);
      const operation = VALVE_OPERATIONS[node.inline.valve];
      for (const s of operation.commands) {
        const b = mkBtn(s === 'open' ? '全开' : s === 'partial' ? '部分' : '关闭', `fi-valve-btn${state === s ? ' is-active' : ''}`, () => {
          scene.setValveState(node.uid, s);
          info.querySelector<HTMLButtonElement>('.fi-valve-btn.is-active')?.focus();
        });
        row.appendChild(b);
      }
      if (operation.commands.length) info.appendChild(row);
      const note = document.createElement('p');
      note.className = 'fi-role';
      note.textContent = operation.description;
      info.appendChild(note);
    }

    const portSec = document.createElement('div');
    portSec.className = 'fi-section';
    const portTitle = document.createElement('div');
    portTitle.className = 'fi-section-title';
    portTitle.textContent = '接口';
    portSec.appendChild(portTitle);
    const portList = document.createElement('div');
    portList.className = 'fi-ports';
    for (const port of node.ports) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'fi-port';
      row.innerHTML = '';
      const nm = document.createElement('span');
      nm.className = 'p-name';
      nm.textContent = port.name;
      const rr = document.createElement('span');
      rr.className = 'p-role';
      rr.textContent = `${port.role === 'in' ? '入口' : port.role === 'out' ? '出口' : '连接口'} · ${PIPE_SIZES[port.size].label}`;
      row.appendChild(nm);
      row.appendChild(rr);
      row.addEventListener('click', () => handlePortPick(node.uid, port.id));
      portList.appendChild(row);
    }
    if (node.ports.length) { portSec.appendChild(portList); info.appendChild(portSec); }

    const links = downstreamTargets(node.uid);
    const ups = upstreamTargets(node.uid);
    if (ups.length || links.length) {
      const sec = document.createElement('div');
      sec.className = 'fi-section';
      const t = document.createElement('div');
      t.className = 'fi-section-title';
      t.textContent = '物料上下游';
      sec.appendChild(t);
      const mkRow = (dirLabel: string, target: string, pipe: FactoryPipelineDef) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'fi-link';
        b.textContent = `${dirLabel} · ${target}（${pipe.id} ${FACTORY_MEDIA[pipe.medium].label}）`;
        b.addEventListener('click', () => {
          scene.select(target);
          scene.focusNode(target);
        });
        sec.appendChild(b);
      };
      for (const u of ups) mkRow('上游', u.node.uid, u.pipe);
      for (const l of links) mkRow('下游', l.node.uid, l.pipe);
      info.appendChild(sec);
    }

    const actions = document.createElement('div');
    actions.className = 'fi-actions';
    const traceActive = !!scene.getTrace();
    if (links.length) {
      actions.appendChild(mkBtn(traceActive ? '清除高亮' : '沿下游查看', 'btn btn-primary', () => {
        if (scene.getTrace()) {
          scene.setTrace(null);
          toast('已清除流向高亮。');
        } else {
          const trace = traceFrom(node.uid, 'down');
          scene.setTrace(trace);
          if (links[0]) scene.focusPipe(links[0].pipe.id);
          toast(`已高亮下游 ${trace.pipes.size} 段管线，点击设备继续追踪。`);
        }
        renderInfo();
      }, '高亮与该设备真实相连的下游管线段'));
    }
    if (!node.inline) {
      actions.appendChild(mkBtn('走近查看', 'btn btn-outline', () => openDetail(node.uid), '进入设备细节：外观参照与内部教学结构'));
      if (asset) {
        const on = appearanceUid === node.uid;
        actions.appendChild(mkBtn(on ? '内部教学结构' : '外观参照', `btn btn-outline${on ? ' is-active' : ''}`, () => {
          void toggleAppearance(node.uid, !on);
        }, '在当前视角切换外观参照与内部教学结构'));
      }
    }
    if (device) {
      const a = document.createElement('a');
      a.className = 'btn btn-outline';
      a.href = `#/device/${device.id}`;
      a.textContent = '零件工作台';
      a.addEventListener('click', event => openSceneDevice(event, device.id, captureNavigation()));
      actions.appendChild(a);
    }
    info.appendChild(actions);

    if (!node.inline) {
      const details = document.createElement('details');
      details.className = 'fi-details';
      const sum = document.createElement('summary');
      sum.textContent = '结构与作用（教学示意）';
      const p1 = document.createElement('p');
      p1.textContent = node.internals;
      details.appendChild(sum);
      details.appendChild(p1);
      if (!device) {
        const proc = PROCEDURAL_INFO[node.deviceId];
        if (proc) {
          const p2 = document.createElement('p');
          p2.textContent = proc.structureNote;
          details.appendChild(p2);
        }
      }
      info.appendChild(details);
    }
  }

  function renderPipeInfo(pipeId: string) {
    const pipe = getPipe(pipeId);
    const fromNode = pipe.from.type === 'port' ? getNodeByUid(pipe.from.node) : null;
    const toNode = pipe.to.type === 'port' ? getNodeByUid(pipe.to.node) : null;
    const head = document.createElement('div');
    head.className = 'fi-head';
    const tag = document.createElement('span');
    tag.className = 'fi-tag is-pipe';
    tag.textContent = pipe.id;
    const name = document.createElement('span');
    name.className = 'fi-name';
    name.textContent = pipe.name;
    head.appendChild(tag);
    head.appendChild(name);
    decorateInfoHead(head);
    info.appendChild(head);

    const medium = document.createElement('div');
    medium.className = 'fi-meta';
    const swatch = document.createElement('i');
    swatch.className = 'fi-swatch';
    swatch.style.background = `#${FACTORY_MEDIA[pipe.medium].color.toString(16).padStart(6, '0')}`;
    medium.appendChild(swatch);
    const material = FACTORY_MEDIA[pipe.medium];
    const routeKind = material.phase === 'packaged' ? '辊道示踪' : PIPE_SIZES[pipe.size].label;
    medium.appendChild(document.createTextNode(`${material.label} · ${routeKind}`));
    info.appendChild(medium);

    const ends = document.createElement('p');
    ends.className = 'fi-role';
    const aText = fromNode ? `${fromNode.tag} ${fromNode.label}` : pipe.from.type === 'cap' ? pipe.from.label : '—';
    const bText = toNode ? `${toNode.tag} ${toNode.label}` : pipe.to.type === 'cap' ? pipe.to.label : '—';
    ends.textContent = `${aText} → ${bText}`;
    info.appendChild(ends);
    const flow = scene.getPipeFlow(pipe.id);
    if (flow) info.appendChild(mkText('p', 'fi-role factory-flow-status', teachingFlowLabel(flow)));
    if (pipe.note) {
      const note = document.createElement('p');
      note.className = 'fi-role is-muted';
      note.textContent = pipe.note;
      info.appendChild(note);
    }

    const valves = valvesOfPipe(pipe.id);
    const insts = instrumentsOfPipe(pipe.id);
    if (valves.length || insts.length) {
      const sec = document.createElement('div');
      sec.className = 'fi-section';
      const t = document.createElement('div');
      t.className = 'fi-section-title';
      t.textContent = '管线上仪表与阀门';
      sec.appendChild(t);
      for (const v of valves) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'fi-link';
        b.textContent = `${v.tag} ${v.label} · ${scene.getValveState(v.uid).toUpperCase()}`;
        b.addEventListener('click', () => { scene.select(v.uid); scene.focusNode(v.uid); });
        sec.appendChild(b);
      }
      for (const i of insts) {
        const p = document.createElement('span');
        p.className = 'fi-instrument';
        p.textContent = `${i.tag} ${i.name}（演示，不显示读数）`;
        sec.appendChild(p);
      }
      info.appendChild(sec);
    }

    const joints = jointsOfPipe(pipe.id);
    if (joints.length) {
      const sec = document.createElement('div');
      sec.className = 'fi-section';
      const t = document.createElement('div');
      t.className = 'fi-section-title';
      t.textContent = '可拆卸接头';
      sec.appendChild(t);
      for (const j of joints) {
        const b = mkBtn(`进入法兰练习 · ${j.id}`, 'btn btn-primary', () => {
          location.hash = `#/practice/${j.id}`;
        });
        sec.appendChild(b);
        const note = document.createElement('p');
        note.className = 'fi-role is-muted';
        note.textContent = j.note;
        sec.appendChild(note);
      }
      info.appendChild(sec);
    }

    const actions = document.createElement('div');
    actions.className = 'fi-actions';
    actions.appendChild(mkBtn('清除高亮', 'btn btn-outline', () => {
      scene.selectPipe(null);
    }));
    info.appendChild(actions);
  }

  /* ============================ 教学流程图 ============================ */
  const diagram: DiagramApi = createDiagram({
    onNode: (uid) => {
      scene.select(uid);
      scene.focusNode(uid);
    },
    onPipe: (pipeId) => {
      scene.selectPipe(pipeId);
      scene.focusPipe(pipeId);
    }
  });
  diagram.el.classList.add('factory-diagram-float');
  stage.appendChild(diagram.el);

  function syncDiagramFlows() {
    diagram.setFlows(id => scene.getPipeFlow(id));
  }

  function syncSelectionUI() {
    diagram.setActive({ node: scene.selectedUid, pipe: scene.selectedPipeId });
  }

  /* ============================ 外观参照 ============================ */
  let appearanceUid: string | null = null;
  let appearanceBusy = false;
  async function toggleAppearance(uid: string, on: boolean): Promise<void> {
    if (appearanceBusy) return;
    const asset = assetsForDevice(getNodeByUid(uid)?.deviceId ?? '')[0];
    if (on && !asset) { toast('该设备暂无可靠的外观模型对应。'); return; }
    appearanceBusy = true;
    const ok = await scene.setAppearance(uid, on, on && asset ? asset.file : '');
    appearanceBusy = false;
    if (!ok) return;
    appearanceUid = on ? uid : null;
    emitTask({ type: on ? 'appearance-on' : 'appearance-off', uid });
    if (detailOpen && detailUid === uid) {
      /* 细节浮层内由浮层自己切换，这里仅同步外壳 */
    }
    renderInfo();
  }

  /* ============================ 标签/对话框 ============================ */
  const toastBox = document.createElement('div');
  toastBox.className = 'factory-toasts';
  stage.appendChild(toastBox);
  function toast(text: string) {
    const t = document.createElement('div');
    t.className = 'factory-toast';
    t.textContent = text;
    toastBox.appendChild(t);
    window.setTimeout(() => t.classList.add('is-out'), 2600);
    window.setTimeout(() => t.remove(), 3200);
  }

  /* ============================ 行走 HUD ============================ */
  const walkHud = document.createElement('div');
  walkHud.className = 'factory-walk-hud';
  walkHud.hidden = true;
  const walkHint = document.createElement('div');
  walkHint.className = 'walk-hint';
  walkHint.textContent = '行走模式：WASD/方向键移动，拖动视角，Esc 退出；手机用右下方向键。';
  const dpad = document.createElement('div');
  dpad.className = 'walk-dpad';
  const mkPad = (label: string, x: number, y: number, cls: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `walk-pad-btn ${cls}`;
    b.textContent = label;
    const start = (ev: PointerEvent) => {
      ev.preventDefault();
      scene.setWalkPad(x, y);
      b.setPointerCapture?.(ev.pointerId);
    };
    const end = () => scene.setWalkPad(0, 0);
    b.addEventListener('pointerdown', start);
    b.addEventListener('pointerup', end);
    b.addEventListener('pointerleave', end);
    b.addEventListener('pointercancel', end);
    return b;
  };
  dpad.appendChild(mkPad('↑', 0, 1, 'is-up'));
  dpad.appendChild(mkPad('←', -1, 0, 'is-left'));
  dpad.appendChild(mkPad('↓', 0, -1, 'is-down'));
  dpad.appendChild(mkPad('→', 1, 0, 'is-right'));
  walkHud.appendChild(mkBtn('到投料楼梯口', 'btn btn-outline', () => scene.goToStairApproach()));
  walkHud.appendChild(walkHint);
  walkHud.appendChild(dpad);
  stage.appendChild(walkHud);

  /* ============================ 样板任务 ============================ */
  const taskPanel = document.createElement('section');
  taskPanel.className = 'factory-task';
  taskPanel.hidden = true;
  stage.appendChild(taskPanel);
  taskBtn.classList.toggle('is-active', records.task.step > 0 && records.task.step < SAMPLE_TASK_STEPS.length);
  if (records.task.step >= SAMPLE_TASK_STEPS.length) taskBtn.textContent = '样板任务 ✓';
  else if (records.task.step > 0) taskBtn.textContent = `样板任务 ${records.task.step}/${SAMPLE_TASK_STEPS.length}`;

  function toggleTaskPanel(force?: boolean) {
    const open = force ?? taskPanel.hidden;
    if (open && narrowStage.matches) setDirectoryOpen(false);
    taskPanel.hidden = !open;
    if (open) renderTaskPanel();
  }

  function renderTaskPanel() {
    taskPanel.textContent = '';
    const head = document.createElement('div');
    head.className = 'ft-head';
    const t = document.createElement('div');
    t.className = 'ft-title';
    t.textContent = '样板任务 · 追踪一批物料从调配罐到灌装机';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-ghost';
    closeBtn.textContent = '收起';
    closeBtn.addEventListener('click', () => toggleTaskPanel(false));
    head.appendChild(t);
    head.appendChild(closeBtn);
    taskPanel.appendChild(head);

    const task = records.task;
    const finished = task.step >= SAMPLE_TASK_STEPS.length;
    const prog = document.createElement('div');
    prog.className = 'ft-progress';
    prog.textContent = finished ? '已完成 10/10' : task.step === 0 ? '未开始' : `进行中 ${task.step}/${SAMPLE_TASK_STEPS.length}`;
    taskPanel.appendChild(prog);
    if (!task.startedAt && !finished) taskPanel.appendChild(mkText('p', 'fi-role',
      '先区分进出口和介质，再沿 R-202 调配罐、P-202 隔膜泵、F-201 袋式过滤器至 FL-201 灌装机追踪。途中需装好法兰垫片和紧固件。'));

    const list = document.createElement('ol');
    list.className = 'ft-steps';
    SAMPLE_TASK_STEPS.forEach((s, i) => {
      const li = document.createElement('li');
      const done = i < task.step;
      const current = i === task.step && !finished;
      li.className = done ? 'is-done' : current ? 'is-current' : '';
      const badge = document.createElement('span');
      badge.className = 'ft-badge';
      badge.textContent = done ? '✓' : String(i + 1);
      const body = document.createElement('span');
      body.className = 'ft-body';
      const tt = document.createElement('span');
      tt.className = 'ft-step-title';
      tt.textContent = s.title;
      body.appendChild(tt);
      if (current) {
        const hint = document.createElement('span');
        hint.className = 'ft-step-hint';
        hint.textContent = s.hint;
        body.appendChild(hint);
      }
      li.appendChild(badge);
      li.appendChild(body);
      list.appendChild(li);
    });
    taskPanel.appendChild(list);

    const actions = document.createElement('div');
    actions.className = 'ft-actions';
    if (finished) {
      const ok = document.createElement('div');
      ok.className = 'ft-finished';
      ok.textContent = '任务完成。已检查对象识别、法兰装配与路径追踪，并记录本次操作。';
      actions.appendChild(ok);
      actions.appendChild(mkBtn('再走一遍', 'btn btn-outline', () => {
        resetTask(records);
        renderTaskPanel();
        updateTaskBadge();
        toast('样板任务已重置。');
      }));
    } else {
      if (task.step === 0) {
        actions.appendChild(mkBtn('开始任务', 'btn btn-primary', () => {
          task.startedAt = Date.now();
          saveFactoryRecords(records);
          renderTaskPanel();
          updateTaskBadge();
        }));
      }
      const cur = SAMPLE_TASK_STEPS[task.step];
      if (cur?.target) {
        actions.appendChild(mkBtn('定位当前目标', 'btn btn-outline', () => {
          const target = cur.target!;
          if (getNodeByUid(target)) {
            scene.select(target);
            scene.focusNode(target);
          } else if (getJoint(target)) {
            const joint = getJoint(target)!;
            scene.selectPipe(joint.pipe);
            scene.focusPipe(joint.pipe);
            toast('法兰接头已高亮，点击琥珀色接头标记进入练习。');
          }
        }));
      }
      actions.appendChild(mkBtn('重新开始', 'btn btn-ghost', () => {
        resetTask(records);
        renderTaskPanel();
        updateTaskBadge();
        toast('样板任务已重置。');
      }));
    }
    taskPanel.appendChild(actions);
  }

  function updateTaskBadge() {
    if (records.task.step >= SAMPLE_TASK_STEPS.length) {
      taskBtn.textContent = '样板任务 ✓';
      taskBtn.classList.remove('is-active');
    } else if (records.task.step > 0) {
      taskBtn.textContent = `样板任务 ${records.task.step}/${SAMPLE_TASK_STEPS.length}`;
      taskBtn.classList.add('is-active');
    } else {
      taskBtn.textContent = '样板任务';
      taskBtn.classList.remove('is-active');
    }
  }

  function emitTask(ev: TaskEvent) {
    const before = records.task.step;
    const res = advanceTask(records, ev);
    if (!res) return;
    updateTaskBadge();
    if (res.step !== before && !taskPanel.hidden) renderTaskPanel();
    if (res.finished) {
      toast('样板任务完成：从调配罐到灌装机的物料追踪已全部走通。');
      taskBtn.classList.add('is-active');
    } else if (res.step !== before) {
      const doneStep = SAMPLE_TASK_STEPS[res.step - 1];
      toast(`✓ ${doneStep.title}`);
    }
  }

  /* ============================ 接口识别 ============================ */
  function handlePortPick(uid: string, portId: string) {
    const node = getNodeByUid(uid);
    const port = node?.ports.find((p) => p.id === portId);
    const isLiquidMain = uid === 'P-202' && (portId === 'suction' || portId === 'discharge');
    scene.flashPort(uid, portId, isLiquidMain ? 'ok' : 'wrong');
    if (detail && detailUid === uid) detail.setPortPicked(portId, isLiquidMain);
    if (port) {
      toast(`${node?.tag} · ${port.name}：${port.role === 'in' ? '入口' : port.role === 'out' ? '出口' : '连接口'}（教学示意接口）`);
    }
    emitTask({ type: 'port', uid, portId });
  }

  /* ============================ 细节浮层 ============================ */
  let detail: DetailOverlay | null = null;
  let detailUid: string | null = null;
  let detailOpen = false;
  let practice: PracticeOverlay | null = null;
  let practiceJoint: string | null = null;
  let savedView: { pos: [number, number, number]; target: [number, number, number]; selected?: string | null; pipe?: string | null } | null = null;
  let lastHash = location.hash || '#/';

  function captureNavigation(): FactoryNavigationSnapshot {
    return {
      kind: 'factory', scene: scene.navigationState, tab: leftTab, query: searchInput.value, directoryOpen: !left.hidden,
      task: !taskPanel.hidden,
      diagramCollapsed: diagram.collapsed(),
      detail: detailUid ? { uid: detailUid, before: savedView } : null
    };
  }

  function openDetail(uid: string, restoreView = true) {
    if (!getNodeByUid(uid)) return;
    if (detailOpen && detailUid === uid) return;
    closePractice(false);
    closeDetail(false);
    savedView = scene.getViewState();
    detailUid = uid;
    detailOpen = true;
    scene.select(uid);
    if (restoreView) scene.focusNode(uid);
    detail = openDetailOverlay(stage, {
      uid,
      scene,
      onClose: (reason) => closeDetailViaRoute(reason),
      onAppearanceToggle: (on) => {
        appearanceUid = on ? uid : null;
        emitTask({ type: on ? 'appearance-on' : 'appearance-off', uid });
      },
      onPortPick: (portId) => handlePortPick(uid, portId),
      onToast: (msg) => toast(msg),
      onOpenWorkbench: (event, deviceId) => openSceneDevice(event, deviceId, captureNavigation())
    });
    stage.classList.add('is-detail');
    setHash(`#/detail/${uid}`);
  }

  function closeDetail(restore: boolean) {
    if (!detailOpen) return;
    detail?.dispose();
    detail = null;
    detailUid = null;
    detailOpen = false;
    stage.classList.remove('is-detail');
    if (restore && savedView) {
      scene.setViewState(savedView, false);
      savedView = null;
    } else {
      savedView = null;
    }
    renderInfo();
  }

  function closeDetailViaRoute(reason: 'button' | 'escape' | 'route') {
    const uid = detailUid;
    closeDetail(true);
    if (uid) emitTask({ type: 'detail-exit', uid });
    landAfterOverlay(uid ? `#/node/${uid}` : '#/');
  }

  /* ============================ 法兰练习 ============================ */
  function openPractice(jointId: string) {
    if (!getJoint(jointId)) return;
    if (practice && practiceJoint === jointId) return;
    closeDetail(false);
    closePractice(false);
    savedView = scene.getViewState();
    practiceJoint = jointId;
    scene.pause();
    practice = openPracticeOverlay(stage, {
      jointId,
      onClose: () => closePracticeViaRoute(),
      onComplete: (info) => {
        records.joints[jointId] = { done: true, at: Date.now(), items: info.items, attempts: info.attempts };
        saveFactoryRecords(records);
        emitTask({ type: 'joint-complete', jointId });
      },
      onToast: (msg) => toast(msg)
    });
    stage.classList.add('is-practice');
    emitTask({ type: 'joint-open', jointId });
    setHash(`#/practice/${jointId}`);
  }

  function closePractice(restore: boolean) {
    if (!practice) return;
    practice.dispose();
    practice = null;
    practiceJoint = null;
    stage.classList.remove('is-practice');
    scene.start();
    if (restore && savedView) {
      scene.setViewState(savedView, false);
      savedView = null;
    } else {
      savedView = null;
    }
    renderInfo();
  }

  function closePracticeViaRoute() {
    closePractice(true);
    landAfterOverlay('#/node/F-201');
  }

  function landAfterOverlay(fallbackHash: string) {
    if (location.hash !== fallbackHash) {
      history.replaceState(null, '', fallbackHash);
    }
    lastHash = fallbackHash;
  }

  /* ============================ 本厂记录 ============================ */
  function openFactoryRecords() {
    const overlay = document.createElement('div');
    overlay.className = 'factory-records-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'factory-records';
    dialog.setAttribute('role', 'dialog');
    const head = document.createElement('div');
    head.className = 'fr-head';
    const t = document.createElement('div');
    t.className = 'fr-title';
    t.textContent = '本厂学习记录（只存本机）';
    const close = mkBtn('关闭', 'btn btn-ghost', () => overlay.remove());
    head.appendChild(t);
    head.appendChild(close);
    dialog.appendChild(head);

    const body = document.createElement('div');
    body.className = 'fr-body';
    const task = records.task;
    const taskRow = document.createElement('div');
    taskRow.className = 'fr-row';
    taskRow.textContent = `样板任务：${task.step >= SAMPLE_TASK_STEPS.length ? '已完成 10/10' : task.step > 0 ? `进行中 ${task.step}/10` : '未开始'}`;
    body.appendChild(taskRow);
    const visits = Object.keys(records.visited);
    const visitRow = document.createElement('div');
    visitRow.className = 'fr-row';
    visitRow.textContent = `到访设备：${visits.length} 台${visits.length ? `（${visits.slice(-8).map((u) => getNodeByUid(u)?.tag ?? u).join('、')}${visits.length > 8 ? '…' : ''}）` : ''}`;
    body.appendChild(visitRow);
    const jointKeys = Object.keys(records.joints);
    const jointRow = document.createElement('div');
    jointRow.className = 'fr-row';
    jointRow.textContent = jointKeys.length
      ? `法兰练习：${jointKeys.map((k) => `${k}${records.joints[k].done ? ' 已完成' : ' 未完成'}`).join('；')}`
      : '法兰练习：未练习';
    body.appendChild(jointRow);
    if (task.done.length) {
      const ul = document.createElement('ul');
      ul.className = 'fr-done';
      for (const d of task.done.slice(-12)) {
        const li = document.createElement('li');
        li.textContent = d.note;
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }
    dialog.appendChild(body);

    const foot = document.createElement('div');
    foot.className = 'fr-foot';
    foot.appendChild(mkBtn('打开原有学习记录', 'btn btn-outline', () => { overlay.remove(); openRecordsDialog(); }));
    dialog.appendChild(foot);

    overlay.appendChild(dialog);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    stage.appendChild(overlay);
  }

  /* ============================ 路由 ============================ */
  function setHash(hash: string) {
    lastHash = hash;
    if (location.hash !== hash) location.hash = hash;
  }

  function resetOverview() {
    scene.setTrace(null);
    scene.setStepFocus(null);
    scene.setZoneFocus(null);
    scene.clearSelection();
    scene.fitView();
    leftBody.querySelectorAll('.is-active').forEach((x) => x.classList.remove('is-active'));
    setHash('#/');
  }

  function handleHash(hash: string, initial = false) {
    lastHash = hash;
    if (hash.startsWith('#/detail/')) {
      openDetail(decodeURIComponent(hash.slice('#/detail/'.length)));
      return;
    }
    if (hash.startsWith('#/practice/')) {
      openPractice(decodeURIComponent(hash.slice('#/practice/'.length)));
      return;
    }
    if (detailOpen || practice) {
      /* 浏览器后退离开细节/练习：恢复进入前视角，不再按目标哈希移动相机 */
      closeDetail(true);
      closePractice(true);
      return;
    }
    if (hash === '#/' || hash === '' || hash === '#') {
      scene.setTrace(null);
      scene.setStepFocus(null);
      scene.setZoneFocus(null);
      if (!initial) {
        scene.clearSelection();
        scene.fitView();
      }
      return;
    }
    const nm = hash.match(/^#\/node\/([\w-]+)/);
    if (nm) {
      const uid = nm[1];
      if (getNodeByUid(uid)) { scene.select(uid); scene.focusNode(uid); }
      return;
    }
    const pm = hash.match(/^#\/pipe\/([\w-]+)/);
    if (pm) {
      const pid = pm[1];
      if (getNodeByUid(pid)) { scene.select(pid); scene.focusNode(pid); return; }
      try {
        getPipe(pid);
        scene.selectPipe(pid);
        scene.focusPipe(pid);
      } catch { /* 无效管线编号按首页处理 */ }
      return;
    }
    const zm = hash.match(/^#\/zone\/([A-Za-z0-9]+)/);
    if (zm) {
      try {
        const zone = getZone(zm[1] as Parameters<typeof getZone>[0]);
        scene.setStepFocus(null);
        scene.setZoneFocus(zone.id);
        scene.focusZone(zone.id);
      } catch { /* 无效分区编号忽略 */ }
      return;
    }
    if (hash.startsWith('#/task')) {
      toggleTaskPanel(true);
      return;
    }
  }

  app.__factory = (hash: string) => handleHash(hash);
  app.__dispose = () => {
    uiEvents.abort();
    closeDetail(false);
    closePractice(false);
    scene.dispose();
    delete app.__factory;
    const w = window as Window & { __factoryAudit?: () => unknown; __factoryDebug?: unknown };
    delete w.__factoryAudit;
    delete w.__factoryDebug;
    app.classList.remove('factory-root');
    app.innerHTML = '';
  };
  (window as unknown as { __factoryAudit?: () => unknown }).__factoryAudit = () => scene.audit();
  (window as unknown as { __factoryDebug?: unknown }).__factoryDebug = {
    audit: () => scene.audit(),
    debug: () => scene.debugState,
    view: () => scene.getViewState(),
    coatingBatch: () => scene.coatingBatch,
    select: (uid: string) => { scene.select(uid); scene.focusNode(uid); },
    appearance: (uid: string, on: boolean, url?: string) => scene.setAppearance(uid, on, url ?? ''),
    walk: (on: boolean) => { if (on) scene.enterWalk(); else scene.exitWalk(); }
  };

  function mkText(tag: 'p', className: string, text: string) {
    const el = document.createElement(tag);
    el.className = className;
    el.textContent = text;
    return el;
  }

  /* 初始渲染 */
  renderLeft();
  updateTaskBadge();
  syncSelectionUI();
  syncDiagramFlows();
  const initialHash = location.hash || '#/';
  const snapshot = sceneSnapshot() as FactoryNavigationSnapshot | undefined;
  if (snapshot?.kind === 'factory') {
    if (snapshot.detail && initialHash === '#/detail/' + snapshot.detail.uid) {
      openDetail(snapshot.detail.uid, false);
      savedView = snapshot.detail.before;
    }
    scene.restoreNavigation(snapshot.scene);
    searchInput.value = snapshot.query;
    setLeftTab(snapshot.tab);
    toggleTaskPanel(snapshot.task);
    setDirectoryOpen(snapshot.directoryOpen ?? !compactDirectory.matches);
    diagram.setCollapsed(snapshot.diagramCollapsed ?? true);
    frontBtn.classList.toggle('is-active', snapshot.scene.shell.front);
    roofBtn.classList.toggle('is-active', snapshot.scene.shell.roof);
    labelBtn.classList.toggle('is-active', snapshot.scene.labels);
  } else if (initialHash !== '#/' && initialHash !== '#') {
    window.setTimeout(() => {
      if (location.hash === initialHash) handleHash(initialHash, true);
    }, 60);
  }
}

/* ============================ 小工具 ============================ */
function mkBtn(label: string, className: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}
