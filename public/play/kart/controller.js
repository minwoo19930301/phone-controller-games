// 카트 컨트롤러. 폰을 가로로 세워 핸들처럼 기울이고(roll), 왼쪽 브레이크를 씁니다. 가운데 어디든 누르면 아이템을 씁니다.
// 쉬움·보통은 액셀을 저절로 밟고(큰 화면 game.js 가 정함) 오른쪽 큰 버튼이 아이템(스피드전이면 브레이크)입니다. 어려움만 오른쪽이 액셀입니다.
// 핸들 영점은 맞추기 화면 없이 처음 가로로 가만히 쥔 자세로 저절로 잡습니다(준비 누를 때·카운트다운·경기 중). '다시 맞추기'는 선택입니다.
//
// 핸들 각도: deviceorientation 의 beta/gamma 로 "세계의 위쪽" 벡터를 폰 화면 평면(x 오른쪽, y 위)에 옮기고, 그 벡터의 회전각을 영점에 대해 잽니다.
// beta/gamma 는 폰 몸체 기준 값이라 화면이 돌아가도(자동 회전) 바뀌지 않습니다. 그래서 화면 방향은 핸들 계산에 전혀 쓰지 않습니다.
// 핸들을 오른쪽(시계 방향)으로 돌리면 +, 왼쪽이면 -. drive { steer(-1..1), gas(0/1), brake(0/1) } 를 30Hz 로 보냅니다(밀리면 버려도 되는 이벤트).
//
// 화면 배치: 화면 회전 잠금이 켜져 있어도 되게, 화면(viewport) 방향이 아니라 폰을 실제로 쥔 방향(중력)으로 정합니다.
// - 영점을 맞출 때 어느 긴 모서리가 아래인지(hold) 정하고, 화면이 세로로 잠겨 있으면 무대(#stage)를 CSS 로 90° 돌려
//   브레이크가 왼쪽 엄지, 액셀이 오른쪽 엄지 아래에 오게 합니다. 화면이 가로면 돌릴 필요가 없습니다.
// - 경기 중에는 배치를 고정합니다. 핸들을 90° 넘게 꺾다가 OS 가 화면을 돌려도 무대를 다시 돌려서 버튼은 손가락 밑에 그대로 있고,
//   핸들 영점은 건드리지 않습니다.
// - 버튼은 요소 자체의 이벤트로 받고, 슬라이더는 무대 회전을 되돌려 계산하므로 돌린 무대에서도 손가락 위치가 맞습니다.
import { haptics } from '/common/haptics.js';
import { createPhoneSettings } from '/common/phone-settings.js';
import { createTutorial } from '/common/tutorial.js';
import { createSamples } from '/common/samples.js';
import { SFX } from '/common/sfx/manifest.js';
import { ITEM_ICONS, ITEM_NAMES, CHASE_ICON } from '/kart/icons.js';
import { t, mountSwitcher } from '/common/i18n.js';
import '/kart/i18n.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ROOM = (params.get('room') || '').toUpperCase();
const DEBUG = params.has('debug');

let token = null;
try { token = localStorage.getItem('pcg-token'); } catch (e) {}
if (!token) {
  token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try { localStorage.setItem('pcg-token', token); } catch (e) {}
}

const socket = io({ autoConnect: false, transports: ['websocket', 'polling'], tryAllTransports: true });
// 끊긴 동안 보낸 이벤트는 다시 붙을 때 join 보다 먼저 흘러가 버려지므로, 끊겨 있으면 보내지 않습니다.
function send(event, data, volatile) {
  if (!socket.connected) return false;
  (volatile ? socket.volatile : socket).emit('c2d', { event, data });
  return true;
}

let me = null;
let state = { phase: 'lobby' };
let result = null;
let mode = 'start'; // start | connecting | msg | wait | tut | play
let noRoomTries = 0;
let readyPressed = false;

function show(id) {
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === id);
  applyLayout();
}
function message(t, b) {
  mode = 'msg';
  $('msgT').textContent = t;
  $('msgB').textContent = b || '';
  show('vMsg');
}
function keepAwake() {
  if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
}

// ---------- 공통 모듈: 설정·튜토리얼·진동 ----------
const ps = createPhoneSettings();
ps.attach(socket);
ps.mount($('setBox'));
ps.bindReady($('btnReady'));
haptics.listen(socket, { slot: () => (me ? me.slot : null) });

// ---------- 소리 ----------
let actx = null;
let samp = null; // 녹음 샘플(폰은 즉각 피드백용 딱 3개: 신호음·클릭·부딪힘)
function audio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      actx = new AC();
      const sub = {};
      for (const n of ['ui/beep', 'ui/click', 'kart/crash-2']) sub[n] = SFX[n];
      samp = createSamples(actx, null, { manifest: sub });
      samp.preload();
    }
  }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
// 녹음을 틀고, 아직 못 받았으면 false → 예전 합성음
const rec = (name, opts) => Boolean(samp && actx && actx.state === 'running' && samp.play(name, opts));
function tone(freq, sec, gain, type = 'sine', when = 0) {
  const a = actx;
  if (!a || a.state !== 'running') return;
  const t = a.currentTime + when;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + sec + 0.02);
}

// ---------- 핸들 센서 ----------
const TAU = Math.PI * 2;
const wrap = (a) => {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
};
const wrapDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// 난이도별 핸들 감도: range = 이만큼 돌리면 끝까지 꺾음(도), dead = 이 안은 직진(도), exp = 반응 곡선. 어려움 = 예전 값
const STEER = {
  easy: { range: 22, dead: 4, exp: 1 },
  normal: { range: 30, dead: 3.5, exp: 1.1 },
  hard: { range: 38, dead: 2.5, exp: 1.2 }
};
const steerCfg = () => STEER[ps.difficulty()] || STEER.easy;
let ang = 0; // 지금 위쪽 벡터의 각도
let upLen = 0; // 위쪽 벡터가 화면 평면에 얼마나 누워 있는지(0 = 폰이 바닥에 눕혀짐, 1 = 똑바로 섬)
let flat = true; // 폰이 눕혀져 있어 각도를 믿을 수 없음
let zero = null; // 영점 각도(null 이면 아직 안 맞춤)
const recent = []; // 최근 각도(영점용)
let gotSensor = false;
let fallback = false;
let oriCount = 0;
let steerSmooth = 0;
let steerDeg = 0;
let slideVal = 0; // 센서가 없을 때 화면에서 민 값
const keys = { left: false, right: false, up: false, down: false };

