// 테니스 물리: 공 비행(중력·공기 저항·마그누스), 코트 바운드(마찰·회전), 네트, 뒷벽, 목표 지점으로 보내는 슈팅법.
// 좌표: 코트 가운데 바닥이 원점, 위 = +y, 네트는 z = 0. 0번 끝(near) = +z 쪽(카메라 쪽), 1번 끝(far) = −z 쪽. 단위 m·s·rad.
// three.js 를 쓰지 않아서 node 에서도 그대로 시험할 수 있습니다.

export const G = 9.81;
export const BALL_R = 0.0335;
export const COURT = {
  halfL: 11.885, // 베이스라인까지
  halfWS: 4.115, // 단식 사이드라인
  halfWD: 5.485, // 복식 사이드라인
  svc: 6.4, // 서비스 라인(네트에서)
  netC: 0.914, // 네트 가운데 높이
  netP: 1.07, // 포스트 높이
  postX: 6.4, // 포스트 위치(복식 사이드라인 바깥 0.914m)
  wallZ: 20.4, // 뒷벽
  wallX: 10.2 // 옆벽
};
// 공기 저항 a = −k|v|v. k = ½ρ·Cd·A/m = 0.5·1.2·0.55·0.00353/0.057 ≈ 0.020
export const K_DRAG = 0.0195;
// 마그누스 a = c(ω × v). 회전 수백 rad/s, 속도 20~40m/s 에서 양력 계수 0.15~0.25 에 맞춘 값
export const C_MAGNUS = 0.00062;
export const DT = 1 / 240;
export const STRIDE = 9; // 버퍼 한 칸: 위치 3 + 속도 3 + 회전 3

const MU = 0.6; // 하드 코트 마찰
const INV_ALPHA = 1 / 0.55; // 테니스공 관성(I ≈ 0.55 m R²)
const ROLL = 0.55 / 1.55; // 미끄럼 없이 구르게 되는 접선 속도 변화 한계
const SPIN_DECAY = 0.06; // 초당 회전 감소 비율
const KICK = 0.2; // 탑스핀 바운드가 더 높이 튀는 정도(게임 손맛 보정)
const SKID = 0.3; // 슬라이스 바운드가 낮게 깔리는 정도(게임 손맛 보정)

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
/** 그 끝 선수가 보는 앞쪽(z 부호): near 는 −z, far 는 +z */
export const fwdOf = (end) => (end === 0 ? -1 : 1);
/** 그 끝 선수의 오른쪽(x 부호). r = f × u */
export const rightOf = (end) => (end === 0 ? 1 : -1);
/** 그 위치가 어느 끝 쪽인지 */
export const endOfZ = (z) => (z >= 0 ? 0 : 1);
/** 네트 높이(줄이 늘어져 가운데가 낮습니다) */
export function netH(x) {
  const u = Math.min(1, Math.abs(x) / COURT.postX);
  return COURT.netC + (COURT.netP - COURT.netC) * u * u;
}

// 가속도(중력 + 공기 저항 + 마그누스)
function accel(s, a) {
  const vx = s[3], vy = s[4], vz = s[5];
  const wx = s[6], wy = s[7], wz = s[8];
  const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
  a[0] = -K_DRAG * sp * vx + C_MAGNUS * (wy * vz - wz * vy);
  a[1] = -G - K_DRAG * sp * vy + C_MAGNUS * (wz * vx - wx * vz);
  a[2] = -K_DRAG * sp * vz + C_MAGNUS * (wx * vy - wy * vx);
}

/**
 * 코트 바운드: 수직 반발 + 접점 미끄럼 마찰(회전 ↔ 속도). 탑스핀은 조금 더 높이, 슬라이스는 낮게 미끄러지게 보정합니다.
 */
function bounce(s) {
  const vin = Math.abs(s[4]);
  // 들어오는 방향 기준 탑스핀 양(+탑, −백)
  const h = Math.hypot(s[3], s[5]) || 1;
  const dx = s[3] / h;
  const dz = s[5] / h;
  const top = clamp((s[6] * dz - s[8] * dx) / 320, -1, 1);
  const e = clamp(0.82 - 0.0042 * vin, 0.64, 0.8);
  s[4] = vin * e;
  // 접점(공 아래쪽)의 미끄럼 속도 u = v_t + ω × (0, −R, 0)
  const ux = s[3] + s[8] * BALL_R;
  const uz = s[5] - s[6] * BALL_R;
  const us = Math.hypot(ux, uz);
  const mu = top < 0 ? MU * (1 - 0.45 * -top) : MU;
  if (us > 1e-6) {
    const k = Math.min(ROLL, (mu * (1 + e) * vin) / us);
    const jx = -ux * k;
    const jz = -uz * k;
    s[3] += jx;
    s[5] += jz;
    s[6] += (INV_ALPHA / BALL_R) * -jz;
    s[8] += (INV_ALPHA / BALL_R) * jx;
  }
  if (top > 0) s[4] *= 1 + KICK * top;
  else s[4] *= 1 + SKID * top;
}

