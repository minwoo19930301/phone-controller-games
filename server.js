const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const PORT = process.env.PORT || process.argv[2] || 3000;
const MAX_PLAYERS = 4; // 기본 인원. 종목에 max 가 있으면 그 값(총게임은 8명)
const maxOf = (room) => (room && GAMES[room.game] && GAMES[room.game].max) || MAX_PLAYERS;
// 폰이 잠깐 끊겨도(새로고침, 화면 꺼짐) 같은 자리로 돌아올 수 있게 자리를 잡아 둡니다.
const RESERVE_MS = Number(process.env.RESERVE_MS || 15000);
// 큰 화면이 사라진 방은 이 시간 뒤에 지웁니다. 화면을 새로고침해도 같은 방으로 돌아올 수 있습니다.
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MS || 10 * 60 * 1000);

// 종목별로 오가는 이벤트 목록. 새 종목은 여기에 추가합니다.
// volatile 은 자주 흘려보내는 값이라 밀리면 버려도 되는 이벤트입니다(최신 값만 의미가 있음).
// play 는 폰이 여는 컨트롤러 주소입니다.
const GAMES = {
  baseball: {
    title: '홈런 더비',
    play: '/play/',
    fromController: ['swing', 'start_game', 'ready', 'throw', 'mode'],
    fromDisplay: ['game_state', 'turn', 'pitch', 'result', 'role'],
    volatile: []
  },
  golf: {
    title: '골프 니어핀',
    play: '/play/golf/',
    fromController: ['pose', 'aim', 'club', 'address', 'impact', 'start_game', 'cancel'],
    fromDisplay: ['game_state', 'result', 'calibrated'],
    volatile: ['pose', 'aim']
  },
  pingpong: {
    title: '탁구',
    play: '/play/pingpong/',
    fromController: ['pose', 'swing', 'calibrate', 'start_game'],
    fromDisplay: ['game_state', 'cue', 'result'],
    volatile: ['pose']
  },
  saber: {
    title: '광선검',
    play: '/play/saber/',
    fromController: ['pose', 'swing', 'calibrate', 'start_game'],
    fromDisplay: ['game_state', 'cue', 'result', 'hit'],
    volatile: ['pose']
  },
  fishing: {
    title: '배스 낚시',
    play: '/play/fishing/',
    gate: false,
    fromController: ['pose', 'cast', 'hookset', 'reel', 'calibrate', 'start_game'],
    fromDisplay: ['game_state', 'bite', 'tension', 'result', 'cue'],
    volatile: ['pose', 'reel']
  },
  tennis: {
    title: '테니스',
    play: '/play/tennis/',
    fromController: ['pose', 'swing', 'calibrate', 'start_game'],
    fromDisplay: ['game_state', 'cue', 'result'],
    volatile: ['pose']
  },
  airhockey: {
    title: '에어하키',
    play: '/play/airhockey/',
    fromController: ['move', 'start_game'],
    fromDisplay: ['game_state', 'goal', 'hit'],
    volatile: ['move']
  },
  kart: {
    title: '카트 레이스',
    play: '/play/kart/',
    fromController: ['drive', 'item', 'calibrate', 'start_game'],
    fromDisplay: ['game_state', 'cue', 'result'],
    volatile: ['drive']
  },
  gun: {
    title: '좀비 건 아케이드',
    play: '/play/gun/',
    max: 8,
    fromController: ['aim', 'shoot', 'reload', 'calibrate', 'start_game'],
    fromDisplay: ['game_state', 'cue', 'result', 'hit'],
    volatile: ['aim']
  },
  putting: {
    title: '퍼팅 챌린지',
    play: '/play/putting/',
    fromController: ['pose', 'aim', 'address', 'stroke', 'cancel', 'start_game'],
    fromDisplay: ['game_state', 'result'],
    volatile: ['pose', 'aim']
  }
};