function onOrientation(e) {
  if (e.beta == null || e.gamma == null) return;
  gotSensor = true;
  if (fallback) { fallback = false; $('mid').classList.remove('fallback'); } // 늦게라도 센서 값이 오면 슬라이더를 끕니다
  oriCount++;
  const b = (e.beta * Math.PI) / 180;
  const g = (e.gamma * Math.PI) / 180;
  // 세계 위쪽을 폰 좌표(x 오른쪽, y 화면 위)로 본 값
  const ux = -Math.sin(g) * Math.cos(b);
  const uy = Math.sin(b);
  upLen = Math.hypot(ux, uy);
  flat = upLen < 0.33; // 거의 눕혀진 상태(20° 안쪽)
  if (flat) return;
  ang = Math.atan2(uy, ux);
  recent.push(ang);
  if (recent.length > 10) recent.shift();
  trackHold();
}
function circMean(list) {
  let s = 0;
  let c = 0;
  for (const a of list) { s += Math.sin(a); c += Math.cos(a); }
  return Math.atan2(s, c);
}
function setZero() {
  if (!recent.length) return false;
  zero = circMean(recent);
  holdCal = quantHold((zero * 180) / Math.PI);
  checkAngleSense();
  applyLayout();
  send('calibrate', {});
  return true;
}

// 맞추기 화면 없이 영점 잡기: 폰을 가로로 세워 가만히 쥔 순간(최근 각도가 거의 안 흔들림)의 자세를 직진으로 삼습니다.
function stillSideways() {
  if (!gotSensor || flat || upLen < 0.5 || !sideways(holdLive) || recent.length < 8) return false;
  const m = circMean(recent);
  return recent.every((a) => Math.abs(wrap(a - m)) < 0.1);
}
function autoZero() {
  if (zero != null || fallback || !stillSideways()) return;
  if (!setZero()) return;
  if (mode === 'play') { holdRace = holdLive; applyLayout(); }
}

/** 지금 핸들 값(-1..1). 키보드 → 화면 슬라이더 → 센서 순. */
function readSteer() {
  let target = 0;
  const cfg = steerCfg();
  const kb = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  if (kb) {
    target = kb;
    steerDeg = kb * cfg.range;
  } else if (fallback) {
    target = slideVal;
    steerDeg = slideVal * cfg.range;
  } else if (gotSensor && zero != null) {
    if (!flat) {
      const deg = (wrap(ang - zero) * 180) / Math.PI;
      steerDeg = clamp(deg, -70, 70);
    }
    const a = Math.abs(steerDeg);
    const x = clamp((a - cfg.dead) / (cfg.range - cfg.dead), 0, 1);
    target = Math.sign(steerDeg) * Math.pow(x, cfg.exp);
  } else {
    steerDeg = 0;
  }
  steerSmooth += (target - steerSmooth) * 0.55;
  if (Math.abs(steerSmooth) < 0.005) steerSmooth = 0;
  return steerSmooth;
}

// ================================================================
// 쥔 방향 → 무대 배치
// ================================================================
// hold: 0 = 세로로 똑바로, 90 = 폰 위쪽(스피커)이 왼쪽, -90 = 위쪽이 오른쪽, 180 = 거꾸로. 폰 몸체 기준(화면 회전과 무관).
const quantHold = (angDeg) => {
  const q = Math.round((90 - angDeg) / 90) * 90;
  const n = wrapDeg(q);
  return n === -180 ? 180 : n;
};
let holdLive = null; // 지금 쥔 방향(경기 밖에서는 이걸로 배치)
let holdCal = null; // 영점 맞출 때의 방향
let holdRace = null; // 경기 중 고정한 방향
let racePinned = false; // 출발(GO) 뒤 배치를 고정했는지
let flipSince = 0;
let cand = null;
let candSince = 0;
let fakeAngle = null; // 시험용 화면 각도
let angleFlip = false; // 이 기기의 화면 각도 부호가 반대로 보고되면 true(가로 화면에서 스스로 맞춤)
let curRot = 0;
let layoutKey = '';

function trackHold() {
  // 30° 넘게 세워 들었을 때만 방향을 믿습니다. 한 방향에 0.32초 머물러야 바꿉니다(흔들림 무시).
  if (upLen < 0.5) return;
  const deg = (ang * 180) / Math.PI;
  const q = quantHold(deg);
  const off = Math.abs(wrapDeg(90 - deg - q));
  const now = performance.now();
  if (holdLive == null) { holdLive = q; applyLayout(); return; }
  if (q === holdLive) { cand = null; return; }
  if (off > 36) return;
  if (cand !== q) { cand = q; candSince = now; return; }
  if (now - candSince > 320) {
    holdLive = q;
    cand = null;
    applyLayout();
  }
}
setInterval(() => { autoZero(); checkFlip(); checkLateGrip(); playHints(); }, 100);
function rawScreenAngle() {
  if (fakeAngle != null) return fakeAngle;
  const so = screen.orientation;
  if (so && typeof so.angle === 'number') return so.angle;
  if (typeof window.orientation === 'number') return (window.orientation + 360) % 360;
  return 0;
}
function screenAngle() {
  const a = ((rawScreenAngle() % 360) + 360) % 360;
  return angleFlip ? (360 - a) % 360 : a;
}
// 가로 화면에서 폰을 가만히 쥐고 있으면 OS 가 중력에 맞춰 화면을 돌린 상태라 무대 회전은 0 이어야 합니다.
// 180° 가 나오면 이 기기는 화면 각도 부호를 반대로 보고하는 것이라 뒤집어 씁니다.
function checkAngleSense() {
  if (holdLive == null || innerWidth <= innerHeight) return;
  const a = ((rawScreenAngle() % 360) + 360) % 360;
  if (a !== 90 && a !== 270) return;
  const d = Math.abs(wrapDeg(holdLive - (angleFlip ? 360 - a : a)));
  if (d === 180) angleFlip = !angleFlip;
}
function effectiveHold() {
  if ((mode === 'play' || racePinned) && holdRace != null) return holdRace;
  return holdLive;
}
// 화면의 안전 영역(노치) 크기를 재 둡니다.
const probe = document.createElement('div');
probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
  'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
