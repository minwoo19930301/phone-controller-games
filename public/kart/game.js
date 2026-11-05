// 카트 레이스 큰 화면: 경기 진행(카운트다운·3바퀴·완주 순서), 1인칭 운전석 카메라, 화면 분할, CPU·시험용 봇, 소켓.
// 서버는 방과 이벤트만 중계하고 주행 계산과 순위 판정은 모두 여기서 합니다.
import { createTrack, wrapAngle, HALF_W } from './track.js';
import { K, clamp, newKart, stepKart, placeKart, collideKarts, botInput } from './physics.js';
import { createScene } from './scene.js';
import { createHud } from './hud.js';
import { sfx, audio } from './sfx.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOTS = clamp(parseInt(params.get('bots'), 10) || 0, 0, 4);
const LAPS = clamp(parseInt(params.get('laps'), 10) || 3, 1, 9);
const AUTOSTART = params.has('autostart');
const GRID_SIZE = 4; // 사람이 모자라면 CPU 카트로 4대를 채웁니다
const COUNT_MS = 3000; // 카운트다운(3-2-1)
const FINISH_WAIT_MS = 35000; // 첫 사람이 들어온 뒤 이 시간이 지나면 남은 사람은 미완주로 끝냅니다
const SLOT_INFO = {
  1: { name: '1P', color: '#ff5a5f' },
  2: { name: '2P', color: '#3ab4ff' },
  3: { name: '3P', color: '#ffc93c' },
  4: { name: '4P', color: '#5ee07a' }
};
const CPU_INFO = [
  { name: 'CPU 한별', color: '#e7ebf3' },
  { name: 'CPU 보라', color: '#c77dff' },
  { name: 'CPU 단풍', color: '#ff9b3d' },
  { name: 'CPU 나루', color: '#3ee6d6' }
];

// 캔버스에 글자를 그리기 전에 글꼴을 기다립니다(최대 2초).
await Promise.race([
  Promise.all([document.fonts.load('400 64px Anton'), document.fonts.load('800 64px "Pretendard Variable"')]),
  new Promise((r) => setTimeout(r, 2000))
]).catch(() => {});

const track = createTrack();
const view = createScene($('cv'), track);
const hud = createHud($('views'), track);

// ================================================================
// 연결
// ================================================================
const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true });
let serverPlayers = [];
const rtts = [];
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
  try { saved = sessionStorage.getItem('pcg-kart-room'); } catch (e) {}
  socket.emit('join', { role: 'display', game: 'kart', room: saved });
});
let hadRoom = false; // 이 페이지가 이미 방을 받은 적이 있는지(처음 받는 방은 언제나 새 방이라 fresh 입니다)
socket.on('room', async (r) => {
  try { sessionStorage.setItem('pcg-kart-room', r.code); } catch (e) {}
  serverPlayers = r.players || [];
  // 서버가 다시 떠서 방이 새로 만들어졌으면 폰 자리 번호가 바뀔 수 있어, 진행 중이던 경기는 대기실로 돌아갑니다.
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
  renderLobby();
  pushState();
});
socket.on('ready_state', (st) => {
  game.ready = new Set((st && st.ready) || []);
  renderLobby();
});
socket.on('display_replaced', () => $('replaced').classList.remove('hidden'));
socket.on('start_game', () => startGame());
socket.on('drive', (d) => onDrive(d));
socket.on('calibrate', (d) => {
  const k = racerBySlot(d && d.slot);
  if (k && game.phase === 'playing') hudToast(k.slot, '핸들 영점을 다시 맞췄어요', 1400);
});

function connected(slot) {
  const p = serverPlayers.find((x) => x.slot === slot);
  return Boolean(p && p.connected);
}

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

