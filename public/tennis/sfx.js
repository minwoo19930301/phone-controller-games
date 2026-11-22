// 테니스 소리: 라켓 타구음, 바운드, 네트, 벽, 슬로우 진입, 관중 박수·함성, 심판 콜 효과음.
// 실제 녹음(/common/sfx)을 먼저 틀고, 아직 못 받았거나 맞는 녹음이 없는 소리만 WebAudio 합성음으로 냅니다.
import { modal, grit, organ, marimba, bell, chip, pluck, brass, phrase } from '/common/voice.js';
import { createSamples } from '/common/samples.js';
let actx = null;
let crowdBus = null;
let master = null;
let samples = null;
// 시험용 카운터: 어떤 녹음이 몇 번 울렸는지(합성음으로 대신한 횟수는 fallback)
window.__tennisSfx = { played: {}, fallback: {}, has: (n) => Boolean(samples && samples.has(n)), bed: () => Boolean(bedLoop), ctx: () => actx && actx.state };
const HIT_GAIN = 0.95; // 타구음: 가장 크게
const BOUNCE_GAIN = 0.55; // 바운드: 타구음보다 작게
const MASTER_GAIN = 0.9; // 전체 세기(타구음이 가장 크고 관중·바탕은 작게 두기 위한 여유)
export function audio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      actx = new AC();
      master = actx.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(actx.destination);
      samples = createSamples(actx, master);
      actx.addEventListener('statechange', updateChip);
      // 대기실에서 이 종목 소리를 미리 받아 둡니다(디코딩은 멈춘 상태에서도 됨).
      samples.preload(['ball/tennis-', 'ui/', 'swing/swoosh-', 'crowd/', 'perc/whistle-short']);
    }
  }
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
  updateChip();
  return actx;
}
// 큰 화면은 클릭 없이 폰으로 시작하는 일이 많아서, 어떤 입력이든 오디오를 깨웁니다.
for (const ev of ['pointerdown', 'mousedown', 'touchstart', 'click', 'keydown', 'wheel']) window.addEventListener(ev, audio, { capture: true, passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) bedPause();
  else { audio(); bedResume(); }
});

// 소리가 아직 꺼져 있을 때만 대기실에 뜨는 작은 안내
let chipEl = null;
function updateChip() {
  const suspended = !actx || actx.state !== 'running';
  const lobby = document.getElementById('lobby');
  const show = suspended && lobby && !lobby.classList.contains('hidden');
  if (show && !chipEl) {
    chipEl = document.createElement('div');
    chipEl.id = 'soundChip';
    chipEl.textContent = '화면을 한 번 눌러 소리 켜기';
    chipEl.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:60;padding:7px 14px;border-radius:999px;background:rgba(10,26,46,.72);color:#dfe9f5;font:600 13px/1.2 Pretendard,system-ui,sans-serif;border:1px solid rgba(255,255,255,.22);pointer-events:none;opacity:.85;white-space:nowrap';
    document.body.appendChild(chipEl);
  }
  if (chipEl) chipEl.style.display = show ? '' : 'none';
}
setInterval(updateChip, 700);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => audio());
else audio();

// 녹음 한 번 재생. 못 틀었으면 false(→ 호출한 쪽이 합성음으로 대신), 틀었으면 세어 둡니다.
function play(name, opts) {
  if (muted || !actx || actx.state !== 'running' || !samples) return false;
  const ok = samples.play(name, opts);
  const bucket = window.__tennisSfx[ok ? 'played' : 'fallback'];
  bucket[name] = (bucket[name] || 0) + 1;
  return ok;
}

const ready = () => actx && actx.state === 'running';
let muted = false;
export function setMuted(v) {
  muted = Boolean(v);
}

function noise(sec, freq, q, gain, attack, type = 'bandpass', rate = 1, when = 0) {
  if (!ready() || muted) return;
  const a = actx;
  const len = Math.max(1, Math.floor(a.sampleRate * sec));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const env = attack ? Math.min(1, t / attack) * Math.pow(1 - t, 1.6) : Math.pow(1 - t, 9);
    d[i] = (Math.random() * 2 - 1) * env;
  }
  const src = a.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(master);
  src.start(a.currentTime + when);
}
function tone(freq, sec, gain, type = 'sine', glide = 0, when = 0) {
  if (!ready() || muted) return;
  const a = actx;
  const t0 = a.currentTime + when;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * glide), t0 + sec);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + sec);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + sec + 0.02);
}

