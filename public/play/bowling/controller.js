// 볼링 컨트롤러. 폰이 볼링공입니다.
// 손가락으로 레인 그림을 밀어 서는 자리(aim{x}, -1..1)를 고른 뒤, 폰을 휙 휘두르면(또는 큰 버튼을 누르면)
// 속도가 정점을 지나는 순간 throw{speed(km/h), dir(도), spin(-1..1), quality(0..1)} 를 보냅니다.
// - 휘두름 신호: 세 축 각속도의 크기 hypot(alpha,beta,gamma). 축 이름·잡는 방향에 상관없이 반응하고 뒤로 빼는 동작도 필요 없습니다.
// - 쉬움·보통: 방향·훅은 큰 화면이 알아서 잡습니다(폰 방향은 쓰지 않음). 큰 버튼을 누르면 똑바로 굴러갑니다.
// - 어려움: dir 은 놓는 순간의 방향(deviceorientation.alpha)과 정면 값의 차이, spin 은 앞스윙 동안 긴 축(beta)으로 비튼 각도의 합.
// 센서가 없으면 큰 버튼으로 굴립니다. 시험 투구 슬라이더는 ?debug 에서만 보입니다(키보드: Space 굴리기, 좌우 방향키 자리).
import { haptics } from '/common/haptics.js';
import { createPhoneSettings } from '/common/phone-settings.js';
import { createTutorial } from '/common/tutorial.js';
import { requestMotionPermission } from '/common/motion.js';
import { t, mountSwitcher } from '/common/i18n.js';

const $ = (id) => document.getElementById(id);
mountSwitcher($('langBox'), { reload: true, compact: true });
const params = new URLSearchParams(location.search);
const ROOM = (params.get('room') || '').toUpperCase();
const DEBUG = params.has('debug');
$('room').textContent = ROOM ? t('방 {code}', { code: ROOM }) : '';

// ---------- 조정 값 (실폰 검증 전이라 바뀔 수 있습니다) ----------
// 난이도별 휘두름 기준(도/초). start: 휘두름 시작, peak: 이 이상 올라가야 굴림, maxMs: 휘두름 최대 길이
const SWING = {
  easy: { start: 60, peak: 90, maxMs: 1500 },
  normal: { start: 80, peak: 120, maxMs: 1200 },
  hard: { start: 100, peak: 170, maxMs: 900 } // 예전 값 그대로(뒤로 빼기만 빠짐)
};
const MISS_HINT_MS = 1200; // '더 크게!' 안내 최소 간격
const TAP_SPEED = 24; // 큰 버튼으로 굴릴 때 속도(km/h)
const AIM_SNAP = 0.12; // 가운데 근처는 0 으로 붙여 줍니다
const RELEASE_FRAC = 0.65; // 최고 각속도의 이 비율 아래로 내려오면 놓은 것(정점 직후)
const KMH_BASE = 12, KMH_PER_DPS = 0.05; // 속도(km/h) = 12 + 최고 각속도 × 0.05, 12~40
const TWIST_FULL_DEG = 70; // 이만큼 비틀면 훅 최대(1)
const SPIN_SIGN = 1; // 비튼 방향 → 훅 방향이 반대로 느껴지면 -1
const DIR_SIGN = -1; // deviceorientation.alpha 는 왼쪽으로 돌릴수록 커집니다
const STILL_DPS = 25, STILL_MS = 450; // 이 정도로 가만히 있으면 지금 방향을 정면으로 삼음
const COOLDOWN_MS = 700;
const AIM_MS = 40;
const SENSOR_WAIT_MS = 1500;
const TURN_LOCK_MS = 200; // 차례 시작 직후 잠깐만 무시
const COLORS = { 1: '#ff5a5f', 2: '#3ab4ff', 3: '#ffc93c', 4: '#5ee07a' };
const PLAY_URL = (g) => (g === 'baseball' ? '/play/' : `/play/${g}/`);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

