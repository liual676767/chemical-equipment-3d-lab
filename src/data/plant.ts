import type { ValveKind, ValveState } from './valveOperations';
import { solveTeachingFlow } from '../process/teachingFlow';
import { DEVICES } from './devices';
import type { DeviceDef, Vec3 } from './types';

/**
 * 化工厂全流程装置（教学示意）唯一数据源。
 * 本文件建立「设备—接口—管线—阀门/仪表—介质—工序—工艺层」的关联：
 * - 设备接口定义在设备局部坐标（与 devices.ts 零件坐标一致），由场景换算到世界坐标；
 * - 管线端点引用设备接口，路由点仅为教学走线，不代表施工设计；
 * - 阀门/流量计等内联件挂接在管线上，状态影响下游流动；
 * - 位号、层号、管径等级与介质色均为教学内部编号/示意，不是工程数据。
 */

export type MediumId =
  | 'feed' | 'aux' | 'reaction' | 'overhead' | 'condensate'
  | 'product' | 'recovery' | 'offgas' | 'utility';

export type MediumPhase = 'liquid' | 'gas' | 'utility';

export interface MediumDef {
  id: MediumId;
  label: string;
  color: number;
  phase: MediumPhase;
  desc: string;
}

export type PipeSizeId = 'main' | 'branch' | 'utility' | 'instrument';

export interface PipeSizeDef {
  id: PipeSizeId;
  label: string;
  /** 外半径（米）。仅用于教学图示的管径层级，不代表工程管径。 */
  radius: number;
  /** 配对法兰外半径（米）。 */
  flange: number;
  note: string;
}

export type LayerId = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';

export interface ProcessLayerDef {
  id: LayerId;
  name: string;
  short: string;
  color: number;
  /** 本层作用 */
  function: string;
  input: string;
  process: string;
  output: string;
  devices: string[];
  /** 地面示意分区（x1,z1,x2,z2），可多块 */
  zones: [number, number, number, number][];
}

export type PortRole = 'in' | 'out' | 'both';

export interface PortDef {
  id: string;
  name: string;
  /** 设备局部坐标（与零件 pos 同一坐标系，单位约米） */
  pos: Vec3;
  /** 设备局部坐标下的外法线方向 */
  dir: Vec3;
  role: PortRole;
  size: PipeSizeId;
  /** 场景中补充的示意接管（模型本身未建该口） */
  added?: boolean;
}

export interface InlineMount {
  pipe: string;
  /** 沿管线弧长的相对位置 */
  t: number;
  /** 设备内「管轴中心」的局部高度（阀门模型立地建模，需偏移对齐管线） */
  bodyY: number;
  valve?: ValveKind;
}

export interface PlantNodeDef {
  uid: string;
  deviceId: string;
  tag: string;
  label: string;
  /** 在本教学流程中的职责 */
  role: string;
  /** 设备内部结构/流动的简短教学说明 */
  internals: string;
  layer: LayerId;
  step: string;
  /** 场景平面坐标（x, z），落地高度自动计算 */
  pos: [number, number];
  rotY?: number;
  /** 抬高安装（米），用于换热器等需要底部接管空间的设备 */
  lift?: number;
  anim?: 'pump' | 'gear' | 'gearPump' | 'compressor' | 'agitator' | 'level' | 'tower' | 'separator' | 'cyclone';
  /** 设备接口（引用 deviceId 对应型号的接口表） */
  ports: PortDef[];
  /** 内联小件：阀门/过滤器/流量计等挂在管线上，不落地 */
  inline?: InlineMount;
  labelLift?: number;
}

export interface PortEndpoint {
  type: 'port';
  node: string;
  port: string;
}

export interface CapEndpoint {
  type: 'cap';
  pos: Vec3;
  label: string;
}

export type PipeEndpoint = PortEndpoint | CapEndpoint;

export interface InstrumentDef {
  tag: string;
  name: string;
  kind: 'pressure' | 'temperature';
  pipe: string;
  t: number;
  note: string;
}

export interface PipelineDef {
  id: string;
  name: string;
  from: PipeEndpoint;
  to: PipeEndpoint;
  medium: MediumId;
  size: PipeSizeId;
  layer: LayerId;
  /** 管线路由转角点（世界坐标，不含两端接口短节） */
  waypoints: Vec3[];
  note?: string;
}

export interface ProcessStepDef {
  id: string;
  no: number;
  title: string;
  desc: string;
  layer: LayerId;
  nodes: string[];
  pipes: string[];
}

export const PORT_STUB = 0.26;

export const MEDIA: Record<MediumId, MediumDef> = {
  feed: { id: 'feed', label: '原料液', color: 0x3f7fbf, phase: 'liquid', desc: '原料液：原料罐 → 进料泵 → 过滤/计量 → 预热 → 反应釜' },
  aux: { id: 'aux', label: '辅料', color: 0xb5658f, phase: 'liquid', desc: '辅料：经齿轮泵计量加入反应釜（辅料来源为示意）' },
  reaction: { id: 'reaction', label: '反应液', color: 0xc08a3e, phase: 'liquid', desc: '反应液：反应釜 → 冷却器 → 分离塔' },
  overhead: { id: 'overhead', label: '塔顶气相', color: 0x4f9fae, phase: 'gas', desc: '塔顶气相：分离塔 → 塔顶冷凝器' },
  condensate: { id: 'condensate', label: '冷凝液', color: 0x74b7c2, phase: 'liquid', desc: '冷凝液：冷凝器 → 气液分离器' },
  product: { id: 'product', label: '产品液', color: 0x4d9f78, phase: 'liquid', desc: '产品液：分离器 → 精滤 → 出料阀 → 成品罐' },
  recovery: { id: 'recovery', label: '回收液', color: 0xb0763f, phase: 'liquid', desc: '回收液：塔釜 → 隔膜泵 → 原料罐（循环）' },
  offgas: { id: 'offgas', label: '尾气', color: 0x8a95a3, phase: 'gas', desc: '不凝气：气液分离器 → 旋风分离器 → 高点排放（示意）' },
  utility: { id: 'utility', label: '公用工程', color: 0xb9a13b, phase: 'utility', desc: '蒸汽/冷却水/仪表空气接管（示意，端头为盲板）' }
};

export const PIPE_SIZES: Record<PipeSizeId, PipeSizeDef> = {
  main: { id: 'main', label: '主工艺管线', radius: 0.075, flange: 0.15, note: '主工艺等级（教学示意口径，非工程管径）' },
  branch: { id: 'branch', label: '支管', radius: 0.05, flange: 0.11, note: '支管等级（教学示意口径）' },
  utility: { id: 'utility', label: '公用工程管线', radius: 0.035, flange: 0.08, note: '公用工程等级（教学示意口径）' },
  instrument: { id: 'instrument', label: '仪表/取样管', radius: 0.02, flange: 0.05, note: '仪表等级（教学示意口径）' }
};

