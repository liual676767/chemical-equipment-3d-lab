import type { DeviceDef } from './types';
import { VALVE_OPERATIONS } from './valveOperations';

/**
 * 18 台教学示意设备的统一配置（原有 3 台 + 第三批扩展 15 台）。
 * 坐标约定：泵/阀门/换热器/流量计主轴沿 X 轴，塔罐类主轴沿 Y 轴，Y 向上，单位约为米。
 * 新增设备：在此追加 DeviceDef，并在 engine/builders.ts 中实现对应零件建模函数；
 * 提交前运行 npm run validate:content 检查必填项、编号、安装目标与步骤依赖。
 * 结构依据与待专业确认事项见 docs/sources-and-review.md。
 */

export const pump: DeviceDef = {
  id: 'pump',
  name: '单级离心泵',
  category: 'pump',
  categoryLabel: '泵与压缩设备',
  contentVersion: '2026-11-20.1',
  use: '输送清水及物理化学性质类似于水的液体，是化工装置中最常见的流体输送设备。',
  principle:
    '电机通过联轴器带动泵轴与叶轮高速旋转，液体从轴向吸入口进入叶轮中心，在叶片作用下获得动能与压力能，沿蜗壳流道汇集后从切向排出口排出，形成连续输送。',
  structureNote:
    '工业级教学示意重建：真实蜗壳流道（变截面螺线通道与壁厚，喉部与排出接管贯通）、6 片曲面叶片闭式叶轮、阶梯泵轴与平键、机械密封（动环/静环/弹簧/压盖/轴套/密封圈）、两套滚动轴承（内外圈/滚动体/保持架/端盖）、泵盖垫片与 8 条连接螺栓、电机定子/转子/风扇、刚性凸缘联轴器，以及连接吸排口的真实中空管道（直段/弯头/法兰/垫片/螺栓/异径管/支架）。无工程数据处采用界面标注的演示参数，不替代制造图纸。',
  learningPoints: [
    '理解「轴向吸入、切向排出」的蜗壳流道特点',
    '认识叶轮是唯一对液体做功的部件',
    '掌握泵轴—密封—轴承—联轴器的轴系支承与连接关系',
    '熟悉后拆式检修顺序：先联轴器、电机，再泵盖、叶轮',
    '观察机械密封与滚动轴承的内部组成，理解密封与支承原理'
  ],
  objectives: [
    '能指认泵体、叶轮、轴系、密封、轴承、联轴器、电机、底座与管道主要部件',
    '能描述液体从吸入口到排出口的能量转换路径',
    '能按后拆式检修顺序独立完成一次拆卸与组装复原'
  ],
  tasks: [
    { id: 'p-find-impeller', text: '在整体观察中找到叶轮，观察叶片数量与弯曲方向', mode: 'observe', partId: 'impeller' },
    {
      id: 'p-route-impeller',
      text: '沿吸入口观察液体到达哪里，再回到剖视图上指出叶轮',
      mode: 'endoscope',
      partId: 'impeller',
      exercise: {
        observe: {
          startStop: 0,
          requiredStop: 4,
          prompt: '从吸入口进入内窥视点，沿液流方向逐站前进，观察液体经过弯头、吸入管、泵吸入口，最终到达叶轮进口（叶轮眼）。',
          reachedNote: '已到达叶轮眼：液体从这里轴向进入叶轮。现在回到剖视图，自己找出叶轮。'
        },
        identify: {
          axis: 'z',
          position: 0.5,
          flip: true,
          prompt: '在轴向剖视图中点击模型，或从左侧零件目录选择你认为的叶轮。',
          answerPartId: 'impeller',
          answerName: '叶轮',
          wrongHint: '线索：叶轮是唯一对液体做功的转动部件，装在泵轴前端、叶轮眼之后，带多片弯曲叶片；它是泵体组里的铜色转动件，不是外侧的蜗壳、入口管道或电机。',
          successNote: '正确：液体从叶轮眼轴向进入，被 6 片后弯叶片甩向蜗壳；叶轮以平键与轴端螺母固定在泵轴前端，是泵中唯一对液体做功的部件。'
        }
      }
    },
    { id: 'p-xray-casing', text: '用透明观察查看蜗壳内部流道与叶轮的位置关系', mode: 'xray', partId: 'casing' },
    { id: 'p-explode-shaft', text: '在爆炸图中比较泵轴、密封、轴承、联轴器的轴向连接关系', mode: 'explode', partId: 'shaft' },
    { id: 'p-principle-flow', text: '播放工作原理动画，指出轴向吸入与切向排出口', mode: 'principle' },
    { id: 'p-practice', text: '完成一次完整的拆卸与组装练习', mode: 'practice', auto: 'practice-completion' }
  ],
  keywords: ['离心泵', '叶轮', '蜗壳', '泵轴', '机械密封', '轴承', '联轴器', '电机', '底座', '管道', '水泵', '流体'],
  trayZ: 1.7,
  principleAnim: 'pump',
  assemblyOrder: ['casing', 'bearing', 'shaft', 'seal', 'impeller', 'cover', 'motor', 'coupling'],
  parts: [
    {
      id: 'base', name: '底座', group: '支承与连接', color: 0x4b5563,
      joint: 'anchor', role: 'fixed',
      desc: '公共底座：工字钢与钢板焊接结构，上平面加工保证泵体与电机安装高度一致，通过地脚螺栓固定在基础上。教学模型中为固定连接，不可拆卸。',
      pos: [0.25, 0.075, 0], explodeDir: [0, -1, 0], explodeDist: 0.5, fixed: true,
      labelOffset: [0, 0.1, 0.55]
    },
    {
      id: 'casing', name: '泵壳（蜗壳）', group: '泵体', color: 0x5b7a9d, shell: true,
      joint: 'bolted', role: 'removable',
      desc: '蜗壳形泵壳：内部为沿旋转方向截面逐渐扩大的真实螺旋流道，把叶轮甩出的高速液体动能转化为压力能并汇集到切向排出口；轴向为吸入口。带铸造加强筋、密封结合面、进出口法兰与螺栓孔。与泵盖以螺栓连接。',
      pos: [-1.0, 0.78, 0], explodeDir: [-0.55, 0.85, 0], explodeDist: 1.5,
      removable: true, prereq: [], removeAfter: ['shaft', 'motor'],
      tip: '泵壳是最后拆下的主体零件。确认轴系与电机均已移开后，选中泵壳点击「拆下」。',
      labelOffset: [0, 0.75, 0]
    },
    {
      id: 'impeller', name: '叶轮', group: '泵体', color: 0xc9973f,
      joint: 'fitted', role: 'removable',
      desc: '闭式叶轮：轮毂与前后盖板之间布置 6 片真实三维后弯叶片，是泵中唯一对液体做功的部件。液体从叶轮进口（叶轮眼）轴向进入，被叶片带动旋转后沿径向流道甩出。以平键与轴端螺母固定在泵轴前端。',
      pos: [-1.0, 0.78, 0], explodeDir: [-1, 0.4, 0], explodeDist: 1.15,
      removable: true, orientable: true, prereq: ['shaft', 'seal'], removeAfter: ['cover'],
      tip: '叶轮装在泵轴前端，由泵盖轴向限位。先拆泵盖，再选中叶轮点击「拆下」。',
      labelOffset: [0, 0.5, 0]
    },
    {
      id: 'cover', name: '泵盖', group: '泵体', color: 0x8fa6bc, shell: true,
      joint: 'bolted', role: 'removable',
      desc: '泵盖（后盖）：封闭泵壳后端并支承密封腔，与泵壳止口配合保证同心；结合面设垫片，并以 8 条沿圆周均布的螺栓紧固（与泵壳法兰同孔距）。后拆式检修时先拆泵盖，即可抽出转子部件而不必拆开进出口管路。',
      pos: [-0.7, 0.78, 0], explodeDir: [0.5, 0.9, 0], explodeDist: 1.05,
      removable: true, orientable: true, prereq: ['impeller'], removeAfter: [],
      tip: '泵盖压住叶轮与密封。拆下联轴器与电机后，选中泵盖点击「拆下」。',
      labelOffset: [0, 0.55, 0]
    },
    {
      id: 'wearRing', name: '口环（密封环）', group: '泵体', color: 0x8a94a0,
      joint: 'fitted', role: 'removable',
      desc: '口环（耐磨密封环）：分别装在泵壳与泵盖的进口孔处，与叶轮进口外圆构成很小的环形间隙，减少高压区向吸入口的回流。属易损件，间隙超差后更换。演示尺寸，非工程数据。',
      pos: [-0.9, 0.78, 0], explodeDir: [-1, 0.5, 0], explodeDist: 0.95,
      removable: true,
      labelOffset: [0, 0.28, 0]
    },
    {
      id: 'seal', name: '密封腔座', group: '密封系统', color: 0x3f8f6b,
      joint: 'bolted', role: 'removable',
      desc: '密封腔座：位于泵盖与叶轮之间、轴穿出处，为机械密封提供安装腔与静环座，压盖以螺栓固定在腔座上；腔座以筒形腔体与泵盖后端面相连。',
      pos: [-0.5, 0.78, 0], explodeDir: [0.2, 1, 0], explodeDist: 1.4,
      removable: true, prereq: ['shaft'], removeAfter: ['impeller'],
      tip: '密封腔座套在泵轴上、位于叶轮之后。叶轮拆下后，选中密封腔座点击「拆下」。',
      labelOffset: [0, 0.35, 0]
    },
    {
      id: 'sealStatic', name: '静环', group: '密封系统', color: 0x4a7f66,
      joint: 'fitted', role: 'removable',
      desc: '机械密封静环：装在密封腔座上不随轴转动，与动环端面贴合形成密封面，由防转销与密封圈定位。',
      pos: [-0.5, 0.78, 0], explodeDir: [0, 1, 0], explodeDist: 1.25,
      removable: true,
      labelOffset: [0, 0.2, 0]
    },
    {
      id: 'sealRotary', name: '动环', group: '密封系统', color: 0x5aa382,
      joint: 'fitted', role: 'removable',
      desc: '机械密封动环：随泵轴一起转动，在弹簧力与介质压力作用下与静环端面压紧贴合，形成动密封；通过传动座与轴套联动。',
      pos: [-0.5, 0.78, 0], explodeDir: [0, 1, 0], explodeDist: 1.35,
      removable: true,
      labelOffset: [0, 0.2, 0]
    },
    {
      id: 'sealSpring', name: '弹簧', group: '密封系统', color: 0x9aa5b1,
      joint: 'fitted', role: 'removable',
      desc: '机械密封弹簧：沿圆周布置的螺旋弹簧组，提供动环与静环端面间的初始压紧力，补偿磨损与轴向窜动。',
      pos: [-0.5, 0.78, 0], explodeDir: [0, 1, 0], explodeDist: 1.55,
      removable: true,
      labelOffset: [0, 0.22, 0]
    },
    {
      id: 'sealGland', name: '密封压盖', group: '密封系统', color: 0x7d8fa3, shell: true,
      joint: 'bolted', role: 'removable',
      desc: '密封压盖：以螺栓固定在密封腔座上，压住静环与密封圈并提供冷却冲洗接口。透明模式或单独隐藏后可清楚观察动环、静环与弹簧。',
      pos: [-0.45, 0.78, 0], explodeDir: [0.2, 1, 0], explodeDist: 1.7,
      removable: true,
      labelOffset: [0, 0.28, 0]
    },
    {
      id: 'sealSleeve', name: '轴套', group: '密封系统', color: 0xb9c2cc,
      joint: 'fitted', role: 'removable',
      desc: '密封轴套：套在泵轴上并随轴转动，保护泵轴不被密封圈磨损，同时作为动环传动座的支承面。',
      pos: [-0.5, 0.78, 0], explodeDir: [0.1, 1, 0], explodeDist: 1.85,
      removable: true,
      labelOffset: [0, 0.18, 0]
    },
    {
      id: 'sealOrings', name: '密封圈组', group: '密封系统', color: 0x2f6f55,
      joint: 'fitted', role: 'removable',
      desc: '密封圈组：O 形橡胶密封圈，用于静环与腔座、压盖与腔座之间的辅助静密封，防止介质沿结合面渗漏。',
      pos: [-0.5, 0.78, 0], explodeDir: [0, 1, 0], explodeDist: 1.95,
      removable: true,
      labelOffset: [0, 0.16, 0]
    },
    {
      id: 'shaft', name: '泵轴', group: '轴系', color: 0xb9c2cc,
      joint: 'fitted', role: 'removable',
      desc: '阶梯泵轴：直径分段变化并用轴肩为叶轮、密封轴套与轴承内圈提供轴向定位；叶轮与联轴器处设平键槽，后端为联轴器配合端。传递电机扭矩并支承叶轮，与各配合件保持同轴。',
      pos: [-0.16, 0.78, 0], explodeDir: [0, 1, 0], explodeDist: 1.75,
      removable: true, prereq: ['bearing'], removeAfter: ['impeller', 'seal', 'coupling'],
      tip: '泵轴须在叶轮、密封与联轴器全部拆下后才能抽出。选中泵轴点击「拆下」。',
      labelOffset: [0, 0.3, 0]
    },
    {
      id: 'keys', name: '平键组', group: '轴系', color: 0x8a94a0,
      joint: 'fitted', role: 'removable',
      desc: '平键组：叶轮键与联轴器键，嵌在泵轴键槽与轮毂键槽之间，传递扭矩并防止相对转动。',
      pos: [-0.16, 0.78, 0], explodeDir: [0, 1, 0], explodeDist: 2.05,
      removable: true,
      labelOffset: [0, 0.14, 0]
    },
    {
      id: 'bearing', name: '轴承箱', group: '轴系', color: 0x9aa5b1, shell: true,
      joint: 'bolted', role: 'removable',
      desc: '轴承箱：内装两套滚动轴承，支承泵轴并承受径向与轴向载荷，下部托架用螺栓固定在底座上；两端的轴承端盖封闭箱体并调节轴承游隙。',
      pos: [0.3, 0.78, 0], explodeDir: [0.35, 0.95, 0], explodeDist: 1.5,
      removable: true, prereq: ['casing'], removeAfter: ['coupling', 'seal'],
      tip: '轴承箱托住泵轴。联轴器与密封拆下后，选中轴承箱点击「拆下」。',
      labelOffset: [0, 0.4, 0]
    },
    {
      id: 'brgOuter', name: '轴承外圈', group: '轴系', color: 0xc7ccd4,
      joint: 'fitted', role: 'removable',
      desc: '滚动轴承外圈：与轴承箱内孔配合固定，滚道承受滚动体传来的载荷。两套轴承各一只。',
      pos: [0.3, 0.78, 0], explodeDir: [0.2, 1, 0], explodeDist: 1.85,
      removable: true,
      labelOffset: [0, 0.16, 0]
    },
    {
      id: 'brgInner', name: '轴承内圈', group: '轴系', color: 0xb9c2cc,
      joint: 'fitted', role: 'removable',
      desc: '滚动轴承内圈：与泵轴轴颈过盈配合并随轴转动，滚道与滚动体接触传递载荷。',
      pos: [0.3, 0.78, 0], explodeDir: [0.2, 1, 0], explodeDist: 2.2,
      removable: true,
      labelOffset: [0, 0.16, 0]
    },
    {
      id: 'brgRollers', name: '滚动体', group: '轴系', color: 0xd7dce3,
      joint: 'fitted', role: 'removable',
      desc: '滚动体：深沟球轴承的钢球，在内圈与外圈滚道之间滚动，把滑动摩擦变为滚动摩擦。按教学示意数量排布。',
      pos: [0.3, 0.78, 0], explodeDir: [0.2, 1, 0], explodeDist: 2.5,
      removable: true,
      labelOffset: [0, 0.14, 0]
    },
    {
      id: 'brgCage', name: '保持架', group: '轴系', color: 0x8a94a0,
      joint: 'fitted', role: 'removable',
      desc: '保持架：把滚动体均匀隔开，防止相互碰撞与偏斜，保证载荷分布均匀。',
      pos: [0.3, 0.78, 0], explodeDir: [0.2, 1, 0], explodeDist: 2.35,
      removable: true,
      labelOffset: [0, 0.14, 0]
    },
    {
      id: 'brgCovers', name: '轴承端盖', group: '轴系', color: 0x7d8fa3,
      joint: 'bolted', role: 'removable',
      desc: '轴承端盖（两侧）：以螺栓固定在轴承箱两端，封闭轴承腔、压紧外圈并调节游隙，防止润滑脂泄漏与杂质进入。',
      pos: [0.3, 0.78, 0], explodeDir: [0.3, 1, 0], explodeDist: 1.65,
      removable: true,
      labelOffset: [0, 0.3, 0]
    },
    {
      id: 'coupling', name: '半联轴器（泵侧）', group: '支承与连接', color: 0xd97b29,
      joint: 'bolted', role: 'removable',
      desc: '刚性凸缘联轴器泵侧半体：键联在泵轴后端，与电机侧半联轴器通过螺栓组联接传递扭矩，两半联轴器加工保证同轴。本泵组为刚性联轴器，无弹性元件。',
      pos: [0.86, 0.78, 0], explodeDir: [0.15, 1, 0], explodeDist: 2.0,
      removable: true, orientable: true, prereq: ['motor', 'shaft'], removeAfter: [],
      tip: '第一步：选中橙色联轴器点击「拆下」，使泵与电机分离。',
      labelOffset: [0, 0.35, 0]
    },
    {
      id: 'couplingMotor', name: '半联轴器（电机侧）', group: '支承与连接', color: 0xc96f22,
      joint: 'fitted', role: 'removable',
      desc: '刚性凸缘联轴器电机侧半体：键联在电机轴端，与泵侧半联轴器由连接螺栓组紧固，保证两轴同步旋转。',
      pos: [0.92, 0.78, 0], explodeDir: [0.3, 1, 0], explodeDist: 2.3,
      removable: true,
      labelOffset: [0, 0.3, 0]
    },
    {
      id: 'couplingBolts', name: '联轴器螺栓组', group: '支承与连接', color: 0x6b7280,
      joint: 'bolted', role: 'removable',
      desc: '联轴器连接螺栓组：沿圆周均布，把两半联轴器紧固为一体并传递扭矩，拆卸时逐条松开。',
      pos: [0.88, 0.78, 0], explodeDir: [0, 1, 0], explodeDist: 2.6,
      removable: true,
      labelOffset: [0, 0.24, 0]
    },
    {
      id: 'motor', name: '电机', group: '驱动', color: 0x3d5a80, shell: true,
      joint: 'bolted', role: 'removable',
      desc: '三相异步电机外壳：机座带散热筋，顶部为接线盒座，后端装风扇与风扇罩，底脚以螺栓固定在底座上。透明观察可见内部定子、转子和电机轴。',
      pos: [1.55, 0.78, 0], explodeDir: [1, 0.12, 0], explodeDist: 1.7,
      removable: true, orientable: true, prereq: ['casing'], removeAfter: ['coupling'],
      tip: '联轴器拆下后，选中电机点击「拆下」，将电机沿轴向移开。',
      labelOffset: [0, 0.55, 0]
    },
    {
      id: 'motorStator', name: '定子', group: '驱动', color: 0x4a6285,
      joint: 'fitted', role: 'removable',
      desc: '电机定子：定子铁芯内圆开槽嵌放绕组，通电后产生旋转磁场。绕组端部按教学示意简化，透明观察时可见。',
      pos: [1.55, 0.78, 0], explodeDir: [0, 1, 0], explodeDist: 1.9,
      removable: true,
      labelOffset: [0, 0.4, 0]
    },
    {
      id: 'motorRotor', name: '转子', group: '驱动', color: 0x9aa5b1,
      joint: 'fitted', role: 'removable',
      desc: '电机转子：铁芯压装在电机轴上，在定子旋转磁场作用下感应电流并产生电磁转矩，驱动轴旋转。',
      pos: [1.55, 0.78, 0], explodeDir: [0, 1, 0], explodeDist: 2.25,
      removable: true,
      labelOffset: [0, 0.35, 0]
    },
    {
      id: 'motorShaft', name: '电机轴', group: '驱动', color: 0xb9c2cc,
      joint: 'fitted', role: 'removable',
      desc: '电机轴：贯穿转子与两端轴承，轴伸端经键与电机侧半联轴器连接，把电磁转矩输出给泵轴。',
      pos: [1.55, 0.78, 0], explodeDir: [0, 1, 0], explodeDist: 2.6,
      removable: true,
      labelOffset: [0, 0.3, 0]
    },
    {
      id: 'motorEnds', name: '电机端盖', group: '驱动', color: 0x6b7f94,
      joint: 'bolted', role: 'removable',
      desc: '电机端盖（两侧）：封闭机座两端并支承转子轴承，中心设轴伸孔与轴承室，以螺栓固定在机座上。',
      pos: [1.55, 0.78, 0], explodeDir: [0, 1, 0], explodeDist: 1.75,
      removable: true,
      labelOffset: [0, 0.42, 0]
    },
    {
      id: 'motorFan', name: '散热风扇', group: '驱动', color: 0x374151,
      joint: 'fitted', role: 'removable',
      desc: '散热风扇：装在电机轴尾端，随轴旋转把冷空气从风扇罩吸入并沿散热筋吹过机座表面，带走运行热量。',
      pos: [2.2, 0.78, 0], explodeDir: [1, 0.1, 0], explodeDist: 2.4,
      removable: true,
      labelOffset: [0, 0.3, 0]
    },
    {
      id: 'motorFanCover', name: '风扇罩', group: '驱动', color: 0x46617e, shell: true,
      joint: 'bolted', role: 'removable',
      desc: '风扇罩：以螺栓固定在机座尾端，罩住风扇防止异物进入，栅格进风。透明或隐藏后可观察风扇。',
      pos: [2.27, 0.78, 0], explodeDir: [1, 0.1, 0], explodeDist: 2.1,
      removable: true,
      labelOffset: [0, 0.42, 0]
    },
    {
      id: 'motorTerminalCover', name: '接线盒盖', group: '驱动', color: 0x526a8c,
      joint: 'bolted', role: 'removable',
      desc: '接线盒盖：以螺栓固定在接线盒座上，保护盒内接线端子与电缆接头，检修接线时拆下。',
      pos: [1.55, 1.26, 0], explodeDir: [0, 1, 0], explodeDist: 0.8,
      removable: true,
      labelOffset: [0, 0.16, 0]
    },
    {
      id: 'pipeSuction', name: '吸入管道', group: '管道系统', color: 0x6b7f94, shell: true,
      joint: 'bolted', role: 'display',
      desc: '吸入管道直段：真实中空管，外壁/内壁/管口环形端面均为独立几何，管口可直接看到内部空腔与壁厚；两端法兰与泵吸入口法兰、弯头法兰以螺栓连接。演示参数：外径 0.28 m、壁厚 0.02 m（教学示意，非工程数据）。',
      pos: [-2.3, 0.78, 0], explodeDir: [-1, 0, 0], explodeDist: 1.2,
      labelOffset: [0, 0.3, 0]
    },
    {
      id: 'pipeElbowIn', name: '吸入弯头', group: '管道系统', color: 0x6b7f94, shell: true,
      joint: 'welded', role: 'display',
      desc: '吸入 90° 弯头与立管：中空圆弧过渡段连接水平吸入管与垂直管段，转弯半径按教学示意取值；底部以管口法兰结束。',
      pos: [-2.85, 0.55, 0], explodeDir: [-1, -0.1, 0], explodeDist: 1.5,
      labelOffset: [0, 0.3, 0]
    },
    {
      id: 'pipeDischargeV', name: '排出立管', group: '管道系统', color: 0x6b7f94, shell: true,
      joint: 'bolted', role: 'display',
      desc: '排出立管：从泵排出口竖直向上，下法兰与泵出口法兰同径同孔距（垫片+螺栓连接），上端以焊接弯头接排出水平管。真实中空，可沿轴线剖切观察壁厚。',
      pos: [-1.0, 2.02, 0], explodeDir: [0, 1, 0], explodeDist: 1.6,
      labelOffset: [0, 0.3, 0]
    },
    {
      id: 'pipeElbowOut', name: '排出弯头', group: '管道系统', color: 0x6b7f94, shell: true,
      joint: 'welded', role: 'display',
      desc: '排出 90° 弯头：连接排出立管顶端与水平排出管，中空圆弧段，两端与管道轴线相切。',
      pos: [-1.0, 2.35, 0], explodeDir: [0, 1, 0], explodeDist: 2.0,
      labelOffset: [0, 0.28, 0]
    },
    {
      id: 'pipeDischargeH', name: '排出水平管', group: '管道系统', color: 0x6b7f94, shell: true,
      joint: 'welded', role: 'display',
      desc: '排出水平管：从弯头水平引出，末端与异径管法兰对接，管口为开放断面，可观察内壁与壁厚。',
      pos: [-0.19, 2.35, 0], explodeDir: [0.8, 0.6, 0], explodeDist: 2.2,
      labelOffset: [0, 0.28, 0]
    },
    {
      id: 'pipeReducer', name: '异径管', group: '管道系统', color: 0x7d8fa3,
      joint: 'welded', role: 'display',
      desc: '排出侧同心异径管：把排出口管路缩小一档管径，演示管径变化对流速的影响。演示参数，非工程数据。',
      pos: [0.5, 2.35, 0], explodeDir: [1, 0.2, 0], explodeDist: 2.4,
      labelOffset: [0, 0.24, 0]
    },
    {
      id: 'pipeGaskets', name: '管道垫片组', group: '管道系统', color: 0x3f6b57,
      joint: 'fitted', role: 'display',
      desc: '管道法兰垫片组：分别装在泵吸入口与排出口法兰之间，靠螺栓预紧力压紧形成静密封，防止接口泄漏。',
      pos: [-1.3, 1.24, 0], explodeDir: [-0.3, 1, 0], explodeDist: 2.0,
      labelOffset: [0, 0.2, 0]
    },
    {
      id: 'pipeBolts', name: '管道螺栓组', group: '管道系统', color: 0x6b7280,
      joint: 'bolted', role: 'display',
      desc: '管道法兰螺栓组：把泵出口/吸入口法兰与管道法兰连同垫片紧固在一起，沿圆周均布，逐个对称拧紧。',
      pos: [-1.3, 1.24, 0], explodeDir: [-0.5, 1, 0], explodeDist: 2.3,
      labelOffset: [0, 0.36, 0]
    },
    {
      id: 'pipeSupports', name: '管道支架', group: '管道系统', color: 0x4b5563,
      joint: 'anchor', role: 'fixed',
      desc: '管道支架：管夹与立柱组合，支承吸入立管与排出水平管，约束管道位移并承担管系重量。固定连接，不可拆卸。',
      pos: [-1.4, 0.3, 0], explodeDir: [0, -1, 0], explodeDist: 0.3, fixed: true,
      labelOffset: [0, 0.1, 0]
    }
  ]
};

