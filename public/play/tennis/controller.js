// 테니스 컨트롤러. 폰이 라켓입니다.
// 폰 방향(pose)을 경기 중에 큰 화면으로 흘려보내고(라켓이 폰을 따라 움직임), 스윙은 폰에서 직접 잡아 swing 으로 보냅니다.
// 좌표는 '준비' 때 정한 기준축으로 보냅니다: r = 내 오른쪽, u = 위, f = 화면이 TV 를 보던 방향.
// 스윙 판별: 회전 속도(rotationRate) 최고값 = 세기, 세계 좌표 가속의 위아래 성분 = 탑스핀(위)/슬라이스(아래),
// 맞는 순간 화면이 TV 쪽이면 포핸드, 반대면 백핸드.
// 공통 모듈: 난이도·슬로우(phone-settings), 원할 때만 하는 연습(tutorial), 진동·번쩍임(haptics), 센서 권한(motion).
// 기준축(자세)은 '준비'를 누를 때와 경기가 시작될 때 알아서 잡습니다. 따로 맞추는 단계는 없고, '다시 맞추기'만 선택입니다.
import { haptics } from '/common/haptics.js';
import { createPhoneSettings } from '/common/phone-settings.js';
import { createTutorial } from '/common/tutorial.js';
import { requestMotionPermission } from '/common/motion.js';
import { createSamples } from '/common/samples.js';
import '/tennis/i18n.js';
import { t as T, mountSwitcher } from '/common/i18n.js';

