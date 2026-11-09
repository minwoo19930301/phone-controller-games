// Everyone takes their tee shot in the hole's established order first.
// Afterwards, select the ball farthest from the hole; equal distances use
// fewer strokes, then the established playing order.
export function nextFarthest(order, scores, distanceToPin) {
  const notTeed = order.find((slot) => scores[slot] && !scores[slot].holed && scores[slot].strokes === 0);
  if (notTeed !== undefined) return notTeed;
  let chosen = null;
  let farthest = -Infinity;
  for (const slot of order) {
    const score = scores[slot];
    if (!score || score.holed) continue;
    const distance = distanceToPin(...score.pos);
    if (!Number.isFinite(distance)) continue;
    if (chosen === null || distance > farthest + 1e-6 ||
        (Math.abs(distance - farthest) <= 1e-6 && score.strokes < scores[chosen].strokes)) {
      chosen = slot;
      farthest = distance;
    }
  }
  return chosen;
}

// On the next tee, lower scores on the previous hole have the honour.
// Stable ordering preserves the preceding order when scores are equal.
export function nextTeeOrder(order, scores) {
  return [...order].sort((a, b) => scores[a].strokes - scores[b].strokes);
}

// A person joining after hole 1 has not played all previous holes. Their
// partial total is shown separately, rather than beating complete scores.
export function rankedScores(order, scores) {
  return [...order].sort((a, b) => {
    const pa = (scores[a].joinedRound || 1) > 1;
    const pb = (scores[b].joinedRound || 1) > 1;
    return Number(pa) - Number(pb) || scores[a].total - scores[b].total;
  });
}

// When a disconnected or inactive player is skipped, record the hole maximum
// only once, including any strokes they have already taken on that hole.
export function skipHole(score, par) {
  const remaining = Math.max(0, par + 5 - score.strokes);
  score.holed = true;
  score.strokes += remaining;
  score.total += remaining;
}
