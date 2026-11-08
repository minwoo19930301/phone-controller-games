// 광선검 큰 화면: 1~4명이 각자 스테이션에서 동시에 싸웁니다. 모드는 대기실에서 고릅니다(M 키·폰 알약).
//  - 드론 훈련: 드론의 광탄을 막습니다. 폰 방향(pose)이 그대로 칼 방향이 되고, 칼날이 광탄 경로에 닿으면 튕겨 냅니다.
//    닿는 순간 휘둘렀거나(swing) 튕긴 방향이 드론 쪽이면 그 드론을 격추합니다(난이도에 따라 자동으로 드론을 향함).
//  - 로봇 검투(duel.js): 자기 칸에서 로봇 검객과 1:1. 예고된 방향으로 막고, 비틀거릴 때 벱니다.
// 판정은 모두 여기서 하고, 서버는 중계만 합니다. 난이도(쉬움·보통·어려움)는 판정 너그러움·속도·피해를 바꿉니다.
import * as THREE from 'three';
import { createScene, STATION_X } from './scene.js';
import { BLADE_LEN, HILT, DRONE_R, ENEMY } from './models.js';
import { createHud } from './hud.js';
import { sfx, audio } from './sfx.js';
import { createDuel, DUEL_LEVEL, KIND_TEXT } from './duel.js';
import { ROBOT_Z } from './robot.js';
import { createSettings, fields, DIFF_LABEL } from '/common/settings.js';
import { createTutorialBoard } from '/common/tutorial-board.js';
import { sendHaptic } from '/common/haptics.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const num = (v, d) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const BOTS = clamp(parseInt(params.get('bots'), 10) || 0, 0, 4);
const AUTOSTART = params.has('autostart');

// ---------- 난이도·모드 ----------
// 큰 화면이 값을 갖고(localStorage 'pcg-settings-saber'), 폰 대기 화면에도 같은 알약이 뜹니다. 경기 중에는 잠깁니다.
// 주소로 시험: ?mode=duel|drone, ?difficulty=easy|normal|hard
const MODES = {
  duel: { label: '로봇 검투', lede: '폰을 칼자루처럼 쥐고, 로봇 검객이 예고한 쪽을 막은 뒤 비틀거릴 때 베세요.', eyebrow: 'DUEL COMPLETE', title: '검투 결과' },
  drone: { label: '드론 훈련', lede: '폰을 칼자루처럼 쥐고 날아오는 광탄을 쳐내세요. 휘둘러 되받으면 드론이 떨어져요.', eyebrow: 'TRAINING COMPLETE', title: '훈련 결과' }
};
let booted = false; // 장면·상태가 다 만들어지기 전(글꼴 기다리는 중)에 설정이 바뀌어도 무시
const settings = createSettings({
  game: 'saber',
  fields: [
    fields.choice('mode', '모드', [
      { value: 'duel', label: '로봇 검투', hint: '로봇 검객의 칼을 막고, 비틀거릴 때 베요' },
      { value: 'drone', label: '드론 훈련', hint: '광탄을 막고, 휘둘러 드론에 되받아쳐요' }
    ], { default: 'duel', hotkey: 'm' }),
    fields.difficulty({ hints: { easy: '방향만 맞으면 막혀요 · 아주 넉넉하게', normal: '적당히 봐줘요', hard: '빠른 연속 공격 · 봐주는 것 없이' } })
  ],
  onChange: () => { if (booted) onSettingsChanged(); }
});
// 드론 훈련 난이도. hard 가 예전 값입니다. guardR/guardMs: 칼이 광탄 길목 근처(guardR m)를 최근(guardMs)에 지났으면 막은 것으로 봐줍니다.
// goodAng: 그냥 막기만 해도 튕긴 광탄이 드론으로 끌려가는 각도(쉬움은 넓게 = 거의 자동 조준, 방향은 어느 드론인지 고르는 정도)
const DRONE_LEVEL = {
  easy: {
    hitR: 0.3, guardR: 0.55, guardMs: 280, preMs: 820, postMs: 420, swingKill: 220, goodAng: 60, assistAng: 180,
    speed: 0.7, charge: 1.4, gap: 1.4, dmg: 0.55, maxDrones: 3, slow: 0.28, slowLead: 0.56
  },
  normal: {
    hitR: 0.21, guardR: 0.32, guardMs: 170, preMs: 650, postMs: 300, swingKill: 290, goodAng: 30, assistAng: 120,
    speed: 0.85, charge: 1.15, gap: 1.15, dmg: 0.8, maxDrones: 4, slow: 0.32, slowLead: 0.48
  },
  hard: {
    hitR: 0.13, guardR: 0, guardMs: 0, preMs: 500, postMs: 220, swingKill: 380, goodAng: 13, assistAng: 80,
    speed: 1, charge: 1, gap: 1, dmg: 1, maxDrones: 5, slow: 0.36, slowLead: 0.42
  }
};
const levelOf = (P) => (P && P.level) || settings.difficulty();
const dl = (P) => DRONE_LEVEL[levelOf(P)] || DRONE_LEVEL.normal;

// ---------- 규칙과 조정 값 ----------
const ROUND_S = clamp(num(params.get('round'), 90), 10, 600); // 드론 훈련 한 판(초). ?round=20 으로 짧게 시험할 수 있습니다.
const DUEL_S = clamp(num(params.get('round'), 120), 10, 600); // 로봇 검투 제한 시간(초)
const INTRO_S = 3.4; // 카운트다운(드론이 들어오는 시간)
const END_S = 2.8; // '훈련 끝' 뒤 결과 화면까지
const AWAY_OUT_MS = 10000; // 다른 사람이 모두 쓰러졌을 때, 폰이 이만큼 넘게 끊긴 사람은 쓰러진 것으로 칩니다
const MAX_HP = 100;
const DEFLECT_PTS = 10;
const KILL_BONUS = 40; // 격추 보너스(막기 10 + 40 = 50)
const HIT_R = 0.13; // 칼날 캡슐 반지름(어려움). 난이도별 값은 DRONE_LEVEL.hitR
const SUBSTEPS = 4;
const SLOW = 0.36; // 슬로우 배율
const SLOW_LEAD = 0.42; // 광탄이 몸에 닿기까지 이 시간(경기 초) 안이면 슬로우
const SLOW_COOL_MS = 650; // 슬로우가 끝난 뒤 다음 슬로우까지 최소 간격(실제 ms)
const RAD = Math.PI / 180;
// 격추 판정(난이도별, DRONE_LEVEL): goodAng = 튕긴 방향이 드론에서 이 각도 안이면 격추, assistAng = 휘둘렀을 때 끌어 줄 드론을 찾는 각도,
// swingKill = 격추로 인정하는 휘두르기 회전 속도(도/초), preMs/postMs = 닿기 전·후 이만큼 어긋난 휘두르기까지 인정
const SWING_KILL = DRONE_LEVEL.hard.swingKill;
const DECIDE_MS = 240; // 격추 여부를 정하기 전, 늦게 도착하는 swing 을 기다리는 시간
const WAVE_S = 18;
const DRONE_SCALE = 1.7; // 드론 모델 크기 배율(멀리서도 잘 보이게)
const DRONE_HIT = DRONE_R * DRONE_SCALE + 0.12; // 되돌아간 광탄이 드론에 맞는 거리
const WAVES = [
  { drones: 2, gap: 1.9, charge: 0.8, speed: 6.6, dmg: 10, double: 0 },
  { drones: 3, gap: 1.65, charge: 0.72, speed: 7.8, dmg: 11, double: 0.12 },
  { drones: 3, gap: 1.38, charge: 0.64, speed: 9.0, dmg: 12, double: 0.25 },
  { drones: 4, gap: 1.12, charge: 0.56, speed: 10.2, dmg: 13, double: 0.35 },
  { drones: 5, gap: 0.92, charge: 0.5, speed: 11.4, dmg: 14, double: 0.45 }
];
const SLOT_INFO = {
  1: { name: '1P', color: '#ff5a5f' },
  2: { name: '2P', color: '#3ab4ff' },
  3: { name: '3P', color: '#ffc93c' },
  4: { name: '4P', color: '#5ee07a' }
};
const DEMO_COLOR = '#a98bff';
// 스테이션 배치(선수 수 → STATION_X 번호)
const STATION_ORDER = { 1: [1], 2: [1, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };

// 선수 기준 위치(스테이션 원점 기준). 모든 스테이션은 -Z(드론 쪽)를 봅니다.
const EYE_Y = 1.62;
const CAM_OFF = [0, 1.7, 0.3]; // 1인칭 카메라: 눈보다 살짝 뒤·위(칼자루와 칼날이 더 많이 보이게)
const GRIP_OFF = [0.19, 1.15, -0.34]; // 손(칼자루 쥔 곳)의 기본 위치
const WRIST = 0.14; // 칼 방향으로 손이 따라가는 정도(손목 느낌)
const CAM_PITCH = 7 * (Math.PI / 180);

// 글꼴을 기다린 뒤(캔버스 글자) 장면을 만듭니다.
await Promise.race([
  Promise.all([document.fonts.load('400 64px Anton'), document.fonts.load('800 64px "Pretendard Variable"')]),
  new Promise((r) => setTimeout(r, 2000))
]).catch(() => {});
const view = createScene($('cv'));
const hud = createHud($('views'));
// 대기실: 설정 알약(모드·난이도)과 폰 연습(튜토리얼) 현황
settings.mount($('setBox'));
settings.mount($('setBoxOver'), { compact: true });
const board = createTutorialBoard({ mount: $('tutBoard') });

// ================================================================
// 연결
// ================================================================
const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true });
let serverPlayers = [];
let hadRoom = false;
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
// 막기·맞힘 같은 결과를 그 폰에 알립니다. 소리는 폰이 'hit' 를 받아 내고, 진동은 공통 haptic 으로 보냅니다
// (폰이 휘두르는 순간 스스로 울린 진동과 220ms 안에 겹치면 폰에서 한 번만 울립니다).
const HIT_HAPTIC = {
  deflect: ['block', 0.75], kill: ['strong', 1], hurt: ['fail', 1],
  parry: ['clash', 1], strike: ['hit', 0.85], blocked: ['block', 0.5], win: ['success', 1]
};
function sendHit(slot, data) {
  if (slot == null) return;
  send('hit', data, slot);
  const h = HIT_HAPTIC[data.kind];
  if (h) sendHaptic(socket, slot, h[0], data.kind === 'strike' ? Math.min(1, h[1] + 0.06 * ((data.n || 1) - 1)) : h[1]);
}

