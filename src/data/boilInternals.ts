import type { BoilModelKey } from '../engine/boilModels';

/**
 * 微沸喷烧 Phase 7：核心设备内部结构数据（教学示意）。
 *
 * - 只描述观察模式、内部部件名称/分组/教学说明与状态，不含任何尺寸、材质牌号、
 *   电气/热工参数、型号或厂家信息；
 * - 全部内部结构为参数化教学示意几何，不是设备图纸、制造依据或现场内部结构；
 * - 未提供的结构（喷枪接入位置、泵型、填料/极板规格等）在部件 note 与
 *   status=pending-confirmation 中显式标注，不补占位假值；
 * - 本文件不进入站点路由；页面集成在 Phase 7 之后的统一集成阶段进行。
 */

export const INTERNAL_DATA_VERSION = '2026-11-18.1';

export type InternalPartKind = 'shell' | 'liner' | 'internal' | 'drive' | 'gun' | 'flow' | 'duct';
export type InternalPartStatus = 'teaching-schematic' | 'pending-confirmation';

export interface InternalPartDef {
  id: string;
  name: string;
  /** 结构树分组名（中文，按设备组织） */
  group: string;
  kind: InternalPartKind;
  status: InternalPartStatus;
  note: string;
}

export interface EquipmentInternalsDef {
  modelKey: BoilModelKey;
  name: string;
  summary: string;
  boundaryNote: string;
  /** 外壳/主体部件的 id（与外部模型同体，不在内部几何中重复建造） */
  shellPartId: string;
  parts: InternalPartDef[];
  /** 教学动画说明（只用于演示，不是工艺过程） */
  animations: string[];
}

export const OBSERVATION_MODES = [
  {
    id: 'normal',
    label: '正常外观',
    en: 'NORMAL',
    note: '仅显示设备外壳与外部附件，内部结构隐藏；用于整体外观识别。'
  },
  {
    id: 'transparent',
    label: '透明观察',
    en: 'TRANSPARENT',
    note: '外壳半透明、内部教学结构同步显示；用于观察部件相对位置，不代表真实材质。'
  },
  {
    id: 'xray',
    label: 'X 射线',
    en: 'X-RAY',
    note: '外壳以蓝色线框幽灵显示，突出内部结构；为教学可视化，不是真实射线检测。'
  },
  {
    id: 'cutaway',
    label: '局部剖切',
    en: 'CUTAWAY',
    note: '外壳沿演示平面裁剪露出内部；裁剪面未做封口填充，不表示真实壁厚或截面。'
  },
  {
    id: 'internal',
    label: '内部观察',
    en: 'INTERNAL',
    note: '隐藏外壳，镜头聚焦内部；用于近距离观察内部教学结构。'
  }
] as const;

export type ObservationMode = (typeof OBSERVATION_MODES)[number]['id'];

export const OBSERVATION_MODE_IDS: ObservationMode[] = OBSERVATION_MODES.map((mode) => mode.id);

function part(
  id: string,
  name: string,
  group: string,
  kind: InternalPartKind,
  note: string,
  status: InternalPartStatus = 'teaching-schematic'
): InternalPartDef {
  return { id, name, group, kind, status, note };
}

const PENDING = 'pending-confirmation' as const;

