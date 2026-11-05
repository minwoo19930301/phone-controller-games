// 에어하키 2D 물리: 원(퍽·말렛)과 벽, 골문 기둥. three.js 없이 돌아가서 node 에서도 시험할 수 있습니다.
// 좌표: x = 화면 왼쪽(−)→오른쪽(+), z = 화면 위(−, 2P 쪽 골)→아래(+, 1P 쪽 골). 단위는 m, 초.
// side: +1 = 아래쪽 팀(1P 쪽, 골문 z = +L/2), −1 = 위쪽 팀(2P 쪽, 골문 z = −L/2).

export const RINK = {
  W: 1.0, // 판 폭
  L: 2.0, // 판 길이
  PR: 0.04, // 퍽 반지름
  MR: 0.056, // 말렛 반지름
  GOAL: 0.34, // 골문 폭
  TOP: 0.78 // 판 높이(3D 에서 씀)
};
export const MAX_PUCK = 6.5; // 퍽 최고 속도(m/s)
export const MAX_MALLET = 9; // 말렛이 따라갈 수 있는 최고 속도(m/s)
const E_WALL = 0.9; // 벽 반발
const E_MALLET = 0.88; // 말렛 반발
const E_POST = 0.8;
const FRICTION = 0.14; // 초당 감속 비율(공기 부상이라 아주 작음)

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// 말렛 중심이 움직일 수 있는 범위. lane: 'full' | 'left' | 'right'(화면 기준)
export function regionOf(side, lane) {
  const { W, L, MR } = RINK;
  const x0 = lane === 'right' ? MR : -W / 2 + MR;
  const x1 = lane === 'left' ? -MR : W / 2 - MR;
  const z0 = side > 0 ? MR : -L / 2 + MR;
  const z1 = side > 0 ? L / 2 - MR : -MR;
  return { x0, x1, z0, z1 };
}
// 폰 패드가 보여 주는 영역(벽·가운데선까지). move 의 x, y(0..1)는 이 영역 안의 위치입니다.
export function padRegionOf(side, lane) {
  const { W, L } = RINK;
  const x0 = lane === 'right' ? 0 : -W / 2;
  const x1 = lane === 'left' ? 0 : W / 2;
  const z0 = side > 0 ? 0 : -L / 2;
  const z1 = side > 0 ? L / 2 : 0;
  return { x0, x1, z0, z1 };
}

export function createSim() {
  return {
    puck: { x: 0, z: 0, vx: 0, vz: 0, spin: 0, angle: 0, live: false },
    mallets: [],
    lastTouch: null, // 마지막으로 친 말렛 id
    lastTouchSpeed: 0
  };
}

export function addMallet(sim, id, side, lane) {
  const r = regionOf(side, lane);
  const home = homeOf(side, lane);
  const m = { id, side, lane, ...r, x: home.x, z: home.z, px: home.x, pz: home.z, vx: 0, vz: 0, tx: home.x, tz: home.z, maxV: MAX_MALLET };
  sim.mallets.push(m);
  return m;
}

export function homeOf(side, lane) {
  const { L, W } = RINK;
  const x = lane === 'left' ? -W * 0.22 : lane === 'right' ? W * 0.22 : 0;
  return { x, z: side * (L / 2 - 0.2) };
}

export function placePuck(sim, x, z) {
  const p = sim.puck;
  p.x = x;
  p.z = z;
  p.vx = 0;
  p.vz = 0;
  p.spin = 0;
  sim.lastTouch = null;
  sim.lastTouchSpeed = 0;
}

function capPuck(p) {
  const s = Math.hypot(p.vx, p.vz);
  if (s > MAX_PUCK) {
    p.vx *= MAX_PUCK / s;
    p.vz *= MAX_PUCK / s;
  }
}

