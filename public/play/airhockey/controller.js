// 에어하키 컨트롤러. 폰 화면이 큰 화면 속 내 쪽 반 코트(2:2 면 내 레인)가 됩니다.
// 누른 자리를 그 영역 안의 0..1 위치로 바꿔 move { x, y, t } 로 40Hz 까지 보냅니다(밀리면 버려도 되는 이벤트).
// x: 큰 화면 기준 왼쪽 0 → 오른쪽 1, y: 큰 화면 기준 위 0 → 아래 1. 동작 센서는 쓰지 않습니다.
// 처음 하는 폰은 시작하기 뒤 연습 판(practice.js)에서 말렛 움직이기·치기·슛·막기를 직접 해 봅니다(localStorage pcg-tut-airhockey).
// 대기 화면: 난이도 알약(큰 화면과 같이 바뀜) · 누가 준비했는지 · 큰 준비 버튼 · 튜토리얼 다시 하기.
import { haptics } from '/common/haptics.js';
import { createPhoneSettings } from '/common/phone-settings.js';
import { createTutorial } from '/common/tutorial.js';
import { createPractice } from './practice.js';

(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const ROOM = (params.get('room') || '').toUpperCase();
  const DEBUG = params.has('debug');
  $('room').textContent = ROOM ? `방 ${ROOM}` : '';
  const isTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;

  let token = null;
  try { token = localStorage.getItem('pcg-token'); } catch (e) {}
  if (!token) {
    token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem('pcg-token', token); } catch (e) {}
  }
  let flip = false; // 반대편(화면 위쪽 끝)에 서서 할 때: 내 골문이 폰 아래로 오게 180° 돌려 봅니다.
  // 뒤집기는 쪽(top/bottom)마다 따로 기억합니다. 경기마다 쪽이 바뀔 수 있어서, 위쪽에서 고른 뒤집기가 아래쪽으로 넘어오지 않게 합니다.
  const flipKey = (side) => `pcg-airhockey-flip-${side}`;
  function loadFlip(side) {
    try { return localStorage.getItem(flipKey(side)) === '1'; } catch (e) { return false; }
  }
  function tipText(p) {
    return p.side === 'top'
      ? (flip ? '반대편 시점 · 내 골문이 아래예요' : '큰 화면과 같은 방향 · 내 골문이 위예요')
      : (flip ? '뒤집힌 시점 · 내 골문이 위예요' : '엄지로 끌어서 말렛을 움직여요');
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
  let mode = 'start'; // start | msg | wait | play
  let noRoomTries = 0;

  function show(id) {
    for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === id);
    $('btnFlip').classList.toggle('hidden', id !== 'vPlay');
    if (id === 'vPlay') requestAnimationFrame(sizePad);
  }
  function message(t, b) {
    mode = 'msg';
    document.body.classList.remove('roster-on');
    $('msgT').textContent = t;
    $('msgB').textContent = b || '';
    show('vMsg');
  }
  function keepAwake() {
    if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
  }
  // 내 색(자리를 받기 전에는 1P 빨강)
  const myColor = () => (me && me.color) || getComputedStyle(document.documentElement).getPropertyValue('--c').trim() || '#ff5a5f';

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
  function tone(freq, sec, gain, type = 'sine', when = 0, glide = 0) {
    const a = actx;
    if (!a || a.state !== 'running') return;
    const t = a.currentTime + when;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(freq * glide, t + sec);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + sec + 0.02);
  }
  function click(q) {
    const a = actx;
    if (!a || a.state !== 'running') return;
    const len = Math.floor(a.sampleRate * 0.03);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2600 + q * 1200;
    const g = a.createGain();
    g.gain.value = 0.25 + q * 0.5;
    src.connect(f).connect(g).connect(a.destination);
    src.start();
    tone(700 + q * 400, 0.05, 0.08 + q * 0.1, 'triangle');
  }

  // ---------- 내 자리(영역) ----------
  const DEF = { w: 1, l: 2, mr: 0.056, pr: 0.04, goal: 0.34 };
  function rink() {
    return state.rink || DEF;
  }
  function mine() {
    return me && state.players ? state.players[me.slot] : null;
  }
  // 패드가 보여 주는 영역(세계 좌표, 큰 화면 기준). 아직 모르면 1P 아래쪽 반.
  function region() {
    const p = mine();
    if (p && p.region) return p.region;
    const R = rink();
    return { x0: -R.w / 2, x1: R.w / 2, z0: 0, z1: R.l / 2 };
  }

  // ---------- 패드 그리기 ----------
  const cv = $('padCv');
  const g = cv.getContext('2d');
  let W = 0;
  let H = 0;
  let dpr = 1;
  const fit = { s: 1, rx: 0, ry: 0, rw: 0, rh: 0 };
  function sizePad() {
    const box = $('pad');
    dpr = Math.min(3, window.devicePixelRatio || 1);
    W = box.clientWidth;
    H = box.clientHeight;
    cv.width = Math.max(1, Math.round(W * dpr));
    cv.height = Math.max(1, Math.round(H * dpr));
    layout();
    draw();
  }
  window.addEventListener('resize', sizePad);
  function layout() {
    const r = region();
    const pad = 16;
    const s = Math.min((W - pad * 2) / (r.x1 - r.x0), (H - pad * 2) / (r.z1 - r.z0));
    fit.s = s;
    fit.rw = (r.x1 - r.x0) * s;
    fit.rh = (r.z1 - r.z0) * s;
    fit.rx = (W - fit.rw) / 2;
    fit.ry = (H - fit.rh) / 2;
  }
  // 세계 좌표 → 패드 화면(뒤집기 반영)
  function toScreen(x, z) {
    const r = region();
    const u = flip ? (r.x1 - x) : (x - r.x0);
    const v = flip ? (r.z1 - z) : (z - r.z0);
    return [fit.rx + u * fit.s, fit.ry + v * fit.s];
  }
  function toWorld(px, py) {
    const r = region();
    const u = (px - fit.rx) / fit.s;
    const v = (py - fit.ry) / fit.s;
    return [flip ? r.x1 - u : r.x0 + u, flip ? r.z1 - v : r.z0 + v];
  }

  const finger = { x: null, z: null, down: false };
  let flashT = 0;
  function draw() {
    if (!W) return;
    const R = rink();
    const r = region();
    const p = mine();
    const side = p ? p.side : 'bottom';
    const own = side === 'bottom' ? R.l / 2 : -R.l / 2; // 내 골문 z
    const team = (p && p.teamColor) || (me ? me.color : '#ff5a5f');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    // 레일(바깥 테두리)
    const [ax, ay] = toScreen(r.x0, r.z0);
    const [bx, by] = toScreen(r.x1, r.z1);
    const L = Math.min(ax, bx);
    const T = Math.min(ay, by);
    const Rr = Math.max(ax, bx);
    const B = Math.max(ay, by);
    g.fillStyle = '#121019';
    g.beginPath();
    if (g.roundRect) g.roundRect(L - 12, T - 12, Rr - L + 24, B - T + 24, 18);
    else g.rect(L - 12, T - 12, Rr - L + 24, B - T + 24);
    g.fill();
    // 판
    const grd = g.createLinearGradient(0, T, 0, B);
    grd.addColorStop(0, '#f4f6fa');
    grd.addColorStop(1, '#e6eaf1');
    g.fillStyle = grd;
    g.fillRect(L, T, Rr - L, B - T);
    g.save();
    g.beginPath();
    g.rect(L, T, Rr - L, B - T);
    g.clip();
    // 공기 구멍(5cm 간격으로 성기게)
    g.fillStyle = 'rgba(80,90,110,.32)';
    const step = 0.05;
    for (let x = Math.ceil(r.x0 / step) * step + step / 2; x < r.x1; x += step) {
      for (let z = Math.ceil(r.z0 / step) * step + step / 2; z < r.z1; z += step) {
        const [sx, sy] = toScreen(x, z);
        g.fillRect(sx - 1, sy - 1, 2, 2);
      }
    }
    const S = (x, z) => toScreen(x, z);
    // 가운데 원·선
    {
      const [cx, cy] = S(0, 0);
      g.strokeStyle = '#e2323f';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(cx, cy, 0.165 * fit.s, 0, Math.PI * 2);
      g.stroke();
      const [l0x, l0y] = S(-R.w / 2, 0);
      const [l1x, l1y] = S(R.w / 2, 0);
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(l0x, l0y);
      g.lineTo(l1x, l1y);
      g.stroke();
    }
    // 공격선
    {
      const zl = side === 'bottom' ? 0.5 : -0.5;
      const [a0x, a0y] = S(-R.w / 2, zl);
      const [a1x, a1y] = S(R.w / 2, zl);
      g.strokeStyle = team;
      g.globalAlpha = 0.5;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(a0x, a0y);
      g.lineTo(a1x, a1y);
      g.stroke();
      g.globalAlpha = 1;
    }
    // 골 크리스와 골문
    {
      const [gx, gy] = S(0, own);
      g.fillStyle = team + '22';
      g.strokeStyle = team;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(gx, gy, 0.24 * fit.s, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.restore();
    // 테두리: 진짜 벽은 팀 색 네온, 가운데 줄·레인 경계는 점선
    const edge = (x0, z0, x1, z1, wall) => {
      const [p0x, p0y] = S(x0, z0);
      const [p1x, p1y] = S(x1, z1);
      g.save();
      if (wall) {
        g.strokeStyle = team;
        g.lineWidth = 5;
        g.shadowColor = team;
        g.shadowBlur = 14;
      } else {
        g.strokeStyle = 'rgba(255,255,255,.55)';
        g.lineWidth = 2;
        g.setLineDash([8, 8]);
      }
      g.beginPath();
      g.moveTo(p0x, p0y);
      g.lineTo(p1x, p1y);
      g.stroke();
      g.restore();
    };
    const hw = R.w / 2;
    edge(r.x0, r.z0, r.x0, r.z1, r.x0 <= -hw + 1e-6);
    edge(r.x1, r.z0, r.x1, r.z1, r.x1 >= hw - 1e-6);
    const goalZ = own;
    const centerZ = 0;
    edge(r.x0, centerZ, r.x1, centerZ, false);
    // 내 골문 쪽 벽은 골문 구멍을 빼고 그립니다
    const gh = R.goal / 2;
    const g0 = Math.max(r.x0, -gh);
    const g1 = Math.min(r.x1, gh);
    if (g0 > r.x0) edge(r.x0, goalZ, g0, goalZ, true);
    if (g1 < r.x1) edge(g1, goalZ, r.x1, goalZ, true);
    if (g1 > g0) {
      const [s0x, s0y] = S(g0, goalZ);
      const [s1x, s1y] = S(g1, goalZ);
      g.fillStyle = '#06070a';
      const off = (side === 'bottom') !== flip ? 1 : -1; // 골문 구멍은 판 바깥쪽으로
      g.fillRect(Math.min(s0x, s1x), off > 0 ? s0y : s0y - 10, Math.abs(s1x - s0x), 10);
    }
    // 2:2 레인 안내
    if (p && p.lane !== 'full') {
      const divX = p.lane === 'left' ? r.x1 : r.x0;
      const [dx, dy] = S(divX, (r.z0 + r.z1) / 2);
      g.save();
      g.fillStyle = 'rgba(40,48,70,.45)';
      g.font = '800 13px "Pretendard Variable", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      // 레인 경계 바로 안쪽에 세로로 팀원 이름
      const right = dx > W / 2;
      g.translate(dx + (right ? -12 : 12), dy);
      g.rotate(right ? Math.PI / 2 : -Math.PI / 2);
      g.fillText(`${(p.mates && p.mates[0]) || '팀원'} 자리`, 0, 0);
      g.restore();
    }
    // 말렛(내 손가락 자리, 말렛 반지름만큼 안쪽으로)
    if (finger.x != null) {
      const [mx, my] = S(finger.x, finger.z);
      const mr = R.mr * fit.s;
      const color = me ? me.color : '#ff5a5f';
      g.save();
      g.globalAlpha = finger.down ? 1 : 0.75;
      g.shadowColor = color;
      g.shadowBlur = finger.down ? 26 : 10;
      g.fillStyle = color;
      g.beginPath();
      g.arc(mx, my, mr, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(0,0,0,.18)';
      g.beginPath();
      g.arc(mx, my, mr * 0.62, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = color;
      g.beginPath();
      g.arc(mx, my, mr * 0.42, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.55)';
      g.beginPath();
      g.arc(mx - mr * 0.15, my - mr * 0.15, mr * 0.16, 0, Math.PI * 2);
      g.fill();
      if (finger.down) {
        g.strokeStyle = 'rgba(255,255,255,.9)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(mx, my, mr + 8, 0, Math.PI * 2);
        g.stroke();
      }
      if (flashT > 0) {
        g.strokeStyle = color;
        g.globalAlpha = flashT;
        g.lineWidth = 4;
        g.beginPath();
        g.arc(mx, my, mr + 10 + (1 - flashT) * 40, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
    }
  }
  let anim = 0;
  function animate() {
    if (flashT > 0) {
      flashT = Math.max(0, flashT - 0.06);
      draw();
      anim = requestAnimationFrame(animate);
    } else {
      anim = 0;
    }
  }

  // ---------- 터치 → move ----------
  let pending = null; // 아직 안 보낸 최신 위치
  let lastSent = 0;
  let sentCount = 0;
  function setFinger(wx, wz) {
    const R = rink();
    const r = region();
    // 말렛 중심이 갈 수 있는 곳(영역 안쪽으로 말렛 반지름만큼)
    finger.x = Math.max(r.x0 + R.mr, Math.min(r.x1 - R.mr, wx));
    finger.z = Math.max(r.z0 + R.mr, Math.min(r.z1 - R.mr, wz));
    const nx = (Math.max(r.x0, Math.min(r.x1, wx)) - r.x0) / (r.x1 - r.x0);
    const ny = (Math.max(r.z0, Math.min(r.z1, wz)) - r.z0) / (r.z1 - r.z0);
    pending = { x: +nx.toFixed(4), y: +ny.toFixed(4), t: performance.now() }; // 보낼 때가 아니라 만진 시각
    flush(false);
    draw();
  }
  function flush(force) {
    if (!pending) return;
    const now = performance.now();
    if (!force && now - lastSent < 24) return; // 40Hz 까지
    lastSent = now;
    if (send('move', { x: pending.x, y: pending.y, t: Math.round(pending.t * 10) / 10 }, true)) sentCount += 1;
    pending = null;
  }
  // 손을 움직이지 않을 때 남은 값을 마저 보냅니다.
  setInterval(() => flush(false), 25);

  const pad = $('pad');
  let pid = null;
  function pointerWorld(e) {
    const rc = pad.getBoundingClientRect();
    return toWorld(e.clientX - rc.left, e.clientY - rc.top);
  }
  let lastPointerAt = 0;
  pad.addEventListener('pointerdown', (e) => {
    if (mode !== 'play') return;
    e.preventDefault();
    audio();
    // 손가락 하나만 따라갑니다. 앞 손가락이 1초 넘게 조용하면(떼는 이벤트를 놓친 경우) 새 손가락이 이어받습니다.
    if (pid != null && pid !== e.pointerId && performance.now() - lastPointerAt < 1000) return;
    lastPointerAt = performance.now();
    pid = e.pointerId;
    try { pad.setPointerCapture(e.pointerId); } catch (err) {}
    stopAuto();
    finger.down = true;
    const [x, z] = pointerWorld(e);
    setFinger(x, z);
  });
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid || mode !== 'play') return;
    e.preventDefault();
    lastPointerAt = performance.now();
    // 보내는 건 최신 위치만(40Hz 로 묶어서)
    const [x, z] = pointerWorld(e);
    setFinger(x, z);
  });
  const up = (e) => {
    if (e.pointerId !== pid) return;
    pid = null;
    finger.down = false;
    flush(true);
    draw();
  };
  pad.addEventListener('pointerup', up);
  pad.addEventListener('pointercancel', up);
  pad.addEventListener('lostpointercapture', up);
  pad.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- 시험용 자동 움직임(센서 없는 PC·?debug) ----------
  let autoTimer = null;
  function stopAuto() {
    if (!autoTimer) return;
    clearInterval(autoTimer);
    autoTimer = null;
    $('btnAuto').classList.remove('on');
    $('btnAuto').textContent = '자동 움직이기(시험)';
  }
  $('btnAuto').addEventListener('click', () => {
    audio();
    if (autoTimer) {
      stopAuto();
      return;
    }
    const t0 = performance.now();
    $('btnAuto').classList.add('on');
    $('btnAuto').textContent = '자동 움직임 끄기';
    autoTimer = setInterval(() => {
      // 8자 모양으로 좌우·앞뒤를 오가며 같은 setFinger 경로로 보냅니다.
      const r = region();
      const t = (performance.now() - t0) / 1000;
      const cx = (r.x0 + r.x1) / 2;
      const cz = (r.z0 + r.z1) / 2;
      const x = cx + Math.sin(t * 2.1) * (r.x1 - r.x0) * 0.42;
      const z = cz + Math.sin(t * 4.2) * (r.z1 - r.z0) * 0.38;
      finger.down = true;
      setFinger(x, z);
    }, 20);
  });

  // ---------- 화면 상태 ----------
  function teamNames() {
    const p = mine();
    const T = state.teams || [];
    if (!p || !T.length) return null;
    return { mine: T[p.team], opp: T[1 - p.team], ti: p.team };
  }
  function renderScore(bump) {
    const p = mine();
    const tn = teamNames();
    if (!p || !tn) return;
    const sc = state.score || [0, 0];
    document.documentElement.style.setProperty('--t', tn.mine.color);
    document.documentElement.style.setProperty('--o', tn.opp.color);
    $('scMeN').textContent = `우리 ${tn.mine.name}`;
    $('scOpN').textContent = tn.opp.name;
    const a = $('scMe');
    const b = $('scOp');
    a.textContent = sc[tn.ti];
    b.textContent = sc[1 - tn.ti];
    if (bump === 'me' || bump === 'op') {
      const el = bump === 'me' ? a : b;
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
    const mp = sc.some((s) => s === (state.target || 7) - 1);
    const LV = { easy: '쉬움', normal: '보통', hard: '어려움' };
    $('scGoal').textContent = mp ? '매치 포인트' : `${state.target || 7}점 선승${LV[state.difficulty] ? ` · ${LV[state.difficulty]}` : ''}`;
  }
  function sideText(p) {
    if (!p) return '';
    const where = p.side === 'bottom' ? '아래쪽' : '위쪽';
    const lane = p.lane === 'left' ? ' · 왼쪽 레인' : p.lane === 'right' ? ' · 오른쪽 레인' : '';
    const mates = p.mates && p.mates.length ? ` · 팀원 ${p.mates.join(', ')}` : '';
    return `${where}${lane}${mates} · 상대 ${p.opp}`;
  }
  function renderStats() {
    const st = state.stats && me ? state.stats[me.slot] : null;
    $('myStats').innerHTML = st
      ? `<span class="chip">골<b>${st.goals}</b></span><span class="chip">타격<b>${st.hits}</b></span><span class="chip">최고<b>${st.top || 0}km/h</b></span>`
      : '';
  }
  // ---------- 준비(모두 준비) ----------
  // 서버가 들어온 사람 모두의 준비를 모아 시작합니다. 준비 취소 이벤트는 서버에 없어서, 누른 뒤에는 '준비 완료 ✓' 로 기다립니다.
  let players = []; // 서버 players
  let readySt = null; // 서버 ready_state { ready, players, away, need }
  let readyPressed = false;
  let noteTimer = null;
  function goNote(t, ms = 2400) {
    const el = $('goNote');
    el.textContent = t || '';
    clearTimeout(noteTimer);
    if (t) noteTimer = setTimeout(() => { el.textContent = ''; }, ms);
  }
  function paintReady() {
    const btn = $('btnGo');
    const over = state.phase === 'over';
    btn.classList.toggle('done', readyPressed);
    const st = readySt;
    const n = st ? st.ready.length : 0;
    const need = st ? st.need : 0;
    if (readyPressed) {
      $('goT').textContent = '준비 완료 ✓';
      $('goS').textContent = need > 1 ? `다른 사람 기다리는 중 · ${n}/${need}` : '곧 시작해요';
    } else {
      $('goT').textContent = over ? '다시 하기' : '준비';
      $('goS').textContent = need > 1 ? `모두 준비하면 시작 · 지금 ${n}/${need}` : '누르면 바로 시작해요';
    }
    // 누가 준비했는지(폰에도 보여 줍니다). 이 줄이 보이면 ready.js 의 아래 띠는 겹치니 숨깁니다.
    const ro = $('roster');
    const list = (st && st.players) || players.map((x) => x.slot);
    const show = mode === 'wait' && state.phase !== 'playing' && list.length > 0;
    ro.classList.toggle('hidden', !show);
    document.body.classList.toggle('roster-on', show);
    if (!show) return;
    const away = (st && st.away) || [];
    const COL = { 1: '#ff5a5f', 2: '#3ab4ff', 3: '#ffc93c', 4: '#5ee07a' };
    ro.innerHTML = `<span>준비 ${n}/${need || list.length}</span>` + list.map((s) => {
      const on = st && st.ready.includes(s);
      const cls = 'rp' + (on ? ' on' : '') + (me && s === me.slot ? ' you' : '') + (away.includes(s) ? ' away' : '');
      return `<span class="${cls}" style="--pc:${COL[s] || '#fff'}"><b>${s}P</b>${on ? '✓' : away.includes(s) ? '끊김' : '대기'}</span>`;
    }).join('');
  }

  function render() {
    if (!me) return;
    const p = mine();
    const phase = state.phase;
    if (phase === 'playing' && p) {
      // 연습 중에 경기가 시작되면(이미 준비를 눌러 둔 채 다시 하기를 열었을 때) 연습을 닫고 바로 경기로
      if (tut.isRunning()) tut.cancel();
      if (mode !== 'play') {
        mode = 'play';
        finger.x = null;
        flip = loadFlip(p.side);
        paintFlip();
        show('vPlay');
        layout();
        $('tools').classList.toggle('hidden', isTouch && !DEBUG);
        $('tip').textContent = tipText(p);
        document.body.classList.remove('roster-on');
      }
      renderScore();
      const st = state.sub === 'countdown' ? '준비… 곧 시작해요' : state.sub === 'final' ? '경기 끝!' : '';
      $('status').textContent = st;
      layout();
      draw();
      return;
    }
    stopAuto();
    pid = null;
    finger.down = false;
    mode = 'wait';
    $('btnGo').style.display = '';
    $('tutLink').style.display = '';
    const ws = $('waitSide');
    if (phase === 'over') {
      const tn = teamNames();
      const won = tn && state.winner === tn.ti;
      $('waitT').textContent = !tn ? '경기 끝' : won ? '승리!' : '패배';
      $('waitT').className = 'big' + (won ? ' win' : '');
      const sc = state.score || [0, 0];
      $('waitB').textContent = tn ? `${sc[tn.ti]} : ${sc[1 - tn.ti]} · 큰 화면에서 결과를 확인하세요.` : '큰 화면에서 결과를 확인하세요.';
      ws.classList.add('hidden');
      renderStats();
    } else if (phase === 'playing') {
      $('waitT').textContent = '경기 중';
      $('waitT').className = 'big';
      $('waitB').textContent = '지금 경기가 끝나면 다음 판부터 함께해요.';
      $('btnGo').style.display = 'none';
      ws.classList.add('hidden');
      $('myStats').innerHTML = '';
    } else {
      $('waitT').textContent = '대기실';
      $('waitT').className = 'big';
      $('waitB').textContent = '모두 준비를 누르면 시작해요.\n혼자면 CPU, 둘이면 1:1, 셋·넷이면 2:2 예요.';
      if (p) {
        ws.classList.remove('hidden');
        document.documentElement.style.setProperty('--t', p.teamColor || me.color);
        $('waitSideT').textContent = sideText(p);
      } else {
        ws.classList.add('hidden');
      }
      $('myStats').innerHTML = '';
    }
    show('vWait');
    paintReady();
  }

  // ---------- 난이도(큰 화면이 주인) ----------
  const ps = createPhoneSettings({ socket });
  ps.attach(socket);
  ps.mount($('setBox'));
  ps.bindReady($('btnGo'));
  // 진동: 큰 화면이 보내는 공통 haptic 도 받습니다(내 자리 것만).
  haptics.listen(socket, { slot: () => (me ? me.slot : null) });

  // ---------- 튜토리얼: 연습 판에서 직접 해 보기 ----------
  let practice = null; // 지금 단계의 연습 판(시험용 자동 손가락에 씀)
  const goalW = () => (state.rink && state.rink.goal) || 0.38;
  const stage = (kind) => (el, api) => {
    practice = createPractice(el, {
      kind,
      color: myColor,
      goal: goalW(),
      onEvent: (name, data) => {
        api.signal(name, data);
        if (practice) practice.celebrate();
      },
      onFail: (msg) => api.fail(msg)
    });
    if (autoTut) practice.setAuto(true);
    const mine = practice;
    return () => {
      mine.destroy();
      if (practice === mine) practice = null;
    };
  };
  let autoTut = false;
  const tut = createTutorial({
    key: 'airhockey',
    socket,
    title: '에어하키 · 처음이라 연습해 봐요',
    steps: [
      { title: '엄지로 말렛 움직이기', body: '화면을 누른 채 끌어서 빛나는 원 3개를 지나가요.', waitFor: 'drag', hint: '원 3개 지나가기', okText: '잘 따라와요!', render: stage('drag') },
      { title: '퍽 치기', body: '말렛으로 퍽을 툭 쳐요. 칠 때마다 폰이 떨려요.', waitFor: 'hit', count: 2, hint: '퍽 두 번 치기', okText: '딱 좋아요!', render: stage('hit') },
      { title: '세게 밀어 슛', body: '퍽 아래에서 위쪽(상대 쪽)으로 휙 밀어 쳐요.', waitFor: 'goal', hint: '위로 세게 밀기', okText: '멋진 슛!', render: stage('shoot') },
      { title: '내 골문 막기', body: '내려오는 퍽 앞에 말렛을 두고 막아요.', waitFor: 'block', hint: '퍽 막기', okText: '철벽 수비!', render: stage('block') }
    ],
    finish: { title: '연습 끝!', body: '경기 중에는 큰 화면을 보면서\n폰 화면을 똑같이 밀면 돼요.\n이제 준비를 눌러요.', button: '좋아요' },
    onDone: () => render()
  });
  tut.link($('tutLink'));

  // ---------- 소켓 ----------
  socket.on('connect', () => socket.emit('join', { role: 'controller', room: ROOM, token }));
  socket.on('assigned', (p) => {
    if (p.game !== 'airhockey') {
      location.replace(p.game === 'baseball' ? `/play/?room=${ROOM}` : `/play/${p.game}/?room=${ROOM}`);
      return;
    }
    me = p;
    noRoomTries = 0;
    document.documentElement.style.setProperty('--c', p.color);
    $('me').textContent = p.name;
    if (mode === 'msg' || mode === 'start') mode = 'wait';
    render();
  });
  socket.on('players', (d) => {
    players = (d && d.players) || [];
    if (mode === 'wait') paintReady();
  });
  // 모두 준비 상태: 서버 값을 따라 버튼 모양과 준비 현황을 맞춥니다.
  socket.on('ready_state', (st) => {
    if (!st) return;
    readySt = { ready: st.ready || [], players: st.players || [], away: st.away || [], need: st.need || 0 };
    readyPressed = Boolean(me && readySt.ready.includes(me.slot));
    if (mode === 'wait') paintReady();
  });
  socket.on('no_room', () => {
    // 서버가 막 다시 떴으면 큰 화면이 같은 코드로 방을 다시 만들 때까지 잠깐 기다립니다.
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
  socket.on('disconnect', () => {
    if (mode === 'play') $('status').textContent = '연결이 잠깐 끊겼어요…';
  });
  socket.on('game_state', (s) => {
    const prevScore = (state.score || [0, 0]).slice();
    const prevPhase = state.phase;
    state = s || { phase: 'lobby' };
    // 경기가 시작되거나 대기실로 돌아오면 다음 판은 다시 준비를 눌러야 합니다.
    if (state.phase !== prevPhase && (state.phase === 'playing' || state.phase === 'lobby')) readyPressed = false;
    if (mode === 'msg' && !me) return;
    render();
    // 점수 바뀐 쪽 강조
    const tn = teamNames();
    if (tn && state.score && (state.score[0] !== prevScore[0] || state.score[1] !== prevScore[1])) {
      renderScore(state.score[tn.ti] !== prevScore[tn.ti] ? 'me' : 'op');
    }
  });
  // 내 말렛이 퍽을 쳤어요(큰 화면 판정): 진동(아이폰은 번쩍+틱) + 딸깍 소리 + 패드 고리
  socket.on('hit', (d) => {
    const q = Math.max(0, Math.min(1, Number(d && d.strength) || 0.3));
    if (d && d.strong) haptics.play('strong', q, { silent: true });
    else haptics.hit(q, { silent: true });
    click(q);
    flashT = 1;
    if (!anim) anim = requestAnimationFrame(animate);
  });
  let overTimer = null;
  socket.on('goal', (d) => {
    const p = mine();
    if (!p || !d) return;
    const ours = d.team === p.team;
    const el = $('over');
    el.classList.toggle('bad', !ours);
    $('overT').textContent = ours ? (d.scorer === me.slot ? '내 골!' : '골!') : d.final ? '패배' : '실점';
    el.classList.add('on');
    clearTimeout(overTimer);
    overTimer = setTimeout(() => el.classList.remove('on'), 1500);
    if (ours) {
      haptics.play('success', 1, { pattern: [60, 40, 60, 40, 160], silent: true });
      [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.18, 0.12, 'triangle', i * 0.08));
    } else {
      haptics.play('fail', 1, { pattern: [300], silent: true });
      tone(330, 0.5, 0.14, 'sawtooth', 0, 0.5);
    }
    $('pad').classList.remove('flash');
    void $('pad').offsetWidth;
    $('pad').classList.add('flash');
  });

  // ---------- 버튼 ----------
  $('btnStart').addEventListener('click', () => {
    // 화면 꺼짐 방지는 탭 안에서 await 전에 바로 불러야 iPhone 에서 통합니다. 동작 센서 권한은 필요 없습니다.
    keepAwake();
    audio();
    haptics.unlock();
    if (!ROOM) {
      message('방 코드가 없어요', '큰 화면의 QR을 찍어 주세요.');
      return;
    }
    message('들어가는 중…', '큰 화면과 연결하고 있어요.');
    socket.connect();
    // 처음 하는 폰이면 바로 연습 판을 띄웁니다(그동안 자리 잡기는 뒤에서 이어지고, 큰 화면엔 '연습 중'이 뜹니다).
    if (tut.firstTime()) tut.run();
  });
  $('btnGo').addEventListener('click', () => {
    keepAwake();
    audio();
    haptics.unlock();
    if (readyPressed) {
      goNote('모두 준비하면 바로 시작해요');
      return;
    }
    if (!send('start_game', {})) {
      goNote('연결 중이에요. 잠시 뒤 다시 눌러 주세요');
      return;
    }
    // 서버 ready_state 가 오기 전에도 바로 눌린 모양으로(다음 ready_state 가 맞춰 줌)
    readyPressed = true;
    haptics.tick();
    paintReady();
  });
  function paintFlip() {
    $('btnFlip').classList.toggle('on', flip);
    $('btnFlip').textContent = flip ? '↕ 뒤집힘' : '↕ 뒤집기';
  }
  paintFlip();
  $('btnFlip').addEventListener('click', () => {
    flip = !flip;
    paintFlip();
    const p = mine();
    if (p) {
      try { localStorage.setItem(flipKey(p.side), flip ? '1' : '0'); } catch (e) {}
      $('tip').textContent = tipText(p);
    }
    draw();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && mode !== 'start') keepAwake();
  });
  if (!window.isSecureContext) {
    const b = $('banner');
    b.textContent = 'http 주소라 화면 꺼짐 방지가 안 될 수 있어요. 경기 중 화면이 꺼지지 않게 해 주세요.';
    b.classList.remove('hidden');
    setTimeout(() => b.classList.add('hidden'), 6000);
  }

  // ---------- 디버그 (&debug) ----------
  if (DEBUG) {
    let lastCount = 0;
    setInterval(() => {
      const p = mine();
      $('debug').textContent = `move ${(sentCount - lastCount) * 2}/s · ${socket.connected ? 'on' : 'off'} · ${p ? `${p.side}/${p.lane}` : '-'} · flip ${flip ? 'Y' : 'N'} · ${state.phase}/${state.sub || ''}`;
      lastCount = sentCount;
    }, 500);
  }
  window.__ahPad = {
    state: () => state, me: () => me, setFinger, region, tut, ps,
    /** 시험: 튜토리얼 연습 판을 자동 손가락으로 풀기(헤드리스 확인용) */
    tutAuto(on = true) { autoTut = Boolean(on); if (practice) practice.setAuto(autoTut); },
    practice: () => (practice ? practice.state : null)
  };
})();
