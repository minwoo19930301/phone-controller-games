// 줄다리기 시뮬레이션 단위 시험: node --test scripts/test-tugofwar.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { Round, Match, assignTeams, CFG, DIFF, mulberry32 } from '../public/tugofwar/sim.mjs';

// 팀 구성을 직접 지정한 판(사람 3 대 사람 3, CPU 없음)
function sixHumans(opts = {}) {
  return new Round({ seed: 7, difficulty: 'normal', teams: { blue: [1, 2, 3], white: [4, 5, 6], size: 3, cpu: { blue: 0, white: 0 } }, ...opts });
}
// 판을 dt 간격으로 돌리며, 매 구령의 당기는 박에 plan(round, cyc)이 정한 사람들이 당기게 합니다.
function run(r, plan, seconds = 62) {
  const done = new Set();
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60 && r.phase === 'run'; i++) {
    r.tick(dt);
    for (const c of r.cycles) {
      if (done.has(c.id) || r.t < c.pullAt - 0.3) continue;
      done.add(c.id);
      plan(r, c);
    }
  }
}
const perfect = (ids) => (r, c) => { for (const id of ids) r.pull(id, c.pullAt + 0.005, 1); };
const sloppy = (ids, rng) => (r, c) => { for (const id of ids) r.pull(id, c.pullAt + (rng() - 0.5) * 0.46, 0.8); };

test('팀 자동 균형: 1명이면 CPU 가 채움, 홀수여도 크기가 같음', () => {
  const a = assignTeams([{ slot: 1, pref: 'auto' }]);
  assert.deepEqual(a.blue, [1]);
  assert.equal(a.size, 3);
  assert.deepEqual(a.cpu, { blue: 2, white: 3 });
  const b = assignTeams([1, 2, 3, 4, 5].map((s) => ({ slot: s, pref: 'auto' })));
  assert.equal(b.blue.length + b.white.length, 5);
  assert.ok(Math.abs(b.blue.length - b.white.length) <= 1);
  assert.equal(b.cpu.blue + b.blue.length, b.size);
  assert.equal(b.cpu.white + b.white.length, b.size);
  const c = assignTeams([{ slot: 1, pref: 'white' }, { slot: 2, pref: 'white' }, { slot: 3, pref: 'auto' }]);
  assert.deepEqual(c.white, [1, 2]);
  assert.deepEqual(c.blue, [3]);
  const d = assignTeams(Array.from({ length: 8 }, (_, i) => ({ slot: i + 1, pref: 'auto' })));
  assert.deepEqual([d.blue.length, d.white.length], [4, 4]);
  const e = assignTeams(Array.from({ length: 7 }, (_, i) => ({ slot: i + 1, pref: 'blue' })));
  assert.ok(e.blue.length <= 5 && e.white.length >= 2);
});

test('박자표: 4박 구령, 스퍼트에는 두 배 빠른 2박, 템포가 오름', () => {
  const r = sixHumans();
  const first = r.cycles[0];
  assert.deepEqual(first.beats.map((b) => b.kind), ['one', 'two', 'pull', 'rest']);
  assert.equal(first.start, CFG.LEAD_IN);
  run(r, () => {}, 62);
  const normal = r.cycles.filter((c) => !c.sprint);
  const sprint = r.cycles.filter((c) => c.sprint);
  assert.ok(sprint.length >= 6, '스퍼트 구령이 여럿');
  assert.deepEqual(sprint[0].beats.map((b) => b.kind), ['one', 'pull']);
  assert.ok(sprint[0].len < normal[0].len / 1.5);
  assert.ok(normal[normal.length - 1].ivl < normal[0].ivl, '템포가 빨라짐');
});

test('판정: PERFECT/GOOD/OFF/MISS 와 난이도별 창', () => {
  const r = sixHumans();
  const c = r.cycles[0];
  r.t = c.pullAt;
  assert.equal(r.pull('p1', c.pullAt + 0.01).j, 'perfect');
  assert.equal(r.pull('p2', c.pullAt - 0.12).j, 'good');
  assert.equal(r.pull('p3', c.pullAt + 0.22).j, 'off');
  assert.equal(r.pull('p4', c.pullAt + 0.4).j, 'miss');
  const mk = (d) => new Round({ seed: 1, difficulty: d, teams: { blue: [1], white: [], size: 3, cpu: { blue: 2, white: 3 } } });
  assert.equal(mk('easy').judgeOffset(0.09), 'perfect');
  assert.equal(mk('hard').judgeOffset(0.09), 'good');
});

