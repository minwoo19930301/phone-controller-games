// 탁구 소리: 실제 녹음(/common/sfx/)을 먼저 틀고, 아직 못 받았거나 맞는 녹음이 없는 소리만 WebAudio 합성음으로 냅니다.
// 합성음으로 남는 것: 네트에 맞는 소리(맞는 녹음 없음). 샘플이 안 받아졌을 때의 대체음도 아래 합성 코드입니다.
import { modal, grit, organ, marimba, bell, chip, pluck, brass, phrase } from '/common/voice.js';
import { createSamples } from '/common/samples.js';
let actx = null;
let master = null;
let samples = null;
let amb = null; // 관중 바탕 소리 핸들
let ambWant = false;
// 큰 화면은 클릭을 한 번도 못 받을 때가 많아(폰에서 시작) 컨텍스트가 멈춘 채로 남을 수 있습니다.
// 만들어 두고 아무 키·포인터·터치에서나 계속 깨웁니다.
export function audio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      actx = new AC();
      // 마스터: 너무 커지지 않게 살짝 줄이고 컴프레서로 겹치는 소리를 눌러 줍니다.
      master = actx.createGain();
      master.gain.value = MASTER_GAIN;
      const comp = actx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      master.connect(comp).connect((master || actx.destination));
      samples = createSamples(actx, master);
      actx.addEventListener('statechange', syncChip);
    }
  }
  if (actx && actx.state === 'suspended') actx.resume().then(syncChip, () => {});
  syncChip();
  return actx;
}
const MASTER_GAIN = 0.85; // 전체 소리 크기
['pointerdown', 'pointerup', 'keydown', 'touchstart', 'click', 'mousemove'].forEach((ev) => window.addEventListener(ev, audio, { passive: true }));

// 소리가 아직 안 켜졌을 때만 대기실에 작은 안내를 보여 줍니다(#sndChip).
function syncChip() {
  const el = document.getElementById('sndChip');
  if (el) el.classList.toggle('hidden', !actx || actx.state === 'running');
  if (actx && actx.state === 'running') ambStart(); // 경기 중에 뒤늦게 소리가 켜져도 바탕 소리를 이어 붙입니다
}

// 대기실에서 미리 받아 둘 녹음 묶음(이 종목에서 쓰는 것만)
export const PRELOAD = ['ball/pingpong', 'swing/swoosh-light', 'ui/whoosh-ui', 'ui/success', 'ui/pop', 'ui/fanfare-win', 'ui/sting-lose', 'perc/whistle-short', 'crowd/cheer-small', 'crowd/aww', 'crowd/applause', 'crowd/murmur-loop'];
export function preload() { audio(); return samples ? samples.preload(PRELOAD) : Promise.resolve(); }

// 디버그: 어떤 녹음이 몇 번 울렸는지(window.__pingpongSfx.played)
const dbg = (window.__pingpongSfx = { played: {}, fallback: {} });
// 녹음을 틉니다. 컨텍스트가 돌고 있고 녹음을 받았을 때만 true(아니면 합성음으로 대체).
function sample(name, opts) {
  if (!ready() || !samples) return false;
  if (!samples.play(name, opts)) return false;
  dbg.played[name] = (dbg.played[name] || 0) + 1;
  return true;
}
const fb = (what) => { dbg.fallback[what] = (dbg.fallback[what] || 0) + 1; };

// 깔리는 소리(관중 웅성임): 경기 중에만, 랠리가 길어지면 아주 조금 커집니다.
const AMB_BASE = 0.1; // 관중 바탕 기본 세기
function ambStart() {
  if (amb || !ambWant || !ready() || !samples || document.hidden) return;
  amb = samples.loop('crowd/murmur-loop', { gain: 0 });
  if (amb) { amb.set({ gain: AMB_BASE, glide: 0.6 }); dbg.played['crowd/murmur-loop'] = (dbg.played['crowd/murmur-loop'] || 0) + 1; }
}
function ambStop() { if (amb) { amb.stop(0.4); amb = null; } }
document.addEventListener('visibilitychange', () => { if (document.hidden) ambStop(); else ambStart(); });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { audio(); });
else audio();

const ready = () => actx && actx.state === 'running';

function noise(sec, freq, q, gain, attack, type = 'bandpass', rate = 1) {
  if (!ready()) return;
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
  src.connect(f).connect(g).connect((master || a.destination));
  src.start();
}
function tone(freq, sec, gain, type = 'sine', glide = 0) {
  if (!ready()) return;
  const a = actx;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime);
  if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * glide), a.currentTime + sec);
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + sec);
  o.connect(g).connect((master || a.destination));
  o.start();
  o.stop(a.currentTime + sec + 0.02);
}

