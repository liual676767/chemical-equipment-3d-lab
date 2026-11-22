import * as THREE from 'three';

/**
 * 结构专属互动：每台设备一个可拖动的参数（开度 / 行程 / 转角 / 液位等），
 * 在观察与透明模式下实时作用于三维模型。所有变换基于首次作用时记录的初始位姿。
 */
export interface InteractionDef {
  label: string;
  hint: string;
  apply: (t: number, groups: Map<string, THREE.Group>) => void;
}

interface Base { pos: THREE.Vector3; rot: THREE.Euler; scale: THREE.Vector3; }
const captured = new WeakMap<THREE.Object3D, Base>();

function base(o: THREE.Object3D): Base {
  let b = captured.get(o);
  if (!b) {
    b = { pos: o.position.clone(), rot: o.rotation.clone(), scale: o.scale.clone() };
    captured.set(o, b);
  }
  return b;
}

/** 退出互动时恢复所有被作用对象的初始位姿（拆装练习中由 SceneManager 自行守卫） */
export function resetInteraction(groups: Map<string, THREE.Group>) {
  for (const g of groups.values()) {
    g.traverse((o) => {
      const b = captured.get(o);
      if (b) { o.position.copy(b.pos); o.rotation.copy(b.rot); o.scale.copy(b.scale); }
    });
  }
}

const rotY = (ids: string[], angle: (t: number) => number) =>
  (t: number, groups: Map<string, THREE.Group>) => {
    for (const id of ids) {
      const g = groups.get(id);
      if (g) g.rotation.y = base(g).rot.y + angle(t);
    }
  };

const rotX = (ids: string[], angle: (t: number) => number) =>
  (t: number, groups: Map<string, THREE.Group>) => {
    for (const id of ids) {
      const g = groups.get(id);
      if (g) g.rotation.x = base(g).rot.x + angle(t);
    }
  };

const liftY = (ids: string[], dy: (t: number) => number) =>
  (t: number, groups: Map<string, THREE.Group>) => {
    for (const id of ids) {
      const g = groups.get(id);
      if (g) g.position.y = base(g).pos.y + dy(t);
    }
  };

/** 液位：调节 shell / levelGauge 内的 demo-liquid 网格 */
const liquidLevel = (t: number, groups: Map<string, THREE.Group>) => {
  for (const id of ['shell', 'levelGauge']) {
    groups.get(id)?.traverse((o) => {
      if (o.name !== 'demo-liquid') return;
      const b = base(o);
      const bh = o.userData.baseH as number;
      const by = o.userData.bottomY as number;
      const h = bh * (0.12 + 0.85 * t);
      o.scale.y = b.scale.y * (h / bh);
      o.position.y = by + h / 2;
    });
  }
};

const HALF_PI = Math.PI / 2;

