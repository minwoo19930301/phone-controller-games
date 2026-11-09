// 좀비 건 아케이드 큰 화면: 최대 8명이 한 화면(1인칭, 레일 위)에서 같이 쏘는 라이트건 슈터.
// 폰을 겨누면(aim) 자기 색 조준점이 움직이고, 방아쇠(shoot)를 누르면 그 순간의 조준점에서 광선을 쏴 좀비를 맞힙니다.
// 판정은 전부 여기서 하고, 서버는 중계만 합니다. 카메라는 구역(거리 → 쇼핑몰 → 주차장)을 따라 정해진 길로 앞으로 가고,
// 멈춰 설 때마다 웨이브가 몰려옵니다. 마지막 웨이브는 보스입니다.
// 난이도(쉬움·보통·어려움)는 대기실·결과 화면에서 고르고(키보드 D, 폰의 알약 버튼), 판 중에는 잠급니다.
// 처음 하는 폰의 연습(튜토리얼) 진행은 대기실 칸으로 보여 줍니다.
import * as THREE from 'three';
import { createScene, STAGE_Z } from './scene.js';
import { KINDS, HALF_W } from './models.js';
import { sfx, audio } from './sfx.js';
import { createSettings, fields, DIFF_LABEL } from '/common/settings.js';
import { createTutorialBoard } from '/common/tutorial-board.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const num = (v, d) => (v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const BOTS = clamp(parseInt(params.get('bots'), 10) || 0, 0, 8);
const AUTOSTART = params.has('autostart');
const MOUSE = params.has('mouse'); // 센서 없는 PC 시험: 마우스가 1P(사람)를 움직임

// ---------- 규칙과 조정 값 ----------
const MAX_HP = 100;
const MAG = 12; // 탄창
const FIRE_GAP_MS = 110; // 한 사람이 이보다 빨리 쏠 수는 없음
const DMG_CORE = 55;
const PTS = { body: 10, head: 30, core: 40, headKill: 100, crate: 50 };
const COMBO_STEP = 6; // 이만큼 연속 명중할 때마다 배율 +1
const COMBO_MAX = 5;
const INTRO_S = 3.4;
const CLEAR_S = 2.0;
const END_S = 3.4;
const TRAVEL_SPEED = 6.5; // 레일 이동 속도(m/s)
const CAM_Y = 1.62;

// ---------- 난이도 ----------
// 어려움 = 예전 그대로입니다. 보통·쉬움은 좀비가 느리고 적고 약하며, 조준점이 과녁에 달라붙고(자석) 장전이 빠릅니다.
//   speed·count·hp·dmg: 좀비 속도·마릿수·체력·주는 피해 배율, bite: 무는 간격 배율(클수록 느리게 묾)
//   interval: 새로 나오는 간격 배율, maxK: 한꺼번에 나와 있는 최대 마릿수 배율
//   hitbox: 맞는 범위를 넓히는 비율
//   magnet: 조준점이 과녁 쪽으로 끌리기 시작하는 거리(화면 높이 비율), pull: 끌리는 세기(0~1)
//   snap: 빗나가도 이 거리 안에 과녁이 있으면 그 과녁을 맞힘(화면 높이 비율)
//   reload: 장전 시간(ms), revive: 부활 체력, heal: 구급상자 회복
//   bossHp·bossDmg: 보스 체력·내려치기 피해 배율, coreNeed: 공격을 끊는 데 필요한 코어 피해 배율, charge: 보스가 힘 모으는 시간(초)
//   adds: 보스전 졸개가 나오는 간격(초)
const DIFF = {
  easy: {
    speed: 0.66, count: 0.62, hp: 0.75, dmg: 0.45, bite: 1.5, interval: 1.35, maxK: 0.7, hitbox: 0.34, magnet: 0.14, pull: 0.55, snap: 0.09,
    reload: 650, revive: 80, heal: 45, bossHp: 0.6, bossDmg: 0.45, coreNeed: 0.55, charge: 2.7, adds: 12
  },
  normal: {
    speed: 0.82, count: 0.8, hp: 0.88, dmg: 0.7, bite: 1.22, interval: 1.15, maxK: 0.85, hitbox: 0.22, magnet: 0.08, pull: 0.32, snap: 0.045,
    reload: 950, revive: 65, heal: 35, bossHp: 0.8, bossDmg: 0.7, coreNeed: 0.75, charge: 2.2, adds: 10
  },
  hard: {
    speed: 1, count: 1, hp: 1, dmg: 1, bite: 1, interval: 1, maxK: 1, hitbox: 0.12, magnet: 0, pull: 0, snap: 0,
    reload: 1300, revive: 50, heal: 30, bossHp: 1, bossDmg: 1, coreNeed: 1, charge: 1.8, adds: 8
  }
};
let diff = 'normal';
let D = DIFF.normal;
const SLOT_INFO = {
  1: { name: '1P', color: '#ff5a5f' }, 2: { name: '2P', color: '#3ab4ff' }, 3: { name: '3P', color: '#ffc93c' }, 4: { name: '4P', color: '#5ee07a' },
  5: { name: '5P', color: '#c77dff' }, 6: { name: '6P', color: '#ff8fd1' }, 7: { name: '7P', color: '#3ee6d6' }, 8: { name: '8P', color: '#ff9b3d' }
};
const STAGE_NAMES = ['폐허가 된 거리', '버려진 쇼핑몰', '지하 주차장'];
// 멈춰 서는 곳(웨이브). 마릿수는 인원에 맞춰 늘고 줄어요.
const STOPS = [
  { z: -12, x: 0, stage: 0, wave: { walker: 6 } },
  { z: -30, x: -1.0, stage: 0, wave: { walker: 7, runner: 2 } },
  { z: -50, x: 1.0, stage: 0, wave: { walker: 6, runner: 3, brute: 1 }, crate: true },
  { z: -74, x: 0, stage: 0, wave: { walker: 8, runner: 3 } },
  { z: -102, x: 0, stage: 1, wave: { walker: 8, runner: 4 } },
  { z: -122, x: -1.2, stage: 1, wave: { walker: 7, runner: 4, brute: 1 }, crate: true },
  { z: -142, x: 1.2, stage: 1, wave: { walker: 10, runner: 5, brute: 2 } },
  { z: -170, x: 0, stage: 2, wave: { walker: 10, runner: 5, brute: 2 }, crate: true },
  { z: -196, x: 0, stage: 2, boss: true, wave: { walker: 4 } }
];
const START_POS = { x: 0, z: 4 };

// 글꼴을 기다린 뒤(캔버스 글자) 장면을 만듭니다.
await Promise.race([
  Promise.all([document.fonts.load('400 64px Anton'), document.fonts.load('800 64px "Pretendard Variable"')]),
  new Promise((r) => setTimeout(r, 2000))
]).catch(() => {});
const view = createScene($('cv'));
const camera = view.camera;

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

