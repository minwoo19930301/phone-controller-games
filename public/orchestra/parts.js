// 오케스트라 공용 모듈: 악기 정의, 곡에서 악기별 악보 만들기(난이도별로 줄이기), 판정 창, 밸브·현 표기, 아이콘.
// 큰 화면(/orchestra/)과 폰(/play/orchestra/)이 똑같이 씁니다. DOM 을 쓰지 않습니다.
//
// 악보 음 하나: { i, b(박), d(길이 박), m(midi), v(세기), fill: [[박차, 길이, midi, 세기], ...], ... }
//  - 쉬움·보통은 빠른 음을 묶어 '앞 음'의 fill 로 넣습니다. 화면에는 남은 음만 보이고, 소리는 fill 까지 이어서 냅니다
//    (관·현·성악은 부는/긋는/부르는 동안 음높이가 저절로 따라가고, 피아노는 한 번 누르면 묶인 음까지 이어서 칩니다).
//  - 트럼펫·호른: valves(1=1번, 2=2번, 4=3번 밸브의 합), 바이올린: str(0=G 1=D 2=A 3=E), 캐스터네츠: roll, 지휘: dir·n.
import { bpmAt, chordAt } from '/common/music/songs.js';

export const INSTRUMENTS = {
  conductor: { key: 'conductor', label: '지휘자', part: null, synth: null, kind: 'baton', role: '빠르기·셈여림', how: '폰을 지휘봉처럼 쥐고 박자를 저어요', motion: true },
  violin: { key: 'violin', label: '바이올린', part: 'melody', synth: 'violin', kind: 'bow', role: '선율', how: '옆으로 들고 화면을 활처럼 문질러요' },
  piano: { key: 'piano', label: '피아노', part: 'melody', synth: 'piano', kind: 'keys', role: '선율', how: '진짜 건반을 눌러요' },
  voice: { key: 'voice', label: '성악가', part: 'melody', synth: 'choir', kind: 'voice', role: '선율', how: '마이크에 진짜로 노래해요. 음정은 도와줘요', mic: true },
  trumpet: { key: 'trumpet', label: '트럼펫', part: 'melody', synth: 'trumpet', kind: 'wind', role: '선율', how: '마이크에 후 불면서 밸브를 눌러요', mic: true },
  horn: { key: 'horn', label: '호른', part: 'harmony', synth: 'horn', kind: 'wind', role: '화음', how: '트럼펫처럼 불어요. 둘째 성부를 맡아요', mic: true },
  drum: { key: 'drum', label: '드럼', part: 'drums', synth: 'drums', kind: 'strike', role: '리듬', how: '막대기처럼 쥐고 아래로 톡 쳐요', motion: true },
  castanets: { key: 'castanets', label: '캐스터네츠', part: 'perc', synth: 'castanets', kind: 'tap', role: '장단', how: '화면을 톡톡 두드려요' },
};
export const INST_ORDER = ['conductor', 'violin', 'piano', 'voice', 'trumpet', 'horn', 'drum', 'castanets'];
export const SUSTAIN_KINDS = ['wind', 'bow', 'voice'];
export const isSustain = (inst) => INSTRUMENTS[inst] && SUSTAIN_KINDS.includes(INSTRUMENTS[inst].kind);

export const DIFFS = ['easy', 'normal', 'hard'];
export const DIFF_LABEL = { easy: '쉬움', normal: '보통', hard: '어려움' };
const pickD = (diff, t) => (diff in t ? t[diff] : t.normal);

