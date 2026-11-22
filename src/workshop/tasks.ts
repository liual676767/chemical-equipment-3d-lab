import { VALVE_OPERATIONS } from '../data/valveOperations';
/* 组装任务：由浅入深。第一批开放 T1–T7；T8–T10 依赖第二批对象，明确锁定。
 * 参考方案用与用户相同的连接规则程序化生成，可半透明显示、随时关闭。 */
import type { WState, Instance } from './types';
import { partById } from './catalog';
import { reducerSmall } from './specs';
import {
  emptyState, newUid, instOf, livePorts, isFluidPort, portOccupied,
  findPath, openPorts, makeConnection, componentOf, jointSlots, slotOccupied
} from './state';
import type { PortRef } from './state';
import { basicLessons } from './expansion/lessons';

export interface TaskItem { label: string; ok: boolean }
export interface TaskResult { done: boolean; items: TaskItem[]; problems: string[] }

export interface TaskDef {
  id: string;
  title: string;
  goal: string;
  batch: 1 | 2;
  allowedParts: string[];
  steps: string[];
  rules: string[];
  check: (s: WState) => TaskResult;
  reference?: () => WState;
  prerequisites?: string;
  questions?: readonly { prompt: string; options: readonly string[]; correct: number; explanation: string }[];
}

function inst(partId: string, pos: [number, number, number], spec?: Partial<Instance['spec']>, rot?: [number, number, number]): Instance {
  const p = partById(partId)!;
  return {
    uid: newUid(), partId, pos, rot: rot ?? [0, 0, 0],
    spec: { ...p.defaultSpec, ...spec }
  };
}

function add(s: WState, i: Instance): Instance { s.instances.push(i); return i; }

function connect(s: WState, a: PortRef, b: PortRef): string | null {
  const r = makeConnection(s, a, b);
  return r.ok && r.conn ? r.conn.id : null;
}

function result(items: TaskItem[], problems: string[]): TaskResult {
  return { done: items.every((i) => i.ok) && problems.length === 0, items, problems };
}

function hasPart(s: WState, partId: string): Instance[] {
  return s.instances.filter((i) => i.partId === partId);
}

function fluidOpenEnds(s: WState, uid: string): PortRef[] {
  const i = instOf(s, uid);
  if (!i) return [];
  return livePorts(i).filter((p) => isFluidPort(p) && !portOccupied(s, uid, p.id)).map((p) => ({ uid, port: p.id }));
}

/* ---------- 参考方案 ---------- */

function refTurn(): WState {
  const s = emptyState();
  const a = add(s, inst('pipe', [0, 1, 0], { length: 500 }));
  const e = add(s, inst('elbow90', [4, 1, 0]));
  const b = add(s, inst('pipe', [4, 4, 0], { length: 500 }));
  connect(s, { uid: a.uid, port: 'p2' }, { uid: e.uid, port: 'p1' });
  connect(s, { uid: e.uid, port: 'p2' }, { uid: b.uid, port: 'p1' });
  return s;
}

function refBranch(): WState {
  const s = emptyState();
  const t = add(s, inst('tee', [0, 1, 0]));
  const a = add(s, inst('pipe', [-4, 1, 0], { length: 500 }));
  const b = add(s, inst('pipe', [4, 1, 0], { length: 500 }));
  const c = add(s, inst('pipe', [0, 4, 0], { length: 500 }));
  connect(s, { uid: t.uid, port: 'p1' }, { uid: a.uid, port: 'p2' });
  connect(s, { uid: t.uid, port: 'p2' }, { uid: b.uid, port: 'p1' });
  connect(s, { uid: t.uid, port: 'p3' }, { uid: c.uid, port: 'p1' });
  return s;
}

function refReducer(): WState {
  const s = emptyState();
  const r = add(s, inst('reducer-conc', [0, 1, 0], { dn: 80 }));
  const a = add(s, inst('pipe', [-4, 1, 0], { dn: 80, length: 500 }));
  const b = add(s, inst('pipe', [4, 1, 0], { dn: 50, length: 500 }));
  connect(s, { uid: r.uid, port: 'p1' }, { uid: a.uid, port: 'p2' });
  connect(s, { uid: r.uid, port: 'p2' }, { uid: b.uid, port: 'p1' });
  return s;
}

function refFlange(): WState {
  const s = emptyState();
  const pa = add(s, inst('pipe', [-4, 1, 0], { length: 500 }));
  const fa = add(s, inst('flange-so', [0, 1, 0]));
  const gk = add(s, inst('gasket', [1, 1, 0]));
  const fb = add(s, inst('flange-so', [2, 1, 0]));
  const pb = add(s, inst('pipe', [6, 1, 0], { length: 500 }));
  connect(s, { uid: pa.uid, port: 'p2' }, { uid: fa.uid, port: 'weld' });
  const c1 = connect(s, { uid: fa.uid, port: 'face' }, { uid: gk.uid, port: 'f1' });
  const c2 = connect(s, { uid: gk.uid, port: 'f2' }, { uid: fb.uid, port: 'face' });
  connect(s, { uid: fb.uid, port: 'weld' }, { uid: pb.uid, port: 'p1' });
  if (c1) {
    const info = jointSlots(s, c1);
    const n = info?.count ?? 4;
    for (let i = 0; i < n; i++) {
      const bolt = add(s, inst('bolt', [0, 3 + i * 0.5, 2]));
      const nut = add(s, inst('nut', [1, 3 + i * 0.5, 2]));
      connect(s, { uid: `joint:${c1}`, port: `slot${i}` }, { uid: bolt.uid, port: 'shank' });
      connect(s, { uid: bolt.uid, port: 'end' }, { uid: nut.uid, port: 'thread' });
    }
  }
  void c2;
  return s;
}

