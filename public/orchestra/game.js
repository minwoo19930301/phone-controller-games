// 오케스트라 큰 화면: 대기실 → (처음 악기면) 연습 → 곡 고르기(CD 넘기기) → 연주(지휘자 인사 → 줌아웃 → 악보) → 결과·녹화 받기.
// 사람이 맡은 파트는 각자 폰에서 소리가 나고, 안 맡은 파트는 큰 화면이 조용히 반주합니다. 판정·빠르기·녹화는 여기서 합니다.
// 모든 넘어가기(대기실·연습·곡 고르기·결과 → 다음)는 서버의 start_game(들어온 사람이 모두 준비)으로만 합니다.
import { createSettings, fields } from '/common/settings.js';
import { createTutorialBoard } from '/common/tutorial-board.js';
import { SONGS, getSong, bpmAt } from '/common/music/songs.js';
import { createSynth, createTransport, playPreview } from '/common/music/synth.js';
import { createDiscPicker, drawCover } from '/common/disc-picker.js';
import {
  INSTRUMENTS, INST_ORDER, ICONS, buildPart, windowFor, POINTS, gradeOf, GRADE_WORD, PITCH_TOL, dirOk, patternOf, DIFF_LABEL,
  chartStats, isSustain, solfa, noteName, DIR_ARROW, JUDGE_LABEL,
} from './parts.js';
import { createScore } from './score.js';
import { createHall } from './hall.js';
import { createRecorder } from './recorder.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const BOTS = clamp(parseInt(params.get('bots'), 10) || 0, 0, 4);
const AUTOSTART = params.has('autostart');
const BOT_INST = (params.get('botinst') || '').split(',').filter((k) => INSTRUMENTS[k]);
const SKIP_INTRO = params.get('intro') === '0';
const LIMIT_SEC = Number(params.get('seconds')) || 0;
const REC_ON = params.get('rec') !== '0';
const SLOT_INFO = { 1: { name: '1P', color: '#ff5a5f' }, 2: { name: '2P', color: '#3ab4ff' }, 3: { name: '3P', color: '#ffc93c' }, 4: { name: '4P', color: '#5ee07a' } };
const BOT_PREF = ['violin', 'drum', 'trumpet', 'piano', 'castanets', 'horn', 'voice', 'conductor'];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

await Promise.race([
  Promise.all([document.fonts.load('400 64px Anton'), document.fonts.load('800 64px "Pretendard Variable"')]),
  new Promise((r) => setTimeout(r, 2000)),
]).catch(() => {});

// ═══════════════ 소리 ═══════════════
const synth = createSynth({ volume: 0.8, reverb: 1 });
let audioOn = false;
function unlockAudio() { synth.resume().then((s) => { audioOn = s === 'running'; }); }
window.addEventListener('pointerdown', unlockAudio, { capture: true });
window.addEventListener('keydown', unlockAudio, { capture: true });
const outLat = () => Math.min(0.2, synth.ctx.outputLatency || synth.ctx.baseLatency || 0.02);
const clickInst = synth.instrument('drums', { gain: 0.8 });

// 박수(관객) — 인사할 때. 짧은 잡음 덩어리를 무작위로 많이 겹칩니다.
function applause(sec = 4, gain = 0.5) {
  const ctx = synth.ctx;
  const t0 = ctx.currentTime + 0.05;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, t0);
  out.gain.linearRampToValueAtTime(gain, t0 + 0.8);
  out.gain.setValueAtTime(gain, t0 + sec - 1.4);
  out.gain.linearRampToValueAtTime(0, t0 + sec);
  out.connect(synth.bus);
  const len = Math.floor(ctx.sampleRate * 0.03);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const n = Math.floor(sec * 70);
  for (let i = 0; i < n; i++) {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = 0.7 + Math.random() * 0.8;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900 + Math.random() * 1800;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.value = 0.25 + Math.random() * 0.5;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = Math.random() * 2 - 1; s.connect(f).connect(g).connect(p).connect(out); } else s.connect(f).connect(g).connect(out);
    s.start(t0 + Math.random() * sec);
  }
  setTimeout(() => { try { out.disconnect(); } catch (e) {} }, (sec + 1) * 1000);
}

// ═══════════════ 3D 공연장 ═══════════════
const hall = createHall($('cv'));

