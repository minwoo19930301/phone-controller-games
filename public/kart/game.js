// 카트 레이스 큰 화면: 경기 진행(카운트다운·3바퀴·완주 순서), 1인칭 운전석 카메라, 화면 분할, CPU·시험용 봇, 소켓.
// 서버는 방과 이벤트만 중계하고 주행 계산과 순위 판정은 모두 여기서 합니다.
//
// 대기실에서 난이도(쉬움·보통·어려움)와 경기 방식(아이템전·스피드전)을 고릅니다(키보드 D·I, 폰 알약 버튼).
// - 추격 보정: 뒤처질수록 최고 속도·가속이 오르고(파란 '추격 부스트' 불꽃), 선두는 살짝 느려집니다. 난이도가 쉬울수록 셉니다.
// - 아이템: 뒤처질수록 슈퍼 터보·무적 질주·번개·유도탄이, 선두는 바나나·니트로가 잘 나옵니다.
// - 운전 보조: 쉬움·보통은 도로 방향 맞춤·차선 보조가 세고, 벽에 박아도 딱 서지 않고 벽을 따라 미끄러집니다.
// - CPU 는 난이도에 따라 빠르기와 봐주기가 달라집니다.
import { createTrack, wrapAngle, HALF_W } from './track.js';
import { K, ASSIST, clamp, newKart, stepKart, placeKart, collideKarts, botInput } from './physics.js';
import { createScene } from './scene.js';
import { createHud } from './hud.js';
import { sfx, audio } from './sfx.js';
import { createItems, behindness, ITEM_KINDS } from './items.js';
import { ITEM_NAMES } from './icons.js';
import { createSettings, fields } from '/common/settings.js';
import { createTutorialBoard } from '/common/tutorial-board.js';
import { sendHaptic } from '/common/haptics.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOTS = clamp(parseInt(params.get('bots'), 10) || 0, 0, 4);
const LAPS = clamp(parseInt(params.get('laps'), 10) || 3, 1, 9);
const AUTOSTART = params.has('autostart');
const ROOM_PARAM = (params.get('room') || '').toUpperCase(); // 시험용: 이 방 코드로 엽니다(폰 흉내 스크립트가 같은 코드로 붙음)
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

// ---------- 난이도별 값 ----------
// 추격 보정: max = 크게 뒤처졌을 때 최고 속도 +비율, full = 그만큼 주는 거리(m), lead = 선두 감속, rb = 아이템 보정 세기
const RUBBER = {
  easy: { max: 0.28, full: 110, lead: 0.05, rb: 1 },
  normal: { max: 0.17, full: 140, lead: 0.035, rb: 0.7 },
  hard: { max: 0.07, full: 180, lead: 0.015, rb: 0.35 }
};
// CPU 빠르기(코너 한계 속도 배율), 아이템 운(뒤처진 정도에 곱함)
const CPU_SKILL = { easy: [0.74, 0.06], normal: [0.81, 0.08], hard: [0.87, 0.1] };
const CPU_LUCK = { easy: 0.5, normal: 0.75, hard: 1 };
// 사람이 맞았을 때 도는 시간 배율
const HIT_SCALE = { easy: 0.7, normal: 0.85, hard: 1 };

// 캔버스에 글자를 그리기 전에 글꼴을 기다립니다(최대 2초).
await Promise.race([
  Promise.all([document.fonts.load('400 64px Anton'), document.fonts.load('800 64px "Pretendard Variable"')]),
  new Promise((r) => setTimeout(r, 2000))
]).catch(() => {});

const track = createTrack();
const view = createScene($('cv'), track);
const hud = createHud($('views'), track);

