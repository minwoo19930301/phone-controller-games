// 홈런 더비 폰 컨트롤러: 타자 스윙 감지, 투타 대결 투구(조준·구질), 대기실(난이도·모드·준비), 처음 하는 사람 연습.
// 공통 모듈: 진동·번쩍임(haptics), 난이도 알약(phone-settings), 연습(tutorial). ready.js 는 이 파일보다 먼저 일반 스크립트로 붙습니다.
import { haptics } from '/common/haptics.js';
import { createPhoneSettings } from '/common/phone-settings.js';
import { createTutorial } from '/common/tutorial.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ROOM = (params.get('room') || '').toUpperCase();
$('room').textContent = ROOM ? `방 ${ROOM}` : '';

let token = null;
try { token = localStorage.getItem('pcg-token'); } catch (e) {}
if (!token) {
  token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try { localStorage.setItem('pcg-token', token); } catch (e) {}
}

const socket = io({ autoConnect: false, transports: ['websocket', 'polling'], tryAllTransports: true });
// 끊겨 있으면 보내지 않습니다(다시 붙을 때 join 보다 먼저 흘러가 버려짐).
function send(event, data) {
  if (!socket.connected) return false;
  socket.emit('c2d', { event, data });
  return true;
}
// 난이도·모드: 큰 화면이 값을 갖고, 여기서는 알약 버튼으로 바꿉니다(경기 중에는 잠김).
const ps = createPhoneSettings({ socket });
ps.attach(socket);
// 큰 화면이 판정한 진동(맞힌 순간, 홈런, 삼진)을 받습니다.
haptics.listen(socket, { slot: () => me && me.slot });
let noRoomTries = 0;
// 큰 화면이 이 폰이 살아 있는지 알 수 있게 1초마다 신호를 보냅니다.
setInterval(() => { if (me) send('ready', {}); }, 1000);
function keepAwake() {
  if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
}
let me = null;
let state = { phase: 'lobby' };
let started = false;
let gotMotion = false;
// 투타 대결에서 내 역할: 'bat' | 'pitch' | 'wait'. 경기 중이 아니거나 홈런 더비면 null.
let role = null;
let roleHint = null;
let playerCount = 0;
let curView = 'vStart';
const DEBUG = params.has('debug');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function show(view) {
  curView = view;
  for (const v of ['vStart', 'vMsg', 'vPlay', 'vPitch']) $(v).classList.toggle('hidden', v !== view);
}
function message(title, body) {
  $('msgTitle').textContent = title;
  $('msgBody').textContent = body || '';
  show('vMsg');
}

// ---------- 서버까지 왕복 시간 ----------
const rtts = [];
function measureRtt() {
  if (!socket.connected) return;
  const t0 = performance.now();
  socket.timeout(2000).emit('ping_rtt', t0, (err) => {
    if (err) return;
    rtts.push(performance.now() - t0);
    if (rtts.length > 7) rtts.shift();
  });
}
function rtt() {
  if (!rtts.length) return 80;
  const s = [...rtts].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
setInterval(measureRtt, 1500);

// ---------- 소리·진동 ----------
let actx = null;
function audio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) actx = new AC();
  }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
function crack(strength) {
  const a = audio();
  if (!a) return;
  const len = Math.floor(a.sampleRate * 0.09);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8;
  const g = a.createGain();
  g.gain.value = 0.5 + strength;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}
// 화면 전체를 내 색으로 한 번 번쩍(맞았을 때). 진동은 큰 화면이 판정해서 보내는 haptic 으로 옵니다.
function flashBody() {
  document.body.classList.remove('flash');
  void document.body.offsetWidth;
  document.body.classList.add('flash');
}

// ---------- 스윙 감지 ----------
// 회전 속도(도/초)가 문턱을 넘으면 스윙 시작으로 보고, 직후 90ms 동안 가장 센 값을 힘으로 씁니다.
// 문턱은 난이도를 따라 낮아집니다(쉬울수록 작은 스윙도 스윙). 어려움이 처음 낸 값입니다. 실폰으로 맞춘 값이 아닙니다.
// trig: 창을 여는 회전(°/s) / real: 창 안 최댓값이 이보다 작으면 준비 동작으로 보고 버림 / acc: 자이로가 없는 폰의 가속 문턱(m/s²)
const SWING = {
  easy: { trig: 300, real: 470, acc: 16 },
  normal: { trig: 340, real: 560, acc: 19 },
  hard: { trig: 380, real: 650, acc: 22 }
};
const swingCfg = () => ps.pick(SWING);
const POWER_BASE_DEG = 380; // 힘 계산의 바닥(난이도와 상관없이 같은 스윙은 같은 힘)
const COOLDOWN_MS = 600;
let swingAt = 0;
let window_ = null;
let hasGyro = false;

function onMotion(e) {
  const r = e.rotationRate;
  const acc = e.acceleration;
  const gyro = r && (r.alpha != null || r.beta != null || r.gamma != null);
  if (gyro) hasGyro = true;
  if (!gyro && !(acc && acc.x != null)) return;
  // 자이로가 있거나 가속도가 들어올 때만 센서가 있다고 봅니다.
  gotMotion = true;
  // 던질 차례(또는 투구 연습 중)에는 스윙을 잡지 않습니다(투구는 onPitchMotion 이 봅니다).
  if (role === 'pitch' || tutPitch.isRunning()) return;
  const rot = gyro ? Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0) : 0;
  const a = acc ? Math.hypot(acc.x || 0, acc.y || 0, acc.z || 0) : 0;
  const now = performance.now();
  if (window_) {
    if (rot > window_.rot || (!hasGyro && a > window_.acc)) window_.peakT = now;
    window_.rot = Math.max(window_.rot, rot);
    window_.acc = Math.max(window_.acc, a);
    return;
  }
  const cfg = swingCfg();
  const trig = hasGyro ? rot > cfg.trig : a > cfg.acc;
  if (trig && now - swingAt > COOLDOWN_MS) {
    swingAt = now;
    window_ = { start: now, peakT: now, rot, acc: a };
    setTimeout(() => {
      const w = window_;
      window_ = null;
      // 백스윙·로드 같은 느린 동작이면 보내지 않고 쿨다운도 풀어서 진짜 스윙을 놓치지 않게 합니다.
      const real = hasGyro ? w.rot > cfg.real : w.acc > cfg.acc + 6;
      if (!real) {
        swingAt = 0;
        return;
      }
      // 회전 1500도/초, 가속 35m/s² 정도면 아주 센 스윙입니다.
      const rotPart = hasGyro ? clamp((w.rot - POWER_BASE_DEG) / 1100, 0, 1) : Math.min(1, w.acc / 40);
      const p = Math.min(1, 0.55 * rotPart + 0.45 * Math.min(1, w.acc / 35));
      // 판정 시각은 가장 세게 돈 순간(정점)으로 보냅니다.
      sendSwing(Math.max(0.15, p), performance.now() - w.peakT, Math.round(w.rot));
    }, 90);
  }
}

// ago: 가장 세게 돈 순간이 몇 ms 전이었는지. 연습 중이면 큰 화면에 보내지 않고 연습 판정에 씁니다.
function sendSwing(power, ago, peak) {
  const at = performance.now() - (Number(ago) || 0);
  $('power').style.width = `${Math.round(power * 100)}%`;
  $('bat').style.transform = 'rotate(-35deg)';
  setTimeout(() => ($('bat').style.transform = ''), 250);
  // 휘두른 순간 아주 짧게 '틱'(지연 없는 손맛). 맞으면 큰 화면이 진동을 따로 보냅니다.
  haptics.tick({ noFlash: true });
  if (tutBat.signal('swing', { power, at, peak })) return;
  if (tutPitch.isRunning()) return;
  send('swing', { power, ago, rtt: rtt(), peak });
}

