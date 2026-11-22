// 배스 낚시 컨트롤러. 폰이 낚싯대입니다. 호수는 늘 열려 있어서 QR 을 찍고 시작을 누르면 바로 낚시합니다.
// 뒤로 젖혔다가 앞으로 휙 던지면 캐스팅(큰 '던지기' 버튼도 같은 역할), 찌가 들어가면 위로 확 들어 올려 챔질('챔질!' 버튼도 됩니다),
// 화면의 릴 핸들을 돌려 감습니다. 기준 자세는 시작하고 폰이 잠깐 가만히 있을 때 저절로 잡습니다('다시 맞추기'는 선택).
// 좌표는 기준축으로 보냅니다: r = 내 오른쪽, u = 위, f = 폰 윗부분이 TV 를 보던 방향.
// 쉬움(기본)·보통은 민감도를 낮추고 던지는 힘 곡선을 평평하게 하며, 큰 화면이 던진 자리를 가까운 물고기 쪽으로 보정합니다.
// 어려움은 예전 값 그대로입니다(아래 CTRL).
import { haptics } from '/common/haptics.js';
import { createPhoneSettings } from '/common/phone-settings.js';
import { createTutorial } from '/common/tutorial.js';
import { createSamples } from '/common/samples.js';
import { SFX } from '/common/sfx/manifest.js';
import { t as T, mountSwitcher } from '/common/i18n.js'; // 이 파일에는 지역 변수 t 가 많아 T 로 부릅니다