/**
 * 한 칸(DT) 진행. 충돌이 있으면 { type, x, y, z, f } 를 돌려줍니다(f = 칸 안에서 충돌한 비율).
 * type: 'bounce'(바닥), 'net'(네트에 걸림), 'netcord'(네트 윗줄 스침), 'wall'
 */
const _a = [0, 0, 0];
function step(s, dt, collide) {
  const px = s[0], py = s[1], pz = s[2];
  accel(s, _a);
  s[3] += _a[0] * dt;
  s[4] += _a[1] * dt;
  s[5] += _a[2] * dt;
  let nx = px + s[3] * dt;
  let ny = py + s[4] * dt;
  let nz = pz + s[5] * dt;
  const decay = 1 - SPIN_DECAY * dt;
  s[6] *= decay;
  s[7] *= decay;
  s[8] *= decay;
  let ev = null;
  if (collide) {
    // 네트: 공 중심이 z = 0 을 지나는 순간 높이로 판정
    if ((pz < 0) !== (nz < 0) && pz !== 0) {
      const f = pz / (pz - nz);
      const xc = px + (nx - px) * f;
      const yc = py + (ny - py) * f;
      const top = netH(xc);
      const clear = yc - top;
      if (Math.abs(xc) <= COURT.postX + BALL_R && yc > -BALL_R && clear < BALL_R) {
        if (clear < BALL_R * 0.3) {
          // 걸림: 친 쪽으로 힘없이 떨어집니다.
          const back = pz < 0 ? -1 : 1;
          nz = back * (BALL_R + 0.004);
          nx = xc;
          ny = Math.min(yc, top);
          s[5] = -s[5] * 0.08;
          s[3] *= 0.3;
          s[4] = Math.min(s[4], 0) * 0.3;
          s[6] *= 0.3;
          s[7] *= 0.3;
          s[8] *= 0.3;
          ev = { type: 'net', x: xc, y: yc, z: 0, f };
        } else {
          // 네트 윗줄을 스치고 넘어감
          s[5] *= 0.55;
          s[3] *= 0.8;
          s[4] = Math.abs(s[4]) * 0.3 + 0.7;
          s[6] *= 0.5;
          s[7] *= 0.5;
          s[8] *= 0.5;
          ev = { type: 'netcord', x: xc, y: yc, z: 0, f };
        }
      }
    }
    // 뒷벽·옆벽: 힘을 잃고 튕겨 나옵니다.
    if (!ev && Math.abs(nz) > COURT.wallZ - BALL_R && Math.abs(pz) <= COURT.wallZ - BALL_R) {
      s[5] = -s[5] * 0.25;
      s[3] *= 0.5;
      nz = Math.sign(nz) * (COURT.wallZ - BALL_R);
      ev = { type: 'wall', x: nx, y: ny, z: nz, f: 1 };
    } else if (!ev && Math.abs(nx) > COURT.wallX - BALL_R && Math.abs(px) <= COURT.wallX - BALL_R) {
      s[3] = -s[3] * 0.25;
      s[5] *= 0.5;
      nx = Math.sign(nx) * (COURT.wallX - BALL_R);
      ev = { type: 'wall', x: nx, y: ny, z: nz, f: 1 };
    }
    // 바닥
    if (!ev && ny < BALL_R && s[4] < 0) {
      const f = py > BALL_R ? (py - BALL_R) / (py - ny) : 1;
      const xc = px + (nx - px) * f;
      const zc = pz + (nz - pz) * f;
      const vin = -s[4];
      if (vin > 0.6) {
        bounce(s);
        const rest = (1 - f) * dt;
        nx = xc + s[3] * rest;
        nz = zc + s[5] * rest;
        ny = BALL_R + s[4] * rest;
        ev = { type: 'bounce', x: xc, y: BALL_R, z: zc, f };
      } else {
        // 구르기
        s[4] = 0;
        s[3] *= 1 - 1.4 * dt;
        s[5] *= 1 - 1.4 * dt;
        ny = BALL_R;
      }
    }
  }
  s[0] = nx;
  s[1] = ny;
  s[2] = nz;
  return ev;
}

