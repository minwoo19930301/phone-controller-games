// 골프 니어핀 큰 화면: 차례, 타구 계산, 점수. 클럽 움직임은 폰에서 오는 방향을 그대로 씁니다.
import { modal, grit, organ, bell } from '/common/voice.js';
import { createScene, CLUBS } from './scene.js';
import { PIN, TEE_H, WATER_Y, height, surface, slope, pinHeight } from './course.js';
import { analyzeSwing, summarize, renderPanel } from './analysis.js';
import { displayMayReceiveFollow, displayShowsFollow } from './follow-through.mjs';

const ROUNDS = 3;
const RD = Math.PI / 180;
const $ = (id) => document.getElementById(id);

await Promise.race([
  Promise.all([document.fonts.load('400 64px Anton'), document.fonts.load('800 64px "Pretendard Variable"')]),
  new Promise((r) => setTimeout(r, 2000))
]).catch(() => {});
const view = createScene($('cv'));
const PIN_Y = pinHeight();
const PIN_DIST = Math.round(Math.hypot(PIN.x, PIN.z));

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
function noise(sec, freq, q, gain, attack) {
  const a = actx;
  if (!a || a.state !== 'running') return;
  const len = Math.floor(a.sampleRate * sec);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / len;
    d[i] = (Math.random() * 2 - 1) * (attack ? Math.min(1, t / attack) * Math.pow(1 - t, 1.5) : Math.pow(1 - t, 8));
  }
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}
function tone(freq, sec, gain, type = 'sine') {
  const a = actx;
  if (!a || a.state !== 'running') return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + sec);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + sec);
}
const sfx = {
  // 티타늄 드라이버 헤드의 높고 쨍한 '팅'(비조화 배음이 길게 남음)
  strike: (q) => { if (!actx || actx.state !== 'running') return; modal(actx, actx.destination, [[3150, 1, 0.38], [4720, 0.6, 0.3], [7300, 0.35, 0.2], [1880, 0.4, 0.15]], { gain: 0.12 + q * 0.1 }); grit(actx, actx.destination, { sec: 0.02, freq: 5000, gain: 0.3 + q * 0.2 }); },
  whoosh: () => noise(0.5, 900, 0.5, 0.25, 0.5),
  land: () => noise(0.08, 300, 1, 0.5, 0),
  splash: () => noise(0.7, 600, 0.4, 0.6, 0.05),
  clap: (n) => { for (let i = 0; i < n; i++) setTimeout(() => noise(0.04, 1500 + Math.random() * 800, 1, 0.25, 0), Math.random() * 1600); },
  cup: () => { if (!actx || actx.state !== 'running') return; [0, 0.1, 0.17].forEach((w, i) => modal(actx, actx.destination, [[1250 - i * 90, 1, 0.08], [2900, 0.4, 0.05]], { gain: 0.25 - i * 0.06, when: w })); bell(actx, actx.destination, 1568, { when: 0.35, gain: 0.07, ratio: 4, depth: 1.2 }); }
};

