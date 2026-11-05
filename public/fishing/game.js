// 배스 낚시 큰 화면(1인칭 · 늘 열린 호수). 폰 1~4대가 같은 물에서 동시에, 동작으로 낚시합니다.
// 대기실·시간 제한 없이 QR 을 찍으면 바로 자리가 생기고, 나가면 15초 뒤 자리가 비워집니다.
// 서버는 방과 이벤트만 중계하고 판정은 모두 여기서 합니다.
import { createScene } from './scene.js';
import { sfx, audio, setAmbience } from './sfx.js';
import { createPond, POP } from './fishai.js';
import {
  HOOK_WINDOW, LINE_PER_TURN, AIM_MAX, CAST_MIN, CAST_MAX, RETRIEVE_DONE, BAIT_DEPTH, AREA, EYE,
  castTarget, aimFor, newFight, stepFight, jumpThrow, botReel, lakeQ, bedDepth, laneFracs
} from './logic.js';

const SLOT_INFO = {
  1: { name: '1P', color: '#ff5a5f' },
  2: { name: '2P', color: '#3ab4ff' },
  3: { name: '3P', color: '#ffc93c' },
  4: { name: '4P', color: '#5ee07a' }
};
const TENSION_MS = 125; // 장력은 약 8Hz 로 보냅니다
const POSE_FRESH_MS = 400;
const REEL_IN_MS = 950; // 찌가 나가 있을 때 다시 던지면 먼저 감아 들이는 시간
const LAND_SHOW_MS = 2600; // 들어 올린 물고기를 보여 주는 시간
const HEARTBEAT_MS = 5000;

const $ = (id) => document.getElementById(id);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const params = new URLSearchParams(location.search);
const BOTS = clamp(parseInt(params.get('bots'), 10) || 0, 0, 4);
const DEBUG = params.has('debug');
const FISH_N = clamp(parseInt(params.get('fish'), 10) || POP, 1, 30);
const RD = Math.PI / 180;

await Promise.race([
  Promise.all([document.fonts.load('400 64px Anton'), document.fonts.load('800 64px "Pretendard Variable"')]),
  new Promise((r) => setTimeout(r, 2000))
]).catch(() => {});
const view = createScene($('cv'));
const pond = createPond({ count: FISH_N, now: performance.now() / 1000, inView: (x, y, z, r) => view.inView(x, y, z, r) });

// 화면 크기에 맞춰 HUD 를 키우고 줄입니다(1600×900 기준).
let UI = 1;
function applyUi() {
  UI = clamp(Math.min(window.innerWidth / 1600, window.innerHeight / 900), 0.55, 1.8);
  document.documentElement.style.setProperty('--ui', UI.toFixed(3));
}
window.addEventListener('resize', applyUi);
applyUi();

// ================================================================
// 연결
// ================================================================
const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true });
let serverPlayers = [];
let roomCode = null;
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
function sendTo(a, event, data) {
  if (a.bot) return;
  send(event, data, a.slot);
}

socket.on('connect', () => {
  let saved = null;
  try { saved = sessionStorage.getItem('pcg-fishing-room'); } catch (e) {}
  socket.emit('join', { role: 'display', game: 'fishing', room: saved });
});
socket.on('room', async (r) => {
  try { sessionStorage.setItem('pcg-fishing-room', r.code); } catch (e) {}
  roomCode = r.code;
  serverPlayers = r.players || [];
  $('code').textContent = r.code;
  syncRoster();
  pushState();
  try {
    const res = await fetch(`/api/qr?room=${r.code}`).then((x) => x.json());
    $('qrImg').src = res.qr;
    const local = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(location.hostname) || location.hostname.endsWith('.localhost');
    $('warn').classList.toggle('hidden', Boolean(res.secure) || local);
  } catch (e) {}
});
socket.on('players', (payload) => {
  const before = new Set(serverPlayers.map((x) => x.slot));
  serverPlayers = payload.players || [];
  for (const pl of serverPlayers) if (!before.has(pl.slot)) sfx.join();
  syncRoster();
  pushState();
});
socket.on('display_replaced', () => $('replaced').classList.remove('hidden'));
socket.on('start_game', () => {}); // 늘 열린 호수: 시작 버튼이 없습니다
socket.on('pose', (d) => onPose(d.slot, d));
socket.on('calibrate', (d) => onCalibrate(d.slot, d));
socket.on('cast', (d) => onCast(d.slot, d));
socket.on('hookset', (d) => onHookset(d.slot, d, performance.now()));
socket.on('reel', (d) => onReel(d.slot, d));

// ================================================================
// 사람(낚싯대) 목록
// ================================================================
const game = {
  players: new Map(), // slot -> 낚시꾼
  record: null, // 오늘의 최대어 { slot, name, color, weight, fish }
  cards: [],
  card: null,
  lastPush: 0,
  fps: 0
};

function newAngler(info) {
  return {
    slot: info.slot, name: info.name, color: info.color, bot: Boolean(info.bot), connected: info.connected !== false,
    state: 'ready', stateAt: performance.now(),
    count: 0, total: 0, best: null,
    pose: null, tilt: 0, aimYaw: 0, aimAt: -1e9, calibrated: false, e0: 25,
    rod: { elev: 24, yaw: 0, kickAt: -1e9, followAt: -1e9 },
    lure: { slot: info.slot, x: 0, z: 0, active: false, land: 0, twitch: 0, landAt: -99, twitchAt: -99, moving: false, fishId: null },
    cast: null, nibAt: -1e9, nibFish: null, biteAt: 0, biteFish: null,
    fight: null, fish: null, fx: 0, fz: 0, jump: null, landed: null, lostAt: 0, lostKind: null,
    reel: { omega: 0, at: 0, total: null, spin: 0, idleSince: 0, wasIdle: true }, pullPending: 0,
    rtt: 80, lastTension: 0, ripAt: 0, landBounce: -1e9, manualUntil: 0,
    toast: null,
    bot2: { castAt: 0, reelNext: 0, hookAt: 0, lapse: 0, tilt: 0, total: 0, twitchAt: 0, hookPlan: null, target: null, patience: 18000 }
  };
}

// 폰(서버 자리) + ?bots=N 시험용 봇(빈 자리부터 채움). 폰이 봇 자리에 들어오면 봇은 다른 빈 자리로 옮깁니다.
function syncRoster() {
  const phones = new Map(serverPlayers.map((p) => [p.slot, p]));
  // 폰 자리
  for (const [slot, p] of phones) {
    let a = game.players.get(slot);
    if (a && a.bot) {
      // 봇이 쓰던 자리: 봇은 내보내고(빈 자리가 있으면 아래에서 새 봇이 채움) 폰에게 자리를 줍니다.
      game.players.delete(slot);
      dropAngler(a);
      a = null;
    }
    if (!a) {
      a = newAngler({ ...p, bot: false });
      game.players.set(slot, a);
      toast(a, '반가워요! 폰을 던져 보세요', 'join', 2600);
    }
    a.name = p.name;
    a.color = p.color;
    a.connected = p.connected !== false;
  }
  // 자리를 비운 폰
  for (const [slot, a] of [...game.players]) {
    if (!a.bot && !phones.has(slot)) {
      game.players.delete(slot);
      dropAngler(a);
      sfx.leave();
    }
  }
  // 봇 채우기
  let bots = [...game.players.values()].filter((a) => a.bot).length;
  for (let s = 1; s <= 4 && bots < BOTS; s++) {
    if (game.players.has(s) || phones.has(s)) continue;
    game.players.set(s, newAngler({ slot: s, ...SLOT_INFO[s], bot: true }));
    bots += 1;
  }
  view.setPlayers(anglers().map((a) => ({ slot: a.slot, color: a.color, name: a.name })));
  renderBoard();
  renderSeats();
}

// 자리에서 빠지는 사람: 걸린 물고기는 놓아주고 찌는 거둡니다.
function dropAngler(a) {
  a.lure.active = false;
  // 들고 있던 물고기는 물에 놓아주고, 걸려 있던 물고기는 풀려 달아납니다.
  if (a.fish && a.state === 'landed') pond.release(a.fish, a.fish.x, Math.max(a.fish.z + 1.2, AREA.z0));
  else if (a.fish && a.state === 'fight') pond.lose(a.fish, a.fx, a.fz);
  if (a.biteFish && a.state === 'bite') pond.steal(a.biteFish);
  a.fish = null;
  a.fight = null;
  removeChip(a.slot);
}

