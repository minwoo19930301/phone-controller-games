// 리듬 스텝 판정(큰 화면). 화면·소리와 상관없는 순수 계산이라 node 에서도 시험합니다.
// 한 사람 몫의 채보를 받아, 누른 시각(곡 시간, 초)을 노트에 맞춰 PERFECT/GREAT/GOOD/MISS 를 냅니다.
// 길게 누르기(어려움)는 머리를 맞힌 뒤 끝까지 누르고 있으면 OK, 일찍 떼면 NG 입니다.
// 모션 입력은 폰을 움직이는 데 시간이 걸려 판정 폭이 더 넓고, 쉬움·보통에서는 방향이 틀려도 박자가 맞으면 GOOD 까지 줍니다.
// 사람마다 손이 늘 조금 빠르거나 늦으면(폰 지연·습관) 최근 판정의 중앙값으로 기준을 천천히 옮깁니다(자동 싱크).

/** 판정 폭(±초): [PERFECT, GREAT, GOOD]. 어려움이 가장 빡빡합니다. */
export const WINDOWS = {
  pad: { easy: [0.07, 0.125, 0.19], normal: [0.05, 0.095, 0.15], hard: [0.035, 0.07, 0.11] },
  motion: { easy: [0.1, 0.175, 0.27], normal: [0.075, 0.135, 0.21], hard: [0.055, 0.1, 0.16] }
};
export const JUDGES = ['perfect', 'great', 'good', 'miss'];
export const JUDGE_LABEL = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS', ok: 'OK', ng: 'NG' };
const VALUE = { perfect: 1, great: 0.7, good: 0.4, miss: 0 };
// 체력: 맞히면 조금씩 차고 놓치면 깎입니다. 0 이 되어도 끝까지 하지만 '클리어 실패' 로 남습니다.
const LIFE_GAIN = { perfect: 0.014, great: 0.009, good: 0.002 };
const LIFE_MISS = { easy: 0.035, normal: 0.06, hard: 0.09 };
const LIFE_NG = 0.04;
const RELEASE_TOL = { easy: 0.3, normal: 0.2, hard: 0.13 }; // 길게 누르기 끝을 이만큼 일찍 떼도 OK
const AUTO_SYNC_MAX = { pad: 0.07, motion: 0.13 }; // 자동 싱크로 옮기는 최대 폭(초)

