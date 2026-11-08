// 에어하키 큰 화면: 방·대기실, 팀 나누기(1:CPU, 1:1, 2:2), 물리 진행, 골·점수, 폰 입력 보간, CPU·시험용 봇, HUD.
// 서버는 방과 이벤트만 중계하고 판정은 모두 여기서 합니다.
import { createScene } from './scene.js';
import { RINK, createSim, tuneSim, addMallet, placePuck, step, aiTarget, padRegionOf, homeOf, clamp } from './physics.js';
import { sfx, audio, setHum, setQuiet } from './sfx.js';
import { createSettings, fields, DIFF_LABEL } from '/common/settings.js';
import { createTutorialBoard } from '/common/tutorial-board.js';

const TARGET = 7; // 7점 먼저
const SLOT_INFO = {
  1: { name: '1P', color: '#ff5a5f' },
  2: { name: '2P', color: '#3ab4ff' },
  3: { name: '3P', color: '#ffc93c' },
  4: { name: '4P', color: '#5ee07a' }
};
const CPU_COLOR = '#b07bff';
const GOAL_PAUSE = 1900; // 골 뒤 쉬는 시간(ms)
const SERVE_MS = 700; // 퍽이 다시 나오는 연출
const RULE_MS = 8000; // 한쪽에 너무 오래 머물면 넘깁니다(8초 룰)
const HIT_GAP = 70; // 폰 진동 이벤트 최소 간격(ms)
const SKILL = {
  cpu: { maxV: 2.55, aimErr: 0.07, defErr: 0.085, aggro: 0.65, think: 0.1 },
  bot: { maxV: 3.0, aimErr: 0.06, defErr: 0.07, aggro: 0.75, think: 0.085 },
  auto: { maxV: 2.0, aimErr: 0.1, defErr: 0.11, aggro: 0.4, think: 0.12 }, // 연결이 끊긴 사람 자리 자동 수비
  demo: { maxV: 2.7, aimErr: 0.07, defErr: 0.08, aggro: 0.7, think: 0.09 },
  partner: { maxV: 2.35, aimErr: 0.08, defErr: 0.1, aggro: 0.6, think: 0.11 } // 사람과 같은 팀인 CPU(3명일 때): 난이도와 상관없이 든든하게
};
// 난이도. 예전 값이 '어려움'이고, 보통·쉬움은 퍽이 느리고(최고 속도↓, 감속↑) 골문이 넓고 상대 CPU 가 굼뜹니다.
// assist: 사람이 상대 쪽으로 친 퍽을 골문 쪽으로 꺾어 주는 비율(physics.js assistAim). 벽 맞혀 꺾어 넣기는 그대로 살립니다.
const DIFF = {
  easy: { goal: 0.42, maxPuck: 4.3, friction: 0.3, assist: 0.5, cpu: { maxV: 1.65, aimErr: 0.14, defErr: 0.17, aggro: 0.4, think: 0.16 } },
  normal: { goal: 0.38, maxPuck: 5.3, friction: 0.2, assist: 0.28, cpu: { maxV: 2.1, aimErr: 0.1, defErr: 0.12, aggro: 0.55, think: 0.125 } },
  hard: { goal: RINK.GOAL, maxPuck: 6.5, friction: 0.14, assist: 0, cpu: SKILL.cpu }
};
const DIFF_TONE = { easy: '#5ee07a', normal: '#8fd8ff', hard: '#ff7a59' };

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOTS = clamp(parseInt(params.get('bots'), 10) || 0, 0, 4);
const AUTOSTART = params.has('autostart'); // 봇만 있고 폰이 없을 때만(모두 준비 규칙)
const num = (v, d = 0) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const kmh = (v) => Math.round(v * 3.6);

