/**
 * 微沸喷烧全流程（教学示意）唯一数据源 · Phase 3 数据。
 *
 * 依据：用户提供的《DeepSeek Coding Agent 专用开发总指令》§5、§11、§18、§20、§45
 * 中的微沸喷烧流程清单（2026-11-18）。Phase 1 建立流程数据关系，Phase 2 建立
 * 设备外部教学模型与接口/连接关系，Phase 3 为 13 条拓扑管线补充教学示意路由配置
 * （管径等级、示意阀、支架间距上限）；管道路由坐标由布局程序生成。Phase 4 的阀门状态、
 * 示踪粒子与流向箭头由独立运行时模块（process/fluid.ts、engine/boilFluid.ts）实现，
 * 不写入本数据。Phase 5 为五个工艺区补充区域说明、管线/流线归属、上下游与教学说明；
 * 区域三维范围由教学布局与设备包络推导（process/areas.ts），不手写工程坐标。
 *
 * 重要边界：
 * - 设备名称与顺序严格按源清单，不增删、不改名、不编造工艺；
 * - 温度、压力、流量、浓度、pH、烟气成分、处理能力、停留时间、型号、厂家、
 *   材料牌号等均未提供，本模型不设置这些字段；
 * - 四根喷枪与二燃室/回转窑的接入关系、炉塞泵结构类型、物料流/烟气流分界点
 *   均标 pending-confirmation，不强行连死；
 * - 集冷塔/急冷塔、综合塔/中合塔的原文写法差异已登记在 gaps 中；
 * - 设备外形比例、教学布局、管线走向、阀门型式/位置、支架间距均为教学示意，
 *   不是工程坐标、管道设计或制造依据。
 */

import type {
  EquipmentInstanceDef,
  FlowStreamDef,
  MediumDef,
  PipelineDef,
  PortDef,
  ProcessAreaDef,
  ProcessDefinition,
  ProcessGap,
  ProcessStepDef
} from './processTypes';

function port(
  id: string,
  name: string,
  role: PortDef['role'],
  media: string[],
  opts: Partial<Omit<PortDef, 'id' | 'name' | 'role' | 'media'>> = {}
): PortDef {
  const gapIds = ['gap-no-interface-details', ...(opts.gapIds ?? [])];
  return { ...opts, id, name, role, media, dataStatus: opts.dataStatus ?? 'teaching-demo', gapIds };
}

const SOURCE_BASE = '名称与流程位置来自用户提供的微沸喷烧流程清单（2026-11-18）；具体结构、型号与工艺参数未提供，不推测。外部模型比例、教学布局与接口位置均为教学示意，不是工程坐标。';
const PIPE_NOTE = '教学模型采用正交管线走向、端部法兰、弯头、示意阀与支架；管径等级、阀门型式与位置、支架间距均未从来源确认，不能作为工程管道设计、采购或施工依据。';

function routeConfig(valveKind: 'gate' | 'butterfly'): NonNullable<PipelineDef['route']> {
  return {
    size: 'main',
    valve: {
      kind: valveKind,
      note:
        valveKind === 'gate'
          ? '教学示意闸阀；型式与位置未从来源确认，仅用于结构认知。'
          : '教学示意蝶阀；型式与位置未从来源确认，仅用于结构认知。',
      dataStatus: 'pending-confirmation'
    },
    supportMaxSpacing: 4.5,
    dataStatus: 'teaching-demo'
  };
}