export const exchanger: DeviceDef = {
  "id": "exchanger",
  "name": "管壳式换热器",
  "category": "heat",
  "categoryLabel": "换热设备",
  "contentVersion": "2026-11-17.4",
  "use": "利用管壁两侧流体的温差传递热量，用于加热、冷却、冷凝与蒸发，是化工装置中用量最大的换热设备。",
  "principle": "一种流体在管内流动（管程），另一种流体在壳体内、管束外流动（壳程），热量通过管壁由热流体传给冷流体。折流板迫使壳程流体横向反复冲刷管束，提高传热效率。",
  "structureNote": "教学示意模型：固定管板、单管程结构。前端管箱上部进液，经 19 根直换热管到后端封头下部排出；壳程从壳体左上接管进入、右下接管排出。两端管板与壳体固定，管束不可抽出；管箱可拆下观察管板。孔径、壁厚、间距与紧固件规格均为演示参数，无厂商图纸依据。",
  "learningPoints": [
    "分清管程与壳程两条独立流路及其进出口位置",
    "理解折流板「提高流速、横向冲刷、支承管束」的三重作用",
    "认识固定管板式「管板与壳体焊死、管束不可抽」的结构特点",
    "观察管束在管板上的三角形排布方式",
    "拆下管箱可检查真实管板孔，固定管束不能执行抽芯检修"
  ],
  "objectives": [
    "能区分管程与壳程流路并指出四个接口的位置",
    "能解释固定管板式为何管束不可抽、壳程为何需化学清洗",
    "能说明折流板与管束排布对传热的影响"
  ],
  "tasks": [
    {
      "id": "e-find-channel",
      "text": "找到前端管箱进口与后端封头出口，确认单程直管流向",
      "mode": "observe",
      "partId": "channel"
    },
    {
      "id": "e-section-baffles",
      "text": "用剖视查看折流板缺口方向与上下交替布置",
      "mode": "section",
      "partId": "baffles"
    },
    {
      "id": "e-xray-tubes",
      "text": "用透明观察数出管束排布方式（正三角形）",
      "mode": "xray",
      "partId": "tubes"
    },
    {
      "id": "e-principle-twoflow",
      "text": "播放原理动画，跟踪蓝色管程与橙色壳程两条流路",
      "mode": "principle"
    }
  ],
  "keywords": [
    "换热器",
    "管壳式",
    "管束",
    "管板",
    "折流板",
    "管箱",
    "封头",
    "壳体",
    "换热",
    "固定管板"
  ],
  "trayZ": 1.7,
  "principleAnim": "exchanger",
  "assemblyOrder": [],
  "parts": [
    {
      "id": "shell",
      "name": "壳体",
      "group": "壳体侧",
      "color": 7045012,
      "shell": true,
      "joint": "welded",
      "role": "display",
      "desc": "壳体：有内外壁和真实壁厚，两处壳程接管在筒壁上有实际开孔。与两端管板固定，仅用于结构展开；几何尺寸为教学示意参数。",
      "pos": [
        0,
        0.9,
        0
      ],
      "explodeDir": [
        0,
        1,
        0
      ],
      "explodeDist": 1.35,
      "labelOffset": [
        0,
        0.55,
        0
      ]
    },
    {
      "id": "nozzles",
      "name": "壳程接管",
      "group": "壳体侧",
      "color": 4612478,
      "joint": "welded",
      "role": "display",
      "desc": "壳程进出口接管：上方接管为壳程流体入口，下方接管为出口，法兰与外部管道连接。接管与壳体焊接，属固定结构。壳程流体走向与管程垂直交错。",
      "pos": [
        0,
        0.9,
        0
      ],
      "explodeDir": [
        0,
        1,
        0
      ],
      "explodeDist": 1.9,
      "labelOffset": [
        -0.7,
        0.75,
        0
      ]
    },
    {
      "id": "tubes",
      "name": "管束",
      "group": "管束组件",
      "color": 12618314,
      "joint": "welded",
      "role": "display",
      "desc": "管束：19 根空心直管按正三角形点阵排布，每根管均有内外壁和开放管口；两端与管板孔一一同轴。固定管板式管束不可抽出，爆炸仅用于结构认知。教学示意参数。",
      "pos": [
        0,
        0.9,
        0
      ],
      "explodeDir": [
        1,
        0.15,
        0
      ],
      "explodeDist": 1.6,
      "labelOffset": [
        0,
        0.42,
        0
      ]
    },
    {
      "id": "baffles",
      "name": "折流板组",
      "group": "管束组件",
      "color": 5333103,
      "joint": "fitted",
      "role": "display",
      "desc": "折流板组：4 块有厚度的弓形板，上下交替留出过流缺口。19 个管孔与管束同轴，另设拉杆孔；管子从孔中穿过实心板的真实孔洞。教学示意参数。",
      "pos": [
        0,
        0.9,
        0
      ],
      "explodeDir": [
        0,
        0.35,
        1
      ],
      "explodeDist": 1.35,
      "labelOffset": [
        0,
        0.5,
        0.2
      ]
    },
    {
      "id": "tubesheetF",
      "name": "前端管板",
      "group": "管束组件",
      "color": 10134961,
      "joint": "welded",
      "role": "display",
      "desc": "前端管板：19 个真实管孔与管束一一对应，外圈 12 个真实紧固孔用于安装管箱。管板与壳体固定，分隔壳程与管程。教学示意参数。",
      "pos": [
        -1.12,
        0.9,
        0
      ],
      "explodeDir": [
        -1,
        0.1,
        0
      ],
      "explodeDist": 0.85,
      "labelOffset": [
        0,
        0.5,
        0
      ]
    },
    {
      "id": "tubesheetR",
      "name": "后端管板",
      "group": "管束组件",
      "color": 10134961,
      "joint": "welded",
      "role": "display",
      "desc": "后端管板：19 个真实管孔与管束一一对应。外缘采用同一演示管板布局，后端为固定集液腔；外缘预留孔不代表后端可拆。教学示意参数。",
      "pos": [
        1.12,
        0.9,
        0
      ],
      "explodeDir": [
        1,
        0.1,
        0
      ],
      "explodeDist": 0.85,
      "labelOffset": [
        0,
        0.5,
        0
      ]
    },
    {
      "id": "channel",
      "name": "管箱",
      "group": "管程端部",
      "color": 4878245,
      "shell": true,
      "joint": "bolted",
      "role": "removable",
      "removable": true,
      "desc": "前端管箱：中空短筒和有壁厚的封头，上部接管为管程进口；本示意为单管程，不设置回程隔板。12 个法兰孔与前管板孔同轴，夹持独立密封垫。教学示意参数。",
      "pos": [
        -1.42,
        0.9,
        0
      ],
      "explodeDir": [
        -1,
        0.05,
        0
      ],
      "explodeDist": 1.45,
      "labelOffset": [
        0,
        0.55,
        0
      ]
    },
    {
      "id": "rearhead",
      "name": "后端封头",
      "group": "管程端部",
      "color": 4878245,
      "shell": true,
      "joint": "welded",
      "role": "display",
      "desc": "后端封头：中空集液腔，下部接管为管程出口。本教学示意选择后端焊接固定的构型，仅作结构展开；后端连接形式随实际产品而异，不把焊接后端推广为所有固定管板换热器的共同特点。",
      "pos": [
        1.36,
        0.9,
        0
      ],
      "explodeDir": [
        1,
        0.05,
        0
      ],
      "explodeDist": 1.45,
      "labelOffset": [
        0,
        0.5,
        0
      ]
    },
    {
      "id": "saddles",
      "name": "鞍座",
      "group": "支承",
      "color": 4937059,
      "fixed": true,
      "joint": "anchor",
      "role": "fixed",
      "desc": "鞍座：下部弧形托板贴合壳体，支腿与底板相连；一侧底板为圆孔，另一侧为沿轴向的长圆孔，展示固定端与热膨胀滑动端的区别。教学示意参数。",
      "pos": [
        0,
        0.28,
        0
      ],
      "explodeDir": [
        0,
        -1,
        0
      ],
      "explodeDist": 0.5,
      "labelOffset": [
        0.7,
        0.15,
        0.35
      ]
    },
    {
      "id": "tieRods",
      "name": "拉杆与定距管",
      "group": "管束组件",
      "pos": [
        0,
        0.9,
        0
      ],
      "color": 9149866,
      "role": "display",
      "joint": "fitted",
      "desc": "四根拉杆穿过折流板对应孔，定距套管限定折流板间隔；固定管板结构中仅作展开观察。 几何尺寸为教学示意参数。",
      "explodeDir": [
        0,
        -0.3,
        1
      ],
      "explodeDist": 1.2
    },
    {
      "id": "channelGasket",
      "name": "管箱密封垫",
      "group": "管程端部",
      "pos": [
        -1.1675,
        0.9,
        0
      ],
      "color": 9149866,
      "role": "removable",
      "joint": "fitted",
      "removable": true,
      "desc": "环形密封垫夹在管箱与前管板之间，中心开口不封堵管程。 几何尺寸为教学示意参数。",
      "explodeDir": [
        -1,
        0,
        0
      ],
      "explodeDist": 1.1
    },
    {
      "id": "channelBolts",
      "name": "管箱紧固件组",
      "group": "管程端部",
      "pos": [
        -1.1475,
        0.9,
        0
      ],
      "color": 9149866,
      "role": "removable",
      "joint": "bolted",
      "removable": true,
      "desc": "12 组螺栓、螺母和垫圈，对应两侧法兰真实孔位。外接管口未对接管路时只显示空法兰孔。 几何尺寸为教学示意参数。",
      "explodeDir": [
        -1,
        0,
        0
      ],
      "explodeDist": 1.8
    }
  ]
};

