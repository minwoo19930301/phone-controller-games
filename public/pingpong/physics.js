// 탁구 물리: 공 비행(중력·공기 저항·마그누스), 테이블·네트·바닥 충돌, 목표 지점으로 보내는 슈팅법 풀이.
// 좌표는 테이블 하나 기준입니다. 테이블 가운데가 원점, 위 = +y, 0번 자리 = −z 끝, 1번 자리 = +z 끝. 단위 m·s·rad.
// three.js 를 쓰지 않아서 node 에서도 그대로 시험할 수 있습니다.

export const G = 9.81;
export const BALL_R = 0.02;
export const TABLE = { y: 0.76, halfL: 1.37, halfW: 0.7625, netH: 0.1525, netOver: 0.1525, thick: 0.025 };
export const K_DRAG = 0.12; // a = −k|v|v
export const C_MAGNUS = 0.001; // a = c(ω × v). 회전은 실제 탁구처럼 수백 rad/s 입니다.
export const DT = 1 / 240;
export const STRIDE = 9; // 버퍼 한 칸: 위치 3 + 속도 3 + 회전 3

const E_TABLE = 0.88; // 테이블 수직 반발
const MU_TABLE = 0.35; // 테이블 마찰(회전이 속도로 바뀌는 정도의 한계)
const E_FLOOR = 0.62;
const MU_FLOOR = 0.35;
const SPIN_DECAY = 0.22; // 초당 회전 감소 비율
const ROLL = 0.4; // 속이 빈 공이 미끄럼 없이 구르게 되는 접선 속도 변화 비율(2/5)

const NET_TOP = TABLE.y + TABLE.netH;
const NET_HALF_X = TABLE.halfW + TABLE.netOver;
const SURF = TABLE.y + BALL_R; // 공 중심이 테이블에 닿는 높이

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
/** 그 자리 선수가 보는 앞쪽(z 부호) */
export const fwdOf = (side) => (side === 0 ? 1 : -1);
/** 그 자리 선수의 오른쪽(x 부호). r = f × u 라서 0번(앞 +z)은 −x 가 오른쪽입니다. */
export const rightOf = (side) => (side === 0 ? -1 : 1);

// 공 하나의 가속도(중력 + 공기 저항 + 마그누스)를 a 에 씁니다.
function accel(s, a) {
  const vx = s[3], vy = s[4], vz = s[5];
  const wx = s[6], wy = s[7], wz = s[8];
  const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
  a[0] = -K_DRAG * sp * vx + C_MAGNUS * (wy * vz - wz * vy);
  a[1] = -G - K_DRAG * sp * vy + C_MAGNUS * (wz * vx - wx * vz);
  a[2] = -K_DRAG * sp * vz + C_MAGNUS * (wx * vy - wy * vx);
}

// 바닥면(테이블 또는 바닥)에 튈 때: 수직 반발 + 접점 미끄럼에 따른 마찰(회전 ↔ 속도 주고받기).
function bounce(s, e, mu) {
  const vn = Math.abs(s[4]);
  // 접점(공 아래쪽)의 미끄럼 속도 u = v_t + ω × (0, −R, 0)
  const ux = s[3] + s[8] * BALL_R;
  const uz = s[5] - s[6] * BALL_R;
  const us = Math.hypot(ux, uz);
  s[4] = vn * e;
  if (us > 1e-6) {
    const k = Math.min(ROLL, (mu * (1 + e) * vn) / us);
    const dx = -ux * k;
    const dz = -uz * k;
    s[3] += dx;
    s[5] += dz;
    // 속이 빈 공(I = 2/3 mR²): Δω = 3/(2R) · (−Δv_z, 0, Δv_x)
    s[6] += (1.5 / BALL_R) * -dz;
    s[8] += (1.5 / BALL_R) * dx;
  }
}