// ---------- 기기 축 맞추기 ----------
// rotationRate 의 alpha/beta/gamma 가 기기의 어느 축 회전인지는 실폰으로 확인한 기록이 없습니다.
// 이 파일은 MDN 표기(beta=X 짧은 축, gamma=Y 긴 축, alpha=Z 화면 수직)를 기본값으로 두지만,
// 탁구 컨트롤러(play/pingpong/controller.js:179)는 alpha=X, beta=Y, gamma=Z 로 가정합니다. 둘 다 미확인입니다.
// 그래서 폰이 천천히 움직일 때(조준·대기·타격 사이) 중력으로 직접 맞춥니다.
// 기기 좌표로 본 중력 g 는 dg/dt = -ω×g 로 변하므로, 48가지 대응(축 순서 6 × 부호 8) 가운데
// 관측한 g 변화를 가장 잘 설명하는 것을 고릅니다. accelerationIncludingGravity 의 부호가 통째로 뒤집힌 플랫폼에서도 성립합니다.
// 0.1초 조각 CAL.N 개를 한 묶음으로 판정하고, 두 묶음 연속 같은 답이 나와야 채택합니다. 채택한 값은 이 폰에 저장하고 계속 다시 확인합니다.
// 주소에 &axes=bga 처럼 주면 그 값을 씁니다(x,y,z 순서로 a=alpha b=beta g=gamma, 앞에 - 는 부호 반대).
const AXMAPS = [];
[[0, 1, 2], [1, 2, 0], [2, 0, 1], [0, 2, 1], [1, 0, 2], [2, 1, 0]].forEach((p, i) => {
  for (let m = 0; m < 8; m++) {
    const s = [m & 1 ? -1 : 1, m & 2 ? -1 : 1, m & 4 ? -1 : 1];
    // det +1 = 오른손 좌표 그대로(축 이름만 바뀐 것). 앞의 셋이 짝순열입니다.
    const det = (i < 3 ? 1 : -1) * s[0] * s[1] * s[2];
    AXMAPS.push({ p, s, det, key: p.map((k, j) => (s[j] < 0 ? '-' : '') + 'abg'[k]).join('') });
  }
});
const CAL = {
  SPAN: 0.1, // 이 시간(초) 동안의 중력 변화와 회전을 한 조각으로 비교합니다(표본 하나씩은 잡음에 묻힘)
  N: 30, // 한 묶음의 조각 수
  FLOOR: 0.1, // 조각 오차를 (관측² + 예측² + 이 값) 으로 나눠 0~2 점으로 씁니다. 손으로 민 조각 하나가 묶음을 망치지 않게
  BASE: 0.6, // 최선 후보 점수가 '회전 없음' 예측 점수의 이 비율 이하이고
  GAP: 0.7, //   다음 후보 점수의 이 비율 이하여야 답으로 봅니다
  G_TOL: 1.2, // 중력 크기(9.81)에서 이만큼(m/s²) 넘게 벗어나면 손으로 미는 가속이 섞인 것으로 보고 뺍니다
  ROT_MIN: 15, // 조각의 평균 회전이 이 범위(°/s) 일 때만 씁니다(너무 느리면 잡음, 너무 빠르면 스윙)
  ROT_MAX: 400,
  STORE: 'pcg-axes'
};
const cal = { map: AXMAPS.find((m) => m.key === 'bga'), how: 'default', err: AXMAPS.map(() => 0),
  base: 0, n: 0, ex: [0, 0, 0], prev: null, ck: null, lastWin: null, note: '' };
(() => {
  const q = (params.get('axes') || '').trim();
  const fromUrl = q && AXMAPS.find((m) => m.key === q);
  if (fromUrl) {
    cal.map = fromUrl;
    cal.how = 'url';
    return;
  }
  try {
    const v = JSON.parse(localStorage.getItem(CAL.STORE) || 'null');
    const m = v && v.ua === navigator.userAgent && AXMAPS.find((x) => x.key === v.key);
    if (m) {
      cal.map = m;
      cal.how = 'saved';
    }
  } catch (e) {}
})();
// 기본값이 아닌 축(보정·저장·주소 지정)을 쓰고 있는지
const axesSure = () => cal.how !== 'default';
// 기기 축 회전 속도 [x 짧은 축, y 긴 축, z 화면 수직] (°/s)
function devAxes(r) {
  const w = [r.alpha || 0, r.beta || 0, r.gamma || 0];
  const m = cal.map;
  return [m.s[0] * w[m.p[0]], m.s[1] * w[m.p[1]], m.s[2] * w[m.p[2]]];
}

function calStep(e, t) {
  if (cal.how === 'url') return;
  const r = e.rotationRate;
  const ag = e.accelerationIncludingGravity;
  const cur = r && ag && ag.x != null && (r.alpha != null || r.beta != null || r.gamma != null)
    ? { t, g: [ag.x || 0, ag.y || 0, ag.z || 0], w: [r.alpha || 0, r.beta || 0, r.gamma || 0] } : null;
  const p = cal.prev;
  cal.prev = cur;
  // 손으로 미는 가속이 섞였거나 표본이 끊기면 지금 조각을 버립니다.
  if (!cur || Math.abs(Math.hypot(...cur.g) - 9.81) > CAL.G_TOL) {
    cal.ck = null;
    return;
  }
  if (!p) return;
  const dt = (t - p.t) / 1000;
  if (dt < 0.004 || dt > 0.06) {
    cal.ck = null;
    return;
  }
  if (!cal.ck) cal.ck = { g0: p.g, dur: 0, ang: 0, ex: [0, 0, 0], pred: AXMAPS.map(() => [0, 0, 0]) };
  const ck = cal.ck;
  // 두 표본 사이에 돈 각(rad, 원래 축 이름 순서)과 그 사이 중력
  const k = (Math.PI / 180) * dt / 2;
  const th = [(cur.w[0] + p.w[0]) * k, (cur.w[1] + p.w[1]) * k, (cur.w[2] + p.w[2]) * k];
  const g = [(cur.g[0] + p.g[0]) / 2, (cur.g[1] + p.g[1]) / 2, (cur.g[2] + p.g[2]) / 2];
  ck.dur += dt;
  ck.ang += Math.hypot(...th);
  for (let i = 0; i < 3; i++) ck.ex[i] += Math.abs(th[i]) * (180 / Math.PI);
  AXMAPS.forEach((c, j) => {
    const wx = c.s[0] * th[c.p[0]];
    const wy = c.s[1] * th[c.p[1]];
    const wz = c.s[2] * th[c.p[2]];
    // 이 대응이 맞다면 중력이 바뀌었을 양 = -(θ × g)
    const q = ck.pred[j];
    q[0] -= wy * g[2] - wz * g[1];
    q[1] -= wz * g[0] - wx * g[2];
    q[2] -= wx * g[1] - wy * g[0];
  });
  if (ck.dur < CAL.SPAN) return;
  cal.ck = null;
  const rate = (ck.ang / ck.dur) * (180 / Math.PI);
  if (rate < CAL.ROT_MIN || rate > CAL.ROT_MAX) return;
  const d = [cur.g[0] - ck.g0[0], cur.g[1] - ck.g0[1], cur.g[2] - ck.g0[2]];
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  cal.base += dd / (dd + CAL.FLOOR);
  for (let i = 0; i < 3; i++) cal.ex[i] += ck.ex[i];
  ck.pred.forEach((q, j) => {
    const e2 = (d[0] - q[0]) ** 2 + (d[1] - q[1]) ** 2 + (d[2] - q[2]) ** 2;
    cal.err[j] += e2 / (dd + q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + CAL.FLOOR);
  });
  if (++cal.n >= CAL.N) calJudge();
}

function calJudge() {
  const order = AXMAPS.map((m, j) => j).sort((a, b) => cal.err[a] - cal.err[b]);
  let w = order[0];
  let next = order[1];
  const A = AXMAPS[w];
  const B = AXMAPS[next];
  // 한 축 부호만 다른 두 후보가 비슷하면 그 축은 이 묶음에서 거의 안 움직인 것입니다(세워 쥐고 긴 축으로만 돌린 경우 등).
  // 그때는 오른손 좌표(det +1)를 고르고 그 다음 후보와 비교합니다.
  const twin = A.p.join() === B.p.join() && A.s.filter((v, i) => v !== B.s[i]).length === 1;
  if (twin && cal.err[w] > CAL.GAP * cal.err[next]) {
    if (A.det < 0) w = next;
    next = order[2];
  }
  const ok = cal.err[w] <= CAL.BASE * cal.base && cal.err[w] <= CAL.GAP * cal.err[next];
  const win = ok ? AXMAPS[w] : null;
  const fmt = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-');
  cal.note = `${win ? win.key : '애매'} · 최선/기준 ${fmt(cal.err[w] / cal.base)} 최선/차선 ${fmt(cal.err[w] / cal.err[next])}` +
    ` · 움직임 α${Math.round(cal.ex[0])}° β${Math.round(cal.ex[1])}° γ${Math.round(cal.ex[2])}°`;
  if (win && cal.lastWin === win.key) {
    cal.map = win;
    cal.how = 'cal';
    try { localStorage.setItem(CAL.STORE, JSON.stringify({ key: win.key, ua: navigator.userAgent })); } catch (e) {}
  }
  cal.lastWin = win ? win.key : null;
  cal.err.fill(0);
  cal.base = 0;
  cal.n = 0;
  cal.ex = [0, 0, 0];
  renderDbg();
}

