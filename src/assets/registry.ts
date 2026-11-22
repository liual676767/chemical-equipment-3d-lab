export type AssetCategory = 'pump' | 'valve' | 'filter' | 'piping' | 'accessory';

export interface UploadAsset {
  id: string;
  name: string;
  category: AssetCategory;
  categoryLabel: string;
  file: string;
  preview: string;
  /** 站内可对照的教学设备 id */
  matches: string[];
  /** 与站内教学设备的差异说明 */
  note: string;
  tris: number;
  meshes: number;
  materials: number;
  bytes: number;
  /** 上传包内原始对象名（台账用） */
  source: string;
}

/** 用户上传的知末网工业设备素材：仅外观展示，不含内部教学结构 */
export const UPLOAD_ASSETS: UploadAsset[] = [
  {
    id: 'pump-skid',
    name: '卧式离心泵组',
    category: 'pump',
    categoryLabel: '泵与驱动',
    file: './models/uploads/pump-skid.glb',
    preview: './models/uploads/previews/pump-skid.jpg',
    matches: ['pump'],
    note: '含电机、联轴器护罩与底座的卧式机组外观。泵型、吸排接口和安装基准尚待确认。供外观对照，站内蜗壳、叶轮、密封与轴系使用独立教学结构。',
    tris: 177057,
    meshes: 64,
    materials: 9,
    bytes: 1135976,
    source: 'Group-1060089-51-84'
  },
  {
    id: 'vertical-pump',
    name: '立式离心泵',
    category: 'pump',
    categoryLabel: '泵与驱动',
    file: './models/uploads/vertical-pump.glb',
    preview: './models/uploads/previews/vertical-pump.jpg',
    matches: ['pump'],
    note: '立式电机直连泵外观，适合展示槽罐旁的立式布置。无内部流道与密封结构。',
    tris: 154285,
    meshes: 46,
    materials: 7,
    bytes: 1041796,
    source: 'Group-1060089-288-752'
  },
  {
    id: 'diaphragm-pump',
    name: '气动双隔膜泵',
    category: 'pump',
    categoryLabel: '泵与驱动',
    file: './models/uploads/diaphragm-pump.glb',
    preview: './models/uploads/previews/diaphragm-pump.jpg',
    matches: ['diaphragm-pump'],
    note: '双腔隔膜泵外观，含气阀与进出口。隔膜、球阀与换向通道等内部件以站内教学模型为准。',
    tris: 9766,
    meshes: 6,
    materials: 5,
    bytes: 155836,
    source: 'Group-1060089-242-671'
  },
  {
    id: 'lobe-pump',
    name: '转子泵（相近泵型）',
    category: 'pump',
    categoryLabel: '泵与驱动',
    file: './models/uploads/lobe-pump.glb',
    preview: './models/uploads/previews/lobe-pump.jpg',
    matches: ['gear-pump'],
    note: '转子泵外观示意，与外啮合齿轮泵不是同一结构。仅作相近容积泵的形体对照，不作为齿轮泵结构依据。',
    tris: 11227,
    meshes: 9,
    materials: 6,
    bytes: 178584,
    source: 'Group-1060089-337-860'
  },
  {
    id: 'ball-valve',
    name: '法兰球阀（带执行机构）',
    category: 'valve',
    categoryLabel: '阀门',
    file: './models/uploads/ball-valve.glb',
    preview: './models/uploads/previews/ball-valve.jpg',
    matches: ['ball-valve'],
    note: '带执行机构的法兰球阀外观。球体通孔、阀座与填料等内部结构以站内教学模型为准。',
    tris: 32828,
    meshes: 12,
    materials: 2,
    bytes: 404208,
    source: 'Group-1060089-186-626'
  },
  {
    id: 'gate-valve',
    name: '明杆闸阀',
    category: 'valve',
    categoryLabel: '阀门',
    file: './models/uploads/gate-valve.glb',
    preview: './models/uploads/previews/gate-valve.jpg',
    matches: ['gate-valve'],
    note: '明杆闸阀外观，含手轮、阀杆、法兰与螺栓。楔式闸板与阀座密封面以站内教学模型为准。',
    tris: 31672,
    meshes: 17,
    materials: 6,
    bytes: 394012,
    source: 'Group-1060089-313-889'
  },
  {
    id: 'globe-valve',
    name: '法兰截止阀',
    category: 'valve',
    categoryLabel: '阀门',
    file: './models/uploads/globe-valve.glb',
    preview: './models/uploads/previews/globe-valve.jpg',
    matches: [],
    note: '法兰截止阀外观。站内未设截止阀教学设备，可作阀类外形对照。',
    tris: 57432,
    meshes: 13,
    materials: 3,
    bytes: 391084,
    source: 'Group-1060089-193-209'
  },
  {
    id: 'butterfly-valve',
    name: '对夹式蝶阀',
    category: 'valve',
    categoryLabel: '阀门',
    file: './models/uploads/butterfly-valve.glb',
    preview: './models/uploads/previews/butterfly-valve.jpg',
    matches: ['butterfly-valve'],
    note: '对夹式蝶阀外观。蝶板、阀杆与阀座内部结构以站内教学模型为准。',
    tris: 2086,
    meshes: 4,
    materials: 3,
    bytes: 44736,
    source: 'Group-1060089-182-657'
  },
  {
    id: 'y-strainer',
    name: 'Y 型过滤器（外观）',
    category: 'filter',
    categoryLabel: '过滤与分离',
    file: './models/uploads/y-strainer.glb',
    preview: './models/uploads/previews/y-strainer.jpg',
    matches: ['y-strainer'],
    note: 'Y 型过滤器外形。滤网、排污塞与流道内部以站内教学模型为准。',
    tris: 5687,
    meshes: 3,
    materials: 2,
    bytes: 94860,
    source: 'Group-1060089-191-463'
  },
  {
    id: 'bag-filter',
    name: '篮式过滤器（外观）',
    category: 'filter',
    categoryLabel: '过滤与分离',
    file: './models/uploads/bag-filter.glb',
    preview: './models/uploads/previews/bag-filter.jpg',
    matches: ['bag-filter'],
    note: '篮式过滤器外形。与站内单袋式过滤器的滤袋、支撑篮结构不同，仅作过滤器外形对照。',
    tris: 7680,
    meshes: 9,
    materials: 6,
    bytes: 125140,
    source: 'Group-1060089-319-765'
  },
  {
    id: 'expansion-joint',
    name: '法兰橡胶膨胀节',
    category: 'piping',
    categoryLabel: '管道与管件',
    file: './models/uploads/expansion-joint.glb',
    preview: './models/uploads/previews/expansion-joint.jpg',
    matches: [],
    note: '管道膨胀节外观，可用于管路布置参考。无内部导流筒与限位结构。',
    tris: 5041,
    meshes: 2,
    materials: 1,
    bytes: 76192,
    source: 'Group-1060089-190-206'
  },
  {
    id: 'small-vessel',
    name: '小型压力容器',
    category: 'accessory',
    categoryLabel: '容器与附件',
    file: './models/uploads/small-vessel.glb',
    preview: './models/uploads/previews/small-vessel.jpg',
    matches: ['gas-separator'],
    note: '立式小型压力容器外观。无法确认内部为气液分离结构，不作为站内分离器的结构依据。',
    tris: 4848,
    meshes: 4,
    materials: 3,
    bytes: 30992,
    source: 'Group-1060089-1-797'
  },
  {
    id: 'control-box',
    name: '现场控制箱',
    category: 'accessory',
    categoryLabel: '容器与附件',
    file: './models/uploads/control-box.glb',
    preview: './models/uploads/previews/control-box.jpg',
    matches: [],
    note: '带压力表的现场控制箱外观。表盘读数为静态模型显示，不是实时数据。',
    tris: 11742,
    meshes: 17,
    materials: 4,
    bytes: 190000,
    source: 'Group-1060089-308-390'
  }
];

export const assetById = (id: string) => UPLOAD_ASSETS.find((a) => a.id === id);
export const assetsForDevice = (deviceId: string) => UPLOAD_ASSETS.filter((a) => a.matches.includes(deviceId));