const PLAYER_SLOTS = {
  1: { slot: 1, name: '1P', color: '#ff5a5f' },
  2: { slot: 2, name: '2P', color: '#3ab4ff' },
  3: { slot: 3, name: '3P', color: '#ffc93c' },
  4: { slot: 4, name: '4P', color: '#5ee07a' },
  5: { slot: 5, name: '5P', color: '#c77dff' },
  6: { slot: 6, name: '6P', color: '#ff8fd1' },
  7: { slot: 7, name: '7P', color: '#3ee6d6' },
  8: { slot: 8, name: '8P', color: '#ff9b3d' }
};

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
// 3D 엔진과 글꼴은 npm 패키지에서 바로 내보냅니다. 외부 CDN 에 기대지 않습니다.
const mod = (p) => path.join(__dirname, 'node_modules', p);
const longCache = { maxAge: '7d', immutable: true };
app.use('/vendor/three', express.static(mod('three/build'), longCache));
app.use('/vendor/three-addons', express.static(mod('three/examples/jsm'), longCache));
app.use('/vendor/pretendard', express.static(mod('pretendard/dist/web'), longCache));
app.use('/vendor/anton', express.static(mod('@fontsource/anton'), longCache));
app.get('/healthz', (req, res) => res.json({ ok: true }));

// 방 코드는 헷갈리는 글자(0/O, 1/I)를 뺀 4글자입니다.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map();

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

function cleanCode(code) {
  return typeof code === 'string' ? code.trim().toUpperCase().slice(0, 8) : '';
}

function cleanToken(token) {
  if (typeof token !== 'string') return null;
  const t = token.trim().slice(0, 64);
  return t.length >= 6 ? t : null;
}

