// 테니스 큰 화면: 경기 진행(단식·복식·CPU), 서브와 랠리, 슬로우 모션, 타이밍 판정, 자동 이동, 점수(15·30·40·듀스·어드밴티지),
// 중계 HUD, 소켓, 시험용 봇과 키보드. 서버는 방과 이벤트만 중계하고 판정은 모두 여기서 합니다.
import { createScene } from './scene.js';
import { COURT, clamp, fwdOf, rightOf, simulate, sampleFlight, flightEnd, aimShot, planContact, inCourt, inBox } from './physics.js';
import { athletePose, blendPose, contactOffset, SERVE_TOSS_LEAD } from './motion.js';
import { sfx, audio, crowd } from './sfx.js';

const GAMES_TO_WIN = 2; // 2게임 선승(게임 안에서는 15·30·40·듀스·어드밴티지)
const WINDOW = 0.14; // 판정 창(경기 초)
const PERFECT = 0.035;
const GOOD = 0.08;
const OVER_RAW = 1.25; // 폰 raw 힘이 이 값을 넘으면 너무 세게 친 것(홈런)
const SLOW = 0.28; // 슬로우 배율
const SLOW_LEAD = 0.38; // 타점까지 이 시간(경기 초) 안이면 슬로우
const SLOW_TAU = 0.05; // 슬로우로 들어갈 때 배율이 내려가는 시간 상수(실제 초)
// 폰은 스윙을 감지한 뒤 이만큼(실제 ms) 값을 모아서 보냅니다(play/tennis/controller.js 의 WINDOW_MS).
const PHONE_SWING_MS = 110;
const LATE_SLACK_MS = 90; // 폰 스윙 도착을 기다릴 때 더하는 여유(전달 시간 흔들림)
// 폰의 '지금!'을 타점보다 이만큼(실제 ms) 먼저 띄웁니다. 보고 휘두르기까지 걸리는 반응 시간입니다(실폰 검증 전).
const NOW_LEAD_MS = 180;
const TOSS_VY = 4.95;
const SLOT_INFO = {
  1: { name: '1P', color: '#ff5a5f' },
  2: { name: '2P', color: '#3ab4ff' },
  3: { name: '3P', color: '#ffc93c' },
  4: { name: '4P', color: '#5ee07a' }
};
const CPU_COLOR = '#e4e9f0';
const SPIN_NAME = { top: '탑스핀', slice: '슬라이스', none: '플랫', kick: '킥 서브', sslice: '슬라이스 서브' };
const HAND_NAME = { fore: '포핸드', back: '백핸드', serve: '서브' };

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOTS = clamp(parseInt(params.get('bots'), 10) || 0, 0, 4);
const AUTOSTART = params.has('autostart');
const num = (v, d) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
// 시계: 평소에는 performance.now(), 시험용 빨리 감기(fastForward) 때는 앞으로 당겨집니다.
let timeShift = 0;
const nowMs = () => performance.now() + timeShift;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
  try { saved = sessionStorage.getItem('pcg-tennis-room'); } catch (e) {}
  socket.emit('join', { role: 'display', game: 'tennis', room: saved });
});
socket.on('room', async (r) => {
  try { sessionStorage.setItem('pcg-tennis-room', r.code); } catch (e) {}
  serverPlayers = r.players || [];
  // 서버가 다시 떠서 방이 새로 만들어졌으면 진행 중이던 경기는 이어 갈 수 없으니 대기실로 돌아갑니다.
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
  for (const pl of serverPlayers) if (!before.has(pl.slot)) sfx.join();
  for (const s of [...game.ready]) if (!serverPlayers.some((x) => x.slot === s)) game.ready.delete(s);
  renderLobby();
  pushState();
});
socket.on('display_replaced', () => $('replaced').classList.remove('hidden'));
socket.on('start_game', () => startGame());
socket.on('swing', (d) => onSwing(d, false));
socket.on('pose', (d) => onPose(d));
socket.on('calibrate', (d) => onCalibrate(d));

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
  match: null,
  demo: null,
  humans: [],
  poses: {}, // slot -> { s, fc, at }
  ready: new Set(),
  overAt: 0,
  allGoneSince: null,
  log: [],
  debug: { pressures: [], rallies: [] }
};

function makePl(info, kind, team, idx) {
  return {
    key: kind === 'cpu' ? `cpu${team}${idx}` : `p${info.slot}`,
    kind, slot: kind === 'cpu' ? null : info.slot, name: kind === 'cpu' ? 'CPU' : info.name,
    color: kind === 'cpu' ? CPU_COLOR : info.color, bot: Boolean(info && info.bot), team, idx,
    x: 0, z: 0, speed: 0, phase: 0, lx: 0, lz: 0, stroke: null, dy: 0, pose: null,
    stats: { hits: 0, perfect: 0, winners: 0, aces: 0, dfaults: 0, topServe: 0, topShot: 0 }
  };
}

// 팀 구성: 1명 → 1P 대 CPU, 2명 → 단식, 3명 → (1P·3P) 대 (2P·CPU), 4명 → (1P·3P) 대 (2P·4P)
function buildTeams(list, demo) {
  const H = list.slice(0, 4);
  let t0;
  let t1;
  if (H.length <= 1) {
    t0 = [H[0]];
    t1 = [null];
  } else if (H.length === 2) {
    t0 = [H[0]];
    t1 = [H[1]];
  } else {
    t0 = [H[0], H[2]];
    t1 = [H[1], H[3] || null];
  }
  const mk = (arr, team) => arr.map((info, idx) => (info ? makePl(info, demo ? 'cpu' : 'human', team, idx) : makePl(null, 'cpu', team, idx)));
  const teams = [{ players: mk(t0, 0), end: 0 }, { players: mk(t1, 1), end: 1 }];
  if (demo) {
    teams[0].players.forEach((p, i) => { p.color = SLOT_INFO[i ? 3 : 1].color; p.key = `demo0${i}`; });
    teams[1].players.forEach((p, i) => { p.color = SLOT_INFO[i ? 4 : 2].color; p.key = `demo1${i}`; });
  }
  return teams;
}

function newMatch(list, demo) {
  const teams = buildTeams(list, demo);
  const m = {
    demo, teams, doubles: teams[0].players.length > 1,
    games: [0, 0], points: [0, 0], serveTeam: demo ? Math.round(Math.random()) : 0, serverIdx: [0, 0], serveNo: 1,
    state: 'intro', waitReal: nowMs() + (demo ? 900 : 2600), next: null,
    clock: { gt: 0, scale: 1, hist: [] },
    flight: null, evIdx: 0, rally: null, plan: null, retoss: 0, box: 'deuce', server: null, receiver: null,
    winner: null, lastShot: null, gameJust: null, rallyLen: 0, camX: 0
  };
  prepareServe(m, true, true);
  for (const t of m.teams) for (const pl of t.players) {
    const h = pl.home || homePos(m, pl);
    pl.x = h[0];
    pl.z = h[1];
  }
  placeForServe(m, true);
  return m;
}

const allPlayers = (m) => [...m.teams[0].players, ...m.teams[1].players];
const endOf = (m, team) => m.teams[team].end;
const bothHuman = (m) => m.teams.every((t) => t.players.some((p) => p.kind === 'human'));
function plBySlot(slot) {
  const m = game.match;
  if (!m) return null;
  return allPlayers(m).find((p) => p.kind === 'human' && p.slot === slot) || null;
}
// 몸 좌표 ↔ 세계 좌표(끝마다 좌우·앞뒤가 뒤집힙니다)
const toWorld = (end, l) => [-rightOf(end) * l[0], l[1], fwdOf(end) * l[2]];
const toLocal = toWorld;

const C_OFF = { fore: contactOffset('fore'), back: contactOffset('back'), serve: contactOffset('serve') };

function homePos(m, pl) {
  const end = endOf(m, pl.team);
  const n = m.teams[pl.team].players.length;
  const lane = n === 1 ? 0 : pl.idx === 0 ? 2.6 : -2.6;
  return [rightOf(end) * lane, -fwdOf(end) * (COURT.halfL + 1.0)];
}
// 이 사람이 몸을 둘 곳: 공이 라켓 헤드에 오도록 타점에서 몸 좌표 오프셋을 뺍니다.
function bodyForContact(m, pl, p, type) {
  const end = endOf(m, pl.team);
  const o = toWorld(end, C_OFF[type]);
  return [p[0] - o[0], p[2] - o[2]];
}

