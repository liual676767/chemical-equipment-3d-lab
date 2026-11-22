import { initialCoatingBatch, type CoatingBatch } from '../process/coatingBatch';
import { solveTeachingFlow } from '../process/teachingFlow';
import { DEVICES } from './devices';
import type { DeviceDef, Vec3 } from './types';
import {
  DEVICE_PORTS, PORT_STUB, PIPE_SIZES, VALVE_STATE_LABEL,
  type PortDef, type PipeSizeId, type InlineMount, type PipeEndpoint, type PortEndpoint,
  type CapEndpoint, type InstrumentDef, type ValveState, type TraceResult, type MediumPhase
} from './plant';

/**
 * 三维教学工厂 · 水性涂料调配车间（教学案例）唯一数据源。
 * 路线：收料与计量投料 → 预混分散 → 调配 → 取样检验放行 → 泵送 → 过滤 → 灌装 → 成品暂存。
 * - 设备接口沿用 plant.ts 的设备局部坐标表（与 devices.ts 零件坐标一致）；
 *   本车间新增的取样口/气源口/排净口为「示意接管」，由场景补画短节；
 * - 管线端点引用设备接口，路由点仅为教学走线，不代表施工设计；
 * - 位号、分区、管径等级与介质色均为教学内部编号/示意，不是工程数据；
 * - 灌装机 / 成品暂存区 / 清洗液收集桶为场景内教学模型，不在设备库 18 台 catalog 中。
 */

export type ZoneId = 'Z0' | 'Z1' | 'Z2' | 'Z3';

export type FactoryMediumId = 'feed' | 'premix' | 'product' | 'packed' | 'sample' | 'air' | 'clean' | 'aux';

export interface FactoryMediumDef {
  id: FactoryMediumId;
  label: string;
  color: number;
  phase: MediumPhase | 'packaged';
  desc: string;
}

export interface FactoryLayerDef {
  id: ZoneId;
  name: string;
  short: string;
  color: number;
  function: string;
  input: string;
  process: string;
  output: string;
  devices: string[];
  /** 地面示意分区（x1,z1,x2,z2），可多块 */
  zones: [number, number, number, number][];
}

export interface FactoryNodeDef {
  uid: string;
  deviceId: string;
  tag: string;
  label: string;
  role: string;
  internals: string;
  layer: ZoneId;
  step: string;
  /** 场景平面坐标（x, z），落地高度自动计算 */
  pos: [number, number];
  rotY?: number;
  lift?: number;
  anim?: 'pump' | 'agitator' | 'compressor' | 'level';
  ports: PortDef[];
  inline?: InlineMount;
  labelLift?: number;
  /** 场景内教学模型（不在设备库 catalog 中，无零件工作台） */
  procedural?: boolean;
}

export interface FactoryPipelineDef {
  id: string;
  name: string;
  from: PipeEndpoint;
  to: PipeEndpoint;
  medium: FactoryMediumId;
  size: PipeSizeId;
  layer: ZoneId;
  waypoints: Vec3[];
  note?: string;
}

export interface FactoryStepDef {
  id: string;
  no: number;
  title: string;
  desc: string;
  layer: ZoneId;
  nodes: string[];
  pipes: string[];
}

/** 可拆卸法兰接头（工位练习入口），挂在管线弧长相对位置 t 处 */
export interface FactoryJointDef {
  id: string;
  pipe: string;
  t: number;
  name: string;
  /** 缺垫片时点名的两个密封面 */
  aLabel: string;
  bLabel: string;
  dn: number;
  note: string;
}

export const FACTORY_META = {
  name: '水性涂料调配车间',
  subtitle: '三维教学工厂 · 教学案例',
  contentVersion: '2026-11-20.1',
  route: '收料与计量投料 → 预混分散 → 调配 → 取样检验放行 → 泵送 → 过滤 → 灌装 → 成品暂存'
};

export const FACTORY_NOTICE =
  '教学示意车间：以水性涂料调配为教学案例组织设备与管线，位号、管线编号、管径等级、介质颜色与动画均为教学示意，不代表具体产品配方、工艺参数或工程设计；取样、清洗与压缩空气边界按教学案例简化。缺少图纸依据的接管与尺寸已标注「教学示意」。';

export { PORT_STUB, PIPE_SIZES, VALVE_STATE_LABEL };
export type { PortDef, PipeSizeId, InlineMount, PipeEndpoint, PortEndpoint, CapEndpoint, InstrumentDef, ValveState, TraceResult };

export const FACTORY_MEDIA: Record<FactoryMediumId, FactoryMediumDef> = {
  feed: { id: 'feed', label: '原料浆料', color: 0x3f7fbf, phase: 'liquid', desc: '原料浆料：原料储罐 → 输送泵 → 计量 → 预混分散罐' },
  premix: { id: 'premix', label: '预混浆', color: 0xc08a3e, phase: 'liquid', desc: '预混浆：预混分散罐 → 转移泵 → 调配罐' },
  product: { id: 'product', label: '成品涂料', color: 0x4d9f78, phase: 'liquid', desc: '已放行的液态涂料：调配罐 → 隔膜泵 → 袋式过滤 → 灌装' },
  packed: { id: 'packed', label: '桶装成品', color: 0x4e8b66, phase: 'packaged', desc: '已灌装的成品桶经示意辊道转出，进入暂存区。' },
  sample: { id: 'sample', label: '样品', color: 0xb5658f, phase: 'liquid', desc: '样品：调配罐取样支管 → 取样口（检验放行）' },
  air: { id: 'air', label: '压缩空气', color: 0xb9a13b, phase: 'utility', desc: '压缩空气：空压机 → 气动双隔膜泵气侧（驱动隔膜往复）' },
  clean: { id: 'clean', label: '清洗液', color: 0x74b7c2, phase: 'liquid', desc: '清洗液：过滤器排净与清洗来液 → 独立收集桶（不外排）' },
  aux: { id: 'aux', label: '粉料/助剂', color: 0x8a7fc0, phase: 'liquid', desc: '粉料/助剂：经投料平台加入预混分散罐（人工投料，教学示意）' }
};