socket.on('connect', () => {
  let saved = null;
  try { saved = sessionStorage.getItem('pcg-saber-room'); } catch (e) {}
  socket.emit('join', { role: 'display', game: 'saber', room: saved });
});
socket.on('room', async (r) => {
  try { sessionStorage.setItem('pcg-saber-room', r.code); } catch (e) {}
  serverPlayers = r.players || [];
  // 서버가 다시 떠서 방이 새로 만들어졌으면 하던 경기는 이어 갈 수 없으니 대기실로 돌아갑니다.
  // (처음 받은 방은 늘 새 방이라 건너뜁니다. ?autostart 봇 경기가 먼저 시작돼 있을 수 있습니다.)
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
  for (const s of [...game.ready]) if (!serverPlayers.some((x) => x.slot === s)) game.ready.delete(s);
  renderLobby();
  pushState(true);
});
socket.on('display_replaced', () => $('replaced').classList.remove('hidden'));
// 시작은 서버의 start_game 으로만 합니다(들어온 사람이 모두 준비를 눌렀을 때 한 번 옵니다).
socket.on('start_game', () => startGame());
socket.on('pose', (d) => onPose(d, false));
socket.on('swing', (d) => onSwing(d, false));
socket.on('calibrate', (d) => onCalibrate(d));
// 준비 현황(누가 아직인지 대기실 칸에 표시)과 폰 연습 현황
let readyState = null;
socket.on('ready_state', (st) => {
  readyState = st || null;
  renderLobby();
});
socket.on('tutorial', () => setTimeout(renderLobby, 0));
settings.attach(socket);
board.attach(socket);

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
function serverInfo(slot) {
  return serverPlayers.find((p) => p.slot === slot) || null;
}

// ================================================================
// 경기 상태
// ================================================================
const game = {
  phase: 'lobby', // lobby | playing | over
  stage: 'intro', // intro | live | end (playing 안에서)
  players: [], // 화면 칸 순서(자리 번호 순)
  demo: null, // 대기실 시연(봇)
  ready: new Set(),
  introAt: 0,
  liveAt: 0,
  endAt: 0,
  wave: 1,
  lastCount: 0,
  allGoneSince: 0,
  results: [],
  mode: settings.get('mode') // 이번 판의 모드(시작할 때 정해짐)
};
const isDuel = () => game.mode === 'duel';

const V = () => new THREE.Vector3();
function newPlayer(p, stationIdx, demo = false) {
  const sx = STATION_X[stationIdx];
  return {
    slot: demo ? null : p.slot, name: demo ? 'DEMO' : p.name, color: demo ? DEMO_COLOR : p.color,
    bot: demo || Boolean(p.bot), demo, key: demo ? 'demo' : `p${p.slot}`, station: stationIdx, sx,
    hp: MAX_HP, score: 0, deflects: 0, kills: 0, hurts: 0, streak: 0, bestStreak: 0, down: false, downAt: 0,
    drones: [], bolts: [], nextShot: 0, respawn: [],
    clock: { gt: 0, scale: 1 }, slowOn: false, slowReady: 0, lastCue: 0,
    pose: null, calibrated: false, manual: false,
    q: new THREE.Quaternion(), qInit: false, dir: new THREE.Vector3(0, 1, 0), grip: V(), emitter: V(), tip: V(),
    prevEmitter: V(), prevTip: V(), ign: 0, ignTarget: 0, swingFx: 0, flickT: Math.random() * 100,
    swings: [], az: 0.55, shake: 0, cam: { x: 0, y: 0 },
    botS: new THREE.Vector3(-0.3, 0.8, -0.5).normalize(), botThreat: null, botReactAt: 0, botFail: false, botSwing: false, botSwung: false,
    botSweep: 0, botSweepAxis: new THREE.Vector3(0, 0, 1), botNextFlourish: 0, manualSweep: 0,
    away: false, awaySince: 0,
    level: settings.difficulty(), duel: null, result: null, winAt: 0, parries: 0, strikes: 0, hurts2: 0,
    // 최근 칼 위치(드론 훈련의 '거의 막음' 보정용 고리 버퍼)
    blades: Array.from({ length: 20 }, () => ({ t: -1e9, e: V(), tip: V(), on: false })), bladeHead: 0,
    keyDir: null, keyUntil: 0
  };
}
// 지금 웨이브 값에 난이도 배율을 곱합니다(쉬울수록 느리고 적고 약하게).
function waveInfo(P) {
  const w = WAVES[clamp(game.wave, 1, WAVES.length) - 1];
  const L = dl(P);
  return {
    drones: Math.min(w.drones, L.maxDrones), gap: w.gap * L.gap, charge: w.charge * L.charge, speed: w.speed * L.speed,
    dmg: Math.round(w.dmg * L.dmg), double: w.double * (L.gap > 1 ? 0.5 : 1)
  };
}

// ---------- 좌표 ----------
// 폰 기준축 [오른쪽, 위, 앞(TV 쪽)] ↔ 세계(+x 오른쪽, +y 위, -z 앞)
const toWorld = (a, out) => out.set(num(a[0], 0), num(a[1], 0), -num(a[2], 0));
const toBasis = (v) => [+v.x.toFixed(4), +v.y.toFixed(4), +(-v.z).toFixed(4)];
const _m4 = new THREE.Matrix4();
const _bx = V();
const _by = V();
const _bz = V();
// 칼자루 회전: 로컬 +Y = 칼 방향 s, 로컬 +Z = 폰 화면 쪽 fc(칼 방향에 수직인 성분)
function quatFrom(s, fc, out) {
  _by.copy(s).normalize();
  _bz.copy(fc).addScaledVector(_by, -fc.dot(_by));
  if (_bz.lengthSq() < 1e-6) _bz.set(0, 0, 1).addScaledVector(_by, -_by.z);
  if (_bz.lengthSq() < 1e-6) _bz.set(1, 0, 0);
  _bz.normalize();
  _bx.crossVectors(_by, _bz);
  return out.setFromRotationMatrix(_m4.makeBasis(_bx, _by, _bz));
}
function gripFor(P, dir, out) {
  return out.set(P.sx + GRIP_OFF[0] + WRIST * dir.x, GRIP_OFF[1] + WRIST * dir.y, GRIP_OFF[2] + WRIST * dir.z);
}
// 점 I 를 칼날이 지나가게 하는 칼 방향(손 위치가 방향에 따라 움직이므로 두어 번 고쳐 풉니다)
const _g = V();
function aimThrough(P, I, out) {
  out.set(I.x - P.sx - GRIP_OFF[0], I.y - GRIP_OFF[1], I.z - GRIP_OFF[2]).normalize();
  for (let k = 0; k < 3; k++) {
    gripFor(P, out, _g);
    out.subVectors(I, _g).normalize();
  }
  return out;
}

// ================================================================
// 폰 자세·휘두르기·준비
// ================================================================
const _s = V();
const _f = V();
function playerBySlot(slot) {
  return game.players.find((p) => p.slot === slot) || null;
}
function onPose(d, local) {
  if (!d || !Array.isArray(d.s) || !Array.isArray(d.fc) || d.s.length < 3 || d.fc.length < 3) return;
  const P = local && d.P ? d.P : playerBySlot(Number(d.slot));
  if (!P) return;
  if (P.bot && !local) return; // 봇 자리에 들어온 폰은 무시
  if (!local) {
    // 폰이 움직이면 마우스·자동 막기보다 폰이 우선입니다.
    P.manual = false;
    P.autoplay = false;
  }
  toWorld(d.s, _s);
  toWorld(d.fc, _f);
  if (_s.lengthSq() < 1e-6) return;
  _s.normalize();
  if (!P.pose) P.pose = { s: V(), fc: V(), at: 0, local: false };
  P.pose.s.copy(_s);
  P.pose.fc.copy(_f.lengthSq() > 1e-6 ? _f.normalize() : _f.set(0, 0, 1));
  P.pose.at = performance.now();
  P.pose.local = Boolean(local);
}
function onSwing(d, local) {
  if (!d) return;
  const P = local && d.P ? d.P : playerBySlot(Number(d.slot));
  if (!P || (P.bot && !local)) return;
  const now = performance.now();
  // 폰에서 휘두른 순간 = 도착 시각 − 센서 측정 시간 − 폰 왕복/2 − 화면 왕복/2
  const lag = local ? 0 : clamp(num(d.ago, 0), 0, 400) + clamp(num(d.rtt, 80), 0, 800) / 2 + displayRtt() / 2;
  const speed = clamp(num(d.speed, 0), 0, 4000);
  P.swings.push({ real: now - lag, speed });
  if (P.swings.length > 12) P.swings.shift();
  P.swingFx = Math.min(1, P.swingFx + speed / 900);
  // 이미 튕겨 나간 광탄 중 아직 격추 여부를 정하지 않은 것을 올려 줍니다.
  const L = dl(P);
  if (speed >= L.swingKill) {
    for (const b of P.bolts) {
      if (b.state === 'out' && b.kill == null && b.candidate && now - lag >= b.contactReal - L.preMs && now - lag <= b.contactReal + L.postMs) {
        b.kill = true;
        b.homing = b.candidate;
        b.speed = 19;
      }
    }
  }
}
function strongSwingNear(P, real) {
  const L = dl(P);
  return P.swings.some((s) => s.speed >= L.swingKill && s.real >= real - L.preMs && s.real <= real + L.postMs);
}
function onCalibrate(d) {
  const slot = Number(d && d.slot);
  if (!SLOT_INFO[slot]) return;
  game.ready.add(slot);
  const P = playerBySlot(slot);
  if (P && !P.bot) {
    P.calibrated = true;
    P.qInit = false;
    P.pose = null;
    if (game.phase === 'playing') hudNote(P, '칼 방향을 맞췄어요', 1400);
  }
  renderLobby();
}

