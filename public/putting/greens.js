// 퍼팅 챌린지 세 홀의 그린 모양(높이·표면). 그리기(scene.js)와 공 굴리기(physics.js)가 같은 값을 씁니다.
// 좌표: 홀마다 공 출발점 근처가 원점, +z = 홀 쪽, +x = 왼쪽(공 뒤에서 홀을 볼 때), 단위 m.
// 굴리기는 0.1m 격자에 미리 구워 둔 높이·기울기를 보간해서 씁니다(빠르고, 화면 메시와 같은 값).

const RD = Math.PI / 180;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const smooth = (e0, e1, v) => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const gauss = (x, z, cx, cz, s) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * s * s));

// 타원 모양 영역. 가장자리를 살짝 울퉁불퉁하게 해서 손으로 깎은 느낌을 줍니다. 1 보다 작으면 안쪽.
function blob(cx, cz, rx, rz, rot, wob, seed) {
  const c = Math.cos(rot * RD);
  const s = Math.sin(rot * RD);
  return (x, z) => {
    const dx = x - cx;
    const dz = z - cz;
    const u = (dx * c - dz * s) / rx;
    const v = (dx * s + dz * c) / rz;
    const th = Math.atan2(v, u);
    const k = 1 + wob * (Math.sin(3 * th + seed) * 0.6 + Math.sin(5 * th + seed * 2) * 0.4);
    return Math.hypot(u, v) / k;
  };
}

export const SURF = ['green', 'fringe', 'rough', 'bunker'];
export const FRINGE = 1.12; // 그린 바깥 1m 쯤 되는 칼라(프린지)

// 세 홀. top 은 그린 위 모양(높낮이), base 는 주변 지형입니다.
const DEFS = [
  {
    id: 1,
    name: '투 티어',
    sub: '아래 단에서 위 단으로 올려 치는 오르막. 턱을 못 넘으면 굴러 내려와요.',
    tag: 'TWO-TIER',
    par: 2,
    green: [0.3, 6.4, 8.6, 11.2, 6, 0.06, 1.1],
    start: { x: 1.1, z: 0.4 },
    cup: { x: -0.9, z: 7.7 },
    lift: 0.18,
    top: (x, z) => 0.25 * smooth(3.2, 5.8, z + 0.16 * x) + 0.006 * z - 0.006 * x + 0.022 * Math.sin(x * 0.55 + 0.4) * Math.cos(z * 0.45),
    mounds: [[-14, 13, 4.5, 0.7], [12, 2, 5, 0.5], [9, 24, 6, 0.9]],
    bunkers: [[-95, 3.2, 2.0, 70, 0.12, 2.0], [40, 2.6, 3.4, -20, 0.12, 0.6]],
    seed: 11
  },
  {
    id: 2,
    name: '사이드 힐',
    sub: '왼쪽이 높은 옆 경사. 홀 왼쪽을 보고 쳐야 오른쪽으로 휘어 들어가요.',
    tag: 'SIDE HILL',
    par: 2,
    green: [0.2, 4.6, 8.0, 9.4, -14, 0.07, 2.4],
    start: { x: 1.4, z: 0.2 },
    cup: { x: -0.6, z: 6.9 },
    lift: 0.15,
    top: (x, z) => 0.02 * x + 0.006 * z + 0.03 * Math.sin(z * 0.6 + 0.5) * Math.cos(x * 0.4),
    mounds: [[13, 6, 5, 1.0], [-12, -3, 4, 0.5], [-7, 18, 5, 0.6]],
    bunkers: [[-100, 2.6, 4.2, 10, 0.12, 1.4], [35, 3.4, 2.0, 30, 0.1, 3.1]],
    seed: 23
  },
  {
    id: 3,
    name: '롱 다운힐',
    sub: '12m 내리막. 가운데 둔덕을 넘어 살살 굴려야 해요. 홀 뒤는 다시 오르막.',
    tag: 'LONG DOWNHILL',
    par: 2,
    green: [0.7, 6.2, 8.8, 12.6, 5, 0.06, 0.8],
    start: { x: -0.9, z: -2.4 },
    cup: { x: 1.7, z: 9.5 },
    lift: 0.2,
    top: (x, z) => -0.017 * z + 0.09 * gauss(x, z, -0.4, 3.6, 1.6) - 0.007 * x + 0.22 * smooth(11.5, 16, z) +
      0.02 * Math.sin(x * 0.5) * Math.cos(z * 0.37 + 0.3),
    mounds: [[-12, 0, 5, 0.8], [11, 14, 4, 0.6], [-8, 22, 6, 1.0]],
    bunkers: [[-65, 2.4, 4.0, -8, 0.12, 2.2], [115, 2.8, 2.2, 40, 0.1, 1.0]],
    seed: 37
  }
];

