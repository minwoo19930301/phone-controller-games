// 공용 음악 라이브러리: 저작권이 끝난(퍼블릭 도메인) 곡을 우리가 직접 단순화해 적은 악보 데이터입니다.
// 녹음이나 현대 편곡은 베끼지 않았습니다. 선율은 원곡과 대조해 한 음씩 다시 확인했고,
// 불러올 때 마디마다 박 수가 맞는지 검사합니다(BUILD_ERRORS 가 비어 있어야 정상).
//
// 각 곡의 parts = { melody, harmony, bass, chords, drums, perc } 이고, 각 파트는 [박, 길이(박), midi, 세기 0~1] 목록입니다.
// 박은 4분음표 = 1 입니다(6/8 도 4분음표 기준, 한 마디 3박).
// drums 의 midi 는 GM 타악기 번호(36 킥, 38 스네어, 42 하이햇 …), perc 는 85 캐스터네츠, 39 박수, 54 탬버린, 81 트라이앵글입니다.
// DOM 을 쓰지 않으므로 브라우저와 node 어디서나 불러올 수 있습니다(다른 프로젝트로 그대로 복사해도 됩니다).
//
// 악보 표기(이 파일 안에서만 씀)
//   음: "F#4" "Bb3" "C5:1.5" "r:.5"(쉼표). ":" 뒤는 박 길이, 생략하면 바로 앞 음의 길이를 그대로 씁니다.
//   "~" 를 붙이면 다음 같은 음과 붙임줄로 이어집니다. "|" 는 마디 줄이고 박 수 검사에 씁니다.
//   화음: "D A | Bm F#m:1 G:3 | N" 마디 안 화음은 길이를 안 적으면 똑같이 나눕니다. N 은 화음 없음.