// ================================================================
// 카트 만들기와 경기 상태
// ================================================================
const game = {
  phase: 'lobby', // lobby | playing | over
  sub: '', // countdown | race
  karts: [],
  humans: [], // 화면(칸)이 있는 카트, 자리 번호 순
  ready: new Set(),
  cdEnd: 0,
  raceStart: 0,
  lastCount: 0,
  goUntil: 0,
  finishCount: 0,
  firstFinishAt: 0,
  endAt: 0,
  idleSince: 0,
  results: [],
  lastPush: 0
};

function makeRacer(id, info) {
  const k = newKart(id, 0, 0, 0);
  Object.assign(k, {
    slot: info.slot || null, name: info.name, color: info.color, kind: info.kind, num: info.num,
    inp: { steer: 0, gas: 0, brake: 0, t: 0 },
    brain: { lane: (Math.random() - 0.5) * 6, skill: 0.86 + Math.random() * 0.1 },
    lapsDone: 0, finished: false, finishT: 0, rank: 0, lapStart: 0, best: Infinity, lapTimes: [],
    wrongShown: false, boostShow: 0, finishLaps: LAPS
  });
  return k;
}

// 대기실·결과 화면 배경: CPU 카트 네 대가 계속 달립니다.
function buildDemo() {
  game.karts = CPU_INFO.map((c, i) => {
    const k = makeRacer(i, { ...c, kind: 'cpu', num: i + 1 });
    placeKart(k, track, (track.L * i) / 4, (i % 2 ? 3 : -3), 18);
    k.dist = k.s;
    k.finishLaps = Infinity;
    return k;
  });
  game.humans = [];
  view.setRoster(game.karts);
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startGame() {
  audio();
  if (game.phase === 'playing') return; // 경기 중 시작 신호는 무시
  const list = lobbyPlayers().filter((p) => p.connected);
  if (!list.length) {
    lobbyMessage('참가자가 없어요. 폰으로 QR 을 찍어 들어오세요.');
    return;
  }
  // 로스터: 사람(또는 시험용 봇) + 모자란 만큼 CPU
  const racers = list.map((p, i) => makeRacer(i, { slot: p.slot, name: p.name, color: p.color, kind: p.bot ? 'bot' : 'human', num: p.slot }));
  const humans = racers.slice();
  const cpuNeed = Math.max(0, GRID_SIZE - racers.length);
  for (let i = 0; i < cpuNeed; i++) racers.push(makeRacer(racers.length, { ...CPU_INFO[i], kind: 'cpu', num: 5 + i }));
  const gridOrder = shuffle(racers.slice());
  gridOrder.forEach((k, g) => {
    const row = g >> 1;
    const col = g & 1;
    placeKart(k, track, -7 - row * 8 - (col ? 0 : 3.5), col ? 3.4 : -3.4, 0);
    k.dist = -7 - row * 8 - (col ? 0 : 3.5);
    k.lapStart = 0;
  });
  game.karts = racers;
  game.humans = humans;
  view.setRoster(racers);
  game.phase = 'playing';
  game.sub = 'countdown';
  game.cdEnd = performance.now() + COUNT_MS;
  game.lastCount = 0;
  game.goUntil = 0;
  game.finishCount = 0;
  game.firstFinishAt = 0;
  game.endAt = 0;
  game.idleSince = 0;
  game.results = [];
  $('lobby').classList.add('hidden');
  $('over').classList.add('hidden');
  pushState();
}

function endGame() {
  if (game.phase !== 'playing') return;
  const order = standings();
  game.results = order.map((k, i) => ({
    id: k.id, rank: i + 1, name: k.name, color: k.color, kind: k.kind, finished: k.finished, time: k.finishT,
    best: k.best === Infinity ? 0 : k.best, laps: Math.min(k.lapsDone, LAPS)
  }));
  game.phase = 'over';
  game.sub = '';
  sfx.engineOff();
  for (const r of game.results) {
    const k = game.karts.find((x) => x.id === r.id);
    if (k && k.slot && k.kind !== 'cpu') send('result', { rank: r.rank, total: game.karts.length, time: Math.round(r.time), best: Math.round(r.best), finished: r.finished }, k.slot);
  }
  renderOver();
  $('over').classList.remove('hidden');
  pushState();
}

function backToLobby(msg) {
  game.phase = 'lobby';
  game.sub = '';
  sfx.engineOff();
  buildDemo();
  $('lobby').classList.remove('hidden');
  $('over').classList.add('hidden');
  renderLobby();
  pushState();
  if (msg) lobbyMessage(msg);
}

// ---------- 순위 ----------
function standings() {
  return game.karts.slice().sort((a, b) => {
    if (a.finished && b.finished) return a.finishT - b.finishT;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.dist - a.dist;
  });
}
const racerBySlot = (slot) => game.humans.find((k) => k.slot === slot) || null;
const racerById = (id) => game.karts.find((k) => k.id === id) || null;

// ---------- 입력 ----------
function onDrive(d) {
  if (!d) return;
  const k = racerBySlot(d.slot);
  if (!k || k.kind !== 'human') return;
  k.inp.steer = clamp(Number(d.steer) || 0, -1, 1);
  k.inp.gas = d.gas ? 1 : 0;
  k.inp.brake = d.brake ? 1 : 0;
  k.inp.t = performance.now();
}
const keys = { left: false, right: false, up: false, down: false };
function keyboardInput() {
  if (!(keys.left || keys.right || keys.up || keys.down)) return null;
  return { steer: (keys.right ? 1 : 0) - (keys.left ? 1 : 0), gas: keys.up ? 1 : 0, brake: keys.down ? 1 : 0 };
}
function isAuto(k, now) {
  if (game.phase !== 'playing') return true;
  if (k.kind === 'cpu' || k.kind === 'bot' || k.finished) return true;
  return !connected(k.slot) && !(game.humans[0] === k && keyboardInput());
}
function driveOf(k, now) {
  const kb = game.humans[0] === k && game.phase === 'playing' && !k.finished ? keyboardInput() : null;
  if (kb) return kb;
  if (isAuto(k, now)) return botInput(k, track, k.brain);
  // 입력이 0.7초 넘게 끊기면(연결 불안정) 손을 뗀 것으로 봅니다. 핸들은 중앙으로.
  if (now - k.inp.t > 700) return { steer: 0, gas: 0, brake: 0 };
  return k.inp;
}

// ================================================================
// 시뮬레이션
// ================================================================
const fmt = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00.0';
  const t = Math.floor(ms / 100) / 10;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
};

