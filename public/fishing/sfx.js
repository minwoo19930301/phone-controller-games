// 배스 낚시 큰 화면 소리. 파일 없이 WebAudio 로 만듭니다(물소리, 새소리, 풍덩, 톡톡, 드랙, 줄 끊김, 잡았다).
import { modal, grit, organ, marimba, bell, chip, pluck, brass, phrase } from '/common/voice.js';
import { createSamples } from '/common/samples.js';
let actx = null;
let master = null;
let noiseBuf = null;
let smp = null; // 실제 녹음 재생기(/common/samples.js). 못 받은 소리는 아래 합성음으로 대신합니다.
let stateCb = null;
// 시험용 집계: window.__fishingSfx.played[이름] = 녹음을 튼 횟수, synth[이름] = 합성음으로 대신한 횟수
const stat = (window.__fishingSfx = { played: {}, synth: {}, state: 'none' });
stat.has = (name) => !!(smp && smp.has(name));
// 이 종목이 쓰는 녹음 묶음(대기실에서 미리 받음)
const PRELOAD = ['water/', 'swing/cast', 'swing/reel', 'swing/swoosh-light', 'swing/bow-release', 'ui/success', 'ui/fanfare-win', 'crowd/applause-short', 'crowd/cheer-small'];
// 소리 세기 기준: 부딪힘·풍덩이 가장 크고(0.7~0.9), 주변 소리는 작게(0.6 × 기본 0.5)
const G = { amb: 0.6, cast: 0.9, plop: 1, splash: 0.9, jump: 0.95, bite: 0.95, hook: 0.8, snap: 0.9, flop: 0.8, drag: 1, click: 0.6, nibble: 0.3, release: 0.75 };

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
    smp = createSamples(actx, master);
    smp.preload(PRELOAD).then(upgradeAmbience);
    actx.onstatechange = () => { stat.state = actx.state; if (stateCb) stateCb(actx.state); if (actx.state === 'running' && wantAmb && !amb) startAmbience(); };
    stat.state = actx.state;
  }
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  if (wantAmb && !amb) startAmbience();
  return actx;
}
const live = () => actx && actx.state === 'running';
/** 소리 상태('suspended'|'running')가 바뀔 때마다 cb 를 부릅니다(대기실 안내 칩용). 지금 상태도 바로 한 번. */
export function watchAudio(cb) {
  stateCb = cb;
  cb(actx ? actx.state : 'suspended');
}
/** 녹음이 있으면 틀고 true, 없으면 false(→ 호출한 쪽이 합성음을 냄). */
function P(name, opts) {
  if (live() && smp && smp.play(name, opts)) {
    stat.played[name] = (stat.played[name] || 0) + 1;
    return true;
  }
  stat.synth[name] = (stat.synth[name] || 0) + 1;
  return false;
}
// 화면이 가려지면 이어 도는 소리(주변 소리·드랙)를 끄고, 다시 보이면 되살립니다.
let hidden = false;
document.addEventListener('visibilitychange', () => {
  hidden = document.hidden;
  if (!actx) return;
  if (hidden) {
    for (const [slot, d] of dragLoops) { d.h.stop(0.1); dragLoops.delete(slot); }
    if (amb && amb.h) amb.h.set({ gain: 0 });
  } else {
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    if (amb && amb.h) amb.h.set({ gain: G.amb });
  }
});

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
  // 녹음(호숫가 물결·먼 새소리)이 있으면 그걸 깔고, 없으면 아래 합성 바탕
  const h = smp && smp.loop('water/lake-loop', { gain: 0 });
  if (h) {
    h.set({ gain: hidden ? 0 : G.amb, glide: 1.2 });
    amb = { h };
    stat.played['water/lake-loop'] = (stat.played['water/lake-loop'] || 0) + 1;
    return;
  }
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
// 녹음이 늦게 내려받아진 경우: 이미 돌고 있는 합성 바탕을 녹음으로 바꿉니다.
function upgradeAmbience() {
  if (!wantAmb || !live() || (amb && amb.h) || !smp.has('water/lake-loop')) return;
  if (amb) stopAmbience();
  startAmbience();
}
function stopAmbience() {
  if (!amb) return;
  const a = amb;
  amb = null;
  if (a.h) { a.h.stop(0.6); return; }
  clearInterval(a.timer);
  a.out.gain.setTargetAtTime(0, actx.currentTime, 0.6);
  setTimeout(() => a.nodes.forEach((n) => { try { n.stop(); } catch (e) {} }), 3000);
}
export function setAmbience(on) {
  wantAmb = on;
  if (on) {
    if (live()) startAmbience();
    return;
  }
  stopAmbience();
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
// 녹음 드랙: 자리(slot)마다 이어 도는 소리 하나. 한동안 안 울리면 끄고 치웁니다.
const dragLoops = new Map();
setInterval(() => {
  if (!live()) return;
  const now = performance.now();
  for (const d of drags.values()) if (now > d.until) d.g.gain.setTargetAtTime(0, actx.currentTime, 0.05);
  for (const [slot, d] of dragLoops) {
    if (now > d.until) d.h.set({ gain: 0 });
    if (now > d.until + 1500) { d.h.stop(0.1); dragLoops.delete(slot); }
  }
}, 80);

export const sfx = {
  // 통기타 한 줄 뜯기(어울리는 녹음이 없어 합성 유지)
  // 들어오고 나갈 때의 소리는 높게 찢어지는 소리로 들린다는 피드백이 있어 뺐습니다(11/23).
  join: () => {},
  leave: () => {},
  // 던지기: 휙 + 릴에서 줄 풀리는 소리가 한 녹음에 같이 있음. 세게 던질수록 크고 약간 높게
  whoosh: (p = 0.6) => {
    if (P('swing/cast', { gain: G.cast * (0.55 + 0.45 * p), rate: 0.94 + 0.14 * p })) return;
    noise(0.35 + p * 0.2, { freq: 700, sweep: 2600, q: 0.7, gain: 0.18 + p * 0.25, attack: 0.08, curve: 2 });
    for (let i = 0; i < 10; i++) noise(0.03, { freq: 5200, q: 3, gain: 0.05, at: 0.1 + i * (0.05 + p * 0.03) });
  },
  // 감기 딸깍(큰 화면은 한 번 더 이어서 1초쯤)
  reelIn: () => {
    if (P('swing/reel-click', { gain: G.click })) { P('swing/reel-click', { gain: G.click * 0.9, when: 0.45, rate: 1.05 }); return; }
    for (let i = 0; i < 16; i++) noise(0.022, { freq: 4200, q: 4, gain: 0.07, at: i * 0.055 });
  },
  // 미끼 착수: 멀수록 작고 조금 높게
  plop: (v = 0.7) => {
    if (P('water/plop', { gain: G.plop * (0.35 + 0.65 * v), rate: 1.12 - 0.2 * v })) return;
    tone(520, 0.12, { gain: 0.25 * v, to: 180, type: 'sine' });
    noise(0.35, { freq: 900, q: 0.6, gain: 0.22 * v, attack: 0.01, curve: 4 });
  },
  // 찌 톡: 퐁 소리를 높이고 작게(twitch·rise 는 너무 작아 합성 유지)
  twitch: () => { tone(760, 0.06, { gain: 0.08, to: 430 }); noise(0.06, { freq: 1800, q: 1.4, gain: 0.05 }); },
  rise: () => { tone(980, 0.05, { gain: 0.05, to: 620 }); noise(0.12, { freq: 1500, q: 1, gain: 0.035, attack: 0.004 }); },
  nibble: () => {
    if (P('water/plop', { gain: G.nibble, rate: 1.7, jitter: 0.1 })) return;
    tone(380, 0.07, { gain: 0.14, to: 260 }); noise(0.08, { freq: 1500, q: 1.2, gain: 0.06 });
  },
  // 입질(찌가 확 잠김): 짧고 힘 있는 풍덩
  bite: () => {
    if (P('water/splash-small', { gain: G.bite, rate: 1.05 })) return;
    tone(300, 0.22, { gain: 0.28, to: 90 });
    noise(0.5, { freq: 700, q: 0.7, gain: 0.25, attack: 0.02, curve: 3 });
  },
  // 챔질: 낚싯대 휙
  hook: () => {
    if (P('swing/swoosh-light', { gain: G.hook, rate: 0.95 })) return;
    noise(0.18, { freq: 2200, sweep: 600, q: 0.8, gain: 0.3, attack: 0.01 });
    tone(140, 0.25, { gain: 0.3, type: 'triangle', to: 70 });
  },
  // 놓침: 작은 퐁 소리를 낮춰 풀 빠지는 느낌(날카롭지 않게)
  miss: () => {
    if (P('water/plop', { gain: 0.5, rate: 0.72 })) return;
    tone(420, 0.18, { gain: 0.14, type: 'triangle', to: 300 }); tone(300, 0.26, { gain: 0.12, type: 'triangle', at: 0.15, to: 200 });
  },
  // 물고기 점프: 크게 풍덩
  jump: () => {
    if (P('water/splash-big', { gain: G.jump, rate: 1.05 })) return;
    noise(0.6, { freq: 1100, q: 0.5, gain: 0.4, attack: 0.01, curve: 3 });
    noise(0.25, { freq: 3000, q: 0.9, gain: 0.15, attack: 0.005 });
  },
  splash: (v = 0.7) => {
    if (P('water/splash-small', { gain: G.splash * (0.5 + 0.5 * v), rate: 0.95 })) return;
    noise(0.55, { freq: 900, q: 0.5, gain: 0.32 * v, attack: 0.01, curve: 3.5 });
  },
  dragBurst: (p = 0.6) => {
    if (P('swing/reel-click', { gain: G.click * (0.7 + 0.5 * p), rate: 1.3 })) return;
    for (let i = 0; i < 6; i++) noise(0.02, { freq: 3800, q: 5, gain: 0.05 + p * 0.03, at: i * 0.03 });
  },
  // 드랙: 장력(T)이 클수록 크고 빠르게 지이이. 소리가 이어서 도는 동안 계속 불러 줌
  drag(slot, T) {
    if (!live()) return;
    if (smp && smp.has('swing/reel-drag-loop')) {
      if (hidden) return;
      let d = dragLoops.get(slot);
      if (!d) {
        const h = smp.loop('swing/reel-drag-loop', { gain: 0 });
        if (h) {
          d = { h, until: 0 };
          dragLoops.set(slot, d);
          stat.played['swing/reel-drag-loop'] = (stat.played['swing/reel-drag-loop'] || 0) + 1;
        }
      }
      if (d) {
        d.until = performance.now() + 120;
        const t = Math.max(0, Math.min(1.2, T));
        d.h.set({ gain: G.drag * (0.3 + 0.7 * Math.min(1, t)), rate: 0.8 + 0.35 * t, glide: 0.05 });
        return;
      }
    }
    const d = dragNode(slot);
    d.until = performance.now() + 120;
    d.o.frequency.setTargetAtTime(38 + T * 34, actx.currentTime, 0.05);
    d.g.gain.setTargetAtTime(0.05 + Math.max(0, T - 0.8) * 0.25, actx.currentTime, 0.04);
  },
  // 줄 끊김: 팅 하는 줄 튕김
  snap: () => {
    if (P('swing/bow-release', { gain: G.snap, rate: 1.35 })) return;
    noise(0.07, { freq: 5000, q: 0.6, type: 'highpass', gain: 0.6, attack: 0.002, curve: 6 });
    tone(1800, 0.12, { gain: 0.2, type: 'square', to: 300 });
    tone(120, 0.3, { gain: 0.2, type: 'triangle', at: 0.04, to: 50 });
  },
  // 잡았다: 물고기 퍼덕임 + 밝은 종소리. 큰 놈이면 박수, 기록이면 트럼펫 팡파르와 환호
  catchFish: (w = 1, record = false) => {
    const big = w >= 2.5 || record;
    if (!P('water/fish-flop', { gain: G.flop })) noise(0.6, { freq: 800, q: 0.5, gain: 0.35, attack: 0.01, curve: 3 });
    if (!P('ui/success', { gain: 0.5, when: 0.3 })) {
      const notes = big ? [523, 659, 784, 1047, 1319] : [587, 740, 880, 1175];
      notes.forEach((f, i) => tone(f, 0.32, { gain: 0.16, type: 'triangle', at: 0.25 + i * 0.09 }));
    }
    if (big && !P('crowd/applause-short', { gain: 0.55, when: 0.5 })) {
      for (let i = 0; i < 26; i++) noise(0.04, { freq: 1400 + Math.random() * 900, q: 1, gain: 0.08, at: 0.5 + Math.random() * 1.6 });
    }
    if (record) {
      if (!P('ui/fanfare-win', { gain: 0.5, when: 0.7 })) [784, 1047, 1319].forEach((f) => tone(f, 1.0, { gain: 0.1, type: 'triangle', at: 0.75 }));
      P('crowd/cheer-small', { gain: 0.5, when: 1.0 });
    }
  },
  // 놓아주기: 풍덩(중간 크기, 조금 낮게)
  release: () => {
    if (P('water/splash-small', { gain: G.release, rate: 0.82 })) return;
    noise(0.45, { freq: 1000, q: 0.5, gain: 0.26, attack: 0.008, curve: 3.5 });
    tone(330, 0.16, { gain: 0.08, to: 160, at: 0.02 });
  }
};
