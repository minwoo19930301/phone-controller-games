// 좀비 건 컨트롤러. 폰이 총입니다.
// 폰을 화면 쪽으로 겨누면 방향(deviceorientation)을 '중앙 맞추기' 때의 자세 기준으로 바꿔 화면 안의 위치(x, y: 0~1)로 보냅니다.
// 큰 방아쇠는 shoot(누른 순간의 조준 위치와 센서 지연 ago 를 같이 보냄), 폰을 아래로 확 꺾거나 장전 버튼은 reload 입니다.
// 폰을 리모컨처럼 눕혀 쥐면 윗부분이, 카메라처럼 세워 쥐면 뒷면이 겨누는 방향입니다(맞추는 순간 자세로 자동 판단).
//
// 공통 모듈:
// - haptics: 쏠 때마다 짧은 진동 + 총구 번쩍 + (켰으면) 손전등. 좀비를 맞히면 큰 화면의 'hit' 를 받아 더 세게 울립니다.
// - phone-settings: 대기 화면의 난이도 알약(큰 화면이 값의 주인)
// - tutorial: 처음 하는 폰이면 중앙 맞추기 → 조준점 움직이기 → 좀비 쏘기 → 장전 연습
import { haptics } from '/common/haptics.js';
import { createPhoneSettings } from '/common/phone-settings.js';
import { createTutorial } from '/common/tutorial.js';

const $ = (id) => document.getElementById(id);
const RD = Math.PI / 180;
const params = new URLSearchParams(location.search);
const ROOM = (params.get('room') || '').toUpperCase();
const DEBUG = params.has('debug');
$('room').textContent = ROOM ? `방 ${ROOM}` : '';

// ---------- 조정 값 (실폰 검증 전이라 바뀔 수 있습니다) ----------
const AIM_MS = 33; // aim 전송 간격, 약 30Hz
const RANGE_X = 26; // 중앙에서 좌우로 이 각도(도)를 돌리면 화면 가장자리
const RANGE_Y = 17; // 위아래
const SMOOTH = 0.55; // 보내기 전 한 번 다듬기(0~1, 클수록 빠르게 따라감)
const FLICK_DEG = { easy: 34, normal: 40, hard: 45 }; // 이만큼 아래로 꺾으면 장전(난이도가 낮을수록 살짝만 꺾어도)
const FLICK_MS = 260;
const RELOAD_COOL_MS = 1100;
const CAL_BACK_MS = 120; // '중앙' 버튼을 누른 순간의 흔들림을 피해 이만큼 전 값부터 씁니다
const CAL_SPAN_MS = 280;
const SENSOR_WAIT_MS = 1500; // 이 시간 안에 동작 센서 값이 없으면 버튼 모드
const MAG = 12;
const COLORS = { 1: '#ff5a5f', 2: '#3ab4ff', 3: '#ffc93c', 4: '#5ee07a', 5: '#c77dff', 6: '#ff8fd1', 7: '#3ee6d6', 8: '#ff9b3d' };
const DIFF_LABEL = { easy: '쉬움', normal: '보통', hard: '어려움' };
const PLAY_URL = (g) => (g === 'baseball' ? '/play/' : `/play/${g}/`);

let token = null;
try { token = localStorage.getItem('pcg-token'); } catch (e) {}
if (!token) {
  token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try { localStorage.setItem('pcg-token', token); } catch (e) {}
}

const socket = io({ autoConnect: false, transports: ['websocket', 'polling'], tryAllTransports: true });
// 끊긴 동안 보낸 이벤트는 다시 붙을 때 join 보다 먼저 흘러가 버려지므로, 끊겨 있으면 보내지 않습니다.
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
let pendingReady = false;
let noRoomTries = 0;
let helpOn = false;
let displayOn = true;
let readyList = [];
let readyInfo = null; // 서버의 ready_state { ready, players, away, need }

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
  if (btn) {
    $('btnMsg').textContent = btn.label;
    $('btnMsg').onclick = btn.onClick;
  }
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
function flickDeg() { return ps.pick(FLICK_DEG); }
function paintDiff() {
  const d = ps.difficulty();
  for (const id of ['dTag']) {
    const e = $(id);
    e.textContent = DIFF_LABEL[d] || '보통';
    e.dataset.d = d;
  }
}

// 큰 화면 색 테두리 번쩍(머리·처치·다침·회복). 쏘기의 총구 번쩍은 haptics 가 합니다.
function vignette(kind) {
  const f = $('flash');
  f.className = '';
  void f.offsetWidth;
  f.className = `go ${kind}`;
}
// 쏘기 = 짧은 진동(24ms) + 총구 번쩍 + 손전등, 몸통 명중 = 46ms, 머리·처치는 두세 번 끊어 더 세게.
// iPhone 은 진동 대신 번쩍임 + 작은 틱 소리(haptics 가 알아서).
function feel(kind) {
  switch (kind) {
    case 'shot': haptics.shot(); break;
    case 'empty': haptics.tick(); break;
    case 'hit': haptics.play('hit', 0.9); break;
    case 'head': haptics.play('strong', 1, { noFlash: true }); vignette('head'); break;
    case 'kill': haptics.buzz([45, 30, 90], { noFlash: true }); vignette('kill'); break;
    case 'hurt': haptics.buzz([120, 50, 200], { noFlash: true }); vignette('hurt'); break;
    case 'down': haptics.buzz([200, 80, 300], { noFlash: true }); vignette('hurt'); break;
    case 'reload': haptics.buzz([20, 40, 20], { noFlash: true }); break;
    case 'medkit': haptics.buzz([40, 30, 40], { noFlash: true }); vignette('heal'); break;
    case 'cal': haptics.buzz([30, 40, 30], { noFlash: true }); vignette('kill'); break;
    case 'cue': haptics.buzz([35], { noFlash: true }); break;
    case 'win': haptics.buzz([80, 60, 80, 60, 240], { noFlash: true }); vignette('kill'); break;
    default: break;
  }
}

