// 네컷 사진관 폰: 시작(카메라 허용) → 처음이면 연습 → 대기실(모드·프레임·난이도, 준비) → 촬영(3-2-1 찰칵, 다시 찍기)
// → 다 찍음(준비) → 꾸미기(낙서·스티커) → 완성(저장). 사진은 이 방 큰 화면에만 보내고, 폰에도 메모리에만 둡니다.
//
// 시험: &debug(아래 상태 줄, 튜토리얼 성공 처리 버튼), ?fakecam=1(그림 얼굴 카메라), ?tut=1|0, ?haptics=ios|visual
// PC 처럼 터치가 없는 기기에서 카메라가 안 열리면 저절로 시험 카메라(그림 얼굴)로 바뀝니다.
import { haptics } from '/common/haptics.js';
import { createPhoneSettings } from '/common/phone-settings.js';
import { createTutorial } from '/common/tutorial.js';
import { MODES, MODE, THEMES, THEME, drawSwatch } from '/photobooth/frames.js';
import { drawItems, STICKERS, Q } from '/photobooth/deco.js';
import { createCamera, encode } from './camera.js';
import { createDecorator } from './decorate.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ROOM = (params.get('room') || '').toUpperCase();
const DEBUG = params.has('debug');
const FAKECAM = params.has('fakecam') && params.get('fakecam') !== '0';
const isTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
const now = () => performance.now();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
$('room').textContent = ROOM ? `방 ${ROOM}` : '';

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

let me = null;
let state = { phase: 'lobby' };
let mode = 'start'; // start | msg | tut | wait | shoot | deco
let readySt = null;
let rtt = 120;
let noRoomTries = 0;
let sessionId = null;
const myPhotos = new Map(); // 컷 순번 → 캔버스(이번 판, 메모리에만)
const clips = { all: null, mine: null };
let preview = null; // 다 찍은 판 미리보기 { session, img }
const myColor = () => (me ? me.color : '#ff6fae');

let shown = 'vStart'; // 지금 보이는 화면. mode 와 따로 둡니다(mode 를 먼저 바꿔도 화면이 꼭 바뀌게).
function show(id) {
  shown = id;
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === id);
}
function message(t, b) {
  mode = 'msg';
  $('msgT').textContent = t;
  $('msgB').textContent = b || '';
  show('vMsg');
}
function keepAwake() { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {}); }
let toastT = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), 2200);
}

// ================================================================
// 카메라
// ================================================================
const cam = createCamera({ onChange: () => { paintCam(); sendCam(); } });
function sendCam() {
  if (!me) return;
  const st = cam.state === 'unsupported' ? 'off' : cam.state;
  send('msg', { type: 'cam', state: st });
}
/** 앞 카메라를 켭니다. 안 되면 터치 폰은 '직접 찍기', PC 는 시험 카메라로. */
async function ensureCamera() {
  if (FAKECAM) { cam.useFake(me ? me.slot : 1, myColor()); return true; }
  if (cam.ready()) return true;
  const ok = await cam.start();
  if (ok) return true;
  if (!isTouch) { cam.useFake(me ? me.slot : 1, myColor()); return true; }
  if (cam.state === 'unsupported') cam.useFile();
  return false;
}
function paintCam() {
  const st = cam.state;
  const chip = $('camChip');
  chip.classList.toggle('hidden', !me);
  chip.classList.toggle('on', st === 'live' || st === 'fake');
  $('camChipT').textContent = st === 'live' ? 'LIVE' : st === 'fake' ? '시험 카메라' : st === 'file' ? '직접 찍기' : st === 'asking' ? '허용 기다리는 중' : '카메라 꺼짐';
  const off = $('camOff');
  const live = st === 'live' || st === 'fake';
  off.classList.toggle('hidden', live);
  $('camLive').classList.toggle('hidden', !live);
  if (!live) {
    if (st === 'file') {
      $('camOffT').textContent = '폰 카메라 앱으로 찍어요';
      $('camOffB').textContent = '숫자가 끝나면 ‘지금 찍기’로 직접 찍어요';
      $('btnCam').textContent = '실시간 카메라 다시 켜 보기';
      $('btnFile').classList.add('hidden');
    } else if (st === 'denied') {
      $('camOffT').textContent = '카메라 권한이 막혀 있어요';
      $('camOffB').textContent = '주소창의 카메라 권한을 허용하고 다시 눌러요';
      $('btnCam').textContent = '카메라 다시 켜기';
      $('btnFile').classList.remove('hidden');
    } else if (st === 'asking') {
      $('camOffT').textContent = '카메라 허용을 눌러 주세요';
      $('camOffB').textContent = '폰 화면 위쪽에 물어보는 창이 떠요';
      $('btnCam').textContent = '카메라 켜기';
      $('btnFile').classList.remove('hidden');
    } else {
      $('camOffT').textContent = window.isSecureContext ? '카메라가 꺼져 있어요' : 'http 주소라 실시간 카메라가 안 돼요';
      $('camOffB').textContent = window.isSecureContext ? '셀카를 찍으려면 앞 카메라를 켜요' : '찍을 때 폰 카메라 앱이 열려요';
      $('btnCam').textContent = '카메라 켜기';
      $('btnFile').classList.remove('hidden');
    }
  }
}
$('btnCam').addEventListener('click', async () => {
  haptics.unlock();
  await ensureCamera();
  attachCam();
});
$('btnFile').addEventListener('click', () => { cam.useFile(); toast('찍을 때 폰 카메라 앱이 열려요'); });
$('camChip').addEventListener('click', async () => {
  if (cam.ready()) return;
  await ensureCamera();
  attachCam();
});
// 지금 화면에 맞는 상자로 미리보기를 옮깁니다.
function attachCam() {
  if (tut.isRunning()) return;
  if (mode === 'shoot') cam.attach($('camFrame'));
  else cam.attach($('camBoxWait'));
}