/**
 * 한 칸(DT) 진행. 충돌이 있으면 { type, side, x, z, f } 를 돌려줍니다(f = 칸 안에서 충돌한 비율).
 * 상태 s = [x, y, z, vx, vy, vz, wx, wy, wz]
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
    // 네트: 공 중심이 z = 0 을 지나는 순간의 높이로 판정합니다.
    if ((pz < 0) !== (nz < 0) && pz !== 0) {
      const f = pz / (pz - nz);
      const xc = px + (nx - px) * f;
      const yc = py + (ny - py) * f;
      const clear = yc - NET_TOP;
      if (Math.abs(xc) <= NET_HALF_X + BALL_R * 0.5 && yc > TABLE.y - BALL_R && clear < BALL_R) {
        if (clear < BALL_R * 0.35) {
          // 네트에 걸림: 친 사람 쪽으로 떨어집니다.
          const back = pz < 0 ? -1 : 1;
          nz = back * (BALL_R + 0.002);
          nx = xc;
          ny = yc;
          s[5] = -s[5] * 0.1;
          s[3] *= 0.35;
          s[4] = Math.min(s[4], 0) * 0.3;
          s[6] *= 0.3;
          s[7] *= 0.3;
          s[8] *= 0.3;
          ev = { type: 'net', side: pz < 0 ? 0 : 1, x: xc, z: 0, f };
        } else {
          // 네트 윗줄을 스치고 넘어감(네트 인): 앞으로 가는 힘이 줄고 살짝 뜹니다.
          s[5] *= 0.6;
          s[3] *= 0.8;
          s[4] = Math.abs(s[4]) * 0.35 + 0.35;
          s[6] *= 0.6;
          s[8] *= 0.6;
          ev = { type: 'netcord', side: pz < 0 ? 0 : 1, x: xc, z: 0, f };
        }
      }
    }
    // 테이블 윗면
    if (!ev && ny < SURF && py >= SURF - 1e-9 && s[4] < 0) {
      const f = (py - SURF) / (py - ny);
      const xc = px + (nx - px) * f;
      const zc = pz + (nz - pz) * f;
      if (Math.abs(xc) <= TABLE.halfW + BALL_R * 0.3 && Math.abs(zc) <= TABLE.halfL + BALL_R * 0.3) {
        const vin = -s[4];
        bounce(s, E_TABLE, MU_TABLE);
        const rest = (1 - f) * dt;
        nx = xc + s[3] * rest;
        nz = zc + s[5] * rest;
        ny = SURF + s[4] * rest;
        if (vin > 0.35) ev = { type: 'table', side: zc < 0 ? 0 : 1, x: xc, z: zc, f };
        else {
          s[4] = 0;
          ny = SURF;
        }
      }
    }
    // 테이블 위에서 구르는 중
    if (!ev && ny < SURF && py >= SURF - 1e-6 && Math.abs(nx) <= TABLE.halfW && Math.abs(nz) <= TABLE.halfL) {
      ny = SURF;
      s[4] = Math.max(0, s[4]);
      s[3] *= 1 - 0.8 * dt;
      s[5] *= 1 - 0.8 * dt;
    }
    // 바닥
    if (!ev && ny < BALL_R && s[4] < 0) {
      const f = py > BALL_R ? (py - BALL_R) / (py - ny) : 1;
      const xc = px + (nx - px) * f;
      const zc = pz + (nz - pz) * f;
      const vin = -s[4];
      bounce(s, E_FLOOR, MU_FLOOR);
      if (vin > 0.35) {
        ev = { type: 'floor', side: zc < 0 ? 0 : 1, x: xc, z: zc, f };
      } else {
        s[4] = 0;
        s[3] *= 1 - 1.5 * dt;
        s[5] *= 1 - 1.5 * dt;
      }
      nx = xc;
      nz = zc;
      ny = BALL_R;
    }
  }
  s[0] = nx;
  s[1] = ny;
  s[2] = nz;
  return ev;
}

/**
 * 공 한 번의 비행을 끝까지 계산해 버퍼에 담습니다. 화면의 공은 이 버퍼를 그대로 읽기 때문에
 * 예측한 타점과 실제 공 위치가 정확히 같습니다.
 * opts: t0(경기 시간 시작), maxT, maxEvents(이 개수만큼 충돌하면 멈춤), collide(false 면 충돌 없음)
 */