// 캔버스에 글자를 그리기 전에 글꼴을 기다립니다(최대 2초).
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
// 난이도: 큰 화면이 값을 갖고(이 화면 localStorage 에 기억) 폰 대기실·키보드 D 로 바꿉니다. 경기 중에는 잠급니다.
const settings = createSettings({
  game: 'airhockey',
  fields: [fields.difficulty({ hints: { easy: '퍽 느리게 · 골문 넓게 · 겨냥 도움 · CPU 살살', normal: '퍽 조금 느리게 · 골문 조금 넓게 · 겨냥 살짝 도움', hard: '빠른 퍽 · 좁은 골문 · 도움 없음' } })],
  onChange: () => {
    applyDifficulty();
    renderLobby();
    pushState();
  }
});
settings.attach(socket);
const diffCfg = () => DIFF[settings.difficulty()] || DIFF.normal;
// 연습(튜토리얼) 현황: 대기실에는 칸 안에, 결과 화면에서는 아래 가운데에 띄웁니다.
const lobbyBoard = createTutorialBoard({ mount: $('tutBox') });
lobbyBoard.attach(socket);
const overBoard = createTutorialBoard({ position: 'bottom' });
overBoard.attach(socket);
overBoard.hide(true);
let hadRoom = false; // 이 화면이 이미 방을 받은 적이 있는지(다시 연결된 경우만 fresh 를 '서버 재시작'으로 봅니다)
let autoStarted = false;
function send(event, data, slot) {
  if (!socket.connected) return;
  socket.emit('d2c', slot != null ? { event, slot, data } : { event, data });
}
socket.on('connect', () => {
  let saved = null;
  try { saved = sessionStorage.getItem('pcg-airhockey-room'); } catch (e) {}
  socket.emit('join', { role: 'display', game: 'airhockey', room: saved });
});
socket.on('room', async (r) => {
  try { sessionStorage.setItem('pcg-airhockey-room', r.code); } catch (e) {}
  serverPlayers = r.players || [];
  // 서버가 다시 떠서 방이 새로 만들어졌으면 진행 중이던 경기는 이어 갈 수 없으니 대기실로 돌아갑니다.
  if (r.fresh && hadRoom && game.phase !== 'lobby') backToLobby('서버가 다시 시작돼서 대기실로 돌아왔어요');
  hadRoom = true;
  if (AUTOSTART && BOTS > 0 && !autoStarted && !serverPlayers.length) {
    autoStarted = true;
    setTimeout(() => startGame(), 1200);
  }
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
  for (const pl of serverPlayers) if (!before.has(pl.slot)) sfx.join();
  // 시험용 봇 자리에 진짜 폰이 들어오면 그 폰이 이어받습니다.
  if (game.phase === 'playing') {
    for (const e of game.ents) {
      if (e.kind === 'bot' && serverPlayers.some((x) => x.slot === e.slot && x.connected)) {
        e.kind = 'human';
        e.finger = null;
        e.input.samples.length = 0;
        renderTags();
      }
    }
  }
  renderLobby();
  pushState();
});
socket.on('display_replaced', () => $('replaced').classList.remove('hidden'));
// 모두 준비 현황(서버): 대기실 자리 칸에 "준비 완료 ✓ / 준비 대기 / 연습 중" 을 보입니다.
socket.on('ready_state', (st) => {
  game.ready = new Set((st && st.ready) || []);
  renderLobby();
});
socket.on('tutorial', () => renderLobby());
// 경기 시작은 서버의 start_game(들어온 사람이 모두 준비)으로만 합니다. 폰이 없을 때만 Enter(시험)로 시작합니다.
socket.on('start_game', () => startGame());
socket.on('move', (d) => onMove(d));

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
  sub: 'demo', // demo | countdown | live | goal | serve | final
  demo: true,
  sim: null,
  ents: [], // 말렛 주인: { id, slot, kind: human|bot|cpu, team: 0|1, side, lane, color, name, label, m, ai, input, pad }
  teams: [],
  score: [0, 0],
  stats: {},
  subAt: 0,
  subUntil: 0,
  count: 0,
  drop: null,
  serveSide: 1,
  rule: { half: null, since: 0 },
  winner: null,
  lastGoal: null,
  allGoneSince: null,
  touch: { last: null, team: [null, null] }, // 퍽을 놓은 뒤 마지막으로 친 말렛(전체·팀별)
  ready: new Set(), // 준비를 누른 자리(서버 ready_state)
  level: 'normal' // 이번 경기 난이도
};
function resetTouch() {
  game.touch = { last: null, team: [null, null] };
}

// 사람 수에 따라 팀을 짭니다. 1명: 아래 vs CPU, 2명: 1:1, 3~4명: 2:2(빈자리는 CPU).
// 순서: 0번 아래-왼쪽, 1번 위-왼쪽, 2번 아래-오른쪽, 3번 위-오른쪽.
function makeTeams(list) {
  const P = list.slice(0, 4);
  const doubles = P.length >= 3;
  const seats = doubles
    ? [[0, 'left'], [1, 'left'], [0, 'right'], [1, 'right']]
    : [[0, 'full'], [1, 'full']];
  const out = [];
  seats.forEach(([team, lane], i) => {
    const p = P[i];
    out.push({
      team, lane, side: team === 0 ? 1 : -1,
      slot: p ? p.slot : null,
      kind: p ? (p.bot ? 'bot' : 'human') : 'cpu',
      name: p ? p.name : 'CPU',
      color: p ? p.color : CPU_COLOR,
      label: p ? String(p.slot) : 'C'
    });
  });
  return out;
}
function teamInfo(seats) {
  return [0, 1].map((t) => {
    const mem = seats.filter((s) => s.team === t);
    return { side: t === 0 ? 'bottom' : 'top', color: mem[0].color, name: mem.map((m) => m.name).join(' · '), members: mem };
  });
}

// CPU 실력: 상대 팀 CPU 는 난이도를 따르고, 사람과 같은 팀인 CPU(3명일 때 빈자리)는 늘 든든하게 둡니다.
function cpuSkill(seat, seats) {
  const withHuman = seats.some((o) => o !== seat && o.team === seat.team && o.kind !== 'cpu');
  return withHuman ? SKILL.partner : diffCfg().cpu;
}
function buildMatch(seats, demo) {
  const d = diffCfg();
  const sim = createSim(d);
  view.setGoal(sim.goal);
  const ents = seats.map((s, i) => {
    const m = addMallet(sim, i, s.side, s.lane);
    // 사람(시험용 봇 포함)이 친 퍽만 겨냥 도우미를 받습니다.
    m.assist = !demo && s.kind !== 'cpu' ? d.assist : 0;
    const skill = demo ? SKILL.demo : s.kind === 'cpu' ? cpuSkill(s, seats) : s.kind === 'bot' ? SKILL.bot : SKILL.auto;
    return {
      ...s, id: i, m,
      ai: { ...skill, state: '', next: 0, err: 0, aimX: 0, bank: 0 },
      skill,
      pad: padRegionOf(s.side, s.lane),
      input: { samples: [], offset: null, offsetAt: 0, jitter: 8, lastAt: 0 },
      finger: null, // 봇·키보드의 가상 손가락(패드 0..1)
      manualUntil: 0,
      lastHitSent: 0,
      awaySince: null
    };
  });
  game.sim = sim;
  game.ents = ents;
  game.teams = teamInfo(seats);
  // 지난 경기(마지막 골·데모 골)의 퍽 떨어짐 연출과 8초 룰 기록을 지웁니다.
  game.drop = null;
  game.rule = { half: null, since: performance.now() };
  view.setMallets(ents.map((e) => ({ id: e.id, color: e.color, label: e.label })));
  view.setTeams(game.teams[0].color, game.teams[1].color, game.teams[0].name, game.teams[1].name);
}

function startDemo() {
  game.demo = true;
  game.phase = 'lobby';
  game.sub = 'demo';
  game.score = [0, 0];
  setQuiet(true);
  const seats = [
    { team: 0, lane: 'full', side: 1, slot: null, kind: 'cpu', name: '1P', color: SLOT_INFO[1].color, label: '1' },
    { team: 1, lane: 'full', side: -1, slot: null, kind: 'cpu', name: '2P', color: SLOT_INFO[2].color, label: '2' }
  ];
  buildMatch(seats, true);
  placePuck(game.sim, 0, 0.3);
  game.sim.puck.live = true;
  updateBoards();
}