// ---------- 서브 준비 ----------
function prepareServe(m, first, quiet) {
  const st = m.teams[m.serveTeam];
  m.server = st.players[m.serverIdx[m.serveTeam] % st.players.length];
  m.box = (m.points[0] + m.points[1]) % 2 === 0 ? 'deuce' : 'ad';
  const rt = m.teams[1 - m.serveTeam];
  m.receiver = rt.players.length === 1 ? rt.players[0] : rt.players[m.box === 'deuce' ? 0 : 1];
  m.flight = null;
  m.rally = null;
  m.plan = null;
  m.rallyLen = 0;
  if (!first) {
    m.state = 'intro';
    m.waitReal = nowMs() + (m.serveNo === 2 ? 1100 : 1500);
  }
  for (const pl of allPlayers(m)) {
    pl.stroke = null;
    pl.pending = null;
  }
  placeForServe(m, false);
  if (!m.demo && !quiet) {
    const sv = m.server;
    const who = sv.kind === 'cpu' ? 'CPU' : sv.name;
    prompt(`${who} ${m.serveNo === 2 ? '세컨드 서브' : '서브'}`, m.box === 'deuce' ? '듀스 코트(오른쪽)에서' : '애드 코트(왼쪽)에서');
    if (sv.kind === 'human' && !sv.bot) send('cue', { kind: 'serve', stage: 'ready', second: m.serveNo === 2 }, sv.slot);
    pushState();
  }
}
// 서버·리시버·파트너 자리
function placeForServe(m, snap) {
  const se = endOf(m, m.serveTeam);
  const re = 1 - se;
  const sideSign = m.box === 'deuce' ? 1 : -1;
  for (const pl of allPlayers(m)) {
    let t;
    if (pl === m.server) t = [rightOf(se) * sideSign * (m.doubles ? 1.7 : 0.6), -fwdOf(se) * (COURT.halfL + 0.25)];
    else if (pl === m.receiver) t = [rightOf(re) * sideSign * (m.doubles ? 3.2 : 2.6), -fwdOf(re) * (COURT.halfL + 1.1)];
    else {
      const end = endOf(m, pl.team);
      t = [rightOf(end) * -sideSign * 2.8, -fwdOf(end) * (COURT.halfL + (pl.team === m.serveTeam ? 0.6 : 1.1))];
    }
    pl.home = t;
    if (snap) {
      pl.x = t[0];
      pl.z = t[1];
    }
  }
}

// ---------- 토스 ----------
function startToss(m) {
  const sv = m.server;
  const se = endOf(m, sv.team);
  const o = toWorld(se, C_OFF.serve);
  const contact = [sv.x + o[0], o[1], sv.z + o[2]];
  const gt = m.clock.gt;
  const tossAt = gt + 0.22;
  const start = [contact[0], contact[1] - 1.0, contact[2]];
  m.flight = simulate(start, [0, TOSS_VY, 0], [0, 0, 0], { t0: tossAt, maxT: 2.6 });
  m.evIdx = m.flight.events.length; // 토스는 규칙 판정 대상이 아님
  m.state = 'toss';
  m.rally = null;
  // 정점을 지나 타점 높이로 내려오는 순간
  let tc = tossAt + SERVE_TOSS_LEAD;
  const B = m.flight.buf;
  for (let i = 2; i < m.flight.n; i++) {
    if (B[i * 9 + 4] < 0 && B[i * 9 + 1] <= contact[1]) {
      tc = m.flight.t0 + i / 240;
      break;
    }
  }
  const st = sampleFlight(m.flight, tc);
  const p = setPlan(m, sv, { t: tc, p: st.p }, 'serve');
  p.hand = 'serve';
  const auto = !p.human;
  sv.stroke = { type: 'serve', spin: 'none', tPrep: gt, tFwd: auto ? tc - 0.12 : Infinity, tHold: tc - 0.12, tContact: tc };
  if (p.cpuSwing) sv.stroke.spin = p.cpuSwing.spin;
  // 서브 안내는 서브 준비 동안만 띄웁니다. 화면 아래 가운데라 토스 슬로우 동안 가까운 쪽 서버의 다리를 가립니다.
  if (!m.demo) prompt('', '');
  if (!m.demo && sv.kind === 'human') hudNote(m.retoss ? '토스를 다시 올려요' : '');
}

// ---------- 타점 계획 ----------
function isAuto(pl) {
  if (pl.kind === 'cpu') return true;
  if (pl.bot) return false;
  const info = playerInfo(pl.slot);
  return !info.connected; // 연결이 끊긴 사람은 자동으로 칩니다
}
function setPlan(m, pl, plan, kind, pressure = 0) {
  const auto = isAuto(pl);
  const p = {
    pl, t: plan.t, p: plan.p, kind, decided: false, swing: null, cued: false, closeReal: null, confirmReal: null, pressure,
    // 압박이 큰 공(빠르고, 멀리 뛰고, 회전이 많은 공)일수록 판정 창이 좁아집니다.
    window: WINDOW * (1 - 0.5 * pressure),
    human: pl.kind === 'human' && !auto && !pl.bot, bot: pl.bot && pl.kind === 'human', auto,
    hand: kind === 'serve' ? 'serve' : handFor(m, pl, plan.p), botAt: null, botSwing: null, cpuSwing: null, cpuMiss: false
  };
  if (p.bot) {
    const r = Math.random();
    const err = r < 0.07 ? (Math.random() < 0.5 ? -1 : 1) * (0.15 + Math.random() * 0.08) : clamp(gauss() * 0.05, -0.14, 0.14);
    p.botAt = plan.t + err;
    p.botSwing = randomSwing(kind === 'serve');
  }
  if (auto) {
    p.cpuMiss = kind !== 'serve' && Math.random() < (m.demo ? 0.06 : 0.035) + 0.5 * Math.pow(pressure, 1.6);
    p.cpuSwing = cpuSwing(kind === 'serve', m);
  }
  m.plan = p;
  if (p.human || p.bot || p.auto) {
    // 들어오는 공: 백스윙을 미리 시작합니다(사람은 휘두를 때까지 백스윙에서 기다림).
    if (kind !== 'serve' && p.auto) {
      const sw = p.cpuSwing;
      pl.pending = { type: p.hand, spin: p.cpuMiss ? 'none' : sw.spin, tPrep: p.t - 0.62, tFwd: p.t - 0.22, tContact: p.t + (p.cpuMiss ? 0.12 : 0), tHold: p.t - 0.22 };
    }
  }
  return p;
}
function gauss() {
  return (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 0.577;
}
function randomSwing(serve) {
  const r = Math.random();
  const spin = serve ? (r < 0.5 ? 'none' : r < 0.75 ? 'top' : 'slice') : r < 0.45 ? 'top' : r < 0.68 ? 'slice' : 'none';
  return { power: serve ? 0.55 + Math.random() * 0.45 : 0.4 + Math.random() * 0.55, spin, spinAmt: 0.35 + Math.random() * 0.6, aim: (Math.random() - 0.5) * 40 };
}
function cpuSwing(serve, m) {
  const q = (m.demo ? 0.55 : 0.5) + Math.random() * 0.45;
  const r = Math.random();
  const spin = serve ? (m.serveNo === 2 ? 'top' : r < 0.55 ? 'none' : r < 0.8 ? 'slice' : 'top') : r < 0.45 ? 'top' : r < 0.65 ? 'slice' : 'none';
  return {
    power: serve ? 0.45 + Math.random() * 0.5 : 0.35 + Math.random() * 0.55, spin, spinAmt: 0.35 + Math.random() * 0.55,
    aim: (Math.random() - 0.5) * 44, q, err: (Math.random() < 0.5 ? -1 : 1) * (1 - q) * WINDOW
  };
}
// 공이 몸 왼쪽이면 백핸드(오른손잡이). 조금 포핸드 쪽으로 기웁니다.
function handFor(m, pl, pos) {
  const end = endOf(m, pl.team);
  const lat = (pos[0] - pl.x) * rightOf(end);
  return lat > -0.35 ? 'fore' : 'back';
}

// 슬로우 켜고 끄기: 대기실 버튼이나 L 키, 주소에 ?noslow. 이 화면 브라우저에 기억합니다.
let slowOn = !params.has('noslow');
try { if (localStorage.getItem('tennis.slow') === 'off') slowOn = false; } catch {}
function setSlow(on) {
  slowOn = on;
  try { localStorage.setItem('tennis.slow', on ? 'on' : 'off'); } catch {}
  const b = $('slowBtn');
  if (b) { b.textContent = on ? '슬로우 켜짐' : '슬로우 꺼짐'; b.classList.toggle('off', !on); }
}
function slowTarget(m) {
  if (!slowOn) return 1;
  const p = m.plan;
  if (!p || p.decided || !(p.human || p.bot)) return 1;
  return p.t - m.clock.gt < SLOW_LEAD ? SLOW : 1;
}
// 경기 시간 dG 가 흐르는 데 걸릴 실제 ms. 슬로우 중이거나 배율이 SLOW 로 내려가는 중이라고 봅니다.
function realMsUntil(m, dG) {
  const s = m.clock.scale;
  if (!slowOn) return (dG / Math.max(s, SLOW)) * 1000;
  const k = Math.max(0, s - SLOW) * SLOW_TAU; // 배율이 SLOW 까지 내려가는 동안 덤으로 흐르는 경기 시간
  return (dG > k ? (dG - k) / SLOW : dG / Math.max(s, SLOW)) * 1000;
}
// 실제 시각(ms) → 경기 시각. 배율이 바뀌므로 기록을 따라 보간합니다.
function toGame(m, realMs) {
  const h = m.clock.hist;
  if (!h.length) return m.clock.gt;
  const last = h[h.length - 1];
  if (realMs >= last[0]) return last[1] + ((realMs - last[0]) / 1000) * m.clock.scale;
  if (realMs <= h[0][0]) return h[0][1] - (h[0][0] - realMs) / 1000;
  let lo = 0;
  let hi = h.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (h[mid][0] <= realMs) lo = mid;
    else hi = mid;
  }
  const a = h[lo];
  const b = h[hi];
  const f = (realMs - a[0]) / Math.max(1e-6, b[0] - a[0]);
  return a[1] + (b[1] - a[1]) * f;
}

