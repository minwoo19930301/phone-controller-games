// 폰 없이 서버의 방·자리·중계 규칙을 검사합니다.
const assert = require('assert');
const { io: client } = require('socket.io-client');
process.env.RESERVE_MS = '300';
const { httpServer } = require('../server');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev, ms = 1500) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout: ${ev}`)), ms);
    s.once(ev, (d) => { clearTimeout(t); res(d); });
  });

async function main() {
  await new Promise((r) => httpServer.listen(0, r));
  const url = `http://localhost:${httpServer.address().port}`;
  const sockets = [];
  const mk = () => { const s = client(url, { transports: ['websocket'], forceNew: true }); sockets.push(s); return s; };

  // 큰 화면 두 개 = 방 두 개
  const dA = mk();
  dA.emit('join', { role: 'display', game: 'baseball' });
  const roomA = await once(dA, 'room');
  const dB = mk();
  dB.emit('join', { role: 'display', game: 'baseball' });
  const roomB = await once(dB, 'room');
  assert.notStrictEqual(roomA.code, roomB.code);
  assert.match(roomA.code, /^[A-HJ-NP-Z2-9]{4}$/);

  // QR 엔드포인트
  const qr = await fetch(`${url}/api/qr?room=${roomA.code}`).then((r) => r.json());
  assert.ok(qr.qr.startsWith('data:image/png'));
  assert.ok(qr.url.endsWith(`/play/?room=${roomA.code}`));
  assert.strictEqual((await fetch(`${url}/api/qr?room=ZZZZ`)).status, 404);

  // 4명까지 들어오고 5번째는 거절
  const phones = [];
  for (let i = 0; i < 4; i++) {
    const c = mk();
    c.emit('join', { role: 'controller', room: roomA.code.toLowerCase(), token: `token-${i}-abcdef` });
    const a = await once(c, 'assigned');
    assert.strictEqual(a.slot, i + 1);
    phones.push(c);
  }
  const fifth = mk();
  fifth.emit('join', { role: 'controller', room: roomA.code, token: 'token-5-abcdef' });
  await once(fifth, 'room_full');

  // 없는 방
  const lost = mk();
  lost.emit('join', { role: 'controller', room: 'QQQQ', token: 'token-x-abcdef' });
  await once(lost, 'no_room');

  // 폰 -> 자기 방 화면에만, slot 이 붙어서
  let leaked = false;
  dB.on('swing', () => { leaked = true; });
  phones[2].emit('c2d', { event: 'swing', data: { power: 0.7, slot: 4 } });
  const sw = await once(dA, 'swing');
  assert.strictEqual(sw.slot, 3, '폰이 보낸 slot 은 서버 값으로 덮어써야 함');
  assert.strictEqual(sw.power, 0.7);
  // 허용 안 된 이벤트는 버림
  let bad = false;
  dA.on('hack', () => { bad = true; });
  phones[0].emit('c2d', { event: 'hack', data: {} });

  // 화면 -> 특정 폰
  let wrong = false;
  phones[0].on('result', () => { wrong = true; });
  dA.emit('d2c', { event: 'result', slot: 2, data: { text: '홈런!' } });
  assert.strictEqual((await once(phones[1], 'result')).text, '홈런!');
  // 화면 -> 모든 폰
  dA.emit('d2c', { event: 'game_state', data: { phase: 'playing', batter: 1 } });
  await Promise.all(phones.map((p) => once(p, 'game_state')));
  // 폰은 화면 이벤트를 보낼 수 없음
  phones[0].emit('d2c', { event: 'result', data: { text: 'x' } });

  // 끊겼다가 같은 토큰으로 돌아오면 같은 자리
  phones[1].disconnect();
  await wait(100);
  const back = mk();
  const backWait = Promise.all([once(back, 'assigned'), once(back, 'game_state')]);
  back.emit('join', { role: 'controller', room: roomA.code, token: 'token-1-abcdef' });
  const [again, gs] = await backWait;
  assert.strictEqual(again.slot, 2);
  assert.strictEqual(again.rejoined, true);
  assert.strictEqual(gs.phase, 'playing', '다시 들어온 폰은 지금 경기 상태를 바로 받아야 함');

  // 유예 시간이 지나면 자리가 비고, 새 폰이 그 자리를 받음
  phones[3].disconnect();
  await wait(500);
  const newbie = mk();
  newbie.emit('join', { role: 'controller', room: roomA.code, token: 'token-9-abcdef' });
  assert.strictEqual((await once(newbie, 'assigned')).slot, 4);

  // 화면 새로고침: 같은 방 코드로 이어받고, 예전 화면은 쉼
  const dA2 = mk();
  dA2.emit('join', { role: 'display', game: 'baseball', room: roomA.code });
  const [r2] = await Promise.all([once(dA2, 'room'), once(dA, 'display_replaced')]);
  assert.strictEqual(r2.code, roomA.code);
  assert.strictEqual(r2.players.length, 4);

  // ping
  const t = await new Promise((r) => dA2.emit('ping_rtt', 42, r));
  assert.strictEqual(t, 42);

  await wait(150);
  assert.ok(!leaked, '다른 방 화면으로 새면 안 됨');
  assert.ok(!bad, '허용 안 된 이벤트가 전달됨');
  assert.ok(!wrong, '다른 자리 폰에 전달됨');

  sockets.forEach((s) => s.close());
  httpServer.close();
  io_close();
  console.log('ok: 방·자리·중계 검사 통과');
  process.exit(0);
}
function io_close() { require('../server').io.close(); }
main().catch((e) => { console.error(e); process.exit(1); });
