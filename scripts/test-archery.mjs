import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scoreArrow, rankPlayers, tally, ringOuter, RING_W, X_R, ARROW_R, FACE_R } from '../public/archery/scoring.mjs';
import {
  shoot, dropAt, launchSpeed, V_FULL, driftAt, mulberry32, initialWind, nextWind, tremble, beatPhase, beatIndex, fatigue, DIFFICULTY, pathAt, crossWind, metersPerDeg, FULL_PULL, assistAim, diffOf
} from '../public/archery/ballistics.mjs';

test('center is X and counts as 10', () => {
  const r = scoreArrow(0, 0);
  assert.equal(r.score, 10);
  assert.equal(r.isX, true);
  assert.equal(r.label, 'X');
});

test('ring boundaries step by 6.1 cm', () => {
  for (let s = 10; s >= 1; s--) {
    const inside = ringOuter(s) - ARROW_R - 0.002; // 안쪽에 확실히
    assert.equal(scoreArrow(inside, 0).score, s === 10 ? 10 : s, `ring ${s} inside`);
  }
  // 5점 링 안쪽과 바깥
  assert.equal(scoreArrow(RING_W * 5.5, 0).score, 5);
  assert.equal(scoreArrow(0, -RING_W * 3.5).score, 7);
});

test('line cutter: touching the line scores the higher ring', () => {
  // 화살 중심이 8점/7점 선보다 화살 반지름 이내로 바깥이면 8점
  const line = ringOuter(8); // 2.0 링... 8점 바깥 선
  assert.equal(scoreArrow(line + ARROW_R * 0.9, 0).score, 8);
  assert.equal(scoreArrow(line + ARROW_R * 1.1, 0).score, 7);
  // X 선도 같은 규칙
  assert.equal(scoreArrow(X_R + ARROW_R * 0.9, 0).isX, true);
  assert.equal(scoreArrow(X_R + ARROW_R * 1.1, 0).isX, false);
  assert.equal(scoreArrow(X_R + ARROW_R * 1.1, 0).score, 10);
});

test('outside the face is a miss, the outer line is still a 1', () => {
  assert.equal(scoreArrow(FACE_R + ARROW_R * 0.9, 0).score, 1);
  const m = scoreArrow(FACE_R + 0.1, 0);
  assert.equal(m.miss, true);
  assert.equal(m.score, 0);
});

test('tie break: total, then X count, then 10 count', () => {
  const rows = rankPlayers([
    { slot: 1, total: 80, xs: 1, tens: 3 },
    { slot: 2, total: 80, xs: 2, tens: 2 },
    { slot: 3, total: 81, xs: 0, tens: 0 },
    { slot: 4, total: 80, xs: 1, tens: 4 }
  ]);
  assert.deepEqual(rows.map((r) => r.slot), [3, 2, 4, 1]);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3, 4]);
  const tied = rankPlayers([{ slot: 1, total: 50, xs: 1, tens: 2 }, { slot: 2, total: 50, xs: 1, tens: 2 }]);
  assert.deepEqual(tied.map((r) => r.rank), [1, 1]);
});

test('tally counts X as a 10', () => {
  assert.deepEqual(tally([{ score: 10, isX: true }, { score: 10, isX: false }, { score: 9, isX: false }]), { total: 29, xs: 1, tens: 2 });
});

test('arrow drop grows with distance', () => {
  const d30 = dropAt(30, V_FULL);
  const d50 = dropAt(50, V_FULL);
  const d70 = dropAt(70, V_FULL);
  assert.ok(d30 < d50 && d50 < d70);
  assert.ok(d70 > 3 * d30);
});

test('under-draw shoots short (lower) and slower', () => {
  const full = shoot({ distance: 50, pull: 1, steady: 1, seed: 5 });
  const half = shoot({ distance: 50, pull: 0.5, steady: 1, seed: 5 });
  assert.ok(launchSpeed(0.5) < launchSpeed(1));
  assert.ok(half.y < full.y - 1);
  assert.ok(Math.abs(full.y) < 0.2); // 만궁으로 정면 조준하면 중심 근처
});

test('crosswind drifts downwind and grows with distance', () => {
  const right = { speed: 5, dir: 0 };
  const left = { speed: 5, dir: Math.PI };
  const a = shoot({ distance: 50, wind: right, seed: 3 });
  const b = shoot({ distance: 50, wind: left, seed: 3 });
  const none = shoot({ distance: 50, wind: null, seed: 3 });
  assert.ok(a.x > none.x);
  assert.ok(b.x < none.x);
  assert.ok(Math.abs(driftAt(70, V_FULL, right)) > Math.abs(driftAt(30, V_FULL, right)));
  assert.ok(Math.abs(crossWind({ speed: 4, dir: Math.PI / 2 })) < 1e-9); // 뒷바람은 옆으로 안 밈
});

