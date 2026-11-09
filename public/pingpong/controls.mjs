// Player-relative position: -1 is left and +1 is right, for either end of the table.
export const CONTROL_WIDTH = 0.9;
export function positionMetres(position) {
  return Number.isFinite(position) ? Math.max(-1, Math.min(1, position)) * CONTROL_WIDTH : 0;
}
export function handAt(ballRight, playerPosition = 0, dominantHand = 'right') {
  const relative = (ballRight - positionMetres(playerPosition)) * (dominantHand === 'left' ? -1 : 1);
  return relative < -0.1 ? 'back' : 'fore';
}
export function handZoneAt(ballRight, playerPosition = 0, dominantHand = 'right') {
  const relative = (ballRight - positionMetres(playerPosition)) * (dominantHand === 'left' ? -1 : 1);
  return relative < -0.24 ? 'back' : relative > 0.04 ? 'fore' : 'any';
}
// Small misses remain playable, especially on easy; poor positioning is not
// silently corrected to the other side of the table.
export function reachQuality(ballRight, position, difficulty = 'normal') {
  if (!Number.isFinite(position)) return 1;
  const reach = { easy: 0.72, normal: 0.52, hard: 0.40 }[difficulty] ?? 0.52;
  return Math.max(0.25, 1 - Math.max(0, Math.abs(ballRight - positionMetres(position)) - reach) * 1.3);
}
