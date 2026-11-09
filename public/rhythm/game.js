// 리듬 스텝 큰 화면: DDR·펌프처럼 화살표 노트에 맞춰 밟는(누르는) 리듬 게임. 1~4명.
// 사람마다 폰에서 입력을 고릅니다: 패드(폰 화면의 큰 화살표를 누름) 또는 모션(폰을 들고 위·아래·왼쪽·오른쪽으로 휙).
// 노래는 큰 화면이 공용 합성기(/common/music/synth.js)로 연주하고, 판정은 오디오 시계로 합니다.
//   폰이 누른 실제 순간 = 도착 시각 − 폰이 잰 이벤트 지연(ago) − 폰 왕복/2 − 화면 왕복/2  (다른 종목과 같은 지연 보정)
//   그 순간을 '스피커에서 그 소리가 나온 오디오 시각'으로 바꿔(getOutputTimestamp) 노트 시각과 비교합니다.
// 단계: select(대기실 겸 CD 고르기, 모두 준비하면 서버가 start_game) → playing → over(결과, 잠시 뒤 다시 select)
// 시험: ?bots=N, ?keys(키보드 1P), ?autostart(봇만 있을 때), ?song=<id>, ?difficulty=, ?input=, ?lanes=  / window.__rhythm
import { createStage } from './stage.js';
import { createHighways, newFx, LANE_GLYPH } from './highway.js';
import { notesForLateJoin, rankFinishers } from './late-join.mjs';
import { createJudge } from './judge.js';
import { SONGS, getSong, beatToSec, secToBeat } from '/common/music/songs.js';
import { createSynth, createTransport, playPreview } from '/common/music/synth.js';
import { genChart, chartInfo } from '/common/music/charts.js';
import { createDiscPicker, drawCover } from '/common/disc-picker.js';
import { createSettings, fields, DIFF_LABEL } from '/common/settings.js';
import { createTutorialBoard } from '/common/tutorial-board.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const num = (v, d) => (v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const BOTS = clamp(parseInt(params.get('bots'), 10) || 0, 0, 4);
const KEYS = params.has('keys');
const AUTOSTART = params.has('autostart');
const SONG_PARAM = params.get('song');

// ---------- 조정 값 ----------
const LEAD_S = 3.4; // 시작 전 카운트다운(초). 첫 노트가 아래에서 올라오는 것도 이 동안 보입니다.
const OVER_MS = 18000; // 결과 화면을 보여 주는 시간. 그 뒤 노래 고르기로 돌아갑니다.
const DRIVER_MS = 2600; // 폰으로 CD 를 넘긴 사람 표시 시간
const SLOT_INFO = { 1: { name: '1P', color: '#ff5a5f' }, 2: { name: '2P', color: '#3ab4ff' }, 3: { name: '3P', color: '#ffc93c' }, 4: { name: '4P', color: '#5ee07a' } };
// 봇 설정(자리마다 다르게 해서 화면에 여러 입력 방식이 보이게)
const BOT_CFG = {
  1: { input: 'pad', lanes: 4, diff: 'normal', sd: 0.02 },
  2: { input: 'motion', lanes: 4, diff: 'easy', sd: 0.045 },
  3: { input: 'pad', lanes: 5, diff: 'hard', sd: 0.018 },
  4: { input: 'pad', lanes: 4, diff: 'normal', sd: 0.028 }
};
const KEYMAP4 = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3, ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 };
const KEYMAP5 = { KeyZ: 0, KeyQ: 1, KeyS: 2, KeyE: 3, KeyC: 4, KeyD: 0, KeyF: 1, Space: 2, KeyJ: 3, KeyK: 4 };
const MODE_SVG = {
  pad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 7v10M7 12h10M9 9l3-3 3 3"/></svg>',
  motion: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="5" width="8" height="14" rx="2"/><path d="M4 9l-2 3 2 3M20 9l2 3-2 3M12 1v2M12 21v2"/></svg>'
};

await Promise.race([
  Promise.all([document.fonts.load('400 64px Anton'), document.fonts.load('800 64px "Pretendard Variable"')]),
  new Promise((r) => setTimeout(r, 2000))
]).catch(() => {});

const stage = createStage($('stage'));
const highways = createHighways($('lanes'));

// ================================================================
// 소리: 공용 합성기. 스피커로 나가는 소리를 분석기로도 받아 무대 이퀄라이저를 움직입니다.
// ================================================================
const synth = createSynth({ volume: 0.9 });
const analyser = synth.ctx.createAnalyser();
analyser.fftSize = 256;
analyser.smoothingTimeConstant = 0.6;
analyser.minDecibels = -92;
analyser.maxDecibels = -18;
synth.output.connect(analyser);
const bands = new Uint8Array(analyser.frequencyBinCount);
const transport = createTransport(synth);
let audioWaiters = [];
function audioRunning() { return synth.ctx.state === 'running'; }
function unlockAudio() {
  const was = audioRunning();
  synth.resume().then(() => {
    if (!audioRunning()) return;
    const w = audioWaiters; audioWaiters = []; for (const f of w) f();
    // 소리가 처음 켜졌으면 가운데 CD 미리듣기를 바로 들려줍니다
    if (!was && game.phase === 'select' && !previewStop) picker.preview();
  });
}
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);
synth.ctx.addEventListener && synth.ctx.addEventListener('statechange', () => {
  if (audioRunning()) { const w = audioWaiters; audioWaiters = []; for (const f of w) f(); }
});
function whenAudio(fn) { if (audioRunning()) fn(); else { audioWaiters.push(fn); unlockAudio(); } }

