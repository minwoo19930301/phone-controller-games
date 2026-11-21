// 줄다리기 컨트롤러. 폰을 두 손으로 쥐고 "영차!" 박에 맞춰 가슴 쪽으로 확 당깁니다.
// 센서(devicemotion)의 선형 가속도 크기가 문턱을 넘는 날카로운 봉우리 = 당김. 봉우리가 지나간 뒤(PEAK_WIN_MS) 한 번 보냅니다.
// pull { power 0.3~1, ago(봉우리가 난 뒤 지난 ms), rtt } → 큰 화면이 도착 시각에서 ago·왕복 지연을 빼 실제 당긴 때를 맞춰 판정합니다.
// 큰 화면의 beat {kind, in(ms 뒤 박이 옴), ...} 를 받으면 그 시각에 맞춰 번쩍·진동(영차 박). 센서가 없는 PC 는 큰 "당겨!" 버튼(또는 Space).
// 버티기: 구령에서 팀이 버틸 차례면 구령 앞뒤로 폰을 가만히 쥐고 있었는지 보고 msg {type:'brace'} 를 보냅니다.
import { haptics } from '/common/haptics.js';
import { createPhoneSettings } from '/common/phone-settings.js';
import { createTutorial } from '/common/tutorial.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ROOM = (params.get('room') || '').toUpperCase();
const DEBUG = params.has('debug');
$('room').textContent = ROOM ? `방 ${ROOM}` : '';

// ---------- 조정 값 (실폰 검증 전이라 바뀔 수 있습니다) ----------
const PULL_THRESH = 13; // 선형 가속도(m/s²) 크기가 이걸 넘으면 당김 후보. 폰이 너무 둔감하면 낮추고, 걷기만 해도 반응하면 올림
const PULL_FULL = 30; // 이만큼 세게 당기면 power 1
const REFRACT_MS = 260; // 한 번 당긴 뒤 이 시간은 새 당김으로 보지 않음(되돌아오는 반동 무시)
const PEAK_WIN_MS = 70; // 문턱을 넘은 뒤 이 시간 동안의 최대값을 그 당김의 세기로
const STILL_MAX = 3.4; // 버티기: 구령 앞뒤에서 가속도가 이 값을 넘지 않아야 '가만히'
const BRACE_PRE_MS = 380; // 버티기를 보는 구간: 당기는 박 앞
const BRACE_POST_MS = 260; // 뒤
const GRAV_ALPHA = 0.92; // acceleration 이 없는 폰: 중력 추정 저역 통과 계수
const SENSOR_WAIT_MS = 1500; // 이 시간 안에 센서 값이 없으면 버튼 모드
const BEAT_SHIFT_MS = 12; // 박 알림 보정(폰 화면이 늦게 켜지는 정도)
const COLORS = { 1: '#ff5a5f', 2: '#3ab4ff', 3: '#ffc93c', 4: '#5ee07a', 5: '#c77dff', 6: '#ff8fd1', 7: '#3ee6d6', 8: '#ff9b3d' };
const DIFF_LABEL = { easy: '쉬움', normal: '보통', hard: '어려움' };
const TEAM = { blue: '청팀', white: '백팀' };
const PLAY_URL = (g) => (g === 'baseball' ? '/play/' : `/play/${g}/`);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

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
let stateAt = 0;
let roster = [];
let mode = 'start'; // start | connecting | msg | wait | play | idle | tut
let gotMotion = false;
let fallback = false;
let permDenied = false;
let helpOn = false;
let readyList = [];
let readyInfo = null;
let pendingPref = null;
let lastResult = null;
let calSent = false;
let noRoomTries = 0;

function show(id) {
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === id);
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
function vignette() {
  const f = $('flash');
  f.className = '';
  void f.offsetWidth;
  f.className = 'go';
}

// ---------- 왕복 시간 ----------
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

