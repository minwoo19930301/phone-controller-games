// 리듬 스텝 노트 길(하이웨이) 그리기: 2D 캔버스.
// 사람마다 세로 길 하나(내 색). 맨 위에 받침 화살표(리셉터)가 있고 노트는 아래에서 위로 올라옵니다(DDR 방식).
// 판정 글자, 콤보, 점수, 체력 띠, 맞힌 자리 불꽃, 박자 줄, 길게 누르기 몸통을 그립니다.
// 시간은 모두 곡 시간(초)입니다.

const ANTON = 'Anton, Impact, sans-serif';
const SANS = '"Pretendard Variable", Pretendard, -apple-system, system-ui, sans-serif';
// 4레인 ← ↓ ↑ →, 5레인 ↙ ↖ ● ↗ ↘ (위쪽 화살표를 기준으로 돌리는 각도, 도)
const ROT = { 4: [-90, 180, 0, 90], 5: [-135, -45, null, 45, 135] };
export const LANE_GLYPH = { 4: ['←', '↓', '↑', '→'], 5: ['↙', '↖', '●', '↗', '↘'] };
const JCOL = {
  perfect: ['#fff6c2', '#ffd23a', '#ff9d2e'],
  great: ['#eafff2', '#5ef0a0', '#1fb86b'],
  good: ['#e8f4ff', '#7cc8ff', '#3a86ff'],
  miss: ['#f0f0f0', '#9aa3b5', '#5d6577'],
  ok: ['#eafff2', '#5ef0a0', '#1fb86b'],
  ng: ['#ffe2e2', '#ff6b6b', '#c53030']
};
const JTEXT = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS', ok: 'OK!', ng: 'NG' };
const DIFF_KO = { easy: '쉬움', normal: '보통', hard: '어려움' };
const VISIBLE = { easy: 2.0, normal: 1.65, hard: 1.35 }; // 아래 끝에서 받침까지 걸리는 시간(초)