function refValve(): WState {
  const s = emptyState();
  const a = add(s, inst('pipe', [-4, 1, 0], { length: 500, endType: 'flange' }));
  const v = add(s, inst('valve-ball', [0, 1, 0]));
  const b = add(s, inst('pipe', [4, 1, 0], { length: 500, endType: 'flange' }));
  connect(s, { uid: a.uid, port: 'p2' }, { uid: v.uid, port: 'p1' });
  connect(s, { uid: v.uid, port: 'p2' }, { uid: b.uid, port: 'p1' });
  return s;
}

function refCheck(): WState {
  const s = emptyState();
  const a = add(s, inst('pipe', [-4, 1, 0], { length: 500, endType: 'flange' }));
  const v = add(s, inst('valve-check', [0, 1, 0]));
  const b = add(s, inst('pipe', [4, 1, 0], { length: 500, endType: 'flange' }));
  connect(s, { uid: a.uid, port: 'p2' }, { uid: v.uid, port: 'p1' });
  connect(s, { uid: v.uid, port: 'p2' }, { uid: b.uid, port: 'p1' });
  return s;
}

function refTankPump(): WState {
  const s = emptyState();
  const tank = add(s, inst('tank-vertical', [6, 0, 0]));
  const down = add(s, inst('pipe', [6, 3, 0], { dn: 80, length: 270, endType: 'flange' }));
  const el = add(s, inst('elbow90', [6, 1, 0], { dn: 80, endType: 'flange' }));
  const run = add(s, inst('pipe', [0, 1, 0], { dn: 80, length: 1000, endType: 'flange' }));
  const pump = add(s, inst('pump-centrifugal', [-8, 0, 0]));
  connect(s, { uid: tank.uid, port: 'out' }, { uid: down.uid, port: 'p1' });
  connect(s, { uid: down.uid, port: 'p2' }, { uid: el.uid, port: 'p1' });
  connect(s, { uid: el.uid, port: 'p2' }, { uid: run.uid, port: 'p1' });
  connect(s, { uid: run.uid, port: 'p2' }, { uid: pump.uid, port: 'in' });
  return s;
}

function refHeat(): WState {
  const s = emptyState();
  const hx = add(s, inst('heat-shell-tube', [0, 0, 0]));
  const ti = add(s, inst('pipe', [9, 1.5, 0], { dn: 65, length: 800, endType: 'flange' }));
  const to = add(s, inst('pipe', [-9, 1.5, 0], { dn: 65, length: 800, endType: 'flange' }));
  const si = add(s, inst('pipe', [-2, 6, 0], { dn: 50, length: 600, endType: 'flange' }));
  const so = add(s, inst('pipe', [2, -2, 0], { dn: 50, length: 400, endType: 'flange' }));
  connect(s, { uid: hx.uid, port: 'tubeIn' }, { uid: ti.uid, port: 'p1' });
  connect(s, { uid: hx.uid, port: 'tubeOut' }, { uid: to.uid, port: 'p2' });
  connect(s, { uid: hx.uid, port: 'shellIn' }, { uid: si.uid, port: 'p1' });
  connect(s, { uid: hx.uid, port: 'shellOut' }, { uid: so.uid, port: 'p1' });
  return s;
}

/* 储罐输送教学装置：供料罐 → 球阀 → 泵 → 止回阀 → 换热器管程 → 接收罐。
 * 每段从一个固定端生长，makeConnection 自动对齐后续零件；
 * 泵出口抬高后在 Z 方向绕过供料罐，再下降到换热器管程标高。 */