socket.on('connect', () => {
  let saved = null;
  try { saved = sessionStorage.getItem('pcg-gun-room'); } catch (e) {}
  socket.emit('join', { role: 'display', game: 'gun', room: saved });
});
socket.on('room', async (r) => {
  try { sessionStorage.setItem('pcg-gun-room', r.code); } catch (e) {}
  serverPlayers = r.players || [];
  syncRoster();
  // 서버가 다시 떠서 방이 새로 만들어졌으면 하던 판은 이어 갈 수 없으니 대기실로 돌아갑니다.
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
socket.on('aim', (d) => onAim(d, false));
socket.on('shoot', (d) => onShoot(d, false));
socket.on('reload', (d) => onReload(d));
socket.on('calibrate', (d) => onCalibrate(d));

// ---------- 난이도(공통 설정) · 연습 현황 · 준비 현황 ----------
// 값의 주인은 이 화면입니다(localStorage 'pcg-settings-gun'). 폰의 알약 버튼·키보드 D 로 바꾸고, 판 중에는 잠급니다.
const settings = createSettings({
  game: 'gun',
  fields: [fields.difficulty({ hints: { easy: '느리고 적은 좀비 · 강한 조준 자석 · 빠른 장전', normal: '조금 느린 좀비 · 약한 조준 자석', hard: '빠르고 많은 좀비 · 조준 도움 없음' } })],
  onChange: () => {
    applyDifficulty();
    renderLobby();
    pushState(true);
  }
});
settings.attach(socket);
settings.mount($('setBox'));
settings.mount($('setBoxOver'), { compact: true });
// 대기실과 결과 화면(바로 다시 하기) 양쪽에 연습 칸을 둡니다.
const boards = [createTutorialBoard({ mount: $('tutBox') }), createTutorialBoard({ mount: $('tutBoxOver') })];
for (const b of boards) b.attach(socket);
const practicing = new Map(); // slot → 연습 중인 단계 제목
socket.on('tutorial', (d) => {
  const s = Number(d && d.slot);
  if (!s) return;
  if (d.done) practicing.delete(s);
  else practicing.set(s, String(d.title || ''));
  renderLobby();
});
// 나간 사람의 연습 표시는 지웁니다.
socket.on('players', (p) => {
  const here = new Set((p && p.players ? p.players : []).map((x) => Number(x.slot)));
  for (const s of [...practicing.keys()]) if (!here.has(s)) practicing.delete(s);
});
let readyNow = new Set();
socket.on('ready_state', (st) => {
  readyNow = new Set(st && Array.isArray(st.ready) ? st.ready : []);
  renderLobby();
});
// 폰 튜토리얼의 '쏘기' 단계: 그 사람 앞 가까이에 천천히 걷는 연습 좀비를 세워 줍니다.
socket.on('msg', (d) => {
  if (d && d.type === 'gun-target') practiceTargets();
});
function applyDifficulty() {
  // 판 중에는 시작할 때 정한 값을 그대로 씁니다(설정도 잠겨 있음).
  if (game.phase === 'playing') return;
  diff = settings.difficulty();
  D = DIFF[diff] || DIFF.normal;
}

// ================================================================
// 선수(자리)
// ================================================================
const game = {
  phase: 'lobby', // lobby | playing | over
  stage: 'intro', // intro | move | fight | clear | end (playing 안에서)
  stopIdx: -1,
  stageT: 0,
  gt: 0, // 판 안의 시간(초)
  wave: null, // 지금 웨이브 { queue, nextSpawn, max, interval, bossDone }
  victory: false,
  zombies: [],
  crates: [],
  results: [],
  lastCount: 0,
  nextAdd: 0
};
const cam = { x: START_POS.x, z: START_POS.z, fromX: 0, fromZ: 0, toX: 0, toZ: 0, t: 0, dur: 1, bob: 0, shake: 0, yaw: 0 };
const roster = new Map(); // slot → P (한 번 만들면 계속 씁니다)

function newP(slot) {
  const info = SLOT_INFO[slot];
  return {
    slot, name: info.name, color: info.color, bot: false, present: false, connected: false, play: false, local: false,
    hp: MAX_HP, score: 0, kills: 0, headshots: 0, shots: 0, hits: 0, streak: 0, bestStreak: 0, down: false, downs: 0,
    ammo: MAG, reloading: false, reloadStart: 0, lastFire: 0, calibrated: false,
    aim: { x: 0.5, y: 0.5 }, shown: { x: 0.5, y: 0.5 }, hist: [], aimAt: 0,
    el: null, ui: null, card: null,
    botTarget: null, botNext: 0, botNextShot: 0, botSkill: rnd(0.55, 0.95), botWander: rnd(0, 6),
    lastSent: '', lockKey: null
  };
}
function ensureP(slot) {
  let P = roster.get(slot);
  if (!P) {
    P = newP(slot);
    roster.set(slot, P);
  }
  return P;
}
// 서버가 알려 준 자리 + 봇(?bots=N) + 마우스 시험 선수를 합칩니다.
function syncRoster() {
  const seen = new Set();
  let raceRosterChanged = false;
  for (const sp of serverPlayers) {
    const P = ensureP(sp.slot);
    const newcomer = !P.present || P.bot;
    P.present = true;
    P.bot = false;
    P.connected = Boolean(sp.connected);
    P.name = sp.name || P.name;
    P.color = sp.color || P.color;
    if (newcomer && sp.connected && game.phase === 'playing' && game.stage !== 'end') {
      if (P.ui) { P.ui.el.remove(); P.ui = null; }
      Object.assign(P, { play:true, hp:MAX_HP, score:0, kills:0, headshots:0, shots:0, hits:0,
        streak:0, bestStreak:0, down:false, downs:0, ammo:MAG, reloading:false, calibrated:false });
      raceRosterChanged = true;
    }
    seen.add(sp.slot);
  }
  let need = BOTS;
  if (MOUSE && !seen.has(1)) {
    const P = ensureP(1);
    P.present = true; P.bot = false; P.local = true; P.connected = true;
    seen.add(1);
    need = Math.max(0, need - 1);
  }
  for (let s = 1; s <= 8 && need > 0; s++) {
    if (seen.has(s)) continue;
    const P = ensureP(s);
    P.present = true; P.bot = true; P.connected = true; P.local = false;
    seen.add(s);
    need -= 1;
  }
  for (const P of roster.values()) {
    if (!seen.has(P.slot)) {
      if (P.play && game.phase === 'playing') raceRosterChanged = true;
      P.present = false;
      P.connected = false;
      P.bot = false;
      P.local = false;
      P.calibrated = false;
      P.play = false;
    }
  }
  // 대기실에서 새로 들어온 폰의 조준점을 바로 띄우고, 나간 폰의 조준점은 치웁니다.
  syncXh();
  if (raceRosterChanged) buildCards();
}
const lobbyList = () => [...roster.values()].filter((p) => p.present).sort((a, b) => a.slot - b.slot);
const players = () => [...roster.values()].filter((p) => p.play).sort((a, b) => a.slot - b.slot);
const aliveTargets = () => players().filter((p) => !p.down && p.connected);
const mult = (P) => clamp(1 + Math.floor(P.streak / COMBO_STEP), 1, COMBO_MAX);

// ================================================================
// 폰 입력
// ================================================================
function onAim(d, local) {
  if (!d) return;
  const P = roster.get(Number(d.slot));
  if (!P || !P.present || (P.bot && !local)) return;
  setAim(P, num(d.x, 0.5), num(d.y, 0.5));
}
function setAim(P, x, y) {
  const now = performance.now();
  P.aim.x = clamp(x, 0, 1);
  P.aim.y = clamp(y, 0, 1);
  P.aimAt = now;
  P.hist.push({ t: now, x: P.aim.x, y: P.aim.y });
  while (P.hist.length > 2 && P.hist[0].t < now - 1200) P.hist.shift();
}
// 그 순간(t)에 화면에 보이던 조준점 위치
function aimAt(P, t) {
  const h = P.hist;
  if (!h.length) return null;
  if (t <= h[0].t) return h[0];
  for (let i = h.length - 1; i > 0; i--) {
    if (h[i - 1].t <= t) {
      const a = h[i - 1];
      const b = h[i];
      const u = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 1;
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    }
  }
  return h[h.length - 1];
}
function onShoot(d, local) {
  if (!d) return;
  const P = roster.get(Number(d.slot));
  if (!P || !P.present || (P.bot && !local)) return;
  const now = performance.now();
  // 방아쇠를 누른 순간 = 도착 시각 − 센서 측정 시간 − 폰 왕복/2 − 화면 왕복/2. 그때 화면에 보이던 조준점을 씁니다.
  const lag = local ? 0 : clamp(num(d.ago, 0), 0, 400) + clamp(num(d.rtt, 80), 0, 800) / 2 + displayRtt() / 2;
  let pos = local ? null : aimAt(P, now - lag);
  if (!pos || now - P.aimAt > 1500) pos = { x: clamp(num(d.x, P.aim.x), 0, 1), y: clamp(num(d.y, P.aim.y), 0, 1) };
  fire(P, pos.x, pos.y, now);
}
function onReload(d) {
  const P = roster.get(Number(d && d.slot));
  if (!P || !P.present) return;
  startReload(P);
}
function onCalibrate(d) {
  const P = roster.get(Number(d && d.slot));
  if (!P) return;
  P.calibrated = true;
  P.aim.x = P.shown.x = 0.5;
  P.aim.y = P.shown.y = 0.5;
  setAim(P, 0.5, 0.5);
  if (P.ui) pulse(P, 'fire');
  renderLobby();
  pushState(true);
}

// ================================================================
// 조준점 · 선수 카드 · 글자(DOM)
// ================================================================
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
function buildXh(P) {
  const e = el('div', `xh${P.slot > 4 ? ' dash' : ''}`);
  e.style.setProperty('--c', P.color);
  // 번호표는 자리마다 링 둘레의 다른 곳에 붙어서, 8개가 겹쳐도 읽을 수 있습니다.
  const ang = ((-90 + (P.slot - 1) * 45) * Math.PI) / 180;
  const tx = Math.cos(ang) * 40;
  const ty = Math.sin(ang) * 40;
  const ticks = [[36, 3, 36, 13], [36, 59, 36, 69], [3, 36, 13, 36], [59, 36, 69, 36]]
    .map(([a, b, c, d]) => `<line class="tick-bg" x1="${a}" y1="${b}" x2="${c}" y2="${d}"/>`).join('') +
    [[36, 3, 36, 13], [36, 59, 36, 69], [3, 36, 13, 36], [59, 36, 69, 36]]
      .map(([a, b, c, d]) => `<line class="tick" x1="${a}" y1="${b}" x2="${c}" y2="${d}"/>`).join('');
  // 조준 자석이 과녁을 잡으면 네 귀퉁이 꺾쇠(lk)가 조여 들어옵니다.
  const lock = 'M8 20V8H20M52 8H64V20M64 52V64H52M20 64H8V52';
  e.innerHTML =
    `<svg viewBox="0 0 72 72"><g class="lk"><path class="lk-bg" d="${lock}"/><path class="lk-fg" d="${lock}"/></g>` +
    `<circle class="ring-bg" cx="36" cy="36" r="22"/><circle class="ring" cx="36" cy="36" r="22"/>` +
    `<circle class="rld" cx="36" cy="36" r="22" pathLength="100" stroke-dasharray="0 100"/>${ticks}<circle class="pip" cx="36" cy="36" r="2.6"/></svg>` +
    `<svg class="hm" viewBox="0 0 40 40"><path d="M6 6L15 15M34 6L25 15M6 34L15 25M34 34L25 25" fill="none"/></svg>` +
    `<div class="tag" style="left:${tx.toFixed(1)}px;top:${ty.toFixed(1)}px">${P.name}</div><div class="ammo"></div>`;
  $('xhs').appendChild(e);
  return {
    el: e, rld: e.querySelector('.rld'), ammo: e.querySelector('.ammo'), cls: new Set(), timers: {}
  };
}
function pulse(P, cls, ms = 130) {
  const u = P.ui;
  if (!u) return;
  u.el.classList.remove(cls);
  void u.el.offsetWidth;
  u.el.classList.add(cls);
  clearTimeout(u.timers[cls]);
  u.timers[cls] = setTimeout(() => u.el.classList.remove(cls), ms);
}
function syncXh() {
  const want = game.phase === 'lobby' || game.phase === 'playing';
  for (const P of roster.values()) {
    const show = want && P.present && (game.phase === 'lobby' || P.play);
    if (show && !P.ui) P.ui = buildXh(P);
    else if (!show && P.ui) {
      P.ui.el.remove();
      P.ui = null;
    }
  }
}
function updateXh(P, dt, now) {
  const u = P.ui;
  if (!u) return;
  // 보이는 조준점 = 폰이 보낸 조준 + 조준 자석(난이도). 쏠 때도 같은 계산을 써서 보이는 곳에 맞습니다.
  const a = P.down ? { x: P.aim.x, y: P.aim.y, lock: null } : assistAim(P.aim.x, P.aim.y, P);
  const k = 1 - Math.exp(-dt * 30);
  P.shown.x += (a.x - P.shown.x) * k;
  P.shown.y += (a.y - P.shown.y) * k;
  u.el.style.transform = `translate(${(P.shown.x * innerWidth).toFixed(1)}px,${(P.shown.y * innerHeight).toFixed(1)}px)`;
  const locked = Boolean(a.lock && a.w > 0.12);
  if (u.locked !== locked) {
    u.el.classList.toggle('lock', locked);
    u.locked = locked;
  }
  const reloading = P.reloading;
  u.el.classList.toggle('reloading', reloading);
  u.el.classList.toggle('empty', P.ammo <= 0 && !reloading);
  u.el.classList.toggle('down', P.down);
  if (reloading) u.rld.setAttribute('stroke-dasharray', `${clamp(((now - P.reloadStart) / D.reload) * 100, 0, 100).toFixed(1)} 100`);
  const txt = P.down ? '쓰러짐' : reloading ? '장전' : P.ammo <= 0 ? '장전!' : P.ammo <= 3 ? `${P.ammo}` : '';
  if (u.ammo.textContent !== txt) u.ammo.textContent = txt;
}

function buildCards() {
  const box = $('cards');
  box.innerHTML = '';
  for (const P of players()) {
    const c = el('div', 'card');
    c.style.setProperty('--c', P.color);
    let pips = '';
    for (let i = 0; i < MAG; i++) pips += '<i></i>';
    c.innerHTML =
      `<div class="top"><span class="nm">${P.name}${P.bot ? '<small>BOT</small>' : ''}</span><span class="sc">0</span></div>` +
      `<div class="hpbar"><i></i></div><div class="pips">${pips}</div>` +
      `<div class="meta"><span class="st"></span><b class="cb"></b></div>`;
    box.appendChild(c);
    P.card = {
      el: c, sc: c.querySelector('.sc'), hp: c.querySelector('.hpbar'), hpi: c.querySelector('.hpbar i'), pips: c.querySelector('.pips'),
      pipEls: [...c.querySelectorAll('.pips i')], st: c.querySelector('.st'), cb: c.querySelector('.cb'), last: {}
    };
  }
}
function updateCards() {
  for (const P of players()) {
    const c = P.card;
    if (!c) continue;
    const L = c.last;
    const sc = P.score.toLocaleString('ko-KR');
    if (L.sc !== sc) { c.sc.textContent = sc; L.sc = sc; }
    const hp = Math.ceil(P.hp);
    if (L.hp !== hp) {
      c.hpi.style.width = `${hp}%`;
      c.hp.classList.toggle('low', hp <= 30 && hp > 0);
      L.hp = hp;
    }
    const ammoKey = `${P.ammo}${P.reloading ? 'r' : ''}`;
    if (L.ammo !== ammoKey) {
      c.pips.classList.toggle('rld', P.reloading);
      c.pipEls.forEach((p, i) => p.classList.toggle('on', !P.reloading && i < P.ammo));
      L.ammo = ammoKey;
    }
    const down = P.down;
    if (L.down !== down) { c.el.classList.toggle('down', down); L.down = down; }
    const st = down ? '쓰러짐 · 다음 웨이브에 부활' : P.reloading ? '장전 중' : P.ammo <= 0 ? '장전!' : '';
    if (L.st !== st) { c.st.textContent = st; L.st = st; }
    const cb = mult(P) > 1 ? `x${mult(P)} 콤보` : P.streak >= 3 ? `${P.streak} 연속` : '';
    if (L.cb !== cb) { c.cb.textContent = cb; L.cb = cb; }
  }
}
function cardHurt(P) {
  if (!P.card) return;
  const e = P.card.el;
  e.classList.remove('hurt');
  void e.offsetWidth;
  e.classList.add('hurt');
}

const _v = new THREE.Vector3();
function floater(text, cls, P, world) {
  const box = $('floaters');
  if (box.childElementCount > 70) return;
  _v.copy(world).project(camera);
  if (_v.z > 1) return;
  const d = el('div', `fl ${cls || ''}`);
  d.textContent = text;
  d.style.setProperty('--c', P ? P.color : '#fff');
  d.style.left = `${((_v.x + 1) / 2) * innerWidth + rnd(-14, 14)}px`;
  d.style.top = `${((1 - _v.y) / 2) * innerHeight - 20}px`;
  box.appendChild(d);
  setTimeout(() => d.remove(), 950);
}
let bannerTimer = null;
function banner(title, sub, cls = '', ms = 1800) {
  const b = $('banner');
  b.className = `banner ${cls}`;
  b.querySelector('b').textContent = title;
  b.querySelector('span').textContent = sub || '';
  void b.offsetWidth;
  b.classList.add('on');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove('on'), ms);
}
function showCount(text, go) {
  const c = $('count');
  c.textContent = text;
  c.classList.toggle('go', Boolean(go));
  c.classList.remove('pop');
  void c.offsetWidth;
  c.classList.add('on', 'pop');
  if (go) setTimeout(() => c.classList.remove('on'), 700);
}
function hurtFlash() {
  const h = $('hurt');
  h.classList.remove('go');
  void h.offsetWidth;
  h.classList.add('go');
}
let msgTimer = null;
function lobbyMessage(t) {
  const m = $('msg');
  m.textContent = t;
  m.classList.add('on');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => m.classList.remove('on'), 3600);
}
// 자리 칸은 한 번 만들고 글자·상태만 바꿉니다(들어올 때만 튀어나오는 효과가 나도록).
const slotEls = [];
function renderLobby() {
  const box = $('slots');
  if (!box) return;
  if (!slotEls.length) {
    for (let s = 1; s <= 8; s++) {
      const d = el('div', 'slot', `<b>${SLOT_INFO[s].name}</b><small>비어 있음</small>`);
      d.style.setProperty('--c', SLOT_INFO[s].color);
      box.appendChild(d);
      slotEls.push({ d, b: d.querySelector('b'), sm: d.querySelector('small') });
    }
  }
  const list = lobbyList();
  for (let s = 1; s <= 8; s++) {
    const { d, sm } = slotEls[s - 1];
    const P = list.find((p) => p.slot === s);
    let txt = '비어 있음';
    if (P) {
      if (P.bot) txt = 'BOT';
      else if (practicing.has(s)) txt = '연습 중';
      else if (readyNow.has(s)) txt = '준비 완료';
      else if (P.calibrated) txt = '조준 완료';
      else txt = '연결됨';
    }
    d.classList.toggle('on', Boolean(P));
    d.classList.toggle('away', Boolean(P && !P.connected));
    d.classList.toggle('cal', Boolean(P && (P.calibrated || P.bot)));
    d.classList.toggle('rdy', Boolean(P && !P.bot && readyNow.has(s)));
    d.classList.toggle('prac', Boolean(P && !P.bot && practicing.has(s)));
    if (sm.textContent !== txt) sm.textContent = txt;
  }
  // 판 중 위쪽 띠의 난이도 표시(결과 화면의 표시는 끝난 판의 난이도라 showResults 에서 정합니다)
  const t = $('diffTag');
  t.textContent = DIFF_LABEL[diff] || '보통';
  t.dataset.d = diff;
}

