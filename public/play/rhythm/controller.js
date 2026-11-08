// 리듬 스텝 폰 컨트롤러.
// 사람마다 입력을 고릅니다.
//   패드: 폰 화면 전체가 발판(4키 DDR ← ↓ ↑ →, 5키 펌프 ↙ ↖ ● ↗ ↘). 누르면 step, 떼면 release(길게 누르기).
//   모션: 폰을 세워 든 채 위·아래·왼쪽·오른쪽으로 휙(motion.js). 한 번 휙 = 한 스텝.
// 대기실에서는 폰 화면을 좌우로 밀어 큰 화면의 CD 를 넘기고, 탭하면 그 곡으로 정합니다(누가 고르는지 큰 화면에 뜸).
// 난이도·입력·패드 배치는 공통 설정(phone-settings)의 '나만' 값이라 c2d settings 로 큰 화면에 보냅니다.
// 판정은 큰 화면이 오디오 시계로 합니다. 폰은 누른 순간부터 보낼 때까지 걸린 시간(ago)과 왕복 시간(rtt)을 같이 보냅니다.
// 처음이면 입력 방식마다 튜토리얼(rhythm-pad / rhythm-motion)을 띄웁니다. 모션은 자세 맞추기 다음에.
// 시험: &debug(센서 값·버튼), ?tut=1, 키보드 D F J K / 화살표(패드), window.__rhythmPhone
import { haptics } from '/common/haptics.js';
import { createPhoneSettings } from '/common/phone-settings.js';
import { createTutorial } from '/common/tutorial.js';
import { drawCover } from '/common/disc-picker.js';
import { createStepDetector, DIRS } from './motion.js';
import { createPad } from './pad.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ROOM = (params.get('room') || '').toUpperCase();
const DEBUG = params.has('debug');
const PLAY_URL = (g) => (g === 'baseball' ? '/play/' : `/play/${g}/`);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// ---------- 조정 값 ----------
const SENSOR_WAIT_MS = 1500; // 이 안에 동작 센서 값이 안 오면 버튼으로 대신합니다
const STILL_MS = 700; // 자세 맞추기: 이만큼 가만히
const BASE_THRESHOLD = 7.5; // 모션 스텝 문턱(m/s²). 감도로 곱합니다
// 정반대 방향이 바로 오면 '제자리로 돌아오는 동작'으로 봅니다. 어려움은 노트 간격(0.36초)이 짧아 창을 줄입니다.
const OPPOSITE_MS = { easy: 420, normal: 400, hard: 280 };
const DIR_TO = { left: '왼쪽으로', down: '아래로', up: '위로', right: '오른쪽으로' };
const PREF_KEY = 'pcg-rhythm-pref'; // 이 폰이 고른 입력·배치·난이도(다음에 들어와도 그대로)
const SENS_KEY = 'pcg-rhythm-sens';
const GLYPH = { 4: ['←', '↓', '↑', '→'], 5: ['↙', '↖', '●', '↗', '↘'] };
const DIFF_LABEL = { easy: '쉬움', normal: '보통', hard: '어려움' };
const JTEXT = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS', ok: 'OK!', ng: 'NG' };
const COLORS = { 1: '#ff5a5f', 2: '#3ab4ff', 3: '#ffc93c', 4: '#5ee07a' };
const GRADE_COL = { S: '#ffd23a', A: '#5ef0a0', B: '#7fd4ff', C: '#c9a6ff' };
const KEYMAP = {
  4: { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3, ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 },
  5: { KeyZ: 0, KeyQ: 1, KeyS: 2, KeyE: 3, KeyC: 4, KeyD: 0, KeyF: 1, Space: 2, KeyJ: 3, KeyK: 4 }
};

if (ROOM) $('room').textContent = `방 ${ROOM}`;
if (!window.isSecureContext) $('httpNote').classList.remove('hidden');

let token = null;
try { token = localStorage.getItem('pcg-token'); } catch (e) {}
if (!token) {
  token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try { localStorage.setItem('pcg-token', token); } catch (e) {}
}
function loadJSON(k, d) { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch (e) { return d; } }
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
const pref = { input: null, lanes: null, difficulty: null, ...loadJSON(PREF_KEY, {}) };
function savePref(k, v) { pref[k] = v; saveJSON(PREF_KEY, pref); }

// 폰에서 나는 틱 소리는 큰 화면 음악과 엇박이 나서 끕니다(iPhone 은 번쩍임으로 대신).
haptics.config({ sound: false });

const socket = io({ autoConnect: false, transports: ['websocket', 'polling'], tryAllTransports: true });
let me = null; // { slot, name, color }
let mode = 'start'; // start | connecting | msg | in
let state = { phase: 'select' }; // 큰 화면 game_state
let pk = null; // 큰 화면 CD(picker) 상태
let readySt = null;
let roster = [];
let lastResult = null;
let displayOn = true;
let noRoomTries = 0;