function refTransfer(): WState {
  const s = emptyState();
  const F = { endType: 'flange' as const };
  const t1 = add(s, inst('tank-vertical', [18, 0, 0]));
  const down1 = add(s, inst('pipe', [18, 3.6, 0], { dn: 80, length: 270, ...F }));
  const el1 = add(s, inst('elbow90', [18, 2.3, 0], { dn: 80, ...F }));
  const run1 = add(s, inst('pipe', [24, 1, 0], { dn: 80, length: 1000, ...F }));
  const ball = add(s, inst('valve-ball', [31, 1, 0], { dn: 80 }));
  const run2 = add(s, inst('pipe', [35, 1, 0], { dn: 80, length: 600, ...F }));
  const pump = add(s, inst('pump-centrifugal', [40, 0, 0]));
  connect(s, { uid: t1.uid, port: 'out' }, { uid: down1.uid, port: 'p1' });
  connect(s, { uid: down1.uid, port: 'p2' }, { uid: el1.uid, port: 'p1' });
  connect(s, { uid: el1.uid, port: 'p2' }, { uid: run1.uid, port: 'p1' });
  connect(s, { uid: run1.uid, port: 'p2' }, { uid: ball.uid, port: 'p1' });
  connect(s, { uid: ball.uid, port: 'p2' }, { uid: run2.uid, port: 'p1' });
  connect(s, { uid: run2.uid, port: 'p2' }, { uid: pump.uid, port: 'in' });

  const riser1 = add(s, inst('pipe', [39.5, 4, 0], { dn: 65, length: 400, ...F }));
  const el2a = add(s, inst('elbow90', [39.5, 6.1, 0], { dn: 65, ...F }, [-Math.PI / 2, -Math.PI / 2, 0]));
  const jog = add(s, inst('pipe', [39.5, 7.3, -5], { dn: 65, length: 800, ...F }));
  const el2b = add(s, inst('elbow90', [39.5, 7.3, -9], { dn: 65, ...F }, [-Math.PI / 2, 0, Math.PI / 2]));
  const run3 = add(s, inst('pipe', [34, 7.3, -10], { dn: 65, length: 800, ...F }));
  const check = add(s, inst('valve-check', [29, 7.3, -10], { dn: 65 }));
  const run4 = add(s, inst('pipe', [25, 7.3, -10], { dn: 65, length: 600, ...F }));
  const elD1 = add(s, inst('elbow90', [22, 7.3, -10], { dn: 65, ...F }, [0, 0, Math.PI]));
  const riserD = add(s, inst('pipe', [20.8, 4.4, -10], { dn: 65, length: 350, ...F }));
  const elD2 = add(s, inst('elbow90', [20.8, 2.6, -10], { dn: 65, ...F }, [-Math.PI, 0, Math.PI / 2]));
  const run5 = add(s, inst('pipe', [13.7, 1.5, -10], { dn: 65, length: 1200, ...F }));
  const hx = add(s, inst('heat-shell-tube', [2.7, 0, -10]));
  connect(s, { uid: pump.uid, port: 'out' }, { uid: riser1.uid, port: 'p1' });
  connect(s, { uid: riser1.uid, port: 'p2' }, { uid: el2a.uid, port: 'p1' });
  connect(s, { uid: el2a.uid, port: 'p2' }, { uid: jog.uid, port: 'p1' });
  connect(s, { uid: jog.uid, port: 'p2' }, { uid: el2b.uid, port: 'p1' });
  connect(s, { uid: el2b.uid, port: 'p2' }, { uid: run3.uid, port: 'p1' });
  connect(s, { uid: run3.uid, port: 'p2' }, { uid: check.uid, port: 'p1' });
  connect(s, { uid: check.uid, port: 'p2' }, { uid: run4.uid, port: 'p1' });
  connect(s, { uid: run4.uid, port: 'p2' }, { uid: elD1.uid, port: 'p1' });
  connect(s, { uid: elD1.uid, port: 'p2' }, { uid: riserD.uid, port: 'p1' });
  connect(s, { uid: riserD.uid, port: 'p2' }, { uid: elD2.uid, port: 'p1' });
  connect(s, { uid: elD2.uid, port: 'p2' }, { uid: run5.uid, port: 'p1' });
  connect(s, { uid: run5.uid, port: 'p2' }, { uid: hx.uid, port: 'tubeIn' });

  const run6 = add(s, inst('pipe', [-5, 1.5, -10], { dn: 65, length: 600, ...F }));
  const red = add(s, inst('reducer-conc', [-8.5, 1.5, -10], { dn: 65, smallDn: 50, ...F }));
  const run7 = add(s, inst('pipe', [-12, 1.5, -10], { dn: 50, length: 600, ...F }));
  const elUp1 = add(s, inst('elbow90', [-15.7, 2.4, -10], { dn: 50, ...F }));
  const riserU = add(s, inst('pipe', [-15.7, 15, -10], { dn: 50, length: 2500, ...F }));
  const elUp2 = add(s, inst('elbow90', [-15.7, 27.4, -10], { dn: 50, ...F }));
  const run8 = add(s, inst('pipe', [-19.6, 28.3, -10], { dn: 50, length: 600, ...F }));
  const elDn = add(s, inst('elbow90', [-22.6, 28.3, -10], { dn: 50, ...F }, [0, 0, Math.PI]));
  const stub = add(s, inst('pipe', [-23.5, 26, -10], { dn: 50, length: 280, ...F }));
  const t2 = add(s, inst('tank-vertical', [-23.5, 0, -10]));
  connect(s, { uid: hx.uid, port: 'tubeOut' }, { uid: run6.uid, port: 'p1' });
  connect(s, { uid: run6.uid, port: 'p2' }, { uid: red.uid, port: 'p1' });
  connect(s, { uid: red.uid, port: 'p2' }, { uid: run7.uid, port: 'p1' });
  connect(s, { uid: run7.uid, port: 'p2' }, { uid: elUp1.uid, port: 'p1' });
  connect(s, { uid: elUp1.uid, port: 'p2' }, { uid: riserU.uid, port: 'p2' });
  connect(s, { uid: riserU.uid, port: 'p1' }, { uid: elUp2.uid, port: 'p1' });
  connect(s, { uid: elUp2.uid, port: 'p2' }, { uid: run8.uid, port: 'p1' });
  connect(s, { uid: run8.uid, port: 'p2' }, { uid: elDn.uid, port: 'p1' });
  connect(s, { uid: elDn.uid, port: 'p2' }, { uid: stub.uid, port: 'p1' });
  connect(s, { uid: stub.uid, port: 'p2' }, { uid: t2.uid, port: 'in' });
  return s;
}

/* ---------- 任务检查 ---------- */

