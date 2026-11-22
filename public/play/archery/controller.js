// 양궁 컨트롤러. 폰이 활입니다.
// 폰을 활처럼 세워 큰 화면을 겨누면(deviceorientation → 기준 자세는 저절로 잡힘) 조준(도)을 aim {x, y} 로 보냅니다.
// 화면의 시위를 아래로 끌면 draw {pull 0..1}, 손을 떼면 release {x, y, pull, steady} 로 쏩니다.
// 세워 쥐면 폰 뒷면이, 눕혀 쥐면 윗부분이 겨누는 방향입니다(기준을 잡는 순간 자세로 판단).
// 기준 자세: 센서가 처음 들어올 때와 내 차례가 시작될 때 저절로 잡고, 조준이 많이 벗어난 채로 시위를 누르면 그 자세로 다시 잡습니다.
// 따로 맞추는 화면은 없고, 위쪽 '다시 맞추기' 로 언제든 다시 잡을 수 있습니다.
// 시위를 끄는 대신 '바로 쏘기' 버튼으로도 똑같이 쏠 수 있습니다.
// 센서가 없는 PC 에서는 조준 판을 끌어서 겨누고, 시위 영역을 끌거나 스페이스를 눌러 당겼다 뗍니다.
//
// 공통 모듈: haptics(당김 틱·놓는 쿵·10점 패턴·심박), phone-settings(난이도 알약), tutorial(원할 때만 하는 연습 2단계)
import { haptics } from '/common/haptics.js';
import { createPhoneSettings } from '/common/phone-settings.js';
import { createTutorial } from '/common/tutorial.js';
import { FULL_PULL } from '/archery/ballistics.mjs'; // 큰 화면과 같은 만궁 기준
import { t, mountSwitcher } from '/common/i18n.js';

const $ = (id) => document.getElementById(id);
const RD = Math.PI / 180;
const params = new URLSearchParams(location.search);
const ROOM = (params.get('room') || '').toUpperCase();
const DEBUG = params.has('debug');
$('room').textContent = ROOM ? t('방 {c}', { c: ROOM }) : '';
// 언어 고르기: 시작 화면에서만 보임(바꾸면 새로 고침)
mountSwitcher($('langBox'), { reload: true, compact: true });

// ---------- 조정 값 (실폰 검증 전이라 바뀔 수 있습니다) ----------
const AIM_MS = 33; // aim·draw 전송 간격, 약 30Hz
const SMOOTH = 0.5; // 센서 값 다듬기(0~1, 클수록 빠르게 따라감)
const PAD_RANGE = 7; // 센서 없는 PC: 조준 판 가장자리 = 이 각도(도)
const DRAW_FRAC = 0.35; // 시위 영역 높이의 이만큼 끌면 만궁(예전 0.62)
const DRAW_MIN_PX = 80; // 시위 끌기 최소 거리(예전 120px)
const MIN_PULL = 0.15; // 이보다 약하게 당기고 놓으면 쏘지 않고 알려 줍니다(큰 화면의 MIN_PULL 과 같은 값, 예전 0.25)
const RECENTER_DEG = 8; // 시위를 누를 때 조준이 이만큼(도) 넘게 벗어나 있으면 그 자세를 가운데로 다시 잡음
const AIM_LOOKBACK_MS = 110; // 손가락을 뗄 때의 폰 흔들림을 피해 이만큼 전 조준을 씁니다
const STEADY_WINDOW_MS = 250; // 놓기 전 이 시간 동안의 흔들림으로 안정도(steady)를 계산(예전 450)
const STEADY_RMS = { easy: 1.5, normal: 1.0, hard: 0.5 }; // 이만큼(도) 흔들렸으면 steady = 0 (예전 0.5 = 어려움 값)
const STEADY_DEFAULT = 0.95; // 기록이 모자랄 때(예전 0.85)
const BUTTON_STEADY = 0.9; // '바로 쏘기' 버튼은 (쉬움·보통에서) 이 이상의 안정도로 쏨: 버튼을 누르다 폰이 흔들려도 봐줌
const CAL_BACK_MS = 120;
const CAL_SPAN_MS = 280;
const SENSOR_WAIT_MS = 1500; // 이 시간 안에 동작 센서 값이 없으면 버튼 모드
const AIM_LIMIT = 30;
const COLORS = { 1: '#ff5a5f', 2: '#3ab4ff', 3: '#ffc93c', 4: '#5ee07a' };
const DIFF_LABEL = { easy: '쉬움', normal: '보통', hard: '어려움' };
const PLAY_URL = (g) => (g === 'baseball' ? '/play/' : `/play/${g}/`);

let token = null;
try { token = localStorage.getItem('pcg-token'); } catch (e) {}
if (!token) {
  token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try { localStorage.setItem('pcg-token', token); } catch (e) {}
}
const socket = io({ autoConnect: false, transports: ['websocket', 'polling'], tryAllTransports: true });
function send(event, data, volatile) {
  if (!socket.connected) return false;
  (volatile ? socket.volatile : socket).emit('c2d', { event, data });
  return true;
}
const isTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
let me = null;
let state = { phase: 'lobby' };
let roster = [];
let mode = 'start'; // start | connecting | msg | wait | cal | play | idle | tut
let gotOri = false;
let fallback = false;
let permDenied = false;
let pendingCal = false;
let noRoomTries = 0;
let helpOn = false;
let readyList = [];
let readyInfo = null;
let lastResult = null;
let cueText = '';
let cueTimer = null;

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const r3 = (v) => Math.round(v * 1000) / 1000;