// 폰에서 휘두른 스윙이 이 화면에 도착하기까지 걸리는 실제 시간: 감지 뒤 모으는 시간 + 폰→서버 + 서버→화면 + 여유
function lateBudgetMs(p) {
  return PHONE_SWING_MS + num(p.pl.rtt, 80) / 2 + displayRtt() / 2 + LATE_SLACK_MS;
}
function updatePlan(m, p, now) {
  const gt = m.clock.gt;
  if ((p.human || p.bot) && !p.cued && p.t - gt < SLOW_LEAD) {
    p.cued = true;
    // 예고만 합니다. 타점은 슬로우 때문에 아직 약 1.2초(실제) 뒤입니다. '지금!'은 아래에서 따로 보냅니다.
    if (p.human) send('cue', { kind: p.kind === 'serve' ? 'serve' : 'incoming', stage: 'soon', hand: p.hand }, p.pl.slot);
    if (!m.demo) sfx.slow();
    // 사람 차례: 백스윙 자세로 기다립니다.
    if (p.kind !== 'serve' && (!p.pl.stroke || gt > p.pl.stroke.tContact + 0.3)) {
      p.pl.pending = null;
      p.pl.stroke = { type: p.hand, spin: 'none', tPrep: gt, tFwd: Infinity, tHold: Math.max(gt + 0.08, p.t - 0.22), tContact: p.t };
    }
  }
  // 폰의 '지금!': 타점까지 실제로 남은 시간이 반응 시간 + 화면→서버→폰 전달 시간 안으로 들어오면 보냅니다.
  if (p.human && p.cued && !p.nowCued) {
    const lead = NOW_LEAD_MS + displayRtt() / 2 + num(p.pl.rtt, 80) / 2;
    if (realMsUntil(m, p.t - gt) <= lead) {
      p.nowCued = true;
      send('cue', { kind: p.kind === 'serve' ? 'serve' : 'incoming', stage: 'now', hand: p.hand }, p.pl.slot);
    }
  }
  if (p.botAt != null && gt >= p.botAt) {
    p.botAt = null;
    const b = p.botSwing;
    onSwing({ slot: p.pl.slot, power: b.power, ago: 0, rtt: 0, spin: b.spin, spinAmt: b.spinAmt, aim: b.aim, hand: p.hand }, true);
    if (p.decided || m.plan !== p) return;
  }
  if (p.auto && gt >= p.t) {
    p.decided = true;
    if (p.cpuMiss) onMiss(m, p, 'none');
    else doHit(m, p.pl, { ...p.cpuSwing, hand: p.hand }, p.t, p);
    return;
  }
  if (p.swing && gt >= p.t) {
    // 폰 스윙은 타점에 맞춰 휘둘러도 감지 뒤 모으는 시간과 전달 시간만큼 늦게 도착합니다.
    // 먼저 잡힌 스윙(테이크백일 때가 많음)을 바로 확정하지 않고 그만큼 기다립니다. 그동안 onSwing 이 더 나은 스윙으로 바꿉니다.
    if (!p.swing.local) {
      if (p.confirmReal == null) p.confirmReal = now + lateBudgetMs(p);
      if (now < p.confirmReal) return;
    }
    p.decided = true;
    doHit(m, p.pl, p.swing, p.t, p);
    return;
  }
  if ((p.human || p.bot) && gt >= p.t + p.window) {
    if (p.closeReal == null) p.closeReal = now + (p.human ? lateBudgetMs(p) : 0);
    else if (now >= p.closeReal) {
      p.decided = true;
      onMiss(m, p, p.early ? 'early' : 'none');
    }
  }
}

// ---------- 스윙(폰·봇·키보드 모두 이 길) ----------
function readSwing(d) {
  return {
    power: clamp(num(d.power, 0.6), 0, 1),
    // 만점을 넘긴 만큼(너무 세게). 0 이면 보정 안에서 칩니다.
    over: clamp(num(d.raw, 0) - OVER_RAW, 0, 2) > 0 ? clamp(num(d.raw, 0) - OVER_RAW, 0, 2) + 0.1 : 0,
    spin: d.spin === 'top' || d.spin === 'slice' ? d.spin : 'none',
    spinAmt: clamp(num(d.spinAmt, 0.6), 0, 1),
    aim: clamp(num(d.aim, 0), -45, 45),
    hand: d.hand === 'back' ? 'back' : d.hand === 'fore' ? 'fore' : null
  };
}
function onSwing(d, local) {
  if (!d) return;
  const m = game.match;
  if (game.phase !== 'playing' || !m) return;
  const pl = plBySlot(Number(d.slot));
  if (!pl) return;
  if (pl.bot && !local) return; // 봇 자리에 나중에 들어온 폰은 무시
  if (!local) pl.rtt = num(d.rtt, 80); // '지금!' 신호를 앞당길 때 씁니다
  const now = nowMs();
  // 폰에서 휘두른 순간 = 도착 시각 − 센서 측정 시간 − 폰 왕복/2 − 화면 왕복/2
  const lag = local ? 0 : num(d.ago, 0) + num(d.rtt, 80) / 2 + displayRtt() / 2;
  const G = toGame(m, now - lag);
  const sw = readSwing(d);
  const p = m.plan;
  const gt = m.clock.gt;
  if (!p || p.pl !== pl || p.decided || (m.state !== 'toss' && m.state !== 'rally')) {
    practiceSwing(m, pl, sw);
    return;
  }
  const err = G - p.t;
  // 슬로우가 걸리기 훨씬 전의 스윙은 연습 스윙으로 봅니다.
  if (err < -(SLOW_LEAD + 0.12)) {
    practiceSwing(m, pl, sw);
    return;
  }
  // 창보다 이른 스윙(라켓을 뒤로 빼는 테이크백일 때가 많음)은 판정하지 않고 계속 기다립니다.
  // 창이 닫힐 때까지 다른 스윙이 없으면 그때 '빨라요'로 알려 줍니다.
  if (err < -p.window) {
    p.early = true;
    return;
  }
  // 창 안에서 먼저 받은 스윙이 있으면, 타점에 더 가깝고 힘이 크게 모자라지 않은 스윙으로만 바꿉니다(테이크백 → 앞스윙).
  // 폰 스윙은 타점이 지나도 도착 시간만큼 확정을 미루므로(updatePlan), 그 사이 도착한 앞스윙으로도 바꿉니다.
  const prev = p.swing;
  if (prev && !(Math.abs(err) <= p.window && Math.abs(err) < Math.abs(prev.err) && sw.power >= prev.power * 0.7)) return;
  const type = p.kind === 'serve' ? 'serve' : sw.hand || p.hand;
  sw.hand = type === 'serve' ? 'fore' : type;
  if (Math.abs(err) <= p.window) {
    p.swing = { ...sw, err, q: 1 - Math.abs(err) / p.window, local: Boolean(local) };
    if (type !== 'serve' && type !== p.hand) p.hand = type; // 폰이 정한 손으로(몸이 반대쪽으로 빠르게 비킵니다)
    const late = gt >= p.t;
    const lead = type === 'serve' ? 0.12 : 0.22;
    const ns = {
      type, spin: sw.spin,
      tPrep: pl.stroke ? pl.stroke.tPrep : gt - 0.3,
      tFwd: late ? gt - 0.05 : Math.max(gt, p.t - lead),
      tHold: p.t - lead,
      tContact: late ? gt : p.t
    };
    pl.pending = null;
    // 같은 손이면 이어서(백스윙 → 앞스윙), 손이 바뀌면 새 동작으로 섞어 바꿉니다.
    // 스윙을 바꿀 때 같은 손이면 이미 잡힌 동작 시각은 그대로 두고 스핀만 바꿉니다(자세가 튀지 않게).
    if (pl.stroke && pl.stroke.type === type) Object.assign(pl.stroke, prev ? { spin: sw.spin } : ns);
    else pl.stroke = ns;
    if (late) {
      p.decided = true;
      doHit(m, pl, p.swing, clamp(G, p.t, gt), p);
    }
  } else {
    p.decided = true;
    pl.pending = null;
    pl.stroke = { type, spin: sw.spin, tPrep: gt - 0.3, tFwd: gt, tHold: gt, tContact: gt + 0.16 };
    onMiss(m, p, err < 0 ? 'early' : 'late');
  }
}
function practiceSwing(m, pl, sw) {
  const gt = m.clock.gt;
  if (pl.stroke && gt < pl.stroke.tContact + 0.6) return;
  if (m.plan && m.plan.pl === pl && !m.plan.decided) return;
  if (m.state === 'intro' || m.state === 'toss') return; // 서브 준비 중에는 자세를 흐트러뜨리지 않습니다
  pl.stroke = { type: sw.hand || 'fore', spin: sw.spin, tPrep: gt - 0.2, tFwd: gt, tHold: gt, tContact: gt + 0.2 };
}

function onMiss(m, p, why) {
  const pl = p.pl;
  const now = nowMs();
  if (!m.demo && pl.kind === 'human') {
    const t = why === 'early' ? '빨라요' : why === 'late' ? '늦어요' : '';
    if (p.kind === 'serve') hitPop(pl, why === 'none' ? '토스 놓침' : '헛스윙', why === 'none' ? '다시 올려요' : t, 'miss');
    else hitPop(pl, why === 'none' ? '놓쳤어요' : '헛스윙', t, 'miss');
    if (p.human) send('result', { text: why === 'none' ? (p.kind === 'serve' ? '토스를 놓쳤어요' : '놓쳤어요') : `헛스윙 · ${t}`, good: false }, pl.slot);
    sfx.whiff();
  }
  if (m.state === 'toss') {
    // 토스를 놓치면 한 번은 다시 올리고, 두 번째는 폴트입니다.
    if (m.retoss < 1) {
      m.retoss += 1;
      m.state = 'pause';
      m.plan = null;
      m.waitReal = now + 1300;
      m.next = () => {
        m.state = 'intro';
        m.waitReal = nowMs() + 300;
        pl.stroke = null;
      };
    } else {
      m.retoss = 0;
      fault(m, 'miss');
    }
  }
}

