import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BOIL_INTERNALS, OBSERVATION_MODES, type ObservationMode } from '../data/boilInternals';
import type { EquipmentInstanceDef } from '../data/processTypes';
import { InternalsView } from '../engine/boilInternals';
import type { BoilModelKey } from '../engine/boilModels';
import { button, el } from '../ui/dom';

const inspectionTypes = new Set(['baghouse', 'wash-tower', 'wet-esp', 'id-fan']);

export function supportsInspection(equipment: EquipmentInstanceDef) {
  const key = equipment.modelKey;
  return key !== undefined && inspectionTypes.has(key) && !!BOIL_INTERNALS[key as BoilModelKey];
}

export function openInspection(parent: HTMLElement, equipment: EquipmentInstanceDef, onClose: () => void, initialPart?: string) {
  const view = new InternalsView(equipment.modelKey as BoilModelKey);
  const dialog = document.createElement('dialog');
  dialog.className = 'boil-inspection';
  dialog.setAttribute('aria-label', equipment.name + '结构观察');
  const layout = el('div', 'boil-inspection-layout');
  const top = el('header', 'boil-inspection-top');
  const returnBtn = button('返回流程', 'boil-btn boil-btn-ghost', onClose);
  top.append(returnBtn, el('h2', '', equipment.name));
  const modes = el('div', 'boil-inspection-modes');
  modes.setAttribute('aria-label', '结构观察模式');
  const stage = el('div', 'boil-inspection-stage');
  const information = el('div', 'boil-inspection-information');
  const partSelect = document.createElement('select');
  partSelect.setAttribute('aria-label', '查找教学部件');
  partSelect.add(new Option('整机结构', ''));
  for (const part of view.build.def.parts) partSelect.add(new Option(part.name, part.id));
  const statement = el('p', '', view.build.def.summary);
  const source = document.createElement('details');
  source.append(el('summary', '', '依据与边界'), el('p', '', view.build.def.boundaryNote), el('p', '', equipment.sourceNote));
  information.append(partSelect, statement, source);
  layout.append(top, modes, stage, information);
  dialog.append(layout);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.localClippingEnabled = true;
  renderer.domElement.setAttribute('aria-label', equipment.name + '三维模型');
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101b24);
  const ambient = new THREE.HemisphereLight(0xdaedff, 0x526472, 2.1);
  const key = new THREE.DirectionalLight(0xfff8eb, 2.2);
  key.position.set(5, 9, 6);
  scene.add(ambient, key, view.build.group);
  view.setAnimationEnabled(false);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.02, 500);
  const controls = new OrbitControls(camera, renderer.domElement);
  const bounds = new THREE.Box3().setFromObject(view.build.group);
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(0.15, bounds.getSize(new THREE.Vector3()).length() / 2);
  const direction = new THREE.Vector3(1, 0.65, 1).normalize();
  const modeButtons = new Map<ObservationMode, HTMLButtonElement>();

  function fit() {
    const verticalScale = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const horizontalScale = verticalScale * camera.aspect;
    const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    let distance = 0;
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const offset = new THREE.Vector3(x, y, z).sub(center);
          const width = Math.abs(offset.dot(right)) / horizontalScale;
          const height = Math.abs(offset.dot(up)) / verticalScale;
          distance = Math.max(distance, offset.dot(direction) + Math.max(width, height) * 1.12);
        }
      }
    }
    controls.target.copy(center);
    controls.minDistance = radius * 0.17;
    controls.maxDistance = Math.max(radius * 12, distance);
    camera.position.copy(center).addScaledVector(direction, distance);
    controls.update();
  }

  function mode(value: ObservationMode) {
    view.setMode(value);
    for (const [id, control] of modeButtons) control.setAttribute('aria-pressed', String(id === value));
  }

  for (const item of OBSERVATION_MODES) {
    if (item.id !== 'normal' && item.id !== 'transparent' && item.id !== 'internal') continue;
    const b = button(item.label, 'boil-btn boil-btn-ghost', () => mode(item.id), item.note);
    modeButtons.set(item.id, b);
    modes.appendChild(b);
  }
  mode('transparent');
  function displayPart() {
    const part = view.selectPart(partSelect.value || null);
    statement.textContent = part ? part.note : view.build.def.summary;
  }
  partSelect.addEventListener('change', displayPart);
  if (initialPart && view.build.def.parts.some(part => part.id === initialPart)) {
    partSelect.value = initialPart;
    displayPart();
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); onClose(); });

  let fitted = false;
  const resize = new ResizeObserver(() => {
    const width = stage.clientWidth, height = stage.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    if (!fitted) { fit(); fitted = true; }
  });
  parent.appendChild(dialog);
  dialog.showModal();
  returnBtn.focus();
  resize.observe(stage);
  renderer.setAnimationLoop(() => renderer.render(scene, camera));
  return {
    dispose() {
      resize.disconnect();
      controls.dispose();
      renderer.setAnimationLoop(null);
      view.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      dialog.close();
      dialog.remove();
    }
  };
}
