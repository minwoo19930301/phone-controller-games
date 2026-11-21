// 줄다리기 소리: 큰북, 구령("하나·둘·영차" 목소리 흉내), 호루라기, 관중 환호, 판정 소리. 전부 WebAudio 로 합성합니다(파일 없음).
// 구령은 사람 목소리처럼 들리게 톱니파를 모음(ㅏ ㅜ ㅕ) 필터 두 개로 거르고, 음높이를 살짝 굴려서 만듭니다.
let actx = null;
let master = null;
let crowdGain = null;
export function audio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      actx = new AC();
      master = actx.createDynamicsCompressor();
      master.threshold.value = -14;
      master.ratio.value = 5;
      const out = actx.createGain();
      out.gain.value = 0.9;
      master.connect(out).connect(actx.destination);
    }
  }
  if (actx && actx.state === 'suspended') actx.resume();
  if (actx && actx.state === 'running' && !crowdGain) startCrowd();
  return actx;
}
window.addEventListener('pointerdown', audio);
window.addEventListener('keydown', audio);
const ready = () => actx && actx.state === 'running';
export const now = () => (actx ? actx.currentTime : 0);

let nbuf = null;
function noiseBuf() {
  if (!nbuf) {
    const len = Math.floor(actx.sampleRate * 1.5);
    nbuf = actx.createBuffer(1, len, actx.sampleRate);
    const d = nbuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return nbuf;
}
function noise(sec, freq, q, gain, type = 'bandpass', delay = 0, sweepTo = 0) {
  if (!ready()) return;
  const t = actx.currentTime + delay;
  const src = actx.createBufferSource();
  src.buffer = noiseBuf();
  const f = actx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + sec);
  f.Q.value = q;
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5, sec + 0.05);
}
function tone(freq, sec, gain, type = 'sine', glide = 0, delay = 0, attack = 0.004) {
  if (!ready()) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), t + sec);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + sec + 0.05);
}

