// 골프 컨트롤러. 폰의 방향을 계속 큰 화면으로 흘려보내고, 임팩트는 폰에서 직접 잡습니다.
// 좌표는 어드레스 때 정한 기준축으로 보냅니다: r = 목표 오른쪽(공 쪽), u = 위, f = 목표 쪽.
(() => {
  const $ = (id) => document.getElementById(id);
  const RD = Math.PI / 180;
  const params = new URLSearchParams(location.search);
  const ROOM = (params.get('room') || '').toUpperCase();
  $('room').textContent = ROOM ? `방 ${ROOM}` : '';

  const CLUBS = [
    { id: '5i', name: '5I', sub: '롱 아이언' },
    { id: '7i', name: '7I', sub: '미들' },
    { id: '9i', name: '9I', sub: '숏' },
    { id: 'pw', name: 'PW', sub: '웨지' }
  ];

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
  let impactAt = 0;
  let holdTimer = null;
  let noRoomTries = 0;
  let me = null;
  let state = { phase: 'lobby' };
  let club = '7i';
  let aim = 0;
  let mode = 'start'; // start | wait | aim | hold | swing | result
  let sensorOk = false;

  function show(id) {
    for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === id);
  }
  function message(t, b) {
    $('msgT').textContent = t;
    $('msgB').textContent = b || '';
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
  const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b)))));

  // deviceorientation 값을 세계 좌표(위 = +Y)의 방향으로 바꿉니다.
  // 폰 윗부분 = (0,0,-1), 화면 바깥 = (0,1,0) 이 기기 쪽 축입니다.
  function deviceVectors(alpha, beta, gamma) {
    const q = qFromEuler(beta * RD, alpha * RD, -gamma * RD);
    return { top: qRot(q, [0, 0, -1]), face: qRot(q, [0, 1, 0]) };
  }

  // ---------- 기준축과 스윙 감지 ----------
  let basis = null; // { r, u, f, shaft0 }
  let last = null; // 마지막 원시 방향
  let rotNow = 0; // 회전 속도(도/초)
  let hasGyro = false; // rotationRate 에 숫자가 들어오는 기기인지
  const toBasis = (v) => [dot(v, basis.r), dot(v, basis.u), dot(v, basis.f)];

  const swing = { stage: 'ready', phi: 0, prev: null, prevT: 0, prevD: 0, top: 0, gyroPeak: 0, samples: [] };
  function resetSwing() {
    Object.assign(swing, { stage: 'ready', phi: 0, prev: null, prevT: 0, prevD: 0, top: 0, gyroPeak: 0, samples: [] });
  }

  function calibrate(v) {
    const u = [0, 1, 0];
    // 기준축은 샤프트(폰 길이 방향)에서 구합니다. 그립을 조금 돌려 쥐어도 목표선이 틀어지지 않습니다.
    // r = 공 쪽(골퍼가 보는 쪽), f = u × r = 목표 쪽(오른손잡이).
    let r = [v.top[0], 0, v.top[2]];
    if (Math.hypot(r[0], r[2]) < 0.2) {
      // 샤프트가 거의 수직이면 화면 방향을 목표로 보고 대신 씁니다.
      const f0 = norm([v.face[0], 0, v.face[2]]);
      r = cross(f0, u);
    }
    r = norm(r);
    const f = norm(cross(u, r));
    basis = { r, u, f };
    basis.shaft0 = toBasis(v.top);
    // 페이스는 어드레스 때 화면 방향을 기준(0°)으로 잽니다.
    const f0 = toBasis(v.face);
    basis.faceYaw0 = Math.atan2(f0[0], f0[2]);
    basis.back = norm(cross(basis.shaft0, [0, 0, -1])); // 뒤로 들어 올리는 회전축
    resetSwing();
  }

  function onSample(v, t) {
    if (!basis) return;
    if (mode !== 'swing') return;
    const s = toBasis(v.top);
    const fc = toBasis(v.face);
    send('pose', { s, fc }, true);
    drawMeter(s);

    const d = angle(s, basis.shaft0) / RD;
    if (swing.prev) {
      // 이어 붙인 회전각: 들어 올리면 음수, 내려오면 양수로 쌓입니다.
      const step = angle(swing.prev, s) / RD;
      const dir = Math.sign(dot(cross(swing.prev, s), basis.back)) || 0;
      swing.phi -= dir * step;
      swing.samples.push({ t, s, fc, d, phi: swing.phi });
      if (swing.samples.length > 8) swing.samples.shift();
      // 진행 속도(도/초, 내려올 때 양수). iPhone 은 같은 값이 겹쳐 오거나 간격이 흔들려서
      // 표본 하나 차이로 나누면 두 배로 튀므로, 3표본 떨어진 두 점 사이로 잽니다.
      const k = swing.samples;
      const old = k[Math.max(0, k.length - 4)];
      const rate = (swing.phi - old.phi) / Math.max(0.012, (t - old.t) / 1000);

      if (swing.stage === 'ready' && swing.phi < -60) swing.stage = 'back';
      if (swing.stage === 'back') {
        swing.top = Math.min(swing.top, swing.phi);
        if (rate > 250 && swing.phi > swing.top + 25) swing.stage = 'down';
        // 천천히 다시 내려놓으면 처음부터
        if (d < 20 && rate < 250) resetSwing();
      }
      if (swing.stage === 'down') {
        if (!hasGyro) swing.gyroPeak = Math.max(swing.gyroPeak, rate);
        // 어드레스 방향에 가장 가까워졌다가 멀어지기 시작하는 순간이 임팩트입니다.
        if ((swing.prevD < 45 && d > swing.prevD) || swing.phi > 40) impact();
      }
      swing.prevD = d;
    }
    swing.prev = s;
    swing.prevT = t;
  }

  const lerp3 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  function impact() {
    const k = swing.samples;
    const n = k.length;
    // 어드레스에 가장 가까웠던 순간을 세 표본(p0, p1, p2)의 포물선으로 보간합니다.
    const p0 = k[Math.max(0, n - 3)];
    const p1 = k[Math.max(0, n - 2)];
    const p2 = k[n - 1];
    const den = p0.d - 2 * p1.d + p2.d;
    let u = den > 1e-6 ? (0.5 * (p0.d - p2.d)) / den : 0;
    u = Math.max(-0.5, Math.min(0.5, u));
    const fImp = u >= 0 ? lerp3(p1.fc, p2.fc, u) : lerp3(p0.fc, p1.fc, 1 + u);
    const miss = Math.max(0, p1.d - 0.25 * (p0.d - p2.d) * u);
    // 클럽 끝이 움직이는 방향은 양옆 표본의 중앙 차분으로 구합니다.
    const vel = [p2.s[0] - p0.s[0], p2.s[1] - p0.s[1], p2.s[2] - p0.s[2]];
    let face = (Math.atan2(fImp[0], fImp[2]) - basis.faceYaw0) / RD; // + 는 열림(오른쪽)
    face = ((face + 540) % 360) - 180;
    const path = Math.atan2(vel[0], Math.abs(vel[2]) + 1e-6) / RD; // + 는 안에서 밖으로
    // 속도는 자이로(rotationRate) 최댓값을 씁니다. 자이로가 없으면 방향 차이로 잰 값.
    const speed = swing.gyroPeak;
    swing.stage = 'done';
    const data = { speed: Math.round(speed), face: +face.toFixed(1), path: +path.toFixed(1), miss: +miss.toFixed(1), club, aim };
    if (!send('impact', data)) {
      lostConnection();
      return;
    }
    impactAt = performance.now();
    if (navigator.vibrate) navigator.vibrate(60);
    ting();
    mode = 'result';
    $('resT').textContent = '굿 샷!';
    $('resChips').innerHTML = '';
    $('resB').textContent = '큰 화면을 보세요';
    show('vResult');
    debug(`impact ${JSON.stringify(data)}`);
  }

  function drawMeter(s) {
    // 화면 쪽에서 본 클럽 각도(목표 쪽이 오른쪽)
    const ang = Math.atan2(s[2], -s[1]);
    const x = Math.sin(ang) * 96;
    const y = Math.cos(ang) * 96;
    $('shaft').setAttribute('x2', x.toFixed(1));
    $('shaft').setAttribute('y2', y.toFixed(1));
    const p = Math.max(-1, Math.min(1, swing.phi / -270));
    if (p > 0.02) {
      // 아래에서 시작해 백스윙 쪽(왼쪽)으로 얼마나 돌았는지
      const th = p * 270 * RD;
      const ex = (-Math.sin(th) * 100).toFixed(1);
      const ey = (Math.cos(th) * 100).toFixed(1);
      $('arc').setAttribute('d', `M0 100 A100 100 0 ${th > Math.PI ? 1 : 0} 1 ${ex} ${ey}`);
    } else {
      $('arc').setAttribute('d', '');
    }
    if (swing.stage === 'back') $('swingT').textContent = '좋아요, 이제 휘둘러요';
  }

  // ---------- 센서 ----------
  let lastOri = null;
  function onOrientation(e) {
    if (e.alpha == null && e.beta == null) return;
    sensorOk = true;
    lastOri = deviceVectors(e.alpha || 0, e.beta || 0, e.gamma || 0);
    last = lastOri;
    onSample(lastOri, performance.now());
  }
  function onMotion(e) {
    const r = e.rotationRate;
    if (r && (r.alpha != null || r.beta != null || r.gamma != null)) {
      hasGyro = true;
      rotNow = Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0);
      if (swing.stage === 'down') swing.gyroPeak = Math.max(swing.gyroPeak, rotNow);
    }
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
  function ting() {
    const a = audio();
    if (!a) return;
    const o = a.createOscillator();
    const g = a.createGain();
    o.frequency.value = 2400;
    g.gain.setValueAtTime(0.4, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.25);
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + 0.3);
  }

  // ---------- 조준(터치) ----------
  function drawAim() {
    const a = aim * RD;
    const x = 150 + Math.sin(a) * 210;
    const y = 250 - Math.cos(a) * 210;
    $('aimLine').setAttribute('d', `M150 250 L${x.toFixed(1)} ${y.toFixed(1)}`);
    $('aimDeg').textContent = `${aim > 0 ? '오른쪽 ' : aim < 0 ? '왼쪽 ' : ''}${Math.abs(aim).toFixed(1)}°`;
  }
  let dragX = null;
  let dragAim = 0;
  $('pad').addEventListener('pointerdown', (e) => {
    dragX = e.clientX;
    dragAim = aim;
    $('pad').setPointerCapture(e.pointerId);
  });
  $('pad').addEventListener('pointermove', (e) => {
    if (dragX == null || mode !== 'aim') return;
    const w = $('pad').clientWidth;
    aim = Math.max(-25, Math.min(25, dragAim + ((e.clientX - dragX) / w) * 30));
    aim = Math.round(aim * 2) / 2;
    drawAim();
    send('aim', { yaw: aim }, true);
  });
  const endDrag = () => {
    if (dragX == null) return;
    dragX = null;
    send('aim', { yaw: aim, done: true });
  };
  $('pad').addEventListener('pointerup', endDrag);
  $('pad').addEventListener('pointercancel', endDrag);

  function drawClubs() {
    const box = $('clubs');
    box.innerHTML = '';
    for (const c of CLUBS) {
      const b = document.createElement('button');
      b.className = c.id === club ? 'on' : '';
      b.innerHTML = `<b>${c.name}</b><span>${c.sub}</span>`;
      b.addEventListener('click', () => {
        club = c.id;
        drawClubs();
        keepAwake();
        send('club', { club });
      });
      box.appendChild(b);
    }
  }

  // ---------- 어드레스 ----------
  $('btnAddress').addEventListener('click', () => {
    keepAwake();
    if (!sensorOk) {
      if (!isTouch || params.has('debug')) fakeSwing();
      else sensorHelp();
      return;
    }
    mode = 'hold';
    show('vHold');
    let n = 3;
    $('holdN').textContent = n;
    clearInterval(holdTimer);
    const tick = setInterval(() => {
      n -= 1;
      if (n > 0) {
        $('holdN').textContent = n;
        if (navigator.vibrate) navigator.vibrate(15);
        return;
      }
      clearInterval(tick);
      if (mode !== 'hold') return;
      calibrate(last);
      if (!send('address', { shaft0: basis.shaft0, club, aim })) {
        lostConnection();
        return;
      }
      mode = 'swing';
      $('swingT').textContent = '스윙하세요';
      $('swingB').textContent = '천천히 들어 올렸다가 끝까지 휘둘러요.';
      show('vSwing');
      if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
      ting();
    }, 1000);
    holdTimer = tick;
  });
  // 스윙이 안 잡히거나 자세가 틀어졌으면 다시 조준부터
  $('btnRedo').addEventListener('click', () => {
    clearInterval(holdTimer);
    resetSwing();
    send('cancel', {});
    mode = 'wait';
    render();
  });

  function lostConnection() {
    mode = 'wait';
    message('연결이 잠깐 끊겼어요', '다시 연결되면 조준 화면으로 돌아가요.');
  }
  function sensorHelp() {
    message('동작 센서를 쓸 수 없어요',
      'iPhone: Safari 를 앱 전환기에서 완전히 닫고 QR을 다시 찍은 뒤, 동작 접근을 허용해 주세요.\nAndroid: 주소창 자물쇠 → 사이트 설정 → 동작 센서를 허용해 주세요.');
  }
  function keepAwake() {
    if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
  }

  // 센서가 없는 PC 에서 시험할 수 있게, 정해진 궤적으로 스윙을 흉내 냅니다.
  function fakeSwing() {
    const shaft0 = norm([0.55, -0.83, 0.02]);
    const faceOpen = (Math.random() - 0.5) * 6 * RD;
    const plane = (phi) => {
      const c = Math.cos(phi * RD);
      const s = Math.sin(phi * RD);
      return norm([shaft0[0] * c, shaft0[1] * c, shaft0[2] * c + s]);
    };
    const faceAt = (phi) => [Math.sin(faceOpen + Math.max(0, phi) * 0.004), 0, Math.cos(faceOpen)];
    basis = { r: [1, 0, 0], u: [0, 1, 0], f: [0, 0, 1], shaft0 };
    basis.back = norm(cross(shaft0, [0, 0, -1]));
    resetSwing();
    basis.faceYaw0 = 0;
    send('address', { shaft0, club, aim, fake: true });
    mode = 'swing';
    show('vSwing');
    const t0 = performance.now();
    // 0.9초 백스윙, 0.15초 멈춤, 0.24초 다운스윙, 0.4초 피니시
    const phiAt = (ms) => {
      if (ms < 300) return 0;
      ms -= 300;
      if (ms < 900) return -250 * (0.5 - 0.5 * Math.cos((ms / 900) * Math.PI));
      ms -= 900;
      if (ms < 150) return -250;
      ms -= 150;
      if (ms < 300) return -250 + 250 * Math.pow(ms / 300, 1.3);
      ms -= 300;
      if (ms < 420) return 230 * Math.sin((ms / 420) * Math.PI / 2);
      return 230;
    };
    const run = () => {
      const ms = performance.now() - t0;
      const phi = phiAt(ms);
      rotNow = ms > 1350 && ms < 1650 ? 1150 : 0;
      onSample({ top: plane(phi), face: faceAt(phi) }, performance.now());
      if (ms < 2400) requestAnimationFrame(run);
    };
    requestAnimationFrame(run);
  }

  // ---------- 화면 상태 ----------
  function render() {
    if (!me) return;
    const myTurn = state.phase === 'playing' && state.turn === me.slot;
    const mine = (state.scores || {})[me.slot];
    $('myStats').innerHTML = mine && mine.best != null
      ? `<span class="chip">최고 <b>${mine.best.toFixed(1)}m</b></span>` : '';
    if (state.phase === 'lobby' || state.phase === 'over') {
      clearInterval(holdTimer);
      mode = 'wait';
      $('waitT').textContent = state.phase === 'over' ? '경기 끝' : '대기실';
      $('waitB').textContent = state.phase === 'over' ? '큰 화면에서 순위를 확인하세요.' : '모두 들어오면 게임 시작을 눌러요.';
      $('btnGo').classList.remove('hidden');
      $('btnGo').style.display = '';
      $('btnGo').textContent = state.phase === 'over' ? '다시 하기' : '게임 시작';
      show('vWait');
      return;
    }
    $('btnGo').style.display = 'none';
    if (!myTurn) {
      clearInterval(holdTimer);
      if (mode === 'result' && state.lastSlot === me.slot) return;
      mode = 'wait';
      $('waitT').textContent = state.turn ? `${state.turn}P 차례` : '대기';
      $('waitB').textContent = `라운드 ${state.round || 1} / ${state.rounds || 3}`;
      show('vWait');
      return;
    }
    // 친 뒤 8초가 지나도 큰 화면이 아직 조준/스윙 단계면 임팩트가 사라진 것이니 다시 조준합니다.
    const stale = mode === 'result' && (state.sub === 'aim' || state.sub === 'swing') && performance.now() - impactAt > 8000;
    if (!stale && (mode === 'hold' || mode === 'swing' || mode === 'result')) return;
    if (mode !== 'aim') {
      // 새 차례: 큰 화면과 같은 값(핀 방향, 7번)에서 시작합니다.
      aim = 0;
      club = '7i';
      resetSwing();
    }
    mode = 'aim';
    $('aimInfo').textContent = state.pin ? `핀까지 ${state.pin}m` : '';
    drawAim();
    drawClubs();
    show('vAim');
    if (navigator.vibrate) navigator.vibrate([20, 60, 20]);
  }

  socket.on('connect', () => socket.emit('join', { role: 'controller', room: ROOM, token }));
  socket.on('assigned', (p) => {
    if (p.game !== 'golf') {
      location.replace(p.game === 'baseball' ? `/play/?room=${ROOM}` : `/play/${p.game}/?room=${ROOM}`);
      return;
    }
    me = p;
    noRoomTries = 0;
    if (mode === 'swing' || mode === 'hold') mode = 'wait';
    document.documentElement.style.setProperty('--c', p.color);
    $('me').textContent = p.name;
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
    const turnChanged = s.turn !== state.turn || s.shot !== state.shot;
    state = s;
    if (turnChanged && mode === 'result') mode = 'wait';
    render();
  });
  socket.on('result', (r) => {
    mode = 'result';
    $('resT').textContent = r.title;
    $('resChips').innerHTML = (r.chips || []).map(([k, v]) => `<span class="chip">${k}<b>${v}</b></span>`).join('');
    $('resB').textContent = r.note || '';
    show('vResult');
    if (r.great && navigator.vibrate) navigator.vibrate([80, 60, 160]);
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
    // 폰에서 거절되면 켜는 법을 안내합니다. 센서 없는 PC 는 시험 스윙으로 계속합니다.
    if (answers.some((a) => a !== 'granted') && isTouch && !params.has('debug')) {
      sensorHelp();
      return;
    }
    if (!ROOM) {
      message('방 코드가 없어요', '큰 화면의 QR을 찍어 주세요.');
      return;
    }
    socket.connect();
    setTimeout(() => {
      if (!sensorOk) {
        if (isTouch && !params.has('debug')) {
          $('btnAddress').textContent = '동작 센서 켜는 법 보기';
        } else {
          $('btnAddress').textContent = '센서 없음 · 시험 스윙';
          debug('동작 센서 값이 들어오지 않아 시험 스윙으로 동작합니다');
        }
      }
    }, 1500);
  });
  $('btnGo').addEventListener('click', () => {
    keepAwake();
    send('start_game', {});
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
  });

  function debug(t) {
    if (params.has('debug')) $('debug').textContent = t;
  }
})();
