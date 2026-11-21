// 양궁 소리: 전부 WebAudio 합성(파일 없음). 시위 삐걱, 놓는 소리(트왕), 화살 휘익, 꽂히는 둔탁한 소리, 점수에 따른 관중 반응, 심박, 바람.
let actx = null;
let master = null;
let windGain = null;
let creakNode = null;
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
  if (actx && actx.state === 'running' && !windGain) startWind();
  return actx;
}
window.addEventListener('pointerdown', audio);
window.addEventListener('keydown', audio);
const ready = () => actx && actx.state === 'running';

let nbuf = null;
function noiseBuf() {
  if (!nbuf) {
    const len = Math.floor(actx.sampleRate * 1.5);
    nbuf = actx.createBuffer(1, len, actx.sampleRate);
    const d = nbuf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = b * 0.2 + w * 0.8; d[i] = b; }
  }
  return nbuf;
}
function noise(sec, freq, q, gain, type = 'bandpass', sweepTo = 0, delay = 0, attack = 0.004) {
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
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.4, sec + 0.05);
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
function startWind() {
  windGain = actx.createGain();
  windGain.gain.value = 0.02;
  const src = actx.createBufferSource();
  src.buffer = noiseBuf();
  src.loop = true;
  const f = actx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 420;
  f.Q.value = 0.6;
  const lfo = actx.createOscillator();
  const lg = actx.createGain();
  lfo.frequency.value = 0.18;
  lg.gain.value = 160;
  lfo.connect(lg).connect(f.frequency);
  lfo.start();
  src.connect(f).connect(windGain).connect(master);
  src.start();
}

export const sfx = {
  wind(speed) { if (windGain && ready()) windGain.gain.setTargetAtTime(0.012 + Math.min(1, speed / 8) * 0.06, actx.currentTime, 0.4); },
  // 시위 삐걱: 당기는 동안 0..1 로 계속 부르면 소리가 이어짐
  creak(pull) {
    if (!ready()) return;
    if (!creakNode) {
      const o = actx.createOscillator();
      const o2 = actx.createOscillator();
      const g = actx.createGain();
      const f = actx.createBiquadFilter();
      o.type = 'sawtooth'; o2.type = 'triangle';
      o.frequency.value = 130; o2.frequency.value = 197;
      f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 6;
      g.gain.value = 0;
      const lfo = actx.createOscillator();
      const lg = actx.createGain();
      lfo.frequency.value = 9; lg.gain.value = 40;
      lfo.connect(lg).connect(o.frequency);
      lfo.start();
      o.connect(f); o2.connect(f); f.connect(g).connect(master);
      o.start(); o2.start();
      creakNode = { o, o2, g, f };
    }
    const t = actx.currentTime;
    creakNode.g.gain.setTargetAtTime(pull > 0.03 && pull < 0.97 ? 0.018 + pull * 0.02 : 0, t, 0.05);
    creakNode.o.frequency.setTargetAtTime(110 + pull * 150, t, 0.08);
    creakNode.o2.frequency.setTargetAtTime(165 + pull * 220, t, 0.08);
    creakNode.f.frequency.setTargetAtTime(500 + pull * 900, t, 0.08);
  },
  creakStop() { if (creakNode && ready()) creakNode.g.gain.setTargetAtTime(0, actx.currentTime, 0.04); },
  // 만궁에 닿는 딸깍(클리커)
  click() { noise(0.05, 3200, 3, 0.28, 'bandpass'); tone(2100, 0.05, 0.08, 'square'); },
  // 놓는 소리: 시위가 튕기는 트왕 + 림 울림
  release(pull = 1) {
    const k = 0.5 + 0.5 * pull;
    noise(0.12, 2400, 1.2, 0.34 * k, 'bandpass', 700);
    for (const [f, g, d] of [[190, 0.28, 0.5], [380, 0.16, 0.36], [760, 0.09, 0.26], [1520, 0.05, 0.18]]) tone(f * (0.95 + 0.1 * pull), d, g * k, 'triangle', 0.97);
    tone(95, 0.3, 0.3 * k, 'sine', 0.8);
  },
  // 화살 휘익: 속도 감각
  whoosh(sec = 1.2) { noise(sec, 1600, 0.9, 0.16, 'bandpass', 5200, 0.0, 0.2); noise(sec * 0.9, 600, 0.7, 0.1, 'bandpass', 2400, 0.05, 0.3); },
  // 꽂힘: 둔탁한 퍽 + 짚 소리
  thud(score = 5) {
    tone(120, 0.18, 0.5, 'sine', 0.5);
    noise(0.1, 700, 1, 0.3, 'lowpass', 200);
    if (score >= 9) tone(1800, 0.05, 0.05, 'square');
  },
  miss() { noise(0.3, 400, 0.6, 0.2, 'lowpass', 120); tone(80, 0.3, 0.3, 'sine', 0.5); },
  heart() { tone(60, 0.12, 0.5, 'sine', 0.7); tone(55, 0.14, 0.4, 'sine', 0.7, 0.14); },
  tick() { tone(1500, 0.05, 0.1, 'triangle'); },
  breath() { noise(0.5, 1200, 0.4, 0.06, 'bandpass', 600, 0, 0.18); },
  // 관중: 점수가 높을수록 크고 환호(박수 무리). 낮으면 한숨
  crowd(score) {
    if (!ready()) return;
    if (score <= 0) { noise(0.9, 500, 0.5, 0.1, 'lowpass', 200); return; }
    if (score < 6) { noise(0.5, 900, 0.5, 0.05 + score * 0.004, 'bandpass', 500, 0, 0.1); return; }
    const k = (score - 5) / 5;
    noise(1.1 + k * 0.8, 1400, 0.5, 0.08 + k * 0.2, 'bandpass', 900, 0.05, 0.12);
    for (let i = 0; i < 6 + k * 18; i++) noise(0.05, 1800 + Math.random() * 2200, 2, 0.12 + k * 0.1, 'bandpass', 0, 0.15 + Math.random() * (0.8 + k), 0.002);
    if (score >= 9) { tone(880, 0.3, 0.08, 'triangle', 1.2, 0.1); tone(1320, 0.4, 0.08, 'triangle', 1.2, 0.22); }
    if (score >= 10) { tone(1760, 0.5, 0.07, 'triangle', 1.0, 0.34); }
  },
  turn() { tone(660, 0.12, 0.1, 'triangle'); tone(990, 0.16, 0.1, 'triangle', 1, 0.1); },
  join() { tone(740, 0.1, 0.1, 'triangle'); tone(1110, 0.14, 0.1, 'triangle', 1, 0.08); },
  fanfare() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, 0.12, 'triangle', 1, i * 0.12)); }
};
