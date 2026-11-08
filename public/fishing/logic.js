// 배스 낚시: 화면·DOM 과 상관없는 계산만 모았습니다(호수 바닥 모양, 캐스팅 거리, 물고기 크기, 파이팅).
// node 에서도 그대로 불러 시험할 수 있게 다른 모듈을 쓰지 않습니다.
//
// 좌표: 선착장 끝이 z = 0, 사람은 +z(호수 쪽)를 봅니다. 수면은 y = 0 입니다.
// 세계 +x 가 화면 왼쪽입니다(카메라가 +z 를 보고 위가 +y 라서). 조준 각도는 + 가 오른쪽(세계 -x)입니다.

export const LINE_PER_TURN = 0.8; // 핸들 한 바퀴에 감기는 줄(m)
export const DRAG = 0.85; // 이 장력을 넘으면 드랙이 미끄러지며 줄이 풀립니다
export const HOOK_WINDOW = 0.8; // 찌가 들어간 뒤 챔질할 수 있는 시간(초). 어려움 기준(난이도별 값은 ASSIST.hookWin)
export const LAND_DIST = 2.2; // 이 거리 안으로 끌어오면 들어 올립니다(어려움 기준)
export const MAX_LINE = 70; // 스풀에 감긴 줄 길이(m). 다 풀리면 끊어집니다
// 가장 약하게 던졌을 때 초릿대에서 찌까지(m). 선착장 끝 바로 앞(약 3m)에 떨어집니다.
// 예전(4m + 힘의 0.85 제곱)에는 실폰에서 살짝 던져도 15m 넘게 날아가서, 폰이 힘을 부드러운 곡선으로 줄여 보내고 여기서는 그대로(직선) 거리로 바꿉니다.
export const CAST_MIN = 2.6;
export const CAST_MAX = 30; // 가장 세게 던졌을 때
export const NEAR_POWER = 0.03; // 폰의 '살짝 던지기' 버튼(약 3.4m)
export const AIM_MAX = 35; // 좌우 조준 한계(도)
export const RETRIEVE_DONE = 3; // 찌가 초릿대에서 이 거리 안으로 들어오면 줄이 다 감긴 것
export const BAIT_DEPTH = 0.55; // 찌 아래 미끼 깊이(m)

const RD = Math.PI / 180;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------- 장소 ----------
// 선착장 끝(사람이 서는 마루). 판은 x 방향, 다리는 -z 쪽 물가로 이어집니다.
export const DOCK = { x0: -2.3, x1: 2.3, z0: -5.4, z1: 0, y: 0.55, walkW: 1.6, shoreZ: -13 };
// 1인칭 눈: 마루에서 1.7m, 선착장 끝에서 조금 뒤. 아래로 18° 내려다봅니다.
export const EYE = { x: 0, y: DOCK.y + 1.7, z: -1.85, pitch: 18, fov: 55 };
// 낚시하는 물(물고기가 사는 곳)
export const AREA = { x0: -14, x1: 14, z0: 2.2, z1: 32 };
// 호수 물가: 앞쪽은 멀리(z ≈ 62), 좌우는 x ≈ ±22 의 작은 만입니다.
export const LAKE = { cx: 0, cz: 24, ax: 23, az: 38 };
// 해: 왼쪽(세계 +x) 조금 앞, 늦은 아침 높이. 물 위 반짝임이 화면 가운데를 가리지 않습니다.
export const SUN = (() => {
  const el = 40 * RD;
  const az = 72 * RD; // +z 에서 +x 쪽으로
  return { el, az, dir: [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)] };
})();

// 1 보다 작으면 물, 크면 땅. 가장자리를 조금씩 흔들어 자연스러운 물가를 만듭니다.
export function lakeQ(x, z) {
  const dx = (x - LAKE.cx) / LAKE.ax;
  const dz = (z - LAKE.cz) / LAKE.az;
  const a = Math.atan2(dz, dx);
  const wob = 1 + 0.06 * Math.sin(3 * a + 0.6) + 0.04 * Math.sin(5 * a + 2.1) + 0.025 * Math.sin(9 * a + 0.3);
  return Math.hypot(dx, dz) / wob;
}

