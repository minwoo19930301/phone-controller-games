// 볼링 큰 화면: 1~4명이 차례로 한 프레임씩 굴리는 열 핀 볼링(기본 5프레임, 설정으로 10프레임).
// 폰이 aim{x}(서는 자리) 와 throw{speed, dir, spin, quality}(휘두름) 를 보내면, 이 화면이 물리(physics.mjs)로 굴림을 끝까지 계산해
// 3D 로 재생합니다. 점수는 scoring.mjs. 판정은 전부 여기서 하고 서버는 중계만 합니다.
// 난이도: 쉬움 = 방향 보정이 강하고 안내선·범퍼, 보통 = 약한 보정, 어려움 = 그대로.
// 시험: ?bots=N&autostart (봇이 알아서 끝까지), &fast=4 (시간 4배), window.__bowling.
import * as THREE from 'three';
import { createScene } from './scene.js';
import { C, PIN_SPOTS, simulate, solveAngle, rollPath, pocketX, makeRng, isSplit } from './physics.mjs';
import { scoreGame, nextBall, strikeStreak } from './scoring.mjs';
import { sfx, audio } from './sfx.js';
import { createSettings, fields, DIFF_LABEL } from '/common/settings.js';
import { createTutorialBoard } from '/common/tutorial-board.js';
import { sendHaptic } from '/common/haptics.js';
import { t, mountSwitcher } from '/common/i18n.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const lerp = (a, b, t) => a + (b - a) * t;
const num = (v, d) => (v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d);
const BOTS = clamp(parseInt(params.get('bots'), 10) || 0, 0, 4);
const AUTOSTART = params.has('autostart');
const FAST = clamp(num(params.get('fast'), 1), 1, 12);
const MAX_PLAYERS = 4;
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const gauss = (rng) => { let s = 0; for (let i = 0; i < 6; i++) s += rng(); return (s - 3) / 0.7; };

// ---------- 조정 값 ----------
const AIM_RANGE_X = 0.42; // 서는 자리(-1..1)에 곱함: 레인 가장자리 근처까지(m)
const TURN_TIMEOUT_S = 45; // 이 시간 안에 안 던지면 자동 투구
const RESULT_S = 2.1; // 결과 배너 보여 주는 시간
const SWEEP_S = 2.3;
const RACK_S = 0.8;
const INTRO_S = 2.8;
const SLOW_SCALE = 0.3; // 스트라이크 슬로모 속도
const SPEED_MIN = 5.2, SPEED_MAX = 10.2; // 공 속도 범위(m/s). 18.7~36.7 km/h
// 난이도: dirScale = 폰 방향(도)이 공 각도(도)가 되는 비율, assist = 포켓·남은 핀 쪽으로 끌어 주는 정도, spin = 훅 배율, noise = 흔들림(도)
// 쉬움·보통(assist>0)은 폰 방향·손목 비틂을 안 씁니다: 서는 자리만 고르면 되고, 훅은 부드러운 고정값(EASY_HOOK)입니다.
const DIFF = {
  easy: { dirScale: 0, assist: 1, spin: 0.7, noise: 0.15, minSpeed: 6.4, guide: true },
  normal: { dirScale: 0.04, assist: 0.85, spin: 0.9, noise: 0.15, minSpeed: 5.6, guide: false },
  hard: { dirScale: 0.26, assist: 0, spin: 1, noise: 0.55, minSpeed: 5.2, guide: false }
};
const EASY_HOOK = -0.35; // 쉬움·보통의 고정 훅(왼쪽으로 살짝)
const WARN_S = 10; // 시간 초과 몇 초 전에 폰에 알려 줄지
let diff = 'easy';
let D = DIFF.easy;
const SLOT_INFO = {
  1: { name: '1P', color: '#ff5a5f' }, 2: { name: '2P', color: '#3ab4ff' }, 3: { name: '3P', color: '#ffc93c' }, 4: { name: '4P', color: '#5ee07a' }
};

// 글꼴을 기다린 뒤(캔버스 글자) 장면을 만듭니다.
await Promise.race([
  Promise.all([document.fonts.load('400 64px Anton'), document.fonts.load('800 64px "Pretendard Variable"')]),
  new Promise((r) => setTimeout(r, 2000))
]).catch(() => {});
const view = createScene($('cv'), { low: params.has('low') });
mountSwitcher($('langBox'), { reload: true, compact: true });

// ================================================================
// 연결
// ================================================================
const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true });
let serverPlayers = [];
let hadRoom = false;
let roomCode = '';
function send(event, data, slot) {
  if (!socket.connected) return;
  socket.emit('d2c', slot != null ? { event, slot, data } : { event, data });
}
setInterval(() => { if (socket.connected) socket.timeout(2000).emit('ping_rtt', performance.now(), () => {}); }, 4000);

