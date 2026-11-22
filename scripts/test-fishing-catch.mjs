// 낚시: 새 물고기 종(잉어·참돔·미꾸라지), 멀리 나간 줄 빨리 감기, 무게 범위를 시험합니다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../public/fishing/logic.js', import.meta.url), 'utf8');
const { SPECIES, MIX, rollWeight, bigness, farReel, fishInfo } = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);

test('every species in the mix exists and the mix adds up to 1', () => {
  for (const sp of Object.keys(MIX)) assert.ok(SPECIES[sp], sp);
  const sum = Object.values(MIX).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `mix ${sum}`);
  for (const sp of ['crp', 'brm', 'lch']) assert.ok(MIX[sp] > 0, sp);
});

test('weights stay inside each species range; carp and bream are heavy, loach is tiny', () => {
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const sp of Object.keys(SPECIES)) {
    for (let i = 0; i < 200; i++) {
      const w = rollWeight(sp, rand);
      assert.ok(w >= SPECIES[sp].min - 1e-9 && w <= SPECIES[sp].max + 1e-9, `${sp} ${w}`);
    }
  }
  assert.ok(SPECIES.crp.max > SPECIES.lmb.max && SPECIES.brm.min > SPECIES.blg.max);
  assert.ok(SPECIES.lch.max < 0.1);
  assert.equal(bigness('lch', 0.09), 0);
  const carp = fishInfo('crp', 6);
  assert.equal(carp.name, '잉어');
  assert.ok(carp.length > 0.5 && carp.length < 0.9, `carp ${carp.length}`);
});

test('a far line reels in faster, a near one as before', () => {
  assert.equal(farReel(5), 1);
  assert.equal(farReel(10), 1);
  assert.ok(Math.abs(farReel(22) - 2) < 1e-9);
  assert.equal(farReel(40), 2.5);
});
