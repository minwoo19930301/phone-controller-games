// 퍼팅 챌린지 큰 화면: 차례(홀에서 먼 사람 먼저), 퍼팅 판정과 공 굴리기, 점수, 화면 글자, 소리, 시험용 봇과 키보드.
// 서버는 방과 이벤트만 중계하고 판정은 모두 여기서 합니다.
import { createScene } from './scene.js';
import { getHole, HOLE_COUNT, readLine } from './greens.js';
import { simulate, planPutt, flatDistance, speedForFlat, MAX_BALL_SPEED } from './physics.js';
import { sfx, audio } from './sfx.js';

const RD = Math.PI / 180;
const MAX_STROKES = 5; // 한 홀 최대 타수. 못 넣으면 6타로 적습니다.
const PICKUP = MAX_STROKES + 1;
const SMASH = 1.2; // 볼 스피드 = 퍼터 스피드 × 1.2
const FACE_K = 0.88; // 공이 출발하는 방향 = 조준 + 페이스 × 0.88
const AIM_MAX = 25;
const PUTTER_MAX = MAX_BALL_SPEED / SMASH;
const SLOT_INFO = {
  1: { name: '1P', color: '#ff5a5f' },
  2: { name: '2P', color: '#3ab4ff' },
  3: { name: '3P', color: '#ffc93c' },
  4: { name: '4P', color: '#5ee07a' }
};
const SURF_NAME = { fringe: '프린지', rough: '러프', bunker: '벙커', green: '그린' };

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const BOTS = clamp(parseInt(params.get('bots'), 10) || 0, 0, 4);
// ?kbd=N: 폰 없이 키보드로 치는 로컬 선수(시험용)
const KBD = clamp(parseInt(params.get('kbd'), 10) || 0, 0, 4);
const AUTOSTART = params.has('autostart');
let DEBUG = params.has('debug');
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gauss = () => {
  let u = 0;
  let v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// 캔버스에 글자를 그리기 전에 글꼴을 기다립니다(최대 2초).
await Promise.race([
  Promise.all([document.fonts.load('400 64px Anton'), document.fonts.load('800 64px "Pretendard Variable"')]),
  new Promise((r) => setTimeout(r, 2000))
]).catch(() => {});

const view = createScene($('cv'));
let hole = getHole(0);
view.setHole(hole);
view.setGolfer(SLOT_INFO[1].color);
view.setBagColor(SLOT_INFO[1].color);

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
  try { saved = sessionStorage.getItem('pcg-putting-room'); } catch (e) {}
  socket.emit('join', { role: 'display', game: 'putting', room: saved });
});
socket.on('room', async (r) => {
  try { sessionStorage.setItem('pcg-putting-room', r.code); } catch (e) {}
  serverPlayers = r.players || [];
  // 서버가 다시 떠서 방이 새로 생겼으면 진행 중이던 경기는 이어 갈 수 없어 대기실로 돌아갑니다.
  if (r.fresh && game.phase !== 'lobby') backToLobby('서버가 다시 시작돼서 대기실로 돌아왔어요');
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
  pushState();
});
socket.on('players', (p) => {
  const before = new Set(serverPlayers.map((x) => x.slot));
  serverPlayers = p.players || [];
  if (serverPlayers.some((x) => !before.has(x.slot))) sfx.chime();
  if (game.phase === 'playing') {
    for (const pl of serverPlayers.filter((x) => x.connected)) {
      const info = game.info[pl.slot];
      if (info) {
        // A real phone taking a simulated seat inherits its existing score.
        if (info.bot || info.local) { info.bot = false; info.local = false; }
        continue;
      }
      // Once the final hole has ended, a new phone waits for the next match.
      if (game.sub === 'holeEnd' && game.holeIdx + 1 >= HOLE_COUNT) continue;
      const joinedAt = game.holeIdx + (game.sub === 'holeEnd' ? 1 : 0);
      game.info[pl.slot] = { slot: pl.slot, name: pl.name, color: pl.color, bot: false, local: false, joinedAt };
      game.card[pl.slot] = new Array(HOLE_COUNT).fill(null);
      game.order.push(pl.slot);
      // The ball is picked at the next turn boundary, never during a putt.
      game.balls[pl.slot] = { x: hole.start.x, z: hole.start.z, strokes: 0, holed: false, done: false, picked: false };
    }
  }
  renderLobby();
  renderBoard();
  pushState();
});
socket.on('display_replaced', () => $('replaced').classList.remove('hidden'));
socket.on('start_game', () => startGame());
socket.on('aim', (d) => onAim(d, false));
socket.on('address', (d) => onAddress(d, false));
socket.on('pose', (d) => onPose(d));
socket.on('stroke', (d) => onStroke(d, false));
socket.on('cancel', (d) => onCancel(d));

// 대기실 참가자: 폰(서버 자리) + ?bots=N 시험용 봇(빈 자리부터 채움)
function lobbyPlayers() {
  const list = serverPlayers.map((p) => ({ ...p, bot: false, local: false }));
  let kbd = KBD;
  let need = BOTS;
  for (let s = 1; s <= 4 && need + kbd > 0; s++) {
    if (list.some((p) => p.slot === s)) continue;
    const local = kbd > 0;
    list.push({ slot: s, name: SLOT_INFO[s].name, color: SLOT_INFO[s].color, connected: true, bot: !local, local });
    if (local) kbd -= 1;
    else need -= 1;
  }
  return list.sort((a, b) => a.slot - b.slot);
}
function playerInfo(slot) {
  if (game.info[slot]) {
    const live = serverPlayers.find((p) => p.slot === slot);
    const i = game.info[slot];
    return { ...i, connected: i.bot || i.local ? true : Boolean(live && live.connected) };
  }
  const p = lobbyPlayers().find((x) => x.slot === slot);
  return p || { slot, ...SLOT_INFO[slot], connected: false, bot: false };
}

// ================================================================
// 경기 상태
// ================================================================
const game = {
  phase: 'lobby', // lobby | playing | over
  sub: 'idle', // intro | aim | hold | stroke | roll | result | holeEnd
  holeIdx: 0,
  order: [], // 이번 홀 순서(오너 순)
  info: {}, // slot -> { name, color, bot }
  balls: {}, // slot -> { x, z, strokes, holed, done, picked }
  card: {}, // slot -> [홀별 타수]
  turn: null,
  shot: 0,
  aim: 0,
  grid: true,
  addr: { theta0: 0, face0: 0 },
  mirror: null,
  roll: null,
  waitUntil: 0,
  introStart: 0,
  activity: 0,
  awaySince: null,
  allGoneSince: null,
  lastSlot: null,
  busy: false, // 홀 바꾸는 중(화면 어둡게)
  kbdPower: 1.4,
  kbdUsed: false
};
const rigNow = { theta: 0, face: 0, head: 0, lookUp: 0 };

