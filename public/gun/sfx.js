// 좀비 건 아케이드 큰 화면 소리: 총소리(자리마다 음높이가 다름), 명중, 헤드샷, 좀비 신음·물기, 장전, 보스, 웨이브 알림.
// 전부 WebAudio 로 합성합니다. 8명이 동시에 쏘면 뭉개지므로 총소리는 짧은 간격으로 솎아 냅니다.
import { modal, grit, bell, brass, organ, phrase } from '/common/voice.js';
let actx = null;
let master = null;
let ambient = null;
export function audio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      actx = new AC();
      master = actx.createDynamicsCompressor();
      master.threshold.value = -16;
      master.ratio.value = 5;
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
let nbuf = null;
function noiseBuf() {
  if (!nbuf) {
    const len = actx.sampleRate * 1.2;
    nbuf = actx.createBuffer(1, len, actx.sampleRate);
    const d = nbuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return nbuf;
}
function noise(sec, freq, q, gain, type = 'bandpass', sweepTo = 0, delay = 0) {
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
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5, sec + 0.05);
}
function tone(freq, sec, gain, type = 'sine', glide = 0, delay = 0, attack = 0.005) {
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

// 바탕 소리: 낮은 바람 + 가끔 멀리서 들리는 신음
function startAmbient() {
  ambient = actx.createGain();
  ambient.gain.value = 0.05;
  const src = actx.createBufferSource();
  src.buffer = noiseBuf();
  src.loop = true;
  const f = actx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 260;
  src.connect(f).connect(ambient).connect(master);
  src.start();
  const lfo = actx.createOscillator();
  const lg = actx.createGain();
  lfo.frequency.value = 0.12;
  lg.gain.value = 120;
  lfo.connect(lg).connect(f.frequency);
  lfo.start();
}

let lastShot = 0;
let shotCount = 0;
export const sfx = {
  // 총소리: 자리 번호로 음높이를 달리해 8명이 쏴도 서로 구분됩니다.
  shot(slot = 1) {
    if (!ready()) return;
    const now = performance.now();
    if (now - lastShot < 28 && shotCount++ % 2) return;
    lastShot = now;
    const k = 1 + ((slot - 1) % 8) * 0.045;
    // 총소리: 금속 약실 울림(모드 합성) + 폭발 잡음. 자리마다 음높이가 다름
    modal(actx, master, [[210 * k, 1, 0.09], [540 * k, 0.5, 0.06], [1330 * k, 0.3, 0.04]], { gain: 0.32, drop: 0.35 });
    grit(actx, master, { sec: 0.12, freq: 2600 * k, q: 0.8, gain: 0.5, sweep: 600 });
    grit(actx, master, { sec: 0.22, freq: 420, q: 0.7, gain: 0.4, type: 'lowpass', sweep: 120 });
  },
  hit() {
    noise(0.07, 900, 1.5, 0.25, 'bandpass', 300);
    tone(120, 0.08, 0.16, 'sine', 0.5);
  },
  head() {
    tone(1560, 0.09, 0.2, 'triangle', 1.4);
    tone(2340, 0.14, 0.12, 'sine', 1.2, 0.03);
    noise(0.1, 1800, 1, 0.22, 'bandpass', 500);
  },
  die(big = false) {
    noise(big ? 0.7 : 0.35, 500, 0.9, big ? 0.55 : 0.28, 'lowpass', 90);
    tone(big ? 60 : 110, big ? 0.7 : 0.3, 0.3, 'sawtooth', 0.4);
  },
  groan(pitch = 1, loud = 0.08) {
    if (!ready()) return;
    const f = 95 * pitch;
    tone(f, 0.9, loud, 'sawtooth', 0.8, 0, 0.18);
    tone(f * 1.5, 0.8, loud * 0.4, 'square', 0.7, 0.04, 0.2);
    noise(0.8, 380, 2, loud * 0.8, 'bandpass', 220);
  },
  bite() {
    noise(0.2, 700, 1.2, 0.4, 'bandpass', 200);
    tone(80, 0.25, 0.4, 'sine', 0.4);
  },
  hurt() {
    noise(0.35, 300, 0.5, 0.5, 'lowpass', 80);
    tone(60, 0.35, 0.45, 'sine', 0.5);
  },
  reload() {
    noise(0.04, 3000, 3, 0.2, 'highpass');
    noise(0.05, 2400, 3, 0.25, 'highpass', 0, 0.28);
    tone(900, 0.04, 0.1, 'square', 0.6, 0.55);
  },
  empty() {
    noise(0.03, 3500, 4, 0.18, 'highpass');
  },
  medkit() {
    tone(660, 0.12, 0.2, 'triangle', 1, 0);
    tone(990, 0.18, 0.2, 'triangle', 1, 0.09);
  },
  wave() {
    tone(220, 0.5, 0.25, 'sawtooth', 0.7);
    tone(330, 0.5, 0.18, 'square', 0.7, 0.05);
    noise(0.5, 600, 1, 0.2, 'bandpass', 150);
  },
  count() {
    tone(660, 0.1, 0.2, 'square');
  },
  go() {
    tone(880, 0.3, 0.25, 'square', 1.5);
    tone(1320, 0.3, 0.18, 'triangle', 1.2, 0.08);
  },
  clear() {
    // 어두운 짧은 모티브(단조 + 반음 내림): 다른 종목의 도-미-솔-도 와 다름
    if (!ready()) return;
    phrase(110, [[0, 0.3], [3, 0.3], [1, 0.3], [7, 0.8]], 140, (f, sec, at) => brass(actx, master, f, sec, { gain: 0.06, when: at }));
  },
  boom() {
    noise(0.9, 240, 0.6, 0.8, 'lowpass', 40);
    tone(48, 0.9, 0.6, 'sine', 0.5);
  },
  alarm() {
    tone(520, 0.2, 0.2, 'square', 1.2);
    tone(520, 0.2, 0.2, 'square', 1.2, 0.3);
  },
  win() {
    if (!ready()) return;
    // 승리: 낮은 D단조에서 올라가 반음 아래로 눌러 끝나는 어두운 팡파르 + 종
    phrase(73.4, [[0, 0.35], [3, 0.35], [7, 0.35], [6, 0.35], [10, 0.5], [12, 1.4]], 120, (f, sec, at) => brass(actx, master, f * 2, sec, { gain: 0.07, when: at }));
    bell(actx, master, 293.7, { gain: 0.1, when: 2.4, sec: 2.2, ratio: 2.7 });
  },
  lose() {
    if (!ready()) return;
    phrase(98, [[0, 0.5], [-1, 0.5], [-4, 0.5], [-6, 1.6]], 90, (f, sec, at) => organ(actx, master, f, sec, { gain: 0.09, when: at }));
  },
  join() {
    if (!ready()) return;
    // 입장: 낮은 종 두 번(증4도 간격)
    bell(actx, master, 220, { gain: 0.09, sec: 1.0, ratio: 2.7 });
    bell(actx, master, 311, { gain: 0.08, sec: 1.0, ratio: 2.7, when: 0.12 });
  }
};