export const PROCESS_LAYERS: ProcessLayerDef[] = [
  {
    id: 'L0', name: '原料与公用工程层', short: '原料与公用工程', color: 0x5f93c0,
    function: '接收、储存原料液，并提供仪表空气与冷热媒等公用工程接口（公用工程为示意）。',
    input: '外部原料来料（示意）；压缩机吸入空气。',
    process: '储罐缓冲 → 罐底切断阀 → 供料泵吸入；压缩机提供仪表空气。',
    output: '原料液送往 L1 输送与预处理；仪表空气送公用工程总管（示意）。',
    devices: ['T-101', 'GV-101', 'C-101'],
    zones: [[-16.3, -1.9, -12.1, 2.3], [-15.7, -6.9, -11.9, -4.2]]
  },
  {
    id: 'L1', name: '输送与预处理层', short: '输送与预处理', color: 0x4fae9a,
    function: '把原料升压、过滤、计量并预热，为反应工段提供稳定进料。',
    input: '来自 L0 的原料液；外部热媒（示意）。',
    process: '泵送 → 止回 → Y型过滤 → 电磁计量 → 球阀 → 板式换热器预热。',
    output: '预热后的原料液送往 L2 反应层。',
    devices: ['P-101', 'CV-101', 'ST-101', 'FT-101', 'BV-101', 'E-101'],
    zones: [[-12.5, -1.6, -0.8, 3.0]]
  },
  {
    id: 'L2', name: '反应层', short: '反应', color: 0xc08a3e,
    function: '认识主辅料在搅拌釜的汇入路径与夹套换热通路。实际反应待确认。',
    input: '来自 L1 的预热原料；辅料由齿轮泵计量加入（来源示意）。',
    process: '观察辅料加入、搅拌和独立夹套通路。',
    output: '反应液送往 L3 冷却与分离。',
    devices: ['R-101', 'P-102'],
    zones: [[-0.8, -4.6, 4.7, 3.0]]
  },
  {
    id: 'L3', name: '冷却与塔内分离层', short: '冷却与分离', color: 0x8a7fc0,
    function: '观察独立冷却水通路和填料塔的液体路线。塔用途和上升气源待确认。',
    input: '反应液；冷却水（示意）。',
    process: '壳程物料进入塔上部，液体向下经过填料。没有已接入的塔底气源。',
    output: '塔底液路送往 L6。L4 的塔顶气相从独立原理演示边界启用。',
    devices: ['E-102', 'T-102'],
    zones: [[4.4, -1.7, 10.9, 3.0]]
  },
  {
    id: 'L4', name: '冷凝与气液分离层', short: '冷凝与分离', color: 0x4f9fae,
    function: '在假设可冷凝组分与冷却水可用时，观察冷凝液和不凝气的去向。',
    input: '塔顶气相；冷却水（示意）。',
    process: '管壳式冷凝 → 立式气液分离（入口挡板 + 除沫器）。',
    output: '冷凝液送往 L5；不凝气送往 L6 尾气处理。',
    devices: ['E-103', 'V-102'],
    zones: [[11.0, -2.3, 16.6, 3.0]]
  },
  {
    id: 'L5', name: '产品精制与储存层', short: '产品精制与储存', color: 0x4d9f78,
    function: '冷凝液经精滤后作为产品储存。',
    input: '来自 L4 的冷凝液。',
    process: '袋式精滤 → 蝶阀出料 → 成品罐储存。',
    output: '精滤后示踪液进入成品罐，实际产品质量判据待确认。',
    devices: ['F-101', 'BV-102', 'T-103'],
    zones: [[5.9, -6.2, 15.1, -3.5]]
  },
  {
    id: 'L6', name: '尾气与回收层', short: '尾气与回收', color: 0xb0763f,
    function: '观察旋风惯性捕集和气侧高点边界，同时识别独立驱动的回收液路。',
    input: '不凝气；塔釜液。',
    process: '观察旋风中颗粒或液滴的去向。隔膜泵示踪回液至原料罐。',
    output: '尾气排放（示意）；回收液回到 L0 原料罐。',
    devices: ['CY-101', 'P-103'],
    zones: [[16.1, -3.4, 18.8, -0.4], [5.6, -9.0, 11.4, -6.5]]
  }
];

const tankPorts: PortDef[] = [
  { id: 'out', name: '罐底出口', pos: [0.88, 0.28, 0], dir: [1, 0, 0], role: 'out', size: 'main' },
  { id: 'in', name: '罐顶入口', pos: [0.3, 2.08, 0], dir: [0, 1, 0], role: 'in', size: 'main' }
];