// ================================================================
// 사격
// ================================================================
const raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _oc = new THREE.Vector3();
function raySphere(o, d, c, r) {
  _oc.subVectors(c, o);
  const tca = _oc.dot(d);
  const d2 = _oc.lengthSq() - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  const thc = Math.sqrt(r2 - d2);
  const t = tca - thc;
  if (t > 0.05) return t;
  return tca + thc > 0.05 ? tca + thc : -1;
}
function castRay(x, y) {
  _ndc.set(x * 2 - 1, -(y * 2 - 1));
  raycaster.setFromCamera(_ndc, camera);
  const o = raycaster.ray.origin;
  const d = raycaster.ray.direction;
  let best = null;
  for (const zb of game.zombies) {
    if (zb.state === 'dying' || zb.state === 'dead') continue;
    for (const sp of zb.spheres) {
      const t = raySphere(o, d, sp.p, sp.r * (1 + D.hitbox) + 0.03);
      if (t < 0) continue;
      // 머리·코어는 몸통과 겹칠 때 우선합니다.
      const eff = sp.part === 'body' ? t : t - 0.45;
      if (!best || eff < best.eff) best = { eff, t, zb, part: sp.part, crate: null };
    }
  }
  for (const cr of game.crates) {
    const t = raySphere(o, d, cr.pos, 0.55);
    if (t > 0 && (!best || t < best.eff)) best = { eff: t, t, zb: null, part: 'crate', crate: cr };
  }
  if (best) best.point = new THREE.Vector3().copy(o).addScaledVector(d, best.t);
  return best;
}