// ---------- 지연 ----------
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
setInterval(measureRtt, 1500);
function rtt() {
  if (!rtts.length) return 80;
  const s = [...rtts].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function c2d(event, data) { if (socket.connected && me) socket.emit('c2d', { event, data }); }

// ================================================================
// 설정(나만 값): 입력·배치·난이도
// ================================================================
const ps = createPhoneSettings();
ps.attach(socket);
const inputMode = () => (ps.get('input') === 'motion' ? 'motion' : 'pad');
const lanesOf = () => (inputMode() === 'motion' ? 4 : Number(ps.get('lanes')) === 5 ? 5 : 4);
const myDiff = () => ps.get('difficulty') || 'normal';
let prefsPushed = false;
ps.onChange((vals, info) => {
  // 들어온 뒤 처음 설정을 받으면, 이 폰이 전에 고른 값으로 맞춥니다.
  if (!prefsPushed && me && ps.state && !ps.isLocked()) {
    prefsPushed = true;
    for (const k of ['input', 'lanes', 'difficulty']) {
      if (pref[k] != null && String(ps.get(k)) !== String(pref[k])) ps.choose(k, pref[k]);
    }
  }
  det.setOpposite(OPPOSITE_MS[myDiff()] || 400);
  if (info && info.update && mode === 'in') maybeAutoTutorial();
  paint();
});

function choose(k, v) {
  if (ps.isLocked()) { toast('경기 중에는 바꿀 수 없어요'); return false; }
  savePref(k, v);
  ps.choose(k, v);
  paint();
  return true;
}

// ================================================================
// 패드
// ================================================================
let pad = null;
function ensurePad() {
  if (pad) { pad.setLanes(lanesOf()); return pad; }
  pad = createPad($('pads'), {
    lanes: lanesOf(),
    color: me ? me.color : '#ff5a5f',
    onPress: (lane, info) => sendStep(lane, info.t),
    onRelease: (lane, info) => c2d('release', { lane, ago: Math.round(Math.max(0, performance.now() - info.t)), rtt: Math.round(rtt()) })
  });
  return pad;
}
function sendStep(lane, t, extra = {}) {
  const ago = Math.round(clamp(performance.now() - t, 0, 400));
  c2d('step', { lane, ago, rtt: Math.round(rtt()), ...extra });
}

// ================================================================
// 모션
// ================================================================
let sens = Number(loadJSON(SENS_KEY, 1)) || 1;
const det = createStepDetector({ threshold: BASE_THRESHOLD * sens, onStep: (s) => onMotionStep(s) });
let sensorsOn = false;
let gotMotion = false;
let motionCount = 0;
let lastMotionAt = 0;
let fallback = false; // 센서가 없어서 화면 버튼으로
let calibrated = false;
let motionPerm = typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function' ? 'ask' : 'ok';
const ori = { beta: null, gamma: null };
let lastStep = null;

function stampOf(e) {
  const now = performance.now();
  const ts = e && typeof e.timeStamp === 'number' ? e.timeStamp : now;
  return ts > 0 && ts <= now + 5 && now - ts < 300 ? ts : now;
}
function onOrientation(e) {
  if (e.beta == null || e.gamma == null) return;
  ori.beta = e.beta;
  ori.gamma = e.gamma;
}
function onMotion(e) {
  const a = e.acceleration;
  const ag = e.accelerationIncludingGravity;
  const A = a && a.x != null ? [a.x, a.y, a.z] : null;
  const AG = ag && ag.x != null ? [ag.x, ag.y, ag.z] : null;
  if (!A && !AG) return;
  if (!gotMotion) {
    gotMotion = true;
    if (fallback && !DEBUG) { fallback = false; paint(); }
  }
  motionCount += 1;
  lastMotionAt = performance.now();
  det.feed({ t: stampOf(e), a: A, ag: AG, beta: ori.beta, gamma: ori.gamma });
  if (calRun) calTick();
}
/** 탭 안에서 부릅니다(iPhone 권한). 센서 듣기를 붙이고, 1.5초 안에 값이 없으면 버튼으로 대신합니다. */
let sensorsReady = null;
function enableSensors() {
  // iPhone 은 권한을 탭 안에서, await 전에 물어야 합니다.
  const asks = [];
  if (motionPerm === 'ask') {
    asks.push(DeviceMotionEvent.requestPermission().catch(() => 'denied'));
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      asks.push(DeviceOrientationEvent.requestPermission().catch(() => 'denied'));
    }
  }
  if (sensorsReady && !asks.length) return sensorsReady;
  sensorsReady = Promise.all(asks).then((res) => {
    if (asks.length) motionPerm = res.every((x) => x === 'granted') ? 'ok' : 'denied';
    if (!sensorsOn) {
      sensorsOn = true;
      window.addEventListener('deviceorientation', onOrientation);
      window.addEventListener('devicemotion', onMotion);
    }
    return new Promise((r) => setTimeout(() => {
      if (!gotMotion) {
        fallback = true;
        dbg(motionPerm === 'denied' ? '동작 센서 권한이 꺼져 있어서 버튼으로 해요' : '동작 센서 값이 안 들어와서 버튼으로 해요');
        if (calRun) useButtons();
      }
      paint();
      r(gotMotion);
    }, gotMotion ? 0 : SENSOR_WAIT_MS));
  });
  return sensorsReady;
}

function flashDir(dir) {
  for (const el of document.querySelectorAll(`[data-dir="${dir}"], #mbDirs i[data-d="${dir}"]`)) {
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  }
}
function onMotionStep(step) {
  if (inputMode() !== 'motion' && !tutMotion.isRunning()) return;
  lastStep = step;
  flashDir(step.dir);
  // 감지하자마자 짧게(판정은 큰 화면이 따로 보냄)
  haptics.tick({ noFlash: true, silent: true });
  $('mbText').textContent = `${DIR_TO[step.dir]} 휙 ✓${step.sim ? '' : ` · 세기 ${step.peak}`}`;
  if (tutMotion.isRunning() && tutMotion.signal('step', step)) return;
  if (inputMode() !== 'motion') return;
  sendStep(step.lane, step.t, { dir: step.dir, peak: step.peak });
}

// ---------- 자세 맞추기 ----------
let calRun = null; // { still, last, after }
function openCal(after) {
  if (fallback) {
    calibrated = true;
    c2d('calibrate', { fallback: true });
    if (after) after();
    return;
  }
  calRun = { still: 0, last: performance.now(), after, started: performance.now() };
  $('calT').textContent = '폰을 세워 들어요';
  $('calB').textContent = '화면이 나를 보게 세워 들고 잠깐 가만히 있어요.';
  $('calFallback').classList.toggle('hidden', !DEBUG);
  setCalProg(0);
  $('cal').classList.remove('hidden');
  // 값이 계속 안 오면 버튼으로 하자고 알려 줍니다
  clearTimeout(calRun.helpT);
  calRun.helpT = setTimeout(() => { if (calRun) $('calFallback').classList.remove('hidden'); }, 4500);
}
function setCalProg(k) {
  const c = 2 * Math.PI * 52;
  $('calProg').style.strokeDasharray = `${c}`;
  $('calProg').style.strokeDashoffset = `${c * (1 - clamp(k, 0, 1))}`;
}
function calTick() {
  const r = calRun;
  const now = performance.now();
  const dt = Math.min(100, now - r.last);
  r.last = now;
  const up = det.up;
  const upright = Math.abs(up[2]) < 0.8; // 바닥에 눕히지만 않으면 됩니다(세로·가로 모두)
  const still = det.live.m < 1.4;
  if (upright && still) r.still += dt;
  else r.still = Math.max(0, r.still - dt * 2);
  setCalProg(r.still / STILL_MS);
  $('calB').textContent = !upright ? '폰을 바닥과 수직으로 세워 주세요.' : !still ? '잠깐만 가만히…' : '좋아요, 그대로…';
  if (r.still >= STILL_MS) finishCal(true);
}
function finishCal(ok) {
  const r = calRun;
  if (!r) return;
  calRun = null;
  clearTimeout(r.helpT);
  if (ok) {
    calibrated = true;
    det.reset();
    haptics.success();
    c2d('calibrate', { fallback });
    $('calT').textContent = '맞췄어요 ✓';
    setCalProg(1);
    setTimeout(() => $('cal').classList.add('hidden'), 450);
    paint();
    if (r.after) setTimeout(r.after, 480);
  } else {
    $('cal').classList.add('hidden');
    paint();
  }
}
$('calCancel').addEventListener('click', () => finishCal(false));
/** 센서 없이 화면 버튼으로(자세 맞추기를 건너뜀) */
function useButtons() {
  fallback = true;
  const r = calRun;
  calRun = null;
  if (r) clearTimeout(r.helpT);
  $('cal').classList.add('hidden');
  calibrated = true;
  c2d('calibrate', { fallback: true });
  paint();
  if (r && r.after) r.after();
}
$('calFallback').addEventListener('click', useButtons);