// ═══════════════ 연결 ═══════════════
const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true });
let serverPlayers = [];
let roomCode = null, roomKey = null, hadRoom = false;
const rtts = [];
function displayRtt() { if (!rtts.length) return 40; const s = [...rtts].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
setInterval(() => {
  if (!socket.connected) return;
  const t0 = performance.now();
  socket.timeout(2000).emit('ping_rtt', t0, (err) => { if (err) return; rtts.push(performance.now() - t0); if (rtts.length > 7) rtts.shift(); });
}, 1500);
function send(event, data, slot) {
  if (!socket.connected) return;
  socket.emit('d2c', slot != null ? { event, slot, data } : { event, data });
}

// ═══════════════ 설정·연습 현황 ═══════════════
const settings = createSettings({
  game: 'orchestra',
  fields: [fields.difficulty({ perPlayer: true, hints: { easy: '음표 적게 · 판정 넉넉 · 음정 자동', normal: '반박까지 · 밸브·건반 맞추기', hard: '악보 그대로 · 화음 · 현 고르기' } })],
  onChange: () => { if (picker) picker.setDifficulty(settings.get('difficulty')); renderLobby(); renderPractice(); renderSelectBar(); pushState(); },
});
settings.attach(socket);
settings.mount($('settingsBox'));
const board = createTutorialBoard({ mount: $('tutBoard') });
board.attach(socket);

socket.on('connect', () => {
  let saved = null;
  try { saved = sessionStorage.getItem('pcg-orchestra-room'); } catch (e) {}
  socket.emit('join', { role: 'display', game: 'orchestra', room: saved });
});
socket.on('room', async (r) => {
  try { sessionStorage.setItem('pcg-orchestra-room', r.code); } catch (e) {}
  serverPlayers = r.players || [];
  roomCode = r.code;
  roomKey = r.key || null;
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
  syncPlayers();
  pushState();
});
socket.on('players', (p) => {
  serverPlayers = p.players || [];
  syncPlayers();
  pushState();
});
socket.on('ready_state', (st) => { readySt = st; renderLobby(); renderPractice(); renderSelectBar(); renderOverReady(); });
let readySt = null;
socket.on('display_replaced', () => $('replaced').classList.remove('hidden'));
socket.on('start_game', () => advance());
socket.on('instrument', (d) => onInstrument(d));
socket.on('tutorial', (d) => { const p = players.get(Number(d.slot)); if (p) { p.tut = d; renderPractice(); } });
socket.on('play', (d) => onPlay(d));
socket.on('release', (d) => onRelease(d));
socket.on('level', (d) => onLevel(d));
socket.on('beat', (d) => onBeat(d));
socket.on('pose', (d) => onPose(d));
socket.on('nav', (d) => onNav(d));
socket.on('pick', (d) => onPick(d));

// ═══════════════ 사람들 ═══════════════
// slot → { slot, name, color, connected, bot, inst, fresh, tut, act }
const players = new Map();
function syncPlayers() {
  const seen = new Set();
  for (const sp of serverPlayers) {
    seen.add(sp.slot);
    const p = players.get(sp.slot) || { slot: sp.slot, inst: null, fresh: false, tut: null, act: newAct() };
    if (p.bot && game.phase === 'playing') { p.inst = null; p.act = newAct(); }
    Object.assign(p, { name: sp.name, color: sp.color, connected: sp.connected, bot: false });
    players.set(sp.slot, p);
  }
  // 봇: 빈자리를 채웁니다(사람이 들어오면 비켜 줌)
  let need = BOTS;
  for (let s = 1; s <= 4; s++) {
    if (seen.has(s)) continue;
    if (need > 0) {
      need -= 1;
      seen.add(s);
      const p = players.get(s) || { slot: s, tut: null, act: newAct() };
      const was = p.bot ? p.inst : null;
      Object.assign(p, { name: SLOT_INFO[s].name, color: SLOT_INFO[s].color, connected: true, bot: true, fresh: false });
      p.inst = was || pickBotInst(s);
      players.set(s, p);
    }
  }
  for (const s of [...players.keys()]) if (!seen.has(s)) {
    // 경기 중에 끊긴 사람은 자리를 지킵니다(서버가 자리를 잡아 둠). 완전히 나간 사람만 지웁니다.
    players.delete(s);
  }
  hall.setPlayers(playerList());
  renderLobby();
  renderPractice();
  renderSelectBar();
}
function pickBotInst(slot) {
  if (BOT_INST.length) return BOT_INST[(slot - 1) % BOT_INST.length];
  const taken = new Set([...players.values()].filter((p) => p.slot !== slot).map((p) => p.inst));
  return BOT_PREF.find((k) => !taken.has(k) && k !== 'conductor') || 'violin';
}
const playerList = () => [...players.values()].sort((a, b) => a.slot - b.slot);
function newAct() { return { hits: [], level: 0, m: null, raw: null, keys: new Map(), trail: [], beats: [], last: 0, sounding: false }; }
function onInstrument(d) {
  const p = players.get(Number(d.slot));
  if (!p || !INSTRUMENTS[d.inst]) return;
  if (game.phase === 'playing') {
    const current = game.perf && game.perf.players.get(p.slot);
    if (!game.perf || (current && !current.bot && p.inst)) return; // existing player: instrument locked
    p.inst = d.inst;
    p.fresh = Boolean(d.fresh);
    p.act = newAct();
    const diff = settings.get('difficulty', p.slot) || 'normal';
    const part = buildPart(game.song, p.inst, diff);
    const joinBeat = Math.max(0, heardBeat() + 0.5);
    const remaining = part.notes.filter((n) => n.b >= joinBeat).length;
    // A performer arriving at the very end cannot be graded 100% for zero
    // notes. Keep their choice for the next song and explain the wait.
    if (game.stage === 'end' || !remaining) {
      p.waitingNext = true;
      hall.setPlayers(playerList());
      pushState();
      return;
    }
    p.waitingNext = false;
    const P = {
      slot:p.slot, inst:p.inst, diff, part, bot:false, color:p.color, name:p.name,
      stats:{ perfect:0, good:0, miss:0, combo:0, maxCombo:0, pts:0 },
      judged:new Uint8Array(part.notes.length), next:0, botNext:0, joinBeat,
      nCount:remaining,
      onsets:[], segs:[], cur:null, pitches:[], recVoice:null, recKeys:new Map(), ictus:[]
    };
    for (const n of part.notes) if (n.b < joinBeat) P.judged[n.i] = 4;
    game.perf.players.set(p.slot, P);
    if (p.inst === 'conductor' && game.perf.leader == null) game.perf.leader = p.slot;
    hall.setPlayers(playerList());
    buildPanels(game.song);
    toast(`${p.name} 합주에 참가했어요`);
    pushState();
    return;
  }
  const changed = p.inst !== d.inst;
  p.inst = d.inst;
  p.fresh = Boolean(d.fresh);
  if (changed) { p.act = newAct(); p.tut = null; }
  hall.setPlayers(playerList());
  renderLobby();
  renderPractice();
  renderSelectBar();
  pushState();
}

// ═══════════════ 진행 ═══════════════
const game = {
  phase: 'lobby', // lobby | practice | select | playing | over
  stage: null, // intro | count | live | end
  song: null,
  picked: null,
  perf: null,
  clip: null,
  rec: { on: false, uploading: false },
  results: null,
};
let tr = null; // 박자 스케줄러(연주 중)
let recSynth = null; // 사람 파트를 녹화에만 섞는 소리(스피커로 안 나감)
let recorder = null;
let localBlobUrl = null;

function setPhase(ph) {
  game.phase = ph;
  for (const id of ['lobby', 'practice', 'select', 'perform', 'over']) $(id).classList.toggle('hidden', id !== (ph === 'playing' ? 'perform' : ph));
  $('join').classList.toggle('hidden', ph === 'lobby');
  document.body.dataset.phase = ph;
  hall.setMode(ph === 'playing' ? 'perform' : ph);
  settings.lock(ph === 'playing');
  board.hide(ph !== 'lobby');
  if (picker) picker.setEnabled(ph === 'select');
  if (ph === 'select') { game.picked = null; ensurePicker(); renderSelectBar(); }
  renderKeys();
  renderLobby();
  renderPractice();
  pushState();
}
// 아래 키 안내(시험·진행용). Enter 는 폰이 들어와 있으면 모두 준비해야 먹습니다.
const KEY_HINTS = {
  lobby: ['<kbd>Enter</kbd> 다음(폰이 없을 때)', '<kbd>D</kbd> 난이도', '시험: 주소에 <kbd>?bots=2</kbd>'],
  practice: ['<kbd>Enter</kbd> 곡 고르기로(폰이 없을 때)', '<kbd>Esc</kbd> 대기실'],
  select: ['<kbd>←</kbd><kbd>→</kbd> 넘기기', '<kbd>↑</kbd><kbd>↓</kbd> 난이도', '<kbd>Space</kbd> 이 곡', '<kbd>Enter</kbd> 연주 시작(폰이 없을 때)', '<kbd>Esc</kbd> 대기실'],
  over: ['<kbd>Enter</kbd> 다음 곡(폰이 없을 때)', '<kbd>Esc</kbd> 대기실'],
};
function renderKeys() { $('keys').innerHTML = (KEY_HINTS[game.phase] || []).map((k) => `<span>${k}</span>`).join(''); }
function everyoneHasInst() { return playerList().every((p) => p.inst); }
function anyFresh() { return playerList().some((p) => !p.bot && p.fresh); }
/** 모두 준비(서버 start_game) 또는 폰이 없을 때 Enter */
function advance() {
  if (game.phase === 'lobby') {
    if (!players.size) { toast('폰으로 QR을 찍어 들어와요 · 시험은 ?bots=2'); return; }
    if (!everyoneHasInst()) { toast('아직 악기를 안 고른 사람이 있어요'); return; }
    setPhase(anyFresh() ? 'practice' : 'select');
  } else if (game.phase === 'practice') setPhase('select');
  else if (game.phase === 'select') {
    if (!game.picked && picker) game.picked = picker.song;
    if (!game.picked) return;
    startPerformance(game.picked);
  } else if (game.phase === 'over') setPhase('select');
}
function backToLobby(msg) {
  stopPerformance();
  setPhase('lobby');
  if (msg) toast(msg);
}

// ═══════════════ 상태 보내기 ═══════════════
let lastPush = 0;
function pushState() {
  lastPush = performance.now();
  const ps = {};
  for (const p of playerList()) {
    const P = game.perf && game.perf.players.get(p.slot);
    ps[p.slot] = {
      name: p.name, color: p.color, inst: p.inst, bot: p.bot || undefined, connected: p.connected,
      diff: P ? P.diff : settings.get('difficulty', p.slot), waitingNext: Boolean(p.waitingNext && game.phase === 'playing'),
      acc: P ? Math.round(accOf(P) * 100) / 100 : undefined, combo: P ? P.stats.combo : undefined,
    };
  }
  const waiting = ['lobby', 'practice', 'select', 'over'].includes(game.phase);
  const song = game.song && game.phase !== 'select' ? { id: game.song.id, title: game.song.title } : null;
  send('game_state', {
    phase: game.phase, waiting, stage: game.stage, players: ps, song,
    picker: game.phase === 'select' && picker ? pickerState() : null,
    clip: game.phase === 'over' && game.clip ? game.clip : null,
    rec: { uploading: game.rec.uploading },
    settings: settings.forState({ lite: game.phase === 'playing' }),
  });
}
setInterval(() => { if (performance.now() - lastPush > 1000) pushState(); }, 500);

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
}

// ═══════════════ 대기실 ═══════════════
function renderLobby() {
  if (game.phase !== 'lobby') return;
  const list = playerList();
  const taken = {};
  for (const p of list) if (p.inst) (taken[p.inst] = taken[p.inst] || []).push(p);
  $('insts').innerHTML = INST_ORDER.map((k) => {
    const I = INSTRUMENTS[k];
    const who = (taken[k] || []).map((p) => `<s style="background:${p.color}">${p.name}</s>`).join('');
    return `<div class="inst${taken[k] ? ' on' : ''}" style="${taken[k] ? `--pc:${taken[k][0].color}` : ''}"><i>${ICONS[k]}</i><b>${I.label}</b><span>${I.role}</span><em>${who}</em></div>`;
  }).join('');
  const ready = readySt && readySt.ready ? readySt.ready : [];
  $('slots').innerHTML = [1, 2, 3, 4].map((s) => {
    const p = players.get(s);
    if (!p) return `<div class="slot empty"><b>${s}P</b><span>QR로 들어와요</span></div>`;
    const I = p.inst ? INSTRUMENTS[p.inst] : null;
    const st = p.bot ? '봇' : !p.connected ? '연결 끊김' : ready.includes(s) ? '준비 ✓' : I ? (p.fresh ? '처음 · 연습 예정' : '준비 전') : '악기 고르는 중';
    return `<div class="slot" style="--pc:${p.color}"><b>${p.name}</b><i>${I ? ICONS[p.inst] : ''}</i><div><strong>${I ? I.label : '…'}</strong><span class="${ready.includes(s) ? 'ok' : ''}">${st}</span></div><em>${DIFF_LABEL[settings.get('difficulty', s)] || ''}</em></div>`;
  }).join('');
}

