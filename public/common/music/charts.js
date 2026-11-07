// 리듬 게임 채보(노트 배치)를 곡 데이터에서 만들어 냅니다. 같은 입력이면 언제나 같은 채보가 나옵니다(결정적).
// genChart(song, { difficulty: 'easy'|'normal'|'hard', lanes: 4|5, input: 'pad'|'motion' })
//   쉬움: 정박 4분음표 위주로 드문드문 / 보통: 8분음표 + 가끔 동시 누르기 / 어려움: 16분음표, 동시 누르기, 길게 누르기.
//   모션 입력(폰을 흔드는 방식)은 훨씬 성기게: 쉬움은 노트 사이 0.75초 이상, 동시 누르기 없음, 길게 누르기는 어려움에서만.
//   레인은 선율 높낮이를 따라갑니다(음이 올라가면 오른쪽, 내려가면 왼쪽) — 4레인은 ← ↓ ↑ →, 5레인은 ↙ ↖ ● ↗ ↘ 순서.
// 다른 파일을 불러오지 않습니다(songs.js 형식의 곡 객체만 있으면 됩니다).

export const CHART_LIMITS = {
  pad: {
    easy: { grid: 1, gapBeat: 1, gapSec: 0.42, win2s: 5, jumpRate: 0, holds: false },
    normal: { grid: 0.5, gapBeat: 0.5, gapSec: 0.2, win2s: 10, jumpRate: 0.07, holds: false },
    hard: { grid: 0.25, gapBeat: 0.25, gapSec: 0.11, win2s: 17, jumpRate: 0.12, holds: true },
  },
  motion: {
    easy: { grid: 1, gapBeat: 1, gapSec: 0.75, win2s: 3, jumpRate: 0, holds: false },
    normal: { grid: 0.5, gapBeat: 0.5, gapSec: 0.5, win2s: 4, jumpRate: 0, holds: false },
    hard: { grid: 0.5, gapBeat: 0.5, gapSec: 0.36, win2s: 6, jumpRate: 0, holds: true },
  },
};
// 별 개수: [기준 별, 기준 초당 노트, 기울기, 최소, 최대]
const STARS = {
  pad: { easy: [1, 0.6, 2, 1, 4], normal: [3, 1.2, 1.4, 3, 7], hard: [6, 2, 1.2, 6, 10] },
  motion: { easy: [1, 0.5, 2.5, 1, 3], normal: [2, 0.6, 2, 2, 5], hard: [4, 0.8, 2, 4, 7] },
};
export const LANE_NAMES = { 4: ['←', '↓', '↑', '→'], 5: ['↙', '↖', '●', '↗', '↘'] };
const EPS = 1e-6;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function beatToSec(song, beat) {
  const T = song.tempos && song.tempos.length ? song.tempos : [[0, song.bpm]];
  let sec = 0;
  for (let i = 0; i < T.length; i++) {
    const a = T[i][0], b = i + 1 < T.length ? T[i + 1][0] : Infinity;
    if (beat <= a) break;
    sec += ((Math.min(beat, b) - a) * 60) / T[i][1];
  }
  return sec;
}

// 길게 누르기 후보: 패드는 1.5박 이상, 모션은 2박 이상인 선율 음 중 절반(박 위치로 결정)
function holdable(L, input, beat, dur) {
  if (!L.holds) return false;
  if (input === 'motion') return dur >= 2 && Math.round(beat * 2) % 4 === 0;
  return dur >= 1.5;
}