// 오디오 시계(스피커에서 지금 나오는 소리의 시각)와 performance.now() 사이 간격. 떨림을 줄이려고 천천히 따라갑니다.
let clockOff = null;
function syncClock() {
  const ctx = synth.ctx;
  let off;
  if (ctx.getOutputTimestamp) {
    const ts = ctx.getOutputTimestamp();
    if (ts && ts.contextTime > 0 && ts.performanceTime > 0) off = ts.contextTime - ts.performanceTime / 1000;
  }
  if (off === undefined) off = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0) - performance.now() / 1000;
  if (clockOff === null || Math.abs(off - clockOff) > 0.05) clockOff = off;
  else clockOff += (off - clockOff) * 0.04;
}
const audioAt = (perfMs) => perfMs / 1000 + (clockOff ?? 0);
// 사람이 맞춘 싱크(TV 소리가 늦을 때 등): [ ] 키로 10ms 씩
let userOffset = num(localStorage.getItem('pcg-rhythm-offset'), 0);

// ================================================================
// 연결
// ================================================================
const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true });
let serverPlayers = [];
let hadRoom = false;
let readySet = new Set();
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

// ---------- 설정: 각자 난이도·입력·패드 배치 ----------
const settings = createSettings({
  game: 'rhythm',
  fields: [
    // 난이도 D 키: 대기실에서 모두의 난이도를 돌립니다. 경기 중에는 설정이 잠겨 D 는 레인 키로만 씁니다.
    fields.difficulty({ perPlayer: true, hints: { easy: '판정 넉넉 · 노트 적게', normal: '8분음표 · 가끔 동시에', hard: '16분음표 · 길게 누르기' } }),
    fields.choice('input', '입력', [
      { value: 'pad', label: '패드', hint: '폰 화면의 화살표를 눌러요' },
      { value: 'motion', label: '모션', hint: '폰을 들고 화살표 쪽으로 휙' }
    ], { perPlayer: true, default: 'pad' }),
    fields.choice('lanes', '패드 배치', [
      { value: 4, label: '4키', hint: 'DDR ← ↓ ↑ →' },
      { value: 5, label: '5키', hint: '펌프 ↙ ↖ ● ↗ ↘' }
    ], { perPlayer: true, default: 4 })
  ],
  onChange: (vals, change) => {
    // 큰 화면에서 모두의 난이도를 바꾸면(D 키) CD 아래 난이도 칩도 맞춥니다
    if (change && change.key === 'difficulty' && change.by === 'display' && picker && picker.difficulty !== change.value) picker.setDifficulty(change.value);
    renderRoster(); pushState(); sendPickerSoon();
  }
});
settings.attach(socket);
const board = createTutorialBoard({ mount: $('tutBox'), title: '처음이라 연습 중' });
board.attach(socket);

socket.on('connect', () => {
  let saved = null;
  try { saved = sessionStorage.getItem('pcg-rhythm-room'); } catch (e) {}
  socket.emit('join', { role: 'display', game: 'rhythm', room: saved });
});
socket.on('room', async (r) => {
  try { sessionStorage.setItem('pcg-rhythm-room', r.code); } catch (e) {}
  serverPlayers = r.players || [];
  syncRoster();
  if (r.fresh && hadRoom && game.phase !== 'select') goSelect('서버가 다시 시작돼서 노래 고르기로 돌아왔어요');
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
  renderRoster();
  pushState();
  sendPicker();
});
socket.on('players', (p) => {
  serverPlayers = p.players || [];
  syncRoster();
  if (game.phase === 'playing' && game.song) {
    let changed = false;
    for (const sp of serverPlayers) {
      if (!sp.connected) continue;
      const old = game.players.findIndex((x) => x.slot === sp.slot);
      if (old >= 0 && !game.players[old].bot && !game.players[old].keys) continue;
      const P = roster.get(sp.slot);
      if (!P) continue;
      const player = makeGamePlayer(P, game.song, Math.max(0, songTimeAt(performance.now()) + 1));
      player.late = player.judge.notes.length < player.chart.notes.length;
      if (old >= 0) game.players.splice(old, 1, player); else game.players.push(player);
      changed = true;
    }
    if (changed) {
      game.players.sort((a, b) => a.slot - b.slot);
      stage.setPlayers(game.players.map((x) => x.color));
      highways.layout(game.players);
      banner('중간 참가!', '지금부터 나오는 노트부터 점수에 반영돼요', 2500);
    }
  }
  renderRoster();
  pushState();
  sendPickerSoon();
});
socket.on('ready_state', (st) => {
  readySet = new Set(st && Array.isArray(st.ready) ? st.ready : []);
  renderRoster();
});
socket.on('display_replaced', () => $('replaced').classList.remove('hidden'));
socket.on('start_game', () => {
  if (game.phase === 'select') startGame();
  else if (game.phase === 'over') goSelect();
});
socket.on('step', (d) => onRemoteStep(d));
socket.on('release', (d) => onRemoteRelease(d));
socket.on('nav', (d) => onNav(d));
socket.on('pick', (d) => onPhonePick(d));
socket.on('calibrate', (d) => { const P = roster.get(Number(d && d.slot)); if (P) { P.motionOk = true; P.motionFallback = Boolean(d && d.fallback); renderRoster(); } });
const tutState = {};
socket.on('tutorial', (d) => {
  if (!d || d.slot == null) return;
  tutState[d.slot] = d.done ? null : d;
  renderRoster();
  pushStateSoon(); // 다른 폰의 '누가 아직' 줄에 '연습 중' 을 보여 줍니다
});

