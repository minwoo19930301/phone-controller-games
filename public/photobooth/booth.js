// 네컷 사진관 큰 화면: 방·대기실, 모드(모두 한 장 / 각자 네컷 / 포즈 미션), 3-2-1 촬영, 다시 찍기, 다 같이 꾸미기, PNG 만들기·임시 올리기.
// 서버는 중계만 합니다. 사진은 폰 → 서버 → 이 화면으로만 오고, 완성본은 메모리(Blob)와 서버 임시 보관(10분)에만 둡니다.
//
// 흐름: lobby(대기) → [모두 준비] → shoot(촬영, playing) → review(다 찍음, 대기) → [모두 준비] → decorate(꾸미기, playing) → over(결과, 대기)
// 시험: ?bots=N(가짜 셀카 봇), ?autostart(봇만 있을 때 끝까지 자동), ?mode=pose&theme=neon&difficulty=easy
// 키: Enter 시작·다음, Space 바로 찰칵, M 모드, T 프레임, D 난이도, S 저장, B 봇 낙서, Esc 처음으로(촬영·꾸미기 중엔 두 번)
import { createSettings, fields } from '/common/settings.js';
import { createTutorialBoard } from '/common/tutorial-board.js';
import { sendHaptic } from '/common/haptics.js';
import { MODES, MODE, THEMES, THEME, makeSheet, drawSheet, drawSwatch, silhouette, aspectOf, fmtDate, rrect, SANS, ANTON, heartPath, starPath, sparkPath } from './frames.js';
import { drawItems, drawItem, cleanItem, cleanPoints, Q, STICKERS, PEN_COLORS } from './deco.js';
import { drawAvatar, avatarCanvas, POSES, GROUP_HEART } from './avatar.js';
import { sfx, audio } from './sfx.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const now = () => performance.now();
const BOTS = clamp(parseInt(params.get('bots'), 10) || 0, 0, 4);
const AUTOSTART = params.has('autostart');
const SLOT_INFO = {
  1: { name: '1P', color: '#ff5a5f' },
  2: { name: '2P', color: '#3ab4ff' },
  3: { name: '3P', color: '#ffc93c' },
  4: { name: '4P', color: '#5ee07a' }
};
const DECO_MS = 90000; // 꾸미기 90초
// 난이도 = 찍기 여유. 지금(처음 만든 그대로)은 '어려움' 쪽입니다.
const DIFF = {
  easy: { count: 5000, review: 12000, retakes: 3, intro: 2400 },
  normal: { count: 3000, review: 4200, retakes: 1, intro: 1700 },
  hard: { count: 3000, review: 1600, retakes: 0, intro: 1100 }
};
// 모두 한 장·각자 네컷의 컷별 한마디
const FREE = [
  { text: '활짝 웃어요', e: '😄', k: 'smile' },
  { text: '자유 포즈', e: '🤳', k: 'v' },
  { text: '얼굴 가까이!', e: '🤩', k: 'wink' },
  { text: '마지막 컷! 제일 신나게', e: '🎉', k: 'tongue' }
];
const PHOTO_WAIT = { live: 7000, file: 35000 }; // 찰칵 뒤 사진 기다리는 시간
const G = { phase: 'lobby' }; // lobby | shoot | review | decorate | over
let S = null; // 지금 판(세션)

await Promise.race([
  Promise.all([document.fonts.load('400 64px Anton'), document.fonts.load('900 64px "Pretendard Variable"'), document.fonts.load('800 20px "Pretendard Variable"')]),
  new Promise((r) => setTimeout(r, 2000))
]).catch(() => {});