// 큰 화면으로 보내는 실시간 미리보기(작은 JPEG, 초당 몇 장)
function myAspect() {
  if (shoot && shoot.aspect) return shoot.aspect;
  const sh = state.shot;
  if (me && sh && sh.aspects && sh.aspects[me.slot]) return sh.aspects[me.slot];
  return 0.75;
}
function pvPlan() {
  const sub = state.sub || state.phase;
  if (sub === 'lobby') return { fps: tut.isRunning() ? 1.5 : 3, aspect: 0.75, edge: 220 };
  if (sub === 'shoot') {
    const sh = state.shot;
    const active = sh && sh.active && me && sh.active.includes(me.slot);
    if (active && (sh.step === 'intro' || sh.step === 'count')) return { fps: state.mode === 'each' ? 8 : 10, aspect: myAspect(), edge: state.mode === 'each' ? 240 : 360 };
    return { fps: 1, aspect: myAspect(), edge: 200 };
  }
  return null;
}
let pvAt = 0;
let pvSent = 0;
setInterval(() => {
  if (!me || !socket.connected || !cam.ready() || document.hidden) return;
  const p = pvPlan();
  if (!p) return;
  const t = now();
  if (t - pvAt < 1000 / p.fps) return;
  pvAt = t;
  const url = cam.thumb(p.aspect, p.edge, 0.62);
  if (url && send('msg_v', { type: 'pv', img: url, a: p.aspect, fake: cam.state === 'fake' }, true)) pvSent += 1;
}, 40);

// ================================================================
// 설정(난이도는 공통 알약, 모드·프레임은 그림 버튼)
// ================================================================
const ps = createPhoneSettings({ socket });
ps.attach(socket);
ps.mount($('setBox'));
ps.bindReady($('btnGo'), { hint: false });
const MODE_ART = {
  together: '<svg viewBox="0 0 34 40"><rect x="10" y="1" width="14" height="38" rx="1.5" fill="#fbf8f1"/><rect x="12" y="3" width="10" height="7" fill="#ff5a5f"/><rect x="12" y="11.5" width="10" height="7" fill="#3ab4ff"/><rect x="12" y="20" width="10" height="7" fill="#ffc93c"/><rect x="12" y="28.5" width="10" height="7" fill="#5ee07a"/></svg>',
  each: '<svg viewBox="0 0 34 40"><rect x="1" y="3" width="9" height="34" rx="1" fill="#fbf8f1" transform="rotate(-8 5 20)"/><rect x="12.5" y="2" width="9" height="34" rx="1" fill="#fbf8f1"/><rect x="24" y="3" width="9" height="34" rx="1" fill="#fbf8f1" transform="rotate(8 28 20)"/><rect x="14" y="4" width="6" height="6" fill="#3ab4ff"/><rect x="14" y="11.5" width="6" height="6" fill="#3ab4ff"/><rect x="14" y="19" width="6" height="6" fill="#3ab4ff"/><rect x="14" y="26.5" width="6" height="6" fill="#3ab4ff"/></svg>',
  pose: '<svg viewBox="0 0 34 40"><rect x="2" y="3" width="30" height="35" rx="1.5" fill="#fbf8f1"/><rect x="4" y="5" width="12" height="13" fill="#ff5a5f"/><rect x="18" y="5" width="12" height="13" fill="#3ab4ff"/><rect x="4" y="20" width="12" height="13" fill="#ffc93c"/><rect x="18" y="20" width="12" height="13" fill="#5ee07a"/></svg>'
};
$('modeBtns').innerHTML = MODES.map((m) => `<button type="button" class="mode" data-mode="${m.id}">${MODE_ART[m.id]}${m.short}<small>${m.tiny}</small></button>`).join('');
$('themeBtns').innerHTML = THEMES.map((t) => `<button type="button" class="theme" data-theme="${t.id}"><canvas width="78" height="234"></canvas>${t.short}</button>`).join('');
for (const b of document.querySelectorAll('#themeBtns .theme')) drawSwatch(b.querySelector('canvas').getContext('2d'), b.dataset.theme, 'strip', 78, 234);
let pick = {}; // 누르고 화면 확인 전
$('modeBtns').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b || ps.isLocked()) return;
  ps.choose('mode', b.dataset.mode);
  pick.mode = { v: b.dataset.mode, at: now() };
  haptics.tick();
  paintPicks();
});
$('themeBtns').addEventListener('click', (e) => {
  const b = e.target.closest('[data-theme]');
  if (!b || ps.isLocked()) return;
  ps.choose('theme', b.dataset.theme);
  pick.theme = { v: b.dataset.theme, at: now() };
  haptics.tick();
  paintPicks();
});
function curVal(key) {
  const p = pick[key];
  if (p && now() - p.at < 2500 && ps.get(key) !== p.v) return p.v;
  return ps.get(key) || state[key] || (key === 'mode' ? 'together' : 'classic');
}
function paintPicks() {
  const m = curVal('mode');
  const t = curVal('theme');
  const locked = ps.isLocked();
  for (const b of document.querySelectorAll('#modeBtns .mode')) {
    b.classList.toggle('on', b.dataset.mode === m);
    b.classList.toggle('pending', b.dataset.mode === m && pick.mode && pick.mode.v === m && ps.get('mode') !== m);
    b.style.opacity = locked ? '0.5' : '';
  }
  for (const b of document.querySelectorAll('#themeBtns .theme')) {
    b.classList.toggle('on', b.dataset.theme === t);
    b.style.opacity = locked ? '0.5' : '';
  }
}
ps.onChange(() => { paintPicks(); if (mode === 'wait') paintWaitHead(); });

