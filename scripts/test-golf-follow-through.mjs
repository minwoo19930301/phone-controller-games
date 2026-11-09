import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FOLLOW_CAMERA_MS, FOLLOW_THROUGH_MS, phoneMaySendFollow, displayMayReceiveFollow, displayShowsFollow } from '../public/golf/follow-through.mjs';

test('phone streams the active player’s follow-through, only after impact', () => {
  const impact = 5000;
  assert.equal(phoneMaySendFollow('swing', impact + 100, impact, 'playing', 1, 1), false);
  assert.equal(phoneMaySendFollow('result', impact + 400, impact, 'playing', 1, 1), true);
  assert.equal(phoneMaySendFollow('result', impact + FOLLOW_THROUGH_MS + 1, impact, 'playing', 1, 1), false);
  assert.equal(phoneMaySendFollow('result', impact + 100, impact, 'playing', 2, 1), false);
  assert.equal(phoneMaySendFollow('result', impact + 100, 0, 'playing', 1, 1), false);
});

test('short and long shots both retain the finish camera and accept follow-through', () => {
  const flight = { t0: 2000 };
  assert.equal(displayMayReceiveFollow('flight', flight, 2400), true);
  assert.equal(displayMayReceiveFollow('result', flight, 2400), true);
  assert.equal(displayShowsFollow(flight, flight.t0 + FOLLOW_CAMERA_MS), true);
  assert.equal(displayShowsFollow(flight, flight.t0 + FOLLOW_CAMERA_MS + 1), false);
  assert.equal(displayMayReceiveFollow('result', flight, flight.t0 + FOLLOW_THROUGH_MS + 1), false);
  assert.equal(displayMayReceiveFollow('aim', flight, 2400), false);
  assert.equal(displayMayReceiveFollow('flight', null, 2400), false);
});