// ================================================================
// 센서: 당김 감지 · 가만히(버티기)
// ================================================================
let motionCount = 0;
let lastMag = 0;
let lastPeak = 0;
let grav = null;
let pk = null; // 문턱을 넘은 뒤 최대값을 모으는 중 { start, max, tmax }
let lastPullAt = -1e9;
let braceWin = null; // { from, to, max, pulled }
let tutBrace = null; // 튜토리얼 버티기 단계 { t0, max }
function onMotion(e) {
  const t = performance.now();
  let mag;
  const a = e.acceleration;
  if (a && a.x != null && a.y != null && a.z != null) mag = Math.hypot(a.x, a.y, a.z);
  else {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null) return;
    if (!grav) grav = { x: g.x, y: g.y, z: g.z };
    grav.x = grav.x * GRAV_ALPHA + g.x * (1 - GRAV_ALPHA);
    grav.y = grav.y * GRAV_ALPHA + g.y * (1 - GRAV_ALPHA);
    grav.z = grav.z * GRAV_ALPHA + g.z * (1 - GRAV_ALPHA);
    mag = Math.hypot(g.x - grav.x, g.y - grav.y, g.z - grav.z);
  }
  if (!Number.isFinite(mag)) return;
  motionCount++;
  lastMag = mag;
  if (!gotMotion && (mag > 0 || motionCount > 3)) {
    gotMotion = true;
    sensorsChanged();
  }
  if (braceWin && t >= braceWin.from && t <= braceWin.to) braceWin.max = Math.max(braceWin.max, mag);
  if (tutBrace) tutBrace.max = Math.max(tutBrace.max, mag);
  if (!pk) {
    if (mag > PULL_THRESH && t - lastPullAt > REFRACT_MS) pk = { start: t, max: mag, tmax: t };
  } else {
    if (mag > pk.max) { pk.max = mag; pk.tmax = t; }
    if (t - pk.start >= PEAK_WIN_MS) {
      const power = clamp(0.3 + (0.7 * (pk.max - PULL_THRESH)) / (PULL_FULL - PULL_THRESH), 0.3, 1);
      const ago = Math.max(0, Math.round(t - pk.tmax));
      lastPullAt = t;
      lastPeak = pk.max;
      pk = null;
      doPull(power, ago, 'sensor');
    }
  }
}

// ---------- 당기기 ----------
let practiceTimer = null;
function inGame() {
  const p = myInfo();
  return state.phase === 'playing' && p && p.inRound && state.stage === 'run';
}
function doPull(power, ago, how) {
  if (!me) return;
  haptics.unlock();
  if (braceWin && performance.now() <= braceWin.to + 50) braceWin.pulled = true;
  if (tutBrace) tutBrace.max = 99;
  kick();
  if (mode === 'tut') { tutPull(power, ago, how); return; }
  if (state.phase === 'playing') {
    if (!inGame()) return; // 관전·준비 시간에는 보내지 않음
  } else {
    // 대기실 연습: 큰 화면 캐릭터가 같이 당김, 폰에도 세기 표시
    $('practiceM').style.width = `${Math.round(power * 100)}%`;
    clearTimeout(practiceTimer);
    practiceTimer = setTimeout(() => { $('practiceM').style.width = '0'; }, 700);
    if (!calSent && how === 'sensor') { calSent = true; send('calibrate', {}); }
  }
  send('pull', { power: Math.round(power * 100) / 100, ago, rtt: Math.round(rtt()) });
}
function kick() {
  for (const id of ['btnPull', 'btnPractice']) {
    const b = $(id);
    b.classList.add('on');
    setTimeout(() => b.classList.remove('on'), 90);
  }
}
for (const id of ['btnPull', 'btnPractice']) {
  $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); doPull(0.8, 0, 'button'); });
}
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat) { e.preventDefault(); if (me) doPull(0.85, 0, 'button'); }
});