// ================================================================
// 드론
// ================================================================
const BAY_Y = 4.2;
const BAY_Z = -24.2;
function spawnDrone(P, delay = 0) {
  const d = view.newDrone();
  const dr = {
    d, P, state: 'enter', t: -delay, enterDur: 2.2 + Math.random() * 0.6,
    from: new THREE.Vector3(P.sx + (Math.random() - 0.5) * 1.6, BAY_Y + (Math.random() - 0.5) * 0.6, BAY_Z + 0.6),
    p: V(), v: V(), slot: 0, ph: Math.random() * 10, w: 0.6 + Math.random() * 0.5,
    dist: 3.9 + Math.random() * 1.9, h: 1.45 + Math.random() * 1.15, charge: 0, chargeT: 0, chargeDur: 0.7,
    aim: V(), recoil: 0, alive: true, slotAz: (Math.random() - 0.5) * P.az
  };
  dr.p.copy(dr.from);
  d.group.position.copy(dr.p);
  d.group.scale.setScalar(DRONE_SCALE);
  d.group.visible = delay <= 0;
  P.drones.push(dr);
  assignSlots(P);
  return dr;
}
// 드론마다 맡을 방위각 자리를 고르게 나눠 줍니다.
function assignSlots(P) {
  const list = P.drones.filter((x) => x.alive);
  const n = list.length;
  list.sort((a, b) => a.slotAz - b.slotAz);
  list.forEach((dr, k) => {
    dr.slotAz = n === 1 ? (Math.random() - 0.5) * 0.3 : -P.az + (2 * P.az * k) / (n - 1);
  });
}
const _t = V();
const _dv = V();
function droneHome(P, dr, gt, out) {
  const az = dr.slotAz + 0.22 * Math.sin(gt * 0.45 * dr.w + dr.ph);
  const dist = dr.dist + 0.6 * Math.sin(gt * 0.33 * dr.w + dr.ph * 1.7);
  const h = dr.h + 0.32 * Math.sin(gt * 0.9 * dr.w + dr.ph * 0.6);
  return out.set(P.sx + Math.sin(az) * dist, h, -Math.cos(az) * dist);
}
const eyeOf = (P, out) => out.set(P.sx, EYE_Y, 0);
const _e = V();
function updateDrones(P, dtG, now) {
  const gt = P.clock.gt;
  for (const dr of P.drones) {
    if (!dr.alive) continue;
    dr.t += dtG;
    if (dr.t < 0) continue;
    dr.d.group.visible = true;
    droneHome(P, dr, gt, _t);
    if (dr.state === 'enter') {
      // 격납구에서 나와 큰 호를 그리며 자리로
      const u = clamp(dr.t / dr.enterDur, 0, 1);
      const e = u * u * (3 - 2 * u);
      const mid = _dv.set((dr.from.x + _t.x) / 2, Math.max(dr.from.y, _t.y) + 1.4, (dr.from.z + _t.z) / 2);
      const a = 1 - e;
      dr.p.set(
        a * a * dr.from.x + 2 * a * e * mid.x + e * e * _t.x,
        a * a * dr.from.y + 2 * a * e * mid.y + e * e * _t.y,
        a * a * dr.from.z + 2 * a * e * mid.z + e * e * _t.z
      );
      if (u >= 1) {
        dr.state = 'fly';
        dr.v.set(0, 0, 0);
      }
    } else {
      // 스프링으로 자리 따라가기(충전 중엔 거의 멈춤)
      const k = dr.charge > 0 ? 2 : 9;
      const c = 2 * Math.sqrt(k);
      dr.v.x += ((_t.x - dr.p.x) * k - dr.v.x * c) * dtG;
      dr.v.y += ((_t.y - dr.p.y) * k - dr.v.y * c) * dtG;
      dr.v.z += ((_t.z - dr.p.z) * k - dr.v.z * c) * dtG;
      dr.p.addScaledVector(dr.v, dtG);
    }
    // 반동
    dr.recoil = Math.max(0, dr.recoil - dtG * 4);
    // 방향: 선수(또는 조준점)를 봅니다. 옆으로 움직일 때 기울입니다.
    const g = dr.d.group;
    g.position.copy(dr.p);
    eyeOf(P, _e);
    if (dr.charge > 0) g.lookAt(dr.aim);
    else g.lookAt(_e);
    dr.d.body.position.set(0, Math.sin(gt * 2.1 + dr.ph) * 0.02, -dr.recoil * 0.12);
    dr.d.body.rotation.z = clamp(-dr.v.x * 0.18, -0.4, 0.4);
    dr.d.tick(now / 1000, 1);
    // 충전
    if (dr.charge > 0) {
      dr.chargeT += dtG;
      const k = clamp(dr.chargeT / dr.chargeDur, 0, 1);
      dr.d.setCharge(k);
      g.updateMatrixWorld(true);
      if (k > 0.35) {
        dr.d.aim.visible = true;
        dr.d.muzzleWorld(_dv);
        const u = dr.d.aim.userData.u;
        u.uA.value.copy(_dv);
        u.uB.value.copy(dr.aim);
        u.uIntensity.value = (k - 0.35) * 1.4 * (0.6 + 0.4 * Math.sin(now / 18));
      }
      if (k >= 1) fireBolt(P, dr);
    } else {
      dr.d.setCharge(0);
      dr.d.aim.visible = false;
    }
  }
}
function startCharge(P, dr) {
  const w = waveInfo(P);
  dr.charge = 1;
  dr.chargeT = 0;
  dr.chargeDur = w.charge * (0.85 + Math.random() * 0.3);
  // 몸통·머리 쪽 무작위 지점
  dr.aim.set(P.sx + (Math.random() - 0.5) * 0.44, 1.05 + Math.random() * 0.6, 0);
  if (!P.demo) sfx.charge(0.8);
}
function fireBolt(P, dr) {
  dr.charge = 0;
  dr.d.setCharge(0);
  dr.d.aim.visible = false;
  dr.recoil = 1;
  const b = view.newBolt();
  const start = dr.d.muzzleWorld(V());
  const target = dr.aim.clone();
  const dir = V().subVectors(target, start);
  const pathLen = dir.length();
  dir.divideScalar(pathLen);
  const w = waveInfo(P);
  const bolt = {
    m: b, P, state: 'in', p: start.clone(), start, target, dir, pathLen, traveled: 0, speed: w.speed * (0.92 + Math.random() * 0.16),
    len: 0.46, color: new THREE.Color(ENEMY), age: 0, drone: dr, cued: false,
    candidate: null, homing: null, kill: null, decideAt: 0, contactReal: 0, k: 1
  };
  P.bolts.push(bolt);
  drawBolt(bolt);
  view.flash(start, ENEMY, 0.32, 0.16, 'glow', 4);
  if (!P.demo) sfx.fire(0.9);
}
function drawBolt(b) {
  const tailLen = Math.min(b.len, b.state === 'in' ? b.traveled + 0.02 : b.len);
  _dv.copy(b.p).addScaledVector(b.dir, -tailLen);
  b.m.set(_dv, b.p, b.color, b.k);
}
function scheduleShots(P) {
  if (P.down || P.away || game.stage !== 'live' && !P.demo) return;
  const gt = P.clock.gt;
  if (gt < P.nextShot) return;
  const w = waveInfo(P);
  const ready = P.drones.filter((x) => x.alive && x.state === 'fly' && x.charge === 0);
  if (!ready.length) {
    P.nextShot = gt + 0.3;
    return;
  }
  // 한 번에 몰아 쏘지 않도록 하나씩(가끔 둘)
  const pick = ready[Math.floor(Math.random() * ready.length)];
  startCharge(P, pick);
  if (Math.random() < w.double && ready.length > 1) {
    const other = ready.filter((x) => x !== pick)[Math.floor(Math.random() * (ready.length - 1))];
    startCharge(P, other);
    other.chargeDur += 0.24;
  }
  P.nextShot = gt + w.gap * (0.8 + Math.random() * 0.4) + w.charge;
}
function topUpDrones(P) {
  const want = P.demo ? 3 : waveInfo(P).drones;
  const alive = P.drones.filter((x) => x.alive).length + P.respawn.length;
  for (let k = alive; k < want; k++) spawnDrone(P, k * 0.5);
}

