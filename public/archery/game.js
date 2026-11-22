// 양궁 큰 화면: 1~4명이 차례로 한 발씩 쏘는 과녁 양궁. 판정(탄도·점수)은 전부 여기서 하고 서버는 중계만 합니다.
// 폰: aim(도, 중앙 기준) 계속, draw(당김 0..1) 계속, release(놓음 {x,y,pull,steady}).
// 시험: ?bots=N&autostart (폰 없이 끝까지), ?speed=N (시뮬레이션 배속), ?room=CODE (방 코드 고정), window.__archery
import * as THREE from 'three';
import { createScene, EYE, TARGET_Y } from './scene.js';
import { scoreArrow, tally, rankPlayers } from './scoring.mjs';
import {
  shoot, pathAt, initialWind, nextWind, tremble, beatIndex, diffOf, FULL_PULL, metersPerDeg, driftAt, V_FULL, launchSpeed, assistAim,
  DIFFICULTY, BREATH_WINDOW, mulberry32
} from './ballistics.mjs';
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
const rnd = (a, b) => a + Math.random() * (b - a);
// 언어 고르기: 대기실에서만 보임(바꾸면 새로 고침)
mountSwitcher($('langBox'), { reload: true, compact: true });
const BOTS = clamp(parseInt(params.get('bots'), 10) || 0, 0, 4);
const AUTOSTART = params.has('autostart');
let TS = clamp(num(params.get('speed'), 1), 0.1, 20); // 시뮬레이션 배속(시험용)

// ---------- 규칙과 조정 값 ----------
const ARROWS_PER_END = 3;
const MAX_PLAYERS = 4;
const INTRO_S = 2.6;
const RESULT_S = 2.0; // 꽂힌 뒤 클로즈업·점수 보여 주는 시간
const ENDBREAK_S = 3.4;
const SHOT_CLOCK_S = 40; // 이 시간 안에 당기지 않으면 한 발 포기
const AWAY_FORFEIT_S = 7; // 폰이 끊긴 채 이만큼 지나면 한 발 포기
const DRAW_IDLE_S = 5; // 당기는 중 폰 소식이 이만큼 없으면 취소
const MIN_PULL = 0.15; // 이보다 약하게 당기고 놓으면 쏜 것으로 치지 않음(폰 컨트롤러에도 같은 값이 있음)
const SHOT_WARN_S = 10; // 한 발 제한 시간이 이만큼 남으면 폰에 짧게 알림
const OVERHOLD_S = 8; // 만궁에서 지친 뒤 이만큼 더 버티면 자동으로 놓임
const T_FLIGHT = [0.75, 1.5]; // 비행(빠른 구간) 시간 범위(초)
const T_SLOW = 1.9; // 마지막 몇 미터 슬로모션(초)
const AIM_LIMIT = 30; // 폰 조준 한계(도)
const SLOT_INFO = {
  1: { name: '1P', color: '#ff5a5f' }, 2: { name: '2P', color: '#3ab4ff' }, 3: { name: '3P', color: '#ffc93c' }, 4: { name: '4P', color: '#5ee07a' }
};

await Promise.race([
  Promise.all([document.fonts.load('400 64px Anton'), document.fonts.load('800 64px "Pretendard Variable"')]),
  new Promise((r) => setTimeout(r, 2000))
]).catch(() => {});
const view = createScene($('cv'));

