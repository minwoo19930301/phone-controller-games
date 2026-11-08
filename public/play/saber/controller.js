// 광선검 컨트롤러. 폰이 칼자루입니다.
// 폰 방향(pose)을 경기 중에만 큰 화면으로 흘려보내고, 빠른 휘두르기는 폰에서 직접 잡아 swing 으로 보냅니다.
// 칼날 소리(웅웅 · 휘두르는 바람 소리 · 부딪는 소리)는 모두 이 폰 스피커에서 냅니다.
// 좌표는 자세를 맞출 때 정한 기준축으로 보냅니다: u = 위, f = TV 쪽(화면이 나를 보던 방향의 반대), r = f × u = 오른쪽.
// 대기 화면: 모드(로봇 검투 · 드론 훈련)·난이도(큰 화면이 정한 값, 공통 phone-settings), 준비(모두 준비하면 시작), 처음이면 연습(공통 tutorial).
// 진동: 휘두르는 순간 폰이 가볍게 울리고, 큰 화면이 막기·베기·피격을 판정하면 d2c haptic 으로 울립니다(겹치면 한 번만).
import { haptics } from '/common/haptics.js';
import { createPhoneSettings } from '/common/phone-settings.js';
import { createTutorial } from '/common/tutorial.js';

(() => {
  const $ = (id) => document.getElementById(id);
  const RD = Math.PI / 180;
  const params = new URLSearchParams(location.search);
  const ROOM = (params.get('room') || '').toUpperCase();
  const DEBUG = params.has('debug');
  $('room').textContent = ROOM ? `방 ${ROOM}` : '';

  // ---------- 조정 값 (실폰 검증 전이라 바뀔 수 있습니다) ----------
  const POSE_MS = 25; // pose 전송 간격, 약 40Hz
  const TRIGGER_DPS = 280; // 회전 속도(도/초)가 이 값을 넘으면 휘두르기 시작
  const COOLDOWN_MS = 260; // 휘두르기 사이 최소 간격
  const WINDOW_MS = 80; // 시작 뒤 최고값을 모으는 시간
  const HUM_FULL_DPS = 900; // 이 회전 속도면 웅웅 소리가 가장 높고 큼
  const CAL_GUARD_MS = 400; // 자세를 맞춘 직후 흔들림은 휘두르기로 보지 않음
  const SENSOR_WAIT_MS = 1500; // 이 시간 안에 동작 센서 값이 없으면 버튼 모드
  const TILT_SIDE = 22; // 연습: 칼끝이 이만큼(도) 기울면 그쪽 막기
  const TILT_HOLD_MS = 260; // 연습: 그 자세로 이만큼 버티면 인정
  const PLAY_URL = (g) => (g === 'baseball' ? '/play/' : `/play/${g}/`);

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
  const isTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  let me = null;
  let state = { phase: 'lobby' };
  let roster = [];
  let mode = 'start'; // start | connecting | msg | wait | cal | count | play | idle
  let gotOri = false;
  let gotMotion = false;
  let fallback = false;
  let permDenied = false;
  let pendingCal = false;
  let noRoomTries = 0;
  let helpOn = false; // 동작 센서 켜는 법 안내를 보여 주는 중
  let displayOn = true; // 큰 화면이 방에 붙어 있음

  function show(id) {
    for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === id);
    $('btnRecal').classList.toggle('hidden', !(id === 'vPlay' && gotOri && !fallback));
    document.body.classList.toggle('lit', id === 'vPlay');
  }
  function message(t, b, btn) {
    helpOn = false;
    mode = 'msg';
    // 경기 화면을 떠나니 칼을 끄고 웅웅 소리도 멈춥니다.
    humSet(false);
    $('blade').style.setProperty('--len', '0');
    $('msgT').textContent = t;
    $('msgB').textContent = b || '';
    $('btnMsg').classList.toggle('hidden', !btn);
    if (btn) {
      $('btnMsg').textContent = btn.label;
      $('btnMsg').onclick = btn.onClick;
    }
    show('vMsg');
  }
  function banner(text) {
    $('banner').textContent = text || '';
    $('banner').classList.toggle('hidden', !text);
  }

  // ---------- 작은 벡터·사원수 계산 ----------
  function qFromEuler(x, y, z) {
    // three.js 의 'YXZ' 순서와 같습니다.
    const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
    return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
  }
  function qRot(q, v) {
    const [x, y, z, w] = q;
    const ix = w * v[0] + y * v[2] - z * v[1];
    const iy = w * v[1] + z * v[0] - x * v[2];
    const iz = w * v[2] + x * v[1] - y * v[0];
    const iw = -x * v[0] - y * v[1] - z * v[2];
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
  }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const r3 = (v) => [Math.round(v[0] * 1000) / 1000, Math.round(v[1] * 1000) / 1000, Math.round(v[2] * 1000) / 1000];

  // deviceorientation 값을 세계 좌표(위 = +Y)의 방향으로 바꿉니다. 골프와 같은 변환입니다.
  // 이 좌표에서 폰 윗부분 = (0,0,-1), 화면 바깥 = (0,1,0) 입니다.
  function deviceVectors(alpha, beta, gamma) {
    const q = qFromEuler(beta * RD, alpha * RD, -gamma * RD);
    return { top: qRot(q, [0, 0, -1]), face: qRot(q, [0, 1, 0]) };
  }

  // ---------- 기준축 ----------
  let basis = null; // { r, u, f }
  let calAt = -1e9;
  function makeBasis(top, face) {
    const u = [0, 1, 0];
    // 화면이 나를 보게 쥐었으니, 화면 방향의 반대(수평 성분)가 TV 쪽입니다.
    let f = [-face[0], 0, -face[2]];
    // 화면이 위·아래를 보면(폰을 눕혀 쥠) 폰 윗부분이 TV 쪽입니다.
    if (Math.hypot(f[0], f[2]) < 0.25) f = [top[0], 0, top[2]];
    f = norm(f);
    return { r: norm(cross(f, u)), u, f };
  }
  const inBasis = (b, v) => [dot(v, b.r), dot(v, b.u), dot(v, b.f)];

  // ---------- 센서 ----------
  let ori = null;
  const oriBuf = [];
  let nextPoseAt = 0;
  let oriCount = 0;
  let motCount = 0;
  function evTime(e) {
    const n = performance.now();
    const ts = e && e.timeStamp;
    return ts > 0 && Math.abs(n - ts) < 1000 ? ts : n;
  }
  const streaming = () => basis && state.phase === 'playing' && myInfo() && mode === 'play';
  function streamPose(top, face, t) {
    if (!streaming() || t < nextPoseAt) return;
    // 다음 보낼 시각을 정해 두는 방식이라 60Hz 이벤트에서도 약 40Hz 가 나옵니다.
    nextPoseAt = Math.max(nextPoseAt + POSE_MS, t + POSE_MS * 0.4);
    send('pose', { s: r3(inBasis(basis, top)), fc: r3(inBasis(basis, face)) }, true);
  }
  function onOrientation(e) {
    if (e.alpha == null && e.beta == null) return;
    const t = evTime(e);
    oriCount += 1;
    ori = deviceVectors(e.alpha || 0, e.beta || 0, e.gamma || 0);
    oriBuf.push({ t, top: ori.top, face: ori.face });
    while (oriBuf.length && oriBuf[0].t < t - 1500) oriBuf.shift();
    if (!gotOri) {
      gotOri = true;
      fallback = false;
      sensorsChanged();
    }
    if (!fallback) {
      streamPose(ori.top, ori.face, t);
      feedTilt(performance.now());
    }
  }

  // ---------- 칼 기울기(막기 방향) ----------
  // 칼 방향을 앞에서 본 기울기 th(도): 0 = 똑바로 위, - 왼쪽, + 오른쪽. 큰 화면의 판정과 같은 식입니다.
  function curTilt() {
    let s = null;
    if (fallback && fakeTimer) s = inBasis(FAKE_BASIS, fakeVectors().top);
    else if (ori && basis) s = inBasis(basis, ori.top);
    if (!s) return null;
    return { th: Math.atan2(s[0], s[1]) / RD, up: s[1] };
  }
  function zoneOf(t) {
    if (!t) return null;
    if (t.th <= -TILT_SIDE) return 'left';
    if (t.th >= TILT_SIDE) return 'right';
    if (Math.abs(t.th) <= 12 && t.up > 0.3) return 'center';
    return null;
  }
  const blk = { zone: null, since: 0, fired: false, t: null };
  function feedTilt(now) {
    const t = curTilt();
    blk.t = t;
    const z = zoneOf(t);
    if (z !== blk.zone) {
      blk.zone = z;
      blk.since = now;
      blk.fired = false;
    } else if (z && !blk.fired && now - blk.since >= TILT_HOLD_MS) {
      blk.fired = true;
      if (tut.isRunning()) tut.signal('block', { dir: z, th: t.th });
    }
  }

  // 휘두르기: rotationRate 크기(도/초)의 최고값. 방향 표본 차이로 속도를 재지 않습니다(iPhone 은 같은 값이 겹쳐 와서 두 배로 튐).
  let rotNow = 0;
  let swingWin = null;
  let lastTrig = -1e9;
  let lastSwing = null;
  function onMotion(e) {
    const rr = e.rotationRate;
    if (!rr || (rr.alpha == null && rr.beta == null && rr.gamma == null)) return;
    const t = evTime(e);
    motCount += 1;
    if (!gotMotion) {
      gotMotion = true;
      fallback = false;
      sensorsChanged();
    }
    const rot = Math.hypot(rr.alpha || 0, rr.beta || 0, rr.gamma || 0);
    rotNow = rot;
    humDrive(rot);
    if (swingWin) {
      if (rot > swingWin.peak) {
        swingWin.peak = rot;
        swingWin.peakT = t;
      }
      return;
    }
    if (rot > TRIGGER_DPS && t - lastTrig > COOLDOWN_MS && t - calAt > CAL_GUARD_MS && me) {
      lastTrig = t;
      swingWin = { t0: t, peak: rot, peakT: t };
      // 바람 소리는 기다리지 않고 바로 냅니다.
      whoosh(rot);
      setTimeout(finishSwing, WINDOW_MS);
    }
  }
  function finishSwing() {
    const w = swingWin;
    swingWin = null;
    if (!w) return;
    deliverSwing({ speed: Math.round(w.peak), ago: Math.max(0, Math.round(performance.now() - w.peakT)), rtt: Math.round(rtt()) });
  }
  // 센서 휘두르기와 버튼 휘두르기가 같은 길로 나갑니다.
  function deliverSwing(data) {
    lastSwing = { data, at: performance.now() };
    debug(`swing ${JSON.stringify(data)}`);
    const k = clamp((data.speed - 200) / 1000, 0.25, 0.8);
    // 연습 중이면 게임으로 보내지 않고 연습 판정에만 씁니다.
    if (tut.isRunning()) {
      haptics.hit(k);
      tut.signal('swing', data);
      return;
    }
    if (state.phase === 'playing' && myInfo()) {
      send('swing', data);
      // 휘두르는 순간 가볍게(지연 없음). 큰 화면이 막기·베기로 판정하면 그 진동이 한 번 더 옵니다.
      if (mode === 'play') haptics.hit(k * 0.6);
    } else if (mode === 'wait') {
      haptics.tick();
      $('practice').textContent = `연습 휘두르기 · ${data.speed}°/s`;
    }
  }

  // ---------- 서버까지 왕복 시간 ----------
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

  // ================================================================
  // 소리: 웅웅(겹친 톱니파 + 저역 필터), 휘두를 때 바람, 점화·꺼짐, 부딪힘, 피격, 격추
  // ================================================================
  let actx = null;
  let out = null;
  function audio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      // iPhone 은 기본값(ambient)이면 무음 스위치를 따라 칼 소리가 전부 꺼집니다. 재생 종류로 바꿔 둡니다(iOS 17+).
      if (navigator.audioSession) {
        try { navigator.audioSession.type = 'playback'; } catch (e) {}
      }
      if (AC) {
        actx = new AC();
        out = actx.createDynamicsCompressor();
        out.threshold.value = -10;
        out.ratio.value = 3;
        out.connect(actx.destination);
      }
    }
    // iOS 는 전화·Siri 뒤 'interrupted' 상태로 둘 수 있어 'running' 이 아니면 모두 다시 켭니다.
    if (actx && actx.state !== 'running') Promise.resolve(actx.resume()).catch(() => {});
    return actx;
  }
  let noiseBuf = null;
  function noiseBuffer() {
    if (noiseBuf) return noiseBuf;
    const a = actx;
    const len = Math.floor(a.sampleRate * 1.5);
    noiseBuf = a.createBuffer(1, len, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }
  function noise(sec, f0, f1, q, gain, type = 'bandpass', attack = 0.005) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime;
    const src = a.createBufferSource();
    src.buffer = noiseBuffer();
    const f = a.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + sec);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + sec + 0.05);
  }
  function tone(freq, sec, gain, type = 'sine', glide = 0, delay = 0) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + delay;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), t + sec);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + sec + 0.03);
  }

  // 웅웅 소리: 살짝 어긋난 톱니파 둘 + 낮은 사인 + 윙윙 떨림. 회전이 빠를수록 높고 크고 밝아집니다.
  const hum = { on: false, nodes: null, level: 0, target: 0 };
  function buildHum() {
    const a = audio();
    if (!a || hum.nodes) return;
    const master = a.createGain();
    master.gain.value = 0.0001;
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.Q.value = 5;
    const o1 = a.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = 88;
    const o2 = a.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.value = 88;
    o2.detune.value = 14;
    const o3 = a.createOscillator();
    o3.type = 'sine';
    o3.frequency.value = 44;
    const g3 = a.createGain();
    g3.gain.value = 0.9;
    // 전기적인 떨림(약 6Hz 진폭 변조)
    const lfo = a.createOscillator();
    lfo.frequency.value = 6.3;
    const lfoG = a.createGain();
    lfoG.gain.value = 0.18;
    const am = a.createGain();
    am.gain.value = 0.82;
    lfo.connect(lfoG).connect(am.gain);
    // 지직거림(아주 작은 대역 잡음)
    const nsrc = a.createBufferSource();
    nsrc.buffer = noiseBuffer();
    nsrc.loop = true;
    const nbp = a.createBiquadFilter();
    nbp.type = 'bandpass';
    nbp.frequency.value = 1800;
    nbp.Q.value = 1.2;
    const ng = a.createGain();
    ng.gain.value = 0.05;
    o1.connect(lp);
    o2.connect(lp);
    o3.connect(g3).connect(lp);
    nsrc.connect(nbp).connect(ng).connect(lp);
    lp.connect(am).connect(master).connect(out);
    for (const o of [o1, o2, o3, lfo]) o.start();
    nsrc.start();
    hum.nodes = { master, lp, o1, o2, o3, ng };
  }
  function humSet(on) {
    if (on === hum.on) return;
    hum.on = on;
    buildHum();
    const n = hum.nodes;
    if (!n) return;
    const t = actx.currentTime;
    n.master.gain.cancelScheduledValues(t);
    n.master.gain.setTargetAtTime(on ? 0.2 : 0.0001, t, on ? 0.08 : 0.12);
  }
  let humSmooth = 0;
  function humDrive(rot) {
    const k = clamp(rot / HUM_FULL_DPS, 0, 1);
    // 올라갈 땐 빠르게, 내려올 땐 천천히
    humSmooth += (k - humSmooth) * (k > humSmooth ? 0.5 : 0.12);
    document.documentElement.style.setProperty('--glow', humSmooth.toFixed(3));
    const n = hum.nodes;
    if (!n || !hum.on) return;
    const t = actx.currentTime;
    const f = 88 * (1 + 0.38 * humSmooth);
    n.o1.frequency.setTargetAtTime(f, t, 0.03);
    n.o2.frequency.setTargetAtTime(f, t, 0.03);
    n.o3.frequency.setTargetAtTime(f / 2, t, 0.03);
    n.lp.frequency.setTargetAtTime(420 + 2800 * humSmooth, t, 0.03);
    n.ng.gain.setTargetAtTime(0.05 + 0.25 * humSmooth, t, 0.04);
    n.master.gain.setTargetAtTime(0.2 + 0.24 * humSmooth, t, 0.04);
  }
  // 센서가 쉬어도(가만히 있어도) 웅웅 소리가 천천히 가라앉게
  setInterval(() => {
    if (performance.now() - lastMotionT() > 120) humDrive(fallback ? fakeRot : 0);
  }, 60);
  let lastMot = 0;
  const lastMotionT = () => lastMot;
  window.addEventListener('devicemotion', () => { lastMot = performance.now(); });

  function whoosh(rot) {
    const k = clamp((rot - TRIGGER_DPS) / 900, 0, 1);
    // '츠아악': 대역 잡음이 위로 쓸려 올라갔다 내려옵니다
    noise(0.32 + k * 0.12, 500, 2600 + k * 1200, 1.1, 0.25 + k * 0.35, 'bandpass', 0.03);
    noise(0.22, 1600, 700, 0.9, 0.12 + k * 0.15, 'bandpass', 0.05);
    tone(120 + k * 50, 0.28, 0.08 + k * 0.08, 'sawtooth', 1.6);
  }
  function ignite() {
    noise(0.55, 280, 2400, 1.4, 0.4, 'bandpass', 0.02);
    tone(60, 0.6, 0.22, 'sawtooth', 1.5);
    tone(120, 0.5, 0.1, 'sawtooth', 1.45);
  }
  function retract() {
    noise(0.45, 2200, 260, 1.2, 0.3, 'bandpass', 0.01);
    tone(130, 0.5, 0.15, 'sawtooth', 0.4);
  }
  function clash(big) {
    // '츠캉': 높은 금속성 배음 + 지직거리는 잔향. 칼끼리 부딪히면(big) 더 길고 낮은 울림까지
    noise(0.1, 5200, 5200, 0.7, 0.55, 'highpass', 0.002);
    for (const [f, g] of [[1870, 0.09], [2630, 0.07], [3410, 0.05], [990, 0.07]]) tone(f * (0.97 + Math.random() * 0.06), (big ? 0.45 : 0.28) + Math.random() * 0.1, g, 'sawtooth', 0.9);
    for (let i = 0; i < (big ? 9 : 6); i++) setTimeout(() => noise(0.035, 2500 + Math.random() * 3000, 0, 2, 0.18, 'bandpass', 0.002), 20 + Math.random() * (big ? 360 : 220));
    tone(big ? 90 : 150, big ? 0.3 : 0.12, big ? 0.3 : 0.2, 'sine', 0.5);
  }
  function slashHit(n) {
    // 로봇 장갑을 벰: 지글거림 + 쇠 울림(연타일수록 높게)
    const k = Math.min(3, n || 1);
    noise(0.3, 3400, 900, 0.8, 0.45, 'bandpass', 0.003);
    tone(560 + k * 140, 0.3, 0.12, 'triangle', 0.6);
    tone(150, 0.18, 0.25, 'sine', 0.5);
  }
  function zap() {
    tone(75, 0.34, 0.3, 'square', 0.6);
    tone(52, 0.3, 0.22, 'sawtooth', 0.8);
    noise(0.3, 2800, 400, 0.8, 0.4, 'bandpass', 0.003);
  }
  function boom() {
    noise(0.9, 1200, 90, 0.6, 0.6, 'lowpass', 0.004);
    tone(110, 0.7, 0.3, 'sine', 0.3);
    [1047, 1319, 1568].forEach((f, i) => tone(f, 0.25, 0.08, 'triangle', 1, 0.12 + i * 0.07));
  }
  function fanfare() {
    boom();
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.4, 0.12, 'triangle', 1, 0.25 + i * 0.12));
  }
  const beep = () => tone(1760, 0.07, 0.18, 'square');
  const tick = () => tone(1320, 0.09, 0.25, 'triangle');

  // ---------- 자세 맞추기 ----------
  let countTimer = null;
  function openCal() {
    clearInterval(countTimer);
    mode = 'cal';
    $('calN').classList.add('hidden');
    $('btnReady').classList.remove('hidden');
    $('btnCalCancel').classList.toggle('hidden', !(basis || state.phase !== 'playing' || !myInfo()));
    $('calT').textContent = basis ? '다시 맞춥니다' : '칼자루처럼 쥡니다';
    $('calB').textContent = '폰을 칼자루처럼 세워 쥐고\n화면이 나를 보게 한 뒤 버튼을 누릅니다.';
    show('vCal');
  }
  function startCountdown() {
    if (!gotOri) {
      $('calB').textContent = '방향 센서 값이 들어오지 않아요.\n잠시 뒤 다시 눌러 주세요.';
      return;
    }
    mode = 'count';
    let n = 3;
    $('calN').textContent = n;
    $('calN').classList.remove('hidden');
    $('btnReady').classList.add('hidden');
    $('btnCalCancel').classList.add('hidden');
    $('calT').textContent = '그대로 멈추세요';
    $('calB').textContent = '칼자루를 세워 든 자세 그대로, 화면이 나를 보게 둡니다.';
    tick();
    haptics.tick();
    clearInterval(countTimer);
    countTimer = setInterval(() => {
      n -= 1;
      if (n > 0) {
        $('calN').textContent = n;
        tick();
        haptics.tick();
        return;
      }
      clearInterval(countTimer);
      captureBasis();
    }, 1000);
  }
  // quiet: 연습(튜토리얼) 안에서 맞출 때. 화면을 바꾸지 않고 성공 여부만 돌려줍니다.
  function captureBasis(quiet) {
    const t = performance.now();
    let src = oriBuf.filter((o) => o.t >= t - 250);
    if (!src.length && ori) src = [ori];
    if (!src.length) {
      if (quiet) return false;
      openCal();
      $('calB').textContent = '방향 센서 값이 끊겼어요.\n다시 버튼을 눌러 주세요.';
      return false;
    }
    const top = norm(src.reduce((a, o) => add(a, o.top), [0, 0, 0]));
    const face = norm(src.reduce((a, o) => add(a, o.face), [0, 0, 0]));
    basis = makeBasis(top, face);
    calAt = t;
    nextPoseAt = 0;
    announceCal();
    tone(1320, 0.12, 0.3);
    debug(`calibrate f=${basis.f.map((x) => x.toFixed(2))} top=${top.map((x) => x.toFixed(2))} face=${face.map((x) => x.toFixed(2))}`);
    if (quiet) return true;
    haptics.play('success');
    mode = 'idle';
    // 준비를 눌렀는데 자세가 없어서 맞춘 것이면, 맞추자마자 준비 완료로 넘어갑니다.
    if (pendingReady) {
      pendingReady = false;
      sendReady();
    }
    render();
    return true;
  }
  // 큰 화면은 이 신호로 칼 기준을 다시 잡습니다. 이 뒤의 pose 는 새 기준축 값입니다.
  function announceCal() {
    if (!send('calibrate', {})) pendingCal = true;
  }

  // ---------- 센서 없는 PC: 끌어서 칼 방향, 버튼으로 휘두르기 ----------
  // 같은 기준축 계산(inBasis)과 pose/swing 전송 길을 그대로 씁니다.
  const FAKE_BASIS = { r: [1, 0, 0], u: [0, 1, 0], f: [0, 0, -1] };
  const fake = { yaw: -12, pitch: 58, sweep: 0 };
  // 검투 막기 버튼: 칼끝 방향(yaw 좌우, pitch 위아래)
  const FAKE_ZONE = { left: [-70, 30], right: [70, 30], overhead: [-76, 2], center: [0, 75] };
  let fakeRot = 0;
  let fakeTimer = null;
  function fakeVectors() {
    const y = (fake.yaw + fake.sweep * 75) * RD;
    const p = (fake.pitch - Math.abs(fake.sweep) * 25) * RD;
    const B = FAKE_BASIS;
    const top = norm(add(scale(B.u, Math.sin(p)), scale(add(scale(B.r, Math.sin(y)), scale(B.f, Math.cos(y))), Math.cos(p))));
    // 화면은 나(뒤) 쪽을 보게
    const back = scale(B.f, -1);
    const face = norm(add(back, scale(top, -dot(back, top))));
    return { top, face };
  }
  function startFake() {
    if (fakeTimer) return;
    basis = FAKE_BASIS;
    if (me) announceCal();
    else pendingCal = true;
    let prev = fakeVectors().top;
    let prevT = performance.now();
    fakeTimer = setInterval(() => {
      const t = performance.now();
      const v = fakeVectors();
      // 웅웅 소리용 회전 속도(시험 모드에서만 방향 차이로 어림합니다)
      const ang = Math.acos(clamp(dot(prev, v.top), -1, 1)) / RD;
      fakeRot = fakeRot * 0.6 + (ang / Math.max(0.001, (t - prevT) / 1000)) * 0.4;
      prev = v.top;
      prevT = t;
      streamPose(v.top, v.face, t);
      feedTilt(t);
      drawPadDot();
    }, POSE_MS);
  }
  function drawPadDot() {
    const pad = $('pad');
    const w = pad.clientWidth;
    const h = pad.clientHeight;
    const x = ((fake.yaw + 70) / 140) * w;
    const y = (1 - (fake.pitch + 10) / 100) * h;
    $('padDot').style.left = `${x.toFixed(0)}px`;
    $('padDot').style.top = `${y.toFixed(0)}px`;
  }
  function padSet(e) {
    const r = $('pad').getBoundingClientRect();
    fake.yaw = clamp(((e.clientX - r.left) / r.width) * 140 - 70, -80, 80);
    fake.pitch = clamp((1 - (e.clientY - r.top) / r.height) * 100 - 10, -10, 90);
  }
  let padDown = false;
  $('pad').addEventListener('pointerdown', (e) => {
    padDown = true;
    $('pad').setPointerCapture(e.pointerId);
    padSet(e);
  });
  $('pad').addEventListener('pointermove', (e) => {
    if (padDown) padSet(e);
  });
  const padUp = () => { padDown = false; };
  $('pad').addEventListener('pointerup', padUp);
  $('pad').addEventListener('pointercancel', padUp);
  function fakeSwing() {
    audio();
    // 지금 칼끝 쪽에서 반대쪽으로 0.2초 동안 쓸어 내립니다.
    const t0 = performance.now();
    const dir = fake.yaw > 20 ? -1 : 1;
    const run = () => {
      const u = (performance.now() - t0) / 200;
      fake.sweep = u < 1 ? (0.5 - u) * dir : 0;
      if (u < 1) requestAnimationFrame(run);
    };
    requestAnimationFrame(run);
    whoosh(950);
    deliverSwing({ speed: 950, ago: 0, rtt: Math.round(rtt()) });
  }
  function fakeZone(z) {
    const p = FAKE_ZONE[z];
    if (!p) return;
    audio();
    fake.yaw = p[0];
    fake.pitch = p[1];
    haptics.tick();
  }
  $('btnSwing').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    fakeSwing();
  });
  $('btnGuard').addEventListener('click', () => {
    fake.yaw = -12;
    fake.pitch = 58;
  });
  for (const b of document.querySelectorAll('#dpads button')) {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      fakeZone(b.dataset.z);
    });
  }
  document.addEventListener('keydown', (e) => {
    if (!fallback || (mode !== 'play' && !tut.isRunning())) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) fakeSwing();
    } else if (e.key === 'ArrowLeft') fake.yaw = clamp(fake.yaw - 8, -80, 80);
    else if (e.key === 'ArrowRight') fake.yaw = clamp(fake.yaw + 8, -80, 80);
    else if (e.key === 'ArrowUp') fake.pitch = clamp(fake.pitch + 8, -10, 90);
    else if (e.key === 'ArrowDown') fake.pitch = clamp(fake.pitch - 8, -10, 90);
    else if (e.key === 'q' || e.key === 'Q') fakeZone('left');
    else if (e.key === 'w' || e.key === 'W') fakeZone('overhead');
    else if (e.key === 'e' || e.key === 'E') fakeZone('right');
  });

  // ---------- 화면 상태 ----------
  function myInfo() {
    if (!me || !state || !state.players) return null;
    return state.players[me.slot] || state.players[String(me.slot)] || null;
  }
  const curMode = () => (state && (state.mode === 'drone' || state.mode === 'duel') ? state.mode : ps.get('mode') || 'duel');
  function setChips(list, target) {
    const box = $(target);
    box.textContent = '';
    for (const [k, v, cls] of list) {
      const c = document.createElement('span');
      c.className = `chip${cls ? ` ${cls}` : ''}`;
      if (k) c.append(k);
      if (v != null && v !== '') {
        const b = document.createElement('b');
        b.textContent = v;
        c.append(b);
      }
      box.append(c);
    }
  }
  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const RESULT_TEXT = { win: '승리!', tw: '판정승', tl: '판정패', ko: '패배' };

  let lastStage = null;
  let lastResult = null;
  function showPlay(info) {
    mode = 'play';
    const duel = curMode() === 'duel';
    $('fallback').classList.toggle('hidden', !fallback);
    document.body.classList.toggle('fb', fallback);
    $('dpads').classList.toggle('hidden', !duel);
    $('fallbackHint').textContent = fallbackReason();
    const live = state.stage === 'live' && !info.down && displayOn;
    // 칼날: 경기가 진행 중이면 켜짐, 쓰러지거나 끝나거나 큰 화면이 꺼지면 꺼짐
    $('blade').style.setProperty('--len', live ? '1' : '0');
    humSet(live && !document.hidden);
    $('score').textContent = Number(info.score || 0).toLocaleString('ko-KR');
    const hp = clamp(Number(info.hp ?? 100), 0, 100);
    $('hpT').textContent = String(hp);
    $('hpFill').style.width = `${hp}%`;
    $('hpBar').classList.toggle('low', hp <= 30 && hp > 0);
    const robot = duel ? info.robot : null;
    $('robotRow').classList.toggle('hidden', !robot);
    if (robot) {
      $('rName').textContent = robot.name || '로봇';
      $('rHp').textContent = String(Math.max(0, robot.hp));
      $('rFill').style.width = `${clamp(robot.hp, 0, 100)}%`;
      $('robotRow').classList.toggle('open', Boolean(robot.open));
    }
    if (duel) setChips([['막기', info.parries || 0], ['베기', info.strikes || 0], ['남은 시간', fmtTime(state.t || 0)]], 'stats');
    else setChips([['막기', info.deflects || 0], ['격추', info.kills || 0], ['남은 시간', fmtTime(state.t || 0)]], 'stats');
    const st = $('status');
    st.className = 'status';
    if (info.result === 'win') st.textContent = '로봇을 쓰러뜨렸어요! 다른 사람을 기다려요';
    else if (info.down) st.textContent = duel ? '쓰러졌어요. 다른 사람이 끝날 때까지 기다려요' : '쓰러졌어요. 다른 사람이 끝날 때까지 기다려요';
    else if (state.stage === 'intro') st.textContent = duel ? '로봇이 들어와요! 칼을 세워 들고 기다려요' : '곧 시작해요! 칼을 세워 들고 기다려요';
    else if (state.stage === 'end') st.textContent = info.result ? `${RESULT_TEXT[info.result] || '끝'} · 큰 화면을 보세요` : '끝! 큰 화면을 보세요';
    else if (!cueOn) {
      st.textContent = duel
        ? (fallback ? '예고된 쪽 버튼으로 막고, 비틀거리면 휘두르기' : '예고된 쪽으로 칼끝을 기울여 막고, 비틀거리면 베요')
        : (fallback ? '끌어서 칼을 광탄 길목에 대고, 닿을 때 휘두르기' : '광탄 길목에 칼날을 대요. 닿을 때 휘두르면 격추!');
    }
    show('vPlay');
  }

  // ---------- 준비(모두 준비하면 시작) ----------
  let readySt = null; // 서버 ready_state { ready, players, away, need }
  let pendingReady = false; // 준비를 눌렀는데 자세를 먼저 맞추는 중
  let readySent = false; // 눌렀고 서버의 ready_state 를 아직 못 받음(바로 '준비 완료'로 보이게)
  const iAmReady = () => readySent || Boolean(me && readySt && Array.isArray(readySt.ready) && readySt.ready.includes(me.slot));
  function sendReady() {
    if (!send('start_game', {})) return;
    readySent = true;
    haptics.tick();
    if (mode === 'wait') paintReady();
  }
  const COLORS = { 1: '#ff5a5f', 2: '#3ab4ff', 3: '#ffc93c', 4: '#5ee07a' };
  // 준비 버튼과 그 위 '누가 아직 준비 전인지' 줄
  function paintReady() {
    const btn = $('btnGo');
    const over = state.phase === 'over';
    const done = iAmReady();
    btn.classList.toggle('done', done);
    if (done) btn.innerHTML = '준비 완료 ✓<small>다른 사람을 기다려요</small>';
    else btn.textContent = over ? '다시 하기' : '준비';
    const row = $('readyRow');
    const st = readySt;
    const list = st && Array.isArray(st.players) ? st.players : [];
    if (!me || list.length < 2 || state.phase === 'playing') {
      row.classList.add('hidden');
      return;
    }
    const away = st.away || [];
    const notYet = list.filter((x) => !st.ready.includes(x));
    row.innerHTML = list.map((x) => {
      const on = st.ready.includes(x);
      return `<span class="rp${on ? ' on' : ''}${away.includes(x) ? ' off' : ''}${x === me.slot ? ' mine' : ''}" style="--pc:${COLORS[x] || '#fff'}">${x}P${on ? ' ✓' : ''}</span>`;
    }).join('') + `<span class="rt">${notYet.length ? `아직 준비 전: ${notYet.map((x) => `${x}P`).join(' · ')}` : '모두 준비 완료'}</span>`;
    row.classList.remove('hidden');
  }

  function showWait(info) {
    mode = 'wait';
    humSet(false);
    const phase = state.phase;
    const chips = [];
    if (roster.length) chips.push(['참가', `${roster.length}명`]);
    if (fallback) chips.push(['조작', '버튼']);
    else if (gotOri) chips.push(['칼자루 자세', basis ? '맞춤' : '아직', basis ? 'ok' : '']);
    $('btnGo').style.display = '';
    $('setBox').classList.remove('hidden');
    if (phase === 'over') {
      const r = lastResult;
      const res = (info && info.result) || (r && r.result);
      if (res) {
        $('waitT').textContent = RESULT_TEXT[res] || '끝';
        const s = r ? r : info;
        $('waitB').textContent = `${Number(s.score || 0).toLocaleString('ko-KR')}점 · 막기 ${s.parries || 0} · 베기 ${s.strikes || 0}` +
          `${res === 'win' && r && r.winAt != null ? ` · ${r.winAt}초` : ''}\n모두 다시 하기를 누르면 한 판 더 해요.`;
      } else if (info && info.rank) {
        $('waitT').textContent = info.rank === 1 ? '1위!' : `${info.rank}위`;
        $('waitB').textContent = `${Number(info.score || 0).toLocaleString('ko-KR')}점 · 막기 ${info.deflects || 0} · 격추 ${info.kills || 0}\n모두 다시 하기를 누르면 한 판 더 해요.`;
      } else {
        $('waitT').textContent = '경기 끝';
        $('waitB').textContent = r ? r.text : '큰 화면에서 결과를 확인해요.';
      }
    } else if (phase === 'playing') {
      $('waitT').textContent = '관전 중';
      $('waitB').textContent = '지금 판이 끝나면 함께할 수 있어요.';
      $('btnGo').style.display = 'none';
      $('setBox').classList.add('hidden');
    } else {
      $('waitT').textContent = '대기실';
      $('waitB').textContent = basis || fallback || !gotOri
        ? '모두 준비를 누르면 시작해요.'
        : '모두 준비를 누르면 시작해요.\n준비를 누르면 칼자루 자세부터 맞춰요.';
    }
    paintReady();
    setChips(chips, 'waitChips');
    const canCal = gotOri && !fallback;
    $('btnCalLobby').classList.toggle('hidden', !canCal || phase === 'playing');
    $('btnCalLobby').textContent = basis ? '칼자루 자세 다시 맞추기' : '칼자루 자세 맞추기';
    const recent = lastSwing && performance.now() - lastSwing.at < 4000;
    if (!recent) $('practice').textContent = basis && gotMotion && phase !== 'playing' ? '휘둘러 보면 바람 소리가 나요.' : '';
    tut.setLinkVisible(!(phase === 'playing' && myInfo()));
    show('vWait');
  }

  function render() {
    if (!me) return;
    if (mode === 'start' || mode === 'connecting' || mode === 'msg') return;
    if (mode === 'cal' || mode === 'count') return;
    const info = myInfo();
    // 버튼 모드는 기준축이 정해져 있어 자세 맞추기 없이 바로 준비 완료입니다.
    if (fallback) startFake();
    if (state.phase === 'playing' && info) {
      if (tut.isRunning()) tut.cancel(); // 다시 하기로 연습하던 중에 경기가 시작됨
      if (!basis && gotOri && !fallback) {
        openCal();
        return;
      }
      showPlay(info);
      return;
    }
    showWait(info);
  }

  function fallbackReason() {
    let why = '동작 센서가 없어 버튼으로 해요.';
    if (!window.isSecureContext) why = 'https 주소가 아니라 동작 센서가 꺼져 있어요. 버튼으로 해요.';
    else if (permDenied) why = '동작 권한이 거절돼 버튼으로 해요.';
    else if (isTouch) why = '동작 센서 값이 없어 버튼으로 해요. Android 는 주소창 자물쇠 → 사이트 설정 → 동작 센서를 허용해 주세요.';
    return `${why} (키보드: Space 휘두르기 · 방향키 · Q/W/E 막기)`;
  }
  function sensorsChanged() {
    // 센서가 늦게 살아나면 시험 모드를 멈추고, 진짜 자세로 다시 맞추게 합니다.
    if (!fallback && fakeTimer) {
      clearInterval(fakeTimer);
      fakeTimer = null;
      if (basis === FAKE_BASIS) basis = null;
    }
    // 켜는 법 안내를 보는 중에 센서 값이 들어오면 안내를 닫고 센서로 이어서 합니다.
    if (helpOn && mode === 'msg' && !fallback) {
      helpOn = false;
      join();
      return;
    }
    if (mode === 'play') $('fallback').classList.toggle('hidden', !fallback);
    render();
    maybeTutorial();
  }
  function sensorHelp() {
    message('동작 센서를 쓸 수 없어요',
      'iPhone: Safari 를 앱 전환기에서 완전히 닫고 QR을 다시 찍은 뒤, 동작 접근을 허용해 주세요.\nAndroid: 주소창 자물쇠 → 사이트 설정 → 동작 센서를 허용해 주세요.',
      { label: '버튼으로 할게요', onClick: () => { fallback = true; join(); } });
    helpOn = true;
  }
  function keepAwake() {
    if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
  }

  // ---------- 모드·난이도(큰 화면이 정하고, 아무 폰이나 바꿀 수 있음) ----------
  const ps = createPhoneSettings();
  ps.attach(socket);
  ps.mount($('setBox'));
  ps.bindReady($('btnGo'));
  // 큰 화면이 판정한 막기·베기·피격 진동(내 자리 것만)
  haptics.listen(socket, { slot: () => (me ? me.slot : null) });

  // ================================================================
  // 처음 하는 사람 연습(튜토리얼): 칼자루 쥐기 → 왼쪽 막기 → 오른쪽 막기 → 베기
  // ================================================================
  let tutChecked = false;
  let tutLive = null; // 연습 단계 안의 '지금: …' 줄
  // 칼자루 쥐기 그림: 세워 쥔 폰 위로 칼날, 화면은 나를 봄
  const gripArt = () => '<svg class="pcgt-svg" viewBox="0 0 200 160" aria-hidden="true">' +
    '<rect x="96" y="6" width="8" height="78" rx="4" fill="var(--pcgt-c)" opacity=".55"/><rect x="98" y="8" width="4" height="74" rx="2" fill="#fff"/>' +
    '<g transform="translate(100 108)"><rect x="-15" y="-26" width="30" height="58" rx="7" class="pcgt-ph"/><rect x="-11" y="-20" width="22" height="44" rx="3" class="pcgt-scr"/>' +
    '<rect x="-19" y="6" width="38" height="24" rx="10" class="pcgt-hand"/><path d="M-14 13h28M-14 20h28" class="pcgt-handl"/></g>' +
    '<circle cx="100" cy="104" r="32" class="pcgt-ring"><animate attributeName="r" values="30;44" dur="2.2s" repeatCount="indefinite"/>' +
    '<animate attributeName="opacity" values=".7;0" dur="2.2s" repeatCount="indefinite"/></circle>' +
    '<text x="100" y="156" text-anchor="middle" fill="#9aa8bf" font-size="10" font-weight="800">화면이 나를 보게</text></svg>';
  // 막기 그림: 칼끝을 한쪽으로 기울이고, 그쪽에서 로봇 칼(적 색)이 들어옴
  function blockArt(dir) {
    const s = dir === 'left' ? -1 : 1;
    const tip = [100 + s * 62, 34];
    const enemy = dir === 'left' ? 'M14 96 Q44 50 86 44' : 'M186 96 Q156 50 114 44';
    return '<svg class="pcgt-svg" viewBox="0 0 200 160" aria-hidden="true">' +
      `<path d="${enemy}" fill="none" stroke="#ff3ddf" stroke-width="5" stroke-linecap="round" stroke-dasharray="6 7"><animate attributeName="stroke-dashoffset" values="26;0" dur=".7s" repeatCount="indefinite"/></path>` +
      `<g><animateTransform attributeName="transform" type="rotate" values="0 100 128;${s * 38} 100 128;${s * 38} 100 128;0 100 128" keyTimes="0;.3;.75;1" dur="2.2s" repeatCount="indefinite"/>` +
      '<rect x="96" y="22" width="8" height="74" rx="4" fill="var(--pcgt-c)" opacity=".55"/><rect x="98" y="24" width="4" height="70" rx="2" fill="#fff"/>' +
      '<g transform="translate(100 120)"><rect x="-13" y="-24" width="26" height="50" rx="6" class="pcgt-ph"/><rect x="-16" y="4" width="32" height="20" rx="9" class="pcgt-hand"/></g></g>' +
      `<circle cx="${tip[0]}" cy="${tip[1] + 12}" r="9" fill="#fff" opacity="0"><animate attributeName="opacity" values="0;0;.95;0" keyTimes="0;.3;.4;.7" dur="2.2s" repeatCount="indefinite"/></circle>` +
      `<text x="${100 + s * 70}" y="150" text-anchor="middle" fill="#ffc6f1" font-size="12" font-weight="900">${dir === 'left' ? '◀ 왼쪽' : '오른쪽 ▶'}</text></svg>`;
  }
  // 가만히 들고 있으면 차오르는 원
  function holdStage(stage, api) {
    stage.insertAdjacentHTML('beforeend',
      '<svg class="tut-hold" viewBox="0 0 92 92"><circle class="bg" cx="46" cy="46" r="38"/><circle class="fg" cx="46" cy="46" r="38" stroke-dasharray="239" stroke-dashoffset="239"/>' +
      '<text x="46" y="53" text-anchor="middle">0%</text></svg><div class="tut-live"></div>');
    const fg = stage.querySelector('.fg');
    const txt = stage.querySelector('text');
    const live = stage.querySelector('.tut-live');
    if (fallback || !gotOri) {
      live.textContent = '동작 센서가 없어 버튼으로 해요.';
      const row = document.createElement('div');
      row.className = 'tut-row';
      row.innerHTML = '<button type="button" class="tut-btn">버튼으로 할게요</button>';
      row.querySelector('button').addEventListener('click', () => {
        fallback = true;
        startFake();
        api.signal('hold', {});
      });
      stage.append(row);
      return null;
    }
    let raf = 0;
    let stillSince = 0;
    let done = false;
    const NEED = 1300;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (done) return;
      const now = performance.now();
      const recent = oriBuf.filter((o) => o.t >= now - 450);
      const last = recent[recent.length - 1];
      let k = 0;
      let msg = '폰을 세워 쥐고 가만히 있어요';
      if (last) {
        let spread = 0;
        for (const o of recent) spread = Math.max(spread, Math.acos(clamp(dot(o.top, last.top), -1, 1)) / RD);
        const upright = last.top[1] > 0.35;
        const still = spread < 5;
        if (!upright) msg = '폰 윗부분이 위를 보게 세워요';
        else if (!still) msg = '조금만 더 가만히…';
        if (upright && still) {
          if (!stillSince) stillSince = now;
          k = clamp((now - stillSince) / NEED, 0, 1);
          msg = '좋아요, 그대로!';
        } else stillSince = 0;
      }
      fg.setAttribute('stroke-dashoffset', String(Math.round(239 * (1 - k))));
      txt.textContent = `${Math.round(k * 100)}%`;
      live.textContent = msg;
      if (k >= 1) {
        done = true;
        if (captureBasis(true)) api.signal('hold', {});
        else {
          stillSince = 0;
          done = false;
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }
  // 칼 기울기 계기판: 반원 위에 지금 칼 방향, 원하는 쪽이 칠해짐
  function gaugeStage(want) {
    return (stage) => {
      if (!basis && ori && !fallback) captureBasis(true); // 첫 단계를 건너뛰었으면 지금 자세를 기준으로
      if (fallback) startFake();
      const arc = (a0, a1, r = 70) => {
        const p = (a) => [100 + r * Math.sin(a * RD), 104 - r * Math.cos(a * RD)];
        const [x0, y0] = p(a0);
        const [x1, y1] = p(a1);
        return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
      };
      stage.insertAdjacentHTML('beforeend',
        '<svg class="tut-gauge" viewBox="0 0 200 124">' +
        `<path class="zone l${want === 'left' ? ' want' : ''}" d="${arc(-88, -TILT_SIDE)}"/>` +
        `<path class="zone r${want === 'right' ? ' want' : ''}" d="${arc(TILT_SIDE, 88)}"/>` +
        '<line class="bl" x1="100" y1="104" x2="100" y2="40"/><rect class="hl" x="94" y="100" width="12" height="20" rx="3"/>' +
        '<text x="22" y="122" text-anchor="middle">왼쪽</text><text x="178" y="122" text-anchor="middle">오른쪽</text></svg><div class="tut-live"></div>');
      tutLive = stage.querySelector('.tut-live');
      const bl = stage.querySelector('.bl');
      const zl = stage.querySelector('.zone.l');
      const zr = stage.querySelector('.zone.r');
      if (fallback) {
        const row = document.createElement('div');
        row.className = 'tut-row';
        row.innerHTML = `<button type="button" class="tut-btn${want === 'left' ? '' : ' alt'}" data-z="left">◀ 왼쪽</button>` +
          `<button type="button" class="tut-btn${want === 'right' ? '' : ' alt'}" data-z="right">오른쪽 ▶</button>`;
        row.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => fakeZone(b.dataset.z)));
        stage.append(row);
      }
      let raf = 0;
      const frame = () => {
        raf = requestAnimationFrame(frame);
        const t = blk.t || curTilt();
        if (!t) {
          tutLive.textContent = '칼 방향을 읽는 중…';
          return;
        }
        const a = clamp(t.th, -95, 95);
        const x = 100 + 64 * Math.sin(a * RD);
        const y = 104 - 64 * Math.cos(a * RD);
        bl.setAttribute('x2', x.toFixed(1));
        bl.setAttribute('y2', y.toFixed(1));
        const z = zoneOf(t);
        zl.classList.toggle('in', z === 'left');
        zr.classList.toggle('in', z === 'right');
        tutLive.textContent = z === want ? '좋아요, 잠깐 버텨요' : z === 'left' ? '지금: 왼쪽' : z === 'right' ? '지금: 오른쪽' : `지금: 가운데 (${Math.round(t.th)}°)`;
      };
      raf = requestAnimationFrame(frame);
      return () => {
        cancelAnimationFrame(raf);
        tutLive = null;
      };
    };
  }
  function strikeStage(stage) {
    stage.insertAdjacentHTML('beforeend', '<div class="tut-live"></div>');
    tutLive = stage.querySelector('.tut-live');
    if (fallback) {
      const row = document.createElement('div');
      row.className = 'tut-row';
      row.innerHTML = '<button type="button" class="tut-btn">휘두르기</button>';
      row.querySelector('button').addEventListener('pointerdown', (e) => {
        e.preventDefault();
        fakeSwing();
      });
      stage.append(row);
    }
    return () => { tutLive = null; };
  }
  const tut = createTutorial({
    key: 'saber',
    socket,
    title: '처음이라 칼 쓰는 법을 연습해요',
    steps: [
      {
        title: '칼자루 쥐기', body: '폰 아래쪽을 칼자루처럼 쥐고 세워요.\n화면이 나를 보게 들고 잠깐 가만히!',
        svg: gripArt, waitFor: 'hold', hint: '가만히 들고 있어요', okText: '칼자루 자세를 맞췄어요', render: holdStage
      },
      {
        title: '왼쪽 막기', body: '로봇 칼이 왼쪽에서 와요.\n칼끝을 왼쪽으로 기울여 잠깐 버텨요.',
        svg: () => blockArt('left'), waitFor: 'block', hint: '칼끝을 왼쪽으로', okText: '막았어요!',
        check: (d) => d.dir === 'left' || (d.dir === 'right' ? '반대쪽이에요. 칼끝을 왼쪽으로!' : '조금 더 왼쪽으로 기울여요'),
        render: gaugeStage('left')
      },
      {
        title: '오른쪽 막기', body: '이번엔 오른쪽에서 와요.\n칼끝을 오른쪽으로 기울여 버텨요.',
        svg: () => blockArt('right'), waitFor: 'block', hint: '칼끝을 오른쪽으로', okText: '막았어요!',
        check: (d) => d.dir === 'right' || (d.dir === 'left' ? '반대쪽이에요. 칼끝을 오른쪽으로!' : '조금 더 오른쪽으로 기울여요'),
        render: gaugeStage('right')
      },
      {
        title: '베기', body: '막으면 로봇이 비틀거려요.\n그때 크게 휘둘러 베요. 두 번!',
        svg: 'swing', waitFor: 'swing', count: 2, hint: '크게 휘둘러요', okText: '베기 성공!',
        check: (d) => {
          if (tutLive) tutLive.textContent = `휘두르기 ${d.speed}°/s`;
          return d.speed >= 300 || '조금 더 세게 휘둘러요';
        },
        render: strikeStage
      }
    ],
    finish: { title: '연습 끝!', body: '이제 준비를 누르면 돼요.\n큰 화면에서 로봇이 칼을 드는 쪽으로 막고, 비틀거리면 베요.', button: '좋아요' },
    onDone: () => {
      tutLive = null;
      // 버튼 모드: 연습에서 기울인 칼을 가운데로 되돌려 둡니다.
      fake.yaw = -12;
      fake.pitch = 58;
      render();
    }
  });
  tut.link($('tutLink'), {
    // 내가 싸우는 중에는 열지 않습니다(대기 화면에만 있는 링크라 보통은 안 보임).
    before: () => {
      if (state.phase === 'playing' && myInfo()) return false;
      humSet(false);
      return true;
    }
  });
  // 처음이면(이 폰 브라우저에 기록이 없으면) 자리를 받고 센서 여부가 정해진 뒤 연습을 띄웁니다.
  function maybeTutorial() {
    if (tutChecked || !me || !(gotOri || fallback)) return;
    if (mode === 'start' || mode === 'connecting' || mode === 'msg' || mode === 'cal' || mode === 'count') return;
    tutChecked = true;
    if (!tut.firstTime()) return;
    // 경기 중인 내 자리로 다시 들어온 경우는 건너뜁니다(대기 화면의 링크로 언제든 할 수 있음).
    if (state.phase === 'playing' && myInfo()) return;
    humSet(false);
    tut.run();
  }

  // ---------- 경기 중 큰 표시: 공격 예고·빈틈 ----------
  const CUE_ICON = {
    left: '<svg viewBox="0 0 96 70"><path d="M52 8L22 35l30 27"/><path d="M78 8L48 35l30 27"/></svg>',
    right: '<svg viewBox="0 0 96 70"><path d="M44 8l30 27-30 27"/><path d="M18 8l30 27-30 27"/></svg>',
    overhead: '<svg viewBox="0 0 96 70"><path d="M20 40L48 12l28 28"/><path d="M20 62L48 34l28 28"/></svg>',
    thrust: '<svg viewBox="0 0 96 70"><circle cx="48" cy="35" r="27"/><circle cx="48" cy="35" r="14"/><circle cx="48" cy="35" r="4" class="dot"/></svg>',
    open: '<svg viewBox="0 0 96 70"><path d="M16 60L80 10"/><path d="M70 6l14 14"/><path d="M24 30l-10-6M34 20l-4-10" /></svg>'
  };
  const CUE_TEXT = {
    left: ['왼쪽 막기', '칼끝을 왼쪽으로'],
    right: ['오른쪽 막기', '칼끝을 오른쪽으로'],
    overhead: ['위 막기', '칼을 옆으로 눕혀요'],
    thrust: ['찌르기!', '칼을 세우거나 휘둘러 쳐내요']
  };
  let cueOn = false;
  let cueTimer = null;
  function showBigCue(kind, ms, combo) {
    const box = $('dcue');
    const open = kind === 'open';
    const [t, b] = open ? ['지금 베기!', '크게 휘둘러요'] : CUE_TEXT[kind] || CUE_TEXT.left;
    $('dcIc').innerHTML = CUE_ICON[kind] || '';
    $('dcT').textContent = t;
    $('dcB').textContent = b;
    $('dcCb').textContent = combo || '';
    box.className = `dcue${open ? ' open' : ''}`;
    box.style.setProperty('--ms', `${Math.max(200, ms)}ms`);
    void box.offsetWidth;
    box.classList.add('on', 'go');
    // 버튼 모드: 막아야 할 쪽 버튼을 깜빡입니다.
    for (const btn of document.querySelectorAll('#dpads button')) btn.classList.toggle('hot', !open && btn.dataset.z === kind);
    cueOn = true;
    clearTimeout(cueTimer);
    cueTimer = setTimeout(hideBigCue, Math.max(400, ms) + 250);
  }
  function hideBigCue() {
    clearTimeout(cueTimer);
    cueOn = false;
    $('dcue').classList.remove('on', 'go');
    for (const btn of document.querySelectorAll('#dpads button')) btn.classList.remove('hot');
    if (mode === 'play') render();
  }

  // ---------- 소켓 ----------
  function join() {
    mode = 'connecting';
    $('msgT').textContent = '들어가는 중…';
    $('msgB').textContent = '큰 화면과 연결하고 있어요.';
    $('btnMsg').classList.add('hidden');
    show('vMsg');
    if (socket.connected) socket.emit('join', { role: 'controller', room: ROOM, token });
    else socket.connect();
  }
  socket.on('connect', () => {
    measureRtt();
    banner('');
    socket.emit('join', { role: 'controller', room: ROOM, token });
  });
  socket.on('disconnect', () => {
    if (me) banner('서버 연결이 끊겼어요. 다시 잇는 중…');
  });
  socket.on('assigned', (p) => {
    if (!p || p.game !== 'saber') {
      const code = encodeURIComponent((p && p.code) || ROOM);
      location.replace(`${PLAY_URL(p && p.game ? p.game : 'baseball')}?room=${code}`);
      return;
    }
    me = p;
    noRoomTries = 0;
    document.documentElement.style.setProperty('--c', p.color);
    tut.setColor(p.color);
    $('me').textContent = p.name;
    if (pendingCal && basis) {
      pendingCal = false;
      send('calibrate', {});
    }
    // 동작 센서 켜는 법 안내는 연결이 늦게 끝나도 닫지 않습니다(버튼·센서로 닫힘).
    if (mode === 'connecting' || (mode === 'msg' && !helpOn)) mode = 'idle';
    render();
    maybeTutorial();
  });
  socket.on('players', (payload) => {
    roster = payload && Array.isArray(payload.players) ? payload.players : [];
    if (mode === 'wait') render();
  });
  socket.on('ready_state', (st) => {
    readySt = st || null;
    readySent = false;
    if (mode === 'wait') paintReady();
  });
  socket.on('display_status', ({ connected } = {}) => {
    displayOn = Boolean(connected);
    banner(connected ? '' : '큰 화면이 꺼져 있어요. 다시 열리면 이어서 해요.');
    // 경기 화면이면 showPlay 가 칼날과 웅웅 소리를 끄거나 다시 켭니다.
    render();
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

  socket.on('game_state', (s) => {
    const prev = state;
    state = s && typeof s === 'object' ? s : { phase: 'lobby' };
    const info = myInfo();
    const prevInfo = prev.players && me ? prev.players[me.slot] : null;
    // 점화·꺼짐 소리
    const stage = state.phase === 'playing' ? state.stage : null;
    if (info && stage !== lastStage) {
      if (stage === 'live' && !info.down) {
        ignite();
        haptics.buzz([60]);
      } else if (lastStage === 'live') retract();
    }
    if (info && prevInfo && info.down && !prevInfo.down) {
      retract();
      haptics.buzz([200, 80, 300], { color: '#ff3a5a' });
    }
    if (stage !== 'live' && cueOn) hideBigCue();
    lastStage = stage;
    if (state.phase === 'playing' && prev.phase !== 'playing') lastResult = null;
    render();
  });

  socket.on('cue', (c) => {
    const kind = c && c.kind;
    if (kind === 'duel') {
      // 로봇이 칼을 들어 올림: 막을 쪽 큰 표시 + 경고 진동
      const combo = c.of > 1 ? `연속 ${Number(c.n || 0) + 1}/${c.of}` : '';
      if (mode === 'play') showBigCue(c.dir, Number(c.ms) || 1000, combo);
      beep();
      haptics.play('warn', 0.8);
      return;
    }
    if (kind === 'open') {
      if (mode === 'play') showBigCue('open', Number(c.ms) || 1200, '');
      tone(1568, 0.12, 0.2, 'triangle');
      haptics.buzz([16, 30, 16], { color: '#ffd23a' });
      return;
    }
    // 드론 훈련: 광탄이 곧 몸에 닿음
    cueOn = true;
    clearTimeout(cueTimer);
    cueTimer = setTimeout(() => {
      cueOn = false;
      if (mode === 'play') render();
    }, 700);
    if (mode === 'play') {
      const st = $('status');
      st.textContent = '광탄이 와요! 막아요!';
      st.className = 'status warn';
      const cel = $('cue');
      cel.classList.remove('on');
      void cel.offsetWidth;
      cel.classList.add('on');
    }
    beep();
    haptics.play('warn', 0.6);
  });

  // 결과 소리. 진동은 큰 화면이 같이 보내는 d2c haptic 이 맡습니다.
  socket.on('hit', (h) => {
    const kind = h && h.kind;
    const st = $('status');
    const say = (t, cls) => {
      if (mode !== 'play') return;
      st.textContent = t;
      st.className = `status${cls ? ` ${cls}` : ''}`;
    };
    if (kind === 'deflect') clash(false);
    else if (kind === 'hurt') {
      zap();
      say(curMode() === 'duel' ? '베였어요!' : '맞았어요!', 'warn');
    } else if (kind === 'kill') boom();
    else if (kind === 'parry') {
      clash(true);
      say('막았다!');
    } else if (kind === 'strike') {
      slashHit(h.n);
      say(h.n >= 2 ? `${h.n}연타!` : '베기!');
    } else if (kind === 'blocked') {
      clash(false);
      say('로봇이 막았어요 · 먼저 막고 베요', 'warn');
    } else if (kind === 'win') {
      fanfare();
      hideBigCue();
      say('로봇을 쓰러뜨렸어요!');
    }
  });

  socket.on('result', (r) => {
    lastResult = r || null;
    if (r && (r.result === 'win' || r.result === 'tw' || r.rank === 1)) haptics.play('success');
    render();
  });

  // ---------- 버튼 ----------
  $('btnStart').addEventListener('click', async () => {
    if (mode !== 'start') return;
    mode = 'connecting';
    $('btnStart').disabled = true;
    // iPhone 은 탭 안에서, await 전에 화면 꺼짐 방지·소리·두 권한을 함께 요청해야 합니다.
    keepAwake();
    audio();
    buildHum();
    haptics.unlock();
    const asks = [];
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
      asks.push(DeviceOrientationEvent.requestPermission().catch(() => 'denied'));
    }
    if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') {
      asks.push(DeviceMotionEvent.requestPermission().catch(() => 'denied'));
    }
    const res = await Promise.all(asks);
    permDenied = res.some((x) => x !== 'granted');
    window.addEventListener('deviceorientation', onOrientation);
    window.addEventListener('devicemotion', onMotion);
    if (!ROOM) {
      message('방 코드가 없어요', '큰 화면의 QR을 찍어 주세요.');
      return;
    }
    // 폰에서 권한이 거절되면 켜는 법을 안내합니다(버튼 모드로 계속할 수도 있음).
    if (permDenied && isTouch && !DEBUG) {
      sensorHelp();
      return;
    }
    join();
    setTimeout(() => {
      if (gotOri || gotMotion) return;
      if (isTouch && !DEBUG && window.isSecureContext) {
        // 폰인데 센서 값이 없으면(Android 사이트 설정에서 막힘 등) 켜는 법을 안내합니다.
        // '버튼으로 할게요'를 누르면 버튼 모드로 이어서 하고, 그 사이 센서가 살아나면 센서로 이어서 합니다.
        fallback = true;
        sensorHelp();
        return;
      }
      fallback = true;
      debug('동작 센서 값이 들어오지 않아 버튼으로 해요');
      sensorsChanged();
    }, SENSOR_WAIT_MS);
  });
  $('btnGo').addEventListener('click', () => {
    audio();
    keepAwake();
    if (iAmReady()) return;
    // 칼자루 자세를 아직 안 맞췄으면 먼저 맞추고, 맞추자마자 준비 완료로 넘어갑니다.
    if (!basis && gotOri && !fallback && state.phase !== 'playing') {
      pendingReady = true;
      openCal();
      return;
    }
    sendReady();
  });
  $('btnCalLobby').addEventListener('click', () => {
    audio();
    openCal();
  });
  $('btnRecal').addEventListener('click', () => {
    audio();
    humSet(false);
    openCal();
  });
  $('btnReady').addEventListener('click', () => {
    audio();
    startCountdown();
  });
  $('btnCalCancel').addEventListener('click', () => {
    clearInterval(countTimer);
    pendingReady = false;
    mode = 'idle';
    render();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      humSet(false);
      return;
    }
    if (mode !== 'start') keepAwake();
    if (actx && actx.state !== 'running') Promise.resolve(actx.resume()).catch(() => {});
    render();
  });
  // iOS 는 소리가 잠깐 멈췄다가 다음 터치에서 다시 켜질 수 있습니다.
  document.addEventListener('touchend', () => { if (actx && actx.state !== 'running') actx.resume(); }, { passive: true });

  if (!window.isSecureContext) $('httpNote').classList.remove('hidden');

  // ---------- 디버그 (&debug) ----------
  function debug(t) {
    if (DEBUG) $('debug').textContent = t;
  }
  if (DEBUG) {
    let lastO = 0;
    let lastM = 0;
    setInterval(() => {
      if (lastSwing && performance.now() - lastSwing.at < 4000) return;
      debug(`ori ${(oriCount - lastO) * 2}Hz motion ${(motCount - lastM) * 2}Hz rot ${Math.round(rotNow)}°/s rtt ${Math.round(rtt())}ms ` +
        `basis ${basis ? 'Y' : 'N'} mode ${mode} fallback ${fallback ? 'Y' : 'N'} hum ${hum.on ? 'on' : 'off'}`);
      lastO = oriCount;
      lastM = motCount;
    }, 500);
  }
  // 시험용: 상태 보기, 버튼 모드 조작, 연습 신호
  window.__saberPhone = {
    get state() { return state; }, get mode() { return mode; }, get basis() { return basis; }, get tilt() { return curTilt(); },
    get ready() { return iAmReady(); }, fakeSwing, fakeZone, fake, tut, ps,
    // 센서 흉내: 폰 윗부분 방향 top(세계 좌표, 위 +Y), 화면 방향 face 를 그대로 넣습니다.
    feedOri(top, face) {
      ori = { top: norm(top), face: norm(face) };
      const t = performance.now();
      oriBuf.push({ t, top: ori.top, face: ori.face });
      while (oriBuf.length && oriBuf[0].t < t - 1500) oriBuf.shift();
      if (!gotOri) { gotOri = true; fallback = false; sensorsChanged(); }
      streamPose(ori.top, ori.face, t);
      feedTilt(t);
    }
  };
})();
