import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildPart } from '../workshop/geometry';
import { partById } from '../workshop/catalog';
import { flangeDims, GASKET_THICKNESS, pipeLen } from '../workshop/layout';
import {
  instOf, portOccupied, jointSlots, emptyState, portsAligned
} from '../workshop/state';
import type { WState, Instance } from '../workshop/types';
import { planConnection, type ConnectionPath } from '../workshop/assemblyPlan';
import { getJoint, type FactoryJointDef } from '../data/factory';

type Spec = Instance['spec'];

/**
 * 法兰接头练习（JOINT-201）：泵出口短管与过滤进料管之间的 DN50 PN16 法兰副。
 * 复用组装工坊的连接校验/装配引擎与零件几何；缺垫片时点名两个密封面。
 */

export interface PracticeContext {
  jointId: string;
  onClose: () => void;
  onComplete: (info: { items: string[]; attempts: number }) => void;
  onToast: (msg: string) => void;
}

export interface PracticeOverlay {
  el: HTMLElement;
  dispose: () => void;
}

const UID = { pipeL: 'pipeL', flangeA: 'flangeA', pipeR: 'pipeR', flangeB: 'flangeB', gasket: 'gasket' } as const;
const BOLT_UIDS = ['bolt1', 'bolt2', 'bolt3', 'bolt4'];
const NUT_UIDS = ['nut1', 'nut2', 'nut3', 'nut4'];
const EXTRA = { boltM12: 'boltM12', nutM12: 'nutM12' } as const;

interface Ctx {
  joint: FactoryJointDef;
  state: WState;
  history: string[];
  jointConnId: string | null;
  attempts: number;
  completed: boolean;
}