// ───────── 판정 창(초): [PERFECT, GOOD] ─────────
// 지금까지 다른 종목이 '어렵다'는 말을 들어서 보통도 넉넉하게 둡니다. 어려움이 원래 리듬 게임 수준입니다.
const WIN = {
  tap: { easy: [0.1, 0.22], normal: [0.07, 0.15], hard: [0.045, 0.1] },
  sustain: { easy: [0.16, 0.34], normal: [0.11, 0.24], hard: [0.075, 0.16] },
  baton: { easy: [0.17, 0.36], normal: [0.12, 0.26], hard: [0.085, 0.18] },
};
export function windowFor(inst, diff) {
  const k = INSTRUMENTS[inst] ? INSTRUMENTS[inst].kind : 'tap';
  const t = k === 'baton' ? WIN.baton : SUSTAIN_KINDS.includes(k) ? WIN.sustain : WIN.tap;
  return pickD(diff, t);
}
/** 성악가 음정 허용 폭(반음, 옥타브는 따지지 않음) */
export const PITCH_TOL = { easy: 3, normal: 1.6, hard: 0.85 };
/** 성악가 보정 세기(1 = 목표 음으로 완전히 맞춤) */
export const VOICE_FIX = { easy: 1, normal: 0.75, hard: 0.45 };
/** 점수: PERFECT 1, GOOD 0.6, MISS 0 */
export const POINTS = { perfect: 1, good: 0.6, miss: 0 };
export const JUDGE_LABEL = { perfect: 'PERFECT', good: 'GOOD', miss: 'MISS' };

export function gradeOf(acc) {
  if (acc >= 0.92) return 'S';
  if (acc >= 0.8) return 'A';
  if (acc >= 0.65) return 'B';
  if (acc >= 0.45) return 'C';
  return 'D';
}
export const GRADE_WORD = { S: '기립 박수', A: '앙코르!', B: '멋진 합주', C: '조금 더 맞춰 봐요', D: '다음엔 더 잘할 거예요' };

// ───────── 트럼펫·호른 밸브(실제 C 트럼펫 운지) ─────────
// 1번 밸브 = 1, 2번 = 2, 3번 = 4. 0 은 개방(아무것도 안 누름).
const VALVE_CHART = {
  54: 7, 55: 5, 56: 6, 57: 3, 58: 1, 59: 2, 60: 0, 61: 7, 62: 5, 63: 6, 64: 3, 65: 1, 66: 2, 67: 0, 68: 6, 69: 3, 70: 1, 71: 2,
  72: 0, 73: 3, 74: 1, 75: 2, 76: 0, 77: 1, 78: 2, 79: 0, 80: 6, 81: 3, 82: 1, 83: 2, 84: 0,
};
function fold(m, lo, hi) {
  let x = m;
  while (x < lo) x += 12;
  while (x > hi) x -= 12;
  return x;
}
export function valvesFor(m) { return VALVE_CHART[fold(Math.round(m), 54, 84)] ?? 0; }
/** 누른 밸브로 낼 수 있는 음 중 target 에 가장 가까운 음(입술로 배음을 고르는 셈). 맞게 눌렀으면 target 그대로. */
export function pitchForValves(mask, target) {
  if (valvesFor(target) === mask) return target;
  let best = target, bd = 99;
  for (const [k, v] of Object.entries(VALVE_CHART)) {
    if (v !== mask) continue;
    for (const o of [-24, -12, 0, 12]) {
      const m = Number(k) + o;
      const d = Math.abs(m - target);
      if (d < bd && d > 0) { bd = d; best = m; }
    }
  }
  return best;
}
export function valveLabel(mask) {
  if (!mask) return '○';
  return [1, 2, 3].filter((k) => mask & (1 << (k - 1))).join('·');
}
// 연습(곡 없음)일 때 밸브 → 음: 트럼펫 둘째 배음 줄(G4 개방)
export const FREE_VALVE_NOTE = { 0: 67, 2: 66, 1: 65, 3: 64, 6: 63, 5: 62, 7: 61, 4: 64 };

// ───────── 바이올린 현 ─────────
export const STRINGS = ['G', 'D', 'A', 'E'];
export const OPEN_STRING = [55, 62, 69, 76];
export function stringFor(m) { return m < 62 ? 0 : m < 69 ? 1 : m < 76 ? 2 : 3; }

// ───────── 계이름 ─────────
const SOLFA = ['도', '도♯', '레', '미♭', '미', '파', '파♯', '솔', '솔♯', '라', '시♭', '시'];
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];
export const solfa = (m) => SOLFA[((Math.round(m) % 12) + 12) % 12];
export const noteName = (m) => NAMES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);

