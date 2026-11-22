// 에어하키 소리: 말렛 타구음, 벽 튕김, 골문 기둥, 골(퍽 떨어지는 소리 + 버저), 카운트다운, 공기 부상 소음.
// 실제 녹음(/common/samples.js)을 먼저 틀고, 아직 못 받았을 때만 WebAudio 합성음을 대신 냅니다.
// 녹음이 없는 소리(골 기둥 핑, 공기 부상 소음)는 계속 합성음입니다.
import { modal, grit, organ, marimba, bell, chip, pluck, brass, phrase } from '/common/voice.js';
import { createSamples } from '/common/samples.js';
import { t } from '/common/i18n.js';
let actx = null;
let master = null;
let samples = null;
function make() {
  if (actx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  actx = new AC();
  master = actx.createGain();
  master.gain.value = 0.9;
  // 큰 소리가 겹쳐도 깨지지 않게 가볍게 눌러 줍니다.
  const comp = actx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.ratio.value = 4;
  master.connect(comp).connect(actx.destination);
  samples = createSamples(actx, master);
  actx.addEventListener('statechange', refreshChip);
}
export function audio() {
  make();
  if (actx && actx.state === 'suspended') actx.resume().then(refreshChip, () => {});
  refreshChip();
  return actx;
}
// 대기실에서 이 종목 녹음을 미리 받습니다(컨텍스트는 클릭 전에도 만들 수 있고, 재생만 막혀 있음).
export function preloadSamples() {
  make();
  return samples ? samples.preload(['ball/puck-', 'ui/beep', 'ui/beep-high', 'ui/success', 'ui/coin', 'ui/fanfare-win', 'ui/whoosh-ui', 'crowd/cheer-small', 'crowd/cheer-big', 'crowd/applause-short', 'perc/whistle-short', 'swing/swoosh-light']) : Promise.resolve();
}
// 큰 화면은 클릭이 한 번도 없을 수 있어서, 어떤 키·포인터 입력이든 소리를 깨웁니다.
for (const ev of ['pointerdown', 'pointerup', 'click', 'keydown', 'touchend']) window.addEventListener(ev, audio, { passive: true });

// 소리가 아직 꺼져 있으면(suspended) 대기실에 작은 안내 칩을 보여 줍니다.
let chipEl = null;
function refreshChip() {
  const lobby = document.getElementById('lobby');
  const want = actx && actx.state !== 'running' && lobby && !lobby.classList.contains('hidden');
  if (want && !chipEl && document.body) {
    chipEl = document.createElement('div');
    chipEl.id = 'soundChip';
    chipEl.textContent = t('화면을 한 번 눌러 소리 켜기');
    chipEl.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:30;padding:8px 16px;border-radius:999px;background:rgba(10,14,28,.72);color:#e9eefc;font:600 15px system-ui,sans-serif;pointer-events:none;opacity:.85;white-space:nowrap';
    document.body.appendChild(chipEl);
  } else if (!want && chipEl) {
    chipEl.remove();
    chipEl = null;
  }
}
setInterval(refreshChip, 700);

// 시험·확인용: 이름별로 몇 번 틀었는지(window.__airhockeySfx.played)
const dbg = (window.__airhockeySfx = { played: {}, synth: {} });
function S(name, opts) {
  if (!samples || !ready()) return false;
  const ok = samples.play(name, opts);
  if (ok) dbg.played[name] = (dbg.played[name] || 0) + 1;
  return ok;
}
dbg.has = (name) => Boolean(samples && samples.has(name));
function synthNote(k) { dbg.synth[k] = (dbg.synth[k] || 0) + 1; }

const ready = () => actx && actx.state === 'running';
let muted = false; // 대기실 시연 경기는 조용히
export function setQuiet(q) {
  muted = q;
}

const noiseBufs = new Map();
function noiseBuf(sec) {
  const key = Math.round(sec * 100);
  if (noiseBufs.has(key)) return noiseBufs.get(key);
  const len = Math.max(1, Math.floor(actx.sampleRate * sec));
  const b = actx.createBuffer(1, len, actx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseBufs.set(key, b);
  return b;
}

function noise(sec, freq, q, gain, { attack = 0.002, type = 'bandpass', pan = 0, when = 0 } = {}) {
  if (!ready()) return;
  const a = actx;
  const t = a.currentTime + when;
  const src = a.createBufferSource();
  src.buffer = noiseBuf(sec + 0.02);
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  let out = g;
  if (a.createStereoPanner) {
    const p = a.createStereoPanner();
    p.pan.value = pan;
    g.connect(p);
    out = p;
  }
  src.connect(f).connect(g);
  out.connect(master);
  src.start(t);
  src.stop(t + sec + 0.02);
}

function tone(freq, sec, gain, { type = 'sine', glide = 0, pan = 0, when = 0, attack = 0.003 } = {}) {
  if (!ready()) return;
  const a = actx;
  const t = a.currentTime + when;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * glide), t + sec);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  let out = g;
  if (a.createStereoPanner) {
    const p = a.createStereoPanner();
    p.pan.value = pan;
    g.connect(p);
    out = p;
  }
  o.connect(g);
  out.connect(master);
  o.start(t);
  o.stop(t + sec + 0.03);
}