// ═══════════════ 연습(처음 악기는 튜토리얼, 다른 사람은 자유 연습) ═══════════════
const tileCv = new Map();
function renderPractice() {
  if (game.phase !== 'practice') return;
  const list = playerList();
  const box = $('tiles');
  box.dataset.n = String(list.length);
  const ready = readySt && readySt.ready ? readySt.ready : [];
  for (const p of list) {
    let el = box.querySelector(`[data-slot="${p.slot}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'tile';
      el.dataset.slot = p.slot;
      el.innerHTML = `<div class="tile-head"><b class="tb"></b><i class="ti"></i><div><strong class="tn"></strong><span class="ts"></span></div><em class="tr"></em></div><div class="tile-body"><div class="tile-art"><i class="ta-i"></i><b class="ta-t"></b><span class="ta-s"></span></div><canvas class="tile-cv"></canvas></div><div class="tile-prog"><div class="tp-bar"></div><span class="tp-t"></span></div>`;
      box.appendChild(el);
      tileCv.set(p.slot, el.querySelector('canvas'));
    }
    el.style.setProperty('--pc', p.color);
    const I = INSTRUMENTS[p.inst] || INSTRUMENTS.violin;
    el.querySelector('.tb').textContent = p.name;
    el.querySelector('.ti').innerHTML = ICONS[p.inst] || '';
    el.querySelector('.tn').textContent = I.label;
    el.querySelector('.ts').textContent = I.how;
    const ok = ready.includes(p.slot) || p.bot;
    el.querySelector('.tr').textContent = ok ? '준비 ✓' : '';
    el.classList.toggle('ready', ok);
    const t = p.tut;
    const inTut = t && !t.done;
    const bar = el.querySelector('.tp-bar');
    bar.innerHTML = inTut ? Array.from({ length: t.total || 4 }, (_, i) => `<i class="${i < t.step - 1 ? 'd' : i === t.step - 1 ? 'c' : ''}"></i>`).join('') : '';
    el.querySelector('.tp-t').textContent = p.bot ? '봇은 연습 없이 준비됐어요' : inTut ? `연습 중 ${t.step}/${t.total} · ${t.title}` : t && t.done ? (t.skipped ? '연습 건너뜀 · 자유 연습' : '연습 끝 ✓ · 자유 연습') : p.fresh ? '폰에서 연습을 시작해요' : '자유 연습 · 소리를 내 보세요';
    el.classList.toggle('tut', Boolean(inTut));
    // 가운데 큰 글: 튜토리얼 단계 / 자유 연습 안내(소리를 내면 그림에 가려 흐려짐)
    const ti = el.querySelector('.ta-i');
    if (ti.dataset.k !== p.inst) { ti.innerHTML = ICONS[p.inst] || ''; ti.dataset.k = p.inst || ''; }
    el.querySelector('.ta-t').textContent = inTut ? t.title : p.bot ? '' : ok ? '준비 완료' : '자유 연습';
    el.querySelector('.ta-s').textContent = inTut ? `튜토리얼 ${t.step}/${t.total}` : p.bot ? '' : ok ? '다른 사람을 기다려요' : I.how;
  }
  for (const el of [...box.querySelectorAll('.tile')]) if (!players.has(Number(el.dataset.slot))) { tileCv.delete(Number(el.dataset.slot)); el.remove(); }
}
// 연습 칸 그림: 악기마다 소리 낸 모습을 보여 줍니다
function drawTiles(now) {
  for (const p of playerList()) {
    const cv = tileCv.get(p.slot);
    if (!cv) continue;
    const r = cv.getBoundingClientRect();
    const W = Math.round(r.width * devicePixelRatio), H = Math.round(r.height * devicePixelRatio);
    if (!W || !H) continue;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d');
    g.clearRect(0, 0, W, H);
    const a = p.act;
    const k = INSTRUMENTS[p.inst] ? INSTRUMENTS[p.inst].kind : 'tap';
    const col = p.color;
    const dpr = devicePixelRatio;
    if (p.bot && now - a.last > 700) { botPractice(p, now); }
    // 소리 낸 자국(원)
    for (const h of a.hits) {
      const age = (now - h.t) / 900;
      if (age > 1) continue;
      g.strokeStyle = col;
      g.globalAlpha = 1 - age;
      g.lineWidth = (2 + 6 * (1 - age)) * dpr;
      g.beginPath();
      g.arc(W / 2 + (h.x || 0) * W * 0.3, H / 2, (0.12 + age * 0.35) * Math.min(W, H) * (0.6 + (h.vel || 0.7) * 0.6), 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
    while (a.hits.length && now - a.hits[0].t > 1000) a.hits.shift();
    if (k === 'wind' || k === 'bow' || k === 'voice') {
      const lv = a.sounding ? a.level : 0;
      a.trail.push({ t: now, lv, m: a.sounding ? a.m : null });
      while (a.trail.length && a.trail[0].t < now - 3000) a.trail.shift();
      g.strokeStyle = col;
      g.lineWidth = 3 * dpr;
      g.beginPath();
      a.trail.forEach((q, i) => {
        const x = (1 - (now - q.t) / 3000) * W;
        const y = H * 0.85 - q.lv * H * 0.6 - (q.m ? ((q.m % 12) / 12) * H * 0.1 : 0);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      });
      g.stroke();
      if (a.sounding && a.m) {
        g.fillStyle = '#fff';
        g.font = `800 ${Math.round(H * 0.22)}px Pretendard, system-ui`;
        g.textAlign = 'center';
        g.fillText(`${solfa(a.m)} · ${noteName(a.m)}`, W / 2, H * 0.32);
        g.textAlign = 'start';
      }
    } else if (k === 'keys') {
      // 건반 2옥타브
      const lo = 55, n = 26;
      const ww = W / 15;
      let wi = 0;
      for (let m = lo; m < lo + n; m++) {
        if ([1, 3, 6, 8, 10].includes(m % 12)) continue;
        const on = a.keys.has(m) && now - a.keys.get(m) < 400;
        g.fillStyle = on ? col : '#f3efe4';
        g.fillRect(wi * ww + 1, H * 0.25, ww - 2, H * 0.6);
        wi++;
      }
      wi = 0;
      for (let m = lo; m < lo + n; m++) {
        if ([1, 3, 6, 8, 10].includes(m % 12)) {
          const on = a.keys.has(m) && now - a.keys.get(m) < 400;
          g.fillStyle = on ? col : '#16131b';
          g.fillRect(wi * ww - ww * 0.3, H * 0.25, ww * 0.6, H * 0.36);
        } else wi++;
      }
    } else if (k === 'baton') {
      const cx = W / 2, cy = H / 2;
      g.strokeStyle = col;
      g.lineWidth = 4 * dpr;
      g.lineCap = 'round';
      g.beginPath();
      a.trail.filter((q) => now - q.t < 1400).forEach((q, i) => { const x = cx + q.x * W * 0.008, y = cy - q.y * H * 0.012; if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
      g.stroke();
      const b = a.beats[a.beats.length - 1];
      if (b && now - b.t < 700) {
        g.fillStyle = '#fff';
        g.globalAlpha = 1 - (now - b.t) / 700;
        g.font = `800 ${Math.round(H * 0.4)}px Pretendard, system-ui`;
        g.textAlign = 'center';
        g.fillText(DIR_ARROW[b.dir] || '', cx, cy + H * 0.14);
        g.textAlign = 'start';
        g.globalAlpha = 1;
      }
    }
  }
}
function botPractice(p, now) {
  const a = p.act;
  a.last = now;
  const k = INSTRUMENTS[p.inst] ? INSTRUMENTS[p.inst].kind : 'tap';
  if (k === 'keys') { const m = 60 + [0, 4, 7, 12][Math.floor(Math.random() * 4)]; a.keys.set(m, now); a.hits.push({ t: now, vel: 0.6 }); }
  else if (k === 'wind' || k === 'bow' || k === 'voice') { a.sounding = Math.random() > 0.3; a.level = 0.4 + Math.random() * 0.5; a.m = 67 + Math.floor(Math.random() * 5); }
  else if (k === 'baton') { const dirs = ['down', 'left', 'right', 'up']; a.beats.push({ t: now, dir: dirs[a.beats.length % 4] }); }
  else a.hits.push({ t: now, vel: 0.5 + Math.random() * 0.5, x: (Math.random() - 0.5) * 0.5 });
}

// ═══════════════ 곡 고르기(CD 넘기기) ═══════════════
let picker = null;
let driver = null;
let previewStop = null;
function ensurePicker() {
  if (picker) return picker;
  picker = createDiscPicker($('pickerHost'), {
    songs: SONGS,
    difficulty: settings.get('difficulty'),
    storageKey: 'pcg-orch-picker',
    title: '연주할 곡',
    hint: '폰에서 좌우로 밀어 넘기기 · ← → · 가운데를 누르면 선택',
    keyboard: false,
    accent: '#e9c47a',
    startId: params.get('song') && getSong(params.get('song')) ? params.get('song') : undefined,
    chartInfo: (s, d) => chartStats(s, d, 'piano'),
    preview: (s) => { previewStop = playPreview(synth, s, { seconds: 12 }); return previewStop; },
    onGesture: () => unlockAudio(),
    onChange: () => { if (game.picked) { game.picked = null; } sendPicker(); renderSelectBar(); },
    onSettle: () => sendPicker(),
    onSelect: (song) => { game.picked = song; sendPicker(); renderSelectBar(); pushState(); },
    onDifficulty: (d) => settings.set('difficulty', d, 'display'),
  });
  return picker;
}
function pickerState() {
  const s = picker && picker.song;
  return s ? { id: s.id, title: s.title, index: picker.index, n: picker.songs.length, driver, selected: Boolean(game.picked && game.picked.id === s.id) } : null;
}
let pickerTimer = 0;
function sendPicker() {
  clearTimeout(pickerTimer);
  pickerTimer = setTimeout(() => { const st = pickerState(); if (st) send('picker', st); }, 60);
}
function onNav(d) {
  if (game.phase !== 'select' || !picker) return;
  const slot = Number(d.slot);
  const p = players.get(slot);
  driver = slot;
  if (p) picker.setDriver({ label: p.name, color: p.color, text: '고르는 중' });
  if (typeof d.v === 'number') picker.fling(clamp(d.v, -14, 14));
  else picker.nudge(d.d > 0 ? 1 : -1);
  unlockAudio();
}
function onPick(d) {
  if (game.phase !== 'select' || !picker) return;
  const p = players.get(Number(d.slot));
  driver = Number(d.slot);
  if (p) picker.setDriver({ label: p.name, color: p.color, text: '이 곡을 골랐어요' });
  picker.select();
}
function renderSelectBar() {
  if (game.phase !== 'select') return;
  const s = game.picked;
  $('selMsg').innerHTML = s ? `<b>${esc(s.title)}</b> 골랐어요 · 폰에서 모두 준비하면 연주를 시작해요` : '폰에서 밀어 넘기고 ‘이 곡으로’를 누르면 골라져요';
  $('selMsg').classList.toggle('picked', Boolean(s));
  const ready = readySt && readySt.ready ? readySt.ready : [];
  $('selPlayers').innerHTML = playerList().map((p) => `<div class="sp" style="--pc:${p.color}"><b>${p.name}</b><i>${ICONS[p.inst] || ''}</i><span>${p.inst ? INSTRUMENTS[p.inst].label : ''} · ${DIFF_LABEL[settings.get('difficulty', p.slot)]}</span>${ready.includes(p.slot) ? '<em>준비 ✓</em>' : ''}</div>`).join('');
}

// ═══════════════ 연주 ═══════════════
const panels = new Map(); // slot → { el, score, pop }
function accOf(P) { const n = P.nCount ?? P.part.notes.length; return n ? P.stats.pts / n : 1; }
function judgedCount(P) { return P.stats.perfect + P.stats.good + P.stats.miss; }

function startPerformance(song) {
  stopPerformance();
  if (previewStop) { try { previewStop(); } catch (e) {} previewStop = null; }
  if (localBlobUrl) { URL.revokeObjectURL(localBlobUrl); localBlobUrl = null; }
  game.clip = null;
  game.song = song;
  game.results = null;
  // 사람마다 악보
  const perf = { players: new Map(), startAt: 0, liveAt: 0, rate: 1, dyn: 1, dynWord: 'mf', leader: null, lastIctus: null, ictusAt: 0, ens: 0.85, ensN: 0, endAt: 0, notesAuto: 0, bpm: song.bpm };
  for (const p of playerList()) {
    if (!p.inst) continue;
    p.waitingNext = false;
    const diff = settings.get('difficulty', p.slot);
    const part = buildPart(song, p.inst, diff);
    perf.players.set(p.slot, {
      slot: p.slot, inst: p.inst, diff, part, bot: p.bot, color: p.color, name: p.name,
      stats: { perfect: 0, good: 0, miss: 0, combo: 0, maxCombo: 0, pts: 0 },
      judged: new Uint8Array(part.notes.length), next: 0, botNext: 0,
      onsets: [], segs: [], cur: null, pitches: [], recVoice: null, recKeys: new Map(), ictus: [],
    });
    if (p.inst === 'conductor' && perf.leader == null && !p.bot) perf.leader = p.slot;
  }
  game.perf = perf;
  // 반주: 사람이 맡은 파트는 소리 없이(이벤트만), 봇이 맡은 파트는 큰 화면에서 소리
  const humanParts = new Set(), botParts = new Set();
  for (const P of perf.players.values()) { const part = INSTRUMENTS[P.inst].part; if (part) (P.bot ? botParts : humanParts).add(part); }
  tr = createTransport(synth);
  const instruments = {};
  for (const part of humanParts) instruments[part] = null;
  const gains = {};
  // 사람이 있으면 큰 화면 반주는 조용히(폰 소리가 잘 들리게)
  const soft = humanParts.size ? 0.62 : 0.85;
  for (const part of ['melody', 'harmony', 'bass', 'chords', 'drums', 'perc']) gains[part] = soft * ({ melody: 1, harmony: 0.62, bass: 0.8, chords: 0.5, drums: 0.62, perc: 0.55 })[part] * (botParts.has(part) ? 1.25 : 1);
  tr.load(song, { instruments, gains });
  tr.on('beat', ({ beat, time }) => queueAt(time, () => hall.beat(beat, song)));
  tr.on('note', ({ track, note, time, dur }) => {
    if (humanParts.has(track)) return;
    queueAt(time, () => hall.section(track, note[3] ?? 0.8, dur, note[2]));
  });
  tr.on('end', () => endSong());
  recSynth = createSynth({ ctx: synth.ctx, silent: true, volume: 0.8 });
  // 패널
  buildPanels(song);
  setPhase('playing');
  $('pCover').src = drawCover(song, 160);
  $('pSong').textContent = song.title;
  $('pComposer').textContent = `${song.composer} · ${song.en}`;
  hall.setPlayers(playerList());
  // 녹화
  game.rec = { on: false, uploading: false };
  if (REC_ON) {
    try {
      recorder = createRecorder({ synth, recSynth, delay: clamp((displayRtt() / 2 + 60) / 1000, 0.04, 0.25), draw: composeFrame });
      recorder.start();
      game.rec.on = true;
      document.body.classList.add('rec');
    } catch (e) { console.warn('녹화를 시작하지 못했어요', e); recorder = null; }
  }
  // 지휘자 인사 → 줌아웃 → 한 마디 세기 → 연주
  game.stage = 'intro';
  pushState();
  centerText('지휘자 입장', 'Maestro');
  if (SKIP_INTRO) { hall.skipIntro(); countIn(); return; }
  document.body.classList.add('intro'); // 인사하는 동안은 악보 칸을 내려 두고 공연장만 크게
  applause(6.5, 0.32);
  hall.intro().then(() => { if (game.phase === 'playing' && game.stage === 'intro') countIn(); });
  setTimeout(() => { if (game.stage === 'intro') centerText('', ''); }, 2600);
}
function countIn() {
  const song = game.song;
  const perf = game.perf;
  if (!song || !perf) return;
  game.stage = 'count';
  document.body.classList.remove('intro');
  unlockAudio();
  const spb = 60 / song.bpm;
  const pat = patternOf(song);
  const n = song.timeSig.join('/') === '6/8' ? 2 : song.barLen;
  const step = song.timeSig.join('/') === '6/8' ? 1.5 * spb : spb;
  const t0 = synth.ctx.currentTime + 0.35;
  perf.startAt = t0 + n * step;
  for (let i = 0; i < n; i++) {
    clickInst.play(i === 0 ? 76 : 77, { when: t0 + i * step, vel: i === 0 ? 0.9 : 0.6 });
    queueAt(t0 + i * step, () => { centerText(String(n - i), ''); send('cue', { count: n - i }); hall.countBeat(i); });
  }
  queueAt(perf.startAt, () => { centerText('', ''); send('cue', { go: true }); });
  tr.start({ fromBeat: 0, at: perf.startAt });
  perf.liveAt = perf.startAt;
  setTimeout(() => { if (game.stage === 'count') { game.stage = 'live'; pushState(); } }, Math.max(0, (perf.startAt - synth.ctx.currentTime) * 1000 - 30));
  pushState();
  void pat;
}
/** cut: 곡 끝 전에 멈춤(시험용 ?seconds·finish). 그 뒤 음은 점수에서 뺍니다. */
function endSong(cut = false) {
  if (!game.perf || game.stage === 'end') return;
  game.stage = 'end';
  const perf = game.perf;
  const bNow = heardBeat();
  for (const P of perf.players.values()) {
    if (cut) P.nCount = P.part.notes.filter((n) => n.b <= bNow && n.b >= (P.joinBeat || 0)).length;
    // 남은 음은 놓친 것으로
    for (const n of P.part.notes) if (!P.judged[n.i] && (!cut || n.b <= bNow)) judge(P, n, 'miss', true);
  }
  pushState();
  applause(5, 0.42);
  hall.outro();
  centerText('브라보!', 'Bravo');
  setTimeout(() => finishPerformance(), 3600);
}
function finishPerformance() {
  const perf = game.perf;
  if (!perf) return;
  document.body.classList.remove('rec');
  const res = [];
  for (const P of perf.players.values()) {
    const acc = accOf(P);
    res.push({ slot: P.slot, name: P.name, color: P.color, inst: P.inst, diff: P.diff, acc, grade: gradeOf(acc), ...P.stats, notes: P.nCount ?? P.part.notes.length, late: P.joinBeat != null, steady: P.inst === 'conductor' ? steadiness(P) : null, bot: P.bot });
  }
  // Partial performances are shown separately; they must not change the
  // full-song ensemble score earned by players who started from the beginning.
  const full = res.filter((r) => !r.late);
  const graded = full.length ? full : res;
  const ensAcc = graded.length ? graded.reduce((a, r) => a + r.acc, 0) / graded.length : 1;
  const ens = { acc: ensAcc, grade: gradeOf(ensAcc), partial: !full.length && Boolean(res.length) };
  game.results = { list: res, ens, song: game.song };
  for (const r of res) if (!r.bot) send('result', { acc: Math.round(r.acc * 1000) / 1000, grade: r.grade, late:r.late, perfect: r.perfect, good: r.good, miss: r.miss, maxCombo: r.maxCombo, ens }, r.slot);
  if (tr) { tr.unload(); tr = null; }
  game.stage = null;
  setPhase('over');
  renderOver();
  // 녹화 마무리 → 내려받기 + 폰에도
  if (recorder) {
    const rc = recorder;
    recorder = null;
    game.rec.uploading = true;
    renderOver();
    rc.stop().then(async (blob) => {
      if (!blob || !blob.size) { game.rec.uploading = false; renderOver(); return; }
      if (localBlobUrl) URL.revokeObjectURL(localBlobUrl);
      localBlobUrl = URL.createObjectURL(blob);
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      const d = new Date();
      const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
      const name = `오케스트라-${game.song.title.replace(/\s+/g, '')}-${day}.${ext}`;
      game.recInfo = { name, size: blob.size, type: blob.type };
      renderOver();
      try {
        if (!roomKey || !roomCode) throw new Error('no key');
        const res2 = await fetch(`/api/clip?room=${encodeURIComponent(roomCode)}&kind=video&name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'x-display-key': roomKey, 'content-type': blob.type || 'video/webm' }, body: blob });
        if (!res2.ok) throw new Error('upload ' + res2.status);
        const j = await res2.json();
        game.clip = { url: j.url, expiresAt: j.expiresAt, name, size: blob.size };
        send('clip', game.clip);
      } catch (e) { console.warn('녹화 올리기 실패', e); game.clipError = true; }
      game.rec.uploading = false;
      renderOver();
      pushState();
    });
  }
  pushState();
}
function stopPerformance() {
  document.body.classList.remove('rec', 'intro');
  if (tr) { tr.unload(); tr = null; }
  if (recorder) { try { recorder.cancel(); } catch (e) {} recorder = null; }
  if (recSynth) { try { recSynth.dispose(); } catch (e) {} recSynth = null; }
  animQ.length = 0;
  game.perf = null;
  game.stage = null;
}
function steadiness(P) {
  const t = P.ictus.map((x) => x.t);
  if (t.length < 4) return null;
  const iv = [];
  for (let i = 1; i < t.length; i++) iv.push(t[i] - t[i - 1]);
  const mean = iv.reduce((a, b) => a + b, 0) / iv.length;
  const sd = Math.sqrt(iv.reduce((a, b) => a + (b - mean) ** 2, 0) / iv.length);
  return clamp(1 - sd / mean, 0, 1);
}