function startGame() {
  if (game.phase === 'playing') return;
  const list = lobbyPlayers().filter((p) => p.connected);
  if (!list.length) {
    lobbyMessage('폰을 먼저 연결해 주세요. QR을 찍고 시작하기를 누르면 자리가 생겨요.');
    return;
  }
  if (!settings.requireAnswered()) return;
  settings.lock(true);
  lobbyBoard.hide(true);
  overBoard.hide(true);
  game.level = settings.difficulty();
  audio();
  setQuiet(false);
  game.demo = false;
  game.phase = 'playing';
  game.score = [0, 0];
  game.winner = null;
  game.lastGoal = null;
  game.allGoneSince = null;
  game.stats = {};
  for (const p of list) game.stats[p.slot] = { goals: 0, hits: 0, top: 0, own: 0 };
  buildMatch(makeTeams(list), false);
  for (const e of game.ents) {
    const h = homeOf(e.side, e.lane);
    e.m.x = e.m.tx = h.x;
    e.m.z = e.m.tz = h.z;
  }
  // 첫 퍽은 가운데에 놓고 3, 2, 1 뒤에 풀어 줍니다(먼저 치는 쪽이 공격).
  placePuck(game.sim, 0, 0);
  resetTouch();
  game.sim.puck.live = false;
  setSub('countdown', 3200);
  game.count = 4;
  callout('준비', `${game.teams[0].name}  vs  ${game.teams[1].name}`, 'ready', 780);
  $('lobby').classList.add('hidden');
  $('over').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('join').classList.remove('hidden');
  renderTags();
  updateBoards();
  renderHud();
  setHum(0.05);
  pushState();
}

function backToLobby(why) {
  settings.lock(false);
  lobbyBoard.hide(false);
  overBoard.hide(true);
  $('hud').classList.add('hidden');
  $('join').classList.add('hidden');
  $('over').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  note('');
  setHum(0);
  startDemo();
  renderTags();
  renderLobby();
  if (why) lobbyMessage(why);
  pushState();
}

function endGame() {
  game.phase = 'over';
  game.sub = 'over';
  // 결과 화면에서는 다음 판 난이도를 바꿀 수 있습니다(폰 대기 화면·키보드 D).
  settings.lock(false);
  overBoard.hide(false);
  setHum(0);
  $('hud').classList.add('hidden');
  $('tags').classList.add('off');
  note('');
  ruleNote(null);
  const w = game.winner;
  const T = game.teams;
  $('overTitle').textContent = `${T[w].name} 승리`;
  $('overTitle').style.setProperty('--c', T[w].color);
  $('overScore').innerHTML = `<b style="color:${T[0].color}">${game.score[0]}</b><i>:</i><b style="color:${T[1].color}">${game.score[1]}</b>`;
  const rows = game.ents.map((e) => ({ e, st: e.slot != null ? game.stats[e.slot] : null, win: e.team === w }));
  rows.sort((a, b) => (b.win - a.win) || ((b.st ? b.st.goals : -1) - (a.st ? a.st.goals : -1)) || ((b.st ? b.st.top : 0) - (a.st ? a.st.top : 0)));
  const box = $('podium');
  box.innerHTML = '';
  rows.forEach((r, i) => {
    const el = document.createElement('div');
    el.className = 'r' + (r.win ? ' win' : '');
    el.style.setProperty('--c', r.e.color);
    el.style.animationDelay = `${0.15 + i * 0.12}s`;
    const st = r.st || { goals: 0, hits: 0, top: 0 };
    el.innerHTML = `<span class="rank">${i + 1}</span><span class="who">${r.e.name}</span>` +
      `<span class="res">${r.win ? '승' : '패'}</span>` +
      `<span class="num"><b>${r.st ? st.goals : '-'}</b><span>골</span></span>` +
      `<span class="num"><b>${r.st ? st.hits : '-'}</b><span>타격</span></span>` +
      `<span class="num"><b>${r.st && st.top ? kmh(st.top) : '-'}</b><span>최고 km/h</span></span>`;
    box.appendChild(el);
  });
  $('over').classList.remove('hidden');
  sfx.win();
  pushState();
}

function setSub(sub, ms) {
  game.sub = sub;
  game.subAt = performance.now();
  game.subUntil = game.subAt + (ms || 0);
}

