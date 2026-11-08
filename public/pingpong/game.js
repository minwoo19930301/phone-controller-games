// 탁구 큰 화면: 경기 진행(테이블 A·B), 슬로우 모션, 타이밍 판정, 위치 보정, CPU, 화면 분할 HUD, 소켓, 시험용 봇.
// 서버는 방과 이벤트만 중계하고 판정은 모두 여기서 합니다.
// 난이도(쉬움·보통·어려움)와 슬로우 모드(처음엔 물어봄)는 공통 settings 모듈이 들고, 경기 시작 때 TUNE 으로 바꿔 씁니다.
import * as THREE from 'three';
import { createScene, TABLE_X, ARENA_CX } from './scene.js';
import { TABLE, BALL_R, clamp, fwdOf, rightOf, simulate, sampleFlight, flightEnd, aimShot, planContact, lateContactTime } from './physics.js';
import { createHud } from './hud.js';
import { sfx, audio } from './sfx.js';
import { createSettings, fields, DIFF_LABEL } from '/common/settings.js';
import { createTutorialBoard } from '/common/tutorial-board.js';
import { sendHaptic } from '/common/haptics.js';

const WIN_POINTS = 7;
const SLOW = 0.22; // 슬로우 배율
const GRACE_MS = 230; // 판정 창이 닫힌 뒤, 늦게 도착하는 스윙을 기다리는 실제 시간
// 난이도별 보정. 어려움 = 예전 그대로(판정 창 ±0.12초, 조준이 좌우를 정함, 실수 확률 그대로, CPU 그대로).
// 쉬움·보통은 '휘둘렀나, 포핸드/백핸드가 맞나' 같은 큰 동작 위주로 보고, 정확한 방향은 떨어지는 곳을 살짝만 옮깁니다.
//   window: 판정 창(경기 초, ±), perfect/good: 판정 글자 기준, lead: 타점 몇 초 전부터 슬로우·링·'지금!'
//   assist: physics.aimShot 보정(nudge = 조준이 옮기는 비율, risk/pressure = 네트·아웃 확률 배율, powerK = 세기 모으기)
//   earlyFree: 창보다 이른 스윙은 헛스윙 대신 연습 스윙, replace: 공에 닿기 전 더 잘 맞춘 스윙으로 바꿈,
//   rescue: 늦게 휘둘러 공이 지나갔어도 칠 수 있던 마지막 순간에 맞힘,
//   hand: 반대 손(포핸드 공을 백핸드로)일 때 — auto 자동으로 맞춤, soft 조금 약해짐, strict 많이 약해짐
//   cpu: CPU 실수 확률·세기·회전
//   rally: 긴 랠리(쉬움·보통) — 한 점 안에서 from 번째 타구부터 한 번 칠 때마다 실수 확률이 per 씩 붙습니다(CPU 포함).
//     보정 덕에 둘 다 거의 다 넣으면 한 점이 끝나지 않아(봇끼리 90초에 158타·1점) 경기가 늘어지기 때문입니다. 어려움은 예전 그대로.
const TUNE = {
  easy: {
    window: 0.3, perfect: 0.07, good: 0.16, lead: 0.44,
    assist: { nudge: 0.1, risk: 0.12, pressure: 0.15, powerK: 0.35 },
    earlyFree: true, replace: true, rescue: true, hand: 'auto', handQ: 1, rally: { from: 8, per: 0.025 },
    cpu: { miss: 0.2, smashMiss: 0.4, heavyMiss: 0.16, smash: 0.2, q: [0.35, 0.8], power: [0.25, 0.65], spinAmt: [0.15, 0.5] }
  },
  normal: {
    window: 0.2, perfect: 0.045, good: 0.11, lead: 0.38,
    assist: { nudge: 0.25, risk: 0.4, pressure: 0.45, powerK: 0.65 },
    earlyFree: true, replace: true, rescue: true, hand: 'soft', handQ: 0.85, rally: { from: 6, per: 0.03 },
    cpu: { miss: 0.12, smashMiss: 0.33, heavyMiss: 0.13, smash: 0.35, q: [0.45, 0.9], power: [0.3, 0.75], spinAmt: [0.25, 0.75] }
  },
  hard: {
    window: 0.12, perfect: 0.03, good: 0.07, lead: 0.32,
    assist: null,
    earlyFree: false, replace: false, rescue: false, hand: 'strict', handQ: 0.55, rally: null,
    cpu: { miss: 0.08, smashMiss: 0.3, heavyMiss: 0.12, smash: 0.5, q: [0.5, 0.95], power: [0.3, 0.8], spinAmt: [0.3, 0.9] }
  }
};
const HAND_KO = { fore: '포핸드', back: '백핸드' };
// 사람끼리 붙은 테이블에서 아무도 휘두르지 않은 점수가 이만큼 이어지면(둘 다 자리를 떴거나 연결이 끊김) 경기를 끝냅니다.
// 둘 다 서브를 못 치면 받는 쪽이 계속 점수를 얻어 듀스가 끝나지 않기 때문입니다.
const DEAD_POINTS = 4;
const TOSS_VY = 2.75;
const SERVE_H = 0.3; // 서브 타점 높이(테이블 위)
// 늦게 친 공의 타점이 이보다 낮아지지 않게 당깁니다(공 중심, 테이블 위 m).
// 서브는 이보다 낮으면 자기 코트에 먼저 튀게 칠 수 없고, 랠리는 테이블 판 높이 아래에서 치면 리턴이 판을 뚫습니다.
const LATE_MIN_H = { serve: 0.12, rally: BALL_R + 0.03 };
const SLOT_INFO = {
  1: { name: '1P', color: '#ff5a5f' },
  2: { name: '2P', color: '#3ab4ff' },
  3: { name: '3P', color: '#ffc93c' },
  4: { name: '4P', color: '#5ee07a' }
};
const CPU_COLOR = '#d7dde6';
const SPIN_LABEL = { top: '드라이브!', back: '커트', side: '사이드 스핀', smash: '스매시!', none: '' };
const REASON = {
  net: ['네트에 걸렸어요', '상대 공이 네트에 걸렸어요'],
  out: ['아웃', '상대 공이 아웃'],
  own: ['내 코트에 떨어졌어요', '상대 실수'],
  fault: ['서브 실수', '상대 서브 실수'],
  serveMiss: ['서브 실패', '상대 서브 실패'],
  missed: ['못 받았어요', '상대가 못 받았어요']
};

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOTS = clamp(parseInt(params.get('bots'), 10) || 0, 0, 4);
const AUTOSTART = params.has('autostart');
const BOT_WRONG = clamp(Number(params.get('botwrong')) || 0, 0, 1); // 시험: 봇이 반대 손으로 치는 비율
const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);

// 캔버스에 글자를 그리기 전에 글꼴을 기다립니다(최대 2초).
await Promise.race([
  Promise.all([document.fonts.load('400 64px Anton'), document.fonts.load('800 64px "Pretendard Variable"')]),
  new Promise((r) => setTimeout(r, 2000))
]).catch(() => {});
const view = createScene($('cv'));
const hud = createHud($('views'));

// ---------- 난이도·슬로우(대기실에서 고르고, 이 화면 브라우저에 기억) ----------
const settings = createSettings({
  game: 'pingpong',
  fields: [
    fields.difficulty({ hints: { easy: '타이밍 ±0.3초 · 공은 거의 다 들어가요', normal: '타이밍 ±0.2초 · 방향은 살짝만', hard: '타이밍 ±0.12초 · 조준 그대로' } }),
    fields.slow()
  ],
  onChange: () => {
    renderLobby();
    pushState();
  }
});
settings.mount($('setBox'));
settings.mount($('setBoxOver'), { compact: true });
const board = createTutorialBoard({ mount: $('tutDock') });
// 연습 칸이 떠 있는 동안 대기실·결과 화면 아래를 그 높이만큼 비웁니다(칸이 글자를 가리지 않게).
function syncDock() {
  const h = board.el.hidden ? 0 : Math.ceil(board.el.getBoundingClientRect().height);
  document.body.classList.toggle('dock-on', h > 0);
  document.body.style.setProperty('--dock-h', `${h}px`);
}
new MutationObserver(syncDock).observe(board.el, { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true });
if (window.ResizeObserver) new ResizeObserver(syncDock).observe(board.el);
// 경기에 쓰는 값(시작할 때 정해서 경기 중에는 바뀌지 않음)
function applySettings() {
  game.diff = settings.difficulty();
  game.tune = TUNE[game.diff] || TUNE.normal;
  game.slow = settings.get('slow') === true;
}
// 슬로우가 꺼져 있으면 공이 빨리 오므로 링·'지금!'을 조금 더 일찍 띄웁니다.
const cueLead = () => game.tune.lead + (game.slow ? 0 : 0.16);