let token = null;
try { token = localStorage.getItem('pcg-token'); } catch (e) { /* 저장소 막힘 */ }
if (!token) {
  token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try { localStorage.setItem('pcg-token', token); } catch (e) { /* 저장소 막힘 */ }
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
let mode = 'start'; // start | connecting | msg | wait | play | idle | tut
let gotMotion = false, fallback = false, permDenied = false, helpOn = false;
let thrown = false; // 이번 차례에 이미 굴렸는지
let lastHintAt = 0;
let readyList = [], readyInfo = null, roster = [];
let myTurn = null; // 'turn' 이벤트 마지막 값
let aimX = 0;
let lastAimSent = 0;
let lastThrowAt = -1e9;

function show(id) {
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === id);
  $('btnRecal').classList.toggle('hidden', !(id === 'vPlay' && gotMotion && !fallback && isHard()));
}
function message(t, b, btn) {
  helpOn = false; mode = 'msg';
  $('msgT').textContent = t; $('msgB').textContent = b || '';
  $('btnMsg').classList.toggle('hidden', !btn);
  if (btn) { $('btnMsg').textContent = btn.label; $('btnMsg').onclick = btn.onClick; }
  show('vMsg');
}
function banner(text) { $('banner').textContent = text || ''; $('banner').classList.toggle('hidden', !text); }
function flash(color) {
  const f = $('flash');
  f.style.background = `radial-gradient(circle, transparent 40%, ${color || 'var(--c)'})`;
  f.className = ''; void f.offsetWidth; f.className = 'go';
}

const level = () => (ps && ps.difficulty ? ps.difficulty() : 'easy');
const isHard = () => level() === 'hard';
// ---------- 공통 ----------
const ps = createPhoneSettings();
ps.attach(socket);
ps.mount($('setBox'));
ps.bindReady($('btnGo'));
haptics.listen(socket, { slot: () => me && me.slot });

// ---------- 서는 자리 ----------
function paintBall() {
  const pct = 50 + aimX * 42 * 0.92 / 1;
  for (const id of ['ball', 'ballWait']) { const b = $(id); if (b) b.style.left = `${pct}%`; }
}
function setAim(x, silent) {
  aimX = clamp(x, -1, 1);
  paintBall();
  const now = performance.now();
  if (!silent && now - lastAimSent > AIM_MS) { lastAimSent = now; send('aim', { x: Math.round(aimX * 1000) / 1000 }, true); }
}
function dragLane(el) {
  let down = false;
  const set = (e) => {
    const r = el.getBoundingClientRect();
    const v = ((e.clientX - r.left) / r.width - 0.5) / 0.46;
    setAim(Math.abs(v) < AIM_SNAP ? 0 : v);
  };
  el.addEventListener('pointerdown', (e) => { down = true; try { el.setPointerCapture(e.pointerId); } catch (x) { /* 무시 */ } set(e); });
  el.addEventListener('pointermove', (e) => { if (down) set(e); });
  const up = () => { down = false; send('aim', { x: Math.round(aimX * 1000) / 1000 }); };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}
dragLane($('lane'));
dragLane($('laneWait'));
document.addEventListener('keydown', (e) => {
  if (!fallback && !DEBUG) return;
  if (e.key === 'ArrowLeft') setAim(aimX - 0.08);
  else if (e.key === 'ArrowRight') setAim(aimX + 0.08);
  else if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) (DEBUG ? fbThrow() : tapThrow()); }
});

