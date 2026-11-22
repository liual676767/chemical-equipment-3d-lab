import { BOIL_ORDER_CHECK } from '../data/boilObservation';
/**
 * 微沸喷烧 Phase 6：小型 PROCESS MAP（二维工艺流程图）。
 *
 * 与三维场景读取同一份 BOIL_PROCESS + BOIL_LAYOUT：
 * - 设备节点、管线箭头、区域分组全部由数据生成，不另写一套流程关系；
 * - 四根喷枪以二燃室的四条虚线平行支路显示，接入关系标待确认；
 * - 当前设备/步骤/上下游/支路高亮，其余节点弱化；
 * - 点击节点定位三维设备；支持滚轮缩放、拖拽平移、按钮复位。
 */

import { BOIL_PROCESS } from '../data/boilProcess';
import { BOIL_LAYOUT } from '../data/boilLayout';
import type { ProcessAreaDef } from '../data/processTypes';

export interface ProcessMapState {
  currentEquipmentIds?: string[];
  upstreamEquipmentIds?: string[];
  downstreamEquipmentIds?: string[];
  branchEquipmentIds?: string[];
  completedEquipmentIds?: string[];
  currentPipelineIds?: string[];
  upstreamPipelineIds?: string[];
  downstreamPipelineIds?: string[];
  completedPipelineIds?: string[];
}

export interface ProcessMapInfo {
  nodes: number;
  pipelines: number;
  branches: number;
  view: { x: number; y: number; width: number; height: number; scale: number };
  highlighted: {
    current: string[];
    upstream: string[];
    downstream: string[];
    branch: string[];
    completed: string[];
    dim: string[];
    pipes: string[];
  };
}

export interface ProcessMap {
  element: SVGSVGElement;
  host: HTMLElement;
  setState(state: ProcessMapState | null): void;
  zoom(factor: number): void;
  resetView(): void;
  info(): ProcessMapInfo;
  dispose(): void;
}

const NS = 'http://www.w3.org/2000/svg';
const NODE_W = 5.8;
const NODE_H = 2.2;
const GUN_W = 4.5;
const GUN_H = 1.9;
const AREA_COLORS = ['#1f4d6b', '#6b3f1d', '#2c5a4a', '#3a3f6b', '#4a2f50'];

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
}

function textEl(text: string, x: number, y: number, size: number, cls: string): SVGTextElement {
  const element = svgEl('text', { x, y, 'font-size': size, class: cls, 'text-anchor': 'middle' });
  element.textContent = text;
  return element;
}

function trimSegment(
  from: { x: number; y: number; hw: number; hh: number },
  to: { x: number; y: number; hw: number; hh: number }
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sign = dx >= 0 ? 1 : -1;
    return { x1: from.x + from.hw * sign, y1: from.y, x2: to.x - to.hw * sign, y2: to.y };
  }
  const sign = dy >= 0 ? 1 : -1;
  return { x1: from.x, y1: from.y + from.hh * sign, x2: to.x, y2: to.y - to.hh * sign };
}

function mediumColor(id: string): string {
  const medium = BOIL_PROCESS.media.find((item) => item.id === id);
  return `#${(medium?.color ?? 0x7da7c4).toString(16).padStart(6, '0')}`;
}