// ---------- 조준 도움(자석) ----------
// 화면 좌표(0~1) 근처에서 가장 가까운 과녁(좀비의 머리·몸·코어, 구급상자)을 찾습니다.
// 거리는 화면 높이 기준이고, 과녁이 화면에서 보이는 크기(반지름)만큼 빼서 '가장자리까지의 거리'로 잽니다.
// prefer: 바로 전에 잡고 있던 과녁. 조금 더 멀어도 놓지 않고(1.3배), 같은 거리면 그쪽을 고릅니다(두 과녁 사이에서 떨지 않게).
const _sp = new THREE.Vector3();
function nearestTarget(x, y, radius, prefer) {
  if (!(radius > 0)) return null;
  const asp = innerWidth / innerHeight;
  const k = 1 / (2 * Math.tan((camera.fov * Math.PI) / 360));
  let best = null;
  const test = (p, r, part, key) => {
    _sp.copy(p).project(camera);
    if (_sp.z > 1 || _sp.z < -1) return;
    const sx = (_sp.x + 1) / 2;
    const sy = (1 - _sp.y) / 2;
    if (sx < -0.05 || sx > 1.05 || sy < -0.05 || sy > 1.05) return;
    const pr = (r * k) / Math.max(0.5, camera.position.distanceTo(p));
    const d = Math.max(0, Math.hypot((sx - x) * asp, sy - y) - pr);
    const held = prefer != null && key === prefer;
    if (d > (held ? radius * 1.3 : radius)) return;
    // 머리·코어는 같은 거리라면 조금 더 끌리게
    const score = d - (part === 'body' ? 0 : pr * 0.3) - (held ? radius * 0.18 : 0);
    if (!best || score < best.score) best = { sx, sy, d, score, part, key };
  };
  for (const zb of game.zombies) {
    if (zb.state === 'dying' || zb.state === 'dead') continue;
    zb.spheres.forEach((s, i) => test(s.p, s.r, s.part, `${zb.id}:${i}`));
  }
  for (const cr of game.crates) test(cr.pos, 0.45, 'crate', `c:${cr.t0}`);
  return best;
}
// 조준점을 과녁 쪽으로 끌어당긴 위치. 가까울수록 세게(난이도의 pull 까지) 끌립니다. w = 이번에 끌린 정도.
// 끌린 위치 = 과녁 + (폰 조준 − 과녁) × (1 − w) 이라, 과녁 위에서는 조준점이 덜 움직여 '달라붙는' 느낌이 납니다.
function assistAim(x, y, P) {
  const t = D.magnet > 0 ? nearestTarget(x, y, D.magnet, P ? P.lockKey : null) : null;
  if (P) P.lockKey = t ? t.key : null;
  if (!t) return { x, y, lock: null, w: 0 };
  const w = D.pull * clamp((1 - t.d / D.magnet) * 1.4, 0, 1);
  return { x: x + (t.sx - x) * w, y: y + (t.sy - y) * w, lock: t, w };
}

function startReload(P) {
  if (P.reloading || P.down || P.ammo >= MAG) return;
  P.reloading = true;
  P.reloadStart = performance.now();
  if (!P.bot) sfx.reload();
  if (!P.bot) send('hit', { kind: 'reload' }, P.slot);
  pushState();
}

function canShoot() {
  if (game.phase === 'lobby') return true;
  return game.phase === 'playing' && (game.stage === 'move' || game.stage === 'fight' || game.stage === 'clear');
}
function fire(P, x, y, now) {
  if (!canShoot() || P.down) return;
  if (game.phase === 'playing' && !P.play) return;
  if (now - P.lastFire < FIRE_GAP_MS) return;
  if (P.reloading) return;
  if (P.ammo <= 0) {
    // 빈 총: 찰칵 소리를 내고 자동으로 장전을 시작합니다.
    P.lastFire = now;
    sfx.empty();
    if (!P.bot) send('hit', { kind: 'empty' }, P.slot);
    startReload(P);
    return;
  }
  P.lastFire = now;
  P.ammo -= 1;
  P.shots += 1;
  sfx.shot(P.slot);
  view.muzzleFlash(P.color, 0.8);
  pulse(P, 'fire');
  // 조준 자석으로 끌린 곳을 쏘고, 그래도 빗나갔는데 아주 가까이에 과녁이 있으면(쉬움·보통) 그 과녁을 맞힙니다.
  const a = assistAim(x, y, P);
  let hit = castRay(a.x, a.y);
  if (!hit && D.snap > 0) {
    const t = nearestTarget(a.x, a.y, D.snap);
    if (t) hit = castRay(t.sx, t.sy);
  }
  const playing = game.phase === 'playing';
  if (!hit) {
    // 빗나감: 연속 명중이 끊기고, 먼 곳에 작은 불꽃
    if (playing && P.streak > 0) P.streak = 0;
    _v.copy(raycaster.ray.direction).multiplyScalar(14).add(raycaster.ray.origin);
    view.sparks.emit(_v, 6, { color: '#ffffff', color2: P.color, speed: 2, life: 0.25, size: 0.07, hot: 2.2, gravity: 2 });
  } else if (hit.part === 'crate') {
    hitCrate(P, hit);
  } else {
    hitZombie(P, hit.zb, hit.part, hit.point);
  }
  if (P.ammo <= 0 && P.bot) startReload(P);
  pushState();
}

function hitCrate(P, hit) {
  const cr = hit.crate;
  game.crates = game.crates.filter((c) => c !== cr);
  view.remove(cr.m);
  view.sparks.emit(cr.pos, 40, { color: '#7dffb0', color2: '#ffffff', speed: 4, life: 0.8, size: 0.08, hot: 2.4, gravity: 3 });
  sfx.medkit();
  P.hits += 1;
  if (game.phase !== 'playing') return;
  const heal = D.heal;
  P.hp = Math.min(MAX_HP, P.hp + heal);
  P.score += PTS.crate;
  floater(`HP +${heal}`, 'kill', P, cr.pos);
  if (!P.bot) send('hit', { kind: 'medkit' }, P.slot);
}

function bloodAt(point, P, n, power = 1) {
  view.blood.emit(point, n, { color: '#7a0c14', color2: P.color, speed: 3.2 * power, life: 0.8, size: 0.075, gravity: 8 });
  view.sparks.emit(point, Math.ceil(n * 0.4), { color: '#ffffff', color2: P.color, speed: 2.6, life: 0.22, size: 0.06, hot: 2.6, gravity: 1 });
}

