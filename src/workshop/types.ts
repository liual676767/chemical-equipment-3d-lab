/* 管道与设备三维组装工坊 · 数据模型
 * 场景单位：1 单位 = 100 mm（MM = 0.01）。规格以毫米记录，几何按预设换算。 */

export const MM = 0.01;

export type PortType = 'flange' | 'thread' | 'weld' | 'bolt' | 'nut' | 'clamp' | 'mechanical';
export type FlowDir = 'in' | 'out' | 'both';
export type MaterialKind = 'carbon-steel' | 'stainless' | 'cast-iron' | 'rubber' | 'alloy' | 'ptfe';
export type Capability = 'observe' | 'section' | 'connect' | 'principle' | 'disassemble';

export interface PortDef {
  id: string;
  label: string;
  pos: [number, number, number];
  dir: [number, number, number];
  dn: number;
  type: PortType;
  standard?: string;
  flow?: FlowDir;
  boltCount?: number;
  blind?: boolean;
  threadSex?: 'external' | 'internal';
  mate?: { family: string; gender: 'insert' | 'receive'; mode: 'axial' | 'plane' | 'fixed' };
}

export type CategoryId =
  | 'pipe' | 'flange' | 'valve' | 'pump' | 'heat' | 'react' | 'sep' | 'tank' | 'instr';

export interface CatalogPart {
  id: string;
  name: string;
  category: CategoryId;
  status: 'ready' | 'dev';
  batch: 1 | 2 | 3;
  summary: string;
  usage: string;
  partsDesc: string;
  portsDesc: string;
  learnPoints: string[];
  tags: string[];
  material: MaterialKind;
  color: string;
  ports: PortDef[];
  defaultSpec: { dn: number; length?: number; endType?: EndType; smallDn?: number };
  parametric?: { length?: [number, number, number]; endType?: boolean; dnList?: number[] };
  capabilities: Capability[];
  builder: string;
  demo?: 'ball' | 'gate' | 'check' | 'impeller' | 'level';
}

export type EndType = 'weld' | 'thread' | 'flange';

export interface Instance {
  uid: string;
  partId: string;
  pos: [number, number, number];
  rot: [number, number, number];
  spec: { dn: number; length?: number; endType?: EndType; smallDn?: number };
  open?: boolean;
  hidden?: boolean;
  groupId?: string;
}

export type ConnKind = 'flange' | 'thread' | 'weld' | 'bolt-slot' | 'nut' | 'clamp' | 'mechanical';

export interface ConnEnd { uid: string; port: string }

export interface Connection {
  id: string;
  kind: ConnKind;
  a: ConnEnd;
  b: ConnEnd;
  meta?: { t?: number; angle?: number; boltStack?: { underHead: number; grip: number } };
}

export interface Group { id: string; name: string; color: string }

export interface WState {
  instances: Instance[];
  connections: Connection[];
  groups: Group[];
}

export interface Plan {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  contentVersion: string;
  state: WState;
  taskProgress: Record<string, { completedAt: number; attempts: number }>;
  activeTask?: string;
}

export const WORKSHOP_CONTENT_VERSION = '2026-11-20.2';

export const CATEGORY_LABEL: Record<CategoryId, string> = {
  pipe: '管道与管件',
  flange: '法兰与连接附件',
  valve: '阀门',
  pump: '泵与旋转设备',
  heat: '换热设备',
  react: '反应与混合设备',
  sep: '分离与过滤设备',
  tank: '储存与容器',
  instr: '仪表与测量部件'
};

export const PORT_TYPE_LABEL: Record<PortType, string> = {
  flange: '法兰接口',
  thread: '螺纹接口',
  weld: '焊接接口',
  bolt: '螺栓孔位',
  nut: '螺纹副',
  clamp: '管夹安装位',
  mechanical: '机械配合'
};

export const MATERIAL_LABEL: Record<MaterialKind, string> = {
  'carbon-steel': '碳钢（教学示意）',
  stainless: '不锈钢（教学示意）',
  'cast-iron': '铸铁/铸钢（教学示意）',
  rubber: '非金属密封（教学示意）',
  alloy: '合金钢（教学示意）',
  ptfe: '聚四氟乙烯（教学示意）'
};

export const CAP_LABEL: Record<Capability, string> = {
  observe: '整体观察',
  section: '内部结构',
  connect: '接口连接',
  principle: '原理演示',
  disassemble: '部件拆装'
};
