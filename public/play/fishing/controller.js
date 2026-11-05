// 배스 낚시 컨트롤러. 폰이 낚싯대입니다.
// 뒤로 젖혔다가 앞으로 휙 던지면 캐스팅, 찌가 들어가면 위로 확 들어 올려 챔질, 화면의 릴 핸들을 돌려 감습니다.
// 좌표는 '준비' 때 정한 기준축으로 보냅니다: r = 내 오른쪽, u = 위, f = 폰 윗부분이 TV 를 보던 방향.
(() => {
  const $ = (id) => document.getElementById(id);
  const RD = Math.PI / 180;
  const TAU = Math.PI * 2;
  const params = new URLSearchParams(location.search);
  const ROOM = (params.get('room') || '').toUpperCase();
  const DEBUG = params.has('debug');
  $('room').textContent = ROOM ? `방 ${ROOM}` : '';

  // ---------- 조정 값(실폰 검증 전이라 바뀔 수 있습니다) ----------
  const POSE_MS = 25; // pose 전송 간격, 약 40Hz
  const SENSOR_WAIT_MS = 1500; // 이 시간 안에 동작 센서 값이 없으면 버튼 모드
  const CAL_GUARD_MS = 600; // 자세를 맞춘 직후 흔들림은 무시
  const ARM_DEG = 40; // 기준 자세보다 이만큼 뒤로 젖히면 캐스팅 준비
  const RELEASE_DEG = 22; // 다시 이 각도 아래로 내려오면 던짐
  const CAST_MIN_DPS = 240; // 내려올 때 회전 속도가 이 이상이어야 캐스팅
  const CAST_FULL_DPS = 1100; // 이 회전 속도면 최대 힘
  const HOOK_DPS = 200; // 챔질로 보는 회전 속도
  const HOOK_RISE = 90; // 그리고 낚싯대 끝이 이 속도(도/초) 이상으로 올라가야 함
  const HOOK_RISE_NOGYRO = 250; // 자이로가 없는 폰은 낚싯대 끝이 올라가는 속도만으로 챔질을 봅니다
  const HOOK_WIN_MS = 90;
  const REEL_MS = 66; // 감기 전송 간격(약 15Hz)
  const AIM_MAX = 35;
  const STREAM_STAGES = ['ready', 'cast', 'wait', 'bite', 'fight', 'landed'];

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
  let stateAt = performance.now();
  let mode = 'start'; // start | connecting | msg | wait | cal | count | play
  let gotOri = false;
  let gotMotion = false;
  let hasGyro = false;
  let fallback = false;
  let permDenied = false;
  let sensorHelpOn = false; // 센서 안내 화면은 사용자가 고르거나 센서 값이 들어올 때까지 유지합니다
  let pendingCal = false;
  let noRoomTries = 0;

  function show(id) {
    for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === id);
    $('btnRecal').classList.toggle('hidden', !(id === 'vPlay' && gotOri && !fallback));
  }
  function message(t, b) {
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
    return p ? p.stage : null;
  }
  function myInfo() {
    if (!me || !state || !state.players) return null;
    return state.players[me.slot] || state.players[String(me.slot)] || null;
  }
  const playing = () => state.phase === 'playing' && Boolean(myInfo());

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
    if (playing() && STREAM_STAGES.includes(myStage()) && t >= nextPoseAt) {
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
  const cast = { state: 'idle', eMax: 0, topAt: 0, peak: 0, armedAt: 0, blockUntil: 0, msg: '' };
  function canCast(t) {
    const st = myStage();
    return playing() && (st === 'ready' || st === 'wait') && t - calAt > CAL_GUARD_MS && t > cast.blockUntil && mode === 'play';
  }
  function castCheck(t, el, s) {
    if (!basis || !canCast(t)) {
      cast.state = 'idle';
      return;
    }
    const armAt = Math.max(basis.e0 + ARM_DEG, 50);
    if (cast.state === 'idle') {
      if (el > armAt) {
        cast.state = 'armed';
        cast.eMax = el;
        cast.topAt = t;
        cast.peak = 0;
        cast.armedAt = t;
        if (navigator.vibrate) navigator.vibrate(12);
        tick(900);
      }
      return;
    }
    if (el > cast.eMax) {
      cast.eMax = el;
      cast.topAt = t;
    }
    if (!hasGyro) cast.peak = Math.max(cast.peak, -eRate(t));
    if (el < basis.e0 + RELEASE_DEG) {
      cast.state = 'idle';
      // 가장 높이 젖힌 뒤(내려오는 동안)의 회전만 셉니다. 위로 챈 동작의 회전이 캐스팅 힘으로 잡히지 않게 합니다.
      const peak = hasGyro ? Math.max(cast.peak, rotPeak(Math.max(t - 350, cast.topAt))) : cast.peak;
      if (peak < CAST_MIN_DPS) {
        // 챔질 직후 천천히 내린 것이면 캐스팅 안내를 띄우지 않습니다.
        if (t - lastHook < 1200) return;
        cast.msg = '조금 더 빠르게 휙!';
        drawCastHint();
        return;
      }
      const sweep = clamp01((cast.eMax - el) / 110);
      const p = clamp01((peak - CAST_MIN_DPS) / (CAST_FULL_DPS - CAST_MIN_DPS));
      const power = clamp(0.12 + 0.88 * (0.75 * p + 0.25 * sweep), 0.1, 1);
      const aim = clamp(yawOf(s), -AIM_MAX, AIM_MAX);
      deliverCast(power, aim, peak);
    }
  }
  function deliverCast(power, aim, peak) {
    if (!send('cast', { power: round(power, 3), aim: round(aim, 1), rtt: Math.round(rtt()) })) return;
    cast.msg = `${Math.round(power * 100)}% 힘으로 던졌어요`;
    whoosh(power);
    if (navigator.vibrate) navigator.vibrate(30);
    debug(`cast power ${power.toFixed(2)} aim ${aim.toFixed(1)} peak ${Math.round(peak || 0)}`);
    drawCastHint();
  }

  // ---------- 챔질: 위로 확 ----------
  let hookWin = null;
  let lastHook = -1e9;
  function hookCheck(t) {
    if (hookWin || !basis || mode !== 'play') return;
    const st = myStage();
    if (!playing() || (st !== 'wait' && st !== 'bite')) return;
    if (t - lastHook < 700 || t - calAt < CAL_GUARD_MS) return;
    let hit;
    let rise;
    if (hasGyro) {
      if (rotNow < HOOK_DPS) return;
      rise = eRate(t);
      hit = rise > HOOK_RISE || (st === 'bite' && rotNow > 320 && rise > -60);
    } else {
      rise = eRate(t);
      hit = rise > HOOK_RISE_NOGYRO;
    }
    if (hit) {
      hookWin = { t0: t, st, speed: hasGyro ? 0 : rise };
      setTimeout(finishHook, HOOK_WIN_MS);
    }
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
    if (!send('hookset', { speed: Math.round(speed), ago, rtt: Math.round(rtt()) })) return;
    // 입질 중 챔질 뒤에 이어지는 동작은 캐스팅으로 보지 않습니다.
    if (st === 'bite') cast.blockUntil = performance.now() + 1500;
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
    if (rr < 0.15 || Math.abs(d) > 1.3) return;
    if (!dial.lock) {
      dial.acc += d;
      if (Math.abs(dial.acc) > 1.05) {
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
  function audio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
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
  const click = () => noise(0.018, 3600, 3, 0.22);
  const whoosh = (p) => {
    noise(0.4 + p * 0.25, 600, 0.8, 0.25 + p * 0.3, { sweep: 2800, attack: 0.06 });
    for (let i = 0; i < 9; i++) noise(0.025, 5000, 4, 0.08, { at: 0.15 + i * (0.05 + p * 0.03) });
  };
  const whip = () => noise(0.12, 1800, 0.9, 0.35, { sweep: 500 });
  const plop = () => { tone(500, 0.12, 0.3, 'sine', 170); noise(0.3, 900, 0.6, 0.18, { attack: 0.01 }); };
  const nibbleSnd = () => tone(620, 0.06, 0.25, 'sine', 480);
  const biteSnd = () => { tone(90, 0.7, 0.4, 'sawtooth', 55); noise(0.6, 500, 0.7, 0.3, { attack: 0.02 }); };
  const hookedSnd = () => { tone(160, 0.25, 0.4, 'triangle', 70); tone(1400, 0.2, 0.15, 'triangle', 2200, 0.05); };
  const snapSnd = () => { noise(0.06, 5000, 0.6, 0.6, { type: 'highpass' }); tone(1700, 0.12, 0.2, 'square', 300); };
  const splashSnd = () => noise(0.5, 900, 0.5, 0.35, { attack: 0.01 });
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
  function buzz(pattern, flashKind) {
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (e) {}
    }
    // iPhone 은 진동이 없어 화면을 번쩍입니다.
    if (flashKind) {
      const f = $('flash');
      f.className = '';
      void f.offsetWidth;
      f.className = flashKind === 'bite' ? 'bite' : 'go';
    }
  }

  // ---------- 자세 맞추기 ----------
  let countTimer = null;
  function openCal() {
    clearInterval(countTimer);
    mode = 'cal';
    $('calN').classList.add('hidden');
    $('btnReady').classList.remove('hidden');
    $('btnCalCancel').classList.toggle('hidden', !(basis || state.phase !== 'playing' || !myInfo()));
    $('calT').textContent = basis ? '다시 맞춰요' : '낚싯대처럼 쥐어요';
    $('calB').textContent = '폰 아래쪽을 손잡이처럼 쥐고 폰 윗부분이 TV를 향하게,\n화면은 하늘을 보게 든 뒤 준비를 눌러요.';
    show('vCal');
  }
  function startCountdown() {
    if (!gotOri) {
      $('calB').textContent = '방향 센서 값이 들어오지 않아요.\n잠시 뒤 다시 눌러 주세요.';
      return;
    }
    mode = 'count';
    let n = 3;
    $('calN').textContent = n;
    $('calN').classList.remove('hidden');
    $('btnReady').classList.add('hidden');
    $('btnCalCancel').classList.add('hidden');
    $('calT').textContent = '그대로 멈춰요';
    $('calB').textContent = '낚싯대를 쥔 자세 그대로, 폰 윗부분이 TV를 보게 둬요.';
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
      $('calB').textContent = '방향 센서 값이 끊겼어요.\n다시 준비를 눌러 주세요.';
      return;
    }
    const top = norm(src.reduce((a, o) => add(a, o.top), [0, 0, 0]));
    const face = norm(src.reduce((a, o) => add(a, o.face), [0, 0, 0]));
    basis = makeBasis(top, face);
    basis.e0 = clamp(elevOf(inBasis(basis, top)), -10, 60);
    calAt = t;
    nextPoseAt = 0;
    eHist.length = 0;
    cast.state = 'idle';
    // 큰 화면은 이 신호로 낚싯대 기준을 다시 잡습니다. 이 뒤의 pose 는 새 기준축 값입니다.
    if (!send('calibrate', {})) pendingCal = true;
    buzz([30, 40, 30]);
    tone(1320, 0.12, 0.3);
    mode = 'idle';
    debug(`calibrate e0 ${basis.e0.toFixed(1)} f=${basis.f.map((x) => x.toFixed(2))}`);
    render();
  }

  // ---------- 화면 ----------
  const STAGE_TEXT = {
    ready: ['던지세요', '폰을 뒤로 젖혔다가 앞으로 휙! 세게 던질수록 멀리 가요.'],
    cast: ['날아가는 중…', '찌가 떨어지면 기다려요.'],
    wait: ['찌를 지켜봐요', '톡톡은 참고, 쏙 들어가면 위로 확! 감으면 찌가 끌려와요.'],
    bite: ['지금 챔질!', '폰을 위로 확 들어 올려요!'],
    fight: ['파이팅!', '핸들을 돌려 감아요. 장력이 빨개지면 멈춰요.'],
    landed: ['잡았다!', '다음 캐스팅을 준비해요.'],
    lost: ['채비 정리 중…', '새 찌를 달고 있어요.'],
    done: ['시간 끝', '큰 화면에서 집계를 기다려요.']
  };
  let lastStage = null;
  let fight = { value: 0, dist: 0, drag: false, run: false, side: 0, at: 0 };
  let nibbleAt = -1e9;
  function setStatus(t, b, cls) {
    $('stT').textContent = t;
    $('stB').textContent = b || '';
    $('status').className = `status${cls ? ` ${cls}` : ''}`;
  }
  function showPlay() {
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
      $('btnMotion').classList.toggle('hidden', !gotOri || fallback);
      $('pads').classList.toggle('hidden', !fallback || !(st === 'ready' || st === 'wait' || st === 'bite'));
      $('btnCast').disabled = !(st === 'ready' || st === 'wait');
      $('btnHook').disabled = !(st === 'wait' || st === 'bite');
      $('btnCast').style.opacity = $('btnCast').disabled ? 0.4 : 1;
      $('btnHook').style.opacity = $('btnHook').disabled ? 0.4 : 1;
      if (st === 'ready') cast.msg = '';
      if (prev === 'fight' && st !== 'fight') dragSound(false);
      if (st !== 'fight') fight = { value: 0, dist: 0, drag: false, run: false, side: 0, at: 0 };
      drawCastHint();
      drawDialHint();
      if (st === 'fight') drawTension();
    }
  }
  function drawCastHint() {
    const st = myStage();
    let t = '';
    if (cast.state === 'armed' && !fallback) t = '좋아요! 이제 앞으로 휙!';
    else if (cast.msg) t = cast.msg;
    else if (fallback) t = st === 'ready' || st === 'wait' ? '캐스팅 버튼을 누르고 있다가 떼요' : '';
    else if (st === 'ready') t = '뒤로 젖혀요 ↶';
    else if (st === 'wait') t = '다시 던지려면 그냥 다시 캐스팅해요';
    $('castHint').textContent = t;
  }
  function drawDialHint() {
    const st = myStage();
    const h = $('dialHint');
    if (h.classList.contains('warn')) return;
    h.textContent = mc.on ? '폰 끝으로 작은 원을 그려도 감겨요' : st === 'fight' ? '손가락으로 원을 그리며 감아요' : '감으면 찌가 끌려와요';
  }
  function drawGauge(el) {
    if ($('gauge').classList.contains('hidden') || (!basis && !fallback)) return;
    const e0 = basis ? basis.e0 : 15;
    const e = clamp(el, -10, 190) * RD;
    $('rodLine').setAttribute('x2', (Math.cos(e) * 88).toFixed(1));
    $('rodLine').setAttribute('y2', (-Math.sin(e) * 88).toFixed(1));
    const a0 = Math.max(e0 + ARM_DEG, 50) * RD;
    const a1 = 170 * RD;
    $('zoneBack').setAttribute('d', `M ${(Math.cos(a0) * 96).toFixed(1)} ${(-Math.sin(a0) * 96).toFixed(1)} A 96 96 0 0 0 ${(Math.cos(a1) * 96).toFixed(1)} ${(-Math.sin(a1) * 96).toFixed(1)}`);
    $('rodLine').setAttribute('stroke', cast.state === 'armed' ? 'var(--c)' : '#fff');
    if (cast.state === 'armed' && $('castHint').textContent !== '좋아요! 이제 앞으로 휙!') drawCastHint();
  }
  function drawTension() {
    const v = fight.value;
    $('tfill').style.width = `${(clamp(v, 0, 1.1) / 1.1) * 100}%`;
    $('tbar').classList.toggle('hot', v > 0.85);
    $('tDist').textContent = `${(fight.dist || 0).toFixed(1)}m`;
    let label = '장력';
    let cls = '';
    let sub = STAGE_TEXT.fight[1];
    if (v > 0.92) {
      label = '위험! 멈춰요';
      cls = 'hot';
      sub = '줄이 끊어지기 직전이에요. 감기를 멈춰요!';
    } else if (fight.drag || fight.run) {
      label = '달린다! 잠깐 멈춰요';
      cls = v > 0.8 ? 'hot' : '';
      sub = '물고기가 달릴 땐 드랙이 줄을 내줘요. 지치면 다시 감아요.';
    } else if (v < 0.1) {
      label = '느슨해요! 감아요';
      sub = '줄이 느슨하면 바늘이 빠져요. 계속 감아요.';
    } else label = '좋아요, 감아요';
    $('tLabel').textContent = label;
    setStatus('파이팅!', sub, cls);
    const sh = $('sideHint');
    if (fight.side && !fallback) {
      sh.innerHTML = fight.side < 0 ? '<i>←</i> 왼쪽으로 가요 · 폰을 오른쪽으로 눕혀요 <i>→</i>' : '<i>←</i> 폰을 왼쪽으로 눕혀요 · 오른쪽으로 가요 <i>→</i>';
    } else sh.textContent = '';
  }

  function showCard(kind, k, n, w, s, ms) {
    const c = $('card');
    c.className = `card${kind === 'bad' ? ' bad' : ''}`;
    $('cardK').textContent = k;
    $('cardN').textContent = n;
    $('cardW').innerHTML = w || '';
    $('cardS').textContent = s || '';
    void c.offsetWidth;
    c.classList.add('on');
    clearTimeout(c._t);
    c._t = setTimeout(() => c.classList.remove('on'), ms || 2600);
  }

  function showWait() {
    mode = 'wait';
    const phase = state.phase;
    const chips = [];
    $('btnGo').style.display = '';
    if (phase === 'over') {
      const r = (state.ranking || []).findIndex((x) => me && x.slot === me.slot);
      const mine = myInfo();
      $('waitT').textContent = r === 0 ? '우승!' : r > 0 ? `${r + 1}위` : '경기 끝';
      $('waitB').textContent = '큰 화면에서 순위를 확인해요.';
      if (mine) {
        chips.push(['총 무게', `${(mine.total || 0).toFixed(1)}kg`]);
        chips.push(['마릿수', `${mine.count || 0}마리`]);
        if (mine.best) chips.push(['최대어', `${mine.best.name} ${mine.best.weight.toFixed(1)}kg`]);
      }
      $('btnGo').textContent = '다시 하기';
    } else if (phase === 'playing') {
      $('waitT').textContent = '관전 중';
      $('waitB').textContent = '이번 판이 끝나면 함께할 수 있어요.';
      $('btnGo').style.display = 'none';
    } else {
      $('waitT').textContent = '대기실';
      $('waitB').textContent = basis || fallback || !gotOri
        ? '모두 들어오면 게임 시작을 눌러요.'
        : '모두 들어오면 게임 시작을 눌러요.\n먼저 낚싯대 자세를 맞춰 두면 바로 던질 수 있어요.';
      $('btnGo').textContent = '게임 시작';
    }
    if (fallback) chips.push(['조작', '버튼']);
    else if (gotOri) chips.push(['낚싯대 자세', basis ? '맞춤' : '아직']);
    const box = $('waitChips');
    box.textContent = '';
    for (const [k, v] of chips) {
      const c = document.createElement('span');
      c.className = 'chip';
      c.append(k);
      const b = document.createElement('b');
      b.textContent = v;
      c.append(b);
      box.append(c);
    }
    const canCal = gotOri && !fallback;
    $('btnCalLobby').classList.toggle('hidden', !canCal);
    $('btnCalLobby').textContent = basis ? '낚싯대 자세 다시 맞추기' : '낚싯대 자세 맞추기';
    show('vWait');
  }

  function render() {
    if (!me) return;
    if (mode === 'start' || mode === 'connecting' || mode === 'msg') return;
    if (mode === 'cal' || mode === 'count') return;
    if (playing()) {
      if (!basis && gotOri && !fallback) {
        openCal();
        return;
      }
      if (mode !== 'play') showPlay();
      else updatePlay();
      return;
    }
    showWait();
  }
  // 센서 안내를 닫고 대기실(아직 방 배정 전이면 연결 중 화면)로 돌아갑니다.
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
    if (mode === 'play') updatePlay(true);
    else render();
  }
  function sensorHelp() {
    sensorHelpOn = true;
    // 안내를 닫지 않은 채 경기가 시작돼도 버튼 조작은 되게 둡니다.
    fallback = true;
    message('동작 센서를 쓸 수 없어요',
      'iPhone: Safari 를 앱 전환기에서 완전히 닫고 QR을 다시 찍은 뒤, 동작 접근을 허용해 주세요.\nAndroid: 주소창 자물쇠 → 사이트 설정 → 동작 센서를 허용해 주세요.\n\n지금은 버튼으로도 할 수 있어요.');
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

  // 남은 시간
  setInterval(() => {
    if (mode !== 'play') return;
    const left = Math.max(0, (state.left || 0) - (performance.now() - stateAt) / 1000);
    $('myTime').textContent = state.overtime ? '연장' : `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    if (myStage() === 'wait' && performance.now() - nibbleAt > 600) $('bob').classList.remove('nib');
  }, 250);

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
    if (pendingCal) {
      pendingCal = false;
      send('calibrate', {});
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
    if (state.phase === 'playing' && prevPhase !== 'playing') {
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
      if (navigator.vibrate) navigator.vibrate(25);
      cast.msg = c.dist ? `${c.dist}m 날아갔어요` : '';
      drawCastHint();
    } else if (kind === 'nibble') {
      nibbleAt = performance.now();
      const b = $('bob');
      b.classList.remove('nib');
      void b.getBoundingClientRect();
      b.classList.add('nib');
      nibbleSnd();
      if (navigator.vibrate) navigator.vibrate(28);
      setStatus('톡… 톡…', '아직이에요! 쏙 들어갈 때까지 참아요.', '');
    } else if (kind === 'hooked') {
      hookedSnd();
      buzz([140, 50, 90], 'go');
      setStatus('걸렸다!', '핸들을 돌려 감아요!', 'good');
    } else if (kind === 'jump') {
      splashSnd();
      buzz([40, 30, 40, 30, 60]);
      setStatus('점프!', '줄이 느슨하지 않게 버텨요!', 'hot');
    } else if (kind === 'slack') {
      buzz([50, 50, 50]);
      setStatus('줄이 느슨해요!', '빨리 감아요! 바늘이 빠지려고 해요.', 'hot');
    }
  });

  socket.on('bite', (d) => {
    const k = clamp(Number(d && d.strength) || 0.6, 0.3, 1);
    const on = Math.round(70 + 60 * k);
    // 부르르르: 짧고 센 진동을 연달아
    buzz([on, 35, on, 35, on, 35, on, 35, on + 60], 'bite');
    biteSnd();
    setStatus('지금 챔질!', '폰을 위로 확 들어 올려요!', 'hot');
    $('bob').classList.add('under');
  });

  socket.on('tension', (d) => {
    if (!d) return;
    if (!d.fish) {
      fight.value = 0;
      dragSound(false);
      return;
    }
    fight = { value: Number(d.value) || 0, dist: Number(d.dist) || 0, drag: Boolean(d.drag), run: Boolean(d.run), side: Number(d.side) || 0, at: performance.now() };
    if (mode === 'play' && myStage() === 'fight') drawTension();
    if (fight.value > 0.8 && navigator.vibrate) {
      try { navigator.vibrate(Math.round(Math.min(120, 50 + (fight.value - 0.8) * 400))); } catch (e) {}
    }
    dragSound(fight.drag, fight.value);
  });

  socket.on('result', (r) => {
    r = r || {};
    if (r.kind === 'final') return; // 대기 화면에서 순위를 보여 줍니다
    if (r.fish) {
      const big = (r.weight || 0) >= 2.5;
      fanfare(big);
      buzz(big ? [60, 40, 60, 40, 260] : [60, 40, 160], 'go');
      showCard('good', r.best && r.count > 1 ? '개인 최고!' : 'CATCH', r.fish,
        `${Number(r.weight).toFixed(1)}<small>kg</small>`, `${r.length ? `${Math.round(r.length * 100)}cm · ` : ''}지금까지 ${r.count || 1}마리, 총 ${(r.total || 0).toFixed(1)}kg`, 3400);
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
  $('btnGo').addEventListener('click', () => {
    audio();
    if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
    send('start_game', {});
  });
  $('btnCalLobby').addEventListener('click', () => { audio(); openCal(); });
  $('btnRecal').addEventListener('click', () => { audio(); openCal(); });
  $('btnReady').addEventListener('click', () => { audio(); startCountdown(); });
  $('btnCalCancel').addEventListener('click', () => {
    clearInterval(countTimer);
    mode = 'idle';
    render();
  });

  // ---------- 시험용 버튼(센서 없음): 같은 전송 길을 씁니다 ----------
  const charge = { on: false, t0: 0, raf: 0 };
  function chargePower(t) {
    const u = ((t - charge.t0) / 1200) % 2;
    return u < 1 ? u : 2 - u;
  }
  function chargeLoop() {
    if (!charge.on) return;
    const p = chargePower(performance.now());
    $('castPow').style.width = `${p * 100}%`;
    // 버튼으로 할 때도 낚싯대가 뒤로 젖혀지는 모습을 보여 줍니다.
    drawGauge(35 + p * 120);
    charge.raf = requestAnimationFrame(chargeLoop);
  }
  function startCharge() {
    if ($('btnCast').disabled || charge.on) return;
    audio();
    charge.on = true;
    charge.t0 = performance.now();
    chargeLoop();
  }
  function releaseCharge() {
    if (!charge.on) return;
    charge.on = false;
    cancelAnimationFrame(charge.raf);
    const p = clamp(chargePower(performance.now()), 0.08, 1);
    $('castPow').style.width = '0';
    drawGauge(20);
    setTimeout(() => drawGauge(35), 300);
    deliverCast(p, Number($('aim').value) || 0, 0);
  }
  $('btnCast').addEventListener('pointerdown', (e) => { e.preventDefault(); startCharge(); });
  $('btnCast').addEventListener('pointerup', releaseCharge);
  $('btnCast').addEventListener('pointerleave', releaseCharge);
  $('btnHook').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if ($('btnHook').disabled) return;
    audio();
    deliverHook(650, 0, myStage());
  });
  const keyReel = { on: false, last: 0 };
  function keyReelLoop() {
    if (!keyReel.on) return;
    const now = performance.now();
    addTurns(((now - keyReel.last) / 1000) * 2.4);
    keyReel.last = now;
    setArm((reel.total * TAU) % TAU);
    requestAnimationFrame(keyReelLoop);
  }
  document.addEventListener('keydown', (e) => {
    if (mode !== 'play' || e.repeat) return;
    if (e.code === 'KeyC') startCharge();
    else if (e.code === 'Space' || e.code === 'KeyH') {
      e.preventDefault();
      if (!$('btnHook').disabled) { audio(); deliverHook(650, 0, myStage()); }
    } else if (e.code === 'KeyR') {
      keyReel.on = true;
      keyReel.last = performance.now();
      keyReelLoop();
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const a = $('aim');
      a.value = clamp(Number(a.value) + (e.code === 'ArrowLeft' ? -5 : 5), -AIM_MAX, AIM_MAX);
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'KeyC') releaseCharge();
    if (e.code === 'KeyR') keyReel.on = false;
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && mode !== 'start' && navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
  });
  if (!window.isSecureContext) $('httpNote').classList.remove('hidden');

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
})();
