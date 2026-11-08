// 오케스트라 폰: 악기를 하나 골라 내 폰 스피커로 연주합니다.
// 흐름(큰 화면이 정함): 대기실(악기 고르기·준비) → 연습(처음 고른 악기면 튜토리얼) → 곡 고르기(밀어서 넘기기) → 연주 → 결과(녹화 받기).
// 연주·연습 화면에서만 악기가 움직이고, 판정은 큰 화면이 합니다. 박자는 큰 화면이 보내는 tempo 로 맞춥니다.
import { haptics } from '/common/haptics.js';
import { createPhoneSettings } from '/common/phone-settings.js';
import { createTutorial } from '/common/tutorial.js';
import { createSynth } from '/common/music/synth.js';
import { getSong } from '/common/music/songs.js';
import { drawCover } from '/common/disc-picker.js';
import { INSTRUMENTS, INST_ORDER, ICONS, buildPart, GRADE_WORD, JUDGE_LABEL, DIFF_LABEL, isSustain } from '/orchestra/parts.js';
import { createScore } from '/orchestra/score.js';
import { createInstrument } from './instruments.js';
import { sensors } from './sensors.js';
import { openMic, MIC_SIM } from './audio-in.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ROOM = (params.get('room') || '').toUpperCase();
const DEBUG = params.has('debug');
const SENSOR_WAIT_MS = 1500;
const PLAY_URL = (g) => (g === 'baseball' ? '/play/' : `/play/${g}/`);
$('room').textContent = ROOM ? `방 ${ROOM}` : '';
if (!window.isSecureContext) $('httpNote').classList.remove('hidden');
$('heroIcons').innerHTML = INST_ORDER.map((k, i) => {
  const a = (i / INST_ORDER.length) * Math.PI * 2 - Math.PI / 2;
  return `<i style="left:${80 + Math.cos(a) * 80}px;top:${80 + Math.sin(a) * 80}px;animation-delay:${(i * 0.2).toFixed(1)}s">${ICONS[k]}</i>`;
}).join('');

let token = null;
try { token = localStorage.getItem('pcg-token'); } catch (e) {}
if (!token) {
  token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try { localStorage.setItem('pcg-token', token); } catch (e) {}
}
const socket = io({ autoConnect: false, transports: ['websocket', 'polling'], tryAllTransports: true });
function send(event, data, volatile) {
  if (!socket.connected) return false;
  (volatile ? socket.volatile : socket).emit('c2d', { event, data });
  return true;
}

// ───────── 상태 ─────────
let me = null;
let state = { phase: 'lobby' };
let roster = [];
let started = false;
let mode = 'start'; // start | connecting | msg | app
let myInst = null;
try { myInst = localStorage.getItem('pcg-orch-inst'); } catch (e) {}
if (!INSTRUMENTS[myInst]) myInst = null;
let instChosen = false; // 이번 방문에서 골랐는지(처음엔 고르는 화면을 한 번 보여 줌)
let picking = false;
let myReady = false;
let noSensor = false;
let displayOn = true;
let noRoomTries = 0;
let picker = null; // 큰 화면 CD 고르기 상태
let result = null;
let clip = null;
let lastPhase = null;
let tutRanFor = null; // 이번 연습 단계에서 튜토리얼을 띄운 악기

// ───────── 소리 ─────────
let synth = null;
const voices = new Map();
let baseVol = 0.9;
let dyn = 1;
function ensureSynth() {
  if (!synth) {
    if (navigator.audioSession) { try { navigator.audioSession.type = 'playback'; } catch (e) {} }
    synth = createSynth({ volume: baseVol, reverb: 0.7 });
  }
  return synth;
}
function voice(name) {
  ensureSynth();
  if (!voices.has(name)) voices.set(name, synth.instrument(name, { gain: name === 'drums' ? 1.25 : name === 'castanets' ? 1.2 : 1 }));
  return voices.get(name);
}
// 마이크: 관악기는 숨소리를 그대로(잡음 억제 끔), 성악은 목소리용(잡음 억제·자동 크기). 고를 때 탭 안에서 미리 엽니다.
let micP = null, micKind = null;
function ensureMic(isVoice) {
  const kind = isVoice ? 'voice' : 'wind';
  if (micP && micKind === kind) return micP;
  if (micP) micP.then((m) => m && m.close()).catch(() => {});
  micKind = kind;
  ensureSynth();
  micP = openMic(synth.ctx, { voice: isVoice }).catch((e) => { debug('마이크 실패 ' + (e && e.name)); return null; });
  return micP;
}

