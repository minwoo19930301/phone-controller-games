// 배스 낚시: 화면·DOM 과 상관없는 계산만 모았습니다(호수 모양, 입질 시점, 물고기 고르기, 파이팅).
// node 에서도 그대로 불러 시험할 수 있게 다른 모듈을 쓰지 않습니다.

export const SESSION_SEC = 180; // 한 판 3분
export const OVERTIME_SEC = 25; // 시간이 끝났을 때 이미 걸린 물고기는 이만큼 더 싸울 수 있습니다
export const LINE_PER_TURN = 0.8; // 핸들 한 바퀴에 감기는 줄(m)
export const DRAG = 0.85; // 이 장력을 넘으면 드랙이 미끄러지며 줄이 풀립니다
export const HOOK_WINDOW = 0.8; // 찌가 들어간 뒤 챔질할 수 있는 시간(초)
export const LAND_DIST = 2.2; // 이 거리 안으로 끌어오면 뜰채에 담깁니다
export const MAX_LINE = 70; // 스풀에 감긴 줄 길이(m). 다 풀리면 끊어집니다
export const CAST_MIN = 8;
export const CAST_MAX = 38;
export const AIM_MAX = 35; // 좌우 조준 한계(도)

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------- 호수와 지형 ----------
// 선착장은 z = -1.2 ~ 2.0, 사람은 +z(호수 쪽)를 봅니다. 세계 +x 가 화면 왼쪽입니다.
export const LAKE = { cx: 0, cz: 55, ax: 58, az: 72 };
export const SUN_AZ_RAD = 0.28; // 해 방향(정면에서 왼쪽으로)
export const DOCK = { x0: -5.6, x1: 5.6, z0: -1.2, z1: 2.0, y: 0.72, walkW: 2.0, shoreZ: -19 };

// 1 보다 작으면 물, 크면 땅. 가장자리를 조금씩 흔들어 자연스러운 호숫가를 만듭니다.
export function lakeQ(x, z) {
  const dx = (x - LAKE.cx) / LAKE.ax;
  const dz = (z - LAKE.cz) / LAKE.az;
  const a = Math.atan2(dz, dx);
  const wob = 1 + 0.07 * Math.sin(3 * a + 0.6) + 0.045 * Math.sin(5 * a + 2.1) + 0.028 * Math.sin(9 * a + 0.3);
  return Math.hypot(dx, dz) / wob;
}

function hills(x, z) {
  return clamp(0.5 + 0.32 * Math.sin(x * 0.029 + 1.3) * Math.cos(z * 0.024 - 0.4) + 0.2 * Math.sin(x * 0.067 + z * 0.049) +
    0.1 * Math.sin(x * 0.15 - z * 0.12), 0, 1);
}

export function terrainH(x, z) {
  const s = lakeQ(x, z) - 1;
  const ripple = 0.12 * Math.sin(x * 0.7 + Math.sin(z * 0.4)) * Math.cos(z * 0.55);
  if (s < 0) return -3.2 * (1 - Math.exp(s * 10)) + ripple * smooth(-0.06, 0, s);
  // 해 지는 쪽(정면 조금 왼쪽)은 낮은 골짜기로 열어 둡니다.
  const az = Math.atan2(x, Math.max(1, z - LAKE.cz));
  const valley = z > LAKE.cz ? Math.exp(-Math.pow((az - SUN_AZ_RAD) / 0.32, 2)) : 0;
  const h = (s * 7 + hills(x, z) * smooth(0.04, 0.7, s) * 20) * (1 - 0.72 * valley) + ripple;
  // 멀리 갈수록 너무 높아지지 않게(낮게 걸린 해를 가리지 않도록)
  return h < 8 ? h : 8 + 28 * (1 - Math.exp(-(h - 8) / 28));
}

// 연잎 군락(큰 배스가 숨는 곳)
export const LILY = [
  { x: 10.5, z: 17, r: 3.4 },
  { x: -13, z: 27, r: 4.2 },
  { x: 3.5, z: 41, r: 3.8 },
  { x: -4.5, z: 58, r: 4.5 }
];