export const BOIL_GAPS: ProcessGap[] = [
  {
    id: 'gap-smp-details',
    subject: 'SMP 装置组成与内部结构',
    detail: '源清单只给出“SMP 装置”名称，未说明其组成、内部结构与本流程中的具体作用；本阶段按一个教学单元处理，不拆解、不推测。',
    affects: ['eq-smp']
  },
  {
    id: 'gap-furnace-pump-type',
    subject: '炉塞泵结构类型',
    detail: '源清单只给出“炉塞泵”名称，未说明是否为柱塞泵、螺杆泵或其他型式，也未提供结构原理；不推测、不改名，待现场确认。',
    affects: ['eq-furnace-pump']
  },
  {
    id: 'gap-spray-gun-connection',
    subject: '四根喷枪的接入关系',
    detail: '四根喷枪与二燃室/回转窑的接入位置、各喷枪分配、喷入介质与来源均未确认；本阶段不建立喷枪与二燃室/回转窑的硬连接。',
    affects: ['eq-secondary-chamber', 'eq-spray-gun-01', 'eq-spray-gun-02', 'eq-spray-gun-03', 'eq-spray-gun-04', 'eq-rotary-kiln', 'step-06-spray-guns']
  },
  {
    id: 'gap-combustion-boundary',
    subject: '物料流与烟气流的分界点',
    detail: '源清单把二燃室同时作为物料流末端与烟气流起点；二燃室内部的转换点、内部结构与燃烧组织未提供，本阶段按教学边界处理。',
    affects: ['eq-secondary-chamber', 'flow-material', 'flow-flue-gas', 'step-05-secondary-chamber']
  },
  {
    id: 'gap-quench-naming',
    subject: '集冷塔 / 急冷塔命名差异',
    detail: '源清单 §5 写作“急冷塔一/二”，§11、§18、§45 写作“集冷塔一/二”；本阶段采用“集冷塔”，最终名称与设备型式待确认，不擅自统一为工程名称。',
    affects: ['eq-quench-1', 'eq-quench-2', 'step-08-quench-1', 'step-10-quench-2']
  },
  {
    id: 'gap-tower-naming',
    subject: '综合塔 / 中合塔命名与塔型',
    detail: '源清单 §5 写作“中合塔”，其余章节写作“综合塔”；具体塔型、吸收/中和工艺与内部结构未提供，本阶段采用“综合塔”，待确认。',
    affects: ['eq-comprehensive-tower', 'step-11-comprehensive-tower']
  },
  {
    id: 'gap-no-pipeline-details',
    subject: '管线明细',
    detail: '源清单未提供管径、路由、阀门、仪表、支架、管件、坡度与流向控制点；模型示意正交路由、法兰、弯头、示意阀与支架，但管径等级、阀门型式/位置、支架间距与管件配置仍无来源资料，不做工程管道设计。',
    affects: ['pipe-material-01', 'pipe-material-02', 'pipe-material-03', 'pipe-material-04', 'pipe-gas-01', 'pipe-gas-02', 'pipe-gas-03', 'pipe-gas-04', 'pipe-gas-05', 'pipe-gas-06', 'pipe-gas-07', 'pipe-gas-08', 'pipe-gas-09']
  },
  {
    id: 'gap-piping-teaching-geometry',
    subject: '工业管道教学示意几何',
    detail: '模型中的管线走向、正交车道、弯头/法兰、阀门型式与位置、支架位置与间距均为教学示意，用于结构认知；源清单未提供管道设计、阀门配置或支架设计资料，不能作为工程管道设计、采购、施工或安全评价依据。三通与变径仅做部件库演示，本流程拓扑无分支/变径需求，未放置。',
    affects: ['pipe-material-01', 'pipe-material-02', 'pipe-material-03', 'pipe-material-04', 'pipe-gas-01', 'pipe-gas-02', 'pipe-gas-03', 'pipe-gas-04', 'pipe-gas-05', 'pipe-gas-06', 'pipe-gas-07', 'pipe-gas-08', 'pipe-gas-09']
  },
  {
    id: 'gap-teaching-layout',
    subject: '设备教学布局与避让盒',
    detail: '18 个设备实例的平面位置、朝向、间距与管廊车道为教学示意坐标，不是装置总平面图或现场安装定位；设备避让盒为简化包络（不含接管法兰/爬梯/附属件），只用于路由穿模检查，不表示设备真实外形包络。',
    affects: ['eq-smp', 'eq-crusher', 'eq-mixer', 'eq-furnace-pump', 'eq-secondary-chamber', 'eq-spray-gun-01', 'eq-spray-gun-02', 'eq-spray-gun-03', 'eq-spray-gun-04', 'eq-rotary-kiln', 'eq-quench-1', 'eq-baghouse', 'eq-quench-2', 'eq-comprehensive-tower', 'eq-wash-tower', 'eq-wet-esp', 'eq-id-fan', 'eq-stack']
  },
  {
    id: 'gap-no-process-parameters',
    subject: '工艺参数',
    detail: '温度、压力、流量、浓度、pH、烟气成分、处理能力、停留时间等均未提供；本数据模型不设置这些字段，界面后续也不得显示假数值。',
    affects: ['flow-material', 'flow-flue-gas', 'media-material', 'media-flue-gas', 'eq-stack']
  },
  {
    id: 'gap-no-models',
    subject: '设备内部结构缺口',
    detail: '18 个实例均可观察外部教学模型。部分设备可切换内部观察，实物内部结构、可拆件与检修细节仍待确认。',
    affects: ['eq-smp', 'eq-crusher', 'eq-mixer', 'eq-furnace-pump', 'eq-secondary-chamber', 'eq-spray-gun-01', 'eq-spray-gun-02', 'eq-spray-gun-03', 'eq-spray-gun-04', 'eq-rotary-kiln', 'eq-quench-1', 'eq-baghouse', 'eq-quench-2', 'eq-comprehensive-tower', 'eq-wash-tower', 'eq-wet-esp', 'eq-id-fan', 'eq-stack']
  },
  {
    id: 'gap-no-interface-details',
    subject: '设备接口型式与法兰标准',
    detail: '源清单未提供设备接管口的型式、法兰标准、公称尺寸、密封面与接口朝向；模型采用教学示意法兰接口，不能作为采购、施工或安全评价依据。',
    affects: ['eq-smp', 'eq-crusher', 'eq-mixer', 'eq-furnace-pump', 'eq-secondary-chamber', 'eq-spray-gun-01', 'eq-spray-gun-02', 'eq-spray-gun-03', 'eq-spray-gun-04', 'eq-rotary-kiln', 'eq-quench-1', 'eq-baghouse', 'eq-quench-2', 'eq-comprehensive-tower', 'eq-wash-tower', 'eq-wet-esp', 'eq-id-fan', 'eq-stack']
  },
  {
    id: 'gap-model-proportions',
    subject: '教学模型比例与外形',
    detail: '14 类设备外部模型为参数化低面数教学模型，外形比例、支腿/裙座、开孔位置与接口朝向均为教学示意；无设备图纸、总图或实物测绘，不代表工程尺寸。',
    affects: ['eq-smp', 'eq-crusher', 'eq-mixer', 'eq-furnace-pump', 'eq-secondary-chamber', 'eq-spray-gun-01', 'eq-spray-gun-02', 'eq-spray-gun-03', 'eq-spray-gun-04', 'eq-rotary-kiln', 'eq-quench-1', 'eq-baghouse', 'eq-quench-2', 'eq-comprehensive-tower', 'eq-wash-tower', 'eq-wet-esp', 'eq-id-fan', 'eq-stack']
  },
  {
    id: 'gap-no-aux-systems',
    subject: '辅助系统',
    detail: '冷却水、喷淋液、压缩空气、输灰、检修与安全设施等未在源清单中说明；本阶段不建，后续按现场资料补充。',
    affects: ['area-03-cooling', 'area-04-wet', 'eq-quench-1', 'eq-quench-2', 'eq-baghouse', 'eq-wash-tower', 'eq-wet-esp']
  },
  {
    id: 'gap-external-boundary',
    subject: '流程边界',
    detail: '首端来料来源与末端排放去向/后续处理未提供；本阶段按流程边界接口处理，不做外部装置，也不假定排放达标。',
    affects: ['eq-smp', 'eq-stack', 'flow-material', 'flow-flue-gas']
  },
  {
    id: 'gap-no-tagging',
    subject: '工程位号规则',
    detail: '源清单未提供工程位号/编号规则；本阶段使用教学内部 ID（eq-*、pipe-*、step-*），不生成工程位号，也不声称对应现场编号。',
    affects: []
  },
  {
    id: 'gap-material-state',
    subject: '物料与喷入介质状态',
    detail: '物料状态（固体/液体/混合）、物性与喷枪喷入介质成分均未提供；界面的介质分类用于识别流程，不代表真实物性。',
    affects: ['media-material', 'media-spray-medium', 'eq-spray-gun-01', 'eq-spray-gun-02', 'eq-spray-gun-03', 'eq-spray-gun-04']
  }
];

export const BOIL_MEDIA: MediumDef[] = [
  {
    id: 'media-material',
    label: '物料（教学示意）',
    phase: 'mixed',
    color: 0x3f7fbf,
    dataStatus: 'pending-confirmation',
    description: 'SMP → 破碎机 → 混合器 → 炉塞泵 → 二燃室的物料流；物料状态、成分与物性未提供，待现场确认。',
    gapIds: ['gap-material-state', 'gap-no-process-parameters']
  },
  {
    id: 'media-flue-gas',
    label: '烟气（教学示意）',
    phase: 'gas',
    color: 0x8a95a3,
    dataStatus: 'pending-confirmation',
    description: '二燃室 → 回转窑 → 冷却除尘 → 湿法净化 → 引风机 → 烟囱的烟气流；温度、成分、流量等参数未提供，待现场确认。',
    gapIds: ['gap-no-process-parameters']
  },
  {
    id: 'media-spray-medium',
    label: '喷枪喷入介质（待确认）',
    phase: 'mixed',
    color: 0xb5658f,
    dataStatus: 'pending-confirmation',
    description: '四根喷枪的喷入介质、来源与配比未提供；本阶段不建立喷枪与二燃室/回转窑的硬连接。',
    gapIds: ['gap-material-state', 'gap-spray-gun-connection']
  }
];

const AREA_BOUNDS_NOTE =
  '三维范围由本区设备的教学布局与模型包络推导（含教学缓冲），只用于镜头定位与区域高亮，不是装置分区图或工程坐标。';