// ───────── 박자(큰 화면 tempo 로 맞춤) ─────────
const clk = { song: false, live: false, b: 0, t: 0, bpm: 100, st: null, pct: null };
function clock() {
  if (!clk.song) return { song: false, beat: 0, bpm: 100, live: false };
  return { song: true, beat: clk.b + ((performance.now() - clk.t) / 1000) * (clk.bpm / 60), bpm: clk.bpm, live: clk.live };
}
function syncTempo(d) {
  if (!d || typeof d.b !== 'number') return;
  const t = performance.now();
  const lat = (Number(d.lat) || 30) + rtt() / 2;
  const est = d.b + (lat / 1000) * (d.bpm / 60);
  const pred = clk.song ? clk.b + ((t - clk.t) / 1000) * (clk.bpm / 60) : est;
  const err = est - pred;
  clk.b = Math.abs(err) > 0.5 || !clk.song ? est : pred + err * 0.3;
  clk.t = t;
  clk.bpm = d.bpm;
  clk.song = true;
  clk.live = d.st === 'live';
  clk.st = d.st;
  clk.pct = d.pct ?? null;
  if (d.dyn) {
    dyn = d.dyn;
    if (synth) synth.setVolume(baseVol * (0.75 + 0.25 * Math.min(1.2, dyn)), 0.2);
  }
  if (inst && inst.setTempo) inst.setTempo(d.pct ?? null);
}