// 관중 바탕 소리: 실제 경기장 웅성임 녹음을 이어 돌립니다. 득점 때 잠깐 커졌다가 가라앉고, 경기가 끝나거나 탭이 가려지면 멈춥니다.
const BED_K = 6; // crowd(level) 값 → 녹음 세기. 기본 0.035 → 0.21(기본 세기 0.5 가 곱해져 아주 작게), 함성 0.22 → 상한 0.45
const BED_MAX = 0.45;
let bedOn = false; // 경기 중인가(경기 밖에서는 crowd() 가 아무것도 켜지 않음)
let bedLevel = 0.035;
let bedLoop = null;
export function bed(on) {
  bedOn = Boolean(on);
  if (!bedOn) bedStop();
}
function bedStart() {
  if (!bedOn || bedLoop || !samples || !ready() || document.hidden) return;
  bedLoop = samples.loop('crowd/murmur-loop', { gain: 0 });
  if (bedLoop) bedLoop.set({ gain: Math.min(BED_MAX, bedLevel * BED_K), glide: 0.6 });
}
function bedStop() {
  if (bedLoop) { bedLoop.stop(0.4); bedLoop = null; }
  if (crowdBus && actx) { crowdBus.gain.cancelScheduledValues(actx.currentTime); crowdBus.gain.setTargetAtTime(0, actx.currentTime, 0.1); }
}
function bedPause() {
  if (bedLoop) { bedLoop.stop(0.1); bedLoop = null; }
  if (crowdBus && actx) crowdBus.gain.setTargetAtTime(0, actx.currentTime, 0.05);
}
function bedResume() {
  if (bedOn) crowd(bedLevel, 0.5);
}
// 녹음 바탕이 없을 때만 쓰는 합성 대체(분홍 잡음)
function ensureCrowd() {
  if (!ready() || crowdBus) return;
  const a = actx;
  const len = a.sampleRate * 3;
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.997 * b0 + w * 0.029;
    b1 = 0.985 * b1 + w * 0.032;
    b2 = 0.95 * b2 + w * 0.048;
    d[i] = (b0 + b1 + b2) * 0.6;
  }
  const src = a.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 700;
  f.Q.value = 0.5;
  const g = a.createGain();
  g.gain.value = 0;
  src.connect(f).connect(g).connect(master);
  src.start();
  crowdBus = g;
}
export function crowd(level, sec = 0.8) {
  if (!bedOn || !ready() || document.hidden) return;
  bedLevel = level;
  bedStart();
  if (bedLoop) {
    bedLoop.set({ gain: muted ? 0 : Math.min(BED_MAX, level * BED_K), glide: Math.max(0.05, sec / 3) });
    if (crowdBus) crowdBus.gain.setTargetAtTime(0, actx.currentTime, 0.1);
    return;
  }
  ensureCrowd();
  if (!crowdBus) return;
  const t = actx.currentTime;
  crowdBus.gain.cancelScheduledValues(t);
  crowdBus.gain.setValueAtTime(crowdBus.gain.value, t);
  crowdBus.gain.linearRampToValueAtTime(muted ? 0 : level, t + sec);
}