function hitZombie(P, zb, part, point) {
  const playing = game.phase === 'playing';
  const cfg = zb.cfg;
  const dmg = part === 'head' ? cfg.head : part === 'core' ? DMG_CORE : cfg.body;
  zb.hp -= dmg;
  zb.flinch = Math.min(1, zb.flinch + (zb.kind === 'boss' ? 0.1 : zb.kind === 'brute' ? 0.4 : 1));
  zb.flashT = 0.12;
  zb.flashColor = P.color;
  zb.lastHitBy = P.slot;
  zb.dmgBy[P.slot] = (zb.dmgBy[P.slot] || 0) + dmg;
  if (zb.kind === 'boss' && part === 'core') zb.coreDmg += dmg;
  if (zb.state === 'walk' && zb.kind !== 'boss') zb.stagger = Math.max(zb.stagger, part === 'head' ? 0.45 : 0.22);
  bloodAt(point, P, part === 'head' ? 18 : 10, part === 'head' ? 1.3 : 1);
  view.splat(point, P.color, rnd(0.5, 0.9) * (zb.kind === 'boss' ? 1.8 : 1), false);
  if (part === 'head') sfx.head();
  else sfx.hit();
  pulse(P, part === 'head' || part === 'core' ? 'head' : 'hit', 420);
  P.hits += 1;
  const killed = zb.hp <= 0;
  if (playing) {
    P.streak += 1;
    P.bestStreak = Math.max(P.bestStreak, P.streak);
    const m = mult(P);
    const base = part === 'head' ? PTS.head : part === 'core' ? PTS.core : PTS.body;
    let pts = base * m;
    if (part === 'head') P.headshots += 1;
    if (killed) {
      pts += cfg.pts * m + (part === 'head' ? PTS.headKill * m : 0);
      P.kills += 1;
    }
    P.score += pts;
    floater(part === 'head' ? `HEAD +${pts}` : part === 'core' ? `CORE +${pts}` : `+${pts}`, killed ? 'kill' : part === 'body' ? '' : 'head', P, point);
    if (!P.bot) send('hit', { kind: killed ? 'kill' : part === 'head' || part === 'core' ? 'head' : 'hit', combo: m }, P.slot);
  } else if (!P.bot) {
    // 대기실 연습: 맞힌 폰도 진동하고, 처음 하는 사람의 튜토리얼 '쏘기' 단계가 이걸로 넘어갑니다.
    send('hit', { kind: killed ? 'kill' : part === 'head' || part === 'core' ? 'head' : 'hit', practice: true }, P.slot);
  }
  if (killed) killZombie(zb, P, part, point);
}

// ================================================================
// 좀비
// ================================================================
const _w = new THREE.Vector3();
let zid = 0;
function spawnZombie(kind, o = {}) {
  const model = view.makeZombie(kind);
  const cfg = KINDS[kind];
  const stageI = stageIndexAt(cam.z);
  const half = HALF_W[stageI];
  const n = Math.max(1, players().length || BOTS || 1);
  const x = o.x ?? clamp(cam.x + rnd(-half, half), -half, half);
  const z = o.z ?? cam.z - rnd(16, 26);
  const hpScale = Math.round((kind === 'boss' ? (700 + 220 * n) * D.bossHp : cfg.hp * D.hp));
  const waveBoost = (1 + 0.03 * Math.max(0, game.stopIdx)) * D.speed;
  const zb = {
    id: ++zid, kind, cfg, model, state: 'walk', hp: hpScale, maxHp: hpScale,
    speed: rnd(cfg.speed[0], cfg.speed[1]) * (kind === 'boss' ? D.speed : waveBoost), stop: 0, offX: o.offX ?? rnd(-2.2, 2.2),
    atkT: 0, biteDone: false, stagger: 0, flinch: 0, flashT: 0, flashColor: '#fff', dyingT: 0, deadT: 0,
    wob: rnd(0, 6), lastHitBy: 0, dmgBy: {}, spheres: [], practice: Boolean(o.practice),
    // 보스: 약점 공격 준비
    charge: 0, chargeT: 0, cool: 3, coreDmg: 0, stunned: 0, nextGroan: rnd(1, 6)
  };
  zb.stop = kind === 'boss' ? 11 : kind === 'brute' ? 2.6 + rnd(0, 1) : 1.7 + rnd(0, 1.5);
  if (zb.practice) {
    zb.stop = o.stop ?? 9 + rnd(0, 6);
    zb.speed = o.speed ?? rnd(0.45, 0.8);
  }
  model.root.position.set(x, 0, z);
  const r = model.radii;
  const sp = (part, anchor, rad) => ({ part, anchor, r: rad, p: new THREE.Vector3() });
  zb.spheres.push(sp('head', model.anchors.head, r.head), sp('body', model.anchors.chest, r.chest), sp('body', model.anchors.hip, r.hip));
  if (model.anchors.core) zb.spheres.push(sp('core', model.anchors.core, 0.16 * model.scale));
  model.root.updateMatrixWorld(true);
  for (const s of zb.spheres) s.anchor.getWorldPosition(s.p);
  view.add(model.root);
  game.zombies.push(zb);
  if (!zb.practice) sfx.groan(kind === 'boss' ? 0.55 : kind === 'brute' ? 0.7 : rnd(0.85, 1.25), kind === 'boss' ? 0.2 : 0.05);
  return zb;
}
function removeZombie(zb) {
  view.remove(zb.model.root);
  game.zombies = game.zombies.filter((z) => z !== zb);
}
const hostile = (zb) => !zb.practice && (zb.state === 'walk' || zb.state === 'attack');

function killZombie(zb, P, part, point) {
  zb.state = 'dying';
  zb.dyingT = 0;
  const big = zb.kind === 'brute' || zb.kind === 'boss';
  sfx.die(big);
  if (part === 'head' && zb.kind !== 'boss') {
    zb.model.hideHead();
    bloodAt(zb.spheres[0].p, P, 30, 1.6);
  }
  bloodAt(point, P, big ? 40 : 14, big ? 1.6 : 1);
  _w.set(zb.model.root.position.x, 0, zb.model.root.position.z);
  view.splat(_w, P.color, big ? 3.2 : 1.6, true, 9);
  if (zb.kind === 'boss') bossDown(zb, P);
}

function bite(zb) {
  const targets = aliveTargets();
  if (!targets.length) return;
  const P = pick(targets);
  const dmg = Math.max(1, Math.round(zb.cfg.dmg * D.dmg));
  damagePlayer(P, dmg);
  sfx.bite();
}
function damagePlayer(P, dmg) {
  if (P.down || game.phase !== 'playing') return;
  P.hp = Math.max(0, P.hp - dmg);
  P.streak = 0;
  cam.shake = Math.min(1, cam.shake + 0.5);
  hurtFlash();
  sfx.hurt();
  cardHurt(P);
  if (!P.bot) send('hit', { kind: 'hurt' }, P.slot);
  const _p = _w.set(P.shown.x * 2 - 1, -(P.shown.y * 2 - 1), 0.9).unproject(camera);
  floater(`${P.name} -${dmg}`, 'kill', P, _p);
  if (P.hp <= 0) {
    P.down = true;
    P.downs += 1;
    P.reloading = false;
    banner(`${P.name} 쓰러짐`, '다음 웨이브가 끝나면 부활해요', 'bad', 1500);
  }
  pushState(true);
}

function stageIndexAt(z) {
  if (z > STAGE_Z[1]) return 0;
  if (z > STAGE_Z[2]) return 1;
  return 2;
}

function updateZombie(zb, dt, gdt) {
  const m = zb.model;
  const root = m.root;
  const pos = root.position;
  zb.flashT = Math.max(0, zb.flashT - dt);
  m.flash(zb.flashColor, zb.flashT > 0 ? 1.4 * (zb.flashT / 0.12) : 0);
  zb.flinch = Math.max(0, zb.flinch - dt * 4);
  if (zb.state === 'dying' || zb.state === 'dead') {
    zb.dyingT += dt;
    const u = clamp(zb.dyingT / (zb.kind === 'boss' ? 1.4 : 0.55), 0, 1);
    const e = 1 - (1 - u) * (1 - u);
    m.body.rotation.x = -e * (Math.PI / 2) * 0.96;
    m.body.position.y = -e * 0.12 * m.scale;
    pos.z -= dt * (1 - u) * 0.6; // 맞은 방향으로 밀려남
    m.animate(dt, { speed: 0, atk: -1, flinch: 0, dead: zb.dyingT });
    if (zb.dyingT > 0.7) zb.state = 'dead';
    if (zb.state === 'dead') {
      zb.deadT += dt;
      if (zb.deadT > 1.6) pos.y -= dt * 0.55;
      if (zb.deadT > 3.2) {
        removeZombie(zb);
        return;
      }
    }
    syncSpheres(zb);
    return;
  }
  const tx = cam.x + zb.offX;
  const tz = cam.z - zb.stop;
  let dx = tx - pos.x;
  let dz = tz - pos.z;
  const dist = Math.hypot(dx, dz);
  let moving = false;
  zb.stagger = Math.max(0, zb.stagger - dt);
  zb.stunned = Math.max(0, zb.stunned - dt);
  if (zb.state === 'walk') {
    if (dist < 0.2 || pos.z >= tz - 0.05) {
      zb.state = zb.practice ? 'walk' : 'attack';
      zb.atkT = zb.kind === 'boss' ? 0 : rnd(0, 0.4);
      zb.biteDone = false;
    } else if (zb.stagger <= 0 && zb.stunned <= 0) {
      const sp = zb.speed * (zb.kind === 'boss' ? 1 : 1);
      dx /= dist;
      dz /= dist;
      pos.x += dx * sp * dt + Math.sin(game.gt * 0.9 + zb.wob) * 0.25 * dt;
      pos.z += dz * sp * dt;
      moving = true;
    }
  } else if (zb.state === 'attack') {
    // 카메라가 멀어졌으면 다시 따라 걷습니다.
    if (pos.z < tz - 1.2) zb.state = 'walk';
    else if (zb.kind === 'boss') bossAttack(zb, dt);
    else if (zb.stagger <= 0) {
      zb.atkT += dt / (zb.cfg.bite * D.bite);
      if (zb.atkT >= 0.55 && !zb.biteDone) {
        zb.biteDone = true;
        bite(zb);
      }
      if (zb.atkT >= 1) {
        zb.atkT = 0;
        zb.biteDone = false;
      }
    }
  }
  // 겹침 풀기(서로 밀어냄)
  for (const o of game.zombies) {
    if (o === zb || o.state === 'dying' || o.state === 'dead') continue;
    const ox = pos.x - o.model.root.position.x;
    const oz = pos.z - o.model.root.position.z;
    const rr = (zb.cfg.radius + o.cfg.radius) * 0.36;
    const d2 = ox * ox + oz * oz;
    if (d2 < rr * rr && d2 > 1e-5) {
      const d = Math.sqrt(d2);
      const push = ((rr - d) / d) * 0.5 * Math.min(1, dt * 8);
      pos.x += ox * push;
      pos.z += oz * push;
    }
  }
  const half = HALF_W[stageIndexAt(pos.z)];
  pos.x = clamp(pos.x, -half - 0.6, half + 0.6);
  root.rotation.y = Math.atan2(cam.x - pos.x, Math.max(0.5, cam.z - pos.z)) * 0.8;
  const spd = moving ? clamp(zb.speed / 3.6, 0.1, 1) : 0.05;
  m.animate(dt, {
    speed: spd, atk: zb.state === 'attack' && zb.kind !== 'boss' && zb.stagger <= 0 ? zb.atkT : -1, flinch: zb.flinch, dead: 0,
    charge: zb.charge
  });
  zb.nextGroan -= dt;
  if (zb.nextGroan <= 0) {
    zb.nextGroan = rnd(5, 11);
    if (!zb.practice && game.phase === 'playing' && Math.random() < 0.45) sfx.groan(zb.kind === 'brute' ? 0.7 : rnd(0.8, 1.3), 0.03);
  }
  syncSpheres(zb);
}
function syncSpheres(zb) {
  zb.model.root.updateMatrixWorld(true);
  for (const s of zb.spheres) s.anchor.getWorldPosition(s.p);
}