export const DEVICE_PORTS: Record<string, PortDef[]> = {
  'fixed-roof-tank': tankPorts,
  pump: [
    { id: 'suction', name: '吸入口', pos: [-2.9, 0.78, 0], dir: [-1, 0, 0], role: 'in', size: 'main' },
    { id: 'discharge', name: '排出口', pos: [0.63, 2.35, 0], dir: [1, 0, 0], role: 'out', size: 'main' }
  ],
  exchanger: [
    { id: 'shellIn', name: '壳程入口', pos: [-0.7, 1.75, 0], dir: [0, 1, 0], role: 'in', size: 'main' },
    { id: 'shellOut', name: '壳程出口', pos: [0.42, 0.5, 0], dir: [1, 0, 0], role: 'out', size: 'main', added: true },
    { id: 'tubeIn', name: '管程入口', pos: [-1.38, 1.71, 0], dir: [0, 1, 0], role: 'in', size: 'utility' },
    { id: 'tubeOut', name: '管程出口', pos: [1.29, 0.09, 0], dir: [0, -1, 0], role: 'out', size: 'utility' }
  ],
  'plate-exchanger': [
    { id: 'processIn', name: '工艺侧入口', pos: [-0.91, 0.32, -0.16], dir: [-1, 0, 0], role: 'in', size: 'main' },
    { id: 'processOut', name: '工艺侧出口', pos: [-0.91, 0.88, -0.16], dir: [-1, 0, 0], role: 'out', size: 'main' },
    { id: 'heatIn', name: '热媒入口', pos: [-0.91, 0.32, 0.16], dir: [-1, 0, 0], role: 'in', size: 'utility' },
    { id: 'heatOut', name: '热媒出口', pos: [-0.91, 0.88, 0.16], dir: [-1, 0, 0], role: 'out', size: 'utility' }
  ],
  reactor: [
    { id: 'feed', name: '进料口', pos: [0.82, 0.22, 0], dir: [1, 0, 0], role: 'in', size: 'main' },
    { id: 'out', name: '出料口（示意接管）', pos: [-0.55, 0.38, 0], dir: [-1, 0, 0], role: 'out', size: 'main', added: true },
    { id: 'topAux', name: '顶部辅料口', pos: [0.3, 2.19, 0], dir: [0, 1, 0], role: 'in', size: 'branch' },
    { id: 'jacketIn', name: '夹套入口', pos: [0.8, 1.3, 0], dir: [1, 0, 0], role: 'in', size: 'utility' },
    { id: 'jacketOut', name: '夹套出口', pos: [0.8, 0.7, 0], dir: [1, 0, 0], role: 'out', size: 'utility' }
  ],
  'gear-pump': [
    { id: 'suction', name: '吸入口（示意接管）', pos: [0, 0.72, -0.45], dir: [0, 0, -1], role: 'in', size: 'branch', added: true },
    { id: 'discharge', name: '排出口（示意接管）', pos: [0, 1.08, 0], dir: [0, 1, 0], role: 'out', size: 'branch', added: true }
  ],
  'diaphragm-pump': [
    { id: 'suction', name: '进口总管', pos: [0.58, 0.36, 0], dir: [1, 0, 0], role: 'in', size: 'main' },
    { id: 'discharge', name: '出口总管', pos: [-0.58, 1.08, 0], dir: [-1, 0, 0], role: 'out', size: 'main' }
  ],
  'y-strainer': [
    { id: 'in', name: '入口', pos: [-0.26, 0.5, 0], dir: [-1, 0, 0], role: 'in', size: 'main' },
    { id: 'out', name: '出口', pos: [0.26, 0.5, 0], dir: [1, 0, 0], role: 'out', size: 'main' }
  ],
  'bag-filter': [
    { id: 'in', name: '顶部进料口', pos: [0, 1.36, 0], dir: [0, 1, 0], role: 'in', size: 'main' },
    { id: 'out', name: '侧面清液口', pos: [-0.39, 0.35, 0], dir: [-1, 0, 0], role: 'out', size: 'main' }
  ],
  'gas-separator': [
    { id: 'inlet', name: '入口', pos: [0.52, 1.25, 0], dir: [1, 0, 0], role: 'in', size: 'main' },
    { id: 'gasOut', name: '顶部气相出口', pos: [0, 1.83, 0], dir: [0, 1, 0], role: 'out', size: 'main' },
    { id: 'liquidOut', name: '底部液相出口（示意接管）', pos: [0, 0.38, 0.42], dir: [0, 0, 1], role: 'out', size: 'main', added: true }
  ],
  'packed-tower': [
    { id: 'feed', name: '上部进液口', pos: [0.5, 2.0, 0], dir: [1, 0, 0], role: 'in', size: 'main' },
    { id: 'overhead', name: '塔顶气相出口', pos: [0, 2.42, 0], dir: [0, 1, 0], role: 'out', size: 'main' },
    { id: 'bottoms', name: '塔底釜液出口', pos: [0.5, 0.18, 0], dir: [1, 0, 0], role: 'out', size: 'main' },
    { id: 'gasIn', name: '塔底进气口（备用）', pos: [0.5, 0.4, 0], dir: [1, 0, 0], role: 'in', size: 'main' }
  ],
  'cyclone-separator': [
    { id: 'inlet', name: '切向入口', pos: [0.3, 1.5, 0.34], dir: [0, 0, 1], role: 'in', size: 'main' },
    { id: 'gasOut', name: '顶部排气口', pos: [0, 2.03, 0], dir: [0, 1, 0], role: 'out', size: 'main' },
    { id: 'dustOut', name: '底部排料口（盲板）', pos: [0, 0.14, 0], dir: [0, -1, 0], role: 'out', size: 'branch' }
  ],
  'screw-compressor': [
    { id: 'inlet', name: '进气口', pos: [-0.35, 1.05, 0], dir: [0, 1, 0], role: 'in', size: 'utility' },
    { id: 'airOut', name: '排气接管（示意）', pos: [0.65, 1.05, 0], dir: [1, 0, 0], role: 'out', size: 'utility', added: true }
  ],
  'emf-meter': [
    { id: 'in', name: '入口', pos: [-0.3, 0.6, 0], dir: [-1, 0, 0], role: 'in', size: 'main' },
    { id: 'out', name: '出口', pos: [0.3, 0.6, 0], dir: [1, 0, 0], role: 'out', size: 'main' }
  ],
  'ball-valve': [], 'gate-valve': [], 'check-valve': [], 'butterfly-valve': []
};

const port = (node: string, portId: string): PortEndpoint => ({ type: 'port', node, port: portId });
const cap = (pos: Vec3, label: string): CapEndpoint => ({ type: 'cap', pos, label });