const cup = () => hole.cup;
const ballOf = (slot) => game.balls[slot];
const distOf = (slot) => {
  const b = ballOf(slot);
  return b ? Math.hypot(b.x - hole.cup.x, b.z - hole.cup.z) : 0;
};
const isTurn = (slot) => game.phase === 'playing' && slot === game.turn;
// 폰이 조작하는 자리인지(봇·키보드 선수 자리는 폰 입력을 받지 않음)
const byPhone = (slot) => { const p = playerInfo(slot); return !p.bot && !p.local; };
const isHumanTurn = (slot) => isTurn(slot) && byPhone(slot);
// 공 → 홀 방향에서 조준(yaw, +는 오른쪽)만큼 돌린 방향
function aimHeading(slot = game.turn) {
  const b = ballOf(slot);
  const base = Math.atan2(hole.cup.x - b.x, hole.cup.z - b.z);
  return base - game.aim * RD;
}
const totalOf = (slot) => (game.card[slot] || []).reduce((s, v) => s + (v || 0), 0);
const parSoFar = (slot) => (game.card[slot] || []).reduce((s, v, i) => s + (v ? getHole(i).par : 0), 0);

function pushState() {
  const totals = {};
  for (const s of Object.keys(game.card)) totals[s] = totalOf(Number(s));
  const b = game.turn ? ballOf(game.turn) : null;
  send('game_state', {
    phase: game.phase,
    sub: game.sub,
    turn: game.phase === 'playing' ? game.turn : null,
    hole: game.holeIdx + 1,
    holes: HOLE_COUNT,
    par: hole.par,
    holeName: hole.name,
    dist: b ? +distOf(game.turn).toFixed(2) : null,
    stroke: b ? b.strokes + 1 : null,
    players: Object.keys(game.info).map(Number),
    bots: Object.values(game.info).filter((p) => p.bot || p.local).map((p) => p.slot),
    card: game.card,
    totals,
    shot: game.shot,
    lastSlot: game.lastSlot,
    grid: game.grid,
    aim: game.aim,
    maxStrokes: MAX_STROKES
  });
}

// ---------- 경기 흐름 ----------
async function startGame() {
  if (game.phase === 'playing' || game.busy) return;
  const list = lobbyPlayers().filter((p) => p.connected);
  if (!list.length) {
    callout('폰을 먼저 연결해 주세요', 'QR을 찍고 시작하기를 누르면 자리가 생겨요', 'miss', 2400);
    return;
  }
  audio();
  demo.state = 'off';
  sfx.rollStop();
  game.phase = 'playing';
  game.info = {};
  game.card = {};
  for (const p of list) {
    game.info[p.slot] = { slot: p.slot, name: p.name, color: p.color, bot: p.bot, local: Boolean(p.local) };
    game.card[p.slot] = new Array(HOLE_COUNT).fill(null);
  }
  game.order = list.map((p) => p.slot);
  game.holeIdx = 0;
  game.shot = 0;
  game.lastSlot = null;
  $('lobby').classList.add('hidden');
  $('over').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('join').classList.remove('hidden');
  await beginHole(0);
}

async function beginHole(idx) {
  game.busy = true;
  game.sub = 'intro';
  game.holeIdx = idx;
  $('card').classList.remove('on');
  setTimeout(() => $('card').classList.add('hidden'), 400);
  await fade(true);
  if (hole !== getHole(idx)) {
    hole = getHole(idx);
    view.setHole(hole);
  }
  view.replaceFlag(true);
  // 오너: 첫 홀은 자리 순, 다음 홀부터는 앞 홀 타수가 적은 사람부터
  if (idx > 0) {
    const prev = idx - 1;
    game.order = [...game.order].sort((a, b) => game.card[a][prev] - game.card[b][prev]);
  }
  game.balls = {};
  for (const s of game.order) game.balls[s] = { x: hole.start.x, z: hole.start.z, strokes: 0, holed: false, done: false, picked: false };
  game.turn = game.order[0];
  setupTurnView(game.turn);
  game.introStart = performance.now();
  cutNext = true;
  view.setMarkers([]);
  renderBoard();
  renderBug();
  pushState();
  await sleep(60);
  fade(false);
  game.busy = false;
  callout(`${hole.id}번 홀`, `${hole.name} · 파 ${hole.par} · ${hole.length.toFixed(1)}m`, 'hole', 2600);
  sfx.chime();
}

// 다음 사람: 홀에서 가장 먼 공부터(같으면 오너 순)
function nextPlayer() {
  const left = game.order.filter((s) => !game.balls[s].done);
  if (!left.length) {
    endHole();
    return;
  }
  let pick = left[0];
  for (const s of left) if (distOf(s) > distOf(pick) + 0.01) pick = s;
  const changed = pick !== game.turn;
  game.turn = pick;
  game.sub = 'next';
  beginTurn(true, changed);
}

// fadeIt: 공 자리가 바뀌었으니 화면을 잠깐 어둡게 하고 옮깁니다. changed: 다른 사람 차례가 됨
async function beginTurn(fadeIt, changed) {
  const slot = game.turn;
  if (fadeIt) {
    await fade(true);
    setupTurnView(slot);
    cutNext = true;
    await sleep(40);
    fade(false);
  } else {
    setupTurnView(slot);
  }
  game.sub = 'aim';
  game.shot += 1;
  game.activity = performance.now();
  game.awaySince = null;
  game.mirror = null;
  const p = playerInfo(slot);
  const b = ballOf(slot);
  renderBug();
  renderBoard();
  renderRead();
  $('shot').classList.remove('on');
  if (changed) callout(p.name, `${b.strokes + 1}타째 · 홀까지 ${distOf(slot).toFixed(1)}m`, 'player', 1500);
  prompt(`${p.name} 차례`, p.bot ? '봇이 라인을 읽고 있어요' : p.local ? '키보드: ←→ 방향, ↑↓ 세기, Space 퍼팅' : '폰에서 방향을 맞추고 어드레스를 눌러요');
  if (p.local) {
    game.kbdUsed = true;
    renderKbd();
  }
  pushState();
  if (p.bot) botTurn(slot, game.shot);
}

// 그 사람의 공 자리로 골퍼·공·카메라를 옮깁니다.
function setupTurnView(slot) {
  const p = playerInfo(slot);
  const b = ballOf(slot);
  game.aim = 0;
  game.roll = null;
  document.documentElement.style.setProperty('--c', p.color);
  view.setGolfer(p.color);
  view.setBagColor(p.color);
  const h = aimHeading(slot);
  view.placeGolfer(b.x, b.z, h);
  view.orientBall(h);
  view.setGolferVisible(true);
  Object.assign(rigNow, { theta: 0, face: 0, head: 0, lookUp: 0 });
  view.golferPose(0, 0, 0, 0);
  game.kbdPower = clamp(speedForFlat(distOf(slot) + 0.4) / SMASH, 0.2, PUTTER_MAX);
  renderKbd();
  // 다른 사람 공 자리 표시
  const marks = [];
  for (const s of game.order) {
    const o = game.balls[s];
    if (s === slot || o.holed || o.picked || o.strokes === 0) continue;
    marks.push({ x: o.x, z: o.z, color: playerInfo(s).color, slot: s });
  }
  view.setMarkers(marks);
  game.marks = marks;
}

