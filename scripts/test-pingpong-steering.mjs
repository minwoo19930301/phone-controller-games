import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tiltOffset, deltaAngle, validRange, positionFromAngle } from '../public/play/pingpong/steering.mjs';

test('left/right calibration supports both sensor polarities and a stable center', () => {
  for (const [left, right] of [[-25, 35], [25, -35]]) {
    assert.ok(validRange(left, right));
    assert.equal(positionFromAngle(left, left, right), -1);
    assert.equal(positionFromAngle(right, left, right), 1);
    assert.equal(positionFromAngle(1, left, right), 0);
    assert.ok(positionFromAngle(left / 2, left, right) < 0);
    assert.ok(positionFromAngle(right / 2, left, right) > 0);
  }
});
test('rejects invalid or one-sided movement instead of inventing sensitivity', () => {
  assert.equal(validRange(-2, 30), false);
  assert.equal(validRange(10, 30), false);
  assert.equal(positionFromAngle(15, -2, 30), 0);
});
test('side tilt follows phone top, independent of facing direction and without fabricating a horizontal reading', () => {
  assert.equal(tiltOffset([0, 1, 0]), 0);
  assert.ok(Math.abs(tiltOffset([-.5, Math.sqrt(3) / 2, 0]) + 30) < 1e-8);
  assert.ok(Math.abs(tiltOffset([.5, Math.sqrt(3) / 2, 0]) - 30) < 1e-8);
  // Rotating the phone around its long axis (forehand/backhand) leaves top
  // unchanged. Reversing its endpoints describes the same physical axis.
  assert.ok(Math.abs(tiltOffset([.5, Math.sqrt(3) / 2, 0]) - tiltOffset([-.5, -Math.sqrt(3) / 2, 0])) < 1e-8);
  assert.equal(tiltOffset([0, 0, 1]), null);
  assert.equal(tiltOffset([NaN, 1, 0]), null);
  assert.equal(deltaAngle(-85, 85), 10);
});