// ================================================================
// 자리(사람·봇·키보드)
// ================================================================
const roster = new Map(); // slot → P
function ensureP(slot) {
  let P = roster.get(slot);
  if (!P) {
    P = { slot, name: SLOT_INFO[slot].name, color: SLOT_INFO[slot].color, present: false, connected: false, bot: false, keys: false, motionOk: false };
    roster.set(slot, P);
  }
  return P;
}
function syncRoster() {
  const seen = new Set();
  for (const sp of serverPlayers) {
    if (!SLOT_INFO[sp.slot]) continue;
    const P = ensureP(sp.slot);
    P.present = true; P.bot = false; P.keys = false;
    P.connected = Boolean(sp.connected);
    seen.add(sp.slot);
  }
  let needBots = BOTS;
  if (KEYS && !seen.has(1)) {
    const P = ensureP(1);
    P.present = true; P.bot = false; P.keys = true; P.connected = true;
    seen.add(1);
  }
  // 봇은 뒤 자리(4P 부터)를 채웁니다. 폰은 서버가 앞 자리부터 주므로 경기 중에 들어온 폰과 겹치지 않습니다.
  for (let s = 4; s >= 1 && needBots > 0; s--) {
    if (seen.has(s)) continue;
    const P = ensureP(s);
    P.present = true; P.bot = true; P.keys = false; P.connected = true;
    seen.add(s);
    needBots -= 1;
  }
  for (const P of roster.values()) {
    if (!seen.has(P.slot)) { P.present = false; P.connected = false; P.bot = false; P.keys = false; P.motionOk = false; }
  }
  // 경기 중이면 길 위의 연결 표시도 맞춥니다
  for (const p of game.players) { const P = roster.get(p.slot); p.connected = P ? P.present && P.connected : false; }
}
const phones = () => [...roster.values()].filter((P) => P.present && !P.bot && !P.keys);
const presentList = () => [...roster.values()].filter((P) => P.present).sort((a, b) => a.slot - b.slot);
function cfgOf(P) {
  if (P.bot) return BOT_CFG[P.slot];
  const input = P.keys ? 'pad' : settings.get('input', P.slot) || 'pad';
  const lanes = input === 'motion' ? 4 : Number(settings.get('lanes', P.slot)) === 5 ? 5 : 4;
  return { input, lanes, diff: settings.get('difficulty', P.slot) || 'normal' };
}

// ================================================================
// 노래 고르기(CD)
// ================================================================
const game = {
  phase: 'select', // select | playing | over
  song: null, chosen: null, chosenBy: null, lastSongId: null,
  players: [], beats: [], t0: null, startPerf: 0, ended: false, results: [], overTimer: null, countTimers: [],
  idleBeat: 0
};
let previewStop = null;
let picker = null; // 만드는 도중에도 onChange 가 불려서 미리 이름만 둡니다
picker = createDiscPicker($('picker'), {
  songs: SONGS,
  difficulty: settings.get('difficulty') || 'normal',
  storageKey: 'pcg-rhythm-picker',
  title: '노래 고르기',
  hint: '폰을 좌우로 밀어 넘기기 · 탭하면 그 곡',
  accent: '#7fd4ff',
  stopOnSelect: false,
  previewSeconds: 15,
  startId: SONG_PARAM && getSong(SONG_PARAM) ? SONG_PARAM : undefined,
  chartInfo: (s, d) => chartInfo(s, d, { lanes: 4, input: 'pad' }),
  preview: (s) => {
    if (!audioRunning() || game.phase !== 'select') return null;
    const stop = playPreview(synth, s, { seconds: 15, gain: 0.8 });
    previewStop = stop;
    return stop;
  },
  onGesture: () => unlockAudio(),
  onChange: (song) => {
    stage.setHue(song.cover ? song.cover.hue : 200);
    if (!picker) return;
    if (game.chosen && game.chosen.id !== song.id) { game.chosen = null; game.chosenBy = null; renderPicked(); }
    renderRoster();
    sendPickerSoon();
  },
  onSelect: (song) => onPick(song, pickBy),
  onDifficulty: (d) => { if (game.phase === 'select') settings.set('difficulty', d, 'display'); }
});
let pickBy = 'display';
stage.setHue(picker.song && picker.song.cover ? picker.song.cover.hue : 200);
function stopPreview() { picker.stopPreview(); if (previewStop) { try { previewStop(); } catch (e) {} previewStop = null; } }

