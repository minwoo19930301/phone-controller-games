// 좀비 건 컨트롤러. 폰이 총입니다.
// 폰을 화면 쪽으로 겨누면 방향(deviceorientation)을 '중앙 맞추기' 때의 자세 기준으로 바꿔 화면 안의 위치(x, y: 0~1)로 보냅니다.
// 큰 방아쇠는 shoot(누른 순간의 조준 위치와 센서 지연 ago 를 같이 보냄)이고, 쉬움·보통에서는 누르고 있으면 계속 쏘고 탄이 비면 저절로 장전합니다.
// 어려움에서만 폰을 아래로 확 꺾거나 장전 버튼으로 직접 장전합니다(쉬움·보통에도 작은 장전 버튼은 있음).
// 중앙 맞추기는 따로 하지 않습니다: 폰이 잠깐 가만히 있을 때·준비를 누를 때·경기 시작 직전(3-2-1 끝)에 알아서 잡고, '다시 맞추기'는 선택입니다.
// 폰을 리모컨처럼 눕혀 쥐면 윗부분이, 카메라처럼 세워 쥐면 뒷면이 겨누는 방향입니다(맞추는 순간 자세로 자동 판단).
//
// 공통 모듈:
// - haptics: 쏠 때마다 짧은 진동 + 총구 번쩍 + (켰으면) 손전등. 좀비를 맞히면 큰 화면의 'hit' 를 받아 더 세게 울립니다.
// - phone-settings: 대기 화면의 난이도 알약(큰 화면이 값의 주인)
// - tutorial: 저절로 시작하지 않고, 대기실의 '튜토리얼 다시 하기' 링크를 눌렀을 때만 좀비 쏘기 한 단계
import { haptics } from '/common/haptics.js';
import { createPhoneSettings } from '/common/phone-settings.js';
import { createTutorial } from '/common/tutorial.js';
import { requestMotionPermission } from '/common/motion.js';
import { t as tr, lang, mountSwitcher } from '/common/i18n.js';
import '/gun/i18n.js';

const $ = (id) => document.getElementById(id);
const RD = Math.PI / 180;
// 점수 표기: 지금 언어의 자릿점
const LOCALES = { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN' };
const nf = (n) => Number(n).toLocaleString(LOCALES[lang()] || 'en-US');
const params = new URLSearchParams(location.search);
const ROOM = (params.get('room') || '').toUpperCase();
const DEBUG = params.has('debug');
$('room').textContent = ROOM ? tr('방 {code}', { code: ROOM }) : '';

// ---------- 조정 값 (실폰 검증 전이라 바뀔 수 있습니다) ----------
const AIM_MS = 33; // aim 전송 간격, 약 30Hz
const RANGE_X = { easy: 16, normal: 18, hard: 26 }; // 중앙에서 좌우로 이 각도(도)를 돌리면 화면 가장자리(낮을수록 살짝만 돌려도)
const RANGE_Y = { easy: 10, normal: 11, hard: 17 }; // 위아래
const SMOOTH = { easy: 0.42, normal: 0.5, hard: 0.55 }; // 보내기 전 한 번 다듬기(0~1, 클수록 빠르게 따라감, 낮으면 손떨림이 덜함)
const FLICK_DEG = { hard: 45 }; // 어려움에서만: 이만큼 아래로 꺾으면 장전(쉬움·보통은 탄이 비면 저절로 장전)
const FLICK_HINT_FRAC = 0.55; // 꺾은 정도가 이 비율 이상인데 모자라면 '더 크게!'
const FLICK_MS = 260;
const HOLD_MS = { easy: 170, normal: 210, hard: 0 }; // 방아쇠를 누르고 있으면 이 간격으로 계속 쏨(0 = 한 번 눌러 한 발)
const STILL_MS = 400; // 이만큼 가만히 있으면 그 자세를 중앙으로 잡음
const STILL_DEV = 0.0014; // 가만히 있다고 보는 흔들림(1-cos, 약 3도)
const RELOAD_COOL_MS = 1100;
const CAL_BACK_MS = 120; // 맞추는 순간의 흔들림을 피해 이만큼 전 값부터 씁니다
const CAL_SPAN_MS = 280;
const SENSOR_WAIT_MS = 3000; // 이 시간 안에 동작 센서 값이 없으면 버튼 모드
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
let pendingGo = false; // 센서 확인 중에 누른 준비(확인이 끝나면 이어서 보냄)
let recenterAtStart = false; // 경기 시작 직전(3-2-1)에 자세를 한 번 더 잡음
let noRoomTries = 0;
let helpOn = false;
let displayOn = true;
let readyList = [];
let readyInfo = null; // 서버의 ready_state { ready, players, away, need }

function show(id) {
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === id);
  $('btnRecal').classList.toggle('hidden', !(id === 'vPlay' && gotOri && !fallback));
}
function message(title, b, btn) {
  helpOn = false;
  mode = 'msg';
  $('msgT').textContent = tr(title);
  $('msgB').textContent = b ? tr(b) : '';
  $('btnMsg').classList.toggle('hidden', !btn);
  if (btn) {
    $('btnMsg').textContent = tr(btn.label);
    $('btnMsg').onclick = btn.onClick;
  }
  show('vMsg');
}
function banner(text) {
  $('banner').textContent = text ? tr(text) : '';
  $('banner').classList.toggle('hidden', !text);
}