// 오디오 시각에 맞춰 화면 일(애니메이션)을 하기
const animQ = [];
function queueAt(time, fn) {
  animQ.push({ time, fn });
  if (animQ.length > 1 && animQ[animQ.length - 2].time > time) animQ.sort((a, b) => a.time - b.time);
}
function runQueue() {
  const now = synth.ctx.currentTime - outLat();
  while (animQ.length && animQ[0].time <= now) { const q = animQ.shift(); try { q.fn(); } catch (e) { console.error(e); } }
}

// ─── 시각 ───
// 폰이 동작을 잡은 실제 순간(오디오 시계) = 도착 − ago − 폰 왕복/2 − 화면 왕복/2, 다시 방에서 들리는 늦음(outLat)만큼 빼서 곡 시각으로
function actionTime(d) {
  const back = (Number(d.ago) || 0) + (Number(d.rtt) || 80) / 2 + displayRtt() / 2;
  return synth.ctx.currentTime - Math.min(0.6, back / 1000) - outLat();
}
const musicNow = () => synth.ctx.currentTime - outLat();
const timeOf = (b) => (tr ? tr.timeAt(b) : 0);
function heardBeat() {
  const perf = game.perf;
  if (!perf || !tr) return -4;
  // 인사·줌아웃 동안은 악보를 첫 음 앞에 세워 둡니다(아직 박이 흐르지 않음)
  if (!perf.startAt) return -4;
  const t = musicNow();
  if (t < perf.startAt) return -((perf.startAt - t) * game.song.bpm) / 60;
  return tr.beatAt(t);
}

