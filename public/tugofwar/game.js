// 줄다리기 큰 화면: 청팀 대 백팀, 구령에 맞춰 폰을 당기는 3판 2선승 경기.
// 판 계산(박자표·판정·힘·체력·밧줄·승패·CPU)은 sim.mjs, 3D 장면은 scene.js/models.js, 소리는 sfx.js 가 맡고
// 이 파일은 소켓·대기실·경기 진행·HUD·결과 화면을 잇습니다.
//
// 흐름: lobby(팀 고르기·난이도) → 모두 준비(폰 start_game) → playing(intro 3초 → run 60초 → end 연출 × 최대 3판) → over(결과) → 모두 다시 하기
// 판정은 폰이 보낸 pull {power, ago, rtt} 를 "실제 당긴 시각 = 도착 − ago − 폰RTT/2 − 화면RTT/2" 로 되돌려 박과 견줍니다(리듬 종목과 같은 식).
import { createScene, LINE_X } from './scene.js';
import { Round, Match, assignTeams, CFG, DIFF, otherTeam, mulberry32 } from './sim.mjs';
import { TEAM_NAME, TEAM_COLOR } from './models.js';
import { sfx } from './sfx.js';
import { createSettings, fields } from '/common/settings.js';
import { createTutorialBoard } from '/common/tutorial-board.js';
import { sendHaptic } from '/common/haptics.js';
import { t as T, mountSwitcher } from '/common/i18n.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const num = (v, d) => (v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d);
const BOTS = clamp(parseInt(params.get('bots'), 10) || 0, 0, 8);
const AUTOSTART = params.has('autostart');
const FAST = clamp(num(params.get('fast'), 1), 1, 8); // 시험용: 판 시계를 이만큼 빠르게
const DUR = params.get('dur') ? clamp(num(params.get('dur'), CFG.ROUND_SEC), 10, 120) : CFG.ROUND_SEC; // 시험용: 한 판 길이(초)
const SEED = num(params.get('seed'), 0);
// 사람 수 글자(CPU 가 있으면 함께). 한 문장 틀로 번역합니다
const headcount = (n, cpu) => (cpu ? T('{n}명 + CPU {c}', { n, c: cpu }) : T('{n}명', { n }));

// ---------- 조정 값 ----------
const LEAD = 0.42; // 박이 오기 이만큼(초) 전에 폰에 beat 를 미리 보냄(폰이 지연을 빼고 맞춰 번쩍·진동)
const INTRO_SEC = 3.7;
const END_SEC = 4.6;
const SLOW_SEC = 1.7; // 선을 넘은 순간 느린 화면
const SLOW_RATE = 0.28;
const SLOT = {
  1: { name: '1P', color: '#ff5a5f' }, 2: { name: '2P', color: '#3ab4ff' }, 3: { name: '3P', color: '#ffc93c' }, 4: { name: '4P', color: '#5ee07a' },
  5: { name: '5P', color: '#c77dff' }, 6: { name: '6P', color: '#ff8fd1' }, 7: { name: '7P', color: '#3ee6d6' }, 8: { name: '8P', color: '#ff9b3d' }
};
const JLABEL = { perfect: 'PERFECT', good: 'GOOD', early: '너무 빨라', late: '너무 늦어', off: '엇박', miss: 'MISS', spam: '헛손질' };
const DIFF_LABEL = { easy: '쉬움', normal: '보통', hard: '어려움' };

await Promise.race([
  Promise.all([document.fonts.load('400 64px Anton'), document.fonts.load('900 64px "Pretendard Variable"'), document.fonts.load('800 30px "Pretendard Variable"')]),
  new Promise((r) => setTimeout(r, 2000))
]).catch(() => {});
const view = createScene($('cv'));

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
  try { saved = params.get('room') || sessionStorage.getItem('pcg-tugofwar-room'); } catch (e) {}
  socket.emit('join', { role: 'display', game: 'tugofwar', room: saved });
});
socket.on('room', async (r) => {
  try { sessionStorage.setItem('pcg-tugofwar-room', r.code); } catch (e) {}
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
  const here = new Set(serverPlayers.map((x) => Number(x.slot)));
  for (const s of [...practicing.keys()]) if (!here.has(s)) practicing.delete(s);
  syncRoster();
  renderLobby();
  pushState(true);
});
socket.on('display_replaced', () => $('replaced').classList.remove('hidden'));
socket.on('start_game', () => startGame());
socket.on('pull', (d) => onRemotePull(d));
socket.on('team', (d) => onTeamPick(d));
socket.on('calibrate', (d) => {
  const P = roster.get(Number(d && d.slot));
  if (P) { P.calibrated = true; renderLobby(); pushState(true); }
});
socket.on('msg', (d) => onMsg(d));
socket.on('msg_v', (d) => onMsg(d));

// ---------- 난이도(공통 설정) · 연습 현황 · 준비 현황 ----------
const settings = createSettings({
  game: 'tugofwar',
  fields: [
    fields.difficulty(),
    fields.choice('rounds', '경기', [{ value: '3', label: '3판 2선승' }, { value: '1', label: '단판' }], { default: '3', hotkey: 'r' })
  ],
  keys: true,
  onChange: () => {
    renderLobby();
    pushState(true);
  }
});
mountSwitcher($('langBox'), { reload: true, compact: true }); // 언어 고르기(대기실에서만 보임)
// 안내 문장: 굵은 낱말을 끼운 한 문장 틀로 번역합니다
$('hintGo').innerHTML = T('폰에서 모두 {k}를 누르면 시작해요', { k: `<b>${T('준비')}</b>` });
$('hintAgain').innerHTML = T('폰에서 모두 {k}를 누르면 새 경기', { k: `<b>${T('다시 하기')}</b>` });
settings.attach(socket);
settings.mount($('setBox'));
settings.mount($('setBoxOver'), { compact: true });
const boards = [createTutorialBoard({ mount: $('tutBox') }), createTutorialBoard({ mount: $('tutBoxOver') })];
for (const b of boards) b.attach(socket);
const practicing = new Map();
socket.on('tutorial', (d) => {
  const s = Number(d && d.slot);
  if (!s) return;
  if (d.done) practicing.delete(s);
  else practicing.set(s, String(d.title || ''));
  renderLobby();
});
let readyNow = new Set();
socket.on('ready_state', (st) => {
  readyNow = new Set(st && Array.isArray(st.ready) ? st.ready : []);
  renderLobby();
});

