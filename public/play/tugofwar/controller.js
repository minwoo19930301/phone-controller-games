// 줄다리기 컨트롤러. 폰을 두 손으로 쥐고 "영차!" 박에 맞춰 가슴 쪽으로 확 당깁니다.
// 센서(devicemotion)의 선형 가속도 크기가 문턱을 넘는 날카로운 봉우리 = 당김. 봉우리가 지나간 뒤(난이도별 peakWin) 한 번 보냅니다.
// pull { power 0.3~1, ago(봉우리가 난 뒤 지난 ms), rtt } → 큰 화면이 도착 시각에서 ago·왕복 지연을 빼 실제 당긴 때를 맞춰 판정합니다.
// 큰 화면의 beat {kind, in(ms 뒤 박이 옴), ...} 를 받으면 그 시각에 맞춰 번쩍·진동(영차 박). 센서가 없는 PC 는 큰 "당겨!" 버튼(또는 Space).
// 버티기: 구령에서 팀이 버틸 차례면 구령 앞뒤로 당기지 않았는지 보고 msg {type:'brace'} 를 보냅니다.
//   쉬움·보통은 '당기지만 않으면' 성공(가만히 쥐는 것은 재지 않음). 어려움만 예전처럼 폰이 가만히 있었는지도 봅니다.
import { haptics } from '/common/haptics.js';
import { createPhoneSettings } from '/common/phone-settings.js';
import { createTutorial } from '/common/tutorial.js';
import { t as T, mountSwitcher } from '/common/i18n.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ROOM = (params.get('room') || '').toUpperCase();
const DEBUG = params.has('debug');
$('room').textContent = ROOM ? T('방 {code}', { code: ROOM }) : '';
mountSwitcher($('langBox'), { reload: true, compact: true }); // 언어 고르기(시작 화면에서만 보임)

