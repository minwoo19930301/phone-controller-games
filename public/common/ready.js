// 모두 준비 표시: 큰 화면과 폰 모두에 붙는 작은 띠입니다.
// 게임 스크립트보다 먼저 불러서 io() 가 만드는 소켓에 'ready_state' 듣기를 붙입니다.
//
// 큰 화면에서는 "들어온 사람이 모두 준비를 눌러야 시작" 을 지킵니다.
// 서버는 폰의 start_game 을 모두 준비될 때까지 막아 두지만, 큰 화면의 Enter 는 게임 코드가 바로 시작해 버립니다.
// 그래서 대기실·결과 화면에서 폰이 한 대라도 들어와 있고 아직 모두 준비가 아니면 Enter 를 여기서 먼저 가로챕니다.
// 폰이 한 대도 없으면(봇·키보드 시험) Enter 는 그대로 통과합니다.
(function () {
  const orig = window.io;
  if (!orig || orig.__ready) return;
  const isPhone = location.pathname.startsWith('/play');
  let bar = null;
  let mySlot = null;
  let last = null; // 마지막 ready_state
  let phase = 'lobby'; // 큰 화면이 보낸 마지막 game_state.phase
  let nagUntil = 0;
  function ensure() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'readyBar';
    bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);z-index:9999;pointer-events:none;' +
      'font:600 ' + (isPhone ? '15px' : '20px') + '/1.3 Pretendard,system-ui,sans-serif;color:#fff;' +
      'background:rgba(10,14,22,.82);border-radius:999px;padding:' + (isPhone ? '8px 16px' : '10px 22px') + ';' +
      (isPhone ? 'bottom:16px;' : 'top:18px;') + 'display:none;white-space:nowrap;box-shadow:0 6px 24px rgba(0,0,0,.35);transition:box-shadow .2s';
    document.body.appendChild(bar);
    return bar;
  }
  const COLORS = { 1: '#ff5a5f', 2: '#3ab4ff', 3: '#ffc93c', 4: '#5ee07a', 5: '#c77dff', 6: '#ff8fd1', 7: '#3ee6d6', 8: '#ff9b3d' };
  // 대기실·결과 화면만. 새 종목이 다른 단계 이름(곡 고르기 등)을 쓰면 game_state 에 waiting:true 를 같이 보내면 됩니다.
  let waitingFlag = false;
  const waiting = () => phase === 'lobby' || phase === 'over' || waitingFlag;
  const allReady = (st) => !st || !st.need || (st.ready && st.ready.length >= st.need);
  function show(st) {
    if (st) last = st;
    st = last;
    const b = ensure();
    const nag = !isPhone && Date.now() < nagUntil;
    // 폰: 누군가 준비를 눌렀을 때만. 큰 화면: 대기 중이고 폰이 들어와 있으면 늘(아무도 안 눌렀어도) 보여 줍니다.
    const visible = st && st.need && !allReady(st) && (isPhone ? st.ready.length > 0 : waiting());
    if (!visible) { b.style.display = 'none'; return; }
    const away = st.away || [];
    const dots = st.players.map((s) => {
      const on = st.ready.includes(s);
      const off = away.includes(s);
      return '<span style="display:inline-block;margin:0 3px;padding:1px 8px;border-radius:999px;' + (off ? 'opacity:.45;' : '') +
        (on ? 'background:' + COLORS[s] + ';color:#0b1420' : 'box-shadow:inset 0 0 0 1.5px ' + COLORS[s] + ';color:' + COLORS[s]) +
        '">' + s + 'P' + (off ? ' 끊김' : '') + '</span>';
    }).join('');
    const mine = isPhone && mySlot != null && st.ready.includes(mySlot);
    let head;
    if (isPhone) head = mine ? '준비 완료 · 다른 사람 기다리는 중' : '다른 사람이 준비했어요 · 준비를 누르세요';
    else if (nag) head = `모두 준비해야 시작해요 · 준비 ${st.ready.length}/${st.need}`;
    else head = `준비 ${st.ready.length}/${st.need} · 폰에서 모두 준비를 누르면 시작`;
    b.innerHTML = head + '&nbsp;&nbsp;' + dots;
    b.style.boxShadow = nag ? '0 0 0 3px #ffc93c, 0 6px 24px rgba(0,0,0,.35)' : '0 6px 24px rgba(0,0,0,.35)';
    b.style.display = 'block';
  }
  if (!isPhone) {
    // 게임 코드의 keydown 보다 먼저 받도록 window 캡처 단계에 붙입니다.
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !waiting() || allReady(last)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      nagUntil = Date.now() + 2500;
      show();
      setTimeout(show, 2600);
    }, true);
  }
  function wrap(...a) {
    const s = orig(...a);
    try {
      s.on('ready_state', show);
      s.on('assigned', (d) => { if (d && d.slot != null) mySlot = Number(d.slot); });
      if (!isPhone) {
        // 큰 화면이 폰들에게 보내는 game_state 를 엿봐서 지금이 대기실인지 경기 중인지 압니다.
        const emit = s.emit.bind(s);
        s.emit = (ev, msg, ...rest) => {
          if (ev === 'd2c' && msg && msg.event === 'game_state' && msg.data && typeof msg.data.phase === 'string') {
            phase = msg.data.phase;
            waitingFlag = msg.data.waiting === true;
            show();
          }
          return emit(ev, msg, ...rest);
        };
        s.on('room', (r) => { if (r && r.fresh) { phase = 'lobby'; show(); } });
      }
    } catch (e) {}
    return s;
  }
  Object.assign(wrap, orig);
  wrap.__ready = true;
  window.io = wrap;
  window.__readyGate = { state: () => last, phase: () => phase, allReady: () => allReady(last) };
})();