export const BOIL_AREAS: ProcessAreaDef[] = [
  {
    id: 'area-01-prep',
    no: 1,
    name: '物料准备区',
    description: '流程首端：外部来料进入 SMP 装置，经破碎机、混合器后由炉塞泵送往燃烧处理区（教学示意）。',
    function: '物料的接收、破碎、混合与输送（教学示意）。',
    input: '外部来料（来源未提供，按流程边界处理）。',
    process: 'SMP 装置 → 破碎机 → 混合器 → 炉塞泵。',
    output: '物料经炉塞泵送往二燃室。',
    equipmentInstanceIds: ['eq-smp', 'eq-crusher', 'eq-mixer', 'eq-furnace-pump'],
    stepIds: ['step-01-smp', 'step-02-crusher', 'step-03-mixer', 'step-04-furnace-pump'],
    pipelineIds: ['pipe-material-01', 'pipe-material-02', 'pipe-material-03'],
    flowStreamIds: ['flow-material'],
    upstreamAreaIds: [],
    downstreamAreaIds: ['area-02-combustion'],
    boundsNote: AREA_BOUNDS_NOTE,
    teaching: {
      objective: '把外部来料按 SMP 装置 → 破碎机 → 混合器 → 炉塞泵的顺序完成接收、破碎、混合与输送。',
      effect: '为燃烧处理区提供物料（教学示意）；物料状态、物性与处理能力未提供。',
      relation: '上游为外部来料（流程边界，来源待确认）；下游为燃烧处理区；跨区管线为炉塞泵 → 二燃室。',
      pendingNote: 'SMP 组成、炉塞泵型式、物料状态与来料来源均待确认；本区不设温度、压力、流量等工艺参数。'
    },
    dataStatus: 'teaching-demo',
    gapIds: ['gap-smp-details', 'gap-furnace-pump-type', 'gap-external-boundary']
  },
  {
    id: 'area-02-combustion',
    no: 2,
    name: '燃烧处理区',
    description: '物料进入二燃室，四根喷枪作为二燃室的四个独立平行支路（接入位置与喷入介质待确认），烟气经回转窑进入冷却与除尘区（教学示意）。',
    function: '物料的燃烧处理与烟气生成（教学示意）。',
    input: '来自物料准备区的物料；喷枪喷入介质（成分与来源待确认）。',
    process: '二燃室 → 回转窑；四根喷枪为二燃室的关联支路（不串联、不建立已确认硬连接）。',
    output: '烟气送往冷却与除尘区。',
    equipmentInstanceIds: ['eq-secondary-chamber', 'eq-spray-gun-01', 'eq-spray-gun-02', 'eq-spray-gun-03', 'eq-spray-gun-04', 'eq-rotary-kiln'],
    stepIds: ['step-05-secondary-chamber', 'step-06-spray-guns', 'step-07-rotary-kiln'],
    pipelineIds: ['pipe-material-04', 'pipe-gas-01'],
    flowStreamIds: ['flow-material', 'flow-flue-gas'],
    upstreamAreaIds: ['area-01-prep'],
    downstreamAreaIds: ['area-03-cooling'],
    boundsNote: AREA_BOUNDS_NOTE,
    teaching: {
      objective: '承接物料准备区物料，在二燃室与回转窑中完成燃烧处理并生成烟气（教学示意）。',
      effect: '把物料流末端转换为烟气流起点；烟气送入冷却与除尘区。',
      relation: '上游：物料准备区（炉塞泵 → 二燃室）；下游：冷却与除尘区（回转窑 → 集冷塔一）。四根喷枪挂在二燃室下，作为四个独立平行支路。',
      pendingNote: '物料流/烟气流分界、燃烧组织、喷枪接入位置与喷入介质均待确认；不虚构化学反应、炉膛结构或工艺参数。'
    },
    dataStatus: 'pending-confirmation',
    gapIds: ['gap-spray-gun-connection', 'gap-combustion-boundary', 'gap-material-state']
  },
  {
    id: 'area-03-cooling',
    no: 3,
    name: '冷却与除尘区',
    description: '烟气依次经集冷塔一、布袋除尘器与集冷塔二完成冷却与除尘（教学示意）。',
    function: '烟气的冷却与除尘（教学示意）。',
    input: '来自燃烧处理区的烟气。',
    process: '集冷塔一 → 布袋除尘器 → 集冷塔二。',
    output: '烟气送往湿法净化区。',
    equipmentInstanceIds: ['eq-quench-1', 'eq-baghouse', 'eq-quench-2'],
    stepIds: ['step-08-quench-1', 'step-09-baghouse', 'step-10-quench-2'],
    pipelineIds: ['pipe-gas-02', 'pipe-gas-03', 'pipe-gas-04'],
    flowStreamIds: ['flow-flue-gas'],
    upstreamAreaIds: ['area-02-combustion'],
    downstreamAreaIds: ['area-04-wet'],
    boundsNote: AREA_BOUNDS_NOTE,
    teaching: {
      objective: '对燃烧处理区来的烟气进行冷却与除尘（教学示意）。',
      effect: '降低烟气温度并去除颗粒物（教学示意）；冷却方式、除尘效率与参数未提供。',
      relation: '上游：燃烧处理区（回转窑 → 集冷塔一）；下游：湿法净化区（集冷塔二 → 综合塔）。',
      pendingNote: '集冷塔/急冷塔命名、冷却方式、滤袋配置、清灰与输灰等辅助系统均待确认；不填温度或效率数值。'
    },
    dataStatus: 'teaching-demo',
    gapIds: ['gap-quench-naming', 'gap-no-aux-systems', 'gap-no-process-parameters']
  },
  {
    id: 'area-04-wet',
    no: 4,
    name: '湿法净化区',
    description: '烟气依次经综合塔、水洗塔与湿电除尘完成湿法净化（教学示意）。',
    function: '烟气的湿法净化（教学示意）。',
    input: '来自冷却与除尘区的烟气。',
    process: '综合塔 → 水洗塔 → 湿电除尘。',
    output: '烟气送往尾气排放区。',
    equipmentInstanceIds: ['eq-comprehensive-tower', 'eq-wash-tower', 'eq-wet-esp'],
    stepIds: ['step-11-comprehensive-tower', 'step-12-wash-tower', 'step-13-wet-esp'],
    pipelineIds: ['pipe-gas-05', 'pipe-gas-06', 'pipe-gas-07'],
    flowStreamIds: ['flow-flue-gas'],
    upstreamAreaIds: ['area-03-cooling'],
    downstreamAreaIds: ['area-05-stack'],
    boundsNote: AREA_BOUNDS_NOTE,
    teaching: {
      objective: '对冷却除尘后的烟气进行湿法净化（教学示意）。',
      effect: '通过洗涤与湿电除尘进一步净化烟气（教学示意）；具体塔型、吸收/中和工艺与电气参数未提供。',
      relation: '上游：冷却与除尘区（集冷塔二 → 综合塔）；下游：尾气排放区（湿电除尘 → 引风机）。',
      pendingNote: '综合塔/中合塔命名、塔内件、喷淋液、水质与湿电参数均待确认；不虚构化学反应与净化效率。'
    },
    dataStatus: 'teaching-demo',
    gapIds: ['gap-tower-naming', 'gap-no-aux-systems', 'gap-no-process-parameters']
  },
  {
    id: 'area-05-stack',
    no: 5,
    name: '尾气排放区',
    description: '净化后的烟气经引风机送入烟囱高点排放（教学示意）。',
    function: '烟气输送与高点排放（教学示意）。',
    input: '来自湿法净化区的烟气。',
    process: '引风机 → 烟囱。',
    output: '高点排放（排放去向、监测与参数未提供）。',
    equipmentInstanceIds: ['eq-id-fan', 'eq-stack'],
    stepIds: ['step-14-id-fan', 'step-15-stack'],
    pipelineIds: ['pipe-gas-08', 'pipe-gas-09'],
    flowStreamIds: ['flow-flue-gas'],
    upstreamAreaIds: ['area-04-wet'],
    downstreamAreaIds: [],
    boundsNote: AREA_BOUNDS_NOTE,
    teaching: {
      objective: '把净化后的烟气输送至烟囱并高点排放（教学示意）。',
      effect: '完成流程末端输送与排放；排放去向、监测与是否达标均未提供。',
      relation: '上游：湿法净化区（湿电除尘 → 引风机）；下游：厂外（流程边界，去向待确认）。',
      pendingNote: '风机型式、烟囱高度、采样/监测接口与排放参数均待确认；不假定排放达标。'
    },
    dataStatus: 'teaching-demo',
    gapIds: ['gap-external-boundary', 'gap-no-process-parameters']
  }
];

