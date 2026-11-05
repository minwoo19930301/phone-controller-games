// 종목마다 소리 성격을 다르게 내기 위한 작은 합성 도구.
// 예전엔 모든 종목이 "잡음 한 번 + 사인파 한 번"과 같은 도-미-솔-도 팡파르를 써서 비슷하게 들렸습니다.
// 여기서는 재질(나무·셀룰로이드·티타늄·가죽…)을 모드 합성으로, 음악 신호는 종목별 악기(오르간·마림바·종·칩튠·기타·신스 브라스)로 냅니다.
// 모든 함수는 (ctx, out) 을 받습니다. out 은 종목의 마스터 노드(없으면 ctx.destination)입니다.

const noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.5), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}
function panned(ctx, out, pan) {
  if (!pan || !ctx.createStereoPanner) return out;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(out);
  return p;
}

/** 모드 합성 타격음: partials = [[주파수, 세기, 감쇠초], ...]. 재질의 '울림 무늬'가 곧 소리 성격입니다. */
export function modal(ctx, out, partials, { gain = 0.3, when = 0, pan = 0, pitch = 1, drop = 0 } = {}) {
  const t = ctx.currentTime + when;
  const dst = panned(ctx, out, pan);
  for (const [f, g, dec] of partials) {
    const o = ctx.createOscillator();
    const e = ctx.createGain();
    o.frequency.setValueAtTime(f * pitch, t);
    if (drop) o.frequency.exponentialRampToValueAtTime(f * pitch * (1 - drop), t + dec);
    e.gain.setValueAtTime(0.0001, t);
    e.gain.linearRampToValueAtTime(g * gain, t + 0.0015);
    e.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    o.connect(e).connect(dst);
    o.start(t);
    o.stop(t + dec + 0.02);
  }
}

/** 걸러진 잡음 한 토막(딱·쉭·퍽 같은 '접촉' 부분). */
export function grit(ctx, out, { sec = 0.03, freq = 3000, q = 0.8, type = 'bandpass', gain = 0.3, when = 0, pan = 0, attack = 0.001, sweep = 0 } = {}) {
  const t = ctx.currentTime + when;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + sec);
  f.Q.value = q;
  const e = ctx.createGain();
  e.gain.setValueAtTime(0.0001, t);
  e.gain.linearRampToValueAtTime(gain, t + attack);
  e.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  s.connect(f).connect(e).connect(panned(ctx, out, pan));
  s.start(t, Math.random() * 0.5);
  s.stop(t + sec + 0.02);
}

// ---------- 악기 ----------
const hz = (root, semi) => root * Math.pow(2, semi / 12);

