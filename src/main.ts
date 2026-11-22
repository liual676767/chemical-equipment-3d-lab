import './styles.css';
import { renderHome } from './ui/home';
import { renderWorkbench } from './ui/workbench';
import { renderWorkshop } from './workshop/ui';
import { renderPlant } from './plant/ui';
import { renderBoil } from './boil/ui';
import { renderAssetLibrary } from './assets/ui';
import { renderFactory } from './factory/ui';

const root = document.getElementById('app')!;

type AppRoot = HTMLElement & {
  __dispose?: () => void;
  __factory?: (hash: string) => void;
  __boilRoute?: (hash: string) => void;
};

function isFactoryHash(hash: string): boolean {
  if (hash === '' || hash === '#/' || hash === '#') return true;
  return /^#\/(zone|node|pipe|detail|practice|task)(\/|$)/.test(hash);
}

function route() {
  const app = root as AppRoot;
  const hash = location.hash || '#/';

  /* 教学工厂内部路由：已挂载时只交给工厂处理，保留相机与选择 */
  if (isFactoryHash(hash)) {
    if (app.__factory) {
      app.__factory(hash);
    } else {
      app.__dispose?.();
      delete app.__dispose;
      renderFactory(root);
    }
    document.title = '化工设备三维实训室 · 三维教学工厂';
    window.scrollTo(0, 0);
    return;
  }

  if (hash.startsWith('#/boil') && app.__boilRoute) {
    app.__boilRoute(hash);
    return;
  }

  app.__dispose?.();
  delete app.__dispose;

  const m = hash.match(/^#\/device\/([\w-]+)/);
  const am = hash.match(/^#\/assets(?:\/([\w-]+))?/);
  if (am) {
    renderAssetLibrary(root, am[1]);
    document.title = '化工设备三维实训室 · 高精度模型库';
  } else if (hash.startsWith('#/boil')) {
    renderBoil(root);
    document.title = '化工设备三维实训室 · 微沸喷烧全流程';
  } else if (hash.startsWith('#/plant')) {
    renderPlant(root);
    document.title = '化工设备三维实训室 · 化工厂全流程装置';
  } else if (hash.startsWith('#/workshop')) {
    renderWorkshop(root);
    document.title = '化工设备三维实训室 · 管道与设备三维组装工坊';
  } else if (m) {
    renderWorkbench(root, m[1]);
    document.title = '化工设备三维实训室 · 三维学习工作台';
  } else {
    renderHome(root);
    document.title = '化工设备三维实训室 · 设备库';
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();