/**
 * 한 번의 비행을 끝까지 계산해 버퍼에 담습니다. 화면의 공은 이 버퍼를 그대로 읽으므로
 * 미리 계산한 타점과 실제 공 위치가 정확히 같습니다.
 * opts: t0(경기 시간 시작), maxT, maxEvents, collide
 */
export function simulate(p0, v0, w0, opts = {}) {
  const maxT = opts.maxT ?? 4.2;
  const t0 = opts.t0 ?? 0;
  const collide = opts.collide !== false;
  const maxEvents = opts.maxEvents ?? Infinity;
  const nMax = Math.ceil(maxT / DT) + 1;
  const buf = new Float64Array(nMax * STRIDE);
  const s = new Float64Array([p0[0], p0[1], p0[2], v0[0], v0[1], v0[2], w0[0], w0[1], w0[2]]);
  const events = [];
  buf.set(s, 0);
  let n = nMax;
  let bounces = 0;
  let stopAt = null;
  for (let i = 1; i < nMax; i++) {
    const ev = step(s, DT, collide);
    buf.set(s, i * STRIDE);
    if (ev) {
      ev.t = t0 + (i - 1 + ev.f) * DT;
      delete ev.f;
      events.push(ev);
      if (ev.type === 'bounce') bounces += 1;
      if (events.length >= maxEvents) {
        n = i + 1;
        break;
      }
      // 세 번 튀었거나 벽에 맞았으면 조금만 더 보여 주고 끝냅니다.
      if (stopAt == null && (bounces >= 3 || ev.type === 'wall')) stopAt = i * DT + 0.7;
    }
    if (stopAt != null && i * DT > stopAt) {
      n = i + 1;
      break;
    }
  }
  return { t0, n, buf, events };
}

/** 비행 버퍼에서 경기 시각 t 의 상태(선형 보간). out = { p, v, w } */
export function sampleFlight(fl, t, out) {
  const o = out || { p: [0, 0, 0], v: [0, 0, 0], w: [0, 0, 0] };
  let u = (t - fl.t0) / DT;
  if (u < 0) u = 0;
  if (u > fl.n - 1) u = fl.n - 1;
  const i = Math.min(fl.n - 2, Math.floor(u));
  const f = fl.n < 2 ? 0 : u - i;
  const a = Math.max(0, i) * STRIDE;
  const b = fl.n < 2 ? a : a + STRIDE;
  const B = fl.buf;
  for (let k = 0; k < 3; k++) {
    o.p[k] = B[a + k] + (B[b + k] - B[a + k]) * f;
    o.v[k] = B[a + 3 + k] + (B[b + 3 + k] - B[a + 3 + k]) * f;
    o.w[k] = B[a + 6 + k] + (B[b + 6 + k] - B[a + 6 + k]) * f;
  }
  return o;
}

/** 비행이 끝나는 경기 시각 */
export const flightEnd = (fl) => fl.t0 + (fl.n - 1) * DT;

/**
 * 충돌 없이 날려서 네트를 넘은 뒤 바닥(공 중심 = BALL_R)에 닿는 곳을 찾습니다(슈팅법의 한 번 쏘기).
 * 돌려주는 값: { x, z, t, netY, netX, apex, vLand }
 */
export function freeFlight(p0, v0, w0, dirZ, maxT = 4) {
  const s = new Float64Array([p0[0], p0[1], p0[2], v0[0], v0[1], v0[2], w0[0], w0[1], w0[2]]);
  let netY = p0[2] * dirZ > 0 ? Infinity : null;
  let netX = 0;
  let apex = p0[1];
  const steps = Math.ceil(maxT / DT);
  for (let i = 1; i <= steps; i++) {
    const px = s[0], py = s[1], pz = s[2];
    step(s, DT, false);
    if (s[1] > apex) apex = s[1];
    if (netY == null && pz * dirZ <= 0 && s[2] * dirZ > 0) {
      const f = pz / (pz - s[2]);
      netY = py + (s[1] - py) * f;
      netX = px + (s[0] - px) * f;
    }
    if (s[1] <= BALL_R && s[4] < 0) {
      if (netY == null) return { x: s[0], z: s[2], t: i * DT, netY: -1, netX: 0, apex, short: true };
      const f = py > BALL_R ? (py - BALL_R) / (py - s[1]) : 1;
      return { x: px + (s[0] - px) * f, z: pz + (s[2] - pz) * f, t: (i - 1 + f) * DT, netY, netX, apex, vLand: Math.hypot(s[3], s[4], s[5]) };
    }
  }
  return null;
}