// ---------- 투구 감지(투타 대결) ----------
// 폰을 세로로, 화면이 나를 보게 쥐고(조준하던 그대로) 큰 화면 쪽으로 던집니다.
// 회전이 TRIGGER_DEG 를 넘거나 가속이 FORK_ACC 를 넘으면 창을 열고, 회전 정점 뒤 AFTER 만큼 더 본 다음 판정합니다
// (정점이 늦게 와도 창이 따라 늘어납니다. 최대 MAX_WIN).
// 창 안 정점이 THROW_DEG 미만이고 가속도 FORK_ACC 미만이면 와인드업 같은 준비 동작으로 보고 버리며, 쿨다운도 걸지 않습니다.
// 축을 맞춘 뒤(axesSure)에는 정점 순간 x 회전이 음수(폰 윗부분이 앞으로 넘어감)여야 투구입니다. 팔을 뒤로 젖히는 동작은 버립니다.
// 구질은 정점 앞뒤 구간의 기기 축별 회전으로 고릅니다. 아래 문턱은 모두 실폰으로 재 본 값이 아닙니다.
// 주소 끝에 &debug 를 붙이면 던질 때마다 측정값과 축 보정 상태가 화면 아래에 나옵니다(던질 차례가 아니어도 잽니다).
const PT = {
  TRIGGER_DEG: 450, // 회전(°/s) 이 이 값을 넘으면 투구 창을 엽니다
  THROW_DEG: 650, // 창 안 회전 정점이 이 이상이어야 투구
  FORK_ACC: 30, // 또는 가속 정점(m/s²) 이 이 이상이면 투구(손목을 고정하고 내리꽂기). 창도 엽니다
  ACC_TRIGGER: 24, // 자이로가 없는 폰: 가속이 이 값을 넘으면 창을 열고
  ACC_REAL: 30, //   창 안 가속 정점이 이 이상이어야 투구
  FORK_RATIO: 20, // 포크볼: 회전 정점 ÷ 가속 정점(°/s ÷ m/s²) 이 이 미만(같은 가속에 회전이 적음 = 손목 고정)
  FORK_ANGLE: 60, //   또는 구간 총 회전각(°) 이 이 미만. 둘 다 가속 정점이 FORK_ACC 이상일 때만
  SLIDER_SHARE: 0.42, // 슬라이더: 롤(긴 축 y) 회전각이 세 축 회전각 합의 이 비율 이상이고
  SLIDER_MIN: 40, //   롤 각도가 이 이상(°)
  SLIDER_SIGN: 1, // y 양수 = 우투수 기준 바깥쪽(글러브 쪽, 우타자에게서 멀어지는) 슬라이더. 음수는 몸쪽으로 휘는 역슬라이더(부호 미확인)
  CURVE_LATE: 1.15, // 커브: 팔 축 회전 속도가 정점 뒤 SNAP_W 동안 정점 앞 SNAP_W 의 이 배 이상(놓는 순간 손목을 더 꺾음)이고
  CURVE_RATIO: 25, //   회전 정점 ÷ 가속 정점이 이 이상(팔 전체보다 손목으로 돌림)
  CURVE_WRIST: 50, //   또는 회전 정점 ÷ 가속 정점이 이 이상(팔은 거의 안 밀고 손목으로만 크게 꺾음)
  SNAP_W: 60, // 늦은 꺾기를 비교하는 정점 앞뒤 구간(ms)
  BEFORE: 160, // 정점 앞 적분 구간(ms)
  AFTER: 70, // 정점 뒤 적분 구간이자, 정점 뒤 이만큼 더 기다린 다음 판정(ms)
  MAX_WIN: 450, // 창을 여는 최대 시간(ms)
  COOLDOWN: 900,
  STRONG_DEG: 900, // 조준점을 끄는 중이어도 회전 정점이 이만큼 세면 투구로 받습니다
  DRAG_ROT: 150, // 폰 회전이 이보다 느릴 때 손가락이 움직이면 조준을 끄는 것으로 봅니다
  DRAG_QUIET: 150, // 조준을 끈 뒤 이 시간(ms) 안의 약한 흔들림은 투구로 보지 않습니다
  GRIP_ROT: 250 // 조준판을 누른 동안 폰이 이보다 빨리 돌았으면 쥔 손이 닿은 것으로 보고 조준을 되돌립니다
};
// 난이도가 낮으면 투구로 받는 회전 문턱(TRIGGER_DEG·THROW_DEG)을 이만큼 낮춥니다.
const throwEase = () => ps.pick({ easy: 0.82, normal: 0.9, hard: 1 });
// 큰 화면은 난이도만큼 구속을 줄여서 던집니다(game.js pitchKmh). 투수 화면에도 같은 숫자를 보여 줍니다.
const shownKmh = (kmh) => Math.round(clamp(kmh * ps.pick({ easy: 0.7, normal: 0.85, hard: 1 }), 70, 165));
// 투구 연습 단계가 던지기를 기다리는지
const tutThrow = () => {
  const c = tutPitch.current();
  return Boolean(c && c.waitFor === 'throw');
};
const PITCH_NAMES = { fastball: '직구', slider: '슬라이더', curve: '커브', fork: '포크볼' };
const pitchName = (type, side) => (type === 'slider' && side < 0 ? '역슬라이더' : PITCH_NAMES[type]);
// 센서가 없을 때 버튼으로 던지는 속도 범위(km/h)
const PRESET = { fastball: [140, 150], slider: [126, 136], curve: [106, 118], fork: [124, 134] };

// 구질 고르기. f = throwFeatures(...) 결과. 자이로가 없는 폰은 고른 구질(pick)로 던집니다.
function classifyThrow(f, pick) {
  if (!f.gyro) return { type: PITCH_NAMES[pick] ? pick : 'fastball', side: 1 };
  const ratio = f.peak / Math.max(f.acc, 1);
  if (f.acc >= PT.FORK_ACC && (ratio < PT.FORK_RATIO || f.total < PT.FORK_ANGLE)) return { type: 'fork', side: 1 };
  const sum = Math.abs(f.ang[0]) + Math.abs(f.ang[1]) + Math.abs(f.ang[2]) || 1;
  const roll = f.ang[f.rollAx];
  if (Math.abs(roll) / sum >= PT.SLIDER_SHARE && Math.abs(roll) >= PT.SLIDER_MIN) {
    return { type: 'slider', side: Math.sign(roll) * PT.SLIDER_SIGN || 1 };
  }
  if ((f.late >= PT.CURVE_LATE && ratio >= PT.CURVE_RATIO) || ratio >= PT.CURVE_WRIST) return { type: 'curve', side: 1 };
  return { type: 'fastball', side: 1 };
}

// 구속: 회전 정점 600°/s → 110km/h, 1500°/s → 155km/h. 포크볼과 자이로 없는 폰은 미는 세기(가속)도 봅니다. 구질마다 조금씩 느립니다.
function throwSpeed(f, type) {
  const fromRot = 110 + 45 * clamp((f.peak - 600) / 900, 0, 1);
  const fromAcc = 110 + 40 * clamp((f.acc - PT.FORK_ACC) / 40, 0, 1);
  const base = !f.gyro ? fromAcc : type === 'fork' ? Math.max(fromRot, fromAcc) : fromRot;
  const mul = { fastball: 1, slider: 0.92, curve: 0.8, fork: 0.92 }[type] || 1;
  return Math.round(clamp(base * mul, 90, 158));
}

// 정점을 찾고 그 앞뒤 구간에서 축별 회전각을 적분합니다. samples 의 x/y/z 는 기기 축(devAxes) 값입니다.
// from: 이 시각 이후에서만 정점을 찾습니다(창을 연 순간 직전부터. 그 앞의 와인드업 정점을 고르지 않게).
function throwFeatures(samples, sure, from) {
  let gyro = false;
  for (const s of samples) if (s.rot > 0) gyro = true;
  const key = gyro ? 'rot' : 'acc';
  let pk = null;
  for (const s of samples) if (s.t >= (from == null ? -Infinity : from) && (!pk || s[key] > pk[key])) pk = s;
  if (!pk) pk = samples[samples.length - 1];
  const t0 = pk.t - PT.BEFORE;
  const t1 = pk.t + PT.AFTER;
  const ang = [0, 0, 0];
  const pre = [0, 0, 0];
  const post = [0, 0, 0];
  let total = 0;
  let acc = 0;
  let preT = 0;
  let postT = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.t >= t0 - 20 && s.t <= t1 + 20) acc = Math.max(acc, s.acc);
    if (!i) continue;
    const q = samples[i - 1];
    // 두 표본 사이 구간을 가운데 시각으로 나눠 담습니다(사다리꼴 적분).
    const mid = (s.t + q.t) / 2;
    if (mid < t0 || mid > t1) continue;
    const dt = Math.min(0.05, (s.t - q.t) / 1000);
    const v = [((s.x + q.x) / 2) * dt, ((s.y + q.y) / 2) * dt, ((s.z + q.z) / 2) * dt];
    total += ((s.rot + q.rot) / 2) * dt;
    const side = mid < pk.t ? (mid >= pk.t - PT.SNAP_W ? pre : null) : mid < pk.t + PT.SNAP_W ? post : null;
    for (let k = 0; k < 3; k++) {
      ang[k] += v[k];
      if (side) side[k] += v[k];
    }
    if (side === pre) preT += dt;
    else if (side === post) postT += dt;
  }
  // 축을 맞췄으면 팔 축 = x(짧은 축), 롤 = y(긴 축). 아니면 이름에 기대지 않고 가장 크게 돈 축을 팔 축으로 봅니다.
  const mag = ang.map(Math.abs);
  const armAx = sure ? 0 : mag.indexOf(Math.max(...mag));
  const others = [0, 1, 2].filter((k) => k !== armAx);
  const rollAx = sure ? 1 : mag[others[0]] >= mag[others[1]] ? others[0] : others[1];
  const rPre = preT ? Math.abs(pre[armAx]) / preT : 0;
  const rPost = postT ? Math.abs(post[armAx]) / postT : 0;
  return {
    gyro, peak: gyro ? pk.rot : 0, peakT: pk.t, acc, ang, total, armAx, rollAx,
    late: rPost / Math.max(rPre, 100),
    // 앞으로 던진 정도: 정점 순간 x 회전(약하면 구간 x 회전각)의 반대 부호. 축을 맞췄을 때만 뜻이 있습니다.
    fwd: pk.rot >= PT.TRIGGER_DEG ? -pk.x : -ang[0],
    atPeak: [Math.round(pk.x), Math.round(pk.y), Math.round(pk.z)]
  };
}

