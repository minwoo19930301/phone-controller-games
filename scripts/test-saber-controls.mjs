// 광선검 조작 값 검사: 난이도 순서(쉬움 > 보통 > 어려움)와 휘두르기 문턱을 소스에서 읽어 확인합니다(three 없이).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const duelSrc = readFileSync(new URL('../public/saber/duel.js', import.meta.url), 'utf8');
const ctrlSrc = readFileSync(new URL('../public/play/saber/controller.js', import.meta.url), 'utf8');
const gameSrc = readFileSync(new URL('../public/saber/game.js', import.meta.url), 'utf8');

function levels() {
  const m = duelSrc.match(/export const DUEL_LEVEL = (\{[\s\S]*?\n\});/);
  assert.ok(m, 'DUEL_LEVEL not found');
  return new Function(`return (${m[1]})`)();
}
const constant = (name) => Number(ctrlSrc.match(new RegExp(`const ${name} = (\\d+)`))[1]);

test('난이도 순서: 쉬움이 가장 넉넉하고 어려움이 가장 빡빡', () => {
  const L = levels();
  for (const k of ['pre', 'post', 'open', 'tel']) assert.ok(L.easy[k] >= L.normal[k] && L.normal[k] > L.hard[k], k);
  for (const k of ['side', 'hold', 'strikeMin', 'dmgIn']) assert.ok(L.easy[k] <= L.normal[k] && L.normal[k] < L.hard[k], k);
});

test('쉬움·보통은 위 막기·찌르기가 없고 어려움만 있음', () => {
  const L = levels();
  for (const lv of ['easy', 'normal']) {
    assert.equal(L[lv].kinds.overhead, 0);
    assert.equal(L[lv].kinds.thrust, 0);
    assert.equal(L[lv].hold, 0);
    assert.equal(L[lv].swingParry, 'any');
  }
  assert.ok(L.hard.kinds.overhead > 0 && L.hard.kinds.thrust > 0);
  assert.equal(L.hard.swingParry, 'thrust');
});

test('폰 휘두르기 문턱은 어려움 판정선(strikeMin)보다 낮거나 같음', () => {
  const L = levels();
  assert.equal(constant('TRIGGER_DPS'), 200);
  assert.equal(constant('COOLDOWN_MS'), 180);
  assert.equal(constant('CAL_GUARD_MS'), 250);
  assert.ok(constant('TRIGGER_DPS') >= L.easy.strikeMin, '쉬움은 폰이 잡는 휘두르기면 판정도 통과');
  assert.ok(constant('TRIGGER_DPS') < L.hard.strikeMin);
});

test('약한 휘두르기는 폰에 알림(hit weak)이 가고 폰이 받음', () => {
  assert.match(gameSrc, /kind: 'weak'/);
  assert.match(ctrlSrc, /kind === 'weak'/);
});

test('튜토리얼은 저절로 시작하지 않고 2단계 이하', () => {
  const steps = (ctrlSrc.match(/\n\s{8}title: '/g) || []).length;
  assert.ok(steps <= 2, `steps ${steps}`);
  assert.doesNotMatch(ctrlSrc, /openCal|startCountdown/);
});
