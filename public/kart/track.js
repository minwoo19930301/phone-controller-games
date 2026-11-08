// 카트 서킷 데이터: 제어점을 부드러운 곡선으로 이어 일정 간격으로 다시 찍은 뒤, 접선·곡률·코너 한계 속도를 미리 계산합니다.
// three 에 기대지 않는 순수 계산이라 node 에서도 검사할 수 있습니다.
// 좌표: x 오른쪽, z 아래쪽(위에서 본 지도 기준). 진행 방향 각도 h 는 f = (cos h, sin h), h 가 커지면 오른쪽으로 도는 겁니다.
// 오른쪽 벡터 r = (-f.z, f.x). 도로 가장자리 오프셋 d 는 오른쪽이 +, 왼쪽이 - 입니다.

export const TRACK_NAME = '노을 해안 서킷';

// 제어점(m). 시계 방향으로 한 바퀴. 0~1 구간이 출발 직선입니다.
const CTRL = [
  [-140, -150], [-20, -160], [120, -150], [225, -105], [255, -10], [225, 70], [150, 80], [105, 125],
  [110, 175], [50, 195], [-10, 150], [-5, 90], [-60, 65], [-110, 90], [-150, 150], [-235, 150],
  [-275, 80], [-265, -20], [-225, -100]
];

export const HALF_W = 8; // 도로 반폭(m)
export const CURB_W = 1.3; // 연석 폭
export const WALL_D = 12.5; // 벽이 서 있는 도로 중심선 거리
export const LIMIT_D = WALL_D - 0.9; // 카트 중심이 갈 수 있는 한계(벽에 닿는 선)
export const OFFROAD_D = HALF_W + 1.0; // 이 밖은 모래라 느려집니다

const TAU = Math.PI * 2;
export const wrapAngle = (a) => {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
};