function anglers() {
  return [...game.players.values()].sort((a, b) => a.slot - b.slot);
}
function infoOf(slot) {
  return serverPlayers.find((p) => p.slot === slot) || null;
}

function setState(a, s) {
  if (a.state === s) return;
  a.state = s;
  a.stateAt = performance.now();
  pushState();
}

function pushState() {
  game.lastPush = performance.now();
  const players = {};
  for (const a of game.players.values()) {
    if (a.bot) continue;
    players[a.slot] = { state: a.state, count: a.count, total: +a.total.toFixed(2), best: a.best ? { name: a.best.name, weight: a.best.weight } : null };
  }
  const r = game.record;
  send('game_state', { phase: 'open', players, record: r ? { slot: r.slot, weight: r.weight, name: r.name, fish: r.fish } : null });
}

// ---------- 초릿대 ----------
function tipOf(a) {
  const t = view.tipOf(a.slot);
  if (t) return t;
  const n = view.nominalTip(a.slot);
  return [n[0], 2.4, n[1]];
}
function nominalTip(a) {
  return view.nominalTip(a.slot);
}

// ================================================================
// 입력(폰·봇·키보드가 모두 이 함수들을 씁니다)
// ================================================================
function onPose(slot, d) {
  const a = game.players.get(slot);
  if (!a || !Array.isArray(d.s) || d.s.length < 3) return;
  const s = d.s.map(Number);
  if (s.some((v) => !Number.isFinite(v))) return;
  const now = performance.now();
  const elev = Math.atan2(s[1], Math.hypot(s[0], s[2]) * Math.sign(s[2] || 1)) / RD;
  const yaw = Math.atan2(s[0], Math.max(0.05, Math.abs(s[2]))) / RD;
  a.pose = { s, elev, yaw, at: now };
  a.tilt = clamp(s[0] / 0.6, -1, 1);
  // 조준은 낚싯대를 앞으로 눕혀 겨누고 있을 때의 방향(뒤로 젖히는 동안은 그대로 둡니다)
  if (elev > -25 && elev < 62) {
    a.aimYaw = clamp(yaw, -AIM_MAX, AIM_MAX);
    a.aimAt = now;
  }
}

function onCalibrate(slot, d) {
  const a = game.players.get(slot);
  if (!a) return;
  a.calibrated = true;
  // 폰을 '준비' 자세로 쥔 각도. 이 각도가 화면에서는 낚싯대를 물 쪽으로 조금 숙인 기본 자세가 됩니다.
  if (d && Number.isFinite(Number(d.e0))) a.e0 = clamp(Number(d.e0), -10, 60);
  a.pose = null;
  sendTo(a, 'cue', { kind: 'calibrated' });
}

function onCast(slot, d) {
  const a = game.players.get(slot);
  if (!a) return;
  if (a.state !== 'ready' && a.state !== 'wait') return;
  if (typeof d.rtt === 'number') a.rtt = clamp(d.rtt, 0, 1500);
  const now = performance.now();
  const power = clamp(Number(d.power) || 0, 0, 1);
  // 폰이 겨누던 방향(던지기 직전)을 우선 씁니다. 보이는 조준선과 같은 쪽으로 날아갑니다.
  let aim = clamp(Number(d.aim) || 0, -AIM_MAX, AIM_MAX);
  if (!d.exact && a.pose && now - a.aimAt < 1500) aim = a.aimYaw;
  const nt = nominalTip(a);
  const tgt = castTarget(nt[0], nt[1], power, aim);
  const out = a.state === 'wait';
  const tip = tipOf(a);
  a.cast = {
    t0: now, pre: out ? REEL_IN_MS : 0, from: out ? [a.lure.x, 0.02, a.lure.z] : tip.slice(),
    to: [tgt.x, tgt.z], dist: tgt.dist, power, aim, dur: 560 + tgt.dist * 30
  };
  if (out) {
    a.lure.active = false;
    sfx.reelIn();
  }
  a.rod.followAt = now + a.cast.pre;
  setState(a, 'cast');
  setTimeout(() => sfx.whoosh(power), a.cast.pre);
}

function onReel(slot, d) {
  const a = game.players.get(slot);
  if (!a) return;
  const now = performance.now();
  let omega = Number(d.rate);
  const turns = Math.max(0, Number(d.turns) || 0);
  if (typeof d.total === 'number' && a.reel.total != null && now - a.reel.at < 1000 && !Number.isFinite(omega)) {
    const dTot = d.total - a.reel.total;
    if (dTot >= 0 && dTot < 6) omega = dTot / Math.max(0.04, (now - a.reel.at) / 1000);
  }
  if (!Number.isFinite(omega)) omega = turns / Math.max(0.04, (now - (a.reel.at || now - 66)) / 1000);
  if (typeof d.total === 'number') a.reel.total = d.total;
  omega = clamp(omega, 0, 6);
  // 기다리는 중 잠깐 쉬었다가 조금 감으면 찌를 톡 건드린 것(트위치)
  if (a.state === 'wait' && (omega > 0.05 || turns > 0.01) && a.reel.wasIdle && now - a.reel.idleSince > 450) twitch(a, now, 0);
  if (omega > 0.05 || turns > 0.01) a.reel.wasIdle = false;
  a.reel.omega = omega;
  a.reel.at = now;
  // 감은 만큼 찌가 끌려옵니다. 메시지는 띄엄띄엄 오므로 매 프레임 조금씩 나눠 옮깁니다.
  if (a.state === 'wait' && turns > 0) a.pullPending += turns * LINE_PER_TURN;
}

function onHookset(slot, d, arrival) {
  const a = game.players.get(slot);
  if (!a) return;
  if (typeof d.rtt === 'number') a.rtt = clamp(d.rtt, 0, 1500);
  const ago = clamp(Number(d.ago) || 0, 0, 1500);
  const est = arrival - ago - a.rtt / 2 - displayRtt() / 2;
  const speed = Math.max(0, Number(d.speed) || 0);
  a.rod.kickAt = performance.now();
  if (a.state === 'bite') {
    const oneWay = (a.rtt + displayRtt()) / 2;
    if (est >= a.biteAt - 160 && est <= a.biteAt + HOOK_WINDOW * 1000 + oneWay) hookFish(a, speed, est - a.biteAt);
    else if (est < a.biteAt - 160) tooEarly(a);
    else missBite(a, 'late');
    return;
  }
  if (a.state === 'wait') {
    // 예신(톡톡)에 바로 채면 물고기가 놀라 도망갑니다. 그 밖에는 찌를 크게 한 번 당긴 것입니다.
    if (a.nibFish && est > a.nibAt - 150 && est - a.nibAt < 650) tooEarly(a);
    else twitch(a, performance.now(), 0.55);
  }
}

// ================================================================
// 단계별 처리
// ================================================================
function pullLure(a, meters) {
  const nt = nominalTip(a);
  const dx = nt[0] - a.lure.x;
  const dz = nt[1] - a.lure.z;
  const d = Math.hypot(dx, dz);
  const step = Math.min(d, meters);
  a.lure.x += (dx / (d || 1)) * step;
  a.lure.z += (dz / (d || 1)) * step;
  if (d - step < RETRIEVE_DONE || a.lure.z < AREA.z0 - 0.4) {
    a.lure.active = false;
    a.nibFish = null;
    a.pullPending = 0;
    setState(a, 'ready');
    sendTo(a, 'cue', { kind: 'back' });
    view.ripple(a.lure.x, a.lure.z, 0.4, 0.4);
  }
}

// 찌를 톡: 조금 끌려오고 물결이 생깁니다. 근처 물고기의 눈길을 끕니다.
function twitch(a, now, extra) {
  const L = a.lure;
  if (!L.active) return;
  L.twitch += 1;
  L.twitchAt = now / 1000;
  a.nibAnim = now;
  view.ripple(L.x, L.z, 0.6, 0.55);
  sfx.twitch();
  if (extra > 0) a.pullPending += extra;
}