// ================================================================
// 연결
// ================================================================
const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true });
let roomCode = null;
let roomKey = null;
let serverPlayers = [];
let readySt = null;
let hadRoom = false;
let rtt = 80;
function send(event, data, slot) {
  if (!socket.connected) return;
  socket.emit('d2c', slot != null ? { event, slot, data } : { event, data });
}
socket.on('connect', () => {
  let saved = null;
  try { saved = sessionStorage.getItem('pcg-photobooth-room'); } catch (e) {}
  socket.emit('join', { role: 'display', game: 'photobooth', room: saved });
});
socket.on('room', async (r) => {
  try { sessionStorage.setItem('pcg-photobooth-room', r.code); } catch (e) {}
  roomCode = r.code;
  roomKey = r.key || null;
  serverPlayers = r.players || [];
  if (r.fresh && hadRoom && G.phase !== 'lobby') backToLobby('서버가 다시 시작돼서 처음으로 돌아왔어요');
  hadRoom = true;
  $('code').textContent = r.code;
  $('codeMini').textContent = r.code;
  try {
    const res = await fetch(`/api/qr?room=${r.code}`).then((x) => x.json());
    $('qr').src = res.qr;
    $('qrMini').src = res.qr;
    $('url').textContent = res.url.replace(/^https?:\/\//, '');
    $('warn').classList.toggle('hidden', Boolean(res.secure) || /localhost|127\.0\.0\.1/.test(res.url));
  } catch (e) {}
  syncPlayers();
  pushState();
  if (AUTOSTART && BOTS > 0 && !autoStarted) {
    autoStarted = true;
    setTimeout(() => { if (!phonesPresent() && G.phase === 'lobby') startSession(); }, 1400);
  }
});
let autoStarted = false;
socket.on('players', (p) => {
  const before = new Map(serverPlayers.map((x) => [x.slot, x.connected]));
  serverPlayers = p.players || [];
  for (const pl of serverPlayers) {
    if (!before.has(pl.slot)) sfx.join();
    // 꾸미는 중에 다시 들어온 폰에는 지금까지 꾸민 것을 보내 줍니다.
    if (pl.connected && before.get(pl.slot) === false && G.phase === 'decorate') sendDecoSync(pl.slot);
  }
  for (const s of [...info.keys()]) if (!info.get(s).bot && !serverPlayers.some((x) => x.slot === s)) info.delete(s);
  syncPlayers();
  pushState();
});
socket.on('ready_state', (st) => { readySt = st; renderPlayers(); renderSide(); });
socket.on('display_replaced', () => $('replaced').classList.remove('hidden'));
socket.on('start_game', () => onStart());
socket.on('photo', (d) => onPhoto(d));
socket.on('draw', (d) => { if (decoOK(d)) applyDraw(d.slot, d); });
socket.on('sticker', (d) => { if (decoOK(d)) applySticker(d.slot, d, false); });
socket.on('undo', (d) => { if (decoOK(d)) applyDelete(d.slot, d.id); });
socket.on('clear', (d) => { if (decoOK(d)) applyClear(d.slot, d.sh); });
socket.on('msg', (d) => onMsg(d, false));
socket.on('msg_v', (d) => onMsg(d, true));
setInterval(() => {
  if (!socket.connected) return;
  const t0 = now();
  socket.timeout(2000).emit('ping_rtt', t0, (err) => { if (!err) rtt = rtt * 0.6 + (now() - t0) * 0.4; });
}, 2000);

// ================================================================
// 설정·연습 현황
// ================================================================
const settings = createSettings({
  game: 'photobooth',
  fields: [
    fields.difficulty({ hints: { easy: '5초 · 다시 찍기 3번', normal: '3초 · 다시 찍기 1번', hard: '3초 · 한 번에' } }),
    fields.choice('mode', '모드', MODES.map((m) => ({ value: m.id, label: m.short, hint: m.desc })), { default: 'together', hotkey: 'm' }),
    fields.choice('theme', '프레임', THEMES.map((t) => ({ value: t.id, label: t.short })), { default: 'classic', hotkey: 't' })
  ],
  onChange: (v, ch) => { renderPicks(ch); syncSample(); renderNext(); pushState(); }
});
settings.attach(socket);
settings.mount($('settingsBox'));
const board = createTutorialBoard({ mount: $('tutBox') });
board.attach(socket);

// ================================================================
// 사람(폰 + 봇)
// ================================================================
const info = new Map(); // slot -> { bot, cam, pv: Image, pvUrl, pvAt, pvA, cv(봇 캔버스) }
function infoOf(slot) {
  let x = info.get(slot);
  if (!x) { x = { bot: false, cam: null, pv: null, pvUrl: null, pvAt: 0, pvA: 0.75, cv: null }; info.set(slot, x); }
  return x;
}
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
function syncPlayers() {
  const list = lobbyPlayers();
  for (const p of list) {
    const x = infoOf(p.slot);
    x.bot = p.bot;
    if (p.bot) {
      x.cam = 'bot';
      if (!x.cv) { x.cv = document.createElement('canvas'); x.cv.width = 240; x.cv.height = 300; }
    }
  }
  for (const [s, x] of info) if (x.bot && !list.some((p) => p.slot === s && p.bot)) info.delete(s);
  board.setPlayers(serverPlayers);
  renderPlayers();
  syncSample();
  renderSide();
}
const phonesPresent = () => serverPlayers.length > 0;
function alive(slot) {
  const x = info.get(slot);
  if (x && x.bot) return true;
  const p = serverPlayers.find((q) => q.slot === slot);
  return Boolean(p && p.connected);
}
const nameOf = (s) => (SLOT_INFO[s] || { name: `${s}P` }).name;
const colorOf = (s) => (SLOT_INFO[s] || { color: '#fff' }).color;
function camOf(slot) { const x = info.get(slot); return x ? x.cam : null; }
/** 실시간 미리보기(폰이 보내는 작은 사진, 봇은 그림). 4초 넘게 안 오면 없음 */
function liveSrc(slot) {
  const x = info.get(slot);
  if (!x) return null;
  if (x.bot) return x.cv;
  if (x.pv && now() - x.pvAt < 4000) return x.pv;
  return null;
}

// ================================================================
// 폰이 보내는 범용 메시지
// ================================================================
function onMsg(d, volatile) {
  if (!d || typeof d !== 'object') return;
  const slot = Number(d.slot);
  if (!SLOT_INFO[slot]) return;
  switch (d.type) {
    case 'pv': {
      // 실시간 미리보기(초당 몇 장). 이전 그림은 새 그림이 다 읽힌 뒤에 바꿉니다(깜빡임 없음).
      const url = String(d.img || '');
      if (!url.startsWith('data:image/') || url.length > 200000) return;
      const x = infoOf(slot);
      if (x.loading) return;
      x.loading = true;
      const img = new Image();
      img.onload = () => { x.loading = false; x.pv = img; x.pvUrl = url; x.pvAt = now(); x.pvA = Number(d.a) || 0.75; paintPolaroidPv(slot); };
      img.onerror = () => { x.loading = false; };
      img.src = url;
      if (x.cam !== 'live' && x.cam !== 'fake') { x.cam = d.fake ? 'fake' : 'live'; renderPlayers(); }
      return;
    }
    case 'cam': {
      const x = infoOf(slot);
      const st = ['live', 'file', 'fake', 'off', 'denied', 'asking'].includes(d.state) ? d.state : 'off';
      if (x.cam !== st) { x.cam = st; renderPlayers(); renderSide(); pushState(); }
      return;
    }
    case 'retake':
    case 'keep': {
      if (!S || G.phase !== 'shoot' || S.step !== 'review') return;
      if (Number(d.seq) !== S.seqOf.get(`${S.idx}:${slot}`)) return;
      if (d.type === 'retake') S.retakeReq.add(slot);
      else S.keep.add(slot);
      renderSide();
      return;
    }
    case 'stk':
      if (volatile && decoOK({ slot })) applySticker(slot, d, true);
      return;
    case 'done': {
      if (!decoOK({ slot })) return;
      if (d.on) S.deco.done.add(slot);
      else S.deco.done.delete(slot);
      if (d.on) sfx.pop();
      renderSide();
      pushState();
      checkDecoDone();
      return;
    }
    case 'sync':
      if (G.phase === 'decorate') sendDecoSync(slot);
      else if (G.phase === 'review' && S && S.bases) send('msg', { type: 'sheets', session: S.id, sheets: S.bases, preview: true }, slot);
      return;
    default:
  }
}

// ================================================================
// 판 그리기(대기실 견본·촬영 무대 공통)
// ================================================================
const DPR = () => Math.min(2, window.devicePixelRatio || 1);
class SheetView {
  constructor(host, sheet, opts) {
    this.sheet = sheet;
    this.opts = opts; // () => drawSheet 옵션
    this.el = document.createElement('div');
    this.el.className = 'sheet';
    this.cv = document.createElement('canvas');
    this.ctx = this.cv.getContext('2d');
    this.el.appendChild(this.cv);
    if (sheet.owner) {
      const t = document.createElement('div');
      t.className = 'tagline';
      t.style.setProperty('--c', colorOf(sheet.owner));
      t.textContent = nameOf(sheet.owner);
      this.el.appendChild(t);
    }
    host.appendChild(this.el);
    this.w = 0;
    this.h = 0;
  }
  place(x, y, w, h, rot = 0, enter = false) {
    this.el.style.width = `${w}px`;
    this.el.style.height = `${h}px`;
    this.el.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
    if (enter) {
      this.el.style.setProperty('--from', `translate(${x}px, ${y + 80}px)`);
      this.el.classList.remove('enter');
      void this.el.offsetWidth;
      this.el.classList.add('enter');
    }
    const k = DPR();
    const bw = Math.max(1, Math.round(w * k));
    const bh = Math.max(1, Math.round(h * k));
    if (bw !== this.cv.width || bh !== this.cv.height) { this.cv.width = bw; this.cv.height = bh; }
    this.w = w;
    this.h = h;
  }
  draw() {
    if (!this.w) return;
    const s = this.cv.width / this.sheet.w;
    const g = this.ctx;
    g.setTransform(s, 0, 0, s, 0, 0);
    const o = this.opts(this.sheet);
    drawSheet(g, this.sheet, o.theme, o);
    if (o.items) drawItems(g, o.items, this.sheet.w, this.sheet.h);
    if (o.tips) drawTips(g, this.sheet, o.tips);
  }
  remove() { this.el.remove(); }
}

// 꾸미는 중인 펜 끝에 이름표
function drawTips(g, sheet, tips) {
  const u = sheet.w / 800;
  for (const [slot, t] of tips) {
    if (t.sh !== sheet.id || now() - t.at > 600) continue;
    const x = (t.x / Q) * sheet.w;
    const y = (t.y / Q) * sheet.h;
    g.save();
    g.fillStyle = colorOf(slot);
    g.strokeStyle = '#fff';
    g.lineWidth = 3 * u;
    g.beginPath();
    g.arc(x, y, 9 * u, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    const fs = 22 * u;
    g.font = `400 ${fs}px ${ANTON}`;
    const tw = g.measureText(nameOf(slot)).width + fs * 0.8;
    rrect(g, x + 12 * u, y - fs * 1.7, tw, fs * 1.3, fs * 0.65);
    g.fill();
    g.fillStyle = '#140e16';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(nameOf(slot), x + 12 * u + tw / 2, y - fs * 1.05);
    g.restore();
  }
}

// ================================================================
// 대기실
// ================================================================
const MODE_ART = {
  together: '<svg viewBox="0 0 54 64"><rect x="15" y="2" width="24" height="60" rx="2" fill="#fbf8f1"/><rect x="18" y="5" width="18" height="11" fill="#ff5a5f"/><rect x="18" y="18" width="18" height="11" fill="#3ab4ff"/><rect x="18" y="31" width="18" height="11" fill="#ffc93c"/><rect x="18" y="44" width="18" height="11" fill="#5ee07a"/></svg>',
  each: '<svg viewBox="0 0 54 64"><g transform="rotate(-8 14 40)"><rect x="4" y="6" width="15" height="54" rx="2" fill="#fbf8f1"/><rect x="6" y="9" width="11" height="9" fill="#ff5a5f"/><rect x="6" y="20" width="11" height="9" fill="#ff5a5f"/><rect x="6" y="31" width="11" height="9" fill="#ff5a5f"/><rect x="6" y="42" width="11" height="9" fill="#ff5a5f"/></g><rect x="20" y="4" width="15" height="54" rx="2" fill="#fbf8f1"/><rect x="22" y="7" width="11" height="9" fill="#3ab4ff"/><rect x="22" y="18" width="11" height="9" fill="#3ab4ff"/><rect x="22" y="29" width="11" height="9" fill="#3ab4ff"/><rect x="22" y="40" width="11" height="9" fill="#3ab4ff"/><g transform="rotate(8 42 40)"><rect x="36" y="6" width="15" height="54" rx="2" fill="#fbf8f1"/><rect x="38" y="9" width="11" height="9" fill="#ffc93c"/><rect x="38" y="20" width="11" height="9" fill="#ffc93c"/><rect x="38" y="31" width="11" height="9" fill="#ffc93c"/><rect x="38" y="42" width="11" height="9" fill="#ffc93c"/></g></svg>',
  pose: '<svg viewBox="0 0 54 64"><rect x="3" y="6" width="48" height="56" rx="2" fill="#fbf8f1"/><g fill="#ff5a5f"><rect x="6" y="9" width="10" height="10"/><rect x="29" y="9" width="10" height="10"/><rect x="6" y="32" width="10" height="10"/><rect x="29" y="32" width="10" height="10"/></g><g fill="#3ab4ff"><rect x="17" y="9" width="10" height="10"/><rect x="40" y="9" width="8" height="10"/><rect x="17" y="32" width="10" height="10"/><rect x="40" y="32" width="8" height="10"/></g><g fill="#ffc93c"><rect x="6" y="20" width="10" height="10"/><rect x="29" y="20" width="10" height="10"/><rect x="6" y="43" width="10" height="10"/><rect x="29" y="43" width="10" height="10"/></g><g fill="#5ee07a"><rect x="17" y="20" width="10" height="10"/><rect x="40" y="20" width="8" height="10"/><rect x="17" y="43" width="10" height="10"/><rect x="40" y="43" width="8" height="10"/></g><text x="27" y="5" font-size="7" text-anchor="middle" fill="#ffd27a">♥</text></svg>'
};
function buildPicks() {
  const m = $('modes');
  m.innerHTML = MODES.map((x) => `<button type="button" class="mode" data-mode="${x.id}">${MODE_ART[x.id]}<div><b>${x.name}</b><span>${x.desc}</span></div></button>`).join('');
  m.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b) settings.set('mode', b.dataset.mode, 'display');
  });
  const t = $('themes');
  t.innerHTML = THEMES.map((x) => `<button type="button" class="theme" data-theme="${x.id}"><canvas width="92" height="276"></canvas><span>${x.short}</span></button>`).join('');
  for (const b of t.querySelectorAll('.theme')) drawSwatch(b.querySelector('canvas').getContext('2d'), b.dataset.theme, 'strip', 92, 276);
  t.addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme]');
    if (b) settings.set('theme', b.dataset.theme, 'display');
  });
}
function renderPicks(ch) {
  const mode = settings.get('mode');
  const theme = settings.get('theme');
  for (const b of document.querySelectorAll('.mode')) {
    b.classList.toggle('on', b.dataset.mode === mode);
    if (ch && ch.key === 'mode' && b.dataset.mode === mode) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
  }
  for (const b of document.querySelectorAll('.theme')) {
    b.classList.toggle('on', b.dataset.theme === theme);
    if (ch && ch.key === 'theme' && b.dataset.theme === theme) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
  }
}