function checkTurn(s: WState): TaskResult {
  const pipes = hasPart(s, 'pipe');
  const elbows = hasPart(s, 'elbow90');
  const items: TaskItem[] = [
    { label: '放入至少 2 段直管', ok: pipes.length >= 2 },
    { label: '放入 1 个 90° 弯头', ok: elbows.length >= 1 }
  ];
  const problems: string[] = [];
  let linked = false, turned = false;
  for (const e of elbows) {
    const comp = componentOf(s, e.uid);
    const compPipes = pipes.filter((p) => comp.has(p.uid));
    if (compPipes.length >= 2 && ['p1', 'p2'].every((pid) => portOccupied(s, e.uid, pid))) {
      linked = true;
      const ends = [...comp].flatMap((uid) => fluidOpenEnds(s, uid));
      for (let i = 0; i < ends.length && !turned; i++) {
        for (let j = i + 1; j < ends.length && !turned; j++) {
          const r = findPath(s, ends[i], ends[j]);
          if (r.ok && r.path.some((p) => p.uid === e.uid)) turned = true;
        }
      }
    }
  }
  items.push({ label: '弯头与直管连接成一段转向管路', ok: linked });
  items.push({ label: '两端开口连通且路径经过弯头', ok: turned });
  if (pipes.length >= 2 && elbows.length >= 1 && !linked) problems.push('还有接口未连接：选中零件后点击接口，再选择附近绿色高亮的匹配接口完成连接。');
  return result(items, problems);
}

function checkBranch(s: WState): TaskResult {
  const tees = hasPart(s, 'tee');
  const pipes = hasPart(s, 'pipe');
  const items: TaskItem[] = [
    { label: '放入 1 个等径三通', ok: tees.length >= 1 },
    { label: '放入至少 3 段直管', ok: pipes.length >= 3 }
  ];
  let allConnected = false;
  for (const t of tees) {
    if (['p1', 'p2', 'p3'].every((pid) => portOccupied(s, t.uid, pid))) allConnected = true;
  }
  items.push({ label: '三通三个接口全部接管', ok: allConnected });
  let branches = false;
  for (const t of tees) {
    if (!['p1', 'p2', 'p3'].every((pid) => portOccupied(s, t.uid, pid))) continue;
    const comp = componentOf(s, t.uid);
    const ends = [...comp].flatMap((uid) => fluidOpenEnds(s, uid));
    if (ends.length >= 3) branches = true;
  }
  items.push({ label: '形成三条开放支路', ok: branches });
  const problems: string[] = [];
  if (tees.length && !allConnected) problems.push('三通还有接口空着：支管顶端接口也需要连接管段（或按任务允许封闭）。');
  return result(items, problems);
}

function checkReducer(s: WState): TaskResult {
  const reducers = [...hasPart(s, 'reducer-conc'), ...hasPart(s, 'reducer-ecc')];
  const items: TaskItem[] = [{ label: '放入 1 个异径管（同心或偏心）', ok: reducers.length >= 1 }];
  let big = false, small = false, thru = false;
  const problems: string[] = [];
  for (const r of reducers) {
    const smallDn = reducerSmall(r.spec.dn);
    const c1 = portOccupied(s, r.uid, 'p1');
    const c2 = portOccupied(s, r.uid, 'p2');
    const other = (c: typeof c1, self: string) => {
      if (!c) return null;
      const oid = c.a.uid === self ? c.b.uid : c.a.uid;
      return instOf(s, oid);
    };
    const nb1 = other(c1, r.uid);
    const nb2 = other(c2, r.uid);
    if (nb1?.partId === 'pipe' && nb1.spec.dn === r.spec.dn) big = true;
    if (nb2?.partId === 'pipe' && nb2.spec.dn === smallDn) small = true;
    if (big && small && nb1 && nb2) {
      const e1 = fluidOpenEnds(s, nb1.uid);
      const e2 = fluidOpenEnds(s, nb2.uid);
      for (const a of e1) for (const b of e2) {
        if (findPath(s, a, b).ok) thru = true;
      }
    }
  }
  items.push({ label: `大端连接同规格直管`, ok: big });
  items.push({ label: '小端连接小一号规格直管', ok: small });
  items.push({ label: '变径管段两端连通', ok: thru });
  if (reducers.length && (!big || !small)) problems.push('异径管两侧管径必须分别匹配大端与小端规格，尺寸不匹配时连接会被拒绝。');
  return result(items, problems);
}

function checkFlange(s: WState): TaskResult {
  const gaskets = hasPart(s, 'gasket');
  const items: TaskItem[] = [
    { label: '两片法兰通过垫片对接', ok: false },
    { label: '两侧法兰分别连接管段', ok: false },
    { label: '螺栓全部穿入螺栓孔', ok: false },
    { label: '每只螺栓配好螺母', ok: false }
  ];
  const problems: string[] = [];
  for (const g of gaskets) {
    const c1 = portOccupied(s, g.uid, 'f1');
    const c2 = portOccupied(s, g.uid, 'f2');
    if (!c1 || !c2) continue;
    const flangeOf = (c: typeof c1) => {
      const oid = c.a.uid === g.uid ? c.b.uid : c.a.uid;
      const i = instOf(s, oid);
      return i && (i.partId === 'flange-so' || i.partId === 'flange-wn') ? i : null;
    };
    const fa = flangeOf(c1);
    const fb = flangeOf(c2);
    if (!fa || !fb) continue;
    items[0].ok = true;
    const pipeSide = (f: Instance) => {
      const c = portOccupied(s, f.uid, 'weld');
      if (!c) return false;
      const oid = c.a.uid === f.uid ? c.b.uid : c.a.uid;
      return instOf(s, oid)?.partId === 'pipe';
    };
    if (pipeSide(fa) && pipeSide(fb)) items[1].ok = true;
    const joints = [c1.id, c2.id];
    let need = 0, boltsOk = 0, nutsOk = 0;
    for (const jid of joints) {
      const info = jointSlots(s, jid);
      if (!info) continue;
      need = Math.max(need, info.count);
      for (let i = 0; i < info.count; i++) {
        const bc = slotOccupied(s, jid, i);
        if (!bc) continue;
        boltsOk += 1;
        const boltUid = bc.a.uid;
        if (portOccupied(s, boltUid, 'end')) nutsOk += 1;
      }
    }
    if (need > 0 && boltsOk >= need) items[2].ok = true;
    if (need > 0 && nutsOk >= need) items[3].ok = true;
    if (items[0].ok && !items[2].ok) problems.push(`螺栓未装满：该法兰连接需要 ${need} 只螺栓，选中螺栓后点击法兰孔位安装。`);
    if (items[2].ok && !items[3].ok) problems.push('还有螺栓没配螺母：选中螺母后点击螺栓螺纹端旋合。');
  }
  if (!gaskets.length) problems.push('法兰连接需要垫片：把垫片放到两片法兰密封面之间。');
  return result(items, problems);
}