export const PLANT_NODES: PlantNodeDef[] = [
  {
    uid: 'T-101', deviceId: 'fixed-roof-tank', tag: 'T-101', label: '原料储罐', layer: 'L0', step: 'storage',
    pos: [-14.5, 0], anim: 'level', ports: tankPorts,
    role: '储存原料液，经罐底出口和切断阀向进料泵供料。',
    internals: '罐壁、罐顶呼吸阀与玻璃管液位计；罐内为液位缓冲空间（半透明显示）。'
  },
  {
    uid: 'GV-101', deviceId: 'gate-valve', tag: 'GV-101', label: '罐底切断阀', layer: 'L0', step: 'storage',
    pos: [-12.95, 0], ports: [],
    inline: { pipe: 'PL-101', t: 0.52, bodyY: 0.62, valve: 'gate' },
    role: '安装在原料罐出口管线上，检修时切断储罐与下游管线。',
    internals: '明杆楔式闸阀：阀杆升降带动楔形闸板，阀体两端为法兰连接。'
  },
  {
    uid: 'P-101', deviceId: 'pump', tag: 'P-101', label: '原料进料泵', layer: 'L1', step: 'transfer',
    pos: [-9.4, 0], anim: 'pump', ports: DEVICE_PORTS.pump,
    role: '把原料液升压后送入过滤、计量、预热工序。',
    internals: '蜗壳流道、闭式叶轮、机械密封、轴承与电机；液体轴向吸入、切向排出。'
  },
  {
    uid: 'CV-101', deviceId: 'check-valve', tag: 'CV-101', label: '泵出口止回阀', layer: 'L1', step: 'transfer',
    pos: [-8.2, 0], ports: [],
    inline: { pipe: 'PL-102', t: 0.06, bodyY: 0.6, valve: 'check' },
    role: '防止停泵或倒流时液体反向流动。',
    internals: '旋启式止回阀：阀瓣靠介质推动开启，靠自重与倒流关闭。'
  },
  {
    uid: 'ST-101', deviceId: 'y-strainer', tag: 'ST-101', label: '进料过滤器', layer: 'L1', step: 'filtration',
    pos: [-7.35, 0], ports: [],
    inline: { pipe: 'PL-102', t: 0.19, bodyY: 0.5 },
    role: '截留管道中的杂质，保护下游流量计与换热器。',
    internals: 'Y型阀体内的斜置滤网；滤盖可拆下清洗，介质由滤网外侧进入内侧。'
  },
  {
    uid: 'FT-101', deviceId: 'emf-meter', tag: 'FT-101', label: '进料流量计', layer: 'L1', step: 'filtration',
    pos: [-6.5, 0], ports: [],
    inline: { pipe: 'PL-102', t: 0.31, bodyY: 0.6 },
    role: '计量进入系统的原料流量（演示，不显示具体读数）。',
    internals: '测量管、绝缘衬里与一对电极；转换器为演示外观，不接入真实数值。'
  },
  {
    uid: 'BV-101', deviceId: 'ball-valve', tag: 'BV-101', label: '进料切断阀', layer: 'L1', step: 'filtration',
    pos: [-5.65, 0], ports: [],
    inline: { pipe: 'PL-102', t: 0.43, bodyY: 0.62, valve: 'ball' },
    role: '接通或切断进料，配合开停车操作。',
    internals: '法兰球阀：球体带通孔，手柄旋转 90° 实现全开/全关。'
  },
  {
    uid: 'E-101', deviceId: 'plate-exchanger', tag: 'E-101', label: '原料预热器', layer: 'L1', step: 'preheat',
    pos: [-2.4, 0], ports: DEVICE_PORTS['plate-exchanger'],
    role: '用外部热媒预热原料（热媒接管为示意）。',
    internals: '固定端板、12 片换热板片与交替密封垫；冷热流道隔板换热。'
  },
  {
    uid: 'R-101', deviceId: 'reactor', tag: 'R-101', label: '搅拌反应釜', layer: 'L2', step: 'reaction',
    pos: [2.4, 0], rotY: Math.PI, anim: 'agitator', ports: DEVICE_PORTS.reactor,
    role: '辨认主料、辅料、搅拌和夹套。实际反应与换热负荷待确认。',
    internals: '釜体、两层斜桨、4 块挡板、夹套与釜盖机械密封；顶部辅料口用于加料。'
  },
  {
    uid: 'P-102', deviceId: 'gear-pump', tag: 'P-102', label: '辅料加料泵', layer: 'L2', step: 'reaction',
    pos: [1.9, -3.6], anim: 'gearPump', ports: DEVICE_PORTS['gear-pump'], labelLift: 0.4,
    role: '把辅料计量加入反应釜（辅料来源示意）。',
    internals: '泵腔内两个啮合齿轮反向旋转，齿间容积变化完成吸入与排出。'
  },
  {
    uid: 'E-102', deviceId: 'exchanger', tag: 'E-102', label: '反应液冷却器', layer: 'L3', step: 'cooling',
    pos: [5.6, 0], lift: 0.75, ports: DEVICE_PORTS.exchanger,
    role: '冷却反应出料，为后续塔内分离做准备。',
    internals: '固定管板单管程：管束、折流板与两端管板；壳程流体横向冲刷管束。'
  },
  {
    uid: 'T-102', deviceId: 'packed-tower', tag: 'T-102', label: '分离塔', layer: 'L3', step: 'separation',
    pos: [9.6, 0], rotY: Math.PI, anim: 'tower', ports: DEVICE_PORTS['packed-tower'],
    role: '已建进液通路和塔底回收示意。塔处理目的、上升气体来源与热量条件待确认。',
    internals: '可见教学填料床、液体分布器和塔釜。塔内仅示踪下行液体。独立塔顶演示从 PL-108 起。'
  },
  {
    uid: 'E-103', deviceId: 'exchanger', tag: 'E-103', label: '塔顶冷凝器', layer: 'L4', step: 'overhead',
    pos: [12.4, 0], lift: 0.75, ports: DEVICE_PORTS.exchanger,
    role: '冷凝塔顶气相（冷却介质接管为示意）。',
    internals: '与 E-102 同型：塔顶气相走壳程，被管程冷却水冷凝。'
  },
  {
    uid: 'V-102', deviceId: 'gas-separator', tag: 'V-102', label: '气液分离器', layer: 'L4', step: 'overhead',
    pos: [15.2, 0], rotY: Math.PI, anim: 'separator', ports: DEVICE_PORTS['gas-separator'],
    role: '分出塔顶冷凝液与不凝气，冷凝液去精滤，不凝气去尾气处理。',
    internals: '入口挡板、丝网除沫器与集液段；液滴撞板聚结下落，气体经除沫器上升。'
  },
  {
    uid: 'F-101', deviceId: 'bag-filter', tag: 'F-101', label: '产品精滤器', layer: 'L5', step: 'product',
    pos: [12.6, -4.8], ports: DEVICE_PORTS['bag-filter'],
    role: '精滤冷凝液中的细小颗粒，保护产品。',
    internals: '滤袋内进外出、支撑篮承托；杂质截留在袋内，清液从袋壁穿出。'
  },
  {
    uid: 'BV-102', deviceId: 'butterfly-valve', tag: 'BV-102', label: '产品出料阀', layer: 'L5', step: 'product',
    pos: [10.6, -4.8], ports: [],
    inline: { pipe: 'PL-111', t: 0.2, bodyY: 0.6, valve: 'butterfly' },
    role: '控制成品出料，配合成品罐收料。',
    internals: '对夹式蝶阀：圆盘形阀板绕轴旋转，手柄位置对应开度。'
  },
  {
    uid: 'T-103', deviceId: 'fixed-roof-tank', tag: 'T-103', label: '成品储罐', layer: 'L5', step: 'product',
    pos: [6.6, -4.8], anim: 'level', ports: tankPorts, labelLift: 0.3,
    role: '观察精滤液的示意储存位置，实际产品放行标准待确认。',
    internals: '与 T-101 同型：罐体、呼吸阀与玻璃管液位计；透明显示液位。'
  },
  {
    uid: 'CY-101', deviceId: 'cyclone-separator', tag: 'CY-101', label: '尾气旋风分离器', layer: 'L6', step: 'offgas',
    pos: [17.2, -1.8], anim: 'cyclone', ports: DEVICE_PORTS['cyclone-separator'],
    role: '观察离心惯性捕集颗粒或液滴。气相至高点边界，后续处理与排放结果待确认。',
    internals: '筒体 + 锥体：含尘气沿切线进入形成旋流，液滴/颗粒贴壁下行。'
  },
  {
    uid: 'C-101', deviceId: 'screw-compressor', tag: 'C-101', label: '仪表空气压缩机', layer: 'L0', step: 'utility',
    pos: [-14.0, -5.6], anim: 'compressor', ports: DEVICE_PORTS['screw-compressor'],
    role: '提供仪表空气（公用工程示意，不接具体用气点）。',
    internals: '阴阳螺杆转子、机壳与轴承；转子啮合压缩空气。'
  },
  {
    uid: 'P-103', deviceId: 'diaphragm-pump', tag: 'P-103', label: '回收液泵', layer: 'L6', step: 'utility',
    pos: [7.0, -7.8], ports: DEVICE_PORTS['diaphragm-pump'], labelLift: 0.4,
    role: '把塔釜回收液送回原料罐，形成回收循环。',
    internals: '双隔膜、连杆与进/出止回球；压缩空气往复驱动隔膜吸排液体。'
  }
];