// ================================================================
// 처음 연습(튜토리얼): 카메라 허용 → 포즈 연습 한 장 → 낙서 → 스티커
// ================================================================
const CAM_SVG = '<svg class="pcgt-svg" viewBox="0 0 200 160" aria-hidden="true"><g fill="none" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="62" y="20" width="76" height="128" rx="14" stroke="#fff" stroke-width="3" fill="rgba(255,255,255,.06)"/>' +
  '<circle cx="100" cy="34" r="5" fill="var(--pcgt-c,#ff6fae)" stroke="none"><animate attributeName="opacity" values="1;.3;1" dur="1.2s" repeatCount="indefinite"/></circle>' +
  '<circle cx="100" cy="88" r="20" stroke="var(--pcgt-c,#ff6fae)" stroke-width="3"/><path d="M90 96q10 8 20 0" stroke="var(--pcgt-c,#ff6fae)" stroke-width="3"/>' +
  '<circle cx="93" cy="84" r="2.5" fill="var(--pcgt-c,#ff6fae)" stroke="none"/><circle cx="107" cy="84" r="2.5" fill="var(--pcgt-c,#ff6fae)" stroke="none"/>' +
  '<path d="M100 34 L 60 10 M100 34 L140 10" stroke="rgba(255,255,255,.35)" stroke-width="2" stroke-dasharray="3 5"/></g></svg>';