// ================================================================
// 폰 입력: move { x, y (0..1, 화면 기준 패드 안 위치), t (폰 시각 ms) }
// 폰 시각과 도착 시각의 차이로 시계를 맞추고, 조금 늦춰서 표본 사이를 보간합니다(네트워크 떨림 숨기기).
// ================================================================
function entBySlot(slot) {
  return game.ents.find((e) => e.slot === slot && e.kind !== 'cpu');
}
function onMove(d) {
  if (game.demo || game.phase !== 'playing' || !d) return;
  const ent = entBySlot(Number(d.slot));
  if (!ent) return;
  const x = clamp(num(d.x, 0.5), 0, 1);
  const y = clamp(num(d.y, 0.5), 0, 1);
  const now = performance.now();
  const t = num(d.t, now);
  const inp = ent.input;
  const off = now - t;
  // 가장 빨리 도착한 표본 기준(최솟값)으로 시계를 맞추되, 천천히 풀어 줘서 경로가 바뀌어도 따라갑니다.
  if (inp.offset != null) inp.offset += (now - inp.offsetAt) * 0.02;
  if (inp.offset == null || off < inp.offset || Math.abs(off - inp.offset) > 1500) {
    if (inp.offset != null && Math.abs(off - inp.offset) > 1500) inp.samples.length = 0;
    inp.offset = off;
  }
  inp.offsetAt = now;
  const late = Math.max(0, off - inp.offset);
  inp.jitter += (late - inp.jitter) * 0.08;
  const r = ent.pad;
  const lt = t + inp.offset;
  const last = inp.samples[inp.samples.length - 1];
  if (last && lt <= last.lt) return; // 순서가 뒤바뀐 표본은 버림
  inp.samples.push({ lt, x: r.x0 + x * (r.x1 - r.x0), z: r.z0 + y * (r.z1 - r.z0) });
  if (inp.samples.length > 16) inp.samples.shift();
  inp.lastAt = now;
}
// 보간된 손가락 위치 → 말렛 목표
function inputTarget(ent, now) {
  const inp = ent.input;
  const s = inp.samples;
  if (!s.length) return null;
  const buf = clamp(inp.jitter * 1.3 + 10, 10, 60);
  const tp = now - buf;
  if (tp <= s[0].lt) return s[0];
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i].lt <= tp) {
      const a = s[i];
      const b = s[i + 1];
      if (b) {
        const u = (tp - a.lt) / Math.max(1, b.lt - a.lt);
        return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u };
      }
      // 마지막 표본 뒤: 직전 속도로 조금만(30ms) 내다봅니다.
      const p = s[i - 1];
      if (!p || now - inp.lastAt > 120) return a;
      const ahead = Math.min(30, tp - a.lt);
      const dt = Math.max(1, a.lt - p.lt);
      return { x: a.x + ((a.x - p.x) / dt) * ahead, z: a.z + ((a.z - p.z) / dt) * ahead };
    }
  }
  return s[s.length - 1];
}

// 가상 손가락(봇·키보드·마우스)을 폰과 같은 move 로 보냅니다.
function fingerMove(ent, fx, fy, latency) {
  const data = { slot: ent.slot, x: fx, y: fy, t: performance.now() };
  if (latency > 0) setTimeout(() => onMove(data), latency);
  else onMove(data);
}
function toPad(ent, x, z) {
  const r = ent.pad;
  return [clamp((x - r.x0) / (r.x1 - r.x0), 0, 1), clamp((z - r.z0) / (r.z1 - r.z0), 0, 1)];
}

// ================================================================
// CPU·봇·자동 수비
// ================================================================
let botClock = 0;
// botDt: 봇이 손가락을 움직일 차례면 지난 뒤 흐른 시간(초), 아니면 0
function think(now, botDt) {
  const sim = game.sim;
  for (const e of game.ents) {
    let mode = e.kind;
    if (game.demo) mode = 'cpu';
    if (mode === 'human') {
      const info = playerInfo(e.slot);
      if (!info.connected) {
        if (!e.awaySince) e.awaySince = now;
        // 연결이 끊긴 지 2.5초가 지나면 그 자리는 자동으로 막습니다.
        if (now - e.awaySince > 2500) mode = 'auto';
      } else {
        e.awaySince = null;
      }
    }
    if (mode === 'bot' && now < e.manualUntil) continue;
    if (mode === 'cpu' || mode === 'auto') {
      const skill = game.demo ? SKILL.demo : mode === 'auto' ? SKILL.auto : e.skill;
      if (now >= e.ai.next) {
        Object.assign(e.ai, { maxV: skill.maxV, aimErr: skill.aimErr, defErr: skill.defErr, aggro: skill.aggro });
        e.ai.next = now + skill.think * 1000 * (0.8 + Math.random() * 0.4);
        const t = aiTarget(sim, e.m, e.ai);
        e.m.tx = t.x;
        e.m.tz = t.z;
      }
      e.m.maxV = skill.maxV;
      e.input.samples.length = 0;
      continue;
    }
    if (mode === 'bot') {
      // 봇: 같은 판단으로 손가락을 움직이고 40Hz 로 move 를 보냅니다(지연 15~45ms 흉내).
      if (!botDt) continue;
      if (now >= e.ai.next) {
        e.ai.next = now + e.skill.think * 1000 * (0.8 + Math.random() * 0.4);
        e.ai.goal = aiTarget(sim, e.m, e.ai);
      }
      if (!e.finger) e.finger = { x: e.m.x, z: e.m.z };
      const g = e.ai.goal || { x: e.m.x, z: e.m.z };
      const dt = Math.min(0.06, botDt);
      const dx = g.x - e.finger.x;
      const dz = g.z - e.finger.z;
      const dl = Math.hypot(dx, dz);
      const mv = e.skill.maxV * dt;
      if (dl > mv) {
        e.finger.x += (dx / dl) * mv;
        e.finger.z += (dz / dl) * mv;
      } else {
        e.finger.x = g.x;
        e.finger.z = g.z;
      }
      const [fx, fy] = toPad(e, e.finger.x, e.finger.z);
      fingerMove(e, fx, fy, 15 + Math.random() * 30);
    }
  }
}

// ================================================================
// 매 프레임: 입력 → 물리 → 사건(타격·벽·골)
// ================================================================
function updateInputs(now) {
  for (const e of game.ents) {
    if (e.kind === 'cpu' || game.demo) continue;
    if (e.kind === 'human' && e.awaySince && now - e.awaySince > 2500) continue;
    const t = inputTarget(e, now);
    if (t) {
      e.m.tx = t.x;
      e.m.tz = t.z;
    }
    e.m.maxV = 9;
  }
}

function strength(rel) {
  return clamp(rel / 5, 0.05, 1);
}
// '강슛' 기준: 이 판 퍽 최고 속도의 78%(어려움 5.1m/s, 쉬움 3.4m/s)
const fastShot = () => (game.sim ? game.sim.maxPuck : 6.5) * 0.78;

