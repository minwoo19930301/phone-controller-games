// 탁구 컨트롤러. 폰이 탁구채입니다.
// 폰 방향(pose)을 계속 큰 화면으로 흘려보내고, 스윙은 폰에서 직접 잡아 swing 으로 보냅니다.
// 좌표는 '준비' 때 정한 기준축으로 보냅니다: r = 내 오른쪽, u = 위, f = 화면이 TV(탁구대)를 보던 방향.
// 대기 화면: 난이도·슬로우(큰 화면이 정한 값, 공통 phone-settings), 준비 버튼(모두 준비하면 시작), 연습은 링크로만(공통 tutorial).
// 기본(쉬움·보통)은 한 가지 동작만 씁니다: 공이 오면 휘두르거나 화면을 누르기. 포·백핸드, 회전, 세기, 좌우 위치는 자동이고 어려움에서만 직접 합니다.
// 진동: 휘두르는 순간 폰이 스스로 울리고, 큰 화면이 맞혔다고 확인하면 d2c haptic 으로 한 번 더(220ms 안이면 한 번만).
import { haptics } from '/common/haptics.js';
import { createSamples } from '/common/samples.js';
import { createPhoneSettings } from '/common/phone-settings.js';
import { createTutorial } from '/common/tutorial.js';
import '/pingpong/i18n.js';
import { mountSwitcher } from '/common/i18n.js';
import { tiltOffset, deltaAngle, validRange, positionFromAngle } from './steering.mjs';