const motionBuf = [];
let throwWin = null;
let winSeq = 0;
let lastThrowAt = 0;
let thrownN = null;
let gyroSeen = false; // 0 이 아닌 회전 값이 한 번이라도 들어왔는지(자이로 없는 폰은 늘 0 이나 null)
let motionN = 0;
let lastRot = 0;
let pickType = 'fastball'; // 자이로 없는 폰에서 고른 구질
let dbgThrow = '';
const aim = { x: 0, y: 0 }; // 조준판에 보이는 코스(-1~1). 큰 화면과 같은 포수 시점: 오른쪽 +, 위 +
const aimSet = { x: 0, y: 0 }; // 던질 때 쓰는 코스. 조준판에서 손을 떼야 바뀝니다.
let aimTouch = null; // 조준 중인 첫 손가락 { id, maxRot, moved, thrown, x0, y0 }
let dragAt = -Infinity; // 폰을 거의 안 돌리면서 조준점을 끈 마지막 시각
const noGyro = () => gotMotion && !gyroSeen && motionN >= 60;

function canThrow() {
  return role === 'pitch' && state.phase === 'playing' && state.sub === 'await' && state.n != null && state.n !== thrownN;
}

function onPitchMotion(e) {
  const r = e.rotationRate;
  const gyro = r && (r.alpha != null || r.beta != null || r.gamma != null);
  let acc = 0;
  const la = e.acceleration;
  const ag = e.accelerationIncludingGravity;
  if (la && la.x != null) acc = Math.hypot(la.x || 0, la.y || 0, la.z || 0);
  else if (ag && ag.x != null) acc = Math.max(0, Math.hypot(ag.x || 0, ag.y || 0, ag.z || 0) - 9.81);
  else if (!gyro) return;
  gotMotion = true;
  const now = performance.now();
  calStep(e, now);
  const [x, y, z] = gyro ? devAxes(r) : [0, 0, 0];
  const s = { t: now, x, y, z, acc, rot: Math.hypot(x, y, z) };
  lastRot = s.rot;
  if (aimTouch) aimTouch.maxRot = Math.max(aimTouch.maxRot, s.rot);
  let changed = false;
  if (s.rot > 0 && !gyroSeen) changed = gyroSeen = true;
  if (++motionN === 60) changed = true;
  if (role !== 'pitch' && !tutThrow()) {
    motionBuf.length = 0;
    throwWin = null;
    return;
  }
  if (changed && role === 'pitch') renderPitch();
  motionBuf.push(s);
  while (motionBuf.length && now - motionBuf[0].t > 900) motionBuf.shift();
  if (throwWin) {
    // 정점이 늦게 오면 창을 늘립니다. 정점 뒤 AFTER 가 지나야(또는 MAX_WIN) 판정합니다.
    const w = throwWin;
    const v = gyroSeen ? s.rot : s.acc;
    if (v > w.peak) {
      w.peak = v;
      w.peakT = now;
    }
    if (now - w.peakT < PT.AFTER && now - w.start < PT.MAX_WIN) return;
    finishThrow();
    if (throwWin) return;
  }
  // 던질 차례(또는 투구 연습)가 아니면 잡지 않습니다(&debug 면 재기만 합니다).
  if (!(canThrow() || tutThrow() || DEBUG) || now - lastThrowAt < PT.COOLDOWN) return;
  const trig = gyroSeen ? s.rot > PT.TRIGGER_DEG * throwEase() || s.acc > PT.FORK_ACC : s.acc > PT.ACC_TRIGGER;
  if (!trig) return;
  const id = ++winSeq;
  throwWin = { id, start: now, peak: gyroSeen ? s.rot : s.acc, peakT: now, aim: { x: aimSet.x, y: aimSet.y } };
  // 센서 값이 끊겨도 창은 닫습니다.
  setTimeout(() => { if (throwWin && throwWin.id === id) finishThrow(); }, PT.MAX_WIN + 200);
}

// 투구가 아니면 이유를 돌려줍니다. tell 이 있으면 잠시 뒤 투수에게 알립니다.
function rejectThrow(f, w, sure) {
  if (f.gyro) {
    if (f.peak < PT.THROW_DEG * throwEase() && f.acc < PT.FORK_ACC) return { text: `약함 ${Math.round(f.peak)}°/s`, weak: true };
    if (sure && f.fwd <= 0) {
      return { text: '뒤로 젖힘', tell: f.peak >= PT.THROW_DEG ? '앞으로 던지세요 · 화면이 나를 보게 쥐어요' : null };
    }
  } else if (f.acc < PT.ACC_REAL) {
    return { text: `약함 ${f.acc.toFixed(1)}m/s²`, weak: true };
  }
  const strong = f.gyro ? f.peak >= PT.STRONG_DEG : f.acc >= PT.ACC_REAL + 10;
  if (dragAt >= w.start - PT.DRAG_QUIET && !strong) return { text: '조준 중', tell: '조준하는 중이에요 · 손을 떼고 던지세요' };
  return null;
}

function finishThrow() {
  const w = throwWin;
  throwWin = null;
  if (!w) return;
  const samples = motionBuf.filter((s) => s.t >= w.start - PT.BEFORE - 120);
  if (samples.length < 2) return;
  const sure = axesSure();
  const f = throwFeatures(samples, sure, w.start - 50);
  const why = rejectThrow(f, w, sure);
  const c = why ? null : classifyThrow(f, pickType);
  if (DEBUG) {
    const ax = 'xyz';
    dbgThrow = `정점 ${Math.round(f.peak)}°/s · 가속 ${f.acc.toFixed(1)}m/s² · 비 ${(f.peak / Math.max(f.acc, 1)).toFixed(1)} · 늦은 꺾기 ${f.late.toFixed(2)}\n` +
      `회전각 x ${Math.round(f.ang[0])} y ${Math.round(f.ang[1])} z ${Math.round(f.ang[2])} · 합 ${Math.round(f.total)}° · 팔 ${ax[f.armAx]} 롤 ${ax[f.rollAx]}\n` +
      `정점 순간 x/y/z ${f.atPeak.join(' / ')} → ${why ? `버림(${why.text})` : pitchName(c.type, c.side)}${canThrow() ? '' : ' · 연습'}`;
    renderDbg();
  }
  // 투구 연습: 큰 화면에 보내지 않고 연습 판정에만 씁니다.
  if (tutThrow()) {
    if (why) {
      if (why.text !== '조준 중') tutPitch.fail(why.weak ? '조금 더 세게 던져요' : why.tell || '앞으로 던져요');
      return;
    }
    lastThrowAt = performance.now();
    tutPitch.signal('throw', { type: c.type, side: c.side, speed: throwSpeed(f, c.type) });
    return;
  }
  if (why) {
    // 버린 동작은 쿨다운을 걸지 않아 바로 이어지는 진짜 투구를 잡습니다.
    if (why.tell && canThrow()) {
      const at = performance.now();
      setTimeout(() => { if (lastThrowAt < at && !throwWin && canThrow()) pitchMsg(why.tell, 1800); }, 700);
    }
    return;
  }
  lastThrowAt = performance.now();
  if (!canThrow()) return;
  sendThrow(c.type, throwSpeed(f, c.type), c.side, performance.now() - f.peakT, Math.round(f.peak), w.aim);
}

function renderDbg() {
  if (!DEBUG) return;
  const m = cal.map;
  const nm = (j) => `${m.s[j] < 0 ? '-' : ''}${'αβγ'[m.p[j]]}`;
  const how = { default: '기본값(미확인)', saved: '저장값', url: '주소 지정', cal: '중력 보정' }[cal.how];
  $('dbg').textContent = `${dbgThrow ? `${dbgThrow}\n` : ''}축 x=${nm(0)} y=${nm(1)} z=${nm(2)} · ${how} · 보정 ${cal.n}/${CAL.N}` +
    `${cal.note ? `\n지난 묶음 ${cal.note}` : ''}${noGyro() ? '\n자이로 없음' : ''}`;
}

let pKeep = 0;
function pitchMsg(text, ms) {
  const k = ++pKeep;
  $('pState').dataset.keep = '1';
  $('pState').textContent = text;
  setTimeout(() => {
    if (k !== pKeep) return;
    delete $('pState').dataset.keep;
    if (role === 'pitch') renderPitch();
  }, ms || 2000);
}

