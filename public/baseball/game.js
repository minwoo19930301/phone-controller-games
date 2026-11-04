// 홈런 더비 큰 화면. 서버는 방과 이벤트만 중계하고, 판정은 모두 여기서 합니다.
(() => {
  const PITCHES_PER_TURN = 10;
  const HIT_WINDOW = 0.2; // 이 시간(초)보다 어긋나면 헛스윙
  const RD = Math.PI / 180;
  const PITCH_TYPES = [
    { name: '직구', kmh: [138, 152], brk: 0.05, w: 5 },
    { name: '체인지업', kmh: [118, 128], brk: 0.25, w: 2 },
    { name: '커브', kmh: [105, 118], brk: 0.55, w: 2 }
  ];

  const $ = (id) => document.getElementById(id);
  const cv = $('cv');
  const ctx = cv.getContext('2d');
  let W = 0;
  let H = 0;
  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- 카메라 ----------
  const PITCH_CAM = { x: 0.35, y: 1.45, z: -3.4, tilt: 3.5 };
  const FIELD_CAM = { x: 0, y: 40, z: -45, tilt: 28 };
  const cam = { ...PITCH_CAM };
  let camFrom = { ...PITCH_CAM };
  let camTo = { ...PITCH_CAM };
  let camT0 = 0;
  let camDur = 1;
  function moveCam(to, ms) {
    camFrom = { ...cam };
    camTo = { ...to };
    camT0 = performance.now();
    camDur = ms;
  }
  function updateCam(now) {
    const u = Math.min(1, (now - camT0) / camDur);
    const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    for (const k of ['x', 'y', 'z', 'tilt']) cam[k] = camFrom[k] + (camTo[k] - camFrom[k]) * e;
  }
  function proj(x, y, z) {
    const rx = x - cam.x;
    const ry = y - cam.y;
    const rz = z - cam.z;
    const s = Math.sin(cam.tilt * RD);
    const c = Math.cos(cam.tilt * RD);
    const zc = -ry * s + rz * c;
    if (zc < 0.15) return null;
    const yc = ry * c + rz * s;
    const F = H * 1.1;
    return { x: W / 2 + (F * rx) / zc, y: H / 2 - (F * yc) / zc, s: F / zc };
  }
  function poly(points, fill, stroke, lw) {
    const ps = points.map((p) => proj(p[0], p[1], p[2]));
    if (ps.some((p) => !p)) return;
    ctx.beginPath();
    ps.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw || 1;
      ctx.stroke();
    }
  }
  function line(a, b, color, lw) {
    const p = proj(...a);
    const q = proj(...b);
    if (!p || !q) return;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  const fenceDist = (deg) => 98 + 24 * Math.cos(2 * deg * RD);
  const onGround = (deg, d) => [d * Math.sin(deg * RD), 0, d * Math.cos(deg * RD)];

  // ---------- 경기장 ----------
  const crowdSeed = [];
  for (let i = 0; i < 900; i++) crowdSeed.push([Math.random() * 100 - 50, Math.random(), Math.random()]);

  function drawField(now) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0b1830');
    sky.addColorStop(0.55, '#1d3b66');
    sky.addColorStop(1, '#2d5a3a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // 조명탑
    for (const deg of [-38, 38]) {
      const base = onGround(deg, fenceDist(deg) + 45);
      const top = proj(base[0], 42, base[2]);
      if (top) {
        const g = ctx.createRadialGradient(top.x, top.y, 0, top.x, top.y, top.s * 18);
        g.addColorStop(0, 'rgba(255,250,220,.55)');
        g.addColorStop(1, 'rgba(255,250,220,0)');
        ctx.fillStyle = g;
        ctx.fillRect(top.x - top.s * 18, top.y - top.s * 18, top.s * 36, top.s * 36);
      }
    }

    // 관중석
    for (let deg = -52; deg < 52; deg += 4) {
      const f0 = fenceDist(deg) + 2;
      const f1 = fenceDist(deg + 4) + 2;
      const a = onGround(deg, f0);
      const b = onGround(deg + 4, f1);
      const c = onGround(deg + 4, f1 + 40);
      const d = onGround(deg, f0 + 40);
      poly([a, b, [c[0], 26, c[2]], [d[0], 26, d[2]]], deg % 8 === 0 ? '#1a2638' : '#1e2c40');
    }
    for (const [deg, r, h] of crowdSeed) {
      const d = fenceDist(deg) + 4 + r * 34;
      const p = onGround(deg, d);
      const q = proj(p[0], 1 + r * 22 + h * 0.5, p[2]);
      if (!q) continue;
      ctx.fillStyle = h < 0.33 ? '#e8d7c0' : h < 0.66 ? '#c9474f' : '#3a7bd5';
      const sz = Math.max(1, q.s * 0.45);
      ctx.fillRect(q.x, q.y, sz, sz);
    }

    // 파울 지역까지 덮는 잔디
    poly([[-160, 0, Math.max(-80, cam.z + 1)], [160, 0, Math.max(-80, cam.z + 1)], [160, 0, 160], [-160, 0, 160]], '#2c6e3a');
    // 외야 펜스 안쪽 잔디
    const fan = [[0, 0, 0]];
    for (let deg = -45; deg <= 45; deg += 3) fan.push(onGround(deg, fenceDist(deg)));
    poly(fan, '#3c8d47');
    // 잔디 줄무늬
    for (let k = 0; k < 6; k++) {
      const d0 = 40 + k * 14;
      const band = [];
      for (let deg = -45; deg <= 45; deg += 5) band.push(onGround(deg, Math.min(d0, fenceDist(deg))));
      for (let deg = 45; deg >= -45; deg -= 5) band.push(onGround(deg, Math.min(d0 + 7, fenceDist(deg))));
      poly(band, 'rgba(255,255,255,.045)');
    }
    // 펜스
    for (let deg = -45; deg < 45; deg += 3) {
      const a = onGround(deg, fenceDist(deg));
      const b = onGround(deg + 3, fenceDist(deg + 3));
      poly([a, b, [b[0], 3.2, b[2]], [a[0], 3.2, a[2]]], '#174a2b');
      line([a[0], 3.2, a[2]], [b[0], 3.2, b[2]], '#ffd54a', 2);
    }
    // 거리 표시
    ctx.fillStyle = '#f4f1ea';
    ctx.textAlign = 'center';
    for (const deg of [-45, -22, 0, 22, 45]) {
      const g = onGround(deg, fenceDist(deg) - 0.3);
      const p = proj(g[0], 1.6, g[2]);
      if (!p || p.s < 2) continue;
      ctx.font = `800 ${Math.max(9, p.s * 1.5)}px system-ui`;
      ctx.fillText(Math.round(fenceDist(deg)), p.x, p.y);
    }
    // 내야 흙
    const dirt = [];
    for (let deg = -45; deg <= 45; deg += 5) dirt.push(onGround(deg, 29));
    dirt.push([0, 0, -2.5]);
    poly(dirt, '#b98552');
    // 내야 잔디(다이아몬드 안쪽)
    poly([[0, 0, 3.5], [16.2, 0, 19.4], [0, 0, 35.2], [-16.2, 0, 19.4]], '#3c8d47');
    // 파울 라인
    line([0, 0, 0], onGround(-45, 98), '#f4f1ea', 2);
    line([0, 0, 0], onGround(45, 98), '#f4f1ea', 2);
    // 마운드
    const mound = [];
    for (let a = 0; a < 360; a += 20) mound.push([2.7 * Math.sin(a * RD), 0, 18.44 + 2.7 * Math.cos(a * RD)]);
    poly(mound, '#c28f5c');
    // 베이스
    for (const b of [[19.4, 19.4], [0, 38.8], [-19.4, 19.4]]) {
      poly([[b[0] - 0.38, 0, b[1]], [b[0], 0, b[1] + 0.38], [b[0] + 0.38, 0, b[1]], [b[0], 0, b[1] - 0.38]], '#fff');
    }
    // 홈플레이트와 타석
    poly([[-0.22, 0, 0.22], [0.22, 0, 0.22], [0.22, 0, 0], [0, 0, -0.22], [-0.22, 0, 0]], '#fff');
    poly([[-1.5, 0, -0.9], [-0.4, 0, -0.9], [-0.4, 0, 0.9], [-1.5, 0, 0.9]], null, 'rgba(255,255,255,.8)', 2);
    poly([[0.4, 0, -0.9], [1.5, 0, -0.9], [1.5, 0, 0.9], [0.4, 0, 0.9]], null, 'rgba(255,255,255,.8)', 2);
  }

  // 사람은 바닥 한 점에서 위로 그리는 납작한 인형입니다.
  function drawPerson(x, z, opts, now) {
    const base = proj(x, 0, z);
    if (!base) return;
    const s = base.s;
    const px = (m) => m * s;
    ctx.save();
    ctx.translate(base.x, base.y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 그림자
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath();
    ctx.ellipse(0, 0, px(0.45), px(0.12), 0, 0, Math.PI * 2);
    ctx.fill();
    // 다리
    ctx.strokeStyle = opts.pants;
    ctx.lineWidth = px(0.17);
    ctx.beginPath();
    ctx.moveTo(-px(0.22), 0);
    ctx.lineTo(-px(0.12), -px(0.85));
    ctx.moveTo(px(0.22), 0);
    ctx.lineTo(px(0.12), -px(0.85));
    ctx.stroke();
    // 몸통
    ctx.fillStyle = opts.shirt;
    ctx.beginPath();
    ctx.roundRect(-px(0.26), -px(1.5), px(0.52), px(0.72), px(0.12));
    ctx.fill();
    if (opts.number) {
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.font = `900 ${px(0.32)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText(opts.number, 0, -px(1.05));
    }
    // 머리와 모자/헬멧
    ctx.fillStyle = '#e8b98f';
    ctx.beginPath();
    ctx.arc(0, -px(1.68), px(0.15), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = opts.cap;
    ctx.beginPath();
    ctx.arc(0, -px(1.71), px(0.165), Math.PI, 0);
    ctx.fill();
    // 팔과 방망이/공
    if (opts.draw) opts.draw(ctx, px, now);
    ctx.restore();
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
  window.addEventListener('pointerdown', audio);
  window.addEventListener('keydown', audio);
  function noise(sec, freq, q, gain, attack, type) {
    const a = actx;
    if (!a || a.state !== 'running') return;
    const len = Math.floor(a.sampleRate * sec);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = attack ? Math.min(1, t / attack) * Math.pow(1 - t, 1.2) : Math.pow(1 - t, 6);
      d[i] = (Math.random() * 2 - 1) * env;
    }
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = type || 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = a.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(a.destination);
    src.start();
  }
  const sfx = {
    crack: (q) => noise(0.12, 2000, 0.7, 0.6 + q, 0),
    mitt: () => noise(0.08, 500, 1.2, 0.8, 0),
    whiff: () => noise(0.3, 900, 0.5, 0.25, 0.4),
    cheer: (big) => noise(big ? 3.2 : 1.6, 1100, 0.4, big ? 0.5 : 0.25, 0.15)
  };

  // ---------- 연결 ----------
  const socket = io({ transports: ['websocket', 'polling'] });
  let roomCode = null;
  let players = [];
  const rtts = [];
  function displayRtt() {
    if (!rtts.length) return 40;
    const s = [...rtts].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }
  setInterval(() => {
    const t0 = performance.now();
    socket.timeout(2000).emit('ping_rtt', t0, (err) => {
      if (err) return;
      rtts.push(performance.now() - t0);
      if (rtts.length > 7) rtts.shift();
    });
  }, 1500);

  socket.on('connect', () => {
    let saved = null;
    try { saved = sessionStorage.getItem('pcg-room'); } catch (e) {}
    socket.emit('join', { role: 'display', game: 'baseball', room: saved });
  });
  socket.on('room', async (r) => {
    roomCode = r.code;
    try { sessionStorage.setItem('pcg-room', r.code); } catch (e) {}
    players = r.players;
    $('code').textContent = r.code;
    $('codeMini').textContent = r.code;
    const res = await fetch(`/api/qr?room=${r.code}`).then((x) => x.json());
    $('qr').src = res.qr;
    $('qrMini').src = res.qr;
    $('url').textContent = res.url.replace(/^https?:\/\//, '');
    $('warn').classList.toggle('hidden', res.secure);
    renderPlayers();
    pushState();
  });
  socket.on('players', (p) => {
    players = p.players;
    if (game.phase === 'playing') {
      for (const pl of players) addToOrder(pl.slot);
    }
    renderPlayers();
    pushState();
  });
  socket.on('display_replaced', () => $('replaced').classList.remove('hidden'));
  socket.on('start_game', () => startGame());
  socket.on('swing', (d) => onSwing(d, false));

  function playerInfo(slot) {
    return players.find((p) => p.slot === slot) || { slot, name: `${slot}P`, color: '#888', connected: false };
  }

  function renderPlayers() {
    const box = $('players');
    box.innerHTML = '';
    for (let s = 1; s <= 4; s++) {
      const p = players.find((x) => x.slot === s);
      const el = document.createElement('div');
      el.className = 'slot' + (p ? ' on' : '') + (p && !p.connected ? ' away' : '');
      if (p) el.style.setProperty('--c', p.color);
      el.textContent = p ? p.name : `${s}P 대기`;
      box.appendChild(el);
    }
    renderBoard();
  }

  // ---------- 경기 진행 ----------
  const game = {
    phase: 'lobby',
    order: [],
    turn: 0,
    left: 0,
    scores: {},
    sub: 'idle',
    pitch: null,
    hit: null,
    waitUntil: 0
  };

  function addToOrder(slot) {
    if (game.order.includes(slot)) return;
    game.order.push(slot);
    game.scores[slot] = { hr: 0, longest: 0, total: 0 };
  }

  function batter() {
    return game.order[game.turn];
  }

  function pushState() {
    const scores = {};
    for (const [s, v] of Object.entries(game.scores)) scores[s] = { hr: v.hr, longest: Math.round(v.longest) };
    socket.emit('d2c', {
      event: 'game_state',
      data: { phase: game.phase, batter: game.phase === 'playing' ? batter() : null, left: game.left, scores }
    });
  }

  function startGame() {
    if (game.phase === 'playing') return;
    const connected = players.filter((p) => p.connected).map((p) => p.slot);
    if (!connected.length) {
      callout('폰을 먼저 연결해 주세요', '', '#fff', 1600);
      return;
    }
    audio();
    game.phase = 'playing';
    game.order = [];
    game.scores = {};
    connected.forEach(addToOrder);
    game.turn = 0;
    game.left = PITCHES_PER_TURN;
    $('lobby').classList.add('hidden');
    $('over').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('joinMini').classList.remove('hidden');
    announceBatter();
  }

  function announceBatter() {
    const p = playerInfo(batter());
    document.documentElement.style.setProperty('--c', p.color);
    $('hBadge').textContent = p.name;
    callout(`${p.name} 타석`, `${PITCHES_PER_TURN}구`, p.color, 1500);
    game.sub = 'idle';
    game.waitUntil = performance.now() + 1800;
    pushState();
    renderBoard();
  }

  function endGame() {
    game.phase = 'over';
    game.sub = 'idle';
    $('hud').classList.add('hidden');
    $('joinMini').classList.add('hidden');
    const ranked = [...game.order].sort((a, b) => {
      const x = game.scores[a];
      const y = game.scores[b];
      return y.hr - x.hr || y.longest - x.longest;
    });
    const rank = $('rank');
    rank.innerHTML = '';
    ranked.forEach((slot, i) => {
      const p = playerInfo(slot);
      const sc = game.scores[slot];
      const el = document.createElement('div');
      el.className = 'r';
      el.style.setProperty('--c', p.color);
      el.innerHTML = `<span class="p">${i + 1}위</span><span class="n">${p.name}</span>` +
        `<span>홈런 ${sc.hr}</span><small>최장 ${Math.round(sc.longest)}m</small>`;
      rank.appendChild(el);
    });
    $('over').classList.remove('hidden');
    sfx.cheer(true);
    pushState();
  }

  function backToLobbyIfEmpty() {
    if (game.phase === 'over' && !players.some((p) => p.connected)) {
      game.phase = 'lobby';
      $('over').classList.add('hidden');
      $('lobby').classList.remove('hidden');
    }
  }

  function pickPitch() {
    const total = PITCH_TYPES.reduce((a, t) => a + t.w, 0);
    let r = Math.random() * total;
    const t = PITCH_TYPES.find((x) => (r -= x.w) < 0) || PITCH_TYPES[0];
    const kmh = t.kmh[0] + Math.random() * (t.kmh[1] - t.kmh[0]);
    return { type: t, kmh, ms: (17.4 / (kmh / 3.6)) * 1000, endX: (Math.random() - 0.5) * 0.4, endY: 0.65 + Math.random() * 0.4 };
  }

  function nextPitch(now) {
    const slot = batter();
    if (!playerInfo(slot).connected) {
      // 타자 폰이 끊겼으면 잠깐 기다렸다가 넘깁니다.
      if (!game.pitch || game.pitch.waitingSince == null) {
        game.pitch = { waitingSince: now };
        callout(`${slot}P 연결을 기다려요`, '', '#fff', 1500);
      }
      if (now - game.pitch.waitingSince > 15000) {
        game.left = 0;
        finishPitch(now);
      }
      return;
    }
    const p = pickPitch();
    const windup = 1100 + Math.random() * 700;
    game.pitch = { ...p, start: now, release: now + windup, cross: now + windup + p.ms, swing: null, resolved: false };
    game.sub = 'pitch';
    moveCam(PITCH_CAM, 500);
    // 폰에는 공을 놓는 순간 알려 줍니다.
    setTimeout(() => {
      if (game.pitch && game.pitch.start === now) {
        socket.emit('d2c', { event: 'pitch', slot, data: { label: `${p.type.name} ${Math.round(p.kmh)}km/h` } });
      }
    }, windup);
  }

  function onSwing(d, local) {
    if (game.phase !== 'playing' || d.slot !== batter() || game.sub !== 'pitch') return;
    const pt = game.pitch;
    if (!pt || pt.swing || pt.resolved) return;
    const arrived = performance.now();
    const lag = local ? 0 : (Number(d.ago) || 0) + (Number(d.rtt) || 80) / 2 + displayRtt() / 2;
    const at = arrived - lag;
    // 공을 놓기 전 스윙은 연습 스윙으로 보고 넘깁니다.
    if (at < pt.release) return;
    pt.swing = { at, power: Math.max(0.1, Math.min(1, Number(d.power) || 0.5)), shown: arrived };
  }

  function resolvePitch(now) {
    const pt = game.pitch;
    pt.resolved = true;
    const sw = pt.swing;
    const err = sw ? (sw.at - pt.cross) / 1000 : null;
    if (!sw || Math.abs(err) > HIT_WINDOW) {
      sfx.mitt();
      if (sw) sfx.whiff();
      const text = sw ? (err < 0 ? '헛스윙 (빨라요)' : '헛스윙 (늦어요)') : '스트라이크';
      callout(text, '', '#fff', 1100);
      socket.emit('d2c', { event: 'result', slot: batter(), data: { text: sw ? '헛스윙' : '스트라이크', contact: false } });
      game.sub = 'after';
      game.waitUntil = now + 1500;
      return;
    }
    // 맞았습니다. 일찍 치면 당겨서(좌측), 늦으면 밀어서(우측) 갑니다.
    const q = Math.max(0, 1 - Math.abs(err) / HIT_WINDOW);
    const sweet = Math.abs(err) < 0.035;
    const spray = (err / 0.1) * 32 + (Math.random() - 0.5) * 10;
    const la = sweet ? 24 + Math.random() * 10 : 18 + gauss() * (8 + 28 * (1 - q));
    const ev = (100 + 80 * sw.power) * (0.62 + 0.38 * q) * (sweet ? 1.04 : 1);
    const path = flight(ev, la, spray);
    const last = path[path.length - 1];
    const dist = Math.hypot(last[0], last[2]);
    const foul = Math.abs(spray) > 45;
    const homer = !foul && dist > fenceDist(spray);
    let text;
    if (foul) text = '파울';
    else if (homer) text = '홈런!';
    else if (la < 9) text = ev > 150 ? '안타' : '땅볼';
    else if (la > 48) text = '내야 플라이';
    else if (dist > 85) text = '2루타';
    else if (dist > 45) text = '안타';
    else text = '내야 땅볼';
    const sc = game.scores[batter()];
    if (!foul) {
      sc.longest = Math.max(sc.longest, dist);
      sc.total += dist;
    }
    if (homer) sc.hr += 1;
    game.hit = { path, t0: now, dist, homer, foul, text, ev, la, spray, q, landed: false };
    game.sub = 'hit';
    sfx.crack(q);
    if (homer || dist > 80) sfx.cheer(homer);
    moveCam(FIELD_CAM, 700);
    socket.emit('d2c', {
      event: 'result',
      slot: batter(),
      data: { text: foul ? '파울' : `${text} ${Math.round(dist)}m`, contact: true, homer, quality: q }
    });
  }

  function gauss() {
    return (Math.random() + Math.random() + Math.random() - 1.5) / 0.5;
  }

  // 공기 저항을 넣은 타구 궤적. 각도가 높으면 더 빨리 꺾입니다.
  function flight(evKmh, la, spray) {
    const v = evKmh / 3.6;
    const k = 0.0045 * (1 + Math.max(0, la - 32) / 20);
    const vh = v * Math.cos(la * RD);
    let vx = vh * Math.sin(spray * RD);
    let vz = vh * Math.cos(spray * RD);
    let vy = v * Math.sin(la * RD);
    let x = 0;
    let y = 0.9;
    let z = 0.3;
    const dt = 1 / 120;
    const pts = [[x, y, z]];
    for (let t = 0; t < 9 && y > 0; t += dt) {
      const sp = Math.hypot(vx, vy, vz);
      vx -= k * sp * vx * dt;
      vz -= k * sp * vz * dt;
      vy -= (9.8 + k * sp * vy) * dt;
      x += vx * dt;
      y += vy * dt;
      z += vz * dt;
      pts.push([x, Math.max(0, y), z]);
    }
    return pts;
  }

  function finishPitch(now) {
    game.hit = null;
    game.left -= 1;
    if (game.left <= 0) {
      game.turn += 1;
      if (game.turn >= game.order.length) {
        endGame();
        return;
      }
      game.left = PITCHES_PER_TURN;
      moveCam(PITCH_CAM, 600);
      announceBatter();
      return;
    }
    game.pitch = null;
    game.sub = 'idle';
    game.waitUntil = now + 500;
    moveCam(PITCH_CAM, 600);
    pushState();
    renderBoard();
  }

  // ---------- 화면 글자 ----------
  let calloutTimer = null;
  function callout(text, sub, color, ms) {
    const el = $('callout');
    el.innerHTML = '';
    el.append(text);
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      el.appendChild(s);
    }
    el.style.color = color || '#fff';
    el.classList.add('on');
    clearTimeout(calloutTimer);
    calloutTimer = setTimeout(() => el.classList.remove('on'), ms || 1200);
  }

  function renderBoard() {
    const b = $('board');
    b.innerHTML = '';
    for (const slot of game.order) {
      const p = playerInfo(slot);
      const sc = game.scores[slot];
      const row = document.createElement('div');
      row.className = 'row' + (slot === batter() ? ' now' : '');
      row.innerHTML = `<i style="background:${p.color}"></i><span class="n">${p.name}</span>` +
        `<b>${sc.hr}</b><small>${sc.longest ? Math.round(sc.longest) + 'm' : '-'}</small>`;
      b.appendChild(row);
    }
    $('hLeft').textContent = game.phase === 'playing' ? `남은 공 ${game.left}` : '';
  }

  // ---------- 그리기 ----------
  const sparks = [];
  function fireworks() {
    const colors = ['#ffd54a', '#ff5a5f', '#3ab4ff', '#5ee07a', '#fff'];
    for (let b = 0; b < 5; b++) {
      const cx = W * (0.15 + Math.random() * 0.7);
      const cy = H * (0.12 + Math.random() * 0.3);
      const col = colors[b % colors.length];
      for (let i = 0; i < 60; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 1.5 + Math.random() * 4;
        sparks.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, col, delay: b * 12 });
      }
    }
  }
  function drawSparks() {
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      if (s.delay > 0) { s.delay--; continue; }
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.05;
      s.life -= 0.012;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.globalAlpha = s.life;
      ctx.fillStyle = s.col;
      ctx.fillRect(s.x, s.y, 3, 3);
    }
    ctx.globalAlpha = 1;
  }

  function ballAt(now) {
    const pt = game.pitch;
    if (!pt || pt.release == null || game.sub !== 'pitch' && game.sub !== 'after') return null;
    const u = (now - pt.release) / pt.ms;
    if (u < 0 || u > 1.25) return null;
    const x = 0.3 + (pt.endX - 0.3) * u;
    const y = 1.9 + (pt.endY - 1.9) * u - pt.type.brk * (u * u - u);
    const z = 17.4 * (1 - u);
    // 브레이킹볼은 끝에서 떨어집니다.
    return [x, y - pt.type.brk * 0.6 * Math.max(0, u - 0.5) * Math.max(0, u - 0.5) * 4, z];
  }

  function drawBall(p, trail) {
    const q = proj(...p);
    if (!q) return;
    const sh = proj(p[0], 0, p[2]);
    if (sh) {
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.beginPath();
      ctx.ellipse(sh.x, sh.y, Math.max(2, q.s * 0.06), Math.max(1, q.s * 0.02), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (trail) {
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      trail.forEach((t, i) => {
        const r = proj(...t);
        if (!r) return;
        i ? ctx.lineTo(r.x, r.y) : ctx.moveTo(r.x, r.y);
      });
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(q.x, q.y, Math.max(3, q.s * 0.037), 0, Math.PI * 2);
    ctx.fill();
  }

  function swingProgress(now) {
    const pt = game.pitch;
    if (!pt || !pt.swing) return null;
    // 화면에는 판정 시각에 맞춰 방망이를 돌립니다.
    const t = (now - Math.max(pt.swing.shown, pt.swing.at)) / 220;
    return Math.max(0, Math.min(1, t + 0.5));
  }

  function draw(now) {
    updateCam(now);
    drawField(now);

    const bslot = game.phase === 'playing' ? batter() : players[0] && players[0].slot;
    const bp = bslot ? playerInfo(bslot) : { color: '#ff5a5f', name: '' };

    // 투수
    const pt = game.pitch;
    const wind = pt && pt.release ? Math.max(0, Math.min(1, 1 - (pt.release - now) / 900)) : 0;
    drawPerson(0, 18.6, {
      shirt: '#d8dde3', pants: '#d8dde3', cap: '#1d2d44',
      draw(c, px) {
        c.strokeStyle = '#d8dde3';
        c.lineWidth = px(0.13);
        const a = -Math.PI / 2 - wind * Math.PI * 1.1;
        c.beginPath();
        c.moveTo(px(0.2), -px(1.4));
        c.lineTo(px(0.2) + Math.cos(a) * px(0.6), -px(1.4) + Math.sin(a) * px(0.6));
        c.stroke();
      }
    }, now);

    // 투구 중 공
    const b = ballAt(now);
    if (b && !(game.sub === 'hit')) drawBall(b);

    // 타구
    if (game.hit) {
      const h = game.hit;
      const i = Math.min(h.path.length - 1, Math.floor(((now - h.t0) / 1000) * 120 * 1.25));
      const p = h.path[i];
      drawBall(p, h.path.slice(Math.max(0, i - 90), i + 1));
      const d = Math.hypot(p[0], p[2] - 0.3);
      $('dist').textContent = h.foul ? '' : `${Math.round(d)}m`;
      if (i >= h.path.length - 1 && !h.landed) {
        h.landed = true;
        h.landedAt = now;
        const sub = h.foul ? '' : `${Math.round(h.dist)}m · 타구 속도 ${Math.round(h.ev)}km/h · 발사각 ${Math.round(h.la)}°`;
        callout(h.text, sub, h.homer ? '#ffd54a' : '#fff', 2200);
        if (h.homer) fireworks();
        renderBoard();
        pushState();
      }
    } else if (game.sub !== 'hit') {
      $('dist').textContent = '';
    }

    // 타자 (카메라와 가까워서 마지막에 그립니다)
    if (game.phase === 'playing' || players.length) {
      const sw = swingProgress(now);
      drawPerson(-0.95, 0.25, {
        shirt: bp.color, pants: '#eef0f2', cap: bp.color, number: bp.name,
        draw(c, px) {
          // 손 위치에서 방망이를 그립니다. 0 = 어깨 위로 세움, 1 = 앞으로 휘두름
          const t = sw == null ? 0 : sw;
          const ang = -Math.PI * 0.62 + t * Math.PI * 1.15;
          const hx = px(0.25);
          const hy = -px(1.32);
          c.strokeStyle = '#e8b98f';
          c.lineWidth = px(0.11);
          c.beginPath();
          c.moveTo(-px(0.15), -px(1.4));
          c.lineTo(hx, hy);
          c.stroke();
          c.strokeStyle = '#c99a5b';
          c.lineWidth = px(0.07);
          c.beginPath();
          c.moveTo(hx, hy);
          c.lineTo(hx + Math.cos(ang) * px(0.85), hy + Math.sin(ang) * px(0.85) * 0.6);
          c.stroke();
        }
      }, now);
    }

    drawSparks();
  }

  // ---------- 매 프레임 ----------
  function tick() {
    const now = performance.now();
    if (game.phase === 'playing') {
      if (game.sub === 'idle' && now >= game.waitUntil) nextPitch(now);
      else if (game.sub === 'pitch') {
        const pt = game.pitch;
        const decideAt = pt.swing ? Math.max(pt.cross, pt.swing.shown) : pt.cross + 300;
        if (!pt.resolved && now >= decideAt) resolvePitch(now);
      } else if (game.sub === 'after' && now >= game.waitUntil) finishPitch(now);
      else if (game.sub === 'hit' && game.hit && game.hit.landed && now - game.hit.landedAt > 2300) finishPitch(now);
    }
    backToLobbyIfEmpty();
    draw(now);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startGame();
    if (e.code === 'Space') {
      e.preventDefault();
      if (game.phase === 'playing') onSwing({ slot: batter(), power: 0.85 }, true);
    }
  });

  // 시험용: 콘솔에서 상태를 볼 수 있게 둡니다.
  window.__derby = { game, fenceDist, flight };
})();