// ---------- 작은 벡터·사원수 계산 ----------
function qFromEuler(x, y, z) {
  // three.js 의 'YXZ' 순서와 같습니다.
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
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const r4 = (v) => Math.round(v * 10000) / 10000;

// deviceorientation 값을 세계 좌표(위 = +Y)의 방향으로 바꿉니다. 다른 종목과 같은 변환입니다.
// 이 좌표에서 폰 윗부분 = (0,0,-1), 화면 바깥 = (0,1,0) 입니다.
function deviceVectors(alpha, beta, gamma) {
  const q = qFromEuler(beta * RD, alpha * RD, -gamma * RD);
  return { top: qRot(q, [0, 0, -1]), face: qRot(q, [0, 1, 0]) };
}

// ---------- 조준 기준(중앙 맞추기) ----------
let basis = null; // { r, u, f, pitch0, back }
// 겨누는 방향: 눕혀 쥐면 폰 윗부분, 세워 쥐면(카메라처럼) 뒷면
const pointer = (b, top, face) => (b.back ? [-face[0], -face[1], -face[2]] : top);
function makeBasis(top, face) {
  const back = top[1] > 0.75;
  const p0 = back ? [-face[0], -face[1], -face[2]] : top;
  let f = [p0[0], 0, p0[2]];
  if (Math.hypot(f[0], f[2]) < 0.2) f = [-face[0], 0, -face[2]];
  if (Math.hypot(f[0], f[2]) < 0.2) f = [0, 0, -1];
  f = norm(f);
  return { r: norm(cross(f, [0, 1, 0])), u: [0, 1, 0], f, pitch0: Math.asin(clamp(p0[1], -1, 1)), back };
}
function aimOf(b, top, face) {
  const p = pointer(b, top, face);
  const v = [dot(p, b.r), dot(p, b.u), dot(p, b.f)];
  const yaw = Math.atan2(v[0], v[2]) / RD;
  const pitch = (Math.asin(clamp(v[1], -1, 1)) - b.pitch0) / RD;
  return { x: 0.5 + yaw / (2 * RANGE_X), y: 0.5 - pitch / (2 * RANGE_Y), pitch: Math.asin(clamp(v[1], -1, 1)) / RD };
}

// ---------- 센서 ----------
let ori = null;
const oriBuf = [];
let nextAimAt = 0;
let oriCount = 0;
let lastOriT = 0;
const cur = { x: 0.5, y: 0.5 }; // 지금 조준 위치(보내는 값과 같은 것)
const pitchBuf = [];
let lastReloadAt = -1e9;
function evTime(e) {
  const n = performance.now();
  const ts = e && e.timeStamp;
  return ts > 0 && Math.abs(n - ts) < 1000 ? ts : n;
}
const streaming = () => basis && (state.phase === 'lobby' || state.phase === 'playing') && me &&
  (mode === 'play' || mode === 'wait' || mode === 'idle' || mode === 'tut');
function onOrientation(e) {
  if (e.alpha == null && e.beta == null) return;
  const t = evTime(e);
  oriCount += 1;
  lastOriT = t;
  ori = deviceVectors(e.alpha || 0, e.beta || 0, e.gamma || 0);
  oriBuf.push({ t, top: ori.top, face: ori.face });
  while (oriBuf.length && oriBuf[0].t < t - 700) oriBuf.shift();
  if (!gotOri) {
    gotOri = true;
    fallback = false;
    sensorsChanged();
  }
  if (fallback || !basis || basis.fake) return;
  const a = aimOf(basis, ori.top, ori.face);
  cur.x = clamp(cur.x + (a.x - cur.x) * SMOOTH, -0.1, 1.1);
  cur.y = clamp(cur.y + (a.y - cur.y) * SMOOTH, -0.1, 1.1);
  if (aimWatch) aimWatch();
  pitchBuf.push({ t, p: a.pitch });
  while (pitchBuf.length && pitchBuf[0].t < t - FLICK_MS) pitchBuf.shift();
  checkFlick(t, a.pitch);
  if (streaming() && t >= nextAimAt) {
    nextAimAt = Math.max(nextAimAt + AIM_MS, t + AIM_MS * 0.4);
    send('aim', { x: r4(clamp(cur.x, 0, 1)), y: r4(clamp(cur.y, 0, 1)) }, true);
  }
}
// 폰을 아래로 확 꺾으면 장전: 짧은 시간에 겨눈 높이가 크게 내려간 경우(경기 중, 또는 튜토리얼 장전 단계)
function checkFlick(t, pitch) {
  const armed = mode === 'play' || (mode === 'tut' && tutStepId() === 'reload');
  if (!armed || t - lastReloadAt < RELOAD_COOL_MS) return;
  let hi = -999;
  for (const p of pitchBuf) hi = Math.max(hi, p.p);
  if (hi - pitch >= flickDeg()) {
    pitchBuf.length = 0;
    doReload('flick');
  }
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

// ---------- 사격·장전 ----------
let ammoView = MAG; // 화면에 보이는 탄(발사하면 바로 줄이고, 큰 화면 값이 오면 맞춥니다)
let lastEmptyAt = -1e9; // 폰이 스스로 '찰칵'을 낸 시각(큰 화면의 같은 알림은 한 번만)
let reloadingView = false;
function inGame() {
  return state.phase === 'playing' && myInfo() && !myInfo().down && state.stage !== 'intro' && state.stage !== 'end';
}
const practicing = () => state.phase === 'lobby' && basis;
function doShoot() {
  const live = inGame();
  if (!(live || practicing())) {
    // 튜토리얼을 결과 화면에서 하면 큰 화면에 연습 좀비가 없으니, 누르는 것만으로 연습합니다.
    if (mode === 'tut' && tutStepId() === 'shoot') {
      feel('shot');
      tut.signal('zhit', { offline: true });
    }
    return;
  }
  const now = performance.now();
  send('shoot', { x: r4(clamp(cur.x, 0, 1)), y: r4(clamp(cur.y, 0, 1)), ago: Math.max(0, Math.round(now - (lastOriT || now))), rtt: Math.round(rtt()) });
  const empty = !reloadingView && ammoView <= 0;
  if (!reloadingView) {
    ammoView = Math.max(0, ammoView - 1);
    drawAmmo();
  }
  // 빈 총은 찰칵(틱)만, 쏘면 진동 + 총구 번쩍 + 손전등
  if (empty || reloadingView) lastEmptyAt = now;
  feel(empty || reloadingView ? 'empty' : 'shot');
  paintTutAmmo();
}
function doReload(how = 'button') {
  lastReloadAt = performance.now();
  if (mode === 'tut' && tutStepId() === 'reload') {
    feel('reload');
    if (state.phase === 'lobby') send('reload', {});
    // 탄창이 차오르는 모습을 보여 주고 판정
    ammoView = MAG;
    if (tutAmmo) tutAmmo.classList.add('fill');
    paintTutAmmo();
    tut.signal('reload', { how });
    return;
  }
  if (state.phase === 'playing' && ammoView >= MAG) return;
  send('reload', {});
  feel('reload');
}
let ammoRl = false;
function drawAmmo() {
  const box = $('ammo');
  if (box.childElementCount !== MAG) {
    box.textContent = '';
    for (let i = 0; i < MAG; i++) {
      const p = document.createElement('i');
      p.style.setProperty('--i', String(i));
      box.appendChild(p);
    }
  }
  // 장전 중: 큰 화면이 알려 준 장전 시간(난이도별) 동안 탄이 하나씩 차오릅니다.
  if (reloadingView !== ammoRl) {
    ammoRl = reloadingView;
    box.style.setProperty('--rl', `${Math.round(clamp(Number(state.reloadMs) || 1000, 200, 3000))}ms`);
    box.classList.toggle('rl', reloadingView);
  }
  [...box.children].forEach((e, i) => e.classList.toggle('on', !reloadingView && i < ammoView));
  $('btnReload').classList.toggle('need', ammoView <= 3 || reloadingView);
  $('btnReload').textContent = reloadingView ? '장전 중…' : ammoView <= 0 ? '장전!' : '장전';
}

// ---------- 자세 맞추기 ----------
function openCal() {
  mode = 'cal';
  $('btnReady').classList.remove('hidden');
  $('btnCalCancel').classList.toggle('hidden', !(basis || state.phase !== 'playing' || !myInfo()));
  $('calT').textContent = basis ? '다시 맞춥니다' : '화면 한가운데를 겨눠요';
  $('calB').textContent = '폰을 큰 화면 정중앙으로 향하고\n그대로 아래 버튼을 눌러요.\n(눕혀 쥐면 윗부분이, 세워 쥐면 뒷면이 총구예요)';
  show('vCal');
}
// 버튼을 누르는 순간의 흔들림을 피해, 조금 전 값의 평균을 기준으로 삼습니다.
function captureBasis(quiet) {
  const t = performance.now();
  let src = oriBuf.filter((o) => o.t >= t - CAL_BACK_MS - CAL_SPAN_MS && o.t <= t - CAL_BACK_MS);
  if (!src.length) src = oriBuf.filter((o) => o.t >= t - 500);
  if (!src.length && ori) src = [{ top: ori.top, face: ori.face }];
  if (!src.length) return false;
  const top = norm(src.reduce((a, o) => add(a, o.top), [0, 0, 0]));
  const face = norm(src.reduce((a, o) => add(a, o.face), [0, 0, 0]));
  basis = makeBasis(top, face);
  cur.x = 0.5;
  cur.y = 0.5;
  pitchBuf.length = 0;
  nextAimAt = 0;
  announceCal();
  if (!quiet) feel('cal');
  debug(`calibrate back=${basis.back} f=${basis.f.map((x) => x.toFixed(2))} pitch0=${(basis.pitch0 / RD).toFixed(0)}`);
  return true;
}
function announceCal() {
  if (!send('calibrate', {})) pendingCal = true;
}

// ---------- 센서 없는 PC: 끌어서 조준, 버튼으로 발사 ----------
let fakeTimer = null;
const FAKE = { x: 0.5, y: 0.5 };
function startFake() {
  if (fakeTimer) return;
  basis = { fake: true };
  if (me) announceCal();
  else pendingCal = true;
  fakeTimer = setInterval(() => {
    cur.x = FAKE.x;
    cur.y = FAKE.y;
    if (aimWatch) aimWatch();
    if (streaming()) send('aim', { x: r4(cur.x), y: r4(cur.y) }, true);
    drawPadDot();
  }, AIM_MS);
}
function drawPadDot() {
  const pad = $('pad');
  $('padDot').style.left = `${(FAKE.x * pad.clientWidth).toFixed(0)}px`;
  $('padDot').style.top = `${(FAKE.y * pad.clientHeight).toFixed(0)}px`;
}
// 끌어서 조준하는 판(대기실·경기 중 #pad, 튜토리얼의 작은 화면에도 씁니다)
function dragAim(el) {
  let down = false;
  const set = (e) => {
    const r = el.getBoundingClientRect();
    FAKE.x = clamp((e.clientX - r.left) / r.width, 0, 1);
    FAKE.y = clamp((e.clientY - r.top) / r.height, 0, 1);
  };
  el.addEventListener('pointerdown', (e) => { if (!fallback) return; down = true; try { el.setPointerCapture(e.pointerId); } catch (x) {} set(e); });
  el.addEventListener('pointermove', (e) => { if (down) set(e); });
  const up = () => { down = false; };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}
dragAim($('pad'));
document.addEventListener('keydown', (e) => {
  if (!fallback) return;
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) doShoot(); }
  else if (e.code === 'KeyR') doReload('button');
  else if (e.key === 'ArrowLeft') FAKE.x = clamp(FAKE.x - 0.04, 0, 1);
  else if (e.key === 'ArrowRight') FAKE.x = clamp(FAKE.x + 0.04, 0, 1);
  else if (e.key === 'ArrowUp') FAKE.y = clamp(FAKE.y - 0.04, 0, 1);
  else if (e.key === 'ArrowDown') FAKE.y = clamp(FAKE.y + 0.04, 0, 1);
});