document.body.appendChild(probe);
function insets() {
  const cs = getComputedStyle(probe);
  return { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
}
function applyLayout() {
  const stage = $('stage');
  const H = effectiveHold();
  const A = screenAngle();
  let D = H == null ? 0 : wrapDeg(H - A);
  if (D === -180) D = 180;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const side = Math.abs(D) === 90;
  const w = side ? vh : vw;
  const h = side ? vw : vh;
  const key = `${D}|${w}|${h}`;
  if (key === layoutKey) return;
  // 경기 밖에서 방향이 바뀌면 부드럽게 돌리고, 경기 중(OS 회전을 되돌릴 때)에는 바로 맞춥니다.
  stage.classList.toggle('anim', mode !== 'play' && layoutKey !== '' && D !== curRot);
  layoutKey = key;
  curRot = D;
  stage.style.width = `${w}px`;
  stage.style.height = `${h}px`;
  stage.style.transform = `translate(-50%, -50%) rotate(${D}deg)`;
  stage.classList.toggle('land', w > h);
  stage.classList.toggle('port', w <= h);
  stage.style.setProperty('--sw', `${w}px`);
  stage.style.setProperty('--sh', `${h}px`);
  // 안전 영역: 무대의 각 변이 화면의 어느 변에 닿는지 따라 옮깁니다.
  const s = insets();
  const map = D === 90 ? [s.r, s.b, s.l, s.t] : D === -90 ? [s.l, s.t, s.r, s.b] : D === 180 ? [s.b, s.l, s.t, s.r] : [s.t, s.r, s.b, s.l];
  stage.style.setProperty('--sat', `${map[0]}px`);
  stage.style.setProperty('--sar', `${map[1]}px`);
  stage.style.setProperty('--sab', `${map[2]}px`);
  stage.style.setProperty('--sal', `${map[3]}px`);
}
window.addEventListener('resize', () => applyLayout());
if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', () => applyLayout());
else window.addEventListener('orientationchange', () => setTimeout(applyLayout, 50));

// 경기 직전(카운트다운)에 배치를 정합니다. 영점 맞춘 방향과 지금 가로로 쥔 방향이 다르면(예: 반대쪽으로 바꿔 쥠)
// 지금 자세를 새 영점·방향으로 삼고, 출발(GO) 순간 고정합니다. 세로로 들고 화면을 보고 있는 자세는 영점으로 삼지 않습니다.
const sideways = (h) => h === 90 || h === -90;
function alignForRace(final) {
  const live = holdLive;
  const liveOk = live != null && !flat && upLen >= 0.5 && recent.length;
  if (liveOk && live !== holdCal && sideways(live)) {
    zero = circMean(recent);
    holdCal = live;
    send('calibrate', {});
  }
  holdRace = holdCal != null ? holdCal : live;
  if (final) { racePinned = true; goAt = performance.now(); lateGrip = false; }
  applyLayout();
}
// 출발할 때 폰을 세로로 세워 보고 있었다면(영점이 세로 자세), 출발 직후 처음으로 가로로 잡는 순간을 한 번만 새 영점으로 삼습니다.
// 세로 자세는 운전 자세가 아니라서, 그 뒤 가로로 쥐는 건 핸들을 90° 꺾은 게 아니라 핸들을 제대로 잡은 것입니다.
let goAt = 0;
let lateGrip = false;
let gripSince = 0;
function checkLateGrip() {
  if (mode !== 'play' || !racePinned || lateGrip || holdRace == null || sideways(holdRace)) { gripSince = 0; return; }
  const now = performance.now();
  if (now - goAt > 10000) { lateGrip = true; return; }
  if (flat || !sideways(holdLive) || upLen < 0.5) { gripSince = 0; return; }
  if (!gripSince) { gripSince = now; return; }
  if (now - gripSince < 450 || !recent.length) return;
  lateGrip = true;
  zero = circMean(recent);
  holdRace = holdLive;
  holdCal = holdLive;
  applyLayout();
  send('calibrate', {});
}
// 경기 중 폰을 아예 반대로(180°) 바꿔 쥐었으면(1초 넘게) 영점과 배치를 같이 뒤집습니다. 핸들로 135° 넘게 꺾는 일은 없어서 헷갈리지 않습니다.
function checkFlip() {
  if (mode !== 'play' || holdRace == null || holdLive == null) { flipSince = 0; return; }
  if (Math.abs(wrapDeg(holdLive - holdRace)) !== 180 || flat) { flipSince = 0; return; }
  const now = performance.now();
  if (!flipSince) { flipSince = now; return; }
  if (now - flipSince > 1000 && zero != null) {
    flipSince = 0;
    zero = wrap(zero + Math.PI);
    holdRace = holdLive;
    holdCal = holdLive;
    applyLayout();
  }
}

// ---------- 서버까지 왕복 시간 ----------
const rtts = [];
setInterval(() => {
  if (!socket.connected) return;
  const t0 = performance.now();
  socket.timeout(2000).emit('ping_rtt', t0, (err) => {
    if (err) return;
    rtts.push(performance.now() - t0);
    if (rtts.length > 7) rtts.shift();
  });
}, 1500);
const rtt = () => {
  if (!rtts.length) return 0;
  const s = [...rtts].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// ---------- 페달 ----------
const pedal = { gas: 0, brake: 0 };
const held = { l: 0, r: 0 }; // 왼쪽·오른쪽 큰 버튼을 누르고 있는지
let sentCount = 0;
let lastSig = '';
function sendDrive(force) {
  if (mode !== 'play') return;
  const steer = +readSteer().toFixed(3);
  const sig = `${steer}|${pedal.gas}|${pedal.brake}`;
  if (!force && sig === lastSig && sentCount % 6) { sentCount++; return; } // 같은 값은 6번에 한 번만(끊김 감지용 하트비트)
  lastSig = sig;
  if (send('drive', { steer, gas: pedal.gas, brake: pedal.brake, t: Math.round(performance.now() * 10) / 10 }, true)) sentCount++;
}
setInterval(() => { sendDrive(false); tutSteerTick(); }, 33);

// 오른쪽 큰 버튼의 역할: 어려움 = 액셀, 쉬움·보통 = 아이템(아이템전) 또는 브레이크(스피드전)
function padRole() {
  if (ps.difficulty() === 'hard') return 'gas';
  return itemsOn() ? 'item' : 'brake';
}
function applyPedals() {
  const role = padRole();
  pedal.brake = held.l || (role === 'brake' && held.r) ? 1 : 0;
  pedal.gas = role === 'gas' && held.r ? 1 : 0;
  $('pBrake').classList.toggle('down', Boolean(held.l));
  $('pGas').classList.toggle('down', Boolean(held.r));
  sendDrive(true);
}
function bindPad(el, side) {
  const ids = new Set();
  const set = () => {
    held[side] = ids.size > 0 ? 1 : 0;
    applyPedals();
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    audio();
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    ids.add(e.pointerId);
    if (side === 'r' && padRole() === 'item') itemTap();
    else haptics.tick({ noFlash: true, silent: true });
    set();
  });
  const up = (e) => {
    if (!ids.delete(e.pointerId)) return;
    set();
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
bindPad($('pBrake'), 'l');
bindPad($('pGas'), 'r');
const PAD_SVG = {
  gas: '<svg class="pi" viewBox="0 0 48 48"><path d="M10 26l14-14 14 14"/><path d="M10 40l14-14 14 14"/></svg>',
  brake: '<svg class="pi" viewBox="0 0 48 48"><rect x="10" y="10" width="28" height="28" rx="6"/></svg>'
};
// 오른쪽 큰 버튼 모양을 지금 역할·아이템 상태에 맞춥니다.
function paintPad() {
  const role = padRole();
  const el = $('pGas');
  const ico = $('pGasIco');
  const lbl = $('pGasLbl');
  el.className = `pedal ${role}${role === 'item' ? ` ${itemState}` : ''}${held.r ? ' down' : ''}`;
  if (role === 'item') {
    const kinds = Object.keys(ITEM_ICONS);
    ico.innerHTML = itemState === 'have' && itemKind ? ITEM_ICONS[itemKind] || '' : itemState === 'roll' ? ITEM_ICONS[kinds[Math.floor(Math.random() * kinds.length)]] || '' : ITEM_ICONS.banana;
    lbl.textContent = itemState === 'have' && itemKind ? ITEM_NAMES[itemKind] || '' : itemState === 'roll' ? '뽑는 중…' : '아이템';
    el.setAttribute('aria-label', '아이템 쓰기');
  } else {
    ico.innerHTML = PAD_SVG[role];
    lbl.textContent = role === 'gas' ? '액셀' : '브레이크';
    el.setAttribute('aria-label', lbl.textContent);
  }
}
function releaseAll() {
  held.l = 0;
  held.r = 0;
  pedal.gas = 0;
  pedal.brake = 0;
  $('pGas').classList.remove('down');
  $('pBrake').classList.remove('down');
}

// 무대가 돌아가 있어도 맞게: 요소의 가운데에서 손가락까지를 무대 축으로 되돌려 잽니다.
function alongAxis(el, e) {
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const a = (curRot * Math.PI) / 180;
  const along = (e.clientX - cx) * Math.cos(a) + (e.clientY - cy) * Math.sin(a);
  return along / Math.max(1, el.offsetWidth / 2);
}
// 센서가 없을 때: 가운데 슬라이더를 밀어서 조향
function bindSlider(el, knob, onVal) {
  let pid = null;
  const move = (e) => {
    slideVal = clamp(alongAxis(el, e) * 1.1, -1, 1);
    if (knob) knob.style.left = `${50 + slideVal * 42}%`;
    if (onVal) onVal(slideVal);
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pid = e.pointerId;
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    move(e);
  });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === pid) move(e); });
  const up = (e) => {
    if (e.pointerId !== pid) return;
    pid = null;
    slideVal = 0;
    if (knob) knob.style.left = '50%';
    if (onVal) onVal(0);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}
