// 큰 화면 소리. 퍼터 톡·컵·립 아웃·박수와 환호·탄성·알림은 실제 녹음(/common/sfx)을 틀고, 녹음이 없는 것(구르는 소리·깃대·새소리)과
// 못 받았을 때의 대체는 예전처럼 WebAudio 합성음입니다. 내보내는 이름(audio, getCtx, sfx.*)은 그대로입니다.
import { modal, grit, organ, marimba, bell, chip, pluck, brass, phrase } from '/common/voice.js';
import { createGolfSfx } from '/golf/real-sfx.js';
let actx = null;
let master = null;
let real = null;
// 대기실에서 미리 받는 녹음(이름 앞머리)
const PRELOAD = ['ball/putt-tap', 'ball/cup-drop', 'crowd/applause-short', 'crowd/golf-clap', 'crowd/cheer-small', 'crowd/cheer-big', 'crowd/aww', 'ui/ding', 'ui/click'];
// 세기 기준: 퍼터 톡이 가장 크고, 컵·환호가 그다음, 알림과 틱은 작게.
const G = { putt: 0.55, puttQ: 0.5, cup: 0.9, lip: 0.4, cheerSmall: 0.7, cheerBig: 0.6, clap: 0.6, aww: 0.7, chime: 0.5, tick: 0.45 };
export const getCtx = () => actx;
const rp = (name, opts) => (real ? real.play(name, opts) : false);
export function audio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = 0.9;
    const comp = actx.createDynamicsCompressor();
    master.connect(comp).connect(actx.destination);
    real = createGolfSfx(actx, { master });
    real.sam.preload(PRELOAD); // 소리가 잠겨 있어도 받아 두기는 됩니다
  }
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}
// 큰 화면은 폰에서 시작해서 클릭이 없을 수 있으니, 어떤 키·포인터 입력이든 소리를 켭니다.
for (const ev of ['pointerdown', 'keydown', 'touchstart', 'mousedown']) window.addEventListener(ev, audio, { capture: true });
audio();
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
    if (rp('ball/putt-tap', { gain: G.putt + s * G.puttQ, rate: 0.94 + s * 0.12 })) return;
    // 스틸 퍼터 페이스: 맑게 잠깐 남는 '팅' + 공 '톡'
    modal(actx, master, [[2350, 1, 0.22], [5870, 0.4, 0.12], [3120, 0.3, 0.09]], { gain: 0.12 + s * 0.15 });
    modal(actx, master, [[900, 1, 0.03]], { gain: 0.3 * s });
  },
  rollStart,
  rollSet,
  rollStop,
  cup() {
    if (rp('ball/cup-drop', { gain: G.cup })) return;
    // 플라스틱 컵 바닥에 떨어지는 "딸그락"
    tone({ freq: 620, sec: 0.07, gain: 0.32, type: 'triangle', at: 0.0 });
    burst({ sec: 0.05, freq: 1500, q: 2, gain: 0.35, at: 0.0 });
    tone({ freq: 760, sec: 0.05, gain: 0.2, type: 'triangle', at: 0.11 });
    burst({ sec: 0.04, freq: 1800, q: 2, gain: 0.2, at: 0.11 });
    tone({ freq: 700, sec: 0.04, gain: 0.1, type: 'triangle', at: 0.18 });
  },
  lip() {
    // 컵 가장자리를 스치는 '톡톡': 퍼터 톡 녹음을 높고 작게 두 번
    if (rp('ball/putt-tap', { gain: G.lip, rate: 1.5 })) { rp('ball/putt-tap', { gain: G.lip * 0.7, rate: 1.35, when: 0.08 }); return; }
    tone({ freq: 980, sec: 0.05, gain: 0.22, type: 'triangle' });
    burst({ sec: 0.06, freq: 2200, q: 3, gain: 0.25 });
    tone({ freq: 840, sec: 0.04, gain: 0.12, type: 'triangle', at: 0.06 });
  },
  flag() {
    burst({ sec: 0.25, freq: 900, q: 0.7, gain: 0.12, attack: 0.08, sweep: 2200 });
  },
  chime() {
    if (!ok()) return;
    if (rp('ui/ding', { gain: G.chime })) return;
    phrase(1047, [[0, 0.5], [7, 0.5], [16, 1.5]], 200, (f, d, w) => bell(actx, master, f, { when: w, gain: 0.08, ratio: 4, depth: 1.2, sec: 1.6 }));
  },
  tick() {
    if (ok() && rp('ui/click', { gain: G.tick })) return;
    tone({ freq: 1500, sec: 0.04, gain: 0.08 });
  },
  clap(n = 30, spread = 1.6) {
    if (ok() && rp('crowd/golf-clap', { gain: G.clap })) return;
    for (let i = 0; i < n; i++) burst({ sec: 0.04, freq: 1400 + Math.random() * 900, q: 1, gain: 0.18 + Math.random() * 0.1, at: Math.random() * spread });
  },
  cheer(big) {
    if (ok()) {
      const a = rp(big ? 'crowd/cheer-big' : 'crowd/cheer-small', { gain: big ? G.cheerBig : G.cheerSmall });
      const b = rp('crowd/applause-short', { gain: G.clap, when: big ? 0.5 : 0.3 });
      if (a || b) return;
    }
    // 갤러리 "와아" (부푸는 잡음)
    burst({ sec: big ? 2.2 : 1.4, freq: 900, q: 0.8, gain: big ? 0.3 : 0.18, attack: 0.25, sweep: 700 });
    burst({ sec: big ? 2.0 : 1.2, freq: 1800, q: 1.2, gain: big ? 0.14 : 0.08, attack: 0.3, sweep: 1300 });
    sfx.clap(big ? 60 : 26, big ? 2.4 : 1.6);
  },
  groan() {
    if (ok() && rp('crowd/aww', { gain: G.aww })) return;
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