function handleEvents(events, now) {
  for (const ev of events) {
    if (ev.type === 'hit') {
      const e = game.ents[ev.id];
      const q = strength(ev.rel);
      game.touch.last = e.id;
      game.touch.team[e.team] = e.id;
      sfx.hit(q, ev.x);
      view.hitFx(ev.x, ev.z, e.color, q);
      if (game.demo) continue;
      if (e.slot != null && game.stats[e.slot]) {
        const st = game.stats[e.slot];
        st.hits += 1;
        st.top = Math.max(st.top, ev.shot != null ? ev.shot : ev.speed); // 상한 전 타구 속도(모두 23km/h 로 같아지지 않게)
        // 친 폰만 진동합니다(폰은 이 신호로 진동·번쩍·딸깍 소리). 세게 친 슛은 더 굵게.
        if (now - e.lastHitSent > HIT_GAP && e.kind === 'human') {
          e.lastHitSent = now;
          send('hit', { strength: +q.toFixed(2), strong: ev.speed > fastShot() }, e.slot);
        }
      }
      if (ev.speed > fastShot()) speedFlash(ev.speed, e);
    } else if (ev.type === 'wall') {
      const q = clamp(ev.speed / 5, 0.05, 1);
      sfx.wall(q, ev.x);
      view.wallFx(ev.x, ev.z, q);
    } else if (ev.type === 'post') {
      sfx.post(clamp(ev.speed / 5, 0.1, 1), ev.x);
    } else if (ev.type === 'goal') {
      onGoal(ev, now);
    }
  }
}

function onGoal(ev, now) {
  const into = ev.side; // +1: 아래 골문(아래 팀이 먹음)
  const scoring = into > 0 ? 1 : 0;
  game.drop = { t0: now, x: ev.x, z: ev.z, into };
  if (game.demo) {
    view.goalFx(scoring === 0 ? 'A' : 'B', into, game.teams[scoring].color);
    game.score[scoring] += 1;
    if (game.score[scoring] >= TARGET) game.score = [0, 0];
    updateBoards(scoring === 0 ? 'A' : 'B');
    setSub('goal', 1600);
    game.serveSide = into;
    return;
  }
  // 득점자: 넣은 팀에서 마지막으로 친 사람. 상대 말렛에 맞고 굴절돼 들어가도 그 사람 골입니다.
  // 넣은 팀이 퍽을 한 번도 안 건드렸으면 마지막으로 친 사람의 자책골입니다.
  const shooterId = game.touch.team[scoring];
  const lastId = game.touch.last;
  const shooter = shooterId != null ? game.ents[shooterId] : null;
  const own = !shooter && lastId != null;
  const by = shooter || (lastId != null ? game.ents[lastId] : null);
  const deflected = Boolean(shooter && lastId != null && game.ents[lastId].team !== scoring);
  game.score[scoring] += 1;
  if (by && by.slot != null && game.stats[by.slot]) {
    if (own) game.stats[by.slot].own += 1;
    else game.stats[by.slot].goals += 1;
  }
  const T = game.teams[scoring];
  const final = game.score[scoring] >= TARGET;
  game.lastGoal = { team: scoring, by: by ? by.slot : null, own };
  view.goalFx(scoring === 0 ? 'A' : 'B', into, T.color);
  sfx.goal(final);
  const who = own ? `${by.name} 자책골` : by ? `${by.name} 득점${deflected ? ' · 굴절' : ''}` : `${T.name} 득점`;
  callout(final ? 'WIN' : 'GOAL!', final ? `${T.name} 승리!` : who, final ? 'win' : 'goal', final ? 3000 : 1700, T.color);
  send('goal', { scorer: own ? null : by ? by.slot : null, team: scoring, own, score: game.score.slice(), final });
  updateBoards(scoring === 0 ? 'A' : 'B');
  renderHud(scoring);
  game.serveSide = into;
  if (final) {
    game.winner = scoring;
    setSub('final', 3000);
  } else {
    setSub('goal', GOAL_PAUSE);
  }
  pushState();
}

function serve() {
  // 골을 먹은 쪽에 퍽을 놓습니다. 2:2 면 그 팀의 두 레인 중 하나에.
  const s = game.serveSide;
  const doubles = game.ents.length > 2;
  const x = doubles ? (Math.random() < 0.5 ? -1 : 1) * 0.22 : (Math.random() - 0.5) * 0.12;
  placePuck(game.sim, x, s * 0.42);
  resetTouch();
  game.sim.puck.live = false;
  game.drop = null;
  setSub('serve', SERVE_MS);
  sfx.serve();
  if (!game.demo) pushState();
}

function updateRule(now) {
  const p = game.sim.puck;
  if (!p.live) {
    game.rule.half = null;
    return;
  }
  // 느린 퍽이 한쪽 반(또는 가운데 줄 위)에 계속 머무는 시간을 잽니다.
  const slow = Math.hypot(p.vx, p.vz) < 1.2;
  const half = !slow ? null : Math.abs(p.z) < RINK.PR ? 0 : Math.sign(p.z);
  if (half === null || half !== game.rule.half) {
    game.rule.half = half;
    game.rule.since = now;
    if (!game.demo) ruleNote(null);
    return;
  }
  const left = RULE_MS - (now - game.rule.since);
  if (!game.demo) ruleNote(left);
  if (left <= 0) {
    // 상대 쪽으로 넘깁니다(가운데 줄 위에 멈춰 있었으면 아무 쪽으로나).
    const to = half === 0 ? (Math.random() < 0.5 ? -1 : 1) : -half;
    placePuck(game.sim, (Math.random() - 0.5) * 0.2, to * 0.42);
    resetTouch();
    game.sim.puck.live = true;
    game.rule.half = null;
    game.rule.since = now;
    view.hitFx(game.sim.puck.x, game.sim.puck.z, '#ffffff', 0.5);
    if (!game.demo) {
      sfx.whistle();
      ruleNote(null);
      note(half === 0 ? '가운데에 멈춘 퍽을 다시 놓았어요' : '8초가 지나 퍽이 상대 쪽으로 넘어갔어요', 2200);
    }
  }
}