// ================================================================
// 선수 · 팀
// ================================================================
const game = {
  phase: 'lobby', // lobby | playing | over
  stage: 'lobby', // intro | run | end (playing 안에서)
  stageT: 0,
  slow: 0,
  endShown: false,
  seed: SEED || Math.floor(Math.random() * 1e6)
};
const roster = new Map(); // slot → { slot, name, color, connected, bot, present, pref, calibrated }
let match = null;
let round = null;
let teamOf = {}; // slot → team (경기 동안 고정, 새 사람은 다음 판에 작은 팀으로)
const totals = new Map(); // slot → 경기 전체 기록
let matchBestSync = { blue: 0, white: 0 };
let lastPlan = null;
const forceDisp = { blue: 0, white: 0 };
let hudChips = new Map(); // slot → { el, j, c }
let leftTeam = 'blue';

function ensureP(slot) {
  let P = roster.get(slot);
  if (!P) {
    P = { slot, name: SLOT[slot].name, color: SLOT[slot].color, connected: false, bot: false, present: false, pref: 'auto', calibrated: false };
    roster.set(slot, P);
  }
  return P;
}
function syncRoster() {
  const seen = new Set();
  for (const sp of serverPlayers) {
    const P = ensureP(sp.slot);
    P.present = true;
    P.bot = false;
    P.connected = Boolean(sp.connected);
    P.name = sp.name || P.name;
    P.color = sp.color || P.color;
    seen.add(sp.slot);
  }
  for (let s = 1; s <= BOTS; s++) {
    if (seen.has(s)) continue;
    const P = ensureP(s);
    P.present = true;
    P.bot = true;
    P.connected = true;
    P.calibrated = true;
    seen.add(s);
  }
  for (const P of roster.values()) if (!seen.has(P.slot)) { P.present = false; P.connected = false; }
  if (game.phase !== 'playing') refreshLobbyScene();
}
const activePlayers = () => [...roster.values()].filter((p) => p.present).sort((a, b) => a.slot - b.slot);
const playablePlayers = () => activePlayers().filter((p) => p.connected || p.bot);
function planFor(list, lock) {
  return assignTeams(list.map((p) => ({ slot: p.slot, pref: (lock && lock[p.slot]) || p.pref })));
}
function teamDef(plan) {
  const mk = (team) => {
    const arr = plan[team].map((slot) => ({ id: `p${slot}`, slot, name: roster.get(slot).name, color: roster.get(slot).color, cpu: false }));
    for (let i = 0; i < plan.cpu[team]; i++) arr.push({ id: `c${team[0]}${i + 1}`, slot: null, name: `CPU${i + 1}`, color: '#aab1c4', cpu: true });
    return arr;
  };
  return { blue: mk('blue'), white: mk('white') };
}
function sceneDef(def, leftT) {
  return { left: { team: leftT, members: def[leftT] }, right: { team: otherTeam(leftT), members: def[otherTeam(leftT)] } };
}
let lobbyKey = '';
function refreshLobbyScene() {
  const list = playablePlayers();
  lastPlan = planFor(list);
  const key = JSON.stringify([lastPlan, list.map((p) => [p.slot, p.name, p.color])]);
  if (key === lobbyKey || game.phase === 'playing') return;
  lobbyKey = key;
  leftTeam = 'blue';
  view.setTeams(sceneDef(teamDef(lastPlan), 'blue'), 3);
  view.recolorRibbons('blue');
  view.snapFlag(0);
}

function onTeamPick(d) {
  const P = roster.get(Number(d && d.slot));
  if (!P) return;
  const t = d.team === 'blue' || d.team === 'white' ? d.team : 'auto';
  P.pref = t;
  if (game.phase === 'playing' && teamOf[P.slot] !== undefined) {
    // 경기 중 바꾸면 다음 판부터
    teamOf[P.slot] = t === 'auto' ? undefined : t;
    if (t === 'auto') delete teamOf[P.slot];
  }
  refreshLobbyScene();
  renderLobby();
  pushState(true);
}
function onMsg(d) {
  if (!d || typeof d !== 'object') return;
  const slot = Number(d.slot);
  if (d.type === 'brace' && round && game.stage === 'run') {
    round.brace(`p${slot}`);
  } else if (d.type === 'team') onTeamPick(d);
}

