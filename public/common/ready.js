// 모두 준비 표시: 큰 화면과 폰 모두에 붙는 작은 띠입니다.
// 게임 스크립트보다 먼저 불러서 io() 가 만드는 소켓에 'ready_state' 듣기를 붙입니다.
(function () {
  const orig = window.io;
  if (!orig || orig.__ready) return;
  const isPhone = location.pathname.startsWith('/play');
  let bar = null;
  let mySlot = null;
  function ensure() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'readyBar';
    bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);z-index:9999;pointer-events:none;' +
      'font:600 ' + (isPhone ? '15px' : '20px') + '/1.3 Pretendard,system-ui,sans-serif;color:#fff;' +
      'background:rgba(10,14,22,.82);border-radius:999px;padding:' + (isPhone ? '8px 16px' : '10px 22px') + ';' +
      (isPhone ? 'bottom:16px;' : 'top:18px;') + 'display:none;white-space:nowrap;box-shadow:0 6px 24px rgba(0,0,0,.35)';
    document.body.appendChild(bar);
    return bar;
  }
  const COLORS = { 1: '#ff5a5f', 2: '#3ab4ff', 3: '#ffc93c', 4: '#5ee07a', 5: '#c77dff', 6: '#ff8fd1', 7: '#3ee6d6', 8: '#ff9b3d' };
  function show(st) {
    const b = ensure();
    if (!st || !st.ready || !st.ready.length || st.ready.length >= st.need) { b.style.display = 'none'; return; }
    const dots = st.players.map((s) => {
      const on = st.ready.includes(s);
      return '<span style="display:inline-block;margin:0 3px;padding:1px 8px;border-radius:999px;' +
        (on ? 'background:' + COLORS[s] + ';color:#0b1420' : 'box-shadow:inset 0 0 0 1.5px ' + COLORS[s] + ';color:' + COLORS[s]) +
        '">' + s + 'P</span>';
    }).join('');
    const mine = isPhone && mySlot != null && st.ready.includes(mySlot);
    const head = isPhone ? (mine ? '준비 완료 · 다른 사람 기다리는 중' : '다른 사람이 준비했어요 · 시작을 누르세요') : `준비 ${st.ready.length}/${st.need} · 모두 누르면 시작`;
    b.innerHTML = head + '&nbsp;&nbsp;' + dots;
    b.style.display = 'block';
  }
  function wrap(...a) {
    const s = orig(...a);
    try {
      s.on('ready_state', show);
      s.on('assigned', (d) => { if (d && d.slot != null) mySlot = Number(d.slot); });
    } catch (e) {}
    return s;
  }
  Object.assign(wrap, orig);
  wrap.__ready = true;
  window.io = wrap;
})();
