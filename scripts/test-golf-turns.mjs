import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextFarthest, nextTeeOrder } from '../public/golf/turn-order.mjs';

const dist = (x, z) => Math.hypot(x, z);
const score = (distance, strokes, holed = false) => ({ pos: [distance, 0], strokes, holed });

test('tee order proceeds to players who have not yet hit', () => {
  const scores = { 1: score(100, 1), 2: score(200, 0), 3: score(200, 0) };
  assert.equal(nextFarthest([1, 2, 3], scores, dist), 2);
  scores[2] = score(120, 1);
  assert.equal(nextFarthest([1, 2, 3], scores, dist), 3);
  scores[1] = score(250, 1); // A backwards tee shot is farther than the tee.
  assert.equal(nextFarthest([1, 2, 3], scores, dist), 3);
});

test('farthest ball plays next even when it is the same player again', () => {
  const scores = { 1: score(145, 2), 2: score(100, 1) };
  assert.equal(nextFarthest([1, 2], scores, dist), 1);
  scores[1] = score(90, 3);
  assert.equal(nextFarthest([1, 2], scores, dist), 2);
});

test('exact distance ties use strokes then stable order', () => {
  const scores = { 1: score(100, 2), 2: score(100, 1), 3: score(100, 1) };
  assert.equal(nextFarthest([1, 3, 2], scores, dist), 3);
  scores[3].holed = true;
  assert.equal(nextFarthest([1, 3, 2], scores, dist), 2);
});

test('penalty retains the prior ball location for choosing the next player', () => {
  const scores = { 1: score(160, 2), 2: score(90, 1) };
  assert.equal(nextFarthest([1, 2], scores, dist), 1);
});

test('a hole ends only after every player has holed out', () => {
  const scores = { 1: score(0, 3, true), 2: score(6, 2), 3: score(0, 4, true) };
  assert.equal(nextFarthest([1, 2, 3], scores, dist), 2);
  scores[2].holed = true;
  assert.equal(nextFarthest([1, 2, 3], scores, dist), null);
});

test('next tee uses last hole scores and preserves order on ties', () => {
  const scores = { 1: score(0, 5, true), 2: score(0, 3, true), 3: score(0, 3, true) };
  const order = [1, 3, 2];
  assert.deepEqual(nextTeeOrder(order, scores), [3, 2, 1]);
  assert.deepEqual(order, [1, 3, 2]);
});
