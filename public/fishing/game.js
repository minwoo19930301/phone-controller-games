// 배스 낚시 큰 화면: 사람마다 캐스팅 → 입질 → 챔질 → 파이팅 → 랜딩을 동시에 돌립니다.
// 서버는 방과 이벤트만 중계하고 판정은 모두 여기서 합니다.
import { createScene } from './scene.js';
import { sfx, audio, setAmbience } from './sfx.js';
import {
  SESSION_SEC, OVERTIME_SEC, HOOK_WINDOW, LINE_PER_TURN, DOCK, AIM_MAX,
  lakeQ, spotQuality, castTarget, pickFish, planBite, newFight, stepFight, jumpThrow, botReel
} from './logic.js';

const SLOT_INFO = {
  1: { name: '1P', color: '#ff5a5f' },
  2: { name: '2P', color: '#3ab4ff' },
  3: { name: '3P', color: '#ffc93c' },
  4: { name: '4P', color: '#5ee07a' }
};
const STAGE_LABEL = {
  ready: '캐스팅 준비', cast: '캐스팅!', wait: '입질 대기', bite: '챔질!', fight: '파이팅', landed: '잡았다!', lost: '채비 정리', done: '끝'
};
const TENSION_MS = 125; // 장력은 약 8Hz 로 보냅니다
const POSE_FRESH_MS = 400;
const SPOT_GAP = 2.4;
const ROD_LEN = 1.85; // 손에서 초릿대 끝까지

const $ = (id) => document.getElementById(id);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const params = new URLSearchParams(location.search);
const BOTS = clamp(parseInt(params.get('bots'), 10) || 0, 0, 4);
const AUTOSTART = params.has('autostart');
const DEBUG = params.has('debug');
// 시험용: ?time=초 로 한 판 길이를 바꿉니다(기본 3분).
const SESSION = clamp(parseInt(params.get('time'), 10) || SESSION_SEC, 10, 600);
const RD = Math.PI / 180;

await Promise.race([
  Promise.all([document.fonts.load('400 64px Anton'), document.fonts.load('800 64px "Pretendard Variable"')]),
  new Promise((r) => setTimeout(r, 2000))
]).catch(() => {});
const view = createScene($('cv'));

// 화면 크기에 맞춰 HUD 를 키우고 줄입니다(1600×900 기준).
let UI = 1;
function applyUi() {
  UI = clamp(Math.min(window.innerWidth / 1600, window.innerHeight / 900), 0.6, 1.6);
  document.documentElement.style.setProperty('--ui', UI.toFixed(3));
}
window.addEventListener('resize', applyUi);
applyUi();

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
// 봇 자리에는 보내지 않습니다(폰이 없음).
function sendTo(p, event, data) {
  if (p.bot) return;
  send(event, data, p.slot);
}