/** 모션을 쓸 수 있게: 권한 → 센서 확인 → 자세 맞추기 → (처음이면) 튜토리얼. 탭 안에서 부릅니다. */
function readyMotion(then) {
  const go = () => {
    if (!calibrated) openCal(() => afterCal(then));
    else afterCal(then);
  };
  // 센서 확인(최대 1.5초)을 기다린 뒤 자세 맞추기. 값이 안 오면 버튼으로 바로 넘어갑니다.
  enableSensors().then(go);
}
function afterCal(then) {
  if (tutMotion.firstTime() && !tutMotion.isRunning() && state.phase !== 'playing') {
    tutMotion.run().then(() => { paint(); if (then) then(); });
    return;
  }
  if (then) then();
}

// ================================================================
// 튜토리얼
// ================================================================
let tutPadMini = null;
function miniPad(stage, api, onPad) {
  const box = document.createElement('div');
  box.className = 'tut-pad';
  stage.appendChild(box);
  const lanes = lanesOf();
  const downs = new Map();
  const m = createPad(box, {
    lanes,
    color: me ? me.color : '#ff5a5f',
    onPress: (lane) => { downs.set(lane, performance.now()); onPad('press', lane, m); },
    onRelease: (lane) => { const t0 = downs.get(lane); downs.delete(lane); onPad('release', lane, m, t0 ? (performance.now() - t0) / 1000 : 0); }
  });
  tutPadMini = m;
  return () => { m.destroy(); if (tutPadMini === m) tutPadMini = null; };
}
const padTarget = () => (lanesOf() === 5 ? 3 : 2); // 5키: ↗, 4키: ↑
const padSteps = [
  {
    title: '아무 칸이나 톡',
    body: '화면 전체가 발판이에요. 화살표가 있는 칸 아무 데나 세 번 눌러 봐요.',
    waitFor: 'pad', count: 3, hint: '세 번 눌러요',
    render: (stage, api) => miniPad(stage, api, (k, lane) => { if (k === 'press') api.signal('pad', { lane }); })
  },
  {
    title: '화살표 = 누를 칸',
    body: '큰 화면에 오는 화살표와 같은 쪽 칸을 눌러요. 반짝이는 칸을 눌러 봐요.',
    waitFor: 'pad',
    check: (d) => d.lane === padTarget() || `그건 ${GLYPH[lanesOf()][d.lane]} 칸이에요. 반짝이는 ${GLYPH[lanesOf()][padTarget()]} 칸!`,
    render: (stage, api) => {
      const off = miniPad(stage, api, (k, lane) => { if (k === 'press') api.signal('pad', { lane }); });
      const t = setInterval(() => tutPadMini && tutPadMini.judge(padTarget(), 'perfect'), 700);
      setTimeout(() => tutPadMini && tutPadMini.judge(padTarget(), 'perfect'), 80);
      return () => { clearInterval(t); off(); };
    }
  },
  {
    title: '두 칸 동시에',
    body: '노트 두 개가 나란히 오면 두 손가락으로 같이 눌러요.',
    waitFor: 'jump', hint: '두 칸을 한꺼번에',
    render: (stage, api) => {
      let lastAt = -1e9;
      let lastLane = -1;
      return miniPad(stage, api, (k, lane, m) => {
        if (k !== 'press') return;
        const now = performance.now();
        const held = m.held();
        if ((held.length >= 2) || (lane !== lastLane && now - lastAt < 160)) api.signal('jump', { lanes: held });
        lastAt = now;
        lastLane = lane;
      });
    }
  },
  {
    title: '길게 누르기',
    body: '꼬리가 달린 노트(어려움)는 꼬리가 끝날 때까지 누르고 있어요. 1초 꾹!',
    waitFor: 'hold', hint: '1초 동안 누르고 있어요',
    check: (d) => d.dur >= 0.9 || `${d.dur.toFixed(1)}초 · 조금 더 오래!`,
    render: (stage, api) => {
      const bar = document.createElement('div');
      bar.className = 'tut-hold';
      bar.innerHTML = '<i></i>';
      let t0 = 0;
      let raf = 0;
      const tick = () => {
        const k = t0 ? clamp((performance.now() - t0) / 1000, 0, 1) : 0;
        bar.firstChild.style.width = `${k * 100}%`;
        bar.classList.toggle('full', k >= 0.9);
        if (t0) raf = requestAnimationFrame(tick);
      };
      const off = miniPad(stage, api, (k, lane, m, dur) => {
        if (k === 'press') { t0 = performance.now(); cancelAnimationFrame(raf); tick(); }
        else { t0 = 0; cancelAnimationFrame(raf); tick(); api.signal('hold', { lane, dur: dur || 0 }); }
      });
      stage.appendChild(bar);
      return () => { cancelAnimationFrame(raf); off(); };
    }
  }
];

