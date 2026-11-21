// 줄다리기 판 시뮬레이션(순수 모듈: DOM·three 없음). 화면(game.js)과 단위 시험(scripts/test-tugofwar.mjs)이 같이 씁니다.
// 구성: 구령 박자표(박·휴식·막판 두 배 빠르기) → 당기기 판정(PERFECT/GOOD/EARLY·LATE/MISS) → 팀 힘 + 한 몸(싱크) 보너스
//       → 체력(헛손질로 소모, 쉬는 박에 회복) → 밧줄 위치(-1 백팀 승 … +1 청팀 승) → 승패(선 넘기 / 60초 시간 승) → 버티기(역전용).
// 모든 무작위는 seed 하나에서 나오므로 같은 입력이면 같은 결과입니다.

// ===== 조정 값(실폰·실제 플레이로 다듬을 곳) =====
export const CFG = {
  ROUND_SEC: 60, // 한 판 길이
  SPRINT_SEC: 10, // 막판 스퍼트(두 배 빠른 구령) 시간
  LEAD_IN: 2.2, // 첫 구령이 나오기 전 여유(초)
  BPM0: 80, // 시작 템포
  BPM1: 108, // 스퍼트 직전 템포
  BPM_SPRINT: 114,
  RESOLVE_AFTER: 0.5, // 당기는 박 뒤 이 시간이 지나면 그 박의 힘을 모아 계산(통신 지연 여유)
  SYNC_WIN: 0.09, // 이 간격 안에 모여 당기면 '한 몸'
  SYNC_BONUS: 0.6, // 팀원이 모두 한 몸일 때 힘에 더하는 비율(0.6 = ×1.6)
  ROPE_K: 0.15, // 힘 차이(팀원 수로 나눈 값)가 밧줄 위치(-1~1)를 움직이는 정도
  COST_PULL: 0.07, // 제때 당길 때 체력 소모
  COST_OFF: 0.03, // 타이밍이 어긋난 당김(EARLY/LATE)의 추가 소모
  COST_MISS: 0.1, // 아무 박에도 안 맞는 헛손질
  COST_SPAM: 0.14, // 한 박에 두 번 이상 · 너무 빨리 또 당김
  RECOVER_PER_SEC: 0.045, // 체력 회복(쉬는 시간 동안 계속)
  SPAM_GAP: 0.22, // 같은 사람이 이 간격 안에 또 당기면 헛손질
  BRACE_DANGER: 0.6, // 밧줄이 자기 쪽 선 이만큼(0~1) 가까이 오면 버티기 구령
  BRACE_COOL: 3, // 버티기 뒤 쉬는 구령 수
  BRACE_NEED: 0.6, // 팀원 중 이 비율이 가만히 버텨야 성공
  BRACE_CUT: 0.5, // 성공하면 상대의 그 박 힘을 이만큼 곱함
  TIE_RANGE: 0.02
};
export const DIFF = {
  easy: { win: { perfect: 0.1, good: 0.19, off: 0.3 }, cpu: 0.35 },
  normal: { win: { perfect: 0.075, good: 0.15, off: 0.26 }, cpu: 0.58 },
  hard: { win: { perfect: 0.055, good: 0.12, off: 0.22 }, cpu: 0.84 }
};
export const QUALITY = { perfect: 1, good: 0.75, off: 0.35, miss: 0 };
export const MAX_TEAM = 5;
export const MIN_TEAM = 3;

export function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const lerp = (a, b, t) => a + (b - a) * t;
export const otherTeam = (t) => (t === 'blue' ? 'white' : 'blue');

