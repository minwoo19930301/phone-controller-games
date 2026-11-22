// 카트 소리: 녹음 샘플(/common/sfx)을 먼저 틀고, 못 받았거나 맞는 녹음이 없는 소리만 예전 합성음을 씁니다.
import { chip, brass, bell, grit, phrase } from '/common/voice.js';
import { createSamples } from '/common/samples.js';
import { SFX } from '/common/sfx/manifest.js';

// 이 종목이 쓰는 녹음 이름(대기실에서 한꺼번에 미리 받음)
const NAMES = [
  'kart/engine-loop', 'kart/skid-1', 'kart/skid-2', 'kart/crash-1', 'kart/crash-2', 'kart/boost', 'kart/rocket', 'kart/explosion',
  'kart/horn-start', 'kart/item-pickup', 'ui/beep', 'ui/click', 'ui/success', 'ui/ding', 'ui/pop', 'ui/fanfare-win',
  'water/plop', 'scifi/sizzle', 'crowd/cheer-big', 'crowd/murmur-loop'
];
// 소리 크기(합성음 대비 녹음은 크게 들리므로 낮춰 둡니다): 부딪힘·폭발이 가장 크고 환경음은 아주 작게
const MASTER = 0.9;
const BED_GAIN = 0.12; // 관중 바탕
const ENGINE_GAIN = 0.3; // 엔진(칸 하나당)

let actx = null;
let master = null;
let samples = null;
const out = () => master || actx.destination;
// 시험·검증용 집계: 어떤 이름을 몇 번 틀었는지(window.__kartSfx)
const stat = (window.__kartSfx = { played: {}, synth: {} });

function init() {
  if (actx) return actx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  actx = new AC();
  const comp = actx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 6;
  master = actx.createGain();
  master.gain.value = MASTER;
  master.connect(comp).connect(actx.destination);
  const sub = {};
  for (const n of NAMES) if (SFX[n]) sub[n] = SFX[n];
  samples = createSamples(actx, master, { manifest: sub });
  samples.preload();
  return actx;
}
export function audio() {
  init();
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}
// 큰 화면은 클릭 없이 폰으로 시작하는 일이 많아, 어떤 키·포인터 입력이든 소리를 켭니다.
for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'click']) window.addEventListener(ev, audio, { passive: true });
init();

// 소리가 잠겨 있는 동안 대기실에 작은 안내 칩을 보입니다.
function chipSync() {
  const el = document.getElementById('soundChip');
  if (!el) return;
  const lobby = document.getElementById('lobby');
  el.classList.toggle('hidden', !(actx && actx.state === 'suspended' && lobby && !lobby.classList.contains('hidden')));
}
setInterval(chipSync, 500);
if (actx) actx.onstatechange = chipSync;

/** 녹음 틀기. 틀었으면 true, 아직 못 받았으면 false(→ 합성음) */
function play(name, opts) {
  if (!ready() || !samples) return false;
  const ok = samples.play(name, opts);
  const bucket = ok ? stat.played : stat.synth;
  bucket[name] = (bucket[name] || 0) + 1;
  return ok;
}

const ready = () => actx && actx.state === 'running';

