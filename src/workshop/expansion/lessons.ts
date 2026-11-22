import type { Instance, WState } from '../types';
import type { TaskDef } from '../tasks';
import { partById } from '../catalog';
import { resolveConnectionDraft } from '../assemblyPlan';
import { emptyState, newUid, portsAligned, findPath, portDef } from '../state';
import type { PortRef } from '../state';
import { pumpAssets, pumpLessonConnections } from './pump';

type End = [string, string];
type Node = { key: string; type: string; spec?: Partial<Instance['spec']>; pos?: Instance['pos'] };
type Link = { name?: string; a: End; b: End };
type Lesson = { nodes: Node[]; links: Link[]; trace?: [End, End] };

const pipeFlange = { endType: 'flange' } as const;
const flange: Lesson = {
  nodes: [
    { key: 'left', type: 'pipe' }, { key: 'a', type: 'flange-so' }, { key: 'seal', type: 'gasket' },
    { key: 'b', type: 'flange-wn' }, { key: 'right', type: 'pipe' }
  ],
  links: [
    { a: ['left', 'p2'], b: ['a', 'weld'] }, { name: 'joint', a: ['a', 'face'], b: ['seal', 'f1'] },
    { a: ['seal', 'f2'], b: ['b', 'face'] }, { a: ['b', 'weld'], b: ['right', 'p1'] }
  ],
  trace: [['left', 'p1'], ['right', 'p2']]
};
for (let slot = 0; slot < 4; slot++) {
  const bolt = `bolt${slot}`, washer = `washer${slot}`, nut = `nut${slot}`;
  flange.nodes.push({ key: bolt, type: 'bolt', spec: { dn: 16 } }, { key: washer, type: 'washer-flat' }, { key: nut, type: 'nut', spec: { dn: 16 } });
  flange.links.push(
    { a: [bolt, 'washer-seat'], b: [washer, 'bore'] },
    { a: [bolt, 'shank'], b: ['$joint', `slot${slot}`] },
    { a: [bolt, 'end'], b: [nut, 'thread'] }
  );
}

const pipework: Lesson = {
  nodes: [
    { key: 'feed', type: 'pipe', spec: { dn: 65 } },
    { key: 'turn', type: 'elbow90', spec: { dn: 65 } },
    { key: 'split', type: 'tee', spec: { dn: 65 } },
    { key: 'reduce', type: 'reducer-conc', spec: { dn: 65, smallDn: 50, ...pipeFlange } },
    { key: 'valve', type: 'valve-check' },
    { key: 'outlet', type: 'pipe', spec: pipeFlange },
    { key: 'cap', type: 'cap', spec: { dn: 65 } },
    { key: 'shoe', type: 'support' }
  ],
  links: [
    { a: ['feed', 'p2'], b: ['turn', 'p1'] }, { a: ['turn', 'p2'], b: ['split', 'p1'] },
    { a: ['split', 'p3'], b: ['cap', 'p1'] },
    { a: ['reduce', 'p2'], b: ['valve', 'p1'] }, { a: ['valve', 'p2'], b: ['outlet', 'p1'] },
    { a: ['outlet', 'surface'], b: ['shoe', 'mount'] }
  ],
  trace: [['feed', 'p1'], ['outlet', 'p2']]
};
// The welded flange carries the welded run into the flanged reducer.
pipework.nodes.splice(3, 0, { key: 'adapter', type: 'flange-wn', spec: { dn: 65 } });
pipework.links.splice(3, 0, { a: ['split', 'p2'], b: ['adapter', 'weld'] }, { a: ['adapter', 'face'], b: ['reduce', 'p1'] });

const pump: Lesson = {
  nodes: pumpAssets.map(asset => ({ key: asset.id, type: asset.id, pos: asset.lessonPosition })),
  links: [1, 2, 3, 9, 5, 4, 6, 0, 7, 8, 10, 11].map(index => {
    const { a, b } = pumpLessonConnections[index];
    return { a: b, b: a };
  })
};

export const assemblyLessons: Record<string, Lesson> = { 'basic-flange': flange, 'basic-pipework': pipework, 'basic-pump': pump };