function hexToRgb(h) {
  const s = h.replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(hex, k) {
  const [r, g, b] = hexToRgb(hex);
  const f = (v) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }

// 위를 가리키는 DDR 화살표(가운데 기준, 크기 s)
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
function centerPath(g, s) {
  const k = s / 100, r = 12 * k, a = 36 * k;
  g.beginPath();
  g.moveTo(-a + r, -a);
  g.arcTo(a, -a, a, a, r);
  g.arcTo(a, a, -a, a, r);
  g.arcTo(-a, a, -a, -a, r);
  g.arcTo(-a, -a, a, -a, r);
  g.closePath();
}

const spriteCache = new Map();
function sprite(kind, color, lanes, lane, size) {
  const key = `${kind}|${color}|${lanes}|${lane}|${size}`;
  let c = spriteCache.get(key);
  if (c) return c;
  const S = Math.ceil(size * 1.25);
  c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.translate(S / 2, S / 2);
  const rot = ROT[lanes][lane];
  const center = rot === null;
  if (!center) g.rotate((rot * Math.PI) / 180);
  const path = () => (center ? centerPath(g, size) : arrowPath(g, size));
  g.lineJoin = 'round';
  if (kind === 'note') {
    path();
    g.lineWidth = size * 0.11;
    g.strokeStyle = 'rgba(4,6,12,.92)';
    g.stroke();
    const gr = g.createLinearGradient(0, -size * 0.45, 0, size * 0.45);
    gr.addColorStop(0, shade(color, 0.55));
    gr.addColorStop(0.45, color);
    gr.addColorStop(1, shade(color, -0.45));
    path();
    g.fillStyle = gr;
    g.fill();
    // 반짝이는 윗면
    g.save();
    path();
    g.clip();
    const gl = g.createLinearGradient(-size * 0.4, -size * 0.5, size * 0.2, size * 0.1);
    gl.addColorStop(0, 'rgba(255,255,255,.55)');
    gl.addColorStop(0.5, 'rgba(255,255,255,.08)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gl;
    g.fillRect(-size, -size, size * 2, size * 0.95);
    // 무늬 줄
    g.strokeStyle = 'rgba(255,255,255,.16)';
    g.lineWidth = size * 0.035;
    for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(-size, i * size * 0.2 + size * 0.3); g.lineTo(size, i * size * 0.2 - size * 0.3); g.stroke(); }
    g.restore();
    path();
    g.lineWidth = size * 0.035;
    g.strokeStyle = 'rgba(255,255,255,.9)';
    g.stroke();
  } else if (kind === 'recep') {
    path();
    g.fillStyle = 'rgba(14,18,30,.78)';
    g.fill();
    g.lineWidth = size * 0.075;
    g.strokeStyle = 'rgba(200,210,230,.85)';
    g.stroke();
    g.save();
    path();
    g.clip();
    g.lineWidth = size * 0.05;
    g.strokeStyle = rgba(color, 0.45);
    path();
    g.stroke();
    g.restore();
  } else if (kind === 'glow') {
    g.shadowColor = color;
    g.shadowBlur = size * 0.3;
    path();
    g.fillStyle = 'rgba(255,255,255,.95)';
    g.fill();
    g.shadowBlur = 0;
    path();
    g.lineWidth = size * 0.06;
    g.strokeStyle = color;
    g.stroke();
  } else if (kind === 'dead') {
    path();
    g.lineWidth = size * 0.1;
    g.strokeStyle = 'rgba(4,6,12,.85)';
    g.stroke();
    path();
    g.fillStyle = '#4a5160';
    g.fill();
  }
  spriteCache.set(key, c);
  return c;
}

export function createHighways(canvas) {
  const g = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  /** 사람 수에 맞춰 길 위치를 정합니다 */
  function layout(players) {
    const n = Math.max(1, players.length);
    const gap = n >= 4 ? 22 : 34;
    const maxW = n === 1 ? 560 : n === 2 ? 480 : n === 3 ? 420 : 380;
    const totalW = Math.min(W * 0.95, n * maxW + (n - 1) * gap);
    const hw = (totalW - (n - 1) * gap) / n;
    const x0 = (W - totalW) / 2;
    const top = Math.max(84, H * 0.1);
    players.forEach((p, i) => {
      const lanes = p.lanes || 4;
      const laneW = hw / lanes;
      const arrow = Math.min(laneW * 0.88, 120);
      p.rect = { x: x0 + i * (hw + gap), y: top, w: hw, h: H - top, laneW, arrow, rcy: top + 96 + arrow / 2 };
    });
  }

  function laneX(p, lane) { return p.rect.x + p.rect.laneW * (lane + 0.5); }

  // ---------- 효과 ----------
  function press(p, lane) { if (p.fx) p.fx.press[lane] = 1; }
  function judged(p, ev, now) {
    const fx = p.fx;
    if (!fx) return;
    const j = ev.j;
    if (ev.kind === 'judge' || ev.kind === 'hold') {
      fx.popup = { j, t: now, early: ev.early, err: ev.err || 0, wrong: ev.wrongLane, hold: ev.kind === 'hold' };
    }
    if (j === 'miss' || j === 'ng') { fx.missFlash[ev.lane] = 1; fx.shake = Math.max(fx.shake, 0.6); return; }
    fx.burst.push({ lane: ev.lane, t: now, j });
    const n = j === 'perfect' ? 14 : j === 'great' ? 10 : 6;
    const x = laneX(p, ev.lane), y = p.rect.rcy;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 120 + Math.random() * (j === 'perfect' ? 380 : 260);
      fx.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: 0.45 + Math.random() * 0.35, age: 0, c: j === 'perfect' && i % 2 ? '#ffe27a' : p.color });
    }
    if (p.judge && p.judge.st.combo > 0 && p.judge.st.combo % 50 === 0) fx.milestone = { n: p.judge.st.combo, t: now };
  }

  function roundRect(x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // ---------- 한 사람 길 ----------
  function drawPlayer(p, songT, now, o) {
    const R = p.rect;
    const { x, y, w } = R;
    const lanes = p.lanes || 4;
    const judge = p.judge;
    const st = judge ? judge.st : null;
    const fx = p.fx;
    const pps = (H - R.rcy) / (VISIBLE[p.diff] || VISIBLE.normal);
    const shakeX = fx && fx.shake > 0.01 ? Math.sin(now * 90) * fx.shake * 5 : 0;
    g.save();
    g.translate(shakeX, 0);

    // 바탕
    const bg = g.createLinearGradient(0, y, 0, H);
    bg.addColorStop(0, 'rgba(5,7,14,.9)');
    bg.addColorStop(0.6, 'rgba(5,7,14,.8)');
    bg.addColorStop(1, 'rgba(5,7,14,.55)');
    roundRect(x, y, w, H - y + 20, 18);
    g.fillStyle = bg;
    g.fill();
    g.save();
    roundRect(x, y, w, H - y + 20, 18);
    g.clip();
    // 레인 나눔
    for (let l = 1; l < lanes; l++) {
      g.fillStyle = 'rgba(255,255,255,.05)';
      g.fillRect(x + R.laneW * l - 0.5, R.rcy - R.arrow * 0.6, 1, H);
    }
    // 레인 바닥빛(누를 때)
    for (let l = 0; l < lanes; l++) {
      const pv = fx ? fx.press[l] : 0;
      if (pv > 0.01) {
        const lg = g.createLinearGradient(0, R.rcy, 0, R.rcy + 420);
        lg.addColorStop(0, rgba(p.color, 0.32 * pv));
        lg.addColorStop(1, rgba(p.color, 0));
        g.fillStyle = lg;
        g.fillRect(x + R.laneW * l, R.rcy - R.arrow * 0.5, R.laneW, 440);
      }
      const mv = fx ? fx.missFlash[l] : 0;
      if (mv > 0.01) {
        g.fillStyle = `rgba(255,70,90,${0.18 * mv})`;
        g.fillRect(x + R.laneW * l, R.rcy - R.arrow * 0.5, R.laneW, H);
      }
    }
    // 박자 줄
    if (o.beats) {
      const t0 = songT - 0.3, t1 = songT + (H - R.rcy) / pps;
      for (const b of o.beats) {
        if (b.t < t0) continue;
        if (b.t > t1) break;
        const by = R.rcy + (b.t - songT) * pps;
        g.fillStyle = b.bar ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.06)';
        g.fillRect(x + 6, by, w - 12, b.bar ? 2 : 1);
      }
    }
    g.restore();
    // 테두리
    roundRect(x + 0.5, y + 0.5, w - 1, H - y + 20, 18);
    g.lineWidth = 1.5;
    g.strokeStyle = rgba(p.color, p.connected === false ? 0.25 : 0.55);
    g.stroke();

    // 머리띠: 1P · 입력 · 난이도 · 점수
    const hy = y + 12;
    g.fillStyle = p.color;
    roundRect(x + 12, hy, 54, 34, 10);
    g.fill();
    g.fillStyle = '#0b1220';
    g.font = `400 24px ${ANTON}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(p.name || `${p.slot}P`, x + 39, hy + 18);
    g.textAlign = 'left';
    g.fillStyle = '#e8eef8';
    g.font = `800 15px ${SANS}`;
    const modeTxt = p.input === 'motion' ? '모션' : lanes === 5 ? '패드 5키' : '패드';
    g.fillText(modeTxt + (p.bot ? ' · 봇' : p.keys ? ' · 키보드' : ''), x + 76, hy + 10);
    g.fillStyle = '#9fb0cc';
    g.font = `700 13px ${SANS}`;
    g.fillText(`${DIFF_KO[p.diff] || '보통'} · ★${p.stars || 1}`, x + 76, hy + 28);
    g.textAlign = 'right';
    g.fillStyle = '#fff';
    g.font = `400 ${w < 300 ? 24 : 30}px ${ANTON}`;
    const shown = fx ? Math.round(fx.scoreShown) : 0;
    g.fillText(shown.toLocaleString('en-US').padStart(7, ' '), x + w - 14, hy + 19);

    // 체력 띠
    const ly = hy + 44, lw = w - 24;
    roundRect(x + 12, ly, lw, 10, 5);
    g.fillStyle = 'rgba(255,255,255,.1)';
    g.fill();
    const life = fx ? fx.lifeShown : 0.6;
    if (life > 0.002) {
      const low = life < 0.25;
      const lg = g.createLinearGradient(x + 12, 0, x + 12 + lw, 0);
      lg.addColorStop(0, low ? '#ff4a5a' : shade(p.color, -0.2));
      lg.addColorStop(1, low ? '#ff9a7a' : shade(p.color, 0.45));
      roundRect(x + 12, ly, Math.max(10, lw * life), 10, 5);
      g.fillStyle = lg;
      g.globalAlpha = low ? 0.55 + 0.45 * Math.abs(Math.sin(now * 8)) : 1;
      g.fill();
      g.globalAlpha = 1;
    }
    // 눈금
    g.fillStyle = 'rgba(0,0,0,.35)';
    for (let k = 1; k < 10; k++) g.fillRect(x + 12 + (lw * k) / 10, ly, 1.5, 10);
    if (st && st.failed) {
      g.font = `400 14px ${ANTON}`;
      g.fillStyle = '#ff6b7a';
      g.textAlign = 'right';
      g.fillText('FAILED', x + w - 14, ly + 26);
    }

    // 받침(리셉터): 박자마다 살짝 빛남
    const beatGlow = o.beatPulse || 0;
    for (let l = 0; l < lanes; l++) {
      const cx = laneX(p, l);
      const sp = sprite('recep', p.color, lanes, l, R.arrow);
      const pv = fx ? fx.press[l] : 0;
      const sc = 1 - pv * 0.08;
      const sw = sp.width / (R.arrow * 1.25) * R.arrow * 1.25 * sc;
      g.drawImage(sp, cx - sw / 2, R.rcy - sw / 2, sw, sw);
      if (beatGlow > 0.02) {
        g.globalAlpha = beatGlow * 0.32;
        const gs = sprite('glow', p.color, lanes, l, R.arrow);
        g.drawImage(gs, cx - R.arrow * 0.625, R.rcy - R.arrow * 0.625, R.arrow * 1.25, R.arrow * 1.25);
        g.globalAlpha = 1;
      }
      if (pv > 0.02) {
        g.globalAlpha = pv * 0.9;
        const gs = sprite('glow', p.color, lanes, l, R.arrow);
        g.drawImage(gs, cx - R.arrow * 0.625, R.rcy - R.arrow * 0.625, R.arrow * 1.25, R.arrow * 1.25);
        g.globalAlpha = 1;
      }
    }

    // 노트(받침을 지나 위로 올라간 노트가 머리띠·점수를 가리지 않게 체력 띠 아래로 자릅니다)
    if (judge) {
      g.save();
      g.beginPath();
      g.rect(x - 4, ly + 16, w + 8, H - ly);
      g.clip();
      const notes = judge.notes;
      const tEnd = songT + (H - R.rcy + R.arrow) / pps;
      const tStart = songT - 0.5;
      // 화면에 보이는 첫 노트를 이분 탐색으로 찾습니다(길게 누르기는 끝이 남아 있을 수 있어 조금 앞에서부터)
      let lo = 0, hi = notes.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (notes[m].t < tStart - 4) lo = m + 1; else hi = m; }
      const held = judge.heldLanes();
      // 몸통 먼저(머리가 위에 오도록)
      for (let i = lo; i < notes.length; i++) {
        const n = notes[i];
        if (n.t > tEnd) break;
        if (!n.hold) continue;
        const hs = n.hold.state;
        if (hs === 'ok') continue;
        const cx = laneX(p, n.lane);
        let y1 = R.rcy + (n.t - songT) * pps;
        const y2 = R.rcy + (n.hold.end - songT) * pps;
        if (hs === 'held') y1 = R.rcy;
        if (y2 < R.rcy - 4) continue;
        const bw = R.arrow * 0.5;
        const live = hs === 'held';
        const dead = hs === 'ng' || n.j === 'miss';
        const bgr = g.createLinearGradient(0, y1, 0, y2);
        bgr.addColorStop(0, dead ? 'rgba(90,96,110,.55)' : rgba(p.color, live ? 0.95 : 0.7));
        bgr.addColorStop(1, dead ? 'rgba(90,96,110,.3)' : rgba(p.color, live ? 0.6 : 0.35));
        roundRect(cx - bw / 2, y1, bw, Math.max(8, y2 - y1), bw / 2);
        g.fillStyle = bgr;
        g.fill();
        if (live) {
          g.save();
          roundRect(cx - bw / 2, y1, bw, Math.max(8, y2 - y1), bw / 2);
          g.clip();
          g.fillStyle = 'rgba(255,255,255,.28)';
          const off = (now * 260) % 26;
          for (let yy = y1 - 26 + off; yy < y2; yy += 26) g.fillRect(cx - bw / 2, yy, bw, 8);
          g.restore();
        }
        g.lineWidth = 2;
        g.strokeStyle = dead ? 'rgba(160,170,190,.4)' : 'rgba(255,255,255,.65)';
        roundRect(cx - bw / 2, y1, bw, Math.max(8, y2 - y1), bw / 2);
        g.stroke();
      }
      for (let i = lo; i < notes.length; i++) {
        const n = notes[i];
        if (n.t > tEnd) break;
        if (n.done && n.j !== 'miss') {
          // 길게 누르는 중이면 머리를 받침에 붙여 둡니다
          if (n.hold && n.hold.state === 'held') {
            const cx = laneX(p, n.lane);
            const sp = sprite('note', p.color, lanes, n.lane, R.arrow);
            const s = R.arrow * 1.25;
            g.drawImage(sp, cx - s / 2, R.rcy - s / 2, s, s);
          }
          continue;
        }
        const ny = R.rcy + (n.t - songT) * pps;
        if (ny < R.rcy - R.arrow * 1.6) continue;
        const cx = laneX(p, n.lane);
        const dead = n.j === 'miss';
        const sp = sprite(dead ? 'dead' : 'note', p.color, lanes, n.lane, R.arrow);
        const s = R.arrow * 1.25;
        if (dead) g.globalAlpha = Math.max(0, 1 - (R.rcy - ny) / (R.arrow * 1.6));
        g.drawImage(sp, cx - s / 2, ny - s / 2, s, s);
        g.globalAlpha = 1;
      }
      void held;
      g.restore();
    }

    // 터지는 불꽃
    if (fx) {
      for (let i = fx.burst.length - 1; i >= 0; i--) {
        const b = fx.burst[i];
        const age = now - b.t;
        if (age > 0.4) { fx.burst.splice(i, 1); continue; }
        const k = age / 0.4;
        const cx = laneX(p, b.lane);
        const col = b.j === 'perfect' ? '#ffe27a' : b.j === 'great' ? p.color : '#9fd0ff';
        g.globalCompositeOperation = 'lighter';
        const rg = g.createRadialGradient(cx, R.rcy, 0, cx, R.rcy, R.arrow * (0.6 + k * 0.8));
        rg.addColorStop(0, rgba(col.startsWith('#') ? col : '#ffffff', 0.55 * (1 - k)));
        rg.addColorStop(1, rgba(col.startsWith('#') ? col : '#ffffff', 0));
        g.fillStyle = rg;
        g.beginPath();
        g.arc(cx, R.rcy, R.arrow * (0.6 + k * 0.8), 0, Math.PI * 2);
        g.fill();
        g.lineWidth = 4 * (1 - k) + 1;
        g.strokeStyle = rgba(col.startsWith('#') ? col : '#ffffff', 0.9 * (1 - k));
        g.beginPath();
        g.arc(cx, R.rcy, R.arrow * (0.45 + k * 0.55), 0, Math.PI * 2);
        g.stroke();
        g.globalCompositeOperation = 'source-over';
      }
      g.globalCompositeOperation = 'lighter';
      for (let i = fx.sparks.length - 1; i >= 0; i--) {
        const s = fx.sparks[i];
        const k = s.age / s.life;
        g.fillStyle = rgba(s.c, Math.max(0, 1 - k));
        g.beginPath();
        g.arc(s.x, s.y, 3.2 * (1 - k) + 0.8, 0, Math.PI * 2);
        g.fill();
      }
      g.globalCompositeOperation = 'source-over';
    }

    // 판정 글자 + 콤보
    const midY = R.rcy + Math.min(220, (H - R.rcy) * 0.36);
    if (fx && fx.popup) {
      const age = now - fx.popup.t;
      if (age < 0.75) {
        const j = fx.popup.j;
        const cols = JCOL[j] || JCOL.good;
        const pop = age < 0.08 ? 1.35 - (age / 0.08) * 0.35 : 1;
        const a = age > 0.5 ? 1 - (age - 0.5) / 0.25 : 1;
        const fs = Math.min(w * 0.15, 54) * pop;
        g.save();
        g.globalAlpha = a;
        g.translate(x + w / 2, midY);
        g.font = `400 ${fs}px ${ANTON}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const tg = g.createLinearGradient(0, -fs / 2, 0, fs / 2);
        tg.addColorStop(0, cols[0]);
        tg.addColorStop(0.5, cols[1]);
        tg.addColorStop(1, cols[2]);
        g.lineWidth = fs * 0.12;
        g.strokeStyle = 'rgba(4,6,12,.85)';
        g.lineJoin = 'round';
        g.strokeText(JTEXT[j] || j, 0, 0);
        g.fillStyle = tg;
        g.fillText(JTEXT[j] || j, 0, 0);
        if ((j === 'great' || j === 'good') && !fx.popup.hold) {
          g.font = `800 ${Math.round(fs * 0.26)}px ${SANS}`;
          g.fillStyle = fx.popup.wrong ? '#ffcf8a' : fx.popup.early ? '#7cc8ff' : '#ff9a7a';
          g.fillText(fx.popup.wrong ? '방향 봐줌' : fx.popup.early ? '빨라요' : '늦어요', 0, fs * 0.62);
        }
        g.restore();
      }
    }
    if (st && st.combo >= 4) {
      const cy = midY + Math.min(w * 0.15, 54) * 0.98;
      const cp = fx ? fx.comboPop : 0;
      const fs = Math.min(w * 0.14, 48) * (1 + cp * 0.18);
      g.save();
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `400 ${fs}px ${ANTON}`;
      g.lineWidth = fs * 0.1;
      g.strokeStyle = 'rgba(4,6,12,.75)';
      g.strokeText(String(st.combo), x + w / 2, cy);
      g.fillStyle = '#ffffff';
      g.fillText(String(st.combo), x + w / 2, cy);
      g.font = `400 ${Math.round(fs * 0.32)}px ${ANTON}`;
      g.fillStyle = rgba(p.color, 0.95);
      g.fillText('COMBO', x + w / 2, cy + fs * 0.62);
      g.restore();
    }
    if (fx && fx.milestone && now - fx.milestone.t < 1.4) {
      const age = now - fx.milestone.t;
      g.save();
      g.globalAlpha = Math.max(0, 1 - age / 1.4);
      g.textAlign = 'center';
      g.font = `400 ${Math.min(w * 0.14, 46)}px ${ANTON}`;
      g.fillStyle = '#ffe27a';
      g.fillText(`${fx.milestone.n} COMBO!`, x + w / 2, R.rcy + R.arrow * 0.9 + age * 30);
      g.restore();
    }

    // 끊김·관전 표시
    if (p.connected === false) {
      g.fillStyle = 'rgba(4,6,12,.62)';
      roundRect(x, y, w, H - y + 20, 18);
      g.fill();
      g.textAlign = 'center';
      g.fillStyle = '#fff';
      g.font = `800 20px ${SANS}`;
      g.fillText('연결이 끊겼어요', x + w / 2, H * 0.5);
      g.fillStyle = '#9fb0cc';
      g.font = `700 15px ${SANS}`;
      g.fillText('다시 들어오면 이어서 해요', x + w / 2, H * 0.5 + 26);
    }
    g.restore();
  }

  function step(players, dt) {
    for (const p of players) {
      const fx = p.fx;
      if (!fx) continue;
      for (let l = 0; l < fx.press.length; l++) {
        const held = p.held && p.held.has(l);
        fx.press[l] = held ? Math.max(fx.press[l], 0.75) : fx.press[l] * Math.exp(-dt * 9);
        fx.missFlash[l] *= Math.exp(-dt * 6);
      }
      fx.shake *= Math.exp(-dt * 10);
      fx.comboPop *= Math.exp(-dt * 12);
      for (let i = fx.sparks.length - 1; i >= 0; i--) {
        const s = fx.sparks[i];
        s.age += dt;
        if (s.age >= s.life) { fx.sparks.splice(i, 1); continue; }
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 600 * dt;
        s.vx *= Math.exp(-dt * 2);
      }
      const st = p.judge ? p.judge.st : null;
      const score = p.judge ? p.judge.score : 0;
      fx.scoreShown += (score - fx.scoreShown) * Math.min(1, dt * 12);
      if (Math.abs(score - fx.scoreShown) < 1) fx.scoreShown = score;
      const life = st ? st.life : 0.6;
      fx.lifeShown += (life - fx.lifeShown) * Math.min(1, dt * 8);
    }
  }

  function draw(players, songT, now, o = {}) {
    g.clearRect(0, 0, W, H);
    for (const p of players) if (p.rect) drawPlayer(p, songT, now, o);
  }
  function clear() { g.clearRect(0, 0, W, H); }

  return { layout, draw, step, press, judged, clear, resize, get width() { return W; }, get height() { return H; } };
}

/** 사람 하나의 효과 상태 */
export function newFx(lanes) {
  return { press: new Array(lanes).fill(0), missFlash: new Array(lanes).fill(0), burst: [], sparks: [], popup: null, comboPop: 0, shake: 0, scoreShown: 0, lifeShown: 0.6, milestone: null };
}