function endHole() {
  $('call').classList.remove('on');
  game.sub = 'holeEnd';
  game.turn = null;
  game.waitUntil = performance.now() + 5600;
  prompt('', '');
  $('read').classList.remove('on');
  $('shot').classList.remove('on');
  view.setMarkers([]);
  view.setGolferVisible(false);
  view.replaceFlag(false);
  renderCard(true);
  pushState();
}

function endGame() {
  game.phase = 'over';
  game.sub = 'idle';
  game.turn = null;
  $('hud').classList.add('hidden');
  $('join').classList.add('hidden');
  $('card').classList.remove('on');
  $('card').classList.add('hidden');
  $('shot').classList.remove('on');
  $('read').classList.remove('on');
  prompt('', '');
  const ranked = rankList();
  const box = $('podium');
  box.innerHTML = '';
  const tied = (r) => r != null && ranked.filter((x) => x.rank === r).length > 1;
  ranked.forEach(({ slot, rank }, i) => {
    const p = playerInfo(slot);
    const total = totalOf(slot);
    const par = parSoFar(slot);
    const diff = total - par;
    const el = document.createElement('div');
    el.className = 'r' + (rank === 1 ? ' first' : '');
    el.style.setProperty('--c', p.color);
    el.style.animationDelay = `${0.15 + i * 0.12}s`;
    const holes = game.card[slot].map((v) => `<span class="${v && v < getHole(0).par ? 'u' : ''}">${v == null ? '-' : v}</span>`).join('');
    el.innerHTML = `<span class="rank">${rank == null ? '–' : rank}</span><span class="who">${p.name}</span><span class="holes">${holes}</span>` +
      `<span class="num"><b>${total}</b><span>${rank == null ? '타 · 중도 참가' : `타 · ${diff === 0 ? '이븐' : diff > 0 ? `+${diff}` : diff}${tied(rank) ? ` · 공동 ${rank}위` : ''}`}</span></span>`;
    box.appendChild(el);
  });
  $('over').classList.remove('hidden');
  view.setGolferVisible(false);
  sfx.cheer(true);
  pushState();
}

// 총 타수가 적은 순. 같으면 공동 순위.
function rankList() {
  const list = [...game.order].sort((a, b) => (game.info[a].joinedAt || 0) - (game.info[b].joinedAt || 0) || totalOf(a) - totalOf(b) || a - b);
  let rank = 0;
  let prev = null;
  return list.map((slot, i) => {
    if (game.info[slot].joinedAt > 0) return { slot, rank: null };
    const t = totalOf(slot);
    if (t !== prev) rank = i + 1;
    prev = t;
    return { slot, rank };
  });
}

async function backToLobby(why) {
  game.phase = 'lobby';
  game.sub = 'idle';
  game.turn = null;
  game.order = [];
  game.info = {};
  game.balls = {};
  game.card = {};
  game.roll = null;
  sfx.rollStop();
  $('hud').classList.add('hidden');
  $('join').classList.add('hidden');
  $('shot').classList.remove('on');
  $('read').classList.remove('on');
  $('card').classList.add('hidden');
  $('over').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  prompt('', '');
  view.setMarkers([]);
  if (why) callout(why, '', 'miss', 2600);
  if (hole !== getHole(0)) {
    await fade(true);
    hole = getHole(0);
    view.setHole(hole);
    fade(false);
  }
  demo.state = 'idle';
  demo.next = performance.now() + 800;
  renderLobby();
  pushState();
}

// 차례인 사람이 사라졌거나 너무 오래 아무것도 안 하면 그 홀을 기권(6타) 처리합니다.
function watchTurn(now) {
  if (game.phase !== 'playing') return;
  const anyone = Object.values(game.info).some((p) => p.bot || p.local) || serverPlayers.some((p) => p.connected && game.info[p.slot]);
  if (!anyone) {
    if (!game.allGoneSince) game.allGoneSince = now;
    if (now - game.allGoneSince > 20000) backToLobby('모든 폰의 연결이 끊겨 대기실로 돌아왔어요');
    return;
  }
  game.allGoneSince = null;
  if (!['aim', 'hold', 'stroke'].includes(game.sub)) return;
  const slot = game.turn;
  const p = playerInfo(slot);
  if (p.bot || p.local) return;
  if (!p.connected) {
    if (!game.awaySince) {
      game.awaySince = now;
      prompt(`${p.name} 연결을 기다려요`, '15초 안에 돌아오지 않으면 이 홀은 6타로 적고 넘어가요');
    }
    if (now - game.awaySince > 15000) forfeit(slot, `${p.name} 기권`, '연결이 끊겼어요');
    return;
  }
  if (game.awaySince) {
    game.awaySince = null;
    prompt(`${p.name} 차례`, '폰에서 방향을 맞추고 어드레스를 눌러요');
  }
  if (now - game.activity > 90000) forfeit(slot, `${p.name} 시간 초과`, '이 홀은 6타로 적어요');
}
function forfeit(slot, title, note) {
  const b = ballOf(slot);
  b.done = true;
  b.picked = true;
  game.card[slot][game.holeIdx] = PICKUP;
  callout(title, note, 'miss', 2200);
  send('result', { text: title, note, strokes: PICKUP, holed: false, picked: true }, slot);
  game.lastSlot = slot;
  game.sub = 'result';
  game.waitUntil = performance.now() + 2400;
  renderBoard();
  pushState();
}

// ================================================================
// 폰 → 화면 입력
// ================================================================
function onAim(d, local) {
  if (!isTurn(d.slot) || (!local && !byPhone(d.slot))) return;
  const gridChanged = typeof d.grid === 'boolean' && d.grid !== game.grid;
  if (gridChanged) {
    game.grid = d.grid;
    renderRead();
  }
  // 어드레스 중인데 폰이 다른 조준을 보내면 폰이 조준 화면으로 돌아온 것입니다(재연결·새로고침).
  // 큰 화면도 조준으로 되돌립니다. 어드레스 직후 손을 떼며 오는 같은 값은 그대로 둡니다.
  if (!local && (game.sub === 'hold' || game.sub === 'stroke') && (gridChanged || Math.abs(num(d.yaw, game.aim) - game.aim) > 0.05)) onCancel(d);
  if (game.sub !== 'aim') return;
  game.activity = performance.now();
  const y = num(d.yaw, game.aim);
  game.aim = clamp(y, -AIM_MAX, AIM_MAX);
  const b = ballOf(game.turn);
  view.placeGolfer(b.x, b.z, aimHeading());
  view.orientBall(aimHeading());
  renderBug();
  // 손을 뗀 조준은 상태로도 알려, 새로고침한 폰이 같은 방향에서 시작하게 합니다.
  if (d.done) pushState();
}