function motionButtons(stage, api) {
  if (!fallback && !DEBUG) return null;
  const box = document.createElement('div');
  box.className = 'tut-mo';
  box.innerHTML = `<small>${fallback ? '동작 센서가 없어서 버튼으로 해 봐요' : '시험: 버튼으로 흉내'}</small>` +
    DIRS.map((d) => `<button type="button" data-d="${d}">${GLYPH[4][DIRS.indexOf(d)]}</button>`).join('');
  box.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button[data-d]');
    if (!b) return;
    e.preventDefault();
    det.emit(b.dataset.d, performance.now());
  });
  stage.appendChild(box);
  return () => box.remove();
}
const flickStep = (dir, title, body, extra = {}) => ({
  title, body, svg: 'flick', svgOpts: { dir }, waitFor: 'step', hint: `${DIR_TO[dir]} 휙`,
  check: (d) => d.dir === dir || `${DIR_TO[d.dir]} 갔어요. ${DIR_TO[dir]} 휙!`,
  render: motionButtons,
  ...extra
});
const motionSteps = [
  flickStep('up', '위로 휙', '폰을 세워 든 채 위로 짧고 세게 휙. 돌아올 땐 천천히.'),
  flickStep('down', '아래로 휙', '이번엔 아래로 휙. 손목이 아니라 팔째로 움직여요.'),
  flickStep('left', '왼쪽으로 휙', '화면을 나에게 향한 채 왼쪽으로 휙.'),
  flickStep('right', '오른쪽으로 휙', '오른쪽으로 휙. 큰 화면의 → 노트예요.'),
  flickStep('right', '연달아 두 번', '휙 → 천천히 제자리 → 또 휙. 오른쪽으로 두 번 해 봐요.', { count: 2, hint: '두 번 휙' })
];
const tutPad = createTutorial({
  key: 'rhythm-pad', socket, title: '처음이라 패드 연습', steps: padSteps,
  finish: { title: '패드 연습 끝!', body: '노트가 위쪽 받침에 닿을 때 같은 칸을 눌러요.\n이제 준비를 누르면 돼요.' },
  onDone: () => paint()
});
const tutMotion = createTutorial({
  key: 'rhythm-motion', socket, title: '처음이라 모션 연습', steps: motionSteps,
  finish: { title: '모션 연습 끝!', body: '노트가 받침에 닿을 때 그쪽으로 휙.\n돌아올 땐 천천히. 이제 준비를 누르면 돼요.' },
  onDone: () => paint()
});
const linkPad = tutPad.link($('tutLinks'), { label: '튜토리얼 다시 하기 · 패드' });
const linkMotion = tutMotion.link($('tutLinks'), {
  label: '튜토리얼 다시 하기 · 모션',
  before: () => {
    if (calibrated) return true;
    readyMotion(() => { if (!tutMotion.isRunning()) tutMotion.run().then(paint); });
    return false;
  }
});
const anyTut = () => tutPad.isRunning() || tutMotion.isRunning();
let autoTutDone = false;
/** 들어온 뒤 처음 한 번: 지금 입력 방식이 처음이면 연습을 띄웁니다(경기 중이면 미룸). */
function maybeAutoTutorial() {
  if (autoTutDone || !me || !ps.state || anyTut() || state.phase === 'playing') return;
  autoTutDone = true;
  if (inputMode() === 'pad') { if (tutPad.firstTime()) tutPad.run(); return; }
  // 모션: 권한이 필요한 폰(iPhone)은 '동작 센서 켜기' 탭을 기다립니다.
  // 처음이면 자세 맞추기 → 연습, 아니면 센서만 켜 두고 준비를 누를 때 자세를 맞춥니다.
  if (motionPerm === 'ask') { paint(); return; }
  if (tutMotion.firstTime()) readyMotion(null);
  else enableSensors();
}

// ================================================================
// 화면
// ================================================================
const VIEWS = ['vStart', 'vMsg', 'vLobby', 'vPlay', 'vSpec', 'vOver'];
let view = 'vStart';
function show(id) {
  if (view === id) return;
  view = id;
  for (const v of VIEWS) $(v).classList.toggle('on', v === id);
  document.body.dataset.view = id;
  if (id === 'vPlay' && pad) pad.resize();
  if (pad) pad.setEnabled(id === 'vPlay');
}
function message(t, b, spin = false) {
  mode = 'msg';
  $('msgT').textContent = t;
  $('msgB').textContent = b || '';
  $('msgSpin').classList.toggle('hidden', !spin);
  show('vMsg');
}
let bannerT = null;
function banner(t, ms) {
  const el = $('banner');
  el.textContent = t || '';
  el.classList.toggle('hidden', !t);
  clearTimeout(bannerT);
  if (t && ms) bannerT = setTimeout(() => el.classList.add('hidden'), ms);
}
let toastT = null;
function toast(html, ms = 2200) {
  const el = $('toast');
  el.innerHTML = html;
  el.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('on'), ms);
}
function dbg(t) { if (DEBUG) $('debug').textContent = t; }

const myInfo = () => (me && state.players ? state.players[me.slot] || null : null);
const iAmReady = () => Boolean(me && readySt && readySt.ready.includes(me.slot));
const iPlay = () => { const mi = myInfo(); return Boolean(mi && mi.playing); };

function render() {
  if (mode !== 'in' || !me) return;
  const ph = state.phase;
  if (ph === 'playing') {
    if (iPlay()) { show('vPlay'); paintPlay(); } else { paintSpec(); show('vSpec'); }
  } else if (ph === 'over') {
    if (lastResult) { paintOver(); show('vOver'); } else { paintSpec(); show('vSpec'); }
  } else {
    show('vLobby');
  }
  paint();
}

