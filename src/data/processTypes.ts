/**
 * 通用流程数据模型（教学示意）。
 *
 * 只描述「工艺区 → 工序 → 设备实例 → 接口 → 管线 → 流线」的数据关系；
 * 不包含温度、压力、流量、浓度、型号、厂家、材料牌号等工程参数。
 * 缺失信息一律通过 dataStatus / gapIds 显式标注，禁止补占位假值。
 *
 * 本文件与 src/data/plant.ts（通用化工流程）相互独立：
 * plant.ts 描述现有第 7 轮通用流程，本文件为可复用的流程类型定义，
 * 首个使用方是微沸喷烧流程（src/data/boilProcess.ts）。
 */

/** 教学示意数据的状态：可展示的教学构型，或明确待确认。 */
export type DataStatus = 'teaching-demo' | 'pending-confirmation';

/** 设备模型来源：站内已有模型 / 计划参数化教学模型 / 尚未确定。 */
export type ModelSource = 'existing' | 'procedural' | 'pending';

/** 设备模型当前是否可用：available = 外部教学模型已建；not-built = 尚未建模。 */
export type ModelStatus = 'available' | 'not-built';

/** 流线类型。simulation 表示介质与工艺尚待现场确认。 */
export type FlowType =
  | 'material'
  | 'gas'
  | 'liquid'
  | 'cooling'
  | 'wash'
  | 'waste'
  | 'product'
  | 'utility'
  | 'simulation';

export type MediumPhase = 'solid' | 'liquid' | 'gas' | 'mixed' | 'utility';

export type PortRole = 'in' | 'out' | 'both';

/** 已登记的待确认缺口；affects 引用受影响的设备/管线/流线/步骤 id。 */
export interface ProcessGap {
  id: string;
  subject: string;
  detail: string;
  affects: string[];
}

export interface MediumDef {
  id: string;
  label: string;
  phase: MediumPhase;
  /** 教学显示色，仅用于区分流线，不代表介质真实颜色。 */
  color: number;
  dataStatus: DataStatus;
  description: string;
  gapIds: string[];
}

export interface AreaTeachingDef {
  /** 工艺目的（教学说明，不代替工艺包或操作规程）。 */
  objective: string;
  /** 工艺作用（教学说明）。 */
  effect: string;
  /** 上下游关系说明（与 area 上下游 id 一致，仅作教学文案）。 */
  relation: string;
  /** 本区域仍待确认的信息与不得虚构的边界。 */
  pendingNote: string;
}

export interface ProcessAreaDef {
  id: string;
  no: number;
  name: string;
  /** 区域说明（教学示意）。 */
  description: string;
  function: string;
  input: string;
  process: string;
  output: string;
  equipmentInstanceIds: string[];
  stepIds: string[];
  /** 归属本区的管线（按管线 areaId 唯一归属；跨区管线归下游区）。 */
  pipelineIds: string[];
  /** 经过本区的流体/流线 id。 */
  flowStreamIds: string[];
  upstreamAreaIds: string[];
  downstreamAreaIds: string[];
  /**
   * 三维区域范围由教学布局与设备模型包络推导（见 src/process/areas.ts），
   * 不是手写工程坐标；此处只声明范围说明。
   */
  boundsNote: string;
  teaching: AreaTeachingDef;
  dataStatus: DataStatus;
  gapIds: string[];
}

export interface PortDef {
  id: string;
  name: string;
  role: PortRole;
  /** 允许的介质 id；空数组表示介质待确认。 */
  media: string[];
  dataStatus: DataStatus;
  /** 流程边界接口：不要求内部管线连接（如来料入口、排放口）。 */
  boundary?: boolean;
  note?: string;
  /** 对应参数化模型接口锚点 id；缺省与 port.id 相同。 */
  modelPortId?: string;
  gapIds: string[];
  /**
   * 接口局部坐标由参数化模型登记（Phase 2），数据侧只引用接口 id。
   * 模型坐标为教学示意，不是工程接口坐标或制造尺寸。
   */
}