// ---------- 센서: 스윙 감지 ----------
let yawNow = 0, yawRef = null, gotOri = false;
function onOrientation(e) {
  if (e.alpha == null) return;
  yawNow = e.alpha;
  gotOri = true;
  if (yawRef === null) yawRef = yawNow;
}
let sw = { st: 'idle', peak: 0, twist: 0, yawE: 0, n: 0, tFwd: 0 };
let stillSince = 0, lastMotionT = 0;
let rateDbg = 0;
function resetSwing() { sw = { st: 'idle', peak: 0, twist: 0, yawE: 0, n: 0, tFwd: 0 }; }
const swingActive = () => {
  if (mode === 'tut') return true;
  if (thrown) return false;
  return state.phase === 'playing' && state.stage === 'aim' && myTurn && me && state.turn && state.turn.slot === me.slot;
};
// 휘두름이 모자랐을 때 알려 줍니다(조용히 버리지 않음)
function missHint() {
  const now = performance.now();
  if (now - lastHintAt < MISS_HINT_MS) return;
  lastHintAt = now;
  $('readout').textContent = '더 크게!';
  haptics.tick();
}
function onMotion(e) {
  const rr = e.rotationRate;
  if (!rr || (rr.alpha == null && rr.beta == null && rr.gamma == null)) return;
  const t = e.timeStamp > 0 && Math.abs(performance.now() - e.timeStamp) < 1000 ? e.timeStamp : performance.now();
  if (!gotMotion) { gotMotion = true; fallback = false; render(); }
  const dt = lastMotionT ? clamp((t - lastMotionT) / 1000, 0, 0.05) : 1 / 60;
  lastMotionT = t;
  const p = rr.alpha || 0;
  const tw = rr.beta || 0; // 긴 축(손목 비틀기, 어려움에서만 훅에 씀)
  const yr = rr.gamma || 0;
  const m = Math.hypot(p, tw, yr); // 축 이름과 상관없는 휘두름 세기
  rateDbg = m;
  // 가만히 있으면 정면 갱신(어려움에서만 방향에 씀)
  if (m < STILL_DPS * 1.5) {
    if (!stillSince) stillSince = t;
    if (t - stillSince > STILL_MS && sw.st === 'idle' && gotOri) yawRef = yawNow;
  } else stillSince = 0;
  if (!swingActive() || t - lastThrowAt < COOLDOWN_MS) { if (sw.st !== 'idle') resetSwing(); return; }
  const C = SWING[level()] || SWING.easy;
  if (sw.st === 'idle') {
    if (m > C.start) sw = { st: 'fwd', peak: m, twist: 0, yawE: 0, n: 0, tFwd: t };
  }
  if (sw.st === 'fwd') {
    sw.twist += tw * dt * SPIN_SIGN;
    sw.yawE += Math.abs(yr); sw.n += 1;
    if (m > sw.peak) sw.peak = m;
    const enough = sw.peak >= C.peak;
    const past = enough && m < sw.peak * RELEASE_FRAC; // 정점 직후
    const timeout = t - sw.tFwd > C.maxMs;
    const calm = !enough && m < C.start * 0.5; // 모자란 채로 잦아듦
    if (past || (timeout && enough)) {
      const hard = isHard();
      const out = { speed: clamp(KMH_BASE + sw.peak * KMH_PER_DPS, KMH_BASE, 40), spin: hard ? clamp(sw.twist / TWIST_FULL_DEG, -1, 1) : 0, peak: sw.peak };
      const yawRate = sw.n ? sw.yawE / sw.n : 0;
      out.quality = hard ? clamp(1 - yawRate / Math.max(150, sw.peak * 0.6), 0, 1) : 0.9;
      out.dir = hard && gotOri && yawRef !== null ? DIR_SIGN * wrap180(yawNow - yawRef) : 0;
      resetSwing();
      deliver(out);
    } else if (calm || timeout) { resetSwing(); missHint(); }
  }
}
function r2(v) { return Math.round(v * 100) / 100; }
function deliver(d) {
  lastThrowAt = performance.now();
  const data = { speed: r2(d.speed), dir: r2(clamp(d.dir, -40, 40)), spin: r2(d.spin), quality: r2(d.quality), x: Math.round(aimX * 1000) / 1000 };
  haptics.hit(clamp(d.speed / 40, 0.3, 1));
  $('readout').textContent = `${data.speed} km/h`;
  if (tut.signal('swing', { ...data })) return;
  if (mode === 'tut') return;
  thrown = true;
  send('throw', data);
  setSwingBtn('굴렸어요!', '', 'idle');
}
// 큰 버튼: 똑바로, 보통 속도로 굴립니다(휘두름과 똑같이 인정)
function tapThrow() {
  if (!swingActive()) { if (mode === 'play') { haptics.tick(); } return; }
  deliver({ speed: TAP_SPEED, dir: 0, spin: 0, quality: 0.9, peak: 300 });
}
// 시험 투구(센서 없음)
function fbThrow() {
  if (!swingActive() && mode !== 'tut') return;
  deliver({ speed: Number($('fbSpeed').value), dir: Number($('fbDir').value), spin: Number($('fbSpin').value) / 100, quality: 0.8, peak: 300 });
}
$('fbThrow').addEventListener('click', fbThrow);
$('swingBtn').addEventListener('click', tapThrow);