export const reactor: DeviceDef = {
  id: 'reactor',
  name: '搅拌反应釜',
  category: 'reaction',
  categoryLabel: '反应与塔器设备',
  contentVersion: '2026-11-16.2',
  use: '为液相或液-液、液-固物料提供受控的反应空间，通过搅拌使物料混合均匀，通过夹套加热或冷却控制反应温度。',
  principle:
    '电机经减速机带动搅拌轴与搅拌桨旋转，桨叶推动物料形成总体循环流动；挡板消除打旋、增强湍动。夹套内通入蒸汽或冷却水，经釜壁与物料换热，维持反应所需温度。',
  structureNote:
    '教学模型采用立式带夹套结构：椭圆釜盖、圆筒釜体加椭圆封底，四叶斜桨双层布置，釜壁设 4 块挡板，顶部机械密封，夹套包覆筒体段，底部出料、顶部进料。',
  learningPoints: [
    '认识「搅拌桨 + 挡板」配合消除打旋、强化混合的原理',
    '理解夹套作为间壁式换热面控制反应温度的方式',
    '掌握釜盖—机械密封—搅拌轴—搅拌桨的传动链',
    '观察双层桨叶产生的上下循环流型'
  ],
  objectives: [
    '能指认搅拌系统各部件并描述传动链',
    '能解释挡板与夹套各自解决什么问题',
    '能区分焊接固定结构与螺栓可拆连接'
  ],
  tasks: [
    { id: 'r-find-paddles', text: '找到双层搅拌桨与 4 块挡板，观察其相对位置', mode: 'observe', partId: 'paddles' },
    { id: 'r-xray-jacket', text: '用透明观察查看夹套包覆范围与热媒进出口', mode: 'xray', partId: 'jacket' },
    { id: 'r-explode-drive', text: '在爆炸图中沿驱动组件—机械密封—搅拌轴—搅拌桨顺序说出传动链', mode: 'explode', partId: 'drive' },
    { id: 'r-principle-circ', text: '播放原理动画，描述物料沿釜壁上升、中心下降的循环流型', mode: 'principle' }
  ],
  keywords: ['反应釜', '搅拌', '搅拌桨', '挡板', '夹套', '釜体', '釜盖', '机械密封', '减速机', '反应'],
  trayZ: 1.7,
  principleAnim: 'reactor',
  assemblyOrder: [],
  parts: [
    {
      id: 'vessel', name: '釜体', group: '釜体组件', color: 0x7d8fa3, shell: true,
      joint: 'welded', role: 'display',
      desc: '釜体：圆筒体加椭圆封底焊为一体，构成反应空间并承受内压。内壁与物料接触，外壁筒体段被夹套包覆作为换热面。属固定结构，不可拆卸。',
      pos: [0, 1.1, 0], explodeDir: [0, 0, 0], explodeDist: 0,
      labelOffset: [0, 0.1, 0.58]
    },
    {
      id: 'jacket', name: '夹套', group: '釜体组件', color: 0x5a7d9a, shell: true,
      joint: 'welded', role: 'display',
      desc: '夹套：包覆釜体筒体段的外套筒，与釜壁之间形成密闭空腔，焊接固定。通入蒸汽加热或冷却水冷却，热量经釜壁传给物料，实现间接换热。属固定结构。',
      pos: [0, 1.0, 0], explodeDir: [-1, 0.1, 0], explodeDist: 1.5,
      labelOffset: [0, 0.35, 0.72]
    },
    {
      id: 'head', name: '釜盖', group: '釜体组件', color: 0x8fa6bc, shell: true,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '椭圆釜盖：法兰螺栓连接封闭釜体顶部，开孔安装搅拌轴密封、进料口、人孔与仪表接口。教学模型将接管与釜盖合并表示。拆下釜盖即可吊出搅拌轴系。',
      pos: [0, 1.65, 0], explodeDir: [0, 1, 0], explodeDist: 1.1,
      labelOffset: [0, 0.35, 0]
    },
    {
      id: 'shaft', name: '搅拌轴', group: '搅拌系统', color: 0xb9c2cc,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '搅拌轴：竖直传动轴，上端经联轴器与减速机输出轴相连，穿过釜盖机械密封伸入釜内，下端安装搅拌桨。须保证刚度与临界转速避开工作转速。随釜盖开启可整体吊出。',
      pos: [0, 1.45, 0], explodeDir: [0, 0.15, 1], explodeDist: 1.35,
      labelOffset: [0, 0.55, 0]
    },
    {
      id: 'paddles', name: '搅拌桨', group: '搅拌系统', color: 0xc9973f,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '双层四叶斜桨：叶片与旋转平面成 45°，旋转时产生轴向+径向混合流。下层桨推动物料沿釜壁上升、中心下降，形成整体循环，是混合的核心部件。桨毂以螺栓紧固在搅拌轴上。',
      pos: [0, 0.95, 0], explodeDir: [0, 0.05, 1], explodeDist: 1.85,
      labelOffset: [0, 0.35, 0]
    },
    {
      id: 'baffles', name: '挡板', group: '搅拌系统', color: 0x5f7461,
      joint: 'welded', role: 'display',
      desc: '挡板：釜壁内侧均布的 4 块竖直长条板，焊接在釜壁上，属固定结构。无挡板时物料随桨整体「打旋」，混合效果差；挡板把切向流转化为轴向与径向流，显著增强湍动。',
      pos: [0, 1.0, 0], explodeDir: [0, 0.05, -1], explodeDist: 1.5,
      labelOffset: [0, 0.45, -0.5]
    },
    {
      id: 'seal', name: '机械密封', group: '传动与密封', color: 0x3f8f6b,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '机械密封：安装在釜盖轴穿出处，动环随轴旋转、静环固定，端面贴合阻止釜内物料沿轴泄漏，是反应釜关键的密封点。密封座以螺栓固定在釜盖上，可拆检更换。',
      pos: [0, 2.28, 0], explodeDir: [0, 1, 0], explodeDist: 1.55,
      labelOffset: [0, 0.25, 0]
    },
    {
      id: 'drive', name: '驱动组件', group: '传动与密封', color: 0x3d5a80,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '驱动组件：立式电机加摆线针轮减速机，经机架支承在釜盖上，输出低转速大扭矩带动搅拌轴。教学模型将电机、减速机与机架合并表示，机架以螺栓固定在釜盖上。',
      pos: [0, 2.75, 0], explodeDir: [0, 1, 0], explodeDist: 2.1,
      labelOffset: [0, 0.45, 0]
    },
    {
      id: 'nozzles', name: '进出料接口', group: '接口', color: 0x46617e,
      joint: 'welded', role: 'display',
      desc: '进出料接口：底部中心出料管便于放净物料，顶部进料口加料，夹套侧壁设热媒进出口。接管与釜体/夹套焊接，法兰与外部管路连接。属固定结构。',
      pos: [0, 0, 0], explodeDir: [0, -1, 0], explodeDist: 0.8,
      labelOffset: [0.3, 0.2, 0]
    },
    {
      id: 'legs', name: '支座', group: '支承', color: 0x4b5563, fixed: true,
      joint: 'anchor', role: 'fixed',
      desc: '支腿支座：4 条支腿支承釜体与夹套重量并固定设备。教学模型中为固定连接，不可拆卸。',
      pos: [0, 0.28, 0], explodeDir: [0, -1, 0], explodeDist: 0.45,
      labelOffset: [0.55, 0, 0.3]
    }
  ]
};

/* ============ 第三批扩展：15 种常见化工设备（教学示意模型） ============
 * 结构依据见 docs/sources-and-review.md；比例与细节为教学简化，非制造图纸。 */

export const ballValve: DeviceDef = {
  id: 'ball-valve',
  name: '法兰球阀',
  category: 'valve',
  categoryLabel: '阀门与管道附件',
  contentVersion: '2026-11-17.3',
  use: '用于切断或接通管路中的介质，启闭迅速、流阻小，广泛用于水、油品、气体及一般化工介质的管路上。',
  principle:
    '阀球中心开有圆形通孔。手柄带动阀杆与阀球旋转 90°：通孔与管路同轴时全开，介质直通；通孔垂直于管路时全关，球面压紧两侧阀座实现密封。',
  structureNote:
    '教学示意模型：法兰连接浮动球结构，阀体为铸造固定件，阀球、阀座、阀杆、密封件与手柄可拆检。阀球通孔以深色孔道示意，实际球体为精密研磨金属球；阀体内腔、进出口与法兰螺栓孔为真实几何。',
  learningPoints: [
    '理解球阀「旋转 90° 启闭」的动作特点',
    '认识阀座密封副：球面压紧两侧阀座实现双向密封',
    '掌握阀杆填料密封的作用与更换位置',
    '熟悉手柄—阀杆—阀球的传动链与拆装顺序'
  ],
  objectives: [
    '能指认阀体、阀球、阀座、阀杆、密封件、手柄并说明作用',
    '能解释开度变化如何改变流道通断',
    '能按顺序完成一次拆卸与组装复原'
  ],
  tasks: [
    { id: 'bv-find-ball', text: '找到阀球，观察中心通孔的方向', mode: 'observe', partId: 'ball' },
    { id: 'bv-xray', text: '用透明观察查看阀球与两侧阀座的贴合关系', mode: 'xray', partId: 'body' },
    { id: 'bv-interact', text: '在整体观察中拖动「阀门开度」，观察阀球与手柄同步旋转', mode: 'observe', partId: 'ball' },
    { id: 'bv-principle', text: '播放原理动画，指出全开与全关两个位置', mode: 'principle' },
    { id: 'bv-practice', text: '完成一次完整的拆卸与组装练习', mode: 'practice', auto: 'practice-completion' }
  ],
  keywords: ['球阀', '阀门', '法兰', '阀球', '阀座', '阀杆', '手柄', '切断', '启闭'],
  assemblyOrder: ['seals', 'seats', 'ball', 'stem', 'packing', 'bonnet', 'handle'],
  principleAnim: 'ball',
  trayZ: 1.7,
  parts: [
    {
      id: 'body', name: '阀体', group: '承压壳体', color: 0x5b7089, shell: true, fixed: true,
      joint: 'welded', role: 'fixed',
      desc: '阀体：铸造承压壳体，两端为法兰连接端，中部容纳阀球与阀座，顶部开口供阀杆穿出。属固定结构，拆装练习中作为基准保留。',
      pos: [0, 0.62, 0], explodeDir: [0, 0, 0], explodeDist: 0,
      labelOffset: [0, -0.3, 0.25]
    },
    {
      id: 'seats', name: '阀座', group: '密封副', color: 0xe8e4d8,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '阀座：两只聚四氟乙烯密封环，嵌在阀体两侧，球面压紧其端面形成密封副。磨损后需成对更换，是球阀最常见的检修件。',
      pos: [0, 0.62, 0], explodeDir: [0, -1, 0], explodeDist: 0.55,
      labelOffset: [0.2, -0.15, 0]
    },
    {
      id: 'ball', name: '阀球', group: '启闭件', color: 0xb8c4d0,
      joint: 'fitted', role: 'removable', removable: true, orientable: true,
      desc: '阀球：中心开圆形通孔的金属球，表面精密研磨。通孔与管路同轴为开，垂直为关。顶部扁槽与阀杆下端配合传递扭矩，安装时注意通孔方向。',
      pos: [0, 0.62, 0], explodeDir: [0, 1, 0], explodeDist: 0.6,
      prereq: ['seats'], removeAfter: ['stem', 'packing', 'bonnet', 'handle'],
      tip: '先确认阀杆已拆下，再取出阀球；注意球面不要磕碰。',
      labelOffset: [0, 0.2, 0]
    },
    {
      id: 'stem', name: '阀杆', group: '传动', color: 0x9aa7b4,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '阀杆：上接手柄、下端扁榫嵌入阀球顶部槽口，把旋转运动传给阀球。杆身穿过阀体顶部填料函，是动密封的关键部位。',
      pos: [0, 0.92, 0], explodeDir: [0, 1, 0], explodeDist: 0.95,
      prereq: ['ball'], removeAfter: ['packing', 'bonnet', 'handle'],
      labelOffset: [0.15, 0.1, 0]
    },
    {
      id: 'seals', name: '密封件', group: '密封副', color: 0x3f8f6b,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '密封件：阀杆填料与压盖组件，阻止介质沿阀杆向外泄漏。填料老化渗漏时压紧或更换，是日常维护的重点。',
      pos: [0, 0.86, 0], explodeDir: [0, 1, 0], explodeDist: 1.3,
      prereq: [], removeAfter: ['ball'],
      labelOffset: [-0.18, 0.05, 0]
    },
    {
      id: 'handle', name: '手柄', group: '操作件', color: 0xd97706,
      joint: 'bolted', role: 'removable', removable: true, orientable: true,
      desc: '手柄：手动操作杆，扳动 90° 即完成启闭。手柄方向通常与通孔方向一致，可直观判断阀门开关状态。',
      pos: [0, 1.12, 0], explodeDir: [0, 1, 0], explodeDist: 1.6,
      prereq: ['bonnet', 'stem'],
      tip: '手柄以螺母固定在阀杆顶端，拆下螺母即可取出手柄。',
      labelOffset: [0.25, 0.1, 0]
    },
    {
      id: 'bonnet', name: '阀盖', group: '承压壳体', color: 0x5b7089, shell: true,
      joint: 'bolted', role: 'removable', removable: true, prereq: ['packing'], removeAfter: ['handle'],
      desc: '阀盖：以螺栓固定在阀体顶部，压紧填料函并对阀杆导向，中心为阀杆穿孔。法兰螺栓孔为真实几何，拆下阀盖后可检修填料与阀杆。',
      pos: [0, 0.84, 0], explodeDir: [0, 1, 0], explodeDist: 1.1,
      labelOffset: [0.18, 0.12, 0]
    },
    {
      id: 'packing', name: '填料', group: '密封副', color: 0x2f3e4e,
      joint: 'fitted', role: 'removable', removable: true, prereq: ['stem'], removeAfter: ['bonnet', 'handle'],
      desc: '填料：阀杆填料函内的三圈柔性填料，被阀盖压紧后抱紧阀杆形成动密封；老化渗漏时更换或补充。',
      pos: [0, 0.95, 0], explodeDir: [0, 1, 0], explodeDist: 0.85,
      labelOffset: [-0.16, 0.05, 0]
    },
    {
      id: 'bolts', name: '连接螺栓组', group: '连接件', color: 0x6b7280,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '连接螺栓组：阀盖与阀体法兰的连接螺栓，沿圆周均布，对角交替拧紧保证填料压盖受力均匀。',
      pos: [0, 0.84, 0], explodeDir: [0, 1.2, 0], explodeDist: 1.35,
      labelOffset: [0, 0.2, 0]
    }
  ]
};