// 수초가 자라는 얕은 턱, 가라앉은 통나무, 바위(물고기가 숨는 곳). scene 과 물고기 AI 가 같이 씁니다.
export const SHELF = { x: 11, z: 10, rx: 5.5, rz: 6.5 };
export const LOG = { x: -6.5, z: 13.5, len: 5.2, r: 0.2, yaw: 0.55 };
export const ROCKS = [
  { x: 4.2, z: 7.4, r: 0.55 }, { x: -9.6, z: 21.5, r: 0.9 }, { x: 8.4, z: 24.5, r: 0.75 }, { x: -2.6, z: 5.6, r: 0.38 },
  { x: 12.4, z: 17.6, r: 0.6 }
];
export const LILY = [
  { x: 12.8, z: 11.5, r: 2.4 }, { x: -13.2, z: 15.5, r: 2.8 }, { x: 15.5, z: 29, r: 3.4 }, { x: -14, z: 33, r: 3.2 }
];
// 물고기가 즐겨 머무는 곳(큰 놈일수록 이쪽을 좋아합니다)
export const COVER = [
  { x: LOG.x, z: LOG.z, r: 2.4 }, { x: SHELF.x - 1.5, z: SHELF.z, r: 3 }, { x: ROCKS[1].x, z: ROCKS[1].z, r: 2 },
  { x: ROCKS[2].x, z: ROCKS[2].z, r: 2 }, { x: -11, z: 15.5, r: 2.4 }, { x: 11.5, z: 27, r: 2.6 }
];

// 물 깊이(+ = 수면 아래 m). 선착장 앞 1.2m 에서 멀리 갈수록 4m 남짓까지 깊어지고 물가에서 0 이 됩니다.
export function bedDepth(x, z) {
  const q = lakeQ(x, z);
  const edge = smooth(1.0, 0.66, q);
  if (edge <= 0) return 0;
  let d = 1.15 + 3.0 * smooth(-2, 36, z);
  // 수초 턱(왼쪽 앞)은 얕게
  d -= 0.55 * Math.exp(-(((x - SHELF.x) / SHELF.rx) ** 2) - (((z - SHELF.z) / SHELF.rz) ** 2));
  // 오른쪽 가운데의 깊은 웅덩이
  d += 0.5 * Math.exp(-(((x + 7) / 6) ** 2) - (((z - 20) / 7) ** 2));
  // 잔물결 같은 바닥 기복
  d += 0.1 * Math.sin(x * 0.55 + Math.sin(z * 0.3) * 1.4) * Math.cos(z * 0.42 + 0.7) + 0.05 * Math.sin(x * 1.7 + z * 1.3);
  return Math.max(0, d * Math.pow(edge, 0.75));
}

function hills(x, z) {
  return clamp(0.5 + 0.32 * Math.sin(x * 0.029 + 1.3) * Math.cos(z * 0.024 - 0.4) + 0.2 * Math.sin(x * 0.067 + z * 0.049) +
    0.1 * Math.sin(x * 0.15 - z * 0.12), 0, 1);
}

// 지형 높이(물속은 바닥, 물 밖은 둑과 언덕)
export function terrainH(x, z) {
  const q = lakeQ(x, z);
  if (q < 1) return -bedDepth(x, z);
  const s = q - 1;
  const ripple = 0.08 * Math.sin(x * 0.7 + Math.sin(z * 0.4)) * Math.cos(z * 0.55);
  // 둑은 낮게: 먼 물가 너머로 하늘과 먼 산이 보이게 합니다.
  const h = s * 3.6 + hills(x, z) * smooth(0.03, 0.7, s) * 6 + ripple * smooth(0, 0.05, s);
  return h < 6 ? h : 6 + 14 * (1 - Math.exp(-(h - 6) / 14));
}

// 이 자리에서 물고기가 숨기 좋은 정도(0~1)
export function coverAt(x, z) {
  let c = 0;
  for (const p of COVER) c = Math.max(c, 1 - smooth(p.r * 0.4, p.r * 1.6, Math.hypot(x - p.x, z - p.z)));
  return c;
}

// 사람 수에 따른 낚싯대 자리(화면 가로 비율). 혼자면 오른손잡이처럼 가운데 오른쪽.
export function laneFracs(n) {
  if (n <= 1) return [0.62];
  return Array.from({ length: n }, (_, i) => (i + 1) / (n + 1));
}