// ================================================================
// 광탄: 날아가기, 칼에 닿기(튕김), 몸에 닿기(피격), 되돌아가 드론 맞히기(격추)
// ================================================================
const _a = V();
const _b = V();
const _c1 = V();
const _c2 = V();
const _d1 = V();
const _d2 = V();
const _r = V();
// 두 선분 사이 최단 거리. c1, c2 에 가장 가까운 두 점을, segT 에 둘째 선분 위 위치(0~1)를 남깁니다.
let segT = 0;
function segSeg(p1, q1, p2, q2, c1, c2) {
  _d1.subVectors(q1, p1);
  _d2.subVectors(q2, p2);
  _r.subVectors(p1, p2);
  const a = _d1.dot(_d1);
  const e = _d2.dot(_d2);
  const f = _d2.dot(_r);
  let s = 0;
  let t = 0;
  if (a <= 1e-9 && e <= 1e-9) {
    s = 0;
    t = 0;
  } else if (a <= 1e-9) {
    t = clamp(f / e, 0, 1);
  } else {
    const c = _d1.dot(_r);
    if (e <= 1e-9) {
      s = clamp(-c / a, 0, 1);
    } else {
      const b = _d1.dot(_d2);
      const den = a * e - b * b;
      s = den !== 0 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  c1.copy(p1).addScaledVector(_d1, s);
  c2.copy(p2).addScaledVector(_d2, t);
  segT = t;
  return c1.distanceTo(c2);
}

const _bb = V();
const _bt = V();
const _pb = V();
const _pt = V();
function updateBolts(P, dtG, dtR, now) {
  for (const b of P.bolts) {
    if (b.state === 'dead') continue;
    b.age += dtG;
    if (b.state === 'in') {
      const step = (b.speed * dtG) / SUBSTEPS;
      for (let k = 1; k <= SUBSTEPS && b.state === 'in'; k++) {
        const f = k / SUBSTEPS;
        _a.copy(b.p);
        _b.copy(b.p).addScaledVector(b.dir, step);
        if (P.ign > 0.5 && !P.down) {
          _bb.lerpVectors(P.prevEmitter, P.emitter, f);
          _bt.lerpVectors(P.prevTip, P.tip, f);
          const dist = segSeg(_a, _b, _bb, _bt, _c1, _c2);
          if (dist < dl(P).hitR) {
            deflect(P, b, _c1, _c2, segT, dtR, now);
            break;
          }
        }
        b.p.copy(_b);
        b.traveled += step;
        if (b.traveled >= b.pathLen && !guardCatch(P, b, dtR, now)) hurt(P, b, now);
      }
      // 첫 경고: 몸에 닿기 직전(슬로우가 걸리는 때) 폰을 울립니다.
      if (b.state === 'in' && !b.cued && (b.pathLen - b.traveled) / b.speed < dl(P).slowLead) {
        b.cued = true;
        if (!P.bot && now - P.lastCue > 220) {
          P.lastCue = now;
          send('cue', { kind: 'bolt' }, P.slot);
        }
      }
    } else if (b.state === 'out') {
      // 격추 여부 정하기(늦게 오는 swing 을 기다렸다가)
      if (b.kill == null && now >= b.decideAt) {
        b.kill = Boolean(b.candidate && b.candidate.alive && strongSwingNear(P, b.contactReal));
        b.speed = b.kill ? 19 : 15;
        if (b.kill) b.homing = b.candidate;
        else if (b.candidate) {
          // 드론을 살짝 비껴가게 방향을 틉니다.
          _dv.subVectors(b.candidate.p, b.p).normalize();
          _a.crossVectors(b.dir, _dv);
          if (_a.lengthSq() < 1e-6) _a.set(0, 1, 0);
          b.dir.applyAxisAngle(_a.normalize(), -0.16).normalize();
        }
      }
      const tgt = b.homing && b.homing.alive ? b.homing : b.kill == null ? b.candidate : null;
      if (tgt && tgt.alive) {
        _dv.subVectors(tgt.p, b.p);
        const dist = _dv.length();
        _dv.divideScalar(dist || 1);
        const rate = b.kill ? 14 : 2.5; // 격추로 정해지면 강하게 끌립니다
        const ang = b.dir.angleTo(_dv);
        if (ang > 1e-4) {
          const turn = Math.min(ang, rate * dtG);
          _a.crossVectors(b.dir, _dv);
          if (_a.lengthSq() > 1e-9) b.dir.applyAxisAngle(_a.normalize(), turn).normalize();
        }
      }
      const step = b.speed * dtG;
      b.p.addScaledVector(b.dir, step);
      // 드론 맞힘(격추로 정해진 것, 또는 우연히 다른 드론에 맞은 것)
      for (const dr of P.drones) {
        if (!dr.alive || dr.state === 'enter' && dr.t < 0.3) continue;
        if (dr.p.distanceTo(b.p) < DRONE_HIT && (b.kill === true || dr !== b.candidate)) {
          killDrone(P, dr, b);
          b.state = 'dead';
          break;
        }
      }
      if (b.state === 'dead') continue;
      const out = b.p.y < 0.02 || b.p.y > 11.5 || b.p.z < -23.6 || b.p.z > 4 || Math.abs(b.p.x - P.sx) > 11.6 || b.age > 4;
      if (out) {
        b.state = 'dead';
        const hit = _a.copy(b.p);
        hit.y = Math.max(0.02, hit.y);
        if (!P.demo || Math.random() < 0.5) view.sparks.emit(hit, 14, { color: '#ffffff', color2: P.color, speed: 2.4, life: 0.4, size: 0.03, hot: 2.5 });
        view.flash(hit, P.color, 0.35, 0.18, 'glow', 2.2);
        if (!P.demo) sfx.wall();
      }
    }
    if (b.state !== 'dead') {
      b.k = b.state === 'out' ? 1.25 : 1;
      drawBolt(b);
    }
  }
  // 정리
  for (let i = P.bolts.length - 1; i >= 0; i--) {
    if (P.bolts[i].state === 'dead') {
      view.freeBolt(P.bolts[i].m);
      P.bolts.splice(i, 1);
    }
  }
}

// 쉬움·보통: 몸에 닿기 직전, 최근(guardMs) 칼이 광탄 길목 가까이(guardR) 지나갔으면 막은 것으로 봐줍니다.
// 큰 방향만 맞으면 막히게 하는 보정입니다(정확한 칼 위치는 조금만 봄).
const _ga = V();
const _gb = V();
const _gc1 = V();
const _gc2 = V();
function guardCatch(P, b, dtR, now) {
  const L = dl(P);
  if (!L.guardR || P.down || P.demo || P.ign < 0.5) return false;
  _gb.copy(b.target);
  _ga.copy(b.target).addScaledVector(b.dir, -1.1);
  let best = 9;
  let bestT = 0;
  for (const r of P.blades) {
    if (!r.on || now - r.t > L.guardMs) continue;
    const d = segSeg(_ga, _gb, r.e, r.tip, _c1, _c2);
    if (d < best) {
      best = d;
      bestT = segT;
      _gc1.copy(_c1);
      _gc2.copy(_c2);
    }
  }
  if (best > L.guardR) return false;
  b.p.copy(_gc1);
  deflect(P, b, _gc1, _gc2, bestT, dtR, now);
  return true;
}

const _ax = V();
const _vp = V();
const _bv = V();
function deflect(P, b, cBolt, cBlade, tBlade, dtR, now) {
  // 칼날 축 a 를 기준으로, 축에 수직인 성분을 뒤집고 축 방향 성분은 줄여서 남깁니다(둥근 칼날에서 튕김).
  _ax.subVectors(P.tip, P.emitter).normalize();
  const v = b.dir;
  const par = v.dot(_ax);
  _vp.copy(v).addScaledVector(_ax, -par); // 수직 성분
  const out = V().copy(_ax).multiplyScalar(par * 0.7).sub(_vp);
  // 칼이 움직이던 방향(화면에 보이는 칼날 기준)도 조금 더합니다.
  _bv.lerpVectors(P.prevEmitter, P.prevTip, tBlade);
  _a.lerpVectors(P.emitter, P.tip, tBlade);
  _bv.subVectors(_a, _bv).divideScalar(Math.max(0.008, dtR));
  _bv.addScaledVector(_ax, -_bv.dot(_ax));
  out.addScaledVector(_bv, 0.06);
  out.normalize();
  // 몸 쪽으로는 되돌아가지 않게(앞으로 날아가게)
  if (out.z > -0.25) {
    out.z = -0.25 - Math.abs(out.z) * 0.4;
    out.normalize();
  }
  const C = cBolt.clone().lerp(cBlade, 0.5);
  b.p.copy(C);
  b.dir.copy(out);
  b.state = 'out';
  // 격추 여부가 정해질 때까지는 조금 느리게(늦게 도착하는 swing 을 기다리는 동안 드론에 닿지 않게)
  b.speed = 10;
  b.color.set(P.color);
  b.age = 0;
  b.contactReal = now;
  b.decideAt = now + DECIDE_MS;
  b.traveled = b.len;
  // 튕긴 방향과 가장 가까운 드론
  let best = null;
  let bestAng = 9;
  for (const dr of P.drones) {
    if (!dr.alive) continue;
    _dv.subVectors(dr.p, C).normalize();
    const ang = out.angleTo(_dv);
    if (ang < bestAng) {
      bestAng = ang;
      best = dr;
    }
  }
  const L = dl(P);
  b.candidate = best && bestAng < L.assistAng * RAD ? best : null;
  if (b.candidate && (bestAng < L.goodAng * RAD || strongSwingNear(P, now))) {
    b.kill = true;
    b.homing = b.candidate;
    b.speed = 19;
  }
  // 점수·연출
  P.deflects += 1;
  P.score += DEFLECT_PTS;
  P.streak += 1;
  P.bestStreak = Math.max(P.bestStreak, P.streak);
  P.swingFx = Math.min(1, P.swingFx + 0.5);
  view.sparks.emit(C, P.demo ? 18 : 34, { color: '#ffffff', color2: P.color, speed: 3.4, life: 0.5, size: 0.028, hot: 3.2, dir: out, cone: 0.9 });
  view.flash(C, '#ffffff', 0.5, 0.14, 'glow', 4);
  view.flash(C, P.color, 0.25, 0.3, 'ring', 2.5);
  if (P.demo) return;
  sfx.deflect(b.kill === true);
  P.shake = Math.max(P.shake, 0.35);
  const lines = ['막기!', '튕겨냈어요!', '좋아요!', '막기!'];
  hudCall(P, P.streak >= 3 ? `${P.streak} 연속!` : lines[P.deflects % lines.length], `+${DEFLECT_PTS}`, P.streak >= 5 ? 'streak' : 'good', 800);
  if (!P.bot) sendHit(P.slot, { kind: 'deflect' });
  pushState();
}

function hurt(P, b, now) {
  b.state = 'dead';
  const hitP = b.target;
  view.sparks.emit(_a.copy(hitP).add(_dv.set(0, 0, -0.25)), P.demo ? 10 : 26, { color: ENEMY, color2: '#ffffff', speed: 2.6, life: 0.45, size: 0.03, hot: 3 });
  if (P.demo) return;
  const w = waveInfo(P);
  P.hp = Math.max(0, P.hp - w.dmg);
  P.hurts += 1;
  P.streak = 0;
  P.shake = 1;
  sfx.hurt();
  hudHurt(P);
  if (!P.bot) sendHit(P.slot, { kind: 'hurt' });
  if (P.hp <= 0 && !P.down) knockDown(P, now);
  else hudCall(P, '맞았어요', `체력 ${Math.ceil(P.hp)}`, 'bad', 700);
  pushState();
}

function knockDown(P, now) {
  P.down = true;
  P.downAt = now;
  P.ignTarget = 0;
  sfx.down();
  // 남은 광탄은 흩어지고 드론은 멈춥니다.
  for (const b of P.bolts) if (b.state === 'in') b.state = 'dead';
  for (const dr of P.drones) {
    dr.charge = 0;
    if (dr.alive) dr.d.setCharge(0);
  }
  const i = viewIndex(P);
  if (isDuel()) {
    P.result = 'ko';
    if (i >= 0) hud.banner(i, '패배', `${P.score.toLocaleString('ko-KR')}점`, `막기 ${P.parries} · 베기 ${P.strikes}`, 'bad');
  } else if (i >= 0) hud.banner(i, '쓰러졌어요', `${P.score.toLocaleString('ko-KR')}점`, `막기 ${P.deflects} · 격추 ${P.kills}`, 'bad');
  pushState(true);
  if (allOut(now)) endRound(now);
}
// 판이 끝났는지: 모두 쓰러졌거나(검투는 모두 승패가 났거나), 남은 사람은 폰이 오래 끊겨 있음.
// 아무도 쓰러지지 않고 모두 끊긴 경우는 tick 의 allGoneSince(대기실로 돌아감)가 맡습니다.
function allOut(now) {
  const gone = (x) => x.away && x.awaySince && now - x.awaySince > AWAY_OUT_MS;
  if (isDuel()) return game.players.some((x) => x.result) && game.players.every((x) => x.result || gone(x));
  return game.players.some((x) => x.down) && game.players.every((x) => x.down || gone(x));
}

function killDrone(P, dr, b) {
  dr.alive = false;
  const p = dr.p.clone();
  view.flash(p, '#ffffff', 1.1, 0.25, 'glow', 5);
  view.flash(p, '#ff8a3a', 1.7, 0.6, 'glow', 2.5);
  view.flash(p, P.color, 0.6, 0.55, 'ring', 2.4);
  view.sparks.emit(p, P.demo ? 40 : 90, { color: '#ffd29a', color2: '#ff5a2a', speed: 5.5, life: 0.9, size: 0.04, hot: 3.4, gravity: 3 });
  view.sparks.emit(p, P.demo ? 10 : 24, { color: ENEMY, color2: '#ffffff', speed: 3, life: 0.6, size: 0.05, hot: 3 });
  view.burstDebris(p, P.demo ? 5 : 9, 3.2);
  view.freeDrone(dr.d);
  const idx = P.drones.indexOf(dr);
  if (idx >= 0) P.drones.splice(idx, 1);
  // 2초쯤 뒤 새 드론이 격납구에서 나옵니다.
  P.respawn.push(P.clock.gt + 1.8 + Math.random() * 0.8);
  assignSlots(P);
  if (P.demo) return;
  P.kills += 1;
  P.score += KILL_BONUS;
  sfx.kill();
  hudToast(P, '격추!', `+${DEFLECT_PTS + KILL_BONUS}점 · ${P.kills}대째`, 'kill');
  if (!P.bot) sendHit(P.slot, { kind: 'kill' });
  pushState();
}

// ================================================================
// 칼 움직임(폰 자세 → 칼자루·칼날), 점화, 잔상
// ================================================================
const _qT = new THREE.Quaternion();
const IDLE_S = new THREE.Vector3(-0.28, 0.82, -0.5).normalize();
const _fc = V();
function updateSaber(P, dtR, now) {
  P.prevEmitter.copy(P.emitter);
  P.prevTip.copy(P.tip);
  // 목표 자세: 폰(또는 봇·마우스) 자세. 0.8초 넘게 안 오면 기본 자세로 천천히.
  const live = P.pose && now - P.pose.at < 800;
  if (live) quatFrom(P.pose.s, P.pose.fc, _qT);
  else quatFrom(IDLE_S, _fc.set(0, 0.2, 1), _qT);
  if (!P.qInit) {
    P.q.copy(_qT);
    P.qInit = true;
  } else {
    P.q.slerp(_qT, 1 - Math.exp(-dtR / (live ? 0.02 : 0.4)));
  }
  P.dir.set(0, 1, 0).applyQuaternion(P.q);
  gripFor(P, P.dir, P.grip);
  P.emitter.copy(P.grip).addScaledVector(P.dir, HILT.emitter);
  // 점화: 켤 땐 0.32초, 끌 땐 0.5초
  const up = P.ignTarget > P.ign;
  P.ign += clamp(P.ignTarget - P.ign, -dtR / 0.5, dtR / 0.32);
  const e = up ? 1 - Math.pow(1 - P.ign, 3) : P.ign * P.ign;
  const len = BLADE_LEN * e;
  P.tip.copy(P.emitter).addScaledVector(P.dir, Math.max(0.0001, len));
  if (!P.prevInit) {
    P.prevEmitter.copy(P.emitter);
    P.prevTip.copy(P.tip);
    P.prevInit = true;
  }
  const rec = P.blades[P.bladeHead];
  P.bladeHead = (P.bladeHead + 1) % P.blades.length;
  rec.t = now;
  rec.e.copy(P.emitter);
  rec.tip.copy(P.tip);
  rec.on = P.ign > 0.5;
  // 깜빡임
  P.flickT += dtR;
  const t = P.flickT;
  const flick = 1 + 0.045 * Math.sin(t * 61) * Math.sin(t * 7.3) + 0.03 * Math.sin(t * 143) + (Math.random() - 0.5) * 0.04;
  // 잔상: 칼끝 속도(화면에 보이는 움직임)와 최근 휘두르기
  const tipSpeed = P.tip.distanceTo(P.prevTip) / Math.max(0.008, dtR);
  P.swingFx = Math.max(0, P.swingFx - dtR * 2.2);
  const trailK = clamp((tipSpeed - 1.6) / 5, 0, 1) * clamp(e * 1.4, 0, 1) + P.swingFx * 0.3 * e;
  view.poseSaber(P.key, {
    grip: P.grip, quat: P.q, dir: P.dir, emitter: P.emitter, len, power: e, flick, trailK: clamp(trailK, 0, 1), visible: true
  });
}

// ================================================================
// 봇(시험용 ?bots=N, 대기실 시연): 폰과 같은 길(onPose / onSwing)로 칼을 움직입니다.
// ================================================================
const _I = V();
const _want = V();
const _q1 = new THREE.Quaternion();
function gauss() {
  return (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 0.577;
}
function botThink(P, dtR, now) {
  // 가장 급한 광탄
  let threat = null;
  let ttb = 9;
  for (const b of P.bolts) {
    if (b.state !== 'in') continue;
    const t = (b.pathLen - b.traveled) / b.speed;
    if (t < ttb) {
      ttb = t;
      threat = b;
    }
  }
  if (threat !== P.botThreat) {
    P.botThreat = threat;
    if (threat) {
      const failP = P.demo ? 0.08 : 0.05 + game.wave * 0.035;
      P.botReactAt = now + 150 + Math.random() * 170;
      P.botFail = Math.random() < failP;
      P.botSwing = Math.random() < (P.demo ? 0.45 : 0.55);
      P.botSwung = false;
      P.botErr = new THREE.Vector3(gauss(), gauss(), gauss()).multiplyScalar(0.035);
    }
  }
  if (threat && now >= P.botReactAt) {
    // 몸에서 0.9m 앞, 광탄 경로 위의 점을 칼날이 지나가게
    const fromBody = 0.95;
    const along = threat.traveled + 0.25 > threat.pathLen - fromBody ? Math.min(threat.pathLen - 0.15, threat.traveled + 0.25) : threat.pathLen - fromBody;
    _I.copy(threat.start).addScaledVector(threat.dir, along);
    if (P.botFail) _I.x += P.botErr.x > 0 ? 0.55 : -0.55;
    else _I.add(P.botErr);
    aimThrough(P, _I, _want);
    // 닿기 직전 휘두르기: 광탄 진행 방향을 축으로 칼을 쓸어 넘깁니다.
    // (막는 지점이 몸보다 0.95m 앞이라 닿기 조금 전부터 시작합니다)
    if (P.botSwing && ttb < 0.3) {
      P.botSweep = Math.min(1, P.botSweep + dtR * 8);
      P.botSweepAxis.copy(threat.dir);
      if (!P.botSwung && ttb < 0.24) {
        P.botSwung = true;
        onSwing({ P, speed: 450 + Math.random() * 600, ago: 0, rtt: 0 }, true);
      }
    }
  } else {
    // 기본 자세(가볍게 흔들림), 가끔 연습 휘두르기
    const t = now / 1000;
    _want.copy(IDLE_S);
    _want.x += 0.12 * Math.sin(t * 0.7 + P.station);
    _want.y += 0.08 * Math.sin(t * 0.53 + 1);
    _want.normalize();
    if (now > P.botNextFlourish && !threat) {
      P.botNextFlourish = now + 4000 + Math.random() * 5000;
      P.botSweep = 1;
      P.botSweepAxis.set(0, 0, -1);
    }
  }
  if (P.botSweep > 0) {
    _q1.setFromAxisAngle(P.botSweepAxis, P.botSweep * 0.55 * Math.sin(P.botSweep * Math.PI));
    _want.applyQuaternion(_q1);
    P.botSweep = Math.max(0, P.botSweep - dtR * 3.5);
  }
  // 사람처럼 각속도 한계(초당 9라디안)
  const ang = P.botS.angleTo(_want);
  if (ang > 1e-4) {
    const step = Math.min(1, (9 * dtR) / ang);
    P.botS.lerp(_want, step).normalize();
  }
  _fc.set(0, 0.15, 1);
  onPose({ P, s: toBasis(P.botS), fc: toBasis(_fc) }, true);
}

// 검투 봇·키보드: 원하는 칼 방향(세계)으로 사람처럼 각속도 한계(초당 12라디안)를 두고 돌립니다. 휘두를 때는 칼을 쓸어 넘깁니다.
const _q2 = new THREE.Quaternion();
function setBotDir(P, want, dtR) {
  _want.copy(want);
  if (P.botSweep > 0) {
    _q1.setFromAxisAngle(P.botSweepAxis, P.botSweep * 0.75 * Math.sin(P.botSweep * Math.PI));
    _want.applyQuaternion(_q1);
    P.botSweep = Math.max(0, P.botSweep - dtR * 4);
  }
  const ang = P.botS.angleTo(_want);
  if (ang > 1e-4) {
    _q1.setFromUnitVectors(P.botS, _want);
    _q2.identity().slerp(_q1, Math.min(1, (12 * dtR) / ang));
    P.botS.applyQuaternion(_q2).normalize();
  }
  _fc.set(0, 0.15, 1);
  onPose({ P, s: toBasis(P.botS), fc: toBasis(_fc) }, true);
}
function botSwing(P, speed) {
  P.botSweep = 1;
  P.botSweepAxis.set(Math.random() < 0.5 ? -0.35 : 0.35, 0.25, -1).normalize();
  onSwing({ P, speed, ago: 0, rtt: 0 }, true);
}

// 로봇 검투(duel.js)에 넘기는 도구들
const duel = createDuel({
  view, sfx,
  // 봇 자리(폰 없음)에는 보내지 않습니다.
  send: (event, data, slot) => {
    const P = playerBySlot(slot);
    if (!P || P.bot) return;
    if (event === 'hit') sendHit(slot, data);
    else send(event, data, slot);
  },
  level: (P) => levelOf(P),
  live: (P) => P.demo || (game.phase === 'playing' && game.stage === 'live'),
  elapsed: () => (game.stage === 'live' ? (performance.now() - game.liveAt) / 1000 : 0),
  timeLeft: () => secondsLeft(),
  poseLag: (P) => (P.pose && P.pose.local ? 0 : 55 + displayRtt() / 2),
  hudCall, hudToast, hudNote, hudHurt,
  hudFx: (P, kind, data) => {
    const i = viewIndex(P);
    if (i >= 0) hud.fx(i, kind, data);
  },
  knockDown, pushState,
  setBotDir, botSwing,
  onWin: (P, bonus) => {
    const i = viewIndex(P);
    const t = Math.round(P.winAt);
    if (i >= 0) hud.banner(i, '승리!', `${P.score.toLocaleString('ko-KR')}점`, `${t}초 만에 쓰러뜨림 · 보너스 +${bonus}`, 'good');
    sfx.win();
    if (allOut(performance.now())) endRound(performance.now());
  }
});

// ---------- 마우스·키보드(시험용): 칸을 클릭(또는 Space)하면 그 칸의 칼을 마우스로 직접 조종 ----------
// 그냥 마우스가 지나가는 것만으로는 봇을 빼앗지 않습니다. 4초 동안 조작이 없으면 봇은 다시 자동으로 막습니다.
const mouse = { x: 0, y: 0, at: 0, cell: -1 };
function takeOver(P) {
  // 폰 자세가 살아 있으면 폰이 우선입니다.
  if (!P || (P.pose && !P.pose.local && performance.now() - P.pose.at < 1000)) return false;
  if (!P.manual) hudNote(P, '마우스로 조종 중 · Space 휘두르기 · A 자동 막기', 2200);
  P.manual = true;
  P.manualAt = performance.now();
  return true;
}
window.addEventListener('pointermove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.at = performance.now();
  if (game.phase !== 'playing') return;
  mouse.cell = cellAt(e.clientX, e.clientY);
  const P = mouse.cell >= 0 ? cellPlayer(mouse.cell) : null;
  if (P && P.manual) P.manualAt = mouse.at;
});
window.addEventListener('pointerdown', (e) => {
  if (game.phase !== 'playing') return;
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.at = performance.now();
  mouse.cell = cellAt(e.clientX, e.clientY);
  if (mouse.cell >= 0) takeOver(cellPlayer(mouse.cell));
});
function cellAt(x, y) {
  return lastViews.findIndex((v) => v.kind === 'player' && x >= v.x && x < v.x + v.w && y >= v.y && y < v.y + v.h);
}
function cellPlayer(i) {
  const v = lastViews[i];
  return v && v.kind === 'player' ? game.players.find((p) => p.key === v.key) : null;
}
const KEY_DIR = {
  ArrowLeft: new THREE.Vector3(-0.72, 0.68, -0.15).normalize(),
  ArrowRight: new THREE.Vector3(0.72, 0.68, -0.15).normalize(),
  ArrowUp: new THREE.Vector3(-0.96, 0.2, -0.2).normalize(),
  ArrowDown: new THREE.Vector3(0.06, 0.92, -0.38).normalize()
};
const _ray = V();
function manualThink(P, i, dtR, now) {
  const v = lastViews[i];
  const cam = view.cams[i];
  if (!v || !cam) return;
  const nx = ((mouse.x - v.x) / v.w) * 2 - 1;
  const ny = -(((mouse.y - v.y) / v.h) * 2 - 1);
  _ray.set(clamp(nx, -1.2, 1.2), clamp(ny, -1.2, 1.2), 0.5).unproject(cam).sub(cam.position).normalize();
  _I.copy(cam.position).addScaledVector(_ray, 1.25);
  aimThrough(P, _I, _want);
  if (P.manualSweep > 0) {
    _q1.setFromAxisAngle(_ray, -P.manualSweep * 0.9 * Math.sin(P.manualSweep * Math.PI));
    _want.applyQuaternion(_q1);
    P.manualSweep = Math.max(0, P.manualSweep - dtR * 4);
  }
  _fc.set(0, 0.15, 1);
  onPose({ P, s: toBasis(_want), fc: toBasis(_fc) }, true);
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (game.phase !== 'playing') startGame();
    return;
  }
  if (game.phase !== 'playing') return;
  const i = mouse.cell >= 0 ? mouse.cell : 0;
  const P = cellPlayer(i) || game.players[0];
  if (!P) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (e.repeat) return;
    const now = performance.now();
    if (P.keyUntil > now) {
      // 방향키로 막는 중이면 그 자세에서 휘두릅니다(검투의 베기·쳐내기 시험).
      P.botSweep = 1;
      P.botSweepAxis.set(Math.random() < 0.5 ? -0.35 : 0.35, 0.25, -1).normalize();
      P.keyUntil = Math.max(P.keyUntil, now + 500);
    } else {
      takeOver(P);
      P.manualSweep = 1;
    }
    onSwing({ P, speed: 900, ago: 0, rtt: 0 }, true);
  } else if (KEY_DIR[e.code]) {
    // 방향키: 칼을 그 쪽으로 세워 막기(← → 옆으로 기울이기, ↑ 눕혀서 위 막기, ↓ 가운데 세우기). 1.2초 동안 유지합니다.
    e.preventDefault();
    if (P.pose && !P.pose.local && performance.now() - P.pose.at < 1000) return;
    if (!P.keyDir || P.keyUntil < performance.now()) hudNote(P, '방향키로 막는 중 · Space 휘두르기', 1600);
    P.keyDir = KEY_DIR[e.code];
    P.keyUntil = performance.now() + 1200;
    P.manual = false;
  } else if (e.code === 'KeyA') {
    // 자동 막기(봇)로 돌리기
    P.manual = false;
    P.autoplay = !P.autoplay || P.bot;
    hudNote(P, P.autoplay ? '자동 막기 켜짐' : '자동 막기 꺼짐', 1200);
  }
});