export const gateValve: DeviceDef = {
  id: 'gate-valve',
  name: '明杆楔式闸阀',
  category: 'valve',
  categoryLabel: '阀门与管道附件',
  contentVersion: '2026-11-17.3',
  use: VALVE_OPERATIONS.gate.description,
  principle:
    '转动手轮，阀杆螺母带动明杆升降，楔式闸板沿垂直于流向的方向移动：闸板离开阀座为开，楔紧在两阀座之间为关。明杆螺纹外露，可直接观察开度。',
  structureNote:
    '教学示意模型：明杆支架式结构，阀体铸造固定，闸板、阀杆、填料、阀盖与手轮可拆检。楔式闸板以斜面示意，实际楔角与密封面按标准加工；阀体流道、进出口法兰孔与填料函为真实几何。',
  learningPoints: [
    '理解闸阀「垂直升降启闭」与球阀「旋转启闭」的区别',
    '认识明杆螺纹外露可直接观察开度的特点',
    '掌握填料函密封与阀盖螺栓连接的关系',
    '熟悉闸阀只能全开全关、不宜节流的使用要求'
  ],
  objectives: [
    '能指认阀体、闸板、阀杆、填料、阀盖、手轮并说明作用',
    '能解释手轮旋转如何转化为闸板升降',
    '能按顺序完成一次拆卸与组装复原'
  ],
  tasks: [
    { id: 'gv-find-gate', text: '找到楔式闸板，观察它与流向垂直的布置', mode: 'observe', partId: 'gate' },
    { id: 'gv-section', text: '用剖视查看闸板与阀座的楔紧密封面', mode: 'section', partId: 'gate' },
    { id: 'gv-interact', text: '拖动「闸板行程」，观察手轮旋转与闸板升降同步', mode: 'observe', partId: 'stem' },
    { id: 'gv-principle', text: '播放原理动画，描述开启过程中流道的变化', mode: 'principle' },
    { id: 'gv-practice', text: '完成一次完整的拆卸与组装练习', mode: 'practice', auto: 'practice-completion' }
  ],
  keywords: ['闸阀', '明杆', '楔式', '闸板', '阀杆', '填料', '手轮', '阀盖', '切断'],
  assemblyOrder: ['seat', 'gate', 'stem', 'packing', 'bonnet', 'handwheel'],
  principleAnim: 'gate',
  trayZ: 1.7,
  parts: [
    {
      id: 'body', name: '阀体', group: '承压壳体', color: 0x5b7089, shell: true, fixed: true,
      joint: 'welded', role: 'fixed',
      desc: '阀体：铸造壳体，两端法兰接管，中腔容纳闸板，两侧阀座密封面与闸板楔紧。属固定结构。',
      pos: [0, 0.62, 0], explodeDir: [0, 0, 0], explodeDist: 0,
      labelOffset: [0, -0.3, 0.25]
    },
    {
      id: 'gate', name: '闸板', group: '启闭件', color: 0xb8c4d0,
      joint: 'fitted', role: 'removable', removable: true, orientable: true,
      desc: '闸板：楔式圆盘，密封面与阀座成微小楔角，关闭时楔紧实现密封。闸板沿垂直流向升降，全开时流道直通、流阻很小。',
      pos: [0, 0.62, 0], explodeDir: [0, 1, 0], explodeDist: 0.55,
      removeAfter: ['stem'],
      tip: '闸板与阀杆以 T 形槽连接，拆下阀杆后才能取出闸板。',
      labelOffset: [0.2, 0, 0]
    },
    {
      id: 'stem', name: '阀杆', group: '传动', color: 0x9aa7b4,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '阀杆：明杆结构，梯形螺纹外露并与阀杆螺母配合，手轮旋转时阀杆带着闸板升降，开度可从螺纹伸出长度直观判断。',
      pos: [0, 1.02, 0], explodeDir: [0, 1, 0], explodeDist: 1.0,
      prereq: ['gate'], removeAfter: ['packing', 'bonnet', 'handwheel'],
      labelOffset: [0.16, 0.15, 0]
    },
    {
      id: 'packing', name: '填料', group: '密封副', color: 0x3f8f6b,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '填料：装在阀盖填料函内的密封环组，压紧后阻止介质沿阀杆泄漏。明杆阀填料承受升降摩擦，需定期检查压盖松紧。',
      pos: [0, 0.92, 0], explodeDir: [0, 1, 0], explodeDist: 1.35,
      prereq: ['stem'], removeAfter: ['bonnet', 'handwheel'],
      labelOffset: [-0.18, 0.05, 0]
    },
    {
      id: 'bonnet', name: '阀盖', group: '承压壳体', color: 0x46617e,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '阀盖：以螺栓固定在阀体上，封闭中腔并支承阀杆螺母与填料函。拆下阀盖即可检修闸板与阀座密封面。',
      pos: [0, 0.88, 0], explodeDir: [0, 1, 0], explodeDist: 1.7,
      prereq: ['stem', 'packing'], removeAfter: ['handwheel'],
      labelOffset: [0.22, 0.1, 0]
    },
    {
      id: 'handwheel', name: '手轮', group: '操作件', color: 0xd97706,
      joint: 'bolted', role: 'removable', removable: true, orientable: true,
      desc: '手轮：手动操作件，旋转手轮通过阀杆螺母转化为阀杆升降。顺时针通常为关，逆时针为开。',
      pos: [0, 1.42, 0], explodeDir: [0, 1, 0], explodeDist: 2.0,
      prereq: ['bonnet', 'stem'],
      tip: '手轮以键和螺母固定在阀杆顶端，先拆螺母再取手轮。',
      labelOffset: [0.25, 0.12, 0]
    },
    {
      id: 'seat', name: '阀座', group: '密封副', color: 0xe8e4d8,
      joint: 'fitted', role: 'removable', removable: true, removeAfter: ['gate'],
      desc: '阀座：阀体内两侧的密封环，与楔式闸板斜面配合形成进出口双向密封。密封面磨损或划伤会导致关闭不严。',
      pos: [0, 0.62, 0], explodeDir: [-1, -0.3, 0], explodeDist: 0.8,
      labelOffset: [0, -0.16, 0]
    },
    {
      id: 'bolts', name: '连接螺栓组', group: '连接件', color: 0x6b7280,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '连接螺栓组：阀盖与阀体的法兰连接螺栓，对角交替拆装；拆卸阀盖前须先卸下这些螺栓。',
      pos: [0, 0.88, 0], explodeDir: [0, 1, 0], explodeDist: 2.2,
      labelOffset: [0, 0.25, 0]
    }
  ]
};

export const butterflyValve: DeviceDef = {
  id: 'butterfly-valve',
  name: '对夹式蝶阀',
  category: 'valve',
  categoryLabel: '阀门与管道附件',
  contentVersion: '2026-11-17.3',
  use: '用于大口径管路的切断与粗略调节，结构长度短、重量轻，对夹安装在两片法兰之间，常见于水系统与低压气体管路。',
  principle:
    '蝶板绕阀轴旋转约 90° 实现启闭：板面与流向平行时全开，板面垂直流向并压紧阀座时全关。中间角度可粗略调节流量。',
  structureNote:
    '教学示意模型：对夹式中线蝶阀，阀体为短环状固定件，橡胶阀座、蝶板、阀轴与手柄可拆检。实际对夹阀依靠两侧法兰螺栓夹紧定位。',
  learningPoints: [
    '认识蝶阀结构长度短、适合大口径的特点',
    '理解蝶板旋转角度与开度的对应关系',
    '掌握橡胶阀座的密封作用与更换方式',
    '了解对夹式安装依靠管路法兰夹紧的定位方式'
  ],
  objectives: [
    '能指认阀体、阀座、蝶板、阀轴、手柄并说明作用',
    '能解释蝶板从全开到全关的旋转过程',
    '能按顺序完成一次拆卸与组装复原'
  ],
  tasks: [
    { id: 'bf-find-disc', text: '找到蝶板，观察板面与管路轴线的关系', mode: 'observe', partId: 'disc' },
    { id: 'bf-xray', text: '用透明观察查看橡胶阀座与蝶板边缘的贴合', mode: 'xray', partId: 'body' },
    { id: 'bf-interact', text: '拖动「蝶板开度」，观察蝶板绕阀轴旋转', mode: 'observe', partId: 'disc' },
    { id: 'bf-principle', text: '播放原理动画，比较全开与节流状态的流道', mode: 'principle' },
    { id: 'bf-practice', text: '完成一次完整的拆卸与组装练习', mode: 'practice', auto: 'practice-completion' }
  ],
  keywords: ['蝶阀', '对夹', '蝶板', '阀轴', '阀座', '手柄', '大口径', '调节'],
  assemblyOrder: ['seat', 'disc', 'shaft', 'handle'],
  principleAnim: 'butterfly',
  trayZ: 1.7,
  parts: [
    {
      id: 'body', name: '阀体', group: '承压壳体', color: 0x5b7089, shell: true, fixed: true,
      joint: 'welded', role: 'fixed',
      desc: '阀体：短环状铸件，外圆带定位耳，对夹安装在两片管路法兰之间，由法兰螺栓夹紧。属固定结构。',
      pos: [0, 0.6, 0], explodeDir: [0, 0, 0], explodeDist: 0,
      labelOffset: [0, -0.32, 0.2]
    },
    {
      id: 'seat', name: '阀座', group: '密封副', color: 0x2f3e4e,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '阀座：整体橡胶密封圈，嵌在阀体内壁，蝶板关闭时边缘压紧橡胶实现密封。橡胶老化或划伤后整体更换。',
      pos: [0, 0.6, 0], explodeDir: [0, -1, 0], explodeDist: 0.5,
      removeAfter: ['disc'],
      labelOffset: [0.24, -0.1, 0]
    },
    {
      id: 'disc', name: '蝶板', group: '启闭件', color: 0xb8c4d0,
      joint: 'fitted', role: 'removable', removable: true, orientable: true,
      desc: '蝶板：圆盘形启闭件，中心毂与阀轴配合，绕阀轴旋转约 90° 完成启闭。板面平行流向为开，垂直流向为关。',
      pos: [0, 0.6, 0], explodeDir: [0, 1, 0], explodeDist: 0.6,
      prereq: ['seat'], removeAfter: ['shaft'],
      tip: '蝶板以销钉固定在阀轴上，先拆阀轴再取蝶板。',
      labelOffset: [0, 0.24, 0]
    },
    {
      id: 'shaft', name: '阀轴', group: '传动', color: 0x9aa7b4,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '阀轴：贯穿蝶板中心的转轴，上端伸出阀体连接手柄，下端支承在阀体轴孔内，传递启闭扭矩。',
      pos: [0, 0.6, 0], explodeDir: [0, 1, 0], explodeDist: 0.95,
      prereq: ['disc'], removeAfter: ['handle'],
      labelOffset: [0.15, 0.2, 0]
    },
    {
      id: 'handle', name: '手柄', group: '操作件', color: 0xd97706,
      joint: 'bolted', role: 'removable', removable: true, orientable: true,
      desc: '手柄：带定位棘轮的手动操作杆，扳动后卡在对应开度槽位，可停留在中间角度作粗略调节。',
      pos: [0, 0.95, 0], explodeDir: [0, 1, 0], explodeDist: 1.25,
      prereq: ['shaft'],
      labelOffset: [0.25, 0.1, 0]
    },
    {
      id: 'bolts', name: '对夹螺栓组', group: '连接件', color: 0x6b7280,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '对夹螺栓组：贯穿两片管道法兰与阀体的长螺栓，把蝶阀对夹在管路之间；法兰孔为真实几何。',
      pos: [0, 0.6, 0], explodeDir: [-1, 0.2, 0], explodeDist: 1.0,
      labelOffset: [0, 0.22, 0]
    }
  ]
};

export const checkValve: DeviceDef = {
  id: 'check-valve',
  name: '旋启式止回阀',
  category: 'valve',
  categoryLabel: '阀门与管道附件',
  contentVersion: '2026-11-17.3',
  use: '自动阻止介质倒流，保护泵与设备免受水锤和反转冲击，安装在泵出口等需要单向流动的管段上。',
  principle:
    '阀瓣铰接在阀体内：正向流动时介质推开阀瓣绕铰链摆起，流道畅通；流量减小或倒流时阀瓣靠自重与回流压向阀座，自动关闭切断通路。',
  structureNote:
    '教学示意模型：旋启式结构，阀体铸造固定，阀座、铰链、阀瓣与阀盖可拆检。阀瓣摆角与密封面角度为教学简化。',
  learningPoints: [
    '理解止回阀「自动启闭、防止倒流」的工作特点',
    '认识阀瓣—铰链—阀座的摆动密封结构',
    '掌握安装方向：阀体箭头必须指向介质流向',
    '了解停泵时阀瓣关闭减缓水锤的作用'
  ],
  objectives: [
    '能指认阀体、阀盖、铰链、阀瓣、阀座并说明作用',
    '能解释正向流动开启、反向流动关闭的过程',
    '能按顺序完成一次拆卸与组装复原'
  ],
  tasks: [
    { id: 'cv-find-disc', text: '找到阀瓣与铰链，观察摆动支点的位置', mode: 'observe', partId: 'disc' },
    { id: 'cv-section', text: '用剖视查看阀瓣与阀座的密封面贴合', mode: 'section', partId: 'seat' },
    { id: 'cv-interact', text: '拖动「阀瓣摆角」，模拟阀瓣被介质推开', mode: 'observe', partId: 'disc' },
    { id: 'cv-principle', text: '播放原理动画，比较正向流动与倒流时阀瓣的状态', mode: 'principle' },
    { id: 'cv-practice', text: '完成一次完整的拆卸与组装练习', mode: 'practice', auto: 'practice-completion' }
  ],
  keywords: ['止回阀', '旋启式', '单向阀', '阀瓣', '铰链', '阀座', '倒流', '水锤'],
  assemblyOrder: ['seat', 'hinge', 'disc', 'cover'],
  principleAnim: 'check',
  trayZ: 1.7,
  parts: [
    {
      id: 'body', name: '阀体', group: '承压壳体', color: 0x5b7089, shell: true, fixed: true,
      joint: 'welded', role: 'fixed',
      desc: '阀体：铸造壳体，两端法兰接管，顶部开口供检修内件，铸有流向箭头。属固定结构，安装时箭头必须指向介质流向。',
      pos: [0, 0.6, 0], explodeDir: [0, 0, 0], explodeDist: 0,
      labelOffset: [0, -0.3, 0.25]
    },
    {
      id: 'seat', name: '阀座', group: '密封副', color: 0xe8e4d8,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '阀座：嵌在阀体流道内的密封环，阀瓣关闭时压紧其端面切断倒流。密封面损伤会引起内漏，需研磨或更换。',
      pos: [-0.06, 0.6, 0], explodeDir: [-1, 0, 0], explodeDist: 0.5,
      removeAfter: ['disc'],
      labelOffset: [-0.2, -0.12, 0]
    },
    {
      id: 'hinge', name: '铰链', group: '传动', color: 0x9aa7b4,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '铰链：阀瓣的摆动支点，销轴固定在阀体内壁上，阀瓣绕其自由摆起或落下，是旋启式结构的关键运动副。',
      pos: [0.06, 0.82, 0], explodeDir: [0, 1, 0], explodeDist: 0.6,
      removeAfter: ['disc'],
      labelOffset: [0.18, 0.1, 0]
    },
    {
      id: 'disc', name: '阀瓣', group: '启闭件', color: 0xb8c4d0,
      joint: 'fitted', role: 'removable', removable: true, orientable: true,
      desc: '阀瓣：圆盘形启闭件，经摇臂挂在铰链上。正向流动被推开摆起，倒流时压向阀座自动关闭，无需外部操作。',
      pos: [0.06, 0.82, 0], explodeDir: [0, 1, 0], explodeDist: 0.95,
      prereq: ['hinge', 'seat'], removeAfter: ['cover'],
      tip: '阀瓣以销钉挂在铰链摇臂上，抽出销钉即可取下阀瓣。',
      labelOffset: [-0.15, -0.2, 0]
    },
    {
      id: 'cover', name: '阀盖', group: '承压壳体', color: 0x46617e,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '阀盖：以螺栓封闭阀体顶部检修口，拆下后可检查阀瓣、铰链与阀座。垫片密封防止外漏。',
      pos: [0, 0.86, 0], explodeDir: [0, 1, 0], explodeDist: 1.3,
      prereq: ['disc'],
      labelOffset: [0.22, 0.1, 0]
    },
    {
      id: 'gasket', name: '阀盖垫片', group: '密封副', color: 0x2f3e4e,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '阀盖垫片：阀盖与阀体结合面之间的密封垫，靠阀盖螺栓压紧形成静密封，每次开盖检修后应更换。',
      pos: [0, 0.84, 0], explodeDir: [0, 1, 0], explodeDist: 1.45,
      labelOffset: [0.16, 0.05, 0]
    },
    {
      id: 'bolts', name: '阀盖螺栓组', group: '连接件', color: 0x6b7280,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '阀盖螺栓组：阀盖法兰与阀体之间的连接螺栓，沿圆周均布；拆开阀盖可检修阀瓣与摇臂。',
      pos: [0, 0.86, 0], explodeDir: [0, 1.2, 0], explodeDist: 1.55,
      labelOffset: [0, 0.2, 0]
    }
  ]
};

