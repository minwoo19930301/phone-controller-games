// 카트 컨트롤러. 폰을 가로로 세워 핸들처럼 기울이고(roll), 왼쪽 브레이크·오른쪽 액셀 두 버튼만 씁니다.
// 핸들 각도: deviceorientation 의 beta/gamma 로 "세계의 위쪽" 벡터를 폰 화면 평면(x 오른쪽, y 위)에 옮기고, 그 벡터의 회전각을 영점에 대해 잽니다.
// 화면 평면 안의 회전은 화면 방향(가로 왼쪽/오른쪽)이 달라도 같은 부호라서 가로 방향을 따로 구분하지 않아도 됩니다.
// 핸들을 오른쪽(시계 방향)으로 돌리면 +, 왼쪽이면 -. drive { steer(-1..1), gas(0/1), brake(0/1) } 를 30Hz 로 보냅니다(밀리면 버려도 되는 이벤트).
(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const ROOM = (params.get('room') || '').toUpperCase();
  const DEBUG = params.has('debug');

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

  let me = null;
  let state = { phase: 'lobby' };
  let result = null;
  let mode = 'start'; // start | connecting | msg | wait | cal | play
  let noRoomTries = 0;
  let readyPressed = false;
  let backTo = 'wait'; // 핸들 맞추기를 끝내고 돌아갈 곳

  const NEED_LAND = new Set(['wait', 'cal', 'play']);
  function show(id) {
    for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === id);
    document.body.classList.toggle('need-land', NEED_LAND.has(mode));
  }
  function message(t, b) {
    mode = 'msg';
    $('msgT').textContent = t;
    $('msgB').textContent = b || '';
    show('vMsg');
  }
  const buzz = (p) => { if (navigator.vibrate) { try { navigator.vibrate(p); } catch (e) {} } };
  function keepAwake() {
    if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
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
  function tone(freq, sec, gain, type = 'sine', when = 0) {
    const a = actx;
    if (!a || a.state !== 'running') return;
    const t = a.currentTime + when;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + sec + 0.02);
  }

  // ---------- 핸들 센서 ----------
  const TAU = Math.PI * 2;
  const wrap = (a) => {
    a %= TAU;
    if (a > Math.PI) a -= TAU;
    else if (a < -Math.PI) a += TAU;
    return a;
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const RANGE_DEG = 38; // 이만큼 돌리면 끝까지 꺾음
  const DEAD_DEG = 2.5; // 이 안은 직진
  let ang = 0; // 지금 위쪽 벡터의 각도
  let flat = true; // 폰이 눕혀져 있어 각도를 믿을 수 없음
  let zero = null; // 영점 각도(null 이면 아직 안 맞춤)
  const recent = []; // 최근 각도(영점용)
  let gotSensor = false;
  let fallback = false;
  let oriCount = 0;
  let steerSmooth = 0;
  let steerDeg = 0;
  let slideVal = 0; // 센서가 없을 때 화면에서 민 값
  const keys = { left: false, right: false, up: false, down: false };

  function onOrientation(e) {
    if (e.beta == null || e.gamma == null) return;
    gotSensor = true;
    if (fallback) { fallback = false; $('mid').classList.remove('fallback'); } // 늦게라도 센서 값이 오면 슬라이더를 끕니다
    oriCount++;
    const b = (e.beta * Math.PI) / 180;
    const g = (e.gamma * Math.PI) / 180;
    // 세계 위쪽을 폰 좌표(x 오른쪽, y 화면 위)로 본 값
    const ux = -Math.sin(g) * Math.cos(b);
    const uy = Math.sin(b);
    const m = Math.hypot(ux, uy);
    flat = m < 0.33; // 거의 눕혀진 상태(20° 안쪽)
    if (flat) return;
    ang = Math.atan2(uy, ux);
    recent.push(ang);
    if (recent.length > 10) recent.shift();
  }
  function circMean(list) {
    let s = 0;
    let c = 0;
    for (const a of list) { s += Math.sin(a); c += Math.cos(a); }
    return Math.atan2(s, c);
  }
  function setZero() {
    if (!recent.length) return false;
    zero = circMean(recent);
    send('calibrate', {});
    return true;
  }
  // 화면 방향이 바뀌면 영점이 틀어집니다. 180° 돌면 영점을 같이 돌리고, 90° 돌면 지금 자세를 새 영점으로 삼습니다.
  let lastScreenAngle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  function onScreenRotate() {
    const a = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    const d = (((a - lastScreenAngle) % 360) + 360) % 360;
    lastScreenAngle = a;
    if (zero == null || d === 0) return;
    if (d === 180) zero = wrap(zero + Math.PI);
    else setTimeout(() => { if (mode === 'play' || mode === 'wait') setZero(); }, 700);
  }
  if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', onScreenRotate);
  else window.addEventListener('orientationchange', onScreenRotate);

  /** 지금 핸들 값(-1..1). 센서 → 화면 슬라이더 → 키보드 순. */
  function readSteer() {
    let target = 0;
    const kb = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (kb) {
      target = kb;
      steerDeg = kb * RANGE_DEG;
    } else if (fallback) {
      target = slideVal;
      steerDeg = slideVal * RANGE_DEG;
    } else if (gotSensor && zero != null) {
      if (!flat) {
        const deg = (wrap(ang - zero) * 180) / Math.PI;
        steerDeg = clamp(deg, -70, 70);
      }
      const a = Math.abs(steerDeg);
      const x = clamp((a - DEAD_DEG) / (RANGE_DEG - DEAD_DEG), 0, 1);
      target = Math.sign(steerDeg) * Math.pow(x, 1.2);
    } else {
      steerDeg = 0;
    }
    steerSmooth += (target - steerSmooth) * 0.55;
    if (Math.abs(steerSmooth) < 0.005) steerSmooth = 0;
    return steerSmooth;
  }

  // ---------- 서버까지 왕복 시간 ----------
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
  const rtt = () => {
    if (!rtts.length) return 0;
    const s = [...rtts].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  // ---------- 페달 ----------
  const pedal = { gas: 0, brake: 0 };
  let sentCount = 0;
  let lastSig = '';
  function sendDrive(force) {
    if (mode !== 'play') return;
    const steer = +readSteer().toFixed(3);
    const sig = `${steer}|${pedal.gas}|${pedal.brake}`;
    if (!force && sig === lastSig && sentCount % 6) { sentCount++; return; } // 같은 값은 6번에 한 번만(끊김 감지용 하트비트)
    lastSig = sig;
    if (send('drive', { steer, gas: pedal.gas, brake: pedal.brake, t: Math.round(performance.now() * 10) / 10 }, true)) sentCount++;
  }
  setInterval(() => sendDrive(false), 33);

  function bindPedal(el, key) {
    const ids = new Set();
    const set = () => {
      const on = ids.size > 0;
      pedal[key] = on ? 1 : 0;
      el.classList.toggle('down', on);
      sendDrive(true);
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      audio();
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      ids.add(e.pointerId);
      buzz(6);
      set();
    });
    const up = (e) => {
      if (!ids.delete(e.pointerId)) return;
      set();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  bindPedal($('pBrake'), 'brake');
  bindPedal($('pGas'), 'gas');
  function releaseAll() {
    pedal.gas = 0;
    pedal.brake = 0;
    $('pGas').classList.remove('down');
    $('pBrake').classList.remove('down');
  }

  // 센서가 없을 때: 가운데 슬라이더를 밀어서 조향
  const slide = $('slide');
  let slidePid = null;
  function slideMove(e) {
    const r = slide.getBoundingClientRect();
    slideVal = clamp(((e.clientX - r.left) / r.width - 0.5) * 2.2, -1, 1);
    $('slideKnob').style.left = `${50 + slideVal * 42}%`;
  }
  slide.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    slidePid = e.pointerId;
    try { slide.setPointerCapture(e.pointerId); } catch (err) {}
    slideMove(e);
  });
  slide.addEventListener('pointermove', (e) => { if (e.pointerId === slidePid) slideMove(e); });
  const slideUp = (e) => {
    if (e.pointerId !== slidePid) return;
    slidePid = null;
    slideVal = 0;
    $('slideKnob').style.left = '50%';
  };
  slide.addEventListener('pointerup', slideUp);
  slide.addEventListener('pointercancel', slideUp);

  // 경기 중 가운데를 길게 누르면 영점을 다시 맞춥니다.
  let holdTimer = null;
  const mid = $('mid');
  mid.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#slide')) return;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      if (setZero()) {
        buzz([20, 30, 20]);
        $('sub').textContent = '핸들 영점을 다시 맞췄어요';
        tone(880, 0.12, 0.1, 'triangle');
      }
    }, 800);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) mid.addEventListener(ev, () => clearTimeout(holdTimer));

  // 키보드(PC 시험): ←→ 핸들, ↑·W 액셀, ↓·S 브레이크
  const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down' };
  window.addEventListener('keydown', (e) => {
    const k = KEYMAP[e.code];
    if (!k || mode !== 'play') return;
    e.preventDefault();
    keys[k] = true;
    if (k === 'up') { pedal.gas = 1; $('pGas').classList.add('down'); }
    if (k === 'down') { pedal.brake = 1; $('pBrake').classList.add('down'); }
  });
  window.addEventListener('keyup', (e) => {
    const k = KEYMAP[e.code];
    if (!k) return;
    keys[k] = false;
    if (k === 'up') { pedal.gas = 0; $('pGas').classList.remove('down'); }
    if (k === 'down') { pedal.brake = 0; $('pBrake').classList.remove('down'); }
  });

  // ---------- 화면 갱신 ----------
  const wheel = $('wheel');
  const calWheel = $('calWheel');
  function paintSteer() {
    const v = steerSmooth;
    const deg = clamp(steerDeg, -90, 90);
    if (mode === 'play') {
      // 폰이 돌아간 만큼 반대로 돌려 그리면 헷갈리니, 조향 방향 그대로 핸들 그림을 돌립니다.
      wheel.style.transform = `rotate(${deg}deg)`;
      $('bar').style.left = `${50 + v * 45}%`;
    } else if (mode === 'cal') {
      calWheel.style.transform = `rotate(${deg}deg)`;
      $('calBar').style.left = `${50 + v * 45}%`;
    }
    requestAnimationFrame(paintSteer);
  }
  requestAnimationFrame(paintSteer);

  function mine() {
    return me && state.players ? state.players[me.slot] : null;
  }
  function statusText() {
    const p = mine();
    if (!p) return '';
    return p.fin ? `${p.rank}등으로 들어왔어요` : `${p.rank}등 · ${p.lap}/${state.laps || 3}바퀴`;
  }
  function render() {
    if (!me) return;
    const phase = state.phase;
    const p = mine();
    if (mode === 'cal') return; // 맞추는 중에는 화면을 바꾸지 않습니다
    if (phase === 'playing' && p) {
      if (mode !== 'play') {
        mode = 'play';
        show('vPlay');
        keepAwake();
      }
      $('status').textContent = state.sub === 'countdown' ? '곧 출발!' : statusText();
      return;
    }
    if (mode === 'play') releaseAll();
    mode = 'wait';
    const bigEl = $('waitBig');
    bigEl.classList.add('hidden');
    $('btnReady').style.display = '';
    if (phase === 'over') {
      const r = (p && p.rank) || (result && result.rank) || 0;
      const total = (p && p.n) || (result && result.total) || 4;
      bigEl.classList.remove('hidden');
      bigEl.classList.toggle('win', r === 1);
      bigEl.textContent = r ? `${r}등` : '';
      $('waitT').textContent = r === 1 ? '우승!' : r ? `${total}대 중 ${r}등` : '경기 끝';
      const t = result && result.finished ? `기록 ${fmt(result.time)}${result.best ? ` · 베스트 랩 ${fmt(result.best)}` : ''}` : '완주하지 못했어요';
      $('waitB').textContent = `${t}\n큰 화면에서 전체 결과를 확인하세요.`;
      $('btnReady').textContent = '다시 하기';
    } else if (phase === 'playing') {
      $('waitT').textContent = '경기 중';
      $('waitB').textContent = '지금 경기가 끝나면 다음 판부터 함께해요.';
      $('btnReady').style.display = 'none';
    } else {
      $('waitT').textContent = '대기실';
      $('waitB').textContent = '폰을 가로로 세우고 핸들 맞추기를 한 번 해 보세요.\n모두 준비를 누르면 시작해요.';
      $('btnReady').textContent = '준비';
    }
    paintReady();
    show('vWait');
  }
  function fmt(ms) {
    const t = Math.floor(ms / 100) / 10;
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
  }
  function paintReady() {
    const b = $('btnReady');
    b.classList.toggle('waiting', readyPressed);
    b.disabled = readyPressed;
    if (readyPressed) b.textContent = '준비 완료 · 기다리는 중';
    else b.textContent = state.phase === 'over' ? '다시 하기' : '준비';
  }

  // ---------- 소켓 ----------
  socket.on('connect', () => socket.emit('join', { role: 'controller', room: ROOM, token }));
  socket.on('assigned', (p) => {
    if (p.game !== 'kart') {
      location.replace(p.game === 'baseball' ? `/play/?room=${ROOM}` : `/play/${p.game}/?room=${ROOM}`);
      return;
    }
    me = p;
    noRoomTries = 0;
    document.documentElement.style.setProperty('--c', p.color);
    $('me').textContent = p.name;
    $('meP').textContent = p.name;
    if (mode === 'msg' || mode === 'connecting') {
      mode = 'wait';
      // 처음 들어오면 핸들부터 맞춥니다.
      if (zero == null && state.phase !== 'playing') { openCal('wait'); return; }
    }
    render();
  });
  socket.on('no_room', () => {
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
    const b = $('banner');
    b.textContent = '큰 화면 연결이 끊겼어요. 다시 열리면 이어서 해요.';
    b.classList.toggle('hidden', Boolean(d && d.connected));
  });
  socket.on('disconnect', () => {
    if (mode === 'play') $('sub').textContent = '연결이 잠깐 끊겼어요…';
  });
  socket.on('game_state', (s) => {
    const prev = state.phase;
    state = s || { phase: 'lobby' };
    if (state.phase !== prev && (state.phase === 'playing' || state.phase === 'lobby')) {
      readyPressed = false;
      if (state.phase === 'playing') result = null;
    }
    if (mode === 'msg' && !me) return;
    render();
  });
  // 모두 준비 상태: 서버가 알려 주는 값을 따라 버튼 모양을 맞춥니다.
  socket.on('ready_state', (st) => {
    if (!me || !st) return;
    readyPressed = Boolean(st.ready && st.ready.includes(me.slot));
    if (mode === 'wait') paintReady();
  });
  socket.on('result', (r) => {
    result = r;
    if (mode === 'wait') render();
  });
  socket.on('cue', (c) => {
    if (!c) return;
    const cd = $('cd');
    const flash = $('flash');
    if (c.type === 'count') {
      cd.textContent = c.n;
      cd.classList.remove('on');
      void cd.offsetWidth;
      cd.classList.add('on');
      buzz(20);
      tone(520, 0.12, 0.1, 'square');
    } else if (c.type === 'go') {
      cd.textContent = 'GO!';
      cd.classList.remove('on');
      void cd.offsetWidth;
      cd.classList.add('on');
      setTimeout(() => cd.classList.remove('on'), 900);
      flash.classList.remove('go');
      void flash.offsetWidth;
      flash.classList.add('go');
      buzz(90);
      tone(1040, 0.3, 0.12, 'square');
    } else if (c.type === 'bump') {
      buzz(Math.min(120, 25 + (c.power || 0) * 4));
    } else if (c.type === 'boost') {
      buzz([30, 20, 60]);
      $('sub').textContent = '부스트!';
    } else if (c.type === 'lap') {
      buzz([40, 40, 40]);
      $('sub').textContent = `${c.lap}바퀴째`;
    } else if (c.type === 'finish') {
      buzz([80, 50, 80, 50, 200]);
      cd.textContent = '완주!';
      cd.classList.remove('on');
      void cd.offsetWidth;
      cd.classList.add('on');
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, 0.12, 'triangle', i * 0.1));
    }
  });

  // ---------- 버튼 ----------
  function openCal(back) {
    backTo = back || 'wait';
    mode = 'cal';
    $('calT').textContent = zero == null ? '핸들 맞추기' : '핸들 다시 맞추기';
    show('vCal');
  }
  $('btnCal').addEventListener('click', () => { audio(); openCal('wait'); });
  $('btnZero').addEventListener('click', () => {
    audio();
    if (fallback && !gotSensor) {
      $('calB').textContent = '동작 센서가 없어서 맞출 게 없어요.\n경기 중에는 화면 가운데를 밀어서 조향해요.';
      return;
    }
    if (flat) {
      $('calB').textContent = '폰이 너무 눕혀져 있어요.\n핸들처럼 세워서 다시 눌러 주세요.';
      return;
    }
    if (setZero()) {
      buzz([20, 30, 20]);
      tone(880, 0.12, 0.1, 'triangle');
      $('calB').textContent = '맞췄어요! 좌우로 기울여 보고\n핸들 그림이 따라 돌면 완료를 누르세요.';
    } else {
      $('calB').textContent = '센서 값이 아직 안 들어와요. 잠시 뒤에 다시 눌러 주세요.';
    }
  });
  $('btnCalDone').addEventListener('click', () => {
    audio();
    if (zero == null && gotSensor && !flat) setZero(); // 누르지 않고 완료해도 지금 자세를 영점으로
    mode = backTo;
    $('calB').textContent = '폰을 가로로 세워, 핸들을 똑바로 잡은 자세에서\n영점 맞추기를 누르세요. 그 자세가 직진이에요.';
    render();
  });
  $('btnReady').addEventListener('click', () => {
    keepAwake();
    audio();
    if (zero == null && gotSensor && !flat) setZero(); // 아직 한 번도 안 맞췄다면 지금 자세가 직진
    readyPressed = true;
    paintReady();
    send('start_game', {});
  });
  $('btnStart').addEventListener('click', async () => {
    if (mode !== 'start') return;
    mode = 'connecting';
    $('btnStart').disabled = true;
    audio();
    // 가로 고정(되는 기기만). 안 돼도 세로일 때 돌려 달라는 안내가 뜹니다.
    try {
      const fs = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      Promise.resolve(fs).then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape')).catch(() => {});
    } catch (e) {}
    // iPhone 은 탭 안에서, await 전에 권한을 물어야 합니다.
    let denied = false;
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        denied = (await DeviceOrientationEvent.requestPermission()) !== 'granted';
      } catch (e) {
        denied = true;
      }
    }
    window.addEventListener('deviceorientation', onOrientation);
    keepAwake();
    if (!ROOM) {
      message('방 코드가 없어요', '큰 화면의 QR을 찍어 주세요.');
      return;
    }
    $('msgT').textContent = '들어가는 중…';
    $('msgB').textContent = '큰 화면과 연결하고 있어요.';
    mode = 'connecting';
    show('vMsg');
    socket.connect();
    // 센서 값이 안 들어오면(권한 거절·http·PC) 화면 슬라이더로 조향합니다.
    setTimeout(() => {
      if (gotSensor && !denied) return;
      fallback = true;
      $('mid').classList.add('fallback');
      $('banner').textContent = '동작 센서를 쓸 수 없어서 화면 가운데를 밀어 조향해요.';
      $('banner').classList.remove('hidden');
      setTimeout(() => $('banner').classList.add('hidden'), 5000);
    }, 2500);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { releaseAll(); sendDrive(true); }
    else if (mode !== 'start') keepAwake();
  });
  window.addEventListener('blur', () => { releaseAll(); });
  if (!window.isSecureContext) $('httpNote').classList.remove('hidden');

  // ---------- 디버그 (&debug) ----------
  if (DEBUG) {
    let lastO = 0;
    setInterval(() => {
      $('debug').textContent = `ori ${(oriCount - lastO) * 2}Hz rtt ${Math.round(rtt())}ms ang ${((ang * 180) / Math.PI).toFixed(0)} zero ${zero == null ? '-' : ((zero * 180) / Math.PI).toFixed(0)} ` +
        `steer ${steerSmooth.toFixed(2)} flat ${flat ? 'Y' : 'N'} mode ${mode} fb ${fallback ? 'Y' : 'N'}`;
      lastO = oriCount;
    }, 500);
  }
  // 시험용: 콘솔에서 센서 없이 값을 넣어 볼 수 있습니다.
  window.__kartPad = { state: () => state, me: () => me, onOrientation, setZero, pedal, readSteer, mode: () => mode };
})();