bindSlider($('slide'), $('slideKnob'));

// 경기 중 위쪽 이름 띠를 길게(1.2초) 누르면 영점을 다시 맞춥니다. 가운데 나머지는 모두 아이템 버튼입니다.
let holdTimer = null;
const mid = $('mid');
mid.querySelector('.top').addEventListener('pointerdown', () => {
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    if (recalibrate()) hint('핸들을 다시 맞췄어요', true);
  }, 1200);
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) mid.querySelector('.top').addEventListener(ev, () => clearTimeout(holdTimer));
mid.addEventListener('pointerdown', (e) => {
  if (e.target.closest('#slide') || e.target.closest('.top')) return;
  e.preventDefault();
  audio();
  itemTap();
});
function recalibrate() {
  if (!setZero()) return false;
  if (mode === 'play' && sideways(holdLive)) { holdRace = holdLive; applyLayout(); }
  haptics.play('success', 0.6, { noFlash: true });
  tone(880, 0.12, 0.1, 'triangle');
  return true;
}
// 짧은 안내 한 줄(폰 가운데 아래). 무시된 입력이 조용히 사라지지 않게 보여 주고 살짝 진동합니다.
let hintTimer = null;
function hint(text, quiet) {
  const el = mode === 'play' ? $('sub') : $('waitHint');
  el.textContent = text;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { el.textContent = ''; }, 1800);
  if (!quiet) haptics.play('warn', 0.45, { noFlash: true, silent: true });
}
// 경기 중 조용히 실패하기 쉬운 두 경우: 영점이 아직 없거나, 폰이 너무 눕혀짐
let hintAt = 0;
let flatSince = 0;
function playHints() {
  if (mode !== 'play' || state.sub !== 'race' || fallback || !gotSensor) { flatSince = 0; return; }
  const now = performance.now();
  if (flat) {
    if (!flatSince) flatSince = now;
  } else flatSince = 0;
  if (now - hintAt < 2500) return;
  if (zero == null && now - goAt > 600) { hintAt = now; hint('폰을 가로로 세워요'); }
  else if (flatSince && now - flatSince > 800) { hintAt = now; hint('폰을 세워요'); }
}