export const BOIL_INTERNALS: Record<BoilModelKey, EquipmentInternalsDef> = {
  smp: {
    modelKey: 'smp',
    name: 'SMP装置',
    summary: '外部按接收/预处理教学单元示意；内部组成未提供，内部观察仅展示通用空腔与出料通道。',
    boundaryNote:
      'SMP 内部是否集成破碎、混合或泵送均未提供；空腔与通道为教学示意，不代表实际内部构成。',
    shellPartId: 'shell-body',
    animations: ['物料出料示踪'],
    parts: [
      part('shell-body', '壳体', '壳体与外部', 'shell', '装置外部壳体，教学示意，不代表实际结构与材料。'),
      part('feed-hopper', '进料斗内腔', '内部结构', 'internal', '进料斗内部空腔教学示意；内部导料结构未提供。', PENDING),
      part('inner-cavity', '内部空腔', '内部结构', 'internal', '通用内部空腔教学示意；内部组成、隔板与内件均未提供。', PENDING),
      part('discharge-channel', '出料通道', '内部结构', 'duct', '至破碎机的出料通道教学示意；接口尺寸与形式未提供。')
    ]
  },
  crusher: {
    modelKey: 'crusher',
    name: '破碎机',
    summary: '外部按进料斗 + 破碎腔 + 驱动教学示意；内部按通用转子/锤头结构演示，不代表具体机型。',
    boundaryNote: '破碎方式、转子/刀具型式与破碎腔结构未提供；转子与锤头为通用教学示意。',
    shellPartId: 'shell-body',
    animations: ['转子旋转', '出料示踪'],
    parts: [
      part('shell-body', '壳体', '壳体与外部', 'shell', '破碎机外部壳体，教学示意。'),
      part('feed-hopper', '进料斗内腔', '内部结构', 'internal', '进料斗内部空腔教学示意。', PENDING),
      part('crushing-cavity', '破碎腔', '内部结构', 'internal', '破碎腔体教学示意；腔型与衬板结构未提供。'),
      part('rotor', '转子', '内部结构', 'internal', '通用转子教学示意；转子型式与转速未提供。'),
      part('hammers', '锤头/刀具（教学）', '内部结构', 'internal', '按通用锤头布置示意，不代表实际刀具数量与形状。', PENDING),
      part('drive-motor', '驱动装置', '驱动', 'drive', '驱动电机与传动教学示意；功率与传动方式未提供。'),
      part('discharge-outlet', '出料口', '内部结构', 'duct', '出料通道教学示意。')
    ]
  },
  mixer: {
    modelKey: 'mixer',
    name: '混合器',
    summary: '外部按立式混合罐 + 顶部驱动示意；内部按搅拌轴/桨叶与演示液位显示。',
    boundaryNote: '混合方式、桨叶型式与容积未提供；演示液位不是真实液位或工艺参数。',
    shellPartId: 'shell-body',
    animations: ['搅拌桨旋转', '演示液位'],
    parts: [
      part('shell-body', '罐体', '壳体与外部', 'shell', '混合罐外部壳体，教学示意。'),
      part('top-drive', '顶部驱动', '驱动', 'drive', '顶部驱动装置教学示意；功率与减速方式未提供。'),
      part('shaft', '搅拌轴', '内部结构', 'internal', '搅拌轴教学示意；轴径与支撑方式未提供。'),
      part('impeller', '搅拌桨叶（教学）', '内部结构', 'internal', '按通用三叶桨示意，不代表实际桨型、层数与尺寸。', PENDING),
      part('liquid-level', '演示液位', '内部结构', 'flow', '课堂演示液位，不是真实液位计读数或工艺参数。'),
      part('outlet', '出料口', '内部结构', 'duct', '出料通道教学示意。')
    ]
  },
  'furnace-pump': {
    modelKey: 'furnace-pump',
    name: '炉塞泵',
    summary: '泵型未确认；内部按通用容积式泵（柱塞示意）显示，仅用于识别泵体、传动与进出口。',
    boundaryNote: '「炉塞泵」结构型式（柱塞/螺杆/其他）未提供；柱塞、阀门与传动均为通用教学示意。',
    shellPartId: 'pump-body',
    animations: ['柱塞往复（教学）', '进出口示踪'],
    parts: [
      part('pump-body', '泵体', '壳体与外部', 'shell', '泵体外部壳体教学示意；泵型未确认。'),
      part('piston', '柱塞/转子（待确认泵型）', '内部结构', 'internal', '按柱塞示意；泵型与内部运动未提供，不代表实际结构。', PENDING),
      part('inlet-valve', '入口单向阀（教学）', '内部结构', 'internal', '单向阀教学示意；阀型与流道未提供。', PENDING),
      part('outlet-valve', '出口单向阀（教学）', '内部结构', 'internal', '单向阀教学示意；阀型与流道未提供。', PENDING),
      part('coupling', '联轴器', '驱动', 'drive', '联轴器教学示意。'),
      part('motor-rotor', '电机转子', '驱动', 'drive', '驱动电机转子教学示意；功率未提供。'),
      part('inlet', '入口通道', '内部结构', 'duct', '入口通道教学示意。'),
      part('outlet', '出口通道', '内部结构', 'duct', '出口通道教学示意。')
    ]
  },
  'secondary-chamber': {
    modelKey: 'secondary-chamber',
    name: '二燃室',
    summary: '外部按立式燃烧室示意；内部显示内衬、燃烧空间、四根喷枪与焰流教学示意。',
    boundaryNote:
      '炉膛结构、燃烧组织与喷枪接入位置未提供；四根喷枪的位置/角度/喷入介质均为教学示意，流程数据中仍为待确认独立设备。',
    shellPartId: 'shell',
    animations: ['四支焰流脉动', '烟气出口示踪'],
    parts: [
      part('shell', '壳体', '壳体与外部', 'shell', '二燃室外部钢壳教学示意；不表示实际炉型。'),
      part('refractory-lining', '耐火内衬（教学）', '内部结构', 'liner', '内衬层次教学示意；材质与厚度未提供，不作为砌筑或设计依据。'),
      part('combustion-space', '燃烧空间', '内部结构', 'internal', '燃烧空间教学示意；炉膛形状与燃烧组织未提供。'),
      part('flame-zone', '焰流示意', '流线', 'flow', '教学动画，不是燃烧仿真或真实温度分布。'),
      part('gun-1', '喷枪 1', '喷枪', 'gun', '喷枪位置、角度、喷入介质与配比均为教学示意，待现场确认。', PENDING),
      part('gun-2', '喷枪 2', '喷枪', 'gun', '喷枪位置、角度、喷入介质与配比均为教学示意，待现场确认。', PENDING),
      part('gun-3', '喷枪 3', '喷枪', 'gun', '喷枪位置、角度、喷入介质与配比均为教学示意，待现场确认。', PENDING),
      part('gun-4', '喷枪 4', '喷枪', 'gun', '喷枪位置、角度、喷入介质与配比均为教学示意，待现场确认。', PENDING),
      part('gas-outlet', '烟气出口', '内部结构', 'duct', '烟气出口通道教学示意；与回转窑的连接关系待确认。'),
      part('ash-outlet', '底部排灰口（教学）', '内部结构', 'duct', '底部排灰教学示意；是否设置及形式未提供。', PENDING)
    ]
  },
  'spray-gun': {
    modelKey: 'spray-gun',
    name: '喷枪',
    summary: '外部按喷枪本体 + 支座示意；内部显示枪体通道、喷嘴与雾化/助燃通道教学结构。',
    boundaryNote: '喷入介质、来源、配比与喷嘴型式均未提供；内部通道为教学示意。',
    shellPartId: 'gun-body',
    animations: ['喷出示踪'],
    parts: [
      part('gun-body', '枪体', '壳体与外部', 'shell', '喷枪枪体教学示意；不表示实际型号。'),
      part('nozzle', '喷嘴（教学）', '内部结构', 'internal', '喷嘴型式与孔径未提供；按通用收缩喷嘴示意。', PENDING),
      part('feed-channel', '喷入介质通道', '内部结构', 'duct', '喷入介质与来源未提供；通道为教学示意。', PENDING),
      part('atomizing-channel', '雾化/助燃通道', '内部结构', 'duct', '雾化介质与助燃方式未提供；通道为教学示意。', PENDING),
      part('mounting-bracket', '支座', '壳体与外部', 'internal', '喷枪支座教学示意。')
    ]
  },
  'rotary-kiln': {
    modelKey: 'rotary-kiln',
    name: '回转窑',
    summary: '外部按筒体 + 轮带 + 托轮 + 传动示意；内部显示内衬、窑内空间、料床与驱动结构。',
    boundaryNote:
      '筒体尺寸、倾角、转速与内部运动未提供；内衬、料床与驱动为教学示意，不作为工艺或设备设计依据。',
    shellPartId: 'shell',
    animations: ['窑内烟气流向', '料床示踪'],
    parts: [
      part('shell', '筒体', '壳体与外部', 'shell', '回转窑筒体教学示意；尺寸与倾角未提供。'),
      part('refractory-lining', '耐火内衬（教学）', '内部结构', 'liner', '内衬层次教学示意；材质、厚度与砌筑方式未提供。'),
      part('kiln-space', '窑内空间', '内部结构', 'internal', '窑内空间教学示意；物料运动与停留时间未提供。'),
      part('feed-end', '进料端', '内部结构', 'internal', '进料端结构教学示意；密封与进料方式未提供。'),
      part('discharge-end', '出料端', '内部结构', 'internal', '出料端结构教学示意。'),
      part('support-rings', '轮带/支撑圈（教学）', '驱动', 'drive', '轮带布置教学示意；数量与尺寸未提供。'),
      part('support-rollers', '托轮（教学）', '驱动', 'drive', '托轮支撑教学示意；布置与承载能力未提供。'),
      part('drive-ring', '传动齿圈（教学）', '驱动', 'drive', '齿圈位置与规格为教学示意。'),
      part('drive-pinion', '传动小齿轮（教学）', '驱动', 'drive', '小齿轮与齿圈啮合为教学示意。'),
      part('drive-motor', '驱动装置', '驱动', 'drive', '驱动电机教学示意；功率与调速方式未提供。'),
      part('material-bed', '料床（教学）', '内部结构', 'flow', '窑内料床示意，不是真实物料分布或运动仿真。'),
      part('gas-flow', '窑内烟气流向', '流线', 'flow', '烟气流向教学示踪，不是 CFD 或热工计算。')
    ]
  },
  'quench-tower': {
    modelKey: 'quench-tower',
    name: '集冷塔',
    summary: '外部按立式塔器 + 裙座 + 顶部排气示意；内部显示三层喷淋、接触区与循环/排污水口。',
    boundaryNote:
      '冷却方式、塔内件与循环参数未提供；喷淋层数与位置为教学示意。集冷塔一/二为两个独立设备实例，共用同一教学内部结构。',
    shellPartId: 'shell',
    animations: ['喷淋液滴', '烟气上升示踪'],
    parts: [
      part('shell', '塔体', '壳体与外部', 'shell', '塔体外部壳体教学示意；塔径与塔高未提供。'),
      part('gas-inlet', '烟气入口', '内部结构', 'duct', '烟气入口通道教学示意。'),
      part('gas-outlet', '烟气出口', '内部结构', 'duct', '顶部烟气出口教学示意。'),
      part('spray-upper', '上层喷淋（教学）', '内部结构', 'internal', '喷淋层数与布置为教学示意；喷淋方式未提供。'),
      part('spray-middle', '中层喷淋（教学）', '内部结构', 'internal', '同上，喷淋层数为教学示意。', PENDING),
      part('spray-lower', '下层喷淋（教学）', '内部结构', 'internal', '同上，喷淋层数为教学示意。', PENDING),
      part('contact-zone', '气液接触区', '内部结构', 'internal', '气液接触区域教学示意；填料/内件是否设置未提供。'),
      part('circulation-inlet', '循环液接口（教学）', '内部结构', 'duct', '循环液接口教学示意；循环量未提供。', PENDING),
      part('drain-outlet', '排污口（教学）', '内部结构', 'duct', '排污水口教学示意。', PENDING),
      part('liquid-flow', '喷淋液滴示踪', '流线', 'flow', '液滴为教学示踪，不是流体仿真或真实流量。')
    ]
  },
  baghouse: {
    modelKey: 'baghouse',
    name: '布袋除尘器',
    summary: '外部按箱体 + 灰斗 + 顶部喷吹管示意；内部显示滤袋、花板、净气室、灰斗与粉尘捕集示踪。',
    boundaryNote:
      '滤袋数量、材质、清灰方式与箱体结构未提供；12 条滤袋为教学布置，不代表工程数量；粉尘示踪为教学动画。',
    shellPartId: 'shell',
    animations: ['粉尘捕集示踪', '内部气流示踪'],
    parts: [
      part('shell', '箱体', '壳体与外部', 'shell', '除尘器箱体教学示意；结构与板厚未提供。'),
      part('hopper', '灰斗', '内部结构', 'internal', '灰斗教学示意；角度与容积未提供。'),
      part('dirty-chamber', '含尘气室', '内部结构', 'internal', '含尘侧气室教学示意。'),
      part('clean-air-chamber', '净气室', '内部结构', 'internal', '净气室教学示意；与出口连接方式未提供。'),
      part('tube-sheet', '花板', '内部结构', 'internal', '花板教学示意；孔位与规格未提供。'),
      part('filter-bags', '滤袋组（教学布置）', '内部结构', 'internal', '12 条滤袋为教学布置，不代表实际数量、材质或尺寸。', PENDING),
      part('gas-inlet', '进气口', '内部结构', 'duct', '进气口通道教学示意。'),
      part('gas-outlet', '出气口', '内部结构', 'duct', '出气口通道教学示意。'),
      part('pulse-jets', '喷吹管（教学）', '内部结构', 'internal', '顶部喷吹管教学示意；清灰方式与参数未提供。', PENDING),
      part('dust-capture', '粉尘捕集示踪', '流线', 'flow', '粉尘颗粒为教学示踪，不是真实粉尘浓度或捕集效率。'),
      part('airflow', '内部气流示踪', '流线', 'flow', '气流为教学示踪，不是 CFD 或流场分析。')
    ]
  },
  'comprehensive-tower': {
    modelKey: 'comprehensive-tower',
    name: '综合塔',
    summary: '外部按立式塔器示意；内部显示两层填料、两层喷淋、循环槽与循环回路教学结构。',
    boundaryNote:
      '塔型与吸收/中和工艺未确认；填料类型、层数与循环参数未提供；填料与喷淋为教学示意。源清单「中合塔」写法待统一。',
    shellPartId: 'shell',
    animations: ['喷淋液滴', '烟气上升示踪'],
    parts: [
      part('shell', '塔体', '壳体与外部', 'shell', '塔体外部壳体教学示意。'),
      part('gas-inlet', '烟气入口', '内部结构', 'duct', '烟气入口通道教学示意。'),
      part('gas-outlet', '烟气出口', '内部结构', 'duct', '顶部烟气出口教学示意。'),
      part('packing-lower', '下层填料（教学）', '内部结构', 'internal', '填料类型、规格与层数为教学示意，未提供。', PENDING),
      part('packing-upper', '上层填料（教学）', '内部结构', 'internal', '同上，填料层为教学示意。', PENDING),
      part('spray-lower', '下层喷淋（教学）', '内部结构', 'internal', '喷淋布置为教学示意。'),
      part('spray-upper', '上层喷淋（教学）', '内部结构', 'internal', '喷淋布置为教学示意。'),
      part('sump', '循环槽', '内部结构', 'internal', '塔底循环槽教学示意；容积与液位未提供。'),
      part('circulation-loop', '循环液回路（教学）', '内部结构', 'duct', '循环回路教学示意；循环量、泵与管径未提供。'),
      part('gas-flow', '烟气上升示踪', '流线', 'flow', '气流为教学示踪，不是 CFD 或传质计算。'),
      part('liquid-flow', '喷淋液滴示踪', '流线', 'flow', '液滴为教学示踪，不是真实喷淋密度。')
    ]
  },
  'wash-tower': {
    modelKey: 'wash-tower',
    name: '水洗塔',
    summary: '外部按立式水洗塔示意；内部显示喷淋层、接触区、除雾器、循环槽与气液示踪。',
    boundaryNote: '喷淋方式、水质与循环量未提供；喷淋与除雾器为教学示意。',
    shellPartId: 'shell',
    animations: ['喷淋液滴', '烟气上升示踪'],
    parts: [
      part('shell', '塔体', '壳体与外部', 'shell', '塔体外部壳体教学示意。'),
      part('gas-inlet', '烟气入口', '内部结构', 'duct', '烟气入口通道教学示意。'),
      part('gas-outlet', '烟气出口', '内部结构', 'duct', '烟气出口教学示意。'),
      part('spray-layer', '喷淋层（教学）', '内部结构', 'internal', '喷淋层数、喷嘴与布置为教学示意。', PENDING),
      part('contact-zone', '气液接触区', '内部结构', 'internal', '气液接触区教学示意；内件形式未提供。'),
      part('mist-eliminator', '除雾器（教学）', '内部结构', 'internal', '除雾器形式与效率未提供；按折板示意。', PENDING),
      part('sump', '循环槽', '内部结构', 'internal', '塔底循环槽教学示意。'),
      part('gas-flow', '烟气上升示踪', '流线', 'flow', '气流为教学示踪，不是流场分析。'),
      part('liquid-flow', '喷淋液滴示踪', '流线', 'flow', '液滴为教学示踪，不是真实喷淋密度。')
    ]
  },
  'wet-esp': {
    modelKey: 'wet-esp',
    name: '湿电除尘',
    summary: '外部按湿式电除尘壳体 + 顶部绝缘子示意；内部显示电场区、集尘极板、放电极线与冲洗结构。',
    boundaryNote:
      '电场布置、极板/极线规格、电气参数与冲洗方式未提供；极板 5 块、极线 4 根为教学布置；带电区域为视觉示意，无可操作电气参数。',
    shellPartId: 'shell',
    animations: ['电场辉光（教学）', '烟气流向示踪'],
    parts: [
      part('shell', '壳体', '壳体与外部', 'shell', '湿电壳体教学示意。'),
      part('gas-inlet', '烟气入口', '内部结构', 'duct', '烟气入口通道教学示意。'),
      part('gas-outlet', '烟气出口', '内部结构', 'duct', '烟气出口教学示意。'),
      part('field-zone', '电场区（教学）', '内部结构', 'internal', '电场区域视觉示意；电压/电流等参数未提供，不可操作。', PENDING),
      part('collecting-plates', '集尘极板（教学）', '内部结构', 'internal', '5 块极板为教学布置；材质、间距与尺寸未提供。', PENDING),
      part('discharge-wires', '放电极线（教学）', '内部结构', 'internal', '4 根极线为教学布置；型式与电气参数未提供。', PENDING),
      part('flushing-header', '冲洗喷淋（教学）', '内部结构', 'internal', '冲洗方式与水量未提供；按顶部喷淋管示意。', PENDING),
      part('hopper', '灰斗/集液斗', '内部结构', 'internal', '底部集液斗教学示意。'),
      part('gas-flow', '烟气流向示踪', '流线', 'flow', '气流为教学示踪，不是电场或流场仿真。')
    ]
  },
  'id-fan': {
    modelKey: 'id-fan',
    name: '引风机',
    summary: '外部按离心式风机壳体 + 电机示意；内部显示叶轮、主轴、联轴器、电机转子与进出风通道。',
    boundaryNote:
      '风机型式、叶轮与风量/风压未提供；叶片数量与流道为教学示意；旋转动画仅表示转向，不代表真实转速。',
    shellPartId: 'volute',
    animations: ['叶轮旋转', '气流方向示踪'],
    parts: [
      part('volute', '蜗壳', '壳体与外部', 'shell', '蜗壳外部壳体教学示意；不表示实际气动型线。'),
      part('impeller', '叶轮（教学）', '内部结构', 'internal', '叶轮型式、叶片数与直径未提供；按通用后向叶片示意。', PENDING),
      part('shaft', '主轴', '驱动', 'drive', '主轴教学示意。'),
      part('coupling', '联轴器', '驱动', 'drive', '联轴器/传动教学示意；传动方式未提供。'),
      part('motor', '电机', '驱动', 'drive', '驱动电机教学示意；功率未提供。'),
      part('motor-rotor', '电机转子', '驱动', 'drive', '电机转子教学示意。'),
      part('inlet', '进风口', '内部结构', 'duct', '进风口与集流器教学示意。'),
      part('outlet', '出风口', '内部结构', 'duct', '出风通道教学示意。'),
      part('airflow', '气流方向示踪', '流线', 'flow', '气流为教学示踪，不是风量/风压实测。')
    ]
  },
  stack: {
    modelKey: 'stack',
    name: '烟囱',
    summary: '外部按锥形烟囱 + 基础示意；内部显示内筒/内衬、采样接口与排放气流示踪。',
    boundaryNote:
      '排放高度、内衬、监测与排放参数未提供；采样接口为教学示意，不表示实际监测点位；不假定排放达标。',
    shellPartId: 'stack-shell',
    animations: ['排放气流示踪'],
    parts: [
      part('stack-shell', '烟囱筒体', '壳体与外部', 'shell', '烟囱外部筒体教学示意；高度与坡度不代表实际。'),
      part('inner-flue', '内筒/内衬（教学）', '内部结构', 'liner', '内筒或内衬层次教学示意；材质与厚度未提供。'),
      part('base', '基础', '壳体与外部', 'internal', '基础教学示意；结构尺寸未提供。'),
      part('sampling-port', '采样/监测接口（教学）', '内部结构', 'duct', '采样或监测接口为教学示意；位置、数量与仪表未提供。', PENDING),
      part('emission-flow', '排放气流示踪', '流线', 'flow', '气流为教学示踪，不代表真实排放状态或达标结论。')
    ]
  }
};