// ---------- 보스 ----------
function bossAttack(zb, dt) {
  if (zb.stunned > 0) {
    zb.charge = 0;
    return;
  }
  if (zb.chargeT <= 0) {
    zb.cool -= dt;
    zb.charge = Math.max(0, zb.charge - dt * 2);
    if (zb.cool <= 0) {
      zb.chargeT = D.charge;
      zb.coreDmg = 0;
      sfx.alarm();
      banner('코어를 쏴요!', '가슴의 주황빛 약점에 집중 사격', 'warn', 1600);
      send('cue', { text: '보스가 힘을 모아요! 가슴의 코어를 쏴요!' });
    }
    return;
  }
  zb.chargeT -= dt;
  zb.charge = clamp(1 - zb.chargeT / D.charge, 0, 1);
  const need = Math.round((120 + 20 * Math.max(1, players().length)) * D.coreNeed);
  if (zb.coreDmg >= need) {
    zb.chargeT = 0;
    zb.charge = 0;
    zb.cool = 2.5;
    zb.stunned = 2.4;
    zb.flinch = 1;
    banner('저지!', '보스의 공격을 끊었어요', 'good', 1100);
    sfx.boom();
    return;
  }
  if (zb.chargeT <= 0) {
    // 내려치기: 살아 있는 모두가 맞음
    zb.chargeT = 0;
    zb.charge = 0;
    zb.cool = 4.2;
    sfx.boom();
    cam.shake = 1;
    for (const P of aliveTargets()) damagePlayer(P, Math.max(1, Math.round(zb.cfg.dmg * D.bossDmg)));
  }
}
function bossDown(zb, P) {
  // 기여한 만큼 보너스를 나눕니다.
  const total = Object.values(zb.dmgBy).reduce((a, b) => a + b, 0) || 1;
  for (const [slot, dmg] of Object.entries(zb.dmgBy)) {
    const Q = roster.get(Number(slot));
    if (Q) Q.score += Math.round(3000 * (dmg / total));
  }
  // 남은 좀비도 함께 쓰러뜨립니다.
  for (const o of game.zombies) {
    if (o !== zb && hostile(o)) {
      o.hp = 0;
      o.state = 'dying';
      o.dyingT = 0;
      bloodAt(o.spheres[1].p, P, 12);
    }
  }
  game.wave.queue.length = 0;
  sfx.boom();
}

// ================================================================
// 웨이브 · 레일
// ================================================================
function scaleFor() {
  const n = clamp(players().length, 1, 8);
  return { n, k: 0.6 + 0.16 * n, max: clamp(5 + n * 2, 6, 22), interval: clamp(1.15 - 0.08 * n, 0.45, 1.15) };
}
function startWave(i) {
  const st = STOPS[i];
  const { k, max, interval } = scaleFor();
  const queue = [];
  for (const [kind, c] of Object.entries(st.wave)) {
    const cnt = st.boss ? c : Math.max(1, Math.round(c * k * D.count));
    for (let j = 0; j < cnt; j++) queue.push(kind);
  }
  // 섞되 덩치는 중간 이후에 나오게
  queue.sort(() => Math.random() - 0.5);
  queue.sort((a, b) => (a === 'brute') - (b === 'brute'));
  if (st.boss) queue.unshift('boss');
  game.wave = { queue, nextSpawn: game.gt + 0.4, max: Math.max(4, Math.round(max * D.maxK)), interval: interval * D.interval, total: queue.length };
  game.stage = 'fight';
  game.stageT = 0;
  game.nextAdd = game.gt + 9;
  if (st.crate) {
    const m = view.makeMedkit();
    const pos = new THREE.Vector3(cam.x + rnd(-1.6, 1.6), 1.35, cam.z - rnd(8, 11));
    m.position.copy(pos);
    view.add(m);
    game.crates.push({ m, pos, t0: game.gt });
  }
  sfx.wave();
  banner(st.boss ? '보스 출현' : `WAVE ${i + 1}`, st.boss ? '거대 변이체가 다가와요' : '좀비가 몰려와요', st.boss ? 'bad' : 'warn', 1500);
  send('cue', { text: st.boss ? '보스 출현!' : `웨이브 ${i + 1} 시작` });
  pushState(true);
}
function beginMove(toIdx) {
  const st = STOPS[toIdx];
  cam.fromX = cam.x;
  cam.fromZ = cam.z;
  cam.toX = st.x;
  cam.toZ = st.z;
  cam.t = 0;
  cam.dur = Math.max(1.8, Math.abs(cam.fromZ - cam.toZ) / TRAVEL_SPEED);
  game.stopIdx = toIdx;
  game.stage = 'move';
  game.stageT = 0;
  const prev = toIdx > 0 ? STOPS[toIdx - 1].stage : -1;
  if (st.stage !== prev) {
    banner(`STAGE ${st.stage + 1}`, STAGE_NAMES[st.stage], '', 2600);
    sfx.alarm();
  }
  pushState(true);
}
function waveClear() {
  game.stage = 'clear';
  game.stageT = 0;
  for (const c of game.crates) view.remove(c.m);
  game.crates = [];
  const revived = [];
  for (const P of players()) {
    if (P.down) {
      P.down = false;
      P.hp = D.revive;
      revived.push(P.name);
    } else if (P.connected) {
      P.hp = Math.min(MAX_HP, P.hp + 10);
      P.score += 200;
    }
  }
  sfx.clear();
  const last = game.stopIdx >= STOPS.length - 1;
  if (last) {
    victory();
    return;
  }
  banner('CLEAR', revived.length ? `${revived.join(' ')} 부활!` : '+200 보너스 · 체력 조금 회복', 'good', 1700);
  send('cue', { text: '웨이브 클리어' });
  pushState(true);
}
function victory() {
  game.victory = true;
  game.stage = 'end';
  game.stageT = 0;
  for (const P of players()) if (!P.down) P.score += Math.round(P.hp * 5);
  banner('작전 성공!', '살아남은 체력만큼 보너스', 'good', 3000);
  sfx.win();
  pushState(true);
}
function defeat() {
  game.victory = false;
  game.stage = 'end';
  game.stageT = 0;
  for (const zb of game.zombies) if (hostile(zb)) zb.stunned = 99;
  banner('전멸...', '좀비에게 둘러싸였어요', 'bad', 3000);
  sfx.lose();
  pushState(true);
}

function updateWave(dt) {
  const w = game.wave;
  if (!w) return;
  const alive = game.zombies.filter(hostile);
  const st = STOPS[game.stopIdx];
  if (w.queue.length && game.gt >= w.nextSpawn && alive.length < w.max) {
    const kind = w.queue.shift();
    spawnZombie(kind, kind === 'boss' ? { x: cam.x * 0.5, z: cam.z - 30 } : {});
    w.nextSpawn = game.gt + w.interval * rnd(0.6, 1.3);
  }
  // 보스전: 졸개가 계속 나옴
  if (st.boss && game.gt >= game.nextAdd && alive.length < 9 && alive.some((z) => z.kind === 'boss')) {
    game.nextAdd = game.gt + D.adds;
    for (let i = 0; i < 2; i++) spawnZombie(i ? 'runner' : 'walker');
  }
  if (!w.queue.length && !alive.length && game.stageT > 1) waveClear();
  if (!aliveTargets().length && players().length && game.stage === 'fight') defeat();
}