// ================================================================
// 연결
// ================================================================
const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true });
let serverPlayers = [];
const rtts = [];
function displayRtt() {
  if (!rtts.length) return 40;
  const s = [...rtts].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
setInterval(() => {
  if (!socket.connected) return;
  const t0 = performance.now();
  socket.timeout(2000).emit('ping_rtt', t0, (err) => {
    if (err) return;
    rtts.push(performance.now() - t0);
    if (rtts.length > 7) rtts.shift();
  });
}, 1500);
function send(event, data, slot) {
  if (!socket.connected) return;
  socket.emit('d2c', slot != null ? { event, slot, data } : { event, data });
}

socket.on('connect', () => {
  let saved = null;
  try { saved = sessionStorage.getItem('pcg-pingpong-room'); } catch (e) {}
  socket.emit('join', { role: 'display', game: 'pingpong', room: saved });
});
let hadRoom = false; // 이 페이지가 이미 방을 받은 적이 있는지(처음 받는 방은 언제나 새 방이라 fresh 입니다)
socket.on('room', async (r) => {
  try { sessionStorage.setItem('pcg-pingpong-room', r.code); } catch (e) {}
  serverPlayers = r.players || [];
  // 서버가 다시 떠서 방이 새로 만들어졌으면 폰들이 예전 자리 번호를 못 돌려받을 수 있어(들어온 순서대로 다시 배정)
  // 진행 중이던 경기는 이어 갈 수 없습니다. 대기실로 돌아갑니다(골프와 같음).
  // 처음 받는 방은 빼고 봅니다(?bots=N&autostart 는 방을 받기 전에 경기를 시작할 수 있습니다).
  if (r.fresh && hadRoom && game.phase !== 'lobby') backToLobby('서버가 다시 시작돼서 대기실로 돌아왔어요');
  hadRoom = true;
  $('code').textContent = r.code;
  try {
    const res = await fetch(`/api/qr?room=${r.code}`).then((x) => x.json());
    $('qr').src = res.qr;
    $('url').textContent = res.url.replace(/^https?:\/\//, '');
    $('warn').classList.toggle('hidden', Boolean(res.secure));
  } catch (e) {}
  renderLobby();
  pushState();
});
socket.on('players', (p) => {
  const before = new Set(serverPlayers.map((x) => x.slot));
  serverPlayers = p.players || [];
  for (const pl of serverPlayers) if (!before.has(pl.slot)) sfx.join();
  for (const s of [...game.ready]) if (!serverPlayers.some((x) => x.slot === s)) game.ready.delete(s);
  renderLobby();
  pushState();
});
socket.on('display_replaced', () => $('replaced').classList.remove('hidden'));
settings.attach(socket);
board.attach(socket);
// 서버가 세는 준비 현황(누가 아직 준비 전인지 대기실 칸에 보여 줍니다)
let readyState = null;
socket.on('ready_state', (st) => {
  readyState = st && Array.isArray(st.ready) ? st : null;
  renderLobby();
});
// 연습(튜토리얼) 소식이 오면 칸의 '연습 중' 표시를 바꿉니다(판이 먼저 그려지도록 한 박자 뒤).
socket.on('tutorial', () => setTimeout(renderLobby, 30));
socket.on('start_game', () => startGame());
socket.on('swing', (d) => onSwing(d, false));
socket.on('pose', (d) => onPose(d));
socket.on('calibrate', (d) => onCalibrate(d));

// 대기실 참가자: 폰(서버 자리) + ?bots=N 시험용 봇(빈 자리부터 채움)
function lobbyPlayers() {
  const list = serverPlayers.map((p) => ({ ...p, bot: false }));
  let need = BOTS;
  for (let s = 1; s <= 4 && need > 0; s++) {
    if (list.some((p) => p.slot === s)) continue;
    list.push({ slot: s, name: SLOT_INFO[s].name, color: SLOT_INFO[s].color, connected: true, bot: true });
    need -= 1;
  }
  return list.sort((a, b) => a.slot - b.slot);
}
function playerInfo(slot) {
  return serverPlayers.find((p) => p.slot === slot) || { slot, ...SLOT_INFO[slot], connected: false };
}

// ================================================================
// 경기 상태
// ================================================================
const game = {
  phase: 'lobby', // lobby | playing | over
  matches: [],
  humans: [], // 화면 순서(자리 번호 순)
  poses: {}, // slot -> { s, fc, at }
  ready: new Set(), // 준비(기준 맞춤)를 누른 자리
  overAt: 0,
  log: [], // 최근 득점 기록(디버그)
  diff: 'normal', // 이번 경기 난이도(시작할 때 settings 에서 가져옴)
  tune: TUNE.normal,
  slow: false,
  stats: {} // slot -> { hits, perfect, miss, wrongHand, assisted } 결과 화면·시험용
};
applySettings();

const human = (p) => ({ kind: 'human', slot: p.slot, name: p.name, color: p.color, bot: Boolean(p.bot), key: `p${p.slot}`, camX: 0, shake: 0 });
const cpu = (key, color = CPU_COLOR) => ({ kind: 'cpu', slot: null, name: 'CPU', color, bot: false, key, camX: 0, shake: 0 });

function newMatch(id, p0, p1, demo) {
  const m = {
    id, tx: TABLE_X[id], sides: [p0, p1], demo,
    score: [0, 0], first: demo ? Math.round(Math.random()) : 0,
    state: 'intro', waitReal: performance.now() + (demo ? 900 : 2400),
    clock: { gt: 0, scale: 1, hist: [] },
    flight: null, evIdx: 0, rally: null, plan: null, retoss: 0, toss0: null, server: 0,
    pad: [newPad(0), newPad(1)], winner: null, lastShot: null, announced: false,
    swung: false, deadRun: 0, abandoned: false
  };
  prepareServe(m);
  return m;
}

function serverOf(m) {
  const [a, b] = m.score;
  const p = a + b;
  // 2점마다 서브를 바꾸고, 6:6 부터는 1점마다 바꿉니다.
  if (a >= WIN_POINTS - 1 && b >= WIN_POINTS - 1) return (m.first + (WIN_POINTS - 1) + (p - 2 * (WIN_POINTS - 1))) % 2;
  return (m.first + Math.floor(p / 2)) % 2;
}
const won = (m) => (m.score[0] >= WIN_POINTS || m.score[1] >= WIN_POINTS) && Math.abs(m.score[0] - m.score[1]) >= 2;

function humanBySlot(slot) {
  for (const m of game.matches) {
    if (m.demo) continue;
    for (const side of [0, 1]) {
      const pl = m.sides[side];
      if (pl.kind === 'human' && pl.slot === slot) return { m, side, pl };
    }
  }
  return null;
}
const viewIndex = (slot) => game.humans.findIndex((h) => h.slot === slot);

// ---------- 시간: 테이블마다 경기 시간과 배율, 실제 시각 ↔ 경기 시각 기록 ----------
function slowTarget(m) {
  const p = m.plan;
  if (!game.slow || m.demo || !p || p.decided || !p.human) return 1;
  return p.t - m.clock.gt < game.tune.lead ? SLOW : 1;
}
// 실제 시각(ms) → 그 테이블의 경기 시각. 배율이 바뀌므로 기록을 따라 적분된 값을 보간합니다.
function toGame(m, realMs) {
  const h = m.clock.hist;
  if (!h.length) return m.clock.gt;
  const last = h[h.length - 1];
  if (realMs >= last[0]) return last[1] + ((realMs - last[0]) / 1000) * m.clock.scale;
  if (realMs <= h[0][0]) return h[0][1] - (h[0][0] - realMs) / 1000;
  let lo = 0;
  let hi = h.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (h[mid][0] <= realMs) lo = mid;
    else hi = mid;
  }
  const a = h[lo];
  const b = h[hi];
  const f = (realMs - a[0]) / Math.max(1e-6, b[0] - a[0]);
  return a[1] + (b[1] - a[1]) * f;
}

// ---------- 서브 ----------
function prepareServe(m) {
  m.server = serverOf(m);
  const s = m.server;
  const lat = 0.1 + Math.random() * 0.22; // 서버 오른쪽(포핸드 쪽)
  m.toss0 = [rightOf(s) * lat, TABLE.y + 0.1, -fwdOf(s) * (TABLE.halfL + 0.08)];
  m.flight = m.flight && m.clock.gt < flightEnd(m.flight) ? m.flight : null;
  m.rally = null;
  m.plan = null;
  m.swung = false; // 이번 점수 동안 사람이 한 번이라도 휘둘렀는지
  m.rallyHits = 0; // 이번 점수의 타구 수(서브 포함)
}
function startToss(m) {
  const s = m.server;
  m.flight = simulate(m.toss0, [0, TOSS_VY, 0], [0, 0, 0], { t0: m.clock.gt, maxT: 2.4 });
  m.evIdx = m.flight.events.length; // 토스는 규칙 판정 대상이 아님
  m.state = 'toss';
  m.rally = null;
  // 정점을 지나 서브 높이로 내려오는 순간이 타점
  const B = m.flight.buf;
  let tc = m.clock.gt + (2 * TOSS_VY) / 9.81;
  for (let i = 2; i < m.flight.n; i++) {
    if (B[i * 9 + 4] < 0 && B[i * 9 + 1] <= TABLE.y + SERVE_H) {
      tc = m.flight.t0 + i / 240;
      break;
    }
  }
  const st = sampleFlight(m.flight, tc);
  setPlan(m, s, { t: tc, p: st.p, apexH: 0 }, 'serve', {});
  if (!m.demo) {
    const pl = m.sides[s];
    if (pl.kind === 'human') hudNote(pl.slot, m.retoss ? '다시 토스해요' : '내 서브');
  }
}

// ---------- 타점 계획 ----------
function setPlan(m, side, plan, kind, info) {
  const pl = m.sides[side];
  const p = {
    side, t: plan.t, p: plan.p, apexH: plan.apexH || 0, kind, decided: false, swing: null, cued: false, closeReal: null,
    human: pl.kind === 'human', bot: pl.bot, cpu: pl.kind === 'cpu', slot: pl.slot, botAt: null, botSwing: null, cpuSwing: null, cpuMiss: false
  };
  // 칠 손: 탁구채가 기다리는 쪽(공이 몸 왼쪽이면 백핸드). 가운데 근처 공은 어느 손이든 됩니다.
  p.hand = handFor(side, p.p);
  p.zone = handZone(side, p.p);
  if (p.bot) {
    // 봇: 좋은 타이밍(가끔 실수)과 무작위 스핀으로 폰과 같은 길(onSwing)을 탑니다.
    // ?botwrong=0.3 이면 그 비율만큼 반대 손으로 칩니다(손 판정 시험용).
    const r = Math.random();
    const err = r < 0.07 ? (Math.random() < 0.5 ? -1 : 1) * (0.13 + Math.random() * 0.08) : clamp(gauss() * 0.055, -0.115, 0.115);
    p.botAt = plan.t + err;
    p.botSwing = randomSwing(kind === 'serve', p);
    p.botSwing.hand = Math.random() < BOT_WRONG ? (p.hand === 'fore' ? 'back' : 'fore') : p.hand;
  }
  // 받기 어려운 공(스매시·강한 회전)은 사람도 실수 위험이 조금 늘어납니다(쉬움·보통은 aimShot 이 줄여 줌).
  const heavyIn = info.w ? Math.hypot(info.w[0], info.w[1], info.w[2]) > 430 : false;
  p.pressure = (info.smash ? 0.08 : 0) + (heavyIn ? 0.03 : 0);
  if (p.cpu) {
    // CPU 세기는 난이도를 따릅니다(어려움 = 예전 CPU). 대기실 시연 경기는 예전 그대로.
    const C = (m.demo ? TUNE.hard : game.tune).cpu;
    p.cpuMiss = kind !== 'serve' && Math.random() < C.miss + (info.smash ? C.smashMiss : 0) + (heavyIn ? C.heavyMiss : 0);
    p.cpuSwing = cpuSwing(m, p, C);
  }
  m.plan = p;
}
function gauss() {
  return (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 0.577;
}
function randomSwing(serve, p) {
  const r = Math.random();
  const spin = r < 0.32 ? 'top' : r < 0.52 ? 'back' : r < 0.68 ? 'side' : 'none';
  const high = (p.apexH || 0) >= 0.24;
  return {
    power: high && Math.random() < 0.6 ? 0.9 + Math.random() * 0.1 : serve ? 0.25 + Math.random() * 0.55 : 0.4 + Math.random() * 0.5,
    spin, spinAmt: 0.35 + Math.random() * 0.6, side: Math.random() < 0.5 ? -1 : 1, aim: (Math.random() - 0.5) * 36
  };
}
function cpuSwing(m, p, C) {
  const rnd = (a) => a[0] + Math.random() * (a[1] - a[0]);
  let q = rnd(C.q);
  const r = Math.random();
  const spin = r < 0.3 ? 'top' : r < 0.45 ? 'back' : r < 0.55 ? 'side' : 'none';
  let power = p.kind === 'serve' ? 0.2 + Math.random() * 0.6 : rnd(C.power);
  if (p.kind !== 'serve' && p.apexH >= 0.24 && Math.random() < C.smash) {
    power = 0.9 + Math.random() * 0.1;
    q = Math.max(q, 0.8);
  }
  return {
    power, spin, spinAmt: rnd(C.spinAmt), spinSide: Math.random() < 0.5 ? -1 : 1, aim: (Math.random() - 0.5) * 36,
    hand: handFor(p.side, p.p), q, err: (Math.random() < 0.5 ? -1 : 1) * (1 - q) * TUNE.hard.window
  };
}
// 타점이 몸 왼쪽이면 백핸드
function handFor(side, pos) {
  return pos[0] * rightOf(side) < -0.1 ? 'back' : 'fore';
}
// 포핸드·백핸드를 따질 공인지: 몸 가운데(경계 −0.1m 둘레 ±0.14m)로 오는 공은 어느 손으로 쳐도 됩니다.
function handZone(side, pos) {
  const xr = pos[0] * rightOf(side);
  return xr < -0.24 ? 'back' : xr > 0.04 ? 'fore' : 'any';
}

function updatePlan(m, p, now) {
  const gt = m.clock.gt;
  const T = game.tune;
  if (p.human && !p.cued && p.t - gt < cueLead()) {
    p.cued = true;
    // 폰에 '지금!'과 칠 손(포핸드/백핸드)을 알려 줍니다. 가운데 공은 아무 손이나(any).
    if (!p.bot) send('cue', { kind: p.kind === 'serve' ? 'serve' : 'incoming', hand: p.hand, zone: p.zone }, p.slot);
    sfx.slow();
  }
  if (p.botAt != null && gt >= p.botAt) {
    p.botAt = null;
    const b = p.botSwing;
    onSwing({ slot: p.slot, power: b.power, ago: 0, rtt: 0, spin: b.spin, spinAmt: b.spinAmt, side: b.side, aim: b.aim, hand: b.hand || handFor(p.side, p.p) }, true);
    if (p.decided || m.plan !== p) return;
  }
  if (p.cpu && gt >= p.t) {
    p.decided = true;
    if (p.cpuMiss) startStroke(m, p.side, p.t, 'none', handFor(p.side, p.p), p.p);
    else doHit(m, p.side, p.cpuSwing, p.t, p);
    return;
  }
  if (p.swing && gt >= p.t) {
    p.decided = true;
    doHit(m, p.side, p.swing, p.t, p);
    return;
  }
  if (p.human && gt >= p.t + T.window) {
    if (p.closeReal == null) p.closeReal = now + GRACE_MS;
    else if (now >= p.closeReal) {
      p.decided = true;
      onMiss(m, p, 'none');
    }
  }
}

// ---------- 스윙(폰·봇·키보드 모두 이 길) ----------
function readSwing(d) {
  return {
    power: clamp(num(d.power, 0.6), 0, 1),
    spin: ['top', 'back', 'side'].includes(d.spin) ? d.spin : 'none',
    spinAmt: clamp(num(d.spinAmt, 0.6), 0, 1),
    spinSide: num(d.side, 1) < 0 ? -1 : 1,
    aim: clamp(num(d.aim, 0), -45, 45),
    // auto = 손을 가릴 수 없는 스윙(폰 버튼 모드·키보드). 공 쪽 손으로 칩니다.
    hand: d.hand === 'back' ? 'back' : d.hand === 'auto' ? 'auto' : 'fore'
  };
}
const statOf = (slot) => (game.stats[slot] = game.stats[slot] || { hits: 0, perfect: 0, miss: 0, wrong: 0, assisted: 0 });

function onSwing(d, local, atGame) {
  if (game.phase !== 'playing' || !d) return;
  const ent = humanBySlot(Number(d.slot));
  if (!ent) return;
  const { m, side, pl } = ent;
  // 봇 자리에 나중에 들어온 폰의 스윙은 무시합니다.
  if (pl.bot && !local) return;
  m.swung = true; // 누군가 테이블에 있다는 표시(아무도 안 치는 경기 끝내기에 씀)
  const now = performance.now();
  // 폰에서 휘두른 순간 = 도착 시각 − 센서 측정 시간 − 폰 왕복/2 − 화면 왕복/2
  const lag = local ? 0 : num(d.ago, 0) + num(d.rtt, 80) / 2 + displayRtt() / 2;
  const G = atGame != null ? atGame : toGame(m, now - lag);
  const sw = readSwing(d);
  const p = m.plan;
  if (!p || p.side !== side || p.decided || (m.state !== 'toss' && m.state !== 'rally')) {
    idleSwing(m, side, sw);
    return;
  }
  const T = game.tune;
  const W = T.window;
  const err = G - p.t;
  // 슬로우·링이 뜨기 훨씬 전의 스윙은 연습 스윙으로 봅니다.
  if (err < -(cueLead() + 0.08)) {
    if (!p.swing) idleSwing(m, side, sw);
    return;
  }
  if (p.swing) {
    // 보정(쉬움·보통): 공에 닿기 전이면 더 잘 맞춘 스윙으로 바꿉니다. 백스윙이 먼저 잡혀도 이어진 앞스윙이 칩니다.
    if (T.replace && m.clock.gt < p.t && Math.abs(err) <= W && Math.abs(err) < Math.abs(p.swing.err)) {
      p.swing = { ...sw, err, q: 1 - Math.abs(err) / W, replaced: true };
    }
    return;
  }
  if (Math.abs(err) <= W) {
    p.swing = { ...sw, err, q: 1 - Math.abs(err) / W };
    // 지연 때문에 이미 타점을 지났으면 휘두른 순간으로 맞춰 바로 칩니다.
    if (m.clock.gt >= p.t) {
      p.decided = true;
      const serve = m.state === 'toss';
      const minY = TABLE.y + (serve ? LATE_MIN_H.serve : LATE_MIN_H.rally);
      let th = lateContactTime(m.flight, m.evIdx, p.t, clamp(G, p.t, m.clock.gt), minY);
      // 보정(쉬움·보통): 휘두르기 전에 공이 이미 두 번째로 튀었어도, 칠 수 있던 마지막 순간에 맞힙니다.
      if (th == null && T.rescue) {
        th = lastHittable(m, p, G, minY);
        if (th != null) p.swing.rescued = true;
      }
      // 그래도 못 치면 늦은 헛스윙입니다. 미뤄 둔 그 사건은 다음 프레임에 규칙대로 처리됩니다(친 사람 득점).
      if (th == null) onMiss(m, p, 'late', sw);
      else doHit(m, side, p.swing, th, p);
    }
  } else if (err < 0 && T.earlyFree) {
    // 보정(쉬움·보통): 창이 열리기 전의 이른 스윙은 헛스윙으로 치지 않고, 다시 휘두를 수 있게 둡니다.
    idleSwing(m, side, sw);
    if (!pl.bot && now - (p.earlyNoteAt || 0) > 700) {
      p.earlyNoteAt = now;
      hudNote(pl.slot, '조금 빨라요 · 다시 휘둘러요', 900);
      send('result', { text: '조금 빨라요 · 다시', good: false, kind: 'early' }, pl.slot);
    }
  } else {
    p.decided = true;
    onMiss(m, p, err < 0 ? 'early' : 'late', sw);
  }
}
// 타점(p.t) 뒤, 다음 사건(두 번째 바운드·바닥·네트) 바로 앞까지 중 공이 minY 위에 있던 가장 늦은 순간(휘두른 순간 G 를 넘지 않게)
function lastHittable(m, p, G, minY) {
  const evs = m.flight.events;
  let tEnd = flightEnd(m.flight);
  for (let k = m.evIdx; k < evs.length; k++) {
    if (evs[k].t > p.t && evs[k].type !== 'netcord') {
      tEnd = evs[k].t - 0.012;
      break;
    }
  }
  if (tEnd <= p.t) return p.t;
  return lateContactTime(m.flight, m.evIdx, p.t, Math.min(G, tEnd), minY);
}
function idleSwing(m, side, sw) {
  const pad = m.pad[side];
  if (pad.stroke) return;
  const hand = sw.hand === 'auto' ? pad.hand : sw.hand;
  startStroke(m, side, m.clock.gt, sw.spin, hand, null);
}

function onMiss(m, p, why, sw) {
  const pl = m.sides[p.side];
  const now = performance.now();
  if (why !== 'none') startStroke(m, p.side, m.clock.gt, sw ? sw.spin : 'none', sw && sw.hand !== 'auto' ? sw.hand : handFor(p.side, p.p), null);
  if (pl.kind === 'human' && !m.demo) {
    const t = why === 'early' ? '빨라요' : why === 'late' ? '늦어요' : '';
    hudCall(pl.slot, why === 'none' ? '놓쳤어요' : '헛스윙', t, 'miss', 1300);
    statOf(pl.slot).miss += 1;
    if (!pl.bot) send('result', { text: why === 'none' ? '놓쳤어요' : `헛스윙 · ${t}`, good: false, kind: 'miss' }, pl.slot);
    sfx.whiff();
  }
  if (m.state === 'toss') {
    // 서브 토스를 놓치면 한 번은 다시 토스하고, 두 번째는 실점입니다.
    if (m.retoss < 1) {
      m.retoss += 1;
      m.state = 'intro';
      m.plan = null;
      m.waitReal = now + 1400;
    } else {
      m.retoss = 0;
      point(m, 1 - p.side, 'serveMiss');
    }
  }
}

// ---------- 타구 ----------
function doHit(m, side, sw, th, p) {
  const T = game.tune;
  const serve = m.state === 'toss';
  const st = sampleFlight(m.flight, th);
  const pl = m.sides[side];
  const human = pl.kind === 'human' && !m.demo;
  // 큰 동작 판정: 포핸드 공을 백핸드로(또는 반대로) 쳤는지. 가운데 공(any)과 손을 가릴 수 없는 스윙(auto)은 따지지 않습니다.
  // 탁구채는 언제나 공 쪽 손으로 그려지고, 반대 손이면 난이도만큼 타구가 약해집니다(쉬움은 자동으로 맞춤).
  const zone = handZone(side, st.p);
  const want = handFor(side, st.p);
  let q = sw.q;
  let wrong = null;
  if (human && zone !== 'any' && sw.hand !== 'auto' && sw.hand !== zone) {
    wrong = zone;
    q *= T.handQ;
  }
  const hand = sw.hand === 'auto' || wrong || !human ? want : sw.hand;
  const smash = !serve && sw.power > 0.85 && q > 0.7 && (p.apexH || 0) >= 0.24;
  // 긴 랠리(쉬움·보통): 타구가 쌓일수록 실수 확률이 조금씩 붙습니다. 시연 경기는 빼고 봅니다.
  m.rallyHits = (m.rallyHits || 0) + 1;
  const R = !m.demo && T.rally ? T.rally : null;
  const fatigue = R ? clamp((m.rallyHits - R.from) * R.per, 0, 0.45) : 0;
  const shot = aimShot({
    side, p: st.p, q, err: sw.err, power: sw.power, aim: sw.aim, spin: sw.spin, spinAmt: sw.spinAmt,
    spinSide: sw.spinSide, hand, smash, serve, pressure: p.pressure || 0, fatigue,
    assist: human && T.assist ? { ...T.assist, win: T.window } : null
  });
  m.flight = simulate(st.p, shot.v, shot.w, { t0: th });
  m.evIdx = 0;
  m.rally = { hitter: side, serve, phase: serve ? 'own' : 'toRecv' };
  m.state = 'rally';
  m.plan = null;
  if (serve) m.retoss = 0;
  m.lastShot = { side, kind: shot.kind, outcome: shot.outcome, w: shot.w, q, wrong, rescued: Boolean(sw.rescued), rally: m.rallyHits };
  // 받는 쪽의 타점을 미리 계산합니다(비행이 정해져 있어 예측과 실제가 같습니다).
  const recv = 1 - side;
  const evs = m.flight.events;
  let plan = null;
  if (serve) {
    if (evs[0] && evs[0].type === 'table' && evs[0].side === side) plan = planContact(m.flight, recv, 1);
  } else {
    plan = planContact(m.flight, recv, 0);
  }
  if (plan) setPlan(m, recv, plan, 'incoming', { smash, w: shot.w });
  startStroke(m, side, th, shot.kind, hand, st.p);
  view.flash(m.id, [st.p[0] + m.tx, st.p[1], st.p[2]], smash || q > 0.88);
  if (!m.demo) sfx.hit(q, m.clock.scale < 0.6, smash);
  if (human) {
    pl.shake = smash ? 1 : 0.55;
    const e = Math.abs(sw.err);
    const perfect = e <= T.perfect && !wrong;
    const good = e <= T.good;
    const qLabel = perfect ? 'PERFECT' : good ? 'GOOD' : sw.err < 0 ? '빨라요' : '늦어요';
    const spinLabel = SPIN_LABEL[shot.kind] || '';
    const cls = perfect ? 'perfect' : good ? 'good' : 'meh';
    // 반대 손: 쉬움은 '자동으로 맞췄어요', 보통·어려움은 '백핸드 쪽 공이었어요'
    const handNote = wrong ? (T.hand === 'auto' ? `${HAND_KO[wrong]}로 맞췄어요` : `${HAND_KO[wrong]} 쪽 공이었어요`) : '';
    hudCall(pl.slot, qLabel, spinLabel || handNote, `${cls} ${shot.kind}${wrong && !spinLabel ? ' hand' : ''}`, 1300);
    if (wrong && spinLabel) hudNote(pl.slot, handNote, 1100);
    const S = statOf(pl.slot);
    S.hits += 1;
    if (perfect) S.perfect += 1;
    if (wrong) S.wrong += 1;
    if (sw.rescued || (wrong && T.hand === 'auto')) S.assisted += 1;
    if (!pl.bot) {
      const data = { text: [qLabel, spinLabel, handNote].filter(Boolean).join(' · '), good: good && !wrong, kind: 'hit' };
      if (shot.kind !== 'none') data.spin = shot.kind;
      if (wrong) data.wrong = wrong;
      send('result', data, pl.slot);
      // 맞힌 폰을 진동(폰도 휘두르는 순간 스스로 울리고, 220ms 안의 같은 진동은 한 번만 울립니다)
      sendHaptic(socket, pl.slot, smash || perfect ? 'strong' : 'hit', 0.5 + 0.4 * q);
    }
  }
  // 긴 랠리는 두 사람 화면에 알려 줍니다(10회부터 5회마다).
  if (!m.demo && m.rallyHits >= 10 && m.rallyHits % 5 === 0 && shot.outcome === 'in') {
    for (const pl2 of m.sides) if (pl2.kind === 'human') hudNote(pl2.slot, `랠리 ${m.rallyHits}회!`, 1000);
  }
  // 받는 사람 화면에 들어오는 스핀 예고
  const rp = m.sides[recv];
  if (rp.kind === 'human' && !m.demo && shot.kind !== 'none' && plan) {
    hudNote(rp.slot, { top: '드라이브가 와요', back: '커트가 와요', side: '사이드 스핀이 와요', smash: '스매시!' }[shot.kind], 900);
  }
}

// ---------- 규칙(이벤트) ----------
function processEvents(m, upto, rules) {
  if (!m.flight) return;
  const evs = m.flight.events;
  while (m.evIdx < evs.length && evs[m.evIdx].t <= upto) {
    const e = evs[m.evIdx++];
    if (!m.demo || rules) playEventSound(m, e);
    if (rules && m.state === 'rally') onEvent(m, e);
  }
}
function playEventSound(m, e) {
  if (m.demo) return;
  // 네트 앞에서 잘게 튀는 공이 소리를 연달아 내지 않게 합니다.
  const now = performance.now();
  if (now - (m.lastSound || 0) < 70) return;
  m.lastSound = now;
  if (e.type === 'table') sfx.bounce();
  else if (e.type === 'net' || e.type === 'netcord') sfx.net();
  else if (e.type === 'floor') sfx.floor();
}
function onEvent(m, e) {
  const r = m.rally;
  if (!r) return;
  const h = r.hitter;
  if (e.type === 'netcord') return;
  if (e.type === 'net') {
    if (r.phase === 'recv') point(m, h, 'missed');
    else point(m, 1 - h, r.serve && r.phase === 'own' ? 'fault' : 'net');
    return;
  }
  if (e.type === 'table') {
    if (r.phase === 'own') {
      if (e.side === h) r.phase = 'toRecv';
      else point(m, 1 - h, 'fault');
    } else if (r.phase === 'toRecv') {
      if (e.side === 1 - h) r.phase = 'recv';
      else point(m, 1 - h, r.serve ? 'fault' : 'own');
    } else if (r.phase === 'recv') {
      point(m, h, 'missed');
    }
    return;
  }
  if (e.type === 'floor') {
    if (r.phase === 'recv') point(m, h, 'missed');
    else point(m, 1 - h, r.serve ? 'fault' : 'out');
  }
}

function point(m, winner, why) {
  if (m.state === 'point' || m.state === 'over') return;
  m.score[winner] += 1;
  game.log.push(`${m.id} ${m.sides[winner].name}(${winner}) ${why} ${m.score.join(':')} last=${m.lastShot ? `${m.lastShot.side}/${m.lastShot.kind}/${m.lastShot.outcome}` : '-'}`);
  if (game.log.length > 60) game.log.shift();
  m.plan = null;
  m.state = 'point';
  const now = performance.now();
  m.waitReal = now + 1900;
  view.setScore(m.id, m.score[0], m.score[1], true);
  if (won(m)) m.winner = winner;
  else if (!m.demo && m.sides.every((pl) => pl.kind === 'human')) {
    // 사람끼리: 아무도 휘두르지 않은 점수가 이어지면 그만둡니다(끝없는 듀스 방지).
    m.deadRun = m.swung ? 0 : m.deadRun + 1;
    if (m.deadRun >= DEAD_POINTS) markAbandoned(m);
  }
  if (m.demo) return;
  let humanWon = false;
  for (const side of [0, 1]) {
    const pl = m.sides[side];
    if (pl.kind !== 'human') continue;
    const good = side === winner;
    if (good) humanWon = true;
    const me = m.score[side];
    const op = m.score[1 - side];
    const reason = REASON[why][good ? 1 : 0];
    hudToast(pl.slot, good ? '득점!' : '실점', `${reason} · ${me} : ${op}`, good);
    if (!pl.bot) send('result', { text: good ? `득점! ${me} : ${op}` : `실점 · ${reason} ${me} : ${op}`, good, kind: 'point' }, pl.slot);
  }
  sfx.point(humanWon);
  sfx.clap(humanWon ? 16 : 6);
  pushState();
}

// 칠 사람이 남아 있는 쪽: 봇이거나 폰이 연결된 사람(봇은 서버 명단에 없어서 따로 봅니다)
const isLive = (pl) => pl.kind === 'human' && (pl.bot || playerInfo(pl.slot).connected);

// 중간에 그만둔 경기: 앞선 쪽이 이깁니다. 동점이면 아직 연결된 쪽, 그것도 못 가리면 승자 없음(중단).
function markAbandoned(m) {
  m.abandoned = true;
  if (m.score[0] !== m.score[1]) m.winner = m.score[0] > m.score[1] ? 0 : 1;
  else {
    const live = [0, 1].filter((side) => isLive(m.sides[side]));
    m.winner = live.length === 1 ? live[0] : null;
  }
}

function finishMatch(m, now) {
  m.state = 'over';
  m.plan = null;
  m.overAt = now;
  if (m.demo) return;
  const others = game.matches.filter((x) => !x.demo && x !== m && x.state !== 'over');
  for (const side of [0, 1]) {
    const pl = m.sides[side];
    if (pl.kind !== 'human') continue;
    const good = m.winner === side;
    const title = good ? '승리!' : m.winner == null ? '경기 중단' : '패배';
    const sub = `${m.score[side]} : ${m.score[1 - side]}${others.length ? ' · 다른 경기를 기다려요' : ''}`;
    const i = viewIndex(pl.slot);
    if (i >= 0) hud.banner(i, title, sub, good);
  }
  if (m.sides.some((pl, side) => pl.kind === 'human' && side === m.winner)) sfx.win();
  sfx.clap(40);
  pushState();
  if (game.matches.every((x) => x.demo || x.state === 'over')) game.overAt = now + 3200;
}

// ================================================================
// 라켓 움직임(위치 보정 + 스윙 동작 + 폰 자세)
// ================================================================
function newPad(side) {
  return { base: readyPos(side), pos: readyPos(side), stroke: null, q: new THREE.Quaternion(), qInit: false, hand: 'fore', poseQ: new THREE.Quaternion() };
}
function readyPos(side) {
  return [rightOf(side) * 0.15, TABLE.y + 0.36, -fwdOf(side) * (TABLE.halfL + 0.42)];
}
// 선수 기준(r 오른쪽, u 위, f 앞) → 테이블 좌표
const toWorld = (side, v) => [v[0] * rightOf(side), v[1], v[2] * fwdOf(side)];

// 스윙 궤적(타점 기준 오프셋, 포핸드. 백핸드는 좌우 반전)
const STROKES = {
  none: { back: [0.2, -0.04, -0.12], end: [-0.26, 0.16, 0.3] },
  top: { back: [0.16, -0.18, -0.08], end: [-0.22, 0.36, 0.2] },
  back: { back: [0.1, 0.17, -0.08], end: [-0.06, -0.2, 0.3] },
  side: { back: [0.27, 0.0, -0.06], end: [-0.34, 0.05, 0.18] },
  smash: { back: [0.16, 0.3, -0.14], end: [-0.2, -0.34, 0.34] }
};
// 맞는 면의 법선(포핸드 기준, 선수 좌표)
const CONTACT_N = {
  none: [-0.2, 0.06, 1],
  top: [-0.15, -0.62, 1],
  back: [-0.08, 0.85, 1],
  side: [-0.8, 0.04, 1],
  smash: [-0.05, -0.5, 1]
};
const PRE = 0.13; // 백스윙 → 타점(경기 초)
const FOLLOW = 0.24; // 타점 → 끝(경기 초)
const RECOVER = 0.32;

const _m4 = new THREE.Matrix4();
const _vx = new THREE.Vector3();
const _vy = new THREE.Vector3();
const _vz = new THREE.Vector3();
// 블레이드 위 방향 s, 빨강 면 법선 fc(테이블 좌표) → 라켓 회전
function quatFrom(s, fc, out) {
  _vy.set(s[0], s[1], s[2]).normalize();
  _vz.set(fc[0], fc[1], fc[2]);
  _vz.addScaledVector(_vy, -_vz.dot(_vy));
  if (_vz.lengthSq() < 1e-6) _vz.set(0, 0, 1).addScaledVector(_vy, -_vy.z);
  _vz.normalize();
  _vx.crossVectors(_vy, _vz);
  return out.setFromRotationMatrix(_m4.makeBasis(_vx, _vy, _vz));
}
// 기본 자세(폰 자세가 없을 때): 손, 단계(a: −1 백스윙, 0 타점, 1 끝), 스윙 종류
function strokeOrient(side, hand, kind, a, out) {
  const n = CONTACT_N[kind] || CONTACT_N.none;
  let s;
  let face;
  if (a <= 0) {
    const t = a + 1; // 0 → 1
    s = [mix(-0.15, -0.45, t), mix(0.9, 0.78, t), mix(0.32, 0.2, t)];
    face = [mix(0.25, n[0], t), mix(n[1] * 0.4, n[1], t), 1];
  } else {
    s = [mix(-0.45, -0.8, a), mix(0.78, 0.55, a), mix(0.2, -0.05, a)];
    face = [mix(n[0], -0.75, a), n[1] * (1 - a * 0.3), mix(1, 0.6, a)];
  }
  return orientFor(side, hand, s, face, out);
}
const READY = { s: [-0.34, 0.86, 0.22], face: [-0.62, 0.1, 0.8] };
function orientFor(side, hand, s, face, out) {
  if (hand === 'back') {
    // 백핸드: 좌우를 뒤집고, 검정 면이 공을 향하므로 빨강 면 법선은 반대
    s = [s[0] * 0.6 - 0.45, s[1] * 0.75, s[2]];
    face = [face[0], -face[1], -face[2]];
  }
  return quatFrom(toWorld(side, s), toWorld(side, face), out);
}
function mix(a, b, t) {
  return a + (b - a) * t;
}
const ease = (t) => t * t * (3 - 2 * t);

function startStroke(m, side, t0, kind, hand, base) {
  const pad = m.pad[side];
  pad.stroke = { t0, kind: STROKES[kind] ? kind : 'none', hand: hand || 'fore', base: base ? base.slice() : null, from: pad.pos.slice(), qFrom: pad.q.clone() };
}
function strokeOffset(st, a, side) {
  const S = STROKES[st.kind];
  const flip = st.hand === 'back' ? -1 : 1;
  const back = [S.back[0] * flip, S.back[1], S.back[2]];
  const end = [S.end[0] * flip, S.end[1], S.end[2]];
  // 2차 베지어: 백스윙(a=−1) → 타점(a=0) → 끝(a=1)
  const t = (a + 1) / 2;
  const c = [-0.5 * (back[0] + end[0]), -0.5 * (back[1] + end[1]), -0.5 * (back[2] + end[2])];
  const o = [0, 1, 2].map((k) => (1 - t) * (1 - t) * back[k] + 2 * (1 - t) * t * c[k] + t * t * end[k]);
  return toWorld(side, o);
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
function updatePaddles(m, dtG, dtR, now) {
  const gt = m.clock.gt;
  for (const side of [0, 1]) {
    const pad = m.pad[side];
    const pl = m.sides[side];
    const p = m.plan;
    let target = readyPos(side);
    if (p && p.side === side && !p.decided) {
      // 들어오는 공: 타점 옆(포핸드면 오른쪽, 백핸드면 왼쪽)에서 기다립니다.
      pad.hand = handFor(side, p.p);
      const off = toWorld(side, [pad.hand === 'back' ? -0.17 : 0.17, 0.01, 0.0]);
      target = [p.p[0] + off[0], p.p[1] + off[1], p.p[2] + off[2]];
      // 미리 아는 스윙(CPU·봇)은 백스윙부터 보여 줍니다.
      const known = p.cpu ? (p.cpuMiss ? 'none' : p.cpuSwing.spin) : p.botSwing && p.botAt != null ? p.botSwing.spin : null;
      const at = p.cpu ? p.t : p.botAt;
      if (known && at != null && gt >= at - PRE && (!pad.stroke || pad.stroke.t0 !== at)) {
        const smashy = p.cpu && p.cpuSwing && p.cpuSwing.power > 0.85 && p.apexH >= 0.24;
        startStroke(m, side, at, smashy ? 'smash' : known, pad.hand, p.p);
      }
    } else if (m.state === 'intro' && m.server === side && m.toss0) {
      const off = toWorld(side, [0.13, 0, 0]);
      target = [m.toss0[0] + off[0], m.toss0[1] + 0.08, m.toss0[2] + off[2]];
      pad.hand = 'fore';
    }
    const k = 1 - Math.exp(-dtG / 0.085);
    for (let i = 0; i < 3; i++) pad.base[i] += (target[i] - pad.base[i]) * k;

    // 위치와 기본 회전
    let pos = pad.base;
    const qDef = _qa;
    orientFor(side, pad.hand, READY.s, READY.face, qDef);
    const st = pad.stroke;
    if (st) {
      const dt = gt - st.t0;
      const base = st.base || pad.base;
      if (dt < -PRE) {
        // 아직 백스윙 전
      } else if (dt <= FOLLOW) {
        const a = dt < 0 ? dt / PRE : dt / FOLLOW;
        const o = strokeOffset(st, a, side);
        const sp = [base[0] + o[0], base[1] + o[1], base[2] + o[2]];
        // 백스윙 들어갈 때와 사람이 친 순간(타점으로 순간 이동)은 짧게 섞습니다.
        const w = dt < 0 ? clamp((a + 1) / 0.45, 0, 1) : st.base && dt < 0.012 ? clamp(dt / 0.012, 0, 1) : 1;
        pos = w >= 1 ? sp : [mix(pad.pos[0], sp[0], w), mix(pad.pos[1], sp[1], w), mix(pad.pos[2], sp[2], w)];
        strokeOrient(side, st.hand, st.kind, a, qDef);
      } else if (dt <= FOLLOW + RECOVER) {
        const r = ease((dt - FOLLOW) / RECOVER);
        const o = strokeOffset(st, 1, side);
        const sp = [base[0] + o[0], base[1] + o[1], base[2] + o[2]];
        pos = [mix(sp[0], pad.base[0], r), mix(sp[1], pad.base[1], r), mix(sp[2], pad.base[2], r)];
        strokeOrient(side, st.hand, st.kind, 1, _qb);
        qDef.slerpQuaternions(_qb, qDef.clone(), r);
      } else {
        pad.stroke = null;
      }
    }
    pad.pos = pos;
    // 폰 자세가 들어오면 라켓 방향은 폰을 그대로 따릅니다(위치는 보정).
    let qT = qDef;
    const pose = pl.slot != null && !pl.bot && !m.demo ? game.poses[pl.slot] : null;
    if (pose && now - pose.at < 700) {
      quatFrom(toWorld(side, pose.s), toWorld(side, pose.fc), pad.poseQ);
      qT = pad.poseQ;
    }
    if (!pad.qInit) {
      pad.q.copy(qT);
      pad.qInit = true;
    } else {
      pad.q.slerp(qT, 1 - Math.exp(-dtR / 0.035));
    }
  }
}

// ================================================================
// 폰 자세·준비
// ================================================================
function onPose(d) {
  if (!d || !Array.isArray(d.s) || !Array.isArray(d.fc) || d.s.length < 3 || d.fc.length < 3) return;
  const s = d.s.map((x) => num(x, 0));
  const fc = d.fc.map((x) => num(x, 0));
  if (Math.hypot(...s) < 1e-3 || Math.hypot(...fc) < 1e-3) return;
  game.poses[d.slot] = { s, fc, at: performance.now() };
}
function onCalibrate(d) {
  const slot = Number(d && d.slot);
  if (!SLOT_INFO[slot]) return;
  delete game.poses[slot];
  const ent = humanBySlot(slot);
  if (ent) ent.m.pad[ent.side].qInit = false;
  game.ready.add(slot);
  if (game.phase === 'playing') hudNote(slot, '준비 완료');
  renderLobby();
}

// ================================================================
// 경기 시작·끝
// ================================================================
function startDemo() {
  game.matches = [
    newMatch('A', cpu('dA0', SLOT_INFO[1].color), cpu('dA1', SLOT_INFO[2].color), true),
    newMatch('B', cpu('dB0', SLOT_INFO[3].color), cpu('dB1', SLOT_INFO[4].color), true)
  ];
  syncTables();
}
function syncTables() {
  const list = [];
  for (const m of game.matches) for (const pl of m.sides) list.push({ key: pl.key, color: pl.color, label: pl.kind === 'cpu' ? 'CPU' : pl.name });
  view.setPaddles(list);
  for (const id of Object.keys(TABLE_X)) {
    const m = game.matches.find((x) => x.id === id);
    if (m) {
      view.setNames(id, m.sides[0].name, m.sides[0].color, m.sides[1].name, m.sides[1].color);
      view.setScore(id, m.score[0], m.score[1], false);
    } else {
      view.setNames(id, '-', '#3a4258', '-', '#3a4258');
      view.setScore(id, 0, 0, false);
      view.setBall(id, null);
    }
  }
}

function startGame() {
  if (game.phase === 'playing') {
    // 경기 중 Enter·폰 시작: 남은 경기마다 칠 사람이 하나도 없으면(모두 연결 끊김) 그 경기들을 접고 결과로 넘어갑니다.
    const open = game.matches.filter((m) => !m.demo && m.state !== 'over');
    if (open.length && open.every((m) => !m.sides.some(isLive))) {
      const now = performance.now();
      for (const m of open) {
        markAbandoned(m);
        finishMatch(m, now);
      }
      endGame();
    }
    return;
  }
  const list = lobbyPlayers().filter((p) => p.connected);
  if (!list.length) {
    lobbyMessage('폰을 먼저 연결해 주세요. QR을 찍고 시작하기를 누르면 자리가 생겨요.');
    return;
  }
  // 슬로우 모드는 묻고 정합니다. 아무도 답하지 않았으면 시작하지 않고 질문 카드를 흔듭니다
  // (폰의 준비 버튼도 답하기 전에는 막혀 있어서 보통은 여기까지 오지 않습니다).
  if (!settings.requireAnswered()) {
    lobbyMessage('슬로우 모드를 켤지 먼저 골라 주세요 · 폰이나 여기서 고르거나 L 키');
    pushState();
    return;
  }
  audio();
  applySettings();
  settings.lock(true);
  board.hide(true);
  game.stats = {};
  const H = list.slice(0, 4).map(human);
  const matches = [newMatch('A', H[0], H[1] || cpu('cpuA'), false)];
  if (H.length > 2) matches.push(newMatch('B', H[2], H[3] || cpu('cpuB'), false));
  game.matches = matches;
  game.humans = H;
  game.phase = 'playing';
  game.overAt = 0;
  game.log.length = 0;
  syncTables();
  hud.clear();
  $('lobby').classList.add('hidden');
  $('over').classList.add('hidden');
  sfx.win();
  pushState();
}

// 경기를 버리고 대기실로(서버 재시작 등). 대기실 시연 경기를 다시 돌립니다.
function backToLobby(why) {
  game.phase = 'lobby';
  game.humans = [];
  game.overAt = 0;
  game.poses = {};
  game.ready.clear();
  settings.lock(false);
  board.hide(false);
  startDemo();
  hud.clear();
  $('lobby').classList.remove('hidden');
  $('over').classList.add('hidden');
  if (why) lobbyMessage(why);
  renderLobby();
  pushState();
}

function endGame() {
  game.phase = 'over';
  // 결과 화면에서는 다음 판 난이도·슬로우를 바꿀 수 있습니다.
  settings.lock(false);
  board.hide(false);
  const rows = [];
  for (const m of game.matches) {
    if (m.demo) continue;
    for (const side of [0, 1]) {
      const pl = m.sides[side];
      if (pl.kind !== 'human') continue;
      const opp = m.sides[1 - side];
      rows.push({ pl, opp, me: m.score[side], op: m.score[1 - side], win: m.winner === side, stop: m.winner == null, table: m.id });
    }
  }
  rows.sort((a, b) => (b.win - a.win) || (b.me - b.op) - (a.me - a.op) || b.me - a.me);
  const box = $('podium');
  box.innerHTML = '';
  rows.forEach((r, i) => {
    const e = document.createElement('div');
    e.className = 'r' + (r.win ? ' win' : '');
    e.style.setProperty('--c', r.pl.color);
    e.style.animationDelay = `${0.15 + i * 0.12}s`;
    const diff = r.me - r.op;
    const st = statOf(r.pl.slot);
    e.innerHTML = `<span class="rank">${i + 1}</span><span class="who">${r.pl.name}</span>` +
      `<span class="res">${r.win ? '승' : r.stop ? '중단' : '패'}</span>` +
      `<span class="num"><b>${r.me} : ${r.op}</b><span>vs <em style="color:${r.opp.color}">${r.opp.name}</em> · 테이블 ${r.table}</span></span>` +
      `<span class="num"><b>${diff > 0 ? '+' : ''}${diff}</b><span>득실</span></span>` +
      `<span class="num"><b>${st.hits}</b><span>타구 · PERFECT ${st.perfect}</span></span>`;
    box.appendChild(e);
  });
  hud.clear();
  $('overMeta').textContent = `FINAL · ${DIFF_LABEL[game.diff] || '보통'} · 슬로우 ${game.slow ? '켬' : '끔'}`;
  $('over').classList.remove('hidden');
  sfx.clap(50);
  pushState();
}

function statePlayers() {
  const out = {};
  if (game.phase === 'lobby') {
    const list = lobbyPlayers().filter((p) => p.connected).slice(0, 4);
    list.forEach((p, i) => {
      const opp = list[i ^ 1];
      out[p.slot] = { table: i < 2 ? 'A' : 'B', opp: opp ? opp.name : 'CPU', score: [0, 0], serving: i % 2 === 0 };
    });
    return out;
  }
  for (const m of game.matches) {
    if (m.demo) continue;
    for (const side of [0, 1]) {
      const pl = m.sides[side];
      if (pl.kind !== 'human') continue;
      out[pl.slot] = {
        table: m.id, opp: m.sides[1 - side].name, score: [m.score[side], m.score[1 - side]],
        serving: m.state !== 'over' && serverOf(m) === side,
        // 이 경기는 끝났고 다른 테이블을 기다리는 중(폰이 경기 화면 대신 결과를 보여 줍니다)
        done: m.state === 'over'
      };
    }
  }
  return out;
}
function pushState() {
  // settings: 폰 대기 화면의 난이도·슬로우 알약과 질문 카드. diff/slow: 이번 경기에 쓰는 값(폰 연습·표시용)
  send('game_state', { phase: game.phase, players: statePlayers(), settings: settings.forState(), diff: game.diff, slow: game.slow });
}

// ================================================================
// 대기실 화면
// ================================================================
function renderLobby() {
  const box = $('slots');
  if (!box) return;
  box.innerHTML = '';
  const list = lobbyPlayers();
  const practicing = board.practicing();
  for (let s = 1; s <= 4; s++) {
    const p = list.find((x) => x.slot === s);
    const e = document.createElement('div');
    // 준비는 서버가 세는 값(ready_state), 연습 중은 튜토리얼 판, 자세 맞춤은 calibrate 로 압니다.
    const rdy = Boolean(p && (p.bot || (readyState && readyState.ready.includes(s))));
    const prac = Boolean(p && !p.bot && practicing.includes(s));
    e.className = 'slot' + (p ? ' on' : '') + (p && !p.connected ? ' away' : '') + (rdy ? ' ready' : '') + (prac ? ' prac' : '') + (p && p.bot ? ' bot' : '');
    if (p) {
      e.style.setProperty('--c', p.color);
      const tag = p.bot ? 'BOT' : rdy ? '준비 완료 ✓' : prac ? '연습 중' : game.ready.has(s) ? '자세 맞춤 · 준비 전' : '준비 전';
      e.innerHTML = `<b>${p.name}</b><small>${tag}</small>`;
    } else {
      e.textContent = `${s}P 비어 있음`;
    }
    box.appendChild(e);
  }
  const conn = list.filter((p) => p.connected);
  const pairs = $('pairs');
  if (pairs) {
    if (!conn.length) pairs.textContent = '1P 대 2P 는 테이블 A, 3P 대 4P 는 테이블 B 에서 겨룹니다. 혼자면 CPU 와 칩니다.';
    else {
      const a = `${conn[0].name} 대 ${conn[1] ? conn[1].name : 'CPU'}`;
      const b = conn[2] ? ` · 테이블 B: ${conn[2].name} 대 ${conn[3] ? conn[3].name : 'CPU'}` : '';
      pairs.textContent = `테이블 A: ${a}${b}`;
    }
  }
}
let msgTimer = null;
function lobbyMessage(t) {
  const e = $('msg');
  e.textContent = t;
  e.classList.add('on');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => e.classList.remove('on'), 2600);
}

// HUD 도우미(자리 번호로 화면 칸 찾기)
function hudCall(slot, main, sub, cls, ms) {
  const i = viewIndex(slot);
  if (i >= 0) hud.callout(i, main, sub, cls, ms);
}
function hudToast(slot, main, sub, good) {
  const i = viewIndex(slot);
  if (i >= 0) hud.toast(i, main, sub, good);
}
function hudNote(slot, text, ms) {
  const i = viewIndex(slot);
  if (i >= 0) hud.note(i, text, ms);
}

// ================================================================
// 화면 분할과 카메라
// ================================================================
function layoutViews() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  if (game.phase !== 'playing') return [{ kind: 'overview', x: 0, y: 0, w: W, h: H }];
  const n = game.humans.length;
  const hw = Math.floor(W / 2);
  const hh = Math.floor(H / 2);
  const cells = n === 1 ? [[0, 0, W, H]] : n === 2 ? [[0, 0, hw, H], [hw, 0, W - hw, H]] : [[0, 0, hw, hh], [hw, 0, W - hw, hh], [0, hh, hw, H - hh], [hw, hh, W - hw, H - hh]];
  const out = game.humans.map((pl, i) => ({ kind: 'player', slot: pl.slot, color: pl.color, name: pl.name, x: cells[i][0], y: cells[i][1], w: cells[i][2], h: cells[i][3] }));
  if (n === 3) out.push({ kind: 'overview', x: cells[3][0], y: cells[3][1], w: cells[3][2], h: cells[3][3] });
  return out;
}
function overviewCam(now) {
  const a = now / 1000 * 0.07 + 2.2;
  return { pos: [ARENA_CX + Math.sin(a) * 11.5, 6.4 + Math.sin(a * 0.6) * 0.8, Math.cos(a) * 11.5], look: [ARENA_CX, 0.5, 0], fov: 50 };
}
// 1인칭 카메라: 엔드라인 1.2m 뒤, 눈높이 1.45m 에서 16° 쯤 내려다봅니다.
// 흔한 타점(엔드라인 0.2~0.4m 뒤, 테이블 위 0.15~0.3m)이 화면 아래쪽 1/4 쯤(NDC y −0.2~−0.6)에 오고,
// 네트와 상대 쪽 끝은 화면 가운데 조금 위에 옵니다.
const CAM = { y: 1.45, back: 2.6, lookY: 0.45, lookZ: 0.9, maxX: 1.0, fov: 55, maxFov: 75 };
function playerCam(m, side, pl, dtR, aspect) {
  const F = fwdOf(side);
  const pad = m.pad[side];
  // 라켓을 따라 옆으로 움직입니다. 넓게 빠지는 공도 라켓이 화면에 남도록 테이블 밖까지 따라갑니다.
  pl.camX += (clamp(pad.pos[0], -CAM.maxX, CAM.maxX) - pl.camX) * (1 - Math.exp(-dtR / 0.25));
  pl.shake = Math.max(0, pl.shake - dtR * 3);
  const j = pl.shake * 0.006;
  const sx = (Math.random() - 0.5) * j;
  const sy = (Math.random() - 0.5) * j;
  const p = m.plan;
  const slowAmt = p && p.side === side && p.human && !p.decided ? clamp((1 - m.clock.scale) / (1 - SLOW), 0, 1) : 0;
  // 세로로 긴 칸(2인 좌우 분할)은 가로 화각이 좁아지므로, 가로 화각을 정사각형 칸만큼 지키도록 세로 화각을 넓힙니다.
  const fov = aspect >= 1 ? CAM.fov : Math.min(CAM.maxFov, (2 * Math.atan(Math.tan((CAM.fov * Math.PI) / 360) / Math.max(0.1, aspect)) * 180) / Math.PI);
  return {
    // 시선은 옆으로 돌리지 않고 테이블 길이 방향으로 곧게 둡니다(가장자리 라켓이 화면 밖으로 밀려나지 않게).
    pos: [m.tx + pl.camX + sx, CAM.y + sy, -F * CAM.back],
    look: [m.tx + pl.camX, CAM.lookY, F * CAM.lookZ],
    fov,
    slowAmt
  };
}

// ================================================================
// 매 프레임
// ================================================================
const trailBuf = [];
const _st = { p: [0, 0, 0], v: [0, 0, 0], w: [0, 0, 0] };
function updateMatch(m, now, dtR) {
  const c = m.clock;
  const target = slowTarget(m);
  const tau = target < c.scale ? 0.045 : 0.1;
  c.scale += (target - c.scale) * (1 - Math.exp(-dtR / tau));
  if (Math.abs(c.scale - target) < 0.003) c.scale = target;
  const dtG = dtR * c.scale;
  c.gt += dtG;
  c.hist.push([now, c.gt]);
  while (c.hist.length > 2 && now - c.hist[0][0] > 6000) c.hist.shift();

  if (m.state === 'intro') {
    if (now >= m.waitReal) {
      if (!m.toss0) prepareServe(m);
      startToss(m);
    }
  } else if (m.state === 'toss' || m.state === 'rally') {
    const p = m.plan;
    // 받는 사람 판정이 남아 있으면 타점 뒤의 사건(두 번째 바운드·바닥)은 미룹니다.
    const upto = p && !p.decided ? Math.min(c.gt, p.t) : c.gt;
    if (m.state === 'rally') processEvents(m, upto, true);
    if (m.plan && !m.plan.decided && (m.state === 'toss' || m.state === 'rally')) updatePlan(m, m.plan, now);
    if (m.state === 'rally' && (!m.plan || m.plan.decided)) processEvents(m, c.gt, true);
  } else if (m.state === 'point') {
    processEvents(m, c.gt, false);
    if (now >= m.waitReal) {
      if (m.winner != null || m.abandoned) finishMatch(m, now);
      else {
        m.state = 'intro';
        m.waitReal = now + 600;
        prepareServe(m);
      }
    }
  } else if (m.state === 'over' && m.demo && now - m.overAt > 3500) {
    // 대기실 시연 경기는 끝나면 다시 시작합니다.
    const fresh = newMatch(m.id, m.sides[0], m.sides[1], true);
    Object.assign(m, fresh);
    view.setScore(m.id, 0, 0, true);
  }
  updatePaddles(m, dtG, dtR, now);

  // 공
  let ball = null;
  if (m.flight && c.gt <= flightEnd(m.flight) && m.state !== 'over') {
    sampleFlight(m.flight, c.gt, _st);
    trailBuf.length = 0;
    const span = 0.06;
    const t0 = Math.max(m.flight.t0, c.gt - span);
    const N = 14;
    for (let i = 0; i < N; i++) {
      const t = t0 + ((c.gt - t0) * i) / (N - 1);
      const s = sampleFlight(m.flight, t);
      trailBuf.push([s.p[0] + m.tx, s.p[1], s.p[2]]);
    }
    const w = _st.w;
    const wm = Math.hypot(w[0], w[1], w[2]);
    ball = { visible: true, pos: [_st.p[0] + m.tx, _st.p[1], _st.p[2]], trail: c.gt - m.flight.t0 > 0.004 ? trailBuf.slice() : [], spinAxis: w, spinAngle: wm * dtG * 0.035 };
  } else if (m.state === 'intro' && m.toss0) {
    ball = { visible: true, pos: [m.toss0[0] + m.tx, m.toss0[1] + Math.sin(now / 260) * 0.006, m.toss0[2]], trail: [] };
  }
  view.setBall(m.id, ball);
  for (const side of [0, 1]) view.posePaddle(m.sides[side].key, [m.pad[side].pos[0] + m.tx, m.pad[side].pos[1], m.pad[side].pos[2]], m.pad[side].q, true);
}

let last = performance.now();
function tick() {
  const now = performance.now();
  const dtR = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  for (const m of game.matches) updateMatch(m, now, dtR);
  if (game.phase === 'playing' && game.overAt && now >= game.overAt) endGame();

  const views = layoutViews();
  const cams = views.map((v) => {
    if (v.kind === 'overview') return { ...v, ...overviewCam(now) };
    const ent = humanBySlot(v.slot);
    return { ...v, ...playerCam(ent.m, ent.side, ent.pl, dtR, v.w / Math.max(1, v.h)) };
  });
  view.update(dtR, now);
  view.render(cams);

  // HUD
  hud.layout(game.phase === 'playing' ? views : []);
  if (game.phase === 'playing') {
    cams.forEach((v, i) => {
      if (v.kind === 'overview') {
        hud.overview(i, game.matches.filter((m) => !m.demo).map((m) => ({
          table: `TABLE ${m.id}`, n0: m.sides[0].name, c0: m.sides[0].color, n1: m.sides[1].name, c1: m.sides[1].color,
          s0: m.score[0], s1: m.score[1], done: m.state === 'over'
        })));
        return;
      }
      const { m, side, pl } = humanBySlot(v.slot);
      const opp = m.sides[1 - side];
      const info = playerInfo(pl.slot);
      hud.score(i, {
        me: m.score[side], op: m.score[1 - side], oppName: opp.name, oppColor: opp.color, table: m.id,
        serving: m.state !== 'over' && m.server === side, away: !pl.bot && !info.connected
      });
      hud.slow(i, v.slowAmt || 0);
      const p = m.plan;
      if (p && p.side === side && !p.decided && p.cued && m.flight) {
        const st = sampleFlight(m.flight, m.clock.gt);
        const pr = view.project(i, [st.p[0] + m.tx, st.p[1], st.p[2]]);
        if (pr && !pr.behind) {
          const left = clamp((p.t - m.clock.gt) / cueLead(), 0, 1);
          // 공이 칸 가장자리 밖으로 나가도 링(타이밍)은 칸 안쪽 가장자리에 붙여 계속 보여 줍니다.
          const mg = pr.r + 10;
          const x = clamp(pr.x, mg, Math.max(mg, v.w - mg));
          const y = clamp(pr.y, mg, Math.max(mg, v.h - mg));
          // 링 아래 작은 글씨로 칠 손(포핸드/백핸드)을 알려 줍니다. 가운데 공(any)은 '아무 손'.
          const label = p.kind === 'serve' ? '서브' : p.zone === 'any' ? '아무 손이나' : HAND_KO[p.zone];
          hud.ring(i, { x, y, ball: pr.r, R: pr.r + 2 + left * v.h * 0.16, p: left, after: m.clock.gt > p.t, label, side: p.kind === 'serve' ? 0 : p.zone === 'back' ? -1 : p.zone === 'fore' ? 1 : 0 });
        } else hud.ring(i, null);
      } else hud.ring(i, null);
    });
  }
  requestAnimationFrame(tick);
}

// ================================================================
// 키보드(시험용): Space 스윙, T 드라이브, B 커트, Enter 시작
// ================================================================
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    // 경기 중이면 startGame 이 '칠 사람이 아무도 없는 경기'만 접고 결과로 넘깁니다.
    startGame();
    return;
  }
  const spin = e.code === 'Space' ? 'none' : e.code === 'KeyT' ? 'top' : e.code === 'KeyB' ? 'back' : null;
  if (!spin) return;
  e.preventDefault();
  if (game.phase !== 'playing' || !game.humans.length) return;
  const slot = game.humans[0].slot;
  const ent = humanBySlot(slot);
  // 키보드는 손을 가릴 수 없어 공 쪽 손(auto)으로 칩니다.
  onSwing({ slot, power: 0.8, ago: 0, rtt: 0, spin, spinAmt: 0.75, side: 1, aim: 0, hand: 'auto' }, true);
});

