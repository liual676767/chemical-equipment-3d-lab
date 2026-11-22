import { DEVICES } from '../data/devices';
import { CATEGORIES } from '../data/types';
import { getRecord, toggleFavorite, practiceCompatible } from '../state/store';
import { el, button, icon, ICONS } from './dom';
import { siteNav } from './siteNav';
import { readCatalogState, rememberCatalogDeparture, writeCatalogState, type CatalogNavState } from './catalogState';

const totalParts = DEVICES.reduce((n, d) => n + d.parts.length, 0);
const practiceCount = DEVICES.filter((d) => d.assemblyOrder.length > 0).length;

interface ModuleEntry {
  id: string;
  href: string;
  label: string;
  desc: string;
  icon: string;
}

const MODULE_ENTRIES: ModuleEntry[] = [
  { id: 'workshop', href: '#/workshop', label: '组装工坊', desc: '搭管路、连设备，完成组装任务', icon: ICONS.wrench },
  { id: 'plant', href: '#/plant', label: '化工厂全流程装置', desc: '20 个设备实例的流程联动演示', icon: ICONS.layers },
  { id: 'boil', href: '#/boil', label: '微沸喷烧全流程', desc: '五区工艺、上下游追踪与流程播放', icon: ICONS.play },
  { id: 'assets', href: '#/assets', label: '高精度模型库', desc: '13 件上传外观模型，剖切查看', icon: ICONS.cube }
];

