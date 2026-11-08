// Some phones report rotationRate as zero, or deliver its last sample just
// before the downswing starts. Use the smoothed orientation rate as a
// conservative fallback, without discarding an actual gyro peak.
export function resolveSwingSpeed(gyroPeak, orientationPeak, gyroPresent = true) {
  const valid = (n) => Number.isFinite(n) ? Math.max(0, n) : 0;
  return Math.max(valid(gyroPeak), valid(orientationPeak) * (gyroPresent ? 0.65 : 1));
}