function songMeta(s) {
  if (!s) return null;
  return { id: s.id, title: s.title, en: s.en, composer: s.composer, genre: s.genre, mood: s.mood, cover: s.cover, bpm: s.bpm, lengthSec: Math.round(s.lengthSec) };
}
// 폰에 지금 가운데 CD 와, 그 사람 설정으로 본 난이도별 별·노트 수를 알려 줍니다
function sendPicker() {
  if (!picker) return;
  const s = picker.song;
  if (!s) return;
  const info = {};
  for (const P of phones()) {
    const c = cfgOf(P);
    info[P.slot] = {};
    for (const d of ['easy', 'normal', 'hard']) info[P.slot][d] = chartInfo(s, d, { lanes: c.lanes, input: c.input });
  }
  send('picker', { song: songMeta(s), index: picker.index, total: picker.songs.length, chosen: game.chosen ? game.chosen.id : null, chosenBy: game.chosenBy, info });
}
let pickerTimer = null;
function sendPickerSoon() { clearTimeout(pickerTimer); pickerTimer = setTimeout(sendPicker, 90); }

let driverTimer = null;
function showDriver(slot) {
  const P = roster.get(slot);
  if (!P) return;
  picker.setDriver({ label: P.name, color: P.color, text: '고르는 중' });
  clearTimeout(driverTimer);
  driverTimer = setTimeout(() => picker.setDriver(null), DRIVER_MS);
}
function onNav(d) {
  if (!d) return;
  if (game.phase === 'over') { if (d.next) goSelect(); return; }
  if (game.phase !== 'select') return;
  if (Number.isFinite(Number(d.fling)) && Math.abs(Number(d.fling)) > 0.5) picker.fling(clamp(Number(d.fling), -24, 24));
  else if (d.dir) picker.nudge(Math.sign(Number(d.dir)) || 1);
  if (d.slot) showDriver(Number(d.slot));
}
function onPhonePick(d) {
  if (game.phase !== 'select' || !d) return;
  pickBy = Number(d.slot) || 'display';
  if (d.slot) showDriver(Number(d.slot));
  picker.select();
  pickBy = 'display';
}
function onPick(song, by) {
  if (game.phase !== 'select') return;
  game.chosen = song;
  game.chosenBy = typeof by === 'number' ? by : null;
  // 폰이 하나도 없으면(봇·키보드 시험) 고르는 순간 시작합니다.
  if (by === 'display' && !phones().length) { startGame(); return; }
  renderPicked();
  send('cue', { type: 'picked', by: game.chosenBy, title: song.title });
  pushState();
  sendPicker();
}
function renderPicked() {
  const el = $('picked');
  if (!game.chosen) { el.classList.add('hidden'); return; }
  const P = game.chosenBy ? roster.get(game.chosenBy) : null;
  el.style.setProperty('--pc', P ? P.color : '#7fd4ff');
  el.innerHTML = `${P ? `<b>${P.name}</b>` : ''}이 곡으로 정했어요 ✓ <span>모두 준비하면 시작</span>`;
  el.classList.remove('hidden');
}

let toastTimer = null;
function toast(html, color) {
  const t = $('toast');
  t.style.setProperty('--pc', color || '#fff');
  t.innerHTML = html;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2800);
}

// ---------- 아래 사람 카드 ----------
function starsHtml(k) {
  k = clamp(k | 0, 1, 10);
  return `<span class="stars">★${k}</span>`;
}
function renderRoster() {
  const box = $('roster');
  const song = picker ? picker.song : null;
  let html = '';
  for (let s = 1; s <= 4; s++) {
    const P = roster.get(s);
    const c = SLOT_INFO[s].color;
    if (!P || !P.present) {
      html += `<div class="pc empty" style="--c:${c}"><div class="pc-badge">${s}P</div><div class="pc-sub">빈 자리 · QR을 찍으면 들어와요</div></div>`;
      continue;
    }
    const cfg = cfgOf(P);
    const ci = song ? chartInfo(song, cfg.diff, { lanes: cfg.lanes, input: cfg.input }) : null;
    const modeTxt = cfg.input === 'motion' ? '모션' : cfg.lanes === 5 ? '패드 5키' : '패드 4키';
    const who = P.bot ? '봇' : P.keys ? '키보드' : '';
    const ready = readySet.has(s);
    const tut = tutState[s];
    let chip = '';
    if (!P.connected) chip = '<span class="pc-chip off">연결 끊김</span>';
    else if (tut) chip = `<span class="pc-chip tut">연습 중 ${tut.step}/${tut.total}</span>`;
    else if (ready) chip = '<span class="pc-chip ok">준비 ✓</span>';
    else if (P.bot || P.keys) chip = `<span class="pc-chip">${who}</span>`;
    else chip = '<span class="pc-chip">준비 전</span>';
    const lanes = cfg.lanes;
    const arrows = LANE_GLYPH[lanes].map((g, i) => `<i data-l="${i}">${g}</i>`).join('');
    const sub = cfg.input === 'motion'
      ? (P.bot ? '폰을 휙휙 움직여요' : P.motionFallback ? '센서 없음 · 화면 버튼으로' : P.motionOk ? '모션 센서 확인 ✓' : '폰을 세워 들고 휙')
      : (lanes === 5 ? '펌프 ↙ ↖ ● ↗ ↘' : 'DDR ← ↓ ↑ →');
    html += `<div class="pc${ready ? ' ready' : ''}${P.connected ? '' : ' away'}" data-slot="${s}" style="--c:${P.color}">` +
      `<div class="pc-badge">${P.name}</div>` +
      `<div class="pc-mode">${MODE_SVG[cfg.input]}${modeTxt}</div>` +
      `<div class="pc-diff">${DIFF_LABEL[cfg.diff] || '보통'} ${ci ? starsHtml(ci.stars) + ` · 노트 ${ci.count}` : ''}</div>` +
      `<div class="pc-sub">${esc(sub)}</div>` +
      `<div class="pc-state">${chip}<div class="pc-arrows">${arrows}</div></div></div>`;
  }
  box.innerHTML = html;
}
// 대기실에서 폰을 눌러 보면(또는 휙 움직이면) 카드의 화살표가 켜집니다. 시작 전에 잘 되는지 확인용.
function flashCard(slot, lane) {
  const el = document.querySelector(`.pc[data-slot="${slot}"] .pc-arrows i[data-l="${lane}"]`);
  if (!el) return;
  el.classList.add('on');
  setTimeout(() => el.classList.remove('on'), 160);
}

