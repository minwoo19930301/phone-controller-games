const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const PORT = process.env.PORT || process.argv[2] || 3000;
const MAX_PLAYERS = 4;
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
    fromController: ['swing', 'start_game', 'ready'],
    fromDisplay: ['game_state', 'turn', 'pitch', 'result'],
    volatile: []
  },
  golf: {
    title: '골프 니어핀',
    play: '/play/golf/',
    fromController: ['pose', 'aim', 'club', 'address', 'impact', 'start_game', 'cancel'],
    fromDisplay: ['game_state', 'result', 'calibrated'],
    volatile: ['pose', 'aim']
  }
};

const PLAYER_SLOTS = {
  1: { slot: 1, name: '1P', color: '#ff5a5f' },
  2: { slot: 2, name: '2P', color: '#3ab4ff' },
  3: { slot: 3, name: '3P', color: '#ffc93c' },
  4: { slot: 4, name: '4P', color: '#5ee07a' }
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
const io = new Server(httpServer, { pingInterval: 10000, pingTimeout: 8000 });

function publicPlayer(entry) {
  return { ...PLAYER_SLOTS[entry.slot], connected: entry.connected };
}

function playerList(room) {
  return [...room.slots.values()].sort((a, b) => a.slot - b.slot).map(publicPlayer);
}

function broadcastPlayers(room) {
  const payload = { players: playerList(room), max: MAX_PLAYERS };
  io.to(`${room.code}:display`).emit('players', payload);
  io.to(`${room.code}:controllers`).emit('players', payload);
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

function registerDisplay(socket, payload) {
  const game = GAMES[payload.game] ? payload.game : 'baseball';
  let room = rooms.get(cleanCode(payload.room));
  // 같은 방 코드로 다시 열면(새로고침) 그 방을 이어받습니다.
  if (!room || room.game !== game) {
    room = { code: newCode(), game, slots: new Map(), displayId: null, lastState: { phase: 'lobby' } };
    rooms.set(room.code, room);
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
  socket.emit('room', { code: room.code, game, players: playerList(room), max: MAX_PLAYERS });
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
    for (let s = 1; s <= MAX_PLAYERS; s++) {
      if (!room.slots.has(s)) {
        free = s;
        break;
      }
    }
    if (!free) {
      socket.emit('room_full', { max: MAX_PLAYERS });
      return;
    }
    entry = { slot: free, token: token || `anon-${socket.id}` };
    room.slots.set(free, entry);
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

io.on('connection', (socket) => {
  // 지연 측정용. 폰과 화면이 각자 서버까지 왕복 시간을 잽니다.
  socket.on('ping_rtt', (t, ack) => typeof ack === 'function' && ack(t));

  socket.on('join', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    if (payload.role === 'display') registerDisplay(socket, payload);
    else if (payload.role === 'controller') registerController(socket, payload);
  });

  // 폰 -> 화면: 보낸 폰의 자리 번호를 붙여서 그 방 화면에만 전달합니다.
  socket.on('c2d', (msg) => {
    const { role, room: code, slot } = socket.data || {};
    const room = rooms.get(code);
    if (role !== 'controller' || !room || !msg) return;
    const entry = room.slots.get(slot);
    if (!entry || entry.socketId !== socket.id) return;
    if (!GAMES[room.game].fromController.includes(msg.event)) return;
    const data = msg.data && typeof msg.data === 'object' ? { ...msg.data } : {};
    data.slot = slot;
    const target = io.to(`${code}:display`);
    (GAMES[room.game].volatile.includes(msg.event) ? target.volatile : target).emit(msg.event, data);
  });

  // 화면 -> 폰: slot 이 있으면 그 폰에만, 없으면 방 안의 모든 폰에 보냅니다.
  socket.on('d2c', (msg) => {
    const { role, room: code } = socket.data || {};
    const room = rooms.get(code);
    if (role !== 'display' || !room || room.displayId !== socket.id || !msg) return;
    if (!GAMES[room.game].fromDisplay.includes(msg.event)) return;
    if (msg.event === 'game_state' && msg.data && typeof msg.data.phase === 'string') {
      room.lastState = { ...msg.data };
    }
    const slot = Number(msg.slot);
    const target = PLAYER_SLOTS[slot] ? `${code}:slot:${slot}` : `${code}:controllers`;
    io.to(target).emit(msg.event, msg.data || {});
  });

  socket.on('disconnect', () => {
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
    entry.timer = setTimeout(() => {
      room.slots.delete(slot);
      broadcastPlayers(room);
    }, RESERVE_MS);
    broadcastPlayers(room);
  });
});

if (require.main === module) {
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`phone-controller-games: http://localhost:${httpServer.address().port}`);
  });
}

module.exports = { httpServer, io, rooms };
