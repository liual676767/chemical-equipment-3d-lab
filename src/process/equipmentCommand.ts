export interface EquipmentStatus {
  enabled: boolean;
  active: boolean;
  description: string;
}

export function pumpStatus(enabled: boolean, air: boolean, hasMaterial: boolean, hasOutlet: boolean, pneumatic: boolean): EquipmentStatus {
  const active = enabled && air && (pneumatic || hasMaterial);
  const description = !enabled ? (pneumatic ? '供气指令已关闭' : '已停止')
    : !air ? '当前无气源，泵未动作'
      : !hasMaterial ? (pneumatic ? '供气已接通，泵可动作，入口无料' : '入口无料，当前无输送')
        : !hasOutlet ? '出口流路已切断，当前无下游输送' : '运行中，示踪显示物料输送路径';
  return { enabled, active, description };
}
