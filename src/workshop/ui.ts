import { findMotionBlock, findPoseConflicts, type MotionBlock } from './motionValidation';
import { planConnection, planFasteners, stagePumpRingAssembly } from './assemblyPlan';
import { DOCK_RELEASE_DISTANCE, findDockTarget, type DockTarget } from './nearConnection';
/* 管道与设备三维组装工坊 · 工作台 UI
 * 左侧零件库 / 中央三维搭建区 / 右侧参数·接口·任务·分组 / 底部工具栏。 */
import './workshop.css';
import * as THREE from 'three';
import type { Instance, WState, Plan, CategoryId, PortDef } from './types';
import { CATEGORY_LABEL, PORT_TYPE_LABEL, MATERIAL_LABEL, CAP_LABEL } from './types';
import { CATALOG, partById, READY_COUNT } from './catalog';
import { assemblyAssetById, courseNames } from './expansion';
import { workshopThumbnails } from './thumbnails';
import { PIPE_DN_LIST, DN_TABLE, dnSpec, flangeSpec, fmtMm, STANDARD_NOTE, reducerSmall, reducerSmallOptions, reducerSmallValid } from './specs';
import { odU, portsFor } from './layout';
import {
  instOf, livePorts, portDef, portWorld, portOccupied, isFluidPort,
  jointSlots, slotOccupied, slotWorld, validateConnection, makeConnection,
  removeConnection, deleteInstances, componentOf, findPath, openPorts,
  pathPositions, refreshDependents,
  History, cloneState, newUid
} from './state';
import type { PortRef } from './state';
import { TASKS, taskById } from './tasks';
import type { TaskResult } from './tasks';
import {
  listPlans, newPlan, getPlan, savePlan, renamePlan, duplicatePlan, validateState,
  deletePlan, lastPlanId, setLastPlan, exportPlan, importPlanFile, workshopStorageWarning
} from './storage';
import { WorkshopScene } from './engine';
import type { PortMarker, TransformItem } from './engine';
import { el, button, icon, ICONS } from '../ui/dom';
import { openRecordsDialog } from '../ui/dialogs';

const KIND_LABEL: Record<string, string> = {
  flange: '法兰连接', thread: '螺纹连接', weld: '焊接连接',
  'bolt-slot': '螺栓紧固', nut: '螺母旋合', clamp: '管夹/支架', mechanical: '机械配合'
};

type SideTab = 'sel' | 'ports' | 'task' | 'group';

