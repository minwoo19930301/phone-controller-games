// 볼링 컨트롤러. 폰이 볼링공입니다.
// 화면을 위로 해서 손에 쥐고, 손가락으로 레인 그림을 밀어 서는 자리(aim{x}, -1..1)를 고른 뒤,
// 뒤로 뺐다가 앞으로 휘두르면 앞스윙 속도가 정점을 지나는 순간 throw{speed(km/h), dir(도), spin(-1..1), quality(0..1)} 를 보냅니다.
// - speed: 앞스윙 때 폰이 기울어지는 최고 각속도(rotationRate.alpha)에서
// - dir: 놓는 순간의 방향(deviceorientation.alpha)과, 가만히 있던 때의 정면 값의 차이
// - spin: 앞스윙 동안 폰 긴 축(rotationRate.beta)으로 비튼 각도의 합(손목 비틀기)
// 센서가 없는 PC 에서는 "시험 투구" 슬라이더가 대신합니다(키보드: Space 시험 투구, 좌우 방향키 자리).
import { haptics } from '/common/haptics.js';
import { createPhoneSettings } from '/common/phone-settings.js';
import { createTutorial } from '/common/tutorial.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ROOM = (params.get('room') || '').toUpperCase();
const DEBUG = params.has('debug');
$('room').textContent = ROOM ? `방 ${ROOM}` : '';

// ---------- 조정 값 (실폰 검증 전이라 바뀔 수 있습니다) ----------
const BACK_DPS = 80; // 뒤로 빼는 동작으로 인정하는 최소 각속도(도/초)
const FWD_DPS = 170; // 앞스윙으로 인정하는 최소 최고 각속도
const BACK_MAX_MS = 2200; // 뒤로 뺀 뒤 앞으로 올 때까지 기다려 주는 시간
const FWD_MAX_MS = 900; // 앞스윙 최대 길이
const RELEASE_FRAC = 0.65; // 최고 각속도의 이 비율 아래로 내려오면 놓은 것(정점 직후)
const KMH_BASE = 12, KMH_PER_DPS = 0.05; // 속도(km/h) = 12 + 최고 각속도 × 0.05, 12~40
const TWIST_FULL_DEG = 70; // 이만큼 비틀면 훅 최대(1)
const SPIN_SIGN = 1; // 비튼 방향 → 훅 방향이 반대로 느껴지면 -1
const DIR_SIGN = -1; // deviceorientation.alpha 는 왼쪽으로 돌릴수록 커집니다
const STILL_DPS = 25, STILL_MS = 450; // 이 정도로 가만히 있으면 지금 방향을 정면으로 삼음
const COOLDOWN_MS = 1400;
const AIM_MS = 40;
const SENSOR_WAIT_MS = 1500;
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
let readyList = [], readyInfo = null, roster = [];
let myTurn = null; // 'turn' 이벤트 마지막 값
let aimX = 0;
let lastAimSent = 0;
let lastThrowAt = -1e9;

function show(id) {
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === id);
  $('btnRecal').classList.toggle('hidden', !(id === 'vPlay' && gotMotion && !fallback));
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
  if (aimWatch) aimWatch();
}
function dragLane(el) {
  let down = false;
  const set = (e) => {
    const r = el.getBoundingClientRect();
    setAim(((e.clientX - r.left) / r.width - 0.5) / 0.46);
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
  else if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) fbThrow(); }
});

