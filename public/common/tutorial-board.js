// 연습(튜토리얼) 현황 판 공통 모듈 (큰 화면 쪽).
//
// 폰이 보내는 tutorial {step, total, title, done, skipped} 를 받아 대기실에 사람마다 작은 칸을 띄웁니다:
// "2P 연습 중 2/4 · 휘둘러 보기". 다른 사람은 왜 기다리는지 알 수 있습니다. 끝나면 ✓ 를 잠깐 보이고 사라집니다.
//
//   const board = createTutorialBoard();      // 화면 아래 가운데에 떠 있는 판(mount 를 주면 그 안에)
//   board.attach(socket);                     // tutorial·players 듣기
//   board.practicing();                       // 지금 연습 중인 자리 번호들
//   board.hide(true);                         // 경기 중에는 숨기기

const COLORS = { 1: '#ff5a5f', 2: '#3ab4ff', 3: '#ffc93c', 4: '#5ee07a', 5: '#c77dff', 6: '#ff8fd1', 7: '#3ee6d6', 8: '#ff9b3d' };
const STALE_MS = 120000; // 이만큼 소식이 없으면(폰을 내려놓음) 칸을 지웁니다
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
.pcgb{--_sans:"Pretendard Variable",Pretendard,-apple-system,"Apple SD Gothic Neo",system-ui,sans-serif;
  display:flex;flex-direction:column;align-items:center;gap:10px;margin:0;padding:0;color:#f5f4ee;font-family:var(--_sans);
  font-size:16px;line-height:1.3;text-align:left;white-space:normal;pointer-events:none;box-sizing:border-box;}
.pcgb *{box-sizing:border-box;}
.pcgb.float{position:fixed;left:50%;transform:translateX(-50%);z-index:9000;max-width:calc(100vw - 40px);}
.pcgb.float.bottom{bottom:28px;}
.pcgb.float.top{top:78px;}
.pcgb.inline{align-items:stretch;width:100%;}
.pcgb.inline .pcgb-head{align-self:flex-start;}
.pcgb.inline .pcgb-tile{flex:1 1 260px;min-width:0;max-width:none;}
.pcgb[hidden],.pcgb-head[hidden]{display:none;}
.pcgb-head{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;background:rgba(8,13,28,.7);
  border:1px solid rgba(255,255,255,.12);font-size:14px;font-weight:800;color:#cdd7e6;letter-spacing:-.01em;
  -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);}
.pcgb-head i{width:8px;height:8px;border-radius:50%;background:#ffd23a;box-shadow:0 0 10px #ffd23a;animation:pcgb-blink .7s infinite alternate;}
.pcgb-tiles{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;}
.pcgb.inline .pcgb-tiles{justify-content:flex-start;}
.pcgb-tile{position:relative;display:flex;align-items:center;gap:12px;min-width:290px;max-width:380px;padding:12px 16px 12px 12px;border-radius:18px;
  background:linear-gradient(120deg,color-mix(in srgb,var(--pc) 26%,rgba(10,16,32,.9)),rgba(10,16,32,.9) 65%);
  border:1.5px solid color-mix(in srgb,var(--pc) 70%,transparent);box-shadow:0 12px 36px rgba(0,0,0,.35);
  -webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);animation:pcgb-in .45s cubic-bezier(.2,1.3,.4,1);
  transition:opacity .5s,transform .5s;}
.pcgb-tile.out{opacity:0;transform:translateY(10px) scale(.96);}
.pcgb-tile.away{opacity:.5;}
.pcgb-badge{flex:none;display:grid;place-items:center;width:54px;height:54px;border-radius:15px;background:var(--pc);color:#0b1220;
  font-family:Anton,Impact,sans-serif;font-size:24px;letter-spacing:.02em;}