export const gearPump: DeviceDef = {
  id: 'gear-pump',
  name: '外啮合齿轮泵',
  category: 'pump',
  categoryLabel: '泵与压缩设备',
  contentVersion: '2026-11-20.1',
  use: '输送润滑油、燃油及不含固体颗粒的粘性液体，流量平稳、自吸能力强，常用于润滑系统与液压系统。',
  principle:
    '一对相互啮合的齿轮在泵体内旋转：吸入侧齿间容积增大形成低压吸入液体，液体被齿槽沿泵体内壁带到排出侧，齿轮重新啮合使容积减小、液体被挤出排出。',
  structureNote:
    '教学示意重建：8 字形内腔由两个真实圆柱孔组成，齿顶与孔壁留有演示间隙；吸入侧在 +Z（观察者前方）、排出侧在 -Z，两侧均为真实中空接管与法兰。两只 12 齿直齿轮以 15° 相位差啮合，齿间与壳壁围成输送空间；齿形为教学近似，未取得型号型线与中心距资料，不作尺寸核对。端盖、垫片、密封、轴承与泵轴可拆检。',
  learningPoints: [
    '理解「齿间容积变化」实现吸排油的容积式原理',
    '观察介质从吸入侧沿齿轮外周到排出侧的完整输送路径',
    '认识 8 字形泵腔与齿顶—壳壁间隙形成的密封带',
    '掌握主动齿轮—泵轴—轴承—密封的传动链',
    '了解齿轮泵不能输送含固体颗粒介质的原因'
  ],
  objectives: [
    '能指认泵体、主从动齿轮、泵轴、端盖、轴承、密封件',
    '能描述吸入侧与排出侧齿间容积的变化',
    '能按顺序完成一次拆卸与组装复原'
  ],
  tasks: [
    { id: 'gp-find-gears', text: '找到主动与从动齿轮，观察啮合位置', mode: 'observe', partId: 'driveGear' },
    { id: 'gp-xray', text: '用透明观察查看齿槽与泵体内壁形成的封闭容积', mode: 'xray', partId: 'casing' },
    { id: 'gp-interact', text: '拖动「齿轮转角」，观察两齿轮反向旋转', mode: 'observe', partId: 'driveGear' },
    { id: 'gp-principle', text: '播放原理动画，指出吸入侧与排出侧', mode: 'principle' },
    { id: 'gp-practice', text: '完成一次完整的拆卸与组装练习', mode: 'practice', auto: 'practice-completion' }
  ],
  keywords: ['齿轮泵', '外啮合', '容积泵', '主动齿轮', '从动齿轮', '泵轴', '轴承', '密封', '润滑油'],
  assemblyOrder: ['casing', 'idlerGear', 'driveGear', 'shaft', 'seal', 'bearing', 'cover'],
  principleAnim: 'gear',
  trayZ: 1.7,
  parts: [
    {
      id: 'casing', name: '泵体', group: '承压壳体', color: 0x5b7089, shell: true,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '泵体：8 字形内腔由两个真实圆柱孔组成，齿顶与内壁的间隙形成密封带；+Z 侧为吸入腔（蓝色接口环），-Z 侧为排出腔（橙色接口环），两侧接口均为真实中空接管与法兰。以螺栓与端盖连接，是最后拆下的基准件。剖视可看到两齿轮、吸排腔与齿间输送空间。',
      pos: [0, 0.72, 0], explodeDir: [0, -1, 0], explodeDist: 0.7,
      removeAfter: ['cover', 'bearing', 'seal', 'shaft', 'driveGear', 'idlerGear'],
      tip: '泵体是包容件，须先拆端盖、轴承、密封、泵轴与两只齿轮。',
      labelOffset: [0, -0.35, 0.25]
    },
    {
      id: 'idlerGear', name: '从动齿轮', group: '转子', color: 0xb8c4d0,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '从动齿轮：12 齿直齿轮，与主动齿轮以 15° 相位差啮合，被带动反向旋转；齿槽与壳壁围成的空间携带液体沿齿轮外周从 +Z 吸入侧移向 -Z 排出侧。齿形为教学近似（梯形齿），不是厂商型线。',
      pos: [0, 0.55, 0], explodeDir: [0, -1, 0], explodeDist: 0.5,
      prereq: ['casing'],
      labelOffset: [0.22, -0.1, 0]
    },
    {
      id: 'driveGear', name: '主动齿轮', group: '转子', color: 0xc9a227,
      joint: 'fitted', role: 'removable', removable: true, orientable: true,
      desc: '主动齿轮：12 齿直齿轮，以键固定在泵轴上，由原动机带动旋转并驱动从动齿轮。齿形与从动轮相同、相位相差半齿；安装时注意键槽对位。',
      pos: [0, 0.89, 0], explodeDir: [0, 1, 0], explodeDist: 0.5,
      prereq: ['casing'], removeAfter: ['shaft'],
      labelOffset: [0.22, 0.12, 0]
    },
    {
      id: 'shaft', name: '泵轴', group: '传动', color: 0x9aa7b4,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '泵轴：传递扭矩给主动齿轮，外伸端连接联轴器或电机，轴身穿过密封与轴承，是轴系的核心零件。',
      pos: [0.3, 0.89, 0], explodeDir: [1, 0, 0], explodeDist: 0.7,
      prereq: ['driveGear'], removeAfter: ['seal', 'bearing', 'cover'],
      labelOffset: [0.15, 0.15, 0]
    },
    {
      id: 'seal', name: '密封件', group: '密封副', color: 0x3f8f6b,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '密封件：轴端骨架油封或机械密封，装在端盖轴承座外侧，阻止输送液体沿泵轴外漏，同时防止空气进入吸入侧。',
      pos: [0.235, 0.89, 0], explodeDir: [1, 0, 0], explodeDist: 1.0,
      prereq: ['shaft'], removeAfter: ['bearing', 'cover'],
      labelOffset: [0, 0.18, 0]
    },
    {
      id: 'bearing', name: '轴承', group: '支承', color: 0x7c8a99,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '轴承：滚动轴承支承泵轴径向与轴向载荷，装在端盖轴承座上，保证齿轮啮合间隙稳定；磨损后间隙增大会引起流量下降与噪声。',
      pos: [0.36, 0.89, 0], explodeDir: [1, 0, 0], explodeDist: 1.3,
      prereq: ['shaft', 'seal'], removeAfter: ['cover'],
      labelOffset: [0, -0.18, 0]
    },
    {
      id: 'cover', name: '端盖', group: '承压壳体', color: 0x46617e, shell: true,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '端盖：8 字形端盖板，以 8 条螺栓和结合面垫片封闭泵体轴端，支承轴承与密封并轴向定位齿轮。拆下端盖即可抽出轴系与齿轮，是最先拆下的零件。',
      pos: [0.16, 0.72, 0], explodeDir: [1, 0, 0], explodeDist: 1.6,
      prereq: ['bearing', 'seal'],
      tip: '对角松开 8 条螺栓后取下端盖，注意定位销与垫片。',
      labelOffset: [0.1, 0.32, 0]
    }
  ]
};

export const diaphragmPump: DeviceDef = {
  id: 'diaphragm-pump',
  name: '气动双隔膜泵',
  category: 'pump',
  categoryLabel: '泵与压缩设备',
  contentVersion: '2026-11-20.1',
  use: '以压缩空气为动力，输送腐蚀性、含颗粒、高粘度及易燃介质，无轴封泄漏风险，可空转与憋压，常用于涂料、废水与化学品转移。',
  principle:
    '压缩空气交替进入中间气室两侧，推动连杆带动左右隔膜往复运动：一侧隔膜外鼓吸液时另一侧内压排液，每腔上下各一只球式止回阀保证单向流动，两侧交替形成连续输送。',
  structureNote:
    '教学示意重建：左右隔膜外缘分别被气室侧法兰与隔膜腔法兰夹紧，隔膜腔为带真实上下接口的薄壁腔体；四只球式止回阀独立建模为带保持架的阀体，阀球可在行程中升降，吸入总管与排出总管均为中空汇管并经支管接入各阀。分步原理演示可停在两个相反行程，核对两腔吸排与四只止回阀开闭。隔膜型面、行程与阀球尺寸为教学示意。',
  learningPoints: [
    '理解「气动往复 + 容积变化」的输送原理',
    '观察隔膜外缘如何被气室与腔体法兰夹紧',
    '认识左右隔膜交替吸排液的相位关系',
    '掌握四只球式止回阀在两个行程中的开闭规律',
    '了解无轴封、可空转、防爆场合适用的特点'
  ],
  objectives: [
    '能指认隔膜腔、隔膜、连杆、总管、止回阀与气室',
    '能描述一个完整吸排循环中两侧隔膜的动作',
    '能按顺序完成一次拆卸与组装复原'
  ],
  tasks: [
    { id: 'dp-find-diaphragm', text: '找到左右隔膜，观察连杆如何连接它们', mode: 'observe', partId: 'diaphragmL' },
    { id: 'dp-xray', text: '用透明观察查看隔膜腔与四只球式止回阀的位置', mode: 'xray', partId: 'chamberL' },
    { id: 'dp-interact', text: '拖动「隔膜行程」，观察两侧隔膜与止回阀球的反向动作', mode: 'observe', partId: 'link' },
    { id: 'dp-principle', text: '暂停或分步播放，指出两个相反行程中哪一腔吸入、哪一腔排出，并检查对应止回阀开闭', mode: 'principle' },
    { id: 'dp-practice', text: '完成一次完整的拆卸与组装练习', mode: 'practice', auto: 'practice-completion' }
  ],
  keywords: ['隔膜泵', '气动', '双隔膜', '容积泵', '止回阀', '连杆', '气室', '行程', '防腐', '自吸'],
  assemblyOrder: ['link', 'diaphragmL', 'diaphragmR', 'chamberL', 'chamberR', 'checkBalls', 'manifoldIn', 'manifoldOut'],
  principleAnim: 'diaphragm',
  trayZ: 1.7,
  parts: [
    {
      id: 'airChamber', name: '中间气室', group: '气动驱动', color: 0x46617e, shell: true, fixed: true,
      joint: 'bolted', role: 'fixed',
      desc: '中间气室：容纳配气阀与连杆中段，压缩空气交替进入两侧推动隔膜。两侧设隔膜夹紧法兰与 6 条连接螺栓，前侧为压缩空气入口；气阀换向机构为教学简化，属固定基准件。底部公共底座支承整泵。',
      pos: [0, 0.72, 0], explodeDir: [0, 0, 0], explodeDist: 0,
      labelOffset: [0, 0.3, 0.2]
    },
    {
      id: 'link', name: '连杆', group: '传动', color: 0x9aa7b4,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '连杆：刚性连接左右隔膜中心，把气室推力传给隔膜并保证两侧严格反相运动，是往复运动的核心传力件。',
      pos: [0, 0.72, 0], explodeDir: [0, 1, 0], explodeDist: 0.5,
      removeAfter: ['diaphragmL', 'diaphragmR', 'chamberL', 'chamberR'],
      tip: '先拆两侧隔膜腔与隔膜，才能抽出连杆。',
      labelOffset: [0, 0.16, 0]
    },
    {
      id: 'diaphragmL', name: '左隔膜', group: '工作腔', color: 0x3f8f6b,
      joint: 'bolted', role: 'removable', removable: true, orientable: true,
      desc: '左隔膜：弹性膜片，外缘 0.245 半径处被气室法兰与隔膜腔法兰夹紧，中心固定在连杆上。外鼓时腔内容积增大吸液，内压时排液，是隔离介质与气侧的关键件。', 
      pos: [-0.37, 0.72, 0], explodeDir: [-1, 0, 0], explodeDist: 0.5,
      prereq: ['link'], removeAfter: ['chamberL'],
      labelOffset: [-0.1, 0.26, 0]
    },
    {
      id: 'diaphragmR', name: '右隔膜', group: '工作腔', color: 0x3f8f6b,
      joint: 'bolted', role: 'removable', removable: true, orientable: true,
      desc: '右隔膜：与左隔膜同规格、反相运动，外缘同样被气室与隔膜腔法兰夹紧。膜片疲劳破裂会导致介质进入气侧，需定期检查更换。',
      pos: [0.37, 0.72, 0], explodeDir: [1, 0, 0], explodeDist: 0.5,
      prereq: ['link'], removeAfter: ['chamberR'],
      labelOffset: [0.1, 0.26, 0]
    },
    {
      id: 'chamberL', name: '左隔膜腔', group: '工作腔', color: 0x5b7089, shell: true,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '左隔膜腔：薄壁腔体与隔膜形成左侧工作容积，内缘法兰夹紧隔膜外缘；上下接口为真实开口，分别经止回阀接进口与出口总管。',
      pos: [-0.47, 0.72, 0], explodeDir: [-1, 0, 0], explodeDist: 0.9,
      prereq: ['diaphragmL'], removeAfter: ['checkBalls', 'manifoldIn', 'manifoldOut'],
      labelOffset: [-0.15, -0.3, 0]
    },
    {
      id: 'chamberR', name: '右隔膜腔', group: '工作腔', color: 0x5b7089, shell: true,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '右隔膜腔：与左腔对称，薄壁腔体内缘法兰夹紧隔膜，上下接口为真实开口。两腔交替吸排，使出口流量比单隔膜泵更均匀。',
      pos: [0.47, 0.72, 0], explodeDir: [1, 0, 0], explodeDist: 0.9,
      prereq: ['diaphragmR'], removeAfter: ['checkBalls', 'manifoldIn', 'manifoldOut'],
      labelOffset: [0.15, -0.3, 0]
    },
    {
      id: 'checkBalls', name: '球式止回阀', group: '配流', color: 0xc9a227,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '球式止回阀：四只独立阀体，每腔上下各一只；阀体为带保持架的开放式结构，阀球在吸入时离开阀座、排出时落座，保证介质单向流动。四只阀体的位置分别对应左/右腔与进/出口，可单独观察开闭。',
      pos: [0, 0.72, 0], explodeDir: [0, 1, 0], explodeDist: 0.8,
      prereq: ['chamberL', 'chamberR'], removeAfter: ['manifoldIn', 'manifoldOut'],
      labelOffset: [0.5, 0.3, 0]
    },
    {
      id: 'manifoldIn', name: '进口总管', group: '接口', color: 0x46617e,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '进口总管：中空汇管，经两根支管分别接入左右两腔的进口止回阀，介质由此吸入泵内；两端法兰与外部吸入管路连接。',
      pos: [0, 0.36, 0], explodeDir: [0, -1, 0], explodeDist: 0.6,
      prereq: ['checkBalls'],
      labelOffset: [0.55, -0.1, 0]
    },
    {
      id: 'manifoldOut', name: '出口总管', group: '接口', color: 0x46617e,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '出口总管：中空汇管，经两根支管分别接入左右两腔的出口止回阀，加压后的介质由此排出；两端法兰与外部排出管路连接。',
      pos: [0, 1.08, 0], explodeDir: [0, 1, 0], explodeDist: 1.1,
      prereq: ['checkBalls'],
      labelOffset: [0.55, 0.1, 0]
    }
  ]
};