// ─── 판정 ───
function judge(P, n, j, silent) {
  if (P.judged[n.i]) return;
  P.judged[n.i] = j === 'perfect' ? 1 : j === 'good' ? 2 : 3;
  const s = P.stats;
  s[j] += 1;
  s.pts += POINTS[j];
  if (j === 'miss') s.combo = 0; else { s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo); }
  if (silent) return;
  const perf = game.perf;
  perf.ens = perf.ens * 0.93 + POINTS[j] * 0.07;
  const pn = panels.get(P.slot);
  if (pn) { pn.score.mark(n.i, j); popJudge(pn, j, s.combo); }
  hall.judge(P.slot, j);
  if (!P.bot) send('judge', { i: n.i, j, combo: s.combo }, P.slot);
}
function popJudge(pn, j, combo) {
  const e = pn.pop;
  e.className = 'pop';
  void e.offsetWidth;
  e.textContent = JUDGE_LABEL[j];
  e.classList.add('show', j);
  pn.combo.textContent = combo >= 3 ? `${combo} COMBO` : '';
}
function noteMatch(P, n, d) {
  const k = INSTRUMENTS[P.inst].kind;
  if (k === 'keys') {
    if (P.diff === 'easy') return !n.chord || false;
    return n.m === d.m;
  }
  if (k === 'tap') return !n.roll || P.diff !== 'hard' || Boolean(d.roll);
  return true;
}
function judgeTap(P, d, tm) {
  const [wp, wg] = windowFor(P.inst, P.diff);
  const ns = P.part.notes;
  let best = null, bd = 1e9;
  for (let i = P.next; i < ns.length; i++) {
    const n = ns[i];
    const t = timeOf(n.b);
    if (t > tm + wg) break;
    if (P.judged[n.i] || t < tm - wg) continue;
    if (!noteMatch(P, n, d)) continue;
    const dt = Math.abs(t - tm);
    if (dt < bd) { bd = dt; best = n; }
  }
  if (best) judge(P, best, bd <= wp ? 'perfect' : 'good');
}
function isSounding(P, t) {
  for (let i = P.segs.length - 1; i >= 0; i--) {
    const s = P.segs[i];
    if (s.on > t) continue;
    const end = s.off != null ? s.off : s.last + 0.7;
    return end >= t;
  }
  return false;
}
function pitchAt(P, t) {
  for (let i = P.pitches.length - 1; i >= 0; i--) if (P.pitches[i].t <= t + 0.06) return P.pitches[i];
  return null;
}
function pitchOk(P, n, t0) {
  if (P.diff === 'easy' && P.inst !== 'voice') return true;
  if (P.inst === 'voice') {
    const tol = PITCH_TOL[P.diff] || 1.6;
    const t1 = t0 + Math.min(timeOf(n.b + n.d) - t0, 0.8);
    const xs = P.pitches.filter((q) => q.t >= t0 - 0.05 && q.t <= t1 && q.raw != null).map((q) => { const o = n.m + 12 * Math.round((q.raw - n.m) / 12); return Math.abs(q.raw - o); });
    if (!xs.length) { const q = pitchAt(P, t0 + 0.1); if (!q || q.raw == null) return P.diff === 'easy'; const o = n.m + 12 * Math.round((q.raw - n.m) / 12); return Math.abs(q.raw - o) <= tol; }
    xs.sort((a, b) => a - b);
    return xs[xs.length >> 1] <= tol;
  }
  const q = pitchAt(P, t0 + 0.12);
  return Boolean(q && Math.abs(q.m - n.m) < 0.6);
}
function judgeSustainDue(P, tmNow) {
  const [wp, wg] = windowFor(P.inst, P.diff);
  const ns = P.part.notes;
  while (P.next < ns.length && P.judged[ns[P.next].i]) P.next++;
  for (let i = P.next; i < ns.length; i++) {
    const n = ns[i];
    if (P.judged[n.i]) continue;
    const t0 = timeOf(n.b);
    if (t0 + wg + 0.08 > tmNow) break;
    let bd = 1e9;
    for (const o of P.onsets) { if (!o.art) continue; const dt = Math.abs(o.t - t0); if (dt < bd) bd = dt; }
    const art = bd <= wg;
    const sound = isSounding(P, t0 + Math.min(0.12, (timeOf(n.b + n.d) - t0) * 0.5));
    const ok = pitchOk(P, n, t0);
    let j = 'miss';
    if (P.diff === 'easy') j = (art || sound) && ok ? (art && bd > wp ? 'good' : 'perfect') : 'miss';
    else if (art && bd <= wp && ok) j = 'perfect';
    else if ((art || sound) && ok) j = 'good';
    judge(P, n, j);
  }
  // 오래된 기록 정리
  const cut = tmNow - 6;
  while (P.onsets.length && P.onsets[0].t < cut) P.onsets.shift();
  while (P.pitches.length > 400) P.pitches.shift();
  while (P.segs.length > 30) P.segs.shift();
}
function expireTaps(P, tmNow) {
  const [, wg] = windowFor(P.inst, P.diff);
  const ns = P.part.notes;
  while (P.next < ns.length) {
    const n = ns[P.next];
    if (P.judged[n.i]) { P.next++; continue; }
    if (timeOf(n.b) + wg < tmNow - 0.03) { judge(P, n, 'miss'); P.next++; continue; }
    break;
  }
}

