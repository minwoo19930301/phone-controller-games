// 광선검 큰 화면 소리: 드론 발사, 충전, 칼에 튕기는 소리, 격추 폭발, 피격, 점화, 슬로우, 웨이브 경보, 카운트다운, 박수,
// 로봇 검투(예고 충전, 로봇 칼 휘두름, 칼끼리 부딪힘, 베기, 로봇 쓰러짐).
// 녹음(/common/sfx)이 있으면 녹음을 틀고, 아직 못 받았을 때만 예전 합성음을 냅니다. 녹음이 없는 소리(웨이브 경보·벽 틱·드론 충전·바탕 소음)는 합성음 그대로입니다.
// 칼날의 웅웅 소리는 각자 폰 스피커에서 납니다. 큰 화면은 훈련장 바탕 소음만 아주 작게 깔아 둡니다.
// 큰 화면은 클릭 없이(폰에서) 시작하는 일이 많아 AudioContext 가 멈춘 채일 수 있습니다: 아무 키·포인터에서 다시 켜고, 멈춰 있는 동안 대기실에 작은 안내 칩을 띄웁니다.
import { modal, grit, organ, marimba, bell, chip, pluck, brass, phrase } from '/common/voice.js';
import { createSamples } from '/common/samples.js';
let actx = null;
let master = null;
let ambient = null;
let samples = null;
// 디버그: 어떤 녹음이 몇 번 재생됐는지(window.__saberSfx.played), 합성음으로 대신한 횟수(fallback)
const dbg = { played: {}, fallback: {}, ctx: () => actx, has: (n) => !!(samples && samples.has(n)) };
window.__saberSfx = dbg;
// 이 종목이 쓰는 녹음 이름 앞머리(대기실에서 미리 받기)
const PRELOAD = ['scifi/clash', 'scifi/deflect', 'scifi/ignite', 'scifi/laser-shot', 'scifi/power-down', 'scifi/robot-swing', 'scifi/servo-charge', 'scifi/sizzle',
  'kart/explosion', 'perc/big-drum', 'swing/swoosh-heavy', 'ui/beep-high', 'ui/countdown-tick', 'ui/ding', 'ui/fanfare-win', 'ui/sting-lose', 'crowd/applause-long'];
function init() {
  if (actx) return actx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  actx = new AC();
  master = actx.createDynamicsCompressor();
  master.threshold.value = -14;
  master.ratio.value = 4;
  master.connect(actx.destination);
  samples = createSamples(actx, master);
  samples.preload(PRELOAD);
  actx.addEventListener('statechange', onState);
  return actx;
}
function onState() {
  if (actx && actx.state === 'running' && !ambient) startAmbient();
  updateChip();
}
export function audio() {
  init();
  if (actx && actx.state === 'suspended') actx.resume();
  if (actx && actx.state === 'running' && !ambient) startAmbient();
  updateChip();
  return actx;
}
// 키·포인터·터치 어느 쪽이든 소리를 켭니다(큰 화면에서 클릭 없이 경기가 시작돼도 곧 소리가 나게).
for (const ev of ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'click']) window.addEventListener(ev, audio, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (ambient && actx) ambient.gain.setTargetAtTime(document.hidden ? 0.0001 : 0.05, actx.currentTime, 0.2);
});

// 소리가 아직 막혀 있으면 대기실에 작게 알려 줍니다(켜지면 사라짐).
let chipEl = null;
function updateChip() {
  const lobby = document.getElementById('lobby');
  const show = actx && actx.state !== 'running' && lobby && !lobby.classList.contains('hidden');
  if (show && !chipEl && document.body) {
    chipEl = document.createElement('div');
    chipEl.id = 'sfxChip';
    chipEl.textContent = '화면을 한 번 눌러 소리 켜기';
    chipEl.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:40;padding:7px 16px;border-radius:999px;'
      + 'background:rgba(10,16,30,.72);border:1px solid rgba(140,200,255,.35);color:#cfe6ff;font:600 13px/1.2 system-ui,sans-serif;'
      + 'letter-spacing:.02em;opacity:.85;cursor:pointer;pointer-events:auto';
    document.body.appendChild(chipEl);
  } else if (!show && chipEl) {
    chipEl.remove();
    chipEl = null;
  }
}
setInterval(updateChip, 500);
try { init(); } catch (e) {}

