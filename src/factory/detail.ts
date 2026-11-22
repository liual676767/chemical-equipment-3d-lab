import {
  catalogDeviceOfNode, getNodeByUid, PROCEDURAL_INFO, PIPE_SIZES, stepOfNode, zoneOfNode,
  getJoint, jointsOfPipe, pipesOfNode,
  type FactoryNodeDef
} from '../data/factory';
import { assetsForDevice, type UploadAsset } from '../assets/registry';
import type { FactoryScene } from './scene';
/**
 * 设备细节浮层：外观参照 ↔ 内部教学结构（同一视角切换）、接口清单与出口。
 * 相机由调用方在打开前定位；关闭时由调用方恢复进入前的视角。
 */

export interface DetailContext {
  uid: string;
  scene: FactoryScene;
  onClose: (reason: 'button' | 'escape' | 'route') => void;
  onAppearanceToggle: (on: boolean) => void;
  onPortPick: (portId: string) => void;
  onToast: (msg: string) => void;
  onOpenWorkbench: (event: MouseEvent, deviceId: string) => void;
}

export interface DetailOverlay {
  el: HTMLElement;
  setPortPicked: (portId: string, ok: boolean) => void;
  dispose: () => void;
}

const ASSET_FALLBACK: UploadAsset | null = null;