function onAddress(d, local) {
  if (!isTurn(d.slot) || (!local && !byPhone(d.slot))) return;
  if (!['aim', 'hold', 'stroke'].includes(game.sub)) return;
  game.activity = performance.now();
  // 어드레스 때 폰이 보여 주던 조준이 그대로 퍼트 방향입니다(큰 화면이 hold·stroke 에 남아 있었어도).
  if (typeof d.aim === 'number') game.aim = clamp(d.aim, -AIM_MAX, AIM_MAX);
  if (typeof d.grid === 'boolean') game.grid = d.grid;
  const b = ballOf(game.turn);
  view.placeGolfer(b.x, b.z, aimHeading());
  view.orientBall(aimHeading());
  if (d.phase === 'hold') {
    game.sub = 'hold';
    prompt('어드레스 중', '폰을 그립처럼 쥐고 3초 동안 멈춰요');
    pushState();
    return;
  }
  // 폰이 기준 자세를 잡았습니다. 이 순간의 폰 각도가 퍼터의 0° 가 됩니다.
  const s0 = Array.isArray(d.s0) ? d.s0 : null;
  const f0 = Array.isArray(d.fc0) ? d.fc0 : null;
  game.addr = {
    theta0: s0 ? Math.atan2(num(s0[2], 0), -num(s0[1], -1)) : 0,
    face0: f0 ? Math.atan2(num(f0[0], 0), num(f0[2], 1)) : 0
  };
  game.mirror = null;
  const first = game.sub !== 'stroke';
  game.sub = 'stroke';
  if (view.pullFlag()) sfx.flag();
  if (first) sfx.tick();
  prompt('퍼팅하세요', '뒤로 살짝 뺐다가 시계추처럼 톡 밀어요');
  renderBug();
  pushState();
}

function onPose(d) {
  if (!isHumanTurn(d.slot) || game.sub !== 'stroke' || !Array.isArray(d.s) || !Array.isArray(d.fc)) return;
  const th = Math.atan2(num(d.s[2], 0), -num(d.s[1], -1)) - game.addr.theta0;
  const fy = Math.atan2(num(d.fc[0], 0), num(d.fc[2], 1)) - game.addr.face0;
  game.mirror = { theta: clamp(th, -0.7, 0.7), face: clamp(fy, -0.35, 0.35), at: performance.now() };
}

function onCancel(d) {
  if (!isHumanTurn(d.slot) || !['hold', 'stroke'].includes(game.sub)) return;
  game.sub = 'aim';
  game.activity = performance.now();
  game.mirror = null;
  prompt(`${playerInfo(d.slot).name} 차례`, '폰에서 방향을 맞추고 어드레스를 눌러요');
  pushState();
}

function onStroke(d, local) {
  if (!isTurn(d.slot)) return;
  if (!local && !byPhone(d.slot)) return;
  if (!(game.sub === 'stroke' || (local && (game.sub === 'aim' || game.sub === 'hold')))) return;
  const now = performance.now();
  game.activity = now;
  const putter = clamp(num(d.speed, 0), 0.05, PUTTER_MAX);
  const face = clamp(num(d.face, 0), -15, 15);
  // 페이스가 틀어지면 약간 덜 나갑니다(빗맞음)
  const ball = Math.min(MAX_BALL_SPEED, putter * SMASH * (1 - Math.min(0.1, Math.abs(face) * 0.004)));
  const heading = aimHeading() - face * FACE_K * RD;
  const b = ballOf(game.turn);
  const sim = simulate(hole, { x: b.x, z: b.z }, heading, ball);
  const mirrored = !local && game.mirror && now - game.mirror.at < 400;
  const lag = local ? 0 : num(d.ago, 0) + num(d.rtt, 80) / 2 + displayRtt() / 2;
  const anim = mirrored ? mirrorAnim(putter, now, rigNow.theta) : scriptAnim(putter, now, rigNow.theta);
  anim.face = face * RD;
  const dx = hole.cup.x - b.x;
  const dz = hole.cup.z - b.z;
  const dl = Math.hypot(dx, dz) || 1;
  game.roll = {
    sim, anim, putter, ball, face, heading, lag,
    from: { x: b.x, z: b.z },
    dir: { x: dx / dl, z: dz / dl },
    distBefore: dl,
    launched: false,
    lipIdx: 0,
    cupPlayed: false,
    prev: { x: b.x, z: b.z },
    finished: false
  };
  game.sub = 'roll';
  game.mirror = null;
  if (view.pullFlag()) sfx.flag();
  prompt('', '');
  $('read').classList.remove('on');
  $('sPutter').textContent = putter.toFixed(2);
  $('sBall').textContent = ball.toFixed(2);
  $('sFace').textContent = faceText(face);
  $('sLeft').textContent = dl.toFixed(1);
  $('shot').classList.add('on');
  debug(`stroke putter ${putter.toFixed(2)}m/s ball ${ball.toFixed(2)} face ${face.toFixed(1)}° lag ${Math.round(lag)}ms ` +
    `sim ${sim.holed ? 'IN' : sim.stopped} ${sim.time.toFixed(1)}s lips ${sim.lips.length}`);
  pushState();
}

const faceText = (f) => (Math.abs(f) < 0.5 ? '스퀘어' : f > 0 ? `열림 ${f.toFixed(1)}°` : `닫힘 ${(-f).toFixed(1)}°`);

// ---------- 스트로크 동작 ----------
const RIG_R = 1.26; // 어깨 축에서 헤드까지(퍼터 각속도 → 헤드 속도)
// 폰이 없을 때(키보드·봇): 백스윙 → 잠깐 멈춤 → 시계추처럼 내려와 맞힘 → 팔로스루
function scriptAnim(putter, now, from) {
  const Tb = 0.6;
  const H = 0.08;
  const Tf = 0.3;
  const A = clamp((putter / RIG_R) * ((2 * Tf) / Math.PI), 0.03, 0.42);
  return { kind: 'script', t0: now, from, A, Tb, H, Tf, launchAt: now + (Tb + H + Tf) * 1000, Af: A * 1.05, thetaS: 0 };
}
// 폰 자세를 따라 그리던 중: 지금 각도에서 바로 공까지 내려옵니다.
function mirrorAnim(putter, now, from) {
  const w = putter / RIG_R;
  const Tm = from < 0 ? clamp(-from / Math.max(0.5, w), 0.02, 0.15) : 0;
  return { kind: 'mirror', t0: now, from, Tm, launchAt: now + Tm * 1000, Af: clamp((putter / RIG_R) * 0.22, 0.05, 0.6), thetaS: Math.max(0, from) };
}
function animTheta(a, now) {
  if (now < a.launchAt) {
    const t = (now - a.t0) / 1000;
    if (a.kind === 'mirror') return a.from * (1 - t / Math.max(0.001, a.Tm));
    if (t < a.Tb) return a.from + (-a.A - a.from) * ease(t / a.Tb);
    if (t < a.Tb + a.H) return -a.A;
    const u = (t - a.Tb - a.H) / a.Tf;
    return -a.A * Math.cos((Math.PI / 2) * u);
  }
  const s = (now - a.launchAt) / 1000;
  const top = Math.max(a.thetaS, a.Af);
  if (s < 0.4) return a.thetaS + (top - a.thetaS) * Math.sin((Math.PI / 2) * (s / 0.4));
  if (s < 1.6) return top;
  if (s < 2.5) return top * (1 - ease((s - 1.6) / 0.9));
  return 0;
}

