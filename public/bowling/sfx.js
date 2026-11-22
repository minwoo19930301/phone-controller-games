// 볼링 소리: 실제 녹음(/common/sfx, createSamples)을 먼저 틀고, 아직 못 받았거나 맞는 녹음이 없는 소리만 예전 WebAudio 합성음을 냅니다.
// 녹음으로 내는 것: 공 떨어짐·구르는 루프·핀 충돌(스트라이크/일부)·핀 한 개 톡·핀 구덩이·환호·박수·한숨·알림·팡파르·대기 소리 바탕.
// 합성 그대로인 것: 거터 덜컹(맞는 녹음 없음), 핀 쓸어내기, 새 핀 세팅, 범퍼 톡, 게임 중 tick.
import { createSamples } from '/common/samples.js';
let actx = null;
let master = null;
let rollNode = null;
let nbuf = null;
let smp = null;
let wantAmb = false;
let amb = null;
const dbg = (window.__bowlingSfx = { played: {}, has: (n) => Boolean(smp && smp.has(n)), state: () => (actx ? actx.state : 'none') });
// 이 종목이 쓰는 녹음 묶음(대기실에서 미리 받음)
const PRELOAD = ['bowling/', 'crowd/cheer', 'crowd/applause', 'crowd/aww', 'ui/pop', 'ui/ding', 'ui/success', 'ui/fanfare-win'];
function chipUpdate() {
  const chip = document.getElementById('soundChip');
  if (chip) chip.classList.toggle('hidden', !actx || actx.state === 'running');
}
export function audio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      actx = new AC();
      master = actx.createDynamicsCompressor();
      master.threshold.value = -14; master.ratio.value = 5;
      const g = actx.createGain(); g.gain.value = 0.9;
      master.connect(g); g.connect(actx.destination);
      smp = createSamples(actx, master);
      actx.addEventListener('statechange', chipUpdate);
      smp.preload(PRELOAD);
    }
  }
  if (actx && actx.state === 'suspended') actx.resume().then(chipUpdate, () => {});
  chipUpdate();
  return actx;
}
// 큰 화면은 클릭 없이 폰으로 시작될 수 있어서, 어떤 입력이든 오디오를 깨웁니다.
for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'click', 'wheel']) addEventListener(ev, audio, { passive: true });
addEventListener('DOMContentLoaded', () => { audio(); const chip = document.getElementById('soundChip'); if (chip) chip.addEventListener('click', audio); });
if (document.readyState !== 'loading') audio();
// 쪽이 가려지면 이어지는 소리를 멈추고, 다시 보이면 대기 소리를 되살립니다.
function hush() { synth.rollStop(); sfx.rollStop(); ambStop(); }
addEventListener('pagehide', hush);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hush();
  else if (wantAmb) sfx.ambience(true);
});
function ambStop() { if (amb) { amb.stop(0.4); amb = null; } }
// 녹음 한 번 재생(세지는 곳: window.__bowlingSfx.played). 못 틀었으면 false.
function S(name, opts) {
  if (!ready() || !smp) return false;
  const ok = smp.play(name, opts);
  if (ok) dbg.played[name] = (dbg.played[name] || 0) + 1;
  return ok;
}
let lastClack = 0;
const ready = () => actx && actx.state === 'running';
function noiseBuf() {
  if (!nbuf) {
    const len = actx.sampleRate * 2;
    nbuf = actx.createBuffer(1, len, actx.sampleRate);
    const d = nbuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return nbuf;
}
function noise(sec, { freq = 2000, q = 0.8, gain = 0.3, type = 'bandpass', delay = 0, attack = 0.002, sweepTo = 0, pan = 0 } = {}) {
  if (!ready()) return;
  const t = actx.currentTime + delay;
  const s = actx.createBufferSource();
  s.buffer = noiseBuf();
  s.loop = true;
  const f = actx.createBiquadFilter();
  f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + sec);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  let out = g;
  if (actx.createStereoPanner) { const p = actx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
  s.connect(f); f.connect(g); out.connect(master);
  s.start(t, Math.random() * 1.5); s.stop(t + sec + 0.05);
}
function tone(freq, sec, { type = 'sine', gain = 0.15, delay = 0, slideTo = 0, attack = 0.004 } = {}) {
  if (!ready()) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + sec);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + sec + 0.05);
}

