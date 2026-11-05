// 테니스 컨트롤러. 폰이 라켓입니다.
// 폰 방향(pose)을 경기 중에 큰 화면으로 흘려보내고(라켓이 폰을 따라 움직임), 스윙은 폰에서 직접 잡아 swing 으로 보냅니다.
// 좌표는 '준비' 때 정한 기준축으로 보냅니다: r = 내 오른쪽, u = 위, f = 화면이 TV 를 보던 방향.
// 스윙 판별: 회전 속도(rotationRate) 최고값 = 세기, 세계 좌표 가속의 위아래 성분 = 탑스핀(위)/슬라이스(아래),
// 맞는 순간 화면이 TV 쪽이면 포핸드, 반대면 백핸드.
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
  const TRIGGER_DPS = 320; // 회전 속도(도/초)가 이 값을 넘으면 스윙 시작
  const COOLDOWN_MS = 550; // 스윙 사이 최소 간격
  // 테이크백이 먼저 스윙으로 잡혀도 앞스윙이 막히지 않게: 그 사이 회전이 이 아래로 떨어졌으면(라켓이 멈칫)
  // REARM_MS 만 지나도 다음 스윙을 잡습니다. 큰 화면은 창보다 이른 스윙을 판정하지 않고 더 늦은 스윙으로 바꿉니다.
  const REARM_DPS = 200;
  const REARM_MS = 250;
  const WINDOW_MS = 110; // 시작 뒤 값을 모으는 시간
  const PRE_MS = 70; // 위아래 판별에는 시작 직전 값도 씁니다(가속은 회전보다 먼저 붙습니다)
  const ROT_FULL_DPS = 1300; // 이 회전 속도면 회전 쪽 힘이 만점
  const ACC_FULL = 28; // 이 가속(m/s²)이면 가속 쪽 힘이 만점
  const VERT_MIN = 0.55; // 위아래 속도 변화(m/s)가 이 이상이어야 탑스핀/슬라이스
  const VERT_RATIO = 0.4; // 그리고 수평 속도 변화의 이 비율 이상이어야 '분명히' 위아래
  const VERT_FULL = 2.2; // 위아래 속도 변화가 이 값이면 스핀 양 최대
  const HAND_MIN = 0.25; // 화면 방향의 앞뒤 성분이 이보다 작으면 스윙 방향으로 손을 가립니다
  const AIM_MAX = 30; // 조준 각도 한계(도)
  const CUE_MS = 1900; // '지금!' 표시 유지 시간
  const CAL_GUARD_MS = 400; // 자세를 맞춘 직후 흔들림은 스윙으로 보지 않습니다
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
  let cueHand = 'fore'; // 큰 화면이 알려 준 다음 타구 손(버튼 모드에서 씀)
  let forceBack = false;

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
  function sensorHelp() {
    message('동작 센서를 쓸 수 없어요',
      'iPhone: Safari 를 앱 전환기에서 완전히 닫고 QR을 다시 찍은 뒤, 동작 접근을 허용해 주세요.\nAndroid: 주소창 자물쇠 → 사이트 설정 → 동작 센서를 허용해 주세요.');
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

    if (rot < REARM_DPS) armed = true;
    if (swingWin) return;
    const gap = t - lastTrig;
    if (rot > TRIGGER_DPS && (gap > COOLDOWN_MS || (armed && gap > REARM_MS)) && canSwing(t)) {
      lastTrig = t;
      armed = false;
      swingWin = { t0: t };
      setTimeout(finishSwing, WINDOW_MS);
    }
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
    const rotN = clamp01((rotPeak - TRIGGER_DPS) / (ROT_FULL_DPS - TRIGGER_DPS));
    const accN = clamp01(accPeak / ACC_FULL);
    const power = clamp(0.15 + 0.85 * (hasAcc ? 0.65 * rotN + 0.35 * accN : rotN), 0.1, 1);
    // 만점을 넘는 힘(너무 세게 휘두름): 회전 속도를 자르지 않고 잽니다. 1.25 를 넘으면 큰 화면에서 홈런(아웃)입니다.
    const raw = Math.max(power, 0.15 + 0.85 * Math.max(0, (rotPeak - TRIGGER_DPS) / (ROT_FULL_DPS - TRIGGER_DPS)));

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
      if (Math.hypot(n[0], n[2]) > 0.25) aim = clamp(Math.atan2(n[0], n[2]) / RD, -AIM_MAX, AIM_MAX);
    }
    const vertOk = Math.abs(vUp) >= VERT_MIN && Math.abs(vUp) >= VERT_RATIO * vH;
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
    deliverSwing(data);
  }

  // 센서 스윙과 버튼 스윙이 같은 길로 나갑니다.
  function deliverSwing(data) {
    const live = state.phase === 'playing' && myInfo();
    if (live) send('swing', data);
    lastSwing = { data, at: performance.now() };
    swish(data.power);
    if (navigator.vibrate) {
      try { navigator.vibrate(12); } catch (e) {}
    }
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
      $('practice').textContent = `연습 스윙: ${label}`;
    }
  }
  function swingLabel(d) {
    return `${d.hand === 'back' ? '백핸드' : '포핸드'} · ${SPIN_NAME[d.spin] || '플랫'} · 힘 ${Math.round(d.power * 100)}%`;
  }
  function presetSwing(kind) {
    const p = PRESETS[kind];
    if (!p) return;
    const hand = forceBack ? 'back' : cueHand === 'back' ? 'back' : 'fore';
    deliverSwing({ power: p.power, ago: 0, rtt: Math.round(rtt()), spin: p.spin, spinAmt: p.spinAmt, hand, aim: 0 });
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
  const tick = () => tone(1700, 0.06, 0.3);
  function pong() {
    // 라켓에 맞는 소리: 낮고 단단한 '퐁'
    tone(430, 0.1, 0.5, 'triangle', 0.7);
    noise(0.05, 1500, 1.0, 0.6);
  }
  const thud = () => tone(170, 0.2, 0.35, 'triangle');
  const swish = (power) => noise(0.16, 700 + 900 * power, 0.7, 0.15 + 0.3 * power);
  function buzz(pattern) {
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (e) {}
    }
    // iPhone 은 진동이 없어 화면을 번쩍입니다.
    const f = $('flash');
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }

  // ---------- 자세 맞추기 ----------
  let countTimer = null;
  function openCal() {
    clearInterval(countTimer);
    mode = 'cal';
    $('calN').classList.add('hidden');
    $('calLegend').classList.remove('hidden');
    $('btnReady').classList.remove('hidden');
    $('btnCalCancel').classList.toggle('hidden', !(basis || state.phase !== 'playing' || !myInfo()));
    $('calT').textContent = basis ? '다시 맞춥니다' : '라켓처럼 쥡니다';
    $('calB').textContent = '폰 아래쪽을 라켓 손잡이처럼 쥐고,\n화면이 TV를 보게 한 뒤 준비를 누릅니다.';
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
    $('calB').textContent = '라켓을 쥔 자세 그대로, 화면이 TV를 보게 둡니다.';
    tick();
    if (navigator.vibrate) navigator.vibrate(15);
    clearInterval(countTimer);
    countTimer = setInterval(() => {
      n -= 1;
      if (n > 0) {
        $('calN').textContent = n;
        tick();
        if (navigator.vibrate) navigator.vibrate(15);
        return;
      }
      clearInterval(countTimer);
      captureBasis();
    }, 1000);
  }
  function captureBasis() {
    const t = performance.now();
    let src = oriBuf.filter((o) => o.t >= t - 250);
    if (!src.length && ori) src = [ori];
    if (!src.length) {
      openCal();
      $('calB').textContent = '방향 센서 값이 끊겼습니다.\n다시 준비를 눌러 주십시오.';
      return;
    }
    const top = norm(src.reduce((a, o) => add(a, o.top), [0, 0, 0]));
    const face = norm(src.reduce((a, o) => add(a, o.face), [0, 0, 0]));
    basis = makeBasis(top, face);
    calAt = t;
    nextPoseAt = 0;
    // 큰 화면은 이 신호로 라켓 자세 기준을 새로 잡습니다. 이 뒤의 pose 는 새 기준축 값입니다.
    if (!send('calibrate', {})) pendingCal = true;
    buzz([30, 40, 30]);
    tone(1320, 0.12, 0.35);
    mode = 'idle';
    debug(`calibrate f=${basis.f.map((x) => x.toFixed(2))} top=${top.map((x) => x.toFixed(2))} face=${face.map((x) => x.toFixed(2))}`);
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
    const mates = info && info.mates && info.mates.length ? `나·${info.mates.join('·')}` : '나';
    return mates;
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
    $('callL').textContent = info.call || (info.serving && info.serveNo === 2 ? '세컨드 서브' : '');
    $('ruleL').textContent = `${state.toWin || 2}게임 선승`;
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
    $('status').textContent = info && info.serving
      ? '토스한 공이 내려오며 링이 닫힐 때 휘두릅니다.'
      : '공이 느려지면 링이 닫히는 순간 휘두릅니다.';
  }
  function clearCue() {
    clearTimeout(cueTimer);
    cueOn = false;
    cueStage = null;
    idleOrb();
  }
  function showPlay() {
    mode = 'play';
    $('fallback').classList.toggle('hidden', !fallback);
    $('fallbackHint').textContent = fallbackReason();
    idleOrb();
    show('vPlay');
  }
  function showWait(info) {
    mode = 'wait';
    const phase = state.phase;
    const chips = [];
    if (info) {
      chips.push([info.mates && info.mates.length ? '복식' : '단식', info.mates && info.mates.length ? `나·${info.mates.join('·')}` : '']);
      chips.push(['상대', info.opps ? info.opps.join('·') : 'CPU']);
    }
    if (fallback) chips.push(['조작', '버튼']);
    else if (gotOri) chips.push(['라켓 자세', basis ? '맞춤' : '아직', basis ? 'ok' : '']);
    $('btnGo').style.display = '';
    if (phase === 'over') {
      const g = info && Array.isArray(info.games) ? info.games : null;
      $('waitT').textContent = info && info.win ? '승리!' : info && info.win === false ? '패배' : '경기 끝';
      $('waitB').textContent = g ? `게임 ${g[0]} : ${g[1]}\n큰 화면에서 결과를 확인합니다.` : '큰 화면에서 결과를 확인합니다.';
      $('btnGo').textContent = '다시 하기';
    } else if (phase === 'playing') {
      $('waitT').textContent = '관전 중';
      $('waitB').textContent = '지금 경기가 끝나면 함께할 수 있습니다.';
      $('btnGo').style.display = 'none';
    } else {
      $('waitT').textContent = '대기실';
      $('waitB').textContent = basis || fallback || !gotOri
        ? '모두 들어오면 게임 시작을 누릅니다.'
        : '모두 들어오면 게임 시작을 누릅니다.\n먼저 라켓 자세를 맞춰 두면 바로 칠 수 있습니다.';
      $('btnGo').textContent = '게임 시작';
    }
    setChips(chips, 'waitChips');
    const canCal = gotOri && !fallback;
    $('btnCalLobby').classList.toggle('hidden', !canCal);
    $('btnCalLobby').textContent = basis ? '라켓 자세 다시 맞추기' : '라켓 자세 맞추기';
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
    if (mode === 'cal' || mode === 'count') return;
    if (state.phase === 'playing' && info) {
      if (!basis && gotOri && !fallback) {
        openCal();
        return;
      }
      if (mode !== 'play') showPlay();
      else idleOrb();
      return;
    }
    showWait(info);
  }
  function fallbackReason() {
    let why = '동작 센서가 없어 버튼으로 칩니다.';
    if (!window.isSecureContext) why = 'https 주소가 아니라 동작 센서가 꺼져 있습니다. 버튼으로 칩니다.';
    else if (permDenied) why = '동작 권한이 거절돼 버튼으로 칩니다.';
    return `${why} (키보드: Space · T · S)`;
  }
  function sensorsChanged() {
    if (mode === 'play') $('fallback').classList.toggle('hidden', !fallback);
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

  socket.on('game_state', (s) => {
    const prev = state.phase;
    state = s && typeof s === 'object' ? s : { phase: 'lobby' };
    if (state.phase === 'playing' && prev !== 'playing') {
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
        $('status').textContent = '토스가 올라갑니다. 공이 내려오며 링이 닫힐 때 휘두릅니다.';
      }
      if (navigator.vibrate) navigator.vibrate([20, 50, 20]);
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
      $('status').textContent = c.kind === 'serve' ? '공이 내려옵니다. 지금! 이 뜨면 휘두릅니다.'
        : `${c.hand === 'back' ? '백핸드' : '포핸드'}로 준비합니다. 지금! 이 뜨면 휘두릅니다.`;
      if (navigator.vibrate) {
        try { navigator.vibrate(15); } catch (e) {}
      }
      return;
    }
    // stage 'now'(또는 stage 없는 예전 화면): 큰 화면이 타점 직전에 맞춰 보냅니다.
    cueStage = 'now';
    cueTimer = setTimeout(clearCue, CUE_MS);
    orb.textContent = '지금!';
    orb.classList.add('cue');
    $('status').textContent = c.kind === 'serve' ? '서브! 공이 내려올 때 휘두릅니다.'
      : `공이 옵니다! ${c.hand === 'back' ? '백핸드' : '포핸드'}로 링이 닫힐 때 휘두릅니다.`;
    buzz(c.kind === 'serve' ? [25, 40, 25] : 45);
    tick();
  });

  socket.on('result', (r) => {
    r = r || {};
    clearCue();
    const t = $('resT');
    t.textContent = r.text || '';
    t.className = `t ${r.good ? 'good' : 'bad'}`;
    const chips = [];
    if (r.kmh) chips.push(['속도', `${r.kmh}km/h`]);
    if (lastSwing && performance.now() - lastSwing.at < 1500) chips.push(['감지', swingLabel(lastSwing.data)]);
    setChips(chips);
    if (r.good) {
      // 잘 맞으면 '퐁' 하고 손에 묵직하게 울립니다.
      buzz([35, 30, 80]);
      pong();
    } else {
      thud();
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
        banner(window.isSecureContext
          ? '동작 센서 값이 없어 버튼으로 칩니다. Android: 주소창 자물쇠 → 사이트 설정 → 동작 센서 허용 / iPhone: Safari 를 완전히 닫고 다시 찍어 동작 접근 허용'
          : '동작 센서 값이 들어오지 않습니다. 버튼으로 칩니다.');
      }
      fallback = true;
      debug('동작 센서 값이 들어오지 않아 버튼으로 칩니다');
      sensorsChanged();
    }, SENSOR_WAIT_MS);
  });
  $('btnGo').addEventListener('click', () => {
    audio();
    if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
    send('start_game', {});
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
  for (const btn of document.querySelectorAll('#fallback .pads button')) {
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
    if (!fallback || mode !== 'play' || e.repeat) return;
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
  window.__tennisPad = { get state() { return state; }, get mode() { return mode; }, presetSwing, get fallback() { return fallback; } };
})();
