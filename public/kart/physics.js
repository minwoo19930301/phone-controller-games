// 카트 물리(아케이드): 속도 벡터를 따로 들고 있고, 차체 방향으로 서서히 끌려가게 해서 살짝 미끄러지는 맛을 냅니다.
// 핸들 보조(도로 방향으로 천천히 되돌림), 벽 튕김, 카트끼리 부딪힘, 봇 운전을 모두 여기서 합니다.
import { wrapAngle, HALF_W, OFFROAD_D, LIMIT_D } from './track.js';

export const K = {
  VMAX: 46, // 도로 최고 속도(m/s)
  ACC: 27,
  BRAKE: 40,
  REV: 9, // 후진 최고 속도
  RADIUS: 1.25, // 카트 충돌 반지름
  BOOST_T: 1.6, // 부스트 지속(초)
  BOOST_MUL: 1.28
};
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * 운전 보조(난이도별). 어려움 = 예전 그대로.
 * center: 손을 놓았을 때 도로 방향으로 돌려 주는 힘 배율, lane: 벽 가까이에서 도로 안쪽으로 밀어 주는 힘,
 * wallRest: 벽에서 튕겨 나오는 정도, wallTan: 벽을 따라 미끄러질 때 잃는 속도, wallAlign: 부딪힌 뒤 차체를 진행 방향으로 돌리는 정도,
 * wallRoad: 부딪힌 뒤 차체를 도로 방향으로 돌리는 정도, wallKeep: 정면으로 박아도 남기는 속도 비율, offroad: 모래 위 최고 속도 비율,
 * offDrag: 모래 위 감속 배율
 */
export const ASSIST = {
  hard: { center: 1, lane: 0, wallRest: 0.42, wallTan: 0.07, wallAlign: 0.55, wallRoad: 0, wallKeep: 0, offroad: 0.52, offDrag: 1 },
  normal: { center: 1.45, lane: 0.65, wallRest: 0.22, wallTan: 0.03, wallAlign: 0.7, wallRoad: 0.35, wallKeep: 0.45, offroad: 0.62, offDrag: 0.75 },
  easy: { center: 1.9, lane: 1.1, wallRest: 0.1, wallTan: 0, wallAlign: 0.85, wallRoad: 0.6, wallKeep: 0.7, offroad: 0.74, offDrag: 0.5 }
};

export function newKart(id, x, z, h) {
  return {
    id, x, z, h, vx: 0, vz: 0,
    steer: 0, // 부드럽게 따라가는 실제 핸들 값(-1..1)
    vf: 0, vl: 0, // 차체 기준 앞·옆 속도
    yawRate: 0, idx: null, s: 0, d: 0, th: h, tdiff: 0, dist: 0, prevS: null,
    boostT: 0, boostMul: K.BOOST_MUL, padCool: 0, assistBoost: 0, offroad: false,
    shake: 0, wrongT: 0, stuckT: 0, wheelSpin: 0, camYaw: h, camRoll: 0, bank: 0,
    hitCool: 0, drift: 0, respawnFlash: 0,
    // 추격 보정·아이템 효과
    speedMul: 1, accMul: 1, chase: 0, // chase: 추격 부스트 비율(0~0.3, 화면 표시용)
    starT: 0, spinT: 0, spinDur: 1, spinDir: 1, shrinkT: 0,
    assist: ASSIST.hard, bumpImp: 0, bumpWith: null
  };
}

const LOC = {};