const synth = {
  // 구르는 소리: 시작·속도 갱신·멈춤
  rollStart() {
    if (!ready() || rollNode) return;
    const s = actx.createBufferSource();
    s.buffer = noiseBuf(); s.loop = true;
    const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220; f.Q.value = 1.2;
    const f2 = actx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 90; f2.Q.value = 0.9;
    const g = actx.createGain(); g.gain.value = 0.0001;
    const lfo = actx.createOscillator(); lfo.frequency.value = 7;
    const lg = actx.createGain(); lg.gain.value = 0.12;
    lfo.connect(lg); lg.connect(g.gain);
    s.connect(f); f.connect(f2); f2.connect(g); g.connect(master);
    s.start(); lfo.start();
    rollNode = { s, f, g, lfo, f2 };
  },
  rollUpdate(speed01, gutter) {
    if (!rollNode || !ready()) return;
    const t = actx.currentTime;
    rollNode.g.gain.setTargetAtTime(0.1 + 0.55 * speed01, t, 0.05);
    rollNode.f.frequency.setTargetAtTime(gutter ? 520 : 160 + speed01 * 380, t, 0.05);
    rollNode.lfo.frequency.setTargetAtTime(4 + speed01 * 14, t, 0.1);
  },
  rollStop() {
    if (!rollNode) return;
    const n = rollNode; rollNode = null;
    try { n.g.gain.setTargetAtTime(0.0001, actx.currentTime, 0.08); n.s.stop(actx.currentTime + 0.4); n.lfo.stop(actx.currentTime + 0.4); } catch (e) { /* 이미 멈춤 */ }
  },
  drop() { // 던질 때 공이 레인에 내려앉는 소리
    noise(0.16, { freq: 160, q: 1.2, gain: 0.5, type: 'lowpass' });
    tone(90, 0.18, { type: 'sine', gain: 0.35, slideTo: 50 });
  },
  // 핀 충돌: power 0~1, 많이 부딪힐수록 길고 요란
  crash(power = 0.5, count = 1) {
    if (!ready()) return;
    const n = Math.min(8, 1 + Math.round(count * power * 0.7));
    noise(0.1 + power * 0.18, { freq: 900 + power * 1300, q: 0.6, gain: 0.2 + power * 0.5, type: 'bandpass', sweepTo: 600 });
    tone(110 + power * 60, 0.12, { type: 'triangle', gain: 0.18 * power, slideTo: 60 });
    for (let i = 0; i < n; i++) {
      const f = 1100 + Math.random() * 2400;
      const d = Math.random() * 0.22 * (0.4 + power);
      tone(f, 0.09 + Math.random() * 0.12, { type: 'triangle', gain: 0.03 + power * 0.04, delay: d, slideTo: f * 0.62 });
      noise(0.05, { freq: 2500 + Math.random() * 2500, q: 1.2, gain: 0.05 + power * 0.06, delay: d });
    }
  },
  clack(power = 0.3) { // 핀 하나 톡
    tone(1500 + Math.random() * 1200, 0.07, { type: 'triangle', gain: 0.04 + power * 0.1, slideTo: 800 });
    noise(0.04, { freq: 3500, q: 1.5, gain: 0.04 + power * 0.08 });
  },
  gutter() { noise(0.5, { freq: 700, q: 0.8, gain: 0.25, type: 'bandpass', sweepTo: 300 }); tone(180, 0.3, { type: 'square', gain: 0.04 }); },
  sweep() { noise(0.9, { freq: 400, q: 0.7, gain: 0.25, type: 'lowpass', attack: 0.15, sweepTo: 160 }); tone(70, 0.8, { type: 'sawtooth', gain: 0.05, slideTo: 50, attack: 0.2 }); },
  rack() { tone(420, 0.1, { type: 'square', gain: 0.04 }); noise(0.18, { freq: 1800, q: 1, gain: 0.1 }); },
  pit() { noise(0.2, { freq: 200, q: 1, gain: 0.3, type: 'lowpass' }); },
  cheer(level = 1) { // 관중 환호: 웅성임 + 박수
    if (!ready()) return;
    const d = 0.9 + level * 0.6;
    noise(d, { freq: 1400, q: 0.5, gain: 0.12 + level * 0.07, attack: 0.25, type: 'bandpass', sweepTo: 900 });
    for (let i = 0; i < 18 * level; i++) noise(0.04, { freq: 2500 + Math.random() * 3000, q: 1.5, gain: 0.04 + Math.random() * 0.05, delay: 0.15 + Math.random() * d * 0.9 });
  },
  strike() {
    synth.cheer(2);
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, { type: 'triangle', gain: 0.09, delay: i * 0.08 }));
    tone(1046, 0.7, { type: 'sine', gain: 0.07, delay: 0.36 });
  },
  spare() { synth.cheer(1); [587, 740, 880].forEach((f, i) => tone(f, 0.26, { type: 'triangle', gain: 0.08, delay: i * 0.09 })); },
  turkey() { synth.cheer(3); [392, 523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.28, { type: 'sawtooth', gain: 0.05, delay: i * 0.07 })); },
  groan() { tone(220, 0.5, { type: 'sawtooth', gain: 0.05, slideTo: 130 }); noise(0.6, { freq: 500, q: 0.6, gain: 0.1, attack: 0.1 }); },
  join() { tone(660, 0.12, { type: 'triangle', gain: 0.07 }); tone(990, 0.14, { type: 'triangle', gain: 0.07, delay: 0.08 }); },
  turn() { tone(740, 0.1, { type: 'triangle', gain: 0.06 }); tone(988, 0.16, { type: 'triangle', gain: 0.06, delay: 0.09 }); },
  tick() { tone(1200, 0.04, { type: 'square', gain: 0.03 }); },
  fanfare() { [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone(f, 0.24, { type: 'triangle', gain: 0.08, delay: i * 0.12 })); synth.cheer(2); }
};