// 모든 폰이 오래 끊기면 대기실로
function watchPlayers(now) {
  if (game.demo || game.phase !== 'playing') return;
  const humans = game.ents.filter((e) => e.kind === 'human');
  if (!humans.length) return;
  if (humans.some((e) => playerInfo(e.slot).connected)) {
    game.allGoneSince = null;
    return;
  }
  if (!game.allGoneSince) game.allGoneSince = now;
  if (now - game.allGoneSince > 20000) backToLobby('모든 폰의 연결이 끊겨 대기실로 돌아왔어요');
}

let last = performance.now();
let hudClock = 0;
function tick() {
  const now = performance.now();
  const dtR = Math.min(0.05, Math.max(0.0005, (now - last) / 1000));
  last = now;
  const sim = game.sim;

  // 시험 조작(키보드)
  keyboardDrive(dtR);
  // CPU 판단은 매 프레임 확인(자체 간격이 있음), 봇 손가락은 40Hz 로 움직입니다.
  botClock += dtR;
  let botDt = 0;
  if (botClock >= 0.025) {
    botDt = botClock;
    botClock = 0;
  }
  think(now, botDt);
  updateInputs(now);
  watchPlayers(now);

  // 진행 단계
  if (game.sub === 'countdown') {
    const left = game.subUntil - now;
    const n = Math.ceil(left / 800);
    if (n !== game.count && n >= 0) {
      game.count = n;
      if (n > 0 && n <= 3) {
        callout(String(n), '', 'count', 700);
        sfx.count(false);
      }
    }
    if (left <= 0) {
      callout('GO!', '먼저 치는 쪽이 공격!', 'count', 900);
      sfx.count(true);
      sim.puck.live = true;
      setSub('live');
      game.rule.half = null;
      game.rule.since = now;
      pushState();
    }
  } else if (game.sub === 'goal' && now >= game.subUntil) {
    serve();
  } else if (game.sub === 'serve' && now >= game.subUntil) {
    sim.puck.live = true;
    setSub(game.demo ? 'demo' : 'live');
    game.rule.since = now;
    if (!game.demo) pushState();
  } else if (game.sub === 'final' && now >= game.subUntil) {
    endGame();
  }

  const events = [];
  step(sim, dtR, events);
  handleEvents(events, now);
  if (game.sub === 'live' || game.sub === 'demo') updateRule(now);

  // 그림
  for (const e of game.ents) {
    const away = e.kind === 'human' && e.awaySince && now - e.awaySince > 2500;
    view.poseMallet(e.id, e.m.x, e.m.z, e.m.vx, e.m.vz, away);
  }
  const p = sim.puck;
  if (game.drop) {
    // 골문 홈으로 미끄러져 떨어지는 퍽
    const u = clamp((now - game.drop.t0) / 420, 0, 1);
    const z = game.drop.z + game.drop.into * u * 0.06;
    view.setPuck({ visible: u < 1, x: game.drop.x, z, y: -0.06 * u * u, angle: p.angle, speed: 0, scale: 1 });
  } else if (game.sub === 'serve') {
    const u = clamp((now - game.subAt) / SERVE_MS, 0, 1);
    const s = u < 0.7 ? (u / 0.7) * 1.15 : 1.15 - ((u - 0.7) / 0.3) * 0.15;
    view.setPuck({ visible: true, x: p.x, z: p.z, angle: p.angle, speed: 0, scale: Math.max(0.01, s), jump: true });
  } else if (game.phase === 'over') {
    view.setPuck(null);
  } else {
    view.setPuck({ visible: true, x: p.x, z: p.z, angle: p.angle, speed: Math.hypot(p.vx, p.vz) });
  }
  view.frame(now, dtR, game.phase === 'playing' ? 'play' : game.phase === 'over' ? 'over' : 'lobby');

  // HUD(초당 30번이면 충분)
  hudClock += dtR;
  if (game.phase === 'playing') {
    placeTags();
    if (hudClock > 0.033) {
      hudClock = 0;
      renderSpeed(Math.hypot(p.vx, p.vz));
    }
  }
  requestAnimationFrame(tick);
}

// ================================================================
// 상태 보내기
// ================================================================
function stateTeams() {
  return game.teams.map((t) => ({ name: t.name, color: t.color, side: t.side }));
}
function statePlayers() {
  const out = {};
  let seats = null;
  if (game.phase === 'lobby') {
    seats = makeTeams(lobbyPlayers().filter((p) => p.connected));
  } else {
    seats = game.ents;
  }
  const teams = teamInfo(seats);
  for (const s of seats) {
    if (s.slot == null) continue;
    const mates = seats.filter((o) => o.team === s.team && o !== s).map((o) => o.name);
    out[s.slot] = {
      team: s.team, side: s.side > 0 ? 'bottom' : 'top', lane: s.lane, region: padRegionOf(s.side, s.lane),
      mates, opp: teams[1 - s.team].name, oppColor: teams[1 - s.team].color, teamColor: teams[s.team].color
    };
  }
  return out;
}
function pushState() {
  const stats = {};
  for (const [s, v] of Object.entries(game.stats)) stats[s] = { goals: v.goals, hits: v.hits, top: kmh(v.top) };
  send('game_state', {
    phase: game.phase,
    sub: game.demo ? 'idle' : game.sub,
    score: game.score.slice(),
    target: TARGET,
    rink: { w: RINK.W, l: RINK.L, mr: RINK.MR, pr: RINK.PR, goal: game.sim ? game.sim.goal : diffCfg().goal },
    difficulty: game.phase === 'playing' ? game.level : settings.difficulty(),
    settings: settings.forState(),
    teams: game.phase === 'lobby' ? [] : stateTeams(),
    players: statePlayers(),
    winner: game.phase === 'over' ? game.winner : null,
    stats
  });
}

// ================================================================
// 화면 글자
// ================================================================
function updateBoards(hl) {
  const T = game.teams;
  if (!T.length) return;
  view.setScore(game.score[0], game.score[1], T[0].color, T[1].color, short(T[0].name), short(T[1].name), hl || null);
  if (hl) setTimeout(() => {
    if (game.teams === T) view.setScore(game.score[0], game.score[1], T[0].color, T[1].color, short(T[0].name), short(T[1].name), null);
  }, 1500);
}
const short = (n) => n.replace(/ · /g, '·');