// at: 던질 때 쓸 코스(창을 연 순간의 확정 코스). 없으면 지금 확정 코스.
function sendThrow(type, speed, side, ago, peak, at) {
  if (!canThrow()) {
    pitchMsg(state.sub === 'await' ? '이미 던졌어요' : '아직이에요', 1200);
    return false;
  }
  const a = at || aimSet;
  const ok = send('throw', { type, speed, side, aimX: Math.round(a.x * 1000) / 1000, aimY: Math.round(a.y * 1000) / 1000,
    ago: Math.round(ago), rtt: rtt(), n: state.n, peak: peak || 0 });
  // 끊겨 있어 못 보냈으면 던진 것으로 치지 않습니다(같은 공을 다시 던질 수 있게).
  if (!ok) {
    pitchMsg('연결 중이에요 · 다시 던지세요', 2000);
    return false;
  }
  thrownN = state.n;
  // 조준판을 누른 채 던졌으면 그 손은 쥔 손입니다. 손을 떼도 조준을 바꾸지 않습니다.
  if (aimTouch) aimTouch.thrown = true;
  haptics.hit(0.7);
  pitchMsg(`${pitchName(type, side)} ${shownKmh(speed)}km/h`, 2200);
  renderPitch();
  return true;
}

// 조준판: 가운데 사각형이 스트라이크 존(큰 화면 duel.js 의 ZONE·PAD 와 같은 비율), 바깥은 볼.
const ZX = 0.25 / 0.6;
const ZY = 0.3 / 0.6;
// cv·a 를 주면 다른 캔버스(투구 연습)에 같은 조준판을 그립니다.
function drawPad(cv = $('padCv'), a = aim) {
  const rect = cv.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (!w || !h) return;
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  const g = cv.getContext('2d');
  const X = (a) => ((a + 1) / 2) * w;
  const Yp = (a) => ((1 - a) / 2) * h;
  g.fillStyle = '#13263a';
  g.fillRect(0, 0, w, h);
  // 우타자(포수 시점에서는 왼쪽에 섭니다)
  g.fillStyle = 'rgba(255,255,255,.09)';
  g.beginPath();
  g.arc(X(-0.82), Yp(0.78), w * 0.065, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  const bx = X(-0.97);
  const by = Yp(0.66);
  if (g.roundRect) g.roundRect(bx, by, X(-0.66) - bx, Yp(-1) - by, 14 * dpr);
  else g.rect(bx, by, X(-0.66) - bx, Yp(-1) - by);
  g.fill();
  // 존
  const zx0 = X(-ZX);
  const zx1 = X(ZX);
  const zy0 = Yp(ZY);
  const zy1 = Yp(-ZY);
  g.fillStyle = 'rgba(255,255,255,.06)';
  g.fillRect(zx0, zy0, zx1 - zx0, zy1 - zy0);
  g.strokeStyle = 'rgba(255,255,255,.18)';
  g.lineWidth = 1.5 * dpr;
  for (const k of [1, 2]) {
    g.beginPath();
    g.moveTo(zx0 + ((zx1 - zx0) * k) / 3, zy0);
    g.lineTo(zx0 + ((zx1 - zx0) * k) / 3, zy1);
    g.moveTo(zx0, zy0 + ((zy1 - zy0) * k) / 3);
    g.lineTo(zx1, zy0 + ((zy1 - zy0) * k) / 3);
    g.stroke();
  }
  g.strokeStyle = 'rgba(255,255,255,.85)';
  g.lineWidth = 2.5 * dpr;
  g.strokeRect(zx0, zy0, zx1 - zx0, zy1 - zy0);
  // 홈플레이트
  g.fillStyle = 'rgba(255,255,255,.5)';
  g.beginPath();
  g.moveTo(zx0, Yp(-0.86));
  g.lineTo(zx1, Yp(-0.86));
  g.lineTo(zx1, Yp(-0.9));
  g.lineTo((zx0 + zx1) / 2, Yp(-0.97));
  g.lineTo(zx0, Yp(-0.9));
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(255,255,255,.45)';
  g.font = `700 ${12 * dpr}px -apple-system, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.fillText('몸쪽', X(-0.55), Yp(-0.72));
  g.fillText('바깥쪽', X(0.7), Yp(-0.72));
  // 조준점
  const inside = Math.abs(a.x) <= ZX && Math.abs(a.y) <= ZY;
  const ax = X(a.x);
  const ay = Yp(a.y);
  const c = getComputedStyle(document.documentElement).getPropertyValue('--c').trim() || '#ff5a5f';
  g.strokeStyle = c;
  g.lineWidth = 3 * dpr;
  g.beginPath();
  g.arc(ax, ay, 19 * dpr, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#f7f4ec';
  g.beginPath();
  g.arc(ax, ay, 12 * dpr, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#c8202f';
  g.lineWidth = 1.6 * dpr;
  g.beginPath();
  g.arc(ax - 15 * dpr, ay, 11 * dpr, -0.6, 0.6);
  g.stroke();
  g.beginPath();
  g.arc(ax + 15 * dpr, ay, 11 * dpr, Math.PI - 0.6, Math.PI + 0.6);
  g.stroke();
  g.fillStyle = inside ? 'rgba(255,255,255,.75)' : '#ffd23a';
  g.font = `800 ${13 * dpr}px -apple-system, system-ui, sans-serif`;
  g.fillText(inside ? '스트라이크 존' : '볼 코스', w / 2, 20 * dpr);
}

function setAim(e) {
  const r = $('pad').getBoundingClientRect();
  aim.x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
  aim.y = clamp(1 - ((e.clientY - r.top) / r.height) * 2, -1, 1);
  drawPad();
}
// 조준은 첫 손가락 하나로만 하고, 손을 떼야 확정합니다(aimSet). 공처럼 쥔 손바닥·다른 손가락은 무시합니다.
$('pad').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (aimTouch) return;
  aimTouch = { id: e.pointerId, maxRot: 0, moved: false, thrown: false, x0: e.clientX, y0: e.clientY };
  try { $('pad').setPointerCapture(e.pointerId); } catch (err) {}
  setAim(e);
});
$('pad').addEventListener('pointermove', (e) => {
  if (!aimTouch || e.pointerId !== aimTouch.id) return;
  if (Math.hypot(e.clientX - aimTouch.x0, e.clientY - aimTouch.y0) > 6) aimTouch.moved = true;
  // 폰을 거의 안 돌리면서 끄는 것만 조준으로 봅니다(던지는 중에 손이 미끄러진 것은 아님).
  if (aimTouch.moved && lastRot < PT.DRAG_ROT) dragAt = performance.now();
  setAim(e);
});
for (const ev of ['pointerup', 'pointercancel']) {
  $('pad').addEventListener(ev, (e) => {
    if (!aimTouch || e.pointerId !== aimTouch.id) return;
    const t = aimTouch;
    aimTouch = null;
    if (t.thrown || t.maxRot > PT.GRIP_ROT) {
      // 누른 채 던졌거나 폰이 크게 돌았으면 쥔 손이 닿은 것입니다. 조준을 누르기 전으로 되돌립니다.
      aim.x = aimSet.x;
      aim.y = aimSet.y;
    } else {
      aimSet.x = aim.x;
      aimSet.y = aim.y;
      // 손가락을 뗀 직후의 약한 흔들림은 투구로 보지 않습니다.
      if (t.moved) dragAt = performance.now();
    }
    drawPad();
  });
}
window.addEventListener('resize', () => { if (curView === 'vPitch') drawPad(); });

const nameOf = (slot) => (state.names && state.names[slot]) || (slot ? `${slot}P` : '');

function renderPitch() {
  const c = state.count || {};
  $('pTitle').textContent = `투구 차례 · ${nameOf(state.batter)} 타석`;
  $('pCount').textContent = `${c.b || 0}볼 ${c.s || 0}스트 ${c.o || 0}아웃`;
  const ready = canThrow();
  $('pad').classList.toggle('armed', ready);
  if (!$('pState').dataset.keep) {
    $('pState').textContent = ready ? '던지세요!' : state.sub === 'pitch' ? '투구!' : '기다려요';
  }
  // 자이로가 없는 폰은 손목으로 구질을 못 고르니 버튼으로 고르고 던집니다.
  // (센서가 아예 없으면 버튼이 바로 던지는 버튼입니다. 그때는 btnStart 의 타이머가 버튼을 보입니다.)
  const pick = noGyro();
  if (gotMotion) $('pTypes').classList.toggle('hidden', !pick);
  $('pTypes').classList.toggle('pick', pick);
  for (const b of document.querySelectorAll('#pTypes button')) b.classList.toggle('on', pick && b.dataset.type === pickType);
  $('pHint').textContent = pick
    ? '이 폰은 자이로가 없어 손목으로 구질을 못 골라요. 아래에서 구질을 고르고, 폰을 쥔 채 큰 화면 쪽으로 던지세요.'
    : '존을 누르거나 끌어 코스를 정하고 손을 떼세요. 폰을 세로로, 화면이 나를 보게 쥐고 큰 화면 쪽으로 던지세요.';
  drawPad();
  renderDbg();
}

// ---------- 처음 하는 사람 연습(튜토리얼) ----------
// 이 폰에서 처음이면(localStorage pcg-tut-baseball) 시작하기 → 방 연결 뒤 타격 연습 4단계를 띄웁니다.
// 투타 대결이면 투구 연습 3단계(pcg-tut-baseball-pitch)도 처음 한 번 띄웁니다. 진행 상황은 큰 화면 대기실에 뜹니다.
// 주소로 시험: ?tut=1(늘 띄움) ?tut=0(안 띄움) &debug(단계마다 '시험: 성공 처리')
const SENSOR_WAIT = 1500;

// 센서가 없는 폰·PC: 연습 단계 안에 '눌러서 스윙' 버튼을 띄웁니다(1.5초 동안 센서 값이 없을 때).
function swingFallback(stage, power = 0.85) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tutBtn';
  b.textContent = '센서 없음 · 눌러서 스윙';
  b.hidden = true;
  b.addEventListener('click', () => sendSwing(power, 0, 0));
  stage.appendChild(b);
  const t = setTimeout(() => { if (!gotMotion) b.hidden = false; }, SENSOR_WAIT);
  return () => clearTimeout(t);
}

// 타이밍 연습: 폰 화면에서 공이 날아오고 링이 줄어듭니다(큰 화면의 타이밍 링과 같은 모양). 링이 공에 닿을 때 휘두르면 성공.
const TT = { wait: 1000, fly: 1050, after: 750 }; // ms. 한 바퀴 = 2.8초
const timing = { t0: 0, raf: 0, last: null };
const ttCycle = () => TT.wait + TT.fly + TT.after;
function ttCross(at) {
  const k = Math.round((at - timing.t0 - TT.wait - TT.fly) / ttCycle());
  return timing.t0 + TT.wait + TT.fly + Math.max(0, k) * ttCycle();
}
function judgeTiming(d) {
  const err = (d.at - ttCross(d.at)) / 1000;
  const tol = ps.pick({ easy: 0.3, normal: 0.24, hard: 0.17 });
  const ok = Math.abs(err) <= tol;
  timing.last = { err, ok, shown: performance.now() };
  const ms = Math.round(Math.abs(err) * 1000);
  if (ok) return { ok: true, msg: Math.abs(err) < 0.07 ? '딱! 완벽한 타이밍' : `맞았어요 · ${ms}ms ${err < 0 ? '빨랐어요' : '늦었어요'}` };
  return err < 0 ? `${ms}ms 빨라요 · 링이 공에 닿을 때 휘둘러요` : `${ms}ms 늦어요 · 조금 더 일찍`;
}
function timingStage(stage) {
  const cv = document.createElement('canvas');
  cv.className = 'tutCv';
  stage.appendChild(cv);
  const off = swingFallback(stage);
  timing.t0 = performance.now();
  timing.last = null;
  const col = getComputedStyle(document.documentElement).getPropertyValue('--c').trim() || '#ff5a5f';
  const draw = () => {
    timing.raf = requestAnimationFrame(draw);
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(r.width * dpr);
    const h = Math.round(r.height * dpr);
    if (!w || !h) return;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d');
    const now = performance.now();
    const t = (now - timing.t0) % ttCycle();
    const u = (t - TT.wait) / TT.fly; // 0 = 놓음, 1 = 홈플레이트
    // 경기장: 위가 투수, 아래가 홈플레이트(포수 시점)
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0e1a2e');
    sky.addColorStop(0.45, '#13324a');
    sky.addColorStop(1, '#1d5a3a');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(176,122,74,.55)';
    g.beginPath();
    g.ellipse(w / 2, h * 0.2, w * 0.11, h * 0.05, 0, 0, Math.PI * 2);
    g.fill();
    // 투수
    g.fillStyle = 'rgba(255,255,255,.75)';
    g.beginPath();
    g.arc(w / 2, h * 0.11, 5 * dpr, 0, Math.PI * 2);
    g.fill();
    g.fillRect(w / 2 - 4 * dpr, h * 0.13, 8 * dpr, 12 * dpr);
    // 스트라이크 존
    const zx = w / 2;
    const zy = h * 0.66;
    const zw = Math.min(w * 0.2, h * 0.3);
    const zh = zw * 1.15;
    const near = u > 0.9 && u < 1.1;
    g.strokeStyle = near ? '#ffd23a' : 'rgba(255,255,255,.75)';
    g.lineWidth = 2.5 * dpr;
    g.strokeRect(zx - zw / 2, zy - zh / 2, zw, zh);
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.beginPath();
    g.moveTo(zx - zw / 2, h * 0.92);
    g.lineTo(zx + zw / 2, h * 0.92);
    g.lineTo(zx + zw / 2, h * 0.95);
    g.lineTo(zx, h * 0.98);
    g.lineTo(zx - zw / 2, h * 0.95);
    g.fill();
    if (u >= 0 && u <= 1.25) {
      const k = Math.min(1, u);
      // 링: 공이 닿는 순간 공 크기로 줄어듭니다.
      const ballR = (3 + 9 * k * k) * dpr;
      const ringR = ballR + 3 * dpr + (1 - k) * zw * 1.1;
      g.strokeStyle = near ? '#ffd23a' : `rgba(255,255,255,${0.4 + 0.6 * k})`;
      g.lineWidth = (2.5 + (near ? 2 : 0)) * dpr;
      if (u <= 1.08) {
        g.beginPath();
        g.arc(zx, zy, ringR, 0, Math.PI * 2);
        g.stroke();
      }
      // 공(위에서 내려오며 커짐). 지나가면 아래로 빠집니다.
      const by = h * 0.15 + (zy - h * 0.15) * u;
      g.globalAlpha = u > 1 ? Math.max(0, 1 - (u - 1) / 0.25) : 1;
      g.fillStyle = '#f7f4ec';
      g.beginPath();
      g.arc(zx, by, ballR, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#c8202f';
      g.lineWidth = 1.2 * dpr;
      g.beginPath();
      g.arc(zx - ballR * 1.25, by, ballR, -0.6, 0.6);
      g.stroke();
      g.beginPath();
      g.arc(zx + ballR * 1.25, by, ballR, Math.PI - 0.6, Math.PI + 0.6);
      g.stroke();
      g.globalAlpha = 1;
    }
    // 방금 휘두른 결과: 맞으면 불꽃, 아니면 빠름/늦음
    const L = timing.last;
    if (L && now - L.shown < 900) {
      const a = 1 - (now - L.shown) / 900;
      g.globalAlpha = a;
      if (L.ok) {
        g.strokeStyle = col;
        g.lineWidth = 3 * dpr;
        for (let i = 0; i < 10; i++) {
          const th = (i / 10) * Math.PI * 2;
          const r0 = 14 * dpr + (1 - a) * 18 * dpr;
          g.beginPath();
          g.moveTo(zx + Math.cos(th) * r0, zy + Math.sin(th) * r0);
          g.lineTo(zx + Math.cos(th) * (r0 + 10 * dpr), zy + Math.sin(th) * (r0 + 10 * dpr));
          g.stroke();
        }
      }
      g.fillStyle = L.ok ? '#7ef0a0' : '#ffcf8a';
      g.font = `900 ${16 * dpr}px "Pretendard Variable", Pretendard, system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillText(L.ok ? '딱!' : L.err < 0 ? '빨라요' : '늦어요', zx + zw * 1.45, zy + 6 * dpr);
      g.globalAlpha = 1;
    }
  };
  draw();
  return () => { cancelAnimationFrame(timing.raf); off(); };
}