// ---------- 아이템 ----------
let itemState = 'none'; // none | roll | have
let itemKind = null;
let rollTimer = null;
let lastRole = '';
function paintItem() {
  const btn = $('btnItem');
  const on = itemsOn();
  btn.classList.toggle('off', !on);
  clearInterval(rollTimer);
  rollTimer = null;
  const lbl = $('itemLbl');
  if (!on) {
    btn.className = 'itembtn off';
    $('itemIco').innerHTML = SPEED_ICON;
    lbl.className = 'ilbl off';
    lbl.textContent = '스피드전';
    paintPad();
    return;
  }
  btn.className = `itembtn ${itemState}`;
  lbl.className = `ilbl ${itemState}`;
  if (itemState === 'have' && itemKind) {
    $('itemIco').innerHTML = ITEM_ICONS[itemKind] || '';
    lbl.textContent = '눌러서 써요';
  } else if (itemState === 'roll') {
    const kinds = Object.keys(ITEM_ICONS);
    let i = Math.floor(Math.random() * kinds.length);
    const step = () => { i = (i + 1) % kinds.length; $('itemIco').innerHTML = ITEM_ICONS[kinds[i]]; if (padRole() === 'item') { $('pGasIco').innerHTML = ITEM_ICONS[kinds[i]]; } };
    step();
    rollTimer = setInterval(step, 90);
    lbl.textContent = '뽑는 중…';
  } else {
    $('itemIco').innerHTML = ITEM_ICONS.banana;
    lbl.textContent = '';
  }
  paintPad();
}
const itemsOn = () => state.items !== false;
// 스피드전일 때 가운데 버튼 자리: 속도계
const SPEED_ICON = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 44a22 22 0 1 1 44 0" fill="none" stroke="#8fd8ff" stroke-width="5" stroke-linecap="round"/>' +
  '<path d="M14 44h5M45 44h5M32 22v5M17 29l4 3M47 29l-4 3" stroke="#cfe9ff" stroke-width="3" stroke-linecap="round"/>' +
  '<path d="M32 44l11-13" stroke="#ffd23a" stroke-width="4.5" stroke-linecap="round"/><circle cx="32" cy="44" r="5" fill="#ffd23a"/></svg>';
function setItem(st, kind) {
  itemState = st;
  itemKind = kind || null;
  paintItem();
}
function fireItem() {
  if (mode !== 'play' || itemState !== 'have') return false;
  send('item', {});
  haptics.hit(0.55);
  if (!rec('ui/click', { gain: 0.8 })) tone(660, 0.08, 0.08, 'triangle');
  const btn = $('btnItem');
  setItem('none', null);
  btn.classList.add('used');
  setTimeout(() => btn.classList.remove('used'), 460);
  return true;
}
// 아이템 버튼(가운데 그림·오른쪽 큰 버튼·가운데 아무 곳). 쓸 수 없는 때도 이유를 한 줄로 알려 줍니다.
function itemTap() {
  if (fireItem()) return;
  if (mode !== 'play') return;
  if (!itemsOn()) hint('아이템이 없는 판이에요');
  else if (itemState === 'roll') hint('뽑는 중…');
  else hint('상자를 먹으면 아이템');
}
$('btnItem').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  audio();
  itemTap();
});
$('chaseIco').innerHTML = CHASE_ICON;

// 키보드(PC 시험): ←→ 핸들, ↑·W 액셀, ↓·S 브레이크, Space·E 아이템
const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down' };
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'KeyE') {
    if (mode === 'play') { e.preventDefault(); fireItem(); }
    else if (mode === 'tut') tut.signal('item', { key: true });
    return;
  }
  const k = KEYMAP[e.code];
  if (!k || (mode !== 'play' && mode !== 'tut')) return;
  e.preventDefault();
  keys[k] = true;
  if (mode === 'tut') return;
  if (k === 'up') { held.r = 1; applyPedals(); }
  if (k === 'down') { held.l = 1; applyPedals(); }
});
window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (!k) return;
  keys[k] = false;
  if (k === 'up') { held.r = 0; applyPedals(); }
  if (k === 'down') { held.l = 0; applyPedals(); }
});

// ================================================================
// 연습(튜토리얼): 저절로 시작하지 않고 '튜토리얼 다시 하기' 링크로만. 2단계: 기울여서 꺾기, 아이템 쓰기
// ================================================================
const svgWrap = (inner) => `<svg class="pcgt-svg" viewBox="0 0 200 160" aria-hidden="true">${inner}</svg>`;
const PHONE_L = '<rect x="-46" y="-25" width="92" height="50" rx="9" class="pcgt-ph"/><rect x="-38" y="-19" width="76" height="38" rx="4" class="pcgt-scr"/>';
function tiltArt() {
  const to = 26;
  const arc = '<path class="pcgt-arc" d="M60 36 A62 62 0 0 1 100 22"/><path class="pcgt-arrow" d="M66 26 L58 37 L71 40"/>' +
    '<path class="pcgt-arc" d="M100 22 A62 62 0 0 1 140 36"/><path class="pcgt-arrow" d="M134 26 L142 37 L129 40"/>';
  return svgWrap(
    arc +
    `<g transform="translate(100 90)"><g><animateTransform attributeName="transform" type="rotate" values="0;${-to};${-to};${to};${to};0" keyTimes="0;.2;.4;.6;.8;1" calcMode="spline" keySplines=".45 0 .55 1;0 0 1 1;.45 0 .55 1;0 0 1 1;.45 0 .55 1" dur="3s" repeatCount="indefinite"/>` +
    `<g transform="scale(1.25)">${PHONE_L}<circle r="9" fill="none" stroke="#fff" stroke-width="3"/><path d="M0 -9v-6" stroke="#ffd23a" stroke-width="3" stroke-linecap="round"/></g>` +
    '<rect x="-74" y="-16" width="20" height="32" rx="9" class="pcgt-hand"/><rect x="54" y="-16" width="20" height="32" rx="9" class="pcgt-hand"/></g></g>'
  );
}
function itemArt() {
  return svgWrap(
    `<g transform="translate(100 82) scale(1.45)">${PHONE_L}` +
    '<circle r="14" fill="#2a2108" stroke="#ffd23a" stroke-width="2.5"/>' +
    `<g transform="translate(-9 -9) scale(.28)">${ITEM_ICONS.banana.replace(/<\/?svg[^>]*>/g, '')}</g>` +
    '<circle r="14" fill="none" stroke="#fff" stroke-width="2"><animate attributeName="r" values="14;26" dur="1.2s" repeatCount="indefinite"/><animate attributeName="opacity" values=".9;0" dur="1.2s" repeatCount="indefinite"/></circle></g>' +
    '<g transform="translate(116 104) rotate(-24)"><g><animateTransform attributeName="transform" type="translate" values="8 8;0 0;0 0;8 8" keyTimes="0;.3;.6;1" dur="1.2s" repeatCount="indefinite"/>' +
    '<rect x="-8" y="0" width="16" height="60" rx="8" class="pcgt-hand"/></g></g>'
  );
}
// 조향 단계: 지금 핸들 값을 보여 주는 막대(센서가 없으면 이 막대를 밀어서 연습)
function steerStage(stage) {
  stage.innerHTML = `<div class="tk"><div class="tk-gauge"><span class="goal" style="left:0"></span><span class="goal" style="right:0"></span><b></b><i></i>` +
    `${fallback ? '<em>여기를 밀어 보세요</em>' : ''}</div></div>`;
  const g = stage.querySelector('.tk-gauge');
  const knob = stage.querySelector('.tk-gauge i');
  if (fallback) bindSlider(g, null);
  let raf = 0;
  const loop = () => {
    knob.style.left = `${50 + clamp(steerSmooth, -1, 1) * 44}%`;
    raf = requestAnimationFrame(loop);
  };
  loop();
  return () => cancelAnimationFrame(raf);
}
function itemStage(stage, api) {
  stage.innerHTML = `<div class="tk"><button type="button" class="tk-item"><span>${ITEM_ICONS.banana}</span></button></div>`;
  const b = stage.querySelector('.tk-item');
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    b.classList.add('fly');
    api.signal('item', {});
  });
}
const tut = createTutorial({
  key: 'kart',
  socket,
  title: '처음이라 연습해 봐요',
  steps: [
    { title: '기울여서 꺾기', body: '핸들처럼 기울여요.', svg: tiltArt, waitFor: 'steer', hint: '좌우로 기울여요',
      check: (d) => d.dir !== 0 || '더 크게!', render: steerStage },
    { title: '아이템 쓰기', body: '가운데 버튼을 눌러요.', svg: itemArt, waitFor: 'item', render: itemStage }
  ]
});
tut.link($('tutLink'), { mount: null, before: () => { startTutorial(); return false; } });