// ================================================================
// 봇(시험용 ?bots=N, 대기실 시연): 사람과 같은 길(setAim / fire)로 쏩니다.
// ================================================================
function botThink(P, dt, now) {
  if (P.down) return;
  const list = game.zombies.filter((z) => z.state === 'walk' || z.state === 'attack');
  if (now > P.botNext || (P.botTarget && !list.includes(P.botTarget))) {
    P.botNext = now + rnd(350, 900);
    const sorted = list.map((z) => ({ z, d: Math.abs(z.model.root.position.z - cam.z) + Math.random() * 6 })).sort((a, b) => a.d - b.d);
    P.botTarget = sorted.length ? sorted[Math.floor(Math.random() * Math.min(3, sorted.length))].z : null;
    P.botPart = P.botTarget && P.botTarget.kind === 'boss' && Math.random() < 0.7 ? 3 : Math.random() < 0.55 ? 0 : 1;
  }
  let tx = 0.5 + Math.sin(now * 0.0009 + P.botWander) * 0.3;
  let ty = 0.5 + Math.cos(now * 0.0012 + P.botWander * 2) * 0.12;
  const T = P.botTarget;
  if (T) {
    const sp = T.spheres[Math.min(P.botPart, T.spheres.length - 1)] || T.spheres[0];
    _v.copy(sp.p).project(camera);
    if (_v.z < 1) {
      tx = (_v.x + 1) / 2;
      ty = (1 - _v.y) / 2;
    }
  }
  const k = 1 - Math.exp(-dt * (4 + P.botSkill * 5));
  const nx = P.aim.x + (tx - P.aim.x) * k + (Math.random() - 0.5) * 0.004;
  const ny = P.aim.y + (ty - P.aim.y) * k + (Math.random() - 0.5) * 0.004;
  setAim(P, nx, ny);
  const err = Math.hypot((tx - P.aim.x) * (innerWidth / innerHeight), ty - P.aim.y);
  if (T && !P.reloading && err < 0.05 && now > P.botNextShot) {
    P.botNextShot = now + rnd(260, 620) / (0.5 + P.botSkill);
    fire(P, P.aim.x + (Math.random() - 0.5) * (1 - P.botSkill) * 0.05, P.aim.y + (Math.random() - 0.5) * (1 - P.botSkill) * 0.05, now);
  }
  if (!T && P.ammo < MAG - 2 && !P.reloading) startReload(P);
}

// ================================================================
// 마우스·키보드 시험
// ================================================================
let mouseP = null;
function localP() {
  return [...roster.values()].find((p) => p.local) || null;
}
window.addEventListener('mousemove', (e) => {
  const P = localP();
  if (P) setAim(P, e.clientX / innerWidth, e.clientY / innerHeight);
});
window.addEventListener('mousedown', (e) => {
  audio();
  const P = localP();
  if (P && e.button === 0) fire(P, P.aim.x, P.aim.y, performance.now());
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (game.phase !== 'playing') startGame();
    return;
  }
  const P = localP();
  if (e.code === 'KeyR' && P) startReload(P);
  if (e.code === 'Space' && P) {
    e.preventDefault();
    if (!e.repeat) fire(P, P.aim.x, P.aim.y, performance.now());
  }
});

// ================================================================
// 판 시작·진행·끝
// ================================================================
function resetCamera() {
  cam.x = START_POS.x;
  cam.z = START_POS.z;
  cam.shake = 0;
}
function clearField() {
  for (const zb of [...game.zombies]) removeZombie(zb);
  for (const c of game.crates) view.remove(c.m);
  game.crates = [];
  game.wave = null;
}
// ---------- 대기실 연습 사격장 ----------
// 대기실 가운데 빈 곳(#range)이 화면 가로에서 차지하는 범위(0~1). 대기실이 접혀 있거나 안 보이면 화면 가운데.
function rangeBand() {
  const r = $('range');
  if (r && !$('lobby').classList.contains('hidden')) {
    const b = r.getBoundingClientRect();
    if (b.width > 120) return { a: b.left / innerWidth, b: b.right / innerWidth };
  }
  return { a: 0.3, b: 0.7 };
}
// 화면 가로 위치 sx(0~1)에 보이는, 카메라에서 dist(m) 앞의 x 좌표(대기실 카메라는 거의 정면을 봅니다)
function worldXAt(sx, dist) {
  const half = Math.tan((camera.fov * Math.PI) / 360) * camera.aspect;
  return cam.x + (sx * 2 - 1) * half * dist;
}
// 연습 좀비 하나: 사격장 안의 먼 곳에서 나와(fromD) 사격장 안의 가까운 곳(stop)까지 걸어와 섭니다.
function spawnRangeZombie(kind, o = {}) {
  const { a, b } = rangeBand();
  const m = Math.min(0.06, (b - a) * 0.2); // 가장자리는 좀비 몸 폭만큼 비움
  const at = (u) => a + m + (b - a - 2 * m) * clamp(u, 0, 1);
  const u = o.u ?? Math.random();
  const fromD = o.fromD ?? rnd(20, 28);
  const stop = o.stop ?? rnd(9, 15);
  return spawnZombie(kind, {
    practice: true, x: worldXAt(at(u + rnd(-0.15, 0.15)), fromD), z: cam.z - fromD, stop, speed: o.speed,
    offX: worldXAt(at(u), stop) - cam.x
  });
}
function startPractice() {
  clearField();
  for (let i = 0; i < 4; i++) spawnRangeZombie(i % 2 ? 'walker' : 'runner', { u: (i + 0.5) / 4, fromD: rnd(14, 20) });
}
// 튜토리얼 '쏘기' 단계용: 사격장 가운데 가까이에 아주 천천히 걷다 멈춰 서는 연습 좀비를 둘까지 채웁니다.
function practiceTargets() {
  if (game.phase !== 'lobby') return;
  const near = game.zombies.filter((z) => z.practice && z.state === 'walk' && cam.z - z.model.root.position.z < 14).length;
  for (let i = near; i < 2; i++) spawnRangeZombie('walker', { u: i % 2 ? rnd(0.58, 0.8) : rnd(0.2, 0.42), fromD: rnd(10.5, 12), stop: rnd(7.5, 8.6), speed: 0.4 });
}
function startGame() {
  if (game.phase === 'playing') return;
  const list = lobbyList().filter((p) => p.connected);
  if (!list.length) {
    lobbyMessage('폰을 먼저 연결해 주세요. QR을 찍고 준비를 누르면 자리가 생겨요.');
    return;
  }
  audio();
  // 난이도는 시작할 때 정한 값으로 판 끝까지 갑니다.
  applyDifficulty();
  settings.lock(true);
  for (const b of boards) b.hide(true);
  clearField();
  for (const P of roster.values()) {
    P.play = list.includes(P);
    P.hp = MAX_HP;
    P.score = 0;
    P.kills = 0;
    P.headshots = 0;
    P.shots = 0;
    P.hits = 0;
    P.streak = 0;
    P.bestStreak = 0;
    P.down = false;
    P.downs = 0;
    P.ammo = MAG;
    P.reloading = false;
    P.botTarget = null;
  }
  resetCamera();
  game.phase = 'playing';
  game.stage = 'intro';
  game.stopIdx = -1;
  game.stageT = 0;
  game.gt = 0;
  game.lastCount = 0;
  game.victory = false;
  game.results = [];
  $('lobby').classList.add('hidden');
  $('over').classList.add('hidden');
  $('join').classList.remove('hidden');
  $('topbar').classList.remove('hidden');
  $('msg').classList.remove('on');
  buildCards();
  syncXh();
  pushState(true);
}