// ---------- 조정 값 (실폰 검증 전이라 바뀔 수 있습니다) ----------
// 난이도별 센서 감도(폰 난이도 알약을 따름). 어려움 값은 예전 그대로입니다.
//  thresh: 선형 가속도(m/s²) 크기가 이걸 넘으면 당김 후보(둔감하면 낮추고, 걷기만 해도 반응하면 올림) / full: 이만큼 세게 당기면 power 1
//  peakWin: 문턱을 넘은 뒤 이 시간(ms) 동안의 최대값을 그 당김의 세기로 / gravBoost: acceleration 이 없는 폰(중력 고역통과)의 크기 보정
//  braceManual: true 면 버티기에서 폰이 가만히 있었는지도 잼(어려움만) / bracePre: 버티기를 보는 구간, 당기는 박 앞(ms)
const SENS = {
  easy: { thresh: 7, full: 18, peakWin: 50, gravBoost: 1.3, braceManual: false, bracePre: 150 },
  normal: { thresh: 9, full: 22, peakWin: 55, gravBoost: 1.3, braceManual: false, bracePre: 150 },
  hard: { thresh: 13, full: 30, peakWin: 70, gravBoost: 1, braceManual: true, bracePre: 380 }
};
const REFRACT_MS = 260; // 한 번 당긴 뒤 이 시간은 새 당김으로 보지 않음(되돌아오는 반동 무시)
const STILL_MAX = 3.4; // 어려움 버티기: 구령 앞뒤에서 가속도가 이 값을 넘지 않아야 '가만히'
const BRACE_POST_MS = 260; // 버티기를 보는 구간: 당기는 박 뒤
const GRAV_ALPHA = 0.92; // acceleration 이 없는 폰: 중력 추정 저역 통과 계수
const SENSOR_WAIT_MS = 2500; // 이 시간 안에 센서 값이 없으면 버튼 모드(조용히 바꾸고, 나중에 값이 들어오면 센서로 돌아옴)
const SOFT_RATIO = 0.55; // 문턱의 이 비율을 넘었는데 문턱은 못 넘은 움직임 = '더 크게!' 안내 대상
const SOFT_HOLD_MS = 160; // 그 움직임이 이만큼 지나도 당김이 안 되면 안내
const HINT_GAP_MS = 1800; // 안내 사이 최소 간격
const BEAT_SHIFT_MS = 12; // 박 알림 보정(폰 화면이 늦게 켜지는 정도)
const COLORS = { 1: '#ff5a5f', 2: '#3ab4ff', 3: '#ffc93c', 4: '#5ee07a', 5: '#c77dff', 6: '#ff8fd1', 7: '#3ee6d6', 8: '#ff9b3d' };
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
let autoFallback = false; // 센서 값이 안 와서 저절로 버튼 모드가 된 경우(나중에 센서가 오면 되돌림)
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
// 잠깐 떴다 사라지는 한 줄(연결 끊김 배너가 이미 있으면 건드리지 않음)
let toastTimer = null;
let toastText = '';
function toast(text, ms = 4000) {
  clearTimeout(toastTimer);
  if (!text) {
    if (toastText && $('banner').textContent === toastText) banner('');
    toastText = '';
    return;
  }
  if (!$('banner').classList.contains('hidden')) return;
  toastText = text;
  banner(text);
  toastTimer = setTimeout(() => toast(''), ms);
}
const sens = () => SENS[ps.difficulty()] || SENS.easy;
// 막힌 입력은 조용히 넘어가지 않게: 폰 화면에 짧은 안내 + 진동 한 번
let hintTimer = null;
let lastHintAt = -1e9;
function hint(text) {
  lastHintAt = performance.now();
  const target = mode === 'play' ? $('judgeS') : $('practiceSub');
  target.textContent = text;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { target.textContent = ''; }, 1400);
  haptics.tick();
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
let soft = null; // 문턱 아래의 약한 움직임 { start, max } ('더 크게!' 안내용)
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
    mag = Math.hypot(g.x - grav.x, g.y - grav.y, g.z - grav.z) * sens().gravBoost;
  }
  if (!Number.isFinite(mag)) return;
  motionCount++;
  lastMag = mag;
  if (!gotMotion && (mag > 0 || motionCount > 3)) {
    gotMotion = true;
    if (autoFallback) { fallback = false; autoFallback = false; toast(''); }
    sensorsChanged();
  }
  const S = sens();
  if (braceWin && t >= braceWin.from && t <= braceWin.to) braceWin.max = Math.max(braceWin.max, mag);
  if (!pk) {
    if (mag > S.thresh && t - lastPullAt > REFRACT_MS) { pk = { start: t, max: mag, tmax: t }; soft = null; }
    else if (mag > S.thresh * SOFT_RATIO && t - lastPullAt > REFRACT_MS + 200) {
      if (!soft) soft = { start: t, max: mag };
      else soft.max = Math.max(soft.max, mag);
    }
    // 움직이긴 했는데 문턱을 못 넘음 → 조용히 무시하지 않고 안내
    if (soft && t - soft.start >= SOFT_HOLD_MS) {
      soft = null;
      const idle = mode === 'play' ? inGame() && !braceShown : mode === 'wait' && state.phase !== 'playing';
      if (idle && t - lastHintAt > HINT_GAP_MS) hint('더 크게!');
    }
  } else {
    if (mag > pk.max) { pk.max = mag; pk.tmax = t; }
    if (t - pk.start >= S.peakWin) {
      const power = clamp(0.3 + (0.7 * (pk.max - S.thresh)) / (S.full - S.thresh), 0.3, 1);
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
  const now = performance.now();
  const inBrace = braceWin && now >= braceWin.from && now <= braceWin.to + 50;
  if (inBrace) braceWin.pulled = true;
  kick();
  if (mode === 'tut') { tutPull(power, ago, how); return; }
  if (state.phase === 'playing') {
    if (!inGame()) { if (mode === 'play') hint('조금만 기다려요'); return; } // 관전·준비 시간에는 보내지 않음(안내만)
    if (inBrace) { braceLabel('당겼어요'); showBrace(true, 'fail'); haptics.tick(); }
  } else {
    // 대기실 연습: 큰 화면 캐릭터가 같이 당김, 폰에도 세기 표시
    $('practiceM').style.width = `${Math.round(power * 100)}%`;
    clearTimeout(practiceTimer);
    practiceTimer = setTimeout(() => { $('practiceM').style.width = '0'; }, 700);
    if (!calSent && how === 'sensor') { calSent = true; send('calibrate', {}); }
  }
  if (!send('pull', { power: Math.round(power * 100) / 100, ago, rtt: Math.round(rtt()) }) && mode === 'play') hint('연결 확인 중');
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
function braceLabel(text) {
  $('braceOv').querySelector('b').textContent = text;
}
function showBrace(on, cls) {
  const o = $('braceOv');
  o.classList.toggle('on', on);
  o.classList.toggle('fail', cls === 'fail');
  braceShown = on;
}
function startBraceWindow(pullAtLocal) {
  const manual = sens().braceManual;
  const w = { from: pullAtLocal - sens().bracePre, to: pullAtLocal + BRACE_POST_MS, max: 0, pulled: false, manual };
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
    // 쉬움·보통: 당기지만 않으면 성공. 어려움: 폰이 가만히 있었는지도 봄
    const ok = !w.pulled && (!w.manual || w.max < STILL_MAX);
    braceWin = null;
    if (ok) {
      send('msg', { type: 'brace', ok: true });
      haptics.buzz([30, 40, 30], { noFlash: true });
    } else haptics.tick(); // 실패해도 조용히 지나가지 않게
    braceLabel(ok ? '버텼다!' : w.pulled ? '당겼어요' : '흔들렸어요');
    showBrace(true, ok ? '' : 'fail');
    setTimeout(() => { showBrace(false); braceLabel('버텨!'); }, 800);
  }, Math.max(0, w.to - performance.now()) + 40);
}
// 큰 화면이 알려 주는 판정
socket.on('cue', (c) => {
  if (!c || mode === 'tut') return;
  if (c.practice) return;
  const b = $('judgeB');
  b.textContent = c.label || c.j || '';
  b.className = c.j || '';
  $('judgeB').dataset.k = '';
  $('judgeS').textContent = c.combo >= 2 ? T('콤보 ×{n}', { n: c.combo }) : '';
  if (typeof c.stamina === 'number') setStamina(c.stamina);
});
function setStamina(v) {
  const i = $('stamI');
  i.style.width = `${Math.round(clamp(v, 0, 1) * 100)}%`;
  i.classList.toggle('low', v < 0.35);
}