// ================================================================
// 대기실 화면
// ================================================================
function lobbyMessage(text) {
  const m = $('msg');
  m.textContent = T(text);
  m.classList.add('on');
  clearTimeout(lobbyMessage.t);
  lobbyMessage.t = setTimeout(() => m.classList.remove('on'), 3200);
}
const seatEls = { blue: [], white: [] };
function renderLobby() {
  const box = $('teams');
  if (!box) return;
  const plan = lastPlan || assignTeams([]);
  if (!seatEls.blue.length) {
    box.innerHTML = ['blue', 'white'].map((tm) =>
      `<div class="tcard" data-team="${tm}" style="--tc:${tm === 'blue' ? '#2f6fe4' : '#e0332c'};--ta:#fff"><h3><span>${TEAM_NAME[tm]}</span><small id="tc-${tm}"></small></h3><div class="seats" id="seats-${tm}"></div></div>`).join('');
  }
  for (const tm of ['blue', 'white']) {
    const humans = plan[tm];
    $(`tc-${tm}`).textContent = headcount(humans.length, plan.cpu[tm]);
    const seats = [];
    for (const slot of humans) {
      const P = roster.get(slot);
      if (!P) continue;
      let st = '연결됨';
      if (P.bot) st = 'BOT';
      else if (!P.connected) st = '끊김';
      else if (practicing.has(slot)) st = '연습 중';
      else if (readyNow.has(slot)) st = '준비 완료';
      else if (P.calibrated) st = '자세 확인';
      const pick = P.pref === 'auto' ? '자동' : '직접';
      const seatTxt = T('{pick} · {st}', { pick, st });
      seats.push(`<div class="seat human${readyNow.has(slot) && !P.bot ? ' rdy' : ''}${!P.connected ? ' away' : ''}" style="--pc:${P.color}"><span class="sn">${P.name}</span><span>${seatTxt}</span></div>`);
    }
    for (let i = 0; i < plan.cpu[tm]; i++) seats.push(`<div class="seat cpu"><span class="sn">CPU</span><span>${T('자동으로 채워요')}</span></div>`);
    const html = seats.join('');
    if ($(`seats-${tm}`).dataset.h !== html) { $(`seats-${tm}`).innerHTML = html; $(`seats-${tm}`).dataset.h = html; }
  }
  seatEls.blue = [1];
  const diff = settings.difficulty();
  const dt = $('diffOver');
  dt.textContent = DIFF_LABEL[diff] || '쉬움';
  dt.dataset.d = diff;
}

// ================================================================
// 경기 시작 · 판 진행
// ================================================================
function showScreen(which) {
  $('lobby').classList.toggle('hidden', which !== 'lobby');
  $('over').classList.toggle('hidden', which !== 'over');
  $('hud').classList.toggle('hidden', which !== 'hud');
  $('floaters').classList.toggle('hidden', which !== 'hud');
  $('join').classList.toggle('hidden', which !== 'hud');
}
function startGame() {
  if (game.phase === 'playing') return;
  if (!settings.requireAnswered()) return;
  const list = playablePlayers();
  if (!list.length) {
    lobbyMessage('폰을 먼저 연결해 주세요. QR을 찍고 준비를 누르면 자리가 생겨요.');
    return;
  }
  sfx.audio();
  sfx.bed(true);
  settings.lock(true);
  for (const b of boards) b.hide(true);
  match = new Match({ target: settings.get('rounds') === '1' ? 1 : 2 });
  teamOf = {};
  totals.clear();
  matchBestSync = { blue: 0, white: 0 };
  game.phase = 'playing';
  game.endShown = false;
  game.seed = SEED || Math.floor(Math.random() * 1e6);
  showScreen('hud');
  startRound();
  pushState(true);
}
function startRound() {
  const list = playablePlayers();
  // 이미 팀이 정해진 사람은 그대로, 새 사람(경기 중 들어옴)은 자동으로 작은 쪽
  const prefs = list.map((p) => ({ slot: p.slot, pref: teamOf[p.slot] || (p.pref !== 'auto' && teamOf[p.slot] === undefined && p.pref) || 'auto' }));
  const plan = assignTeams(prefs);
  for (const t of ['blue', 'white']) for (const s of plan[t]) teamOf[s] = t;
  lastPlan = plan;
  const names = {};
  for (const p of list) names[p.slot] = p.name;
  round = new Round({ seed: game.seed + match.round * 101, difficulty: settings.difficulty(), teams: plan, names, duration: DUR });
  leftTeam = match.sideOf('blue') === 'left' ? 'blue' : 'white';
  const def = teamDef(plan);
  view.setTeams(sceneDef(def, leftTeam), game.seed + match.round);
  view.recolorRibbons(leftTeam);
  view.resetMood();
  view.snapFlag(0);
  view.setScore(match.wins.blue, match.wins.white);
  botQueue.length = 0;
  sentBeats.clear();
  for (const p of round.members) if (!p.cpu) { const c = totals.get(p.slot); if (!c) totals.set(p.slot, { slot: p.slot, name: p.name, team: p.team, perfect: 0, good: 0, off: 0, miss: 0, spam: 0, pulls: 0, bestCombo: 0, powerSum: 0, rounds: 0 }); }
  game.stage = 'intro';
  game.stageT = 0;
  game.slow = 0;
  introStep = -1;
  setupHud();
  forceDisp.blue = forceDisp.white = 0;
  view.S.ropeWave = 0;
  state.fov = 34;
  state.ropeDrop = 0;
  state.cheer = 0.2;
  pushState(true);
}
let introStep = -1;
const state = { fov: 34, ropeDrop: 0, cheer: 0.2 };
function introTick() {
  const t = game.stageT;
  const card = $('intro');
  const steps = [
    [0, T('{n}판', { n: match.round }), T('{a} · {b}', { a: TEAM_NAME[leftTeam], b: TEAM_NAME[otherTeam(leftTeam)] }), `${match.wins.blue} : ${match.wins.white}`, 'txt'],
    [1.5, '3', '준비!', '', ''],
    [2.1, '2', '', '', ''],
    [2.7, '1', '', '', ''],
    [3.3, '시작!', '', '', 'txt']
  ];
  let idx = -1;
  steps.forEach((s, i) => { if (t >= s[0]) idx = i; });
  if (idx !== introStep) {
    introStep = idx;
    const s = steps[idx];
    card.classList.remove('hidden');
    $('introTop').textContent = idx === 0 ? (match.target === 1 ? T('단판') : T('{n}판 {w}선승', { n: match.target * 2 - 1, w: match.target })) : '';
    const big = $('introBig');
    big.textContent = s[1];
    big.className = s[4];
    $('introSub').textContent = idx === 0 ? s[2] : s[2];
    if (idx === 0) sfx.roundStart();
    else if (idx >= 1 && idx <= 3) sfx.count(3 - idx + 1);
    else if (idx === 4) { sfx.count(0); sfx.whistle(0, false); }
    if (idx > 0 && idx < 4) $('introSub').textContent = '';
  }
  if (t >= INTRO_SEC) {
    card.classList.add('hidden');
    game.stage = 'run';
    game.stageT = 0;
    pushState(true);
  }
}