/** 本车间新增的示意接管（设备局部坐标，与既有接口表同一坐标系） */
const REACTOR_SAMPLE: PortDef = {
  id: 'sample', name: '取样口（示意接管）', pos: [0, 0.72, 0.8], dir: [0, 0, 1], role: 'out', size: 'instrument', added: true
};
const DIAPHRAGM_AIR: PortDef = {
  id: 'airIn', name: '压缩空气入口', pos: [0, 0.72, 0.3], dir: [0, 0, 1], role: 'in', size: 'utility', added: true
};
const BAG_DRAIN: PortDef = {
  id: 'drain', name: '底部排净口（示意接管）', pos: [0, 0.12, 0.32], dir: [0, 0, 1], role: 'out', size: 'branch', added: true
};

const FILLER_PORTS: PortDef[] = [
  { id: 'in', name: '进料口（灌装头）', pos: [-0.35, 1.85, 0], dir: [-1, 0, 0], role: 'in', size: 'main' },
  { id: 'out', name: '成品出口（辊道）', pos: [1.6, 0.75, 0], dir: [1, 0, 0], role: 'out', size: 'main' }
];
const STORAGE_PORTS: PortDef[] = [
  { id: 'in', name: '成品入口', pos: [-1.2, 0.5, 0], dir: [-1, 0, 0], role: 'in', size: 'main' }
];
const CLEAN_DRUM_PORTS: PortDef[] = [
  { id: 'in', name: '清洗液入口（桶顶）', pos: [0, 0.95, 0], dir: [0, 1, 0], role: 'in', size: 'branch' },
  { id: 'drainIn', name: '过滤器排净接入', pos: [-0.42, 0.55, 0], dir: [-1, 0, 0], role: 'in', size: 'branch' }
];

/** 场景内教学模型的说明（无设备库档案，信息卡用） */
export const PROCEDURAL_INFO: Record<string, { name: string; use: string; principle: string; structureNote: string }> = {
  filler: {
    name: '灌装机',
    use: '将过滤后的成品涂料定量灌入包装桶。',
    principle: '涂料经过滤器清液口进入灌装头，按设定容积逐桶灌装；成品桶经辊道送出。教学模型不演示具体计量机构。',
    structureNote: '教学示意模型：机架、灌装头、输送辊道与包装桶；内部计量机构未建模（待确认）。'
  },
  'storage-area': {
    name: '成品暂存区',
    use: '接收灌装后的成品桶，分区暂存待出库。',
    principle: '成品桶经辊道进入暂存区，按批次码放于托盘。教学模型仅示意暂存边界。',
    structureNote: '教学示意模型：托盘、成品桶与分区标识；不涉及仓储工程参数。'
  },
  'clean-drum': {
    name: '清洗液收集桶',
    use: '收集过滤器排净与清洗来液，构成独立收集边界。',
    principle: '清洗液与排净液全部进入收集桶，不接入工艺管线、不外排；后续处置不在本案例范围。',
    structureNote: '教学示意模型：收集桶与两个入口；桶体容积与材质待确认。'
  }
};

export const FACTORY_ZONES: FactoryLayerDef[] = [
  {
    id: 'Z0', name: '收料与计量投料区', short: '收料计量', color: 0x5f93c0,
    function: '接收储存原料浆料，升压计量后送入预混分散罐。',
    input: '原料浆料（来料为教学示意）。',
    process: '储罐缓冲 → 罐底切断阀 → 输送泵升压 → 电磁流量计计量 → 投料切断阀。',
    output: '计量后的原料浆料送往预混分散罐。',
    devices: ['T-201', 'GV-201', 'P-201', 'FT-201', 'BV-201'],
    zones: [[-18.5, -6.5, -8.8, -1.5]]
  },
  {
    id: 'Z1', name: '预混与调配区', short: '预混调配', color: 0xc08a3e,
    function: '颜填料预混分散，再调稀均化为成品涂料；取样检验合格后放行。',
    input: '计量原料浆料；粉料/助剂经平台投料口加入（示意）。',
    process: '高速搅拌分散 → 转移泵送 → 调配罐调稀均化 → 取样阀取样送检。',
    output: '检验放行的成品涂料送往泵送过滤区。',
    devices: ['R-201', 'P-203', 'R-202', 'SV-201'],
    zones: [[-8.8, -7.5, 5.4, 0.5]]
  },
  {
    id: 'Z2', name: '泵送与过滤区', short: '泵送过滤', color: 0x4d9f78,
    function: '气动双隔膜泵输送成品涂料，袋式过滤器截留颗粒；清洗液独立收集。',
    input: '放行的成品涂料；压缩空气驱动隔膜泵气侧。',
    process: '泵前切断阀 → 隔膜泵泵送 → 法兰接头 → 袋式过滤 → 排净/清洗液收集。',
    output: '过滤清液送往灌装区；清洗液进收集桶（不外排）。',
    devices: ['BV-202', 'P-202', 'C-201', 'F-201', 'CL-201'],
    zones: [[5.4, -9.8, 15.5, 0.5]]
  },
  {
    id: 'Z3', name: '灌装与暂存区', short: '灌装暂存', color: 0x8a7fc0,
    function: '成品涂料定量灌装，成品桶暂存待出库。',
    input: '过滤后的成品涂料。',
    process: '灌装切断阀 → 灌装头逐桶灌装 → 辊道输送 → 托盘码放。',
    output: '成品桶暂存（出库不在本案例范围）。',
    devices: ['FL-201', 'BV-204', 'ST-201'],
    zones: [[15.5, -3.5, 24.8, 1.5]]
  }
];