// ================================================================
// 설정(난이도·경기 방식)과 연습 현황
// ================================================================
const settings = createSettings({
  game: 'kart',
  fields: [
    fields.difficulty({ hints: { easy: '추격 부스트 크게 · 벽에 덜 막혀요', normal: '추격 부스트 · 핸들·차선 보조', hard: '보조 없이 실력대로' } }),
    fields.choice('mode', '경기 방식', [
      { value: 'item', label: '아이템전', hint: '상자를 먹고 아이템으로 역전', tone: '#ffd23a' },
      { value: 'speed', label: '스피드전', hint: '아이템 없이 달리기만', tone: '#8fd8ff' }
    ], { default: 'item', hotkey: 'i' })
  ],
  onChange: () => {
    applyMode();
    pushState();
  }
});
const diff = () => settings.difficulty();
const itemMode = () => settings.get('mode') !== 'speed';

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
settings.attach(socket);
settings.mount($('setBox'));
settings.mount($('overSet'), { compact: true });
const board = createTutorialBoard({ mount: $('tutBox') });
board.attach(socket);

socket.on('connect', () => {
  let saved = ROOM_PARAM || null;
  if (!saved) { try { saved = sessionStorage.getItem('pcg-kart-room'); } catch (e) {} }
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
socket.on('item', (d) => {
  const k = racerBySlot(d && d.slot);
  if (k && k.kind === 'human' && game.phase === 'playing' && game.sub === 'race') useItem(k);
});
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
  lastPush: 0,
  diff: 'normal', // 이번 판 난이도(시작할 때 고정)
  items: true // 이번 판 아이템전 여부
};

function cpuSkill(level) {
  const [a, b] = CPU_SKILL[level] || CPU_SKILL.normal;
  return a + Math.random() * b;
}

function makeRacer(id, info) {
  const k = newKart(id, 0, 0, 0);
  Object.assign(k, {
    slot: info.slot || null, name: info.name, color: info.color, kind: info.kind, num: info.num,
    inp: { steer: 0, gas: 0, brake: 0, t: 0 },
    brain: { lane: (Math.random() - 0.5) * 6, skill: info.kind === 'cpu' ? cpuSkill(game.diff) : 0.86 + Math.random() * 0.1 },
    lapsDone: 0, finished: false, finishT: 0, rank: 0, lapStart: 0, best: Infinity, lapTimes: [],
    wrongShown: false, boostShow: 0, finishLaps: LAPS,
    item: null, itemRoll: 0, itemPending: null, itemUseAt: 0, rollIcon: 'banana', toldItem: false,
    hitKey: 0, boltKey: 0, bumpCool: 0, hits: 0, itemsUsed: 0
  });
  // 운전 보조: 사람(과 사람 대신 달리는 봇)은 난이도대로, CPU 는 예전 그대로
  k.assist = info.kind === 'cpu' ? ASSIST.hard : ASSIST[game.diff] || ASSIST.normal;
  return k;
}

// 대기실·결과 화면 배경: CPU 카트 네 대가 계속 달립니다(아이템전이면 상자도 먹고 아이템도 씁니다).
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
  items.reset(itemMode());
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
  if (!settings.requireAnswered()) return;
  // 들어온 사람 = 자리를 가진 사람. 화면이 꺼져 잠깐 끊긴 사람도 같이 출발하고(돌아올 때까지 자동 운전), 연결된 사람이 하나도 없으면 시작하지 않습니다.
  const list = lobbyPlayers();
  if (!list.some((p) => p.connected)) {
    lobbyMessage('참가자가 없어요. 폰으로 QR 을 찍어 들어오세요.');
    return;
  }
  game.diff = diff();
  game.items = itemMode();
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
  items.reset(game.items);
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
  settings.lock(true);
  board.hide(true);
  $('lobby').classList.add('hidden');
  $('over').classList.add('hidden');
  for (const k of humans) if (k.kind === 'human') send('cue', { type: 'item', state: 'none' }, k.slot);
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
  settings.lock(false);
  board.hide(false);
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
  settings.lock(false);
  board.hide(false);
  buildDemo();
  $('lobby').classList.remove('hidden');
  $('over').classList.add('hidden');
  renderLobby();
  pushState();
  if (msg) lobbyMessage(msg);
}