// ───────── 왕복 시간 ─────────
const rtts = [];
function measureRtt() {
  if (!socket.connected) return;
  const t0 = performance.now();
  socket.timeout(2000).emit('ping_rtt', t0, (err) => {
    if (err) return;
    rtts.push(performance.now() - t0);
    if (rtts.length > 7) rtts.shift();
  });
}
function rtt() {
  if (!rtts.length) return 80;
  const s = [...rtts].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
setInterval(measureRtt, 1500);

// ───────── 설정(각자 난이도) ─────────
const ps = createPhoneSettings({ socket });
ps.attach(socket);
ps.mount($('setBox'));
ps.mount($('setBox2'), { compact: true });
ps.onChange(() => { partKey = ''; render(); });
haptics.listen(socket, { slot: () => me && me.slot });

function myInfo() {
  if (!me || !state.players) return null;
  return state.players[me.slot] || state.players[String(me.slot)] || null;
}
function myDiff() {
  const info = myInfo();
  if (state.phase === 'playing' && info && info.diff) return info.diff;
  return ps.get('difficulty') || 'normal';
}

// ───────── 악보 ─────────
let part = null, partKey = '';
function currentPart() {
  const song = state.song ? getSong(state.song.id) : null;
  if (!song || !myInst || (state.phase !== 'playing')) { part = null; partKey = ''; return null; }
  const key = `${song.id}|${myInst}|${myDiff()}`;
  if (key !== partKey) {
    partKey = key;
    part = buildPart(song, myInst, myDiff());
    score.setPart(part, song, myInst, me ? me.color : '#ff5a5f', myDiff());
  }
  return part;
}
const score = createScore($('scoreCv'), { compact: true, ahead: 3 });

// ───────── 악기 ─────────
let inst = null, instKey = null, tut = null;
const env = {
  get inst() { return instKey; },
  color: () => (me ? me.color : '#ff5a5f'),
  get synth() { return ensureSynth(); },
  voice,
  song: () => (state.song && state.phase === 'playing' ? getSong(state.song.id) : null),
  part: () => currentPart(),
  diff: () => myDiff(),
  clock,
  send,
  signal: (name, data) => (tut && tut.isRunning() ? tut.signal(name, data) : false),
  noSensor: () => noSensor,
  rtt,
  dyn: () => Math.min(1.25, dyn),
  openMic: (isVoice) => ensureMic(isVoice),
  debug,
  action: (k) => { lastAction = performance.now(); if (k === 'hit' || k === 'key') pulseStage(); },
};
let lastAction = 0;
function pulseStage() {
  const s = $('vStage');
  s.classList.remove('pulse');
  void s.offsetWidth;
  s.classList.add('pulse');
}
function ensureInstrument() {
  if (!myInst) return null;
  if (inst && instKey === myInst) return inst;
  if (inst) { try { inst.destroy(); } catch (e) {} inst.el.remove(); }
  if (tut && tut.isRunning()) tut.cancel();
  instKey = myInst;
  ensureSynth();
  inst = createInstrument(myInst, env);
  $('instArea').textContent = '';
  $('instArea').appendChild(inst.el);
  const label = INSTRUMENTS[myInst].label;
  tut = createTutorial({
    key: `orchestra-${myInst}`,
    socket,
    title: `처음이라 연습해 봐요 · ${label}`,
    steps: inst.tutorial(),
    onStep: (i) => { if (inst && inst.onTutStep) inst.onTutStep(i); },
    onDone: () => { sendInstrument(); render(); },
    finish: { title: '연습 끝!', body: `이제 ${label}로 연주할 수 있어요.\n다른 악기로 바꾸고 싶으면 ‘악기 바꾸기’를 눌러요.`, button: '좋아요' },
  });
  $('tutLink').textContent = '';
  tut.link($('tutLink'), { before: () => state.phase !== 'playing' });
  return inst;
}
function sendInstrument() {
  if (!myInst || !me) return;
  send('instrument', { inst: myInst, fresh: tutFirst(myInst) });
}
function tutFirst(k) {
  if (params.get('tut') === '1') return true;
  if (params.get('tut') === '0') return false;
  try { return !localStorage.getItem(`pcg-tut-orchestra-${k}`); } catch (e) { return false; }
}

// ───────── 화면 ─────────
function show(id) {
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === id);
  const docked = ['vLobby', 'vSelect', 'vOver'].includes(id) || (id === 'vStage' && state.phase === 'practice');
  $('dock').classList.toggle('hidden', !docked);
}
function message(t, b, btn) {
  mode = 'msg';
  $('msgT').textContent = t;
  $('msgB').textContent = b || '';
  $('btnMsg').classList.toggle('hidden', !btn);
  if (btn) { $('btnMsg').textContent = btn.label; $('btnMsg').onclick = btn.onClick; }
  show('vMsg');
}
function banner(text) { $('banner').textContent = text || ''; $('banner').classList.toggle('hidden', !text); }