export const INTERACTIONS: Record<string, InteractionDef> = {
  pump: {
    label: '叶轮转角',
    hint: '拖动滑杆手动旋转叶轮、泵轴、密封动环与联轴器，观察叶片与蜗壳流道的相对位置。',
    apply: rotX(['impeller', 'shaft', 'keys', 'sealRotary', 'sealSleeve', 'coupling', 'couplingMotor', 'couplingBolts', 'motorShaft'], (t) => t * Math.PI * 2)
  },
  exchanger: {
    label: '管箱检修',
    hint: '教学示意：先退出管箱紧固件，再沿轴向移开管箱。固定管板与管束保持原位，不可抽芯。',
    apply: (t, groups) => {
      for (const id of ['channelBolts', 'channel', 'channelGasket']) {
        const g = groups.get(id); if (!g) continue;
        const travel = id === 'channelBolts' ? Math.min(t / 0.3, 1) * 1.1 : Math.max(0, (t - 0.3) / 0.7) * 0.7;
        g.position.x = base(g).pos.x - travel;
      }
    }
  },
  reactor: {
    label: '搅拌桨转角',
    hint: '拖动滑杆旋转搅拌轴与桨叶，观察桨叶与釜体内壁的空间关系。',
    apply: rotY(['shaft', 'paddles'], (t) => t * Math.PI * 2)
  },
  'ball-valve': {
    label: '阀门开度',
    hint: '旋转阀球与手柄：0% 全开（通孔对准流道），100% 关闭（通孔垂直切断）。',
    apply: rotY(['ball', 'stem', 'handle'], (t) => t * HALF_PI)
  },
  'gate-valve': {
    label: '闸板行程',
    hint: '转动手轮提升闸板：0% 落座关闭，100% 全开。明杆结构可见阀杆随闸板升降。',
    apply: (t, groups) => {
      liftY(['gate', 'stem'], () => t * 0.3)(t, groups);
      const hw = groups.get('handwheel');
      if (hw) hw.rotation.y = base(hw).rot.y + t * Math.PI * 6;
    }
  },
  'butterfly-valve': {
    label: '蝶板开度',
    hint: '旋转蝶板：0% 垂直于流道（关闭），100% 平行于流道（全开）。',
    apply: rotY(['disc', 'shaft', 'handle'], (t) => t * HALF_PI)
  },
  'check-valve': {
    label: '阀瓣摆角',
    hint: '模拟正向流动推开阀瓣：0% 落座（防止倒流），100% 全开。实际阀瓣由介质压差自动驱动。',
    apply: (t, groups) => {
      const g = groups.get('disc');
      if (g) g.rotation.z = base(g).rot.z - t * 1.15;
    }
  },
  'gear-pump': {
    label: '齿轮转角',
    hint: '主动齿轮与从动齿轮反向啮合旋转，观察齿槽在吸入侧张开、排出侧合拢。',
    apply: (t, groups) => {
      const a = groups.get('driveGear');
      const b = groups.get('idlerGear');
      if (a) a.rotation.x = base(a).rot.x + t * Math.PI * 2;
      if (b) b.rotation.x = base(b).rot.x - t * Math.PI * 2;
    }
  },
  'diaphragm-pump': {
    label: '隔膜行程',
    hint: '连杆带动两侧隔膜同步往复：一侧腔体增大吸入时，另一侧腔体缩小排出；四只球式止回阀随行程启闭。',
    apply: (t, groups) => {
      const k = (t - 0.5) * 0.06;
      const link = groups.get('link');
      if (link) link.position.x = base(link).pos.x + k;
      for (const id of ['diaphragmL', 'diaphragmR']) {
        groups.get(id)?.traverse((o) => {
          if (o.userData.diaphragmCenter) o.position.x = base(o).pos.x + k;
        });
      }
      const balls = groups.get('checkBalls');
      const leftSuction = t > 0.505;
      const rightSuction = t < 0.495;
      balls?.traverse((o) => {
        const v = o.userData.valve as { chamber: 'L' | 'R'; line: 'in' | 'out'; restY: number; openY: number } | undefined;
        if (!v) return;
        const open = (v.chamber === 'L' && v.line === 'in' && leftSuction)
          || (v.chamber === 'L' && v.line === 'out' && rightSuction)
          || (v.chamber === 'R' && v.line === 'in' && rightSuction)
          || (v.chamber === 'R' && v.line === 'out' && leftSuction);
        o.position.y = open ? v.openY : v.restY;
      });
    }
  },
  'plate-exchanger': {
    label: '板片展开',
    hint: '先沿轴向松开螺母和垫圈、抽出螺杆，再沿导杆移动压紧板与板片；交替流道与密封为教学示意。',
    apply: (t, groups) => {
      const bolts = groups.get('bolts');
      const nutPhase = Math.min(t / 0.2, 1), rodPhase = Math.max(0, Math.min((t - 0.2) / 0.2, 1));
      bolts?.traverse(o => {
        if (o.userData.kind === 'fastener') o.position.x = base(o).pos.x + (o.userData.side < 0 ? -0.16 : 0.8) * nutPhase;
        if (o.userData.kind === 'shaft') o.position.x = base(o).pos.x + 1.2 * rodPhase;
      });
      const movable = groups.get('movablePlate');
      if (movable) movable.position.x = base(movable).pos.x + Math.max(0, Math.min((t - 0.4) / 0.25, 1)) * 0.55;
      const phase = Math.max(0, (t - 0.65) / 0.35);
      for (const id of ['plates', 'gaskets']) groups.get(id)?.children.forEach(o => {
        if (o.userData.plateIdx !== undefined) o.position.x = base(o).pos.x + (o.userData.plateIdx as number) * 0.035 * phase;
      });
    }
  },
  'bag-filter': {
    label: '开盖换袋',
    hint: '依次移开紧固件、上盖和密封件，再提出滤袋。',
    apply: (t, groups) => {
      for (const [id, start, end, distance] of [
        ['coverBolts', 0, 0.2, 0.75],
        ['cover', 0.2, 0.45, 0.65],
        ['seal', 0.45, 0.6, 0.52],
        ['bag', 0.6, 1, 0.75]
      ] as const) {
        const group = groups.get(id);
        if (!group) continue;
        const phase = Math.max(0, Math.min((t - start) / (end - start), 1));
        group.position.y = base(group).pos.y + phase * distance;
      }
    }
  },
  'y-strainer': {
    label: '滤网抽出',
    hint: '隔离并确认泄压后，依次移开紧固件、滤盖和密封垫，再沿支管抽网。',
    apply: (t, groups) => {
      for (const [id, start, end, distance] of [
        ['coverBolts', 0, 0.2, 0.85], ['cover', 0.2, 0.4, 0.65],
        ['gasket', 0.4, 0.6, 0.48], ['screen', 0.6, 1, 0.38]
      ] as const) {
        const g = groups.get(id);
        if (!g) continue;
        const b = base(g).pos;
        const phase = Math.max(0, Math.min((t - start) / (end - start), 1));
        g.position.set(b.x + Math.SQRT1_2 * phase * distance, b.y - Math.SQRT1_2 * phase * distance, b.z);
      }
    }
  },
  'fixed-roof-tank': {
    label: '液位高度',
    hint: '调节罐内液位（演示数据），液位计同步显示。焊接罐体为固定结构，不可拆卸。',
    apply: liquidLevel
  },
  'gas-separator': {
    label: '液位高度',
    hint: '调节分离器底部液位（演示数据）：液位过高会压缩气体分离空间。',
    apply: liquidLevel
  },
  'packed-tower': {
    label: '填料吊装',
    hint: '模拟检修吊装：先吊出液体分布器，再依次取出两段填料模块。',
    apply: (t, groups) => {
      liftY(['packing1'], () => t * 0.5)(t, groups);
      liftY(['packing2'], () => t * 0.95)(t, groups);
      liftY(['distributor'], () => t * 1.35)(t, groups);
    }
  },
  'cyclone-separator': {
    label: '锥体检修',
    hint: '锥体与排料口整体下移分离，模拟锥段磨损后的更换检修。',
    apply: (t, groups) => {
      liftY(['cone', 'dustOutlet'], () => -t * 0.5)(t, groups);
    }
  },
  'screw-compressor': {
    label: '转子转角',
    hint: '阳转子（4 瓣）与阴转子（6 瓣）按齿数比反向旋转，观察啮合线沿轴向移动；型线为教学示意。',
    apply: (t, groups) => {
      const m = groups.get('maleRotor');
      const f = groups.get('femaleRotor');
      if (m) m.rotation.x = base(m).rot.x + t * Math.PI * 2;
      if (f) f.rotation.x = base(f).rot.x - t * Math.PI * 2 * (4 / 6);
    }
  },
  'emf-meter': {
    label: '电极检修',
    hint: '两侧电极沿径向抽出，观察电极与绝缘内衬的安装关系（演示动作，实际需停流泄压）。',
    apply: (t, groups) => {
      groups.get('electrodes')?.traverse((o) => {
        if (o.userData.side === undefined) return;
        o.position.z = base(o).pos.z + (o.userData.side as number) * t * 0.22;
      });
    }
  }
};