const GRID = 0.1; // 굴리기용 격자 간격(m)
export const FIELD_HALF = 28; // 그린 가운데에서 이만큼까지 굴러갈 수 있습니다

function build(def) {
  const [gcx, gcz] = def.green;
  const green = blob(...def.green);
  // 벙커는 그린 가운데에서 정한 방향으로 밀어 내, 프린지 바깥에 붙게 놓습니다.
  const bunkerInfo = [];
  const bunkers = def.bunkers.map(([ang, rx, rz, rot, wob, seed]) => {
    const dx = Math.sin(ang * RD);
    const dz = Math.cos(ang * RD);
    for (let r = 4; r < 30; r += 0.25) {
      const bx = gcx + dx * r;
      const bz = gcz + dz * r;
      let min = 9;
      for (let k = 0; k < 32; k++) {
        const a = (k / 32) * Math.PI * 2;
        const c = Math.cos(rot * RD);
        const s = Math.sin(rot * RD);
        const u = Math.cos(a) * rx * 1.3;
        const v = Math.sin(a) * rz * 1.3;
        min = Math.min(min, green(bx + u * c + v * s, bz - u * s + v * c));
      }
      if (min > 1.32) {
        bunkerInfo.push({ x: bx, z: bz, rx, rz, rot });
        return blob(bx, bz, rx, rz, rot, wob, seed);
      }
    }
    bunkerInfo.push({ x: gcx + dx * 30, z: gcz + dz * 30, rx, rz, rot });
    return blob(gcx + dx * 30, gcz + dz * 30, rx, rz, rot, wob, seed);
  });
  const base = (x, z) => {
    let h = 0.3 * Math.sin(x * 0.07 + 0.4 + def.seed) * Math.cos(z * 0.06 + 0.2) + 0.22 * Math.sin(z * 0.11 + 1.3 + def.seed * 0.3);
    for (const [mx, mz, s, a] of def.mounds) h += a * gauss(x, z, mx, mz, s);
    // 멀어질수록 살짝 올라가는 그릇 모양(나무 쪽 둔덕)
    const r = Math.hypot(x - gcx, z - gcz);
    h += Math.max(0, r - 20) * 0.06;
    return h;
  };
  const raw = (x, z) => {
    const gv = green(x, z);
    const b = base(x, z);
    const w = 1 - smooth(FRINGE, 1.55, gv);
    let h = b + (def.top(x, z) + def.lift - b) * w;
    for (const f of bunkers) h -= 0.42 * (1 - smooth(0.72, 1.06, f(x, z)));
    return h;
  };
  // 컵 둘레 0.7m 는 평면으로 고릅니다(실제로도 평평한 곳에 홀을 뚫습니다).
  const c = def.cup;
  const e = 0.05;
  const h0 = raw(c.x, c.z);
  const px = (raw(c.x + e, c.z) - raw(c.x - e, c.z)) / (2 * e);
  const pz = (raw(c.x, c.z + e) - raw(c.x, c.z - e)) / (2 * e);
  const plane = (x, z) => h0 + px * (x - c.x) + pz * (z - c.z);
  const height = (x, z) => {
    const r = Math.hypot(x - c.x, z - c.z);
    if (r > 0.7) return raw(x, z);
    const w = 1 - smooth(0.3, 0.7, r);
    const h = raw(x, z);
    return h + (plane(x, z) - h) * w;
  };
  const surface = (x, z) => {
    for (const f of bunkers) if (f(x, z) < 1) return 'bunker';
    const v = green(x, z);
    if (v < 1) return 'green';
    if (v < FRINGE) return 'fringe';
    return 'rough';
  };

  // 격자 굽기
  const x0 = gcx - FIELD_HALF;
  const z0 = gcz - FIELD_HALF;
  const n = Math.round((2 * FIELD_HALF) / GRID) + 1;
  const H = new Float32Array(n * n);
  const S = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    const z = z0 + j * GRID;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * GRID;
      H[j * n + i] = height(x, z);
      S[j * n + i] = SURF.indexOf(surface(x, z));
    }
  }
  const GX = new Float32Array(n * n);
  const GZ = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(n - 1, i + 1);
      const j0 = Math.max(0, j - 1);
      const j1 = Math.min(n - 1, j + 1);
      GX[j * n + i] = (H[j * n + i1] - H[j * n + i0]) / ((i1 - i0) * GRID);
      GZ[j * n + i] = (H[j1 * n + i] - H[j0 * n + i]) / ((j1 - j0) * GRID);
    }
  }
  const inField = (x, z) => x > x0 + 0.2 && z > z0 + 0.2 && x < x0 + (n - 1) * GRID - 0.2 && z < z0 + (n - 1) * GRID - 0.2;
  function bil(A, x, z) {
    let fx = (x - x0) / GRID;
    let fz = (z - z0) / GRID;
    fx = Math.max(0, Math.min(n - 1.001, fx));
    fz = Math.max(0, Math.min(n - 1.001, fz));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const k = j * n + i;
    return (A[k] * (1 - u) + A[k + 1] * u) * (1 - v) + (A[k + n] * (1 - u) + A[k + n + 1] * u) * v;
  }
  // 격자 밖(먼 바깥 땅)은 원래 함수로 계산합니다.
  const heightAt = (x, z) => (inField(x, z) ? bil(H, x, z) : height(x, z));
  const gradAt = (x, z) => [bil(GX, x, z), bil(GZ, x, z)];
  const surfAt = (x, z) => {
    const i = Math.round((x - x0) / GRID);
    const j = Math.round((z - z0) / GRID);
    if (i < 0 || j < 0 || i >= n || j >= n) return 'rough';
    return SURF[S[j * n + i]];
  };

  const dx = c.x - def.start.x;
  const dz = c.z - def.start.z;
  return {
    ...def,
    center: { x: gcx, z: gcz },
    axis: Math.atan2(dx, dz), // 출발점 → 홀 방향(라디안, +는 왼쪽)
    length: Math.hypot(dx, dz),
    greenValue: green,
    bunkerFns: bunkers,
    bunkerInfo,
    greenR: Math.max(def.green[2], def.green[3]),
    base,
    height, // 원래 함수(그리기용)
    surface,
    heightAt,
    gradAt,
    surfAt,
    inField,
    cupY: plane(c.x, c.z),
    cupPlane: { px, pz },
    field: { x0, z0, n, step: GRID }
  };
}

const cache = new Map();
export const HOLE_COUNT = DEFS.length;
export function getHole(i) {
  if (!cache.has(i)) cache.set(i, build(DEFS[i]));
  return cache.get(i);
}

// 공에서 홀까지 직선을 따라 높낮이와 옆 경사를 읽어 줍니다(화면의 그린 읽기 칸).
export function readLine(hole, from) {
  const c = hole.cup;
  const dx = c.x - from.x;
  const dz = c.z - from.z;
  const d = Math.hypot(dx, dz) || 1;
  const ux = dx / d;
  const uz = dz / d;
  // 왼쪽 = (uz, -ux)
  let cross = 0;
  let along = 0;
  const N = 24;
  for (let k = 1; k <= N; k++) {
    const t = (k / (N + 1)) * d;
    const [gx, gz] = hole.gradAt(from.x + ux * t, from.z + uz * t);
    cross += gx * uz - gz * ux;
    along += gx * ux + gz * uz;
  }
  cross /= N;
  along /= N;
  return {
    dist: d,
    rise: hole.heightAt(c.x, c.z) - hole.heightAt(from.x, from.z),
    cross, // + 면 왼쪽이 높음 → 오른쪽으로 휨
    along
  };
}