// 튜토리얼 동안 핸들 감지: 한쪽으로 0.15초만 꺾어도 신호 한 번. 조금만 기울이고 머물면 '더 크게!'
const tutSteer = { arm: true, dir: 0, since: 0, smallSince: 0 };
function tutSteerTick() {
  if (mode !== 'tut' || !tut.isRunning()) return;
  // 아직 영점이 없으면(세로로 든 채 맞추기를 끝냄) 처음 가로로 잡는 자세를 직진으로 삼습니다.
  if (zero == null && gotSensor && !flat && sideways(holdLive) && recent.length >= 6) setZero();
  const v = readSteer();
  const now = performance.now();
  if (Math.abs(v) < 0.12) { tutSteer.arm = true; tutSteer.dir = 0; tutSteer.smallSince = 0; return; }
  if (Math.abs(v) < 0.4) {
    if (!tutSteer.smallSince) tutSteer.smallSince = now;
    else if (now - tutSteer.smallSince > 2500) { tutSteer.smallSince = now; tut.signal('steer', { dir: 0 }); } // 작게만 기울이면 '더 크게!'
    return;
  }
  tutSteer.smallSince = 0;
  if (!tutSteer.arm) return;
  const dir = Math.sign(v);
  if (tutSteer.dir !== dir) { tutSteer.dir = dir; tutSteer.since = now; return; }
  if (now - tutSteer.since > 150) {
    tutSteer.arm = false;
    tut.signal('steer', { dir });
  }
}
async function startTutorial() {
  if (tut.isRunning()) return;
  mode = 'tut';
  releaseAll();
  show(''); // 뒤에 있던 화면(대기실)이 연습 화면 사이로 비치지 않게 숨깁니다
  const box = document.querySelector('#stage .stage-in');
  await tut.run(box, { inline: true });
  if (mode === 'tut') {
    mode = 'wait';
    render();
  }
}

// ---------- 화면 갱신 ----------
const wheel = $('wheel');
function paintSteer() {
  if (mode === 'play') {
    // 폰이 돌아간 만큼 반대로 돌려 그리면 헷갈리니, 조향 방향 그대로 핸들 그림을 돌립니다.
    wheel.style.transform = `rotate(${clamp(steerDeg, -90, 90)}deg)`;
    $('bar').style.left = `${50 + steerSmooth * 45}%`;
  }
  requestAnimationFrame(paintSteer);
}
requestAnimationFrame(paintSteer);