// ================================================================
// 처음 하는 사람 연습(튜토리얼): 중앙 맞추기 → 조준점 움직이기 → 좀비 쏘기 → 장전
// ================================================================
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
// 그림(200×160). 공통 튜토리얼 그림과 같은 선 스타일(pcgt-*)을 씁니다.
const PH = '<rect x="-17" y="-31" width="34" height="62" rx="7" class="pcgt-ph"/><rect x="-12.5" y="-24.5" width="25" height="46" rx="3" class="pcgt-scr"/><path d="M-5 -28h10" class="pcgt-spk"/>';
const svgArt = (inner) => `<svg class="pcgt-svg" viewBox="0 0 200 160" aria-hidden="true">${inner}</svg>`;
const ART = {
  // 폰을 좌우로 돌리면 큰 화면의 조준점이 따라 움직임
  aim: () => svgArt(
    '<rect x="44" y="10" width="112" height="70" rx="7" class="pcgt-tv"/><path d="M100 80v8M84 90h32" class="pcgt-tvs"/>' +
    '<g><animateTransform attributeName="transform" type="translate" values="-34 0;34 0;-34 0" dur="2.4s" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1" repeatCount="indefinite"/>' +
    '<circle cx="100" cy="45" r="11" class="pcgt-arrow"/><path d="M100 29v7M100 54v7M84 45h7M109 45h7" class="pcgt-arrow"/></g>' +
    '<g transform="translate(100 128)"><g><animateTransform attributeName="transform" type="rotate" values="-20;20;-20" dur="2.4s" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1" repeatCount="indefinite"/>' +
    `<g transform="translate(0 -6) rotate(0)">${PH}</g></g></g>` +
    '<path d="M62 132q-14 -10 -6 -26M138 132q14 -10 6 -26" class="pcgt-arc"/>'
  ),
  // 조준점을 좀비에 올리고 엄지로 방아쇠
  shoot: () => svgArt(
    '<rect x="40" y="8" width="120" height="74" rx="7" class="pcgt-tv"/><path d="M100 82v8M84 92h32" class="pcgt-tvs"/>' +
    '<g fill="#6f9a63"><circle cx="100" cy="30" r="9"/><rect x="90" y="40" width="20" height="28" rx="6"/><rect x="80" y="42" width="8" height="18" rx="4" transform="rotate(-25 84 42)"/><rect x="112" y="42" width="8" height="18" rx="4" transform="rotate(25 116 42)"/></g>' +
    '<circle cx="100" cy="32" r="12" class="pcgt-arrow"/><path d="M100 16v7M100 41v7M84 32h7M109 32h7" class="pcgt-arrow"/>' +
    '<g opacity="0"><animate attributeName="opacity" values="0;1;0;0" keyTimes="0;.12;.3;1" dur="1.2s" repeatCount="indefinite"/>' +
    '<path d="M100 32l-16 -12M100 32l17 -11M100 32l-18 10M100 32l16 12" stroke="#ffd23a" stroke-width="3" stroke-linecap="round"/><circle cx="100" cy="32" r="6" fill="#fff6c9"/></g>' +
    `<g transform="translate(100 128)">${PH.replace('class="pcgt-scr"', 'class="pcgt-scr" style="opacity:.75"')}</g>` +
    '<circle cx="100" cy="134" r="9" class="pcgt-ring"><animate attributeName="r" values="7;13;7" keyTimes="0;.12;1" dur="1.2s" repeatCount="indefinite"/></circle>' +
    '<rect x="112" y="128" width="30" height="18" rx="8" class="pcgt-hand" transform="rotate(-28 112 128)"><animateTransform attributeName="transform" type="rotate" values="-28 112 128;-36 112 128;-28 112 128" keyTimes="0;.12;1" dur="1.2s" repeatCount="indefinite"/></rect>'
  ),
  // 옆에서 본 모습: 큰 화면을 겨누던 폰의 앞쪽을 아래로 확 꺾으면 → 탄창이 차오름
  reload: () => svgArt(
    '<rect x="148" y="16" width="42" height="30" rx="4" class="pcgt-tv"/><path d="M169 46v6M161 54h16" class="pcgt-tvs"/>' +
    '<path d="M136 72L160 36" stroke="#fff" stroke-width="2.5" stroke-dasharray="3 6" stroke-linecap="round" opacity=".7">' +
    '<animate attributeName="opacity" values=".7;.7;0;0;.7" keyTimes="0;.3;.34;.86;1" dur="1.8s" repeatCount="indefinite"/></path>' +
    '<path d="M145 76A80 80 0 0 1 111 150" class="pcgt-arc"/><path d="M99 143l12 7 2 -13" class="pcgt-arrow"/>' +
    '<g transform="translate(64 84)"><g><animateTransform attributeName="transform" type="rotate" values="-8;-8;56;56;-8" keyTimes="0;.3;.42;.8;1" dur="1.8s" calcMode="spline" keySplines="0 0 1 1;.3 0 .1 1;0 0 1 1;.45 0 .55 1" repeatCount="indefinite"/>' +
    '<rect x="-6" y="-7" width="78" height="14" rx="6" class="pcgt-ph"/><rect x="6" y="-3" width="58" height="6" rx="2" class="pcgt-scr"/></g>' +
    '<rect x="-17" y="-10" width="25" height="24" rx="9" class="pcgt-hand"/></g>' +
    '<g transform="translate(22 18)">' +
    Array.from({ length: 6 }, (_, i) => `<rect x="${i * 7}" y="0" width="5" height="18" rx="1.5" fill="#ffd23a" opacity=".18"><animate attributeName="opacity" values=".18;.18;1;1;.18" keyTimes="0;${(0.42 + i * 0.04).toFixed(2)};${(0.46 + i * 0.04).toFixed(2)};.86;1" dur="1.8s" repeatCount="indefinite"/></rect>`).join('') +
    '</g>'
  )
};

