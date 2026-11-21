import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreGame, nextBall, addRoll, needsFreshRack, maxPossible, strikeStreak } from '../public/bowling/scoring.mjs';

const rep = (n, v) => Array(n).fill(v);

test('퍼펙트 게임은 300점', () => {
  const g = scoreGame(rep(12, 10), 10);
  assert.equal(g.total, 300);
  assert.equal(g.done, true);
  assert.deepEqual(g.frames[9].marks, ['X', 'X', 'X']);
  assert.equal(g.frames[0].total, 30);
  assert.equal(g.frames[8].total, 270);
});

test('전부 스페어(5/5, 마지막 5)는 150점', () => {
  const g = scoreGame(rep(21, 5), 10);
  assert.equal(g.total, 150);
  assert.equal(g.frames[0].marks[1], '/');
});

test('전부 거터는 0점', () => {
  const g = scoreGame(rep(20, 0), 10);
  assert.equal(g.total, 0);
  assert.equal(g.done, true);
  assert.deepEqual(g.frames[0].marks, ['-', '-']);
});

test('보너스가 정해지기 전에는 누적 점수를 비워 둠', () => {
  const g = scoreGame([10], 10);
  assert.equal(g.frames[0].score, null);
  const g2 = scoreGame([10, 7], 10);
  assert.equal(g2.frames[0].score, null);
  const g3 = scoreGame([10, 7, 2], 10);
  assert.equal(g3.frames[0].score, 19);
  assert.equal(g3.frames[1].total, 28);
});

test('스페어 보너스는 다음 한 공', () => {
  const g = scoreGame([7, 3, 5, 1], 10);
  assert.equal(g.frames[0].score, 15);
  assert.equal(g.frames[1].total, 21);
});

test('10프레임: 열린 프레임은 2구로 끝', () => {
  const r = [...rep(18, 0), 4, 5];
  const g = scoreGame(r, 10);
  assert.equal(g.done, true);
  assert.equal(g.total, 9);
  assert.equal(nextBall(r, 10).over, true);
});

test('10프레임: 스트라이크 뒤 2구 / 스페어 뒤 1구', () => {
  const base = rep(18, 0);
  let nb = nextBall([...base, 10], 10);
  assert.deepEqual([nb.frame, nb.ball, nb.standing], [9, 1, 10]);
  nb = nextBall([...base, 10, 7], 10);
  assert.deepEqual([nb.frame, nb.ball, nb.standing], [9, 2, 3]);
  const g = scoreGame([...base, 10, 7, 3], 10);
  assert.equal(g.total, 20);
  assert.deepEqual(g.frames[9].marks, ['X', '7', '/']);
  nb = nextBall([...base, 6, 4], 10);
  assert.deepEqual([nb.frame, nb.ball, nb.standing], [9, 2, 10]);
  const g2 = scoreGame([...base, 6, 4, 10], 10);
  assert.equal(g2.total, 20);
  assert.deepEqual(g2.frames[9].marks, ['6', '/', 'X']);
});

test('10프레임: 스트라이크 뒤 더블 스트라이크 뒤 남은 핀', () => {
  const base = rep(18, 0);
  const nb = nextBall([...base, 10, 10], 10);
  assert.deepEqual([nb.ball, nb.standing], [2, 10]);
});

test('5프레임 판: 퍼펙트 150, 마지막 프레임만 3구', () => {
  const g = scoreGame(rep(7, 10), 5);
  assert.equal(g.total, 150);
  assert.equal(g.done, true);
  assert.equal(scoreGame(rep(10, 0), 5).total, 0);
  assert.equal(nextBall(rep(8, 0), 5).frame, 4);
  const r = [...rep(8, 0), 3, 7];
  assert.equal(nextBall(r, 5).over, false);
  assert.equal(scoreGame([...r, 9], 5).total, 19);
});

test('addRoll 검증과 새 랙 판단', () => {
  assert.throws(() => addRoll([7], 5, 10));
  assert.throws(() => addRoll(rep(20, 0), 1, 10));
  assert.deepEqual(addRoll([], 10, 10), [10]);
  assert.equal(needsFreshRack([10], 10), true);
  assert.equal(needsFreshRack([4], 10), false);
  assert.equal(needsFreshRack([4, 3], 10), true);
});

test('maxPossible, strikeStreak', () => {
  assert.equal(maxPossible([], 10), 300);
  assert.equal(maxPossible([], 5), 150);
  assert.equal(strikeStreak([10, 10, 10], 10), 3);
  assert.equal(strikeStreak([10, 10, 4], 10), 0);
  assert.equal(strikeStreak([10, 10], 10), 2);
});

test('9번째 스트라이크 + 10번째 보너스 계산', () => {
  const g = scoreGame([...rep(16, 0), 10, 10, 10, 8], 10);
  assert.equal(g.frames[8].score, 30);
  assert.equal(g.frames[9].score, 28);
  assert.equal(g.total, 58);
  assert.equal(g.done, true);
});

test('진행 중인 판: 아직 안 던진 프레임은 비어 있다', () => {
  const g = scoreGame([6], 5);
  assert.deepEqual(g.frames[0].marks, ['6']);
  for (let f = 1; f < 5; f++) assert.deepEqual(g.frames[f].rolls, []);
  const g2 = scoreGame([6, 4, 10, 3], 5);
  assert.deepEqual(g2.frames[2].rolls, [3]);
  assert.deepEqual(g2.frames[3].rolls, []);
  assert.equal(g2.frames[0].total, 20);
  assert.deepEqual(g2.current, { frame: 2, ball: 1, standing: 7 });
});
