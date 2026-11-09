// Phone rotation is a steering input, not a measurement of the player's location.
export function yawOffset(face) {
  if (!face || Math.hypot(face[0], face[2]) < 0.15) return null;
  let a = Math.atan2(face[0], face[2]) * 180 / Math.PI;
  // A flipped paddle can use either face. Both faces represent the same axis.
  if (a > 90) a -= 180;
  if (a < -90) a += 180;
  return a;
}
export function deltaAngle(value, center) {
  let a = value - center;
  while (a > 90) a -= 180;
  while (a < -90) a += 180;
  return a;
}
export function validRange(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left) >= 6 && Math.abs(right) >= 6 && left * right < 0;
}
export function positionFromAngle(value, left, right) {
  if (!Number.isFinite(value) || !validRange(left, right)) return 0;
  const dead = Math.min(3, Math.abs(left) / 3, Math.abs(right) / 3);
  if (Math.abs(value) <= dead) return 0;
  const edge = Math.sign(value) === Math.sign(left) ? left : right;
  const amount = Math.max(0, Math.min(1, (Math.abs(value) - dead) / (Math.abs(edge) - dead)));
  return edge === left ? -amount : amount;
}