export const PART_NAMES = ['melody', 'harmony', 'bass', 'chords', 'drums', 'perc'];
export const DRUM = { kick: 36, stick: 37, snare: 38, clap: 39, tomLow: 45, hat: 42, hatOpen: 46, tomMid: 47, tomHigh: 48, crash: 49, ride: 51, tamb: 54, triangle: 81, castanet: 85 };
export const DIFFICULTIES = ['easy', 'normal', 'hard'];

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** "F#4" → 66 */
export function noteToMidi(name) {
  const m = /^([A-G])(#{1,2}|b{1,2})?(-?\d)$/.exec(name);
  if (!m) throw new Error('음 이름을 읽을 수 없습니다: ' + name);
  const acc = !m[2] ? 0 : m[2][0] === '#' ? m[2].length : -m[2].length;
  return 12 * (Number(m[3]) + 1) + PC[m[1]] + acc;
}
export function midiToName(m) { return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }
export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

function num(s) {
  if (s.includes('/')) { const [a, b] = s.split('/'); return Number(a) / Number(b); }
  return Number(s);
}
const EPS = 1e-6;

// ───────────── 표기 읽기 ─────────────
function parseLine(src, barLen, where, errors) {
  const bars = src.split('|').map((s) => s.trim()).filter(Boolean);
  const notes = [];
  let beat = 0, dur = 1, tie = null;
  bars.forEach((bar, bi) => {
    let sum = 0;
    for (const tok of bar.split(/\s+/)) {
      const m = /^(r|[A-G](?:#{1,2}|b{1,2})?-?\d)(?::([\d./]+))?(~)?(?:@([\d.]+))?$/.exec(tok);
      if (!m) { errors.push(`${where}: 알 수 없는 표기 "${tok}"`); continue; }
      if (m[2]) dur = num(m[2]);
      if (!(dur > 0)) errors.push(`${where}: 길이 오류 "${tok}"`);
      if (m[1] === 'r') {
        if (tie) errors.push(`${where}: 붙임줄 뒤에 쉼표 (${tok})`);
        tie = null;
      } else {
        const midi = noteToMidi(m[1]);
        if (tie && tie[2] === midi) tie[1] += dur;
        else {
          if (tie) errors.push(`${where}: 붙임줄 뒤 음이 다릅니다 (${tok})`);
          notes.push([beat, dur, midi, m[4] ? Number(m[4]) : null]);
        }
        tie = m[3] ? (tie && tie[2] === midi ? tie : notes[notes.length - 1]) : null;
      }
      beat += dur;
      sum += dur;
    }
    if (Math.abs(sum - barLen) > EPS) errors.push(`${where}: ${bi + 1}째 마디가 ${+sum.toFixed(4)}박 (기대 ${barLen}박)`);
  });
  if (tie) errors.push(`${where}: 끝 음에 붙임줄이 남았습니다`);
  return { notes, bars: bars.length, beats: beat };
}

const QUAL = {
  '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], dim: [0, 3, 6], dim7: [0, 3, 6, 9],
  aug: [0, 4, 8], sus4: [0, 5, 7], sus2: [0, 2, 7], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9], m7b5: [0, 3, 6, 10], 9: [0, 4, 7, 10, 14], add9: [0, 4, 7, 14],
};
function pcOf(s) { return (PC[s[0]] + (s[1] === '#' ? 1 : s[1] === 'b' ? -1 : 0) + 12) % 12; }
function parseChordName(name, where, errors) {
  if (name === 'N') return null;
  const m = /^([A-G][#b]?)(maj7|m7b5|m7|m6|m|dim7|dim|aug|sus4|sus2|add9|7|6|9)?(?:\/([A-G][#b]?))?$/.exec(name);
  if (!m) { errors.push(`${where}: 화음 이름 오류 "${name}"`); return null; }
  const root = pcOf(m[1]);
  return { name, root, ivs: QUAL[m[2] || ''], bass: m[3] ? pcOf(m[3]) : root };
}
function parseChords(src, barLen, where, errors) {
  const bars = src.split('|').map((s) => s.trim()).filter(Boolean);
  const out = [];
  bars.forEach((bar, bi) => {
    const toks = bar.split(/\s+/).map((t) => { const [n, d] = t.split(':'); return { n, d: d ? num(d) : null }; });
    const fixed = toks.reduce((a, t) => a + (t.d || 0), 0);
    const free = toks.filter((t) => t.d == null).length;
    const share = free ? (barLen - fixed) / free : 0;
    let b = bi * barLen, sum = 0;
    for (const t of toks) {
      const d = t.d ?? share;
      const c = parseChordName(t.n, where, errors);
      if (c) out.push({ ...c, beat: b, dur: d });
      b += d;
      sum += d;
    }
    if (Math.abs(sum - barLen) > EPS) errors.push(`${where}: ${bi + 1}째 마디 화음 길이 ${sum} (기대 ${barLen})`);
  });
  return { chords: out, bars: bars.length };
}

// ───────────── 반주 만들기 ─────────────
const STYLES = {
  march: { bass: 'march', chords: 'offbeat', drums: 'march', perc: 'off8' },
  gallop: { bass: 'march', chords: 'offbeat', drums: 'gallop', perc: 'off8' },
  waltz: { bass: 'waltz', chords: 'waltz', drums: 'waltz', perc: 'waltz' },
  ballad: { bass: 'long', chords: 'arp', drums: 'soft', perc: 'soft' },
  baroque: { bass: 'quarter', chords: 'blocks', drums: 'light', perc: 'beat' },
  classical: { bass: 'quarter', chords: 'eighths', drums: 'light', perc: 'off8' },
  pop: { bass: 'drive', chords: 'pulse', drums: 'rock', perc: 'clap24' },
  folk: { bass: 'half', chords: 'strum', drums: 'folk', perc: 'off8' },
  lullaby: { bass: 'long', chords: 'arp3', drums: 'brush', perc: 'soft' },
  hymn: { bass: 'long', chords: 'pad', drums: 'soft', perc: 'soft' },
  gymno: { bass: 'waltz', chords: 'beat2', drums: 'brush', perc: 'soft' },
};
const FILL_STYLES = new Set(['march', 'gallop', 'rock', 'folk', 'light']);

const bassMidi = (pc) => 40 + ((pc - 4 + 12) % 12); // E2..D#3
const clampVel = (v) => Math.max(0.05, Math.min(1, v));

function voicing(c, prevAvg) {
  let pcs = [...new Set(c.ivs.map((i) => (c.root + i) % 12))];
  if (pcs.length > 4) pcs = pcs.filter((p) => p !== (c.root + 7) % 12); // 9화음은 5음 생략
  let best = null;
  for (let k = 0; k < pcs.length; k++) {
    const order = pcs.slice(k).concat(pcs.slice(0, k));
    for (const base of [48, 60]) {
      const out = [];
      let last = base - 1;
      for (const p of order) {
        let m = base + ((p - base % 12 + 12) % 12);
        while (m <= last) m += 12;
        out.push(m);
        last = m;
      }
      if (out[0] < 52 || out[out.length - 1] > 76) continue;
      const avg = out.reduce((a, b) => a + b, 0) / out.length;
      const score = Math.abs(avg - prevAvg) + Math.abs(avg - 63) * 0.35;
      if (!best || score < best.score) best = { notes: out, avg, score };
    }
  }
  return best || { notes: pcs.map((p) => 60 + p), avg: 66 };
}

function chordAtList(list, beat) {
  // list 는 박 순서. 해당 박을 덮는 화음(없으면 null)
  let lo = 0, hi = list.length - 1, ans = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].beat <= beat + EPS) { ans = list[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return ans && beat < ans.beat + ans.dur - EPS ? ans : null;
}

function autoHarmony(melody, chords, fromBeat = 0, toBeat = Infinity) {
  const out = [];
  const pts = melody.filter((n) => n[0] >= fromBeat - EPS && n[0] < toBeat - EPS && Math.abs(n[0] * 2 - Math.round(n[0] * 2)) < EPS);
  for (let i = 0; i < pts.length; i++) {
    const n = pts[i];
    const c = chordAtList(chords, n[0]);
    if (!c) continue;
    const pcs = c.ivs.map((iv) => (c.root + iv) % 12);
    const above = n[2] < 60; // 낮은 선율이면 위에 화음을 얹습니다
    let best = null;
    for (let d = 3; d <= 9; d++) {
      const m = above ? n[2] + d : n[2] - d;
      if (!pcs.includes(((m % 12) + 12) % 12)) continue;
      const pref = d === 3 || d === 4 ? 0 : d === 8 || d === 9 ? 1 : d === 7 ? 1.5 : d === 5 ? 2 : 3;
      if (!best || pref < best.pref) best = { m, pref };
    }
    if (!best) continue;
    let m = best.m;
    if (m < 50) m += 12;
    if (!above && m >= n[2]) continue;
    const next = pts[i + 1];
    const end = Math.max(n[0] + n[1], Math.min(next ? next[0] : n[0] + n[1], n[0] + 4));
    const prev = out[out.length - 1];
    if (prev && prev[2] === m && Math.abs(prev[0] + prev[1] - n[0]) < EPS && chordAtList(chords, prev[0]) === c) prev[1] = end - prev[0];
    else out.push([n[0], Math.min(end, toBeat) - n[0], m, clampVel((n[3] || 0.8) * 0.68)]);
  }
  return out;
}

function genBass(c, pat, barLen, dyn, out) {
  const root = bassMidi(c.bass);
  const fifth = bassMidi(c.root) + 7 > 55 ? bassMidi(c.root) - 5 : bassMidi(c.root) + 7;
  const v = 0.72 * dyn;
  const end = c.beat + c.dur;
  const beats = [];
  for (let b = Math.ceil(c.beat - EPS); b < end - EPS; b++) beats.push(b);
  if (!beats.length || beats[0] > c.beat + EPS) beats.unshift(c.beat);
  const inBar = (b) => ((b % barLen) + barLen) % barLen;
  if (pat === 'long') {
    for (let b = c.beat; b < end - EPS; b += barLen) out.push([b, Math.min(barLen, end - b), root, v * 0.9]);
  } else if (pat === 'half') {
    let k = 0;
    for (let b = c.beat; b < end - EPS; b += 2, k++) out.push([b, Math.min(2, end - b) * 0.95, k % 2 ? fifth : root, v]);
  } else if (pat === 'quarter') {
    for (const b of beats) out.push([b, Math.min(1, end - b) * 0.9, root, v * (inBar(b) < EPS ? 1 : 0.85)]);
  } else if (pat === 'march') {
    for (const b of beats) out.push([b, Math.min(0.55, end - b), Math.round(inBar(b)) % 2 ? fifth : root, v * (inBar(b) < EPS ? 1 : 0.85)]);
  } else if (pat === 'waltz') {
    for (const b of beats) if (inBar(b) < EPS) out.push([b, Math.min(1, end - b), Math.floor(b / barLen) % 2 && c.dur > barLen ? fifth : root, v]);
    if (inBar(c.beat) > EPS) out.push([c.beat, Math.min(1, c.dur), root, v * 0.8]);
  } else if (pat === 'drive') {
    for (let b = c.beat; b < end - EPS; b += 0.5) out.push([b, 0.4, root, v * (Math.abs(b - Math.round(b)) < EPS ? 0.95 : 0.7)]);
  } else if (pat === 'pizz') {
    for (const b of beats) out.push([b, 0.3, root, v]);
  }
}

function genChords(c, pat, barLen, dyn, state, out) {
  const vo = voicing(c, state.avg);
  state.avg = vo.avg;
  const ns = vo.notes;
  const v = 0.4 * dyn;
  const end = c.beat + c.dur;
  const inBar = (b) => ((b % barLen) + barLen) % barLen;
  const push = (b, d, vel) => { for (const m of ns) out.push([b, d, m, clampVel(vel)]); };
  if (pat === 'pad') {
    for (let b = c.beat; b < end - EPS; b += 4) push(b, Math.min(4, end - b), v * 0.9);
  } else if (pat === 'offbeat') {
    for (let b = Math.ceil(c.beat - EPS); b < end - EPS; b++) if (b + 0.5 < end - EPS) push(b + 0.5, 0.35, v);
  } else if (pat === 'waltz') {
    for (let b = Math.ceil(c.beat - EPS); b < end - EPS; b++) if (inBar(b) > EPS) push(b, 0.8, v * 0.95);
  } else if (pat === 'beat2') {
    for (let b = Math.ceil(c.beat - EPS); b < end - EPS; b++) if (Math.abs(inBar(b) - 1) < EPS) push(b, Math.min(2, end - b), v * 0.85);
  } else if (pat === 'blocks') {
    for (let b = c.beat; b < end - EPS; b += 2) push(b, Math.min(2, end - b) * 0.95, v * 0.9);
  } else if (pat === 'pulse') {
    for (let b = c.beat; b < end - EPS; b += 1) push(b, Math.min(0.8, end - b), v * (inBar(b) % 2 ? 0.85 : 1));
  } else if (pat === 'eighths') {
    for (let b = c.beat; b < end - EPS; b += 0.5) push(b, 0.35, v * 0.7);
  } else if (pat === 'strum') {
    for (let b = c.beat; b < end - EPS; b += barLen === 3 ? 1 : 2) {
      if (barLen === 3 && inBar(b) < EPS) continue;
      push(b, Math.min(barLen === 3 ? 0.8 : 1.6, end - b), v);
    }
  } else if (pat === 'arp' || pat === 'arp3') {
    const seq = pat === 'arp3' ? [0, 1, 2, 3, 2, 1] : [0, 1, 2, 1];
    const tones = [...ns, ns[0] + 12];
    let k = 0;
    for (let b = c.beat; b < end - EPS; b += 0.5, k++) {
      const m = tones[Math.min(tones.length - 1, seq[k % seq.length])];
      out.push([b, Math.min(1, end - b), m, clampVel(v * (k % seq.length === 0 ? 0.95 : 0.75))]);
    }
  }
}

function genDrumsBar(b0, L, pat, ctx, out) {
  const { dyn, sectionStart, lastOfSection, songEnd, bars } = ctx;
  const D = (t, m, v) => out.push([b0 + t, 0.25, m, clampVel(v * dyn)]);
  if (songEnd) { D(0, DRUM.crash, 0.6); D(0, DRUM.kick, 0.8); return; }
  if (sectionStart && pat !== 'brush') D(0, DRUM.crash, pat === 'soft' ? 0.3 : 0.5);
  const fill = lastOfSection && bars >= 4 && FILL_STYLES.has(pat);
  const lim = fill ? L - 1 : L;
  const each = (step, fn) => { for (let t = 0; t < lim - EPS; t += step) fn(t); };
  if (pat === 'march') {
    if (L === 3) { D(0, DRUM.kick, 0.75); D(1, DRUM.snare, 0.4); if (lim > 2) D(2, DRUM.snare, 0.4); }
    else { each(1, (t) => D(t, t % 2 ? DRUM.snare : DRUM.kick, t % 2 ? 0.55 : 0.75)); each(0.5, (t) => D(t, DRUM.hat, 0.25)); }
  } else if (pat === 'gallop') {
    each(1, (t) => { D(t, DRUM.kick, t ? 0.6 : 0.8); D(t + 0.5, DRUM.snare, 0.45); });
    each(0.25, (t) => { if (Math.abs(t * 2 - Math.round(t * 2)) > EPS) D(t, DRUM.hat, 0.18); });
  } else if (pat === 'waltz') {
    D(0, DRUM.kick, 0.6); for (let t = 1; t < L; t++) { D(t, DRUM.stick, 0.3); D(t, DRUM.hat, 0.16); }
  } else if (pat === 'soft') {
    D(0, DRUM.kick, 0.4); each(1, (t) => D(t, DRUM.hat, 0.13)); if (L === 4) D(2, DRUM.stick, 0.25);
  } else if (pat === 'light') {
    D(0, DRUM.kick, 0.5); each(1, (t) => D(t, DRUM.hat, 0.2)); if (L >= 4) D(2, DRUM.snare, 0.28); else if (L === 2) D(1, DRUM.snare, 0.28);
  } else if (pat === 'rock') {
    each(1, (t) => D(t, t % 2 ? DRUM.snare : DRUM.kick, t % 2 ? 0.6 : 0.8));
    if (L === 4 && lim === 4) D(2.5, DRUM.kick, 0.55);
    each(0.5, (t) => D(t, DRUM.hat, Math.abs(t - Math.round(t)) < EPS ? 0.3 : 0.22));
  } else if (pat === 'folk') {
    D(0, DRUM.kick, 0.6);
    if (L === 4) { D(2, DRUM.kick, 0.5); D(1, DRUM.stick, 0.35); if (lim === 4) D(3, DRUM.stick, 0.35); }
    else for (let t = 1; t < lim; t++) D(t, DRUM.stick, 0.32);
    each(0.5, (t) => D(t, DRUM.hat, 0.14));
  } else if (pat === 'brush') {
    D(0, DRUM.kick, 0.3); each(1, (t) => D(t, DRUM.hat, 0.1));
  }
  if (fill) {
    const f = L - 1;
    [DRUM.tomHigh, DRUM.tomHigh, DRUM.tomMid, DRUM.tomLow].forEach((m, i) => D(f + i * 0.25, m, 0.4 + i * 0.07));
  }
}

function genPercBar(b0, L, pat, ctx, out) {
  const { dyn, songEnd } = ctx;
  const P = (t, m, v) => out.push([b0 + t, 0.2, m, clampVel(v * dyn)]);
  if (songEnd) { P(0, pat === 'tamb8' ? DRUM.tamb : pat === 'clap24' ? DRUM.clap : pat === 'soft' ? DRUM.triangle : DRUM.castanet, 0.5); return; }
  if (pat === 'off8') for (let t = 0.5; t < L; t += 1) P(t, DRUM.castanet, 0.42);
  else if (pat === 'waltz') for (let t = 1; t < L; t++) P(t, DRUM.castanet, 0.4);
  else if (pat === 'clap24') { if (L === 4) { P(1, DRUM.clap, 0.5); P(3, DRUM.clap, 0.5); } else for (let t = 1; t < L; t += 2) P(t, DRUM.clap, 0.5); }
  else if (pat === 'beat') for (let t = 0; t < L; t++) P(t, DRUM.castanet, t ? 0.3 : 0.4);
  else if (pat === 'soft') { if (ctx.barIndex % 2 === 0) P(0, DRUM.triangle, 0.3); }
  else if (pat === 'tamb8') for (let t = 0; t < L; t += 0.5) P(t, DRUM.tamb, Math.abs(t - Math.round(t)) < EPS ? 0.4 : 0.28);
}

// ───────────── 곡 조립 ─────────────
export const BUILD_ERRORS = [];

function buildSong(def) {
  const errors = [];
  const barLen = (def.timeSig[0] * 4) / def.timeSig[1];
  const secs = {};
  for (const [k, s0] of Object.entries(def.sections)) {
    const s = s0.of ? { ...def.sections[s0.of], ...s0 } : s0;
    const where = `${def.id}.${k}`;
    const mel = parseLine(s.mel, barLen, where + '.mel', errors);
    const ch = parseChords(s.ch, barLen, where + '.ch', errors);
    if (ch.bars !== mel.bars) errors.push(`${where}: 선율 ${mel.bars}마디, 화음 ${ch.bars}마디`);
    secs[k] = { ...s, mel, ch };
  }
  const style = { ...STYLES[def.style], ...(def.pattern || {}) };
  const melody = [], chordTrack = [], sections = [];
  let beat = 0;
  def.form.forEach((name) => {
    const s = secs[name];
    if (!s) { errors.push(`${def.id}: 형식에 없는 단락 ${name}`); return; }
    const dyn = s.dyn || 1, oct = s.oct || 0;
    sections.push({ name, beat, bars: s.mel.bars, beats: s.mel.beats, dyn });
    for (const n of s.mel.notes) {
      const pos = ((n[0] % barLen) + barLen) % barLen;
      const accent = pos < EPS ? 0.9 : Math.abs(pos - Math.round(pos)) < EPS ? 0.8 : 0.72;
      melody.push([beat + n[0], n[1], n[2] + oct, clampVel((n[3] ?? accent) * dyn)]);
    }
    for (const c of s.ch.chords) chordTrack.push({ ...c, beat: beat + c.beat, dyn });
    beat += s.mel.beats;
  });
  const total = beat;

  // 화성(둘째 성부): 돌림노래는 선율을 늦춰 겹치고, 나머지는 화음에 맞춘 3·6도 아래 성부를 자동으로 붙입니다.
  let harmony;
  if (def.canon) {
    const last = sections[sections.length - 1];
    const stop = def.canonEndAuto === false ? total : last.beat;
    harmony = melody.filter((n) => n[0] + def.canon < stop - EPS).map((n) => [n[0] + def.canon, Math.min(n[1], stop - n[0] - def.canon), n[2], clampVel(n[3] * 0.72)]);
    harmony = autoHarmony(melody, chordTrack, 0, def.canon).concat(harmony, autoHarmony(melody, chordTrack, stop, total));
  } else harmony = autoHarmony(melody, chordTrack);
  if (def.harmonyOct) harmony = harmony.map((n) => [n[0], n[1], n[2] + def.harmonyOct, n[3]]);

  const bass = [], chords = [], drums = [], perc = [];
  const state = { avg: 63 };
  for (const c of chordTrack) {
    genBass(c, style.bass, barLen, c.dyn, bass);
    genChords(c, style.chords, barLen, c.dyn, state, chords);
  }
  sections.forEach((s, si) => {
    for (let i = 0; i < s.bars; i++) {
      const b0 = s.beat + i * barLen;
      const ctx = { dyn: s.dyn, sectionStart: i === 0, lastOfSection: i === s.bars - 1, bars: s.bars, barIndex: i, songEnd: si === sections.length - 1 && i === s.bars - 1 };
      genDrumsBar(b0, barLen, style.drums, ctx, drums);
      genPercBar(b0, barLen, style.perc, ctx, perc);
    }
  });
  const sortP = (a) => a.sort((x, y) => x[0] - y[0] || x[2] - y[2]);
  const parts = { melody: sortP(melody), harmony: sortP(harmony), bass: sortP(bass), chords: sortP(chords), drums: sortP(drums), perc: sortP(perc) };
  for (const p of PART_NAMES) parts[p] = parts[p].filter((n) => n[1] > EPS).map((n) => [round4(n[0]), round4(n[1]), n[2], round3(n[3])]);

  const song = {
    id: def.id, title: def.title, en: def.en, composer: def.composer, composerEn: def.composerEn, life: def.life, work: def.work || '',
    pd: def.pd, bpm: def.bpm, timeSig: def.timeSig, key: def.key, genre: def.genre, mood: def.mood,
    cover: def.cover, orch: def.orch || {}, tempos: def.tempos || [[0, def.bpm]],
    barLen, beats: total, form: def.form.slice(), sections, chordTrack: chordTrack.map(({ name, root, ivs, bass: b, beat: bt, dur }) => ({ name, root, ivs, bass: b, beat: bt, dur })),
    previewBeat: def.previewBeat ?? 0, parts,
  };
  song.lengthSec = Math.round(beatToSec(song, total) * 100) / 100;
  song.ranges = {};
  for (const p of ['melody', 'harmony', 'bass', 'chords']) {
    const ms = parts[p].map((n) => n[2]);
    song.ranges[p] = ms.length ? [Math.min(...ms), Math.max(...ms)] : [60, 60];
  }
  BUILD_ERRORS.push(...errors);
  return song;
}
const round4 = (x) => Math.round(x * 10000) / 10000;
const round3 = (x) => Math.round(x * 1000) / 1000;

// ───────────── 박 ↔ 초 ─────────────
export function bpmAt(song, beat) {
  let bpm = song.tempos[0][1];
  for (const [b, v] of song.tempos) if (b <= beat + EPS) bpm = v;
  return bpm;
}
/** 곡 처음부터 해당 박까지 걸리는 초(빠르기 바뀜 포함) */
export function beatToSec(song, beat) {
  const T = song.tempos;
  let sec = 0;
  for (let i = 0; i < T.length; i++) {
    const a = T[i][0], b = i + 1 < T.length ? T[i + 1][0] : Infinity;
    if (beat <= a) break;
    sec += ((Math.min(beat, b) - a) * 60) / T[i][1];
  }
  return sec;
}
export function secToBeat(song, sec) {
  const T = song.tempos;
  let acc = 0;
  for (let i = 0; i < T.length; i++) {
    const a = T[i][0], b = i + 1 < T.length ? T[i + 1][0] : Infinity;
    const segSec = ((b - a) * 60) / T[i][1];
    if (sec <= acc + segSec || b === Infinity) return a + ((sec - acc) * T[i][1]) / 60;
    acc += segSec;
  }
  return 0;
}
/** 해당 박에 울리는 화음 { name, root, ivs, bass } 또는 null */
export function chordAt(song, beat) { return chordAtList(song.chordTrack, beat); }

// ───────────── 곡 목록 ─────────────
const PD_DEAD = (y) => `작곡가 ${y}년 사망, 사후 70년이 지나 저작권이 끝난 퍼블릭 도메인`;
const PD_FOLK = '전해 내려오는 민요, 저작권이 없는 퍼블릭 도메인';

const DEFS = [
  {
    id: 'ode-to-joy', title: '환희의 송가', en: 'Ode to Joy', composer: '베토벤', composerEn: 'Ludwig van Beethoven', life: '1770–1827',
    work: '교향곡 9번 4악장 (1824)', pd: PD_DEAD(1827), bpm: 112, timeSig: [4, 4], key: 'D', genre: '교향곡', mood: '벅찬', style: 'march',
    cover: { hue: 45, motif: 'rays' }, orch: { melody: 'strings', harmony: 'horn', chords: 'piano' },
    sections: {
      A: {
        mel: 'F#4 F#4 G4 A4 | A4 G4 F#4 E4 | D4 D4 E4 F#4 | F#4:1.5 E4:.5 E4:2 | F#4:1 F#4 G4 A4 | A4 G4 F#4 E4 | D4 D4 E4 F#4 | E4:1.5 D4:.5 D4:2',
        ch: 'D | D A | D | A | D | D A | D | A D',
      },
      B: {
        mel: 'E4:1 E4 F#4 D4 | E4 F#4:.5 G4:.5 F#4:1 D4 | E4 F#4:.5 G4:.5 F#4:1 E4 | D4 E4 A3:2 | F#4:1 F#4 G4 A4 | A4 G4 F#4 E4 | D4 D4 E4 F#4 | E4:1.5 D4:.5 D4:2',
        ch: 'A | A D | A | D A | D | D A | D | A D',
      },
      A2: { of: 'A', dyn: 1.12 }, B2: { of: 'B', dyn: 1.12 },
    },
    form: ['A', 'B', 'A2', 'B2'],
  },
  {
    id: 'canon', title: '캐논', en: 'Canon in D', composer: '파헬벨', composerEn: 'Johann Pachelbel', life: '1653–1706',
    work: '세 대의 바이올린과 통주저음을 위한 캐논', pd: PD_DEAD(1706), bpm: 76, timeSig: [4, 4], key: 'D', genre: '바로크', mood: '잔잔한', style: 'baroque',
    canon: 16, cover: { hue: 205, motif: 'rings' }, orch: { melody: 'violin', harmony: 'strings', chords: 'piano' },
    sections: {
      V1: { mel: 'F#5:2 E5 | D5 C#5 | B4 A4 | B4 C#5', ch: 'D A | Bm F#m | G D | G A' },
      V2: { mel: 'D5:2 C#5 | B4 A4 | G4 F#4 | G4 E4', ch: 'D A | Bm F#m | G D | G A' },
      V3: { mel: 'D5:1 F#5 A5 G5 | F#5 D5 F#5 E5 | D5 B4 D5 A5 | G5 B5 A5 G5', ch: 'D A | Bm F#m | G D | G A' },
      V4: {
        mel: 'A5:.5 F#5:.25 G5 A5:.5 F#5:.25 G5 A5 A4 B4 C#5 D5 E5 F#5 G5 | F#5:.5 D5:.25 E5 F#5:.5 F#4:.25 G4 A4 B4 A4 G4 A4 F#4 G4 A4 | G4:.5 B4:.25 A4 G4:.5 F#4:.25 E4 F#4 E4 D4 E4 F#4 G4 A4 B4 | G4:.5 B4:.25 A4 B4:.5 C#5:.25 D5 A4 B4 C#5 D5 E5 F#5 G5 A5',
        ch: 'D A | Bm F#m | G D | G A',
      },
      END: { mel: 'D5:4', ch: 'D' },
    },
    form: ['V1', 'V2', 'V3', 'V4', 'V1', 'V2', 'END'],
  },
  {
    id: 'nachtmusik', title: '아이네 클라이네 나흐트무지크', en: 'Eine kleine Nachtmusik', composer: '모차르트', composerEn: 'Wolfgang Amadeus Mozart', life: '1756–1791',
    work: '세레나데 13번 K.525 1악장 (1787)', pd: PD_DEAD(1791), bpm: 126, timeSig: [4, 4], key: 'G', genre: '세레나데', mood: '경쾌한', style: 'classical',
    cover: { hue: 262, motif: 'stars' }, orch: { melody: 'violin', harmony: 'strings', chords: 'strings' },
    sections: {
      A: { mel: 'G4:1 r:.5 D4:.5 G4:1 r:.5 D4:.5 | G4:.5 D4 G4 B4 D5:1 r:1 | C5:1 r:.5 A4:.5 C5:1 r:.5 A4:.5 | C5:.5 A4 F#4 A4 D4:1 r:1', ch: 'G | G | D7 | D7' },
      A8: { of: 'A', oct: 12, dyn: 1.08 },
      B: { mel: 'B4:1 r:.5 G4:.5 B4:1 r:.5 G4:.5 | B4:.5 G4 B4 D5 G5:1 r:1 | F#5:1 r:.5 D5:.5 F#5:1 r:.5 D5:.5 | E5:.5 C5 A4 F#4 G4:1 r:1', ch: 'G | G | D7 | D7 G' },
    },
    form: ['A', 'A8', 'B', 'A', 'A8', 'B', 'A', 'B'],
  },
  {
    id: 'fur-elise', title: '엘리제를 위하여', en: 'Für Elise', composer: '베토벤', composerEn: 'Ludwig van Beethoven', life: '1770–1827',
    work: '바가텔 WoO 59 (1810)', pd: PD_DEAD(1827), bpm: 126, timeSig: [3, 4], key: 'Am', genre: '피아노 소품', mood: '애틋한', style: 'lullaby',
    cover: { hue: 330, motif: 'petals' }, orch: { melody: 'piano', harmony: 'piano', chords: 'piano' }, pattern: { chords: 'arp3', drums: 'brush' },
    sections: {
      P: { mel: 'r:2 E5:.5 D#5:.5', ch: 'N' },
      A1: {
        mel: 'E5:.5 D#5 E5 B4 D5 C5 | A4:1 r:.5 C4:.5 E4 A4 | B4:1 r:.5 E4:.5 G#4 B4 | C5:1 r:.5 E4:.5 E5 D#5 | E5:.5 D#5 E5 B4 D5 C5 | A4:1 r:.5 C4:.5 E4 A4 | B4:1 r:.5 E4:.5 C5 B4 | A4:1 r:1 E5:.5 D#5:.5',
        ch: 'E | Am | E | Am | E | Am | E | Am',
      },
      A2: {
        mel: 'E5:.5 D#5 E5 B4 D5 C5 | A4:1 r:.5 C4:.5 E4 A4 | B4:1 r:.5 E4:.5 G#4 B4 | C5:1 r:.5 E4:.5 E5 D#5 | E5:.5 D#5 E5 B4 D5 C5 | A4:1 r:.5 C4:.5 E4 A4 | B4:1 r:.5 E4:.5 C5 B4 | A4:1 r:.5 B4:.5 C5 D5',
        ch: 'E | Am | E | Am | E | Am | E | Am',
      },
      B: { mel: 'E5:1.5 G4:.5 F5 E5 | D5:1.5 F4:.5 E5 D5 | C5:1.5 E4:.5 D5 C5 | B4:1 r:.5 E4:.5 E5 D#5', ch: 'C | G | Am | E' },
      AE: {
        mel: 'E5:.5 D#5 E5 B4 D5 C5 | A4:1 r:.5 C4:.5 E4 A4 | B4:1 r:.5 E4:.5 G#4 B4 | C5:1 r:.5 E4:.5 E5 D#5 | E5:.5 D#5 E5 B4 D5 C5 | A4:1 r:.5 C4:.5 E4 A4 | B4:1 r:.5 E4:.5 C5 B4 | A4:3',
        ch: 'E | Am | E | Am | E | Am | E | Am',
      },
    },
    form: ['P', 'A1', 'A2', 'B', 'A1', 'A2', 'B', 'AE'],
  },
  {
    id: 'turkish-march', title: '터키 행진곡', en: 'Rondo alla Turca', composer: '모차르트', composerEn: 'Wolfgang Amadeus Mozart', life: '1756–1791',
    work: '피아노 소나타 11번 K.331 3악장 (1783)', pd: PD_DEAD(1791), bpm: 120, timeSig: [2, 4], key: 'Am', genre: '피아노 소나타', mood: '씩씩한', style: 'march',
    cover: { hue: 12, motif: 'stripes' }, orch: { melody: 'piano', harmony: 'flute', chords: 'piano' },
    sections: {
      P: { mel: 'r:1 B4:.25 A4 G#4 A4', ch: 'E' },
      A: {
        mel: 'C5:.5 r:.5 D5:.25 C5 B4 C5 | E5:.5 r:.5 F5:.25 E5 D#5 E5 | B5:.25 A5 G#5 A5 B5 A5 G#5 A5 | C6:1 A5:.5 C6:.5 | B5:.5 A5 G5 A5 | B5:.5 A5 G5 A5 | B5:.5 A5 G5 F#5 | E5:1 B4:.25 A4 G#4 A4',
        ch: 'Am | Am | E | Am | Em | Am | B7 | E',
      },
      A2: {
        mel: 'C5:.5 r:.5 D5:.25 C5 B4 C5 | E5:.5 r:.5 F5:.25 E5 D#5 E5 | B5:.25 A5 G#5 A5 B5 A5 G#5 A5 | C6:1 A5:.5 C6:.5 | B5:.5 A5 G5 F5 | E5:.5 D5 C5 B4 | A4:1 A5:1 | r:1 B4:.25 A4 G#4 A4',
        ch: 'Am | Am | E | Am | G7 | E7 | Am | E',
      },
      AF: {
        mel: 'C5:.5 r:.5 D5:.25 C5 B4 C5 | E5:.5 r:.5 F5:.25 E5 D#5 E5 | B5:.25 A5 G#5 A5 B5 A5 G#5 A5 | C6:1 A5:.5 C6:.5 | B5:.5 A5 G5 F5 | E5:.5 D5 C5 B4 | A4:.5 E5 A5:1 | A4:2',
        ch: 'Am | Am | E | Am | G7 | E7 | Am | Am',
      },
      Ab: { of: 'A', dyn: 1.12 }, A2b: { of: 'A2', dyn: 1.12 },
    },
    form: ['P', 'A', 'A2', 'Ab', 'A2b', 'A', 'A2', 'Ab', 'AF'],
  },
  {
    id: 'blue-danube', title: '아름답고 푸른 도나우', en: 'The Blue Danube', composer: '요한 슈트라우스 2세', composerEn: 'Johann Strauss II', life: '1825–1899',
    work: '왈츠 Op.314 (1866)', pd: PD_DEAD(1899), bpm: 168, timeSig: [3, 4], key: 'D', genre: '왈츠', mood: '우아한', style: 'waltz',
    cover: { hue: 200, motif: 'waves' }, orch: { melody: 'violin', harmony: 'flute', chords: 'strings' },
    sections: {
      A: {
        mel: 'D4:1 D4 F#4 | A4:3 | r:1 A5 A5 | r:1 F#5 F#5 | D4:1 D4 F#4 | A4:3 | r:1 A5 A5 | r:1 G5 G5 | C#4:1 C#4 E4 | B4:3 | r:1 B5 B5 | r:1 G5 G5 | C#4:1 C#4 E4 | B4:3 | r:1 B5 B5 | r:1 F#5 F#5',
        ch: 'D | D | D | D | D | D | D | A7 | A7 | A7 | A7 | A7 | A7 | A7 | A7 | D',
      },
      B: {
        mel: 'D4:1 D4 F#4 | A4:1 D5:2 | r:1 D6 D6 | r:1 A5 A5 | D4:1 D4 F#4 | A4:1 D5:2 | r:1 D6 D6 | r:1 B5 B5 | E4:1 E4 G4 | B4:3 | r:1 G#5 A5 | F#5:3 | D5:2 F#4:1 | F#4:2 E4:1 | B4:2 A4:1 | D4:3',
        ch: 'D | D | D | D | D | D | D | G | G | G | E7 | D | D | A7 | A7 | D',
      },
      A2: { of: 'A', dyn: 1.1 }, B2: { of: 'B', dyn: 1.1 },
    },
    form: ['A', 'B', 'A2', 'B2'],
  },
  {
    id: 'mountain-king', title: '산왕의 궁전에서', en: 'In the Hall of the Mountain King', composer: '그리그', composerEn: 'Edvard Grieg', life: '1843–1907',
    work: '페르 귄트 Op.23 (1875)', pd: PD_DEAD(1907), bpm: 100, timeSig: [4, 4], key: 'Bm', genre: '관현악', mood: '점점 빨라지는', style: 'march',
    tempos: [[0, 100], [32, 112], [64, 126], [96, 142], [128, 160], [144, 176]],
    cover: { hue: 280, motif: 'mountains' }, orch: { melody: 'cello', harmony: 'violin', chords: 'strings' }, pattern: { bass: 'pizz' },
    sections: {
      A: { mel: 'B3:.5 C#4 D4 E4 F#4 D4 F#4:1 | F4:.5 C#4 F4:1 E4:.5 C4 E4:1 | B3:.5 C#4 D4 E4 F#4 D4 F#4 B4 | A4:.5 F#4 D4 F#4 A4:2', ch: 'Bm | C#7:2 C:2 | Bm | D' },
      B: { mel: 'F#4:.5 G#4 A#4 B4 C#5 A#4 C#5:1 | D5:.5 A#4 D5:1 C#5:.5 A#4 C#5:1 | F#4:.5 G#4 A#4 B4 C#5 A#4 C#5:1 | D5:.5 A#4 D5:1 C#5:2', ch: 'F# | F# | F# | F#' },
      A8: { of: 'A', oct: 12, dyn: 1.15 }, B8: { of: 'B', oct: 12, dyn: 1.15 },
      END: { mel: 'B4:1 r:1 B3:1 r:1', ch: 'Bm' },
    },
    form: ['A', 'B', 'A', 'B', 'A8', 'B8', 'A8', 'B8', 'A8', 'B8', 'END'],
  },
  {
    id: 'spring', title: '사계 중 봄', en: 'Spring (The Four Seasons)', composer: '비발디', composerEn: 'Antonio Vivaldi', life: '1678–1741',
    work: '바이올린 협주곡 RV 269 1악장 (1725)', pd: PD_DEAD(1741), bpm: 92, timeSig: [4, 4], key: 'E', genre: '바로크', mood: '상쾌한', style: 'baroque',
    cover: { hue: 105, motif: 'leaves' }, orch: { melody: 'violin', harmony: 'violin', chords: 'strings' },
    sections: {
      P: { mel: 'r:3.5 E4:.5', ch: 'E' },
      R: {
        mel: 'G#4:.5 G#4 G#4 F#4:.25 E4 B4:1.5 B4:.25 A4 | G#4:.5 G#4 G#4 F#4:.25 E4 B4:1.5 B4:.25 A4 | G#4:.5 A4:.25 B4 A4:.5 G#4 F#4:1 D#4:.5 B3 | G#4:.5 A4:.25 B4 A4:.5 G#4 F#4:1 D#4:.5 B3 | E4:2 r:1.5 E4:.5',
        ch: 'E | E | E B | E B | E',
      },
      B: {
        mel: 'G#5:.25 A5 G#5 A5 G#5 A5 G#5 A5 B5:1 r:1 | F#5:.25 G#5 F#5 G#5 F#5 G#5 F#5 G#5 A5:1 r:1 | G#5:.5 E5 B4 E5 G#5 E5 B4 E5 | F#5:.5 D#5 B4 D#5 F#5:1 r:.5 E4:.5',
        ch: 'E | B7 | E | B',
      },
      RF: {
        mel: 'G#4:.5 G#4 G#4 F#4:.25 E4 B4:1.5 B4:.25 A4 | G#4:.5 G#4 G#4 F#4:.25 E4 B4:1.5 B4:.25 A4 | G#4:.5 A4:.25 B4 A4:.5 G#4 F#4:1 D#4:.5 B3 | G#4:.5 A4:.25 B4 A4:.5 G#4 F#4:1 D#4:.5 B3 | E4:4',
        ch: 'E | E | E B | E B | E',
      },
    },
    form: ['P', 'R', 'B', 'R', 'B', 'RF'],
  },
  {
    id: 'can-can', title: '캉캉', en: 'Can-can (Galop infernal)', composer: '오펜바흐', composerEn: 'Jacques Offenbach', life: '1819–1880',
    work: '오페레타 천국과 지옥 (1858)', pd: PD_DEAD(1880), bpm: 150, timeSig: [2, 4], key: 'C', genre: '오페레타', mood: '신나는', style: 'gallop',
    cover: { hue: 340, motif: 'dots' }, orch: { melody: 'trumpet', harmony: 'violin', chords: 'piano' },
    sections: {
      A: { mel: 'C5:2 | D5:.5 F5 E5 D5 | G5:1 G5 | G5:.5 A5 E5 F5 | D5:1 D5 | D5:.5 F5 E5 D5 | C5:.5 C6 B5 A5 | G5:.5 F5 E5 D5', ch: 'C | G7 | C | C | G | G7 | C | G7' },
      A2: { mel: 'C5:2 | D5:.5 F5 E5 D5 | G5:1 G5 | G5:.5 A5 E5 F5 | D5:1 D5 | D5:.5 F5 E5 D5 | C5:.5 G5 D5 E5 | C5:1 r:1', ch: 'C | G7 | C | C | G | G7 | C G7 | C' },
      AL: { of: 'A', oct: -12, dyn: 0.95 }, AL2: { of: 'A2', oct: -12, dyn: 0.95 },
      Ab: { of: 'A', dyn: 1.15 }, A2b: { of: 'A2', dyn: 1.15 },
    },
    form: ['A', 'A2', 'AL', 'AL2', 'A', 'A2', 'Ab', 'A2b', 'Ab', 'A2b'],
  },
  {
    id: 'swan-lake', title: '백조의 호수', en: 'Swan Lake (Scene)', composer: '차이콥스키', composerEn: 'Pyotr Ilyich Tchaikovsky', life: '1840–1893',
    work: '발레 백조의 호수 Op.20 2막 정경 (1876)', pd: PD_DEAD(1893), bpm: 72, timeSig: [4, 4], key: 'Bm', genre: '발레', mood: '애절한', style: 'ballad',
    cover: { hue: 192, motif: 'moon' }, orch: { melody: 'flute', harmony: 'strings', chords: 'piano' },
    sections: {
      A: { mel: 'F#5:2 B4:.5 C#5 D5 E5 | F#5:3 D5:1 | F#5:3 D5:1 | F#5:3 B4:1 | D5:1 B4 G4 D5 | B4:4', ch: 'Bm | Bm | D | Bm | G | Bm' },
      AL: { of: 'A', oct: -12, dyn: 1.05 },
      A2: { of: 'A', dyn: 1.18 },
    },
    form: ['A', 'AL', 'A2'],
  },
  {
    id: 'minuet-g', title: '미뉴에트 G장조', en: 'Minuet in G', composer: '페촐트', composerEn: 'Christian Petzold', life: '1677–1733',
    work: '안나 막달레나 바흐를 위한 음악 수첩 (1725, 예전엔 바흐 작품으로 알려짐)', pd: PD_DEAD(1733), bpm: 132, timeSig: [3, 4], key: 'G', genre: '바로크', mood: '단정한', style: 'waltz',
    cover: { hue: 32, motif: 'diamonds' }, orch: { melody: 'piano', harmony: 'flute', chords: 'strings' }, pattern: { bass: 'long', drums: 'light', perc: 'beat' },
    sections: {
      A: {
        mel: 'D5:1 G4:.5 A4 B4 C5 | D5:1 G4 G4 | E5:1 C5:.5 D5 E5 F#5 | G5:1 G4 G4 | C5:1 D5:.5 C5 B4 A4 | B4:1 C5:.5 B4 A4 G4 | F#4:1 G4:.5 A4 B4 G4 | A4:3 | D5:1 G4:.5 A4 B4 C5 | D5:1 G4 G4 | E5:1 C5:.5 D5 E5 F#5 | G5:1 G4 G4 | C5:1 D5:.5 C5 B4 A4 | B4:1 C5:.5 B4 A4 G4 | A4:1 B4:.5 A4 G4 F#4 | G4:3',
        ch: 'G | G | C | G | C | G | D7 | D | G | G | C | G | C | G | D7 | G',
      },
      B: {
        mel: 'B5:1 G5:.5 A5 B5 G5 | A5:1 D5:.5 E5 F#5 D5 | G5:1 E5:.5 F#5 G5 D5 | C#5:1 B4:.5 C#5 A4:1 | A4:.5 B4 C#5 D5 E5 F#5 | G5:1 F#5 E5 | F#5:1 A4 C#5 | D5:3 | D5:1 G4:.5 F#4 G4:1 | E5:1 G4:.5 F#4 G4:1 | D5:1 C5 B4 | A4:.5 G4 F#4 G4 A4:1 | D4:.5 E4 F#4 G4 A4 B4 | C5:1 B4 A4 | B4:.5 D5 G4:1 F#4 | G4:3',
        ch: 'G | D | G | A | A | A7 | D:1 A7:2 | D | G | C | G | D7 | G | Am | G:2 D7:1 | G',
      },
    },
    form: ['A', 'B', 'A', 'B'],
  },
  {
    id: 'gymnopedie', title: '짐노페디 1번', en: 'Gymnopédie No. 1', composer: '사티', composerEn: 'Erik Satie', life: '1866–1925',
    work: '세 개의 짐노페디 (1888)', pd: PD_DEAD(1925), bpm: 72, timeSig: [3, 4], key: 'D', genre: '피아노 소품', mood: '몽환적인', style: 'gymno',
    cover: { hue: 172, motif: 'moon' }, orch: { melody: 'piano', harmony: 'flute', chords: 'piano' },
    sections: {
      I: { mel: 'r:3 | r:3', ch: 'Gmaj7 | Dmaj7' },
      A: { mel: 'r:1 F#5:1 A5 | G5 F#5 C#5 | B4 C#5 D5 | A4:3 | F#4:3~ | F#4:3~ | F#4:3 | r:3', ch: 'Gmaj7 | Dmaj7 | Gmaj7 | Dmaj7 | Gmaj7 | Dmaj7 | Gmaj7 | Dmaj7' },
      AF: { mel: 'r:1 F#5:1 A5 | G5 F#5 C#5 | B4 C#5 D5 | A4:3 | F#4:3~ | F#4:3 | D4:3~ | D4:3', ch: 'Gmaj7 | Dmaj7 | Gmaj7 | Dmaj7 | Gmaj7 | Dmaj7 | Gmaj7 | D' },
    },
    form: ['I', 'A', 'A', 'AF'],
  },
  {
    id: 'new-world', title: '신세계 교향곡 2악장', en: 'New World Symphony, Largo', composer: '드보르자크', composerEn: 'Antonín Dvořák', life: '1841–1904',
    work: '교향곡 9번 "신세계로부터" 2악장 (1893)', pd: PD_DEAD(1904), bpm: 64, timeSig: [4, 4], key: 'D', genre: '교향곡', mood: '그리운', style: 'hymn',
    cover: { hue: 24, motif: 'rays' }, orch: { melody: 'horn', harmony: 'strings', chords: 'strings' },
    sections: {
      A: { mel: 'F#4:1.5 A4:.5 A4:2 | F#4:1.5 E4:.5 D4:2 | E4:1 F#4 A4 F#4 | E4:4 | F#4:1.5 A4:.5 A4:2 | F#4:1.5 E4:.5 D4:2 | E4:1 F#4 E4 D4 | D4:4', ch: 'D | D | A:2 D:2 | A | D | D | A | D' },
      A8: { of: 'A', oct: 12, dyn: 1.1 },
    },
    form: ['A', 'A8', 'A'],
  },
  {
    id: 'arirang', title: '아리랑', en: 'Arirang', composer: '한국 민요', composerEn: 'Korean folk song', life: '전래',
    work: '본조 아리랑', pd: PD_FOLK, bpm: 92, timeSig: [3, 4], key: 'C', genre: '민요', mood: '정겨운', style: 'folk',
    cover: { hue: 352, motif: 'mountains' }, orch: { melody: 'flute', harmony: 'strings', chords: 'piano' }, pattern: { bass: 'waltz', chords: 'waltz', perc: 'waltz' },
    sections: {
      A: { mel: 'G4:1.5 A4:.5 G4 A4 | C5:1.5 D5:.5 C5 D5 | E5:1 D5:.5 E5 C5 A4 | G4:1.5 A4:.5 G4 A4 | C5:1.5 D5:.5 C5 D5 | E5:.5 D5 C5 A4 G4 A4 | C5:1.5 D5:.5 C5:1 | C5:3', ch: 'C | F | Am | C | F | Am | F | C' },
      B: { mel: 'G5:2 G5:1 | G5:1.5 E5:.5 D5:1 | E5:1 D5:.5 E5 C5 A4 | G4:1.5 A4:.5 G4 A4 | C5:1.5 D5:.5 C5 D5 | E5:.5 D5 C5 A4 G4 A4 | C5:1.5 D5:.5 C5:1 | C5:3', ch: 'C | C | Am | C | F | Am | F | C' },
    },
    form: ['A', 'B', 'A', 'B'],
  },
  {
    id: 'greensleeves', title: '그린슬리브스', en: 'Greensleeves', composer: '잉글랜드 민요', composerEn: 'English folk song', life: '16세기',
    work: '16세기 잉글랜드 노래', pd: PD_FOLK, bpm: 132, timeSig: [3, 4], key: 'Am', genre: '민요', mood: '쓸쓸한', style: 'ballad',
    cover: { hue: 140, motif: 'leaves' }, orch: { melody: 'flute', harmony: 'violin', chords: 'piano' }, pattern: { bass: 'waltz', chords: 'arp3', drums: 'brush' },
    sections: {
      P: { mel: 'r:2 A4:1', ch: 'Am' },
      V: {
        mel: 'C5:2 D5:1 | E5:1.5 F5:.5 E5:1 | D5:2 B4:1 | G4:1.5 A4:.5 B4:1 | C5:2 A4:1 | A4:1.5 G#4:.5 A4:1 | B4:2 G#4:1 | E4:2 A4:1 | C5:2 D5:1 | E5:1.5 F5:.5 E5:1 | D5:2 B4:1 | G4:1.5 A4:.5 B4:1 | C5:1.5 B4:.5 A4:1 | G#4:1.5 F#4:.5 G#4:1 | A4:3~ | A4:3',
        ch: 'Am | C | G | Em | Am | F | E | E | Am | C | G | Em | Am | E | Am | Am',
      },
      R: {
        mel: 'G5:3 | G5:1.5 F#5:.5 E5:1 | D5:2 B4:1 | G4:1.5 A4:.5 B4:1 | C5:2 A4:1 | A4:1.5 G#4:.5 A4:1 | B4:2 G#4:1 | E4:3 | G5:3 | G5:1.5 F#5:.5 E5:1 | D5:2 B4:1 | G4:1.5 A4:.5 B4:1 | C5:1.5 B4:.5 A4:1 | G#4:1.5 F#4:.5 G#4:1 | A4:3~ | A4:2 A4:1',
        ch: 'C | Em | G | Em | Am | F | E | E | C | Em | G | Em | Am | E | Am | Am',
      },
      RF: {
        mel: 'G5:3 | G5:1.5 F#5:.5 E5:1 | D5:2 B4:1 | G4:1.5 A4:.5 B4:1 | C5:2 A4:1 | A4:1.5 G#4:.5 A4:1 | B4:2 G#4:1 | E4:3 | G5:3 | G5:1.5 F#5:.5 E5:1 | D5:2 B4:1 | G4:1.5 A4:.5 B4:1 | C5:1.5 B4:.5 A4:1 | G#4:1.5 F#4:.5 G#4:1 | A4:3~ | A4:3',
        ch: 'C | Em | G | Em | Am | F | E | E | C | Em | G | Em | Am | E | Am | Am',
      },
    },
    form: ['P', 'V', 'R', 'V', 'RF'],
  },
  {
    id: 'jingle-bells', title: '징글벨', en: 'Jingle Bells', composer: '피어폰트', composerEn: 'James Lord Pierpont', life: '1822–1893',
    work: 'One Horse Open Sleigh (1857)', pd: PD_DEAD(1893), bpm: 132, timeSig: [4, 4], key: 'G', genre: '캐럴', mood: '들뜬', style: 'pop',
    cover: { hue: 2, motif: 'snow' }, orch: { melody: 'glock', harmony: 'piano', chords: 'piano' }, pattern: { perc: 'tamb8' },
    sections: {
      V: {
        mel: 'D4:1 B4 A4 G4 | D4:3 D4:.5 D4:.5 | D4:1 B4 A4 G4 | E4:4 | E4:1 C5 B4 A4 | F#4:4 | D5:1 D5 C5 A4 | B4:4 | D4:1 B4 A4 G4 | D4:4 | D4:1 B4 A4 G4 | E4:4 | E4:1 C5 B4 A4 | D5:1 D5 D5 D5 | E5:1 D5 C5 A4 | G4:2 r:2',
        ch: 'G | G | G | C | C | D | D7 | G | G | G | G | C | Am | D | D7 | G',
      },
      C: {
        mel: 'B4:1 B4 B4:2 | B4:1 B4 B4:2 | B4:1 D5 G4:1.5 A4:.5 | B4:4 | C5:1 C5 C5:1.5 C5:.5 | C5:1 B4 B4 B4:.5 B4:.5 | B4:1 A4 A4 B4 | A4:2 D5:2 | B4:1 B4 B4:2 | B4:1 B4 B4:2 | B4:1 D5 G4:1.5 A4:.5 | B4:4 | C5:1 C5 C5:1.5 C5:.5 | C5:1 B4 B4 B4:.5 B4:.5 | D5:1 D5 C5 A4 | G4:4',
        ch: 'G | G | G | G | C | G | A7 | D7 | G | G | G | G | C | G | D7 | G',
      },
      C2: { of: 'C', dyn: 1.12 },
    },
    form: ['V', 'C', 'C2'],
  },
  {
    id: 'amazing-grace', title: '어메이징 그레이스', en: 'Amazing Grace', composer: '미국 민요', composerEn: 'American folk hymn (New Britain)', life: '1829',
    work: '찬송 선율 New Britain (1829)', pd: PD_FOLK, bpm: 80, timeSig: [3, 4], key: 'G', genre: '찬송', mood: '따뜻한', style: 'hymn',
    cover: { hue: 48, motif: 'rays' }, orch: { melody: 'choir', harmony: 'strings', chords: 'strings' }, pattern: { bass: 'waltz', drums: 'brush' },
    sections: {
      P: { mel: 'r:2 D4:1', ch: 'G' },
      A: {
        mel: 'G4:2 B4:.5 G4:.5 | B4:2 A4:1 | G4:2 E4:1 | D4:2 D4:1 | G4:2 B4:.5 G4:.5 | B4:2 A4:1 | D5:3~ | D5:2 B4:1 | D5:1.5 B4:.5 D5 B4 | G4:2 D4:1 | E4:1.5 G4:.5 G4 E4 | D4:2 D4:1 | G4:2 B4:.5 G4:.5 | B4:2 A4:1 | G4:3~ | G4:2 D4:1',
        ch: 'G | G7 | C | G | G | G | D | D7 | G | G | C | G | G | D7 | G | G',
      },
      AF: {
        mel: 'G4:2 B4:.5 G4:.5 | B4:2 A4:1 | G4:2 E4:1 | D4:2 D4:1 | G4:2 B4:.5 G4:.5 | B4:2 A4:1 | D5:3~ | D5:2 B4:1 | D5:1.5 B4:.5 D5 B4 | G4:2 D4:1 | E4:1.5 G4:.5 G4 E4 | D4:2 D4:1 | G4:2 B4:.5 G4:.5 | B4:2 A4:1 | G4:3~ | G4:3',
        ch: 'G | G7 | C | G | G | G | D | D7 | G | G | C | G | G | D7 | G | G',
        dyn: 1.1,
      },
    },
    form: ['P', 'A', 'AF'],
  },
  {
    id: 'brahms-lullaby', title: '브람스의 자장가', en: "Brahms' Lullaby", composer: '브람스', composerEn: 'Johannes Brahms', life: '1833–1897',
    work: '자장가 Op.49 No.4 (1868)', pd: PD_DEAD(1897), bpm: 72, timeSig: [3, 4], key: 'F', genre: '가곡', mood: '포근한', style: 'lullaby',
    cover: { hue: 232, motif: 'moon' }, orch: { melody: 'celesta', harmony: 'flute', chords: 'piano' },
    sections: {
      P: { mel: 'r:2 A4:.5 A4:.5', ch: 'F' },
      A: {
        mel: 'C5:2 A4:.5 A4:.5 | C5:2 A4:.5 C5:.5 | F5:1 E5:1.5 D5:.5 | D5:1 C5:1 G4:.5 A4:.5 | Bb4:1 G4:1 G4:.5 A4:.5 | Bb4:2 G4:.5 Bb4:.5 | E5:.5 D5:.5 C5:1 E5:1 | F5:2 F4:.5 F4:.5 | F5:2 D5:.5 Bb4:.5 | C5:2 A4:.5 F4:.5 | Bb4:1 C5:1 D5:1 | C5:2 F4:.5 F4:.5 | F5:2 D5:.5 Bb4:.5 | C5:2 A4:.5 F4:.5 | Bb4:1 A4:1 G4:1 | F4:2 A4:.5 A4:.5',
        ch: 'F | F | C7 | C7 | C7 | C7 | C | F | Bb | F | C7 | F | Bb | F | C7 | F',
      },
      AF: {
        mel: 'C5:2 A4:.5 A4:.5 | C5:2 A4:.5 C5:.5 | F5:1 E5:1.5 D5:.5 | D5:1 C5:1 G4:.5 A4:.5 | Bb4:1 G4:1 G4:.5 A4:.5 | Bb4:2 G4:.5 Bb4:.5 | E5:.5 D5:.5 C5:1 E5:1 | F5:2 F4:.5 F4:.5 | F5:2 D5:.5 Bb4:.5 | C5:2 A4:.5 F4:.5 | Bb4:1 C5:1 D5:1 | C5:2 F4:.5 F4:.5 | F5:2 D5:.5 Bb4:.5 | C5:2 A4:.5 F4:.5 | Bb4:1 A4:1 G4:1 | F4:3',
        ch: 'F | F | C7 | C7 | C7 | C7 | C | F | Bb | F | C7 | F | Bb | F | C7 | F',
      },
    },
    form: ['P', 'A', 'AF'],
  },
  {
    id: 'korobeiniki', title: '코로베이니키', en: 'Korobeiniki', composer: '러시아 민요', composerEn: 'Russian folk song', life: '19세기',
    work: '네크라소프의 시에 붙은 민요 (1861)', pd: PD_FOLK, bpm: 150, timeSig: [4, 4], key: 'Am', genre: '민요', mood: '빠른', style: 'pop',
    cover: { hue: 14, motif: 'blocks' }, orch: { melody: 'violin', harmony: 'flute', chords: 'piano' }, pattern: { perc: 'off8' },
    sections: {
      A: { mel: 'E5:1 B4:.5 C5 D5:1 C5:.5 B4 | A4:1 A4:.5 C5 E5:1 D5:.5 C5 | B4:1.5 C5:.5 D5:1 E5 | C5:1 A4 A4:2 | D5:1.5 F5:.5 A5:1 G5:.5 F5 | E5:1.5 C5:.5 E5:1 D5:.5 C5 | B4:1 B4:.5 C5 D5:1 E5 | C5:1 A4 A4:2', ch: 'E | Am | E | Am | Dm | C | E | Am' },
      B: { mel: 'E4:2 C4 | D4 B3 | C4 A3 | G#3 B3 | E4 C4 | D4 B3 | C4:1 E4 A4:2 | G#4:4', ch: 'Am | G | Am | E | Am | G | Am | E' },
      B8: { of: 'B', oct: 12, dyn: 1.1 },
      A2: { of: 'A', dyn: 1.12 },
    },
    form: ['A', 'A', 'B', 'B8', 'A2', 'A2'],
  },
  {
    id: 'saints', title: '성자의 행진', en: 'When the Saints Go Marching In', composer: '미국 민요', composerEn: 'American spiritual', life: '전래',
    work: '흑인 영가', pd: PD_FOLK, bpm: 116, timeSig: [4, 4], key: 'C', genre: '영가', mood: '흥겨운', style: 'march',
    cover: { hue: 40, motif: 'notes' }, orch: { melody: 'trumpet', harmony: 'horn', chords: 'piano' }, pattern: { perc: 'clap24' },
    sections: {
      A: {
        mel: 'r:1 C5 E5 F5 | G5:4 | r:1 C5 E5 F5 | G5:4 | r:1 C5 E5 F5 | G5:2 E5:2 | C5:2 E5:2 | D5:4 | r:1 E5 E5 D5 | C5:3 C5:1 | E5:2 G5:2 | G5:1 F5:3 | r:1 C5 E5 F5 | G5:2 E5:2 | C5:2 D5:2 | C5:4',
        ch: 'C | C | C | C | C | C | C | G7 | C | C7 | C | F | C | C | G7 | C',
      },
      A2: { of: 'A', dyn: 1.15 },
    },
    form: ['A', 'A2'],
  },
  {
    id: 'twinkle', title: '반짝반짝 작은 별', en: 'Twinkle Twinkle Little Star', composer: '프랑스 민요', composerEn: 'French folk song', life: '18세기',
    work: '아, 어머니께 말씀드릴게요 (모차르트 변주곡 K.265 주제)', pd: PD_FOLK, bpm: 108, timeSig: [4, 4], key: 'C', genre: '동요', mood: '맑은', style: 'lullaby',
    cover: { hue: 250, motif: 'stars' }, orch: { melody: 'glock', harmony: 'flute', chords: 'piano' }, pattern: { bass: 'half', chords: 'arp' },
    sections: {
      A: {
        mel: 'C5:1 C5 G5 G5 | A5 A5 G5:2 | F5:1 F5 E5 E5 | D5 D5 C5:2 | G5:1 G5 F5 F5 | E5 E5 D5:2 | G5:1 G5 F5 F5 | E5 E5 D5:2 | C5:1 C5 G5 G5 | A5 A5 G5:2 | F5:1 F5 E5 E5 | D5 D5 C5:2',
        ch: 'C | F C | F C | G C | C G7 | C G | C G7 | C G | C | F C | F C | G C',
      },
      AL: { of: 'A', oct: -12 },
      A2: { of: 'A', dyn: 1.1 },
    },
    form: ['A', 'AL', 'A2'],
  },
  {
    id: 'auld-lang-syne', title: '석별의 정', en: 'Auld Lang Syne', composer: '스코틀랜드 민요', composerEn: 'Scottish folk song', life: '18세기',
    work: '로버트 번스가 가사를 붙인 옛 선율 (1788)', pd: PD_FOLK, bpm: 92, timeSig: [4, 4], key: 'F', genre: '민요', mood: '아련한', style: 'ballad',
    cover: { hue: 34, motif: 'burst' }, orch: { melody: 'violin', harmony: 'horn', chords: 'piano' },
    sections: {
      P: { mel: 'r:3 C4:1', ch: 'F' },
      V: { mel: 'F4:1.5 F4:.5 F4:1 A4:1 | G4:1.5 F4:.5 G4:1 A4:1 | F4:1.5 F4:.5 A4:1 C5:1 | D5:3 D5:1 | C5:1.5 A4:.5 A4:1 F4:1 | G4:1.5 F4:.5 G4:1 A4:1 | F4:1.5 D4:.5 D4:1 C4:1 | F4:3 D5:1', ch: 'F | C7 | F | Bb | F | C7 | Bb:2 C7:2 | F' },
      C: { mel: 'C5:1.5 A4:.5 A4:1 F4:1 | G4:1.5 F4:.5 G4:1 D5:1 | C5:1.5 A4:.5 A4:1 C5:1 | D5:3 F5:1 | C5:1.5 A4:.5 A4:1 F4:1 | G4:1.5 F4:.5 G4:1 A4:1 | F4:1.5 D4:.5 D4:1 C4:1 | F4:3 C4:1', ch: 'F | C7 | F | Bb | F | C7 | Bb:2 C7:2 | F' },
      CF: { mel: 'C5:1.5 A4:.5 A4:1 F4:1 | G4:1.5 F4:.5 G4:1 D5:1 | C5:1.5 A4:.5 A4:1 C5:1 | D5:3 F5:1 | C5:1.5 A4:.5 A4:1 F4:1 | G4:1.5 F4:.5 G4:1 A4:1 | F4:1.5 D4:.5 D4:1 C4:1 | F4:4', ch: 'F | C7 | F | Bb | F | C7 | Bb:2 C7:2 | F', dyn: 1.1 },
    },
    form: ['P', 'V', 'C', 'V', 'CF'],
  },
  {
    id: 'silent-night', title: '고요한 밤 거룩한 밤', en: 'Silent Night', composer: '그루버', composerEn: 'Franz Xaver Gruber', life: '1787–1863',
    work: 'Stille Nacht (1818)', pd: PD_DEAD(1863), bpm: 84, timeSig: [6, 8], key: 'C', genre: '캐럴', mood: '고요한', style: 'lullaby',
    cover: { hue: 222, motif: 'snow' }, orch: { melody: 'flute', harmony: 'choir', chords: 'piano' },
    sections: {
      A: {
        mel: 'G4:1.5 A4:.5 G4:1 | E4:3 | G4:1.5 A4:.5 G4:1 | E4:3 | D5:2 D5:1 | B4:3 | C5:2 C5:1 | G4:3 | A4:2 A4:1 | C5:1.5 B4:.5 A4:1 | G4:1.5 A4:.5 G4:1 | E4:3 | A4:2 A4:1 | C5:1.5 B4:.5 A4:1 | G4:1.5 A4:.5 G4:1 | E4:3 | D5:2 D5:1 | F5:1.5 D5:.5 B4:1 | C5:3 | E5:3 | C5:1 G4:1 E4:1 | G4:1.5 F4:.5 D4:1 | C4:3~ | C4:3',
        ch: 'C | C | C | C | G | G | C | C | F | F | C | C | F | F | C | C | G | G7 | C | C | C | G7 | C | C',
      },
      A2: { of: 'A', dyn: 1.1 },
    },
    form: ['A', 'A2'],
  },
  {
    id: 'deck-the-halls', title: '덱 더 홀스', en: 'Deck the Halls', composer: '웨일스 민요', composerEn: 'Welsh folk carol', life: '16세기',
    work: '웨일스 옛 선율 Nos Galan', pd: PD_FOLK, bpm: 116, timeSig: [4, 4], key: 'F', genre: '캐럴', mood: '즐거운', style: 'folk',
    cover: { hue: 128, motif: 'diamonds' }, orch: { melody: 'flute', harmony: 'violin', chords: 'piano' }, pattern: { perc: 'tamb8' },
    sections: {
      A: {
        mel: 'C5:1.5 Bb4:.5 A4:1 G4:1 | F4:1 G4 A4 F4 | G4:.5 A4 Bb4 G4 A4:1.5 G4:.5 | F4:1 E4 F4:2 | C5:1.5 Bb4:.5 A4:1 G4:1 | F4:1 G4 A4 F4 | G4:.5 A4 Bb4 G4 A4:1.5 G4:.5 | F4:1 E4 F4:2 | G4:1.5 A4:.5 Bb4:1 G4:1 | A4:1.5 Bb4:.5 C5:1 G4:1 | A4:.5 B4 C5:1 D5:.5 E5 F5:1 | E5:1 D5 C5:2 | C5:1.5 Bb4:.5 A4:1 G4:1 | F4:1 G4 A4 F4 | D5:.5 D5 D5 D5 C5:1.5 Bb4:.5 | A4:1 G4 F4:2',
        ch: 'F | F | C7 F | C7 F | F | F | C7 F | C7 F | C7 | F C | G C | C | F | F | Bb C7 | F:1 C7:1 F:2',
      },
      A2: { of: 'A', dyn: 1.12 },
    },
    form: ['A', 'A2'],
  },
  {
    id: 'joy-to-the-world', title: '기쁘다 구주 오셨네', en: 'Joy to the World', composer: '로웰 메이슨', composerEn: 'Lowell Mason', life: '1792–1872',
    work: '찬송 선율 Antioch (1839)', pd: PD_DEAD(1872), bpm: 100, timeSig: [2, 4], key: 'D', genre: '캐럴', mood: '환한', style: 'march',
    cover: { hue: 356, motif: 'burst' }, orch: { melody: 'trumpet', harmony: 'horn', chords: 'strings' },
    sections: {
      A: {
        mel: 'D5:1 C#5:.75 B4:.25 | A4:1.5 G4:.5 | F#4:1 E4:1 | D4:1.5 A4:.5 | B4:1.5 B4:.5 | C#5:1.5 C#5:.5 | D5:1.5 D5:.5 | D5:.5 C#5 B4 A4 | A4:.75 G4:.25 F#4:.5 D5:.5 | D5:.5 C#5 B4 A4 | A4:.75 G4:.25 F#4:.5 F#4:.5 | F#4:.5 F#4 F#4 F#4:.25 G4:.25 | A4:1.5 G4:.25 F#4:.25 | E4:.5 E4 E4 E4:.25 F#4:.25 | G4:1.5 F#4:.25 E4:.25 | D4:.5 D5:1 B4:.5 | A4:.75 G4:.25 F#4:.5 G4:.5 | F#4:1 E4:1 | D4:2',
        ch: 'D | D | D A7 | D | G | A | D | D | D | D | D | D | D | A7 | A7 | D G | D A7 | D A7 | D',
      },
      A2: { of: 'A', dyn: 1.08 }, A3: { of: 'A', dyn: 1.16 },
    },
    form: ['A', 'A2', 'A3'],
  },
  {
    id: 'frere-jacques', title: '자크 형제 (돌림노래)', en: 'Frère Jacques', composer: '프랑스 민요', composerEn: 'French folk round', life: '18세기',
    work: '돌림노래', pd: PD_FOLK, bpm: 116, timeSig: [4, 4], key: 'C', genre: '동요', mood: '장난스러운', style: 'folk',
    canon: 8, canonEndAuto: false, cover: { hue: 88, motif: 'rings' }, orch: { melody: 'flute', harmony: 'violin', chords: 'piano' },
    sections: {
      A: { mel: 'C5:1 D5 E5 C5 | C5 D5 E5 C5 | E5 F5 G5:2 | E5:1 F5 G5:2 | G5:.5 A5 G5 F5 E5:1 C5 | G5:.5 A5 G5 F5 E5:1 C5 | C5:1 G4 C5:2 | C5:1 G4 C5:2', ch: 'C | C | C | C | C | C | C | C' },
      A2: { of: 'A', dyn: 1.1 },
    },
    form: ['A', 'A', 'A2', 'A2'],
  },
  {
    id: 'happy-birthday', title: '생일 축하 노래', en: 'Happy Birthday to You', composer: '힐 자매', composerEn: 'Mildred J. Hill & Patty Hill', life: '1859–1916 · 1868–1946',
    work: 'Good Morning to All (1893)', pd: '두 작곡가 모두 사망 후 70년이 지나 2017년부터 퍼블릭 도메인', bpm: 96, timeSig: [3, 4], key: 'C', genre: '축하곡', mood: '축하하는', style: 'waltz',
    cover: { hue: 318, motif: 'hearts' }, orch: { melody: 'piano', harmony: 'flute', chords: 'piano' },
    sections: {
      P: { mel: 'r:2 G4:.75 G4:.25', ch: 'C' },
      A: { mel: 'A4:1 G4 C5 | B4:2 G4:.75 G4:.25 | A4:1 G4 D5 | C5:2 G4:.75 G4:.25 | G5:1 E5 C5 | B4:1 A4 F5:.75 F5:.25 | E5:1 C5 D5 | C5:2 G4:.75 G4:.25', ch: 'C | G7 | G7 | C | C | F | C:2 G7:1 | C' },
      AF: { mel: 'A4:1 G4 C5 | B4:2 G4:.75 G4:.25 | A4:1 G4 D5 | C5:2 G4:.75 G4:.25 | G5:1 E5 C5 | B4:1 A4 F5:.75 F5:.25 | E5:1 C5 D5 | C5:3', ch: 'C | G7 | G7 | C | C | F | C:2 G7:1 | C', dyn: 1.1 },
    },
    form: ['P', 'A', 'A', 'A', 'AF'],
  },
];

export const SONGS = DEFS.map(buildSong);
export const SONG_IDS = SONGS.map((s) => s.id);
export function getSong(id) { return SONGS.find((s) => s.id === id) || null; }