/** 한 걸음. 반환: 일어난 일 { wall: 충격량 } / { boost: true } */
export function stepKart(k, inp, dt, track, ev) {
  const A = k.assist || ASSIST.hard;
  const cosH = Math.cos(k.h);
  const sinH = Math.sin(k.h);
  // 지금 방향 기준으로 속도를 앞·옆으로 나눕니다.
  let vf = k.vx * cosH + k.vz * sinH;
  let vl = -k.vx * sinH + k.vz * cosH;

  // 미끄러져 도는 중(바나나·유도탄·번개)에는 손을 쓸 수 없습니다.
  const spinning = k.spinT > 0;
  if (spinning) k.spinT = Math.max(0, k.spinT - dt);
  const steerIn = spinning ? 0 : clamp(inp.steer || 0, -1, 1);
  k.steer += (steerIn - k.steer) * (1 - Math.exp(-dt / 0.07));
  const gas = inp.gas && !spinning ? 1 : 0;
  const brake = inp.brake && !spinning ? 1 : 0;
  const star = k.starT > 0;
  k.starT = Math.max(0, k.starT - dt);
  k.shrinkT = Math.max(0, k.shrinkT - dt);

  const road = k.offroad && !star ? A.offroad : 1;
  const boost = k.boostT > 0 ? k.boostMul || K.BOOST_MUL : 1;
  const vmax = K.VMAX * road * boost * (k.speedMul || 1) * (star ? 1.2 : 1) * (k.shrinkT > 0 ? 0.62 : 1);
  const acc = K.ACC * (k.accMul || 1) * (star ? 1.5 : 1);
  // 가속 / 브레이크 / 후진 / 자연 감속
  if (spinning) vf *= Math.exp(-2.2 * dt);
  else if (brake && vf > 0.6) vf -= K.BRAKE * dt;
  else if (brake) vf = Math.max(-K.REV, vf - 15 * dt);
  else if (gas) vf += acc * (k.boostT > 0 ? 1.7 : 1) * Math.max(0.04, 1 - Math.max(0, vf) / vmax) * dt;
  else vf *= Math.exp(-0.32 * dt);
  if (!gas && !brake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 1.6 * dt);
  if (k.offroad && !star) vf *= Math.exp(-1.1 * A.offDrag * dt);
  if (vf > vmax) vf -= (vf - vmax) * Math.min(1, 2.6 * dt);

  // 조향: 속도가 빠를수록 도는 각속도를 줄이고, 거의 멈췄을 땐 제자리 회전 못 하게
  const av = Math.abs(vf);
  const yawMax = Math.min(2.5, 36 / Math.max(av, 1));
  let yaw = k.steer * yawMax * clamp(av / 5, 0, 1) * (vf < 0 ? -1 : 1);
  // 핸들 보조: 손을 놓으면(핸들 ~0) 도로 방향으로 천천히 몸을 돌립니다. 많이 꺾었을수록 약해지고, 역주행처럼 크게 어긋나면 끕니다.
  const tdiff = wrapAngle(k.th - k.h);
  k.tdiff = tdiff;
  if (Math.abs(tdiff) < 1.25 && vf > 4 && !spinning) {
    const free = Math.pow(1 - Math.abs(k.steer), 2);
    const gain = (1.15 + k.assistBoost * 3.2) * A.center * clamp(vf / 14, 0, 1);
    yaw += tdiff * gain * (0.25 + 0.75 * free);
    // 차선 보조(쉬움·보통): 벽 가까이 가면 도로 안쪽으로 살짝 틀어 줍니다. 벽 쪽으로 향할수록 세게.
    if (A.lane > 0) {
      const edge = clamp((Math.abs(k.d) - (HALF_W - 2)) / (LIMIT_D - (HALF_W - 2)), 0, 1);
      if (edge > 0) {
        const outward = Math.sign(k.d) * -tdiff > 0 ? 1 : 0.35; // tdiff<0 = 오른쪽을 향함
        yaw += -Math.sign(k.d) * A.lane * 1.4 * edge * outward * clamp(vf / 14, 0, 1);
      }
    }
  }
  k.assistBoost = Math.max(0, k.assistBoost - dt * 2.2);
  k.yawRate = yaw;
  k.h += yaw * dt;

  // 속도 벡터는 그대로 두고 차체만 돌았으니, 새 방향 기준으로 다시 나눠 옆 속도는 서서히 줄입니다(미끄러짐).
  const c2 = Math.cos(k.h);
  const s2 = Math.sin(k.h);
  // 앞서 계산한 vf·vl 은 이전 방향 기준이므로 옛 방향으로 세계 속도를 만든 뒤 새 방향으로 다시 나눕니다.
  let vx = cosH * vf - sinH * vl;
  let vz = sinH * vf + cosH * vl;
  vf = vx * c2 + vz * s2;
  vl = -vx * s2 + vz * c2;
  const slide = Math.min(1, Math.abs(k.steer) * av / 38);
  const grip = 7.5 - 3.2 * slide;
  vl *= Math.exp(-grip * dt);
  k.drift += ((Math.abs(vl) > 3.2 ? 1 : 0) - k.drift) * Math.min(1, dt * 8);
  vx = c2 * vf - s2 * vl;
  vz = s2 * vf + c2 * vl;

  k.x += vx * dt;
  k.z += vz * dt;
  k.vx = vx;
  k.vz = vz;
  k.vf = vf;
  k.vl = vl;

  // 도로 위 위치
  const loc = track.locate(k.x, k.z, k.idx, LOC);
  k.idx = loc.i;
  k.th = loc.th;
  k.d = loc.d;
  k.offroad = Math.abs(loc.d) > OFFROAD_D;
  // 진행 거리(역방향·한 바퀴 넘김을 이어 붙여 누적)
  if (k.prevS == null) k.prevS = loc.s;
  let ds = loc.s - k.prevS;
  const L = track.L;
  if (ds > L / 2) ds -= L;
  else if (ds < -L / 2) ds += L;
  k.dist += ds;
  k.prevS = loc.s;
  k.s = loc.s;

  // 벽: 안쪽 법선으로 튕겨 냅니다(속도 일부를 잃고 방향도 벽을 따라 돌려 줌)
  let wall = 0;
  if (Math.abs(loc.d) > LIMIT_D) {
    const sgn = Math.sign(loc.d);
    const tx = Math.cos(loc.th);
    const tz = Math.sin(loc.th);
    const nx = sgn * tz; // 안쪽 법선 = -sgn * 오른쪽 벡터 = -sgn * (-tz, tx)
    const nz = -sgn * tx;
    const over = Math.abs(loc.d) - LIMIT_D;
    k.x += nx * over;
    k.z += nz * over;
    const vn = k.vx * nx + k.vz * nz;
    if (vn < 0) {
      wall = -vn;
      const before = Math.hypot(k.vx, k.vz);
      k.vx -= (1 + A.wallRest) * vn * nx;
      k.vz -= (1 + A.wallRest) * vn * nz;
      // 벽을 따라 미끄러지는 성분은 살짝 줄입니다
      let vt = k.vx * tx + k.vz * tz;
      k.vx -= tx * vt * A.wallTan;
      k.vz -= tz * vt * A.wallTan;
      // 쉬움·보통: 정면으로 박아도 벽을 따라 앞으로 미끄러지게 속도 일부를 살려 둡니다(벽에 딱 서지 않게).
      if (A.wallKeep > 0 && vf > 2 && Math.abs(wrapAngle(loc.th - k.h)) < 1.6) {
        vt = k.vx * tx + k.vz * tz;
        const want = before * A.wallKeep;
        if (vt < want) {
          k.vx += tx * (want - vt);
          k.vz += tz * (want - vt);
        }
      }
      // 차체를 속도 방향 쪽으로 반쯤 돌려 벽에 계속 박히지 않게
      if (Math.hypot(k.vx, k.vz) > 2) {
        const va = Math.atan2(k.vz, k.vx);
        k.h += wrapAngle(va - k.h) * A.wallAlign;
      }
      if (A.wallRoad > 0) k.h += wrapAngle(loc.th - k.h) * A.wallRoad;
      k.assistBoost = 1;
      k.shake = Math.min(1, k.shake + wall / 22);
      if (wall > 2.5 && k.hitCool <= 0) {
        k.hitCool = 0.35;
        if (ev) ev.wall = Math.max(ev.wall || 0, wall);
      }
    }
  }
  k.hitCool = Math.max(0, k.hitCool - dt);

  // 부스트 패드
  k.boostT = Math.max(0, k.boostT - dt);
  k.padCool = Math.max(0, k.padCool - dt);
  if (k.padCool <= 0) {
    for (const p of track.pads) {
      let dsP = loc.s - p.s;
      if (dsP > L / 2) dsP -= L;
      else if (dsP < -L / 2) dsP += L;
      if (Math.abs(dsP) < p.len / 2 + 1 && Math.abs(loc.d - p.d) < p.w / 2 + 1) {
        k.boostMul = Math.max(k.boostT > 0 ? k.boostMul : 0, K.BOOST_MUL);
        k.boostT = Math.max(k.boostT, K.BOOST_T);
        k.padCool = 1.2;
        if (ev) ev.boost = true;
        break;
      }
    }
  }

  k.shake = Math.max(0, k.shake - dt * 2.6);
  k.wheelSpin += vf * dt / 0.28;
  // 역주행·갇힘 시간
  k.wrongT = Math.abs(wrapAngle(loc.th - k.h)) > 1.9 && Math.abs(vf) > 2 ? k.wrongT + dt : Math.max(0, k.wrongT - dt * 2);
  k.stuckT = Math.abs(vf) < 1.2 ? k.stuckT + dt : 0;
  return ev;
}