export function openDetailOverlay(host: HTMLElement, ctx: DetailContext): DetailOverlay {
  const node = getNodeByUid(ctx.uid);
  if (!node) throw new Error(`不存在的设备：${ctx.uid}`);
  const device = catalogDeviceOfNode(node);
  const asset = assetOf(node);
  const step = stepOfNode(node);
  const zone = zoneOfNode(node);

  const el = document.createElement('aside');
  el.className = 'factory-detail';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `${node.tag} ${node.label} 设备细节`);

  const head = document.createElement('div');
  head.className = 'factory-detail-head';
  const titleBox = document.createElement('div');
  const tag = document.createElement('div');
  tag.className = 'factory-detail-tag';
  tag.textContent = node.tag;
  const title = document.createElement('div');
  title.className = 'factory-detail-title';
  title.textContent = node.label;
  titleBox.appendChild(tag);
  titleBox.appendChild(title);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn btn-ghost factory-detail-close';
  closeBtn.textContent = '返回厂区';
  closeBtn.addEventListener('click', () => ctx.onClose('button'));
  head.appendChild(titleBox);
  head.appendChild(closeBtn);
  el.appendChild(head);

  const meta = document.createElement('div');
  meta.className = 'factory-detail-meta';
  meta.textContent = `${zone.short} · 工序 ${step.no} ${step.title}`;
  el.appendChild(meta);

  /* 视角切换 */
  const viewSec = document.createElement('div');
  viewSec.className = 'factory-detail-section';
  const viewLabel = document.createElement('div');
  viewLabel.className = 'factory-detail-label';
  viewLabel.textContent = '同视角查看';
  viewSec.appendChild(viewLabel);
  const seg = document.createElement('div');
  seg.className = 'factory-seg';
  const btnStructure = document.createElement('button');
  btnStructure.type = 'button';
  btnStructure.className = 'factory-seg-btn is-active';
  btnStructure.textContent = '内部教学结构';
  const btnAppearance = document.createElement('button');
  btnAppearance.type = 'button';
  btnAppearance.className = 'factory-seg-btn';
  btnAppearance.textContent = '外观参照';
  if (!asset) {
    btnAppearance.disabled = true;
    btnAppearance.title = '该设备暂无可靠的外观模型对应';
  }
  seg.appendChild(btnStructure);
  seg.appendChild(btnAppearance);
  viewSec.appendChild(seg);
  const note = document.createElement('p');
  note.className = 'factory-detail-note';
  note.textContent = asset?.note || '内部教学结构按通用化工设备结构建模，尺寸与内部细节为教学示意。';
  viewSec.appendChild(note);
  el.appendChild(viewSec);

  let appearanceOn = false;
  let busy = false;
  const setSeg = (on: boolean) => {
    appearanceOn = on;
    btnStructure.classList.toggle('is-active', !on);
    btnAppearance.classList.toggle('is-active', on);
  };
  btnStructure.addEventListener('click', () => {
    if (!appearanceOn || busy) return;
    void ctx.scene.setAppearance(ctx.uid, false, '').then(() => {
      setSeg(false);
      ctx.onAppearanceToggle(false);
    });
  });
  btnAppearance.addEventListener('click', () => {
    if (appearanceOn || busy || !asset) return;
    busy = true;
    btnAppearance.disabled = true;
    void ctx.scene.setAppearance(ctx.uid, true, asset.file).then((ok) => {
      busy = false;
      btnAppearance.disabled = false;
      if (ok) {
        setSeg(true);
        ctx.onAppearanceToggle(true);
      } else {
        ctx.onToast('外观参照加载失败，已保留教学结构。');
      }
    });
  });
  el.appendChild(viewSec);

  /* 接口清单 */
  const portSec = document.createElement('div');
  portSec.className = 'factory-detail-section';
  const portLabel = document.createElement('div');
  portLabel.className = 'factory-detail-label';
  portLabel.textContent = '设备接口（点击识别）';
  portSec.appendChild(portLabel);
  const portList = document.createElement('div');
  portList.className = 'factory-port-list';
  const portButtons = new Map<string, HTMLButtonElement>();
  for (const port of node.ports) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'factory-port-item';
    const name = document.createElement('span');
    name.className = 'p-name';
    name.textContent = port.name + (port.added ? '（示意接管）' : '');
    const role = document.createElement('span');
    role.className = 'p-role';
    role.textContent = `${port.role === 'in' ? '入口' : port.role === 'out' ? '出口' : '连接口'} · ${PIPE_SIZES[port.size].label}`;
    b.appendChild(name);
    b.appendChild(role);
    b.addEventListener('click', () => ctx.onPortPick(port.id));
    portButtons.set(port.id, b);
    portList.appendChild(b);
  }
  portSec.appendChild(portList);
  el.appendChild(portSec);

  /* 内部说明 */
  const infoSec = document.createElement('div');
  infoSec.className = 'factory-detail-section';
  const infoLabel = document.createElement('div');
  infoLabel.className = 'factory-detail-label';
  infoLabel.textContent = '结构与作用';
  const roleP = document.createElement('p');
  roleP.className = 'factory-detail-text';
  roleP.textContent = node.role;
  const internalsP = document.createElement('p');
  internalsP.className = 'factory-detail-text is-muted';
  internalsP.textContent = node.internals;
  infoSec.appendChild(infoLabel);
  infoSec.appendChild(roleP);
  infoSec.appendChild(internalsP);
  el.appendChild(infoSec);

  /* 关联管线与接头 */
  const pipeSec = document.createElement('div');
  pipeSec.className = 'factory-detail-section';
  const pipeLabel = document.createElement('div');
  pipeLabel.className = 'factory-detail-label';
  pipeLabel.textContent = '连接管线';
  pipeSec.appendChild(pipeLabel);
  const pipeList = document.createElement('div');
  pipeList.className = 'factory-detail-links';
  for (const pipe of pipesOfNode(node.uid)) {
    const row = document.createElement('a');
    row.className = 'factory-detail-link';
    row.href = `#/pipe/${pipe.id}`;
    row.textContent = `${pipe.id} ${pipe.name}`;
    pipeList.appendChild(row);
    for (const joint of jointsOfPipe(pipe.id)) {
      const jb = document.createElement('button');
      jb.type = 'button';
      jb.className = 'btn btn-outline factory-detail-joint';
      jb.textContent = `法兰练习 · ${joint.id}`;
      jb.addEventListener('click', () => { location.hash = `#/practice/${joint.id}`; });
      pipeList.appendChild(jb);
    }
  }
  pipeSec.appendChild(pipeList);
  el.appendChild(pipeSec);

  /* 行动区 */
  const actions = document.createElement('div');
  actions.className = 'factory-detail-actions';
  if (device) {
    const wb = document.createElement('a');
    wb.className = 'btn btn-primary';
    wb.href = `#/device/${device.id}`;
    wb.textContent = '进入零件工作台';
    wb.addEventListener('click', (event) => ctx.onOpenWorkbench(event, device.id));
    actions.appendChild(wb);
  } else {
    const proc = PROCEDURAL_INFO[node.deviceId];
    const noteEl = document.createElement('span');
    noteEl.className = 'factory-detail-procedural';
    noteEl.textContent = proc ? `${proc.name}为场景内教学模型，暂无零件工作台。` : '该设备暂无零件工作台。';
    actions.appendChild(noteEl);
  }
  el.appendChild(actions);

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      ctx.onClose('escape');
    }
  };
  window.addEventListener('keydown', onKey, true);

  host.appendChild(el);

  return {
    el,
    setPortPicked(portId, ok) {
      const b = portButtons.get(portId);
      if (!b) return;
      b.classList.add(ok ? 'is-picked' : 'is-wrong');
      window.setTimeout(() => b.classList.remove('is-picked', 'is-wrong'), 1600);
    },
    dispose() {
      window.removeEventListener('keydown', onKey, true);
      el.remove();
    }
  };
}

function assetOf(node: FactoryNodeDef): UploadAsset | null {
  const list = assetsForDevice(node.deviceId);
  return list.length ? list[0] : null;
}

export function jointById(jointId: string) {
  return getJoint(jointId);
}