function valveInline(s: WState, partId: string): { inline: boolean; reversed: boolean; closed: boolean } {
  let inline = false, reversed = false, closed = false;
  for (const v of hasPart(s, partId)) {
    const c1 = portOccupied(s, v.uid, 'p1');
    const c2 = portOccupied(s, v.uid, 'p2');
    if (!c1 || !c2) continue;
    if (v.open === false) { closed = true; continue; }
    const comp = componentOf(s, v.uid);
    const ends = [...comp].flatMap((uid) => (uid === v.uid ? [] : fluidOpenEnds(s, uid)));
    let ok = false;
    for (const a of ends) for (const b of ends) {
      const r = findPath(s, a, b);
      if (r.ok) {
        const i1 = r.path.findIndex((p) => p.uid === v.uid && p.port === 'p1');
        const i2 = r.path.findIndex((p) => p.uid === v.uid && p.port === 'p2');
        if (i1 >= 0 && i2 >= 0 && i1 < i2) ok = true;
      }
    }
    if (ok) inline = true; else reversed = true;
  }
  return { inline, reversed, closed };
}

function checkBall(s: WState): TaskResult {
  const valves = hasPart(s, 'valve-ball');
  const { inline, closed } = valveInline(s, 'valve-ball');
  const both = valves.some((v) => portOccupied(s, v.uid, 'p1') && portOccupied(s, v.uid, 'p2'));
  const items: TaskItem[] = [
    { label: '放入球阀并连接两侧管段', ok: both },
    { label: '球阀串接在连通管段中', ok: inline },
    { label: '球阀处于开启状态', ok: valves.length > 0 && !closed }
  ];
  const problems: string[] = [];
  if (both && !inline && !closed) problems.push('球阀两侧虽然接管，但所在管段两端未连通，请补齐管段连接。');
  if (closed) problems.push('球阀处于关闭状态：选中球阀，在参数面板点击「开启」。');
  return result(items, problems);
}

function checkCheck(s: WState): TaskResult {
  const valves = hasPart(s, 'valve-check');
  const { inline, reversed } = valveInline(s, 'valve-check');
  const both = valves.some((v) => portOccupied(s, v.uid, 'p1') && portOccupied(s, v.uid, 'p2'));
  const items: TaskItem[] = [
    { label: '止回阀两侧接管', ok: both },
    { label: '流向正确：起点 → 进口 → 出口 → 终点', ok: inline }
  ];
  const problems: string[] = [];
  if (both && reversed) problems.push('止回阀方向装反：介质无法按指定方向流过。请拆下后调转方向，使阀体箭头指向终点。');
  return result(items, problems);
}

function checkTankPump(s: WState): TaskResult {
  const tanks = hasPart(s, 'tank-vertical');
  const pumps = hasPart(s, 'pump-centrifugal');
  const items: TaskItem[] = [
    { label: '放入立式储罐与离心泵', ok: tanks.length >= 1 && pumps.length >= 1 },
    { label: '储罐出料口接出管段', ok: false },
    { label: '管段连接到泵入口', ok: false },
    { label: '储罐出口 → 泵入口连通', ok: false }
  ];
  const problems: string[] = [];
  for (const t of tanks) {
    if (portOccupied(s, t.uid, 'out')) items[1].ok = true;
    for (const p of pumps) {
      if (portOccupied(s, p.uid, 'in')) items[2].ok = true;
      const r = findPath(s, { uid: t.uid, port: 'out' }, { uid: p.uid, port: 'in' });
      if (r.ok && r.path.some((x) => instOf(s, x.uid)?.partId === 'pipe')) items[3].ok = true;
    }
  }
  if (items[1].ok && items[2].ok && !items[3].ok) problems.push('管段尚未把储罐出口与泵入口连成一条通路：检查中间缺少的连接，注意泵入口标高。');
  return result(items, problems);
}