/** 길 위 s 지점, 가로 오프셋 d 로 다시 세웁니다(복귀·출발 배치). */
export function placeKart(k, track, s, d, speed = 0) {
  const p = track.at(s);
  const rx = -Math.sin(p.th);
  const rz = Math.cos(p.th);
  k.x = p.x + rx * d;
  k.z = p.z + rz * d;
  k.h = p.th;
  k.vx = Math.cos(p.th) * speed;
  k.vz = Math.sin(p.th) * speed;
  k.vf = speed;
  k.vl = 0;
  k.steer = 0;
  k.camYaw = p.th;
  k.idx = null;
  k.prevS = null;
  const loc = track.locate(k.x, k.z, null, LOC);
  k.idx = loc.i;
  k.s = loc.s;
  k.d = loc.d;
  k.th = loc.th;
  k.prevS = loc.s;
  k.wrongT = 0;
  k.stuckT = 0;
  k.boostT = 0;
  k.spinT = 0;
}

/**
 * 카트끼리 부딪힘: 겹친 만큼 밀어내고 맞은 방향 속도를 주고받습니다.
 * 카트마다 가장 센 충돌을 bumpImp(상대 속도), bumpWith(상대 카트)에 쌓습니다(진동·무적 판정용). 비우는 건 부르는 쪽이 합니다.
 * 무적인 카트는 거의 밀리지 않고 상대를 세게 밀어냅니다.
 */
