// 탁구 컨트롤러. 폰이 탁구채입니다.
// 폰 방향(pose)을 계속 큰 화면으로 흘려보내고, 스윙은 폰에서 직접 잡아 swing 으로 보냅니다.
// 좌표는 '준비' 때 정한 기준축으로 보냅니다: r = 내 오른쪽, u = 위, f = 화면이 TV(탁구대)를 보던 방향.
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
  const COOLDOWN_MS = 500; // 스윙 사이 최소 간격
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
    // 약 40Hz 로 줄여 보냅니다. 다음 보낼 시각을 정해 두는 방식이라 60Hz 이벤트에서도 40Hz 가 나옵니다.
    if (basis && t >= nextPoseAt) {
      nextPoseAt = Math.max(nextPoseAt + POSE_MS, t + POSE_MS * 0.4);
      if (socket.connected) {
        socket.volatile.emit('c2d', { event: 'pose', data: { s: r3(inBasis(basis, ori.top)), fc: r3(inBasis(basis, ori.face)) } });
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
    if (rot > TRIGGER_DPS && t - lastTrig > COOLDOWN_MS && canSwing(t)) {
      swingWin = { t0: t, prevTrig: lastTrig };
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
      hand
    };
    debug(`swing ${JSON.stringify(data)}\nrot ${rotPeak.toFixed(0)} acc ${accPeak.toFixed(1)} vUp ${vUp.toFixed(2)} vH ${vH.toFixed(2)} ` +
      `roll ${rollFrac.toFixed(2)} gPk ${gPeak.toFixed(0)} lat ${latAvg.toFixed(2)} sign ${accSign} n ${all.length}`);
    deliverSwing(data);
  }

  // 센서 스윙과 버튼 스윙이 같은 길로 나갑니다.
  function deliverSwing(data) {
    const live = state.phase === 'playing' && myInfo();
    if (live && socket.connected) socket.emit('c2d', { event: 'swing', data });
    lastSwing = { data, at: performance.now() };
    swish(data.power);
    const label = swingLabel(data);
    if (mode === 'play') {
      clearCue();
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
    let s = SPIN_NAME[d.spin] || '플랫';
    if (d.spin === 'side') s += d.side > 0 ? '(오른쪽)' : '(왼쪽)';
    return `${s} · ${d.hand === 'back' ? '백핸드' : '포핸드'} · 힘 ${Math.round(d.power * 100)}%`;
  }
  function presetSwing(kind) {
    const p = PRESETS[kind];
    if (!p) return;
    deliverSwing({ power: p.power, ago: 0, rtt: Math.round(rtt()), spin: p.spin, spinAmt: p.spinAmt, side: 1, aim: 0, hand: 'fore' });
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
    // 돌아갈 곳이 있을 때만 취소할 수 있습니다(경기 중인데 기준이 없으면 꼭 맞춰야 합니다).
    $('btnCalCancel').classList.toggle('hidden', !(basis || state.phase !== 'playing' || !myInfo()));
    $('calT').textContent = basis ? '다시 맞춥니다' : '탁구채처럼 쥡니다';
    $('calB').textContent = '폰 아래쪽을 탁구채 손잡이처럼 쥐고,\n화면이 TV를 보게 한 뒤 준비를 누릅니다.';
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
    // 큰 화면은 이 신호로 탁구채 기준을 다시 잡습니다. 이 뒤의 pose 는 새 기준축 값입니다.
    if (socket.connected && me) socket.emit('c2d', { event: 'calibrate', data: {} });
    else pendingCal = true;
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
  function idleOrb() {
    if (cueOn) return;
    const info = myInfo();
    const orb = $('orb');
    orb.classList.remove('cue');
    orb.textContent = info && info.serving ? '내 서브' : '준비';
    $('status').textContent = info && info.serving
      ? '공이 떠올랐다 내려오며 느려질 때 휘두릅니다.'
      : '공이 느려지면 타이밍을 맞춰 휘두릅니다.';
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
    idleOrb();
    show('vPlay');
  }

  function showWait(info) {
    mode = 'wait';
    const phase = state.phase;
    const chips = [];
    if (roster.length) chips.push(['참가', `${roster.length}명`]);
    if (fallback) chips.push(['조작', '버튼']);
    else if (gotOri) chips.push(['탁구채 자세', basis ? '맞춤' : '아직', basis ? 'ok' : '']);
    $('btnGo').style.display = '';
    // 내 경기는 끝났는데 다른 테이블이 아직 치는 중이면 결과를 보여 주고 기다립니다.
    const doneWaiting = phase === 'playing' && matchDone(info);
    if (phase === 'over' || doneWaiting) {
      const sc = info && Array.isArray(info.score) ? info.score : null;
      const tail = doneWaiting ? '다른 경기가 끝나기를 기다립니다.' : '큰 화면에서 순위를 확인합니다.';
      if (sc) {
        $('waitT').textContent = sc[0] > sc[1] ? '승리!' : sc[0] < sc[1] ? '패배' : '경기 끝';
        $('waitB').textContent = `${sc[0]} : ${sc[1]}${info.opp ? ` (vs ${info.opp})` : ''}\n${tail}`;
      } else {
        $('waitT').textContent = '경기 끝';
        $('waitB').textContent = tail;
      }
      $('btnGo').textContent = '다시 하기';
      if (doneWaiting) $('btnGo').style.display = 'none';
    } else if (phase === 'playing') {
      $('waitT').textContent = '관전 중';
      $('waitB').textContent = '지금 경기가 끝나면 함께할 수 있습니다.';
      $('btnGo').style.display = 'none';
    } else {
      $('waitT').textContent = '대기실';
      $('waitB').textContent = basis || fallback || !gotOri
        ? '모두 들어오면 게임 시작을 누릅니다.'
        : '모두 들어오면 게임 시작을 누릅니다.\n먼저 탁구채 자세를 맞춰 두면 바로 칠 수 있습니다.';
      $('btnGo').textContent = '게임 시작';
    }
    setChips(chips, 'waitChips');
    const canCal = gotOri && !fallback;
    $('btnCalLobby').classList.toggle('hidden', !canCal);
    $('btnCalLobby').textContent = basis ? '탁구채 자세 다시 맞추기' : '탁구채 자세 맞추기';
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
    render();
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
    $('me').textContent = p.name;
    if (pendingCal) {
      pendingCal = false;
      socket.emit('c2d', { event: 'calibrate', data: {} });
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
    }
    render();
  });

  socket.on('cue', (c) => {
    const kind = c && c.kind;
    cueOn = true;
    clearTimeout(cueTimer);
    cueTimer = setTimeout(clearCue, CUE_MS);
    const orb = $('orb');
    orb.textContent = '지금!';
    orb.classList.add('cue');
    $('status').textContent = kind === 'serve' ? '서브! 공이 내려오는 타이밍에 휘두릅니다.' : '공이 옵니다! 링이 닫힐 때 휘두릅니다.';
    buzz(kind === 'serve' ? [25, 40, 25] : 45);
    tick();
  });

  socket.on('result', (r) => {
    r = r || {};
    clearCue();
    const t = $('resT');
    t.textContent = r.text || '';
    t.className = `t ${r.good ? 'good' : 'bad'}`;
    const chips = [];
    const SPIN_KO = { top: '드라이브', back: '커트', side: '사이드 스핀', smash: '스매시' };
    if (r.spin) chips.push([SPIN_KO[r.spin] || r.spin, '']);
    if (lastSwing && performance.now() - lastSwing.at < 1500) chips.push(['감지', swingLabel(lastSwing.data)]);
    setChips(chips);
    if (r.good) {
      buzz([30, 40, 70]);
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
      if (gotMotion) return;
      fallback = true;
      debug('동작 센서 값이 들어오지 않아 버튼으로 칩니다');
      sensorsChanged();
    }, SENSOR_WAIT_MS);
  });
  $('btnGo').addEventListener('click', () => {
    audio();
    socket.emit('c2d', { event: 'start_game', data: {} });
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