test('박을 정확히 맞춘 한 몸 팀이 어설프게 당기는 팀을 이김', () => {
  const rng = mulberry32(99);
  const r = sixHumans();
  run(r, (rr, c) => { perfect(['p1', 'p2', 'p3'])(rr, c); sloppy(['p4', 'p5', 'p6'], rng)(rr, c); });
  assert.equal(r.phase, 'done');
  assert.equal(r.winner, 'blue');
  assert.ok(r.rope > 0.3);
  assert.ok(r.teamStats('blue').perfect > r.teamStats('white').perfect);
});

test('한 몸 보너스: 같은 개별 판정이라도 모여 당기면 힘이 큼', () => {
  const together = sixHumans();
  const apart = sixHumans();
  const c1 = together.cycles[0], c2 = apart.cycles[0];
  together.t = c1.pullAt; apart.t = c2.pullAt;
  together.pull('p1', c1.pullAt + 0.09, 1); together.pull('p2', c1.pullAt + 0.1, 1); together.pull('p3', c1.pullAt + 0.11, 1);
  apart.pull('p1', c2.pullAt + 0.14, 1); apart.pull('p2', c2.pullAt + 0.0, 1); apart.pull('p3', c2.pullAt - 0.14, 1);
  together.t = c1.pullAt + CFG.RESOLVE_AFTER + 0.01; together.tick(0.001);
  apart.t = c2.pullAt + CFG.RESOLVE_AFTER + 0.01; apart.tick(0.001);
  const evT = together.drain().find((e) => e.type === 'resolve');
  const evA = apart.drain().find((e) => e.type === 'resolve');
  assert.ok(evT.sync.blue.body, '세 명이 한 창 안이면 한 몸');
  assert.ok(evT.sync.blue.bonus > 1.5);
  assert.equal(evA.sync.blue.bonus, 1);
  assert.ok(evT.F.blue > evA.F.blue * 1.4, `${evT.F.blue} vs ${evA.F.blue}`);
});

test('연타하면 체력이 깎이고 힘이 줄어듦, 쉬면 회복', () => {
  const r = sixHumans();
  const c = r.cycles[0];
  r.t = c.pullAt;
  const calm = r.parts.get('p2');
  r.pull('p1', c.pullAt, 1);
  for (let i = 0; i < 8; i++) r.pull('p1', c.pullAt + 0.03 * (i + 1), 1);
  const p1 = r.parts.get('p1');
  assert.ok(p1.stamina < 0.4, `연타 체력 ${p1.stamina}`);
  assert.ok(p1.spam >= 8);
  assert.equal(r.cycles[0].pulls.filter((x) => x.id === 'p1').length, 1, '한 박에 한 번만 힘이 됨');
  r.pull('p2', c.pullAt, 1);
  assert.ok(calm.stamina > p1.stamina);
  const before = p1.stamina;
  for (let i = 0; i < 120; i++) r.tick(1 / 60);
  assert.ok(p1.stamina > before + 0.05, '쉬면 회복');
  const r2 = sixHumans();
  r2.parts.get('p1').stamina = 0.05;
  const c2 = r2.cycles[0];
  const weak = r2.pull('p1', c2.pullAt, 1).f;
  const strong = r2.pull('p2', c2.pullAt, 1).f;
  assert.ok(weak < strong * 0.6);
});

test('시간 승: 60초가 끝났을 때 앞선 팀이 이김(선은 못 넘김)', () => {
  const r = sixHumans();
  run(r, (rr, c) => { if (c.id % 5 === 0) rr.pull('p1', c.pullAt, 1); }, 70);
  assert.equal(r.phase, 'done');
  assert.equal(r.reason, 'time');
  assert.equal(r.winner, r.rope > 0 ? 'blue' : 'white');
  assert.ok(Math.abs(r.rope) < 1);
  assert.ok(r.t >= CFG.ROUND_SEC);
});

test('선 넘기: 압도하면 시간 전에 끝남', () => {
  const r = sixHumans();
  run(r, perfect(['p4', 'p5', 'p6']), 70);
  assert.equal(r.winner, 'white');
  assert.equal(r.reason, 'line');
  assert.ok(r.t < CFG.ROUND_SEC);
  assert.equal(r.rope, -1);
});