// ---------- 큰북 ----------
// kind: one | two | pull | rest. delay(초) 뒤 정확히 울립니다(박 시각에 맞춤).
function drum(kind, delay = 0) {
  if (!ready()) return;
  if (kind === 'pull') {
    tone(150, 0.34, 0.9, 'sine', 0.38, delay, 0.002);
    tone(68, 0.5, 0.8, 'sine', 0.6, delay, 0.002);
    noise(0.16, 1800, 0.7, 0.45, 'bandpass', delay);
    noise(0.34, 260, 0.8, 0.4, 'lowpass', delay);
  } else {
    const hi = kind === 'two' ? 1.12 : 1;
    tone(190 * hi, 0.2, 0.5, 'sine', 0.5, delay, 0.002);
    tone(95 * hi, 0.24, 0.45, 'sine', 0.6, delay, 0.002);
    noise(0.08, 2400, 0.8, 0.18, 'bandpass', delay);
  }
}
// ---------- 구령 목소리 ----------
const VOWEL = { a: [800, 1250], u: [350, 800], yeo: [550, 1750], cha: [900, 1500] };
function shout(f0, vowel, sec, gain, delay = 0, glide = 1, bright = 0) {
  if (!ready()) return;
  const t = actx.currentTime + delay;
  const [f1, f2] = VOWEL[vowel] || VOWEL.a;
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.025);
  g.gain.setValueAtTime(gain, t + sec * 0.55);
  g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  const b1 = actx.createBiquadFilter();
  b1.type = 'bandpass'; b1.frequency.value = f1; b1.Q.value = 5;
  const b2 = actx.createBiquadFilter();
  b2.type = 'bandpass'; b2.frequency.value = f2; b2.Q.value = 7;
  const mix = actx.createGain();
  mix.gain.value = 1.6;
  b1.connect(mix);
  b2.connect(mix);
  mix.connect(g).connect(master);
  // 여러 명이 같이 외치는 소리: 살짝 어긋난 톱니파 네 개
  for (let k = 0; k < 4; k++) {
    const o = actx.createOscillator();
    o.type = 'sawtooth';
    const det = 1 + (k - 1.5) * 0.012;
    o.frequency.setValueAtTime(f0 * det, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(60, f0 * det * glide), t + sec);
    const vib = actx.createOscillator();
    const vg = actx.createGain();
    vib.frequency.value = 5 + k * 0.4;
    vg.gain.value = f0 * 0.012;
    vib.connect(vg).connect(o.frequency);
    o.connect(b1);
    o.connect(b2);
    o.start(t);
    vib.start(t);
    o.stop(t + sec + 0.05);
    vib.stop(t + sec + 0.05);
  }
  if (bright) noise(sec * 0.5, 2600, 0.8, bright, 'bandpass', delay);
}
// 하나 / 둘 / 영~차! (박 시각 delay 뒤). 스퍼트에는 짧게.
function chant(kind, delay = 0, fast = false) {
  if (!ready()) return;
  const k = fast ? 0.6 : 1;
  if (kind === 'one') { shout(150, 'a', 0.13 * k, 0.5, delay - 0.01, 0.9); shout(160, 'a', 0.11 * k, 0.4, delay + 0.14 * k, 0.9); } // 하-나
  else if (kind === 'two') shout(172, 'u', 0.2 * k, 0.5, delay - 0.01, 0.95); // 둘
  else if (kind === 'pull') {
    shout(165, 'yeo', 0.2 * k, 0.55, delay - 0.2 * k, 1.1); // 영~
    shout(205, 'cha', 0.28, 0.85, delay - 0.02, 0.8, 0.12); // 차!
  }
}
export const sfx = {
  audio,
  // 박(구령 한 칸). at: 몇 초 뒤에 울릴지(박 시각까지)
  beat(kind, at = 0, o = {}) {
    audio();
    if (kind === 'rest') return;
    drum(kind, at);
    if (!o.mute) chant(kind, at, o.fast);
  },
  whistle(at = 0, long = false) {
    audio();
    if (!ready()) return;
    const t = actx.currentTime + at;
    const o = actx.createOscillator();
    const o2 = actx.createOscillator();
    const g = actx.createGain();
    const vib = actx.createOscillator();
    const vg = actx.createGain();
    o.type = 'sine';
    o2.type = 'triangle';
    o.frequency.value = 2850;
    o2.frequency.value = 2870;
    vib.frequency.value = 38;
    vg.gain.value = 70;
    vib.connect(vg);
    vg.connect(o.frequency);
    vg.connect(o2.frequency);
    const dur = long ? 0.9 : 0.34;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.02);
    g.gain.setValueAtTime(0.32, t + dur - 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    o2.connect(g);
    g.connect(master);
    for (const n of [o, o2, vib]) { n.start(t); n.stop(t + dur + 0.05); }
    noise(dur, 3600, 2, 0.05, 'bandpass', at);
  },
  count(n) {
    audio();
    tone(n > 0 ? 660 : 990, n > 0 ? 0.16 : 0.4, 0.3, 'square', 0, 0, 0.004);
  },
  judge(j, combo = 0) {
    audio();
    if (j === 'perfect') { tone(1320, 0.18, 0.2, 'triangle', 1.0, 0, 0.003); tone(1980, 0.22, 0.12, 'sine', 1, 0.04, 0.003); }
    else if (j === 'good') tone(990, 0.14, 0.15, 'triangle', 1, 0, 0.003);
    else if (j === 'off') tone(520, 0.12, 0.1, 'triangle', 0.9, 0, 0.003);
    else if (j === 'miss') { tone(150, 0.2, 0.22, 'sawtooth', 0.6, 0, 0.003); noise(0.14, 500, 1, 0.18, 'lowpass'); }
  },
  body() { // 한 몸!
    audio();
    for (const [i, f] of [523, 659, 784, 1047].entries()) tone(f, 0.34, 0.16, 'triangle', 1, i * 0.045, 0.004);
    noise(0.4, 1200, 0.6, 0.18, 'bandpass', 0, 3200);
    this.cheer(0.7);
  },
  brace() { audio(); tone(110, 0.5, 0.35, 'sawtooth', 0.7, 0, 0.01); tone(55, 0.6, 0.5, 'sine', 0.8, 0, 0.01); },
  braceOk() { audio(); for (const [i, f] of [392, 523, 659].entries()) tone(f, 0.28, 0.18, 'square', 1, i * 0.07, 0.004); },
  sprint() { audio(); this.whistle(0, false); this.whistle(0.4, false); this.cheer(0.9); },
  roundStart() { audio(); this.whistle(0, true); },
  win() {
    audio();
    this.whistle(0, true);
    for (const [i, f] of [523, 659, 784, 1047, 784, 1047, 1319].entries()) tone(f, 0.26, 0.2, 'triangle', 1, 0.15 + i * 0.13, 0.004);
    this.cheer(1.2);
  },
  join() { audio(); tone(880, 0.1, 0.15, 'triangle', 1, 0); tone(1320, 0.14, 0.12, 'triangle', 1, 0.08); },
  thud() { audio(); tone(80, 0.3, 0.5, 'sine', 0.5, 0); noise(0.2, 300, 0.8, 0.35, 'lowpass'); },
  cheer(level = 0.6) {
    if (!ready() || !crowdGain) return;
    const t = actx.currentTime;
    crowdGain.gain.cancelScheduledValues(t);
    crowdGain.gain.setValueAtTime(Math.max(0.05, crowdGain.gain.value), t);
    crowdGain.gain.linearRampToValueAtTime(0.1 * level + 0.03, t + 0.2);
    crowdGain.gain.linearRampToValueAtTime(0.03, t + 1.8);
  },
  crowdLevel(x) {
    if (!ready() || !crowdGain) return;
    crowdGain.gain.setTargetAtTime(0.025 + 0.05 * x, actx.currentTime, 0.5);
  }
};
function startCrowd() {
  if (!ready()) return;
  const src = actx.createBufferSource();
  src.buffer = noiseBuf();
  src.loop = true;
  const f = actx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 900;
  f.Q.value = 0.5;
  const f2 = actx.createBiquadFilter();
  f2.type = 'lowpass';
  f2.frequency.value = 2400;
  crowdGain = actx.createGain();
  crowdGain.gain.value = 0.03;
  src.connect(f).connect(f2).connect(crowdGain).connect(master);
  src.start();
}