function showResults() {
  game.phase = 'over';
  const rows = players().sort((a, b) => b.score - a.score || b.kills - a.kills);
  game.results = rows.map((P, k) => ({ slot: P.slot, rank: k + 1, score: P.score, kills: P.kills, headshots: P.headshots, hp: P.hp }));
  const box = $('podium');
  box.innerHTML = '';
  $('overEyebrow').textContent = game.victory ? 'MISSION COMPLETE' : 'MISSION FAILED';
  $('diffOver').textContent = DIFF_LABEL[diff] || '보통';
  $('diffOver').dataset.d = diff;
  $('overTitle').textContent = game.victory ? '작전 성공' : '작전 실패';
  rows.forEach((P, k) => {
    const acc = P.shots ? Math.round((P.hits / P.shots) * 100) : 0;
    const e = el('div', `r${P.down ? ' ko' : ''}`);
    e.style.setProperty('--c', P.color);
    e.style.animationDelay = `${0.1 + k * 0.08}s`;
    e.innerHTML = `<span class="rank">${k + 1}</span><span class="who">${P.name}${P.bot ? '<small>BOT</small>' : ''}</span>` +
      `<span class="num"><b>${P.kills}</b><span>처치</span></span>` +
      `<span class="num"><b>${P.headshots}</b><span>헤드샷</span></span>` +
      `<span class="num"><b>${acc}%</b><span>명중률</span></span>` +
      `<span class="num"><b>${P.bestStreak}</b><span>최고 연속</span></span>` +
      `<span class="num big"><b>${P.score.toLocaleString('ko-KR')}</b><span>점수</span></span>`;
    box.appendChild(e);
    if (!P.bot) {
      send('result', {
        text: `${k + 1}위 · ${P.score.toLocaleString('ko-KR')}점`, rank: k + 1, of: rows.length, score: P.score, kills: P.kills,
        headshots: P.headshots, accuracy: acc, win: game.victory
      }, P.slot);
    }
  });
  clearField();
  settings.lock(false);
  for (const b of boards) b.hide(false);
  renderLobby();
  $('over').classList.remove('hidden');
  $('join').classList.add('hidden');
  $('topbar').classList.add('hidden');
  $('cards').innerHTML = '';
  $('count').classList.remove('on');
  syncXh();
  pushState(true);
}
function backToLobby(why) {
  for (const P of roster.values()) P.play = false;
  game.phase = 'lobby';
  game.stage = 'intro';
  settings.lock(false);
  for (const b of boards) b.hide(false);
  applyDifficulty();
  clearField();
  resetCamera();
  $('over').classList.add('hidden');
  $('join').classList.add('hidden');
  $('topbar').classList.add('hidden');
  $('cards').innerHTML = '';
  $('count').classList.remove('on');
  $('lobby').classList.remove('hidden');
  startPractice();
  syncXh();
  renderLobby();
  if (why) lobbyMessage(why);
  pushState(true);
}

// ---------- 폰으로 보내는 상태 ----------
let pushTimer = null;
let lastPush = 0;
function statePlayers() {
  const out = {};
  const list = game.phase === 'playing' ? players() : lobbyList().filter((p) => p.connected);
  for (const P of list) {
    out[P.slot] = {
      hp: Math.ceil(P.hp), score: P.score, ammo: P.ammo, mag: MAG, reloading: P.reloading, down: P.down, streak: P.streak, mult: mult(P),
      kills: P.kills, calibrated: P.calibrated
    };
  }
  return out;
}
function buildState() {
  const st = STOPS[Math.max(0, game.stopIdx)];
  return {
    phase: game.phase,
    stage: game.phase === 'playing' ? game.stage : null,
    stageName: STAGE_NAMES[st ? st.stage : 0],
    wave: Math.max(0, game.stopIdx) + 1,
    waves: STOPS.length,
    foes: game.zombies.filter(hostile).length + (game.wave ? game.wave.queue.length : 0),
    victory: game.victory,
    difficulty: diff,
    reloadMs: D.reload, // 폰의 탄창 차오르는 모습에 씀
    players: statePlayers(),
    // 판 중에는 자주 보내므로 항목 정의(fields)는 빼고 값만 보냅니다(폰이 마지막 정의를 기억).
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

// ================================================================
// 한 프레임
// ================================================================
let last = performance.now();
let hudT = 0;
const _look = new THREE.Vector3();
function tick() {
  requestAnimationFrame(tick);
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.gt += dt;
  game.stageT += dt;

  // ----- 판 진행 -----
  if (game.phase === 'playing') {
    if (game.stage === 'intro') {
      const left = INTRO_S - game.stageT;
      const n = Math.ceil(left - 0.4);
      if (n !== game.lastCount && n >= 1 && n <= 3) {
        game.lastCount = n;
        showCount(String(n));
        sfx.count();
      }
      if (game.stageT >= INTRO_S) {
        showCount('GO!', true);
        sfx.go();
        beginMove(0);
      }
    } else if (game.stage === 'move') {
      cam.t += dt;
      const u = clamp(cam.t / cam.dur, 0, 1);
      const e = u * u * (3 - 2 * u);
      cam.x = cam.fromX + (cam.toX - cam.fromX) * e;
      cam.z = cam.fromZ + (cam.toZ - cam.fromZ) * e;
      if (u >= 1) startWave(game.stopIdx);
    } else if (game.stage === 'fight') {
      updateWave(dt);
    } else if (game.stage === 'clear') {
      if (game.stageT >= CLEAR_S) beginMove(game.stopIdx + 1);
    } else if (game.stage === 'end') {
      if (game.stageT >= END_S) showResults();
    }
  } else {
    // 대기실·결과: 연습 좀비를 채워 둡니다.
    if (game.phase === 'lobby') {
      const alive = game.zombies.filter((z) => z.practice && z.state === 'walk').length;
      if (alive < 3 && Math.random() < dt * 0.8) spawnRangeZombie(Math.random() < 0.4 ? 'runner' : 'walker');
    }
  }

  // ----- 카메라 -----
  const moving = game.phase === 'playing' && game.stage === 'move';
  cam.bob += dt * (moving ? 8 : 1.4);
  cam.shake = Math.max(0, cam.shake - dt * 2.2);
  const bobY = moving ? Math.sin(cam.bob) * 0.04 : Math.sin(cam.bob) * 0.008;
  const bobX = moving ? Math.cos(cam.bob * 0.5) * 0.03 : 0;
  const sh = cam.shake * cam.shake;
  camera.position.set(cam.x + bobX + (Math.random() - 0.5) * sh * 0.25, CAM_Y + bobY + (Math.random() - 0.5) * sh * 0.25, cam.z);
  _look.set(cam.x * 0.3, 1.45, cam.z - 12);
  camera.lookAt(_look);
  camera.updateMatrixWorld();

  // ----- 좀비 -----
  for (const zb of [...game.zombies]) updateZombie(zb, dt, dt);
  if (game.phase === 'lobby' || game.phase === 'over') {
    // 연습 좀비는 맞으면 새로 나오게 두고, 오래 서 있게 둡니다.
  }
  for (const c of game.crates) {
    c.m.position.set(c.pos.x, c.pos.y + Math.sin(game.gt * 2 + c.t0) * 0.12, c.pos.z);
    c.m.rotation.y = Math.sin(game.gt * 1.2) * 0.4;
    c.pos.y = 1.35 + Math.sin(game.gt * 2 + c.t0) * 0.12;
    c.m.userData.halo.scale.setScalar(1 + 0.12 * Math.sin(game.gt * 5));
    c.m.userData.halo.lookAt(camera.position);
  }

  // ----- 선수(재장전·봇·조준점) -----
  for (const P of roster.values()) {
    if (!P.present) continue;
    if (P.reloading && now - P.reloadStart >= D.reload) {
      P.reloading = false;
      P.ammo = MAG;
      pushState();
    }
    if (P.bot && (game.phase === 'lobby' || (game.phase === 'playing' && P.play)) && canShoot()) botThink(P, dt, now);
    updateXh(P, dt, now);
  }

  // ----- 화면 -----
  view.update(dt, cam.z);
  view.render();
  hudT += dt;
  if (hudT > 0.1) {
    hudT = 0;
    if (game.phase === 'playing') {
      updateCards();
      const st = STOPS[Math.max(0, game.stopIdx)];
      $('stageName').textContent = `${st.stage + 1} · ${STAGE_NAMES[st.stage]}`;
      $('waveName').textContent = `WAVE ${Math.max(1, game.stopIdx + 1)}/${STOPS.length}`;
      const left = game.zombies.filter(hostile).length + (game.wave ? game.wave.queue.length : 0);
      $('foeLeft').textContent = String(left);
    }
  }
}

// 판 안에서 상태를 주기적으로 밀어 줍니다(폰의 점수·체력 표시).
setInterval(() => { if (game.phase === 'playing') pushState(); }, 400);

syncRoster();
renderLobby();
startPractice();
syncXh();
requestAnimationFrame(tick);
applyDifficulty();
renderLobby();
// ?autostart 는 봇·마우스 시험 전용입니다. 폰이 한 대라도 들어와 있으면 모두 준비로만 시작합니다.
if (AUTOSTART && (BOTS > 0 || MOUSE)) setTimeout(() => { if (!serverPlayers.length) startGame(); }, 1500);

// 디버그: 콘솔에서 상태 보기·조작
function skipToWave(i) {
  clearField();
  game.stopIdx = clamp(i, 0, STOPS.length - 1);
  const st = STOPS[game.stopIdx];
  cam.x = st.x;
  cam.z = st.z;
  if (game.phase !== 'playing') startGame();
  game.stage = 'fight';
  startWave(game.stopIdx);
}
window.__gun = {
  game, roster, cam, view, startGame, backToLobby, showResults, skipToWave, spawnZombie, fire, onAim, onShoot, onReload, onCalibrate,
  setAim, displayRtt, STOPS, players, aimAt, settings, boards, assistAim, nearestTarget, practiceTargets, rangeBand, worldXAt, spawnRangeZombie,
  victory, defeat, DIFF,
  get D() { return D; },
  get diff() { return diff; },
  constants: { MAG, DMG_CORE, STOPS, KINDS, DIFF }
};