// 찌가 떨어질 곳. 너무 멀리 던져 물가를 넘어가면 물 안쪽으로 당겨 줍니다.
// power(0~1)는 폰이 이미 '살살 ~ 힘껏' 곡선을 거쳐 보낸 값이라 거리와 정비례합니다.
export function castDist(power) {
  return CAST_MIN + (CAST_MAX - CAST_MIN) * clamp(power, 0, 1);
}
export function castTarget(tipX, tipZ, power, aimDeg) {
  let dist = castDist(power);
  const aim = clamp(aimDeg, -AIM_MAX, AIM_MAX) * RD;
  // + 조준은 오른쪽 = 세계 -x
  const dir = [-Math.sin(aim), Math.cos(aim)];
  for (let i = 0; i < 60; i++) {
    const x = tipX + dir[0] * dist;
    const z = tipZ + dir[1] * dist;
    if (lakeQ(x, z) < 0.86 && bedDepth(x, z) > 0.8) return { x, z, dist };
    dist -= 0.6;
    if (dist < CAST_MIN) break;
  }
  dist = CAST_MIN;
  return { x: tipX + dir[0] * dist, z: tipZ + dir[1] * dist, dist };
}
// 거꾸로: 이 점에 떨어뜨리려면 몇 도로, 얼마나 세게
export function aimFor(tipX, tipZ, x, z) {
  const dx = x - tipX;
  const dz = Math.max(0.5, z - tipZ);
  const aim = clamp(Math.atan2(-dx, dz) / RD, -AIM_MAX, AIM_MAX);
  const dist = clamp(Math.hypot(dx, dz), CAST_MIN, CAST_MAX);
  const power = (dist - CAST_MIN) / (CAST_MAX - CAST_MIN);
  return { aim, power: clamp(power, 0, 1), dist };
}

// ---------- 물고기 ----------
export const SPECIES = {
  lmb: { id: 'lmb', name: '큰입배스', en: 'LARGEMOUTH BASS', min: 0.35, max: 4.8, jump: 0.5, k: (w) => 0.3 + 0.19 * w, len: (w) => 0.22 + 0.165 * Math.cbrt(w) * 1.25 },
  smb: { id: 'smb', name: '작은입배스', en: 'SMALLMOUTH BASS', min: 0.3, max: 2.6, jump: 0.65, k: (w) => 0.34 + 0.27 * w, len: (w) => 0.2 + 0.18 * Math.cbrt(w) * 1.2 },
  blg: { id: 'blg', name: '블루길', en: 'BLUEGILL', min: 0.08, max: 0.6, jump: 0.04, k: (w) => 0.2 + 0.5 * w, len: (w) => 0.1 + 0.2 * Math.cbrt(w) }
};
export const BIG_KG = 3; // 이보다 무거우면 '큰 놈'(동시에 두 마리까지)
export const MIX = { lmb: 0.45, smb: 0.2, blg: 0.35 };

// 무게 뽑기. 큰입배스의 3kg 이상은 드뭅니다(약 15%).
export function rollWeight(species, rand = Math.random, allowBig = true) {
  const sp = SPECIES[species] || SPECIES.lmb;
  const ex = species === 'lmb' ? 2.8 : species === 'smb' ? 2.0 : 1.4;
  for (let i = 0; i < 8; i++) {
    const w = Math.round((sp.min + (sp.max - sp.min) * Math.pow(rand(), ex)) * 100) / 100;
    if (allowBig || w < BIG_KG) return w;
  }
  return Math.round(Math.min(sp.max, BIG_KG - 0.2 - rand() * 1.2) * 100) / 100;
}
export function fishInfo(species, weight) {
  const sp = SPECIES[species] || SPECIES.lmb;
  return { species: sp.id, name: sp.name, en: sp.en, weight, length: Math.round(sp.len(weight) * 100) / 100, power: sp.k(weight) };
}
// 큰 정도(0~1): 경계심, 깊이, 미끼를 무는 망설임에 씁니다.
export function bigness(species, weight) {
  if (species === 'blg') return 0;
  return clamp((weight - 1.2) / 3, 0, 1);
}

