import test from 'node:test';
import assert from 'node:assert/strict';
import { handAt, handZoneAt, positionMetres, reachQuality } from '../public/pingpong/controls.mjs';

test('left/right control clamps to the playable width', () => {
  assert.equal(positionMetres(-2), -0.9);
  assert.equal(positionMetres(2), 0.9);
  assert.equal(positionMetres(null), 0);
});

test('forehand and backhand follow the player position and dominant hand', () => {
  assert.equal(handAt(-0.5, 0, 'right'), 'back');
  assert.equal(handAt(-0.5, 0, 'left'), 'fore');
  assert.equal(handAt(0.5, 0, 'right'), 'fore');
  assert.equal(handAt(0.5, 0, 'left'), 'back');
  assert.equal(handAt(0.2, 0.8, 'right'), 'back');
  assert.equal(handZoneAt(0, 0, 'right'), 'any');
  assert.equal(handZoneAt(0, 0, 'left'), 'any');
});

test('calibrated movement affects reach; automatic mode stays assisted', () => {
  assert.equal(reachQuality(0.8, null, 'normal'), 1);
  assert.equal(reachQuality(0.8, 0.8, 'normal'), 1);
  assert.ok(reachQuality(0.8, -0.3, 'normal') < reachQuality(0.8, -0.3, 'easy'));
  assert.ok(reachQuality(0.8, -0.8, 'hard') < 0.75);
});