function landLure(a) {
  const c = a.cast;
  const L = a.lure;
  L.x = c.to[0];
  L.z = c.to[1];
  L.active = true;
  L.land += 1;
  L.landAt = performance.now() / 1000;
  L.moving = false;
  L.fishId = null;
  a.cast = null;
  a.nibFish = null;
  a.biteFish = null;
  view.splash(L.x, L.z, 18, 0.65);
  view.ripple(L.x, L.z, 1.5, 1);
  setTimeout(() => view.ripple(L.x, L.z, 1.0, 0.6), 260);
  sfx.plop(clamp(1 - c.dist / 45, 0.3, 1));
  a.landBounce = performance.now();
  a.reel.wasIdle = true;
  a.reel.idleSince = performance.now();
  a.pullPending = 0;
  sendTo(a, 'cue', { kind: 'landed', dist: Math.round(c.dist) });
  setState(a, 'wait');
}

function onNibble(a, fish, now) {
  a.nibAt = now;
  a.nibAnim = now;
  a.nibFish = fish;
  view.ripple(a.lure.x, a.lure.z, 0.6, 0.6);
  sfx.nibble();
  sendTo(a, 'cue', { kind: 'nibble' });
  if (a.bot) botOnNibble(a, now);
}

function onBite(a, fish, now) {
  a.biteFish = fish;
  a.biteAt = now;
  a.nibFish = null;
  setState(a, 'bite');
  view.ripple(a.lure.x, a.lure.z, 1.3, 1);
  view.splash(a.lure.x, a.lure.z, 7, 0.35);
  sfx.bite();
  const strength = clamp(0.35 + fish.w / 4, 0.3, 1);
  sendTo(a, 'bite', { strength: +strength.toFixed(2) });
  if (a.bot) a.bot2.hookAt = now + 240 + Math.random() * 480 + (Math.random() < 0.1 ? 650 : 0);
}

function hookFish(a, speed, lateMs) {
  const fish = a.biteFish;
  if (!fish || fish.mode !== 'bite') {
    setState(a, 'wait');
    return;
  }
  const nt = nominalTip(a);
  const dx = a.lure.x - nt[0];
  const dz = a.lure.z - nt[1];
  const dist = Math.hypot(dx, dz);
  const lat = Math.atan2(-dx, dz);
  const hookQ = clamp((speed - 150) / 550, 0.3, 1);
  pond.hook(fish, a.slot);
  a.fish = fish;
  a.fight = newFight({ species: fish.sp, power: fish.power, weight: fish.w }, dist, lat, hookQ);
  a.fx = fish.x;
  a.fz = fish.z;
  a.biteFish = null;
  a.lure.active = false;
  setState(a, 'fight');
  view.splash(a.lure.x, a.lure.z, 26, 0.9);
  view.ripple(a.lure.x, a.lure.z, 2.2, 1);
  sfx.hook();
  sendTo(a, 'cue', { kind: 'hooked', quality: +hookQ.toFixed(2), late: Math.round(lateMs) });
  toast(a, '걸렸다!', 'hit', 1300);
  // 배스는 걸리자마자 자주 뜁니다.
  if (fish.sp !== 'blg' && Math.random() < 0.4) startJump(a);
}

function missBite(a, why) {
  const fish = a.biteFish;
  a.biteFish = null;
  if (fish) pond.steal(fish);
  view.ripple(a.lure.x, a.lure.z, 1.0, 0.5);
  sendTo(a, 'result', { text: why === 'late' ? '조금 늦었어요' : '미끼만 먹고 갔어요', sub: '찌가 쏙 들어가면 바로 폰을 위로 확!', kind: 'miss' });
  toast(a, why === 'late' ? '늦었어요' : '미끼만 먹고 갔어요', 'miss', 1800);
  sfx.miss();
  setState(a, 'wait');
}

function tooEarly(a) {
  const fish = a.nibFish || a.biteFish;
  a.nibFish = null;
  a.biteFish = null;
  if (fish) pond.scare(fish, a.lure.x, a.lure.z);
  view.ripple(a.lure.x, a.lure.z, 1.1, 0.6);
  sendTo(a, 'result', { text: '너무 일찍 챘어요', sub: '톡톡은 간 보기예요. 찌가 쭉 들어갈 때 채요', kind: 'miss' });
  toast(a, '너무 일찍!', 'miss', 1800);
  sfx.miss();
  setState(a, 'wait');
}

function startJump(a) {
  const f = a.fight;
  if (!f) return;
  a.jump = { t0: performance.now(), dur: 850 + Math.random() * 300, h: 0.55 + Math.random() * 0.45, yaw: Math.random() * Math.PI * 2, thrown: false, x: a.fx, z: a.fz };
  view.splash(a.fx, a.fz, 30, 1);
  view.ripple(a.fx, a.fz, 1.8, 1);
  sfx.jump();
  sendTo(a, 'cue', { kind: 'jump' });
}

function finishFight(a) {
  a.fight = null;
  a.jump = null;
  sendTo(a, 'tension', { value: 0, fish: false });
}

function landFish(a) {
  const fish = a.fish;
  const info = fish.info;
  finishFight(a);
  pond.land(fish);
  a.total += info.weight;
  a.count += 1;
  const pb = !a.best || info.weight > a.best.weight;
  if (pb) a.best = { name: info.name, weight: info.weight, species: info.species };
  const record = !game.record || info.weight > game.record.weight;
  if (record) game.record = { slot: a.slot, name: a.name, color: a.color, weight: info.weight, fish: info.name };
  a.landed = { t0: performance.now(), fish, from: [fish.x, fish.y, fish.z], dropped: false };
  setState(a, 'landed');
  view.splash(fish.x, fish.z, 22, 0.8);
  sfx.catchFish(info.weight, record && info.weight >= 1);
  sendTo(a, 'result', {
    text: `${info.name} ${info.weight.toFixed(1)}kg!`, fish: info.name, weight: info.weight, species: info.species, length: info.length, kind: 'catch',
    best: pb, record, total: +a.total.toFixed(2), count: a.count
  });
  game.cards.push({ slot: a.slot, name: a.name, color: a.color, info, record });
  toast(a, `${info.weight.toFixed(1)}kg ${info.name}`, 'got', 2400);
  renderBoard();
}

function loseFish(a, why) {
  const fish = a.fish;
  finishFight(a);
  a.fish = null;
  if (fish) pond.lose(fish, nominalTip(a)[0], nominalTip(a)[1]);
  view.splash(a.fx, a.fz, 20, 0.75);
  view.ripple(a.fx, a.fz, 1.4, 0.8);
  sfx.splash(0.8);
  if (why === 'break') {
    sfx.snap();
    sendTo(a, 'result', { text: '줄이 끊어졌어요!', sub: '장력이 빨개지면 감기를 멈춰요', kind: 'break' });
    toast(a, '줄이 끊어졌어요', 'miss', 2000);
    a.lostAt = performance.now();
    a.lostKind = 'break';
    setState(a, 'lost');
  } else {
    // 바늘이 빠짐: 찌는 그 자리에 둥실 떠 있습니다.
    a.lure.x = a.fx;
    a.lure.z = a.fz;
    a.lure.active = true;
    a.lure.land += 1;
    a.lure.landAt = performance.now() / 1000;
    a.landBounce = performance.now();
    sfx.miss();
    sendTo(a, 'result', { text: '놓쳤어요', sub: '줄이 느슨하지 않게 계속 감아요', kind: 'unhook' });
    toast(a, '놓쳤어요', 'miss', 2000);
    setState(a, 'wait');
  }
}