// ================================================================
// 경기 시작·진행·끝
// ================================================================
function clearField(P) {
  for (const dr of P.drones) if (dr.alive) view.freeDrone(dr.d);
  for (const b of P.bolts) view.freeBolt(b.m);
  P.drones = [];
  P.bolts = [];
  P.respawn = [];
}
function startDemo() {
  if (game.demo) return;
  const D = newPlayer(null, 1, true);
  D.mode = settings.get('mode');
  D.ign = 0;
  D.ignTarget = 1;
  game.demo = D;
  if (D.mode === 'duel') {
    // 대기실 시연: 로봇 검객이 자동 칼과 겨룹니다(막고, 비틀거리면 베고, 쓰러지면 새 로봇이 걸어 들어옴).
    D.level = 'normal';
    duel.setup(D, { walk: false });
  } else {
    D.az = 0.62;
    topUpDrones(D);
  }
  syncSabers();
}
function stopDemo() {
  if (!game.demo) return;
  clearField(game.demo);
  duel.clear(game.demo);
  game.demo = null;
  syncSabers();
}
function syncSabers() {
  const playing = game.phase === 'playing';
  const list = playing ? game.players.map((P) => ({ key: P.key, color: P.color })) : [];
  if (game.demo) list.push({ key: 'demo', color: DEMO_COLOR });
  view.setSabers(list);
  view.setStations(playing
    ? game.players.map((P) => ({ i: P.station, color: P.color, label: P.name, sub: P.bot ? 'BOT' : isDuel() ? 'DUEL' : '' }))
    : game.demo ? [{ i: game.demo.station, color: DEMO_COLOR, label: 'DEMO', sub: game.demo.mode === 'duel' ? 'DUEL' : 'AUTO' }] : []);
}