// ================================================================
// 박(beat): 큰 화면이 박보다 미리 알려 주면 그 시각에 번쩍·진동
// ================================================================
let braceShown = false;
let sprintNow = false;
function fireBeat(b) {
  const id = { one: 'bOne', two: 'bTwo', pull: 'bPull' }[b.kind];
  if (id) {
    const el = $(id);
    el.classList.add('on');
    setTimeout(() => el.classList.remove('on'), b.kind === 'pull' ? 260 : 170);
  }
  if (b.kind === 'pull' && mode !== 'tut') {
    const mineBrace = b.brace && b.brace === myTeam();
    if (!mineBrace) { vignette(); haptics.buzz([42], { noFlash: true }); }
  }
  sprintNow = Boolean(b.sprint);
  $('bTwo').classList.toggle('off', sprintNow);
}
socket.on('beat', (b) => {
  if (!b || mode === 'tut') return;
  const delay = Math.max(0, (b.in || 0) - rtt() / 2 - BEAT_SHIFT_MS);
  const at = performance.now() + delay;
  setTimeout(() => fireBeat(b), delay);
  const ringMs = Math.max(0, b.pullIn || 0);
  if (b.kind === 'one' || b.kind === 'two' || b.kind === 'pull') {
    // 영차 둘레 고리: 당기는 박까지 줄어듦
    const ring = $('bRing');
    const pullAt = performance.now() + Math.max(0, b.pullIn - rtt() / 2);
    ring.style.transition = 'none';
    ring.style.opacity = '0.9';
    ring.style.transform = 'scale(1.6)';
    void ring.offsetWidth;
    ring.style.transition = `transform ${Math.max(60, pullAt - performance.now())}ms linear, opacity .25s`;
    ring.style.transform = 'scale(1)';
    setTimeout(() => { ring.style.opacity = '0'; }, Math.max(0, pullAt - performance.now()) + 120);
  }
  if (b.brace && b.brace === myTeam() && inGame()) {
    showBrace(true);
    if (b.kind === 'pull') startBraceWindow(at);
  }
});
function showBrace(on, cls) {
  const o = $('braceOv');
  o.classList.toggle('on', on);
  o.classList.toggle('fail', cls === 'fail');
  braceShown = on;
}
function startBraceWindow(pullAtLocal) {
  const w = { from: pullAtLocal - BRACE_PRE_MS, to: pullAtLocal + BRACE_POST_MS, max: 0, pulled: false };
  braceWin = w;
  const total = w.to - performance.now();
  const bar = $('braceBar');
  bar.style.transition = 'none';
  bar.style.width = '0';
  void bar.offsetWidth;
  bar.style.transition = `width ${Math.max(100, total)}ms linear`;
  bar.style.width = '100%';
  setTimeout(() => {
    if (braceWin !== w) return;
    const ok = !w.pulled && w.max < STILL_MAX;
    braceWin = null;
    if (ok) {
      send('msg', { type: 'brace', ok: true });
      haptics.buzz([30, 40, 30], { noFlash: true });
    }
    $('braceOv').querySelector('b').textContent = ok ? '버텼다!' : '흔들렸어요';
    showBrace(true, ok ? '' : 'fail');
    setTimeout(() => { showBrace(false); $('braceOv').querySelector('b').textContent = '버텨!'; }, 800);
  }, Math.max(0, w.to - performance.now()) + 40);
}
// 큰 화면이 알려 주는 판정
socket.on('cue', (c) => {
  if (!c || mode === 'tut') return;
  if (c.practice) return;
  const b = $('judgeB');
  b.textContent = c.label || c.j || '';
  b.className = c.j || '';
  $('judgeS').textContent = c.combo >= 2 ? `콤보 ×${c.combo}` : c.j === 'miss' ? '박을 잘 듣고 당겨요' : c.j === 'perfect' ? '완벽한 박자!' : '';
  if (typeof c.stamina === 'number') setStamina(c.stamina);
});
function setStamina(v) {
  const i = $('stamI');
  i.style.width = `${Math.round(clamp(v, 0, 1) * 100)}%`;
  i.classList.toggle('low', v < 0.35);
}