export function simulate(p0, v0, w0, opts = {}) {
  const maxT = opts.maxT ?? 3.6;
  const t0 = opts.t0 ?? 0;
  const collide = opts.collide !== false;
  const maxEvents = opts.maxEvents ?? Infinity;
  const nMax = Math.ceil(maxT / DT) + 1;
  const buf = new Float64Array(nMax * STRIDE);
  const s = new Float64Array([p0[0], p0[1], p0[2], v0[0], v0[1], v0[2], w0[0], w0[1], w0[2]]);
  const events = [];
  buf.set(s, 0);
  let n = nMax;
  let floorAt = null;
  for (let i = 1; i < nMax; i++) {
    const ev = step(s, DT, collide);
    buf.set(s, i * STRIDE);
    if (ev) {
      ev.t = t0 + (i - 1 + ev.f) * DT;
      delete ev.f;
      events.push(ev);
      if (ev.type === 'floor' && floorAt == null) floorAt = i * DT;
      if (events.length >= maxEvents) {
        n = i + 1;
        break;
      }
    }
    // 바닥에 떨어진 뒤 조금만 더 보여 주고 끝냅니다.
    if (floorAt != null && i * DT > floorAt + 1.1) {
      n = i + 1;
      break;
    }
  }
  return { t0, n, buf, events };
}

/** 비행 버퍼에서 경기 시간 t 의 상태를 꺼냅니다(선형 보간). out = { p, v, w } */
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
 * 타점(t0)보다 늦게(t1) 휘두른 스윙이 실제로 공을 치는 시각.
 * - t0 뒤 t1 까지 공이 다른 데(두 번째 바운드·바닥·네트)에 먼저 닿았으면 이미 끝난 공이라 null 입니다.
 *   fromEvent 는 아직 규칙 판정을 안 한 첫 사건 번호입니다(그 앞 사건은 이미 처리됨).
 * - 공 중심이 minY 아래로 내려간 뒤라면, 그 높이를 지키던 마지막 시각으로 당깁니다.
 *   너무 낮은 데서 치면 리턴이 테이블 판을 아래에서 뚫고 올라오거나, 서브가 자기 코트에 튈 수 없습니다.
 */
export function lateContactTime(fl, fromEvent, t0, t1, minY) {
  const evs = fl.events;
  for (let k = Math.max(0, fromEvent); k < evs.length && evs[k].t <= t1; k++) {
    if (evs[k].t > t0 && evs[k].type !== 'netcord') return null;
  }
  const st = { p: [0, 0, 0], v: [0, 0, 0], w: [0, 0, 0] };
  for (let t = t1; t > t0; t -= DT) {
    if (sampleFlight(fl, t, st).p[1] >= minY) return t;
  }
  return t0;
}

/**
 * 충돌 없이 날려서 공이 네트를 넘은 뒤 높이 stopY 를 내려오며 지나는 곳을 찾습니다(슈팅법의 한 번 쏘기).
 * 돌려주는 값: { x, z, t, netY(네트 지날 때 높이), apex }
 */