export function createProcessMap(host: HTMLElement, onPick: (equipmentId: string) => void): ProcessMap {
  host.innerHTML = '';
  const svg = svgEl('svg', { class: 'boil-map-svg', role: 'img', 'aria-label': '微沸喷烧二维工艺流程图' });
  host.appendChild(svg);

  const defs = svgEl('defs');
  const marker = svgEl('marker', {
    id: 'boil-map-arrow',
    viewBox: '0 0 10 10',
    refX: 9,
    refY: 5,
    markerWidth: 5,
    markerHeight: 5,
    orient: 'auto-start-reverse'
  });
  marker.appendChild(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#7da7c4' }));
  defs.appendChild(marker);
  svg.appendChild(defs);

  const viewport = svgEl('g', { class: 'boil-map-viewport' });
  svg.appendChild(viewport);
  const areaLayer = svgEl('g', { class: 'boil-map-areas' });
  const linkLayer = svgEl('g', { class: 'boil-map-links' });
  const branchLayer = svgEl('g', { class: 'boil-map-branches' });
  const nodeLayer = svgEl('g', { class: 'boil-map-nodes' });
  viewport.append(areaLayer, linkLayer, branchLayer, nodeLayer);

  const layout = new Map(BOIL_LAYOUT.map((placement) => [placement.equipmentId, placement]));
  const equipmentById = new Map(BOIL_PROCESS.equipment.map((equipment) => [equipment.id, equipment]));
  const areaByEquipment = new Map<string, ProcessAreaDef>();
  for (const area of BOIL_PROCESS.areas) {
    for (const id of area.equipmentInstanceIds) areaByEquipment.set(id, area);
  }

  const gunIds = new Set(
    BOIL_PROCESS.equipment.filter((equipment) => equipment.modelKey === 'spray-gun').map((equipment) => equipment.id)
  );
  const orderedMain = BOIL_PROCESS.steps.flatMap((step) => step.equipmentInstanceIds).filter((id) => !gunIds.has(id));
  const orderedGuns = BOIL_PROCESS.equipment.filter((equipment) => gunIds.has(equipment.id)).map((equipment) => equipment.id);
  const columns = 5;
  const spacing = 8.6;
  const rowGap = 8.8;
  const positions = new Map<string, { x: number; y: number; hw: number; hh: number }>();
  orderedMain.forEach((equipmentId, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const orderedColumn = row % 2 === 0 ? column : columns - 1 - column;
    positions.set(equipmentId, {
      x: orderedColumn * spacing,
      y: row * rowGap,
      hw: NODE_W / 2,
      hh: NODE_H / 2
    });
  });
  const parentPosition = positions.get('eq-secondary-chamber') ?? { x: 0, y: 0, hw: NODE_W / 2, hh: NODE_H / 2 };
  orderedGuns.forEach((equipmentId, index) => {
    positions.set(equipmentId, {
      x: parentPosition.x + (index - (orderedGuns.length - 1) / 2) * (GUN_W + 0.9),
      y: parentPosition.y - 7.2,
      hw: GUN_W / 2,
      hh: GUN_H / 2
    });
  });
  /* 兼容布局表中存在但未进入工序的设备（正常数据为 0）。 */
  for (const equipment of BOIL_PROCESS.equipment) {
    if (positions.has(equipment.id)) continue;
    const placement = layout.get(equipment.id);
    if (!placement) continue;
    positions.set(equipment.id, {
      x: placement.position[0],
      y: -placement.position[2],
      hw: NODE_W / 2,
      hh: NODE_H / 2
    });
  }

  const xs = [...positions.values()].map((position) => position.x);
  const ys = [...positions.values()].map((position) => position.y);
  const base = {
    x: Math.min(...xs) - 6,
    y: Math.min(...ys) - 4.5,
    width: Math.max(...xs) - Math.min(...xs) + 12,
    height: Math.max(...ys) - Math.min(...ys) + 8
  };
  const view = { ...base };
  const minWidth = base.width / 6;

  const updateViewBox = (): void => {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`);
  };
  updateViewBox();

  /* ---------- 区域分组 ---------- */
  const areaElements = new Map<string, SVGRectElement>();
  BOIL_PROCESS.areas.forEach((area, index) => {
    const points = area.equipmentInstanceIds
      .map((id) => positions.get(id))
      .filter((point): point is { x: number; y: number; hw: number; hh: number } => Boolean(point));
    if (points.length === 0) return;
    const minX = Math.min(...points.map((point) => point.x - point.hw)) - 1.6;
    const maxX = Math.max(...points.map((point) => point.x + point.hw)) + 1.6;
    const minY = Math.min(...points.map((point) => point.y - point.hh)) - 1.4;
    const maxY = Math.max(...points.map((point) => point.y + point.hh)) + 1.4;
    const rect = svgEl('rect', {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      rx: 1,
      class: 'boil-map-area',
      fill: AREA_COLORS[index % AREA_COLORS.length],
      'data-area': area.id
    });
    areaLayer.appendChild(rect);
    areaLayer.appendChild(
      textEl(`${area.no.toString().padStart(2, '0')} ${area.name}`, minX + 0.5, minY - 0.55, 1.15, 'boil-map-area-label')
    );
    areaElements.set(area.id, rect);
  });

  /* ---------- 管线连接 ---------- */
  const pipelineElements = new Map<string, SVGLineElement>();
  const pipelineEnds = new Map<string, { from: string; to: string }>();
  for (const pipeline of BOIL_PROCESS.pipelines) {
    const from = positions.get(pipeline.from.equipment);
    const to = positions.get(pipeline.to.equipment);
    if (!from || !to) continue;
    const segment = trimSegment(from, to);
    const line = svgEl('line', {
      x1: segment.x1,
      y1: segment.y1,
      x2: segment.x2,
      y2: segment.y2,
      class: pipeline.id === BOIL_ORDER_CHECK.pipeline ? 'boil-map-link is-order-pending' : 'boil-map-link',
      stroke: mediumColor(pipeline.medium),
      'marker-end': 'url(#boil-map-arrow)',
      'data-pipeline': pipeline.id
    });
    const title = svgEl('title');
    const pending = pipeline.id === BOIL_ORDER_CHECK.pipeline ? ' · 烟气顺序待现场核对' : '';
    title.textContent = `${pipeline.id} · ${pipeline.name}${pending}`;
    line.appendChild(title);
    linkLayer.appendChild(line);
    pipelineElements.set(pipeline.id, line);
    pipelineEnds.set(pipeline.id, { from: pipeline.from.equipment, to: pipeline.to.equipment });
  }

  /* ---------- 结构支路（喷枪 ×4，接入待确认） ---------- */
  const branchElements = new Map<string, SVGLineElement>();
  let branchCount = 0;
  const branchLabelPoints: { x: number; y: number }[] = [];
  for (const equipment of BOIL_PROCESS.equipment) {
    if (!equipment.parentEquipmentId || equipment.relationKind !== 'parallel-branch') continue;
    const parent = positions.get(equipment.parentEquipmentId);
    const child = positions.get(equipment.id);
    if (!parent || !child) continue;
    const line = svgEl('line', {
      x1: parent.x,
      y1: parent.y + parent.hh,
      x2: child.x,
      y2: child.y - child.hh,
      class: 'boil-map-branch',
      'data-branch': equipment.id
    });
    const title = svgEl('title');
    title.textContent = `${equipment.name} · ${equipment.parentEquipmentId ?? ''} 平行支路（接入位置与介质待确认）`;
    line.appendChild(title);
    branchLayer.appendChild(line);
    branchElements.set(equipment.id, line);
    branchLabelPoints.push(child);
    branchCount += 1;
  }
  if (branchLabelPoints.length > 0) {
    const label = textEl(
      '二燃室平行支路 ×4 · 接入待确认',
      branchLabelPoints.reduce((sum, point) => sum + point.x, 0) / branchLabelPoints.length,
      Math.max(...branchLabelPoints.map((point) => point.y)) + 2.2,
      1.05,
      'boil-map-branch-label'
    );
    branchLayer.appendChild(label);
  }

  /* ---------- 设备节点 ---------- */
  const nodeElements = new Map<string, SVGGElement>();
  const nodeRects = new Map<string, SVGRectElement>();
  for (const equipment of BOIL_PROCESS.equipment) {
    const position = positions.get(equipment.id);
    if (!position) continue;
    const isGun = equipment.modelKey === 'spray-gun';
    const group = svgEl('g', {
      class: 'boil-map-node',
      'data-equipment': equipment.id,
      tabindex: 0,
      role: 'button',
      'aria-label': `${equipment.name}，点击定位三维设备`
    });
    const rect = svgEl('rect', {
      x: position.x - position.hw,
      y: position.y - position.hh,
      width: position.hw * 2,
      height: position.hh * 2,
      rx: 0.45,
      class: 'boil-map-node-rect',
      fill: isGun ? '#4a2733' : '#153247'
    });
    const name = textEl(equipment.name, position.x, position.y + 0.22, isGun ? 1.15 : 1.3, 'boil-map-node-label');
    const step = equipment.stepId ? BOIL_PROCESS.steps.find((item) => item.id === equipment.stepId) : undefined;
    const title = svgEl('title');
    title.textContent = `${equipment.name} · ${areaByEquipment.get(equipment.id)?.name ?? ''}${
      step ? ` · 第 ${step.no} 步` : ''
    }`;
    group.append(rect, name, title);
    group.addEventListener('click', () => onPick(equipment.id));
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onPick(equipment.id);
      }
    });
    nodeLayer.appendChild(group);
    nodeElements.set(equipment.id, group);
    nodeRects.set(equipment.id, rect);
  }

  /* ---------- 状态高亮 ---------- */
  let lastState: ProcessMapState | null = null;
  const setState = (state: ProcessMapState | null): void => {
    lastState = state;
    const current = new Set(state?.currentEquipmentIds ?? []);
    const upstream = new Set(state?.upstreamEquipmentIds ?? []);
    const downstream = new Set(state?.downstreamEquipmentIds ?? []);
    const branch = new Set(state?.branchEquipmentIds ?? []);
    const completed = new Set(state?.completedEquipmentIds ?? []);
    const active = state
      ? new Set([...current, ...upstream, ...downstream, ...branch, ...completed])
      : null;
    for (const [id, element] of nodeElements) {
      element.classList.toggle('is-current', current.has(id));
      element.classList.toggle('is-upstream', !current.has(id) && upstream.has(id));
      element.classList.toggle('is-downstream', !current.has(id) && downstream.has(id));
      element.classList.toggle('is-branch', !current.has(id) && branch.has(id));
      element.classList.toggle('is-completed', !current.has(id) && completed.has(id));
      element.classList.toggle('is-dim', Boolean(active && !active.has(id)));
    }
    const pipeCurrent = new Set(state?.currentPipelineIds ?? []);
    const pipeUpstream = new Set(state?.upstreamPipelineIds ?? []);
    const pipeDownstream = new Set(state?.downstreamPipelineIds ?? []);
    const pipeCompleted = new Set(state?.completedPipelineIds ?? []);
    const pipeActive = state
      ? new Set([...pipeCurrent, ...pipeUpstream, ...pipeDownstream, ...pipeCompleted])
      : null;
    for (const [id, element] of pipelineElements) {
      element.classList.toggle('is-current', pipeCurrent.has(id));
      element.classList.toggle('is-upstream', !pipeCurrent.has(id) && pipeUpstream.has(id));
      element.classList.toggle('is-downstream', !pipeCurrent.has(id) && pipeDownstream.has(id));
      element.classList.toggle('is-completed', !pipeCurrent.has(id) && pipeCompleted.has(id));
      element.classList.toggle('is-dim', Boolean(pipeActive && !pipeActive.has(id)));
    }
    for (const [id, element] of branchElements) {
      element.classList.toggle('is-branch', branch.has(id));
      element.classList.toggle('is-dim', Boolean(active && !branch.has(id) && !active.has(id)));
    }
    for (const [id, element] of areaElements) {
      const equipmentIds = BOIL_PROCESS.areas.find((area) => area.id === id)?.equipmentInstanceIds ?? [];
      element.classList.toggle('is-active', equipmentIds.some((equipmentId) => current.has(equipmentId)));
      element.classList.toggle('is-dim', Boolean(active && !equipmentIds.some((equipmentId) => active.has(equipmentId))));
    }
  };

  /* ---------- 缩放与平移 ---------- */
  const clampView = (): void => {
    view.width = Math.min(base.width, Math.max(minWidth, view.width));
    view.height = view.width * (base.height / base.width);
    view.x = Math.min(base.x + base.width - view.width, Math.max(base.x, view.x));
    view.y = Math.min(base.y + base.height - view.height, Math.max(base.y, view.y));
    updateViewBox();
  };

  const zoomAt = (factor: number, centerX: number, centerY: number): void => {
    const nextWidth = Math.min(base.width, Math.max(minWidth, view.width / factor));
    const ratio = nextWidth / view.width;
    view.x = centerX - (centerX - view.x) * ratio;
    view.y = centerY - (centerY - view.y) * ratio;
    view.width = nextWidth;
    view.height = base.height * (nextWidth / base.width);
    clampView();
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    const px = view.x + ((event.clientX - rect.left) / Math.max(1, rect.width)) * view.width;
    const py = view.y + ((event.clientY - rect.top) / Math.max(1, rect.height)) * view.height;
    zoomAt(event.deltaY < 0 ? 1.18 : 1 / 1.18, px, py);
  };

  let panning = false;
  let panStart: { x: number; y: number; viewX: number; viewY: number } | null = null;
  const onPointerDown = (event: PointerEvent): void => {
    if ((event.target as Element | null)?.closest('.boil-map-node')) return;
    panning = true;
    panStart = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
    svg.setPointerCapture(event.pointerId);
    svg.classList.add('panning');
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!panning || !panStart) return;
    const rect = svg.getBoundingClientRect();
    const dx = ((event.clientX - panStart.x) / Math.max(1, rect.width)) * view.width;
    const dy = ((event.clientY - panStart.y) / Math.max(1, rect.height)) * view.height;
    view.x = panStart.viewX - dx;
    view.y = panStart.viewY - dy;
    clampView();
  };
  const onPointerUp = (event: PointerEvent): void => {
    panning = false;
    panStart = null;
    svg.classList.remove('panning');
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  };

  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerUp);

  const info = (): ProcessMapInfo => {
    const highlighted: ProcessMapInfo['highlighted'] = {
      current: [],
      upstream: [],
      downstream: [],
      branch: [],
      completed: [],
      dim: [],
      pipes: []
    };
    if (lastState) {
      const current = new Set(lastState.currentEquipmentIds ?? []);
      const upstream = new Set(lastState.upstreamEquipmentIds ?? []);
      const downstream = new Set(lastState.downstreamEquipmentIds ?? []);
      const branch = new Set(lastState.branchEquipmentIds ?? []);
      const completed = new Set(lastState.completedEquipmentIds ?? []);
      const active = new Set([...current, ...upstream, ...downstream, ...branch, ...completed]);
      for (const id of nodeElements.keys()) {
        if (current.has(id)) highlighted.current.push(id);
        else if (upstream.has(id)) highlighted.upstream.push(id);
        else if (downstream.has(id)) highlighted.downstream.push(id);
        else if (branch.has(id)) highlighted.branch.push(id);
        else if (completed.has(id)) highlighted.completed.push(id);
        else if (!active.has(id)) highlighted.dim.push(id);
      }
      highlighted.pipes = [
        ...(lastState.currentPipelineIds ?? []),
        ...(lastState.upstreamPipelineIds ?? []),
        ...(lastState.downstreamPipelineIds ?? []),
        ...(lastState.completedPipelineIds ?? [])
      ];
    }
    return {
      nodes: nodeElements.size,
      pipelines: pipelineElements.size,
      branches: branchElements.size,
      view: { ...view, scale: base.width / view.width },
      highlighted
    };
  };

  return {
    element: svg,
    host,
    setState,
    zoom: (factor: number) => zoomAt(factor, view.x + view.width / 2, view.y + view.height / 2),
    resetView: () => {
      Object.assign(view, base);
      updateViewBox();
    },
    info,
    dispose: () => {
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('pointermove', onPointerMove);
      svg.removeEventListener('pointerup', onPointerUp);
      svg.removeEventListener('pointercancel', onPointerUp);
      host.innerHTML = '';
    }
  };
}