export const BOIL_EQUIPMENT: EquipmentInstanceDef[] = [
  {
    id: 'eq-smp',
    name: 'SMP装置',
    function: '流程首端物料接收与预处理单元；具体组成与作用待确认。',
    internals: '内部组成、破碎/混合/泵送是否集成在 SMP 内均未提供，待确认；后续按教学示意参数化模型建模。',
    areaId: 'area-01-prep',
    stepId: 'step-01-smp',
    modelSource: 'procedural',
    modelStatus: 'available',
    modelKey: 'smp',
    dataStatus: 'teaching-demo',
    ports: [
      port('feedIn', '来料入口', 'in', ['media-material'], {
        boundary: true,
        dataStatus: 'pending-confirmation',
        note: '外部来料来源未提供，按流程边界处理。',
        gapIds: ['gap-external-boundary', 'gap-material-state']
      }),
      port('discharge', '物料出口', 'out', ['media-material'], { gapIds: ['gap-material-state'] })
    ],
    sourceNote: SOURCE_BASE,
    gapIds: ['gap-smp-details', 'gap-no-models', 'gap-no-interface-details', 'gap-model-proportions', 'gap-external-boundary']
  },
  {
    id: 'eq-crusher',
    name: '破碎机',
    function: '对物料进行破碎（教学示意）；破碎方式与内部结构待确认。',
    internals: '破碎腔、转子/刀具等内部结构未提供；本阶段不建几何，不推测具体机型。',
    areaId: 'area-01-prep',
    stepId: 'step-02-crusher',
    modelSource: 'procedural',
    modelStatus: 'available',
    modelKey: 'crusher',
    dataStatus: 'teaching-demo',
    ports: [
      port('materialIn', '物料入口', 'in', ['media-material']),
      port('materialOut', '物料出口', 'out', ['media-material'])
    ],
    sourceNote: SOURCE_BASE,
    gapIds: ['gap-no-models', 'gap-no-interface-details', 'gap-model-proportions', 'gap-material-state']
  },
  {
    id: 'eq-mixer',
    name: '混合器',
    function: '对物料进行混合（教学示意）；混合方式与内部结构待确认。',
    internals: '搅拌/混合内件、腔体形式未提供；本阶段不建几何，不推测具体机型。',
    areaId: 'area-01-prep',
    stepId: 'step-03-mixer',
    modelSource: 'procedural',
    modelStatus: 'available',
    modelKey: 'mixer',
    dataStatus: 'teaching-demo',
    ports: [
      port('materialIn', '物料入口', 'in', ['media-material']),
      port('materialOut', '物料出口', 'out', ['media-material'])
    ],
    sourceNote: SOURCE_BASE,
    gapIds: ['gap-no-models', 'gap-no-interface-details', 'gap-model-proportions', 'gap-material-state']
  },
  {
    id: 'eq-furnace-pump',
    name: '炉塞泵',
    function: '为物料提供输送动力（教学示意）；泵的结构类型待确认。',
    internals: '源清单未说明“炉塞泵”的结构型式（柱塞泵/螺杆泵/其他）与内部原理；不推测、不改名，待现场确认。',
    areaId: 'area-01-prep',
    stepId: 'step-04-furnace-pump',
    modelSource: 'procedural',
    modelStatus: 'available',
    modelKey: 'furnace-pump',
    dataStatus: 'pending-confirmation',
    ports: [
      port('materialIn', '物料入口', 'in', ['media-material'], { dataStatus: 'pending-confirmation', gapIds: ['gap-furnace-pump-type'] }),
      port('materialOut', '物料出口', 'out', ['media-material'], { dataStatus: 'pending-confirmation', gapIds: ['gap-furnace-pump-type'] })
    ],
    sourceNote: SOURCE_BASE,
    gapIds: ['gap-furnace-pump-type', 'gap-no-models', 'gap-no-interface-details', 'gap-model-proportions', 'gap-material-state']
  },
  {
    id: 'eq-secondary-chamber',
    name: '二燃室',
    function: '燃烧处理单元；源清单同时把这里作为物料流末端与烟气流起点。',
    internals: '内部燃烧组织、物料/烟气的转换点与内部结构未提供；本阶段按教学边界处理，不推测炉膛结构。',
    areaId: 'area-02-combustion',
    stepId: 'step-05-secondary-chamber',
    modelSource: 'procedural',
    modelStatus: 'available',
    modelKey: 'secondary-chamber',
    dataStatus: 'pending-confirmation',
    ports: [
      port('materialIn', '物料入口', 'in', ['media-material'], { dataStatus: 'pending-confirmation', gapIds: ['gap-combustion-boundary'] }),
      port('gasOut', '烟气出口', 'out', ['media-flue-gas'], { dataStatus: 'pending-confirmation', gapIds: ['gap-combustion-boundary'] })
    ],
    sourceNote: SOURCE_BASE,
    gapIds: ['gap-combustion-boundary', 'gap-spray-gun-connection', 'gap-no-models', 'gap-no-interface-details', 'gap-model-proportions']
  },
  ...(['01', '02', '03', '04'] as const).map((no): EquipmentInstanceDef => ({
    id: `eq-spray-gun-${no}`,
    name: `喷枪${no}`,
    function: '燃烧段喷入装置；喷入介质、来源与接入位置待确认。',
    internals: '喷枪内部结构、喷嘴形式、喷入介质与配比均未提供；本阶段不建几何，不推测。',
    areaId: 'area-02-combustion',
    stepId: 'step-06-spray-guns',
    parentEquipmentId: 'eq-secondary-chamber',
    relationKind: 'parallel-branch',
    relationStatus: 'pending-confirmation',
    relationNote:
      '观察二燃室时，喷枪作为二燃室的四个独立平行支路挂接，不串成四个连续工艺节点；具体接入位置、喷入介质与来源仍待现场确认，未建立已确认硬连接。',
    modelSource: 'procedural',
    modelStatus: 'available',
    modelKey: 'spray-gun',
    dataStatus: 'pending-confirmation',
    ports: [
      port('feedIn', '喷入介质入口', 'in', ['media-spray-medium'], {
        dataStatus: 'pending-confirmation',
        note: '喷入介质与来源未提供。',
        gapIds: ['gap-spray-gun-connection', 'gap-material-state']
      }),
      port('nozzleOut', '喷出口', 'out', ['media-spray-medium'], {
        dataStatus: 'pending-confirmation',
        note: '接入二燃室或回转窑待确认；本阶段不建立硬连接。',
        gapIds: ['gap-spray-gun-connection']
      })
    ],
    sourceNote: SOURCE_BASE,
    gapIds: ['gap-spray-gun-connection', 'gap-material-state', 'gap-no-models', 'gap-no-interface-details', 'gap-model-proportions']
  })),
  {
    id: 'eq-rotary-kiln',
    name: '回转窑',
    function: '燃烧/反应段（教学示意）；内部物料运动与停留时间待确认。',
    internals: '筒体、内部空间、物料运动区域、进料端与出料端等结构未提供；本阶段不建几何，不推测尺寸与转速。',
    areaId: 'area-02-combustion',
    stepId: 'step-07-rotary-kiln',
    modelSource: 'procedural',
    modelStatus: 'available',
    modelKey: 'rotary-kiln',
    dataStatus: 'teaching-demo',
    ports: [
      port('gasIn', '烟气入口', 'in', ['media-flue-gas']),
      port('gasOut', '烟气出口', 'out', ['media-flue-gas'])
    ],
    sourceNote: SOURCE_BASE,
    gapIds: ['gap-spray-gun-connection', 'gap-no-models', 'gap-no-interface-details', 'gap-model-proportions', 'gap-no-process-parameters']
  },
  {
    id: 'eq-quench-1',
    name: '集冷塔一',
    function: '烟气冷却单元（教学示意）；冷却方式与参数未提供。',
    internals: '塔内冷却段、喷淋/换热内件与气液接触方式未提供；本阶段不建几何。',
    areaId: 'area-03-cooling',
    stepId: 'step-08-quench-1',
    modelSource: 'procedural',
    modelStatus: 'available',
    modelKey: 'quench-tower',
    dataStatus: 'teaching-demo',
    ports: [
      port('gasIn', '烟气入口', 'in', ['media-flue-gas']),
      port('gasOut', '烟气出口', 'out', ['media-flue-gas'])
    ],
    sourceNote: SOURCE_BASE,
    gapIds: ['gap-quench-naming', 'gap-no-models', 'gap-no-interface-details', 'gap-model-proportions', 'gap-no-aux-systems']
  },
  {
    id: 'eq-baghouse',
    name: '布袋除尘器',
    function: '烟气通过滤袋时截留粉尘。教学结构展示含尘侧、净气侧与灰斗。',
    internals: '教学模型展示滤袋、花板、净气室与灰斗。现场滤袋数量、材质、清灰方式与灰输送待确认。',
    areaId: 'area-03-cooling',
    stepId: 'step-09-baghouse',
    modelSource: 'procedural',
    modelStatus: 'available',
    modelKey: 'baghouse',
    dataStatus: 'teaching-demo',
    ports: [
      port('gasIn', '烟气入口', 'in', ['media-flue-gas']),
      port('gasOut', '烟气出口', 'out', ['media-flue-gas'])
    ],
    sourceNote: SOURCE_BASE,
    gapIds: ['gap-no-models', 'gap-no-interface-details', 'gap-model-proportions', 'gap-no-aux-systems', 'gap-no-process-parameters']
  },
  {
    id: 'eq-quench-2',
    name: '集冷塔二',
    function: '烟气进一步冷却（教学示意）；冷却方式与参数未提供。',
    internals: '塔内冷却段、喷淋/换热内件与气液接触方式未提供；本阶段不建几何。',
    areaId: 'area-03-cooling',
    stepId: 'step-10-quench-2',
    modelSource: 'procedural',
    modelStatus: 'available',
    modelKey: 'quench-tower',
    dataStatus: 'teaching-demo',
    ports: [
      port('gasIn', '烟气入口', 'in', ['media-flue-gas']),
      port('gasOut', '烟气出口', 'out', ['media-flue-gas'])
    ],
    sourceNote: SOURCE_BASE,
    gapIds: ['gap-quench-naming', 'gap-no-models', 'gap-no-interface-details', 'gap-model-proportions', 'gap-no-aux-systems']
  },
  {
    id: 'eq-comprehensive-tower',
    name: '综合塔',
    function: '湿法净化单元（教学示意）；具体塔型与吸收/中和工艺待确认。',
    internals: '塔内填料/喷淋/除雾等内件与气液接触方式未提供；源清单另有“中合塔”写法，本阶段不改名、不推测塔型。',
    areaId: 'area-04-wet',
    stepId: 'step-11-comprehensive-tower',
    modelSource: 'procedural',
    modelStatus: 'available',
    modelKey: 'comprehensive-tower',
    dataStatus: 'pending-confirmation',
    ports: [
      port('gasIn', '烟气入口', 'in', ['media-flue-gas'], { dataStatus: 'pending-confirmation', gapIds: ['gap-tower-naming'] }),
      port('gasOut', '烟气出口', 'out', ['media-flue-gas'], { dataStatus: 'pending-confirmation', gapIds: ['gap-tower-naming'] })
    ],
    sourceNote: SOURCE_BASE,
    gapIds: ['gap-tower-naming', 'gap-no-models', 'gap-no-interface-details', 'gap-model-proportions', 'gap-no-aux-systems']
  },
  {
    id: 'eq-wash-tower',
    name: '水洗塔',
    function: '水洗净化单元（教学示意）；喷淋方式与参数未提供。',
    internals: '观察气液接触、喷淋和液体收集的示意结构。塔内填料、除雾方式、水质、循环量和排液去向待确认。',
    areaId: 'area-04-wet',
    stepId: 'step-12-wash-tower',
    modelSource: 'procedural',
    modelStatus: 'available',
    modelKey: 'wash-tower',
    dataStatus: 'teaching-demo',
    ports: [
      port('gasIn', '烟气入口', 'in', ['media-flue-gas']),
      port('gasOut', '烟气出口', 'out', ['media-flue-gas'])
    ],
    sourceNote: SOURCE_BASE,
    gapIds: ['gap-no-models', 'gap-no-interface-details', 'gap-model-proportions', 'gap-no-aux-systems', 'gap-no-process-parameters']
  },
  {
    id: 'eq-wet-esp',
    name: '湿电除尘',
    function: '湿式电除尘单元（教学示意）；内部结构与电气参数未提供。',
    internals: '观察放电部件、集尘表面与冲洗收集的原理结构。极板布局、冲洗去向和现场电气参数待确认。',
    areaId: 'area-04-wet',
    stepId: 'step-13-wet-esp',
    modelSource: 'procedural',
    modelStatus: 'available',
    modelKey: 'wet-esp',
    dataStatus: 'teaching-demo',
    ports: [
      port('gasIn', '烟气入口', 'in', ['media-flue-gas']),
      port('gasOut', '烟气出口', 'out', ['media-flue-gas'])
    ],
    sourceNote: SOURCE_BASE,
    gapIds: ['gap-no-models', 'gap-no-interface-details', 'gap-model-proportions', 'gap-no-aux-systems', 'gap-no-process-parameters']
  },
  {
    id: 'eq-id-fan',
    name: '引风机',
    function: '为烟气提供输送动力（教学示意）；风机型式与参数未提供。',
    internals: '观察风机示意叶轮、机壳和轴。风机型式、密封结构、风量与风压待确认。',
    areaId: 'area-05-stack',
    stepId: 'step-14-id-fan',
    modelSource: 'procedural',
    modelStatus: 'available',
    modelKey: 'id-fan',
    dataStatus: 'teaching-demo',
    ports: [
      port('gasIn', '烟气入口', 'in', ['media-flue-gas']),
      port('gasOut', '烟气出口', 'out', ['media-flue-gas'])
    ],
    sourceNote: SOURCE_BASE,
    gapIds: ['gap-no-models', 'gap-no-interface-details', 'gap-model-proportions', 'gap-no-process-parameters']
  },
  {
    id: 'eq-stack',
    name: '烟囱',
    function: '烟气高点排放（教学示意）；排放高度、监测与排放参数未提供。',
    internals: '烟囱本体、内衬、采样/监测接口等未提供；本阶段不建几何，不假定排放达标。',
    areaId: 'area-05-stack',
    stepId: 'step-15-stack',
    modelSource: 'procedural',
    modelStatus: 'available',
    modelKey: 'stack',
    dataStatus: 'teaching-demo',
    ports: [
      port('gasIn', '烟气入口', 'in', ['media-flue-gas']),
      port('emissionOut', '排放口', 'out', ['media-flue-gas'], {
        boundary: true,
        dataStatus: 'pending-confirmation',
        note: '排放去向、监测与排放参数未提供，按流程边界处理。',
        gapIds: ['gap-external-boundary', 'gap-no-process-parameters']
      })
    ],
    sourceNote: SOURCE_BASE,
    gapIds: ['gap-no-models', 'gap-no-interface-details', 'gap-model-proportions', 'gap-external-boundary', 'gap-no-process-parameters']
  }
];

