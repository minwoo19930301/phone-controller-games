// 탁구 컨트롤러. 폰이 탁구채입니다.
// 폰 방향(pose)을 계속 큰 화면으로 흘려보내고, 스윙은 폰에서 직접 잡아 swing 으로 보냅니다.
// 좌표는 '준비' 때 정한 기준축으로 보냅니다: r = 내 오른쪽, u = 위, f = 화면이 TV(탁구대)를 보던 방향.
// 대기 화면: 난이도·슬로우(큰 화면이 정한 값, 공통 phone-settings), 준비 버튼(모두 준비하면 시작), 처음이면 연습(공통 tutorial).
// 진동: 휘두르는 순간 폰이 스스로 울리고, 큰 화면이 맞혔다고 확인하면 d2c haptic 으로 한 번 더(220ms 안이면 한 번만).
import { haptics } from '/common/haptics.js';
import { createPhoneSettings } from '/common/phone-settings.js';
import { createTutorial } from '/common/tutorial.js';
import { tiltOffset, deltaAngle, validRange, positionFromAngle } from './steering.mjs';

(() => {
  const $ = (id) => document.getElementById(id);
  const RD = Math.PI / 180;
  const G = 9.81;
  const params = new URLSearchParams(location.search);
  const ROOM = (params.get('room') || '').toUpperCase();
  const DEBUG = params.has('debug');
  $('room').textContent = ROOM ? `방 ${ROOM}` : '';

  // ---------- 조정 값 (실폰 검증 전이라 바뀔 수 있습니다) ----------
  const POSE_MS = 25; // pose 전송 간격, 약 40Hz
  const TRIGGER_DPS = 300; // 회전 속도(도/초)가 이 값을 넘으면 스윙 시작
  // 스윙 사이 최소 간격. 쉬움·보통은 너무 일찍 휘둘렀을 때 다시 휘두를 수 있게 조금 짧습니다.
  const COOLDOWN = { easy: 380, normal: 420, hard: 500 };
  const WINDOW_MS = 100; // 시작 뒤 값을 모으는 시간
  const PRE_MS = 60; // 회전 판별에는 시작 직전 값도 씁니다(가속은 회전보다 먼저 붙습니다)
  const ROT_FULL_DPS = 1200; // 이 회전 속도면 회전 쪽 힘이 만점
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
  const FWD_MIN = 0.1;
  const AIM_MAX = 60; // 조준 각도 한계(도)
  const CUE_MS = 1800; // '지금!' 표시 유지 시간
  const CAL_GUARD_MS = 400; // 자세를 맞춘 직후 흔들림은 스윙으로 보지 않습니다
  const SENSOR_WAIT_MS = 1500; // 이 시간 안에 동작 센서 값이 없으면 버튼 모드

  const PLAY_URL = { baseball: '/play/', golf: '/play/golf/', pingpong: '/play/pingpong/' };
  const SPIN_NAME = { none: '플랫', top: '드라이브', back: '커트', side: '사이드' };
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
  let sensorDiscoveryDone = false;
  let initialSetupDone = false;
  let setupPreReady = false;
  let dominantHand = 'right';
  let handOverride = 'auto';
  // Each phone keeps its own calibration. Automatic correction remains available.
  const steering = { mode: 'auto', configured: false, stage: 0, center: 0, left: null, right: null, value: 0, raw: null, lastT: 0, freezeUntil: 0, awaitCenter: false };

  function show(id) {
    for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === id);
    $('btnRecal').classList.toggle('hidden', !(id === 'vPlay' && gotOri && !fallback));
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
      if (rot < TRIGGER_DPS) rearm = false;
      return;
    }
    if (rot > TRIGGER_DPS && t - lastTrig > ps.pick(COOLDOWN) && canSwing(t)) {
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
    const rotN = clamp01((rotPeak - TRIGGER_DPS) / (ROT_FULL_DPS - TRIGGER_DPS));
    const accN = clamp01(accPeak / ACC_FULL);
    // 가속 값을 주지 않는 기기는 회전만으로 힘을 정합니다.
    const power = clamp(0.12 + 0.88 * (hasAcc ? 0.6 * rotN + 0.4 * accN : rotN), 0.1, 1);

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
    if (nDir >= 2 && !twistOk && Math.max(vF, hitN ? vN : -Infinity) < FWD_MIN) {
      lastTrig = w.prevTrig;
      rearm = true;
      debug(`backswing 무시: vF ${vF.toFixed(2)} vN ${vN.toFixed(2)} rot ${rotPeak.toFixed(0)}`);
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
    data = { ...data, hand: handOverride === 'auto' ? data.hand : handOverride, dominantHand, position: 'position' in data ? data.position : steering.mode === 'auto' ? null : round(steering.value, 3) };
    steering.freezeUntil = performance.now() + 550;
    if (steering.mode === 'tilt') steering.awaitCenter = true;
    lastSwing = { data, at: performance.now() };
    swish(data.power);
    const label = swingLabel(data);
    // 연습 중이면 게임으로 보내지 않고 연습 판정에만 씁니다.
    if (tut.isRunning()) {
      haptics.hit(0.45 + 0.4 * data.power);
      if (tutLive && tutLive.isConnected) tutLive.textContent = `감지: ${label}`;
      tut.signal('swing', { ...data, at: performance.now() - (data.ago || 0) });
      return;
    }
    const live = state.phase === 'playing' && myInfo();
    if (live && socket.connected) socket.emit('c2d', { event: 'swing', data });
    if (mode === 'play') {
      // 휘두르는 순간 바로 진동(지연 없음). 큰 화면이 맞혔다고 알려 오면 haptics 가 같은 진동을 한 번으로 합칩니다.
      haptics.hit(0.55 + 0.4 * data.power);
      clearCue();
      const orb = $('orb');
      orb.classList.remove('hit');
      void orb.offsetWidth;
      orb.classList.add('hit');
      setChips([['감지', label]]);
    } else if (mode === 'wait') {
      haptics.tick();
      $('practice').textContent = `연습 스윙: ${label}`;
    }
  }
  function swingLabel(d) {
    let s = SPIN_NAME[d.spin] || '플랫';
    if (d.spin === 'side') s += d.side > 0 ? '(오른쪽)' : '(왼쪽)';
    const hand = d.hand === 'back' ? '백핸드' : d.hand === 'auto' ? '버튼' : '포핸드';
    return `${s} · ${hand} · 힘 ${Math.round(d.power * 100)}%`;
  }
  // 버튼 스윙: 손을 가릴 수 없으니 'auto'(공 쪽 손)로 보냅니다. 연습에서는 손을 정해 보냅니다.
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
  function audio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
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
  const swish = (power) => noise(0.12, 900 + 900 * power, 0.7, 0.15 + 0.3 * power);
  // 진동 무늬(안드로이드). iPhone·PC 는 공통 haptics 가 화면 번쩍임 + 작은 소리로 바꿉니다.
  const buzz = (pattern) => haptics.buzz(pattern);

  // ---------- 자세 맞추기 ----------
  let countTimer = null;
  function openCal() {
    clearInterval(countTimer);
    mode = 'cal';
    $('calN').classList.add('hidden');
    $('calLegend').classList.remove('hidden');
    $('btnReady').classList.remove('hidden');
    // 돌아갈 곳이 있을 때만 취소할 수 있습니다(경기 중인데 기준이 없으면 꼭 맞춰야 합니다).
    $('btnCalCancel').classList.toggle('hidden', !(basis || state.phase !== 'playing' || !myInfo()));
    $('calT').textContent = basis ? '다시 맞춥니다' : '탁구채처럼 쥡니다';
    $('btnReady').textContent = '자세 확인';
    $('calB').textContent = '폰 아래쪽을 탁구채 손잡이처럼 쥐고,\n화면이 TV를 보게 한 뒤 자세 확인을 누릅니다.';
    show('vCal');
  }
  function startCountdown() {
    if (!gotOri) {
      $('calB').textContent = '방향 센서 값이 들어오지 않습니다.\n잠시 뒤 다시 눌러 주십시오.';
      return;
    }
    mode = 'count';
    let n = 3;
    $('calN').textContent = n;
    $('calN').classList.remove('hidden');
    $('calLegend').classList.add('hidden');
    $('btnReady').classList.add('hidden');
    $('btnCalCancel').classList.add('hidden');
    $('calT').textContent = '그대로 멈추십시오';
    $('calB').textContent = '탁구채를 쥔 자세 그대로, 화면이 TV를 보게 둡니다.';
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
      $('calB').textContent = '방향 센서 값이 끊겼습니다.\n다시 준비를 눌러 주십시오.';
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
    if (setupPreReady) { setupPreReady = false; openSteering(); return true; }
    // Ready first calibrates the paddle, then each player chooses lateral control.
    if (pendingReady) {
      if (!steering.configured) { openSteering(); return true; }
      pendingReady = false; sendReady();
    }
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
    $('steerTitle').textContent = `좌우 조작 맞추기 ${Math.min(steering.stage + 1, 4)}/4`;
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
    if (pendingReady) { pendingReady = false; sendReady(); }
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
    $('tableL').textContent = info.table ? `${info.table} 테이블` : '';
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
    $('status').textContent = info && info.serving
      ? (state.slow ? '공이 떠올랐다 내려오며 느려질 때 휘두릅니다.' : '공이 떠올랐다 내려올 때 휘두릅니다.')
      : (state.slow ? '공이 느려지면 타이밍을 맞춰 휘두릅니다.' : '공이 오면 링이 닫힐 때 휘두릅니다.');
  }
  function clearCue() {
    clearTimeout(cueTimer);
    cueOn = false;
    idleOrb();
  }

  function showPlay() {
    mode = 'play';
    $('fallback').classList.toggle('hidden', !fallback);
    $('fallbackHint').textContent = fallbackReason();
    $('touchSteer').classList.toggle('hidden', steering.mode !== 'touch');
    idleOrb();
    show('vPlay');
  }

  // ---------- 준비(모두 준비하면 시작) ----------
  let readySt = null; // 서버 ready_state { ready, players, away, need }
  let pendingReady = false; // 준비를 눌렀는데 자세를 먼저 맞추는 중
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
      return `<span class="rp${on ? ' on' : ''}${away.includes(x) ? ' off' : ''}${x === me.slot ? ' self' : ''}" style="--pc:${COLORS[x] || '#fff'}">${x}P${on ? ' ✓' : ''}</span>`;
    }).join('') + `<span class="rt">${notYet.length ? `아직 준비 전: ${notYet.map((x) => `${x}P`).join(' · ')}` : '모두 준비 완료'}</span>`;
    row.classList.remove('hidden');
  }

  function showWait(info) {
    mode = 'wait';
    const phase = state.phase;
    const chips = [];
    if (roster.length) chips.push(['참가', `${roster.length}명`]);
    if (fallback) chips.push(['조작', '버튼']);
    else if (gotOri) chips.push(['탁구채 자세', basis ? '맞춤' : '아직', basis ? 'ok' : '']);
    $('btnGo').style.display = '';
    $('setBox').classList.remove('hidden');
    // 내 경기는 끝났는데 다른 테이블이 아직 치는 중이면 결과를 보여 주고 기다립니다.
    const doneWaiting = phase === 'playing' && matchDone(info);
    if (phase === 'over' || doneWaiting) {
      const sc = info && Array.isArray(info.score) ? info.score : null;
      const tail = doneWaiting ? '다른 경기가 끝나기를 기다립니다.' : '모두 다시 하기를 누르면 한 판 더 합니다.';
      if (sc) {
        $('waitT').textContent = sc[0] > sc[1] ? '승리!' : sc[0] < sc[1] ? '패배' : '경기 끝';
        $('waitB').textContent = `${sc[0]} : ${sc[1]}${info.opp ? ` (vs ${info.opp})` : ''}\n${tail}`;
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
      $('waitB').textContent = '지금 경기가 끝나면 함께할 수 있습니다.';
      $('btnGo').style.display = 'none';
      $('setBox').classList.add('hidden');
    } else {
      $('waitT').textContent = '대기실';
      $('waitB').textContent = basis || fallback || !gotOri
        ? '모두 준비를 누르면 시작합니다.'
        : '모두 준비를 누르면 시작합니다.\n준비를 누르면 탁구채 자세부터 맞춥니다.';
    }
    paintReady();
    setChips(chips, 'waitChips');
    const canCal = gotOri && !fallback;
    $('btnCalLobby').classList.toggle('hidden', !canCal || phase === 'playing');
    $('btnCalLobby').textContent = basis ? '탁구채 자세 다시 맞추기' : '탁구채 자세 맞추기';
    $('btnSteerLobby').classList.toggle('hidden', phase === 'playing');
    $('btnSteerLobby').textContent = steering.configured ? '좌우 조작 다시 맞추기' : '좌우 조작 맞추기';
    const p = $('practice');
    const recent = lastSwing && performance.now() - lastSwing.at < 4000;
    if (!recent) p.textContent = basis && gotMotion && phase !== 'playing' ? '휘둘러 보면 감지한 스윙이 여기 뜹니다.' : '';
    show('vWait');
  }

  function render() {
    if (!me) return;
    if (mode === 'start' || mode === 'connecting' || mode === 'msg') return;
    const info = myInfo();
    drawScore(info);
    if (mode === 'cal' || mode === 'count' || mode === 'steer') return;
    if (state.phase === 'playing' && info && !matchDone(info)) {
      if (!basis && gotOri && !fallback) {
        openCal();
        return;
      }
      showPlay();
      return;
    }
    showWait(info);
  }

  function fallbackReason() {
    let why = '동작 센서가 없어 버튼으로 칩니다.';
    if (!window.isSecureContext) why = 'https 주소가 아니라 동작 센서가 꺼져 있습니다. 버튼으로 칩니다.';
    else if (permDenied) why = '동작 권한이 거절돼 버튼으로 칩니다.';
    return `${why} (키보드: Space · T · B)`;
  }

  function sensorsChanged() {
    if (mode === 'play') $('fallback').classList.toggle('hidden', !fallback);
    maybeTutorial();
    maybeInitialSetup();
    render();
  }

  // ---------- 난이도·슬로우(큰 화면이 정하고, 아무 폰이나 바꿀 수 있음) ----------
  const ps = createPhoneSettings();
  ps.attach(socket);
  ps.mount($('setBox'));
  // 슬로우 모드를 아직 아무도 안 정했으면 준비 버튼을 막고 질문 카드를 흔듭니다.
  ps.bindReady($('btnGo'));
  // 큰 화면이 '맞혔다'고 알려 오는 진동(내 자리 것만)
  haptics.listen(socket, { slot: () => (me ? me.slot : null) });

  // ---------- 처음 하는 사람 연습(튜토리얼) ----------
  const HAND_KO = { fore: '포핸드', back: '백핸드' };
  let tutLive = null; // 연습 단계 안의 '감지: …' 줄
  let tutChecked = false; // 처음 연습을 띄울지 이미 따져 봤는지
  // 위에서 내려다본 그림: 탁구대 앞쪽 반, 나(머리·어깨), 탁구채(폰 옆면, 칠하는 쪽 = 공을 치는 면)
  function strokeArt(hand) {
    const fore = hand === 'fore';
    const from = fore ? [152, 114, -34] : [58, 108, 38];
    const to = fore ? [114, 70, 0] : [88, 70, 0];
    const shoulder = [116, 132];
    const ball0 = [96, 12];
    const hit = [to[0] + (fore ? -2 : 2), to[1] - 8];
    const kt = 'keyTimes="0;.36;.64;1" calcMode="spline" keySplines=".5 0 .3 1;0 0 1 1;.45 0 .45 1"';
    const loop = 'dur="2s" repeatCount="indefinite"';
    // 칠하는 면: 포핸드는 화면(내 색), 백핸드는 폰 뒷면(검은 고무)
    const faceUp = fore ? 'fill="var(--pcgt-c)"' : 'fill="#3a4253"';
    const faceDown = fore ? 'fill="#3a4253"' : 'fill="var(--pcgt-c)" opacity=".55"';
    const arc = fore ? 'M158 122 Q154 80 120 66' : 'M52 116 Q54 80 82 66';
    const end = fore ? [120, 66, -0.95, -0.35] : [82, 66, 0.95, -0.35];
    const a = Math.atan2(end[3], end[2]);
    const hd = (k) => `${(end[0] - 10 * Math.cos(a + k)).toFixed(1)} ${(end[1] - 10 * Math.sin(a + k)).toFixed(1)}`;
    return `<svg class="pcgt-svg" viewBox="0 0 200 160" aria-hidden="true">` +
      `<rect x="44" y="8" width="112" height="54" rx="3" fill="#1f4fa3" stroke="#fff" stroke-width="2"/>` +
      `<path d="M100 10v50" stroke="#fff" stroke-width="1.2" opacity=".6"/>` +
      `<path d="M34 8h132" stroke="#e8eef8" stroke-width="4" stroke-linecap="round"/>` +
      `<text x="100" y="4" text-anchor="middle" fill="#9aa8bf" font-size="8" font-weight="800" letter-spacing="1">TV 쪽</text>` +
      `<path class="pcgt-arc" d="${arc}"/><path class="pcgt-arrow" d="M${hd(0.5)} L${end[0]} ${end[1]} L${hd(-0.5)}"/>` +
      `<circle r="4.2" fill="#fff"><animate attributeName="cx" values="${ball0[0]};${hit[0]};${ball0[0] - 14};${ball0[0] - 14}" ${kt} ${loop}/>` +
      `<animate attributeName="cy" values="${ball0[1]};${hit[1]};${ball0[1] - 6};${ball0[1] - 6}" ${kt} ${loop}/>` +
      `<animate attributeName="opacity" values="1;1;0;0" keyTimes="0;.36;.62;1" ${loop}/></circle>` +
      `<ellipse cx="100" cy="138" rx="34" ry="12" fill="#26324a" stroke="rgba(255,255,255,.25)" stroke-width="1.5"/>` +
      `<line x1="${shoulder[0]}" y1="${shoulder[1]}" stroke="#e2ae86" stroke-width="7" stroke-linecap="round">` +
      `<animate attributeName="x2" values="${from[0]};${to[0]};${to[0]};${from[0]}" ${kt} ${loop}/>` +
      `<animate attributeName="y2" values="${from[1] + 6};${to[1] + 6};${to[1] + 6};${from[1] + 6}" ${kt} ${loop}/></line>` +
      `<circle cx="100" cy="133" r="12.5" fill="#e2ae86"/><path d="M90 128q10-8 20 0" stroke="#5a3a28" stroke-width="5" fill="none" stroke-linecap="round"/>` +
      `<g><animateTransform attributeName="transform" type="translate" values="${from[0]} ${from[1]};${to[0]} ${to[1]};${to[0]} ${to[1]};${from[0]} ${from[1]}" ${kt} ${loop}/>` +
      `<g><animateTransform attributeName="transform" type="rotate" values="${from[2]};${to[2]};${to[2]};${from[2]}" ${kt} ${loop}/>` +
      `<rect x="-21" y="-6" width="42" height="12" rx="4" fill="#0b0f17" stroke="#fff" stroke-width="2.4"/>` +
      `<rect x="-17" y="-6" width="34" height="4.2" rx="2" ${faceUp}/><rect x="-17" y="1.8" width="34" height="4.2" rx="2" ${faceDown}/>` +
      `</g></g></svg>`;
  }
  // 탁구채처럼 쥐고 화면이 TV를 보게(옆에서 본 그림)
  const gripArt = () => `<svg class="pcgt-svg" viewBox="0 0 200 160" aria-hidden="true">` +
    `<rect x="132" y="22" width="56" height="38" rx="4" class="pcgt-tv"/><path d="M160 60v10M148 72h24" class="pcgt-tvs"/>` +
    `<text x="160" y="46" text-anchor="middle" fill="#fff" font-size="12" font-weight="900">TV</text>` +
    `<path class="pcgt-beam" d="M70 70L128 48"/>` +
    `<g transform="translate(52 70)"><rect x="-12" y="-46" width="24" height="88" rx="7" class="pcgt-ph"/>` +
    `<rect x="12" y="-40" width="5" height="70" rx="2" fill="var(--pcgt-c)"/>` +
    `<path d="M-20 22c-7 7-7 26 3 34h28c8-8 8-27 0-34z" class="pcgt-hand"/></g>` +
    `<text x="52" y="152" text-anchor="middle" fill="#9aa8bf" font-size="10" font-weight="800">손잡이처럼 아래를 쥐기</text>` +
    `<circle cx="52" cy="70" r="30" class="pcgt-ring"><animate attributeName="r" values="30;52" dur="2.2s" repeatCount="indefinite"/>` +
    `<animate attributeName="opacity" values=".6;0" dur="2.2s" repeatCount="indefinite"/></circle></svg>`;

  // 회전 걸기(옆에서 본 그림): 왼쪽 = 드라이브(아래에서 위로 쓸어 올림, 공이 앞으로 구름),
  // 오른쪽 = 커트(위에서 아래로 깎음, 공이 뒤로 돎). 왼쪽이 탁구대(상대) 쪽이고, 치는 면(내 색)이 공을 봅니다.
  function spinArt() {
    const loop = 'dur="1.8s" repeatCount="indefinite"';
    const head = (x, y, dx, dy, len = 6) => {
      const a = Math.atan2(dy, dx);
      const p = (k) => `${(x - len * Math.cos(a + k)).toFixed(1)} ${(y - len * Math.sin(a + k)).toFixed(1)}`;
      return `M${p(0.55)} L${x} ${y} L${p(-0.55)}`;
    };
    const panel = (ox, drive) => {
      const col = drive ? '#ff9a4d' : '#8fd8ff';
      const path = drive ? 'M80 140Q60 95 48 40' : 'M80 36Q62 78 46 132';
      const tip = drive ? [48, 40, -12, -55] : [46, 132, -16, 54];
      // 공 둘레 회전 화살표: 드라이브는 윗부분이 탁구대 쪽(왼쪽)으로, 커트는 반대로 돕니다.
      const spin = drive
        ? `<path d="M10 -6.6A12 12 0 0 0 -10 -6.6" fill="none" stroke="${col}" stroke-width="2.6" stroke-linecap="round"/>` +
          `<path d="${head(-10, -6.6, -0.55, 0.84, 5)}" fill="none" stroke="${col}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<path d="M-10 -6.6A12 12 0 0 1 10 -6.6" fill="none" stroke="${col}" stroke-width="2.6" stroke-linecap="round"/>` +
          `<path d="${head(10, -6.6, 0.55, 0.84, 5)}" fill="none" stroke="${col}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
      return `<g transform="translate(${ox} 0)">` +
        `<rect x="0" y="98" width="34" height="5" rx="1.5" fill="#1f4fa3" stroke="#fff" stroke-width="1.5"/>` +
        `<path d="M12 104v32" stroke="#5a6478" stroke-width="3" stroke-linecap="round"/>` +
        `<path d="${path}" fill="none" stroke="${col}" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="3 8" opacity=".85"/>` +
        `<path d="${head(tip[0], tip[1], tip[2], tip[3], 8)}" fill="none" stroke="${col}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<circle cx="50" cy="86" r="7" fill="#fff"/>` +
        `<g transform="translate(50 86)"><g><animateTransform attributeName="transform" type="rotate" from="0" to="${drive ? -360 : 360}" dur=".9s" repeatCount="indefinite"/>${spin}</g></g>` +
        `<g><animateMotion path="${path}" keyPoints="0;1;1" keyTimes="0;.55;1" calcMode="linear" ${loop}/>` +
        `<animate attributeName="opacity" values="1;1;.15;1" keyTimes="0;.55;.9;1" ${loop}/>` +
        `<g transform="rotate(${drive ? -24 : 30})"><rect x="-5" y="-22" width="10" height="44" rx="3.5" fill="#0b0f17" stroke="#fff" stroke-width="2"/>` +
        `<rect x="-6.6" y="-17" width="3.2" height="30" rx="1.6" fill="var(--pcgt-c)"/>` +
        `<rect x="-7.5" y="11" width="15" height="15" rx="5.5" fill="#e2ae86"/></g></g>` +
        `<text x="50" y="157" text-anchor="middle" fill="${col}" font-size="13" font-weight="900">${drive ? '드라이브' : '커트'}</text></g>`;
    };
    return `<svg class="pcgt-svg" viewBox="0 0 200 160" aria-hidden="true">` +
      `<path d="M100 16V146" stroke="rgba(255,255,255,.12)" stroke-width="1.5" stroke-dasharray="3 5"/>${panel(0, true)}${panel(100, false)}</svg>`;
  }

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
  function liveLine(stage) {
    tutLive = document.createElement('div');
    tutLive.className = 'tut-live';
    stage.append(tutLive);
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
    const tol = ps.pick({ easy: 340, normal: 250, hard: 150 });
    const at = Number(d.at) || performance.now();
    const err = Math.abs(at - timing.closeAt) < Math.abs(at - timing.lastClose) ? at - timing.closeAt : at - timing.lastClose;
    if (Math.abs(err) <= tol) return { ok: true, msg: Math.abs(err) <= tol / 3 ? 'PERFECT 타이밍!' : '좋은 타이밍이에요' };
    return err < 0 ? '조금 빨라요 · 링이 공에 닿을 때 휘둘러요' : '조금 늦어요 · 링이 닫히는 순간이에요';
  }

  const tut = createTutorial({
    key: 'pingpong',
    socket,
    title: '처음이라 탁구 연습해 봐요',
    steps: [
      {
        title: '탁구채처럼 쥐기',
        body: '폰 아래쪽을 손잡이처럼 쥐고 화면이 TV를 보게 들어요.',
        svg: gripArt,
        waitFor: 'calibrated',
        hint: '자세를 맞추면 넘어가요',
        okText: '기준을 맞췄어요',
        render(stage, api) {
          if (fallback || !gotOri) {
            stage.innerHTML = '<p class="tut-note">이 폰은 동작 센서를 쓸 수 없어 버튼으로 칩니다.</p>';
            const row = document.createElement('div');
            row.className = 'tut-row';
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'tut-btn';
            b.textContent = '버튼으로 할게요';
            b.addEventListener('click', () => api.ok('버튼으로 칩니다'));
            row.append(b);
            stage.append(row);
            return null;
          }
          stage.innerHTML = '<div class="tut-count hidden"></div><div class="tut-row"><button type="button" class="tut-btn">이 자세로 맞추기</button></div>';
          const cnt = stage.querySelector('.tut-count');
          const row = stage.querySelector('.tut-row');
          let timer = null;
          stage.querySelector('.tut-btn').addEventListener('click', () => {
            audio();
            row.classList.add('hidden');
            cnt.classList.remove('hidden');
            let n = 3;
            cnt.textContent = n;
            tick();
            haptics.tick();
            timer = setInterval(() => {
              n -= 1;
              if (n > 0) {
                cnt.textContent = n;
                tick();
                haptics.tick();
                return;
              }
              clearInterval(timer);
              cnt.classList.add('hidden');
              if (captureBasis(true)) api.signal('calibrated', {});
              else {
                row.classList.remove('hidden');
                api.fail('방향 센서 값이 끊겼어요. 다시 눌러 주세요');
              }
            }, 1000);
          });
          return () => clearInterval(timer);
        }
      },
      {
        title: '포핸드',
        body: '화면 쪽 면으로 앞으로 휘둘러 포핸드를 연습해요.',
        svg: () => strokeArt('fore'),
        waitFor: 'swing',
        hint: '포핸드로 휘둘러 보세요',
        check: (d) => d.hand !== 'back' || '뒷면으로 쳤어요 · 화면이 TV 쪽을 보게 휘둘러요',
        render(stage) {
          if (fallback) fallbackButtons(stage, [['포핸드 스윙', 'flat', 'fore']]);
          else liveLine(stage);
          return null;
        }
      },
      {
        title: '백핸드',
        body: '폰을 뒤집어 뒷면으로 밀어 백핸드를 연습해요.',
        svg: () => strokeArt('back'),
        waitFor: 'swing',
        hint: '백핸드로 휘둘러 보세요',
        check: (d) => d.hand === 'back' || '화면 쪽으로 쳤어요 · 손등이 TV를 보게 뒤집어요',
        render(stage) {
          if (fallback) fallbackButtons(stage, [['백핸드 스윙', 'flat', 'back']]);
          else liveLine(stage);
          return null;
        }
      },
      {
        title: '링이 닫힐 때',
        body: '링이 줄어들어 공에 닿는 순간 휘둘러요.',
        waitFor: 'swing',
        hint: '링이 닫힐 때 휘두르기',
        okText: '타이밍 좋아요!',
        check: (d) => timingCheck(d),
        render(stage) {
          const stop = timingStage(stage);
          if (fallback) fallbackButtons(stage, [['스윙', 'flat', 'fore']]);
          else liveLine(stage);
          return stop;
        }
      },
      {
        title: '회전 걸기 (선택)',
        body: '쓸어 올리면 드라이브, 깎아 내리면 커트예요.',
        svg: spinArt,
        waitFor: 'swing',
        hint: '쓸어 올리거나 깎아 보세요',
        check: (d) => (d.spin && d.spin !== 'none' ? { ok: true, msg: `${SPIN_NAME[d.spin]}! 회전이 걸렸어요` } : '회전 없이 쳤어요 · 아래에서 위로 쓸어 올려요'),
        render(stage) {
          if (fallback) fallbackButtons(stage, [['드라이브', 'top', 'fore'], ['커트', 'back', 'fore', true]]);
          else liveLine(stage);
          const skip = document.createElement('button');
          skip.type = 'button';
          skip.className = 'tut-skipone';
          skip.textContent = '이번 건 넘어가기';
          skip.addEventListener('click', () => tut.next());
          stage.append(skip);
          return null;
        }
      }
    ],
    finish: { title: '연습 끝!', body: '이제 좌우 조작을 맞춘 뒤 준비해요.\n경기 중 공이 오면 폰에 "지금!"과 칠 손이 떠요.', button: '좋아요' },
    onDone: () => {
      tutLive = null;
      maybeInitialSetup();
      render();
    }
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
    if (!tut.firstTime()) return;
    // 경기 중인 내 자리로 다시 들어온 경우는 건너뜁니다(대기 화면의 링크로 언제든 할 수 있음).
    if (state.phase === 'playing' && myInfo() && !matchDone(myInfo())) return;
    clearCue();
    tut.run();
  }
  // Finish each player's setup before showing the lobby and its Ready button.
  function maybeInitialSetup() {
    if (!me || initialSetupDone || tut.isRunning() || mode === 'start' || mode === 'connecting' || mode === 'msg') return;
    if (state.phase === 'playing') { initialSetupDone = true; return; }
    if (!gotMotion && !sensorDiscoveryDone) return;
    if (!gotOri && !sensorDiscoveryDone) return;
    initialSetupDone = true;
    if (gotOri && !fallback && !basis) { setupPreReady = true; openCal(); }
    else openSteering();
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
    maybeInitialSetup();
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
      pendingReady = false;
      if (mode === 'steer') mode = 'idle';
      // 내가 치는 경기가 시작됐는데 연습 화면이 떠 있으면 닫습니다(스윙이 경기로 가야 함).
      if (myInfo() && tut.isRunning()) tut.cancel();
    }
    render();
  });

  socket.on('cue', (c) => {
    const kind = c && c.kind;
    // 칠 손: 몸 가운데로 오는 공(zone any)과 서브는 손을 따지지 않습니다.
    const hand = c && kind !== 'serve' && c.zone !== 'any' && HAND_KO[c.hand] ? c.hand : null;
    cueOn = true;
    clearTimeout(cueTimer);
    cueTimer = setTimeout(clearCue, CUE_MS);
    const orb = $('orb');
    setOrb('지금!', hand === 'back' ? '← 백핸드' : hand === 'fore' ? '포핸드 →' : '');
    orb.classList.add('cue');
    $('status').textContent = kind === 'serve'
      ? '서브! 공이 내려오는 타이밍에 휘두릅니다.'
      : hand ? `공이 옵니다! 링이 닫힐 때 ${HAND_KO[hand]}로 휘두릅니다.` : '공이 옵니다! 링이 닫힐 때 휘두릅니다.';
    buzz(kind === 'serve' ? [25, 40, 25] : [45]);
    tick();
  });

  socket.on('result', (r) => {
    r = r || {};
    const t = $('resT');
    t.textContent = r.text || '';
    t.className = `t ${r.good ? 'good' : 'bad'}`;
    if (r.kind === 'early') {
      // 쉬움·보통: 너무 일찍 휘두른 스윙은 헛스윙이 아니라서 한 번 더 휘두르면 됩니다.
      cueOn = true;
      clearTimeout(cueTimer);
      cueTimer = setTimeout(clearCue, CUE_MS);
      $('orb').classList.add('cue');
      setOrb('다시!', $('orbH').textContent);
      $('status').textContent = '조금 빨랐어요. 링이 닫힐 때 한 번 더 휘두릅니다.';
      haptics.play('warn', 0.4);
      return;
    }
    clearCue();
    const chips = [];
    const SPIN_KO = { top: '드라이브', back: '커트', side: '사이드 스핀', smash: '스매시' };
    if (r.spin) chips.push([SPIN_KO[r.spin] || r.spin, '']);
    if (lastSwing && performance.now() - lastSwing.at < 1500) chips.push(['감지', swingLabel(lastSwing.data)]);
    setChips(chips);
    if (r.kind === 'point') {
      // 득점·실점: 진동 무늬로 바로 알 수 있게
      if (r.good) haptics.success();
      else haptics.fail();
    } else if (r.kind === 'hit') {
      // 맞힌 진동은 큰 화면의 haptic 이 줍니다. 여기서는 '똑' 소리만.
      pock();
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
      sensorDiscoveryDone = true;
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
    if (!basis && gotOri && !fallback && state.phase !== 'playing') {
      pendingReady = true;
      openCal();
      return;
    }
    if (!steering.configured && state.phase !== 'playing') {
      pendingReady = true;
      openSteering();
      return;
    }
    sendReady();
  });
  $('dominantHand').addEventListener('change', (e) => { dominantHand = e.target.value === 'left' ? 'left' : 'right'; emitPosition(); });
  $('btnSteerLobby').addEventListener('click', () => { pendingReady = false; openSteering(); });
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
    pendingReady = false;
    if (setupPreReady) { setupPreReady = false; openSteering(); return; }
    mode = 'idle';
    render();
  });
  // 버튼 스윙은 손을 뗄 때가 아니라 누르는 순간 보냅니다(타이밍).
  for (const btn of document.querySelectorAll('#fallback button')) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      audio();
      presetSwing(btn.dataset.kind);
    });
  }
  document.addEventListener('keydown', (e) => {
    if (!fallback || mode !== 'play' || e.repeat) return;
    const k = e.code === 'Space' ? 'flat' : e.key === 't' || e.key === 'T' ? 'top' : e.key === 'b' || e.key === 'B' ? 'back' : null;
    if (!k) return;
    e.preventDefault();
    audio();
    presetSwing(k);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && mode !== 'start' && navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
  });

  if (!window.isSecureContext) $('httpNote').classList.remove('hidden');

  // ---------- 디버그 (&debug) ----------
  function debug(t) {
    if (DEBUG) $('debug').textContent = t;
  }
  if (DEBUG) document.body.classList.add('dbg');
  // 시험용: 콘솔·헤드리스에서 상태 보기와 스윙 넣기
  window.__ppc = {
    tut, ps, haptics, timing,
    state: () => ({ mode, phase: state.phase, me: me && me.slot, basis: Boolean(basis), fallback, ready: iAmReady(), cue: cueOn, tut: tut.isRunning() ? tut.current() && tut.current().title : null, steering: { ...steering }, dominantHand, handOverride }),
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
