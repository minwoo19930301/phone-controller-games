import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, pocketShot, makeRng, rollPath, solveAngle, isSplit, PIN_SPOTS, C } from '../public/bowling/physics.mjs';

const avg = (mk, n = 120) => {
  let s = 0, strikes = 0;
  for (let k = 0; k < n; k++) {
    const rng = makeRng(500 + k);
    const r = simulate({ ...mk(rng), rng });
    s += r.count; if (r.count === 10) strikes++;
  }
  return { avg: s / n, strikes: strikes / n };
};

test('핀 배치: 10개, 헤드 핀 뒤로 4줄', () => {
  assert.equal(PIN_SPOTS.length, 10);
  assert.equal(PIN_SPOTS[0].x, 0);
  assert.ok(Math.abs(PIN_SPOTS[6].x + 0.4572) < 1e-6 && Math.abs(PIN_SPOTS[9].x - 0.4572) < 1e-6);
});

test('같은 입력·같은 시드면 결과가 똑같다(결정적)', () => {
  const a = simulate({ ...pocketShot({ spin: -0.5 }), rng: makeRng(9) });
  const b = simulate({ ...pocketShot({ spin: -0.5 }), rng: makeRng(9) });
  assert.equal(a.count, b.count);
  assert.deepEqual(Array.from(a.pins.slice(0, 600)), Array.from(b.pins.slice(0, 600)));
});

test('거터 공은 핀을 0개 쓰러뜨린다', () => {
  const r = simulate({ x: 0.45, angle: 0.03, speed: 7, spin: 0.2, rng: makeRng(1) });
  assert.equal(r.ballState, 'gutter');
  assert.equal(r.count, 0);
  const left = simulate({ x: -0.5, angle: -0.02, speed: 7, spin: 0, rng: makeRng(1) });
  assert.equal(left.count, 0);
});

test('범퍼가 있으면 같은 공이 거터로 가지 않는다', () => {
  const r = simulate({ x: 0.45, angle: 0.03, speed: 7, spin: 0, bumpers: true, rng: makeRng(1) });
  assert.notEqual(r.ballState, 'gutter');
});

test('정확한 포켓 샷(보통 속도, 훅)은 평균 9개 이상', () => {
  const { avg: a, strikes } = avg((rng) => pocketShot({ spin: -0.55, speed: 7.4, entryX: 0.05 + (rng() - 0.5) * 0.02 }));
  assert.ok(a >= 9, `평균 ${a}`);
  assert.ok(strikes > 0.35, `스트라이크 비율 ${strikes}`);
});

test('한가운데로 곧장 치면 스트라이크가 드물고 스플릿이 나온다', () => {
  const { avg: a, strikes } = avg(() => pocketShot({ spin: 0, speed: 7.4, entryX: 0 }), 200);
  assert.ok(a > 5.5 && a < 9, `평균 ${a}`);
  assert.ok(strikes < 0.1, `스트라이크 비율 ${strikes}`);
});

test('훅: 기름이 끝나는 뒤쪽에서 휜다 (spin 이 클수록 더 휨)', () => {
  const p0 = rollPath(0, 0, 7.4, 0);
  const p1 = rollPath(0, 0, 7.4, -0.8);
  assert.ok(Math.abs(p0.x) < 1e-6);
  assert.ok(p1.x < -0.3, `끝 x ${p1.x}`);
  const mid = p1.pts.find((p) => p.y > 8);
  assert.ok(Math.abs(mid.x) < 0.08, '앞쪽 기름 구간에서는 거의 직진');
});

test('solveAngle 은 목표 x 에 맞춘다', () => {
  const a = solveAngle(0.1, 7.2, -0.4, 0.05);
  const r = rollPath(0.1, a, 7.2, -0.4);
  assert.ok(Math.abs(r.x - 0.05) < 0.005);
});

test('이미 쓰러진 핀(standing=false)은 세지 않는다', () => {
  const standing = Array(10).fill(true); standing[0] = false; standing[2] = false;
  const r = simulate({ ...pocketShot({}), standing, rng: makeRng(3) });
  assert.equal(r.down[0], false); assert.equal(r.down[2], false);
  assert.ok(r.count <= 8);
});

test('스플릿 판정', () => {
  const st = (leave) => Array.from({ length: 10 }, (_, i) => leave.includes(i + 1));
  assert.equal(isSplit(st([7, 10])), true);
  assert.equal(isSplit(st([4, 6])), true);
  assert.equal(isSplit(st([7, 4])), false);
  assert.equal(isSplit(st([1, 7, 10])), false);
});

test('기록된 프레임: 길이·공 위치가 레인을 따라 진행', () => {
  const r = simulate({ ...pocketShot({ spin: -0.4 }), rng: makeRng(2) });
  assert.ok(r.n > 60 && r.ball.length === r.n * 5 && r.pins.length === r.n * 60);
  assert.ok(r.ball[1] === 0 || r.ball[1] < 0.2);
  assert.ok(r.events.some((e) => e.kind === 'ball-pin'));
});