export const sfx = {
  // 라켓에 맞는 소리: 낮은 '퐁' + 줄 울림. 세게 칠수록 단단하고, 슬로우 중이면 늘어집니다.
  hit(q, slow, power = 0.6) {
    if (!ready() || muted) return;
    // 녹음: 세게 칠수록 크고 높게, 슬로우 중이면 늘어진 소리(속도 0.75)
    if (play('ball/tennis-hit', { gain: HIT_GAIN * (0.6 + 0.4 * power) * (0.9 + 0.1 * q), rate: (slow ? 0.75 : 1) * (0.94 + 0.12 * power) })) return;
    const r = slow ? 0.6 : 1;
    // 펠트 공이 줄에 박히는 낮은 '퍽' + 줄이 잠깐 '팅' 울림
    modal(actx, master, [[340, 1, 0.07], [610, 0.5, 0.05]], { gain: 0.45 + power * 0.25, pitch: r, drop: 0.25 });
    modal(actx, master, [[1180, 0.5, 0.16], [1770, 0.25, 0.12]], { gain: 0.08 + q * 0.06, pitch: r });
    grit(actx, master, { sec: 0.03, freq: 1100, q: 0.6, gain: 0.25 + power * 0.2 });
  },
  serve(q, slow, power = 0.6) {
    if (ready() && !muted && play('ball/tennis-serve', { gain: HIT_GAIN * (0.7 + 0.3 * power), rate: (slow ? 0.75 : 1) * (0.96 + 0.08 * power) })) return;
    this.hit(q, slow, power);
    noise(0.12, 700, 0.6, 0.25, 0);
  },
  bounce(vol = 1) {
    if (play('ball/tennis-bounce', { gain: BOUNCE_GAIN * vol, rate: 0.95 + Math.random() * 0.1 })) return;
    noise(0.05, 900, 1.0, 0.45 * vol, 0);
    tone(260, 0.07, 0.18 * vol, 'triangle', 0.8);
  },
  net() {
    noise(0.16, 320, 0.8, 0.5, 0);
    tone(150, 0.14, 0.2, 'sine', 0.8);
  },
  wall() {
    noise(0.12, 260, 0.7, 0.35, 0);
    tone(110, 0.16, 0.18, 'triangle', 0.7);
  },
  // 슬로우 진입: 낮게 떨어지는 바람 소리
  slow() {
    // 어두운 바람 소리를 느리게(낮게) 틀어 슬로우 진입처럼
    if (play('swing/swoosh-heavy', { gain: 0.35, rate: 0.7 })) return;
    noise(0.6, 480, 0.5, 0.3, 0.25, 'lowpass');
    tone(300, 0.5, 0.07, 'sine', 0.5);
  },
  whiff() {
    if (play('swing/swoosh-light', { gain: 0.6, rate: 0.9 + Math.random() * 0.15 })) return;
    noise(0.3, 700, 0.6, 0.3, 0.45);
  },
  // 전자 판정음(아웃·폴트)
  call(kind) {
    // 전자 판정 삑: 아웃·폴트는 낮은 삑 두 번, 레트는 높은 삑 두 번
    if (kind === 'out' || kind === 'fault') {
      if (play('ui/beep', { gain: 0.7, rate: 1 })) { play('ui/beep', { gain: 0.7, rate: 0.75, when: 0.16 }); return; }
    } else if (kind === 'let') {
      if (play('ui/beep-high', { gain: 0.7, rate: 1 })) { play('ui/beep-high', { gain: 0.7, rate: 1, when: 0.16 }); return; }
    }
    if (kind === 'out' || kind === 'fault') {
      tone(880, 0.12, 0.12, 'square');
      tone(660, 0.18, 0.1, 'square', 1, 0.13);
    } else if (kind === 'let') {
      tone(1200, 0.08, 0.1, 'sine');
      tone(1200, 0.08, 0.1, 'sine', 1, 0.12);
    }
  },
  // 경기장 안내 종 '딩-동'
  point(good) {
    if (!ready() || muted) return;
    if (play('ui/ding', { gain: 0.55, rate: good ? 1 : 0.78 })) return;
    if (good) { bell(actx, master, 880, { gain: 0.09, ratio: 1.4, depth: 1 }); bell(actx, master, 1109, { gain: 0.09, ratio: 1.4, depth: 1, when: 0.22 }); }
    else { bell(actx, master, 740, { gain: 0.08, ratio: 1.4, depth: 1 }); bell(actx, master, 587, { gain: 0.08, ratio: 1.4, depth: 1, when: 0.22 }); }
  },
  clap(n, spread = 1600) {
    // 많이 칠수록 긴 박수 녹음(결과 화면), 적으면 짧은 박수
    if (n >= 30 ? play('crowd/applause-long', { gain: 0.45 }) : play('crowd/applause-short', { gain: 0.5 })) return;
    for (let i = 0; i < n; i++) noise(0.04, 1300 + Math.random() * 900, 1, 0.13, 0, 'bandpass', 1, (Math.random() * spread) / 1000);
  },
  cheer(big) {
    if (ready() && !muted && samples && samples.has(big ? 'crowd/cheer-big' : 'crowd/cheer-small')) {
      play(big ? 'crowd/cheer-big' : 'crowd/cheer-small', { gain: big ? 0.6 : 0.5 });
      if (big) play('crowd/applause-short', { gain: 0.35, when: 0.5 });
      return;
    }
    crowd(big ? 0.22 : 0.12, 0.25);
    setTimeout(() => crowd(0.035, 1.6), big ? 1800 : 1100);
    this.clap(big ? 50 : 22, big ? 2200 : 1500);
  },
  // 시상식 금관 팡파르
  win(gain = 1) {
    if (!ready() || muted) return;
    if (play('ui/fanfare-win', { gain: 0.7 * gain, rate: 1, jitter: 0 })) return;
    phrase(349, [[0, 0.33], [0, 0.33], [0, 0.33], [5, 1], [9, 0.5], [12, 1.5]], 132, (f, d, w) => brass(actx, master, f, d, { gain: 0.06, when: w }));
  },
  join() {
    if (!ready() || muted) return;
    if (play('ui/success', { gain: 0.5 })) return;
    bell(actx, master, 1319, { gain: 0.07, ratio: 1.4, depth: 1, sec: 0.8 });
  },
  change() {
    tone(660, 0.14, 0.1, 'triangle');
    tone(880, 0.18, 0.1, 'triangle', 1, 0.14);
  }
};
