// 큰 화면 소리. 파일 없이 WebAudio 로 만듭니다: 퍼터 "톡", 구르는 소리, 컵 "딸그락", 립 아웃, 박수와 탄성, 새소리.
import { modal, grit, organ, marimba, bell, chip, pluck, brass, phrase } from '/common/voice.js';
let actx = null;
let master = null;
export function audio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = 0.9;
    const comp = actx.createDynamicsCompressor();
    master.connect(comp).connect(actx.destination);
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
window.addEventListener('pointerdown', audio);
window.addEventListener('keydown', audio);
const ok = () => actx && actx.state === 'running';

function noiseBuf(sec) {
  const len = Math.max(1, Math.floor(actx.sampleRate * sec));
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
function burst({ sec = 0.05, type = 'bandpass', freq = 2000, q = 1, gain = 0.4, attack = 0.002, at = 0, sweep = null }) {
  if (!ok()) return;
  const t = actx.currentTime + at;
  const src = actx.createBufferSource();
  src.buffer = noiseBuf(sec + 0.05);
  const f = actx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + sec);
  f.Q.value = q;
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + sec + 0.05);
}
function tone({ freq = 800, sec = 0.1, gain = 0.2, type = 'sine', at = 0, to = null }) {
  if (!ok()) return;
  const t = actx.currentTime + at;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + sec);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + sec + 0.02);
}

// 공이 구르는 동안 이어지는 낮은 쉬익 소리(속도에 따라 커짐)
let roll = null;
function rollStart() {
  if (!ok() || roll) return;
  const src = actx.createBufferSource();
  src.buffer = noiseBuf(2);
  src.loop = true;
  const f = actx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 500;
  f.Q.value = 0.6;
  const g = actx.createGain();
  g.gain.value = 0;
  src.connect(f).connect(g).connect(master);
  src.start();
  roll = { src, f, g };
}
function rollSet(speed) {
  if (!roll) return;
  const t = actx.currentTime;
  roll.g.gain.setTargetAtTime(Math.min(0.11, speed * 0.045), t, 0.05);
  roll.f.frequency.setTargetAtTime(260 + speed * 220, t, 0.05);
}
function rollStop() {
  if (!roll) return;
  const r = roll;
  roll = null;
  r.g.gain.setTargetAtTime(0, actx.currentTime, 0.04);
  setTimeout(() => { try { r.src.stop(); } catch (e) {} }, 300);
}

export const sfx = {
  putt(q) {
    // 퍼터 페이스에 맞는 짧은 "톡"
    if (!ok()) return;
    const s = Math.min(1, Math.max(0.15, q));
    // 스틸 퍼터 페이스: 맑게 잠깐 남는 '팅' + 공 '톡'
    modal(actx, master, [[2350, 1, 0.22], [5870, 0.4, 0.12], [3120, 0.3, 0.09]], { gain: 0.12 + s * 0.15 });
    modal(actx, master, [[900, 1, 0.03]], { gain: 0.3 * s });
  },
  rollStart,
  rollSet,
  rollStop,
  cup() {
    // 플라스틱 컵 바닥에 떨어지는 "딸그락"
    tone({ freq: 620, sec: 0.07, gain: 0.32, type: 'triangle', at: 0.0 });
    burst({ sec: 0.05, freq: 1500, q: 2, gain: 0.35, at: 0.0 });
    tone({ freq: 760, sec: 0.05, gain: 0.2, type: 'triangle', at: 0.11 });
    burst({ sec: 0.04, freq: 1800, q: 2, gain: 0.2, at: 0.11 });
    tone({ freq: 700, sec: 0.04, gain: 0.1, type: 'triangle', at: 0.18 });
  },
  lip() {
    tone({ freq: 980, sec: 0.05, gain: 0.22, type: 'triangle' });
    burst({ sec: 0.06, freq: 2200, q: 3, gain: 0.25 });
    tone({ freq: 840, sec: 0.04, gain: 0.12, type: 'triangle', at: 0.06 });
  },
  flag() {
    burst({ sec: 0.25, freq: 900, q: 0.7, gain: 0.12, attack: 0.08, sweep: 2200 });
  },
  chime() {
    if (!ok()) return;
    phrase(1047, [[0, 0.5], [7, 0.5], [16, 1.5]], 200, (f, d, w) => bell(actx, master, f, { when: w, gain: 0.08, ratio: 4, depth: 1.2, sec: 1.6 }));
  },
  tick() {
    tone({ freq: 1500, sec: 0.04, gain: 0.08 });
  },
  clap(n = 30, spread = 1.6) {
    for (let i = 0; i < n; i++) burst({ sec: 0.04, freq: 1400 + Math.random() * 900, q: 1, gain: 0.18 + Math.random() * 0.1, at: Math.random() * spread });
  },
  cheer(big) {
    // 갤러리 "와아" (부푸는 잡음)
    burst({ sec: big ? 2.2 : 1.4, freq: 900, q: 0.8, gain: big ? 0.3 : 0.18, attack: 0.25, sweep: 700 });
    burst({ sec: big ? 2.0 : 1.2, freq: 1800, q: 1.2, gain: big ? 0.14 : 0.08, attack: 0.3, sweep: 1300 });
    sfx.clap(big ? 60 : 26, big ? 2.4 : 1.6);
  },
  groan() {
    // 아깝게 빗나갔을 때 "아~" (내려가는 모음)
    burst({ sec: 1.3, freq: 760, q: 4, gain: 0.22, attack: 0.15, sweep: 330 });
    burst({ sec: 1.3, freq: 1250, q: 5, gain: 0.1, attack: 0.18, sweep: 620 });
  },
  bird() {
    if (!ok()) return;
    const base = 2600 + Math.random() * 1400;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) tone({ freq: base, to: base * (0.75 + Math.random() * 0.5), sec: 0.08, gain: 0.025, at: i * 0.13 });
  }
};
