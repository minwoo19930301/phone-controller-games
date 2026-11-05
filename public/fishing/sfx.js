// 배스 낚시 큰 화면 소리. 파일 없이 WebAudio 로 만듭니다(물소리, 새소리, 풍덩, 톡톡, 드랙, 줄 끊김, 잡았다).
let actx = null;
let master = null;
let noiseBuf = null;

export function audio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
    const comp = actx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master = actx.createGain();
    master.gain.value = 0.9;
    master.connect(comp).connect(actx.destination);
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (actx.state === 'suspended') actx.resume();
  if (wantAmb && !amb) startAmbience();
  return actx;
}
const live = () => actx && actx.state === 'running';

function noise(dur, { freq = 1000, q = 0.8, type = 'bandpass', gain = 0.4, attack = 0.005, curve = 3, at = 0, sweep = null } = {}) {
  if (!live()) return;
  const t = actx.currentTime + at;
  const src = actx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = actx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  f.Q.value = q;
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.setTargetAtTime(0.0001, t + attack, dur / curve);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.5);
}
function tone(freq, dur, { gain = 0.3, type = 'sine', at = 0, to = null, attack = 0.005 } = {}) {
  if (!live()) return;
  const t = actx.currentTime + at;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// ---------- 주변 소리: 잔물결, 새, 풀벌레 ----------
let wantAmb = false;
let amb = null;
function startAmbience() {
  if (!live() || amb) return;
  const out = actx.createGain();
  out.gain.value = 0;
  out.gain.setTargetAtTime(1, actx.currentTime, 1.5);
  out.connect(master);
  // 잔물결: 낮게 거른 잡음을 천천히 출렁이게
  const src = actx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const lp = actx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 520;
  const g = actx.createGain();
  g.gain.value = 0.05;
  const lfo = actx.createOscillator();
  lfo.frequency.value = 0.23;
  const lg = actx.createGain();
  lg.gain.value = 0.03;
  lfo.connect(lg).connect(g.gain);
  src.connect(lp).connect(g).connect(out);
  src.start();
  lfo.start();
  // 풀벌레: 높은 음을 빠르게 끊어서
  const cr = actx.createOscillator();
  cr.frequency.value = 4600;
  const crg = actx.createGain();
  crg.gain.value = 0;
  const am = actx.createOscillator();
  am.type = 'square';
  am.frequency.value = 23;
  const amg = actx.createGain();
  amg.gain.value = 0.006;
  am.connect(amg).connect(crg.gain);
  cr.connect(crg).connect(out);
  cr.start();
  am.start();
  amb = { out, nodes: [src, lfo, cr, am], timer: setInterval(birds, 2600) };
}
function birds() {
  if (!live() || !amb || Math.random() < 0.45) return;
  const base = 2200 + Math.random() * 1600;
  const n = 2 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) {
    tone(base * (1 + Math.random() * 0.15), 0.09, { gain: 0.025, at: i * 0.13, to: base * (1.25 + Math.random() * 0.3) });
  }
}
export function setAmbience(on) {
  wantAmb = on;
  if (on) {
    if (live()) startAmbience();
    return;
  }
  if (!amb) return;
  const a = amb;
  amb = null;
  clearInterval(a.timer);
  a.out.gain.setTargetAtTime(0, actx.currentTime, 0.6);
  setTimeout(() => a.nodes.forEach((n) => { try { n.stop(); } catch (e) {} }), 3000);
}

// ---------- 드랙(줄이 풀릴 때 지이익) ----------
const drags = new Map();
function dragNode(slot) {
  let d = drags.get(slot);
  if (d) return d;
  const o = actx.createOscillator();
  o.type = 'square';
  o.frequency.value = 48;
  const hp = actx.createBiquadFilter();
  hp.type = 'bandpass';
  hp.frequency.value = 2400;
  hp.Q.value = 0.9;
  const g = actx.createGain();
  g.gain.value = 0;
  o.connect(hp).connect(g).connect(master);
  o.start();
  d = { o, g, until: 0 };
  drags.set(slot, d);
  return d;
}
setInterval(() => {
  if (!live()) return;
  const now = performance.now();
  for (const d of drags.values()) if (now > d.until) d.g.gain.setTargetAtTime(0, actx.currentTime, 0.05);
}, 80);