// ───────── 지휘 무늬 ─────────
// 박 위치(4분음표 박)와 지휘봉이 움직이는 방향. 6/8 은 두 박(점4분)으로 젓습니다.
export const PATTERNS = {
  '4/4': [[0, 'down'], [1, 'left'], [2, 'right'], [3, 'up']],
  '3/4': [[0, 'down'], [1, 'right'], [2, 'up']],
  '2/4': [[0, 'down'], [1, 'up']],
  '6/8': [[0, 'down'], [1.5, 'up']],
};
export const patternOf = (song) => PATTERNS[(song && song.timeSig ? song.timeSig.join('/') : '4/4')] || PATTERNS['4/4'];
export const DIR_ARROW = { down: '↓', left: '←', right: '→', up: '↑' };
export const DIR_KO = { down: '아래로', left: '왼쪽으로', right: '오른쪽으로', up: '위로' };
/** 보통에서는 옆 방향도 봐줍니다(아래로 내리다 왼쪽으로 꺾이는 등) */
const NEAR_DIR = { down: ['down'], left: ['left', 'down'], right: ['right', 'down'], up: ['up'] };
export function dirOk(want, got, diff) {
  if (diff === 'easy' || !want) return true;
  if (diff === 'hard') return want === got;
  return NEAR_DIR[want].includes(got);
}

// ───────── 악보 만들기 ─────────
// 남길 음 사이 최소 간격: 박과 초 둘 다 봅니다(빠른 곡에서도 쉬움이 너무 빽빽하지 않게).
const GAP_BEATS = { easy: 1, normal: 0.5, hard: 0.24 };
const GAP_SEC = { easy: 0.85, normal: 0.36, hard: 0.11 };
function minGap(song, b, diff) {
  const bpm = bpmAt(song, b);
  return Math.max(pickD(diff, GAP_BEATS), (pickD(diff, GAP_SEC) * bpm) / 60) - 1e-6;
}
// 쉬움은 정박, 보통은 반박 위의 음을 먼저 남깁니다(엇박 음은 앞 음에 묶임).
function onGrid(b, diff) {
  if (diff === 'hard') return true;
  const g = diff === 'easy' ? 1 : 0.5;
  return Math.abs(b / g - Math.round(b / g)) < 1e-3;
}

function thin(src, song, diff, { grid = true } = {}) {
  const kept = [];
  for (const n of src) {
    const last = kept[kept.length - 1];
    const tooSoon = last && n.b - last.b < minGap(song, last.b, diff);
    const offGrid = grid && last && !onGrid(n.b, diff) && n.b - last.b < 2;
    if (last && (tooSoon || offGrid)) {
      last.fill.push([round4(n.b - last.b), n.d, n.m, n.v]);
      last.end = Math.max(last.end, n.b + n.d);
      continue;
    }
    kept.push({ ...n, fill: [], end: n.b + n.d });
  }
  for (let i = 0; i < kept.length; i++) {
    const k = kept[i];
    const nb = i + 1 < kept.length ? kept[i + 1].b : Infinity;
    k.d = round4(Math.max(0.25, Math.min(nb - k.b, k.end - k.b)));
    delete k.end;
  }
  return kept;
}
const round4 = (x) => Math.round(x * 10000) / 10000;