test('버티기: 몰린 팀이 버티면 상대의 힘이 반으로', () => {
  const r = sixHumans();
  r.rope = -0.7;
  let braceCyc = null;
  for (let i = 0; i < 60 * 12 && !braceCyc; i++) {
    r.tick(1 / 60);
    braceCyc = r.cycles.find((c) => c.brace);
  }
  assert.ok(braceCyc && braceCyc.brace === 'blue');
  r.t = braceCyc.pullAt - 0.2;
  for (const id of ['p1', 'p2', 'p3']) assert.ok(r.brace(id));
  r.pull('p4', braceCyc.pullAt, 1); r.pull('p5', braceCyc.pullAt, 1); r.pull('p6', braceCyc.pullAt, 1);
  const full = braceCyc.pulls.reduce((s, x) => s + x.f, 0);
  r.t = braceCyc.pullAt + CFG.RESOLVE_AFTER + 0.01;
  r.tick(0.001);
  const ev = r.drain().find((e) => e.type === 'resolve' && e.cyc === braceCyc.id);
  assert.ok(ev.brace.success);
  assert.ok(Math.abs(ev.F.white - full * ev.sync.white.bonus * CFG.BRACE_CUT) < 1e-9);
  const r2 = sixHumans();
  r2.rope = -0.7;
  let c2 = null;
  for (let i = 0; i < 60 * 12 && !c2; i++) { r2.tick(1 / 60); c2 = r2.cycles.find((c) => c.brace); }
  r2.t = c2.pullAt + CFG.RESOLVE_AFTER + 0.01; r2.tick(0.001);
  assert.equal(r2.drain().find((e) => e.type === 'resolve' && e.cyc === c2.id).brace.success, false);
});

test('같은 seed 이면 결과가 똑같고, 다르면 달라짐', () => {
  const play = (seed) => {
    const r = new Round({ seed, difficulty: 'normal', teams: assignTeams([{ slot: 1, pref: 'auto' }]) });
    run(r, (rr, c) => { rr.pull('p1', c.pullAt + 0.02, 0.9); }, 70);
    return JSON.stringify([r.rope.toFixed(6), r.winner, r.t.toFixed(3), r.cycles.length, r.teamStats('blue'), r.teamStats('white')]);
  };
  assert.equal(play(5), play(5));
  assert.notEqual(play(5), play(6));
});

test('CPU: CPU 끼리 한 판이 끝까지 가고, 어려움이 쉬움보다 정확', () => {
  const stats = {};
  for (const d of ['easy', 'hard']) {
    const r = new Round({ seed: 3, difficulty: d, teams: assignTeams([]) });
    run(r, () => {}, 70);
    assert.equal(r.phase, 'done');
    // 판정 창이 난이도마다 달라 PERFECT 비율로는 비교할 수 없으므로, 박에서 벗어난 평균 시간(작을수록 정확)으로 비교
    const offs = r.events.filter((e) => e.type === 'judge' && !e.spam).map((e) => Math.abs(e.off)).filter((x) => x < 1);
    stats[d] = offs.reduce((s2, x) => s2 + x, 0) / Math.max(1, offs.length);
  }
  assert.ok(stats.hard < stats.easy, JSON.stringify(stats));
});

test('경기: 3판 2선승, 판마다 자리 교대', () => {
  const m = new Match();
  assert.equal(m.sideOf('blue'), 'left');
  assert.equal(m.endRound('blue').done, false);
  assert.equal(m.sideOf('blue'), 'right');
  assert.equal(m.endRound('white').done, false);
  assert.equal(m.sideOf('blue'), 'left');
  const e = m.endRound('white');
  assert.deepEqual([e.done, e.winner], [true, 'white']);
});

test('난이도 표: 쉬움이 가장 넉넉하고 어려움은 예전 값 그대로', () => {
  assert.deepEqual(DIFF.easy.win, { perfect: 0.14, good: 0.26, off: 0.4 });
  assert.deepEqual(DIFF.normal.win, { perfect: 0.1, good: 0.19, off: 0.3 });
  assert.deepEqual(DIFF.hard.win, { perfect: 0.055, good: 0.12, off: 0.22 });
  assert.ok(DIFF.easy.cost.spam < DIFF.hard.cost.spam && DIFF.easy.cost.miss < DIFF.hard.cost.miss);
  assert.ok(DIFF.easy.recover > DIFF.hard.recover);
  assert.equal(DIFF.hard.braceDanger, 0.6);
  assert.equal(DIFF.hard.bpmSprint, 114);
  // 기본(난이도를 안 주면)은 쉬움
  assert.equal(new Round({ seed: 1 }).difficulty, 'easy');
});

test('쉬움: 연타해도 콤보가 끊기지 않고 체력이 덜 깎임', () => {
  const mk = (d) => new Round({ seed: 7, difficulty: d, teams: { blue: [1, 2, 3], white: [4, 5, 6], size: 3, cpu: { blue: 0, white: 0 } } });
  const e = mk('easy');
  const n = mk('normal');
  for (const r of [e, n]) {
    const c = r.cycles[0];
    r.t = c.pullAt;
    r.pull('p1', c.pullAt, 1);
    r.pull('p1', c.pullAt + 0.05, 1);
  }
  assert.equal(e.parts.get('p1').combo, 1);
  assert.equal(n.parts.get('p1').combo, 0);
  assert.ok(e.parts.get('p1').stamina > n.parts.get('p1').stamina);
});