app.get('/api/qr', async (req, res) => {
  const code = cleanCode(req.query.room);
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error: 'room not found' });
  const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  const url = `${proto}://${req.headers.host}${GAMES[room.game].play}?room=${code}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 360 });
  res.json({ url, qr, secure: proto === 'https' });
});

const httpServer = http.createServer(app);
// 폰이 조용히 끊긴 것(LTE 음영, 화면 잠금)을 빨리 알아채도록 하트비트를 짧게 둡니다.
const io = new Server(httpServer, { pingInterval: 6000, pingTimeout: 5000 });
const CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/;

function publicPlayer(entry) {
  return { ...PLAYER_SLOTS[entry.slot], connected: entry.connected };
}

function playerList(room) {
  return [...room.slots.values()].sort((a, b) => a.slot - b.slot).map(publicPlayer);
}

function broadcastPlayers(room) {
  const payload = { players: playerList(room), max: maxOf(room) };
  io.to(`${room.code}:display`).emit('players', payload);
  io.to(`${room.code}:controllers`).emit('players', payload);
  // 사람이 들어오거나 나가면 준비 인원을 다시 셉니다(준비 안 한 사람이 나가면 바로 시작될 수 있음).
  if (room.ready) {
    for (const s of room.ready) if (!room.slots.get(s) || !room.slots.get(s).connected) room.ready.delete(s);
    if (room.ready.size) checkReady(room);
    else emitReady(room);
  }
}

// 모두 준비: 폰의 start_game 은 바로 넘기지 않고, 연결된 사람이 모두 누르면 그때 화면에 한 번 넘깁니다.
// gate:false 인 종목(늘 열린 낚시)은 예전처럼 바로 넘깁니다.
function readyState(room) {
  const live = [...room.slots.values()].filter((e) => e.connected).map((e) => e.slot);
  const ready = live.filter((s) => room.ready.has(s));
  return { ready, players: live, need: live.length };
}
function emitReady(room) {
  const st = readyState(room);
  io.to(`${room.code}:display`).emit('ready_state', st);
  io.to(`${room.code}:controllers`).emit('ready_state', st);
  return st;
}
function checkReady(room, data) {
  const st = emitReady(room);
  if (!st.need || st.ready.length < st.need) return;
  room.ready.clear();
  emitReady(room);
  io.to(`${room.code}:display`).emit('start_game', data || { slot: st.ready[0] });
}

function scheduleRoomCleanup(room) {
  clearTimeout(room.cleanup);
  room.cleanup = setTimeout(() => {
    if (room.displayId) return;
    for (const entry of room.slots.values()) clearTimeout(entry.timer);
    rooms.delete(room.code);
    io.to(`${room.code}:controllers`).emit('room_closed');
  }, ROOM_TTL_MS);
}

function makeRoom(code, game) {
  // tokens: 방이 살아 있는 동안 폰 토큰 → 자리 번호. 자리를 비운 뒤 돌아와도 원래 자리를 먼저 줍니다.
  const room = { code, game, slots: new Map(), tokens: new Map(), ready: new Set(), displayId: null, lastState: { phase: 'lobby' } };
  rooms.set(code, room);
  return room;
}

function registerDisplay(socket, payload) {
  const game = typeof payload.game === 'string' && Object.hasOwn(GAMES, payload.game) ? payload.game : 'baseball';
  const saved = cleanCode(payload.room);
  let room = rooms.get(saved);
  let fresh = false;
  // 같은 방 코드로 다시 열면(새로고침) 그 방을 이어받습니다.
  // 서버가 다시 떠서 방이 사라졌으면 같은 코드로 새로 만들어, 폰들이 같은 QR 로 돌아올 수 있게 합니다.
  if (!room || room.game !== game) {
    fresh = true;
    room = !room && CODE_RE.test(saved) ? makeRoom(saved, game) : makeRoom(newCode(), game);
  }
  clearTimeout(room.cleanup);
  if (room.displayId && room.displayId !== socket.id) {
    const old = io.sockets.sockets.get(room.displayId);
    if (old) {
      old.leave(`${room.code}:display`);
      old.data.role = 'retired';
      old.emit('display_replaced');
    }
  }
  room.displayId = socket.id;
  room.lastState = { phase: 'lobby' };
  socket.data = { role: 'display', room: room.code };
  socket.join(`${room.code}:display`);
  socket.emit('room', { code: room.code, game, fresh, players: playerList(room), max: maxOf(room) });
  io.to(`${room.code}:controllers`).emit('display_status', { connected: true });
}

function registerController(socket, payload) {
  const room = rooms.get(cleanCode(payload.room));
  if (!room) {
    socket.emit('no_room');
    return;
  }
  const token = cleanToken(payload.token);
  let entry = token ? [...room.slots.values()].find((e) => e.token === token) : null;
  let rejoined = false;
  if (entry) {
    rejoined = true;
    clearTimeout(entry.timer);
    if (entry.socketId && entry.socketId !== socket.id) {
      const old = io.sockets.sockets.get(entry.socketId);
      if (old) {
        old.leave(`${room.code}:controllers`);
        old.leave(`${room.code}:slot:${entry.slot}`);
        old.data.role = 'retired';
        old.emit('replaced');
      }
    }
  } else {
    let free = null;
    const before = token ? room.tokens.get(token) : null;
    if (before && !room.slots.has(before)) free = before;
    for (let s = 1; s <= maxOf(room) && !free; s++) {
      if (!room.slots.has(s)) free = s;
    }
    if (!free) {
      socket.emit('room_full', { max: maxOf(room) });
      return;
    }
    entry = { slot: free, token: token || `anon-${socket.id}` };
    room.slots.set(free, entry);
    room.tokens.set(entry.token, free);
  }
  entry.socketId = socket.id;
  entry.connected = true;
  entry.timer = null;
  socket.data = { role: 'controller', room: room.code, slot: entry.slot };
  socket.join(`${room.code}:controllers`);
  socket.join(`${room.code}:slot:${entry.slot}`);
  socket.emit('assigned', { ...publicPlayer(entry), rejoined, game: room.game, code: room.code });
  socket.emit('display_status', { connected: Boolean(room.displayId) });
  socket.emit('game_state', room.lastState);
  broadcastPlayers(room);
}

// 이벤트 처리기 하나가 예외를 던져도 프로세스가 죽지 않게 감쌉니다.
function safe(fn) {
  return (...a) => {
    try {
      fn(...a);
    } catch (err) {
      console.error('[socket handler]', err);
    }
  };
}

io.on('connection', (socket) => {
  // 지연 측정용. 폰과 화면이 각자 서버까지 왕복 시간을 잽니다.
  socket.on('ping_rtt', (t, ack) => typeof ack === 'function' && ack(t));

  socket.on('join', safe((payload) => {
    if (!payload || typeof payload !== 'object') return;
    if (payload.role === 'display') registerDisplay(socket, payload);
    else if (payload.role === 'controller') registerController(socket, payload);
  }));

  // 폰 -> 화면: 보낸 폰의 자리 번호를 붙여서 그 방 화면에만 전달합니다.
  socket.on('c2d', safe((msg) => {
    const { role, room: code, slot } = socket.data || {};
    const room = rooms.get(code);
    if (role !== 'controller' || !room || !msg) return;
    const entry = room.slots.get(slot);
    if (!entry || entry.socketId !== socket.id) return;
    if (typeof msg.event !== 'string' || !GAMES[room.game].fromController.includes(msg.event)) return;
    const data = msg.data && typeof msg.data === 'object' ? { ...msg.data } : {};
    data.slot = slot;
    if (msg.event === 'start_game' && GAMES[room.game].gate !== false) {
      room.ready.add(slot);
      checkReady(room, data);
      return;
    }
    const target = io.to(`${code}:display`);
    (GAMES[room.game].volatile.includes(msg.event) ? target.volatile : target).emit(msg.event, data);
  }));

  // 화면 -> 폰: slot 이 있으면 그 폰에만, 없으면 방 안의 모든 폰에 보냅니다.
  socket.on('d2c', safe((msg) => {
    const { role, room: code } = socket.data || {};
    const room = rooms.get(code);
    if (role !== 'display' || !room || room.displayId !== socket.id || !msg) return;
    if (typeof msg.event !== 'string' || !GAMES[room.game].fromDisplay.includes(msg.event)) return;
    if (msg.event === 'game_state' && msg.data && typeof msg.data.phase === 'string') {
      room.lastState = { ...msg.data };
      // 경기가 시작되면 준비 표시는 지웁니다(다음 판도 다시 모두 준비).
      if (msg.data.phase === 'playing' && room.ready.size) {
        room.ready.clear();
        emitReady(room);
      }
    }
    const slot = Number(msg.slot);
    const target = PLAYER_SLOTS[slot] ? `${code}:slot:${slot}` : `${code}:controllers`;
    io.to(target).emit(msg.event, msg.data || {});
  }));

  socket.on('disconnect', safe(() => {
    const { role, room: code, slot } = socket.data || {};
    const room = rooms.get(code);
    if (!room) return;
    if (role === 'display' && room.displayId === socket.id) {
      room.displayId = null;
      io.to(`${code}:controllers`).emit('display_status', { connected: false });
      scheduleRoomCleanup(room);
      return;
    }
    if (role !== 'controller') return;
    const entry = room.slots.get(slot);
    if (!entry || entry.socketId !== socket.id) return;
    entry.connected = false;
    entry.socketId = null;
    // 경기 중에는 자리를 지우지 않고 계속 잡아 둡니다(화면이 그 차례를 건너뜀). 경기가 끝난 뒤에 비웁니다.
    const release = () => {
      if (entry.connected || room.slots.get(slot) !== entry) return;
      if (room.lastState.phase === 'playing') {
        entry.timer = setTimeout(release, RESERVE_MS);
        return;
      }
      room.slots.delete(slot);
      broadcastPlayers(room);
    };
    entry.timer = setTimeout(release, RESERVE_MS);
    broadcastPlayers(room);
  }));
});

if (require.main === module) {
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`phone-controller-games: http://localhost:${httpServer.address().port}`);
  });
}

module.exports = { httpServer, io, rooms };