function hudToast(slot, text, ms) {
  const i = viewIndex(slot);
  if (i >= 0) hud.toast(i, text, ms);
}
let hudSlots = []; // 화면 칸 번호 → 자리 번호(layoutViews 가 채움)
const viewIndex = (slot) => hudSlots.indexOf(slot);

function carEffects(k, dt) {
  const sp = Math.abs(k.vf);
  const rx = k.x - Math.cos(k.h) * 1.15;
  const rz = k.z - Math.sin(k.h) * 1.15;
  if (k.offroad && sp > 6 && Math.random() < dt * 34) {
    view.puffs.spawn(rx + (Math.random() - 0.5) * 1.3, 0.3, rz + (Math.random() - 0.5) * 1.3, (Math.random() - 0.5) * 2, 1.2, (Math.random() - 0.5) * 2, '#cdb27c', 1.1, 0.9, 0.55, 2.4);
  }
  if (k.drift > 0.6 && sp > 12 && Math.random() < dt * 40) {
    const side = Math.random() < 0.5 ? 1 : -1;
    view.puffs.spawn(rx - Math.sin(k.h) * 0.7 * side, 0.25, rz + Math.cos(k.h) * 0.7 * side, 0, 0.7, 0, '#e9e9ef', 0.8, 0.8, 0.45, 2.8);
  }
  if (k.boostT > 0 && Math.random() < dt * 50) {
    view.puffs.spawn(rx, 0.38, rz, -Math.cos(k.h) * 3, 0.3, -Math.sin(k.h) * 3, '#ffb347', 0.8, 0.35, 0.8, 1.2);
  }
}
function sparks(k, power) {
  const n = Math.min(14, 4 + Math.floor(power));
  for (let i = 0; i < n; i++) {
    view.puffs.spawn(k.x + (Math.random() - 0.5), 0.5, k.z + (Math.random() - 0.5), (Math.random() - 0.5) * 9, 2 + Math.random() * 4, (Math.random() - 0.5) * 9, '#ffe08a', 0.35, 0.4, 1, 0.3);
  }
}