function applyMode() {
  // 대기실·결과 화면에서 경기 방식을 바꾸면 배경 상자도 바로 따라갑니다.
  if (game.phase !== 'playing') items.reset(itemMode());
  renderLobby();
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
const isPlayer = (k) => Boolean(k && k.slot && k.kind !== 'cpu'); // 화면 칸이 있는 카트(사람·봇)
const isHuman = (k) => Boolean(k && k.slot && k.kind === 'human');
const racing = () => game.phase === 'playing' && game.sub === 'race';

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
// 추격 보정(뒤처진 사람은 더 빨리, 선두는 살짝 느리게)과 CPU 봐주기
// ================================================================
const smooth = (x) => x * x * (3 - 2 * x);
function rubberBand() {
  const cfg = RUBBER[game.diff] || RUBBER.normal;
  const live = game.karts.filter((k) => !k.finished);
  if (!live.length) return;
  let lead = live[0];
  for (const k of live) if (k.dist > lead.dist) lead = k;
  let second = -Infinity;
  for (const k of live) if (k !== lead && k.dist > second) second = k.dist;
  const players = live.filter(isPlayer);
  const bestPlayer = players.length ? Math.max(...players.map((k) => k.dist)) : null;
  for (const k of game.karts) {
    k.speedMul = 1;
    k.accMul = 1;
    k.chase = 0;
    if (k.finished) continue;
    if (isPlayer(k)) {
      const gap = lead.dist - k.dist;
      const bonus = cfg.max * smooth(clamp((gap - 6) / cfg.full, 0, 1));
      let pen = 0;
      if (k === lead && Number.isFinite(second)) pen = cfg.lead * clamp((k.dist - second - 10) / 50, 0, 1);
      k.speedMul = 1 + bonus - pen;
      k.accMul = 1 + bonus * 1.6;
      k.chase = bonus;
    } else if (bestPlayer != null) {
      // CPU: 쉬울수록 사람보다 많이 앞서면 늦춰 주고, 어려움에서는 많이 뒤처지면 조금 따라붙습니다.
      const ahead = k.dist - bestPlayer;
      if (game.diff === 'easy' && ahead > 30) k.speedMul = 1 - Math.min(0.14, (ahead - 30) / 350);
      else if (game.diff === 'normal' && ahead > 55) k.speedMul = 1 - Math.min(0.08, (ahead - 55) / 550);
      else if (game.diff === 'hard' && ahead < -80) k.speedMul = 1 + Math.min(0.05, (-ahead - 80) / 800);
    }
  }
}

// ================================================================
// 아이템전
// ================================================================
const items = createItems(track, {
  q(k) {
    const order = standings().filter((x) => !x.finished);
    const idx = Math.max(0, order.indexOf(k));
    const lead = order[0];
    const q = behindness(idx, order.length, lead ? lead.dist - k.dist : 0);
    return k.kind === 'cpu' && game.phase === 'playing' ? q * (CPU_LUCK[game.diff] || 0.75) : q;
  },
  rb: (k) => (isPlayer(k) ? (RUBBER[game.diff] || RUBBER.normal).rb : 0.35),
  hitScale: (k) => (isPlayer(k) ? HIT_SCALE[game.diff] || 0.85 : 1),
  onPickup(k, box) {
    // 상자가 깨지는 반짝이
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      view.puffs.spawn(box.x, 1.1, box.z, Math.cos(a) * 5, 1.5 + Math.random() * 3, Math.sin(a) * 5, ['#ff5a5f', '#ffe14a', '#5ee07a', '#3ab4ff', '#c77dff'][i % 5], 0.35, 0.5, 0.95, 0.4);
    }
    if (isPlayer(k) && game.phase === 'playing') {
      sfx.pickup();
      if (isHuman(k)) sendHaptic(socket, k.slot, 'tick', 0.6);
    }
  },
  onRoll(k) {
    if (isHuman(k) && game.phase === 'playing') send('cue', { type: 'item', state: 'roll' }, k.slot);
  },
  onItem(k) {
    if (!isPlayer(k) || game.phase !== 'playing') return;
    sfx.itemGet();
    if (isHuman(k)) {
      send('cue', { type: 'item', state: 'have', kind: k.item }, k.slot);
      sendHaptic(socket, k.slot, 'good', 0.7);
      if (!k.toldItem) {
        k.toldItem = true;
        hudToast(k.slot, `${ITEM_NAMES[k.item]}! 폰 가운데 버튼으로 써요`, 2200);
      }
    }
  },
  onUse(k, kind) {
    k.itemsUsed += 1;
    if (isHuman(k)) send('cue', { type: 'item', state: 'none', used: kind }, k.slot);
    if (game.phase === 'playing' && (isPlayer(k) || kind === 'bolt')) sfx.use(kind);
    if (kind === 'star' && isPlayer(k)) hudToast(k.slot, '무적 질주! 부딪히면 날려요', 1800);
    if ((kind === 'turbo' || kind === 'nitro') && isPlayer(k)) k.boostShow = performance.now() + (kind === 'turbo' ? 2800 : 1300);
  },
  onHit(v, cause, by) {
    v.hits += 1;
    v.hitKey = performance.now();
    const what = { banana: '바나나에 미끄러졌어요', missile: '유도탄에 맞았어요', bolt: '번개! 작아졌어요', star: '무적 카트에 날아갔어요' }[cause] || '꽈당!';
    if (isPlayer(v) && game.phase === 'playing') {
      hudToast(v.slot, by && by !== v ? `${by.name}: ${what}` : what, 1800);
      sfx.spin();
      if (isHuman(v)) {
        sendHaptic(socket, v.slot, 'strong', 1);
        send('cue', { type: 'hit', cause, by: by && by !== v ? by.name : '' }, v.slot);
      }
    }
    if (by && by !== v && isPlayer(by) && game.phase === 'playing' && cause !== 'bolt') {
      hudToast(by.slot, `명중! ${v.name}`, 1300);
      if (isHuman(by)) sendHaptic(socket, by.slot, cause === 'star' ? 'clash' : 'hit', 0.7);
    }
    // 튕기는 별 모양 불꽃
    for (let i = 0; i < 8; i++) view.puffs.spawn(v.x, 0.9, v.z, (Math.random() - 0.5) * 7, 2 + Math.random() * 3, (Math.random() - 0.5) * 7, '#fff3a0', 0.4, 0.5, 1, 0.5);
  },
  onBolt(user, victims) {
    const now = performance.now();
    if (game.phase === 'playing') sfx.thunder();
    for (const v of victims) v.boltKey = now;
    if (isPlayer(user)) {
      user.boltKey = now;
      hudToast(user.slot, victims.length ? `번개! 앞 차 ${victims.length}대가 작아졌어요` : '번개! 앞에 아무도 없어요', 1800);
    }
  },
  onSmash(k, what) {
    if (isPlayer(k) && game.phase === 'playing') hudToast(k.slot, what === 'banana' ? '무적이라 바나나를 날렸어요' : '무적이라 끄떡없어요', 1200);
  },
  onBoom(x, z) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 6;
      view.puffs.spawn(x, 0.8, z, Math.cos(a) * sp, 1 + Math.random() * 4, Math.sin(a) * sp, i % 3 ? '#ff9a3c' : '#fff1a8', 0.7, 0.6, 0.9, 2);
    }
    if (game.phase === 'playing') sfx.boom();
  }
});