export const FACTORY_NODES: FactoryNodeDef[] = [
  {
    uid: 'T-201', deviceId: 'fixed-roof-tank', tag: 'T-201', label: '原料储罐', layer: 'Z0', step: 's1',
    pos: [-16, -4], anim: 'level', ports: DEVICE_PORTS['fixed-roof-tank'],
    role: '储存原料浆料，经罐底出口和切断阀向输送泵供料。',
    internals: '罐壁、罐顶呼吸阀与玻璃管液位计；罐内为液位缓冲空间（半透明显示）。'
  },
  {
    uid: 'GV-201', deviceId: 'gate-valve', tag: 'GV-201', label: '罐底切断阀', layer: 'Z0', step: 's1',
    pos: [-14.43, -4], ports: [],
    inline: { pipe: 'PL-201', t: 0.62, bodyY: 0.62, valve: 'gate' },
    role: '安装在原料罐出口管线上，检修时切断储罐与下游管线。',
    internals: '明杆楔式闸阀：阀杆升降带动楔形闸板，阀体两端为法兰连接。'
  },
  {
    uid: 'P-201', deviceId: 'pump', tag: 'P-201', label: '原料输送泵', layer: 'Z0', step: 's1',
    pos: [-10.8, -4], anim: 'pump', ports: DEVICE_PORTS.pump,
    role: '把原料浆料升压后送入计量与预混分散工序。',
    internals: '蜗壳流道、闭式叶轮、机械密封、轴承与电机；液体轴向吸入、切向排出。'
  },
  {
    uid: 'FT-201', deviceId: 'emf-meter', tag: 'FT-201', label: '计量流量计', layer: 'Z0', step: 's1',
    pos: [-7.9, -4], ports: [],
    inline: { pipe: 'PL-202', t: 0.35, bodyY: 0.6 },
    role: '计量进入预混分散罐的原料浆料流量（演示，不显示具体读数）。',
    internals: '测量管、绝缘衬里与一对电极；转换器为演示外观，不接入真实数值。'
  },
  {
    uid: 'BV-201', deviceId: 'ball-valve', tag: 'BV-201', label: '投料切断阀', layer: 'Z0', step: 's1',
    pos: [-6.93, -4], ports: [],
    inline: { pipe: 'PL-202', t: 0.5, bodyY: 0.62, valve: 'ball' },
    role: '接通或切断投料，配合开停车操作。',
    internals: '法兰球阀：球体带通孔，手柄旋转 90° 实现全开/全关。'
  },
  {
    uid: 'R-201', deviceId: 'reactor', tag: 'R-201', label: '预混分散罐', layer: 'Z1', step: 's2',
    pos: [-5, -4], rotY: Math.PI, anim: 'agitator', ports: DEVICE_PORTS.reactor,
    role: '颜填料与部分基料在此高速搅拌分散，形成预混浆；粉料/助剂经北侧平台投料口加入。',
    internals: '釜体、两层斜桨、4 块挡板与釜盖机械密封；顶部辅料口对应平台投料点（夹套接管本案例未使用）。'
  },
  {
    uid: 'P-203', deviceId: 'pump', tag: 'P-203', label: '预混浆转移泵', layer: 'Z1', step: 's2',
    pos: [0.5, -1], anim: 'pump', ports: DEVICE_PORTS.pump,
    role: '把预混浆从分散罐转移至调配罐（与 P-201 同型，位号不同）。',
    internals: '与 P-201 同型单级离心泵：蜗壳、闭式叶轮、机械密封、轴承与电机。'
  },
  {
    uid: 'R-202', deviceId: 'reactor', tag: 'R-202', label: '调配罐', layer: 'Z1', step: 's3',
    pos: [3, -4], rotY: Math.PI, anim: 'agitator', ports: [...DEVICE_PORTS.reactor, REACTOR_SAMPLE],
    role: '预混浆在此搅拌均化，侧壁取样口接取样支管。辅料加入方式和黏度目标待确认。',
    internals: '与 R-201 同型搅拌罐：釜体、斜桨、挡板与机械密封；取样口为示意接管。'
  },
  {
    uid: 'SV-201', deviceId: 'ball-valve', tag: 'SV-201', label: '取样阀', layer: 'Z1', step: 's4',
    pos: [4.07, -6.0], ports: [],
    inline: { pipe: 'PL-206', t: 0.55, bodyY: 0.62, valve: 'ball' },
    role: '取样支管上的切断阀：开阀取样送检，检验合格后放行泵送。',
    internals: '法兰球阀：球体带通孔，手柄旋转 90° 实现全开/全关；手柄朝向走道侧便于操作。'
  },
  {
    uid: 'BV-202', deviceId: 'ball-valve', tag: 'BV-202', label: '泵前切断阀', layer: 'Z2', step: 's5',
    pos: [4.6, -2.9], ports: [],
    inline: { pipe: 'PL-207', t: 0.35, bodyY: 0.62, valve: 'ball' },
    role: '隔膜泵检修前切断调配罐来料。',
    internals: '法兰球阀：球体带通孔，手柄旋转 90° 实现全开/全关。'
  },
  {
    uid: 'P-202', deviceId: 'diaphragm-pump', tag: 'P-202', label: '气动双隔膜泵', layer: 'Z2', step: 's5',
    pos: [8, -1], rotY: Math.PI, ports: [...DEVICE_PORTS['diaphragm-pump'], DIAPHRAGM_AIR], labelLift: 0.4,
    role: '输送放行的成品涂料至袋式过滤器；压缩空气交替进入气侧推动隔膜。',
    internals: '左右液腔、双隔膜与连杆、进出口止回球、进/出口总管；中间气室前侧为压缩空气入口。'
  },
  {
    uid: 'C-201', deviceId: 'screw-compressor', tag: 'C-201', label: '空压机', layer: 'Z2', step: 's5',
    pos: [8, -8.8], anim: 'compressor', ports: DEVICE_PORTS['screw-compressor'],
    role: '提供压缩空气，经气管接至 P-202 气侧入口。',
    internals: '阴阳螺杆转子、机壳与轴承；转子啮合压缩空气。'
  },
  {
    uid: 'F-201', deviceId: 'bag-filter', tag: 'F-201', label: '袋式过滤器', layer: 'Z2', step: 's6',
    pos: [12, -1], rotY: Math.PI, ports: [...DEVICE_PORTS['bag-filter'], BAG_DRAIN],
    role: '截留成品涂料中的细小颗粒；顶部开盖空间充足，可换袋；底部排净接清洗液收集桶。',
    internals: '滤袋内进外出、支撑篮承托；杂质截留在袋内，清液从袋壁穿出；排净口为示意接管。'
  },
  {
    uid: 'CL-201', deviceId: 'clean-drum', tag: 'CL-201', label: '清洗液收集桶', layer: 'Z2', step: 's6',
    pos: [14.5, -4.5], ports: CLEAN_DRUM_PORTS, procedural: true, labelLift: 0.3,
    role: '收集过滤器排净与清洗来液，独立收集边界，不外排。',
    internals: '教学示意模型：收集桶、桶顶清洗液入口与侧面排净接入；容积与材质待确认。'
  },
  {
    uid: 'FL-201', deviceId: 'filler', tag: 'FL-201', label: '灌装机', layer: 'Z3', step: 's7',
    pos: [17, -1], ports: FILLER_PORTS, procedural: true, labelLift: 0.6,
    role: '过滤清液经灌装头定量灌入包装桶，成品桶经辊道送出。',
    internals: '教学示意模型：机架、灌装头、输送辊道与包装桶；内部计量机构未建模（待确认）。'
  },
  {
    uid: 'BV-204', deviceId: 'ball-valve', tag: 'BV-204', label: '灌装切断阀', layer: 'Z3', step: 's7',
    pos: [15.8, -1], ports: [],
    inline: { pipe: 'PL-209', t: 0.8, bodyY: 0.62, valve: 'ball' },
    role: '灌装启停与检修切断。',
    internals: '法兰球阀：球体带通孔，手柄旋转 90° 实现全开/全关。'
  },
  {
    uid: 'ST-201', deviceId: 'storage-area', tag: 'ST-201', label: '成品暂存区', layer: 'Z3', step: 's8',
    pos: [22.5, -1], ports: STORAGE_PORTS, procedural: true, labelLift: 0.5,
    role: '接收成品桶，按批次托盘码放暂存。',
    internals: '教学示意模型：托盘、成品桶与分区标识；不涉及仓储工程参数。'
  }
];

