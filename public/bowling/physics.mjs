// 볼링 가벼운 물리(순수 모듈, DOM·three 없음). 화면(game.js)과 시험이 같이 씁니다.
// 좌표: x = 가로(오른쪽 +, m), y = 파울 라인에서 핀 쪽으로 간 거리(m). 3D 에서는 z = -y.
// 공은 레인을 구르며 기름이 끝나는 뒤쪽 1/3 에서 휘고(훅), 공-핀·핀-핀 충돌은 위에서 본 원(원판) 충돌로 운동량을 주고받습니다.
// 핀은 충격이 문턱을 넘으면 넘어지고, 넘어진 핀은 미끄러지고 돌면서 다른 핀을 쓰러뜨립니다.
// 결과에는 60Hz 로 기록한 공·핀의 움직임이 들어 있어 화면이 그대로 재생합니다.

export const C = {
  LANE_W: 1.0668,
  HALF: 0.5334, // 레인 반폭
  GUTTER_W: 0.235,
  HEAD_Y: 18.288, // 헤드 핀 중심
  PIN_DX: 0.1524,
  PIN_DY: 0.2639,
  PIT_Y: 18.288 + 0.9, // 데크 끝(이 뒤로 넘어가면 피트로 떨어짐)
  BALL_R: 0.1085,
  BALL_M: 6.0,
  PIN_R: 0.0605, // 서 있는 핀 몸통 반지름
  PIN_M: 1.53,
  FALL_R: 0.1, // 넘어진 핀을 위에서 본 원 반지름
  OIL_END: 12.2, // 기름이 끝나는 곳(여기서부터 훅이 커짐)
  HOOK_A: 0.95, // 훅 최대 가속(m/s², spin = 1 일 때)
  DRAG: 0.3, // 레인 위 속도 감소(m/s²)
  KICK: 0.72, // 맞은 핀이 속도를 가져가는 비율(나머지는 회전으로)
  TOPPLE_V: 1.25, // 핀이 넘어가는 최소 접근 속도(m/s)
  E_BP: 0.5, // 공-핀 반발
  E_PP: 0.55, // 핀-핀 반발
  SLIDE_DECEL: 2.0, // 넘어진 핀 미끄럼 감속
  STEP: 1 / 480,
  REC: 1 / 60
};

export const PIN_SPOTS = (() => {
  const a = [];
  for (let row = 0; row < 4; row++) {
    for (let k = 0; k <= row; k++) a.push({ x: (k - row / 2) * 2 * C.PIN_DX, y: C.HEAD_Y + row * C.PIN_DY });
  }
  return a; // 0=1번핀(헤드), 1=2, 2=3, 3..5 = 4,5,6, 6..9 = 7,8,9,10 (7 은 왼쪽 구석)
})();

export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const smooth = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// 공만 굴렸을 때의 길(핀 없이). 던지기 풀이와 안내선에 씁니다.
export function rollPath(x0, angle, speed, spin, { bumpers = false, dt = 1 / 120, untilY = C.HEAD_Y } = {}) {
  const pts = [];
  let x = x0, y = 0, vx = Math.sin(angle) * speed, vy = Math.cos(angle) * speed;
  let gutter = false;
  for (let i = 0; i < 1500 && y < untilY; i++) {
    stepBall(dt);
    if (i % 6 === 0) pts.push({ x, y });
    if (vy < 0.3) break;
  }
  pts.push({ x, y });
  return { pts, x, y, vx, vy, gutter };
  function stepBall(h) {
    const hook = 0.12 + 0.88 * smooth(y, C.OIL_END - 3.2, C.OIL_END + 4.2);
    vx += spin * C.HOOK_A * hook * h;
    const sp = Math.hypot(vx, vy);
    const k = Math.max(0, sp - C.DRAG * h) / (sp || 1);
    vx *= k; vy *= k;
    x += vx * h; y += vy * h;
    if (gutter) { x = x + (Math.sign(x) * (C.HALF + 0.117) - x) * Math.min(1, h * 14); vx = 0; return; }
    if (bumpers) {
      const lim = C.HALF - C.BALL_R;
      if (Math.abs(x) > lim) { x = Math.sign(x) * lim; vx = -vx * 0.35; if (Math.sign(vx) === Math.sign(x)) vx = 0; }
    } else if (Math.abs(x) > C.HALF) gutter = true;
  }
}

