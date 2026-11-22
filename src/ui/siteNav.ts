import { el, button, icon, ICONS } from './dom';
import { openRecordsDialog } from './dialogs';

export type NavModule = 'factory' | 'home' | 'workshop' | 'plant' | 'boil' | 'assets';

const CHEVRON = 'M6 9l6 6 6-6';

const PROCESS_ENTRIES: { id: NavModule; label: string; href: string; desc: string }[] = [
  { id: 'plant', label: '化工厂全流程装置', href: '#/plant', desc: '18 台设备串联的流程联动演示' },
  { id: 'boil', label: '微沸喷烧全流程', href: '#/boil', desc: '五区工艺、上下游追踪与流程播放' }
];

/**
 * 站点顶部主导航：设备库 / 组装工坊 / 工艺流程 / 高精度模型库 + 学习记录。
 * 手机端折叠为菜单按钮，全部入口保持键盘与触屏可操作。
 */
export function siteNav(active: NavModule, opts: { homeClass?: boolean } = {}): HTMLElement {
  const header = el('header', 'site-nav' + (opts.homeClass ? ' home-header' : ''));
  header.dataset.activeModule = active;

  const inner = el('div', 'site-nav-inner');
  const brand = el('a', 'brand site-brand') as HTMLAnchorElement;
  brand.href = '#/';
  brand.setAttribute('aria-label', '化工设备三维实训室 · 返回教学工厂首页');
  const logo = el('span', 'brand-logo');
  logo.appendChild(icon(ICONS.cube, 24));
  brand.appendChild(logo);
  const brandText = el('span', 'brand-text');
  brandText.appendChild(el('span', 'brand-title', '化工设备三维实训室'));
  brandText.appendChild(el('span', 'brand-sub', '三维结构学习平台'));
  brand.appendChild(brandText);
  inner.appendChild(brand);

  const links = el('nav', 'site-links');
  links.setAttribute('aria-label', '主导航');

  const link = (id: NavModule, label: string, href: string): HTMLAnchorElement => {
    const a = el('a', 'site-link') as HTMLAnchorElement;
    a.href = href;
    a.textContent = label;
    a.dataset.nav = id;
    if (active === id) {
      a.classList.add('active');
      a.setAttribute('aria-current', 'page');
    }
    return a;
  };

  links.appendChild(link('factory', '教学工厂', '#/'));
  links.appendChild(link('home', '设备库', '#/library'));
  links.appendChild(link('workshop', '组装工坊', '#/workshop'));

  const drop = el('div', 'site-drop');
  const dropBtn = button('', 'site-link site-drop-btn', () => toggleDrop(), '打开工艺流程菜单');
  dropBtn.setAttribute('aria-expanded', 'false');
  dropBtn.setAttribute('aria-haspopup', 'true');
  if (active === 'plant' || active === 'boil') dropBtn.classList.add('active');
  dropBtn.appendChild(el('span', '', '工艺流程'));
  dropBtn.appendChild(icon(CHEVRON, 14));
  const dropMenu = el('div', 'site-drop-menu');
  dropMenu.hidden = true;
  dropMenu.setAttribute('role', 'menu');
  dropMenu.setAttribute('aria-label', '工艺流程');
  for (const item of PROCESS_ENTRIES) {
    const a = el('a', 'site-drop-item') as HTMLAnchorElement;
    a.href = item.href;
    a.dataset.nav = item.id;
    if (active === item.id) a.setAttribute('aria-current', 'page');
    a.setAttribute('role', 'menuitem');
    a.appendChild(el('span', 'site-drop-label', item.label));
    a.appendChild(el('span', 'site-drop-desc', item.desc));
    dropMenu.appendChild(a);
  }
  drop.appendChild(dropBtn);
  drop.appendChild(dropMenu);
  links.appendChild(drop);
  links.appendChild(link('assets', '高精度模型库', '#/assets'));
  inner.appendChild(links);

  const actions = el('div', 'site-actions');
  actions.appendChild(button('学习记录', 'btn btn-outline site-records', () => openRecordsDialog(), '查看、导出、导入或清除本机学习记录'));
  const menuBtn = button('', 'site-menu-btn', () => toggleMobile(), '打开导航菜单');
  menuBtn.setAttribute('aria-expanded', 'false');
  menuBtn.setAttribute('aria-controls', 'site-mobile-menu');
  menuBtn.appendChild(icon(ICONS.menu, 20));
  actions.appendChild(menuBtn);
  inner.appendChild(actions);
  header.appendChild(inner);

  const mobile = el('div', 'site-mobile-menu');
  mobile.id = 'site-mobile-menu';
  mobile.hidden = true;
  mobile.setAttribute('aria-label', '手机端主导航');
  const mLink = (id: NavModule, label: string, href: string): HTMLAnchorElement => {
    const a = el('a', 'site-mobile-link') as HTMLAnchorElement;
    a.href = href;
    a.textContent = label;
    a.dataset.nav = id;
    if (active === id) {
      a.classList.add('active');
      a.setAttribute('aria-current', 'page');
    }
    return a;
  };
  mobile.appendChild(mLink('factory', '教学工厂', '#/'));
  mobile.appendChild(mLink('home', '设备库', '#/library'));
  mobile.appendChild(mLink('workshop', '组装工坊', '#/workshop'));
  mobile.appendChild(el('div', 'site-mobile-group-label', '工艺流程'));
  mobile.appendChild(mLink('plant', '化工厂全流程装置', '#/plant'));
  mobile.appendChild(mLink('boil', '微沸喷烧全流程', '#/boil'));
  mobile.appendChild(mLink('assets', '高精度模型库', '#/assets'));
  mobile.appendChild(button('学习记录', 'btn btn-outline site-mobile-records', () => {
    closeMobile();
    openRecordsDialog();
  }, '查看、导出、导入或清除本机学习记录'));
  header.appendChild(mobile);

  function toggleDrop(force?: boolean) {
    const open = force ?? dropMenu.hidden;
    dropMenu.hidden = !open;
    dropBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      closeMobile();
      const first = dropMenu.querySelector<HTMLAnchorElement>('a');
      first?.focus();
    }
  }
  function closeDrop() {
    dropMenu.hidden = true;
    dropBtn.setAttribute('aria-expanded', 'false');
  }
  function toggleMobile(force?: boolean) {
    const open = force ?? mobile.hidden;
    mobile.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? '关闭导航菜单' : '打开导航菜单');
    if (open) {
      closeDrop();
      mobile.querySelector<HTMLAnchorElement>('a')?.focus();
    }
  }
  function closeMobile() {
    mobile.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.setAttribute('aria-label', '打开导航菜单');
  }
  function closeAll() {
    closeDrop();
    closeMobile();
  }

  dropBtn.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      toggleDrop(true);
    }
  });
  dropMenu.addEventListener('keydown', (ev) => {
    const items = [...dropMenu.querySelectorAll<HTMLAnchorElement>('a')];
    const idx = items.indexOf(document.activeElement as HTMLAnchorElement);
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeDrop();
      dropBtn.focus();
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    }
  });
  mobile.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeMobile();
      menuBtn.focus();
    }
  });
  header.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && (!dropMenu.hidden || !mobile.hidden)) {
      closeAll();
      dropBtn.focus();
    }
  });
  document.addEventListener('click', function onDocClick(ev) {
    if (!header.isConnected) {
      document.removeEventListener('click', onDocClick);
      return;
    }
    if (!header.contains(ev.target as Node)) closeAll();
  });
  return header;
}