// ---------- 폰 입력 ----------
function onRemotePull(d) {
  const slot = Number(d && d.slot);
  const P = roster.get(slot);
  if (!P) return;
  const power = clamp(num(d.power, 0.7), 0.15, 1);
  if (game.phase === 'playing' && game.stage === 'run' && round) {
    const id = `p${slot}`;
    if (!round.parts.has(id)) return; // 이번 판에 없음(경기 중 들어온 사람: 다음 판부터)
    const lagMs = clamp(num(d.ago, 0), 0, 400) + clamp(num(d.rtt, 80), 0, 800) / 2 + displayRtt() / 2;
    round.pull(id, round.t - (lagMs / 1000) * FAST, power);
    return;
  }
  // 대기실·결과 화면: 당기는 연습을 큰 화면에서 같이 보여 줌
  const id = `p${slot}`;
  if (game.phase !== 'playing') {
    view.pull(id, power, 'good');
    sendHaptic(socket, slot, 'tick', 0.5);
    send('cue', { practice: true, power }, slot);
  }
}

// ---------- 봇(?bots=N): 사람과 같은 길(round.pull)로 박에 맞춰 당김 ----------
const botQueue = [];
function gauss() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function scheduleBots(cyc) {
  if (!round) return;
  for (const p of round.members) {
    if (p.cpu || !roster.get(p.slot) || !roster.get(p.slot).bot) continue;
    if (cyc.brace === p.team) {
      if (Math.random() < 0.85) botQueue.push({ t: cyc.pullAt - 0.15, id: p.id, brace: true });
      continue;
    }
    if (Math.random() < 0.05) continue;
    botQueue.push({ t: cyc.pullAt + gauss() * 0.045 + 0.01, id: p.id, power: 0.6 + Math.random() * 0.35 });
  }
  botQueue.sort((a, b) => a.t - b.t);
}
function runBots() {
  while (botQueue.length && botQueue[0].t <= round.t) {
    const q = botQueue.shift();
    if (q.brace) round.brace(q.id);
    else round.pull(q.id, q.t, q.power);
  }
}

