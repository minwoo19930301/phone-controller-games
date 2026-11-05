// 퍼팅 컨트롤러. 터치로 조준하고, 폰을 퍼터 그립처럼 쥐고 시계추처럼 밀면 그 세기를 폰에서 직접 잽니다.
// 좌표는 어드레스 때 정한 기준축으로 보냅니다: u = 위, f = 홀 쪽(어드레스 때 화면이 보는 수평 방향), r = f × u(오른쪽).
(() => {
  const $ = (id) => document.getElementById(id);
  const RD = Math.PI / 180;
  const params = new URLSearchParams(location.search);
  const ROOM = (params.get('room') || '').toUpperCase();
  const DEBUG = params.has('debug');
  $('room').textContent = ROOM ? `방 ${ROOM}` : '';

  const SENSOR_WAIT_MS = 1500; // 이 시간 안에 동작 센서 값이 없으면 시험 버튼 모드
  const PIVOT = 0.9; // 퍼터 스피드 = 회전 속도(rad/s) × 0.9m
  const SMASH = 1.2; // 큰 화면이 볼 스피드 = 퍼터 스피드 × 1.2 로 씁니다(세기 안내용)
  const DECEL = 0.549; // 스팀프 10 그린의 감속(평지 거리 안내용)
  const FWD_RATE = 25; // 홀 쪽으로 이 이상(도/초) 돌기 시작하면 스트로크 시작
  const MIN_PEAK = 20; // 이보다 약한 움직임은 손 떨림(왜글)으로 봅니다
  const AIM_MAX = 25;

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
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let me = null;
  let state = { phase: 'lobby' };
  let mode = 'start'; // start | wait | aim | hold | stroke | result
  let aim = 0;
  let grid = true;
  let sensorOk = false;
  let simMode = false;
  let noRoomTries = 0;
  let holdTimer = null;
  let turnShot = -1;
  let strokeAt = 0;

  function show(id) {
    for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === id);
  }
  function message(t, b, withOk) {
    $('msgT').textContent = t;
    $('msgB').textContent = b || '';
    $('btnMsg').classList.toggle('hidden', !withOk);
    show('vMsg');
  }

  // ---------- 작은 사원수 계산 ----------
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
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const r3 = (v) => v.map((x) => Math.round(x * 10000) / 10000);

  // deviceorientation 값을 세계 좌표(위 = +Y)의 방향으로 바꿉니다.
  // 폰 윗부분 = (0,0,-1), 화면 바깥 = (0,1,0) 이 기기 쪽 축입니다(골프와 같음).
  function deviceVectors(alpha, beta, gamma) {
    const q = qFromEuler(beta * RD, alpha * RD, -gamma * RD);
    return { top: qRot(q, [0, 0, -1]), face: qRot(q, [0, 1, 0]) };
  }

  // ---------- 지연 측정(1.5초마다, 최근 7번의 가운데 값) ----------
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
  function rtt() {
    if (!rtts.length) return 80;
    const s = [...rtts].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  // ---------- 기준축과 스트로크 감지 ----------
  let basis = null;
  let last = null; // 마지막 원시 방향
  let rotNow = 0; // 자이로 회전 속도 크기(도/초)
  let hasGyro = false;
  const toBasis = (v) => [dot(v, basis.r), dot(v, basis.u), dot(v, basis.f)];
  const det = { stage: 'idle', samples: [], th: 0, face: 0, rate: 0, minTh: 0, thStart: 0, peak: 0, peakAt: 0, faceAtPeak: 0, fwdAt: 0, settleUntil: 0, stillSince: 0, lastPoseAt: 0 };
  function resetDet(t) {
    Object.assign(det, { stage: 'settle', samples: [], th: 0, face: 0, rate: 0, minTh: 0, thStart: 0, peak: 0, peakAt: 0, faceAtPeak: 0, fwdAt: 0, settleUntil: t + 450, stillSince: t });
  }

  // 퍼터 쪽 기준은 화면 방향입니다. 퍼터 샤프트(폰 길이)는 거의 수직이라 수평 성분이 믿을 만하지 않습니다.
  function calibrate(v) {
    const u = [0, 1, 0];
    const fh = [v.face[0], 0, v.face[2]];
    if (Math.hypot(fh[0], fh[2]) < 0.35) return false; // 화면이 하늘이나 땅을 보고 있음
    const f = norm(fh);
    const r = norm(cross(f, u));
    basis = { r, u, f };
    basis.s0 = toBasis(v.top);
    basis.fc0 = toBasis(v.face);
    basis.th0 = Math.atan2(basis.s0[2], -basis.s0[1]);
    return true;
  }

  // 방향 표본 하나: 진자 각(홀 쪽 +)과 페이스 각(오른쪽 + = 열림)
  function onSample(v, t) {
    if (mode !== 'stroke' || !basis) return;
    const s = toBasis(v.top);
    const fc = toBasis(v.face);
    // 큰 화면 퍼터가 따라 움직이도록 40Hz 이하로 흘려보냅니다.
    if (t - det.lastPoseAt >= 25) {
      det.lastPoseAt = t;
      send('pose', { s: r3(s), fc: r3(fc) }, true);
    }
    const th = (Math.atan2(s[2], -s[1]) - basis.th0) / RD;
    const face = Math.atan2(fc[0], fc[2]) / RD;
    det.samples.push({ t, th });
    if (det.samples.length > 10) det.samples.shift();
    // 진행 속도(도/초). iPhone 은 같은 값이 겹쳐 오므로 3표본 떨어진 두 점 사이로 잽니다(방향 판단용).
    const k = det.samples;
    const old = k[Math.max(0, k.length - 4)];
    const rate = k.length > 1 ? (th - old.th) / Math.max(0.012, (t - old.t) / 1000) : 0;
    det.th = th;
    det.face = face;
    det.rate = rate;
    drawMeter(th);
    if (det.stage === 'settle') {
      if (t > det.settleUntil) {
        det.stage = 'ready';
        det.minTh = th;
        det.stillSince = t;
      }
      return;
    }
    if (det.stage === 'ready') {
      det.minTh = Math.min(det.minTh, th);
      // 가만히 있으면 백스윙 기준을 지금 자리로 다시 잡습니다.
      if (Math.abs(rate) < 6) {
        if (t - det.stillSince > 600) det.minTh = th;
      } else det.stillSince = t;
      if (det.minTh < -1.5) $('strokeT').textContent = '좋아요, 이제 톡';
      if (rate > FWD_RATE && th > det.minTh + 0.8) {
        det.stage = 'fwd';
        det.fwdAt = t;
        det.thStart = det.minTh;
        det.peak = hasGyro ? rotNow : rate;
        det.peakAt = t;
        det.faceAtPeak = face;
      }
      return;
    }
    if (det.stage === 'fwd') {
      // 속도는 자이로(rotationRate) 최댓값. 자이로가 없는 기기만 방향 변화로 잰 값을 씁니다.
      if (!hasGyro && rate > det.peak) {
        det.peak = rate;
        det.peakAt = t;
        det.faceAtPeak = face;
      }
      const g = hasGyro ? rotNow : rate;
      // 최고 속도를 막 지나면 바로 보냅니다(늦게 보내면 큰 화면 공이 늦게 출발). 자이로 없는 기기는 값이 거칠어 조금 더 기다립니다.
      const dropped = g < det.peak * (hasGyro ? 0.85 : 0.6) && t - det.peakAt > 25;
      if (dropped || rate < -8 || t - det.fwdAt > 700) fire(t);
    }
  }

  function onMotionRate(rate) {
    hasGyro = true;
    rotNow = rate;
    if (det.stage === 'fwd' && rotNow > det.peak) {
      det.peak = rotNow;
      det.peakAt = performance.now();
      det.faceAtPeak = det.face;
    }
  }

  function fire(t) {
    const travel = det.th - det.thStart;
    if (det.peak < MIN_PEAK || travel < 1.5) {
      // 손 떨림이나 왜글: 다시 기다립니다.
      det.stage = 'ready';
      det.minTh = det.th;
      det.stillSince = t;
      return;
    }
    det.stage = 'done';
    const speed = clamp(det.peak * RD * PIVOT, 0.05, 3.6);
    const face = clamp(det.faceAtPeak, -15, 15);
    const data = { speed: +speed.toFixed(3), face: +face.toFixed(2), ago: Math.max(0, Math.round(performance.now() - det.peakAt)), rtt: Math.round(rtt()) };
    if (!send('stroke', data)) {
      lostConnection();
      return;
    }
    strokeAt = performance.now();
    if (navigator.vibrate) navigator.vibrate(35);
    tock(Math.min(1, speed / 2.5));
    mode = 'result';
    $('resT').textContent = '굴러가요';
    $('resB').textContent = '큰 화면을 보세요';
    $('resChips').innerHTML = `<span class="chip">퍼터 스피드<b>${speed.toFixed(2)}m/s</b></span><span class="chip">페이스<b>${faceText(face)}</b></span>`;
    show('vResult');
    debug(`stroke ${JSON.stringify(data)} travel ${travel.toFixed(1)}° gyro ${hasGyro}`);
  }
  const faceText = (f) => (Math.abs(f) < 0.5 ? '스퀘어' : f > 0 ? `열림 ${f.toFixed(1)}°` : `닫힘 ${(-f).toFixed(1)}°`);

  function drawMeter(th) {
    const a = clamp(th * 2.2, -40, 40) * RD;
    $('needle').setAttribute('x2', (Math.sin(a) * 150).toFixed(1));
    $('needle').setAttribute('y2', (Math.cos(a) * 150).toFixed(1));
    const R = 165;
    const ex = (Math.sin(a) * R).toFixed(1);
    const ey = (Math.cos(a) * R).toFixed(1);
    if (Math.abs(a) < 0.01) {
      $('arcBack').setAttribute('d', '');
      $('arcFwd').setAttribute('d', '');
    } else if (a < 0) {
      $('arcBack').setAttribute('d', `M0 ${R} A${R} ${R} 0 0 1 ${ex} ${ey}`);
      $('arcFwd').setAttribute('d', '');
    } else {
      $('arcFwd').setAttribute('d', `M0 ${R} A${R} ${R} 0 0 0 ${ex} ${ey}`);
      $('arcBack').setAttribute('d', '');
    }
  }

  // ---------- 센서 ----------
  function onOrientation(e) {
    if (e.alpha == null && e.beta == null) return;
    sensorOk = true;
    if (simRun) return;
    last = deviceVectors(e.alpha || 0, e.beta || 0, e.gamma || 0);
    onSample(last, performance.now());
  }
  function onMotion(e) {
    if (simRun) return;
    const r = e.rotationRate;
    if (r && (r.alpha != null || r.beta != null || r.gamma != null)) onMotionRate(Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0));
  }

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
  function beep(freq, sec, gain, type = 'sine', at = 0) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + at;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + sec + 0.02);
  }
  // 퍼터에 공이 맞는 "톡"
  function tock(q) {
    const a = audio();
    if (!a) return;
    const len = Math.floor(a.sampleRate * 0.04);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 3000;
    f.Q.value = 1.3;
    const g = a.createGain();
    g.gain.value = 0.5 + q * 0.5;
    src.connect(f).connect(g).connect(a.destination);
    src.start();
    beep(1300 + q * 300, 0.07, 0.25, 'triangle');
  }

  // ---------- 조준(터치) ----------
  function drawAim() {
    const a = clamp(aim * 2.4, -60, 60) * RD; // 패드에서는 잘 보이게 크게 그립니다
    const x = 150 + Math.sin(a) * 194;
    const y = 238 - Math.cos(a) * 194;
    $('aimLine').setAttribute('d', `M150 238 L${x.toFixed(1)} ${y.toFixed(1)}`);
    $('aimDeg').textContent = Math.abs(aim) < 0.05 ? '홀 방향' : `${aim > 0 ? '오른쪽' : '왼쪽'} ${Math.abs(aim).toFixed(1)}°`;
  }
  function setAim(v, done) {
    aim = Math.round(clamp(v, -AIM_MAX, AIM_MAX) * 10) / 10;
    drawAim();
    send('aim', { yaw: aim, grid, done: Boolean(done) }, !done);
  }
  let dragX = null;
  let dragAim = 0;
  $('pad').addEventListener('pointerdown', (e) => {
    dragX = e.clientX;
    dragAim = aim;
    $('pad').setPointerCapture(e.pointerId);
    keepAwake();
  });
  $('pad').addEventListener('pointermove', (e) => {
    if (dragX == null || mode !== 'aim') return;
    const w = $('pad').clientWidth;
    // 패드 폭 전체를 밀면 12° (퍼팅은 작은 각도가 중요해서 촘촘하게)
    setAim(dragAim + ((e.clientX - dragX) / w) * 12, false);
  });
  const endDrag = () => {
    if (dragX == null) return;
    dragX = null;
    setAim(aim, true);
  };
  $('pad').addEventListener('pointerup', endDrag);
  $('pad').addEventListener('pointercancel', endDrag);
  $('btnLeft').addEventListener('click', () => setAim(aim - 0.5, true));
  $('btnRight').addEventListener('click', () => setAim(aim + 0.5, true));
  function drawGrid() {
    $('btnGrid').classList.toggle('on', grid);
    $('btnGrid').textContent = grid ? '경사 보기 켜짐' : '경사 보기 꺼짐';
  }
  $('btnGrid').addEventListener('click', () => {
    grid = !grid;
    drawGrid();
    // 끊겨 사라져도 다음 메시지가 바로잡도록 켜짐/꺼짐 상태를 그대로 보냅니다.
    send('aim', { yaw: aim, grid, done: true });
  });

  // ---------- 어드레스 ----------
  $('btnAddress').addEventListener('click', () => {
    keepAwake();
    audio();
    if (!sensorOk && !simMode) {
      sensorHelp();
      return;
    }
    if (simMode && !sensorOk) last = simRestPose();
    mode = 'hold';
    show('vHold');
    send('address', { phase: 'hold', aim, grid });
    let n = 3;
    $('holdN').textContent = n;
    beep(900, 0.06, 0.15);
    clearInterval(holdTimer);
    holdTimer = setInterval(() => {
      n -= 1;
      if (n > 0) {
        $('holdN').textContent = n;
        beep(900, 0.06, 0.15);
        if (navigator.vibrate) navigator.vibrate(15);
        return;
      }
      clearInterval(holdTimer);
      if (mode !== 'hold') return;
      if (!last || !calibrate(last)) {
        mode = 'aim';
        send('cancel', {});
        message('화면이 홀을 보게 세워 주세요', '폰 윗부분은 땅을, 화면은 홀 쪽을 보게 쥐고 다시 어드레스를 눌러요.', true);
        return;
      }
      if (!send('address', { phase: 'ready', s0: r3(basis.s0), fc0: r3(basis.fc0), aim, grid })) {
        lostConnection();
        return;
      }
      mode = 'stroke';
      resetDet(performance.now());
      $('strokeT').textContent = '톡 밀어요';
      $('strokeB').textContent = simMode ? '센서가 없어서 아래 버튼으로 시험해요.' : '뒤로 살짝 뺐다가 시계추처럼.\n빠를수록 멀리 굴러가요.';
      $('sim').classList.toggle('hidden', !simMode);
      if (simMode) presetSim();
      drawMeter(0);
      show('vStroke');
      if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
      beep(1568, 0.18, 0.2);
    }, simMode ? 450 : 1000);
  });
  $('btnMsg').addEventListener('click', () => render(true));
  // 자세가 틀어졌으면 조준부터 다시
  $('btnRedo').addEventListener('click', () => {
    clearInterval(holdTimer);
    det.stage = 'idle';
    send('cancel', {});
    mode = 'aim';
    render(true);
  });

  function lostConnection() {
    mode = 'wait';
    message('연결이 잠깐 끊겼어요', '다시 연결되면 조준 화면으로 돌아가요.');
  }
  function sensorHelp() {
    message('동작 센서를 쓸 수 없어요',
      'iPhone: Safari 를 앱 전환기에서 완전히 닫고 QR을 다시 찍은 뒤, 동작 접근을 허용해 주세요.\nAndroid: 주소창 자물쇠 → 사이트 설정 → 동작 센서를 허용해 주세요.', true);
  }
  function keepAwake() {
    if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
  }

  // ---------- 시험 퍼팅(센서 없는 PC): 진자 모양 움직임을 같은 감지 코드에 흘려 넣습니다 ----------
  let simRun = null;
  const TH0 = 3 * RD; // 그립을 살짝 앞으로 기울인 어드레스
  function simRestPose() {
    return { top: [0, -Math.cos(TH0), Math.sin(TH0)], face: [0, 0, 1] };
  }
  function presetSim() {
    // 평지 기준으로 홀을 40cm 지나가는 세기
    const d = Number(state.dist) || 3;
    const v = Math.sqrt(2 * DECEL * (d + 0.4)) / SMASH;
    $('simPower').value = clamp(v, 0.3, 3.6).toFixed(2);
    $('simFace').value = '0';
    drawSim();
  }
  function drawSim() {
    const v = Number($('simPower').value);
    const flat = Math.pow(v * SMASH, 2) / (2 * DECEL);
    $('simV').textContent = `${v.toFixed(2)} m/s · 평지 약 ${flat.toFixed(1)}m`;
    const f = Number($('simFace').value);
    $('simFV').textContent = faceText(f);
  }
  $('simPower').addEventListener('input', drawSim);
  $('simFace').addEventListener('input', drawSim);
  $('btnSim').addEventListener('click', () => {
    if (mode !== 'stroke' || simRun) return;
    audio();
    const putter = Number($('simPower').value);
    const phi = (Number($('simFace').value) + (Math.random() - 0.5) * 0.6) * RD;
    const w = putter / PIVOT; // rad/s, 맨 아래에서의 회전 속도
    const Tf = 0.32;
    const A = (w * 2 * Tf) / Math.PI; // 백스윙 크기(rad)
    const t0 = performance.now();
    // 0.25초 멈춤 → 0.5초 백스윙 → 0.08초 멈춤 → 시계추처럼 내려와 맞힘 → 팔로스루
    const at = (ms) => {
      let t = ms / 1000;
      if (t < 0.25) return [0, 0];
      t -= 0.25;
      if (t < 0.5) return [-A * (0.5 - 0.5 * Math.cos((t / 0.5) * Math.PI)), (-A * 0.5 * Math.PI * Math.sin((t / 0.5) * Math.PI)) / 0.5];
      t -= 0.5;
      if (t < 0.08) return [-A, 0];
      t -= 0.08;
      if (t < Tf) return [-A * Math.cos((Math.PI / 2) * (t / Tf)), (A * (Math.PI / 2) * Math.sin((Math.PI / 2) * (t / Tf))) / Tf];
      t -= Tf;
      const T2 = Tf * 1.2;
      if (t < T2) return [A * Math.sin((Math.PI / 2) * (t / T2)), (A * (Math.PI / 2) * Math.cos((Math.PI / 2) * (t / T2))) / T2];
      return [A, 0];
    };
    // 기준축(r, u, f) 좌표로 만든 움직임을 세계 좌표로 바꿔 실제 센서 값처럼 넣습니다.
    const b = basis;
    const toWorld = (v) => [0, 1, 2].map((i) => b.r[i] * v[0] + b.u[i] * v[1] + b.f[i] * v[2]);
    simRun = setInterval(() => {
      const ms = performance.now() - t0;
      const [th, rate] = at(ms);
      const a = th + TH0;
      onMotionRate(Math.abs(rate) / RD + Math.random() * 1.5);
      onSample({
        top: toWorld([0, -Math.cos(a), Math.sin(a)]),
        face: toWorld([Math.sin(phi), Math.cos(phi) * Math.sin(th), Math.cos(phi) * Math.cos(th)])
      }, performance.now());
      if (ms > 1900 || mode !== 'stroke') {
        clearInterval(simRun);
        simRun = null;
        rotNow = 0;
      }
    }, 16);
  });

  // ---------- 화면 상태 ----------
  function renderCard() {
    const card = (state.card || {})[me.slot];
    if (!card) {
      $('myCard').innerHTML = '';
      return;
    }
    const tot = card.reduce((s, v) => s + (v || 0), 0);
    $('myCard').innerHTML = card.map((v, i) => `<div><span>${i + 1}번 홀</span><b>${v == null ? '-' : v}</b></div>`).join('') +
      `<div class="tot"><span>합계</span><b>${tot}</b></div>`;
  }
  function render(force) {
    if (!me) return;
    renderCard();
    const inGame = (state.players || []).includes(me.slot) && !(state.bots || []).includes(me.slot);
    if (state.phase === 'lobby' || state.phase === 'over') {
      clearInterval(holdTimer);
      mode = 'wait';
      $('waitT').textContent = state.phase === 'over' ? '경기 끝' : '대기실';
      $('waitB').textContent = state.phase === 'over' ? '큰 화면에서 순위를 확인하세요.' : '모두 들어오면 게임 시작을 눌러요.\n3홀, 홀마다 최대 5타.';
      $('btnGo').style.display = '';
      $('btnGo').textContent = state.phase === 'over' ? '다시 하기' : '게임 시작';
      show('vWait');
      return;
    }
    $('btnGo').style.display = 'none';
    if (!inGame) {
      mode = 'wait';
      $('waitT').textContent = '구경 중';
      $('waitB').textContent = '이번 경기가 끝나면 함께해요.';
      show('vWait');
      return;
    }
    const myTurn = state.turn === me.slot;
    const sub = state.sub;
    if (!myTurn || sub === 'holeEnd') {
      clearInterval(holdTimer);
      // 방금 친 결과는 잠깐 더 보여 줍니다.
      if (mode === 'result' && state.lastSlot === me.slot && performance.now() - strokeAt < 9000 && !force) return;
      mode = 'wait';
      $('waitT').textContent = sub === 'holeEnd' ? `${state.hole}번 홀 끝` : state.turn ? `${state.turn}P 차례` : '대기';
      $('waitB').textContent = `${state.hole || 1}번 홀 · ${state.holeName || ''} · 파 ${state.par || 2}`;
      show('vWait');
      return;
    }
    if (sub === 'intro' || sub === 'next') {
      if (mode === 'result' && !force) return;
      mode = 'wait';
      $('waitT').textContent = '곧 내 차례';
      $('waitB').textContent = `${state.hole}번 홀 · ${state.holeName} · 홀까지 ${Number(state.dist || 0).toFixed(1)}m`;
      show('vWait');
      return;
    }
    if (sub === 'roll' || sub === 'result') {
      if (mode !== 'result') {
        mode = 'result';
        $('resT').textContent = '굴러가요';
        $('resB').textContent = '큰 화면을 보세요';
        $('resChips').innerHTML = '';
        show('vResult');
      }
      return;
    }
    // 내 조준 차례(aim·hold·stroke)
    const sameTurn = state.shot === turnShot;
    if (!force && sameTurn && (mode === 'hold' || mode === 'stroke')) return;
    // 조준 화면에 (다시) 들어올 때는 큰 화면의 조준을 받습니다(새로고침·재연결 뒤에도 같은 방향). 조준 중에는 내 값을 씁니다.
    if (!sameTurn || mode !== 'aim') {
      aim = typeof state.aim === 'number' ? Math.round(clamp(state.aim, -AIM_MAX, AIM_MAX) * 10) / 10 : sameTurn ? aim : 0;
    }
    if (!sameTurn) {
      turnShot = state.shot;
      if (navigator.vibrate) navigator.vibrate([20, 60, 20]);
      beep(1046, 0.12, 0.12);
    }
    // 큰 화면은 아직 어드레스(hold·stroke)인데 폰은 조준 화면으로 돌아왔습니다(재연결·새로고침·확인 버튼): 큰 화면도 조준으로 되돌립니다.
    if (sub === 'hold' || sub === 'stroke') {
      clearInterval(holdTimer);
      send('cancel', {});
    }
    if (typeof state.grid === 'boolean') grid = state.grid;
    mode = 'aim';
    $('aimInfo').textContent = `${state.hole}번 홀 · ${state.stroke || 1}타째 · 홀까지 ${Number(state.dist || 0).toFixed(1)}m`;
    drawAim();
    drawGrid();
    show('vAim');
  }

  socket.on('connect', () => socket.emit('join', { role: 'controller', room: ROOM, token }));
  socket.on('assigned', (p) => {
    if (p.game !== 'putting') {
      location.replace(p.game === 'baseball' ? `/play/?room=${ROOM}` : `/play/${p.game}/?room=${ROOM}`);
      return;
    }
    me = p;
    noRoomTries = 0;
    if (mode === 'stroke' || mode === 'hold') mode = 'wait';
    document.documentElement.style.setProperty('--c', p.color);
    $('me').textContent = p.name;
    render(true);
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
    if (d && d.connected === false && me) message('큰 화면 연결이 끊겼어요', '큰 화면이 다시 열리면 이어서 해요.');
    else if (d && d.connected && me && document.getElementById('vMsg').classList.contains('on')) render(true);
  });
  socket.on('game_state', (s) => {
    state = s || { phase: 'lobby' };
    if ($('vMsg').classList.contains('on') && !$('btnMsg').classList.contains('hidden')) return;
    render(false);
  });
  socket.on('result', (r) => {
    mode = 'result';
    strokeAt = performance.now();
    $('resT').textContent = r.text || '';
    $('resB').textContent = r.note || '';
    $('resChips').innerHTML = (r.chips || []).map(([k, v]) => `<span class="chip">${k}<b>${v}</b></span>`).join('');
    show('vResult');
    document.body.classList.remove('flash');
    void document.body.offsetWidth;
    if (r.holed) {
      document.body.classList.add('flash');
      if (navigator.vibrate) navigator.vibrate([60, 50, 60, 50, 180]);
      beep(784, 0.15, 0.2);
      beep(1046, 0.15, 0.2, 'sine', 0.12);
      beep(1568, 0.3, 0.2, 'sine', 0.24);
    } else if (navigator.vibrate) navigator.vibrate(40);
  });

  $('btnStart').addEventListener('click', async () => {
    // 화면 꺼짐 방지와 권한 요청은 탭 안에서 await 전에 바로 불러야 iPhone 에서 통합니다.
    keepAwake();
    audio();
    const asks = [];
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
      asks.push(DeviceOrientationEvent.requestPermission().catch(() => 'denied'));
    }
    if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') {
      asks.push(DeviceMotionEvent.requestPermission().catch(() => 'denied'));
    }
    const answers = await Promise.all(asks);
    window.addEventListener('deviceorientation', onOrientation);
    window.addEventListener('devicemotion', onMotion);
    // 폰에서 거절되면 켜는 법을 안내합니다. 센서 없는 PC 는 시험 퍼팅으로 계속합니다.
    if (answers.some((a) => a !== 'granted') && isTouch && !DEBUG) {
      sensorHelp();
      return;
    }
    if (!ROOM) {
      message('방 코드가 없어요', '큰 화면의 QR을 찍어 주세요.');
      return;
    }
    mode = 'wait';
    message('연결하는 중', '잠시만 기다려 주세요.');
    socket.connect();
    setTimeout(() => {
      if (sensorOk && !DEBUG) return;
      if (!isTouch || DEBUG) {
        simMode = true;
        $('btnAddress').textContent = sensorOk ? '어드레스 (시험 퍼팅)' : '센서 없음 · 어드레스 (시험)';
        debug('동작 센서 값이 들어오지 않아 시험 퍼팅 버튼으로 동작합니다');
      } else {
        $('btnAddress').textContent = '동작 센서 켜는 법 보기';
      }
    }, SENSOR_WAIT_MS);
  });
  $('btnGo').addEventListener('click', () => {
    keepAwake();
    audio();
    send('start_game', {});
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
  });

  function debug(t) {
    if (DEBUG) $('debug').textContent = t;
  }
  if (DEBUG) {
    setInterval(() => {
      if (mode === 'stroke') debug(`stage ${det.stage} θ ${det.th.toFixed(1)}° rate ${det.rate.toFixed(0)} gyro ${rotNow.toFixed(0)} peak ${det.peak.toFixed(0)} rtt ${Math.round(rtt())}`);
    }, 200);
  }
})();