export function freeFlight(p0, v0, w0, stopY, dirZ, maxT = 3) {
  const s = new Float64Array([p0[0], p0[1], p0[2], v0[0], v0[1], v0[2], w0[0], w0[1], w0[2]]);
  let netY = p0[2] * dirZ > 0 ? Infinity : null;
  let apex = p0[1];
  const steps = Math.ceil(maxT / DT);
  for (let i = 1; i <= steps; i++) {
    const px = s[0], py = s[1], pz = s[2];
    step(s, DT, false);
    if (s[1] > apex) apex = s[1];
    if (netY == null && (pz * dirZ <= 0) && s[2] * dirZ > 0) {
      const f = pz / (pz - s[2]);
      netY = py + (s[1] - py) * f;
    }
    if (netY != null && s[1] <= stopY && s[4] < 0 && s[2] * dirZ > 0) {
      const f = py > stopY ? (py - stopY) / (py - s[1]) : 1;
      return { x: px + (s[0] - px) * f, z: pz + (s[2] - pz) * f, t: (i - 1 + f) * DT, netY, apex };
    }
    if (s[1] < -0.5) break;
  }
  return null;
}

/**
 * 슈팅법: 시작점 p0 에서 회전 w 로 쳐서 target=[x,z](상대 코트 위)에 첫 바운드가 떨어지게 하는 초속도를 찾습니다.
 * T0 는 포물선 기준 비행 시간(작을수록 낮고 빠름). 네트 여유가 모자라면 T 를 늘려 다시 풉니다.
 * 돌려주는 값: { v, T, clear(네트 위 여유 m), err(목표 오차 m), land, flightT, iters }
 */
export function solveShot(p0, target, w, T0, opts = {}) {
  const dirZ = Math.sign(target[1]) || 1;
  const minClear = opts.minClear ?? 0.03;
  const maxIter = opts.maxIter ?? 8;
  let T = Math.max(0.12, T0);
  let best = null;
  let iters = 0;
  const rank = (c) => (c.clear < minClear ? 10 + (minClear - c.clear) * 10 : 0) + c.err;
  for (let tries = 0; tries < 10; tries++) {
    let ax = target[0];
    let az = target[1];
    let v = null;
    let res = null;
    for (let it = 0; it < maxIter; it++) {
      iters++;
      const dx = ax - p0[0];
      const dz = az - p0[2];
      const dy = SURF - p0[1];
      v = [dx / T, (dy + 0.5 * G * T * T) / T, dz / T];
      res = freeFlight(p0, v, w, SURF, dirZ);
      if (!res) break;
      const ex = target[0] - res.x;
      const ez = target[1] - res.z;
      if (ex * ex + ez * ez < 9e-6) break;
      // 떨어진 곳과 목표의 차이만큼 겨냥점을 옮깁니다.
      ax += ex;
      az += ez;
    }
    if (res) {
      const cand = {
        v, T, iters,
        clear: res.netY - BALL_R - NET_TOP,
        err: Math.hypot(target[0] - res.x, target[1] - res.z),
        land: [res.x, res.z],
        flightT: res.t
      };
      if (!best || rank(cand) < rank(best)) best = cand;
      if (cand.clear >= minClear && cand.err < 0.02) return cand;
      // 네트 여유가 충분히 넉넉하면 더 높일 필요가 없습니다.
      if (cand.clear >= minClear) T *= 1.05;
      else T *= 1.12 + Math.min(0.5, (minClear - cand.clear) * 4);
    } else {
      T *= 1.14;
    }
  }
  if (best) best.iters = iters;
  return best;
}

/**
 * 서브 풀이: 자기 코트에 한 번, 상대 코트 target 에 한 번 튀게 합니다.
 * 아래로 치는 속도 vy0 후보마다 수평 속도를 이분법으로 찾고(빠를수록 길어짐), 좌우는 겨냥점 보정으로 맞춥니다.
 * 강한 톱스핀은 첫 바운드 뒤 앞으로 튀어 나가서, 속도 하나만 바꾸는 이분법이 겨냥점 보정보다 안정적입니다.
 */