// ===== 팀 짜기 =====
// humans: [{slot, pref: 'blue'|'white'|'auto'}] → { blue:[slot..], white:[slot..], size, cpu:{blue:n, white:n} }
// 직접 고른 팀은 존중하되 한쪽이 MAX_TEAM 을 넘으면 넘친 사람은 자동으로 돌립니다. 자동은 사람이 적은 쪽으로,
// 비면 청팀부터. 사람이 모자란 쪽은 CPU 로 채워 두 팀 크기를 같게 합니다(최소 MIN_TEAM).
export function assignTeams(humans) {
  const blue = [];
  const white = [];
  const auto = [];
  for (const h of [...humans].sort((a, b) => a.slot - b.slot)) {
    if (h.pref === 'blue' && blue.length < MAX_TEAM) blue.push(h.slot);
    else if (h.pref === 'white' && white.length < MAX_TEAM) white.push(h.slot);
    else auto.push(h.slot);
  }
  for (const s of auto) {
    if (blue.length <= white.length) blue.push(s);
    else white.push(s);
  }
  const size = clamp(Math.max(MIN_TEAM, blue.length, white.length), MIN_TEAM, MAX_TEAM);
  return { blue, white, size, cpu: { blue: size - blue.length, white: size - white.length } };
}

function gauss(rng) {
  let u = 0, v = 0;
  while (!u) u = rng();
  while (!v) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function bpmAt(t, duration = CFG.ROUND_SEC) {
  const sprintAt = duration - CFG.SPRINT_SEC;
  if (t >= sprintAt) return CFG.BPM_SPRINT;
  return lerp(CFG.BPM0, CFG.BPM1, clamp(t / sprintAt, 0, 1));
}

export class Round {
  // opts: { seed, difficulty, teams: assignTeams 결과, names?: {slot: '1P'}, duration? }
  constructor(opts = {}) {
    this.seed = opts.seed ?? 1;
    this.rng = mulberry32(this.seed);
    this.difficulty = DIFF[opts.difficulty] ? opts.difficulty : 'normal';
    this.D = DIFF[this.difficulty];
    this.duration = opts.duration || CFG.ROUND_SEC;
    this.t = 0;
    this.rope = 0; // +1 청팀 승, -1 백팀 승
    this.phase = 'run';
    this.winner = null;
    this.reason = null;
    this.cycles = [];
    this.cpuQueue = []; // {t, id, power}
    this.events = [];
    this.parts = new Map();
    this.team = { blue: [], white: [] };
    this.size = opts.teams ? opts.teams.size : MIN_TEAM;
    this.cycleN = 0;
    this.braceCool = { blue: 0, white: 0 };
    this.syncStreak = { blue: 0, white: 0 };
    this.bestSync = { blue: 0, white: 0 };
    this.sprinted = false;
    this.lastForce = { blue: 0, white: 0 };
    this.lastSync = { blue: { k: 0, frac: 0, bonus: 1, body: false }, white: { k: 0, frac: 0, bonus: 1, body: false } };
    this.braceNow = null; // 지금 진행 중인 버티기 {team, cyc}
    const teams = opts.teams || { blue: [], white: [], cpu: { blue: MIN_TEAM, white: MIN_TEAM } };
    for (const team of ['blue', 'white']) {
      for (const slot of teams[team]) this.#add({ id: `p${slot}`, slot, team, cpu: false, name: (opts.names && opts.names[slot]) || `${slot}P` });
      for (let i = 0; i < teams.cpu[team]; i++) this.#add({ id: `c${team[0]}${i + 1}`, slot: null, team, cpu: true, name: `CPU${i + 1}` });
    }
    this.teamBias = { blue: gauss(this.rng) * 0.5, white: gauss(this.rng) * 0.5 };
    this.#spawnCycle(CFG.LEAD_IN);
  }

  #add(d) {
    const skill = d.cpu ? clamp(this.D.cpu + (this.rng() - 0.5) * 0.18, 0.1, 0.97) : 1;
    const p = { ...d, skill, stamina: 1, lastPull: -9, combo: 0, bestCombo: 0, pulls: 0, perfect: 0, good: 0, off: 0, miss: 0, spam: 0, powerSum: 0, lastJ: null };
    this.parts.set(p.id, p);
    this.team[d.team].push(p);
  }

  get members() { return [...this.parts.values()]; }
  get sprint() { return this.t >= this.duration - CFG.SPRINT_SEC; }
  teamStamina(team) {
    const a = this.team[team];
    return a.reduce((s, p) => s + p.stamina, 0) / Math.max(1, a.length);
  }

  // 다음 구령 한 묶음. 보통 4박(하나·둘·영차·쉼), 스퍼트에는 2박(하나·영차).
  #spawnCycle(start) {
    const sprint = start >= this.duration - CFG.SPRINT_SEC;
    const ivl = 60 / bpmAt(start, this.duration);
    const beats = sprint
      ? [{ t: start, kind: 'one' }, { t: start + ivl, kind: 'pull' }]
      : [{ t: start, kind: 'one' }, { t: start + ivl, kind: 'two' }, { t: start + 2 * ivl, kind: 'pull' }, { t: start + 3 * ivl, kind: 'rest' }];
    const cyc = {
      id: this.cycleN++, start, ivl, sprint, len: sprint ? 2 * ivl : 4 * ivl, beats,
      pullAt: beats.find((b) => b.kind === 'pull').t, pulls: [], bracers: new Set(), brace: null, resolved: false
    };
    cyc.end = start + cyc.len;
    for (const tm of ['blue', 'white']) if (this.braceCool[tm] > 0) this.braceCool[tm]--;
    // 버티기: 밧줄이 거의 졌을 만큼 자기 선에 몰린 팀이 있으면 이번 구령은 그 팀이 버티는 구령
    const danger = { blue: -this.rope, white: this.rope };
    const cand = ['blue', 'white'].filter((tm) => danger[tm] >= CFG.BRACE_DANGER && this.braceCool[tm] === 0 && !sprintLock(sprint, this.t, this.duration)).sort((a, b) => danger[b] - danger[a]);
    if (cand.length) {
      cyc.brace = cand[0];
      this.braceCool[cand[0]] = CFG.BRACE_COOL + 1;
    }
    // CPU 당김 예약(결정적: 만들 때 한 번에 뽑음)
    for (const p of this.members) {
      if (!p.cpu) continue;
      if (cyc.brace === p.team) continue;
      if (this.rng() < (1 - p.skill) * 0.16) continue; // 가끔 쉼
      const sd = lerp(0.12, 0.035, p.skill);
      const t = cyc.pullAt + this.teamBias[p.team] * sd + gauss(this.rng) * sd * 0.75 + (this.rng() - 0.5) * 0.02;
      this.cpuQueue.push({ t, id: p.id, power: clamp(0.55 + p.skill * 0.35 + (this.rng() - 0.5) * 0.18, 0.3, 1) });
    }
    this.cpuQueue.sort((a, b) => a.t - b.t);
    this.cycles.push(cyc);
    this.events.push({ type: 'cycle', cyc });
    return cyc;
  }

  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // 판정 하나. offset(초): 박보다 일찍(-)/늦게(+)
  judgeOffset(off) {
    const w = this.D.win;
    const a = Math.abs(off);
    if (a <= w.perfect) return 'perfect';
    if (a <= w.good) return 'good';
    if (a <= w.off) return 'off';
    return 'miss';
  }

  // tPull = 폰이 실제로 당겨진 시각(판 시계, 통신 지연 보정 뒤). power 0~1
  pull(id, tPull, power = 1) {
    const p = this.parts.get(id);
    if (!p || this.phase !== 'run') return null;
    power = clamp(Number(power) || 0, 0.15, 1);
    let cyc = null;
    for (const c of this.cycles.slice(-3)) if (!cyc || Math.abs(tPull - c.pullAt) < Math.abs(tPull - cyc.pullAt)) cyc = c;
    const off = cyc ? tPull - cyc.pullAt : 99;
    const out = { id, slot: p.slot, team: p.team, off, power, j: 'miss', counted: false, f: 0, spam: false, brace: false };
    p.pulls++;
    const gap = tPull - p.lastPull;
    p.lastPull = Math.max(p.lastPull, tPull);
    const dup = cyc && cyc.pulls.some((x) => x.id === id);
    if (gap < CFG.SPAM_GAP || dup) {
      out.spam = true;
      p.stamina = Math.max(0, p.stamina - CFG.COST_SPAM);
      p.spam++;
      p.combo = 0;
    } else if (!cyc || cyc.resolved || cyc.brace === p.team) {
      // 이미 정산된 박이거나 우리 팀이 버티는 박: 힘 없이 헛손질
      out.brace = !!(cyc && cyc.brace === p.team);
      p.stamina = Math.max(0, p.stamina - CFG.COST_MISS * 0.6);
      p.miss++;
      p.combo = 0;
    } else {
      const j = this.judgeOffset(off);
      out.j = j;
      if (j === 'miss') {
        p.stamina = Math.max(0, p.stamina - CFG.COST_MISS);
        p.miss++;
        p.combo = 0;
      } else {
        out.counted = true;
        out.f = power * QUALITY[j] * (0.45 + 0.55 * p.stamina);
        p.stamina = Math.max(0, p.stamina - CFG.COST_PULL - (j === 'off' ? CFG.COST_OFF : 0));
        p[j]++;
        p.powerSum += power;
        p.combo = j === 'off' ? 0 : p.combo + 1;
        p.bestCombo = Math.max(p.bestCombo, p.combo);
        cyc.pulls.push({ id, team: p.team, off, j, f: out.f, power });
      }
    }
    p.lastJ = out.spam ? 'miss' : out.j;
    out.combo = p.combo;
    out.stamina = p.stamina;
    this.events.push({ type: 'judge', ...out });
    return out;
  }

  // 버티기: 폰이 구령 동안 가만히 버텼다고 알려 옴
  brace(id) {
    const p = this.parts.get(id);
    const cyc = this.cycles[this.cycles.length - 1];
    const c = [...this.cycles].reverse().find((x) => x.brace && !x.resolved);
    if (!p || !c || c.brace !== p.team) return false;
    c.bracers.add(id);
    return true;
  }

  #syncOf(pulls, size) {
    if (!pulls.length) return { k: 0, frac: 0, bonus: 1, body: false };
    const offs = pulls.map((x) => x.off).sort((a, b) => a - b);
    let k = 1;
    for (let i = 0; i < offs.length; i++) {
      let j = i;
      while (j + 1 < offs.length && offs[j + 1] - offs[i] <= CFG.SYNC_WIN) j++;
      k = Math.max(k, j - i + 1);
    }
    const frac = k / size;
    const bonus = k >= 2 ? 1 + CFG.SYNC_BONUS * frac * frac : 1;
    return { k, frac, bonus, body: k >= Math.max(2, Math.ceil(size * 0.75)) };
  }

  #resolve(cyc) {
    cyc.resolved = true;
    const F = { blue: 0, white: 0 };
    const sync = {};
    for (const tm of ['blue', 'white']) {
      const pulls = cyc.pulls.filter((x) => x.team === tm);
      sync[tm] = this.#syncOf(pulls, this.size);
      F[tm] = pulls.reduce((s, x) => s + x.f, 0) * sync[tm].bonus;
      if (cyc.brace !== tm) {
        if (sync[tm].body) {
          this.syncStreak[tm]++;
          this.bestSync[tm] = Math.max(this.bestSync[tm], this.syncStreak[tm]);
        } else this.syncStreak[tm] = 0;
      }
    }
    let brace = null;
    if (cyc.brace) {
      const tm = cyc.brace;
      let ok = 0;
      for (const p of this.team[tm]) {
        if (p.cpu ? this.rng() < 0.45 + p.skill * 0.5 : cyc.bracers.has(p.id)) ok++;
        p.stamina = Math.min(1, p.stamina + 0.12); // 버티는 동안 숨 고르기
      }
      const success = ok >= Math.ceil(this.size * CFG.BRACE_NEED);
      brace = { team: tm, ok, success };
      if (success) F[otherTeam(tm)] *= CFG.BRACE_CUT;
    }
    const d = ((F.blue - F.white) / this.size) * CFG.ROPE_K;
    this.rope = clamp(this.rope + d, -1, 1);
    this.lastForce = F;
    this.lastSync = sync;
    this.events.push({ type: 'resolve', cyc: cyc.id, F, sync, brace, d, rope: this.rope });
    if (this.rope >= 1 || this.rope <= -1) this.#finish(this.rope >= 1 ? 'blue' : 'white', 'line');
  }

  #finish(winner, reason) {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.winner = winner;
    this.reason = reason;
    this.events.push({ type: 'end', winner, reason, rope: this.rope });
  }

  tick(dt) {
    if (this.phase !== 'run') return;
    this.t += dt;
    // 스퍼트 진입 알림
    if (!this.sprinted && this.sprint) {
      this.sprinted = true;
      this.events.push({ type: 'sprint' });
    }
    // CPU 당김
    while (this.cpuQueue.length && this.cpuQueue[0].t <= this.t) {
      const q = this.cpuQueue.shift();
      this.pull(q.id, q.t, q.power);
    }
    // 체력 회복(당기는 순간에는 소모가 크므로 계속 조금씩)
    for (const p of this.parts.values()) p.stamina = Math.min(1, p.stamina + CFG.RECOVER_PER_SEC * dt);
    // 정산
    for (const c of this.cycles) if (!c.resolved && this.t >= c.pullAt + CFG.RESOLVE_AFTER) this.#resolve(c);
    if (this.phase !== 'run') return;
    // 다음 구령 미리 만들기(화면이 박보다 앞서 폰에 알릴 수 있게)
    const last = this.cycles[this.cycles.length - 1];
    if (this.t < this.duration - 0.2 && this.t >= last.end - 0.7 && last.end < this.duration) this.#spawnCycle(last.end);
    // 시간 종료: 남은 박을 정산한 뒤 앞선 쪽이 이김
    if (this.t >= this.duration && this.cycles.every((c) => c.resolved || c.pullAt > this.duration)) {
      for (const c of this.cycles) if (!c.resolved) this.#resolve(c);
      if (this.phase === 'run') this.#timeWin();
    }
  }

  #timeWin() {
    if (Math.abs(this.rope) > CFG.TIE_RANGE) return this.#finish(this.rope > 0 ? 'blue' : 'white', 'time');
    const pf = (tm) => this.team[tm].reduce((s, p) => s + p.perfect, 0);
    if (pf('blue') !== pf('white')) return this.#finish(pf('blue') > pf('white') ? 'blue' : 'white', 'time');
    this.#finish(this.rng() < 0.5 ? 'blue' : 'white', 'time');
  }

  // 지금부터 horizon 초 안에 올 박들(화면의 박자 띠·폰 알림용)
  upcoming(horizon = 3, from = this.t - 0.4) {
    const out = [];
    for (const c of this.cycles) for (const b of c.beats) if (b.t >= from && b.t <= this.t + horizon) out.push({ ...b, cyc: c.id, brace: c.brace, sprint: c.sprint });
    return out;
  }
  teamStats(team) {
    const a = this.team[team];
    const sum = (k) => a.reduce((s, p) => s + p[k], 0);
    return { perfect: sum('perfect'), good: sum('good'), off: sum('off'), miss: sum('miss'), spam: sum('spam'), pulls: sum('pulls'), bestSync: this.bestSync[team] };
  }
}

function sprintLock(sprint, t, duration) {
  return sprint && t > duration - 3;
}

// ===== 한 경기(3판 2선승) =====
export class Match {
  constructor(opts = {}) {
    this.target = opts.target || 2;
    this.round = 1;
    this.wins = { blue: 0, white: 0 };
    this.history = [];
    this.winner = null;
  }
  // 청팀은 홀수 판에 왼쪽, 짝수 판에 오른쪽(판마다 자리를 바꿈)
  sideOf(team, round = this.round) {
    const blueLeft = round % 2 === 1;
    return (team === 'blue') === blueLeft ? 'left' : 'right';
  }
  endRound(winner, info = {}) {
    this.wins[winner]++;
    this.history.push({ round: this.round, winner, ...info });
    if (this.wins[winner] >= this.target) this.winner = winner;
    else this.round++;
    return { done: !!this.winner, winner: this.winner };
  }
}
