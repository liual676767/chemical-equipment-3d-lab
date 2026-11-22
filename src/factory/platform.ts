/* Shared dimensions of the existing teaching model, in scene coordinates. */
export const deck = {
  x: -5.3, z: -5.5, width: 3, depth: 1.3, centerY: 2.3,
  finishY: 2.37, finishThickness: 0.04
};
export const stairCount = 8;
export const tread = 0.28;
export const walkerRadius = 0.28;
const landingX = deck.x + deck.width / 2;
const footX = landingX + tread * stairCount;
const westX = landingX - deck.width;
const laneHalfWidth = deck.depth / 2 - walkerRadius;
export const stairApproach = { x: footX + 2 * walkerRadius, z: deck.z };

export function stepGeometry(i: number) {
  return {
    x: landingX + (i - 0.5) * tread,
    height: Math.max(0.06, deck.centerY * (1 - i / stairCount))
  };
}

function insideEnvelope(x: number, z: number) {
  return x >= westX - walkerRadius && x < footX && Math.abs(z - deck.z) <= deck.depth / 2 + walkerRadius;
}

export function walkSurface(x: number, z: number): number | null {
  if (!insideEnvelope(x, z)) return 0;
  if (x < westX + walkerRadius || Math.abs(z - deck.z) > laneHalfWidth) return null;
  if (x <= landingX) return deck.finishY + deck.finishThickness / 2;
  const i = Math.min(stairCount, Math.floor((x - landingX) / tread) + 1);
  return stepGeometry(i).height;
}