(() => {
  const $ = (id) => document.getElementById(id);
  // 번역 모듈이 있으면 그걸로, 없으면 {이름} 자리만 채웁니다.
  const tr = (k, v) => (window.PCG && window.PCG.t ? window.PCG.t(k, v) : String(k).replace(/\{(\w+)\}/g, (m, n) => (v && n in v ? v[n] : m)));
  const RD = Math.PI / 180;
  const G = 9.81;
  const params = new URLSearchParams(location.search);
  const ROOM = (params.get('room') || '').toUpperCase();
  const DEBUG = params.has('debug');
  $('room').textContent = ROOM ? tr('방 {code}', { code: ROOM }) : '';
  mountSwitcher($('langBox'), { reload: true, compact: true });

  // ---------- 조정 값 (실폰 검증 전이라 바뀔 수 있습니다) ----------
  const POSE_MS = 25; // pose 전송 간격, 약 40Hz
  // 회전 속도(도/초)가 이 값을 넘으면 스윙 시작. 쉬움·보통은 살짝 휘둘러도 잡히게 낮췄습니다.
  const TRIGGER_DPS = { easy: 150, normal: 210, hard: 300 };
  // 스윙 사이 최소 간격. 쉬움·보통은 너무 일찍 휘둘렀을 때 다시 휘두를 수 있게 조금 짧습니다.
  const COOLDOWN = { easy: 380, normal: 420, hard: 500 };
  const WINDOW_MS = 100; // 시작 뒤 값을 모으는 시간
  const PRE_MS = 60; // 회전 판별에는 시작 직전 값도 씁니다(가속은 회전보다 먼저 붙습니다)
  const ROT_FULL_DPS = 1200; // 이 회전 속도면 회전 쪽 힘이 만점(어려움만 힘을 가립니다)
  const POWER_EASY = [0.5, 0.75]; // 쉬움·보통은 힘을 이 안으로 모읍니다(세게 쳐도 약하게 쳐도 안전한 가운데 깊이)
  const TAP_GAP_MS = 220; // 누르기 스윙은 이 간격 안에 다시 보내지 않습니다(두 번 인식 방지)
  const HINT_MS = 1600; // 힌트 문구 유지 시간
  const ACC_FULL = 26; // 이 가속(m/s²)이면 가속 쪽 힘이 만점
  const VERT_MIN = 0.5; // 위아래 속도 변화(m/s)가 이 이상이어야 드라이브/커트
  const VERT_RATIO = 0.45; // 그리고 수평 속도 변화의 이 비율 이상이어야 '분명히' 위아래
  const VERT_FULL = 2.0; // 위아래 속도 변화가 이 값이면 스핀 양 최대
  const ROLL_FRAC = 0.7; // 긴 축(rotationRate.beta) 회전이 전체 회전에서 차지해야 하는 비율
  const ROLL_MIN_DPS = 300; // 비틀기로 보려면 긴 축 회전 최고값이 이 이상
  const ROLL_FULL_DPS = 900; // 긴 축 회전 최고값이 이 값이면 사이드 스핀 양 최대
  // 폰을 세워 쥐면 평범한 포핸드 스윙도 긴 축 회전이 큽니다. 팔 전체로 휘두르면 원심·접선 가속이 크고,
  // 손목만 비틀면 센서가 회전축 가까이 있어 가속이 작습니다. 가속이 이 값보다 작을 때만 사이드로 봅니다.
  const TWIST_ACC_BASE = 3; // m/s²
  const TWIST_ACC_PER_DPS = 0.015; // 회전 1도/초당 허용 가속(m/s²)
  const LAT_MIN = 0.35; // 비틀기 방향을 기준축으로 가릴 수 없을 만큼 애매한 자세의 문턱
  // 회전이 문턱을 넘어도 바로 스윙이 아닙니다. 모은 값으로 탁구대 쪽(f)이나 치는 면 쪽으로 이만큼(m/s) 움직였어야 스윙이고,
  // 아니면 뒤로 빼는 동작(백스윙)이라 버립니다. 버리면 쿨다운도 걸지 않아 바로 이어지는 앞스윙을 잡습니다.
  const FWD_MIN = { easy: 0.03, normal: 0.06, hard: 0.1 };
  const AIM_MAX = 60; // 조준 각도 한계(도)
  const CUE_MS = 3200; // '지금!' 표시 유지 시간(슬로우로 느려진 시간까지 덮도록 예전 1800 보다 늘림)
  const CAL_GUARD_MS = 400; // 자세를 맞춘 직후 흔들림은 스윙으로 보지 않습니다
  const SENSOR_WAIT_MS = 1500; // 이 시간 안에 동작 센서 값이 없으면 버튼 모드

  const PLAY_URL = { baseball: '/play/', golf: '/play/golf/', pingpong: '/play/pingpong/' };
  const PRESETS = {
    flat: { power: 0.75, spin: 'none', spinAmt: 0 },
    top: { power: 0.8, spin: 'top', spinAmt: 0.8 },
    back: { power: 0.55, spin: 'back', spinAmt: 0.8 }
  };

  let token = null;
  try { token = localStorage.getItem('pcg-token'); } catch (e) {}
  if (!token) {
    token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem('pcg-token', token); } catch (e) {}
  }

  // 웹소켓이 막힌 망에서도 폴링으로 넘어가게 tryAllTransports 를 켭니다(다른 게임과 같음).
  const socket = io({ autoConnect: false, transports: ['websocket', 'polling'], tryAllTransports: true });
  let me = null;
  let noRoomTries = 0;
  let state = { phase: 'lobby' };
  let roster = []; // 서버 players 이벤트(자리·색)
  let mode = 'start'; // start | connecting | msg | wait | cal | count | play
  let gotOri = false;
  let gotMotion = false;
  let fallback = false;
  let permDenied = false;
  let pendingCal = false;
  let dominantHand = 'right';
  let handOverride = 'auto';
  // 좌우 위치는 기본이 자동(공 쪽으로 라켓이 따라감)입니다. 맞추기 화면은 대기실의 작은 '고급' 안에서만 엽니다.
  const steering = { mode: 'auto', configured: true, stage: 0, center: 0, left: null, right: null, value: 0, raw: null, lastT: 0, freezeUntil: 0, awaitCenter: false };

  function show(id) {
    for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === id);
    $('btnRecal').classList.toggle('hidden', !(id === 'vPlay' && gotOri && !fallback));
    if (id !== 'vPlay') hideHint();
  }
  function message(t, b) {
    mode = 'msg';
    $('msgT').textContent = t;
    $('msgB').textContent = b || '';
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
  const clamp01 = (x) => clamp(x, 0, 1);
  const round = (x, n) => { const k = Math.pow(10, n); return Math.round(x * k) / k; };
  const r3 = (v) => [round(v[0], 3), round(v[1], 3), round(v[2], 3)];

  // deviceorientation 값을 세계 좌표(위 = +Y)의 방향으로 바꿉니다. 골프와 같은 변환입니다.
  // 이 좌표에서 폰 윗부분 = (0,0,-1), 화면 바깥 = (0,1,0) 입니다.
  function deviceVectors(alpha, beta, gamma) {
    const q = qFromEuler(beta * RD, alpha * RD, -gamma * RD);
    return { q, top: qRot(q, [0, 0, -1]), face: qRot(q, [0, 1, 0]) };
  }
  // devicemotion 의 기기 축(x = 화면 오른쪽, y = 폰 윗부분, z = 화면 바깥)을 위 좌표로 옮깁니다.
  // y → (0,0,-1), z → (0,1,0), x → (1,0,0) 이라 (x, y, z) → (x, z, -y) 입니다.
  const devToModel = (v) => [v[0], v[2], -v[1]];

  // ---------- 기준축 ----------
  let basis = null; // { r, u, f }
  let calAt = -1e9;
  function makeBasis(top, face) {
    const u = [0, 1, 0];
    let f = [face[0], 0, face[2]];
    // 화면이 위나 아래를 보면(탁구채를 눕혀 쥠) 폰 윗부분, 곧 탁구채 끝이 탁구대 쪽입니다.
    if (Math.hypot(f[0], f[2]) < 0.2) f = [top[0], 0, top[2]];
    f = norm(f);
    return { r: norm(cross(f, u)), u, f };
  }
  const inBasis = (b, v) => [dot(v, b.r), dot(v, b.u), dot(v, b.f)];

  // ---------- 센서 ----------
  let ori = null; // 마지막 방향 { q, top, face }
  const oriBuf = []; // 자세 맞출 때 평균 내려고 최근 방향을 모아 둡니다
  const motBuf = []; // 최근 동작 값
  let lastMotionT = 0;
  let nextPoseAt = 0;
  let accSign = 1; // 기기마다 가속 부호가 반대인 경우가 있어 중력 방향으로 확인합니다
  let gAvg = 0;
  let oriCount = 0;
  let motCount = 0;

  function evTime(e) {
    const n = performance.now();
    const ts = e && e.timeStamp;
    return ts > 0 && Math.abs(n - ts) < 1000 ? ts : n;
  }

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
    updateSteering(t);
    // 약 40Hz 로 줄여 보냅니다. 다음 보낼 시각을 정해 두는 방식이라 60Hz 이벤트에서도 40Hz 가 나옵니다.
    if (basis && t >= nextPoseAt) {
      nextPoseAt = Math.max(nextPoseAt + POSE_MS, t + POSE_MS * 0.4);
      if (socket.connected) {
        socket.volatile.emit('c2d', { event: 'pose', data: { s: r3(inBasis(basis, ori.top)), fc: r3(inBasis(basis, ori.face)), position: steering.mode === 'auto' ? null : round(steering.value, 3), dominantHand } });
      }
    }
  }

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
    // 폰 긴 축(윗부분 방향 = 기기 y축) 둘레 회전. 지금 W3C 명세(크롬·사파리 구현)는 rotationRate 의
    // alpha = x축, beta = y축, gamma = z축(화면에 수직) 회전 속도입니다(deviceorientation 의 각도 이름과 다름).
    const rg = rr.beta || 0;
    const rot = Math.hypot(rr.alpha || 0, rg, rr.gamma || 0);
    if (mode === 'play' && rot > 160) steering.freezeUntil = t + 400;
    if (mode === 'play' && cueOn) cueMaxRot = Math.max(cueMaxRot, rot);
    const ag = e.accelerationIncludingGravity;
    const hasAg = ag && ag.x != null;
    const agDev = hasAg ? [ag.x || 0, ag.y || 0, ag.z || 0] : null;

    // 가만히 있을 때 중력 반작용은 위(+Y)를 향해야 합니다. 반대로 나오는 기기면 부호를 뒤집습니다.
    if (agDev && ori && rot < 60) {
      const gy = qRot(ori.q, devToModel(agDev))[1];
      gAvg += (gy - gAvg) * 0.08;
      if (Math.abs(gAvg) > 5) accSign = gAvg > 0 ? 1 : -1;
    }

    // 중력을 뺀 가속을 세계 좌표로
    let acc = 0;
    let aW = null;
    const la = e.acceleration;
    if (la && la.x != null) {
      const d = [la.x || 0, la.y || 0, la.z || 0];
      acc = Math.hypot(d[0], d[1], d[2]);
      if (ori) aW = scale(qRot(ori.q, devToModel(d)), accSign);
    } else if (agDev && ori) {
      const w = scale(qRot(ori.q, devToModel(agDev)), accSign);
      aW = [w[0], w[1] - G, w[2]];
      acc = Math.hypot(aW[0], aW[1], aW[2]);
    }
    const dt = lastMotionT ? clamp((t - lastMotionT) / 1000, 0, 0.04) : 1 / 60;
    lastMotionT = t;
    motBuf.push({ t, dt, rot, acc, accOk: aW != null || acc > 0, aW, g: rg, top: ori ? ori.top : null, face: ori ? ori.face : null });
    while (motBuf.length && motBuf[0].t < t - 600) motBuf.shift();

    if (swingWin) return;
    // 백스윙을 버린 뒤에는 회전이 한 번 잦아들어야(방향이 바뀌는 순간) 다시 잽니다.
    // 그래야 다음 창이 백스윙 끝이 아니라 앞스윙 시작에서 열립니다.
    if (rearm) {
      if (rot < ps.pick(TRIGGER_DPS)) rearm = false;
      return;
    }
    if (rot > ps.pick(TRIGGER_DPS) && t - lastTrig > ps.pick(COOLDOWN) && canSwing(t)) {
      swingWin = { t0: t, prevTrig: lastTrig, position: steering.mode === 'auto' ? null : round(steering.value, 3) };
      lastTrig = t;
      setTimeout(finishSwing, WINDOW_MS);
    }
  }

  // ---------- 스윙 판별 ----------
  let swingWin = null;
  let lastTrig = -1e9;
  let rearm = false;
  let lastSwing = null; // { data, at }
  let lastTapAt = -1e9;
  let cueMaxRot = 0; // 이번 '지금!' 동안 가장 컸던 회전(휘둘렀는데 안 잡혔는지 가르는 데 씁니다)
  let cueStartAt = 0;

  function canSwing(t) {
    if (!me) return false;
    if (mode === 'start' || mode === 'connecting' || mode === 'count' || mode === 'cal' || mode === 'steer') return false;
    return t - calAt > CAL_GUARD_MS;
  }

  function finishSwing() {
    const w = swingWin;
    swingWin = null;
    if (!w) return;
    const t0 = w.t0;
    const all = motBuf.filter((m) => m.t >= t0 - PRE_MS && m.t <= t0 + WINDOW_MS + 8);
    if (!all.length) return;
    const post = all.filter((m) => m.t >= t0);

    // 가장 빨리 돈 순간 = 공에 맞는 순간으로 봅니다.
    let peak = post.length ? post[0] : all[all.length - 1];
    for (const m of post) if (m.rot > peak.rot) peak = m;
    const rotPeak = peak.rot;
    let accPeak = 0;
    for (const m of all) accPeak = Math.max(accPeak, m.acc);
    const hasAcc = all.some((m) => m.accOk);

    // 힘: 회전 최고값과 가속 최고값
    const rotN = clamp01((rotPeak - 300) / (ROT_FULL_DPS - 300));
    const accN = clamp01(accPeak / ACC_FULL);
    // 가속 값을 주지 않는 기기는 회전만으로 힘을 정합니다.
    let power = clamp(0.12 + 0.88 * (hasAcc ? 0.6 * rotN + 0.4 * accN : rotN), 0.1, 1);
    // 쉬움·보통: 세게든 약하게든 안전한 가운데 깊이로 모읍니다(힘 조절을 가르칠 필요가 없게).
    if (!isHard()) power = POWER_EASY[0] + (POWER_EASY[1] - POWER_EASY[0]) * clamp01((power - 0.12) / 0.88);

    // 기준축. 아직 자세를 안 맞췄으면 지금 방향으로 임시 기준을 만듭니다.
    const b = basis || (ori ? makeBasis(ori.top, ori.face) : null);

    // 포핸드/백핸드와 조준: 맞는 순간 앞뒤 50ms 의 화면 방향 평균
    let face = null;
    const near = all.filter((m) => m.face && Math.abs(m.t - peak.t) <= 50);
    if (near.length) face = norm(near.reduce((a, m) => add(a, m.face), [0, 0, 0]));
    else if (ori) face = ori.face;
    let hand = 'fore';
    let aim = 0;
    if (face && b) {
      const fc = inBasis(b, face);
      hand = fc[2] >= 0 ? 'fore' : 'back';
      // 치는 면(포핸드 = 화면 쪽 빨간 면, 백핸드 = 뒷면)의 방향으로 조준을 잽니다.
      const n = hand === 'fore' ? fc : scale(fc, -1);
      if (Math.hypot(n[0], n[2]) > 0.25) aim = clamp(Math.atan2(n[0], n[2]) / RD, -AIM_MAX, AIM_MAX);
    }
    const handSign = hand === 'fore' ? 1 : -1;

    // 위아래: 세계 좌표 가속을 시작 직전부터 맞는 순간까지 더한 속도 변화
    // (앞뒤 vF 와 치는 면 방향 vN 은 백스윙 가리기에 씁니다)
    let vUp = 0;
    let vR = 0;
    let vF = 0;
    let vN = 0;
    let nDir = 0;
    const hitN = face ? scale(face, handSign) : null; // 치는 면의 바깥 방향(세계 좌표)
    const tStop = Math.max(peak.t, t0 + 30);
    for (const m of all) {
      if (m.t > tStop) break;
      if (!m.aW) continue;
      nDir += 1;
      vUp += m.aW[1] * m.dt;
      if (hitN) vN += dot(m.aW, hitN) * m.dt;
      if (b) {
        vR += dot(m.aW, b.r) * m.dt;
        vF += dot(m.aW, b.f) * m.dt;
      } else {
        vR += m.aW[0] * m.dt;
        vF += m.aW[2] * m.dt;
      }
    }
    const vH = Math.hypot(vR, vF);

    // 비틀기: 긴 축 회전 비율, 최고값, 그리고 치는 면이 오른쪽/왼쪽 어디로 돌았는지
    let sumAbsG = 0;
    let sumRot = 0;
    let gPeak = 0;
    let gSum = 0;
    let latSum = 0;
    for (const m of all) {
      sumAbsG += Math.abs(m.g);
      sumRot += m.rot;
      gSum += m.g;
      gPeak = Math.max(gPeak, Math.abs(m.g));
      // 긴 축 둘레로 g 만큼 돌면 화면 방향은 g·(윗부분 × 화면) 쪽으로 움직입니다. 그 오른쪽 성분.
      if (b && m.top && m.face) latSum += m.g * dot(cross(m.top, m.face), b.r);
    }
    const rollFrac = sumRot > 0 ? sumAbsG / sumRot : 0;
    const latAvg = sumAbsG > 0 ? latSum / sumAbsG : 0;
    // side: +1 = 치는 면이 내 오른쪽으로 돌았음(공이 오른쪽으로 휨), -1 = 왼쪽
    let side;
    if (Math.abs(latAvg) >= LAT_MIN) side = (latAvg > 0 ? 1 : -1) * handSign;
    else side = (gSum > 0 ? -1 : 1) * handSign; // 폰을 세워 쥐면 +beta(오른손 법칙)는 화면이 왼쪽으로 돕니다

    const twistOk = hasAcc && rollFrac >= ROLL_FRAC && gPeak >= ROLL_MIN_DPS &&
      accPeak <= TWIST_ACC_BASE + TWIST_ACC_PER_DPS * rotPeak;
    const vertOk = Math.abs(vUp) >= VERT_MIN && Math.abs(vUp) >= VERT_RATIO * vH;
    // 백스윙: 세계 좌표 가속이 있는데(방향을 알 수 있는데) 탁구대 쪽으로도, 치는 면 쪽으로도 나가지 않았음.
    // 손목 비틀기는 원래 거의 제자리라 빼고 봅니다. 가속을 못 주는 기기는 가릴 수 없어 그대로 보냅니다.
    if (nDir >= 2 && !twistOk && Math.max(vF, hitN ? vN : -Infinity) < ps.pick(FWD_MIN)) {
      lastTrig = w.prevTrig;
      rearm = true;
      debug(`backswing 무시: vF ${vF.toFixed(2)} vN ${vN.toFixed(2)} rot ${rotPeak.toFixed(0)}`);
      // 뒤로 빼는 동작이면 정상이지만, 이어서 앞스윙이 없으면 알려 줍니다(조용히 씹히지 않게).
      expectSwing(650, '더 크게!');
      return;
    }
    let spin = 'none';
    let spinAmt = 0;
    if (twistOk) {
      spin = 'side';
      spinAmt = 0.3 + 0.7 * clamp01((gPeak - ROLL_MIN_DPS) / (ROLL_FULL_DPS - ROLL_MIN_DPS));
    } else if (vertOk) {
      spin = vUp > 0 ? 'top' : 'back';
      spinAmt = 0.3 + 0.7 * clamp01((Math.abs(vUp) - VERT_MIN) / (VERT_FULL - VERT_MIN));
    }

    const data = {
      power: round(power, 3),
      ago: Math.max(0, Math.round(performance.now() - t0)),
      rtt: Math.round(rtt()),
      spin,
      spinAmt: round(spinAmt, 2),
      side,
      aim: round(aim, 1),
      hand, position: w.position
    };
    debug(`swing ${JSON.stringify(data)}\nrot ${rotPeak.toFixed(0)} acc ${accPeak.toFixed(1)} vUp ${vUp.toFixed(2)} vH ${vH.toFixed(2)} ` +
      `roll ${rollFrac.toFixed(2)} gPk ${gPeak.toFixed(0)} lat ${latAvg.toFixed(2)} sign ${accSign} n ${all.length}`);
    deliverSwing(data);
  }

  // 센서 스윙과 버튼 스윙이 같은 길로 나갑니다.
  function deliverSwing(data) {
    // 쉬움·보통: 포·백핸드, 회전, 조준은 자동입니다. 어려움만 폰이 가린 값(또는 고른 손)을 그대로 보냅니다.
    const hard = isHard();
    if (!hard) data = { ...data, hand: 'auto', spin: 'none', spinAmt: 0, aim: ps.difficulty() === 'easy' ? 0 : data.aim };
    data = { ...data, hand: !hard ? 'auto' : handOverride === 'auto' ? data.hand : handOverride, dominantHand, position: 'position' in data ? data.position : steering.mode === 'auto' ? null : round(steering.value, 3) };
    steering.freezeUntil = performance.now() + 550;
    if (steering.mode === 'tilt') steering.awaitCenter = true;
    lastSwing = { data, at: performance.now() };
    swish(data.power);
    clearTimeout(expectTimer);
    // 연습 중이면 게임으로 보내지 않고 연습 판정에만 씁니다.
    if (tut.isRunning()) {
      haptics.hit(0.45 + 0.4 * data.power);
      tut.signal('swing', { ...data, at: performance.now() - (data.ago || 0) });
      return;
    }
    const live = state.phase === 'playing' && myInfo();
    if (live && socket.connected) socket.emit('c2d', { event: 'swing', data });
    const cueWas = cueOn;
    if (mode === 'play') {
      // 휘두르는 순간 바로 진동(지연 없음). 큰 화면이 맞혔다고 알려 오면 haptics 가 같은 진동을 한 번으로 합칩니다.
      haptics.hit(0.55 + 0.4 * data.power);
      clearCue();
      const orb = $('orb');
      orb.classList.remove('hit');
      void orb.offsetWidth;
      orb.classList.add('hit');
      // 공이 오지 않았는데 휘두른 경우: 소리 없이 지나가지 않게 알려 줍니다.
      if (!cueWas && state.phase === 'playing') giveHint('아직이에요');
    } else if (mode === 'wait') {
      haptics.tick();
      $('practice').textContent = '좋아요!';
    }
  }
  // 누르기 스윙: 화면(원이나 '치기' 버튼)을 누르면 센서 없이도 같은 길로 칩니다. 모션 스윙과 두 번 잡히지 않게 간격을 둡니다.
  function tapSwing() {
    if (mode !== 'play') return;
    const now = performance.now();
    if (now - lastTapAt < TAP_GAP_MS || now - lastTrig < TAP_GAP_MS) return;
    lastTapAt = now;
    lastTrig = now;
    audio();
    presetSwing('flat');
  }
  // 힌트: 입력이 무시됐을 때 짧은 글과 진동 한 번
  let hintTimer = null;
  function giveHint(text) {
    const el = $('hint');
    el.textContent = text;
    el.classList.remove('hidden');
    haptics.tick();
    clearTimeout(hintTimer);
    hintTimer = setTimeout(hideHint, HINT_MS);
  }
  function hideHint() {
    clearTimeout(hintTimer);
    $('hint').classList.add('hidden');
  }
  // ms 안에 스윙이 나가지 않으면 힌트를 띄웁니다(공이 오는 중일 때만).
  let expectTimer = null;
  function expectSwing(ms, text) {
    clearTimeout(expectTimer);
    expectTimer = setTimeout(() => { if (mode === 'play' && cueOn) giveHint(text); }, ms);
  }
  // 버튼 스윙: 손을 가릴 수 없으니 'auto'(공 쪽 손)로 보냅니다.
  function presetSwing(kind, hand = 'auto') {
    const p = PRESETS[kind];
    if (!p) return;
    deliverSwing({ power: p.power, ago: 0, rtt: Math.round(rtt()), spin: p.spin, spinAmt: p.spinAmt, side: 1, aim: 0, hand });
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

  // ---------- 소리·진동 ----------
  let actx = null;
  let sfx = null;
  function audio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        actx = new AC();
        // 폰은 휘두를 때 나는 바람 소리 하나만 녹음으로 냅니다(미리 받는 파일 3개). 타구음은 큰 화면이 냅니다.
        const out = actx.createGain();
        out.gain.value = PHONE_GAIN;
        out.connect(actx.destination);
        sfx = createSamples(actx, out);
        sfx.preload(['swing/swoosh-light']);
      }
    }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
  const PHONE_GAIN = 0.8; // 폰 효과음 전체 크기
  function tone(freq, dur, gain, type) {
    const a = audio();
    if (!a) return;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + dur + 0.02);
  }
  function noise(dur, freq, q, gain) {
    const a = audio();
    if (!a) return;
    const len = Math.max(1, Math.floor(a.sampleRate * dur));
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
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
  const tick = () => tone(1800, 0.06, 0.35);
  function pock() {
    // 탁구공 맞는 소리: 짧고 높은 '똑'
    tone(1150, 0.07, 0.5);
    noise(0.03, 3200, 1.4, 0.6);
  }
  const thud = () => tone(190, 0.18, 0.35, 'triangle');
  // 휘두르는 소리: 세게 휘두를수록 크고 높게. 녹음을 못 받았으면 예전 합성 바람 소리.
  const swish = (power) => {
    audio();
    if (sfx && actx.state === 'running' && sfx.play('swing/swoosh-light', { gain: 0.5 + 0.5 * power, rate: 0.9 + 0.25 * power })) return;
    noise(0.12, 900 + 900 * power, 0.7, 0.15 + 0.3 * power);
  };
  // 진동 무늬(안드로이드). iPhone·PC 는 공통 haptics 가 화면 번쩍임 + 작은 소리로 바꿉니다.
  const buzz = (pattern) => haptics.buzz(pattern);

  // ---------- 자세 맞추기 ----------
  let countTimer = null;
  function openCal() {
    clearInterval(countTimer);
    mode = 'cal';
    $('calN').classList.add('hidden');
    $('btnReady').classList.remove('hidden');
    $('btnCalCancel').classList.remove('hidden');
    $('calT').textContent = '자세 맞추기';
    $('btnReady').textContent = '자세 확인';
    $('calB').textContent = '화면이 TV를 보게 쥐고 누르세요.';
    show('vCal');
  }
  function startCountdown() {
    if (!gotOri) {
      $('calB').textContent = '센서 값이 없어요. 잠시 뒤 다시 눌러요.';
      return;
    }
    mode = 'count';
    let n = 3;
    $('calN').textContent = n;
    $('calN').classList.remove('hidden');
    $('btnReady').classList.add('hidden');
    $('btnCalCancel').classList.add('hidden');
    $('calT').textContent = '그대로!';
    $('calB').textContent = '';
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
      $('calB').textContent = '센서 값이 끊겼어요. 다시 눌러요.';
      return false;
    }
    const top = norm(src.reduce((a, o) => add(a, o.top), [0, 0, 0]));
    const face = norm(src.reduce((a, o) => add(a, o.face), [0, 0, 0]));
    basis = makeBasis(top, face);
    calAt = t;
    nextPoseAt = 0;
    // 큰 화면은 이 신호로 탁구채 기준을 다시 잡습니다. 이 뒤의 pose 는 새 기준축 값입니다.
    if (socket.connected && me) socket.emit('c2d', { event: 'calibrate', data: {} });
    else pendingCal = true;
    tone(1320, 0.12, 0.35);
    debug(`calibrate f=${basis.f.map((x) => x.toFixed(2))} top=${top.map((x) => x.toFixed(2))} face=${face.map((x) => x.toFixed(2))}`);
    if (quiet) return true;
    buzz([30, 40, 30]);
    mode = 'idle';
    render();
    return true;
  }

  // Tilt the phone gently left/right while facing the display. A browser IMU
  // cannot measure absolute body position; this is deliberately a steering
  // control, with touch and existing automatic correction as alternatives.
  function currentTilt() {
    return basis && ori ? tiltOffset(inBasis(basis, ori.top)) : null;
  }
  function paintSteering() {
    const text = [
      '폰을 세로로 세우고 화면을 TV 쪽으로 향한 가운데 자세에서 확인을 눌러요.',
      '폰 윗부분을 왼쪽으로 편하게 기울인 뒤 확인을 눌러요.',
      '폰 윗부분을 오른쪽으로 편하게 기울인 뒤 확인을 눌러요.',
      '좌우로 기울여 보고 움직임을 확인해요. 괜찮으면 적용을 눌러요.'
    ];
    const labels = ['가운데 확인', '왼쪽 확인', '오른쪽 확인', '적용'];
    $('steerTitle').textContent = tr('좌우 조작 맞추기 {n}/4', { n: Math.min(steering.stage + 1, 4) });
    $('steerText').textContent = text[steering.stage];
    $('steerNext').textContent = labels[steering.stage];
    let value = 0;
    if (steering.stage === 3) value = steering.value;
    else if (steering.raw != null && steering.stage === 1) value = -Math.min(1, Math.abs(steering.raw) / 45);
    else if (steering.raw != null && steering.stage === 2) value = Math.max(-1, Math.min(1, -Math.sign(steering.left) * steering.raw / 45));
    $('steerDot').style.left = `${50 + 46 * value}%`;
  }
  function updateSteering(t) {
    const tilt = currentTilt();
    if (tilt == null) return;
    steering.raw = deltaAngle(tilt, steering.center);
    if ((steering.mode === 'tilt' || (mode === 'steer' && steering.stage === 3)) && validRange(steering.left, steering.right)) {
      const dt = steering.lastT ? Math.min(0.1, Math.max(0, (t - steering.lastT) / 1000)) : 0.025;
      const target = positionFromAngle(steering.raw, steering.left, steering.right);
      if (steering.awaitCenter && t >= steering.freezeUntil && (Math.abs(target) < 0.12 || Math.abs(target - steering.value) < 0.12)) steering.awaitCenter = false;
      if (mode !== 'play' || (t >= steering.freezeUntil && !steering.awaitCenter)) {
        steering.value += (target - steering.value) * (1 - Math.exp(-dt / 0.16));
      }
      steering.lastT = t;
    }
    if (mode === 'steer') paintSteering();
  }
  function openSteering() {
    mode = 'steer'; steering.stage = 0; steering.raw = null;
    $('steerNotice').textContent = '폰을 좌우로 기울여 조작해요. 몸의 실제 위치는 측정하지 않아요.';
    paintSteering(); show('vSteer');
  }
  function emitPosition() {
    if (socket.connected && me) socket.volatile.emit('c2d', { event: 'pose', data: { position: steering.mode === 'auto' ? null : round(steering.value, 3), dominantHand } });
  }
  function finishSteering(kind) {
    steering.mode = kind; steering.configured = true; steering.value = 0; steering.lastT = 0; steering.awaitCenter = false;
    $('touchPosition').value = 0;
    emitPosition();
    mode = 'idle';
    render();
  }

  // ---------- 화면 상태 ----------
  function myInfo() {
    if (!me || !state || !state.players) return null;
    return state.players[me.slot] || state.players[String(me.slot)] || null;
  }
  function colorOf(name) {
    const p = roster.find((x) => x.name === name);
    return p ? p.color : null;
  }
  function setChips(list, target) {
    const box = $(target || 'resChips');
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

  // 내 경기가 끝났는지: 큰 화면이 주는 done, 없으면 점수(7점 이상 · 2점 차)로 봅니다.
  function matchDone(info) {
    if (!info) return false;
    if (info.done) return true;
    const sc = Array.isArray(info.score) ? info.score : null;
    return Boolean(sc && Math.max(sc[0], sc[1]) >= 7 && Math.abs(sc[0] - sc[1]) >= 2);
  }

  function drawScore(info) {
    if (!info) return;
    const sc = Array.isArray(info.score) ? info.score : [0, 0];
    const done = matchDone(info);
    $('scMe').textContent = sc[0] != null ? sc[0] : 0;
    $('scOpp').textContent = sc[1] != null ? sc[1] : 0;
    $('oppName').textContent = info.opp || '상대';
    $('scOpp').style.color = colorOf(info.opp) || '';
    $('tableL').textContent = info.table ? tr('{table} 테이블', { table: info.table }) : '';
    $('ruleL').textContent = done ? '경기 끝' : info.serving ? '내 서브' : '상대 서브';
    $('srvMe').classList.toggle('on', !done && !!info.serving);
    $('srvOpp').classList.toggle('on', !done && !info.serving);
  }

  let cueOn = false;
  let cueTimer = null;
  function setOrb(text, hand) {
    $('orbT').textContent = text;
    $('orbH').textContent = hand || '';
  }
  function idleOrb() {
    if (cueOn) return;
    const info = myInfo();
    const orb = $('orb');
    orb.classList.remove('cue');
    setOrb(info && info.serving ? '내 서브' : '준비');
    $('status').textContent = '링이 닫힐 때 휘둘러요';
  }
  function clearCue() {
    clearTimeout(cueTimer);
    cueOn = false;
    idleOrb();
  }

  function showPlay() {
    mode = 'play';
    $('fallbackHint').classList.toggle('hidden', !fallback);
    $('fallbackHint').textContent = fallbackReason();
    // 회전 버튼은 센서가 없고 어려움일 때만, 포·백핸드 고르기는 어려움에서만 보입니다.
    $('fallback').classList.toggle('hidden', !(fallback && isHard()));
    $('handButtons').classList.toggle('hidden', !isHard());
    $('touchSteer').classList.toggle('hidden', steering.mode !== 'touch');
    idleOrb();
    show('vPlay');
  }

  // ---------- 준비(모두 준비하면 시작) ----------
  let readySt = null; // 서버 ready_state { ready, players, away, need }
  let readySent = false; // 눌렀고 서버의 ready_state 를 아직 못 받음(바로 '준비 완료'로 보이게)
  const iAmReady = () => readySent || Boolean(me && readySt && Array.isArray(readySt.ready) && readySt.ready.includes(me.slot));
  function sendReady() {
    if (!socket.connected) return;
    socket.emit('c2d', { event: 'start_game', data: {} });
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
    if (done) {
      btn.textContent = tr('준비 완료 ✓');
      const sm = document.createElement('small');
      sm.textContent = tr('다른 사람을 기다려요');
      btn.append(sm);
    }
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
      return `<span class="rp${on ? ' on' : ''}${away.includes(x) ? ' off' : ''}${x === me.slot ? ' self' : ''}" style="--pc:${COLORS[x] || '#fff'}">${x}P${on ? ' ✓' : ''}</span>`;
    }).join('') + `<span class="rt">${notYet.length ? tr('아직 준비 전: {list}', { list: notYet.map((x) => `${x}P`).join(' · ') }) : tr('모두 준비 완료')}</span>`;
    row.classList.remove('hidden');
  }

  function showWait(info) {
    mode = 'wait';
    const phase = state.phase;
    const chips = [];
    if (roster.length) chips.push([tr('참가'), tr('{n}명', { n: roster.length })]);
    if (fallback) chips.push(['조작', '버튼']);
    $('btnGo').style.display = '';
    $('setBox').classList.remove('hidden');
    // 내 경기는 끝났는데 다른 테이블이 아직 치는 중이면 결과를 보여 주고 기다립니다.
    const doneWaiting = phase === 'playing' && matchDone(info);
    if (phase === 'over' || doneWaiting) {
      const sc = info && Array.isArray(info.score) ? info.score : null;
      const tail = doneWaiting ? '다른 경기가 끝나기를 기다립니다.' : '모두 다시 하기를 누르면 한 판 더 합니다.';
      if (sc) {
        $('waitT').textContent = sc[0] > sc[1] ? '승리!' : sc[0] < sc[1] ? '패배' : '경기 끝';
        $('waitB').textContent = `${sc[0]} : ${sc[1]}${info.opp ? ` (vs ${info.opp})` : ''}\n${tr(tail)}`;
      } else {
        $('waitT').textContent = '경기 끝';
        $('waitB').textContent = tail;
      }
      if (doneWaiting) {
        $('btnGo').style.display = 'none';
        $('setBox').classList.add('hidden');
      }
    } else if (phase === 'playing') {
      $('waitT').textContent = '관전 중';
      $('waitB').textContent = '자리가 나면 다음 점수부터 합류해요.';
      $('btnGo').style.display = 'none';
      $('setBox').classList.add('hidden');
    } else {
      $('waitT').textContent = '대기실';
      $('waitB').textContent = '모두 준비를 누르면 시작해요.';
    }
    paintReady();
    setChips(chips, 'waitChips');
    const canCal = gotOri && !fallback;
    $('btnCalLobby').classList.toggle('hidden', !canCal || phase === 'playing');
    $('btnSteerLobby').classList.toggle('hidden', phase === 'playing');
    $('adv').classList.toggle('hidden', phase === 'playing');
    const recent = lastSwing && performance.now() - lastSwing.at < 4000;
    if (!recent) $('practice').textContent = '';
    show('vWait');
  }

  function render() {
    if (!me) return;
    if (mode === 'start' || mode === 'connecting' || mode === 'msg') return;
    const info = myInfo();
    drawScore(info);
    if (mode === 'cal' || mode === 'count' || mode === 'steer') return;
    if (state.phase === 'playing' && info && !matchDone(info)) {
      // 기준축은 따로 맞추지 않습니다. 비어 있으면 지금 자세로 조용히 잡습니다(다시 맞추기는 선택).
      if (!basis && gotOri && !fallback) captureBasis(true);
      showPlay();
      return;
    }
    showWait(info);
  }

  function fallbackReason() {
    return '버튼으로 칩니다.';
  }

  function sensorsChanged() {
    if (mode === 'play') { $('fallback').classList.toggle('hidden', !(fallback && isHard())); $('fallbackHint').classList.toggle('hidden', !fallback); }
    maybeTutorial();
    render();
  }

  // ---------- 난이도·슬로우(큰 화면이 정하고, 아무 폰이나 바꿀 수 있음) ----------
  const ps = createPhoneSettings();
  // 어려움에서만 포·백핸드, 회전, 조준을 직접 합니다(쉬움·보통은 자동).
  const isHard = () => ps.difficulty() === 'hard';
  ps.attach(socket);
  ps.mount($('setBox'));
  // 슬로우 모드를 아직 아무도 안 정했으면 준비 버튼을 막고 질문 카드를 흔듭니다.
  ps.bindReady($('btnGo'));
  // 큰 화면이 '맞혔다'고 알려 오는 진동(내 자리 것만)
  haptics.listen(socket, { slot: () => (me ? me.slot : null) });

  // ---------- 처음 하는 사람 연습(튜토리얼) ----------
  const HAND_KO = { fore: '포핸드', back: '백핸드' };
  let tutChecked = false; // 처음 연습을 띄울지 이미 따져 봤는지
  // 버튼 모드(센서 없음)에서 연습 단계를 마칠 수 있는 버튼들
  function fallbackButtons(stage, list) {
    const row = document.createElement('div');
    row.className = 'tut-row';
    for (const [label, kind, hand, alt] of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `tut-btn${alt ? ' alt' : ''}`;
      b.textContent = label;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        audio();
        presetSwing(kind, hand);
      });
      row.append(b);
    }
    stage.append(row);
  }
  // 링 타이밍 연습: 공이 다가오고 링이 줄어들어 공에 닿는 순간이 치는 순간입니다.
  const timing = { closeAt: 0, lastClose: -1e9 };
  function timingStage(stage) {
    const slowRoom = ps.get('slow') !== false; // 아직 안 정했으면 느린 쪽으로 연습
    const P = slowRoom ? 1500 : 850; // 링이 닫히는 데 걸리는 시간(ms)
    const GAP = 1000;
    stage.insertAdjacentHTML('beforeend',
      `<svg class="tut-timing" viewBox="0 0 240 150" aria-hidden="true">` +
      `<path d="M78 18H162L214 130H26Z" fill="#1f4fa3" stroke="#fff" stroke-width="2"/><path d="M120 18V130" stroke="#fff" stroke-width="1" opacity=".5"/>` +
      `<path d="M62 54H178" stroke="#e8eef8" stroke-width="3"/>` +
      `<circle class="tt-ring" fill="none" stroke="var(--c)" stroke-width="3.5"/><circle class="tt-in" fill="none" stroke="#fff" stroke-width="1.5" stroke-dasharray="3 3"/>` +
      `<circle class="tt-ball" fill="#fff"/><text class="tt-now" x="120" y="146" text-anchor="middle" fill="var(--c)" font-size="15" font-weight="900" opacity="0">지금!</text></svg>`);
    const ring = stage.querySelector('.tt-ring');
    const inner = stage.querySelector('.tt-in');
    const ball = stage.querySelector('.tt-ball');
    const now = stage.querySelector('.tt-now');
    let t0 = performance.now() + 500;
    timing.closeAt = t0 + P;
    let raf = 0;
    const frame = () => {
      const tn = performance.now();
      if (tn > t0 + P + GAP) {
        timing.lastClose = t0 + P;
        t0 = tn + 250;
        timing.closeAt = t0 + P;
      }
      const k = (tn - t0) / P; // 0 → 1 이면 링이 닫힘
      const e = Math.max(0, Math.min(1.25, k));
      // 공: 네트 너머에서 앞으로(작게 → 크게), 1 을 넘으면 계속 앞으로 빠집니다
      const bx = 112 + 40 * e;
      const by = 36 + 78 * e;
      const br = 3 + 6 * e;
      ball.setAttribute('cx', bx.toFixed(1));
      ball.setAttribute('cy', by.toFixed(1));
      ball.setAttribute('r', br.toFixed(1));
      ball.setAttribute('opacity', k < 0 ? '0' : k > 1.2 ? '0' : '1');
      const on = k >= 0 && k <= 1;
      const R = br + 2 + (1 - Math.max(0, Math.min(1, k))) * 46;
      for (const c of [ring, inner]) {
        c.setAttribute('cx', bx.toFixed(1));
        c.setAttribute('cy', by.toFixed(1));
        c.setAttribute('opacity', on ? '1' : '0');
      }
      ring.setAttribute('r', R.toFixed(1));
      inner.setAttribute('r', (br + 2).toFixed(1));
      now.setAttribute('opacity', k > 0.82 && k < 1.12 ? '1' : '0');
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }
  function timingCheck(d) {
    const tol = ps.pick({ easy: 450, normal: 340, hard: 150 });
    const at = Number(d.at) || performance.now();
    const err = Math.abs(at - timing.closeAt) < Math.abs(at - timing.lastClose) ? at - timing.closeAt : at - timing.lastClose;
    if (Math.abs(err) <= tol) return { ok: true, msg: Math.abs(err) <= tol / 3 ? 'PERFECT' : 'GOOD' };
    return err < 0 ? '조금 빨라요' : '조금 늦어요';
  }

  // 연습은 저절로 시작하지 않습니다. 대기실의 '튜토리얼 다시 하기' 링크로만 열고, 한 줄짜리 한 단계뿐입니다.
  const tut = createTutorial({
    key: 'pingpong',
    socket,
    title: '처음이라 연습해 봐요',
    steps: [
      {
        title: '링이 닫힐 때',
        body: '링이 닫힐 때 휘둘러요.',
        waitFor: 'swing',
        hint: '휘두르거나 치기를 눌러요',
        okText: '좋아요!',
        check: (d) => timingCheck(d),
        render(stage) {
          const stop = timingStage(stage);
          fallbackButtons(stage, [['치기', 'flat', 'auto']]);
          return stop;
        }
      }
    ],
    onDone: () => render()
  });
  tut.link($('tutLink'), {
    // 내가 치는 경기 중에는 열지 않습니다(대기 화면에만 있는 링크라 보통은 안 보임).
    before: () => !(state.phase === 'playing' && myInfo() && !matchDone(myInfo()))
  });
  // 처음이면(이 폰 브라우저에 기록이 없으면) 자리를 받고 센서 여부가 정해진 뒤 연습을 띄웁니다.
  function maybeTutorial() {
    if (tutChecked || !me || !(gotMotion || fallback)) return;
    if (mode === 'start' || mode === 'connecting' || mode === 'msg') return;
    tutChecked = true;
    if (!tut.firstTime()) return; // 주소에 ?tut=1 이 있을 때만(시험용)
    if (state.phase === 'playing' && myInfo() && !matchDone(myInfo())) return;
    clearCue();
    tut.run();
  }

  // ---------- 소켓 ----------
  socket.on('connect', () => {
    measureRtt();
    banner('');
    socket.emit('join', { role: 'controller', room: ROOM, token });
  });
  socket.on('disconnect', () => {
    if (me) banner('서버 연결이 끊겼습니다. 다시 잇는 중…');
  });
  socket.on('assigned', (p) => {
    if (!p || p.game !== 'pingpong') {
      const code = encodeURIComponent((p && p.code) || ROOM);
      location.replace(`${(p && PLAY_URL[p.game]) || '/play/'}?room=${code}`);
      return;
    }
    me = p;
    noRoomTries = 0;
    document.documentElement.style.setProperty('--c', p.color);
    tut.setColor(p.color);
    $('me').textContent = p.name;
    if (pendingCal) {
      pendingCal = false;
      socket.emit('c2d', { event: 'calibrate', data: {} });
    }
    emitPosition();
    if (mode === 'connecting' || mode === 'msg') mode = 'idle';
    maybeTutorial();
    render();
  });
  socket.on('players', (payload) => {
    roster = payload && Array.isArray(payload.players) ? payload.players : [];
    if (mode === 'wait') render();
  });
  socket.on('ready_state', (st) => {
    readySt = st && Array.isArray(st.ready) ? st : null;
    readySent = false;
    if (mode === 'wait') paintReady();
  });
  socket.on('display_status', ({ connected } = {}) => {
    banner(connected ? '' : '큰 화면이 꺼져 있습니다. 다시 열리면 이어서 합니다.');
  });
  socket.on('no_room', () => {
    // 서버가 막 다시 떴으면 큰 화면이 같은 코드로 방을 다시 만들 때까지 잠깐 기다립니다(골프와 같음).
    if (noRoomTries++ < 15) {
      message('방에 다시 연결하는 중', '잠시만 기다려 주십시오.');
      setTimeout(() => socket.connected && socket.emit('join', { role: 'controller', room: ROOM, token }), 2000);
      return;
    }
    message('방을 찾을 수 없습니다', '큰 화면의 QR을 다시 찍어 주십시오.');
  });
  socket.on('room_full', () => message('4명이 꽉 찼습니다', '빈자리가 생기면 다시 찍어 주십시오.'));
  socket.on('replaced', () => message('다른 탭에서 열었습니다', '마지막으로 연 화면에서 조작합니다.'));
  socket.on('room_closed', () => message('방이 닫혔습니다', '큰 화면의 새 QR을 찍어 주십시오.'));

  socket.on('game_state', (s) => {
    const prev = state.phase;
    state = s && typeof s === 'object' ? s : { phase: 'lobby' };
    if (state.phase === 'playing' && prev !== 'playing') {
      // 새 경기: 지난 결과를 지웁니다.
      $('resT').textContent = '';
      $('resT').className = 't';
      setChips([]);
      cueOn = false;
      clearTimeout(cueTimer);
      if (mode === 'steer') mode = 'idle';
      // 내가 치는 경기가 시작됐는데 연습 화면이 떠 있으면 닫습니다(스윙이 경기로 가야 함).
      if (myInfo() && tut.isRunning()) tut.cancel();
    }
    render();
  });

  socket.on('cue', (c) => {
    const kind = c && c.kind;
    // 칠 손: 몸 가운데로 오는 공(zone any)과 서브는 손을 따지지 않습니다.
    // 어려움에서만 칠 손을 알려 줍니다.
    const hand = isHard() && c && kind !== 'serve' && c.zone !== 'any' && HAND_KO[c.hand] ? c.hand : null;
    cueOn = true;
    cueMaxRot = 0;
    cueStartAt = performance.now();
    clearTimeout(cueTimer);
    cueTimer = setTimeout(clearCue, CUE_MS);
    const orb = $('orb');
    setOrb('지금!', hand === 'back' ? '← 백핸드' : hand === 'fore' ? '포핸드 →' : '');
    orb.classList.add('cue');
    $('status').textContent = hand ? tr('링이 닫힐 때 {hand}', { hand: HAND_KO[hand] }) : '링이 닫힐 때 휘둘러요';
    buzz(kind === 'serve' ? [25, 40, 25] : [45]);
    tick();
  });

  socket.on('result', (r) => {
    r = r || {};
    const t = $('resT');
    // 큰 화면이 보낸 한국어 원문 조각(parts·reason·me·op)을 이 폰의 언어로 옮겨 붙입니다. 없으면 text 를 그대로 둡니다(DOM 이 번역).
    if (r.kind === 'point' && r.reason != null) {
      t.textContent = r.good ? tr('득점! {me} : {op}', { me: r.me, op: r.op }) : tr('실점 · {reason} {me} : {op}', { reason: r.reason, me: r.me, op: r.op });
    } else if (Array.isArray(r.parts)) {
      t.textContent = r.parts.map((x) => tr(x, r.vars || undefined)).join(' · ');
    } else t.textContent = r.text || '';
    t.className = `t ${r.good ? 'good' : 'bad'}`;
    if (r.kind === 'early') {
      // 쉬움·보통: 너무 일찍 휘두른 스윙은 헛스윙이 아니라서 한 번 더 휘두르면 됩니다.
      cueOn = true;
      clearTimeout(cueTimer);
      cueTimer = setTimeout(clearCue, CUE_MS);
      $('orb').classList.add('cue');
      setOrb('다시!', $('orbH').textContent);
      $('status').textContent = '링이 닫힐 때 한 번 더';
      haptics.play('warn', 0.4);
      return;
    }
    clearCue();
    const chips = [];
    const SPIN_KO = { top: '드라이브', back: '커트', side: '사이드 스핀', smash: '스매시' };
    if (r.spin) chips.push([SPIN_KO[r.spin] || r.spin, '']);
    setChips(chips);
    // 휘두르지 않았거나 센서가 못 잡은 채 지나갔으면 다음엔 어떻게 하면 되는지 알려 줍니다.
    if (r.kind === 'miss' && !(lastSwing && lastSwing.at >= cueStartAt)) {
      giveHint(cueMaxRot > 40 ? '더 크게!' : '화면을 눌러도 쳐요');
    }
    if (r.kind === 'point') {
      // 득점·실점: 진동 무늬로 바로 알 수 있게
      if (r.good) haptics.success();
      else haptics.fail();
    } else if (r.kind === 'hit') {
      // 맞힌 진동은 큰 화면의 haptic 이 줍니다. 타구음은 큰 화면의 실제 녹음이 내므로 폰은 녹음이 있으면 조용히 두고, 없을 때만 합성 '똑'.
      if (!(sfx && sfx.has('swing/swoosh-light'))) pock();
    } else {
      thud();
    }
  });

  // ---------- 버튼 ----------
  $('btnStart').addEventListener('click', async () => {
    if (mode !== 'start') return;
    mode = 'connecting';
    $('btnStart').disabled = true;
    audio();
    haptics.unlock();
    // iPhone 은 탭 안에서, await 전에 두 권한을 함께 물어야 합니다.
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
    if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
    if (!ROOM) {
      message('방 코드가 없습니다', '큰 화면의 QR을 찍어 주십시오.');
      return;
    }
    $('msgT').textContent = '들어가는 중…';
    $('msgB').textContent = '큰 화면과 연결하고 있습니다.';
    show('vMsg');
    socket.connect();
    setTimeout(() => {
      if (!gotMotion) {
        fallback = true;
        debug('동작 센서 값이 들어오지 않아 버튼으로 칩니다');
      }
      sensorsChanged();
    }, SENSOR_WAIT_MS);
  });
  // 준비: 모두 누르면 큰 화면이 시작합니다. 탁구채 자세가 아직이면 먼저 맞추고 바로 준비 완료로 넘어갑니다.
  // (서버에 준비 취소가 없어서, 누른 뒤에는 '준비 완료 ✓ · 다른 사람을 기다려요'로 남습니다.)
  $('btnGo').addEventListener('click', () => {
    audio();
    if (iAmReady()) {
      haptics.tick();
      return;
    }
    // 자세는 따로 맞추지 않고 준비를 누른 그 자세로 잡습니다.
    if (!basis && gotOri && !fallback && state.phase !== 'playing') captureBasis(true);
    sendReady();
  });
  $('dominantHand').addEventListener('change', (e) => { dominantHand = e.target.value === 'left' ? 'left' : 'right'; emitPosition(); });
  $('btnSteerLobby').addEventListener('click', () => openSteering());
  $('steerNext').addEventListener('click', () => {
    if (steering.stage === 3) { finishSteering('tilt'); return; }
    const tilt = currentTilt();
    if (tilt == null) { $('steerNotice').textContent = '폰을 세워 쥐고 다시 시도하거나, 터치 조작 또는 자동 보정을 선택해 주세요.'; return; }
    if (steering.stage === 0) { steering.center = tilt; steering.left = steering.right = null; steering.stage = 1; }
    else if (steering.stage === 1) {
      const left = deltaAngle(tilt, steering.center);
      if (Math.abs(left) < 6) { $('steerNotice').textContent = '폰을 조금 더 왼쪽으로 기울이고 다시 확인해 주세요.'; return; }
      steering.left = left; steering.stage = 2;
    } else {
      const right = deltaAngle(tilt, steering.center);
      if (!validRange(steering.left, right)) { $('steerNotice').textContent = '가운데를 지나 반대쪽으로 조금 더 기울여 주세요.'; return; }
      steering.right = right; steering.value = 0; steering.stage = 3;
    }
    $('steerNotice').textContent = '폰을 좌우로 기울여 조작해요. 몸의 실제 위치는 측정하지 않아요.';
    paintSteering();
  });
  $('steerTouch').addEventListener('click', () => finishSteering('touch'));
  $('steerAuto').addEventListener('click', () => finishSteering('auto'));
  $('touchPosition').addEventListener('input', (e) => { steering.value = Number(e.target.value) / 100; emitPosition(); });
  for (const button of $('handButtons').querySelectorAll('button')) button.addEventListener('click', () => {
    handOverride = button.dataset.hand;
    for (const b of $('handButtons').querySelectorAll('button')) b.classList.toggle('on', b === button);
  });
  $('btnCalLobby').addEventListener('click', () => {
    audio();
    openCal();
  });
  $('btnRecal').addEventListener('click', () => {
    audio();
    clearCue();
    openCal();
  });
  $('btnReady').addEventListener('click', () => {
    audio();
    startCountdown();
  });
  $('btnCalCancel').addEventListener('click', () => {
    clearInterval(countTimer);
    mode = 'idle';
    render();
  });
  // 누르기 스윙(원·무대 어디든, 큰 '치기' 버튼): 모션과 같은 무게의 또 하나의 길입니다. 누르는 순간 보냅니다(타이밍).
  for (const el of [document.querySelector('#vPlay .stage'), $('btnSwing')]) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      tapSwing();
    });
  }
  // 센서 없는 어려움: 회전 버튼
  for (const btn of document.querySelectorAll('#fallback button')) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      audio();
      presetSwing(btn.dataset.kind);
    });
  }
  document.addEventListener('keydown', (e) => {
    if (mode !== 'play' || e.repeat) return;
    if (e.code === 'Space') { e.preventDefault(); tapSwing(); return; }
    if (!fallback || !isHard()) return;
    const k = e.key === 't' || e.key === 'T' ? 'top' : e.key === 'b' || e.key === 'B' ? 'back' : null;
    if (!k) return;
    e.preventDefault();
    audio();
    presetSwing(k);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && mode !== 'start' && navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
  });

  // ---------- 디버그 (&debug) ----------
  function debug(t) {
    if (DEBUG) $('debug').textContent = t;
  }
  if (DEBUG) document.body.classList.add('dbg');
  // 시험용: 콘솔·헤드리스에서 상태 보기와 스윙 넣기
  window.__ppc = {
    tut, ps, haptics, timing,
    state: () => ({ mode, hint: $('hint').textContent, phase: state.phase, me: me && me.slot, basis: Boolean(basis), fallback, ready: iAmReady(), cue: cueOn, tut: tut.isRunning() ? tut.current() && tut.current().title : null, steering: { ...steering }, dominantHand, handOverride }),
    swing: (o = {}) => deliverSwing({ power: 0.7, ago: 0, rtt: Math.round(rtt()), spin: 'none', spinAmt: 0, side: 1, aim: 0, hand: 'fore', ...o })
  };
  if (DEBUG) window.__ppc.debugOrientation = (alpha, beta, gamma) => onOrientation({ alpha, beta, gamma });
  if (DEBUG) {
    let lastO = 0;
    let lastM = 0;
    setInterval(() => {
      if (lastSwing && performance.now() - lastSwing.at < 5000) return;
      debug(`ori ${(oriCount - lastO) * 2}Hz motion ${(motCount - lastM) * 2}Hz rtt ${Math.round(rtt())}ms sign ${accSign} g ${gAvg.toFixed(1)} ` +
        `basis ${basis ? 'Y' : 'N'} mode ${mode}`);
      lastO = oriCount;
      lastM = motCount;
    }, 500);
  }
})();
