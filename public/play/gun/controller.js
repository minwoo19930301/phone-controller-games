// 좀비 건 컨트롤러. 폰이 총입니다.
// 폰을 화면 쪽으로 겨누면 방향(deviceorientation)을 '중앙 맞추기' 때의 자세 기준으로 바꿔 화면 안의 위치(x, y: 0~1)로 보냅니다.
// 큰 방아쇠는 shoot(누른 순간의 조준 위치와 센서 지연 ago 를 같이 보냄), 폰을 아래로 확 꺾거나 장전 버튼은 reload 입니다.
// 폰을 리모컨처럼 눕혀 쥐면 윗부분이, 카메라처럼 세워 쥐면 뒷면이 겨누는 방향입니다(맞추는 순간 자세로 자동 판단).
(() => {
  const $ = (id) => document.getElementById(id);
  const RD = Math.PI / 180;
  const params = new URLSearchParams(location.search);
  const ROOM = (params.get('room') || '').toUpperCase();
  const DEBUG = params.has('debug');
  $('room').textContent = ROOM ? `방 ${ROOM}` : '';

  // ---------- 조정 값 (실폰 검증 전이라 바뀔 수 있습니다) ----------
  const AIM_MS = 33; // aim 전송 간격, 약 30Hz
  const RANGE_X = 26; // 중앙에서 좌우로 이 각도(도)를 돌리면 화면 가장자리
  const RANGE_Y = 17; // 위아래
  const SMOOTH = 0.55; // 보내기 전 한 번 다듬기(0~1, 클수록 빠르게 따라감)
  const FLICK_DEG = 45; // 이만큼 아래로 꺾으면 장전
  const FLICK_MS = 260;
  const RELOAD_COOL_MS = 1100;
  const CAL_BACK_MS = 120; // '중앙' 버튼을 누른 순간의 흔들림을 피해 이만큼 전 값부터 씁니다
  const CAL_SPAN_MS = 280;
  const SENSOR_WAIT_MS = 1500; // 이 시간 안에 동작 센서 값이 없으면 버튼 모드
  const MAG = 12;
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
  let mode = 'start'; // start | connecting | msg | wait | cal | play | idle
  let gotOri = false;
  let fallback = false;
  let permDenied = false;
  let pendingCal = false;
  let pendingReady = false;
  let noRoomTries = 0;
  let helpOn = false;
  let displayOn = true;
  let readyList = [];

  function show(id) {
    for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === id);
    $('btnRecal').classList.toggle('hidden', !(id === 'vPlay' && gotOri && !fallback));
  }
  function message(t, b, btn) {
    helpOn = false;
    mode = 'msg';
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
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const r4 = (v) => Math.round(v * 10000) / 10000;

  // deviceorientation 값을 세계 좌표(위 = +Y)의 방향으로 바꿉니다. 다른 종목과 같은 변환입니다.
  // 이 좌표에서 폰 윗부분 = (0,0,-1), 화면 바깥 = (0,1,0) 입니다.
  function deviceVectors(alpha, beta, gamma) {
    const q = qFromEuler(beta * RD, alpha * RD, -gamma * RD);
    return { top: qRot(q, [0, 0, -1]), face: qRot(q, [0, 1, 0]) };
  }

  // ---------- 조준 기준(중앙 맞추기) ----------
  let basis = null; // { r, u, f, pitch0, back }
  // 겨누는 방향: 눕혀 쥐면 폰 윗부분, 세워 쥐면(카메라처럼) 뒷면
  const pointer = (b, top, face) => (b.back ? [-face[0], -face[1], -face[2]] : top);
  function makeBasis(top, face) {
    const back = top[1] > 0.75;
    const p0 = back ? [-face[0], -face[1], -face[2]] : top;
    let f = [p0[0], 0, p0[2]];
    if (Math.hypot(f[0], f[2]) < 0.2) f = [-face[0], 0, -face[2]];
    if (Math.hypot(f[0], f[2]) < 0.2) f = [0, 0, -1];
    f = norm(f);
    return { r: norm(cross(f, [0, 1, 0])), u: [0, 1, 0], f, pitch0: Math.asin(clamp(p0[1], -1, 1)), back };
  }
  function aimOf(b, top, face) {
    const p = pointer(b, top, face);
    const v = [dot(p, b.r), dot(p, b.u), dot(p, b.f)];
    const yaw = Math.atan2(v[0], v[2]) / RD;
    const pitch = (Math.asin(clamp(v[1], -1, 1)) - b.pitch0) / RD;
    return { x: 0.5 + yaw / (2 * RANGE_X), y: 0.5 - pitch / (2 * RANGE_Y), pitch: Math.asin(clamp(v[1], -1, 1)) / RD };
  }

  // ---------- 센서 ----------
  let ori = null;
  const oriBuf = [];
  let nextAimAt = 0;
  let oriCount = 0;
  let lastOriT = 0;
  const cur = { x: 0.5, y: 0.5 }; // 지금 조준 위치(보내는 값과 같은 것)
  const pitchBuf = [];
  let lastReloadAt = -1e9;
  function evTime(e) {
    const n = performance.now();
    const ts = e && e.timeStamp;
    return ts > 0 && Math.abs(n - ts) < 1000 ? ts : n;
  }
  const streaming = () => basis && (state.phase === 'lobby' || state.phase === 'playing') && me && (mode === 'play' || mode === 'wait' || mode === 'idle');
  function onOrientation(e) {
    if (e.alpha == null && e.beta == null) return;
    const t = evTime(e);
    oriCount += 1;
    lastOriT = t;
    ori = deviceVectors(e.alpha || 0, e.beta || 0, e.gamma || 0);
    oriBuf.push({ t, top: ori.top, face: ori.face });
    while (oriBuf.length && oriBuf[0].t < t - 700) oriBuf.shift();
    if (!gotOri) {
      gotOri = true;
      fallback = false;
      sensorsChanged();
    }
    if (fallback || !basis) return;
    const a = aimOf(basis, ori.top, ori.face);
    cur.x = clamp(cur.x + (a.x - cur.x) * SMOOTH, -0.1, 1.1);
    cur.y = clamp(cur.y + (a.y - cur.y) * SMOOTH, -0.1, 1.1);
    pitchBuf.push({ t, p: a.pitch });
    while (pitchBuf.length && pitchBuf[0].t < t - FLICK_MS) pitchBuf.shift();
    checkFlick(t, a.pitch);
    if (streaming() && t >= nextAimAt) {
      nextAimAt = Math.max(nextAimAt + AIM_MS, t + AIM_MS * 0.4);
      send('aim', { x: r4(clamp(cur.x, 0, 1)), y: r4(clamp(cur.y, 0, 1)) }, true);
    }
  }
  // 폰을 아래로 확 꺾으면 장전: 짧은 시간에 겨눈 높이가 크게 내려간 경우
  function checkFlick(t, pitch) {
    if (mode !== 'play' || t - lastReloadAt < RELOAD_COOL_MS) return;
    let hi = -999;
    for (const p of pitchBuf) hi = Math.max(hi, p.p);
    if (hi - pitch >= FLICK_DEG) doReload();
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

  // ---------- 진동·번쩍임 ----------
  function buzz(pattern, kind) {
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (e) {}
    }
    if (kind) flash(kind);
  }
  function flash(kind) {
    const f = $('flash');
    f.className = '';
    void f.offsetWidth;
    f.className = `go ${kind}`;
  }

  // ---------- 사격·장전 ----------
  let ammoView = MAG; // 화면에 보이는 탄(발사하면 바로 줄이고, 큰 화면 값이 오면 맞춥니다)
  let reloadingView = false;
  function inGame() {
    return state.phase === 'playing' && myInfo() && !myInfo().down && state.stage !== 'intro' && state.stage !== 'end';
  }
  function doShoot() {
    audio();
    if (!(inGame() || (state.phase === 'lobby' && basis))) return;
    const now = performance.now();
    send('shoot', { x: r4(clamp(cur.x, 0, 1)), y: r4(clamp(cur.y, 0, 1)), ago: Math.max(0, Math.round(now - (lastOriT || now))), rtt: Math.round(rtt()) });
    if (inGame() && !reloadingView) {
      ammoView = Math.max(0, ammoView - 1);
      drawAmmo();
    }
    buzz(12, 'shot');
  }
  function doReload() {
    lastReloadAt = performance.now();
    if (state.phase === 'playing' && ammoView >= MAG) return;
    send('reload', {});
    buzz([20, 30, 20]);
  }
  function drawAmmo() {
    const box = $('ammo');
    if (box.childElementCount !== MAG) {
      box.textContent = '';
      for (let i = 0; i < MAG; i++) box.appendChild(document.createElement('i'));
    }
    [...box.children].forEach((e, i) => e.classList.toggle('on', !reloadingView && i < ammoView));
    $('btnReload').classList.toggle('need', ammoView <= 3 || reloadingView);
    $('btnReload').textContent = reloadingView ? '장전 중…' : ammoView <= 0 ? '장전!' : '장전';
  }
  // 소리는 큰 화면에서 납니다. 폰은 진동만.
  function audio() {}

  // ---------- 자세 맞추기 ----------
  function openCal() {
    mode = 'cal';
    $('btnReady').classList.remove('hidden');
    $('btnCalCancel').classList.toggle('hidden', !(basis || state.phase !== 'playing' || !myInfo()));
    $('calT').textContent = basis ? '다시 맞춥니다' : '화면 한가운데를 겨눠요';
    $('calB').textContent = '폰을 큰 화면 정중앙으로 향하고\n그대로 아래 버튼을 눌러요.\n(눕혀 쥐면 윗부분이, 세워 쥐면 뒷면이 총구예요)';
    show('vCal');
  }
  // 버튼을 누르는 순간의 흔들림을 피해, 조금 전 값의 평균을 기준으로 삼습니다.
  function captureBasis() {
    const t = performance.now();
    let src = oriBuf.filter((o) => o.t >= t - CAL_BACK_MS - CAL_SPAN_MS && o.t <= t - CAL_BACK_MS);
    if (!src.length) src = oriBuf.filter((o) => o.t >= t - 500);
    if (!src.length && ori) src = [{ top: ori.top, face: ori.face }];
    if (!src.length) return false;
    const top = norm(src.reduce((a, o) => add(a, o.top), [0, 0, 0]));
    const face = norm(src.reduce((a, o) => add(a, o.face), [0, 0, 0]));
    basis = makeBasis(top, face);
    cur.x = 0.5;
    cur.y = 0.5;
    pitchBuf.length = 0;
    nextAimAt = 0;
    announceCal();
    buzz([30, 40, 30], 'kill');
    debug(`calibrate back=${basis.back} f=${basis.f.map((x) => x.toFixed(2))} pitch0=${(basis.pitch0 / RD).toFixed(0)}`);
    return true;
  }
  function announceCal() {
    if (!send('calibrate', {})) pendingCal = true;
  }

  // ---------- 센서 없는 PC: 끌어서 조준, 버튼으로 발사 ----------
  let fakeTimer = null;
  const FAKE = { x: 0.5, y: 0.5 };
  function startFake() {
    if (fakeTimer) return;
    basis = { fake: true };
    if (me) announceCal();
    else pendingCal = true;
    fakeTimer = setInterval(() => {
      cur.x = FAKE.x;
      cur.y = FAKE.y;
      if (streaming()) send('aim', { x: r4(cur.x), y: r4(cur.y) }, true);
      drawPadDot();
    }, AIM_MS);
  }
  function drawPadDot() {
    const pad = $('pad');
    $('padDot').style.left = `${(FAKE.x * pad.clientWidth).toFixed(0)}px`;
    $('padDot').style.top = `${(FAKE.y * pad.clientHeight).toFixed(0)}px`;
  }
  function padSet(e) {
    const r = $('pad').getBoundingClientRect();
    FAKE.x = clamp((e.clientX - r.left) / r.width, 0, 1);
    FAKE.y = clamp((e.clientY - r.top) / r.height, 0, 1);
  }
  let padDown = false;
  $('pad').addEventListener('pointerdown', (e) => { padDown = true; $('pad').setPointerCapture(e.pointerId); padSet(e); });
  $('pad').addEventListener('pointermove', (e) => { if (padDown) padSet(e); });
  const padUp = () => { padDown = false; };
  $('pad').addEventListener('pointerup', padUp);
  $('pad').addEventListener('pointercancel', padUp);
  document.addEventListener('keydown', (e) => {
    if (!fallback) return;
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) doShoot(); }
    else if (e.code === 'KeyR') doReload();
    else if (e.key === 'ArrowLeft') FAKE.x = clamp(FAKE.x - 0.04, 0, 1);
    else if (e.key === 'ArrowRight') FAKE.x = clamp(FAKE.x + 0.04, 0, 1);
    else if (e.key === 'ArrowUp') FAKE.y = clamp(FAKE.y - 0.04, 0, 1);
    else if (e.key === 'ArrowDown') FAKE.y = clamp(FAKE.y + 0.04, 0, 1);
  });

  // ---------- 화면 상태 ----------
  function myInfo() {
    if (!me || !state || !state.players) return null;
    return state.players[me.slot] || state.players[String(me.slot)] || null;
  }
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
  let lastResult = null;
  let cueText = '';
  let cueTimer = null;
  function showPlay(info) {
    mode = 'play';
    $('fallback').classList.toggle('hidden', !fallback);
    $('fallbackHint').textContent = fallbackReason();
    $('score').textContent = Number(info.score || 0).toLocaleString('ko-KR');
    const hp = clamp(Number(info.hp ?? 100), 0, 100);
    $('hpT').textContent = String(hp);
    $('hpFill').style.width = `${hp}%`;
    $('hpBar').classList.toggle('low', hp <= 30 && hp > 0);
    reloadingView = Boolean(info.reloading);
    ammoView = clamp(Number(info.ammo ?? MAG), 0, MAG);
    drawAmmo();
    $('downOv').classList.toggle('on', Boolean(info.down));
    const st = $('status');
    st.className = 'status';
    const combo = info.mult > 1 ? ` · 콤보 x${info.mult}` : info.streak >= 3 ? ` · ${info.streak}연속` : '';
    if (info.down) st.textContent = '쓰러졌어요';
    else if (state.stage === 'intro') st.textContent = '곧 시작해요! 화면을 겨누고 기다려요';
    else if (state.stage === 'end') st.textContent = state.victory ? '작전 성공! 큰 화면을 보세요' : '전멸… 큰 화면을 보세요';
    else if (cueText) { st.textContent = cueText; st.classList.add('warn'); }
    else if (state.stage === 'move') st.textContent = `${state.stageName} · 이동 중`;
    else st.textContent = `웨이브 ${state.wave}/${state.waves} · 남은 좀비 ${state.foes ?? 0}${combo}`;
    show('vPlay');
  }
  function showWait(info) {
    mode = 'wait';
    const phase = state.phase;
    const chips = [];
    if (roster.length) chips.push(['참가', `${roster.length}명`]);
    if (fallback) chips.push(['조작', '버튼']);
    else if (gotOri) chips.push(['조준', basis ? '맞춤' : '아직', basis ? 'ok' : '']);
    const mineReady = me && readyList.includes(me.slot);
    $('btnGo').style.display = '';
    $('btnGo').disabled = false;
    $('btnGo').classList.remove('waiting');
    if (phase === 'over') {
      if (info === 'result' && lastResult) {
        $('waitT').textContent = lastResult.rank === 1 ? '1위!' : `${lastResult.rank}위`;
        $('waitB').textContent = `${Number(lastResult.score || 0).toLocaleString('ko-KR')}점 · 처치 ${lastResult.kills || 0} · 헤드샷 ${lastResult.headshots || 0} · 명중률 ${lastResult.accuracy || 0}%\n큰 화면에서 순위를 확인해요.`;
      } else {
        $('waitT').textContent = state.victory ? '작전 성공' : '작전 종료';
        $('waitB').textContent = '큰 화면에서 순위를 확인해요.';
      }
      $('btnGo').textContent = '다시 하기';
    } else if (phase === 'playing') {
      $('waitT').textContent = '관전 중';
      $('waitB').textContent = '지금 판이 끝나면 함께할 수 있어요.';
      $('btnGo').style.display = 'none';
    } else {
      $('waitT').textContent = '대기실';
      $('waitB').textContent = basis || fallback || !gotOri
        ? '모두 준비를 누르면 시작해요.'
        : '준비를 누르면 먼저 화면 한가운데를\n겨누고 맞춰요. 그다음 시작 대기예요.';
      $('btnGo').textContent = '준비';
    }
    if (mineReady && phase !== 'playing') {
      $('btnGo').textContent = '준비 완료 · 기다리는 중';
      $('btnGo').disabled = true;
      $('btnGo').classList.add('waiting');
    }
    setChips(chips, 'waitChips');
    const canCal = gotOri && !fallback;
    $('btnCalLobby').classList.toggle('hidden', !canCal);
    $('btnCalLobby').textContent = basis ? '조준 다시 맞추기' : '조준 맞추기';
    const canPractice = Boolean(basis) && phase === 'lobby';
    $('btnPractice').classList.toggle('hidden', !canPractice);
    $('fallback').classList.toggle('hidden', !(fallback && phase === 'lobby'));
    $('fallbackHint').textContent = fallbackReason();
    $('practice').textContent = canPractice ? '겨누고 쏘면 화면의 연습 좀비를 맞힐 수 있어요.' : '';
    show('vWait');
  }
  function render() {
    if (!me) return;
    if (mode === 'start' || mode === 'connecting' || mode === 'msg') return;
    if (mode === 'cal') return;
    const info = myInfo();
    // 버튼 모드는 기준이 정해져 있어 맞추기 없이 바로 준비 완료입니다.
    if (fallback) startFake();
    if (state.phase === 'playing' && info) {
      if (!basis && gotOri && !fallback) {
        openCal();
        return;
      }
      showPlay(info);
      return;
    }
    showWait(state.phase === 'over' && lastResult ? 'result' : info);
  }
  function fallbackReason() {
    let why = '동작 센서가 없어 버튼으로 해요.';
    if (!window.isSecureContext) why = 'https 주소가 아니라 동작 센서가 꺼져 있어요. 버튼으로 해요.';
    else if (permDenied) why = '동작 권한이 거절돼 버튼으로 해요.';
    else if (isTouch) why = '동작 센서 값이 없어 버튼으로 해요. Android 는 주소창 자물쇠 → 사이트 설정 → 동작 센서를 허용해 주세요.';
    return `${why} (키보드: Space 발사 · R 장전 · 방향키)`;
  }
  function sensorsChanged() {
    // 센서가 늦게 살아나면 시험 모드를 멈추고, 진짜 자세로 다시 맞추게 합니다.
    if (!fallback && fakeTimer) {
      clearInterval(fakeTimer);
      fakeTimer = null;
      if (basis && basis.fake) basis = null;
    }
    if (helpOn && mode === 'msg' && !fallback) {
      helpOn = false;
      join();
      return;
    }
    render();
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
    if (!p || p.game !== 'gun') {
      const code = encodeURIComponent((p && p.code) || ROOM);
      location.replace(`${PLAY_URL(p && p.game ? p.game : 'baseball')}?room=${code}`);
      return;
    }
    me = p;
    noRoomTries = 0;
    document.documentElement.style.setProperty('--c', p.color);
    $('me').textContent = p.name;
    if (pendingCal && basis) {
      pendingCal = false;
      send('calibrate', {});
    }
    if (mode === 'connecting' || (mode === 'msg' && !helpOn)) mode = 'idle';
    render();
  });
  socket.on('players', (payload) => {
    roster = payload && Array.isArray(payload.players) ? payload.players : [];
    if (mode === 'wait') render();
  });
  socket.on('ready_state', (st) => {
    readyList = st && Array.isArray(st.ready) ? st.ready : [];
    if (mode === 'wait') render();
  });
  socket.on('display_status', ({ connected } = {}) => {
    displayOn = Boolean(connected);
    banner(connected ? '' : '큰 화면이 꺼져 있어요. 다시 열리면 이어서 해요.');
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
  socket.on('room_full', () => message('8명이 꽉 찼어요', '빈자리가 생기면 다시 찍어 주세요.'));
  socket.on('replaced', () => message('다른 탭에서 열었어요', '마지막으로 연 화면에서 조작해요.'));
  socket.on('room_closed', () => message('방이 닫혔어요', '큰 화면의 새 QR을 찍어 주세요.'));

  socket.on('game_state', (s) => {
    const prev = state;
    state = s && typeof s === 'object' ? s : { phase: 'lobby' };
    if (state.phase === 'playing' && prev.phase !== 'playing') {
      lastResult = null;
      readyList = [];
    }
    const info = myInfo();
    const prevInfo = prev.players && me ? prev.players[me.slot] : null;
    if (info && prevInfo && info.down && !prevInfo.down) buzz([200, 80, 300], 'hurt');
    render();
  });
  // 큰 화면의 알림(웨이브 시작·보스 등): 상태 줄에 잠깐 보여 줍니다.
  socket.on('cue', (c) => {
    cueText = c && c.text ? String(c.text) : '';
    clearTimeout(cueTimer);
    cueTimer = setTimeout(() => { cueText = ''; if (mode === 'play') render(); }, 2600);
    buzz(35);
    if (mode === 'play') render();
  });
  socket.on('hit', (h) => {
    const kind = h && h.kind;
    if (kind === 'hit') buzz(18);
    else if (kind === 'head') buzz([30, 20, 60], 'head');
    else if (kind === 'kill') buzz([40, 30, 80], 'kill');
    else if (kind === 'hurt') buzz([120, 50, 200], 'hurt');
    else if (kind === 'empty') buzz(15);
    else if (kind === 'reload') buzz([20, 40, 20]);
    else if (kind === 'medkit') buzz([40, 30, 40], 'kill');
  });
  socket.on('result', (r) => {
    lastResult = r || null;
    if (r && r.rank === 1) buzz([80, 60, 80, 60, 240], 'kill');
    render();
  });

  // ---------- 버튼 ----------
  $('btnStart').addEventListener('click', async () => {
    if (mode !== 'start') return;
    mode = 'connecting';
    $('btnStart').disabled = true;
    // iPhone 은 탭 안에서, await 전에 화면 꺼짐 방지와 권한을 함께 요청해야 합니다.
    keepAwake();
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
    if (!ROOM) {
      message('방 코드가 없어요', '큰 화면의 QR을 찍어 주세요.');
      return;
    }
    if (permDenied && isTouch && !DEBUG) {
      sensorHelp();
      return;
    }
    join();
    setTimeout(() => {
      if (gotOri) return;
      if (isTouch && !DEBUG && window.isSecureContext) {
        fallback = true;
        sensorHelp();
        return;
      }
      fallback = true;
      debug('동작 센서 값이 들어오지 않아 버튼으로 해요');
      sensorsChanged();
    }, SENSOR_WAIT_MS);
  });
  // 준비: 조준을 아직 안 맞췄으면 맞추고 나서 바로 준비 완료로 넘어갑니다.
  $('btnGo').addEventListener('click', () => {
    keepAwake();
    if (!basis && gotOri && !fallback) {
      pendingReady = true;
      openCal();
      return;
    }
    send('start_game', {});
  });
  $('btnCalLobby').addEventListener('click', () => openCal());
  $('btnRecal').addEventListener('click', () => {
    // 경기 중: 화면을 안 바꾸고 지금 겨눈 곳을 바로 중앙으로
    if (captureBasis()) {
      const st = $('status');
      st.textContent = '조준을 다시 맞췄어요';
    }
  });
  $('btnReady').addEventListener('click', () => {
    if (!gotOri) {
      $('calB').textContent = '방향 센서 값이 들어오지 않아요.\n잠시 뒤 다시 눌러 주세요.';
      return;
    }
    if (!captureBasis()) {
      $('calB').textContent = '방향 센서 값이 끊겼어요.\n다시 눌러 주세요.';
      return;
    }
    mode = 'idle';
    if (pendingReady) {
      pendingReady = false;
      send('start_game', {});
    }
    render();
  });
  $('btnCalCancel').addEventListener('click', () => {
    pendingReady = false;
    mode = 'idle';
    render();
  });
  for (const id of ['btnTrigger', 'btnPractice']) {
    $(id).addEventListener('pointerdown', (e) => {
      e.preventDefault();
      doShoot();
    });
  }
  $('btnReload').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    doReload();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (mode !== 'start') keepAwake();
    render();
  });

  if (!window.isSecureContext) $('httpNote').classList.remove('hidden');

  // ---------- 디버그 (&debug) ----------
  function debug(t) {
    if (DEBUG) $('debug').textContent = t;
  }
  if (DEBUG) {
    let lastO = 0;
    setInterval(() => {
      debug(`ori ${(oriCount - lastO) * 2}Hz rtt ${Math.round(rtt())}ms aim ${cur.x.toFixed(2)},${cur.y.toFixed(2)} ` +
        `basis ${basis ? (basis.back ? 'back' : 'top') : 'N'} mode ${mode} fallback ${fallback ? 'Y' : 'N'}`);
      lastO = oriCount;
    }, 500);
  }
  window.__gunPhone = { get state() { return state; }, get mode() { return mode; }, get basis() { return basis; }, cur, doShoot, doReload, onOrientation, deviceVectors, makeBasis, aimOf };
})();