(() => {
  const $ = (id) => document.getElementById(id);
  const RD = Math.PI / 180;
  const G = 9.81;
  const params = new URLSearchParams(location.search);
  const ROOM = (params.get('room') || '').toUpperCase();
  const DEBUG = params.has('debug');
  $('room').textContent = ROOM ? T('방 {code}', { code: ROOM }) : '';
  mountSwitcher($('langBox'), { reload: true, compact: true });

  // ---------- 조정 값 (실폰 검증 전이라 바뀔 수 있습니다) ----------
  const POSE_MS = 25; // pose 전송 간격, 약 40Hz
  // 스윙 감지 값은 난이도별 표입니다(쉬움 = 살살 휘둘러도 잡힘, 어려움 = 예전 그대로).
  //   trig: 회전 속도(도/초)가 이 값을 넘으면 스윙 시작   cool: 스윙 사이 최소 간격
  //   rearDps/rearMs: 테이크백이 먼저 스윙으로 잡혀도 앞스윙이 막히지 않게, 회전이 rearDps 아래로 떨어졌으면 rearMs 만 지나도 다음 스윙을 잡습니다.
  //   full: 이 회전 속도면 회전 쪽 힘이 만점   aim: 조준 반영 비율(쉬움은 화면이 알아서 넣어 줌)
  const TH = {
    easy: { trig: 170, cool: 300, rearDps: 110, rearMs: 120, full: 800, aim: 0 },
    normal: { trig: 230, cool: 400, rearDps: 150, rearMs: 170, full: 1000, aim: 0.5 },
    hard: { trig: 320, cool: 550, rearDps: 200, rearMs: 250, full: 1300, aim: 1 }
  };
  const th = () => TH[ps.difficulty()] || TH.easy;
  const WEAK_MIN = 0.45; // 최고 회전 속도가 trig 의 이 비율은 넘었는데 trig 에 못 미치면 '더 크게!' 를 보여 줍니다
  const HINT_GAP_MS = 1500; // 힌트 사이 최소 간격
  const WINDOW_MS = 110; // 시작 뒤 값을 모으는 시간
  const PRE_MS = 70; // 위아래 판별에는 시작 직전 값도 씁니다(가속은 회전보다 먼저 붙습니다)
  const ACC_FULL = 28; // 이 가속(m/s²)이면 가속 쪽 힘이 만점
  const VERT_MIN = 0.55; // 위아래 속도 변화(m/s)가 이 이상이어야 탑스핀/슬라이스
  const VERT_RATIO = 0.4; // 그리고 수평 속도 변화의 이 비율 이상이어야 '분명히' 위아래
  const VERT_FULL = 2.2; // 위아래 속도 변화가 이 값이면 스핀 양 최대
  const HAND_MIN = 0.25; // 화면 방향의 앞뒤 성분이 이보다 작으면 스윙 방향으로 손을 가립니다
  const AIM_MAX = 30; // 조준 각도 한계(도)
  const CUE_MS = 1900; // '지금!' 표시 유지 시간
  const CAL_GUARD_MS = 250; // 자세를 맞춘 직후 흔들림은 스윙으로 보지 않습니다
  const STILL_DPS = 40; // 이보다 느리게 이 시간 동안 가만히 있으면 그 자세를 기준으로 삼습니다(준비 전에 기준이 없을 때)
  const STILL_MS = 500;
  const SENSOR_WAIT_MS = 1500; // 이 시간 안에 동작 센서 값이 없으면 버튼 모드

  const SPIN_NAME = { none: '플랫', top: '탑스핀', slice: '슬라이스' };
  const PRESETS = {
    none: { power: 0.75, spin: 'none', spinAmt: 0 },
    top: { power: 0.8, spin: 'top', spinAmt: 0.8 },
    slice: { power: 0.6, spin: 'slice', spinAmt: 0.75 }
  };

  let token = null;
  try { token = localStorage.getItem('pcg-token'); } catch (e) {}
  if (!token) {
    token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem('pcg-token', token); } catch (e) {}
  }

  const socket = io({ autoConnect: false, transports: ['websocket', 'polling'], tryAllTransports: true });
  // 끊긴 동안 보낸 이벤트는 다시 붙을 때 join 보다 먼저 흘러가 버려지므로, 끊겨 있으면 보내지 않습니다.
  function send(event, data, volatile) {
    if (!socket.connected || !me) return false;
    (volatile ? socket.volatile : socket).emit('c2d', { event, data });
    return true;
  }
  const isTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  // 큰 화면이 보내는 진동(공에 맞았을 때 확인), 난이도·슬로우 알약과 질문 카드(준비는 슬로우를 정할 때까지 막힘)
  haptics.listen(socket, { slot: () => me && me.slot });
  const ps = createPhoneSettings();
  ps.attach(socket);
  ps.mount($('setBox'));
  ps.bindReady($('btnGo'));
  let me = null;
  let state = { phase: 'lobby' };
  let roster = [];
  let mode = 'start'; // start | connecting | msg | wait | cal | count | play | idle
  let gotOri = false;
  let gotMotion = false;
  let fallback = false;
  let permDenied = false;
  let pendingCal = false;
  let basisAuto = false; // 기준축을 알아서 잡았는지(true 면 경기 시작 때 한 번 더 잡습니다)
  let noRoomTries = 0;
  let cueHand = 'fore'; // 큰 화면이 알려 준 다음 타구 손(버튼 모드에서 씀)
  let forceBack = false;
  let readySt = null; // 서버의 모두 준비 현황 { ready, players, away, need }

  function show(id) {
    for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === id);
    // 경기 중 '다시 맞추기'는 어려움에서만(실수로 누르지 않게). 나머지는 대기실에서
    $('btnRecal').classList.toggle('hidden', !(id === 'vPlay' && gotOri && !fallback && ps.difficulty() === 'hard'));
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
  function sensorHelp() {
    message('동작 센서를 쓸 수 없어요',
      'iPhone: Safari를 닫고 QR을 다시 찍어 허용해 주세요.\nAndroid: 주소창 자물쇠 → 동작 센서 허용');
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

  // deviceorientation → 세계 좌표(위 = +Y). 이 좌표에서 폰 윗부분 = (0,0,−1), 화면 바깥 = (0,1,0) 입니다(골프와 같은 변환).
  function deviceVectors(alpha, beta, gamma) {
    const q = qFromEuler(beta * RD, alpha * RD, -gamma * RD);
    return { q, top: qRot(q, [0, 0, -1]), face: qRot(q, [0, 1, 0]) };
  }
  // devicemotion 의 기기 축(x = 화면 오른쪽, y = 폰 윗부분, z = 화면 바깥) → 위 좌표: (x, y, z) → (x, z, −y)
  const devToModel = (v) => [v[0], v[2], -v[1]];

  // ---------- 기준축 ----------
  let basis = null; // { r, u, f }
  let calAt = -1e9;
  function makeBasis(top, face) {
    const u = [0, 1, 0];
    let f = [face[0], 0, face[2]];
    // 화면이 위나 아래를 보면(라켓을 눕혀 쥠) 폰 윗부분 쪽을 TV 로 봅니다.
    if (Math.hypot(f[0], f[2]) < 0.2) f = [top[0], 0, top[2]];
    f = norm(f);
    return { r: norm(cross(f, u)), u, f };
  }
  const inBasis = (b, v) => [dot(v, b.r), dot(v, b.u), dot(v, b.f)];

  // ---------- 센서 ----------
  let ori = null;
  const oriBuf = [];
  const motBuf = [];
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
    // 경기 중에만 약 40Hz 로 보냅니다(라켓이 폰을 따라 움직임).
    if (basis && state.phase === 'playing' && mode === 'play' && t >= nextPoseAt) {
      nextPoseAt = Math.max(nextPoseAt + POSE_MS, t + POSE_MS * 0.4);
      send('pose', { s: r3(inBasis(basis, ori.top)), fc: r3(inBasis(basis, ori.face)) }, true);
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
    // 스윙 세기는 회전 속도(자이로)로 잽니다. 방향 표본 차이로 재면 iPhone 에서 두 배로 튑니다.
    const rot = Math.hypot(rr.alpha || 0, rr.beta || 0, rr.gamma || 0);
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
    motBuf.push({ t, dt, rot, acc, accOk: aW != null || acc > 0, aW, face: ori ? ori.face : null });
    while (motBuf.length && motBuf[0].t < t - 600) motBuf.shift();

    const T = th();
    if (rot < T.rearDps) armed = true;
    // 가만히 있는 순간이 이어지면 그 자세를 기준으로(준비 전이라 아직 기준이 없을 때)
    if (!basis && ori) {
      if (rot < STILL_DPS) {
        if (!stillSince) stillSince = t;
        else if (t - stillSince > STILL_MS) autoBasis();
      } else stillSince = 0;
    }
    if (swingWin) return;
    const gap = t - lastTrig;
    if (rot > T.trig && (gap > T.cool || (armed && gap > T.rearMs)) && canSwing(t)) {
      lastTrig = t;
      armed = false;
      weakPeak = 0;
      swingWin = { t0: t };
      setTimeout(finishSwing, WINDOW_MS);
    } else if (mode === 'play' && state.phase === 'playing') {
      // 아무 반응이 없던 동작을 알려 줍니다: 너무 작게 휘둘렀거나, 직전 스윙 직후라 막혔을 때
      if (rot > T.trig) hint('한 번씩!', t);
      else if (rot > weakPeak) weakPeak = rot;
      else if (rot < T.rearDps * 0.6 && weakPeak > T.trig * WEAK_MIN) {
        weakPeak = 0;
        hint('더 크게!', t);
      } else if (rot < T.rearDps * 0.6) weakPeak = 0;
    }
  }
  let stillSince = 0;
  let weakPeak = 0;
  let lastHintAt = -1e9;
  // 스윙이 안 잡혔을 때 짧은 글자 + 진동 한 번(소리 없음)
  function hint(text, t) {
    const now = t || performance.now();
    if (now - lastHintAt < HINT_GAP_MS) return;
    lastHintAt = now;
    const e = $('hint');
    e.textContent = text;
    e.classList.remove('on');
    void e.offsetWidth;
    e.classList.add('on');
    haptics.tick({ noFlash: true });
  }

  // ---------- 스윙 판별 ----------
  let swingWin = null;
  let lastTrig = -1e9;
  let armed = true; // 지난 스윙 뒤 회전이 REARM_DPS 아래로 떨어진 적이 있는지
  let lastSwing = null;

  function canSwing(t) {
    if (!me) return false;
    if (mode === 'start' || mode === 'connecting' || mode === 'count') return false;
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
    // 가장 빨리 돈 순간 = 공에 맞는 순간
    let peak = post.length ? post[0] : all[all.length - 1];
    for (const m of post) if (m.rot > peak.rot) peak = m;
    const rotPeak = peak.rot;
    let accPeak = 0;
    for (const m of all) accPeak = Math.max(accPeak, m.acc);
    const hasAcc = all.some((m) => m.accOk);
    const T = th();
    const rotN = clamp01((rotPeak - T.trig) / (T.full - T.trig));
    const accN = clamp01(accPeak / ACC_FULL);
    const power = clamp(0.15 + 0.85 * (hasAcc ? 0.65 * rotN + 0.35 * accN : rotN), 0.1, 1);
    // 만점을 넘는 힘(너무 세게 휘두름): 회전 속도를 자르지 않고 잽니다. 1.25 를 넘으면 큰 화면에서 홈런(아웃)입니다.
    const raw = Math.max(power, 0.15 + 0.85 * Math.max(0, (rotPeak - T.trig) / (T.full - T.trig)));

    const b = basis || (ori ? makeBasis(ori.top, ori.face) : null);

    // 위아래·좌우 속도 변화: 세계 좌표 가속을 시작 직전부터 맞는 순간까지 더합니다.
    let vUp = 0;
    let vR = 0;
    let vF = 0;
    const tStop = Math.max(peak.t, t0 + 30);
    for (const m of all) {
      if (m.t > tStop) break;
      if (!m.aW) continue;
      vUp += m.aW[1] * m.dt;
      if (b) {
        vR += dot(m.aW, b.r) * m.dt;
        vF += dot(m.aW, b.f) * m.dt;
      }
    }
    const vH = Math.hypot(vR, vF);

    // 포핸드/백핸드와 조준: 맞는 순간 앞뒤 50ms 의 화면 방향 평균
    let face = null;
    const near = all.filter((m) => m.face && Math.abs(m.t - peak.t) <= 50);
    if (near.length) face = norm(near.reduce((a, m) => add(a, m.face), [0, 0, 0]));
    else if (ori) face = ori.face;
    let hand = 'fore';
    let aim = 0;
    if (face && b) {
      const fc = inBasis(b, face);
      if (Math.abs(fc[2]) >= HAND_MIN) hand = fc[2] >= 0 ? 'fore' : 'back';
      // 화면이 옆이나 위를 보면(애매) 라켓이 움직인 좌우 방향으로: 오른손 포핸드는 오른쪽 → 왼쪽으로 휘두릅니다.
      else hand = vR <= 0 ? 'fore' : 'back';
      const n = hand === 'fore' ? fc : scale(fc, -1);
      if (Math.hypot(n[0], n[2]) > 0.25) aim = clamp(Math.atan2(n[0], n[2]) / RD, -AIM_MAX, AIM_MAX) * T.aim;
    }
    // 주 동작은 '휘두르기' 하나입니다. 스핀은 어려움에서만 폰이 가립니다(쉬움·보통은 큰 화면이 알아서).
    const vertOk = ps.difficulty() === 'hard' && Math.abs(vUp) >= VERT_MIN && Math.abs(vUp) >= VERT_RATIO * vH;
    let spin = 'none';
    let spinAmt = 0;
    if (vertOk) {
      spin = vUp > 0 ? 'top' : 'slice';
      spinAmt = 0.3 + 0.7 * clamp01((Math.abs(vUp) - VERT_MIN) / (VERT_FULL - VERT_MIN));
    }
    const data = {
      power: round(power, 3),
      raw: round(raw, 3),
      ago: Math.max(0, Math.round(performance.now() - t0)),
      rtt: Math.round(rtt()),
      spin,
      spinAmt: round(spinAmt, 2),
      hand,
      aim: round(aim, 1)
    };
    debug(`swing ${JSON.stringify(data)}\nrot ${rotPeak.toFixed(0)} acc ${accPeak.toFixed(1)} vUp ${vUp.toFixed(2)} vH ${vH.toFixed(2)} vR ${vR.toFixed(2)} sign ${accSign} n ${all.length}`);
    // 가장 빨리 돈 순간 = 공을 맞히는 순간(연습의 타이밍 판정에 씀)
    deliverSwing(data, peak.t);
  }

  // 센서 스윙과 버튼 스윙이 같은 길로 나갑니다. hitAt = 공을 맞히는 순간(performance.now 기준)
  function deliverSwing(data, hitAt) {
    lastSwing = { data, at: performance.now() };
    swish(data.power);
    // 연습 중이면 연습이 받습니다(큰 화면으로 보내지 않음).
    if (tut.isRunning()) {
      tut.signal('swing', { ...data, hitAt: hitAt ?? performance.now() });
      return;
    }
    const live = state.phase === 'playing' && myInfo();
    if (live) send('swing', data);
    // 스윙을 잡자마자 가볍게 한 번(지연 없음). 공에 맞으면 큰 화면이 확인 진동을 한 번 더 보냅니다.
    if (mode === 'play') haptics.hit(0.25 + 0.35 * data.power);
    else haptics.tick({ noFlash: true });
    const label = swingLabel(data);
    if (mode === 'play') {
      // '지금!' 전(예고 중)에 잡힌 스윙은 테이크백일 수 있어 예고를 지우지 않습니다. 판정이 나면 result 가 지웁니다.
      if (cueStage !== 'soon') clearCue();
      const orb = $('orb');
      orb.classList.remove('hit');
      void orb.offsetWidth;
      orb.classList.add('hit');
      setChips([['감지', label]]);
    } else if (mode === 'wait') {
      $('practice').textContent = T('연습 스윙: {label}', { label });
    }
  }
  function swingLabel(d) {
    // 손·스핀은 어려움에서만 폰이 가리므로 그때만 보여 줍니다.
    const pw = T('힘 {p}%', { p: Math.round(d.power * 100) });
    return ps.difficulty() === 'hard' ? `${T(d.hand === 'back' ? '백핸드' : '포핸드')} · ${T(SPIN_NAME[d.spin] || '플랫')} · ${pw}` : pw;
  }
  function presetSwing(kind) {
    // 쉬움·보통은 스핀 버튼도 평범한 스윙으로(스핀은 어려움에서만)
    const p = PRESETS[ps.difficulty() === 'hard' ? kind : 'none'];
    if (!p) return;
    const hand = forceBack ? 'back' : cueHand === 'back' ? 'back' : 'fore';
    deliverSwing({ power: p.power, ago: 0, rtt: Math.round(rtt()), spin: p.spin, spinAmt: p.spinAmt, hand, aim: 0 }, performance.now());
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
  let sfx = null; // 실제 녹음 재생기(작은 세 개만 미리 받음: 타구 클릭·휘두름·똑딱). 못 받았으면 아래 합성음
  function audio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        actx = new AC();
        const master = actx.createGain();
        master.gain.value = 0.9;
        master.connect(actx.destination);
        sfx = createSamples(actx, master);
        sfx.preload(['ball/tennis-hit', 'swing/swoosh-light', 'ui/countdown-tick']);
        (window.__tennisPhoneSfx ||= { played: {}, fallback: {} }).has = (n) => sfx.has(n); // 시험용
      }
    }
    if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
    return actx;
  }
  // 녹음이 있으면 틀고 true, 없으면 false(→ 합성음)
  const playSample = (name, opts) => {
    const ok = Boolean(sfx && actx && actx.state === 'running' && sfx.play(name, opts));
    const c = (window.__tennisPhoneSfx ||= { played: {}, fallback: {} })[ok ? 'played' : 'fallback']; // 시험용 카운터
    c[name] = (c[name] || 0) + 1;
    return ok;
  };
  function tone(freq, dur, gain, type, glide) {
    const a = audio();
    if (!a) return;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, a.currentTime);
    if (glide) o.frequency.exponentialRampToValueAtTime(freq * glide, a.currentTime + dur);
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
  const tick = () => { if (!playSample('ui/countdown-tick', { gain: 0.6, rate: 1.2 })) tone(1700, 0.06, 0.3); };
  function pong() {
    // 라켓에 맞는 소리: 큰 화면이 진짜 타구음을 내므로 폰은 작게(녹음) — 없으면 낮고 단단한 '퐁'
    if (playSample('ball/tennis-hit', { gain: 0.35 })) return;
    tone(430, 0.1, 0.5, 'triangle', 0.7);
    noise(0.05, 1500, 1.0, 0.6);
  }
  const thud = () => tone(170, 0.2, 0.35, 'triangle');
  const swish = (power) => { if (!playSample('swing/swoosh-light', { gain: 0.35 + 0.45 * power, rate: 0.9 + 0.3 * power })) noise(0.16, 700 + 900 * power, 0.7, 0.15 + 0.3 * power); };
  // 진동 무늬(진동이 없는 iPhone·PC 는 공통 모듈이 화면 번쩍임으로 바꿈). 소리는 이 페이지가 따로 냅니다.
  const buzz = (pattern, o = {}) => haptics.buzz(pattern, { silent: true, ...o });

  // ---------- 자세 맞추기 ----------
  // 기준축은 알아서 잡습니다(준비를 누를 때, 경기가 시작될 때, 준비 전에 가만히 있을 때). 손으로 다시 맞추는 화면은 선택입니다.
  let countTimer = null;
  function openCal() {
    clearInterval(countTimer);
    mode = 'cal';
    $('calN').classList.add('hidden');
    $('btnReady').classList.remove('hidden');
    $('btnCalCancel').classList.remove('hidden');
    $('calT').textContent = '자세 맞추기';
    $('calB').textContent = '화면이 TV를 보게 쥐고 눌러요.';
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
    $('calT').textContent = '그대로 멈춰요';
    $('calB').textContent = '';
    tick();
    buzz([15], { noFlash: true });
    clearInterval(countTimer);
    countTimer = setInterval(() => {
      n -= 1;
      if (n > 0) {
        $('calN').textContent = n;
        tick();
        buzz([15], { noFlash: true });
        return;
      }
      clearInterval(countTimer);
      captureBasis();
    }, 1000);
  }
  // 최근 250ms 의 방향 평균으로 기준축을 잡습니다. 성공하면 true
  function setBasisNow(auto) {
    const t = performance.now();
    let src = oriBuf.filter((o) => o.t >= t - 250);
    if (!src.length && ori) src = [{ top: ori.top, face: ori.face }];
    if (!src.length) return false;
    const top = norm(src.reduce((a, o) => add(a, o.top), [0, 0, 0]));
    const face = norm(src.reduce((a, o) => add(a, o.face), [0, 0, 0]));
    basis = makeBasis(top, face);
    basisAuto = Boolean(auto);
    calAt = t;
    nextPoseAt = 0;
    // 큰 화면은 이 신호로 라켓 자세 기준을 새로 잡습니다. 이 뒤의 pose 는 새 기준축 값입니다.
    if (!send('calibrate', {})) pendingCal = true;
    debug(`calibrate${auto ? ' (auto)' : ''} f=${basis.f.map((x) => x.toFixed(2))} top=${top.map((x) => x.toFixed(2))} face=${face.map((x) => x.toFixed(2))}`);
    return true;
  }
  // 알아서 잡기(소리·진동 없음). 직접 맞춘 기준축은 준비 때 덮어쓰지 않습니다.
  function autoBasis(force) {
    if (!gotOri || fallback || !ori) return;
    if (basis && !basisAuto && !force) return;
    setBasisNow(true);
  }
  function captureBasis() {
    if (!setBasisNow(false)) {
      openCal();
      $('calB').textContent = '센서 값이 끊겼어요. 다시 눌러요.';
      return;
    }
    buzz([30, 40, 30]);
    tone(1320, 0.12, 0.35);
    mode = 'idle';
    render();
  }

  // ---------- 화면 상태 ----------
  function myInfo() {
    if (!me || !state || !state.players) return null;
    return state.players[me.slot] || state.players[String(me.slot)] || null;
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
  function teamLabel(info) {
    const meT = T('나');
    return info && info.mates && info.mates.length ? `${meT}·${info.mates.join('·')}` : meT;
  }
  function drawScore(info) {
    if (!info) return;
    const pts = Array.isArray(info.points) ? info.points : ['0', '0'];
    const gms = Array.isArray(info.games) ? info.games : [0, 0];
    $('ptMe').textContent = pts[0];
    $('ptOpp').textContent = pts[1];
    $('gmMe').textContent = gms[0];
    $('gmOpp').textContent = gms[1];
    $('meName').textContent = teamLabel(info);
    $('oppName').textContent = info.opps && info.opps.length ? info.opps.join('·') : '상대';
    $('srvMe').classList.toggle('on', Boolean(info.teamServing));
    $('srvOpp').classList.toggle('on', info.teamServing === false);
    $('callL').textContent = T(info.call || (info.serving && info.serveNo === 2 ? '세컨드 서브' : ''));
    const lv = { easy: '쉬움', normal: '보통', hard: '어려움' }[ps.difficulty()] || '';
    $('ruleL').textContent = `${T('{n}게임 선승', { n: state.toWin || 2 })}${lv ? ` · ${T(lv)}` : ''}`;
  }

  let cueOn = false;
  let cueStage = null; // 'soon'(예고) | 'now'('지금!') | null
  let cueTimer = null;
  function idleOrb() {
    if (cueOn) return;
    const info = myInfo();
    const orb = $('orb');
    orb.classList.remove('cue');
    orb.textContent = info && info.serving ? '내 서브' : '준비';
    $('status').textContent = '';
  }
  function clearCue() {
    clearTimeout(cueTimer);
    cueOn = false;
    cueStage = null;
    idleOrb();
  }
  function showPlay() {
    mode = 'play';
    paintPads();
    idleOrb();
    show('vPlay');
  }
  const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const SLOT_COLOR = { 1: '#ff5a5f', 2: '#3ab4ff', 3: '#ffc93c', 4: '#5ee07a' };
  const iAmReady = () => Boolean(me && readySt && Array.isArray(readySt.ready) && readySt.ready.includes(me.slot));
  function showWait(info) {
    mode = 'wait';
    const phase = state.phase;
    const chips = [];
    if (info) {
      chips.push([info.mates && info.mates.length ? '복식' : '단식', info.mates && info.mates.length ? teamLabel(info) : '']);
      chips.push(['상대', info.opps ? info.opps.join('·') : 'CPU']);
    }
    if (fallback) chips.push(['조작', '버튼']);
    const btn = $('btnGo');
    btn.style.display = '';
    const ready = iAmReady();
    // 준비 버튼: 누르면 '준비 완료 ✓'(다른 사람을 기다림). 서버가 모두 준비되면 큰 화면에 한 번만 시작을 넘깁니다.
    const label = phase === 'over' ? '다시 하기' : '준비';
    btn.classList.toggle('done', ready);
    if (ready) btn.innerHTML = `<i>${CHECK_SVG}</i>${T(phase === 'over' ? '다시 하기 · 준비 완료' : '준비 완료')}`;
    else btn.textContent = label;
    if (phase === 'over') {
      const g = info && Array.isArray(info.games) ? info.games : null;
      $('waitT').textContent = info && info.win ? '승리!' : info && info.win === false ? '패배' : '경기 끝';
      $('waitB').textContent = g ? T('게임 {a} : {b}', { a: g[0], b: g[1] }) : '';
    } else if (phase === 'playing') {
      $('waitT').textContent = '관전 중';
      $('waitB').textContent = '다음 서브부터 합류해요';
      btn.style.display = 'none';
    } else {
      $('waitT').textContent = '대기실';
      $('waitB').textContent = '모두 준비를 누르면 시작해요';
    }
    paintWho(phase !== 'playing');
    setChips(chips, 'waitChips');
    const canCal = gotOri && !fallback;
    $('btnCalLobby').classList.toggle('hidden', !canCal);
    const p = $('practice');
    const recent = lastSwing && performance.now() - lastSwing.at < 4000;
    if (!recent) p.textContent = '';
    show('vWait');
  }
  // 누가 아직 준비 전인지(내 폰에도 보여 줌)
  function paintWho(on) {
    const box = $('whoWait');
    const st = readySt;
    if (!on || !st || !Array.isArray(st.players) || st.players.length < 1 || !me) { box.textContent = ''; return; }
    const waiting = st.players.filter((sl) => !st.ready.includes(sl));
    if (!waiting.length) { box.textContent = '모두 준비! 곧 시작해요'; return; }
    if (st.players.length < 2) { box.textContent = ''; return; }
    const away = st.away || [];
    box.innerHTML = `<span>${iAmReady() ? '기다리는 중' : '준비 현황'}</span>` + st.players.map((sl) =>
      `<b class="${st.ready.includes(sl) ? 'on' : ''}${away.includes(sl) ? ' away' : ''}" style="--pc:${SLOT_COLOR[sl] || '#fff'}">${sl}P${st.ready.includes(sl) ? ' ✓' : ''}</b>`).join('');
  }
  function render() {
    if (!me) return;
    if (mode === 'start' || mode === 'connecting' || mode === 'msg') return;
    const info = myInfo();
    drawScore(info);
    if (mode === 'cal' || mode === 'count') return;
    if (state.phase === 'playing' && info) {
      if (mode !== 'play') showPlay();
      else idleOrb();
      return;
    }
    showWait(info);
  }
  // 큰 '치기' 버튼은 센서가 있어도 늘 쓸 수 있습니다. 스핀 버튼과 손 고르기는 어려움에서만 나옵니다.
  function paintPads() {
    const hard = ps.difficulty() === 'hard';
    $('spinPads').classList.toggle('hidden', !hard);
    $('hands').classList.toggle('hidden', !hard);
    $('fallbackHint').textContent = fallbackReason();
    $('fallbackHint').classList.toggle('hidden', !fallback);
  }
  function fallbackReason() {
    if (!fallback) return '';
    if (!window.isSecureContext) return '센서가 꺼져 있어요. 버튼으로 쳐요.';
    if (permDenied) return '동작 허용이 거절됐어요. 버튼으로 쳐요.';
    return '센서가 없어요. 버튼으로 쳐요.';
  }
  function sensorsChanged() {
    if (mode === 'play') paintPads();
    render();
  }

  // ---------- 소켓 ----------
  const join = () => socket.emit('join', { role: 'controller', room: ROOM, token });
  socket.on('connect', () => {
    measureRtt();
    banner('');
    join();
  });
  socket.on('disconnect', () => {
    if (me) banner('서버 연결이 끊겼습니다. 다시 잇는 중…');
  });
  socket.on('assigned', (p) => {
    if (!p || p.game !== 'tennis') {
      const code = encodeURIComponent((p && p.code) || ROOM);
      const game = p && p.game;
      location.replace(`${game === 'baseball' || !game ? '/play/' : `/play/${game}/`}?room=${code}`);
      return;
    }
    me = p;
    noRoomTries = 0;
    document.documentElement.style.setProperty('--c', p.color);
    $('me').textContent = p.name;
    if (pendingCal) {
      pendingCal = false;
      send('calibrate', {});
    }
    if (mode === 'connecting' || mode === 'msg') mode = 'idle';
    render();
  });
  socket.on('players', (payload) => {
    roster = payload && Array.isArray(payload.players) ? payload.players : [];
    if (mode === 'wait') render();
  });
  socket.on('display_status', ({ connected } = {}) => {
    banner(connected ? '' : '큰 화면이 꺼져 있습니다. 다시 열리면 이어서 합니다.');
  });
  socket.on('no_room', () => {
    // 서버가 막 다시 떴으면 큰 화면이 같은 코드로 방을 다시 만들 때까지 잠깐 기다립니다.
    if (noRoomTries++ < 15) {
      message('방에 다시 연결하는 중', '잠시만 기다려 주십시오.');
      setTimeout(() => socket.connected && join(), 2000);
      return;
    }
    message('방을 찾을 수 없습니다', '큰 화면의 QR을 다시 찍어 주십시오.');
  });
  socket.on('room_full', () => message('4명이 꽉 찼습니다', '빈자리가 생기면 다시 찍어 주십시오.'));
  socket.on('replaced', () => message('다른 탭에서 열었습니다', '마지막으로 연 화면에서 조작합니다.'));
  socket.on('room_closed', () => message('방이 닫혔습니다', '큰 화면의 새 QR을 찍어 주십시오.'));

  socket.on('ready_state', (st) => {
    readySt = st && typeof st === 'object' ? st : null;
    if (mode === 'wait') render();
  });
  socket.on('game_state', (s) => {
    const prev = state.phase;
    state = s && typeof s === 'object' ? s : { phase: 'lobby' };
    // 내가 들어간 경기가 시작됐는데 연습 중이면(드묾) 연습을 닫습니다.
    if (state.phase === 'playing' && myInfo() && tut.isRunning()) tut.cancel();
    if (state.phase === 'playing' && prev !== 'playing') {
      // 경기가 시작되는 지금 쥔 자세를 기준으로(직접 맞춘 기준축은 그대로 둡니다)
      if (!basis || basisAuto) autoBasis(true);
      $('resT').textContent = '';
      $('resT').className = 't';
      setChips([]);
      cueOn = false;
      cueStage = null;
      clearTimeout(cueTimer);
    }
    render();
  });

  socket.on('cue', (c) => {
    c = c || {};
    if (c.hand === 'fore' || c.hand === 'back') cueHand = c.hand;
    if (c.kind === 'serve') cueHand = 'fore';
    const orb = $('orb');
    if (c.stage === 'ready') {
      // 서브 차례 예고(아직 '지금'은 아님)
      if (!cueOn) {
        orb.textContent = c.second ? '세컨드 서브' : '내 서브';
      }
      buzz([20, 50, 20], { noFlash: true });
      return;
    }
    cueOn = true;
    clearTimeout(cueTimer);
    if (c.stage === 'soon') {
      // 슬로우가 걸린 순간의 예고입니다. 타점은 아직 약 1.2초 뒤라 휘두르라고 하지 않습니다.
      // '지금!'(stage 'now')이 오지 않고 끝나면 result 가 지우고, 그것도 없으면 시간이 지나 지웁니다.
      cueStage = 'soon';
      cueTimer = setTimeout(clearCue, CUE_MS + 1500);
      orb.classList.remove('cue');
      orb.textContent = c.kind === 'serve' ? '준비' : '공이 옵니다';
      buzz([15], { noFlash: true });
      return;
    }
    // stage 'now'(또는 stage 없는 예전 화면): 큰 화면이 타점 직전에 맞춰 보냅니다.
    cueStage = 'now';
    cueTimer = setTimeout(clearCue, CUE_MS);
    orb.textContent = '지금!';
    orb.classList.add('cue');
    buzz(c.kind === 'serve' ? [25, 40, 25] : 45);
    tick();
  });

  // 큰 화면이 보낸 판정 글(한국어)을 내 언어로: ' · ' 로 나눈 조각마다 사전에서 찾고, 끝의 점수(15-0, 2 : 1)는 그대로 둡니다.
  function trResult(text) {
    return String(text).split(' · ').map((seg) => {
      const m = /^(.*\S)\s+((?:\d+|AD)-(?:\d+|AD)|\d+ : \d+)$/.exec(seg);
      return m ? `${T(m[1])} ${m[2]}` : T(seg);
    }).join(' · ');
  }
  socket.on('result', (r) => {
    r = r || {};
    clearCue();
    const t = $('resT');
    t.textContent = trResult(r.text || '');
    t.className = `t ${r.good ? 'good' : 'bad'}`;
    const chips = [];
    if (r.kmh) chips.push(['속도', `${r.kmh}km/h`]);
    if (lastSwing && performance.now() - lastSwing.at < 1500) chips.push(['감지', swingLabel(lastSwing.data)]);
    setChips(chips);
    if (r.good) {
      // 잘 맞으면 '퐁'. 손에 오는 진동은 큰 화면이 haptic 으로 따로 보냅니다(맞힌 순간 확인).
      pong();
    } else {
      thud();
    }
  });

  // ---------- 연습(튜토리얼) ----------
  // 저절로 시작하지 않습니다. 대기실의 '튜토리얼 다시 하기' 링크를 눌렀을 때만 2단계(한 줄씩).
  // 판정은 경기와 같은 스윙 감지기(finishSwing)의 값으로 합니다. 단계 안의 '치기' 버튼으로도 할 수 있습니다.
  const TUT_PAD_LABEL = { now: '치기' };
  function tutSwing() {
    audio();
    deliverSwing({ power: 0.75, ago: 0, rtt: Math.round(rtt()), spin: 'none', spinAmt: 0, hand: 'fore', aim: 0 }, performance.now());
  }
  // 단계 안에 큰 '치기' 버튼을 붙입니다(센서가 있어도 쓸 수 있음).
  function tutPads(stage) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="tut-pads"><button type="button" data-k="now">${TUT_PAD_LABEL.now}</button></div>`;
    wrap.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('button[data-k]');
      if (!b) return;
      e.preventDefault();
      tutSwing();
    });
    stage.appendChild(wrap);
    return () => wrap.remove();
  }
  // 타이밍 연습: 원이 공으로 닫히는 순간(큰 화면의 링과 같음) 휘두릅니다. 허용 폭은 난이도를 따릅니다.
  const RING = { cycle: 1900, close: 1350, t0: 0 };
  const tutTol = () => ps.pick({ easy: 450, normal: 300, hard: 150 });
  function nearestClose(t) {
    const k = Math.round((t - RING.t0 - RING.close) / RING.cycle);
    return RING.t0 + RING.close + k * RING.cycle;
  }
  function timingStage(stage) {
    const box = document.createElement('div');
    box.innerHTML = `<div class="tut-ring"><svg viewBox="-100 -100 200 200" aria-hidden="true">` +
      `<circle class="halo" r="78"/><circle class="ring" r="78"/>` +
      `<g><circle r="17" fill="#d9f24a"/><path d="M-12 -11c7 4 9 13 5 22M12 -11c-7 4-9 13-5 22" fill="none" stroke="#f7ffd0" stroke-width="2.4" stroke-linecap="round"/></g>` +
      `</svg><div class="mark"></div><div class="tag">기다려요</div></div>`;
    stage.appendChild(box);
    const pads = tutPads(stage);
    const ring = box.querySelector('.ring');
    const tag = box.querySelector('.tag');
    RING.t0 = performance.now();
    let raf = 0;
    let lastTick = -1;
    const loop = () => {
      const t = performance.now() - RING.t0;
      const u = t % RING.cycle;
      const k = Math.floor(t / RING.cycle);
      // 열린 원(78) → 공 크기(21)로 일정하게 닫히고(큰 화면 링과 같음), 닫힌 뒤 잠깐 머물렀다 다시 열립니다.
      const r = u <= RING.close ? 78 - 57 * (u / RING.close) : 21 + (57 * Math.max(0, u - RING.close - 260)) / (RING.cycle - RING.close - 260);
      ring.setAttribute('r', Math.max(21, Math.min(78, r)).toFixed(1));
      const now = Math.abs(u - RING.close) < 170;
      ring.classList.toggle('close', now);
      tag.classList.toggle('now', now);
      const tagText = T(now ? '지금!' : u < RING.close ? '기다려요' : '한 번 더');
      if (tag.textContent !== tagText) tag.textContent = tagText;
      if (now && lastTick !== k) {
        lastTick = k;
        tick();
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      if (pads) pads();
      box.remove();
    };
  }
  function ringMark(text, good) {
    const m = document.querySelector('.tut-ring .mark');
    if (!m) return;
    m.textContent = text;
    m.className = `mark ${good ? 'good' : 'bad'}`;
    void m.offsetWidth;
    m.classList.add('on');
  }
  function timingCheck(d) {
    const t = Number(d && d.hitAt) || performance.now();
    const off = t - nearestClose(t);
    if (Math.abs(off) <= tutTol()) {
      ringMark(Math.abs(off) < tutTol() * 0.4 ? 'PERFECT' : 'GOOD', true);
      return true;
    }
    ringMark(T(off < 0 ? '빨라요' : '늦어요'), false);
    return off < 0 ? '조금 일러요' : '조금 늦어요';
  }
  const tut = createTutorial({
    key: 'tennis',
    socket,
    title: '처음이라 연습해 봐요',
    steps: [
      { title: '아무 쪽으로나 휘둘러요', waitFor: 'swing', hint: '휘둘러요', check: () => true, render: tutPads },
      { title: '링이 닫힐 때 휘둘러요', waitFor: 'swing', count: 2, hint: '링이 닫힐 때 두 번', okText: '타이밍 좋아요!', check: timingCheck, render: timingStage }
    ]
  });
  function beginTutorial() {
    if (tut.isRunning() || mode === 'cal' || mode === 'count') return;
    if (state.phase === 'playing' && myInfo()) return;
    runTutorial();
  }
  async function runTutorial() {
    haptics.unlock();
    render();
    await tut.run();
    render();
  }
  tut.link($('tutLink'), { before: () => { beginTutorial(); return false; } });

  // ---------- 버튼 ----------
  $('btnStart').addEventListener('click', async () => {
    if (mode !== 'start') return;
    mode = 'connecting';
    $('btnStart').disabled = true;
    // 화면 꺼짐 방지와 권한 요청은 탭 안에서 await 전에 바로 불러야 iPhone 에서 통합니다.
    if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
    audio();
    // 동작 권한은 한 번에(motion.js). 센서 없는 PC 는 거절이 아니라 '지원 안 함'이라 버튼으로 계속합니다.
    permDenied = (await requestMotionPermission()) === 'denied';
    window.addEventListener('deviceorientation', onOrientation);
    window.addEventListener('devicemotion', onMotion);
    // 폰에서 거절되면 켜는 법을 안내합니다. 센서 없는 PC 는 버튼으로 계속합니다.
    // https 가 아니면 iPhone 은 묻지도 않고 거절합니다. 안내로는 풀 수 없으니 그대로 들어가 버튼 모드로 칩니다.
    if (permDenied && isTouch && !DEBUG && window.isSecureContext) {
      sensorHelp();
      return;
    }
    if (!ROOM) {
      message('방 코드가 없습니다', '큰 화면의 QR을 찍어 주십시오.');
      return;
    }
    $('msgT').textContent = '들어가는 중…';
    $('msgB').textContent = '큰 화면과 연결하고 있습니다.';
    show('vMsg');
    socket.connect();
    setTimeout(() => {
      if (gotMotion && !DEBUG) return;
      if (isTouch && !DEBUG && !gotMotion) {
        // 폰인데 값이 안 들어오면 켜는 법을 보여 주되, 버튼으로도 칠 수 있게 합니다(Android 는 권한 창 없이 사이트 설정에서 막힘).
        banner('센서가 없어 버튼으로 쳐요');
      }
      fallback = true;
      debug('동작 센서 값이 들어오지 않아 버튼으로 칩니다');
      sensorsChanged();
    }, SENSOR_WAIT_MS);
  });
  // 준비(다시 하기): 한 번 누르면 '준비 완료 ✓'.
  $('btnGo').addEventListener('click', () => {
    audio();
    if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
    if (iAmReady()) {
      $('whoWait').animate([{ transform: 'scale(1.06)' }, { transform: 'none' }], { duration: 260 });
      return;
    }
    // 준비를 누르는 순간의 자세를 기준으로 잡아 둡니다(경기가 시작될 때 한 번 더 잡음)
    autoBasis();
    if (send('start_game', {})) haptics.tick();
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
  // 버튼 스윙은 손을 뗄 때가 아니라 누르는 순간 보냅니다(타이밍).
  $('btnHit').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    audio();
    presetSwing('none');
  });
  for (const btn of document.querySelectorAll('#spinPads button')) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      audio();
      presetSwing(btn.dataset.kind);
    });
  }
  for (const btn of document.querySelectorAll('#hands button')) {
    btn.addEventListener('click', () => {
      forceBack = btn.dataset.hand === 'back';
      for (const b of document.querySelectorAll('#hands button')) b.classList.toggle('on', b === btn);
    });
  }
  document.addEventListener('keydown', (e) => {
    // 연습 중: Space 치기
    if (tut.isRunning() && !e.repeat) {
      if (e.code === 'Space') {
        e.preventDefault();
        tutSwing();
      }
      return;
    }
    if (mode !== 'play' || e.repeat) return;
    const k = e.code === 'Space' ? 'none' : e.code === 'KeyT' ? 'top' : e.code === 'KeyS' ? 'slice' : null;
    if (!k) return;
    e.preventDefault();
    audio();
    presetSwing(k);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && mode !== 'start' && navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
  });

  if (!window.isSecureContext) $('httpNote').classList.remove('hidden');
  paintPads();

  // ---------- 디버그 (&debug) ----------
  function debug(t) {
    if (DEBUG) $('debug').textContent = t;
  }
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
  window.__tennisPad = {
    get state() { return state; }, get mode() { return mode; }, presetSwing, get fallback() { return fallback; },
    tut, ps, haptics, tutSwing, beginTutorial, deliverSwing, get ready() { return iAmReady(); }, get readyState() { return readySt; }
  };
})();