// ---------- 튜토리얼 (원할 때만, 한 단계) ----------
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
function stageSwing(stage) {
  // 큰 버튼은 휘두름과 똑같이 인정합니다.
  const b = el('button', 'gt-btn', '굴리기');
  b.type = 'button';
  b.addEventListener('click', () => deliver({ speed: TAP_SPEED, dir: 0, spin: 0, quality: 0.9, peak: 300 }));
  const box = el('div', 'gt-col'); box.appendChild(b); stage.appendChild(box);
  return () => {};
}
const tut = createTutorial({
  key: 'bowling',
  socket,
  title: '처음이라 연습해 봐요',
  steps: [
    { id: 'swing', title: '휘둘러 굴리기', body: '앞으로 휙!', svg: 'swing', waitFor: 'swing', hint: '폰을 휙', okText: '좋아요!', render: stageSwing }
  ],
  onDone: () => { if (mode === 'tut') mode = 'idle'; render(); }
});
tut.link($('tutLink'), { before: () => { if (state.phase === 'playing' || !me) return false; mode = 'tut'; return true; } });

// ---------- 화면 ----------
function setSwingBtn(t, s, cls) {
  $('swingT').textContent = t; $('swingS').textContent = s || '';
  const b = $('swingBtn');
  b.className = `swingbtn ${cls || 'idle'}`;
}
const PIN_UI = (() => { const a = []; for (let r = 0; r < 4; r++) for (let k = 0; k <= r; k++) a.push([42 + (k - r / 2) * 19, 9 + r * 17]); return a; })();
function drawPins(pins) {
  const box = $('pinmap');
  if (!box.childElementCount) PIN_UI.forEach(([x, y]) => { const i = document.createElement('i'); i.style.left = `${x}px`; i.style.top = `${y}px`; box.appendChild(i); });
  [...box.children].forEach((i, k) => i.classList.toggle('off', !(pins ? pins[k] : true)));
}
function showPlay() {
  mode = 'play';
  const tn = state.turn;
  const mine = Boolean(tn && me && tn.slot === me.slot && state.stage === 'aim');
  const sp = state.players && me ? state.players[me.slot] : null;
  $('fb').classList.toggle('on', DEBUG && fallback);
  drawPins(tn ? tn.pins : null);
  if (sp && sp.pending) {
    $('tTitle').textContent = '다음 프레임부터';
    $('tSub').textContent = '지금 프레임이 끝나면 같이 해요';
    setSwingBtn('구경 중', '곧 내 차례가 와요', 'idle');
  } else if (tn && me && tn.slot === me.slot) {
    $('tTitle').textContent = mine ? '내 차례!' : '굴리는 중…';
    $('tSub').textContent = t('프레임 {f} / {n} · {b}번째 공', { f: tn.frame, n: state.frames, b: tn.ball });
    if (mine) setSwingBtn(fallback ? '눌러서 굴리기' : '휙 휘둘러요', fallback ? '' : '또는 눌러서 굴리기', 'live');
    else setSwingBtn('결과를 기다려요', '', 'idle');
  } else if (tn) {
    $('tTitle').textContent = t('{p} 차례', { p: `${tn.slot}P` });
    $('tSub').textContent = t('프레임 {f} / {n}', { f: tn.frame, n: state.frames });
    setSwingBtn('기다려요', '내 차례가 오면 알려 줘요', 'idle');
  } else {
    $('tTitle').textContent = '곧 시작해요';
    $('tSub').textContent = '';
    setSwingBtn('기다려요', '', 'idle');
  }
  $('laneLbl').textContent = '밀어서 자리 고르기';
  // 점수 요약
  const box = $('mini');
  box.textContent = '';
  for (const s of state.order || []) {
    const p = state.players[s];
    if (!p) continue;
    const d = el('div', me && s === me.slot ? 'me' : '', `<span style="color:${COLORS[s] || '#fff'}">${s}P${p.pending ? ` ${t('(대기)')}` : ''}</span><b>${p.total ?? 0}</b>`);
    box.appendChild(d);
  }
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
  const head = !waitFor.length ? t('모두 준비 완료!') : mine ? t('{names} 기다리는 중', { names: waitFor.map((s) => `${s}P`).join('·') }) : t('준비 {a}/{b}', { a: ready.size, b: st.players.length });
  box.innerHTML = `<span class="rr-h">${head}</span>` + st.players.map((s) =>
    `<span class="rr${ready.has(s) ? ' on' : ''}${away.has(s) ? ' away' : ''}${me && s === me.slot ? ' mine' : ''}" style="--pc:${COLORS[s] || '#fff'}">${s}P${ready.has(s) ? ' ✓' : ''}</span>`).join('');
  box.classList.remove('hidden');
}
let lastResult = null;
function showWait() {
  mode = 'wait';
  const phase = state.phase;
  const mineReady = me && readyList.includes(me.slot);
  const go = $('btnGo');
  go.style.display = ''; go.disabled = false; go.classList.remove('waiting', 'ready');
  const chips = [];
  if (roster.length) chips.push([t('참가 인원'), t('{n}명', { n: roster.length })]);
  chips.push([t('조작'), t(fallback ? '버튼' : '스윙')]);
  if (phase === 'over') {
    if (lastResult) { $('waitT').textContent = lastResult.rank === 1 ? t('1위!') : t('{n}위', { n: lastResult.rank }); $('waitB').textContent = t('{score}점 · 스트라이크 {x} · 스페어 {s}', { score: lastResult.score, x: lastResult.strikes, s: lastResult.spares }); }
    else { $('waitT').textContent = '경기 끝'; $('waitB').textContent = ''; }
    go.innerHTML = '다시 하기';
  } else {
    $('waitT').textContent = '대기실';
    $('waitB').textContent = '';
    go.innerHTML = '준비';
  }
  if (mineReady) { go.innerHTML = '준비 완료 ✓<small>다른 사람을 기다려요</small>'; go.disabled = true; go.classList.add('waiting', 'ready'); }
  const box = $('waitChips'); box.textContent = '';
  for (const [k, v] of chips) { const c = el('span', 'chip'); c.append(k); const b = document.createElement('b'); b.textContent = v; c.append(b); box.append(c); }
  paintReadyRow();
  $('btnCalLobby').classList.toggle('hidden', !(gotMotion && !fallback && isHard()));
  $('fb').classList.remove('on');
  tut.setLinkVisible(true);
  paintBall();
  show('vWait');
}
function render() {
  if (!me) return;
  if (mode === 'start' || mode === 'connecting' || mode === 'msg' || mode === 'tut') return;
  if (state.phase === 'playing') { showPlay(); return; }
  showWait();
}
function keepAwake() { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {}); }