export function renderWorkshop(root: HTMLElement) {
  root.innerHTML = '';

  /* ---------- 方案与状态 ---------- */
  const restored = getPlan(lastPlanId() ?? '');
  const initial = restored ? null : newPlan('我的第一套装置');
  let plan: Plan = restored ?? initial!.plan;
  const initialSaveError = initial?.write.ok === false ? initial.write.error : null;
  let state: WState = plan.state;
  let history = new History(state);
  let selection: string[] = [];
  let activePort: PortRef | null = null;
  let activeConn: string | null = null;
  let activeTask: string | null = plan.activeTask ?? null;
  let taskOnlyParts = true;
  let lastTaskResult: TaskResult | null = null;
  const taskAnswers = new Map<number, number>();
  let refOn = false;
  let refExploded = false;
  let sideTab: SideTab = 'sel';
  let saveTimer = 0;
  let placingPart: string | null = null;
  let placementSpec: Partial<Instance['spec']> | undefined;
  const thumbnails = workshopThumbnails();
  let visibleStatus: 'ready' | 'dev' = 'ready';
  let isolatedUid: string | null = null;

  /* ---------- 页面骨架 ---------- */
  const page = el('div', 'ws');
  const top = el('header', 'ws-top');
  const back = button('', 'btn btn-outline ws-back', () => { location.hash = '#/library'; }, '返回设备库');
  back.appendChild(icon(ICONS.back, 16));
  back.appendChild(el('span', '', '设备库'));
  top.appendChild(back);
  const topTitle = el('div', 'ws-top-title');
  topTitle.appendChild(el('h1', '', '管道与设备三维组装工坊'));
  const planName = el('input', 'ws-plan-name') as HTMLInputElement;
  planName.value = plan.name;
  planName.setAttribute('aria-label', '方案名称');
  planName.addEventListener('change', () => {
    plan.name = planName.value.trim() || '未命名方案';
    planName.value = plan.name;
    if (saveNow().ok) toast('方案已重命名', 'ok');
  });
  topTitle.appendChild(planName);
  top.appendChild(topTitle);
  const saveNote = el('span', 'ws-save-note', '方案保存在本机浏览器');
  saveNote.setAttribute('role', 'status');
  top.appendChild(saveNote);
  const managePlans = button('方案管理', 'btn btn-outline', () => {
    toolsMenu.open = false;
    openPlansDialog();
  });
  top.appendChild(managePlans);
  const saveBtn = button('保存', 'btn btn-primary', () => {
    const write = saveNow();
    toast(write.ok ? '方案已保存到本机浏览器' : '保存失败。' + write.error, write.ok ? 'ok' : 'err');
  });
  top.appendChild(saveBtn);
  const toolsMenu = el('details', 'ws-tools-menu');
  const toolsTrigger = el('summary', 'btn btn-outline', '更多');
  const displayTools = el('div', 'ws-display-tools');
  toolsMenu.append(toolsTrigger, displayTools);
  top.appendChild(toolsMenu);
  const libToggle = button('零件库', 'btn btn-outline ws-drawer-btn', () => {
    setLibraryOpen(!page.classList.contains('lib-open'));
  });
  libToggle.setAttribute('aria-controls', 'ws-part-library');
  libToggle.setAttribute('aria-expanded', 'false');
  function setLibraryOpen(open: boolean) {
    if (open) setSideOpen(false);
    page.classList.toggle('lib-open', open);
    libToggle.setAttribute('aria-expanded', String(open));
  }
  const sideToggle = button('面板', 'btn btn-outline ws-drawer-btn', () => setSideOpen(!page.classList.contains('side-open')));
  sideToggle.setAttribute('aria-controls', 'ws-side-panel');
  sideToggle.setAttribute('aria-expanded', 'false');
  function setSideOpen(open: boolean) {
    if (open) setLibraryOpen(false);
    page.classList.toggle('side-open', open);
    sideToggle.setAttribute('aria-expanded', String(open));
  }
  top.appendChild(libToggle);
  top.appendChild(sideToggle);
  page.appendChild(top);

  const body = el('div', 'ws-body');
  const lib = el('aside', 'ws-lib');
  lib.id = 'ws-part-library';
  lib.setAttribute('aria-labelledby', 'ws-part-library-heading');
  const stage = el('main', 'ws-stage');
  const canvasHost = el('div', 'ws-canvas');
  stage.appendChild(canvasHost);
  const hoverChip = el('div', 'ws-hover-chip');
  hoverChip.style.display = 'none';
  stage.appendChild(hoverChip);
  const dragChip = el('div', 'ws-drag-chip');
  dragChip.hidden = true;
  const placeHint = el('div', 'ws-place-hint');
  placeHint.hidden = true;
  placeHint.setAttribute('role', 'region');
  placeHint.setAttribute('aria-label', '零件放置');
  page.appendChild(placeHint);
  const toasts = el('div', 'ws-toasts');
  toasts.setAttribute('role', 'status');
  const side = el('aside', 'ws-side');
  side.id = 'ws-side-panel';
  body.appendChild(lib);
  body.appendChild(stage);
  body.appendChild(side);
  page.appendChild(body);
  const feedbackRow = el('div', 'ws-feedback');
  feedbackRow.append(dragChip, toasts);
  page.appendChild(feedbackRow);
  const bar = el('footer', 'ws-bar');
  const focusMode = button('专注装配', 'ws-tool', () => {
    engine.cancelMotion();
    const focused = page.classList.toggle('ws-focused');
    focusMode.setAttribute('aria-pressed', String(focused));
    if (focused) displayTools.prepend(managePlans);
    else top.insertBefore(managePlans, saveBtn);
    setLibraryOpen(false);
    setSideOpen(false);
    const aspect = Math.max(1, canvasHost.clientWidth) / Math.max(1, canvasHost.clientHeight);
    engine.fitAll(focused ? Math.max(1, 0.68 / aspect) : 1);
  });
  focusMode.setAttribute('aria-pressed', 'false');
  const barControls = el('div', 'ws-bar-controls');
  bar.append(focusMode, barControls);
  page.appendChild(bar);
  root.appendChild(page);

  /* ---------- 提示 ---------- */
  function toast(msg: string, kind: 'ok' | 'err' | 'warn' | 'info' = 'info') {
    const t = el('div', `ws-toast ws-toast-${kind}`, msg);
    toasts.appendChild(t);
    while (toasts.children.length > 4) toasts.firstElementChild?.remove();
    toasts.scrollTop = toasts.scrollHeight;
    setTimeout(() => t.classList.add('out'), kind === 'err' ? 5200 : 3200);
    setTimeout(() => t.remove(), kind === 'err' ? 5700 : 3700);
  }

  /* ---------- 引擎 ---------- */
  let dragDraft: WState | null = null;
  let dockTarget: DockTarget | null = null;
  let dragBlock: string | null = null;
  let dockReason: string | null = null;

  const engine = new WorkshopScene(canvasHost, {
    onSelect(uids, additive) {
      if (additive) {
        const set = new Set(selection);
        for (const u of uids) { if (set.has(u)) set.delete(u); else set.add(u); }
        selection = [...set];
      } else selection = uids;
      activePort = null;
      activeConn = null;
      engine.clearPreview();
      engine.setSelection(selection);
      refreshMarkers();
      renderSide();
      renderBar();
    },
    onPortPick(ref) { handlePortPick(ref); },
    onPortHover(ref) {
      if (!activePort) return;
      if (ref && (ref.uid !== activePort.uid || ref.port !== activePort.port)) previewCandidate(ref);
      else engine.clearPreview();
    },
    onTransformPreview: previewTransform,
    onTransformEnd: finishTransform,
    onTransformCancel: resetTransformPreview,
    onPlace: finishPlacement,
    onPlaceCancel: clearPlacement,
    onBoxSelect(uids) {
      selection = uids;
      activePort = null;
      engine.setSelection(selection);
      refreshMarkers();
      renderSide();
      renderBar();
      if (uids.length) toast(`框选了 ${uids.length} 个零件`, 'info');
    },
    onHover(text) {
      hoverChip.style.display = text ? '' : 'none';
      hoverChip.textContent = text ?? '';
    },
    onDragInfo(text) {
      dragChip.hidden = !text;
      dragChip.textContent = text && (dockTarget ? '接口已对准，松手连接。' : dockReason ?? text) || '';
    }
  });
  engine.setState(state);
  engine.fitAll();

  function addDisplayToggle(label: string, checked: boolean, apply: (on: boolean) => void) {
    const toggle = button(label, 'ws-tool', () => {
      checked = !checked;
      apply(checked);
      syncPressed();
    });
    function syncPressed() {
      toggle.classList.toggle('active', checked);
      toggle.setAttribute('aria-pressed', String(checked));
    }
    syncPressed();
    displayTools.appendChild(toggle);
  }
  addDisplayToggle('网格', true, on => engine.setGrid(on));
  addDisplayToggle('坐标轴', true, on => engine.setAxes(on));
  addDisplayToggle('紧固件', true, on => engine.setShowFasteners(on));
  addDisplayToggle('透视', false, on => engine.setXray(on));
  addDisplayToggle('原理演示', false, on => { engine.demoOn = on; });
  addDisplayToggle('高画质', true, on => engine.setQuality(on ? 'high' : 'low'));
  displayTools.append(
    button('帮助', 'ws-tool', () => { toolsMenu.open = false; openHelpDialog(); }, '操作说明'),
    button('学习记录', 'ws-tool', () => { toolsMenu.open = false; openRecordsDialog(); }, '查看、导出、导入或清除本机学习记录')
  );
  function onOutsideClick(event: MouseEvent) {
    if (event.target instanceof Node && !toolsMenu.contains(event.target)) toolsMenu.open = false;
  }
  document.addEventListener('click', onOutsideClick);

  canvasHost.addEventListener('dragover', (ev) => ev.preventDefault());
  canvasHost.addEventListener('pointerdown', () => {
    if (!page.classList.contains('ws-focused')) return;
    setLibraryOpen(false);
    setSideOpen(false);
  });
  canvasHost.addEventListener('drop', (ev) => {
    ev.preventDefault();
    const pid = ev.dataTransfer?.getData('text/ws-part');
    if (!pid) return;
    const pos = engine.screenToGround(ev.clientX, ev.clientY) ?? [0, 0, 0];
    addInstanceAt(pid, pos as [number, number, number]);
  });

  /* ---------- 同步 ---------- */
  function sync() {
    engine.cancelMotion();
    const displayed = isolatedUid === null ? state : {
      ...state, instances: state.instances.map(instance => ({ ...instance, hidden: instance.uid !== isolatedUid }))
    };
    engine.setState(displayed);
    engine.setSelection(selection);
    refreshMarkers();
    renderSide();
    renderBar();
    scheduleSave();
  }

  function scheduleSave() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saveNow(true), 1000);
  }

  function updateSaveNote(write: ReturnType<typeof savePlan>, automatic = false) {
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    saveNote.classList.toggle('is-error', !write.ok);
    saveNote.textContent = write.ok ? (automatic ? '已自动保存 ' : '已保存 ') + time + ' · 本机浏览器' : '未保存。' + write.error;
  }

  function saveNow(automatic = false) {
    window.clearTimeout(saveTimer);
    saveTimer = 0;
    plan.state = state;
    const write = savePlan(plan);
    updateSaveNote(write, automatic);
    return write;
  }

  function afterMutate() {
    history.push(state);
    sync();
  }

  /* ---------- 选择与变换 ---------- */
  function select(uids: string[]) {
    selection = uids.filter((u) => instOf(state, u));
    activePort = null;
    activeConn = null;
    engine.setSelection(selection);
    refreshMarkers();
    renderSide();
    renderBar();
  }

  function addInstanceAt(
    partId: string, pos: Instance['pos'], spec?: Partial<Instance['spec']>,
    placement: 'exact' | 'near-center' | 'fixture' = 'exact'
  ) {
    const part = partById(partId);
    if (!part) return false;
    if (part.status !== 'ready') { toast(`「${part.name}」属于第 ${part.batch} 批内容，尚在开发中`, 'warn'); return false; }
    const inst: Instance = {
      uid: newUid(), partId, pos, rot: [0, 0, 0],
      spec: { ...part.defaultSpec, ...spec },
      open: manualValve(partId) ? true : undefined
    };
    const next = { ...state, instances: [...state.instances, inst] };
    const affected = new Set([inst.uid]);
    let conflict = placement === 'fixture' ? null : placementError(next, affected);
    if (conflict && placement === 'near-center') {
      const offsets = [[0, 1], [1, 0], [0, -1], [-1, 0]];
      candidate: for (const distance of [0.5, 1, 2, 4]) {
        for (const [dx, dz] of offsets) {
          inst.pos = [pos[0] + dx * distance, pos[1], pos[2] + dz * distance];
          conflict = placementError(next, affected);
          if (!conflict) break candidate;
        }
      }
    }
    if (conflict) { toast(conflict, 'warn'); return false; }
    state = next;
    selection = [inst.uid];
    activePort = null;
    activeConn = null;
    if (!(activeTask && sideTab === 'task')) sideTab = 'sel';
    afterMutate();
    engine.focus([inst.uid]);
    toast(inst.pos === pos ? `已添加「${part.name}」，拖动可移动，点击接口开始连接`
      : `视图中心附近有障碍，已将「${part.name}」放到邻近空位。`, 'ok');
    return true;
  }

  function transformDraft(items: TransformItem[], solo: boolean): WState {
    const next = cloneState(state);
    for (const item of items) {
      const instance = instOf(next, item.uid);
      if (!instance) continue;
      if (solo) {
        const touching = next.connections.filter(connection => connection.a.uid === item.uid || connection.b.uid === item.uid);
        for (const connection of touching) removeConnection(next, connection.id);
      }
      instance.pos = [...item.pos];
      instance.rot = [...item.rot];
    }
    refreshDependents(next);
    return next;
  }

  function placementError(next: WState, affected: ReadonlySet<string>): string | null {
    const conflict = findPoseConflicts(next, 1, affected)[0];
    if (!conflict) return null;
    const uid = affected.has(conflict.moving) ? conflict.obstacle : conflict.moving;
    const neighbor = instOf(next, uid);
    const label = neighbor ? partById(neighbor.partId)?.name : undefined;
    const place = label ? '「' + label + '」' : '相邻零件';
    return conflict.status === 'unresolved'
      ? '无法确认与' + place + '之间的空间，请换一个位置。'
      : '这个位置与' + place + '相交，请换一个位置。';
  }

  function motionError(before: WState, blocked: MotionBlock): string {
    const obstacle = instOf(before, blocked.obstacle);
    const label = obstacle ? partById(obstacle.partId)?.name : undefined;
    return blocked.status === 'unresolved'
      ? `无法验证经过${label ? '「' + label + '」' : '相邻零件'}的路径，移动已停下。`
      : `移动路径被${label ? '「' + label + '」' : '相邻零件'}阻挡。`;
  }

  function commitTransform(next: WState) {
    const broken = Math.max(0, state.connections.length - next.connections.length);
    state = next;
    afterMutate();
    if (broken) toast(`单独移动：已断开 ${broken} 处连接，接口恢复为空闲。`, 'warn');
  }

  function applyTransform(items: TransformItem[], solo: boolean) {
    const next = transformDraft(items, solo);
    const blocked = findMotionBlock(state, next);
    if (blocked) { sync(); toast(motionError(state, blocked), 'warn'); return; }
    commitTransform(next);
  }

  function resetTransformPreview() {
    dragDraft = null;
    dockTarget = null;
    dragBlock = null;
    dockReason = null;
    engine.clearPreview();
  }

  function previewTransform(items: TransformItem[], solo: boolean): string | null {
    dockReason = null;
    const draft = transformDraft(items, solo);
    const lastReachable = dragDraft ?? state;
    const obstruction = findMotionBlock(lastReachable, draft);
    dragBlock = obstruction ? motionError(lastReachable, obstruction) : null;
    const previous = dockTarget;
    const retainsDock = obstruction && previous && pushingAgainstDock(draft, previous, obstruction);
    if (!obstruction) dragDraft = draft;
    const candidatePose = !obstruction || retainsDock ? dragDraft : null;
    const ids = new Set(items.map(item => item.uid));
    const task = activeTask ? taskById(activeTask) : undefined;
    dockTarget = solo || !candidatePose ? null : findDockTarget(
      candidatePose, ids, (targetUid, point, outward) => engine.canSeeDock(targetUid, ids, point, outward), previous,
      { preferredParts: task && new Set(task.allowedParts), onRejected: reason => { dockReason = reason; } }
    );
    if (!dockTarget) {
      engine.clearPreview();
      return dragBlock;
    }
    const aligned = instOf(dockTarget.state, dockTarget.moving.uid);
    const oldPose = previous && instOf(previous.state, previous.moving.uid);
    const samePose = aligned && oldPose && oldPose.uid === aligned.uid
      && oldPose.pos.every((value, index) => value === aligned.pos[index])
      && oldPose.rot.every((value, index) => value === aligned.rot[index]);
    if (aligned && !samePose) engine.setPreview(aligned.partId, aligned.spec, aligned.pos, aligned.rot);
    return dragBlock;
  }

  function pushingAgainstDock(requested: WState, target: DockTarget, obstruction: MotionBlock): boolean {
    const fixed = instOf(target.state, target.fixed.uid);
    const aligned = instOf(target.state, target.moving.uid);
    const actual = instOf(requested, target.moving.uid);
    if (!fixed || !aligned || !actual || obstruction.obstacle !== fixed.uid || obstruction.moving !== aligned.uid) return false;
    const socket = portWorld(fixed, target.fixed.port);
    const goal = portWorld(aligned, target.moving.port);
    const hand = portWorld(actual, target.moving.port);
    if (!socket || !goal || !hand || goal.dir.dot(hand.dir) < 0.94) return false;
    const offset = hand.pos.sub(goal.pos);
    const axial = offset.dot(socket.dir);
    // 沿轴继续推入目标实体时仍停在最后的合法位姿。横向移开或向外退开则解锁。
    return axial <= DOCK_RELEASE_DISTANCE
      && offset.addScaledVector(socket.dir, -axial).lengthSq() <= DOCK_RELEASE_DISTANCE ** 2;
  }

  function finishTransform() {
    const draft = dockTarget?.state ?? dragDraft;
    const paired = dockTarget;
    const blocked = dragBlock ?? dockReason;
    resetTransformPreview();
    if (draft) commitTransform(draft);
    else sync();
    if (paired) toast(`连接成功：${refLabel(paired.fixed)} ↔ ${refLabel(paired.moving)}`, 'ok');
    else if (blocked) toast(blocked, 'warn');
  }

  function rotateSelection(axis: 'x' | 'y' | 'z', quarter: number) {
    if (!selection.length) { toast('请先选中零件', 'warn'); return; }
    const av = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
    const q = new THREE.Quaternion().setFromAxisAngle(av, (Math.PI / 2) * quarter);
    const items = selection.flatMap(uid => {
      const instance = instOf(state, uid);
      if (!instance) return [];
      const cur = new THREE.Quaternion().setFromEuler(new THREE.Euler(...instance.rot, 'XYZ'));
      const e = new THREE.Euler().setFromQuaternion(cur.premultiply(q), 'XYZ');
      const item: TransformItem = { uid, pos: instance.pos, rot: [e.x, e.y, e.z] };
      return [item];
    });
    applyTransform(items, true);
  }

  function duplicateSelection() {
    if (!selection.length) { toast('请先选中要复制的零件', 'warn'); return; }
    const set = new Set(selection);
    /* 连通整体复制时把依赖紧固件一并带上 */
    for (const uid of selection) {
      for (const u of componentOf(state, uid)) set.add(u);
    }
    const uidMap = new Map<string, string>();
    const copies: Instance[] = [];
    for (const uid of set) {
      const inst = instOf(state, uid);
      if (!inst) continue;
      const nid = newUid();
      uidMap.set(uid, nid);
      copies.push({
        ...JSON.parse(JSON.stringify(inst)), uid: nid,
        pos: [...inst.pos]
      });
    }
    const connIdMap = new Map<string, string>();
    const newConns = [];
    for (const c of state.connections) {
      if (c.kind === 'bolt-slot' || c.kind === 'nut' || c.kind === 'clamp') continue;
      if (uidMap.has(c.a.uid) && uidMap.has(c.b.uid)) {
        const nid = newUid();
        connIdMap.set(c.id, nid);
        newConns.push({ ...JSON.parse(JSON.stringify(c)), id: nid, a: { uid: uidMap.get(c.a.uid)!, port: c.a.port }, b: { uid: uidMap.get(c.b.uid)!, port: c.b.port } });
      }
    }
    for (const c of state.connections) {
      if (c.kind !== 'bolt-slot' && c.kind !== 'nut' && c.kind !== 'clamp') continue;
      const remap = (end: { uid: string; port: string }) => {
        if (end.uid.startsWith('joint:')) {
          const base = connIdMap.get(end.uid.slice(6));
          return base ? { uid: `joint:${base}`, port: end.port } : null;
        }
        const u = uidMap.get(end.uid);
        return u ? { uid: u, port: end.port } : null;
      };
      const a = remap(c.a), b = remap(c.b);
      if (a && b) newConns.push({ ...JSON.parse(JSON.stringify(c)), id: newUid(), a, b });
    }
    const sourceBounds = new THREE.Box3();
    for (const [uid, box] of engine.boxes()) if (set.has(uid)) sourceBounds.union(box);
    const span = sourceBounds.isEmpty() ? new THREE.Vector3() : sourceBounds.getSize(new THREE.Vector3());
    const dx = Math.max(1.5, span.x + 0.5);
    const dz = Math.max(1.5, span.z + 0.5);
    const offsets = [[1.5, 1.5], [0, dz], [0, -dz], [dx, 0], [-dx, 0]];
    const ids = copies.map(copy => copy.uid);
    const affected = new Set(ids);
    const next = cloneState(state);
    next.connections.push(...newConns);
    let conflict: string | null = null;
    for (const [x, z] of offsets) {
      next.instances = [...structuredClone(state.instances), ...copies.map(copy => ({
        ...copy, pos: [copy.pos[0] + x, copy.pos[1], copy.pos[2] + z] as Instance['pos']
      }))];
      refreshDependents(next);
      conflict = placementError(next, affected);
      if (!conflict) break;
    }
    if (conflict) { toast(conflict, 'warn'); return; }
    state = next;
    selection = ids;
    afterMutate();
    toast(`已复制 ${copies.length} 个零件（含 ${newConns.length} 处连接），副本独立可编辑`, 'ok');
  }

  function deleteSelection() {
    if (!selection.length) { toast('请先选中要删除的零件', 'warn'); return; }
    const r = deleteInstances(state, selection);
    selection = [];
    activePort = null;
    activeConn = null;
    afterMutate();
    toast(`已删除 ${r.parts} 个零件与 ${r.conns} 处连接（依赖紧固件一并移除），可撤销`, 'info');
  }

  /* ---------- 接口与连接 ---------- */
  function manualValve(id: string) {
    return partById(id)?.category === 'valve' && !['valve-check', 'valve-check-lift', 'valve-safety'].includes(id);
  }

  function markerR(dn: number) { return dn > 0 && DN_TABLE.some(spec => spec.dn === dn) ? Math.max(0.16, odU(dn) / 2 + 0.08) : 0.14; }

  function candidateRefs(): { ref: PortRef; dist: number; kind: string }[] {
    if (!activePort) return [];
    const ai = instOf(state, activePort.uid);
    const aw = ai ? portWorld(ai, activePort.port) : null;
    const out: { ref: PortRef; dist: number; kind: string }[] = [];
    const ap = ai ? portDef(ai, activePort.port) : undefined;
    for (const inst of state.instances) {
      if (inst.uid === activePort.uid || inst.hidden) continue;
      for (const pd of livePorts(inst)) {
        const ref = { uid: inst.uid, port: pd.id };
        const v = validateConnection(state, activePort, ref);
        if (!v.ok) continue;
        const w = portWorld(inst, pd.id);
        out.push({ ref, dist: aw && w ? aw.pos.distanceTo(w.pos) : 0, kind: v.kind });
      }
    }
    if (ap?.type === 'clamp') {
      for (const inst of state.instances) {
        if (inst.hidden || inst.partId !== 'pipe') continue;
        const ref = { uid: inst.uid, port: 'surface' };
        if (validateConnection(state, activePort, ref).ok) {
          out.push({ ref, dist: aw?.pos.distanceTo(new THREE.Vector3(...inst.pos)) ?? 0, kind: 'clamp' });
        }
      }
    }
    if (ap?.type === 'bolt') {
      for (const c of state.connections) {
        if (c.kind !== 'flange') continue;
        const info = jointSlots(state, c.id);
        if (!info) continue;
        for (let s = 0; s < info.count; s++) {
          const ref = { uid: `joint:${c.id}`, port: `slot${s}` };
          if (!validateConnection(state, activePort, ref).ok) continue;
          const w = slotWorld(state, c.id, s);
          out.push({ ref, dist: aw && w ? aw.pos.distanceTo(w.pos) : 0, kind: 'bolt-slot' });
        }
      }
    }
    out.sort((a, b) => a.dist - b.dist);
    return out;
  }

  function refreshMarkers() {
    const markers: PortMarker[] = [];
    if (activePort) {
      const ai = instOf(state, activePort.uid);
      const ap = ai ? portDef(ai, activePort.port) : undefined;
      const aw = ai ? portWorld(ai, activePort.port) : null;
      if (aw && ap) markers.push({ ref: activePort, pos: aw.pos, dir: aw.dir, color: '#eaa23b', r: markerR(ap.dn) });
      for (const cand of candidateRefs()) {
        const surface = cand.ref.port === 'surface' ? instOf(state, cand.ref.uid) : undefined;
        const w = surface ? { pos: new THREE.Vector3(...surface.pos), dir: new THREE.Vector3(0, 1, 0) } : cand.ref.uid.startsWith('joint:')
          ? slotWorld(state, cand.ref.uid.slice(6), Number(cand.ref.port.replace('slot', '')))
          : portWorld(instOf(state, cand.ref.uid)!, cand.ref.port);
        if (w) markers.push({ ref: cand.ref, pos: w.pos, dir: w.dir, color: '#18b57f', r: cand.ref.uid.startsWith('joint:') ? 0.12 : markerR(50) });
      }
    } else if (selection.length === 1) {
      const inst = instOf(state, selection[0]);
      if (inst) {
        for (const pd of livePorts(inst)) {
          const w = portWorld(inst, pd.id);
          if (!w) continue;
          const occ = portOccupied(state, inst.uid, pd.id);
          markers.push({ ref: { uid: inst.uid, port: pd.id }, pos: w.pos, dir: w.dir, color: occ ? '#9aa7b6' : '#1677ff', r: markerR(pd.dn) });
        }
        if (inst.partId === 'bolt') {
          for (const c of state.connections) {
            if (c.kind !== 'flange') continue;
            const info = jointSlots(state, c.id);
            if (!info) continue;
            for (let s = 0; s < info.count; s++) {
              const ref = { uid: `joint:${c.id}`, port: `slot${s}` };
              if (!validateConnection(state, { uid: inst.uid, port: 'shank' }, ref).ok) continue;
              const w = slotWorld(state, c.id, s);
              if (w) markers.push({ ref, pos: w.pos, dir: w.dir, color: '#18b57f', r: 0.12 });
            }
          }
        }
      }
    }
    if (activeConn) {
      const info = jointSlots(state, activeConn);
      if (info) {
        for (let s = 0; s < info.count; s++) {
          const w = slotWorld(state, activeConn, s);
          if (!w) continue;
          const occ = slotOccupied(state, activeConn, s);
          markers.push({ ref: { uid: `joint:${activeConn}`, port: `slot${s}` }, pos: w.pos, dir: w.dir, color: occ ? '#9aa7b6' : '#18b57f', r: 0.12 });
        }
      }
    }
    engine.setPortMarkers(markers);
  }

  function refLabel(ref: PortRef): string {
    if (ref.uid.startsWith('joint:')) {
      const c = state.connections.find((x) => x.id === ref.uid.slice(6));
      const name = c ? partById(instOf(state, c.a.uid)?.partId ?? '')?.name ?? '法兰' : '法兰';
      return `${name}连接 · 孔位 ${Number(ref.port.replace('slot', '')) + 1}`;
    }
    const inst = instOf(state, ref.uid);
    const part = inst ? partById(inst.partId) : undefined;
    const pd = inst ? portDef(inst, ref.port) : undefined;
    return `${part?.name ?? ref.uid} · ${pd?.label ?? (ref.port === 'surface' ? '直管外壁' : ref.port)}`;
  }

  function tryConnect(a: PortRef, b: PortRef) {
    const result = planConnection(state, a, b, { allowLift: activeTask?.startsWith('basic-') || activeTask === 't5-ball' });
    if (!result.ok) {
      engine.clearPreview();
      toast(result.reason, 'err');
      return;
    }
    state = result.state;
    activePort = null;
    engine.clearPreview();
    afterMutate();
    toast(`连接成功：${refLabel(a)} ↔ ${refLabel(b)}（${KIND_LABEL[result.connection.kind]}）`, 'ok');
  }

  function handlePortPick(ref: PortRef) {
    if (activePort) {
      if (ref.uid === activePort.uid && ref.port === activePort.port) {
        activePort = null;
        engine.clearPreview();
        refreshMarkers();
        renderSide();
        return;
      }
      tryConnect(activePort, ref);
      return;
    }
    if (ref.uid.startsWith('joint:')) {
      activeConn = ref.uid.slice(6);
      sideTab = 'ports';
      refreshMarkers();
      renderSide();
      toast('这是法兰螺栓孔位：先添加螺栓并选中，再点击孔位安装；也可在接口面板使用「一键紧固」', 'info');
      return;
    }
    const inst = instOf(state, ref.uid);
    if (!inst) return;
    if (!selection.includes(ref.uid)) select([ref.uid]);
    const pd = portDef(inst, ref.port);
    if (pd) {
      if (portOccupied(state, ref.uid, ref.port)) {
        toast(`「${pd.label}」已有连接，先在选中面板断开后才能重新连接`, 'warn');
        return;
      }
      activePort = ref;
      sideTab = 'ports';
      refreshMarkers();
      renderSide();
      toast(`已选定「${pd.label}」：点击绿色高亮接口完成连接，Esc 取消`, 'info');
    }
  }

  function previewCandidate(ref: PortRef) {
    if (!activePort) return;
    const result = planConnection(state, activePort, ref, { allowLift: activeTask?.startsWith('basic-') || activeTask === 't5-ball' });
    if (!result.ok) { engine.clearPreview(); return; }
    const link = result.connection;
    const movedEnd = link.kind === 'bolt-slot' ? link.a : link.b;
    const moved = instOf(result.state, movedEnd.uid);
    if (moved) engine.setPreview(moved.partId, moved.spec, moved.pos, moved.rot);
  }

  function quickFasteners(connId: string) {
    const result = planFasteners(state, connId);
    if (!result.ok) { toast(result.reason, 'err'); return; }
    if (!result.installed) { toast('所有孔位均已紧固', 'info'); return; }
    state = result.state;
    afterMutate();
    toast(`已完成 ${result.installed} 个 ${result.size} 孔位的紧固件配合`, 'ok');
  }

  /* ---------- 零件库 ---------- */
  const libSearch = el('input', 'search-input ws-lib-search') as HTMLInputElement;
  libSearch.type = 'search';
  libSearch.placeholder = '搜索零件名称或用途…';
  libSearch.setAttribute('aria-label', '搜索零件');
  let libCat: CategoryId | 'all' = 'all';
  const libList = el('div', 'ws-lib-list');
  const libHead = el('div', 'ws-lib-head');
  const libHeading = el('h2', '', '零件库');
  libHeading.id = 'ws-part-library-heading';
  libHead.appendChild(libHeading);
  libHead.appendChild(button('关闭零件库', 'btn btn-outline btn-xs ws-drawer-btn', () => {
    setLibraryOpen(false);
    libToggle.focus();
  }));
  libHead.appendChild(el('span', 'ws-lib-count', `${READY_COUNT} 件可用 · ${CATALOG.length - READY_COUNT} 件开发中`));
  lib.appendChild(libHead);
  const searchWrap = el('div', 'search-wrap ws-lib-searchwrap');
  searchWrap.appendChild(icon(ICONS.search, 15));
  searchWrap.appendChild(libSearch);
  lib.appendChild(searchWrap);
  const libChips = el('div', 'chips ws-lib-chips');
  const catBtns: HTMLButtonElement[] = [];
  const allChip = button('全部', 'chip', () => { libCat = 'all'; renderLib(); });
  allChip.dataset.cat = 'all';
  catBtns.push(allChip);
  libChips.appendChild(allChip);
  for (const cid of Object.keys(CATEGORY_LABEL) as CategoryId[]) {
    const b = button(CATEGORY_LABEL[cid], 'chip', () => { libCat = cid; renderLib(); });
    b.dataset.cat = cid;
    catBtns.push(b);
    libChips.appendChild(b);
  }
  lib.appendChild(libChips);
  const statusFilter = el('select', 'ws-select ws-lib-status') as HTMLSelectElement;
  statusFilter.setAttribute('aria-label', '零件可用状态');
  statusFilter.add(new Option('可用零件', 'ready'));
  statusFilter.add(new Option('开发中与待确认', 'dev'));
  statusFilter.addEventListener('change', () => {
    visibleStatus = statusFilter.value === 'dev' ? 'dev' : 'ready';
    renderLib();
  });
  lib.appendChild(statusFilter);
  const taskFilterRow = el('label', 'ws-task-filter');
  const taskFilterBox = el('input') as HTMLInputElement;
  taskFilterBox.type = 'checkbox';
  taskFilterBox.checked = true;
  taskFilterBox.addEventListener('change', () => { taskOnlyParts = taskFilterBox.checked; renderLib(); });
  taskFilterRow.appendChild(taskFilterBox);
  taskFilterRow.appendChild(el('span', '', '任务进行中只显示任务可用零件'));
  taskFilterRow.style.display = 'none';
  lib.appendChild(taskFilterRow);
  lib.appendChild(libList);
  libSearch.addEventListener('input', renderLib);

  function renderLib() {
    catBtns.forEach((b) => b.classList.toggle('active', b.dataset.cat === libCat));
    const q = libSearch.value.trim().toLowerCase();
    const task = activeTask ? taskById(activeTask) : undefined;
    taskFilterRow.style.display = task ? '' : 'none';
    thumbnails.reset();
    libList.innerHTML = '';
    const list = CATALOG.filter((p) => {
      if (p.status !== visibleStatus) return false;
      if (libCat !== 'all' && p.category !== libCat) return false;
      if (task && taskOnlyParts && !task.allowedParts.includes(p.id)) return false;
      if (!q) return true;
      return [p.name, p.summary, p.usage, ...p.tags].join(' ').toLowerCase().includes(q);
    });
    if (!list.length) {
      libList.appendChild(el('p', 'ws-lib-empty', '没有匹配的零件，换个关键词或分类试试。'));
      return;
    }
    for (const p of list) {
      const item = el('div', `ws-part${p.status === 'dev' ? ' dev' : ''}`);
      item.dataset.partId = p.id;
      const asset = assemblyAssetById.get(p.id);
      const head = el('div', 'ws-part-head');
      const dot = el('span', 'ws-part-dot');
      dot.style.background = p.color;
      head.appendChild(dot);
      const nameBtn = button(p.name, 'ws-part-name', () => {
        item.classList.toggle('expanded');
      }, '展开结构说明');
      head.appendChild(nameBtn);
      head.appendChild(el('span', `ws-part-status ${p.status}`, p.status === 'ready' ? '可用' : `第${p.batch}批开发中`));
      item.appendChild(head);
      item.appendChild(el('p', 'ws-part-cat', `${asset?.code ? asset.code + ' · ' : ''}${CATEGORY_LABEL[p.category]} · 教学简化`));
      const actions = el('div', 'ws-part-actions');
      let chosenSpec: Partial<Instance['spec']> = {};
      if (p.status === 'ready') {
        const add = button('添加到场景', 'btn btn-primary btn-sm', () => startPlacement(p.id, chosenSpec));
        actions.appendChild(add);
        const thumb = el('img', 'ws-part-thumb') as HTMLImageElement;
        thumb.alt = `${p.name}模型预览`;
        thumb.width = 72;
        thumb.height = 48;
        actions.appendChild(thumb);
        thumbnails.add(thumb, p);
        item.draggable = true;
        item.addEventListener('dragstart', (ev) => {
          ev.dataTransfer?.setData('text/ws-part', p.id);
        });
      } else {
        actions.appendChild(el('span', 'ws-dev-note', '模型与接口开发中，内容说明可展开查看'));
      }
      item.appendChild(actions);
      const detail = el('div', 'ws-part-detail');
      if (p.status === 'ready' && (p.parametric?.dnList || p.parametric?.endType)) {
        const spec = el('div', 'ws-spec-row');
        const size = el('select', 'ws-select') as HTMLSelectElement;
        size.setAttribute('aria-label', '添加规格');
        for (const dn of p.parametric.dnList ?? [p.defaultSpec.dn]) size.add(new Option(`DN${dn}（教学）`, String(dn)));
        size.value = String(p.defaultSpec.dn);
        size.addEventListener('change', () => { chosenSpec = { ...chosenSpec, dn: Number(size.value) }; });
        spec.appendChild(size);
        if (p.id === 'reducer-conc' || p.id === 'reducer-ecc') {
          const small = el('select', 'ws-select') as HTMLSelectElement;
          small.setAttribute('aria-label', '添加小端规格');
          const refreshSmall = () => {
            const dn = Number(size.value);
            small.replaceChildren(...reducerSmallOptions(dn).map(value => new Option(`小端 DN${value}`, String(value))));
            small.value = String(reducerSmall(dn));
            chosenSpec = { ...chosenSpec, smallDn: reducerSmall(dn) };
          };
          refreshSmall();
          size.addEventListener('change', refreshSmall);
          small.addEventListener('change', () => { chosenSpec = { ...chosenSpec, smallDn: Number(small.value) }; });
          spec.appendChild(small);
        }
        if (p.parametric.endType) {
          const end = el('select', 'ws-select') as HTMLSelectElement;
          end.setAttribute('aria-label', '添加端部形式');
          end.add(new Option('焊接端', 'weld'));
          end.add(new Option('螺纹端 G', 'thread'));
          end.add(new Option('教学法兰端', 'flange'));
          end.value = p.defaultSpec.endType ?? 'weld';
          end.addEventListener('change', () => {
            if (end.value === 'flange' || end.value === 'thread' || end.value === 'weld') chosenSpec = { ...chosenSpec, endType: end.value };
          });
          spec.appendChild(end);
        }
        detail.appendChild(spec);
      }
      detail.appendChild(el('p', '', p.summary));
      detail.appendChild(el('p', '', `用途：${p.usage}`));
      detail.appendChild(el('p', '', `部件：${p.partsDesc}`));
      detail.appendChild(el('p', '', `接口：${p.portsDesc}`));
      if (asset) {
        detail.appendChild(el('p', '', `关联课程：${courseNames[asset.course]}。模型为本站程序化几何，参考资料用于核对结构。`));
        if (asset.mounting) detail.appendChild(el('p', '', asset.mounting));
        if (asset.signal) detail.appendChild(el('p', '', asset.signal));
        for (const source of asset.sources) {
          const line = el('p', '', source.basis + ' ');
          if (source.url) {
            const link = el('a', '', source.title) as HTMLAnchorElement;
            link.href = source.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            line.appendChild(link);
          } else line.appendChild(el('span', '', source.title));
          detail.appendChild(line);
        }
        const lesson = { flange: 'basic-flange', pipework: 'basic-pipework', pump: 'basic-pump', measurement: null }[asset.course];
        if (lesson) detail.appendChild(button('打开关联课程', 'btn btn-outline btn-xs', () => {
          setLibraryOpen(false);
          setSideOpen(true);
          startTask(lesson);
        }));
      }
      const caps = el('div', 'ws-caps');
      for (const c of p.capabilities) caps.appendChild(el('span', 'ws-cap', CAP_LABEL[c]));
      detail.appendChild(caps);
      const lp = el('ul', 'ws-learn');
      for (const t of p.learnPoints) lp.appendChild(el('li', '', t));
      detail.appendChild(lp);
      item.appendChild(detail);
      libList.appendChild(item);
    }
  }

  function startPlacement(partId: string, spec?: Partial<Instance['spec']>) {
    const part = partById(partId);
    if (!part || part.status !== 'ready') return;
    placingPart = partId;
    placementSpec = spec;
    engine.startPlacement(partId, { ...part.defaultSpec, ...spec });
    const task = activeTask ? taskById(activeTask) : undefined;
    placeHint.replaceChildren(el('span', 'ws-place-caption', task
      ? task.title + ' · 放置「' + part.name + '」'
      : '放置「' + part.name + '」，也可点击网格摆放'));
    const center = button('在视图中心放置', 'btn btn-primary btn-sm', () => finishPlacement(engine.placementCenter(), 'near-center'));
    placeHint.append(center, button('取消放置', 'btn btn-outline btn-sm', () => engine.cancelPlacement()));
    placeHint.hidden = false;
    page.classList.add('is-placing');
    setLibraryOpen(false);
    center.focus();
  }

  function clearPlacement() {
    const restoreFocus = placeHint.contains(document.activeElement);
    placingPart = null;
    placementSpec = undefined;
    placeHint.hidden = true;
    page.classList.remove('is-placing');
    if (restoreFocus) (libToggle.offsetWidth ? libToggle : saveBtn).focus();
  }

  function finishPlacement(pos: Instance['pos'], placement: 'exact' | 'near-center' = 'exact') {
    if (!placingPart) return;
    const partId = placingPart;
    const spec = placementSpec;
    if (!addInstanceAt(partId, pos, spec, placement)) return;
    engine.cancelPlacement(false);
    clearPlacement();
  }

  /* ---------- 右侧面板 ---------- */
  const sideTabs = el('div', 'ws-side-tabs');
  const sideBody = el('div', 'ws-side-body');
  side.appendChild(sideTabs);
  side.appendChild(sideBody);
  const tabDefs: { id: SideTab; label: string }[] = [
    { id: 'sel', label: '选中对象' }, { id: 'ports', label: '接口连接' },
    { id: 'task', label: '组装任务' }, { id: 'group', label: '分组' }
  ];
  for (const t of tabDefs) {
    sideTabs.appendChild(button(t.label, 'ws-side-tab', () => { sideTab = t.id; renderSide(); }));
  }

  function renderSide() {
    [...sideTabs.children].forEach((b, i) => b.classList.toggle('active', tabDefs[i].id === sideTab));
    sideBody.innerHTML = '';
    if (state.instances.length && (sideTab === 'sel' || sideTab === 'ports') && !activePort && !activeConn) {
      const picker = el('select', 'ws-select ws-instance-picker') as HTMLSelectElement;
      picker.setAttribute('aria-label', '选择场景零件');
      picker.add(new Option('选择场景零件', ''));
      for (const item of state.instances) picker.add(new Option(`${partById(item.partId)?.name} · ${item.uid.slice(-5)}`, item.uid));
      picker.value = selection.length === 1 ? selection[0] : '';
      picker.addEventListener('change', () => select(picker.value ? [picker.value] : []));
      sideBody.appendChild(picker);
    }
    if (sideTab === 'sel') renderSelTab();
    else if (sideTab === 'ports') renderPortsTab();
    else if (sideTab === 'task') renderTaskTab();
    else renderGroupTab();
  }

  function specEditor(inst: Instance) {
    const part = partById(inst.partId)!;
    const box = el('div', 'ws-spec');
    box.appendChild(el('h3', '', '规格参数'));
    const dnList = part.parametric?.dnList
      ?? (inst.partId === 'bolt' || inst.partId === 'nut' ? [12, 16, 20] : null);
    const row1 = el('div', 'ws-spec-row');
    row1.appendChild(el('label', '', inst.partId === 'bolt' || inst.partId === 'nut' ? '螺纹规格' : '公称尺寸 DN'));
    if (dnList) {
      const sel = el('select', 'ws-select') as HTMLSelectElement;
      for (const dn of dnList) {
        const o = el('option', '', inst.partId === 'bolt' || inst.partId === 'nut' ? `M${dn}` : `DN${dn}`);
        o.value = String(dn);
        sel.appendChild(o);
      }
      sel.value = String(inst.spec.dn);
      sel.addEventListener('change', () => changeSpec(inst.uid, { dn: Number(sel.value) }));
      row1.appendChild(sel);
    } else {
      const fluid = livePorts(inst).some(isFluidPort);
      row1.firstChild!.textContent = '规格族';
      row1.appendChild(el('span', 'ws-spec-fixed', fluid ? `DN${inst.spec.dn}（教学接口）` : '固定教学配合'));

    }
    box.appendChild(row1);
    const ds = DN_TABLE.find(spec => spec.dn === inst.spec.dn);
    if (ds && livePorts(inst).some(isFluidPort)) box.appendChild(el('p', 'ws-spec-note', `外径 ${fmtMm(ds.od)} · 内径约 ${fmtMm(ds.od - 2 * ds.wall)} · 壁厚 ${fmtMm(ds.wall)}（教学简化）`));
    if (part.parametric?.length) {
      const [min, max, step] = part.parametric.length;
      const row2 = el('div', 'ws-spec-row');
      row2.appendChild(el('label', '', `长度 ${inst.spec.length ?? 500} mm`));
      const range = el('input') as HTMLInputElement;
      range.type = 'range';
      range.min = String(min); range.max = String(max); range.step = String(step);
      range.value = String(inst.spec.length ?? 500);
      range.addEventListener('input', () => {
        (row2.firstChild as HTMLElement).textContent = `长度 ${range.value} mm`;
      });
      range.addEventListener('change', () => changeSpec(inst.uid, { length: Number(range.value) }));
      row2.appendChild(range);
      box.appendChild(row2);
    }
    if (part.parametric?.endType) {
      const row3 = el('div', 'ws-spec-row');
      row3.appendChild(el('label', '', '端部形式'));
      const sel = el('select', 'ws-select') as HTMLSelectElement;
      for (const [v, label] of [['weld', '焊接端'], ['thread', '螺纹端 G'], ['flange', '法兰端 PN16']] as const) {
        const o = el('option', '', label);
        o.value = v;
        sel.appendChild(o);
      }
      sel.value = inst.spec.endType ?? 'weld';
      sel.addEventListener('change', () => changeSpec(inst.uid, { endType: sel.value as Instance['spec']['endType'] }));
      row3.appendChild(sel);
      box.appendChild(row3);
    }
    if (inst.partId === 'flange-so' || inst.partId === 'flange-wn' || inst.partId === 'flange-blind' || inst.partId === 'gasket') {
      const f = flangeSpec(inst.spec.dn);
      box.appendChild(el('p', 'ws-spec-note', `PN16 法兰（教学示意）：外径 ${f.d} · 孔中心圆 ${f.k} · ${f.n}×⌀${f.hole} · 配 ${f.bolt} 螺栓`));
    }
    if (inst.partId === 'reducer-conc' || inst.partId === 'reducer-ecc') {
      const opts = reducerSmallOptions(inst.spec.dn);
      const row = el('div', 'ws-spec-row');
      row.appendChild(el('label', '', '小端公称尺寸'));
      const sel = el('select', 'ws-select') as HTMLSelectElement;
      for (const dn of opts) {
        const o = el('option', '', `DN${dn}`);
        o.value = String(dn);
        sel.appendChild(o);
      }
      sel.value = String(inst.spec.smallDn ?? reducerSmall(inst.spec.dn));
      sel.addEventListener('change', () => changeSpec(inst.uid, { smallDn: Number(sel.value) }));
      row.appendChild(sel);
      box.appendChild(row);
      box.appendChild(el('p', 'ws-spec-note', '小端按预设配对选择，大端/小端口径分别记录；更换大端 DN 后小端重置为默认配对。'));
    }
    return box;
  }

  function changeSpec(uid: string, patch: Partial<Instance['spec']>) {
    const next = cloneState(state);
    const inst = instOf(next, uid);
    if (!inst) return;
    const priorConnections = next.connections.length;
    const touching = next.connections.filter(connection => connection.a.uid === uid || connection.b.uid === uid);
    for (const connection of touching) removeConnection(next, connection.id);
    inst.spec = { ...inst.spec, ...patch };
    if ((inst.partId === 'reducer-conc' || inst.partId === 'reducer-ecc')
      && inst.spec.smallDn !== undefined && !reducerSmallValid(inst.spec.dn, inst.spec.smallDn)) {
      delete inst.spec.smallDn;
    }
    refreshDependents(next);
    const conflict = placementError(next, new Set([uid]));
    if (conflict) { renderSide(); toast(conflict, 'warn'); return; }
    const broken = priorConnections - next.connections.length;
    state = next;
    afterMutate();
    if (broken) toast(`规格变更使 ${broken} 处连接失效并已断开，请重新连接`, 'warn');
  }

  function renderSelTab() {
    if (!selection.length) {
      sideBody.appendChild(el('p', 'ws-side-empty', '点击场景中的零件查看参数与结构说明；Shift+拖动可框选多个零件。'));
      const stats = el('div', 'ws-stats');
      stats.appendChild(el('div', 'ws-stat', `零件 ${state.instances.length}`));
      stats.appendChild(el('div', 'ws-stat', `连接 ${state.connections.length}`));
      stats.appendChild(el('div', 'ws-stat', `分组 ${state.groups.length}`));
      sideBody.appendChild(stats);
      sideBody.appendChild(el('p', 'ws-side-note', 'DN 为公称尺寸；外径、内径、壁厚与法兰尺寸分开记录，预设按标准系列核对，简化值均标注「教学示意」。'));
      return;
    }
    if (selection.length > 1) {
      sideBody.appendChild(el('h3', '', `已选中 ${selection.length} 个零件`));
      const acts = el('div', 'ws-acts');
      acts.appendChild(button('聚焦', 'btn btn-outline btn-sm', () => engine.focus(selection)));
      acts.appendChild(button('复制整体', 'btn btn-outline btn-sm', duplicateSelection));
      acts.appendChild(button('编为分组', 'btn btn-outline btn-sm', () => { groupSelection(); sideTab = 'group'; renderSide(); }));
      acts.appendChild(button('删除', 'btn btn-danger btn-sm', deleteSelection));
      sideBody.appendChild(acts);
      sideBody.appendChild(el('p', 'ws-side-note', '拖动任一选中零件会整体移动其连通管段与分组成员；按住 Alt 拖动可单独移动（会断开连接）。'));
      return;
    }
    const inst = instOf(state, selection[0])!;
    const part = partById(inst.partId)!;
    const head = el('div', 'ws-sel-head');
    head.appendChild(el('h3', '', part.name));
    head.appendChild(el('span', 'ws-sel-cat', CATEGORY_LABEL[part.category]));
    sideBody.appendChild(head);
    sideBody.appendChild(el('p', 'ws-sel-material', `材质：${MATERIAL_LABEL[part.material]} · 实例 ${inst.uid.slice(-5)}`));

    sideBody.appendChild(specEditor(inst));

    if (manualValve(part.id)) {
      const vrow = el('div', 'ws-spec-row');
      vrow.appendChild(el('label', '', '阀门状态'));
      const open = inst.open !== false;
      const toggle = button(open ? '开启中 · 点击关闭' : '关闭中 · 点击开启', `btn btn-sm ${open ? 'btn-primary' : 'btn-outline'}`, () => {
        inst.open = !open;
        afterMutate();
        toast(open ? '阀门已关闭：连通路径将被切断' : '阀门已开启', 'info');
      });
      vrow.appendChild(toggle);
      sideBody.appendChild(vrow);
    }

    const acts = el('div', 'ws-acts');
    acts.appendChild(button('聚焦', 'btn btn-outline btn-sm', () => engine.focus([inst.uid])));
    acts.appendChild(button('复制', 'btn btn-outline btn-sm', duplicateSelection));
    acts.appendChild(button(inst.hidden ? '显示' : '隐藏', 'btn btn-outline btn-sm', () => {
      inst.hidden = !inst.hidden;
      afterMutate();
    }));
    acts.appendChild(button(isolatedUid ? '退出隔离' : '隔离查看', 'btn btn-outline btn-sm', () => {
      isolatedUid = isolatedUid ? null : inst.uid;
      sync();
    }));
    acts.appendChild(button('删除', 'btn btn-danger btn-sm', deleteSelection));
    sideBody.appendChild(acts);

    if (activeTask === 'basic-pump' && (inst.partId === 'P040' || inst.partId === 'P048')) {
      sideBody.appendChild(button(inst.partId === 'P040' ? '预定位泵盖' : '预定位密封腔', 'btn btn-primary btn-sm', () => {
        const next = stagePumpRingAssembly(state, inst.uid);
        if (!next) {
          toast('先装好泵轴，密封腔须先入静环。检查吸入侧预定位路径。', 'warn');
          return;
        }
        commitTransform(next);
        toast('零件已套到轴线待装，后续仍须完成对应机械连接。', 'ok');
      }));
    }
    const positionRow = el('div', 'ws-spec-row ws-position');
    for (const [index, axis] of ['X', 'Y', 'Z'].entries()) {
      const input = el('input', 'ws-select') as HTMLInputElement;
      input.type = 'number';
      input.step = '0.1';
      input.min = '-1000'; input.max = '1000';
      input.value = String(Number(inst.pos[index].toFixed(4)));
      input.setAttribute('aria-label', `${axis} 位置（场景单位）`);
      input.addEventListener('change', () => {
        const value = input.valueAsNumber;
        if (!Number.isFinite(value) || Math.abs(value) > 1000) { input.value = String(inst.pos[index]); return; }
        const distance = value - inst.pos[index];
        const members = componentOf(state, inst.uid);
        applyTransform(state.instances.filter(item => members.has(item.uid)).map(item => {
          const pos: Instance['pos'] = [...item.pos];
          pos[index] += distance;
          return { uid: item.uid, pos, rot: [...item.rot] };
        }), false);
      });
      positionRow.appendChild(input);
    }
    sideBody.appendChild(el('p', 'ws-side-note', '位置 X/Y/Z（1 场景单位 = 100 mm），修改位置会整体移动子装配。'));
    sideBody.appendChild(positionRow);

    const rotBox = el('div', 'ws-rot');
    rotBox.appendChild(el('h3', '', '固定角度旋转（每次 90°）'));
    const rotRow = el('div', 'ws-acts');
    for (const axis of ['x', 'y', 'z'] as const) {
      rotRow.appendChild(button(`${axis.toUpperCase()} +90°`, 'btn btn-outline btn-sm', () => rotateSelection(axis, 1)));
      rotRow.appendChild(button(`${axis.toUpperCase()} −90°`, 'btn btn-outline btn-sm', () => rotateSelection(axis, -1)));
    }
    rotBox.appendChild(rotRow);
    rotBox.appendChild(el('p', 'ws-side-note', '也可切换底部「旋转」模式后在场景中自由拖动旋转；旋转按单独操作处理，会断开已有连接。'));
    sideBody.appendChild(rotBox);

    /* 连接列表 */
    const conns = state.connections.filter((c) => c.a.uid === inst.uid || c.b.uid === inst.uid);
    const connBox = el('div', 'ws-conns');
    connBox.appendChild(el('h3', '', `连接（${conns.length}）`));
    if (!conns.length) connBox.appendChild(el('p', 'ws-side-note', '暂无连接。点击零件接口或到「接口连接」面板开始。'));
    for (const c of conns) {
      const other = c.a.uid === inst.uid ? c.b : c.a;
      const row = el('div', 'ws-conn-row');
      row.appendChild(el('span', 'ws-conn-kind', KIND_LABEL[c.kind]));
      row.appendChild(el('span', 'ws-conn-other', refLabel(other)));
      if (c.kind === 'flange') {
        row.appendChild(button('螺栓孔', 'btn btn-outline btn-xs', () => {
          activeConn = c.id;
          sideTab = 'ports';
          refreshMarkers();
          renderSide();
        }));
      }
      row.appendChild(button('断开', 'btn btn-danger btn-xs', () => {
        const n = removeConnection(state, c.id);
        if (activeConn === c.id) activeConn = null;
        refreshDependents(state);
        afterMutate();
        toast(`已断开连接（含 ${n - 1} 处依赖紧固），零件保留在原位`, 'info');
      }));
      connBox.appendChild(row);
    }
    sideBody.appendChild(connBox);

    /* 结构说明 */
    const info = el('div', 'ws-info');
    info.appendChild(el('h3', '', '结构与学习要点'));
    info.appendChild(el('p', '', part.summary));
    info.appendChild(el('p', '', `用途：${part.usage}`));
    info.appendChild(el('p', '', `部件：${part.partsDesc}`));
    info.appendChild(el('p', '', `接口：${part.portsDesc}`));
    const caps = el('div', 'ws-caps');
    for (const cp of part.capabilities) caps.appendChild(el('span', 'ws-cap', CAP_LABEL[cp]));
    info.appendChild(caps);
    const lp = el('ul', 'ws-learn');
    for (const t of part.learnPoints) lp.appendChild(el('li', '', t));
    info.appendChild(lp);
    sideBody.appendChild(info);
  }

  function renderPortsTab() {
    if (activePort) {
      const head = el('div', 'ws-active-port');
      head.appendChild(el('h3', '', `正在连接：${refLabel(activePort)}`));
      head.appendChild(button('取消连接', 'btn btn-outline btn-sm', () => {
        activePort = null;
        engine.clearPreview();
        refreshMarkers();
        renderSide();
      }));
      sideBody.appendChild(head);
      sideBody.appendChild(el('p', 'ws-side-note', '靠近绿色接口或悬停候选行可预览配合位置。点击绿色接口或「连接」才记录装配。'));
      const cands = candidateRefs();
      if (!cands.length) {
        sideBody.appendChild(el('p', 'ws-side-empty', '当前没有合法目标：检查规格是否一致、接口是否被占用，或先添加匹配零件。'));
      }
      for (const cand of cands.slice(0, 16)) {
        const row = el('div', 'ws-cand-row');
        row.dataset.uid = cand.ref.uid;
        row.dataset.port = cand.ref.port;
        row.appendChild(el('span', 'ws-cand-name', refLabel(cand.ref)));
        row.appendChild(el('span', 'ws-cand-dist', `${Math.round(cand.dist * 100)} mm`));
        row.appendChild(button('连接', 'btn btn-primary btn-xs', () => tryConnect(activePort!, cand.ref)));
        row.addEventListener('mouseenter', () => previewCandidate(cand.ref));
        row.addEventListener('mouseleave', () => engine.clearPreview());
        sideBody.appendChild(row);
      }
      return;
    }
    if (activeConn) {
      const info = jointSlots(state, activeConn);
      const head = el('div', 'ws-active-port');
      head.appendChild(el('h3', '', '法兰螺栓孔位'));
      head.appendChild(button('关闭孔位视图', 'btn btn-outline btn-sm', () => { activeConn = null; refreshMarkers(); renderSide(); }));
      sideBody.appendChild(head);
      if (info) {
        sideBody.appendChild(el('p', 'ws-side-note', `该连接需 ${info.count} 只 ${info.bolt} 螺栓。教学模式：从零件库添加螺栓，选中后点击绿色孔位逐个安装，再为螺栓螺纹端旋合螺母。`));
        const acts = el('div', 'ws-acts');
        acts.appendChild(button(`一键紧固（自由模式）`, 'btn btn-primary btn-sm', () => quickFasteners(activeConn!)));
        acts.appendChild(button('添加一只螺栓', 'btn btn-outline btn-sm', () => startPlacement('bolt')));
        acts.appendChild(button('添加一只螺母', 'btn btn-outline btn-sm', () => startPlacement('nut')));
        sideBody.appendChild(acts);
        for (let s = 0; s < info.count; s++) {
          const occ = slotOccupied(state, activeConn, s);
          const row = el('div', 'ws-cand-row');
          row.appendChild(el('span', 'ws-cand-name', `孔位 ${s + 1}`));
          row.appendChild(el('span', occ ? 'ws-cand-occ' : 'ws-cand-free', occ ? '已紧固' : '空闲'));
          sideBody.appendChild(row);
        }
        sideBody.appendChild(el('p', 'ws-side-note', '教学提示：实际法兰紧固应对角交叉、分次均匀拧紧，保证垫片受力均匀。'));
      }
      return;
    }
    const uid = selection[0];
    const inst = uid ? instOf(state, uid) : undefined;
    if (!inst) {
      sideBody.appendChild(el('p', 'ws-side-empty', '选中一个零件后，这里列出它的全部接口；点击接口开始连接。'));
      sideBody.appendChild(el('p', 'ws-side-note', `连接类型：法兰 / 螺纹 / 焊接。${STANDARD_NOTE['PN16'] ?? ''}`));
      return;
    }
    sideBody.appendChild(el('h3', '', `${partById(inst.partId)?.name} 的接口`));
    for (const pd of livePorts(inst)) {
      const occ = portOccupied(state, inst.uid, pd.id);
      const row = el('div', 'ws-port-row');
      row.dataset.port = pd.id;
      const meta = el('div', 'ws-port-meta');
      meta.appendChild(el('span', 'ws-port-name', pd.label));
      meta.appendChild(el('span', 'ws-port-spec', `${PORT_TYPE_LABEL[pd.type]}${pd.mate ? ' · ' + pd.mate.family : ' · DN' + pd.dn}${pd.standard ? ` · ${pd.standard}` : ''}${pd.flow && pd.flow !== 'both' ? (pd.flow === 'in' ? ' · 进口' : ' · 出口') : ''}${pd.blind ? ' · 盲板' : ''}`));
      row.appendChild(meta);
      if (occ) {
        row.appendChild(el('span', 'ws-cand-occ', '已连接'));
      } else {
        row.appendChild(button('开始连接', 'btn btn-primary btn-xs', () => handlePortPick({ uid: inst.uid, port: pd.id })));
      }
      sideBody.appendChild(row);
    }
    if (inst.partId === 'clamp' || inst.partId === 'support') {
      sideBody.appendChild(el('p', 'ws-side-note', '管夹/支架安装：点击「开始连接」后选择一段同规格直管，安装位置按当前相对位置确定，用于支撑关系教学。'));
    }
    sideBody.appendChild(el('p', 'ws-side-note', '每个接口只能有一处连接；不同规格需异径管过渡；有流向的部件按进口对出口安装。'));
  }

  /* ---------- 任务 ---------- */
  function renderTaskTab() {
    const task = activeTask ? taskById(activeTask) : undefined;
    if (!task) {
      sideBody.appendChild(el('p', 'ws-side-note', '由浅入深的组装任务：每个任务给出目标、可用零件、步骤与判定规则，可随时查看半透明参考方案。自由搭建不受任务限制。'));
      for (const t of TASKS) {
        const prog = plan.taskProgress[t.id]?.completedAt;
        const locked = t.batch > 1;
        const row = el('div', `ws-task-row${locked ? ' locked' : ''}`);
        const meta = el('div', 'ws-task-meta');
        meta.appendChild(el('span', 'ws-task-title', t.title));
        meta.appendChild(el('span', 'ws-task-sub', locked ? '依赖第二批对象 · 开发中' : prog ? `已完成 ${new Date(prog).toLocaleDateString('zh-CN')}` : '未开始'));
        row.appendChild(meta);
        if (!locked) {
          row.appendChild(button(prog ? '重做' : '开始', 'btn btn-primary btn-xs', () => startTask(t.id)));
        } else {
          row.appendChild(el('span', 'ws-part-status dev', '锁定'));
        }
        sideBody.appendChild(row);
      }
      return;
    }
    const head = el('div', 'ws-active-port');
    head.appendChild(el('h3', '', task.title));
    head.appendChild(button('退出任务', 'btn btn-outline btn-sm', () => {
      activeTask = null;
      plan.activeTask = undefined;
      saveNow();
      lastTaskResult = null;
      setReference(false);
      renderLib();
      renderSide();
    }));
    sideBody.appendChild(head);
    sideBody.appendChild(el('p', 'ws-task-goal', task.goal));
    if (task.prerequisites) sideBody.appendChild(el('p', 'ws-side-note', '前置知识 · ' + task.prerequisites));
    sideBody.appendChild(el('p', 'ws-side-note', '所需零件 · ' + task.allowedParts.map(id => partById(id)?.name ?? id).join('、')));
    const steps = el('ol', 'ws-steps');
    for (const s of task.steps) steps.appendChild(el('li', '', s));
    sideBody.appendChild(steps);
    if (task.rules.length) {
      const rules = el('ul', 'ws-learn');
      for (const r of task.rules) rules.appendChild(el('li', '', r));
      sideBody.appendChild(rules);
    }
    for (const [index, question] of (task.questions ?? []).entries()) {
      const line = el('label', 'ws-task-question');
      line.appendChild(el('span', '', question.prompt));
      const answer = el('select', 'ws-select') as HTMLSelectElement;
      answer.add(new Option('请选择', ''));
      question.options.forEach((option, i) => answer.add(new Option(option, String(i))));
      const previous = taskAnswers.get(index);
      if (previous !== undefined) answer.value = String(previous);
      answer.addEventListener('change', () => {
        if (answer.value) taskAnswers.set(index, Number(answer.value)); else taskAnswers.delete(index);
      });
      line.appendChild(answer);
      sideBody.appendChild(line);
    }
    const acts = el('div', 'ws-acts');
    acts.appendChild(button('检查完成情况', 'btn btn-primary btn-sm', () => runTaskCheck(task.id)));
    acts.appendChild(button(refOn ? '隐藏参考方案' : '显示参考方案', 'btn btn-outline btn-sm', () => setReference(!refOn)));
    if (task.id === 'basic-pump') {
      acts.appendChild(button(refExploded ? '复位爆炸参考' : '显示爆炸参考', 'btn btn-outline btn-sm', () => {
        setReference(true, !refExploded);
      }));
    }
    acts.appendChild(button('重新开始', 'btn btn-danger btn-sm', () => {
      if (!confirm('重新开始将清空当前场景（可撤销），确定吗？')) return;
      state.instances = [];
      state.connections = [];
      state.groups = [];
      selection = [];
      activePort = null;
      activeConn = null;
      lastTaskResult = null;
      taskAnswers.clear();
      engine.setFlowPositions(null);
      afterMutate();
      toast('场景已清空，重新搭建吧', 'info');
    }));
    sideBody.appendChild(acts);
    if (lastTaskResult) {
      const res = el('div', `ws-task-result${lastTaskResult.done ? ' done' : ''}`);
      res.appendChild(el('h3', '', lastTaskResult.done ? '任务完成！' : '尚未完成'));
      for (const it of lastTaskResult.items) {
        res.appendChild(el('p', `ws-check-item ${it.ok ? 'ok' : 'bad'}`, `${it.ok ? '✓' : '✗'} ${it.label}`));
      }
      for (const p of lastTaskResult.problems) {
        res.appendChild(el('p', 'ws-check-problem', p));
      }
      if (lastTaskResult.done) res.appendChild(el('p', 'ws-side-note', '通过本课的零件、连接或辨识检查。是否写入本机请查看保存状态。'));
      sideBody.appendChild(res);
    }
  }

  function startTask(id: string) {
    if (refOn) setReference(false);
    taskAnswers.clear();
    activeTask = id;
    plan.activeTask = id;
    visibleStatus = 'ready';
    statusFilter.value = 'ready';
    saveNow();
    lastTaskResult = null;
    sideTab = 'task';
    taskOnlyParts = true;
    taskFilterBox.checked = true;
    renderLib();
    renderSide();
    const t = taskById(id)!;
    toast(`任务开始：${t.title}。零件库已切换为任务可用零件`, 'info');
  }

  function runTaskCheck(id: string) {
    const t = taskById(id);
    if (!t) return;
    const r = t.check(state);
    for (const [index, question] of (t.questions ?? []).entries()) {
      const answer = taskAnswers.get(index);
      const ok = answer === question.correct;
      r.items.push({ label: question.prompt, ok });
      if (!ok) {
        r.done = false;
        r.problems.push(answer === undefined ? '请回答：' + question.prompt : question.explanation);
      }
    }
    lastTaskResult = r;
    const prev = plan.taskProgress[id];
    plan.taskProgress[id] = { completedAt: r.done ? Date.now() : prev?.completedAt ?? 0, attempts: (prev?.attempts ?? 0) + 1 };
    if (r.done && (!prev || !prev.completedAt)) {
      toast(`恭喜完成「${t.title}」！`, 'ok');
    } else if (!r.done) {
      toast(r.problems[0] ?? '还有检查项未通过，查看任务面板', 'warn');
    }
    saveNow();
    renderSide();
    renderBar();
  }

  function setReference(on: boolean, exploded = false) {
    const wasOn = refOn;
    refOn = on;
    refExploded = on && exploded;
    const t = activeTask ? taskById(activeTask) : undefined;
    const reference = on && t?.reference ? t.reference() : null;
    if (reference && refExploded) {
      for (const [index, instance] of reference.instances.entries()) {
        instance.pos = [instance.pos[0] + (index - 5.5) * 1.8, instance.pos[1] + (index % 2) * 0.7, instance.pos[2]];
      }
    }
    engine.setReference(reference);
    renderSide();
    if (on && !wasOn) toast('半透明橙色为对照参考，任务按场景中实际安装的零件判定。', 'info');
  }

  /* ---------- 分组 ---------- */
  function groupSelection() {
    if (!selection.length) { toast('请先选中要编组的零件', 'warn'); return; }
    const g = { id: newUid(), name: `分组 ${state.groups.length + 1}`, color: ['#1677ff', '#2e9d74', '#eaa23b', '#d64545', '#7c5cd6'][state.groups.length % 5] };
    state.groups.push(g);
    for (const uid of selection) {
      const inst = instOf(state, uid);
      if (inst) inst.groupId = g.id;
    }
    afterMutate();
    toast(`已创建「${g.name}」（${selection.length} 件），拖动成员时整组移动`, 'ok');
  }

  function autoGroupByNetwork() {
    const seen = new Set<string>();
    let created = 0;
    for (const inst of state.instances) {
      if (seen.has(inst.uid)) continue;
      const comp = componentOf(state, inst.uid);
      for (const u of comp) seen.add(u);
      if (comp.size < 2) continue;
      const g = { id: newUid(), name: `连通管段 ${state.groups.length + 1}`, color: ['#1677ff', '#2e9d74', '#eaa23b', '#d64545', '#7c5cd6'][state.groups.length % 5] };
      state.groups.push(g);
      for (const u of comp) {
        const i = instOf(state, u);
        if (i) i.groupId = g.id;
      }
      created++;
    }
    afterMutate();
    toast(created ? `按连接网络自动划分了 ${created} 个管段分组` : '没有可分组的连通管段（至少两件相连）', created ? 'ok' : 'warn');
  }

  function renderGroupTab() {
    const acts = el('div', 'ws-acts');
    acts.appendChild(button('把选中零件编组', 'btn btn-primary btn-sm', groupSelection));
    acts.appendChild(button('按连通管段自动分组', 'btn btn-outline btn-sm', autoGroupByNetwork));
    sideBody.appendChild(acts);
    sideBody.appendChild(el('p', 'ws-side-note', '分组用于按设备、管段或功能区管理：整组隐藏、聚焦与移动。拖动分组成员时整组一起移动。'));
    if (!state.groups.length) {
      sideBody.appendChild(el('p', 'ws-side-empty', '还没有分组。'));
      return;
    }
    for (const g of state.groups) {
      const members = state.instances.filter((i) => i.groupId === g.id);
      const row = el('div', 'ws-group-row');
      const dot = el('span', 'ws-part-dot');
      dot.style.background = g.color;
      row.appendChild(dot);
      const nameInput = el('input', 'ws-group-name') as HTMLInputElement;
      nameInput.value = g.name;
      nameInput.addEventListener('change', () => { g.name = nameInput.value.trim() || g.name; afterMutate(); });
      row.appendChild(nameInput);
      row.appendChild(el('span', 'ws-group-count', `${members.length} 件`));
      const allHidden = members.length > 0 && members.every((m) => m.hidden);
      row.appendChild(button(allHidden ? '显示' : '隐藏', 'btn btn-outline btn-xs', () => {
        for (const m of members) m.hidden = !allHidden;
        afterMutate();
      }));
      row.appendChild(button('聚焦', 'btn btn-outline btn-xs', () => engine.focus(members.map((m) => m.uid))));
      row.appendChild(button('选中', 'btn btn-outline btn-xs', () => select(members.map((m) => m.uid))));
      row.appendChild(button('解散', 'btn btn-danger btn-xs', () => {
        for (const m of members) delete m.groupId;
        state.groups = state.groups.filter((x) => x.id !== g.id);
        afterMutate();
      }));
      sideBody.appendChild(row);
    }
  }

  /* ---------- 底部工具栏 ---------- */
  function renderBar() {
    const focused = document.activeElement;
    const focusLabel = focused instanceof HTMLButtonElement && barControls.contains(focused) ? focused.textContent : null;
    barControls.innerHTML = '';
    const seg1 = el('div', 'ws-seg');
    for (const [m, label, tip] of [['select', '选择', '点击选择，拖动移动连通整体'], ['move', '移动', '拖动零件移动，配合轴向锁定'], ['rotate', '旋转', '拖动零件自由旋转（单独操作）']] as const) {
      const b = button(label, `ws-tool${engine.mode === m ? ' active' : ''}`, () => { engine.mode = m; renderBar(); }, tip);
      seg1.appendChild(b);
    }
    barControls.appendChild(seg1);
    const seg2 = el('div', 'ws-seg');
    for (const [a, label] of [['free', '自由'], ['x', 'X 轴'], ['y', 'Y 轴'], ['z', 'Z 轴']] as const) {
      const b = button(label, `ws-tool${engine.axis === a ? ' active' : ''}`, () => { engine.axis = a; renderBar(); }, '移动轴向锁定');
      seg2.appendChild(b);
    }
    barControls.appendChild(seg2);
    const seg3 = el('div', 'ws-seg');
    const undoB = button('撤销', 'ws-tool', doUndo, 'Ctrl+Z');
    undoB.disabled = !history.canUndo;
    const redoB = button('重做', 'ws-tool', doRedo, 'Ctrl+Y');
    redoB.disabled = !history.canRedo;
    seg3.appendChild(undoB);
    seg3.appendChild(redoB);
    seg3.appendChild(button('复制', 'ws-tool', duplicateSelection, 'Ctrl+D · 复制选中及其连通整体'));
    seg3.appendChild(button('删除', 'ws-tool danger', deleteSelection, 'Delete'));
    barControls.appendChild(seg3);
    const snapB = button('吸附', `ws-tool${engine.snapOn ? ' active' : ''}`, () => {
      engine.snapOn = !engine.snapOn;
      snapB.classList.toggle('active', engine.snapOn);
      snapB.setAttribute('aria-pressed', String(engine.snapOn));
    }, '50mm 位置吸附 / 15° 旋转吸附');
    snapB.setAttribute('aria-pressed', String(engine.snapOn));
    seg2.appendChild(snapB);
    const seg5 = el('div', 'ws-seg');
    seg5.appendChild(button('连通检查', 'ws-tool accent', openConnectDialog, '检查指定进出口连通性，成功后显示流向动画'));
    seg5.appendChild(button('干涉检查', 'ws-tool', openSpatialDialog, '检查明显重叠干涉（正确连接的接触面除外）'));
    seg5.appendChild(button('适配视图', 'ws-tool', () => engine.fitAll(), '相机自动适配整个装置'));
    barControls.appendChild(seg5);
    const counts = el('div', 'ws-counts', `${state.instances.length} 零件 · ${state.connections.length} 连接`);
    barControls.appendChild(counts);
    if (focusLabel) {
      const replacement = [...barControls.querySelectorAll('button')].find(node => node.textContent === focusLabel);
      (replacement && !replacement.disabled ? replacement : focusMode).focus({ preventScroll: true });
    }
  }

  function doUndo() {
    const s = history.undo();
    if (!s) { toast('没有可撤销的操作', 'warn'); return; }
    state = s;
    plan.state = s;
    selection = selection.filter((u) => instOf(state, u));
    activePort = null;
    activeConn = null;
    engine.clearPreview();
    sync();
  }

  function doRedo() {
    const s = history.redo();
    if (!s) { toast('没有可重做的操作', 'warn'); return; }
    state = s;
    plan.state = s;
    selection = selection.filter((u) => instOf(state, u));
    activePort = null;
    activeConn = null;
    engine.clearPreview();
    sync();
  }

  /* ---------- 对话框 ---------- */
  function modal(title: string, build: (body: HTMLElement, close: () => void) => void) {
    const overlay = el('div', 'ws-modal-overlay');
    const box = el('div', 'ws-modal');
    const head = el('div', 'ws-modal-head');
    head.appendChild(el('h2', '', title));
    const close = () => overlay.remove();
    head.appendChild(button('', 'ws-modal-close', close, '关闭'));
    (head.lastChild as HTMLElement).appendChild(icon(ICONS.close, 16));
    box.appendChild(head);
    const bodyEl = el('div', 'ws-modal-body');
    box.appendChild(bodyEl);
    overlay.appendChild(box);
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
    page.appendChild(overlay);
    build(bodyEl, close);
    return close;
  }

  function portOptions(): { ref: PortRef; label: string }[] {
    const out: { ref: PortRef; label: string }[] = [];
    for (const inst of state.instances) {
      const part = partById(inst.partId);
      for (const pd of livePorts(inst)) {
        if (!isFluidPort(pd)) continue;
        out.push({ ref: { uid: inst.uid, port: pd.id }, label: `${part?.name}#${inst.uid.slice(-4)} · ${pd.label}（DN${pd.dn}）` });
      }
    }
    return out;
  }

  function openConnectDialog() {
    modal('连通检查与流向演示', (body, close) => {
      const opts = portOptions();
      if (opts.length < 2) {
        body.appendChild(el('p', '', '至少需要两个管路接口才能检查连通。先搭建一段管路。'));
        return;
      }
      body.appendChild(el('p', 'ws-side-note', '选择起点与终点接口，检查连接网络中是否存在连通路径：有流向的部件（止回阀、泵）按方向判定，关闭的阀门会切断路径。'));
      const row = el('div', 'ws-connect-selects');
      const startSel = el('select', 'ws-select') as HTMLSelectElement;
      const endSel = el('select', 'ws-select') as HTMLSelectElement;
      for (const o of opts) {
        const a = el('option', '', o.label); a.value = `${o.ref.uid}|${o.ref.port}`;
        const b = el('option', '', o.label); b.value = `${o.ref.uid}|${o.ref.port}`;
        startSel.appendChild(a); endSel.appendChild(b);
      }
      const opens = openPorts(state);
      if (opens.length >= 2) {
        startSel.value = `${opens[0].uid}|${opens[0].port}`;
        endSel.value = `${opens[opens.length - 1].uid}|${opens[opens.length - 1].port}`;
      } else endSel.selectedIndex = Math.min(1, opts.length - 1);
      const wrap1 = el('div', 'ws-spec-row'); wrap1.appendChild(el('label', '', '起点')); wrap1.appendChild(startSel);
      const wrap2 = el('div', 'ws-spec-row'); wrap2.appendChild(el('label', '', '终点')); wrap2.appendChild(endSel);
      row.appendChild(wrap1); row.appendChild(wrap2);
      body.appendChild(row);
      const result = el('div', 'ws-connect-result');
      body.appendChild(result);
      const acts = el('div', 'ws-acts');
      acts.appendChild(button('检查连通', 'btn btn-primary', () => {
        const [su, sp] = startSel.value.split('|');
        const [eu, ep] = endSel.value.split('|');
        const r = findPath(state, { uid: su, port: sp }, { uid: eu, port: ep });
        result.innerHTML = '';
        if (r.ok) {
          const names = [...new Set(r.path.map((p) => partById(instOf(state, p.uid)?.partId ?? '')?.name ?? ''))];
          result.appendChild(el('p', 'ws-check-item ok', `✓ 连通成立：路径经过 ${names.join(' → ')}`));
          result.appendChild(el('p', 'ws-side-note', '场景中的绿色粒子为流向原理示意，不代表真实压力、流量或温度；这些参数需接入计算模型后作为计算结果给出。'));
          engine.setFlowPositions(pathPositions(state, r.path));
          toast('连通成立，已显示流向原理示意动画', 'ok');
        } else {
          result.appendChild(el('p', 'ws-check-problem', r.reason ?? '不连通'));
          const missing = openPorts(state);
          result.appendChild(el('p', 'ws-side-note', `当前未连接接口 ${missing.length} 个：${missing.slice(0, 6).map((m) => refLabel(m)).join('；')}${missing.length > 6 ? '…' : ''}`));
          engine.setFlowPositions(null);
        }
      }));
      acts.appendChild(button('清除流向动画', 'btn btn-outline', () => { engine.setFlowPositions(null); result.innerHTML = ''; }));
      acts.appendChild(button('关闭', 'btn btn-outline', close));
      body.appendChild(acts);
      body.appendChild(el('p', 'ws-side-note', '未使用接口区分处理：任务边界、排净与预留口可保留开放；需要封闭的管端用管帽或盲板法兰封堵。'));
    });
  }

  function openSpatialDialog() {
    const overlaps = findPoseConflicts(state);
    modal('空间干涉检查', (body, close) => {
      body.appendChild(el('p', 'ws-side-note', '检查当前装置中的实体相交。含隐藏件、紧固件和连接组内部。待核查表示现有代理形状还不足以判定实际接触。'));
      if (!overlaps.length) {
        body.appendChild(el('p', 'ws-check-item ok', '✓ 未发现明显干涉'));
      }
      for (const o of overlaps) {
        const pair = [o.moving, o.obstacle];
        const row = el('div', 'ws-cand-row');
        const labels = pair.map(uid => refLabel({ uid, port: '' }).split(' · ')[0]).join(' ↔ ');
        row.appendChild(el('span', 'ws-cand-name', labels + (o.status === 'unresolved' ? ' · 待核查' : '')));
        row.appendChild(button('查看', 'btn btn-outline btn-xs', () => { select(pair); engine.focus(pair); close(); }));
        body.appendChild(row);
      }
      if (overlaps.length === 32) body.appendChild(el('p', 'ws-side-note', '此处显示前 32 对。'));
      body.appendChild(button('关闭', 'btn btn-outline', close));
    });
  }

  function diagnoseLoadedPlan(loaded: WState) {
    if (loaded.instances.length < 2) return;
    window.setTimeout(() => {
      if (!root.contains(engine.renderer.domElement) || loaded !== state) return;
      if (findPoseConflicts(loaded, 1).length) toast('方案含相交或待核查的零件，原方案已保留。底部可打开「干涉检查」。', 'warn');
    }, 60);
  }

  function openPlansDialog() {
    modal('方案管理', (body, close) => {
      body.appendChild(el('p', 'ws-side-note', '方案保存在当前浏览器本地存储中（含零件实例、规格、位置旋转、接口连接、分组与任务进度）。清除浏览器数据会丢失方案，请及时导出备份。跨设备同步待有账户需求时建设。'));
      const acts = el('div', 'ws-acts');
      acts.appendChild(button('新建方案', 'btn btn-primary btn-sm', () => {
        const saved = saveNow();
        if (!saved.ok) { toast(saved.error, 'err'); return; }
        const p = newPlan(`新方案 ${listPlans().length + 1}`);
        if (!p.write.ok) { toast(p.write.error, 'err'); return; }
        openPlan(p.plan.id);
        close();
        toast('已创建新方案', 'ok');
      }));
      const importBtn = button('导入方案文件', 'btn btn-outline btn-sm', () => fileInput.click());
      acts.appendChild(importBtn);
      const fileInput = el('input') as HTMLInputElement;
      fileInput.type = 'file';
      fileInput.accept = '.json,application/json';
      fileInput.style.display = 'none';
      fileInput.addEventListener('change', () => {
        const f = fileInput.files?.[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          const saved = saveNow();
          if (!saved.ok) { toast(saved.error, 'err'); return; }
          const r = importPlanFile(String(reader.result));
          if (r.ok) {
            openPlan(r.plan.id);
            close();
            toast(`方案「${r.plan.name}」导入成功，位置与连接已恢复`, 'ok');
          } else {
            toast(`导入失败：${r.error}`, 'err');
          }
        };
        reader.readAsText(f);
      });
      body.appendChild(acts);
      body.appendChild(fileInput);
      const plans = listPlans();
      if (!plans.some(item => item.id === plan.id)) {
        acts.appendChild(button('导出当前编辑', 'btn btn-outline btn-sm', () => downloadPlan(plan)));
      }
      if (!plans.length) body.appendChild(el('p', 'ws-side-empty', '暂无已保存方案。'));
      for (const p of plans) {
        const row = el('div', `ws-plan-row${p.id === plan.id ? ' current' : ''}`);
        const meta = el('div', 'ws-plan-meta');
        meta.appendChild(el('span', 'ws-plan-title', p.name + (p.id === plan.id ? '（当前）' : '')));
        const problem = validateState(p.state);
        meta.appendChild(el('span', 'ws-plan-sub', problem ??
          `${p.state.instances.length} 零件 · ${p.state.connections.length} 连接 · 更新于 ${new Date(p.updatedAt).toLocaleString('zh-CN')}`));
        row.appendChild(meta);
        const rowActs = el('div', 'ws-acts');
        if (!problem && p.id !== plan.id) rowActs.appendChild(button('打开', 'btn btn-primary btn-xs', () => {
          const saved = saveNow();
          if (!saved.ok) { toast(saved.error, 'err'); return; }
          openPlan(p.id); close();
        }));
        rowActs.appendChild(button('重命名', 'btn btn-outline btn-xs', () => {
          const name = prompt('方案名称', p.name);
          if (name?.trim()) {
            const write = renamePlan(p.id, name.trim());
            if (!write.ok) { toast(write.error, 'err'); return; }
            if (p.id === plan.id) { plan.name = name.trim(); planName.value = plan.name; }
            close();
            openPlansDialog();
          }
        }));
        rowActs.appendChild(button('复制', 'btn btn-outline btn-xs', () => {
          if (p.id === plan.id) {
            const saved = saveNow();
            if (!saved.ok) { toast(saved.error, 'err'); return; }
          }
          const write = duplicatePlan(p.id);
          if (!write.ok) { toast(write.error, 'err'); return; }
          close();
          openPlansDialog();
        }));
        rowActs.appendChild(button('导出', 'btn btn-outline btn-xs', () => downloadPlan(p.id === plan.id ? plan : p)));
        rowActs.appendChild(button('删除', 'btn btn-danger btn-xs', () => {
          if (!confirm(`删除方案「${p.name}」？此操作不可恢复（导出文件不受影响）。`)) return;
          const write = deletePlan(p.id);
          if (!write.ok) { toast(write.error, 'err'); return; }
          if (p.id === plan.id) {
            const rest = listPlans();
            const np = rest[0] ?? newPlan('我的第一套装置').plan;
            openPlan(np.id);
          }
          close();
          openPlansDialog();
        }));
        row.appendChild(rowActs);
        body.appendChild(row);
      }
    });
  }

  function downloadPlan(plan: Plan) {
    const blob = new Blob([JSON.stringify(exportPlan(plan), null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = plan.name + '.workshop.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  }

  function openPlan(id: string) {
    const p = getPlan(id);
    if (!p) return;
    engine.cancelMotion();
    plan = p;
    state = p.state;
    diagnoseLoadedPlan(state);
    activeTask = p.activeTask ?? null;
    taskAnswers.clear();
    isolatedUid = null;
    history = new History(state);
    selection = [];
    activePort = null;
    activeConn = null;
    lastTaskResult = null;
    setReference(false);
    engine.setFlowPositions(null);
    engine.clearPreview();
    planName.value = plan.name;
    const write = setLastPlan(id);
    updateSaveNote(write);
    engine.setState(state);
    engine.setSelection([]);
    engine.fitAll();
    refreshMarkers();
    renderSide();
    renderBar();
    renderLib();
  }

  function openHelpDialog() {
    modal('工坊操作说明', (body) => {
      const items: [string, string][] = [
        ['添加零件', '左侧零件库点「添加到场景」后在网格上点击放置，或直接把零件拖入场景。'],
        ['观察场景', '空白处拖动旋转视角，滚轮缩放，右键平移；「适配视图」自动取景整个装置。'],
        ['选择与移动', '点击选中；拖动零件整体移动其连通管段与分组成员；Alt+拖动单独移动（会断开连接并提示）。底部可锁定 X/Y/Z 单轴。'],
        ['框选与分组', 'Shift+空白处拖动框选；「分组」面板可编组、按连通管段自动分组、整组隐藏/聚焦。'],
        ['连接接口', '选中零件后点击接口圆环（或在接口面板点「开始连接」），绿色圆环为合法目标，点击即自动对齐连接；悬停候选列表可预览对齐位置。'],
        ['法兰紧固', '法兰连接建立后出现螺栓孔位：教学模式逐个安装螺栓与螺母，自由模式可一键紧固。'],
        ['旋转', '底部「旋转」模式拖动自由旋转，或选中面板按 ±90° 固定角度旋转；旋转按单独操作处理。'],
        ['快捷键', 'Ctrl+Z 撤销 · Ctrl+Y 重做 · Ctrl+D 复制 · Delete 删除 · Esc 取消放置/连接/选择。'],
        ['连通与干涉', '底部「连通检查」选择进出口验证路径并显示流向原理示意；「干涉检查」发现明显重叠。'],
        ['任务与参考', '「组装任务」面板选择任务，按步骤搭建并检查；参考方案半透明显示、随时开关；自由搭建始终可用。'],
        ['保存与导出', '改动约 1 秒后自动保存到本机浏览器；「方案管理」可新建/打开/重命名/复制/导入/导出。'],
        ['性能与显示', '复杂场景可隐藏紧固件、切换流畅画质；透视模式观察内部；原理演示驱动阀门/叶轮/液位动画。']
      ];
      for (const [t, d] of items) {
        body.appendChild(el('h3', 'ws-help-t', t));
        body.appendChild(el('p', 'ws-help-d', d));
      }
      body.appendChild(el('p', 'ws-side-note', '所有模型为程序化教学示意模型：DN 为公称尺寸，外径按标准系列核对，壁厚与部分结构为教学简化；流向动画为原理示意，不作为工程计算依据。'));
    });
  }

  /* ---------- 键盘 ---------- */
  function onKey(ev: KeyboardEvent) {
    if (ev.defaultPrevented) return;
    if (ev.key === 'Escape' && engine.cancelMotion()) {
      ev.preventDefault();
      return;
    }
    if (ev.key === 'Escape' && toolsMenu.open) {
      toolsMenu.open = false;
      toolsTrigger.focus({ preventScroll: true });
      ev.preventDefault();
      return;
    }
    if (ev.key === 'Escape' && !engine.placing &&
      (page.classList.contains('ws-focused') || matchMedia('(max-width: 1023px)').matches)) {
      const libraryOpen = page.classList.contains('lib-open');
      if (libraryOpen || page.classList.contains('side-open')) {
        if (libraryOpen) setLibraryOpen(false);
        else setSideOpen(false);
        (libraryOpen ? libToggle : sideToggle).focus({ preventScroll: true });
        ev.preventDefault();
        return;
      }
    }
    const tag = (ev.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || 'TEXTAREA' === tag || tag === 'SELECT') return;
    if (ev.key === 'Escape') {
      if (engine.placing) engine.cancelPlacement();
      else if (activePort) { activePort = null; engine.clearPreview(); refreshMarkers(); renderSide(); }
      else if (activeConn) { activeConn = null; refreshMarkers(); renderSide(); }
      else select([]);
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      engine.cancelMotion();
      if (ev.shiftKey) doRedo(); else doUndo();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') { ev.preventDefault(); engine.cancelMotion(); doRedo(); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'd') { ev.preventDefault(); engine.cancelMotion(); duplicateSelection(); return; }
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); engine.cancelMotion(); deleteSelection(); }
  }
  window.addEventListener('keydown', onKey);

  /* ---------- 开发调试钩子（仅 DEV） ---------- */
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__ws = {
      get state() { return state; },
      get plan() { return plan; },
      get selection() { return selection; },
      engine,
      addInstanceAt,
      seedInstanceAt: (id: string, pos: Instance['pos'], spec?: Partial<Instance['spec']>) => addInstanceAt(id, pos, spec, 'fixture'),
      select,
      tryConnect,
      makeConnection: (a: PortRef, b: PortRef) => {
        const r = makeConnection(state, a, b);
        if (r.ok) afterMutate();
        return r;
      },
      quickFasteners,
      undo: doUndo,
      redo: doRedo,
      duplicateSelection,
      deleteSelection,
      saveNow,
      openPlan,
      runTaskCheck: (id: string) => { const t = taskById(id); if (!t) return null; const r = t.check(state); lastTaskResult = r; renderSide(); return r; },
      startTask,
      findPath: (a: PortRef, b: PortRef) => findPath(state, a, b),
      taskResult: (id: string) => taskById(id)?.check(state) ?? null,
      loadReference: (id: string) => {
        const t = taskById(id);
        if (!t?.reference) return false;
        state = t.reference();
        history = new History(state);
        selection = [];
        activePort = null;
        activeConn = null;
        engine.setState(state);
        engine.setSelection([]);
        engine.fitAll();
        refreshMarkers();
        renderSide();
        return true;
      },
      portsOf: (uid: string) => { const i = instOf(state, uid); return i ? portsFor(i.partId, i.spec) : []; }
    };
  }

  /* ---------- 初始渲染与清理 ---------- */
  renderLib();
  renderSide();
  renderBar();
  if (workshopStorageWarning) toast(workshopStorageWarning, 'warn');
  if (initialSaveError) updateSaveNote({ ok: false, error: initialSaveError });
  if (restored) diagnoseLoadedPlan(state);
  if (!state.instances.length) {
    toast('欢迎来到组装工坊：从左侧添加直管开始，或到「组装任务」选择第一个任务', 'info');
  }

  (root as HTMLElement & { __dispose?: () => void }).__dispose = () => {
    if (saveTimer) saveNow();
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('click', onOutsideClick);
    thumbnails.dispose();
    engine.dispose();
    if (import.meta.env.DEV) delete (window as unknown as Record<string, unknown>).__ws;
  };
}



