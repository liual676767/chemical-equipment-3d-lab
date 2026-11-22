/* 零件库目录：第一批（batch 1）23 个对象已实现并可搭建；
 * 第二、三批对象保留完整教学内容并明确标注「开发中」状态。 */
import type { CatalogPart, PortDef } from './types';
import { portsFor } from './layout';
import { PIPE_DN_LIST } from './specs';
import { assemblyAssets, assemblyAssetById, courseNames } from './expansion';

type Entry = Omit<CatalogPart, 'ports'> & { ports?: PortDef[] };

function mk(p: Entry): CatalogPart {
  return { ...p, ports: p.ports ?? portsFor(p.id, p.defaultSpec) };
}

const STEEL = '#8a97a8';
const FLANGE_C = '#9aa7b6';
const VALVE_C = '#3b6ea5';

const legacyCatalog: CatalogPart[] = [
  /* ============ 管道与管件（第一批，10） ============ */
  mk({
    id: 'pipe', name: '直管', category: 'pipe', status: 'ready', batch: 1,
    summary: '具有可辨认内外壁与两端开口的圆管，长度与规格可调，端部可设为焊接、螺纹或法兰连接形式。',
    usage: '输送流体介质的基本管段，是管路系统中最常见的组成单元。',
    partsDesc: '管壁（内径由外径减两倍壁厚得到）、两端开口与端面。教学模型保留壁厚以便观察内外壁。',
    portsDesc: '两端各一个接口，DN 与端部形式随规格设置；焊接端可与管件对接，法兰端可直接与阀门设备连接。',
    learnPoints: ['DN 是公称尺寸，不等于实际内径或外径', '外径按标准系列核对，壁厚为教学简化值', '同一管段两端规格一致'],
    tags: ['输送', '教学基础件'], material: 'carbon-steel', color: STEEL,
    defaultSpec: { dn: 50, length: 500, endType: 'weld' },
    parametric: { length: [200, 2000, 100], endType: true, dnList: PIPE_DN_LIST },
    capabilities: ['observe', 'connect'], builder: 'pipe'
  }),
  mk({
    id: 'elbow90', name: '90° 弯头', category: 'pipe', status: 'ready', batch: 1,
    summary: '连续弯曲的管道结构，实现管路 90° 转向，弯曲半径取 1.5 倍外径（长半径）。',
    usage: '改变管路方向，用于设备进出口转向、管廊转弯与布置避让。',
    partsDesc: '弯曲管体、两端焊接接口。模型以连续圆弧表达真实转向而非折线拼接。',
    portsDesc: '两个焊接接口，轴线互成 90°，规格相同。',
    learnPoints: ['长半径弯头流动阻力小于短半径', '转向后接口朝向随之改变，连接时注意轴线方向'],
    tags: ['转向'], material: 'carbon-steel', color: STEEL,
    defaultSpec: { dn: 50 }, parametric: { endType: true, dnList: PIPE_DN_LIST },
    capabilities: ['observe', 'connect'], builder: 'elbow90'
  }),
  mk({
    id: 'elbow45', name: '45° 弯头', category: 'pipe', status: 'ready', batch: 1,
    summary: '连续弯曲的管道结构，实现管路 45° 转向。',
    usage: '小角度转向与斜向管段布置，常与 90° 弯头组合完成空间走向。',
    partsDesc: '弯曲管体、两端焊接接口。',
    portsDesc: '两个焊接接口，轴线互成 45°。',
    learnPoints: ['两个 45° 弯头可组合出平缓的转向过渡', '斜管段在重力流与排凝布置中常见'],
    tags: ['转向'], material: 'carbon-steel', color: STEEL,
    defaultSpec: { dn: 50 }, parametric: { endType: true, dnList: PIPE_DN_LIST },
    capabilities: ['observe', 'connect'], builder: 'elbow45'
  }),
  mk({
    id: 'tee', name: '等径三通', category: 'pipe', status: 'ready', batch: 1,
    summary: '主管与支管同径的 T 形管件，具有三个接口。',
    usage: '管路分支与合流，如泵出口分路、取样支管与放空支管。',
    partsDesc: '主管段、支管段与相贯过渡区，三个焊接接口。',
    portsDesc: '主管两端与支管顶端各一个接口，支管轴线垂直于主管。',
    learnPoints: ['分支处流向分配取决于阻力，教学模型不计算流量', '支管方向决定后续管段走向'],
    tags: ['分支', '合流'], material: 'carbon-steel', color: STEEL,
    defaultSpec: { dn: 50 }, parametric: { endType: true, dnList: PIPE_DN_LIST },
    capabilities: ['observe', 'connect'], builder: 'tee'
  }),
  mk({
    id: 'tee-reducing', name: '异径三通', category: 'pipe', status: 'ready', batch: 1,
    summary: '支管口径小于主管的 T 形管件，支管规格按预设配对。',
    usage: '分支管径小于主管的场合，如主管分出的小口径取样、排凝支管。',
    partsDesc: '主管段、缩径直管段与相贯过渡区。',
    portsDesc: '主管两端同径，支管为小一号预设规格（如 DN50 主管配 DN40 支管）。',
    learnPoints: ['异径三通可省去一只异径管', '支管规格必须与后续管段匹配'],
    tags: ['分支', '变径'], material: 'carbon-steel', color: STEEL,
    defaultSpec: { dn: 50 }, parametric: { endType: true, dnList: PIPE_DN_LIST },
    capabilities: ['observe', 'connect'], builder: 'tee-reducing'
  }),
  mk({
    id: 'cross', name: '四通', category: 'pipe', status: 'ready', batch: 1,
    summary: '十字形管件，具有四个互成 90° 的接口。',
    usage: '多路分支与分配，教学上用于认识复杂节点；实际工程中优先用两个三通代替以改善受力。',
    partsDesc: '十字相贯管体与四个焊接接口。',
    portsDesc: '同一平面内四个接口，两两相对。',
    learnPoints: ['四通节点应力集中明显，工程上慎用', '四个接口的占用状态需分别管理'],
    tags: ['分支'], material: 'carbon-steel', color: STEEL,
    defaultSpec: { dn: 50 }, parametric: { endType: true, dnList: PIPE_DN_LIST },
    capabilities: ['observe', 'connect'], builder: 'cross'
  }),
  mk({
    id: 'reducer-conc', name: '同心异径管', category: 'pipe', status: 'ready', batch: 1,
    summary: '大小端同轴的锥形过渡管段，规格按预设配对（如 DN80→DN50）。',
    usage: '不同管径之间的过渡，常用于垂直管段与泵出口。',
    partsDesc: '锥形管体、大端与小端接口，两端壁厚分别对应各自规格。',
    portsDesc: '大端与小端各一个焊接接口，DN 不同。',
    learnPoints: ['同心异径管轴线重合，适合立管', '水平气体管路用同心异径管可能积液'],
    tags: ['变径'], material: 'carbon-steel', color: STEEL,
    defaultSpec: { dn: 80 }, parametric: { endType: true, dnList: [50, 65, 80, 100, 125, 150, 200] },
    capabilities: ['observe', 'connect'], builder: 'reducer-conc'
  }),
  mk({
    id: 'reducer-ecc', name: '偏心异径管', category: 'pipe', status: 'ready', batch: 1,
    summary: '大小端不同轴的过渡管段，一侧管壁平齐；本模型为底平形式。',
    usage: '水平管段变径，泵入口常用底平安装以避免气囊。',
    partsDesc: '偏心锥形管体，小端中心向下偏移，底部母线平齐。',
    portsDesc: '大端与小端各一个焊接接口，轴线平行但不同高。',
    learnPoints: ['泵入口底平安装防止气体积聚', '顶平与底平的选择取决于介质与工况'],
    tags: ['变径', '泵入口'], material: 'carbon-steel', color: STEEL,
    defaultSpec: { dn: 80 }, parametric: { endType: true, dnList: [50, 65, 80, 100, 125, 150, 200] },
    capabilities: ['observe', 'connect'], builder: 'reducer-ecc'
  }),
  mk({
    id: 'cap', name: '管帽', category: 'pipe', status: 'ready', batch: 1,
    summary: '封住管端的碟形封头管件，只有一个接口。',
    usage: '封闭预留管口、试压盲端与管段末端。',
    partsDesc: '短管段与碟形封头。',
    portsDesc: '一个焊接接口，连接后该支路封闭。',
    learnPoints: ['连通检查中管帽用于封闭必须封闭的接口', '与盲板法兰的区别：管帽焊在管端，盲板夹在法兰之间'],
    tags: ['封闭'], material: 'carbon-steel', color: STEEL,
    defaultSpec: { dn: 50 }, parametric: { endType: true, dnList: PIPE_DN_LIST },
    capabilities: ['observe', 'connect'], builder: 'cap'
  }),
  mk({
    id: 'union', name: '活接头', category: 'pipe', status: 'ready', batch: 1,
    summary: '由两个接头座与一只锁紧螺母组成的可拆卸螺纹连接件。',
    usage: '需要经常拆卸的小口径管段，如仪表引压管与设备接口。',
    partsDesc: '接头座 A、接头座 B、锁紧螺母三部分，螺纹旋合实现密封。',
    portsDesc: '两端 G 螺纹接口，仅与螺纹端匹配。',
    learnPoints: ['活接头允许不转动管子即可拆卸', '螺纹类型必须配对，G 与 R/NPT 不能混接'],
    tags: ['可拆卸', '螺纹'], material: 'carbon-steel', color: '#a8b2bf',
    defaultSpec: { dn: 25 }, parametric: { dnList: [15, 20, 25, 32, 40, 50] },
    capabilities: ['observe', 'connect'], builder: 'union'
  }),

  /* ============ 法兰与连接附件（第一批，8） ============ */
  mk({
    id: 'flange-so', name: '平焊法兰', category: 'flange', status: 'ready', batch: 1,
    summary: '带法兰盘、中心孔与螺栓孔的板式法兰，管端插入后角焊接。',
    usage: '中低压管路与设备接口的可拆卸连接，本工坊法兰连接的标准件。',
    partsDesc: '法兰盘（含螺栓孔）、中心通孔、短毂与管侧角焊缝位置。',
    portsDesc: '密封面为 PN16 法兰接口（含螺栓孔数），管侧为焊接接口。',
    learnPoints: ['螺栓孔数量与中心圆决定配对关系', '平焊法兰刚度低于对焊法兰，教学模型按 PN16 简化'],
    tags: ['连接', '可拆卸'], material: 'carbon-steel', color: FLANGE_C,
    defaultSpec: { dn: 50 }, parametric: { dnList: PIPE_DN_LIST },
    capabilities: ['observe', 'connect'], builder: 'flange-so'
  }),
  mk({
    id: 'flange-wn', name: '对焊法兰', category: 'flange', status: 'ready', batch: 1,
    summary: '带锥形长毂的法兰，毂端与管子对接焊接。',
    usage: '压力温度较高或要求刚度好的管路连接。',
    partsDesc: '法兰盘、锥形长毂、对接焊端。',
    portsDesc: '密封面为 PN16 法兰接口，管侧为焊接接口。',
    learnPoints: ['长毂提高法兰刚度并改善应力分布', '对焊连接质量要求高于平焊'],
    tags: ['连接', '可拆卸'], material: 'carbon-steel', color: FLANGE_C,
    defaultSpec: { dn: 50 }, parametric: { dnList: PIPE_DN_LIST },
    capabilities: ['observe', 'connect'], builder: 'flange-wn'
  }),
  mk({
    id: 'flange-blind', name: '盲板法兰', category: 'flange', status: 'ready', batch: 1,
    summary: '无中心孔的实心法兰盘，用于封闭法兰接口。',
    usage: '隔离管段、试压与检修盲端，是连通检查中的封闭件。',
    partsDesc: '实心法兰盘与螺栓孔。',
    portsDesc: '一个 PN16 法兰密封面，连接后该接口被封闭。',
    learnPoints: ['盲板使支路在连通检查中视为封闭', '抽堵盲板是检修隔离的关键步骤'],
    tags: ['封闭', '隔离'], material: 'carbon-steel', color: '#b6a284',
    defaultSpec: { dn: 50 }, parametric: { dnList: PIPE_DN_LIST },
    capabilities: ['observe', 'connect'], builder: 'flange-blind'
  }),
  mk({
    id: 'gasket', name: '密封垫片', category: 'flange', status: 'ready', batch: 1,
    summary: '夹在两片法兰密封面之间的环形非金属垫片。',
    usage: '法兰连接的密封元件，螺栓压紧后填充密封面微观不平。',
    partsDesc: '环形垫片本体，内外径与法兰密封面匹配。',
    portsDesc: '两侧各一个法兰面接口，可串联两片法兰形成「法兰—垫片—法兰」。',
    learnPoints: ['垫片必须与法兰同规格同标准', '缺少垫片的法兰连接在任务检查中视为未完成密封'],
    tags: ['密封'], material: 'rubber', color: '#d98e32',
    defaultSpec: { dn: 50 }, parametric: { dnList: PIPE_DN_LIST },
    capabilities: ['observe', 'connect'], builder: 'gasket'
  }),
  mk({
    id: 'bolt', name: '螺栓', category: 'flange', status: 'ready', batch: 1,
    summary: '六角头螺栓，穿过法兰螺栓孔后用螺母紧固。',
    usage: '法兰连接的紧固件，按对角顺序分次拧紧。',
    partsDesc: '六角头、光杆段与螺纹端。',
    portsDesc: '杆部对应法兰连接的螺栓孔位，螺纹端与螺母旋合。',
    learnPoints: ['螺栓规格与法兰孔径配对（M12/M16/M20）', '紧固应对角交叉、分次均匀拧紧'],
    tags: ['紧固件'], material: 'alloy', color: '#6b7684',
    defaultSpec: { dn: 16 }, parametric: { dnList: [12, 16, 20] },
    capabilities: ['observe', 'connect'], builder: 'bolt'
  }),
  mk({
    id: 'nut', name: '螺母', category: 'flange', status: 'ready', batch: 1,
    summary: '六角螺母，与螺栓螺纹端旋合产生压紧力。',
    usage: '与螺栓配对完成法兰紧固。',
    partsDesc: '六角本体与内螺纹孔。',
    portsDesc: '内螺纹接口，仅与同规格螺栓螺纹端旋合。',
    learnPoints: ['螺母规格必须与螺栓一致', '螺纹旋合在教学模型中以对齐动画表达'],
    tags: ['紧固件'], material: 'alloy', color: '#5d6774',
    defaultSpec: { dn: 16 }, parametric: { dnList: [12, 16, 20] },
    capabilities: ['observe', 'connect'], builder: 'nut'
  }),
  mk({
    id: 'clamp', name: '管夹', category: 'flange', status: 'ready', batch: 1,
    summary: '抱箍式管夹，抱住直管外壁并固定到支撑结构。',
    usage: '限制管道位移、承受重量与振动，认识管道支撑关系。',
    partsDesc: '上下抱箍、紧固螺栓与底座。',
    portsDesc: '一个管夹安装位，吸附到直管外壁任意轴向位置。',
    learnPoints: ['管夹只能安装在直管段', '固定支架与滑动支架的约束不同'],
    tags: ['支撑'], material: 'carbon-steel', color: '#eaa23b',
    defaultSpec: { dn: 50 }, parametric: { dnList: PIPE_DN_LIST },
    capabilities: ['observe', 'connect'], builder: 'clamp'
  }),
  mk({
    id: 'support', name: '管道支架', category: 'flange', status: 'ready', batch: 1,
    summary: '带立柱的管托支架，托住直管底部。',
    usage: '承受管道重量，保持标高与坡度。',
    partsDesc: '管托、立柱与底板。',
    portsDesc: '一个安装位，吸附到直管外壁下方。',
    learnPoints: ['支架间距影响管道挠度与应力', '支架不改变管路连通关系'],
    tags: ['支撑'], material: 'carbon-steel', color: '#c9a15f',
    defaultSpec: { dn: 50 }, parametric: { dnList: PIPE_DN_LIST },
    capabilities: ['observe', 'connect'], builder: 'support'
  }),

  /* ============ 阀门（第一批 3 / 共 8） ============ */
  mk({
    id: 'valve-ball', name: '球阀', category: 'valve', status: 'ready', batch: 1,
    summary: '阀体内置带通孔的阀球，旋转 90° 实现全开全关。',
    usage: '快速切断与接通介质，阻力小，广泛用于管段切断。',
    partsDesc: '阀体、带通孔阀球、阀杆、手柄与两侧法兰。内部结构演示可见阀球转动。',
    portsDesc: '两侧 PN16 法兰接口，标有进口/出口；全通径时流向限制宽松，本模型按标注方向检查。',
    learnPoints: ['手柄与管路平行表示开启', '球阀启闭只需 90°，适合快速切断'],
    tags: ['切断', '快速启闭'], material: 'cast-iron', color: VALVE_C,
    defaultSpec: { dn: 50 }, parametric: { dnList: PIPE_DN_LIST },
    capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'valve-ball', demo: 'ball'
  }),
  mk({
    id: 'valve-gate', name: '闸阀', category: 'valve', status: 'ready', batch: 1,
    summary: '闸板沿垂直于流向的方向升降实现启闭，全开时流道直通。',
    usage: '不频繁操作的全开/全关切断场合。',
    partsDesc: '阀体、闸板、阀杆、阀盖与手轮。内部结构演示可见闸板升降。',
    portsDesc: '两侧 PN16 法兰接口，标有进口/出口。',
    learnPoints: ['闸阀不适合节流，半开状态易冲蚀密封面', '启闭行程长，操作圈数多'],
    tags: ['切断'], material: 'cast-iron', color: VALVE_C,
    defaultSpec: { dn: 50 }, parametric: { dnList: PIPE_DN_LIST },
    capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'valve-gate', demo: 'gate'
  }),
  mk({
    id: 'valve-check', name: '止回阀', category: 'valve', status: 'ready', batch: 1,
    summary: '旋启式阀瓣靠介质正向流动推开、反向流动自动关闭，只允许单向流动。',
    usage: '防止介质倒流，保护泵与设备，安装方向是教学重点。',
    partsDesc: '阀体、旋启阀瓣、阀盖与流向箭头标识。',
    portsDesc: '两侧 PN16 法兰接口，进口/出口方向固定，反装将被连通检查判定为流向错误。',
    learnPoints: ['阀体箭头必须指向介质流向', '泵出口止回阀防止停泵倒流与水锤'],
    tags: ['单向', '防倒流'], material: 'cast-iron', color: '#4a7a5c',
    defaultSpec: { dn: 50 }, parametric: { dnList: PIPE_DN_LIST },
    capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'valve-check', demo: 'check'
  }),
  mk({
    id: 'valve-globe', name: '截止阀', category: 'valve', status: 'dev', batch: 2, ports: [],
    summary: '阀瓣沿阀座中心线移动实现启闭，流道呈 S 形。',
    usage: '需要调节流量或频繁启闭的场合，阻力大于闸阀。',
    partsDesc: '阀体、阀瓣、阀杆、阀盖与手轮（待建模）。',
    portsDesc: '计划为两侧法兰接口，低进高出。',
    learnPoints: ['安装方向低进高出', '阀瓣启闭行程短于闸阀'],
    tags: ['切断', '调节'], material: 'cast-iron', color: VALVE_C,
    defaultSpec: { dn: 50 }, capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'dev'
  }),
  mk({
    id: 'valve-butterfly', name: '蝶阀', category: 'valve', status: 'dev', batch: 2, ports: [],
    summary: '圆盘形阀板绕阀杆旋转实现启闭与调节，结构长度短。',
    usage: '大口径管路的切断与粗略调节。',
    partsDesc: '阀体、阀板、阀杆与执行机构（待建模）。',
    portsDesc: '计划为对夹式或法兰式接口。',
    learnPoints: ['阀板旋转 90° 完成启闭', '全开时阀板仍占据流道'],
    tags: ['切断', '大口径'], material: 'cast-iron', color: VALVE_C,
    defaultSpec: { dn: 80 }, capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'dev'
  }),
  mk({
    id: 'valve-control', name: '调节阀', category: 'valve', status: 'dev', batch: 2, ports: [],
    summary: '由执行机构驱动阀芯改变开度，实现流量自动调节。',
    usage: '工艺参数自动控制回路中的最终执行元件。',
    partsDesc: '阀体、阀芯阀座、气动薄膜执行机构与定位器（待建模）。',
    portsDesc: '计划为两侧法兰接口。',
    learnPoints: ['气开/气关形式由工艺安全决定', '开度与流量特性相关'],
    tags: ['调节', '自控'], material: 'cast-iron', color: VALVE_C,
    defaultSpec: { dn: 50 }, capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'dev'
  }),
  mk({
    id: 'valve-safety', name: '安全阀', category: 'valve', status: 'dev', batch: 2, ports: [],
    summary: '超压时自动开启泄放、压力回落后自动关闭的保护阀。',
    usage: '容器与管路的超压保护，属于安全附件。',
    partsDesc: '阀体、阀瓣、弹簧与调节圈（待建模）。',
    portsDesc: '计划为进口法兰/螺纹与出口排放口。',
    learnPoints: ['整定压力不可随意调整', '排放口方向必须安全'],
    tags: ['安全', '泄放'], material: 'cast-iron', color: '#a54b3b',
    defaultSpec: { dn: 25 }, capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'dev'
  }),
  mk({
    id: 'valve-trap', name: '疏水阀', category: 'valve', status: 'dev', batch: 2, ports: [],
    summary: '自动排出凝结水并阻止蒸汽泄漏的阀门。',
    usage: '蒸汽伴热与加热设备凝结水排放。',
    partsDesc: '阀体与浮球/热动力/双金属片机构（待建模）。',
    portsDesc: '计划为进口/出口螺纹或法兰接口。',
    learnPoints: ['疏水阀有安装方向要求', '失效模式分漏汽与堵塞两类'],
    tags: ['蒸汽', '排凝'], material: 'cast-iron', color: VALVE_C,
    defaultSpec: { dn: 20 }, capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'dev'
  }),

  /* ============ 泵与旋转设备（第一批 1 / 共 6） ============ */
  mk({
    id: 'pump-centrifugal', name: '离心泵（工坊版）', category: 'pump', status: 'ready', batch: 1,
    summary: '蜗壳式离心泵简化模型：泵壳、叶轮、电机与底座，带入口/出口法兰。',
    usage: '为管路提供输送动力，是「储罐→泵→管路」教学装置的核心。',
    partsDesc: '蜗壳泵体、叶轮（内部演示可见转动）、电机、联轴器与公共底座。',
    portsDesc: '入口 DN80 法兰（轴向）、出口 DN65 法兰（顶部垂直），流向固定为入口进、出口出。',
    learnPoints: ['入口管径通常大于出口', '启动前需灌泵排气，教学模型不模拟汽蚀'],
    tags: ['输送', '动力'], material: 'cast-iron', color: '#2e6f9e',
    defaultSpec: { dn: 80 },
    capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'pump-centrifugal', demo: 'impeller'
  }),
  mk({
    id: 'pump-gear', name: '齿轮泵', category: 'pump', status: 'dev', batch: 3, ports: [],
    summary: '一对啮合齿轮旋转输送液体的容积式泵。',
    usage: '高粘度液体输送与计量。',
    partsDesc: '泵体、主动/从动齿轮、轴与密封（待建模）。',
    portsDesc: '计划为进出口螺纹或法兰接口。',
    learnPoints: ['容积式泵不可关闭出口启动', '流量随转速近似线性'],
    tags: ['容积式', '高粘度'], material: 'cast-iron', color: '#2e6f9e',
    defaultSpec: { dn: 25 }, capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'dev'
  }),
  mk({
    id: 'pump-diaphragm', name: '隔膜泵', category: 'pump', status: 'dev', batch: 3, ports: [],
    summary: '隔膜往复变形配合单向阀实现输送，介质与传动隔离。',
    usage: '腐蚀性、含颗粒介质的输送。',
    partsDesc: '泵头、隔膜、单向阀组与驱动机构（待建模）。',
    portsDesc: '计划为进出口法兰接口。',
    learnPoints: ['单向阀决定流向', '隔膜破裂检测是维护要点'],
    tags: ['容积式', '腐蚀介质'], material: 'cast-iron', color: '#2e6f9e',
    defaultSpec: { dn: 25 }, capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'dev'
  }),
  mk({
    id: 'pump-screw', name: '螺杆泵', category: 'pump', status: 'dev', batch: 3, ports: [],
    summary: '螺杆旋转形成密封腔轴向推进液体。',
    usage: '高粘度、含固介质平稳输送。',
    partsDesc: '定子、转子螺杆、万向节与驱动（待建模）。',
    portsDesc: '计划为进出口法兰接口。',
    learnPoints: ['单螺杆泵定子为弹性体', '不可干转'],
    tags: ['容积式', '平稳输送'], material: 'cast-iron', color: '#2e6f9e',
    defaultSpec: { dn: 40 }, capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'dev'
  }),
  mk({
    id: 'fan-centrifugal', name: '离心风机', category: 'pump', status: 'dev', batch: 3, ports: [],
    summary: '叶轮旋转提高气体压力并输送气体的旋转设备。',
    usage: '通风、除尘与气力输送。',
    partsDesc: '蜗壳、叶轮、进风口与电机（待建模）。',
    portsDesc: '计划为矩形/圆形进出口。',
    learnPoints: ['风机与泵的原理相似但介质可压缩', '旋向决定出口方向'],
    tags: ['气体', '通风'], material: 'carbon-steel', color: '#5b6b7c',
    defaultSpec: { dn: 200 }, capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'dev'
  }),
  mk({
    id: 'compressor-screw', name: '螺杆压缩机', category: 'pump', status: 'dev', batch: 3, ports: [],
    summary: '阴阳转子啮合压缩气体的容积式压缩机。',
    usage: '压缩空气与工艺气源。',
    partsDesc: '机体、阴阳转子、油气分离与冷却系统（待建模）。',
    portsDesc: '计划为进气/排气法兰接口。',
    learnPoints: ['喷油螺杆的油气分离流程', '排气温度监控要点'],
    tags: ['气体', '压缩'], material: 'cast-iron', color: '#5b6b7c',
    defaultSpec: { dn: 50 }, capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'dev'
  }),

  /* ============ 换热设备（第二批，4） ============ */
  mk({
    id: 'heat-shell-tube', name: '管壳式换热器（工坊版）', category: 'heat', status: 'ready', batch: 2,
    summary: '管程与壳程两股介质通过管壁换热的间壁式换热器。',
    usage: '液-液、气-液换热，化工装置中最常见的换热设备；本工坊版提供四个法兰接口参与管路连接。',
    partsDesc: '筒体、管束、管板、折流板、管箱封头与鞍座（教学示意模型，与学习工作台的拆装模型相互独立）。',
    portsDesc: '管程进出口 DN65（轴向）与壳程进出口 DN50（顶部进、底部出），均为 PN16 法兰接口。',
    learnPoints: ['两股介质流路相互独立', '逆流布置传热温差更大', '管程走易结垢介质便于清洗'],
    tags: ['换热', '两流路'], material: 'carbon-steel', color: '#7f9bb3',
    defaultSpec: { dn: 80 }, capabilities: ['observe', 'section', 'connect'], builder: 'heat-shell-tube'
  }),
  mk({
    id: 'heat-plate', name: '板式换热器', category: 'heat', status: 'dev', batch: 2, ports: [],
    summary: '波纹板片叠装形成交替流道的紧凑换热器。',
    usage: '液-液换热，传热系数高、占地小。',
    partsDesc: '板片组、压紧板、夹紧螺栓与导杆（待建模）。',
    portsDesc: '计划为同侧或异侧四个接口。',
    learnPoints: ['板片交替形成两股独立通道', '增减板片可调整换热面积'],
    tags: ['换热', '紧凑'], material: 'stainless', color: '#b8c4cf',
    defaultSpec: { dn: 50 }, capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'dev'
  }),
  mk({
    id: 'heat-double-pipe', name: '套管式换热器', category: 'heat', status: 'dev', batch: 2, ports: [],
    summary: '同心内外管构成两个流道的简单间壁换热器。',
    usage: '小流量、高压或温差大的换热场合。',
    partsDesc: '内管、外管、连通箱与支撑（待建模）。',
    portsDesc: '计划为内外管各两个接口。',
    learnPoints: ['纯逆流布置', '结构简单但单位体积换热面积小'],
    tags: ['换热', '高压'], material: 'carbon-steel', color: '#7f9bb3',
    defaultSpec: { dn: 40 }, capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'dev'
  }),
  mk({
    id: 'heat-finned', name: '翅片式换热器', category: 'heat', status: 'dev', batch: 2, ports: [],
    summary: '管外加装翅片扩展传热面积的换热元件。',
    usage: '气-液换热，如空冷器与暖风机。',
    partsDesc: '基管、翅片、管箱与框架（待建模）。',
    portsDesc: '计划为管箱进出口接口。',
    learnPoints: ['翅片侧热阻大，扩展面积有意义', '翅片间距影响积灰与阻力'],
    tags: ['换热', '气液'], material: 'alloy', color: '#9aa7b6',
    defaultSpec: { dn: 25 }, capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'dev'
  }),

  /* ============ 反应与混合设备（第三批，3） ============ */
  mk({
    id: 'react-jacket', name: '夹套搅拌反应釜（工坊版）', category: 'react', status: 'dev', batch: 3, ports: [],
    summary: '带夹套加热/冷却与搅拌装置的立式反应容器。',
    usage: '液相反应、溶解与调配。',
    partsDesc: '釜体、夹套、搅拌器、传动与轴封（学习工作台已有完整模型，工坊连接版待建）。',
    portsDesc: '计划为进料、出料、夹套进出口与测温口。',
    learnPoints: ['搅拌形式影响混合效果', '夹套介质流向与传热均匀性'],
    tags: ['反应', '搅拌'], material: 'stainless', color: '#b8c4cf',
    defaultSpec: { dn: 50 }, capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'dev'
  }),
  mk({
    id: 'react-coil', name: '盘管加热反应釜', category: 'react', status: 'dev', batch: 3, ports: [],
    summary: '釜内置换热盘管的反应容器。',
    usage: '需要较大换热面积的反应过程。',
    partsDesc: '釜体、内盘管、搅拌与传动（待建模）。',
    portsDesc: '计划为进出料口与盘管进出口。',
    learnPoints: ['内盘管换热面积大于夹套', '盘管检修需开釜'],
    tags: ['反应', '换热'], material: 'stainless', color: '#b8c4cf',
    defaultSpec: { dn: 50 }, capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'dev'
  }),
  mk({
    id: 'mixer-static', name: '静态混合器', category: 'react', status: 'dev', batch: 3, ports: [],
    summary: '管内固定混合元件使流体分割重组实现混合，无运动部件。',
    usage: '连续混合、分散与强化传热。',
    partsDesc: '管体与螺旋/叶片混合元件（待建模）。',
    portsDesc: '计划为两端法兰接口。',
    learnPoints: ['混合效果以压降为代价', '元件数量决定混合级数'],
    tags: ['混合', '无运动件'], material: 'stainless', color: '#b8c4cf',
    defaultSpec: { dn: 50 }, capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'dev'
  }),

  /* ============ 分离与过滤设备（第三批，7） ============ */
  mk({
    id: 'sep-tray-tower', name: '板式塔', category: 'sep', status: 'dev', batch: 3, ports: [],
    summary: '塔内多层塔板实现气液逐级接触传质的立式塔器。',
    usage: '精馏、吸收等气液传质分离。',
    partsDesc: '塔体、塔板、降液管、进料口与裙座（待建模）。',
    portsDesc: '计划为塔顶气相、塔底液相、进料与回流接口。',
    learnPoints: ['气液在塔板上逆流接触', '液泛是操作上限之一'],
    tags: ['分离', '精馏'], material: 'carbon-steel', color: '#7f9bb3',
    defaultSpec: { dn: 80 }, capabilities: ['observe', 'section', 'connect'], builder: 'dev'
  }),
  mk({
    id: 'sep-packed-tower', name: '填料塔', category: 'sep', status: 'dev', batch: 3, ports: [],
    summary: '塔内装填料提供气液接触表面的立式塔器。',
    usage: '吸收、解吸与低压降精馏。',
    partsDesc: '塔体、填料层、液体分布器与支撑格栅（待建模）。',
    portsDesc: '计划为塔顶、塔底、进料与分布器接口。',
    learnPoints: ['液体分布均匀性决定效率', '填料压降低于塔板'],
    tags: ['分离', '吸收'], material: 'carbon-steel', color: '#7f9bb3',
    defaultSpec: { dn: 80 }, capabilities: ['observe', 'section', 'connect'], builder: 'dev'
  }),
  mk({
    id: 'sep-cyclone', name: '旋风分离器', category: 'sep', status: 'dev', batch: 3, ports: [],
    summary: '利用旋转气流离心力分离颗粒的锥形设备。',
    usage: '气固预分离与除尘。',
    partsDesc: '筒体、锥体、切向进口、中心排气管与灰斗（待建模）。',
    portsDesc: '计划为切向进气、顶部排气与底部排灰口。',
    learnPoints: ['切向进口形成旋转流场', '分割粒径随筒径减小而降低'],
    tags: ['分离', '气固'], material: 'carbon-steel', color: '#8a97a8',
    defaultSpec: { dn: 100 }, capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'dev'
  }),
  mk({
    id: 'filter-bag', name: '袋式过滤器', category: 'sep', status: 'dev', batch: 2, ports: [],
    summary: '外壳内装滤袋拦截颗粒的液体过滤设备。',
    usage: '液体澄清与保安过滤。',
    partsDesc: '筒体、快开盖、滤袋与支撑篮（待建模）。',
    portsDesc: '计划为进出口法兰接口。',
    learnPoints: ['滤袋为可更换耗材', '压差升高提示更换'],
    tags: ['过滤', '液体'], material: 'stainless', color: '#b8c4cf',
    defaultSpec: { dn: 50 }, capabilities: ['observe', 'section', 'connect', 'disassemble'], builder: 'dev'
  }),
  mk({
    id: 'filter-cartridge', name: '滤芯式过滤器', category: 'sep', status: 'dev', batch: 2, ports: [],
    summary: '多支滤芯并联的精过滤设备。',
    usage: '保安过滤与终端精滤。',
    partsDesc: '筒体、滤芯组、压板与密封（待建模）。',
    portsDesc: '计划为进出口法兰接口。',
    learnPoints: ['过滤精度以微米标称', '滤芯完整性测试要点'],
    tags: ['过滤', '精滤'], material: 'stainless', color: '#b8c4cf',
    defaultSpec: { dn: 50 }, capabilities: ['observe', 'section', 'connect', 'disassemble'], builder: 'dev'
  }),
  mk({
    id: 'filter-plate-frame', name: '板框压滤机', category: 'sep', status: 'dev', batch: 3, ports: [],
    summary: '滤板滤框交替排列、压紧后加压过滤的间歇固液分离设备。',
    usage: '污泥脱水与固液分离。',
    partsDesc: '滤板、滤框、滤布、压紧装置与机架（待建模）。',
    portsDesc: '计划为进料口与滤液出口。',
    learnPoints: ['间歇操作：进料—压滤—卸饼', '滤布状态影响滤液澄清度'],
    tags: ['分离', '固液'], material: 'carbon-steel', color: '#5b6b7c',
    defaultSpec: { dn: 50 }, capabilities: ['observe', 'section', 'connect', 'disassemble'], builder: 'dev'
  }),
  mk({
    id: 'sep-centrifuge', name: '离心分离机', category: 'sep', status: 'dev', batch: 3, ports: [],
    summary: '高速转鼓产生离心力实现固液或液液分离。',
    usage: '细颗粒悬浮液分离与乳浊液分离。',
    partsDesc: '转鼓、螺旋推料器、差速器与机壳（待建模）。',
    portsDesc: '计划为进料、清液与沉渣出口。',
    learnPoints: ['分离因数远大于重力沉降', '动平衡与振动监控关键'],
    tags: ['分离', '高速'], material: 'stainless', color: '#b8c4cf',
    defaultSpec: { dn: 40 }, capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'dev'
  }),

  /* ============ 储存与容器（第一批 1 / 共 3） ============ */
  mk({
    id: 'tank-vertical', name: '立式储罐', category: 'tank', status: 'ready', batch: 1,
    summary: '立式圆筒罐体、碟形封头与支腿，带顶部进料、底部出料与液位计接口。',
    usage: '储存液体介质，是「储罐→泵→管路」教学装置的起点。',
    partsDesc: '罐体、上下封头、支腿、进料短节、出料短节与液位计接口；内部演示可见演示液位。',
    portsDesc: '顶部进料 DN50、底部出料 DN80、侧面液位计 DN25，均为 PN16 法兰接口。',
    learnPoints: ['出料口位置决定泵入口可用压头', '液位计接口属于测量接口，任务中可为预留口'],
    tags: ['储存', '教学装置起点'], material: 'carbon-steel', color: '#7f9bb3',
    defaultSpec: { dn: 80 },
    capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'tank-vertical', demo: 'level'
  }),
  mk({
    id: 'tank-horizontal', name: '卧式储罐', category: 'tank', status: 'dev', batch: 2, ports: [],
    summary: '卧式圆筒罐体与鞍式支座的储存容器。',
    usage: '储存液体或液化气体，占地高度低。',
    partsDesc: '罐体、封头、鞍座与人孔接口（待建模）。',
    portsDesc: '计划为顶部进出料、底部排污与液位接口。',
    learnPoints: ['鞍座位置影响罐体应力', '液位与容积关系非线性'],
    tags: ['储存', '卧式'], material: 'carbon-steel', color: '#7f9bb3',
    defaultSpec: { dn: 80 }, capabilities: ['observe', 'section', 'connect'], builder: 'dev'
  }),
  mk({
    id: 'tank-knockout', name: '气液分离罐', category: 'tank', status: 'dev', batch: 2, ports: [],
    summary: '利用重力与折流使气液两相分离的立式容器。',
    usage: '压缩机入口分液与火炬气分液。',
    partsDesc: '罐体、进口折流板、除沫器与液位控制（待建模）。',
    portsDesc: '计划为进气、排气、排液接口。',
    learnPoints: ['气速决定分离效果', '液位过高会带液'],
    tags: ['分离', '容器'], material: 'carbon-steel', color: '#7f9bb3',
    defaultSpec: { dn: 80 }, capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'dev'
  }),

  /* ============ 仪表与测量部件（第二批，6） ============ */
  mk({
    id: 'instr-pressure', name: '压力表', category: 'instr', status: 'dev', batch: 2, ports: [],
    summary: '弹簧管式就地压力指示仪表。',
    usage: '监测管路与设备压力，泵出口管段的标准配置。',
    partsDesc: '表壳、弹簧管、机芯与指针（待建模）。',
    portsDesc: '计划为 M20×1.5 或 G1/2 螺纹接口，配根部阀。',
    learnPoints: ['量程选择为工作压力 1.5～3 倍', '读数演示数据需明确标注'],
    tags: ['测量', '压力'], material: 'stainless', color: '#d9dee5',
    defaultSpec: { dn: 15 }, capabilities: ['observe', 'connect', 'principle'], builder: 'dev'
  }),
  mk({
    id: 'instr-temp', name: '温度传感器', category: 'instr', status: 'dev', batch: 2, ports: [],
    summary: '热电阻/热电偶配保护套管插入管道测温。',
    usage: '监测介质温度。',
    partsDesc: '接线盒、保护套管与感温元件（待建模）。',
    portsDesc: '计划为螺纹或法兰安装接口。',
    learnPoints: ['插入深度影响响应与准确性', '套管可带压更换芯体'],
    tags: ['测量', '温度'], material: 'stainless', color: '#d9dee5',
    defaultSpec: { dn: 15 }, capabilities: ['observe', 'connect', 'principle'], builder: 'dev'
  }),
  mk({
    id: 'instr-level', name: '液位计', category: 'instr', status: 'dev', batch: 2, ports: [],
    summary: '磁翻板或玻璃管式就地液位指示。',
    usage: '储罐液位监测。',
    partsDesc: '主体管、浮子与翻板指示器（待建模）。',
    portsDesc: '计划为上下两个法兰/螺纹接口连通罐体。',
    learnPoints: ['连通器原理', '上下接口必须都连通才能正确指示'],
    tags: ['测量', '液位'], material: 'stainless', color: '#d9dee5',
    defaultSpec: { dn: 25 }, capabilities: ['observe', 'connect', 'principle'], builder: 'dev'
  }),
  mk({
    id: 'instr-dp', name: '差压变送器', category: 'instr', status: 'dev', batch: 2, ports: [],
    summary: '测量两点压差并输出标准信号的仪表。',
    usage: '流量、液位与过滤器压差监测。',
    partsDesc: '膜盒、电子壳体与三阀组（待建模）。',
    portsDesc: '计划为高低压侧螺纹接口。',
    learnPoints: ['三阀组投运顺序', '引压管排气排凝'],
    tags: ['测量', '差压'], material: 'alloy', color: '#8fa3b8',
    defaultSpec: { dn: 15 }, capabilities: ['observe', 'connect', 'principle'], builder: 'dev'
  }),
  mk({
    id: 'instr-magflow', name: '电磁流量计', category: 'instr', status: 'dev', batch: 2, ports: [],
    summary: '法拉第电磁感应原理测量导电液体体积流量。',
    usage: '导电液体流量测量，无阻流件。',
    partsDesc: '测量管、电极、励磁线圈与转换器（待建模）。',
    portsDesc: '计划为两侧法兰接口，有流向与满管要求。',
    learnPoints: ['必须满管安装', '前后直管段要求'],
    tags: ['测量', '流量'], material: 'stainless', color: '#4a7a9e',
    defaultSpec: { dn: 50 }, capabilities: ['observe', 'section', 'connect', 'principle'], builder: 'dev'
  }),
  mk({
    id: 'instr-rotameter', name: '转子流量计', category: 'instr', status: 'dev', batch: 2, ports: [],
    summary: '锥形管内浮子高度指示流量的变面积流量计。',
    usage: '小流量就地指示。',
    partsDesc: '锥形管、浮子与刻度（待建模）。',
    portsDesc: '计划为螺纹或法兰接口，必须垂直安装、自下而上流动。',
    learnPoints: ['垂直安装与流向要求严格', '读数取浮子最大截面处'],
    tags: ['测量', '流量'], material: 'stainless', color: '#d9dee5',
    defaultSpec: { dn: 20 }, capabilities: ['observe', 'connect', 'principle'], builder: 'dev'
  })
];

