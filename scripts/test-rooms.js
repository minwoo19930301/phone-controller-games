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

  // 경기 중에는 끊겨도 자리를 잡아 둠
  phones[3].disconnect();
  await wait(500);
  const late = mk();
  late.emit('join', { role: 'controller', room: roomA.code, token: 'token-8-abcdef' });
  await once(late, 'room_full');

  // 경기가 끝나면 유예 시간 뒤 자리가 비고, 새 폰이 그 자리를 받음
  dA.emit('d2c', { event: 'game_state', data: { phase: 'over' } });
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

  // 골프 방: 컨트롤러 주소와 이벤트 목록이 종목별로 갈림
  const dG = mk();
  dG.emit('join', { role: 'display', game: 'golf' });
  const roomG = await once(dG, 'room');
  assert.strictEqual(roomG.game, 'golf');
  const qrG = await fetch(`${url}/api/qr?room=${roomG.code}`).then((r) => r.json());
  assert.ok(qrG.url.endsWith(`/play/golf/?room=${roomG.code}`));
  const g1 = mk();
  g1.emit('join', { role: 'controller', room: roomG.code, token: 'golf-1-abcdef' });
  assert.strictEqual((await once(g1, 'assigned')).game, 'golf');
  g1.emit('c2d', { event: 'pose', data: { s: [0, -1, 0] } });
  assert.deepStrictEqual((await once(dG, 'pose')).s, [0, -1, 0]);
  let swingInGolf = false;
  dG.on('swing', () => { swingInGolf = true; });
  g1.emit('c2d', { event: 'swing', data: {} });

  // 잘못된 종목 이름(프로토타입 키)으로 서버가 죽지 않음
  const evil = mk();
  evil.emit('join', { role: 'display', game: 'constructor' });
  const er = await once(evil, 'room');
  assert.strictEqual(er.game, 'baseball');
  evil.emit('d2c', { event: 'x' });
  evil.emit('d2c', { event: { toString: 1 } });

  // 사라진 방 코드로 화면이 다시 들어오면 같은 코드로 새 방을 만듦(서버 재시작 흉내)
  const ghost = mk();
  ghost.emit('join', { role: 'display', game: 'golf', room: 'WXYZ' });
  const gr = await once(ghost, 'room');
  assert.strictEqual(gr.code, 'WXYZ');
  assert.strictEqual(gr.fresh, true);

  // 자리를 비운 뒤에도 같은 토큰은 원래 자리로 돌아옴
  const p1 = mk();
  p1.emit('join', { role: 'controller', room: 'WXYZ', token: 'back-1-abcdef' });
  await once(p1, 'assigned');
  const p2 = mk();
  p2.emit('join', { role: 'controller', room: 'WXYZ', token: 'back-2-abcdef' });
  assert.strictEqual((await once(p2, 'assigned')).slot, 2);
  p1.disconnect();
  p2.disconnect();
  await wait(500);
  const p2b = mk();
  p2b.emit('join', { role: 'controller', room: 'WXYZ', token: 'back-2-abcdef' });
  assert.strictEqual((await once(p2b, 'assigned')).slot, 2, '먼저 돌아온 2P 가 1번 자리를 가져가면 안 됨');

  // 모두 준비: 테니스 방에 둘이 있으면 한 명만 눌러서는 시작하지 않고, 둘 다 누르면 한 번 시작
  const dT = mk();
  dT.emit('join', { role: 'display', game: 'tennis' });
  const roomT = await once(dT, 'room');
  const t1 = mk();
  t1.emit('join', { role: 'controller', room: roomT.code, token: 'ten-1-abcdef' });
  await once(t1, 'assigned');
  const t2 = mk();
  t2.emit('join', { role: 'controller', room: roomT.code, token: 'ten-2-abcdef' });
  await once(t2, 'assigned');
  let starts = 0;
  dT.on('start_game', () => { starts += 1; });
  await wait(100);
  const rsP = new Promise((r) => dT.on('ready_state', (d) => { if (d.ready.length) r(d); }));
  t1.emit('c2d', { event: 'start_game', data: {} });
  const rs = await rsP;
  assert.deepStrictEqual([rs.ready, rs.need], [[1], 2]);
  await wait(100);
  assert.strictEqual(starts, 0, '한 명만 준비했는데 시작됨');
  t2.emit('c2d', { event: 'start_game', data: {} });
  await wait(150);
  assert.strictEqual(starts, 1, '둘 다 준비하면 한 번 시작');
  // 다시 한 명 준비 후 준비 안 한 사람이 나가면 바로 시작
  t1.emit('c2d', { event: 'start_game', data: {} });
  await wait(80);
  t2.disconnect();
  await wait(200);
  assert.strictEqual(starts, 2, '준비 안 한 사람이 나가면 남은 사람끼리 시작');

  // ping
  const t = await new Promise((r) => dA2.emit('ping_rtt', 42, r));
  assert.strictEqual(t, 42);

  await wait(150);
  assert.ok(!leaked, '다른 방 화면으로 새면 안 됨');
  assert.ok(!bad, '허용 안 된 이벤트가 전달됨');
  assert.ok(!wrong, '다른 자리 폰에 전달됨');
  assert.ok(!swingInGolf, '골프 방에 야구 이벤트가 전달됨');

  sockets.forEach((s) => s.close());
  httpServer.close();
  io_close();
  console.log('ok: 방·자리·중계 검사 통과');
  process.exit(0);
}
function io_close() { require('../server').io.close(); }
main().catch((e) => { console.error(e); process.exit(1); });