function takenBy() {
  const out = {};
  for (const [s, p] of Object.entries(state.players || {})) if (p && p.inst) (out[p.inst] = out[p.inst] || []).push({ slot: Number(s), color: p.color || '#fff', name: p.name || `${s}P` });
  return out;
}
function renderPick() {
  const taken = takenBy();
  $('instGrid').innerHTML = INST_ORDER.map((k) => {
    const I = INSTRUMENTS[k];
    const who = (taken[k] || []).filter((x) => !me || x.slot !== me.slot).map((x) => `<s style="background:${x.color}">${x.name}</s>`).join('');
    return `<button type="button" class="card${k === myInst && instChosen ? ' mine' : ''}" data-k="${k}"><i>${ICONS[k]}</i><em>${I.role}</em><span class="who">${who}</span><b>${I.label}</b><span>${I.how}</span></button>`;
  }).join('');
  $('btnPickBack').classList.toggle('hidden', !(instChosen && myInst));
}
$('instGrid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-k]');
  if (!b) return;
  const k = b.dataset.k;
  haptics.tick();
  ensureSynth().resume();
  // 마이크가 필요한 악기는 이 탭 안에서 바로 권한을 묻습니다(iPhone).
  if (INSTRUMENTS[k].mic) ensureMic(k === 'voice');
  myInst = k;
  instChosen = true;
  picking = false;
  try { localStorage.setItem('pcg-orch-inst', k); } catch (e) {}
  ensureInstrument();
  sendInstrument();
  // 소리 맛보기
  previewSound(k);
  render();
});
$('btnPickBack').addEventListener('click', () => { picking = false; render(); });
function previewSound(k) {
  const I = INSTRUMENTS[k];
  try {
    if (k === 'drum') { voice('drums').play(38, { vel: 0.8 }); voice('drums').play(36, { vel: 0.7, when: synth.now() + 0.18 }); }
    else if (k === 'castanets') { for (let i = 0; i < 3; i++) voice('castanets').play(85, { when: synth.now() + i * 0.12, vel: 0.8 }); }
    else if (k === 'conductor') voice('drums').play(76, { vel: 0.6 });
    else { const v = voice(I.synth); [67, 71, 74].forEach((m, i) => v.play(m - (k === 'horn' ? 12 : 0), { when: synth.now() + i * 0.16, dur: 0.3, vel: 0.6 })); }
  } catch (e) {}
}
$('instChip').addEventListener('click', () => { if (state.phase !== 'playing') { picking = true; render(); } });
$('btnChange').addEventListener('click', () => { if (state.phase !== 'playing') { picking = true; render(); } });
$('btnTutorial').addEventListener('click', () => { if (tut && !tut.isRunning() && state.phase !== 'playing') tut.run(); });

function renderRoster() {
  const list = Object.entries(state.players || {}).map(([s, p]) => ({ slot: Number(s), ...p })).sort((a, b) => a.slot - b.slot);
  const rs = window.__readyGate && window.__readyGate.state ? window.__readyGate.state() : null;
  $('roster').innerHTML = list.map((p) => {
    const ok = rs && rs.ready && rs.ready.includes(p.slot);
    return `<div><s style="background:${p.color || '#fff'}">${p.name || p.slot + 'P'}</s><i>${p.inst ? ICONS[p.inst] : ''}</i><span>${p.inst ? INSTRUMENTS[p.inst].label : '고르는 중'}</span><em class="${ok ? 'ok' : ''}">${ok ? '준비 ✓' : p.bot ? '봇' : ''}</em></div>`;
  }).join('');
}

function setReadyButton(label, enabled, status) {
  const b = $('btnReady');
  b.textContent = myReady ? '준비 완료 ✓' : label;
  b.classList.toggle('done', myReady);
  b.classList.toggle('off', !enabled && !myReady);
  b.dataset.enabled = enabled ? '1' : '0';
  $('dockStatus').textContent = myReady ? '다른 사람을 기다리는 중이에요' : status || '';
}
$('btnReady').addEventListener('click', () => {
  if (myReady) { haptics.play('warn', 0.4); return; }
  if ($('btnReady').dataset.enabled !== '1') { haptics.play('warn', 0.5); render(); return; }
  if (tut && tut.isRunning()) return;
  ensureSynth().resume();
  keepAwake();
  if (send('start_game', {})) {
    myReady = true;
    haptics.success();
    render();
  }
});