// ================================================================
// 매 프레임: 낚시꾼마다 단계 진행
// ================================================================
const mouthV = { x: 0, y: 0, z: 0 };
function updateAngler(a, now, dt) {
  // 감기 입력은 메시지가 끊기면 금방 0 으로 떨어집니다.
  if (now - a.reel.at > 320) a.reel.omega = Math.max(0, a.reel.omega - dt * 12);
  if (a.reel.omega < 0.05 && !a.reel.wasIdle) {
    a.reel.wasIdle = true;
    a.reel.idleSince = now;
  }
  a.reel.spin += a.reel.omega * Math.PI * 2 * dt;
  if (!a.bot && a.pose && now - a.pose.at > 1500) a.tilt *= Math.exp(-dt * 2);

  if (a.state === 'cast') {
    const c = a.cast;
    if (now - c.t0 >= c.pre + c.dur) landLure(a);
  } else if (a.state === 'wait') {
    const L = a.lure;
    L.moving = a.reel.omega > 0.4;
    if (a.pullPending > 1e-4) {
      const take = Math.min(a.pullPending, Math.max(0.6 * dt, a.pullPending * Math.min(1, dt * 9)));
      a.pullPending -= take;
      pullLure(a, take);
      if (a.state !== 'wait') return;
    }
    if (a.reel.omega > 0.05 && now - a.reel.at < 320) {
      if (now - a.ripAt > 280) {
        a.ripAt = now;
        view.ripple(L.x, L.z, 0.42, 0.35);
      }
    } else if (now - a.ripAt > 2800) {
      a.ripAt = now;
      view.ripple(L.x, L.z, 0.5, 0.2);
    }
  } else if (a.state === 'bite') {
    const f = a.biteFish;
    if (f && f.mode === 'bite') {
      pond.mouth(f, mouthV);
      a.lure.x = mouthV.x;
      a.lure.z = mouthV.z;
    }
    const decideAt = a.biteAt + HOOK_WINDOW * 1000 + a.rtt + displayRtt() + 120;
    if (!f || f.mode !== 'bite') {
      a.biteFish = null;
      setState(a, 'wait');
    } else if (now > decideAt) missBite(a, 'steal');
  } else if (a.state === 'fight') {
    fightStep(a, now, dt);
  } else if (a.state === 'landed') {
    landedStep(a, now);
  } else if (a.state === 'lost') {
    if (now - a.lostAt > 1400) setState(a, 'ready');
  }
}