export function openPracticeOverlay(host: HTMLElement, ctx: PracticeContext): PracticeOverlay {
  const joint = getJoint(ctx.jointId);
  if (!joint) throw new Error(`不存在的法兰接头：${ctx.jointId}`);
  const model: Ctx = {
    joint,
    state: buildInitialState(joint),
    history: [],
    jointConnId: null,
    attempts: 0,
    completed: false
  };

  const el = document.createElement('div');
  el.className = 'factory-practice';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', '法兰连接练习');

  const head = document.createElement('header');
  head.className = 'fp-head';
  const ht = document.createElement('div');
  ht.className = 'fp-title';
  ht.textContent = `法兰连接练习 · ${joint.id}`;
  const hs = document.createElement('div');
  hs.className = 'fp-sub';
  hs.textContent = `${joint.aLabel} ↔ ${joint.bLabel}（DN${joint.dn} PN16，教学示意）`;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-outline fp-close';
  close.textContent = '返回厂区';
  close.addEventListener('click', () => ctx.onClose());
  head.appendChild(ht);
  head.appendChild(hs);
  head.appendChild(close);
  el.appendChild(head);

  const body = document.createElement('div');
  body.className = 'fp-body';
  const stage = document.createElement('div');
  stage.className = 'fp-stage';
  const panel = document.createElement('aside');
  panel.className = 'fp-panel';
  body.appendChild(stage);
  body.appendChild(panel);
  el.appendChild(body);

  /* ===== 三 mini 场景 ===== */
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  stage.appendChild(renderer.domElement);
  renderer.domElement.className = 'fp-canvas';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe4ecf4);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(42, 1, 0.02, 60);
  camera.position.set(2.1, 1.9, 4.5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0.85, 1.1);
  controls.minDistance = 1.4;
  controls.maxDistance = 11;
  controls.maxPolarAngle = Math.PI * 0.49;

  const hemi = new THREE.HemisphereLight(0xffffff, 0xb9c6d4, 0.9);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff4e2, 1.9);
  key.position.set(4, 7, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -6; key.shadow.camera.right = 6;
  key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
  key.shadow.camera.far = 24;
  key.shadow.bias = -0.0006;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdbe8ff, 0.45);
  fill.position.set(-5, 4, -4);
  scene.add(fill);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(7, 48),
    new THREE.MeshStandardMaterial({ color: 0xc7d1dd, roughness: 0.95, metalness: 0.02 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(14, 28, 0x8fa0b3, 0xaebbc9);
  const gm = grid.material as THREE.Material;
  gm.transparent = true;
  gm.opacity = 0.35;
  grid.position.y = 0.002;
  scene.add(grid);

  const tray = new THREE.Mesh(
    new THREE.BoxGeometry(4.6, 0.1, 1.7),
    new THREE.MeshStandardMaterial({ color: 0x9fb0c1, roughness: 0.8, metalness: 0.15 })
  );
  tray.position.set(0, 0.05, 2.1);
  tray.receiveShadow = true;
  scene.add(tray);

  const gapHalo = new THREE.Mesh(
    new THREE.TorusGeometry(0.62, 0.02, 8, 40),
    new THREE.MeshBasicMaterial({ color: 0xb42318, transparent: true, opacity: 0.85 })
  );
  gapHalo.position.set(0, 0.95, 0);
  gapHalo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0));
  scene.add(gapHalo);

  /* 缺垫片占位：略大于法兰外缘的红色薄环，从任何角度都能看到缺件位置 */
  const ghostGasket = new THREE.Mesh(
    new THREE.CylinderGeometry(0.87, 0.87, 0.03, 32),
    new THREE.MeshStandardMaterial({ color: 0xb42318, transparent: true, opacity: 0.55, roughness: 0.5, side: THREE.DoubleSide })
  );
  ghostGasket.rotation.z = Math.PI / 2;
  ghostGasket.position.set(0, 0.95, 0);
  scene.add(ghostGasket);

  const meshes = new Map<string, THREE.Group>();
  const pickables: THREE.Object3D[] = [];
  const runtimeIssues: string[] = [];

  function specOf(inst: Instance): Spec {
    return inst.spec;
  }

  function buildMesh(inst: Instance) {
    const part = partById(inst.partId);
    if (!part) { runtimeIssues.push(`未知零件 ${inst.partId}`); return; }
    try {
      const group = buildPart(inst.partId, specOf(inst), part.color, part.material);
      group.userData.instanceUid = inst.uid;
      group.traverse((o) => {
        o.userData.instanceUid = inst.uid;
        if ((o as THREE.Mesh).isMesh) {
          (o as THREE.Mesh).castShadow = true;
          (o as THREE.Mesh).receiveShadow = true;
          pickables.push(o);
        }
      });
      group.position.set(inst.pos[0], inst.pos[1], inst.pos[2]);
      group.rotation.set(inst.rot[0], inst.rot[1], inst.rot[2]);
      scene.add(group);
      meshes.set(inst.uid, group);
    } catch (err) {
      runtimeIssues.push(`零件 ${inst.partId} 构建失败：${(err as Error).message}`);
    }
  }

  function syncScene() {
    for (const inst of model.state.instances) {
      let g = meshes.get(inst.uid);
      if (!g) { buildMesh(inst); g = meshes.get(inst.uid); }
      if (!g) continue;
      g.position.set(inst.pos[0], inst.pos[1], inst.pos[2]);
      g.rotation.set(inst.rot[0], inst.rot[1], inst.rot[2]);
      g.visible = !inst.hidden;
    }
    refreshPanel();
  }

  /* ===== 面板 ===== */
  const desc = document.createElement('p');
  desc.className = 'fp-desc';
  desc.textContent = '检修换袋或清泵时在此拆开法兰：先装密封垫片，再穿 4 条 M16 螺栓并旋紧螺母。托盘里另有一件 M12 螺栓/螺母，观察规格校验提示。';

  const list = document.createElement('ul');
  list.className = 'fp-check';
  const msgBox = document.createElement('div');
  msgBox.className = 'fp-msg';
  msgBox.setAttribute('role', 'status');

  const missing = document.createElement('div');
  missing.className = 'fp-missing';
  missing.textContent = `缺件提示：${joint.aLabel} ↔ ${joint.bLabel} 之间缺少密封垫片时，螺栓无法压紧密封面。`;

  const trayTitle = document.createElement('div');
  trayTitle.className = 'fp-tray-title';
  trayTitle.textContent = '零件托盘（点击装入）';
  const trayRow = document.createElement('div');
  trayRow.className = 'fp-tray';
  const trayBtns = new Map<string, HTMLButtonElement>();
  const mkTrayBtn = (label: string, key: string, onClick: () => void, sub?: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fp-tray-btn';
    b.dataset.key = key;
    const t = document.createElement('span');
    t.className = 't-label';
    t.textContent = label;
    b.appendChild(t);
    if (sub) {
      const s = document.createElement('span');
      s.className = 't-sub';
      s.textContent = sub;
      b.appendChild(s);
    }
    b.addEventListener('click', onClick);
    trayRow.appendChild(b);
    trayBtns.set(key, b);
  };
  mkTrayBtn('密封垫片 DN50', 'gasket', () => installGasket(), '×1');
  mkTrayBtn('螺栓 M16', 'bolt', () => installBoltNext(), `×4`);
  mkTrayBtn('螺母 M16', 'nut', () => installNutNext(), '×4');
  mkTrayBtn('螺栓 M12', 'boltM12', () => installSpecific(EXTRA.boltM12), '干扰件');
  mkTrayBtn('螺母 M12', 'nutM12', () => installSpecific(EXTRA.nutM12), '干扰件');

  const actions = document.createElement('div');
  actions.className = 'fp-actions';
  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'btn btn-outline';
  undoBtn.textContent = '撤销';
  undoBtn.addEventListener('click', () => undo());
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'btn btn-outline';
  resetBtn.textContent = '重置';
  resetBtn.addEventListener('click', () => reset());
  const checkBtn = document.createElement('button');
  checkBtn.type = 'button';
  checkBtn.className = 'btn btn-primary';
  checkBtn.textContent = '检查连接';
  checkBtn.addEventListener('click', () => check(false));
  actions.appendChild(undoBtn);
  actions.appendChild(resetBtn);
  actions.appendChild(checkBtn);

  panel.appendChild(desc);
  panel.appendChild(list);
  panel.appendChild(missing);
  panel.appendChild(trayTitle);
  panel.appendChild(trayRow);
  panel.appendChild(msgBox);
  panel.appendChild(actions);

  function msg(text: string, kind: 'ok' | 'warn' | 'info' = 'info') {
    msgBox.textContent = text;
    msgBox.className = `fp-msg is-${kind}`;
    if (kind === 'warn') ctx.onToast(text);
  }

  function counts() {
    const bolts = model.state.connections.filter((c) => c.kind === 'bolt-slot').length;
    const nuts = model.state.connections.filter((c) => c.kind === 'nut').length;
    return { bolts, nuts, gasket: !!model.jointConnId };
  }

  function refreshPanel() {
    const c = counts();
    list.textContent = '';
    const row = (done: boolean, text: string) => {
      const li = document.createElement('li');
      li.className = done ? 'is-done' : '';
      const box = document.createElement('span');
      box.className = 'c-box';
      box.textContent = done ? '✓' : '';
      const t = document.createElement('span');
      t.textContent = text;
      li.appendChild(box);
      li.appendChild(t);
      list.appendChild(li);
    };
    row(c.gasket, '装入密封垫片 DN50 ×1');
    row(c.bolts >= 4, `穿装螺栓 M16 ×${Math.min(c.bolts, 4)}/4`);
    row(c.nuts >= 4, `旋紧螺母 M16 ×${Math.min(c.nuts, 4)}/4`);
    missing.hidden = c.gasket;
    gapHalo.visible = !c.gasket;
    ghostGasket.visible = !c.gasket;
    for (const b of trayBtns.values()) {
      const key = b.dataset.key!;
      if (key === 'gasket') b.disabled = c.gasket;
      if (key === 'bolt') b.disabled = c.bolts >= 4;
      if (key === 'nut') b.disabled = c.nuts >= 4;
      if (key === 'boltM12') b.disabled = !c.gasket;
    }
    undoBtn.disabled = model.history.length === 0;
  }

  function snapshot() {
    model.history.push(JSON.stringify({ state: model.state, jointConnId: model.jointConnId }));
    if (model.history.length > 40) model.history.shift();
  }

  function restoreSnapshot(raw: string) {
    const parsed = JSON.parse(raw) as { state: WState; jointConnId: string | null };
    model.state = parsed.state;
    model.jointConnId = parsed.jointConnId;
    model.completed = false;
    syncScene();
  }

  function undo() {
    const raw = model.history.pop();
    if (!raw) return;
    restoreSnapshot(raw);
    msg('已撤销上一步安装。', 'info');
  }

  function reset() {
    model.state = buildInitialState(model.joint);
    model.history = [];
    model.jointConnId = null;
    model.completed = false;
    for (const [uid, g] of meshes) {
      const inst = instOf(model.state, uid);
      if (!inst) {
        scene.remove(g);
        g.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.geometry?.dispose();
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const m of mats) m.dispose();
          }
        });
        meshes.delete(uid);
      }
    }
    syncScene();
    msg('已重置练习：可重新装入垫片与紧固件。', 'info');
  }

  // 托盘取件先抬升，紧固件绕过短管末端，再沿孔轴进入。
  const liftHeight = 2.2;
  const gasketPath: ConnectionPath = {
    entryOffset: new THREE.Vector3(0, 0, 1.55),
    waypoints: (initial, entry) => [
      { pos: [initial.pos[0], liftHeight, initial.pos[2]], rot: initial.rot },
      { pos: [entry.pos[0], liftHeight, entry.pos[2]], rot: entry.rot }
    ]
  };
  const fastenerPath: ConnectionPath = {
    waypoints: (initial, entry) => {
      const { t, hub } = flangeDims(joint.dn);
      const outboard = Math.sign(entry.pos[0]) * (pipeLen({ dn: joint.dn, length: 260 }) + t + hub + 0.8);
      return [
        { pos: [initial.pos[0], liftHeight, initial.pos[2]], rot: initial.rot },
        { pos: [outboard, liftHeight, entry.pos[2]], rot: entry.rot },
        { pos: [outboard, entry.pos[1], entry.pos[2]], rot: entry.rot }
      ];
    }
  };

  function installGasket() {
    if (model.jointConnId) { msg('密封垫片已装入。', 'info'); return; }
    const left = { uid: UID.flangeA, port: 'face' };
    const right = { uid: UID.flangeB, port: 'face' };
    const gasketLeft = { uid: UID.gasket, port: 'f1' };
    const gasketRight = { uid: UID.gasket, port: 'f2' };
    const first = planConnection(model.state, left, gasketLeft, gasketPath);
    if (!first.ok) { msg(`装入垫片失败：${first.reason}`, 'warn'); return; }
    if (!portsAligned(first.state, right, gasketRight)) {
      msg('垫片另一侧未贴合法兰密封面，请检查密封面间距和孔位。', 'warn');
      return;
    }
    // 把垫片作为固定侧，让右端已焊接的组合保持原来的安装位。
    const second = planConnection(first.state, gasketRight, right);
    if (!second.ok) { msg(`装入垫片失败：${second.reason}`, 'warn'); return; }
    snapshot();
    model.state = second.state;
    model.jointConnId = first.connection.id;
    syncScene();
    msg('密封垫片已装入：泵侧与过滤器侧法兰密封面之间由垫片密封。', 'ok');
  }

  function missingGasketMessage() {
    model.attempts += 1;
    msg(`缺件：${model.joint.aLabel} ↔ ${model.joint.bLabel} 之间没有密封垫片，螺栓无法压紧密封面。请先在托盘点击「密封垫片 DN50」。`, 'warn');
  }

  function firstFreeSlot(): number {
    if (!model.jointConnId) return -1;
    const info = jointSlots(model.state, model.jointConnId);
    if (!info) return -1;
    for (let i = 0; i < info.count; i++) {
      const used = model.state.connections.some(
        (c) => c.kind === 'bolt-slot' && c.b.uid === `joint:${model.jointConnId}` && c.b.port === `slot${i}`
      );
      if (!used) return i;
    }
    return -1;
  }

  function installSpecific(uid: string) {
    const inst = instOf(model.state, uid);
    if (!inst) return;
    if (inst.partId === 'gasket') { installGasket(); return; }
    if (inst.partId === 'bolt') { installBolt(uid); return; }
    if (inst.partId === 'nut') { installNut(uid); return; }
  }

  function installBoltNext() {
    const next = BOLT_UIDS.map((u) => instOf(model.state, u)).find((i) => i && !portOccupied(model.state, i.uid, 'shank'));
    if (!next) { msg('4 条 M16 螺栓都已穿上。', 'info'); return; }
    installBolt(next.uid);
  }

  function installBolt(uid: string) {
    if (!model.jointConnId) { missingGasketMessage(); return; }
    const slot = firstFreeSlot();
    if (slot < 0) { msg('4 个螺栓孔位已全部安装。', 'info'); return; }
    snapshot();
    model.attempts += 1;
    const r = planConnection(model.state, { uid, port: 'shank' }, { uid: `joint:${model.jointConnId}`, port: `slot${slot}` }, fastenerPath);
    if (!r.ok) { model.history.pop(); msg(r.reason ?? '螺栓安装失败。', 'warn'); return; }
    model.state = r.state;
    syncScene();
    msg(`螺栓已穿入孔位 ${slot + 1}。`, 'ok');
    check(true);
  }

  function installNutNext() {
    const target = model.state.connections.find((c) => {
      if (c.kind !== 'bolt-slot') return false;
      return !portOccupied(model.state, c.a.uid, 'end');
    });
    if (!target) { msg('请先穿装螺栓，再把螺母旋到螺栓螺纹端。', 'info'); return; }
    installNutOnBolt(target.a.uid);
  }

  function installNut(uid: string) {
    const target = model.state.connections.find((c) => {
      if (c.kind !== 'bolt-slot') return false;
      return !portOccupied(model.state, c.a.uid, 'end');
    });
    if (!target) { msg('请先穿装螺栓，再把螺母旋到螺栓螺纹端。', 'info'); return; }
    installNutOnBolt(target.a.uid, uid);
  }

  function installNutOnBolt(boltUid: string, nutUid?: string) {
    const nut = nutUid
      ? instOf(model.state, nutUid)
      : NUT_UIDS.map((u) => instOf(model.state, u)).find((i) => i && !portOccupied(model.state, i.uid, 'thread'));
    if (!nut) { msg('4 个螺母都已旋紧。', 'info'); return; }
    snapshot();
    model.attempts += 1;
    const r = planConnection(model.state, { uid: boltUid, port: 'end' }, { uid: nut.uid, port: 'thread' }, fastenerPath);
    if (!r.ok) { model.history.pop(); msg(r.reason ?? '螺母安装失败。', 'warn'); return; }
    model.state = r.state;
    syncScene();
    msg('螺母已旋合到螺栓螺纹端。', 'ok');
    check(true);
  }

  function check(silent: boolean) {
    const c = counts();
    if (!c.gasket) {
      if (!silent) missingGasketMessage();
      return;
    }
    if (c.bolts < 4 || c.nuts < 4) {
      if (!silent) msg(`连接未完成：还需 ${4 - c.bolts} 条 M16 螺栓、${4 - c.nuts} 个 M16 螺母。`, 'info');
      return;
    }
    if (model.completed) { if (!silent) msg('该法兰连接已完成。', 'ok'); return; }
    model.completed = true;
    msg('连接完成：密封垫片 + 4 组 M16 螺栓螺母已就位，法兰压紧。结果已记录到本厂学习记录。', 'ok');
    ctx.onComplete({
      items: [`密封垫片 DN50 ×1`, `螺栓 M16 ×4`, `螺母 M16 ×4`],
      attempts: model.attempts
    });
  }

  /* ===== 指针：点击托盘零件装入 ===== */
  const raycaster = new THREE.Raycaster();
  let down = { x: 0, y: 0 };
  let active = false;
  const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; active = true; };
  const onUp = (e: PointerEvent) => {
    if (!active) return;
    active = false;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (dx * dx + dy * dy > 36) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    for (const hit of hits) {
      const uid = hit.object.userData.instanceUid as string | undefined;
      if (uid) { installSpecific(uid); return; }
    }
  };
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      ctx.onClose();
    }
  };
  window.addEventListener('keydown', onKey, true);

  let raf = 0;
  const clock = new THREE.Clock();
  let elapsed = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    elapsed += Math.min(0.05, clock.getDelta());
    if (gapHalo.visible) {
      const k = 1 + Math.sin(elapsed * 3.2) * 0.06;
      gapHalo.scale.set(k, k, 1);
      (gapHalo.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.3 * (0.5 + 0.5 * Math.sin(elapsed * 3.2));
    }
    controls.update();
    renderer.render(scene, camera);
  };

  const resizeObs = new ResizeObserver(() => {
    const w = Math.max(1, stage.clientWidth);
    const h = Math.max(1, stage.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  host.appendChild(el);
  resizeObs.observe(stage);
  renderer.setSize(Math.max(1, stage.clientWidth), Math.max(1, stage.clientHeight), false);
  camera.aspect = Math.max(1, stage.clientWidth) / Math.max(1, stage.clientHeight);
  camera.updateProjectionMatrix();
  syncScene();
  msg('先点击托盘中的「密封垫片 DN50」装入垫片，再穿螺栓、旋螺母。', 'info');
  loop();

  return {
    el,
    dispose() {
      cancelAnimationFrame(raf);
      resizeObs.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
      controls.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m.dispose();
      });
      renderer.dispose();
      el.remove();
    }
  };
}