export const sfx = {
  join: () => { tone(880, 0.12, { gain: 0.18, type: 'triangle' }); tone(1320, 0.16, { gain: 0.15, type: 'triangle', at: 0.09 }); },
  leave: () => { tone(660, 0.14, { gain: 0.12, type: 'triangle' }); tone(440, 0.18, { gain: 0.1, type: 'triangle', at: 0.1 }); },
  whoosh: (p = 0.6) => {
    noise(0.35 + p * 0.2, { freq: 700, sweep: 2600, q: 0.7, gain: 0.18 + p * 0.25, attack: 0.08, curve: 2 });
    // 줄 풀리는 소리
    for (let i = 0; i < 10; i++) noise(0.03, { freq: 5200, q: 3, gain: 0.05, at: 0.1 + i * (0.05 + p * 0.03) });
  },
  reelIn: () => { for (let i = 0; i < 16; i++) noise(0.022, { freq: 4200, q: 4, gain: 0.07, at: i * 0.055 }); },
  plop: (v = 0.7) => {
    tone(520, 0.12, { gain: 0.25 * v, to: 180, type: 'sine' });
    noise(0.35, { freq: 900, q: 0.6, gain: 0.22 * v, attack: 0.01, curve: 4 });
  },
  twitch: () => { tone(760, 0.06, { gain: 0.08, to: 430 }); noise(0.06, { freq: 1800, q: 1.4, gain: 0.05 }); },
  rise: () => { tone(980, 0.05, { gain: 0.05, to: 620 }); noise(0.12, { freq: 1500, q: 1, gain: 0.035, attack: 0.004 }); },
  nibble: () => { tone(380, 0.07, { gain: 0.14, to: 260 }); noise(0.08, { freq: 1500, q: 1.2, gain: 0.06 }); },
  bite: () => {
    tone(300, 0.22, { gain: 0.28, to: 90 });
    noise(0.5, { freq: 700, q: 0.7, gain: 0.25, attack: 0.02, curve: 3 });
  },
  hook: () => {
    noise(0.18, { freq: 2200, sweep: 600, q: 0.8, gain: 0.3, attack: 0.01 });
    tone(140, 0.25, { gain: 0.3, type: 'triangle', to: 70 });
  },
  miss: () => { tone(420, 0.18, { gain: 0.14, type: 'triangle', to: 300 }); tone(300, 0.26, { gain: 0.12, type: 'triangle', at: 0.15, to: 200 }); },
  jump: () => {
    noise(0.6, { freq: 1100, q: 0.5, gain: 0.4, attack: 0.01, curve: 3 });
    noise(0.25, { freq: 3000, q: 0.9, gain: 0.15, attack: 0.005 });
  },
  splash: (v = 0.7) => noise(0.55, { freq: 900, q: 0.5, gain: 0.32 * v, attack: 0.01, curve: 3.5 }),
  dragBurst: (p = 0.6) => { for (let i = 0; i < 6; i++) noise(0.02, { freq: 3800, q: 5, gain: 0.05 + p * 0.03, at: i * 0.03 }); },
  drag(slot, T) {
    if (!live()) return;
    const d = dragNode(slot);
    d.until = performance.now() + 120;
    d.o.frequency.setTargetAtTime(38 + T * 34, actx.currentTime, 0.05);
    d.g.gain.setTargetAtTime(0.05 + Math.max(0, T - 0.8) * 0.25, actx.currentTime, 0.04);
  },
  snap: () => {
    noise(0.07, { freq: 5000, q: 0.6, type: 'highpass', gain: 0.6, attack: 0.002, curve: 6 });
    tone(1800, 0.12, { gain: 0.2, type: 'square', to: 300 });
    tone(120, 0.3, { gain: 0.2, type: 'triangle', at: 0.04, to: 50 });
  },
  catchFish: (w = 1, record = false) => {
    noise(0.6, { freq: 800, q: 0.5, gain: 0.35, attack: 0.01, curve: 3 });
    const big = w >= 2.5 || record;
    const notes = big ? [523, 659, 784, 1047, 1319] : [587, 740, 880, 1175];
    notes.forEach((f, i) => tone(f, 0.32, { gain: 0.16, type: 'triangle', at: 0.25 + i * 0.09 }));
    if (big) for (let i = 0; i < 26; i++) noise(0.04, { freq: 1400 + Math.random() * 900, q: 1, gain: 0.08, at: 0.5 + Math.random() * 1.6 });
    if (record) [784, 1047, 1319].forEach((f) => tone(f, 1.0, { gain: 0.1, type: 'triangle', at: 0.75 }));
  },
  release: () => {
    noise(0.45, { freq: 1000, q: 0.5, gain: 0.26, attack: 0.008, curve: 3.5 });
    tone(330, 0.16, { gain: 0.08, to: 160, at: 0.02 });
  }
};