/**
 * 슈팅법: 시작점 p0 에서 회전 w 로 쳐서 target = [x, z] 에 첫 바운드가 떨어지게 하는 초속도를 찾습니다.
 * T0 = 포물선 기준 비행 시간(작을수록 낮고 빠름). 네트 위 여유가 모자라면 T 를 늘려 다시 풉니다.
 * 돌려주는 값: { v, T, clear(네트 위 여유 m), err(목표 오차 m), land, flightT }
 */
export function solveShot(p0, target, w, T0, opts = {}) {
  const dirZ = Math.sign(target[1] - p0[2]) || 1;
  const minClear = opts.minClear ?? 0.25;
  const maxClear = opts.maxClear ?? Infinity;
  const maxIter = opts.maxIter ?? 9;
  let T = Math.max(0.2, T0);
  let best = null;
  const rank = (c) => (c.clear < minClear ? 10 + (minClear - c.clear) * 10 : 0) + c.err;
  for (let tries = 0; tries < 12; tries++) {
    let ax = target[0];
    let az = target[1];
    let v = null;
    let res = null;
    for (let it = 0; it < maxIter; it++) {
      const dx = ax - p0[0];
      const dz = az - p0[2];
      const dy = BALL_R - p0[1];
      v = [dx / T, (dy + 0.5 * G * T * T) / T, dz / T];
      res = freeFlight(p0, v, w, dirZ);
      if (!res || res.short) break;
      const ex = target[0] - res.x;
      const ez = target[1] - res.z;
      if (ex * ex + ez * ez < 4e-4) break;
      ax += ex;
      az += ez;
    }
    if (res && !res.short) {
      const cand = {
        v, T,
        clear: res.netY === Infinity ? 9 : res.netY - BALL_R - netH(res.netX),
        err: Math.hypot(target[0] - res.x, target[1] - res.z),
        land: [res.x, res.z],
        flightT: res.t,
        apex: res.apex
      };
      if (!best || rank(cand) < rank(best)) best = cand;
      if (cand.clear >= minClear && cand.clear <= maxClear && cand.err < 0.05) return cand;
      if (cand.clear > maxClear && cand.clear >= minClear) T *= 0.94;
      else if (cand.clear >= minClear) T *= 1.04;
      else T *= 1.1 + Math.min(0.4, (minClear - cand.clear) * 0.6);
    } else {
      T *= 1.12;
    }
  }
  return best;
}

/**
 * 회전 벡터. dir = 수평 진행 방향 [dx, dz](단위)
 * top: 윗부분이 앞으로 도는 회전(ŷ × d), slice: 반대(백스핀) + 약간의 옆 회전
 * 서브: kick(탑 + 옆), sslice(세로축 옆 회전, 서버 왼쪽으로 휨), flat
 */
export function spinVector(kind, amt, dir) {
  const dx = dir[0];
  const dz = dir[1];
  const tx = dz; // ŷ × d = (dz, 0, −dx)
  const tz = -dx;
  const a = clamp(amt, 0, 1);
  if (kind === 'top') {
    const m = 150 + 210 * a;
    return [tx * m, 0, tz * m];
  }
  if (kind === 'slice') {
    const m = 120 + 170 * a;
    return [-tx * m, 18 * a, -tz * m];
  }
  if (kind === 'kick') {
    const m = 200 + 200 * a;
    return [tx * m, 60 + 70 * a, tz * m];
  }
  if (kind === 'sslice') {
    const m = 180 + 180 * a;
    return [-tx * 40, m, -tz * 40];
  }
  // 플랫도 약간의 전진 회전은 생깁니다.
  return [tx * 45, 0, tz * 45];
}

/** 바운드 위치가 그 끝 코트 안인지(선에 걸쳐도 안) */
export function inCourt(x, z, end, doubles) {
  const hw = doubles ? COURT.halfWD : COURT.halfWS;
  const onSide = end === 0 ? z >= -BALL_R : z <= BALL_R;
  return onSide && Math.abs(x) <= hw + BALL_R && Math.abs(z) <= COURT.halfL + BALL_R;
}
/** 서브가 받는 끝(recv)의 맞는 서비스 박스 안인지. box: 'deuce'(받는 사람 오른쪽) | 'ad' */
export function inBox(x, z, recv, box) {
  const lat = x * rightOf(recv); // 받는 사람 오른쪽 +
  const depth = z * -fwdOf(recv); // 받는 쪽 코트로 들어간 거리(네트에서)
  if (depth < -BALL_R || depth > COURT.svc + BALL_R) return false;
  if (Math.abs(lat) > COURT.halfWS + BALL_R) return false;
  return box === 'deuce' ? lat >= -BALL_R : lat <= BALL_R;
}