export const sfx = {
  preload,
  // 경기 중 관중 바탕 소리 켜기/끄기, 랠리 길이에 맞춰 세기 조절
  ambience(on) { ambWant = on; if (on) { audio(); ambStart(); } else ambStop(); },
  rally(n) { ambStart(); if (amb) amb.set({ gain: AMB_BASE + Math.min(10, n) * 0.012, glide: 0.5 }); },
  // 라켓에 맞는 소리. 슬로우 중이면 낮고 길게 늘어집니다.
  hit(q, slow, smash) {
    if (!ready()) return;
    const r = slow ? 0.55 : 1;
    // 실제 녹음: 세게 칠수록 크고 높게, 스매시는 낮고 묵직하게(1.15배 세기), 슬로우 중에는 낮게 늘어집니다.
    if (sample('ball/pingpong-paddle', { gain: (0.55 + 0.45 * q) * (smash ? 1.2 : 1), rate: (smash ? 0.86 : 0.96 + 0.08 * q) * (slow ? 0.7 : 1) })) return;
    fb('hit');
    // 속이 빈 셀룰로이드 공: 높고 짧은 '틱' + 라켓 나무판 '톡'
    modal(actx, (master || actx.destination), [[3900, 1, 0.025], [6100, 0.5, 0.018], [1450, 0.6, 0.05]], { gain: 0.35 + q * 0.25, pitch: r });
    grit(actx, (master || actx.destination), { sec: 0.012, freq: 7000, q: 0.7, gain: 0.25 });
    if (smash) modal(actx, (master || actx.destination), [[520, 1, 0.09]], { gain: 0.4, drop: 0.3 });
  },
  bounce(vol = 1) {
    if (sample('ball/pingpong-table', { gain: 0.8 * vol })) return;
    fb('bounce');
    noise(0.035, 1700, 1.2, 0.5 * vol, 0);
    tone(980, 0.05, 0.16 * vol, 'triangle');
  },
  net() {
    noise(0.12, 380, 0.9, 0.5, 0);
    tone(210, 0.1, 0.18);
  },
  floor() {
    // 같은 탁구공이 단단한 바닥에 튀는 소리: 테이블 녹음을 낮고 작게
    if (sample('ball/pingpong-table', { gain: 0.45, rate: 0.72 })) return;
    fb('floor');
    noise(0.05, 1100, 1, 0.3, 0);
    tone(620, 0.06, 0.08, 'triangle');
  },
  // 슬로우 진입: 낮게 떨어지는 바람 소리
  slow() {
    if (sample('ui/whoosh-ui', { gain: 0.4, rate: 0.7 })) return;
    fb('slow');
    noise(0.55, 520, 0.5, 0.32, 0.25, 'lowpass');
    tone(330, 0.45, 0.08, 'sine', 0.5);
  },
  whiff() {
    if (sample('swing/swoosh-light', { gain: 0.7, rate: 0.9 })) return;
    fb('whiff');
    noise(0.28, 800, 0.6, 0.3, 0.45);
  },
  // 득점·실점: 마림바 5음계 한 줄
  point(good) {
    if (!ready()) return;
    // 실제 녹음: 득점은 맑은 종소리+작은 환호, 실점은 낮은 탄식
    if (good) {
      if (sample('ui/success', { gain: 0.7 })) { sample('crowd/cheer-small', { gain: 0.4, when: 0.08 }); return true; }
    } else if (sample('crowd/aww', { gain: 0.5 })) return true;
    fb('point');
    const m = (f, d, w) => marimba(actx, (master || actx.destination), f, { when: w });
    if (good) phrase(587, [[0, 0.5], [4, 0.5], [7, 1]], 220, m);
    else phrase(440, [[3, 0.5], [0, 1]], 200, m);
  },
  // 박수. kind: 'short' 득점 직후·경기 끝 / 'long' 결과 화면. 녹음이 없으면 예전 합성 박수(n 번).
  clap(n, kind) {
    if (kind && sample(kind === 'long' ? 'crowd/applause-long' : 'crowd/applause-short', { gain: kind === 'long' ? 0.7 : 0.6 })) return;
    fb('clap');
    for (let i = 0; i < n; i++) setTimeout(() => noise(0.04, 1400 + Math.random() * 900, 1, 0.16, 0), Math.random() * 1500);
  },
  // 승리 팡파르(진 쪽이 아닐 때) / 경기 시작 호루라기
  win() {
    if (!ready()) return;
    if (sample('ui/fanfare-win', { gain: 0.7 })) return;
    fb('win');
    phrase(587, [[0, 0.5], [2, 0.5], [4, 0.5], [7, 0.5], [9, 0.5], [12, 0.5], [9, 0.5], [12, 1.5]], 260, (f, d, w) => marimba(actx, (master || actx.destination), f, { when: w }));
  },
  start() {
    if (!ready()) return;
    if (sample('perc/whistle-short', { gain: 0.6, rate: 1 })) return;
    this.win();
  },
  lose() {
    if (!ready()) return false;
    return sample('ui/sting-lose', { gain: 0.6 });
  },
  join() {
    if (!ready()) return;
    if (sample('ui/pop', { gain: 0.5 })) return;
    fb('join');
    marimba(actx, (master || actx.destination), 1175);
    marimba(actx, (master || actx.destination), 1568, { when: 0.09 });
  }
};

// 디버그: 받아진 녹음 확인(window.__pingpongSfx.has(name)) 과 소리 직접 틀어 보기(window.__pingpongSfx.sfx)
dbg.has = (name) => Boolean(samples && samples.has(name));
dbg.sfx = sfx;
dbg.suspend = () => actx && actx.suspend(); // 시험용: 멈춘 상태 흉내