// ================================================================
// 튜토리얼(처음 하는 폰): 당기기 → 박자 맞추기 → 버티기
// ================================================================
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const svgArt = (inner) => `<svg class="pcgt-svg" viewBox="0 0 200 160" aria-hidden="true">${inner}</svg>`;
const ART = {
  pull: () => svgArt(
    '<path d="M18 112h164" class="pcgt-tvs" stroke-dasharray="2 8"/>' +
    '<g><animateTransform attributeName="transform" type="translate" values="34 0;-8 0;34 0" keyTimes="0;.2;1" dur="1.6s" calcMode="spline" keySplines=".1 .8 .2 1;.4 0 .4 1" repeatCount="indefinite"/>' +
    '<rect x="78" y="34" width="34" height="62" rx="7" class="pcgt-ph"/><rect x="83" y="41" width="24" height="44" rx="3" class="pcgt-scr"/>' +
    '<rect x="62" y="78" width="26" height="20" rx="9" class="pcgt-hand"/><rect x="102" y="78" width="26" height="20" rx="9" class="pcgt-hand"/></g>' +
    '<path d="M168 56q-30 -14 -62 -2" class="pcgt-arc"/><path d="M114 44l-9 10 13 5" class="pcgt-arrow"/><rect x="150" y="96" width="30" height="46" rx="14" class="pcgt-hand" opacity=".45"/>'
  ),
  beat: () => svgArt(
    '<circle cx="46" cy="84" r="18" class="pcgt-ring"/><circle cx="100" cy="84" r="18" class="pcgt-ring"/>' +
    '<circle cx="160" cy="84" r="30" class="pcgt-ring"><animate attributeName="r" values="30;34;30" dur="1.2s" repeatCount="indefinite"/></circle>' +
    '<text x="46" y="90" text-anchor="middle" font-size="15" font-weight="900" fill="#fff">하나</text><text x="100" y="90" text-anchor="middle" font-size="15" font-weight="900" fill="#fff">둘</text>' +
    '<text x="160" y="92" text-anchor="middle" font-size="20" font-weight="900" fill="#fff">영차!</text>'
  ),
  hold: () => svgArt(
    '<rect x="78" y="30" width="44" height="78" rx="9" class="pcgt-ph"/><rect x="84" y="39" width="32" height="56" rx="4" class="pcgt-scr"/>' +
    '<rect x="60" y="88" width="30" height="24" rx="10" class="pcgt-hand"/><rect x="110" y="88" width="30" height="24" rx="10" class="pcgt-hand"/>' +
    '<circle cx="100" cy="72" r="48" class="pcgt-ring"><animate attributeName="r" values="46;66" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values=".7;0" dur="1.8s" repeatCount="indefinite"/></circle>'
  )
};
let tutPullHandler = null;
function tutPull(power, ago, how) {
  if (tutPullHandler) { tutPullHandler(power, ago); return; }
  tut.signal('pull', { power, how });
}
function stagePull(stage) {
  const wrap = el('div', 'gt-col');
  if (fallback) {
    const btn = el('button', 'gt-btn', '당겨!');
    btn.type = 'button';
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); doPull(0.8, 0, 'button'); });
    wrap.append(btn, el('p', 'gt-note', '센서가 없어 버튼으로 해요. 키보드 Space 도 돼요.'));
  } else wrap.appendChild(el('p', 'gt-note', '손에 쥔 채로 가슴 쪽으로 빠르게!'));
  stage.appendChild(wrap);
  tutPullHandler = null;
}
function stageTiming(stage, api) {
  const IVL = 720;
  const wrap = el('div', 'gt-col');
  const beats = el('div', 'gt-beats', '<div class="bd" data-k="one">하나</div><div class="bd" data-k="two">둘</div><div class="bd big" data-k="pull">영차!</div>');
  wrap.appendChild(beats);
  if (fallback) {
    const btn = el('button', 'gt-btn', '당겨!');
    btn.type = 'button';
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); doPull(0.8, 0, 'button'); });
    wrap.appendChild(btn);
  }
  wrap.appendChild(el('p', 'gt-note', '연습 박자예요. "영차!"가 켜질 때 당겨요'));
  stage.appendChild(wrap);
  const t0 = performance.now();
  const disc = (k) => beats.querySelector(`[data-k="${k}"]`);
  const kinds = ['one', 'two', 'pull', null];
  let lastIdx = -1;
  const timer = setInterval(() => {
    const t = performance.now() - t0;
    const idx = Math.floor(t / IVL);
    if (idx !== lastIdx) {
      lastIdx = idx;
      const k = kinds[idx % 4];
      for (const d of beats.children) d.classList.remove('on');
      if (k) {
        const d = disc(k);
        d.classList.add('on');
        setTimeout(() => d.classList.remove('on'), 220);
        if (k === 'pull') { haptics.buzz([40], { noFlash: true }); }
      }
    }
  }, 16);
  tutPullHandler = (power, ago) => {
    const t = performance.now() - ago - t0;
    // 가장 가까운 '영차' 박(4박마다 3번째)
    const cyc = IVL * 4;
    const k = Math.round((t - IVL * 2) / cyc);
    const off = t - (IVL * 2 + k * cyc);
    if (Math.abs(off) <= 200) tut.signal('timed', { ok: true, off });
    else tut.signal('timed', { ok: false, off });
  };
  return () => { clearInterval(timer); tutPullHandler = null; };
}
function stageBrace(stage, api) {
  const wrap = el('div', 'gt-col');
  const bar = el('div', 'gt-bar', '<i></i>');
  wrap.append(bar, el('p', 'gt-note', fallback ? '버튼을 누르지 않고 2.5초 기다려요' : '폰을 꽉 쥐고 2.5초 가만히 있어요'));
  stage.appendChild(wrap);
  const fill = bar.querySelector('i');
  tutBrace = { t0: performance.now(), max: 0 };
  tutPullHandler = () => { tutBrace = { t0: performance.now(), max: 0 }; };
  const timer = setInterval(() => {
    if (!tutBrace) return;
    if (tutBrace.max > STILL_MAX) { tutBrace = { t0: performance.now(), max: 0 }; fill.style.width = '0'; return; }
    const k = (performance.now() - tutBrace.t0) / 2500;
    fill.style.width = `${Math.round(clamp(k, 0, 1) * 100)}%`;
    if (k >= 1) { clearInterval(timer); tut.signal('brace', { ok: true }); }
  }, 60);
  return () => { clearInterval(timer); tutBrace = null; tutPullHandler = null; };
}
const tut = createTutorial({
  key: 'tugofwar',
  socket,
  title: '처음이라 줄 당기는 법을 연습해요',
  steps: [
    { id: 'pull', title: '확 당기기', body: '폰을 두 손으로 쥐고\n가슴 쪽으로 확 당겨요.', svg: ART.pull, waitFor: 'pull', count: 2, hint: '두 번 당겨요', okText: '좋아요!', render: stagePull },
    { id: 'timing', title: '박자 맞추기', body: '하나, 둘, 영차! 에서\n"영차!"에 맞춰 당겨요.', svg: ART.beat, waitFor: 'timed', count: 2, hint: '박에 맞춰 두 번', okText: '박자 좋아요!', render: stageTiming,
      check: (d) => (d && d.ok ? true : { ok: false, msg: d && d.off < 0 ? '조금 일찍 당겼어요' : '조금 늦었어요. 영차!에 맞춰요' }) },
    { id: 'brace', title: '버티기', body: '"버텨!" 구령에는 당기지 말고\n폰을 꽉 쥐고 가만히 있어요.', svg: ART.hold, waitFor: 'brace', hint: '2.5초 가만히', okText: '버티기 성공!', render: stageBrace }
  ],
  finish: { title: '연습 끝!', body: '이제 팀을 고르고 준비를 눌러요.\n모두 준비하면 바로 시작해요.', button: '좋아요' },
  onDone: () => endTut()
});
tut.link($('tutLink'), {
  before: () => {
    if (state.phase === 'playing' || !me) return false;
    enterTut();
    return true;
  }
});
let tutAuto = false;
function enterTut() { mode = 'tut'; }
function startTutorial() {
  tutAuto = true;
  enterTut();
  tut.run();
}
function endTut() {
  if (mode === 'tut') mode = 'idle';
  render();
}
function shouldAutoTutorial() {
  return !tutAuto && me && (gotMotion || fallback) && (state.phase === 'lobby' || state.phase === 'over') && !tut.isRunning() && tut.firstTime();
}