// ================================================================
// 공 굴리기 재생과 판정
// ================================================================
function updateRoll(now) {
  const r = game.roll;
  if (!r || r.finished) return null;
  if (!r.launched) {
    if (now < r.anim.launchAt) return { x: r.from.x, z: r.from.z };
    r.launched = true;
    r.launchT = now;
    sfx.putt(r.putter / 2.4);
    if (r.sim.frames > 2) sfx.rollStart();
  }
  const sim = r.sim;
  const i = Math.min(sim.frames - 1, Math.floor((now - r.launchT) / 1000 / sim.dtOut));
  const p = { x: sim.pts[i * 3], y: sim.pts[i * 3 + 1], z: sim.pts[i * 3 + 2] };
  // 굴러간 만큼 공을 돌립니다(컵에 빠지는 중에는 그대로)
  if (!(sim.holed && i >= sim.holedFrame)) view.rollBall(p.x - r.prev.x, p.z - r.prev.z);
  const sp = Math.hypot(p.x - r.prev.x, p.z - r.prev.z) / Math.max(1e-3, (now - (r.prevT || now)) / 1000 || sim.dtOut);
  r.prev = { x: p.x, z: p.z };
  r.prevT = now;
  sfx.rollSet(sim.holed && i >= sim.holedFrame ? 0 : Math.min(4, sp));
  while (r.lipIdx < sim.lips.length && sim.lips[r.lipIdx].frame <= i) {
    sfx.lip();
    r.lipIdx += 1;
  }
  if (sim.holed && !r.cupPlayed && i >= sim.holedFrame + 12) {
    r.cupPlayed = true;
    sfx.rollStop();
    sfx.cup();
  }
  $('sLeft').textContent = (sim.holed && i >= sim.holedFrame ? 0 : Math.hypot(p.x - hole.cup.x, p.z - hole.cup.z)).toFixed(1);
  if (i >= sim.frames - 1) {
    r.finished = true;
    finishPutt(now);
  }
  return p;
}

const scoreName = (strokes, par) => {
  const d = strokes - par;
  if (strokes === 1) return '원 퍼트';
  return { '-1': '버디', 0: '파', 1: '보기', 2: '더블 보기', 3: '트리플 보기' }[d] || `${strokes}타`;
};

function finishPutt(now) {
  const r = game.roll;
  const sim = r.sim;
  const slot = game.turn;
  const b = ballOf(slot);
  sfx.rollStop();
  b.strokes += 1;
  b.x = sim.rest.x;
  b.z = sim.rest.z;
  const left = sim.holed ? 0 : Math.hypot(b.x - hole.cup.x, b.z - hole.cup.z);
  let title;
  let note = '';
  let kind = '';
  if (sim.holed) {
    b.holed = true;
    b.done = true;
    game.card[slot][game.holeIdx] = b.strokes;
    const diff = b.strokes - hole.par;
    title = `${diff < 0 ? '버디' : diff === 0 ? '파' : scoreName(b.strokes, hole.par)}!`;
    note = b.strokes === 1 ? `${r.distBefore.toFixed(1)}m 한 번에 넣었어요` : `${b.strokes}타 만에 홀아웃`;
    if (sim.lips.length) note = `컵을 돌고 들어갔어요 · ${note}`;
    kind = diff < 0 || r.distBefore > 5 ? 'hr' : '';
    sfx.cheer(diff < 0 || r.distBefore > 5);
  } else {
    const along = (b.x - hole.cup.x) * r.dir.x + (b.z - hole.cup.z) * r.dir.z;
    const lipped = sim.lips.length > 0;
    if (b.strokes >= MAX_STROKES) {
      b.done = true;
      b.picked = true;
      game.card[slot][game.holeIdx] = PICKUP;
      title = '6타로 적어요';
      note = `${MAX_STROKES}타 안에 못 넣었어요`;
      kind = 'miss';
    } else {
      title = left < 1 ? `${Math.round(left * 100)}cm 남았어요` : `${left.toFixed(1)}m 남았어요`;
      note = lipped ? '립 아웃! 컵을 맞고 나왔어요' : along < -0.05 ? '짧았어요' : '지나쳤어요';
      if (sim.surface !== 'green' && SURF_NAME[sim.surface]) note += ` · ${SURF_NAME[sim.surface]}`;
    }
    if (lipped || (left < 0.7 && r.distBefore > 1.2)) sfx.groan();
  }
  game.lastSlot = slot;
  callout(title, note, kind, sim.holed ? 3000 : 2500);
  send('result', {
    text: title,
    note,
    strokes: b.strokes,
    holed: sim.holed,
    picked: b.picked,
    left: +left.toFixed(2),
    chips: [['볼 스피드', `${r.ball.toFixed(2)}m/s`], ['페이스', faceText(r.face)], sim.holed ? ['타수', `${b.strokes}타`] : ['남은 거리', `${left.toFixed(1)}m`]]
  }, slot);
  game.sub = 'result';
  game.waitUntil = now + (sim.holed ? 3400 : 2700);
  renderBoard();
  renderBug();
  pushState();
}

// ================================================================
// 시험용 봇: 같은 굴리기 함수로 라인을 읽고, 사람처럼 조금씩 틀립니다.
// ================================================================
function botTurn(slot, shotId) {
  const alive = () => game.phase === 'playing' && game.turn === slot && game.shot === shotId && playerInfo(slot).bot;
  setTimeout(() => {
    if (!alive()) return;
    const b = ballOf(slot);
    const plan = planPutt(hole, { x: b.x, z: b.z });
    const base = Math.atan2(hole.cup.x - b.x, hole.cup.z - b.z);
    const d = distOf(slot);
    const yaw = clamp(Math.round(((base - plan.heading) / RD) * 10) / 10, -AIM_MAX, AIM_MAX);
    // 사람처럼 틀립니다: 거리가 멀수록 크게, 가끔은 크게 실수(입스)
    const yips = Math.random() < 0.1 ? 2.2 : 1;
    const aimErr = (0.55 + 0.06 * d) * gauss() * yips;
    const speedErr = (0.055 + 0.006 * d) * gauss() * yips;
    // 조준선을 천천히 돌립니다
    const t0 = performance.now();
    const from = game.aim;
    const steer = setInterval(() => {
      if (!alive() || game.sub !== 'aim') {
        clearInterval(steer);
        return;
      }
      const k = Math.min(1, (performance.now() - t0) / 1300);
      onAim({ slot, yaw: from + (yaw - from) * ease(k) }, true);
      if (k >= 1) clearInterval(steer);
    }, 50);
    setTimeout(() => alive() && onAddress({ slot, phase: 'hold' }, true), 1800);
    setTimeout(() => alive() && onAddress({ slot, phase: 'ready', aim: yaw }, true), 2700);
    setTimeout(() => {
      if (!alive()) return;
      onStroke({ slot, speed: (plan.speed * (1 + speedErr)) / SMASH, face: aimErr / FACE_K, ago: 0, rtt: 0 }, true);
    }, 3300);
  }, 700);
}