function renderFoot() {
  const keyTxt = '<span><kbd>←</kbd><kbd>→</kbd> 곡 넘기기</span><span><kbd>↑</kbd><kbd>↓</kbd> 또는 <kbd>D</kbd> 난이도(모두)</span><span><kbd>Enter</kbd> 이 곡으로</span>';
  const off = `<span><kbd>[</kbd><kbd>]</kbd> 싱크 ${userOffset >= 0 ? '+' : ''}${Math.round(userOffset * 1000)}ms</span>`;
  $('foot').innerHTML = keyTxt + off + '<span>폰 없이 시험: 주소에 <b>?keys</b>(키보드 D F J K) 또는 <b>?bots=3</b></span>';
}
renderFoot();

// ================================================================
// 폰에 알리기
// ================================================================
function pushState() {
  document.body.dataset.phase = game.phase;
  const players = {};
  for (const P of presentList()) {
    const c = cfgOf(P);
    const inGame = game.players.find((p) => p.slot === P.slot);
    const tut = tutState[P.slot];
    players[P.slot] = { name: P.name, color: P.color, connected: P.connected, bot: P.bot, input: c.input, lanes: c.lanes, diff: c.diff,
      playing: Boolean(inGame && game.phase === 'playing' && !inGame.bot && !inGame.keys), tut: tut ? `${tut.step}/${tut.total}` : null };
  }
  send('game_state', {
    phase: game.phase,
    waiting: game.phase !== 'playing',
    settings: settings.forState(),
    song: songMeta(game.phase === 'select' ? picker && picker.song : game.song),
    chosen: game.chosen ? game.chosen.id : null,
    players,
    started: game.t0 != null
  });
}

let stateTimer = null;
function pushStateSoon() { clearTimeout(stateTimer); stateTimer = setTimeout(() => { if (game.phase !== 'playing') pushState(); }, 120); }

// ================================================================
// 경기
// ================================================================
function buildBeats(song) {
  const out = [];
  const bar = song.barLen || 4;
  for (let b = 0; b <= song.beats; b++) out.push({ t: beatToSec(song, b), bar: b % bar === 0 });
  return out;
}

function makeGamePlayer(P, song, fromTime = 0) {
  const c = cfgOf(P);
  const chart = genChart(song, { difficulty: c.diff, lanes: c.lanes, input: c.input });
  // Notes before joining never count as misses and do not affect the score.
  const notes = notesForLateJoin(chart.notes, fromTime);
  const judge = createJudge({ notes, difficulty: c.diff, input: c.input, lanes: c.lanes });
  return {
    slot: P.slot, name: P.name, color: P.color, bot: P.bot, keys: P.keys, connected: P.connected,
    input: c.input, lanes: c.lanes, diff: c.diff, stars: chart.stars, chart, judge, fx: newFx(c.lanes), held: new Set(),
    botNext: 0, botSd: P.bot ? BOT_CFG[P.slot].sd : 0
  };
}

function startGame() {
  if (game.phase !== 'select') return;
  let list = presentList();
  // 아무도 없으면 키보드 1P 로 혼자 합니다.
  if (!list.length) {
    const P = ensureP(1);
    P.present = true; P.keys = true; P.connected = true;
    list = [P];
  }
  const song = game.chosen || picker.song;
  stopPreview();
  picker.setEnabled(false);
  game.song = song;
  game.lastSongId = song.id;
  game.players = list.map((P) => makeGamePlayer(P, song));
  game.beats = buildBeats(song);
  game.t0 = null;
  game.ended = false;
  game.results = [];
  game.phase = 'playing';
  clearTimeout(game.overTimer);
  settings.lock(true);
  board.hide(true);
  stage.setHue(song.cover ? song.cover.hue : 200);
  stage.setPlayers(game.players.map((p) => p.color));
  stage.setMood('play');
  highways.layout(game.players);
  showScreen('play');
  $('sbCover').src = drawCover(song, 92);
  $('sbTitle').textContent = song.title;
  $('sbSub').textContent = `${song.en} · ${song.composer}`;
  pushState();
  whenAudio(() => {
    if (game.phase !== 'playing' || game.song !== song) return;
    $('hold').classList.add('hidden');
    syncClock();
    const at = synth.ctx.currentTime + LEAD_S;
    transport.load(song, { gain: 0.95 });
    transport.start({ at });
    // 곡 0초 = 이 오디오 시각의 소리가 스피커에서 나오는 순간(audioAt 이 스피커 기준이라 그대로 비교합니다)
    game.t0 = at;
    game.startPerf = performance.now();
    countdown();
    banner(song.title, `${song.en} · ${song.composer}`, 2600);
    send('cue', { type: 'start', in: LEAD_S, song: songMeta(song) });
    pushState();
  });
  if (!audioRunning()) {
    $('hold').classList.remove('hidden');
    send('cue', { type: 'audio' });
  }
}

