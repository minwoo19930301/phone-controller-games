// 카트 소리: 카운트다운 신호음, 엔진(사람마다 하나), 벽 충돌, 부스트, 랩·완주 효과음. 모두 WebAudio 로 만듭니다.
import { chip, brass, bell, grit, phrase } from '/common/voice.js';

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

export const sfx = {
  /** 엔진 소리 갱신. i: 칸 번호, speed: 0..1, gas: 0..1 */
  engine(i, speed, gas, boost) {
    const e = engineVoice(i);
    if (!e) return;
    const t = actx.currentTime;
    const base = 55 + speed * 150 + (boost ? 25 : 0);
    e.o1.frequency.setTargetAtTime(base, t, 0.05);
    e.o2.frequency.setTargetAtTime(base * 0.5, t, 0.05);
    e.f.frequency.setTargetAtTime(380 + speed * 900 + gas * 300, t, 0.08);
    e.g.gain.setTargetAtTime(0.012 + gas * 0.014 + speed * 0.012, t, 0.08);
  },
  engineOff() {
    if (!ready()) return;
    for (const e of engines) if (e) e.g.gain.setTargetAtTime(0, actx.currentTime, 0.05);
  },
  count(n) {
    tone(n > 0 ? 520 : 1040, n > 0 ? 0.16 : 0.5, 0.18, 'square');
  },
  thump(power) {
    if (!ready()) return;
    const q = Math.min(1, power / 20);
    grit(actx, actx.destination, { sec: 0.16, freq: 220, q: 0.7, type: 'lowpass', gain: 0.35 + q * 0.5 });
    tone(110, 0.14, 0.12 + q * 0.2, 'sine', 0.5);
  },
  boost() {
    if (!ready()) return;
    grit(actx, actx.destination, { sec: 0.35, freq: 600, q: 1.2, gain: 0.25, sweep: 3 });
    tone(380, 0.35, 0.08, 'sawtooth', 2.6);
  },
  // 랩: 종 두 번(올라가는 4도)
  lap() {
    if (!ready()) return;
    bell(actx, actx.destination, 523, { gain: 0.1, sec: 0.9 });
    bell(actx, actx.destination, 698, { gain: 0.1, sec: 1.0, when: 0.12 });
  },
  // 완주: 신스 브라스 모티프(미-시-솔-레-미', 단조풍)
  finish() {
    if (!ready()) return;
    phrase(330, [[0, 0.5], [7, 0.5], [3, 0.5], [10, 0.5], [12, 1.6]], 150, (f, sec, at) => brass(actx, actx.destination, f, sec, { gain: 0.06, when: at }));
  },
  // 입장: 칩튠 두 음(내려갔다 올라감)
  join() {
    if (!ready()) return;
    phrase(440, [[7, 0.25], [0, 0.25], [5, 0.4]], 200, (f, sec, at) => chip(actx, actx.destination, f, sec, { gain: 0.05, when: at }));
  }
};