// ─── 폰 이벤트 ───
function recInst(P) {
  if (!recSynth) return null;
  if (!P.recInst) P.recInst = recSynth.instrument(INSTRUMENTS[P.inst].synth || 'drums');
  return P.recInst;
}
function onPlay(d) {
  const slot = Number(d.slot);
  const p = players.get(slot);
  if (!p) return;
  const now = performance.now();
  const a = p.act;
  a.last = now;
  if (d.k === 'hit' || d.k === 'tap') a.hits.push({ t: now, vel: d.vel || 0.7, x: d.tom ? (d.tom === 1 ? 0.6 : -0.6) : (Math.random() - 0.5) * 0.3 });
  if (d.k === 'key') { a.keys.set(d.m, now); a.hits.push({ t: now, vel: d.vel || 0.7 }); }
  if (['blow', 'bow', 'sing', 'slur'].includes(d.k)) { a.sounding = true; a.m = d.m; a.level = Math.max(a.level, d.vel || 0.6); if (d.k !== 'slur') a.hits.push({ t: now, vel: 0.5 }); }
  hall.playerAct(slot, d.k, d);
  const perf = game.perf;
  if (game.phase !== 'playing' || !perf) return;
  const P = perf.players.get(slot);
  if (!P) return;
  const tm = actionTime(d);
  // 녹화 믹스(사람 파트는 스피커로 안 나감)
  const ri = recInst(P);
  if (ri) {
    if (d.k === 'hit') { ri.play(d.tom === 1 ? 45 : d.tom === 2 ? 48 : nearestDrum(P, tm), { vel: d.vel || 0.8 }); }
    else if (d.k === 'tap') { const n = d.roll ? 5 : 1; for (let i = 0; i < n; i++) ri.play(85, { when: recSynth.now() + i * 0.032, vel: (d.vel || 0.8) - i * 0.06 }); }
    else if (d.k === 'key') {
      const v = ri.noteOn(d.m, { vel: d.vel || 0.75 });
      const old = P.recKeys.get(d.m); if (old) old.off();
      P.recKeys.set(d.m, v);
      if (d.fi != null && P.part.notes[d.fi]) {
        const spb = 60 / (tr ? tr.bpm : game.song.bpm);
        for (const f of P.part.notes[d.fi].fill) ri.play(f[2], { when: recSynth.now() + f[0] * spb, dur: f[1] * spb * 0.95, vel: (d.vel || 0.75) * (f[3] || 0.8) });
      }
    } else if (d.k === 'slur') { if (P.recVoice) P.recVoice.setPitch(d.m, 0.03); }
    else if (['blow', 'bow', 'sing'].includes(d.k)) {
      if (P.recVoice) P.recVoice.off();
      P.recVoice = ri.noteOn(d.m, { vel: 0.5 + (d.vel || 0.5) * 0.4 });
    }
  }
  if (game.stage !== 'live' && game.stage !== 'count') return;
  const k = INSTRUMENTS[P.inst].kind;
  if (k === 'strike' || k === 'tap' || k === 'keys') { if (game.stage === 'live') judgeTap(P, d, tm); return; }
  if (isSustain(P.inst)) {
    const art = d.k !== 'slur' || Boolean(d.art);
    P.onsets.push({ t: tm, m: d.m, art });
    P.pitches.push({ t: tm, m: d.m, raw: d.raw ?? null });
    if (d.k !== 'slur' || !P.cur) {
      if (P.cur && P.cur.off == null) P.cur.off = tm;
      P.cur = { on: tm, off: null, last: tm };
      P.segs.push(P.cur);
    } else P.cur.last = tm;
  }
}
function nearestDrum(P, tm) {
  let best = 38, bd = 0.25;
  for (let i = Math.max(0, P.next - 2); i < Math.min(P.part.notes.length, P.next + 6); i++) {
    const n = P.part.notes[i];
    const dt = Math.abs(timeOf(n.b) - tm);
    if (dt < bd) { bd = dt; best = n.m; }
  }
  return best;
}
function onRelease(d) {
  const slot = Number(d.slot);
  const p = players.get(slot);
  if (!p) return;
  p.act.sounding = false;
  hall.playerAct(slot, 'release', d);
  const P = game.perf && game.perf.players.get(slot);
  if (!P) return;
  if (d.m != null && P.recKeys.has(d.m)) { P.recKeys.get(d.m).off(); P.recKeys.delete(d.m); }
  if (P.recVoice && d.m == null) { P.recVoice.off(); P.recVoice = null; }
  if (P.cur && P.cur.off == null) { P.cur.off = actionTime({ ago: 0, rtt: 80 }); P.cur = null; }
}
function onLevel(d) {
  const slot = Number(d.slot);
  const p = players.get(slot);
  if (!p) return;
  p.act.level = d.lv || 0;
  p.act.m = d.m;
  p.act.sounding = true;
  p.act.last = performance.now();
  hall.playerLevel(slot, d.lv || 0);
  const P = game.perf && game.perf.players.get(slot);
  if (!P) return;
  const tm = actionTime({ ago: 0, rtt: d.rtt || 80 });
  P.pitches.push({ t: tm, m: d.m, raw: d.raw ?? null });
  if (P.cur) P.cur.last = tm;
  else { P.cur = { on: tm, off: null, last: tm }; P.segs.push(P.cur); }
  if (P.recVoice) { P.recVoice.setLevel(0.35 + (d.lv || 0) * 0.85); if (d.m != null) P.recVoice.setPitch(d.m, 0.04); }
}
function onPose(d) {
  const slot = Number(d.slot);
  const p = players.get(slot);
  if (!p) return;
  p.act.trail.push({ t: performance.now(), x: d.x, y: d.y });
  while (p.act.trail.length > 60) p.act.trail.shift();
  hall.baton(slot, d.x, d.y);
}
function onBeat(d) {
  const slot = Number(d.slot);
  const p = players.get(slot);
  if (!p) return;
  p.act.beats.push({ t: performance.now(), dir: d.dir });
  while (p.act.beats.length > 8) p.act.beats.shift();
  p.act.last = performance.now();
  hall.playerAct(slot, 'beat', d);
  const perf = game.perf;
  if (game.phase !== 'playing' || !perf || game.stage !== 'live') return;
  const P = perf.players.get(slot);
  if (!P) return;
  const tm = actionTime(d);
  P.ictus.push({ t: tm, dir: d.dir });
  // 판정: 가까운 박
  const [wp, wg] = windowFor(P.inst, P.diff);
  let best = null, bd = 1e9;
  for (let i = P.next; i < P.part.notes.length; i++) {
    const n = P.part.notes[i];
    const t = timeOf(n.b);
    if (t > tm + wg) break;
    if (P.judged[n.i] || t < tm - wg) continue;
    const dt = Math.abs(t - tm);
    if (dt < bd) { bd = dt; best = n; }
  }
  if (best) {
    const okDir = dirOk(best.dir, d.dir, P.diff);
    judge(P, best, okDir ? (bd <= wp ? 'perfect' : 'good') : P.diff === 'hard' ? 'miss' : 'good');
  }
  if (perf.leader === slot) steerTempo(P, tm, d);
}
// 지휘자의 박이 곡 빠르기를 정합니다(±15%, 부드럽게). 박점이 늦으면 살짝 늦추고, 빠르면 당깁니다. 크게 저으면 소리가 커집니다.
function steerTempo(P, tm, d) {
  const perf = game.perf;
  const song = game.song;
  const pat = patternOf(song);
  const b = tr.beatAt(tm);
  const bar = Math.floor(b / song.barLen);
  let e = null, bd = 9;
  for (const k of [bar - 1, bar, bar + 1]) for (const [off] of pat) { const x = k * song.barLen + off; if (Math.abs(x - b) < bd) { bd = Math.abs(x - b); e = x; } }
  const spacing = pat.length > 1 ? pat[1][0] - pat[0][0] : song.barLen;
  if (e == null || bd > spacing * 0.45) return;
  const err = (b - e) / spacing;
  const last = perf.lastIctus;
  perf.lastIctus = { e, tm };
  perf.ictusAt = performance.now();
  let target = perf.rate;
  if (last && e > last.e && e - last.e <= song.barLen + 0.01) {
    const bpmC = ((e - last.e) * 60) / Math.max(0.1, tm - last.tm);
    target = clamp(bpmC / bpmAt(song, e), 0.85, 1.15);
  }
  target = clamp(target * (1 - clamp(err, -0.4, 0.4) * 0.22), 0.85, 1.15);
  perf.rate = clamp(perf.rate + (target - perf.rate) * 0.45, 0.85, 1.15);
  tr.setRate(perf.rate);
  const sz = clamp(Number(d.size) || 30, 4, 70);
  const dynT = 0.55 + ((sz - 4) / 66) * 0.65;
  perf.dyn = perf.dyn * 0.6 + dynT * 0.4;
  perf.dynWord = sz < 10 ? 'pp' : sz < 18 ? 'p' : sz < 28 ? 'mp' : sz < 40 ? 'mf' : sz < 56 ? 'f' : 'ff';
  synth.setVolume(0.8 * clamp(perf.dyn, 0.5, 1.2), 0.15);
}
function relaxTempo() {
  const perf = game.perf;
  if (!perf || !tr || perf.leader == null) return;
  if (performance.now() - perf.ictusAt > 2600 && Math.abs(perf.rate - 1) > 0.005) {
    perf.rate += (1 - perf.rate) * 0.04;
    tr.setRate(perf.rate);
  }
}