function pitchedNotes(song, inst, diff) {
  const I = INSTRUMENTS[inst];
  let src = (song.parts[I.part] || []).map(([b, d, m, v]) => ({ b, d, m, v: v ?? 0.8 }));
  // 같은 박에 여러 음이 있으면(화음) 가장 높은 음 하나만
  const byB = new Map();
  for (const n of src) { const k = Math.round(n.b * 1000); const p = byB.get(k); if (!p || n.m > p.m) byB.set(k, n); }
  src = [...byB.values()].sort((a, b) => a.b - b.b);
  // 악기 음역에 맞춥니다
  const range = { trumpet: [54, 84], horn: [45, 74], violin: [55, 93], voice: [48, 84], piano: [36, 96] }[inst] || [36, 96];
  const med = median(src.map((n) => n.m));
  let shift = 0;
  while (med + shift > range[1] - 4) shift -= 12;
  while (med + shift < range[0] + 4) shift += 12;
  src = src.map((n) => ({ ...n, m: fold(n.m + shift, range[0], range[1]) }));
  const notes = diff === 'hard' && inst !== 'piano' ? thin(src, song, 'hard', { grid: false }) : thin(src, song, diff);
  for (const n of notes) {
    if (I.kind === 'wind') n.valves = valvesFor(n.m);
    if (I.kind === 'bow') n.str = stringFor(n.m);
  }
  // 피아노 어려움: 마디 첫 박의 긴 음에 화음 한 음을 더합니다(두 건반 같이 누르기)
  if (inst === 'piano' && diff === 'hard') {
    const extra = [];
    for (const n of notes) {
      const pos = n.b % song.barLen;
      if (pos > 1e-3 || n.d < 1) continue;
      const c = chordAt(song, n.b);
      if (!c) continue;
      const tones = c.ivs.map((iv) => (c.root + iv) % 12);
      let best = null;
      for (let m = n.m - 3; m >= n.m - 9; m--) if (tones.includes(((m % 12) + 12) % 12)) { best = m; break; }
      if (best != null) extra.push({ b: n.b, d: n.d, m: best, v: n.v * 0.8, fill: [], chord: true });
    }
    notes.push(...extra);
    notes.sort((a, b) => a.b - b.b || b.m - a.m);
  }
  return notes;
}
function median(a) { if (!a.length) return 64; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; }

// 드럼: 킥·스네어·탐·심벌 가운데 한 박에 하나. 하이햇은 빼고, 너무 성기면 마디 첫 박을 채웁니다.
const DRUM_RANK = { 49: 6, 57: 6, 38: 5, 40: 5, 36: 4, 35: 4, 48: 3, 50: 3, 47: 3, 45: 3, 43: 3, 41: 3, 37: 2 };
function drumNotes(song, diff) {
  const byB = new Map();
  for (const [b, d, m, v] of song.parts.drums || []) {
    if (!DRUM_RANK[m]) continue;
    const k = Math.round(b * 1000);
    const p = byB.get(k);
    if (!p || DRUM_RANK[m] > DRUM_RANK[p.m]) byB.set(k, { b, d, m, v: v ?? 0.8 });
  }
  let src = [...byB.values()].sort((a, b) => a.b - b.b);
  src = fillSparse(src, song, diff, 36);
  return thin(src, song, diff).map((n) => ({ ...n, fill: [] }));
}
function castanetNotes(song, diff) {
  let src = (song.parts.perc || []).map(([b, d, m, v]) => ({ b, d, m: 85, v: v ?? 0.8 }));
  src = fillSparse(src, song, diff, 85, true);
  // 어려움: 짧은 사이에 몰린 음(3개 이상, 0.75박 안)은 '굴리기' 하나로
  if (diff === 'hard') {
    const out = [];
    for (let i = 0; i < src.length; i++) {
      let j = i;
      while (j + 1 < src.length && src[j + 1].b - src[i].b <= 0.75 && src[j + 1].b - src[j].b <= 0.3) j++;
      if (j - i >= 2) { out.push({ ...src[i], d: round4(src[j].b - src[i].b + 0.25), roll: true }); i = j; } else out.push(src[i]);
    }
    src = out;
  }
  return thin(src, song, diff).map((n) => ({ ...n, fill: [] }));
}
// 마디마다 한 음도 없으면 채웁니다(자장가처럼 북이 거의 없는 곡에서도 할 일이 있게).
function fillSparse(src, song, diff, m, offbeat = false) {
  const bars = Math.ceil(song.beats / song.barLen);
  const have = new Set(src.map((n) => Math.floor(n.b / song.barLen + 1e-6)));
  const add = [];
  const ts = (song.timeSig || [4, 4]).join('/');
  const pat = offbeat ? ({ '4/4': [1, 3], '3/4': [1, 2], '2/4': [1], '6/8': [1.5] }[ts] || [1]) : [0];
  for (let k = 0; k < bars; k++) {
    if (have.has(k)) continue;
    for (const p of pat) {
      const b = k * song.barLen + p;
      if (b < song.beats - 0.5) add.push({ b, d: 0.5, m, v: 0.7 });
    }
  }
  return src.concat(add).sort((a, b) => a.b - b.b);
}
function batonNotes(song, diff) {
  const pat = patternOf(song);
  const out = [];
  const bars = Math.ceil(song.beats / song.barLen);
  for (let k = 0; k < bars; k++) {
    pat.forEach(([off, dir], idx) => {
      if (diff === 'easy' && idx !== 0) return;
      const b = k * song.barLen + off;
      if (b >= song.beats - 0.01) return;
      out.push({ b, d: diff === 'easy' ? song.barLen : pat[idx + 1] ? pat[idx + 1][0] - off : song.barLen - off, m: 0, v: 0.8, dir, n: idx + 1, fill: [] });
    });
  }
  return out;
}