export const plateExchanger: DeviceDef = {
  id: 'plate-exchanger',
  name: '垫片式板式换热器',
  category: 'heat',
  categoryLabel: '换热设备',
  contentVersion: '2026-11-18.1',
  use: '用于液—液换热，传热系数高、结构紧凑、可增减板片调节面积，广泛用于暖通、食品与化工的加热冷却工况。',
  principle:
    '教学示意中两组角孔分别连通交替的板间通道，封闭环隔离另一组角孔；两股流体隔板换热。夹紧螺栓用于压紧板片组。',
  structureNote:
    '教学示意模型：所有尺寸为演示参数，12 片平板和交替角孔密封为教学示意；流道隔离经过几何检查，未验证实际流动或密封性能。导杆为悬臂式示意，未建尾部支撑。',
  learningPoints: [
    '理解冷热流体交替流道、逆流换热的布置',
    '认识垫片同时承担密封与导流分配的作用',
    '掌握夹紧尺寸对密封与板片变形的影响',
    '熟悉松开夹紧螺栓即可展开板片组的检修方式'
  ],
  objectives: [
    '能指认固定端板、活动压紧板、板片、垫片、导杆与夹紧螺栓',
    '能解释冷热流体如何在板片两侧交替流动',
    '能按顺序完成一次拆卸与组装复原'
  ],
  tasks: [
    { id: 'phe-find-plates', text: '找到换热板片组，数一数板片数量', mode: 'observe', partId: 'plates' },
    { id: 'phe-xray', text: '用透明观察查看垫片框与板片的贴合关系', mode: 'xray', partId: 'gaskets' },
    { id: 'phe-interact', text: '拖动「板片展开」，观察板片组沿导杆散开', mode: 'observe', partId: 'plates' },
    { id: 'phe-principle', text: '播放原理动画，区分热流道与冷流道', mode: 'principle' },
    { id: 'phe-practice', text: '完成一次完整的拆卸与组装复原', mode: 'practice', auto: 'practice-completion' }
  ],
  keywords: ['板式换热器', '垫片', '板片', '夹紧螺栓', '导杆', '逆流', '换热', '紧凑'],
  assemblyOrder: ['guideBars', 'plates', 'gaskets', 'movablePlate', 'bolts'],
  principleAnim: 'phe',
  trayZ: 1.7,
  parts: [
    {
      id: 'fixedPlate', name: '固定端板', group: '框架', color: 0x3d5a80, fixed: true,
      joint: 'anchor', role: 'fixed',
      desc: '固定端板：框架的固定端，接管口开在此板上，导杆与夹紧螺栓的一端锚固于此。属固定结构。',
      pos: [-0.72, 0.6, 0], explodeDir: [0, 0, 0], explodeDist: 0,
      labelOffset: [-0.15, 0.55, 0]
    },
    {
      id: 'guideBars', name: '导杆', group: '框架', color: 0x9aa7b4,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '导杆：上下两根横梁，板片与活动压紧板悬挂其上并可沿杆滑动，保证板片组对齐。上导杆通常兼作承重梁。',
      pos: [0, 0.6, 0], explodeDir: [0, 1, 0], explodeDist: 0.7,
      removeAfter: ['plates', 'gaskets', 'movablePlate', 'bolts'],
      tip: '板片及压紧板须先沿导杆端部退出，再取下导杆。',
      labelOffset: [0, 0.55, 0]
    },
    {
      id: 'plates', name: '换热板片', group: '传热元件', color: 0xb8c4d0,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '换热板片：一组薄金属板（教学模型 12 片），相邻板片形成交替的示意流道；角孔按垫片布置分别连通不同流道。实际板片压有波纹以强化传热并增加刚度。',
      pos: [0, 0.6, 0], explodeDir: [1, 0, 0], explodeDist: 1.8,
      prereq: ['guideBars'], removeAfter: ['gaskets', 'movablePlate', 'bolts'],
      labelOffset: [0, 0.45, 0.25]
    },
    {
      id: 'gaskets', name: '密封垫片', group: '密封副', color: 0x2f3e4e,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '密封垫片：贴在板片四周的示意弹性框及角孔密封环，交替隔离两组角孔；不代表实际密封性能。老化后需整组更换。',
      pos: [0, 0.6, 0], explodeDir: [1, 0, 0], explodeDist: 1.8,
      prereq: ['plates'], removeAfter: ['movablePlate', 'bolts'],
      labelOffset: [0, -0.45, 0.25]
    },
    {
      id: 'movablePlate', name: '活动压紧板', group: '框架', color: 0x3d5a80,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '活动压紧板：沿导杆滑动，夹紧螺栓收紧时把板片组压向固定端板。检修时松开螺栓即可拉开此板展开板片组。',
      pos: [-0.361, 0.6, 0], explodeDir: [1, 0, 0], explodeDist: 1.8,
      prereq: ['plates', 'gaskets'], removeAfter: ['bolts'],
      labelOffset: [0.15, 0.5, 0]
    },
    {
      id: 'bolts', name: '夹紧螺栓', group: '框架', color: 0xc9a227,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '夹紧螺栓：四角长螺栓副，均匀收紧把板片组压紧到规定夹紧尺寸。须对角交叉分次拧紧，尺寸过小会压溃垫片、过大则泄漏。',
      pos: [0, 0.6, 0], explodeDir: [1, 0, 0], explodeDist: 1.2,
      prereq: ['movablePlate', 'guideBars'],
      tip: '先松开螺母和垫圈，再沿轴线抽出螺杆并拉开活动压紧板。',
      labelOffset: [0, 0.4, 0.35]
    }
  ]
};

export const bagFilter: DeviceDef = {
  "id": "bag-filter",
  "name": "单袋式过滤器",
  "category": "filter",
  "categoryLabel": "过滤与分离设备",
  "contentVersion": "2026-11-17.5",
  "use": "去除液体中的悬浮颗粒与杂质，保护下游泵、阀门与换热设备，常用于涂料、水处理与化工物料的澄清过滤。",
  "principle": "教学示意：未过滤液体从上盖顶部入口进入滤袋口并流入袋内，穿过滤袋壁向外进入支撑篮与筒体之间，清液从下部侧口流出；杂质留在袋内。底部排污口用于排空示意。",
  "structureNote": "教学示意模型：单袋顶入式，滤袋内进外出；支撑篮以开放骨架网格示意，滤布微孔不逐个建模。孔径、筒壁和紧固件尺寸为演示参数，未依据具体厂商图纸。",
  "learningPoints": [
    "理解滤袋「内进外出」、杂质留在袋内的过滤路径",
    "认识支撑篮承托滤袋、防止压破的作用",
    "掌握开盖—取袋—换袋—复位的检修流程",
    "了解压差升高提示滤袋堵塞需更换的判断方法"
  ],
  "objectives": [
    "能指认筒体、上盖、滤袋、支撑篮、密封件与进出口",
    "能描述液体穿过滤袋壁的流动方向",
    "能按顺序完成一次拆卸与组装复原"
  ],
  "tasks": [
    {
      "id": "bf2-find-bag",
      "text": "找到滤袋与支撑篮，观察两者的嵌套关系",
      "mode": "observe",
      "partId": "bag"
    },
    {
      "id": "bf2-section",
      "text": "用剖视查看滤袋内进外出的流道",
      "mode": "section",
      "partId": "shell"
    },
    {
      "id": "bf2-interact",
      "text": "拖动「开盖换袋」，演示上盖升起与滤袋取出",
      "mode": "observe",
      "partId": "cover"
    },
    {
      "id": "bf2-principle",
      "text": "播放原理动画，指出杂质被截留的位置",
      "mode": "principle"
    },
    {
      "id": "bf2-practice",
      "text": "完成一次完整的拆卸与组装练习",
      "mode": "practice",
      "auto": "practice-completion"
    }
  ],
  "keywords": [
    "袋式过滤器",
    "滤袋",
    "支撑篮",
    "过滤",
    "澄清",
    "上盖",
    "密封",
    "压差"
  ],
  "assemblyOrder": [
    "basket",
    "bag",
    "seal",
    "cover",
    "coverBolts"
  ],
  "principleAnim": "bag",
  "trayZ": 1.7,
  "parts": [
    {
      "id": "shell",
      "name": "筒体",
      "group": "承压壳体",
      "color": 5992585,
      "shell": true,
      "fixed": true,
      "joint": "welded",
      "role": "fixed",
      "desc": "教学示意筒体有内外壁、侧面出口真实开孔、底部排污开孔与八个上法兰螺栓通孔。",
      "pos": [
        0,
        0.62,
        0
      ],
      "explodeDir": [
        0,
        0,
        0
      ],
      "explodeDist": 0,
      "labelOffset": [
        0.3,
        -0.3,
        0.2
      ]
    },
    {
      "id": "basket",
      "name": "支撑篮",
      "group": "内件",
      "color": 8161945,
      "joint": "fitted",
      "role": "removable",
      "removable": true,
      "desc": "教学示意支撑篮以带空隙的骨架网格承托滤袋，供清液向外通过；非实际穿孔板尺寸。",
      "pos": [
        0,
        0.6,
        0
      ],
      "explodeDir": [
        0,
        1,
        0
      ],
      "explodeDist": 0.6,
      "removeAfter": [
        "bag",
        "seal",
        "cover"
      ],
      "tip": "先开盖、取密封件与滤袋，再提出支撑篮。",
      "labelOffset": [
        0.24,
        0,
        0
      ]
    },
    {
      "id": "bag",
      "name": "滤袋",
      "group": "内件",
      "color": 15262936,
      "joint": "fitted",
      "role": "removable",
      "removable": true,
      "orientable": true,
      "desc": "教学示意滤袋有开放袋口、袋壁和封闭袋底，液体从袋内穿过滤布向外流动，杂质留在袋内；微孔不逐个建模。",
      "pos": [
        0,
        0.6,
        0
      ],
      "explodeDir": [
        0,
        1,
        0
      ],
      "explodeDist": 1,
      "prereq": [
        "basket"
      ],
      "removeAfter": [
        "seal",
        "cover"
      ],
      "labelOffset": [
        -0.22,
        0.1,
        0
      ]
    },
    {
      "id": "seal",
      "name": "密封件",
      "group": "密封副",
      "color": 4165483,
      "joint": "fitted",
      "role": "removable",
      "removable": true,
      "desc": "密封件：上盖 O 形圈与滤袋口密封垫，保证未过滤液体不绕过滤袋短路。换袋时一并检查更换。",
      "pos": [
        0,
        1.02,
        0
      ],
      "explodeDir": [
        0,
        1,
        0
      ],
      "explodeDist": 1.35,
      "prereq": [
        "bag"
      ],
      "removeAfter": [
        "cover"
      ],
      "labelOffset": [
        0.28,
        0.05,
        0
      ]
    },
    {
      "id": "cover",
      "name": "上盖",
      "group": "承压壳体",
      "color": 4612478,
      "joint": "bolted",
      "role": "removable",
      "removable": true,
      "desc": "教学示意上盖含封头和八个真实螺栓孔；先拆除上盖紧固件再取盖。",
      "pos": [
        0,
        1.088,
        0
      ],
      "explodeDir": [
        0,
        1,
        0
      ],
      "explodeDist": 1.7,
      "prereq": [
        "seal",
        "bag"
      ],
      "tip": "确认筒内泄压后，对角松开螺栓再吊起上盖。",
      "labelOffset": [
        0.3,
        0.15,
        0
      ],
      "removeAfter": [
        "coverBolts"
      ]
    },
    {
      "id": "nozzles",
      "name": "进出口",
      "group": "接口",
      "color": 4612478,
      "joint": "welded",
      "role": "display",
      "desc": "教学示意：上盖顶部进口进入袋内，侧面出口排出清液，底部排污口与筒体相通；各接管均为中空开放口。",
      "pos": [
        0,
        0,
        0
      ],
      "explodeDir": [
        1,
        0,
        0
      ],
      "explodeDist": 0.5,
      "labelOffset": [
        0.4,
        0.55,
        0
      ]
    },
    {
      "id": "coverBolts",
      "name": "上盖紧固件组",
      "group": "密封副",
      "pos": [
        0,
        1.1065,
        0
      ],
      "color": 9149866,
      "role": "removable",
      "joint": "bolted",
      "removable": true,
      "desc": "八组螺栓螺母与上下法兰孔同轴。 几何尺寸为教学示意参数。",
      "explodeDir": [
        0,
        1,
        0
      ],
      "explodeDist": 1.9,
      "prereq": [
        "cover"
      ]
    }
  ]
};

export const yStrainer: DeviceDef = {
  id: 'y-strainer',
  name: 'Y型管道过滤器',
  category: 'filter',
  categoryLabel: '过滤与分离设备',
  contentVersion: '2026-11-17.3',
  use: '安装在泵、阀门与仪表前的管路上，拦截焊渣、铁锈等颗粒杂质，保护下游设备，是管路系统最常用的粗过滤附件。',
  principle:
    '介质沿主管流动时穿过斜置的圆筒滤网，颗粒被截留在网内，清液通过网孔继续流动。滤网沿 Y 形支管布置，拆开滤盖即可沿支管抽出滤网清洗。',
  structureNote:
    '教学示意模型：尺寸及 45° 支管角度均为演示参数，滤网以网格示意，滤盖上的排污塞仅为外形示意，未建排污孔；实际结构及目数按设计选用。',
  learningPoints: [
    '认识隔离、泄压后沿 Y 形支管抽网清洗的特点',
    '理解滤网拦截颗粒、清液穿网的过滤路径',
    '掌握紧固件—滤盖—密封垫—滤网的拆卸顺序',
    '了解过滤器压差升高提示滤网堵塞的判断'
  ],
  objectives: [
    '能指认 Y 型阀体、滤网、滤盖、密封垫与连接接口',
    '能解释杂质被截留在滤网内的位置',
    '能按顺序完成一次拆卸与组装复原'
  ],
  tasks: [
    { id: 'ys-find-screen', text: '找到滤网，观察它与主管的倾斜角度', mode: 'observe', partId: 'screen' },
    { id: 'ys-section', text: '用剖视查看介质穿过滤网的流动路径', mode: 'section', partId: 'body' },
    { id: 'ys-interact', text: '拖动「滤网抽出」，演示沿支管抽网清洗', mode: 'observe', partId: 'screen' },
    { id: 'ys-principle', text: '播放原理动画，指出杂质聚集的位置', mode: 'principle' },
    { id: 'ys-practice', text: '完成一次完整的拆卸与组装练习', mode: 'practice', auto: 'practice-completion' }
  ],
  keywords: ['Y型过滤器', '管道过滤器', '滤网', '滤盖', '粗过滤', '保护', '管路附件'],
  assemblyOrder: ['screen', 'gasket', 'cover', 'coverBolts'],
  principleAnim: 'ystrainer',
  trayZ: 1.7,
  parts: [
    {
      id: 'body', name: 'Y型阀体', group: '承压壳体', color: 0x5b7089, shell: true, fixed: true,
      joint: 'welded', role: 'fixed',
      desc: 'Y型阀体：主管与斜支管铸成一体，支管容纳滤网并设滤盖口。属铸造固定结构，两端法兰与管路连接。',
      pos: [0, 0.5, 0], explodeDir: [0, 0, 0], explodeDist: 0,
      labelOffset: [0, 0.25, 0.2]
    },
    {
      id: 'screen', name: '滤网', group: '内件', color: 0xb8c4d0,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '滤网：圆筒形冲孔网或编织网，斜插在支管内，颗粒被截留在网内侧，清液穿网流动。抽出后可刷洗或反冲再生。',
      pos: [0.14849, 0.35151, 0], rot: [0, 0, 0.7853981633974483], explodeDir: [0.7, -0.7, 0], explodeDist: 0.55,
      removeAfter: ['gasket', 'cover'],
      tip: '先拆滤盖与密封垫，再沿支管方向抽出滤网。',
      labelOffset: [0.15, -0.1, 0]
    },
    {
      id: 'gasket', name: '密封垫', group: '密封副', color: 0x3f8f6b,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '密封垫：滤盖与支管法兰间的垫片，防止介质外漏，拆盖后检查更换。',
      pos: [0.26446, 0.23554, 0], rot: [0, 0, 0.7853981633974483], explodeDir: [0.7, -0.7, 0], explodeDist: 0.8,
      prereq: ['screen'], removeAfter: ['cover'],
      labelOffset: [0.18, -0.05, 0]
    },
    {
      id: 'cover', name: '滤盖', group: '承压壳体', color: 0x46617e,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '滤盖：以螺栓封闭支管端部；中心排污塞仅作外形示意，未建排污孔。',
      pos: [0.27931, 0.22069, 0], rot: [0, 0, 0.7853981633974483], explodeDir: [0.7, -0.7, 0], explodeDist: 1.05,
      prereq: ['gasket', 'screen'],
      tip: '隔离并确认泄压后，先拆紧固件再取下滤盖。',
      removeAfter: ['coverBolts'],
      labelOffset: [0.2, -0.12, 0]
    },
    {
      id: 'coverBolts', name: '滤盖紧固件组', group: '密封副', color: 0xb8c4d0,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '四组螺栓、螺母及垫圈与滤盖及支管法兰孔同轴，尺寸为演示参数。',
      pos: [0.268701, 0.231299, 0], rot: [0, 0, 0.7853981633974483],
      explodeDir: [0.7, -0.7, 0], explodeDist: 1.35,
      prereq: ['cover'], tip: '隔离并确认泄压后，按规范松开紧固件。'
    },
    {
      id: 'ports', name: '连接接口', group: '接口', color: 0x46617e,
      joint: 'welded', role: 'display',
      desc: '连接接口：两端法兰密封面与螺栓孔，与管路法兰配对连接。属固定结构，安装时注意流向箭头。',
      pos: [0, 0.5, 0], explodeDir: [0, 0, 1], explodeDist: 0.4,
      labelOffset: [0.32, 0.15, 0]
    }
  ]
};