function simulate(dt, now) {
  const karts = game.karts;
  if (game.phase === 'playing' && game.sub === 'countdown') {
    const r = game.cdEnd - now;
    const n = Math.ceil(r / 1000);
    if (r > 0 && n !== game.lastCount) {
      game.lastCount = n;
      sfx.count(n);
      send('cue', { type: 'count', n });
    }
    if (r <= 0) {
      game.sub = 'race';
      game.raceStart = now;
      game.goUntil = now + 1100;
      for (const k of karts) k.lapStart = now;
      sfx.count(0);
      send('cue', { type: 'go' });
      pushState();
    }
    // 출발선 뒤에서 대기: 위치 갱신만
    return;
  }
  const racing = game.phase === 'playing' && game.sub === 'race';
  const SUB = 2;
  const h = dt / SUB;
  const evs = new Map();
  for (let s = 0; s < SUB; s++) {
    for (const k of karts) {
      const ev = evs.get(k) || {};
      evs.set(k, ev);
      stepKart(k, driveOf(k, now), h, track, ev);
    }
    collideKarts(karts);
  }
  for (const k of karts) {
    carEffects(k, dt);
    const ev = evs.get(k);
    const human = k.slot && k.kind !== 'cpu';
    if (ev.wall) {
      sparks(k, ev.wall);
      if (k.kind !== 'cpu') sfx.thump(ev.wall);
      if (human && game.phase === 'playing') send('cue', { type: 'bump', power: Math.round(ev.wall) }, k.slot);
    }
    if (ev.boost) {
      k.boostShow = now + 1400;
      if (k.kind !== 'cpu') sfx.boost();
      if (human && game.phase === 'playing') send('cue', { type: 'boost' }, k.slot);
    }
    // 길을 완전히 벗어났거나 역주행이 오래 가면 중심선 위로 되돌려 줍니다.
    if (racing && !k.finished && (k.wrongT > 3 || (k.stuckT > 3 && (Math.abs(k.d) > HALF_W - 1 || Math.abs(k.tdiff) > 1.2)))) {
      const back = k.s;
      const keepDist = k.dist;
      placeKart(k, track, back + 3, 0, 8);
      k.dist = keepDist;
      if (human) hudToast(k.slot, '코스로 되돌려 놨어요', 1500);
    }
  }
  if (!racing) return;

  // 랩·완주
  for (const k of karts) {
    const laps = Math.floor(k.dist / track.L);
    while (!k.finished && k.lapsDone < laps) {
      k.lapsDone += 1;
      const lt = now - k.lapStart;
      k.lapStart = now;
      k.lapTimes.push(lt);
      if (lt < k.best) k.best = lt;
      if (k.lapsDone >= LAPS) {
        k.finished = true;
        k.finishT = now - game.raceStart;
        k.rank = ++game.finishCount;
        k.brain = { lane: k.rank % 2 ? 5.5 : -5.5, skill: 0.62 }; // 완주 뒤엔 길가로 비켜 천천히 돕니다
        if (!game.firstFinishAt && game.humans.includes(k)) game.firstFinishAt = now;
        if (k.slot && k.kind !== 'cpu') {
          sfx.finish();
          send('cue', { type: 'finish', rank: k.rank, time: Math.round(k.finishT) }, k.slot);
        }
      } else if (k.slot && k.kind !== 'cpu') {
        sfx.lap();
        hudToast(k.slot, k.lapsDone + 1 === LAPS ? '마지막 바퀴!' : `${k.lapsDone + 1}바퀴째`, 1600);
        send('cue', { type: 'lap', lap: k.lapsDone + 1 }, k.slot);
      }
    }
  }

  // 경기 끝 판단
  const active = game.humans.some((k) => k.kind === 'bot' || connected(k.slot));
  if (!active) {
    if (!game.idleSince) game.idleSince = now;
    else if (now - game.idleSince > 8000) { backToLobby('모든 폰의 연결이 끊겨서 대기실로 돌아왔어요'); return; }
  } else game.idleSince = 0;
  const allDone = game.humans.every((k) => k.finished);
  if (!game.endAt) {
    if (allDone) game.endAt = now + 2600;
    else if (game.firstFinishAt && now - game.firstFinishAt > FINISH_WAIT_MS) game.endAt = now + 300;
  }
  if (game.endAt && now >= game.endAt) endGame();
  // 폰에 현황을 1초마다
  if (now - game.lastPush > 1000) pushState();
}