function countdown() {
  for (const t of game.countTimers) clearTimeout(t);
  game.countTimers = [];
  const el = $('count');
  const steps = [['3', LEAD_S - 3], ['2', LEAD_S - 2], ['1', LEAD_S - 1], ['GO!', LEAD_S - 0.05]];
  for (const [txt, at] of steps) {
    game.countTimers.push(setTimeout(() => {
      el.textContent = txt;
      el.className = 'count on pop' + (txt === 'GO!' ? ' go' : '');
    }, Math.max(0, at * 1000)));
  }
  game.countTimers.push(setTimeout(() => { el.className = 'count'; }, (LEAD_S + 0.6) * 1000));
}

let bannerTimer = null;
function banner(title, sub, ms = 2400) {
  const b = $('banner');
  b.querySelector('b').textContent = title;
  b.querySelector('span').textContent = sub || '';
  b.classList.add('on');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove('on'), ms);
}

// 곡 시간(초): 스피커에서 지금 나오는 소리 기준
function songTimeAt(perfMs) { return game.t0 == null ? -LEAD_S : audioAt(perfMs) - game.t0; }

function applyStep(p, lane, songT) {
  highways.press(p, lane);
  const ev = p.judge.step(lane, songT - userOffset);
  if (ev) onJudged(p, ev);
}
function onJudged(p, ev) {
  highways.judged(p, ev, performance.now() / 1000);
  if (ev.kind === 'judge' && ev.j !== 'miss') p.fx.comboPop = 1;
  if (!p.bot && !p.keys) {
    const st = p.judge.st;
    send('judge', { j: ev.j, lane: ev.lane, c: st.combo, s: p.judge.score, l: Math.round(st.life * 100), early: ev.early ? 1 : 0, wrong: ev.wrongLane ? 1 : 0 }, p.slot);
  }
  if (ev.j === 'perfect' && p.judge.st.combo > 0 && p.judge.st.combo % 25 === 0) stage.flash(p.color, 0.6);
}

function onRemoteStep(d) {
  if (!d) return;
  const slot = Number(d.slot);
  const lane = Number(d.lane) | 0;
  if (game.phase !== 'playing') {
    // 대기실에서는 시험 삼아 누른 화살표를 카드에 보여 줍니다
    flashCard(slot, lane);
    return;
  }
  const p = game.players.find((x) => x.slot === slot);
  if (!p || p.bot || p.keys || game.t0 == null || lane < 0 || lane >= p.lanes) return;
  const lag = clamp(num(d.ago, 0), 0, 200) + clamp(num(d.rtt, 80), 0, 800) / 2 + displayRtt() / 2;
  const t = songTimeAt(performance.now() - lag);
  if (p.input === 'pad') p.held.add(lane);
  applyStep(p, lane, t);
}
function onRemoteRelease(d) {
  if (!d || game.phase !== 'playing') return;
  const p = game.players.find((x) => x.slot === Number(d.slot));
  if (!p || p.bot || p.keys || game.t0 == null) return;
  const lane = Number(d.lane) | 0;
  p.held.delete(lane);
  const lag = clamp(num(d.ago, 0), 0, 200) + clamp(num(d.rtt, 80), 0, 800) / 2 + displayRtt() / 2;
  for (const ev of p.judge.release(lane, songTimeAt(performance.now() - lag) - userOffset)) onJudged(p, ev);
}

// ---------- 봇: 노트 시각에 약간의 흔들림을 섞어 누릅니다 ----------
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function runBots(songT) {
  for (const p of game.players) {
    if (!p.bot && !p.auto) continue;
    const notes = p.judge.notes;
    while (p.botNext < notes.length && notes[p.botNext].t <= songT + 0.25) {
      const n = notes[p.botNext++];
      if (Math.random() < (p.auto ? 0 : 0.025)) continue; // 가끔 놓침
      n._botAt = n.t + (p.auto ? 0.004 : gauss() * p.botSd);
    }
    for (let i = Math.max(0, p.botNext - 24); i < p.botNext; i++) {
      const n = notes[i];
      if (n._botAt != null && !n.done && songT >= n._botAt) {
        const at = n._botAt;
        n._botAt = null;
        if (p.input === 'pad' && n.hold) p.held.add(n.lane);
        applyStep(p, n.lane, at + userOffset);
      }
      if (n.hold && n.hold.state === 'held' && songT >= n.hold.end) p.held.delete(n.lane);
    }
  }
}