const port = (node: string, portId: string): PortEndpoint => ({ type: 'port', node, port: portId });
const cap = (pos: Vec3, label: string): CapEndpoint => ({ type: 'cap', pos, label });

export const FACTORY_PIPES: FactoryPipelineDef[] = [
  {
    id: 'PL-201', name: '原料罐出口管线', from: port('T-201', 'out'), to: port('P-201', 'suction'),
    medium: 'feed', size: 'main', layer: 'Z0',
    waypoints: [[-14.55, 0.28, -4], [-14.55, 0.78, -4]],
    note: '罐底出口 → 罐底切断阀 → 泵吸入口。'
  },
  {
    id: 'PL-202', name: '计量投料管线', from: port('P-201', 'discharge'), to: port('R-201', 'feed'),
    medium: 'feed', size: 'main', layer: 'Z0',
    waypoints: [[-6.6, 2.35, -4], [-6.6, 0.22, -4]],
    note: '泵出口 → 流量计计量 → 投料切断阀 → 预混分散罐侧进料口。'
  },
  {
    id: 'PL-203', name: '平台投料口', from: cap([-5.3, 2.9, -4], '平台投料口（教学示意）'), to: port('R-201', 'topAux'),
    medium: 'aux', size: 'branch', layer: 'Z1',
    waypoints: [],
    note: '粉料/助剂经北侧投料平台人工加入（教学示意短管）。'
  },
  {
    id: 'PL-204', name: '预混浆出料管线', from: port('R-201', 'out'), to: port('P-203', 'suction'),
    medium: 'premix', size: 'main', layer: 'Z1',
    waypoints: [[-3.2, 0.38, -4], [-3.2, 0.78, -1]],
    note: '预混分散罐出料 → 转移泵吸入口。'
  },
  {
    id: 'PL-205', name: '预混浆转移管线', from: port('P-203', 'discharge'), to: port('R-202', 'feed'),
    medium: 'premix', size: 'main', layer: 'Z1',
    waypoints: [[1.65, 2.35, -1], [1.65, 2.35, -4], [1.65, 0.22, -4]],
    note: '转移泵出口 → 调配罐侧进料口。'
  },
  {
    id: 'PL-206', name: '取样支管', from: port('R-202', 'sample'), to: cap([5.2, 0.72, -6.0], '取样口（检验放行）'),
    medium: 'sample', size: 'instrument', layer: 'Z1',
    waypoints: [[3, 0.72, -6.0]],
    note: '调配罐取样口 → 取样阀 → 取样口（检验合格后放行泵送）。'
  },
  {
    id: 'PL-207', name: '成品泵送管线', from: port('R-202', 'out'), to: port('P-202', 'suction'),
    medium: 'product', size: 'main', layer: 'Z2',
    waypoints: [[4.6, 0.38, -4], [4.6, 0.78, -4], [4.6, 0.78, -1]],
    note: '调配罐出料 → 泵前切断阀 → 隔膜泵进口总管。'
  },
  {
    id: 'PL-208', name: '过滤进料管线', from: port('P-202', 'discharge'), to: port('F-201', 'in'),
    medium: 'product', size: 'main', layer: 'Z2',
    waypoints: [[10.4, 1.08, -1], [10.4, 1.62, -1]],
    note: '隔膜泵出口总管 → 可拆法兰接头 → 袋式过滤器顶部进料口。'
  },
  {
    id: 'PL-209', name: '灌装管线', from: port('F-201', 'out'), to: port('FL-201', 'in'),
    medium: 'product', size: 'main', layer: 'Z3',
    waypoints: [[14.2, 0.35, -1], [14.2, 1.85, -1]],
    note: '过滤器清液口 → 灌装切断阀 → 灌装头进料口。'
  },
  {
    id: 'PL-210', name: '成品辊道输送线', from: port('FL-201', 'out'), to: port('ST-201', 'in'),
    medium: 'packed', size: 'main', layer: 'Z3',
    waypoints: [[19.9, 0.75, -1], [19.9, 0.5, -1]],
    note: '灌装后的成品桶经辊道输送至暂存区（辊道以管线示意）。'
  },
  {
    id: 'PL-211', name: '压缩空气气管', from: port('C-201', 'airOut'), to: port('P-202', 'airIn'),
    medium: 'air', size: 'utility', layer: 'Z2',
    waypoints: [[9.4, 1.05, -8.8], [9.4, 2.6, -8.8], [9.4, 2.6, -2.2], [8, 2.6, -2.2], [8, 0.72, -2.2]],
    note: '空压机排气 → 管廊架空 → 隔膜泵气侧入口（跨越走道处架空敷设）。'
  },
  {
    id: 'PL-212', name: '过滤器排净管线', from: port('F-201', 'drain'), to: port('CL-201', 'drainIn'),
    medium: 'clean', size: 'branch', layer: 'Z2',
    waypoints: [[12, 0.12, -3.9], [12, 0.55, -4.5]],
    note: '过滤器底部排净 → 清洗液收集桶（独立收集，不外排）。'
  },
  {
    id: 'PL-213', name: '清洗液来液管线', from: cap([16.2, 1.8, -4.5], '清洗液来液（示意）'), to: port('CL-201', 'in'),
    medium: 'clean', size: 'branch', layer: 'Z2',
    waypoints: [[16.2, 1.8, -4.5], [14.5, 1.8, -4.5]],
    note: '清洗液来液（示意端头）→ 收集桶桶顶入口。'
  }
];