const CAM_ICO = '<svg viewBox="0 0 48 48"><rect x="6" y="14" width="36" height="26" rx="5"/><circle cx="24" cy="27" r="7.5"/><path d="M17 14l3-5h8l3 5"/></svg>';
let polSig = '';
function renderPlayers() {
  const list = lobbyPlayers();
  const box = $('players');
  const sig = list.map((p) => `${p.slot}${p.bot ? 'b' : ''}`).join(',');
  const fresh = sig !== polSig;
  const prev = new Set(polSig.split(',').filter(Boolean));
  if (fresh) {
    polSig = sig;
    let html = '';
    for (let s = 1; s <= 4; s++) {
      const p = list.find((q) => q.slot === s);
      const joinAnim = p && !prev.has(`${s}${p.bot ? 'b' : ''}`) ? ' pop-in' : '';
      html += p
        ? `<div class="pol${joinAnim}" data-slot="${s}" style="--c:${colorOf(s)}"><div class="ph"><div class="ico">${CAM_ICO}</div></div><div class="cap"><b>${nameOf(s)}</b><span></span><em></em></div></div>`
        : `<div class="pol empty"><div class="ph"><div class="ico">${CAM_ICO}</div></div><div class="cap"><b>${nameOf(s)}</b><span>QR로 들어와요</span></div></div>`;
    }
    box.innerHTML = html;
    for (const p of list) {
      const x = info.get(p.slot);
      const ph = box.querySelector(`[data-slot="${p.slot}"] .ph`);
      if (!ph) continue;
      if (x && x.bot && x.cv) ph.appendChild(x.cv);
      else {
        const img = document.createElement('img');
        img.alt = '';
        img.hidden = true;
        ph.appendChild(img);
      }
    }
  }
  const practicing = new Set(board.practicing ? board.practicing() : []);
  for (const p of list) {
    const el = box.querySelector(`[data-slot="${p.slot}"]`);
    if (!el) continue;
    const x = info.get(p.slot) || {};
    el.classList.toggle('away', !p.bot && !p.connected);
    const cam = p.bot ? '가짜 셀카 봇' : !p.connected ? '연결 끊김' : practicing.has(p.slot) ? '연습 중' :
      x.cam === 'live' ? '카메라 켜짐' : x.cam === 'fake' ? '시험 카메라' : x.cam === 'file' ? '폰에서 직접 찍기' : x.cam === 'asking' ? '카메라 허용 기다리는 중' :
      x.cam === 'off' || x.cam === 'denied' ? '카메라 꺼짐' : '들어오는 중';
    el.querySelector('.cap span').textContent = cam;
    const ready = p.bot || (readySt && readySt.ready && readySt.ready.includes(p.slot));
    const em = el.querySelector('.cap em');
    em.textContent = ready ? '준비 ✓' : '준비 전';
    em.classList.toggle('ok', Boolean(ready));
    paintPolaroidPv(p.slot);
  }
  renderHint();
}
function paintPolaroidPv(slot) {
  const el = document.querySelector(`#players [data-slot="${slot}"]`);
  if (!el) return;
  const x = info.get(slot);
  const img = el.querySelector('.ph img');
  let live = el.querySelector('.live');
  const on = Boolean(x && (x.bot || (x.pv && now() - x.pvAt < 4000)));
  if (img && x && x.pvUrl && on) { if (img.src !== x.pvUrl) img.src = x.pvUrl; img.hidden = false; }
  else if (img) img.hidden = true;
  if (on && !live) {
    live = document.createElement('div');
    live.className = 'live';
    live.innerHTML = '<i></i>LIVE';
    el.querySelector('.ph').appendChild(live);
  } else if (!on && live) live.remove();
}
function renderHint() {
  const n = lobbyPlayers().length;
  const bots = !phonesPresent() && BOTS > 0;
  $('lobbyHint').innerHTML = (n ? `<b>폰에서 모두 준비</b>를 누르면 바로 찍어요` : 'QR을 찍고 들어오면 내 얼굴이 여기 떠요') +
    (bots ? '<span class="dot"></span><kbd style="margin:0 6px 0 0">Enter</kbd>봇과 시작' : '') +
    '<span class="dot"></span>화면을 한 번 누르면 소리가 켜져요';
}

// 대기실 견본 판: 고른 모드·프레임에 지금 들어온 사람 얼굴을 실시간으로
let sample = { sig: '', views: [] };
function sampleSheets() {
  const mode = settings.get('mode');
  const slots = lobbyPlayers().map((p) => p.slot);
  return buildSheets(mode, slots.length ? slots : [null]);
}
function syncSample() {
  if (G && G.phase !== 'lobby') return;
  const mode = settings.get('mode');
  const slots = lobbyPlayers().map((p) => p.slot);
  const sig = `${mode}|${slots.join(',')}`;
  if (sig !== sample.sig) {
    for (const v of sample.views) v.remove();
    sample.sig = sig;
    sample.views = sampleSheets().map((sh) => new SheetView($('sample'), sh, sampleOpts));
    layoutSample(true);
  }
}
function sampleOpts(sheet) {
  return {
    theme: settings.get('theme'),
    t: now() / 1000,
    date: new Date(),
    players: lobbyPlayers().map((p) => ({ color: p.color })),
    owner: sheet.owner ? { name: nameOf(sheet.owner), color: colorOf(sheet.owner) } : null,
    cell: (ci, sub) => {
      if (sub.slot == null) return { src: silhouette(ci) };
      const src = liveSrc(sub.slot);
      return src ? { src, live: true } : { src: silhouette(sub.slot - 1) };
    }
  };
}
function layoutSample(enter) {
  const box = $('sample');
  const bw = box.clientWidth;
  const bh = box.clientHeight;
  const views = sample.views;
  if (!views.length || !bw || !bh) return;
  const asp = views[0].sheet.w / views[0].sheet.h;
  if (views.length === 1) {
    let h = bh * 0.96;
    let w = h * asp;
    if (w > bw * 0.9) { w = bw * 0.9; h = w / asp; }
    views[0].place((bw - w) / 2, (bh - h) / 2, w, h, -3, enter);
    return;
  }
  // 각자 네컷: 여러 띠를 부채꼴로
  const n = views.length;
  let h = bh * 0.92;
  let w = h * asp;
  const over = 0.66;
  let total = w + (n - 1) * w * over;
  if (total > bw * 0.95) { const k = (bw * 0.95) / total; w *= k; h *= k; total *= k; }
  const rots = { 2: [-5, 5], 3: [-7, 0, 7], 4: [-9, -3, 3, 9] }[n] || [];
  views.forEach((v, i) => {
    const x = (bw - total) / 2 + i * w * over;
    const y = (bh - h) / 2 + Math.abs(i - (n - 1) / 2) * h * 0.035;
    v.place(x, y, w, h, rots[i] || 0, enter);
  });
}