export const fixedRoofTank: DeviceDef = {
  id: 'fixed-roof-tank',
  name: '立式固定顶储罐',
  category: 'tank',
  categoryLabel: '储存设备',
  contentVersion: '2026-11-17.1',
  use: '常压储存液体物料（水、油品、化学品），固定顶结构适合蒸气压较低的介质，是化工罐区最常见的储罐形式。',
  principle:
    '物料经顶部进口管进入罐内，靠重力从底部出口排出。罐顶呼吸阀随进出料与温度变化自动呼气吸气，维持罐内微正压/微负压，保护罐体不被吸瘪或超压。',
  structureNote:
    '教学示意模型：罐底、罐壁、罐顶为焊接固定结构（标记为固定，不可拆卸），人孔盖、呼吸阀与液位计作为可拆附件。液位以演示数据示意。',
  learningPoints: [
    '认识罐底—罐壁—罐顶的焊接整体结构',
    '理解呼吸阀维持罐内压力平衡的保护作用',
    '掌握人孔用于检修进出的功能与开启要求',
    '了解液位计连通器原理与液位观察方法'
  ],
  objectives: [
    '能指认罐底、罐壁、固定罐顶、人孔、进出口与液位观察部件',
    '能解释进出料时呼吸阀的呼气吸气过程',
    '能完成人孔盖、呼吸阀与液位计的拆装练习'
  ],
  tasks: [
    { id: 'tk-find-manway', text: '找到人孔，观察它在罐壁下部的布置', mode: 'observe', partId: 'manwayCover' },
    { id: 'tk-section', text: '用剖视查看罐内液位与进出口的位置关系', mode: 'section', partId: 'shell' },
    { id: 'tk-interact', text: '拖动「液位高度」，观察液位计与罐内液位同步', mode: 'observe', partId: 'levelGauge' },
    { id: 'tk-principle', text: '播放原理动画，描述进料与出料时的呼吸过程', mode: 'principle' },
    { id: 'tk-practice', text: '完成一次附件拆卸与组装练习', mode: 'practice', auto: 'practice-completion' }
  ],
  keywords: ['储罐', '固定顶', '立式', '罐区', '呼吸阀', '人孔', '液位计', '常压', '储存'],
  assemblyOrder: ['vent', 'manwayCover', 'levelGauge'],
  principleAnim: 'tank',
  trayZ: 1.9,
  parts: [
    {
      id: 'bottom', name: '罐底', group: '罐体', color: 0x4b5563, fixed: true,
      joint: 'welded', role: 'fixed',
      desc: '罐底：中幅板与边缘板焊接而成，支承在基础上，边缘板较厚以承受罐壁传来的载荷。属焊接固定结构。',
      pos: [0, 0.12, 0], explodeDir: [0, -1, 0], explodeDist: 0.4,
      labelOffset: [0.6, -0.05, 0.3]
    },
    {
      id: 'shell', name: '罐壁', group: '罐体', color: 0x5b7089, shell: true,
      joint: 'welded', role: 'display',
      desc: '罐壁：多圈壁板逐圈焊接，下圈厚上圈薄以承受液压。属焊接固定结构，不可拆卸；剖视与透明模式可观察内部液位。',
      pos: [0, 0.95, 0], explodeDir: [0, 1, 0], explodeDist: 0.5,
      labelOffset: [0.72, 0.3, 0]
    },
    {
      id: 'roof', name: '固定罐顶', group: '罐体', color: 0x46617e,
      joint: 'welded', role: 'display',
      desc: '固定罐顶：锥顶板与包边角钢焊接在罐壁上，中心设呼吸阀口。属焊接固定结构，与罐壁形成整体。',
      pos: [0, 1.82, 0], explodeDir: [0, 1, 0], explodeDist: 0.8,
      labelOffset: [0.5, 0.15, 0]
    },
    {
      id: 'vent', name: '呼吸阀', group: '附件', color: 0xc9a227,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '呼吸阀：罐顶压力保护装置，罐内超压时呼出气体、负压时吸入空气，维持微压平衡。以螺栓安装在罐顶接管上，可拆检阀盘。',
      pos: [0, 2.0, 0], explodeDir: [0, 1, 0], explodeDist: 1.1,
      tip: '呼吸阀以螺栓固定在罐顶接管法兰上，拆下螺栓即可取出。',
      labelOffset: [0.2, 0.15, 0]
    },
    {
      id: 'manwayNeck', name: '人孔短节', group: '附件', color: 0x46617e,
      joint: 'welded', role: 'display',
      desc: '人孔短节：焊在罐壁下部的开孔补强短节，法兰面供人孔盖密封。属焊接固定结构。',
      pos: [0.72, 0.62, 0], explodeDir: [1, 0, 0], explodeDist: 0.5,
      labelOffset: [0.15, -0.2, 0]
    },
    {
      id: 'manwayCover', name: '人孔盖', group: '附件', color: 0x3d5a80,
      joint: 'bolted', role: 'removable', removable: true, orientable: true,
      desc: '人孔盖：螺栓压紧的封盖，带把手与垫片。检修时打开供人员进出罐内，开启前必须确认罐内清洗置换合格。',
      pos: [0.86, 0.62, 0], explodeDir: [1, 0, 0], explodeDist: 0.85,
      tip: '对角松开螺栓后取下人孔盖，注意保留垫片。',
      labelOffset: [0.18, 0.2, 0]
    },
    {
      id: 'nozzles', name: '进出口', group: '接口', color: 0x46617e,
      joint: 'welded', role: 'display',
      desc: '进出口：顶部进料管、底部出料管与排污口，接管与罐体焊接，法兰与外部管路连接。属固定结构。',
      pos: [0, 0, 0], explodeDir: [1, 0, 0], explodeDist: 0.4,
      labelOffset: [0.55, 0.35, 0.3]
    },
    {
      id: 'levelGauge', name: '液位观察部件', group: '附件', color: 0x3f8f6b,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '液位计：玻璃管液位计经上下两只角阀与罐内连通，利用连通器原理显示液位，带刻度板。角阀关闭后可拆下玻璃管更换。',
      pos: [0.88, 0.95, 0.35], explodeDir: [1, 0, 0], explodeDist: 1.2,
      labelOffset: [0.2, 0.4, 0]
    }
  ]
};

export const gasSeparator: DeviceDef = {
  id: 'gas-separator',
  name: '立式气液分离器',
  category: 'filter',
  categoryLabel: '过滤与分离设备',
  contentVersion: '2026-11-17.1',
  use: '分离气体中夹带的液滴，保护下游压缩机与仪表，常见于压缩机入口、蒸汽管路与反应尾气系统。',
  principle:
    '气液混合物切向或经挡板进入筒体，流速骤降并改变方向，液滴因惯性撞壁聚结后沿壁落至底部；气体折流向上经丝网除沫器捕集细雾，干气从顶部排出，液体从底部排出。',
  structureNote:
    '教学示意模型：入口挡板 + 重力沉降 + 丝网除沫三级分离，丝网以环带示意，液位为演示数据。筒体焊接固定，除沫器与人孔盖可拆。',
  learningPoints: [
    '理解「挡板惯性分离 + 重力沉降 + 丝网除沫」的三级分离',
    '认识气液两相在筒体内的走向：液向下、气向上',
    '掌握丝网除沫器捕集细雾的作用与清洗方式',
    '了解液位控制对防止气体带液的重要性'
  ],
  objectives: [
    '能指认筒体、入口挡板、丝网除沫器、液位观察与气液出口',
    '能描述液滴从入口到罐底、气体从除沫器到顶口的路径',
    '能完成除沫器、人孔盖与液位计的拆装练习'
  ],
  tasks: [
    { id: 'gs-find-demister', text: '找到丝网除沫器，观察它在气体出口前的位置', mode: 'observe', partId: 'demister' },
    { id: 'gs-section', text: '用剖视查看入口挡板与底部液相空间', mode: 'section', partId: 'shell' },
    { id: 'gs-interact', text: '拖动「液位高度」，观察底部液位变化', mode: 'observe', partId: 'levelGauge' },
    { id: 'gs-principle', text: '播放原理动画，区分液滴下落与气体上升的路径', mode: 'principle' },
    { id: 'gs-practice', text: '完成一次内件拆卸与组装练习', mode: 'practice', auto: 'practice-completion' }
  ],
  keywords: ['分离器', '气液分离', '除沫器', '丝网', '挡板', '立式', '压缩机保护', '液位'],
  assemblyOrder: ['demister', 'manwayCover', 'levelGauge'],
  principleAnim: 'separator',
  trayZ: 1.7,
  parts: [
    {
      id: 'legs', name: '支座', group: '支承', color: 0x4b5563, fixed: true,
      joint: 'anchor', role: 'fixed',
      desc: '支腿支座：三条支腿支承筒体并固定于基础。属基础固定结构。',
      pos: [0, 0.2, 0], explodeDir: [0, -1, 0], explodeDist: 0.35,
      labelOffset: [0.4, 0, 0.2]
    },
    {
      id: 'shell', name: '筒体', group: '承压壳体', color: 0x5b7089, shell: true,
      joint: 'welded', role: 'display',
      desc: '筒体：立式圆筒加上下封头，提供沉降空间，底部积液、顶部集气。属焊接固定结构。',
      pos: [0, 0.95, 0], explodeDir: [0, 1, 0], explodeDist: 0.5,
      labelOffset: [0.42, 0.2, 0]
    },
    {
      id: 'inletBaffle', name: '入口挡板', group: '内件', color: 0x7c8a99,
      joint: 'welded', role: 'display',
      desc: '入口挡板：入口管对面的折流板，混合物撞板后改变方向，液滴因惯性聚结下落，完成初级分离。焊在筒壁上，属固定结构。',
      pos: [0.28, 1.25, 0], explodeDir: [1, 0, 0], explodeDist: 0.6,
      labelOffset: [0.2, 0.15, 0]
    },
    {
      id: 'demister', name: '丝网除沫器', group: '内件', color: 0xb8c4d0,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '丝网除沫器：气体出口前的丝网垫，细雾撞丝聚结成大液滴落回罐内，保证出口气体干燥。可抽出清洗或更换。',
      pos: [0, 1.42, 0], explodeDir: [0, 1, 0], explodeDist: 0.8,
      tip: '打开顶部法兰后垂直提出丝网除沫器，注意不要压溃丝网。',
      labelOffset: [0.35, 0.1, 0]
    },
    {
      id: 'manwayCover', name: '人孔盖', group: '附件', color: 0x3d5a80,
      joint: 'bolted', role: 'removable', removable: true, orientable: true,
      desc: '人孔盖：筒体下部检修人孔的封盖，螺栓压紧密封，供检修内件与清罐进出。',
      pos: [0.44, 0.75, 0], explodeDir: [1, 0, 0], explodeDist: 0.7,
      labelOffset: [0.18, 0.18, 0]
    },
    {
      id: 'levelGauge', name: '液位观察', group: '附件', color: 0x3f8f6b,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '液位计：玻璃管液位计经角阀与底部液相空间连通，显示积液液位，液位过高会导致气体带液。',
      pos: [0.52, 0.6, 0.2], explodeDir: [1, 0, 0], explodeDist: 1.0,
      labelOffset: [0.18, 0.3, 0]
    },
    {
      id: 'nozzles', name: '气液出口', group: '接口', color: 0x46617e,
      joint: 'welded', role: 'display',
      desc: '气液出口：顶部干气出口、底部液体出口与排污口，接管与筒体焊接。属固定结构。',
      pos: [0, 0, 0], explodeDir: [1, 0, 0], explodeDist: 0.4,
      labelOffset: [0.35, 1.75, 0]
    }
  ]
};

export const packedTower: DeviceDef = {
  id: 'packed-tower',
  name: '填料塔',
  category: 'reaction',
  categoryLabel: '反应与塔器设备',
  contentVersion: '2026-11-17.1',
  use: '用于吸收、解吸与精馏等气液传质过程，填料提供巨大比表面积，常见于尾气吸收与溶剂回收装置。',
  principle:
    '液体从塔顶分布器喷淋而下，沿填料表面成膜流动；气体从塔底进入自下而上穿过填料层，与液膜在填料表面逆流接触完成传质。填料支撑承托填料层并保证气液通过。',
  structureNote:
    '教学示意模型：两段填料床以波纹板简化表示规整填料，分布器以槽盘示意，塔体焊接固定，填料模块与分布器可吊装拆检。',
  learningPoints: [
    '理解气液逆流接触传质的基本流程',
    '认识液体分布器均匀布液对填料效率的影响',
    '掌握填料支撑承托与通流的双重作用',
    '了解填料分段与液体再分布的工程考虑'
  ],
  objectives: [
    '能指认塔体、填料模块、液体分布器、填料支撑与气液进出口',
    '能描述气体向上、液体向下的逆流路径',
    '能完成填料模块与分布器的吊装拆装练习'
  ],
  tasks: [
    { id: 'pk-find-packing', text: '找到两段填料模块，观察波纹板的交错布置', mode: 'observe', partId: 'packing1' },
    { id: 'pt-section', text: '用剖视查看分布器在填料层上方的位置', mode: 'section', partId: 'distributor' },
    { id: 'pt-interact', text: '拖动「填料吊装」，演示填料模块逐段吊出', mode: 'observe', partId: 'packing2' },
    { id: 'pt-principle', text: '播放原理动画，区分气相与液相的流动方向', mode: 'principle' },
    { id: 'pt-practice', text: '完成一次填料吊装拆装练习', mode: 'practice', auto: 'practice-completion' }
  ],
  keywords: ['填料塔', '吸收', '精馏', '填料', '分布器', '支撑', '逆流', '传质', '塔器'],
  assemblyOrder: ['packing1', 'packing2', 'distributor'],
  principleAnim: 'tower',
  trayZ: 1.9,
  parts: [
    {
      id: 'skirt', name: '支座', group: '支承', color: 0x4b5563, fixed: true,
      joint: 'anchor', role: 'fixed',
      desc: '裙式支座：圆筒裙座支承塔体并固定于基础，底部设地脚螺栓。属基础固定结构。',
      pos: [0, 0.25, 0], explodeDir: [0, -1, 0], explodeDist: 0.35,
      labelOffset: [0.4, 0, 0.2]
    },
    {
      id: 'shell', name: '塔体', group: '承压壳体', color: 0x5b7089, shell: true,
      joint: 'welded', role: 'display',
      desc: '塔体：立式圆筒，上下封头设法兰口供内件吊装。属焊接固定结构。',
      pos: [0, 1.25, 0], explodeDir: [0, 1, 0], explodeDist: 0.6,
      labelOffset: [0.38, 0.4, 0]
    },
    {
      id: 'support', name: '填料支撑', group: '内件', color: 0x7c8a99,
      joint: 'welded', role: 'display',
      desc: '填料支撑：栅板式支承件，承托填料层重量并留出足够自由截面让气液通过。焊在塔壁上，属固定结构。',
      pos: [0, 0.55, 0], explodeDir: [0, -1, 0], explodeDist: 0.5,
      labelOffset: [0.35, -0.08, 0]
    },
    {
      id: 'packing1', name: '填料模块A', group: '内件', color: 0xb8c4d0,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '填料模块A：下段规整填料床，波纹板交错叠置形成巨大比表面积，液膜与气流在其表面接触传质。整段吊装检修。',
      pos: [0, 0.85, 0], explodeDir: [0, 1, 0], explodeDist: 0.7,
      removeAfter: ['packing2', 'distributor'],
      tip: '先吊出分布器与上段填料，再吊出下段填料模块。',
      labelOffset: [0.33, 0, 0]
    },
    {
      id: 'packing2', name: '填料模块B', group: '内件', color: 0xa9b6c2,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '填料模块B：上段填料床，与下段之间可设液体再分布器消除壁流。两段布置便于分段检修与更换。',
      pos: [0, 1.45, 0], explodeDir: [0, 1, 0], explodeDist: 1.1,
      prereq: ['packing1'], removeAfter: ['distributor'],
      labelOffset: [0.33, 0, 0]
    },
    {
      id: 'distributor', name: '液体分布器', group: '内件', color: 0xc9a227,
      joint: 'bolted', role: 'removable', removable: true, orientable: true,
      desc: '液体分布器：槽盘式布液件，把进塔液体均匀分配到填料截面，布液不均会显著降低传质效率。以螺栓固定在塔壁支耳上。',
      pos: [0, 1.85, 0], explodeDir: [0, 1, 0], explodeDist: 1.5,
      prereq: ['packing2'],
      tip: '分布器位于最上方，最先吊出、最后装回，注意水平度。',
      labelOffset: [0.35, 0.12, 0]
    },
    {
      id: 'nozzles', name: '气液进出口', group: '接口', color: 0x46617e,
      joint: 'welded', role: 'display',
      desc: '气液进出口：塔底进气口与排液口、塔顶排气口与进液口，接管与塔体焊接。属固定结构。',
      pos: [0, 0, 0], explodeDir: [1, 0, 0], explodeDist: 0.5,
      labelOffset: [0.45, 0.35, 0]
    }
  ]
};