// ---------- 타구 ----------
function doHit(m, pl, sw, th, p) {
  const serve = p.kind === 'serve';
  const st = sampleFlight(m.flight, th);
  const end = endOf(m, pl.team);
  // 압박받으며 친 공은 정확도가 떨어집니다(강요된 실수).
  const qEff = sw.q * (1 - 0.45 * (p.pressure || 0));
  game.debug.pressures.push(+(p.pressure || 0).toFixed(2));
  if (game.debug.pressures.length > 400) game.debug.pressures.shift();
  const shot = aimShot({
    end, p: st.p, q: qEff, err: sw.err, window: WINDOW, power: sw.power, aim: sw.aim, spin: sw.spin, spinAmt: sw.spinAmt,
    hand: sw.hand, over: sw.over || 0, serve, box: m.box, second: m.serveNo === 2, doubles: m.doubles
  });
  m.flight = simulate(st.p, shot.v, shot.w, { t0: th });
  m.evIdx = 0;
  m.state = 'rally';
  m.rally = { hitTeam: pl.team, hitter: pl, serve, phase: 'out', let: false };
  m.plan = null;
  m.retoss = 0;
  m.rallyLen += 1;
  m.lastShot = { pl, kind: shot.kind, outcome: shot.outcome, speed: shot.speed, serve, hand: serve ? 'serve' : sw.hand };
  if (serve && !m.demo) prompt('', '');
  pl.stats.hits += 1;
  if (serve) pl.stats.topServe = Math.max(pl.stats.topServe, shot.speed);
  else pl.stats.topShot = Math.max(pl.stats.topShot, shot.speed);
  if (pl.stroke) pl.stroke.spin = serve ? (shot.kind === 'kick' ? 'top' : shot.kind === 'sslice' ? 'slice' : 'none') : shot.kind;
  // 받는 쪽 타점은 미리 계산합니다(비행이 정해져 있어 예측과 실제가 같습니다).
  const recvTeam = 1 - pl.team;
  const recvEnd = endOf(m, recvTeam);
  const first = m.flight.events.find((e) => e.type !== 'netcord');
  const landsIn = first && first.type === 'bounce' &&
    (serve ? inBox(first.x, first.z, recvEnd, m.box) : inCourt(first.x, first.z, recvEnd, m.doubles));
  if (landsIn) {
    const pc = planContact(m.flight, recvEnd, 0);
    if (pc) {
      const team = m.teams[recvTeam].players;
      let who = serve ? m.receiver : team[0];
      if (!serve && team.length > 1) who = pc.p[0] * rightOf(recvEnd) >= 0 ? team[0] : team[1];
      // 압박: 공 속도, 받는 사람이 뛰어야 하는 거리, 회전, 친 사람의 타이밍, 긴 랠리의 피로
      const spd = clamp((shot.speed - (serve ? 30 : 20)) / (serve ? 22 : 18), 0, 1);
      const body = bodyForContact(m, who, pc.p, handFor(m, who, pc.p));
      const run = clamp((Math.hypot(body[0] - who.x, body[1] - who.z) - 1.2) / 4.5, 0, 1);
      const spin = shot.kind === 'top' || shot.kind === 'slice' || shot.kind === 'kick' ? 0.15 * (sw.spinAmt ?? 0.6) : 0;
      const pressure = clamp(0.42 * spd + 0.28 * run + spin + 0.28 * (sw.q - 0.55) + 0.035 * Math.max(0, m.rallyLen - 5), 0, 1);
      setPlan(m, who, pc, 'ground', pressure);
    }
  }
  view.flash([st.p[0], st.p[1], st.p[2]], sw.q > 0.85);
  if (!m.demo) {
    const slow = m.clock.scale < 0.6;
    if (serve) sfx.serve(sw.q, slow, sw.power);
    else sfx.hit(sw.q, slow, sw.power);
    const kmh = Math.round(shot.speed * 3.6);
    const spinName = SPIN_NAME[shot.kind] || '';
    showSpeed(serve ? `${pl.name} · ${spinName}` : `${pl.name} · ${HAND_NAME[sw.hand]} ${spinName}`, kmh, pl.color);
  }
  if (pl.kind === 'human' && !m.demo && !isAuto(pl)) {
    const e = Math.abs(sw.err);
    const qLabel = e <= PERFECT ? 'PERFECT' : e <= GOOD ? 'GOOD' : sw.err < 0 ? '빨라요' : '늦어요';
    if (e <= PERFECT) pl.stats.perfect += 1;
    const label = serve ? SPIN_NAME[shot.kind] : `${HAND_NAME[sw.hand]} ${shot.kind === 'top' ? '탑스핀!' : shot.kind === 'slice' ? '슬라이스' : '플랫'}`;
    const cls = e <= PERFECT ? 'perfect' : e <= GOOD ? 'good' : 'meh';
    if (sw.over) hitPop(pl, '홈런!', '너무 세요', 'miss');
    else hitPop(pl, qLabel, label, `${cls} ${shot.kind}`);
    if (!pl.bot) send('result', { text: `${qLabel} · ${label}`, good: e <= GOOD, kmh: Math.round(shot.speed * 3.6) }, pl.slot);
  }
  // 받는 쪽에 들어오는 스핀 예고
  const rp = m.plan && m.plan.pl;
  if (rp && !m.demo && rp.kind === 'human' && (shot.kind === 'top' || shot.kind === 'slice' || shot.kind === 'kick')) {
    hudNote(`${rp.name} · ${shot.kind === 'slice' ? '낮게 깔리는 슬라이스가 와요' : '높이 튀는 탑스핀이 와요'}`, 1100);
  }
}

// ---------- 규칙 ----------
function processEvents(m, upto, rules) {
  if (!m.flight) return;
  const evs = m.flight.events;
  while (m.evIdx < evs.length && evs[m.evIdx].t <= upto) {
    const e = evs[m.evIdx++];
    playEventSound(m, e);
    if (rules && m.state === 'rally') onEvent(m, e);
  }
}
function playEventSound(m, e) {
  if (m.demo) return;
  if (e.type === 'bounce') sfx.bounce(1);
  else if (e.type === 'net' || e.type === 'netcord') sfx.net();
  else if (e.type === 'wall') sfx.wall();
}
function onEvent(m, e) {
  const r = m.rally;
  if (!r) return;
  const recvTeam = 1 - r.hitTeam;
  const recvEnd = endOf(m, recvTeam);
  if (e.type === 'netcord') {
    if (r.serve && r.phase === 'out') r.let = true;
    return;
  }
  if (e.type === 'net') {
    if (r.serve) fault(m, 'net');
    else point(m, recvTeam, 'net');
    return;
  }
  if (e.type === 'bounce') {
    if (r.phase === 'out') {
      const ok = r.serve ? inBox(e.x, e.z, recvEnd, m.box) : inCourt(e.x, e.z, recvEnd, m.doubles);
      view.mark(e.x, e.z, ok ? null : '#ff4d4d');
      if (ok && r.serve && r.let) {
        letServe(m);
        return;
      }
      if (ok) r.phase = 'in';
      else if (r.serve) fault(m, Math.abs(e.z) > COURT.svc ? 'long' : 'wide');
      else point(m, recvTeam, 'out');
    } else {
      // 받는 쪽에서 두 번 튀었으면 친 쪽 득점
      point(m, r.hitTeam, r.serve && m.rallyLen === 1 ? 'ace' : 'winner');
    }
    return;
  }
  if (e.type === 'wall') {
    if (r.phase === 'out') {
      if (r.serve) fault(m, 'long');
      else point(m, recvTeam, 'out');
    } else point(m, r.hitTeam, r.serve && m.rallyLen === 1 ? 'ace' : 'winner');
  }
}

function pause(m, ms, next) {
  m.state = 'pause';
  m.plan = null;
  m.waitReal = nowMs() + ms;
  m.next = next;
}
function fault(m, why) {
  if (m.state === 'pause' || m.state === 'point' || m.state === 'over') return;
  const sv = m.server;
  if (m.serveNo === 1) {
    if (!m.demo) {
      sfx.call('fault');
      call('폴트', { net: '네트', long: '길어요', wide: '옆으로 나갔어요', miss: '토스 실패' }[why] || '', 'miss', 1500);
      if (sv.kind === 'human' && !sv.bot) send('result', { text: '폴트 · 세컨드 서브', good: false }, sv.slot);
    }
    pause(m, 1500, () => {
      m.serveNo = 2;
      prepareServe(m);
    });
    return;
  }
  sv.stats.dfaults += 1;
  point(m, 1 - m.serveTeam, 'double');
}
function letServe(m) {
  if (!m.demo) {
    sfx.call('let');
    call('렛', '네트에 스쳤어요 · 다시 서브', 'miss', 1400);
  }
  pause(m, 1500, () => prepareServe(m));
}