export const BOIL_PIPELINES: PipelineDef[] = [
  {
    id: 'pipe-material-01',
    name: 'SMP → 破碎机 物料管线',
    from: { equipment: 'eq-smp', port: 'discharge' },
    to: { equipment: 'eq-crusher', port: 'materialIn' },
    medium: 'media-material',
    flowStreamId: 'flow-material',
    areaId: 'area-01-prep',
    dataStatus: 'teaching-demo',
    designNote: PIPE_NOTE,
    route: routeConfig('gate'),
    gapIds: ['gap-no-pipeline-details', 'gap-piping-teaching-geometry', 'gap-material-state']
  },
  {
    id: 'pipe-material-02',
    name: '破碎机 → 混合器 物料管线',
    from: { equipment: 'eq-crusher', port: 'materialOut' },
    to: { equipment: 'eq-mixer', port: 'materialIn' },
    medium: 'media-material',
    flowStreamId: 'flow-material',
    areaId: 'area-01-prep',
    dataStatus: 'teaching-demo',
    designNote: PIPE_NOTE,
    route: routeConfig('gate'),
    gapIds: ['gap-no-pipeline-details', 'gap-piping-teaching-geometry', 'gap-material-state']
  },
  {
    id: 'pipe-material-03',
    name: '混合器 → 炉塞泵 物料管线',
    from: { equipment: 'eq-mixer', port: 'materialOut' },
    to: { equipment: 'eq-furnace-pump', port: 'materialIn' },
    medium: 'media-material',
    flowStreamId: 'flow-material',
    areaId: 'area-01-prep',
    dataStatus: 'teaching-demo',
    designNote: PIPE_NOTE,
    route: routeConfig('gate'),
    gapIds: ['gap-no-pipeline-details', 'gap-piping-teaching-geometry', 'gap-material-state']
  },
  {
    id: 'pipe-material-04',
    name: '炉塞泵 → 二燃室 物料管线',
    from: { equipment: 'eq-furnace-pump', port: 'materialOut' },
    to: { equipment: 'eq-secondary-chamber', port: 'materialIn' },
    medium: 'media-material',
    flowStreamId: 'flow-material',
    areaId: 'area-02-combustion',
    dataStatus: 'pending-confirmation',
    designNote: PIPE_NOTE,
    route: routeConfig('gate'),
    gapIds: ['gap-no-pipeline-details', 'gap-piping-teaching-geometry', 'gap-combustion-boundary']
  },
  {
    id: 'pipe-gas-01',
    name: '二燃室 → 回转窑 烟气管线',
    from: { equipment: 'eq-secondary-chamber', port: 'gasOut' },
    to: { equipment: 'eq-rotary-kiln', port: 'gasIn' },
    medium: 'media-flue-gas',
    flowStreamId: 'flow-flue-gas',
    areaId: 'area-02-combustion',
    dataStatus: 'pending-confirmation',
    designNote: PIPE_NOTE,
    route: routeConfig('butterfly'),
    gapIds: ['gap-no-pipeline-details', 'gap-piping-teaching-geometry', 'gap-combustion-boundary']
  },
  {
    id: 'pipe-gas-02',
    name: '回转窑 → 集冷塔一 烟气管线',
    from: { equipment: 'eq-rotary-kiln', port: 'gasOut' },
    to: { equipment: 'eq-quench-1', port: 'gasIn' },
    medium: 'media-flue-gas',
    flowStreamId: 'flow-flue-gas',
    areaId: 'area-03-cooling',
    dataStatus: 'teaching-demo',
    designNote: PIPE_NOTE,
    route: routeConfig('butterfly'),
    gapIds: ['gap-no-pipeline-details', 'gap-piping-teaching-geometry']
  },
  {
    id: 'pipe-gas-03',
    name: '集冷塔一 → 布袋除尘器 烟气管线',
    from: { equipment: 'eq-quench-1', port: 'gasOut' },
    to: { equipment: 'eq-baghouse', port: 'gasIn' },
    medium: 'media-flue-gas',
    flowStreamId: 'flow-flue-gas',
    areaId: 'area-03-cooling',
    dataStatus: 'teaching-demo',
    designNote: PIPE_NOTE,
    route: routeConfig('butterfly'),
    gapIds: ['gap-no-pipeline-details', 'gap-piping-teaching-geometry']
  },
  {
    id: 'pipe-gas-04',
    name: '布袋除尘器 → 集冷塔二 烟气管线',
    from: { equipment: 'eq-baghouse', port: 'gasOut' },
    to: { equipment: 'eq-quench-2', port: 'gasIn' },
    medium: 'media-flue-gas',
    flowStreamId: 'flow-flue-gas',
    areaId: 'area-03-cooling',
    dataStatus: 'teaching-demo',
    designNote: PIPE_NOTE,
    route: routeConfig('butterfly'),
    gapIds: ['gap-no-pipeline-details', 'gap-piping-teaching-geometry']
  },
  {
    id: 'pipe-gas-05',
    name: '集冷塔二 → 综合塔 烟气管线',
    from: { equipment: 'eq-quench-2', port: 'gasOut' },
    to: { equipment: 'eq-comprehensive-tower', port: 'gasIn' },
    medium: 'media-flue-gas',
    flowStreamId: 'flow-flue-gas',
    areaId: 'area-04-wet',
    dataStatus: 'teaching-demo',
    designNote: PIPE_NOTE,
    route: routeConfig('butterfly'),
    gapIds: ['gap-no-pipeline-details', 'gap-piping-teaching-geometry', 'gap-tower-naming']
  },
  {
    id: 'pipe-gas-06',
    name: '综合塔 → 水洗塔 烟气管线',
    from: { equipment: 'eq-comprehensive-tower', port: 'gasOut' },
    to: { equipment: 'eq-wash-tower', port: 'gasIn' },
    medium: 'media-flue-gas',
    flowStreamId: 'flow-flue-gas',
    areaId: 'area-04-wet',
    dataStatus: 'pending-confirmation',
    designNote: PIPE_NOTE,
    route: routeConfig('butterfly'),
    gapIds: ['gap-no-pipeline-details', 'gap-piping-teaching-geometry', 'gap-tower-naming']
  },
  {
    id: 'pipe-gas-07',
    name: '水洗塔 → 湿电除尘 烟气管线',
    from: { equipment: 'eq-wash-tower', port: 'gasOut' },
    to: { equipment: 'eq-wet-esp', port: 'gasIn' },
    medium: 'media-flue-gas',
    flowStreamId: 'flow-flue-gas',
    areaId: 'area-04-wet',
    dataStatus: 'teaching-demo',
    designNote: PIPE_NOTE,
    route: routeConfig('butterfly'),
    gapIds: ['gap-no-pipeline-details', 'gap-piping-teaching-geometry']
  },
  {
    id: 'pipe-gas-08',
    name: '湿电除尘 → 引风机 烟气管线',
    from: { equipment: 'eq-wet-esp', port: 'gasOut' },
    to: { equipment: 'eq-id-fan', port: 'gasIn' },
    medium: 'media-flue-gas',
    flowStreamId: 'flow-flue-gas',
    areaId: 'area-05-stack',
    dataStatus: 'teaching-demo',
    designNote: PIPE_NOTE,
    route: routeConfig('butterfly'),
    gapIds: ['gap-no-pipeline-details', 'gap-piping-teaching-geometry']
  },
  {
    id: 'pipe-gas-09',
    name: '引风机 → 烟囱 烟气管线',
    from: { equipment: 'eq-id-fan', port: 'gasOut' },
    to: { equipment: 'eq-stack', port: 'gasIn' },
    medium: 'media-flue-gas',
    flowStreamId: 'flow-flue-gas',
    areaId: 'area-05-stack',
    dataStatus: 'teaching-demo',
    designNote: PIPE_NOTE,
    route: routeConfig('butterfly'),
    gapIds: ['gap-no-pipeline-details', 'gap-piping-teaching-geometry']
  }
];