// 대기실 글: 고른 모드에 맞춰 설명과 결과 화면 제목을 바꿉니다.
function applyModeCopy() {
  const m = MODES[settings.get('mode')] || MODES.duel;
  const lede = $('lede');
  if (lede && lede.textContent !== m.lede) lede.textContent = m.lede;
  document.body.dataset.mode = settings.get('mode');
}
// 설정(모드·난이도)이 바뀜: 대기실이면 시연을 그 모드로 바꾸고, 폰에 새 값을 보냅니다.
function onSettingsChanged() {
  applyModeCopy();
  if (game.phase !== 'playing' && game.demo && game.demo.mode !== settings.get('mode')) {
    stopDemo();
    startDemo();
  }
  renderLobby();
  pushState(true);
}

function startGame() {
  if (game.phase === 'playing') return;
  if (!settings.requireAnswered()) return;
  const list = lobbyPlayers().filter((p) => p.connected).slice(0, 4);
  if (!list.length) {
    lobbyMessage('폰을 먼저 연결해 주세요. QR을 찍고 시작하기를 누르면 자리가 생겨요.');
    return;
  }
  audio();
  stopDemo();
  for (const P of game.players) {
    clearField(P);
    duel.clear(P);
  }
  game.mode = settings.get('mode');
  settings.lock(true);
  board.hide(true);
  const order = STATION_ORDER[list.length];
  game.players = list.map((p, k) => newPlayer(p, order[k]));
  for (const P of game.players) {
    P.calibrated = game.ready.has(P.slot);
    P.autoplay = P.bot;
    P.level = settings.difficulty();
  }
  game.phase = 'playing';
  game.stage = 'intro';
  game.wave = 1;
  game.introAt = performance.now();
  game.lastCount = 0;
  game.results = [];
  lastSec = -1;
  hud.clear();
  const views = layoutViews();
  for (const P of game.players) {
    if (isDuel()) {
      // 로봇이 격납구 쪽에서 걸어 들어와 칼을 켜고 인사한 뒤, '시작!' 과 함께 겨눕니다.
      duel.setup(P);
      continue;
    }
    // 칸 모양에 맞춰 드론이 날아다닐 좌우 폭을 정합니다(화면 안에 머물도록).
    const v = views.find((x) => x.key === P.key);
    const hf = v ? hFov(v) : 90;
    P.az = clamp((hf / 2 - 9) * (Math.PI / 180), 0.32, 0.72);
    topUpDrones(P);
    P.nextShot = INTRO_S + 0.6;
  }
  syncSabers();
  $('lobby').classList.add('hidden');
  $('over').classList.add('hidden');
  $('join').classList.remove('hidden');
  if (isDuel()) sfx.duelStart();
  else sfx.wave();
  pushState(true);
}

function goLive(now) {
  game.stage = 'live';
  game.liveAt = now;
  for (const P of game.players) {
    P.ignTarget = 1;
    P.clock.gt = 0;
    P.nextShot = 0.9 + Math.random() * 0.5;
  }
  sfx.go();
  sfx.ignite();
  showCount('시작!', true);
  if (isDuel()) for (const P of game.players) hudCall(P, (DUEL_TEXT[P.level] || DUEL_TEXT.normal), '예고된 쪽을 막고, 비틀거리면 베요', 'duelcall', 1800);
  pushState(true);
}
const DUEL_TEXT = { easy: '검투 · 쉬움', normal: '검투 시작', hard: '검투 · 어려움' };

function endRound(now) {
  if (game.phase !== 'playing' || game.stage === 'end') return;
  game.stage = 'end';
  game.endAt = now;
  for (const P of game.players) {
    const i = viewIndex(P);
    if (isDuel()) {
      const had = P.result;
      duel.timeUp(P);
      if (!had && i >= 0) {
        const left = P.duel ? Math.ceil(P.duel.hp) : 0;
        if (P.result === 'tw') hud.banner(i, '판정승', `${P.score.toLocaleString('ko-KR')}점`, `시간 끝 · 로봇 체력 ${left} 남음`, 'good');
        else hud.banner(i, '판정패', `${P.score.toLocaleString('ko-KR')}점`, `시간 끝 · 로봇 체력 ${left} 남음`, 'bad');
      }
      continue;
    }
    for (const b of P.bolts) if (b.state === 'in') b.state = 'dead';
    for (const dr of P.drones) {
      dr.charge = 0;
      if (dr.alive) dr.d.setCharge(0);
    }
    if (!P.down && i >= 0) hud.banner(i, '훈련 끝!', `${P.score.toLocaleString('ko-KR')}점`, `막기 ${P.deflects} · 격추 ${P.kills}`, 'good');
  }
  sfx.retract();
  showCount('끝!', false);
  pushState(true);
}

// 검투 결과 순서: 쓰러뜨림(빠른 순) → 판정승 → 판정패 → 쓰러짐, 같으면 점수
const RESULT_RANK = { win: 0, tw: 1, tl: 2, ko: 3 };
const RESULT_TEXT = { win: '승리', tw: '판정승', tl: '판정패', ko: '패배' };
function showResults() {
  game.phase = 'over';
  const duelMode = isDuel();
  const rows = [...game.players].sort((a, b) => duelMode
    ? (RESULT_RANK[a.result] ?? 4) - (RESULT_RANK[b.result] ?? 4) || (a.result === 'win' ? a.winAt - b.winAt : 0) || b.score - a.score
    : b.score - a.score || b.kills - a.kills || b.hp - a.hp);
  game.results = rows.map((P, k) => ({
    slot: P.slot, rank: k + 1, score: P.score, deflects: P.deflects, kills: P.kills, hp: P.hp, down: P.down,
    result: P.result, parries: P.parries, strikes: P.strikes, robotHp: P.duel ? Math.ceil((P.duel.hp / P.duel.max) * 100) : null
  }));
  const m = MODES[game.mode] || MODES.duel;
  $('overMeta').textContent = `${m.eyebrow} · ${DIFF_LABEL[settings.difficulty()] || ''}`;
  $('overTitle').textContent = m.title;
  const box = $('podium');
  box.innerHTML = '';
  rows.forEach((P, k) => {
    const e = document.createElement('div');
    e.className = 'r';
    e.style.setProperty('--c', P.color);
    e.style.animationDelay = `${0.15 + k * 0.12}s`;
    const who = `<span class="rank">${k + 1}</span><span class="who">${P.name}${P.bot ? '<small>BOT</small>' : ''}</span>`;
    if (duelMode) {
      const r = P.result || 'tl';
      const rh = P.duel ? Math.ceil(P.duel.hp) : 0;
      e.innerHTML = who +
        `<span class="res ${r}">${RESULT_TEXT[r]}${r === 'win' ? `<small>${Math.round(P.winAt)}초</small>` : ''}</span>` +
        `<span class="num"><b>${P.parries}</b><span>막기</span></span>` +
        `<span class="num"><b>${P.strikes}</b><span>베기</span></span>` +
        `<span class="num"><b>${r === 'win' ? Math.ceil(P.hp) : r === 'ko' ? 'KO' : rh}</b><span>${r === 'win' ? '남은 체력' : r === 'ko' ? '쓰러짐' : '로봇 체력'}</span></span>` +
        `<span class="num big"><b>${P.score.toLocaleString('ko-KR')}</b><span>점수</span></span>`;
    } else {
      e.innerHTML = who +
        `<span class="num"><b>${P.deflects}</b><span>막기</span></span>` +
        `<span class="num"><b>${P.kills}</b><span>격추</span></span>` +
        `<span class="num"><b>${P.down ? 'KO' : Math.ceil(P.hp)}</b><span>${P.down ? '쓰러짐' : '남은 체력'}</span></span>` +
        `<span class="num big"><b>${P.score.toLocaleString('ko-KR')}</b><span>점수</span></span>`;
    }
    box.appendChild(e);
    if (!P.bot) {
      const text = duelMode
        ? `${RESULT_TEXT[P.result] || '끝'} · ${P.score.toLocaleString('ko-KR')}점`
        : `${k + 1}위 · ${P.score.toLocaleString('ko-KR')}점`;
      send('result', {
        text, rank: k + 1, of: rows.length, score: P.score, mode: game.mode, result: P.result || null,
        deflects: P.deflects, kills: P.kills, parries: P.parries, strikes: P.strikes, down: P.down,
        winAt: P.result === 'win' ? Math.round(P.winAt) : null
      }, P.slot);
    }
  });
  for (const P of game.players) {
    P.ignTarget = 0;
    clearField(P);
    duel.clear(P);
  }
  syncSabers();
  hud.clear();
  settings.lock(false);
  board.hide(false);
  $('over').classList.remove('hidden');
  $('join').classList.add('hidden');
  $('count').classList.remove('on');
  if (duelMode && rows.some((P) => P.result === 'win' || P.result === 'tw')) sfx.win();
  else if (duelMode) sfx.lose();
  else sfx.win();
  sfx.clap(40);
  startDemo();
  pushState(true);
}

