// 에어하키 튜토리얼용 연습 판: 폰 화면 안의 작은 반쪽 코트에서 말렛·퍽을 직접 움직여 봅니다.
// 큰 화면과 같은 크기 단위(m)와 같은 충돌 방식을 써서, 연습한 손맛이 실제 경기와 같습니다.
// kind: 'drag'(원 3개 지나가기) | 'hit'(퍽 치기) | 'shoot'(위로 세게 밀기) | 'block'(내려오는 퍽 막기)
// 좌표: x = 왼쪽(−0.5) → 오른쪽(+0.5), z = 위(0, 가운데 선 = 상대 쪽) → 아래(1, 내 골문).
import { haptics } from '/common/haptics.js';

const MR = 0.056; // 말렛 반지름(큰 화면과 같음)
const PR = 0.04; // 퍽 반지름
const HW = 0.5; // 반쪽 폭
const LEN = 1; // 반쪽 길이
const E_WALL = 0.9;
const E_MALLET = 0.88;
const MAX_MALLET = 9;
const MAX_PUCK = 6.5;
const SHOT_MIN = 2.4; // 슛으로 쳐 주는 최소 속도(m/s) ≈ 9km/h
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const CSS = `
.ahp{position:relative;width:100%;display:flex;justify-content:center;margin:4px 0 0;}
.ahp canvas{display:block;border-radius:20px;touch-action:none;-webkit-user-select:none;user-select:none;
  box-shadow:0 16px 40px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.08);}
/* 가로 폰: 공통 튜토리얼은 그림이 없으면 글 아래에 판을 쌓아서 화면을 넘칩니다. 그림 자리(왼쪽 칸)에 판을 둡니다. */
@media (orientation:landscape) and (max-height:540px){
  .pcgt-card > .pcgt-stage.ahp-stage{grid-column:1;grid-row:1/span 6;width:auto;align-self:center;}
  .ahp{margin:0;}
}
`;
function injectCss() {
  if (document.getElementById('ahp-css')) return;
  const s = document.createElement('style');
  s.id = 'ahp-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/**
 * opts: { kind, color(문자열 또는 함수), goal(m), onEvent(name, data), onFail(msg) }
 * 반환: { destroy(), setAuto(on), state }
 */
export function createPractice(stage, opts = {}) {
  injectCss();
  const kind = opts.kind || 'hit';
  // 색은 함수로 줘도 됩니다(연습 중에 자리를 받아 내 색이 정해지는 경우).
  const colorOf = () => (typeof opts.color === 'function' ? opts.color() : opts.color) || '#ff5a5f';
  let color = colorOf();
  const goal = clamp(Number(opts.goal) || 0.38, 0.25, 0.6);
  const wrap = document.createElement('div');
  wrap.className = 'ahp';
  const cv = document.createElement('canvas');
  wrap.appendChild(cv);
  stage.appendChild(wrap);
  stage.classList.add('ahp-stage');
  const g = cv.getContext('2d');

  // ---------- 크기 ----------
  let CW = 300;
  let CH = 320;
  let dpr = 1;
  const fit = { s: 1, ox: 0, oy: 0 };
  function size() {
    const land = window.innerHeight < window.innerWidth;
    // 가로에서는 판이 왼쪽 칸에 따로 서므로(위 CSS) 폭은 화면 폭의 42% 까지, 높이는 위·아래 줄을 빼고 씁니다.
    const avail = land ? Math.max(170, Math.min(window.innerWidth * 0.42, 360)) : Math.max(200, Math.min(stage.clientWidth || 320, 360));
    const maxH = Math.max(170, land ? window.innerHeight - 130 : window.innerHeight * 0.4);
    CW = Math.round(Math.min(avail, maxH / 1.06));
    CH = Math.round(CW * 1.06);
    dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = CW * dpr;
    cv.height = CH * dpr;
    cv.style.width = `${CW}px`;
    cv.style.height = `${CH}px`;
    // 옆은 레일만큼, 위아래는 '▲ 상대 쪽' · '내 골문' 글자가 판 밖에 들어갈 만큼 띄웁니다(작은 폰에서도 글자가 판을 가리지 않게).
    const padX = 16;
    const padY = 26;
    fit.s = Math.min((CW - padX * 2) / (2 * HW), (CH - padY * 2) / LEN);
    fit.ox = (CW - fit.s * 2 * HW) / 2;
    fit.oy = (CH - fit.s * LEN) / 2;
  }
  size();
  const X = (x) => fit.ox + (x + HW) * fit.s;
  const Y = (z) => fit.oy + z * fit.s;
  window.addEventListener('resize', size);

  // ---------- 상태 ----------
  const m = { x: 0, z: 0.82, vx: 0, vz: 0, tx: 0, tz: 0.82 };
  // done: 이번 퍽은 이미 셌음(막기), dead: 판 밖으로 나감(골·상대 쪽) → 다시 놓을 때까지 멈춤
  const p = { x: 0, z: 0.45, vx: 0, vz: 0, on: kind !== 'drag', done: false, dead: false, spin: 0, angle: 0 };
  const trail = [];
  const rings = []; // 맞힐 때 퍼지는 고리 { x, z, t, c }
  const floats = []; // 떠오르는 글자 { text, x, z, t, c }
  const targets = kind === 'drag' ? [{ x: -0.27, z: 0.32 }, { x: 0.28, z: 0.5 }, { x: -0.12, z: 0.8 }].map((t) => ({ ...t, got: false, at: 0 })) : [];
  let finger = null; // { x, z } 세계 좌표
  let touchedOnce = false;
  let lastTouch = 0;
  let resetAt = 0; // 이 시각에 퍽을 다시 놓습니다
  let hitAt = 0;
  let movedSince = 0; // 퍽을 친 뒤(슛 판정용)
  let doneFlash = 0;
  let auto = false;
  let autoPhase = 0;
  let stillSince = 0;
  let dead = false;

  function resetPuck() {
    resetAt = 0;
    p.done = false;
    p.dead = false;
    p.spin = 0;
    trail.length = 0;
    stillSince = 0;
    autoPhase = 0;
    if (kind === 'hit') {
      p.x = (Math.random() - 0.5) * 0.36;
      p.z = 0.36 + Math.random() * 0.2;
      p.vx = p.vz = 0;
    } else if (kind === 'shoot') {
      p.x = (Math.random() - 0.5) * 0.24;
      p.z = 0.5;
      p.vx = p.vz = 0;
    } else if (kind === 'block') {
      // 위(상대 쪽)에서 내 골문 안쪽을 노리고 내려옵니다. 처음 몇 번은 느리게.
      p.x = (Math.random() - 0.5) * 0.6;
      p.z = 0.03;
      const tx = (Math.random() - 0.5) * goal * 0.7;
      const dx = tx - p.x;
      const dz = LEN - p.z;
      const d = Math.hypot(dx, dz);
      const sp = 1.15 + Math.random() * 0.25;
      p.vx = (dx / d) * sp;
      p.vz = (dz / d) * sp;
    }
    p.on = true;
  }
  if (kind !== 'drag') resetPuck();

  // ---------- 손가락 ----------
  function toWorld(e) {
    const r = cv.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * CW;
    const sy = ((e.clientY - r.top) / r.height) * CH;
    return { x: (sx - fit.ox) / fit.s - HW, z: (sy - fit.oy) / fit.s };
  }
  let pid = null;
  const down = (e) => {
    e.preventDefault();
    if (pid != null && pid !== e.pointerId) return;
    pid = e.pointerId;
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    auto = false;
    finger = toWorld(e);
    touchedOnce = true;
    lastTouch = performance.now();
  };
  const move = (e) => {
    if (e.pointerId !== pid) return;
    e.preventDefault();
    finger = toWorld(e);
    lastTouch = performance.now();
  };
  const up = (e) => {
    if (e.pointerId !== pid) return;
    pid = null;
  };
  cv.addEventListener('pointerdown', down);
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('lostpointercapture', up);

  // ---------- 시험용 자동 손가락(?debug, 헤드리스 확인) ----------
  function autoFinger(dt) {
    const sp = 1.6 * dt;
    let gx = m.x;
    let gz = m.z;
    if (kind === 'drag') {
      const t = targets.find((q) => !q.got);
      if (t) { gx = t.x; gz = t.z; }
    } else if (kind === 'hit') {
      gx = p.x;
      gz = p.z + 0.02;
    } else if (kind === 'shoot') {
      // 퍽 바로 아래로 돌아간 다음 위로 빠르게 밀어 올립니다.
      if (autoPhase === 0) {
        gx = p.x;
        gz = Math.min(LEN - MR, p.z + 0.22);
        if (Math.hypot(m.x - gx, m.z - gz) < 0.02) autoPhase = 1;
      } else {
        finger = { x: p.x, z: p.z - 0.4 };
        return;
      }
    } else if (kind === 'block') {
      gx = p.x + (p.vz > 0 ? (p.vx / Math.max(0.2, p.vz)) * (0.8 - p.z) : 0);
      gz = 0.8;
    }
    const f = finger || { x: m.x, z: m.z };
    const dx = gx - f.x;
    const dz = gz - f.z;
    const d = Math.hypot(dx, dz);
    finger = d <= sp ? { x: gx, z: gz } : { x: f.x + (dx / d) * sp, z: f.z + (dz / d) * sp };
  }

  // ---------- 물리 ----------
  function wallsPuck() {
    if (p.x < -HW + PR) { p.x = -HW + PR; if (p.vx < 0) p.vx = -p.vx * E_WALL; }
    else if (p.x > HW - PR) { p.x = HW - PR; if (p.vx > 0) p.vx = -p.vx * E_WALL; }
    // 위(가운데 선): '퍽 치기'만 막혀 있고, 슛·막기는 넘어가면 상대 쪽으로 사라집니다.
    if (kind === 'hit' && p.z < PR) { p.z = PR; if (p.vz < 0) p.vz = -p.vz * E_WALL; }
    // 아래: 내 골문 자리만 뚫려 있습니다.
    if (p.z > LEN - PR) {
      if (Math.abs(p.x) < goal / 2) {
        if (p.z > LEN + PR) return 'own';
      } else {
        p.z = LEN - PR;
        if (p.vz > 0) p.vz = -p.vz * E_WALL;
      }
    }
    if (p.z < -PR * 1.5 && kind !== 'hit') return 'out';
    return null;
  }
  function collide(mx, mz) {
    const R = PR + MR;
    const dx = p.x - mx;
    const dz = p.z - mz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= R * R) return 0;
    const d = Math.sqrt(d2) || 1e-6;
    const nx = d2 > 1e-12 ? dx / d : 0;
    const nz = d2 > 1e-12 ? dz / d : -1;
    p.x = mx + nx * R;
    p.z = mz + nz * R;
    const rvx = p.vx - m.vx;
    const rvz = p.vz - m.vz;
    const vn = rvx * nx + rvz * nz;
    if (vn >= 0) return 0;
    p.vx -= (1 + E_MALLET) * vn * nx;
    p.vz -= (1 + E_MALLET) * vn * nz;
    p.spin += clamp((rvx * -nz + rvz * nx) * 18, -40, 40);
    // 큰 화면과 같게: 맞은 순간은 말렛 빠르기까지 허용하고 넘친 몫은 step 에서 곧 줄입니다(퍽이 말렛에 붙어 끌려가지 않게).
    const cap = Math.min(9.5, Math.max(MAX_PUCK, Math.hypot(m.vx, m.vz) * 1.05));
    const s = Math.hypot(p.vx, p.vz);
    if (s > cap) { p.vx *= cap / s; p.vz *= cap / s; }
    return -vn;
  }

  function onHit(rel, now) {
    const q = clamp(rel / 5, 0.1, 1);
    rings.push({ x: p.x, z: p.z, t: now, c: color, r: 0.08 + q * 0.12 });
    try { haptics.hit(q); } catch (e) {}
    hitAt = now;
    movedSince = now;
    if (kind === 'hit') {
      floats.push({ text: '딱!', x: p.x, z: p.z - 0.08, t: now, c: color });
      opts.onEvent && opts.onEvent('hit', { strength: q });
      resetAt = now + 1100;
    } else if (kind === 'block') {
      if (!p.done) {
        floats.push({ text: '막았다!', x: p.x, z: p.z - 0.1, t: now, c: '#7ef0a0' });
        opts.onEvent && opts.onEvent('block', { strength: q });
        p.done = true; // 한 번 막으면 이번 퍽은 끝(튕겨 나가는 모습은 그대로 보여 줌)
        resetAt = now + 1200;
      }
    }
  }

  function step(dt, now) {
    if (auto) autoFinger(dt);
    // 말렛: 손가락을 최고 속도 안에서 따라갑니다(큰 화면과 같은 방식).
    if (finger) {
      m.tx = clamp(finger.x, -HW + MR, HW - MR);
      m.tz = clamp(finger.z, MR, LEN - MR);
    }
    const px = m.x;
    const pz = m.z;
    let dx = m.tx - m.x;
    let dz = m.tz - m.z;
    const d = Math.hypot(dx, dz);
    const maxD = MAX_MALLET * dt;
    if (d > maxD) { dx *= maxD / d; dz *= maxD / d; }
    m.x += dx;
    m.z += dz;
    const k = clamp(dt / 0.02, 0, 1);
    m.vx += (dx / Math.max(dt, 1e-4) - m.vx) * k;
    m.vz += (dz / Math.max(dt, 1e-4) - m.vz) * k;

    // 원 지나가기
    if (kind === 'drag' && finger) {
      for (const t of targets) {
        if (!t.got && Math.hypot(m.x - t.x, m.z - t.z) < 0.075) {
          t.got = true;
          t.at = now;
          rings.push({ x: t.x, z: t.z, t: now, c: '#7ef0a0', r: 0.16 });
          try { haptics.tick(); } catch (e) {}
          const left = targets.filter((q) => !q.got).length;
          floats.push({ text: left ? `${3 - left}/3` : '3/3', x: t.x, z: t.z - 0.09, t: now, c: '#7ef0a0' });
          if (!left) opts.onEvent && opts.onEvent('drag', { count: 3 });
        }
      }
    }
    if (!p.on) return;
    if (resetAt && now >= resetAt) resetPuck();
    if (p.dead) return;
    // 퍽: 빠른 말렛이 뚫고 지나가지 않게 잘게 나눠 계산합니다.
    const travel = Math.max(Math.hypot(p.vx, p.vz) * dt, Math.hypot(m.x - px, m.z - pz));
    const n = clamp(Math.ceil(travel / (PR * 0.35)), 1, 30);
    const h = dt / n;
    const fr = Math.exp(-0.25 * h);
    const over = Math.exp(-30 * h);
    for (let i = 1; i <= n; i++) {
      const u = i / n;
      p.vx *= fr;
      p.vz *= fr;
      const sp0 = Math.hypot(p.vx, p.vz);
      if (sp0 > MAX_PUCK) {
        const k = (MAX_PUCK + (sp0 - MAX_PUCK) * over) / sp0;
        p.vx *= k;
        p.vz *= k;
      }
      p.x += p.vx * h;
      p.z += p.vz * h;
      p.spin *= Math.exp(-1.2 * h);
      p.angle += p.spin * h;
      const rel = collide(px + (m.x - px) * u, pz + (m.z - pz) * u);
      if (rel > 0.25 && now - hitAt > 120) onHit(rel, now);
      const w = wallsPuck();
      if (w === 'own') {
        p.vx = p.vz = 0;
        p.dead = true;
        resetAt = now + 900;
        floats.push({ text: kind === 'block' ? '골 먹었어요' : '앗, 내 골문!', x: 0, z: LEN - 0.14, t: now, c: '#ff8a8a' });
        try { haptics.play('warn', 0.6); } catch (e) {}
        opts.onFail && opts.onFail(kind === 'block' ? '퍽이 오는 길목, 골문 앞에 말렛을 두고 막아요' : '아래는 내 골문이에요. 위쪽으로 쳐요');
        return;
      }
      if (w === 'out') {
        const sp = Math.hypot(p.vx, p.vz);
        p.dead = true;
        p.vx = p.vz = 0;
        resetAt = now + 900;
        if (kind === 'shoot') {
          const kmh = Math.round(sp * 3.6);
          if (sp >= SHOT_MIN) {
            floats.push({ text: `슛! ${kmh}km/h`, x: clamp(p.x, -0.3, 0.3), z: 0.12, t: now, c: color });
            try { haptics.play('strong', 1); } catch (e) {}
            opts.onEvent && opts.onEvent('goal', { speed: sp, kmh });
          } else {
            floats.push({ text: `${kmh}km/h`, x: clamp(p.x, -0.3, 0.3), z: 0.12, t: now, c: '#ffcf8a' });
            opts.onFail && opts.onFail('조금 약해요. 퍽 뒤에서 위로 휙 밀어 쳐요');
          }
        }
        return;
      }
    }
    // 멈춘 퍽(슛 실패 등)은 잠시 뒤 다시 놓습니다.
    const spd = Math.hypot(p.vx, p.vz);
    if (spd < 0.08 && hitAt && now - hitAt > 400 && !resetAt) {
      if (!stillSince) stillSince = now;
      if (now - stillSince > 1300) {
        if (kind === 'shoot') opts.onFail && opts.onFail('위쪽(상대 쪽)으로 빠르게 밀어 보내요');
        resetAt = now + 200;
      }
    } else {
      stillSince = 0;
    }
    if (!p.dead) {
      trail.push({ x: p.x, z: p.z, t: now });
      while (trail.length && now - trail[0].t > 180) trail.shift();
    }
  }

  // ---------- 그리기 ----------
  function rr(x, y, w, h, r) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r);
    else g.rect(x, y, w, h);
  }
  function draw(now) {
    color = colorOf();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, CW, CH);
    const L = X(-HW);
    const R = X(HW);
    const T = Y(0);
    const B = Y(LEN);
    // 레일
    g.fillStyle = '#121019';
    rr(L - 11, T - 11, R - L + 22, B - T + 22, 18);
    g.fill();
    // 판
    const grd = g.createLinearGradient(0, T, 0, B);
    grd.addColorStop(0, '#f4f6fa');
    grd.addColorStop(1, '#e4e8f0');
    g.fillStyle = grd;
    g.fillRect(L, T, R - L, B - T);
    g.save();
    g.beginPath();
    g.rect(L, T, R - L, B - T);
    g.clip();
    g.fillStyle = 'rgba(80,90,110,.3)';
    for (let x = -HW + 0.025; x < HW; x += 0.05) for (let z = 0.025; z < LEN; z += 0.05) g.fillRect(X(x) - 1, Y(z) - 1, 2, 2);
    // 가운데 원·선
    g.strokeStyle = '#e2323f';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(X(0), Y(0), 0.165 * fit.s, 0, Math.PI);
    g.stroke();
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(L, T);
    g.lineTo(R, T);
    g.stroke();
    // 내 골 크리스
    g.fillStyle = color + '22';
    g.strokeStyle = color;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(X(0), Y(LEN), 0.24 * fit.s, Math.PI, Math.PI * 2);
    g.fill();
    g.stroke();
    // 슛: 위쪽으로 보내라는 화살표 띠
    if (kind === 'shoot') {
      const a = 0.25 + 0.2 * Math.sin(now / 260);
      g.fillStyle = `rgba(57,230,255,${a})`;
      for (let i = 0; i < 3; i++) {
        const y = Y(0.06 + i * 0.07);
        g.beginPath();
        g.moveTo(X(-0.12), y + 12);
        g.lineTo(X(0), y);
        g.lineTo(X(0.12), y + 12);
        g.lineTo(X(0.12), y + 18);
        g.lineTo(X(0), y + 6);
        g.lineTo(X(-0.12), y + 18);
        g.closePath();
        g.fill();
      }
    }
    // 원 지나가기 목표
    for (const t of targets) {
      const r = 0.075 * fit.s;
      g.save();
      if (t.got) {
        g.fillStyle = 'rgba(94,224,122,.25)';
        g.strokeStyle = '#3cc46a';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(X(t.x), Y(t.z), r, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.strokeStyle = '#1f8f47';
        g.lineWidth = 4;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(X(t.x) - r * 0.4, Y(t.z));
        g.lineTo(X(t.x) - r * 0.08, Y(t.z) + r * 0.32);
        g.lineTo(X(t.x) + r * 0.45, Y(t.z) - r * 0.3);
        g.stroke();
      } else {
        const pulse = 1 + 0.08 * Math.sin(now / 180 + t.x * 9);
        g.setLineDash([6, 6]);
        g.lineDashOffset = -now / 40;
        g.strokeStyle = color;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(X(t.x), Y(t.z), r * pulse, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = color + '1c';
        g.fill();
      }
      g.restore();
    }
    g.restore();
    // 테두리: 벽 네온, 가운데 줄 점선, 골문 구멍
    g.save();
    g.strokeStyle = color;
    g.lineWidth = 5;
    g.shadowColor = color;
    g.shadowBlur = 12;
    g.beginPath();
    g.moveTo(L, T);
    g.lineTo(L, B);
    g.moveTo(R, T);
    g.lineTo(R, B);
    g.moveTo(L, B);
    g.lineTo(X(-goal / 2), B);
    g.moveTo(X(goal / 2), B);
    g.lineTo(R, B);
    if (kind === 'hit') {
      g.moveTo(L, T);
      g.lineTo(R, T);
    }
    g.stroke();
    g.restore();
    g.fillStyle = '#06070a';
    g.fillRect(X(-goal / 2), B, X(goal / 2) - X(-goal / 2), 10);
    g.font = '800 11px "Pretendard Variable", Pretendard, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,255,255,.75)';
    g.fillText('내 골문', X(0), B + 18);
    if (kind !== 'hit') {
      g.fillStyle = 'rgba(255,255,255,.7)';
      g.fillText('▲ 상대 쪽', X(0), T - 18);
    }
    // 고리
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      const u = (now - r.t) / 450;
      if (u >= 1) { rings.splice(i, 1); continue; }
      g.strokeStyle = r.c;
      g.globalAlpha = 1 - u;
      g.lineWidth = 4 * (1 - u) + 1;
      g.beginPath();
      g.arc(X(r.x), Y(r.z), (0.04 + r.r * u) * fit.s, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    }
    // 퍽 꼬리와 퍽
    if (p.on && !p.dead) {
      if (trail.length > 1) {
        g.strokeStyle = 'rgba(15,180,255,.35)';
        g.lineCap = 'round';
        for (let i = 1; i < trail.length; i++) {
          g.lineWidth = PR * fit.s * 1.6 * (i / trail.length);
          g.beginPath();
          g.moveTo(X(trail[i - 1].x), Y(trail[i - 1].z));
          g.lineTo(X(trail[i].x), Y(trail[i].z));
          g.stroke();
        }
      }
      const pr = PR * fit.s;
      g.save();
      g.shadowColor = '#39e6ff';
      g.shadowBlur = 14;
      g.fillStyle = '#16181e';
      g.beginPath();
      g.arc(X(p.x), Y(p.z), pr, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.strokeStyle = '#7df3ff';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(X(p.x), Y(p.z), pr * 0.62, p.angle, p.angle + Math.PI * 1.5);
      g.stroke();
    }
    // 말렛
    {
      const mx = X(m.x);
      const my = Y(m.z);
      const mr = MR * fit.s;
      const active = pid != null || auto;
      g.save();
      g.shadowColor = color;
      g.shadowBlur = active ? 24 : 10;
      g.fillStyle = color;
      g.beginPath();
      g.arc(mx, my, mr, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(0,0,0,.18)';
      g.beginPath();
      g.arc(mx, my, mr * 0.62, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = color;
      g.beginPath();
      g.arc(mx, my, mr * 0.42, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.55)';
      g.beginPath();
      g.arc(mx - mr * 0.15, my - mr * 0.15, mr * 0.16, 0, Math.PI * 2);
      g.fill();
      if (active) {
        g.strokeStyle = 'rgba(255,255,255,.9)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(mx, my, mr + 7, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
    }
    // 아직 안 만졌거나 한동안 손을 뗐으면 반투명 엄지가 할 일을 보여 줍니다.
    if (!auto && (!touchedOnce || (pid == null && now - lastTouch > 3500))) drawGhost(now);
    // 떠오르는 글자
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      const u = (now - f.t) / 1000;
      if (u >= 1) { floats.splice(i, 1); continue; }
      g.save();
      g.globalAlpha = u < 0.75 ? 1 : 1 - (u - 0.75) / 0.25;
      g.font = '900 22px "Pretendard Variable", Pretendard, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 5;
      g.strokeStyle = 'rgba(11,15,23,.85)';
      const y = Y(f.z) - u * 26;
      g.strokeText(f.text, X(f.x), y);
      g.fillStyle = f.c;
      g.fillText(f.text, X(f.x), y);
      g.restore();
    }
    if (doneFlash > 0) {
      g.fillStyle = `rgba(126,240,160,${doneFlash * 0.25})`;
      g.fillRect(L, T, R - L, B - T);
      doneFlash = Math.max(0, doneFlash - 0.04);
    }
  }
  // 엄지 그림: 말렛에서 다음 할 곳으로 미끄러지는 반투명 손가락 끝
  function drawGhost(now) {
    let to = null;
    if (kind === 'drag') to = targets.find((t) => !t.got);
    else if (kind === 'hit') to = { x: p.x, z: p.z + 0.02 };
    else if (kind === 'shoot') to = { x: p.x, z: p.z - 0.3 };
    else if (kind === 'block') to = { x: clamp(p.x, -0.2, 0.2), z: 0.8 };
    if (!to) return;
    const from = kind === 'shoot' ? { x: p.x, z: Math.min(0.92, p.z + 0.25) } : { x: m.x, z: m.z };
    const u = ((now / 1300) % 1);
    const e = u < 0.7 ? 1 - Math.pow(1 - u / 0.7, 3) : 1;
    const x = X(from.x + (to.x - from.x) * e);
    const y = Y(from.z + (to.z - from.z) * e);
    g.save();
    g.globalAlpha = u < 0.85 ? 0.75 : (1 - u) / 0.15 * 0.75;
    g.fillStyle = '#e2ae86';
    g.strokeStyle = 'rgba(255,255,255,.85)';
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(x + 4, y + 16, 13, 19, -0.25, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#f6d3b8';
    g.beginPath();
    g.ellipse(x + 1, y + 6, 7, 8, -0.25, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  // ---------- 돌리기 ----------
  let last = performance.now();
  let raf = 0;
  function loop() {
    if (dead) return;
    const now = performance.now();
    const dt = Math.min(0.033, Math.max(0.001, (now - last) / 1000));
    last = now;
    step(dt, now);
    draw(now);
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  return {
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', size);
      wrap.remove();
      stage.classList.remove('ahp-stage');
    },
    /** 시험용: 손가락을 저절로 움직여 이 단계를 해 봅니다. */
    setAuto(on) {
      auto = Boolean(on);
      if (auto) {
        touchedOnce = true;
        finger = finger || { x: m.x, z: m.z };
      }
    },
    /** 단계가 끝났을 때 판을 한 번 초록으로 번쩍 */
    celebrate() { doneFlash = 1; },
    get state() { return { kind, m: { ...m }, p: { ...p }, targets: targets.map((t) => t.got) }; }
  };
}

export default createPractice;
