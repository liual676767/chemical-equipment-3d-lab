import { pumpPath } from '../data/pumpPath';

/**
 * 内窥教学视点：入口对应模型中真实连通的开口，视点位于流体通道的空腔内。
 * 所有坐标为世界坐标（米，教学示意比例）；不是工程测点，也不代表真实检修孔位置。
 */

export interface EndoscopeStop {
  id: string;
  name: string;
  pos: [number, number, number];
  look: [number, number, number];
  /** 当前位置的液流方向（教学示意） */
  flow: [number, number, number];
  hint: string;
}

export interface EndoscopeDef {
  /** 入口说明：必须对应模型上真实开放且连通的管口 */
  entryNote: string;
  stops: EndoscopeStop[];
  /** 教学流线（示意，虚线显示），用于方向参考 */
  flowPath: [number, number, number][];
}

const pumpStops: EndoscopeStop[] = [
  {
    id: 'suction-mouth', name: '吸入口（弯头下端口）',
    pos: [-3.13, 0.3, 0], look: [-3.13, 0.52, 0], flow: [0, 1, 0],
    hint: '从吸入弯头下端的真实管口进入：内壁完整、与弯头连通，液流向上进入弯头。'
  },
  {
    id: 'suction-elbow', name: '吸入弯头',
    pos: [-3.06, 0.71, 0], look: [-2.75, 0.78, 0], flow: [0.7, 0.7, 0],
    hint: '90° 弯头把竖直液流转向水平，沿吸入管流向泵吸入口法兰。'
  },
  {
    id: 'suction-pipe', name: '吸入管',
    pos: [-2.3, 0.78, 0], look: [-1.7, 0.78, 0], flow: [1, 0, 0],
    hint: '水平吸入管段：真实中空，前方是泵吸入口法兰与蜗壳吸入通道。'
  },
  {
    id: 'casing-inlet', name: '泵吸入口',
    pos: [-1.45, 0.78, 0], look: [-1.05, 0.78, 0], flow: [1, 0, 0],
    hint: '进入蜗壳吸入通道，前方是叶轮进口（叶轮眼）。'
  },
  {
    id: 'impeller-eye', name: '叶轮进口（叶轮眼）',
    pos: [-1.22, 0.86, 0.03], look: [-0.99, 0.79, 0], flow: [1, 0, 0],
    hint: '液体从叶轮眼轴向进入叶片流道；能看到前盖板、口环与叶片进口。'
  },
  {
    id: 'volute-channel', name: '蜗壳流道',
    pos: [-1.0, 0.306, 0.02], look: [-1.0, 0.329, -0.18], flow: [0, 0, -1],
    hint: '位于蜗壳流道截面内：通道沿旋向逐渐扩大，把叶轮甩出的动能转为压力能。'
  },
  {
    id: 'discharge-nozzle', name: '排出口',
    pos: [-1.0, 1.42, 0], look: [-1.0, 2.1, 0], flow: [0, 1, 0],
    hint: '位于排出接管内：液体向上经排出立管与弯头转向水平。'
  },
  {
    id: 'discharge-outlet', name: '排出管出口',
    pos: [-0.3, 2.35, 0], look: [0.5, 2.35, 0], flow: [1, 0, 0],
    hint: '水平排出管末端经异径管缩径，出口为开放管口（教学示意）。'
  }
];

export const ENDOSCOPES: Record<string, EndoscopeDef> = {
  pump: {
    entryNote: '从吸入弯头下端的开放管口进入；视点均选在教学流道的空腔内，蜗壳段为通道内预设观察点（叶片间空间过窄，不沿叶片流道穿行）。',
    stops: pumpStops,
    flowPath: pumpPath
  }
};