// ================================================================
// 연결
// ================================================================
const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true });
let serverPlayers = [];
let hadRoom = false;
function send(event, data, slot) {
  if (!socket.connected) return;
  socket.emit('d2c', slot != null ? { event, slot, data } : { event, data });
}
socket.on('connect', () => {
  let saved = params.get('room');
  if (!saved) { try { saved = sessionStorage.getItem('pcg-archery-room'); } catch (e) {} }
  socket.emit('join', { role: 'display', game: 'archery', room: saved });
});
socket.on('room', async (r) => {
  try { sessionStorage.setItem('pcg-archery-room', r.code); } catch (e) {}
  serverPlayers = r.players || [];
  syncRoster();
  if (r.fresh && hadRoom && game.phase !== 'lobby') backToLobby('서버가 다시 시작돼서 대기실로 돌아왔어요');
  hadRoom = true;
  $('code').textContent = r.code;
  $('codeMini').textContent = r.code;
  try {
    const res = await fetch(`/api/qr?room=${r.code}`).then((x) => x.json());
    $('qr').src = res.qr;
    $('qrMini').src = res.qr;
    $('url').textContent = res.url.replace(/^https?:\/\//, '');
    $('warn').classList.toggle('hidden', Boolean(res.secure));
  } catch (e) {}
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
socket.on('draw', (d) => onDraw(d));
socket.on('release', (d) => onRelease(d));
socket.on('calibrate', (d) => { const P = roster.get(Number(d && d.slot)); if (P) { P.calibrated = true; renderLobby(); pushState(true); } });

// ---------- 난이도 · 엔드 수 · 연습 현황 ----------
const settings = createSettings({
  game: 'archery',
  fields: [
    fields.difficulty(),
    fields.choice('ends', '엔드 수', [{ value: '3', label: '3엔드', hint: '엔드마다 3발 · 총 9발' }, { value: '5', label: '5엔드', hint: '엔드마다 3발 · 총 15발' }], { default: '3', hotkey: 'E' })
  ],
  keys: true,
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

let level = 'easy';
function applyDifficulty() {
  if (game.phase === 'playing') return;
  level = settings.difficulty();
  view.setDistance(DIFFICULTY[level].distance);
}

// ================================================================
// 상태
// ================================================================
const game = {
  phase: 'lobby', stage: 'idle', t: 0, stageT: 0, seed: 1, level: 'easy', D: 20, ends: 3, endIdx: 0,
  seq: [], seqIdx: 0, cur: null, wind: { speed: 0, dir: 0 }, windShown: { speed: 0, dir: 0 }, flight: null, results: []
};
const roster = new Map();
function newP(slot) {
  const info = SLOT_INFO[slot] || { name: `${slot}P`, color: '#fff' };
  return { slot, name: info.name, color: info.color, present: false, connected: false, bot: false, play: false, calibrated: false, ends: [], skill: 0.55 + Math.random() * 0.35 };
}
function ensureP(slot) {
  let P = roster.get(slot);
  if (!P) { P = newP(slot); roster.set(slot, P); }
  return P;
}
function syncRoster() {
  const seen = new Set();
  for (const sp of serverPlayers) {
    if (sp.slot > MAX_PLAYERS) continue;
    const P = ensureP(sp.slot);
    P.present = true; P.bot = false; P.connected = Boolean(sp.connected);
    P.name = sp.name || P.name; P.color = sp.color || P.color;
    seen.add(sp.slot);
  }
  let need = BOTS;
  for (let s = 1; s <= MAX_PLAYERS && need > 0; s++) {
    if (seen.has(s)) continue;
    const P = ensureP(s);
    P.present = true; P.bot = true; P.connected = true;
    seen.add(s);
    need -= 1;
  }
  for (const P of roster.values()) {
    if (!seen.has(P.slot)) { P.present = false; P.connected = false; P.bot = false; P.calibrated = false; }
  }
}
const lobbyList = () => [...roster.values()].filter((p) => p.present).sort((a, b) => a.slot - b.slot);
const players = () => [...roster.values()].filter((p) => p.play).sort((a, b) => a.slot - b.slot);
const flat = (P) => P.ends.flat().filter(Boolean);
const totals = (P) => tally(flat(P));

// ================================================================
// 폰 입력
// ================================================================
function onAim(d) {
  const c = game.cur;
  if (!d || !c || game.stage !== 'turn') return;
  if (Number(d.slot) !== c.slot) return;
  const x = Number(d.x), y = Number(d.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  c.aim.x = clamp(x, -AIM_LIMIT, AIM_LIMIT);
  c.aim.y = clamp(y, -AIM_LIMIT, AIM_LIMIT);
  c.lastMsgAt = game.t;
}
function onDraw(d) {
  const c = game.cur;
  if (!d || !c || game.stage !== 'turn') return;
  if (Number(d.slot) !== c.slot) return;
  const p = Number(d.pull);
  if (!Number.isFinite(p)) return;
  c.pullIn = clamp(p, 0, 1);
  c.lastMsgAt = game.t;
  if (c.state === 'wait' && c.pullIn > 0.04) { c.state = 'draw'; c.drawStart = game.t; }
}
function onRelease(d) {
  const c = game.cur;
  if (!d || !c || game.stage !== 'turn') return;
  if (Number(d.slot) !== c.slot) return;
  // draw 는 휘발성이라 빠질 수 있으니, release 의 pull 이 충분하면 당긴 것으로 인정
  const pull = clamp(Number.isFinite(Number(d.pull)) ? Number(d.pull) : c.pullIn, 0, 1);
  const x = Number.isFinite(Number(d.x)) ? clamp(Number(d.x), -AIM_LIMIT, AIM_LIMIT) : c.aim.x;
  const y = Number.isFinite(Number(d.y)) ? clamp(Number(d.y), -AIM_LIMIT, AIM_LIMIT) : c.aim.y;
  const steady = clamp(Number.isFinite(Number(d.steady)) ? Number(d.steady) : 0.7, 0, 1);
  if (c.state === 'wait' && pull < MIN_PULL) return;
  if (pull < MIN_PULL) {
    // 살짝만 당기고 놓음: 쏘지 않고 시위만 돌려보냄
    c.state = 'wait'; c.pullIn = 0; c.fullAt = null; c.lastBeat = 0;
    sfx.creakStop();
    cue(c.slot, '더 당겨야 쏠 수 있어요');
    return;
  }
  fire(roster.get(c.slot), x, y, pull, steady);
}

// ================================================================
// 경기 진행
// ================================================================
function startGame() {
  if (game.phase === 'playing') return;
  const list = lobbyList().filter((p) => p.connected);
  if (!list.length) { lobbyMessage('폰을 먼저 연결해 주세요. QR을 찍고 준비를 누르면 자리가 생겨요.'); return; }
  audio();
  sfx.bed(true);
  level = settings.difficulty();
  settings.lock(true);
  for (const b of boards) b.hide(true);
  game.level = level;
  game.D = DIFFICULTY[level].distance;
  view.state.gain = DIFFICULTY[level].gain;
  game.ends = parseInt(settings.get('ends'), 10) === 5 ? 5 : 3;
  game.seed = (Math.random() * 1e9) >>> 0;
  view.setDistance(game.D);
  view.clearStuck();
  for (const P of roster.values()) { P.play = list.includes(P); P.ends = []; }
  game.phase = 'playing';
  game.endIdx = -1;
  game.results = [];
  game.cur = null;
  game.flight = null;
  $('lobby').classList.add('hidden');
  $('over').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('distNum').textContent = String(game.D);
  $('diffTag').textContent = DIFF_LABEL[level] || '보통';
  $('diffTag').dataset.d = level;
  $('msg').classList.remove('on');
  view.state.mode = 'fp';
  beginEnd(0);
  pushState(true);
}

function beginEnd(e) {
  game.endIdx = e;
  // 중간에 들어온 사람은 이번 엔드부터 참가: 앞 엔드는 비어 있는 칸
  for (const P of lobbyList()) {
    if (!P.play && P.connected) { P.play = true; P.ends = []; }
  }
  for (const P of players()) while (P.ends.length < e + 1) P.ends.push([]);
  const list = players().filter((p) => p.present);
  game.seq = [];
  for (let r = 0; r < ARROWS_PER_END; r++) for (const P of list) game.seq.push({ slot: P.slot, arrowIdx: r });
  game.seqIdx = 0;
  game.wind = initialWind(game.seed, e, game.level);
  game.windShown = { ...game.wind };
  view.clearStuck();
  view.state.mode = 'fp';
  view.state.flight = null;
  view.state.pull = 0; view.state.lens = 0;
  game.cur = null;
  game.stage = 'intro';
  game.stageT = 0;
  banner(t('{n}엔드', { n: e + 1 }), '', INTRO_S - 0.2);
  sfx.fanfare('end');
  renderBoard();
  pushState(true);
}

function startTurn() {
  // 나간 사람은 건너뜀
  while (game.seqIdx < game.seq.length) {
    const s = game.seq[game.seqIdx];
    const P = roster.get(s.slot);
    if (P && P.present && P.play) break;
    game.seqIdx++;
  }
  if (game.seqIdx >= game.seq.length) { endOfEnd(); return; }
  const s = game.seq[game.seqIdx];
  const P = roster.get(s.slot);
  game.stage = 'turn';
  game.stageT = 0;
  game.cur = {
    slot: s.slot, arrowIdx: s.arrowIdx, state: 'wait', pull: 0, pullIn: 0, aim: { x: 0, y: 0 }, shown: { x: 0, y: 0 }, fullAt: null, lastBeat: 0,
    turnAt: game.t, lastMsgAt: game.t, drawStart: 0, awaySince: null, bot: null, hintT: 0
  };
  view.setArrowColor(P.color);
  view.state.mode = 'fp';
  view.state.flight = null;
  view.state.arrowOnBow = true;
  view.state.handVisible = true;
  view.setMarker(null);
  const ws = game.wind;
  document.documentElement.style.setProperty('--c', P.color);
  $('whoName').textContent = P.name;
  $('whoSub').textContent = P.bot ? t('(BOT) 차례') : t('차례 · {a}/{b}발', { a: s.arrowIdx + 1, b: ARROWS_PER_END });
  sfx.turn();
  send('turn', { slot: P.slot, name: P.name, color: P.color, end: game.endIdx + 1, ends: game.ends, arrow: s.arrowIdx + 1, arrows: ARROWS_PER_END, wind: ws });
  sendHaptic(socket, P.slot, 'strong', 0.6);
  renderBoard();
  pushState(true);
}

function nextTurn() {
  game.seqIdx++;
  startTurn();
}

function endOfEnd() {
  game.stage = 'endbreak';
  game.stageT = 0;
  game.cur = null;
  const rows = rankPlayers(players().map((P) => ({ slot: P.slot, ...totals(P) })));
  const lead = rows[0];
  const last = game.endIdx + 1 >= game.ends;
  banner(last ? t('경기 종료') : t('{n}엔드 종료', { n: game.endIdx + 1 }), lead ? t('{p} 선두 · {n}점', { p: roster.get(lead.slot).name, n: lead.total }) : '', ENDBREAK_S - 0.3);
  renderBoard();
  pushState(true);
}

function finishMatch() {
  game.phase = 'over';
  game.stage = 'over';
  const rows = rankPlayers(players().map((P) => ({ slot: P.slot, ...totals(P) })));
  game.results = rows;
  $('overInfo').textContent = t('{d}m · {e}엔드 · 총 {n}발', { d: game.D, e: game.ends, n: game.ends * ARROWS_PER_END });
  $('diffOver').textContent = DIFF_LABEL[game.level] || '보통';
  $('diffOver').dataset.d = game.level;
  const box = $('podium');
  box.innerHTML = '';
  rows.forEach((r, k) => {
    const P = roster.get(r.slot);
    const e = document.createElement('div');
    e.className = 'r';
    e.style.setProperty('--c', P.color);
    e.style.animationDelay = `${0.1 + k * 0.08}s`;
    const endCells = P.ends.map((a, i) => `<span><small>${t('{n}엔드', { n: i + 1 })}</small>${a.length ? a.reduce((s, x) => s + x.score, 0) : '–'}</span>`).join('');
    e.innerHTML = `<span class="rank">${r.rank}</span><span class="who">${P.name}${P.bot ? '<small>BOT</small>' : ''}</span><span class="ends">${endCells}</span>` +
      `<span class="num"><b>${r.xs}</b><span>X</span></span><span class="num"><b>${r.tens}</b><span>${t('10점')}</span></span>` +
      `<span class="num big"><b>${r.total}</b><span>${t('총점')}</span></span>`;
    box.appendChild(e);
    if (!P.bot) {
      send('result', { text: `${r.rank}위 · ${r.total}점`, rank: r.rank, of: rows.length, total: r.total, xs: r.xs, tens: r.tens, ends: P.ends.map((a) => a.reduce((s, x) => s + x.score, 0)) }, P.slot);
      sendHaptic(socket, P.slot, r.rank === 1 ? 'perfect' : 'good', 0.9);
    }
  });
  sfx.bed(false);
  sfx.fanfare();
  settings.lock(false);
  for (const b of boards) b.hide(false);
  renderLobby();
  $('over').classList.remove('hidden');
  $('hud').classList.add('hidden');
  view.state.mode = 'idle';
  view.setMarker(null);
  pushState(true);
}

function backToLobby(why) {
  sfx.bed(false);
  for (const P of roster.values()) P.play = false;
  game.phase = 'lobby';
  game.stage = 'idle';
  game.cur = null;
  game.flight = null;
  settings.lock(false);
  for (const b of boards) b.hide(false);
  applyDifficulty();
  view.clearStuck();
  view.state.mode = 'fp';
  view.state.flight = null;
  $('over').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  renderLobby();
  if (why) lobbyMessage(why);
  pushState(true);
}

// ================================================================
// 발사 · 비행 · 꽂힘
// ================================================================
function fire(P, ax, ay, pull, steady) {
  const c = game.cur;
  if (!P || !c) return;
  const holdSec = c.fullAt != null ? game.t - c.fullAt : 0;
  const tr = tremble(holdSec, game.t, game.level, P.slot);
  const dif = diffOf(game.level);
  const mpd0 = metersPerDeg(game.D, dif.gain);
  const offX = -driftAt(game.D, V_FULL, game.wind) / mpd0; // 바람 반대쪽으로 겨눈 위치(조준 도움의 기준)
  const aimX = assistAim(clamp(ax, -AIM_LIMIT, AIM_LIMIT), offX, dif.assist) + tr.x;
  const aimY = assistAim(clamp(ay, -AIM_LIMIT, AIM_LIMIT), 0, dif.assist) + tr.y;
  const seedShot = ((game.seed * 131 + game.endIdx * 17 + game.seqIdx * 7 + 1) >>> 0);
  const stead = clamp(steady * (1 - 0.35 * tr.f), 0, 1);
  const D = game.D;
  const shot = shoot({ distance: D, aimX, aimY, pull, steady: stead, wind: game.wind, seed: seedShot, gain: dif.gain, spread: dif.spread });
  const res = scoreArrow(shot.x, shot.y);
  const start = new THREE.Vector3(0, EYE.y - 0.06, -0.7);
  const pathArgs = { distance: D, aimX, aimY, pull, wind: game.wind, impact: { x: shot.x, y: shot.y }, gain: dif.gain };
  // 땅에 먼저 닿는지(덜 당겼을 때)
  let fGround = null;
  for (let i = 1; i <= 100; i++) {
    const f = i / 100;
    const p = pathAt(f, pathArgs);
    if (lerp(start.y, TARGET_Y, f) + p.y <= 0.03) { fGround = f; break; }
  }
  const out = !fGround && Math.hypot(shot.x, shot.y) > 0.72; // 과녁 옆으로 빠짐
  const short = Boolean(fGround);
  game.stage = 'flight';
  game.stageT = 0;
  const fl = {
    f: 0, age: 0, settle: 0, camBlend: 0, start, pathArgs, shot, res: short ? { score: 0, label: 'M', isX: false, miss: true, dist: 99 } : res,
    P, fEnd: short ? fGround : 1, short, out,
    T1: clamp(shot.t * 1.25 + 0.2, T_FLIGHT[0], T_FLIGHT[1]), T2: T_SLOW, landed: false, pull, steady: stead, arrowIdx: c.arrowIdx
  };
  game.flight = fl;
  c.state = 'flown';
  view.state.mode = 'flight';
  view.state.flight = fl;
  view.state.pull = 0; view.state.lens = 0;
  view.setMarker(null);
  view.state.arrowOnBow = false;
  view.state.wobble = 1;
  // 놓는 순간 느낌
  sfx.creakStop();
  sfx.release(pull);
  setTimeout(() => sfx.whoosh(1.1), 40 / TS);
  sendHaptic(socket, P.slot, 'strong', 1, { pattern: [60, 30, 25] });
  // 엔드 안 바람은 한 발마다 조금씩 바뀜
  game.wind = nextWind(game.wind, seedShot + 99991, game.level);
  $('gState').textContent = '발사!';
  pushState(true);
}

function flightPos(f, fl, out) {
  const p = pathAt(f, fl.pathArgs);
  return out.set(lerp(fl.start.x, 0, f) + p.x, lerp(fl.start.y, TARGET_Y, f) + p.y, lerp(fl.start.z, -game.D, f));
}
const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
function updateFlight(dt) {
  const fl = game.flight;
  fl.age += dt;
  view.state.wobble = Math.max(0, view.state.wobble - dt * 2.5);
  const hold = Math.min(0.97, 1 - 5 / game.D);
  const fs = Math.min(hold, fl.fEnd);
  let f;
  if (fl.age < fl.T1) f = fs * (fl.age / fl.T1);
  else {
    const u = clamp((fl.age - fl.T1) / fl.T2, 0, 1);
    f = fs + (fl.fEnd - fs) * (1 - Math.pow(1 - u, 1.7));
  }
  fl.f = f;
  fl.camBlend = fl.age < fl.T1 ? 0 : clamp((fl.age - fl.T1) / fl.T2, 0, 1);
  if (!fl.landed && f >= fl.fEnd - 1e-4 && fl.age >= fl.T1 + fl.T2 - 0.02) { fl.landed = true; fl.landAge = fl.age; land(fl); }
  if (fl.landed) fl.settle = clamp((fl.age - fl.landAge) / 0.9, 0, 1);
  view.stuckWobble();
  if (fl.landed && fl.age - fl.landAge > 1.15) {
    game.stage = 'result';
    game.stageT = 0;
    view.state.mode = 'fp';
    view.state.flight = null;
    view.state.pull = 0; view.state.lens = 0;
    view.state.arrowOnBow = false; // 다음 사람 차례에 새 화살
    view.state.wobble = 0;
  }
}

function land(fl) {
  const P = fl.P;
  const res = fl.res;
  const dir = new THREE.Vector3();
  flightPos(1, fl, _p1);
  flightPos(0.985, fl, _p0);
  dir.subVectors(_p1, _p0).normalize();
  // 기록
  const rec = { score: res.score, label: res.label, isX: res.isX, miss: res.miss, x: fl.shot.x, y: fl.shot.y };
  while (P.ends.length < game.endIdx + 1) P.ends.push([]);
  P.ends[game.endIdx].push(rec);
  if (fl.short) {
    const pos = new THREE.Vector3();
    flightPos(fl.fEnd, fl, pos);
    view.addGroundArrow(P.color, pos, dir);
    sfx.miss();
  } else if (!fl.out) {
    view.addStuck(P.color, fl.shot.x, fl.shot.y, dir);
    sfx.thud(res.score);
  } else {
    sfx.miss();
  }
  sfx.crowd(res.score);
  showScore(res, fl);
  // 폰: 점수에 맞는 진동
  if (!P.bot) {
    if (res.score === 10) sendHaptic(socket, P.slot, 'perfect', 1, { pattern: [50, 40, 50, 40, 140] });
    else if (res.score >= 8) sendHaptic(socket, P.slot, 'great', 0.9);
    else if (res.score >= 5) sendHaptic(socket, P.slot, 'good', 0.7);
    else sendHaptic(socket, P.slot, 'miss', 0.6);
  }
  renderBoard();
  pushState(true);
}

function showScore(res, fl) {
  const el = $('callout');
  el.className = 'callout';
  void el.offsetWidth;
  const cls = res.miss ? 's0' : res.score >= 9 ? 's10' : res.score >= 7 ? 's8' : res.score >= 5 ? 's6' : res.score >= 3 ? 's4' : 's2';
  const txt = res.miss ? (fl.short ? '짧아요' : 'M') : res.label;
  el.innerHTML = `${txt}<small>${fl.P.name}</small>`;
  el.className = `callout go ${cls}`;
  const pop = $('insetPop');
  pop.textContent = res.miss ? 'M' : res.label;
  pop.className = 'inset-pop';
  void pop.offsetWidth;
  pop.className = 'inset-pop pop';
  pop.style.color = res.miss ? '#c6cbd4' : res.score >= 9 ? '#ffd84a' : res.score >= 7 ? '#ff8a7a' : res.score >= 5 ? '#8fc8ff' : '#fff';
}

// ================================================================
// 차례 중 매 프레임
// ================================================================
const WIND_WORD = (w) => {
  if (!w || w.speed < 0.6) return '잔잔';
  const cross = w.speed * Math.cos(w.dir), tail = w.speed * Math.sin(w.dir);
  if (Math.abs(cross) >= Math.abs(tail)) return cross > 0 ? '왼쪽에서 불어요' : '오른쪽에서 불어요';
  return tail > 0 ? '뒷바람' : '맞바람';
};
function updateTurn(dt) {
  const c = game.cur;
  if (!c) return;
  const P = roster.get(c.slot);
  const sc = view.state;
  if (!P || !P.present) { forfeit('나갔어요'); return; }
  // 폰이 끊긴 채 오래 있으면 한 발 포기
  if (!P.connected && !P.bot) {
    if (c.awaySince == null) c.awaySince = game.t;
    if (game.t - c.awaySince > AWAY_FORFEIT_S) { forfeit('연결이 끊겼어요'); return; }
  } else c.awaySince = null;
  // 조준·당김 부드럽게
  const k = 1 - Math.exp(-dt * 16);
  c.shown.x += (c.aim.x - c.shown.x) * k;
  c.shown.y += (c.aim.y - c.shown.y) * k;
  c.pull += (c.pullIn - c.pull) * (1 - Math.exp(-dt * 22));
  if (c.state === 'wait') c.pull *= 0.9;
  // 만궁: 버티는 시간
  if (c.pullIn >= FULL_PULL && c.state !== 'wait') {
    if (c.fullAt == null) { c.fullAt = game.t; c.lastBeat = 0; sfx.click(); sendHaptic(socket, c.slot, 'tick', 0.9); c.state = 'hold'; }
  } else if (c.fullAt != null && c.pullIn < FULL_PULL - 0.1) { c.fullAt = null; c.lastBeat = 0; if (c.state === 'hold') c.state = 'draw'; }
  const holdSec = c.fullAt != null ? game.t - c.fullAt : 0;
  const tr = tremble(holdSec, game.t, game.level, c.slot);
  const bi = c.fullAt != null ? beatIndex(holdSec, game.level) : 0;
  if (bi > c.lastBeat) {
    c.lastBeat = bi;
    sendHaptic(socket, c.slot, 'tick', 1, { pattern: [26, 70, 38] });
    sfx.heart();
  }
  // 소리
  sfx.creak(c.state === 'wait' ? 0 : c.pull);
  // 장면
  sc.pull = c.pull;
  sc.lens = c.state === 'wait' ? Math.max(0, sc.lens - dt * 2.5) : Math.min(1, sc.lens + dt * 3.2);
  const dif = diffOf(game.level);
  const mpdT = metersPerDeg(game.D, dif.gain);
  const offT = -driftAt(game.D, V_FULL, game.wind) / mpdT;
  sc.aimDeg.x = assistAim(c.shown.x, offT, dif.assist) + tr.x;
  sc.aimDeg.y = assistAim(c.shown.y, 0, dif.assist) + tr.y;
  sc.arrowOnBow = true;
  // 예상 낙점(쉬움)
  if (dif.marker && c.pull > 0.5) {
    const v0 = launchSpeed(c.pull);
    const mpd = mpdT;
    const t0 = (Math.exp(0.0025 * game.D) - 1) / (0.0025 * v0);
    const tF = (Math.exp(0.0025 * game.D) - 1) / (0.0025 * V_FULL);
    const px = sc.aimDeg.x * mpd + driftAt(game.D, v0, game.wind);
    const py = sc.aimDeg.y * mpd - 0.5 * 9.80665 * (t0 * t0 - tF * tF);
    view.setMarker({ x: px, y: py });
  } else view.setMarker(null);
  // 타임아웃
  if (c.state === 'wait' && !P.bot && !c.warned && game.t - c.turnAt > SHOT_CLOCK_S - SHOT_WARN_S) { c.warned = true; cue(c.slot, '곧 시간이 끝나요'); sendHaptic(socket, c.slot, 'strong', 0.6); }
  if (c.state === 'wait' && game.t - c.turnAt > SHOT_CLOCK_S && !P.bot) { forfeit('시간이 지났어요'); return; }
  if (c.state !== 'wait' && !P.bot && game.t - c.lastMsgAt > DRAW_IDLE_S) { c.state = 'wait'; c.pullIn = 0; c.fullAt = null; sfx.creakStop(); }
  if (c.fullAt != null && holdSec > dif.steadySec + OVERHOLD_S) { fire(P, c.aim.x, c.aim.y, 1, 0.25); return; }
  // 게이지
  paintGauge(c, holdSec, tr);
  if (P.bot) botAct(dt, c, P);
}
function forfeit(why) {
  const c = game.cur;
  const P = roster.get(c.slot);
  cue(c.slot, why);
  if (P && P.play) {
    while (P.ends.length < game.endIdx + 1) P.ends.push([]);
    P.ends[game.endIdx].push({ score: 0, label: 'M', isX: false, miss: true, x: 9, y: 9 });
  }
  sfx.creakStop();
  banner(t('포기'), `${P ? P.name : ''} · ${t(why)}`, 1.4);
  renderBoard();
  game.cur = null;
  view.setMarker(null);
  view.state.pull = 0; view.state.lens = 0;
  nextTurn();
}

// ---------- 봇: 사람과 같은 길(onAim / onDraw / onRelease)로 쏩니다 ----------
function botAct(dt, c, P) {
  const b = c.bot || (c.bot = { phase: 'think', t: 0, wait: rnd(0.7, 1.4), hold: rnd(0.8, 1.7), noise: mulberry32(game.seed + c.slot * 31 + game.seqIdx) });
  b.t += dt;
  const D = game.D;
  const mpd = metersPerDeg(D, diffOf(game.level).gain);
  const comp = 0.55 + 0.45 * P.skill;
  const off = -driftAt(D, V_FULL, game.wind) / mpd * comp; // 바람 반대쪽으로 겨눔
  const sigmaDeg = ((1.5 - P.skill) * 0.26) / mpd;
  const ph = b.t * 3 + c.slot;
  const ax = off + Math.sin(ph) * sigmaDeg * 0.7 + (b.noise() - 0.5) * sigmaDeg * 0.8;
  const ay = Math.cos(ph * 0.8) * sigmaDeg * 0.7 + (b.noise() - 0.5) * sigmaDeg * 0.8;
  if (b.phase === 'think') {
    if (b.t > b.wait) { b.phase = 'draw'; b.t = 0; }
  } else if (b.phase === 'draw') {
    const u = clamp(b.t / 1.2, 0, 1);
    onAim({ slot: c.slot, x: ax, y: ay });
    onDraw({ slot: c.slot, pull: u });
    if (u >= 1) { b.phase = 'hold'; b.t = 0; }
  } else if (b.phase === 'hold') {
    onAim({ slot: c.slot, x: ax, y: ay });
    onDraw({ slot: c.slot, pull: 1 });
    if (b.t > b.hold) { b.phase = 'done'; onRelease({ slot: c.slot, x: ax, y: ay, pull: 1, steady: clamp(0.5 + 0.45 * P.skill + (b.noise() - 0.5) * 0.2, 0, 1) }); }
  }
}

// ================================================================
// HUD
// ================================================================
const chipCls = (s) => (s >= 9 ? 's10' : s >= 7 ? 's8' : s >= 5 ? 's6' : s >= 3 ? 's4' : 's2');
function renderBoard() {
  const list = players();
  const E = game.ends;
  let h = '<table><thead><tr><th></th>';
  for (let e = 0; e < E; e++) h += `<th>${t('{n}엔드', { n: e + 1 })}</th>`;
  h += `<th>${t('합계')}</th></tr></thead><tbody>`;
  for (const P of list) {
    const t = totals(P);
    const cur = game.cur && game.cur.slot === P.slot;
    h += `<tr class="${cur ? 'cur' : ''}" style="--c:${P.color}"><td><span class="nm">${P.name}${P.bot ? '<small>BOT</small>' : ''}</span></td>`;
    for (let e = 0; e < E; e++) {
      const a = P.ends[e] || [];
      const sum = a.reduce((s, x) => s + x.score, 0);
      let chips = '';
      for (let k = 0; k < ARROWS_PER_END; k++) {
        const x = a[k];
        const now = cur && e === game.endIdx && k === a.length;
        chips += x ? `<i class="${x.miss ? 's2' : chipCls(x.score)}">${x.label}</i>` : `<i class="em${now ? ' now' : ''}">·</i>`;
      }
      h += `<td class="endcell${e === game.endIdx ? ' curend' : ''}"><span class="endsum">${a.length ? sum : '–'}</span><div class="chips">${chips}</div></td>`;
    }
    h += `<td><span class="tot">${t.total}</span><span class="sub">X ${t.xs} · 10 ${t.tens}</span></td></tr>`;
  }
  h += '</tbody></table>';
  $('board').innerHTML = h;
  $('windSpd').textContent = game.wind.speed.toFixed(1);
}
const ARROW_SVG = '<svg viewBox="0 0 62 14"><path d="M2 7H52" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M52 2L60 7L52 12Z" fill="currentColor"/><path d="M2 7L9 2M2 7L9 12M9 7L16 2M9 7L16 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
function paintGauge(c, holdSec, tr) {
  const g = $('gauge');
  const P = roster.get(c.slot);
  const d = diffOf(game.level);
  $('gFill').style.width = `${(c.pull * 100).toFixed(1)}%`;
  $('gFull').style.left = `${FULL_PULL * 100}%`;
  const hold = c.fullAt != null ? clamp(holdSec / (d.steadySec + 3.2), 0, 1) : 0;
  $('gHold').style.width = `${(hold * 100).toFixed(1)}%`;
  $('gHold').parentElement.classList.toggle('tired', tr.f > 0);
  g.classList.toggle('tired', tr.f > 0 && !tr.breath);
  g.classList.toggle('breath', tr.f > 0 && tr.breath);
  let st = '활을 들어요', hint = '';
  if (c.state === 'wait') st = t('{p} 차례', { p: P.name });
  else if (c.fullAt == null) st = '당기는 중';
  else if (tr.f > 0 && tr.breath) st = '숨 고르기!';
  else if (tr.f > 0) st = '팔이 떨려요';
  else st = '만궁';
  $('gState').textContent = st;
  $('gHint').textContent = hint;
  const left = ARROWS_PER_END - c.arrowIdx;
  const html = Array.from({ length: ARROWS_PER_END }, (_, i) => `<span class="${i < c.arrowIdx ? 'spent' : ''}" style="color:${P.color}">${ARROW_SVG.replace('<svg', `<svg class="${i < c.arrowIdx ? 'spent' : ''}"`)}</span>`).join('');
  if ($('gArrows').dataset.k !== `${c.slot}${c.arrowIdx}`) { $('gArrows').innerHTML = html; $('gArrows').dataset.k = `${c.slot}${c.arrowIdx}`; }
  void left;
}
let bannerTimer = null;
function banner(title, sub, sec = 2) {
  const b = $('banner');
  b.querySelector('b').textContent = title;
  b.querySelector('span').textContent = sub || '';
  b.classList.add('on');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove('on'), (sec * 1000) / TS);
}
function cue(slot, text) { send('cue', { text, kind: 'info' }, slot); }
let msgTimer = null;
function lobbyMessage(t) {
  $('msg').textContent = t;
  $('msg').classList.add('on');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => $('msg').classList.remove('on'), 3500);
}
const slotEls = [];
function renderLobby() {
  const box = $('slots');
  if (!box) return;
  if (!slotEls.length) {
    for (let s = 1; s <= MAX_PLAYERS; s++) {
      const d = document.createElement('div');
      d.className = 'slot';
      d.innerHTML = `<b>${SLOT_INFO[s].name}</b><small>${t('비어 있음')}</small>`;
      d.style.setProperty('--c', SLOT_INFO[s].color);
      box.appendChild(d);
      slotEls.push({ d, sm: d.querySelector('small') });
    }
  }
  const list = lobbyList();
  for (let s = 1; s <= MAX_PLAYERS; s++) {
    const { d, sm } = slotEls[s - 1];
    const P = list.find((p) => p.slot === s);
    let txt = t('비어 있음');
    if (P) {
      if (P.bot) txt = 'BOT';
      else if (practicing.has(s)) txt = t('연습 중');
      else if (readyNow.has(s)) txt = t('준비 완료');
      else txt = t('연결됨');
      if (!P.connected) txt += ` · ${t('끊김')}`; // 예전에는 CSS 글자였음(번역 안 됨)
    }
    d.classList.toggle('on', Boolean(P));
    d.classList.toggle('away', Boolean(P && !P.connected));
    d.classList.toggle('cal', Boolean(P && (P.calibrated || P.bot)));
    d.classList.toggle('rdy', Boolean(P && !P.bot && readyNow.has(s)));
    d.classList.toggle('prac', Boolean(P && !P.bot && practicing.has(s)));
    if (sm.textContent !== txt) sm.textContent = txt;
  }
}

// ---------- 폰으로 보내는 상태 ----------
let pushTimer = null;
let lastPush = 0;
function statePlayers() {
  const out = {};
  const list = game.phase === 'playing' || game.phase === 'over' ? players() : lobbyList().filter((p) => p.connected);
  for (const P of list) {
    const t = totals(P);
    out[P.slot] = { total: t.total, xs: t.xs, tens: t.tens, ends: P.ends.map((a) => a.reduce((s, x) => s + x.score, 0)), arrows: P.ends.map((a) => a.map((x) => x.label)), calibrated: P.calibrated, play: P.play };
  }
  return out;
}
function buildState() {
  const c = game.cur;
  return {
    phase: game.phase,
    stage: game.phase === 'playing' ? game.stage : null,
    sub: c ? c.state : null,
    difficulty: game.phase === 'playing' ? game.level : level,
    distance: game.phase === 'playing' ? game.D : DIFFICULTY[level].distance,
    ends: game.ends,
    endIdx: game.endIdx,
    arrowIdx: c ? c.arrowIdx : game.flight ? game.flight.arrowIdx : 0,
    arrows: ARROWS_PER_END,
    current: c ? c.slot : (game.flight ? game.flight.P.slot : null),
    wind: game.wind,
    players: statePlayers(),
    settings: settings.forState({ lite: game.phase === 'playing' })
  };
}
function pushState(force) {
  const now = performance.now();
  if (!force && now - lastPush < 220) {
    if (!pushTimer) pushTimer = setTimeout(() => { pushTimer = null; pushState(true); }, 230);
    return;
  }
  clearTimeout(pushTimer);
  pushTimer = null;
  lastPush = now;
  send('game_state', buildState());
}
setInterval(() => { if (game.phase === 'playing') pushState(); }, 500);

// ================================================================
// 한 프레임
// ================================================================
let last = performance.now();
let lobbyT = 0;
const insetEl = $('inset');
function tick() {
  requestAnimationFrame(tick);
  const now = performance.now();
  const realDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const dt = realDt * TS;
  game.t += dt;
  game.stageT += dt;
  const sc = view.state;
  // 바람 표시는 천천히 따라감
  const kw = 1 - Math.exp(-dt * 1.8);
  game.windShown.speed += (game.wind.speed - game.windShown.speed) * kw;
  let dd = game.wind.dir - game.windShown.dir;
  while (dd > Math.PI) dd -= 2 * Math.PI;
  while (dd < -Math.PI) dd += 2 * Math.PI;
  game.windShown.dir += dd * kw;
  view.setWind(game.windShown);
  if (game.phase === 'playing') {
    $('windArrow').setAttribute('transform', `rotate(${(-game.windShown.dir * 180 / Math.PI).toFixed(1)})`);
    $('windSpd').textContent = game.windShown.speed.toFixed(1);
    $('windWord').textContent = WIND_WORD(game.wind);
    sfx.wind(game.windShown.speed);
  }
  if (game.phase === 'lobby') {
    // 대기실: 활이 천천히 당겨졌다 풀림(모델을 보여 주는 용도)
    lobbyT += realDt;
    sc.mode = 'fp';
    sc.pull = 0.5 - 0.5 * Math.cos(lobbyT * 0.7);
    sc.lens = 0;
    sc.arrowOnBow = true;
    sc.handVisible = true;
    sc.aimDeg.x = Math.sin(lobbyT * 0.6) * 0.5; sc.aimDeg.y = Math.cos(lobbyT * 0.5) * 0.3;
  } else if (game.phase === 'playing') {
    if (game.stage === 'intro') {
      sc.mode = 'fp';
      sc.pull = Math.max(0, sc.pull - dt * 2);
      sc.lens = Math.max(0, sc.lens - dt * 2);
      if (game.stageT > INTRO_S) startTurn();
    } else if (game.stage === 'turn') updateTurn(dt);
    else if (game.stage === 'flight') updateFlight(dt);
    else if (game.stage === 'result') {
      sc.pull = 0; sc.lens = 0;
      view.stuckWobble();
      if (game.stageT > RESULT_S) {
        game.cur = null;
        nextTurn();
      }
    } else if (game.stage === 'endbreak') {
      view.stuckWobble();
      if (game.stageT > ENDBREAK_S) {
        if (game.endIdx + 1 >= game.ends) finishMatch();
        else beginEnd(game.endIdx + 1);
      }
    }
  }
  // 클로즈업 인셋
  const showInset = game.phase === 'playing' && view.stuckCount() > 0 && game.stage !== 'intro';
  sc.insetOn = showInset;
  insetEl.classList.toggle('off', !showInset);
  if (showInset) {
    const r = insetEl.getBoundingClientRect();
    sc.insetRect = { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  view.update(dt);
  view.render();
}

// ---------- 키보드 ----------
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { if (game.phase !== 'playing') startGame(); }
});

syncRoster();
renderLobby();
applyDifficulty();
requestAnimationFrame(tick);
// ?autostart 는 봇 시험 전용입니다. 폰이 한 대라도 들어와 있으면 모두 준비로만 시작합니다.
if (AUTOSTART && BOTS > 0) setTimeout(() => { if (!serverPlayers.length) startGame(); }, 1500);
// 봇 판이 끝나면 시험이 이어지도록, 봇만 있을 때는 결과 화면에서 멈춥니다(Enter 로 다시).

window.__archery = {
  game, roster, view, settings, startGame, backToLobby, finishMatch, onAim, onDraw, onRelease, fire,
  setSpeed(v) { TS = clamp(Number(v) || 1, 0.1, 30); }, get speed() { return TS; },
  forceStage(s) { game.stage = s; game.stageT = 0; },
  constants: { ARROWS_PER_END, MIN_PULL, OVERHOLD_S, SHOT_CLOCK_S, FULL_PULL, DIFFICULTY },
  totals, players
};