// 공기 부상 소음: 낮게 깔리는 바람 소리. 경기 중에만 크게.
let hum = null;
function startHum() {
  if (!ready() || hum) return;
  const a = actx;
  const src = a.createBufferSource();
  src.buffer = noiseBuf(2);
  src.loop = true;
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 520;
  const bp = a.createBiquadFilter();
  bp.type = 'peaking';
  bp.frequency.value = 140;
  bp.gain.value = 8;
  const g = a.createGain();
  g.gain.value = 0;
  src.connect(lp).connect(bp).connect(g).connect(master);
  src.start();
  hum = { src, g };
}
export function setHum(level) {
  if (!ready()) return;
  startHum();
  if (hum) hum.g.gain.setTargetAtTime(level, actx.currentTime, 0.4);
}

let lastFast = 0;
const panOf = (x) => Math.max(-0.8, Math.min(0.8, x * 1.4));

export const sfx = {
  // 말렛이 퍽을 칠 때: 딱딱한 플라스틱 "탁" + 낮은 몸통 울림
  hit(q, x = 0) {
    if (muted) return;
    const pan = panOf(x);
    // 퍽 소리: 세게 칠수록 크고 약간 높게
    if (S('ball/puck-hit', { gain: 0.6 + q * 0.9, rate: 0.94 + q * 0.16, pan })) return;
    synthNote('hit');
    noise(0.045, 2400 + q * 1400, 1.1, 0.35 + q * 0.5, { pan });
    tone(820 + q * 500, 0.06, 0.16 + q * 0.12, { type: 'triangle', pan, glide: 0.7 });
    tone(150, 0.09, 0.22 * (0.4 + q), { pan, glide: 0.6 });
  },
  // 레일에 맞을 때: "통"
  wall(q, x = 0) {
    if (muted) return;
    const pan = panOf(x);
    if (S('ball/puck-rail', { gain: 0.5 + q * 0.8, rate: 0.92 + q * 0.14, pan })) return;
    synthNote('wall');
    noise(0.05, 1100 + q * 500, 1.4, 0.18 + q * 0.32, { pan });
    tone(380 + q * 160, 0.07, 0.12 + q * 0.1, { type: 'triangle', pan, glide: 0.8 });
  },
  // 골문 기둥(금속 테)
  post(q, x = 0) {
    if (muted) return;
    const pan = panOf(x);
    synthNote('post'); // 맞는 녹음이 없어 합성음 그대로
    tone(2350, 0.25, 0.1 + q * 0.12, { pan });
    tone(3170, 0.18, 0.06 + q * 0.06, { pan });
    noise(0.03, 3600, 2, 0.2, { pan });
  },
  // 골: 퍽이 홈으로 떨어져 구르는 소리 → 오락실 버저
  goal(big) {
    if (muted) return;
    // 득점 차임 + 작은 환호(마지막 골은 큰 환호)
    if (S('ui/success', { gain: 0.9 })) {
      S(big ? 'crowd/cheer-big' : 'crowd/cheer-small', { gain: big ? 0.55 : 0.45, when: 0.12 });
      return;
    }
    synthNote('goal');
    [0, 0.07, 0.15, 0.21].forEach((w, i) => {
      noise(0.04, 1600 - i * 250, 1.2, 0.4 - i * 0.07, { when: w });
      tone(520 - i * 70, 0.05, 0.1, { type: 'triangle', when: w });
    });
    const base = big ? 392 : 330;
    for (const [k, m] of [[0, 1], [1, 1.26], [2, 1.5]]) {
      tone(base * m, 0.9, 0.07, { type: 'sawtooth', when: 0.32 + k * 0.004, attack: 0.02 });
      tone(base * m * 2, 0.7, 0.03, { type: 'square', when: 0.32, attack: 0.02 });
    }
    noise(1.4, 1800, 0.4, 0.16, { attack: 0.3, when: 0.35 });
  },
  count(final) {
    if (S(final ? 'ui/beep-high' : 'ui/beep', { gain: final ? 0.8 : 0.65, rate: final ? 1 : 0.95, jitter: 0 })) return;
    synthNote('count');
    tone(final ? 1320 : 880, final ? 0.42 : 0.16, 0.16, { type: 'square' });
    tone(final ? 660 : 440, final ? 0.42 : 0.16, 0.08, { type: 'triangle' });
  },
  serve() {
    if (muted) return;
    // 퍽을 테이블에 올려놓는 작은 톡
    if (S('ball/puck-hit', { gain: 0.3, rate: 0.8 })) return;
    synthNote('serve');
    tone(1046, 0.08, 0.07, { type: 'triangle' });
    tone(1568, 0.12, 0.06, { type: 'triangle', when: 0.07 });
  },
  whistle() {
    if (muted) return;
    if (S('perc/whistle-short', { gain: 0.75 })) return;
    synthNote('whistle');
    tone(1900, 0.32, 0.09, { type: 'triangle', glide: 1.06 });
  },
  win() {
    if (!ready()) return;
    if (S('ui/fanfare-win', { gain: 0.7, jitter: 0 })) {
      S('crowd/applause-short', { gain: 0.5, when: 1.2 });
      return;
    }
    synthNote('win');
    phrase(392, [[0, 0.25], [4, 0.25], [7, 0.25], [11, 0.25], [12, 0.25], [7, 0.25], [12, 0.25], [16, 0.25], [19, 1]], 300, (f, d, w) => chip(actx, master, f, d, { when: w, gain: 0.05 }));
    noise(2.2, 1600, 0.35, 0.2, { attack: 0.4, when: 0.3 });
  },
  // 동전 넣는 오락실 '삐로링'
  join() {
    if (!ready()) return;
    if (S('ui/coin', { gain: 0.6 })) return;
    synthNote('join');
    phrase(784, [[0, 0.25], [7, 0.25], [12, 0.5]], 480, (f, d, w) => chip(actx, master, f, d, { when: w, gain: 0.05, duty: 0.25 }));
  },
  fast() {
    if (muted) return;
    // 강슛 휙 소리는 0.3초에 한 번까지만 (타구음 위에 덧입히는 소리)
    const nowT = performance.now();
    if (nowT - lastFast < 300) return;
    lastFast = nowT;
    if (S('swing/swoosh-light', { gain: 0.4, rate: 0.9 })) return;
    synthNote('fast');
    noise(0.35, 900, 0.7, 0.18, { attack: 0.15 });
  }
};