export const BOIL_STEPS: ProcessStepDef[] = [
  {
    id: 'step-01-smp',
    no: 1,
    title: 'SMP装置',
    description: '流程首端物料接收与预处理单元；源清单未说明其内部组成，本阶段按一个教学单元处理。物料经管线送往破碎机。',
    areaId: 'area-01-prep',
    equipmentInstanceIds: ['eq-smp'],
    pipelineIds: ['pipe-material-01'],
    dataStatus: 'teaching-demo',
    gapIds: ['gap-smp-details', 'gap-material-state']
  },
  {
    id: 'step-02-crusher',
    no: 2,
    title: '破碎机',
    description: '对物料进行破碎（教学示意）；内部结构与破碎方式待确认。出口物料送往混合器。',
    areaId: 'area-01-prep',
    equipmentInstanceIds: ['eq-crusher'],
    pipelineIds: ['pipe-material-02'],
    dataStatus: 'teaching-demo',
    gapIds: ['gap-material-state']
  },
  {
    id: 'step-03-mixer',
    no: 3,
    title: '混合器',
    description: '对物料进行混合（教学示意）；混合方式与内部结构待确认。出口物料经炉塞泵输送。',
    areaId: 'area-01-prep',
    equipmentInstanceIds: ['eq-mixer'],
    pipelineIds: ['pipe-material-03'],
    dataStatus: 'teaching-demo',
    gapIds: ['gap-material-state']
  },
  {
    id: 'step-04-furnace-pump',
    no: 4,
    title: '炉塞泵',
    description: '为物料提供输送动力；泵的结构类型与内部原理未确认。出口物料进入二燃室。',
    areaId: 'area-01-prep',
    equipmentInstanceIds: ['eq-furnace-pump'],
    pipelineIds: ['pipe-material-04'],
    dataStatus: 'pending-confirmation',
    gapIds: ['gap-furnace-pump-type', 'gap-material-state']
  },
  {
    id: 'step-05-secondary-chamber',
    no: 5,
    title: '二燃室',
    description: '燃烧处理单元；源清单把这里同时作为物料流末端与烟气流起点。内部转换点与炉膛结构未提供，本阶段按教学边界处理。烟气进入回转窑。',
    areaId: 'area-02-combustion',
    equipmentInstanceIds: ['eq-secondary-chamber'],
    pipelineIds: ['pipe-gas-01'],
    dataStatus: 'pending-confirmation',
    gapIds: ['gap-combustion-boundary', 'gap-spray-gun-connection']
  },
  {
    id: 'step-06-spray-guns',
    no: 6,
    title: '四根喷枪',
    description: '燃烧段喷入装置，四根喷枪合并为一个教学步骤。喷枪与二燃室/回转窑的接入位置、喷入介质与来源均未确认，本阶段不建立硬连接。',
    areaId: 'area-02-combustion',
    equipmentInstanceIds: ['eq-spray-gun-01', 'eq-spray-gun-02', 'eq-spray-gun-03', 'eq-spray-gun-04'],
    pipelineIds: [],
    dataStatus: 'pending-confirmation',
    gapIds: ['gap-spray-gun-connection', 'gap-material-state']
  },
  {
    id: 'step-07-rotary-kiln',
    no: 7,
    title: '回转窑',
    description: '燃烧/反应段（教学示意）；筒体内部物料运动与停留时间未提供。烟气进入集冷塔一。',
    areaId: 'area-02-combustion',
    equipmentInstanceIds: ['eq-rotary-kiln'],
    pipelineIds: ['pipe-gas-02'],
    dataStatus: 'teaching-demo',
    gapIds: ['gap-spray-gun-connection', 'gap-no-process-parameters']
  },
  {
    id: 'step-08-quench-1',
    no: 8,
    title: '集冷塔一',
    description: '烟气冷却单元；冷却方式与参数未提供。出口烟气进入布袋除尘器。',
    areaId: 'area-03-cooling',
    equipmentInstanceIds: ['eq-quench-1'],
    pipelineIds: ['pipe-gas-03'],
    dataStatus: 'teaching-demo',
    gapIds: ['gap-quench-naming', 'gap-no-aux-systems']
  },
  {
    id: 'step-09-baghouse',
    no: 9,
    title: '布袋除尘器',
    description: '烟气除尘单元；滤袋、花板、净气室、灰斗等内部结构待后续阶段建立。出口烟气进入集冷塔二。',
    areaId: 'area-03-cooling',
    equipmentInstanceIds: ['eq-baghouse'],
    pipelineIds: ['pipe-gas-04'],
    dataStatus: 'teaching-demo',
    gapIds: ['gap-no-aux-systems', 'gap-no-process-parameters']
  },
  {
    id: 'step-10-quench-2',
    no: 10,
    title: '集冷塔二',
    description: '烟气进一步冷却（教学示意）；冷却方式与参数未提供。出口烟气进入综合塔。',
    areaId: 'area-03-cooling',
    equipmentInstanceIds: ['eq-quench-2'],
    pipelineIds: ['pipe-gas-05'],
    dataStatus: 'teaching-demo',
    gapIds: ['gap-quench-naming', 'gap-no-aux-systems']
  },
  {
    id: 'step-11-comprehensive-tower',
    no: 11,
    title: '综合塔',
    description: '湿法净化单元；源清单同时出现“中合塔/综合塔”写法，具体塔型与吸收/中和工艺待确认。出口烟气进入水洗塔。',
    areaId: 'area-04-wet',
    equipmentInstanceIds: ['eq-comprehensive-tower'],
    pipelineIds: ['pipe-gas-06'],
    dataStatus: 'pending-confirmation',
    gapIds: ['gap-tower-naming', 'gap-no-aux-systems']
  },
  {
    id: 'step-12-wash-tower',
    no: 12,
    title: '水洗塔',
    description: '水洗净化单元（教学示意）；喷淋方式与参数未提供。出口烟气进入湿电除尘。',
    areaId: 'area-04-wet',
    equipmentInstanceIds: ['eq-wash-tower'],
    pipelineIds: ['pipe-gas-07'],
    dataStatus: 'teaching-demo',
    gapIds: ['gap-no-aux-systems', 'gap-no-process-parameters']
  },
  {
    id: 'step-13-wet-esp',
    no: 13,
    title: '湿电除尘',
    description: '湿式电除尘单元（教学示意）；内部结构与电气参数未提供。出口烟气进入引风机。',
    areaId: 'area-04-wet',
    equipmentInstanceIds: ['eq-wet-esp'],
    pipelineIds: ['pipe-gas-08'],
    dataStatus: 'teaching-demo',
    gapIds: ['gap-no-aux-systems', 'gap-no-process-parameters']
  },
  {
    id: 'step-14-id-fan',
    no: 14,
    title: '引风机',
    description: '为烟气提供输送动力；风机型式与参数未提供。出口烟气进入烟囱。',
    areaId: 'area-05-stack',
    equipmentInstanceIds: ['eq-id-fan'],
    pipelineIds: ['pipe-gas-09'],
    dataStatus: 'teaching-demo',
    gapIds: ['gap-no-process-parameters']
  },
  {
    id: 'step-15-stack',
    no: 15,
    title: '烟囱',
    description: '烟气高点排放（教学示意）；排放高度、监测与排放参数未提供，不假定排放达标。',
    areaId: 'area-05-stack',
    equipmentInstanceIds: ['eq-stack'],
    pipelineIds: [],
    dataStatus: 'teaching-demo',
    gapIds: ['gap-external-boundary', 'gap-no-process-parameters']
  }
];