function useItem(k) {
  if (!game.items || !racing()) return null;
  return items.use(k, game.karts);
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
  // 추격 부스트: 파란 불티
  if (k.chase > 0.04 && sp > 8 && Math.random() < dt * 30 * (k.chase / 0.15)) {
    view.puffs.spawn(rx, 0.4, rz, -Math.cos(k.h) * 4 + (Math.random() - 0.5), 0.4, -Math.sin(k.h) * 4 + (Math.random() - 0.5), '#8a7dff', 0.45, 0.4, 0.75, 1.6);
  }
  // 무적: 무지개 반짝이
  if (k.starT > 0 && Math.random() < dt * 40) {
    const a = Math.random() * Math.PI * 2;
    view.puffs.spawn(k.x + Math.cos(a) * 1.2, 0.4 + Math.random() * 0.8, k.z + Math.sin(a) * 1.2, 0, 1.2, 0, `hsl(${Math.floor(Math.random() * 360)},100%,70%)`, 0.35, 0.5, 0.95, 0.6);
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
  const isRacing = racing();
  if (isRacing) rubberBand();
  const SUB = 2;
  const h = dt / SUB;
  const evs = new Map();
  for (const k of karts) { k.bumpImp = 0; k.bumpWith = null; }
  for (let s = 0; s < SUB; s++) {
    for (const k of karts) {
      const ev = evs.get(k) || {};
      evs.set(k, ev);
      stepKart(k, driveOf(k, now), h, track, ev);
    }
    collideKarts(karts);
  }
  // 아이템: 상자·바나나·유도탄, CPU·봇·자리 비운 사람의 아이템 쓰기
  if (items.st.on) {
    items.update(dt, now, karts);
    if (isRacing || game.phase === 'lobby' || game.phase === 'over') {
      for (const k of karts) {
        if (k.itemRoll > 0) {
          // 룰렛 동안 그림을 빠르게 돌립니다(끝에 갈수록 느리게).
          const left = k.itemRoll;
          const period = left > 0.6 ? 70 : left > 0.25 ? 120 : 200;
          if (!k.rollAt || now - k.rollAt > period) {
            k.rollAt = now;
            k.rollIcon = ITEM_KINDS[(ITEM_KINDS.indexOf(k.rollIcon) + 1 + Math.floor(Math.random() * 4)) % ITEM_KINDS.length];
            if (isPlayer(k) && game.phase === 'playing') sfx.tick();
          }
        }
        if (k.item && (k.kind !== 'human' || isAuto(k, now)) && (isRacing || game.phase !== 'playing')) {
          k.kappaAhead = track.kappa[((k.idx || 0) + 8) % track.N];
          items.ai(k, now, karts);
        }
      }
    }
  }
  for (const k of karts) {
    carEffects(k, dt);
    const ev = evs.get(k);
    const human = isPlayer(k);
    if (ev.wall) {
      sparks(k, ev.wall);
      if (k.kind !== 'cpu') sfx.thump(ev.wall);
      if (isHuman(k) && game.phase === 'playing') sendHaptic(socket, k.slot, ev.wall > 14 ? 'strong' : 'hit', clamp(ev.wall / 18, 0.25, 1));
    }
    // 카트끼리 부딪힘: 진동, 무적이면 상대를 날림
    if (k.bumpImp > 3.5 && k.bumpCool <= now && game.phase === 'playing') {
      k.bumpCool = now + 350;
      const o = k.bumpWith;
      if (o && o.starT > 0 && !(k.starT > 0)) items.spinOut(k, 1.0, 'star', o);
      else if (isHuman(k)) sendHaptic(socket, k.slot, 'hit', clamp(k.bumpImp / 16, 0.3, 1));
      if (human) sparks(k, k.bumpImp * 0.6);
    }
    if (ev.boost) {
      k.boostShow = now + 1400;
      if (k.kind !== 'cpu') sfx.boost();
      if (isHuman(k) && game.phase === 'playing') {
        send('cue', { type: 'boost' }, k.slot);
        sendHaptic(socket, k.slot, 'hit', 0.5);
      }
    }
    // 길을 완전히 벗어났거나 역주행이 오래 가면 중심선 위로 되돌려 줍니다.
    if (isRacing && !k.finished && (k.wrongT > 3 || (k.stuckT > 3 && (Math.abs(k.d) > HALF_W - 1 || Math.abs(k.tdiff) > 1.2)))) {
      const back = k.s;
      const keepDist = k.dist;
      placeKart(k, track, back + 3, 0, 8);
      k.dist = keepDist;
      if (human) hudToast(k.slot, '코스로 되돌려 놨어요', 1500);
    }
  }
  if (!isRacing) return;

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
        k.speedMul = 1;
        k.chase = 0;
        items.clearKart(k);
        if (!game.firstFinishAt && game.humans.includes(k)) game.firstFinishAt = now;
        if (k.slot && k.kind !== 'cpu') {
          sfx.finish();
          send('cue', { type: 'finish', rank: k.rank, time: Math.round(k.finishT) }, k.slot);
          if (isHuman(k)) {
            send('cue', { type: 'item', state: 'none' }, k.slot);
            sendHaptic(socket, k.slot, 'success', 1);
          }
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
// 맞아서 도는 동안은 시선이 좌우로 크게 흔들리고(한 바퀴를 다 돌리면 어지러워서), 번개로 작아지면 눈높이가 낮아집니다.
function cockpitCam(k, aspect, dt) {
  const sp = Math.hypot(k.vx, k.vz);
  const va = sp > 3 ? Math.atan2(k.vz, k.vx) : k.h;
  const lead = clamp(wrapAngle(va - k.h), -0.5, 0.5) * 0.55;
  const target = k.h + lead + k.steer * 0.07;
  k.camYaw += wrapAngle(target - k.camYaw) * (1 - Math.exp(-dt / 0.07));
  const speedN = clamp(Math.abs(k.vf) / K.VMAX, 0, 1.3);
  let roll = -k.steer * 0.035 * clamp(Math.abs(k.vf) / 25, 0, 1);
  let wob = 0;
  if (k.spinT > 0) {
    const e = 1 - k.spinT / Math.max(0.1, k.spinDur);
    const amp = Math.sin(e * Math.PI) * 0.55;
    wob = Math.sin(e * Math.PI * 4) * amp * (k.spinDir || 1);
    roll += Math.sin(e * Math.PI * 4 + 1) * amp * 0.25;
  }
  k.camRoll += (roll - k.camRoll) * (1 - Math.exp(-dt / 0.1));
  const j = k.shake * 0.05 + (k.offroad ? Math.min(1, Math.abs(k.vf) / 30) * 0.025 : 0) + (k.boostT > 0 ? 0.008 : 0) + (k.starT > 0 ? 0.01 : 0);
  const jx = (Math.random() - 0.5) * j;
  const jy = (Math.random() - 0.5) * j;
  const px = k.x + Math.cos(k.h) * 0.08;
  const pz = k.z + Math.sin(k.h) * 0.08;
  const py = 0.95 * (k.vScale || 1) + jy;
  const yaw = k.camYaw + wob;
  const dirx = Math.cos(yaw);
  const dirz = Math.sin(yaw);
  // 가로 화각을 95° 안팎으로 맞추고(칸이 세로로 길면 세로 화각이 커짐), 속도·부스트에 따라 조금 넓힙니다.
  const base = clamp((2 * Math.atan(Math.tan((95 * Math.PI) / 360) / Math.max(0.5, aspect)) * 180) / Math.PI, 56, 82);
  const fov = base + speedN * 5 + (k.boostT > 0 ? 7 : 0) + (k.chase > 0.04 ? k.chase * 18 : 0);
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
        rank: order.indexOf(k) + 1, lap: Math.min(LAPS, k.lapsDone + 1), fin: k.finished, time: Math.round(k.finishT || 0), n: game.karts.length,
        chase: Math.round((k.chase || 0) * 100) / 100, item: k.item || null, roll: k.itemRoll > 0, star: k.starT > 0
      };
    }
  }
  send('game_state', {
    phase: game.phase, sub: game.sub, laps: LAPS, players,
    items: game.phase === 'playing' ? game.items : itemMode(),
    settings: settings.forState({ lite: game.phase === 'playing' })
  });
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
  const lv = { easy: '쉬움', normal: '보통', hard: '어려움' }[game.diff] || '보통';
  $('overMeta').textContent = `${game.items ? '아이템전' : '스피드전'} · 난이도 ${lv}`;
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
  view.update(dtR, now, game.karts, items.st);
  view.render(cams.filter(Boolean));

  hud.layout(game.phase === 'playing' ? views : []);
  if (game.phase === 'playing') {
    const order = standings();
    const n = game.karts.length;
    const isRacing = game.sub === 'race';
    const r = game.cdEnd - now;
    views.forEach((v, i) => {
      if (v.kind === 'board') {
        hud.board(i, order.map((k) => ({ id: k.id, name: k.name, color: k.color, lap: Math.min(LAPS, k.lapsDone + 1), laps: LAPS, fin: k.finished })), game.karts);
        return;
      }
      const k = racerById(v.id);
      let count = null;
      if (!isRacing) count = { text: String(Math.max(1, Math.ceil(r / 1000))), cls: '', sub: game.items ? '아이템전 · 액셀 준비!' : '스피드전 · 액셀 준비!' };
      else if (now < game.goUntil) count = { text: 'GO!', cls: 'go' };
      const wrong = isRacing && !k.finished && k.wrongT > 0.8;
      const elapsed = k.finished ? k.finishT : isRacing ? now - game.raceStart : 0;
      const item = !game.items || k.finished ? { on: false }
        : k.itemRoll > 0 ? { on: true, state: 'roll', kind: k.rollIcon }
          : k.item ? { on: true, state: 'have', kind: k.item } : { on: true, state: 'none', kind: null };
      hud.player(i, {
        rank: order.indexOf(k) + 1, n, lap: Math.min(LAPS, k.lapsDone + 1), laps: LAPS,
        speed: Math.round(Math.abs(k.vf) * 3.8), speedN: Math.abs(k.vf) / K.VMAX, time: fmt(elapsed),
        boost: now < k.boostShow, wrong, count,
        fin: k.finished ? { rank: order.indexOf(k) + 1, time: fmt(k.finishT) } : null,
        karts: game.karts, ownId: k.id,
        item, chase: isRacing && !k.finished ? k.chase : 0, star: k.starT > 0, hitKey: k.hitKey, boltKey: k.boltKey
      });
      if (isRacing) {
        const sp = clamp(Math.abs(k.vf) / K.VMAX, 0, 1.2);
        sfx.engine(i, sp, k.finished ? 0 : (k.inp.gas || 0) * 0.6 + 0.2, k.boostT > 0 || k.starT > 0);
      }
    });
  }
  requestAnimationFrame(tick);
}