export function solveServe(p0, target, w, side, opts = {}) {
  const recv = 1 - side;
  const sgn = recv === 0 ? -1 : 1; // 받는 쪽 코트의 z 부호
  const depth = target[1] * sgn;
  const cands = opts.vy ?? [-1.7, -2.1, -1.3, -2.6, -3.1, -1.0, -3.7];
  let best = null;
  let sims = 0;
  // 길면 +, 짧으면 − (두 번째 바운드가 받는 쪽 코트면 깊이 오차)
  const signed = (fl) => {
    const [e1, e2] = fl.events;
    if (!e1) return 1;
    if (e1.type !== 'table' || e1.side !== side) return 1;
    if (!e2) return -1;
    if (e2.type === 'net' || e2.type === 'netcord') return -1;
    if (e2.type === 'table' && e2.side === side) return -1;
    if (e2.type !== 'table') return 1;
    return e2.z * sgn - depth;
  };
  for (const vy0 of cands) {
    let ax = target[0];
    for (let lat = 0; lat < 4; lat++) {
      const dx = ax - p0[0];
      const dz = target[1] - p0[2];
      const l = Math.hypot(dx, dz) || 1;
      const ux = dx / l;
      const uz = dz / l;
      const shoot = (vh) => {
        sims++;
        const v = [ux * vh, vy0, uz * vh];
        return { v, fl: simulate(p0, v, w, { maxT: 2.4, maxEvents: 2 }) };
      };
      let lo = 0.6;
      let hi = 14;
      for (let it = 0; it < 15; it++) {
        const mid = (lo + hi) / 2;
        if (signed(shoot(mid).fl) > 0) hi = mid;
        else lo = mid;
      }
      const r = shoot((lo + hi) / 2);
      const [e1, e2] = r.fl.events;
      const ok = e1 && e1.type === 'table' && e1.side === side && e2 && e2.type === 'table' && e2.side === recv;
      if (!ok) {
        // 옆으로 크게 휘어 테이블 밖으로 나갔으면 좌우만 고쳐서 다시 쏩니다.
        const miss = e2 || e1;
        if (miss && Math.abs(miss.x) > TABLE.halfW) {
          ax += (target[0] - miss.x) * 0.9;
          continue;
        }
        break;
      }
      const err = Math.hypot(target[0] - e2.x, target[1] - e2.z);
      const clear = clearanceOf(r.fl);
      if (clear > 0.012 && (!best || err < best.err)) best = { v: r.v, err, clear, e1, e2 };
      if (best && best.err < 0.03) return { ...best, sims };
      ax += target[0] - e2.x;
    }
  }
  return best ? { ...best, sims } : null;
}

// 비행 중 네트를 지날 때 네트 위 여유(m)
function clearanceOf(fl) {
  const B = fl.buf;
  for (let i = 1; i < fl.n; i++) {
    const z0 = B[(i - 1) * STRIDE + 2];
    const z1 = B[i * STRIDE + 2];
    if ((z0 < 0) !== (z1 < 0)) {
      const f = z0 / (z0 - z1);
      const y = B[(i - 1) * STRIDE + 1] + (B[i * STRIDE + 1] - B[(i - 1) * STRIDE + 1]) * f;
      return y - BALL_R - NET_TOP;
    }
  }
  return -1;
}

/**
 * 회전 벡터 만들기. dir = 수평 진행 방향 [dx, dz](단위), lat = 휘어 갈 쪽 x 부호(사이드 스핀)
 * top: 윗부분이 앞으로 도는 회전(ŷ × d), back: 반대, side: 수직축 회전 + 진행축 성분(바운드 때 옆으로 튐)
 */
