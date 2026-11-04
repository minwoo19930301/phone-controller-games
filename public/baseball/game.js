// 홈런 더비 큰 화면. 서버는 방과 이벤트만 중계하고, 판정은 모두 여기서 합니다.
// 같은 화면에서 투타 대결(한 명은 폰으로 던지고 한 명은 치기)도 돌립니다. 규칙 숫자는 duel.js 에 있습니다.
import { createScene, fenceDist, FIELD_SPOTS } from './scene.js';
import { RULES, PAD, REACH, PITCHES, clamp, aimToPlate, plateToAim, zoneMiss, controlSigma, pitchPoint,
  randomThrow, newDuel, half, nextHalf, applyPitch, battedOutcome, catchPoint, ranking } from './duel.js';

const PITCHES_PER_TURN = 10;
const HIT_WINDOW = 0.2; // 이 시간(초)보다 어긋나면 헛스윙
const SWEET = 0.035; // 이 안이면 정타
const RD = Math.PI / 180;
const RELEASE = [0.25, 1.95, 17.9];
const PITCH_TYPES = [
  { name: '직구', kmh: [138, 152], brk: 0.06, w: 5 },
  { name: '체인지업', kmh: [118, 128], brk: 0.3, w: 2 },
  { name: '커브', kmh: [105, 118], brk: 0.65, w: 2 }
];
// 투타 대결: 던진 신호가 오면 바로 와인드업을 시작하고, 폰에서 실제로 던진 때부터 이 시간(ms) 뒤에 공을 놓습니다.
const DUEL_WINDUP = 1050;
const DUEL_MIN_WIND = 600;
// 투수 폰이 끊기면 이 시간 뒤 자동 투구, 붙어 있어도 이 시간 동안 안 던지면 자동 투구합니다.
const AUTO_GONE_MS = 2500;
const AUTO_IDLE_MS = 25000;
// 타자 폰이 끊기면 이 시간 기다렸다가 그 하프 이닝을 넘깁니다.
const BATTER_WAIT_MS = 10000;

// 시험용: 주소에 ?bots=N(최대 3) 을 붙이면 폰 없는 봇이 참가합니다. 봇은 알아서 던지고 칩니다.
const params = new URLSearchParams(location.search);
const BOT_COLORS = ['#b48cff', '#ff8f4a', '#3de0d0'];
const bots = Array.from({ length: clamp(parseInt(params.get('bots'), 10) || 0, 0, 3) }, (_, i) =>
  ({ slot: 101 + i, name: `BOT${i + 1}`, color: BOT_COLORS[i], connected: true, bot: true }));
const isBot = (slot) => slot > 100;

const $ = (id) => document.getElementById(id);
// 캔버스에 글자를 그리기 전에 글꼴을 기다립니다(최대 2초).
await Promise.race([
  Promise.all([document.fonts.load('400 64px Anton'), document.fonts.load('800 64px "Pretendard Variable"')]),
  new Promise((r) => setTimeout(r, 2000))
]).catch(() => {});
const view = createScene($('cv'));

// ---------- 소리 ----------
let actx = null;
function audio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) actx = new AC();
  }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
window.addEventListener('pointerdown', audio);
window.addEventListener('keydown', audio);
function noise(sec, freq, q, gain, attack, type) {
  const a = actx;
  if (!a || a.state !== 'running') return;
  const len = Math.floor(a.sampleRate * sec);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const env = attack ? Math.min(1, t / attack) * Math.pow(1 - t, 1.4) : Math.pow(1 - t, 7);
    d[i] = (Math.random() * 2 - 1) * env;
  }
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = type || 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}
function tone(freq, sec, gain) {
  const a = actx;
  if (!a || a.state !== 'running') return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + sec);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + sec);
}
const sfx = {
  crack: (q) => { noise(0.1, 2400, 0.6, 0.7 + q, 0); tone(1400 + q * 600, 0.05, 0.25); },
  mitt: () => { noise(0.07, 420, 1.4, 1.1, 0); tone(160, 0.08, 0.3); },
  whiff: () => noise(0.32, 700, 0.6, 0.35, 0.45),
  cheer: (big) => noise(big ? 3.6 : 1.8, 1000, 0.35, big ? 0.6 : 0.3, 0.12),
  organ: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.25, 0.12), i * 140))
};

