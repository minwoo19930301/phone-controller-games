// 골프·퍼팅 난이도 보정: 쉬움이 기본이고 가장 넉넉하며, 어려움은 예전 값 그대로입니다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  levelOf, shapePower, shapeAngle, nominalSwing, swingDetect, strokeDetect, putt, limitPower,
  shapePutterSpeed, shapePutterFace, assistAim, FACE_SCALE, WIND_MAX
} from '../public/golf/assist.mjs';

test('unknown difficulty falls back to easy', () => {
  assert.equal(levelOf(undefined), 'easy');
  assert.equal(levelOf('normal'), 'normal');
  assert.equal(levelOf('nope'), 'easy');
});

test('hard keeps the old numbers', () => {
  assert.equal(shapePower(500, 1280, 'hard'), 500);
  assert.equal(shapeAngle(12, 'hard'), 12);
  assert.equal(FACE_SCALE.hard, 1);
  assert.equal(WIND_MAX.hard, 4.5);
  assert.deepEqual(swingDetect('hard', false), { back: -60, rate: 250, over: 25, resetD: 20, resetRate: 250, fidgetMs: 0, burst: 0 });
  assert.deepEqual(strokeDetect('hard'), { fwdRate: 25, minPeak: 20, travel: 1.5, rise: 0.8 });
  assert.equal(putt('hard').aim, 0);
  assert.equal(putt('hard').faceK, 0.88);
  assert.equal(putt('hard').cup, 1);
});

test('easy lifts a gentle swing and calms wrist error; normal sits in between', () => {
  const n7 = nominalSwing({ headKmh: 125, lengthM: 0.94 }) // 7번 아이언;
  assert.ok(n7 > 1200 && n7 < 1350, `7I nominal ${n7}`);
  const gentle = n7 * 0.3;
  assert.ok(shapePower(gentle, n7, 'easy') > shapePower(gentle, n7, 'normal'));
  assert.ok(shapePower(gentle, n7, 'normal') > gentle);
  assert.ok(Math.abs(shapePower(n7, n7, 'easy') - n7) < 1e-9, 'a nominal swing stays nominal');
  assert.ok(shapePower(n7 * 5, n7, 'easy') <= n7 * 1.3 + 1e-9, 'harder swings are capped');
  assert.equal(shapeAngle(2.5, 'easy'), 0);
  assert.ok(Math.abs(shapeAngle(30, 'easy')) < Math.abs(shapeAngle(30, 'normal')));
  assert.ok(Math.abs(shapeAngle(30, 'normal')) < Math.abs(shapeAngle(30, 'hard')));
});

test('full-swing detection is the same on every level (lower thresholds caught waggles)', () => {
  const [e, n, h] = ['easy', 'normal', 'hard'].map((l) => swingDetect(l, false));
  assert.deepEqual(e, h);
  assert.deepEqual(n, h);
  assert.equal(e.burst, 0);
  assert.ok(strokeDetect('easy').minPeak < strokeDetect('hard').minPeak);
});

test('a wrist snap with a short backswing does not fly full distance', () => {
  const sw = nominalSwing({ headKmh: 105, lengthM: 0.89 }); // 샌드웨지 정도
  const snap = limitPower(sw * 2.5, sw, 55); // 회전은 2.5배로 튀었지만 백스윙 55도
  assert.ok(snap <= sw * 0.5 + 1e-9, `snap ${snap / sw}`);
  const full = limitPower(sw * 2.5, sw, 170); // 큰 백스윙이어도 보통 세기의 1.1배까지
  assert.ok(full <= sw * 1.1 + 1e-9 && full > sw);
  assert.equal(limitPower(sw * 0.8, sw, 170), sw * 0.8, 'a normal full swing is untouched');
  assert.equal(limitPower(sw * 0.8, sw, 0), sw * 0.8, 'no backswing info, no backswing cap');
  assert.ok(limitPower(sw * 0.9, sw, 105) < sw * 0.9, 'a half swing is capped at about 0.8');
});

test('putting: magnet pulls toward the ideal speed, hard does not', () => {
  assert.equal(shapePutterSpeed(1, 2, 'hard'), 1);
  const easy = shapePutterSpeed(1, 2, 'easy');
  assert.ok(easy > 1 && easy < 2);
  assert.equal(shapePutterSpeed(10, 2, 'easy'), 10, 'a wild stroke is left alone');
  assert.equal(shapePutterFace(1.5, 'easy'), 0);
  assert.equal(shapePutterFace(20, 'easy'), 6);
  assert.equal(assistAim(3, 'hard'), 0);
  assert.equal(assistAim(3, 'easy'), 3);
  assert.ok(assistAim(3, 'normal') > 0 && assistAim(3, 'normal') < 3);
  assert.equal(assistAim(99, 'easy'), 25);
});
