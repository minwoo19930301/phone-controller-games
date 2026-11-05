// 테니스 소리: 라켓 타구음(퐁), 바운드, 네트, 벽, 슬로우 진입, 관중 박수·함성, 심판 콜 효과음. 모두 WebAudio 로 만듭니다.
let actx = null;
let crowdBus = null;
export function audio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) actx = new AC();
  }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
window.addEventListener('pointerdown', audio);
window.addEventListener('keydown', audio);

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
  src.connect(f).connect(g).connect(a.destination);
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
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + sec + 0.02);
}

// 관중 웅성임: 아주 작게 계속 흐르는 분홍 잡음. 득점 때 잠깐 커집니다.
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
  src.connect(f).connect(g).connect(a.destination);
  src.start();
  crowdBus = g;
}
export function crowd(level, sec = 0.8) {
  ensureCrowd();
  if (!crowdBus || !ready()) return;
  const t = actx.currentTime;
  crowdBus.gain.cancelScheduledValues(t);
  crowdBus.gain.setValueAtTime(crowdBus.gain.value, t);
  crowdBus.gain.linearRampToValueAtTime(muted ? 0 : level, t + sec);
}

export const sfx = {
  // 라켓에 맞는 소리: 낮은 '퐁' + 줄 울림. 세게 칠수록 단단하고, 슬로우 중이면 늘어집니다.
  hit(q, slow, power = 0.6) {
    const r = slow ? 0.6 : 1;
    noise(0.07 / r, 1500 * r, 0.8, 0.45 + q * 0.35 + power * 0.2, 0, 'bandpass', r);
    tone((420 + q * 120) * r, 0.09 / r, 0.32, 'triangle', 0.7);
    tone((1650 + power * 300) * r, 0.05, 0.08, 'sine');
  },
  serve(q, slow, power) {
    this.hit(q, slow, power);
    noise(0.12, 700, 0.6, 0.25, 0);
  },
  bounce(vol = 1) {
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
    noise(0.6, 480, 0.5, 0.3, 0.25, 'lowpass');
    tone(300, 0.5, 0.07, 'sine', 0.5);
  },
  whiff() {
    noise(0.3, 700, 0.6, 0.3, 0.45);
  },
  // 전자 판정음(아웃·폴트)
  call(kind) {
    if (kind === 'out' || kind === 'fault') {
      tone(880, 0.12, 0.12, 'square');
      tone(660, 0.18, 0.1, 'square', 1, 0.13);
    } else if (kind === 'let') {
      tone(1200, 0.08, 0.1, 'sine');
      tone(1200, 0.08, 0.1, 'sine', 1, 0.12);
    }
  },
  point(good) {
    if (good) {
      tone(784, 0.14, 0.12, 'triangle');
      tone(1175, 0.22, 0.12, 'triangle', 1, 0.11);
    } else {
      tone(392, 0.2, 0.1, 'triangle');
      tone(330, 0.26, 0.1, 'triangle', 1, 0.12);
    }
  },
  clap(n, spread = 1600) {
    for (let i = 0; i < n; i++) noise(0.04, 1300 + Math.random() * 900, 1, 0.13, 0, 'bandpass', 1, (Math.random() * spread) / 1000);
  },
  cheer(big) {
    crowd(big ? 0.22 : 0.12, 0.25);
    setTimeout(() => crowd(0.035, 1.6), big ? 1800 : 1100);
    this.clap(big ? 50 : 22, big ? 2200 : 1500);
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.32, 0.12, 'triangle', 1, i * 0.13));
  },
  join() {
    tone(880, 0.12, 0.12);
  },
  change() {
    tone(660, 0.14, 0.1, 'triangle');
    tone(880, 0.18, 0.1, 'triangle', 1, 0.14);
  }
};
