// 퍼팅 공 굴리기. 그린 경사(중력), 잔디 저항(스팀프 10), 컵에 들어가기/립 아웃을 한 번에 계산해 둡니다.
// 결과는 1/60초 간격 위치 목록이라 화면은 그대로 재생만 합니다. 봇의 조준 계산도 같은 함수를 씁니다.

export const BALL_R = 0.02135;
export const CUP_R = 0.054; // 지름 108mm
export const CUP_DEPTH = 0.1;
const G = 9.81;
const ROLL = 5 / 7; // 구르는 공은 경사 가속의 5/7 만 받습니다(회전 관성)
// 스팀프미터 10ft: 1.83m/s 로 내보낸 공이 평지에서 3.05m 굴러갑니다 → 감속 0.549m/s²
export const STIMP_FT = 10;
export const DECEL = { green: 0.549, fringe: 1.35, rough: 3.4, bunker: 5.5 };
export const MAX_BALL_SPEED = 4.4;

// 컵 가운데에서 b 만큼 비켜 지나갈 때 빠지는 최고 속도: 컵 위를 지나는 동안 공 반지름만큼 떨어져야 합니다.
export const captureSpeed = (b) => 2 * Math.sqrt(Math.max(0, CUP_R * CUP_R - b * b)) * Math.sqrt(G / (2 * BALL_R));
export const flatDistance = (v) => (v * v) / (2 * DECEL.green);
export const speedForFlat = (d) => Math.sqrt(2 * DECEL.green * Math.max(0, d));

// heading: 라디안, 방향 = (sin, cos). +는 왼쪽(+x).
export function simulate(hole, from, heading, speed, opts = {}) {
  const dt = opts.dt || 1 / 240;
  const probe = Boolean(opts.probe); // 봇 계산용: 위치 목록을 만들지 않고 컵도 무시
  const every = Math.max(1, Math.round(1 / 60 / dt));
  const cup = hole.cup;
  speed = Math.max(0, Math.min(MAX_BALL_SPEED, speed));
  let x = from.x;
  let z = from.z;
  let vx = Math.sin(heading) * speed;
  let vz = Math.cos(heading) * speed;
  const pts = probe ? null : [];
  const lips = [];
  let holed = false;
  let holedFrame = -1;
  let inside = false;
  let dip = 0;
  let closest = { d: Math.hypot(x - cup.x, z - cup.z), x, z, ux: Math.sin(heading), uz: Math.cos(heading), t: 0 };
  let step = 0;
  let t = 0;
  let stopped = 'rest';
  const push = () => {
    if (!probe && step % every === 0) pts.push(x, hole.heightAt(x, z) + BALL_R - dip, z);
  };
  push();
  for (; t < 22; t += dt) {
    step += 1;
    const s = hole.surfAt(x, z);
    const dec = DECEL[s];
    const [gx, gz] = hole.gradAt(x, z);
    const nrm = Math.sqrt(1 + gx * gx + gz * gz);
    const ax = (-ROLL * G * gx) / nrm;
    const az = (-ROLL * G * gz) / nrm;
    const aS = Math.hypot(ax, az);
    const sp = Math.hypot(vx, vz);
    if (sp < 1e-3) {
      // 멈춘 공: 경사가 잔디 저항을 못 이기면 그대로 섭니다.
      if (aS <= dec) {
        vx = 0;
        vz = 0;
        break;
      }
      vx = (ax - (dec * ax) / aS) * dt;
      vz = (az - (dec * az) / aS) * dt;
    } else {
      let nvx = vx + (ax - (dec * vx) / sp) * dt;
      let nvz = vz + (az - (dec * vz) / sp) * dt;
      if (nvx * vx + nvz * vz <= 0) {
        // 이번 걸음에 속도가 0을 지나갔습니다: 멈추거나 경사를 따라 다시 굴러 내려갑니다.
        if (aS <= dec) {
          vx = 0;
          vz = 0;
          break;
        }
        nvx = (ax - (dec * ax) / aS) * dt;
        nvz = (az - (dec * az) / aS) * dt;
      }
      vx = nvx;
      vz = nvz;
    }
    const px = x;
    const pz = z;
    x += vx * dt;
    z += vz * dt;

    // 컵에 가장 가까이 간 순간(선분 위 최근접점)
    {
      const sx = x - px;
      const sz = z - pz;
      const l2 = sx * sx + sz * sz;
      let u = l2 > 0 ? ((cup.x - px) * sx + (cup.z - pz) * sz) / l2 : 0;
      u = Math.max(0, Math.min(1, u));
      const cx = px + sx * u;
      const cz = pz + sz * u;
      const d = Math.hypot(cx - cup.x, cz - cup.z);
      if (d < closest.d) {
        const l = Math.sqrt(l2) || 1;
        closest = { d, x: cx, z: cz, ux: sx / l, uz: sz / l, t };
      }
    }

    if (!probe) {
      const dc = Math.hypot(x - cup.x, z - cup.z);
      if (dc < CUP_R) {
        if (!inside) {
          inside = true;
          const v = Math.hypot(vx, vz);
          const ux = vx / v;
          const uz = vz / v;
          const ox = cup.x - x;
          const oz = cup.z - z;
          const left = uz * ox - ux * oz; // + 면 컵 가운데가 공 진행 방향 왼쪽
          const b = Math.abs(ux * oz - uz * ox);
          const vcap = captureSpeed(b);
          if (v <= vcap) {
            holed = true;
            holedFrame = pts.length / 3;
            dropIn(hole, pts, x, z, v, ux, uz);
            x = cup.x;
            z = cup.z;
            stopped = 'holed';
            break;
          }
          // 너무 빨라 컵 가장자리를 맞고 튕겨 나갑니다. 가운데에서 벗어날수록, 느릴수록 많이 꺾입니다.
          const excess = v / Math.max(0.05, vcap);
          const bn = Math.min(1, b / CUP_R);
          const turn = (Math.min(125, (14 + 108 * bn) / Math.pow(excess, 0.6)) * Math.PI) / 180;
          const ang = -(Math.sign(left) || 1) * turn;
          const keep = Math.max(0.48, Math.min(0.82, 0.48 + 0.2 * (excess - 1)));
          const c = Math.cos(ang);
          const s2 = Math.sin(ang);
          const rvx = (vx * c + vz * s2) * keep;
          const rvz = (vz * c - vx * s2) * keep;
          vx = rvx;
          vz = rvz;
          lips.push({ frame: pts.length / 3, kind: excess > 2.2 && bn < 0.35 ? 'hop' : 'lip', excess });
        }
        // 컵 위를 지나는 동안 살짝 가라앉아 보이게
        dip = 0.011 * (1 - (dc / CUP_R) ** 2);
      } else {
        inside = false;
        dip = 0;
      }
    }

    if (!hole.inField(x, z)) {
      stopped = 'out';
      break;
    }
    push();
  }
  if (!probe && !holed) pts.push(x, hole.heightAt(x, z) + BALL_R, z);
  return {
    pts: pts ? new Float32Array(pts) : null,
    frames: pts ? pts.length / 3 : 0,
    dtOut: dt * every,
    holed,
    holedFrame,
    lips,
    rest: { x, z },
    surface: holed ? 'cup' : hole.surfAt(x, z),
    stopped,
    closest,
    time: t,
    speed,
    heading
  };
}

