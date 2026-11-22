// 양궁 소리: 실제 녹음(/common/sfx/)을 먼저 틀고, 아직 못 받았거나 맞는 녹음이 없는 소리는 예전 WebAudio 합성음을 씁니다.
// 합성으로 남긴 것: 심박(heart), 바람(wind), 쓰지 않는 tick·breath.
import { createSamples } from '/common/samples.js';
let actx = null;
let master = null;
let windGain = null;
let creakNode = null;
let samples = null;
// 시험용 카운터: 녹음이 실제로 울렸는지(played), 합성음으로 대신 울렸는지(synth)
const DBG = (window.__archerySfx = { played: {}, synth: {} });
// 소리 세기(녹음 기본 세기에 곱해집니다). 부딪히는 소리가 가장 크고 바탕 소리는 작게
const G = { release: 0.9, fly: 0.45, thud: 1, ground: 0.55, draw: 0.6, click: 0.5, bed: 0.1, crowdMax: 0.7, turn: 0.55, join: 0.4, whistle: 0.6, fanfare: 0.7 };
const PRELOAD = ['swing/bow-draw', 'swing/bow-release', 'swing/arrow-fly', 'swing/arrow-thud', 'swing/reel-click', 'crowd/aww', 'crowd/golf-clap', 'crowd/applause-short', 'crowd/cheer-small', 'crowd/cheer-big', 'crowd/murmur-loop', 'ui/ding', 'ui/pop', 'ui/fanfare-win', 'perc/whistle-short'];
function make() {
  if (actx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  actx = new AC();
  master = actx.createDynamicsCompressor();
  master.threshold.value = -14;
  master.ratio.value = 4;
  master.connect(actx.destination);
  samples = createSamples(actx, master);
  // 대기실에서 미리 받아 둡니다(정지 상태에서도 디코딩은 됩니다)
  samples.preload(PRELOAD);
  actx.addEventListener('statechange', () => { syncChip(); if (actx.state === 'running' && wantBed) sfx.bed(true); });
}
// 녹음이 있으면 틀고 true, 없으면 false(호출한 쪽이 합성음으로 대신)
function play(name, opts) {
  if (!samples || !ready()) return false;
  const ok = samples.play(name, opts);
  if (ok) DBG.played[name] = (DBG.played[name] || 0) + 1;
  return ok;
}
function synthUsed(key) { DBG.synth[key] = (DBG.synth[key] || 0) + 1; }
export function audio() {
  make();
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
  if (actx && actx.state === 'running' && !windGain) startWind();
  syncChip();
  return actx;
}
// 큰 화면은 클릭 없이 폰으로 시작하는 일이 많아서, 어떤 입력이든 오디오를 깨웁니다
for (const ev of ['pointerdown', 'mousedown', 'keydown', 'touchstart', 'click']) window.addEventListener(ev, audio, { capture: true, passive: true });
// 탭이 가려지면 이어 도는 소리를 멈춥니다
document.addEventListener('visibilitychange', () => { if (document.hidden) sfx.stopAll(); });
window.addEventListener('pagehide', () => sfx.stopAll());

// "화면을 한 번 눌러 소리 켜기" 칩: 대기실에서 오디오가 멈춰 있을 때만
let chip = null;
function syncChip() {
  const lobby = document.getElementById('lobby');
  const need = actx && actx.state === 'suspended' && lobby && !lobby.classList.contains('hidden');
  if (need && !chip && document.body) {
    chip = document.createElement('div');
    chip.className = 'sound-chip';
    chip.textContent = '화면을 한 번 눌러 소리 켜기';
    chip.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9;padding:7px 14px;border-radius:999px;background:rgba(20,24,30,.62);color:rgba(255,255,255,.82);font:600 13px/1.2 system-ui,sans-serif;border:1px solid rgba(255,255,255,.18);pointer-events:none;white-space:nowrap';
    document.body.appendChild(chip);
  } else if (!need && chip) { chip.remove(); chip = null; }
}
setInterval(syncChip, 800);
make();
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

const synth = {
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

// ---- 바깥에서 쓰는 소리: 녹음 먼저, 없으면 합성 ----
let bed = null;
let drawLoop = null;
let lastPull = 0;
let calm = 0;
let wantBed = false;
function bedStop() { wantBed = false; if (bed) { bed.stop(0.6); bed = null; } }
export const sfx = {
  ...synth,
  wind: synth.wind,
  // 당기는 동안 0..1 로 프레임마다 부릅니다. 녹음(삐걱)은 당기는 중에만 이어서 틀고, 멈추면 작아집니다
  creak(pull) {
    if (!samples || !ready() || !samples.has('swing/bow-draw')) { synthUsed('creak'); return synth.creak(pull); }
    if (!(pull > 0.03 && pull < 0.97)) { if (drawLoop) { drawLoop.set({ gain: 0, glide: 0.06 }); } lastPull = pull; return; }
    if (!drawLoop) { drawLoop = samples.loop('swing/bow-draw', { gain: 0 }); if (drawLoop) DBG.played['swing/bow-draw'] = (DBG.played['swing/bow-draw'] || 0) + 1; }
    if (!drawLoop) { synthUsed('creak'); return synth.creak(pull); }
    const moving = Math.abs(pull - lastPull) > 0.0015;
    lastPull = pull;
    calm = moving ? 0 : Math.min(1, calm + 0.03);
    drawLoop.set({ gain: G.draw * (moving ? 0.6 + pull * 0.4 : 0.12 * (1 - calm)), rate: 0.9 + pull * 0.35, glide: 0.1 });
  },
  creakStop() {
    if (drawLoop) { drawLoop.stop(0.12); drawLoop = null; lastPull = 0; calm = 0; }
    synth.creakStop();
  },
  // 만궁에 닿는 딸깍(클리커): 릴 딸깍 한 벌
  click() { if (!play('swing/reel-click', { gain: G.click, duration: 0.14 })) { synthUsed('click'); synth.click(); } },
  release(pull = 1) {
    const k = 0.6 + 0.4 * pull;
    if (!play('swing/bow-release', { gain: G.release * k, rate: 0.95 + 0.1 * pull })) { synthUsed('release'); synth.release(pull); }
  },
  whoosh(sec = 1.2) {
    // 녹음이 0.5초라 속도를 낮춰 늘립니다
    if (!play('swing/arrow-fly', { gain: G.fly, rate: Math.max(0.6, 0.5 / (sec * 0.7)) })) { synthUsed('whoosh'); synth.whoosh(sec); }
  },
  thud(score = 5) {
    if (!play('swing/arrow-thud', { gain: G.thud * (0.85 + 0.03 * score), rate: 1 + (score >= 9 ? 0.08 : 0) })) { synthUsed('thud'); synth.thud(score); }
  },
  // 땅에 떨어짐: 꽂히는 소리를 낮고 작게(전용 녹음 없음)
  miss() { if (!play('swing/arrow-thud', { gain: G.ground, rate: 0.7 })) { synthUsed('miss'); synth.miss(); } },
  // 점수별 관중: 0~3 아쉬운 탄성, 4~5 드문 박수, 6~7 박수, 8~9 환호+박수, 10 큰 환호+박수
  crowd(score) {
    if (!samples || !ready() || !samples.has('crowd/aww') || !samples.has('crowd/applause-short')) { synthUsed('crowd'); return synth.crowd(score); }
    const w = 0.25;
    if (score <= 3) play('crowd/aww', { gain: G.crowdMax * (score <= 0 ? 0.9 : 0.5 + 0.1 * (3 - score)), rate: score <= 0 ? 0.9 : 1, when: w });
    else if (score <= 5) play('crowd/golf-clap', { gain: G.crowdMax * 0.8, when: w });
    else if (score <= 7) play('crowd/applause-short', { gain: G.crowdMax * (0.6 + 0.1 * (score - 6)), when: w });
    else {
      play('crowd/applause-short', { gain: G.crowdMax * 0.6, when: w });
      play(score >= 10 ? 'crowd/cheer-big' : 'crowd/cheer-small', { gain: G.crowdMax * (score >= 10 ? 0.9 : 0.75), when: w });
    }
  },
  turn() { if (!play('ui/ding', { gain: G.turn })) { synthUsed('turn'); synth.turn(); } },
  join() { if (!play('ui/pop', { gain: G.join })) { synthUsed('join'); synth.join(); } },
  // kind 'end' = 엔드 시작 호루라기, 그 밖 = 경기 끝 팡파르
  fanfare(kind) {
    if (kind === 'end') { if (!play('perc/whistle-short', { gain: G.whistle })) { synthUsed('fanfare'); synth.fanfare(); } return; }
    if (!play('ui/fanfare-win', { gain: G.fanfare })) { synthUsed('fanfare'); synth.fanfare(); }
  },
  // 경기 중 멀리서 들리는 관중 웅성거림(아주 작게). 경기 시작·끝에 켜고 끕니다
  bed(on) {
    if (!on) return bedStop();
    wantBed = true;
    if (bed || !samples || !ready() || !samples.has('crowd/murmur-loop')) return;
    bed = samples.loop('crowd/murmur-loop', { gain: 0 });
    if (bed) { DBG.played['crowd/murmur-loop'] = (DBG.played['crowd/murmur-loop'] || 0) + 1; bed.set({ gain: G.bed, glide: 0.8 }); }
  },
  stopAll() { bedStop(); this.creakStop(); },
  has: (n) => !!(samples && samples.has(n)),
  get ctxState() { return actx && actx.state; }
};
DBG.has = (n) => sfx.has(n);
DBG.state = () => (actx ? actx.state : null);
DBG.ctx = actx;