socket.on('connect', () => {
  let saved = null;
  try { saved = sessionStorage.getItem('pcg-bowling-room'); } catch (e) { /* 저장소 막힘 */ }
  socket.emit('join', { role: 'display', game: 'bowling', room: saved });
});
socket.on('room', async (r) => {
  try { sessionStorage.setItem('pcg-bowling-room', r.code); } catch (e) { /* 저장소 막힘 */ }
  serverPlayers = r.players || [];
  roomCode = r.code;
  syncRoster();
  if (r.fresh && hadRoom && game.phase !== 'lobby') backToLobby(t('서버가 다시 시작돼서 대기실로 돌아왔어요'));
  hadRoom = true;
  $('code').textContent = r.code;
  $('codeMini').textContent = r.code;
  try {
    const res = await fetch(`/api/qr?room=${r.code}`).then((x) => x.json());
    $('qr').src = res.qr; $('qrMini').src = res.qr;
    $('url').textContent = res.url.replace(/^https?:\/\//, '');
    $('warn').classList.toggle('hidden', Boolean(res.secure));
  } catch (e) { /* QR 없이도 코드는 보임 */ }
  renderLobby();
  pushState(true);
});
socket.on('players', (p) => {
  const before = new Set(serverPlayers.map((x) => x.slot));
  serverPlayers = p.players || [];
  for (const pl of serverPlayers) if (!before.has(pl.slot)) sfx.join();
  syncRoster();
  renderLobby();
  pushState(true);
});
socket.on('display_replaced', () => $('replaced').classList.remove('hidden'));
socket.on('start_game', () => startGame());
socket.on('aim', (d) => onAim(d));
socket.on('throw', (d) => onThrow(d));
socket.on('calibrate', (d) => { const P = roster.get(Number(d && d.slot)); if (P) { P.calibrated = true; renderLobby(); } });

// ---------- 난이도·길이·범퍼 (공통 설정) ----------
const settings = createSettings({
  game: 'bowling',
  keys: true,
  fields: [
    fields.difficulty(),
    fields.choice('frames', '경기 길이', [{ value: '5', label: '5프레임' }, { value: '10', label: '10프레임' }], { default: '5', hotkey: 'f' }),
    fields.toggle('bumpers', '범퍼', { on: '켜기', off: '끄기', default: false, hint: '거터를 막아 줘요' })
  ],
  onChange: () => { applyDifficulty(); renderLobby(); pushState(true); }
});
settings.attach(socket);
settings.mount($('setBox'));
settings.mount($('setBoxOver'), { compact: true });
const boards = [createTutorialBoard({ mount: $('tutBox') }), createTutorialBoard({ mount: $('tutBoxOver') })];
for (const b of boards) b.attach(socket);
const practicing = new Map();
socket.on('tutorial', (d) => {
  const s = Number(d && d.slot);
  if (!s) return;
  if (d.done) practicing.delete(s); else practicing.set(s, String(d.title || ''));
  renderLobby();
});
socket.on('players', (p) => {
  const here = new Set((p && p.players ? p.players : []).map((x) => Number(x.slot)));
  for (const s of [...practicing.keys()]) if (!here.has(s)) practicing.delete(s);
});
let readyNow = new Set();
socket.on('ready_state', (st) => { readyNow = new Set(st && Array.isArray(st.ready) ? st.ready : []); renderLobby(); });
function applyDifficulty() {
  if (game.phase === 'playing') return;
  diff = settings.difficulty();
  D = DIFF[diff] || DIFF.easy;
}
const framesSetting = () => (String(settings.get('frames')) === '10' ? 10 : 5);
const bumpersSetting = () => Boolean(settings.get('bumpers'));

// ================================================================
// 선수·상태
// ================================================================
const roster = new Map();
const game = {
  phase: 'lobby', stage: 'lobby', stageT: 0, frames: 5, players: [], turn: 0, frameNo: 0, pending: [],
  sim: null, tp: 0, evIdx: 0, throwP: null, throwInfo: null, results: [], diff: 'easy', bumpers: false, aimDeadline: 0, demo: false, last: null, timeScale: 1, slowUntil: 0,
  fresh: true, lastBall: null
};
function ensureP(slot) {
  let P = roster.get(slot);
  if (!P) {
    const info = SLOT_INFO[slot] || { name: `${slot}P`, color: '#ffffff' };
    P = { slot, name: info.name, color: info.color, present: false, connected: false, bot: false, calibrated: false, play: false, rolls: [], startFrame: 0, pins: Array(10).fill(true), aimX: 0, auto: false, botSkill: 0.8 };
    roster.set(slot, P);
  }
  return P;
}
const lobbyList = () => [...roster.values()].filter((p) => p.present).sort((a, b) => a.slot - b.slot);
const curP = () => game.players[game.turn] || null;
const framesOf = (P) => Math.max(1, game.frames - P.startFrame);
const sheetOf = (P) => scoreGame(P.rolls, framesOf(P));

function syncRoster() {
  const seen = new Set();
  for (const sp of serverPlayers) {
    if (sp.slot > MAX_PLAYERS) continue;
    const P = ensureP(sp.slot);
    const newcomer = !P.present || P.bot;
    P.present = true; P.bot = false; P.connected = Boolean(sp.connected);
    P.name = sp.name || P.name; P.color = sp.color || P.color;
    if (newcomer && sp.connected && game.phase === 'playing' && !P.play && !game.pending.includes(P)) {
      game.pending.push(P);
      toast(t('{name} 님은 다음 프레임부터 같이 해요', { name: P.name }));
    }
    seen.add(sp.slot);
  }
  let need = BOTS;
  for (let s = MAX_PLAYERS; s >= 1 && need > 0; s--) { // 봇은 뒤 번호부터(폰이 앞 번호를 받으니 겹치지 않게)
    if (seen.has(s)) continue;
    const P = ensureP(s);
    P.present = true; P.bot = true; P.connected = true; P.botSkill = 0.75 + (s % 3) * 0.08;
    seen.add(s); need -= 1;
  }
  for (const P of roster.values()) {
    if (!seen.has(P.slot)) {
      P.present = false; P.connected = false; P.bot = false; P.calibrated = false;
      if (P.play && game.phase === 'playing') P.auto = true; // 나간 자리는 자동으로 이어 감
      game.pending = game.pending.filter((x) => x !== P);
    }
  }
  if (game.phase === 'playing') for (const P of game.players) if (!P.bot) P.auto = !P.connected;
}

// ================================================================
// 폰 입력
// ================================================================
function onAim(d) {
  if (!d) return;
  const P = roster.get(Number(d.slot));
  if (!P) return;
  P.aimX = clamp(Number(d.x) || 0, -1, 1);
  P.calibrated = true;
}
function onThrow(d) {
  if (!d) return;
  const P = roster.get(Number(d.slot));
  if (!P) return;
  if (game.phase !== 'playing' || game.stage !== 'aim' || curP() !== P) {
    // 내 차례가 아니에요: 폰에 알려 줍니다.
    if (game.phase === 'playing') send('cue', { text: '아직 내 차례가 아니에요', kind: 'wait' }, P.slot);
    return;
  }
  if (typeof d.x === 'number') P.aimX = clamp(d.x, -1, 1);
  throwBall(P, d);
}

// 폰이 보낸 휘두름 → 물리 입력. speed(km/h), dir(도, +오른쪽), spin(-1..1, +오른쪽으로 휨), quality(0..1)
function standingTargetX(P, spin) {
  const alive = P.pins.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
  if (alive.length === 10 || !alive.length) return pocketX(spin);
  // 남은 핀 중 가장 앞(헤드 쪽)이고 가운데에 가까운 핀을 겨눔
  let best = alive[0];
  for (const i of alive) if (PIN_SPOTS[i].y < PIN_SPOTS[best].y - 0.01 || (Math.abs(PIN_SPOTS[i].y - PIN_SPOTS[best].y) < 0.01 && Math.abs(PIN_SPOTS[i].x) < Math.abs(PIN_SPOTS[best].x))) best = i;
  return PIN_SPOTS[best].x;
}
function buildThrow(P, d, rng) {
  const speed = clamp((Number(d.speed) || 24) / 3.6, Math.max(SPEED_MIN, D.minSpeed), SPEED_MAX);
  const x0 = clamp(P.aimX, -1, 1) * AIM_RANGE_X;
  const spin = D.assist > 0 ? EASY_HOOK : clamp((Number(d.spin) || 0) * D.spin, -1, 1);
  const q = clamp(Number(d.quality ?? 0.7), 0, 1);
  const raw = (clamp(Number(d.dir) || 0, -25, 25) * D.dirScale) / 57.2958;
  const noise = (gauss(rng) * D.noise * (1.25 - q * 0.6)) / 57.2958;
  let angle = raw + noise;
  if (D.assist > 0) {
    const tx = standingTargetX(P, spin);
    const ideal = solveAngle(x0, speed, spin, tx);
    angle = lerp(angle, ideal, D.assist) ;
    angle += noise * 0.2 * 0; // 보정이 있으면 흔들림은 이미 줄임
  }
  return { x: x0, angle, speed, spin, bumpers: game.bumpers };
}

// 봇·자동 투구: 포켓 또는 남은 핀을 노리고 솜씨(skill)만큼 흔들림
function botInput(P) {
  const rng = Math.random;
  const skill = P.auto && !P.bot ? 0.5 : P.botSkill;
  const spinDir = rng() < 0.75 ? -1 : 1;
  const spin = spinDir * (0.18 + rng() * 0.5);
  const speed = 22 + rng() * 9;
  const x = (rng() - 0.5) * 0.5;
  const tx = standingTargetX(P, spin) + gauss(rng) * 0.075 * (1.7 - skill);
  const need = P.pins.every(Boolean) ? spin : spin * 0.25;
  const sp = clamp(speed / 3.6, SPEED_MIN, SPEED_MAX);
  const angle = solveAngle(x * AIM_RANGE_X / 0.25, sp, need, tx);
  const wild = rng() < (P.auto && !P.bot ? 0.22 : 0.07);
  const out = { x, ang: angle + (wild ? (rng() - 0.5) * 0.06 : 0), speed: sp, spin: need };
  return out;
}

// ================================================================
// 던지기·재생
// ================================================================
function throwBall(P, input, opts = {}) {
  const rng = makeRng((Math.random() * 1e9) >>> 0);
  let th;
  if (opts.raw) th = { x: opts.raw.x, angle: opts.raw.ang, speed: opts.raw.speed, spin: opts.raw.spin, bumpers: game.bumpers };
  else th = buildThrow(P, input, rng);
  if (opts.raw) P.aimX = clamp(th.x / AIM_RANGE_X, -1, 1);
  th.x = clamp(th.x, -0.43, 0.43);
  const sim = simulate({ ...th, standing: P.pins, rng });
  game.sim = sim; game.tp = 0; game.evIdx = 0; game.throwP = P;
  game.throwInfo = { th, kmh: Math.round(th.speed * 3.6 * 10) / 10, hook: hookInfo(th, sim) };
  game.fired = {};
  setStage('roll');
  audio();
  sfx.drop(); sfx.rollStart();
  view.setGuide(null);
  view.setMarkerVisible(false);
  view.setShot('follow', { ballX: th.x, ballZ: 0 });
  view.cut();
  showReadout(game.throwInfo);
  view.shake(0.12);
  send('cue', { text: `${game.throwInfo.kmh} km/h`, kind: 'throw' }, P.slot);
}
function hookInfo(th, sim) {
  // 직진했다면 닿았을 x 와 실제로 닿은 x 의 차이(훅 크기, 부호로 방향)
  const straight = th.x + Math.tan(th.angle) * C.HEAD_Y;
  const end = rollPath(th.x, th.angle, th.speed, th.spin, { bumpers: th.bumpers }).x;
  return { dx: end - straight, speed01: clamp((th.speed - 4) / 6, 0, 1), sim };
}
function showReadout(info) {
  $('roSpeed').textContent = info.kmh.toFixed(1);
  const h = info.hook.dx;
  const a = Math.abs(h);
  $('roHook').textContent = a < 0.04 ? t('직진') : `${h < 0 ? '◀' : '▶'} ${a.toFixed(2)}m`;
  $('readout').classList.add('on');
}

function setStage(s) {
  game.stage = s;
  game.stageT = 0;
  pushState(true);
}

// ---------- 차례 ----------
function beginTurn(P) {
  game.turn = game.players.indexOf(P);
  const nb = nextBall(P.rolls, framesOf(P));
  if (nb.over) return nextTurn();
  // 새 프레임이거나 열 개가 다 서야 하는 공이면 핀을 새로 세움
  if (nb.standing === 10) P.pins = Array(10).fill(true);
  game.fresh = nb.standing === 10;
  P.auto = !P.bot && !P.connected;
  view.setStand(P.aimX * AIM_RANGE_X, P.color);
  view.setMarkerVisible(true);
  view.ballAtLine(P.aimX * AIM_RANGE_X, P.color);
  view.setShot('aim');
  game.standX = P.aimX * AIM_RANGE_X;
  game.aimDeadline = TURN_TIMEOUT_S;
  game.warned = false;
  game.botAt = P.bot || P.auto ? 1.4 + Math.random() * 1.2 : 0;
  game.last = null;
  $('readout').classList.remove('on');
  setStage('aim');
  sfx.turn();
  send('turn', { slot: P.slot, frame: P.startFrame + nb.frame + 1, frames: game.frames, ball: nb.ball + 1, standing: P.pins, left: P.pins.filter(Boolean).length, x: P.aimX }, P.slot);
  sendHaptic(socket, P.slot, 'good', 0.8);
  send('cue', { text: '내 차례예요!', kind: 'turn' }, P.slot);
  renderHud();
  guideUpdate(true);
}
function nextTurn() {
  // 지금 사람이 같은 프레임을 이어서 던져야 하면 그대로
  const P = curP();
  if (P) {
    const nb = nextBall(P.rolls, framesOf(P));
    if (!nb.over && game.lastFrame === nb.frame && game.lastP === P) return beginTurn(P);
  }
  const n = game.players.length;
  for (let k = 1; k <= n; k++) {
    const idx = (game.turn + k) % n;
    const wrapped = game.turn + k >= n;
    if (wrapped && k > 0 && (game.turn + k) % n <= game.turn) onWrap();
    const Q = game.players[idx];
    const nb = nextBall(Q.rolls, framesOf(Q));
    if (!nb.over) { game.turn = idx; return beginTurn(Q); }
  }
  // 다 끝남(새로 들어온 사람이 있으면 이어 감)
  if (game.players.every((p) => nextBall(p.rolls, framesOf(p)).over)) return finishMatch();
}
let wrapGuard = -1;
function onWrap() {
  // 한 바퀴: 프레임 번호를 올리고 기다리던 사람을 넣습니다.
  const done = Math.min(...game.players.map((p) => p.startFrame + sheetOf(p).frames.filter((f) => f.done).length));
  if (wrapGuard === done) return;
  wrapGuard = done;
  game.frameNo = done;
  if (!game.pending.length) return;
  const joined = [];
  for (const P of game.pending) {
    if (!P.present || game.frameNo >= game.frames) continue;
    Object.assign(P, { play: true, rolls: [], startFrame: game.frameNo, pins: Array(10).fill(true), auto: false });
    game.players.push(P); joined.push(P.name);
  }
  game.pending = [];
  game.players.sort((a, b) => a.slot - b.slot);
  if (joined.length) toast(t('{name} 님이 이번 프레임부터 들어왔어요', { name: joined.join('·') }));
  renderHud();
}

// ---------- 굴림 진행 ----------
function updateRoll(dt) {
  const sim = game.sim;
  const P = game.throwP;
  // 슬로모: 스트라이크가 날 것 같은 충돌 직전 ~ 직후
  const t0 = sim.firstContactT;
  let target = 1;
  if (!game.demo && t0 != null && sim.count >= 9 && game.tp > t0 - 0.12 && game.tp < t0 + 1.25) target = SLOW_SCALE;
  game.timeScale += (target - game.timeScale) * (1 - Math.exp(-dt * 10));
  game.tp += dt * game.timeScale;
  // 소리·진동 이벤트
  while (game.evIdx < sim.events.length && sim.events[game.evIdx].t <= game.tp) {
    const e = sim.events[game.evIdx++];
    onSimEvent(e, sim, P);
  }
  const pos = view.applyFrame(sim, game.tp, dt * game.timeScale);
  view.cam.ballX = pos.x; view.cam.ballZ = -pos.y;
  sfx.rollUpdate(clamp(game.throwInfo.hook.speed01 * 0.8 + 0.2, 0, 1), sim.ballState === 'gutter');
  // 카메라: 핀 가까이 오면 핀 카메라로
  if (!game.pinCam && sim.firstContactT != null && game.tp > sim.firstContactT - 0.45) {
    game.pinCam = true;
    view.setShot('pins', { side: pos.x > 0 ? -1 : 1 });
    view.cut();
  }
  if (!game.pinCam && pos.y > C.HEAD_Y - 3.4 && sim.firstContactT == null) { view.setShot('pins2', { side: 1 }); game.pinCam = true; }
  if (game.tp >= sim.duration - 0.05) finishRoll();
}
function onSimEvent(e, sim, P) {
  if (e.kind === 'ball-pin') {
    if (!game.fired.contact) {
      game.fired.contact = true;
      sfx.rollStop();
      sfx.crash(clamp(0.45 + sim.count / 14, 0, 1), sim.count);
      view.shake(0.5 + sim.count * 0.05);
      flash();
      if (!game.demo && P) sendHaptic(socket, P.slot, 'strong', 0.55 + sim.count * 0.045);
    }
  } else if (e.kind === 'pin-pin' || e.kind === 'pin-ball') {
    sfx.clack(e.power);
  } else if (e.kind === 'pin-nudge') {
    sfx.clack(e.power * 0.5);
  } else if (e.kind === 'gutter') {
    sfx.gutter();
  } else if (e.kind === 'pit') {
    if (!game.fired.pit) { game.fired.pit = true; sfx.pit(); }
  } else if (e.kind === 'pin-wall') {
    sfx.clack(0.4);
  } else if (e.kind === 'bumper') {
    sfx.clack(0.2, { bumper: true });
  }
}
function finishRoll() {
  const sim = game.sim;
  const P = game.throwP;
  sfx.rollStop();
  game.pinCam = false;
  game.timeScale = 1;
  const wasStanding = P.pins.slice();
  const left = wasStanding.filter(Boolean).length;
  const count = sim.count;
  P.pins = wasStanding.map((s, i) => s && !sim.down[i]);
  const guttered = sim.ballState === 'gutter' || (count === 0 && Math.abs(sim.endX) > C.HALF);
  if (!game.demo) {
    P.rolls = [...P.rolls, count];
  }
  const nb = game.demo ? { over: true } : nextBall(P.rolls, framesOf(P));
  const nbBefore = game.demo ? null : null; void nbBefore;
  const sheet = game.demo ? null : sheetOf(P);
  const streak = game.demo ? 0 : strikeStreak(P.rolls, framesOf(P));
  let kind = 'open', title = t('{n}핀', { n: count }), sub = count === 0 ? t('아쉬워요') : P.pins.some(Boolean) ? t('{n}핀 남았어요', { n: P.pins.filter(Boolean).length }) : '';
  if (count === left && left > 0) {
    if (left === 10) kind = 'strike'; else kind = 'spare';
  }
  if (kind === 'strike') {
    title = 'STRIKE!'; sub = t('{name} · 열 핀 모두 쓰러뜨렸어요', { name: P.name });
    if (streak === 2) sub = t('더블! 스트라이크 2연속');
    if (streak === 3) { kind = 'turkey'; title = 'TURKEY!'; sub = t('터키! 스트라이크 3연속'); }
    if (streak > 3) { kind = 'turkey'; title = `${streak} STRIKES`; sub = t('{n}연속 스트라이크, 대단해요!', { n: streak }); }
  } else if (kind === 'spare') {
    title = 'SPARE!'; sub = t('남은 {n}핀을 정리했어요', { n: left });
  } else if (guttered && count === 0) { kind = 'gutter'; title = 'GUTTER'; sub = t('거터예요…'); }
  else if (left === 10 && isSplit(P.pins)) { kind = 'split'; title = 'SPLIT!'; sub = t('{n}핀이 떨어져 남았어요', { n: P.pins.filter(Boolean).length }); }
  game.lastBall = { slot: P.slot, count, kind, left, streak, frame: P.startFrame + (game.demo ? 0 : 0) };
  game.last = { kind, count };
  game.lastP = P;
  game.lastFrame = (() => { const s = game.demo ? null : scoreGame(P.rolls.slice(0, -1), framesOf(P)).current; return s ? s.frame : null; })();
  // 결과 연출
  const cls = kind === 'strike' ? 'strike' : kind === 'turkey' ? 'turkey' : kind === 'spare' ? 'spare' : kind === 'gutter' ? 'bad' : kind === 'split' ? 'split' : '';
  if (!game.demo) {
    showBanner(title, sub, cls);
    if (kind === 'strike') { sfx.strike(); flash(); } else if (kind === 'turkey') sfx.turkey(); else if (kind === 'spare') sfx.spare();
    else if (kind === 'gutter') sfx.groan(); else if (count >= 7) sfx.cheer(1);
    const hk = kind === 'strike' || kind === 'turkey' ? 'perfect' : kind === 'spare' ? 'great' : kind === 'gutter' ? 'miss' : count >= 7 ? 'good' : 'bump';
    if (hk !== 'bump') sendHaptic(socket, P.slot, hk, 1);
    send('cue', { text: kind === 'open' ? `${count}핀` : title, kind }, P.slot); // 폰이 자기 언어로 번역하도록 한국어 원문을 보냄
    if (kind === 'strike' || kind === 'turkey' || kind === 'spare') view.setShot('celebrate');
    else view.setShot('pins2', { side: 1 });
    void sheet; void nb;
  } else view.setShot('pins2', { side: 1 });
  setStage('result');
  renderHud();
}

// ---------- 결과 → 쓸기 → 다음 ----------
function startSweep() {
  const P = game.throwP;
  game.rest = P.pins.slice();
  const nb = game.demo ? { over: true, standing: 10 } : nextBall(P.rolls, framesOf(P));
  const sameFrame = !nb.over && nb.standing < 10 ? true : (!nb.over && game.lastFrame === nb.frame);
  game.clearAll = !(sameFrame && P.pins.some(Boolean)) ;
  if (game.clearAll) game.rest = Array(10).fill(false);
  sfx.sweep();
  setStage('sweep');
  view.setShot('pins2', { side: 1 });
}
function updateSweep(dt) {
  view.sweepAt(game.stageT, game.sim, game.rest);
  if (game.stageT >= SWEEP_S) {
    view.resetSweep();
    if (game.clearAll) { setStage('rack'); sfx.rack(); } else { endBallCycle(); }
  }
}
function updateRack() {
  const t = game.stageT / RACK_S;
  view.rackDrop(t);
  if (t >= 1) endBallCycle();
}
function endBallCycle() {
  const P = game.throwP;
  if (game.demo) { game.demo = false; view.setStanding(Array(10).fill(true)); game.sim = null; game.stage = 'lobby'; game.demoT = 0; return; }
  // 다음에 던질 핀 상태를 화면에 맞춤
  if (game.clearAll) P.pins = Array(10).fill(true);
  view.setStanding(P.pins);
  view.ball.visible = false;
  nextTurn();
}
function finishMatch() {
  setStage('end');
  view.setShot('celebrate');
  setTimeout(() => { if (game.stage === 'end') showResults(); }, 1800 / FAST);
}

// ================================================================
// 판 시작·끝
// ================================================================
function startGame() {
  if (game.phase === 'playing') return;
  const list = lobbyList().filter((p) => p.connected);
  if (!list.length) { toast(t('폰을 먼저 연결해 주세요. QR을 찍고 준비를 누르면 자리가 생겨요.')); return; }
  audio();
  sfx.ambience(true); // 레인 주변 소리 바탕
  applyDifficulty();
  settings.lock(true);
  for (const b of boards) b.hide(true);
  game.frames = framesSetting();
  game.bumpers = bumpersSetting();
  game.diff = diff;
  game.players = list.slice(0, MAX_PLAYERS);
  for (const P of roster.values()) {
    P.play = game.players.includes(P);
    P.rolls = []; P.startFrame = 0; P.pins = Array(10).fill(true); P.auto = false;
  }
  game.pending = [];
  game.frameNo = 0; wrapGuard = -1;
  game.phase = 'playing';
  game.turn = 0;
  game.demo = false; game.results = []; game.lastP = null; game.lastFrame = null;
  $('lobby').classList.add('hidden');
  $('over').classList.add('hidden');
  $('hud').classList.remove('hidden');
  view.setStanding(Array(10).fill(true));
  view.resetSweep();
  view.setShot('aim');
  const first = game.players[0];
  view.setStand(first.aimX * AIM_RANGE_X, first.color);
  showBanner('BOWL NIGHT', [t('{n}프레임', { n: game.frames }), t(DIFF_LABEL[diff] || '보통'), game.bumpers ? t('범퍼') : ''].filter(Boolean).join(' · '), 'intro');
  setStage('intro');
  renderHud();
}
function showResults() {
  game.phase = 'over';
  game.stage = 'over';
  const rows = game.players.map((P) => ({ P, sheet: sheetOf(P), strikes: 0, spares: 0 }));
  for (const r of rows) {
    for (const f of r.sheet.frames) for (const m of f.marks) { if (m === 'X') r.strikes += 1; else if (m === '/') r.spares += 1; }
  }
  rows.sort((a, b) => b.sheet.total - a.sheet.total);
  const box = $('podium');
  box.innerHTML = '';
  $('overEyebrow').textContent = `FINAL · ${game.frames}FRAMES`;
  $('diffOver').textContent = t(DIFF_LABEL[game.diff] || '보통');
  $('diffOver').dataset.d = game.diff;
  $('overTitle').textContent = rows.length > 1 ? t('{name} 우승!', { name: rows[0].P.name }) : t('경기 결과');
  let rank = 0, prev = null, shown = 0;
  rows.forEach((r) => {
    shown += 1;
    if (r.sheet.total !== prev) rank = shown;
    prev = r.sheet.total;
    r.rank = rank;
    const e = el('div', 'r');
    e.style.setProperty('--c', r.P.color);
    e.style.animationDelay = `${0.1 + (shown - 1) * 0.08}s`;
    e.innerHTML = `<span class="rank">${rank}</span><span class="who">${r.P.name}${r.P.bot ? '<small>BOT</small>' : ''}</span>` +
      `<span class="num"><b>${r.strikes}</b><span>스트라이크</span></span><span class="num"><b>${r.spares}</b><span>스페어</span></span>` +
      `<span class="num"><b>${r.P.rolls.filter((n) => n === 0).length}</b><span>무득점 공</span></span><span class="num big"><b>${r.sheet.total}</b><span>점수</span></span>`;
    box.appendChild(e);
    if (!r.P.bot) {
      send('result', { text: `${rank}위 · ${r.sheet.total}점`, rank, of: rows.length, score: r.sheet.total, strikes: r.strikes, spares: r.spares }, r.P.slot);
      sendHaptic(socket, r.P.slot, rank === 1 ? 'perfect' : 'good', 1);
    }
  });
  game.results = rows.map((r) => ({ slot: r.P.slot, rank: r.rank, score: r.sheet.total }));
  settings.lock(false);
  for (const b of boards) b.hide(false);
  renderLobby();
  $('over').classList.remove('hidden');
  $('hud').classList.add('hidden');
  $('banner').classList.remove('on');
  view.setShot('hero');
  sfx.ambience(false);
  sfx.fanfare();
  pushState(true);
}
function backToLobby(why) {
  sfx.ambience(false); sfx.rollStop();
  for (const P of roster.values()) P.play = false;
  game.phase = 'lobby'; game.stage = 'lobby'; game.players = []; game.pending = [];
  settings.lock(false);
  for (const b of boards) b.hide(false);
  $('lobby').classList.remove('hidden');
  $('over').classList.add('hidden');
  $('hud').classList.add('hidden');
  view.setShot('hero'); view.setStanding(Array(10).fill(true)); view.resetSweep();
  view.setMarkerVisible(false); view.ball.visible = false; view.setGuide(null);
  if (why) toast(why);
  pushState(true);
}

// ================================================================
// HUD
// ================================================================
let toastT = null;
function toast(t) {
  const m = $('msg');
  m.textContent = t;
  m.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => m.classList.remove('on'), 3400);
}
let bannerT = null;
function showBanner(t, s, cls = '') {
  const b = $('banner');
  b.className = `banner ${cls}`;
  b.querySelector('b').textContent = t;
  b.querySelector('span').textContent = s || '';
  void b.offsetWidth;
  b.classList.add('on');
  clearTimeout(bannerT);
  bannerT = setTimeout(() => b.classList.remove('on'), cls === 'intro' ? 2400 : 2300);
}
function flash() { const f = $('flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }

const PIN_UI = (() => {
  const pts = [];
  for (let row = 0; row < 4; row++) for (let k = 0; k <= row; k++) pts.push([37 + (k - row / 2) * 17, 8 + row * 15]);
  return pts;
})();
function drawPinmap(P) {
  const box = $('pinmap');
  if (!box.childElementCount) PIN_UI.forEach(([x, y]) => { const i = document.createElement('i'); i.style.left = `${x}px`; i.style.top = `${y}px`; box.appendChild(i); });
  [...box.children].forEach((i, k) => i.classList.toggle('off', !(P && P.pins[k])));
}
function renderHud() {
  if (game.phase !== 'playing') return;
  const P = game.stage === 'roll' || game.stage === 'result' || game.stage === 'sweep' || game.stage === 'rack' ? game.throwP || curP() : curP();
  if (P) {
    const nb = nextBall(P.rolls, framesOf(P));
    const shownFrame = P.startFrame + Math.min(nb.frame, framesOf(P) - 1) + 1;
    let ballNo = nb.over ? t('끝') : t('{n}번째 공', { n: nb.ball + 1 });
    if (game.stage === 'result' || game.stage === 'sweep' || game.stage === 'rack') ballNo = t('방금 굴린 공');
    $('hud').style.setProperty('--c', P.color);
    $('turnTag').textContent = P.name;
    $('turnName').textContent = P.bot ? `${P.name} BOT` : P.auto ? t('{name} 자동', { name: P.name }) : P.name;
    $('turnSub').textContent = t('프레임 {f} / {n} · {b}', { f: shownFrame, n: game.frames, b: ballNo });
    drawPinmap(P);
  }
  $('diffTag').textContent = t(DIFF_LABEL[game.diff] || '보통');
  $('diffTag').dataset.d = game.diff;
  renderSheets();
  drawMonitor();
}
function marksHtml(fr, last) {
  const slots = last ? 3 : 2;
  let h = '';
  for (let i = 0; i < slots; i++) {
    const m = fr.marks[i];
    const cls = m === 'X' ? 'x' : m === '/' ? 'sp' : '';
    // 마지막이 아닌 프레임에서 스트라이크는 둘째 칸에 표시
    h += `<i class="${cls}">${m ?? ''}</i>`;
  }
  return h;
}
function renderSheets() {
  const box = $('sheets');
  const n = game.frames;
  box.className = `sheets${n > 6 ? ' dense' : ''}${game.players.length > 2 ? ' many' : ''}`;
  const cur = curP();
  const activeP = game.stage === 'roll' || game.stage === 'result' || game.stage === 'sweep' || game.stage === 'rack' ? game.throwP : cur;
  box.innerHTML = '';
  for (const P of game.players) {
    const sh = sheetOf(P);
    const row = el('div', `srow${P === activeP ? ' cur' : ''}`);
    row.style.setProperty('--c', P.color);
    const strikes = sh.frames.reduce((a, f) => a + f.marks.filter((m) => m === 'X').length, 0);
    row.appendChild(el('div', 'who', `<b>${P.name}${P.bot ? ' BOT' : ''}</b><small>${strikes ? `X ${strikes}` : P.auto ? t('자동') : ''}</small>`));
    for (let f = 0; f < n; f++) {
      const rel = f - P.startFrame;
      if (rel < 0) { row.appendChild(el('div', 'fr skip', `<span class="no">${f + 1}</span><div class="mk"></div><div class="sc">–</div>`)); continue; }
      const fr = sh.frames[rel];
      const last = rel === framesOf(P) - 1;
      const now = P === activeP && sh.current && sh.current.frame === rel;
      // 스트라이크(마지막 프레임 제외)는 둘째 칸에 X 가 오도록 한 칸 비움
      let mk = fr.marks.slice();
      if (!last && mk[0] === 'X') mk = ['', 'X'];
      const frx = { marks: mk };
      row.appendChild(el('div', `fr${now ? ' now' : ''}`, `<span class="no">${f + 1}</span><div class="mk">${marksHtml(frx, last)}</div><div class="sc">${fr.total ?? ''}</div>`));
    }
    row.appendChild(el('div', 'tot', `<b>${sh.total}</b>`));
    box.appendChild(row);
  }
}
function drawMonitor() {
  const rows = game.players.map((P) => {
    const sh = sheetOf(P);
    const marks = sh.frames.filter((f) => f.marks.length).slice(-4).map((f) => f.marks.join('')).join(' ');
    return { name: P.name, color: P.color, score: sh.total, marks, active: P === curP() };
  });
  view.drawMonitor(rows, { title: 'STRIKE CLUB', right: game.phase === 'playing' ? `${game.frames}F` : '' });
}

// ---------- 대기실 ----------
const slotEls = [];
function renderLobby() {
  const box = $('slots');
  if (!slotEls.length) {
    for (let s = 1; s <= MAX_PLAYERS; s++) {
      const d = el('div', 'slot', `<b>${SLOT_INFO[s].name}</b><small>비어 있음</small>`);
      d.style.setProperty('--c', SLOT_INFO[s].color);
      box.appendChild(d);
      slotEls.push({ d, sm: d.querySelector('small') });
    }
  }
  const list = lobbyList();
  for (let s = 1; s <= MAX_PLAYERS; s++) {
    const { d, sm } = slotEls[s - 1];
    const P = list.find((p) => p.slot === s);
    let txt = '비어 있음';
    if (P) {
      if (P.bot) txt = 'BOT';
      else if (practicing.has(s)) txt = '연습 중';
      else if (readyNow.has(s)) txt = '준비 완료';
      else if (P.calibrated) txt = '자리 잡음';
      else txt = '연결됨';
    }
    d.classList.toggle('on', Boolean(P));
    d.classList.toggle('away', Boolean(P && !P.connected));
    d.classList.toggle('cal', Boolean(P && (P.calibrated || P.bot)));
    d.classList.toggle('rdy', Boolean(P && !P.bot && readyNow.has(s)));
    d.classList.toggle('prac', Boolean(P && !P.bot && practicing.has(s)));
    if (sm.textContent !== txt) sm.textContent = txt;
  }
}

// ================================================================
// 폰에 상태 보내기
// ================================================================
let lastPush = 0, pushTimer = null;
function buildState() {
  const players = {};
  for (const P of game.players) {
    const sh = sheetOf(P);
    players[P.slot] = { name: P.name, total: sh.total, rolls: P.rolls.length, startFrame: P.startFrame, marks: sh.frames.map((f) => f.marks.join('')), pins: P.pins };
  }
  for (const P of game.pending) players[P.slot] = { name: P.name, pending: true };
  const cur = curP();
  const nb = cur && game.phase === 'playing' ? nextBall(cur.rolls, framesOf(cur)) : null;
  return {
    phase: game.phase, stage: game.stage, frames: game.frames, diff: game.diff, bumpers: game.bumpers,
    turn: cur && game.phase === 'playing' ? { slot: cur.slot, frame: cur.startFrame + (nb ? nb.frame : 0) + 1, ball: nb ? nb.ball + 1 : 1, left: cur.pins.filter(Boolean).length, pins: cur.pins } : null,
    players, order: game.players.map((p) => p.slot), results: game.results, code: roomCode,
    settings: settings.forState()
  };
}
function pushState(force) {
  const now = performance.now();
  if (!force && now - lastPush < 250) {
    if (!pushTimer) pushTimer = setTimeout(() => { pushTimer = null; pushState(true); }, 260);
    return;
  }
  clearTimeout(pushTimer); pushTimer = null; lastPush = now;
  send('game_state', buildState());
}

// ================================================================
// 안내선(쉬움)
// ================================================================
let guideX = null;
function guideUpdate(force) {
  const P = curP();
  if (!P || game.stage !== 'aim') return;
  if (!D.guide) { view.setGuide(null); return; }
  const x0 = P.aimX * AIM_RANGE_X;
  if (!force && guideX !== null && Math.abs(guideX - x0) < 0.004) return;
  guideX = x0;
  const sp = 7.4;
  const tx = standingTargetX(P, 0);
  const ang = solveAngle(x0, sp, 0, tx);
  view.setGuide(rollPath(x0, ang, sp, 0, { bumpers: false }).pts, P.color);
}

// ================================================================
// 한 프레임
// ================================================================
let last = performance.now();
let hudT = 0;
function tick() {
  requestAnimationFrame(tick);
  const now = performance.now();
  const rdt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const dt = rdt * FAST;
  game.stageT += dt;

  if (game.phase === 'playing') {
    const P = curP();
    switch (game.stage) {
      case 'intro':
        if (game.stageT >= INTRO_S) { game.turn = game.players.length - 1; game.lastP = null; nextTurn(); }
        break;
      case 'aim': {
        // 서는 자리를 부드럽게 따라가고, 봇·자동·시간 초과는 알아서 던집니다.
        game.standX = lerp(game.standX ?? 0, P.aimX * AIM_RANGE_X, 1 - Math.exp(-rdt * 14));
        view.setStand(game.standX, P.color);
        view.ballAtLine(game.standX, P.color);
        guideUpdate();
        game.aimDeadline -= dt;
        if (!game.warned && game.aimDeadline <= WARN_S && !(P.bot || P.auto)) { game.warned = true; send('cue', { text: '곧 자동으로 굴러가요', kind: 'aim_warn' }, P.slot); }
        if ((P.bot || P.auto) && game.stageT >= game.botAt) { const r = botInput(P); throwBall(P, {}, { raw: r }); }
        else if (game.aimDeadline <= 0) {
          const r = { x: game.standX, ang: solveAngle(game.standX, 6.4, 0, standingTargetX(P, 0)) + (Math.random() - 0.5) * 0.02, speed: 6.4, spin: 0 };
          toast(t('{name} 님 시간 초과: 자동으로 굴려요', { name: P.name }));
          throwBall(P, {}, { raw: r });
        }
        break;
      }
      case 'roll': updateRoll(dt); break;
      case 'result': if (game.stageT >= RESULT_S) startSweep(); break;
      case 'sweep': updateSweep(dt); break;
      case 'rack': updateRack(); break;
      default: break;
    }
  } else if (game.phase === 'lobby') {
    // 대기실 배경: 가끔 시범 굴림
    game.demoT = (game.demoT || 0) + dt;
    if (game.stage === 'lobby' && game.demoT > 6) startDemo();
    else if (game.demo) {
      if (game.stage === 'roll') updateRoll(dt);
      else if (game.stage === 'result' && game.stageT >= 1.2) startSweep();
      else if (game.stage === 'sweep') updateSweep(dt);
      else if (game.stage === 'rack') updateRack();
    }
  }
  view.update(rdt);
  view.updateCamera(rdt);
  view.render();
  hudT += rdt;
  if (hudT > 0.5) { hudT = 0; if (game.phase === 'playing') pushStateSlow(); }
}
let slowPush = 0;
function pushStateSlow() { slowPush += 1; if (slowPush % 2 === 0) pushState(); }

// 대기실 시범 굴림(점수 없음)
function startDemo() {
  game.demo = true;
  const P = { slot: 0, name: 'demo', color: '#ffffff', pins: Array(10).fill(true), rolls: [], startFrame: 0 };
  const rng = Math.random;
  const spin = -(0.25 + rng() * 0.4);
  const speed = 6.8 + rng() * 1.6;
  const x = (rng() - 0.5) * 0.3;
  const ang = solveAngle(x, speed, spin, 0.05 + (rng() - 0.5) * 0.06);
  view.setStanding(P.pins);
  view.ballAtLine(x, '#ffffff');
  game.throwP = P;
  game.stage = 'demo';
  throwBall(P, {}, { raw: { x, ang, speed, spin } });
  game.demo = true;
  view.setShot('hero');
  view.setMarkerVisible(false);
  $('readout').classList.remove('on');
}

// ---------- 키보드 ----------
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (game.phase !== 'playing') startGame();
    return;
  }
  if (game.phase === 'playing' && game.stage === 'aim' && e.code === 'Space') {
    // 키보드 시험: 사람 1P 대신 던짐
    e.preventDefault();
    const P = curP();
    if (P && !P.bot) throwBall(P, { speed: 26, dir: 0, spin: -0.4, quality: 0.8 });
  }
});

// ================================================================
// 시작
// ================================================================
applyDifficulty();
syncRoster();
renderLobby();
view.setShot('hero');
view.setStanding(Array(10).fill(true));
view.cut();
drawMonitor();
view.drawMonitor([{ name: 'BOWL', color: '#ffb13c', score: 0, marks: '', active: true }, { name: 'NIGHT', color: '#3ee6d6', score: 0, marks: '', active: false }], { title: 'STRIKE CLUB', right: '' });
requestAnimationFrame(tick);
if (AUTOSTART && (BOTS > 0)) setTimeout(() => { if (!serverPlayers.length) startGame(); }, 1500);

window.__bowling = {
  game, roster, view, settings, startGame, backToLobby, showResults, onThrow, onAim, throwBall, buildThrow, botInput, DIFF, scoreGame, sheetOf, simulate, C,
  get diff() { return diff; }, get D() { return D; },
  curP, renderHud, startDemo, socket,
  // 시험용: 지금 차례의 사람이 던진 것으로 침(센서 없이)
  testThrow(input = { speed: 26, dir: 0, spin: -0.4, quality: 0.8 }) { const P = curP(); if (P && game.stage === 'aim') throwBall(P, input); return Boolean(P); }
};