function render() {
  if (!me || !started) return;
  if (mode !== 'app') return;
  const ph = state.phase;
  if (ph !== lastPhase) {
    lastPhase = ph;
    myReady = false;
    if (ph !== 'practice') tutRanFor = null;
  }
  $('instChip').classList.toggle('hidden', !myInst || !instChosen);
  if (myInst) {
    $('instChipIcon').innerHTML = ICONS[myInst];
    $('instChipName').textContent = INSTRUMENTS[myInst].label;
  }
  if (tut) tut.setLinkVisible(ph !== 'playing');
  const info = myInfo();
  if (ph === 'playing') {
    if (!info || !info.inst) { message('지금 연주 중이에요', '이 곡이 끝나면 함께할 수 있어요. 큰 화면을 보세요.'); mode = 'app'; return; }
    if (myInst !== info.inst) { myInst = info.inst; }
    ensureInstrument();
    showStage(true);
    return;
  }
  if (picking || !myInst || !instChosen) {
    renderPick();
    show('vPick');
    return;
  }
  ensureInstrument();
  if (ph === 'practice') {
    showStage(false);
    // 처음 고른 악기면 튜토리얼부터(연습 단계마다 한 번)
    if (tutRanFor !== myInst && tut && !tut.isRunning()) {
      tutRanFor = myInst;
      if (tut.firstTime()) setTimeout(() => { if (state.phase === 'practice' && tut && !tut.isRunning()) tut.run(); }, 250);
    }
    setReadyButton('연습 끝 · 준비', !(tut && tut.isRunning()), tut && tut.firstTime() ? '튜토리얼을 마치면 준비를 눌러요' : '자유롭게 쳐 보고, 다 됐으면 준비');
    $('btnTutorial').classList.toggle('hidden', false);
    return;
  }
  $('btnTutorial').classList.add('hidden');
  if (ph === 'select') {
    renderSelect();
    show('vSelect');
    return;
  }
  if (ph === 'over') {
    renderOver();
    show('vOver');
    return;
  }
  // 대기실
  const I = INSTRUMENTS[myInst];
  $('lobIcon').innerHTML = ICONS[myInst];
  $('lobName').textContent = I.label;
  $('lobRole').textContent = `맡은 파트 · ${I.role}`;
  $('lobHow').textContent = I.how;
  renderRoster();
  setReadyButton('준비', true, tutFirst(myInst) ? '처음 고른 악기라 시작 전에 잠깐 연습해요' : '모두 준비를 누르면 시작해요');
  show('vLobby');
}

function showStage(play) {
  show('vStage');
  const s = $('vStage');
  s.classList.toggle('playing', play);
  $('freeTag').classList.toggle('hidden', play);
  $('scoreCv').classList.toggle('hidden', !play);
  $('combo').textContent = '';
  if (play) currentPart();
}

function renderSelect() {
  const p = picker || state.picker;
  const song = p && p.id ? getSong(p.id) : null;
  if (song) {
    if ($('selCover').dataset.id !== song.id) {
      $('selCover').src = drawCover(song, 240);
      $('selCover').dataset.id = song.id;
    }
    $('selTitle').textContent = song.title;
    $('selSub').textContent = `${song.en} · ${song.composer}`;
    $('selMeta').textContent = `${song.bpm} BPM · ${Math.floor(song.lengthSec / 60)}:${String(Math.round(song.lengthSec % 60)).padStart(2, '0')} · ${song.mood || ''}`;
  }
  const drv = p && p.driver ? `${p.driver}P가 고르는 중` : '아무나 밀어서 넘겨요';
  $('selDriver').textContent = p && p.selected ? `고른 곡이에요 · 넘기면 다시 골라요` : drv;
  $('btnPick').textContent = p && p.selected ? '고른 곡 ✓' : '이 곡으로 할게요';
  $('btnPick').classList.toggle('picked', Boolean(p && p.selected));
  setReadyButton('준비', Boolean(p && p.selected), p && p.selected ? `고른 곡: ${song ? song.title : ''} · 모두 준비하면 연주를 시작해요` : '먼저 곡을 골라요');
}