export interface EquipmentInstanceDef {
  id: string;
  name: string;
  /** 在本流程中的工艺职责（教学说明，不代替设备说明书）。 */
  function: string;
  /** 内部结构/内部流动的教学说明；未知结构明确标注待确认。 */
  internals: string;
  areaId: string;
  stepId: string;
  /**
   * 结构关联父设备（不是工艺串联）。用于把喷枪等支路件挂到宿主设备；
   * 具体接入位置与介质仍由 relationStatus / gapIds 标注。
   */
  parentEquipmentId?: string;
  relationKind?: 'parallel-branch' | 'integral-part';
  relationStatus?: DataStatus;
  relationNote?: string;
  modelSource: ModelSource;
  modelStatus: ModelStatus;
  /** 参数化外部教学模型键（Phase 2 起）；与模型接口锚点表对应。 */
  modelKey?: string;
  dataStatus: DataStatus;
  ports: PortDef[];
  /** 名称与流程位置的来源说明。 */
  sourceNote: string;
  gapIds: string[];
}

export interface PipelineEndpointDef {
  equipment: string;
  port: string;
}

/** 管道管径等级（教学示意，不是工程管径/公称尺寸）。 */
export type PipeSizeClass = 'main' | 'branch' | 'utility';

/**
 * 管线教学示意路由配置（Phase 3）。
 * 路由坐标由场景布局程序生成（设备布局 + 正交车道 + 端口法线），
 * 不是工程坐标、管道设计或现场安装依据；缺失的阀门/支架资料显式标 pending-confirmation。
 */
export interface PipelineRouteDef {
  /** 管径等级；须与两端模型接口等级一致，不虚构变径。 */
  size: PipeSizeClass;
  /** 教学示意阀门：型式与位置未从来源确认，仅用于结构认知。 */
  valve: {
    kind: 'gate' | 'butterfly';
    note: string;
    dataStatus: DataStatus;
  };
  /** 支架教学示意间距上限（m）；不表示工程支架设计。 */
  supportMaxSpacing: number;
  dataStatus: DataStatus;
}

export interface PipelineDef {
  id: string;
  name: string;
  from: PipelineEndpointDef;
  to: PipelineEndpointDef;
  /** 介质 id，必须存在于 ProcessDefinition.media。 */
  medium: string;
  flowStreamId?: string;
  areaId: string;
  dataStatus: DataStatus;
  /** Phase 1 只建拓扑；管径/路由/阀门/仪表/支架未确认。 */
  designNote: string;
  /** Phase 3 教学示意路由/管件配置；无此字段表示尚未进入工业管道阶段。 */
  route?: PipelineRouteDef;
  gapIds: string[];
}

export interface ProcessStepDef {
  id: string;
  no: number;
  title: string;
  description: string;
  areaId: string;
  equipmentInstanceIds: string[];
  pipelineIds: string[];
  dataStatus: DataStatus;
  gapIds: string[];
}

export interface FlowStreamDef {
  id: string;
  name: string;
  type: FlowType;
  medium: string;
  equipmentSequence: string[];
  pipelineIds: string[];
  dataStatus: DataStatus;
  description: string;
  gapIds: string[];
}

export interface ProcessDefinition {
  id: string;
  name: string;
  /** 数据模型版本，不是工艺版本或工程版本。 */
  dataVersion: string;
  dataStatus: DataStatus;
  description: string;
  /** 教学示意边界说明。 */
  boundary: string;
  /** 来源依据说明（只说明出处，不填工程参数）。 */
  sourceNote: string;
  media: MediumDef[];
  areas: ProcessAreaDef[];
  steps: ProcessStepDef[];
  equipment: EquipmentInstanceDef[];
  pipelines: PipelineDef[];
  flowStreams: FlowStreamDef[];
  gaps: ProcessGap[];
}