// ================================================================
// 카메라와 화면 분할
// ================================================================
function layoutViews() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  if (game.phase !== 'playing') return [{ kind: 'spectator', x: 0, y: 0, w: W, h: H }];
  const n = game.humans.length;
  const hw = Math.floor(W / 2);
  const hh = Math.floor(H / 2);
  const cells = n === 1 ? [[0, 0, W, H]] : n === 2 ? [[0, 0, hw, H], [hw, 0, W - hw, H]] : [[0, 0, hw, hh], [hw, 0, W - hw, hh], [0, hh, hw, H - hh], [hw, hh, W - hw, H - hh]];
  const out = game.humans.map((k, i) => ({ kind: 'player', slot: k.slot, id: k.id, color: k.color, name: k.name, x: cells[i][0], y: cells[i][1], w: cells[i][2], h: cells[i][3] }));
  if (n === 3) out.push({ kind: 'board', x: cells[3][0], y: cells[3][1], w: cells[3][2], h: cells[3][3] });
  return out;
}

// 1인칭: 눈높이 0.95m, 운전석(후드·핸들)이 아래쪽에 보입니다. 시선은 차체 방향과 진행 방향 사이를 따라가고, 급하게 꺾으면 조금 기웁니다.
function cockpitCam(k, aspect, dt) {
  const sp = Math.hypot(k.vx, k.vz);
  const va = sp > 3 ? Math.atan2(k.vz, k.vx) : k.h;
  const lead = clamp(wrapAngle(va - k.h), -0.5, 0.5) * 0.55;
  const target = k.h + lead + k.steer * 0.07;
  k.camYaw += wrapAngle(target - k.camYaw) * (1 - Math.exp(-dt / 0.07));
  const speedN = clamp(Math.abs(k.vf) / K.VMAX, 0, 1.3);
  const roll = -k.steer * 0.035 * clamp(Math.abs(k.vf) / 25, 0, 1);
  k.camRoll += (roll - k.camRoll) * (1 - Math.exp(-dt / 0.1));
  const j = k.shake * 0.05 + (k.offroad ? Math.min(1, Math.abs(k.vf) / 30) * 0.025 : 0) + (k.boostT > 0 ? 0.008 : 0);
  const jx = (Math.random() - 0.5) * j;
  const jy = (Math.random() - 0.5) * j;
  const px = k.x + Math.cos(k.h) * 0.08;
  const pz = k.z + Math.sin(k.h) * 0.08;
  const py = 0.95 + jy;
  const dirx = Math.cos(k.camYaw);
  const dirz = Math.sin(k.camYaw);
  // 가로 화각을 95° 안팎으로 맞추고(칸이 세로로 길면 세로 화각이 커짐), 속도·부스트에 따라 조금 넓힙니다.
  const base = clamp((2 * Math.atan(Math.tan((95 * Math.PI) / 360) / Math.max(0.5, aspect)) * 180) / Math.PI, 56, 82);
  const fov = base + speedN * 5 + (k.boostT > 0 ? 7 : 0);
  return {
    pos: [px + jx, py, pz],
    look: [px + dirx * 12 + jx, py - 12 * 0.06, pz + dirz * 12],
    fov,
    roll: k.camRoll
  };
}

