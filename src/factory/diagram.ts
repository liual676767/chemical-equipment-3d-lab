import { teachingFlowLabel, type PipeFlowState } from '../process/teachingFlow';
import {
  FACTORY_MEDIA, FACTORY_NODES, FACTORY_PIPES, FACTORY_STEPS,
  inlineNodesOfPipe, valvesOfPipe
} from '../data/factory';

/**
 * 教学流程图：按工序分列的设备符号 + 管线连线。
 * 与三维场景共用同一套位号/管线编号；缺完整仪控数据，按工艺关联绘制。
 */

export interface DiagramApi {
  el: HTMLElement;
  setActive: (sel: { node?: string | null; pipe?: string | null }) => void;
  setFlows: (read: (id: string) => PipeFlowState | null) => void;
  setVisible: (on: boolean) => void;
  collapsed(): boolean;
  setCollapsed(on: boolean): void;
}

interface NodePos { x: number; y: number; }

const COL_W = 124;
const ROW_H = 58;
const BOX_W = 88;
const BOX_H = 40;
const PAD_X = 18;
const PAD_Y = 52;

export function createDiagram(opts: {
  onNode: (uid: string) => void;
  onPipe: (pipeId: string) => void;
}): DiagramApi {
  const NS = 'http://www.w3.org/2000/svg';
  const wrap = document.createElement('section');
  wrap.className = 'factory-diagram';
  const head = document.createElement('div');
  head.className = 'factory-diagram-head';
  const title = document.createElement('div');
  title.className = 'factory-diagram-title';
  title.textContent = '教学流程图';
  const sub = document.createElement('div');
  sub.className = 'factory-diagram-sub';
  sub.textContent = '实线可通 · 虚线受限或被截断 · 淡线无供给';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'btn btn-ghost factory-diagram-toggle';
  function setCollapsed(on: boolean) {
    wrap.classList.toggle('is-collapsed', on);
    toggle.textContent = on ? '展开' : '收起';
    toggle.setAttribute('aria-expanded', String(!on));
  }
  setCollapsed(true);
  toggle.addEventListener('click', () => setCollapsed(!wrap.classList.contains('is-collapsed')));
  head.appendChild(title);
  head.appendChild(sub);
  head.appendChild(toggle);
  wrap.appendChild(head);

  const scroller = document.createElement('div');
  scroller.className = 'factory-diagram-scroll';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'factory-diagram-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '教学流程图：按工序分列的设备与管线');

  const pos = new Map<string, NodePos>();
  let maxRow = 1;
  FACTORY_STEPS.forEach((step, si) => {
    const x = PAD_X + si * COL_W;
    let row = 0;
    for (const uid of step.nodes) {
      const node = FACTORY_NODES.find((n) => n.uid === uid);
      if (!node || node.inline) continue;
      pos.set(uid, { x, y: PAD_Y + row * ROW_H });
      row += 1;
    }
    maxRow = Math.max(maxRow, row);
  });
  FACTORY_NODES.forEach((n) => {
    if (!n.inline && !pos.has(n.uid)) {
      pos.set(n.uid, { x: PAD_X + (FACTORY_STEPS.length - 1) * COL_W, y: PAD_Y + maxRow * ROW_H });
    }
  });
  const width = PAD_X * 2 + FACTORY_STEPS.length * COL_W;
  const height = PAD_Y + (maxRow + 1) * ROW_H + 26;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));

  const defs = document.createElementNS(NS, 'defs');
  defs.innerHTML = `<marker id="fd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#eaa23b"/></marker>`;
  svg.appendChild(defs);

  /* 工序列标题 */
  FACTORY_STEPS.forEach((step, si) => {
    const x = PAD_X + si * COL_W;
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', String(x + BOX_W / 2));
    t.setAttribute('y', '26');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('class', 'fd-step');
    t.textContent = `${step.no}. ${step.title}`;
    svg.appendChild(t);
  });

  /* 管线连线（先画，垫在设备符号下） */
  const edgeEls: { pipe: string; el: SVGPathElement; tip: SVGTitleElement; label: string }[] = [];
  for (const pipe of FACTORY_PIPES) {
    const a = pipe.from.type === 'port' ? pos.get(pipe.from.node) : undefined;
    const b = pipe.to.type === 'port' ? pos.get(pipe.to.node) : undefined;
    if (!a && !b) continue;
    const color = `#${FACTORY_MEDIA[pipe.medium].color.toString(16).padStart(6, '0')}`;
    const path = document.createElementNS(NS, 'path');
    let d = '';
    if (a && b) {
      if (b.x > a.x) {
        const sx = a.x + BOX_W, sy = a.y + BOX_H / 2;
        const tx = b.x, ty = b.y + BOX_H / 2;
        const mx = (sx + tx) / 2;
        d = `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`;
      } else if (b.x === a.x) {
        const sx = a.x + BOX_W, sy = a.y + BOX_H / 2;
        const tx = b.x + BOX_W, ty = b.y + BOX_H / 2;
        const bulge = sx + 30;
        d = `M ${sx} ${sy} C ${bulge} ${sy}, ${bulge} ${ty}, ${tx + 2} ${ty}`;
      } else {
        const sx = a.x, sy = a.y + BOX_H / 2;
        const tx = b.x + BOX_W, ty = b.y + BOX_H / 2;
        const mx = (sx + tx) / 2;
        d = `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`;
      }
    } else if (a) {
      const sx = a.x + BOX_W, sy = a.y + BOX_H / 2;
      d = `M ${sx} ${sy} L ${sx + 34} ${sy}`;
    } else if (b) {
      const tx = b.x, ty = b.y + BOX_H / 2;
      d = `M ${tx - 34} ${ty} L ${tx} ${ty}`;
    }
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '1.6');
    path.setAttribute('marker-end', 'url(#fd-arrow)');
    path.setAttribute('class', 'fd-edge');
    path.dataset.pipe = pipe.id;
    const tip = document.createElementNS(NS, 'title');
    const valves = valvesOfPipe(pipe.id).map((v) => v.tag).join('、');
    tip.textContent = `${pipe.id} ${pipe.name} · ${FACTORY_MEDIA[pipe.medium].label}${valves ? ` · 阀门 ${valves}` : ''}`;
    path.appendChild(tip);
    path.addEventListener('click', () => opts.onPipe(pipe.id));
    svg.appendChild(path);
    edgeEls.push({ pipe: pipe.id, el: path, tip, label: tip.textContent });

    /* 内联件小三角（阀门/流量计），放在连线中点附近 */
    const inlines = inlineNodesOfPipe(pipe.id);
    if (inlines.length && a) {
      const mx = a.x + BOX_W + 26;
      const my = a.y + BOX_H / 2;
      for (let i = 0; i < inlines.length; i++) {
        const tri = document.createElementNS(NS, 'polygon');
        const px = mx + i * 12;
        tri.setAttribute('points', `${px},${my - 4} ${px},${my + 4} ${px + 7},${my}`);
        tri.setAttribute('class', 'fd-inline');
        tri.dataset.node = inlines[i].uid;
        const t2 = document.createElementNS(NS, 'title');
        t2.textContent = `${inlines[i].tag} ${inlines[i].label}`;
        tri.appendChild(t2);
        tri.addEventListener('click', (e) => { e.stopPropagation(); opts.onNode(inlines[i].uid); });
        svg.appendChild(tri);
      }
    }
  }

  /* 设备符号 */
  const nodeEls: { uid: string; rect: SVGRectElement; label: SVGTextElement; tag: SVGTextElement }[] = [];
  for (const node of FACTORY_NODES) {
    if (node.inline) continue;
    const p = pos.get(node.uid);
    if (!p) continue;
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'fd-node');
    g.dataset.uid = node.uid;
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', String(p.x));
    rect.setAttribute('y', String(p.y));
    rect.setAttribute('width', String(BOX_W));
    rect.setAttribute('height', String(BOX_H));
    rect.setAttribute('rx', '6');
    rect.setAttribute('class', 'fd-node-box');
    const tag = document.createElementNS(NS, 'text');
    tag.setAttribute('x', String(p.x + BOX_W / 2));
    tag.setAttribute('y', String(p.y + 16));
    tag.setAttribute('text-anchor', 'middle');
    tag.setAttribute('class', 'fd-node-tag');
    tag.textContent = node.tag;
    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', String(p.x + BOX_W / 2));
    label.setAttribute('y', String(p.y + 30));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'fd-node-name');
    label.textContent = node.label;
    const tip = document.createElementNS(NS, 'title');
    tip.textContent = `${node.tag} ${node.label}`;
    g.appendChild(rect);
    g.appendChild(tag);
    g.appendChild(label);
    g.appendChild(tip);
    g.addEventListener('click', () => opts.onNode(node.uid));
    svg.appendChild(g);
    nodeEls.push({ uid: node.uid, rect, label, tag });
  }

  scroller.appendChild(svg);
  wrap.appendChild(scroller);

  const legend = document.createElement('div');
  legend.className = 'factory-diagram-legend';
  const seen = new Set<string>();
  for (const pipe of FACTORY_PIPES) {
    if (seen.has(pipe.medium)) continue;
    seen.add(pipe.medium);
    const item = document.createElement('span');
    item.className = 'fd-legend-item';
    const swatch = document.createElement('i');
    swatch.style.background = `#${FACTORY_MEDIA[pipe.medium].color.toString(16).padStart(6, '0')}`;
    item.appendChild(swatch);
    item.appendChild(document.createTextNode(FACTORY_MEDIA[pipe.medium].label));
    legend.appendChild(item);
  }
  wrap.appendChild(legend);

  return {
    el: wrap,
    setActive(sel) {
      for (const n of nodeEls) {
        const active = sel.node === n.uid;
        n.rect.classList.toggle('is-active', active);
        n.tag.classList.toggle('is-active', active);
        n.label.classList.toggle('is-active', active);
      }
      for (const e of edgeEls) {
        e.el.classList.toggle('is-active', sel.pipe === e.pipe);
      }
    },
    setFlows(read) {
      for (const edge of edgeEls) {
        const flow = read(edge.pipe);
        if (!flow) continue;
        edge.el.dataset.flow = flow.state;
        edge.el.dataset.restricted = String(flow.throttle);
        edge.tip.textContent = edge.label + ' · ' + teachingFlowLabel(flow);
      }
    },
    collapsed: () => wrap.classList.contains('is-collapsed'),
    setCollapsed,
    setVisible(on) {
      wrap.hidden = !on;
    }
  };
}