export const PIPELINES: PipelineDef[] = [
  {
    id: 'PL-101', name: '原料罐出口管线', from: port('T-101', 'out'), to: port('P-101', 'suction'),
    medium: 'feed', size: 'main', layer: 'L1',
    waypoints: [[-12.95, 0.31, 0], [-12.95, 0.78, 0]],
    note: '罐底出口 → 切断阀 → 泵吸入口。'
  },
  {
    id: 'PL-102', name: '泵出口进料管线', from: port('P-101', 'discharge'), to: port('E-101', 'processIn'),
    medium: 'feed', size: 'main', layer: 'L1',
    waypoints: [[-7.9, 2.35, 0], [-4.55, 2.35, 0], [-4.55, 2.35, -0.16], [-4.55, 0.32, -0.16]],
    note: '泵出口 → 止回 → Y型过滤 → 电磁计量 → 球阀 → 预热器工艺侧。'
  },
  {
    id: 'PL-103', name: '预热后进料管线', from: port('E-101', 'processOut'), to: port('R-101', 'feed'),
    medium: 'feed', size: 'main', layer: 'L2',
    waypoints: [[-3.9, 0.88, -0.16], [-3.9, 1.45, -0.16], [-3.9, 1.45, 0], [0.55, 1.45, 0], [0.55, 0.22, 0]],
    note: '预热器 → 反应釜侧进料口。'
  },
  {
    id: 'PL-104', name: '辅料吸入管线', from: cap([1.9, 0.72, -5.6], '辅料来源（示意）'), to: port('P-102', 'suction'),
    medium: 'aux', size: 'branch', layer: 'L2',
    waypoints: [[1.9, 0.72, -4.9]],
    note: '辅料来源为教学示意，端头盲板封堵。'
  },
  {
    id: 'PL-105', name: '辅料加入管线', from: port('P-102', 'discharge'), to: port('R-101', 'topAux'),
    medium: 'aux', size: 'branch', layer: 'L2',
    waypoints: [[1.9, 2.5, -3.6], [1.9, 2.5, 0], [2.1, 2.5, 0]],
    note: '齿轮泵 → 反应釜顶部辅料口。'
  },
  {
    id: 'PL-106', name: '反应液出料管线', from: port('R-101', 'out'), to: port('E-102', 'shellIn'),
    medium: 'reaction', size: 'main', layer: 'L3',
    waypoints: [[3.65, 0.38, 0], [3.65, 2.9, 0], [4.9, 2.9, 0]],
    note: '反应釜出料 → 冷却器壳程入口（上进口）。'
  },
  {
    id: 'PL-107', name: '冷却后塔进料管线', from: port('E-102', 'shellOut'), to: port('T-102', 'feed'),
    medium: 'reaction', size: 'main', layer: 'L3',
    waypoints: [[7.55, 1.25, 0], [7.55, 2.0, 0]],
    note: '冷却器壳程出口 → 分离塔上部进液口（下进上出）。'
  },
  {
    id: 'PL-108', name: '塔顶气相管线', from: port('T-102', 'overhead'), to: port('E-103', 'shellIn'),
    medium: 'overhead', size: 'main', layer: 'L4',
    waypoints: [[9.6, 2.92, 0], [11.7, 2.92, 0]],
    note: '分离塔顶 → 塔顶冷凝器壳程入口。'
  },
  {
    id: 'PL-109', name: '塔顶冷凝液管线', from: port('E-103', 'shellOut'), to: port('V-102', 'inlet'),
    medium: 'condensate', size: 'main', layer: 'L4',
    waypoints: [],
    note: '冷凝器壳程出口 → 气液分离器入口。'
  },
  {
    id: 'PL-110', name: '冷凝液精滤管线', from: port('V-102', 'liquidOut'), to: port('F-101', 'in'),
    medium: 'product', size: 'main', layer: 'L5',
    waypoints: [[15.2, 0.38, -4.2], [12.6, 0.38, -4.2], [12.6, 1.62, -4.2]],
    note: '分离器底部液相口 → 精滤器顶部进料口。'
  },
  {
    id: 'PL-111', name: '产品出料管线', from: port('F-101', 'out'), to: port('T-103', 'in'),
    medium: 'product', size: 'main', layer: 'L5',
    waypoints: [[11.4, 0.35, -4.8], [11.4, 0.95, -4.8], [8.1, 0.95, -4.8], [8.1, 2.37, -4.8], [7.6, 2.37, -4.8]],
    note: '精滤器 → 蝶阀 → 成品罐罐顶入口。'
  },
  {
    id: 'PL-112', name: '不凝气管线', from: port('V-102', 'gasOut'), to: port('CY-101', 'inlet'),
    medium: 'offgas', size: 'main', layer: 'L6',
    waypoints: [[15.2, 2.62, 0], [17.5, 2.62, 0], [17.5, 2.62, -0.9], [17.5, 1.5, -0.9]],
    note: '分离器顶部气相口 → 旋风分离器切向入口。'
  },
  {
    id: 'PL-113', name: '尾气排放管线', from: port('CY-101', 'gasOut'), to: cap([17.2, 3.5, -1.8], '高点排放（示意）'),
    medium: 'offgas', size: 'branch', layer: 'L6',
    waypoints: [],
    note: '旋风分离器顶部 → 高点排放短管（教学示意，端头盲板）。'
  },
  {
    id: 'PL-114', name: '塔釜回收液管线', from: port('T-102', 'bottoms'), to: port('P-103', 'suction'),
    medium: 'recovery', size: 'main', layer: 'L6',
    waypoints: [[8.25, 0.18, 0], [8.25, 0.36, 0], [8.25, 0.36, -7.8]],
    note: '分离塔釜液口 → 回收泵进口总管。'
  },
  {
    id: 'PL-115', name: '回收液返回管线', from: port('P-103', 'discharge'), to: port('T-101', 'in'),
    medium: 'recovery', size: 'main', layer: 'L6',
    waypoints: [[4.6, 1.08, -7.8], [4.6, 2.45, -7.8], [-14.2, 2.45, -7.8], [-14.2, 2.45, 0]],
    note: '回收泵 → 原料罐罐顶入口，形成回收循环；长距离段设管廊支承。'
  },
  {
    id: 'PL-116', name: '预热器热媒进管', from: cap([-5.0, 0.32, 0.16], '热媒入口（示意）'), to: port('E-101', 'heatIn'),
    medium: 'utility', size: 'utility', layer: 'L1',
    waypoints: [[-4.2, 0.32, 0.16]],
    note: '外部热媒（示意），端头盲板。'
  },
  {
    id: 'PL-116R', name: '预热器热媒回管', from: port('E-101', 'heatOut'), to: cap([-5.0, 0.88, 0.16], '热媒回口（示意）'),
    medium: 'utility', size: 'utility', layer: 'L1',
    waypoints: [[-4.2, 0.88, 0.16]],
    note: '热媒回流（示意）。'
  },
  {
    id: 'PL-117', name: '冷却器冷却水进管', from: cap([4.22, 3.02, 0], '冷却水进（示意）'), to: port('E-102', 'tubeIn'),
    medium: 'utility', size: 'utility', layer: 'L3',
    waypoints: [],
    note: '冷却水走管程（示意），端头盲板。'
  },
  {
    id: 'PL-117R', name: '冷却器冷却水回管', from: port('E-102', 'tubeOut'), to: cap([7.9, 0.57, 0], '冷却水回（示意）'),
    medium: 'utility', size: 'utility', layer: 'L3',
    waypoints: [[7.2, 0.57, 0]],
    note: '冷却水回水（示意）。'
  },
  {
    id: 'PL-118', name: '冷凝器冷却水进管', from: cap([11.02, 3.02, 0], '冷却水进（示意）'), to: port('E-103', 'tubeIn'),
    medium: 'utility', size: 'utility', layer: 'L4',
    waypoints: [],
    note: '冷却水走管程（示意）。'
  },
  {
    id: 'PL-118R', name: '冷凝器冷却水回管', from: port('E-103', 'tubeOut'), to: cap([14.9, 0.57, 0], '冷却水回（示意）'),
    medium: 'utility', size: 'utility', layer: 'L4',
    waypoints: [[14.4, 0.57, 0]],
    note: '冷却水回水（示意）。'
  },
  {
    id: 'PL-119', name: '仪表空气总管', from: port('C-101', 'airOut'), to: cap([-2.6, 2.35, -5.6], '仪表空气（示意）'),
    medium: 'utility', size: 'utility', layer: 'L0',
    waypoints: [[-12.7, 1.05, -5.6], [-12.7, 2.35, -5.6], [-2.6, 2.35, -5.6]],
    note: '压缩机 → 仪表空气总管（示意，不接具体用气点）。'
  },
  {
    id: 'PL-120', name: '反应釜夹套热媒进管', from: cap([0.8, 1.3, 0], '夹套热媒进（示意）'), to: port('R-101', 'jacketIn'),
    medium: 'utility', size: 'utility', layer: 'L2',
    waypoints: [],
    note: '夹套热媒进口（示意）。'
  },
  {
    id: 'PL-121', name: '反应釜夹套热媒回管', from: port('R-101', 'jacketOut'), to: cap([0.8, 0.7, 0], '夹套热媒回（示意）'),
    medium: 'utility', size: 'utility', layer: 'L2',
    waypoints: [],
    note: '夹套热媒出口（示意）。'
  }
];

