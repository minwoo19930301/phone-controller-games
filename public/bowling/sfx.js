// 볼링 소리(전부 WebAudio 합성, 파일 없음): 공 구르는 소리(속도에 따라 높낮이), 거터 덜컹, 핀 부딪힘(핀 수·세기에 맞춰), 핀 쓸어내는 소리, 관중 환호, 스트라이크 팡파르.
let actx = null;
let master = null;
let rollNode = null;
let nbuf = null;
export function audio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      actx = new AC();
      master = actx.createDynamicsCompressor();
      master.threshold.value = -14; master.ratio.value = 5;
      const g = actx.createGain(); g.gain.value = 0.9;
      master.connect(g); g.connect(actx.destination);
    }
  }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
addEventListener('pointerdown', audio);
addEventListener('keydown', audio);
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

export const sfx = {
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
    sfx.cheer(2);
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, { type: 'triangle', gain: 0.09, delay: i * 0.08 }));
    tone(1046, 0.7, { type: 'sine', gain: 0.07, delay: 0.36 });
  },
  spare() { sfx.cheer(1); [587, 740, 880].forEach((f, i) => tone(f, 0.26, { type: 'triangle', gain: 0.08, delay: i * 0.09 })); },
  turkey() { sfx.cheer(3); [392, 523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.28, { type: 'sawtooth', gain: 0.05, delay: i * 0.07 })); },
  groan() { tone(220, 0.5, { type: 'sawtooth', gain: 0.05, slideTo: 130 }); noise(0.6, { freq: 500, q: 0.6, gain: 0.1, attack: 0.1 }); },
  join() { tone(660, 0.12, { type: 'triangle', gain: 0.07 }); tone(990, 0.14, { type: 'triangle', gain: 0.07, delay: 0.08 }); },
  turn() { tone(740, 0.1, { type: 'triangle', gain: 0.06 }); tone(988, 0.16, { type: 'triangle', gain: 0.06, delay: 0.09 }); },
  tick() { tone(1200, 0.04, { type: 'square', gain: 0.03 }); },
  fanfare() { [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone(f, 0.24, { type: 'triangle', gain: 0.08, delay: i * 0.12 })); sfx.cheer(2); }
};