// ---------- 센서: 스윙 감지 ----------
let yawNow = 0, yawRef = null, gotOri = false;
function onOrientation(e) {
  if (e.alpha == null) return;
  yawNow = e.alpha;
  gotOri = true;
  if (yawRef === null) yawRef = yawNow;
}
let sw = { st: 'idle', s0: 0, tBack: 0, backPeak: 0, peak: 0, twist: 0, yawE: 0, n: 0, tFwd: 0, peakT: 0 };
let stillSince = 0, lastMotionT = 0;
let rateDbg = 0;
function resetSwing() { sw = { st: 'idle', s0: 0, tBack: 0, backPeak: 0, peak: 0, twist: 0, yawE: 0, n: 0, tFwd: 0, peakT: 0 }; }
const swingActive = () => {
  if (mode === 'tut') return true;
  return state.phase === 'playing' && state.stage === 'aim' && myTurn && me && state.turn && state.turn.slot === me.slot;
};
function onMotion(e) {
  const rr = e.rotationRate;
  if (!rr || (rr.alpha == null && rr.beta == null)) return;
  const t = e.timeStamp > 0 && Math.abs(performance.now() - e.timeStamp) < 1000 ? e.timeStamp : performance.now();
  if (!gotMotion) { gotMotion = true; fallback = false; render(); }
  const dt = lastMotionT ? clamp((t - lastMotionT) / 1000, 0, 0.05) : 1 / 60;
  lastMotionT = t;
  const p = rr.alpha || 0; // 앞뒤 스윙 축
  const tw = rr.beta || 0; // 긴 축(손목 비틀기)
  const yr = rr.gamma || 0;
  rateDbg = p;
  // 가만히 있으면 정면 갱신
  if (Math.abs(p) < STILL_DPS && Math.abs(tw) < 60 && Math.abs(yr) < 60) {
    if (!stillSince) stillSince = t;
    if (t - stillSince > STILL_MS && sw.st === 'idle' && gotOri) yawRef = yawNow;
  } else stillSince = 0;
  if (!swingActive() || t - lastThrowAt < COOLDOWN_MS) { if (sw.st !== 'idle') resetSwing(); return; }
  const ap = Math.abs(p), sg = Math.sign(p);
  if (sw.st === 'idle') {
    if (ap > BACK_DPS) sw = { ...sw, st: 'back', s0: sg, tBack: t, backPeak: ap };
  } else if (sw.st === 'back') {
    if (sg === sw.s0) sw.backPeak = Math.max(sw.backPeak, ap);
    if (sg === -sw.s0 && ap > FWD_DPS * 0.5) {
      sw = { ...sw, st: 'fwd', tFwd: t, peak: ap, peakT: t, twist: 0, yawE: 0, n: 0 };
      if (tutBack) tut.signal('back', { peak: sw.backPeak });
    }
    if (t - sw.tBack > BACK_MAX_MS) resetSwing();
  }
  if (sw.st === 'fwd') {
    sw.twist += tw * dt * SPIN_SIGN;
    sw.yawE += Math.abs(yr); sw.n += 1;
    if (sg === -sw.s0 && ap > sw.peak) { sw.peak = ap; sw.peakT = t; }
    const past = sg !== -sw.s0 || ap < sw.peak * RELEASE_FRAC;
    if ((past && sw.peak >= FWD_DPS) || t - sw.tFwd > FWD_MAX_MS) {
      const ok = sw.peak >= FWD_DPS;
      const out = { speed: clamp(KMH_BASE + sw.peak * KMH_PER_DPS, KMH_BASE, 40), spin: clamp(sw.twist / TWIST_FULL_DEG, -1, 1), peak: sw.peak };
      const yawRate = sw.n ? sw.yawE / sw.n : 0;
      out.quality = clamp(1 - yawRate / Math.max(150, sw.peak * 0.6), 0, 1);
      out.dir = gotOri && yawRef !== null ? DIR_SIGN * wrap180(yawNow - yawRef) : 0;
      resetSwing();
      if (ok) deliver(out);
    } else if (past) resetSwing();
  }
}
function r2(v) { return Math.round(v * 100) / 100; }
function deliver(d) {
  lastThrowAt = performance.now();
  const data = { speed: r2(d.speed), dir: r2(clamp(d.dir, -40, 40)), spin: r2(d.spin), quality: r2(d.quality), x: Math.round(aimX * 1000) / 1000 };
  haptics.hit(clamp(d.speed / 40, 0.3, 1));
  $('readout').textContent = `${data.speed} km/h · 방향 ${data.dir}° · 훅 ${data.spin}`;
  if (tut.signal('swing', { ...data, hook: Math.abs(data.spin) })) {
    if (mode === 'tut' && tutStepId() === 'hook') tut.signal('hook', data);
    return;
  }
  if (mode === 'tut') return;
  send('throw', data);
  setSwingBtn('굴렸어요!', '결과를 기다려요', 'idle');
}
// 시험 투구(센서 없음)
function fbThrow() {
  if (!swingActive() && mode !== 'tut') return;
  deliver({ speed: Number($('fbSpeed').value), dir: Number($('fbDir').value), spin: Number($('fbSpin').value) / 100, quality: 0.8, peak: 300 });
}
$('fbThrow').addEventListener('click', fbThrow);
$('swingBtn').addEventListener('click', () => { if (fallback) fbThrow(); });