export const FACTORY_EQUIPMENT_CONTROLS: Readonly<Record<string, 'drive' | 'air' | undefined>> = {
  'P-201': 'drive', 'P-203': 'drive', 'P-202': 'air', 'C-201': 'drive', 'R-201': 'drive', 'R-202': 'drive'
};

export function factoryFlow(getValve: (uid: string) => ValveState, enabled: (uid: string) => boolean, batch: CoatingBatch) {
  const production = batch.mode === 'production';
  const released = batch.release === 'released';
  const filters = batch.filterCondition !== 'blocked';
  return solveTeachingFlow(FACTORY_PIPES, pipeId => valvesOfPipe(pipeId).map(v => ({ at: v.inline!.t, state: getValve(v.uid) })),
    (node, port, inlet) => {
      switch (node + '.' + port) {
        case 'T-201.out': return production && batch.raw > 0 ? 2 : 0;
        case 'C-201.airOut': return production && enabled(node) ? 2 : 0;
        case 'P-201.discharge': return production && enabled(node) && enabled('R-201') ? inlet(node, 'suction') : 0;
        case 'P-203.discharge': return production && enabled(node) && enabled('R-202') ? inlet(node, 'suction') : 0;
        case 'P-202.discharge': {
          if (!production || !filters || !enabled(node) || !inlet(node, 'airIn')) return 0;
          const material = inlet(node, 'suction');
          return material && batch.filterCondition === 'loaded' ? 1 : material;
        }
        case 'R-201.out': return production && batch.premix > 0 && batch.release === 'awaiting-sample' ? 2 : 0;
        case 'R-202.out': return production && released && batch.blend > 0 ? 2 : 0;
        case 'R-202.sample': return production && enabled(node) && batch.blend > 0 && batch.release === 'awaiting-sample' ? 2 : 0;
        case 'F-201.out': return production && released && filters && batch.filter > 0 ? 2 : 0;
        case 'F-201.drain': return batch.mode === 'drain' && batch.filter > 0 ? 2 : 0;
        case 'FL-201.out': return production && batch.packed > 0 ? 2 : 0;
        default: return 0;
      }
    },
    pipe => {
      if (pipe.id === 'PL-213') return batch.mode === 'rinse' && batch.rinse > 0 ? 2 : 0;
      return production && batch.raw > 0 && enabled('R-201') ? 2 : 0;
    });
}