// ================================================================
// 대기실 시연: 그린 위 여기저기서 혼자 퍼팅합니다.
// ================================================================
const demo = { state: 'idle', next: performance.now() + 1500, color: 0, from: null, sim: null, anim: null, heading: 0, prev: null, done: 0 };
function demoTick(now) {
  if (game.phase !== 'lobby' || demo.state === 'off') return null;
  if (demo.state === 'idle') {
    if (now < demo.next) return demo.from ? { ball: demo.restBall } : null;
    // 홀에서 2~7m 떨어진 그린 위 아무 곳
    let from = null;
    for (let k = 0; k < 60 && !from; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 5;
      const x = hole.cup.x + Math.sin(a) * r;
      const z = hole.cup.z + Math.cos(a) * r;
      if (hole.greenValue(x, z) < 0.85) from = { x, z };
    }
    if (!from) from = { ...hole.start };
    const plan = planPutt(hole, from);
    const heading = plan.heading;
    const err = 0.6 * gauss() * RD;
    const speed = plan.speed * (1 + 0.06 * gauss());
    demo.from = from;
    demo.heading = heading;
    demo.sim = simulate(hole, from, heading + err, speed);
    demo.anim = scriptAnim(speed / SMASH, now + 900, 0);
    demo.prev = { ...from };
    demo.launched = false;
    demo.color = (demo.color % 4) + 1;
    const c = SLOT_INFO[demo.color].color;
    view.setGolfer(c);
    view.setBagColor(c);
    view.placeGolfer(from.x, from.z, heading);
    view.orientBall(heading);
    view.setGolferVisible(true);
    view.replaceFlag(true);
    demo.state = 'putt';
  }
  if (demo.state === 'putt') {
    const th = now < demo.anim.t0 ? 0.008 * Math.sin(now / 380) : animTheta(demo.anim, now);
    view.golferPose(th, 0, now > demo.anim.launchAt + 400 ? 0.9 : 0, now > demo.anim.launchAt + 400 ? 0.3 : 0);
    if (now < demo.anim.launchAt) return { ball: { x: demo.from.x, y: hole.heightAt(demo.from.x, demo.from.z) + 0.02135, z: demo.from.z } };
    if (!demo.launched) {
      demo.launched = true;
      demo.launchT = now;
    }
    const s = demo.sim;
    const i = Math.min(s.frames - 1, Math.floor((now - demo.launchT) / 1000 / s.dtOut));
    const p = { x: s.pts[i * 3], y: s.pts[i * 3 + 1], z: s.pts[i * 3 + 2] };
    if (!(s.holed && i >= s.holedFrame)) view.rollBall(p.x - demo.prev.x, p.z - demo.prev.z);
    demo.prev = p;
    if (i >= s.frames - 1) {
      demo.state = 'idle';
      demo.next = now + 2600;
      demo.restBall = s.holed ? null : p;
      if (s.holed) demo.from = null;
    }
    return { ball: p };
  }
  return null;
}

// ================================================================
// 화면 글자
// ================================================================
let callTimer = null;
function callout(main, sub, kind, ms) {
  const el = $('call');
  el.className = `call ${kind || ''}`;
  $('callMain').textContent = main;
  $('callSub').textContent = sub || '';
  void el.offsetWidth;
  el.classList.add('on');
  clearTimeout(callTimer);
  callTimer = setTimeout(() => el.classList.remove('on'), ms || 1500);
}
function prompt(main, sub) {
  $('promptT').textContent = main;
  $('promptB').textContent = sub;
  $('prompt').classList.toggle('on', Boolean(main));
}
async function fade(on) {
  $('fade').classList.toggle('on', on);
  if (on) await sleep(360);
}
function renderLobby() {
  const box = $('slots');
  box.innerHTML = '';
  const list = lobbyPlayers();
  for (let s = 1; s <= 4; s++) {
    const p = list.find((x) => x.slot === s);
    const el = document.createElement('div');
    el.className = 'slot' + (p ? ' on' : '') + (p && p.bot ? ' bot' : '') + (p && p.local ? ' local' : '') + (p && !p.connected ? ' away' : '');
    if (p) {
      el.style.setProperty('--c', p.color);
      el.innerHTML = `<b>${p.name}</b>`;
    } else {
      el.textContent = `${s}P 비어 있음`;
    }
    box.appendChild(el);
  }
}
function renderBug() {
  if (game.phase !== 'playing' || !game.turn) return;
  const p = playerInfo(game.turn);
  const b = ballOf(game.turn);
  $('bName').textContent = p.name;
  $('bHole').textContent = `${hole.id}번 홀 · ${hole.name}`;
  $('bTag').textContent = hole.tag;
  $('bPar').textContent = `파 ${hole.par}`;
  $('bStroke').textContent = b.done ? (b.holed ? `${b.strokes}타 홀아웃` : '6타') : `${b.strokes + 1}타째`;
  $('bDist').textContent = distOf(game.turn).toFixed(1);
}
function renderBoard() {
  const box = $('leader');
  box.innerHTML = '';
  if (game.phase !== 'playing') return;
  const rows = [...game.order].sort((a, b) => totalOf(a) + (ballOf(a) && !ballOf(a).done ? ballOf(a).strokes : 0) -
    (totalOf(b) + (ballOf(b) && !ballOf(b).done ? ballOf(b).strokes : 0)) || a - b);
  for (const slot of rows) {
    const p = playerInfo(slot);
    const bl = ballOf(slot);
    const tot = totalOf(slot) + (bl && !bl.done ? bl.strokes : 0);
    const par = parSoFar(slot);
    const diff = totalOf(slot) - par;
    let h = '';
    if (bl) h = bl.holed ? `IN ${bl.strokes}` : bl.picked ? '6타' : bl.strokes ? `${bl.strokes}타 · ${distOf(slot).toFixed(1)}m` : '대기';
    const row = document.createElement('div');
    row.className = 'row' + (slot === game.turn ? ' now' : '');
    row.innerHTML = `<i style="background:${p.color}"></i><span class="n">${p.name}${p.bot ? '<small style="font-family:var(--sans);font-size:11px;margin-left:4px">봇</small>' : ''}</span>` +
      `<span class="h${bl && bl.holed ? ' in' : ''}">${h}</span><b>${tot}</b><small>${par ? (diff === 0 ? 'E' : diff > 0 ? `+${diff}` : diff) : ''}</small>`;
    box.appendChild(row);
  }
}
function renderRead() {
  if (game.phase !== 'playing' || !game.turn) return;
  const b = ballOf(game.turn);
  const r = readLine(hole, b);
  $('rDist').textContent = `${r.dist.toFixed(1)}m`;
  $('rRise').textContent = r.rise > 0.025 ? `오르막 +${r.rise.toFixed(2)}m` : r.rise < -0.025 ? `내리막 ${r.rise.toFixed(2)}m` : '거의 평평';
  const c = r.cross * 100;
  $('rCross').textContent = Math.abs(c) < 0.4 ? '거의 곧게' : c > 0 ? `오른쪽으로 휨 ${c.toFixed(1)}%` : `왼쪽으로 휨 ${(-c).toFixed(1)}%`;
  $('rFoot').innerHTML = `<kbd>G</kbd> 경사 보기 ${game.grid ? '켜짐' : '꺼짐'}`;
}
function renderCard(fresh) {
  const t = $('cardTable');
  const n = HOLE_COUNT;
  let html = '<tr><th>선수</th>' + Array.from({ length: n }, (_, i) => `<th>${i + 1}번</th>`).join('') + '<th>합계</th></tr>';
  html += '<tr class="par"><td>파</td>' + Array.from({ length: n }, (_, i) => `<td>${getHole(i).par}</td>`).join('') +
    `<td>${Array.from({ length: n }, (_, i) => getHole(i).par).reduce((a, b) => a + b, 0)}</td></tr>`;
  for (const { slot } of rankList()) {
    const p = playerInfo(slot);
    html += `<tr><td class="who" style="--pc:${p.color}"><i></i>${p.name}</td>`;
    for (let i = 0; i < n; i++) {
      const v = game.card[slot][i];
      const par = getHole(i).par;
      let cls = '';
      if (v != null) cls = v === PICKUP ? 'pick double' : v < par - 1 ? 'eagle' : v < par ? 'birdie' : v === par ? '' : v === par + 1 ? 'bogey' : 'double';
      if (fresh && i === game.holeIdx) cls += ' now';
      html += `<td><span class="sc ${cls}">${v == null ? '' : v}</span></td>`;
    }
    html += `<td class="tot">${totalOf(slot)}</td></tr>`;
  }
  t.innerHTML = html;
  $('cardEyebrow').textContent = `HOLE ${game.holeIdx + 1} / ${n}`;
  $('cardTitle').textContent = game.holeIdx + 1 >= n ? '마지막 홀 끝' : `${game.holeIdx + 1}번 홀 끝`;
  $('card').classList.remove('hidden');
  void $('card').offsetWidth;
  $('card').classList.add('on');
}
function renderKbd() {
  $('kbd').classList.toggle('hidden', !(game.kbdUsed || DEBUG) || game.phase !== 'playing');
  $('kbdV').textContent = game.kbdPower.toFixed(2);
  $('kbdD').textContent = `평지 약 ${flatDistance(game.kbdPower * SMASH).toFixed(1)}m`;
  $('kbdFill').style.width = `${(game.kbdPower / PUTTER_MAX) * 100}%`;
}
function debug(t) {
  if (!DEBUG) return;
  $('debug').classList.remove('hidden');
  $('debug').textContent = t;
}