// ---------- 튜토리얼 ----------
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
let tutBack = false;
let aimWatch = null;
const tutStepId = () => { const c = tut.current(); return c ? c.id : null; };
function stageLane(stage) {
  const box = el('div', 'gt-col');
  const lane = el('div', 'lanebox', '<div class="lbl">좌우로 밀어 봐요</div><div class="ball" id="ballTut"></div>');
  lane.style.width = '100%';
  box.appendChild(lane);
  stage.appendChild(box);
  const ball = lane.querySelector('.ball');
  const seen = { l: false, r: false };
  const paint = () => { ball.style.left = `${50 + aimX * 42}%`; };
  paint();
  aimWatch = () => {
    paint();
    if (aimX < -0.55) seen.l = true;
    if (aimX > 0.55) seen.r = true;
    if (seen.l && seen.r && !aimWatch.done) { aimWatch.done = true; tut.signal('aimed', seen); }
  };
  dragLane(lane);
  return () => { aimWatch = null; };
}
function stageSwing(id) {
  return (stage) => {
    tutBack = id === 'back';
    if (fallback || !gotMotion) {
      const b = el('button', 'gt-btn', id === 'back' ? '뒤로 뺐어요 (시험)' : '시험 투구');
      b.type = 'button';
      b.addEventListener('click', () => {
        if (id === 'back') tut.signal('back', {});
        else deliver({ speed: 26, dir: 0, spin: id === 'hook' ? -0.8 : 0.1, quality: 0.8, peak: 300 });
      });
      const box = el('div', 'gt-col'); box.appendChild(b); stage.appendChild(box);
    }
    return () => { tutBack = false; };
  };
}
const tut = createTutorial({
  key: 'bowling',
  socket,
  title: '처음이라 굴리는 법을 연습해요',
  steps: [
    { id: 'aim', title: '서는 자리 고르기', body: '레인 그림을 손가락으로 좌우로 밀어\n양쪽 끝까지 보내 봐요.', svg: 'swipe', waitFor: 'aimed', hint: '왼쪽 끝, 오른쪽 끝', okText: '자리 잡기 끝!', render: stageLane },
    { id: 'back', title: '뒤로 빼기', body: '화면을 위로 쥐고\n팔을 뒤로 휙 빼 봐요.', svg: 'swing', svgOpts: { dir: -1 }, waitFor: 'back', hint: '뒤로 슥', okText: '좋아요!', render: stageSwing('back') },
    { id: 'swing', title: '앞으로 굴리기', body: '뒤로 뺐다가 앞으로 쭉 휘둘러요.\n정점에서 공이 나가요.', svg: 'swing', waitFor: 'swing', hint: '뒤로 뺐다 앞으로', okText: '굴렸어요!', render: stageSwing('swing') },
    {
      id: 'hook', title: '손목 비틀어 휘게 하기', body: '굴리면서 손목을 슬쩍 비틀면\n공이 휘어요. 한 번 해 봐요.', svg: 'twist', waitFor: 'hook', hint: '굴리면서 비틀기', render: stageSwing('hook'),
      check: (d) => (Math.abs(d.spin) >= 0.35 ? { ok: true, msg: d.spin < 0 ? '왼쪽으로 휘었어요' : '오른쪽으로 휘었어요' } : '조금 더 비틀어 봐요')
    }
  ],
  finish: { title: '연습 끝!', body: '이제 준비를 누르면 돼요.\n모두 준비하면 바로 시작해요.', button: '좋아요' },
  onDone: () => { if (mode === 'tut') mode = 'idle'; render(); }
});
tut.link($('tutLink'), { before: () => { if (state.phase === 'playing' || !me) return false; mode = 'tut'; return true; } });
let tutAuto = false;
function shouldAutoTutorial() { return !tutAuto && me && (gotMotion || fallback) && (state.phase === 'lobby' || state.phase === 'over') && !tut.isRunning() && tut.firstTime(); }

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
  const t = state.turn;
  const mine = Boolean(t && me && t.slot === me.slot && state.stage === 'aim');
  const sp = state.players && me ? state.players[me.slot] : null;
  $('fb').classList.toggle('on', fallback);
  drawPins(t ? t.pins : null);
  if (sp && sp.pending) {
    $('tTitle').textContent = '다음 프레임부터';
    $('tSub').textContent = '지금 프레임이 끝나면 같이 해요';
    setSwingBtn('구경 중', '곧 내 차례가 와요', 'idle');
  } else if (t && me && t.slot === me.slot) {
    $('tTitle').textContent = mine ? '내 차례!' : '굴리는 중…';
    $('tSub').textContent = `프레임 ${t.frame} / ${state.frames} · ${t.ball}번째 공`;
    if (mine) setSwingBtn('뒤로 뺐다가 앞으로 휘둘러요', fallback ? '아래 슬라이더로 시험 투구' : '손목을 비틀면 공이 휘어요', 'live');
    else setSwingBtn('결과를 기다려요', '', 'idle');
  } else if (t) {
    $('tTitle').textContent = `${t.slot}P 차례`;
    $('tSub').textContent = `프레임 ${t.frame} / ${state.frames}`;
    setSwingBtn('기다려요', '내 차례가 오면 알려 줘요', 'idle');
  } else {
    $('tTitle').textContent = '곧 시작해요';
    $('tSub').textContent = '';
    setSwingBtn('기다려요', '', 'idle');
  }
  $('laneLbl').textContent = mine ? '손가락으로 서는 자리 고르기' : '내 차례 때 자리를 골라요';
  // 점수 요약
  const box = $('mini');
  box.textContent = '';
  for (const s of state.order || []) {
    const p = state.players[s];
    if (!p) continue;
    const d = el('div', me && s === me.slot ? 'me' : '', `<span style="color:${COLORS[s] || '#fff'}">${s}P${p.pending ? ' (대기)' : ''}</span><b>${p.total ?? 0}</b>`);
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
  const head = !waitFor.length ? '모두 준비 완료!' : mine ? `${waitFor.map((s) => `${s}P`).join('·')} 기다리는 중` : `준비 ${ready.size}/${st.players.length}`;
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
  if (roster.length) chips.push(['참가', `${roster.length}명`]);
  chips.push(['조작', fallback ? '버튼' : '스윙']);
  if (phase === 'over') {
    if (lastResult) { $('waitT').textContent = lastResult.rank === 1 ? '1위!' : `${lastResult.rank}위`; $('waitB').textContent = `${lastResult.score}점 · 스트라이크 ${lastResult.strikes} · 스페어 ${lastResult.spares}\n큰 화면에서 순위를 확인해요.`; }
    else { $('waitT').textContent = '경기 끝'; $('waitB').textContent = '큰 화면에서 순위를 확인해요.'; }
    go.innerHTML = '다시 하기';
  } else {
    $('waitT').textContent = '대기실';
    $('waitB').textContent = '모두 준비를 누르면 시작해요.';
    go.innerHTML = '준비';
  }
  if (mineReady) { go.innerHTML = '준비 완료 ✓<small>다른 사람을 기다려요</small>'; go.disabled = true; go.classList.add('waiting', 'ready'); }
  const box = $('waitChips'); box.textContent = '';
  for (const [k, v] of chips) { const c = el('span', 'chip'); c.append(k); const b = document.createElement('b'); b.textContent = v; c.append(b); box.append(c); }
  paintReadyRow();
  $('btnCalLobby').classList.toggle('hidden', !(gotMotion && !fallback));
  $('fb').classList.remove('on');
  tut.setLinkVisible(true);
  paintBall();
  show('vWait');
}
function render() {
  if (!me) return;
  if (mode === 'start' || mode === 'connecting' || mode === 'msg' || mode === 'tut') return;
  if (state.phase === 'playing') { showPlay(); return; }
  if (shouldAutoTutorial()) { tutAuto = true; mode = 'tut'; tut.run(); return; }
  showWait();
}
function fallbackReason() {
  if (!window.isSecureContext) return 'https 주소가 아니라 동작 센서가 꺼져 있어요. 버튼으로 해요.';
  if (permDenied) return '동작 권한이 거절돼 버튼으로 해요.';
  return '동작 센서가 없어 버튼으로 해요.';
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
  if (!(state.turn && me && state.turn.slot === me.slot && state.stage === 'aim')) myTurn = null;
  else if (!myTurn) myTurn = state.turn;
  render();
});
socket.on('turn', (t) => {
  myTurn = t;
  setAim(typeof t.x === 'number' ? t.x : aimX, true);
  resetSwing();
  lastThrowAt = performance.now() - COOLDOWN_MS + 500; // 막 시작한 차례의 잔동작은 무시
  $('readout').textContent = '';
  render();
});
socket.on('cue', (c) => {
  if (!c) return;
  if (c.kind === 'throw') $('readout').textContent = c.text;
  else if (c.kind === 'strike' || c.kind === 'turkey') { flash('rgba(255,210,60,.7)'); $('readout').textContent = c.text; }
  else if (c.kind === 'spare') { flash('rgba(94,224,122,.6)'); $('readout').textContent = c.text; }
  else if (c.kind === 'turn') flash();
  else $('readout').textContent = c.text || '';
});
socket.on('result', (r) => { lastResult = r || null; render(); });