const ready = () => actx && actx.state === 'running';
// 녹음 재생: 멈춘 컨텍스트에서는 틀지 않습니다(재개 뒤 한꺼번에 터지는 것 방지). 틀었으면 true.
function S(name, opts) {
  if (!samples || !ready()) return false;
  const ok = samples.play(name, opts);
  if (ok) dbg.played[name] = (dbg.played[name] || 0) + 1;
  else dbg.fallback[name] = (dbg.fallback[name] || 0) + 1;
  return ok;
}

function noiseBuf(sec) {
  const len = Math.max(1, Math.floor(actx.sampleRate * sec));
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
function noise(sec, freq, q, gain, attack = 0, type = 'bandpass', sweepTo = 0) {
  if (!ready()) return;
  const a = actx;
  const src = a.createBufferSource();
  src.buffer = noiseBuf(sec);
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, a.currentTime);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, a.currentTime + sec);
  f.Q.value = q;
  const g = a.createGain();
  const t = a.currentTime;
  g.gain.setValueAtTime(attack ? 0.0001 : gain, t);
  if (attack) g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  src.connect(f).connect(g).connect(master);
  src.start();
}
function tone(freq, sec, gain, type = 'sine', glide = 0, delay = 0) {
  if (!ready()) return;
  const a = actx;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), t + sec);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + sec + 0.03);
}

function startAmbient() {
  const a = actx;
  ambient = a.createGain();
  ambient.gain.value = 0.0001;
  ambient.gain.exponentialRampToValueAtTime(0.05, a.currentTime + 2);
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 220;
  for (const [f, type, g] of [[55, 'sawtooth', 0.35], [82.6, 'sawtooth', 0.2], [110.4, 'sine', 0.3]]) {
    const o = a.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const og = a.createGain();
    og.gain.value = g;
    o.connect(og).connect(lp);
    o.start();
  }
  // 환기 소음
  const src = a.createBufferSource();
  src.buffer = noiseBuf(3);
  src.loop = true;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 500;
  bp.Q.value = 0.4;
  const ng = a.createGain();
  ng.gain.value = 0.25;
  src.connect(bp).connect(ng).connect(lp);
  src.start();
  lp.connect(ambient).connect(master);
}