let tutShot = null; // 연습 사진(이 폰 메모리에만)
let tutItems = [];
function tutBox(stage, aspect, width) {
  stage.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'tstage';
  const box = document.createElement('div');
  box.className = 'tbox';
  const w = Math.min(width, window.innerWidth * 0.74);
  box.style.width = `${w}px`;
  box.style.height = `${w / aspect}px`;
  wrap.appendChild(box);
  stage.appendChild(wrap);
  return { wrap, box, w, h: w / aspect };
}
function tutPad(box, w, h) {
  // 연습용 그림판: 연습 사진 + 그린 것
  const cv = document.createElement('canvas');
  cv.className = 'pad';
  const k = Math.min(3, window.devicePixelRatio || 1);
  cv.width = Math.round(w * k);
  cv.height = Math.round(h * k);
  cv.style.touchAction = 'none';
  box.appendChild(cv);
  const g = cv.getContext('2d');
  const paint = (sel) => {
    g.setTransform(k, 0, 0, k, 0, 0);
    g.fillStyle = '#2a1f2c';
    g.fillRect(0, 0, w, h);
    if (tutShot) {
      const s = Math.max(w / tutShot.width, h / tutShot.height);
      g.drawImage(tutShot, (w - tutShot.width * s) / 2, (h - tutShot.height * s) / 2, tutShot.width * s, tutShot.height * s);
    } else {
      g.fillStyle = '#ffd9ea';
      g.fillRect(0, 0, w, h);
    }
    drawItems(g, tutItems, w, h, { selected: sel, color: myColor() });
  };
  paint();
  return { cv, g, paint };
}
function tutCountdown(box, ms = 3000) {
  return new Promise((res) => {
    const c = document.createElement('div');
    c.className = 'tcount';
    box.appendChild(c);
    const end = now() + ms;
    let last = null;
    const step = () => {
      const left = end - now();
      if (left <= 0) { c.remove(); res(); return; }
      const d = Math.ceil(left / 1000);
      if (d !== last) { last = d; c.textContent = String(d); try { haptics.tick(); } catch (e) {} }
      requestAnimationFrame(step);
    };
    step();
  });
}
function tutFlash(box) {
  const f = document.createElement('div');
  f.className = 'tflash on';
  box.appendChild(f);
  setTimeout(() => f.remove(), 600);
}
const tut = createTutorial({
  key: 'photobooth',
  socket,
  title: '처음이라 연습해 봐요',
  steps: [
    {
      title: '카메라 켜기', body: '셀카는 앞 카메라로 찍어요. 사진은 이 방 큰 화면에만 가요.', svg: CAM_SVG, waitFor: 'camera', hint: '카메라 허용을 눌러요', okText: '카메라 준비 끝!',
      render(stage, api) {
        const { wrap, box } = tutBox(stage, 3 / 4, 120);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tbtn';
        btn.textContent = '카메라 허용하기';
        const alt = document.createElement('button');
        alt.type = 'button';
        alt.className = 'tbtn sub';
        alt.textContent = '카메라 없이 폰 카메라 앱으로 찍을래요';
        const note = document.createElement('div');
        note.className = 'tnote';
        wrap.append(btn, alt, note);
        cam.attach(box);
        if (cam.ready()) { btn.hidden = true; alt.hidden = true; setTimeout(() => api.ok('카메라가 켜져 있어요'), 500); return null; }
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          note.textContent = '폰 화면 위쪽 창에서 허용을 눌러요';
          await ensureCamera();
          btn.disabled = false;
          cam.attach(box);
          if (cam.ready()) { note.textContent = ''; api.ok(cam.state === 'fake' ? '시험 카메라로 할게요' : '카메라가 켜졌어요!'); }
          else { note.textContent = '카메라를 못 켰어요. 찍을 때 폰 카메라 앱으로 직접 찍으면 돼요.'; api.fail('카메라 권한을 확인해 주세요'); }
        });
        alt.addEventListener('click', () => { cam.useFile(); api.ok('폰 카메라 앱으로 찍을게요'); });
        return null;
      }
    },
    {
      title: '포즈 연습 한 장', body: '3초 세고 찰칵! 진짜 촬영도 이렇게 해요.', waitFor: 'snap', hint: '찍어 보기를 눌러요', okText: '잘 나왔어요!',
      render(stage, api) {
        const aspect = 1.37;
        const { wrap, box, w, h } = tutBox(stage, aspect, 280);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tbtn';
        btn.textContent = cam.state === 'file' ? '📷 폰 카메라로 찍어 보기' : '📷 찍어 보기';
        wrap.appendChild(btn);
        cam.attach(box);
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          let c = null;
          if (cam.state === 'file') c = await cam.pickFile(aspect);
          else {
            await tutCountdown(box);
            tutFlash(box);
            try { haptics.play('strong', 1); } catch (e) {}
            c = cam.grab(aspect);
          }
          btn.disabled = false;
          if (!c) { api.fail('사진을 못 찍었어요. 한 번 더!'); return; }
          tutShot = c;
          const snapCv = document.createElement('canvas');
          snapCv.className = 'snap';
          snapCv.width = c.width;
          snapCv.height = c.height;
          snapCv.getContext('2d').drawImage(c, 0, 0);
          box.appendChild(snapCv);
          btn.textContent = '다시 찍기';
          api.signal('snap', { w, h });
        });
        return null;
      }
    },
    {
      title: '낙서해 보기', body: '사진 위에 손가락으로 쓱 그려 봐요.', waitFor: 'doodle', hint: '그려 보세요', okText: '멋져요!',
      render(stage, api) {
        const { box, w, h } = tutBox(stage, 1.37, 280);
        tutItems = [];
        const pad = tutPad(box, w, h);
        let it = null;
        let len = 0;
        let last = null;
        const pos = (e) => { const r = pad.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
        pad.cv.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          try { pad.cv.setPointerCapture(e.pointerId); } catch (err) {}
          const [x, y] = pos(e);
          it = { t: 'draw', id: `t${tutItems.length}`, c: myColor(), w: 0.022, b: tutItems.length % 2 ? 'neon' : 'pen', p: [Math.round((x / w) * Q), Math.round((y / h) * Q)] };
          tutItems.push(it);
          last = [x, y];
          pad.paint();
        });
        pad.cv.addEventListener('pointermove', (e) => {
          if (!it) return;
          const [x, y] = pos(e);
          len += Math.hypot(x - last[0], y - last[1]);
          last = [x, y];
          it.p.push(Math.round((x / w) * Q), Math.round((y / h) * Q));
          pad.paint();
        });
        const end = () => {
          if (!it) return;
          it = null;
          if (len > Math.min(140, w * 0.5)) api.signal('doodle', { len });
          else if (len > 4) api.fail('조금 더 길게 그려 봐요');
        };
        pad.cv.addEventListener('pointerup', end);
        pad.cv.addEventListener('pointercancel', end);
        return null;
      }
    },
    {
      title: '스티커 붙이기', body: '스티커를 누르면 붙어요. 사진 위에서 끌어 옮겨 봐요.', waitFor: 'sticker', hint: '붙이고 끌어 보세요', okText: '완벽해요!',
      render(stage, api) {
        const { wrap, box, w, h } = tutBox(stage, 1.37, 280);
        const pad = tutPad(box, w, h);
        const row = document.createElement('div');
        row.className = 'tstk';
        const picks = ['heart', 'sparkle', 'cool', 'crown', 'party'];
        row.innerHTML = picks.map((k) => `<button type="button" data-k="${k}">${STICKERS.find((s) => s.k === k).e}</button>`).join('');
        wrap.appendChild(row);
        let cur = null;
        let drag = null;
        let moved = 0;
        row.addEventListener('click', (e) => {
          const b = e.target.closest('[data-k]');
          if (!b) return;
          // 첫 스티커는 가운데에(바로 눈에 띄고 끌기 쉽게), 다음부터는 조금씩 비껴서
          const n = tutItems.filter((it) => it.t === 'stk').length;
          const j = () => (n ? (Math.random() - 0.5) * 0.3 : 0);
          cur = { t: 'stk', id: `s${tutItems.length}`, k: b.dataset.k, x: Q * (0.5 + j()), y: Q * (0.5 + j()), s: 0.26, r: n ? (Math.random() - 0.5) * 0.4 : -0.12 };
          tutItems.push(cur);
          try { haptics.tick(); } catch (err) {}
          pad.paint(cur.id);
        });
        const pos = (e) => { const r = pad.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
        pad.cv.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          const [x, y] = pos(e);
          const hit = [...tutItems].reverse().find((it) => it.t === 'stk' && Math.hypot((it.x / Q) * w - x, (it.y / Q) * h - y) < it.s * w * 0.7);
          if (!hit) return;
          try { pad.cv.setPointerCapture(e.pointerId); } catch (err) {}
          cur = hit;
          drag = [x - (hit.x / Q) * w, y - (hit.y / Q) * h];
          pad.paint(cur.id);
        });
        pad.cv.addEventListener('pointermove', (e) => {
          if (!drag || !cur) return;
          const [x, y] = pos(e);
          const nx = ((x - drag[0]) / w) * Q;
          const ny = ((y - drag[1]) / h) * Q;
          moved += Math.hypot(((nx - cur.x) / Q) * w, ((ny - cur.y) / Q) * h);
          cur.x = nx;
          cur.y = ny;
          pad.paint(cur.id);
        });
        const end = () => {
          if (!drag) return;
          drag = null;
          if (moved > 22) api.signal('sticker', { moved });
          else api.fail('스티커를 누른 채로 끌어 봐요');
        };
        pad.cv.addEventListener('pointerup', end);
        pad.cv.addEventListener('pointercancel', end);
        return null;
      }
    }
  ],
  finish: { title: '연습 끝!', body: '이제 준비를 누르면 돼요.\n큰 화면 3-2-1에 맞춰 포즈만 하면 끝!', button: '좋아요' },
  onDone: () => { tutShot = null; tutItems = []; }
});
// 연습이 끝나면 미리보기를 대기실로 되돌립니다.
async function runTutorial() {
  mode = 'tut';
  await tut.run();
  if (mode === 'tut') mode = 'wait';
  if (cam.state === 'off' || cam.state === 'unsupported') await ensureCamera();
  render();
}
// "튜토리얼 다시 하기": 링크가 run() 을 부르기 직전에 대기실을 비우고, 끝나면 돌아옵니다.
tut.link($('tutLink'), {
  before: () => {
    if (mode !== 'wait') return false;
    mode = 'tut';
    const iv = setInterval(() => {
      if (tut.isRunning()) return;
      clearInterval(iv);
      if (mode === 'tut') mode = 'wait';
      attachCam();
      render();
    }, 250);
    return true;
  }
});