// ---------- 난이도별 도움 ----------
// 어려움 = 예전 그대로(사용자가 "생각보다 어렵다"고 한 값). 보통은 눈에 띄게 너그럽고, 쉬움은 아주 너그럽습니다.
//  hookWin   찌가 들어간 뒤 챔질할 수 있는 시간(초)
//  early     톡톡(예신)에 일찍 챘을 때 물고기가 놀라 도망갈 확률(나머지는 "아직이에요"만 알려 주고 그대로 둠)
//  notice    찌를 알아채는 거리 배율 / curious 다가올 확률 더하기 / commit 살피는·망설이는 시간 배율(작을수록 빨리 묾)
//  nibMin    물기 전에 꼭 하는 톡톡 횟수(물기 직전을 미리 알 수 있게) / biteP 살핀 뒤 물 확률 더하기
//  ignore    놓친 뒤 같은 찌를 외면하는 시간 배율 / approach 다가오다 포기하기까지(초)
//  pull      파이팅 중 물고기 힘 배율 / breakT 줄이 끊어지기 시작하는 장력 / breakRate 끊어지는 속도 배율
//  reelEx    드랙이 풀리는데 계속 감을 때 장력에 더해지는 몫 배율 / slack 느슨해도 바늘이 버티는 시간 배율
//  jump      점프 때 바늘이 털릴 확률 배율 / drain 물고기가 지치는 속도 배율 / run 달리기를 고를 확률 배율
//  hookQ     챔질이 약해도 보장하는 바늘 걸림 / land 이 거리 안으로 오면 들어 올림(m)
export const ASSIST = {
  easy: {
    hookWin: 1.7, early: 0.12, notice: 1.6, curious: 0.32, commit: 0.45, nibMin: 2, biteP: 0.3, ignore: 0.25, approach: 24,
    pull: 0.62, breakT: 1.08, breakRate: 0.3, reelEx: 0.4, slack: 2.2, jump: 0.15, drain: 1.8, run: 0.6, hookQ: 0.8, land: 3.2
  },
  normal: {
    hookWin: 1.25, early: 0.45, notice: 1.3, curious: 0.16, commit: 0.7, nibMin: 1, biteP: 0.14, ignore: 0.55, approach: 18,
    pull: 0.85, breakT: 1, breakRate: 0.55, reelEx: 0.85, slack: 1.5, jump: 0.5, drain: 1.35, run: 0.82, hookQ: 0.55, land: 2.7
  },
  hard: {
    hookWin: HOOK_WINDOW, early: 1, notice: 1, curious: 0, commit: 1, nibMin: 0, biteP: 0, ignore: 1, approach: 14,
    pull: 1, breakT: 1, breakRate: 1, reelEx: 1, slack: 1, jump: 1, drain: 1, run: 1, hookQ: 0.3, land: LAND_DIST
  }
};
// 처음 해 보는 사람(튜토리얼) 파이팅: 쉬움보다 조금 더 순하게 해서 첫 물고기는 거의 꼭 잡게 합니다.
export const TUTORIAL_ASSIST = { ...ASSIST.easy, pull: 0.5, breakRate: 0.15, reelEx: 0.3, slack: 3, jump: 0, drain: 2.4, run: 0.4, hookQ: 1 };
export function assistFor(level) {
  return ASSIST[level] || ASSIST.normal;
}

// ---------- 파이팅 ----------
// T(장력, 0~1+) = 물고기가 당기는 힘 + 감는 힘. DRAG 를 넘으면 줄이 풀리고, 1 을 넘으면 끊어지기 시작합니다.
// 너무 느슨하면(T 가 아주 낮으면) 바늘이 빠집니다. 물고기가 달릴 때는 감기를 멈추고, 쉴 때 감는 게 요령입니다.
export const K_REEL = 0.2;
const RUN_FORCE = 1.3;

export function newFight(fish, dist, lat, hookQ = 1, rand = Math.random, assist = ASSIST.hard) {
  const A = assist || ASSIST.hard;
  const f = {
    fish,
    A,
    P: fish.power * A.pull,
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
    hookQ: Math.max(hookQ, A.hookQ),
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
  const runK = f.A ? f.A.run : 1;
  if (f.mode === 'run') next = r < 0.22 * S ? 'charge' : 'hold';
  else if (f.mode === 'hold') next = r < (0.18 + 0.42 * S) * runK ? 'run' : r < 0.3 + 0.42 * S ? 'charge' : 'hold';
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
  const A = f.A || ASSIST.hard;
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
    f.T = DRAG + 0.13 * (1 - Math.exp(-(ex - reelEx) / 0.4)) + reelEx * 0.32 * A.reelEx;
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
  f.S = Math.max(0.05, f.S - drain * A.drain * (1 + 0.9 * opp) * dt);

  // 끊어짐(쉬울수록 더 높은 장력부터, 더 천천히)
  if (f.T > A.breakT) f.breakM += dt * (1.0 + (f.T - A.breakT) * 16) * A.breakRate;
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
  if (f.slackM > (2.3 + 0.5 * f.hookQ) * A.slack) {
    f.out = 'unhook';
    events.push('unhook');
    return events;
  }
  if (f.D <= A.land) {
    f.out = 'landed';
    events.push('landed');
  }
  return events;
}

// 점프 중에 줄이 느슨하면 바늘이 털릴 수 있습니다(챔질이 약했으면 더 잘 털립니다).
export function jumpThrow(f, rand = Math.random) {
  if (f.T > 0.22) return false;
  return rand() < (1 - f.hookQ) * 0.5 * (f.A ? f.A.jump : 1);
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