export const FACTORY_INSTRUMENTS: InstrumentDef[] = [
  { tag: 'PI-201', name: '泵出口压力表', kind: 'pressure', pipe: 'PL-208', t: 0.12, note: '演示仪表，不显示读数。' },
  { tag: 'PI-202', name: '过滤器出口压力表', kind: 'pressure', pipe: 'PL-209', t: 0.55, note: '演示仪表，不显示读数。' },
  { tag: 'TI-201', name: '成品温度表', kind: 'temperature', pipe: 'PL-207', t: 0.7, note: '演示仪表，不显示读数。' }
];

export const FACTORY_JOINTS: FactoryJointDef[] = [
  {
    id: 'JOINT-201', pipe: 'PL-208', t: 0.42, name: '泵出口法兰接头',
    aLabel: '泵侧法兰密封面（P-202 出口）', bLabel: '过滤器侧法兰密封面（F-201 进口）',
    dn: 50,
    note: '泵出口短管与过滤进料管之间的可拆法兰副（DN50 PN16，教学示意）：检修换袋/清泵时在此拆开。'
  }
];

export const FACTORY_STEPS: FactoryStepDef[] = [
  {
    id: 's1', no: 1, title: '收料与计量投料', desc: '原料浆料自储罐经罐底阀、输送泵升压，电磁流量计计量后送入预混分散罐。',
    layer: 'Z0', nodes: ['T-201', 'GV-201', 'P-201', 'FT-201', 'BV-201'], pipes: ['PL-201', 'PL-202']
  },
  {
    id: 's2', no: 2, title: '预混分散', desc: '颜填料与部分基料高速搅拌分散成预混浆；粉料/助剂经平台投料口加入，转移泵送调配罐。',
    layer: 'Z1', nodes: ['R-201', 'P-203'], pipes: ['PL-203', 'PL-204']
  },
  {
    id: 's3', no: 3, title: '调配', desc: '预混浆在调配罐中物理混合与均化。乳液、助剂加入路径和实际黏度判据待核。取样后暂停加入新预混浆。',
    layer: 'Z1', nodes: ['R-202'], pipes: ['PL-205']
  },
  {
    id: 's4', no: 4, title: '取样检验放行', desc: '在 R-202 练习取样并选择教学放行或暂缓。SV-201 关闭时取样受阻，暂缓时物料留在调配罐。',
    layer: 'Z1', nodes: ['SV-201'], pipes: ['PL-206']
  },
  {
    id: 's5', no: 5, title: '泵送', desc: '气动双隔膜泵输送成品涂料，空压机提供压缩空气驱动气侧。',
    layer: 'Z2', nodes: ['BV-202', 'P-202', 'C-201'], pipes: ['PL-207', 'PL-211']
  },
  {
    id: 's6', no: 6, title: '过滤', desc: '袋式过滤器截留颗粒，阻力增大影响液侧示踪。滤器排净 PL-212 和独立清洗来液 PL-213 分别进入 CL-201。',
    layer: 'Z2', nodes: ['F-201', 'CL-201'], pipes: ['PL-208', 'PL-212', 'PL-213']
  },
  {
    id: 's7', no: 7, title: '灌装', desc: '教学放行的过滤液经灌装切断阀进入灌装头。推进后，灌装桶先留在灌装工位。',
    layer: 'Z3', nodes: ['FL-201', 'BV-204'], pipes: ['PL-209']
  },
  {
    id: 's8', no: 8, title: '成品暂存', desc: '已灌装的成品桶在下一轮推进时经 PL-210 教学辊道进入暂存区。',
    layer: 'Z3', nodes: ['ST-201'], pipes: ['PL-210']
  }
];