// 기둥(점)과 퍽 충돌
function post(p, px, pz, events) {
  const dx = p.x - px;
  const dz = p.z - pz;
  const d = Math.hypot(dx, dz);
  if (d >= RINK.PR || d < 1e-9) return;
  const nx = dx / d;
  const nz = dz / d;
  p.x = px + nx * RINK.PR;
  p.z = pz + nz * RINK.PR;
  const vn = p.vx * nx + p.vz * nz;
  if (vn < 0) {
    p.vx -= (1 + E_POST) * vn * nx;
    p.vz -= (1 + E_POST) * vn * nz;
    if (-vn > 0.15) events.push({ type: 'post', speed: -vn, x: p.x, z: p.z });
  }
}

// 벽, 골문, 기둥. 골이 들어가면 들어간 쪽(side)을 돌려줍니다.
function walls(p, events) {
  const { W, L, PR, GOAL } = RINK;
  const hw = W / 2;
  const hl = L / 2;
  const gh = GOAL / 2;
  // 옆 벽
  if (p.x < -hw + PR) {
    p.x = -hw + PR;
    if (p.vx < 0) {
      if (-p.vx > 0.12) events.push({ type: 'wall', speed: -p.vx, x: p.x, z: p.z });
      p.vx = -p.vx * E_WALL;
      p.vz *= 0.985;
    }
  } else if (p.x > hw - PR) {
    p.x = hw - PR;
    if (p.vx > 0) {
      if (p.vx > 0.12) events.push({ type: 'wall', speed: p.vx, x: p.x, z: p.z });
      p.vx = -p.vx * E_WALL;
      p.vz *= 0.985;
    }
  }
  const inMouth = Math.abs(p.x) < gh;
  for (const s of [1, -1]) {
    const edge = s * hl;
    if (s * p.z > hl - PR) {
      if (!inMouth) {
        p.z = edge - s * PR;
        if (s * p.vz > 0) {
          if (s * p.vz > 0.12) events.push({ type: 'wall', speed: s * p.vz, x: p.x, z: p.z });
          p.vz = -p.vz * E_WALL;
          p.vx *= 0.985;
        }
      } else {
        // 골문 기둥(양쪽 모서리)
        post(p, -gh, edge, events);
        post(p, gh, edge, events);
        if (s * p.z > hl) {
          // 골문 안쪽 벽(퍽이 미끄러져 들어가는 홈)
          p.x = clamp(p.x, -gh + PR, gh - PR);
          return s;
        }
      }
    }
  }
  return 0;
}

// 말렛을 목표 쪽으로 움직입니다(최고 속도 제한). 실제 위치 변화로 속도를 잽니다.
function moveMallets(sim, dt) {
  for (const m of sim.mallets) {
    m.px = m.x;
    m.pz = m.z;
    const tx = clamp(m.tx, m.x0, m.x1);
    const tz = clamp(m.tz, m.z0, m.z1);
    let dx = tx - m.x;
    let dz = tz - m.z;
    const d = Math.hypot(dx, dz);
    const maxD = m.maxV * dt;
    if (d > maxD) {
      dx *= maxD / d;
      dz *= maxD / d;
    }
    m.x += dx;
    m.z += dz;
    // 속도는 조금 부드럽게(프레임 단위 떨림이 타구에 그대로 실리지 않게)
    const k = clamp(dt / 0.02, 0, 1);
    m.vx += (dx / Math.max(dt, 1e-4) - m.vx) * k;
    m.vz += (dz / Math.max(dt, 1e-4) - m.vz) * k;
  }
}