function renderOver() {
  const r = result;
  const song = state.song ? getSong(state.song.id) : null;
  $('ovSong').textContent = song ? `${song.title} · ${INSTRUMENTS[myInst] ? INSTRUMENTS[myInst].label : ''}` : '';
  if (r) {
    $('ovGrade').textContent = r.grade || '–';
    $('ovWord').textContent = GRADE_WORD[r.grade] || '';
    $('ovStats').innerHTML = `<span>정확도<b>${Math.round((r.acc || 0) * 100)}%</b></span><span>PERFECT<b>${r.perfect || 0}</b></span><span>GOOD<b>${r.good || 0}</b></span><span>MISS<b>${r.miss || 0}</b></span><span>최대 콤보<b>${r.maxCombo || 0}</b></span>`;
    $('ovEns').textContent = r.ens ? `합주 평가 ${r.ens.grade} · ${GRADE_WORD[r.ens.grade] || ''}` : '';
  } else {
    $('ovGrade').textContent = '–';
    $('ovWord').textContent = '큰 화면에서 결과를 확인해요';
    $('ovStats').innerHTML = '';
    $('ovEns').textContent = '';
  }
  const live = clip && clip.expiresAt > Date.now();
  $('ovDl').classList.toggle('hidden', !live);
  $('ovDlWait').classList.toggle('hidden', live || !(state.rec && state.rec.uploading));
  if (live) {
    $('ovDl').href = clip.url;
    $('ovDl').setAttribute('download', clip.name || 'orchestra.webm');
    const left = Math.max(0, Math.round((clip.expiresAt - Date.now()) / 60000));
    $('ovDlSub').textContent = `${clip.size ? (clip.size / 1048576).toFixed(1) + 'MB · ' : ''}${left}분 뒤 사라져요 · 오래 보관하지 않아요`;
  }
  setReadyButton('다시 하기 · 준비', true, '모두 준비하면 다음 곡을 골라요');
}
setInterval(() => { if (state.phase === 'over' && mode === 'app') renderOver(); }, 20000);

// ───────── 곡 고르기: 밀어서 넘기기 ─────────
{
  const sw = $('swipe');
  let st = null;
  sw.addEventListener('pointerdown', (e) => { e.preventDefault(); try { sw.setPointerCapture(e.pointerId); } catch (err) {} st = { x: e.clientX, t: performance.now(), lx: e.clientX, lt: performance.now(), v: 0, sent: 0 }; });
  sw.addEventListener('pointermove', (e) => {
    if (!st) return;
    const t = performance.now();
    st.v = st.v * 0.5 + ((e.clientX - st.lx) / Math.max(4, t - st.lt)) * 1000 * 0.5;
    st.lx = e.clientX; st.lt = t;
    // 천천히 끌면 끄는 만큼 한 칸씩
    const steps = Math.trunc((e.clientX - st.x) / 70);
    if (steps !== st.sent) { send('nav', { d: steps > st.sent ? -1 : 1 }); st.sent = steps; haptics.tick({ noFlash: true }); }
  });
  const end = () => {
    if (!st) return;
    const v = st.v;
    if (Math.abs(v) > 900 && Math.abs(st.lx - st.x) > 40) send('nav', { v: Math.max(-14, Math.min(14, -v / 260)) });
    else if (st.sent === 0 && Math.abs(st.lx - st.x) > 30) send('nav', { d: st.lx < st.x ? 1 : -1 });
    sw.classList.remove('flick'); void sw.offsetWidth; sw.classList.add('flick');
    st = null;
  };
  sw.addEventListener('pointerup', end);
  sw.addEventListener('pointercancel', end);
}
$('btnPick').addEventListener('click', () => { ensureSynth().resume(); send('pick', {}); haptics.success(); });

// ───────── 판정·연주 표시 ─────────
let combo = 0;
function showJudge(j) {
  const e = $('judge');
  e.className = 'judge';
  void e.offsetWidth;
  e.textContent = JUDGE_LABEL[j] || '';
  e.classList.add('show', j);
}

// ───────── 매 프레임 ─────────
function frame() {
  requestAnimationFrame(frame);
  if (!inst || mode !== 'app') return;
  const now = performance.now();
  try { inst.frame(now); } catch (e) { console.error(e); }
  if (state.phase === 'playing' && $('vStage').classList.contains('on')) {
    const c = clock();
    score.resize();
    score.draw(c.song ? c.beat : -4, { bpm: c.song ? c.bpm : 100, level: now - lastAction < 200 ? 1 - (now - lastAction) / 200 : 0 });
    const song = env.song();
    if (song && c.song) $('songbar').firstElementChild.style.width = `${Math.max(0, Math.min(100, (c.beat / song.beats) * 100)).toFixed(1)}%`;
  }
}
requestAnimationFrame(frame);