// ---------- 대기실 ----------
function paint() {
  paintHeader();
  if (view !== 'vLobby') return;
  paintSong();
  const im = inputMode();
  for (const b of document.querySelectorAll('.mode')) {
    const on = b.dataset.mode === im;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  }
  $('lanesRow').classList.toggle('hidden', im !== 'pad');
  for (const b of document.querySelectorAll('#lanesSeg button')) b.classList.toggle('on', Number(b.dataset.l) === lanesOf());
  // 모션 상자
  const mo = im === 'motion';
  $('motionBox').classList.toggle('hidden', !mo);
  if (mo) {
    const live = gotMotion && performance.now() - lastMotionAt < 1500;
    $('mbDot').className = 'mb-dot' + (live ? ' live' : fallback ? ' off' : '');
    if (!lastStep || performance.now() - lastStep.t > 2500) {
      $('mbText').textContent = motionPerm === 'ask' ? '동작 센서를 켜야 해요' : fallback ? '센서가 없어서 경기 때 화면 버튼으로 해요'
        : !sensorsOn ? '준비를 누르면 센서를 켜요' : calibrated ? '위·아래·좌·우로 휙 해 보세요 · 큰 화면 카드가 켜져요' : '자세를 맞추면 시작할 수 있어요';
    }
    $('btnMotionPerm').classList.toggle('hidden', !(motionPerm === 'ask' || (!sensorsOn && !fallback)));
    $('btnMotionPerm').textContent = motionPerm === 'ask' ? '동작 센서 켜기' : '센서 켜고 자세 맞추기';
    $('btnRecal').classList.toggle('hidden', !sensorsOn || fallback);
    for (const b of document.querySelectorAll('#sens button')) b.classList.toggle('on', Number(b.dataset.s) === sens);
  }
  // 난이도 칩
  const d = myDiff();
  const info = pk && pk.info && me ? pk.info[me.slot] : null;
  for (const b of document.querySelectorAll('.diff')) {
    const k = b.dataset.d;
    b.classList.toggle('on', k === d);
    const ci = info && info[k];
    b.querySelector('.st').textContent = ci ? `★${ci.stars}` : '';
    b.querySelector('.nc').textContent = ci ? `노트 ${ci.count}` : '';
  }
  for (const b of document.querySelectorAll('.diff, .mode, #lanesSeg button')) b.disabled = ps.isLocked();
  paintReady();
  tutPad.setLinkVisible(im === 'pad');
  tutMotion.setLinkVisible(im === 'motion');
}
function paintHeader() {
  const h = $('hdrMode');
  if (!me || mode !== 'in') { h.classList.add('hidden'); return; }
  const im = inputMode();
  h.textContent = `${im === 'motion' ? '모션' : lanesOf() === 5 ? '패드 5키' : '패드 4키'} · ${DIFF_LABEL[myDiff()]}`;
  h.classList.remove('hidden');
}
let coverFor = null;
function paintSong() {
  const s = (pk && pk.song) || state.song;
  if (!s) return;
  if (coverFor !== s.id) {
    coverFor = s.id;
    try { $('songCover').src = drawCover(s, 240); } catch (e) {}
    $('songCard').style.setProperty('--hue', s.cover && s.cover.hue != null ? s.cover.hue : 200);
  }
  $('songTitle').textContent = s.title;
  $('songSub').textContent = `${s.en || ''} · ${s.composer || ''}`;
  const len = s.lengthSec ? `${Math.floor(s.lengthSec / 60)}:${String(Math.round(s.lengthSec) % 60).padStart(2, '0')}` : '';
  $('songMeta').innerHTML = [s.genre, s.bpm ? `${s.bpm} BPM` : '', len].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('');
  $('songK').textContent = pk && pk.total ? `노래 고르기 · ${pk.index + 1}/${pk.total}` : '노래 고르기';
  const chosen = (pk && pk.chosen) || state.chosen;
  const el = $('songPicked');
  if (chosen && chosen === s.id) {
    const by = pk && pk.chosenBy;
    el.innerHTML = by ? `<b style="--pc:${COLORS[by] || '#fff'}">${by}P</b>이 곡으로 정했어요 ✓` : '이 곡으로 정했어요 ✓';
    el.classList.remove('hidden');
  } else el.classList.add('hidden');
}
function paintReady() {
  const btn = $('btnGo');
  const ready = iAmReady();
  btn.classList.toggle('done', ready);
  const st = readySt;
  const others = st ? st.players.filter((s) => s !== (me && me.slot) && !st.ready.includes(s)) : [];
  if (ready) {
    $('goT').textContent = '준비 완료 ✓';
    $('goS').textContent = others.length ? `${others.map((s) => `${s}P`).join('·')} 기다리는 중` : '곧 시작해요';
  } else {
    $('goT').textContent = '준비';
    const need = inputMode() === 'motion' && !calibrated && !fallback;
    $('goS').textContent = need ? '누르면 자세부터 맞춰요' : st && st.ready.length ? `${st.ready.length}명 준비 · 모두 준비하면 시작` : '모두 준비하면 시작해요';
  }
  // 누가 아직인지
  const players = (st && st.players) || roster.map((p) => p.slot);
  const tuts = {};
  if (state.players) for (const [k, v] of Object.entries(state.players)) if (v && v.tut) tuts[k] = v.tut;
  $('waitFor').innerHTML = players.map((s) => {
    const on = st && st.ready.includes(s);
    const away = st && st.away && st.away.includes(s);
    const tag = on ? '✓' : away ? '끊김' : tuts[s] ? `연습 ${tuts[s]}` : '아직';
    return `<span class="wf${on ? ' on' : ''}${away ? ' away' : ''}${s === (me && me.slot) ? ' me' : ''}" style="--pc:${COLORS[s] || '#fff'}"><b>${s}P</b>${esc(tag)}</span>`;
  }).join('');
}