const REASON = {
  out: ['아웃', '상대 공이 아웃'],
  net: ['네트', '상대 공이 네트에 걸렸어요'],
  winner: ['못 받았어요', '위너!'],
  ace: ['에이스를 맞았어요', '에이스!'],
  double: ['더블 폴트', '상대 더블 폴트'],
  missed: ['못 받았어요', '상대가 못 받았어요']
};
function pointLabels(a, b) {
  if (a >= 3 && b >= 3) {
    if (a === b) return ['40', '40'];
    return a > b ? ['AD', '40'] : ['40', 'AD'];
  }
  const L = ['0', '15', '30', '40'];
  return [L[Math.min(a, 3)], L[Math.min(b, 3)]];
}
function statusCall(m) {
  const [a, b] = m.points;
  for (const t of [0, 1]) {
    const me = m.points[t];
    const op = m.points[1 - t];
    if (me >= 3 && me - op >= 1) {
      if (m.games[t] === GAMES_TO_WIN - 1) return { text: '매치 포인트', team: t };
      return { text: t === m.serveTeam ? '게임 포인트' : '브레이크 포인트', team: t };
    }
  }
  if (a >= 3 && a === b) return { text: '듀스', team: null };
  return null;
}
function teamName(m, t) {
  return m.teams[t].players.map((p) => p.name).join('·');
}

function point(m, team, why) {
  if (m.state === 'point' || m.state === 'over' || m.state === 'pause') return;
  const now = nowMs();
  m.points[team] += 1;
  m.plan = null;
  m.state = 'point';
  m.waitReal = now + 2000;
  const r = m.rally;
  // 기록
  if (r && r.hitter && team === r.hitTeam && (why === 'winner' || why === 'ace')) {
    r.hitter.stats.winners += 1;
    if (why === 'ace') r.hitter.stats.aces += 1;
  }
  let gameOver = false;
  const [a, b] = [m.points[team], m.points[1 - team]];
  if (a >= 4 && a - b >= 2) {
    m.games[team] += 1;
    gameOver = true;
    m.gameJust = team;
    if (m.games[team] >= GAMES_TO_WIN) m.winner = team;
  }
  game.log.push(`${teamName(m, team)} ${why} ${m.points.join('-')} g${m.games.join('-')}`);
  game.debug.rallies.push(m.rallyLen);
  if (game.debug.rallies.length > 200) game.debug.rallies.shift();
  if (game.log.length > 80) game.log.shift();
  if (m.demo) return;
  if (why === 'out') sfx.call('out');
  const humanWon = m.teams[team].players.some((p) => p.kind === 'human');
  const labels = pointLabels(m.points[0], m.points[1]);
  const big = why === 'ace' ? '에이스!' : why === 'double' ? '더블 폴트' : why === 'out' ? '아웃' : why === 'net' ? '네트' : '위너!';
  const sub = gameOver
    ? (m.winner != null ? `${teamName(m, team)} 승리` : `${teamName(m, team)} 게임 · ${m.games[0]} : ${m.games[1]}`)
    : `${teamName(m, team)} 득점 · ${labels[0]} - ${labels[1]}`;
  call(gameOver ? (m.winner != null ? 'GAME, SET' : 'GAME') : big, gameOver ? `${big} · ${sub}` : sub,
    gameOver ? 'game' : why === 'ace' || why === 'winner' ? 'win' : 'miss', 2100, m.teams[team].players[0].color);
  for (const t of [0, 1]) {
    for (const pl of m.teams[t].players) {
      if (pl.kind !== 'human' || pl.bot) continue;
      const good = t === team;
      const me = m.points[t];
      const op = m.points[1 - t];
      const lab = pointLabels(me, op);
      const reason = REASON[why] ? REASON[why][good ? 1 : 0] : '';
      const txt = gameOver
        ? `${good ? '게임 획득!' : '게임 내줌'} ${m.games[t]} : ${m.games[1 - t]}`
        : `${good ? '득점!' : '실점'} · ${reason} ${lab[0]}-${lab[1]}`;
      send('result', { text: txt, good }, pl.slot);
    }
  }
  sfx.point(humanWon);
  sfx.cheer(gameOver || why === 'ace' || m.rallyLen >= 5);
  renderBug(true);
  pushState();
}

function afterPoint(m) {
  if (m.winner != null) {
    finishMatch(m);
    return;
  }
  if (m.gameJust != null) {
    m.gameJust = null;
    m.points = [0, 0];
    m.serveNo = 1;
    m.serverIdx[m.serveTeam] += 1;
    m.serveTeam = 1 - m.serveTeam;
    // 홀수 게임이 끝나면 코트를 바꿉니다(양 팀 모두 사람이 있을 때. CPU 와 칠 때는 사람이 늘 앞쪽).
    if ((m.games[0] + m.games[1]) % 2 === 1 && (m.demo || bothHuman(m))) {
      changeEnds(m);
      return;
    }
  }
  m.serveNo = 1;
  prepareServe(m);
}
function changeEnds(m) {
  const now = nowMs();
  m.state = 'change';
  m.waitReal = now + 2600;
  m.swapAt = now + (m.demo ? 0 : 800); // 화면이 어두워진 사이에 자리를 바꿉니다
  m.swapped = false;
  if (!m.demo) {
    sfx.change();
    call('코트 체인지', '양쪽이 자리를 바꿔요', 'game', 2200);
    $('fade').classList.add('on');
    setTimeout(() => $('fade').classList.remove('on'), 1500);
  }
  m.next = () => {
    m.serveNo = 1;
    prepareServe(m);
  };
}
function swapEnds(m) {
  m.swapped = true;
  for (const t of m.teams) t.end = 1 - t.end;
  m.serveNo = 1;
  prepareServe(m, true, true);
  placeForServe(m, true);
  m.flight = null;
}

function finishMatch(m) {
  m.state = 'over';
  m.plan = null;
  if (m.demo) {
    m.overAt = nowMs();
    return;
  }
  const w = m.winner;
  call('GAME, SET, MATCH', `${teamName(m, w)} 승리 · ${m.games[w]} : ${m.games[1 - w]}`, 'game', 3200, m.teams[w].players[0].color);
  if (m.teams[w].players.some((p) => p.kind === 'human')) sfx.win();
  sfx.cheer(true);
  game.overAt = nowMs() + 3600;
  pushState();
}

// ================================================================
// 선수 이동·동작
// ================================================================
function updatePlayers(m, dtG, gt, now) {
  const p = m.plan;
  for (const pl of allPlayers(m)) {
    const end = endOf(m, pl.team);
    let target = pl.home || homePos(m, pl);
    let need = null; // 도착까지 남은 경기 시간
    if (p && p.pl === pl && !p.decided && p.kind !== 'serve') {
      target = bodyForContact(m, pl, p.p, pl.stroke && pl.stroke.type !== 'serve' ? pl.stroke.type : p.hand);
      need = p.t - gt;
      pl.dy = p.p[1] - C_OFF[p.hand === 'back' ? 'back' : 'fore'][1];
    } else if (m.state === 'rally' && p && p.pl !== pl && p.pl.team === pl.team) {
      // 파트너는 자기 레인을 지킵니다.
      target = homePos(m, pl);
    } else if (m.state === 'rally' && m.rally && m.rally.hitTeam === pl.team && !(p && p.pl === pl)) {
      // 친 뒤에는 베이스라인 가운데(자기 레인)로 돌아갑니다.
      target = homePos(m, pl);
    }
    const dx = target[0] - pl.x;
    const dz = target[1] - pl.z;
    const d = Math.hypot(dx, dz);
    let speed = 0;
    if (d > 0.01) {
      let vmax = 5.2;
      if (need != null) vmax = Math.max(5.2, d / Math.max(0.06, need - 0.06));
      vmax = Math.min(vmax, 14);
      const stepLen = Math.min(d, vmax * dtG, d * (1 - Math.exp(-dtG / 0.06)) + vmax * dtG * 0.5);
      pl.x += (dx / d) * stepLen;
      pl.z += (dz / d) * stepLen;
      speed = dtG > 0 ? stepLen / dtG : 0;
      const l = toLocal(end, [dx / d, 0, dz / d]);
      pl.lx += (l[0] - pl.lx) * 0.3;
      pl.lz += (l[2] - pl.lz) * 0.3;
      pl.phase += (stepLen / 1.7) * Math.PI * 2;
    }
    pl.speed += (speed - pl.speed) * clamp(dtG / 0.08, 0, 1);
    // 끝난 스트로크 정리, 예약된 스트로크 시작
    if (pl.stroke && gt > pl.stroke.tContact + (pl.stroke.type === 'serve' ? 1.0 : 0.8)) pl.stroke = null;
    if (pl.pending && gt >= pl.pending.tPrep) {
      pl.stroke = pl.pending;
      pl.pending = null;
    }
    // 폰 자세 따라 하기(스트로크 중이 아닐 때)
    let mirror = null;
    if (!pl.stroke && pl.kind === 'human' && !pl.bot) {
      const ps = game.poses[pl.slot];
      if (ps && now - ps.at < 700) mirror = { dir: [-ps.s[0], ps.s[1], ps.s[2]], face: [-ps.fc[0], ps.fc[1], ps.fc[2]] };
    }
    let pose = athletePose({
      stroke: pl.stroke, gt, now: now / 1000, dy: pl.stroke && pl.stroke.type !== 'serve' ? pl.dy : 0,
      move: { lx: pl.lx, lz: pl.lz, speed: pl.speed, phase: pl.phase }, mirror
    });
    // 동작이 바뀌는 순간(스트로크 시작·손 바꿈·폰 자세 켜짐)은 짧게 섞어 튀지 않게 합니다.
    const sig = pl.stroke ? pl.stroke : mirror ? 'mirror' : 'ready';
    if (sig !== pl.sig) {
      if (pl.pose) {
        pl.blendFrom = pl.pose;
        pl.blendT = now;
      }
      pl.sig = sig;
    }
    if (pl.blendFrom) {
      const u = clamp((now - pl.blendT) / 110, 0, 1);
      pose = blendPose(pl.blendFrom, pose, u * u * (3 - 2 * u));
      if (u >= 1) pl.blendFrom = null;
    }
    pl.pose = pose;
    view.poseAthlete(pl.key, pl.x, pl.z, end === 0 ? Math.PI : 0, pl.pose, true);
  }
}

