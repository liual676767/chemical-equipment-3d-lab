/** 单级离心泵的教学通道，X 为泵轴，Y 为上方，单位为米制教学比例。 */
type Point = [number, number, number];

function elbow(x: number, y: number): Point[] {
  return Array.from({ length: 7 }, (_, i) => {
    const angle = Math.PI * (1 - i / 12);
    return [x + Math.cos(angle) * 0.23, y + Math.sin(angle) * 0.23, 0];
  });
}

const eyeY = 0.78 + 0.121 * Math.cos(0.63);
const eyeZ = 0.121 * Math.sin(0.63);
export const pumpInlet: Point[] = [
  [-3.13, 0.165, 0], ...elbow(-2.90, 0.55), [-1.44, 0.78, 0], [-1.24, eyeY, eyeZ]
];

export const pumpBladePassage: Point[] = Array.from({ length: 10 }, (_, i) => {
  const fraction = i / 9;
  const angle = 1.05 * Math.pow(fraction, 0.85) + 0.63;
  const radius = 0.121 + 0.293 * fraction;
  return [-1.04 + 0.04 * fraction, 0.78 + radius * Math.cos(angle), radius * Math.sin(angle)];
});

export const pumpOutlet: Point[] = [
  ...Array.from({ length: 17 }, (_, i): Point => {
    const fraction = i / 16;
    const angle = 1.68 + (Math.PI * 2 - 0.12 - 1.68) * fraction;
    const radius = 0.414 + 0.139 * fraction;
    return [-1, 0.78 + radius * Math.cos(angle), radius * Math.sin(angle)];
  }),
  [-1, 1.42, 0], [-1, 2.12, 0], ...elbow(-0.77, 2.12).slice(1),
  [0.65, 2.35, 0]
];

export const pumpPath: Point[] = [...pumpInlet, ...pumpBladePassage, ...pumpOutlet];
