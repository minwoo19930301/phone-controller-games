// 네컷 꾸미기(폰): 완성 판 위에 손가락으로 그리기(색·굵기·네온), 이모지·글자 스티커(끌기, 두 손가락으로 크기·회전),
// 되돌리기, 내 것 지우기, 완성. 그린 것은 판 비율 좌표로 큰 화면에 바로바로 보내고, 다른 사람 것도 받아서 같이 보여 줍니다.
import { drawItems, STICKERS, PEN_COLORS, PEN_SIZES, BRUSHES, Q, hitSticker } from '/photobooth/deco.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const now = () => performance.now();
const COLORS = { 1: '#ff5a5f', 2: '#3ab4ff', 3: '#ffc93c', 4: '#5ee07a' };

/**
 * opts: { root, send(event, data, volatile), slot: () => 내 자리, color: () => 내 색, haptics, toast(msg), onDone(on) }
 */
export function createDecorator(opts) {
  const root = opts.root;
  root.innerHTML = `
    <div class="d-top">
      <div class="d-tabs"></div>
      <div class="d-bar"><div class="d-zoom"></div><div class="d-timer"><i></i><b>90</b></div></div>
    </div>
    <div class="d-box">
      <canvas class="d-cv"></canvas>
      <div class="d-hint"></div>
      <div class="d-sel hidden">
        <button type="button" data-a="smaller" aria-label="작게">－</button>
        <button type="button" data-a="bigger" aria-label="크게">＋</button>
        <button type="button" data-a="ccw" aria-label="왼쪽으로 돌리기">↺</button>
        <button type="button" data-a="cw" aria-label="오른쪽으로 돌리기">↻</button>
        <button type="button" data-a="del" class="del">삭제</button>
      </div>
      <div class="d-cover hidden"><div class="d-cover-in"><b>완성!</b><span class="d-wait"></span><button type="button" class="d-more">더 꾸밀래요</button></div></div>
    </div>
    <div class="d-tools">
      <div class="d-seg"><button type="button" data-tool="pen" class="on">✏️ 펜</button><button type="button" data-tool="stk">😀 스티커</button></div>
      <div class="d-pen">
        <div class="d-colors">${PEN_COLORS.map((c, i) => `<button type="button" class="d-color" data-i="${i}" style="--pc:${c}" aria-label="색 ${i + 1}"></button>`).join('')}</div>
        <div class="d-opts">
          ${PEN_SIZES.map((s, i) => `<button type="button" class="d-size" data-i="${i}" aria-label="${s.label}"><i style="--d:${6 + i * 6}px"></i></button>`).join('')}
          <span class="d-sep"></span>
          ${BRUSHES.map((b) => `<button type="button" class="d-brush" data-b="${b.id}">${b.label}</button>`).join('')}
        </div>
      </div>
      <div class="d-stk hidden">${STICKERS.map((s) => `<button type="button" class="d-st" data-k="${s.k}">${s.e ? s.e : `<span class="w" style="--bg:${s.bg};--fg:${s.fg}">${esc(s.word)}</span>`}</button>`).join('')}</div>
      <div class="d-acts">
        <button type="button" class="d-undo">↶ 되돌리기</button>
        <button type="button" class="d-clear">내 것 지우기</button>
        <button type="button" class="d-fin">완성 ✓</button>
      </div>
    </div>`;
  const q = (s) => root.querySelector(s);
  const box = q('.d-box');
  const cv = q('.d-cv');
  const g = cv.getContext('2d');

  let sheets = []; // { id, owner, kind, w, h, cuts, img, ok }
  let session = 0;
  let curId = null;
  let zoom = 'all';
  const items = new Map();
  const undo = [];
  let idN = 0;
  let tool = 'pen';
  const pen = { c: null, w: 1, b: 'pen' };
  let sel = null;
  let done = false;
  let endAt = 0;
  let visible = false;
  let dirty = true;
  let W = 0;
  let H = 0;
  let dpr = 1;
  const view = { sc: 1, ox: 0, oy: 0 };
  let target = null;
  let drew = false;
  let people = [];
  let doneList = [];

  const slot = () => (typeof opts.slot === 'function' ? opts.slot() : opts.slot);
  const myColor = () => (typeof opts.color === 'function' ? opts.color() : opts.color) || '#ff4f7b';
  const send = (ev, data, v) => opts.send(ev, data, v);
  const sheet = () => sheets.find((s) => s.id === curId) || sheets[0] || null;
  const newId = () => `${slot()}-${session}-${++idN}`;
  const wire = (it) => ({ id: it.id, sh: it.sh, k: it.k, x: Math.round(it.x), y: Math.round(it.y), s: Math.round(it.s * 10000) / 10000, r: Math.round(it.r * 1000) / 1000 });

  // ---------- 판 고르기·확대 ----------
  function paintTabs() {
    const tabs = q('.d-tabs');
    if (sheets.length <= 1) { tabs.innerHTML = ''; tabs.hidden = true; return; }
    tabs.hidden = false;
    tabs.innerHTML = sheets.map((s) => {
      const mine = s.owner === slot();
      return `<button type="button" class="d-tab${s.id === curId ? ' on' : ''}" data-sh="${s.id}" style="--tc:${COLORS[s.owner] || '#fff'}"><b>${s.owner}P</b>${mine ? '내 네컷' : '네컷'}</button>`;
    }).join('');
  }
  function paintZoom() {
    const z = q('.d-zoom');
    const sh = sheet();
    if (!sh) { z.innerHTML = ''; return; }
    z.innerHTML = `<button type="button" data-z="all" class="${zoom === 'all' ? 'on' : ''}">전체</button>` +
      sh.cuts.map((c, i) => `<button type="button" data-z="${i}" class="${zoom === i ? 'on' : ''}">${i + 1}컷</button>`).join('');
  }
  q('.d-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sh]');
    if (!b) return;
    curId = Number(b.dataset.sh);
    select(null);
    paintTabs();
    paintZoom();
    retarget(false);
  });
  q('.d-zoom').addEventListener('click', (e) => {
    const b = e.target.closest('[data-z]');
    if (!b) return;
    zoom = b.dataset.z === 'all' ? 'all' : Number(b.dataset.z);
    paintZoom();
    retarget(true);
    tick();
  });
  function targetRect() {
    const sh = sheet();
    if (!sh) return null;
    if (zoom === 'all' || !sh.cuts[zoom]) return { x: 0, y: 0, w: sh.w, h: sh.h };
    const c = sh.cuts[zoom];
    const m = Math.min(c.w, c.h) * 0.07;
    return { x: c.x - m, y: c.y - m, w: c.w + m * 2, h: c.h + m * 2 };
  }
  function fit(r) {
    const pad = 12;
    const sh = sheet();
    const sc = Math.min((W - pad * 2) / r.w, (H - pad * 2) / r.h);
    let ox = W / 2 - (r.x + r.w / 2) * sc;
    let oy = H / 2 - (r.y + r.h / 2) * sc;
    // 컷을 확대했을 때 판이 화면보다 크면, 판 바깥(빈 곳)이 보이지 않게 가장자리에 붙입니다.
    if (sh) {
      const sw = sh.w * sc;
      const shh = sh.h * sc;
      if (sw > W) ox = Math.min(0, Math.max(W - sw, ox));
      if (shh > H) oy = Math.min(0, Math.max(H - shh, oy));
    }
    return { sc, ox, oy };
  }
  function retarget(anim) {
    const r = targetRect();
    if (!r || !W) return;
    target = fit(r);
    if (!anim) Object.assign(view, target);
    dirty = true;
  }
  function resize() {
    const r = box.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(3, window.devicePixelRatio || 1);
    W = r.width;
    H = r.height;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    retarget(false);
    placeSel();
  }
  new ResizeObserver(() => { if (visible) resize(); }).observe(box);

  // ---------- 그리기 ----------
  function itemsOf(id) {
    const out = [];
    for (const it of items.values()) if (it.sh === id) out.push(it);
    return out;
  }
  function render() {
    if (!W) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const sh = sheet();
    if (!sh) return;
    g.save();
    g.translate(view.ox, view.oy);
    g.scale(view.sc, view.sc);
    g.shadowColor = 'rgba(0,0,0,.5)';
    g.shadowBlur = 24 / view.sc;
    g.fillStyle = '#222';
    g.fillRect(0, 0, sh.w, sh.h);
    g.shadowBlur = 0;
    if (sh.ok) g.drawImage(sh.img, 0, 0, sh.w, sh.h);
    drawItems(g, itemsOf(sh.id), sh.w, sh.h, { selected: sel, color: myColor() });
    g.restore();
    // 확대한 컷 밖은 살짝 어둡게
    if (zoom !== 'all' && sh.cuts[zoom]) {
      const c = sh.cuts[zoom];
      const x = view.ox + c.x * view.sc;
      const y = view.oy + c.y * view.sc;
      g.fillStyle = 'rgba(8,6,12,.45)';
      g.beginPath();
      g.rect(0, 0, W, H);
      g.rect(x + c.w * view.sc, y, -c.w * view.sc, c.h * view.sc);
      g.fill('evenodd');
    }
  }
  function loop() {
    if (!visible) return;
    requestAnimationFrame(loop);
    if (target) {
      const k = 0.24;
      let moving = false;
      for (const key of ['sc', 'ox', 'oy']) {
        const d = target[key] - view[key];
        if (Math.abs(d) > (key === 'sc' ? 0.0005 : 0.3)) { view[key] += d * k; moving = true; } else view[key] = target[key];
      }
      if (moving) { dirty = true; placeSel(); }
    }
    if (dirty) { dirty = false; render(); }
  }
  function tick() { dirty = true; }

  // ---------- 좌표 ----------
  function local(e) {
    const r = cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  function toSheet([px, py]) { return [(px - view.ox) / view.sc, (py - view.oy) / view.sc]; }

  // ---------- 펜 ----------
  let stroke = null; // { it, sent }
  function startStroke(p) {
    const sh = sheet();
    if (!sh) return;
    const it = { t: 'draw', id: newId(), sh: sh.id, slot: slot(), c: pen.c || myColor(), w: PEN_SIZES[pen.w].w, b: pen.b, p: [] };
    items.set(it.id, it);
    stroke = { it, sent: 0 };
    addPoint(p, true);
    hint('');
  }
  function addPoint(p, force) {
    const sh = sheet();
    const it = stroke.it;
    const [x, y] = toSheet(p);
    const qx = Math.round((x / sh.w) * Q);
    const qy = Math.round((y / sh.h) * Q);
    const n = it.p.length;
    if (!force && n >= 2) {
      // 화면에서 1.5px 보다 덜 움직였으면 거름
      const dx = ((qx - it.p[n - 2]) / Q) * sh.w * view.sc;
      const dy = ((qy - it.p[n - 1]) / Q) * sh.h * view.sc;
      if (dx * dx + dy * dy < 2.25) return;
    }
    if (n >= 11000) return;
    it.p.push(qx, qy);
    tick();
  }
  function flushStroke(final) {
    if (!stroke) return;
    const it = stroke.it;
    const from = stroke.sent;
    if (from >= it.p.length && !final) return;
    send('draw', { id: it.id, sh: it.sh, c: it.c, w: it.w, b: it.b, i: from / 2, p: it.p.slice(from), e: final ? 1 : 0 });
    stroke.sent = it.p.length;
  }
  setInterval(() => flushStroke(false), 50);
  function endStroke() {
    if (!stroke) return;
    flushStroke(true);
    undo.push({ type: 'add', id: stroke.it.id });
    stroke = null;
    if (!drew) { drew = true; }
    try { opts.haptics && opts.haptics.tick(); } catch (e) {}
  }

  // ---------- 스티커 ----------
  function viewCenter() {
    const sh = sheet();
    const [x, y] = toSheet([W / 2, H / 2]);
    return [clamp(x, 0, sh.w), clamp(y, 0, sh.h)];
  }
  function addSticker(k) {
    const sh = sheet();
    if (!sh || done) return;
    const [cx, cy] = viewCenter();
    const ref = zoom === 'all' ? sh.cuts[0] : sh.cuts[zoom];
    const s = (Math.min(ref.w, ref.h) * 0.42) / sh.w;
    const jitter = () => (Math.random() - 0.5) * 0.06;
    const it = { t: 'stk', id: newId(), sh: sh.id, slot: slot(), k, x: Math.round(((cx / sh.w) + jitter() * (sh.h / sh.w) * 0.3) * Q), y: Math.round(((cy / sh.h) + jitter() * 0.3) * Q), s, r: (Math.random() - 0.5) * 0.3 };
    items.set(it.id, it);
    undo.push({ type: 'add', id: it.id });
    send('sticker', wire(it));
    setTool('stk');
    select(it.id);
    hint('끌어서 옮기고, 두 손가락으로 크기·회전');
    try { opts.haptics && opts.haptics.tick(); } catch (e) {}
    tick();
  }
  function myStickerAt(p) {
    const sh = sheet();
    const [x, y] = toSheet(p);
    const list = itemsOf(sh.id).filter((it) => it.t === 'stk' && it.slot === slot());
    for (let i = list.length - 1; i >= 0; i--) if (hitSticker(g, list[i], x, y, sh.w, sh.h, 14 / view.sc)) return list[i];
    return null;
  }
  function select(id) {
    sel = id;
    placeSel();
    tick();
  }
  function placeSel() {
    const bar = q('.d-sel');
    const it = sel ? items.get(sel) : null;
    bar.classList.toggle('hidden', !it || tool !== 'stk');
  }
  let lastV = 0;
  function sendLive(it) {
    const t = now();
    if (t - lastV < 33) return;
    lastV = t;
    send('msg_v', { type: 'stk', ...wire(it) }, true);
  }
  function commitMove(it, prev) {
    undo.push({ type: 'move', id: it.id, prev });
    send('sticker', wire(it));
  }
  const snap = (it) => ({ x: it.x, y: it.y, s: it.s, r: it.r });
  q('.d-sel').addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    const it = sel ? items.get(sel) : null;
    if (!b || !it) return;
    const prev = snap(it);
    const a = b.dataset.a;
    if (a === 'del') {
      items.delete(it.id);
      undo.push({ type: 'del', item: it });
      send('sticker', { id: it.id, del: 1 });
      select(null);
      return;
    }
    if (a === 'smaller') it.s = clamp(it.s / 1.18, 0.04, 1.2);
    if (a === 'bigger') it.s = clamp(it.s * 1.18, 0.04, 1.2);
    if (a === 'ccw') it.r -= 0.26;
    if (a === 'cw') it.r += 0.26;
    commitMove(it, prev);
    tick();
  });

  // ---------- 손가락 ----------
  const ptrs = new Map();
  let gest = null; // { type: 'drag'|'pinch', id, prev, ... }
  cv.addEventListener('pointerdown', (e) => {
    if (!sheet() || done) return;
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    const p = local(e);
    ptrs.set(e.pointerId, p);
    if (tool === 'pen') {
      if (ptrs.size === 1) startStroke(p);
      return;
    }
    if (ptrs.size === 1) {
      const hit = myStickerAt(p);
      if (hit) {
        select(hit.id);
        const [x, y] = toSheet(p);
        const sh = sheet();
        gest = { type: 'drag', id: hit.id, prev: snap(hit), dx: (hit.x / Q) * sh.w - x, dy: (hit.y / Q) * sh.h - y };
      } else {
        select(null);
        gest = null;
      }
    } else if (ptrs.size === 2 && sel) {
      const it = items.get(sel);
      const [a, b] = [...ptrs.values()];
      gest = { type: 'pinch', id: sel, prev: gest && gest.prev ? gest.prev : snap(it), d0: Math.hypot(b[0] - a[0], b[1] - a[1]), a0: Math.atan2(b[1] - a[1], b[0] - a[0]), s0: it.s, r0: it.r, m0: toSheet([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]), x0: it.x, y0: it.y };
    }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    e.preventDefault();
    const p = local(e);
    ptrs.set(e.pointerId, p);
    if (tool === 'pen') {
      if (!stroke) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (evs.length > 1) for (const ce of evs) addPoint(local(ce));
      else addPoint(p);
      return;
    }
    if (!gest) return;
    const it = items.get(gest.id);
    if (!it) return;
    const sh = sheet();
    if (gest.type === 'drag' && ptrs.size === 1) {
      const [x, y] = toSheet(p);
      it.x = Math.round(((x + gest.dx) / sh.w) * Q);
      it.y = Math.round(((y + gest.dy) / sh.h) * Q);
    } else if (gest.type === 'pinch' && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      it.s = clamp(gest.s0 * (d / Math.max(10, gest.d0)), 0.04, 1.2);
      it.r = gest.r0 + (ang - gest.a0);
      const m = toSheet([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      it.x = Math.round(gest.x0 + ((m[0] - gest.m0[0]) / sh.w) * Q);
      it.y = Math.round(gest.y0 + ((m[1] - gest.m0[1]) / sh.h) * Q);
    }
    sendLive(it);
    tick();
  });
  const up = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (tool === 'pen') { if (!ptrs.size) endStroke(); return; }
    if (!gest) return;
    const it = items.get(gest.id);
    if (gest.type === 'pinch' && ptrs.size === 1 && it) {
      // 두 손가락 중 하나를 떼면 남은 손가락으로 계속 끌기
      const [p] = [...ptrs.values()];
      const [x, y] = toSheet(p);
      const sh = sheet();
      gest = { type: 'drag', id: it.id, prev: gest.prev, dx: (it.x / Q) * sh.w - x, dy: (it.y / Q) * sh.h - y };
      return;
    }
    if (!ptrs.size) {
      if (it) {
        const pr = gest.prev;
        if (pr.x !== it.x || pr.y !== it.y || pr.s !== it.s || pr.r !== it.r) commitMove(it, pr);
      }
      gest = null;
    }
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  // PC 시험: 고른 스티커 위에서 휠 = 크기, Shift+휠 = 회전
  cv.addEventListener('wheel', (e) => {
    const it = sel ? items.get(sel) : null;
    if (!it) return;
    e.preventDefault();
    const prev = snap(it);
    if (e.shiftKey) it.r += e.deltaY > 0 ? 0.12 : -0.12;
    else it.s = clamp(it.s * (e.deltaY > 0 ? 0.92 : 1.08), 0.04, 1.2);
    commitMove(it, prev);
    tick();
  }, { passive: false });

  // ---------- 도구 ----------
  function setTool(t) {
    tool = t;
    for (const b of root.querySelectorAll('.d-seg [data-tool]')) b.classList.toggle('on', b.dataset.tool === t);
    q('.d-pen').classList.toggle('hidden', t !== 'pen');
    q('.d-stk').classList.toggle('hidden', t !== 'stk');
    if (t === 'pen') select(null);
    placeSel();
    hint(t === 'pen' ? (drew ? '' : '손가락으로 그려요') : '아래에서 스티커를 눌러 붙여요');
  }
  function paintPen() {
    for (const b of root.querySelectorAll('.d-color')) b.classList.toggle('on', PEN_COLORS[Number(b.dataset.i)] === (pen.c || myColor()));
    for (const b of root.querySelectorAll('.d-size')) b.classList.toggle('on', Number(b.dataset.i) === pen.w);
    for (const b of root.querySelectorAll('.d-brush')) b.classList.toggle('on', b.dataset.b === pen.b);
    root.style.setProperty('--pen', pen.c || myColor());
  }
  q('.d-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });
  q('.d-pen').addEventListener('click', (e) => {
    const c = e.target.closest('.d-color');
    const s = e.target.closest('.d-size');
    const br = e.target.closest('.d-brush');
    if (c) pen.c = PEN_COLORS[Number(c.dataset.i)];
    if (s) pen.w = Number(s.dataset.i);
    if (br) pen.b = br.dataset.b;
    paintPen();
  });
  q('.d-stk').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) addSticker(b.dataset.k); });

  function resend(it) {
    if (it.t === 'draw') send('draw', { id: it.id, sh: it.sh, c: it.c, w: it.w, b: it.b, i: 0, p: it.p, e: 1 });
    else send('sticker', wire(it));
  }
  function doUndo() {
    const op = undo.pop();
    if (!op) { opts.toast && opts.toast('되돌릴 게 없어요'); return; }
    if (op.type === 'add') {
      items.delete(op.id);
      send('undo', { id: op.id });
      if (sel === op.id) select(null);
    } else if (op.type === 'move') {
      const it = items.get(op.id);
      if (it) { Object.assign(it, op.prev); send('sticker', wire(it)); }
    } else if (op.type === 'del') {
      items.set(op.item.id, op.item);
      resend(op.item);
    } else if (op.type === 'clear') {
      for (const it of op.items) { items.set(it.id, it); resend(it); }
    }
    try { opts.haptics && opts.haptics.tick(); } catch (e) {}
    tick();
  }
  let clearArm = 0;
  function doClear() {
    const sh = sheet();
    if (!sh) return;
    const mine = itemsOf(sh.id).filter((it) => it.slot === slot());
    const btn = q('.d-clear');
    if (!mine.length) { opts.toast && opts.toast('지울 게 없어요'); return; }
    if (now() - clearArm > 2200) {
      clearArm = now();
      btn.textContent = '한 번 더 누르면 지워요';
      btn.classList.add('arm');
      setTimeout(() => { btn.textContent = '내 것 지우기'; btn.classList.remove('arm'); }, 2200);
      return;
    }
    clearArm = 0;
    btn.textContent = '내 것 지우기';
    btn.classList.remove('arm');
    for (const it of mine) items.delete(it.id);
    undo.push({ type: 'clear', items: mine });
    send('clear', { sh: sh.id });
    select(null);
    tick();
  }
  q('.d-undo').addEventListener('click', doUndo);
  q('.d-clear').addEventListener('click', doClear);
  q('.d-fin').addEventListener('click', () => setDone(true, true));
  q('.d-more').addEventListener('click', () => setDone(false, true));

  function setDone(on, user) {
    done = Boolean(on);
    if (user) {
      send('msg', { type: 'done', on: done });
      try { opts.haptics && (done ? opts.haptics.success() : opts.haptics.tick()); } catch (e) {}
      opts.onDone && opts.onDone(done);
    }
    if (done) { flushStroke(true); stroke = null; select(null); }
    q('.d-cover').classList.toggle('hidden', !done);
    q('.d-fin').classList.toggle('on', done);
    paintWait();
  }
  function paintWait() {
    const el = q('.d-wait');
    const left = people.filter((s) => !doneList.includes(s));
    el.innerHTML = left.length
      ? `${left.map((s) => `<b style="--tc:${COLORS[s] || '#fff'}">${s}P</b>`).join('')} 꾸미는 중 · 모두 완성하면 끝나요`
      : '모두 완성! 큰 화면에서 굽는 중…';
  }
  function hint(t) {
    const h = q('.d-hint');
    h.textContent = t || '';
    h.classList.toggle('on', Boolean(t));
  }

  // 남은 시간
  setInterval(() => {
    if (!visible || !endAt) return;
    const left = Math.max(0, Math.ceil((endAt - now()) / 1000));
    const t = q('.d-timer');
    t.querySelector('b').textContent = String(left);
    t.classList.toggle('low', left <= 10);
  }, 250);

  // ---------- 밖에서 부르는 것 ----------
  function loadSheets(list, sess) {
    session = Number(sess) || session;
    const prevCur = curId;
    sheets = (list || []).map((s) => {
      const img = new Image();
      const o = { id: Number(s.id), owner: s.owner == null ? null : Number(s.owner), kind: s.kind, w: s.w, h: s.h, cuts: s.cuts || [], img, ok: false };
      img.onload = () => { o.ok = true; tick(); };
      img.src = s.img;
      return o;
    });
    const mine = sheets.find((s) => s.owner === slot());
    curId = sheets.some((s) => s.id === prevCur) ? prevCur : mine ? mine.id : sheets[0] ? sheets[0].id : null;
    const sh = sheet();
    zoom = sh && sh.kind === 'strip' ? 0 : 'all';
    paintTabs();
    paintZoom();
    retarget(false);
  }
  function applyOps(ops) {
    const me = slot();
    for (const op of ops || []) {
      if (!op || Number(op.slot) === me) continue;
      if (op.t === 'draw') {
        let it = items.get(op.id);
        if (!it) { it = { t: 'draw', id: op.id, sh: Number(op.sh), slot: Number(op.slot), c: op.c, w: op.w, b: op.b, p: [] }; items.set(it.id, it); }
        const i = Number(op.i) || 0;
        if (i * 2 < it.p.length) it.p.length = i * 2;
        for (const v of op.p || []) it.p.push(v);
      } else if (op.t === 'stk') {
        const it = items.get(op.id);
        const v = { t: 'stk', id: op.id, sh: Number(op.sh), slot: Number(op.slot), k: op.k, x: op.x, y: op.y, s: op.s, r: op.r };
        if (it) Object.assign(it, v); else items.set(v.id, v);
      } else if (op.t === 'del') items.delete(op.id);
      else if (op.t === 'clr') {
        for (const [id, it] of items) if (it.slot === Number(op.slot) && (op.sh == null || it.sh === Number(op.sh))) items.delete(id);
      }
    }
    tick();
  }
  function sync(all) {
    items.clear();
    undo.length = 0;
    const me = slot();
    for (const it of all || []) {
      const c = { ...it, p: it.p ? it.p.slice() : undefined };
      items.set(c.id, c);
      if (c.slot === me) {
        undo.push({ type: 'add', id: c.id });
        const n = Number(String(c.id).split('-').pop());
        if (Number.isFinite(n) && n > idN) idN = n;
      }
    }
    tick();
  }
  function reset() {
    items.clear();
    undo.length = 0;
    sheets = [];
    curId = null;
    sel = null;
    stroke = null;
    drew = false;
    setDone(false, false);
    setTool('pen');
    tick();
  }
  function show() {
    if (visible) return;
    visible = true;
    pen.c = pen.c || null;
    paintPen();
    requestAnimationFrame(() => { resize(); loop(); });
  }
  function hide() { visible = false; }

  setTool('pen');
  paintPen();

  return {
    loadSheets, applyOps, sync, reset, show, hide,
    setLeft(sec) { endAt = now() + Math.max(0, Number(sec) || 0) * 1000; },
    setDone: (on) => setDone(on, false),
    setPeople(list, dl) { people = list || []; doneList = dl || []; paintWait(); },
    get session() { return session; },
    get sheetCount() { return sheets.length; },
    get done() { return done; },
    // 시험용: 화면 좌표(0~1)로 선 하나 / 스티커 하나
    test: {
      line(points) {
        if (!sheet()) return false;
        setTool('pen');
        startStroke([points[0][0] * W, points[0][1] * H]);
        for (const [x, y] of points.slice(1)) addPoint([x * W, y * H], true);
        endStroke();
        return true;
      },
      sticker(k) { addSticker(k); return sel; },
      undo: doUndo,
      zoom(z) { zoom = z; paintZoom(); retarget(false); },
      items: () => [...items.values()].map((it) => ({ id: it.id, t: it.t, slot: it.slot, n: it.p ? it.p.length / 2 : 0 }))
    }
  };
}