export const sfx = {
  fire(vol = 1) {
    if (S('scifi/laser-shot', { gain: 0.5 * vol, rate: 1.05, jitter: 0.08 })) return;
    tone(1500, 0.17, 0.12 * vol, 'sawtooth', 0.22);
    tone(2200, 0.1, 0.05 * vol, 'square', 0.3);
    noise(0.08, 3000, 1, 0.12 * vol);
  },
  charge(vol = 1) {
    tone(320, 0.32, 0.03 * vol, 'sine', 2.8);
  },
  deflect(strong) {
    if (S('scifi/deflect', { gain: strong ? 0.95 : 0.7, rate: strong ? 0.95 : 1.1 })) return;
    // 금속성 '츠앙' + 지직
    noise(0.09, 4200, 0.8, 0.5, 0, 'highpass');
    for (const [f, g] of [[1870, 0.07], [2630, 0.05], [3410, 0.04], [990, 0.06]]) tone(f, 0.25 + Math.random() * 0.1, g * (strong ? 1.3 : 1), 'sawtooth', 0.92);
    noise(0.22, 1600, 2.5, 0.2, 0.005, 'bandpass', 600);
    tone(140, 0.12, 0.16, 'sine', 0.5);
  },
  kill() {
    if (S('kart/explosion', { gain: 0.9, rate: 1.1 })) return;
    noise(1.1, 900, 0.5, 0.65, 0.004, 'lowpass', 120);
    tone(140, 0.7, 0.32, 'sine', 0.25);
    tone(70, 0.9, 0.22, 'triangle', 0.5);
    for (let i = 0; i < 9; i++) setTimeout(() => noise(0.04, 2000 + Math.random() * 3000, 1, 0.18), 60 + Math.random() * 600);
  },
  hurt() {
    if (S('scifi/sizzle', { gain: 0.85, rate: 0.9 })) {
      tone(92, 0.22, 0.12, 'square', 0.7); // 낮은 쿵만 합성으로 살짝 보탭니다
      return;
    }
    tone(92, 0.32, 0.22, 'square', 0.7);
    tone(61, 0.3, 0.2, 'sawtooth', 0.8);
    noise(0.25, 2400, 0.7, 0.35, 0, 'bandpass', 500);
  },
  down() {
    if (S('scifi/power-down', { gain: 0.9, rate: 0.85 })) return;
    tone(220, 1.2, 0.18, 'sawtooth', 0.2);
    noise(0.8, 700, 0.6, 0.3, 0.01, 'lowpass', 90);
  },
  ignite() {
    if (S('scifi/ignite', { gain: 0.9 })) return;
    // '츠아앙' 하고 켜지는 소리
    noise(0.55, 300, 1.4, 0.35, 0.02, 'bandpass', 2400);
    tone(70, 0.7, 0.18, 'sawtooth', 1.6);
    tone(140, 0.6, 0.08, 'sawtooth', 1.55);
  },
  retract() {
    // 칼 끄는 소리 전용 녹음은 없어 전원 꺼짐을 빠르게 틀어 씁니다
    if (S('scifi/power-down', { gain: 0.6, rate: 1.7, jitter: 0.05 })) return;
    noise(0.4, 2000, 1.2, 0.25, 0.01, 'bandpass', 250);
    tone(120, 0.45, 0.12, 'sawtooth', 0.45);
  },
  slow() {
    if (S('swing/swoosh-heavy', { gain: 0.55, rate: 0.7 })) return;
    noise(0.5, 520, 0.5, 0.22, 0.2, 'lowpass');
    tone(330, 0.42, 0.05, 'sine', 0.5);
  },
  wave() {
    for (let i = 0; i < 3; i++) {
      tone(740, 0.16, 0.08, 'square', 1, i * 0.32);
      tone(554, 0.16, 0.08, 'square', 1, i * 0.32 + 0.16);
    }
  },
  tick() {
    if (S('ui/countdown-tick', { gain: 0.9, jitter: 0.02 })) return;
    tone(1320, 0.09, 0.12, 'triangle');
  },
  go() {
    if (S('ui/beep-high', { gain: 0.8, jitter: 0.01 })) return;
    tone(1760, 0.3, 0.14, 'triangle');
    tone(880, 0.3, 0.1, 'triangle');
  },
  whoosh(vol = 1) {
    noise(0.35, 600, 0.6, 0.18 * vol, 0.12, 'bandpass', 1800);
  },
  wall() {
    noise(0.06, 2600, 1.2, 0.12);
  },
  // 우주 함대 같은 신스 브라스 화음
  win() {
    if (S('ui/fanfare-win', { gain: 0.8, jitter: 0.01 })) return;
    if (!ready()) return;
    for (const s of [0, 7, 12]) brass(actx, master, 110 * Math.pow(2, s / 12), 0.5, { gain: 0.05 });
    for (const s of [3, 10, 15]) brass(actx, master, 110 * Math.pow(2, s / 12), 1.6, { gain: 0.05, when: 0.55 });
  },
  clap(n) {
    if (S('crowd/applause-long', { gain: 0.55, jitter: 0.02 })) return;
    for (let i = 0; i < n; i++) setTimeout(() => noise(0.04, 1400 + Math.random() * 900, 1, 0.13), Math.random() * 1500);
  },
  join() {
    if (S('ui/ding', { gain: 0.5, rate: 1.1 })) return;
    if (!ready()) return;
    brass(actx, master, 220, 0.25, { gain: 0.05 });
    brass(actx, master, 330, 0.35, { gain: 0.04, when: 0.12 });
  },

  // ---------- 로봇 검투 ----------
  // 로봇이 칼을 들어 올리며 힘을 모으는 소리(서보 윙 + 충전). 찌르기는 더 낮고 짧게.
  windup(kind, sec = 1) {
    // 예고 시간(sec)에 맞춰 충전음이 정점에서 끝나게 속도를 맞춥니다(녹음 길이 약 2.34초, 정점에서 끝남)
    const rate = Math.max(0.85, Math.min(2.4, 2.34 / sec)) * (kind === 'thrust' ? 0.9 : 1);
    if (S('scifi/servo-charge', { gain: 0.5, rate, jitter: 0, offset: Math.max(0, 2.34 - sec * rate) })) return;
    const low = kind === 'thrust';
    tone(low ? 150 : 210, 0.5, 0.05, 'sawtooth', low ? 2.2 : 2.6);
    tone(low ? 300 : 420, 0.42, 0.025, 'square', 1.9);
    noise(0.45, 400, 0.9, 0.08, 0.2, 'bandpass', 1800);
  },
  // 로봇 칼이 휙 지나가는 소리
  robotSwing(kind) {
    if (S('scifi/robot-swing', { gain: 0.9, rate: kind === 'thrust' ? 1.15 : 1 })) return;
    noise(0.32, 260, 0.8, 0.42, 0.04, 'bandpass', 2400);
    tone(95, 0.3, 0.14, 'sawtooth', 1.7);
  },
  // 칼과 칼이 부딪힘: 높은 금속 배음 + 지직거림 + 낮은 쿵
  clash(heavy = true) {
    if (S('scifi/clash', { gain: heavy ? 1 : 0.65, rate: heavy ? 1 : 1.12 })) return;
    noise(0.12, 5200, 0.7, 0.6, 0, 'highpass');
    for (const [f, g] of [[1960, 0.08], [2770, 0.06], [3520, 0.05], [1180, 0.07], [620, 0.06]]) tone(f * (0.97 + Math.random() * 0.06), 0.42 + Math.random() * 0.2, g, 'sawtooth', 0.88);
    noise(0.5, 2200, 2.2, 0.26, 0.004, 'bandpass', 500);
    tone(82, 0.32, 0.3, 'sine', 0.45);
    for (let i = 0; i < 7; i++) setTimeout(() => noise(0.035, 2400 + Math.random() * 3200, 1.5, 0.16), 30 + Math.random() * 320);
  },
  // 로봇 장갑을 베었을 때: 지글거림 + 쇠 울림. 연타일수록 높게
  slash(n = 1) {
    const k = Math.min(3, n);
    // 콤보가 이어질수록 높게(1.0 / 1.12 / 1.25). 낮은 쿵만 합성으로 살짝 보탭니다
    if (S('scifi/sizzle', { gain: 0.8, rate: 1 + 0.125 * (k - 1), jitter: 0.02 })) {
      tone(150, 0.16, 0.14, 'sine', 0.5);
      return;
    }
    noise(0.28, 3200, 0.8, 0.42, 0.003, 'bandpass', 900);
    tone(520 + k * 120, 0.32, 0.08, 'triangle', 0.6);
    tone(140, 0.2, 0.24, 'sine', 0.5);
    noise(0.6, 1200, 0.5, 0.12, 0.05, 'lowpass', 300);
  },
  robotIgnite() {
    if (S('scifi/ignite', { gain: 0.9, rate: 0.7 })) return;
    noise(0.6, 220, 1.4, 0.32, 0.02, 'bandpass', 1900);
    tone(52, 0.8, 0.2, 'sawtooth', 1.7);
    tone(104, 0.7, 0.08, 'sawtooth', 1.6);
  },
  // 로봇이 쓰러짐: 전원이 꺼지며 내려가는 소리 + 폭발
  robotDown() {
    if (S('scifi/power-down', { gain: 0.9, rate: 1 })) {
      S('kart/explosion', { gain: 0.8, rate: 0.85, when: 0.5 });
      return;
    }
    tone(420, 1.4, 0.14, 'sawtooth', 0.08);
    tone(210, 1.2, 0.1, 'square', 0.12);
    noise(1.2, 900, 0.5, 0.6, 0.004, 'lowpass', 90);
    for (let i = 0; i < 10; i++) setTimeout(() => noise(0.05, 1800 + Math.random() * 3000, 1, 0.2), 120 + Math.random() * 900);
  },
  lose() {
    if (S('ui/sting-lose', { gain: 0.8, jitter: 0.01 })) return;
    if (!ready()) return;
    for (const [s, w] of [[0, 0], [-2, 0.4], [-5, 0.8]]) brass(actx, master, 146.8 * Math.pow(2, s / 12), 0.55, { gain: 0.05, when: w });
  },
  // 검투 시작: 낮은 징 같은 울림
  duelStart() {
    if (S('perc/big-drum', { gain: 0.8, rate: 0.8, jitter: 0.02 })) return;
    tone(65, 1.6, 0.2, 'sine', 0.98);
    tone(131, 1.3, 0.08, 'triangle', 0.99);
    noise(0.9, 300, 0.6, 0.12, 0.01, 'lowpass', 120);
  }
};