export const INSTRUMENTS: InstrumentDef[] = [
  { tag: 'PG-101', name: '泵出口压力表', kind: 'pressure', pipe: 'PL-102', t: 0.1, note: '演示仪表，不显示读数。' },
  { tag: 'TI-101', name: '反应液温度计', kind: 'temperature', pipe: 'PL-106', t: 0.5, note: '演示仪表，不显示读数。' },
  { tag: 'PG-102', name: '塔顶气相压力表', kind: 'pressure', pipe: 'PL-108', t: 0.5, note: '演示仪表，不显示读数。' }
];

export const PROCESS_STEPS: ProcessStepDef[] = [
  {
    id: 'storage', no: 1, title: '原料储存与切断', layer: 'L0',
    desc: '原料液储存在立式固定顶储罐；罐底闸阀用于检修隔离，打开后原料进入泵吸入口。',
    nodes: ['T-101', 'GV-101'], pipes: ['PL-101']
  },
  {
    id: 'transfer', no: 2, title: '原料输送', layer: 'L1',
    desc: '离心泵把原料升压；出口止回阀在停泵时阻止液体倒流。',
    nodes: ['P-101', 'CV-101'], pipes: ['PL-102']
  },
  {
    id: 'filtration', no: 3, title: '过滤与计量', layer: 'L1',
    desc: 'Y型过滤器截留杂质，电磁流量计计量（演示），切断阀控制进料。',
    nodes: ['ST-101', 'FT-101', 'BV-101'], pipes: ['PL-102']
  },
  {
    id: 'preheat', no: 4, title: '原料预热', layer: 'L1',
    desc: '板式换热器把工艺液和外部热媒分隔。比较两侧通路，判断预热需要哪些条件。',
    nodes: ['E-101'], pipes: ['PL-102', 'PL-103', 'PL-116']
  },
  {
    id: 'reaction', no: 5, title: '反应', layer: 'L2',
    desc: '在搅拌反应釜辨认原料、齿轮泵辅料和夹套热媒的独立路线。反应物、反应条件和产物均待资料确认。',
    nodes: ['R-101', 'P-102'], pipes: ['PL-103', 'PL-104', 'PL-105']
  },
  {
    id: 'cooling', no: 6, title: '反应液冷却', layer: 'L3',
    desc: '观察管壳式换热器的壳程物料和管程冷却水。冷却水断供时，壳程仍可示踪，出口温度待资料确认。',
    nodes: ['E-102'], pipes: ['PL-106', 'PL-107', 'PL-117']
  },
  {
    id: 'separation', no: 7, title: '塔内分离', layer: 'L3',
    desc: '液体可从上部进入填料段并示踪到塔底。上升气体来源、塔用途与相变条件仍待确认。',
    nodes: ['T-102'], pipes: ['PL-107', 'PL-108', 'PL-114']
  },
  {
    id: 'overhead', no: 8, title: '塔顶冷凝与气液分离', layer: 'L4',
    desc: '独立观察支路用假定可冷凝与不凝组分示踪。冷却水可用时，观察冷凝液侧与气相侧的去向。',
    nodes: ['E-103', 'V-102'], pipes: ['PL-108', 'PL-109', 'PL-118']
  },
  {
    id: 'product', no: 9, title: '产品精制与储存', layer: 'L5',
    desc: '冷凝液经袋式过滤器精滤，蝶阀控制出料进入成品罐。',
    nodes: ['F-101', 'BV-102', 'T-103'], pipes: ['PL-110', 'PL-111']
  },
  {
    id: 'offgas', no: 10, title: '尾气处理', layer: 'L6',
    desc: '旋风分离器演示液滴或颗粒的惯性分离，顶部气相去高点边界。气体成分和排放结果待确认。',
    nodes: ['CY-101'], pipes: ['PL-112', 'PL-113']
  },
  {
    id: 'utility', no: 11, title: '回收与公用工程', layer: 'L6',
    desc: '沿 PL-114 和 PL-115 观察液体回收。原料罐的供料与回液独立演示，回投条件待确认。空压机提供独立仪表空气。',
    nodes: ['P-103', 'C-101'], pipes: ['PL-114', 'PL-115', 'PL-119']
  }
];

export const PLANT_EQUIPMENT_CONTROLS: Readonly<Record<string, 'drive' | 'air' | undefined>> = {
  'P-101': 'drive', 'P-102': 'drive', 'P-103': 'air', 'C-101': 'drive', 'R-101': 'drive'
};

export interface PlantScenario {
  feedAvailable: boolean;
  towerGasDemo: boolean;
  preheatMedium: boolean;
  coolingWater: boolean;
  condenserWater: boolean;
  recoveryAir: boolean;
}

export const DEFAULT_PLANT_SCENARIO: Readonly<PlantScenario> = {
  feedAvailable: true, towerGasDemo: false, preheatMedium: true, coolingWater: true,
  condenserWater: true, recoveryAir: true
};

const UTILITY_SUPPLIES: Readonly<Partial<Record<string, keyof PlantScenario>>> = {
  'PL-116': 'preheatMedium',
  'PL-117': 'coolingWater',
  'PL-118': 'condenserWater'
};

export function plantFlow(
  getValve: (uid: string) => ValveState,
  enabled: (uid: string) => boolean,
  scenario: Readonly<PlantScenario> = DEFAULT_PLANT_SCENARIO
) {
  const routes: Readonly<Record<string, string>> = {
    'E-101.processOut': 'processIn', 'E-101.heatOut': 'heatIn', 'E-102.shellOut': 'shellIn', 'E-102.tubeOut': 'tubeIn',
    'E-103.tubeOut': 'tubeIn', 'R-101.jacketOut': 'jacketIn',
    'T-102.bottoms': 'feed', 'V-102.gasOut': 'inlet', 'V-102.liquidOut': 'inlet',
    'F-101.out': 'in', 'CY-101.gasOut': 'inlet'
  };
  return solveTeachingFlow(PIPELINES, pipeId => valvesOfPipe(pipeId).map(v => ({ at: v.inline!.t, state: getValve(v.uid) })),
    (node, port, inlet) => {
      const outlet = node + '.' + port;
      if (outlet === 'T-101.out') return scenario.feedAvailable ? 2 : 0;
      if (outlet === 'C-101.airOut') return enabled(node) ? 2 : 0;
      if (outlet === 'T-102.overhead') return scenario.towerGasDemo ? 2 : 0;
      if (outlet === 'E-103.shellOut') return inlet(node, 'tubeIn') ? inlet(node, 'shellIn') : 0;
      if (outlet === 'R-101.out') return enabled(node) ? inlet(node, 'feed') : 0;
      if (port === 'discharge' && PLANT_EQUIPMENT_CONTROLS[node]) {
        const hasDrive = node !== 'P-103' || scenario.recoveryAir;
        return enabled(node) && hasDrive ? inlet(node, 'suction') : 0;
      }
      const source = routes[outlet];
      return source ? inlet(node, source) : 0;
    },
    pipe => {
      const utility = UTILITY_SUPPLIES[pipe.id];
      return utility && !scenario[utility] ? 0 : 2;
    });
}