function malletHit(sim, m, mx, mz, events) {
  const p = sim.puck;
  const R = RINK.PR + RINK.MR;
  const dx = p.x - mx;
  const dz = p.z - mz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= R * R) return;
  const d = Math.sqrt(d2) || 1e-6;
  const nx = d2 > 1e-12 ? dx / d : 0;
  const nz = d2 > 1e-12 ? dz / d : -m.side;
  // 겹친 만큼 퍽을 밀어냅니다(말렛은 움직이지 않는 무거운 물체)
  p.x = mx + nx * R;
  p.z = mz + nz * R;
  const rvx = p.vx - m.vx;
  const rvz = p.vz - m.vz;
  const vn = rvx * nx + rvz * nz;
  if (vn < 0) {
    p.vx -= (1 + E_MALLET) * vn * nx;
    p.vz -= (1 + E_MALLET) * vn * nz;
    // 비껴 맞으면 퍽이 돕니다(그림에만 씀)
    const vt = rvx * -nz + rvz * nx;
    p.spin += clamp(vt * 18, -40, 40);
    const shot = Math.hypot(p.vx, p.vz); // 속도 상한을 걸기 전 타구 속도(기록용)
    capPuck(p);
    const now = Math.hypot(p.vx, p.vz);
    if (-vn > 0.05) {
      events.push({ type: 'hit', id: m.id, rel: -vn, speed: now, shot, x: p.x, z: p.z });
      sim.lastTouch = m.id;
      sim.lastTouchSpeed = now;
    }
  }
}

/**
 * dt 초만큼 진행. events 배열에 hit / wall / post / goal 을 넣습니다.
 * 빠른 말렛이 퍽을 뚫고 지나가지 않게 이동량에 맞춰 잘게 나눠 계산합니다.
 */
export function step(sim, dt, events) {
  const p = sim.puck;
  // 말렛을 먼저 한 번에 옮기고, 작은 단계마다 그 사이를 보간합니다.
  const starts = sim.mallets.map((m) => [m.x, m.z]);
  moveMallets(sim, dt);
  if (!p.live) return 0;
  let maxMove = Math.hypot(p.vx, p.vz) * dt;
  sim.mallets.forEach((m, i) => {
    maxMove = Math.max(maxMove, Math.hypot(m.x - starts[i][0], m.z - starts[i][1]));
  });
  const n = clamp(Math.ceil(maxMove / (RINK.PR * 0.35)), 2, 40);
  const h = dt / n;
  const fr = Math.exp(-FRICTION * h);
  const R = RINK.PR + RINK.MR;
  for (let k = 1; k <= n; k++) {
    const u = k / n;
    p.vx *= fr;
    p.vz *= fr;
    p.x += p.vx * h;
    p.z += p.vz * h;
    p.spin *= Math.exp(-1.2 * h);
    p.angle += p.spin * h;
    sim.mallets.forEach((m, i) => {
      m.cx = starts[i][0] + (m.x - starts[i][0]) * u;
      m.cz = starts[i][1] + (m.z - starts[i][1]) * u;
      malletHit(sim, m, m.cx, m.cz, events);
    });
    const g = walls(p, events);
    if (g) {
      events.push({ type: 'goal', side: g, x: p.x, z: p.z, speed: Math.hypot(p.vx, p.vz) });
      p.live = false;
      return g;
    }
    // 벽에 밀린 뒤에도 말렛과 겹치면 퍽이 벽과 말렛 사이에 낀 것입니다.
    // 퍽은 벽을 뚫을 수 없으니 말렛을 맞닿은 자리에서 멈춥니다(이 프레임 동안).
    sim.mallets.forEach((m, i) => {
      const dx = m.cx - p.x;
      const dz = m.cz - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= R * R * 0.998) return;
      const d = Math.sqrt(d2) || 1e-6;
      const nx = d2 > 1e-12 ? dx / d : 0;
      const nz = d2 > 1e-12 ? dz / d : m.side;
      const bx = clamp(p.x + nx * R, m.x0, m.x1);
      const bz = clamp(p.z + nz * R, m.z0, m.z1);
      m.x = bx;
      m.z = bz;
      starts[i][0] = bx;
      starts[i][1] = bz;
      m.cx = bx;
      m.cz = bz;
      m.vx *= 0.5;
      m.vz *= 0.5;
    });
  }
  return 0;
}