const legacyById = new Map(legacyCatalog.map(part => [part.id, part]));
export function assemblyOrigin(id: string): 'existing' | 'repaired' | 'activated' | 'new' {
  const legacy = legacyById.get(id);
  if (!legacy) return 'new';
  if (legacy.status === 'dev') return 'activated';
  return assemblyAssetById.get(id)?.build ? 'repaired' : 'existing';
}
const courseParts = assemblyAssets.map((asset): CatalogPart => {
  const old = legacyById.get(asset.id);
  const ports = portsFor(asset.id, asset.spec);
  const alreadyReady = old?.status === 'ready';
  return {
    ...old,
    id: asset.id, name: alreadyReady ? old.name : asset.name, category: asset.category, status: 'ready',
    batch: old?.batch ?? 2,
    summary: asset.description,
    usage: alreadyReady ? old.usage : courseNames[asset.course],
    partsDesc: alreadyReady ? old.partsDesc : asset.description,
    portsDesc: ports.map(port => port.label).join('、'),
    learnPoints: [asset.mounting ?? '教学简化模型，观察结构与安装关系。', ...(alreadyReady ? old.learnPoints : [])],
    tags: [asset.code, asset.name, courseNames[asset.course], ...(old?.tags ?? [])],
    material: old?.material ?? 'carbon-steel', color: old?.color ?? '#8797a7',
    ports, defaultSpec: asset.spec,
    parametric: alreadyReady ? old.parametric : undefined,
    capabilities: alreadyReady ? old.capabilities : ['observe', 'connect'],
    builder: asset.build ? 'assembly' : asset.id
  };
});
export const CATALOG = [...courseParts, ...legacyCatalog.filter(part => !assemblyAssetById.has(part.id))];
const catalogById = new Map(CATALOG.map(part => [part.id, part]));

export function partById(id: string): CatalogPart | undefined {
  return catalogById.get(id);
}

export const READY_COUNT = CATALOG.filter((p) => p.status === 'ready').length;