export const cycloneSeparator: DeviceDef = {
  id: 'cyclone-separator',
  name: '旋风分离器',
  category: 'filter',
  categoryLabel: '过滤与分离设备',
  contentVersion: '2026-11-17.1',
  use: '利用离心力从气流中分离粉尘颗粒，无运动部件、耐高温，常用于锅炉烟气、催化裂化与粉体输送的预分离。',
  principle:
    '含尘气体切向进入筒体形成外旋流高速旋转，颗粒受离心力甩向壁面并沿壁螺旋下落至锥底排料口；净化后的气体在中心形成内旋流，经中心排气管向上排出。',
  structureNote:
    '教学示意模型：筒体—锥体—切向入口—中心排气管经典布置，旋转气流与颗粒轨迹为演示动画，分离效率为示意值非计算结果。',
  learningPoints: [
    '理解离心沉降远强于重力沉降的分离强化',
    '认识外旋流向下、内旋流向上的双旋结构',
    '掌握锥体浓缩粉尘与排料口锁气的作用',
    '了解入口风速与分离效率、压降的关系'
  ],
  objectives: [
    '能指认筒体、锥体、切向入口、中心排气管与底部排料口',
    '能描述颗粒从入口到排料口、气体从排气管排出的路径',
    '能解释为什么排料口必须锁气防止二次扬尘'
  ],
  tasks: [
    { id: 'cy-find-inlet', text: '找到切向入口，观察它沿筒体切线的布置', mode: 'observe', partId: 'inlet' },
    { id: 'cy-section', text: '用剖视查看中心排气管插入筒体的深度', mode: 'section', partId: 'vortexFinder' },
    { id: 'cy-interact', text: '拖动「锥体检修」，演示锥体下移露出内部', mode: 'observe', partId: 'cone' },
    { id: 'cy-principle', text: '播放原理动画，区分含尘外旋流与净化内旋流', mode: 'principle' }
  ],
  keywords: ['旋风分离器', '除尘', '离心分离', '切向入口', '排气管', '锥体', '粉尘', '气固分离'],
  assemblyOrder: [],
  principleAnim: 'cyclone',
  trayZ: 1.7,
  parts: [
    {
      id: 'legs', name: '支座', group: '支承', color: 0x4b5563, fixed: true,
      joint: 'anchor', role: 'fixed',
      desc: '支腿支座：支承筒体与锥体并固定于基础。属基础固定结构。',
      pos: [0, 0.3, 0], explodeDir: [0, -1, 0], explodeDist: 0.3,
      labelOffset: [0.35, 0, 0.2]
    },
    {
      id: 'cylinder', name: '筒体', group: '分离空间', color: 0x5b7089, shell: true,
      joint: 'welded', role: 'display',
      desc: '筒体：圆筒段提供外旋流旋转空间，颗粒在此被甩向壁面。属焊接固定结构。',
      pos: [0, 1.35, 0], explodeDir: [0, 1, 0], explodeDist: 0.6,
      labelOffset: [0.32, 0.2, 0]
    },
    {
      id: 'cone', name: '锥体', group: '分离空间', color: 0x46617e, shell: true,
      joint: 'welded', role: 'display',
      desc: '锥体：收缩段使旋流加速并浓缩粉尘，把颗粒导向底部排料口。属焊接固定结构，检修时可拆下检查磨损。',
      pos: [0, 0.65, 0], explodeDir: [0, -1, 0], explodeDist: 0.6,
      labelOffset: [0.28, -0.1, 0]
    },
    {
      id: 'inlet', name: '切向入口', group: '接口', color: 0x7c8a99,
      joint: 'welded', role: 'display',
      desc: '切向入口：含尘气体沿筒体切线方向进入，形成高速旋转的外旋流，是产生离心分离的起点。',
      pos: [0.3, 1.5, 0.18], explodeDir: [0, 0, 1], explodeDist: 0.6,
      labelOffset: [0.15, 0.15, 0.15]
    },
    {
      id: 'vortexFinder', name: '中心排气管', group: '内件', color: 0xb8c4d0,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '中心排气管：插入筒体顶部的中心管，引导净化后的内旋流向上排出，插入深度影响短路流与分离效率。可从顶部抽出检修。',
      pos: [0, 1.78, 0], explodeDir: [0, 1, 0], explodeDist: 0.9,
      labelOffset: [0.2, 0.25, 0]
    },
    {
      id: 'dustOutlet', name: '底部排料口', group: '接口', color: 0x7c8a99,
      joint: 'welded', role: 'display',
      desc: '底部排料口：锥底粉尘出口，须配锁气阀防止空气倒吸把已分离粉尘重新卷起。',
      pos: [0, 0.22, 0], explodeDir: [0, -1, 0], explodeDist: 0.5,
      labelOffset: [0.2, -0.1, 0]
    }
  ]
};

export const screwCompressor: DeviceDef = {
  id: 'screw-compressor',
  name: '喷油双螺杆空气压缩机',
  category: 'pump',
  categoryLabel: '泵与压缩设备',
  contentVersion: '2026-11-20.1',
  use: '连续提供压缩空气，喷油起密封、冷却与润滑作用，排气平稳、易损件少，是工厂气动系统与仪表风的主力机型。',
  principle:
    '阴阳转子相互啮合旋转，齿间容积从进气端向排气端逐渐减小：进气端容积增大吸入空气，中段喷油密封冷却，排气端容积缩小把油气混合物压出，再经油气分离得到压缩空气。',
  structureNote:
    '教学示意重建：机壳为带真实双圆柱腔的 8 字形双孔壳体，两端设端板与四套轴承座；阳转子 4 瓣、阴转子 6 瓣，采用沿轴向扭转的教学螺旋型线（不是厂商型线），真实型线、间隙与性能待资料确认。进气端在顶部 -X、排气端在底部 +X，排气管穿过底座中央开口，不再被底座遮挡；中段顶部设喷油口。纵向剖视与原理动画用于说明气体沿轴向输送方向。',
  learningPoints: [
    '理解「齿间容积逐渐减小」的容积式压缩原理',
    '观察双孔机壳与阴阳转子沿轴向的啮合关系',
    '认识喷油的密封、冷却、润滑三重作用',
    '确认进气端、压缩中段与排气端的位置及排气通道畅通',
    '了解教学型线与真实型线/间隙的差异'
  ],
  objectives: [
    '能指认机壳、阴阳转子、轴承、进排气口与喷油位置',
    '能描述气体沿转子轴向被逐步压缩的过程',
    '能解释喷油位置为什么设在压缩中段',
    '能指出排气端通道并说明底座不得封堵排气'
  ],
  tasks: [
    { id: 'sc-find-rotors', text: '找到阴阳转子，观察 4/6 瓣与啮合关系', mode: 'observe', partId: 'maleRotor' },
    { id: 'sc-xray', text: '用透明观察查看双孔机腔与齿间容积沿轴向的变化', mode: 'xray', partId: 'housing' },
    { id: 'sc-section-flow', text: '用纵向剖视查看双转子、进气端与排气端，指出气体沿轴向输送方向', mode: 'section' },
    { id: 'sc-interact', text: '拖动「转子转角」，观察两转子反向啮合旋转', mode: 'observe', partId: 'maleRotor' },
    { id: 'sc-principle', text: '播放原理动画，指出进气、喷油与排气区域', mode: 'principle' }
  ],
  keywords: ['螺杆压缩机', '喷油', '双螺杆', '阳转子', '阴转子', '双孔', '螺旋型线', '压缩空气', '容积式', '轴承'],
  assemblyOrder: [],
  principleAnim: 'screw',
  trayZ: 1.7,
  parts: [
    {
      id: 'base', name: '底座', group: '支承', color: 0x4b5563, fixed: true,
      joint: 'anchor', role: 'fixed',
      desc: '公共底座：纵梁与横梁组成的敞开式底架，中央留出排气通道；排气口穿过底架开口向下排出，不被底座板封堵。属基础固定结构。',
      pos: [0, 0.15, 0], explodeDir: [0, -1, 0], explodeDist: 0.3,
      labelOffset: [0.55, 0, 0.25]
    },
    {
      id: 'housing', name: '机壳', group: '承压壳体', color: 0x5b7089, shell: true,
      joint: 'bolted', role: 'display',
      desc: '机壳：带两个真实圆柱腔的 8 字形双孔壳体，包容 4/6 瓣阴阳转子；两端端板与轴承座封住腔体，顶部 -X 侧为进气口、底部 +X 侧为排气口，中段顶部为喷油口。齿顶与内壁间隙为教学示意。',
      pos: [0, 0.7, 0], explodeDir: [0, 1, 0], explodeDist: 0.6,
      labelOffset: [0, 0.35, 0.25]
    },
    {
      id: 'maleRotor', name: '阳转子', group: '转子', color: 0xc9a227,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '阳转子：4 瓣螺旋形凸齿转子，与驱动轴相连主动旋转，齿槽与阴转子啮合形成沿轴向逐渐缩小的容积。型线为教学近似，真实型线与间隙待资料确认；+X 端为驱动/联轴器端。',
      pos: [0, 0.825, 0], explodeDir: [0, 1, 0], explodeDist: 0.9,
      labelOffset: [0.3, 0.15, 0]
    },
    {
      id: 'femaleRotor', name: '阴转子', group: '转子', color: 0xb8c4d0,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '阴转子：6 瓣螺旋形凹齿转子，被阳转子带动反向旋转，转速比为阳:阴 = 6:4，齿槽携带气体向排气端移动。型线为教学近似，真实型线与间隙待资料确认。',
      pos: [0, 0.575, 0], explodeDir: [0, -1, 0], explodeDist: 0.7,
      labelOffset: [0.3, -0.15, 0]
    },
    {
      id: 'bearings', name: '轴承', group: '支承', color: 0x7c8a99,
      joint: 'fitted', role: 'display',
      desc: '轴承：两端共四套轴承座，径向与推力轴承支承两根转子，承受气体压差产生的轴向力，保证啮合间隙稳定；端盖以螺栓固定并可拆检。',
      pos: [0, 0.7, 0], explodeDir: [1, 0, 0], explodeDist: 0.6,
      labelOffset: [0.48, 0.2, 0]
    },
    {
      id: 'inlet', name: '进气口', group: '接口', color: 0x46617e,
      joint: 'welded', role: 'display',
      desc: '进气口：位于机壳进气端（-X）上方，为真实中空接管与法兰；空气经滤清器与进气阀由此进入转子齿间容积。',
      pos: [-0.35, 1.05, 0], explodeDir: [0, 1, 0], explodeDist: 0.7,
      labelOffset: [-0.15, 0.15, 0]
    },
    {
      id: 'outlet', name: '排气口', group: '接口', color: 0x46617e,
      joint: 'welded', role: 'display',
      desc: '排气口：位于机壳排气端（+X）下方，为真实中空接管与法兰；油气混合物由此向下排出进入油气分离器。排气管穿过底架中央开口，端部在底架下方，不被底座遮挡。',
      pos: [0.35, 0.30, 0], explodeDir: [0, -1, 0], explodeDist: 0.6,
      labelOffset: [0.15, -0.15, 0]
    },
    {
      id: 'oilInject', name: '喷油位置', group: '接口', color: 0xd97706,
      joint: 'welded', role: 'display',
      desc: '喷油口：压缩中段（x≈0.05）顶部喷入润滑油，经真实接管与机壳油孔进入齿间，密封间隙、吸收压缩热并润滑转子；喷油量按排气温度调节。',
      pos: [0.05, 1.02, 0], explodeDir: [0, 1, 0], explodeDist: 0.9,
      labelOffset: [0.15, 0.12, 0]
    }
  ]
};

export const emfMeter: DeviceDef = {
  id: 'emf-meter',
  name: '电磁流量计',
  category: 'instr',
  categoryLabel: '测量仪表',
  contentVersion: '2026-11-17.1',
  use: '测量导电液体（水、污水、酸碱盐溶液）的体积流量，无阻流件、无压损，衬里与电极材质可选以适应腐蚀性介质。',
  principle:
    '基于法拉第电磁感应定律：励磁线圈在测量管两侧建立磁场，导电液体流过时切割磁力线，在与流向、磁场均垂直的一对电极上感应出与平均流速成正比的电动势，变送器换算为流量。',
  structureNote:
    '教学示意模型：磁场沿竖直方向、电极沿水平横向布置（E = v × B），衬里以白色绝缘层示意。读数为演示数据，非真实标定结果；不能测量气体与不导电液体。',
  learningPoints: [
    '理解感应电动势 E = B·D·v 与流速的线性关系',
    '认识流向、磁场、电极三者两两垂直的布置',
    '掌握绝缘衬里防止信号短路的作用',
    '了解电磁流量计只能测导电液体的限制'
  ],
  objectives: [
    '能指认测量管、绝缘内衬、电极、励磁线圈、连接法兰与变送器',
    '能解释为什么电极必须与磁场方向垂直',
    '能说明衬里破损或电极结垢对测量的影响'
  ],
  tasks: [
    { id: 'em-find-electrodes', text: '找到一对电极，观察它们与流向垂直的布置', mode: 'observe', partId: 'electrodes' },
    { id: 'em-section', text: '用剖视查看绝缘内衬与测量管的关系', mode: 'section', partId: 'liner' },
    { id: 'em-interact', text: '拖动「电极检修」，演示电极从管壁抽出检查', mode: 'observe', partId: 'electrodes' },
    { id: 'em-principle', text: '播放原理动画，观察导电液体切割磁力线产生信号', mode: 'principle' }
  ],
  keywords: ['电磁流量计', '流量', '仪表', '电极', '励磁线圈', '衬里', '变送器', '导电液体', '法拉第'],
  assemblyOrder: [],
  principleAnim: 'emf',
  trayZ: 1.7,
  parts: [
    {
      id: 'tube', name: '测量管', group: '测量本体', color: 0x5b7089, shell: true,
      joint: 'welded', role: 'display',
      desc: '测量管：非导磁金属管，构成磁路的一部分并承压，内壁衬绝缘层。属焊接固定结构。',
      pos: [0, 0.6, 0], explodeDir: [0, 1, 0], explodeDist: 0.5,
      labelOffset: [0, 0.25, 0.2]
    },
    {
      id: 'liner', name: '绝缘内衬', group: '测量本体', color: 0xe8e4d8,
      joint: 'fitted', role: 'display',
      desc: '绝缘内衬：聚四氟乙烯或橡胶衬里，隔离导电液体与金属管壁，防止感应信号被短路，同时耐腐蚀。',
      pos: [0, 0.6, 0], explodeDir: [0, -1, 0], explodeDist: 0.5,
      labelOffset: [0, -0.2, 0.15]
    },
    {
      id: 'electrodes', name: '电极', group: '信号检出', color: 0xc9a227,
      joint: 'fitted', role: 'removable', removable: true,
      desc: '电极：一对与液体接触的金属电极，沿垂直于流向与磁场的方向安装，检出感应电动势。结垢或腐蚀会引起信号漂移，可抽出检查。',
      pos: [0, 0.6, 0], explodeDir: [0, 0, 1], explodeDist: 0.6,
      labelOffset: [0, 0.1, 0.25]
    },
    {
      id: 'coils', name: '励磁线圈', group: '磁场系统', color: 0x3d5a80,
      joint: 'bolted', role: 'display',
      desc: '励磁线圈：上下两只线圈通以低频方波电流，在测量管内建立交变磁场，是感应信号的激励源。',
      pos: [0, 0.6, 0], explodeDir: [0, 1, 0], explodeDist: 0.8,
      labelOffset: [0.25, 0.25, 0]
    },
    {
      id: 'flanges', name: '连接法兰', group: '接口', color: 0x46617e,
      joint: 'welded', role: 'display',
      desc: '连接法兰：两端法兰与管路配对安装，须保证满管与前后直管段要求。属固定结构。',
      pos: [0, 0.6, 0], explodeDir: [1, 0, 0], explodeDist: 0.5,
      labelOffset: [0.35, -0.15, 0]
    },
    {
      id: 'transmitter', name: '变送器', group: '信号处理', color: 0x3f8f6b,
      joint: 'bolted', role: 'removable', removable: true,
      desc: '变送器：放大电极微弱信号、抑制干扰并换算为流量显示与标准输出，表头读数为演示数据。以螺栓安装在表颈上。',
      pos: [0, 0.98, 0], explodeDir: [0, 1, 0], explodeDist: 1.0,
      labelOffset: [0.2, 0.15, 0]
    }
  ]
};

export const DEVICES: DeviceDef[] = [
  pump, exchanger, reactor,
  ballValve, gateValve, butterflyValve, checkValve, gearPump, diaphragmPump,
  plateExchanger, bagFilter, yStrainer,
  fixedRoofTank, gasSeparator, packedTower, cycloneSeparator, screwCompressor, emfMeter
];
export const deviceById = (id: string) => DEVICES.find((d) => d.id === id);

export const JOINT_LABEL: Record<string, string> = {
  welded: '焊接连接',
  bolted: '螺栓连接',
  fitted: '配合/键联',
  anchor: '基础固定'
};

export const ROLE_LABEL: Record<string, string> = {
  fixed: '固定结构',
  removable: '可拆卸部件',
  display: '仅用于结构展开'
};