// ---------- 경기 ----------
const hud = { score: 0, shown: 0, combo: 0, life: 60, raf: 0 };
function paintPlay() {
  const mi = myInfo();
  const motion = mi ? mi.input === 'motion' : inputMode() === 'motion';
  $('pads').classList.toggle('hidden', motion);
  $('motionView').classList.toggle('hidden', !motion);
  $('motionView').classList.toggle('fallback', motion && (fallback || DEBUG));
  if (!motion) {
    const p = ensurePad();
    p.setLanes(mi && mi.lanes === 5 ? 5 : 4);
    if (me) p.setColor(me.color);
    p.setEnabled(true);
    p.resize();
  }
  $('moTip').textContent = fallback ? '센서가 없어서 화살표 버튼을 눌러요' : '폰을 세워 들고 화살표 쪽으로 휙 · 돌아올 땐 천천히';
}
function resetHud() {
  hud.score = 0; hud.shown = 0; hud.combo = 0; hud.life = 60;
  $('hScore').textContent = '0';
  $('hCombo').textContent = '0';
  $('hLife').style.width = '60%';
  $('hJudge').className = 'hud-j';
  $('hJudge').textContent = '';
}
function scoreTick() {
  hud.raf = 0;
  hud.shown += (hud.score - hud.shown) * 0.25;
  if (Math.abs(hud.score - hud.shown) < 1) hud.shown = hud.score;
  $('hScore').textContent = Math.round(hud.shown).toLocaleString('en-US');
  if (hud.shown !== hud.score) hud.raf = requestAnimationFrame(scoreTick);
}
let flashThrottle = 0;
function onJudge(d) {
  if (!d) return;
  const j = d.j;
  hud.score = Number(d.s) || 0;
  hud.combo = Number(d.c) || 0;
  hud.life = clamp(Number(d.l) || 0, 0, 100);
  if (!hud.raf) hud.raf = requestAnimationFrame(scoreTick);
  $('hCombo').textContent = String(hud.combo);
  $('hLife').style.width = `${hud.life}%`;
  $('hLife').classList.toggle('low', hud.life < 25);
  const el = $('hJudge');
  el.textContent = JTEXT[j] || '';
  el.className = `hud-j ${j}`;
  void el.offsetWidth;
  el.classList.add('pop');
  if (d.wrong) el.dataset.sub = '방향 봐줌';
  else if (j === 'great' || j === 'good') el.dataset.sub = d.early ? '빨라요' : '늦어요';
  else el.dataset.sub = '';
  if (pad && Number.isFinite(Number(d.lane))) pad.judge(Number(d.lane), j);
  if (inputMode() === 'motion' && j !== 'miss') flashDir(DIRS[Number(d.lane)] || 'up');
  // 진동: PERFECT·GREAT. iPhone(진동 없음)은 내 색으로 살짝 번쩍
  if (j === 'perfect' || j === 'great' || j === 'ok') {
    haptics.play(j === 'ok' ? 'good' : j, 1, { noFlash: true, silent: true });
    if (haptics.mode !== 'vibrate') {
      const now = performance.now();
      if (now - flashThrottle > 110) {
        flashThrottle = now;
        haptics.flash(j === 'perfect' ? '#ffd23a' : me ? me.color : '#5ef0a0', { opacity: j === 'perfect' ? 0.32 : 0.22, ms: 170 });
      }
    }
  }
}
let cdTimers = [];
function countdown(inSec) {
  for (const t of cdTimers) clearTimeout(t);
  cdTimers = [];
  const el = $('cd');
  const lag = rtt() / 2000;
  const steps = [['3', inSec - 3], ['2', inSec - 2], ['1', inSec - 1], ['GO!', inSec - 0.05]];
  for (const [txt, at] of steps) {
    cdTimers.push(setTimeout(() => {
      el.textContent = txt;
      el.className = 'cd on' + (txt === 'GO!' ? ' go' : '');
      if (txt !== 'GO!') haptics.tick({ noFlash: true, silent: true });
    }, Math.max(0, (at - lag) * 1000)));
  }
  cdTimers.push(setTimeout(() => { el.className = 'cd'; }, (inSec + 0.6 - lag) * 1000));
}

// ---------- 관전·결과 ----------
const hasBatchim = (w) => { const c = String(w || '').trim().slice(-1).charCodeAt(0); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0; };
function paintSpec() {
  const s = state.song;
  if (s) { try { $('specCover').src = drawCover(s, 300); $('specCover').classList.remove('hidden'); } catch (e) {} }
  else $('specCover').classList.add('hidden');
  if (state.phase === 'over') {
    $('specT').textContent = '결과 보는 중';
    $('specB').textContent = '큰 화면에서 순위를 확인해요. 곧 노래 고르기로 돌아가요.';
  } else {
    $('specT').textContent = '관전 중';
    $('specB').textContent = s ? `‘${s.title}’${hasBatchim(s.title) ? '이' : '가'} 끝나면 같이 할 수 있어요.` : '지금 곡이 끝나면 같이 할 수 있어요.';
  }
}
let overTimer = null;
function paintOver() {
  const r = lastResult;
  if (!r) return;
  const gc = GRADE_COL[r.grade] || '#7fd4ff';
  $('vOver').style.setProperty('--gc', gc);
  $('ovSong').textContent = r.song || '';
  $('ovRank').innerHTML = r.of > 1 ? `<b>${r.rank}</b>위 <span>/ ${r.of}명</span>` : '<b>혼자</b> 플레이';
  $('ovGrade').textContent = r.grade;
  const tags = [];
  if (r.pfc) tags.push('<span class="pfc">ALL PERFECT</span>');
  else if (r.fc) tags.push('<span class="fc">FULL COMBO</span>');
  if (r.failed) tags.push('<span class="fail">클리어 실패</span>');
  $('ovTags').innerHTML = tags.join('');
  $('ovScore').textContent = Number(r.score || 0).toLocaleString('en-US');
  $('ovLine').innerHTML = `정확도 <b>${r.acc}%</b> · 최대 콤보 <b>${r.maxCombo}</b>`;
  const c = r.counts || {};
  $('ovCounts').innerHTML = `<div class="p"><span>PERFECT</span><b>${c.perfect || 0}</b></div><div class="g"><span>GREAT</span><b>${c.great || 0}</b></div>` +
    `<div class="o"><span>GOOD</span><b>${c.good || 0}</b></div><div class="m"><span>MISS</span><b>${c.miss || 0}</b></div>`;
  clearInterval(overTimer);
  const until = performance.now() + (r.overMs || 18000);
  const tick = () => {
    const left = Math.max(0, Math.ceil((until - performance.now()) / 1000));
    $('ovAuto').textContent = left ? `${left}초 뒤 노래 고르기로 돌아가요` : '';
    if (!left) clearInterval(overTimer);
  };
  tick();
  overTimer = setInterval(tick, 500);
}