// ---------- 소켓 ----------
function join() {
  mode = 'connecting';
  $('msgT').textContent = '들어가는 중…'; $('msgB').textContent = '큰 화면과 연결하고 있어요.'; $('btnMsg').classList.add('hidden');
  show('vMsg');
  if (socket.connected) socket.emit('join', { role: 'controller', room: ROOM, token });
  else socket.connect();
}
let noRoomTries = 0;
socket.on('connect', () => { banner(''); socket.emit('join', { role: 'controller', room: ROOM, token }); });
socket.on('disconnect', () => { if (me) banner('서버 연결이 끊겼어요. 다시 잇는 중…'); });
socket.on('assigned', (p) => {
  if (!p || p.game !== 'bowling') { location.replace(`${PLAY_URL(p && p.game ? p.game : 'baseball')}?room=${encodeURIComponent((p && p.code) || ROOM)}`); return; }
  me = p; noRoomTries = 0;
  document.documentElement.style.setProperty('--c', p.color);
  tut.setColor(p.color);
  haptics.config({ color: p.color });
  $('me').textContent = p.name;
  if (mode === 'connecting' || (mode === 'msg' && !helpOn)) mode = 'idle';
  send('calibrate', {});
  render();
});
socket.on('players', (pl) => { roster = pl && Array.isArray(pl.players) ? pl.players : []; if (mode === 'wait') render(); });
socket.on('ready_state', (st) => { readyInfo = st || null; readyList = st && Array.isArray(st.ready) ? st.ready : []; if (mode === 'wait') render(); });
socket.on('display_status', ({ connected } = {}) => { banner(connected ? '' : '큰 화면이 꺼져 있어요. 다시 열리면 이어서 해요.'); render(); });
socket.on('no_room', () => {
  if (noRoomTries++ < 15) { message('방에 다시 연결하는 중', '잠시만 기다려 주세요.'); setTimeout(() => socket.connected && socket.emit('join', { role: 'controller', room: ROOM, token }), 2000); return; }
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
  if (state.stage !== 'aim') thrown = false;
  if (!(state.turn && me && state.turn.slot === me.slot && state.stage === 'aim')) myTurn = null;
  else if (!myTurn) myTurn = state.turn;
  render();
});
socket.on('turn', (t) => {
  myTurn = t;
  setAim(typeof t.x === 'number' ? t.x : aimX, true);
  resetSwing();
  thrown = false;
  if (gotOri) yawRef = yawNow; // 차례 시작 때 정면을 자동으로 잡음
  lastThrowAt = performance.now() - COOLDOWN_MS + TURN_LOCK_MS; // 막 시작한 차례의 잔동작은 잠깐만 무시
  $('readout').textContent = '';
  render();
});
socket.on('cue', (c) => {
  if (!c) return;
  if (c.kind === 'throw') $('readout').textContent = c.text;
  else if (c.kind === 'strike' || c.kind === 'turkey') { flash('rgba(255,210,60,.7)'); $('readout').textContent = c.text; }
  else if (c.kind === 'spare') { flash('rgba(94,224,122,.6)'); $('readout').textContent = c.text; }
  else if (c.kind === 'turn') flash();
  else if (c.kind === 'aim_warn') { $('readout').textContent = c.text || ''; haptics.tick(); }
  else $('readout').textContent = c.text || '';
});
socket.on('result', (r) => { lastResult = r || null; render(); });