{
  const $ = (id) => document.getElementById(id);
  const RD = Math.PI / 180;
  const TAU = Math.PI * 2;
  const params = new URLSearchParams(location.search);
  const ROOM = (params.get('room') || '').toUpperCase();
  const DEBUG = params.has('debug');
  $('room').textContent = ROOM ? T('방 {code}', { code: ROOM }) : '';

  // ---------- 조정 값(실폰 검증 전이라 바뀔 수 있습니다) ----------
  const POSE_MS = 25; // pose 전송 간격, 약 40Hz
  const SENSOR_WAIT_MS = 1500; // 이 시간 안에 동작 센서 값이 없으면 버튼 모드
  const CAL_GUARD_MS = 600; // 기준 자세를 잡은 직후 흔들림은 무시
  const STRONG_DPS = 1000; // 어려움: 기본 '힘껏' 회전 속도(이 폰에 기억한 값이 있으면 그 값)
  // 난이도별 조작 민감도(실폰 검증 전이라 바뀔 수 있습니다). 어려움 = 예전 그대로.
  //  armDeg/armMin   기준보다 이만큼(이상) 뒤로 젖히면 캐스팅 준비 / releaseDeg 다시 이 각도 아래로 내려오면 던짐(젖힌 각도보다 낮아야 함)
  //  castMin         내려올 때 회전 속도 하한(이 아래는 '안 던짐') / strong 이 속도에서 '힘껏' / curve 힘 곡선 / floor 던졌다면 최소 힘
  //  hookDps/hookRise/hookNoGyro/biteRot   챔질로 보는 회전 속도·올라가는 속도 / dialLock 처음 몇 라디안으로 방향을 정할지(0 = 양방향)
  const CTRL = {
    easy: { armDeg: 30, armMin: 42, releaseDeg: 24, castMin: 120, strong: 600, curve: 1.0, floor: 0.25, hookDps: 110, hookRise: 45, hookNoGyro: 140, biteRot: 180, dialLock: 0, dialDead: 0.08, dialJump: 2.2 },
    normal: { armDeg: 35, armMin: 46, releaseDeg: 23, castMin: 170, strong: 800, curve: 1.4, floor: 0.1, hookDps: 150, hookRise: 65, hookNoGyro: 190, biteRot: 250, dialLock: 0.6, dialDead: 0.12, dialJump: 1.8 },
    hard: { armDeg: 40, armMin: 50, releaseDeg: 22, castMin: 220, strong: 1000, curve: 1.8, floor: 0, hookDps: 200, hookRise: 90, hookNoGyro: 250, biteRot: 320, dialLock: 1.05, dialDead: 0.15, dialJump: 1.3 }
  };
  let diff = 'easy';
  let K = CTRL.easy;
  const NEAR_POWER = 0.03; // '살짝 던지기' 버튼(큰 화면 logic.js 와 같은 값, 약 3.4m)
  // 큰 화면의 거리 식(logic.js castDist)과 같습니다: 초릿대에서 2.6m + 27.4m × 힘
  const distOf = (p) => 2.6 + 27.4 * Math.max(0, Math.min(1, p));
  const BUTTON_POWER = 0.5; // 큰 '던지기' 버튼(약 16m, 큰 화면이 가까운 물고기 쪽으로 보정)
  const HOOK_WIN_MS = 90;
  const REEL_MS = 66; // 감기 전송 간격(약 15Hz)
  const AIM_MAX = 35;
  const WAIT_HINT_MS = 12000; // 기다림이 이만큼 길면 '다시 던져요'
  // 큰 화면이 낚싯대와 조준선을 늘 그리므로, 조준·대기·파이팅 내내 방향을 보냅니다.
  const STREAM_STAGES = ['ready', 'cast', 'wait', 'bite', 'fight', 'landed', 'lost'];

  let token = null;
  try { token = localStorage.getItem('pcg-token'); } catch (e) {}
  if (!token) {
    token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem('pcg-token', token); } catch (e) {}
  }

  // 이 사람의 던지기 세기(폰에 기억): strong = '힘껏'의 회전 속도, gentle = 연습 때 '살살'의 회전 속도
  const THROW_KEY = 'pcg-fishing-throw';
  let throwCal = { strong: STRONG_DPS };
  try {
    const t = JSON.parse(localStorage.getItem(THROW_KEY) || 'null');
    if (t && Number(t.strong) > 0) throwCal = { ...throwCal, ...t };
  } catch (e) {}
  function saveThrow() {
    try { localStorage.setItem(THROW_KEY, JSON.stringify(throwCal)); } catch (e) {}
  }
  // 회전 속도(도/초) → 힘(0~1). '안 던짐' 구간을 빼고, 이 사람의 '힘껏'을 1 로 맞춘 뒤 곡선을 씌웁니다.
  //   어려움(힘껏 1000): 300 → 약 3m, 400 → 약 4.5m, 600 → 약 10m, 800 → 약 19m, 1000 → 30m / 쉬움: 120 → 약 9m, 350 → 약 19m, 600 → 30m
  function powerOf(peak) {
    // 쉬움·보통은 폰에 기억한 값을 쓰지 않고 난이도 값으로 고정합니다(어려움만 이 사람 값으로 조금씩 맞춤).
    const strong = diff === 'hard' ? clamp(Number(throwCal.strong) || STRONG_DPS, 560, 1700) : K.strong;
    const x = clamp01((peak - K.castMin) / (strong - K.castMin));
    return K.floor + (1 - K.floor) * Math.pow(x, K.curve);
  }

  const socket = io({ autoConnect: false, transports: ['websocket', 'polling'], tryAllTransports: true });
  // 끊긴 동안 보낸 이벤트는 다시 붙을 때 join 보다 먼저 흘러가 버려지므로, 끊겨 있으면 보내지 않습니다.
  function send(event, data, volatile) {
    if (!socket.connected || !me) return false;
    (volatile ? socket.volatile : socket).emit('c2d', { event, data });
    return true;
  }
  const isTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  let me = null;
  let state = { phase: 'lobby' };
  let stateAt = performance.now();
  let mode = 'start'; // start | connecting | msg | hold | idle | tut | play
  let gotOri = false;
  let gotMotion = false;
  let hasGyro = false;
  let fallback = false;
  let permDenied = false;
  let tutChecked = false;
  let sensorHelpOn = false; // 센서 안내 화면은 사용자가 고르거나 센서 값이 들어올 때까지 유지합니다
  let pendingCal = false;
  let noRoomTries = 0;

  function show(id) {
    for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === id);
    $('btnRecal').classList.toggle('hidden', !(id === 'vPlay' && gotOri && !fallback));
    $('btnSet').classList.toggle('hidden', !(me && id === 'vPlay'));
  }
  function message(t, b) {
    // 연습 중에 연결 문제가 생기면 연습을 닫고(기록하지 않음) 안내를 보여 줍니다.
    if (tut.isRunning()) tut.cancel();
    closeSheet();
    mode = 'msg';
    $('msgT').textContent = t;
    $('msgB').textContent = b || '';
    const fb = $('btnFallback');
    if (fb) fb.remove();
    show('vMsg');
  }
  function banner(text) {
    $('banner').textContent = text || '';
    $('banner').classList.toggle('hidden', !text);
  }

  // ---------- 작은 벡터·사원수 ----------
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
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const clamp01 = (x) => clamp(x, 0, 1);
  const round = (x, n) => { const k = Math.pow(10, n); return Math.round(x * k) / k; };
  const r3 = (v) => [round(v[0], 3), round(v[1], 3), round(v[2], 3)];
  const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

  // deviceorientation → 세계 좌표(위 = +Y). 폰 윗부분 = (0,0,-1), 화면 바깥 = (0,1,0). 골프와 같은 변환입니다.
  function deviceVectors(alpha, beta, gamma) {
    const q = qFromEuler(beta * RD, alpha * RD, -gamma * RD);
    return { q, top: qRot(q, [0, 0, -1]), face: qRot(q, [0, 1, 0]) };
  }

  // ---------- 기준축 ----------
  let basis = null; // { r, u, f, e0 }
  let calAt = -1e9;
  function makeBasis(top, face) {
    const u = [0, 1, 0];
    // 폰 윗부분이 TV 쪽이면 그 수평 방향이 앞. 폰을 세워 화면이 나를 보면 화면 반대쪽이 앞.
    let f = [top[0], 0, top[2]];
    if (Math.hypot(f[0], f[2]) < 0.35) f = [-face[0], 0, -face[2]];
    f = norm(f);
    return { r: norm(cross(f, u)), u, f };
  }
  const inBasis = (b, v) => [dot(v, b.r), dot(v, b.u), dot(v, b.f)];
  // 낚싯대 각도: 0 = TV 쪽 수평, 90 = 하늘, 180 = 내 쪽
  const elevOf = (s) => Math.atan2(s[1], Math.hypot(s[0], s[2]) * (s[2] >= 0 ? 1 : -1)) / RD;
  const yawOf = (s) => Math.atan2(s[0], Math.max(0.05, Math.abs(s[2]))) / RD;

  // ---------- 센서 ----------
  let ori = null;
  const oriBuf = [];
  const eHist = []; // { t, e, yaw }
  let rotNow = 0;
  const rotHist = []; // { t, rot }
  let nextPoseAt = 0;
  let oriCount = 0;
  let motCount = 0;
  function evTime(e) {
    const n = performance.now();
    const ts = e && e.timeStamp;
    return ts > 0 && Math.abs(n - ts) < 1000 ? ts : n;
  }

  function myStage() {
    const p = myInfo();
    return p ? p.state || p.stage || null : null;
  }
  function myInfo() {
    if (!me || !state || !state.players) return null;
    return state.players[me.slot] || state.players[String(me.slot)] || null;
  }
  // 큰 화면이 'open'(늘 열린 호수)을 보내고 내 자리가 있으면 바로 낚시합니다.
  const playing = () => (state.phase === 'open' || state.phase === 'playing') && Boolean(myInfo());

  function onOrientation(e) {
    if (e.alpha == null && e.beta == null) return;
    const t = evTime(e);
    oriCount += 1;
    ori = deviceVectors(e.alpha || 0, e.beta || 0, e.gamma || 0);
    oriBuf.push({ t, top: ori.top, face: ori.face });
    while (oriBuf.length && oriBuf[0].t < t - 400) oriBuf.shift();
    if (!gotOri) {
      gotOri = true;
      sensorsChanged();
    }
    maybeAutoBasis(t);
    if (!basis) return;
    const s = inBasis(basis, ori.top);
    const el = elevOf(s);
    eHist.push({ t, e: el, yaw: yawOf(s), s });
    while (eHist.length && eHist[0].t < t - 700) eHist.shift();
    // 자이로(rotationRate)가 없는 폰은 방향 값만으로 챔질을 봅니다.
    if (!hasGyro) {
      if (hookWin) hookWin.speed = Math.max(hookWin.speed, eRate(t));
      else hookCheck(t);
    }
    // 약 40Hz 로 줄여 보냅니다(경기 중 필요한 단계에서만).
    if (playing() && !fallback && STREAM_STAGES.includes(myStage()) && t >= nextPoseAt) {
      nextPoseAt = Math.max(nextPoseAt + POSE_MS, t + POSE_MS * 0.4);
      send('pose', { s: r3(s), fc: r3(inBasis(basis, ori.face)) }, true);
    }
    castCheck(t, el, s);
    motionCrank(t, s);
    if (mode === 'play') drawGauge(el);
  }

  function onMotion(e) {
    const rr = e.rotationRate;
    if (!rr || (rr.alpha == null && rr.beta == null && rr.gamma == null)) return;
    const t = evTime(e);
    motCount += 1;
    hasGyro = true;
    if (!gotMotion) {
      gotMotion = true;
      fallback = false;
      sensorsChanged();
    }
    rotNow = Math.hypot(rr.alpha || 0, rr.beta || 0, rr.gamma || 0);
    rotHist.push({ t, rot: rotNow });
    while (rotHist.length && rotHist[0].t < t - 700) rotHist.shift();
    if (cast.state === 'armed') cast.peak = Math.max(cast.peak, eRate(t) < -40 ? rotNow : 0);
    hookCheck(t);
  }

  // 낚싯대 끝이 올라가는 속도(도/초). iPhone 은 같은 값이 겹쳐 와서 이웃 표본 대신 60ms 떨어진 두 점으로 잽니다.
  function eRate(t) {
    if (eHist.length < 2) return 0;
    const b = eHist[eHist.length - 1];
    let a = eHist[0];
    for (let i = eHist.length - 2; i >= 0; i--) {
      if (b.t - eHist[i].t >= 60) {
        a = eHist[i];
        break;
      }
    }
    const dt = (b.t - a.t) / 1000;
    void t;
    return dt > 0.02 ? (b.e - a.e) / dt : 0;
  }
  function rotPeak(since) {
    let p = 0;
    for (const r of rotHist) if (r.t >= since) p = Math.max(p, r.rot);
    return p;
  }

  // ---------- 캐스팅: 뒤로 젖혔다가 앞으로 휙 ----------
  const cast = { state: 'idle', eMax: 0, topAt: 0, peak: 0, armedAt: 0, blockUntil: 0, msg: '', prevEl: 0, rejectAt: -1e9 };
  // 막힌 동작에도 반응이 보이게: 짧은 안내 + 진동 한 번
  function hint(text, ms) {
    vib(16);
    note(text, null, ms || 1500);
  }
  function canCast(t) {
    const st = myStage();
    const on = mode === 'play' || (mode === 'tut' && TUT_CAST.has(tutStage));
    return playing() && (st === 'ready' || st === 'wait') && t - calAt > CAL_GUARD_MS && t > cast.blockUntil && on;
  }
  function castCheck(t, el, s) {
    const prevEl = cast.prevEl;
    cast.prevEl = el;
    if (!basis) {
      cast.state = 'idle';
      return;
    }
    if (!canCast(t)) {
      cast.state = 'idle';
      // 던질 수 없는 때(찌가 날아가는 중·물고기를 올린 직후)에 젖히면 조용히 무시하지 말고 알려 줍니다.
      const st = myStage();
      if (mode === 'play' && playing() && (st === 'cast' || st === 'landed' || st === 'lost') && prevEl <= Math.max(basis.e0 + K.armDeg, K.armMin) && el > Math.max(basis.e0 + K.armDeg, K.armMin) && t - cast.rejectAt > 1500) {
        cast.rejectAt = t;
        hint('잠깐만요, 곧 던질 수 있어요');
      }
      return;
    }
    // 기다리는 중(wait)에는 챔질로 폰을 들어 올리는 동작과 겹치지 않게 예전 값(어려움)으로 둡니다.
    const KA = myStage() === 'wait' ? CTRL.hard : K;
    const armAt = Math.min(Math.max(basis.e0 + KA.armDeg, KA.armMin), 85);
    if (cast.state === 'idle') {
      if (el > armAt) {
        cast.state = 'armed';
        cast.eMax = el;
        cast.topAt = t;
        cast.peak = 0;
        cast.armedAt = t;
        vib(12);
        tick(900);
      }
      return;
    }
    if (el > cast.eMax) {
      cast.eMax = el;
      cast.topAt = t;
    }
    if (!hasGyro) cast.peak = Math.max(cast.peak, -eRate(t));
    if (el < basis.e0 + KA.releaseDeg) {
      cast.state = 'idle';
      // 가장 높이 젖힌 뒤(내려오는 동안)의 회전만 셉니다. 위로 챈 동작의 회전이 캐스팅 힘으로 잡히지 않게 합니다.
      const peak = hasGyro ? Math.max(cast.peak, rotPeak(Math.max(t - 350, cast.topAt))) : cast.peak;
      // 챔질 직후 천천히 내린 것이면 캐스팅으로 보지도, 안내하지도 않습니다.
      const waiting = myStage() === 'wait';
      if (t - lastHook < 1200 && peak < KA.castMin) return;
      if (peak < KA.castMin) {
        // 너무 느린 동작: 쉬움·보통은 어느 정도 휘둘렀으면 가장 약한 캐스팅으로 받아 주고, 아니면(어려움은 늘) 안내합니다.
        if (diff !== 'hard' && !waiting && peak >= K.castMin * 0.55) {
          deliverCast(K.floor, clamp(yawOf(s), -AIM_MAX, AIM_MAX), peak, 'motion');
          return;
        }
        cast.msg = '더 크게 휙!';
        vib(14);
        drawCastHint();
        return;
      }
      // 힘은 내려오는 회전 속도만으로 정합니다(젖힌 폭은 보지 않습니다).
      const power = powerOf(peak);
      const aim = clamp(yawOf(s), -AIM_MAX, AIM_MAX);
      deliverCast(power, aim, peak, 'motion');
    }
  }
  // src: motion(폰 동작) | near('살짝 던지기' 버튼) | button(큰 '던지기' 버튼·버튼 모드의 힘 슬라이더)
  function deliverCast(power, aim, peak, src = 'motion') {
    if (!send('cast', { power: round(power, 3), aim: round(aim, 1), rtt: Math.round(rtt()), near: src === 'near' || undefined })) {
      hint('연결을 확인해 주세요');
      return false;
    }
    const dist = distOf(power);
    cast.msg = src === 'near' ? '살짝 톡!' : '';
    whoosh(power);
    vib(src === 'near' ? 18 : 30);
    debug(`cast ${src} power ${power.toFixed(2)} ≈${dist.toFixed(1)}m aim ${aim.toFixed(1)} peak ${Math.round(peak || 0)} strong ${Math.round(throwCal.strong)}`);
    // 어려움: 이 사람의 '힘껏'보다 훨씬 세게 던지면 기준을 조금씩 올립니다(늘 끝까지 날아가지 않게).
    if (diff === 'hard' && src === 'motion' && mode === 'play' && peak > throwCal.strong * 1.12) {
      throwCal.strong = clamp(Math.round(throwCal.strong * 0.75 + peak * 0.25), 560, 1700);
      saveThrow();
    }
    drawCastHint();
    if (mode === 'tut') tut.signal('cast', { power, peak: peak || 0, dist, src });
    return true;
  }
  function currentAim() {
    if (fallback || !eHist.length) return clamp(Number($('aim').value) || 0, -AIM_MAX, AIM_MAX);
    return clamp(eHist[eHist.length - 1].yaw, -AIM_MAX, AIM_MAX);
  }
  // '살짝 던지기' 버튼: 지금 겨눈 쪽으로 선착장 바로 앞에 톡
  function nearCast() {
    const st = myStage();
    if (!playing() || (st !== 'ready' && st !== 'wait')) {
      hint('지금은 던질 수 없어요');
      return;
    }
    audio();
    deliverCast(NEAR_POWER, currentAim(), 0, 'near');
  }
  // 큰 '던지기' 버튼: 휙 던지기와 같은 역할. 지금 겨눈 쪽으로 알맞은 거리(약 16m)로, 큰 화면이 물고기 쪽으로 보정합니다.
  function buttonCast() {
    const st = myStage();
    if (!playing() || (st !== 'ready' && st !== 'wait')) {
      hint('지금은 던질 수 없어요');
      return;
    }
    audio();
    deliverCast(BUTTON_POWER, currentAim(), 0, 'button');
  }

  // ---------- 챔질: 위로 확 ----------
  let hookWin = null;
  let lastHook = -1e9;
  let weakAt = -1e9;
  function hookCheck(t) {
    if (hookWin || !basis) return;
    if (mode !== 'play' && !(mode === 'tut' && TUT_HOOK.has(tutStage))) return;
    const st = myStage();
    if (!playing() || (st !== 'wait' && st !== 'bite')) return;
    if (t - lastHook < 700 || t - calAt < CAL_GUARD_MS) return;
    let hit;
    let rise;
    if (hasGyro) {
      if (rotNow < K.hookDps) {
        // 입질 중에 움직였는데 모자라면 조용히 넘기지 말고 알려 줍니다.
        if (st === 'bite' && rotNow > K.hookDps * 0.55) weakHook(t);
        return;
      }
      rise = eRate(t);
      hit = rise > K.hookRise || (st === 'bite' && rotNow > K.biteRot && rise > -60);
      if (!hit && st === 'bite') {
        weakHook(t);
        return;
      }
    } else {
      rise = eRate(t);
      hit = rise > K.hookNoGyro;
    }
    if (hit) {
      hookWin = { t0: t, st, speed: hasGyro ? 0 : rise };
      setTimeout(finishHook, HOOK_WIN_MS);
    }
  }
  function weakHook(t) {
    if (t - weakAt < 900) return;
    weakAt = t;
    hint('위로 더 크게 확!', 1100);
  }
  function finishHook() {
    const w = hookWin;
    hookWin = null;
    if (!w) return;
    lastHook = w.t0;
    // 자이로가 없으면 회전 기록이 비어 있으니 낚싯대 끝이 올라간 최고 속도를 보냅니다.
    const speed = hasGyro ? rotPeak(w.t0 - 40) : w.speed;
    deliverHook(speed, Math.max(0, Math.round(performance.now() - w.t0)), w.st);
  }
  function deliverHook(speed, ago, st) {
    if (!send('hookset', { speed: Math.round(speed), ago, rtt: Math.round(rtt()) })) {
      hint('연결을 확인해 주세요');
      return;
    }
    lastHook = performance.now();
    // 챔질 뒤에 이어지는 동작은 캐스팅으로 보지 않습니다.
    cast.blockUntil = performance.now() + 1500;
    whip();
    debug(`hookset speed ${Math.round(speed)} ago ${ago}`);
  }

  // ---------- 릴 감기(화면 핸들 또는 폰 돌리기) ----------
  const reel = { pending: 0, total: 0, rate: 0, lastMoveAt: 0, lastSend: performance.now(), clickAcc: 0, lastClick: 0, sentZero: true };
  function addTurns(n) {
    if (!(n > 0)) return;
    reel.pending += n;
    reel.total += n;
    reel.lastMoveAt = performance.now();
    reel.clickAcc += n;
    while (reel.clickAcc >= 0.125) {
      reel.clickAcc -= 0.125;
      const now = performance.now();
      if (now - reel.lastClick > 38) {
        reel.lastClick = now;
        click();
      }
    }
  }
  setInterval(() => {
    const now = performance.now();
    const dt = Math.max(0.02, (now - reel.lastSend) / 1000);
    reel.lastSend = now;
    const inst = reel.pending / dt;
    reel.rate = now - reel.lastMoveAt > 240 ? 0 : reel.rate * 0.45 + inst * 0.55;
    const st = myStage();
    const live = playing() && (st === 'wait' || st === 'fight' || st === 'bite');
    if (live && (reel.pending > 0 || reel.rate > 0.02)) {
      send('reel', { turns: round(reel.pending, 3), rate: round(reel.rate, 2), total: round(reel.total, 3) }, true);
      reel.sentZero = false;
    } else if (live && !reel.sentZero) {
      send('reel', { turns: 0, rate: 0, total: round(reel.total, 3) }, true);
      reel.sentZero = true;
    }
    reel.pending = 0;
    $('rateT').textContent = reel.rate.toFixed(1);
    $('spool').style.transform = `rotate(${(reel.total * 360) % 360}deg)`;
    if (mode === 'play') $('hookRow').classList.toggle('hidden', fallback || myStage() !== 'bite');
  }, REEL_MS);

  // 화면 핸들: 손가락으로 원을 그리면 각도를 이어 붙여 바퀴 수를 셉니다. 처음 60° 로 방향을 정하고 그 방향만 셉니다.
  const dial = { active: false, last: 0, acc: 0, lock: 0, wrong: 0, id: null };
  function dialAngle(e) {
    const r = $('dial').getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    return { a: Math.atan2(dy, dx), rr: Math.hypot(dx, dy) / (r.width / 2) };
  }
  function setArm(a) {
    $('arm').style.transform = `rotate(${((a + Math.PI / 2) / RD).toFixed(1)}deg)`;
  }
  $('dial').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    audio();
    try { $('dial').setPointerCapture(e.pointerId); } catch (err) {}
    const { a } = dialAngle(e);
    Object.assign(dial, { active: true, last: a, acc: 0, lock: 0, wrong: 0, id: e.pointerId });
    setArm(a);
  });
  $('dial').addEventListener('pointermove', (e) => {
    if (!dial.active || e.pointerId !== dial.id) return;
    const { a, rr } = dialAngle(e);
    let d = wrap(a - dial.last);
    dial.last = a;
    setArm(a);
    if (rr < K.dialDead || Math.abs(d) > K.dialJump) return;
    // 쉬움: 방향을 가리지 않고 어떻게 휘저어도 감깁니다. 보통·어려움: 처음 움직인 방향만 셉니다(보통은 조금만 돌려도 정함).
    if (!K.dialLock) {
      addTurns(Math.abs(d) / TAU);
      return;
    }
    if (!dial.lock) {
      dial.acc += d;
      if (Math.abs(dial.acc) > K.dialLock) {
        dial.lock = Math.sign(dial.acc);
        addTurns(Math.abs(dial.acc) / TAU);
      }
      return;
    }
    if (d * dial.lock > 0) {
      addTurns(Math.abs(d) / TAU);
      dial.wrong = 0;
    } else {
      dial.wrong += Math.abs(d);
      if (dial.wrong > 1.2) {
        $('dialHint').textContent = '한 방향으로 계속 돌려요';
        $('dialHint').classList.add('warn');
      }
    }
  });
  const endDial = (e) => {
    if (e.pointerId !== dial.id) return;
    dial.active = false;
    $('dialHint').classList.remove('warn');
    drawDialHint();
  };
  $('dial').addEventListener('pointerup', endDial);
  $('dial').addEventListener('pointercancel', endDial);

  // 폰 돌리기(실험): 폰 끝으로 원을 그리면 그 각도를 이어 붙입니다.
  const mc = { on: false, mean: null, last: null, acc: 0, lock: 0, lastT: 0 };
  function motionCrank(t, s) {
    if (!mc.on) return;
    const st = myStage();
    if (!playing() || (st !== 'wait' && st !== 'fight')) {
      mc.last = null;
      return;
    }
    const k = mc.mean ? Math.min(1, (t - mc.lastT) / 500) : 1;
    mc.lastT = t;
    mc.mean = mc.mean ? mc.mean.map((m, i) => m + (s[i] - m) * k) : s.slice();
    const dr = s[0] - mc.mean[0];
    const du = s[1] - mc.mean[1];
    if (Math.hypot(dr, du) < 0.05) {
      mc.last = null;
      return;
    }
    const a = Math.atan2(du, dr);
    if (mc.last != null) {
      const d = wrap(a - mc.last);
      if (Math.abs(d) < 1.2) {
        if (!mc.lock) {
          mc.acc += d;
          if (Math.abs(mc.acc) > 1.5) mc.lock = Math.sign(mc.acc);
        } else if (d * mc.lock > 0) addTurns(Math.abs(d) / TAU);
      }
    }
    mc.last = a;
  }
  $('btnMotion').addEventListener('click', () => {
    mc.on = !mc.on;
    Object.assign(mc, { mean: null, last: null, acc: 0, lock: 0 });
    $('btnMotion').classList.toggle('on', mc.on);
    $('btnMotion').textContent = mc.on ? '폰 돌려서 감기 켜짐' : '폰 돌려서 감기 (실험)';
    drawDialHint();
  });

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

  // ---------- 소리·진동 ----------
  let actx = null;
  let noiseBuf = null;
  let smp = null;
  // 폰은 손에 바로 오는 소리 3개만 녹음으로(파일 3개): 던질 때 휙, 감을 때 딸깍(한 벌만), 입질·점프 풍덩. 나머지는 합성음 그대로.
  const PHONE_SFX = {
    'swing/cast': SFX['swing/cast'],
    'swing/reel-click': { file: SFX['swing/reel-click'].files[0], gain: SFX['swing/reel-click'].gain },
    'water/splash-small': SFX['water/splash-small']
  };
  // 시험용 집계
  const sfxStat = (window.__fishingPhoneSfx = { played: {}, synth: {} });
  function P(name, opts) {
    const a = audio();
    const ok = !!(a && smp && a.state === 'running' && smp.play(name, opts));
    const m = ok ? sfxStat.played : sfxStat.synth;
    m[name] = (m[name] || 0) + 1;
    return ok;
  }
  function audio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
      smp = createSamples(actx, null, { manifest: PHONE_SFX });
      smp.preload(['swing/', 'water/']);
      noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function tone(freq, dur, gain, type, to, at) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + (at || 0);
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  function noise(dur, freq, q, gain, opts = {}) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + (opts.at || 0);
    const src = a.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = a.createBiquadFilter();
    f.type = opts.type || 'bandpass';
    f.frequency.setValueAtTime(freq, t);
    if (opts.sweep) f.frequency.exponentialRampToValueAtTime(opts.sweep, t + dur);
    f.Q.value = q;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + (opts.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(a.destination);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }
  const tick = (f) => tone(f || 1500, 0.05, 0.25);
  // 진동은 공통 모듈(haptics)로: Android 는 진동, iPhone 은 iOS 18 스위치 햅틱을 시도합니다.
  // 화면 번쩍임은 이 페이지가 직접 하므로(입질 빨강·톡톡 하양) 모듈의 번쩍임·틱 소리는 끕니다.
  function vib(pattern) {
    try { haptics.buzz(Array.isArray(pattern) ? pattern : [pattern], { noFlash: true, silent: true }); } catch (e) {}
  }
  const click = () => { if (P('swing/reel-click', { gain: 0.8, rate: 1 })) return; noise(0.018, 3600, 3, 0.22); };
  const whoosh = (p) => {
    if (P('swing/cast', { gain: 0.55 + 0.45 * p, rate: 0.94 + 0.14 * p })) return;
    noise(0.4 + p * 0.25, 600, 0.8, 0.25 + p * 0.3, { sweep: 2800, attack: 0.06 });
    for (let i = 0; i < 9; i++) noise(0.025, 5000, 4, 0.08, { at: 0.15 + i * (0.05 + p * 0.03) });
  };
  const whip = () => noise(0.12, 1800, 0.9, 0.35, { sweep: 500 });
  const plop = () => { tone(500, 0.12, 0.3, 'sine', 170); noise(0.3, 900, 0.6, 0.18, { attack: 0.01 }); };
  const nibbleSnd = () => tone(620, 0.06, 0.25, 'sine', 480);
  const biteSnd = () => { if (P('water/splash-small', { gain: 1, rate: 0.9 })) return; tone(90, 0.7, 0.4, 'sawtooth', 55); noise(0.6, 500, 0.7, 0.3, { attack: 0.02 }); };
  const hookedSnd = () => { tone(160, 0.25, 0.4, 'triangle', 70); tone(1400, 0.2, 0.15, 'triangle', 2200, 0.05); };
  const snapSnd = () => { noise(0.06, 5000, 0.6, 0.6, { type: 'highpass' }); tone(1700, 0.12, 0.2, 'square', 300); };
  const splashSnd = () => { if (P('water/splash-small', { gain: 0.8 })) return; noise(0.5, 900, 0.5, 0.35, { attack: 0.01 }); };
  function fanfare(big) {
    const notes = big ? [523, 659, 784, 1047, 1319] : [587, 740, 880, 1175];
    notes.forEach((f, i) => tone(f, 0.3, 0.2, 'triangle', null, i * 0.09));
  }
  // 드랙 소리(줄이 풀릴 때 지이익)
  let dragNode = null;
  let dragUntil = 0;
  function dragSound(on, T) {
    const a = audio();
    if (!a) return;
    if (!dragNode) {
      const o = a.createOscillator();
      o.type = 'square';
      o.frequency.value = 50;
      const f = a.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2600;
      f.Q.value = 0.9;
      const g = a.createGain();
      g.gain.value = 0;
      o.connect(f).connect(g).connect(a.destination);
      o.start();
      dragNode = { o, g };
    }
    if (on) {
      dragUntil = performance.now() + 220;
      dragNode.o.frequency.setTargetAtTime(40 + T * 40, a.currentTime, 0.05);
      dragNode.g.gain.setTargetAtTime(0.06 + Math.max(0, T - 0.8) * 0.4, a.currentTime, 0.03);
    }
  }
  setInterval(() => {
    if (dragNode && actx && performance.now() > dragUntil) dragNode.g.gain.setTargetAtTime(0, actx.currentTime, 0.05);
  }, 100);
  audio(); // 컨텍스트를 미리 만들어 두어야 녹음 3개를 대기 중에 받아 둘 수 있음(재생은 첫 탭에서 깨움)
  function buzz(pattern, flashKind) {
    vib(pattern);
    // iPhone 은 진동이 없어 화면을 번쩍입니다.
    if (flashKind) {
      const f = $('flash');
      f.className = '';
      void f.offsetWidth;
      f.className = flashKind === 'bite' ? 'bite' : flashKind === 'nib' ? 'nib' : 'go';
    }
  }

  // ---------- 기준 자세: 따로 맞추는 화면 없이, 폰이 잠깐 가만히 있을 때 저절로 잡습니다 ----------
  // 시작하고 처음 가만한 순간(최대 2.5초 기다린 뒤에는 그 자세 그대로)에 잡고, '다시 맞추기'는 0.5초 뒤 가만할 때 다시 잡습니다.
  const basisAsk = { on: true, at: 0, manual: false };
  function maybeAutoBasis(t) {
    if (!basisAsk.on || fallback) return;
    // 처음 잡을 때는 낚시 화면에서 던질 차례(ready)가 되고 나서부터 셉니다(시작 버튼 누른 자세를 잡지 않게).
    if (!basisAsk.manual && !(mode === 'play' && playing() && myStage() === 'ready')) {
      basisAsk.at = 0;
      return;
    }
    if (!basisAsk.at) basisAsk.at = t;
    if (t - basisAsk.at < 400 || oriBuf.length < 3) return;
    const ref = oriBuf[oriBuf.length - 1].top;
    // 가만히 있고, 폰을 세워 들여다보는 자세(윗부분이 거의 하늘)가 아닐 때
    const still = oriBuf.every((o) => dot(o.top, ref) > 0.997) && (!hasGyro || rotNow < 40) && ref[1] < 0.94;
    if (still || t - basisAsk.at > 2500) captureBasis();
  }
  function captureBasis() {
    const t = performance.now();
    let src = oriBuf.filter((o) => o.t >= t - 250);
    if (!src.length && ori) src = [ori];
    if (!src.length) return;
    const top = norm(src.reduce((a, o) => add(a, o.top), [0, 0, 0]));
    const face = norm(src.reduce((a, o) => add(a, o.face), [0, 0, 0]));
    basis = makeBasis(top, face);
    basis.e0 = clamp(elevOf(inBasis(basis, top)), -10, 45);
    calAt = t;
    nextPoseAt = 0;
    eHist.length = 0;
    cast.state = 'idle';
    basisAsk.on = false;
    // 큰 화면은 이 신호로 낚싯대 기준을 다시 잡습니다. 이 뒤의 pose 는 새 기준축 값입니다.
    if (!send('calibrate', { e0: round(basis.e0, 1) })) pendingCal = true;
    if (basisAsk.manual) {
      basisAsk.manual = false;
      buzz([30, 40, 30]);
      tone(1320, 0.12, 0.3);
      note('맞췄어요');
    }
    debug(`calibrate e0 ${basis.e0.toFixed(1)} f=${basis.f.map((x) => x.toFixed(2))}`);
  }
  // 선택: 머리의 '다시 맞추기' (TV 쪽을 보고 낚싯대처럼 쥔 뒤 누릅니다)
  function recalibrate() {
    Object.assign(basisAsk, { on: true, at: performance.now() + 500, manual: true });
    note('잠깐 그대로!');
  }

  // ---------- 화면 ----------
  const STAGE_TEXT = {
    ready: ['휙 던져요!', ''],
    cast: ['날아가요', ''],
    wait: ['기다려요', ''],
    bite: ['지금! 위로 확!', ''],
    fight: ['핸들을 돌려요', ''],
    landed: ['잡았다!', ''],
    lost: ['다시 던져요', '']
  };
  let lastStage = null;
  let waitSince = 0;
  let waitHinted = false;
  let fight = { value: 0, dist: 0, drag: false, run: false, side: 0, at: 0 };
  let nibbleAt = -1e9;
  function setStatus(t, b, cls) {
    $('stT').textContent = t;
    $('stB').textContent = b || '';
    $('status').className = `status${cls ? ` ${cls}` : ''}`;
  }
  function showPlay() {
    // 처음이면(이 폰에 기록이 없으면) 바로 낚시 대신 연습부터.
    // 센서로 할지 버튼으로 할지 정해진 뒤에 띄웁니다(단계 화면이 버튼 모드면 버튼을 같이 그리므로).
    // 아직이면(센서 값을 기다리는 1.5초) 낚시 화면을 잠깐 보여 주고, 정해지면 sensorsChanged 가 다시 부릅니다.
    if (!tutChecked && (gotOri || fallback)) {
      tutChecked = true;
      if (tut.firstTime()) {
        startTutorial();
        return;
      }
    }
    mode = 'play';
    show('vPlay');
    updatePlay(true);
  }
  function updatePlay(force) {
    if (mode !== 'play') return;
    const st = myStage() || 'ready';
    const info = myInfo() || {};
    $('myKg').textContent = (info.total || 0).toFixed(1);
    $('myCnt').textContent = info.count || 0;
    $('myBest').textContent = info.best ? Number(info.best.weight).toFixed(1) : '-';
    if (st !== lastStage || force) {
      const prev = lastStage;
      lastStage = st;
      const [t, b] = STAGE_TEXT[st] || ['', ''];
      setStatus(t, b, st === 'bite' ? 'hot' : st === 'landed' ? 'good' : '');
      $('gauge').classList.toggle('hidden', st !== 'ready');
      if (st === 'ready' && fallback) drawGauge(35);
      $('castHint').classList.toggle('hidden', st !== 'ready' && st !== 'wait');
      $('bob').classList.toggle('hidden', !(st === 'wait' || st === 'bite' || st === 'cast'));
      $('bob').classList.toggle('under', st === 'bite');
      $('tension').classList.toggle('hidden', st !== 'fight');
      $('dialWrap').classList.toggle('hidden', !(st === 'wait' || st === 'bite' || st === 'fight'));
      $('dialWrap').classList.toggle('compact', st !== 'fight');
      $('btnMotion').classList.toggle('hidden', !gotOri || fallback || diff !== 'hard');
      $('pads').classList.toggle('hidden', !fallback || st === 'landed' || st === 'lost');
      $('btnCast').disabled = !(st === 'ready' || st === 'wait');
      $('btnHook').disabled = !(st === 'wait' || st === 'bite');
      $('btnReel').disabled = !(st === 'wait' || st === 'bite' || st === 'fight');
      $('btnTwitch').disabled = st !== 'wait';
      $('btnNear').disabled = !(st === 'ready' || st === 'wait');
      $('nearRow').classList.toggle('hidden', fallback || !(st === 'ready' || st === 'wait'));
      $('hookRow').classList.toggle('hidden', fallback || st !== 'bite');
      if (st === 'wait') waitSince = performance.now();
      waitHinted = false;
      for (const id of ['btnCast', 'btnNear', 'btnHook', 'btnReel', 'btnTwitch']) $(id).style.opacity = $(id).disabled ? 0.4 : 1;
      if (st === 'ready') cast.msg = '';
      if (prev === 'fight' && st !== 'fight') dragSound(false);
      if (st !== 'fight') fight = { value: 0, dist: 0, drag: false, run: false, side: 0, at: 0 };
      drawCastHint();
      drawDialHint();
      if (st === 'fight') drawTension();
    }
  }
  let castHintKo = false; // 화면 글자는 번역돼 있으므로 글자 비교 대신 이 표시로 '이제 앞으로 휙!' 인지 봅니다
  function drawCastHint() {
    let t = '';
    if (cast.state === 'armed' && !fallback) t = '이제 앞으로 휙!';
    else if (cast.msg) t = cast.msg;
    castHintKo = t === '이제 앞으로 휙!';
    $('castHint').textContent = t;
  }
  function drawDialHint() {
    const h = $('dialHint');
    if (h.classList.contains('warn')) return;
    h.textContent = myStage() === 'fight' ? '원을 그려요' : '';
  }
  function drawGauge(el) {
    if ($('gauge').classList.contains('hidden') || (!basis && !fallback)) return;
    const e0 = basis ? basis.e0 : 15;
    const e = clamp(el, -10, 190) * RD;
    $('rodLine').setAttribute('x2', (Math.cos(e) * 88).toFixed(1));
    $('rodLine').setAttribute('y2', (-Math.sin(e) * 88).toFixed(1));
    const a0 = Math.min(Math.max(e0 + K.armDeg, K.armMin), 85) * RD;
    const a1 = 170 * RD;
    $('zoneBack').setAttribute('d', `M ${(Math.cos(a0) * 96).toFixed(1)} ${(-Math.sin(a0) * 96).toFixed(1)} A 96 96 0 0 0 ${(Math.cos(a1) * 96).toFixed(1)} ${(-Math.sin(a1) * 96).toFixed(1)}`);
    $('rodLine').setAttribute('stroke', cast.state === 'armed' ? 'var(--c)' : '#fff');
    if (cast.state === 'armed' && !castHintKo) drawCastHint();
  }
  function drawTension() {
    const v = fight.value;
    $('tfill').style.width = `${(clamp(v, 0, 1.1) / 1.1) * 100}%`;
    $('tbar').classList.toggle('hot', v > 0.85);
    $('tDist').textContent = `${(fight.dist || 0).toFixed(1)}m`;
    let label = '장력';
    let cls = '';
    if (v > 0.92) {
      label = '위험! 멈춰요';
      cls = 'hot';
    } else if (fight.drag || fight.run) {
      label = '달린다! 잠깐 멈춰요';
      cls = v > 0.8 ? 'hot' : '';
    } else if (v < 0.1) {
      label = '느슨해요! 감아요';
    } else label = '좋아요, 감아요';
    $('tLabel').textContent = label;
    setStatus('파이팅!', '', cls);
    const sh = $('sideHint');
    if (fight.side && !fallback && diff === 'hard') {
      sh.innerHTML = fight.side < 0 ? '<i>←</i> 폰을 오른쪽으로 눕혀요 <i>→</i>' : '<i>←</i> 폰을 왼쪽으로 눕혀요 <i>→</i>';
    } else sh.textContent = '';
  }

  function showCard(kind, k, n, w, s, ms) {
    const c = $('card');
    c.className = `card${kind === 'bad' ? ' bad' : kind === 'hold' ? ' hold' : ''}`;
    $('cardK').textContent = k;
    $('cardN').textContent = n;
    $('cardW').innerHTML = w || '';
    $('cardS').textContent = s || '';
    void c.offsetWidth;
    c.classList.add('on');
    clearTimeout(c._t);
    c._t = setTimeout(() => c.classList.remove('on'), ms || 2600);
  }

  // 큰 화면이 아직 호수를 열지 않았을 때(막 켜지는 중이거나 다시 연결 중)
  function showHold() {
    mode = 'hold';
    $('msgT').textContent = '큰 화면을 기다리는 중…';
    $('msgB').textContent = '';
    const fb = $('btnFallback');
    if (fb) fb.remove();
    show('vMsg');
  }

  function render() {
    if (!me) return;
    if (mode === 'start' || mode === 'connecting' || mode === 'msg') return;
    if (mode === 'tut') {
      tutRefresh();
      return;
    }
    if (playing()) {
      if (fallback) fallbackCalibrate();
      if (mode !== 'play') showPlay();
      else updatePlay();
      return;
    }
    showHold();
  }
  // 센서 안내를 닫고 낚시 화면(아직 방 배정 전이면 연결 중 화면)으로 돌아갑니다.
  function leaveSensorHelp() {
    sensorHelpOn = false;
    if (!me) {
      message('들어가는 중…', '큰 화면과 연결하고 있어요.');
      return;
    }
    mode = 'idle';
    render();
  }
  function sensorsChanged() {
    if (sensorHelpOn && gotOri) {
      // 센서 값이 늦게라도 들어오면 안내를 닫고 센서로 합니다.
      fallback = false;
      leaveSensorHelp();
      return;
    }
    if (mode === 'play' && !tutChecked) {
      // 센서/버튼이 막 정해졌으면 처음 연습을 띄울지 다시 봅니다.
      mode = 'idle';
      render();
    } else if (mode === 'play') updatePlay(true);
    else render();
  }
  function sensorHelp() {
    sensorHelpOn = true;
    // 안내를 닫지 않은 채 경기가 시작돼도 버튼 조작은 되게 둡니다.
    fallback = true;
    message('동작 센서를 쓸 수 없어요', '센서를 허용하거나 버튼으로 해요.');
    const b = document.createElement('button');
    b.id = 'btnFallback';
    b.className = 'ghost';
    b.style.marginTop = '16px';
    b.textContent = '버튼으로 할게요';
    b.addEventListener('click', () => {
      fallback = true;
      leaveSensorHelp();
    });
    $('vMsg').append(b);
  }

  setInterval(() => {
    if (mode !== 'play') return;
    if (myStage() === 'wait' && performance.now() - nibbleAt > 600) $('bob').classList.remove('nib');
    // 물고기가 안 오는 자리에 던졌을 때: 한참 기다리게 두지 말고 다시 던지라고 알려 줍니다.
    if (myStage() === 'wait' && !waitHinted && performance.now() - Math.max(waitSince, nibbleAt) > WAIT_HINT_MS) {
      waitHinted = true;
      cast.msg = '안 오네요, 다시 던져요';
      drawCastHint();
    }
  }, 250);

  // ================================================================
  // 난이도(언제든 바꿈) · 설정 시트
  // ================================================================
  const DIFF = { easy: '쉬움', normal: '보통', hard: '어려움' };
  // 누가 바꿨는지 알려고 큰 화면 설정의 '마지막 변경'을 먼저 받아 둡니다(ps 보다 먼저 듣도록 위에서 등록).
  let lastChange = null;
  const keepLast = (st) => { if (st && st.last && st.last.key) lastChange = st.last; };
  socket.on('game_state', (s) => keepLast(s && s.settings));
  socket.on('msg', (m) => { if (m && m.type === 'pcg-settings') keepLast(m.settings); });
  const ps = createPhoneSettings({ socket });
  ps.attach(socket);
  ps.mount($('sheetSet'));
  haptics.listen(socket, { slot: () => (me ? me.slot : null) });
  let knownDiff = null;
  ps.onChange((vals, info) => {
    const d = vals.difficulty;
    if (!d) return;
    $('setLbl').textContent = DIFF[d] || d;
    $('btnSet').dataset.diff = d;
    diff = CTRL[d] ? d : 'easy';
    K = CTRL[diff];
    if (mode === 'play') updatePlay(true);
    if (knownDiff && knownDiff !== d) {
      const by = info && info.chose ? 'me' : lastChange && lastChange.key === 'difficulty' ? lastChange.by : null;
      const mine = by === 'me' || (me && Number(by) === me.slot);
      // 내가 고른 것은 시트 안에 바로 보이므로 짧게, 남이 바꾼 것은 누가 바꿨는지와 함께 알립니다.
      if (mine) note(T('난이도 {d}', { d: DIFF[d] }), d);
      else if (Number(by) > 0) note(T('{n}P가 난이도를 {d}으로 바꿨어요', { n: Number(by), d: DIFF[d] }), d);
      else note(T('큰 화면에서 난이도를 {d}으로 바꿨어요', { d: DIFF[d] }), d);
    }
    knownDiff = d;
  });
  let noteTimer = null;
  function note(text, level, ms) {
    const n = $('note');
    n.textContent = text;
    if (level) n.dataset.diff = level;
    else delete n.dataset.diff;
    n.classList.add('on');
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => n.classList.remove('on'), ms || 2600);
  }
  function openSheet() {
    audio();
    $('sheet').classList.remove('hidden');
    requestAnimationFrame(() => $('sheet').classList.add('on'));
  }
  function closeSheet() {
    const sh = $('sheet');
    if (!sh || sh.classList.contains('hidden')) return;
    sh.classList.remove('on');
    setTimeout(() => sh.classList.add('hidden'), 220);
  }
  $('btnSet').addEventListener('click', openSheet);
  $('btnSheetClose').addEventListener('click', closeSheet);
  $('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeSheet(); });

  // ================================================================
  // 연습(튜토리얼): 저절로 시작하지 않습니다. 설정의 '튜토리얼 다시 하기' 링크(또는 ?tut=1)로만, 2단계 한 줄씩.
  // 같은 호수에서 진짜로 해 봅니다: 던지고 챔질 → 감아 올리기. 큰 화면은 msg {type:'tut', stage} 를 받고
  // 작은 물고기를 데려와 톡톡 두 번 뒤 꼭 물게 합니다.
  // ================================================================
  const TUT_CAST = new Set(['hook', 'reel']);
  const TUT_HOOK = new Set(['hook', 'reel']);
  let tutStage = null;
  let tutView = null; // 단계 안 작은 화면 { bob, cue, near }
  // 연습용 찌: 물(반투명 사각)을 찌 위에 그려서, 떠 있을 때는 윗반만, 쑥 들어가면 안테나 끝만 보입니다.
  const BOB_SVG = '<svg class="tbob" viewBox="-120 -86 240 146" aria-hidden="true"><defs>' +
    '<linearGradient id="twg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f7a86" stop-opacity=".93"/><stop offset="1" stop-color="#0f2128"/></linearGradient>' +
    '<radialGradient id="tglow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="var(--c)" stop-opacity=".35"/><stop offset="1" stop-color="var(--c)" stop-opacity="0"/></radialGradient>' +
    '<clipPath id="tclip"><rect x="-120" y="-90" width="240" height="148" rx="12"/></clipPath></defs>' +
    '<ellipse cx="0" cy="8" rx="92" ry="30" fill="url(#tglow)" class="tglow"/>' +
    '<g clip-path="url(#tclip)"><g class="tbobG"><line x1="0" y1="-64" x2="0" y2="-24" stroke="#f6f3ee" stroke-width="4"/>' +
    '<rect x="-3.5" y="-76" width="7" height="14" rx="2.5" fill="var(--c)"/><path d="M-24 6 A 24 24 0 0 1 24 6 Z" fill="var(--c)"/><path d="M-24 6 A 24 24 0 0 0 24 6 Z" fill="#f6f3ee"/>' +
    '<path d="M-24 6 h48" stroke="#151515" stroke-width="3"/></g></g>' +
    '<rect x="-120" y="8" width="240" height="52" rx="12" fill="url(#twg)"/>' +
    '<ellipse class="tring" cx="0" cy="9" rx="34" ry="7" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="2"/>' +
    '<ellipse class="tring t2" cx="0" cy="9" rx="34" ry="7" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1.6"/>' +
    '<path d="M-110 9 q 18 -5 36 0 t 36 0 t 36 0 t 36 0 t 36 0 t 36 0" stroke="rgba(255,255,255,.35)" stroke-width="2" fill="none"/></svg>';
  function sendTutStage() {
    send('msg', { type: 'tut', stage: tut.isRunning() ? tutStage : null });
  }
  function tutCue(text, cls) {
    if (!tutView || !tutView.cue) return;
    tutView.cue.textContent = text;
    tutView.cue.className = `tcue${cls ? ` ${cls}` : ''}`;
  }
  // 게임 상태가 바뀔 때 연습 화면을 맞춥니다.
  function tutRefresh() {
    if (!tutView) return;
    const st = myStage();
    if (tutView.bob) tutView.bob.classList.toggle('under', st === 'bite');
    if (tutView.near) tutView.near.classList.toggle('hidden', !(st === 'ready' || (st === 'wait' && fallback)));
    if (tutView.hook) tutView.hook.disabled = !(st === 'wait' || st === 'bite');
    if (tutView.reel) {
      const live = st === 'fight';
      $('tension').classList.toggle('dim', !live);
      if (!live) tutCue(st === 'bite' ? '지금! 위로 확!' : st === 'wait' ? '물면 위로 확!' : st === 'ready' ? '먼저 던져요' : '…', st === 'bite' ? 'hot' : '');
      else tutCue('핸들을 돌려요', '');
      return;
    }
    if (tutStage !== 'hook') return;
    const t = performance.now();
    if (st === 'ready') tutCue('휙 던지거나 아래 버튼');
    else if (st === 'cast') tutCue('날아가요');
    else if (st === 'wait' && t - nibbleAt > 900) tutCue('찌를 지켜봐요');
    else if (st === 'bite') tutCue('지금! 위로 확!', 'hot');
    else if (st === 'fight') tutCue('걸렸다!', 'good');
  }
  function tutBtn(label, cls, onTap) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `tbtn${cls ? ` ${cls}` : ''}`;
    b.innerHTML = label;
    b.addEventListener('click', (e) => {
      e.preventDefault();
      audio();
      onTap();
    });
    return b;
  }
  function fbCast(power, src) {
    const st = myStage();
    if (!playing() || (st !== 'ready' && st !== 'wait')) {
      tut.fail('조금만 기다려요');
      return;
    }
    deliverCast(power, currentAim(), 0, src);
  }
  const TUT_STEPS = [
    {
      id: 'hook', title: '던지고 챔질', body: '휙 던지고, 찌가 쑥 들어가면 위로 확!',
      waitFor: 'hooked', okText: '걸렸다!',
      render(stage) {
        const box = document.createElement('div');
        box.className = 'tview';
        box.innerHTML = `${BOB_SVG}<div class="tcue"></div><div class="tbtns"></div>`;
        stage.append(box);
        const row = box.querySelector('.tbtns');
        const near = tutBtn('던지기', 'main', () => fbCast(BUTTON_POWER, 'button'));
        row.append(near);
        let hook = null;
        // 챔질 버튼: 센서가 있어도 늘 같이 있습니다(폰을 들어 올리는 것과 같은 역할).
        hook = tutBtn('챔질 ↑', 'main hook', () => {
          const st = myStage();
          if (st === 'wait' || st === 'bite') deliverHook(650, 0, st);
        });
        row.append(hook);
        tutView = { bob: box.querySelector('.tbob'), cue: box.querySelector('.tcue'), near, hook };
        tutRefresh();
        return () => { tutView = null; };
      }
    },
    {
      id: 'reel', title: '감아 올리기', body: '핸들을 돌려 감아요',
      waitFor: 'landed', okText: '잡았다!',
      render(stage) {
        const dw = $('dialWrap');
        const tn = $('tension');
        const home = [[dw, dw.parentNode, dw.nextSibling], [tn, tn.parentNode, tn.nextSibling]];
        const box = document.createElement('div');
        box.className = 'treel';
        const cue = document.createElement('div');
        cue.className = 'tcue';
        box.append(cue, tn, dw);
        stage.append(box);
        dw.classList.remove('hidden', 'compact');
        tn.classList.remove('hidden');
        tutView = { cue, reel: true };
        if (myStage() === 'fight') drawTension();
        tutRefresh();
        return () => {
          for (const [el, parent, next] of home) parent.insertBefore(el, next && next.parentNode === parent ? next : null);
          tn.classList.remove('dim');
          tutView = null;
        };
      }
    }
  ];
  const tut = createTutorial({
    key: 'fishing',
    socket,
    steps: TUT_STEPS,
    onStep: (i, step) => {
      tutStage = step.id;
      sendTutStage();
    },
    onDone: () => {
      tutStage = null;
      tutView = null;
      sendTutStage();
      mode = 'idle';
      render();
    }
  });
  // 큰 화면이 알려 준 결과를 연습 단계에 맞춰 풉니다.
  function tutResult(r) {
    if (r.fish) {
      tut.signal('landed', r);
      return;
    }
    if (r.kind === 'early') tut.fail('아직이에요!');
    else if (r.kind === 'miss' && r.why === 'early') tut.fail('너무 일찍이에요');
    else if (r.kind === 'miss') tut.fail('조금 늦었어요');
    else if (r.kind === 'unhook' || r.kind === 'break') tut.fail('놓쳤어요');
  }
  function startTutorial() {
    if (tut.isRunning()) return;
    closeSheet();
    mode = 'tut';
    show('vPlay');
    tut.run();
  }
  // 설정 시트의 '튜토리얼 다시 하기'
  tut.link($('sheetLinks'), {
    before: () => {
      closeSheet();
      if (!me || !playing()) {
        note('낚시 화면에서 다시 눌러요');
        return false;
      }
      mode = 'tut';
      show('vPlay');
      return true;
    }
  });

  // ---------- 소켓 ----------
  socket.on('connect', () => {
    measureRtt();
    banner('');
    socket.emit('join', { role: 'controller', room: ROOM, token });
  });
  socket.on('disconnect', () => {
    if (me) banner('서버 연결이 끊겼어요. 다시 잇는 중…');
  });
  socket.on('assigned', (p) => {
    if (!p || p.game !== 'fishing') {
      const code = encodeURIComponent((p && p.code) || ROOM);
      const g = p && p.game;
      location.replace(`${!g || g === 'baseball' ? '/play/' : `/play/${g}/`}?room=${code}`);
      return;
    }
    me = p;
    noRoomTries = 0;
    document.documentElement.style.setProperty('--c', p.color);
    $('me').textContent = p.name;
    if (tut.isRunning()) {
      tut.setColor(p.color);
      sendTutStage();
    }
    if (pendingCal) {
      pendingCal = false;
      send('calibrate', { e0: basis ? round(basis.e0, 1) : 25 });
    }
    // 센서 안내 중이면 안내를 그대로 둡니다(다시 연결 안내 등에 덮였으면 다시 띄움).
    if (sensorHelpOn) {
      sensorHelp();
      return;
    }
    if (mode === 'connecting' || mode === 'msg') mode = 'idle';
    render();
  });
  socket.on('display_status', ({ connected } = {}) => {
    banner(connected ? '' : '큰 화면이 꺼져 있어요. 다시 열리면 이어서 해요.');
    // 큰 화면이 새로고침되면 연습 단계를 다시 알려 줍니다(물고기 데려오기 등).
    if (connected && tut.isRunning()) setTimeout(sendTutStage, 300);
  });
  socket.on('no_room', () => {
    // 서버가 막 다시 떴으면 큰 화면이 같은 코드로 방을 다시 만들 때까지 잠깐 기다립니다.
    if (noRoomTries++ < 15) {
      if (!sensorHelpOn) message('방에 다시 연결하는 중', '잠시만 기다려 주세요.');
      setTimeout(() => socket.connected && socket.emit('join', { role: 'controller', room: ROOM, token }), 2000);
      return;
    }
    message('방을 찾을 수 없어요', '큰 화면의 QR을 다시 찍어 주세요.');
  });
  socket.on('room_full', () => message('4명이 꽉 찼어요', '빈자리가 생기면 다시 찍어 주세요.'));
  socket.on('replaced', () => message('다른 탭에서 열었어요', '마지막으로 연 화면에서 조작해요.'));
  socket.on('room_closed', () => message('방이 닫혔어요', '큰 화면의 새 QR을 찍어 주세요.'));

  socket.on('game_state', (s) => {
    const prevPhase = state.phase;
    state = s && typeof s === 'object' ? s : { phase: 'lobby' };
    stateAt = performance.now();
    const open = (p) => p === 'open' || p === 'playing';
    if (open(state.phase) && !open(prevPhase)) {
      lastStage = null;
      cast.msg = '';
      $('card').classList.remove('on');
    }
    render();
  });

  socket.on('cue', (c) => {
    const kind = c && c.kind;
    if (kind === 'calibrated') return;
    if (kind === 'landed') {
      plop();
      vib(25);
      cast.msg = c.dist ? T('약 {d}m', { d: c.dist }) : '';
      drawCastHint();
    } else if (kind === 'nibble') {
      nibbleAt = performance.now();
      for (const b of [$('bob'), tutView && tutView.bob].filter(Boolean)) {
        b.classList.remove('nib');
        void b.getBoundingClientRect();
        b.classList.add('nib');
      }
      nibbleSnd();
      // 톡톡: 짧게 두 번(Android 진동, iPhone 은 스위치 햅틱 + 하얀 깜빡임).
      // 마지막 톡톡(쉬움·보통)은 조금 길게 세 번 + "곧 쑥 들어가요" 로 다음이 입질임을 미리 알려 줍니다.
      if (c.last) {
        buzz([26, 45, 26, 45, 40], 'nib');
        setStatus('곧 물어요!', '', '');
        tutCue('곧 물어요!');
      } else {
        buzz([18, 50, 18], 'nib');
        setStatus('톡톡… 참아요', '', '');
        tutCue('톡톡… 참아요');
      }
    } else if (kind === 'hooked') {
      hookedSnd();
      buzz([140, 50, 90], 'go');
      setStatus('걸렸다! 돌려요', '', 'good');
      if (mode === 'tut') tut.signal('hooked', c);
    } else if (kind === 'jump') {
      splashSnd();
      buzz([40, 30, 40, 30, 60]);
      setStatus('점프!', '', 'hot');
    } else if (kind === 'slack') {
      buzz([50, 50, 50]);
      setStatus('느슨해요! 감아요', '', 'hot');
    } else if (kind === 'back') {
      cast.msg = '다시 던져요';
      drawCastHint();
    }
  });

  socket.on('bite', (d) => {
    const k = clamp(Number(d && d.strength) || 0.6, 0.3, 1);
    const on = Math.round(70 + 60 * k);
    // 부르르르: 짧고 센 진동을 연달아
    buzz([on, 35, on, 35, on, 35, on, 35, on + 60], 'bite');
    biteSnd();
    setStatus('지금! 위로 확!', '', 'hot');
    if (!fallback) $('hookRow').classList.remove('hidden');
    $('bob').classList.add('under');
    if (tutView && tutView.bob) tutView.bob.classList.add('under');
    tutCue('지금! 위로 확!', 'hot');
  });

  socket.on('tension', (d) => {
    if (!d) return;
    if (!d.fish) {
      fight.value = 0;
      dragSound(false);
      return;
    }
    fight = { value: Number(d.value) || 0, dist: Number(d.dist) || 0, drag: Boolean(d.drag), run: Boolean(d.run), side: Number(d.side) || 0, at: performance.now() };
    if ((mode === 'play' || mode === 'tut') && myStage() === 'fight') drawTension();
    if (fight.value > 0.8) vib(Math.round(Math.min(120, 50 + (fight.value - 0.8) * 400)));
    dragSound(fight.drag, fight.value);
  });

  socket.on('result', (r) => {
    r = r || {};
    if (r.kind === 'final') return; // 대기 화면에서 순위를 보여 줍니다
    if (mode === 'tut') tutResult(r);
    if (r.kind === 'early' && r.soft) {
      // 쉬운 난이도: 일찍 챘지만 물고기는 그대로(놀라지 않음)
      tone(700, 0.08, 0.15, 'triangle', 520);
      buzz([40]);
      setStatus('아직이에요!', '', '');
      showCard('hold', 'NOT YET', r.text || '아직이에요!', '', r.sub || '', 2200);
      return;
    }
    if (r.fish) {
      const big = (r.weight || 0) >= 2.5;
      fanfare(big);
      buzz(big ? [60, 40, 60, 40, 260] : [60, 40, 160], 'go');
      setStatus(T('잡았다! {w}kg {fish}', { w: Number(r.weight).toFixed(1), fish: r.fish }), r.record ? '오늘의 최대어예요!' : '', 'good');
      showCard('good', r.record ? '오늘의 최대어!' : r.best && r.count > 1 ? '개인 최고!' : '잡았다!', r.fish,
        `${Number(r.weight).toFixed(1)}<small>kg</small>`, `${r.length ? `${Math.round(r.length * 100)}cm · ` : ''}${T('지금까지 {n}마리, 총 {kg}kg', { n: r.count || 1, kg: (r.total || 0).toFixed(1) })}`, 3400);
    } else {
      if (r.kind === 'break') snapSnd();
      else tone(420, 0.2, 0.2, 'triangle', 300);
      buzz(r.kind === 'break' ? [200] : [80]);
      showCard('bad', r.kind === 'break' ? 'LINE BREAK' : 'MISS', r.text || '', '', r.sub || '', 2600);
    }
  });

  // ---------- 버튼 ----------
  $('btnStart').addEventListener('click', async () => {
    if (mode !== 'start') return;
    mode = 'connecting';
    $('btnStart').disabled = true;
    // 화면 꺼짐 방지와 권한 요청은 탭 안에서 await 전에 바로 불러야 iPhone 에서 통합니다.
    if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
    audio();
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
    if (permDenied && isTouch && !DEBUG) {
      socket.connect();
      sensorHelp();
      return;
    }
    $('msgT').textContent = '들어가는 중…';
    $('msgB').textContent = '큰 화면과 연결하고 있어요.';
    show('vMsg');
    socket.connect();
    setTimeout(() => {
      if (gotOri && gotMotion && !DEBUG) return;
      if (isTouch && !DEBUG && !gotOri) {
        // 센서가 막힌 폰(예: http 주소): 켜는 법을 안내하고 버튼으로도 할 수 있게 합니다.
        sensorHelp();
        return;
      }
      if (!gotOri || DEBUG || !isTouch) {
        fallback = true;
        debug('동작 센서 값이 들어오지 않아 버튼으로 합니다');
        sensorsChanged();
      }
    }, SENSOR_WAIT_MS);
  });
  $('btnRecal').addEventListener('click', () => { audio(); recalibrate(); });

  // ---------- 시험용 버튼(센서 없음, 또는 &debug): 폰 동작과 같은 전송 길을 씁니다 ----------
  // 방향 슬라이더가 가짜 낚싯대 방향(pose)이 되어 큰 화면의 조준선이 그대로 움직입니다.
  let fbCalSent = false;
  let fbPoseTimer = null;
  function fallbackCalibrate() {
    if (!me || fbCalSent) return;
    if (send('calibrate', { e0: 25 })) fbCalSent = true;
    if (!fbPoseTimer) fbPoseTimer = setInterval(fallbackPose, 60);
  }
  function fallbackPose() {
    if (!fallback || !playing()) return;
    const yaw = (Number($('aim').value) || 0) * RD;
    const st = myStage();
    // 감는 중·파이팅에는 조금 들어 올린 자세
    const e = (st === 'fight' ? 38 : 25) * RD;
    send('pose', { s: r3([Math.sin(yaw) * Math.cos(e), Math.sin(e), Math.cos(yaw) * Math.cos(e)]) }, true);
  }
  function padCast() {
    if ($('btnCast').disabled) return;
    audio();
    const p = clamp((Number($('pow').value) || 0) / 100, 0.05, 1);
    drawGauge(150);
    setTimeout(() => drawGauge(20), 160);
    setTimeout(() => drawGauge(35), 500);
    deliverCast(p, Number($('aim').value) || 0, 0, 'button');
  }
  function padNear() {
    if ($('btnNear').disabled) return;
    nearCast();
  }
  function padHook() {
    if ($('btnHook').disabled) return;
    audio();
    deliverHook(650, 0, myStage());
  }
  // 감기(누르고 있는 동안 초당 2.4바퀴)
  const holdReel = { on: false, last: 0 };
  function holdReelLoop() {
    if (!holdReel.on) return;
    const now = performance.now();
    addTurns(((now - holdReel.last) / 1000) * 2.4);
    holdReel.last = now;
    setArm((reel.total * TAU) % TAU);
    requestAnimationFrame(holdReelLoop);
  }
  function startHoldReel() {
    if ($('btnReel').disabled || holdReel.on) return;
    audio();
    holdReel.on = true;
    holdReel.last = performance.now();
    $('btnReel').classList.add('on');
    holdReelLoop();
  }
  function stopHoldReel() {
    holdReel.on = false;
    $('btnReel').classList.remove('on');
  }
  // 툭: 핸들을 반 바퀴만 살짝(찌가 톡 움직여 물고기 눈길을 끕니다)
  function padTwitch() {
    if ($('btnTwitch').disabled) return;
    audio();
    addTurns(0.5);
    tick(1100);
  }
  function syncSliders() {
    const a = Number($('aim').value) || 0;
    $('aimV').textContent = a === 0 ? T('정면') : T(a < 0 ? '왼쪽 {n}°' : '오른쪽 {n}°', { n: Math.abs(a) });
    $('powV').textContent = `${$('pow').value}%`;
  }
  $('aim').addEventListener('input', syncSliders);
  $('pow').addEventListener('input', syncSliders);
  syncSliders();
  $('btnCast').addEventListener('click', padCast);
  $('btnNear').addEventListener('click', padNear);
  $('btnNearM').addEventListener('click', nearCast);
  $('btnCastM').addEventListener('click', buttonCast);
  $('btnHookM').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    audio();
    const st = myStage();
    if (st === 'bite' || st === 'wait') deliverHook(650, 0, st);
  });
  $('btnHook').addEventListener('pointerdown', (e) => { e.preventDefault(); padHook(); });
  $('btnTwitch').addEventListener('pointerdown', (e) => { e.preventDefault(); padTwitch(); });
  $('btnReel').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { $('btnReel').setPointerCapture(e.pointerId); } catch (err) {}
    startHoldReel();
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) $('btnReel').addEventListener(ev, stopHoldReel);
  // 키보드(PC 에서 폰 화면을 띄워 시험할 때): C 던지기 · Space/H 챔질 · R 감기(누르고 있기) · T 툭 · ←→ 방향 · ↑↓ 힘
  document.addEventListener('keydown', (e) => {
    if (mode !== 'play' || e.repeat) return;
    if (e.code === 'KeyC') padCast();
    else if (e.code === 'KeyN') nearCast();
    else if (e.code === 'Space' || e.code === 'KeyH') {
      e.preventDefault();
      padHook();
    } else if (e.code === 'KeyR' || e.code === 'KeyJ') startHoldReel();
    else if (e.code === 'KeyT') padTwitch();
    else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const a = $('aim');
      a.value = clamp(Number(a.value) + (e.code === 'ArrowLeft' ? -5 : 5), -AIM_MAX, AIM_MAX);
      syncSliders();
    } else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      const p = $('pow');
      p.value = clamp(Number(p.value) + (e.code === 'ArrowUp' ? 5 : -5), 5, 100);
      syncSliders();
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'KeyR' || e.code === 'KeyJ') stopHoldReel();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && mode !== 'start' && navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
  });
  if (!window.isSecureContext) $('httpNote').classList.remove('hidden');
  mountSwitcher($('langBox'), { reload: true, compact: true }); // 시작 화면에만 있는 언어 고르기(경기 중에는 보이지 않음)

  // 핸들 눈금
  {
    const g = $('ticks');
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', (Math.cos(a) * 124).toFixed(1));
      l.setAttribute('y1', (Math.sin(a) * 124).toFixed(1));
      l.setAttribute('x2', (Math.cos(a) * (i % 3 ? 132 : 138)).toFixed(1));
      l.setAttribute('y2', (Math.sin(a) * (i % 3 ? 132 : 138)).toFixed(1));
      l.setAttribute('stroke', 'rgba(255,255,255,.25)');
      l.setAttribute('stroke-width', i % 3 ? 2 : 3);
      g.append(l);
    }
  }

  // ---------- 디버그 (&debug) ----------
  function debug(t) {
    if (DEBUG) $('debug').textContent = t;
  }
  if (DEBUG) {
    let lastO = 0;
    let lastM = 0;
    setInterval(() => {
      const el = eHist.length ? eHist[eHist.length - 1].e : 0;
      $('debug').textContent = `ori ${(oriCount - lastO) * 2}Hz motion ${(motCount - lastM) * 2}Hz rtt ${Math.round(rtt())}ms rot ${Math.round(rotNow)} ` +
        `e ${el.toFixed(0)} e0 ${basis ? basis.e0.toFixed(0) : '-'} cast ${cast.state} stage ${myStage()} reel ${reel.rate.toFixed(2)} mode ${mode}`;
      lastO = oriCount;
      lastM = motCount;
    }, 500);
  }
}