// 투구 연습 1단계: 조준판(실제 투구 화면과 같은 그림)을 눌렀다 떼면 성공.
function padStage(stage, api) {
  const box = document.createElement('div');
  box.className = 'tutPad';
  const cv = document.createElement('canvas');
  box.appendChild(cv);
  stage.appendChild(box);
  const a = { x: 0, y: 0 };
  let down = null;
  const set = (e) => {
    const r = box.getBoundingClientRect();
    a.x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
    a.y = clamp(1 - ((e.clientY - r.top) / r.height) * 2, -1, 1);
    drawPad(cv, a);
  };
  box.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    down = e.pointerId;
    try { box.setPointerCapture(e.pointerId); } catch (err) {}
    set(e);
  });
  box.addEventListener('pointermove', (e) => { if (e.pointerId === down) set(e); });
  const up = (e) => {
    if (e.pointerId !== down) return;
    down = null;
    api.signal('aim', { x: a.x, y: a.y, inside: Math.abs(a.x) <= ZX && Math.abs(a.y) <= ZY });
  };
  box.addEventListener('pointerup', up);
  box.addEventListener('pointercancel', up);
  requestAnimationFrame(() => drawPad(cv, a));
}

// 센서·자이로가 없는 폰: 투구 연습 단계 안에 구질 버튼을 띄웁니다.
function throwFallback(stage) {
  const row = document.createElement('div');
  row.className = 'tutTypes';
  row.hidden = true;
  row.innerHTML = Object.entries(PITCH_NAMES).map(([k, v]) => `<button type="button" class="tutBtn sm" data-type="${k}">${v}</button>`).join('');
  row.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const [lo, hi] = PRESET[b.dataset.type];
    tutPitch.signal('throw', { type: b.dataset.type, side: 1, speed: Math.round(lo + Math.random() * (hi - lo)) });
  });
  stage.appendChild(row);
  const t = setTimeout(() => { if (!gotMotion || noGyro()) row.hidden = false; }, SENSOR_WAIT);
  return () => clearTimeout(t);
}