const NODE_INDEX = new Map(FACTORY_NODES.map((n) => [n.uid, n]));
const DEVICE_INDEX = new Map(DEVICES.map((d) => [d.id, d]));
const STEP_INDEX = new Map(FACTORY_STEPS.map((s) => [s.id, s]));
const ZONE_INDEX = new Map(FACTORY_ZONES.map((z) => [z.id, z]));
const PIPE_INDEX = new Map(FACTORY_PIPES.map((p) => [p.id, p]));
const JOINT_INDEX = new Map(FACTORY_JOINTS.map((j) => [j.id, j]));

export function getNodeByUid(uid: string): FactoryNodeDef | undefined {
  return NODE_INDEX.get(uid);
}

/** 设备库档案（场景内教学模型返回 null） */
export function catalogDeviceOfNode(node: FactoryNodeDef): DeviceDef | null {
  return DEVICE_INDEX.get(node.deviceId) ?? null;
}

export function stepOfNode(node: FactoryNodeDef): FactoryStepDef {
  const step = STEP_INDEX.get(node.step);
  if (!step) throw new Error(`工厂节点缺少工序：${node.step}`);
  return step;
}

export function zoneOfNode(node: FactoryNodeDef): FactoryLayerDef {
  const zone = ZONE_INDEX.get(node.layer);
  if (!zone) throw new Error(`工厂节点缺少分区：${node.layer}`);
  return zone;
}

export function getZone(id: ZoneId): FactoryLayerDef {
  const zone = ZONE_INDEX.get(id);
  if (!zone) throw new Error(`不存在的分区：${id}`);
  return zone;
}

export function getPipe(id: string): FactoryPipelineDef {
  const pipe = PIPE_INDEX.get(id);
  if (!pipe) throw new Error(`不存在的管线：${id}`);
  return pipe;
}

export function getJoint(id: string): FactoryJointDef | undefined {
  return JOINT_INDEX.get(id);
}

export function jointsOfPipe(pipeId: string): FactoryJointDef[] {
  return FACTORY_JOINTS.filter((j) => j.pipe === pipeId);
}

export function isInlineNode(node: FactoryNodeDef): boolean {
  return !!node.inline;
}

export function isValveNode(node: FactoryNodeDef): boolean {
  return !!node.inline?.valve;
}

export function portOf(node: FactoryNodeDef, portId: string): PortDef | undefined {
  return node.ports.find((p) => p.id === portId);
}

export function endpointNode(endpoint: PipeEndpoint): string | null {
  return endpoint.type === 'port' ? endpoint.node : null;
}

export function pipesOfNode(uid: string): FactoryPipelineDef[] {
  const node = NODE_INDEX.get(uid);
  if (node?.inline) {
    const host = PIPE_INDEX.get(node.inline.pipe);
    return host ? [host] : [];
  }
  return FACTORY_PIPES.filter((p) =>
    (p.from.type === 'port' && p.from.node === uid) || (p.to.type === 'port' && p.to.node === uid)
  );
}

export function inlineNodesOfPipe(pipeId: string): FactoryNodeDef[] {
  return FACTORY_NODES.filter((n) => n.inline?.pipe === pipeId);
}

export function valvesOfPipe(pipeId: string): FactoryNodeDef[] {
  return FACTORY_NODES.filter((n) => n.inline?.pipe === pipeId && n.inline.valve);
}

export function instrumentsOfPipe(pipeId: string): InstrumentDef[] {
  return FACTORY_INSTRUMENTS.filter((i) => i.pipe === pipeId);
}

export function nodesOfZone(zoneId: ZoneId): FactoryNodeDef[] {
  const zone = ZONE_INDEX.get(zoneId);
  if (!zone) return [];
  return zone.devices.map((uid) => NODE_INDEX.get(uid)).filter((n): n is FactoryNodeDef => !!n);
}

export interface DownstreamLink {
  pipe: FactoryPipelineDef;
  node: FactoryNodeDef;
}

/** 沿下游的下一台设备（内联件从所在管线的终点继续） */
export function downstreamTargets(uid: string): DownstreamLink[] {
  const node = NODE_INDEX.get(uid);
  if (!node) return [];
  const pipes = node.inline
    ? [PIPE_INDEX.get(node.inline.pipe)].filter((p): p is FactoryPipelineDef => !!p)
    : FACTORY_PIPES.filter((p) => p.from.type === 'port' && p.from.node === uid);
  const links: DownstreamLink[] = [];
  for (const pipe of pipes) {
    if (pipe.to.type !== 'port') continue;
    const target = NODE_INDEX.get(pipe.to.node);
    if (target) links.push({ pipe, node: target });
  }
  return links;
}