/** 곡·악기·난이도 → 그 사람이 따라 할 악보 */
export function buildPart(song, inst, diff = 'normal') {
  const I = INSTRUMENTS[inst];
  if (!song || !I) return { inst, diff, notes: [], lo: 60, hi: 72, sustain: false };
  let notes;
  if (I.kind === 'baton') notes = batonNotes(song, diff);
  else if (I.kind === 'strike') notes = drumNotes(song, diff);
  else if (I.kind === 'tap') notes = castanetNotes(song, diff);
  else notes = pitchedNotes(song, inst, diff);
  notes.forEach((n, i) => { n.i = i; });
  let lo = 127, hi = 0;
  for (const n of notes) {
    if (!n.m) continue;
    lo = Math.min(lo, n.m); hi = Math.max(hi, n.m);
    for (const f of n.fill) { lo = Math.min(lo, f[2]); hi = Math.max(hi, f[2]); }
  }
  if (lo > hi) { lo = 60; hi = 72; }
  return { inst, diff, notes, lo, hi, sustain: isSustain(inst), songId: song.id, barLen: song.barLen };
}

/** 지금 박에 울려야 할 음(관·현·성악이 소리를 내는 동안 따라갈 음높이). rest = 쉼표 구간이면 true */
export function targetAt(part, beat) {
  const ns = part.notes;
  if (!ns.length) return null;
  let lo = 0, hi = ns.length - 1, k = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (ns[mid].b <= beat + 0.06) { k = mid; lo = mid + 1; } else hi = mid - 1; }
  if (k < 0) return { m: ns[0].m, note: ns[0], rest: true, next: ns[0] };
  // 피아노 화음 음은 건너뜁니다
  while (k > 0 && ns[k].chord) k--;
  const n = ns[k];
  let m = n.m;
  for (const f of n.fill) if (n.b + f[0] <= beat + 0.06) m = f[2];
  const next = ns.slice(k + 1).find((x) => !x.chord) || null;
  const rest = beat > n.b + n.d + 0.05;
  return { m: rest && next ? next.m : m, note: n, rest, next };
}

/** 피아노 쉬움·보통: 남긴 음 하나를 누르면 묶인 음까지 이어서(박 기준) */
export function fillOf(note) { return note && note.fill ? note.fill : []; }

/** CD 고르기 칩: 별(1~10)과 음 수(선율 피아노 기준) */
const statCache = new Map();
export function chartStats(song, diff, inst = 'piano') {
  const key = song.id + '|' + diff + '|' + inst;
  if (statCache.has(key)) return statCache.get(key);
  const p = buildPart(song, inst, diff);
  const sec = song.lengthSec || 60;
  const nps = p.notes.length / sec;
  const stars = Math.max(1, Math.min(10, Math.round(nps * 2.6 + (diff === 'hard' ? 2.2 : diff === 'normal' ? 1 : 0))));
  const r = { stars, count: p.notes.length };
  statCache.set(key, r);
  return r;
}