export function spinVector(kind, amt, dir, lat) {
  const dx = dir[0];
  const dz = dir[1];
  // ŷ × d = (dz, 0, −dx)
  const tx = dz;
  const tz = -dx;
  const a = clamp(amt, 0, 1);
  if (kind === 'top') {
    const m = 260 + 340 * a;
    return [tx * m, 0, tz * m];
  }
  if (kind === 'back') {
    const m = 220 + 290 * a;
    return [-tx * m, 0, -tz * m];
  }
  if (kind === 'side') {
    const m = 260 + 300 * a;
    // 수직축 회전 ω_y 가 (ŷ × d)·L 방향으로 휘게 합니다. 진행축 성분은 바운드 때 같은 쪽으로 튀게 합니다.
    const sgn = Math.sign(tx * lat) || 1;
    return [tx * 70 - dx * m * 0.5 * sgn, m * sgn, tz * 70 - dz * m * 0.5 * sgn];
  }
  if (kind === 'smash') return [tx * 120, 0, tz * 120];
  // 스핀 없이 쳐도 약간의 전진 회전은 생깁니다.
  return [tx * 80, 0, tz * 80];
}

/**
 * 보정된 리턴(또는 서브) 계획. 위치는 기계가 맞추고 선수는 타이밍·세기·스핀만 정합니다.
 * o: { side, p(타점), q(0~1), err(경기 초, −빠름 +늦음), power, aim(도, + 오른쪽), spin, spinAmt, spinSide(±1),
 *      hand, smash, serve, pressure(받기 어려운 공일 때 더하는 실수 확률), fatigue(긴 랠리에서 더하는 실수 확률), rng, assist }
 * assist(쉬움·보통): { nudge(0~1, 조준·타이밍이 떨어지는 곳을 옮기는 비율), risk(실수 확률 배율), pressure(받기 어려운 공 실수 배율),
 *      powerK(세기를 가운데로 모으는 정도, 1 = 그대로), win(판정 창, 타이밍 정규화용) }
 *   없으면(어려움) 예전 그대로: 조준과 타이밍이 좌우를 정하고 세기가 깊이를 정합니다.
 *   있으면 기계가 상대 코트 안쪽 안전한 곳을 고르고, 조준·타이밍은 그 둘레를 살짝(nudge)만 옮깁니다.
 * 돌려주는 값: { v, w, target, outcome('in'|'net'|'long'|'wide'), kind }
 */