socket.on('connect', () => {
  let saved = null;
  try { saved = sessionStorage.getItem('pcg-fishing-room'); } catch (e) {}
  socket.emit('join', { role: 'display', game: 'fishing', room: saved });
});
let joinedOnce = false;
socket.on('room', async (r) => {
  try { sessionStorage.setItem('pcg-fishing-room', r.code); } catch (e) {}
  serverPlayers = r.players || [];
  // 서버가 다시 떠서 방이 새로 만들어졌으면 진행 중이던 경기는 이어 갈 수 없으니 대기실로 돌아갑니다.
  // 첫 입장은 늘 새 방이라 제외합니다(?bots 시험 경기가 소켓보다 먼저 시작됐을 수 있음).
  if (r.fresh && joinedOnce && game.phase !== 'lobby') backToLobby('서버가 다시 시작돼서 대기실로 돌아왔어요');
  joinedOnce = true;
  $('code').textContent = r.code;
  $('codeMini').textContent = r.code;
  try {
    const res = await fetch(`/api/qr?room=${r.code}`).then((x) => x.json());
    $('qr').src = res.qr;
    $('qrMini').src = res.qr;
    $('url').textContent = res.url.replace(/^https?:\/\//, '');
    $('warn').classList.toggle('hidden', Boolean(res.secure));
  } catch (e) {}
  syncRoster();
  pushState();
});
socket.on('players', (payload) => {
  const before = new Set(serverPlayers.map((x) => x.slot));
  serverPlayers = payload.players || [];
  for (const pl of serverPlayers) if (!before.has(pl.slot)) sfx.join();
  syncRoster();
  pushState();
});
socket.on('display_replaced', () => $('replaced').classList.remove('hidden'));
socket.on('start_game', () => startGame());
socket.on('pose', (d) => onPose(d.slot, d));
socket.on('calibrate', (d) => onCalibrate(d.slot));
socket.on('cast', (d) => onCast(d.slot, d));
socket.on('hookset', (d) => onHookset(d.slot, d, performance.now()));
socket.on('reel', (d) => onReel(d.slot, d));

// 대기실 참가자: 폰(서버 자리) + ?bots=N 시험용 봇(빈 자리부터 채움)
function lobbyPlayers() {
  const list = serverPlayers.map((p) => ({ ...p, bot: false }));
  let need = BOTS;
  for (let s = 1; s <= 4 && need > 0; s++) {
    if (list.some((p) => p.slot === s)) continue;
    list.push({ slot: s, ...SLOT_INFO[s], connected: true, bot: true });
    need -= 1;
  }
  return list.sort((a, b) => a.slot - b.slot);
}
function infoOf(slot) {
  return serverPlayers.find((p) => p.slot === slot) || { slot, ...SLOT_INFO[slot], connected: false };
}

// ================================================================
// 경기 상태
// ================================================================
const game = {
  phase: 'lobby', // lobby | playing | over
  players: new Map(), // slot -> 낚시꾼
  startAt: 0,
  endAt: 0,
  overtime: false,
  lastStatePush: 0,
  cards: [], // 조과 카드 대기열
  card: null,
  lastBeep: 0,
  results: []
};

function newAngler(info) {
  return {
    slot: info.slot, name: info.name, color: info.color, bot: Boolean(info.bot),
    x: 0, xs: null,
    stage: 'ready', stageAt: performance.now(),
    total: 0, count: 0, best: null, catches: [],
    pose: null, calibrated: false, tilt: 0,
    rod: { elev: 38, yaw: 0, kick: 0, kickAt: -1e9 },
    bob: { x: 0, z: 0, under: 0, vis: false },
    cast: null, plan: null, waitT0: 0, nib: 0, lastNibble: -1e9, nibAnim: -1e9, biteAt: 0, fishPending: null,
    fight: null, jump: null, landed: null, lostAt: 0, hookAt: 0,
    reel: { omega: 0, at: 0, total: null, spin: 0 },
    rtt: 80,
    lastTension: 0, ripAt: 0,
    manualUntil: 0,
    bot2: { castAt: 0, reelNext: 0, hookAt: 0, lapse: 0, tilt: 0, total: 0 },
    rx: 0, rz: 0 // 끌려오는 동안 찌 위치(물고기 위치)
  };
}

// 서버 자리 목록이 바뀌면 낚시꾼을 더하거나(경기 중 합류) 대기실에서는 빼 줍니다.
function syncRoster() {
  const list = lobbyPlayers().filter((p) => p.connected || game.phase === 'playing');
  if (game.phase === 'lobby') {
    for (const slot of [...game.players.keys()]) if (!list.some((p) => p.slot === slot)) game.players.delete(slot);
  }
  for (const p of list) {
    if (!p.connected && !game.players.has(p.slot)) continue;
    if (!game.players.has(p.slot)) {
      game.players.set(p.slot, newAngler(p));
      if (game.phase === 'playing') hudCall(`${p.name} 합류`, '바로 던져도 돼요', 'player', 1800, p.color);
    } else {
      const a = game.players.get(p.slot);
      a.color = p.color;
      a.name = p.name;
    }
  }
  layoutSpots();
  view.setPlayers([...game.players.values()].map((a) => ({ slot: a.slot, color: a.color, name: a.name })));
  renderLobby();
  renderBoard();
}

function layoutSpots() {
  const list = [...game.players.values()].sort((a, b) => a.slot - b.slot);
  const n = list.length;
  // 1P 가 화면 왼쪽(세계 +x)
  list.forEach((a, i) => {
    a.x = ((n - 1) / 2 - i) * SPOT_GAP;
    if (a.xs == null) a.xs = a.x;
  });
}

function anglers() {
  return [...game.players.values()].sort((a, b) => a.slot - b.slot);
}

function setStage(a, stage) {
  if (a.stage === stage) return;
  a.stage = stage;
  a.stageAt = performance.now();
  pushState();
}

function statePlayers() {
  const out = {};
  for (const a of game.players.values()) {
    out[a.slot] = { stage: a.stage, total: +a.total.toFixed(2), count: a.count, best: a.best ? { name: a.best.name, weight: a.best.weight } : null };
  }
  return out;
}
function timeLeft(now = performance.now()) {
  if (game.phase !== 'playing') return SESSION;
  return Math.max(0, (game.endAt - now) / 1000);
}
function pushState() {
  game.lastStatePush = performance.now();
  const data = { phase: game.phase, left: Math.ceil(timeLeft()), session: SESSION, overtime: game.overtime, players: statePlayers() };
  if (game.phase === 'over') data.ranking = game.results.map((r) => ({ slot: r.slot, total: +r.total.toFixed(2), count: r.count }));
  send('game_state', data);
}

// ---------- 낚싯대 끝 ----------
// 장면이 그린 실제 끝 위치를 쓰고, 아직 없으면 손 위치에서 계산합니다.
function pivotOf(a) {
  return [a.xs - 0.2, DOCK.y + 1.08, 0.52];
}
function tipOf(a) {
  const t = view.tipOf(a.slot);
  if (t) return t;
  const p = pivotOf(a);
  const e = a.rod.elev * RD;
  const y = a.rod.yaw * RD;
  return [p[0] - Math.sin(y) * Math.cos(e) * ROD_LEN, p[1] + Math.sin(e) * ROD_LEN, p[2] + Math.cos(y) * Math.cos(e) * ROD_LEN];
}
function nominalTip(a) {
  // 판정용(물고기 거리)은 흔들리지 않는 정면 끝을 씁니다.
  return [a.xs - 0.2, 0, 0.52 + ROD_LEN * 0.8];
}

// ================================================================
// 입력(폰·봇·키보드가 모두 이 함수들을 씁니다)
// ================================================================
function onPose(slot, d) {
  const a = game.players.get(slot);
  if (!a || !Array.isArray(d.s) || d.s.length < 3) return;
  const s = d.s.map(Number);
  if (s.some((v) => !Number.isFinite(v))) return;
  a.pose = { s, fc: Array.isArray(d.fc) ? d.fc.map(Number) : null, at: performance.now() };
  a.tilt = clamp(s[0] / 0.6, -1, 1);
}

function onCalibrate(slot) {
  const a = game.players.get(slot);
  if (!a) return;
  a.calibrated = true;
  a.pose = null;
  sendTo(a, 'cue', { kind: 'calibrated' });
}

function onCast(slot, d) {
  const a = game.players.get(slot);
  if (!a || game.phase !== 'playing') return;
  if (a.stage !== 'ready' && a.stage !== 'wait') return;
  if (typeof d.rtt === 'number') a.rtt = clamp(d.rtt, 0, 1500);
  const power = clamp(Number(d.power) || 0, 0, 1);
  const aim = clamp(Number(d.aim) || 0, -AIM_MAX, AIM_MAX);
  const tip = tipOf(a);
  const nt = nominalTip(a);
  const tgt = castTarget(nt[0], nt[2], power, aim);
  const now = performance.now();
  // 이미 물에 있던 찌는 빠르게 감아 들인 뒤 다시 던집니다.
  const pre = a.stage === 'wait' ? 380 : 0;
  a.cast = {
    t0: now, pre, from: a.stage === 'wait' ? [a.bob.x, 0, a.bob.z] : tip.slice(),
    to: [tgt.x, tgt.z], dist: tgt.dist, power, aim,
    dur: 650 + power * 520 + tgt.dist * 14
  };
  a.rod.kickAt = now + pre;
  a.rod.yaw = aim;
  a.fight = null;
  a.plan = null;
  a.fishPending = null;
  setStage(a, 'cast');
  if (pre) sfx.reelFast();
  setTimeout(() => sfx.whoosh(power), pre);
}

function onReel(slot, d) {
  const a = game.players.get(slot);
  if (!a) return;
  const now = performance.now();
  let omega = Number(d.rate);
  const turns = Math.max(0, Number(d.turns) || 0);
  if (typeof d.total === 'number' && a.reel.total != null && now - a.reel.at < 1000) {
    // 밀려서 버려진 메시지가 있어도 누적값으로 실제 감은 양을 압니다.
    const dTot = d.total - a.reel.total;
    if (dTot >= 0 && dTot < 6 && !Number.isFinite(omega)) omega = dTot / Math.max(0.04, (now - a.reel.at) / 1000);
  }
  if (!Number.isFinite(omega)) omega = turns / Math.max(0.04, (now - (a.reel.at || now - 66)) / 1000);
  if (typeof d.total === 'number') a.reel.total = d.total;
  a.reel.omega = clamp(omega, 0, 6);
  a.reel.at = now;
}

function onHookset(slot, d, arrival) {
  const a = game.players.get(slot);
  if (!a || game.phase !== 'playing') return;
  if (typeof d.rtt === 'number') a.rtt = clamp(d.rtt, 0, 1500);
  const ago = clamp(Number(d.ago) || 0, 0, 1500);
  const est = arrival - ago - a.rtt / 2 - displayRtt() / 2;
  const speed = Math.max(0, Number(d.speed) || 0);
  a.rod.kickAt = performance.now();
  a.rod.kick = 1;
  if (a.stage === 'bite') {
    const oneWay = (a.rtt + displayRtt()) / 2;
    if (est >= a.biteAt - 160 && est <= a.biteAt + HOOK_WINDOW * 1000 + oneWay) hookFish(a, speed, est - a.biteAt);
    else if (est < a.biteAt - 160) spook(a);
    else missBite(a, 'late');
    return;
  }
  if (a.stage === 'wait') {
    // 예신(톡톡)에 바로 채면 물고기가 놀라 도망갑니다. 그 밖에는 찌만 살짝 움직입니다.
    if (est > a.lastNibble - 120 && est - a.lastNibble < 520) spook(a);
    else twitch(a);
  }
}

// ================================================================
// 단계별 처리
// ================================================================
function startWait(a, delay) {
  const q = spotQuality(a.bob.x, a.bob.z);
  a.plan = planBite(q, Math.random, delay || 0);
  a.quality = q;
  a.waitT0 = performance.now();
  a.nib = 0;
  a.fishPending = null;
  setStage(a, 'wait');
}

function landBobber(a) {
  const c = a.cast;
  a.bob.x = c.to[0];
  a.bob.z = c.to[1];
  a.bob.vis = true;
  a.bob.under = 0;
  a.cast = null;
  view.splash(a.bob.x, a.bob.z, 18, 0.7);
  view.ripple(a.bob.x, a.bob.z, 1.6, 1);
  setTimeout(() => view.ripple(a.bob.x, a.bob.z, 1.1, 0.6), 260);
  sfx.plop(clamp(1 - c.dist / 50, 0.25, 1));
  a.landBounce = performance.now();
  sendTo(a, 'cue', { kind: 'landed', dist: Math.round(c.dist) });
  startWait(a, 0);
}

function nibble(a, now) {
  a.lastNibble = now;
  a.nibAnim = now;
  view.ripple(a.bob.x, a.bob.z, 0.7, 0.55);
  sfx.nibble();
  sendTo(a, 'cue', { kind: 'nibble' });
}

function startBite(a, now) {
  a.fishPending = pickFish(a.quality == null ? 0.4 : a.quality);
  a.biteAt = now;
  a.biteDrift = (Math.random() - 0.5) * 1.2;
  setStage(a, 'bite');
  view.ripple(a.bob.x, a.bob.z, 1.3, 1);
  view.splash(a.bob.x, a.bob.z, 6, 0.35);
  sfx.bite();
  const strength = clamp(0.35 + a.fishPending.weight / 4, 0.3, 1);
  sendTo(a, 'bite', { strength: +strength.toFixed(2) });
  if (a.bot) a.bot2.hookAt = now + 240 + Math.random() * 520 + (Math.random() < 0.12 ? 700 : 0);
  tagFlash(a.slot, 'bite');
}

function hookFish(a, speed, lateMs) {
  const fish = a.fishPending || pickFish(0.4);
  const tip = nominalTip(a);
  const dx = a.bob.x - tip[0];
  const dz = a.bob.z - tip[2];
  const dist = Math.hypot(dx, dz);
  const lat = Math.atan2(-dx, dz);
  const hookQ = clamp((speed - 150) / 550, 0.3, 1);
  a.fight = newFight(fish, dist, lat, hookQ);
  a.rx = a.bob.x;
  a.rz = a.bob.z;
  a.hookAt = performance.now();
  a.fishPending = null;
  setStage(a, 'fight');
  view.splash(a.bob.x, a.bob.z, 26, 0.9);
  view.ripple(a.bob.x, a.bob.z, 2.2, 1);
  sfx.hook();
  sendTo(a, 'cue', { kind: 'hooked', quality: +hookQ.toFixed(2), late: Math.round(lateMs) });
  hudCall('히트!', `${a.name} · 물고기가 걸렸어요`, 'hit', 1400, a.color);
  // 배스는 걸리자마자 자주 뜁니다.
  if (fish.species !== 'blg' && Math.random() < 0.45) startJump(a);
}

function missBite(a, why) {
  a.fishPending = null;
  view.ripple(a.bob.x, a.bob.z, 1.0, 0.5);
  sendTo(a, 'result', { text: why === 'late' ? '조금 늦었어요' : '놓쳤어요', sub: '찌가 쏙 들어가면 바로 폰을 들어 올려요', kind: 'miss' });
  hudToast(a, '놓쳤어요', 'miss');
  sfx.miss();
  startWait(a, 2.2 + Math.random() * 2.5);
}

function spook(a) {
  view.ripple(a.bob.x, a.bob.z, 1.1, 0.6);
  sendTo(a, 'result', { text: '너무 일찍 챘어요', sub: '톡톡은 간 보기예요. 찌가 쭉 들어갈 때 채요', kind: 'miss' });
  hudToast(a, '너무 일찍!', 'miss');
  sfx.miss();
  startWait(a, 2.8 + Math.random() * 2.5);
}

function twitch(a) {
  a.nibAnim = performance.now();
  view.ripple(a.bob.x, a.bob.z, 0.6, 0.4);
}

function startJump(a) {
  const f = a.fight;
  if (!f) return;
  a.jump = { t0: performance.now(), dur: 900 + Math.random() * 250, x: a.rx, z: a.rz, h: 0.75 + Math.random() * 0.5, yaw: Math.random() * Math.PI * 2, thrown: false };
  view.splash(a.rx, a.rz, 30, 1);
  view.ripple(a.rx, a.rz, 1.8, 1);
  sfx.jump();
  sendTo(a, 'cue', { kind: 'jump' });
}

function finishFight(a) {
  a.fight = null;
  a.jump = null;
  sendTo(a, 'tension', { value: 0, fish: false });
}

function landFish(a) {
  const f = a.fight;
  const fish = f.fish;
  finishFight(a);
  a.total += fish.weight;
  a.count += 1;
  const pb = !a.best || fish.weight > a.best.weight;
  if (pb) a.best = fish;
  a.catches.push(fish);
  let top = true;
  for (const o of game.players.values()) if (o !== a && o.best && o.best.weight >= fish.weight) top = false;
  a.landed = { t0: performance.now(), fish, x: a.rx, z: a.rz };
  setStage(a, 'landed');
  view.splash(a.rx, a.rz, 22, 0.8);
  sfx.catchFish(fish.weight);
  const text = `${fish.name} ${fish.weight.toFixed(1)}kg!`;
  sendTo(a, 'result', {
    text, fish: fish.name, weight: fish.weight, species: fish.species, length: fish.length, kind: 'catch',
    best: pb, top, total: +a.total.toFixed(2), count: a.count
  });
  game.cards.push({ slot: a.slot, name: a.name, color: a.color, fish, pb: pb && a.count > 1, top: top && fish.weight >= 1.5 });
  renderBoard();
}

function loseFish(a, why) {
  const f = a.fight;
  finishFight(a);
  if (why === 'break') {
    view.splash(a.rx, a.rz, 14, 0.6);
    sfx.snap();
    sendTo(a, 'result', { text: '줄이 끊어졌어요!', sub: '물고기가 달릴 때(장력 빨강)는 감기를 멈춰요', kind: 'break' });
    hudToast(a, '줄 끊김', 'miss');
    a.bob.vis = false;
    a.lostAt = performance.now();
    setStage(a, 'lost');
  } else {
    // 바늘이 빠짐: 찌만 둥실 떠오릅니다.
    a.bob.x = a.rx;
    a.bob.z = a.rz;
    view.ripple(a.rx, a.rz, 1.2, 0.7);
    sfx.miss();
    const text = why === 'time' ? '시간이 끝났어요' : '바늘이 빠졌어요';
    const sub = why === 'time' ? '아쉽지만 이번 물고기는 놓아줘요' : '줄이 느슨하지 않게 계속 감아요';
    sendTo(a, 'result', { text, sub, kind: 'unhook' });
    hudToast(a, why === 'time' ? '시간 초과' : '바늘 빠짐', 'miss');
    if (game.overtime) {
      a.bob.vis = false;
      setStage(a, 'done');
    } else startWait(a, 4 + Math.random() * 3);
  }
  void f;
}

// ================================================================
// 경기 흐름
// ================================================================
function startGame() {
  if (game.phase === 'playing') return;
  syncRoster();
  const list = lobbyPlayers().filter((p) => p.connected);
  if (!list.length) {
    lobbyMessage('폰을 먼저 연결해 주세요. QR을 찍고 시작하기를 누르면 자리가 생겨요.');
    return;
  }
  audio();
  game.players.clear();
  for (const p of list) game.players.set(p.slot, newAngler(p));
  layoutSpots();
  for (const a of game.players.values()) a.xs = a.x;
  view.setPlayers(anglers().map((a) => ({ slot: a.slot, color: a.color, name: a.name })));
  game.phase = 'playing';
  game.startAt = performance.now();
  game.endAt = game.startAt + SESSION * 1000;
  game.overtime = false;
  game.cards = [];
  game.card = null;
  game.results = [];
  game.lastBeep = 0;
  $('lobby').classList.add('hidden');
  $('over').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('join').classList.remove('hidden');
  hideCard();
  hudCall('낚시 시작!', '폰을 뒤로 젖혔다가 앞으로 휙 던져요', 'start', 2400);
  sfx.start();
  setAmbience(true);
  pushState();
  renderBoard();
}

function timeUp() {
  game.overtime = true;
  let fighting = 0;
  for (const a of game.players.values()) {
    if (a.stage === 'fight' || a.stage === 'landed') {
      if (a.stage === 'fight') fighting += 1;
      continue;
    }
    a.cast = null;
    a.plan = null;
    a.fishPending = null;
    a.bob.vis = false;
    setStage(a, 'done');
  }
  sfx.horn();
  hudCall('타임 업!', fighting ? '걸려 있는 물고기는 끝까지 끌어올려요' : '조과를 집계해요', 'time', 2600);
  pushState();
}

function endGame() {
  game.phase = 'over';
  game.cards = []; // 못 보여 준 조과 카드는 버립니다(결과 화면 위에 뜨지 않게)
  for (const a of game.players.values()) {
    if (a.fight) finishFight(a);
    a.bob.vis = false;
    a.stage = 'done';
  }
  const rows = anglers().map((a) => ({ slot: a.slot, name: a.name, color: a.color, total: a.total, count: a.count, best: a.best }));
  rows.sort((x, y) => y.total - x.total || y.count - x.count || (y.best ? y.best.weight : 0) - (x.best ? x.best.weight : 0));
  game.results = rows;
  const box = $('podium');
  box.innerHTML = '';
  rows.forEach((r, i) => {
    const e = document.createElement('div');
    e.className = 'r';
    e.style.setProperty('--c', r.color);
    e.style.animationDelay = `${0.15 + i * 0.12}s`;
    const best = r.best ? `${r.best.name} ${r.best.weight.toFixed(1)}kg` : '-';
    e.innerHTML = `<span class="rank">${i + 1}</span><span class="who">${r.name}</span>` +
      `<span class="num"><b>${r.count}</b><span>마리</span></span>` +
      `<span class="num wide"><b class="sm">${best}</b><span>최대어</span></span>` +
      `<span class="num"><b>${r.total.toFixed(1)}<small>kg</small></b><span>총 무게</span></span>`;
    box.appendChild(e);
  });
  $('hud').classList.add('hidden');
  $('join').classList.add('hidden');
  $('cards').innerHTML = '';
  $('tags').innerHTML = '';
  cardEls.clear();
  tagEls.clear();
  hideCard();
  $('over').classList.remove('hidden');
  sfx.fanfare();
  setAmbience(false);
  // 각자 순위를 폰에도 알려 줍니다.
  rows.forEach((r, i) => {
    const a = game.players.get(r.slot);
    if (a) sendTo(a, 'result', { text: `${i + 1}위 · 총 ${r.total.toFixed(1)}kg`, sub: `${r.count}마리${r.best ? ` · 최대어 ${r.best.name} ${r.best.weight.toFixed(1)}kg` : ''}`, kind: 'final', rank: i + 1, total: +r.total.toFixed(2) });
  });
  pushState();
}

function backToLobby(why) {
  game.phase = 'lobby';
  for (const a of game.players.values()) a.fight = null;
  game.players.clear();
  $('hud').classList.add('hidden');
  $('join').classList.add('hidden');
  $('over').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  $('cards').innerHTML = '';
  $('tags').innerHTML = '';
  cardEls.clear();
  tagEls.clear();
  hideCard();
  setAmbience(false);
  syncRoster();
  if (why) lobbyMessage(why);
  pushState();
}

// ================================================================
// 매 프레임: 낚시꾼마다 단계 진행
// ================================================================
function updateAngler(a, now, dt) {
  a.xs += (a.x - a.xs) * Math.min(1, dt * 3);
  // 감기 입력은 메시지가 끊기면 금방 0 으로 떨어집니다.
  if (now - a.reel.at > 320) a.reel.omega = Math.max(0, a.reel.omega - dt * 12);
  a.reel.spin += a.reel.omega * Math.PI * 2 * dt;
  if (!a.bot && a.pose && now - a.pose.at > 1500) a.tilt *= Math.exp(-dt * 2);

  if (a.stage === 'cast') {
    const c = a.cast;
    if (now - c.t0 >= c.pre + c.dur) landBobber(a);
  } else if (a.stage === 'wait') {
    // 감으면 찌가 끌려옵니다. 가까워지면 다시 던질 수 있게 됩니다.
    const om = a.reel.omega;
    if (om > 0.05) {
      const tip = nominalTip(a);
      const dx = tip[0] - a.bob.x;
      const dz = tip[2] - a.bob.z;
      const d = Math.hypot(dx, dz);
      const step = Math.min(d, om * LINE_PER_TURN * dt);
      a.bob.x += (dx / (d || 1)) * step;
      a.bob.z += (dz / (d || 1)) * step;
      a.waitT0 += dt * 1000 * 0.8; // 움직이는 찌에는 입질이 늦습니다
      if (now - a.ripAt > 260) {
        a.ripAt = now;
        view.ripple(a.bob.x, a.bob.z, 0.45, 0.35);
      }
      if (d < 3.2 || a.bob.z < DOCK.z1 + 1.2) {
        a.bob.vis = false;
        a.plan = null;
        setStage(a, 'ready');
        return;
      }
    }
    if (a.plan && !game.overtime) {
      const t = (now - a.waitT0) / 1000;
      if (a.nib < a.plan.nibbles.length && t >= a.plan.nibbles[a.nib]) {
        a.nib += 1;
        nibble(a, now);
      } else if (t >= a.plan.bite) startBite(a, now);
    }
    if (now - a.ripAt > 2600) {
      a.ripAt = now;
      view.ripple(a.bob.x, a.bob.z, 0.55, 0.22);
    }
  } else if (a.stage === 'bite') {
    // 물고기가 미끼를 물고 조금씩 끌고 갑니다.
    a.bob.x += a.biteDrift * dt * 0.4;
    a.bob.z += dt * 0.25;
    const decideAt = a.biteAt + HOOK_WINDOW * 1000 + a.rtt + displayRtt() + 120;
    if (now > decideAt) missBite(a, 'miss');
  } else if (a.stage === 'fight') {
    const f = a.fight;
    const events = stepFight(f, dt, { omega: a.reel.omega, tilt: a.tilt });
    const tip = nominalTip(a);
    let fx = tip[0] - Math.sin(f.lat) * f.D;
    let fz = tip[2] + Math.cos(f.lat) * f.D;
    // 물가와 선착장 밑으로는 못 가게
    if (lakeQ(fx, fz) > 0.92) {
      f.latVel = -f.latVel;
      f.lat *= 0.98;
      fx = tip[0] - Math.sin(f.lat) * f.D;
      fz = tip[2] + Math.cos(f.lat) * f.D;
    }
    fz = Math.max(fz, DOCK.z1 + 0.6);
    a.rx += (fx - a.rx) * Math.min(1, dt * 6);
    a.rz += (fz - a.rz) * Math.min(1, dt * 6);
    if (now - a.ripAt > (f.mode === 'run' ? 140 : 320)) {
      a.ripAt = now;
      view.ripple(a.rx, a.rz, f.mode === 'run' ? 0.9 : 0.6, f.mode === 'run' ? 0.7 : 0.4);
      if (f.mode === 'run' && Math.random() < 0.35) view.splash(a.rx, a.rz, 3, 0.25);
    }
    if (a.jump && !a.jump.thrown && now - a.jump.t0 > a.jump.dur * 0.45) {
      a.jump.thrown = true;
      if (jumpThrow(f)) {
        loseFish(a, 'unhook');
        return;
      }
    }
    if (a.jump && now - a.jump.t0 > a.jump.dur) {
      view.splash(a.jump.x, a.jump.z, 26, 0.9);
      view.ripple(a.jump.x, a.jump.z, 1.6, 0.9);
      sfx.splash(0.8);
      a.jump = null;
    }
    for (const e of events) {
      if (e === 'jump') startJump(a);
      else if (e === 'run') sfx.dragBurst(f.P);
      else if (e === 'slack') sendTo(a, 'cue', { kind: 'slack' });
      else if (e === 'landed') {
        landFish(a);
        return;
      } else if (e === 'break' || e === 'unhook') {
        loseFish(a, e);
        return;
      }
    }
    if (f.drag) sfx.drag(a.slot, f.T);
    if (now - a.lastTension >= TENSION_MS) {
      a.lastTension = now;
      const side = Math.abs(f.latVel) > 0.25 ? Math.sign(f.latVel) : 0;
      sendTo(a, 'tension', {
        value: +f.T.toFixed(3), fish: true, dist: +f.D.toFixed(1), drag: f.drag, run: f.mode === 'run',
        side, tilt: +a.tilt.toFixed(2), stamina: +f.S.toFixed(2)
      });
    }
  } else if (a.stage === 'landed') {
    if (now - a.landed.t0 > 3000) {
      a.landed = null;
      a.bob.vis = false;
      setStage(a, game.overtime ? 'done' : 'ready');
    }
  } else if (a.stage === 'lost') {
    if (now - a.lostAt > 1500) setStage(a, game.overtime ? 'done' : 'ready');
  }
}

// ---------- 봇(시험용) ----------
function botThink(a, now) {
  if (!a.bot || now < a.manualUntil) return;
  const b = a.bot2;
  if (a.stage !== 'ready') b.castAt = 0;
  if (a.stage === 'ready') {
    if (!b.castAt) b.castAt = now + 800 + Math.random() * 1800;
    if (now < b.castAt) return;
    b.castAt = 0;
    let aim = (Math.random() - 0.5) * 50;
    let power = 0.45 + Math.random() * 0.5;
    if (Math.random() < 0.55) {
      // 연잎 근처를 노립니다.
      const tip = nominalTip(a);
      const targets = [[10.5, 17], [-13, 27], [3.5, 41]];
      const t = targets[Math.floor(Math.random() * targets.length)];
      aim = clamp(Math.atan2(-(t[0] - tip[0]), t[1] - tip[2]) / RD + (Math.random() - 0.5) * 8, -AIM_MAX, AIM_MAX);
      power = clamp((Math.hypot(t[0] - tip[0], t[1] - tip[2]) - 8) / 30 + (Math.random() - 0.5) * 0.1, 0.1, 1);
    }
    onCast(a.slot, { power, aim, rtt: 0 });
  } else if (a.stage === 'wait') {
    if (now - a.stageAt > 24000) onCast(a.slot, { power: 0.5 + Math.random() * 0.4, aim: (Math.random() - 0.5) * 50, rtt: 0 });
  } else if (a.stage === 'bite') {
    if (b.hookAt && now >= b.hookAt) {
      b.hookAt = 0;
      onHookset(a.slot, { speed: 380 + Math.random() * 500, ago: 0, rtt: 0 }, now);
    }
  } else if (a.stage === 'fight') {
    if (now < (b.reelNext || 0)) return;
    b.reelNext = now + 120 + Math.random() * 120;
    let om = botReel(a.fight, 0.6 + Math.random() * 0.4);
    // 가끔 장력을 못 보고 계속 감는 실수도 합니다.
    if (b.lapse > now) om = Math.max(om, 1.8);
    else if (Math.random() < 0.012) b.lapse = now + 500;
    b.total = (b.total || 0) + om * 0.15;
    onReel(a.slot, { rate: om, turns: om * 0.15, total: b.total });
    const f = a.fight;
    b.tilt = f && Math.abs(f.latVel) > 0.2 && Math.random() < 0.7 ? -Math.sign(f.latVel) * 0.8 : b.tilt * 0.6;
    a.tilt = b.tilt;
  }
}

// ---------- 키보드(시험용): 첫 자리를 조종합니다 ----------
const keys = new Set();
const kb = { aim: 0, reelTotal: 0 };
function kbAngler() {
  const list = anglers();
  return list[0] || null;
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (game.phase !== 'playing') startGame();
    return;
  }
  audio();
  if (e.repeat) return;
  keys.add(e.code);
  const a = kbAngler();
  if (!a || game.phase !== 'playing') return;
  a.manualUntil = performance.now() + 10000;
  if (e.code === 'KeyC') onCast(a.slot, { power: 0.45 + Math.random() * 0.45, aim: kb.aim, rtt: 0 });
  else if (e.code === 'Space' || e.code === 'KeyH') {
    e.preventDefault();
    onHookset(a.slot, { speed: 650, ago: 0, rtt: 0 }, performance.now());
  } else if (e.code === 'ArrowLeft') kb.aim = clamp(kb.aim - 7, -AIM_MAX, AIM_MAX);
  else if (e.code === 'ArrowRight') kb.aim = clamp(kb.aim + 7, -AIM_MAX, AIM_MAX);
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') hudCall(`조준 ${kb.aim > 0 ? '오른쪽' : kb.aim < 0 ? '왼쪽' : '정면'} ${Math.abs(kb.aim)}°`, '', 'mini', 700);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
function keyboardTick(now, dt) {
  const a = kbAngler();
  if (!a || game.phase !== 'playing' || now > a.manualUntil) return;
  if (keys.has('KeyR')) {
    a.manualUntil = now + 10000;
    kb.reelTotal += 2.4 * dt;
    if (!a._kbAt || now - a._kbAt > 66) {
      a._kbAt = now;
      onReel(a.slot, { rate: 2.4, turns: 2.4 * 0.066, total: kb.reelTotal });
    }
  }
  if (keys.has('KeyA')) a.tilt = 1;
  else if (keys.has('KeyD')) a.tilt = -1;
  else if (!a.pose) a.tilt *= Math.exp(-dt * 4);
}

// ================================================================
// 장면에 넘길 값
// ================================================================
function rodFor(a, now, dt) {
  const r = a.rod;
  const live = a.pose && now - a.pose.at < POSE_FRESH_MS && a.stage !== 'landed';
  let elev;
  let yaw;
  if (live) {
    const s = a.pose.s;
    elev = Math.atan2(s[1], Math.hypot(s[0], s[2]) * Math.sign(s[2] || 1)) / RD;
    yaw = Math.atan2(s[0], Math.max(0.05, Math.abs(s[2]))) / RD;
    elev = clamp(elev, -12, 118);
    yaw = clamp(yaw, -70, 70);
  } else {
    // 센서가 없을 때(봇·버튼)는 단계에 맞는 자세를 그립니다.
    let te = 38;
    let ty = 0;
    if (a.stage === 'ready') te = 42 + Math.sin(now / 900 + a.slot) * 3;
    if (a.stage === 'cast' && a.cast) {
      const k = (now - a.cast.t0 - a.cast.pre) / 1000;
      te = k < -0.25 ? 40 : k < 0 ? 40 + 55 * (1 + k / 0.25) : k < 0.16 ? 95 - 80 * (k / 0.16) : 18;
      ty = a.cast.aim * 0.8;
    }
    if (a.stage === 'wait' || a.stage === 'bite') {
      te = 26;
      ty = bobberYaw(a);
    }
    if (a.stage === 'fight') {
      te = 40 + (a.fight ? a.fight.T * 16 : 0);
      ty = clamp(bobberYaw(a) * 0.8 - a.tilt * 30, -65, 65);
    }
    if (a.stage === 'landed') te = 72;
    const kick = now - r.kickAt;
    if (a.stage !== 'cast' && kick >= 0 && kick < 450) te += 32 * Math.sin((kick / 450) * Math.PI);
    elev = te;
    yaw = ty;
  }
  // 프레임 간격에 맞춘 보간(60Hz 에서 예전 값과 같은 느낌: 한 프레임에 약 0.59 / 0.27)
  const k = 1 - Math.exp(-(live ? 56 : 19.5) * (dt || 0));
  r.elev += (elev - r.elev) * k;
  r.yaw += (yaw - r.yaw) * k;
  const e = r.elev * RD;
  const y = r.yaw * RD;
  return [-Math.sin(y) * Math.cos(e), Math.sin(e), Math.cos(y) * Math.cos(e)];
}
function bobberYaw(a) {
  const tip = nominalTip(a);
  const x = a.stage === 'fight' ? a.rx : a.bob.x;
  const z = a.stage === 'fight' ? a.rz : a.bob.z;
  return clamp(Math.atan2(-(x - tip[0]), Math.max(1, z - tip[2])) / RD, -60, 60);
}

function renderData(a, now, dt) {
  const d = { slot: a.slot, color: a.color, name: a.name, x: a.xs, rodDir: rodFor(a, now, dt), bend: 0, omega: a.reel.omega, spin: a.reel.spin,
    bob: null, slack: 0.6, fish: null, shadow: null, cranking: a.reel.omega > 0.2, stage: a.stage };
  if (a.stage === 'ready' || a.stage === 'lost' || a.stage === 'done') {
    d.bob = a.stage === 'lost' ? null : { mode: 'tip' };
  } else if (a.stage === 'cast' && a.cast) {
    const c = a.cast;
    const t = Math.max(0, now - c.t0);
    if (c.pre > 0 && t < c.pre) {
      const u = t / c.pre;
      const tip = tipOf(a);
      d.bob = { mode: 'fly', p: [c.from[0] + (tip[0] - c.from[0]) * u, 0.1 + (tip[1] - 0.1) * u * u, c.from[2] + (tip[2] - c.from[2]) * u] };
    } else {
      const u = clamp((t - c.pre) / c.dur, 0, 1);
      const from = c.pre ? tipOf(a) : c.from;
      const apex = 1.2 + c.dist * 0.13;
      const e = 1 - Math.pow(1 - u, 1.6); // 처음엔 빠르고 끝에 느려집니다(줄 저항)
      const x = from[0] + (c.to[0] - from[0]) * e;
      const z = from[2] + (c.to[1] - from[2]) * e;
      const y = from[1] * (1 - u) + 4 * apex * u * (1 - u) * 0.9 + 0.02;
      d.bob = { mode: 'fly', p: [x, Math.max(0.03, y), z] };
    }
    d.slack = 0.15;
  } else if (a.stage === 'wait' || a.stage === 'bite') {
    let under = 0;
    const nk = (now - a.nibAnim) / 1000;
    if (nk >= 0 && nk < 0.5) under = 0.45 * Math.sin((nk / 0.5) * Math.PI);
    const lb = (now - (a.landBounce || 0)) / 1000;
    if (lb >= 0 && lb < 0.9) under = Math.max(under, 0.5 * Math.exp(-lb * 5) * Math.cos(lb * 14));
    if (a.stage === 'bite') under = clamp((now - a.biteAt) / 160, 0, 1.4);
    d.bob = { mode: 'float', p: [a.bob.x, 0, a.bob.z], under };
    d.slack = 0.85;
  } else if (a.stage === 'fight' && a.fight) {
    const f = a.fight;
    d.bend = f.T;
    d.slack = clamp(1 - f.T * 3, 0, 1);
    d.bob = { mode: 'float', p: [a.rx, 0, a.rz], under: clamp(0.35 + f.T * 0.6, 0, 0.95), skate: f.mode === 'run' ? 1 : 0.4 };
    if (a.jump) {
      const j = a.jump;
      const u = clamp((now - j.t0) / j.dur, 0, 1);
      const size = f.fish.length;
      d.fish = {
        p: [j.x, -0.15 + Math.sin(u * Math.PI) * j.h * (1 + size), j.z], yaw: j.yaw, pitch: (0.5 - u) * 1.9,
        roll: Math.sin(u * 22) * 0.5, flap: 1, size, species: f.fish.species, airborne: true
      };
      d.bob.under = 0.2;
    } else if (f.D < 9) {
      d.shadow = { p: [a.rx, a.rz], yaw: Math.atan2(a.rx - nominalTip(a)[0], a.rz - nominalTip(a)[2]), size: f.fish.length, alpha: clamp((9 - f.D) / 7, 0, 1) * 0.55 };
    }
  } else if (a.stage === 'landed' && a.landed) {
    const L = a.landed;
    const t = (now - L.t0) / 1000;
    const rise = clamp(t / 0.55, 0, 1);
    d.bend = 0.55;
    d.slack = 0;
    d.fish = { hang: true, rise, from: [L.x, 0, L.z], flap: t < 2.2 ? 1 : 0.4, size: L.fish.length, species: L.fish.species, yaw: Math.sin(t * 2) * 0.6 };
    d.bob = { mode: 'hang' };
  }
  return d;
}

// ================================================================
// HUD
// ================================================================
const cardEls = new Map();
const tagEls = new Map();

function renderLobby() {
  const box = $('slots');
  if (!box) return;
  box.innerHTML = '';
  const list = lobbyPlayers();
  for (let s = 1; s <= 4; s++) {
    const p = list.find((x) => x.slot === s);
    const e = document.createElement('div');
    e.className = 'slot' + (p ? ' on' : '') + (p && !p.connected ? ' away' : '') + (p && p.bot ? ' bot' : '');
    if (p) {
      e.style.setProperty('--c', p.color);
      e.innerHTML = `<b>${p.name}</b><small>${p.bot ? 'BOT' : p.connected ? '준비' : '연결 끊김'}</small>`;
    } else e.textContent = `${s}P 비어 있음`;
    box.appendChild(e);
  }
}
let msgTimer = null;
function lobbyMessage(t) {
  const e = $('msg');
  e.textContent = t;
  e.classList.add('on');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => e.classList.remove('on'), 2800);
}

