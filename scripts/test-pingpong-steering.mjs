import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yawOffset, deltaAngle, validRange, positionFromAngle } from '../public/play/pingpong/steering.mjs';

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
test('rotated paddle faces share an axis and angles wrap at the axis boundary', () => {
  assert.ok(Math.abs(yawOffset([1, 0, 1]) - yawOffset([-1, 0, -1])) < 1e-8);
  assert.equal(yawOffset([0, 1, 0]), null);
  assert.equal(deltaAngle(-85, 85), 10);
});