// ─── 봇: 박에 맞춰 잘 칩니다 ───
function runBots(tmNow) {
  for (const P of game.perf.players.values()) {
    if (!P.bot) continue;
    const ns = P.part.notes;
    while (P.botNext < ns.length && timeOf(ns[P.botNext].b) <= tmNow) {
      const n = ns[P.botNext++];
      if (P.judged[n.i]) continue;
      const r = Math.random();
      const j = r < 0.8 ? 'perfect' : r < 0.95 ? 'good' : 'miss';
      judge(P, n, j);
      if (j !== 'miss') {
        const k = INSTRUMENTS[P.inst].kind;
        const kind = k === 'strike' ? 'hit' : k === 'tap' ? 'tap' : k === 'keys' ? 'key' : k === 'baton' ? 'beat' : k === 'bow' ? 'bow' : k === 'voice' ? 'sing' : 'blow';
        hall.playerAct(P.slot, kind, { vel: 0.8, dir: n.dir, m: n.m, tom: 0 });
        if (isSustain(P.inst)) hall.playerLevel(P.slot, 0.75);
      }
    }
  }
}

// ─── 패널 ───
function buildPanels(song) {
  const box = $('panels');
  box.textContent = '';
  panels.clear();
  const list = [...game.perf.players.values()].sort((a, b) => a.slot - b.slot);
  box.dataset.n = String(list.length);
  document.body.dataset.n = String(list.length);
  for (const P of list) {
    const I = INSTRUMENTS[P.inst];
    const el = document.createElement('div');
    el.className = 'panel';
    el.style.setProperty('--pc', P.color);
    el.innerHTML = `<div class="ph"><b>${P.name}</b><i>${ICONS[P.inst]}</i><div class="pn"><strong>${I.label}</strong><span>${I.role} · ${DIFF_LABEL[P.diff]}${P.bot ? ' · 봇' : ''}</span></div><div class="pacc"><b>–</b><span>정확도</span></div></div><div class="pbody"><canvas></canvas><div class="pop"></div><div class="pcombo"></div></div>`;
    box.appendChild(el);
    const sc = createScore(el.querySelector('canvas'), { compact: list.length >= 3, ahead: 3.6 });
    sc.setPart(P.part, song, P.inst, P.color, P.diff);
    panels.set(P.slot, { el, score: sc, pop: el.querySelector('.pop'), combo: el.querySelector('.pcombo'), acc: el.querySelector('.pacc b') });
  }
  requestAnimationFrame(() => { for (const pn of panels.values()) pn.score.resize(); });
}
function drawPanels() {
  const perf = game.perf;
  if (!perf) return;
  const b = heardBeat();
  const bpm = tr ? tr.bpm : game.song.bpm;
  for (const [slot, pn] of panels) {
    const P = perf.players.get(slot);
    const p = players.get(slot);
    const lv = p && p.act.sounding && performance.now() - p.act.last < 600 ? p.act.level : 0;
    pn.score.draw(b, { bpm, level: lv });
    const jc = judgedCount(P);
    pn.acc.textContent = jc ? `${Math.round((P.stats.pts / jc) * 100)}%` : '–';
  }
}

// ─── 위 막대(곡 진행·빠르기·셈여림·합주) ───
let lastTempoSend = 0;
function updateTop(nowMs) {
  const perf = game.perf;
  const song = game.song;
  if (!perf || !song) return;
  const b = heardBeat();
  $('pProg').style.width = `${clamp((b / song.beats) * 100, 0, 100).toFixed(2)}%`;
  const pct = Math.round((perf.rate - 1) * 100);
  $('pTempo').textContent = perf.leader != null ? `${Math.round(tr ? tr.bpm : song.bpm)} ${pct ? `(${pct > 0 ? '+' : ''}${pct}%)` : ''}` : `${song.bpm}`;
  $('pDyn').textContent = perf.leader != null ? perf.dynWord : 'mf';
  const ens = clamp(perf.ens, 0, 1);
  $('pEns').textContent = gradeOf(ens);
  $('pEnsBar').style.width = `${(ens * 100).toFixed(1)}%`;
  $('pTime').textContent = `${fmtTime(Math.max(0, (b * 60) / (tr ? tr.bpm : song.bpm)))} / ${fmtTime(song.lengthSec)}`;
  if (nowMs - lastTempoSend > 250 && (game.stage === 'count' || game.stage === 'live' || game.stage === 'end')) {
    lastTempoSend = nowMs;
    send('tempo', { b: Math.round(b * 1000) / 1000, bpm: Math.round((tr ? tr.bpm : song.bpm) * 100) / 100, lat: Math.round(displayRtt() / 2), st: game.stage, dyn: Math.round(perf.dyn * 100) / 100, pct: perf.leader != null ? pct : null });
  }
}
let centerTimer = 0;
function centerText(big, small) {
  const c = $('pCenter');
  c.innerHTML = big ? `<b>${esc(big)}</b>${small ? `<span>${esc(small)}</span>` : ''}` : '';
  c.classList.remove('show');
  c.classList.toggle('num', /^\d$/.test(big || ''));
  void c.offsetWidth;
  if (big) c.classList.add('show');
  clearTimeout(centerTimer);
  if (big && /^\d$/.test(big)) centerTimer = setTimeout(() => { c.innerHTML = ''; }, 700);
}

