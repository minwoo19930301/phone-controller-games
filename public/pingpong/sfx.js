// 탁구 소리: 라켓 타구음, 테이블 바운드, 네트, 바닥, 슬로우 진입, 득점, 박수. 모두 WebAudio 로 만듭니다.
let actx = null;
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
  src.connect(f).connect(g).connect(a.destination);
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
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + sec + 0.02);
}

export const sfx = {
  // 라켓에 맞는 소리. 슬로우 중이면 낮고 길게 늘어집니다.
  hit(q, slow, smash) {
    const r = slow ? 0.55 : 1;
    noise(0.05 / r, 2600 * r, 0.9, 0.55 + q * 0.4, 0, 'bandpass', r);
    tone((1250 + q * 450) * r, 0.07 / r, 0.22);
    if (smash) noise(0.12, 900, 0.6, 0.5, 0);
  },
  bounce(vol = 1) {
    noise(0.035, 1700, 1.2, 0.5 * vol, 0);
    tone(980, 0.05, 0.16 * vol, 'triangle');
  },
  net() {
    noise(0.12, 380, 0.9, 0.5, 0);
    tone(210, 0.1, 0.18);
  },
  floor() {
    noise(0.05, 1100, 1, 0.3, 0);
    tone(620, 0.06, 0.08, 'triangle');
  },
  // 슬로우 진입: 낮게 떨어지는 바람 소리
  slow() {
    noise(0.55, 520, 0.5, 0.32, 0.25, 'lowpass');
    tone(330, 0.45, 0.08, 'sine', 0.5);
  },
  whiff() {
    noise(0.28, 800, 0.6, 0.3, 0.45);
  },
  point(good) {
    if (good) {
      tone(784, 0.14, 0.12, 'triangle');
      setTimeout(() => tone(1175, 0.2, 0.12, 'triangle'), 110);
    } else {
      tone(392, 0.2, 0.1, 'triangle');
      setTimeout(() => tone(330, 0.26, 0.1, 'triangle'), 120);
    }
  },
  clap(n) {
    for (let i = 0; i < n; i++) setTimeout(() => noise(0.04, 1400 + Math.random() * 900, 1, 0.16, 0), Math.random() * 1500);
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.3, 0.12, 'triangle'), i * 130));
  },
  join() {
    tone(880, 0.12, 0.12);
  }
};
