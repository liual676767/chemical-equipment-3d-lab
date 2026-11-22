/**
 * 微沸喷烧流程教学布局与设备避让盒（Phase 3）。
 *
 * - 18 个设备实例的平面位置与朝向为**教学示意坐标**，用于演示管线走向与避让，
 *   不是装置总平面图、工程坐标或现场安装定位；
 * - 设备避让盒是程序化模型的简化包围体（不含接管/法兰/爬梯/顶部小件），
 *   仅用于路由穿模检查与支架避让，不表示设备真实外形包络；
 * - 旋转仅使用 0 / π（保持主要接口朝向轴向），便于正交管路表达；
 * - 四根喷枪按来源说明位于二燃室与回转窑之间，但接入关系未确认，
 *   因此布置在主流程侧方（+Z），不接任何管线。
 */

import type { Vec3 } from './types';
import type { BoilModelKey } from '../engine/boilModels';

export interface EquipmentPlacementDef {
  equipmentId: string;
  /** 归一化模型包围盒中心在水平面的位置（y 恒为 0，教学示意坐标）。 */
  position: Vec3;
  /** 水平朝向（0 或 Math.PI）。 */
  rotationY: number;
}

/** 主流程沿 +X 方向展开；喷枪位于主流程 +Z 侧。 */
export const BOIL_LAYOUT: EquipmentPlacementDef[] = [
  { equipmentId: 'eq-smp', position: [0, 0, 0], rotationY: 0 },
  { equipmentId: 'eq-crusher', position: [5.8, 0, 0], rotationY: 0 },
  { equipmentId: 'eq-mixer', position: [10.6, 0, 0], rotationY: 0 },
  { equipmentId: 'eq-furnace-pump', position: [15.2, 0, 0], rotationY: 0 },
  { equipmentId: 'eq-secondary-chamber', position: [21.0, 0, 0], rotationY: 0 },
  { equipmentId: 'eq-spray-gun-01', position: [21.0, 0, 7.0], rotationY: 0 },
  { equipmentId: 'eq-spray-gun-02', position: [24.8, 0, 7.0], rotationY: 0 },
  { equipmentId: 'eq-spray-gun-03', position: [28.6, 0, 7.0], rotationY: 0 },
  { equipmentId: 'eq-spray-gun-04', position: [32.4, 0, 7.0], rotationY: 0 },
  { equipmentId: 'eq-rotary-kiln', position: [29.0, 0, 0], rotationY: 0 },
  { equipmentId: 'eq-quench-1', position: [37.0, 0, 0], rotationY: Math.PI },
  { equipmentId: 'eq-baghouse', position: [44.5, 0, 0], rotationY: 0 },
  { equipmentId: 'eq-quench-2', position: [51.5, 0, 0], rotationY: Math.PI },
  { equipmentId: 'eq-comprehensive-tower', position: [58.5, 0, 0], rotationY: Math.PI },
  { equipmentId: 'eq-wash-tower', position: [65.5, 0, 0], rotationY: 0 },
  { equipmentId: 'eq-wet-esp', position: [73.0, 0, 0], rotationY: 0 },
  { equipmentId: 'eq-id-fan', position: [80.0, 0, 0], rotationY: 0 },
  { equipmentId: 'eq-stack', position: [87.0, 0, 0], rotationY: 0 }
];

export interface LocalKeepoutBoxDef {
  label: string;
  /** 模型局部坐标（与 src/engine/boilModels.ts 构建几何同一坐标原点）。 */
  min: Vec3;
  max: Vec3;
}

/**
 * 设备简化避让盒（模型局部坐标）。
 * 尺寸只覆盖主要壳体/机架，刻意不包含接管法兰、爬梯、顶部小管等附属件；
 * 仅用于 Phase 3 的教学路由与穿模检查。
 */
export const BOIL_KEEPOUTS: Record<BoilModelKey, LocalKeepoutBoxDef[]> = {
  smp: [
    { label: 'SMP 主体与接收斗', min: [-2.2, 0, -1.4], max: [1.5, 3.6, 1.4] }
  ],
  crusher: [
    { label: '破碎机主体', min: [-1.4, 0, -1.15], max: [1.4, 3.2, 1.15] }
  ],
  mixer: [
    { label: '混合罐', min: [-1.1, 0, -1.1], max: [1.1, 3.4, 1.1] },
    { label: '顶部驱动', min: [-0.6, 3.4, -0.6], max: [0.6, 5.45, 0.6] }
  ],
  'furnace-pump': [
    { label: '炉塞泵与电机', min: [-1.6, 0, -0.8], max: [1.75, 2.0, 0.8] }
  ],
  'secondary-chamber': [
    { label: '二燃室筒体', min: [-1.55, 0, -1.55], max: [1.55, 6.8, 1.55] }
  ],
  'spray-gun': [
    { label: '喷枪本体', min: [-1.65, 0, -0.4], max: [1.65, 1.75, 0.4] }
  ],
  'rotary-kiln': [
    { label: '回转窑筒体与端罩', min: [-4.1, 0.3, -1.35], max: [4.1, 3.4, 1.35] }
  ],
  'quench-tower': [
    { label: '集冷塔下部', min: [-1.35, 0, -1.35], max: [1.35, 7.4, 1.35] },
    { label: '集冷塔顶部排气段', min: [-0.55, 7.3, -0.55], max: [0.55, 9.9, 0.55] }
  ],
  baghouse: [
    { label: '布袋除尘器箱体', min: [-2.0, 2.1, -1.25], max: [2.0, 5.3, 1.25] },
    { label: '灰斗', min: [-2.75, 0.8, -1.45], max: [2.75, 2.2, 1.45] },
    { label: '支腿', min: [-1.45, 0, -1.05], max: [1.45, 1.0, 1.05] }
  ],
  'comprehensive-tower': [
    { label: '综合塔下部', min: [-1.65, 0, -1.65], max: [1.65, 7.9, 1.65] },
    { label: '综合塔顶部排气段', min: [-0.65, 7.8, -0.65], max: [0.65, 9.9, 0.65] }
  ],
  'wash-tower': [
    { label: '水洗塔筒体', min: [-1.2, 0, -1.2], max: [1.2, 6.6, 1.2] }
  ],
  'wet-esp': [
    { label: '湿电壳体', min: [-1.35, 1.0, -1.25], max: [1.35, 6.9, 1.25] },
    { label: '湿电灰斗', min: [-2.0, 0.8, -2.0], max: [2.0, 2.0, 2.0] },
    { label: '支腿', min: [-1.05, 0, -0.85], max: [1.05, 1.0, 0.85] }
  ],
  'id-fan': [
    { label: '引风机壳体', min: [-1.2, 0.5, -1.15], max: [1.2, 2.7, 1.15] },
    { label: '出口与电机', min: [0.55, 2.3, -0.5], max: [1.15, 3.45, 0.5] },
    { label: '机座', min: [-1.45, 0, -0.95], max: [1.45, 0.3, 0.95] }
  ],
  stack: [
    { label: '烟囱筒体', min: [-1.55, 0.3, -1.55], max: [1.55, 11.6, 1.55] },
    { label: '基础', min: [-1.55, 0, -1.55], max: [1.55, 0.35, 1.55] }
  ]
};

export const BOIL_LAYOUT_NOTE =
  '教学示意布局：位置/朝向/间距不是工程总平面或现场安装坐标；避让盒为简化包络，不含接管法兰与附属件。';