function show(id) {
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === id);
  $('btnRecal').classList.toggle('hidden', !(id === 'vPlay' && gotOri && !fallback));
}
function message(t, b, btn) {
  helpOn = false;
  mode = 'msg';
  $('msgT').textContent = t;
  $('msgB').textContent = b || '';
  $('btnMsg').classList.toggle('hidden', !btn);
  if (btn) { $('btnMsg').textContent = btn.label; $('btnMsg').onclick = btn.onClick; }
  show('vMsg');
}
function banner(text) {
  $('banner').textContent = text || '';
  $('banner').classList.toggle('hidden', !text);
}

// ---------- 공통: 난이도 알약 · 손맛 ----------
const ps = createPhoneSettings();
ps.attach(socket);
ps.mount($('setBox'));
ps.bindReady($('btnGo'));
ps.onChange(() => paintDiff());
function paintDiff() {
  const d = ps.difficulty();
  const e = $('dTag');
  e.textContent = DIFF_LABEL[d] || '쉬움';
  e.dataset.d = d;
}
function flash(kind) {
  const f = $('flash');
  f.className = '';
  void f.offsetWidth;
  f.className = `go ${kind}`;
}
// 느낌: 당기기 시작/단계 = 아주 짧은 틱, 만궁 = 또렷한 틱, 놓기 = 쿵, 10점 = 무늬
function feel(kind, v) {
  switch (kind) {
    case 'step': haptics.tick(); break;
    case 'full': haptics.play('strong', 0.9, { noFlash: true }); break;
    case 'loose': haptics.buzz([40, 20, 24], { noFlash: true }); flash('loose'); break;
    case 'turn': haptics.buzz([35, 40, 35], { noFlash: true }); break;
    case 'x': haptics.buzz([50, 40, 50, 40, 140], { noFlash: true }); flash('ten'); break;
    case 'good': haptics.play('good', 0.8, { noFlash: true }); flash('good'); break;
    case 'miss': haptics.play('miss', 0.6, { noFlash: true }); break;
    case 'cal': haptics.buzz([30, 40, 30], { noFlash: true }); break;
    case 'win': haptics.buzz([80, 60, 80, 60, 240], { noFlash: true }); flash('ten'); break;
    default: break;
  }
  void v;
}