/**
 * 난이도별 타구 보정. hard 는 보정 없음(예전 그대로).
 * normal·easy 는 '쳤는지'와 '포핸드/백핸드'라는 굵은 동작을 크게 보고, 세밀한 조준·타이밍·세기는 살짝만 반영해
 * 공을 코트 안 안전한 곳으로 보냅니다. 포핸드는 내 왼쪽 대각선(크로스), 백핸드는 내 오른쪽 대각선으로 갑니다.
 *   aim: 조준이 떨어지는 곳을 옮기는 비율(사이드라인까지 폭의 ±몇 %)  time: 타이밍이 좌우를 옮기는 비율(hard = 1)
 *   hand: 포핸드/백핸드 대각선 기본 거리(m)  margin: 사이드라인 안쪽 여유(m)  depth: [기본, 세기 몫, 흔들림]  deep: [최소, 베이스라인 안쪽 여유]
 *   risk(q): 네트·아웃이 날 확률  clear: 네트 위 여유 더하기(m)  speed: 공 속도 배율
 *   serveAim: 서브 조준 반영 비율  serveRisk(q): 서브 폴트 확률  serveDeep: [최소, 서비스 라인 안쪽 여유]
 */
export const ASSIST = {
  hard: null,
  normal: {
    aim: 0.25, time: 0.3, hand: 1.2, margin: 0.75, depth: [7.7, 2.1, 0.3], deep: [5.6, 0.9],
    risk: (q) => (q < 0.2 ? ((0.2 - q) / 0.2) * 0.14 : 0), clear: 0.08, speed: 0.95,
    serveAim: 0.55, serveRisk: (q) => (q < 0.2 ? ((0.2 - q) / 0.2) * 0.16 : 0), serveDeep: [4.4, 0.45]
  },
  easy: {
    aim: 0.1, time: 0, hand: 1.2, margin: 1.05, depth: [8.1, 1.5, 0.2], deep: [6.2, 1.3],
    risk: () => 0, clear: 0.16, speed: 0.88,
    serveAim: 0.25, serveRisk: () => 0, serveDeep: [4.6, 0.7]
  }
};
export const assistFor = (level) => ASSIST[level] || null;

/**
 * 보정된 타구 계획. 선수 위치는 기계가 맞추고 사람은 타이밍·세기·스핀·조준만 정합니다.
 * o: { end, p(타점), q(0~1), err(경기 초, −빠름 +늦음), window, power, aim(도, + 오른쪽), spin('none'|'top'|'slice'),
 *      spinAmt, hand('fore'|'back'), serve, box, second, doubles, rng, assist('easy'|'normal'|'hard' 또는 ASSIST 값) }
 * 돌려주는 값: { v, w, target, outcome('in'|'net'|'long'|'wide'), kind, speed(m/s) }
 */