// ================================================================
// 노래 고르기: 폰 화면을 좌우로 밀어 큰 화면 CD 넘기기, 탭하면 그 곡
// ================================================================
(function songSwipe() {
  const card = $('songCard');
  let p0 = null;
  card.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.song-arrow')) return;
    p0 = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, moved: false, hist: [[e.clientX, performance.now()]] };
    try { card.setPointerCapture(e.pointerId); } catch (err) {}
  });
  card.addEventListener('pointermove', (e) => {
    if (!p0 || e.pointerId !== p0.id) return;
    const dx = e.clientX - p0.x;
    if (Math.abs(dx) > 8) p0.moved = true;
    p0.hist.push([e.clientX, performance.now()]);
    if (p0.hist.length > 6) p0.hist.shift();
    card.style.setProperty('--dx', `${clamp(dx, -90, 90)}px`);
    card.classList.add('dragging');
  });
  const end = (e) => {
    if (!p0 || e.pointerId !== p0.id) return;
    const dx = e.clientX - p0.x;
    const dy = e.clientY - p0.y;
    const h = p0.hist;
    const [x1, t1] = h[0];
    const vx = (e.clientX - x1) / Math.max(16, performance.now() - t1); // px/ms
    const moved = p0.moved;
    p0 = null;
    card.classList.remove('dragging');
    card.style.setProperty('--dx', '0px');
    if (e.type === 'pointercancel') return;
    if (!moved && Math.abs(dy) < 12) { pickSong(); return; }
    if (Math.abs(dx) < 34 && Math.abs(vx) < 0.5) return;
    // 왼쪽으로 밀면 다음 곡(+1). 빠르게 튕기면 여러 장
    const dir = dx < 0 ? 1 : -1;
    if (Math.abs(vx) > 1.1) navSong({ fling: clamp(-vx * 6, -24, 24) });
    else navSong({ dir });
    swipeAnim(dir);
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
  $('songPrev').addEventListener('click', () => { navSong({ dir: -1 }); swipeAnim(-1); });
  $('songNext').addEventListener('click', () => { navSong({ dir: 1 }); swipeAnim(1); });
})();
function swipeAnim(dir) {
  const c = $('songCard');
  c.classList.remove('swl', 'swr');
  void c.offsetWidth;
  c.classList.add(dir > 0 ? 'swl' : 'swr');
}
function navSong(d) {
  if (state.phase !== 'select') return;
  haptics.tick({ noFlash: true, silent: true });
  c2d('nav', d);
}
function pickSong() {
  if (state.phase !== 'select') return;
  haptics.play('good', 1, { noFlash: true, silent: true });
  c2d('pick', {});
  const c = $('songCard');
  c.classList.remove('picked');
  void c.offsetWidth;
  c.classList.add('picked');
}

// ================================================================
// 버튼
// ================================================================
for (const b of document.querySelectorAll('.mode')) {
  b.addEventListener('click', () => {
    const m = b.dataset.mode;
    haptics.unlock();
    if (inputMode() === m) {
      if (m === 'motion' && (motionPerm === 'ask' || !calibrated)) readyMotion(null);
      return;
    }
    if (!choose('input', m)) return;
    if (m === 'motion') readyMotion(null);
    else if (tutPad.firstTime() && !anyTut()) tutPad.run();
  });
}
for (const b of document.querySelectorAll('#lanesSeg button')) b.addEventListener('click', () => choose('lanes', Number(b.dataset.l)));
for (const b of document.querySelectorAll('.diff')) b.addEventListener('click', () => choose('difficulty', b.dataset.d));
for (const b of document.querySelectorAll('#sens button')) {
  b.addEventListener('click', () => {
    sens = Number(b.dataset.s) || 1;
    saveJSON(SENS_KEY, sens);
    det.setThreshold(BASE_THRESHOLD * sens);
    haptics.tick({ noFlash: true, silent: true });
    paint();
  });
}
$('btnMotionPerm').addEventListener('click', () => readyMotion(null));
$('btnRecal').addEventListener('click', () => openCal(null));
$('btnGo').addEventListener('click', () => {
  haptics.unlock();
  if (!me || state.phase !== 'select') return;
  if (iAmReady()) { haptics.tick(); toast('준비 완료 · 다른 사람을 기다려요'); return; }
  if (inputMode() === 'motion' && !calibrated) {
    readyMotion(() => sendReady());
    return;
  }
  sendReady();
});
function sendReady() {
  if (!me || state.phase !== 'select' || iAmReady()) return;
  c2d('start_game', {});
  haptics.success();
  // 서버 확인 전에도 눌렀다는 것이 보이게
  if (readySt && !readySt.ready.includes(me.slot)) readySt = { ...readySt, ready: [...readySt.ready, me.slot] };
  paint();
}
$('btnNext').addEventListener('click', () => { c2d('nav', { next: 1 }); haptics.tick(); });
$('btnMsg').addEventListener('click', () => location.reload());

// 모션 화면 버튼(센서 없음·디버그)
$('cross').addEventListener('pointerdown', (e) => {
  const b = e.target.closest('button[data-dir]');
  if (!b || !$('motionView').classList.contains('fallback')) return;
  e.preventDefault();
  det.emit(b.dataset.dir, stampOf(e));
});

// 키보드(PC 에서 시험): 패드는 D F J K / 화살표
const keyHeld = new Set();
window.addEventListener('keydown', (e) => {
  if (e.repeat || view !== 'vPlay') return;
  const mi = myInfo();
  if (mi && mi.input === 'motion') {
    const dir = { ArrowLeft: 'left', ArrowDown: 'down', ArrowUp: 'up', ArrowRight: 'right', KeyD: 'left', KeyF: 'down', KeyJ: 'up', KeyK: 'right' }[e.code];
    if (dir) { e.preventDefault(); det.emit(dir, stampOf(e)); }
    return;
  }
  if (!pad) return;
  const map = KEYMAP[pad.lanes];
  if (!(e.code in map)) return;
  e.preventDefault();
  keyHeld.add(e.code);
  pad.press(map[e.code], { t: stampOf(e) });
});
window.addEventListener('keyup', (e) => {
  if (!keyHeld.has(e.code)) return;
  keyHeld.delete(e.code);
  if (!pad) return;
  const map = KEYMAP[pad.lanes];
  if (e.code in map) pad.release(map[e.code], { t: stampOf(e) });
});

$('btnStart').addEventListener('click', () => {
  if (mode !== 'start') return;
  mode = 'connecting';
  $('btnStart').disabled = true;
  haptics.unlock();
  // 지난번에 모션으로 했으면 지금(탭 안에서) 센서 권한을 같이 받습니다.
  if (pref.input === 'motion' || DEBUG) enableSensors();
  if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
  if (!ROOM) { message('방 코드가 없어요', '큰 화면의 QR을 찍어 주세요.'); return; }
  message('들어가는 중…', '큰 화면과 연결하고 있어요.', true);
  mode = 'connecting';
  socket.connect();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (pad) pad.releaseAll(); }
  else if (mode !== 'start' && navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
});
window.addEventListener('blur', () => { if (pad) pad.releaseAll(); });