export function aimShot(o) {
  const rng = o.rng || Math.random;
  const F = fwdOf(o.side);
  const Rx = rightOf(o.side);
  const p = o.p;
  const A = o.assist || null;
  const kind = o.smash ? 'smash' : o.spin;
  // 보정: 세기를 가운데(0.62)로 모읍니다. 너무 약하면 높이 떠서 스매시를 맞고, 너무 세면 길어집니다.
  const power = A ? clamp(0.62 + (o.power - 0.62) * (A.powerK ?? 1), 0, 1) : o.power;
  // 깊이: 세게 칠수록 깊게(네트에서 m)
  let depth = o.serve ? 0.5 + power * 0.65 : 0.42 + power * 0.8;
  if (kind === 'back') depth -= 0.08;
  if (kind === 'smash') depth = 0.75 + power * 0.4;
  // 보정이 있으면 엔드라인·네트에서 넉넉히 떨어진 곳만 노립니다.
  const dLo = A ? 0.55 : 0.3;
  const dHi = A ? TABLE.halfL - 0.3 : TABLE.halfL - 0.1;
  depth = clamp(depth + (rng() - 0.5) * (A ? 0.05 : 0.08), dLo, dHi);
  // 좌우: 조준(폰 화면 방향) + 타이밍(빠르면 크로스, 늦으면 스트레이트)
  const crossDir = o.hand === 'back' ? 1 : -1;
  const latMax = TABLE.halfW - 0.09;
  let lat;
  if (A) {
    // 기계가 고른 자리(가운데 근처, 조금씩 바뀜) + 선수의 방향이 반폭의 nudge 비율만큼만 옮김.
    // 조준(폰 화면 방향)을 끝까지 돌리면 nudge 만큼(쉬움 ±10%, 보통 ±25%), 타이밍(빠르면 크로스)은 그 안에서 조금 더합니다.
    const tt = clamp((o.err || 0) / Math.max(0.05, A.win || 0.2), -1, 1);
    const want = clamp(clamp((o.aim || 0) / 25, -1, 1) + -tt * crossDir * 0.4, -1, 1);
    lat = (rng() - 0.5) * 0.26 + want * (A.nudge ?? 0.25) * latMax;
    lat = clamp(lat, -latMax * 0.62, latMax * 0.62);
  } else {
    const tt = clamp((o.err || 0) / 0.12, -1, 1);
    lat = clamp((o.aim || 0) / 25, -1, 1) * 0.42 + -tt * crossDir * 0.4 + (rng() - 0.5) * 0.1;
    lat = clamp(lat, -latMax, latMax);
  }
  let tx = Rx * lat;
  let tz = F * depth;
  // 타이밍이 많이 어긋나면(q < 0.25) 네트·아웃 위험이 크고, 그 밖에는 대부분 들어갑니다(조금 어긋날수록 약간의 위험).
  let outcome = 'in';
  const base = o.q < 0.25 ? 0.3 + ((0.25 - o.q) / 0.25) * 0.45 : (1 - o.q) * 0.12;
  const riskP = A
    ? clamp((o.serve ? base * 0.6 : base) * (A.risk ?? 1) + (o.pressure || 0) * (A.pressure ?? 1) + (o.fatigue || 0), 0, 0.9)
    : clamp((o.serve ? base * 0.6 : base) + (o.pressure || 0) + (o.fatigue || 0), 0, 0.9);
  if (rng() < riskP) {
    const r = rng();
    outcome = r < 0.4 ? 'net' : r < 0.8 ? 'long' : 'wide';
  }
  if (outcome === 'long') tz = F * (TABLE.halfL + 0.1 + rng() * 0.3);
  if (outcome === 'wide') tx = (Math.sign(tx) || 1) * (TABLE.halfW + 0.07 + rng() * 0.25);
  const dx = tx - p[0];
  const dz = tz - p[2];
  const dist = Math.hypot(dx, dz) || 1;
  const dir = [dx / dist, dz / dist];
  let w = spinVector(kind, o.spinAmt ?? 0.6, dir, (o.spinSide || 1) * Rx);
  if (o.serve) {
    let sol = solveServe(p, [tx, tz], w, o.side, { speed: 5.6 + power * 2.4 });
    let serveKind = kind;
    // 낮은 타점(늦게 친 서브)에서 옆 회전으로 사이드라인 가까이 노리면 풀이가 없을 때가 있습니다.
    // 들어가야 할 공이면 겨냥점을 가운데로 당겨(그래도 없으면 회전도 빼고) 다시 풉니다.
    for (let k = 0; !sol && outcome === 'in' && k < 2; k++) {
      const tx2 = tx * 0.3;
      const d2 = Math.hypot(tx2 - p[0], tz - p[2]) || 1;
      const dir2 = [(tx2 - p[0]) / d2, (tz - p[2]) / d2];
      const w2 = spinVector(k === 0 ? kind : 'none', o.spinAmt ?? 0.6, dir2, (o.spinSide || 1) * Rx);
      sol = solveServe(p, [tx2, tz], w2, o.side, { speed: 5.6 + power * 2.4 });
      if (sol) {
        tx = tx2;
        w = w2;
        if (k > 0) serveKind = 'none';
      }
    }
    let v = sol ? sol.v : [dir[0] * 6, -2, dir[1] * 6];
    if (outcome === 'net') v = [v[0] * 0.55, v[1], v[2] * 0.55];
    else if (outcome === 'long' || outcome === 'wide') v = [v[0] * 1.3, v[1], v[2] * 1.3];
    return { v, w, target: [tx, tz], outcome, kind: serveKind };
  }
  // 수평 속도: 세기 + 스핀 + 스매시
  let vh = 6.8 + power * 6.2;
  if (kind === 'top') vh += 1.6 * (o.spinAmt ?? 0.6);
  if (kind === 'back') vh -= 1.6 * (o.spinAmt ?? 0.6);
  if (kind === 'smash') vh = 15.5 + 4 * power;
  // 약하게 칠수록 높이 띄워서(밀어 넘기기) 상대에게 스매시 기회가 생깁니다.
  const loft = kind === 'smash' ? 1 : 1 + (1 - power) * 0.45 + (kind === 'back' ? 0.12 : 0);
  const sol = solveShot(p, [tx, tz], w, (dist / vh) * loft, { minClear: kind === 'smash' ? 0.02 : 0.035 });
  let v = sol ? sol.v : [dir[0] * vh, 2.2, dir[1] * vh];
  if (outcome === 'net') {
    // 네트에 걸릴 때까지 낮게 깎습니다.
    for (let k = 0; k < 14; k++) {
      v = [v[0], v[1] - 0.3, v[2]];
      const fl = simulate(p, v, w, { maxEvents: 1, maxT: 1.6 });
      const e = fl.events[0];
      if (e && (e.type === 'net' || (e.type === 'table' && e.side === o.side))) break;
    }
  }
  return { v, w, target: [tx, tz], outcome, kind };
}