const tutBat = createTutorial({
  key: 'baseball',
  socket,
  title: '처음이라 타격 연습해 봐요',
  steps: [
    { title: '방망이처럼 쥐기', body: '폰 아래쪽을 두 손으로 세로로 꽉 쥐어요.\n화면은 나를 보게요.', svg: 'hold', next: '쥐었어요' },
    { title: '휘둘러 보기', body: '타석에 선 것처럼 크게 휘둘러요.\n폰은 꼭 쥐고요!', svg: 'swing', waitFor: 'swing', count: 2,
      hint: '두 번 휘둘러요', render: (st) => swingFallback(st) },
    { title: '세게 치면 멀리', body: '세게 휘두를수록 공이 멀리 날아가요.', svg: 'swing', svgOpts: { from: -95, to: 70 }, waitFor: 'swing',
      hint: '힘껏 휘둘러요', okText: '좋아요! 멀리 가겠어요',
      check: (d) => d.power >= ps.pick({ easy: 0.3, normal: 0.36, hard: 0.42 }) || `조금 더 세게! (힘 ${Math.round(d.power * 100)}%)`,
      render: (st) => swingFallback(st, 0.95) },
    { title: '타이밍 맞추기', body: '링이 줄어들어 공에 닿는 순간 휘둘러요.', waitFor: 'swing', count: 2,
      hint: '링이 공에 닿을 때', check: judgeTiming, render: timingStage }
  ],
  finish: { title: '타격 연습 끝!', body: '이제 준비를 누르면 돼요.\n큰 화면에서 공이 홈플레이트에 닿을 때 휘둘러요.', button: '좋아요' }
});

const tutPitch = createTutorial({
  key: 'baseball-pitch',
  socket,
  title: '투타 대결 · 투구 연습',
  steps: [
    { title: '코스 정하기', body: '판을 눌러 던질 곳을 정하고 손을 떼요.\n가운데 네모 밖은 볼이에요.', waitFor: 'aim', hint: '눌렀다 떼요',
      check: (d) => ({ ok: true, msg: d.inside ? '스트라이크 코스예요' : '볼 코스예요 · 일부러 빼도 돼요' }), render: padStage },
    { title: '공 던지기', body: '폰을 세로로 꽉 쥔 채 큰 화면 쪽으로\n공 던지듯 팔을 휘둘러요. 폰은 놓지 마세요!', svg: 'cast', waitFor: 'throw',
      hint: '던져 보세요', check: (d) => ({ ok: true, msg: `${pitchName(d.type, d.side)} ${shownKmh(d.speed)}km/h` }), render: throwFallback },
    { title: '변화구 던져 보기', body: '놓는 순간 손목을 비틀면 슬라이더,\n앞으로 꺾으면 커브예요.', svg: 'twist', waitFor: 'throw',
      hint: '손목을 써서 던져요',
      check: (d) => (d.type !== 'fastball' ? { ok: true, msg: `${pitchName(d.type, d.side)}!` } : '직구였어요 · 손목을 비틀어 던져요'),
      render: throwFallback }
  ],
  finish: { title: '투구 연습 끝!', body: '내 투구 차례가 오면 폰이 울려요.\n코스를 정하고 던지면 돼요.', button: '좋아요' }
});

// 이 페이지에서 이미 띄운 연습(?tut=1 일 때 끝없이 다시 뜨지 않게)
const tutSeen = new Set();
// 연습은 대기실·경기 끝 화면에서만 띄웁니다. 경기 중에 들어왔으면 그 판이 끝난 뒤에 뜹니다.
function maybeTutorial() {
  if (!started || !me || tutBat.isRunning() || tutPitch.isRunning()) return;
  if (state.phase === 'playing') return;
  if (!tutSeen.has('bat') && tutBat.firstTime()) runTut(tutBat, 'bat');
  else if (state.mode === 'duel' && !tutSeen.has('pitch') && tutPitch.firstTime()) runTut(tutPitch, 'pitch');
}
async function runTut(t, name) {
  tutSeen.add(name);
  haptics.unlock();
  const r = await t.run();
  // 경기 중 내 차례가 와서 닫은 경우는 다음 대기실에서 다시 띄웁니다.
  if (r && r.cancelled) tutSeen.delete(name);
  render();
  setTimeout(maybeTutorial, 400);
}

// ---------- 준비(모두 준비해야 시작) ----------
const COLORS = { 1: '#ff5a5f', 2: '#3ab4ff', 3: '#ffc93c', 4: '#5ee07a' };
let readySt = null;
let readyPressed = false;
function paintReady() {
  const b = $('btnGo');
  const over = state.phase === 'over';
  b.classList.toggle('done', readyPressed);
  b.setAttribute('aria-pressed', readyPressed ? 'true' : 'false');
  b.innerHTML = readyPressed
    ? '<b>준비 완료 ✓</b><small>다른 사람을 기다려요</small>'
    : `<b>${over ? '다시 하기' : '준비'}</b><small>${over ? '모두 누르면 다음 판이 시작돼요' : '모두 준비하면 시작해요'}</small>`;
  // 누가 아직 준비 전인지
  const box = $('readyChips');
  const st = readySt;
  if (!st || !st.players || st.players.length < 2) {
    box.innerHTML = '';
    box.hidden = true;
    return;
  }
  box.hidden = false;
  // 큰 화면이 알려 주는 '연습 중' 자리(처음이라 튜토리얼을 하는 사람). 왜 기다리는지 보이게 합니다.
  const practicing = new Set(state.practicing || []);
  box.innerHTML = st.players.map((s) => {
    const on = st.ready.includes(s);
    const away = (st.away || []).includes(s);
    const mine = me && s === me.slot;
    const tut = !on && !away && practicing.has(s);
    return `<span class="chip${on ? ' on' : ''}${away ? ' away' : ''}${tut ? ' tut' : ''}" style="--pc:${COLORS[s] || '#8a96a8'}">` +
      `<b>${s}P${mine ? ' 나' : ''}</b>${on ? '✓' : away ? '끊김' : tut ? '연습 중' : '준비 전'}</span>`;
  }).join('');
}

// ---------- 화면 갱신 ----------
const LV_LABEL = { easy: '쉬움', normal: '보통', hard: '어려움' };
function render() {
  if (!me) return;
  const duel = state.mode === 'duel';
  // 머리줄: 방 코드 옆에 지금 난이도(경기 중에도 보임)
  const lv = ps.difficulty();
  $('lv').textContent = LV_LABEL[lv] || '';
  $('lv').dataset.lv = lv;
  role = duel && state.phase === 'playing' ? (state.roles && state.roles[me.slot]) || roleHint || 'wait' : null;
  if (curView === 'vPlay' || curView === 'vPitch') show(role === 'pitch' ? 'vPitch' : 'vPlay');
  const phase = state.phase;
  const myTurn = state.batter === me.slot;
  // 경기 중 내 차례가 오면 하던 연습은 닫습니다(다음 대기실에서 다시 떠요).
  if (phase === 'playing' && (myTurn || role === 'pitch')) {
    if (tutBat.isRunning()) tutBat.cancel();
    if (tutPitch.isRunning()) tutPitch.cancel();
  }
  const pre = phase === 'lobby' || phase === 'over';
  document.body.classList.toggle('pre', pre);
  tutBat.setLinkVisible(pre);
  tutPitch.setLinkVisible(pre && duel);
  if (role === 'pitch') {
    renderPitch();
    return;
  }
  $('lobbyBox').classList.toggle('hidden', !pre);
  $('meter').classList.toggle('hidden', pre);
  $('btnTest').classList.toggle('hidden', pre || !noSensor);
  $('derbyStats').classList.toggle('hidden', duel || phase === 'lobby');
  $('duelStats').classList.toggle('hidden', !duel || phase === 'lobby');
  paintReady();
  if (duel) {
    const c = state.count || {};
    const mine = (state.score || {})[me.slot];
    $('dCount').textContent = myTurn ? `${c.b || 0}-${c.s || 0}` : '-';
    $('dOut').textContent = myTurn ? c.o || 0 : '-';
    $('dRuns').textContent = mine ? mine.r : 0;
  } else {
    const mine = (state.scores || {})[me.slot];
    $('sHr').textContent = mine ? mine.hr : 0;
    $('sLong').textContent = mine && mine.longest ? `${mine.longest}m` : '-';
    $('sLeft').textContent = myTurn && state.left != null ? state.left : '-';
  }
  if (phase === 'lobby') {
    if (!$('result').dataset.keep) $('result').textContent = '대기실';
    $('hint').textContent = duel && playerCount < 2
      ? '투타 대결은 2명부터예요.\n한 명 더 들어오면 준비하세요.'
      : '난이도와 모드를 고르고 준비를 누르세요.';
  } else if (phase === 'over') {
    $('result').textContent = '경기 끝';
    $('hint').textContent = '큰 화면에서 순위를 확인하세요.';
  } else if (myTurn) {
    if (!$('result').dataset.keep) $('result').textContent = '내 차례!';
    $('hint').textContent = duel ? `${nameOf(state.pitcher)} 투수의 공이 오면 휘두르세요. 존 밖 공은 참으면 볼이에요.` : '투수가 공을 던지면 휘두르세요.';
  } else if (duel) {
    if (!$('result').dataset.keep) $('result').textContent = state.batter ? `${nameOf(state.batter)} 타석` : '대기';
    $('hint').textContent = !(state.roles && Object.hasOwn(state.roles, me.slot))
      ? '진행 중인 투타 대결을 관전해요. 다음 경기부터 참가합니다.'
      : state.pitcher ? `${nameOf(state.pitcher)} 투구 중 · 내 차례를 기다려요.` : '내 차례를 기다려요.';
  } else {
    $('result').textContent = state.batter ? `${state.batter}P 차례` : '대기';
    $('hint').textContent = '내 차례를 기다려요.';
  }
}