// ================================================================
// 촬영
// ================================================================
let shoot = null; // { seq, idx, cut, fireAt, aspect, shooter, captured, prompt, review, digit }
socket.on('countdown', (d) => {
  if (!me || !d) return;
  const mine = Array.isArray(d.shooters) && d.shooters.includes(me.slot);
  const aspect = (d.aspects && d.aspects[me.slot]) || myAspect();
  shoot = {
    seq: d.seq, idx: d.idx, cut: d.cut, total: d.total, aspect, shooter: mine, captured: false, prompt: d.prompt || null, retry: d.retry,
    fireAt: now() + (Number(d.ms) || 3000) - (rtt / 2 + (Number(d.dl) || 40)), digit: null, review: null
  };
  if (cam.state === 'fake' && d.prompt) cam.setPose(d.prompt.k);
  $('freeze').classList.add('hidden');
  render();
  requestAnimationFrame(countLoop);
});
socket.on('shot', (d) => {
  if (shoot && d && shoot.seq === d.seq && shoot.shooter && !shoot.captured) capture();
});
socket.on('result', (d) => {
  if (!shoot || !d || shoot.seq !== d.seq) return;
  shoot.review = { ok: d.ok, retake: d.retake, left: d.left, until: now() + (Number(d.review) || 3000), ms: Number(d.review) || 3000, answered: null };
  paintShootBottom();
  if (d.retake) haptics.tick();
});
function countLoop() {
  if (!shoot || mode !== 'shoot') return;
  const c = $('sCount');
  const left = shoot.fireAt - now();
  if (!shoot.captured && left > 0) {
    const d = Math.max(1, Math.ceil(left / 1000));
    if (d !== shoot.digit) {
      shoot.digit = d;
      c.querySelector('b').textContent = String(d);
      c.classList.add('on');
      c.classList.remove('tick');
      void c.offsetWidth;
      c.classList.add('tick');
      if (shoot.shooter) { try { haptics.tick(); } catch (e) {} }
    }
    requestAnimationFrame(countLoop);
    return;
  }
  c.classList.remove('on');
  if (shoot.shooter && !shoot.captured) capture();
  else if (!shoot.shooter) flash(0.5);
}
function flash(op = 1) {
  const f = $('sFlash');
  f.style.opacity = '';
  f.classList.remove('on');
  void f.offsetWidth;
  if (op < 1) f.style.setProperty('opacity', String(op));
  f.classList.add('on');
}
function showFreeze(c) {
  const fz = $('freeze');
  fz.width = c.width;
  fz.height = c.height;
  fz.getContext('2d').drawImage(c, 0, 0);
  fz.classList.remove('hidden', 'drop');
  void fz.offsetWidth;
  fz.classList.add('drop');
}
function capture() {
  if (!shoot || shoot.captured) return;
  shoot.captured = true;
  $('sCount').classList.remove('on');
  if (cam.state === 'file' || !cam.ready()) {
    // 폰 카메라 앱으로 직접: 탭이 있어야 열리므로 버튼을 띄웁니다.
    try { haptics.play('warn', 0.6); } catch (e) {}
    paintShootBottom();
    return;
  }
  flash();
  try { haptics.play('strong', 1); } catch (e) {}
  const c = cam.grab(shoot.aspect);
  if (!c) { cam.useFile(); paintShootBottom(); return; }
  sendPhoto(c, cam.state === 'fake' ? 'fake' : 'live');
}
function sendPhoto(c, src) {
  showFreeze(c);
  myPhotos.set(shoot.idx, c);
  const url = encode(c);
  shoot.sent = send('photo', { seq: shoot.seq, idx: shoot.idx, cut: shoot.cut, dataUrl: url, w: c.width, h: c.height, src });
  shoot.bytes = Math.round(url.length * 0.75);
  paintShootBottom();
}
$('btnSnapFile').addEventListener('click', async () => {
  if (!shoot) return;
  const sh = shoot;
  const c = await cam.pickFile(sh.aspect);
  if (!c || shoot !== sh) return;
  sendPhoto(c, 'file');
});
$('btnRetake').addEventListener('click', () => {
  if (!shoot || !shoot.review) return;
  send('msg', { type: 'retake', seq: shoot.seq });
  shoot.review.answered = 'retake';
  haptics.tick();
  paintShootBottom();
});
$('btnKeep').addEventListener('click', () => {
  if (!shoot || !shoot.review) return;
  send('msg', { type: 'keep', seq: shoot.seq });
  shoot.review.answered = 'keep';
  haptics.success();
  paintShootBottom();
});
function sizeFrame(aspect) {
  const st = $('sStage').getBoundingClientRect();
  if (!st.width || !st.height) return;
  let w = st.width;
  let h = w / aspect;
  if (h > st.height) { h = st.height; w = h * aspect; }
  const f = $('camFrame');
  f.style.width = `${Math.round(w)}px`;
  f.style.height = `${Math.round(h)}px`;
}
window.addEventListener('resize', () => { if (mode === 'shoot') sizeFrame(myAspect()); });
function paintShoot() {
  const sh = state.shot || {};
  const active = Array.isArray(sh.active) && sh.active.includes(me.slot);
  const total = state.total || 4;
  $('sCut').textContent = `CUT ${(sh.cut ?? 0) + 1}/${total}${sh.retry ? ' · 다시' : ''}`;
  const p = sh.prompt || {};
  let who;
  if (state.mode === 'together') {
    const s = (sh.active && sh.active[0]) ?? (sh.slots && sh.slots[0]);
    who = s === me.slot ? '내 차례!' : `${s}P 차례`;
  } else who = state.mode === 'pose' ? `미션 ${(sh.cut ?? 0) + 1}` : '모두 함께';
  $('sWho').textContent = who;
  const html = `<span class="em">${p.e || ''}</span><span>${p.text || ''}</span>`;
  const pr = $('sPrompt');
  if (pr.dataset.k !== `${state.session}:${sh.idx}`) {
    pr.dataset.k = `${state.session}:${sh.idx}`;
    pr.innerHTML = html;
    pr.classList.remove('pop');
    void pr.offsetWidth;
    pr.classList.add('pop');
  }
  $('camFrame').classList.toggle('watch', !active);
  const fileMode = cam.state === 'file' || !cam.ready();
  $('sNoCam').classList.toggle('hidden', !fileMode);
  $('sLive').classList.toggle('hidden', fileMode || !active || !(sh.step === 'intro' || sh.step === 'count'));
  // 새 컷이 시작되면 멈춘 사진을 치웁니다.
  if (sh.step === 'intro' && (!shoot || shoot.idx !== sh.idx || shoot.seq !== sh.seq)) $('freeze').classList.add('hidden');
  sizeFrame(myAspect());
  paintShootBottom();
}
function paintShootBottom() {
  if (!me) return;
  const sh = state.shot || {};
  const active = Array.isArray(sh.active) && sh.active.includes(me.slot);
  const st = $('sStatus');
  const rv = $('sReview');
  const bar = $('sBar');
  const fileBtn = $('btnSnapFile');
  rv.classList.add('hidden');
  bar.classList.add('hidden');
  fileBtn.classList.add('hidden');
  const mine = shoot && shoot.seq === sh.seq && shoot.shooter;
  if (!active && !mine) {
    const s = sh.active && sh.active[0];
    st.innerHTML = state.mode === 'together' && s ? `지금은 <b>${s}P</b> 차례예요 · 큰 화면을 봐요` : '큰 화면을 봐요';
    return;
  }
  if (mine && shoot.captured && !shoot.sent && (cam.state === 'file' || !cam.ready())) {
    st.innerHTML = '<b>지금 찍어요!</b> 폰 카메라 앱이 열려요';
    fileBtn.classList.remove('hidden');
    return;
  }
  if (mine && shoot.review) {
    const r = shoot.review;
    const left = Math.max(0, r.until - now());
    if (r.answered === 'retake') { st.innerHTML = '<b>다시 찍어요!</b> 곧 숫자를 세요'; return; }
    if (r.answered === 'keep') { st.innerHTML = '<b>좋아요 ✓</b> 다음 컷을 기다려요'; return; }
    if (r.retake && left > 0) {
      st.innerHTML = r.ok ? '어때요? 마음에 안 들면 다시 찍어요' : '사진이 안 갔어요. 다시 찍어요';
      rv.classList.remove('hidden');
      $('btnRetake').innerHTML = `다시 찍기<small>${r.left}번 남음</small>`;
      bar.classList.remove('hidden');
      const i = bar.querySelector('i');
      i.style.transition = 'none';
      i.style.transform = `scaleX(${left / r.ms})`;
      void i.offsetWidth;
      i.style.transition = `transform ${left}ms linear`;
      i.style.transform = 'scaleX(0)';
      return;
    }
    st.innerHTML = r.ok ? '<b>잘 나왔어요!</b> 큰 화면을 봐요' : '사진이 안 갔어요';
    return;
  }
  if (mine && shoot.captured) { st.innerHTML = shoot.sent ? '<b>찰칵!</b> 큰 화면으로 보내는 중…' : '연결을 확인하는 중…'; return; }
  if (sh.step === 'intro') st.innerHTML = state.mode === 'pose' && sh.prompt && sh.prompt.tip ? sh.prompt.tip : '<b>포즈 준비!</b> 곧 3-2-1 세요';
  else if (sh.step === 'count') st.innerHTML = cam.state === 'file' ? '숫자가 끝나면 <b>지금 찍기</b>' : '<b>화면을 보며 포즈!</b>';
  else st.innerHTML = '';
}