// ================================================================
// 판 모양·촬영 순서
// ================================================================
function buildSheets(mode, slots) {
  if (mode === 'each') return slots.map((s) => makeSheet('strip', { id: s ?? 0, owner: s, cutSlots: [[s], [s], [s], [s]] }));
  if (mode === 'pose') return [makeSheet('grid', { id: 0, cutSlots: [slots, slots, slots, slots] })];
  const order = [0, 1, 2, 3].map((i) => slots[i % slots.length]);
  return [makeSheet('strip', { id: 0, cutSlots: order.map((s) => [s]) })];
}
function shufflePoses() {
  const p = POSES.slice();
  for (let i = p.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  return [...p.slice(0, 3), GROUP_HEART];
}
function buildShots(mode, slots) {
  if (mode === 'pose') return shufflePoses().map((p, c) => ({ cut: c, slots: slots.slice(), prompt: { text: p.text, e: p.e, k: p.k, tip: p.tip } }));
  if (mode === 'each') return FREE.map((p, c) => ({ cut: c, slots: slots.slice(), prompt: p }));
  return FREE.map((p, c) => ({ cut: c, slots: [slots[c % slots.length]], prompt: p }));
}
const sheetIdOf = (S0, slot) => (S0.mode === 'each' ? slot : 0);
const keyOf = (S0, slot, cut) => `${sheetIdOf(S0, slot)}:${cut}:${slot}`;
const sheetById = (id) => (S ? S.sheets.find((s) => s.id === id) : null);
function subOf(S0, slot, cut) {
  const sh = S0.sheets.find((s) => s.id === sheetIdOf(S0, slot));
  return sh ? sh.cuts[cut].subs.find((x) => x.slot === slot) || null : null;
}
function aspectsFor(S0, shot, shooters) {
  const out = {};
  for (const s of shooters) { const sub = subOf(S0, s, shot.cut); if (sub) out[s] = Math.round(aspectOf(sub) * 1000) / 1000; }
  return out;
}

// ================================================================
// 상태
// ================================================================
let sessionNo = 0;
let views = []; // 무대 위 판들
const wakers = new Set();
function nap(ms) {
  return new Promise((res) => {
    const w = () => { clearTimeout(t); wakers.delete(w); res(); };
    const t = setTimeout(w, Math.max(0, ms));
    wakers.add(w);
  });
}
async function until(cond, ms) {
  const end = now() + ms;
  while (!cond() && now() < end) await nap(Math.min(90, end - now()));
}
function wakeAll() { for (const w of [...wakers]) w(); }

function setPhase(p) {
  G.phase = p;
  settings.lock(p !== 'lobby' && p !== 'over');
  board.hide(p !== 'lobby');
  $('lobby').classList.toggle('hidden', p !== 'lobby');
  $('studio').classList.toggle('hidden', p === 'lobby');
  $('join').classList.toggle('hidden', p === 'lobby');
  const st = $('studio');
  st.classList.toggle('over', p === 'over');
  if (p === 'lobby') {
    for (const v of views) v.remove();
    views = [];
    sample.sig = '';
    syncSample();
  } else {
    for (const v of sample.views) v.remove();
    sample.views = [];
    sample.sig = '';
  }
  layoutStudio(true);
  renderSide();
  pushState();
}

function onStart() {
  audio();
  if (G.phase === 'lobby' || G.phase === 'over') startSession();
  else if (G.phase === 'review') startDecorate();
}

function startSession() {
  if (G.phase !== 'lobby' && G.phase !== 'over') return;
  const slots = lobbyPlayers().filter((p) => p.bot || p.connected).map((p) => p.slot);
  if (!slots.length) { toast('QR을 찍고 들어온 사람이 있어야 찍을 수 있어요'); return; }
  if (!settings.requireAnswered()) return;
  clearResult();
  const mode = settings.get('mode');
  const diff = settings.get('difficulty');
  S = {
    id: ++sessionNo, mode, theme: settings.get('theme'), diff, cfg: DIFF[diff] || DIFF.normal, slots,
    sheets: buildSheets(mode, slots), shots: buildShots(mode, slots), idx: 0, step: 'intro', stepAt: now(), seq: 0,
    active: [], photos: new Map(), frozen: new Map(), seqOf: new Map(), pending: new Set(), keep: new Set(), retakeReq: new Set(), retakes: new Map(),
    startedAt: new Date(), shutterAt: 0, skip: false, deco: null, result: null, clips: null, making: false
  };
  for (const v of views) v.remove();
  views = S.sheets.map((sh) => new SheetView($('stage'), sh, studioOpts));
  setPhase('shoot');
  runShoot(S);
}

// ---------- 촬영 ----------
async function runShoot(S0) {
  const ok = () => S === S0 && G.phase === 'shoot';
  for (let i = 0; i < S0.shots.length; i++) {
    if (!ok()) return;
    S0.idx = i;
    const shot = S0.shots[i];
    let shooters = shot.slots.filter(alive);
    if (S0.mode === 'together' && !shooters.length) {
      // 차례인 사람이 나갔으면 남은 사람이 대신 찍습니다.
      const k = S0.slots.indexOf(shot.slots[0]);
      const alt = [...S0.slots.slice(k + 1), ...S0.slots.slice(0, k + 1)].find(alive);
      if (alt != null) {
        shot.slots = [alt];
        S0.sheets[0].cuts[shot.cut].subs[0].slot = alt;
        shooters = [alt];
      }
    }
    if (!shooters.length) {
      for (const s of shot.slots) S0.photos.set(keyOf(S0, s, shot.cut), { missing: true });
      continue;
    }
    let retry = false;
    while (shooters.length && ok()) {
      await takeShot(S0, shot, shooters, retry);
      if (!ok()) return;
      const again = await reviewShot(S0, shot, shooters);
      if (!ok()) return;
      shooters = again.filter(alive);
      retry = true;
    }
  }
  if (!ok()) return;
  S0.active = [];
  S0.step = 'done';
  sfx.done();
  setPhase('review');
  // 다 찍은 판을 폰에도 바로 보여 줍니다(꾸미기 바탕으로도 그대로 씀).
  S0.bases = S0.sheets.map((sh) => sheetBase(sh));
  send('msg', { type: 'sheets', session: S0.id, sheets: S0.bases, preview: true });
  if (AUTOSTART && !phonesPresent()) setTimeout(() => { if (S === S0 && G.phase === 'review') startDecorate(); }, 2600);
}

async function takeShot(S0, shot, shooters, retry) {
  const ok = () => S === S0 && G.phase === 'shoot';
  S0.active = shooters.slice();
  S0.seq += 1;
  const seq = S0.seq;
  for (const s of shooters) {
    S0.seqOf.set(`${S0.idx}:${s}`, seq);
    S0.photos.delete(keyOf(S0, s, shot.cut));
    S0.frozen.delete(keyOf(S0, s, shot.cut));
    S0.keep.delete(s);
    S0.retakeReq.delete(s);
  }
  // 1) 이번 컷 소개
  S0.step = 'intro';
  S0.stepAt = now();
  S0.retry = retry;
  S0.skip = false;
  sfx.cue();
  layoutStudio(false);
  renderSide(true);
  pushState();
  await nap(retry ? 900 : S0.cfg.intro);
  if (!ok()) return;
  // 2) 3-2-1
  const ms = S0.cfg.count;
  S0.step = 'count';
  S0.shutterAt = now() + ms;
  S0.digit = null;
  send('countdown', { seq, idx: S0.idx, total: S0.shots.length, cut: shot.cut, ms, dl: Math.round(rtt / 2), shooters, aspects: aspectsFor(S0, shot, shooters), prompt: shot.prompt, retry, mode: S0.mode });
  renderSide();
  pushState();
  await until(() => S0.skip || !ok(), ms);
  if (!ok()) return;
  S0.skip = false;
  // 3) 찰칵
  S0.step = 'wait';
  S0.shutterAt = 0;
  shutterFx();
  send('shot', { seq });
  for (const s of shooters) {
    const key = keyOf(S0, s, shot.cut);
    // 폰은 지연만큼 먼저 찍으므로 사진이 이 화면의 찰칵보다 먼저 도착할 수 있습니다. 그때는 기다리지 않습니다.
    if (S0.photos.get(key) && S0.photos.get(key).img) continue;
    const src = liveSrc(s);
    if (src) S0.frozen.set(key, { img: snapshot(src), at: now() });
    S0.pending.add(s);
    const x = info.get(s);
    if (x && x.bot) setTimeout(() => botPhoto(S0, shot, s, seq), 220 + Math.random() * 420);
  }
  renderSide();
  pushState();
  // 4) 사진 기다리기(직접 찍는 폰은 더 오래)
  const slow = shooters.some((s) => camOf(s) === 'file');
  await until(() => !ok() || shooters.every((s) => !S0.pending.has(s) || !alive(s)), slow ? PHOTO_WAIT.file : PHOTO_WAIT.live);
  if (!ok()) return;
  for (const s of shooters) {
    if (!S0.pending.has(s)) continue;
    S0.pending.delete(s);
    S0.photos.set(keyOf(S0, s, shot.cut), { missing: true });
  }
}

async function reviewShot(S0, shot, shooters) {
  const ok = () => S === S0 && G.phase === 'shoot';
  S0.step = 'review';
  S0.stepAt = now();
  const cfg = S0.cfg;
  const used = (s) => S0.retakes.get(`${S0.idx}:${s}`) || 0;
  const can = (s) => !(info.get(s) || {}).bot && used(s) < cfg.retakes;
  for (const s of shooters) {
    const x = info.get(s);
    if (x && x.bot) { S0.keep.add(s); continue; }
    const ph = S0.photos.get(keyOf(S0, s, shot.cut));
    send('result', { seq: S0.seqOf.get(`${S0.idx}:${s}`), idx: S0.idx, ok: Boolean(ph && ph.img), review: cfg.review, retake: can(s), left: Math.max(0, cfg.retakes - used(s)) }, s);
  }
  renderSide();
  pushState();
  const anyCan = shooters.some(can);
  await until(() => !ok() || S0.skip || shooters.every((s) => S0.keep.has(s) || S0.retakeReq.has(s) || !alive(s)), anyCan ? cfg.review : Math.min(cfg.review, 1600));
  S0.skip = false;
  if (!ok()) return [];
  const again = shooters.filter((s) => S0.retakeReq.has(s) && can(s));
  for (const s of again) S0.retakes.set(`${S0.idx}:${s}`, used(s) + 1);
  return again;
}

function snapshot(src) {
  // 찰칵 순간의 미리보기를 멈춘 그림으로(봇 캔버스는 계속 바뀌므로 복사)
  if (src instanceof HTMLImageElement) return src;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

function shutterFx() {
  const f = $('flash');
  f.classList.remove('on');
  void f.offsetWidth;
  f.classList.add('on');
  const m = $('mirror');
  m.classList.add('flashing');
  setTimeout(() => m.classList.remove('flashing'), 500);
  sfx.shutter();
}

function onPhoto(d) {
  const S0 = S;
  if (!S0 || !d || G.phase !== 'shoot') return;
  const slot = Number(d.slot);
  const idx = Number(d.idx);
  const seq = Number(d.seq);
  if (!SLOT_INFO[slot] || !S0.shots[idx]) return;
  if (S0.seqOf.get(`${idx}:${slot}`) !== seq) return; // 예전 카운트다운 것
  const url = String(d.dataUrl || '');
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(url) || url.length > 3_600_000) return;
  if (d.src === 'file' || d.src === 'live' || d.src === 'fake') infoOf(slot).cam = d.src;
  const img = new Image();
  img.onload = () => {
    if (S !== S0 || S0.seqOf.get(`${idx}:${slot}`) !== seq) return;
    landPhoto(S0, keyOf(S0, slot, S0.shots[idx].cut), img, slot);
  };
  img.src = url;
}
function landPhoto(S0, key, img, slot) {
  const th = THEME[S0.theme];
  let baked = null;
  if (th && th.filter) {
    // 테마 사진 톤은 한 번만 입혀 둡니다(매 화면마다 필터를 돌리지 않게).
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if ('filter' in g) g.filter = th.filter;
    g.drawImage(img, 0, 0);
    baked = c;
  }
  const had = [...S0.photos.values()].filter((p) => p.img).length;
  S0.photos.set(key, { img, baked, at: now(), spin: (Math.random() - 0.5) * 0.16, slot });
  S0.pending.delete(slot);
  sfx.land(had);
  sendHaptic(socket, slot, 'success', 1);
  renderSide();
}
function botPhoto(S0, shot, slot, seq) {
  if (S !== S0 || S0.seqOf.get(`${S0.shots.indexOf(shot)}:${slot}`) !== seq) return;
  const sub = subOf(S0, slot, shot.cut);
  const a = sub ? aspectOf(sub) : 0.75;
  const w = a >= 1 ? 900 : Math.round(900 * a);
  const h = a >= 1 ? Math.round(900 / a) : 900;
  const pose = S0.mode === 'pose' ? shot.prompt.k : shot.prompt.k || 'smile';
  const c = avatarCanvas(w, h, { slot, pose, badge: 'BOT', color: colorOf(slot), t: 1.3 });
  landPhoto(S0, keyOf(S0, slot, shot.cut), c, slot);
}

// 촬영 무대 그리기 옵션
function studioOpts(sheet) {
  const S0 = S;
  const t = now();
  const cur = S0 && S0.shots[S0.idx];
  const decorating = G.phase === 'decorate' || G.phase === 'over';
  return {
    theme: S0 ? S0.theme : 'classic',
    t: t / 1000,
    date: S0 ? S0.startedAt : new Date(),
    players: S0 ? S0.slots.map((s) => ({ color: colorOf(s) })) : [],
    owner: sheet.owner ? { name: nameOf(sheet.owner), color: colorOf(sheet.owner) } : null,
    highlight: G.phase === 'shoot' && cur && S0.active.some((s) => sheetIdOf(S0, s) === sheet.id) ? cur.cut : null,
    final: G.phase === 'over',
    cell: (ci, sub) => cellFor(S0, sheet, ci, sub, t),
    label: (ci, sub) => labelFor(S0, sheet, ci, sub),
    items: decorating && S0 && S0.deco ? itemsOf(S0, sheet.id) : null,
    tips: G.phase === 'decorate' && S0 && S0.deco ? S0.deco.tips : null
  };
}
const easeOutBack = (k) => { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
function cellFor(S0, sheet, ci, sub, t) {
  if (!S0 || sub.slot == null) return null;
  const slot = sub.slot;
  const key = `${sheet.id}:${ci}:${slot}`;
  const cur = S0.shots[S0.idx];
  const isCur = G.phase === 'shoot' && cur && cur.cut === ci && S0.active.includes(slot) && sheetIdOf(S0, slot) === sheet.id;
  if (isCur && (S0.step === 'intro' || S0.step === 'count')) {
    const src = liveSrc(slot);
    return src ? { src, live: true } : null;
  }
  const ph = S0.photos.get(key);
  if (ph && ph.img) {
    if (G.phase === 'over') return { src: ph.baked || ph.img, baked: Boolean(ph.baked) };
    const age = (t - ph.at) / 1000;
    const k = clamp(age / 0.75, 0, 1);
    const e = easeOutBack(k);
    return {
      src: ph.baked || ph.img, baked: Boolean(ph.baked),
      zoom: 1.22 - 0.22 * e, rot: (1 - e) * ph.spin, alpha: clamp(0.35 + age / 0.3, 0, 1), develop: clamp(0.75 - age / 1.6, 0, 1)
    };
  }
  const fr = S0.frozen.get(key);
  if (fr) return { src: fr.img, flash: clamp(1 - (t - fr.at) / 450, 0, 1) * 0.95 };
  return null;
}
function labelFor(S0, sheet, ci, sub) {
  if (!S0 || sub.slot == null) return null;
  const slot = sub.slot;
  const ph = S0.photos.get(`${sheet.id}:${ci}:${slot}`);
  const cur = S0.shots[S0.idx];
  const isCur = G.phase === 'shoot' && cur && cur.cut === ci && S0.active.includes(slot);
  let subText = '';
  if (ph && ph.missing) subText = '사진이 안 왔어요';
  else if (isCur && camOf(slot) === 'file') subText = '폰에서 직접 찍는 중';
  else if (isCur && S0.step === 'wait') subText = '사진 받는 중…';
  else if (isCur) subText = '카메라 기다리는 중';
  return { text: nameOf(slot), color: colorOf(slot), sub: subText };
}

// ================================================================
// 무대 배치
// ================================================================
function layoutStudio(enter) {
  if (G.phase === 'lobby') { layoutSample(enter); return; }
  if (!S) return;
  const W = innerWidth;
  const H = innerHeight;
  const m = clamp(W * 0.03, 28, 56);
  const sideW = clamp(W * 0.19, 250, 340);
  const resW = clamp(W * 0.27, 320, 460);
  const st = $('studio');
  const n = views.length;
  const asp = S.sheets[0].w / S.sheets[0].h;
  const single = S.mode !== 'each' && G.phase === 'shoot';
  st.classList.toggle('single', single);
  $('side').style.display = G.phase === 'over' ? 'none' : '';
  let area;
  // 다 찍음·결과 화면은 위쪽 가운데에 '준비 n/m' 띠가 뜨므로 그만큼 비워 둡니다.
  const top = G.phase === 'review' || G.phase === 'over' ? Math.max(m * 1.1, 80) : m * 1.1;
  if (G.phase === 'over') area = { x: m, y: top, w: W - resW - m * 2 - 60, h: H - top - m * 1.1 };
  else area = { x: m + sideW + m * 1.2, y: top, w: W - (m + sideW + m * 1.2) - m, h: H - top - m * 1.1 };
  if (G.phase !== 'lobby' && G.phase !== 'over') area.w = Math.max(200, area.w - 120); // 촬영 중에도 오른쪽 위 참가 QR 자리
  if (single) {
    // 왼쪽 띠 + 오른쪽 큰 거울(지금 컷 크게)
    const cut = S.sheets[0].cuts[(S.shots[S.idx] || S.shots[0]).cut];
    const ca = cut.w / cut.h;
    let h = area.h;
    let w = h * asp;
    const gap = 46;
    let mw = area.w - w - gap;
    if (mw < area.w * 0.45) { mw = area.w * 0.45; w = area.w - mw - gap; h = w / asp; }
    views[0].place(area.x, area.y + (area.h - h) / 2, w, h, -1.5, enter);
    // 거울: 안쪽 비율 = 컷 비율, 테두리 24px
    let iw = mw - 48;
    let ih = iw / ca;
    if (ih > area.h * 0.9 - 48) { ih = area.h * 0.9 - 48; iw = ih * ca; }
    const mx = area.x + w + gap + (mw - iw - 48) / 2;
    const my = area.y + (area.h - ih - 48) / 2;
    const wrap = $('mirrorWrap');
    wrap.style.left = `${mx}px`;
    wrap.style.top = `${my}px`;
    wrap.style.width = `${iw + 48}px`;
    wrap.style.height = `${ih + 48}px`;
    const cv = $('mirrorCv');
    const k = DPR();
    if (cv.width !== Math.round(iw * k) || cv.height !== Math.round(ih * k)) { cv.width = Math.round(iw * k); cv.height = Math.round(ih * k); }
    placeBulbs(iw + 48, ih + 48);
    return;
  }
  // 여러 판 나란히(각자 네컷) 또는 한 판 가운데(꾸미기·결과)
  const gap = n > 1 ? clamp(area.w * 0.03, 24, 56) : 0;
  let h = area.h * (n > 1 ? 0.9 : 0.98);
  let w = h * asp;
  if (w * n + gap * (n - 1) > area.w) { w = (area.w - gap * (n - 1)) / n; h = w / asp; }
  const total = w * n + gap * (n - 1);
  const rots = n > 1 ? [-1.6, 1.2, -0.8, 1.6] : [G.phase === 'over' ? -2 : -1];
  views.forEach((v, i) => v.place(area.x + (area.w - total) / 2 + i * (w + gap), area.y + (area.h - h) / 2 + (n > 1 ? 18 : 0), w, h, rots[i % rots.length], enter));
}
let bulbSig = '';
function placeBulbs(w, h) {
  const sig = `${Math.round(w)}x${Math.round(h)}`;
  if (sig === bulbSig) return;
  bulbSig = sig;
  const box = $('bulbs');
  const step = 46;
  const pts = [];
  const nx = Math.max(2, Math.round((w - 24) / step));
  const ny = Math.max(2, Math.round((h - 24) / step));
  for (let i = 0; i <= nx; i++) { const x = 12 + ((w - 24) * i) / nx; pts.push([x, 12]); pts.push([x, h - 12]); }
  for (let j = 1; j < ny; j++) { const y = 12 + ((h - 24) * j) / ny; pts.push([12, y]); pts.push([w - 12, y]); }
  box.innerHTML = pts.map(([x, y]) => `<i style="left:${x}px;top:${y}px"></i>`).join('');
}
window.addEventListener('resize', () => { bulbSig = ''; layoutStudio(false); });

// 거울: 지금 컷을 크게(같은 그리기 코드로 판의 그 부분만)
function drawMirror(t) {
  if (!S || G.phase !== 'shoot' || S.mode === 'each') return;
  const cv = $('mirrorCv');
  const g = cv.getContext('2d');
  const shot = S.shots[S.idx];
  if (!shot) return;
  const sheet = S.sheets[0];
  const cut = sheet.cuts[shot.cut];
  const s = cv.width / cut.w;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, cv.width, cv.height);
  g.setTransform(s, 0, 0, s, -cut.x * s, -cut.y * s);
  const o = studioOpts(sheet);
  o.highlight = null;
  drawSheet(g, sheet, o.theme, o);
}

// ================================================================
// 꾸미기
// ================================================================
function decoOK(d) { return Boolean(G.phase === 'decorate' && S && S.deco && d && SLOT_INFO[Number(d.slot)]); }
function itemsOf(S0, sh) {
  const out = [];
  for (const it of S0.deco.items.values()) if (it.sh === sh) out.push(it);
  return out;
}
function startDecorate() {
  if (G.phase !== 'review' || !S) return;
  S.deco = { items: new Map(), done: new Set(), until: now() + DECO_MS, relay: [], tips: new Map(), bots: new Map(), lastPush: 0, lastSec: null };
  if (!S.bases) S.bases = S.sheets.map((sh) => sheetBase(sh));
  send('msg', { type: 'sheets', session: S.id, sheets: S.bases, left: DECO_MS / 1000 });
  for (const s of S.slots) if ((info.get(s) || {}).bot) S.deco.bots.set(s, { nextAt: now() + 1500 + Math.random() * 1500, n: 0, max: 5 + Math.floor(Math.random() * 3), cur: null });
  setPhase('decorate');
  sfx.cue();
}
function sheetBase(sheet) {
  // 폰이 그 위에 그릴 바탕(꾸미기 없는 완성 판). 작게 줄인 JPEG.
  const k = sheet.kind === 'grid' ? 0.6 : 0.6;
  const c = document.createElement('canvas');
  c.width = Math.round(sheet.w * k);
  c.height = Math.round(sheet.h * k);
  const g = c.getContext('2d');
  g.scale(k, k);
  drawSheet(g, sheet, S.theme, finalOpts(S, sheet));
  return {
    id: sheet.id, owner: sheet.owner, kind: sheet.kind, w: sheet.w, h: sheet.h,
    cuts: sheet.cuts.map((x) => ({ x: x.x, y: x.y, w: x.w, h: x.h })),
    img: c.toDataURL('image/jpeg', 0.82)
  };
}
function sendDecoSync(slot) {
  if (!S || !S.deco || !S.bases) return;
  const items = [...S.deco.items.values()];
  send('msg', { type: 'deco-sync', session: S.id, sheets: S.bases, items, left: Math.max(0, Math.round((S.deco.until - now()) / 1000)), done: S.deco.done.has(slot) }, slot);
}
function relay(op, coalesce) {
  const R = S.deco.relay;
  if (coalesce) {
    const i = R.findIndex((o) => o.id === op.id && o.t === op.t);
    if (i >= 0) { R[i] = op; return; }
  }
  R.push(op);
}
setInterval(() => {
  if (!S || !S.deco || !S.deco.relay.length) return;
  const ops = S.deco.relay.splice(0);
  send('msg', { type: 'deco', session: S.id, ops });
}, 110);

function applyDraw(slot, d) {
  const items = S.deco.items;
  const id = String(d.id || '').slice(0, 40);
  let it = items.get(id);
  if (it && (it.slot !== slot || it.t !== 'draw')) return;
  if (!it) {
    if (items.size >= 2500) return;
    it = cleanItem({ ...d, t: 'draw' }, slot);
    if (!it || !sheetById(it.sh)) return;
    items.set(it.id, it);
  }
  const pts = cleanPoints(d.p, 3000);
  const i = Math.max(0, Math.floor(Number(d.i) || 0));
  if (i * 2 < it.p.length) it.p.length = i * 2; // 같은 조각을 다시 받으면 덮어씀
  if (it.p.length + pts.length > 12000) return;
  for (const v of pts) it.p.push(v);
  if (d.e) it.end = true;
  if (pts.length >= 2) S.deco.tips.set(slot, { sh: it.sh, x: pts[pts.length - 2], y: pts[pts.length - 1], at: now() });
  relay({ t: 'draw', slot, id: it.id, sh: it.sh, c: it.c, w: it.w, b: it.b, i, p: pts, e: d.e ? 1 : 0 });
}
function applySticker(slot, d, live) {
  const items = S.deco.items;
  const id = String(d.id || '').slice(0, 40);
  const had = items.get(id);
  if (had && had.slot !== slot) return;
  if (d.del) { if (had) applyDelete(slot, id); return; }
  const c = cleanItem({ ...d, t: 'stk' }, slot);
  if (!c || !sheetById(c.sh)) return;
  if (had) Object.assign(had, c);
  else {
    if (items.size >= 2500) return;
    items.set(c.id, c);
    sfx.pop();
  }
  relay({ ...c, slot, t: 'stk' }, true);
}
function applyDelete(slot, id) {
  const it = S.deco.items.get(String(id || ''));
  if (!it || it.slot !== slot) return;
  S.deco.items.delete(it.id);
  relay({ t: 'del', slot, id: it.id });
}
function applyClear(slot, sh) {
  for (const [id, it] of S.deco.items) if (it.slot === slot && (sh == null || it.sh === Number(sh))) S.deco.items.delete(id);
  relay({ t: 'clr', slot, sh: sh == null ? null : Number(sh) });
}
function decoPeople() {
  const set = new Set(serverPlayers.filter((p) => p.connected).map((p) => p.slot));
  for (const s of S.slots) if ((info.get(s) || {}).bot) set.add(s);
  return [...set].sort((a, b) => a - b);
}
function checkDecoDone() {
  if (G.phase !== 'decorate' || !S || !S.deco) return;
  const ppl = decoPeople();
  if (ppl.length && ppl.every((s) => S.deco.done.has(s))) finishDeco();
}

// 봇 낙서: 하트·별·물결·반짝이를 실제로 그리듯 조금씩 이어 그리고, 스티커를 붙입니다.
function botShape(kind, cx, cy, r) {
  const pts = [];
  if (kind === 'heart') {
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * Math.PI * 2;
      const x = 16 * Math.pow(Math.sin(t), 3);
      const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      pts.push([cx + (x / 17) * r, cy + (y / 17) * r]);
    }
  } else if (kind === 'star') {
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r;
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  } else if (kind === 'wave') {
    for (let i = 0; i <= 30; i++) pts.push([cx - r * 1.6 + (i / 30) * r * 3.2, cy + Math.sin(i / 3) * r * 0.22]);
  } else {
    // 반짝이 선 세 개
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 4;
      pts.push([cx + Math.cos(a) * r * (0.3 + i / 18), cy + Math.sin(a) * r * (0.3 + i / 18)]);
    }
  }
  return pts;
}
function stepBots(t) {
  if (G.phase !== 'decorate' || !S || !S.deco) return;
  for (const [slot, b] of S.deco.bots) {
    if (b.cur) {
      // 그리던 선을 몇 점씩 이어 보냄
      const c = b.cur;
      const take = c.pts.slice(c.k, c.k + 3);
      if (take.length) {
        const flat = [];
        for (const [x, y] of take) flat.push(Math.round(x), Math.round(y));
        applyDraw(slot, { id: c.id, sh: c.sh, c: c.c, w: c.w, b: c.b, i: c.k, p: flat, e: c.k + take.length >= c.pts.length ? 1 : 0 });
        c.k += take.length;
      }
      if (c.k >= c.pts.length) b.cur = null;
      continue;
    }
    if (t < b.nextAt) continue;
    if (b.n >= b.max) {
      if (!S.deco.done.has(slot)) { S.deco.done.add(slot); renderSide(); pushState(); checkDecoDone(); }
      continue;
    }
    b.n += 1;
    b.nextAt = t + 1100 + Math.random() * 1500;
    const sheet = S.mode === 'each' ? (Math.random() < 0.7 ? S.sheets.find((s) => s.id === slot) : S.sheets[Math.floor(Math.random() * S.sheets.length)]) || S.sheets[0] : S.sheets[0];
    const cut = sheet.cuts[Math.floor(Math.random() * 4)];
    const id = `b${slot}-${Math.floor(t)}-${b.n}`;
    if (Math.random() < 0.5) {
      const st = STICKERS[Math.floor(Math.random() * STICKERS.length)];
      const cx = cut.x + cut.w * (Math.random() < 0.5 ? 0.16 : 0.84);
      const cy = cut.y + cut.h * (Math.random() < 0.5 ? 0.2 : 0.8);
      applySticker(slot, { id, sh: sheet.id, k: st.k, x: Math.round((cx / sheet.w) * Q), y: Math.round((cy / sheet.h) * Q), s: (Math.min(cut.w, cut.h) * (0.3 + Math.random() * 0.12)) / sheet.w, r: (Math.random() - 0.5) * 0.7 }, false);
    } else {
      const kinds = ['heart', 'star', 'wave', 'spark'];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      const r = Math.min(cut.w, cut.h) * (kind === 'wave' ? 0.18 : 0.14);
      const cx = cut.x + cut.w * (0.2 + Math.random() * 0.6);
      const cy = cut.y + cut.h * (kind === 'wave' ? 0.88 : 0.15 + Math.random() * 0.25);
      const pts = botShape(kind, cx, cy, r).map(([x, y]) => [(x / sheet.w) * Q, (y / sheet.h) * Q]);
      b.cur = { id, sh: sheet.id, c: PEN_COLORS[2 + Math.floor(Math.random() * (PEN_COLORS.length - 2))], w: 0.012, b: Math.random() < 0.45 ? 'neon' : 'pen', pts, k: 0 };
    }
  }
}
function botBurst() {
  if (G.phase !== 'decorate' || !S) return;
  for (const b of S.deco.bots.values()) { b.nextAt = 0; b.max += 2; }
}

