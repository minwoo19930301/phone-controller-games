// 홈런 더비 큰 화면. 서버는 방과 이벤트만 중계하고, 판정은 모두 여기서 합니다.
import { createScene, fenceDist } from './scene.js';

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
    if (game.phase === 'playing') addToOrder(pl.slot);
  }
  renderPlayers();
  pushState();
});
socket.on('display_replaced', () => $('replaced').classList.remove('hidden'));
socket.on('start_game', () => startGame());
socket.on('swing', (d) => {
  lastSeen[d.slot] = performance.now();
  onSwing(d, false);
});
socket.on('ready', (d) => { lastSeen[d.slot] = performance.now(); });

function backToLobby() {
  game.phase = 'lobby';
  game.sub = 'idle';
  game.pitch = null;
  game.order = [];
  game.scores = {};
  view.clearHit();
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
  return players.find((p) => p.slot === slot) || { slot, name: `${slot}P`, color: '#8a96a8', connected: false };
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
  renderBoard();
}

// ---------- 경기 진행 ----------
const game = {
  phase: 'lobby',
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

const batter = () => game.order[game.turn];

function pushState() {
  const scores = {};
  for (const [s, v] of Object.entries(game.scores)) scores[s] = { hr: v.hr, longest: Math.round(v.longest) };
  socket.emit('d2c', {
    event: 'game_state',
    data: { phase: game.phase, batter: game.phase === 'playing' ? batter() : null, left: game.left, scores }
  });
}

function startGame() {
  if (game.phase === 'playing') return;
  const connected = players.filter((p) => p.connected).map((p) => p.slot);
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
      socket.emit('d2c', { event: 'pitch', slot, data: { label: `${p.type.name} ${Math.round(p.kmh)}` } });
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

function resolvePitch(now) {
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
    socket.emit('d2c', { event: 'result', slot, data: { text, contact: false } });
    game.sub = 'after';
    game.waitUntil = now + 1700;
    renderBoard();
    return;
  }
  // 맞았습니다. 일찍 치면 당겨서(좌측), 늦으면 밀어서(우측) 갑니다.
  const err = sw.err;
  const q = Math.max(0, 1 - Math.abs(err) / HIT_WINDOW);
  const sweet = Math.abs(err) < SWEET;
  const spray = -(err / 0.1) * 32 + (Math.random() - 0.5) * 10;
  const la = sweet ? 23 + Math.random() * 11 : 18 + gauss() * (8 + 28 * (1 - q));
  const ev = (100 + 80 * sw.power) * (0.62 + 0.38 * q) * (sweet ? 1.04 : 1);
  const path = flight([pt.endX, pt.endY, 0.1], ev, la, spray);
  const last = path[path.length - 1];
  const dist = Math.hypot(last[0], last[2]);
  const foul = Math.abs(spray) > 45;
  const homer = !foul && dist > fenceDist(spray);
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
  socket.emit('d2c', { event: 'result', slot, data: { text: phoneText, contact: true, homer, quality: q } });
}

function finishPitch(now) {
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
  if (dt < -1050) return 0;
  if (dt < 0) return 1 + dt / 1050;
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
    if (game.sub === 'idle' && now >= game.waitUntil) nextPitch(now);
    else if (game.sub === 'pitch') {
      const pt = game.pitch;
      // 스윙이 늦게 도착할 수 있으니(원거리 서버) 스윙이 없거나 너무 빠른 헛스윙이면 예상 지연만큼 더 기다립니다.
      const grace = HIT_WINDOW * 1000 + 90 + (lagEst[batter()] ?? 300) + 60;
      const decideAt = pt.swing && pt.swing.hit ? Math.max(pt.cross, pt.swing.shown) : pt.cross + grace;
      if (!pt.resolved && now >= decideAt) resolvePitch(now);
    } else if (game.sub === 'after' && now >= game.waitUntil) finishPitch(now);
    else if (game.sub === 'hit' && game.hit && game.hit.landed && now - game.hit.landedAt > 2600) finishPitch(now);

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
        if (h.homer) {
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
      if (h.landed && !h.foul && !h.homer) landing = [h.path[h.path.length - 1][0], h.path[h.path.length - 1][2]];
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
});

// 시험용: 콘솔에서 상태를 볼 수 있게 둡니다.
window.__derby = { game, flight };