startDemo();
renderLobby();
requestAnimationFrame(tick);
// ?bots=N&autostart: 폰 없이 봇만으로 바로 시작(시험용). 슬로우 모드를 아직 안 정했으면 정할 때까지 기다립니다
// (주소에 &slow=on|off 를 붙이거나 L 키·대기실 카드로 고르면 바로 시작).
if (AUTOSTART && BOTS > 0) {
  let auto = true;
  const tryStart = () => {
    if (!auto || game.phase !== 'lobby' || serverPlayers.length) return;
    if (settings.isAnswered()) {
      auto = false;
      startGame();
    } else {
      settings.requireAnswered();
      lobbyMessage('슬로우 모드를 고르면 바로 시작해요');
    }
  };
  settings.onChange(() => setTimeout(tryStart, 400));
  setTimeout(tryStart, 1200);
}

// 디버그: 콘솔에서 상태 보기
window.__pp = {
  game, view, hud, toGame, onSwing, serverOf, lobbyPlayers, startGame, endGame, backToLobby, SLOW, TUNE, settings, board,
  get WINDOW() { return game.tune.window; },
  // 시험: 지금 받을 공이 있는 첫 사람에게 스윙을 넣습니다. off = 타점과의 차(경기 초), hand = 'fore'|'back'|'auto'|'wrong'
  swingNow(off = 0, hand = 'auto', slot) {
    const s = slot ?? (game.humans[0] && game.humans[0].slot);
    const ent = humanBySlot(s);
    if (!ent || !ent.m.plan || ent.m.plan.side !== ent.side) return 'no-plan';
    const p = ent.m.plan;
    const h = hand === 'wrong' ? (p.zone === 'back' ? 'fore' : 'back') : hand;
    // 휘두른 순간을 '타점 + off'(경기 시각, 지금보다 늦지 않게)로 넣습니다.
    onSwing({ slot: s, power: 0.7, ago: 0, rtt: 0, spin: 'none', spinAmt: 0.5, side: 1, aim: 0, hand: h }, true, Math.min(ent.m.clock.gt, p.t + off));
    return { t: p.t, gt: ent.m.clock.gt, zone: p.zone, decided: p.decided, swing: p.swing, last: ent.m.lastShot };
  },
  stats: () => game.stats,
  lastShot: (id = 'A') => (game.matches.find((m) => m.id === id) || {}).lastShot
};