// ---------- 연결 ----------
const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true });
let players = [];
socket.on('connect', () => {
  let saved = null;
  try { saved = sessionStorage.getItem('pcg-golf-room'); } catch (e) {}
  socket.emit('join', { role: 'display', game: 'golf', room: saved });
});
socket.on('room', async (r) => {
  try { sessionStorage.setItem('pcg-golf-room', r.code); } catch (e) {}
  players = r.players;
  // 서버가 다시 떠서 방이 새로 만들어졌으면 진행 중이던 경기는 이어 갈 수 없으니 대기실로 돌아갑니다.
  if (r.fresh && game.phase !== 'lobby') backToLobby('서버가 다시 시작돼서 대기실로 돌아왔어요');
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
  players = p.players;
  if (game.phase === 'playing') for (const pl of players) addToOrder(pl.slot);
  renderPlayers();
  pushState();
});
socket.on('display_replaced', () => $('replaced').classList.remove('hidden'));
socket.on('start_game', () => startGame());
socket.on('cancel', (d) => {
  if (!isTurn(d.slot) || (game.sub !== 'aim' && game.sub !== 'swing')) return;
  game.sub = 'aim';
  game.activity = performance.now();
  view.resetSwing();
  view.setAim(game.aim, PIN_DIST);
  prompt(`${playerInfo(d.slot).name} 차례`, '폰에서 방향을 맞추고 어드레스를 눌러요');
  pushState();
});
socket.on('aim', (d) => {
  if (!isTurn(d.slot) || game.sub !== 'aim') return;
  game.activity = performance.now();
  game.aim = Math.max(-25, Math.min(25, Number(d.yaw) || 0));
  view.setAim(game.aim, PIN_DIST);
  renderShotInfo();
});
socket.on('club', (d) => {
  if (!isTurn(d.slot) || !CLUBS[d.club]) return;
  game.club = d.club;
  view.setGolfer(playerInfo(d.slot).color, game.club);
  renderShotInfo();
});
socket.on('address', (d) => {
  if (!isTurn(d.slot) || (game.sub !== 'aim' && game.sub !== 'swing')) return;
  if (CLUBS[d.club] && d.club !== game.club) {
    game.club = d.club;
    view.setGolfer(playerInfo(d.slot).color, game.club);
  }
  if (typeof d.aim === 'number') {
    game.aim = d.aim;
    view.setAim(game.aim, PIN_DIST);
  }
  view.address(d.shaft0 || [0.55, -0.83, 0]);
  game.sub = 'swing';
  game.activity = performance.now();
  pushState();
  prompt('스윙하세요', '폰을 휘두르는 그대로 클럽이 움직여요');
  renderShotInfo();
});
socket.on('pose', (d) => {
  const follow = displayMayReceiveFollow(game.sub, game.flight, performance.now());
  if (!isTurn(d.slot) || (game.sub !== 'swing' && !follow) || !Array.isArray(d.s) || !Array.isArray(d.fc)) return;
  view.pose(d.s, d.fc);
});
let lastAnalysis=null,analysisPanel=null;
$('showAnalysis').addEventListener('click',()=>{if(!lastAnalysis)return;$('analysisDialog').showModal();if(analysisPanel)analysisPanel.dispose();analysisPanel=renderPanel($('analysisPanel'),lastAnalysis,[],{player:playerInfo(game.lastSlot||game.order[game.turn])});});
$('closeAnalysis').addEventListener('click',()=>$('analysisDialog').close());
$('analysisDialog').addEventListener('close',()=>{if(analysisPanel)analysisPanel.dispose();analysisPanel=null;});
socket.on('swing_data',(d)=>{if(!isTurn(d.slot)||!d.samples?.length)return;try{const a=analyzeSwing(d,{club:game.club,impact:game.flight?.shot});lastAnalysis=a;$('showAnalysis').hidden=false;socket.emit('d2c',{event:'analysis',slot:d.slot,data:{summary:summarize(a),score:a.score,tips:a.tips}})}catch(e){console.warn('스윙 분석을 표시하지 못했습니다',e)}});
socket.on('impact', (d) => {
  if (!isTurn(d.slot) || game.sub !== 'swing') return;
  hitShot(d);
});