function backToLobby(why) {
  for (const P of game.players) {
    clearField(P);
    duel.clear(P);
  }
  game.players = [];
  game.phase = 'lobby';
  game.stage = 'intro';
  hud.clear();
  settings.lock(false);
  board.hide(false);
  $('over').classList.add('hidden');
  $('join').classList.add('hidden');
  $('count').classList.remove('on');
  $('lobby').classList.remove('hidden');
  if (game.demo && game.demo.mode !== settings.get('mode')) stopDemo();
  startDemo();
  syncSabers();
  renderLobby();
  if (why) lobbyMessage(why);
  pushState(true);
}

// ---------- 폰으로 보내는 상태 ----------
let pushTimer = null;
let lastPush = 0;
function statePlayers() {
  const out = {};
  if (game.phase === 'lobby') {
    for (const p of lobbyPlayers().filter((x) => x.connected).slice(0, 4)) {
      out[p.slot] = { hp: MAX_HP, score: 0, deflects: 0, kills: 0, down: false, ready: game.ready.has(p.slot) };
    }
    return out;
  }
  for (const P of game.players) {
    if (P.slot == null) continue;
    const r = game.results.find((x) => x.slot === P.slot);
    const o = {
      hp: Math.ceil(P.hp), score: P.score, deflects: P.deflects, kills: P.kills, down: P.down, streak: P.streak,
      rank: r ? r.rank : null
    };
    if (game.mode === 'duel') {
      const D = P.duel;
      o.parries = P.parries;
      o.strikes = P.strikes;
      o.result = P.result || null;
      o.robot = D ? { name: D.name, hp: Math.ceil((D.hp / D.max) * 100), open: D.state === 'stagger' } : r ? { name: '', hp: r.robotHp ?? 0 } : null;
    }
    out[P.slot] = o;
  }
  return out;
}
const roundS = () => (game.mode === 'duel' ? DUEL_S : ROUND_S);
function secondsLeft() {
  if (game.phase !== 'playing') return 0;
  if (game.stage === 'intro') return roundS();
  if (game.stage === 'end') return 0;
  return Math.max(0, Math.ceil(roundS() - (performance.now() - game.liveAt) / 1000));
}
function pushState(force) {
  const now = performance.now();
  const go = () => {
    pushTimer = null;
    lastPush = performance.now();
    const playing = game.phase === 'playing';
    send('game_state', {
      phase: game.phase, stage: playing ? game.stage : null, t: secondsLeft(), round: roundS(),
      wave: game.wave, mode: playing || game.phase === 'over' ? game.mode : settings.get('mode'), level: settings.difficulty(),
      players: statePlayers(),
      // 경기 중에는 자주 보내므로 설정 항목 모양(fields)은 빼고 보냅니다(폰이 마지막 모양을 기억함).
      settings: settings.forState({ lite: playing && !force })
    });
  };
  if (force || now - lastPush > 150) {
    clearTimeout(pushTimer);
    go();
  } else if (!pushTimer) {
    pushTimer = setTimeout(go, 150 - (now - lastPush));
  }
}

// ================================================================
// 대기실 화면, HUD 도우미
// ================================================================
// 자리 칸: 누가 준비했는지(서버의 모두 준비 현황), 누가 아직 연습(튜토리얼) 중인지
function renderLobby() {
  const box = $('slots');
  if (!box) return;
  const list = lobbyPlayers();
  const st = readyState;
  const practicing = new Set(board.practicing ? board.practicing() : []);
  let html = '';
  for (let s = 1; s <= 4; s++) {
    const p = list.find((x) => x.slot === s);
    if (!p) {
      html += `<div class="slot">${s}P 비어 있음</div>`;
      continue;
    }
    const ready = p.bot || Boolean(st && Array.isArray(st.ready) && st.ready.includes(s));
    const prac = !p.bot && !ready && practicing.has(s);
    const sub = p.bot ? 'BOT' : ready ? '준비 완료 ✓' : prac ? '연습 중' : '준비 전';
    const cls = 'slot on' + (!p.connected ? ' away' : '') + (ready ? ' ready' : '') + (prac ? ' prac' : '');
    html += `<div class="${cls}" style="--c:${p.color}"><b>${p.name}</b><small>${sub}</small></div>`;
  }
  if (box.innerHTML !== html) box.innerHTML = html;
}
let msgTimer = null;
function lobbyMessage(t) {
  const e = $('msg');
  e.textContent = t;
  e.classList.add('on');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => e.classList.remove('on'), 2800);
}
let countTimer = null;
function showCount(text, go) {
  const e = $('count');
  e.textContent = text;
  e.className = `count on${go ? ' go' : ''}`;
  void e.offsetWidth;
  e.classList.add('pop');
  clearTimeout(countTimer);
  countTimer = setTimeout(() => e.classList.remove('on'), go ? 900 : 1600);
}
const viewIndex = (P) => lastViews.findIndex((v) => v.kind === 'player' && v.key === P.key);
// 검투 HUD 에 넘길 값(duel.hudState + 예고 글자)
function duelHud(P) {
  const st = duel.hudState(P);
  if (!st) return null;
  const lv = DUEL_LEVEL[P.level] || DUEL_LEVEL.normal;
  const t = st.warn ? KIND_TEXT[st.warn] : null;
  const D = P.duel;
  return {
    ...st, id: D.attackId, main: t ? t.main : '', sub: t ? t.sub : '', level: DIFF_LABEL[P.level] || '',
    hitNow: st.state === 'strike' || st.state === 'contact', open: st.state === 'stagger', maxHits: lv.maxHits,
    warn: game.stage === 'end' || P.down ? null : st.warn
  };
}
function hudCall(P, main, sub, cls, ms) {
  const i = viewIndex(P);
  if (i >= 0) hud.callout(i, main, sub, cls, ms);
}
function hudToast(P, main, sub, cls) {
  const i = viewIndex(P);
  if (i >= 0) hud.toast(i, main, sub, cls);
}
function hudNote(P, text, ms) {
  const i = viewIndex(P);
  if (i >= 0) hud.note(i, text, ms);
}
function hudHurt(P) {
  const i = viewIndex(P);
  if (i >= 0) hud.hurt(i);
}

// ================================================================
// 화면 분할과 카메라
// ================================================================
let lastViews = [];
function layoutViews() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  if (game.phase !== 'playing') return [{ kind: 'overview', x: 0, y: 0, w: W, h: H }];
  const n = game.players.length;
  const hw = Math.floor(W / 2);
  const hh = Math.floor(H / 2);
  const cells = n === 1 ? [[0, 0, W, H]] : n === 2 ? [[0, 0, hw, H], [hw, 0, W - hw, H]] : [[0, 0, hw, hh], [hw, 0, W - hw, hh], [0, hh, hw, H - hh], [hw, hh, W - hw, H - hh]];
  const out = game.players.map((P, i) => ({ kind: 'player', key: P.key, slot: P.slot, color: P.color, name: P.name, duel: Boolean(P.duel), x: cells[i][0], y: cells[i][1], w: cells[i][2], h: cells[i][3] }));
  if (n === 3) out.push({ kind: 'overview', x: cells[3][0], y: cells[3][1], w: cells[3][2], h: cells[3][3] });
  return out;
}
// 좁은 칸에서도 좌우가 충분히 보이도록 세로 화각을 넓힙니다.
function vFov(v) {
  const aspect = v.w / Math.max(1, v.h);
  const want = 2 * Math.atan(Math.tan((78 * Math.PI) / 360) / aspect) * (180 / Math.PI);
  return clamp(want, 64, 84);
}
function hFov(v) {
  const aspect = v.w / Math.max(1, v.h);
  return 2 * Math.atan(Math.tan((vFov(v) * Math.PI) / 360) * aspect) * (180 / Math.PI);
}
function playerCam(P, v, dtR, now) {
  P.shake = Math.max(0, P.shake - dtR * 3.2);
  const j = P.shake * P.shake * 0.03;
  const t = now / 1000;
  const bx = 0.012 * Math.sin(t * 0.8 + P.station) + (Math.random() - 0.5) * j;
  const by = 0.01 * Math.sin(t * 1.1) + (Math.random() - 0.5) * j;
  const pos = [P.sx + CAM_OFF[0] + bx, CAM_OFF[1] + by, CAM_OFF[2]];
  const look = [P.sx + bx * 0.5, CAM_OFF[1] - Math.tan(CAM_PITCH) * 6.4, -6];
  return { pos, look, fov: vFov(v), roll: (Math.random() - 0.5) * j * 0.6 };
}
// 대기실 카메라가 시연 칼을 놓을 화면 가로 위치(-1 왼쪽 ~ 1 오른쪽): QR 카드 오른쪽 빈 곳.
// 카드 위치는 1초마다만 읽고(매 프레임 레이아웃 읽기 방지), 바뀌면 천천히 따라갑니다.
const lobbyAim = { at: -1e9, want: 0.8, cur: null };
function lobbyAimNx(now) {
  if (now - lobbyAim.at > 1000) {
    lobbyAim.at = now;
    const card = document.querySelector('#lobby .qr-card');
    const r = card ? card.getBoundingClientRect() : null;
    const W = window.innerWidth;
    if (r && r.width > 0 && W > 0) {
      // 칼끝이 칼자루보다 조금 왼쪽(가운데 쪽)에 보이므로 칼자루는 빈 곳의 오른쪽 60% 지점에 둡니다.
      const x = r.right + (W - r.right) * 0.6;
      lobbyAim.want = clamp((x / W) * 2 - 1, 0.3, 0.86);
    }
  }
  if (lobbyAim.cur == null) lobbyAim.cur = lobbyAim.want;
  lobbyAim.cur += (lobbyAim.want - lobbyAim.cur) * 0.05;
  return lobbyAim.cur;
}
function overviewCam(now, v) {
  const xs = game.players.map((P) => P.sx);
  const cx = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  const span = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const t = now / 1000;
  if (game.phase !== 'playing') {
    // 대기실: 시연 스테이션을 비스듬히 비추는 느린 카메라.
    // 시연 칼자루가 QR 카드 오른쪽 빈 곳(lobbyAimNx)에 오도록 고개 돌림(yaw)만 맞춥니다.
    const D = game.demo;
    const sx = D ? D.sx : -6;
    const fov = 58;
    const a = Math.sin(t * 0.09) * 0.25;
    const px = sx - 1.5 + a;
    const pz = 3.5;
    const ahead = 8.9;
    const tanH = Math.tan((fov * Math.PI) / 360) * (v.w / Math.max(1, v.h));
    // 칼자루가 카메라 정면에서 오른쪽으로 벌어진 각(phi)과, 화면에서 원하는 각(want)의 차이만큼 왼쪽으로 돌립니다.
    // 검투 시연은 로봇이 빈 곳 가운데쯤, 칼자루는 그 오른쪽에 오도록 로봇을 겨눕니다.
    const duelDemo = Boolean(D && D.duel);
    const phi = duelDemo
      ? Math.atan((sx - px) / (pz - ROBOT_Z))
      : Math.atan((sx + GRIP_OFF[0] - px) / (pz - GRIP_OFF[2]));
    const want = Math.atan((duelDemo ? Math.max(0.3, lobbyAimNx(now) - 0.11) : lobbyAimNx(now)) * tanH);
    const yaw = want - phi;
    return { pos: [px, 1.75 + Math.sin(t * 0.13) * 0.12, pz], look: [px - Math.tan(yaw) * ahead, 1.85, pz - ahead], fov };
  }
  const dist = 9 + span * 0.35;
  return { pos: [cx + Math.sin(t * 0.07) * 1.5, 6.2 + span * 0.08, dist * 0.85], look: [cx, 1.2, -6], fov: clamp(52 + span * 0.6, 52, 70), aspect: v.w / v.h };
}