function finishGame() {
  if (game.phase !== 'playing') return;
  game.phase = 'over';
  game.ended = true;
  for (const t of game.countTimers) clearTimeout(t);
  $('count').className = 'count';
  // 소리를 부드럽게 줄이고 멈춥니다
  synth.setVolume(0, 0.25);
  setTimeout(() => { transport.stop(); synth.setVolume(0.9, 0.02); }, 900);
  const rows = game.players.map((p) => ({ p, s: p.judge.summary() }));
  rankFinishers(rows);
  game.results = rows;
  settings.lock(false);
  board.hide(false);
  stage.setMood('select');
  const best = rows[0];
  if (best) stage.flash(best.p.color, 1);
  renderResults();
  showScreen('over');
  for (const r of rows) {
    if (r.p.bot || r.p.keys) continue;
    send('result', { rank: r.rank, of: rows.length, late: Boolean(r.p.late), grade: r.s.grade, score: r.s.score, acc: Math.round(r.s.acc * 1000) / 10, maxCombo: r.s.maxCombo,
      counts: r.s.counts, fc: r.s.fullCombo, pfc: r.s.perfectAll, failed: r.s.failed, song: game.song.title, overMs: OVER_MS }, r.p.slot);
  }
  pushState();
  clearTimeout(game.overTimer);
  game.overTimer = setTimeout(() => { if (game.phase === 'over') goSelect(); }, OVER_MS);
}

function renderResults() {
  const song = game.song;
  $('ovTitle').textContent = song ? `${song.title}` : '결과';
  $('ovEyebrow').textContent = 'RESULT';
  const GC = { S: '#ffd23a', A: '#5ef0a0', B: '#7fd4ff', C: '#c9a6ff' };
  $('ranks').innerHTML = game.results.map((r, i) => {
    const s = r.s, p = r.p;
    const tags = [];
    if (p.late) tags.push('<span class="mode">중간 참가 · 남은 노트 기준</span>');
    if (s.perfectAll) tags.push('<span class="pfc">ALL PERFECT</span>');
    else if (s.fullCombo) tags.push('<span class="fc">FULL COMBO</span>');
    if (s.failed) tags.push('<span class="fail">클리어 실패</span>');
    tags.push(`<span class="mode">${p.input === 'motion' ? '모션' : p.lanes === 5 ? '패드 5키' : '패드'} · ${DIFF_LABEL[p.diff]}</span>`);
    return `<div class="rk${r.rank === 1 && game.results.length > 1 ? ' first' : ''}" style="--c:${p.color};--gc:${GC[s.grade]};animation-delay:${i * 0.12}s">` +
      `<div class="rk-top"><div class="rk-rank">${p.late ? '–' : `${r.rank}<small>위</small>`}</div><div class="rk-badge">${p.name}</div></div>` +
      `<div class="rk-grade">${s.grade}</div>` +
      `<div class="rk-tags">${tags.join('')}</div>` +
      `<div class="rk-score">${s.score.toLocaleString('en-US')}</div>` +
      `<div class="rk-acc">정확도 <b>${(s.acc * 100).toFixed(1)}%</b> · 최대 콤보 <b>${s.maxCombo}</b></div>` +
      `<div class="rk-counts"><div class="p"><span>PERFECT</span><b>${s.counts.perfect}</b></div><div class="g"><span>GREAT</span><b>${s.counts.great}</b></div>` +
      `<div class="o"><span>GOOD</span><b>${s.counts.good}</b></div><div class="m"><span>MISS</span><b>${s.counts.miss}</b></div></div></div>`;
  }).join('');
  $('ovHint').innerHTML = `잠시 뒤 노래 고르기로 돌아가요 · 폰에서 <b>다음 곡 고르기</b> 또는 <kbd>Space</kbd>`;
}

function goSelect(msg) {
  for (const t of game.countTimers) clearTimeout(t);
  clearTimeout(game.overTimer);
  if (game.phase === 'playing') { transport.stop(); }
  game.phase = 'select';
  game.players = [];
  game.t0 = null;
  game.chosen = null;
  game.chosenBy = null;
  $('count').className = 'count';
  $('hold').classList.add('hidden');
  settings.lock(false);
  board.hide(false);
  stage.setMood('select');
  stage.setPlayers([]);
  showScreen('select');
  picker.setEnabled(true);
  if (game.lastSongId) picker.goToId(game.lastSongId);
  renderPicked();
  renderRoster();
  pushState();
  sendPicker();
  if (msg) toast(esc(msg));
}

function showScreen(which) {
  $('select').classList.toggle('hidden', which !== 'select');
  $('over').classList.toggle('hidden', which !== 'over');
  const play = which === 'play' || which === 'over';
  $('lanes').classList.toggle('hidden', which !== 'play');
  $('songbar').classList.toggle('hidden', which !== 'play');
  $('join').classList.toggle('hidden', !play);
  if (which !== 'play') highways.clear();
}