// ---------- 작은 벡터·사원수 계산(다른 종목과 같은 변환) ----------
function qFromEuler(x, y, z) {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
}
function qRot(q, v) {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function deviceVectors(alpha, beta, gamma) {
  const q = qFromEuler(beta * RD, alpha * RD, -gamma * RD);
  return { top: qRot(q, [0, 0, -1]), face: qRot(q, [0, 1, 0]) };
}

// ---------- 조준 기준(중앙 맞추기) ----------
let basis = null;
const pointer = (b, top, face) => (b.back ? [-face[0], -face[1], -face[2]] : top);
function makeBasis(top, face) {
  const back = top[1] > 0.75; // 세워 쥐면(활 자세) 뒷면이 겨눔
  const p0 = back ? [-face[0], -face[1], -face[2]] : top;
  let f = [p0[0], 0, p0[2]];
  if (Math.hypot(f[0], f[2]) < 0.2) f = [-face[0], 0, -face[2]];
  if (Math.hypot(f[0], f[2]) < 0.2) f = [0, 0, -1];
  f = norm(f);
  return { r: norm(cross(f, [0, 1, 0])), u: [0, 1, 0], f, pitch0: Math.asin(clamp(p0[1], -1, 1)), back };
}
// 반환: 중앙에서 벗어난 각도(도). x 오른쪽 +, y 위 +
function aimDegOf(b, top, face) {
  const p = pointer(b, top, face);
  const v = [dot(p, b.r), dot(p, b.u), dot(p, b.f)];
  const yaw = Math.atan2(v[0], v[2]) / RD;
  const pitch = (Math.asin(clamp(v[1], -1, 1)) - b.pitch0) / RD;
  return { x: yaw, y: pitch };
}

// ---------- 센서 ----------
let ori = null;
const oriBuf = [];
let nextSendAt = 0;
let oriCount = 0;
const cur = { x: 0, y: 0 }; // 지금 조준(도) = 보내는 값
const hist = []; // { t, x, y } 최근 조준 기록(놓을 때 되돌아보기·안정도)
function evTime(e) {
  const n = performance.now();
  const ts = e && e.timeStamp;
  return ts > 0 && Math.abs(n - ts) < 1000 ? ts : n;
}
function recordAim(t) {
  hist.push({ t, x: cur.x, y: cur.y });
  while (hist.length && hist[0].t < t - 900) hist.shift();
}
const myTurn = () => Boolean(me && state.phase === 'playing' && state.stage === 'turn' && state.current === me.slot);
const streaming = () => basis && me && state.phase === 'playing' && myTurn() && (mode === 'play');
function onOrientation(e) {
  if (e.alpha == null && e.beta == null) return;
  const t = evTime(e);
  oriCount += 1;
  ori = deviceVectors(e.alpha || 0, e.beta || 0, e.gamma || 0);
  oriBuf.push({ t, top: ori.top, face: ori.face });
  while (oriBuf.length && oriBuf[0].t < t - 700) oriBuf.shift();
  if (!gotOri) { gotOri = true; fallback = false; if (!basis) captureBasis(true); sensorsChanged(); }
  if (fallback || !basis || basis.fake) return;
  const a = aimDegOf(basis, ori.top, ori.face);
  cur.x = clamp(cur.x + (a.x - cur.x) * SMOOTH, -AIM_LIMIT, AIM_LIMIT);
  cur.y = clamp(cur.y + (a.y - cur.y) * SMOOTH, -AIM_LIMIT, AIM_LIMIT);
  recordAim(t);
  if (streaming() && t >= nextSendAt) {
    nextSendAt = Math.max(nextSendAt + AIM_MS, t + AIM_MS * 0.4);
    send('aim', { x: r3(cur.x), y: r3(cur.y) }, true);
  }
}

// ---------- 센서 없는 PC: 조준 판을 끌어서 겨눔 ----------
let fakeTimer = null;
const FAKE = { x: 0, y: 0 };
function startFake() {
  if (fakeTimer) return;
  basis = { fake: true };
  if (me) announceCal(); else pendingCal = true;
  fakeTimer = setInterval(() => {
    cur.x = FAKE.x;
    cur.y = FAKE.y;
    recordAim(performance.now());
    if (streaming()) send('aim', { x: r3(cur.x), y: r3(cur.y) }, true);
    drawSightDot();
  }, AIM_MS);
}
function drawSightDot() {
  const el = $('sightDot');
  const s = $('sight');
  if (!el || !s.clientWidth) return;
  el.style.left = `${50 + clamp(cur.x / PAD_RANGE, -1, 1) * 46}%`;
  el.style.top = `${50 - clamp(cur.y / PAD_RANGE, -1, 1) * 46}%`;
}
// 끌어서 조준하는 둥근 판(경기 중 #sight, 튜토리얼 판에도 씁니다)
function dragAim(el) {
  let down = false;
  const set = (e) => {
    const r = el.getBoundingClientRect();
    FAKE.x = clamp(((e.clientX - r.left) / r.width - 0.5) * 2 * PAD_RANGE, -PAD_RANGE * 1.2, PAD_RANGE * 1.2);
    FAKE.y = clamp(-((e.clientY - r.top) / r.height - 0.5) * 2 * PAD_RANGE, -PAD_RANGE * 1.2, PAD_RANGE * 1.2);
  };
  el.addEventListener('pointerdown', (e) => { if (!fallback) return; down = true; try { el.setPointerCapture(e.pointerId); } catch (x) {} set(e); });
  el.addEventListener('pointermove', (e) => { if (down) set(e); });
  const up = () => { down = false; };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}
dragAim($('sight'));

// ---------- 활: 시위 그리기와 당김 입력 ----------
const SVGNS = 'http://www.w3.org/2000/svg';
function makeBowPad(zone, o = {}) {
  zone.innerHTML = `<svg viewBox="0 0 200 300" preserveAspectRatio="xMidYMid meet">
    <path class="limb" d="" data-k="limbL"/><path class="limb" d="" data-k="limbR"/>
    <path class="limb2" d="" data-k="accL"/><path class="limb2" d="" data-k="accR"/>
    <rect class="riser" x="91" y="22" width="18" height="34" rx="6"/>
    <line class="fullmark" x1="26" x2="174" data-k="fullmark"/>
    <path class="str" d="" data-k="str"/>
    <line class="shaft" x1="100" x2="100" y1="0" y2="0" data-k="shaft"/>
    <path class="vane" d="" data-k="vane"/>
    <path d="M94 24L100 6L106 24Z" fill="#e5e9ee" data-k="head"/>
    <circle class="nockdot" r="9" cx="100" cy="86" data-k="nock"/>
    <text class="pulltxt" x="100" y="0" data-k="txt"></text>
  </svg><div class="hint" data-k="hint"></div>`;
  const q = (k) => zone.querySelector(`[data-k="${k}"]`);
  const el = { limbL: q('limbL'), limbR: q('limbR'), accL: q('accL'), accR: q('accR'), str: q('str'), shaft: q('shaft'), vane: q('vane'), nock: q('nock'), txt: q('txt'), fullmark: q('fullmark'), hint: q('hint'), head: q('head') };
  const TIP_Y = 88;
  const MAXPULL_Y = 170;
  const fullY = TIP_Y + FULL_PULL * MAXPULL_Y;
  el.fullmark.setAttribute('y1', fullY);
  el.fullmark.setAttribute('y2', fullY);
  const pad = { pull: 0, down: false, enabled: true };
  function paint(pull) {
    pad.pull = pull;
    const tx = 26 + 16 * pull;
    const ty = TIP_Y - 10 * pull;
    const ny = TIP_Y + pull * MAXPULL_Y;
    const L = `M96 38C70 36 ${tx + 26} ${ty - 36} ${tx} ${ty}`;
    const R = `M104 38C130 36 ${200 - tx - 26} ${ty - 36} ${200 - tx} ${ty}`;
    el.limbL.setAttribute('d', L); el.limbR.setAttribute('d', R);
    el.accL.setAttribute('d', L); el.accR.setAttribute('d', R);
    el.str.setAttribute('d', `M${tx} ${ty}L100 ${ny}L${200 - tx} ${ty}`);
    el.nock.setAttribute('cy', ny);
    el.shaft.setAttribute('y1', ny - 2);
    el.shaft.setAttribute('y2', 14);
    el.vane.setAttribute('d', `M100 ${ny - 4}l-9 -14l9 4l9 -4z`);
    el.txt.setAttribute('y', Math.min(292, ny + 30));
    el.txt.textContent = pull > 0.02 ? `${Math.round(pull * 100)}%` : '';
    zone.classList.toggle('full', pull >= FULL_PULL);
  }
  paint(0);
  let y0 = 0;
  let lastSend = 0;
  const drawPx = () => Math.max(DRAW_MIN_PX, zone.getBoundingClientRect().height * DRAW_FRAC);
  zone.addEventListener('pointerdown', (e) => {
    if (!pad.enabled || (o.canStart && !o.canStart())) { if (o.onBlocked) o.onBlocked(); return; }
    e.preventDefault();
    pad.down = true;
    y0 = e.clientY;
    try { zone.setPointerCapture(e.pointerId); } catch (x) {}
    if (o.onStart) o.onStart();
  });
  zone.addEventListener('pointermove', (e) => {
    if (!pad.down) return;
    const p = clamp((e.clientY - y0) / drawPx(), 0, 1);
    paint(p);
    const now = performance.now();
    if (o.onPull) o.onPull(p, now - lastSend >= AIM_MS);
    if (now - lastSend >= AIM_MS) lastSend = now;
  });
  const end = (e) => {
    if (!pad.down) return;
    pad.down = false;
    const p = pad.pull;
    paint(0);
    if (o.onRelease) o.onRelease(p);
  };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
  pad.paint = paint;
  pad.setHint = (t) => { el.hint.textContent = t || ''; };
  pad.setEnabled = (on) => { pad.enabled = on; zone.classList.toggle('off', !on); zone.classList.toggle('mine', on); };
  pad.cancel = () => { pad.down = false; paint(0); };
  pad.simulate = (p) => paint(p); // 시험용: 키보드로 당김 흉내
  return pad;
}

// ---------- 경기 중 조작 ----------
let drawSent = 0;
let drawStepSent = 0;
let fullSent = false;
let drawAt = 0;
const pad = makeBowPad($('bowZone'), {
  canStart: () => myTurn(),
  onBlocked: () => blocked(),
  onStart: () => { maybeRecenter(); drawSent = 0; drawStepSent = 0; fullSent = false; drawAt = performance.now(); feel('step'); send('draw', { pull: 0.01 }, true); },
  onPull: (p, due) => {
    const step = Math.floor(p * 4);
    if (step > drawStepSent) { drawStepSent = step; feel('step'); }
    if (p >= FULL_PULL && !fullSent) { fullSent = true; feel('full'); }
    if (p < FULL_PULL - 0.1) fullSent = false;
    if (due) send('draw', { pull: r3(p) }, true);
    drawSent = p;
    paintHint(p);
  },
  onRelease: (p) => doRelease(p)
});
// 내 차례가 아닐 때 눌렀거나 쏠 수 없을 때: 조용히 무시하지 않고 짧게 알려 줍니다
function blocked() {
  haptics.tick();
  setStatusTemp(me && state.phase === 'playing' && state.stage === 'turn' ? '지금은 못 쏴요' : '내 차례가 아니에요');
}
// 시위를 누를 때 조준이 크게 벗어나 있으면(폰을 내려 든 채 차례가 시작됐을 때 등) 지금 자세를 가운데로 다시 잡습니다
function maybeRecenter() {
  if (fallback || !gotOri || mode !== 'play' || basis && basis.fake) return;
  if (Math.hypot(cur.x, cur.y) <= RECENTER_DEG) return;
  if (captureBasis(true)) setStatusTemp('가운데를 다시 잡았어요');
}
const steadyRmsNow = () => STEADY_RMS[state.difficulty || ps.difficulty()] || STEADY_RMS.easy;
function steadyNow(t) {
  if (fallback || !basis || basis.fake) return 1; // 센서 없이 끌어서 겨눌 때는 흔들림이 없음
  const w = hist.filter((h) => h.t >= t - STEADY_WINDOW_MS - AIM_LOOKBACK_MS && h.t <= t - AIM_LOOKBACK_MS);
  if (w.length < 3) return STEADY_DEFAULT;
  const mx = w.reduce((s, h) => s + h.x, 0) / w.length;
  const my = w.reduce((s, h) => s + h.y, 0) / w.length;
  const rms = Math.sqrt(w.reduce((s, h) => s + (h.x - mx) ** 2 + (h.y - my) ** 2, 0) / w.length);
  return clamp(1 - rms / steadyRmsNow(), 0, 1);
}
function aimBefore(t) {
  // 놓는 순간 이전(AIM_LOOKBACK_MS 전)의 조준
  const target = t - AIM_LOOKBACK_MS;
  let best = hist.length ? hist[hist.length - 1] : { x: cur.x, y: cur.y };
  for (let i = hist.length - 1; i >= 0; i--) { if (hist[i].t <= target) { best = hist[i]; break; } }
  return best;
}
function doRelease(p, byButton) {
  const now = performance.now();
  const a = aimBefore(now);
  let steady = steadyNow(now);
  if (byButton && steadyRmsNow() > STEADY_RMS.hard) steady = Math.max(steady, BUTTON_STEADY);
  const rel = { x: r3(a.x), y: r3(a.y), pull: r3(p), steady: r3(steady) };
  if (mode === 'tut' && tutStepId()) {
    // 튜토리얼 안에서의 놓기는 판정만 하고 큰 화면에는 보내지 않음
    feel(p >= FULL_PULL ? 'loose' : 'step');
    tut.signal('loosed', rel);
    return;
  }
  send('draw', { pull: 0 }, true);
  if (p < MIN_PULL) { feel('step'); setStatusTemp('더 당겨요'); return; }
  if (!send('release', rel)) { haptics.tick(); setStatusTemp('연결이 끊겼어요'); return; }
  feel('loose');
  setStatusTemp('발사!');
}
function paintHint(p) {
  pad.setHint(p >= FULL_PULL ? '만궁! 손을 떼요' : p > 0.04 ? '더 당겨요' : '');
}

// ---------- 연습(튜토리얼): 원할 때만 하는 2단계(당기기 → 놓기). 저절로 시작하지 않음 ----------
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const svgArt = (inner) => `<svg class="pcgt-svg" viewBox="0 0 200 160" aria-hidden="true">${inner}</svg>`;
const ART = {
  // 시위를 아래로 당기는 모습
  draw: () => svgArt(
    '<path d="M60 40Q100 20 140 40" class="pcgt-arc" style="stroke-width:4"/><rect x="94" y="22" width="12" height="20" rx="4" class="pcgt-ph"/>' +
    '<path d="M60 40L100 60L140 40" class="pcgt-arrow" fill="none"><animate attributeName="d" values="M60 40L100 60L140 40;M64 38L100 128L136 38;M60 40L100 60L140 40" dur="2s" repeatCount="indefinite"/></path>' +
    '<circle cx="100" cy="60" r="7" class="pcgt-ring"><animate attributeName="cy" values="60;128;60" dur="2s" repeatCount="indefinite"/></circle>' +
    '<path d="M100 20L100 128" stroke="#fff" stroke-width="2" stroke-dasharray="3 5" opacity=".5"/>'
  ),
  // 끝까지 당겼다가 손을 떼는 모습
  loose: () => svgArt(
    '<path d="M60 40Q100 20 140 40" class="pcgt-arc" style="stroke-width:4"/><rect x="94" y="22" width="12" height="20" rx="4" class="pcgt-ph"/>' +
    '<path d="M64 38L100 118L136 38" class="pcgt-arrow" fill="none"><animate attributeName="d" values="M64 38L100 118L136 38;M64 38L100 118L136 38;M60 40L100 44L140 40;M60 40L100 44L140 40" keyTimes="0;.55;.62;1" dur="2.2s" repeatCount="indefinite"/></path>' +
    '<g><animateTransform attributeName="transform" type="translate" values="0 0;0 0;0 -110;0 -110" keyTimes="0;.55;.8;1" dur="2.2s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;1;1;0" keyTimes="0;.55;.8;1" dur="2.2s" repeatCount="indefinite"/>' +
    '<path d="M100 116V48" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M95 52L100 42L105 52Z" fill="#fff"/></g>'
  )
};
let tutAuto = false;
const tutStepId = () => { const c = tut.current(); return c ? c.id : null; };
function compact(stage) { const card = stage.closest('.pcgt-card'); if (card) card.classList.add('gt-compact'); }
function stageDraw(stage, api, needRelease) {
  compact(stage);
  const wrap = el('div', 'gt-col');
  const box = el('div', 'gt-bow');
  const zone = el('div', 'bowzone mine');
  box.appendChild(zone);
  wrap.appendChild(box);
  stage.appendChild(wrap);
  let fullAnnounced = false;
  const tp = makeBowPad(zone, {
    onStart: () => { fullAnnounced = false; feel('step'); },
    onPull: (p) => {
      if (p >= FULL_PULL && !fullAnnounced) {
        fullAnnounced = true;
        feel('full');
        if (!needRelease) tut.signal('full', { pull: p });
      }
      if (p < FULL_PULL - 0.1) fullAnnounced = false;
      tp.setHint(p >= FULL_PULL ? (needRelease ? '손을 떼요!' : '만궁!') : p > 0.04 ? '더 당겨요' : '');
    },
    onRelease: (p) => {
      if (needRelease) { feel(p >= FULL_PULL ? 'loose' : 'step'); tut.signal('loosed', { pull: p }); }
    }
  });
  tp.setHint('아래로 끌어요');
  return () => { tp.cancel(); };
}
const tut = createTutorial({
  key: 'archery',
  socket,
  steps: [
    { id: 'draw', title: '당기기', body: '아래로 끌어요.', svg: ART.draw, waitFor: 'full', hint: '끝까지 끌기', render: (st, api) => stageDraw(st, api, false) },
    {
      id: 'loose', title: '놓기', body: '당긴 채 손을 떼요.', svg: ART.loose, waitFor: 'loosed', hint: '손 떼기',
      render: (st, api) => stageDraw(st, api, true),
      check: (d) => (d && d.pull >= FULL_PULL ? true : '더 당겨요')
    }
  ],
  onDone: () => endTut()
});
tut.link($('tutLink'), {
  before: () => {
    if (state.phase === 'playing' || !me) return false;
    enterTut();
    return true;
  }
});
function enterTut() { if (fallback) startFake(); mode = 'tut'; }
function startTutorial() { tutAuto = true; enterTut(); tut.run(); }
function endTut() { if (mode === 'tut') mode = 'idle'; render(); }
function shouldAutoTutorial() {
  return !tutAuto && me && (gotOri || fallback) && (state.phase === 'lobby' || state.phase === 'over') && !tut.isRunning() && tut.firstTime();
}

// ---------- 기준 자세 ----------
function captureBasis(quiet) {
  const t = performance.now();
  let src = oriBuf.filter((o) => o.t >= t - CAL_BACK_MS - CAL_SPAN_MS && o.t <= t - CAL_BACK_MS);
  if (!src.length) src = oriBuf.filter((o) => o.t >= t - 500);
  if (!src.length && ori) src = [{ top: ori.top, face: ori.face }];
  if (!src.length) return false;
  const top = norm(src.reduce((a, o) => add(a, o.top), [0, 0, 0]));
  const face = norm(src.reduce((a, o) => add(a, o.face), [0, 0, 0]));
  basis = makeBasis(top, face);
  cur.x = 0; cur.y = 0;
  hist.length = 0;
  nextSendAt = 0;
  announceCal();
  if (!quiet) feel('cal');
  debug(`calibrate back=${basis.back} f=${basis.f.map((x) => x.toFixed(2))}`);
  return true;
}
function announceCal() { if (!send('calibrate', {})) pendingCal = true; }

// ---------- 화면 상태 ----------
function myInfo() {
  if (!me || !state || !state.players) return null;
  return state.players[me.slot] || state.players[String(me.slot)] || null;
}
function setChips(list, target) {
  const box = $(target);
  box.textContent = '';
  for (const [k, v, cls] of list) {
    const c = document.createElement('span');
    c.className = `chip${cls ? ` ${cls}` : ''}`;
    if (k) c.append(k);
    if (v != null && v !== '') { const b = document.createElement('b'); b.textContent = v; c.append(b); }
    box.append(c);
  }
}
let statusTempUntil = 0;
function setStatusTemp(t) { statusTempUntil = performance.now() + 1400; const st = $('status'); st.className = 'status warn'; st.textContent = t; setTimeout(() => { if (mode === 'play') paintStatus(); }, 1450); }
function windWord(w) {
  if (!w || w.speed < 0.6) return '잔잔';
  const cr = w.speed * Math.cos(w.dir), tl = w.speed * Math.sin(w.dir);
  if (Math.abs(cr) >= Math.abs(tl)) return cr > 0 ? '왼쪽에서' : '오른쪽에서';
  return tl > 0 ? '뒷바람' : '맞바람';
}
function paintStatus() {
  if (performance.now() < statusTempUntil) return;
  const st = $('status');
  st.className = 'status';
  const cp = state.current && roster.find((p) => p.slot === state.current);
  const cname = cp ? cp.name : `${state.current}P`;
  if (cueText) { st.textContent = cueText; st.classList.add('warn'); }
  else if (state.stage === 'intro') st.textContent = t('{n}엔드 곧 시작해요', { n: state.endIdx + 1 });
  else if (state.stage === 'endbreak') st.textContent = '엔드 종료 · 큰 화면을 보세요';
  else if (myTurn()) { st.textContent = '내 차례! 아래로 당겨요'; st.classList.add('turn'); }
  else if (state.stage === 'flight' || state.stage === 'result') st.textContent = state.current === (me && me.slot) ? '화살이 날아가요' : t('{p} 쏘는 중', { p: cname });
  else st.textContent = state.current ? t('{p} 차례 · 기다려요', { p: cname }) : '곧 시작해요';
}
function showPlay(info) {
  mode = 'play';
  // 센서로 겨눌 때는 조준 판이 필요 없어서 감추고 시위 영역을 크게 씁니다. 끌어서 겨누는 경우에만 보임
  $('sightWrap').classList.toggle('hidden', !fallback);
  $('sight').classList.toggle('drag', fallback);
  $('sightLabel').textContent = '끌어서 조준';
  $('btnShoot').disabled = !myTurn();
  $('fallbackHint').classList.toggle('hidden', !fallback);
  $('fallbackHint').textContent = fallbackReason();
  $('score').textContent = String(info.total || 0);
  $('endTxt').textContent = t('{a}/{b}엔드', { a: state.endIdx + 1, b: state.ends });
  const left = Math.max(0, (state.arrows || 3) - (myTurn() ? state.arrowIdx : (state.current === me.slot ? state.arrowIdx + 1 : state.arrowIdx)));
  $('arrowTxt').textContent = t('내 화살 {a}/{b}발', { a: info.arrows && info.arrows[state.endIdx] ? info.arrows[state.endIdx].length : 0, b: state.arrows || 3 });
  $('arrowsLeft').innerHTML = Array.from({ length: state.arrows || 3 }, (_, i) => `<i class="${i < (info.arrows && info.arrows[state.endIdx] ? info.arrows[state.endIdx].length : 0) ? 'spent' : ''}"></i>`).join('');
  void left;
  const w = state.wind || { speed: 0, dir: 0 };
  $('wSpd').textContent = Number(w.speed || 0).toFixed(1);
  $('wWord').textContent = windWord(w);
  $('wArrow').setAttribute('transform', `rotate(${(-(w.dir || 0) / RD).toFixed(1)})`);
  pad.setEnabled(myTurn());
  if (!myTurn()) pad.cancel();
  paintStatus();
  paintDiff();
  show('vPlay');
}
function paintReadyRow() {
  const box = $('readyRow');
  const st = readyInfo;
  if (!st || !Array.isArray(st.players) || !st.players.length || state.phase === 'playing') { box.classList.add('hidden'); return; }
  const ready = new Set(st.ready || []);
  const away = new Set(st.away || []);
  const waitFor = st.players.filter((s) => !ready.has(s));
  const mine = me && ready.has(me.slot);
  const head = !waitFor.length ? '모두 준비 완료!' : mine ? t('{who} 기다리는 중', { who: waitFor.map((s) => `${s}P`).join('·') }) : t('준비 {a}/{b}', { a: ready.size, b: st.players.length });
  box.innerHTML = `<span class="rr-h">${head}</span>` + st.players.map((s) =>
    `<span class="rr${ready.has(s) ? ' on' : ''}${away.has(s) ? ' away' : ''}${me && s === me.slot ? ' mine' : ''}" style="--pc:${COLORS[s] || '#fff'}">${s}P${ready.has(s) ? ' ✓' : ''}</span>`).join('');
  box.classList.remove('hidden');
}
function paintScoreCard() {
  const box = $('scoreCard');
  const pl = state.players || {};
  const slots = Object.keys(pl).map(Number).sort((a, b) => a - b).filter((s) => pl[s].play);
  if (!slots.length || state.phase === 'lobby') { box.textContent = ''; return; }
  box.innerHTML = slots.map((s) => `<div class="sr" style="--pc:${COLORS[s] || '#fff'}"><b>${s}P</b><span>${(pl[s].ends || []).join(' · ')}</span><em>${pl[s].total}</em></div>`).join('');
}
function showWait(info) {
  mode = 'wait';
  const phase = state.phase;
  const chips = [];
  if (roster.length) chips.push(['참가', t('{n}명', { n: roster.length })]);
  if (fallback) chips.push(['조작', '끌어서']);
  const mineReady = me && readyList.includes(me.slot);
  const go = $('btnGo');
  go.style.display = '';
  go.disabled = false;
  go.classList.remove('waiting', 'ready');
  const spectating = phase === 'playing' && !(info && info.play);
  if (phase === 'over') {
    if (lastResult) {
      $('waitT').textContent = lastResult.rank === 1 ? t('1위!') : t('{n}위', { n: lastResult.rank });
      $('waitB').textContent = `${t('{a}점 · X {b} · 10점 {c}', { a: lastResult.total, b: lastResult.xs, c: lastResult.tens })}\n${t('큰 화면에서 순위를 확인해요.')}`;
    } else {
      $('waitT').textContent = '경기 종료';
      $('waitB').textContent = '큰 화면에서 순위를 확인해요.';
    }
    go.innerHTML = '다시 하기';
  } else if (spectating) {
    $('waitT').textContent = '관전 중';
    $('waitB').textContent = '다음 엔드부터 함께 쏴요.\n자리는 이미 잡혀 있어요.';
    go.style.display = 'none';
  } else {
    $('waitT').textContent = '대기실';
    $('waitB').textContent = '모두 준비를 누르면 시작해요.';
    go.innerHTML = '준비';
  }
  if (mineReady && phase !== 'playing') {
    go.innerHTML = '준비 완료 ✓<small>다른 사람을 기다려요</small>';
    go.disabled = true;
    go.classList.add('waiting', 'ready');
  } else if (phase !== 'playing' && !gotOri && !fallback) {
    go.innerHTML = '준비<small>동작 센서 확인 중…</small>';
    go.classList.add('waiting');
  }
  setChips(chips, 'waitChips');
  paintReadyRow();
  paintScoreCard();
  tut.setLinkVisible(phase !== 'playing');
  show('vWait');
}
function render() {
  if (!me) return;
  if (mode === 'start' || mode === 'connecting' || mode === 'msg') return;
  if (mode === 'tut') return;
  const info = myInfo();
  if (fallback) startFake();
  if (state.phase === 'playing' && info && info.play) {
    showPlay(info);
    return;
  }
  if (shouldAutoTutorial()) { startTutorial(); return; }
  showWait(info);
}
function fallbackReason() {
  let why = '동작 센서가 없어 화면을 끌어서 겨눠요.';
  if (!window.isSecureContext) why = 'https 주소가 아니라 센서가 꺼져 있어요. 화면을 끌어서 겨눠요.';
  else if (permDenied) why = '동작 권한이 거절돼 화면을 끌어서 겨눠요.';
  return isTouch ? t(why) : `${t(why)} ${t('(키보드: 방향키·스페이스)')}`;
}
function sensorsChanged() {
  if (!fallback && fakeTimer) {
    clearInterval(fakeTimer);
    fakeTimer = null;
    if (basis && basis.fake) basis = null;
  }
  if (helpOn && mode === 'msg' && !fallback) { helpOn = false; join(); return; }
  render();
}
function sensorHelp() {
  message('동작 센서를 쓸 수 없어요',
    'iPhone: Safari를 완전히 닫고 QR을 다시 찍어요.\nAndroid: 사이트 설정에서 동작 센서를 허용해요.',
    { label: '끌어서 겨눌게요', onClick: () => { fallback = true; join(); } });
  helpOn = true;
}
function keepAwake() { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {}); }