export function collideKarts(list) {
  let hit = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dd = Math.hypot(dx, dz);
      const R = K.RADIUS * 2;
      if (dd >= R || dd < 1e-4) continue;
      const nx = dx / dd;
      const nz = dz / dd;
      // 무적(별)인 쪽은 밀리지 않습니다.
      const wa = a.starT > 0 && !(b.starT > 0) ? 0.1 : b.starT > 0 && !(a.starT > 0) ? 1.9 : 1;
      const wb = 2 - wa;
      const push = (R - dd) / 2;
      a.x -= nx * push * wa; a.z -= nz * push * wa;
      b.x += nx * push * wb; b.z += nz * push * wb;
      const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (rel < 0) {
        const imp = -rel * 0.55;
        a.vx -= nx * imp * wa; a.vz -= nz * imp * wa;
        b.vx += nx * imp * wb; b.vz += nz * imp * wb;
        hit = Math.max(hit, -rel);
        if (-rel > a.bumpImp) { a.bumpImp = -rel; a.bumpWith = b; }
        if (-rel > b.bumpImp) { b.bumpImp = -rel; b.bumpWith = a; }
        a.shake = Math.min(1, a.shake + -rel / 30);
        b.shake = Math.min(1, b.shake + -rel / 30);
      }
    }
  }
  return hit;
}

const TGT = {};
/**
 * 봇 운전: 앞쪽 중심선 위 점(레인 오프셋 포함)을 보고 핸들을 꺾고, 앞 코너 한계 속도에 맞춰 가속·브레이크.
 * bot = { lane: 가로 오프셋(m), skill: 0.85~1 속도 배율 }
 */
export function botInput(k, track, bot) {
  const speed = Math.max(k.vf, 0);
  const look = clamp(9 + speed * 0.55, 12, 36);
  const p = track.at(k.s + look, TGT);
  const lane = bot.lane;
  const tx = p.x + -Math.sin(p.th) * lane;
  const tz = p.z + Math.cos(p.th) * lane;
  const a = Math.atan2(tz - k.z, tx - k.x);
  const err = wrapAngle(a - k.h);
  const steer = clamp(err * 2.3, -1, 1);
  // 앞 코너 한계 속도: 지금 속도로 멈추는 데 드는 거리만큼 앞까지 가장 낮은 값
  const ahead = 14 + (speed * speed) / (2 * 20);
  let vt = 99;
  for (let m = 0; m <= ahead; m += track.ds) {
    const i = (Math.floor((k.s + m) / track.ds) + track.N) % track.N;
    if (track.vmax[i] < vt) vt = track.vmax[i];
  }
  vt *= bot.skill;
  if (Math.abs(k.d) > HALF_W) vt = Math.min(vt, 22); // 도로 밖이면 천천히 복귀
  const gas = speed < vt ? 1 : 0;
  const brake = speed > vt + 3 ? 1 : 0;
  // 벽 쪽으로 붙어 갇혔을 때 후진
  if (k.stuckT > 1.6) return { steer: -Math.sign(k.d || 1) * 0.6, gas: 0, brake: 1 };
  return { steer, gas: brake ? 0 : gas, brake };
}