// 컵에 빠지는 모습: 가운데로 끌려가며 떨어지고, 바닥에서 한 번 통 튑니다.
function dropIn(hole, pts, x, z, v, ux, uz) {
  const cup = hole.cup;
  const top = hole.heightAt(cup.x, cup.z) + BALL_R;
  const bottom = hole.cupY - CUP_DEPTH + BALL_R;
  const N = 14;
  // 컵 반대편 벽에 닿을 때까지 살짝 더 가고(빠를수록), 가운데로 모입니다.
  const farX = cup.x + ux * CUP_R * 0.45 * Math.min(1, v / 1.2);
  const farZ = cup.z + uz * CUP_R * 0.45 * Math.min(1, v / 1.2);
  for (let k = 1; k <= N; k++) {
    const t = k / N;
    const a = Math.min(1, t * 1.8);
    const mx = x + (farX - x) * a;
    const mz = z + (farZ - z) * a;
    const cx = mx + (cup.x - mx) * t * t;
    const cz = mz + (cup.z - mz) * t * t;
    const y = top - (top - bottom) * t * t;
    pts.push(cx, y, cz);
  }
  // 바닥에서 작게 튀기
  const bounce = [0.012, 0.018, 0.012, 0.004, 0, 0.003, 0];
  for (const b of bounce) pts.push(cup.x, bottom + b, cup.z);
}

// 홀을 지나칠 때의 거리와 옆으로 빗나간 정도를 잽니다(봇 조준용).
function probe(hole, from, heading, speed) {
  const r = simulate(hole, from, heading, speed, { probe: true, dt: 1 / 120 });
  const c = hole.cup;
  const cl = r.closest;
  const dx = c.x - from.x;
  const dz = c.z - from.z;
  const d = Math.hypot(dx, dz) || 1;
  // 출발점 → 홀 방향 기준으로 왼쪽(+)/오른쪽(-)으로 비켜 간 거리
  const lateral = ((cl.x - c.x) * dz - (cl.z - c.z) * dx) / d;
  // 멈춘 자리: + 면 홀을 지나서 멈춤
  const over = ((r.rest.x - c.x) * dx + (r.rest.z - c.z) * dz) / d;
  return { lateral, over, closest: cl.d, rest: r.rest };
}

// 홀을 overTarget 만큼 지나 멈추는 세기와, 그 세기로 홀 한가운데를 지나는 방향을 찾습니다.
export function planPutt(hole, from, overTarget = 0.35) {
  const c = hole.cup;
  const base = Math.atan2(c.x - from.x, c.z - from.z);
  const speedFor = (h) => {
    let lo = 0.1;
    let hi = MAX_BALL_SPEED;
    for (let k = 0; k < 15; k++) {
      const m = (lo + hi) / 2;
      if (probe(hole, from, h, m).over < overTarget) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  };
  const lat = (h) => {
    const s = speedFor(h);
    return { s, l: probe(hole, from, h, s).lateral };
  };
  // 왼쪽 끝에서 오른쪽 끝까지 훑어 홀 양옆이 바뀌는 구간을 찾고, 그 안에서 반씩 좁힙니다.
  const SPAN = 0.36;
  const N = 12;
  let lo = null;
  let hi = null;
  let prev = { h: base - SPAN, ...lat(base - SPAN) };
  let best = { h: base, s: speedFor(base), l: 9 };
  for (let k = 1; k <= N; k++) {
    const h = base - SPAN + (2 * SPAN * k) / N;
    const cur = { h, ...lat(h) };
    if (Math.abs(cur.l) < Math.abs(best.l)) best = cur;
    if (prev.l < 0 && cur.l >= 0) {
      lo = prev.h;
      hi = cur.h;
      break;
    }
    prev = cur;
  }
  if (lo == null) return { heading: best.h, speed: best.s };
  for (let k = 0; k < 14; k++) {
    const m = (lo + hi) / 2;
    const r = lat(m);
    best = { h: m, s: r.s };
    if (Math.abs(r.l) < 0.004) break;
    if (r.l < 0) lo = m;
    else hi = m;
  }
  return { heading: best.h, speed: best.s };
}