// ================================================================
// 박 보내기(폰 알림 + 큰북 소리) · 판 이벤트
// ================================================================
const sentBeats = new Set();
const beatVis = []; // 화면 박자 띠용 {t, kind, brace, cyc}
function emitBeats() {
  for (const cyc of round.cycles.slice(-3)) {
    for (const b of cyc.beats) {
      const key = `${cyc.id}:${b.kind}`;
      if (sentBeats.has(key) || b.t - LEAD > round.t) continue;
      sentBeats.add(key);
      const inSim = Math.max(0, b.t - round.t);
      const inMs = Math.round((inSim / FAST) * 1000);
      send('beat', { n: cyc.id, kind: b.kind, in: Math.max(0, inMs - Math.round(displayRtt() / 2)), ivl: Math.round((cyc.ivl / FAST) * 1000), brace: cyc.brace, sprint: cyc.sprint, pullIn: Math.round(((cyc.pullAt - round.t) / FAST) * 1000), t: Math.round(round.t * 100) / 100 });
      sfx.beat(b.kind, inSim / FAST, { fast: cyc.sprint });
      beatVis.push({ t: b.t, kind: b.kind, brace: cyc.brace, cyc: cyc.id, sprint: cyc.sprint });
      if (beatVis.length > 24) beatVis.shift();
      // 큰북 치는 모습은 박 시각에 맞춰
      setTimeout(() => view.callerBeat(b.kind), Math.max(0, (inSim / FAST) * 1000 - 20));
      if (cyc.brace && b.kind === 'one') {
        setTimeout(() => { callout(T('{team} 버티기!', { team: TEAM_NAME[cyc.brace] }), 'brace small'); sfx.brace(); }, Math.max(0, (inSim / FAST) * 1000));
      }
    }
  }
}
function onJudge(e) {
  const human = e.slot != null;
  if (e.spam) {
    view.stumble(e.id);
    if (human) { floater(e.id, T(JLABEL.spam), 'miss'); sfx.judge('miss'); sendHaptic(socket, e.slot, 'miss', 0.5); updateChip(e.slot, 'miss', 0); }
    return;
  }
  if (e.brace) {
    view.stumble(e.id);
    if (human) { floater(e.id, T('버텨야 해요!'), 'miss'); sendHaptic(socket, e.slot, 'miss', 0.4); }
    return;
  }
  view.pull(e.id, e.power, e.j);
  if (e.j === 'miss') view.stumble(e.id);
  if (!human) return;
  let label = JLABEL[e.j];
  if (e.j === 'off') label = e.off < 0 ? JLABEL.early : JLABEL.late;
  floater(e.id, T(label) + (e.combo >= 3 ? ` ×${e.combo}` : ''), e.j);
  sfx.judge(e.j, e.combo);
  sendHaptic(socket, e.slot, e.j === 'perfect' ? 'perfect' : e.j === 'good' ? 'good' : e.j === 'off' ? 'tick' : 'miss', e.j === 'perfect' ? 1 : 0.7);
  send('cue', { j: e.j, off: Math.round(e.off * 1000), combo: e.combo, power: Math.round(e.power * 100) / 100, stamina: Math.round(e.stamina * 100) / 100, label }, e.slot);
  updateChip(e.slot, e.j, e.combo);
  const c = totals.get(e.slot);
  if (c && e.counted) c.powerSum += e.power;
}
let lastBodyAt = -9;
function onResolve(e) {
  const flagN = (leftTeam === 'blue' ? -1 : 1) * e.rope;
  forceDisp.blue = Math.max(forceDisp.blue, e.F.blue / (round.size * 1.45));
  forceDisp.white = Math.max(forceDisp.white, e.F.white / (round.size * 1.45));
  view.ropeWave(1);
  const d = Math.abs(e.d);
  if (d > 0.1) view.punch(Math.min(1, d * 6));
  if (d > 0.14) view.shake(Math.min(1.2, d * 7));
  if (e.sync.blue.body || e.sync.white.body) {
    const bt = e.sync.blue.body && (!e.sync.white.body || e.F.blue >= e.F.white) ? 'blue' : 'white';
    if (round.t - lastBodyAt > 0.9) {
      lastBodyAt = round.t;
      callout(T('한 몸!'), 'body');
      sfx.body();
      view.punch(1);
      view.shake(0.8);
      view.teamRumble(bt, 1);
      state.cheer = 0.9;
      flashScreen(TEAM_COLOR[bt] === '#fff3dc' ? '#fff3dc' : TEAM_COLOR[bt]);
      for (const p of round.team[bt]) if (!p.cpu) sendHaptic(socket, p.slot, 'great', 1);
    }
  }
  if (e.brace) {
    if (e.brace.success) { callout(T('버티기 성공!'), 'brace small'); sfx.braceOk(); view.shake(0.5); } else callout(T('밀린다!'), 'small');
    for (const p of round.team[e.brace.team]) if (!p.cpu) sendHaptic(socket, p.slot, e.brace.success ? 'success' : 'fail', 0.9);
  }
  sfx.crowdLevel(clamp(Math.abs(round.rope), 0, 1));
  pushState();
}
function flashScreen(color) {
  const f = $('flash');
  f.style.background = `radial-gradient(circle, transparent 45%, ${color}aa)`;
  f.classList.remove('go');
  void f.offsetWidth;
  f.classList.add('go');
}
function onRoundEnd(e) {
  game.stage = 'end';
  game.stageT = 0;
  game.slow = e.reason === 'line' ? SLOW_SEC : 0.6;
  botQueue.length = 0;
  const win = e.winner;
  const info = { reason: e.reason, rope: e.rope };
  for (const p of round.members) {
    if (p.cpu) continue;
    const c = totals.get(p.slot);
    if (!c) continue;
    for (const k of ['perfect', 'good', 'off', 'miss', 'spam', 'pulls']) c[k] += p[k];
    c.bestCombo = Math.max(c.bestCombo, p.bestCombo);
    c.team = p.team;
    c.rounds++;
  }
  matchBestSync.blue = Math.max(matchBestSync.blue, round.bestSync.blue);
  matchBestSync.white = Math.max(matchBestSync.white, round.bestSync.white);
  match.endRound(win, info);
  view.setScore(match.wins.blue, match.wins.white);
  view.celebrate(win);
  view.punch(1);
  state.fov = 30;
  state.cheer = 1;
  state.ropeDrop = 0;
  sfx.win();
  const line = T(e.reason === 'line' ? '선을 넘었다!' : '시간 종료');
  callout(T('{team} 승리!', { team: TEAM_NAME[win] }), 'body');
  setTimeout(() => callout(line, 'small'), 500);
  setupHudPips();
  for (const p of round.members) if (!p.cpu) sendHaptic(socket, p.slot, p.team === win ? 'success' : 'fail', 1);
  pushState(true);
}
function endTick(dt) {
  if (game.stageT > 0.6) state.ropeDrop = 1;
  if (game.stageT > END_SEC && !game.endShown) {
    if (match.winner) { game.endShown = true; showResults(); } else {
      game.endShown = false;
      startRound();
    }
  }
}

