// Sideways tilt is a steering input, not a measurement of the player's location.
// top is the phone's physical long axis in the player's calibrated right/up/
// forward basis. A yaw about world-up leaves a vertical phone unchanged.
export function tiltOffset(top) {
  if (!top || !Number.isFinite(top[0]) || !Number.isFinite(top[1]) || Math.hypot(top[0], top[1]) < 0.15) return null;
  let a = Math.atan2(top[0], top[1]) * 180 / Math.PI;
  // The long axis has the same tilt if its endpoints are reversed; folding
  // also prevents a discontinuity if the phone is turned upside down.
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