function ref(end: End, instances: Map<string, Instance>, joints: Map<string, string>): PortRef | undefined {
  const instance = instances.get(end[0]);
  if (instance) return { uid: instance.uid, port: end[1] };
  const joint = end[0].startsWith('$') ? joints.get(end[0].slice(1)) : undefined;
  return joint ? { uid: `joint:${joint}`, port: end[1] } : undefined;
}

function sameEnd(a: PortRef, b: PortRef): boolean { return a.uid === b.uid && a.port === b.port; }

function matches(inst: Instance, node: Node): boolean {
  return inst.partId === node.type && Object.entries(node.spec ?? {}).every(([key, value]) =>
    (inst.spec[key as keyof Instance['spec']] ?? partById(inst.partId)?.defaultSpec[key as keyof Instance['spec']]) === value);
}

function graphCheck(state: WState, lesson: Lesson): string | null {
  const picks = new Map<string, Instance>();
  const used = new Set<string>();
  const options = lesson.nodes.map(node => state.instances.filter(inst => matches(inst, node)));
  let checked = 0;
  let longestMatch = -1;
  let failure = '检查指定规格的零件数量和连接。';
  const nameEnd = ([key, port]: End) => {
    if (key.startsWith('$')) return '法兰孔位 ' + (Number(port.slice(4)) + 1);
    const node = lesson.nodes.find(node => node.key === key);
    const selected = picks.get(key);
    const label = selected ? portDef(selected, port)?.label : null;
    return (node ? partById(node.type)?.name : key) + ' · ' + (label ?? port);
  };
  function explain(message: string, progress: number) {
    if (progress <= longestMatch) return;
    failure = message;
    longestMatch = progress;
  }
  function checkLinks(finish: boolean): Map<string, string> | null {
    const joints = new Map<string, string>();
    let matched = 0;
    for (const link of lesson.links) {
      const a = ref(link.a, picks, joints), b = ref(link.b, picks, joints);
      if (!a || !b) {
        if (finish) return null;
        continue;
      }
      const edge = state.connections.find(c => (sameEnd(a, c.a) && sameEnd(b, c.b)) || (sameEnd(b, c.a) && sameEnd(a, c.b)));
      const aligned = edge && (!['mechanical', 'weld', 'flange'].includes(edge.kind) || portsAligned(state, a, b));
      if (!aligned) {
        explain(nameEnd(link.a) + ' 与 ' + nameEnd(link.b) +
          (edge ? ' 未对齐。请解除连接，核对位置和方向后重新安装。' : ' 尚未正确连接。请按步骤选中这两个接口安装。'), matched);
        return null;
      }
      matched++;
      if (link.name) joints.set(link.name, edge.id);
    }
    return joints;
  }
  function walk(index: number): boolean {
    if (++checked > 20000) return false;
    const joints = checkLinks(index === lesson.nodes.length);
    if (!joints) return false;
    if (index === lesson.nodes.length) {
      if (!lesson.trace) return true;
      const a = ref(lesson.trace[0], picks, joints), b = ref(lesson.trace[1], picks, joints);
      if (a && b && findPath(state, a, b).ok) return true;
      explain('连接已齐，入口到出口仍不通。核对止回阀方向及管路中阀门状态。', lesson.links.length);
      return false;
    }
    const node = lesson.nodes[index];
    for (const item of options[index]) {
      if (used.has(item.uid)) continue;
      picks.set(node.key, item);
      used.add(item.uid);
      if (walk(index + 1)) return true;
      picks.delete(node.key);
      used.delete(item.uid);
    }
    return false;
  }
  return walk(0) ? null : failure;
}

function reference(lesson: Lesson): WState {
  let state = emptyState();
  const instances = new Map<string, Instance>();
  for (const [i, node] of lesson.nodes.entries()) {
    const part = partById(node.type);
    if (!part) continue;
    const instance: Instance = { uid: newUid(), partId: node.type, spec: { ...part.defaultSpec, ...node.spec },
      pos: node.pos ? [...node.pos] : [i * 1.15, 1.2, i % 2], rot: [0, 0, 0] };
    instances.set(node.key, instance);
    state.instances.push(instance);
  }
  const joints = new Map<string, string>();
  for (const link of lesson.links) {
    const a = ref(link.a, instances, joints), b = ref(link.b, instances, joints);
    if (!a || !b) continue;
    const result = resolveConnectionDraft(state, a, b);
    if (result.ok) {
      state = result.state;
      if (link.name) joints.set(link.name, result.connection.id);
    }
  }
  return state;
}