// 눌렀는데 안 되는 때: 짧은 안내 한 줄 + 틱 (조용히 무시하지 않습니다)
let toastTimer = null;
function toast(text, ms = 1300) {
  const e = $('toast');
  e.textContent = tr(text);
  e.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => e.classList.add('hidden'), ms);
}
function refuse(text) {
  haptics.tick();
  toast(text);
}

// ---------- 공통: 난이도 알약 · 손맛 ----------
const ps = createPhoneSettings();
ps.attach(socket);
ps.mount($('setBox'));
ps.bindReady($('btnGo'));
ps.onChange(() => paintDiff());
const flickDeg = () => (ps.difficulty() === 'hard' ? FLICK_DEG.hard : 0);
const rangeX = () => ps.pick(RANGE_X);
const rangeY = () => ps.pick(RANGE_Y);
const smooth = () => ps.pick(SMOOTH);
const holdGap = () => ps.pick(HOLD_MS);
function paintDiff() {
  const d = ps.difficulty();
  for (const id of ['dTag']) {
    const e = $(id);
    e.textContent = DIFF_LABEL[d] || '쉬움';
    e.dataset.d = d;
  }
  // 쉬움·보통: 큰 방아쇠가 거의 전부(장전은 저절로), 어려움: 장전 칸이 예전처럼 큼
  $('pads').classList.toggle('auto', d !== 'hard');
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
  return { x: 0.5 + yaw / (2 * rangeX()), y: 0.5 - pitch / (2 * rangeY()), pitch: Math.asin(clamp(v[1], -1, 1)) / RD };
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
  if (!basis && !fallback) autoBasis(t);
  if (fallback || !basis || basis.fake) return;
  const a = aimOf(basis, ori.top, ori.face);
  cur.x = clamp(cur.x + (a.x - cur.x) * smooth(), -0.1, 1.1);
  cur.y = clamp(cur.y + (a.y - cur.y) * smooth(), -0.1, 1.1);
  pitchBuf.push({ t, p: a.pitch });
  while (pitchBuf.length && pitchBuf[0].t < t - FLICK_MS) pitchBuf.shift();
  checkFlick(t, a.pitch);
  if (streaming() && t >= nextAimAt) {
    nextAimAt = Math.max(nextAimAt + AIM_MS, t + AIM_MS * 0.4);
    send('aim', { x: r4(clamp(cur.x, 0, 1)), y: r4(clamp(cur.y, 0, 1)) }, true);
  }
}
// 폰이 잠깐 가만히 있으면 그 자세를 중앙으로 잡습니다(따로 '중앙 맞추기'를 시키지 않습니다).
function autoBasis(t) {
  if (!me || oriBuf.length < 6 || oriBuf[0].t > t - STILL_MS * 0.8) return;
  const win = oriBuf.filter((o) => o.t >= t - STILL_MS);
  if (win.length < 6) return;
  const mt = norm(win.reduce((a, o) => add(a, o.top), [0, 0, 0]));
  const mf = norm(win.reduce((a, o) => add(a, o.face), [0, 0, 0]));
  for (const o of win) if (1 - dot(o.top, mt) > STILL_DEV || 1 - dot(o.face, mf) > STILL_DEV) return;
  if (captureBasis(true) && mode === 'wait') render();
}
// 어려움에서만: 폰을 아래로 확 꺾으면 장전(짧은 시간에 겨눈 높이가 크게 내려간 경우). 모자라게 꺾으면 '더 크게!'
let lastFlickHintAt = -1e9;
function checkFlick(t, pitch) {
  const deg = flickDeg();
  if (!deg || mode !== 'play' || t - lastReloadAt < RELOAD_COOL_MS) return;
  let hi = -999;
  for (const p of pitchBuf) hi = Math.max(hi, p.p);
  const drop = hi - pitch;
  if (drop >= deg) {
    pitchBuf.length = 0;
    doReload('flick');
  } else if (drop >= deg * FLICK_HINT_FRAC && ammoView < MAG && t - lastFlickHintAt > 1500) {
    lastFlickHintAt = t;
    refuse('더 크게!');
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
const practicing = () => state.phase === 'lobby' && Boolean(me);
// repeat: 누르고 있어서 되풀이로 부른 것(안 되는 때에도 안내를 되풀이하지 않음)
function doShoot(repeat = false) {
  const live = inGame();
  if (!(live || practicing())) {
    // 튜토리얼을 결과 화면에서 하면 큰 화면에 연습 좀비가 없으니, 누르는 것만으로 연습합니다.
    if (mode === 'tut' && tutStepId() === 'shoot') {
      feel('shot');
      tut.signal('zhit', { offline: true });
      return;
    }
    if (repeat) return;
    const info = myInfo();
    if (info && info.down) refuse('쓰러졌어요');
    else if (state.phase === 'playing' && state.stage === 'intro') refuse('곧 시작해요');
    else if (state.phase === 'playing' && state.stage === 'end') refuse('끝났어요');
    else refuse('지금은 쏠 수 없어요');
    return;
  }
  // 센서는 되는데 아직 중앙을 못 잡았으면 지금 겨눈 곳을 중앙으로
  if (!basis && gotOri && !fallback) captureBasis(true);
  const now = performance.now();
  if (!send('shoot', { x: r4(clamp(cur.x, 0, 1)), y: r4(clamp(cur.y, 0, 1)), ago: Math.max(0, Math.round(now - (lastOriT || now))), rtt: Math.round(rtt()) })) {
    if (!repeat) refuse('연결이 끊겼어요');
    return;
  }
  const empty = !reloadingView && ammoView <= 0;
  if (!reloadingView) {
    ammoView = Math.max(0, ammoView - 1);
    drawAmmo();
  }
  // 빈 총은 찰칵(틱)만, 쏘면 진동 + 총구 번쩍 + 손전등
  if (empty || reloadingView) lastEmptyAt = now;
  feel(empty || reloadingView ? 'empty' : 'shot');
}
function doReload(how = 'button') {
  if (ammoView >= MAG && !reloadingView) {
    // 이미 가득: 눌렀는데 아무 일도 없는 것처럼 보이지 않게
    if (how !== 'flick') refuse('탄이 가득 차 있어요');
    return;
  }
  if (reloadingView) {
    if (how !== 'flick') refuse('장전 중이에요');
    return;
  }
  lastReloadAt = performance.now();
  if (!send('reload', {})) {
    refuse('연결이 끊겼어요');
    return;
  }
  feel('reload');
}
// 방아쇠를 누르고 있으면 계속 쏩니다(쉬움·보통). 손을 떼거나 화면이 가려지면 반드시 멈춥니다.
let holdTimer = null;
function stopHold() {
  clearInterval(holdTimer);
  holdTimer = null;
}
function startHold() {
  stopHold();
  const gap = holdGap();
  if (!gap) return;
  holdTimer = setInterval(() => {
    if (document.hidden || !(mode === 'play' || mode === 'wait' || mode === 'tut')) { stopHold(); return; }
    doShoot(true);
  }, gap);
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
  $('btnReload').textContent = reloadingView ? tr('장전 중…') : ammoView <= 0 ? tr('장전!') : tr('장전');
}

// ---------- 자세 맞추기 ----------
function openCal() {
  mode = 'cal';
  $('btnReady').classList.remove('hidden');
  $('btnCalCancel').classList.remove('hidden');
  $('calT').textContent = tr('다시 맞추기');
  $('calB').textContent = tr('화면 가운데를 겨누고 눌러요.');
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
// 연습(튜토리얼): 저절로 시작하지 않고, 대기실의 '튜토리얼 다시 하기'를 눌렀을 때만 '좀비 쏘기' 한 단계
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
// 조준점을 좀비에 올리고 엄지로 방아쇠
const ART_SHOOT = () => svgArt(
  '<rect x="40" y="8" width="120" height="74" rx="7" class="pcgt-tv"/><path d="M100 82v8M84 92h32" class="pcgt-tvs"/>' +
  '<g fill="#6f9a63"><circle cx="100" cy="30" r="9"/><rect x="90" y="40" width="20" height="28" rx="6"/><rect x="80" y="42" width="8" height="18" rx="4" transform="rotate(-25 84 42)"/><rect x="112" y="42" width="8" height="18" rx="4" transform="rotate(25 116 42)"/></g>' +
  '<circle cx="100" cy="32" r="12" class="pcgt-arrow"/><path d="M100 16v7M100 41v7M84 32h7M109 32h7" class="pcgt-arrow"/>' +
  '<g opacity="0"><animate attributeName="opacity" values="0;1;0;0" keyTimes="0;.12;.3;1" dur="1.2s" repeatCount="indefinite"/>' +
  '<path d="M100 32l-16 -12M100 32l17 -11M100 32l-18 10M100 32l16 12" stroke="#ffd23a" stroke-width="3" stroke-linecap="round"/><circle cx="100" cy="32" r="6" fill="#fff6c9"/></g>' +
  `<g transform="translate(100 128)">${PH.replace('class="pcgt-scr"', 'class="pcgt-scr" style="opacity:.75"')}</g>` +
  '<circle cx="100" cy="134" r="9" class="pcgt-ring"><animate attributeName="r" values="7;13;7" keyTimes="0;.12;1" dur="1.2s" repeatCount="indefinite"/></circle>' +
  '<rect x="112" y="128" width="30" height="18" rx="8" class="pcgt-hand" transform="rotate(-28 112 128)"><animateTransform attributeName="transform" type="rotate" values="-28 112 128;-36 112 128;-28 112 128" keyTimes="0;.12;1" dur="1.2s" repeatCount="indefinite"/></rect>'
);

const tutStepId = () => {
  const c = tut.current();
  return c ? c.id : null;
};
// 큰 화면을 흉내 낸 작은 화면: 내 조준점이 어디 있는지 보여 주고, 버튼 모드에서는 끌어서 조준합니다.
function miniTv(parent, o = {}) {
  const tv = el('div', `gt-tv${o.small ? ' small' : ''}${fallback ? ' drag' : ''}`,
    '<div class="gt-xh"></div><span class="gt-tvlabel">' + tr(fallback ? '끌어서 조준' : '큰 화면') + '</span>');
  parent.appendChild(tv);
  const xh = tv.querySelector('.gt-xh');
  if (fallback) dragAim(tv);
  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    xh.style.left = `${(clamp(cur.x, 0, 1) * 100).toFixed(2)}%`;
    xh.style.top = `${(clamp(cur.y, 0, 1) * 100).toFixed(2)}%`;
  };
  loop();
  return {
    el: tv,
    pop() { xh.classList.remove('pop'); void xh.offsetWidth; xh.classList.add('pop'); },
    stop() { cancelAnimationFrame(raf); }
  };
}
function compact(stage) {
  const card = stage.closest('.pcgt-card');
  if (card) card.classList.add('gt-compact');
}
let tutTv = null;
function stageShoot(stage) {
  compact(stage);
  if (!basis && gotOri && !fallback) captureBasis(true);
  const wrap = el('div', 'gt-shoot');
  stage.appendChild(wrap);
  tutTv = miniTv(wrap, { small: true });
  const trig = el('button', 'gt-trig', tr('발사'));
  trig.type = 'button';
  trig.addEventListener('pointerdown', (e) => { e.preventDefault(); trig.classList.add('on'); doShoot(); startHold(); });
  const up = () => { trig.classList.remove('on'); stopHold(); };
  trig.addEventListener('pointerup', up);
  trig.addEventListener('pointercancel', up);
  trig.addEventListener('pointerleave', up);
  wrap.appendChild(trig);
  return () => { stopHold(); if (tutTv) tutTv.stop(); tutTv = null; };
}
const tut = createTutorial({
  key: 'gun',
  socket,
  title: '처음이라 연습해 봐요',
  steps: [
    { id: 'shoot', title: '좀비 쏘기', body: '겨누고 발사!', svg: ART_SHOOT, waitFor: 'zhit', count: 2, render: stageShoot }
  ],
  onStep: (i, step) => {
    // 쏘기 단계: 큰 화면에 가까이 서 있는 연습 좀비를 세워 달라고 합니다.
    if (step.id === 'shoot') send('msg', { type: 'gun-target' });
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
function endTut() {
  if (mode === 'tut') mode = 'idle';
  ammoView = clamp(Number((myInfo() || {}).ammo ?? MAG), 0, MAG);
  render();
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
  $('score').textContent = nf(info.score || 0);
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
  const combo = info.mult > 1 ? ` · ${tr('콤보 x{m}', { m: info.mult })}` : info.streak >= 3 ? ` · ${tr('{n}연속', { n: info.streak })}` : '';
  if (info.down) st.textContent = tr('쓰러졌어요');
  else if (state.stage === 'intro') st.textContent = tr('준비!');
  else if (state.stage === 'end') st.textContent = state.victory ? tr('작전 성공!') : tr('전멸…');
  else if (cueText) { st.textContent = tr(cueText); st.classList.add('warn'); }
  else if (state.stage === 'move') st.textContent = tr('{stage} · 이동 중', { stage: state.stageName });
  else st.textContent = tr('웨이브 {w}/{n} · 남은 좀비 {k}', { w: state.wave, n: state.waves, k: state.foes ?? 0 }) + combo;
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
  const head = !waitFor.length ? tr('모두 준비 완료!') : mine ? tr('{s} 기다리는 중', { s: waitFor.map((s) => `${s}P`).join('·') }) : tr('준비 {a}/{b}', { a: ready.size, b: st.players.length });
  box.innerHTML = `<span class="rr-h">${head}</span>` + st.players.map((s) =>
    `<span class="rr${ready.has(s) ? ' on' : ''}${away.has(s) ? ' away' : ''}${me && s === me.slot ? ' mine' : ''}" style="--pc:${COLORS[s] || '#fff'}">${s}P${ready.has(s) ? ' ✓' : ''}</span>`).join('');
  box.classList.remove('hidden');
}
function showWait(info) {
  mode = 'wait';
  const phase = state.phase;
  const chips = [];
  if (roster.length) chips.push([tr('참가 {n}명', { n: roster.length })]);
  if (fallback) chips.push([tr('조작'), tr('버튼')]);
  const mineReady = me && readyList.includes(me.slot);
  const go = $('btnGo');
  go.style.display = '';
  go.disabled = false;
  go.classList.remove('waiting', 'ready');
  if (phase === 'over') {
    if (info === 'result' && lastResult) {
      $('waitT').textContent = lastResult.rank === 1 ? tr('1위!') : tr('{r}위', { r: lastResult.rank });
      $('waitB').textContent = tr('{s}점 · 처치 {k} · 헤드샷 {h} · 명중률 {a}%', { s: nf(lastResult.score || 0), k: lastResult.kills || 0, h: lastResult.headshots || 0, a: lastResult.accuracy || 0 });
    } else {
      $('waitT').textContent = state.victory ? tr('작전 성공') : tr('작전 종료');
      $('waitB').textContent = '';
    }
    go.textContent = tr('다시 하기');
  } else if (phase === 'playing') {
    $('waitT').textContent = tr('관전 중');
    $('waitB').textContent = tr('지금 판이 끝나면 함께할 수 있어요.');
    go.style.display = 'none';
  } else {
    $('waitT').textContent = tr('대기실');
    $('waitB').textContent = tr('모두 준비하면 시작해요.');
    go.textContent = tr('준비');
  }
  if (mineReady && phase !== 'playing') {
    go.innerHTML = `${tr('준비 완료 ✓')}<small>${tr('다른 사람을 기다려요')}</small>`;
    go.disabled = true;
    go.classList.add('waiting', 'ready');
  }
  setChips(chips, 'waitChips');
  paintReadyRow();
  const canCal = gotOri && !fallback;
  $('btnCalLobby').classList.toggle('hidden', !canCal);
  $('btnCalLobby').textContent = tr('다시 맞추기');
  const canPractice = (gotOri || fallback) && phase === 'lobby';
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
    // 중앙을 아직 못 잡았으면 지금 겨눈 곳으로 조용히 잡습니다(맞추기 화면 없음).
    if (!basis && gotOri && !fallback) captureBasis(true);
    showPlay(info);
    return;
  }
  showWait(state.phase === 'over' && lastResult ? 'result' : info);
}
function fallbackReason() {
  let why = tr('버튼으로 해요.');
  if (!window.isSecureContext) why = tr('https 아니면 버튼으로 해요.');
  else if (permDenied) why = tr('동작 권한이 없어 버튼으로 해요.');
  return isTouch ? why : `${why} ${tr('(Space 발사 · R 장전 · 방향키)')}`;
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
  if (pendingGo) pressReady();
}
function sensorHelp() {
  // 쓰는 폰에 맞는 한 줄만 보여 줍니다.
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  message('동작 센서를 쓸 수 없어요',
    ios ? 'Safari를 닫고 QR을 다시 찍어 허용해 주세요.' : '주소창 자물쇠 → 사이트 설정 → 동작 센서 허용',
    { label: '버튼으로 할게요', onClick: () => { fallback = true; join(); } });
  helpOn = true;
}
function keepAwake() {
  if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
}

// ---------- 소켓 ----------
function join() {
  mode = 'connecting';
  $('msgT').textContent = tr('들어가는 중…');
  $('msgB').textContent = tr('큰 화면과 연결하고 있어요.');
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
  // 경기 시작 직전(3-2-1)에는 화면을 겨누고 있으니, 3-2-1 이 끝나는 순간의 자세를 중앙으로 한 번 더 잡습니다.
  if (state.phase === 'playing' && state.stage === 'intro') recenterAtStart = true;
  else if (recenterAtStart && state.phase === 'playing') {
    recenterAtStart = false;
    if (gotOri && !fallback && basis && !basis.fake) captureBasis(true);
  } else if (state.phase !== 'playing') recenterAtStart = false;
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
  // 한 번의 탭에서 움직임·방향 허락을 같이 묻습니다(허락창이 없는 폰은 바로 granted).
  const perm = await requestMotionPermission();
  permDenied = perm === 'denied';
  window.addEventListener('deviceorientation', onOrientation);
  if (!ROOM) {
    message('방 코드가 없어요', '큰 화면의 QR을 찍어 주세요.');
    return;
  }
  // 움직임만 거절돼도 방향 센서가 오면 그대로 합니다(안 오면 아래 대기 뒤에 안내).
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
// 준비: 중앙 맞추기 없이 바로 준비 완료입니다(자세는 알아서 잡음). 센서 확인 중에 누르면 확인이 끝나는 대로 이어서 보냅니다.
function pressReady() {
  keepAwake();
  if (me && readyList.includes(me.slot) && state.phase !== 'playing') { pendingGo = false; return; }
  if (!gotOri && !fallback) {
    pendingGo = true;
    haptics.tick();
    toast('센서 확인 중…', 3200);
    return;
  }
  pendingGo = false;
  if (!basis && gotOri && !fallback) captureBasis(true);
  if (send('start_game', {})) {
    haptics.tick();
    // 서버의 ready_state 가 오기 전에 바로 '준비 완료'로 보여 줍니다.
    if (me && !readyList.includes(me.slot)) readyList = [...readyList, me.slot];
    render();
  } else refuse('연결이 끊겼어요');
}
$('btnGo').addEventListener('click', pressReady);
$('btnCalLobby').addEventListener('click', () => openCal());
$('btnRecal').addEventListener('click', () => {
  // 경기 중: 화면을 안 바꾸고 지금 겨눈 곳을 바로 중앙으로
  if (captureBasis()) {
    const st = $('status');
    st.textContent = tr('조준을 다시 맞췄어요');
  }
});
// 선택: 대기실의 '다시 맞추기'(화면 가운데를 겨누고 누르기)
$('btnReady').addEventListener('click', () => {
  if (!gotOri) {
    $('calB').textContent = tr('센서 값이 없어요. 잠시 뒤 다시 눌러요.');
    return;
  }
  if (!captureBasis()) {
    $('calB').textContent = tr('센서 값이 끊겼어요. 다시 눌러요.');
    return;
  }
  mode = 'idle';
  render();
});
$('btnCalCancel').addEventListener('click', () => {
  mode = 'idle';
  render();
});
for (const id of ['btnTrigger', 'btnPractice']) {
  const b = $(id);
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    b.classList.add('on');
    doShoot();
    startHold();
  });
  const up = () => { b.classList.remove('on'); stopHold(); };
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('pointerleave', up);
}
$('btnReload').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  doReload('button');
});
window.addEventListener('blur', stopHold);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopHold(); return; }
  if (mode !== 'start') keepAwake();
  render();
});

if (!window.isSecureContext) $('httpNote').classList.remove('hidden');
// 언어 고르기: 시작 화면에서만 보입니다.
mountSwitcher($('langBox'), { reload: true, compact: true });
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
  cur, FAKE, doShoot, doReload, onOrientation, deviceVectors, makeBasis, aimOf, captureBasis, tut, ps, haptics, feel
};