export const PLANT_NOTICE =
  '教学示意流程：设备按通用化工流程连接，位号、管线编号、管径等级、介质颜色与动画均为教学示意，不代表具体产品、工艺参数或工程设计；容器与塔器以半透明显示内部流动示意。';

export { VALVE_STATE_LABEL } from './valveOperations';
export type { ValveKind, ValveState } from './valveOperations';

const NODE_INDEX = new Map(PLANT_NODES.map((n) => [n.uid, n]));
const DEVICE_INDEX = new Map(DEVICES.map((d) => [d.id, d]));
const STEP_INDEX = new Map(PROCESS_STEPS.map((s) => [s.id, s]));
const LAYER_INDEX = new Map(PROCESS_LAYERS.map((l) => [l.id, l]));
const PIPE_INDEX = new Map(PIPELINES.map((p) => [p.id, p]));

export function getNodeByUid(uid: string): PlantNodeDef | undefined {
  return NODE_INDEX.get(uid);
}

export function deviceOfNode(node: PlantNodeDef): DeviceDef {
  const def = DEVICE_INDEX.get(node.deviceId);
  if (!def) throw new Error(`流程节点引用了不存在的设备：${node.deviceId}`);
  return def;
}

export function stepOfNode(node: PlantNodeDef): ProcessStepDef {
  const step = STEP_INDEX.get(node.step);
  if (!step) throw new Error(`流程节点缺少工序：${node.step}`);
  return step;
}

export function layerOfNode(node: PlantNodeDef): ProcessLayerDef {
  const layer = LAYER_INDEX.get(node.layer);
  if (!layer) throw new Error(`流程节点缺少工艺层：${node.layer}`);
  return layer;
}

export function getLayer(id: LayerId): ProcessLayerDef {
  const layer = LAYER_INDEX.get(id);
  if (!layer) throw new Error(`不存在的工艺层：${id}`);
  return layer;
}

export function getPipe(id: string): PipelineDef {
  const pipe = PIPE_INDEX.get(id);
  if (!pipe) throw new Error(`不存在的管线：${id}`);
  return pipe;
}

export function isInlineNode(node: PlantNodeDef): boolean {
  return !!node.inline;
}

export function isValveNode(node: PlantNodeDef): boolean {
  return !!node.inline?.valve;
}

export function portOf(node: PlantNodeDef, portId: string): PortDef | undefined {
  return node.ports.find((p) => p.id === portId);
}

export function endpointNode(endpoint: PipeEndpoint): string | null {
  return endpoint.type === 'port' ? endpoint.node : null;
}

/** 与该设备接口相连的管线（含内联件所在管线） */
export function pipesOfNode(uid: string): PipelineDef[] {
  const node = NODE_INDEX.get(uid);
  if (node?.inline) {
    const host = PIPE_INDEX.get(node.inline.pipe);
    return host ? [host] : [];
  }
  return PIPELINES.filter((p) =>
    (p.from.type === 'port' && p.from.node === uid) || (p.to.type === 'port' && p.to.node === uid)
  );
}

export function inlineNodesOfPipe(pipeId: string): PlantNodeDef[] {
  return PLANT_NODES.filter((n) => n.inline?.pipe === pipeId);
}

export function valvesOfPipe(pipeId: string): PlantNodeDef[] {
  return PLANT_NODES.filter((n) => n.inline?.pipe === pipeId && n.inline.valve);
}

export function instrumentsOfPipe(pipeId: string): InstrumentDef[] {
  return INSTRUMENTS.filter((i) => i.pipe === pipeId);
}

/** 同层设备（按层内顺序） */
export function nodesOfLayer(layerId: LayerId): PlantNodeDef[] {
  const layer = LAYER_INDEX.get(layerId);
  if (!layer) return [];
  return layer.devices.map((uid) => NODE_INDEX.get(uid)).filter((n): n is PlantNodeDef => !!n);
}

export interface TraceResult {
  nodes: Set<string>;
  pipes: Set<string>;
}

/** 沿管线方向追踪上游/下游；不限阀门状态（界面为结构追踪）。 */
export function traceFrom(uid: string, direction: 'up' | 'down' | 'both'): TraceResult {
  const nodes = new Set<string>([uid]);
  const pipes = new Set<string>();
  const start = NODE_INDEX.get(uid);
  if (!start) return { nodes, pipes };

  if (start.inline) {
    const host = PIPE_INDEX.get(start.inline.pipe);
    if (!host) return { nodes, pipes };
    pipes.add(host.id);
    for (const n of inlineNodesOfPipe(host.id)) nodes.add(n.uid);
    const fromNode = host.from.type === 'port' ? host.from.node : null;
    const toNode = host.to.type === 'port' ? host.to.node : null;
    if (fromNode && (direction === 'up' || direction === 'both')) walkTrace(fromNode, 'up', nodes, pipes);
    if (toNode && (direction === 'down' || direction === 'both')) walkTrace(toNode, 'down', nodes, pipes);
    return { nodes, pipes };
  }

  if (direction === 'up' || direction === 'both') walkTrace(uid, 'up', nodes, pipes);
  if (direction === 'down' || direction === 'both') walkTrace(uid, 'down', nodes, pipes);
  return { nodes, pipes };
}

function walkTrace(startUid: string, direction: 'up' | 'down', nodes: Set<string>, pipes: Set<string>) {
  const stack: string[] = [startUid];
  const visited = new Set<string>();
  while (stack.length) {
    const uid = stack.pop()!;
    if (visited.has(uid)) continue;
    visited.add(uid);
    nodes.add(uid);
    const links = direction === 'up'
      ? PIPELINES.filter((p) => p.to.type === 'port' && p.to.node === uid)
      : PIPELINES.filter((p) => p.from.type === 'port' && p.from.node === uid);
    for (const pipe of links) {
      pipes.add(pipe.id);
      for (const inline of inlineNodesOfPipe(pipe.id)) nodes.add(inline.uid);
      const other = direction === 'up'
        ? (pipe.from.type === 'port' ? pipe.from.node : null)
        : (pipe.to.type === 'port' ? pipe.to.node : null);
      if (other) stack.push(other);
    }
  }
}

/** 管线在某设备处连接的接口（用于信息卡） */
export function pipeEndpointAt(pipe: PipelineDef, uid: string, side: 'from' | 'to'): PortEndpoint | null {
  const endpoint = pipe[side];
  if (endpoint.type !== 'port' || endpoint.node !== uid) return null;
  return endpoint;
}