// 화면 위 이름표(홀 거리, 다른 사람 공)
const tagEls = new Map();
function tag(key, html, cls, color) {
  let el = tagEls.get(key);
  if (!el) {
    el = document.createElement('div');
    el.className = `tag ${cls || ''}`;
    $('tags').appendChild(el);
    tagEls.set(key, el);
  }
  if (el._html !== html) {
    el.innerHTML = html;
    el._html = html;
  }
  if (color) el.style.setProperty('--tc', color);
  return el;
}
function placeTag(el, x, y, z, on) {
  const p = view.project(x, y, z);
  const vis = on && p.on && p.x > -50 && p.x < window.innerWidth + 50 && p.y > 0 && p.y < window.innerHeight;
  el.style.opacity = vis ? '1' : '0';
  if (vis) el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
}
function updateTags() {
  const playing = game.phase === 'playing';
  const aiming = playing && ['aim', 'hold', 'stroke', 'intro'].includes(game.sub);
  const cupEl = tag('cup', '', 'cup');
  if (playing && game.turn) {
    const d = distOf(game.turn);
    cupEl.innerHTML = `홀 <b>${d.toFixed(1)}</b>m`;
  }
  placeTag(cupEl, hole.cup.x, hole.cupY + 0.45, hole.cup.z, aiming && game.sub !== 'intro');
  const seen = new Set(['cup']);
  for (const m of (playing && game.marks) || []) {
    const key = `m${m.slot}`;
    seen.add(key);
    const el = tag(key, `<i></i>${playerInfo(m.slot).name} <b>${Math.hypot(m.x - hole.cup.x, m.z - hole.cup.z).toFixed(1)}</b>m`, '', m.color);
    placeTag(el, m.x, hole.heightAt(m.x, m.z) + 0.12, m.z, aiming);
  }
  // 멈춘 공 위에 남은 거리
  const restKey = 'rest';
  seen.add(restKey);
  const showRest = playing && game.sub === 'result' && game.roll && !game.roll.sim.holed && game.lastSlot === game.turn;
  if (showRest) {
    const b = ballOf(game.turn);
    const el = tag(restKey, `<b>${distOf(game.turn).toFixed(1)}</b>m`, 'player', playerInfo(game.turn).color);
    placeTag(el, b.x, hole.heightAt(b.x, b.z) + 0.2, b.z, true);
  } else if (tagEls.has(restKey)) tagEls.get(restKey).style.opacity = '0';
  for (const [k, el] of tagEls) {
    if (!seen.has(k)) {
      el.remove();
      tagEls.delete(k);
    }
  }
}