let callTimer = null;
function hudCall(main, sub, kind, ms, color) {
  const el = $('call');
  el.className = `call ${kind || ''}`;
  if (color) el.style.setProperty('--c', color);
  $('callMain').textContent = main;
  $('callSub').textContent = sub || '';
  void el.offsetWidth;
  el.classList.add('on');
  clearTimeout(callTimer);
  callTimer = setTimeout(() => el.classList.remove('on'), ms || 1500);
}
function hudToast(a, text, kind) {
  const c = cardEls.get(a.slot);
  if (!c) return;
  const t = c.querySelector('.toast');
  t.textContent = text;
  t.className = `toast ${kind || ''}`;
  void t.offsetWidth;
  t.classList.add('on');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('on'), 1800);
}
function tagFlash(slot, kind) {
  const t = tagEls.get(slot);
  if (!t) return;
  t.classList.remove('flash');
  void t.offsetWidth;
  t.classList.add('flash');
  // 남겨 두면 표시가 다시 켜질 때마다 애니메이션이 또 돌므로 끝나면 뺍니다.
  clearTimeout(t._flashTimer);
  t._flashTimer = setTimeout(() => t.classList.remove('flash'), 600);
  void kind;
}

function renderBoard() {
  const b = $('board');
  if (!b) return;
  b.innerHTML = '';
  const rows = anglers().sort((x, y) => y.total - x.total || y.count - x.count);
  for (const a of rows) {
    const r = document.createElement('div');
    r.className = 'row';
    r.innerHTML = `<i style="background:${a.color}"></i><span class="n">${a.name}</span><span class="c">${a.count}마리</span>` +
      `<b>${a.total.toFixed(1)}</b><small>kg</small>`;
    b.appendChild(r);
  }
}

