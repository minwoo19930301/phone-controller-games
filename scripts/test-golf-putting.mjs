// Exercise the actual browser simulator on a flat green, without a phone or GPU.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../public/golf/game.js', import.meta.url), 'utf8');
const from = src.indexOf('function surfaceInfo(');
const to = src.indexOf('\nfunction hitShot(', from);
assert.ok(from >= 0 && to > from, 'production physics must be present');
const hole = { pin: { x: 0, z: 100 }, bounds: { x0: -200, x1: 200, z0: -200, z1: 200 },
  aimFrom: () => ({ ...hole.pin }), pinHeight: () => 0 };
const game = { order: [1], turn: 0, scores: { 1: { pos: [0, 0] } }, wind: { x: 0, z: 0 } };
const simulate = new Function('hole', 'game', 'CLUBS', 'RD', 'height', 'surface', 'slope', 'waterY',
  `${src.slice(from, to)}\nreturn simulate;`)(
    hole, game, { pt: { loft: 3, smash: 1 } }, Math.PI / 180, () => 0, () => 'green', () => [0, 0], () => 0);
const putt = (speed) => simulate({ club: 'pt', speed, face: 0, path: 0, miss: 0, aim: 0 });

test('weak, medium, and strong strokes travel increasingly useful distances', () => {
  hole.pin.z = 100;
  const distances = [40, 80, 140].map((speed) => putt(speed).rest[1]);
  assert.ok(distances[0] > 0.4 && distances[0] < 1, `weak ${distances[0]}`);
  assert.ok(distances[1] > 1.8 && distances[1] < 2.4, `medium ${distances[1]}`);
  assert.ok(distances[2] > 5.5 && distances[2] < 7, `strong ${distances[2]}`);
  assert.ok(distances[0] < distances[1] && distances[1] < distances[2]);
});

test('a controlled putt can hole out; a hard putt passes the cup', () => {
  hole.pin.z = 2;
  assert.equal(putt(80).holed, true);
  hole.pin.z = 0.2;
  const hard = putt(140);
  assert.equal(hard.holed, false);
  assert.ok(hard.rest[1] > hole.pin.z);
});