let tutAuto = false; // 이 페이지에서 저절로 한 번 띄웠는지
let aimWatch = null; // 조준점 움직이기 단계에서 조준이 바뀔 때마다 부르는 판정
const tutStepId = () => {
  const c = tut.current();
  return c ? c.id : null;
};
// 큰 화면을 흉내 낸 작은 화면: 내 조준점이 어디 있는지 보여 주고, 버튼 모드에서는 끌어서 조준합니다.
function miniTv(parent, o = {}) {
  const tv = el('div', `gt-tv${o.small ? ' small' : ''}${fallback ? ' drag' : ''}`,
    (o.zones ? '<i class="gt-zone l"><b>←</b></i><i class="gt-zone r"><b>→</b></i>' : '') +
    '<div class="gt-xh"></div><span class="gt-tvlabel">' + (fallback ? '끌어서 조준' : '큰 화면') + '</span>');
  parent.appendChild(tv);
  const xh = tv.querySelector('.gt-xh');
  if (fallback) dragAim(tv);
  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    xh.style.left = `${(clamp(cur.x, 0, 1) * 100).toFixed(2)}%`;
    xh.style.top = `${(clamp(cur.y, 0, 1) * 100).toFixed(2)}%`;
    if (o.onFrame) o.onFrame();
  };
  loop();
  return {
    el: tv,
    zone(side) { const z = tv.querySelector(`.gt-zone.${side}`); if (z) z.classList.add('on'); },
    pop() { xh.classList.remove('pop'); void xh.offsetWidth; xh.classList.add('pop'); },
    stop() { cancelAnimationFrame(raf); }
  };
}
function compact(stage) {
  const card = stage.closest('.pcgt-card');
  if (card) card.classList.add('gt-compact');
}
function stageCal(stage, api) {
  const box = el('div', 'gt-col');
  if (fallback) {
    box.innerHTML = '<p class="gt-note">센서 대신 버튼으로 하니까 맞추지 않아도 돼요.</p><button type="button" class="gt-btn">다음</button>';
    box.querySelector('button').addEventListener('click', () => api.ok('버튼 모드 준비 끝'));
  } else {
    box.innerHTML = '<button type="button" class="gt-btn">여기가 중앙</button><p class="gt-note">눕혀 쥐면 윗부분, 세워 쥐면 뒷면이 총구예요</p>';
    box.querySelector('button').addEventListener('click', () => {
      if (!gotOri) { api.fail('방향 센서 값이 아직 없어요. 잠시 뒤 다시 눌러요'); return; }
      if (captureBasis(true)) tut.signal('cal', { ok: true });
      else api.fail('센서 값이 끊겼어요. 다시 눌러요');
    });
  }
  stage.appendChild(box);
}
function stageAim(stage) {
  compact(stage);
  // 중앙 맞추기를 건너뛰었으면 지금 겨눈 곳을 중앙으로 잡습니다.
  if (!basis && gotOri && !fallback) captureBasis(true);
  const seen = { l: false, r: false };
  let sent = false;
  const tv = miniTv(stage, { zones: true });
  aimWatch = () => {
    if (!seen.l && cur.x < 0.2) { seen.l = true; tv.zone('l'); haptics.tick(); }
    if (!seen.r && cur.x > 0.8) { seen.r = true; tv.zone('r'); haptics.tick(); }
    if (seen.l && seen.r && !sent) { sent = true; tut.signal('aimed', seen); }
  };
  return () => { aimWatch = null; tv.stop(); };
}
let tutTv = null;
function stageShoot(stage) {
  compact(stage);
  if (!basis && gotOri && !fallback) captureBasis(true);
  const offline = state.phase !== 'lobby';
  const wrap = el('div', 'gt-shoot');
  stage.appendChild(wrap);
  tutTv = miniTv(wrap, { small: true });
  const trig = el('button', 'gt-trig', '발사');
  trig.type = 'button';
  trig.addEventListener('pointerdown', (e) => { e.preventDefault(); trig.classList.add('on'); doShoot(); });
  const up = () => trig.classList.remove('on');
  trig.addEventListener('pointerup', up);
  trig.addEventListener('pointercancel', up);
  trig.addEventListener('pointerleave', up);
  wrap.appendChild(trig);
  if (offline) stage.appendChild(el('p', 'gt-note', '큰 화면이 결과 화면이라 지금은 누르는 것만 연습해요.'));
  return () => { if (tutTv) tutTv.stop(); tutTv = null; };
}
let tutAmmo = null;
function paintTutAmmo() {
  if (!tutAmmo || !tutAmmo.isConnected) return;
  [...tutAmmo.children].forEach((e, i) => e.classList.toggle('on', i < ammoView));
}
function stageReload(stage) {
  compact(stage);
  const wrap = el('div', 'gt-col');
  tutAmmo = el('div', 'gt-ammo', Array.from({ length: MAG }, (_, k) => `<i style="--i:${k * 28}"></i>`).join(''));
  // 장전 연습이 잘 보이도록 탄을 비워 둔 모습부터
  ammoView = Math.min(ammoView, 2);
  paintTutAmmo();
  const btn = el('button', 'gt-rld', '장전');
  btn.type = 'button';
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); doReload('button'); });
  wrap.append(tutAmmo, btn);
  if (fallback) wrap.appendChild(el('p', 'gt-note', '버튼 모드: 장전 버튼이나 키보드 R'));
  stage.appendChild(wrap);
  return () => { tutAmmo = null; };
}
const tut = createTutorial({
  key: 'gun',
  socket,
  title: '처음이라 총 쏘는 법을 연습해요',
  steps: [
    { id: 'cal', title: '화면 한가운데 겨누기', body: '폰을 큰 화면 정중앙으로 향하고\n아래 버튼을 눌러요.', svg: 'point', waitFor: 'cal', hint: '겨누고 버튼', okText: '조준을 맞췄어요!', render: stageCal },
    { id: 'aim', title: '조준점 움직이기', body: '폰을 좌우로 돌려서 내 조준점을\n양쪽 끝까지 보내 봐요.', svg: ART.aim, waitFor: 'aimed', hint: '왼쪽 끝, 오른쪽 끝', okText: '잘 따라와요!', render: stageAim },
    { id: 'shoot', title: '좀비 쏘기', body: '큰 화면의 연습 좀비에 조준점을 올리고\n발사를 눌러요.', svg: ART.shoot, waitFor: 'zhit', count: 2, hint: '두 번 맞혀요', okText: '명중!', render: stageShoot },
    {
      id: 'reload', title: '장전하기', body: '폰 앞쪽을 아래로 확 꺾으면 장전!\n장전 버튼을 눌러도 돼요.', svg: ART.reload, waitFor: 'reload', hint: '아래로 확 꺾기', render: stageReload,
      check: (d) => (d && d.how === 'flick' ? { ok: true, msg: '꺾어서 장전! 이게 제일 빨라요' } : { ok: true, msg: '버튼도 돼요. 경기 중엔 꺾기가 더 빨라요' })
    }
  ],
  finish: { title: '연습 끝!', body: '이제 준비를 누르면 돼요.\n모두 준비하면 바로 시작해요.', button: '좋아요' },
  onStep: (i, step) => {
    // 쏘기 단계: 큰 화면에 가까이 서 있는 연습 좀비를 세워 달라고 합니다.
    if (step.id === 'shoot') send('msg', { type: 'gun-target' });
    if (step.id === 'reload') { reloadingView = false; }
  },
  onDone: () => endTut()
});
tut.link($('tutLink'), {
  before: () => {
    if (state.phase === 'playing' || !me) return false;
    enterTut();
    return true;
  }
});
function enterTut() {
  if (fallback) startFake();
  mode = 'tut';
}
function startTutorial() {
  tutAuto = true;
  enterTut();
  tut.run();
}
function endTut() {
  if (mode === 'tut') mode = 'idle';
  ammoView = clamp(Number((myInfo() || {}).ammo ?? MAG), 0, MAG);
  render();
}
function shouldAutoTutorial() {
  return !tutAuto && me && (gotOri || fallback) && (state.phase === 'lobby' || state.phase === 'over') && !tut.isRunning() && tut.firstTime();
}

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
    if (v != null && v !== '') {
      const b = document.createElement('b');
      b.textContent = v;
      c.append(b);
    }
    box.append(c);
  }
}
let lastResult = null;
let cueText = '';
let cueTimer = null;
// 끌어서 조준하는 판(#fallback)을 지금 화면(경기 중 vPlay, 대기실 vWait)으로 옮깁니다. where = null 이면 숨김.
function placeFallback(where) {
  const f = $('fallback');
  if (where === 'vWait') $('vWait').insertBefore(f, $('tutLink'));
  else if (where === 'vPlay' && f.parentElement !== $('vPlay')) $('vPlay').appendChild(f);
  f.classList.toggle('hidden', !where);
  if (where) requestAnimationFrame(drawPadDot);
}
function showPlay(info) {
  mode = 'play';
  placeFallback(fallback ? 'vPlay' : null);
  $('fallbackHint').textContent = fallbackReason();
  $('score').textContent = Number(info.score || 0).toLocaleString('ko-KR');
  const hp = clamp(Number(info.hp ?? 100), 0, 100);
  $('hpT').textContent = String(hp);
  $('hpFill').style.width = `${hp}%`;
  $('hpBar').classList.toggle('low', hp <= 30 && hp > 0);
  reloadingView = Boolean(info.reloading);
  ammoView = clamp(Number(info.ammo ?? MAG), 0, MAG);
  drawAmmo();
  $('downOv').classList.toggle('on', Boolean(info.down));
  const st = $('status');
  st.className = 'status';
  const combo = info.mult > 1 ? ` · 콤보 x${info.mult}` : info.streak >= 3 ? ` · ${info.streak}연속` : '';
  if (info.down) st.textContent = '쓰러졌어요';
  else if (state.stage === 'intro') st.textContent = '곧 시작해요! 화면을 겨누고 기다려요';
  else if (state.stage === 'end') st.textContent = state.victory ? '작전 성공! 큰 화면을 보세요' : '전멸… 큰 화면을 보세요';
  else if (cueText) { st.textContent = cueText; st.classList.add('warn'); }
  else if (state.stage === 'move') st.textContent = `${state.stageName} · 이동 중`;
  else st.textContent = `웨이브 ${state.wave}/${state.waves} · 남은 좀비 ${state.foes ?? 0}${combo}`;
  show('vPlay');
}
// 누가 준비했고 누가 아직인지(폰에도 보여 줍니다)
function paintReadyRow() {
  const box = $('readyRow');
  const st = readyInfo;
  if (!st || !Array.isArray(st.players) || !st.players.length || state.phase === 'playing') {
    box.classList.add('hidden');
    return;
  }
  const ready = new Set(st.ready || []);
  const away = new Set(st.away || []);
  const waitFor = st.players.filter((s) => !ready.has(s));
  const mine = me && ready.has(me.slot);
  const head = !waitFor.length ? '모두 준비 완료!' : mine ? `${waitFor.map((s) => `${s}P`).join('·')} 기다리는 중` : `준비 ${ready.size}/${st.players.length}`;
  box.innerHTML = `<span class="rr-h">${head}</span>` + st.players.map((s) =>
    `<span class="rr${ready.has(s) ? ' on' : ''}${away.has(s) ? ' away' : ''}${me && s === me.slot ? ' mine' : ''}" style="--pc:${COLORS[s] || '#fff'}">${s}P${ready.has(s) ? ' ✓' : ''}</span>`).join('');
  box.classList.remove('hidden');
}
function showWait(info) {
  mode = 'wait';
  const phase = state.phase;
  const chips = [];
  if (roster.length) chips.push(['참가', `${roster.length}명`]);
  if (fallback) chips.push(['조작', '버튼']);
  else if (gotOri) chips.push(['조준', basis ? '맞춤' : '아직', basis ? 'ok' : '']);
  const mineReady = me && readyList.includes(me.slot);
  const go = $('btnGo');
  go.style.display = '';
  go.disabled = false;
  go.classList.remove('waiting', 'ready');
  if (phase === 'over') {
    if (info === 'result' && lastResult) {
      $('waitT').textContent = lastResult.rank === 1 ? '1위!' : `${lastResult.rank}위`;
      $('waitB').textContent = `${Number(lastResult.score || 0).toLocaleString('ko-KR')}점 · 처치 ${lastResult.kills || 0} · 헤드샷 ${lastResult.headshots || 0} · 명중률 ${lastResult.accuracy || 0}%\n큰 화면에서 순위를 확인해요.`;
    } else {
      $('waitT').textContent = state.victory ? '작전 성공' : '작전 종료';
      $('waitB').textContent = '큰 화면에서 순위를 확인해요.';
    }
    go.innerHTML = '다시 하기';
  } else if (phase === 'playing') {
    $('waitT').textContent = '관전 중';
    $('waitB').textContent = '지금 판이 끝나면 함께할 수 있어요.';
    go.style.display = 'none';
  } else {
    $('waitT').textContent = '대기실';
    $('waitB').textContent = basis || fallback || !gotOri
      ? '모두 준비를 누르면 시작해요.'
      : '준비를 누르면 먼저 화면 한가운데를\n겨누고 맞춰요. 그다음 시작 대기예요.';
    go.innerHTML = '준비';
  }
  if (mineReady && phase !== 'playing') {
    go.innerHTML = '준비 완료 ✓<small>다른 사람을 기다려요</small>';
    go.disabled = true;
    go.classList.add('waiting', 'ready');
  } else if (phase !== 'playing' && !gotOri && !fallback) {
    // 시작하고 1.5초 안: 센서가 되는지(조준) 버튼으로 할지 정해진 뒤에 준비를 받습니다.
    go.innerHTML = '준비<small>동작 센서 확인 중…</small>';
    go.classList.add('waiting');
  }
  setChips(chips, 'waitChips');
  paintReadyRow();
  const canCal = gotOri && !fallback;
  $('btnCalLobby').classList.toggle('hidden', !canCal);
  $('btnCalLobby').textContent = basis ? '조준 다시 맞추기' : '조준 맞추기';
  const canPractice = Boolean(basis) && phase === 'lobby';
  $('btnPractice').classList.toggle('hidden', !canPractice);
  // 버튼 모드: 대기실에서도 끌어서 조준하는 판을 연습 사격 아래에 둡니다.
  placeFallback(fallback && phase === 'lobby' ? 'vWait' : null);
  $('fallbackHint').textContent = fallbackReason();
  tut.setLinkVisible(phase !== 'playing');
  show('vWait');
}
function render() {
  if (!me) return;
  if (mode === 'start' || mode === 'connecting' || mode === 'msg') return;
  if (mode === 'cal' || mode === 'tut') return;
  const info = myInfo();
  // 버튼 모드는 기준이 정해져 있어 맞추기 없이 바로 준비 완료입니다.
  if (fallback) startFake();
  if (state.phase === 'playing' && info) {
    if (!basis && gotOri && !fallback) {
      openCal();
      return;
    }
    showPlay(info);
    return;
  }
  // 처음 하는 폰: 대기실(또는 결과 화면)에 들어오면 연습부터
  if (shouldAutoTutorial()) {
    startTutorial();
    return;
  }
  showWait(state.phase === 'over' && lastResult ? 'result' : info);
}
function fallbackReason() {
  let why = '동작 센서가 없어 버튼으로 해요.';
  if (!window.isSecureContext) why = 'https 주소가 아니라 동작 센서가 꺼져 있어요. 버튼으로 해요.';
  else if (permDenied) why = '동작 권한이 거절돼 버튼으로 해요.';
  else if (isTouch) why = '동작 센서 값이 없어 버튼으로 해요. Android 는 주소창 자물쇠 → 사이트 설정 → 동작 센서를 허용해 주세요.';
  return `${why} (키보드: Space 발사 · R 장전 · 방향키)`;
}
function sensorsChanged() {
  // 센서가 늦게 살아나면 시험 모드를 멈추고, 진짜 자세로 다시 맞추게 합니다.
  if (!fallback && fakeTimer) {
    clearInterval(fakeTimer);
    fakeTimer = null;
    if (basis && basis.fake) basis = null;
  }
  if (helpOn && mode === 'msg' && !fallback) {
    helpOn = false;
    join();
    return;
  }
  render();
}
function sensorHelp() {
  message('동작 센서를 쓸 수 없어요',
    'iPhone: Safari 를 앱 전환기에서 완전히 닫고 QR을 다시 찍은 뒤, 동작 접근을 허용해 주세요.\nAndroid: 주소창 자물쇠 → 사이트 설정 → 동작 센서를 허용해 주세요.',
    { label: '버튼으로 할게요', onClick: () => { fallback = true; join(); } });
  helpOn = true;
}
function keepAwake() {
  if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
}

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
socket.on('connect', () => {
  measureRtt();
  banner('');
  socket.emit('join', { role: 'controller', room: ROOM, token });
});
socket.on('disconnect', () => {
  if (me) banner('서버 연결이 끊겼어요. 다시 잇는 중…');
});
socket.on('assigned', (p) => {
  if (!p || p.game !== 'gun') {
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
  if (pendingCal && basis) {
    pendingCal = false;
    send('calibrate', {});
  }
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
  displayOn = Boolean(connected);
  banner(connected ? '' : '큰 화면이 꺼져 있어요. 다시 열리면 이어서 해요.');
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
socket.on('room_full', () => message('8명이 꽉 찼어요', '빈자리가 생기면 다시 찍어 주세요.'));
socket.on('replaced', () => message('다른 탭에서 열었어요', '마지막으로 연 화면에서 조작해요.'));
socket.on('room_closed', () => message('방이 닫혔어요', '큰 화면의 새 QR을 찍어 주세요.'));

socket.on('game_state', (s) => {
  const prev = state;
  state = s && typeof s === 'object' ? s : { phase: 'lobby' };
  if (state.phase === 'playing' && prev.phase !== 'playing') {
    lastResult = null;
    readyList = [];
    readyInfo = null;
    // 다시 하기 링크로 연습하던 중에 판이 시작되면 연습을 닫고 경기로
    if (tut.isRunning()) {
      tut.cancel();
      mode = 'idle';
    }
  }
  const info = myInfo();
  const prevInfo = prev.players && me ? prev.players[me.slot] : null;
  if (info && prevInfo && info.down && !prevInfo.down) feel('down');
  // 대기실 연습 사격도 탄 수를 맞춥니다(경기 중에는 showPlay 가 맞춤). 튜토리얼 장전 단계는 일부러 비워 둔 모습이라 그대로.
  if (info && state.phase === 'lobby' && !(mode === 'tut' && tutStepId() === 'reload')) {
    ammoView = clamp(Number(info.ammo ?? MAG), 0, MAG);
    reloadingView = Boolean(info.reloading);
  }
  render();
});
// 큰 화면의 알림(웨이브 시작·보스 등): 상태 줄에 잠깐 보여 줍니다.
socket.on('cue', (c) => {
  cueText = c && c.text ? String(c.text) : '';
  clearTimeout(cueTimer);
  cueTimer = setTimeout(() => { cueText = ''; if (mode === 'play') render(); }, 2600);
  feel('cue');
  if (mode === 'play') render();
});
// 큰 화면이 판정한 결과: 맞히면 쏠 때보다 세게, 머리·처치는 더 세게 울립니다.
socket.on('hit', (h) => {
  const kind = h && h.kind;
  if (kind === 'hit' || kind === 'head' || kind === 'kill') {
    feel(kind);
    if (tutTv) tutTv.pop();
    if (mode === 'tut' && tutStepId() === 'shoot') tut.signal('zhit', h);
  } else if (kind === 'hurt') feel('hurt');
  else if (kind === 'empty') { if (performance.now() - lastEmptyAt > 400) feel('empty'); }
  else if (kind === 'reload') feel('reload');
  else if (kind === 'medkit') feel('medkit');
});
socket.on('result', (r) => {
  lastResult = r || null;
  if (r && r.rank === 1) feel('win');
  render();
});

// ---------- 버튼 ----------
haptics.torch.mountToggle($('torchBox'));
$('btnStart').addEventListener('click', async () => {
  if (mode !== 'start') return;
  mode = 'connecting';
  $('btnStart').disabled = true;
  // iPhone 은 탭 안에서, await 전에 화면 꺼짐 방지와 권한을 함께 요청해야 합니다.
  keepAwake();
  haptics.unlock();
  const asks = [];
  if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
    asks.push(DeviceOrientationEvent.requestPermission().catch(() => 'denied'));
  }
  if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') {
    asks.push(DeviceMotionEvent.requestPermission().catch(() => 'denied'));
  }
  const res = await Promise.all(asks);
  permDenied = res.some((x) => x !== 'granted');
  window.addEventListener('deviceorientation', onOrientation);
  if (!ROOM) {
    message('방 코드가 없어요', '큰 화면의 QR을 찍어 주세요.');
    return;
  }
  if (permDenied && isTouch && !DEBUG) {
    sensorHelp();
    return;
  }
  join();
  setTimeout(() => {
    if (gotOri) return;
    if (isTouch && !DEBUG && window.isSecureContext) {
      fallback = true;
      sensorHelp();
      return;
    }
    fallback = true;
    debug('동작 센서 값이 들어오지 않아 버튼으로 해요');
    sensorsChanged();
  }, SENSOR_WAIT_MS);
});
// 준비: 조준을 아직 안 맞췄으면 맞추고 나서 바로 준비 완료로 넘어갑니다.
$('btnGo').addEventListener('click', () => {
  keepAwake();
  if (me && readyList.includes(me.slot) && state.phase !== 'playing') return;
  if (!gotOri && !fallback) return; // 센서 확인 중(곧 다시 그려짐)
  if (!basis && gotOri && !fallback) {
    pendingReady = true;
    openCal();
    return;
  }
  if (send('start_game', {})) {
    haptics.tick();
    // 서버의 ready_state 가 오기 전에 바로 '준비 완료'로 보여 줍니다.
    if (me && !readyList.includes(me.slot)) readyList = [...readyList, me.slot];
    render();
  }
});
$('btnCalLobby').addEventListener('click', () => openCal());
$('btnRecal').addEventListener('click', () => {
  // 경기 중: 화면을 안 바꾸고 지금 겨눈 곳을 바로 중앙으로
  if (captureBasis()) {
    const st = $('status');
    st.textContent = '조준을 다시 맞췄어요';
  }
});
$('btnReady').addEventListener('click', () => {
  if (!gotOri) {
    $('calB').textContent = '방향 센서 값이 들어오지 않아요.\n잠시 뒤 다시 눌러 주세요.';
    return;
  }
  if (!captureBasis()) {
    $('calB').textContent = '방향 센서 값이 끊겼어요.\n다시 눌러 주세요.';
    return;
  }
  mode = 'idle';
  if (pendingReady) {
    pendingReady = false;
    if (send('start_game', {}) && me && !readyList.includes(me.slot)) readyList = [...readyList, me.slot];
  }
  render();
});
$('btnCalCancel').addEventListener('click', () => {
  pendingReady = false;
  mode = 'idle';
  render();
});
for (const id of ['btnTrigger', 'btnPractice']) {
  const b = $(id);
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    b.classList.add('on');
    doShoot();
  });
  const up = () => b.classList.remove('on');
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('pointerleave', up);
}
$('btnReload').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  doReload('button');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (mode !== 'start') keepAwake();
  render();
});