// 이 자리에 사는 물고기의 질(0~1): 연잎·갈대 근처, 그리고 멀수록 좋습니다.
export function spotQuality(x, z) {
  let cover = 0;
  for (const c of LILY) {
    const d = Math.hypot(x - c.x, z - c.z) - c.r;
    cover = Math.max(cover, 1 - smooth(0, 7, d));
  }
  const q = lakeQ(x, z);
  cover = Math.max(cover, 0.8 * smooth(0.72, 0.9, q) * (z > 6 ? 1 : 0));
  const far = smooth(8, 36, Math.hypot(x, z));
  return clamp(0.15 + 0.55 * cover + 0.3 * far, 0, 1);
}

// 찌가 떨어질 곳. 너무 멀리 던져 물가를 넘어가면 물 안쪽으로 당겨 줍니다.
export function castTarget(tipX, tipZ, power, aimDeg) {
  const p = clamp(power, 0, 1);
  let dist = CAST_MIN + (CAST_MAX - CAST_MIN) * Math.pow(p, 0.85);
  const aim = clamp(aimDeg, -AIM_MAX, AIM_MAX) * Math.PI / 180;
  // + 조준은 오른쪽 = 세계 -x
  const dir = [-Math.sin(aim), Math.cos(aim)];
  for (let i = 0; i < 40; i++) {
    const x = tipX + dir[0] * dist;
    const z = tipZ + dir[1] * dist;
    if (lakeQ(x, z) < 0.93 && terrainH(x, z) < -0.6) return { x, z, dist };
    dist -= 0.8;
    if (dist < 4) break;
  }
  return { x: tipX + dir[0] * 4, z: tipZ + dir[1] * 4, dist: 4 };
}

// ---------- 물고기 ----------
export const SPECIES = {
  lmb: { id: 'lmb', name: '큰입배스', en: 'LARGEMOUTH BASS', min: 0.35, max: 4.8, jump: 0.5, k: (w) => 0.3 + 0.19 * w, len: (w) => 0.22 + 0.165 * Math.cbrt(w) * 1.25 },
  smb: { id: 'smb', name: '작은입배스', en: 'SMALLMOUTH BASS', min: 0.3, max: 2.6, jump: 0.65, k: (w) => 0.34 + 0.27 * w, len: (w) => 0.2 + 0.18 * Math.cbrt(w) * 1.2 },
  blg: { id: 'blg', name: '블루길', en: 'BLUEGILL', min: 0.08, max: 0.6, jump: 0.04, k: (w) => 0.2 + 0.5 * w, len: (w) => 0.1 + 0.2 * Math.cbrt(w) }
};

export function pickFish(quality, rand = Math.random) {
  const q = clamp(quality, 0, 1);
  const r = rand();
  const pL = 0.42 + 0.33 * q;
  const pS = 0.25 - 0.05 * q;
  const sp = r < pL ? SPECIES.lmb : r < pL + pS ? SPECIES.smb : SPECIES.blg;
  // 좋은 자리일수록 큰 놈 쪽으로 기웁니다.
  const u = Math.pow(rand(), 1.9 - 1.1 * q);
  let w = sp.min + (sp.max - sp.min) * Math.pow(u, 1.7);
  w = Math.round(w * 100) / 100;
  return { species: sp.id, name: sp.name, en: sp.en, weight: w, length: Math.round(sp.len(w) * 100) / 100, power: sp.k(w) };
}

// 찌가 떨어진 뒤의 입질 계획: 톡톡 건드리는 예신 몇 번 뒤에 쭉 끌고 들어가는 본신.
export function planBite(quality, rand = Math.random, delay = 0) {
  const q = clamp(quality, 0, 1);
  let t = delay + 1.6 + rand() * (5.5 - 3 * q);
  const nibbles = [];
  const n = rand() < 0.15 ? 0 : 1 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    nibbles.push(t);
    t += 0.55 + rand() * 1.1;
  }
  return { nibbles, bite: t + 0.2 + rand() * 0.6 };
}

