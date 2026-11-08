import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSwingSpeed } from '../public/play/golf/swing-speed.mjs';

test('a zero or missing gyro reading falls back to the measured downswing', () => {
  assert.equal(resolveSwingSpeed(0, 100), 65);
  assert.equal(resolveSwingSpeed(NaN, 100), 65);
  assert.equal(resolveSwingSpeed(0, 100, false), 100);
  assert.equal(resolveSwingSpeed(0, 0), 0);
});

test('a reliable gyro peak is retained and stronger swings stay stronger', () => {
  assert.equal(resolveSwingSpeed(160, 100), 160);
  assert.ok(resolveSwingSpeed(0, 120) > resolveSwingSpeed(0, 40));
  assert.equal(resolveSwingSpeed(-10, -5), 0);
});
