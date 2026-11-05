// 광선검 큰 화면 소리: 드론 발사, 충전, 칼에 튕기는 소리, 격추 폭발, 피격, 점화, 슬로우, 웨이브 경보, 카운트다운, 박수.
// 칼날의 웅웅 소리는 각자 폰 스피커에서 납니다. 큰 화면은 훈련장 바탕 소음만 아주 작게 깔아 둡니다.
import { modal, grit, organ, marimba, bell, chip, pluck, brass, phrase } from '/common/voice.js';
let actx = null;
let master = null;
let ambient = null;
export function audio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      actx = new AC();
      master = actx.createDynamicsCompressor();
      master.threshold.value = -14;
      master.ratio.value = 4;
      master.connect(actx.destination);
    }
  }
  if (actx && actx.state === 'suspended') actx.resume();
  if (actx && actx.state === 'running' && !ambient) startAmbient();
  return actx;
}
window.addEventListener('pointerdown', audio);
window.addEventListener('keydown', audio);

const ready = () => actx && actx.state === 'running';

function noiseBuf(sec) {
  const len = Math.max(1, Math.floor(actx.sampleRate * sec));
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
function noise(sec, freq, q, gain, attack = 0, type = 'bandpass', sweepTo = 0) {
  if (!ready()) return;
  const a = actx;
  const src = a.createBufferSource();
  src.buffer = noiseBuf(sec);
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, a.currentTime);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, a.currentTime + sec);
  f.Q.value = q;
  const g = a.createGain();
  const t = a.currentTime;
  g.gain.setValueAtTime(attack ? 0.0001 : gain, t);
  if (attack) g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  src.connect(f).connect(g).connect(master);
  src.start();
}
function tone(freq, sec, gain, type = 'sine', glide = 0, delay = 0) {
  if (!ready()) return;
  const a = actx;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), t + sec);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + sec + 0.03);
}

function startAmbient() {
  const a = actx;
  ambient = a.createGain();
  ambient.gain.value = 0.0001;
  ambient.gain.exponentialRampToValueAtTime(0.05, a.currentTime + 2);
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 220;
  for (const [f, type, g] of [[55, 'sawtooth', 0.35], [82.6, 'sawtooth', 0.2], [110.4, 'sine', 0.3]]) {
    const o = a.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const og = a.createGain();
    og.gain.value = g;
    o.connect(og).connect(lp);
    o.start();
  }
  // 환기 소음
  const src = a.createBufferSource();
  src.buffer = noiseBuf(3);
  src.loop = true;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 500;
  bp.Q.value = 0.4;
  const ng = a.createGain();
  ng.gain.value = 0.25;
  src.connect(bp).connect(ng).connect(lp);
  src.start();
  lp.connect(ambient).connect(master);
}

export const sfx = {
  fire(vol = 1) {
    tone(1500, 0.17, 0.12 * vol, 'sawtooth', 0.22);
    tone(2200, 0.1, 0.05 * vol, 'square', 0.3);
    noise(0.08, 3000, 1, 0.12 * vol);
  },
  charge(vol = 1) {
    tone(320, 0.32, 0.03 * vol, 'sine', 2.8);
  },
  deflect(strong) {
    // 금속성 '츠앙' + 지직
    noise(0.09, 4200, 0.8, 0.5, 0, 'highpass');
    for (const [f, g] of [[1870, 0.07], [2630, 0.05], [3410, 0.04], [990, 0.06]]) tone(f, 0.25 + Math.random() * 0.1, g * (strong ? 1.3 : 1), 'sawtooth', 0.92);
    noise(0.22, 1600, 2.5, 0.2, 0.005, 'bandpass', 600);
    tone(140, 0.12, 0.16, 'sine', 0.5);
  },
  kill() {
    noise(1.1, 900, 0.5, 0.65, 0.004, 'lowpass', 120);
    tone(140, 0.7, 0.32, 'sine', 0.25);
    tone(70, 0.9, 0.22, 'triangle', 0.5);
    for (let i = 0; i < 9; i++) setTimeout(() => noise(0.04, 2000 + Math.random() * 3000, 1, 0.18), 60 + Math.random() * 600);
  },
  hurt() {
    tone(92, 0.32, 0.22, 'square', 0.7);
    tone(61, 0.3, 0.2, 'sawtooth', 0.8);
    noise(0.25, 2400, 0.7, 0.35, 0, 'bandpass', 500);
  },
  down() {
    tone(220, 1.2, 0.18, 'sawtooth', 0.2);
    noise(0.8, 700, 0.6, 0.3, 0.01, 'lowpass', 90);
  },
  ignite() {
    // '츠아앙' 하고 켜지는 소리
    noise(0.55, 300, 1.4, 0.35, 0.02, 'bandpass', 2400);
    tone(70, 0.7, 0.18, 'sawtooth', 1.6);
    tone(140, 0.6, 0.08, 'sawtooth', 1.55);
  },
  retract() {
    noise(0.4, 2000, 1.2, 0.25, 0.01, 'bandpass', 250);
    tone(120, 0.45, 0.12, 'sawtooth', 0.45);
  },
  slow() {
    noise(0.5, 520, 0.5, 0.22, 0.2, 'lowpass');
    tone(330, 0.42, 0.05, 'sine', 0.5);
  },
  wave() {
    for (let i = 0; i < 3; i++) {
      tone(740, 0.16, 0.08, 'square', 1, i * 0.32);
      tone(554, 0.16, 0.08, 'square', 1, i * 0.32 + 0.16);
    }
  },
  tick() {
    tone(1320, 0.09, 0.12, 'triangle');
  },
  go() {
    tone(1760, 0.3, 0.14, 'triangle');
    tone(880, 0.3, 0.1, 'triangle');
  },
  whoosh(vol = 1) {
    noise(0.35, 600, 0.6, 0.18 * vol, 0.12, 'bandpass', 1800);
  },
  wall() {
    noise(0.06, 2600, 1.2, 0.12);
  },
  // 우주 함대 같은 신스 브라스 화음
  win() {
    if (!ready()) return;
    for (const s of [0, 7, 12]) brass(actx, master, 110 * Math.pow(2, s / 12), 0.5, { gain: 0.05 });
    for (const s of [3, 10, 15]) brass(actx, master, 110 * Math.pow(2, s / 12), 1.6, { gain: 0.05, when: 0.55 });
  },
  clap(n) {
    for (let i = 0; i < n; i++) setTimeout(() => noise(0.04, 1400 + Math.random() * 900, 1, 0.13), Math.random() * 1500);
  },
  join() {
    if (!ready()) return;
    brass(actx, master, 220, 0.25, { gain: 0.05 });
    brass(actx, master, 330, 0.35, { gain: 0.04, when: 0.12 });
  }
};