function ensureCard(a) {
  let c = cardEls.get(a.slot);
  if (c) return c;
  c = document.createElement('div');
  c.className = 'pcard';
  c.innerHTML = `<div class="toast"></div><div class="ph"><span class="pn"></span><span class="ps"></span></div>` +
    `<div class="pm"><div class="pt"><b class="pkg">0.0</b><small>kg</small><span class="pcnt">0마리</span></div>` +
    `<div class="pbar"><i></i><em></em></div><div class="pline"></div></div>`;
  c.style.setProperty('--c', a.color);
  c.querySelector('.pn').textContent = a.name;
  $('cards').appendChild(c);
  cardEls.set(a.slot, c);
  return c;
}
function ensureTag(a) {
  let t = tagEls.get(a.slot);
  if (t) return t;
  t = document.createElement('div');
  t.className = 'btag';
  t.innerHTML = '<span class="bn"></span><span class="bx">!</span>';
  t.style.setProperty('--c', a.color);
  t.querySelector('.bn').textContent = a.name;
  $('tags').appendChild(t);
  tagEls.set(a.slot, t);
  return t;
}

function updateHud(now, datas) {
  if (game.phase !== 'playing') return;
  // 남은 시간
  const left = timeLeft(now);
  const m = Math.floor(Math.ceil(left) / 60);
  const s = Math.ceil(left) % 60;
  $('timeNum').textContent = game.overtime ? '연장' : `${m}:${String(s).padStart(2, '0')}`;
  $('timer').classList.toggle('hurry', !game.overtime && left <= 10);
  $('timer').classList.toggle('ot', game.overtime);
  const frac = game.overtime ? 1 : left / SESSION;
  $('timeArc').style.strokeDashoffset = String((1 - frac) * 289);
  if (!game.overtime && left <= 10 && left > 0 && Math.ceil(left) !== game.lastBeep) {
    game.lastBeep = Math.ceil(left);
    sfx.beep(left <= 3);
  }

  const W = window.innerWidth;
  for (const a of anglers()) {
    const c = ensureCard(a);
    const head = view.project(a.xs, 0.2, 0.2);
    const cw = (c.offsetWidth || 220) * UI;
    const x = clamp(head.x - cw / 2, 12, W - cw - 12) / UI;
    c.style.transform = `translate(${x.toFixed(0)}px, 0)`;
    c.querySelector('.pkg').textContent = a.total.toFixed(1);
    c.querySelector('.pcnt').textContent = `${a.count}마리`;
    const st = c.querySelector('.ps');
    let label = STAGE_LABEL[a.stage] || '';
    if (a.stage === 'wait' && a.plan && a.nib > 0) label = '톡톡… 예신';
    st.textContent = label;
    c.className = `pcard s-${a.stage}${!a.bot && !infoOf(a.slot).connected ? ' away' : ''}`;
    const bar = c.querySelector('.pbar');
    const line = c.querySelector('.pline');
    if (a.stage === 'fight' && a.fight) {
      const f = a.fight;
      bar.style.setProperty('--t', `${clamp(f.T, 0, 1.1) * 100 / 1.1}%`);
      bar.classList.toggle('hot', f.T > 0.85);
      bar.classList.toggle('drag', f.drag);
      line.textContent = `${f.D.toFixed(1)}m${f.mode === 'run' ? ' · 달린다!' : f.mode === 'charge' ? ' · 다가온다' : ''}`;
    } else {
      line.textContent = a.best ? `최대 ${a.best.name} ${a.best.weight.toFixed(1)}kg` : a.bot ? 'BOT' : '';
    }
  }
  // 찌 위 표시
  for (const d of datas) {
    const a = game.players.get(d.slot);
    const t = ensureTag(a);
    // 입질 중에는 찌가 물속으로 사라져도 그 자리(끌려가는 위치)에 '!' 를 계속 띄웁니다.
    const bp = a.stage === 'bite' ? [a.bob.x, 0, a.bob.z] : view.bobberPos(d.slot);
    // 물고기가 뛰어오를 때는 표시를 잠깐 치워 점프가 가려지지 않게 합니다.
    const show = bp && !a.jump && (a.stage === 'wait' || a.stage === 'bite' || a.stage === 'fight' || a.stage === 'cast');
    t.classList.toggle('on', Boolean(show));
    if (!show) continue;
    const pr = view.project(bp[0], bp[1] + 0.35, bp[2]);
    t.style.transform = `translate(${(pr.x / UI).toFixed(0)}px, ${(pr.y / UI).toFixed(0)}px)`;
    t.classList.toggle('bite', a.stage === 'bite');
    t.classList.toggle('fight', a.stage === 'fight');
    t.classList.toggle('nib', a.stage === 'wait' && now - a.nibAnim < 500);
  }
}

