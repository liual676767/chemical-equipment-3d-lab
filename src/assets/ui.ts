import { UPLOAD_ASSETS, assetById, type UploadAsset } from './registry';
import { AssetViewer, type SelectedInfo } from './viewer';
import { el, button, icon, ICONS, sliderRow } from '../ui/dom';
import { siteNav } from '../ui/siteNav';
import { deviceById } from '../data/devices';
import './assets.css';

const fmtBytes = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const fmtTris = (n: number) => (n >= 10000 ? (n / 10000).toFixed(1) + ' 万面' : n.toLocaleString('zh-CN') + ' 面');

export function renderAssetLibrary(root: HTMLElement, initialId?: string) {
  root.innerHTML = '';
  const page = el('div', 'assets-page');

  /* 顶栏：与首页共用主导航 */
  page.appendChild(siteNav('assets'));

  /* 介绍 */
  const intro = el('section', 'home-intro assets-intro');
  const introHead = el('div', 'assets-intro-head');
  introHead.appendChild(el('h2', '', '高精度工业设备模型库'));
  introHead.appendChild(el('span', 'badge badge-model', '外观素材'));
  intro.appendChild(introHead);
  intro.appendChild(el('p', 'intro-text',
    '本页展示从用户上传的 3ds Max 工业设备素材中拆分、转换并压缩得到的 13 件外观模型：可旋转、缩放、平移、剖切、爆炸和逐件查看。素材为装饰级外观模型，不含内部叶轮、密封、阀座等教学结构；设备结构学习与拆装练习请回到对应设备的三维工作台。'));
  const introTags = el('div', 'intro-tags');
  for (const t of ['GLB + Meshopt 压缩', '无内部结构', '教学设备请回工作台', '素材来源：用户上传']) {
    introTags.appendChild(el('span', 'intro-tag', t));
  }
  intro.appendChild(introTags);
  page.appendChild(intro);

  /* 主体三栏 */
  const layout = el('div', 'assets-layout');

  /* 左：素材清单 */
  const listPanel = el('aside', 'assets-list');
  const listHead = el('div', 'assets-list-head');
  listHead.appendChild(el('h3', '', '素材清单'));
  listHead.appendChild(el('span', 'assets-count', String(UPLOAD_ASSETS.length)));
  listPanel.appendChild(listHead);
  const listScroll = el('div', 'assets-list-scroll');
  listPanel.appendChild(listScroll);
  const itemButtons = new Map<string, HTMLButtonElement>();
  const groups = new Map<string, UploadAsset[]>();
  for (const a of UPLOAD_ASSETS) {
    if (!groups.has(a.categoryLabel)) groups.set(a.categoryLabel, []);
    groups.get(a.categoryLabel)!.push(a);
  }
  for (const [label, list] of groups) {
    const group = el('div', 'assets-group');
    group.appendChild(el('h4', 'assets-group-title', label));
    for (const a of list) {
      const b = el('button', 'asset-item');
      b.type = 'button';
      const imgWrap = el('span', 'asset-thumb');
      const img = el('img');
      img.src = a.preview;
      img.alt = a.name;
      img.loading = 'lazy';
      imgWrap.appendChild(img);
      b.appendChild(imgWrap);
      const meta = el('span', 'asset-item-meta');
      meta.appendChild(el('span', 'asset-item-name', a.name));
      meta.appendChild(el('span', 'asset-item-sub', `${fmtTris(a.tris)} · ${fmtBytes(a.bytes)}`));
      b.appendChild(meta);
      b.addEventListener('click', () => selectAsset(a));
      group.appendChild(b);
      itemButtons.set(a.id, b);
    }
    listScroll.appendChild(group);
  }
  layout.appendChild(listPanel);

  /* 中：三维舞台 */
  const stage = el('section', 'assets-stage');
  const toolbar = el('div', 'assets-toolbar');
  stage.appendChild(toolbar);
  const canvasWrap = el('div', 'assets-canvas-wrap');
  stage.appendChild(canvasWrap);
  const hint = el('div', 'assets-hint', '左键旋转 · 滚轮缩放 · 右键平移 · 点击零件查看信息');
  stage.appendChild(hint);
  const loading = el('div', 'assets-loading');
  const loadingText = el('div', 'assets-loading-text', '正在加载模型…');
  const bar = el('div', 'assets-loading-bar');
  const barFill = el('div', 'assets-loading-fill');
  bar.appendChild(barFill);
  loading.appendChild(loadingText);
  loading.appendChild(bar);
  stage.appendChild(loading);
  const errorBox = el('div', 'assets-error');
  errorBox.style.display = 'none';
  stage.appendChild(errorBox);
  layout.appendChild(stage);

  /* 右：信息 */
  const infoPanel = el('aside', 'assets-info');
  layout.appendChild(infoPanel);
  page.appendChild(layout);
  root.appendChild(page);

  /* 视图控制 */
  const state = { cutOn: false, explode: 0, cutAxis: 'x' as 'x' | 'y' | 'z', xray: false, wire: false, auto: false };
  const toolbarButtons: { btn: HTMLButtonElement; key: string }[] = [];
  const toggleButton = (label: string, key: string, onClick: () => void) => {
    const b = button(label, 'asset-tool', () => {
      onClick();
      b.classList.toggle('active');
    });
    toolbarButtons.push({ btn: b, key });
    return b;
  };

  const rowView = el('div', 'asset-tool-row');
  rowView.appendChild(el('span', 'asset-tool-label', '视图'));
  rowView.appendChild(button('复位视角', 'asset-tool', () => viewer.resetView(), '恢复初始相机'));
  rowView.appendChild(button('适应模型', 'asset-tool', () => viewer.fitView(), '按模型尺寸重新取景'));
  rowView.appendChild(toggleButton('自动旋转', 'auto', () => { state.auto = !state.auto; viewer.setAutoRotate(state.auto); }));
  toolbar.appendChild(rowView);

  const rowDisplay = el('div', 'asset-tool-row');
  rowDisplay.appendChild(el('span', 'asset-tool-label', '显示'));
  rowDisplay.appendChild(toggleButton('线框', 'wire', () => { state.wire = !state.wire; viewer.setWireframe(state.wire); }));
  rowDisplay.appendChild(toggleButton('X 射线', 'xray', () => { state.xray = !state.xray; viewer.setXray(state.xray); }));
  const cutBtn = toggleButton('剖切', 'cut', () => {
    state.cutOn = !state.cutOn;
    viewer.setCut(cutT / 100, state.cutOn);
    updateCutUI();
  });
  rowDisplay.appendChild(cutBtn);
  toolbar.appendChild(rowDisplay);

  const rowAxis = el('div', 'asset-tool-row asset-axis-row');
  rowAxis.appendChild(el('span', 'asset-tool-label', '剖切面'));
  for (const axis of ['x', 'y', 'z'] as const) {
    const b = button(axis.toUpperCase() + ' 向', 'asset-tool axis-btn' + (axis === 'x' ? ' active' : ''), () => {
      state.cutAxis = axis;
      for (const other of rowAxis.querySelectorAll('.axis-btn')) other.classList.remove('active');
      b.classList.add('active');
      viewer.setCutAxis(axis);
      viewer.setCut(cutT / 100, state.cutOn);
      updateCutUI();
    });
    rowAxis.appendChild(b);
  }
  toolbar.appendChild(rowAxis);

  let cutT = 50;
  const cutSlider = sliderRow('剖切位置', 0, 100, 50, 1, (v) => {
    cutT = v;
    if (state.cutOn) viewer.setCut(v / 100, true);
    updateCutUI();
  }, (v) => `${v}%`);
  const explodeSlider = sliderRow('爆炸程度', 0, 100, 0, 1, (v) => {
    state.explode = v;
    viewer.setExplode(v / 100);
  }, (v) => `${v}%`);
  const rowSliders = el('div', 'asset-tool-row asset-sliders');
  rowSliders.appendChild(cutSlider.row);
  rowSliders.appendChild(explodeSlider.row);
  toolbar.appendChild(rowSliders);

  const rowActions = el('div', 'asset-tool-row');
  rowActions.appendChild(el('span', 'asset-tool-label', '操作'));
  rowActions.appendChild(button('隐藏选中件', 'asset-tool', () => viewer.hideSelected()));
  rowActions.appendChild(button('显示全部', 'asset-tool', () => viewer.showAll()));
  toolbar.appendChild(rowActions);

  function updateCutUI() {
    cutSlider.input.disabled = !state.cutOn;
    cutSlider.val.style.opacity = state.cutOn ? '1' : '0.45';
  }
  updateCutUI();

  /* 右侧信息渲染 */
  let current: UploadAsset = assetById(initialId || '') || UPLOAD_ASSETS[0];
  function renderInfo(asset: UploadAsset) {
    infoPanel.innerHTML = '';
    const head = el('div', 'asset-info-head');
    head.appendChild(el('h2', '', asset.name));
    head.appendChild(el('span', 'badge badge-cat', asset.categoryLabel));
    infoPanel.appendChild(head);
    infoPanel.appendChild(el('p', 'asset-info-note', asset.note));

    const stats = el('div', 'asset-stat-grid');
    const stat = (k: string, v: string) => {
      const cell = el('div', 'asset-stat');
      cell.appendChild(el('span', 'asset-stat-k', k));
      cell.appendChild(el('span', 'asset-stat-v', v));
      stats.appendChild(cell);
    };
    stat('三角面', fmtTris(asset.tris));
    stat('网格', String(asset.meshes));
    stat('材质', String(asset.materials));
    stat('文件', fmtBytes(asset.bytes));
    infoPanel.appendChild(stats);

    const matchWrap = el('div', 'asset-block');
    matchWrap.appendChild(el('h3', '', '站内对照设备'));
    if (asset.matches.length) {
      const links = el('div', 'asset-links');
      for (const id of asset.matches) {
        const d = deviceById(id);
        if (!d) continue;
        links.appendChild(button(d.name + ' →', 'btn btn-outline asset-device-link', () => { location.hash = '#/device/' + id; }, '进入教学设备工作台'));
      }
      matchWrap.appendChild(links);
      matchWrap.appendChild(el('p', 'asset-block-note', '对照设备的剖切、爆炸、逐件拆装使用站内零件级教学模型，本页外观模型不参与拆装判定。'));
    } else {
      matchWrap.appendChild(el('p', 'asset-block-note', '站内暂无同名教学设备；此素材仅作外观/管件参考。'));
    }
    infoPanel.appendChild(matchWrap);

    const selBlock = el('div', 'asset-block');
    selBlock.appendChild(el('h3', '', '选中零件'));
    selectedBox = el('div', 'asset-selected');
    selectedBox.appendChild(el('p', 'asset-selected-empty', '在三维视图中点击任意网格查看名称、材质与面数。'));
    selBlock.appendChild(selectedBox);
    infoPanel.appendChild(selBlock);

    const src = el('div', 'asset-block');
    src.appendChild(el('h3', '', '来源与边界'));
    src.appendChild(el('p', 'asset-block-note', `原始对象：${asset.source}。素材来自用户上传的知末网工业设备包，经 Blender 导入、按设备拆分、Meshopt 压缩；无贴图（上传包缺少主贴图），无内部结构，不替代制造图或教学拆装模型。`));
    infoPanel.appendChild(src);
  }

  let selectedBox: HTMLElement;
  const showSelected = (info: SelectedInfo | null) => {
    if (!selectedBox) return;
    selectedBox.innerHTML = '';
    if (!info) {
      selectedBox.appendChild(el('p', 'asset-selected-empty', '已取消选择。'));
      return;
    }
    selectedBox.appendChild(el('p', 'asset-selected-name', info.name));
    const rows: [string, string][] = [
      ['材质', info.material],
      ['三角面', info.tris.toLocaleString('zh-CN')],
      ['尺寸', info.size.map((v) => v.toFixed(2)).join(' × ')]
    ];
    for (const [k, v] of rows) {
      const r = el('div', 'asset-selected-row');
      r.appendChild(el('span', '', k));
      r.appendChild(el('strong', '', v));
      selectedBox.appendChild(r);
    }
  };

  /* 查看器 */
  const viewer = new AssetViewer(canvasWrap, {
    onSelect: (info) => showSelected(info),
    onStatus: (text) => {
      if (text) {
        loading.style.display = 'flex';
        loadingText.textContent = text;
      }
    },
    onProgress: (pct) => {
      barFill.style.width = Math.max(4, pct) + '%';
      if (pct >= 100) {
        window.setTimeout(() => { loading.style.display = 'none'; }, 180);
      }
    },
    onReady: () => { loading.style.display = 'none'; },
    onError: (msg) => {
      loading.style.display = 'none';
      errorBox.style.display = 'flex';
      errorBox.textContent = msg;
    }
  });

  function resetControls() {
    state.cutOn = false;
    state.explode = 0;
    state.auto = false;
    state.xray = false;
    state.wire = false;
    cutT = 50;
    cutSlider.input.value = '50';
    cutSlider.val.textContent = '50%';
    explodeSlider.input.value = '0';
    explodeSlider.val.textContent = '0%';
    for (const { btn } of toolbarButtons) btn.classList.remove('active');
    for (const other of rowAxis.querySelectorAll('.axis-btn')) other.classList.remove('active');
    rowAxis.querySelector('.axis-btn')?.classList.add('active');
    state.cutAxis = 'x';
    viewer.setAutoRotate(false);
    viewer.setWireframe(false);
    viewer.setXray(false);
    viewer.setCutAxis('x');
    viewer.setCut(0.5, false);
    viewer.setExplode(0);
    viewer.showAll();
    updateCutUI();
  }

  function selectAsset(asset: UploadAsset) {
    current = asset;
    for (const [id, b] of itemButtons) b.classList.toggle('active', id === asset.id);
    renderInfo(asset);
    resetControls();
    if (history.replaceState) history.replaceState(null, '', '#/assets/' + asset.id);
    errorBox.style.display = 'none';
    loading.style.display = 'flex';
    loadingText.textContent = '正在加载模型…';
    barFill.style.width = '4%';
    void viewer.load(asset);
  }

  selectAsset(current);

  (root as HTMLElement & { __dispose?: () => void }).__dispose = () => {
    viewer.dispose();
  };
}
