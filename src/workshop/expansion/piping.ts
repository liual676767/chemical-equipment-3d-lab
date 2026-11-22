import type { AssemblyAsset } from './contract';
import {
  buildExpansion, buildLapRing, buildLapStub, buildPipeShoe, buildReturn, buildThreaded, buildUBolt,
  buildVesselSaddle, buildWasher, expansionEnds, lapRingPorts, lapStubPorts, pipeShoePorts, returnPorts, saddlePorts,
  threadedPorts, washerPorts
} from './piping-fittings';
import { buildValve, valvePorts } from './piping-valves';

const asme = 'https://www.asme.org/codes-standards/find-codes-standards/';
const buttweld = asme + 'b16-9-factory-made-wrought-buttwelding-fittings';
const forged = asme + 'b16-11-forged-fittings-socket-welding-threaded/2021';
const flanges = 'https://nikalsteels.ie/wp-content/uploads/2022/03/en-flange.pdf';
const valveLexicon = 'https://www.ksb.com/en-global/centrifugal-pump-lexicon/article/valve-1117060';
const checkLexicon = 'https://www.ksb.com/en-global/centrifugal-pump-lexicon/article/check-valve-1116276';
const pair = [['p1', 'p2']] as const;
const tee = [['p1', 'p2'], ['p2', 'p3'], ['p1', 'p3']] as const;
const cross = [...tee, ['p1', 'p4'], ['p2', 'p4'], ['p3', 'p4']] as const;

type Binding = Pick<AssemblyAsset, 'ports' | 'build' | 'passages' | 'signal' | 'mounting'>;
function asset(
  code: AssemblyAsset['code'], id: string, name: string, category: AssemblyAsset['category'],
  description: string, dn: number, title: string, url: string, basis: string,
  binding: Binding = {}, spec: Partial<AssemblyAsset['spec']> = {}
): AssemblyAsset {
  return {
    code, id, name, category, description, course: category === 'flange' ? 'flange' : 'pipework',
    spec: { dn, ...spec }, sources: [{ title, url, basis }], ...binding
  };
}

function threaded(
  code: AssemblyAsset['code'], id: string, name: string, kind: Parameters<typeof buildThreaded>[0],
  description: string, basis: string, dn = 25, spec: Partial<AssemblyAsset['spec']> = {}
) {
  const result = asset(code, id, name, 'pipe', description, dn,
    kind === 'nipple' ? 'ASTM A733 管道短接' : 'ASME B16.11 螺纹锻制管件类型',
    kind === 'nipple' ? 'https://store.astm.org/a0733-16r22.html' : forged, basis,
    { ports: (configured) => threadedPorts(kind, configured), build: buildThreaded(kind), passages: kind === 'plug' ? [] : pair }, spec);
  return { ...result, sources: [...result.sources, {
    title: 'ISO 228-1 管螺纹',
    url: 'https://www.iso.org/standard/33777.html',
    basis: 'G 型平行管螺纹标识参考，工坊卡合不代表以螺纹本身实现压力密封。'
  }] };
}

function valve(
  code: AssemblyAsset['code'], id: string, name: string, kind: Parameters<typeof buildValve>[0], dn: number,
  description: string, title: string, url: string, basis: string
) {
  return asset(code, id, name, 'valve', description, dn, title, url, basis,
    { ports: (spec) => valvePorts(kind, spec), build: buildValve(kind), passages: kind === 'safety' ? [] : pair });
}