export function aimShot(o) {
  const A = typeof o.assist === 'string' ? assistFor(o.assist) : o.assist || null;
  if (A) return assistedShot(o, A);
  const rng = o.rng || Math.random;
  const F = fwdOf(o.end);
  const Rx = rightOf(o.end);
  const p = o.p;
  const spin = o.spin === 'top' || o.spin === 'slice' ? o.spin : 'none';
  const amt = clamp(o.spinAmt ?? 0.6, 0, 1);
  const tt = clamp((o.err || 0) / (o.window || 0.14), -1, 1);
  let outcome = 'in';
  if (o.serve) {
    const recv = 1 - o.end;
    const Rr = rightOf(recv);
    const sideSign = o.box === 'deuce' ? 1 : -1; // 받는 사람 오른쪽(+) 박스
    // 조준: 폰 화면 방향(+ 서버 오른쪽) → 가운데(T) 또는 바깥(와이드)
    const aimLat = clamp((o.aim || 0) / 28, -1, 1) * 1.5 * Rx; // 세계 x 변화
    let lat = sideSign * 2.05 + (aimLat * Rr) + (rng() - 0.5) * 0.5; // 받는 사람 기준 x
    lat = sideSign > 0 ? clamp(lat, 0.35, COURT.halfWS - 0.3) : clamp(lat, -(COURT.halfWS - 0.3), -0.35);
    let depth = clamp(5.0 + (o.power || 0.6) * 0.8 + (rng() - 0.5) * 0.35, 4.2, COURT.svc - 0.25);
    let risk = o.q < 0.4 ? ((0.4 - o.q) / 0.4) * 0.65 : 0;
    if (!o.second && spin === 'none' && o.power > 0.85) risk += 0.12;
    if (o.second) risk *= 0.45;
    if (rng() < risk) {
      const r = rng();
      outcome = r < 0.45 ? 'net' : r < 0.8 ? 'long' : 'wide';
    }
    if (o.over) outcome = 'long';
    if (outcome === 'long') depth = COURT.svc + 0.25 + rng() * 0.9 + (o.over ? 1.5 + o.over * 6 : 0);
    if (outcome === 'wide') lat = sideSign * (COURT.halfWS + 0.2 + rng() * 0.6);
    const tx = lat * Rr;
    const tz = F * depth;
    const dx = tx - p[0];
    const dz = tz - p[2];
    const dist = Math.hypot(dx, dz) || 1;
    const dir = [dx / dist, dz / dist];
    const kind = spin === 'top' || o.second ? 'kick' : spin === 'slice' ? 'sslice' : 'flat';
    let speed = kind === 'flat' ? 34 + 19 * o.power : kind === 'kick' ? 26 + 11 * o.power : 29 + 14 * o.power;
    if (o.second) speed *= 0.86;
    speed *= 0.86 + 0.14 * o.q;
    const w = spinVector(kind, amt, dir);
    const sol = solveShot(p, [tx, tz], w, dist / speed, { minClear: kind === 'kick' ? 0.35 : 0.08, maxClear: kind === 'flat' ? 0.7 : 1.4 });
    let v = sol ? sol.v : [dir[0] * speed, -1, dir[1] * speed];
    if (outcome === 'net') v = sinkToNet(p, v, w, o.end);
    return { v, w, target: [tx, tz], outcome, kind: kind === 'flat' ? 'none' : kind, speed: Math.hypot(v[0], v[1], v[2]) };
  }

  // ----- 스트로크 -----
  const hw = (o.doubles ? COURT.halfWD : COURT.halfWS) - 0.45;
  let depth = 7.3 + (o.power ?? 0.6) * 2.9;
  if (spin === 'top') depth += 0.25;
  if (spin === 'slice') depth -= 0.9;
  depth = clamp(depth + (rng() - 0.5) * 0.7, 4.8, COURT.halfL - 0.35);
  // 좌우: 조준(폰 화면 방향) + 타이밍(포핸드는 빠르면 크로스=왼쪽, 늦으면 역크로스=오른쪽)
  const crossDir = o.hand === 'back' ? 1 : -1;
  let lat = clamp((o.aim || 0) / 25, -1, 1) * 2.2 + -tt * crossDir * 1.7 + (rng() - 0.5) * 0.8;
  // 코트 바깥쪽에서 친 공은 자연스럽게 크로스로 갑니다.
  lat += clamp(-p[0] * Rx * 0.25, -1, 1);
  lat = clamp(lat, -hw, hw);
  let risk = o.q < 0.4 ? ((0.4 - o.q) / 0.4) * 0.75 : 0;
  if (spin === 'none' && o.power > 0.85) risk += 0.07;
  if (rng() < risk) {
    const r = rng();
    outcome = r < 0.4 ? 'net' : r < 0.75 ? 'long' : 'wide';
  }
  // 너무 세게 휘두르면 보정 없이 담장 너머로 날아갑니다(홈런).
  if (o.over) outcome = 'long';
  if (outcome === 'long') depth = COURT.halfL + 0.35 + rng() * 1.6 + (o.over ? 3 + o.over * 16 : 0);
  if (outcome === 'wide') lat = (Math.sign(lat) || 1) * (hw + 0.45 + 0.35 + rng() * 1.2);
  const tx = Rx * lat;
  const tz = F * depth;
  const dx = tx - p[0];
  const dz = tz - p[2];
  const dist = Math.hypot(dx, dz) || 1;
  const dir = [dx / dist, dz / dist];
  const pw = o.power ?? 0.6;
  let speed = spin === 'top' ? 25 + 12 * pw : spin === 'slice' ? 17 + 8 * pw : 25 + 15 * pw;
  speed *= 0.84 + 0.16 * o.q;
  const w = spinVector(spin, amt, dir);
  const minClear = spin === 'top' ? 0.5 + 0.3 * amt : spin === 'slice' ? 0.2 : 0.3;
  const sol = solveShot(p, [tx, tz], w, dist / speed, { minClear, maxClear: o.over ? 6 : spin === 'top' ? 1.6 : 1.1 });
  let v = sol ? sol.v : [dir[0] * speed, 3, dir[1] * speed];
  if (outcome === 'net') v = sinkToNet(p, v, w, o.end);
  return { v, w, target: [tx, tz], outcome, kind: spin, speed: Math.hypot(v[0], v[1], v[2]) };
}