// ================================================================
// 폰 자세·준비
// ================================================================
function onPose(d) {
  if (!d || !Array.isArray(d.s) || !Array.isArray(d.fc) || d.s.length < 3 || d.fc.length < 3) return;
  const s = d.s.map((x) => num(x, 0));
  const fc = d.fc.map((x) => num(x, 0));
  if (Math.hypot(...s) < 1e-3 || Math.hypot(...fc) < 1e-3) return;
  game.poses[d.slot] = { s, fc, at: nowMs() };
}
function onCalibrate(d) {
  const slot = Number(d && d.slot);
  if (!SLOT_INFO[slot]) return;
  delete game.poses[slot];
  game.ready.add(slot);
  if (game.phase === 'playing') hudNote(`${slot}P 라켓 자세 맞춤`, 1400);
  renderLobby();
}

// ================================================================
// 경기 시작·끝
// ================================================================
function startDemo() {
  game.demo = newMatch([{ slot: 1 }, { slot: 2 }], true);
  syncAthletes(game.demo);
}
function syncAthletes(m) {
  view.setAthletes(allPlayers(m).map((p) => ({ key: p.key, color: p.color, slot: p.slot, cpu: p.kind === 'cpu' && !m.demo, label: p.name })));
}

function startGame() {
  if (game.phase === 'playing') return;
  const list = lobbyPlayers().filter((p) => p.connected);
  if (!list.length) {
    lobbyMessage('폰을 먼저 연결해 주세요. QR을 찍고 시작하기를 누르면 자리가 생겨요.');
    return;
  }
  audio();
  crowd(0.035, 1.5);
  const m = newMatch(list, false);
  game.match = m;
  game.demo = null;
  game.humans = allPlayers(m).filter((p) => p.kind === 'human');
  game.phase = 'playing';
  game.overAt = 0;
  game.allGoneSince = null;
  syncAthletes(m);
  $('lobby').classList.add('hidden');
  $('over').classList.add('hidden');
  clearOverlays();
  $('hud').classList.remove('hidden');
  $('join').classList.remove('hidden');
  renderBug(true);
  call('TENNIS', `${teamName(m, 0)} 대 ${teamName(m, 1)} · ${GAMES_TO_WIN}게임 선승`, 'game', 2300, m.teams[0].players[0].color);
  sfx.win();
  prepareServe(m, true);
  pushState();
}

function endGame() {
  const m = game.match;
  game.phase = 'over';
  game.overAt = 0;
  const rows = [];
  for (const t of [0, 1]) {
    for (const pl of m.teams[t].players) {
      if (pl.kind !== 'human') continue;
      rows.push({ pl, win: m.winner === t, me: m.games[t], op: m.games[1 - t], opp: teamName(m, 1 - t), mates: m.teams[t].players.filter((x) => x !== pl).map((x) => x.name) });
    }
  }
  rows.sort((a, b) => (b.win - a.win) || (b.pl.stats.winners - a.pl.stats.winners) || (b.pl.stats.perfect - a.pl.stats.perfect));
  const box = $('podium');
  box.innerHTML = '';
  rows.forEach((r, i) => {
    const e = document.createElement('div');
    e.className = 'r' + (r.win ? ' win' : '');
    e.style.setProperty('--c', r.pl.color);
    e.style.animationDelay = `${0.15 + i * 0.12}s`;
    const s = r.pl.stats;
    const serve = s.topServe ? `${Math.round(s.topServe * 3.6)}` : '-';
    e.innerHTML = `<span class="rank">${i + 1}</span><span class="who">${esc(r.pl.name)}${r.mates.length ? `<small>with ${esc(r.mates.join('·'))}</small>` : ''}</span>` +
      `<span class="res">${r.win ? '승' : '패'}</span>` +
      `<span class="num"><b>${r.me} : ${r.op}</b><span>vs ${esc(r.opp)}</span></span>` +
      `<span class="num"><b>${s.winners}</b><span>위너${s.aces ? ` · 에이스 ${s.aces}` : ''}</span></span>` +
      `<span class="num"><b>${s.perfect}</b><span>PERFECT</span></span>` +
      `<span class="num"><b>${serve}</b><span>최고 서브 km/h</span></span>`;
    box.appendChild(e);
  });
  $('hud').classList.add('hidden');
  $('join').classList.add('hidden');
  clearOverlays();
  $('over').classList.remove('hidden');
  sfx.clap(40);
  pushState();
}

function backToLobby(why) {
  game.phase = 'lobby';
  game.match = null;
  game.humans = [];
  $('hud').classList.add('hidden');
  $('join').classList.add('hidden');
  $('over').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  clearOverlays();
  startDemo();
  if (why) lobbyMessage(why);
  renderLobby();
  pushState();
}

function statePlayers() {
  const out = {};
  if (game.phase === 'lobby') {
    const list = lobbyPlayers().filter((p) => p.connected).slice(0, 4);
    const teams = buildTeams(list, false);
    for (const t of [0, 1]) {
      for (const pl of teams[t].players) {
        if (pl.kind !== 'human') continue;
        out[pl.slot] = {
          team: t, end: t === 0 ? 'near' : 'far', mates: teams[t].players.filter((x) => x !== pl).map((x) => x.name),
          opps: teams[1 - t].players.map((x) => x.name), games: [0, 0], points: ['0', '0'], serving: t === 0 && pl.idx === 0
        };
      }
    }
    return out;
  }
  const m = game.match;
  if (!m) return out;
  const st = statusCall(m);
  for (const t of [0, 1]) {
    for (const pl of m.teams[t].players) {
      if (pl.kind !== 'human') continue;
      const lab = pointLabels(m.points[t], m.points[1 - t]);
      out[pl.slot] = {
        team: t, end: m.teams[t].end === 0 ? 'near' : 'far',
        mates: m.teams[t].players.filter((x) => x !== pl).map((x) => x.name),
        opps: m.teams[1 - t].players.map((x) => x.name),
        games: [m.games[t], m.games[1 - t]], points: lab,
        serving: m.server === pl && m.state !== 'over', teamServing: m.serveTeam === t, serveNo: m.serveNo,
        call: st ? st.text : '', win: m.winner == null ? null : m.winner === t
      };
    }
  }
  return out;
}
function pushState() {
  send('game_state', { phase: game.phase, players: statePlayers(), toWin: GAMES_TO_WIN });
}