// ================================================================
// 꾸미기
// ================================================================
const deco = createDecorator({
  root: $('vDeco'),
  send,
  slot: () => (me ? me.slot : 0),
  color: myColor,
  haptics,
  toast,
  onDone: () => {}
});
let decoSession = null;
let decoAskAt = 0;
function needSheets() {
  if (decoSession === state.session && deco.sheetCount) return;
  if (now() - decoAskAt < 2500) return;
  decoAskAt = now();
  send('msg', { type: 'sync' });
}
socket.on('msg', (d) => {
  if (!d || typeof d !== 'object') return;
  if (d.type === 'sheets') {
    if (decoSession !== d.session) deco.reset();
    decoSession = d.session;
    deco.loadSheets(d.sheets, d.session);
    if (d.left != null) deco.setLeft(d.left);
    // 다 찍은 판: 내 판(각자 네컷) 또는 하나뿐인 판을 대기 화면에 크게
    const list = Array.isArray(d.sheets) ? d.sheets : [];
    const mine = list.find((x) => me && Number(x.owner) === me.slot) || list[0];
    preview = mine && typeof mine.img === 'string' && mine.img.startsWith('data:image/') ? { session: d.session, img: mine.img } : null;
    if (mode === 'wait') paintWait(state.sub || state.phase);
  } else if (d.type === 'deco') {
    if (d.session === decoSession) deco.applyOps(d.ops);
  } else if (d.type === 'deco-sync') {
    if (decoSession !== d.session) deco.reset();
    decoSession = d.session;
    deco.loadSheets(d.sheets, d.session);
    deco.sync(d.items);
    deco.setLeft(d.left);
    deco.setDone(Boolean(d.done));
  }
});