/** 정확도(0~1) → 등급 */
export function gradeOf(acc) {
  if (acc >= 0.93) return 'S';
  if (acc >= 0.83) return 'A';
  if (acc >= 0.68) return 'B';
  return 'C';
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 한 사람 판정기.
 * opts: { notes: genChart(...).notes, difficulty, input: 'pad'|'motion', lanes, autoSync = true }
 * 시각은 모두 곡 시간(초). 반환 이벤트: { kind: 'judge'|'hold', j, lane, err, note, early, late, wrongLane }
 */
export function createJudge(opts = {}) {
  const difficulty = opts.difficulty || 'normal';
  const input = opts.input === 'motion' ? 'motion' : 'pad';
  const lanes = opts.lanes === 5 ? 5 : 4;
  const win = WINDOWS[input][difficulty] || WINDOWS[input].normal;
  const notes = (opts.notes || []).map((n, i) => ({
    ...n, i, done: false, j: null, err: 0,
    hold: n.lenSec > 0 ? { state: 'wait', end: n.t + n.lenSec, auto: input === 'motion' } : null
  }));
  const byLane = Array.from({ length: lanes }, () => []);
  for (const n of notes) if (byLane[n.lane]) byLane[n.lane].push(n);
  const cursor = new Array(lanes).fill(0); // 레인마다 아직 판정 안 한 첫 노트
  let missCursor = 0;
  const holds = notes.filter((n) => n.hold);
  const total = notes.length + holds.length;
  const counts = { perfect: 0, great: 0, good: 0, miss: 0, ok: 0, ng: 0 };
  const st = {
    difficulty, input, lanes, notes, total, counts,
    combo: 0, maxCombo: 0, points: 0, life: 0.6, failed: false,
    offset: 0, errs: [], early: 0, late: 0, steps: 0, judged: 0
  };
  const autoSync = opts.autoSync !== false;
  // 방향을 봐주는 정도: 쉬움 모션은 아무 방향이나, 보통 모션은 같은 축(위↔아래, 왼↔오른)의 반대 방향까지
  const assist = input === 'motion' ? (difficulty === 'easy' ? 'any' : difficulty === 'normal' ? 'axis' : null) : null;
  const axisMate = (lane) => ({ 0: 3, 3: 0, 1: 2, 2: 1 })[lane];

  function addLife(d) {
    st.life = Math.max(0, Math.min(1, st.life + d));
    if (st.life <= 0) st.failed = true;
  }
  function score() { return Math.round((st.points / Math.max(1, total)) * 1000000); }
  function acc() { return st.points / Math.max(1, total); }

  function rate(n, err, wrongLane) {
    const a = Math.abs(err);
    let j = a <= win[0] ? 'perfect' : a <= win[1] ? 'great' : 'good';
    if (wrongLane && j !== 'good') j = 'good';
    n.done = true;
    n.j = j;
    n.err = err;
    counts[j] += 1;
    st.points += VALUE[j];
    st.combo += 1;
    st.maxCombo = Math.max(st.maxCombo, st.combo);
    st.judged += 1;
    addLife(LIFE_GAIN[j]);
    if (j !== 'perfect') { if (err < 0) st.early += 1; else st.late += 1; }
    if (n.hold) n.hold.state = 'held';
    // 자동 싱크: 맞힌 것들의 원래 오차(기준 이동 전)를 모아 중앙값 쪽으로 천천히
    if (autoSync && !wrongLane) {
      st.errs.push(err + st.offset);
      if (st.errs.length > 16) st.errs.shift();
      if (st.errs.length >= 8) {
        const lim = AUTO_SYNC_MAX[input];
        const target = Math.max(-lim, Math.min(lim, median(st.errs)));
        st.offset += (target - st.offset) * 0.25;
      }
    }
    return { kind: 'judge', j, lane: n.lane, err, note: n, early: err < 0, wrongLane: Boolean(wrongLane) };
  }

  function missNote(n) {
    n.done = true;
    n.j = 'miss';
    counts.miss += 1;
    st.combo = 0;
    st.judged += 1;
    addLife(-(LIFE_MISS[difficulty] ?? LIFE_MISS.normal));
    if (n.hold) {
      n.hold.state = 'ng';
      counts.ng += 1;
    }
    return { kind: 'judge', j: 'miss', lane: n.lane, err: 0, note: n };
  }

  // 그 레인에서 판정 폭 안에 있는, 아직 안 친 노트 중 가장 가까운 것
  function nearest(lane, t) {
    const L = byLane[lane];
    if (!L) return null;
    let best = null;
    for (let k = cursor[lane]; k < L.length; k++) {
      const n = L[k];
      const e = t - n.t;
      if (e < -win[2]) break;
      if (n.done) continue;
      if (Math.abs(e) <= win[2] && (!best || Math.abs(e) < Math.abs(t - best.t))) best = n;
    }
    return best;
  }
  function advance(lane) {
    const L = byLane[lane];
    while (cursor[lane] < L.length && L[cursor[lane]].done) cursor[lane] += 1;
  }

  /** 누름. t = 곡 시간(초). 판정 이벤트 또는 null(헛누름) */
  function step(lane, t) {
    st.steps += 1;
    const tt = t - st.offset;
    let n = nearest(lane, tt);
    let wrong = false;
    if (!n && assist) {
      const cands = assist === 'any' ? [...Array(lanes).keys()].filter((l) => l !== lane) : [axisMate(lane)];
      let best = null;
      for (const l of cands) {
        const c = nearest(l, tt);
        if (c && (!best || Math.abs(tt - c.t) < Math.abs(tt - best.t))) best = c;
      }
      if (best) { n = best; wrong = true; }
    }
    if (!n) return null;
    const ev = rate(n, tt - n.t, wrong);
    advance(n.lane);
    return ev;
  }

  /** 뗌(길게 누르기 끝) */
  function release(lane, t) {
    const tt = t - st.offset;
    const out = [];
    for (const n of holds) {
      if (n.lane !== lane || n.hold.state !== 'held' || n.hold.auto || n.t > tt + 0.05) continue;
      if (tt < n.hold.end - (RELEASE_TOL[difficulty] ?? 0.2)) {
        n.hold.state = 'ng';
        counts.ng += 1;
        addLife(-LIFE_NG);
        out.push({ kind: 'hold', j: 'ng', lane, note: n });
      } else {
        n.hold.state = 'ok';
        counts.ok += 1;
        st.points += 1;
        out.push({ kind: 'hold', j: 'ok', lane, note: n });
      }
    }
    return out;
  }

  /** 시간이 흐를 때마다: 지나간 노트는 MISS, 끝난 길게 누르기는 OK */
  function update(t) {
    const tt = t - st.offset;
    const out = [];
    while (missCursor < notes.length && notes[missCursor].t < tt - win[2] - 0.001) {
      const n = notes[missCursor++];
      if (!n.done) out.push(missNote(n));
    }
    for (let l = 0; l < lanes; l++) advance(l);
    for (const n of holds) {
      if (n.hold.state === 'held' && tt >= n.hold.end) {
        n.hold.state = 'ok';
        counts.ok += 1;
        st.points += 1;
        out.push({ kind: 'hold', j: 'ok', lane: n.lane, note: n });
      }
    }
    return out;
  }

  /** 길게 누르는 중인 레인들(그림용) */
  function heldLanes() {
    const s = new Set();
    for (const n of holds) if (n.hold.state === 'held') s.add(n.lane);
    return s;
  }

  function summary() {
    const a = acc();
    return {
      score: score(), acc: a, grade: gradeOf(a), maxCombo: st.maxCombo, counts: { ...counts },
      fullCombo: counts.miss === 0 && counts.ng === 0 && st.judged >= notes.length && notes.length > 0,
      perfectAll: counts.miss === 0 && counts.ng === 0 && counts.great === 0 && counts.good === 0 && notes.length > 0 && st.judged >= notes.length,
      failed: st.failed, early: st.early, late: st.late, offsetMs: Math.round(st.offset * 1000), total, notes: notes.length
    };
  }

  return {
    st, notes, win, step, release, update, heldLanes, summary,
    get score() { return score(); },
    get acc() { return acc(); },
    get done() { return st.judged >= notes.length && !holds.some((n) => n.hold.state === 'held'); }
  };
}