// ================================================================
// 대기실 화면
// ================================================================
function renderLobby() {
  const box = $('slots');
  if (!box) return;
  box.innerHTML = '';
  const list = lobbyPlayers();
  for (let s = 1; s <= 4; s++) {
    const p = list.find((x) => x.slot === s);
    const e = document.createElement('div');
    e.className = 'slot' + (p ? ' on' : '') + (p && !p.connected ? ' away' : '') + (p && (p.bot || game.ready.has(s)) ? ' ready' : '');
    if (p) {
      e.style.setProperty('--c', p.color);
      e.innerHTML = `<b>${esc(p.name)}</b><small>${p.bot ? 'BOT' : game.ready.has(s) ? '라켓 준비 완료' : '준비 대기'}</small>`;
    } else {
      e.textContent = `${s}P 비어 있음`;
    }
    box.appendChild(e);
  }
  const conn = list.filter((p) => p.connected);
  const pairs = $('pairs');
  if (!conn.length) pairs.textContent = '혼자면 CPU 와 단식, 둘이면 1P 대 2P 단식, 셋·넷이면 1P·3P 대 2P·4P 복식이에요.';
  else {
    const teams = buildTeams(conn, false);
    const nm = (t) => teams[t].players.map((p) => (p.kind === 'cpu' ? 'CPU' : p.name)).join('·');
    pairs.innerHTML = `<b>${teams[0].players.length > 1 ? '복식' : '단식'}</b> ${esc(nm(0))} <span>대</span> ${esc(nm(1))}`;
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

// ================================================================
// HUD
// ================================================================
let callTimer = null;
function call(main, sub, cls, ms, color) {
  const el = $('call');
  el.className = `call ${cls || ''}`;
  if (color) el.style.setProperty('--cc', color);
  $('callMain').textContent = main;
  $('callSub').textContent = sub || '';
  void el.offsetWidth;
  el.classList.add('on');
  clearTimeout(callTimer);
  callTimer = setTimeout(() => el.classList.remove('on'), ms || 1500);
}
function prompt(main, sub) {
  $('promptT').textContent = main;
  $('promptB').textContent = sub || '';
  $('prompt').classList.toggle('on', Boolean(main));
}
let noteTimer = null;
function hudNote(text, ms = 1600) {
  const e = $('note');
  if (!text) {
    e.classList.remove('on');
    return;
  }
  e.textContent = text;
  e.classList.remove('on');
  void e.offsetWidth;
  e.classList.add('on');
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => e.classList.remove('on'), ms);
}
// 경기 화면 위에 떠 있던 글자들을 모두 내립니다(결과·대기실로 넘어갈 때).
function clearOverlays() {
  for (const id of ['call', 'note', 'speed', 'pop']) $(id).classList.remove('on');
  clearTimeout(callTimer);
  pop.pl = null;
  prompt('', '');
  ring(null);
  slowFx(0);
}
// 친 사람 머리 위에 떠오르는 판정 글자
const pop = { pl: null, t0: 0, until: 0 };
function hitPop(pl, main, sub, cls) {
  const e = $('pop');
  e.className = `pop ${cls || ''}`;
  e.style.setProperty('--pc', pl.color);
  e.querySelector('b').textContent = main;
  e.querySelector('span').textContent = sub || '';
  void e.offsetWidth;
  e.classList.add('on');
  pop.pl = pl;
  pop.t0 = nowMs();
  pop.until = pop.t0 + 1400;
}
function updatePop(now) {
  const e = $('pop');
  if (!pop.pl) return;
  if (now > pop.until || game.phase !== 'playing') {
    e.classList.remove('on');
    pop.pl = null;
    return;
  }
  const pr = view.project([pop.pl.x, 2.15, pop.pl.z]);
  const rise = ((now - pop.t0) / 1400) * 26;
  // 먼 쪽 선수 위로 뜨면 위쪽 가운데 SLOW 표시와 겹쳐서, 아래 끝을 190px 밑으로는 올리지 않습니다.
  const y = Math.max(pr.y - rise, 190);
  e.style.transform = `translate(${pr.x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -100%)`;
}
let speedTimer = null;
function showSpeed(label, kmh, color) {
  const e = $('speed');
  $('speedL').textContent = label;
  $('speedV').textContent = kmh;
  e.style.setProperty('--sc', color || '#fff');
  e.classList.remove('on');
  void e.offsetWidth;
  e.classList.add('on');
  clearTimeout(speedTimer);
  speedTimer = setTimeout(() => e.classList.remove('on'), 2600);
}
let bugKey = '';
function renderBug(force) {
  const m = game.match;
  if (!m) return;
  const lab = pointLabels(m.points[0], m.points[1]);
  const st = statusCall(m);
  const key = JSON.stringify([m.points, m.games, m.serveTeam, m.serveNo, st && st.text, game.humans.map((p) => isAuto(p))]);
  if (!force && key === bugKey) return;
  bugKey = key;
  for (const t of [0, 1]) {
    const row = $(`row${t}`);
    const names = m.teams[t].players.map((p) =>
      `<span class="nm${isAuto(p) && p.kind === 'human' ? ' away' : ''}" style="--pc:${p.color}"><i></i>${esc(p.name)}</span>`).join('');
    row.querySelector('.names').innerHTML = names;
    row.querySelector('.srv').classList.toggle('on', m.serveTeam === t && m.state !== 'over');
    row.querySelector('.g').textContent = m.games[t];
    const pEl = row.querySelector('.p');
    if (pEl.textContent !== lab[t]) {
      pEl.textContent = lab[t];
      pEl.classList.remove('bump');
      void pEl.offsetWidth;
      pEl.classList.add('bump');
    }
    pEl.classList.toggle('ad', lab[t] === 'AD');
  }
  $('bugStatus').textContent = st ? st.text : m.serveNo === 2 ? '세컨드 서브' : '';
  $('bugStatus').classList.toggle('on', Boolean(st) || m.serveNo === 2);
  view.setBoard({
    names: [teamName(m, 0), teamName(m, 1)], colors: [m.teams[0].players[0].color, m.teams[1].players[0].color],
    games: m.games, points: lab, serve: m.serveTeam, status: st ? st.text : ''
  });
}
// 슬로우 연출(0~1)
let slowLast = -1;
function slowFx(a) {
  const v = Math.round(a * 100) / 100;
  if (v === slowLast) return;
  slowLast = v;
  $('fx').style.opacity = String(v);
  $('slowTag').classList.toggle('on', v > 0.35);
}
let ringOn = false;
function ring(r) {
  const svg = $('ring');
  if (!r) {
    if (ringOn) svg.classList.remove('on');
    ringOn = false;
    return;
  }
  ringOn = true;
  svg.classList.add('on');
  svg.classList.toggle('late', Boolean(r.after));
  svg.classList.toggle('close', r.p < 0.2);
  svg.style.setProperty('--rc', r.color);
  const set = (id, rad) => {
    const e = $(id);
    e.setAttribute('cx', r.x.toFixed(1));
    e.setAttribute('cy', r.y.toFixed(1));
    e.setAttribute('r', Math.max(1, rad).toFixed(1));
  };
  set('ringHalo', r.R);
  set('ringO', r.R);
  set('ringI', r.ball + 3);
  const tag = $('ringTag');
  tag.style.transform = `translate(${r.x.toFixed(0)}px, ${(r.y - r.R - 16).toFixed(0)}px) translate(-50%, -100%)`;
  if (tag.textContent !== r.label) tag.textContent = r.label;
}

// ================================================================
// 카메라
// ================================================================
const cam = { x: 0, look: 0, fov: 34, push: 0 };
// 당김 k(0~1)일 때 중계 카메라의 높이·거리, 보는 곳, 화각. pz 는 타점의 z 입니다.
function pushedCam(k, pz) {
  return { y: 10.2 - k * 0.7, z: 27.4 - k * 1.6, lookY: 0.2 + k * 0.5, lookZ: 2.9 + pz * 0.08 * k, fov: 35.5 - k * 3 };
}
// 바닥의 z 지점이 화면 세로 어디에 그려지는지(0 = 가운데, 1 = 아래 끝). 좌우 흔들림은 작아서 뺍니다.
function groundRow(c, z) {
  const pitch = Math.atan2(c.y - c.lookY, c.z - c.lookZ);
  const down = Math.atan2(c.y, c.z - z);
  return Math.tan(down - pitch) / Math.tan((c.fov * Math.PI) / 360);
}
// 가까운 쪽 선수가 베이스라인 뒤 깊은 곳에서 칠 때 당기면 다리가 화면 아래로 잘립니다.
// 발(zFeet)이 화면 아래 4% 위에 남는 만큼만 당깁니다.
function pushRoom(zFeet, pz) {
  for (let k = 1; k > 0.001; k -= 0.05) if (groundRow(pushedCam(k, pz), zFeet) <= 0.92) return k;
  return 0;
}
function broadcastCam(m, ballPos, dtR, now) {
  const bx = ballPos ? ballPos[0] : 0;
  cam.x += (bx * 0.2 - cam.x) * (1 - Math.exp(-dtR / 0.6));
  cam.look += (bx * 0.32 - cam.look) * (1 - Math.exp(-dtR / 0.45));
  // 사람 차례 슬로우 때 살짝 당겨 봅니다.
  const p = m.plan;
  const slowAmt = p && (p.human || p.bot) && !p.decided ? clamp((1 - m.clock.scale) / (1 - SLOW), 0, 1) : 0;
  const pushTo = slowAmt > 0 ? Math.min(slowAmt, pushRoom(p.pl.z + 0.4, p.p[2])) : 0;
  cam.push += (pushTo - cam.push) * (1 - Math.exp(-dtR / 0.25));
  let pz = 0;
  if (p && cam.push > 0.01) pz = p.p[2];
  const c = pushedCam(cam.push, pz);
  return { pos: [cam.x, c.y, c.z], look: [cam.look, c.lookY, c.lookZ], fov: c.fov, slowAmt };
}
// 높이는 관중석 뒷벽(옆 약 11.2m, 뒤 약 12.2m)과 모서리 조명탑 너머로 코트 가운데·양 베이스라인이
// 모든 각도에서 보이게 잡았습니다(위아래 흔들림 ±1.4m 포함, 레이캐스트로 확인).
// 1인칭: 화면의 첫 사람 선수 눈높이에서, 공 쪽으로 고개를 돌립니다. 몸은 숨기고 라켓만 보입니다.
const fp = { look: null, key: null };
function eyePlayer(m) {
  return allPlayers(m).find((p) => p.kind === 'human' && (!p.bot || params.has('fpbot'))) || null;
}
function firstPersonCam(m, ballPos, dtR) {
  const pl = eyePlayer(m);
  if (!pl) return null;
  const end = endOf(m, pl.team);
  const F = fwdOf(end);
  const pos = [pl.x, 1.62, pl.z - F * 0.35];
  // 기본은 상대 코트 가운데, 공이 보이면 공 쪽으로 70% 돌립니다.
  const base = [pl.x * 0.3, 0.9, F * 9];
  let want = base;
  if (ballPos && (ballPos[2] - pl.z) * F > 0.6) want = base.map((b, i) => b + (ballPos[i] - b) * 0.7);
  if (!fp.look || fp.key !== pl.key) fp.look = want.slice();
  const k = 1 - Math.exp(-dtR / 0.18);
  for (let i = 0; i < 3; i++) fp.look[i] += (want[i] - fp.look[i]) * k;
  fp.key = pl.key;
  const p = m.plan;
  const slowAmt = p && p.pl === pl && !p.decided ? clamp((1 - m.clock.scale) / (1 - SLOW), 0, 1) : 0;
  return { pos, look: fp.look.slice(), fov: 62 - 6 * slowAmt, slowAmt, key: pl.key };
}
function orbitCam(now, r = 31, h = 18) {
  const a = (now / 1000) * 0.055 + 0.6;
  return { pos: [Math.sin(a) * r, h + Math.sin(a * 0.7) * 1.4, Math.cos(a) * r], look: [0, 0.6, 0], fov: 42 };
}

// ================================================================
// 매 프레임
// ================================================================
const trailBuf = [];
const _st = { p: [0, 0, 0], v: [0, 0, 0], w: [0, 0, 0] };
function updateMatch(m, now, dtR) {
  const c = m.clock;
  const target = slowTarget(m);
  const tau = target < c.scale ? SLOW_TAU : 0.12;
  c.scale += (target - c.scale) * (1 - Math.exp(-dtR / tau));
  if (Math.abs(c.scale - target) < 0.003) c.scale = target;
  const dtG = dtR * c.scale;
  c.gt += dtG;
  c.hist.push([now, c.gt]);
  while (c.hist.length > 2 && now - c.hist[0][0] > 6000) c.hist.shift();

  if (m.state === 'intro') {
    if (now >= m.waitReal) startToss(m);
  } else if (m.state === 'toss' || m.state === 'rally') {
    const p = m.plan;
    const upto = p && !p.decided ? Math.min(c.gt, p.t) : c.gt;
    if (m.state === 'rally') processEvents(m, upto, true);
    if (m.plan && !m.plan.decided && (m.state === 'toss' || m.state === 'rally')) updatePlan(m, m.plan, now);
    if (m.state === 'rally' && (!m.plan || m.plan.decided)) processEvents(m, c.gt, true);
    // 아무 일 없이 비행이 끝났으면(드묾) 마지막 상태로 판정합니다.
    if (m.state === 'rally' && m.flight && c.gt > flightEnd(m.flight) + 0.2 && (!m.plan || m.plan.decided)) {
      const r = m.rally;
      if (r) {
        if (r.phase === 'out') {
          if (r.serve) fault(m, 'long');
          else point(m, 1 - r.hitTeam, 'out');
        } else point(m, r.hitTeam, 'winner');
      }
    }
  } else if (m.state === 'pause') {
    processEvents(m, c.gt, false);
    if (now >= m.waitReal) {
      const f = m.next;
      m.next = null;
      if (f) f();
    }
  } else if (m.state === 'point') {
    processEvents(m, c.gt, false);
    if (now >= m.waitReal) afterPoint(m);
  } else if (m.state === 'change') {
    if (!m.swapped && now >= m.swapAt) swapEnds(m);
    if (now >= m.waitReal && m.next) {
      const f = m.next;
      m.next = null;
      f();
    }
  } else if (m.state === 'over' && m.demo && now - m.overAt > 3000) {
    startDemo();
    return;
  }
  updatePlayers(m, dtG, c.gt, now);

  // 공
  let ball = null;
  const showFlight = m.flight && m.state !== 'over' && m.state !== 'change' && m.state !== 'intro' &&
    c.gt >= m.flight.t0 - 0.3 && c.gt <= flightEnd(m.flight) + 0.4;
  if (showFlight && c.gt >= m.flight.t0) {
    sampleFlight(m.flight, c.gt, _st);
    trailBuf.length = 0;
    const span = 0.09;
    const t0 = Math.max(m.flight.t0, c.gt - span);
    const N = 16;
    for (let i = 0; i < N; i++) {
      const t = t0 + ((c.gt - t0) * i) / (N - 1);
      const s = sampleFlight(m.flight, t);
      trailBuf.push([s.p[0], s.p[1], s.p[2]]);
    }
    const w = _st.w;
    const wm = Math.hypot(w[0], w[1], w[2]);
    ball = { pos: _st.p.slice(), trail: m.state === 'toss' ? [] : trailBuf.slice(), spinAxis: w, spinAngle: wm * dtG * 0.25 };
  } else if (m.state === 'intro' || (m.state === 'toss' && m.flight && c.gt < m.flight.t0)) {
    // 토스 전: 서버 왼손에 공
    const sv = m.server;
    if (sv && sv.pose) {
      const hl = toWorld(endOf(m, sv.team), sv.pose.handL);
      ball = { pos: [sv.x + hl[0], hl[1] + 0.05, sv.z + hl[2]], trail: [] };
    }
  }
  view.setBall(ball);
  return ball;
}

let last = nowMs();
function tick() {
  if (game.paused) {
    // 시험용 일시 정지: 시계를 멈춘 채 같은 장면만 다시 그립니다.
    timeShift -= performance.now() + timeShift - last;
    if (game.camOverride) view.setCamera(game.camOverride);
    view.render();
    requestAnimationFrame(tick);
    return;
  }
  const now = nowMs();
  const dtR = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  frame(now, dtR, true);
  requestAnimationFrame(tick);
}
// 시험용 빨리 감기: 화면을 그리지 않고 경기 시계를 sec 초만큼 진행합니다(백그라운드 탭에서도 동작).
function fastForward(sec, step = 1 / 30, draw = false) {
  const n = Math.ceil(sec / step);
  for (let i = 0; i < n; i++) {
    timeShift += step * 1000;
    frame(nowMs(), step, draw && i === n - 1);
  }
  last = nowMs();
  return { phase: game.phase, state: game.match && game.match.state, games: game.match && game.match.games, points: game.match && game.match.points };
}
function frame(now, dtR, draw) {
  const m = game.phase === 'lobby' ? game.demo : game.match;
  let ball = null;
  if (m) ball = updateMatch(m, now, dtR);
  if (game.phase === 'playing' && game.overAt && now >= game.overAt) endGame();
  watchPlayers(now);

  // 카메라
  let camv;
  let slowAmt = 0;
  if (game.phase === 'playing' && m && m.state !== 'over' && m.state !== 'change') {
    camv = (!m.demo && !params.has('broadcast') && firstPersonCam(m, ball && ball.pos, dtR)) || broadcastCam(m, ball && ball.pos, dtR, now);
    slowAmt = camv.slowAmt;
  } else if (game.phase === 'playing' && m && m.state === 'change') {
    camv = orbitCam(now, 26, 14);
  } else {
    camv = orbitCam(now);
  }
  view.setFirstPerson(camv.key || null);
  if (!draw) return;
  if (game.camOverride) camv = game.camOverride;
  view.setCamera(camv);
  view.update(dtR, now);
  view.render();

  // HUD
  if (game.phase === 'playing' && m) {
    renderBug(false);
    slowFx(slowAmt);
    updatePop(now);
    const p = m.plan;
    if (p && !p.decided && p.cued && m.flight && (p.human || p.bot)) {
      const st = sampleFlight(m.flight, m.clock.gt);
      const pr = view.project(st.p);
      if (pr && !pr.behind) {
        const left = clamp((p.t - m.clock.gt) / SLOW_LEAD, 0, 1);
        const H = window.innerHeight;
        ring({
          x: pr.x, y: pr.y, ball: pr.r, R: pr.r + 4 + left * H * 0.13, p: left, after: m.clock.gt > p.t, color: p.pl.color,
          label: `${p.pl.name} ${p.kind === 'serve' ? '서브' : HAND_NAME[p.hand]}`
        });
      } else ring(null);
    } else ring(null);
  } else {
    slowFx(0);
    ring(null);
  }
}

// 연결이 모두 끊기면 20초 뒤 대기실로
function watchPlayers(now) {
  if (game.phase !== 'playing') return;
  const anyHuman = game.humans.some((p) => p.bot || playerInfo(p.slot).connected);
  if (anyHuman) {
    game.allGoneSince = null;
    return;
  }
  if (!game.allGoneSince) game.allGoneSince = now;
  if (now - game.allGoneSince > 20000) backToLobby('모든 폰의 연결이 끊겨 대기실로 돌아왔어요');
}

// ================================================================
// 키보드(시험용): Enter 시작, Space 플랫, T 탑스핀, S 슬라이스(지금 칠 차례인 사람으로)
// ================================================================
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyL' && game.phase !== 'playing') {
    setSlow(!slowOn);
    return;
  }
  if (e.key === 'Enter') {
    if (game.phase !== 'playing') startGame();
    return;
  }
  const spin = e.code === 'Space' ? 'none' : e.code === 'KeyT' ? 'top' : e.code === 'KeyS' ? 'slice' : null;
  if (!spin) return;
  e.preventDefault();
  if (e.repeat || game.phase !== 'playing' || !game.match || !game.humans.length) return;
  const m = game.match;
  const due = m.plan && !m.plan.decided && m.plan.pl.kind === 'human' ? m.plan.pl : null;
  const pl = due || game.humans.find((p) => !p.bot) || game.humans[0];
  const hand = m.plan && m.plan.pl === pl ? m.plan.hand : 'fore';
  onSwing({ slot: pl.slot, power: 0.8, ago: 0, rtt: 0, spin, spinAmt: 0.75, aim: 0, hand: hand === 'serve' ? 'fore' : hand }, true);
});

startDemo();
renderLobby();
requestAnimationFrame(tick);
if (AUTOSTART && BOTS > 0) setTimeout(() => startGame(), 1200);

// 디버그: 콘솔에서 상태 보기
{
  const b = $('slowBtn');
  if (b) b.addEventListener('click', () => setSlow(!slowOn));
  setSlow(slowOn);
}
window.__tennis = { game, view, onSwing, startGame, endGame, backToLobby, toGame, pointLabels, statusCall, lobbyPlayers, fastForward, SLOW, WINDOW };