export const BOIL_FLOW_STREAMS: FlowStreamDef[] = [
  {
    id: 'flow-material',
    name: '物料流',
    type: 'material',
    medium: 'media-material',
    equipmentSequence: ['eq-smp', 'eq-crusher', 'eq-mixer', 'eq-furnace-pump', 'eq-secondary-chamber'],
    pipelineIds: ['pipe-material-01', 'pipe-material-02', 'pipe-material-03', 'pipe-material-04'],
    dataStatus: 'teaching-demo',
    description: 'SMP → 破碎机 → 混合器 → 炉塞泵 → 二燃室的物料流；物料状态、成分、流量等参数未提供。',
    gapIds: ['gap-material-state', 'gap-combustion-boundary', 'gap-no-process-parameters']
  },
  {
    id: 'flow-flue-gas',
    name: '烟气流',
    type: 'gas',
    medium: 'media-flue-gas',
    equipmentSequence: [
      'eq-secondary-chamber',
      'eq-rotary-kiln',
      'eq-quench-1',
      'eq-baghouse',
      'eq-quench-2',
      'eq-comprehensive-tower',
      'eq-wash-tower',
      'eq-wet-esp',
      'eq-id-fan',
      'eq-stack'
    ],
    pipelineIds: [
      'pipe-gas-01',
      'pipe-gas-02',
      'pipe-gas-03',
      'pipe-gas-04',
      'pipe-gas-05',
      'pipe-gas-06',
      'pipe-gas-07',
      'pipe-gas-08',
      'pipe-gas-09'
    ],
    dataStatus: 'teaching-demo',
    description: '二燃室 → 回转窑 → 集冷塔一 → 布袋除尘器 → 集冷塔二 → 综合塔 → 水洗塔 → 湿电除尘 → 引风机 → 烟囱的烟气流；温度、成分、流量等参数未提供。',
    gapIds: ['gap-combustion-boundary', 'gap-no-process-parameters', 'gap-no-aux-systems']
  }
];