// ---------- 파이팅 ----------
// T(장력, 0~1+) = 물고기가 당기는 힘 + 감는 힘. DRAG 를 넘으면 줄이 풀리고, 1 을 넘으면 끊어지기 시작합니다.
// 너무 느슨하면(T 가 아주 낮으면) 바늘이 빠집니다. 물고기가 달릴 때는 감기를 멈추고, 쉴 때 감는 게 요령입니다.
export const K_REEL = 0.2;
const RUN_FORCE = 1.3;

export function newFight(fish, dist, lat, hookQ = 1, rand = Math.random) {
  const f = {
    fish,
    P: fish.power,
    S: 1,
    D: dist,
    lat, // 정면 기준 좌우 각도(rad, + = 오른쪽)
    latVel: 0, // 좌우로 움직이는 속도(m/s, + = 오른쪽)
    mode: 'run',
    modeT: 0.8 + rand() * 1.2,
    T: 0.3,
    Traw: 0.3,
    drag: false,
    breakM: 0,
    slackM: 0,
    warnedSlack: false,
    t: 0,
    hookQ,
    out: null,
    jumps: 0
  };
  f.latVel = (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.8);
  return f;
}

function chooseMode(f, rand, events) {
  const S = f.S;
  const r = rand();
  let next = 'hold';
  if (f.mode === 'run') next = r < 0.22 * S ? 'charge' : 'hold';
  else if (f.mode === 'hold') next = r < 0.18 + 0.42 * S ? 'run' : r < 0.3 + 0.42 * S ? 'charge' : 'hold';
  f.mode = next;
  if (next === 'run') {
    f.modeT = (0.7 + rand() * 1.5) * (0.55 + 0.45 * S);
    f.latVel = (rand() < 0.5 ? -1 : 1) * (0.4 + rand() * 1.2) * (0.5 + 0.5 * S);
    const sp = SPECIES[f.fish.species];
    if (rand() < sp.jump * (0.25 + 0.75 * S) * 0.6 && f.D > 4) {
      f.jumps += 1;
      events.push('jump');
    } else events.push('run');
  } else if (next === 'charge') {
    f.modeT = 0.6 + rand() * 0.8;
    f.latVel *= 0.3;
    events.push('charge');
  } else {
    f.modeT = 0.8 + rand() * 1.8;
    f.latVel *= 0.4;
  }
}