// ---------- 조과 카드 ----------
let cardTimer = 0;
function showNextCard(now) {
  if (game.card && now < cardTimer) return;
  if (game.card) hideCard();
  const c = game.cards.shift();
  if (!c) return;
  game.card = c;
  cardTimer = now + 3600;
  const el = $('catch');
  el.style.setProperty('--c', c.color);
  $('catchWho').textContent = c.name;
  $('catchName').textContent = c.fish.name;
  $('catchEn').textContent = c.fish.en;
  $('catchKg').innerHTML = `${c.fish.weight.toFixed(1)}<small>kg</small>`;
  $('catchLen').textContent = `${Math.round(c.fish.length * 100)}cm`;
  const badge = $('catchBadge');
  badge.textContent = c.top ? '오늘의 최대어' : c.pb ? '개인 최고' : '';
  badge.classList.toggle('hidden', !c.top && !c.pb);
  el.classList.remove('on');
  void el.offsetWidth;
  el.classList.add('on');
  view.setShowcase(c.fish);
}
function hideCard() {
  game.card = null;
  $('catch').classList.remove('on');
  view.setShowcase(null);
}

// ================================================================
// 매 프레임
// ================================================================
let last = performance.now();
function tick() {
  const now = performance.now();
  // 그림은 프레임 간격(최대 0.05초)으로, 판정은 실제 흐른 시간을 잘게 나눠 돌립니다(느린 화면에서도 같은 속도).
  const real = Math.min(0.5, Math.max(0, (now - last) / 1000));
  const dt = Math.min(0.05, real);
  last = now;
  let mode = 'lobby';
  const datas = [];
  if (game.phase === 'playing') {
    mode = 'play';
    keyboardTick(now, real);
    const steps = Math.max(1, Math.ceil(real / 0.02));
    for (const a of anglers()) {
      botThink(a, now);
      for (let i = 0; i < steps && game.phase === 'playing'; i++) updateAngler(a, now, real / steps);
    }
    if (!game.overtime && now >= game.endAt) timeUp();
    if (game.overtime) {
      const busy = anglers().some((a) => a.stage === 'fight' || a.stage === 'landed');
      if (!busy && !game.card && !game.cards.length) endGame();
      else if (now > game.endAt + OVERTIME_SEC * 1000) {
        for (const a of anglers()) if (a.stage === 'fight') loseFish(a, 'time');
        if (!anglers().some((a) => a.stage === 'landed')) endGame();
      }
    }
    if (game.phase === 'playing' && now - game.lastStatePush > 5000) pushState();
    if (game.phase === 'playing') showNextCard(now);
  } else if (game.phase === 'over') mode = 'over';
  for (const a of anglers()) {
    if (game.phase !== 'playing') a.xs += (a.x - a.xs) * Math.min(1, dt * 3);
    datas.push(renderData(a, now, dt));
  }
  let inset = null;
  if (game.card) {
    const r = $('catchFish').getBoundingClientRect();
    if (r.width > 10) inset = { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  view.frame(now, dt, { mode, players: datas, inset });
  updateHud(now, datas);
  if (DEBUG) debugPanel(now);
  requestAnimationFrame(tick);
}

function debugPanel() {
  const lines = anglers().map((a) => {
    const f = a.fight;
    return `${a.name} ${a.stage} rtt${Math.round(a.rtt)} om${a.reel.omega.toFixed(1)} tilt${a.tilt.toFixed(2)}` +
      (f ? ` T${f.T.toFixed(2)} D${f.D.toFixed(1)} S${f.S.toFixed(2)} ${f.mode}${f.drag ? ' DRAG' : ''}` : '');
  });
  $('debug').textContent = `display rtt ${Math.round(displayRtt())}ms\n${lines.join('\n')}`;
}

renderLobby();
syncRoster();
requestAnimationFrame(tick);
if (AUTOSTART && BOTS > 0) setTimeout(() => startGame(), 1200);
if (DEBUG) $('debug').classList.remove('hidden');
window.addEventListener('pointerdown', () => audio());

// 디버그: 콘솔에서 상태 보기
window.__fishing = { game, view, startGame, endGame, timeUp, onCast, onHookset, onReel, onPose, startJump, lobbyPlayers, displayRtt };