// ================================================================
// 결과
// ================================================================
function showResults() {
  sfx.bed(false);
  game.phase = 'over';
  game.stage = 'over';
  settings.lock(false);
  for (const b of boards) b.hide(false);
  showScreen('over');
  const win = match.winner;
  const title = $('ovTitle');
  title.textContent = T('{team} 우승!', { team: TEAM_NAME[win] });
  title.style.color = win === 'blue' ? '#7fb0ff' : '#fff3dc';
  $('ovEyebrow').textContent = T(match.target === 1 ? '단판 결과' : '{n}판 결과', { n: match.history.length });
  $('ovScore').innerHTML = `<i style="background:#2f6fe4;color:#fff">${T('청 {n}', { n: match.wins.blue })}</i><span>:</span><i style="background:#fff3dc;color:#c92a22;border:3px solid #e0332c">${T('{n} 백', { n: match.wins.white })}</i>`;
  const rows = [...totals.values()].sort((a, b) => b.perfect - a.perfect || b.bestCombo - a.bestCombo);
  const mvp = rows[0];
  const cards = [];
  if (mvp && mvp.pulls) {
    const P = roster.get(mvp.slot) || { color: '#fff', name: `${mvp.slot}P` };
    cards.push(`<div class="ov-card" style="--pc:${P.color}"><small>${T('MVP · PERFECT 가장 많이')}</small><b><em>${P.name}</em>${T('{n}번', { n: mvp.perfect })}</b><span>${T('{team} · 최고 콤보 {n}', { team: TEAM_NAME[mvp.team], n: mvp.bestCombo })}</span></div>`);
  }
  const bs = matchBestSync.blue >= matchBestSync.white ? 'blue' : 'white';
  cards.push(`<div class="ov-card"><small>${T('최고 한 몸 연속')}</small><b>${T('{n}번 연속', { n: matchBestSync[bs] })}</b><span>${matchBestSync[bs] === 0 ? T('{team} · 아직 없어요', { team: TEAM_NAME[bs] }) : T(TEAM_NAME[bs])}</span></div>`);
  const bw = match.history.map((h, i) => T('{n}판 {team}({why})', { n: i + 1, team: TEAM_NAME[h.winner], why: T(h.reason === 'line' ? '선 넘김' : '시간승') })).join(' · ');
  cards.push(`<div class="ov-card"><small>${T('판별 기록')}</small><span style="color:var(--ink);font-size:17px">${bw}</span></div>`);
  $('ovCards').innerHTML = cards.join('');
  const body = rows.map((r, i) => {
    const P = roster.get(r.slot) || { color: '#fff', name: `${r.slot}P` };
    const avg = r.perfect + r.good + r.off ? Math.round((r.powerSum / Math.max(1, r.perfect + r.good + r.off)) * 100) : 0;
    return `<tr class="${i === 0 && r.pulls ? 'mvp' : ''}"><td><span class="tn" style="--pc:${P.color}">${P.name}</span><span class="tt" style="background:${TEAM_COLOR[r.team]}"></span></td><td>${r.perfect}</td><td>${r.good}</td><td>${r.off}</td><td>${r.miss + r.spam}</td><td>${r.bestCombo}</td><td>${avg}%</td></tr>`;
  }).join('');
  $('ovTable').innerHTML = `<table><thead><tr><th>${T('선수')}</th><th>PERFECT</th><th>GOOD</th><th>${T('엇박')}</th><th>MISS</th><th>${T('최고 콤보')}</th><th>${T('평균 힘')}</th></tr></thead><tbody>${body}</tbody></table>`;
  // 폰에 개인 결과
  rows.forEach((r, i) => {
    send('result', { rank: i + 1, team: r.team, win: r.team === win, perfect: r.perfect, good: r.good, off: r.off, miss: r.miss + r.spam, bestCombo: r.bestCombo, mvp: i === 0 && r.pulls > 0, wins: match.wins, winner: win }, r.slot);
  });
  state.fov = 34;
  pushState(true);
}
function backToLobby(msg) {
  sfx.bed(false);
  game.phase = 'lobby';
  game.stage = 'lobby';
  round = null;
  settings.lock(false);
  for (const b of boards) b.hide(false);
  lobbyKey = '';
  showScreen('lobby');
  refreshLobbyScene();
  renderLobby();
  if (msg) lobbyMessage(msg);
  pushState(true);
}

// ================================================================
// HUD
// ================================================================
function sideTeams() {
  return { left: leftTeam, right: otherTeam(leftTeam) };
}
function setupHud() {
  const st = sideTeams();
  for (const side of ['left', 'right']) {
    const tm = st[side];
    const L = side === 'left' ? 'L' : 'R';
    const col = TEAM_COLOR[tm];
    const acc = tm === 'blue' ? '#ffffff' : '#c92a22';
    for (const id of [`tm${L}`, `pan${L}`]) {
      const el = $(id);
      el.dataset.team = tm;
      el.style.setProperty('--tc', col);
      el.style.setProperty('--ta', acc);
    }
    $(`tm${L}Name`).textContent = TEAM_NAME[tm];
    $(`pan${L}Name`).textContent = TEAM_NAME[tm];
    $(`rb${L}`).style.background = col;
    $('ropebar').style.setProperty(side === 'left' ? '--lc' : '--rc', tm === 'blue' ? '#2f6fe4' : '#e0332c');
    const humans = round.team[tm].filter((p) => !p.cpu);
    const cpus = round.team[tm].length - humans.length;
    $(`pan${L}Sub`).textContent = headcount(humans.length, cpus);
    const box = $(`chips${L}`);
    box.innerHTML = '';
    for (const p of humans) {
      const el = document.createElement('div');
      el.className = 'chip';
      el.style.setProperty('--pc', roster.get(p.slot).color);
      el.innerHTML = `<span class="cn">${p.name}</span><span class="cj">대기</span><span class="cc"></span>`;
      box.appendChild(el);
      hudChips.set(p.slot, { el, j: el.querySelector('.cj'), c: el.querySelector('.cc'), team: tm });
    }
    if (cpus) {
      const el = document.createElement('div');
      el.className = 'chip cpu';
      el.innerHTML = `<span class="cn">CPU</span><span class="cj">×${cpus}</span>`;
      box.appendChild(el);
    }
  }
  hudChips = new Map([...hudChips].filter(([s]) => round.parts.has(`p${s}`)));
  setupHudPips();
  $('roundTag').textContent = match.target === 1 ? T('단판') : T('{r} / {n}판', { r: match.round, n: match.target * 2 - 1 });
  $('timer').textContent = String(DUR);
  document.querySelector('.clock').classList.remove('sprint');
}
function setupHudPips() {
  const st = sideTeams();
  for (const side of ['left', 'right']) {
    const L = side === 'left' ? 'L' : 'R';
    const w = match.wins[st[side]];
    $(`pips${L}`).innerHTML = Array.from({ length: match.target }, (_, i) => `<i class="${i < w ? 'on' : ''}"></i>`).join('');
  }
}
function updateChip(slot, j, combo) {
  const c = hudChips.get(slot);
  if (!c) return;
  let label = JLABEL[j] || j;
  c.j.textContent = label;
  c.j.className = `cj ${j}`;
  c.c.textContent = combo >= 2 ? `×${combo}` : '';
  c.el.classList.remove('bump');
  void c.el.offsetWidth;
  c.el.classList.add('bump');
}
const callEls = [];
function callout(text, cls = '') {
  const el = document.createElement('div');
  el.className = `call ${cls}`;
  el.textContent = text;
  $('callouts').appendChild(el);
  callEls.push(el);
  while (callEls.length > 2) callEls.shift().remove();
  setTimeout(() => { el.remove(); const i = callEls.indexOf(el); if (i >= 0) callEls.splice(i, 1); }, 1400);
}
let floaterN = 0;
function floater(id, text, cls) {
  const p = view.headScreen(id, 0.62);
  if (!p || !p.ok) return;
  const el = document.createElement('div');
  el.className = `fl ${cls}`;
  el.textContent = text;
  el.style.left = `${p.x}px`;
  el.style.top = `${p.y - 10 - (floaterN++ % 3) * 30}px`;
  $('floaters').appendChild(el);
  setTimeout(() => el.remove(), 950);
}