function renderHud(bump) {
  const T = game.teams;
  if (!T.length) return;
  for (const i of [0, 1]) {
    const el = $(i === 0 ? 'tA' : 'tB');
    el.style.setProperty('--c', T[i].color);
    $(i === 0 ? 'nA' : 'nB').textContent = T[i].name;
    const sc = $(i === 0 ? 'sA' : 'sB');
    sc.textContent = game.score[i];
    if (bump === i) {
      sc.classList.remove('on');
      void sc.offsetWidth;
      sc.classList.add('on');
    }
  }
  const mp = game.score.some((s) => s === TARGET - 1);
  $('sbMid').textContent = mp ? '매치 포인트' : `${TARGET}점 선승`;
  $('sbMid').classList.toggle('mp', mp);
  $('sbMode').textContent = game.ents.length > 2 ? '2 VS 2' : game.ents.some((e) => e.kind === 'cpu') ? 'VS CPU' : '1 VS 1';
  const lv = $('sbLv');
  lv.style.setProperty('--lv', DIFF_TONE[game.level] || '#8fd8ff');
  lv.lastChild.textContent = DIFF_LABEL[game.level] || '보통';
}

let speedTop = 0;
function renderSpeed(v) {
  const k = kmh(v);
  $('spdV').textContent = k;
  $('spdBar').style.transform = `scaleX(${clamp(v / (game.sim ? game.sim.maxPuck : 6.5), 0, 1).toFixed(3)})`;
  if (v > speedTop) speedTop = v;
}
let fastTimer = null;
function speedFlash(v, e) {
  const el = $('speed');
  el.classList.remove('fast');
  void el.offsetWidth;
  el.classList.add('fast');
  el.style.setProperty('--c', e.color);
  $('spdTag').textContent = `${e.name} 강슛!`;
  clearTimeout(fastTimer);
  fastTimer = setTimeout(() => el.classList.remove('fast'), 1300);
  sfx.fast();
}

// 말렛 위 이름표
const tagEls = new Map();
function renderTags() {
  const box = $('tags');
  box.innerHTML = '';
  box.classList.remove('off');
  tagEls.clear();
  if (game.demo) return;
  for (const e of game.ents) {
    const el = document.createElement('div');
    el.className = 'tag' + (e.kind === 'cpu' ? ' cpu' : '');
    el.style.setProperty('--c', e.color);
    el.innerHTML = `<b>${e.name}</b><span></span>`;
    box.appendChild(el);
    tagEls.set(e.id, el);
  }
}
function placeTags() {
  const now = performance.now();
  for (const e of game.ents) {
    const el = tagEls.get(e.id);
    if (!el) continue;
    const pt = view.project(e.m.x, RINK.TOP + 0.1, e.m.z);
    el.style.transform = `translate(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px) translate(-50%, -100%)`;
    let st = '';
    if (e.kind === 'human' && e.awaySince) st = now - e.awaySince > 2500 ? '연결 끊김 · 자동' : '연결 끊김';
    else if (e.kind === 'bot') st = now < e.manualUntil ? '키보드' : 'BOT';
    const sp = el.querySelector('span');
    if (sp.textContent !== st) sp.textContent = st;
    el.classList.toggle('away', Boolean(e.kind === 'human' && e.awaySince));
  }
}

let callTimer = null;
function callout(main, sub, kind, ms, color) {
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
let noteTimer = null;
function note(text, ms) {
  const el = $('note');
  el.textContent = text;
  el.classList.toggle('on', Boolean(text));
  clearTimeout(noteTimer);
  if (text && ms) noteTimer = setTimeout(() => el.classList.remove('on'), ms);
}
let ruleShown = false;
function ruleNote(left) {
  const el = $('rule');
  if (left == null || left > 5000) {
    if (ruleShown) {
      el.classList.remove('on');
      ruleShown = false;
    }
    return;
  }
  ruleShown = true;
  el.classList.add('on');
  el.textContent = `${Math.max(0, Math.ceil(left / 1000))}초 안에 쳐 내세요`;
}
let msgTimer = null;
function lobbyMessage(t) {
  const e = $('msg');
  e.textContent = t;
  e.classList.add('on');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => e.classList.remove('on'), 2800);
}

// ================================================================
// 대기실
// ================================================================
function renderLobby() {
  const box = $('slots');
  box.innerHTML = '';
  const list = lobbyPlayers();
  const practicing = new Set(lobbyBoard.practicing());
  for (let s = 1; s <= 4; s++) {
    const p = list.find((x) => x.slot === s);
    const e = document.createElement('div');
    const ready = p && !p.bot && p.connected && game.ready.has(s);
    const prac = p && !p.bot && p.connected && !ready && practicing.has(s);
    e.className = 'slot' + (p ? ' on' : '') + (p && !p.connected ? ' away' : '') + (p && p.bot ? ' bot' : '') + (ready ? ' ready' : '') + (prac ? ' prac' : '');
    if (p) {
      e.style.setProperty('--c', p.color);
      const st = p.bot ? 'BOT' : !p.connected ? '연결 끊김' : ready ? '준비 완료 ✓' : prac ? '연습 중' : '준비 대기';
      e.innerHTML = `<b>${p.name}</b><small>${st}</small>`;
    } else {
      e.textContent = `${s}P 비어 있음`;
    }
    box.appendChild(e);
  }
  const conn = list.filter((p) => p.connected);
  const pairs = $('pairs');
  if (!conn.length) {
    pairs.innerHTML = '혼자면 CPU 와, 둘이면 1:1, 셋·넷이면 2:2 로 겨뤄요.';
  } else {
    const T = teamInfo(makeTeams(conn));
    pairs.innerHTML = `<span style="color:${T[0].color}">아래쪽 ${T[0].name}</span> <i>vs</i> <span style="color:${T[1].color}">위쪽 ${T[1].name}</span>`;
  }
}

