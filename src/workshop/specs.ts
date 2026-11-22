/* 规格预设：DN 按公称尺寸管理，外径/内径/壁厚/法兰尺寸分别记录。
 * 外径采用 GB/T 17395 / ISO 4200 系列 1 的核对值；壁厚与法兰厚度为教学简化值，
 * 法兰外径/螺栓孔中心圆/螺栓数量按 PN16（GB/T 9119 趋势）核对，其余标注教学示意。 */

export interface DnSpec {
  dn: number;
  od: number;      // 外径 mm（核对值）
  wall: number;    // 壁厚 mm（教学简化）
}

export const DN_TABLE: DnSpec[] = [
  { dn: 15, od: 21.3, wall: 2.5 },
  { dn: 20, od: 26.9, wall: 2.5 },
  { dn: 25, od: 33.7, wall: 2.5 },
  { dn: 32, od: 42.4, wall: 2.5 },
  { dn: 40, od: 48.3, wall: 2.5 },
  { dn: 50, od: 60.3, wall: 3.0 },
  { dn: 65, od: 76.1, wall: 3.0 },
  { dn: 80, od: 88.9, wall: 3.0 },
  { dn: 100, od: 114.3, wall: 3.5 },
  { dn: 125, od: 139.7, wall: 3.5 },
  { dn: 150, od: 168.3, wall: 3.5 },
  { dn: 200, od: 219.1, wall: 4.0 }
];

export const PIPE_DN_LIST = [15, 25, 40, 50, 65, 80, 100];

export function dnSpec(dn: number): DnSpec {
  const s = DN_TABLE.find((x) => x.dn === dn);
  if (!s) throw new Error(`未收录的公称尺寸 DN${dn}`);
  return s;
}

export function idOf(dn: number): number {
  const s = dnSpec(dn);
  return Math.round((s.od - 2 * s.wall) * 10) / 10;
}

export interface FlangeSpec {
  dn: number;
  d: number;       // 法兰外径 mm
  k: number;       // 螺栓孔中心圆直径 mm
  n: number;       // 螺栓孔数
  hole: number;    // 螺栓孔径 mm
  bolt: string;    // 螺栓规格
  t: number;       // 法兰厚度 mm（教学简化）
}

export const FLANGE_PN16: FlangeSpec[] = [
  { dn: 15, d: 95, k: 65, n: 4, hole: 14, bolt: 'M12', t: 14 },
  { dn: 20, d: 105, k: 75, n: 4, hole: 14, bolt: 'M12', t: 14 },
  { dn: 25, d: 115, k: 85, n: 4, hole: 14, bolt: 'M12', t: 14 },
  { dn: 32, d: 140, k: 100, n: 4, hole: 18, bolt: 'M16', t: 16 },
  { dn: 40, d: 150, k: 110, n: 4, hole: 18, bolt: 'M16', t: 16 },
  { dn: 50, d: 165, k: 125, n: 4, hole: 18, bolt: 'M16', t: 18 },
  { dn: 65, d: 185, k: 145, n: 4, hole: 18, bolt: 'M16', t: 18 },
  { dn: 80, d: 200, k: 160, n: 8, hole: 18, bolt: 'M16', t: 20 },
  { dn: 100, d: 220, k: 180, n: 8, hole: 18, bolt: 'M16', t: 20 },
  { dn: 125, d: 250, k: 210, n: 8, hole: 18, bolt: 'M16', t: 22 },
  { dn: 150, d: 285, k: 240, n: 8, hole: 22, bolt: 'M20', t: 22 },
  { dn: 200, d: 340, k: 295, n: 12, hole: 22, bolt: 'M20', t: 24 }
];

export function flangeSpec(dn: number): FlangeSpec {
  const f = FLANGE_PN16.find((x) => x.dn === dn);
  if (!f) throw new Error(`未收录的 PN16 法兰规格 DN${dn}`);
  return f;
}

/* 异径管预设配对（大端 → 小端），避免任意组合产生不真实规格 */
export const REDUCER_PAIRS: [number, number][] = [
  [50, 25], [50, 40], [65, 40], [65, 50], [80, 50], [80, 65],
  [100, 65], [100, 80], [125, 80], [125, 100], [150, 100], [150, 125], [200, 150]
];

export function reducerSmall(dn: number): number {
  const p = REDUCER_PAIRS.find(([a]) => a === dn);
  return p ? p[1] : dn;
}

/** 异径管小端可选口径（按预设配对，大端 = dn） */
export function reducerSmallOptions(dn: number): number[] {
  return REDUCER_PAIRS.filter(([a]) => a === dn).map(([, b]) => b);
}

export function reducerSmallValid(dn: number, smallDn: number): boolean {
  return REDUCER_PAIRS.some(([a, b]) => a === dn && b === smallDn);
}

/* 标准兼容：通过明确预设关系判断，不做模糊推断 */
const FLANGE_COMPAT: [string, string][] = [
  ['PN16', 'PN16'], ['PN10', 'PN10'], ['Class150', 'Class150']
];
const THREAD_COMPAT: [string, string][] = [
  ['G', 'G'], ['R', 'Rc'], ['Rc', 'R'], ['NPT', 'NPT'], ['M', 'M']
];

export function standardCompatible(type: 'flange' | 'thread', a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const table = type === 'flange' ? FLANGE_COMPAT : THREAD_COMPAT;
  return table.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

export const STANDARD_NOTE: Record<string, string> = {
  PN16: 'PN16 公称压力系列（GB/T 9119 趋势，教学示意）',
  PN10: 'PN10 公称压力系列',
  Class150: 'Class150 磅级系列（ASME 趋势，教学示意）',
  G: 'G 55° 非密封管螺纹',
  R: 'R 55° 密封外螺纹',
  Rc: 'Rc 55° 密封内螺纹',
  NPT: 'NPT 60° 美标锥螺纹',
  M: 'M 公制螺纹（紧固件）'
};

export const BOLT_DN: Record<string, number> = { M12: 12, M16: 16, M20: 20 };

export function fmtMm(v: number): string {
  return `${Math.round(v)} mm`;
}