/** 야구장 오르간: 드로바 배음을 더한 소리 + 느린 비브라토 */
export function organ(ctx, out, f, sec, { gain = 0.08, when = 0 } = {}) {
  const t = ctx.currentTime + when;
  const e = ctx.createGain();
  e.gain.setValueAtTime(0.0001, t);
  e.gain.linearRampToValueAtTime(gain, t + 0.015);
  e.gain.setValueAtTime(gain, t + sec - 0.05);
  e.gain.exponentialRampToValueAtTime(0.0001, t + sec + 0.08);
  e.connect(out);
  const vib = ctx.createOscillator();
  const vg = ctx.createGain();
  vib.frequency.value = 6.2;
  vg.gain.value = f * 0.006;
  vib.connect(vg);
  for (const [m, g] of [[0.5, 0.5], [1, 1], [2, 0.7], [3, 0.35], [4, 0.3], [6, 0.12]]) {
    const o = ctx.createOscillator();
    o.frequency.value = f * m;
    vg.connect(o.frequency);
    const og = ctx.createGain();
    og.gain.value = g / 3;
    o.connect(og).connect(e);
    o.start(t);
    o.stop(t + sec + 0.1);
  }
  vib.start(t);
  vib.stop(t + sec + 0.1);
}
/** 마림바: 나무 건반의 비조화 배음(1 : 3.9 : 9.2), 짧고 둥근 소리 */
export function marimba(ctx, out, f, { gain = 0.22, when = 0, pan = 0 } = {}) {
  modal(ctx, out, [[f, 1, 0.45], [f * 3.93, 0.35, 0.12], [f * 9.2, 0.08, 0.05]], { gain, when, pan });
}
/** 종·글로켄슈필: FM 으로 맑게 오래 울리는 소리 */
export function bell(ctx, out, f, { gain = 0.12, when = 0, sec = 1.4, ratio = 3.5, depth = 2.2 } = {}) {
  const t = ctx.currentTime + when;
  const car = ctx.createOscillator();
  const mod = ctx.createOscillator();
  const mg = ctx.createGain();
  car.frequency.value = f;
  mod.frequency.value = f * ratio;
  mg.gain.setValueAtTime(f * depth, t);
  mg.gain.exponentialRampToValueAtTime(f * 0.05, t + sec);
  mod.connect(mg).connect(car.frequency);
  const e = ctx.createGain();
  e.gain.setValueAtTime(0.0001, t);
  e.gain.linearRampToValueAtTime(gain, t + 0.003);
  e.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  car.connect(e).connect(out);
  car.start(t);
  mod.start(t);
  car.stop(t + sec + 0.05);
  mod.stop(t + sec + 0.05);
}
/** 오락실 칩튠: 펄스폭이 좁은 사각파 + 빠른 아르페지오 */
export function chip(ctx, out, f, sec, { gain = 0.06, when = 0, duty = 0.125 } = {}) {
  const t = ctx.currentTime + when;
  const n = 32;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  const o = ctx.createOscillator();
  o.setPeriodicWave(ctx.createPeriodicWave(real, imag));
  o.frequency.value = f;
  const e = ctx.createGain();
  e.gain.setValueAtTime(gain, t);
  e.gain.setValueAtTime(gain, t + sec * 0.8);
  e.gain.linearRampToValueAtTime(0.0001, t + sec);
  o.connect(e).connect(out);
  o.start(t);
  o.stop(t + sec + 0.02);
}
/** 통기타 뜯는 소리(카플러스-스트롱 근사): 잡음 한 토막을 짧은 지연으로 되먹임 */
export function pluck(ctx, out, f, { gain = 0.35, when = 0, sec = 1.2, pan = 0 } = {}) {
  const t = ctx.currentTime + when;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  const burst = ctx.createGain();
  burst.gain.setValueAtTime(gain, t);
  burst.gain.setValueAtTime(0, t + 1 / f);
  const d = ctx.createDelay(0.05);
  d.delayTime.value = 1 / f;
  const fb = ctx.createGain();
  fb.gain.value = 0.985;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(9000, f * 8);
  const e = ctx.createGain();
  e.gain.setValueAtTime(1, t);
  e.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  s.connect(burst).connect(d);
  d.connect(lp).connect(fb).connect(d);
  lp.connect(e).connect(panned(ctx, out, pan));
  s.start(t);
  s.stop(t + 0.05);
  setTimeout(() => { try { fb.disconnect(); e.disconnect(); } catch {} }, (when + sec + 0.2) * 1000);
}
/** 신스 브라스: 살짝 어긋난 톱니파 둘 + 열리는 저역 필터(광선검 쪽 웅장한 소리) */
export function brass(ctx, out, f, sec, { gain = 0.07, when = 0 } = {}) {
  const t = ctx.currentTime + when;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 2;
  lp.frequency.setValueAtTime(f * 1.2, t);
  lp.frequency.exponentialRampToValueAtTime(f * 7, t + 0.12);
  lp.frequency.exponentialRampToValueAtTime(f * 3, t + sec);
  const e = ctx.createGain();
  e.gain.setValueAtTime(0.0001, t);
  e.gain.linearRampToValueAtTime(gain, t + 0.05);
  e.gain.setValueAtTime(gain, t + sec - 0.06);
  e.gain.exponentialRampToValueAtTime(0.0001, t + sec + 0.25);
  lp.connect(e).connect(out);
  for (const det of [-7, 7]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.detune.value = det;
    o.connect(lp);
    o.start(t);
    o.stop(t + sec + 0.3);
  }
}

/** 음표 줄: notes = [[반음, 박], ...] (반음이 null 이면 쉼). play(f, 길이초, when) 로 악기를 넘깁니다. */
export function phrase(root, notes, bpm, play) {
  const beat = 60 / bpm;
  let at = 0;
  for (const [semi, beats] of notes) {
    if (semi !== null) play(hz(root, semi), beats * beat, at);
    at += beats * beat;
  }
}