export interface PlantAudit {
  issues: string[];
  counts: { nodes: number; pipes: number; layers: number; steps: number; valves: number; instruments: number };
  nodeConnection: number;
  pipeIntegrity: number;
  flowDirection: number;
  nodeData: number;
  layerCoverage: number;
  internals: number;
  flowReach: number;
}

/** 数据层自检：引用、接口方向、连接率、层覆盖与可达性。 */
export function auditPlantData(): PlantAudit {
  const issues: string[] = [];
  const uidSet = new Set(PLANT_NODES.map((n) => n.uid));
  const pipeIds = new Set(PIPELINES.map((p) => p.id));
  if (uidSet.size !== PLANT_NODES.length) issues.push('存在重复设备位号');
  if (pipeIds.size !== PIPELINES.length) issues.push('存在重复管线编号');

  let connected = 0;
  let dataComplete = 0;
  let internals = 0;
  for (const node of PLANT_NODES) {
    const device = DEVICE_INDEX.get(node.deviceId);
    if (!device) issues.push(`${node.uid} 引用了不存在的设备型号 ${node.deviceId}`);
    if (!STEP_INDEX.has(node.step)) issues.push(`${node.uid} 缺少有效工序`);
    if (!LAYER_INDEX.has(node.layer)) issues.push(`${node.uid} 缺少有效工艺层`);
    if (node.inline && !pipeIds.has(node.inline.pipe)) issues.push(`${node.uid} 内联管线 ${node.inline.pipe} 不存在`);
    if (node.inline?.valve && node.ports.length > 0) issues.push(`${node.uid} 为内联阀门，不应再定义落地接口`);
    if (!node.inline && node.ports.length === 0) issues.push(`${node.uid} 缺少设备接口`);
    for (const p of node.ports) {
      if (!VALID_VEC3(p.pos) || !VALID_VEC3(p.dir)) issues.push(`${node.uid}.${p.id} 接口坐标无效`);
    }
    const links = pipesOfNode(node.uid);
    if (links.length > 0) connected += 1;
    else issues.push(`${node.uid} 是孤立设备（无管线连接）`);
    if (node.layer && node.step && node.role && node.internals) dataComplete += 1;
    if (node.internals) internals += 1;
  }

  let pipeOk = 0;
  let directionOk = 0;
  for (const pipe of PIPELINES) {
    let ok = true;
    for (const endpoint of [pipe.from, pipe.to]) {
      if (endpoint.type === 'port') {
        const node = NODE_INDEX.get(endpoint.node);
        if (!node) { issues.push(`${pipe.id} 引用了不存在的设备 ${endpoint.node}`); ok = false; continue; }
        const pdef = node.ports.find((p) => p.id === endpoint.port);
        if (!pdef) { issues.push(`${pipe.id} 引用了不存在的接口 ${endpoint.node}.${endpoint.port}`); ok = false; }
      } else if (!VALID_VEC3(endpoint.pos)) {
        issues.push(`${pipe.id} 的示意端头坐标无效`);
        ok = false;
      }
    }
    if (!VALID_VEC3S(pipe.waypoints)) { issues.push(`${pipe.id} 存在无效路由点`); ok = false; }
    if (!LAYER_INDEX.has(pipe.layer)) { issues.push(`${pipe.id} 缺少有效工艺层`); ok = false; }
    if (ok) pipeOk += 1;

    let dirOk = true;
    if (pipe.from.type === 'port') {
      const n = NODE_INDEX.get(pipe.from.node);
      const pdef = n?.ports.find((p) => p.id === (pipe.from as PortEndpoint).port);
      if (!pdef || (pdef.role !== 'out' && pdef.role !== 'both')) { issues.push(`${pipe.id} 起点接口不是出口`); dirOk = false; }
    }
    if (pipe.to.type === 'port') {
      const n = NODE_INDEX.get(pipe.to.node);
      const pdef = n?.ports.find((p) => p.id === (pipe.to as PortEndpoint).port);
      if (!pdef || (pdef.role !== 'in' && pdef.role !== 'both')) { issues.push(`${pipe.id} 终点接口不是入口`); dirOk = false; }
    }
    if (dirOk) directionOk += 1;
  }

  for (const layer of PROCESS_LAYERS) {
    for (const uid of layer.devices) {
      const node = NODE_INDEX.get(uid);
      if (!node) issues.push(`${layer.id} 引用了不存在的设备 ${uid}`);
      else if (node.layer !== layer.id) issues.push(`${uid} 的层归属与层清单不一致`);
    }
  }
  for (const step of PROCESS_STEPS) {
    for (const uid of step.nodes) {
      const node = NODE_INDEX.get(uid);
      if (!node) issues.push(`工序「${step.title}」引用了不存在的设备 ${uid}`);
      else if (node.step !== step.id) issues.push(`${uid} 的工序归属与工序清单不一致`);
    }
    for (const pid of step.pipes) if (!pipeIds.has(pid)) issues.push(`工序「${step.title}」引用了不存在的管线 ${pid}`);
  }

  /* 全开阀状态下从供源出发的可达性 */
  const supply = new Set<string>(['T-101', 'C-101']);
  for (const pipe of PIPELINES) if (pipe.from.type === 'cap' && pipe.medium !== 'utility') {
    const to = pipe.to;
    if (to.type === 'port') supply.add(to.node);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const pipe of PIPELINES) {
      if (pipe.from.type !== 'port' || pipe.to.type !== 'port') continue;
      if (!supply.has(pipe.from.node)) continue;
      if (!supply.has(pipe.to.node)) { supply.add(pipe.to.node); changed = true; }
    }
  }
  const processNodes = PLANT_NODES.filter((n) => !n.inline && pipesOfNode(n.uid).some((p) => p.medium !== 'utility'));
  const reachable = processNodes.filter((n) => supply.has(n.uid)).length;

  const n = PLANT_NODES.length || 1;
  return {
    issues,
    counts: {
      nodes: PLANT_NODES.length,
      pipes: PIPELINES.length,
      layers: PROCESS_LAYERS.length,
      steps: PROCESS_STEPS.length,
      valves: PLANT_NODES.filter((node) => !!node.inline?.valve).length,
      instruments: INSTRUMENTS.length
    },
    nodeConnection: Math.round((connected / n) * 100),
    pipeIntegrity: Math.round((pipeOk / Math.max(1, PIPELINES.length)) * 100),
    flowDirection: Math.round((directionOk / Math.max(1, PIPELINES.length)) * 100),
    nodeData: Math.round((dataComplete / n) * 100),
    layerCoverage: Math.round((PROCESS_LAYERS.filter((l) => l.devices.length > 0 && nodesOfLayer(l.id).length > 0).length / PROCESS_LAYERS.length) * 100),
    internals: Math.round((internals / n) * 100),
    flowReach: Math.round((reachable / Math.max(1, processNodes.length)) * 100)
  };
}

function VALID_VEC3(v: Vec3 | undefined): boolean {
  return !!v && v.length === 3 && v.every((x) => Number.isFinite(x));
}
function VALID_VEC3S(list: Vec3[]): boolean {
  return list.every((v) => VALID_VEC3(v));
}
