// 리듬 스텝 폰 패드: 폰 화면 전체를 진짜 발판처럼 나눈 큰 터치 패드(캔버스).
//   4키(DDR): 화면을 대각선으로 4칸(위·아래·왼쪽·오른쪽 삼각형)으로 나눕니다. 화살표 방향 = 누를 칸이라 외울 것이 없습니다.
//   5키(펌프): 네 귀퉁이(↖ ↗ ↙ ↘) + 가운데 동그라미(●).
// 칸은 요소의 실제 크기(getBoundingClientRect)로 정하므로, 화면을 돌려도 맞습니다.
// 여러 손가락을 따로 따라가고(동시 누르기), 누른 채 옆 칸으로 밀면 앞 칸을 떼고 새 칸을 누른 것으로 칩니다.
// 누르는 순간 칸이 밝게 켜지고, 큰 화면 판정이 오면 그 칸에 판정 색 고리가 터집니다.
//
//   const pad = createPad(el, { lanes: 4, color: '#ff5a5f', onPress(lane, info), onRelease(lane, info) });
//   pad.setLanes(5); pad.setColor(c); pad.judge(lane, 'perfect'); pad.destroy();
// info = { t: 누른 순간(performance.now 기준 ms), x, y }

// 4레인 ← ↓ ↑ →, 5레인 ↙ ↖ ● ↗ ↘ (위쪽 화살표를 기준으로 돌리는 각도, 도)
const ROT = { 4: [-90, 180, 0, 90], 5: [-135, -45, null, 45, 135] };
const JCOL = { perfect: '#ffd23a', great: '#5ef0a0', good: '#7cc8ff', miss: '#ff5a6e', ok: '#5ef0a0', ng: '#ff5a6e' };

function hexToRgb(h) {
  const s = String(h || '#ffffff').replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };

// 위를 가리키는 DDR 화살표(큰 화면 노트와 같은 모양, 가운데 기준, 크기 s)
function arrowPath(g, s) {
  const k = s / 100;
  g.beginPath();
  g.moveTo(0, -44 * k);
  g.lineTo(44 * k, 0);
  g.lineTo(24 * k, 18 * k);
  g.lineTo(13 * k, 8 * k);
  g.lineTo(13 * k, 44 * k);
  g.lineTo(-13 * k, 44 * k);
  g.lineTo(-13 * k, 8 * k);
  g.lineTo(-24 * k, 18 * k);
  g.lineTo(-44 * k, 0);
  g.closePath();
}

/** 칸 고르기(순수 계산). x, y 는 패드 왼쪽 위 기준 픽셀. */
export function laneAt(lanes, x, y, W, H) {
  const cx = W / 2, cy = H / 2;
  const dx = x - cx, dy = y - cy;
  if (lanes === 5) {
    const R = Math.min(W, H) * 0.2;
    if (dx * dx + dy * dy < R * R) return 2;
    if (dx < 0) return dy > 0 ? 0 : 1;
    return dy < 0 ? 3 : 4;
  }
  // 대각선 기준: 가로·세로 비율로 맞춘 거리로 비교합니다(사각형의 꼭짓점이 경계).
  const u = dx / (W / 2), v = dy / (H / 2);
  if (Math.abs(u) > Math.abs(v)) return u < 0 ? 0 : 3;
  return v < 0 ? 2 : 1;
}

