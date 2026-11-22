export interface BoilObservation {
  input: string;
  drive: string;
  outputs: readonly string[];
  inspect: { partId: string; label: string };
  boundary: string;
  reference: { label: string; url: string };
  check: { question: string; choices: readonly string[]; correct: number; explanation: string };
}

const bref = {
  label: '欧盟 JRC《废物焚烧 BREF》图 2.35',
  url: 'https://publications.jrc.ec.europa.eu/repository/bitstream/JRC118637/jrc118637_wi_bref_2019_published.pdf'
};

export const BOIL_OBSERVATIONS: Readonly<Record<string, BoilObservation | undefined>> = {
  'eq-baghouse': {
    input: '含尘烟气',
    drive: '含尘侧与净气侧的压差推动烟气过布。清灰机构的现场配置待确认。',
    outputs: ['通过滤布的烟气从净气侧接续当前烟气主路。', '滤袋截留的粉尘可落入灰斗；现场灰输送和处置线路待确认。'],
    inspect: { partId: 'hopper', label: '查看灰斗' },
    boundary: '现有教学管线只画了气侧主路。可在同一设备的结构观察中定位滤袋、净气室和灰斗。',
    reference: bref,
    check: {
      question: '从滤袋清下的粉尘，首先应找哪个结构？',
      choices: ['灰斗', '净气出口', '引风机叶轮'], correct: 0,
      explanation: '粉尘被滤袋截留，清下后落入灰斗。灰斗下游的现场输送路径尚无资料。'
    }
  },
  'eq-wash-tower': {
    input: '上游烟气与来自独立供应的洗涤液',
    drive: '喷淋让气液相接触。循环设备、洗涤液性质与供液条件待确认。',
    outputs: ['烟气从气侧出口进入下游湿电教学段。', '洗涤液带走所捕集的物质，进入液体收集侧；现场循环、补排和处理去向待确认。'],
    inspect: { partId: 'sump', label: '查看液体收集侧' },
    boundary: '现场塔内件、除雾构型和去除对象需核对总图与物料衡算。',
    reference: {
      label: '美国 EPA 湿式洗涤气体控制原理',
      url: 'https://www.epa.gov/air-emissions-monitoring-knowledge-base/monitoring-control-technique-wet-scrubber-gaseous-control'
    },
    check: {
      question: '判断洗涤过程有无完整物料去向，应补查什么？',
      choices: ['净气出口箭头', '洗涤液的收集、循环和排放路线', '三维动画播放时长'], correct: 1,
      explanation: '气路只说明气相去向。被洗涤液捕集的物质要沿液路核对；模型无法给出现场处理路径。'
    }
  },
  'eq-wet-esp': {
    input: '洗涤段后的烟气，冲洗液来自独立公用工程边界',
    drive: '电场使可捕集颗粒或液滴移向集尘表面，冲洗带走截留物。',
    outputs: ['气相沿烟气线进入引风机。', '带截留物的冲洗液汇入液侧收集；排液接口和现场去向待核。'],
    inspect: { partId: 'flushing-header', label: '查看冲洗结构' },
    boundary: '集尘极型式、电源、冲洗介质、现场联锁和效果需要设备资料。',
    reference: {
      label: '美国 EPA 线板式湿电除尘技术资料',
      url: 'https://nepis.epa.gov/Exe/ZyPURL.cgi?Dockey=P1008OHV.TXT'
    },
    check: {
      question: '湿电收集到的颗粒和液滴如何离开集尘表面？',
      choices: ['随画面消失', '接入喷枪', '由冲洗液带至液侧收集'], correct: 2,
      explanation: '电场负责捕集，冲洗负责带离表面。现场液路需要核对接管和处理系统。'
    }
  }
};

export const BOIL_ORDER_CHECK = {
  equipment: ['eq-secondary-chamber', 'eq-rotary-kiln'],
  pipeline: 'pipe-gas-01',
  detail: '本教学清单把烟气示踪从二燃室接向回转窑。欧盟 JRC 废物焚烧 BREF 图 2.9 的典型例子采用回转窑至二次燃烧室。需核对本案例竣工 PFD、P&ID 与接管表。当前箭头用于回放清单，窑底渣去向与现场操作均无可用依据。',
  url: bref.url
};