function tone(freq, sec, gain, type = 'sine', glide = 0, when = 0) {
  if (!ready()) return;
  const a = actx;
  const t = a.currentTime + when;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * glide), t + sec);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + sec + 0.02);
}
function noise(sec, freq, q, gain, type = 'bandpass') {
  if (!ready()) return;
  const a = actx;
  const len = Math.max(1, Math.floor(a.sampleRate * sec));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

// 엔진: 톱니파 둘 + 저역 필터. 속도에 따라 음높이가 올라갑니다.
const engines = [];
function engineVoice(i) {
  if (engines[i] || !ready()) return engines[i];
  const a = actx;
  const o1 = a.createOscillator();
  const o2 = a.createOscillator();
  o1.type = 'sawtooth';
  o2.type = 'square';
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 500;
  const g = a.createGain();
  g.gain.value = 0;
  o1.connect(f);
  o2.connect(f);
  f.connect(g).connect(a.destination);
  o1.start();
  o2.start();
  engines[i] = { o1, o2, f, g };
  return engines[i];
}

// 합성 엔진을 잠재웁니다(녹음 엔진으로 바뀔 때·끝날 때)
function synthEngineOff() {
  for (const e of engines) if (e) e.g.gain.setTargetAtTime(0, actx.currentTime, 0.05);
}
const loops = []; // 칸 번호 → 녹음 엔진 루프
let bed = null; // 관중 바탕 루프
const cool = new Map(); // 쿨다운(스키드·부딪힘이 연달아 울리지 않게)
const gate = (key, ms) => {
  const now = performance.now();
  if ((cool.get(key) || 0) > now) return false;
  cool.set(key, now + ms);
  return true;
};
let skidTurn = 0;

export const sfx = {
  /** 엔진 소리 갱신. i: 칸 번호, speed: 0..1, gas: 0..1 */
  engine(i, speed, gas, boost) {
    if (!ready()) return;
    if (!bed && samples && samples.has('crowd/murmur-loop')) bed = samples.loop('crowd/murmur-loop', { gain: BED_GAIN });
    if (!loops[i] && samples && samples.has('kart/engine-loop')) {
      loops[i] = samples.loop('kart/engine-loop', { gain: 0 });
      if (loops[i]) { synthEngineOff(); stat.played['kart/engine-loop'] = (stat.played['kart/engine-loop'] || 0) + 1; }
    }
    if (loops[i]) {
      loops[i].set({ gain: ENGINE_GAIN * (0.45 + gas * 0.3 + speed * 0.4), rate: Math.min(1.8, 0.7 + speed * 0.85 + (boost ? 0.2 : 0)), glide: 0.1 });
      return;
    }
    const e = engineVoice(i);
    if (!e) return;
    const t = actx.currentTime;
    const base = 55 + speed * 150 + (boost ? 25 : 0);
    e.o1.frequency.setTargetAtTime(base, t, 0.05);
    e.o2.frequency.setTargetAtTime(base * 0.5, t, 0.05);
    e.f.frequency.setTargetAtTime(380 + speed * 900 + gas * 300, t, 0.08);
    e.g.gain.setTargetAtTime(0.012 + gas * 0.014 + speed * 0.012, t, 0.08);
  },
  /** 엔진·관중 바탕을 모두 멈춥니다(경기 끝·대기실로·화면 숨김) */
  engineOff() {
    if (!ready()) return;
    synthEngineOff();
    for (let i = 0; i < loops.length; i++) if (loops[i]) { loops[i].stop(0.25); loops[i] = null; }
    if (bed) { bed.stop(0.6); bed = null; }
  },
  // 카운트다운: 3·2·1 은 짧은 전자음, GO 는 에어 혼
  count(n) {
    if (n > 0) {
      if (!play('ui/beep', { gain: 0.9, rate: 1, jitter: 0 })) tone(520, 0.16, 0.18, 'square');
    } else if (!play('kart/horn-start', { gain: 0.9, jitter: 0 })) tone(1040, 0.5, 0.18, 'square');
  },
  // 벽 부딪힘: 세기에 따라 묵직한 쿵(crash-1) 또는 가벼운 툭(crash-2)
  thump(power) {
    if (!ready()) return;
    const q = Math.min(1, power / 20);
    if (play(power > 9 ? 'kart/crash-1' : 'kart/crash-2', { gain: 0.5 + q * 0.7, rate: 1.1 - q * 0.25 })) return;
    grit(actx, out(), { sec: 0.16, freq: 220, q: 0.7, type: 'lowpass', gain: 0.35 + q * 0.5 });
    tone(110, 0.14, 0.12 + q * 0.2, 'sine', 0.5);
  },
  // 카트끼리 부딪힘(예전엔 무음): 같은 쿵 소리를 작게
  bump(imp) {
    if (!ready() || !gate('bump', 250)) return;
    const q = Math.min(1, imp / 16);
    play(imp > 9 ? 'kart/crash-1' : 'kart/crash-2', { gain: 0.3 + q * 0.5, rate: 1.2 - q * 0.2 });
  },
  // 급커브 미끄러짐: 타이어 끽 소리(녹음은 한 번짜리라 쿨다운을 두고 가끔)
  skid(key, level) {
    if (!ready() || !gate('skid' + key, 1300)) return;
    play(skidTurn++ % 2 ? 'kart/skid-1' : 'kart/skid-2', { gain: 0.25 + Math.min(1, level) * 0.2, rate: 1 });
  },
  boost() {
    if (!ready()) return;
    if (play('kart/boost', { gain: 0.8, rate: 1 })) return;
    grit(actx, out(), { sec: 0.35, freq: 600, q: 1.2, gain: 0.25, sweep: 3 });
    tone(380, 0.35, 0.08, 'sawtooth', 2.6);
  },
  // 랩: 맑은 종 한 번
  lap() {
    if (!ready()) return;
    if (play('ui/ding', { gain: 0.7, rate: 1.1 })) return;
    bell(actx, out(), 523, { gain: 0.1, sec: 0.9 });
    bell(actx, out(), 698, { gain: 0.1, sec: 1.0, when: 0.12 });
  },
  // 완주: 환호 + 짧은 팡파르(둘 다 못 받았으면 합성 브라스)
  finish() {
    if (!ready()) return;
    const a = play('crowd/cheer-big', { gain: 0.7, rate: 1, jitter: 0.02 });
    const b = play('ui/fanfare-win', { gain: 0.6, rate: 1, jitter: 0 });
    if (a || b) return;
    phrase(330, [[0, 0.5], [7, 0.5], [3, 0.5], [10, 0.5], [12, 1.6]], 150, (f, sec, at) => brass(actx, out(), f, sec, { gain: 0.06, when: at }));
  },
  // 입장: 가벼운 팝
  join() {
    if (!ready()) return;
    if (play('ui/pop', { gain: 0.6, rate: 1.25 })) return;
    phrase(440, [[7, 0.25], [0, 0.25], [5, 0.4]], 200, (f, sec, at) => chip(actx, out(), f, sec, { gain: 0.05, when: at }));
  },
  // 아이템 상자 깨짐: 짧고 밝은 팝
  pickup() {
    if (!ready()) return;
    if (play('kart/item-pickup', { gain: 0.8, rate: 1 })) return;
    bell(actx, out(), 1568, { gain: 0.06, sec: 0.35 });
    bell(actx, out(), 2093, { gain: 0.05, sec: 0.4, when: 0.05 });
  },
  // 룰렛 똑딱: 마우스 클릭. 맞는 녹음은 있지만 아주 짧게 연달아 나오므로 작게
  tick() {
    if (!ready()) return;
    if (play('ui/click', { gain: 0.35, rate: 1.4 + Math.random() * 0.3 })) return;
    tone(1900 + Math.random() * 300, 0.03, 0.025, 'square');
  },
  // 아이템이 정해짐: 두 음 차임
  itemGet() {
    if (!ready()) return;
    if (play('ui/success', { gain: 0.7, rate: 1 })) return;
    phrase(660, [[0, 0.12], [4, 0.12], [7, 0.3]], 360, (f, sec, at) => chip(actx, out(), f, sec, { gain: 0.05, when: at }));
  },
  /** 아이템 쓰기 */
  use(kind) {
    if (!ready()) return;
    if (kind === 'banana') {
      if (!play('water/plop', { gain: 0.8, rate: 1 })) tone(320, 0.22, 0.1, 'triangle', 0.5);
    } else if (kind === 'nitro' || kind === 'turbo') {
      // 같은 바람 소리를 니트로는 높고 짧게, 터보는 낮고 묵직하게
      const ok = kind === 'turbo' ? play('kart/boost', { gain: 0.9, rate: 0.8 }) : play('kart/boost', { gain: 0.7, rate: 1.25 });
      if (!ok) {
        grit(actx, out(), { sec: kind === 'turbo' ? 0.7 : 0.4, freq: 380, q: 1.1, gain: 0.3, sweep: 2600 });
        tone(300, kind === 'turbo' ? 0.6 : 0.35, 0.08, 'sawtooth', 3);
      }
    } else if (kind === 'missile') {
      if (!play('kart/rocket', { gain: 0.8, rate: 1 })) {
        grit(actx, out(), { sec: 0.5, freq: 2200, q: 0.8, gain: 0.25, sweep: 500 });
        tone(880, 0.4, 0.06, 'square');
      }
    } else if (kind === 'star') {
      // 어울리는 반짝 녹음이 없어 합성음 그대로
      phrase(523, [[0, 0.1], [4, 0.1], [7, 0.1], [12, 0.1], [16, 0.1], [19, 0.35]], 600, (f, sec, at) => chip(actx, out(), f, sec, { gain: 0.045, when: at }));
    }
  },
  // 미끄러져 돎: 타이어 끽(녹음) 두 종류를 번갈아
  spin() {
    if (!ready()) return;
    if (play(skidTurn++ % 2 ? 'kart/skid-1' : 'kart/skid-2', { gain: 0.9, rate: 1 })) return;
    tone(1200, 0.6, 0.07, 'sine', 0.3);
    tone(900, 0.5, 0.05, 'triangle', 0.4, 0.05);
  },
  // 번개: 전기 지직(녹음) + 낮은 쿵은 합성(천둥 녹음이 없음)
  thunder() {
    if (!ready()) return;
    play('scifi/sizzle', { gain: 0.9, rate: 0.9 });
    tone(70, 0.8, 0.25, 'sine', 0.6);
    if (!samples.has('scifi/sizzle')) grit(actx, out(), { sec: 0.9, freq: 1800, q: 0.5, gain: 0.45, type: 'highpass' });
  },
  // 유도탄 터짐
  boom() {
    if (!ready()) return;
    if (play('kart/explosion', { gain: 1, rate: 1 })) return;
    grit(actx, out(), { sec: 0.5, freq: 300, q: 0.6, type: 'lowpass', gain: 0.6 });
    tone(90, 0.4, 0.2, 'sine', 0.5);
  }
};
// 화면이 가려지면 엔진·관중 바탕을 끕니다(돌아오면 다음 프레임에 다시 시작).
document.addEventListener('visibilitychange', () => { if (document.hidden) sfx.engineOff(); });
window.addEventListener('pagehide', () => sfx.engineOff());