// ================================================================
// 화면 상태
// ================================================================
function myInfo() {
  if (!me || !state || !state.players) return null;
  return state.players[me.slot] || state.players[String(me.slot)] || null;
}
function myTeam() {
  const p = myInfo();
  return p ? p.team : null;
}
function paintTeam() {
  const tm = myTeam();
  document.body.dataset.team = tm || 'blue';
  const tag = $('teamTag');
  tag.classList.toggle('hidden', !tm);
  tag.textContent = tm ? TEAM[tm] : '';
}
function setChips(list, target) {
  const box = $(target);
  box.innerHTML = '';
  for (const [k, v, cls] of list) {
    const c = document.createElement('div');
    c.className = `chip ${cls || ''}`;
    c.innerHTML = `${k}<b>${v}</b>`;
    box.appendChild(c);
  }
}
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
function paintPicker() {
  const players = state.players ? Object.values(state.players) : [];
  const counts = { blue: 0, white: 0 };
  for (const p of players) if (p.team) counts[p.team]++;
  $('pkBlue').textContent = `${counts.blue}명`;
  $('pkWhite').textContent = `${counts.white}명`;
  const p = myInfo();
  const cur = pendingPref || (p ? p.pref : 'auto') || 'auto';
  for (const b of document.querySelectorAll('.pk')) b.classList.toggle('on', b.dataset.t === cur);
  const cpu = state.cpu || { blue: 0, white: 0 };
  const my = p && p.team ? `내 팀 <b>${TEAM[p.team]}</b>` : '';
  $('pickNote').innerHTML = `${my}${my ? ' · ' : ''}${cpu.blue + cpu.white ? '빈자리는 CPU 가 채워요' : '두 팀 인원이 같아요'}`;
}
for (const b of document.querySelectorAll('.pk')) {
  b.addEventListener('click', () => {
    pendingPref = b.dataset.t;
    haptics.unlock();
    haptics.tick();
    send('team', { team: b.dataset.t });
    paintPicker();
    setTimeout(() => { pendingPref = null; paintPicker(); }, 1200);
  });
}
function showWait() {
  mode = 'wait';
  const phase = state.phase;
  const mineReady = me && readyList.includes(me.slot);
  const go = $('btnGo');
  go.style.display = '';
  go.disabled = false;
  go.classList.remove('waiting', 'ready');
  const inMatch = phase === 'playing';
  if (phase === 'over') {
    if (lastResult) {
      $('waitT').textContent = lastResult.win ? '우리 팀 승리!' : '아쉬워요';
      $('waitB').textContent = `${TEAM[lastResult.winner] || ''} 우승 · 내 기록 PERFECT ${lastResult.perfect} · GOOD ${lastResult.good} · 최고 콤보 ${lastResult.bestCombo}${lastResult.mvp ? '\n내가 MVP!' : ''}`;
    } else {
      $('waitT').textContent = '경기 끝';
      $('waitB').textContent = '큰 화면에서 결과를 확인해요.';
    }
    go.innerHTML = '다시 하기';
  } else if (inMatch) {
    $('waitT').textContent = '관전 중';
    $('waitB').textContent = '지금 판이 끝나면 다음 판부터 함께해요.\n작은 팀에 자동으로 들어가요.';
    go.style.display = 'none';
  } else {
    $('waitT').textContent = '대기실';
    $('waitB').textContent = '팀을 고르고 준비를 눌러요.\n모두 준비하면 시작해요.';
    go.innerHTML = '준비';
  }
  if (mineReady && !inMatch) {
    go.innerHTML = '준비 완료 ✓<small>다른 사람을 기다려요</small>';
    go.disabled = true;
    go.classList.add('waiting', 'ready');
  } else if (!inMatch && !gotMotion && !fallback) {
    go.innerHTML = '준비<small>동작 센서 확인 중…</small>';
    go.classList.add('waiting');
  }
  const chips = [];
  if (roster.length) chips.push(['참가', `${roster.length}명`]);
  chips.push(['조작', fallback ? '버튼' : gotMotion ? '센서' : '확인 중', !fallback && gotMotion ? 'ok' : '']);
  setChips(chips, 'waitChips');
  $('picker').style.display = inMatch ? 'none' : '';
  $('pickNote').style.display = inMatch ? 'none' : '';
  $('btnPractice').style.display = inMatch ? 'none' : '';
  $('practiceSub').textContent = fallback ? '눌러서 큰 화면 캐릭터를 당겨 봐요' : '폰을 가슴 쪽으로 당겨 봐요';
  paintPicker();
  paintReadyRow();
  paintTeam();
  tut.setLinkVisible(!inMatch);
  show('vWait');
}
function showPlay() {
  mode = 'play';
  paintTeam();
  $('btnPull').classList.toggle('mini', !fallback);
  $('pullSub').textContent = fallback ? '눌러요 (키보드 Space)' : '폰을 당기거나 눌러요';
  $('winB').textContent = state.wins ? state.wins.blue : 0;
  $('winW').textContent = state.wins ? state.wins.white : 0;
  const p = myInfo();
  if (p) setStamina(p.stamina ?? 1);
  if (state.stage === 'run' && /시작/.test($('judgeB').textContent)) { $('judgeB').textContent = '영차!'; $('judgeB').className = ''; $('judgeS').textContent = '구령에 맞춰 폰을 확 당겨요'; }
  if (state.stage === 'intro') { $('judgeB').textContent = `${state.round}판 시작!`; $('judgeB').className = ''; $('judgeS').textContent = '곧 구령이 나와요'; }
  show('vPlay');
}
function render() {
  if (!me) return;
  if (mode === 'start' || mode === 'connecting' || mode === 'msg') return;
  if (mode === 'tut') return;
  const info = myInfo();
  if (state.phase === 'playing' && info && info.inRound) { showPlay(); return; }
  if (shouldAutoTutorial()) { startTutorial(); return; }
  showWait();
}
setInterval(() => {
  if (mode !== 'play' || !state.duration) return;
  const el2 = (performance.now() - stateAt) / 1000;
  const run = state.stage === 'run';
  const left = Math.max(0, Math.ceil(state.duration - (state.t || 0) - (run ? el2 : 0)));
  $('timeT').textContent = String(left);
  $('timeT').classList.toggle('sprint', Boolean(state.sprint));
}, 200);
function keepAwake() {
  if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
}
function sensorsChanged() {
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

// ================================================================
// 소켓
// ================================================================
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
socket.on('disconnect', () => { if (me) banner('서버 연결이 끊겼어요. 다시 잇는 중…'); });
socket.on('assigned', (p) => {
  if (!p || p.game !== 'tugofwar') {
    const code = encodeURIComponent((p && p.code) || ROOM);
    location.replace(`${PLAY_URL(p && p.game ? p.game : 'baseball')}?room=${code}`);
    return;
  }
  me = p;
  noRoomTries = 0;
  document.documentElement.style.setProperty('--slot', p.color);
  $('me').style.setProperty('--slot', p.color);
  tut.setColor(p.color);
  haptics.config({ color: p.color });
  $('me').textContent = p.name;
  if (fallback && !calSent) { calSent = true; send('calibrate', {}); }
  if (mode === 'connecting' || (mode === 'msg' && !helpOn)) mode = 'idle';
  render();
});
haptics.listen(socket, { slot: () => me && me.slot });
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
socket.on('room_full', () => message('8명이 꽉 찼어요', '빈자리가 생기면 다시 찍어 주세요.'));
socket.on('replaced', () => message('다른 탭에서 열었어요', '마지막으로 연 화면에서 조작해요.'));
socket.on('room_closed', () => message('방이 닫혔어요', '큰 화면의 새 QR을 찍어 주세요.'));
socket.on('game_state', (s) => {
  const prev = state;
  state = s && typeof s === 'object' ? s : { phase: 'lobby' };
  stateAt = performance.now();
  if (state.phase === 'playing' && prev.phase !== 'playing') {
    lastResult = null;
    readyList = [];
    readyInfo = null;
    if (tut.isRunning()) { tut.cancel(); mode = 'idle'; }
  }
  if (state.phase !== 'playing' && prev.phase === 'playing') showBrace(false);
  if (state.stage !== 'run') showBrace(false);
  if (state.stage === 'end' && prev.stage !== 'end') {
    const mine = myTeam();
    if (mine && state.history !== undefined) { /* 판 결과는 큰 화면이 보여 줘요 */ }
  }
  render();
});
socket.on('result', (r) => {
  lastResult = r || null;
  if (r && r.win) { vignette(); haptics.buzz([80, 60, 80, 60, 240], { noFlash: true }); }
  render();
});

// ================================================================
// 버튼
// ================================================================
$('btnStart').addEventListener('click', async () => {
  if (mode !== 'start') return;
  mode = 'connecting';
  $('btnStart').disabled = true;
  keepAwake();
  haptics.unlock();
  const asks = [];
  if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') {
    asks.push(DeviceMotionEvent.requestPermission().catch(() => 'denied'));
  }
  const res = await Promise.all(asks);
  permDenied = res.some((x) => x !== 'granted');
  window.addEventListener('devicemotion', onMotion);
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
    if (gotMotion) return;
    if (isTouch && !DEBUG && window.isSecureContext) {
      fallback = true;
      sensorHelp();
      return;
    }
    fallback = true;
    debug('동작 센서 값이 들어오지 않아 버튼으로 해요');
    if (me && !calSent) { calSent = true; send('calibrate', {}); }
    sensorsChanged();
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
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (mode !== 'start') keepAwake();
  render();
});
if (!window.isSecureContext) $('httpNote').classList.remove('hidden');

// ---------- 디버그 (&debug) ----------
function debug(t) {
  if (DEBUG) $('debug').textContent = t;
}
let lastM = 0;
setInterval(() => {
  if (!DEBUG) return;
  debug(`motion ${(motionCount - lastM) * 2}Hz mag ${lastMag.toFixed(1)} peak ${lastPeak.toFixed(1)} rtt ${Math.round(rtt())}ms thresh ${PULL_THRESH} mode ${mode}${fallback ? ' fallback' : ''}`);
  lastM = motionCount;
}, 500);
window.__tugPhone = { onMotion, doPull, get state() { return state; }, get mode() { return mode; }, PULL_THRESH, PULL_FULL, STILL_MAX };