// 센트리퍼털 Catmull-Rom(Barry-Goldman): 제어점 간격이 들쭉날쭉해도 덜 튑니다.
function crPoint(p0, p1, p2, p3, t) {
  const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-4;
  const t0 = 0;
  const t1 = t0 + d(p0, p1);
  const t2 = t1 + d(p1, p2);
  const t3 = t2 + d(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const lerp = (a, b, ta, tb) => [(a[0] * (tb - u) + b[0] * (u - ta)) / (tb - ta), (a[1] * (tb - u) + b[1] * (u - ta)) / (tb - ta)];
  const A1 = lerp(p0, p1, t0, t1);
  const A2 = lerp(p1, p2, t1, t2);
  const A3 = lerp(p2, p3, t2, t3);
  const B1 = lerp(A1, A2, t0, t2);
  const B2 = lerp(A2, A3, t1, t3);
  return lerp(B1, B2, t1, t2);
}

export function createTrack() {
  // 1) 촘촘히 찍기
  const dense = [];
  const n = CTRL.length;
  for (let i = 0; i < n; i++) {
    const p0 = CTRL[(i + n - 1) % n];
    const p1 = CTRL[i];
    const p2 = CTRL[(i + 1) % n];
    const p3 = CTRL[(i + 2) % n];
    for (let k = 0; k < 40; k++) dense.push(crPoint(p0, p1, p2, p3, k / 40));
  }
  // 2) 호 길이 기준으로 3m 간격 재표집(출발선: 제어점 1 근처가 s = 0)
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1];
    const b = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[cum.length - 1];
  const N = Math.round(total / 3);
  const ds = total / N;
  const rx = new Float32Array(N);
  const rz = new Float32Array(N);
  let j = 0;
  for (let i = 0; i < N; i++) {
    const s = i * ds;
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const a = dense[j % dense.length];
    const b = dense[(j + 1) % dense.length];
    const f = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
    rx[i] = a[0] + (b[0] - a[0]) * f;
    rz[i] = a[1] + (b[1] - a[1]) * f;
  }
  // 출발선 = 제어점 1(-20,-160)에서 가장 가까운 점이 인덱스 0 이 되도록 돌립니다.
  let k0 = 0;
  let best = Infinity;
  for (let i = 0; i < N; i++) {
    const d2 = (rx[i] + 20) ** 2 + (rz[i] + 160) ** 2;
    if (d2 < best) { best = d2; k0 = i; }
  }
  const x = new Float32Array(N);
  const z = new Float32Array(N);
  for (let i = 0; i < N; i++) { x[i] = rx[(i + k0) % N]; z[i] = rz[(i + k0) % N]; }

  // 3) 접선 각도·곡률
  const th = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i + N - 1) % N;
    const b = (i + 1) % N;
    th[i] = Math.atan2(z[b] - z[a], x[b] - x[a]);
  }
  const kap0 = new Float32Array(N);
  for (let i = 0; i < N; i++) kap0[i] = wrapAngle(th[(i + 2) % N] - th[(i + N - 2) % N]) / (4 * ds);
  const kappa = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let sum = 0;
    for (let q = -3; q <= 3; q++) sum += kap0[(i + q + N) % N];
    kappa[i] = sum / 7;
  }
  // 4) 코너 한계 속도: 횡가속 한계에서 구하고, 브레이크 가능 거리만큼 앞에서부터 줄이도록 되짚어 전파합니다.
  const A_LAT = 31;
  const BRAKE = 22;
  const VTOP = 52;
  const vmax = new Float32Array(N);
  for (let i = 0; i < N; i++) vmax[i] = Math.min(VTOP, Math.sqrt(A_LAT / Math.max(1e-4, Math.abs(kappa[i]))));
  for (let pass = 0; pass < 3; pass++) {
    for (let i = N * 2; i >= 0; i--) {
      const a = i % N;
      const b = (i + 1) % N;
      vmax[a] = Math.min(vmax[a], Math.sqrt(vmax[b] * vmax[b] + 2 * BRAKE * ds));
    }
  }

  const track = { N, ds, L: total, x, z, th, kappa, vmax, halfW: HALF_W, curbW: CURB_W, wallD: WALL_D, limitD: LIMIT_D, name: TRACK_NAME };

  /** 호 길이 s(m, 한 바퀴 안으로 접음)에서의 중심선 위치와 방향 */
  track.at = (s, out = {}) => {
    const L = track.L;
    s = ((s % L) + L) % L;
    const f = s / ds;
    const i = Math.floor(f) % N;
    const t = f - Math.floor(f);
    const i2 = (i + 1) % N;
    out.x = x[i] + (x[i2] - x[i]) * t;
    out.z = z[i] + (z[i2] - z[i]) * t;
    out.th = th[i] + wrapAngle(th[i2] - th[i]) * t;
    out.kappa = kappa[i] + (kappa[i2] - kappa[i]) * t;
    out.i = i;
    return out;
  };

  /** 점 (px,pz) 가 도로 어디쯤인지. hint 는 지난번 인덱스(없으면 전체 탐색). 결과: i, s, d(+오른쪽), th(그 구간 방향), cx, cz */
  track.locate = (px, pz, hint, out = {}) => {
    let bd = Infinity;
    let bi = 0;
    let bt = 0;
    const test = (ii) => {
      const i = ((ii % N) + N) % N;
      const j2 = (i + 1) % N;
      const ax = x[i];
      const az = z[i];
      const ex = x[j2] - ax;
      const ez = z[j2] - az;
      const t = Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / (ex * ex + ez * ez)));
      const dx = px - (ax + ex * t);
      const dz = pz - (az + ez * t);
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; bi = i; bt = t; }
    };
    if (hint == null || hint < 0) for (let i = 0; i < N; i++) test(i);
    else {
      for (let q = -14; q <= 14; q++) test(hint + q);
      if (bd > 45 * 45) for (let i = 0; i < N; i++) test(i);
    }
    const j2 = (bi + 1) % N;
    const ex = x[j2] - x[bi];
    const ez = z[j2] - z[bi];
    const len = Math.hypot(ex, ez) || 1;
    const cx = x[bi] + ex * bt;
    const cz = z[bi] + ez * bt;
    out.i = bi;
    out.s = (bi + bt) * ds;
    out.th = Math.atan2(ez, ex);
    out.cx = cx;
    out.cz = cz;
    out.d = (px - cx) * (-ez / len) + (pz - cz) * (ex / len);
    out.kappa = kappa[bi];
    return out;
  };

  // 부스트 패드(가속 발판): s, d(+오른쪽), 길이, 폭
  track.pads = [
    { s: 70, d: -3.2, len: 9, w: 5 },
    { s: 0.5 * total, d: 3, len: 9, w: 5 },
    { s: 0.78 * total, d: -2.5, len: 9, w: 5 }
  ];
  // 아이템 상자 줄(아이템전): 코너가 심하지 않은 곳 네 군데, 줄마다 도로를 가로질러 네 개
  track.itemRows = [150, 540, 975, 1340].map((s) => ({ s: (s / 1618) * total, ds: [-5.4, -1.8, 1.8, 5.4] }));
  return track;
}