// ───────── 소켓 ─────────
function join() {
  mode = 'connecting';
  message('들어가는 중…', '큰 화면과 연결하고 있어요.');
  mode = 'connecting';
  if (socket.connected) socket.emit('join', { role: 'controller', room: ROOM, token });
  else socket.connect();
}
socket.on('connect', () => { measureRtt(); banner(''); socket.emit('join', { role: 'controller', room: ROOM, token }); });
socket.on('disconnect', () => { if (me) banner('서버 연결이 끊겼어요. 다시 잇는 중…'); });
socket.on('assigned', (p) => {
  if (!p || p.game !== 'orchestra') {
    const code = encodeURIComponent((p && p.code) || ROOM);
    location.replace(`${PLAY_URL(p && p.game ? p.game : 'baseball')}?room=${code}`);
    return;
  }
  me = p;
  noRoomTries = 0;
  document.documentElement.style.setProperty('--c', p.color);
  haptics.config({ color: p.color });
  $('me').textContent = p.name;
  if (mode === 'connecting' || mode === 'msg') mode = 'app';
  if (myInst && instChosen) sendInstrument();
  if (part) score.setPart(part, state.song ? getSong(state.song.id) : null, myInst, p.color, myDiff());
  render();
});
socket.on('players', (payload) => { roster = payload && Array.isArray(payload.players) ? payload.players : []; if (state.phase === 'lobby') render(); });
socket.on('ready_state', (st) => {
  const was = myReady;
  myReady = Boolean(me && st && st.ready && st.ready.includes(me.slot));
  if (was !== myReady || state.phase === 'lobby') render();
});
socket.on('display_status', ({ connected } = {}) => {
  displayOn = Boolean(connected);
  banner(connected ? '' : '큰 화면이 꺼져 있어요. 다시 열리면 이어서 해요.');
  if (connected && myInst && instChosen) setTimeout(sendInstrument, 300);
});
socket.on('no_room', () => {
  if (noRoomTries++ < 15) {
    message('방에 다시 연결하는 중', '잠시만 기다려 주세요.');
    setTimeout(() => socket.connected && socket.emit('join', { role: 'controller', room: ROOM, token }), 2000);
    return;
  }
  message('방을 찾을 수 없어요', '큰 화면의 QR을 다시 찍어 주세요.');
});
socket.on('room_full', () => message('4명이 꽉 찼어요', '빈자리가 생기면 다시 찍어 주세요.'));
socket.on('replaced', () => message('다른 탭에서 열었어요', '마지막으로 연 화면에서 조작해요.'));
socket.on('room_closed', () => message('방이 닫혔어요', '큰 화면의 새 QR을 찍어 주세요.'));