function fightStep(a, now, dt) {
  const f = a.fight;
  const fish = a.fish;
  if (!f || !fish) {
    setState(a, 'ready');
    return;
  }
  const events = stepFight(f, dt, { omega: a.reel.omega, tilt: a.tilt });
  const nt = nominalTip(a);
  let fx = nt[0] - Math.sin(f.lat) * f.D;
  let fz = nt[1] + Math.cos(f.lat) * f.D;
  // 물가와 선착장 밑으로는 못 가게
  if (lakeQ(fx, fz) > 0.86 || bedDepth(fx, fz) < 0.5) {
    f.latVel = -f.latVel;
    f.lat *= 0.97;
    fx = nt[0] - Math.sin(f.lat) * f.D;
    fz = nt[1] + Math.cos(f.lat) * f.D;
  }
  fz = Math.max(fz, AREA.z0 - 0.4);
  const k = Math.min(1, dt * 6);
  const ox = a.fx;
  const oz = a.fz;
  a.fx += (fx - a.fx) * k;
  a.fz += (fz - a.fz) * k;
  // 물고기 모습: 달릴 때는 줄 반대쪽으로 머리를, 다가올 때는 사람 쪽으로
  const away = Math.atan2(a.fx - nt[0], a.fz - nt[1]);
  const mv = Math.atan2(a.fx - ox, a.fz - oz);
  const moving = Math.hypot(a.fx - ox, a.fz - oz) / Math.max(dt, 1e-3) > 0.25;
  let yaw = f.mode === 'charge' ? away + Math.PI : moving ? mv : away + Math.sin(now / 260) * 0.4;
  // 걸린 물고기는 수면 가까이에서 몸부림칩니다(달릴 때만 조금 깊게).
  let y = f.mode === 'run' ? -0.3 : -0.13;
  let pitch = 0;
  let roll = Math.sin(now / 90) * 0.25 * (f.mode === 'run' ? 1 : 0.5);
  y += Math.sin(now / 140) * 0.04;
  if (a.jump) {
    const j = a.jump;
    const u = clamp((now - j.t0) / j.dur, 0, 1);
    y = -0.2 + Math.sin(u * Math.PI) * j.h * (1 + fish.len);
    pitch = (0.5 - u) * 2.2;
    roll = Math.sin(u * 20) * 0.6;
    yaw = j.yaw;
    if (!j.thrown && u > 0.45) {
      j.thrown = true;
      if (jumpThrow(f)) {
        loseFish(a, 'unhook');
        return;
      }
    }
    if (u >= 1) {
      view.splash(a.fx, a.fz, 26, 0.9);
      view.ripple(a.fx, a.fz, 1.6, 0.9);
      sfx.splash(0.8);
      a.jump = null;
    }
  }
  pond.drive(fish, a.fx, y, a.fz, yaw, pitch, roll, f.mode === 'run' ? 1 : 0.55);
  if (now - a.ripAt > (f.mode === 'run' ? 130 : 300)) {
    a.ripAt = now;
    view.ripple(a.fx, a.fz, f.mode === 'run' ? 0.9 : 0.6, f.mode === 'run' ? 0.75 : 0.45);
    if (Math.random() < (f.mode === 'run' ? 0.5 : 0.25)) view.splash(a.fx, a.fz, f.mode === 'run' ? 5 : 3, 0.3);
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
}

// 들어 올린 물고기: 물에서 낚싯대 앞으로 끌어올려, 줄을 잡아 눈앞으로 당긴 듯 흔들리게 보여 준 뒤 놓아줍니다.
function hangPoint(a, out) {
  const tip = tipOf(a);
  const L = view.laneOf(a.slot);
  const fx = (L ? L.x : 0) * 0.75;
  const fy = EYE.y - 0.3;
  const fz = EYE.z + 1.45;
  out.x = tip[0] + (fx - tip[0]) * 0.5;
  out.y = tip[1] - 0.25 + (fy - tip[1] + 0.25) * 0.5;
  out.z = tip[2] + (fz - tip[2]) * 0.5;
  return out;
}
const hangV = { x: 0, y: 0, z: 0 };
function landedStep(a, now) {
  const L = a.landed;
  const fish = L.fish;
  const t = (now - L.t0) / 1000;
  const hp = hangPoint(a, hangV);
  const vlen = fish.len * (fish.vis || 1);
  if (now - L.t0 < LAND_SHOW_MS) {
    const u = clamp(t / 0.7, 0, 1);
    const e = u * u * (3 - 2 * u);
    // 입이 줄 끝(hp), 몸은 아래로 늘어집니다. 올라오는 동안은 물에서 그 자리로 호를 그립니다.
    const hx = hp.x;
    const hy = hp.y - vlen * 0.5;
    const hz = hp.z;
    const x = L.from[0] + (hx - L.from[0]) * e;
    const y = L.from[1] + (hy - L.from[1]) * e + Math.sin(u * Math.PI) * 0.5;
    const z = L.from[2] + (hz - L.from[2]) * e;
    const flap = t < 1.9 ? 1 : 0.35;
    const swing = Math.sin(t * 2.6) * 0.5 * flap;
    // 옆모습이 카메라를 보게(머리 위)
    const yaw = -Math.PI / 2 + swing;
    const pitch = (Math.PI / 2) * e;
    const roll = Math.sin(t * 11) * 0.25 * flap;
    pond.drive(fish, x, y, z, yaw, pitch, roll, flap);
    fish.curl = Math.sin(t * 13) * 0.32 * flap;
    if (u < 1 && Math.random() < 0.3) view.splash(x, z, 1, 0.2, Math.max(0.03, y - 0.2));
  } else if (!L.dropped) {
    // 놓아주기: 앞쪽 물로 툭 떨어뜨립니다.
    const u = clamp((now - L.t0 - LAND_SHOW_MS) / 380, 0, 1);
    const tx = hp.x;
    const tz = Math.max(hp.z + 1.4, AREA.z0 - 0.2);
    const x = hp.x + (tx - hp.x) * u;
    const z = hp.z + (tz - hp.z) * u;
    const y = (hp.y - vlen * 0.5) * (1 - u * u) + Math.sin(u * Math.PI) * 0.25 - 0.1 * u;
    pond.drive(fish, x, y, z, -Math.PI / 2 + u * 1.2, (Math.PI / 2) * (1 - u) - 0.4 * u, Math.sin(now / 50) * 0.3, 1);
    if (u >= 1) {
      L.dropped = true;
      pond.release(fish, x, z);
      view.splash(x, z, 24, 0.75);
      view.ripple(x, z, 1.5, 1);
      sfx.release();
      a.landed = null;
      a.fish = null;
      setState(a, 'ready');
    }
  }
}

// ================================================================
// 봇(시험용): 폰과 같은 함수로 던지고, 기다리고, 챔질하고, 감습니다
// ================================================================
function visibleTargets(a) {
  const nt = nominalTip(a);
  const out = [];
  for (const f of pond.fish) {
    if (f.mode !== 'roam' && f.mode !== 'approach' && f.mode !== 'inspect') continue;
    if (!view.inView(f.x, f.y, f.z, 0)) continue;
    const ai = aimFor(nt[0], nt[1], f.x, f.z);
    if (Math.abs(ai.aim) >= AIM_MAX - 1 || ai.dist > 27 || ai.dist < CAST_MIN + 1.5) continue;
    out.push(f);
  }
  return out;
}
function botCast(a, now) {
  const nt = nominalTip(a);
  const list = visibleTargets(a);
  let x;
  let z;
  a.bot2.target = null;
  if (list.length) {
    // 큰 놈을 좋아하되(무게에 비례) 다른 봇이 노리는 물고기는 덜 고릅니다. 가끔은 같은 놈을 두고 다툽니다.
    const taken = new Set(anglers().filter((o) => o !== a && o.bot && o.bot2.target).map((o) => o.bot2.target));
    let f = list[0];
    let best = -1;
    for (const g of list) {
      const sc = (0.25 + g.w) * (0.55 + Math.random() * 0.9) * (taken.has(g.id) ? 0.35 : 1);
      if (sc > best) {
        best = sc;
        f = g;
      }
    }
    a.bot2.target = f.id;
    // 물고기 바로 위가 아니라 가는 방향 앞쪽 옆(첨벙 소리에 놀라지 않게)
    const lead = 1.9 + Math.random() * 1.3;
    const side = (Math.random() - 0.5) * 1.8;
    x = f.x + Math.sin(f.yaw) * lead + Math.cos(f.yaw) * side;
    z = f.z + Math.cos(f.yaw) * lead - Math.sin(f.yaw) * side;
    if (Math.hypot(x - f.x, z - f.z) < 1.7) z += 1.8;
  } else {
    x = (Math.random() - 0.5) * 16;
    z = 8 + Math.random() * 16;
  }
  const ai = aimFor(nt[0], nt[1], x, z);
  onCast(a.slot, { power: clamp(ai.power + (Math.random() - 0.5) * 0.04, 0, 1), aim: ai.aim, exact: true, rtt: 0 });
  a.bot2.twitchAt = now + 3500 + Math.random() * 4000;
  a.bot2.patience = 13000 + Math.random() * 9000;
}
function botOnNibble(a, now) {
  // 가끔 예신에 바로 채 버리는 실수도 합니다(사람처럼).
  if (Math.random() < 0.12) a.bot2.hookPlan = now + 120 + Math.random() * 200;
}
function botThink(a, now) {
  if (!a.bot || now < a.manualUntil) return;
  const b = a.bot2;
  if (a.state !== 'ready') b.castAt = 0;
  if (a.state === 'ready') {
    if (!b.castAt) b.castAt = now + 1200 + Math.random() * 2200;
    if (now >= b.castAt) {
      b.castAt = 0;
      botCast(a, now);
    }
  } else if (a.state === 'wait') {
    if (b.hookPlan && now >= b.hookPlan) {
      b.hookPlan = null;
      onHookset(a.slot, { speed: 500, ago: 0, rtt: 0 }, now);
      return;
    }
    if (now >= b.twitchAt) {
      b.twitchAt = now + 3500 + Math.random() * 5000;
      if (Math.random() < 0.45) botReelBurst(a, 0.45 + Math.random() * 0.3);
    }
    // 한동안 아무도 오지 않으면 다른 물고기를 노려 다시 던집니다.
    const interested = pond.fish.some((f) => f.lure === a.slot && (f.mode === 'approach' || f.mode === 'inspect'));
    if (now - a.stateAt > (b.patience || 18000) && !a.nibFish && !interested) botCast(a, now);
  } else if (a.state === 'bite') {
    b.hookPlan = null;
    if (b.hookAt && now >= b.hookAt) {
      b.hookAt = 0;
      onHookset(a.slot, { speed: 380 + Math.random() * 500, ago: 0, rtt: 0 }, now);
    }
  } else if (a.state === 'fight') {
    if (now < (b.reelNext || 0)) return;
    b.reelNext = now + 120 + Math.random() * 120;
    let om = botReel(a.fight, 0.6 + Math.random() * 0.4);
    // 가끔 장력을 못 보고 계속 감는 실수도 합니다.
    if (b.lapse > now) om = Math.max(om, 1.8);
    else if (Math.random() < 0.01) b.lapse = now + 500;
    b.total = (b.total || 0) + om * 0.15;
    onReel(a.slot, { rate: om, turns: om * 0.15, total: b.total });
    const f = a.fight;
    b.tilt = f && Math.abs(f.latVel) > 0.2 && Math.random() < 0.7 ? -Math.sign(f.latVel) * 0.8 : b.tilt * 0.6;
    a.tilt = b.tilt;
  }
}
function botReelBurst(a, turns) {
  a.bot2.total = (a.bot2.total || 0) + turns;
  onReel(a.slot, { rate: turns / 0.3, turns, total: a.bot2.total });
}

// ================================================================
// 키보드(시험용): 1P 자리(없으면 첫 자리)를 조종합니다. R 은 조과 초기화, F 는 전체 화면.
// ================================================================
const keys = new Set();
const kb = { reelTotal: 0, lastReel: 0 };
function kbAngler() {
  return game.players.get(1) || anglers()[0] || null;
}
function nearestFish(a) {
  const nt = nominalTip(a);
  let best = null;
  let bd = 1e9;
  for (const f of visibleTargets(a)) {
    const d = Math.hypot(f.x - nt[0], f.z - nt[1]);
    if (d < bd) {
      bd = d;
      best = f;
    }
  }
  return best;
}
window.addEventListener('keydown', (e) => {
  audio();
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyF') {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
    return;
  }
  if (e.code === 'KeyR') {
    clearTallies();
    return;
  }
  const a = kbAngler();
  if (!a) return;
  const now = performance.now();
  a.manualUntil = now + 10000;
  if (e.code === 'Space') {
    e.preventDefault();
    const f = nearestFish(a);
    if (f) castFor(a.slot, f.x + Math.sin(f.yaw) * 2.2, f.z + Math.cos(f.yaw) * 2.2);
    else onCast(a.slot, { power: 0.45, aim: 0, exact: true, rtt: 0 });
  } else if (e.code === 'KeyH') onHookset(a.slot, { speed: 650, ago: 0, rtt: 0 }, now);
  else if (e.code === 'KeyT') {
    kb.reelTotal += 0.5;
    onReel(a.slot, { rate: 1.6, turns: 0.5, total: kb.reelTotal });
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
function keyboardTick(now) {
  const a = kbAngler();
  if (!a || !keys.has('KeyJ')) return;
  a.manualUntil = now + 10000;
  if (now - kb.lastReel > 66) {
    const turns = 2.4 * Math.min(0.2, (now - (kb.lastReel || now - 66)) / 1000);
    kb.lastReel = now;
    kb.reelTotal += turns;
    onReel(a.slot, { rate: 2.4, turns, total: kb.reelTotal });
  }
}

function clearTallies() {
  for (const a of game.players.values()) {
    a.count = 0;
    a.total = 0;
    a.best = null;
  }
  game.record = null;
  renderBoard();
  pushState();
  toastAll('조과를 모두 지웠어요');
}

// ================================================================
// 장면에 넘길 값
// ================================================================
function rodPose(a, now, dt) {
  const r = a.rod;
  const live = a.pose && now - a.pose.at < POSE_FRESH_MS && a.state !== 'landed';
  let elev;
  let yaw;
  if (live) {
    // 기준 자세(e0)를 화면의 기본 각도(12°)에 맞춥니다. 뒤로 젖히면 그만큼 낚싯대가 올라갑니다.
    elev = clamp(12 + (a.pose.elev - a.e0), -8, 118);
    yaw = clamp(a.pose.yaw, -55, 55);
    // 던지는 순간의 마무리 동작(폰은 이미 앞으로 와 있으니 조금 더 앞으로 눕힙니다)
    const ft = now - r.followAt;
    if (a.state === 'cast' && ft >= 0 && ft < 450) elev = Math.min(elev, 30 - 24 * Math.sin((ft / 450) * Math.PI));
  } else {
    // 센서가 없을 때(봇·버튼)는 단계에 맞는 자세를 그립니다.
    let te = 16 + Math.sin(now / 1100 + a.slot) * 2;
    let ty = 0;
    if (a.state === 'ready') ty = a.pose ? a.aimYaw : Math.sin(now / 2300 + a.slot * 2) * 6;
    if (a.state === 'cast' && a.cast) {
      const k = (now - a.cast.t0 - a.cast.pre) / 1000;
      te = k < -0.32 ? 16 : k < 0 ? 16 + 84 * (1 + k / 0.32) : k < 0.18 ? 100 - 96 * (k / 0.18) : k < 0.5 ? 4 + 6 * ((k - 0.18) / 0.32) : 10;
      ty = a.cast.aim * 0.9;
    }
    if (a.state === 'wait' || a.state === 'bite') {
      te = 9;
      ty = yawTo(a, a.lure.x, a.lure.z);
    }
    if (a.state === 'fight') {
      te = 18 + (a.fight ? a.fight.T * 12 : 0);
      ty = clamp(yawTo(a, a.fx, a.fz) * 0.8 - a.tilt * 26, -55, 55);
    }
    if (a.state === 'landed') {
      te = 22;
      ty = -6 * Math.sign(view.laneOf(a.slot) ? view.laneOf(a.slot).ndc : 0);
    }
    if (a.state === 'lost') te = 22;
    const kick = now - r.kickAt;
    if (a.state !== 'cast' && kick >= 0 && kick < 450) te += 34 * Math.sin((kick / 450) * Math.PI);
    elev = te;
    yaw = ty;
  }
  const k = 1 - Math.exp(-(live ? 40 : 14) * (dt || 0));
  r.elev += (elev - r.elev) * k;
  r.yaw += (yaw - r.yaw) * k;
}
function yawTo(a, x, z) {
  const nt = nominalTip(a);
  const L = view.laneOf(a.slot);
  return clamp(Math.atan2(-(x - nt[0]), Math.max(1, z - nt[1])) / RD - (L ? L.lean : 0) * 0.6, -55, 55);
}

const rdCache = new Map();
function renderData(a, now, dt) {
  rodPose(a, now, dt);
  let d = rdCache.get(a.slot);
  if (!d) {
    d = { slot: a.slot, elev: 0, yaw: 0, bend: 0, spin: 0, pull: null, slack: 0.6, lure: { mode: 'tip', p: [0, 0, 0], bait: null, mouth: null, under: 0, skate: 0, tilt: 0, alert: false }, aim: { on: false, yaw: 0, x: 0, z: 0, end: CAST_MAX }, pullArr: [0, 0, 0], baitArr: [0, 0, 0], mouthArr: [0, 0, 0] };
    rdCache.set(a.slot, d);
  }
  d.elev = a.rod.elev;
  d.yaw = a.rod.yaw;
  d.spin = a.reel.spin;
  d.bend = 0.04;
  d.pull = null;
  d.slack = 0.6;
  const lu = d.lure;
  lu.bait = null;
  lu.mouth = null;
  lu.under = 0;
  lu.skate = 0;
  lu.tilt = 0;
  lu.alert = false;
  lu.hideMarker = Boolean(a.jump);
  d.aim.on = false;
  if (a.state === 'ready') {
    lu.mode = 'tip';
    const nt = nominalTip(a);
    const live = a.pose && now - a.aimAt < 1500;
    d.aim.on = true;
    d.aim.yaw = live ? a.aimYaw : clamp(a.rod.yaw, -AIM_MAX, AIM_MAX);
    d.aim.x = nt[0];
    d.aim.z = nt[1];
    d.aim.end = view.reachAlong(nt[0], nt[1], d.aim.yaw);
  } else if (a.state === 'lost') {
    lu.mode = 'none';
  } else if (a.state === 'cast' && a.cast) {
    const c = a.cast;
    const t = Math.max(0, now - c.t0);
    lu.mode = 'fly';
    const tip = tipOf(a);
    if (c.pre > 0 && t < c.pre) {
      // 먼저 감아 들이기: 물 위를 미끄러져 오다가 마지막에 들립니다.
      const u = t / c.pre;
      const e = u * u;
      lu.p[0] = c.from[0] + (tip[0] - c.from[0]) * e;
      lu.p[1] = 0.03 + (tip[1] - 0.45 - 0.03) * Math.pow(u, 6);
      lu.p[2] = c.from[2] + (tip[2] - c.from[2]) * e;
      if (now - a.ripAt > 120 && u < 0.85) {
        a.ripAt = now;
        view.ripple(lu.p[0], lu.p[2], 0.35, 0.4);
      }
      d.slack = 0.1;
    } else {
      const u = clamp((t - c.pre) / c.dur, 0, 1);
      const from = tip;
      const apex = 1.4 + c.dist * 0.16;
      const e = 1 - Math.pow(1 - u, 1.7); // 처음엔 빠르고 끝에 느려집니다(줄 저항)
      lu.p[0] = from[0] + (c.to[0] - from[0]) * e;
      lu.p[2] = from[2] + (c.to[1] - from[2]) * e;
      lu.p[1] = Math.max(0.03, from[1] * (1 - u) + 4 * apex * u * (1 - u) * 0.85 + 0.02);
      d.slack = 0.18;
    }
  } else if (a.state === 'wait' || a.state === 'bite') {
    lu.mode = 'float';
    let under = 0;
    const nk = (now - (a.nibAnim || -1e9)) / 1000;
    if (nk >= 0 && nk < 0.5) under = 0.5 * Math.sin((nk / 0.5) * Math.PI);
    const lb = (now - a.landBounce) / 1000;
    if (lb >= 0 && lb < 0.9) under = Math.max(under, 0.5 * Math.exp(-lb * 5) * Math.cos(lb * 14));
    lu.p[0] = a.lure.x;
    lu.p[1] = 0;
    lu.p[2] = a.lure.z;
    d.pull = d.pullArr;
    d.pull[0] = a.lure.x;
    d.pull[1] = 0;
    d.pull[2] = a.lure.z;
    d.slack = a.reel.omega > 0.3 ? 0.25 : 0.85;
    if (a.state === 'bite') {
      under = clamp((now - a.biteAt) / 160, 0, 1.45);
      lu.alert = true;
      d.bend = 0.22;
      d.slack = 0.3;
      if (a.biteFish) {
        pond.mouth(a.biteFish, mouthV);
        lu.bait = d.baitArr;
        lu.bait[0] = mouthV.x;
        lu.bait[1] = mouthV.y;
        lu.bait[2] = mouthV.z;
      }
    } else if (a.nibFish && now - a.nibAt < 900 && a.nibFish.mode === 'inspect') {
      // 예신: 미끼가 물고기 입 쪽으로 살짝 끌립니다.
      pond.mouth(a.nibFish, mouthV);
      const k = Math.max(0, 1 - (now - a.nibAt) / 500);
      lu.bait = d.baitArr;
      lu.bait[0] = a.lure.x + (mouthV.x - a.lure.x) * k;
      lu.bait[1] = -BAIT_DEPTH + (mouthV.y + BAIT_DEPTH) * k;
      lu.bait[2] = a.lure.z + (mouthV.z - a.lure.z) * k;
    }
    lu.under = under;
  } else if (a.state === 'fight' && a.fight && a.fish) {
    const f = a.fight;
    pond.mouth(a.fish, mouthV);
    lu.mode = 'fish';
    // 찌는 물고기 입보다 0.5m 사람 쪽 수면에서 끌려다닙니다.
    const nt = nominalTip(a);
    const dx = nt[0] - mouthV.x;
    const dz = nt[1] - mouthV.z;
    const dl = Math.hypot(dx, dz) || 1;
    lu.p[0] = mouthV.x + (dx / dl) * 0.5;
    lu.p[1] = 0;
    lu.p[2] = mouthV.z + (dz / dl) * 0.5;
    lu.under = a.jump ? 0.1 : clamp(0.25 + f.T * 0.5, 0, 0.85);
    lu.skate = f.mode === 'run' ? 1 : 0.4;
    lu.mouth = d.mouthArr;
    lu.mouth[0] = mouthV.x;
    lu.mouth[1] = mouthV.y;
    lu.mouth[2] = mouthV.z;
    d.bend = f.T;
    d.slack = clamp(1 - f.T * 3, 0, 1);
    d.pull = d.pullArr;
    d.pull[0] = mouthV.x;
    d.pull[1] = mouthV.y;
    d.pull[2] = mouthV.z;
  } else if (a.state === 'landed' && a.fish) {
    pond.mouth(a.fish, mouthV);
    lu.mode = 'hang';
    lu.mouth = d.mouthArr;
    lu.mouth[0] = mouthV.x;
    lu.mouth[1] = mouthV.y;
    lu.mouth[2] = mouthV.z;
    d.bend = a.landed && !a.landed.dropped ? 0.3 + a.fish.w * 0.08 : 0.05;
    d.slack = 0;
  } else lu.mode = 'tip';
  return d;
}

// ================================================================
// HUD
// ================================================================
const chipEls = new Map();
function ensureChip(a) {
  let c = chipEls.get(a.slot);
  if (c) return c;
  c = document.createElement('div');
  c.className = 'chip';
  c.innerHTML = '<div class="toast"></div><div class="cb"><span class="badge"></span><span class="st"></span></div>' +
    '<div class="fight"><div class="tbar"><i></i><em></em></div><b class="dist">0.0m</b></div>';
  c.querySelector('.badge').textContent = a.name;
  $('chips').appendChild(c);
  chipEls.set(a.slot, c);
  return c;
}
function removeChip(slot) {
  const c = chipEls.get(slot);
  if (c) c.remove();
  chipEls.delete(slot);
  const l = labelEls.get(slot);
  if (l) l.remove();
  labelEls.delete(slot);
}
const labelEls = new Map();
function ensureLabel(a) {
  let l = labelEls.get(a.slot);
  if (l) return l;
  l = document.createElement('div');
  l.className = 'rlabel';
  l.textContent = a.name;
  $('labels').appendChild(l);
  labelEls.set(a.slot, l);
  return l;
}
function toast(a, text, kind, ms) {
  a.toast = { text, kind, until: performance.now() + (ms || 1600), at: performance.now() };
}
function toastAll(text) {
  for (const a of game.players.values()) toast(a, text, 'info', 1600);
}

const STATE_TEXT = {
  ready: '던지세요', cast: '휙!', wait: '기다리는 중…', bite: '지금 챔질!', fight: '감아요!', landed: '잡았다!', lost: '채비 정리 중…'
};
function updateHud(now) {
  const W = window.innerWidth;
  const list = anglers();
  const fr = laneFracs(list.length);
  list.forEach((a, i) => {
    const c = ensureChip(a);
    const lane = view.laneOf(a.slot);
    const xFrac = lane ? (lane.ndc + 1) / 2 : fr[i];
    const st = c.querySelector('.st');
    let text = STATE_TEXT[a.state] || '';
    let cls = `chip s-${a.state}`;
    if (a.state === 'wait') {
      if (now - a.nibAt < 900) {
        text = '톡톡… 아직';
        cls += ' nib';
      } else if (a.reel.omega > 0.3) text = '감는 중…';
    }
    if (a.state === 'fight' && a.fight) {
      const f = a.fight;
      text = f.T > 0.92 ? '멈춰요! 끊어져요' : f.drag || f.mode === 'run' ? '달린다! 잠깐 멈춤' : f.T < 0.1 ? '느슨해요! 감아요' : '감아요!';
      const bar = c.querySelector('.tbar');
      bar.style.setProperty('--t', `${(clamp(f.T, 0, 1.1) * 100) / 1.1}%`);
      bar.classList.toggle('hot', f.T > 0.85);
      c.querySelector('.dist').textContent = `${f.D.toFixed(1)}m`;
    }
    if (a.state === 'lost') text = a.lostKind === 'break' ? '줄이 끊어졌어요' : '놓쳤어요';
    if (!a.bot && !a.connected) cls += ' away';
    if (a.bot) cls += ' bot';
    if (st.textContent !== text) st.textContent = text;
    if (c.className !== cls) c.className = cls;
    c.style.setProperty('--c', a.color);
    c.style.left = `${((xFrac * W) / UI).toFixed(1)}px`;
    const t = c.querySelector('.toast');
    const on = a.toast && now < a.toast.until;
    if (on) {
      if (t.textContent !== a.toast.text) t.textContent = a.toast.text;
      t.className = `toast on ${a.toast.kind || ''}`;
    } else if (t.classList.contains('on')) t.className = 'toast';
    // 릴 옆 이름표
    const l = ensureLabel(a);
    const rp = view.reelOf(a.slot);
    if (rp) {
      const p = view.project(rp[0], rp[1], rp[2]);
      const side = lane && lane.ndc < -0.05 ? -1 : 1;
      l.style.transform = `translate(${((p.x + side * 34) / UI).toFixed(0)}px, ${((p.y - 6) / UI).toFixed(0)}px) translate(-50%, -50%)`;
      l.style.setProperty('--c', a.color);
      l.classList.toggle('on', p.on && p.y < window.innerHeight - 4);
    }
  });
  $('hint').classList.toggle('on', list.length === 0);
}

function renderBoard() {
  const rows = $('rows');
  rows.innerHTML = '';
  const list = anglers().sort((x, y) => y.total - x.total || y.count - x.count || (y.best ? y.best.weight : 0) - (x.best ? x.best.weight : 0));
  for (const a of list) {
    const r = document.createElement('div');
    r.className = `row${!a.bot && !a.connected ? ' away' : ''}`;
    r.style.setProperty('--c', a.color);
    const best = a.best ? `${a.best.weight.toFixed(1)}<small>kg</small>` : '-';
    r.innerHTML = `<span class="badge">${a.name}</span><span class="n"><b>${a.count}</b><small>마리</small></span>` +
      `<span class="kg"><b>${a.total.toFixed(1)}</b><small>kg</small></span><span class="bst"><b>${best}</b><small>최대</small></span>`;
    rows.appendChild(r);
  }
  const rec = game.record;
  $('rec').innerHTML = rec ? `<span>오늘의 최대어</span><b style="color:${rec.color}">${rec.name}</b> ${rec.fish} <b>${rec.weight.toFixed(1)}kg</b>` : '';
  $('rec').classList.toggle('hidden', !rec);
  $('board').classList.toggle('hidden', !list.length && !rec);
}
function renderSeats() {
  const box = $('seats');
  box.innerHTML = '';
  const taken = new Set([...game.players.keys()]);
  for (let s = 1; s <= 4; s++) {
    const i = document.createElement('i');
    i.style.setProperty('--c', SLOT_INFO[s].color);
    if (taken.has(s)) i.className = game.players.get(s).bot ? 'on bot' : 'on';
    box.appendChild(i);
  }
  const phones = serverPlayers.length;
  $('full').classList.toggle('hidden', phones < 4);
  $('qrSub').classList.toggle('hidden', phones >= 4);
}

// ---------- 조과 카드 ----------
let cardTimer = 0;
function showNextCard(now) {
  if (game.card && now < cardTimer) return;
  if (game.card) hideCard();
  const c = game.cards.shift();
  if (!c) return;
  game.card = c;
  cardTimer = now + 3800;
  const el = $('catch');
  el.style.setProperty('--c', c.color);
  $('catchWho').textContent = c.name;
  $('catchName').textContent = c.info.name;
  $('catchEn').textContent = c.info.en;
  $('catchKg').innerHTML = `${c.info.weight.toFixed(1)}<small>kg</small>`;
  $('catchLen').textContent = `${Math.round(c.info.length * 100)}cm`;
  $('catchBadge').classList.toggle('hidden', !c.record);
  el.classList.remove('on');
  void el.offsetWidth;
  el.classList.add('on');
  view.setShowcase(c.info);
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
let fpsAcc = 0;
let fpsN = 0;
let fpsT0 = performance.now();
const lureList = [];
function tick() {
  const now = performance.now();
  // 그림은 프레임 간격(최대 0.05초)으로, 판정은 실제 흐른 시간을 잘게 나눠 돌립니다(느린 화면에서도 같은 속도).
  const real = Math.min(0.5, Math.max(0, (now - last) / 1000));
  const dt = Math.min(0.05, real);
  last = now;
  fpsAcc += real;
  fpsN += 1;
  if (now - fpsT0 > 1000) {
    game.fps = fpsN / Math.max(1e-3, fpsAcc);
    fpsAcc = 0;
    fpsN = 0;
    fpsT0 = now;
  }
  keyboardTick(now);
  const list = anglers();
  lureList.length = 0;
  for (const a of list) lureList.push(a.lure);
  const steps = Math.max(1, Math.ceil(real / 0.02));
  for (let i = 0; i < steps; i++) {
    const sub = real / steps;
    const evs = pond.update(sub, now / 1000 - (steps - 1 - i) * sub, lureList);
    for (const e of evs) handlePondEvent(e, now);
    for (const a of list) {
      if (i === 0) botThink(a, now);
      updateAngler(a, now, sub);
    }
  }
  if (now - game.lastPush > HEARTBEAT_MS) pushState();
  showNextCard(now);
  const datas = [];
  for (const a of list) datas.push(renderData(a, now, dt));
  let inset = null;
  if (game.card) {
    const r = $('catchFish').getBoundingClientRect();
    if (r.width > 10) inset = { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  view.frame(now, dt, { players: datas, fish: pond.fish, inset });
  updateHud(now);
  if (DEBUG) debugPanel();
  requestAnimationFrame(tick);
}

function handlePondEvent(e, now) {
  if (e.type === 'rise') {
    view.ripple(e.x, e.z, 0.8, 0.7);
    view.splash(e.x, e.z, 3, 0.18);
    sfx.rise();
    return;
  }
  if (e.slot == null) return;
  const a = game.players.get(e.slot);
  if (!a) return;
  if (e.type === 'nibble' && a.state === 'wait') onNibble(a, e.fish, now);
  else if (e.type === 'bite') {
    if (a.state === 'wait') onBite(a, e.fish, now);
    else pond.steal(e.fish);
  } else if (e.type === 'steal' && a.state === 'bite' && a.biteFish === e.fish) {
    a.biteFish = null;
    setState(a, 'wait');
  }
}

function debugPanel() {
  const lines = anglers().map((a) => {
    const f = a.fight;
    return `${a.name}${a.bot ? '(bot)' : ''} ${a.state} rtt${Math.round(a.rtt)} om${a.reel.omega.toFixed(1)} tilt${a.tilt.toFixed(2)}` +
      (f ? ` T${f.T.toFixed(2)} D${f.D.toFixed(1)} S${f.S.toFixed(2)} ${f.mode}${f.drag ? ' DRAG' : ''}` : '');
  });
  $('debug').textContent = `fps ${game.fps.toFixed(0)} · fish ${pond.fish.length} · display rtt ${Math.round(displayRtt())}ms\n${lines.join('\n')}`;
}

// 소리는 화면을 한 번 누르거나 키를 누르면 켜집니다(브라우저 정책).
function unlockAudio() {
  const ctx = audio();
  if (ctx && ctx.state === 'running') $('sound').classList.add('off');
  else setTimeout(() => { const c = audio(); if (c && c.state === 'running') $('sound').classList.add('off'); }, 300);
}
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);
setAmbience(true);
if (audio() && audio().state === 'running') $('sound').classList.add('off');

syncRoster();
renderBoard();
renderSeats();
requestAnimationFrame(tick);
if (DEBUG) $('debug').classList.remove('hidden');

// ================================================================
// 시험용 손잡이: window.__fishing
// ================================================================
function castFor(slot, x, z) {
  const a = game.players.get(slot);
  if (!a) return false;
  const nt = nominalTip(a);
  const ai = aimFor(nt[0], nt[1], x, z);
  onCast(slot, { power: ai.power, aim: ai.aim, exact: true, rtt: 0 });
  return { aim: +ai.aim.toFixed(1), power: +ai.power.toFixed(3), dist: +ai.dist.toFixed(1) };
}
// 이 사람 찌를 가장 가까운 물고기가 바로 물게 합니다(찌가 물에 없으면 먼저 앞에 떨어뜨림).
function forceBite(slot) {
  const a = game.players.get(slot);
  if (!a) return false;
  if (a.state !== 'ready' && a.state !== 'wait' && a.state !== 'cast') return false;
  a.manualUntil = performance.now() + 6000;
  if (a.state !== 'wait') {
    const nt = nominalTip(a);
    a.cast = { t0: performance.now(), pre: 0, from: tipOf(a), to: [nt[0], nt[1] + 9], dist: 9, power: 0.2, aim: 0, dur: 0 };
    landLure(a);
  }
  let best = null;
  let bd = 1e9;
  for (const f of pond.fish) {
    if (f.mode !== 'roam' && f.mode !== 'approach' && f.mode !== 'inspect' && f.mode !== 'spook') continue;
    const d = Math.hypot(f.x - a.lure.x, f.z - a.lure.z);
    if (d < bd) {
      bd = d;
      best = f;
    }
  }
  if (!best) return false;
  if (!pond.forceBite(best, a.lure)) return false;
  onBite(a, best, performance.now());
  return true;
}
function forceHook(slot) {
  const a = game.players.get(slot);
  if (!a) return false;
  if (a.state !== 'bite') forceBite(slot);
  a.manualUntil = performance.now() + 8000;
  if (a.state === 'bite') hookFish(a, 700, 100);
  return a.state === 'fight';
}
function forceLand(slot) {
  const a = game.players.get(slot);
  if (!a) return false;
  if (a.state !== 'fight') forceHook(slot);
  if (!a.fight) return false;
  // 화면의 물고기도 가까이 옮겨 둡니다(멀리서 날아오르지 않게).
  const nt = nominalTip(a);
  a.fx = nt[0] - Math.sin(a.fight.lat) * 2.6;
  a.fz = nt[1] + Math.cos(a.fight.lat) * 2.6;
  a.fight.D = 2.0;
  a.fight.mode = 'hold';
  a.fight.modeT = 5;
  return true;
}
function forceJump(slot) {
  const a = game.players.get(slot);
  if (!a || a.state !== 'fight' || !a.fight) return false;
  a.manualUntil = performance.now() + 8000;
  startJump(a);
  return true;
}
function spawnFish(species = 'lmb', weight = null, x = null, z = null) {
  const at = x != null && z != null ? { x, z } : null;
  const f = pond.spawn(species, weight, at);
  return f ? { id: f.id, species: f.sp, weight: f.w, x: +f.x.toFixed(2), z: +f.z.toFixed(2) } : null;
}
window.__fishing = {
  game, pond, view,
  get fish() {
    return pond.fish.map((f) => ({ id: f.id, species: f.sp, weight: f.w, len: f.len, x: +f.x.toFixed(2), y: +f.y.toFixed(2), z: +f.z.toFixed(2), state: f.mode, act: f.act }));
  },
  get players() {
    return anglers().map((a) => ({ slot: a.slot, bot: a.bot, state: a.state, count: a.count, total: +a.total.toFixed(2), best: a.best, lure: { x: +a.lure.x.toFixed(2), z: +a.lure.z.toFixed(2), active: a.lure.active }, T: a.fight ? +a.fight.T.toFixed(2) : null, D: a.fight ? +a.fight.D.toFixed(1) : null }));
  },
  get fps() { return +game.fps.toFixed(1); },
  spawnFish, castFor, forceBite, forceHook, forceLand, forceJump, onCast, onHookset, onReel, onPose, clearTallies, displayRtt
};