export const INTERNAL_MODEL_KEYS = Object.keys(BOIL_INTERNALS) as BoilModelKey[];

export interface InternalAudit {
  errors: string[];
  warnings: string[];
  counts: {
    models: number;
    parts: number;
    pending: number;
    modes: number;
    animations: number;
  };
}

/** 数据自检：模式、部件 id/名称/说明、喷枪独立性与待确认标注。不建几何、不依赖浏览器。 */
export function auditInternalsDefinitions(): InternalAudit {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<BoilModelKey>();
  let parts = 0;
  let pending = 0;
  let animations = 0;

  if (OBSERVATION_MODES.length !== 5) errors.push(`观察模式应为 5 种，实际 ${OBSERVATION_MODES.length}`);
  const modeIds = new Set(OBSERVATION_MODES.map((mode) => mode.id));
  for (const id of ['normal', 'transparent', 'xray', 'cutaway', 'internal'] as const) {
    if (!modeIds.has(id)) errors.push(`缺少观察模式：${id}`);
  }

  for (const key of INTERNAL_MODEL_KEYS) {
    if (seen.has(key)) errors.push(`设备内部定义重复：${key}`);
    seen.add(key);
    const def = BOIL_INTERNALS[key];
    if (!def.summary.trim()) errors.push(`${key} 缺少 summary`);
    if (!def.boundaryNote.trim()) errors.push(`${key} 缺少边界说明`);
    if (!def.parts.some((p) => p.id === def.shellPartId)) {
      errors.push(`${key} 的 shellPartId「${def.shellPartId}」未出现在部件清单`);
    }
    const ids = new Set<string>();
    for (const p of def.parts) {
      parts += 1;
      if (ids.has(p.id)) errors.push(`${key} 部件 id 重复：${p.id}`);
      ids.add(p.id);
      if (!p.name.trim()) errors.push(`${key}.${p.id} 缺少名称`);
      if (p.note.trim().length < 6) errors.push(`${key}.${p.id} 教学说明过短`);
      if (p.status === 'pending-confirmation') pending += 1;
      if (!['shell', 'liner', 'internal', 'drive', 'gun', 'flow', 'duct'].includes(p.kind)) {
        errors.push(`${key}.${p.id} 部件类型非法：${p.kind}`);
      }
      if (!p.group.trim()) errors.push(`${key}.${p.id} 缺少结构树分组`);
    }
    if (key === 'secondary-chamber') {
      for (let i = 1; i <= 4; i += 1) {
        const gunId = `gun-${i}`;
        const gun = def.parts.find((p) => p.id === gunId);
        if (!gun) errors.push(`二燃室缺少独立喷枪部件 ${gunId}`);
        else if (gun.status !== 'pending-confirmation') {
          errors.push(`喷枪 ${gunId} 必须标注待确认（接入位置/介质未提供）`);
        }
      }
    }
    if (def.animations.length === 0) warnings.push(`${key} 没有教学动画条目`);
    animations += def.animations.length;
    for (const text of [def.summary, def.boundaryNote, ...def.parts.map((p) => p.note)]) {
      if (/\d+\s*(℃|MPa|kPa|Pa|m³|m3|t\/h|mg\/m³|kV|kW|r\/min|%|ppm)/i.test(text)) {
        errors.push(`${key} 文本含疑似工程参数数值：${text}`);
      }
    }
  }

  if (INTERNAL_MODEL_KEYS.length !== 14) errors.push(`内部结构定义应为 14 类，实际 ${INTERNAL_MODEL_KEYS.length}`);
  return { errors, warnings, counts: { models: INTERNAL_MODEL_KEYS.length, parts, pending, modes: OBSERVATION_MODES.length, animations } };
}