// input: { omega: 감는 속도(바퀴/초), tilt: 낚싯대를 좌우로 눕힌 정도(-1~1, + = 오른쪽) }
// 돌려주는 값: 이번 단계에서 생긴 사건 목록('run' | 'jump' | 'charge' | 'slack' | 'landed' | 'break' | 'unhook')
export function stepFight(f, dt, input, rand = Math.random) {
  const events = [];
  if (f.out) return events;
  f.t += dt;
  f.modeT -= dt;
  if (f.modeT <= 0) chooseMode(f, rand, events);
  const S = f.S;
  const P = f.P;
  const omega = clamp(Number(input.omega) || 0, 0, 5);
  const tilt = clamp(Number(input.tilt) || 0, -1, 1);
  const vReel = omega * LINE_PER_TURN;

  let F;
  let vRun = 0;
  const vigor = 0.35 + 0.65 * S;
  if (f.mode === 'run') {
    F = P * RUN_FORCE * (0.9 + 0.1 * Math.sin(f.t * 9)) * vigor;
    vRun = (0.9 + 1.4 * P) * (0.4 + 0.6 * S);
  } else if (f.mode === 'charge') {
    F = -P * 0.12;
  } else {
    F = P * (0.34 + 0.13 * Math.sin(f.t * 6.3) + 0.08 * Math.sin(f.t * 13.7 + 1)) * vigor;
  }

  // 옆으로 눕히기: 물고기가 가는 반대쪽으로 낚싯대를 눕히면 힘이 덜 들고 물고기가 빨리 지칩니다.
  let opp = 0;
  let same = 0;
  if (Math.abs(f.latVel) > 0.05) {
    const k = tilt * Math.sign(f.latVel);
    opp = clamp(-k / 0.5, 0, 1);
    same = clamp(k / 0.5, 0, 1);
  }
  f.opp = opp;
  const mod = 1 - 0.16 * opp + 0.08 * same;
  const Ff = Math.max(0, F) * mod;
  const R = K_REEL * omega * (0.35 + 0.65 * Math.max(0, F)) * mod;
  let Traw = Ff + R;
  if (f.mode === 'charge') {
    // 다가오는 물고기는 감는 속도가 따라가지 못하면 줄이 느슨해집니다.
    const vCharge = (0.8 + 0.9 * S);
    Traw = Math.max(0, R * clamp((vReel - vCharge * 0.6) / 1.2, 0, 1.2));
  }
  f.Traw = Traw;
  f.drag = Traw > DRAG && F > 0;
  if (f.drag) {
    // 드랙이 미끄러지면 물고기 힘은 거의 흡수됩니다. 그때 감고 있으면 그 몫이 그대로 줄에 걸립니다.
    const ex = Traw - DRAG;
    const reelEx = Math.min(R, ex);
    f.T = DRAG + 0.13 * (1 - Math.exp(-(ex - reelEx) / 0.4)) + reelEx * 0.32;
  } else f.T = Traw;

  // 줄 길이
  if (f.mode === 'charge') {
    f.D -= ((0.8 + 0.9 * S) + vReel) * dt;
  } else if (f.drag) {
    const slip = Math.max(vRun, 0.7) * clamp((Traw - DRAG) / 0.2, 0.35, 1.3);
    f.D += (slip - vReel * 0.1) * dt;
  } else {
    f.D -= vReel * (0.9 + 0.1 * (1 - Math.min(1, Math.max(0, F)))) * dt;
  }
  f.D = Math.max(0, f.D);

  // 좌우 움직임
  f.lat += (f.latVel * dt) / Math.max(4, f.D);
  if (Math.abs(f.lat) > 1.05) {
    f.lat = Math.sign(f.lat) * 1.05;
    f.latVel = -f.latVel * 0.6;
  }

  // 체력
  const drain = (0.016 + 0.05 * f.T + (f.mode === 'run' ? 0.03 : 0)) / (0.55 + 0.45 * P);
  f.S = Math.max(0.05, f.S - drain * (1 + 0.9 * opp) * dt);

  // 끊어짐
  if (f.T > 1) f.breakM += dt * (1.0 + (f.T - 1) * 16);
  else f.breakM = Math.max(0, f.breakM - dt * 1.4);
  if (f.breakM > 1 || f.D > MAX_LINE) {
    f.out = 'break';
    events.push('break');
    return events;
  }
  // 느슨함
  if (f.T < 0.07) f.slackM += dt;
  else f.slackM = Math.max(0, f.slackM - dt * 1.5);
  if (f.slackM > 0.9 && !f.warnedSlack) {
    f.warnedSlack = true;
    events.push('slack');
  }
  if (f.slackM < 0.3) f.warnedSlack = false;
  if (f.slackM > 2.3 + 0.5 * f.hookQ) {
    f.out = 'unhook';
    events.push('unhook');
    return events;
  }
  if (f.D <= LAND_DIST) {
    f.out = 'landed';
    events.push('landed');
  }
  return events;
}

// 점프 중에 줄이 느슨하면 바늘이 털릴 수 있습니다(챔질이 약했으면 더 잘 털립니다).
export function jumpThrow(f, rand = Math.random) {
  if (f.T > 0.22) return false;
  return rand() < (1 - f.hookQ) * 0.5;
}

// 시험용·봇: 장력을 보며 감는 속도를 고릅니다.
export function botReel(f, skill = 1, rand = Math.random) {
  if (!f) return 0;
  const hi = 0.78 + 0.06 * skill;
  if (f.T > hi || f.drag) return 0;
  if (f.mode === 'charge') return 3.2;
  if (f.T < 0.45) return 2.4 + rand() * 0.6;
  return 1.4 + rand() * 0.5;
}
