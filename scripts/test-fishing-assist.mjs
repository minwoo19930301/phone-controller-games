// 낚시: 난이도별 도움(ASSIST)이 쉬움 > 보통 > 어려움 순으로 너그러운지, 자동 감기·줄 감기 배율이 장력에 안 섞이는지 시험합니다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
// logic.js 는 package.json 에 type: module 이 없어 .js 를 그대로 불러올 수 없으니 원문을 데이터 주소로 불러옵니다.
const src = readFileSync(new URL('../public/fishing/logic.js', import.meta.url), 'utf8');
const { ASSIST, assistFor, newFight, stepFight } = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);

test('easy is the most forgiving, normal equals the old easy, hard is untouched', () => {
  const { easy, normal, hard } = ASSIST;
  assert.ok(easy.hookWin > normal.hookWin && normal.hookWin > hard.hookWin);
  assert.equal(hard.hookWin, 0.8);
  assert.equal(normal.hookWin, 1.7);
  assert.equal(easy.early, 0);
  assert.ok(easy.land > normal.land && normal.land > hard.land);
  assert.ok(easy.breakT >= normal.breakT && normal.breakT >= hard.breakT);
  assert.equal(hard.reelDist, 1);
  assert.equal(hard.autoReel, 0);
  assert.equal(hard.snap.aim, 0);
  assert.equal(assistFor('nope'), ASSIST.easy);
});

test('auto reel pulls the fish in with no input on easy, never on hard', () => {
  const fish = { species: 'lmb', power: 0.5, weight: 1 };
  const run = (level) => {
    const f = newFight(fish, 12, 0, 1, () => 0.5, ASSIST[level]);
    f.mode = 'hold';
    let steps = 0;
    for (; steps < 600 && !f.out; steps++) {
      f.modeT = 5;
      stepFight(f, 0.05, { omega: 0 }, () => 0.5);
    }
    return f;
  };
  assert.ok(run('easy').D < 12);
  assert.ok(run('hard').D >= run('easy').D);
});

test('reelDist multiplies the line reeled in per turn', () => {
  const mk = (level) => {
    const f = newFight({ species: 'lmb', power: 0.3, weight: 1 }, 20, 0, 1, () => 0.5, { ...ASSIST[level], autoReel: 0 });
    f.mode = 'hold';
    f.modeT = 9;
    stepFight(f, 0.1, { omega: 1 }, () => 0.5);
    return 20 - f.D;
  };
  assert.ok(mk('easy') > mk('hard') * 1.5);
});