test('deterministic with a seed, different with another', () => {
  const p = { distance: 70, aimX: 0.3, aimY: -0.2, pull: 0.97, steady: 0.6, wind: { speed: 3, dir: 0.4 } };
  const a = shoot({ ...p, seed: 42 });
  const b = shoot({ ...p, seed: 42 });
  const c = shoot({ ...p, seed: 43 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  const r1 = mulberry32(9); const r2 = mulberry32(9);
  assert.equal(r1(), r2());
});

test('aim offset moves impact by degrees * meters-per-degree', () => {
  const s = shoot({ distance: 50, aimX: 1, aimY: 0, steady: 1, seed: 1 });
  assert.ok(Math.abs(s.sx - metersPerDeg(50)) < 1e-9);
  assert.ok(s.x > 0);
});

test('path ends at the impact point', () => {
  const p = { distance: 50, aimX: 0.4, aimY: 0.1, pull: 1, wind: { speed: 3, dir: 0 } };
  const hit = shoot({ ...p, steady: 0.5, seed: 8 });
  const end = pathAt(1, { ...p, impact: hit });
  assert.ok(Math.abs(end.x - hit.x) < 1e-6 && Math.abs(end.y - hit.y) < 1e-6);
  const start = pathAt(0, { ...p, impact: hit });
  assert.ok(Math.abs(start.x) < 1e-6);
});

test('wind stays inside the difficulty cap and is deterministic', () => {
  for (const lv of ['easy', 'normal', 'hard']) {
    let w = initialWind(7, 0, lv);
    assert.deepEqual(w, initialWind(7, 0, lv));
    for (let i = 0; i < 50; i++) {
      w = nextWind(w, 100 + i, lv);
      assert.ok(w.speed <= DIFFICULTY[lv].windMax * 1.15 + 0.1);
    }
  }
  assert.ok(DIFFICULTY.hard.windMax > DIFFICULTY.easy.windMax);
});

test('tremble: steady first, then grows; breath window right after a heartbeat is steadier', () => {
  const lv = 'normal';
  const early = tremble(1, 3.3, lv, 2);
  assert.equal(early.f, 0);
  const t0 = DIFFICULTY[lv].steadySec;
  assert.equal(beatPhase(t0 - 0.1, lv), -1);
  assert.equal(beatIndex(t0 - 0.1, lv), 0);
  assert.equal(beatIndex(t0 + 0.05, lv), 1);
  assert.ok(fatigue(t0 + 3, lv) > fatigue(t0 + 1, lv));
  const tired = tremble(t0 + 3, 5, lv, 2); // 피로 후 심박 간격 3.2 → 구간 안(3.2 % .95 = .35)이 아님
  const breath = tremble(t0 + 0.95 * 3 + 0.1, 5, lv, 2); // 심박 직후
  assert.ok(breath.breath);
  assert.ok(breath.amp < tired.amp);
});

test('round 4: easy is the default and far more forgiving than normal, normal more than hard', () => {
  assert.equal(diffOf('nope'), DIFFICULTY.easy); // 모르는 값은 쉬움
  const { easy, normal, hard } = DIFFICULTY;
  assert.ok(easy.assist > normal.assist && normal.assist > hard.assist && hard.assist === 0);
  assert.ok(easy.gain < normal.gain && normal.gain < hard.gain);
  assert.ok(easy.steadySec > normal.steadySec && normal.steadySec > hard.steadySec);
  assert.ok(easy.steadyRms > normal.steadyRms && normal.steadyRms > hard.steadyRms);
  assert.ok(easy.windMax < normal.windMax && normal.windMax < hard.windMax);
  assert.ok(easy.distance < normal.distance && normal.distance < hard.distance);
  assert.equal(hard.distance, 70); // 어려움은 예전 그대로
  assert.equal(hard.marker, false);
});

test('round 4: full draw is 0.8 and a short pull still flies at least 60% speed', () => {
  assert.equal(FULL_PULL, 0.8);
  assert.equal(launchSpeed(FULL_PULL), V_FULL);
  assert.ok(Math.abs(launchSpeed(0) - V_FULL * 0.6) < 1e-9);
  assert.ok(launchSpeed(0.4) > launchSpeed(0.2));
});

test('round 4: aim assist pulls toward the wind-corrected spot and 0 leaves it alone', () => {
  assert.equal(assistAim(5, 0, 0), 5);
  assert.ok(Math.abs(assistAim(5, 0, 0.6) - 2) < 1e-9);
  assert.ok(Math.abs(assistAim(2, 2, 0.6) - 2) < 1e-9); // 보정 위치에 있으면 그대로
  assert.ok(Math.abs(assistAim(5, 1, 1) - 1) < 1e-9);
});

test('round 4: a lower gain shrinks hand tremor in meters', () => {
  const easy = DIFFICULTY.easy;
  const a = shoot({ distance: easy.distance, aimX: 1, steady: 1, seed: 1, gain: easy.gain });
  assert.ok(Math.abs(a.sx - metersPerDeg(easy.distance, easy.gain)) < 1e-9);
  assert.ok(metersPerDeg(30, 0.12) < metersPerDeg(30));
});