function playerInfo(slot) {
  return players.find((p) => p.slot === slot) || { slot, name: `${slot}P`, color: '#8a96a8', connected: false };
}
function isTurn(slot) {
  return game.phase === 'playing' && slot === game.order[game.turn];
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

// ---------- 경기 ----------
const game = {
  phase: 'lobby',
  order: [],
  turn: 0,
  round: 1,
  scores: {},
  sub: 'idle',
  aim: 0,
  club: '7i',
  wind: { x: 0, z: 0 },
  shot: 0,
  flight: null,
  waitUntil: 0
};

function addToOrder(slot) {
  if (game.order.includes(slot)) return;
  game.order.push(slot);
  game.scores[slot] = { best: null, shots: [] };
}

function pushState() {
  const scores = {};
  for (const [s, v] of Object.entries(game.scores)) scores[s] = { best: v.best };
  socket.emit('d2c', {
    event: 'game_state',
    data: {
      mode: 'near', phase: game.phase, sub: game.sub, turn: game.phase === 'playing' ? game.order[game.turn] : null,
      round: game.round, rounds: ROUNDS, pin: PIN_DIST, scores, shot: game.shot, lastSlot: game.lastSlot
    }
  });
}

function newWind() {
  const speed = Math.random() * 4.5; // m/s
  const dir = Math.random() * Math.PI * 2;
  game.wind = { x: Math.sin(dir) * speed, z: Math.cos(dir) * speed, speed, dir };
  const kmh = Math.round(speed * 3.6);
  // 화살표 0도 = 그린 쪽(위). 세계 +x 가 화면 왼쪽이라 부호를 뒤집습니다.
  $('windArrow').style.transform = `rotate(${(-dir / RD).toFixed(0)}deg)`;
  $('windV').textContent = kmh ? `${kmh}` : '0';
}

function startGame() {
  if (game.phase === 'playing') return;
  const connected = players.filter((p) => p.connected).map((p) => p.slot);
  if (!connected.length) {
    callout('폰을 먼저 연결해 주세요', 'QR을 찍고 시작하기를 누르면 자리가 생겨요', 'miss', 2200);
    return;
  }
  audio();
  game.phase = 'playing';
  game.order = [];
  game.scores = {};
  connected.forEach(addToOrder);
  game.turn = 0;
  game.round = 1;
  game.shot = 0;
  $('lobby').classList.add('hidden');
  $('over').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('join').classList.remove('hidden');
  view.setMarkers([]);
  newWind();
  cutNext = true;
  beginTurn();
}

function beginTurn() {
  const slot = game.order[game.turn];
  const p = playerInfo(slot);
  document.documentElement.style.setProperty('--c', p.color);
  game.sub = 'aim';
  game.aim = 0;
  game.club = '7i';
  game.flight = null;
  game.shot += 1;
  game.activity = performance.now();
  game.awaySince = null;
  view.resetSwing();
  view.setGolfer(p.color, game.club);
  view.setAim(0, PIN_DIST);
  view.setTrail(null);
  $('shotPanel').classList.remove('on');
  $('pinTag').classList.remove('on');
  $('bName').textContent = p.name;
  $('bRound').textContent = `라운드 ${game.round} / ${ROUNDS}`;
  $('bPin').textContent = PIN_DIST;
  renderShotInfo();
  callout(p.name, '폰에서 방향과 클럽을 고르고 어드레스를 눌러요', 'player', 2200);
  prompt(`${p.name} 차례`, '폰에서 방향을 맞추고 어드레스를 눌러요');
  cutNext = true;
  pushState();
  renderBoard();
}

function nextTurn() {
  game.turn += 1;
  if (game.turn >= game.order.length) {
    game.turn = 0;
    game.round += 1;
    if (game.round > ROUNDS) {
      endGame();
      return;
    }
    newWind();
  }
  beginTurn();
}

function backToLobby(why) {
  game.phase = 'lobby';
  game.sub = 'idle';
  game.order = [];
  game.scores = {};
  view.setTrail(null);
  view.setMarkers([]);
  $('hud').classList.add('hidden');
  $('join').classList.add('hidden');
  $('shotPanel').classList.remove('on');
  $('pinTag').classList.remove('on');
  $('over').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  prompt('', '');
  if (why) callout(why, '', 'miss', 2600);
  renderPlayers();
  pushState();
}

// 차례인 사람이 사라졌거나 너무 오래 아무것도 안 하면 다음 사람으로 넘깁니다.
function watchTurn(now) {
  if (game.phase !== 'playing' || (game.sub !== 'aim' && game.sub !== 'swing')) return;
  const slot = game.order[game.turn];
  const p = players.find((x) => x.slot === slot);
  if (!players.some((x) => x.connected)) {
    if (!game.allGoneSince) game.allGoneSince = now;
    if (now - game.allGoneSince > 20000) backToLobby('모든 폰의 연결이 끊겨 대기실로 돌아왔어요');
    return;
  }
  game.allGoneSince = null;
  if (!p || !p.connected) {
    if (!game.awaySince) {
      game.awaySince = now;
      prompt(`${slot}P 연결을 기다려요`, '15초 안에 돌아오지 않으면 다음 사람 차례로 넘어가요');
    }
    if (now - game.awaySince > 15000) {
      callout(`${slot}P 건너뜀`, '연결이 끊겼어요', 'miss', 1800);
      nextTurn();
    }
    return;
  }
  if (game.awaySince) {
    game.awaySince = null;
    prompt(`${playerInfo(slot).name} 차례`, '폰에서 방향을 맞추고 어드레스를 눌러요');
  }
  if (now - game.activity > 75000) {
    callout(`${slot}P 건너뜀`, '오래 기다려서 다음 차례로 넘어가요', 'miss', 1800);
    nextTurn();
  }
}

function endGame() {
  game.phase = 'over';
  game.sub = 'idle';
  $('hud').classList.add('hidden');
  $('join').classList.add('hidden');
  $('shotPanel').classList.remove('on');
  $('pinTag').classList.remove('on');
  prompt('', '');
  const ranked = [...game.order].sort((a, b) => {
    const x = game.scores[a].best;
    const y = game.scores[b].best;
    return (x == null ? 1e9 : x) - (y == null ? 1e9 : y);
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
      `<span class="num"><b>${sc.best == null ? '-' : sc.best < 0.1 ? 'IN' : sc.best.toFixed(1)}</b><span>${sc.best != null && sc.best < 0.1 ? '홀인원' : '핀까지(m)'}</span></span>`;
    box.appendChild(el);
  });
  $('over').classList.remove('hidden');
  sfx.clap(30);
  pushState();
}

// ---------- 타구 ----------
function surfaceInfo(s) {
  return {
    green: { bounce: 0.22, keep: 0.5, roll: 0.75 },
    fringe: { bounce: 0.25, keep: 0.45, roll: 1.4 },
    fairway: { bounce: 0.3, keep: 0.55, roll: 1.6 },
    tee: { bounce: 0.3, keep: 0.55, roll: 1.6 },
    rough: { bounce: 0.18, keep: 0.3, roll: 4.2 },
    trees: { bounce: 0.15, keep: 0.2, roll: 6 },
    bunker: { bounce: 0.05, keep: 0.05, roll: 20 },
    water: { bounce: 0, keep: 0, roll: 99 }
  }[s];
}

// 공 궤적: 공기 저항 + 백스핀 양력 + 사이드스핀 휨 + 바람, 땅에 닿으면 튀고 구릅니다.
function simulate(shot) {
  const loft = CLUBS[shot.club].loft;
  const clubSpeed = Math.min(46, Math.max(8, shot.speed * RD * 1.55));
  const q = Math.max(0.55, Math.min(1, 1 - Math.max(0, shot.miss - 8) / 40));
  const ballSpeed = clubSpeed * CLUBS[shot.club].smash * (0.85 + 0.15 * q);
  const launch = loft * 0.72 * (0.94 + Math.random() * 0.12) + (1 - q) * (Math.random() - 0.5) * 12;
  const face = Math.max(-25, Math.min(25, shot.face));
  const path = Math.max(-25, Math.min(25, shot.path));
  const start = shot.aim + 0.8 * face + 0.2 * path; // + 는 오른쪽
  const side = 0.16 * (face - path) * (ballSpeed / 50); // m/s², + 는 오른쪽으로 휨
  const psi = start * RD;
  const fwd = [-Math.sin(psi), Math.cos(psi)];
  const right = [-Math.cos(psi), -Math.sin(psi)];
  let x = 0;
  let y = TEE_H + 0.07;
  let z = 0;
  let vx = fwd[0] * ballSpeed * Math.cos(launch * RD);
  let vz = fwd[1] * ballSpeed * Math.cos(launch * RD);
  let vy = ballSpeed * Math.sin(launch * RD);
  const kd = 0.0045;
  const cl = 0.0028 * (0.7 + loft / 80);
  const dt = 1 / 120;
  const pts = [[x, y, z]];
  let carry = null;
  let landedOn = null;
  let bounces = 0;
  let airborne = true;
  let holed = false;
  let t = 0;
  for (; t < 20; t += dt) {
    if (airborne) {
      const rx = vx - game.wind.x;
      const rz = vz - game.wind.z;
      const s = Math.hypot(rx, vy, rz);
      const h = Math.hypot(rx, rz) || 1;
      const lift = bounces ? 0 : cl * s * s;
      vx += (-kd * s * rx + (bounces ? 0 : side * right[0]) - lift * (vy / s) * (rx / h)) * dt;
      vz += (-kd * s * rz + (bounces ? 0 : side * right[1]) - lift * (vy / s) * (rz / h)) * dt;
      vy += (-9.8 - kd * s * vy + lift * (h / s)) * dt;
      x += vx * dt;
      y += vy * dt;
      z += vz * dt;
      const gh = height(x, z);
      if (y <= gh + 0.0214 && vy < 0) {
        const s0 = surface(x, z);
        if (carry == null) {
          carry = Math.hypot(x, z);
          landedOn = s0;
        }
        if (s0 === 'water' && y < WATER_Y + 0.3) {
          pts.push([x, WATER_Y, z]);
          return { pts, carry, landedOn: 'water', rest: [x, z], surface: 'water', clubSpeed, ballSpeed, launch, face, path, holed };
        }
        const info = surfaceInfo(s0);
        const spin = Math.max(0, (loft - 20) / 60); // 짧은 클럽일수록 덜 굴러감
        y = gh + 0.0214;
        vy = -vy * info.bounce;
        vx *= info.keep * (1 - spin * (bounces ? 0.2 : 0.6));
        vz *= info.keep * (1 - spin * (bounces ? 0.2 : 0.6));
        bounces += 1;
        if (vy < 0.6 || bounces > 4) airborne = false;
      }
    } else {
      // 굴러가기: 마찰 + 경사
      const s0 = surface(x, z);
      const info = surfaceInfo(s0);
      if (s0 === 'water') {
        pts.push([x, WATER_Y, z]);
        return { pts, carry, landedOn, rest: [x, z], surface: 'water', clubSpeed, ballSpeed, launch, face, path, holed };
      }
      const sp = Math.hypot(vx, vz);
      const [gx, gz] = slope(x, z);
      vx += -9.8 * gx * 0.6 * dt;
      vz += -9.8 * gz * 0.6 * dt;
      const dec = info.roll * dt;
      if (sp <= dec) {
        vx = 0;
        vz = 0;
      } else {
        vx -= (vx / sp) * dec;
        vz -= (vz / sp) * dec;
      }
      x += vx * dt;
      z += vz * dt;
      y = height(x, z) + 0.0214;
      // 컵에 들어가기
      if (Math.hypot(x - PIN.x, z - PIN.z) < 0.06 && sp < 1.8) {
        holed = true;
        x = PIN.x;
        z = PIN.z;
        y = PIN_Y - 0.05;
        pts.push([x, y, z]);
        break;
      }
      if (Math.hypot(vx, vz) < 0.02) break;
    }
    pts.push([x, y, z]);
    if (Math.abs(x) > 80 || z > 205 || z < -20) {
      return { pts, carry, landedOn, rest: [x, z], surface: 'ob', clubSpeed, ballSpeed, launch, face, path, holed };
    }
  }
  return { pts, carry: carry || Math.hypot(x, z), landedOn, rest: [x, z], surface: surface(x, z), clubSpeed, ballSpeed, launch, face, path, holed };
}

function hitShot(d) {
  const shot = {
    speed: Math.max(0, Number(d.speed) || 0),
    face: Number(d.face) || 0,
    path: Number(d.path) || 0,
    miss: Math.max(0, Number(d.miss) || 0),
    club: CLUBS[d.club] ? d.club : game.club,
    aim: game.aim
  };
  const r = simulate(shot);
  game.sub = 'flight';
  game.flight = { ...r, t0: performance.now(), shot, done: false };
  pushState();
  const p = playerInfo(game.order[game.turn]);
  view.setTrail(r.pts, p.color);
  sfx.strike(Math.min(1, r.clubSpeed / 40));
  setTimeout(sfx.whoosh, 80);
  prompt('', '');
  // 타구 정보
  const kmh = (v) => `${Math.round(v * 3.6)}`;
  $('sClub').textContent = kmh(r.clubSpeed);
  $('sBall').textContent = kmh(r.ballSpeed);
  $('sLaunch').textContent = `${r.launch.toFixed(1)}°`;
  $('sFace').textContent = faceText(r.face);
  $('sPath').textContent = pathText(r.path);
  $('sCarry').textContent = '-';
  $('shotPanel').classList.add('on');
  cutNext = false;
}

const faceText = (f) => (Math.abs(f) < 1 ? '스퀘어' : f > 0 ? `열림 ${f.toFixed(1)}°` : `닫힘 ${(-f).toFixed(1)}°`);
const pathText = (p) => (Math.abs(p) < 1 ? '스퀘어' : p > 0 ? `인-아웃 ${p.toFixed(1)}°` : `아웃-인 ${(-p).toFixed(1)}°`);

function finishShot(now) {
  const f = game.flight;
  f.done = true;
  const slot = game.order[game.turn];
  const p = playerInfo(slot);
  const sc = game.scores[slot];
  const dist = Math.hypot(f.rest[0] - PIN.x, f.rest[1] - PIN.z);
  let title;
  let note = '';
  let kind = '';
  let counted = null;
  if (f.holed) {
    title = 'HOLE IN ONE';
    kind = 'hr';
    counted = 0;
    sfx.cup();
    sfx.clap(60);
  } else if (f.surface === 'water') {
    title = '물에 빠졌어요';
    kind = 'miss';
    sfx.splash();
  } else if (f.surface === 'ob') {
    title = 'OB';
    note = '코스 밖으로 나갔어요';
    kind = 'miss';
  } else {
    counted = dist;
    if (f.surface === 'green') {
      title = dist < 3 ? 'NICE SHOT' : '온 그린';
      kind = dist < 3 ? 'hr' : '';
      sfx.clap(dist < 3 ? 40 : 18);
    } else {
      title = { fringe: '그린 프린지', fairway: '페어웨이', rough: '러프', bunker: '벙커', trees: '숲', tee: '티 근처' }[f.surface] || '';
      kind = '';
      sfx.land();
    }
    note = `핀까지 ${dist.toFixed(1)}m`;
  }
  if (counted != null && (sc.best == null || counted < sc.best)) sc.best = counted;
  sc.shots.push({ dist: counted, rest: f.rest });
  game.lastSlot = slot;
  $('sCarry').textContent = f.carry ? `${Math.round(f.carry)}m` : '-';
  callout(title, note, kind, 2800);
  socket.emit('d2c', {
    event: 'result',
    slot,
    data: {
      title,
      note,
      great: f.holed || (counted != null && counted < 3),
      chips: [['캐리', f.carry ? `${Math.round(f.carry)}m` : '-'], ['클럽 스피드', `${Math.round(f.clubSpeed * 3.6)}km/h`], ['페이스', faceText(f.face)]]
    }
  });
  // 공이 멈춘 자리 표시
  const marks = [];
  for (const s of game.order) {
    const best = game.scores[s].shots.filter((x) => x.dist != null).sort((a, b) => a.dist - b.dist)[0];
    if (best) marks.push({ x: best.rest[0], z: best.rest[1], color: playerInfo(s).color });
  }
  view.setMarkers(marks);
  if (counted != null) {
    $('pinTag').textContent = f.holed ? '홀인원!' : `${dist.toFixed(1)}m`;
    $('pinTag').classList.add('on');
  }
  game.sub = 'result';
  game.waitUntil = now + 4200;
  renderBoard();
  pushState();
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
  callTimer = setTimeout(() => el.classList.remove('on'), ms || 1500);
}
function prompt(main, sub) {
  $('promptT').textContent = main;
  $('promptB').textContent = sub;
  $('prompt').classList.toggle('on', Boolean(main));
}
function renderShotInfo() {
  $('bClub').textContent = CLUBS[game.club].name;
  $('bAim').textContent = Math.abs(game.aim) < 0.5 ? '핀 방향' : game.aim > 0 ? `오른쪽 ${game.aim.toFixed(1)}°` : `왼쪽 ${(-game.aim).toFixed(1)}°`;
}
function renderBoard() {
  const b = $('leader');
  b.innerHTML = '';
  const rows = [...game.order].sort((a, c) => {
    const x = game.scores[a].best;
    const y = game.scores[c].best;
    return (x == null ? 1e9 : x) - (y == null ? 1e9 : y);
  });
  for (const slot of rows) {
    const p = playerInfo(slot);
    const sc = game.scores[slot];
    const row = document.createElement('div');
    row.className = 'row' + (slot === game.order[game.turn] ? ' now' : '');
    row.innerHTML = `<i style="background:${p.color}"></i><span class="n">${p.name}</span>` +
      `<b>${sc.best == null ? '-' : sc.best < 0.1 ? 'IN' : sc.best.toFixed(1)}</b><small>m</small>`;
    b.appendChild(row);
  }
}

// ---------- 매 프레임 ----------
let cutNext = false;
function tick() {
  const now = performance.now();
  watchTurn(now);
  let mode = 'lobby';
  let ball = null;
  let trailI = null;
  if (game.phase === 'playing') {
    mode = game.sub === 'aim' ? 'aim' : 'swing';
    if (game.sub === 'flight' && game.flight) {
      const f = game.flight;
      const i = Math.min(f.pts.length - 1, Math.floor(((now - f.t0) / 1000) * 120 * 1.25));
      ball = f.pts[i];
      trailI = i;
      const inAir = ball[1] > height(ball[0], ball[2]) + 0.3;
      mode = displayShowsFollow(f, now) ? 'swing' : inAir || ball[2] < 60 ? 'flight' : 'land';
      if (!displayShowsFollow(f, now)) $('live').innerHTML = `${Math.round(Math.hypot(ball[0], ball[2]))}<small>m</small>`;
      if (i >= f.pts.length - 1 && !f.done) {
        $('live').textContent = '';
        finishShot(now);
      }
    } else if (game.sub === 'result' && game.flight) {
      const f = game.flight;
      ball = f.pts[f.pts.length - 1];
      mode = displayShowsFollow(f, now) ? 'swing' : 'land';
      const pt = view.project(ball[0], ball[1] + 0.8, ball[2]);
      const tag = $('pinTag');
      tag.style.left = `${pt.x}px`;
      tag.style.top = `${pt.y}px`;
      if (now >= game.waitUntil) {
        $('pinTag').classList.remove('on');
        nextTurn();
      }
    }
  } else if (game.phase === 'over') {
    mode = 'green';
  }
  view.frame(now, { mode, ball, trailI, cut: cutNext, waggle: game.phase !== 'playing' || game.sub === 'aim' });
  cutNext = false;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startGame();
});

// 시험용: 콘솔에서 특정 스윙 각도의 자세를 세워 볼 수 있습니다.
function debugSwing(phiDeg) {
  const n = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const s0 = n([0.55, -0.83, 0.02]);
  const at = (phi) => n([s0[0] * Math.cos(phi * RD), s0[1] * Math.cos(phi * RD), s0[2] * Math.cos(phi * RD) + Math.sin(phi * RD)]);
  view.address(s0);
  const step = phiDeg < 0 ? -5 : 5;
  for (let a = 0; Math.abs(a) <= Math.abs(phiDeg); a += step) view.pose(at(a), [0, 0, 1]);
  game.sub = 'swing';
}
window.__golf = { game, simulate, view, debugSwing };