// ================================================================
// 소켓
// ================================================================
socket.on('connect', () => {
  measureRtt();
  socket.emit('join', { role: 'controller', room: ROOM, token });
});
socket.on('disconnect', () => { if (me) banner('서버 연결이 끊겼어요. 다시 잇는 중…'); });
socket.on('assigned', (p) => {
  if (!p || p.game !== 'rhythm') {
    location.replace(`${PLAY_URL((p && p.game) || 'baseball')}?room=${encodeURIComponent((p && p.code) || ROOM)}`);
    return;
  }
  me = p;
  noRoomTries = 0;
  prefsPushed = false;
  banner('');
  document.documentElement.style.setProperty('--c', p.color);
  tutPad.setColor(p.color);
  tutMotion.setColor(p.color);
  if (pad) pad.setColor(p.color);
  $('me').textContent = p.name;
  mode = 'in';
  if (calibrated) c2d('calibrate', { fallback });
  render();
  maybeAutoTutorial();
});
socket.on('players', (payload) => {
  roster = payload && Array.isArray(payload.players) ? payload.players : [];
  if (view === 'vLobby') paintReady();
});
socket.on('ready_state', (st) => {
  readySt = st && Array.isArray(st.ready) ? st : null;
  if (view === 'vLobby') paint();
});
socket.on('display_status', ({ connected } = {}) => {
  displayOn = Boolean(connected);
  banner(connected ? '' : '큰 화면이 꺼져 있어요. 다시 열리면 이어서 해요.');
});
socket.on('no_room', () => {
  // 서버가 막 다시 떴으면 큰 화면이 같은 코드로 방을 다시 만들 때까지 잠깐 기다립니다.
  if (noRoomTries++ < 15) {
    message('방에 다시 연결하는 중', '잠시만 기다려 주세요.', true);
    setTimeout(() => socket.connected && socket.emit('join', { role: 'controller', room: ROOM, token }), 2000);
    return;
  }
  message('방을 찾을 수 없어요', '큰 화면의 QR을 다시 찍어 주세요.');
});
socket.on('room_full', () => message('4명이 꽉 찼어요', '빈자리가 생기면 다시 찍어 주세요.'));
socket.on('replaced', () => { mode = 'msg'; message('다른 탭에서 열었어요', '마지막으로 연 화면에서 조작해요.'); });
socket.on('room_closed', () => message('방이 닫혔어요', '큰 화면의 새 QR을 찍어 주세요.'));

socket.on('game_state', (s) => {
  const prev = state.phase;
  state = s && typeof s === 'object' ? s : { phase: 'select' };
  if (state.phase === 'playing' && prev !== 'playing') {
    resetHud();
    // 경기에 들어가는데 연습 화면이 떠 있으면 닫습니다(입력이 경기로 가야 함)
    if (iPlay()) { if (tutPad.isRunning()) tutPad.cancel(); if (tutMotion.isRunning()) tutMotion.cancel(); }
  }
  if (state.phase === 'select' && prev !== 'select') { lastResult = null; clearInterval(overTimer); }
  if (state.started) banner('');
  render();
});
socket.on('picker', (d) => {
  pk = d || null;
  if (view === 'vLobby') paint();
});
socket.on('cue', (c) => {
  if (!c) return;
  if (c.type === 'start') { countdown(Number(c.in) || 3); banner(''); }
  else if (c.type === 'audio') banner('큰 화면을 한 번 클릭하면 노래가 시작돼요');
  else if (c.type === 'picked') {
    const by = Number(c.by);
    toast(by ? `<b style="--pc:${COLORS[by] || '#fff'}">${by}P</b>‘${esc(c.title)}’ 골랐어요 · 준비를 누르세요` : `‘${esc(c.title)}’ · 준비를 누르세요`, 2600);
  }
});
socket.on('judge', onJudge);
socket.on('result', (r) => {
  lastResult = r || null;
  if (r) haptics.play(r.failed ? 'fail' : 'success');
  render();
});

// ================================================================
// 시험용
// ================================================================
window.__rhythmPhone = {
  ps, tutPad, tutMotion, det, haptics,
  get pad() { return pad; },
  state: () => ({ mode, view, phase: state.phase, me: me && me.slot, input: inputMode(), lanes: lanesOf(), diff: myDiff(), ready: iAmReady(),
    sensorsOn, gotMotion, fallback, calibrated, motionPerm, tut: anyTut() ? (tutPad.current() || tutMotion.current() || {}).title : null }),
  /** 패드 칸 누르기/떼기(실제 터치처럼 보냄) */
  press: (lane) => { ensurePad().press(lane); },
  release: (lane) => { if (pad) pad.release(lane); },
  tap: (lane, ms = 60) => { ensurePad().press(lane); setTimeout(() => pad.release(lane), ms); },
  /** 모션 스텝 흉내 */
  flick: (dir) => det.emit(dir, performance.now()),
  /** 가짜 센서 값 넣기(감지기 시험): samples = [{ t, a:[x,y,z], ag:[x,y,z], beta, gamma }] */
  feed: (samples) => samples.map((s) => det.feed(s)).filter(Boolean),
  choose,
  ready: () => $('btnGo').click(),
  nav: navSong,
  pick: pickSong,
  calibrate: () => { if (calRun) finishCal(true); else { calibrated = true; c2d('calibrate', { fallback }); paint(); } }
};
if (DEBUG) {
  let lastN = 0;
  setInterval(() => {
    const l = det.live;
    dbg(`motion ${(motionCount - lastN) * 2}Hz rtt ${Math.round(rtt())}ms r ${l.r.toFixed(1)} u ${l.u.toFixed(1)} m ${l.m.toFixed(1)} ` +
      `sign ${det.sign} thr ${det.threshold.toFixed(1)} rej ${det.rejected} ${fallback ? 'FALLBACK' : ''} ${lastStep ? `last ${lastStep.dir} ${lastStep.peak}` : ''}`);
    lastN = motionCount;
  }, 500);
}