function mine() {
  return me && state.players ? state.players[me.slot] : null;
}
function statusText() {
  const p = mine();
  if (!p) return '';
  const v = { r: p.rank, lap: p.lap, laps: state.laps || 3 };
  return p.late ? t('중간 참가 · {r}등 · {lap}/{laps}바퀴', v) : p.fin ? t('{r}등으로 들어왔어요', v) : t('{r}등 · {lap}/{laps}바퀴', v);
}
function render() {
  if (!me) return;
  const phase = state.phase;
  const p = mine();
  if (mode === 'tut') {
    if (!(phase === 'playing' && p)) return; // 연습 중에는 그대로(경기가 시작돼 내 카트가 있으면 연습을 닫음)
    tut.cancel();
  }
  if (phase === 'playing' && p) {
    if (mode !== 'play') {
      mode = 'play';
      if (holdRace == null) alignForRace(false);
      show('vPlay');
      paintItem();
      applyPedals();
      keepAwake();
      tut.setLinkVisible(false);
    }
    $('status').textContent = state.sub === 'countdown' ? '곧 출발!' : statusText();
    if (padRole() !== lastRole) { lastRole = padRole(); releaseAll(); paintPad(); }
    $('chaseP').classList.toggle('on', state.sub === 'race' && !p.fin && (p.chase || 0) >= 0.035);
    // 늦게 붙었거나 신호를 놓쳤으면 화면 상태로 아이템 칸을 맞춥니다.
    if (itemsOn() && itemState !== 'roll') {
      const want = p.item ? 'have' : p.roll ? 'roll' : 'none';
      if (want !== itemState || (want === 'have' && p.item !== itemKind)) setItem(want, p.item);
    }
    return;
  }
  if (mode === 'play') {
    releaseAll();
    holdRace = null;
    racePinned = false;
    setItem('none', null);
  }
  mode = 'wait';
  tut.setLinkVisible(true);
  const bigEl = $('waitBig');
  bigEl.classList.add('hidden');
  $('btnReady').style.display = '';
  $('btnCal').style.display = '';
  if (phase === 'over') {
    const r = (p && p.rank) || (result && result.rank) || 0;
    const total = (p && p.n) || (result && result.total) || 4;
    bigEl.classList.remove('hidden');
    bigEl.classList.toggle('win', r === 1);
    bigEl.textContent = result && result.late ? '중간 참가' : r ? `${r}등` : '';
    $('waitT').textContent = result && result.late ? '중간 참가' : r === 1 ? '우승!' : r ? t('{total}대 중 {r}등', { total, r }) : '경기 끝';
    const rec0 = result && result.finished ? (result.best ? t('기록 {time} · 베스트 랩 {best}', { time: fmt(result.time), best: fmt(result.best) }) : t('기록 {time}', { time: fmt(result.time) })) : '완주하지 못했어요';
    $('waitB').textContent = result && result.late ? '순위에는 포함되지 않아요.' : rec0;
  } else if (phase === 'playing') {
    $('waitT').textContent = '경기 중';
    $('waitB').textContent = '다음 판부터 같이 해요.';
    $('btnReady').style.display = 'none';
  } else {
    $('waitT').textContent = '대기실';
    $('waitB').textContent = fallback ? '화면 가운데를 밀어서 조향해요.' : '폰을 가로로 들고 준비를 눌러요.';
  }
  paintReady();
  show('vWait');
}
function fmt(ms) {
  const t = Math.floor(ms / 100) / 10;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}
function paintReady() {
  const b = $('btnReady');
  b.classList.toggle('waiting', readyPressed);
  b.disabled = readyPressed;
  if (readyPressed) b.textContent = '준비 완료 ✓';
  else b.textContent = state.phase === 'over' ? '다시 하기' : '준비';
}

// ---------- 소켓 ----------
socket.on('connect', () => socket.emit('join', { role: 'controller', room: ROOM, token }));
socket.on('assigned', (p) => {
  if (p.game !== 'kart') {
    location.replace(p.game === 'baseball' ? `/play/?room=${ROOM}` : `/play/${p.game}/?room=${ROOM}`);
    return;
  }
  me = p;
  noRoomTries = 0;
  document.documentElement.style.setProperty('--c', p.color);
  tut.setColor(p.color);
  $('me').textContent = p.name;
  $('meP').textContent = p.name;
  if (mode === 'msg' || mode === 'connecting') {
    mode = 'wait';
  }
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
  b.textContent = '큰 화면 연결이 끊겼어요';
  b.classList.toggle('hidden', Boolean(d && d.connected));
});
socket.on('disconnect', () => {
  if (mode === 'play') hint('연결이 잠깐 끊겼어요…', true);
});
socket.on('game_state', (s) => {
  const prev = state.phase;
  const prevItems = state.items;
  state = s || { phase: 'lobby' };
  if (state.phase !== prev && (state.phase === 'playing' || state.phase === 'lobby')) {
    readyPressed = false;
    if (state.phase === 'playing') result = null;
  }
  if (prevItems !== state.items && mode === 'play') paintItem();
  if (mode === 'msg' && !me) return;
  render();
});
// 모두 준비 상태: 서버가 알려 주는 값을 따라 버튼 모양을 맞춥니다.
socket.on('ready_state', (st) => {
  if (!me || !st) return;
  readyPressed = Boolean(st.ready && st.ready.includes(me.slot));
  if (mode === 'wait') paintReady();
});
socket.on('result', (r) => {
  result = r;
  if (mode === 'wait') render();
});
function popCd(text) {
  const cd = $('cd');
  cd.textContent = text;
  cd.classList.remove('on');
  void cd.offsetWidth;
  cd.classList.add('on');
}
const HIT_TEXT = { banana: '바나나에 미끄러졌어요!', missile: '유도탄에 맞았어요!', bolt: '번개! 잠깐 작아져요', star: '무적 카트에 부딪혔어요!' };
socket.on('cue', (c) => {
  if (!c) return;
  if (c.type === 'count') {
    if (mode === 'play') alignForRace(false);
    popCd(c.n);
    haptics.play('tick', 1, { noFlash: true });
    if (!rec('ui/beep', { gain: 0.8, jitter: 0 })) tone(520, 0.12, 0.1, 'square');
  } else if (c.type === 'go') {
    if (mode === 'play') alignForRace(true);
    popCd('GO!');
    setTimeout(() => $('cd').classList.remove('on'), 900);
    const flash = $('flash');
    flash.classList.remove('go');
    void flash.offsetWidth;
    flash.classList.add('go');
    haptics.play('strong', 1, { noFlash: true });
    tone(1040, 0.3, 0.12, 'square');
  } else if (c.type === 'boost') {
    hint('부스트!', true);
  } else if (c.type === 'lap') {
    haptics.play('good', 1, { noFlash: true });
    hint(t('{n}바퀴째', { n: c.lap }), true);
  } else if (c.type === 'finish') {
    haptics.buzz([80, 50, 80, 50, 200]);
    popCd('완주!');
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, 0.12, 'triangle', i * 0.1));
  } else if (c.type === 'item') {
    if (c.state === 'roll') { setItem('roll', null); if (!rec('ui/click', { gain: 0.3, rate: 1.5 })) tone(1500, 0.05, 0.05, 'square'); }
    else if (c.state === 'have') { setItem('have', c.kind); hint('눌러서 써요', true); }
    else setItem('none', null);
  } else if (c.type === 'hit') {
    haptics.flash('#ff3b4a', { opacity: 0.5, ms: 420 });
    hint((c.by ? `${t(c.by)} · ` : '') + t(HIT_TEXT[c.cause] || '꽈당!'), true); // 이름과 문장을 각자 번역해서 이어 붙입니다
    if (!rec('kart/crash-2', { gain: 0.9, rate: 0.9 })) tone(300, 0.3, 0.1, 'sawtooth');
  }
});