/** 沿上游的上一台设备 */
export function upstreamTargets(uid: string): DownstreamLink[] {
  const node = NODE_INDEX.get(uid);
  if (!node) return [];
  const pipes = node.inline
    ? [PIPE_INDEX.get(node.inline.pipe)].filter((p): p is FactoryPipelineDef => !!p)
    : FACTORY_PIPES.filter((p) => p.to.type === 'port' && p.to.node === uid);
  const links: DownstreamLink[] = [];
  for (const pipe of pipes) {
    if (pipe.from.type !== 'port') continue;
    const target = NODE_INDEX.get(pipe.from.node);
    if (target) links.push({ pipe, node: target });
  }
  return links;
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
      ? FACTORY_PIPES.filter((p) => p.to.type === 'port' && p.to.node === uid)
      : FACTORY_PIPES.filter((p) => p.from.type === 'port' && p.from.node === uid);
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

export function pipeEndpointAt(pipe: FactoryPipelineDef, uid: string, side: 'from' | 'to'): PortEndpoint | null {
  const endpoint = pipe[side];
  if (endpoint.type !== 'port' || endpoint.node !== uid) return null;
  return endpoint;
}

export interface FactoryAudit {
  issues: string[];
  counts: { nodes: number; pipes: number; zones: number; steps: number; valves: number; instruments: number; joints: number };
  nodeConnection: number;
  pipeIntegrity: number;
  flowDirection: number;
  nodeData: number;
  zoneCoverage: number;
  internals: number;
  flowReach: number;
}

/** 数据层自检：引用、接口方向、连接率、分区覆盖与可达性。 */
export function auditFactoryData(): FactoryAudit {
  const issues: string[] = [];
  const uidSet = new Set(FACTORY_NODES.map((n) => n.uid));
  const pipeIds = new Set(FACTORY_PIPES.map((p) => p.id));
  if (uidSet.size !== FACTORY_NODES.length) issues.push('存在重复设备位号');
  if (pipeIds.size !== FACTORY_PIPES.length) issues.push('存在重复管线编号');

  let connected = 0;
  let dataComplete = 0;
  let internals = 0;
  for (const node of FACTORY_NODES) {
    if (!node.procedural && !DEVICE_INDEX.has(node.deviceId)) issues.push(`${node.uid} 引用了不存在的设备型号 ${node.deviceId}`);
    if (node.procedural && !PROCEDURAL_INFO[node.deviceId]) issues.push(`${node.uid} 缺少教学模型说明 ${node.deviceId}`);
    if (!STEP_INDEX.has(node.step)) issues.push(`${node.uid} 缺少有效工序`);
    if (!ZONE_INDEX.has(node.layer)) issues.push(`${node.uid} 缺少有效分区`);
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
  for (const pipe of FACTORY_PIPES) {
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
    if (!ZONE_INDEX.has(pipe.layer)) { issues.push(`${pipe.id} 缺少有效分区`); ok = false; }
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

  for (const joint of FACTORY_JOINTS) {
    if (!pipeIds.has(joint.pipe)) issues.push(`接头 ${joint.id} 引用了不存在的管线 ${joint.pipe}`);
    if (joint.t <= 0 || joint.t >= 1) issues.push(`接头 ${joint.id} 位置超出管线范围`);
  }

  for (const zone of FACTORY_ZONES) {
    for (const uid of zone.devices) {
      const node = NODE_INDEX.get(uid);
      if (!node) issues.push(`${zone.id} 引用了不存在的设备 ${uid}`);
      else if (node.layer !== zone.id) issues.push(`${uid} 的分区归属与分区清单不一致`);
    }
  }
  for (const step of FACTORY_STEPS) {
    for (const uid of step.nodes) {
      const node = NODE_INDEX.get(uid);
      if (!node) issues.push(`工序「${step.title}」引用了不存在的设备 ${uid}`);
      else if (node.step !== step.id) issues.push(`${uid} 的工序归属与工序清单不一致`);
    }
    for (const pid of step.pipes) if (!pipeIds.has(pid)) issues.push(`工序「${step.title}」引用了不存在的管线 ${pid}`);
  }

  const ready = { ...initialCoatingBatch(), premix: 1, filter: 1 };
  const examples: CoatingBatch[] = [ready, { ...ready, release: 'released' }, { ...ready, mode: 'drain' }, { ...ready, mode: 'rinse' }];
  const reached = new Set<string>(['T-201']);
  for (const batch of examples) {
    const { flows } = factoryFlow(() => 'open', () => true, batch);
    for (const pipe of FACTORY_PIPES) {
      if (pipe.medium !== 'air' && pipe.to.type === 'port' && flows.get(pipe.id)?.state === 'full') reached.add(pipe.to.node);
    }
  }
  const processNodes = FACTORY_NODES.filter(n => !n.inline && pipesOfNode(n.uid).some(p => p.medium !== 'air'));
  const reachable = processNodes.filter(n => reached.has(n.uid)).length;

  const n = FACTORY_NODES.length || 1;
  return {
    issues,
    counts: {
      nodes: FACTORY_NODES.length,
      pipes: FACTORY_PIPES.length,
      zones: FACTORY_ZONES.length,
      steps: FACTORY_STEPS.length,
      valves: FACTORY_NODES.filter((node) => !!node.inline?.valve).length,
      instruments: FACTORY_INSTRUMENTS.length,
      joints: FACTORY_JOINTS.length
    },
    nodeConnection: Math.round((connected / n) * 100),
    pipeIntegrity: Math.round((pipeOk / Math.max(1, FACTORY_PIPES.length)) * 100),
    flowDirection: Math.round((directionOk / Math.max(1, FACTORY_PIPES.length)) * 100),
    nodeData: Math.round((dataComplete / n) * 100),
    zoneCoverage: Math.round((FACTORY_ZONES.filter((z) => z.devices.length > 0 && nodesOfZone(z.id).length > 0).length / FACTORY_ZONES.length) * 100),
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