// ================================================================
// 키보드(시험용): ←→ 핸들, ↑ 액셀, ↓ 브레이크, Space·E 아이템, Enter 시작, Esc 대기실. 대기실에서 D 난이도, I 경기 방식
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
  if ((e.code === 'Space' || e.code === 'KeyE') && game.phase === 'playing') {
    e.preventDefault();
    const k = game.humans[0];
    if (k) useItem(k);
    return;
  }
  const k = KEYMAP[e.code];
  if (k) { keys[k] = true; if (game.phase === 'playing') e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) keys[k] = false;
});
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

buildDemo();
renderLobby();
requestAnimationFrame(tick);
// ?autostart 는 봇 시험용: 폰이 한 대도 없을 때만 바로 출발합니다(폰이 있으면 모두 준비를 기다림).
if (AUTOSTART && BOTS > 0) setTimeout(() => { if (!serverPlayers.length && game.phase === 'lobby') startGame(); }, 1200);

// 디버그·시험: 콘솔에서 상태 보기와 조작
window.__kart = {
  game, track, view, hud, items, settings, board, startGame, endGame, backToLobby, lobbyPlayers, standings, onDrive, simulate, K, LAPS, RUBBER,
  drive: (slot, d) => onDrive({ slot, ...d }),
  /** 시험: 자리 slot 의 카트에 아이템 주기(kind 없으면 뽑기) */
  give(slot, kind) {
    const k = racerBySlot(slot) || game.karts[0];
    if (!k) return null;
    k.item = kind || null;
    if (!kind) { k.itemPending = null; k.itemRoll = 0; }
    if (isHuman(k)) send('cue', { type: 'item', state: k.item ? 'have' : 'none', kind: k.item }, k.slot);
    return k.item;
  },
  use: (slot) => { const k = racerBySlot(slot); return k ? useItem(k) : null; },
  /** 시험: 자리 slot 의 카트를 선두에서 m 미터 뒤로 보냅니다(추격 부스트 보기) */
  fallBack(slot, m = 150) {
    const k = racerBySlot(slot);
    if (!k) return null;
    const lead = Math.max(...game.karts.map((x) => x.dist));
    const target = lead - m;
    placeKart(k, track, target, k.d, Math.abs(k.vf));
    k.dist = target;
    return k.dist;
  },
  chase: () => game.karts.map((k) => ({ name: k.name, kind: k.kind, dist: Math.round(k.dist), chase: +k.chase.toFixed(3), speedMul: +k.speedMul.toFixed(3), item: k.item }))
};