// ================================================================
// 매 프레임
// ================================================================
let cutNext = true;
let lastT = performance.now();
let birdAt = performance.now() + 4000;
function tick() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  watchTurn(now);
  let cam = { mode: 'orbit' };
  let ballPos = null;
  let halo = false;
  let overlay = false;
  let aimOn = false;
  const lerp = (k) => 1 - Math.exp(-dt * k);

  if (game.phase === 'playing' && game.turn && ballOf(game.turn)) {
    const slot = game.turn;
    const b = ballOf(slot);
    const heading = aimHeading(slot);
    const sub = game.sub;
    const by = hole.heightAt(b.x, b.z) + 0.02135;
    ballPos = b.holed && sub !== 'roll' && sub !== 'result' ? null : { x: b.x, y: by, z: b.z };
    // 골퍼 자세 목표
    let tTheta = 0;
    let tFace = 0;
    let tHead = 0;
    let tLook = 0;
    if (sub === 'intro' || sub === 'aim') {
      // 손목 까딱(왜글)과 가끔 홀 쪽 바라보기
      tTheta = 0.009 * Math.sin(now / 380);
      const ph = (now / 1000 + slot * 1.7) % 7;
      if (ph > 4.6 && ph < 6.2) {
        tHead = 0.95;
        tLook = 0.32;
      }
    } else if (sub === 'hold') {
      tTheta = 0;
    } else if (sub === 'stroke') {
      if (game.mirror && now - game.mirror.at < 400) {
        // 스트로크 신호가 오기 전에는 퍼터가 공을 지나가지 않고 공 자리에서 기다립니다.
        tTheta = Math.min(0, game.mirror.theta);
        tFace = game.mirror.face;
      } else tTheta = 0.004 * Math.sin(now / 500);
    }
    if (sub === 'roll' && game.roll) {
      const a = game.roll.anim;
      rigNow.theta = animTheta(a, now);
      rigNow.face += (a.face - rigNow.face) * lerp(14);
      const after = now - a.launchAt;
      tHead = after > 350 ? 0.95 : 0;
      tLook = after > 350 ? 0.34 : 0;
      rigNow.head += (tHead - rigNow.head) * lerp(4);
      rigNow.lookUp += (tLook - rigNow.lookUp) * lerp(4);
      const p = updateRoll(now);
      if (p) {
        ballPos = { x: p.x, y: p.y !== undefined ? p.y : hole.heightAt(p.x, p.z) + 0.02135, z: p.z };
        if (p.y === undefined) ballPos.y = hole.heightAt(p.x, p.z) + 0.02135;
      }
    } else if (sub === 'result' && game.roll) {
      const a = game.roll.anim;
      rigNow.theta = animTheta(a, now);
      rigNow.head += (0.95 - rigNow.head) * lerp(3);
      rigNow.lookUp += (0.34 - rigNow.lookUp) * lerp(3);
      const s = game.roll.sim;
      const k = s.frames - 1;
      ballPos = s.holed ? { x: s.pts[k * 3], y: s.pts[k * 3 + 1], z: s.pts[k * 3 + 2] } : { x: b.x, y: by, z: b.z };
    } else {
      const kk = sub === 'stroke' ? 30 : 6;
      rigNow.theta += (tTheta - rigNow.theta) * lerp(kk);
      rigNow.face += (tFace - rigNow.face) * lerp(kk);
      rigNow.head += (tHead - rigNow.head) * lerp(3);
      rigNow.lookUp += (tLook - rigNow.lookUp) * lerp(3);
    }
    view.golferPose(rigNow.theta, rigNow.face, rigNow.head, rigNow.lookUp);

    const dist = distOf(slot);
    if (sub === 'intro') {
      cam = { mode: 'intro', t: (now - game.introStart) / 2800, ball: b, heading, dist };
      overlay = game.grid;
      if (now - game.introStart > 3000 && !game.busy) {
        game.sub = 'aim';
        beginTurn(false, true);
      }
    } else if (sub === 'aim' || sub === 'hold') {
      cam = { mode: 'aim', ball: b, heading, dist };
      overlay = game.grid;
      aimOn = true;
    } else if (sub === 'stroke') {
      cam = { mode: 'stroke', ball: b, heading, dist };
      aimOn = true;
    } else if (sub === 'next') {
      cam = game.lastCam && game.lastCam.mode !== 'orbit' ? game.lastCam : { mode: 'aim', ball: b, heading, dist };
    } else if (sub === 'roll' || sub === 'result') {
      const r = game.roll;
      if (r) {
        // 친 직후엔 퍼팅 캠, 굴러가면 중계 카메라가 공을 따라 돌고, 긴 퍼트가 홀 가까이 오면 홀 옆 카메라로 끊어 갑니다.
        if (!r.camMode) r.camMode = 'stroke';
        if (r.launched && sub === 'roll') {
          const toCup = ballPos ? Math.hypot(ballPos.x - hole.cup.x, ballPos.z - hole.cup.z) : 9;
          const restNear = r.sim.holed || Math.hypot(r.sim.rest.x - hole.cup.x, r.sim.rest.z - hole.cup.z) < 2.2;
          const i = Math.floor((now - r.launchT) / 1000 / r.sim.dtOut);
          if (r.camMode !== 'hole' && r.distBefore > 3.2 && restNear && (toCup < 2.3 || r.sim.frames - i < 50)) {
            r.camMode = 'hole';
            cutNext = true;
          } else if (r.camMode === 'stroke' && now - r.launchT > 380) r.camMode = 'track';
        }
        if (r.camMode === 'hole') cam = { mode: 'hole', dir: r.dir };
        else if (r.camMode === 'track') cam = { mode: 'track', from: r.from, heading: r.heading, ball: ballPos || { x: b.x, y: by, z: b.z } };
        else cam = { mode: 'stroke', ball: r.from, heading: r.heading, dist };
      } else cam = { mode: 'stroke', ball: b, heading, dist };
      halo = sub === 'roll';
      if (sub === 'result' && now >= game.waitUntil) nextPlayer();
    }
    if (aimOn) view.setAim(true, b, heading, dist);
    else view.setAim(false);
  } else if (game.phase === 'playing' && game.sub === 'holeEnd') {
    cam = { mode: 'overview' };
    view.setAim(false);
    if (now >= game.waitUntil && !game.busy) {
      if (game.holeIdx + 1 >= HOLE_COUNT) endGame();
      else beginHole(game.holeIdx + 1);
    }
  } else {
    view.setAim(false);
    const d = demoTick(now);
    if (d && d.ball) ballPos = d.ball;
    cam = { mode: 'orbit' };
    overlay = game.phase === 'lobby' && Math.floor(now / 9000) % 2 === 1;
  }
  game.lastCam = cam;
  $('read').classList.toggle('on', game.phase === 'playing' && ['aim', 'hold'].includes(game.sub));
  view.frame(now, { cam, ball: ballPos, halo, overlay, cut: cutNext });
  cutNext = false;
  updateTags();
  if (now > birdAt) {
    sfx.bird();
    birdAt = now + 5000 + Math.random() * 9000;
  }
  requestAnimationFrame(tick);
}

// ================================================================
// 키보드(시험용): Enter 시작, ←→ 조준, ↑↓ 세기, Space 퍼팅, G 경사 보기, F 깃대
// ================================================================
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (game.phase !== 'playing') startGame();
    return;
  }
  if (e.code === 'KeyG') {
    game.grid = !game.grid;
    renderRead();
    pushState();
    return;
  }
  if (e.code === 'KeyF') {
    if (view.flagIsIn()) view.pullFlag();
    else view.replaceFlag(false);
    sfx.flag();
    return;
  }
  if (e.code === 'KeyD' && e.shiftKey) {
    DEBUG = !DEBUG;
    $('debug').classList.toggle('hidden', !DEBUG);
    renderKbd();
    return;
  }
  if (game.phase !== 'playing' || !game.turn || playerInfo(game.turn).bot) return;
  const slot = game.turn;
  const fine = e.shiftKey;
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    e.preventDefault();
    if (game.sub !== 'aim') return;
    const step = fine ? 0.1 : 0.5;
    onAim({ slot, yaw: Math.round((game.aim + (e.code === 'ArrowRight' ? step : -step)) * 10) / 10 }, true);
    game.kbdUsed = true;
    renderKbd();
    pushState();
  } else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
    e.preventDefault();
    const step = fine ? 0.01 : 0.05;
    game.kbdPower = clamp(game.kbdPower + (e.code === 'ArrowUp' ? step : -step), 0.2, PUTTER_MAX);
    game.kbdUsed = true;
    renderKbd();
  } else if (e.code === 'Space') {
    e.preventDefault();
    if (!['aim', 'hold', 'stroke'].includes(game.sub)) return;
    game.kbdUsed = true;
    renderKbd();
    if (game.sub !== 'stroke') onAddress({ slot, phase: 'ready', aim: game.aim }, true);
    onStroke({ slot, speed: game.kbdPower, face: 0, ago: 0, rtt: 0 }, true);
  }
});

renderLobby();
requestAnimationFrame(tick);
if (AUTOSTART && BOTS + KBD > 0) setTimeout(() => startGame(), 1500);

// 디버그: 콘솔에서 상태 보기
window.__putting = { game, view, getHole, simulate, planPutt, startGame, endGame, endHole, renderCard, onStroke, onAim, onAddress, lobbyPlayers, get hole() { return hole; } };
