export type Vec3 = [number, number, number];

export interface PartDef {
  id: string;
  name: string;
  group: string;
  desc: string;
  color: number;
  pos: Vec3;
  rot?: Vec3;
  explodeDir: Vec3;
  explodeDist: number;
  /** 外壳类零件：透明观察模式中被调节透明度 */
  shell?: boolean;
  /** 连接方式：焊接 / 螺栓 / 配合键联 / 基础固定，用于结构认知与拆装规则 */
  joint: 'welded' | 'bolted' | 'fitted' | 'anchor';
  /** 部件角色：fixed 固定结构 / removable 可拆卸部件 / display 仅用于结构展开 */
  role: 'fixed' | 'removable' | 'display';
  /** 固定连接 / 不可拆卸（与 role 保持一致，由校验脚本检查） */
  fixed?: boolean;
  /** 拆装练习中可操作（与 role 保持一致，由校验脚本检查） */
  removable?: boolean;
  /** 安装时有方向要求（可用旋转按钮调整） */
  orientable?: boolean;
  /** 安装前置依赖（须先装好） */
  prereq?: string[];
  /** 拆卸前必须先拆下的零件 */
  removeAfter?: string[];
  /** 引导学习中的操作提示 */
  tip?: string;
  /** 标注锚点偏移 */
  labelOffset?: Vec3;
}

export interface ObservationExercise {
  /** 第一步：沿真实入口进入，到达指定内窥视点 */
  observe: {
    startStop: number;
    requiredStop: number;
    prompt: string;
    reachedNote: string;
  };
  /** 第二步：回到剖视图，由学生主动点选答案零件 */
  identify: {
    axis: 'x' | 'y' | 'z';
    position: number;
    flip: boolean;
    prompt: string;
    answerPartId: string;
    answerName: string;
    wrongHint: string;
    successNote: string;
  };
}

export interface ObservationTask {
  id: string;
  text: string;
  /** 一键前往的观察模式 */
  mode: 'observe' | 'section' | 'xray' | 'explode' | 'principle' | 'practice' | 'endoscope';
  /** 前往时定位的零件 */
  partId?: string;
  /** 完成条件为自动判定的任务类型 */
  auto?: 'practice-completion';
  /** 结构自测：完成后单独保存成绩，不与手动勾选混用 */
  exercise?: ObservationExercise;
}

export interface DeviceDef {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  /** 内容版本：学习记录与任务进度按设备+版本保存，版本变化时旧进度按不兼容处理 */
  contentVersion: string;
  use: string;
  principle: string;
  structureNote: string;
  learningPoints: string[];
  /** 学习目标 */
  objectives: string[];
  /** 观察任务清单 */
  tasks: ObservationTask[];
  keywords: string[];
  parts: PartDef[];
  /** 组装顺序（拆卸为其逆序）；为空表示该设备暂未开放拆装练习 */
  assemblyOrder: string[];
  principleAnim:
    | 'pump' | 'exchanger' | 'reactor'
    | 'ball' | 'gate' | 'butterfly' | 'check'
    | 'gear' | 'diaphragm' | 'phe' | 'bag' | 'ystrainer'
    | 'tank' | 'separator' | 'tower' | 'cyclone' | 'screw' | 'emf';
  /** 零件区（拆卸后摆放）基准 */
  trayZ: number;
}

export interface AssemblyStep {
  partId: string;
  action: 'remove' | 'install';
  title: string;
  instruction: string;
}

export function buildSteps(device: DeviceDef): AssemblyStep[] {
  const byId = new Map(device.parts.map((p) => [p.id, p]));
  const steps: AssemblyStep[] = [];
  const disOrder = [...device.assemblyOrder].reverse();
  disOrder.forEach((id, i) => {
    const p = byId.get(id)!;
    steps.push({
      partId: id,
      action: 'remove',
      title: `拆卸 ${p.name}`,
      instruction: p.tip ? `第 ${i + 1} 步：${p.tip}` : `第 ${i + 1} 步：点击选中「${p.name}」，再点击「拆下」将其移入零件区。`
    });
  });
  device.assemblyOrder.forEach((id, i) => {
    const p = byId.get(id)!;
    const pre = (p.prereq ?? []).map((x) => byId.get(x)?.name ?? x).join('、');
    steps.push({
      partId: id,
      action: 'install',
      title: `安装 ${p.name}`,
      instruction: `第 ${disOrder.length + i + 1} 步：将「${p.name}」拖到虚线安装位置附近松开，或选中后点击「安装到位置」。${pre ? `前置部件：${pre}。` : ''}${p.orientable ? '注意安装方向，可用「旋转 90°」调整。' : ''}`
    });
  });
  return steps;
}

export const CATEGORIES = [
  { id: 'all', label: '全部设备' },
  { id: 'pump', label: '泵与压缩设备' },
  { id: 'valve', label: '阀门与管道附件' },
  { id: 'heat', label: '换热设备' },
  { id: 'filter', label: '过滤与分离设备' },
  { id: 'reaction', label: '反应与塔器设备' },
  { id: 'tank', label: '储存设备' },
  { id: 'instr', label: '测量仪表' }
];