// 보정 타구(쉬움·보통). 너무 세게 휘둘러도 홈런이 나지 않고(o.over 무시), 공은 코트 안 안전한 곳으로 갑니다.
function assistedShot(o, A) {
  const rng = o.rng || Math.random;
  const F = fwdOf(o.end);
  const Rx = rightOf(o.end);
  const p = o.p;
  const spin = o.spin === 'top' || o.spin === 'slice' ? o.spin : 'none';
  const amt = clamp(o.spinAmt ?? 0.6, 0, 1);
  const q = clamp(o.q ?? 0.7, 0, 1);
  const pw = clamp(o.power ?? 0.6, 0, 1);
  const tt = clamp((o.err || 0) / (o.window || 0.14), -1, 1);
  const aimN = clamp((o.aim || 0) / 25, -1, 1);
  let outcome = 'in';
  if (o.serve) {
    const recv = 1 - o.end;
    const Rr = rightOf(recv);
    const sideSign = o.box === 'deuce' ? 1 : -1;
    const aimLat = clamp((o.aim || 0) / 28, -1, 1) * 1.5 * Rx * A.serveAim;
    let lat = sideSign * 2.05 + aimLat * Rr + (rng() - 0.5) * 0.5 * A.serveAim;
    lat = sideSign > 0 ? clamp(lat, 0.7, COURT.halfWS - 0.75) : clamp(lat, -(COURT.halfWS - 0.75), -0.7);
    const depth = clamp(5.0 + pw * 0.7 + (rng() - 0.5) * 0.25, A.serveDeep[0], COURT.svc - A.serveDeep[1]);
    let risk = A.serveRisk(q);
    if (o.second) risk *= 0.45;
    if (rng() < risk) outcome = rng() < 0.55 ? 'net' : 'long';
    const tx = lat * Rr;
    const tz = F * (outcome === 'long' ? COURT.svc + 0.3 + rng() * 0.6 : depth);
    const dx = tx - p[0];
    const dz = tz - p[2];
    const dist = Math.hypot(dx, dz) || 1;
    const dir = [dx / dist, dz / dist];
    const kind = spin === 'top' || o.second ? 'kick' : spin === 'slice' ? 'sslice' : 'flat';
    let speed = kind === 'flat' ? 32 + 15 * pw : kind === 'kick' ? 25 + 9 * pw : 28 + 11 * pw;
    if (o.second) speed *= 0.88;
    speed *= (0.9 + 0.1 * q) * A.speed;
    const w = spinVector(kind, amt, dir);
    const sol = solveShot(p, [tx, tz], w, dist / speed, { minClear: (kind === 'kick' ? 0.35 : 0.12) + A.clear, maxClear: kind === 'flat' ? 0.9 : 1.6 });
    let v = sol ? sol.v : [dir[0] * speed, -1, dir[1] * speed];
    if (outcome === 'net') v = sinkToNet(p, v, w, o.end);
    return { v, w, target: [tx, tz], outcome, kind: kind === 'flat' ? 'none' : kind, speed: Math.hypot(v[0], v[1], v[2]) };
  }
  // 스트로크: 좌우는 손(포핸드 → 내 왼쪽 대각선, 백핸드 → 내 오른쪽 대각선)이 정하고, 조준·타이밍은 살짝만 옮깁니다.
  const hw = (o.doubles ? COURT.halfWD : COURT.halfWS) - A.margin;
  const crossDir = o.hand === 'back' ? 1 : -1;
  let lat = crossDir * A.hand + aimN * A.aim * (hw + A.margin) - tt * crossDir * 1.7 * A.time + (rng() - 0.5) * 0.5;
  lat += clamp(-p[0] * Rx * 0.12, -0.5, 0.5);
  lat = clamp(lat, -hw, hw);
  let depth = A.depth[0] + pw * A.depth[1] + (rng() - 0.5) * 2 * A.depth[2];
  if (spin === 'top') depth += 0.2;
  if (spin === 'slice') depth -= 0.6;
  depth = clamp(depth, A.deep[0], COURT.halfL - A.deep[1]);
  if (rng() < A.risk(q)) {
    outcome = rng() < 0.5 ? 'net' : 'long';
    if (outcome === 'long') depth = COURT.halfL + 0.4 + rng() * 1.2;
  }
  const tx = Rx * lat;
  const tz = F * depth;
  const dx = tx - p[0];
  const dz = tz - p[2];
  const dist = Math.hypot(dx, dz) || 1;
  const dir = [dx / dist, dz / dist];
  let speed = spin === 'top' ? 24 + 10 * pw : spin === 'slice' ? 17 + 7 * pw : 24 + 12 * pw;
  speed *= (0.88 + 0.12 * q) * A.speed;
  const w = spinVector(spin, amt, dir);
  const minClear = (spin === 'top' ? 0.5 + 0.3 * amt : spin === 'slice' ? 0.25 : 0.32) + A.clear;
  const sol = solveShot(p, [tx, tz], w, dist / speed, { minClear, maxClear: spin === 'top' ? 1.8 : 1.3 });
  let v = sol ? sol.v : [dir[0] * speed, 3, dir[1] * speed];
  if (outcome === 'net') v = sinkToNet(p, v, w, o.end);
  return { v, w, target: [tx, tz], outcome, kind: spin, speed: Math.hypot(v[0], v[1], v[2]) };
}