export const BOIL_PROCESS: ProcessDefinition = {
  id: 'boil-spray-incineration',
  name: '微沸喷烧全流程（教学示意）',
  dataVersion: '2026-11-18.4',
  dataStatus: 'teaching-demo',
  description: '选择设备查看接口和上下游，沿物料流或烟气流追踪，或按 15 道工序播放。五个工艺区包含 18 个设备实例与 13 段教学管线。四根喷枪作为二燃室的平行支路展示，接入位置和介质待确认。',
  boundary: '本流程为教学示意数据模型，不代表任何具体工程装置、工艺参数或设备型号；设备外形比例、教学布局、管线走向、阀门型式/位置、支架间距均为教学示意，不是工程坐标、装置总平面、管道设计或制造尺寸；未提供的参数一律留空并登记为待确认，不得作为工程设计、工艺包、采购、施工或安全评价依据。',
  sourceNote: '设备名称与顺序来自用户提供的《DeepSeek Coding Agent 专用开发总指令》§5、§11、§18、§20、§45（2026-11-18）；外观比例、接口、布局与管路走向均为教学示意；未引用厂商图纸、工艺包或第三方模型。',
  media: BOIL_MEDIA,
  areas: BOIL_AREAS,
  steps: BOIL_STEPS,
  equipment: BOIL_EQUIPMENT,
  pipelines: BOIL_PIPELINES,
  flowStreams: BOIL_FLOW_STREAMS,
  gaps: BOIL_GAPS
};