// 관전 카메라(대기실·결과): 선두 카트를 뒤에서 위쪽으로 따라갑니다.
const spec = { x: 0, y: 6, z: 0, lx: 0, lz: 0, ready: false };
function spectatorCam(dt, now) {
  const order = standings();
  const k = order[Math.floor(now / 12000) % Math.max(1, order.length)] || game.karts[0];
  if (!k) return { pos: [0, 80, 0], look: [0, 0, 1], fov: 60 };
  const fx = Math.cos(k.h);
  const fz = Math.sin(k.h);
  const tx = k.x - fx * 10;
  const tz = k.z - fz * 10;
  const a = spec.ready ? 1 - Math.exp(-dt / 0.35) : 1;
  spec.x += (tx - spec.x) * a;
  spec.z += (tz - spec.z) * a;
  spec.lx += (k.x + fx * 6 - spec.lx) * a;
  spec.lz += (k.z + fz * 6 - spec.lz) * a;
  spec.ready = true;
  return { pos: [spec.x, 3.6, spec.z], look: [spec.lx, 0.8, spec.lz], fov: 62 };
}

// ================================================================
// 폰 상태 보내기
// ================================================================
function pushState() {
  game.lastPush = performance.now();
  const players = {};
  if (game.phase !== 'lobby') {
    const order = standings();
    for (const k of game.humans) {
      if (k.kind === 'cpu') continue;
      players[k.slot] = {
        rank: order.indexOf(k) + 1, lap: Math.min(LAPS, k.lapsDone + 1), fin: k.finished, time: Math.round(k.finishT || 0), n: game.karts.length
      };
    }
  }
  send('game_state', { phase: game.phase, sub: game.sub, laps: LAPS, players });
}