// 네트에 걸릴 때까지 낮게 칩니다.
function sinkToNet(p, v, w, end) {
  let out = v.slice();
  for (let k = 0; k < 18; k++) {
    out = [out[0], out[1] - 0.35, out[2]];
    const fl = simulate(p, out, w, { maxEvents: 1, maxT: 2 });
    const e = fl.events[0];
    if (e && (e.type === 'net' || (e.type === 'bounce' && endOfZ(e.z) === end))) break;
  }
  return out;
}

/**
 * 받는 사람의 타점 찾기: 받는 쪽에 첫 바운드 뒤, 허리 높이(0.7~1.3m)로 내려오는 순간을 고릅니다.
 * fromEvent 부터 찾은 첫 'bounce' 가 기준입니다(그 전에 넷코드만 허용).
 * 돌려주는 값: { t, p, v, w, bounceT, h } 또는 null
 */
export function planContact(fl, recv, fromEvent = 0) {
  const evs = fl.events;
  let bi = -1;
  for (let k = fromEvent; k < evs.length; k++) {
    if (evs[k].type === 'bounce') {
      bi = k;
      break;
    }
    if (evs[k].type !== 'netcord') return null;
  }
  if (bi < 0) return null;
  const tb = evs[bi].t;
  const next = evs[bi + 1];
  const tEnd = Math.min(next ? next.t - 0.03 : Infinity, tb + 1.6, flightEnd(fl) - 0.03);
  const B = fl.buf;
  const back = recv === 0 ? 1 : -1; // 받는 쪽 z 부호
  const i0 = Math.ceil((tb - fl.t0) / DT) + 3;
  const i1 = Math.floor((tEnd - fl.t0) / DT);
  if (i1 <= i0) return null;
  let apexT = null;
  for (let i = i0; i <= i1; i++) {
    if (B[i * STRIDE + 4] <= 0) {
      apexT = fl.t0 + i * DT;
      break;
    }
  }
  if (apexT == null) apexT = fl.t0 + i1 * DT;
  let bestI = -1;
  let bestS = Infinity;
  for (let i = i0; i <= i1; i++) {
    const t = fl.t0 + i * DT;
    const y = B[i * STRIDE + 1];
    const z = B[i * STRIDE + 2];
    const d = z * back; // 네트에서 받는 쪽으로 얼마나
    if (d < 1.2) continue;
    let sc = 0;
    if (y < 0.72) sc += (0.72 - y) * 7;
    if (y > 1.25) sc += (y - 1.25) * 2.4;
    if (t < apexT) sc += (apexT - t) * 0.9;
    const behind = d - COURT.halfL;
    if (behind > 2.2) sc += (behind - 2.2) * 1.6;
    sc += (t - tb) * 0.35;
    if (sc < bestS) {
      bestS = sc;
      bestI = i;
    }
  }
  if (bestI < 0) return null;
  const t = fl.t0 + bestI * DT;
  const st = sampleFlight(fl, t);
  return { t, p: st.p, v: st.v, w: st.w, bounceT: tb, h: st.p[1] };
}