// ================================================================
// 결과: 저장
// ================================================================
const files = new Map(); // url → File
function prefetch(c) {
  if (!c || !c.url || files.has(c.url)) return;
  files.set(c.url, null);
  fetch(c.url).then((r) => (r.ok ? r.blob() : null)).then((b) => {
    if (b) files.set(c.url, new File([b], c.name || '네컷.png', { type: b.type || 'image/png' }));
  }).catch(() => {});
}
async function save(c) {
  if (!c) return;
  const f = files.get(c.url);
  // iPhone 은 공유 시트의 '이미지 저장'이 사진 앱으로 바로 갑니다.
  if (f && haptics.isIOS && navigator.canShare && navigator.canShare({ files: [f] })) {
    try { await navigator.share({ files: [f], title: '네컷 사진관' }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  const href = f ? URL.createObjectURL(f) : c.url;
  a.href = href;
  a.download = c.name || '네컷.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (f) setTimeout(() => URL.revokeObjectURL(href), 10000);
  toast('저장했어요');
}
$('btnSaveAll').addEventListener('click', () => save(clips.all));
$('btnSaveMine').addEventListener('click', () => save(clips.mine));
socket.on('clip', (c) => {
  if (!c || !c.url) return;
  if (c.kind === 'mine') clips.mine = c; else clips.all = c;
  prefetch(c);
  haptics.success();
  if (mode === 'wait') paintFinal();
});

// ================================================================
// 화면 그리기
// ================================================================
function isParticipant() { return Boolean(me && Array.isArray(state.slots) && state.slots.includes(me.slot)); }
function render() {
  if (!me || mode === 'start' || mode === 'msg' || mode === 'tut') return;
  const sub = state.sub || state.phase;
  tut.setLinkVisible(sub === 'lobby');
  if (sub === 'shoot' && isParticipant()) {
    mode = 'shoot';
    if (shown !== 'vShoot') { show('vShoot'); deco.hide(); }
    attachCam();
    paintShoot();
    return;
  }
  if (sub === 'decorate') {
    mode = 'deco';
    if (shown !== 'vDeco') { show('vDeco'); deco.show(); }
    needSheets();
    if (state.deco) { deco.setLeft(state.deco.left); deco.setPeople(state.deco.people, state.deco.done); }
    return;
  }
  mode = 'wait';
  if (shown !== 'vWait') { show('vWait'); deco.hide(); }
  attachCam();
  paintWait(sub);
}
function modeName(m) { return (MODE[m] || MODE.together).short; }
function paintWaitHead() {
  const sub = state.sub || state.phase;
  if (sub === 'lobby') $('wSub').textContent = `${modeName(curVal('mode'))} · ${(THEME[curVal('theme')] || THEME.classic).short}`;
}
function paintWait(sub) {
  const lobby = sub === 'lobby';
  const review = sub === 'review';
  const over = sub === 'over';
  const busy = sub === 'shoot';
  $('wTitle').textContent = lobby ? '대기실' : review ? '다 찍었어요!' : over ? '완성!' : '촬영 중';
  $('wSub').textContent = review ? '모두 준비하면 다 같이 꾸며요' : over ? '저장하고, 한 번 더 찍어도 돼요' : busy ? '이번 판이 끝나면 함께해요' : '';
  if (lobby) paintWaitHead();
  $('camCard').classList.toggle('hidden', !(lobby || busy));
  $('opts').classList.toggle('hidden', !(lobby || over));
  const pv = review && preview && preview.session === state.session ? preview : null;
  $('rSheet').classList.toggle('hidden', !pv);
  if (pv && $('rSheetImg').getAttribute('src') !== pv.img) $('rSheetImg').src = pv.img;
  $('myShots').classList.toggle('hidden', !review || Boolean(pv));
  $('final').classList.toggle('hidden', !over);
  if (review && !pv) paintShots();
  if (over) paintFinal();
  paintPicks();
  paintPeople();
  const go = $('btnGo');
  const mine = readySt && readySt.ready && readySt.ready.includes(me.slot);
  go.classList.toggle('hidden', busy);
  go.classList.toggle('done', Boolean(mine));
  go.textContent = mine ? '준비 완료 ✓ · 기다리는 중' : review ? '꾸미러 가기' : over ? '한 번 더 찍기' : '준비';
}
function paintShots() {
  const box = $('myShots');
  const total = state.total || 4;
  const key = `${state.session}:${[...myPhotos.keys()].join(',')}`;
  if (box.dataset.k === key) return;
  box.dataset.k = key;
  box.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const c = myPhotos.get(i);
    const d = document.createElement('div');
    if (c) {
      const cv = document.createElement('canvas');
      cv.width = c.width;
      cv.height = c.height;
      cv.getContext('2d').drawImage(c, 0, 0);
      d.appendChild(cv);
      d.insertAdjacentHTML('beforeend', `<em>${i + 1}</em>`);
    } else {
      d.className = 'none';
      d.textContent = state.mode === 'together' ? `${i + 1}컷 · 다른 사람` : `${i + 1}컷`;
    }
    box.appendChild(d);
  }
}
function paintFinal() {
  const c = clips.mine || clips.all;
  const img = $('finalImg');
  const making = !c;
  $('finalWait').classList.toggle('hidden', !making);
  $('finalWait').querySelector('span').textContent = state.upload === 'fail' ? '폰으로는 못 받았어요 · 큰 화면에서 저장해요' : '큰 화면에서 굽는 중…';
  if (c && img.getAttribute('src') !== c.url) img.src = c.url;
  if (!c) img.removeAttribute('src');
  $('btnSaveMine').hidden = !clips.mine;
  $('btnSaveAll').textContent = clips.mine ? '다 같이 저장' : '사진 저장';
  $('btnSaveAll').classList.toggle('sub', Boolean(clips.mine));
  $('btnSaveAll').disabled = !clips.all;
  const exp = (c && c.expiresAt) || 0;
  const mins = exp ? Math.max(1, Math.round((exp - Date.now()) / 60000)) : 10;
  $('finalNote').textContent = `${mins}분 뒤 사라져요 · 사진을 길게 눌러도 저장돼요`;
}
function paintPeople() {
  const list = (state.players || []).filter((p) => p.connected || p.bot);
  const rd = new Set((readySt && readySt.ready) || []);
  const sub = state.sub || state.phase;
  const showReady = sub === 'lobby' || sub === 'review' || sub === 'over';
  $('people').innerHTML = list.map((p) => {
    const ok = p.bot || rd.has(p.slot);
    const label = !showReady ? '' : ok ? '준비 ✓' : '준비 전';
    return `<span class="${ok && showReady ? 'ok' : ''}" style="--pc:${p.color}"><b>${p.name}</b>${p.slot === me.slot ? '나 · ' : ''}${label}</span>`;
  }).join('');
}

// ================================================================
// 소켓
// ================================================================
socket.on('connect', () => socket.emit('join', { role: 'controller', room: ROOM, token }));
socket.on('assigned', (p) => {
  if (p.game !== 'photobooth') {
    location.replace(p.game === 'baseball' ? `/play/?room=${ROOM}` : `/play/${p.game}/?room=${ROOM}`);
    return;
  }
  me = p;
  noRoomTries = 0;
  document.documentElement.style.setProperty('--c', p.color);
  tut.setColor(p.color);
  $('me').textContent = p.name;
  if (cam.state === 'fake') cam.useFake(p.slot, p.color);
  if (mode === 'msg' || mode === 'start') mode = 'wait';
  paintCam();
  sendCam();
  render();
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
socket.on('display_status', (d) => {
  const b = $('banner');
  b.textContent = '큰 화면 연결이 끊겼어요. 다시 열리면 이어서 해요.';
  b.classList.toggle('hidden', Boolean(d && d.connected));
});
socket.on('ready_state', (st) => { readySt = st; if (mode === 'wait') paintWait(state.sub || state.phase); });
socket.on('game_state', (s) => {
  const prev = state;
  state = s || { phase: 'lobby' };
  if (state.session !== sessionId) {
    // 새 판(또는 처음으로): 앞 판 사진·완성본을 이 폰에서도 지웁니다.
    sessionId = state.session;
    myPhotos.clear();
    preview = null;
    $('rSheetImg').removeAttribute('src');
    clips.all = null;
    clips.mine = null;
    files.clear();
    shoot = null;
    $('finalImg').removeAttribute('src');
    $('myShots').dataset.k = '';
  }
  if (state.clips) {
    if (state.clips.all && !clips.all) { clips.all = state.clips.all; prefetch(clips.all); }
    const m = me && state.clips.mine && state.clips.mine[me.slot];
    if (m && !clips.mine) { clips.mine = m; prefetch(m); }
  }
  // 촬영 단계가 바뀌면(다음 컷 소개) 이전 카운트다운 정보를 정리합니다.
  if (state.shot && shoot && state.shot.seq !== shoot.seq && state.shot.step === 'intro') shoot = null;
  if (mode === 'msg' && !me) return;
  render();
  if (prev.sub !== state.sub && state.sub === 'review') haptics.success();
});
haptics.listen(socket, { slot: () => (me ? me.slot : null) });
setInterval(() => {
  if (!socket.connected) return;
  const t0 = now();
  socket.timeout(2000).emit('ping_rtt', t0, (err) => { if (!err) rtt = rtt * 0.6 + (now() - t0) * 0.4; });
}, 2000);

// ================================================================
// 버튼
// ================================================================
$('btnStart').addEventListener('click', async () => {
  // 화면 꺼짐 방지·소리는 탭 안에서 await 전에 바로.
  keepAwake();
  haptics.unlock();
  if (!ROOM) { message('방 코드가 없어요', '큰 화면의 QR을 찍어 주세요.'); return; }
  message('들어가는 중…', '큰 화면과 연결하고 있어요.');
  socket.connect();
  if (tut.firstTime()) {
    await runTutorial();
    return;
  }
  await ensureCamera();
  if (mode === 'msg' && me) mode = 'wait';
  render();
});
$('btnGo').addEventListener('click', async () => {
  keepAwake();
  haptics.unlock();
  const mine = readySt && readySt.ready && readySt.ready.includes(me && me.slot);
  if (mine) { toast('다른 사람을 기다리는 중이에요'); return; }
  const sub = state.sub || state.phase;
  if (sub === 'lobby' && !cam.ready() && cam.state !== 'file') await ensureCamera();
  send('start_game', {});
  haptics.tick();
  attachCam();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && mode !== 'start') keepAwake(); });
if (!window.isSecureContext) {
  const b = $('banner');
  b.textContent = 'http 주소라 실시간 카메라가 안 될 수 있어요. 찍을 때 폰 카메라 앱으로 찍어요.';
  b.classList.remove('hidden');
  setTimeout(() => b.classList.add('hidden'), 7000);
}
paintCam();
paintPicks();

// ---------- 디버그 (&debug) ----------
if (DEBUG) {
  let last = 0;
  setInterval(() => {
    $('debug').textContent = `pv ${(pvSent - last) * 2}/s · cam ${cam.state} · ${socket.connected ? 'on' : 'off'} · ${state.sub || state.phase}/${state.shot ? state.shot.step : '-'} · rtt ${Math.round(rtt)}`;
    last = pvSent;
  }, 500);
}
window.__boothPhone = {
  state: () => ({ mode, me, cam: cam.state, phase: state.sub || state.phase, shoot: shoot && { seq: shoot.seq, idx: shoot.idx, captured: shoot.captured, sent: shoot.sent, bytes: shoot.bytes, review: Boolean(shoot.review) }, photos: [...myPhotos.keys()], clips, decoSheets: deco.sheetCount, ready: readySt }),
  cam,
  deco,
  tut,
  ensureCamera,
  retake: () => $('btnRetake').click(),
  keep: () => $('btnKeep').click(),
  ready: () => $('btnGo').click()
};