// ================================================================
// 완성: PNG 만들기 · 임시 올리기
// ================================================================
function finalOpts(S0, sheet) {
  return {
    theme: S0.theme, final: true, date: S0.startedAt, t: 0,
    players: S0.slots.map((s) => ({ color: colorOf(s) })),
    owner: sheet.owner ? { name: nameOf(sheet.owner), color: colorOf(sheet.owner) } : null,
    cell: (ci, sub) => {
      if (sub.slot == null) return null;
      const ph = S0.photos.get(`${sheet.id}:${ci}:${sub.slot}`);
      return ph && ph.img ? { src: ph.baked || ph.img, baked: Boolean(ph.baked) } : null;
    },
    label: (ci, sub) => (sub.slot == null ? null : { text: nameOf(sub.slot), color: colorOf(sub.slot), sub: '' })
  };
}
function renderSheetFull(S0, sheet) {
  const c = document.createElement('canvas');
  c.width = sheet.w;
  c.height = sheet.h;
  const g = c.getContext('2d');
  drawSheet(g, sheet, S0.theme, finalOpts(S0, sheet));
  if (S0.deco) drawItems(g, itemsOf(S0, sheet.id), sheet.w, sheet.h);
  return c;
}
function renderCombined(S0, canvases) {
  // 각자 네컷: 모두의 띠를 한 장에
  const sc = 0.75;
  const sw = 800 * sc;
  const sh = 2400 * sc;
  const pad = 70;
  const head = 170;
  const n = canvases.length;
  const c = document.createElement('canvas');
  c.width = Math.round(pad + n * (sw + pad));
  c.height = Math.round(head + sh + pad);
  const g = c.getContext('2d');
  const th = THEME[S0.theme] || THEMES[0];
  const dark = th.id !== 'white' && th.id !== 'pastel';
  const bg = g.createLinearGradient(0, 0, c.width, c.height);
  bg.addColorStop(0, dark ? '#1f1622' : '#fff4f8');
  bg.addColorStop(1, dark ? '#0f0b12' : '#efe9ff');
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.textAlign = 'left';
  g.fillStyle = dark ? '#ffffff' : '#241a20';
  g.font = `900 64px ${SANS}`;
  g.fillText('우리들의 네컷', pad, 104);
  g.fillStyle = dark ? '#ff8fc2' : '#ff5f9e';
  g.font = `400 34px ${ANTON}`;
  if ('letterSpacing' in g) g.letterSpacing = '6px';
  g.fillText(fmtDate(S0.startedAt), pad + 470, 102);
  g.textAlign = 'right';
  g.fillStyle = dark ? 'rgba(255,255,255,.4)' : 'rgba(36,26,32,.4)';
  g.font = `800 18px ${SANS}`;
  g.fillText('PHONE CONTROLLER GAMES', c.width - pad, 100);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  canvases.forEach((cv, i) => {
    const x = pad + i * (sw + pad);
    g.save();
    g.shadowColor = 'rgba(0,0,0,.35)';
    g.shadowBlur = 30;
    g.shadowOffsetY = 10;
    g.drawImage(cv, x, head, sw, sh);
    g.restore();
  });
  return c;
}
const toBlob = (c) => new Promise((r) => c.toBlob(r, 'image/png'));
function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
async function finishDeco() {
  if (G.phase !== 'decorate' || !S) return;
  const S0 = S;
  if (S0.deco.relay.length) send('msg', { type: 'deco', session: S0.id, ops: S0.deco.relay.splice(0) });
  S0.making = true;
  setPhase('over');
  for (const v of views) { v.el.classList.remove('shine'); void v.el.offsetWidth; v.el.classList.add('shine'); }
  confetti();
  sfx.done();
  renderResult();
  // 완성 연출(판 반짝임·색종이)이 먼저 움직이기 시작한 뒤에 무거운 고해상도 굽기를 합니다.
  await nap(450);
  const base = `네컷-${stamp(S0.startedAt)}`;
  const per = new Map();
  const canv = S0.sheets.map((sh) => renderSheetFull(S0, sh));
  const all = S0.mode === 'each' && canv.length > 1 ? renderCombined(S0, canv) : canv[0];
  const allBlob = await toBlob(all);
  if (S !== S0) return;
  const result = { all: { blob: allBlob, url: URL.createObjectURL(allBlob), name: `${base}.png`, w: all.width, h: all.height }, per };
  if (S0.mode === 'each') {
    for (let i = 0; i < S0.sheets.length; i++) {
      const sh = S0.sheets[i];
      const b = await toBlob(canv[i]);
      per.set(sh.owner, { blob: b, url: URL.createObjectURL(b), name: `${base}-${nameOf(sh.owner)}.png`, w: canv[i].width, h: canv[i].height });
    }
  }
  if (S !== S0) { revoke(result); return; }
  S0.result = result;
  S0.making = false;
  renderResult();
  pushState();
  // 폰에서도 받을 수 있게 서버 메모리에 10분만 올립니다.
  S0.clips = { all: null, mine: {} };
  try {
    const up = await upload(allBlob, 'photo', result.all.name);
    if (S !== S0) return;
    S0.clips.all = { url: up.url, expiresAt: up.expiresAt, name: result.all.name, w: result.all.w, h: result.all.h };
    send('clip', { kind: 'all', ...S0.clips.all });
    for (const [slot, r] of per) {
      if ((info.get(slot) || {}).bot) continue; // 봇 띠는 이 화면에서만 저장(받을 폰이 없음)
      const u = await upload(r.blob, `photo-${slot}`, r.name);
      if (S !== S0) return;
      S0.clips.mine[slot] = { url: u.url, expiresAt: u.expiresAt, name: r.name, w: r.w, h: r.h };
      send('clip', { kind: 'mine', ...S0.clips.mine[slot] }, slot);
    }
    S0.upload = 'ok';
  } catch (e) {
    S0.upload = 'fail';
  }
  renderResult();
  pushState();
}
async function upload(blob, kind, name) {
  if (!roomCode || !roomKey) throw new Error('no room');
  const r = await fetch(`/api/clip?room=${roomCode}&kind=${kind}&name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'content-type': 'image/png', 'x-display-key': roomKey }, body: blob
  });
  if (!r.ok) throw new Error(`upload ${r.status}`);
  return r.json();
}
function revoke(res) {
  if (!res) return;
  try { URL.revokeObjectURL(res.all.url); } catch (e) {}
  for (const r of res.per.values()) { try { URL.revokeObjectURL(r.url); } catch (e) {} }
}
function clearResult() {
  // 다음 판을 시작하거나 처음으로 가면 앞 판 사진·완성본을 바로 지웁니다.
  if (S) { revoke(S.result); S.result = null; S.photos.clear(); S.frozen.clear(); }
}
window.addEventListener('pagehide', () => clearResult());
function renderResult() {
  if (!S || G.phase !== 'over') return;
  renderNext();
  const res = S.result;
  $('rTitle').textContent = S.making ? '만드는 중…' : '완성!';
  $('rSub').textContent = S.making ? '사진을 고해상도로 굽고 있어요.' : S.mode === 'each' ? '모두의 네컷 한 장과 사람마다 한 줄씩 저장할 수 있어요.' : '이 화면에서도, 각자 폰에서도 저장할 수 있어요.';
  const btns = $('rBtns');
  if (!res) { btns.innerHTML = '<a class="r-btn wait">PNG 만드는 중…</a>'; }
  else {
    let html = `<a class="r-btn" id="dlMain" href="${res.all.url}" download="${res.all.name}">PNG 저장<small>${res.all.w}×${res.all.h}</small></a>`;
    for (const [slot, r] of res.per) html += `<a class="r-btn sub" href="${r.url}" download="${r.name}" style="--c:${colorOf(slot)}"><span><b>${nameOf(slot)}</b>네컷만 저장</span><small>${r.w}×${r.h}</small></a>`;
    btns.innerHTML = html;
  }
  const note = $('rNote');
  const box = note.parentElement;
  box.classList.toggle('bad', S.upload === 'fail');
  note.textContent = S.upload === 'fail'
    ? '폰으로는 못 보냈어요. 이 화면에서 저장해 주세요 · 사진은 이 화면 메모리에만 있어요'
    : S.upload === 'ok' ? '폰에도 보냈어요 · 이 화면과 서버 메모리에만 있고 10분 뒤 사라져요'
    : '사진은 이 화면과 서버 메모리에만 있고 10분 뒤 사라져요';
}
function renderNext() {
  const el = document.getElementById('rNext');
  if (!el) return;
  const m = MODE[settings.get('mode')];
  const th = THEME[settings.get('theme')];
  const d = { easy: '쉬움', normal: '보통', hard: '어려움' }[settings.get('difficulty')] || '보통';
  el.innerHTML = `다음 판 <b>${m ? m.short : ''}<kbd>M</kbd></b><b>${th ? th.short : ''}<kbd>T</kbd></b><b>${d}<kbd>D</kbd></b>`;
}
function download() {
  const a = document.getElementById('dlMain');
  if (a) a.click();
}
function confetti() {
  const box = $('confetti');
  box.innerHTML = '';
  const cols = ['#ff6fae', '#ffd27a', '#7ef0c8', '#3ab4ff', '#ffffff', '#b07bff'];
  for (let i = 0; i < 80; i++) {
    const el = document.createElement('i');
    el.style.left = `${Math.random() * 100}%`;
    el.style.background = cols[i % cols.length];
    el.style.setProperty('--d', `${2.2 + Math.random() * 2}s`);
    el.style.setProperty('--x', `${(Math.random() - 0.5) * 300}px`);
    el.style.setProperty('--rot', `${360 + Math.random() * 720}deg`);
    el.style.animationDelay = `${Math.random() * 0.6}s`;
    el.style.width = `${6 + Math.random() * 8}px`;
    el.style.height = `${10 + Math.random() * 10}px`;
    box.appendChild(el);
  }
  setTimeout(() => { box.innerHTML = ''; }, 5200);
}

function backToLobby(msg) {
  clearResult();
  S = null;
  wakeAll();
  setPhase('lobby');
  if (msg) toast(msg);
}

// ================================================================
// 옆 안내판
// ================================================================
let sideSig = '';
function renderSide(popPrompt) {
  if (G.phase === 'lobby' || !S) return;
  const ey = $('sideEyebrow');
  const ti = $('sideTitle');
  const pr = $('sidePrompt');
  const sub = $('sideSub');
  const cnt = $('sideCount');
  const cuts = $('sideCuts');
  const ppl = $('sidePeople');
  const shot = S.shots[S.idx] || S.shots[0];
  const each = S.mode === 'each';
  if (G.phase === 'shoot') {
    ey.textContent = `CUT ${shot.cut + 1} / ${S.shots.length}${S.retry ? ' · 다시' : ''}`;
    if (S.mode === 'together') {
      const s = S.active[0] ?? shot.slots[0];
      ti.innerHTML = `<span class="who" style="--c:${colorOf(s)}">${nameOf(s)}</span>차례!`;
    } else ti.textContent = S.mode === 'pose' ? `미션 ${shot.cut + 1}` : '모두 함께!';
    const p = shot.prompt || {};
    const ptxt = `<span class="em">${p.e || ''}</span><span>${p.text || ''}</span>`;
    if (pr.innerHTML !== ptxt) { pr.innerHTML = ptxt; }
    if (popPrompt) { pr.classList.remove('pop'); void pr.offsetWidth; pr.classList.add('pop'); }
    const files = S.active.filter((s) => camOf(s) === 'file');
    const st = S.step;
    let t;
    if (st === 'intro') t = S.mode === 'pose' ? (p.tip || '폰 화면을 보며 포즈를 잡아요') : '폰 화면을 보며 포즈를 잡아요';
    else if (st === 'count') t = files.length ? `${files.map(nameOf).join('·')}는 폰에서 직접 찍어요` : '큰 화면 거울을 보며 포즈!';
    else if (st === 'wait') t = files.length && S.pending.size ? `${[...S.pending].map(nameOf).join('·')} 사진 기다리는 중…` : '찰칵! 사진 받는 중…';
    else if (st === 'review') {
      const can = S.cfg.retakes > 0;
      t = can ? '마음에 안 들면 폰에서 ‘다시 찍기’\n좋으면 ‘좋아요’' : '잘 나왔어요!';
    } else t = '';
    sub.textContent = t;
    cnt.style.display = each ? '' : 'none';
    cuts.innerHTML = S.shots.map((x, i) => `<i class="${i < S.idx ? 'd' : i === S.idx ? 'c' : ''}"></i>`).join('');
    ppl.innerHTML = S.slots.map((s) => {
      const k = keyOf(S, s, shot.cut);
      const ph = S.photos.get(k);
      const act = S.active.includes(s);
      let em = '';
      let cls = '';
      if (!alive(s)) em = '끊김';
      else if (act && S.step === 'review' && S.retakeReq.has(s)) { em = '다시 찍기'; cls = 'go'; }
      else if (act && S.step === 'review' && S.keep.has(s)) { em = '좋아요 ✓'; cls = 'ok'; }
      else if (ph && ph.img) { em = '찰칵 ✓'; cls = 'ok'; }
      else if (ph && ph.missing) em = '사진 없음';
      else if (act) { em = camOf(s) === 'file' ? '직접 찍는 중' : '포즈!'; cls = 'go'; }
      else em = '기다리는 중';
      return `<div class="pp${alive(s) ? '' : ' away'}" style="--c:${colorOf(s)}"><b>${nameOf(s)}</b><span>${camName(s)}</span><em class="${cls}">${em}</em></div>`;
    }).join('');
    return;
  }
  cnt.style.display = 'none';
  cnt.textContent = '';
  cuts.innerHTML = '';
  if (G.phase === 'review') {
    ey.textContent = 'ALL CUTS';
    ti.textContent = '다 찍었어요!';
    pr.innerHTML = '';
    sub.textContent = '폰에서 모두 준비를 누르면\n다 같이 낙서하고 스티커를 붙여요.';
    const rd = new Set((readySt && readySt.ready) || []);
    ppl.innerHTML = lobbyPlayers().map((p) => {
      const ok = p.bot || rd.has(p.slot);
      return `<div class="pp${p.bot || p.connected ? '' : ' away'}" style="--c:${colorOf(p.slot)}"><b>${nameOf(p.slot)}</b><span>${p.bot ? '봇' : p.connected ? '' : '끊김'}</span><em class="${ok ? 'ok' : ''}">${ok ? '준비 ✓' : '준비 전'}</em></div>`;
    }).join('');
    return;
  }
  if (G.phase === 'decorate') {
    ey.textContent = 'DECORATE';
    ti.textContent = '다 같이 꾸미기';
    pr.innerHTML = '<div class="timer" id="timer"><svg viewBox="0 0 150 150"><circle class="bg" cx="75" cy="75" r="68"/><circle class="fg" id="timerFg" cx="75" cy="75" r="68"/></svg><b id="timerT">90</b></div>';
    sub.textContent = '폰에서 손가락으로 그리고\n스티커를 붙여요. 다 하면 ‘완성’';
    paintTimer(true);
    ppl.innerHTML = decoPeople().map((s) => {
      const ok = S.deco.done.has(s);
      return `<div class="pp" style="--c:${colorOf(s)}"><b>${nameOf(s)}</b><span>${(info.get(s) || {}).bot ? '봇' : ''}</span><em class="${ok ? 'ok' : 'go'}">${ok ? '완성 ✓' : '꾸미는 중'}</em></div>`;
    }).join('');
  }
}
function camName(s) {
  const c = camOf(s);
  return c === 'bot' ? '봇' : c === 'file' ? '직접 찍기' : c === 'fake' ? '시험 카메라' : c === 'live' ? '' : '';
}
function paintTimer(force) {
  if (G.phase !== 'decorate' || !S || !S.deco) return;
  const left = Math.max(0, S.deco.until - now());
  const sec = Math.ceil(left / 1000);
  if (!force && sec === S.deco.lastSec) return;
  S.deco.lastSec = sec;
  const fg = document.getElementById('timerFg');
  const tt = document.getElementById('timerT');
  if (!fg || !tt) return;
  fg.style.strokeDashoffset = String(427 * (1 - left / DECO_MS));
  tt.textContent = String(sec);
  document.getElementById('timer').classList.toggle('low', sec <= 10);
  if (sec <= 5 && sec > 0 && !force) sfx.tick();
}

// ================================================================
// 폰에 알리는 상태
// ================================================================
function pushState() {
  const phase = G.phase === 'shoot' || G.phase === 'decorate' ? 'playing' : G.phase;
  const st = {
    phase,
    sub: G.phase,
    waiting: G.phase === 'lobby' || G.phase === 'review' || G.phase === 'over',
    mode: S && G.phase !== 'lobby' ? S.mode : settings.get('mode'),
    theme: S && G.phase !== 'lobby' ? S.theme : settings.get('theme'),
    diff: S && G.phase !== 'lobby' ? S.diff : settings.get('difficulty'),
    players: lobbyPlayers().map((p) => ({ slot: p.slot, name: p.name, color: p.color, bot: p.bot, connected: p.connected, cam: (info.get(p.slot) || {}).cam || null })),
    settings: settings.forState()
  };
  if (S && G.phase !== 'lobby') {
    const shot = S.shots[S.idx] || S.shots[0];
    st.session = S.id;
    st.slots = S.slots;
    st.total = S.shots.length;
    st.shot = {
      idx: S.idx, cut: shot.cut, slots: shot.slots, active: S.active, step: S.step, prompt: shot.prompt,
      seq: S.seq, aspects: aspectsFor(S, shot, S.slots.filter((s) => subOf(S, s, shot.cut))), retry: Boolean(S.retry),
      cd: S.step === 'count' ? Math.max(0, Math.round(S.shutterAt - now())) : 0
    };
    st.done = S.shots.slice(0, G.phase === 'shoot' ? S.idx : S.shots.length).map((x) => x.cut);
    if (S.deco) {
      st.deco = { left: Math.max(0, Math.round((S.deco.until - now()) / 1000)), done: [...S.deco.done], people: G.phase === 'decorate' ? decoPeople() : [] };
    }
    if (G.phase === 'over') {
      st.making = Boolean(S.making);
      st.clips = S.clips || null;
      st.upload = S.upload || null;
    }
  }
  send('game_state', st);
}

// ================================================================
// 키보드
// ================================================================
let escAt = 0;
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const tg = e.target;
  if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA')) return;
  audio();
  switch (e.code) {
    case 'Enter':
    case 'NumpadEnter':
      if (G.phase === 'lobby' || G.phase === 'over') startSession();
      else if (G.phase === 'review') startDecorate();
      else if (G.phase === 'decorate') finishDeco();
      break;
    case 'Space':
      e.preventDefault();
      if (S && G.phase === 'shoot') { S.skip = true; wakeAll(); }
      break;
    case 'KeyS':
      if (G.phase === 'over') download();
      break;
    case 'KeyB':
      botBurst();
      break;
    case 'Escape':
      if (G.phase === 'over' || G.phase === 'review') backToLobby();
      else if (G.phase === 'shoot' || G.phase === 'decorate') {
        if (now() - escAt < 1600) backToLobby('처음으로 돌아왔어요');
        else { escAt = now(); toast('한 번 더 누르면 처음으로 돌아가요'); }
      }
      break;
    default:
  }
});

let toastT = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), 2600);
}

// ================================================================
// 매 프레임
// ================================================================
let lastDraw = 0;
let lastBot = 0;
function frame() {
  requestAnimationFrame(frame);
  const t = now();
  // 봇 얼굴(살짝 움직임)
  if (t - lastBot > 80) {
    lastBot = t;
    for (const [slot, x] of info) {
      if (!x.bot || !x.cv) continue;
      let pose = 'smile';
      if (S && G.phase === 'shoot') {
        const shot = S.shots[S.idx];
        if (shot && S.active.includes(slot)) pose = shot.prompt.k || 'smile';
      }
      drawAvatar(x.cv.getContext('2d'), x.cv.width, x.cv.height, { slot, t: t / 1000, pose, badge: 'BOT', color: colorOf(slot) });
    }
  }
  // 카운트다운 숫자
  if (S && G.phase === 'shoot') {
    const mc = $('mirrorCount');
    const sc = $('sideCount');
    if (S.step === 'count' && S.shutterAt) {
      const left = S.shutterAt - t;
      const d = Math.max(1, Math.ceil(left / 1000));
      if (d !== S.digit) {
        S.digit = d;
        mc.querySelector('b').textContent = String(d);
        mc.classList.add('on');
        mc.classList.remove('tick');
        void mc.offsetWidth;
        mc.classList.add('tick');
        sc.textContent = String(d);
        sc.classList.remove('tick');
        void sc.offsetWidth;
        sc.classList.add('tick');
        sfx.count(d);
      }
      mc.querySelector('circle').style.strokeDashoffset = String(289 * (1 - ((left % 1000) + 1000) % 1000 / 1000));
      // 전구가 차례로 꺼짐
      const bulbs = $('bulbs').children;
      const frac = clamp(left / S.cfg.count, 0, 1);
      for (let i = 0; i < bulbs.length; i++) bulbs[i].classList.toggle('off', i / bulbs.length > frac);
    } else if (S.digit != null) {
      S.digit = null;
      mc.classList.remove('on');
      sc.textContent = '';
      for (const b of $('bulbs').children) b.classList.remove('off');
    }
  }
  if (G.phase === 'decorate' && S && S.deco) {
    stepBots(t);
    paintTimer(false);
    if (t >= S.deco.until) finishDeco();
    else if (t - S.deco.lastPush > 5000) { S.deco.lastPush = t; pushState(); }
  }
  // 판은 초당 30번
  if (t - lastDraw < 32) return;
  lastDraw = t;
  if (G.phase === 'lobby') { for (const v of sample.views) v.draw(); }
  else {
    for (const v of views) v.draw();
    drawMirror(t);
  }
}

// ================================================================
// 시작
// ================================================================
buildPicks();
renderPicks();
syncPlayers();
setPhase('lobby');
requestAnimationFrame(frame);
new ResizeObserver(() => { if (G.phase === 'lobby') layoutSample(false); }).observe($('sample'));

// 시험용 손잡이
window.__booth = {
  state: () => ({
    phase: G.phase, room: roomCode, mode: S ? S.mode : settings.get('mode'), theme: S ? S.theme : settings.get('theme'), diff: settings.get('difficulty'),
    step: S ? S.step : null, idx: S ? S.idx : null, seq: S ? S.seq : null, slots: S ? S.slots : null,
    photos: S ? [...S.photos.entries()].map(([k, v]) => [k, v.img ? `${v.img.naturalWidth || v.img.width}x${v.img.naturalHeight || v.img.height}` : 'missing']) : [],
    items: S && S.deco ? S.deco.items.size : 0, done: S && S.deco ? [...S.deco.done] : [],
    result: S && S.result ? { w: S.result.all.w, h: S.result.all.h, bytes: S.result.all.blob.size, per: [...S.result.per.keys()] } : null,
    clips: S ? S.clips : null, upload: S ? S.upload : null,
    players: lobbyPlayers().map((p) => ({ slot: p.slot, bot: p.bot, cam: (info.get(p.slot) || {}).cam || null, pv: Boolean(liveSrc(p.slot)) }))
  }),
  start: () => startSession(),
  shootNow: () => { if (S) { S.skip = true; wakeAll(); } },
  toDecorate: () => startDecorate(),
  finish: () => finishDeco(),
  lobby: () => backToLobby(),
  burst: () => botBurst(),
  settings,
  png: () => (S && S.result ? S.result.all.url : null)
};