// ---------- 버튼 ----------
$('btnStart').addEventListener('click', async () => {
  if (mode !== 'start') return;
  mode = 'connecting'; $('btnStart').disabled = true;
  keepAwake(); haptics.unlock();
  const asks = [];
  if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') asks.push(DeviceOrientationEvent.requestPermission().catch(() => 'denied'));
  if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') asks.push(DeviceMotionEvent.requestPermission().catch(() => 'denied'));
  const res = await Promise.all(asks);
  permDenied = res.some((x) => x !== 'granted');
  window.addEventListener('deviceorientation', onOrientation);
  window.addEventListener('devicemotion', onMotion);
  if (!ROOM) { message('방 코드가 없어요', '큰 화면의 QR을 찍어 주세요.'); return; }
  join();
  setTimeout(() => {
    if (gotMotion) return;
    fallback = true;
    if (isTouch && !DEBUG && window.isSecureContext) {
      message('동작 센서를 쓸 수 없어요', 'iPhone: Safari 를 완전히 닫고 QR을 다시 찍어 동작 접근을 허용해 주세요.\nAndroid: 주소창 자물쇠 → 사이트 설정 → 동작 센서를 허용해 주세요.', { label: '버튼으로 할게요', onClick: () => { join(); } });
      helpOn = true;
      return;
    }
    render();
  }, SENSOR_WAIT_MS);
});
$('btnGo').addEventListener('click', () => {
  keepAwake();
  if (me && readyList.includes(me.slot) && state.phase !== 'playing') return;
  if (!gotMotion && !fallback) return;
  if (send('start_game', {})) {
    haptics.tick();
    if (me && !readyList.includes(me.slot)) readyList = [...readyList, me.slot];
    render();
  }
});
function recal() { if (gotOri) { yawRef = yawNow; haptics.buzz([30, 40, 30], { noFlash: true }); $('readout').textContent = '정면을 다시 맞췄어요'; } }
$('btnCalLobby').addEventListener('click', recal);
$('btnRecal').addEventListener('click', recal);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (mode !== 'start') keepAwake(); render(); } });
if (!window.isSecureContext) $('httpNote').classList.remove('hidden');
paintBall();
drawPins(null);
if (DEBUG) {
  document.body.classList.add('dbg');
  setInterval(() => { $('debug').textContent = `rate ${rateDbg.toFixed(0)} sw ${sw.st} yaw ${(yawNow - (yawRef ?? 0)).toFixed(0)} mode ${mode} fb ${fallback ? 'Y' : 'N'} ${fallbackReason()}`; }, 300);
}
window.__bowlingPhone = {
  get state() { return state; }, get mode() { return mode; }, get fallback() { return fallback; }, get aimX() { return aimX; },
  setAim, fbThrow, deliver, onMotion, onOrientation, tut, ps, haptics, send, socket,
  get sw() { return sw; }
};