// ================================================================
// 대기실·결과 화면
// ================================================================
function renderLobby() {
  const box = $('slots');
  if (!box) return;
  box.innerHTML = '';
  const list = lobbyPlayers();
  for (let s = 1; s <= 4; s++) {
    const p = list.find((x) => x.slot === s);
    const e = document.createElement('div');
    e.className = 'slot' + (p ? ' on' : '') + (p && !p.connected ? ' away' : '') + (p && (p.bot || game.ready.has(s)) ? ' ready' : '') + (p && p.bot ? ' bot' : '');
    if (p) {
      e.style.setProperty('--c', p.color);
      e.innerHTML = `<b>${p.name}</b><small>${p.bot ? 'BOT' : game.ready.has(s) ? '준비 완료' : '준비 대기'}</small>`;
    } else {
      e.textContent = `${s}P 비어 있음`;
    }
    box.appendChild(e);
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
function renderOver() {
  const box = $('podium');
  box.innerHTML = '';
  game.results.forEach((r, i) => {
    const e = document.createElement('div');
    e.className = 'r';
    e.style.setProperty('--c', r.color);
    e.style.animationDelay = `${i * 0.12}s`;
    const tag = r.kind === 'cpu' ? 'CPU' : r.kind === 'bot' ? 'BOT' : '플레이어';
    e.innerHTML =
      `<div class="rank">${r.rank}</div><div class="who">${r.name}</div><span class="tag">${tag}</span>` +
      `<div class="num"><b>${r.finished ? fmt(r.time) : '미완주'}</b><span>${r.best ? `베스트 랩 ${fmt(r.best)}` : `${r.laps}/${LAPS}바퀴`}</span></div>`;
    box.appendChild(e);
  });
}

// ================================================================
// 매 프레임
// ================================================================
let last = performance.now();
let acc = 0;
function tick() {
  const now = performance.now();
  const dtR = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  // 고정 간격(1/60)으로 진행해서 프레임 속도와 상관없이 같은 주행이 나오게 합니다.
  acc += dtR;
  let steps = 0;
  while (acc >= 1 / 60 && steps < 4) {
    simulate(1 / 60, now);
    acc -= 1 / 60;
    steps++;
  }
  if (steps === 4) acc = 0;

  const views = layoutViews();
  hudSlots = views.map((v) => (v.kind === 'player' ? v.slot : null));
  const cams = views.map((v) => {
    if (v.kind === 'player') {
      const k = racerById(v.id);
      return { ...v, ...cockpitCam(k, v.w / Math.max(1, v.h), dtR), own: k.id };
    }
    if (v.kind === 'spectator') return { ...v, ...spectatorCam(dtR, now), own: null };
    return null;
  });
  view.update(dtR, now, game.karts);
  view.render(cams.filter(Boolean));

  hud.layout(game.phase === 'playing' ? views : []);
  if (game.phase === 'playing') {
    const order = standings();
    const n = game.karts.length;
    const racing = game.sub === 'race';
    const r = game.cdEnd - now;
    views.forEach((v, i) => {
      if (v.kind === 'board') {
        hud.board(i, order.map((k) => ({ id: k.id, name: k.name, color: k.color, lap: Math.min(LAPS, k.lapsDone + 1), laps: LAPS, fin: k.finished })), game.karts);
        return;
      }
      const k = racerById(v.id);
      let count = null;
      if (!racing) count = { text: String(Math.max(1, Math.ceil(r / 1000))), cls: '', sub: '액셀 준비!' };
      else if (now < game.goUntil) count = { text: 'GO!', cls: 'go' };
      const wrong = racing && !k.finished && k.wrongT > 0.8;
      const elapsed = k.finished ? k.finishT : racing ? now - game.raceStart : 0;
      hud.player(i, {
        rank: order.indexOf(k) + 1, n, lap: Math.min(LAPS, k.lapsDone + 1), laps: LAPS,
        speed: Math.round(Math.abs(k.vf) * 3.8), speedN: Math.abs(k.vf) / K.VMAX, time: fmt(elapsed),
        boost: now < k.boostShow, wrong, count,
        fin: k.finished ? { rank: order.indexOf(k) + 1, time: fmt(k.finishT) } : null,
        karts: game.karts, ownId: k.id
      });
      if (racing) {
        const sp = clamp(Math.abs(k.vf) / K.VMAX, 0, 1.2);
        sfx.engine(i, sp, k.finished ? 0 : (k.inp.gas || 0) * 0.6 + 0.2, k.boostT > 0);
      }
    });
  }
  requestAnimationFrame(tick);
}

// ================================================================
// 키보드(시험용): ←→ 핸들, ↑ 액셀, ↓ 브레이크, Enter 시작, Esc 대기실
// ================================================================
const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down' };
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    startGame();
    return;
  }
  if (e.key === 'Escape') {
    if (game.phase !== 'lobby') backToLobby();
    return;
  }
  const k = KEYMAP[e.code];
  if (k) { keys[k] = true; e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) keys[k] = false;
});
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

buildDemo();
renderLobby();
requestAnimationFrame(tick);
if (AUTOSTART && BOTS > 0) setTimeout(() => startGame(), 1200);

// 디버그: 콘솔에서 상태 보기
window.__kart = {
  game, track, view, hud, startGame, endGame, backToLobby, lobbyPlayers, standings, onDrive, simulate, K, LAPS,
  drive: (slot, d) => onDrive({ slot, ...d })
};