socket.on('game_state', (s) => {
  const prev = state;
  state = s && typeof s === 'object' ? s : { phase: 'lobby' };
  if (state.picker) picker = { ...picker, ...state.picker };
  if (state.phase !== 'playing') { clk.song = false; clk.live = false; }
  if (state.phase === 'playing' && prev.phase !== 'playing') { combo = 0; result = null; partKey = ''; score.clearMarks(); picking = false; }
  if (state.phase === 'select' && prev.phase !== 'select') { clip = null; }
  // 큰 화면이 정한 내 악기(봇 시험 등)와 다르면 맞춤
  const info = myInfo();
  if (info && info.inst && info.inst !== myInst && state.phase === 'playing') myInst = info.inst;
  if (state.clip && state.clip.url) clip = state.clip;
  if (mode === 'app') render();
  if (state.phase === 'playing' && state.stage === 'intro' && prev.stage !== 'intro') showCount('지휘자가 인사해요', true);
});
socket.on('picker', (p) => { picker = { ...(picker || {}), ...p }; if (state.phase === 'select' && mode === 'app') renderSelect(); });
socket.on('tempo', (d) => syncTempo(d));
socket.on('cue', (d) => {
  if (!d) return;
  if (d.count != null) { showCount(String(d.count)); haptics.play('tick', 1, { silent: true }); }
  else if (d.go) { showCount('시작!', true); setTimeout(() => $('count').classList.add('hidden'), 650); }
  else if (d.text) showCount(d.text, true);
  else if (d.hide) $('count').classList.add('hidden');
});
function showCount(text, small) {
  const c = $('count');
  c.textContent = text;
  c.classList.toggle('small', Boolean(small));
  c.classList.remove('hidden', 'pop');
  void c.offsetWidth;
  c.classList.add('pop');
  clearTimeout(showCount.t);
  showCount.t = setTimeout(() => c.classList.add('hidden'), small ? 2600 : 900);
}
socket.on('judge', (d) => {
  if (!d) return;
  score.mark(d.i, d.j);
  showJudge(d.j);
  combo = d.combo || 0;
  $('combo').textContent = combo >= 3 ? `${combo} COMBO` : '';
  // 타악기는 칠 때 이미 진동했으니, 나머지만 판정 진동
  const k = INSTRUMENTS[myInst] ? INSTRUMENTS[myInst].kind : '';
  if (d.j !== 'miss' && !['strike', 'tap'].includes(k)) haptics.play(d.j === 'perfect' ? 'perfect' : 'good', 1, { silent: true, remote: true, noFlash: isSustain(myInst) });
});
socket.on('result', (r) => { result = r || null; if (r && r.grade === 'S') haptics.play('success'); if (mode === 'app') render(); });
socket.on('clip', (c) => { clip = c && c.url ? c : null; if (mode === 'app' && state.phase === 'over') renderOver(); if (clip) haptics.play('success', 0.6); });

// ───────── 시작 ─────────
function keepAwake() { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {}); }
$('btnStart').addEventListener('click', async () => {
  if (started) return;
  started = true;
  $('btnStart').disabled = true;
  haptics.unlock();
  keepAwake();
  ensureSynth().resume();
  // iPhone 은 탭 안에서, await 전에 권한을 물어야 합니다.
  const perm = sensors.permission();
  if (myInst && INSTRUMENTS[myInst].mic) ensureMic(myInst === 'voice');
  await perm;
  if (!ROOM) { message('방 코드가 없어요', '큰 화면의 QR을 찍어 주세요.'); return; }
  join();
  setTimeout(() => {
    if (!sensors.gotMotion && !sensors.gotOrient) {
      noSensor = true;
      debug('동작 센서 값이 없어 화면 조작으로 해요');
    }
  }, SENSOR_WAIT_MS);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (synth) synth.allOff(); return; }
  if (started) keepAwake();
  if (synth && synth.ctx.state !== 'running') synth.ctx.resume().catch(() => {});
  render();
});
document.addEventListener('touchend', () => { if (synth && synth.ctx.state !== 'running') synth.ctx.resume(); }, { passive: true });

// ───────── 디버그·시험 ─────────
function debug(t) { if (DEBUG) $('debug').textContent = t; }
if (DEBUG) {
  setInterval(() => {
    const c = clock();
    debug(`phase ${state.phase}/${state.stage || ''} inst ${myInst} diff ${myDiff()} beat ${c.song ? c.beat.toFixed(2) : '-'} bpm ${Math.round(c.bpm)} rtt ${Math.round(rtt())} sensor ${noSensor ? 'N' : 'Y'} mic ${MIC_SIM ? 'sim' : micKind || '-'} ready ${myReady ? 'Y' : 'N'}`);
  }, 400);
}
window.__orchPhone = {
  get state() { return state; }, get me() { return me; }, get inst() { return inst; }, get myInst() { return myInst; }, get part() { return part; },
  get clock() { return clock(); }, get tut() { return tut; }, get picker() { return picker; }, get clip() { return clip; },
  choose(k) { const b = document.querySelector(`[data-k="${k}"]`); if (b) b.click(); else { myInst = k; instChosen = true; picking = false; ensureInstrument(); sendInstrument(); render(); } },
  ready: () => $('btnReady').click(),
  sensors,
  setNoSensor(v) { noSensor = v; },
};