// ================================================================
// 키보드
// ================================================================
function keysPlayer() { return game.players.find((p) => p.keys) || null; }
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (game.phase === 'playing') {
    if (e.code === 'Escape') { goSelect('그만두고 노래 고르기로 돌아왔어요'); return; }
    const p = keysPlayer();
    if (!p) return;
    const map = p.lanes === 5 ? KEYMAP5 : KEYMAP4;
    if (e.code in map) {
      e.preventDefault();
      const lane = map[e.code];
      p.held.add(lane);
      applyStep(p, lane, songTimeAt(performance.now() - Math.max(0, performance.now() - e.timeStamp)));
    }
    return;
  }
  if (game.phase === 'over') {
    if (e.code === 'Space' || e.code === 'Escape' || e.code === 'Enter') { e.preventDefault(); goSelect(); }
    return;
  }
  if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
    userOffset = clamp(userOffset + (e.code === 'BracketRight' ? 0.01 : -0.01), -0.3, 0.3);
    userOffset = Math.round(userOffset * 1000) / 1000;
    try { localStorage.setItem('pcg-rhythm-offset', String(userOffset)); } catch (err) {}
    renderFoot();
    toast(`싱크 ${userOffset >= 0 ? '+' : ''}${Math.round(userOffset * 1000)}ms · 판정이 늦게 느껴지면 ]`);
  }
});
window.addEventListener('keyup', (e) => {
  if (game.phase !== 'playing') return;
  const p = keysPlayer();
  if (!p) return;
  const map = p.lanes === 5 ? KEYMAP5 : KEYMAP4;
  if (e.code in map) {
    const lane = map[e.code];
    p.held.delete(lane);
    for (const ev of p.judge.release(lane, songTimeAt(performance.now()) - userOffset)) onJudged(p, ev);
  }
});

// ================================================================
// 매 프레임
// ================================================================
let lastFrame = performance.now();
let lastStateSent = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = clamp((now - lastFrame) / 1000, 0, 0.05);
  lastFrame = now;
  syncClock();
  analyser.getByteFrequencyData(bands);
  let energy = 0;
  for (let i = 0; i < 24; i++) energy += bands[i];
  energy = energy / (24 * 255);

  let beatPos;
  let barLen = 4;
  if (game.phase === 'playing' && game.song) {
    const song = game.song;
    barLen = song.barLen || 4;
    const songT = songTimeAt(now);
    beatPos = game.t0 == null ? -LEAD_S * song.bpm / 60 : songT >= 0 ? secToBeat(song, songT) : songT * song.bpm / 60;
    if (game.t0 != null) {
      runBots(songT);
      for (const p of game.players) {
        for (const ev of p.judge.update(songT - userOffset)) onJudged(p, ev);
      }
      const len = song.lengthSec;
      $('sbProg').style.width = `${clamp(songT / len, 0, 1) * 100}%`;
      const rem = Math.max(0, Math.round(len - Math.max(0, songT)));
      $('sbTime').textContent = `${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`;
      const allDone = game.players.every((p) => p.judge.done);
      if ((allDone && songT > len - 0.5) || songT > len + 2.5) finishGame();
    }
    highways.step(game.players, dt);
    const pulse = beatPos >= 0 ? Math.exp(-(beatPos - Math.floor(beatPos)) * 6) : 0;
    highways.draw(game.players, songT, now / 1000, { beats: game.beats, beatPulse: pulse });
  } else {
    const s = picker.song;
    const bpm = s ? s.bpm : 100;
    game.idleBeat += dt * bpm / 60;
    beatPos = game.idleBeat;
    barLen = s && s.barLen ? s.barLen : 4;
  }
  stage.update(dt, { beatPos, energy, bands, barLen });
  stage.render();
  // 폰이 늦게 들어와도 상태를 받도록 가끔 다시 보냅니다(경기 중에는 보내지 않음)
  if (game.phase !== 'playing' && now - lastStateSent > 5000) { lastStateSent = now; pushState(); }
}
requestAnimationFrame(frame);

syncRoster();
renderRoster();
if (AUTOSTART && BOTS) setTimeout(() => { if (game.phase === 'select' && !phones().length) startGame(); }, 1200);

// ================================================================
// 시험용
// ================================================================
window.__rhythm = {
  get phase() { return game.phase; },
  get game() { return game; },
  get players() { return game.players; },
  get roster() { return [...roster.values()]; },
  get song() { return game.song || picker.song; },
  picker, settings, stage, synth, transport,
  songTime: () => songTimeAt(performance.now()),
  start: (id) => { if (id) picker.goToId(id, { instant: true }); if (game.phase !== 'select') goSelect(); startGame(); },
  finish: finishGame,
  goSelect,
  /** 사람 자리를 봇처럼 자동으로 치게(화면 시험) */
  autoplay(slot) { const p = game.players.find((x) => x.slot === slot); if (p) p.auto = true; return Boolean(p); },
  /** 키보드 1P 처럼 레인 누르기 */
  step(slot, lane) { const p = game.players.find((x) => x.slot === slot); if (p && game.t0 != null) applyStep(p, lane, songTimeAt(performance.now())); },
  /** 곡 중간으로 건너뛰기(스크린샷용). 지나간 노트는 봇·자동만 친 것으로 셉니다 */
  seek(sec) {
    if (game.phase !== 'playing' || game.t0 == null) return false;
    const song = game.song;
    const fromBeat = secToBeat(song, sec);
    const at = synth.ctx.currentTime + 0.1;
    transport.start({ fromBeat, at });
    game.t0 = at - sec;
    for (const p of game.players) {
      for (const n of p.judge.notes) if (n.t < sec - 0.3 && !n.done && (p.bot || p.auto)) { p.judge.step(n.lane, n.t + 0.005); }
      p.botNext = p.judge.notes.findIndex((n) => n.t >= sec - 0.3);
      if (p.botNext < 0) p.botNext = p.judge.notes.length;
    }
    return true;
  },
  offset: () => userOffset,
  displayRtt
};