// ═══════════════ 결과 ═══════════════
function renderOver() {
  const R = game.results;
  if (game.phase !== 'over' || !R) return;
  const song = R.song;
  $('oCover').src = drawCover(song, 220);
  $('oSong').textContent = song.title;
  $('oComposer').textContent = `${song.composer} · ${song.en}`;
  $('oGrade').textContent = R.ens.grade;
  $('oWord').textContent = R.list.length ? `${GRADE_WORD[R.ens.grade]} · ${R.ens.partial ? '중간 참가 구간 정확도' : '합주 정확도'} ${Math.round(R.ens.acc * 100)}%` : '자동 연주';
  $('oCards').innerHTML = R.list.map((r) => {
    const I = INSTRUMENTS[r.inst];
    return `<div class="oc" style="--pc:${r.color}"><div class="oc-h"><b>${r.name}</b><i>${ICONS[r.inst]}</i><strong>${I.label}</strong><em>${DIFF_LABEL[r.diff]}${r.late ? ' · 중간 참가' : ''}</em></div><div class="oc-g">${r.grade}<span>${Math.round(r.acc * 100)}%</span></div><div class="oc-s"><span>PERFECT <b>${r.perfect}</b></span><span>GOOD <b>${r.good}</b></span><span>MISS <b>${r.miss}</b></span><span>콤보 <b>${r.maxCombo}</b></span>${r.steady != null ? `<span>안정감 <b>${Math.round(r.steady * 100)}%</b></span>` : ''}</div></div>`;
  }).join('');
  const btn = $('oDlBtn');
  if (localBlobUrl) {
    btn.href = localBlobUrl;
    btn.setAttribute('download', game.recInfo ? game.recInfo.name : 'orchestra.webm');
    btn.classList.remove('off');
  } else { btn.removeAttribute('href'); btn.classList.add('off'); }
  const info = game.recInfo;
  $('oDlSub').textContent = !REC_ON ? '녹화를 껐어요' : game.rec.uploading && !localBlobUrl ? '녹화 마무리하는 중…'
    : game.clip ? `${info ? (info.size / 1048576).toFixed(1) + 'MB · ' : ''}폰에서도 받을 수 있어요 · 10분 뒤 사라져요`
      : game.rec.uploading ? '폰으로 보내는 중… · 10분 뒤 사라져요'
        : localBlobUrl ? `이 화면에서만 받을 수 있어요 · 다음 곡을 시작하면 사라져요` : '녹화본이 없어요';
  $('oDl').classList.toggle('hidden', !REC_ON);
  renderOverReady();
}
function renderOverReady() {
  if (game.phase !== 'over') return;
  const ready = readySt && readySt.ready ? readySt.ready : [];
  const need = readySt ? readySt.need : 0;
  $('oReady').textContent = need ? `다시 하기 준비 ${ready.length}/${need}` : '';
}
$('oDlBtn').addEventListener('click', (e) => { if (!localBlobUrl) e.preventDefault(); });
window.addEventListener('pagehide', () => { if (localBlobUrl) URL.revokeObjectURL(localBlobUrl); });

// ═══════════════ 녹화 화면 합성(1280×720) ═══════════════
function composeFrame(g, W, H) {
  const src = hall.canvas;
  const sw = src.width, sh = src.height;
  const s = Math.max(W / sw, H / sh);
  g.drawImage(src, (W - sw * s) / 2, (H - sh * s) / 2, sw * s, sh * s);
  const sx = W / window.innerWidth, sy = H / window.innerHeight;
  // 위 제목
  g.fillStyle = 'rgba(10,6,12,.55)';
  g.fillRect(0, 0, W, 54);
  g.fillStyle = '#f6f1e7';
  g.font = '800 24px "Pretendard Variable", Pretendard, sans-serif';
  if (game.song) g.fillText(`${game.song.title} · ${game.song.composer}`, 22, 35);
  g.textAlign = 'right';
  g.font = '700 16px "Pretendard Variable", Pretendard, sans-serif';
  g.fillStyle = '#e9c47a';
  g.fillText('PHONE ORCHESTRA', W - 22, 33);
  g.textAlign = 'start';
  // 사람별 악보 칸
  for (const [slot, pn] of panels) {
    const r = pn.el.getBoundingClientRect();
    if (!r.width) continue;
    const x = r.left * sx, y = r.top * sy, w = r.width * sx, h = r.height * sy;
    g.fillStyle = 'rgba(12,9,18,.82)';
    roundRect(g, x, y, w, h, 14);
    g.fill();
    const P = game.perf && game.perf.players.get(slot);
    g.fillStyle = P ? P.color : '#fff';
    g.fillRect(x, y, 5, h);
    g.font = '400 20px Anton, Impact, sans-serif';
    g.fillText(P ? P.name : '', x + 14, y + 26);
    g.font = '800 15px "Pretendard Variable", Pretendard, sans-serif';
    g.fillStyle = '#f6f1e7';
    if (P) g.fillText(`${INSTRUMENTS[P.inst].label} · ${pn.acc.textContent}`, x + 50, y + 25);
    const cv = pn.score.canvas;
    const cr = cv.getBoundingClientRect();
    if (cv.width && cr.width) g.drawImage(cv, cr.left * sx, cr.top * sy, cr.width * sx, cr.height * sy);
  }
  // 가운데 글(카운트·브라보)
  const c = $('pCenter');
  if (c.textContent) {
    g.textAlign = 'center';
    g.fillStyle = '#fff';
    g.font = '400 96px Anton, Impact, sans-serif';
    g.fillText(c.querySelector('b') ? c.querySelector('b').textContent : '', W / 2, H * 0.42);
    g.textAlign = 'start';
  }
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// ═══════════════ 키보드 ═══════════════
// Enter: 다음(모두 준비가 아니면 ready.js 가 먼저 막음) · ← → Space: 곡 넘기기·고르기 · D: 난이도 · Esc: 대기실로
window.addEventListener('keydown', (e) => {
  unlockAudio();
  if (e.key === 'Enter') { e.preventDefault(); if (game.phase === 'select' && picker && !game.picked) picker.select(); advance(); return; }
  if (game.phase === 'select' && picker) {
    if (e.key === 'ArrowLeft') { driver = null; picker.setDriver(null); picker.nudge(-1); }
    else if (e.key === 'ArrowRight') { driver = null; picker.setDriver(null); picker.nudge(1); }
    else if (e.key === ' ') { e.preventDefault(); picker.select(); }
    else if (e.key === 'ArrowUp') picker.cycleDifficulty(-1);
    else if (e.key === 'ArrowDown') picker.cycleDifficulty(1);
  }
  if (e.key === 'Escape' && game.phase !== 'playing' && game.phase !== 'lobby') backToLobby();
});

// ═══════════════ 매 프레임 ═══════════════
let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  runQueue();
  if (game.phase === 'playing' && game.perf && tr) {
    const tmNow = musicNow();
    if (game.stage === 'live') {
      for (const P of game.perf.players.values()) {
        if (P.bot) continue;
        if (isSustain(P.inst)) judgeSustainDue(P, tmNow);
        else expireTaps(P, tmNow);
      }
      runBots(tmNow);
      relaxTempo();
      if (LIMIT_SEC && tmNow - game.perf.startAt > LIMIT_SEC) { tr.stop(); endSong(true); }
    }
    drawPanels();
    updateTop(now);
    hall.setTempo(heardBeat(), game.song, game.perf.leader != null);
  }
  if (game.phase === 'practice') drawTiles(now);
  hall.render(dt, now);
  if (recorder) recorder.frame();
}
requestAnimationFrame(frame);

// ═══════════════ 처음 화면 ═══════════════
setPhase('lobby');
syncPlayers();
if (AUTOSTART && BOTS) {
  // 폰이 없을 때만: 대기실 → 곡 고르기 → 연주
  setTimeout(() => {
    if (serverPlayers.length || game.phase !== 'lobby') return;
    advance();
    setTimeout(() => { if (game.phase === 'select' && !serverPlayers.length) { picker.select(); advance(); } }, 1600);
  }, 1500);
}

window.__orchestra = {
  get phase() { return game.phase; }, get stage() { return game.stage; }, game, players, settings, hall,
  get picker() { return picker; }, get tr() { return tr; }, get beat() { return heardBeat(); },
  advance,
  pick(id) { ensurePicker(); if (picker.goToId) picker.goToId(id); setTimeout(() => picker.select(), 700); },
  setInst(slot, inst) { const p = players.get(slot); if (p && INSTRUMENTS[inst]) { p.inst = inst; hall.setPlayers(playerList()); renderLobby(); pushState(); } },
  finish() { if (tr) tr.stop(); endSong(true); },
  skipIntro() { hall.skipIntro(); },
  sim(slot, ev, data) { const h = { play: onPlay, release: onRelease, level: onLevel, beat: onBeat, pose: onPose, instrument: onInstrument, tutorial: (d) => { const p = players.get(slot); if (p) { p.tut = d; renderPractice(); } } }[ev]; if (h) h({ ...data, slot }); },
  stats() { return game.perf ? [...game.perf.players.values()].map((P) => ({ slot: P.slot, inst: P.inst, ...P.stats, n: P.part.notes.length })) : null; },
  get rec() { return { on: Boolean(recorder), blob: localBlobUrl, clip: game.clip, uploading: game.rec.uploading, info: game.recInfo }; },
};