function candidates(song, L, input) {
  const barLen = song.barLen || 4;
  const mel = song.parts.melody;
  const out = new Map();
  const add = (beat, c) => {
    const q = Math.round(beat / L.grid) * L.grid;
    const key = q.toFixed(4);
    const prev = out.get(key);
    if (!prev || c.prio > prev.prio) out.set(key, { ...c, beat: q });
  };
  const posPrio = (beat) => {
    const pos = ((beat % barLen) + barLen) % barLen;
    if (pos < EPS) return 5;
    if (barLen === 4 && Math.abs(pos - 2) < EPS) return 4;
    if (Math.abs(pos - Math.round(pos)) < EPS) return 3;
    if (Math.abs(pos * 2 - Math.round(pos * 2)) < EPS) return 2;
    return 1;
  };
  for (let i = 0; i < mel.length; i++) {
    const [b, d, m] = mel[i];
    const prevM = i ? mel[i - 1][2] : m;
    let prio = posPrio(b) + 1;
    if (d >= 1) prio += 0.5;
    if (Math.abs(m - prevM) >= 5) prio += 0.5;
    add(b, { prio, midi: m, dur: d, src: 'melody' });
  }
  // 선율이 오래 쉬거나 길게 끄는 곳은 북 박자로 채웁니다(낮은 우선순위). 어려울수록 촘촘히 채웁니다.
  // 어려움의 긴 음(길게 누르기 후보) 안쪽은 비워 둡니다.
  const melStarts = mel.map((n) => n[0]);
  const fillAfter = L.grid >= 1 ? 2 : L.grid >= 0.5 ? 1.5 : 0.5;
  const holdZones = mel.filter((n) => holdable(L, input, n[0], n[1])).map((n) => [n[0], n[0] + n[1]]);
  const inHold = (b) => holdZones.some(([a, z]) => b > a + EPS && b < z - EPS);
  const fillNotes = new Set(L.grid < 0.5 ? [36, 38, 42] : [36, 38]);
  let j = 0;
  for (const [b, , m] of song.parts.drums) {
    if (!fillNotes.has(m) || inHold(b)) continue;
    while (j < melStarts.length && melStarts[j] <= b + EPS) j++;
    const lastMel = j ? melStarts[j - 1] : -Infinity;
    const nextMel = j < melStarts.length ? melStarts[j] : Infinity;
    if (b - lastMel >= fillAfter - EPS && nextMel - b >= L.grid - EPS) add(b, { prio: posPrio(b) - (m === 42 ? 2.5 : 1.5), midi: null, dur: 0, src: 'drum' });
  }
  return [...out.values()].filter((c) => c.beat < song.beats - EPS);
}

function fits(acc, c, L) {
  // acc: 박 순서 정렬. 앞뒤 간격과 2초 창 밀도를 검사합니다.
  let lo = 0, hi = acc.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (acc[mid].t < c.t) lo = mid + 1; else hi = mid; }
  const prev = acc[lo - 1], next = acc[lo];
  const ok = (o) => !o || (Math.abs(o.t - c.t) >= L.gapSec - EPS && Math.abs(o.beat - c.beat) >= L.gapBeat - EPS);
  if (!ok(prev) || !ok(next)) return -1;
  const near = [];
  for (let i = lo - 1; i >= 0 && acc[i].t > c.t - 2; i--) near.push(acc[i].t);
  for (let i = lo; i < acc.length && acc[i].t < c.t + 2; i++) near.push(acc[i].t);
  near.push(c.t);
  near.sort((a, b) => a - b);
  for (const s of near) {
    if (s > c.t + EPS || s <= c.t - 2) continue;
    let n = 0;
    for (const x of near) if (x >= s - EPS && x < s + 2 - EPS) n++;
    if (n > L.win2s) return -1;
  }
  return lo;
}

