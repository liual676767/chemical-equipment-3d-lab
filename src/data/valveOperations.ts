export type ValveKind = 'gate' | 'ball' | 'check' | 'butterfly' | 'control';
export const VALVE_STATE_LABEL = { open: 'OPEN', closed: 'CLOSED', partial: 'PARTIAL' } as const;
export type ValveState = keyof typeof VALVE_STATE_LABEL;

const isolation = ['open', 'closed'] as const;
const regulation = ['open', 'closed', 'partial'] as const;
export const VALVE_OPERATIONS: Record<ValveKind, { commands: readonly ValveState[]; description: string }> = {
  gate: { commands: isolation, description: '用于全开或全关的切断场合，流阻小、介质可双向流动，常见于水、蒸汽与油品主管路；不适合调节流量。' },
  ball: { commands: isolation, description: '本教学球阀用作切断阀，操作为全开或全关。' },
  check: { commands: [], description: '靠正向流动开启，停流时回座，阻止倒流。' },
  butterfly: { commands: regulation, description: '本教学蝶阀可全开、全关或部分开启，示踪速度仅用于比较。' },
  control: { commands: regulation, description: '调节阀可改变开度。实际调节范围和特性取决于选型。' },
};