// ================================================================
// 튜토리얼(저절로 시작하지 않음, '튜토리얼 다시 하기' 링크로만): 당기기 → 박자 맞추기
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
    wrap.append(btn);
  }
  stage.appendChild(wrap);
  tutPullHandler = null;
}
function stageTiming(stage, api) {
  const IVL = 720;
  const TUT_TOL_MS = 350; // 연습 박자 허용 오차(예전 200)
  const wrap = el('div', 'gt-col');
  const beats = el('div', 'gt-beats', '<div class="bd" data-k="one">하나</div><div class="bd" data-k="two">둘</div><div class="bd big" data-k="pull">영차!</div>');
  wrap.appendChild(beats);
  if (fallback) {
    const btn = el('button', 'gt-btn', '당겨!');
    btn.type = 'button';
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); doPull(0.8, 0, 'button'); });
    wrap.appendChild(btn);
  }
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
    if (Math.abs(off) <= TUT_TOL_MS) tut.signal('timed', { ok: true, off });
    else tut.signal('timed', { ok: false, off });
  };
  return () => { clearInterval(timer); tutPullHandler = null; };
}
const tut = createTutorial({
  key: 'tugofwar',
  socket,
  title: '처음이라 연습해 봐요',
  steps: [
    { id: 'pull', title: '확 당기기', body: '폰을 가슴 쪽으로 당겨요', svg: ART.pull, waitFor: 'pull', count: 1, okText: '좋아요!', render: stagePull },
    { id: 'timing', title: '박자 맞추기', body: '영차! 할 때 당겨요', svg: ART.beat, waitFor: 'timed', count: 1, okText: '좋아요!', render: stageTiming,
      check: (d) => (d && d.ok ? true : { ok: false, msg: d && d.off < 0 ? '조금 일찍!' : '조금 늦었어요' }) }
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
function enterTut() { mode = 'tut'; }
function endTut() {
  if (mode === 'tut') mode = 'idle';
  render();
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
  const head = !waitFor.length ? '모두 준비 완료!' : mine ? T('{names} 기다리는 중', { names: waitFor.map((s) => `${s}P`).join('·') }) : T('준비 {a}/{b}', { a: ready.size, b: st.players.length });
  box.innerHTML = `<span class="rr-h">${head}</span>` + st.players.map((s) =>
    `<span class="rr${ready.has(s) ? ' on' : ''}${away.has(s) ? ' away' : ''}${me && s === me.slot ? ' mine' : ''}" style="--pc:${COLORS[s] || '#fff'}">${s}P${ready.has(s) ? ' ✓' : ''}</span>`).join('');
  box.classList.remove('hidden');
}
function paintPicker() {
  const players = state.players ? Object.values(state.players) : [];
  const counts = { blue: 0, white: 0 };
  for (const p of players) if (p.team) counts[p.team]++;
  $('pkBlue').textContent = T('{n}명', { n: counts.blue });
  $('pkWhite').textContent = T('{n}명', { n: counts.white });
  const p = myInfo();
  const cur = pendingPref || (p ? p.pref : 'auto') || 'auto';
  for (const b of document.querySelectorAll('.pk')) b.classList.toggle('on', b.dataset.t === cur);
  $('pickNote').textContent = p && p.team ? T('내 팀 {team}', { team: TEAM[p.team] }) : '';
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
      $('waitB').textContent = `${lastResult.winner ? T('{team} 우승', { team: TEAM[lastResult.winner] }) : ''}${lastResult.mvp ? `\n${T('내가 MVP!')}` : ''}`;
    } else {
      $('waitT').textContent = '경기 끝';
      $('waitB').textContent = '';
    }
    go.innerHTML = '다시 하기';
  } else if (inMatch) {
    $('waitT').textContent = '관전 중';
    $('waitB').textContent = '';
    go.style.display = 'none';
  } else {
    $('waitT').textContent = '대기실';
    $('waitB').textContent = '팀을 고르고 준비!';
    go.innerHTML = '준비';
  }
  if (mineReady && !inMatch) {
    go.innerHTML = '준비 완료 ✓<small>다른 사람을 기다려요</small>';
    go.disabled = true;
    go.classList.add('waiting', 'ready');
  }
  const chips = [];
  if (roster.length) chips.push(['참가자', T('{n}명', { n: roster.length })]);
  chips.push(['조작', fallback ? '버튼' : gotMotion ? '센서' : '확인 중', !fallback && gotMotion ? 'ok' : '']);
  setChips(chips, 'waitChips');
  $('picker').style.display = inMatch ? 'none' : '';
  $('pickNote').style.display = inMatch ? 'none' : '';
  $('btnPractice').style.display = inMatch ? 'none' : '';
  paintPicker();
  paintReadyRow();
  paintTeam();
  tut.setLinkVisible(!inMatch);
  show('vWait');
}
function showPlay() {
  mode = 'play';
  paintTeam();
  $('winB').textContent = state.wins ? state.wins.blue : 0;
  $('winW').textContent = state.wins ? state.wins.white : 0;
  const p = myInfo();
  if (p) setStamina(p.stamina ?? 1);
  const jb = $('judgeB');
  if (state.stage === 'run' && jb.dataset.k === 'intro') { jb.textContent = '영차!'; jb.className = ''; jb.dataset.k = ''; $('judgeS').textContent = ''; }
  if (state.stage === 'intro') { jb.textContent = T('{n}판 시작!', { n: state.round }); jb.className = ''; jb.dataset.k = 'intro'; $('judgeS').textContent = ''; }
  show('vPlay');
}
function render() {
  if (!me) return;
  if (mode === 'start' || mode === 'connecting' || mode === 'msg') return;
  if (mode === 'tut') return;
  const info = myInfo();
  if (state.phase === 'playing' && info && info.inRound) { showPlay(); return; }
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
  render();
}
// 센서를 못 쓰면 막다른 화면 없이 바로 큰 당겨! 버튼 모드로(센서 값이 나중에 오면 자동으로 센서로 돌아옴)
function useButtons() {
  if (fallback) return;
  fallback = true;
  autoFallback = true;
  toast('센서가 없어 버튼으로 해요');
  debug('동작 센서 값이 들어오지 않아 버튼으로 해요');
  sensorsChanged();
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
  if (mode === 'connecting' || mode === 'msg') mode = 'idle';
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
  if (permDenied && isTouch && !DEBUG) useButtons();
  join();
  setTimeout(() => {
    if (gotMotion) return;
    useButtons();
    if (me && !calSent) { calSent = true; send('calibrate', {}); }
  }, SENSOR_WAIT_MS);
});
$('btnGo').addEventListener('click', () => {
  keepAwake();
  if (me && readyList.includes(me.slot) && state.phase !== 'playing') return;
  if (!calSent) { calSent = true; send('calibrate', {}); } // 중립 자세는 준비를 누를 때 자동으로 잡힘
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

// ---------- 디버그 (&debug) ----------
function debug(t) {
  if (DEBUG) $('debug').textContent = t;
}
let lastM = 0;
setInterval(() => {
  if (!DEBUG) return;
  debug(`motion ${(motionCount - lastM) * 2}Hz mag ${lastMag.toFixed(1)} peak ${lastPeak.toFixed(1)} rtt ${Math.round(rtt())}ms thresh ${sens().thresh} mode ${mode}${fallback ? ' fallback' : ''}`);
  lastM = motionCount;
}, 500);
window.__tugPhone = { onMotion, doPull, get state() { return state; }, get mode() { return mode; }, sens, SENS, STILL_MAX };