function checkHeat(s: WState): TaskResult {
  const hxs = hasPart(s, 'heat-shell-tube');
  const items: TaskItem[] = [
    { label: '放入管壳式换热器', ok: hxs.length >= 1 },
    { label: '管程进、出口均已接管', ok: false },
    { label: '壳程进、出口均已接管', ok: false },
    { label: '管程流路连通（进口 → 出口）', ok: false },
    { label: '壳程流路连通（进口 → 出口）', ok: false },
    { label: '两条流路相互独立', ok: false }
  ];
  const problems: string[] = [];
  const ends = openPorts(s);
  for (const hx of hxs) {
    const occ = (pid: string) => !!portOccupied(s, hx.uid, pid);
    if (occ('tubeIn') && occ('tubeOut')) items[1].ok = true;
    if (occ('shellIn') && occ('shellOut')) items[2].ok = true;
    let tubePath: PortRef[] | null = null;
    let shellPath: PortRef[] | null = null;
    for (const a of ends) for (const b of ends) {
      if (a.uid === b.uid && a.port === b.port) continue;
      const r = findPath(s, a, b);
      if (!r.ok) continue;
      const idx = (pid: string) => r.path.findIndex((x) => x.uid === hx.uid && x.port === pid);
      const t1 = idx('tubeIn'), t2 = idx('tubeOut');
      if (t1 >= 0 && t2 >= 0 && t1 < t2 && !tubePath) tubePath = r.path;
      const s1 = idx('shellIn'), s2 = idx('shellOut');
      if (s1 >= 0 && s2 >= 0 && s1 < s2 && !shellPath) shellPath = r.path;
    }
    if (tubePath) items[3].ok = true;
    if (shellPath) items[4].ok = true;
    if (tubePath && shellPath) {
      const tu = new Set(tubePath.map((x) => x.uid));
      if (shellPath.every((x) => x.uid === hx.uid || !tu.has(x.uid))) items[5].ok = true;
    }
  }
  if (hxs.length && !items[1].ok) problems.push('管程接口还没接管：管程进/出口为 DN65 法兰（PN16），位于换热器两端，把管段端部形式设为法兰后连接。');
  if (hxs.length && !items[2].ok) problems.push('壳程接口还没接管：壳程进口在壳体顶部、出口在壳体底部，均为 DN50 法兰。');
  if (items[1].ok && !items[3].ok) problems.push('管程流路未连通：补齐管程两侧管段，使介质能从进口流到出口。');
  if (items[2].ok && !items[4].ok) problems.push('壳程流路未连通：补齐壳程两侧管段。');
  if (items[3].ok && items[4].ok && !items[5].ok) problems.push('两条流路被外部管路连在了一起：管程与壳程应各自独立，互不串通。');
  return result(items, problems);
}

function checkTransfer(s: WState): TaskResult {
  const tanks = hasPart(s, 'tank-vertical');
  const pumps = hasPart(s, 'pump-centrifugal');
  const balls = hasPart(s, 'valve-ball');
  const checks = hasPart(s, 'valve-check');
  const hxs = hasPart(s, 'heat-shell-tube');
  const items: TaskItem[] = [
    { label: '放入两台独立储罐', ok: tanks.length >= 2 },
    { label: '放入离心泵、球阀、止回阀与换热器', ok: pumps.length >= 1 && balls.length >= 1 && checks.length >= 1 && hxs.length >= 1 },
    { label: '供料储罐出口 → 球阀 → 泵入口连通', ok: false },
    { label: '球阀处于开启状态', ok: balls.length > 0 && balls.every((b) => b.open !== false) },
    { label: '泵出口 → 止回阀 → 换热器管程进口连通', ok: false },
    { label: '止回阀串入管段且方向正确', ok: false },
    { label: '换热器管程出口 → 接收储罐进口连通', ok: false },
    { label: '全程连通：供料储罐 → 接收储罐', ok: false }
  ];
  const problems: string[] = [];
  const hasPipe = (path: PortRef[]) => path.some((p) => instOf(s, p.uid)?.partId === 'pipe');
  for (const t1 of tanks) for (const t2 of tanks) {
    if (t1.uid === t2.uid) continue;
    for (const p of pumps) for (const hx of hxs) {
      const r1 = findPath(s, { uid: t1.uid, port: 'out' }, { uid: p.uid, port: 'in' });
      if (r1.ok && hasPipe(r1.path) && r1.path.some((x) => balls.some((b) => b.uid === x.uid))) items[2].ok = true;
      const r2 = findPath(s, { uid: p.uid, port: 'out' }, { uid: hx.uid, port: 'tubeIn' });
      if (r2.ok && hasPipe(r2.path)) {
        items[4].ok = true;
        for (const c of checks) {
          const i1 = r2.path.findIndex((x) => x.uid === c.uid && x.port === 'p1');
          const i2 = r2.path.findIndex((x) => x.uid === c.uid && x.port === 'p2');
          if (i1 >= 0 && i2 >= 0 && i1 < i2) items[5].ok = true;
        }
      }
      const r3 = findPath(s, { uid: hx.uid, port: 'tubeOut' }, { uid: t2.uid, port: 'in' });
      if (r3.ok && hasPipe(r3.path)) items[6].ok = true;
      if (findPath(s, { uid: t1.uid, port: 'out' }, { uid: t2.uid, port: 'in' }).ok) items[7].ok = true;
    }
  }
  if (balls.some((b) => b.open === false)) problems.push('球阀处于关闭状态：选中球阀，在参数面板点击「开启」，关闭的阀门会切断连通路径。');
  if (!items[2].ok && !balls.some((b) => b.open === false)) problems.push('供料储罐到泵入口未连通：按 储罐出料口 → 立管 → 弯头 → 水平管 → 球阀 → 泵入口 顺序连接，球阀必须串入管段，泵入口为 DN80。');
  if (!items[4].ok) {
    const maybeReversed = checks.some((c) => {
      if (!portOccupied(s, c.uid, 'p1') || !portOccupied(s, c.uid, 'p2')) return false;
      const comp = componentOf(s, c.uid);
      return pumps.some((p) => comp.has(p.uid)) && hxs.some((hx) => comp.has(hx.uid));
    });
    problems.push(maybeReversed
      ? '泵出口到换热器管程进口的流路不通：止回阀可能装反——介质必须从进口（p1）流向出口（p2），请拆下止回阀调转方向，使阀体箭头指向换热器。'
      : '泵出口到换热器管程进口未连通：泵出口在泵体顶部（DN65），换热器管程进口为两端之一的 DN65 法兰，注意立管抬高后再转向。');
  }
  if (items[4].ok && !items[5].ok) problems.push('止回阀未串入泵出口管段或方向装反：介质必须从止回阀进口（p1）流向出口（p2），阀体箭头应指向换热器。');
  if (!items[6].ok) problems.push('换热器管程出口到接收储罐未连通：管程出口 DN65，接收储罐顶部进料口 DN50，需要用异径管过渡，并爬升到罐顶标高。');
  if (items[2].ok && items[4].ok && items[6].ok && !items[7].ok) problems.push('各段已连通但全程路径未通过：请运行连通检查查看断点。');
  return result(items, problems);
}