// ───────── 아이콘(64×64, 선은 currentColor) ─────────
const S = (inner) => `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const SOFT = 'fill="currentColor" fill-opacity=".18" stroke="none"';
export const ICONS = {
  conductor: S(`<path d="M44 52c7-4 11-11 11-19" stroke-dasharray="1 5" stroke-width="2.4"/><path d="M14 50 47 15"/><path d="M10 55l8-8" stroke-width="7"/><circle cx="48" cy="14" r="3.2" fill="currentColor" stroke="none"/><path d="M52 8l2-3M55 13h3M44 7l-1-3" stroke-width="2"/>`),
  violin: S(`<g transform="rotate(-38 32 33)"><path d="M32 24c-7 0-10 3-10 7 0 3 3 4 3 6 0 2-4 3-4 7 0 5 4 8 11 8s11-3 11-8c0-4-4-5-4-7 0-2 3-3 3-6 0-4-3-7-10-7z" ${SOFT}/><path d="M32 24c-7 0-10 3-10 7 0 3 3 4 3 6 0 2-4 3-4 7 0 5 4 8 11 8s11-3 11-8c0-4-4-5-4-7 0-2 3-3 3-6 0-4-3-7-10-7z"/><path d="M32 24V8"/><circle cx="32" cy="6.5" r="2.4"/><path d="M27.5 36c1 1.5 1 4 0 5.5M36.5 36c-1 1.5-1 4 0 5.5" stroke-width="2"/><path d="M29 47h6" stroke-width="2.4"/></g><path d="M10 50 56 20" stroke-width="2.2"/>`),
  piano: S(`<rect x="6" y="18" width="52" height="30" rx="4" ${SOFT}/><rect x="6" y="18" width="52" height="30" rx="4"/><path d="M16.4 18v30M26.8 18v30M37.2 18v30M47.6 18v30" stroke-width="2"/><path d="M13 18v15h7V18M23.5 18v15h6.5V18M40 18v15h7V18" fill="currentColor" stroke-width="1.5"/>`),
  voice: S(`<rect x="23" y="7" width="18" height="28" rx="9" ${SOFT}/><rect x="23" y="7" width="18" height="28" rx="9"/><path d="M23 17h18M23 24h18" stroke-width="2"/><path d="M16 29c0 10 7 16 16 16s16-6 16-16"/><path d="M32 45v10M23 56h18"/>`),
  trumpet: S(`<path d="M37 33c8 0 13-4 21-11v24c-8-7-13-11-21-11z" ${SOFT}/><path d="M4 33h4M8 30v6"/><path d="M8 33h29"/><path d="M37 33c8 0 13-4 21-11v24c-8-7-13-11-21-11"/><path d="M15 33v7a4 4 0 0 0 4 4h14a4 4 0 0 0 4-4v-7" stroke-width="2.4"/><path d="M20 23v10M26 23v10M32 23v10" stroke-width="3.4"/><path d="M18 21h4M24 21h4M30 21h4" stroke-width="2.6"/>`),
  horn: S(`<circle cx="28" cy="35" r="15" ${SOFT}/><circle cx="28" cy="35" r="15"/><circle cx="28" cy="35" r="8" stroke-width="2.4"/><path d="M40 26c5-4 9-9 12-16 3 5 6 8 9 9-7 2-12 5-16 11"/><path d="M13 35H5" stroke-width="2.4"/><path d="M24 22v-5M30 22v-5" stroke-width="2.4"/>`),
  drum: S(`<ellipse cx="32" cy="38" rx="21" ry="7" ${SOFT}/><ellipse cx="32" cy="38" rx="21" ry="7"/><path d="M11 38v11c0 4 9 7 21 7s21-3 21-7V38"/><path d="M18 43l5 11M29 45l1 11M40 45l-1 11M48 42l-4 11" stroke-width="2"/><path d="M12 8l20 26M52 8 34 33" stroke-width="3.4"/><circle cx="12" cy="8" r="2.6" fill="currentColor" stroke="none"/><circle cx="52" cy="8" r="2.6" fill="currentColor" stroke="none"/>`),
  castanets: S(`<path d="M8 36c0-9 7-15 15-15 7 0 12 5 12 11 0 8-7 14-15 14-7 0-12-4-12-10z" ${SOFT}/><path d="M8 36c0-9 7-15 15-15 7 0 12 5 12 11 0 8-7 14-15 14-7 0-12-4-12-10z"/><path d="M29 30c0-9 7-15 15-15 7 0 12 5 12 11 0 8-7 14-15 14" /><path d="M14 36c2-5 6-8 11-8" stroke-width="2"/><path d="M33 13c3-6 9-7 12-3" stroke-width="2"/><path d="M47 47l3 3M52 42l4 1M42 50l0 4" stroke-width="2.2"/>`),
};