// ---------- 버튼 ----------
// 다시 맞추기(선택): 폰을 가로로 든 채 누르면 지금 자세가 직진이 됩니다. 안 되면 이유를 한 줄로 보여 줍니다.
$('btnCal').addEventListener('click', () => {
  audio();
  if (fallback && !gotSensor) { hint('동작 센서가 없어요'); return; }
  if (!gotSensor || flat) { hint('폰을 세워서 눌러요'); return; }
  if (holdLive == null || !sideways(holdLive)) { hint('폰을 가로로 들고 눌러요'); return; }
  if (recalibrate()) hint('맞췄어요!', true);
  else hint('잠시 뒤에 다시 눌러요');
});
$('btnReady').addEventListener('click', () => {
  keepAwake();
  audio();
  // 영점은 출발 카운트다운 때 지금 쥔 자세로 다시 확인합니다(alignForRace). 여기서 세로로 들고 누른 자세를 영점으로 삼지 않습니다.
  if (zero == null && gotSensor && !flat && holdLive != null && sideways(holdLive)) setZero();
  if (!send('start_game', {})) {
    hint('연결 중이에요. 잠시 뒤에 눌러요');
    return;
  }
  readyPressed = true;
  paintReady();
  haptics.play('good', 0.8, { noFlash: true });
});
mountSwitcher($('langBox'), { reload: true, compact: true }); // 시작 화면에서만 보입니다(vStart 안)
$('btnStart').addEventListener('click', async () => {
  if (mode !== 'start') return;
  mode = 'connecting';
  $('btnStart').disabled = true;
  audio();
  haptics.unlock();
  // 전체 화면(되는 기기만). 화면 방향은 잠그지 않습니다(회전 잠금 여부와 상관없이 무대를 직접 돌림).
  try {
    const fs = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    Promise.resolve(fs).catch(() => {});
  } catch (e) {}
  // iPhone 은 탭 안에서, await 전에 권한을 물어야 합니다.
  let denied = false;
  if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      denied = (await DeviceOrientationEvent.requestPermission()) !== 'granted';
    } catch (e) {
      denied = true;
    }
  }
  window.addEventListener('deviceorientation', onOrientation);
  keepAwake();
  if (!ROOM) {
    message('방 코드가 없어요', '큰 화면의 QR을 찍어 주세요.');
    return;
  }
  $('msgT').textContent = '들어가는 중…';
  $('msgB').textContent = '큰 화면과 연결하고 있어요.';
  mode = 'connecting';
  show('vMsg');
  socket.connect();
  // 센서 값이 안 들어오면(권한 거절·http·PC) 화면 슬라이더로 조향합니다.
  setTimeout(() => {
    if (gotSensor && !denied) return;
    fallback = true;
    $('mid').classList.add('fallback');
    $('banner').textContent = '센서가 없어요 · 화면 가운데를 밀어요';
    $('banner').classList.remove('hidden');
    setTimeout(() => $('banner').classList.add('hidden'), 5000);
  }, 1500);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { releaseAll(); sendDrive(true); }
  else if (mode !== 'start') keepAwake();
});
window.addEventListener('blur', () => { releaseAll(); });
if (!window.isSecureContext) $('httpNote').classList.remove('hidden');

// 모두 준비 띠(ready.js)는 body 에 붙으므로, 무대 안으로 옮겨 무대와 같이 돌게 합니다.
new MutationObserver(() => {
  const bar = document.getElementById('readyBar');
  const box = document.querySelector('#stage .stage-in');
  if (bar && box && bar.parentNode !== box) box.appendChild(bar);
}).observe(document.body, { childList: true });

applyLayout();
paintItem();

// ---------- 디버그 (&debug) ----------
if (DEBUG) {
  let lastO = 0;
  setInterval(() => {
    $('debug').textContent = `ori ${(oriCount - lastO) * 2}Hz rtt ${Math.round(rtt())}ms ang ${((ang * 180) / Math.PI).toFixed(0)} zero ${zero == null ? '-' : ((zero * 180) / Math.PI).toFixed(0)} ` +
      `steer ${steerSmooth.toFixed(2)} flat ${flat ? 'Y' : 'N'} mode ${mode} fb ${fallback ? 'Y' : 'N'} hold ${holdLive}/${holdCal}/${holdRace} scr ${rawScreenAngle()}${angleFlip ? '!' : ''} rot ${curRot}`;
    lastO = oriCount;
  }, 500);
}

// 시험용: 센서 없이 값을 넣어 볼 수 있습니다.
// simHold(hold, steerDeg, tiltDeg): hold(0·90·-90·180) 방향으로 쥐고 steerDeg 만큼 핸들을 돌린 자세의 beta/gamma 를 만들어 넣습니다.
function orientationFor(hold, steer = 0, tilt = 25) {
  const a = ((90 - hold + steer) * Math.PI) / 180;
  const c = Math.cos((tilt * Math.PI) / 180);
  const ux = Math.cos(a) * c;
  const uy = Math.sin(a) * c;
  const uz = Math.sin((tilt * Math.PI) / 180);
  const b = Math.asin(clamp(uy, -1, 1));
  const g = Math.atan2(-ux, uz);
  return { beta: (b * 180) / Math.PI, gamma: (g * 180) / Math.PI };
}
let simTimer = null;
window.__kartPad = {
  state: () => state, me: () => me, onOrientation, setZero, pedal, readSteer, mode: () => mode, tut, ps,
  layout: () => ({ holdLive, holdCal, holdRace, screen: rawScreenAngle(), angleFlip, rot: curRot, land: $('stage').classList.contains('land'), steer: steerSmooth, steerDeg }),
  orientationFor,
  /** 센서 흉내: 같은 자세를 계속(30Hz) 넣습니다. stop 으로 멈춤 */
  simHold(hold, steer = 0, tilt = 25) {
    gotSensor = true;
    clearInterval(simTimer);
    const feed = () => onOrientation(orientationFor(hold, steer, tilt));
    feed();
    simTimer = setInterval(feed, 33);
    return orientationFor(hold, steer, tilt);
  },
  stopSim() { clearInterval(simTimer); },
  /** 화면(OS) 회전 각도를 흉내 냅니다(0·90·180·270). null 이면 실제 값 */
  setScreenAngle(a) { fakeAngle = a; applyLayout(); return curRot; },
  item: (st, kind) => setItem(st, kind),
  fireItem
};
