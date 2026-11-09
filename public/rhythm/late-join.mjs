// Start scoring from the first note after the newcomer has had a moment to
// orient themselves. Earlier notes must never become retroactive misses.
export function notesForLateJoin(notes, fromTime) {
  return fromTime > 0 ? notes.filter((note) => note.t >= fromTime) : notes;
}

// A partial-song score uses a different denominator and is not comparable to a
// full performance. Show those players after the ranked full-song finishers.
export function rankFinishers(rows) {
  rows.sort((a, b) => Number(Boolean(a.p.late)) - Number(Boolean(b.p.late)) || b.s.score - a.s.score || b.s.maxCombo - a.s.maxCombo);
  let rank = 0, prev = null;
  rows.forEach((r, i) => {
    if (r.p.late) { r.rank = null; return; }
    if (!prev || r.s.score !== prev.s.score) rank = i + 1;
    r.rank = rank; prev = r;
  });
  return rows;
}
