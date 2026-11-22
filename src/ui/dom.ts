export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(label: string, className: string, onClick: (ev: MouseEvent) => void, title?: string): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

export function sliderRow(label: string, min: number, max: number, value: number, step: number, onInput: (v: number) => void, fmt: (v: number) => string): { row: HTMLElement; input: HTMLInputElement; val: HTMLElement } {
  const row = el('div', 'ctrl-slider');
  row.appendChild(el('span', 'ctrl-label', label));
  const input = el('input', 'range');
  input.type = 'range'; input.min = String(min); input.max = String(max); input.value = String(value); input.step = String(step);
  const val = el('span', 'ctrl-value', fmt(value));
  input.addEventListener('input', () => {
    const v = Number(input.value);
    val.textContent = fmt(v);
    onInput(v);
  });
  row.appendChild(input);
  row.appendChild(val);
  return { row, input, val };
}

export function icon(pathD: string, size = 16): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', pathD);
  svg.appendChild(p);
  return svg;
}

export const ICONS = {
  back: 'M19 12H5 M12 19l-7-7 7-7',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35',
  star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  expand: 'M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7',
  collapse: 'M4 14h6v6 M20 10h-6V4 M14 10l7-7 M3 21l7-7',
  play: 'M5 3l14 9-14 9V3z',
  pause: 'M6 4h4v16H6z M14 4h4v16h-4z',
  replay: 'M1 4v6h6 M3.51 15a9 9 0 1 0 2.13-9.36L1 10',
  undo: 'M3 7v6h6 M21 17a9 9 0 0 0-15-6.7L3 13',
  hint: 'M9 18h6 M10 22h4 M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0 0 12 2z',
  reset: 'M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0 1 14.85-3.36L23 10 M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3 M12 17h.01',
  menu: 'M3 12h18 M3 6h18 M3 18h18',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01',
  close: 'M18 6L6 18 M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  warn: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  rotate: 'M23 4v6h-6 M20.49 15a9 9 0 1 1-2.12-9.36L23 10',
  wrench: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  layers: 'M12 2L2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5',
  cut: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M20 4L8.12 15.88 M14.47 14.48L20 20 M8.12 8.12L12 12',
  ghost: 'M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z',
  cube: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12'
};