// ---------- 버튼 ----------
$('btnStart').addEventListener('click', async () => {
  if (mode !== 'start') return;
  mode = 'connecting'; $('btnStart').disabled = true;
  keepAwake(); haptics.unlock();
  const perm = await requestMotionPermission();
  permDenied = perm !== 'granted';
  window.addEventListener('deviceorientation', onOrientation);
  window.addEventListener('devicemotion', onMotion);
  if (!ROOM) { message('방 코드가 없어요', '큰 화면의 QR을 찍어 주세요.'); return; }
  join();
  setTimeout(() => {
    if (gotMotion) return;
    fallback = true; // 센서가 없으면 큰 버튼으로 굴립니다(막는 화면 없음)
    banner('버튼으로 굴려요');
    setTimeout(() => banner(''), 4000);
    render();
  }, SENSOR_WAIT_MS);
});
$('btnGo').addEventListener('click', () => {
  keepAwake();
  if (me && readyList.includes(me.slot) && state.phase !== 'playing') return;
  if (!gotMotion && !fallback) return;
  if (gotOri) yawRef = yawNow; // 준비를 누를 때 정면을 자동으로 잡음
  if (send('start_game', {})) {
    haptics.tick();
    if (me && !readyList.includes(me.slot)) readyList = [...readyList, me.slot];
    render();
  }
});
function recal() { if (gotOri) { yawRef = yawNow; haptics.buzz([30, 40, 30], { noFlash: true }); $('readout').textContent = '다시 맞췄어요'; } }
$('btnCalLobby').addEventListener('click', recal);
$('btnRecal').addEventListener('click', recal);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (mode !== 'start') keepAwake(); render(); } });
paintBall();
drawPins(null);
if (DEBUG) {
  document.body.classList.add('dbg');
  setInterval(() => { $('debug').textContent = `rate ${rateDbg.toFixed(0)} sw ${sw.st} yaw ${(yawNow - (yawRef ?? 0)).toFixed(0)} mode ${mode} fb ${fallback ? 'Y' : 'N'} lv ${level()}`; }, 300);
}
window.__bowlingPhone = {
  get state() { return state; }, get mode() { return mode; }, get fallback() { return fallback; }, get aimX() { return aimX; },
  setAim, fbThrow, tapThrow, deliver, setMode(m) { mode = m; }, onMotion, onOrientation, tut, ps, haptics, send, socket,
  get sw() { return sw; }
};