let hudCache = {};
const setW = (id, pct) => { const k = id + Math.round(pct); if (hudCache[id] !== k) { hudCache[id] = k; $(id).style.width = `${pct}%`; } };
function updateHud(dt) {
  if (!round) return;
  const st = sideTeams();
  // 타이머 · 스퍼트
  const left = Math.max(0, Math.ceil(round.duration - round.t));
  const tEl = $('timer');
  if (tEl.textContent !== String(left)) tEl.textContent = String(left);
  document.querySelector('.clock').classList.toggle('sprint', round.sprint && round.phase === 'run');
  // 밧줄 위치 띠: 왼쪽 끝 = 왼팀 선, 오른쪽 끝 = 오른팀 선
  const flagN = (leftTeam === 'blue' ? -1 : 1) * round.rope; // -1(왼) … +1(오른)
  const pct = 50 + flagN * 50;
  $('rbFlag').style.left = `${pct}%`;
  const fl = $('rbFillL'), fr = $('rbFillR');
  if (pct < 50) { fl.style.left = `${pct}%`; fl.style.width = `${50 - pct}%`; fr.style.width = '0'; }
  else { fr.style.left = '50%'; fr.style.right = 'auto'; fr.style.width = `${pct - 50}%`; fl.style.width = '0'; }
  // 힘 · 체력 막대
  for (const side of ['left', 'right']) {
    const L = side === 'left' ? 'L' : 'R';
    const tm = st[side];
    forceDisp[tm] = Math.max(0, forceDisp[tm] - dt * 0.15);
    setW(`force${L}`, clamp(forceDisp[tm], 0, 1) * 100);
    const sv = round.teamStamina(tm);
    setW(`stam${L}`, sv * 100);
    $(`stam${L}`).classList.toggle('low', sv < 0.38);
  }
  for (const [slot, c] of hudChips) {
    const p = round.parts.get(`p${slot}`);
    c.el.classList.toggle('low', p && p.stamina < 0.3);
  }
  // 박자 띠
  const t = round.t;
  let on = { one: false, two: false, pull: false, rest: false };
  for (const b of beatVis) if (t >= b.t && t - b.t < 0.2) on[b.kind] = true;
  for (const [k, id] of [['one', 'bdOne'], ['two', 'bdTwo'], ['pull', 'bdPull'], ['rest', 'bdRest']]) $(id).classList.toggle('on', on[k]);
  const cur = round.cycles.find((c) => !c.resolved && c.pullAt + 0.1 >= t) || round.cycles[round.cycles.length - 1];
  $('bdTwo').style.opacity = cur && cur.sprint ? '.25' : '';
  $('bdRest').style.opacity = cur && cur.sprint ? '.15' : '';
  const toPull = cur ? cur.pullAt - t : 9;
  const ring = $('bdRing');
  if (toPull > -0.1 && toPull < 1.5 && round.phase === 'run') {
    const k = clamp(toPull / 1.5, 0, 1);
    ring.style.opacity = String(0.9 - 0.4 * k);
    ring.style.transform = `scale(${1 + 1.9 * k})`;
  } else ring.style.opacity = '0';
  const brace = cur && cur.brace && toPull > -0.5;
  $('beat').classList.toggle('brace', Boolean(brace));
  $('braceTag').classList.toggle('hidden', !brace);
  if (brace) $('braceTag').textContent = T('{team} 버티기!', { team: TEAM_NAME[cur.brace] });
}