/** 채보 만들기. 결과의 notes 는 시간 순서이고 동시 누르기는 같은 beat 에 두 개가 들어 있습니다. */
export function genChart(song, { difficulty = 'normal', lanes = 4, input = 'pad' } = {}) {
  const L = (CHART_LIMITS[input] || CHART_LIMITS.pad)[difficulty] || CHART_LIMITS.pad.normal;
  const nL = lanes === 5 ? 5 : 4;
  const R = rng(hash(`${song.id}|${difficulty}|${nL}|${input}`));
  const cands = candidates(song, L, input).map((c) => ({ ...c, t: beatToSec(song, c.beat) }));
  cands.sort((a, b) => b.prio - a.prio || a.beat - b.beat);
  const acc = [];
  for (const c of cands) {
    const at = fits(acc, c, L);
    if (at >= 0) acc.splice(at, 0, c);
  }

  // 레인: 선율 윤곽을 따라 움직이되 한 자리에 너무 오래 머물지 않게 합니다.
  const notes = [];
  let lane = nL === 5 ? 2 : R() < 0.5 ? 1 : 2;
  let lastMidi = null, same = 0;
  const maxSame = input === 'motion' ? 2 : difficulty === 'hard' ? 2 : 3;
  for (let i = 0; i < acc.length; i++) {
    const c = acc[i];
    const m = c.midi ?? lastMidi;
    let next = lane;
    if (i > 0 && m != null && lastMidi != null) {
      const iv = m - lastMidi;
      const step = Math.abs(iv) >= 5 ? 2 : 1;
      if (iv > 0) next = lane + step;
      else if (iv < 0) next = lane - step;
      else if (difficulty === 'hard' && input === 'pad' && c.t - acc[i - 1].t < 0.3) next = lane + (lane < (nL - 1) / 2 ? 1 : -1);
      if (next > nL - 1) next = Math.max(0, lane - step);
      if (next < 0) next = Math.min(nL - 1, lane + step);
    } else if (i > 0 && c.src === 'drum') next = lane + (R() < 0.5 ? 1 : -1);
    next = Math.max(0, Math.min(nL - 1, next));
    if (next === lane && i > 0) { same++; if (same >= maxSame) { next = lane + (lane >= nL / 2 ? -1 : 1); same = 0; } }
    else same = 0;
    lane = Math.max(0, Math.min(nL - 1, next));
    if (c.midi != null) lastMidi = c.midi;
    notes.push({ beat: c.beat, t: c.t, lane, len: 0, lenSec: 0, jump: false, src: c.src });
  }

  // 길게 누르기(어려움): 긴 선율 음이고 다음 노트까지 여유가 있을 때만.
  if (L.holds) {
    for (let i = 0; i < notes.length; i++) {
      const c = acc[i];
      if (c.src !== 'melody' || !holdable(L, input, c.beat, c.dur)) continue;
      const nextBeat = i + 1 < notes.length ? notes[i + 1].beat : song.beats;
      const end = Math.min(c.beat + c.dur, nextBeat) - 0.25;
      const len = end - c.beat;
      const sec = beatToSec(song, end) - notes[i].t;
      if (len >= (input === 'motion' ? 1.5 : 1) && sec >= (input === 'motion' ? 1 : 0.55)) {
        notes[i].len = Math.round(len * 1000) / 1000;
        notes[i].lenSec = Math.round(sec * 1000) / 1000;
      }
    }
  }

  // 동시 누르기(패드 보통·어려움): 마디 첫 박 같은 센 자리에서 가끔.
  const out = [];
  let jumps = 0;
  const jumpGap = Math.max(0.36, L.gapSec * 2);
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    out.push(n);
    if (!L.jumpRate || n.len) continue;
    const strong = acc[i].prio >= 5;
    const pg = i ? n.t - notes[i - 1].t : Infinity;
    const ng = i + 1 < notes.length ? notes[i + 1].t - n.t : Infinity;
    if (!strong || pg < jumpGap || ng < jumpGap) continue;
    if (jumps >= Math.ceil(notes.length * L.jumpRate)) continue;
    if (R() > L.jumpRate * 3.2) continue;
    let partner = nL - 1 - n.lane;
    if (partner === n.lane) partner = R() < 0.5 ? 0 : nL - 1;
    n.jump = true;
    out.push({ ...n, lane: partner, jump: true });
    jumps++;
  }
  out.sort((a, b) => a.t - b.t || a.lane - b.lane);

  const lengthSec = song.lengthSec || beatToSec(song, song.beats);
  const first = out.length ? out[0].t : 0, last = out.length ? out[out.length - 1].t : 0;
  const span = Math.max(10, last - first);
  const taps = new Set(out.map((n) => n.t.toFixed(4))).size;
  const nps = taps / span;
  let maxNps = 0;
  for (let i = 0, j = 0; i < out.length; i++) {
    while (out[j].t < out[i].t - 2 + EPS) j++;
    maxNps = Math.max(maxNps, (i - j + 1) / 2);
  }
  const holds = out.filter((n) => n.len > 0).length;
  const [sb, ref, k, lo, hi] = STARS[input === 'motion' ? 'motion' : 'pad'][difficulty] || STARS.pad.normal;
  const stars = Math.max(lo, Math.min(hi, Math.round(sb + (nps - ref) * k + (jumps / Math.max(1, taps)) * 6 + (holds ? 0.3 : 0))));
  return {
    songId: song.id, difficulty, lanes: nL, input, notes: out, count: out.length, taps, jumps, holds,
    nps: Math.round(nps * 100) / 100, maxNps, stars, lengthSec, bpm: song.bpm,
  };
}

const infoCache = new Map();
/** 고르기 화면용 요약 { stars, count } (캐시됨) */
export function chartInfo(song, difficulty, opts = {}) {
  const key = `${song.id}|${difficulty}|${opts.lanes || 4}|${opts.input || 'pad'}`;
  if (!infoCache.has(key)) {
    const c = genChart(song, { ...opts, difficulty });
    infoCache.set(key, { stars: c.stars, count: c.count });
  }
  return infoCache.get(key);
}
