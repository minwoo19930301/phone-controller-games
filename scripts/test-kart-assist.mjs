// 카트: 난이도별 보조 표와 자동 코너 브레이크 검사(브라우저 없이).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// public 폴더에는 type: module 이 없어 .js 가 CommonJS 로 읽힙니다. 임시 폴더에 .mjs 로 복사해 불러옵니다.
const dir = mkdtempSync(join(tmpdir(), 'kart-test-'));
const copy = (name) => {
  const src = readFileSync(new URL(`../public/kart/${name}.js`, import.meta.url), 'utf8').replace(/from '\.\/track\.js'/g, "from './track.mjs'");
  writeFileSync(join(dir, `${name}.mjs`), src);
};
copy('track');
copy('physics');
const { createTrack } = await import(pathToFileURL(join(dir, 'track.mjs')).href);
const { ASSIST, K, newKart, placeKart, stepKart, cornerBrake } = await import(pathToFileURL(join(dir, 'physics.mjs')).href);

test('쉬움이 보통보다, 보통이 어려움보다 넉넉하다', () => {
  for (const key of ['center', 'lane', 'wallKeep', 'yawMul']) {
    assert.ok(ASSIST.easy[key] >= ASSIST.normal[key], `easy>=normal ${key}`);
    assert.ok(ASSIST.normal[key] >= ASSIST.hard[key], `normal>=hard ${key}`);
  }
  assert.ok(ASSIST.easy.vmaxMul < ASSIST.normal.vmaxMul && ASSIST.normal.vmaxMul < ASSIST.hard.vmaxMul);
  assert.equal(ASSIST.hard.autoBrake, 0);
  assert.equal(ASSIST.hard.vmaxMul, 1);
});

test('어려움은 최고 속도 그대로, 쉬움은 낮다', () => {
  const track = createTrack();
  const top = (level) => {
    const k = newKart(0, 0, 0, 0);
    placeKart(k, track, 5, 0, 46);
    k.assist = ASSIST[level];
    for (let i = 0; i < 40; i++) stepKart(k, { steer: 0, gas: 1, brake: 0 }, 1 / 60, track, {});
    return k.vf;
  };
  assert.ok(top('hard') > top('easy') + 3);
  assert.ok(top('hard') <= K.VMAX * 1.01);
});

test('자동 코너 브레이크: 어려움(0)은 끄고, 천천히 가면 안 건다', () => {
  const track = createTrack();
  const k = newKart(0, 0, 0, 0);
  placeKart(k, track, 5, 0, 0);
  k.vf = 40;
  assert.equal(cornerBrake(k, track, 0), false);
  k.vf = 5;
  assert.equal(cornerBrake(k, track, ASSIST.easy.autoBrake), false);
});