export const pipingAssets: AssemblyAsset[] = [
  asset('P001', 'pipe', '直管段', 'pipe', '圆截面中空直管，两端可按教学设定选择端接形式。', 50,
    'ASME B36.10M 钢管', asme + 'b36-10m-welded-seamless-wrought-steel-pipe/2018', '管段外径、壁厚和通孔的表达依据。', { passages: pair }, { length: 500, endType: 'weld' }),
  asset('P002', 'elbow90', '90°弯头', 'pipe', '等径弧形管段，两个端口的轴线相差 90°。', 50,
    'ASME B16.9 对焊弯头', buttweld, '90° 对焊弯头用于表示管线转向。', { passages: pair }),
  asset('P003', 'elbow45', '45°弯头', 'pipe', '等径弧形管段，两个端口的轴线相差 45°。', 50,
    'ASME B16.9 对焊弯头', buttweld, '45° 对焊弯头与 90° 弯头是不同型式。', { passages: pair }),
  asset('P004', 'tee', '等径三通', 'pipe', '共轴主管两端与垂直支管端采用相同公称直径。', 50,
    'ASME B16.9 直通三通', buttweld, '主管与支路等径的三通型式。', { passages: tee }),
  asset('P005', 'tee-reducing', '异径三通', 'pipe', '共轴主管的两个端口等径，支路口使用较小的教学口径预设。', 50,
    'ASME B16.9 异径出口三通', buttweld, '较小支端与主管的分支关系。', { passages: tee }),
  asset('P006', 'cross', '等径四通', 'pipe', '两组互相垂直的等径端口连到同一汇流节点。', 50,
    'ASME B16.9 直通四通', buttweld, '四通的四端布置与主管、支口关系。', { passages: cross }),
  asset('P007', 'reducer-conc', '同心异径管', 'pipe', '大端与小端同轴，两端内孔以渐缩段连接。', 80,
    'ASME B16.9 异径管', buttweld, '同心型径向对称，大小端中心线重合。', { passages: pair }),
  asset('P008', 'reducer-ecc', '偏心异径管', 'pipe', '大端与小端中心线错开，小端相对大端偏置，便于观察沿管壁的平接关系。', 80,
    'ASME B16.9 异径管', buttweld, '偏心型的小端轴线相对大端偏置。', { passages: pair }),
  asset('P009', 'cap', '管帽', 'pipe', '封闭管线端点的单口端件。', 50,
    'ASME B16.9 管帽', buttweld, '对焊管帽的开放装配端与闭合端。', { passages: [] }),
  asset('P010', 'union', '管路活接头', 'pipe', '两端接管与中间活接螺母形成可拆连接。', 25,
    'ASME B16.39 螺纹活接头', asme + 'b16-39-malleable-iron-threaded-pipe-unions-classes-150-250-300', '活接的两端接管及中部螺母。', { passages: pair }),
  threaded('P011', 'coupling-thread', '直通管箍', 'coupling', '两端等径内螺纹接收外螺纹短管，连接一对同口径管段。', '参考螺纹管箍的内接形式和两端结构。'),
  threaded('P012', 'coupling-reducing-thread', '异径管箍', 'reducer', '套筒两端采用不同口径的内螺纹，内孔沿轴线由大端变到小端。', '参考异径套箍两端不同口径的内接形式。', 40, { smallDn: 25 }),
  threaded('P013', 'nipple-thread', '双外螺纹短接', 'nipple', '短管两端有外螺纹，中央六角段用于扳手夹持。', '参考带外螺纹短接的端接形态，外螺纹牙形为示意。'),
  threaded('P014', 'plug-thread', '螺纹堵头', 'plug', '单侧外螺纹与内螺纹管口相配，六角头便于旋装，中心封闭。', '参考螺纹堵头的封闭端及扳手头结构。'),
  asset('P015', 'joint-bellows-flanged', '法兰式波纹膨胀节', 'pipe', '中空金属波纹管连通两端法兰，用于观察波纹段和端接关系。', 50,
    'Metraflex MNLC 波纹膨胀节', 'https://www.metraflex.com/products/mnlc-bellows-expansion-joint/', '参考波纹壳体及可选法兰端的形态，未采用厂商性能或尺寸。',
    { ports: expansionEnds, build: buildExpansion, passages: pair }),
  asset('P016', 'return180', '180°回弯管', 'pipe', '半圆中心线连接平行的进出端，两端处于同一侧，弯管壁和内孔连续。', 50,
    'ASME B16.9 回弯', buttweld, '参考 180° 回弯类别与两端同侧的布置。', { ports: returnPorts, build: buildReturn, passages: pair }),
  asset('P017', 'flange-so', '板式平焊法兰', 'flange', '管侧焊接的环板型法兰，演示密封面、孔圈与连接管端的关系。', 50,
    'Nikal Steels EN 1092-1 法兰目录', flanges, 'Type 01 板式法兰作为结构形态参考，保留旧工坊接口尺寸。', { passages: [['weld', 'face']] }),
  asset('P018', 'flange-wn', '带颈对焊法兰', 'flange', '法兰环板通过渐变颈部过渡到管侧对焊端。', 50,
    'Nikal Steels EN 1092-1 法兰目录', flanges, 'Type 11 对焊颈部及法兰面结构作为参考。', { passages: [['weld', 'face']] }),
  asset('P019', 'flange-blind', '盲板法兰', 'flange', '带螺栓孔圈的实心封板，密封面封住对接法兰端。', 50,
    'Nikal Steels EN 1092-1 法兰目录', flanges, 'Type 05 盲板保留紧固孔但没有中心流道。', { passages: [] }),
  asset('P020', 'flange-lap-ring', '松套法兰', 'flange', '带螺栓孔圈的背衬环，套在翻边短节的管颈外并靠住其背面。', 50,
    'Nikal Steels EN 1092-1 法兰目录', flanges, 'Type 02 松套法兰与分离式翻边端配合，环板独立。', {
      build: buildLapRing, ports: lapRingPorts, passages: [], mounting: '松套法兰承托面接 P021 的翻边背面。'
    }),
  asset('P021', 'flange-lap-stub', '翻边短节', 'flange', '短管一端焊接，另一端通过翻边密封面与对侧法兰接合，背面承靠松套法兰。', 50,
    'Nikal Steels EN 1092-1 法兰目录', flanges, '松套法兰组件的焊环/翻边短节提供独立密封面。', {
      build: buildLapStub, ports: lapStubPorts, passages: [['weld', 'face']], mounting: '翻边背面接 P020 承托面。'
    }),
  asset('P022', 'gasket', '法兰密封垫片', 'flange', '带中心孔的平垫片，两个密封面分别与法兰贴合。', 50,
    'ASME B16.21 非金属平垫片', asme + 'b16-21-nonmetallic-flat-gaskets-pipe-flanges?productKey=L01521', '参考法兰平垫片的形状和装夹位置。', { passages: [['f1', 'f2']] }),
  asset('P023', 'bolt', '六角头螺栓', 'flange', '六角头压紧，杆部穿过紧固孔，端部与螺母啮合。', 16,
    'ASME B18.2.6 结构紧固件', asme + 'fasteners-for-use-in-structural-applications', '参考六角头螺栓外形和紧固关系，M16 为既有教学规格。', { mounting: '螺栓头的承压端可配 P025 平垫圈。' }),
  asset('P024', 'nut', '六角螺母', 'flange', '带中心螺纹孔的六角螺母，与同规格螺栓尾端旋合。', 16,
    'ASME B18.2.6 结构紧固件', asme + 'fasteners-for-use-in-structural-applications', '参考六角螺母外形和螺栓配合关系。'),
  asset('P025', 'washer-flat', '平垫圈', 'flange', '带通孔的薄金属圆环，在螺栓头下面形成承压面。', 16,
    'ASME B18.22M 公制平垫圈', asme + 'b18-22m-metric-plain-washers', '参考公制平垫圈平环结构，厚度仅演示。', {
      ports: washerPorts, build: buildWasher, passages: [], mounting: '垫圈孔接对应规格螺栓头承压侧。'
    }),
  asset('P026', 'clamp', 'U形管卡', 'flange', '圆弯段环抱管道上半周，两条杆脚过压板并用螺母固定。', 50,
    'PHD Standard U-Bolt', 'https://www.phd-mfg.com/products/fire-protection-seismic/threaded-accessories/standard-u-bolt/',
    '参考 U 形本体、双杆脚及管道导向用途。', { build: buildUBolt, mounting: '安装到同公称直径直管的表面。' }),
  asset('P027', 'support', '管鞋支座', 'flange', '曲面托板贴合管壁，经立腹板把载荷传至底板。', 50,
    'Piping Technology 现场焊接管鞋', 'https://pipingtech.com/products/pipe-shoes-pipe-guides/supports-that-require-field-welding/',
    '参考管壁接触面、腹板和支承底板的结构。', { build: buildPipeShoe, ports: pipeShoePorts, mounting: '安装到同公称直径直管的下侧。' }),
  asset('P028', 'saddle-vessel', '容器鞍座', 'flange', '弧形鞍板贴合卧式筒壳，腹板与底板将载荷传向基座。', 240,
    'Pressure Vessel Engineering 卧式容器设计实例', 'https://www.pveng.com/home/asme-code-design/horizontal-retention-vessel-sample/',
    'Flexible Saddles and Saddle Design 章节用鞍座承托卧式筒壳。工坊模型只演示接触形态。', {
      build: buildVesselSaddle, ports: saddlePorts, passages: [], mounting: '配现有卧式管壳式换热器筒体中段的教学装配位。'
    }),
  asset('P029', 'valve-ball', '球阀', 'valve', '带贯通孔的球芯随手柄转动，改变通道是否连通。', 50,
    'KSB 阀门词条', valveLexicon, '球形旋转闭合件是球阀的识别特征。'),
  asset('P030', 'valve-gate', '闸阀', 'valve', '闸板沿阀杆方向升降，通过从流道中抽离或落下开启和切断流路。', 50,
    'KSB 阀门词条', valveLexicon, '闸板与直通流道的关系。'),
  valve('P031', 'valve-globe', '截止阀', 'globe', 50, '升降阀杆驱动阀瓣压向阀座，外形可辨认阀盖、阀杆架与手轮。',
    'KSB 阀门词条', valveLexicon, '截止阀阀瓣相对阀座的轴向运动。'),
  valve('P032', 'valve-butterfly', '蝶阀', 'butterfly', 80, '短体双法兰蝶阀演示蝶板和横穿圆形流道的阀轴，可观察侧置手柄。',
    'KSB 阀门词条', valveLexicon, '蝶板与阀轴转动关系。'),
  asset('P033', 'valve-check', '旋启式止回阀', 'valve', '铰接阀瓣靠压差向正向摆开，反向闭合。', 50,
    'KSB 止回阀词条', checkLexicon, '旋启式与升降式的类别差异，沿箭头布置。', { passages: pair }),
  valve('P034', 'valve-check-lift', '升降式止回阀', 'lift', 50, '阀瓣在阀盖导向内升降，正向压差抬起阀瓣，反向回座切断。',
    'KSB 升降式止回阀', 'https://www.ksb.com/en-global/centrifugal-pump-lexicon/article/lift-check-valve-1117784', '参考升降止回机理，与旋启铰链式分开。'),
  valve('P035', 'valve-diaphragm', '隔膜阀', 'diaphragm', 50, '堰式阀体上的隔膜夹在阀体和阀盖之间，手轮通过压块改变隔膜与堰的间隙。',
    'GEMÜ 工业隔膜阀样本', 'https://www.gemu-group.com/en_EN/shop/document/bs_p_007_industrial_diaphragm_valves_gb.pdf/44cce8e5c781530e97f53a1e0db67ef4_2019.02.20.pdf',
    '参考手轮式隔膜阀外形、夹持层和隔膜工作方式。'),
  valve('P036', 'valve-plug', '旋塞阀', 'plug', 50, '旋塞带过流孔，由扳柄转动，外形区分锥形塞腔和上端扳柄。',
    'KSB 阀门词条', valveLexicon, '塞式闭合件的旋转关系，采用教学锥形外观。'),
  valve('P037', 'valve-control', '气动调节阀', 'control', 50, '滑杆阀体配圆形气动薄膜执行机构、阀架与侧面定位器外形。',
    'Emerson Fisher 滑杆调节阀选型指南', 'https://www.emerson.com/is/content/emerson/en/final-control/flow-controls/documents/d102484x012-bulletin-sliding-stem-valve-selection-guide-fisher.pdf',
    '参考滑杆式阀体、气动薄膜执行机构和定位器布置。'),
  valve('P038', 'valve-safety', '弹簧式安全阀', 'safety', 25, '底部进口、侧面泄放口与上部弹簧罩形成角式结构。装配教学中按常闭处理。',
    'LESER 弹簧式安全阀工作原理', 'https://cms2.leser.com/en/support-and-tools/safety-valve-tutorial/spring-loaded-safety-valve-1/',
    '参考常闭、垂直弹簧壳与角式泄放关系，未采用整定压力数据。')
];
