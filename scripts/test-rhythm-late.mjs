import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { notesForLateJoin, rankFinishers } from '../public/rhythm/late-join.mjs';

// judge.js is a browser ES module in a CommonJS package. Import its source via
// a data URL to exercise the same production judge without changing package type.
const source = await readFile(new URL('../public/rhythm/judge.js', import.meta.url), 'utf8');
const { createJudge } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('a late joiner is scored only on notes after joining', () => {
  const notes = [1, 2, 3, 4].map((t) => ({ t, lane: 0, lenSec: 0 }));
  const judge = createJudge({ notes: notesForLateJoin(notes, 2.5), difficulty: 'normal', lanes: 4 });
  judge.update(2.8);
  assert.equal(judge.summary().counts.miss, 0);
  assert.equal(judge.st.life, 0.6);
  assert.equal(judge.step(0, 3).j, 'perfect');
  judge.update(5);
  const summary = judge.summary();
  assert.equal(summary.notes, 2);
  assert.equal(summary.counts.perfect, 1);
  assert.equal(summary.counts.miss, 1);
});

test('a perfect partial performance cannot displace full-song rankings', () => {
  const full = { p: { late: false }, s: { score: 700000, maxCombo: 10 } };
  const late = { p: { late: true }, s: { score: 1000000, maxCombo: 2 } };
  const result = rankFinishers([late, full]);
  assert.deepEqual(result, [full, late]);
  assert.equal(full.rank, 1);
  assert.equal(late.rank, null);
});