// ---------- 연결 ----------
const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true });
// 폰마다 마지막으로 신호가 온 시각과, 스윙이 도착하기까지 걸린 지연(ms) 추정값
const lastSeen = {};
const lagEst = {};
let players = [];
const rtts = [];
function displayRtt() {
  if (!rtts.length) return 40;
  const s = [...rtts].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
setInterval(() => {
  const t0 = performance.now();
  socket.timeout(2000).emit('ping_rtt', t0, (err) => {
    if (err) return;
    rtts.push(performance.now() - t0);
    if (rtts.length > 7) rtts.shift();
  });
}, 1500);

socket.on('connect', () => {
  let saved = null;
  try { saved = sessionStorage.getItem('pcg-room'); } catch (e) {}
  socket.emit('join', { role: 'display', game: 'baseball', room: saved });
});
socket.on('room', async (r) => {
  try { sessionStorage.setItem('pcg-room', r.code); } catch (e) {}
  players = r.players;
  // 서버가 다시 떠서 방이 새로 만들어졌으면 진행 중이던 경기는 대기실로 돌립니다.
  if (r.fresh && game.phase !== 'lobby') backToLobby();
  $('code').textContent = r.code;
  $('codeMini').textContent = r.code;
  const res = await fetch(`/api/qr?room=${r.code}`).then((x) => x.json());
  $('qr').src = res.qr;
  $('qrMini').src = res.qr;
  $('url').textContent = res.url.replace(/^https?:\/\//, '');
  $('warn').classList.toggle('hidden', res.secure);
  renderPlayers();
  pushState();
});
socket.on('players', (p) => {
  const before = new Set(players.map((x) => x.slot));
  players = p.players;
  for (const pl of players) {
    if (!before.has(pl.slot)) tone(880, 0.12, 0.15);
    // 투타 대결은 시작할 때 순서를 정하므로 중간에 들어온 폰은 다음 경기부터 합니다.
    if (game.phase === 'playing' && game.mode === 'derby') addToOrder(pl.slot);
  }
  renderPlayers();
  pushState();
});
socket.on('display_replaced', () => $('replaced').classList.remove('hidden'));
socket.on('start_game', (d) => startGame(d && d.slot));
socket.on('swing', (d) => {
  lastSeen[d.slot] = performance.now();
  onSwing(d, false);
});
socket.on('ready', (d) => { lastSeen[d.slot] = performance.now(); });
socket.on('throw', (d) => {
  lastSeen[d.slot] = performance.now();
  onThrow(d, false);
});
socket.on('mode', (d) => setMode(d && d.mode));

// 봇에게는 보내지 않습니다(서버는 모르는 자리 번호를 방 전체로 보내기 때문).
function toSlot(slot, event, data) {
  if (isBot(slot)) return;
  socket.emit('d2c', { event, slot, data });
}

function backToLobby() {
  game.phase = 'lobby';
  game.sub = 'idle';
  game.pitch = null;
  game.order = [];
  game.scores = {};
  game.duel = null;
  view.clearHit();
  hideDuel();
  $('hud').classList.add('hidden');
  $('join').classList.add('hidden');
  $('over').classList.add('hidden');
  $('stats').classList.remove('on');
  $('timing').classList.remove('on');
  $('lobby').classList.remove('hidden');
  renderPlayers();
  pushState();
}
// 서버보다 빨리 끊김을 알아채려고, 1초마다 오는 폰 신호가 3.5초 넘게 없으면 끊긴 것으로 봅니다.
function alive(slot) {
  if (!playerInfo(slot).connected) return false;
  const t = lastSeen[slot];
  return t == null || performance.now() - t < 3500;
}

function playerInfo(slot) {
  return players.find((p) => p.slot === slot) || bots.find((b) => b.slot === slot) ||
    { slot, name: `${slot}P`, color: '#8a96a8', connected: false };
}

function renderPlayers() {
  const box = $('slots');
  box.innerHTML = '';
  for (let s = 1; s <= 4; s++) {
    const p = players.find((x) => x.slot === s);
    const el = document.createElement('div');
    el.className = 'slot' + (p ? ' on' : '') + (p && !p.connected ? ' away' : '');
    if (p) {
      el.style.setProperty('--c', p.color);
      el.innerHTML = `<b>${p.name}</b>`;
    } else {
      el.textContent = `${s}P 비어 있음`;
    }
    box.appendChild(el);
  }
  for (const b of bots) {
    const el = document.createElement('div');
    el.className = 'slot on bot';
    el.style.setProperty('--c', b.color);
    el.innerHTML = `<b>${b.name}</b>`;
    box.appendChild(el);
  }
  renderMode();
  renderBoard();
}

// ---------- 모드 ----------
function renderMode() {
  document.body.dataset.mode = game.mode;
  for (const el of document.querySelectorAll('.mode')) el.classList.toggle('on', el.dataset.mode === game.mode);
}

function setMode(m) {
  if ((m !== 'derby' && m !== 'duel') || game.phase === 'playing' || game.mode === m) return;
  // 경기 끝 화면에서 바꾸면 대기실로 돌아갑니다.
  if (game.phase === 'over') backToLobby();
  game.mode = m;
  tone(m === 'duel' ? 660 : 520, 0.1, 0.12);
  renderMode();
  pushState();
}
for (const el of document.querySelectorAll('.mode')) {
  el.addEventListener('click', () => {
    audio();
    setMode(el.dataset.mode);
    el.blur();
  });
}

// ---------- 경기 진행 ----------
const game = {
  phase: 'lobby',
  mode: 'derby', // 'derby' 홈런 더비 | 'duel' 투타 대결
  duel: null, // 투타 대결 상태(duel.js 의 newDuel)
  order: [],
  turn: 0,
  left: 0,
  scores: {},
  sub: 'idle',
  pitch: null,
  hit: null,
  waitUntil: 0
};

function addToOrder(slot) {
  if (game.order.includes(slot)) return;
  game.order.push(slot);
  game.scores[slot] = { hr: 0, longest: 0, total: 0, marks: [] };
}

const batter = () => (game.mode === 'duel' && game.duel ? (half(game.duel) || {}).bat : game.order[game.turn]);

function pushState() {
  if (game.mode === 'duel' && game.duel && game.phase !== 'lobby') {
    pushDuelState();
    return;
  }
  const scores = {};
  for (const [s, v] of Object.entries(game.scores)) scores[s] = { hr: v.hr, longest: Math.round(v.longest) };
  socket.emit('d2c', {
    event: 'game_state',
    data: { phase: game.phase, mode: game.mode, batter: game.phase === 'playing' ? batter() : null, left: game.left, scores }
  });
}

function startGame(fromSlot) {
  if (game.phase === 'playing') return;
  if (game.mode === 'duel') {
    startDuel(fromSlot);
    return;
  }
  const connected = players.filter((p) => p.connected).map((p) => p.slot).concat(bots.map((b) => b.slot));
  if (!connected.length) {
    callout('폰을 먼저 연결해 주세요', 'QR을 찍고 시작하기를 누르면 자리가 생겨요', 'miss', 2000);
    return;
  }
  audio();
  cutNext = true;
  game.phase = 'playing';
  game.order = [];
  game.scores = {};
  connected.forEach(addToOrder);
  game.turn = 0;
  game.left = PITCHES_PER_TURN;
  hideDuel();
  $('lobby').classList.add('hidden');
  $('over').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('join').classList.remove('hidden');
  sfx.organ();
  announceBatter();
}

function announceBatter() {
  const p = playerInfo(batter());
  document.documentElement.style.setProperty('--c', p.color);
  $('bName').textContent = p.name;
  $('bPitch').innerHTML = '';
  view.setBatter(p.color);
  view.clearHit();
  $('stats').classList.remove('on');
  $('timing').classList.remove('on');
  callout(p.name, `타석에 들어섭니다 · ${PITCHES_PER_TURN}구`, 'player', 1700);
  view.drawBoard({ name: p.name, color: p.color, sub: `HR ${game.scores[batter()].hr} · 남은 공 ${game.left}` });
  game.sub = 'idle';
  game.pitch = null;
  game.waitUntil = performance.now() + 2000;
  pushState();
  renderBoard();
}

function endGame() {
  game.phase = 'over';
  game.sub = 'idle';
  game.pitch = null;
  view.clearHit();
  $('hud').classList.add('hidden');
  $('join').classList.add('hidden');
  $('stats').classList.remove('on');
  $('timing').classList.remove('on');
  const ranked = [...game.order].sort((a, b) => {
    const x = game.scores[a];
    const y = game.scores[b];
    return y.hr - x.hr || y.longest - x.longest;
  });
  const box = $('podium');
  box.innerHTML = '';
  ranked.forEach((slot, i) => {
    const p = playerInfo(slot);
    const sc = game.scores[slot];
    const el = document.createElement('div');
    el.className = 'r';
    el.style.setProperty('--c', p.color);
    el.style.animationDelay = `${0.15 + i * 0.12}s`;
    el.innerHTML = `<span class="rank">${i + 1}</span><span class="who">${p.name}</span>` +
      `<span class="num"><b>${sc.hr}</b><span>홈런</span></span>` +
      `<span class="num"><b>${sc.longest ? Math.round(sc.longest) : '-'}</b><span>최장(m)</span></span>`;
    box.appendChild(el);
  });
  const win = playerInfo(ranked[0]);
  view.drawBoard({ big: `${win.name} WINS`, sub: `${game.scores[ranked[0]].hr} HOME RUNS`, color: win.color });
  view.fireworks(win.color);
  $('over').classList.remove('hidden');
  sfx.cheer(true);
  sfx.organ();
  pushState();
}

function pickPitch() {
  const total = PITCH_TYPES.reduce((a, t) => a + t.w, 0);
  let r = Math.random() * total;
  const t = PITCH_TYPES.find((x) => (r -= x.w) < 0) || PITCH_TYPES[0];
  const kmh = t.kmh[0] + Math.random() * (t.kmh[1] - t.kmh[0]);
  const dist = Math.hypot(RELEASE[2], RELEASE[1] - 0.9);
  return { type: t, kmh, ms: (dist / (kmh / 3.6)) * 1000, endX: (Math.random() - 0.5) * 0.36, endY: 0.68 + Math.random() * 0.36 };
}

function nextPitch(now) {
  const slot = batter();
  if (!alive(slot)) {
    // 타자 폰이 끊겼으면 잠깐 기다렸다가 다음 타자로 넘깁니다.
    if (!game.pitch || game.pitch.waitingSince == null) {
      game.pitch = { waitingSince: now };
      callout(`${slot}P 연결을 기다려요`, '15초 안에 돌아오지 않으면 다음 타자로 넘어가요', 'miss', 2500);
    }
    if (now - game.pitch.waitingSince > 15000) {
      game.left = 0;
      finishPitch(now);
    }
    return;
  }
  const p = pickPitch();
  const windup = 1500 + Math.random() * 700;
  game.pitch = { ...p, start: now, release: now + windup, cross: now + windup + p.ms, swing: null, resolved: false };
  game.sub = 'pitch';
  view.clearHit();
  $('stats').classList.remove('on');
  $('timing').classList.remove('on');
  setTimeout(() => {
    if (game.pitch && game.pitch.start === now) {
      toSlot(slot, 'pitch', { label: `${p.type.name} ${Math.round(p.kmh)}` });
      $('bPitch').innerHTML = `${p.type.name}<b>${Math.round(p.kmh)} km/h</b>`;
    }
  }, windup);
}

function onSwing(d, local) {
  if (game.phase !== 'playing' || d.slot !== batter() || game.sub !== 'pitch') return;
  const pt = game.pitch;
  if (!pt || pt.resolved || pt.release == null) return;
  const arrived = performance.now();
  // 폰에서 휘두른 순간 = 도착 시각 - 폰 쪽 지연 - 화면 쪽 지연
  const lag = local ? 0 : (Number(d.ago) || 0) + (Number(d.rtt) || 80) / 2 + displayRtt() / 2;
  if (!local) lagEst[d.slot] = Math.min(800, lag);
  const at = arrived - lag;
  // 공을 놓기 전 스윙은 연습 스윙으로 보고 넘깁니다.
  if (at < pt.release) return;
  const err = (at - pt.cross) / 1000;
  const hit = Math.abs(err) <= HIT_WINDOW;
  // 이미 받은 스윙이 있으면, 공이 오는 순간에 더 가까운 쪽을 씁니다.
  if (pt.swing && Math.abs(pt.swing.err) <= Math.abs(err)) return;
  pt.swing = {
    at, err, hit, shown: arrived,
    power: Math.max(0.1, Math.min(1, Number(d.power) || 0.5)),
    // 맞은 공은 방망이가 공이 오는 순간 맞닿게, 헛스윙은 실제 휘두른 순간에 맞춰 그립니다.
    anchor: hit ? Math.max(pt.cross, arrived) : Math.max(at, arrived - 120)
  };
}

function gauss() {
  return (Math.random() + Math.random() + Math.random() - 1.5) / 0.5;
}

// 공기 저항을 넣은 타구 궤적. 각도가 높으면 더 빨리 꺾입니다. +spray 가 좌익수 쪽입니다.
function flight(start, evKmh, la, spray) {
  const v = evKmh / 3.6;
  const k = 0.0045 * (1 + Math.max(0, la - 32) / 20);
  const vh = v * Math.cos(la * RD);
  let vx = vh * Math.sin(spray * RD);
  let vz = vh * Math.cos(spray * RD);
  let vy = v * Math.sin(la * RD);
  let [x, y, z] = start;
  const dt = 1 / 120;
  const pts = [[x, y, z]];
  for (let t = 0; t < 9 && y > 0; t += dt) {
    const sp = Math.hypot(vx, vy, vz);
    vx -= k * sp * vx * dt;
    vz -= k * sp * vz * dt;
    vy -= (9.8 + k * sp * vy) * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    pts.push([x, Math.max(0.05, y), z]);
  }
  return pts;
}

function timingFeedback(err) {
  const ms = Math.round(err * 1000);
  const pos = Math.max(-1, Math.min(1, err / HIT_WINDOW));
  $('tMark').style.left = `${50 + pos * 46}%`;
  let label;
  if (Math.abs(err) <= SWEET) label = `완벽한 타이밍 (${ms > 0 ? '+' : ''}${ms}ms)`;
  else if (err < 0) label = `${Math.abs(ms)}ms 빨라요`;
  else label = `${ms}ms 늦어요`;
  $('tLabel').textContent = label;
  $('timing').classList.add('on');
}

// 맞은 공의 타구. 일찍 치면 당겨서(좌측), 늦으면 밀어서(우측) 갑니다.
// mod 는 투타 대결용 보정: q(타구 질 배수), la(발사각 더하기), noSweet(정타 없음). 홈런 더비는 mod 없이 부릅니다.
function batted(pt, sw, mod = {}) {
  const err = sw.err;
  const q = Math.max(0, 1 - Math.abs(err) / HIT_WINDOW) * (mod.q ?? 1);
  const sweet = Math.abs(err) < SWEET && !mod.noSweet;
  const spray = -(err / 0.1) * 32 + (Math.random() - 0.5) * 10;
  const la = (sweet ? 23 + Math.random() * 11 : 18 + gauss() * (8 + 28 * (1 - q))) + (mod.la || 0);
  const ev = (100 + 80 * sw.power) * (0.62 + 0.38 * q) * (sweet ? 1.04 : 1);
  const path = flight([pt.endX, pt.endY, 0.1], ev, la, spray);
  const last = path[path.length - 1];
  const dist = Math.hypot(last[0], last[2]);
  const foul = Math.abs(spray) > 45;
  const homer = !foul && dist > fenceDist(spray);
  return { q, spray, la, ev, path, dist, foul, homer };
}

function resolvePitch(now) {
  if (game.mode === 'duel') {
    resolveDuelPitch(now);
    return;
  }
  const pt = game.pitch;
  pt.resolved = true;
  const sw = pt.swing;
  const slot = batter();
  if (sw) timingFeedback(sw.err);
  if (!sw || !sw.hit) {
    sfx.mitt();
    if (sw) sfx.whiff();
    const text = sw ? '헛스윙' : '스트라이크';
    const sub = sw ? (sw.err < 0 ? '너무 빨랐어요' : '너무 늦었어요') : '공이 오면 휘둘러요';
    callout(text, sub, 'miss', 1300);
    game.scores[slot].marks.push('miss');
    toSlot(slot, 'result', { text, contact: false });
    game.sub = 'after';
    game.waitUntil = now + 1700;
    renderBoard();
    return;
  }
  // 맞았습니다.
  const { q, spray, la, ev, path, dist, foul, homer } = batted(pt, sw);
  let text;
  if (foul) text = '파울';
  else if (homer) text = 'HOME RUN';
  else if (la < 9) text = ev > 150 ? '안타' : '땅볼';
  else if (la > 50) text = '내야 플라이';
  else if (dist > 85) text = '2루타';
  else if (dist > 45) text = '안타';
  else text = '내야 땅볼';
  const sc = game.scores[slot];
  if (!foul) {
    sc.longest = Math.max(sc.longest, dist);
    sc.total += dist;
  }
  if (homer) sc.hr += 1;
  sc.marks.push(homer ? 'hr' : 'used');
  const p = playerInfo(slot);
  game.hit = { path, t0: now, dist, homer, foul, text, ev, la, spray, q, landed: false };
  game.sub = 'hit';
  view.startHit(path, { homer, foul, color: homer ? '#ffd23a' : p.color });
  view.resetFollow();
  sfx.crack(q);
  if (homer || dist > 80) sfx.cheer(homer);
  $('sDist').textContent = foul ? '-' : `${Math.round(dist)}m`;
  $('sEv').textContent = `${Math.round(ev)}km/h`;
  $('sLa').textContent = `${Math.round(la)}°`;
  const phoneText = foul ? '파울' : homer ? `홈런! ${Math.round(dist)}m` : `${text} ${Math.round(dist)}m`;
  toSlot(slot, 'result', { text: phoneText, contact: true, homer, quality: q });
}

function finishPitch(now) {
  if (game.mode === 'duel') {
    finishDuelPitch(now);
    return;
  }
  game.hit = null;
  game.left -= 1;
  $('live').textContent = '';
  if (game.left <= 0) {
    game.turn += 1;
    if (game.turn >= game.order.length) {
      endGame();
      return;
    }
    game.left = PITCHES_PER_TURN;
    announceBatter();
    return;
  }
  game.pitch = null;
  game.sub = 'idle';
  game.waitUntil = now + 700;
  const p = playerInfo(batter());
  view.drawBoard({ name: p.name, color: p.color, sub: `HR ${game.scores[batter()].hr} · 남은 공 ${game.left}` });
  pushState();
  renderBoard();
}

// ---------- 투타 대결 ----------
// 한 하프 이닝 = 한 사람이 타석에 계속 서고, 다른 한 사람이 던집니다. 3아웃 또는 6타석이면 공수 교대.
// 한 사람당 두 이닝씩 치고, 투수는 이닝마다 바뀝니다(순서는 duel.js 의 makeSchedule).
let sentRoles = {};

function hideDuel() {
  $('duelHud').classList.add('hidden');
  $('tracker').classList.add('hidden');
  view.setZone(false);
  view.clearMarks();
  view.setRunners(null);
  view.setPitcher(null);
  sentRoles = {};
}

function startDuel(fromSlot) {
  const real = players.filter((p) => p.connected).map((p) => p.slot);
  const order = real.concat(bots.map((b) => b.slot)).slice(0, 4);
  if (order.length < 2) {
    callout('투타 대결은 2명부터', '한 명 더 QR을 찍고 들어와 주세요', 'miss', 2200);
    if (fromSlot) toSlot(fromSlot, 'result', { text: '2명부터 할 수 있어요' });
    return;
  }
  audio();
  cutNext = true;
  game.phase = 'playing';
  game.order = [];
  game.scores = {};
  game.duel = newDuel(order);
  game.pitch = null;
  game.hit = null;
  sentRoles = {};
  $('lobby').classList.add('hidden');
  $('over').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('join').classList.remove('hidden');
  $('duelHud').classList.remove('hidden');
  $('tracker').classList.remove('hidden');
  view.setZone(true);
  sfx.organ();
  announceHalf();
}

function announceHalf() {
  const d = game.duel;
  const h = half(d);
  const b = playerInfo(h.bat);
  const p = playerInfo(h.pit);
  document.documentElement.style.setProperty('--c', b.color);
  view.setBatter(b.color);
  view.setPitcher(p.color);
  view.setRunners(d.bases, b.color);
  view.clearHit();
  view.clearMarks();
  $('stats').classList.remove('on');
  $('timing').classList.remove('on');
  $('dPitch').innerHTML = '';
  callout(b.name, `${h.inning + 1}회 타석 · 투수 ${p.name}`, 'player', 1900);
  setStatus('타석에 들어섭니다');
  game.sub = 'idle';
  game.pitch = null;
  game.waitUntil = performance.now() + 2200;
  drawDuelBoard();
  renderDuel();
  pushState();
}

// 다음 공을 기다립니다. 투수 폰은 game_state 의 sub 'await' 와 n(공 번호)을 보고 던질 준비를 합니다.
function duelNext(now) {
  const d = game.duel;
  const h = half(d);
  if (!alive(h.bat)) {
    if (!game.pitch || game.pitch.waitingSince == null) {
      game.pitch = { waitingSince: now };
      callout(`${playerInfo(h.bat).name} 연결을 기다려요`, '10초 안에 돌아오지 않으면 다음 타석으로 넘어가요', 'miss', 2500);
      setStatus('타자 연결 대기');
    }
    if (now - game.pitch.waitingSince > BATTER_WAIT_MS) endHalf(now, '타자 연결이 끊겨 넘어가요');
    return;
  }
  if (d.clearTrack) {
    d.track = [];
    d.clearTrack = false;
    view.clearMarks();
  }
  d.n += 1;
  game.pitch = { awaitSince: now, n: d.n, botAt: now + 1200 + Math.random() * 1000 };
  game.sub = 'await';
  view.clearHit();
  $('stats').classList.remove('on');
  $('timing').classList.remove('on');
  const p = playerInfo(h.pit);
  if (isBot(h.pit)) setStatus(`${p.name} 투구 준비`);
  else if (!alive(h.pit)) setStatus(`${p.name} 연결 끊김 · 곧 자동 투구`);
  else setStatus(`${p.name} 차례 · 폰에서 코스를 정하고 던져요`, true);
  renderDuel();
  pushState();
}

// 봇·끊긴 투수·오래 안 던지는 투수는 대신 던집니다.
function duelAwait(now) {
  const pt = game.pitch;
  const h = half(game.duel);
  const waited = now - pt.awaitSince;
  let auto = null;
  if (isBot(h.pit)) {
    if (now >= pt.botAt) auto = '';
  } else if (!alive(h.pit)) {
    if (waited > AUTO_GONE_MS) auto = '자동 투구';
  } else if (waited > AUTO_IDLE_MS) {
    auto = '시간 초과 · 자동 투구';
  }
  if (auto == null) return;
  onThrow({ ...randomThrow(), slot: h.pit, n: pt.n, auto: auto || null }, true);
}

function throwRandom(opts) {
  if (game.phase !== 'playing' || game.mode !== 'duel' || game.sub !== 'await' || !game.pitch) return false;
  onThrow({ ...randomThrow(), ...(opts || {}), slot: half(game.duel).pit, n: game.pitch.n }, true);
  return true;
}

// 투수 폰에서 온 공. d = { speed(km/h), type, side, aimX, aimY(-1~1, 포수 시점), ago, rtt, n }
function onThrow(d, local) {
  if (game.phase !== 'playing' || game.mode !== 'duel' || game.sub !== 'await' || !game.duel) return;
  const h = half(game.duel);
  const wait = game.pitch;
  if (!h || !wait || d.slot !== h.pit) return;
  // 지난 공에 대한 늦은 신호는 버립니다.
  if (d.n != null && Number(d.n) !== wait.n) return;
  const now = performance.now();
  const kind = Object.hasOwn(PITCHES, d.type) ? d.type : 'fastball';
  const t = PITCHES[kind];
  const kmh = clamp(Number(d.speed) || (t.kmh[0] + t.kmh[1]) / 2, 80, 165);
  const side = Number(d.side) < 0 ? -1 : 1;
  // 노린 곳에서 제구 오차만큼 흔들립니다.
  const [ax, ay] = aimToPlate(d.aimX, d.aimY);
  const sig = controlSigma(kmh, kind);
  const endX = clamp(ax + gauss() * sig, -0.9, 0.9);
  const endY = clamp(ay + gauss() * sig, 0.12, 1.7);
  // 폰에서 실제로 던진 순간부터 DUEL_WINDUP 뒤에 공이 나가도록, 이미 지난 지연만큼 와인드업을 줄입니다.
  const lag = local ? 0 : Math.min(800, (Number(d.ago) || 0) + (Number(d.rtt) || 80) / 2 + displayRtt() / 2);
  const wind = clamp(DUEL_WINDUP - lag, DUEL_MIN_WIND, DUEL_WINDUP);
  const dist = Math.hypot(RELEASE[2], RELEASE[1] - 0.9);
  const ms = (dist / (kmh / 3.6)) * 1000;
  game.pitch = { duel: true, kind, type: t, side, kmh, ms, endX, endY, n: wait.n,
    start: now, wind, release: now + wind, cross: now + wind + ms, swing: null, resolved: false };
  game.sub = 'pitch';
  const name = kind === 'slider' && side < 0 ? '역슬라이더' : t.name;
  setStatus(d.auto ? d.auto : '투구!', true);
  toSlot(h.pit, 'result', { text: `${name} ${Math.round(kmh)}km/h` });
  setTimeout(() => {
    if (game.pitch && game.pitch.start === now) {
      toSlot(h.bat, 'pitch', { label: `${name} ${Math.round(kmh)}` });
      $('dPitch').innerHTML = `${name}<b>${Math.round(kmh)} km/h</b>`;
    }
  }, wind);
  pushState();
}

// 봇 타자: 존 안 공은 대부분, 존 밖 공은 가끔 휘두릅니다.
function botSwing(pt, now) {
  const slot = batter();
  if (!isBot(slot) || !pt || pt.release == null || now < pt.release || pt.resolved) return;
  if (!pt.bot) {
    const miss = pt.duel ? zoneMiss(pt.endX, pt.endY) : 0;
    const chance = miss === 0 ? 0.85 : miss < 0.15 ? 0.45 : 0.12;
    pt.bot = { at: Math.random() < chance ? pt.cross + gauss() * 55 : Infinity };
  }
  if (now >= pt.bot.at) {
    pt.bot.at = Infinity;
    onSwing({ slot, power: 0.6 + Math.random() * 0.35 }, true);
  }
}

function resolveDuelPitch(now) {
  const pt = game.pitch;
  pt.resolved = true;
  const sw = pt.swing;
  const h = half(game.duel);
  const miss = zoneMiss(pt.endX, pt.endY);
  if (sw) timingFeedback(sw.err);
  // 안 휘둘렀거나, 헛스윙이거나, 방망이가 닿지 않을 만큼 먼 공
  if (!sw || !sw.hit || miss > REACH) {
    sfx.mitt();
    if (sw) sfx.whiff();
    const kind = !sw ? (miss === 0 ? 'strike' : 'ball') : 'whiff';
    track(pt, kind === 'ball' ? 'ball' : 'strike');
    view.markPitch(pt.endX, pt.endY, kind === 'ball' ? '#5ee07a' : '#ff7a7e');
    let sub = '';
    if (kind === 'strike') sub = '루킹';
    else if (sw && sw.hit) sub = '공이 너무 멀어요';
    else if (sw) sub = sw.err < 0 ? '너무 빨랐어요' : '너무 늦었어요';
    duelApply({ kind }, now, sub);
    return;
  }
  // 맞았습니다. 존 밖이면 덜 맞고, 늦게 꺾이는 공일수록 정타가 어렵습니다. 높은 공은 뜨고 낮은 공은 굴러갑니다.
  const t = pt.type;
  const weak = 1 - Math.min(0.65, (miss / REACH) * 0.65);
  const b = batted(pt, sw, { q: t.contact * weak, la: t.la + (pt.endY - PAD.cy) * 15, noSweet: miss > 0 });
  let path = b.path;
  let caught = false;
  if (!b.foul && !b.homer && b.la >= 9) {
    const c = catchPoint(path, FIELD_SPOTS);
    if (c.caught || (b.la > 50 && b.dist < 60)) {
      caught = true;
      path = path.slice(0, c.index + 1);
    }
  }
  const out = battedOutcome({ ...b, fence: fenceDist(b.spray), caught });
  track(pt, b.foul ? 'foul' : 'play');
  const end = path[path.length - 1];
  const dist = caught ? Math.hypot(end[0], end[2]) : b.dist;
  const p = playerInfo(h.bat);
  game.hit = { path, t0: now, dist, homer: b.homer, foul: b.foul, text: out.text, ev: b.ev, la: b.la, spray: b.spray,
    q: b.q, landed: false, outcome: out, caught };
  game.sub = 'hit';
  view.startHit(path, { homer: b.homer, foul: b.foul, color: b.homer ? '#ffd23a' : p.color });
  view.resetFollow();
  sfx.crack(b.q);
  if (b.homer || b.dist > 80) sfx.cheer(b.homer);
  $('sDist').textContent = b.foul ? '-' : `${Math.round(dist)}m`;
  $('sEv').textContent = `${Math.round(b.ev)}km/h`;
  $('sLa').textContent = `${Math.round(b.la)}°`;
  setStatus('타구!', true);
  const phoneText = b.foul ? '파울' : b.homer ? `홈런! ${Math.round(dist)}m` : out.text;
  toSlot(h.bat, 'result', { text: phoneText, contact: true, homer: b.homer, quality: b.q });
}

// 친 공이 떨어지거나 잡힌 순간 결과를 반영합니다.
function duelLanded(hit) {
  const now = performance.now();
  const h = half(game.duel);
  const p = playerInfo(h.bat);
  if (hit.homer) {
    view.fireworks(p.color);
    sfx.organ();
  }
  duelApply(hit.outcome, now, '', hit);
}

const PITCHER_TEXT = { ball: '볼', strike: '스트라이크!', whiff: '헛스윙 유도!', k: '삼진!', walk: '볼넷 허용', foul: '파울' };

// 공 하나의 결과를 반영하고 알립니다. hit 은 친 공일 때만 옵니다.
function duelApply(ev, now, sub, hit) {
  const d = game.duel;
  const h = half(d);
  const bat = playerInfo(h.bat);
  const pit = playerInfo(h.pit);
  const r = applyPitch(d, ev);
  const count = `${d.b}볼 ${d.s}스트라이크 · ${d.o}아웃`;
  let line = sub || count;
  let kind = 'miss';
  if (r.tag === 'k') line = `${pit.name} 탈삼진 · ${d.o}아웃`;
  else if (r.tag === 'walk') line = r.runs ? `밀어내기 ${r.runs}점` : '1루로 걸어 나가요';
  else if (r.tag === 'out') line = `${d.o}아웃`;
  else if (r.tag === 'hit') {
    kind = '';
    line = r.runs ? `${r.runs}점!` : `${Math.round(hit.dist)}m`;
    if (r.runs) sfx.cheer(r.runs >= 2);
  }
  if (hit && hit.homer) callout('HOME RUN', r.runs > 1 ? `${r.runs}점 홈런!` : `${Math.round(hit.dist)}m`, 'hr', 2600);
  else callout(r.text, line, kind, r.paEnd ? 1900 : 1300);
  if (hit && hit.homer) view.drawBoard({ big: 'HOME RUN', sub: `${bat.name} · ${r.runs}점`, color: '#ffd23a' });
  else drawDuelBoard();
  // 폰으로: 타자는 결과와 점수, 투수는 던진 쪽에서 본 결과
  const runs = r.runs ? ` · ${r.runs}점` : '';
  if (hit) {
    if (!hit.foul) toSlot(h.bat, 'result', { text: `${r.text}${runs}` });
  } else {
    toSlot(h.bat, 'result', { text: r.text, contact: false });
  }
  let pText = PITCHER_TEXT[r.tag] || r.text;
  if (r.tag === 'out') pText = `${r.text}!`;
  if (r.tag === 'hit') pText = `${r.text} 허용`;
  toSlot(h.pit, 'result', { text: `${pText}${r.runs ? ` · ${r.runs}실점` : ''}` });
  setStatus(r.runs ? `${r.text} · ${r.runs}점` : r.text);
  d.halfOver = r.halfEnd;
  if (r.paEnd) d.clearTrack = true;
  view.setRunners(d.bases, bat.color);
  if (!hit) {
    game.sub = 'after';
    game.waitUntil = now + (r.paEnd ? 1900 : 1300);
  }
  renderDuel();
  pushState();
}

function finishDuelPitch(now) {
  game.hit = null;
  $('live').textContent = '';
  const d = game.duel;
  if (d.halfOver) {
    d.halfOver = false;
    endHalf(now);
    return;
  }
  game.pitch = null;
  game.sub = 'idle';
  game.waitUntil = now + 500;
  drawDuelBoard();
  renderDuel();
}

function endHalf(now, why) {
  const d = game.duel;
  const h = half(d);
  const b = playerInfo(h.bat);
  const runs = d.line[h.bat][h.inning] || 0;
  const last = d.hi >= d.schedule.length - 1;
  callout(last ? '경기 끝' : '공수 교대', why || `${b.name} 이번 이닝 ${runs}점`, 'miss', 1900);
  setStatus(last ? '경기 끝' : '공수 교대');
  game.sub = 'change';
  game.pitch = null;
  game.hit = null;
  game.waitUntil = now + 2100;
  view.clearHit();
  pushState();
}

function endDuel() {
  const d = game.duel;
  game.phase = 'over';
  game.sub = 'idle';
  game.pitch = null;
  view.clearHit();
  hideDuel();
  $('join').classList.add('hidden');
  $('stats').classList.remove('on');
  $('timing').classList.remove('on');
  const ranked = ranking(d);
  const box = $('podium');
  box.innerHTML = '';
  const num = (v, label) => `<span class="num"><b>${v}</b><span>${label}</span></span>`;
  ranked.forEach((slot, i) => {
    const p = playerInfo(slot);
    const st = d.stats[slot];
    const el = document.createElement('div');
    el.className = 'r';
    el.style.setProperty('--c', p.color);
    el.style.animationDelay = `${0.15 + i * 0.12}s`;
    el.innerHTML = `<span class="rank">${i + 1}</span><span class="who">${p.name}</span>` +
      num(st.r, '득점') + num(st.h, '안타') + num(st.hr, '홈런') + num(st.so, '탈삼진');
    box.appendChild(el);
  });
  const win = playerInfo(ranked[0]);
  const wr = d.stats[ranked[0]].r;
  view.drawBoard({ big: `${win.name} WINS`, sub: `${wr} RUN${wr === 1 ? '' : 'S'}`, color: win.color });
  view.fireworks(win.color);
  $('over').classList.remove('hidden');
  sfx.cheer(true);
  sfx.organ();
  pushState();
}

function pushDuelState() {
  const d = game.duel;
  const h = game.phase === 'playing' ? half(d) : null;
  const roles = {};
  for (const s of d.order) roles[s] = !h ? 'wait' : s === h.bat ? 'bat' : s === h.pit ? 'pitch' : 'wait';
  const score = {};
  const names = {};
  for (const s of d.order) {
    const st = d.stats[s];
    score[s] = { r: st.r, h: st.h, hr: st.hr, k: st.so };
    names[s] = playerInfo(s).name;
  }
  socket.emit('d2c', {
    event: 'game_state',
    data: {
      phase: game.phase,
      mode: 'duel',
      sub: game.sub,
      n: game.pitch && game.pitch.n != null ? game.pitch.n : null,
      batter: h ? h.bat : null,
      pitcher: h ? h.pit : null,
      roles,
      count: { b: d.b, s: d.s, o: d.o },
      bases: d.bases.slice(),
      inning: h ? h.inning + 1 : RULES.INNINGS,
      innings: RULES.INNINGS,
      half: Math.min(d.hi + 1, d.schedule.length),
      halves: d.schedule.length,
      score,
      names,
      scores: {}
    }
  });
  // 역할이 바뀐 폰에만 role 을 따로 보냅니다. 다시 붙은 폰은 game_state 의 roles 로 압니다.
  for (const p of players) {
    const role = roles[p.slot] || 'wait';
    if (sentRoles[p.slot] !== role) {
      sentRoles[p.slot] = role;
      toSlot(p.slot, 'role', { role });
    }
  }
}

function setStatus(text, go) {
  const el = $('dStatus');
  el.textContent = text;
  el.classList.toggle('go', Boolean(go));
}

function track(pt, cls) {
  game.duel.track.push({ x: pt.endX, y: pt.endY, cls });
  renderTracker();
}

// 투구 위치판(포수 시점). 왼쪽 위가 조준판의 (-1, 1) 입니다.
function renderTracker() {
  const box = $('tkDots');
  box.innerHTML = '';
  const d = game.duel;
  if (!d) return;
  d.track.forEach((m, i) => {
    const [ax, ay] = plateToAim(m.x, m.y);
    const el = document.createElement('i');
    el.className = m.cls + (i === d.track.length - 1 ? ' last' : '');
    el.style.left = `${50 + clamp(ax, -0.93, 0.93) * 50}%`;
    el.style.top = `${50 - clamp(ay, -0.93, 0.93) * 50}%`;
    el.textContent = i + 1;
    box.appendChild(el);
  });
}

function renderDuel() {
  const d = game.duel;
  if (!d) return;
  const h = half(d) || d.schedule[d.schedule.length - 1];
  const cols = Array.from({ length: RULES.INNINGS }, (_, i) => `<th>${i + 1}</th>`).join('');
  $('dHead').innerHTML = `<th class="inn">${h.inning + 1}회 · ${Math.min(d.pa + 1, RULES.MAX_PA)}번째 타석</th>${cols}<th>R</th><th>H</th>`;
  $('dRows').innerHTML = d.order.map((slot) => {
    const p = playerInfo(slot);
    const st = d.stats[slot];
    const tag = slot === h.bat ? '<em class="bat">타석</em>' : slot === h.pit ? '<em>투구</em>' : '';
    const cells = d.line[slot].map((v) => (v == null ? '<td class="dim">-</td>' : `<td>${v}</td>`)).join('');
    return `<tr class="${slot === h.bat ? 'now' : ''}"><td class="who"><i style="background:${p.color}"></i>${p.name}${tag}</td>` +
      `${cells}<td class="r">${st.r}</td><td>${st.h}</td></tr>`;
  }).join('');
  const dots = (sel, n) => document.querySelectorAll(`.bso .${sel} i`).forEach((el, i) => el.classList.toggle('on', i < n));
  dots('b', d.b);
  dots('s', d.s);
  dots('o', d.o);
  ['dB1', 'dB2', 'dB3'].forEach((id, i) => $(id).classList.toggle('on', d.bases[i]));
  $('dMatch').textContent = `${playerInfo(h.bat).name} 타석 · ${playerInfo(h.pit).name} 투구`;
  renderTracker();
}

function drawDuelBoard() {
  const d = game.duel;
  const h = d && half(d);
  if (!h) return;
  const b = playerInfo(h.bat);
  const p = playerInfo(h.pit);
  view.drawBoard({ title: `INNING ${h.inning + 1} · ${p.name} PITCHING`, name: b.name, color: b.color,
    sub: `${d.b}볼 ${d.s}스트라이크 ${d.o}아웃 · ${d.stats[h.bat].r}점` });
}

// ---------- 화면 글자 ----------
let callTimer = null;
function callout(main, sub, kind, ms) {
  const el = $('call');
  el.className = `call ${kind || ''}`;
  $('callMain').textContent = main;
  $('callSub').textContent = sub || '';
  void el.offsetWidth;
  el.classList.add('on');
  clearTimeout(callTimer);
  callTimer = setTimeout(() => el.classList.remove('on'), ms || 1300);
}

function renderBoard() {
  if (game.mode === 'duel' && game.duel) {
    renderDuel();
    return;
  }
  const b = $('leader');
  b.innerHTML = '';
  for (const slot of game.order) {
    const p = playerInfo(slot);
    const sc = game.scores[slot];
    const row = document.createElement('div');
    row.className = 'row' + (slot === batter() ? ' now' : '');
    row.innerHTML = `<i style="background:${p.color}"></i><span class="n">${p.name}</span>` +
      `<b>${sc.hr}</b><small>${sc.longest ? Math.round(sc.longest) + 'm' : '-'}</small>`;
    b.appendChild(row);
  }
  const sc = game.scores[batter()];
  if (!sc) return;
  $('bHr').textContent = sc.hr;
  $('bLong').textContent = sc.longest ? `${Math.round(sc.longest)}m` : '-';
  const pips = $('pips');
  pips.innerHTML = '';
  for (let i = 0; i < PITCHES_PER_TURN; i++) {
    const m = sc.marks[i];
    const el = document.createElement('i');
    if (m) el.className = m === 'hr' ? 'hr' : 'used';
    pips.appendChild(el);
  }
}

// ---------- 매 프레임 ----------
function ballAt(now) {
  const pt = game.pitch;
  if (!pt || pt.release == null || now < pt.release) return 'hand';
  const u = (now - pt.release) / pt.ms;
  if (u > 1.12) return null;
  if (pt.duel) return pitchPoint(RELEASE, [pt.endX, pt.endY], pt.type, pt.side, u);
  const x = RELEASE[0] + (pt.endX - RELEASE[0]) * u;
  // 직선에 위로 볼록한 성분을 더하면 끝에서 떨어지는 공이 됩니다.
  const y = RELEASE[1] + (pt.endY - RELEASE[1]) * u + pt.type.brk * (u - u * u);
  const z = RELEASE[2] + (0.1 - RELEASE[2]) * u;
  return [x, y, z];
}

function swingT(now) {
  const sw = game.pitch && game.pitch.swing;
  if (!sw || now < sw.shown) return null;
  if (now < sw.anchor) return Math.max(0, 0.5 - (sw.anchor - now) / 360);
  return Math.min(1, 0.5 + (now - sw.anchor) / 700);
}

function pitcherP(now) {
  const pt = game.pitch;
  if (!pt || pt.release == null) return 0;
  const dt = now - pt.release;
  // 투타 대결은 와인드업 길이(pt.wind)가 공마다 다릅니다.
  const w = pt.wind || 1050;
  if (dt < -w) return 0;
  if (dt < 0) return 1 + dt / w;
  return Math.min(1.4, 1 + dt / 900);
}

let cutNext = false;
function tick() {
  const now = performance.now();
  let mode = 'lobby';
  let ball = 'hand';
  let hitI = null;
  let landing = null;
  if (game.phase === 'playing') {
    mode = 'pitch';
    if (game.sub === 'idle' && now >= game.waitUntil) {
      if (game.mode === 'duel') duelNext(now);
      else nextPitch(now);
    } else if (game.sub === 'await') duelAwait(now);
    else if (game.sub === 'pitch') {
      const pt = game.pitch;
      botSwing(pt, now);
      // 스윙이 늦게 도착할 수 있으니(원거리 서버) 스윙이 없거나 너무 빠른 헛스윙이면 예상 지연만큼 더 기다립니다.
      const grace = HIT_WINDOW * 1000 + 90 + (lagEst[batter()] ?? 300) + 60;
      const decideAt = pt.swing && pt.swing.hit ? Math.max(pt.cross, pt.swing.shown) : pt.cross + grace;
      if (!pt.resolved && now >= decideAt) resolvePitch(now);
    } else if (game.sub === 'after' && now >= game.waitUntil) finishPitch(now);
    else if (game.sub === 'hit' && game.hit && game.hit.landed && now - game.hit.landedAt > 2600) finishPitch(now);
    else if (game.sub === 'change' && now >= game.waitUntil) {
      if (nextHalf(game.duel)) announceHalf();
      else endDuel();
    }

    if (game.sub === 'hit' && game.hit) {
      const h = game.hit;
      mode = now - h.t0 > 120 ? 'hit' : 'pitch';
      hitI = Math.min(h.path.length - 1, Math.floor(((now - h.t0) / 1000) * 120 * 1.15));
      ball = h.path[hitI];
      if (!h.foul && !h.landed) $('live').innerHTML = `${Math.round(Math.hypot(ball[0], ball[2]))}<small>m</small>`;
      if (hitI >= h.path.length - 1 && !h.landed) {
        h.landed = true;
        h.landedAt = now;
        $('live').textContent = '';
        const p = playerInfo(batter());
        if (game.mode === 'duel') {
          duelLanded(h);
        } else if (h.homer) {
          callout('HOME RUN', `${Math.round(h.dist)}m`, 'hr', 2600);
          view.fireworks(p.color);
          view.drawBoard({ big: 'HOME RUN', sub: `${p.name} · ${Math.round(h.dist)}m`, color: '#ffd23a' });
          sfx.organ();
        } else {
          callout(h.text, h.foul ? '' : `${Math.round(h.dist)}m`, h.foul ? 'miss' : '', 2000);
        }
        $('stats').classList.add('on');
        $('timing').classList.add('up');
        renderBoard();
        pushState();
      }
      if (h.landed && !h.foul && !h.homer && !h.caught) landing = [h.path[h.path.length - 1][0], h.path[h.path.length - 1][2]];
    } else {
      ball = ballAt(now);
      $('timing').classList.remove('up');
    }
  }
  view.frame(now, {
    mode,
    pitchP: game.phase === 'playing' ? pitcherP(now) : 0,
    ball,
    swingT: game.phase === 'playing' ? swingT(now) : null,
    hitI,
    landing,
    cut: cutNext
  });
  cutNext = false;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startGame();
  if (e.code === 'Space') {
    e.preventDefault();
    if (game.phase === 'playing') onSwing({ slot: batter(), power: 0.85 }, true);
  }
  // 한글 입력 상태에서도 되도록 e.code 로 봅니다.
  if (e.code === 'Digit1' || e.code === 'Numpad1') setMode('derby');
  if (e.code === 'Digit2' || e.code === 'Numpad2') setMode('duel');
  if (e.code === 'KeyP' && !e.repeat) throwRandom();
});

// 시험용: 콘솔에서 상태를 보고 움직일 수 있게 둡니다.
window.__derby = {
  game,
  flight,
  bots,
  rules: RULES,
  batter,
  setMode,
  start: () => startGame(),
  // 투타 대결에서 지금 투수 대신 던지기. opts 로 { type, speed, aimX, aimY, side } 를 정할 수 있습니다.
  throwPitch: (opts) => throwRandom(opts),
  swing: (power = 0.85) => onSwing({ slot: batter(), power }, true)
};