// 헤드 핀 높이에서 공이 targetX 에 오도록 하는 던지는 각도(라디안)를 찾습니다.
export function solveAngle(x0, speed, spin, targetX, opts = {}) {
  let lo = -0.3, hi = 0.3;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    const r = rollPath(x0, mid, speed, spin, { ...opts, bumpers: false });
    if (r.x < targetX) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
// 훅 방향에 맞는 포켓(1-3 또는 1-2 사이)의 x. 왼쪽으로 휘면(spin<0) 오른쪽 포켓.
export const pocketX = (spin) => (spin > 0.02 ? -0.05 : 0.05);

function newPin(i, rng) {
  const s = PIN_SPOTS[i];
  return { i, x: s.x + (rng() - 0.5) * 0.008, y: s.y + (rng() - 0.5) * 0.008, vx: 0, vy: 0, z: 0, vz: 0, state: 'stand', tilt: 0, wob: 0, wobT: 0, fallT: 0, yaw: 0, w: 0, hitBy: '' };
}

/**
 * 한 번 굴리기를 끝까지 계산합니다.
 * in: { x, angle(rad, + = 오른쪽), speed(m/s), spin(-1..1, + = 오른쪽으로 휨), standing: boolean[10], bumpers, rng }
 * out: { down: boolean[10](이번 공으로 쓰러진 핀), count, frames, n, ball:Float32Array(n*5: x,y,roll,z,state), pins:Float32Array(n*60), events, duration, guttered, ... }
 */
export function simulate(o) {
  const rng = o.rng || makeRng(1);
  const standing = o.standing || Array(10).fill(true);
  const H = C.STEP;
  const pins = [];
  for (let i = 0; i < 10; i++) {
    const p = newPin(i, rng);
    if (!standing[i]) p.state = 'off'; // 이미 치워진 핀
    pins.push(p);
  }
  const ball = { x: o.x, y: 0, vx: Math.sin(o.angle) * o.speed, vy: Math.cos(o.angle) * o.speed, roll: 0, state: 'roll', gutter: false, z: 0, vz: 0 };
  const speed0 = o.speed;
  const events = [];
  const recN = Math.ceil(9 / C.REC);
  const ballRec = new Float32Array(recN * 5);
  const pinRec = new Float32Array(recN * 60);
  let rec = 0, nextRec = 0, t = 0;
  let quietFor = 0;
  let ballPinFirst = null;
  const lastEv = {};
  const ev = (kind, power, x, y) => {
    const key = kind;
    if (lastEv[key] !== undefined && t - lastEv[key] < 0.045) return;
    lastEv[key] = t;
    events.push({ t, kind, power: clamp(power, 0, 1), x, y });
  };
  let minX = o.x, maxDev = 0;
  const x0 = o.x;

  const record = () => {
    const bi = rec * 5;
    ballRec[bi] = ball.x; ballRec[bi + 1] = ball.y; ballRec[bi + 2] = ball.roll; ballRec[bi + 3] = ball.z;
    ballRec[bi + 4] = ball.state === 'roll' ? 0 : ball.state === 'gutter' ? 1 : 2;
    for (let i = 0; i < 10; i++) {
      const p = pins[i];
      const k = rec * 60 + i * 6;
      pinRec[k] = p.x; pinRec[k + 1] = p.y; pinRec[k + 2] = p.z;
      let tilt = p.tilt;
      if (p.state === 'stand') tilt = p.wob * Math.sin(p.wobT * 26) * Math.exp(-p.wobT * 4.5);
      pinRec[k + 3] = tilt; pinRec[k + 4] = p.yaw;
      pinRec[k + 5] = p.state === 'stand' ? 0 : p.state === 'down' ? 1 : p.state === 'pit' ? 2 : 3; // 3 = 처음부터 없음
    }
    rec += 1;
  };

  const topple = (p, vx, vy, hard) => {
    p.state = 'down';
    const jit = (rng() - 0.5) * 0.5; // 핀마다 튀는 방향이 조금씩 다름(±14°)
    const cj = Math.cos(jit), sj = Math.sin(jit);
    [vx, vy] = [vx * cj - vy * sj, vx * sj + vy * cj];
    p.vx = vx; p.vy = vy;
    const sp = Math.hypot(vx, vy);
    p.yaw = Math.atan2(vy, vx);
    p.w = (rng() < 0.5 ? -1 : 1) * (1.5 + rng() * 3.5) * clamp(sp / 4, 0.4, 1.6);
    p.vz = hard ? clamp(sp * 0.22, 0.4, 3.2) * (0.6 + rng() * 0.7) : 0;
    p.fallT = 0;
  };
  const radius = (p) => (p.state === 'stand' ? C.PIN_R : C.FALL_R);

  while (t < 9 - C.REC) {
    // ---- 공 ----
    if (ball.state === 'roll' || ball.state === 'gutter') {
      if (ball.state === 'roll') {
        const hook = 0.12 + 0.88 * smooth(ball.y, C.OIL_END - 3.2, C.OIL_END + 4.2);
        ball.vx += o.spin * C.HOOK_A * hook * H;
      }
      const sp = Math.hypot(ball.vx, ball.vy);
      const k = Math.max(0, sp - C.DRAG * H) / (sp || 1);
      ball.vx *= k; ball.vy *= k;
      ball.x += ball.vx * H; ball.y += ball.vy * H;
      ball.roll += (Math.hypot(ball.vx, ball.vy) * H) / C.BALL_R;
      if (ball.state === 'roll') {
        if (o.bumpers) {
          const lim = C.HALF - C.BALL_R;
          if (Math.abs(ball.x) > lim) {
            ball.x = Math.sign(ball.x) * lim;
            if (Math.sign(ball.vx) === Math.sign(ball.x)) { ball.vx = -ball.vx * 0.35; ev('bumper', 0.25, ball.x, ball.y); }
          }
        } else if (Math.abs(ball.x) > C.HALF) { ball.state = 'gutter'; ball.gx = Math.sign(ball.x); ev('gutter', 0.5, ball.x, ball.y); }
      } else {
        const target = ball.gx * (C.HALF + 0.117);
        ball.x += (target - ball.x) * Math.min(1, H * 16);
        ball.vx = 0;
        ball.z = -0.06 * Math.min(1, t * 3);
      }
      if (ball.y > C.PIT_Y + 0.05) { ball.state = 'pit'; ball.vx = ball.vy = 0; }
      if (ball.vy < 0.4) { ball.state = ball.state === 'roll' ? 'dead' : ball.state; }
      // 공-핀
      if (ball.state === 'roll') {
        const dev = Math.abs(ball.x - (x0 + Math.tan(o.angle) * ball.y));
        if (dev > maxDev) maxDev = dev;
        if (ball.y > C.HEAD_Y - 0.5) {
          for (const p of pins) {
            if (p.state === 'off' || p.state === 'pit') continue;
            const dx = p.x - ball.x, dy = p.y - ball.y;
            const rr = C.BALL_R + radius(p);
            const d2 = dx * dx + dy * dy;
            if (d2 >= rr * rr) continue;
            const d = Math.sqrt(d2) || 1e-6;
            const nx = dx / d, ny = dy / d;
            const vrel = (ball.vx - p.vx) * nx + (ball.vy - p.vy) * ny;
            // 겹침 해소(공이 무거우니 핀을 밀어냄)
            p.x = ball.x + nx * rr; p.y = ball.y + ny * rr;
            if (vrel <= 0) continue;
            const e = p.state === 'stand' ? C.E_BP : 0.4;
            const j = ((1 + e) * vrel) / (1 / C.BALL_M + 1 / C.PIN_M);
            ball.vx -= (j * nx) / C.BALL_M; ball.vy -= (j * ny) / C.BALL_M;
            const pvx = p.vx + (j * nx) / C.PIN_M, pvy = p.vy + (j * ny) / C.PIN_M;
            if (p.state === 'stand') {
              if (!ballPinFirst) ballPinFirst = { t, x: ball.x, y: ball.y, pin: p.i, vx: ball.vx, vy: ball.vy };
              topple(p, pvx * C.KICK, pvy * C.KICK, true);
              ev('ball-pin', vrel / 8, p.x, p.y);
            } else { p.vx = pvx * (0.8 + 0.2 * C.KICK); p.vy = pvy * (0.8 + 0.2 * C.KICK); ev('pin-ball', vrel / 10, p.x, p.y); }
          }
        }
      }
    }

    // ---- 핀 ----
    for (const p of pins) {
      if (p.state === 'stand') { p.wobT += H; continue; }
      if (p.state !== 'down') continue;
      p.fallT += H;
      p.x += p.vx * H; p.y += p.vy * H;
      p.yaw += p.w * H;
      const sp = Math.hypot(p.vx, p.vy);
      if (p.z > 0 || p.vz > 0) {
        p.vz -= 9.8 * H; p.z += p.vz * H;
        if (p.z <= 0) { p.z = 0; if (p.vz < -1) { p.vz = -p.vz * 0.28; ev('pin-floor', Math.abs(p.vz) / 4, p.x, p.y); } else p.vz = 0; }
      } else if (sp > 0) {
        const k = Math.max(0, sp - C.SLIDE_DECEL * H) / sp;
        p.vx *= k; p.vy *= k; p.w *= 1 - 1.4 * H;
      }
      p.tilt = (Math.PI / 2) * smooth(p.fallT, 0, 0.3 + Math.min(0.4, 0.4 / (1 + sp)));
      // 데크 끝·옆
      if (p.y > C.PIT_Y + 0.06) { p.state = 'pit'; p.vz = 0; ev('pit', 0.3, p.x, p.y); }
      if (Math.abs(p.x) > 0.96) { p.x = Math.sign(p.x) * 0.96; p.vx = -p.vx * 0.55; ev('pin-wall', Math.abs(p.vx) / 6, p.x, p.y); }
      if (p.y < 0.5) { p.y = 0.5; p.vy = Math.abs(p.vy) * 0.3; }
    }
    // 핀-핀 (서 있는 핀도 넘어진 핀에 맞음)
    for (let a = 0; a < 10; a++) {
      const A = pins[a];
      if (A.state === 'off' || A.state === 'pit') continue;
      for (let b = a + 1; b < 10; b++) {
        const B = pins[b];
        if (B.state === 'off' || B.state === 'pit') continue;
        if (A.state === 'stand' && B.state === 'stand') continue;
        const dx = B.x - A.x, dy = B.y - A.y;
        const rr = radius(A) + radius(B);
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 1e-6;
        const nx = dx / d, ny = dy / d;
        const vrel = (A.vx - B.vx) * nx + (A.vy - B.vy) * ny;
        if (vrel <= 0) {
          // 벌어지는 중이면 겹침만 풂
          const push = (rr - d) / 2;
          if (A.state !== 'stand') { A.x -= nx * push; A.y -= ny * push; }
          if (B.state !== 'stand') { B.x += nx * push; B.y += ny * push; }
          continue;
        }
        const aStand = A.state === 'stand', bStand = B.state === 'stand';
        if (aStand || bStand) {
          const S = aStand ? A : B, M = aStand ? B : A;
          const sgn = aStand ? -1 : 1; // M 에서 S 로 향하는 방향 = (S - M)
          const mx = nx * sgn * -1 * -1; void mx;
          const dirx = (S.x - M.x) / (Math.hypot(S.x - M.x, S.y - M.y) || 1), diry = (S.y - M.y) / (Math.hypot(S.x - M.x, S.y - M.y) || 1);
          const vr = (M.vx) * dirx + (M.vy) * diry;
          if (vr > C.TOPPLE_V) {
            const j = ((1 + C.E_PP) * vr) / 2; // 같은 질량
            M.vx -= j * dirx; M.vy -= j * diry;
            topple(S, j * dirx * C.KICK, j * diry * C.KICK, vr > 3.2);
            ev('pin-pin', vr / 7, S.x, S.y);
          } else {
            // 문턱 미만: 서 있는 핀은 흔들리고 때린 핀이 튕겨 나감
            M.vx -= (1 + 0.5) * vr * dirx; M.vy -= (1 + 0.5) * vr * diry;
            S.wob = Math.max(S.wob, clamp(vr * 0.2, 0.05, 0.3)); S.wobT = 0;
            ev('pin-nudge', vr / 10, S.x, S.y);
          }
          // 겹침 해소: 서 있는 핀은 고정
          const ov = radius(A) + radius(B) - d;
          M.x -= dirx * ov; M.y -= diry * ov;
        } else {
          const j = ((1 + 0.5) * vrel) / 2;
          A.vx -= j * nx; A.vy -= j * ny; B.vx += j * nx; B.vy += j * ny;
          const push = (rr - d) / 2;
          A.x -= nx * push; A.y -= ny * push; B.x += nx * push; B.y += ny * push;
          if (vrel > 0.6) ev('pin-pin', vrel / 8, B.x, B.y);
        }
      }
    }

    t += H;
    if (t >= nextRec) { record(); nextRec += C.REC; }

    // 끝 조건: 공이 멈췄거나 빠졌고 핀이 가만히
    const ballDone = ball.state !== 'roll';
    let moving = false;
    for (const p of pins) if (p.state === 'down' && (Math.hypot(p.vx, p.vy) > 0.03 || p.z > 0 || p.fallT < 0.7)) moving = true;
    if (ballDone && !moving) quietFor += H; else quietFor = 0;
    if (quietFor > 0.5 && rec > 20) break;
  }
  record();
  const n = rec;
  const down = pins.map((p, i) => standing[i] && p.state !== 'stand');
  return {
    down,
    count: down.filter(Boolean).length,
    n, ball: ballRec.subarray(0, n * 5), pins: pinRec.subarray(0, n * 60),
    events,
    duration: n * C.REC,
    guttered: ball.state === 'gutter' || (ball.state !== 'roll' && ball.state !== 'pit' && ball.state !== 'dead' && false),
    ballState: ball.state,
    firstContactT: ballPinFirst ? ballPinFirst.t : null,
    firstContact: ballPinFirst,
    speed0,
    hookDev: maxDev,
    endX: ball.x
  };
}

// 시험·봇이 쓰는 편의 함수: 포켓을 노린 던지기 입력을 만듭니다.
export function pocketShot({ x = 0, speed = 7.4, spin = -0.55, entryX, bumpers = false } = {}) {
  const tx = entryX ?? pocketX(spin);
  return { x, angle: solveAngle(x, speed, spin, tx), speed, spin, bumpers };
}

// 남은 핀이 떨어져 있는지(스플릿): 1번 핀이 쓰러졌고, 남은 핀이 서로 이웃하지 않는 두 덩어리 이상.
export function isSplit(standing) {
  if (standing[0]) return false;
  const idx = standing.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 2) return false;
  const near = (a, b) => Math.hypot(PIN_SPOTS[a].x - PIN_SPOTS[b].x, PIN_SPOTS[a].y - PIN_SPOTS[b].y) < 0.33;
  const seen = new Set([idx[0]]);
  const q = [idx[0]];
  while (q.length) {
    const a = q.pop();
    for (const b of idx) if (!seen.has(b) && near(a, b)) { seen.add(b); q.push(b); }
  }
  return seen.size < idx.length;
}