function define(id: keyof typeof assemblyLessons, title: string, goal: string, steps: string[], rules: string[]): TaskDef {
  const lesson = assemblyLessons[id];
  return {
    id, title, goal, steps, rules, batch: 1,
    prerequisites: id === 'basic-pump' ? '分清泵壳、轴系、机械密封及各自的安装面。' : '认识口径、端接形式和接口方向。',
    allowedParts: [...new Set(lesson.nodes.map(node => node.type))],
    reference: () => reference(lesson),
    check: state => {
      const required = new Map<string, { node: Node; count: number }>();
      for (const node of lesson.nodes) {
        const key = JSON.stringify([node.type, node.spec]);
        required.set(key, { node, count: (required.get(key)?.count ?? 0) + 1 });
      }
      const items = [...required.values()].map(({ node, count }) => {
        const spec = node.spec;
        const markers = [spec?.dn ? 'DN' + spec.dn : '', spec?.smallDn ? '小端 DN' + spec.smallDn : '',
          spec?.endType === 'flange' ? '法兰端' : ''].filter(Boolean);
        const name = partById(node.type)?.name ?? node.type;
        return { label: name + (markers.length ? ' ' + markers.join(' · ') : '') + ' ×' + count,
          ok: state.instances.filter(inst => matches(inst, node)).length >= count };
      });
      const missing = items.filter(item => !item.ok);
      const problem = missing.length ? '补齐以下规格的零件：' + missing.map(item => item.label).join('、') : graphCheck(state, lesson);
      items.push({ label: '安装关系、位置与方向符合课程要求，适用时管路贯通', ok: problem === null });
      return { done: problem === null, items, problems: problem ? [problem] : [] };
    }
  };
}

export const basicLessons = [
  define('basic-flange', '基础课 · 法兰连接装配', '装上两个适配法兰、垫片和四套独立紧固件。', [
    '两段 DN50 焊接直管各接一个法兰。平焊法兰与对焊法兰的密封面之间加入密封垫片。',
    '在平焊法兰与垫片的连接上查看螺栓孔位。先从每支 M16 螺栓的杆端套入平垫圈，再一起穿入孔位，另一侧装 M16 螺母。',
    '检查两端贯通、孔位对中、垫片及四组螺栓、垫圈、螺母。'
  ], ['孔位按本站同一教学法兰规格校验。课程不提供现场扭矩和压力。']),
  define('basic-pipework', '基础课 · 管路单元组装', '搭建有一条封堵支路的单向输送路径并安装管鞋。', [
    '以 DN65 焊接直管、90° 弯头和三通连接主管。用 DN65 管帽封闭三通支管。',
    '三通另一端接 DN65 对焊法兰，再接 DN65→DN50 同心异径管。异径管两端切换为法兰。',
    '从小端接旋启式止回阀入口，出口连接 DN50 法兰直管，在末段直管外壁安装 DN50 管鞋。'
  ], ['流向错误和缺少连接会阻断连通。管帽无后续流道，支撑件为机械安装。']),
  define('basic-pump', '基础课 · 离心泵结构装配', '以同一底座和轴线装泵壳、轴系与机械密封。', [
    '在底座上固定轴承座，装入轴承，再从泵侧将阶梯轴送入内圈止肩。',
    '先把静环装到独立密封腔，选中腔座点「预定位密封腔」。在独立轴套上装好动环，把轴套组件装到轴肩。选中泵盖，点「预定位泵盖」把它沿轴送入待装位，再装叶轮。从吸入口一侧将敞开后端的泵壳套过叶轮，落到底座。',
    '连接泵盖与泵壳、密封腔座与泵盖。联轴器接轴端，最后确认动静环工作面贴合。'
  ], ['教学配合顺序。仅展示一处径向轴承，省略第二支承、电机、护罩及密封辅助系统的独立装配。'])
];