/* ---------- 任务清单 ---------- */

export const TASKS: TaskDef[] = [
  ...basicLessons,
  {
    id: 't1-turn', title: '任务 1 · 转向管道', batch: 1,
    goal: '使用直管与 90° 弯头搭建一段转向管道：两段直管通过弯头连成整体，两端开口之间连通且路径经过弯头。',
    allowedParts: ['pipe', 'elbow90', 'elbow45'],
    steps: [
      '从零件库添加一段直管，点击放置到网格上',
      '再添加一个 90° 弯头与第二段直管',
      '选中直管，点击端部接口，再点击弯头附近绿色高亮的接口完成连接',
      '把第二段直管连接到弯头出口，检查两端连通'
    ],
    rules: ['同规格焊接接口才能对接', '弯头出口朝向决定后续管段走向'],
    check: checkTurn, reference: refTurn
  },
  {
    id: 't2-branch', title: '任务 2 · 三通分支', batch: 1,
    goal: '使用等径三通搭建分支管路：三个接口全部接管，形成三条开放支路。',
    allowedParts: ['pipe', 'tee', 'tee-reducing', 'cap'],
    steps: ['添加等径三通与三段直管', '先连主管两端', '再把支管接到三通顶部接口', '确认三条支路都连通'],
    rules: ['支管接口垂直于主管', '未使用的接口需按任务要求封闭或保留'],
    check: checkBranch, reference: refBranch
  },
  {
    id: 't3-reducer', title: '任务 3 · 异径连接', batch: 1,
    goal: '使用异径管连接不同规格的管段：大端接 DN80 直管，小端接 DN50 直管，两端连通。',
    allowedParts: ['pipe', 'reducer-conc', 'reducer-ecc'],
    steps: ['添加同心或偏心异径管（默认 DN80→DN50）', '添加 DN80 与 DN50 直管各一段', '分别连接大端与小端', '尺寸不匹配的直连会被拒绝，体会异径管的过渡作用'],
    rules: ['异径管规格按预设配对', '泵入口水平管段优先底平偏心异径管'],
    check: checkReducer, reference: refReducer
  },
  {
    id: 't4-flange', title: '任务 4 · 法兰连接组装', batch: 1,
    goal: '用两片法兰、垫片与紧固件完成一处法兰连接：法兰—垫片—法兰，螺栓装满孔位并配好螺母，两侧接有管段。',
    allowedParts: ['pipe', 'flange-so', 'flange-wn', 'gasket', 'bolt', 'nut', 'flange-blind'],
    steps: ['添加两段直管与两片平焊法兰，把法兰焊在管端', '把垫片连接到一片法兰的密封面', '把另一片法兰连接到垫片另一面', '逐个安装螺栓到孔位，再为每只螺栓旋合螺母'],
    rules: ['法兰同规格同标准才能配对', '螺栓规格必须与法兰孔径一致（DN50 用 M16）', '教学提示：实际紧固应对角交叉分次拧紧'],
    check: checkFlange, reference: refFlange
  },
  {
    id: 't5-ball', title: '任务 5 · 安装球阀', batch: 1,
    prerequisites: '会设置管端形式并连接同规格法兰。可先完成法兰连接装配。',
    goal: '将球阀安装到指定管段：两侧法兰接管、串接在连通管段中且处于开启状态。',
    allowedParts: ['pipe', 'valve-ball'],
    steps: ['添加两段直管，把端部形式设为法兰', '添加球阀，进口对第一段管、出口对第二段管', '连接后确认管段两端连通', '在参数面板切换球阀开闭，观察连通变化'],
    rules: ['阀门法兰与管端法兰同规格', '关闭的阀门会切断连通路径'],
    questions: [
      { prompt: '普通闸阀的正常运行位置是什么？', options: ['全开或全关', '始终留一半开度'], correct: 0, explanation: VALVE_OPERATIONS.gate.description },
      { prompt: '本流程的切断球阀应怎样使用？', options: ['按固定百分比调量', '在全开和全关之间切换'], correct: 1, explanation: VALVE_OPERATIONS.ball.description },
      { prompt: '旋启式止回阀如何开关？', options: ['通过手柄调开度', '靠正向流动开启，停流回座'], correct: 1, explanation: VALVE_OPERATIONS.check.description },
      { prompt: '本教学蝶阀如何改变通流截面？', options: ['旋转蝶板至中间位置', '提起明杆闸板'], correct: 0, explanation: VALVE_OPERATIONS.butterfly.description },
      { prompt: '需要按控制信号连续调节时，应按用途选择哪类阀？', options: ['普通切断闸阀', '与工况相符的调节阀'], correct: 1, explanation: VALVE_OPERATIONS.control.description }
    ],
    check: checkBall, reference: refValve
  },
  {
    id: 't6-check', title: '任务 6 · 止回阀方向', batch: 1,
    prerequisites: '已辨认止回阀的进口、出口和阀体箭头。',
    goal: '将止回阀按规定流向安装：介质能从起点经进口→出口流到终点；反装会被连通检查判定失败。',
    allowedParts: ['pipe', 'valve-check'],
    steps: ['添加两段法兰端直管与止回阀', '先按阀体箭头方向连接', '运行连通检查', '故意调转方向再检查一次，观察错误说明'],
    rules: ['止回阀只允许进口→出口单向流动', '阀体箭头必须指向介质流向'],
    check: checkCheck, reference: refCheck
  },
  {
    id: 't7-tank-pump', title: '任务 7 · 储罐到泵', batch: 1,
    goal: '将储罐出口与泵入口连接：储罐底部出料口经立管、弯头与水平管段连接到离心泵入口，连通检查通过。',
    allowedParts: ['tank-vertical', 'pump-centrifugal', 'pipe', 'elbow90', 'valve-ball', 'valve-check'],
    steps: ['放置立式储罐与离心泵', '把管段与弯头端部形式设为法兰，从储罐底部出料口接一段 DN80 立管', '用弯头转向水平方向', '水平管段接到泵入口（注意泵入口标高约 100mm）'],
    rules: ['泵入口 DN80、出口 DN65', '可在管段中串入阀门，但不得阻断连通'],
    check: checkTankPump, reference: refTankPump
  },
  {
    id: 't8-pump-out', title: '任务 8 · 泵出口管段', batch: 2,
    goal: '为泵出口配置管段、阀门与压力表（第二批仪表开放后启用）。',
    allowedParts: ['pump-centrifugal', 'pipe', 'valve-ball', 'valve-check', 'instr-pressure'],
    steps: ['等待第二批仪表对象开放'], rules: [],
    check: () => result([{ label: '第二批内容开发中', ok: false }], ['该任务依赖第二批仪表对象，尚未开放。'])
  },
  {
    id: 't9-heat', title: '任务 9 · 换热器双流路', batch: 1,
    goal: '为管壳式换热器连接两条独立流路：管程（DN65）进口→出口、壳程（DN50）进口→出口各自与管段连成流路，两条流路互不串通。',
    allowedParts: ['heat-shell-tube', 'pipe', 'elbow90', 'valve-ball', 'cap'],
    steps: [
      '放置管壳式换热器，认清四个接口：管程进/出口（DN65，两端）、壳程进/出口（DN50，顶部与底部）',
      '把管段端部形式设为法兰，分别连接管程进口与出口',
      '用 DN50 法兰管段分别连接壳程进口与出口',
      '运行连通检查，确认两条流路各自连通且相互独立'
    ],
    rules: ['管程与壳程由管板隔开，内部互不连通', '同规格同标准（PN16）法兰才能配对', '教学示意模型：流路动画不代表实际传热计算'],
    check: checkHeat, reference: refHeat
  },
  {
    id: 't10-loop', title: '任务 10 · 储罐输送教学装置', batch: 1,
    goal: '从零搭建储罐输送教学装置：供料储罐 → 直管 → 球阀 → 离心泵 → 止回阀 → 换热器管程 → 接收储罐。逐段连接、止回阀方向正确，全程连通检查通过。',
    allowedParts: ['tank-vertical', 'pump-centrifugal', 'valve-ball', 'valve-check', 'heat-shell-tube', 'pipe', 'elbow90', 'elbow45', 'reducer-conc', 'reducer-ecc', 'cap'],
    steps: [
      '分别放置供料储罐与接收储罐，再放置离心泵、球阀、止回阀与换热器',
      '管段端部设为法兰：从供料罐底部出料口接 DN80 立管，弯头转向水平，串入球阀后接到泵入口',
      '从泵顶部出口（DN65）接立管，弯头转向水平，串入止回阀（箭头指向换热器）后接到换热器管程进口',
      '从管程出口接出，用异径管 DN65→DN50 过渡，爬升到接收罐顶部，接 DN50 进料口',
      '运行连通检查确认全程连通，保存方案以便继续编辑'
    ],
    rules: [
      '泵入口 DN80、出口 DN65；换热器管程 DN65、壳程 DN50',
      '储罐顶部进料口 DN50、底部出料口 DN80',
      '止回阀只允许进口→出口单向流动，反装会被连通检查判定失败',
      '教学示意：流动动画与连通检查不代表实际水力计算'
    ],
    check: checkTransfer, reference: refTransfer
  }
];

export function taskById(id: string): TaskDef | undefined {
  return TASKS.find((t) => t.id === id);
}