// ---------- 예측(인공지능용): 벽에 튕기는 직선 운동으로 z = zLine 을 지나는 x 와 시간 ----------
export function predictCross(p, zLine, maxT = 2) {
  const { W, PR } = RINK;
  if (Math.abs(p.vz) < 1e-3) return null;
  const t = (zLine - p.z) / p.vz;
  if (t < 0 || t > maxT) return null;
  // 마찰은 짧은 시간이라 무시. 옆 벽 반사는 접어서 계산합니다.
  const span = W - 2 * PR;
  let x = p.x + p.vx * t * 0.97 + span / 2;
  const period = 2 * span;
  x = ((x % period) + period) % period;
  if (x > span) x = period - x;
  return { x: x - span / 2, t };
}

/**
 * CPU·봇이 함께 쓰는 판단: 말렛 m 이 지금 가려는 곳.
 * ai: { maxV, aimErr, defErr, aggro, state, aimX, bank, err } — 판단 사이에 이어지는 기억.
 */
const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 0.577;
export function aiTarget(sim, m, ai) {
  const { L, W, PR, MR } = RINK;
  const p = sim.puck;
  const s = m.side;
  const homeZ = s * (L / 2 - 0.17);
  const lanePad = m.lane === 'full' ? 0 : MR;
  const inLane = p.x >= m.x0 - MR - lanePad && p.x <= m.x1 + MR + lanePad;
  const mine = s * p.z > -PR; // 우리 쪽 반(가운데 줄 위의 퍽은 양쪽 다 노림)
  const toward = s * p.vz; // 우리 골 쪽으로 오는 속도(+)
  const speed = Math.hypot(p.vx, p.vz);
  const cx = (lo, hi, v) => clamp(v, lo, hi);

  if (!p.live) {
    ai.state = 'home';
    const h = homeOf(s, m.lane);
    return { x: h.x, z: h.z };
  }
  // 퍽이 이미 말렛보다 우리 골 쪽(뒤)에 있으면 앞에서 건드리지 않게 옆으로 비켜서서 기다립니다.
  // (앞에서 치면 우리 골문으로 밀어 넣게 됩니다)
  const behindMe = s * (p.z - m.z) > -MR * 0.3;
  const near = Math.abs(p.x - m.x) < PR + MR + 0.05;
  if (behindMe && near && (toward > 0.3 || s * p.z > L / 2 - 0.3)) {
    ai.state = 'dodge';
    let sx = Math.sign(m.x - p.x) || 1;
    if (m.x + sx * 0.12 < m.x0 || m.x + sx * 0.12 > m.x1) sx = -sx;
    return { x: cx(m.x0, m.x1, p.x + sx * (PR + MR + 0.08)), z: clamp(m.z - s * 0.04, m.z0, m.z1) };
  }
  // 1) 빠르게 우리 골 쪽으로 오면 막기: 지나갈 자리를 예측해 미리 갑니다(예측에는 실수가 섞입니다).
  if (toward > 0.9 && (speed > 1.6 || !mine)) {
    if (ai.state !== 'defend') ai.err = gauss() * ai.defErr;
    ai.state = 'defend';
    const cross = predictCross(p, homeZ, 1.6);
    let x = cross ? cross.x : p.x;
    // 골문 쪽으로 조금 당겨 서서 각을 좁힙니다.
    x = x * 0.82 + ai.err * clamp(speed / 3, 0.3, 1.5);
    return { x: cx(m.x0, m.x1, x), z: homeZ };
  }
  // 2) 우리 쪽에 있고 내 레인이면 공격: 퍽이 갈 자리 뒤로 돌아가서 상대 골 쪽으로 밀어 칩니다.
  if (mine && inLane) {
    if (ai.state !== 'attack' && ai.state !== 'strike') {
      ai.state = 'attack';
      // 겨냥: 골문 안 아무 데나, 가끔은 옆 벽을 맞혀 꺾어 넣기
      ai.bank = Math.random() < 0.25 ? (Math.random() < 0.5 ? -1 : 1) : 0;
      ai.aimX = (Math.random() - 0.5) * (RINK.GOAL * 0.75) + gauss() * ai.aimErr;
    }
    // 움직이는 퍽은 말렛이 닿을 즈음의 자리를 노립니다.
    const dist = Math.hypot(m.x - p.x, m.z - p.z);
    const lead = clamp(dist / (ai.maxV * 1.3), 0, 0.3);
    const qx = clamp(p.x + p.vx * lead, -W / 2 + PR, W / 2 - PR);
    const qz = p.z + p.vz * lead;
    const gz = -s * (L / 2);
    const ax = ai.bank ? ai.bank * W - ai.aimX : ai.aimX; // 벽 반사: 거울에 비친 골문을 겨냥
    let dx = ax - qx;
    let dz = gz - qz;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    const behindX = qx - dx * (PR + MR + 0.03);
    const behindZ = qz - dz * (PR + MR + 0.03);
    // 말렛이 퍽 뒤(겨냥선 뒤쪽)에 있는지
    const rx = m.x - qx;
    const rz = m.z - qz;
    const along = rx * dx + rz * dz; // 음수면 뒤
    const off = Math.abs(rx * -dz + rz * dx);
    if (ai.state === 'strike' || (along < -(PR + MR) * 0.6 && off < 0.06)) {
      ai.state = 'strike';
      // 퍽을 지나쳐 밀어 넣습니다. 세게 칠수록 더 멀리 지나쳐 갑니다.
      const reach = 0.12 + 0.2 * ai.aggro;
      if (along > 0.03 || dist > 0.4) ai.state = 'attack';
      return { x: cx(m.x0, m.x1, qx + dx * reach), z: clamp(qz + dz * reach, m.z0, m.z1) };
    }
    // 레인 경계 때문에 퍽 뒤로 갈 수 없으면(퍽이 가운데 줄 위) 지금 자리에서 그대로 밀어 칩니다.
    if (Math.abs(cx(m.x0, m.x1, behindX) - behindX) > 0.015 && dist < 0.5) {
      ai.state = 'attack';
      const ux = (qx - m.x) / (dist || 1);
      const uz = (qz - m.z) / (dist || 1);
      // 우리 골 쪽으로 밀게 되면 밀지 않고 퍽 뒤쪽(우리 골 쪽)으로 먼저 돌아갑니다.
      if (uz * s > -0.15) {
        return { x: cx(m.x0, m.x1, qx + (Math.sign(m.x - qx) || 1) * (PR + MR + 0.05)), z: clamp(qz + s * (PR + MR + 0.06), m.z0, m.z1) };
      }
      return { x: cx(m.x0, m.x1, qx + ux * 0.15), z: clamp(qz + uz * 0.15, m.z0, m.z1) };
    }
    // 퍽과 상대 골 사이에 끼어 있으면 옆으로 돌아 들어갑니다.
    if (along > -0.01) {
      const clearX = PR + MR + 0.07;
      let sideSign = Math.sign(m.x - qx) || (qx > 0 ? -1 : 1);
      // 벽이나 레인 끝이라 그쪽으로 비켜설 수 없으면 반대쪽으로 돕니다.
      if (qx + sideSign * clearX < m.x0 || qx + sideSign * clearX > m.x1) sideSign = -sideSign;
      const sx = cx(m.x0, m.x1, qx + sideSign * clearX);
      // 먼저 지금 깊이에서 옆으로 비켜선 다음(퍽을 우리 골 쪽으로 밀지 않게) 뒤로 내려갑니다.
      if (Math.abs(m.x - qx) < clearX - 0.025) return { x: sx, z: clamp(m.z, m.z0, m.z1) };
      return { x: sx, z: clamp(qz + s * (PR + MR + 0.05), m.z0, m.z1) };
    }
    return { x: cx(m.x0, m.x1, behindX), z: clamp(behindZ, m.z0, m.z1) };
  }
  // 3) 그 밖에는 골문 앞에서 퍽을 따라 좌우로 지킵니다.
  ai.state = 'guard';
  const gx = p.x * (m.lane === 'full' ? 0.55 : 0.8);
  const fwd = mine ? 0.0 : 0.08 * ai.aggro;
  return { x: cx(m.x0, m.x1, gx), z: homeZ - s * fwd };
}