/* ===== 初始状态：两段短管 + 两片法兰（面向彼此，留 0.03 垫片间隙）+ 托盘 ===== */

function buildInitialState(joint: FactoryJointDef): WState {
  const state = emptyState();
  const specPipe: Spec = { dn: joint.dn, length: 260, endType: 'weld' };
  const specFlange: Spec = { dn: joint.dn };
  const inst = (uid: string, partId: string, spec: Spec, pos: [number, number, number], rot: [number, number, number]): Instance => ({
    uid, partId, spec, pos, rot
  });

  const { t, hub } = flangeDims(joint.dn);
  const halfPipe = pipeLen(specPipe) / 2;
  const flangeAx = -(GASKET_THICKNESS + t) / 2;
  const flangeBx = -flangeAx;
  const y = 0.95;
  state.instances.push(
    inst(UID.pipeL, 'pipe', specPipe, [flangeAx - (t / 2 + hub) - halfPipe, y, 0], [0, 0, 0]),
    inst(UID.flangeA, 'flange-so', specFlange, [flangeAx, y, 0], [0, 0, 0]),
    inst(UID.pipeR, 'pipe', specPipe, [flangeBx + (t / 2 + hub) + halfPipe, y, 0], [0, 0, 0]),
    inst(UID.flangeB, 'flange-so', specFlange, [flangeBx, y, 0], [0, Math.PI, 0]),
    inst(UID.gasket, 'gasket', { dn: joint.dn }, [0.35, 0.16, 1.28], [Math.PI / 2, 0, 0])
  );
  for (let i = 0; i < 4; i++) {
    const x = -1.05 + i * 0.7;
    state.instances.push(
      inst(BOLT_UIDS[i], 'bolt', { dn: 16 }, [x, 0.19, 2.0], [0, 0, 0]),
      inst(NUT_UIDS[i], 'nut', { dn: 16 }, [x, 0.19, 2.55], [0, 0, 0])
    );
  }
  state.instances.push(
    inst(EXTRA.boltM12, 'bolt', { dn: 12 }, [1.85, 0.19, 2.0], [0, Math.PI / 5, 0]),
    inst(EXTRA.nutM12, 'nut', { dn: 12 }, [1.85, 0.19, 2.55], [0, 0, 0])
  );

  /* 短管与法兰保持焊接，属于固定基准组。 */
  state.connections.push(
    { id: 'weld-l', kind: 'weld', a: { uid: UID.pipeL, port: 'p2' }, b: { uid: UID.flangeA, port: 'weld' } },
    { id: 'weld-r', kind: 'weld', a: { uid: UID.pipeR, port: 'p1' }, b: { uid: UID.flangeB, port: 'weld' } }
  );
  return state;
}