/**
 * 받는 사람의 타점 찾기: 받는 쪽 코트에 튄 뒤, 정점 근처나 떨어지는 중에 엔드라인 뒤 0.15~0.4m 쯤.
 * 짧은 공은 테이블 위에서 칩니다. fl 의 첫 테이블 바운드가 recv 쪽일 때만 부르세요.
 * 돌려주는 값: { t(경기 시각), p, v, w, apexH(바운드 뒤 최고 높이, 테이블 위 m), bounceT } 또는 null
 */
export function planContact(fl, recv, fromEvent = 0) {
  const evs = fl.events;
  let bi = -1;
  for (let k = fromEvent; k < evs.length; k++) {
    if (evs[k].type === 'table' && evs[k].side === recv) {
      bi = k;
      break;
    }
    if (evs[k].type !== 'netcord') return null;
  }
  if (bi < 0) return null;
  const tb = evs[bi].t;
  const next = evs[bi + 1];
  const tEnd = Math.min(next ? next.t - 0.02 : Infinity, tb + 1.0, flightEnd(fl) - 0.02);
  const B = fl.buf;
  const back = recv === 0 ? -1 : 1;
  const i0 = Math.ceil((tb - fl.t0) / DT) + 2;
  const i1 = Math.floor((tEnd - fl.t0) / DT);
  let apexT = null;
  for (let i = i0; i <= i1; i++) {
    if (B[i * STRIDE + 4] <= 0) {
      apexT = fl.t0 + i * DT;
      break;
    }
  }
  if (apexT == null) apexT = fl.t0 + i1 * DT;
  const apexH = B[Math.round((apexT - fl.t0) / DT) * STRIDE + 1] - TABLE.y;
  let bestI = -1;
  let bestS = Infinity;
  for (let i = i0; i <= i1; i++) {
    const t = fl.t0 + i * DT;
    const y = B[i * STRIDE + 1];
    const z = B[i * STRIDE + 2];
    const behind = z * back - TABLE.halfL; // 엔드라인 뒤로 얼마나(m)
    let sc = 0;
    if (t < apexT) sc += ((apexT - t) / 0.1) * 0.5;
    if (behind < 0.15) sc += (0.15 - behind) * 2.2;
    else if (behind > 0.38) sc += (behind - 0.38) * 3.5;
    const h = y - TABLE.y;
    if (h < 0.12) sc += (0.12 - h) * 14;
    if (h > 0.6) sc += (h - 0.6) * 2;
    sc += (t - tb) * 0.08;
    if (sc < bestS) {
      bestS = sc;
      bestI = i;
    }
  }
  if (bestI < 0) return null;
  const t = fl.t0 + bestI * DT;
  const st = sampleFlight(fl, t);
  return { t, p: st.p, v: st.v, w: st.w, apexH, bounceT: tb };
}