.pcgb-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;}
.pcgb-line{display:flex;align-items:baseline;gap:8px;white-space:nowrap;}
.pcgb-line b{font-size:17px;font-weight:900;letter-spacing:-.02em;color:#fff;}
.pcgb-n{font-family:Anton,Impact,sans-serif;font-size:18px;letter-spacing:.04em;color:var(--pc);}
.pcgb-t{font-size:15px;font-weight:700;color:#d6deea;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pcgb-bar{display:flex;gap:4px;margin-top:2px;}
.pcgb-bar i{flex:1;height:5px;border-radius:3px;background:rgba(255,255,255,.14);transition:background .3s;}
.pcgb-bar i.d{background:color-mix(in srgb,var(--pc) 70%,transparent);}
.pcgb-bar i.c{background:var(--pc);animation:pcgb-glow 1s ease-in-out infinite alternate;}
.pcgb-spin{flex:none;width:22px;height:22px;border-radius:50%;border:3px solid color-mix(in srgb,var(--pc) 30%,transparent);border-top-color:var(--pc);animation:pcgb-rot .9s linear infinite;}
.pcgb-tile.done .pcgb-spin,.pcgb-tile.skip .pcgb-spin{display:none;}
.pcgb-ok{display:none;flex:none;width:30px;height:30px;border-radius:50%;background:#5ee07a;place-items:center;animation:pcgb-pop .5s cubic-bezier(.2,1.6,.4,1);}
.pcgb-ok svg{width:18px;height:18px;fill:none;stroke:#062012;stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round;}
.pcgb-tile.done .pcgb-ok{display:grid;}
.pcgb-tile.done .pcgb-line b{color:#9dffb5;}
.pcgb-tile.skip .pcgb-line b{color:#cdd7e6;}
@keyframes pcgb-in{from{opacity:0;transform:translateY(14px) scale(.95);}}
@keyframes pcgb-pop{from{transform:scale(.4);opacity:0;}}
@keyframes pcgb-rot{to{transform:rotate(360deg);}}
@keyframes pcgb-blink{to{opacity:.3;}}
@keyframes pcgb-glow{from{opacity:.75;}to{opacity:1;}}
`;
function injectCss() {
  if (document.getElementById('pcg-tutorial-board-css')) return;
  const s = document.createElement('style');
  s.id = 'pcg-tutorial-board-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}
const OK_SVG = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

/**
 * opts: { mount?: 요소(없으면 화면 아래 가운데에 띄움), position?: 'bottom' | 'top', players?, doneMs = 5000, title? }
 */
export function createTutorialBoard(opts = {}) {
  injectCss();
  const root = document.createElement('div');
  const inline = Boolean(opts.mount);
  root.className = 'pcgb ' + (inline ? 'inline' : `float ${opts.position === 'top' ? 'top' : 'bottom'}`);
  root.setAttribute('aria-live', 'polite');
  root.innerHTML = `<div class="pcgb-head" hidden><i></i><span></span></div><div class="pcgb-tiles"></div>`;
  (opts.mount || document.body).appendChild(root);
  const head = root.querySelector('.pcgb-head');
  const tilesEl = root.querySelector('.pcgb-tiles');
  const tiles = new Map(); // slot -> { el, data, at, timer }
  let players = Array.isArray(opts.players) ? opts.players : [];
  let hidden = false;
  const doneMs = opts.doneMs ?? 5000;

  function colorOf(slot) {
    const p = players.find((x) => Number(x.slot) === Number(slot));
    return (p && p.color) || COLORS[slot] || '#ffffff';
  }
  function nameOf(slot) {
    const p = players.find((x) => Number(x.slot) === Number(slot));
    return (p && p.name) || `${slot}P`;
  }

  function remove(slot) {
    const t = tiles.get(slot);
    if (!t) return;
    clearTimeout(t.timer);
    tiles.delete(slot);
    t.el.classList.add('out');
    setTimeout(() => t.el.remove(), 500);
    paintHead();
  }

  function paintHead() {
    const active = [...tiles.values()].filter((t) => !t.data.done);
    head.hidden = !active.length;
    head.querySelector('span').textContent = opts.title || (active.length ? '연습 중인 사람이 있어요 · 끝나면 준비를 눌러요' : '');
    root.hidden = hidden || !tiles.size;
  }

  function paint(slot) {
    const t = tiles.get(slot);
    if (!t) return;
    const d = t.data;
    const total = Math.max(1, Number(d.total) || 1);
    const step = Math.max(1, Math.min(total, Number(d.step) || 1));
    t.el.style.setProperty('--pc', colorOf(slot));
    t.el.classList.toggle('done', Boolean(d.done && !d.skipped));
    t.el.classList.toggle('skip', Boolean(d.done && d.skipped));
    let line;
    let sub;
    if (d.done && d.skipped) { line = '<b>연습 건너뜀</b>'; sub = '바로 준비할 수 있어요'; }
    else if (d.done) { line = '<b>연습 끝</b>'; sub = '준비를 누르면 시작해요'; }
    else { line = `<b>연습 중</b><span class="pcgb-n">${step}/${total}</span>`; sub = d.title || ''; }
    const bar = Array.from({ length: total }, (_, k) => `<i class="${d.done || k < step - 1 ? 'd' : k === step - 1 ? 'c' : ''}"></i>`).join('');
    t.el.innerHTML = `<div class="pcgb-badge">${esc(nameOf(slot))}</div>` +
      `<div class="pcgb-main"><div class="pcgb-line">${line}</div><div class="pcgb-t">${d.done ? esc(sub) : `· ${esc(sub)}`}</div><div class="pcgb-bar">${bar}</div></div>` +
      `<div class="pcgb-spin"></div><div class="pcgb-ok">${OK_SVG}</div>`;
  }

  /** 폰의 tutorial 이벤트 하나 처리. data.slot 은 서버가 붙여 줍니다. */
  function update(data) {
    if (!data || data.slot == null) return;
    const slot = Number(data.slot);
    let t = tiles.get(slot);
    if (!t) {
      if (data.done && data.skipped && !data.step) return;
      const el = document.createElement('div');
      el.className = 'pcgb-tile';
      tilesEl.appendChild(el);
      // 자리 순서대로 놓습니다.
      const after = [...tiles.keys()].filter((s) => s > slot).sort((a, b) => a - b)[0];
      if (after != null) tilesEl.insertBefore(el, tiles.get(after).el);
      t = { el, data: {}, at: 0, timer: null };
      tiles.set(slot, t);
    }
    clearTimeout(t.timer);
    t.data = { ...data };
    t.at = Date.now();
    paint(slot);
    if (data.done) t.timer = setTimeout(() => remove(slot), data.skipped ? Math.min(3000, doneMs) : doneMs);
    else t.timer = setTimeout(() => remove(slot), STALE_MS);
    paintHead();
  }

  /** 서버 players 목록. 나간 사람 칸은 지우고, 끊긴 사람은 흐리게 합니다. */
  function setPlayers(list) {
    players = Array.isArray(list) ? list : [];
    for (const [slot, t] of [...tiles]) {
      const p = players.find((x) => Number(x.slot) === slot);
      if (!p) { remove(slot); continue; }
      t.el.classList.toggle('away', p.connected === false);
      t.el.style.setProperty('--pc', colorOf(slot));
    }
  }

  function attach(socket) {
    const onTut = (d) => update(d);
    const onPlayers = (p) => setPlayers(p && p.players);
    socket.on('tutorial', onTut);
    socket.on('players', onPlayers);
    socket.on('room', onPlayers);
    return () => { socket.off('tutorial', onTut); socket.off('players', onPlayers); socket.off('room', onPlayers); };
  }

  const api = {
    el: root,
    update,
    attach,
    setPlayers,
    /** 지금 연습 중인 자리 번호들 */
    practicing: () => [...tiles].filter(([, t]) => !t.data.done).map(([s]) => s).sort((a, b) => a - b),
    /** "2P·3P 연습 중" 같은 한 줄(없으면 '') */
    summary() {
      const list = api.practicing();
      return list.length ? `${list.map(nameOf).join('·')} 연습 중` : '';
    },
    hide(on = true) { hidden = Boolean(on); paintHead(); },
    clear() { for (const s of [...tiles.keys()]) remove(s); },
    destroy() { for (const t of tiles.values()) clearTimeout(t.timer); tiles.clear(); root.remove(); }
  };
  paintHead();
  window.PCG = window.PCG || {};
  window.PCG.tutorialBoard = api;
  return api;
}

export default createTutorialBoard;