socket.on('connect', () => {
  measureRtt();
  socket.emit('join', { role: 'controller', room: ROOM, token });
});
socket.on('assigned', (p) => {
  // 다른 종목 방이면 그 종목의 컨트롤러로 보냅니다.
  if (p.game && p.game !== 'baseball') {
    location.replace(`/play/${p.game}/?room=${ROOM}`);
    return;
  }
  me = p;
  noRoomTries = 0;
  // 다시 붙으면 서버가 마지막 상태(같은 공 번호일 수 있음)를 다시 보냅니다. 못 보낸 공을 다시 던질 수 있게 잊습니다.
  // 이미 큰 화면에 닿은 공이면 큰 화면이 같은 번호를 다시 받지 않습니다(game.js onThrow).
  thrownN = null;
  document.documentElement.style.setProperty('--c', p.color);
  $('badge').textContent = p.name;
  show('vPlay');
  render();
});
socket.on('no_room', () => {
  // 서버가 막 다시 떴으면 큰 화면이 같은 코드로 방을 다시 만들 때까지 잠깐 기다립니다.
  if (noRoomTries++ < 15) {
    message('방에 다시 연결하는 중', '잠시만 기다려 주세요.');
    setTimeout(() => socket.connected && socket.emit('join', { role: 'controller', room: ROOM, token }), 2000);
    return;
  }
  message('방을 찾을 수 없어요', '큰 화면의 QR을 다시 찍어 주세요.');
});
socket.on('room_full', () => message('4명이 꽉 찼어요', '빈자리가 생기면 다시 찍어 주세요.'));
socket.on('replaced', () => message('다른 탭에서 열었어요', '마지막으로 연 화면에서 조작해요.'));
socket.on('room_closed', () => message('방이 닫혔어요', '큰 화면의 새 QR을 찍어 주세요.'));
socket.on('display_status', ({ connected }) => {
  if (!connected && me) $('hint').textContent = '큰 화면이 꺼져 있어요.';
});
socket.on('game_state', (s) => {
  const prevN = state.n;
  const prevPhase = state.phase;
  state = s;
  // 경기 밖에서는 지난 경기의 투구 번호·역할을 잊습니다(새 경기도 1번 공부터 셉니다).
  if (s.phase !== 'playing') {
    thrownN = null;
    roleHint = null;
  }
  // 경기가 시작되거나 대기실로 돌아가면 준비 표시를 지웁니다(서버도 지움).
  if (s.phase !== prevPhase && (s.phase === 'playing' || s.phase === 'lobby')) readyPressed = false;
  // 투타 대결은 공마다 상태가 자주 와서, 결과 글자는 시간이 지나야 지웁니다.
  if (s.mode !== 'duel' || s.phase !== 'playing') delete $('result').dataset.keep;
  render();
  maybeTutorial();
  // 새 공을 기다리면 투수 폰을 짧게 울려 알립니다.
  if (role === 'pitch' && canThrow() && prevN !== s.n) haptics.buzz([30, 40, 30]);
});
// 모두 준비 현황(서버). 내 준비 표시와 아직 준비 전인 사람을 보여 줍니다.
socket.on('ready_state', (st) => {
  readySt = st;
  readyPressed = Boolean(me && st && st.ready && st.ready.includes(me.slot));
  if (me) paintReady();
});
socket.on('role', (r) => {
  roleHint = r && r.role;
  render();
});
socket.on('players', (p) => {
  playerCount = ((p && p.players) || []).filter((x) => x.connected).length;
  if (state.mode === 'duel' && state.phase === 'lobby') render();
});
socket.on('pitch', (p) => {
  $('result').dataset.keep = '1';
  $('result').textContent = p.label || '투구!';
  // 공이 손을 떠났어요: 아주 짧게
  haptics.play('tick', 1, { pattern: [18] });
});
let rKeep = 0;
socket.on('result', (r) => {
  if (role === 'pitch') {
    pitchMsg(r.text, 2000);
    return;
  }
  const k = ++rKeep;
  $('result').dataset.keep = '1';
  $('result').textContent = r.text;
  if (r.contact) {
    // 진동은 큰 화면이 같은 순간 haptic 으로 보냅니다. 여기서는 타구음과 화면 번쩍임.
    crack(r.quality || 0.5);
    flashBody();
  }
  setTimeout(() => {
    if (k !== rKeep) return;
    delete $('result').dataset.keep;
    if (state.mode === 'duel' || state.phase === 'lobby') render();
  }, 2500);
});

// 센서가 없는 폰(1.5초 동안 값이 없음)
let noSensor = false;
$('btnStart').addEventListener('click', async () => {
  // 화면 꺼짐 방지와 권한 요청은 탭 안에서 await 전에 바로 불러야 iPhone 에서 통합니다.
  keepAwake();
  audio();
  haptics.unlock();
  // iPhone 은 탭 안에서 바로 권한을 물어야 합니다.
  const DM = window.DeviceMotionEvent;
  if (DM && typeof DM.requestPermission === 'function') {
    // 거절돼도 버튼 스윙으로는 할 수 있게 계속 진행합니다.
    let res = 'denied';
    try { res = await DM.requestPermission(); } catch (e) {}
    if (res !== 'granted') {
      noSensor = true;
      $('btnTest').textContent = '동작 권한이 없어요 · 눌러서 스윙';
      $('sensorHelp').classList.remove('hidden');
      $('pTypes').classList.remove('hidden');
    }
  }
  window.addEventListener('devicemotion', onMotion);
  window.addEventListener('devicemotion', onPitchMotion);
  started = true;
  if (!ROOM) { message('방 코드가 없어요', '큰 화면의 QR을 찍어 주세요.'); return; }
  socket.connect();
  // 1.5초 동안 센서 값이 안 들어오면(PC, http 주소) 버튼으로 스윙합니다.
  // 투수 차례에는 구질 버튼으로 던집니다.
  setTimeout(() => {
    if (gotMotion) return;
    noSensor = true;
    $('pTypes').classList.remove('hidden');
    render();
  }, SENSOR_WAIT);
});
$('btnGo').addEventListener('click', () => {
  keepAwake();
  audio();
  // 서버에는 준비 취소가 없어서, 누른 뒤에는 다음 판이 시작될 때까지 그대로 둡니다.
  if (readyPressed) {
    haptics.tick();
    return;
  }
  if (!send('start_game', {})) return;
  readyPressed = true;
  haptics.play('success', 1, { noFlash: true });
  paintReady();
});
$('btnTest').addEventListener('click', () => sendSwing(0.85, 0, 0));
for (const b of document.querySelectorAll('#pTypes button')) {
  b.addEventListener('click', () => {
    // 자이로가 없는 폰: 구질만 고르고 던지는 건 폰을 휘둘러서 합니다.
    if (noGyro()) {
      pickType = b.dataset.type;
      pitchMsg(`${PITCH_NAMES[pickType]} · 던지세요`, 1500);
      renderPitch();
      return;
    }
    const [lo, hi] = PRESET[b.dataset.type];
    sendThrow(b.dataset.type, Math.round(lo + Math.random() * (hi - lo)), 1, 0, 0);
  });
}

// 대기 화면: 난이도·모드 알약, 준비 버튼 막기(물어볼 항목이 생기면), 튜토리얼 다시 하기
ps.mount($('setBox'));
ps.bindReady($('btnGo'));
ps.onChange(() => { if (me) render(); });
tutBat.link($('tutLinks'), { before: () => !tutPitch.isRunning() });
tutPitch.link($('tutLinks'), { label: '투구 연습 다시 하기', before: () => !tutBat.isRunning() });
tutBat.setLinkVisible(false);
tutPitch.setLinkVisible(false);

if (DEBUG) $('dbg').classList.remove('hidden');
// 시험용: 콘솔에서 구질 판정과 축 보정을 바로 볼 수 있게 둡니다.
window.__pitch = { PT, CAL, AXMAPS, cal, calStep, devAxes, axesSure, classifyThrow, throwSpeed, throwFeatures,
  aim, aimSet, sendThrow, state: () => state, role: () => role };
// 시험용: 스윙·연습·설정
window.__bat = { ps, tutBat, tutPitch, sendSwing, judgeTiming, swingCfg, timing, maybeTutorial,
  state: () => state, ready: () => ({ readyPressed, readySt }) };
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && started && navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
});