export function renderHome(root: HTMLElement) {
  root.innerHTML = '';
  const restored = readCatalogState();
  const restoreCat = restored && CATEGORIES.some((c) => c.id === restored.cat) ? restored.cat : 'all';
  const page = el('div', 'home');
  page.appendChild(siteNav('home', { homeClass: true }));

  /* ---------- 首页前部：站名 + 一句用途说明 ---------- */
  const hero = el('section', 'home-hero');
  const heroCopy = el('div', 'hero-copy');
  heroCopy.appendChild(el('p', 'hero-eyebrow', '三维结构学习 · 虚拟拆装练习'));
  heroCopy.appendChild(el('h1', 'hero-title', '化工设备三维实训室'));
  heroCopy.appendChild(el('p', 'hero-purpose',
    '旋转观察设备外形，剖开看内部结构，找到每个零件，并动手完成拆装练习。'));
  const heroMeta = el('p', 'hero-meta');
  heroMeta.appendChild(el('span', 'hero-stat', `${DEVICES.length} 台教学设备`));
  heroMeta.appendChild(el('span', 'hero-stat', `${totalParts} 个可交互零件`));
  heroMeta.appendChild(el('span', 'hero-stat hero-stat-ok', `${practiceCount} 台开放拆装练习`));
  heroMeta.appendChild(el('span', 'badge badge-model', '教学示意模型'));
  heroCopy.appendChild(heroMeta);
  hero.appendChild(heroCopy);
  page.appendChild(hero);

  /* ---------- 其他模块压缩为一行入口 ---------- */
  const moduleStrip = el('nav', 'module-strip');
  moduleStrip.setAttribute('aria-label', '其他教学模块');
  for (const m of MODULE_ENTRIES) {
    const a = el('a', 'module-entry') as HTMLAnchorElement;
    a.href = m.href;
    a.dataset.module = m.id;
    const iconWrap = el('span', 'module-entry-icon');
    iconWrap.appendChild(icon(m.icon, 18));
    a.appendChild(iconWrap);
    const text = el('span', 'module-entry-text');
    text.appendChild(el('strong', '', m.label));
    text.appendChild(el('span', '', m.desc));
    a.appendChild(text);
    moduleStrip.appendChild(a);
  }
  page.appendChild(moduleStrip);

  /* ---------- 设备目录：搜索 + 分类 + 列表 ---------- */
  const catalog = el('section', 'home-catalog');
  catalog.setAttribute('aria-labelledby', 'catalog-title');
  const catalogHead = el('div', 'catalog-head');
  const catalogHeading = el('div', 'catalog-heading');
  catalogHeading.appendChild(el('h2', 'catalog-title', '设备目录'));
  catalogHeading.id = 'catalog-title';
  catalogHeading.appendChild(el('p', 'catalog-sub', '按设备名称或分类查找；可叠加分类与「只看收藏」筛选。'));
  catalogHead.appendChild(catalogHeading);
  catalogHead.appendChild(el('span', 'catalog-count', `共 ${DEVICES.length} 台 · ${practiceCount} 台开放拆装`));
  catalog.appendChild(catalogHead);

  const toolbar = el('div', 'home-toolbar');
  const searchWrap = el('div', 'search-wrap');
  searchWrap.appendChild(icon(ICONS.search, 16));
  const search = el('input', 'search-input') as HTMLInputElement;
  search.type = 'search';
  search.placeholder = '搜索设备名称或分类，如「离心泵」「换热设备」…';
  search.setAttribute('aria-label', '搜索设备名称或分类');
  if (restored) search.value = restored.q;
  searchWrap.appendChild(search);
  toolbar.appendChild(searchWrap);

  const chips = el('div', 'chips');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', '设备分类筛选');
  let activeCat = restoreCat;
  let favOnly = !!restored?.fav;
  const chipButtons: HTMLButtonElement[] = [];
  for (const c of CATEGORIES) {
    const count = c.id === 'all' ? DEVICES.length : DEVICES.filter((d) => d.category === c.id).length;
    const b = button(c.label, 'chip', () => {
      activeCat = c.id;
      lastTrigger = null;
      hideRestoreNote();
      syncChips();
      renderCards();
      schedulePersist();
    }, `${c.label}：${count} 台设备`);
    b.dataset.cat = c.id;
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', `${c.label}，${count} 台设备`);
    chipButtons.push(b);
    chips.appendChild(b);
  }
  const favChip = button('★ 只看收藏', 'chip chip-fav', () => {
    favOnly = !favOnly;
    lastTrigger = null;
    hideRestoreNote();
    syncChips();
    renderCards();
    schedulePersist();
  }, '只显示已收藏的设备');
  favChip.setAttribute('aria-pressed', 'false');
  chips.appendChild(favChip);
  function syncChips() {
    chipButtons.forEach((b) => {
      const on = b.dataset.cat === activeCat;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    favChip.classList.toggle('active', favOnly);
    favChip.setAttribute('aria-pressed', String(favOnly));
  }
  syncChips();
  toolbar.appendChild(chips);
  catalog.appendChild(toolbar);

  const summary = el('p', 'catalog-summary');
  summary.setAttribute('role', 'status');
  summary.setAttribute('aria-live', 'polite');
  catalog.appendChild(summary);

  const restoreNote = el('p', 'catalog-restore-note');
  restoreNote.setAttribute('role', 'status');
  restoreNote.hidden = true;
  catalog.appendChild(restoreNote);

  /* 目录状态：只写当前历史条目与会话存储，不新增浏览历史。 */
  let lastTrigger: string | null = null;
  let persistTimer = 0;
  let scrollRaf = 0;
  const currentState = (trigger: string | null = lastTrigger, scrollY = window.scrollY): CatalogNavState => ({
    q: search.value,
    cat: activeCat,
    fav: favOnly,
    scrollY,
    triggerDeviceId: trigger
  });
  const persistNow = (trigger: string | null = lastTrigger) => {
    window.clearTimeout(persistTimer);
    persistTimer = 0;
    writeCatalogState(currentState(trigger));
  };
  const schedulePersist = () => {
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => persistNow(), 120);
  };
  const hideRestoreNote = () => { restoreNote.hidden = true; };
  const onScroll = () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      schedulePersist();
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  const navigateToDevice = (deviceId: string) => {
    lastTrigger = deviceId;
    rememberCatalogDeparture(currentState(deviceId), deviceId);
    location.hash = `#/device/${deviceId}`;
  };

  const grid = el('div', 'device-grid');
  catalog.appendChild(grid);

  const empty = el('div', 'empty-state');
  empty.hidden = true;
  empty.appendChild(el('div', 'empty-icon', '🔍'));
  empty.appendChild(el('p', 'empty-title', '没有找到匹配的设备'));
  empty.appendChild(el('p', 'empty-desc', '换个关键词试试，或清除当前的搜索、分类与收藏筛选。'));
  empty.appendChild(button('清除筛选', 'btn btn-primary', () => {
    search.value = '';
    activeCat = 'all';
    favOnly = false;
    lastTrigger = null;
    hideRestoreNote();
    syncChips();
    renderCards();
    window.scrollTo(0, 0);
    writeCatalogState(currentState(null, 0));
    search.focus();
  }));
  catalog.appendChild(empty);
  page.appendChild(catalog);

  /* ---------- 两套模型的用途说明（保留互链） ---------- */
  const note = el('section', 'model-note');
  note.appendChild(el('h2', 'model-note-title', '两套模型，用途不同'));
  const noteGrid = el('div', 'model-note-grid');
  const noteLearn = el('article', 'model-note-card');
  const noteLearnHead = el('h3', 'model-note-head');
  noteLearnHead.appendChild(el('span', 'badge badge-cat', '设备库'));
  noteLearnHead.appendChild(el('span', '', '零件级教学模型'));
  noteLearn.appendChild(noteLearnHead);
  noteLearn.appendChild(el('p', '', `18 台设备的 ${totalParts} 个可交互零件：剖视、透明观察、爆炸图、工作原理与虚拟拆装练习都在设备工作台完成。模型为程序化教学示意，不是制造图纸；未取得可靠来源的参数标注「待确认」。`));
  const learnLink = el('a', 'btn btn-outline') as HTMLAnchorElement;
  learnLink.href = '#/library';
  learnLink.textContent = '浏览设备目录';
  noteLearn.appendChild(learnLink);
  noteGrid.appendChild(noteLearn);
  const noteAsset = el('article', 'model-note-card');
  const noteAssetHead = el('h3', 'model-note-head');
  noteAssetHead.appendChild(el('span', 'badge badge-model', '模型库'));
  noteAssetHead.appendChild(el('span', '', '高精度外观模型'));
  noteAsset.appendChild(noteAssetHead);
  noteAsset.appendChild(el('p', '', '13 件用户上传的外观素材（GLB）：适合观察整体外观、剖切与爆炸展示，不含内部零件，不参与拆装判定。设备页与模型库之间保留了「高精度外观 ↗」相互链接。'));
  const assetLink = el('a', 'btn btn-outline') as HTMLAnchorElement;
  assetLink.href = '#/assets';
  assetLink.textContent = '进入高精度模型库';
  noteAsset.appendChild(assetLink);
  noteGrid.appendChild(noteAsset);
  note.appendChild(noteGrid);
  page.appendChild(note);

  /* ---------- 页脚 ---------- */
  const footer = el('footer', 'home-footer');
  footer.appendChild(el('p', '', '本站所有三维模型均为程序化教学示意模型，结构与真实设备存在简化差异，不用于工程设计与操作依据。'));
  footer.appendChild(el('p', '', '学习记录仅保存在当前浏览器本地存储中 · 设备型号、工程尺寸与性能参数未取得可靠来源的一律标注「待确认」。'));
  page.appendChild(footer);

  root.appendChild(page);

  function renderCards() {
    const q = search.value.trim().toLowerCase();
    grid.innerHTML = '';
    const list = DEVICES.filter((d) => {
      if (activeCat !== 'all' && d.category !== activeCat) return false;
      if (favOnly && !getRecord(d.id).favorite) return false;
      if (!q) return true;
      const hay = [d.name, d.categoryLabel, d.use, ...d.keywords, ...d.parts.map((p) => p.name)].join(' ').toLowerCase();
      return hay.includes(q);
    });
    empty.hidden = list.length > 0;
    grid.hidden = list.length === 0;
    summary.textContent = `显示 ${list.length} 台设备${activeCat !== 'all' ? ` · ${CATEGORIES.find((c) => c.id === activeCat)?.label ?? ''}` : ''}${favOnly ? ' · 只看收藏' : ''}`;
    for (const d of list) {
      const rec = getRecord(d.id);
      const card = el('article', 'device-card');
      card.dataset.deviceId = d.id;

      const preview = el('a', 'card-preview') as HTMLAnchorElement;
      preview.href = `#/device/${d.id}`;
      preview.setAttribute('aria-label', `进入${d.name}学习工作台`);
      preview.addEventListener('click', (ev) => {
        if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        ev.preventDefault();
        navigateToDevice(d.id);
      });
      const img = el('img', 'card-thumb') as HTMLImageElement;
      img.src = `./thumbs/${d.id}.png`;
      img.alt = `${d.name}三维预览`;
      img.width = 440;
      img.height = 260;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', () => {
        const ph = el('span', 'card-thumb-placeholder');
        ph.appendChild(icon(ICONS.cube, 34));
        ph.appendChild(el('span', 'card-thumb-placeholder-text', '预览暂缺'));
        img.replaceWith(ph);
      });
      preview.appendChild(img);
      preview.appendChild(el('span', 'card-cat', d.categoryLabel));
      card.appendChild(preview);

      const body = el('div', 'card-body');
      const titleRow = el('div', 'card-title-row');
      titleRow.appendChild(el('h3', 'card-title', d.name));
      const fav = button('', 'fav-btn' + (rec.favorite ? ' faved' : ''), (ev) => {
        ev.stopPropagation();
        const on = toggleFavorite(d.id);
        fav.classList.toggle('faved', on);
        fav.setAttribute('aria-pressed', String(on));
        fav.setAttribute('aria-label', on ? `取消收藏${d.name}` : `收藏${d.name}`);
        fav.title = on ? '取消收藏' : '收藏设备';
        if (favOnly) renderCards();
        schedulePersist();
      }, rec.favorite ? '取消收藏' : '收藏设备');
      fav.setAttribute('aria-pressed', String(rec.favorite));
      fav.setAttribute('aria-label', rec.favorite ? `取消收藏${d.name}` : `收藏${d.name}`);
      fav.appendChild(icon(ICONS.star, 18));
      titleRow.appendChild(fav);
      body.appendChild(titleRow);
      body.appendChild(el('p', 'card-use', d.use));

      const foot = el('div', 'card-foot');
      const status = el('span', 'card-status');
      if (!d.assemblyOrder.length) {
        status.classList.add('status-pending');
        status.textContent = '拆装练习开发中';
      } else if (rec.completions > 0) {
        status.classList.add('status-ok');
        status.textContent = `已完成练习 ${rec.completions} 次`;
      } else if (rec.practice && !rec.practice.completed && practiceCompatible(d.id)) {
        status.classList.add('status-info');
        status.textContent = '有保存的练习进度';
      } else {
        status.classList.add('status-ok');
        status.textContent = '拆装练习已开放';
      }
      foot.appendChild(status);
      foot.appendChild(button('进入学习', 'btn btn-primary card-enter', () => {
        navigateToDevice(d.id);
      }, `进入${d.name}学习工作台`));
      body.appendChild(foot);
      card.appendChild(body);
      grid.appendChild(card);
    }
  }

  search.addEventListener('input', () => {
    lastTrigger = null;
    hideRestoreNote();
    renderCards();
    schedulePersist();
  });
  renderCards();
  persistNow(restored?.triggerDeviceId ?? null);
  if (restored) {
    requestAnimationFrame(() => {
      window.scrollTo(0, restored.scrollY);
      const target = restored.triggerDeviceId
        ? grid.querySelector<HTMLElement>(`.device-card[data-device-id="${CSS.escape(restored.triggerDeviceId)}"] .card-enter`)
        : null;
      if (target) {
        target.focus({ preventScroll: true });
      } else if (restored.triggerDeviceId) {
        restoreNote.hidden = false;
        restoreNote.textContent = '返回时该设备已不在当前筛选结果中；筛选条件已保留，可清除筛选查看完整目录。';
        search.focus({ preventScroll: true });
      }
    });
  }

  (root as HTMLElement & { __dispose?: () => void }).__dispose = () => {
    persistNow();
    window.removeEventListener('scroll', onScroll);
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    window.clearTimeout(persistTimer);
  };
}