// 화면 밖에서 충전 중인 드론 방향 화살표
const _pp = V();
function edgeArrows(P, i, v) {
  const list = [];
  for (const dr of P.drones) {
    if (!dr.alive || dr.charge === 0) continue;
    const pr = view.project(i, dr.p);
    if (!pr || pr.inside) continue;
    // 칸 가운데에서 그 방향으로 가장자리까지
    let dx = pr.nx;
    let dy = -pr.ny;
    const m = Math.max(Math.abs(dx), Math.abs(dy)) || 1;
    dx /= m;
    dy /= m;
    const pad = 40;
    list.push({
      x: v.w / 2 + dx * (v.w / 2 - pad) - 18,
      y: v.h / 2 + dy * (v.h / 2 - pad) - 18,
      ang: Math.atan2(dy, dx),
      hot: clamp(dr.chargeT / dr.chargeDur, 0, 1)
    });
  }
  return list;
}

// ================================================================
// 매 프레임
// ================================================================
function slowTarget(P, now) {
  if (P.down || P.demo) return 1;
  let ttb = 9;
  for (const b of P.bolts) if (b.state === 'in') ttb = Math.min(ttb, (b.pathLen - b.traveled) / b.speed);
  const L = dl(P);
  if (ttb < L.slowLead && (P.slowOn || now >= P.slowReady)) {
    if (!P.slowOn) {
      P.slowOn = true;
      sfx.slow();
    }
    return L.slow;
  }
  if (P.slowOn) {
    P.slowOn = false;
    P.slowReady = now + SLOW_COOL_MS;
  }
  return 1;
}
function updatePlayer(P, now, dtR, active) {
  const c = P.clock;
  const duelOn = Boolean(P.duel);
  // 슬로우: 드론은 광탄이 몸에 닿기 직전, 검투는 로봇이 휙 벨 때와 칼끼리 부딪힌 순간(잠깐 멈춤)
  const target = duelOn ? (active || P.demo ? duel.slowTarget(P, now) : 1) : active ? slowTarget(P, now) : 1;
  const tau = target < c.scale ? 0.04 : 0.09;
  c.scale += (target - c.scale) * (1 - Math.exp(-dtR / tau));
  if (Math.abs(c.scale - target) < 0.003) c.scale = target;
  const dtG = dtR * c.scale;
  c.gt += dtG;
  // 입력: 폰 > 방향키 > 마우스 > 봇(자동)
  const i = viewIndex(P);
  const phoneLive = P.pose && !P.pose.local && now - P.pose.at < 1000;
  // 4초 넘게 마우스·키 조작이 없으면 봇은 다시 자동으로 막습니다.
  if (P.manual && now - (P.manualAt || 0) > 4000) P.manual = false;
  if (!phoneLive && P.keyUntil > now && P.keyDir) setBotDir(P, P.keyDir, dtR);
  else if (P.manual && i >= 0 && game.phase === 'playing' && mouse.cell === i) manualThink(P, i, dtR, now);
  else if (P.demo || ((P.bot || P.autoplay) && !P.manual)) {
    if (duelOn) duel.botThink(P, dtR, now);
    else botThink(P, dtR, now);
  }
  updateSaber(P, dtR, now);
  if (duelOn) {
    duel.update(P, dtG, dtR, now, active || P.demo);
    return;
  }
  if (P.respawn.length && (active || P.demo)) {
    for (let k = P.respawn.length - 1; k >= 0; k--) {
      if (c.gt >= P.respawn[k]) {
        P.respawn.splice(k, 1);
        spawnDrone(P);
      }
    }
  }
  if (active || P.demo) scheduleShots(P);
  updateDrones(P, dtG, now);
  updateBolts(P, dtG, dtR, now);
  if (P.demo && P.hp < MAX_HP) P.hp = MAX_HP;
}

let last = performance.now();
let lastSec = -1;
function tick() {
  const now = performance.now();
  const dtR = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;

  if (game.phase === 'playing') {
    // 진행 단계
    if (game.stage === 'intro') {
      const el = (now - game.introAt) / 1000;
      const n = Math.ceil(INTRO_S - el);
      if (n !== game.lastCount && n > 0 && n <= 3) {
        game.lastCount = n;
        showCount(String(n), false);
        sfx.tick();
      }
      if (el >= INTRO_S) goLive(now);
    } else if (game.stage === 'live') {
      const el = (now - game.liveAt) / 1000;
      const wave = isDuel() ? 1 : clamp(1 + Math.floor(el / WAVE_S), 1, WAVES.length);
      if (wave !== game.wave) {
        game.wave = wave;
        sfx.wave();
        for (const P of game.players) {
          if (P.down) continue;
          hudCall(P, `WAVE ${wave}`, '드론이 더 빨라져요', 'wavecall', 1600);
          const i = viewIndex(P);
          if (i >= 0) hud.wave(i);
          topUpDrones(P);
        }
        pushState(true);
      }
      if (el >= roundS()) endRound(now);
      const sec = Math.ceil(roundS() - el);
      if (sec !== lastSec) {
        lastSec = sec;
        pushState();
      }
    } else if (game.stage === 'end' && now - game.endAt > END_S * 1000) {
      showResults();
    }
    // 연결 상태
    let anyHuman = false;
    for (const P of game.players) {
      if (P.bot) {
        P.away = false;
        continue;
      }
      const info = serverInfo(P.slot);
      const away = !info || !info.connected;
      if (away && !P.away) P.awaySince = now;
      else if (!away) P.awaySince = 0;
      P.away = away;
      if (!P.away) anyHuman = true;
    }
    // 남은 사람이 폰이 끊긴 채로 오래 있으면 쓰러진 사람만 남은 판을 끝냅니다(쓰러질 때 말고도 검사).
    if (game.stage === 'live' && allOut(now)) endRound(now);
    const humans = game.players.filter((P) => !P.bot);
    if (humans.length && !anyHuman && !game.players.some((P) => P.bot)) {
      if (!game.allGoneSince) game.allGoneSince = now;
      if (now - game.allGoneSince > 20000) backToLobby('모든 폰의 연결이 끊겨 대기실로 돌아왔어요');
    } else game.allGoneSince = 0;
  }

  const active = game.phase === 'playing' && game.stage === 'live';
  if (game.phase === 'playing') {
    for (const P of game.players) {
      P.ignTarget = active && !P.down ? 1 : 0;
      updatePlayer(P, now, dtR, active && !P.down && !P.away);
    }
  }
  if (game.demo) updatePlayer(game.demo, now, dtR, false);

  // 카메라와 그리기
  const views = layoutViews();
  lastViews = views;
  const cams = views.map((v) => {
    if (v.kind === 'overview') return { ...v, ...overviewCam(now, v) };
    const P = game.players.find((x) => x.key === v.key);
    return { ...v, ...playerCam(P, v, dtR, now) };
  });
  view.update(dtR, now);
  view.render(cams, dtR);

  // HUD
  hud.layout(game.phase === 'playing' ? views : []);
  if (game.phase === 'playing') {
    const left = secondsLeft();
    const timeText = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    cams.forEach((v, i) => {
      if (v.kind === 'overview') {
        hud.overview(i, game.players.map((P) => ({
          name: P.name, color: P.color, score: P.score, hp: P.hp, down: P.down,
          rhp: P.duel ? Math.round((Math.max(0, P.duel.hp) / P.duel.max) * 100) : null
        })));
        return;
      }
      const P = game.players.find((x) => x.key === v.key);
      hud.player(i, {
        score: P.score, hp: P.hp, streak: P.streak, wave: game.wave, time: timeText, urgent: game.stage === 'live' && left <= 10, away: P.away, down: P.down,
        tag: P.duel ? `DUEL · ${DIFF_LABEL[P.level] || ''}` : null
      });
      const slowAmt = clamp((1 - P.clock.scale) / (1 - SLOW), 0, 1);
      hud.slow(i, slowAmt);
      hud.arrows(i, P.down || game.stage !== 'live' || P.duel ? [] : edgeArrows(P, i, v));
      hud.duel(i, P.duel ? duelHud(P) : null);
      // 아직 폰 자세가 안 들어오는 사람에게 안내
      if (!P.bot && !P.autoplay && !P.manual && game.stage !== 'end' && !P.down) {
        const fresh = P.pose && now - P.pose.at < 1500;
        hud.hint(i, P.away ? '연결이 끊겼어요. 폰을 다시 켜 주세요' : fresh || P.keyUntil > now ? '' : '폰을 칼자루처럼 쥐면 칼이 폰을 따라 움직여요');
      } else hud.hint(i, '');
    });
  }
  requestAnimationFrame(tick);
}

booted = true;
applyModeCopy();
startDemo();
renderLobby();
const roundEl = $('ruleRound');
if (roundEl) roundEl.textContent = String(ROUND_S);
requestAnimationFrame(tick);
// ?autostart 는 봇만 있고 폰이 없을 때만(폰이 있으면 모두 준비로만 시작)
if (AUTOSTART && BOTS > 0) setTimeout(() => { if (!serverPlayers.length) startGame(); }, 1500);

// 디버그: 콘솔에서 상태 보기·조작
//   __saber.duel.force(__saber.game.players[0], 'left')  지금 바로 왼쪽 공격
//   __saber.press(0, 'ArrowLeft')  0번 칸 선수가 방향키로 막기
window.__saber = {
  game, view, hud, duel, settings, board, startGame, endRound: () => endRound(performance.now()), showResults, backToLobby, onPose, onSwing,
  lobbyPlayers, displayRtt, constants: { ROUND_S, DUEL_S, HIT_R, SLOW, SLOW_LEAD, SWING_KILL, WAVES, DRONE_LEVEL, DUEL_LEVEL },
  press(i, code) {
    const P = cellPlayer(i) || game.players[i];
    if (!P) return false;
    if (code === 'Space') onSwing({ P, speed: 900, ago: 0, rtt: 0 }, true);
    else if (KEY_DIR[code]) {
      P.keyDir = KEY_DIR[code];
      P.keyUntil = performance.now() + 1200;
      P.manual = false;
    }
    return true;
  }
};