export function createPad(container, opts = {}) {
  let lanes = opts.lanes === 5 ? 5 : 4;
  let color = opts.color || '#ff5a5f';
  const canvas = document.createElement('canvas');
  canvas.className = 'rpad';
  canvas.setAttribute('aria-label', '스텝 패드');
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;';
  container.appendChild(canvas);
  const g = canvas.getContext('2d');
  let W = 1, H = 1, dpr = 1;
  let enabled = true;

  // 칸마다 상태
  let st = fresh();
  function fresh() {
    return Array.from({ length: lanes }, () => ({ down: 0, glow: 0, judge: null, jt: 0, pop: 0 }));
  }
  const ripples = [];
  const pointers = new Map(); // pointerId -> lane

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    kick();
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(canvas);
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  // ---------- 칸 모양 ----------
  function wedge(l) {
    // 4키: 가운데에서 가장자리로 펼친 삼각형, 5키: 귀퉁이 사각형(가운데는 원)
    const cx = W / 2, cy = H / 2;
    if (lanes === 4) {
      const pts = {
        0: [[0, 0], [cx, cy], [0, H]],
        1: [[0, H], [cx, cy], [W, H]],
        2: [[0, 0], [W, 0], [cx, cy]],
        3: [[W, 0], [W, H], [cx, cy]]
      }[l];
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath();
      return;
    }
    if (l === 2) {
      g.beginPath();
      g.arc(cx, cy, Math.min(W, H) * 0.2, 0, Math.PI * 2);
      return;
    }
    const left = l === 0 || l === 1;
    const top = l === 1 || l === 3;
    g.beginPath();
    g.rect(left ? 0 : cx, top ? 0 : cy, cx, cy);
  }
  /** 화살표를 그릴 자리와 크기 */
  function anchor(l) {
    const cx = W / 2, cy = H / 2;
    const m = Math.min(W, H);
    if (lanes === 4) {
      const s = Math.min(m * 0.36, Math.max(W, H) * 0.24);
      const ins = 0.2;
      return {
        0: { x: W * ins, y: cy, s },
        1: { x: cx, y: H * (1 - ins * 0.85), s },
        2: { x: cx, y: H * ins * 0.85, s },
        3: { x: W * (1 - ins), y: cy, s }
      }[l];
    }
    if (l === 2) return { x: cx, y: cy, s: m * 0.2 };
    const s = m * 0.3;
    const left = l === 0 || l === 1;
    const top = l === 1 || l === 3;
    return { x: left ? cx * 0.5 : cx * 1.5, y: top ? cy * 0.5 : cy * 1.5, s };
  }

  function drawArrow(l, a, lit) {
    const rot = ROT[lanes][l];
    g.save();
    g.translate(a.x, a.y);
    const sc = 1 - lit * 0.08 + st[l].pop * 0.1;
    g.scale(sc, sc);
    if (rot === null) {
      // 펌프 가운데: 둥근 네모
      const r = a.s * 0.42;
      g.beginPath();
      if (g.roundRect) g.roundRect(-r, -r, r * 2, r * 2, r * 0.32);
      else g.rect(-r, -r, r * 2, r * 2);
    } else {
      g.rotate((rot * Math.PI) / 180);
      arrowPath(g, a.s);
    }
    g.lineJoin = 'round';
    if (lit > 0.02) {
      g.shadowColor = color;
      g.shadowBlur = a.s * 0.45 * lit;
    }
    const gr = g.createLinearGradient(0, -a.s * 0.45, 0, a.s * 0.45);
    if (lit > 0.02) {
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(0.5, rgba(color, 0.55 + lit * 0.45));
      gr.addColorStop(1, rgba(color, 0.9));
    } else {
      gr.addColorStop(0, 'rgba(255,255,255,.16)');
      gr.addColorStop(1, 'rgba(255,255,255,.05)');
    }
    g.fillStyle = gr;
    g.fill();
    g.shadowBlur = 0;
    g.lineWidth = Math.max(2, a.s * 0.045);
    g.strokeStyle = lit > 0.02 ? 'rgba(255,255,255,.95)' : rgba(color, 0.85);
    g.stroke();
    g.restore();
  }

  let raf = 0;
  let lastT = 0;
  function kick() { if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(frame); } }
  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    let busy = false;
    for (const s of st) {
      const target = s.down > 0 ? 1 : 0;
      if (target) s.glow = 1;
      else s.glow *= Math.exp(-dt * 10);
      if (s.glow < 0.01) s.glow = 0;
      s.pop *= Math.exp(-dt * 12);
      if (s.pop < 0.01) s.pop = 0;
      if (s.glow > 0 || s.pop > 0 || (s.judge && now - s.jt < 420)) busy = true;
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      if (now - ripples[i].t > 520) ripples.splice(i, 1);
    }
    if (ripples.length) busy = true;
    draw(now);
    if (busy) raf = requestAnimationFrame(frame);
  }

  function draw(now) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (W < 60 || H < 60) return; // 숨겨진 채로 만들어졌으면 크기가 생길 때 다시 그립니다
    const cx = W / 2, cy = H / 2;
    // 칸 바탕
    for (let l = 0; l < lanes; l++) {
      const s = st[l];
      const a = anchor(l);
      wedge(l);
      const rg = g.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.max(W, H) * 0.62);
      const lit = s.glow;
      rg.addColorStop(0, rgba(color, 0.2 + lit * 0.62));
      rg.addColorStop(0.55, rgba(color, 0.07 + lit * 0.3));
      rg.addColorStop(1, rgba(color, 0.02 + lit * 0.1));
      g.fillStyle = rg;
      g.fill();
      if (lit > 0.02) {
        // 누른 칸: 하얀 속빛
        g.save();
        wedge(l);
        g.clip();
        const wg = g.createRadialGradient(a.x, a.y, 0, a.x, a.y, a.s * 1.6);
        wg.addColorStop(0, `rgba(255,255,255,${0.42 * lit})`);
        wg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = wg;
        g.fillRect(0, 0, W, H);
        g.restore();
      }
    }
    // 칸 사이 틈(바탕색 선)
    g.save();
    g.strokeStyle = '#05050c';
    g.lineWidth = 7;
    g.lineCap = 'round';
    if (lanes === 4) {
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(W, H);
      g.moveTo(W, 0); g.lineTo(0, H);
      g.stroke();
      // 가운데 고리
      g.fillStyle = '#05050c';
      g.beginPath();
      g.arc(cx, cy, Math.min(W, H) * 0.075, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = rgba(color, 0.55);
      g.beginPath();
      g.arc(cx, cy, Math.min(W, H) * 0.075 - 4, 0, Math.PI * 2);
      g.stroke();
    } else {
      g.beginPath();
      g.moveTo(cx, 0); g.lineTo(cx, H);
      g.moveTo(0, cy); g.lineTo(W, cy);
      g.stroke();
      g.lineWidth = 9;
      g.beginPath();
      g.arc(cx, cy, Math.min(W, H) * 0.2 + 2, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
    // 테두리
    g.save();
    g.lineWidth = 2;
    g.strokeStyle = rgba(color, 0.35);
    if (g.roundRect) { g.beginPath(); g.roundRect(1, 1, W - 2, H - 2, 22); g.stroke(); }
    g.restore();
    // 화살표·판정 고리
    for (let l = 0; l < lanes; l++) {
      const s = st[l];
      const a = anchor(l);
      drawArrow(l, a, s.glow);
      if (s.judge) {
        const age = (now - s.jt) / 420;
        if (age < 1) {
          const col = JCOL[s.judge] || '#ffffff';
          g.save();
          g.globalCompositeOperation = 'lighter';
          g.lineWidth = 7 * (1 - age) + 1;
          g.strokeStyle = rgba(col, 0.95 * (1 - age));
          g.beginPath();
          g.arc(a.x, a.y, a.s * (0.55 + age * 0.55), 0, Math.PI * 2);
          g.stroke();
          const rg = g.createRadialGradient(a.x, a.y, 0, a.x, a.y, a.s * (0.6 + age * 0.6));
          rg.addColorStop(0, rgba(col, 0.38 * (1 - age)));
          rg.addColorStop(1, rgba(col, 0));
          g.fillStyle = rg;
          g.beginPath();
          g.arc(a.x, a.y, a.s * (0.6 + age * 0.6), 0, Math.PI * 2);
          g.fill();
          g.restore();
        }
      }
    }
    // 손가락 자리 물결
    for (const r of ripples) {
      const k = (now - r.t) / 520;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = `rgba(255,255,255,${0.7 * (1 - k)})`;
      g.lineWidth = 3 * (1 - k) + 0.5;
      g.beginPath();
      g.arc(r.x, r.y, 14 + k * 54, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
  }

  // ---------- 입력 ----------
  function local(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  }
  // 이벤트가 만들어진 순간(performance.now 기준). 오래된 값이 오면 지금으로.
  function stampOf(e) {
    const now = performance.now();
    const ts = e && typeof e.timeStamp === 'number' ? e.timeStamp : now;
    return ts > 0 && ts <= now + 5 && now - ts < 300 ? ts : now;
  }
  function press(l, info) {
    const s = st[l];
    if (!s) return;
    s.down += 1;
    s.glow = 1;
    s.pop = 1;
    kick();
    if (typeof opts.onPress === 'function') opts.onPress(l, info);
  }
  function release(l, info) {
    const s = st[l];
    if (!s || s.down <= 0) return;
    s.down -= 1;
    kick();
    if (s.down === 0 && typeof opts.onRelease === 'function') opts.onRelease(l, info);
  }
  function onDown(e) {
    if (!enabled) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    const p = local(e);
    const l = laneAt(lanes, p.x, p.y, p.w, p.h);
    pointers.set(e.pointerId, l);
    ripples.push({ x: p.x, y: p.y, t: performance.now() });
    press(l, { t: stampOf(e), x: p.x, y: p.y });
  }
  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    if (p.x < -20 || p.y < -20 || p.x > p.w + 20 || p.y > p.h + 20) return;
    const l = laneAt(lanes, p.x, p.y, p.w, p.h);
    const prev = pointers.get(e.pointerId);
    if (l === prev) return;
    // 밀어서 옆 칸으로: 앞 칸은 떼고 새 칸은 누른 것으로
    pointers.set(e.pointerId, l);
    const t = stampOf(e);
    release(prev, { t, x: p.x, y: p.y, slide: true });
    press(l, { t, x: p.x, y: p.y, slide: true });
  }
  function onUp(e) {
    if (!pointers.has(e.pointerId)) return;
    const l = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    const p = local(e);
    release(l, { t: stampOf(e), x: p.x, y: p.y });
  }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('lostpointercapture', onUp);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function releaseAll() {
    for (const [id, l] of pointers) { pointers.delete(id); release(l, { t: performance.now() }); }
    for (let l = 0; l < st.length; l++) while (st[l].down > 0) release(l, { t: performance.now() });
  }

  resize();
  return {
    el: canvas,
    get lanes() { return lanes; },
    setLanes(n) {
      n = n === 5 ? 5 : 4;
      if (n === lanes) return;
      releaseAll();
      lanes = n;
      st = fresh();
      kick();
    },
    setColor(c) { if (c && c !== color) { color = c; kick(); } },
    setEnabled(v) { enabled = Boolean(v); if (!enabled) releaseAll(); },
    /** 큰 화면 판정을 그 칸에 보여 줍니다 */
    judge(l, j) { const s = st[l]; if (!s) return; s.judge = j; s.jt = performance.now(); kick(); },
    /** 키보드·시험용 누르기/떼기 */
    press(l, info = {}) { press(l, { t: performance.now(), ...info }); },
    release(l, info = {}) { release(l, { t: performance.now(), ...info }); },
    releaseAll,
    held() { return st.map((s, i) => (s.down > 0 ? i : -1)).filter((i) => i >= 0); },
    /** 칸의 화면 좌표(시험에서 실제 터치를 보낼 자리) */
    pointOf(l) { const a = anchor(l); const r = canvas.getBoundingClientRect(); return { x: r.left + a.x, y: r.top + a.y }; },
    resize,
    destroy() {
      releaseAll();
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', resize);
      canvas.remove();
    }
  };
}
