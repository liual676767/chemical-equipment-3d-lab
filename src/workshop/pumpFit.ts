import { button, el } from '../ui/dom';
import { planConnection } from './assemblyPlan';
import { WorkshopScene } from './engine';
import { findMotionBlock } from './motionValidation';
import { findDockTarget, type DockTarget } from './nearConnection';
import { cloneState, emptyState, instOf } from './state';
import type { WState } from './types';

const sleeve = { uid: 'pump-fit-sleeve', port: 'bore' };
const shaft = { uid: 'pump-fit-shaft', port: 'sleeve' };
const noop = () => {};

function startingFit(): WState {
  const state = emptyState();
  state.instances.push(
    { uid: sleeve.uid, partId: 'P043', pos: [-0.4, 0.28, 0], rot: [0, 0, 0], spec: { dn: 0 } },
    { uid: shaft.uid, partId: 'P042', pos: [1.3, 0.28, 0], rot: [0, 0, 0], spec: { dn: 0 } }
  );
  return state;
}

export function openPumpFit(parent: HTMLElement, onClose: () => void) {
  const dialog = document.createElement('dialog');
  dialog.className = 'pump-fit-dialog';
  dialog.setAttribute('aria-label', '离心泵轴与轴套装配');
  const header = el('header', 'pump-fit-header');
  const close = button('返回泵工作台', 'btn btn-outline', () => dialog.close());
  header.append(close, el('h2', '', '轴与轴套装配'));
  const stage = el('div', 'pump-fit-stage');
  const toolbar = el('div', 'pump-fit-toolbar');
  const status = el('p', 'pump-fit-status', '将阶梯轴沿 X 轴推入轴套。绿色轮廓出现时松手。');
  status.setAttribute('role', 'status');
  const initial = status.textContent;
  let state = startingFit();
  let draft: WState | null = null;
  let target: DockTarget | null = null;
  let feedback: string | null = null;
  let disposed = false;

  const engine = new WorkshopScene(stage, {
    onSelect(uids) { engine.setSelection(uids); },
    onPortPick: noop,
    onPortHover: noop,
    onTransformPreview(items) {
      feedback = null;
      if (state.connections.length || items.some(item => item.uid !== shaft.uid)) {
        feedback = state.connections.length ? '轴套已就位，重置后可再练习。' : '轴套是安装基准，请拖动阶梯轴。';
        return feedback;
      }
      const candidate = cloneState(state);
      const moving = items.find(item => item.uid === shaft.uid);
      const part = instOf(candidate, shaft.uid);
      if (!moving || !part) return null;
      part.pos = moving.pos;
      part.rot = moving.rot;
      if (findMotionBlock(draft ?? state, candidate)) {
        engine.clearPreview();
        target = null;
        feedback = '轴肩与轴套接触，停止移动。请将轴留在正确入口一侧。';
        return feedback;
      }
      draft = candidate;
      const movingIds = new Set([shaft.uid]);
      const previous = target;
      target = findDockTarget(candidate, movingIds, (anchor, point, outward) =>
        engine.canSeeDock(anchor, movingIds, point, outward), previous, {
        onRejected: reason => { feedback = reason; }
      });
      const preview = target && instOf(target.state, shaft.uid);
      if (preview) {
        if (!previous) engine.setPreview(preview.partId, preview.spec, preview.pos, preview.rot);
        feedback = '已对准轴套止口，松手安装。';
      } else engine.clearPreview();
      return null;
    },
    onTransformEnd() {
      const next = target?.state ?? draft;
      const message = target ? null : feedback;
      clearMotion();
      if (next) setState(next);
      if (message) status.textContent = message;
    },
    onTransformCancel() {
      clearMotion();
      setState(state);
    },
    onPlace: noop,
    onPlaceCancel: noop,
    onBoxSelect: noop,
    onHover: noop,
    onDragInfo(current) {
      if (current) status.textContent = feedback ?? initial;
    }
  });

  function clearMotion() {
    draft = null;
    target = null;
    feedback = null;
    engine.clearPreview();
  }

  function setState(next: WState) {
    state = next;
    engine.setState(state);
    engine.setSelection([shaft.uid]);
    assist.disabled = state.connections.length > 0;
    status.textContent = assist.disabled ? '轴肩抵住轴套端面，轴已沿同轴路径装入。' : initial;
  }

  const assist = button('沿轴线安装', 'btn btn-primary', () => {
    const result = planConnection(state, sleeve, shaft);
    if (result.ok) setState(result.state);
    else status.textContent = result.reason;
  });
  function fit() {
    const aspect = Math.max(1, stage.clientWidth) / Math.max(1, stage.clientHeight);
    engine.fitAll(Math.max(0.54, 0.53 / aspect));
  }

  const reset = button('重置配合', 'btn btn-outline', () => {
    engine.cancelMotion();
    clearMotion();
    setState(startingFit());
    fit();
  });
  toolbar.append(assist, reset, status);
  dialog.append(header, stage, toolbar);
  parent.appendChild(dialog);
  dialog.showModal();
  engine.mode = 'move';
  engine.axis = 'x';
  engine.snapOn = false;
  engine.setAxes(false);
  setState(state);
  requestAnimationFrame(() => { if (!disposed) fit(); });
  close.focus();

  function dispose() {
    if (disposed) return;
    disposed = true;
    engine.dispose();
    dialog.remove();
    onClose();
  }
  dialog.addEventListener('close', dispose, { once: true });
  return { dispose };
}