// ================================================================
// 폰에 보낼 상태
// ================================================================
let lastPush = 0;
let pushTimer = null;
function buildState() {
  const players = {};
  const list = activePlayers();
  const plan = game.phase === 'playing' && round ? null : (lastPlan || planFor(playablePlayers()));
  for (const p of list) {
    const inRound = round && round.parts.get(`p${p.slot}`);
    const team = inRound ? inRound.team : (game.phase === 'playing' ? (teamOf[p.slot] || null) : plan ? (plan.blue.includes(p.slot) ? 'blue' : plan.white.includes(p.slot) ? 'white' : null) : null);
    players[p.slot] = {
      slot: p.slot, team, pref: p.pref, bot: p.bot, calibrated: p.calibrated,
      inRound: Boolean(inRound), stamina: inRound ? Math.round(inRound.stamina * 100) / 100 : 1, combo: inRound ? inRound.combo : 0, j: inRound ? inRound.lastJ : null,
      perfect: inRound ? inRound.perfect : 0
    };
  }
  return {
    phase: game.phase,
    stage: game.stage,
    round: match ? match.round : 0,
    rounds: match ? match.target * 2 - 1 : 3,
    wins: match ? match.wins : { blue: 0, white: 0 },
    left: leftTeam,
    players,
    t: round ? Math.round(round.t * 10) / 10 : 0,
    duration: round ? round.duration : DUR,
    sprint: round ? round.sprint : false,
    rope: round ? Math.round(round.rope * 100) / 100 : 0,
    size: round ? round.size : (plan ? plan.size : 3),
    cpu: plan ? plan.cpu : (round ? { blue: round.team.blue.filter((p) => p.cpu).length, white: round.team.white.filter((p) => p.cpu).length } : { blue: 0, white: 0 }),
    winner: match ? match.winner : null,
    settings: settings.forState()
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
setInterval(() => { if (game.phase === 'playing' && game.stage === 'run') pushState(); }, 400);

// ================================================================
// 한 프레임
// ================================================================
let last = performance.now();
function tick() {
  requestAnimationFrame(tick);
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  let animDt = dt;
  if (game.slow > 0) { game.slow -= dt; animDt = dt * SLOW_RATE; }
  let mode = game.phase === 'lobby' ? 'lobby' : game.phase === 'over' ? 'over' : game.stage === 'intro' ? 'intro' : 'run';
  let toPull = 9;
  let braceTeam = null;
  if (game.phase === 'playing' && round) {
    game.stageT += dt;
    if (game.stage === 'intro') introTick();
    else if (game.stage === 'run') {
      const sdt = dt * FAST;
      round.tick(sdt);
      runBots();
      emitBeats();
      for (const e of round.drain()) {
        if (e.type === 'cycle') scheduleBots(e.cyc);
        else if (e.type === 'judge') onJudge(e);
        else if (e.type === 'resolve') onResolve(e);
        else if (e.type === 'sprint') { callout(T('막판 스퍼트!'), 'sprint'); sfx.sprint(); view.shake(0.6); state.cheer = 1; for (const p of round.members) if (!p.cpu) sendHaptic(socket, p.slot, 'warn', 0.8); pushState(true); }
        else if (e.type === 'end') onRoundEnd(e);
      }
    } else if (game.stage === 'end') endTick(dt);
    const cur = round.cycles.find((c) => !c.resolved && c.pullAt + 0.05 >= round.t);
    if (cur) { toPull = cur.pullAt - round.t; braceTeam = cur.brace; }
  }
  const stamina = {};
  if (round) for (const p of round.parts.values()) stamina[p.id] = p.stamina;
  state.cheer += (0.25 - state.cheer) * Math.min(1, dt * 0.35) * (game.stage === 'end' || game.phase === 'over' ? 0 : 1);
  const flagX = round && game.phase !== 'lobby' ? (leftTeam === 'blue' ? -1 : 1) * round.rope * LINE_X : 0;
  view.update(animDt, { mode, flagX, timeToPull: toPull, braceTeam, stamina, cheer: game.phase === 'over' || game.stage === 'end' ? 1 : state.cheer, ropeDrop: state.ropeDrop, fov: state.fov, hold: mode === 'intro' });
  view.render();
  if (game.phase === 'playing') updateHud(dt);
}

// 폰이 없을 때 쓰는 키보드(시험용): Enter 시작(폰이 들어와 있으면 ready.js 가 막음)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && game.phase !== 'playing') startGame();
});

showScreen('lobby');
syncRoster();
refreshLobbyScene();
renderLobby();
requestAnimationFrame(tick);
// ?autostart 는 봇 시험 전용입니다. 폰이 한 대라도 들어와 있으면 모두 준비로만 시작합니다.
if (AUTOSTART && BOTS > 0) setTimeout(() => { if (!serverPlayers.length) startGame(); }, 1500);

// 디버그·시험: 콘솔에서 상태 보기·조작
window.__tugofwar = {
  game, view, roster, settings, boards, Round, Match, assignTeams, CFG, DIFF,
  get round() { return round; },
  get match() { return match; },
  get teamOf() { return teamOf; },
  get plan() { return lastPlan; },
  startGame, backToLobby, showResults, pushState, buildState, displayRtt, onRemotePull, onTeamPick,
  // 시험용: 사람 slot 이 지금 박에 맞춰 당긴 것처럼(오프셋 초). 폰 없이 판정·반응을 확인합니다.
  simPull(slot, off = 0, power = 0.8) {
    if (!round) return null;
    const cyc = round.cycles.find((c) => !c.resolved && c.pullAt + 0.3 >= round.t) || round.cycles[round.cycles.length - 1];
    return round.pull(`p${slot}`, cyc.pullAt + off, power);
  },
  // 시험용: 한 팀이 선을 넘기도록 밧줄을 확 끌어 놓음
  nudge(team, amount = 0.9) { if (round) round.rope = clamp(round.rope + (team === 'blue' ? amount : -amount), -1, 1); },
  getState: () => ({ phase: game.phase, stage: game.stage, round: match && match.round, wins: match && { ...match.wins }, rope: round && round.rope, t: round && round.t, winner: match && match.winner })
};