if (!window.isSecureContext) $('httpNote').classList.remove('hidden');
paintDiff();

// ---------- 디버그 (&debug) ----------
let lastHaptic = '';
function debug(t) {
  if (DEBUG) $('debug').textContent = t;
}
if (DEBUG) {
  document.body.classList.add('dbg');
  haptics.onEvent((h) => { lastHaptic = `${h.kind}${h.remote ? '(화면)' : ''}→${h.skipped || h.did}`; });
  let lastO = 0;
  setInterval(() => {
    debug(`ori ${(oriCount - lastO) * 2}Hz rtt ${Math.round(rtt())}ms aim ${cur.x.toFixed(2)},${cur.y.toFixed(2)} ` +
      `basis ${basis ? (basis.fake ? 'fake' : basis.back ? 'back' : 'top') : 'N'} mode ${mode} fallback ${fallback ? 'Y' : 'N'} ` +
      `diff ${ps.difficulty()} haptic ${lastHaptic || '-'}`);
    lastO = oriCount;
  }, 500);
}
window.__gunPhone = {
  get state() { return state; }, get mode() { return mode; }, get basis() { return basis; }, get fallback() { return fallback; },
  cur, FAKE, doShoot, doReload, onOrientation, deviceVectors, makeBasis, aimOf, captureBasis, tut, ps, haptics, feel, startTutorial
};