// ---------- 소켓 ----------
function join() {
  mode = 'connecting';
  $('msgT').textContent = '들어가는 중…';
  $('msgB').textContent = '큰 화면과 연결하고 있어요.';
  $('btnMsg').classList.add('hidden');
  show('vMsg');
  if (socket.connected) socket.emit('join', { role: 'controller', room: ROOM, token });
  else socket.connect();
}
socket.on('connect', () => { banner(''); socket.emit('join', { role: 'controller', room: ROOM, token }); });
socket.on('disconnect', () => { if (me) banner('서버 연결이 끊겼어요. 다시 잇는 중…'); });
socket.on('assigned', (p) => {
  if (!p || p.game !== 'archery') {
    const code = encodeURIComponent((p && p.code) || ROOM);
    location.replace(`${PLAY_URL(p && p.game ? p.game : 'baseball')}?room=${code}`);
    return;
  }
  me = p;
  noRoomTries = 0;
  document.documentElement.style.setProperty('--c', p.color);
  tut.setColor(p.color);
  haptics.config({ color: p.color });
  $('me').textContent = p.name;
  if (pendingCal && basis) { pendingCal = false; send('calibrate', {}); }
  if (mode === 'connecting' || (mode === 'msg' && !helpOn)) mode = 'idle';
  render();
});
socket.on('players', (payload) => {
  roster = payload && Array.isArray(payload.players) ? payload.players : [];
  if (mode === 'wait') render();
});
socket.on('ready_state', (st) => {
  readyInfo = st || null;
  readyList = st && Array.isArray(st.ready) ? st.ready : [];
  if (mode === 'wait') render();
});
socket.on('display_status', ({ connected } = {}) => {
  banner(connected ? '' : '큰 화면이 꺼져 있어요. 다시 열리면 이어서 해요.');
  render();
});
socket.on('no_room', () => {
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

socket.on('game_state', (s) => {
  const prev = state;
  state = s && typeof s === 'object' ? s : { phase: 'lobby' };
  if (state.phase === 'playing' && prev.phase !== 'playing') {
    lastResult = null; readyList = []; readyInfo = null;
    if (tut.isRunning()) { tut.cancel(); mode = 'idle'; }
  }
  // 내 차례가 끝나면 당기던 것을 취소
  if (prev.current === (me && me.slot) && state.current !== (me && me.slot)) pad.cancel();
  render();
});
// 내 차례가 오면 진동 한 번
socket.on('turn', (t) => {
  if (me && t && t.slot === me.slot) {
    feel('turn');
    if (gotOri && !fallback) captureBasis(true); // 내 차례가 시작될 때의 자세를 가운데로 삼음
  }
});
socket.on('cue', (c) => {
  cueText = c && c.text ? String(c.text) : '';
  clearTimeout(cueTimer);
  cueTimer = setTimeout(() => { cueText = ''; if (mode === 'play') paintStatus(); }, 2600);
  if (mode === 'play') paintStatus();
});
socket.on('result', (r) => {
  lastResult = r || null;
  if (r && r.rank === 1) feel('win');
  render();
});
haptics.listen(socket, { slot: () => me && me.slot });

// ---------- 버튼 ----------
$('btnStart').addEventListener('click', async () => {
  if (mode !== 'start') return;
  mode = 'connecting';
  $('btnStart').disabled = true;
  keepAwake();
  haptics.unlock();
  const asks = [];
  if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') asks.push(DeviceOrientationEvent.requestPermission().catch(() => 'denied'));
  if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') asks.push(DeviceMotionEvent.requestPermission().catch(() => 'denied'));
  const res = await Promise.all(asks);
  permDenied = res.some((x) => x !== 'granted');
  window.addEventListener('deviceorientation', onOrientation);
  if (!ROOM) { message('방 코드가 없어요', '큰 화면의 QR을 찍어 주세요.'); return; }
  if (permDenied && isTouch && !DEBUG) { sensorHelp(); return; }
  join();
  setTimeout(() => {
    if (gotOri) return;
    if (isTouch && !DEBUG && window.isSecureContext) { fallback = true; sensorHelp(); return; }
    fallback = true;
    debug('동작 센서 값이 들어오지 않아 끌어서 조준해요');
    sensorsChanged();
  }, SENSOR_WAIT_MS);
});
$('btnGo').addEventListener('click', () => {
  keepAwake();
  if (me && readyList.includes(me.slot) && state.phase !== 'playing') return;
  if (!gotOri && !fallback) return;
  if (send('start_game', {})) {
    haptics.tick();
    if (me && !readyList.includes(me.slot)) readyList = [...readyList, me.slot];
    render();
  }
});
$('btnRecal').addEventListener('click', () => {
  if (captureBasis()) { const st = $('status'); st.textContent = '다시 맞췄어요'; statusTempUntil = performance.now() + 1200; }
});
$('btnShoot').addEventListener('click', () => {
  if (!myTurn() || mode !== 'play') { blocked(); return; }
  maybeRecenter();
  drawSent = 1;
  doRelease(1, true);
});

// 센서 없는 PC: 방향키 조준, 스페이스 꾹 = 당기기, 떼면 발사
let keyPullTimer = null;
let keyPull = 0;
document.addEventListener('keydown', (e) => {
  if (!fallback) return;
  const S = 0.5;
  if (e.key === 'ArrowLeft') FAKE.x = clamp(FAKE.x - S, -PAD_RANGE * 1.2, PAD_RANGE * 1.2);
  else if (e.key === 'ArrowRight') FAKE.x = clamp(FAKE.x + S, -PAD_RANGE * 1.2, PAD_RANGE * 1.2);
  else if (e.key === 'ArrowUp') FAKE.y = clamp(FAKE.y + S, -PAD_RANGE * 1.2, PAD_RANGE * 1.2);
  else if (e.key === 'ArrowDown') FAKE.y = clamp(FAKE.y - S, -PAD_RANGE * 1.2, PAD_RANGE * 1.2);
  else if (e.code === 'Space') {
    e.preventDefault();
    if (e.repeat || keyPullTimer || !(myTurn() || mode === 'tut')) return;
    keyPull = 0;
    if (mode === 'play') { drawStepSent = 0; fullSent = false; send('draw', { pull: 0.01 }, true); }
    keyPullTimer = setInterval(() => {
      keyPull = Math.min(1, keyPull + 0.03);
      pad.paint(keyPull);
      if (mode === 'play') { send('draw', { pull: r3(keyPull) }, true); if (keyPull >= FULL_PULL && !fullSent) { fullSent = true; feel('full'); } paintHint(keyPull); }
    }, 33);
  }
});
document.addEventListener('keyup', (e) => {
  if (e.code !== 'Space' || !keyPullTimer) return;
  clearInterval(keyPullTimer);
  keyPullTimer = null;
  const p = keyPull;
  keyPull = 0;
  pad.paint(0);
  if (mode === 'play') doRelease(p);
});
// 시위를 누르고 가만히 있어도 큰 화면이 '폰 소식 없음' 으로 취소하지 않도록 주기적으로 당김을 다시 알림
setInterval(() => { if (pad.down && myTurn() && mode === 'play') send('draw', { pull: r3(pad.pull) }, true); }, 250);
document.addEventListener('visibilitychange', () => { if (document.hidden) return; if (mode !== 'start') keepAwake(); render(); });

if (!window.isSecureContext) $('httpNote').classList.remove('hidden');
paintDiff();

// ---------- 디버그 (&debug) ----------
let lastHaptic = '';
function debug(t) { if (DEBUG) $('debug').textContent = t; }
if (DEBUG) {
  haptics.onEvent((h) => { lastHaptic = `${h.kind}${h.remote ? '(화면)' : ''}→${h.skipped || h.did}`; });
  let lastO = 0;
  setInterval(() => {
    debug(`ori ${(oriCount - lastO) * 2}Hz aim ${cur.x.toFixed(2)},${cur.y.toFixed(2)} basis ${basis ? (basis.fake ? 'fake' : basis.back ? 'back' : 'top') : 'N'} mode ${mode} fb ${fallback ? 'Y' : 'N'} haptic ${lastHaptic || '-'}`);
    lastO = oriCount;
  }, 500);
}
window.__archeryPhone = {
  get state() { return state; }, get mode() { return mode; }, get basis() { return basis; }, get fallback() { return fallback; },
  cur, FAKE, pad, doRelease, onOrientation, deviceVectors, makeBasis, aimDegOf, captureBasis, tut, ps, haptics, feel, startTutorial, steadyNow
};
