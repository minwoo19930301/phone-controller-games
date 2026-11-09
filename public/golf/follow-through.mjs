// The phone continues to send its measured shaft/face for a short bounded
// window after impact. This same window is enforced by the display.
export const FOLLOW_THROUGH_MS = 1800;
// Let players see extension and finish before the camera follows the ball.
export const FOLLOW_CAMERA_MS = 1400;

function within(now, start, duration) {
  return Number.isFinite(now) && Number.isFinite(start) && now >= start && now - start <= duration;
}

export function phoneMaySendFollow(mode, now, impactAt, phase, currentSlot, ownSlot) {
  return mode === 'result' && phase === 'playing' && ownSlot != null && currentSlot === ownSlot &&
    impactAt > 0 && within(now, impactAt, FOLLOW_THROUGH_MS);
}

export function displayMayReceiveFollow(sub, flight, now) {
  return (sub === 'flight' || sub === 'result') && flight != null && within(now, flight.t0, FOLLOW_THROUGH_MS);
}

export function displayShowsFollow(flight, now) {
  return flight != null && within(now, flight.t0, FOLLOW_CAMERA_MS);
}