// ---- 녹음 우선 버전. 이름은 그대로라 game.js 는 그대로 부릅니다. ----
const rnd = (a, b) => a + Math.random() * (b - a);
let roll = null; // 녹음 루프 핸들
export const sfx = {
  ambience(on) { // 레인 주변 소리 바탕(아주 작게): 판이 도는 동안만
    wantAmb = on;
    if (!on) { ambStop(); return; }
    if (amb || !ready() || !smp) return;
    amb = smp.loop('bowling/alley-loop', { gain: 0 });
    if (amb) { amb.set({ gain: 0.32, glide: 0.5 }); dbg.played['bowling/alley-loop'] = (dbg.played['bowling/alley-loop'] || 0) + 1; }
  },
  rollStart() {
    if (roll || !ready()) return;
    if (smp) roll = smp.loop('bowling/roll-loop', { gain: 0.2, rate: 0.9 });
    if (roll) { dbg.played['bowling/roll-loop'] = (dbg.played['bowling/roll-loop'] || 0) + 1; return; }
    synth.rollStart();
  },
  rollUpdate(speed01, gutter) {
    if (roll) roll.set({ gain: (0.25 + 0.6 * speed01) * (gutter ? 0.8 : 1), rate: (0.85 + 0.4 * speed01) * (gutter ? 1.18 : 1) });
    else synth.rollUpdate(speed01, gutter);
  },
  rollStop() {
    if (roll) { roll.stop(0.12); roll = null; }
    synth.rollStop();
  },
  drop() { if (!S('bowling/ball-drop', { gain: 0.85, jitter: 0.06 })) synth.drop(); },
  crash(power = 0.5, count = 1) {
    // 열 개 가까이 쓰러뜨리면 풀 스트라이크 소리, 일부면 약한 충돌, 거의 못 맞히면 핀 한 개 톡
    if (count >= 9) { if (S('bowling/pins-strike', { gain: 1, rate: rnd(0.96, 1.04) })) return; }
    else if (count >= 2) { if (S('bowling/pins-hit', { gain: 0.8 + 0.3 * power, rate: rnd(0.95, 1.05) })) return; }
    else if (S('bowling/pin-single', { gain: 0.6 + 0.3 * power, duration: 0.45 })) return;
    synth.crash(power, count);
  },
  clack(power = 0.3, { bumper = false } = {}) { // 핀 한 개 톡(너무 자주 겹치지 않게 솎음)
    if (bumper) { synth.clack(power); return; }
    const now = performance.now();
    if (now - lastClack < 70) return;
    lastClack = now;
    if (!S('bowling/pin-single', { gain: 0.15 + 0.5 * power, rate: rnd(0.9, 1.3), duration: 0.28, pan: rnd(-0.25, 0.25) })) synth.clack(power);
  },
  gutter() { synth.gutter(); }, // 맞는 녹음이 없어 합성 유지
  pit() { if (!S('bowling/pin-single', { gain: 0.3, rate: 0.62, duration: 0.4 })) synth.pit(); },
  sweep() { synth.sweep(); }, // 합성 유지
  rack() { synth.rack(); }, // 합성 유지
  cheer(level = 1) {
    const ok = level >= 3 ? S('crowd/cheer-big', { gain: 0.85 }) : level === 2 ? S('crowd/cheer-small', { gain: 0.9 }) : S('crowd/applause-short', { gain: 0.75 });
    if (!ok) synth.cheer(level);
  },
  strike() {
    if (S('crowd/cheer-small', { gain: 0.95 })) { S('ui/success', { gain: 0.6, when: 0.12 }); return; }
    synth.strike();
  },
  spare() {
    if (S('crowd/applause-short', { gain: 0.8 })) { S('ui/ding', { gain: 0.5, when: 0.05, duration: 0.8 }); return; }
    synth.spare();
  },
  turkey() {
    if (S('crowd/cheer-big', { gain: 0.9 })) { S('ui/fanfare-win', { gain: 0.6, when: 0.1 }); return; }
    synth.turkey();
  },
  groan() { if (!S('crowd/aww', { gain: 0.85 })) synth.groan(); },
  join() { if (!S('ui/pop', { gain: 0.7 })) synth.join(); },
  turn() { if (!S('ui/ding', { gain: 0.4, rate: 1.25, duration: 0.7 })) synth.turn(); },
  tick() { synth.tick(); },
  fanfare() {
    if (S('ui/fanfare-win', { gain: 0.75 })) { S('crowd/applause-long', { gain: 0.55, when: 0.6 }); return; }
    synth.fanfare();
  }
};