// ================================================================
// 시험 조작: Enter 시작, WASD = 아래쪽 첫 자리, 방향키 = 위쪽 첫 자리, 마우스로 판 위 끌기
// ================================================================
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (game.phase !== 'playing') startGame();
    return;
  }
  if (/^(KeyW|KeyA|KeyS|KeyD|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|ShiftLeft|ShiftRight)$/.test(e.code)) {
    keys.add(e.code);
    if (e.code.startsWith('Arrow')) e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
function keyEnt(team) {
  return game.ents.find((e) => e.team === team && e.kind !== 'cpu') || null;
}
let kbSend = 0;
function keyboardDrive(dt) {
  if (game.demo || game.phase !== 'playing' || !keys.size) return;
  kbSend += dt;
  const fast = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const sp = (fast ? 3.6 : 2.2) * dt;
  for (const [team, up, dn, lf, rt] of [[0, 'KeyW', 'KeyS', 'KeyA', 'KeyD'], [1, 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']]) {
    const dx = (keys.has(rt) ? 1 : 0) - (keys.has(lf) ? 1 : 0);
    const dz = (keys.has(dn) ? 1 : 0) - (keys.has(up) ? 1 : 0);
    if (!dx && !dz) continue;
    const e = keyEnt(team);
    if (!e) continue;
    if (!e.finger || performance.now() > e.manualUntil + 400) e.finger = { x: e.m.x, z: e.m.z };
    e.manualUntil = performance.now() + 1500;
    const l = Math.hypot(dx, dz);
    e.finger.x = clamp(e.finger.x + (dx / l) * sp, e.pad.x0, e.pad.x1);
    e.finger.z = clamp(e.finger.z + (dz / l) * sp, e.pad.z0, e.pad.z1);
    if (kbSend >= 0.025) {
      const [fx, fy] = toPad(e, e.finger.x, e.finger.z);
      fingerMove(e, fx, fy, 0);
    }
  }
  if (kbSend >= 0.025) kbSend = 0;
}
let dragEnt = null;
let dragId = null;
$('cv').addEventListener('pointerdown', (ev) => {
  audio();
  if (game.demo || game.phase !== 'playing') return;
  const hit = view.pickTable(ev.clientX, ev.clientY);
  if (!hit) return;
  const side = hit.z >= 0 ? 1 : -1;
  const cand = game.ents.filter((e) => e.kind !== 'cpu' && e.side === side);
  if (!cand.length) return;
  dragEnt = cand.find((e) => hit.x >= e.pad.x0 && hit.x <= e.pad.x1) || cand[0];
  dragId = ev.pointerId;
  $('cv').setPointerCapture(ev.pointerId);
  dragTo(ev);
});
function dragTo(ev) {
  if (!dragEnt || ev.pointerId !== dragId) return;
  const hit = view.pickTable(ev.clientX, ev.clientY);
  if (!hit) return;
  dragEnt.manualUntil = performance.now() + 1500;
  const [fx, fy] = toPad(dragEnt, hit.x, hit.z);
  fingerMove(dragEnt, fx, fy, 0);
}
$('cv').addEventListener('pointermove', dragTo);
const endDrag = (ev) => {
  if (ev.pointerId === dragId) {
    dragEnt = null;
    dragId = null;
  }
};
$('cv').addEventListener('pointerup', endDrag);
$('cv').addEventListener('pointercancel', endDrag);

// 난이도가 바뀌면(대기실·결과 화면) 골문 폭을 3D 테이블에 바로 보이고, 돌고 있는 데모 판에도 적용합니다.
function applyDifficulty() {
  const d = diffCfg();
  view.setGoal(d.goal);
  if (game.sim && game.phase !== 'playing') tuneSim(game.sim, d);
}

// 대기실·결과 화면이 낮은 화면(브라우저 막대가 있는 720p TV 등)에서 잘리지 않게, 넘치면 그만큼 통째로 줄입니다.
// 연습 칸·변경 알림이 생기고 없어질 때마다 높이가 바뀌므로 크기 관찰로 다시 맞춥니다.
function fitScreen(sel, reserveTop, reserveBottom) {
  const el = document.querySelector(sel);
  if (!el) return;
  const refit = () => {
    if (!el.offsetParent && !el.getClientRects().length) return; // 숨어 있으면 다음에
    const z = Number(el.style.zoom) || 1;
    const natural = el.getBoundingClientRect().height / z;
    const avail = window.innerHeight - reserveTop - reserveBottom;
    const want = clamp(avail / Math.max(1, natural), 0.62, 1);
    if (Math.abs(want - z) < 0.01) return;
    el.style.zoom = want >= 0.995 ? '' : want.toFixed(3);
  };
  if (window.ResizeObserver) new ResizeObserver(() => requestAnimationFrame(refit)).observe(el);
  window.addEventListener('resize', refit);
  refit();
}

// ================================================================
// 시작
// ================================================================
fitScreen('#lobby .lobby', 74, 24);
fitScreen('#over .over', 74, 24);
$('kbTest').classList.toggle('hidden', !BOTS);
settings.mount($('setBox'));
settings.mount($('overSet'), { compact: true });
startDemo();
renderLobby();
requestAnimationFrame(tick);

// 디버그: 콘솔에서 상태 보기·조작
window.__airhockey = {
  game, view, onMove, startGame, endGame, backToLobby, lobbyPlayers, pushState, settings, lobbyBoard, overBoard, DIFF,
  /** 시험: 난이도 바꾸기('easy'|'normal'|'hard'). 대기실·결과 화면에서만 */
  setDifficulty: (lv) => settings.set('difficulty', lv),
  forceGoal(team = 0) {
    if (game.phase !== 'playing') return;
    const p = game.sim.puck;
    placePuck(game.sim, 0, team === 0 ? -0.9 : 0.9);
    p.vz = team === 0 ? -3 : 3;
    p.live = true;
  }
};
