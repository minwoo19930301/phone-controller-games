// 골프 코스 공용 계산(three 없이 돌아갑니다): 모양, 잡음, 홀(높이·표면·경사·나무), 미니맵.
// 좌표: 단위 m, y = 높이. 티에서 그린을 볼 때 +z 가 앞, +x 가 왼쪽입니다(기존 니어핀·퍼팅과 같음).
// 그리기(build.js)와 공 굴리기(게임)가 같은 함수를 써서 화면과 물리가 어긋나지 않습니다.

export const RD = Math.PI / 180;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, v) => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const gauss = (x, z, cx, cz, s) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * s * s));
// 부드러운 최솟값(두 면이 만나는 곳에 꺾인 선이 생기지 않게)
export const smin = (a, b, k) => {
  const t = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - t * t * k * 0.25;
};

// 표면 종류. 게임 물리와 화면 글자가 이 이름을 씁니다.
export const SURFACES = ['tee', 'fairway', 'rough', 'deep', 'bunker', 'green', 'fringe', 'water', 'ob', 'path'];
export const SURFACE_NAMES = {
  tee: '티잉 그라운드', fairway: '페어웨이', rough: '러프', deep: '깊은 러프', bunker: '벙커',
  green: '그린', fringe: '프린지', water: '페널티 구역', ob: 'OB', path: '카트 도로'
};

// 같은 씨앗이면 늘 같은 수열(mulberry32)
export function rng(seed) {
  let a = (seed | 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 잡음 ----------
function hash2(i, j, s) {
  let h = (i * 374761393 + j * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// 값 잡음 -1..1
export function vnoise(x, z, s = 0) {
  const i = Math.floor(x);
  const j = Math.floor(z);
  const fx = x - i;
  const fz = z - j;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(i, j, s);
  const b = hash2(i + 1, j, s);
  const c = hash2(i, j + 1, s);
  const d = hash2(i + 1, j + 1, s);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
export function fbm(x, z, oct = 4, s = 0) {
  let t = 0;
  let amp = 0.5;
  let f = 1;
  let n = 0;
  for (let k = 0; k < oct; k++) {
    t += amp * vnoise(x * f, z * f, s + k * 17);
    n += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return t / n;
}
// 능선 잡음 0..1 (모래언덕·바위 결)
export function ridged(x, z, oct = 3, s = 0) {
  let t = 0;
  let amp = 0.5;
  let f = 1;
  let n = 0;
  for (let k = 0; k < oct; k++) {
    const r = 1 - Math.abs(vnoise(x * f, z * f, s + k * 31));
    t += amp * r * r;
    n += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return t / n;
}

// ---------- 모양 ----------
// 모든 모양은 v(x,z)(경계 1, 안쪽 < 1)와 sd(x,z)(대략의 부호 거리 m, 안쪽 음수), grow(m)(m 만큼 키운 모양)를 줍니다.

// 타원 블롭. 가장자리를 살짝 울퉁불퉁하게 해서 손으로 깎은 느낌을 줍니다.
export function blob(cx, cz, rx, rz, rot = 0, wob = 0.07, seed = 0) {
  const c = Math.cos(rot * RD);
  const s = Math.sin(rot * RD);
  const R = Math.max(rx, rz) * (1 + wob);
  const rm = Math.sqrt(rx * rz);
  const cut2 = (R * 3 + 6) ** 2;
  function v(x, z) {
    const dx = x - cx;
    const dz = z - cz;
    if (dx * dx + dz * dz > cut2) return 9;
    const u = (dx * c - dz * s) / rx;
    const w = (dx * s + dz * c) / rz;
    const r = Math.sqrt(u * u + w * w);
    if (!wob || r < 1e-9) return r;
    const th = Math.atan2(w, u);
    return r / (1 + wob * (Math.sin(3 * th + seed) * 0.6 + Math.sin(5 * th + seed * 2) * 0.4));
  }
  return {
    kind: 'blob', cx, cz, R, rx, rz, rot, v,
    sd: (x, z) => (v(x, z) - 1) * rm,
    grow: (m) => blob(cx, cz, rx + m, rz + m, rot, wob * 0.6, seed)
  };
}

// 굵기가 바뀌는 캡슐(선분 + 반지름). 페어웨이 띠에 씁니다. 길이를 따라 폭이 살짝 출렁입니다.
export function capsule(ax, az, bx, bz, r0, r1 = r0, wob = 0.1, seed = 0) {
  const ex = bx - ax;
  const ez = bz - az;
  const L2 = ex * ex + ez * ez || 1e-6;
  const L = Math.sqrt(L2);
  const rmax = Math.max(r0, r1) * (1 + Math.abs(wob));
  const cx = (ax + bx) / 2;
  const cz = (az + bz) / 2;
  const R = L / 2 + rmax;
  const cut2 = (R + rmax * 3 + 20) ** 2;
  const rAt = (t) => {
    const r = r0 + (r1 - r0) * t;
    return wob ? r * (1 + wob * (Math.sin(t * L * 0.05 + seed) * 0.6 + Math.sin(t * L * 0.13 + seed * 2.3) * 0.4)) : r;
  };
  function sd(x, z) {
    let t = ((x - ax) * ex + (z - az) * ez) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + ex * t - x;
    const pz = az + ez * t - z;
    return Math.sqrt(px * px + pz * pz) - rAt(t);
  }
  function v(x, z) {
    const dx = x - cx;
    const dz = z - cz;
    if (dx * dx + dz * dz > cut2) return 9;
    let t = ((x - ax) * ex + (z - az) * ez) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + ex * t - x;
    const pz = az + ez * t - z;
    return Math.sqrt(px * px + pz * pz) / rAt(t);
  }
  return {
    kind: 'capsule', cx, cz, R, v, sd, ax, az, bx, bz, r0, r1,
    grow: (m) => capsule(ax, az, bx, bz, r0 + m, r1 + m, wob * 0.5, seed + 1)
  };
}

// 닫힌 다각형(차이킨으로 모서리를 둥글게). 바다·호수·협곡처럼 큰 영역에 씁니다.
function chaikin(p) {
  const out = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
  }
  return out;
}
export function poly(points, soft = 4, iter = 3) {
  let p = points.map((q) => [q[0], q[1]]);
  for (let k = 0; k < iter; k++) p = chaikin(p);
  const n = p.length;
  const X = new Float64Array(n);
  const Z = new Float64Array(n);
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  p.forEach((q, i) => {
    X[i] = q[0];
    Z[i] = q[1];
    x0 = Math.min(x0, q[0]);
    x1 = Math.max(x1, q[0]);
    z0 = Math.min(z0, q[1]);
    z1 = Math.max(z1, q[1]);
  });
  function sd(x, z) {
    let d2 = Infinity;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = X[i];
      const zi = Z[i];
      const ex = X[j] - xi;
      const ez = Z[j] - zi;
      const wx = x - xi;
      const wz = z - zi;
      let t = (wx * ex + wz * ez) / (ex * ex + ez * ez || 1e-9);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = wx - ex * t;
      const qz = wz - ez * t;
      const dd = qx * qx + qz * qz;
      if (dd < d2) d2 = dd;
      if (zi > z !== Z[j] > z && x < xi + ((z - zi) * ex) / ez) inside = !inside;
    }
    const d = Math.sqrt(d2);
    return inside ? -d : d;
  }
  const pad = soft * 9 + 2;
  function v(x, z) {
    if (x < x0 - pad || x > x1 + pad || z < z0 - pad || z > z1 + pad) return 9;
    return 1 + sd(x, z) / soft;
  }
  return {
    kind: 'poly', pts: p, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, R: Math.hypot(x1 - x0, z1 - z0) / 2,
    bbox: { x0, x1, z0, z1 }, v, sd, soft,
    grow: (m) => {
      const g = poly(p, soft, 0);
      return { ...g, kind: 'polygrow', R: g.R + m, v: (x, z) => 1 + (sd(x, z) - m) / soft, sd: (x, z) => sd(x, z) - m };
    }
  };
}

// 굵기 있는 선(개울·카트 도로). sd = 선까지 거리 - 반폭.
export function strip(points, hw) {
  const n = points.length;
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const q of points) {
    x0 = Math.min(x0, q[0]);
    x1 = Math.max(x1, q[0]);
    z0 = Math.min(z0, q[1]);
    z1 = Math.max(z1, q[1]);
  }
  function dist(x, z) {
    let d2 = Infinity;
    for (let i = 0; i < n - 1; i++) {
      const ax = points[i][0];
      const az = points[i][1];
      const ex = points[i + 1][0] - ax;
      const ez = points[i + 1][1] - az;
      let t = ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1e-9);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + ex * t - x;
      const qz = az + ez * t - z;
      const dd = qx * qx + qz * qz;
      if (dd < d2) d2 = dd;
    }
    return Math.sqrt(d2);
  }
  const pad = hw * 6 + 30;
  const sd = (x, z) => {
    if (x < x0 - pad || x > x1 + pad || z < z0 - pad || z > z1 + pad) return pad;
    return dist(x, z) - hw;
  };
  return {
    kind: 'strip', pts: points, hw, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, R: Math.hypot(x1 - x0, z1 - z0) / 2 + hw,
    sd, v: (x, z) => 1 + sd(x, z) / hw, grow: (m) => strip(points, hw + m)
  };
}

// 모양의 경계선(경계값 thr)을 중심에서 사방으로 쏜 반직선 위 이분법으로 찾습니다. 그리기·미니맵용.
export function outline(shape, thr = 1, n = 120) {
  if (shape.kind === 'poly' && thr === 1) return shape.pts;
  if (shape.kind === 'strip') return null;
  const out = [];
  const hiR = (shape.R + 4) * Math.max(1.4, thr * 1.6);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    let lo = 0;
    let hi = hiR;
    for (let it = 0; it < 26; it++) {
      const m = (lo + hi) / 2;
      if (shape.v(shape.cx + dx * m, shape.cz + dz * m) < thr) lo = m;
      else hi = m;
    }
    out.push([shape.cx + dx * lo, shape.cz + dz * lo]);
  }
  return out;
}

// 점 목록을 m 간격 이하로 줄입니다(미니맵용)
function thin(pts, maxN) {
  if (!pts || pts.length <= maxN) return pts;
  const out = [];
  const step = pts.length / maxN;
  for (let i = 0; i < maxN; i++) out.push(pts[Math.floor(i * step)]);
  return out;
}
const r1 = (v) => Math.round(v * 10) / 10;

// ---------- 나무·소품 치수(물리 장애물과 그림이 같은 값을 씁니다, 크기 1 기준 m) ----------
export const KINDS = {
  tallpine: { h: 19, h0: 9.5, r: 3.6, trunk: 0.32, obstacle: true },
  pine: { h: 11, h0: 1.4, r: 3.0, trunk: 0.26, obstacle: true },
  fir: { h: 15, h0: 0.8, r: 3.1, trunk: 0.28, obstacle: true },
  oak: { h: 11, h0: 3.0, r: 5.0, trunk: 0.4, obstacle: true },
  cherry: { h: 7.5, h0: 2.0, r: 4.4, trunk: 0.3, obstacle: true },
  redpine: { h: 10, h0: 4.5, r: 4.2, trunk: 0.28, obstacle: true },
  saguaro: { h: 7.5, h0: 0, r: 1.3, trunk: 0.32, obstacle: true },
  palm: { h: 9, h0: 7.2, r: 3.4, trunk: 0.22, obstacle: true },
  gorse: { h: 1.5, h0: 0, r: 1.6, trunk: 0, obstacle: false },
  shrub: { h: 1.1, h0: 0, r: 1.3, trunk: 0, obstacle: false },
  barrel: { h: 0.8, h0: 0, r: 0.45, trunk: 0, obstacle: false },
  tuft: { h: 0.9, h0: 0, r: 0.5, trunk: 0, obstacle: false },
  rock: { h: 1.2, h0: 0, r: 1.2, trunk: 0, obstacle: false },
  boulder: { h: 3, h0: 0, r: 2.8, trunk: 0, obstacle: false },
  flower: { h: 0.4, h0: 0, r: 0.6, trunk: 0, obstacle: false }
};

// ---------- 홀 ----------
// def(코스 파일의 홀 정의)를 받아 물리·그리기가 함께 쓰는 홀 객체를 만듭니다.
export function makeHole(def, course, index) {
  const T = course.terrain;
  const seed = def.seed ?? (index + 1) * 101 + course.id.length * 7;
  const B = def.bounds;

  // 티(난이도별). 방향은 경로의 다음 점 쪽.
  const route = def.route.map(([x, z]) => ({ x, z }));
  const teeBy = {};
  for (const k of ['easy', 'normal', 'hard']) {
    const t = def.tees[k] || def.tees.normal;
    teeBy[k] = { x: t[0], z: t[1] };
  }
  const aim0 = route[1];
  const teeBoxes = Object.entries(teeBy).map(([key, t]) => {
    const dx = aim0.x - t.x;
    const dz = aim0.z - t.z;
    const L = Math.hypot(dx, dz) || 1;
    return { key, x: t.x, z: t.z, ux: dx / L, uz: dz / L, hl: def.teeSize?.[1] ?? 5.5, hw: def.teeSize?.[0] ?? 4, y: 0 };
  });

  const fair = def.fairway;
  const roughM = def.roughMargin ?? T.roughMargin ?? 10;
  const rough = def.rough || fair.map((s) => s.grow(roughM));
  // 티에서 첫 페어웨이까지 넘겨 치는 길: 표면은 그대로(깊은 러프 등) 두고 땅만 낮게 골라 티에서 홀이 보이게 합니다.
  const f0 = fair[0];
  const lane = capsule(teeBy.hard.x, teeBy.hard.z, f0.kind === 'capsule' ? f0.ax : f0.cx, f0.kind === 'capsule' ? f0.az : f0.cz, 12, 15, 0.12, 3);
  const corridor = [...rough, lane];
  const G = def.green;
  const gc = { x: G.at[0], z: G.at[1] };
  const gShape = blob(gc.x, gc.z, G.rx, G.rz, G.rot || 0, G.wob ?? 0.07, G.seed ?? 1.3);
  const gR = Math.sqrt(G.rx * G.rz);
  const FR = 1 + (G.fringe ?? 1.3) / gR; // 프린지 바깥 경계(그린 값)
  const bunkers = (def.bunkers || []).map((b) => {
    const dx = gc.x - b.s.cx;
    const dz = gc.z - b.s.cz;
    const L = Math.hypot(dx, dz) || 1;
    const nearGreen = L < 45;
    const type = b.type || (nearGreen ? 'green' : 'fairway');
    const depth = b.depth ?? (type === 'pot' ? 1.15 : type === 'green' ? 0.7 : 0.5);
    const lip = b.lip ?? (type === 'pot' ? 0.35 : type === 'green' ? 0.3 : 0.18);
    // 얼굴(턱) 쪽: 그린 근처는 그린 쪽, 페어웨이 벙커는 티 반대(앞) 쪽
    let fx = dx / L;
    let fz = dz / L;
    if (!nearGreen) {
      const tx = b.s.cx - route[0].x;
      const tz = b.s.cz - route[0].z;
      const tl = Math.hypot(tx, tz) || 1;
      fx = tx / tl;
      fz = tz / tl;
    }
    return { s: b.s, type, depth, lip, fx, fz };
  });
  const waste = def.waste || [];
  const waters = (def.water || []).map((w) => ({
    shape: w.shape, holes: w.holes || [], y: w.y ?? -0.6, depth: w.depth ?? 1.6, bank: w.bank ?? 7,
    bankSlope: w.bankSlope ?? 0.14, kind: w.kind || 'pond', name: w.name
  }));
  const obs = (def.ob || []).map((o) => ({ shape: o.shape, floor: o.floor, kind: o.kind || 'ob', name: o.name, wall: o.wall ?? 1 }));
  const paths = (def.paths || []).map((p) => strip(p, def.pathHw ?? 1.25));
  const elev = def.elev;

  // 큰 지형 흐름: 정한 점들의 높이를 거리 역제곱으로 섞습니다(티는 높고 그린은 낮게 같은 큰 흐름).
  function prof(x, z) {
    let sw = 0;
    let sy = 0;
    for (let i = 0; i < elev.length; i++) {
      const e = elev[i];
      const dx = x - e[0];
      const dz = z - e[1];
      const w = 1 / (dx * dx + dz * dz + (e[3] ?? 900));
      sw += w;
      sy += w * e[2];
    }
    return sy / sw;
  }
  // 코스 띠(러프)까지 부호 거리(m)
  function corr(x, z) {
    let m = 1e9;
    for (let i = 0; i < corridor.length; i++) {
      const d = corridor[i].sd(x, z);
      if (d < m) m = d;
    }
    return m;
  }
  function waterSd(w, x, z) {
    let d = w.shape.sd(x, z);
    for (const h of w.holes) {
      const e = -h.sd(x, z);
      if (e > d) d = e;
    }
    return d;
  }
  const flatten = T.flatten ?? 0.85;
  const bowl = T.bowl ?? 0;
  function base(x, z) {
    const p = prof(x, z);
    const cd = corr(x, z);
    const wc = 1 - smooth(-6, 30, cd);
    let h = p + T.relief(x, z, seed) * (1 - wc * flatten) + T.micro(x, z, seed) * wc;
    if (bowl && cd > 14) h += bowl * (cd < 44 ? ((cd - 14) * (cd - 14)) / 60 : cd - 29);
    return h;
  }
  for (const t of teeBoxes) t.y = base(t.x, t.z) + (def.teeLift ?? 0.55);
  const gy = base(gc.x, gc.z) + (G.lift ?? 0.35);
  const tiers = G.tiers || [];
  const bumps = G.bumps || [];
  const tilt = G.tilt || [0, 0.015];
  function greenH(x, z) {
    const dx = x - gc.x;
    const dz = z - gc.z;
    let h = gy + tilt[0] * dx + tilt[1] * dz;
    for (const t of tiers) {
      // [방향(도, 0 = +z), 중심에서 거리, 높이, 폭]
      const a = t[0] * RD;
      const s = dx * Math.sin(a) + dz * Math.cos(a) - t[1];
      h += t[2] * smooth(-t[3] / 2, t[3] / 2, s);
    }
    for (const b of bumps) h += b[3] * Math.exp(-((dx - b[0]) ** 2 + (dz - b[1]) ** 2) / (2 * b[2] * b[2]));
    return h;
  }

  function raw(x, z) {
    let h = base(x, z);
    // 협곡 같은 깊은 OB: 바닥까지 가파르게 깎습니다
    for (const o of obs) {
      if (o.floor == null) continue;
      const v = o.shape.v(x, z);
      if (v > 1.05) continue;
      const w = 1 - smooth(-1.8 * o.wall, 1.0, v);
      const strata = 0.9 * Math.sin(h * 1.7 + vnoise(x * 0.08, z * 0.08, 5) * 2) * w * (1 - w) * 4;
      h = lerp(h, o.floor + vnoise(x * 0.05, z * 0.05, 9) * 2, w) + strata;
    }
    // 티잉 그라운드: 살짝 높인 평평한 판
    for (const t of teeBoxes) {
      const dx = x - t.x;
      const dz = z - t.z;
      const a = dx * t.ux + dz * t.uz;
      const b = -dx * t.uz + dz * t.ux;
      const e = Math.max(Math.abs(a) - t.hl, Math.abs(b) - t.hw);
      if (e < 4) h = lerp(h, t.y, 1 - smooth(0, 3.6, e));
    }
    // 그린 단지: 그린·프린지는 정한 경사면, 바깥은 부드럽게 이어 붙입니다
    const gv = gShape.v(x, z);
    if (gv < 1.8) h = lerp(h, greenH(x, z), 1 - smooth(1.02, 1.75, gv));
    // 그린 안은 그린 경사면 그대로 둡니다(옆 벙커 턱·물가 둑이 그린 면을 비틀지 않게). 프린지에서 서서히 풀립니다.
    const gk = smooth(1.0, 1.16, gv);
    // 벙커: 파내고, 턱(그린 쪽)은 살짝 올립니다
    for (let i = 0; i < bunkers.length; i++) {
      const b = bunkers[i];
      const v = b.s.v(x, z);
      if (v > 1.6) continue;
      const dx = x - b.s.cx;
      const dz = z - b.s.cz;
      const L = Math.sqrt(dx * dx + dz * dz) || 1;
      const face = clamp01((dx * b.fx + dz * b.fz) / L);
      const e0 = b.type === 'pot' ? 0.78 : 0.6;
      const cut = b.depth * (1 - smooth(e0, 1.02, v));
      const lip = b.lip * smooth(0.86, 1.04, v) * (1 - smooth(1.04, 1.5, v)) * (0.35 + 0.65 * face);
      h += (lip - cut * (1 - 0.4 * face)) * gk;
    }
    for (const w of waste) {
      const v = w.v(x, z);
      if (v < 1.2) h -= 0.18 * (1 - smooth(0.7, 1.15, v)) * gk;
    }
    // 물: 수면 아래로 파고 둑은 부드럽게. 둑 너머 높은 땅은 경사(최대 약 24도)로 깎아 절벽 벽이 생기지 않게 합니다.
    for (const w of waters) {
      const d = waterSd(w, x, z);
      if (d > w.bank + 140) continue;
      if (d < 0) h = w.y - 0.06 - Math.min(w.depth, -d * 0.32);
      else {
        const bankH = w.y + 0.06 + d * w.bankSlope;
        const hh = Math.max(h, w.y + 0.1 + d * 0.015);
        let hw = lerp(bankH, hh, smooth(0, w.bank, d));
        const cap = w.y + 2.1 + w.bank * w.bankSlope + Math.max(0, d - w.bank) * 0.45;
        if (hw > cap - 2) hw = smin(hw, cap, 2);
        h = lerp(h, hw, gk);
      }
    }
    return h;
  }

  // 컵 둘레 0.7m 는 평면(실제로도 평평한 곳에 홀을 뚫습니다). 핀 후보 모두에 적용해서 핀을 바꿔도 같습니다.
  const pins = (def.pins || [G.at]).map(([x, z]) => {
    const e = 0.05;
    const h0 = raw(x, z);
    return {
      x, z, y: h0,
      px: (raw(x + e, z) - raw(x - e, z)) / (2 * e),
      pz: (raw(x, z + e) - raw(x, z - e)) / (2 * e)
    };
  });
  function heightRaw(x, z) {
    let h = raw(x, z);
    for (const p of pins) {
      const dx = x - p.x;
      const dz = z - p.z;
      const r2 = dx * dx + dz * dz;
      if (r2 > 0.49) continue;
      const w = 1 - smooth(0.3, 0.7, Math.sqrt(r2));
      h += (p.y + p.px * dx + p.pz * dz - h) * w;
    }
    return h;
  }

  // 그린 둘레는 0.1m 격자에 미리 구워 둡니다(퍼팅 굴리기가 아주 많이 묻기 때문). 처음 물을 때 굽습니다.
  const GH = Math.max(G.rx, G.rz) * (1 + (G.wob ?? 0.07)) + 14;
  const gf = { x0: gc.x - GH, z0: gc.z - GH, n: Math.round((2 * GH) / 0.1) + 1, step: 0.1 };
  let gH = null;
  let gX = null;
  let gZ = null;
  function bakeGreen() {
    const { x0, z0, n, step } = gf;
    gH = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) gH[j * n + i] = heightRaw(x0 + i * step, z0 + j * step);
    gX = new Float32Array(n * n);
    gZ = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const i0 = Math.max(0, i - 1);
        const i1 = Math.min(n - 1, i + 1);
        const j0 = Math.max(0, j - 1);
        const j1 = Math.min(n - 1, j + 1);
        gX[j * n + i] = (gH[j * n + i1] - gH[j * n + i0]) / ((i1 - i0) * step);
        gZ[j * n + i] = (gH[j1 * n + i] - gH[j0 * n + i]) / ((j1 - j0) * step);
      }
    }
  }
  const inGreenField = (x, z) => x > gf.x0 + 0.2 && z > gf.z0 + 0.2 && x < gf.x0 + (gf.n - 1) * gf.step - 0.2 && z < gf.z0 + (gf.n - 1) * gf.step - 0.2;
  function bil(A, x, z) {
    const { x0, z0, n, step } = gf;
    const fx = (x - x0) / step;
    const fz = (z - z0) / step;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const k = j * n + i;
    return (A[k] * (1 - u) + A[k + 1] * u) * (1 - v) + (A[k + n] * (1 - u) + A[k + n + 1] * u) * v;
  }
  function height(x, z) {
    if (inGreenField(x, z)) {
      if (!gH) bakeGreen();
      return bil(gH, x, z);
    }
    return heightRaw(x, z);
  }
  // 경사(높이의 기울기) [dh/dx, dh/dz]. 오르막 쪽을 가리킵니다. 공은 반대로 굴러갑니다.
  function slope(x, z) {
    if (inGreenField(x, z)) {
      if (!gH) bakeGreen();
      return [bil(gX, x, z), bil(gZ, x, z)];
    }
    const e = 0.25;
    return [(heightRaw(x + e, z) - heightRaw(x - e, z)) / (2 * e), (heightRaw(x, z + e) - heightRaw(x, z - e)) / (2 * e)];
  }

  function inTee(x, z) {
    for (const t of teeBoxes) {
      const dx = x - t.x;
      const dz = z - t.z;
      const a = dx * t.ux + dz * t.uz;
      const b = -dx * t.uz + dz * t.ux;
      if (Math.abs(a) < t.hl && Math.abs(b) < t.hw) return t;
    }
    return null;
  }
  function inAny(list, x, z) {
    for (let i = 0; i < list.length; i++) if (list[i].v(x, z) < 1) return true;
    return false;
  }
  function waterAt(x, z) {
    for (const w of waters) if (waterSd(w, x, z) < 0) return w;
    return null;
  }
  function surface(x, z) {
    if (x < B.x0 || x > B.x1 || z < B.z0 || z > B.z1) return 'ob';
    if (inTee(x, z)) return 'tee';
    const gv = gShape.v(x, z);
    if (gv < 1) return 'green';
    for (const o of obs) if (o.shape.v(x, z) < 1) return 'ob';
    if (waterAt(x, z)) return 'water';
    for (let i = 0; i < bunkers.length; i++) if (bunkers[i].s.v(x, z) < 1) return 'bunker';
    if (gv < FR) return 'fringe';
    for (let i = 0; i < paths.length; i++) if (paths[i].sd(x, z) < 0) return 'path';
    if (inAny(fair, x, z)) return 'fairway';
    if (inAny(waste, x, z)) return 'deep';
    if (inAny(rough, x, z)) return 'rough';
    return 'deep';
  }
  // 어느 물인지(수면 높이 포함). 물이 아니면 null.
  function waterLevel(x, z) {
    const w = waterAt(x, z);
    return w ? w.y : null;
  }

  // 경로 길이(티별)
  const routeLen = (from) => {
    let L = Math.hypot(route[1].x - from.x, route[1].z - from.z);
    for (let i = 1; i < route.length - 1; i++) L += Math.hypot(route[i + 1].x - route[i].x, route[i + 1].z - route[i].z);
    return Math.round(L);
  };
  const lengthBy = { easy: routeLen(teeBy.easy), normal: routeLen(teeBy.normal), hard: routeLen(teeBy.hard) };

  // 위험 지역 목록(이름·중심·반지름·외곽선). 화면 안내와 봇 판단용.
  const hazards = [];
  bunkers.forEach((b) => hazards.push({ type: 'bunker', sub: b.type, name: b.type === 'pot' ? '항아리 벙커' : b.type === 'green' ? '그린 벙커' : '페어웨이 벙커', x: r1(b.s.cx), z: r1(b.s.cz), r: r1(b.s.R) }));
  waters.forEach((w) => hazards.push({ type: 'water', sub: w.kind, name: w.name || (w.kind === 'creek' ? '개울' : w.kind === 'sea' ? '바다' : w.kind === 'lake' ? '호수' : '연못'), x: r1(w.shape.cx), z: r1(w.shape.cz), r: r1(w.shape.R), y: w.y }));
  obs.forEach((o) => hazards.push({ type: 'ob', sub: o.kind, name: o.name || 'OB', x: r1(o.shape.cx), z: r1(o.shape.cz), r: r1(o.shape.R) }));
  waste.forEach((w) => hazards.push({ type: 'waste', name: course.surfaceNames?.deep || '웨이스트 에어리어', x: r1(w.cx), z: r1(w.cz), r: r1(w.R) }));

  const hole = {
    course: course.id,
    index,
    number: index + 1,
    name: def.name,
    en: def.en,
    sub: def.sub,
    par: def.par,
    lengthM: lengthBy.normal,
    lengthByDifficulty: lengthBy,
    tee: { ...teeBy.normal },
    teeByDifficulty: teeBy,
    teeBoxes,
    teeHeight: (key = 'normal') => (teeBoxes.find((t) => t.key === key) || teeBoxes[1]).y,
    route: route.map((p) => ({ ...p })),
    pin: { x: pins[0].x, z: pins[0].z },
    pins: pins.map((p) => ({ x: p.x, z: p.z })),
    pinHeight: (p) => height((p || hole.pin).x, (p || hole.pin).z),
    greenCenter: { ...gc },
    greenRadius: gR,
    green: { rx: G.rx, rz: G.rz, rot: G.rot || 0, y: gy, fringe: FR },
    bounds: { ...B },
    waterY: waters.length ? waters[0].y : null,
    waters: waters.map((w) => ({ kind: w.kind, y: w.y, name: w.name })),
    hazards,
    surfaceNames: { ...SURFACE_NAMES, ...(course.surfaceNames || {}) },
    seed,
    height,
    heightRaw,
    surface,
    slope,
    waterLevel,
    inGreen: (x, z) => gShape.v(x, z) < 1,
    // 그린 높이 격자(0.1m)와 나무 배치를 미리 만들어 둡니다. 처음 퍼팅 때 멈칫하지 않게 로딩 중에 부르세요(build 가 부릅니다).
    prepare() {
      if (!gH) bakeGreen();
      hole.dress();
      return hole;
    },
    // 그리기용 내부 자료
    _: { def, T, fair, rough, gShape, FR, bunkers, waste, waters, obs, paths, waterSd, corr, base, prof }
  };

  // 경로를 따라 거리를 재는 도구들
  hole.aimFrom = (x, z) => {
    // 지금 자리에서 다음 목표점(경로 위). 그린 근처면 핀.
    const d = Math.hypot(hole.pin.x - x, hole.pin.z - z);
    if (d < 260) return { ...hole.pin };
    let best = route[route.length - 1];
    for (let i = 1; i < route.length; i++) {
      const p = route[i];
      if (Math.hypot(p.x - x, p.z - z) > 60 && (p.z - z) * (hole.pin.z - z) + (p.x - x) * (hole.pin.x - x) > 0) {
        best = p;
        break;
      }
    }
    return { ...best };
  };
  hole.distToPin = (x, z) => Math.hypot(hole.pin.x - x, hole.pin.z - z);

  // 나무·소품(같은 씨앗이면 같은 자리). 물리 장애물 격자도 같이 만듭니다.
  let dressCache = null;
  hole.dress = () => {
    if (dressCache) return dressCache;
    const items = course.dress ? course.dress(hole, makeScatter(hole, rng(seed * 7 + 3)), rng(seed * 13 + 5)) : [];
    const obstacles = [];
    for (const it of items) {
      const K = KINDS[it.kind];
      if (!K || !K.obstacle) continue;
      obstacles.push({ kind: it.kind, x: it.x, z: it.z, y: it.y, r: K.r * it.s, h0: K.h0 * it.s, h1: K.h * it.s, trunk: K.trunk * it.s });
    }
    const cell = 20;
    const grid = new Map();
    for (const o of obstacles) {
      const k = Math.floor(o.x / cell) + ',' + Math.floor(o.z / cell);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(o);
    }
    dressCache = { items, obstacles, grid, cell };
    return dressCache;
  };
  // 공이 나무에 맞는지: 맞으면 { kind, part:'canopy'|'trunk', x, z, r } 아니면 null
  hole.obstacleAt = (x, y, z) => {
    const { grid, cell } = hole.dress();
    const ci = Math.floor(x / cell);
    const cj = Math.floor(z / cell);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const list = grid.get(i + ',' + j);
        if (!list) continue;
        for (const o of list) {
          const dx = x - o.x;
          const dz = z - o.z;
          const d = Math.sqrt(dx * dx + dz * dz);
          const hy = y - o.y;
          if (hy < o.h0 && d < o.trunk + 0.03) return { kind: o.kind, part: 'trunk', x: o.x, z: o.z, r: o.trunk };
          if (hy >= o.h0 && hy <= o.h1) {
            // 우듬지: 위로 갈수록 좁아지는 모양(원뿔과 공 사이)
            const t = (hy - o.h0) / Math.max(0.1, o.h1 - o.h0);
            const rr = o.r * (o.kind === 'fir' || o.kind === 'pine' ? 1 - t * 0.85 : Math.sin(Math.PI * (0.15 + t * 0.85)));
            if (d < rr * 0.85) return { kind: o.kind, part: 'canopy', x: o.x, z: o.z, r: rr };
          }
        }
      }
    }
    return null;
  };

  // 미니맵 자료(세계 좌표 다각형). 처음 물을 때 만듭니다.
  let mm = null;
  Object.defineProperty(hole, 'minimap', {
    enumerable: true,
    get() {
      if (mm) return mm;
      const o = (s, thr) => thin(outline(s, thr, 96), 64).map(([x, z]) => [r1(x), r1(z)]);
      const tees = teeBoxes.map((t) => {
        const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
          const px = t.x + t.ux * a * t.hl - t.uz * b * t.hw;
          const pz = t.z + t.uz * a * t.hl + t.ux * b * t.hw;
          return [r1(px), r1(pz)];
        });
        return { key: t.key, x: t.x, z: t.z, pts: c };
      });
      const { obstacles } = hole.dress();
      mm = {
        bounds: { ...B },
        axis: Math.atan2(gc.x - route[0].x, gc.z - route[0].z),
        rough: rough.map((s) => o(s, 1)),
        fairway: fair.map((s) => o(s, 1)),
        fringe: o(gShape, FR),
        green: o(gShape, 1),
        bunkers: bunkers.map((b) => o(b.s, 1)),
        waste: waste.map((s) => o(s, 1)),
        water: waters.map((w) => ({ kind: w.kind, pts: w.shape.kind === 'strip' ? null : o(w.shape, 1), line: w.shape.kind === 'strip' ? w.shape.pts : null, hw: w.shape.hw, holes: w.holes.map((h) => o(h, 1)) })),
        ob: obs.map((x) => o(x.shape, 1)),
        paths: paths.map((p) => p.pts),
        tees,
        trees: obstacles.filter((_, i) => i % Math.max(1, Math.floor(obstacles.length / 260)) === 0).map((t) => [r1(t.x), r1(t.z), r1(t.r)]),
        route: route.map((p) => [p.x, p.z]),
        pins: pins.map((p) => [p.x, p.z]),
        greenCenter: [gc.x, gc.z]
      };
      return mm;
    }
  });
  return hole;
}

// ---------- 나무 뿌리기 ----------
// 코스 파일의 dress(hole, scatter) 가 부르는 도구. 규칙에 맞는 자리만 받아 들입니다.
function makeScatter(hole, rand) {
  const { corr, gShape } = hole._;
  const B = hole.bounds;
  const taken = new Map();
  const cellOf = (x, z) => Math.floor(x / 4) + ',' + Math.floor(z / 4);
  const tee = hole.teeByDifficulty;
  const gc = hole.greenCenter;
  const a0 = hole.route[1];
  // 티 뒤 카메라 자리와 티 앞 시야는 비워 둡니다
  const tdx = a0.x - tee.normal.x;
  const tdz = a0.z - tee.normal.z;
  const tl = Math.hypot(tdx, tdz);
  const tux = tdx / tl;
  const tuz = tdz / tl;
  function clearOfTee(x, z) {
    for (const k of ['hard', 'normal', 'easy']) {
      const t = tee[k];
      const dx = x - t.x;
      const dz = z - t.z;
      const a = dx * tux + dz * tuz;
      const b = Math.abs(-dx * tuz + dz * tux);
      if (a > -45 && a < 60 && b < 14 + Math.max(0, a) * 0.25) return false;
    }
    return true;
  }
  function info(x, z) {
    return { s: hole.surface(x, z), cd: corr(x, z), gv: gShape.v(x, z), gd: Math.hypot(x - gc.x, z - gc.z), y: hole.heightRaw(x, z), w: hole.waterLevel(x, z) };
  }
  // rule: { kind, n, cd:[min,max], surf:[...허용], gap, s:[min,max], clump:[개수, 반지름], margin, test(x,z,info) }
  function scatter(rule) {
    const out = [];
    const margin = rule.margin ?? 90;
    const x0 = B.x0 - margin;
    const x1 = B.x1 + margin;
    const z0 = B.z0 - margin;
    const z1 = B.z1 + margin;
    const surf = rule.surf || ['deep', 'ob'];
    const gap = rule.gap ?? 3;
    const [cn, cr] = rule.clump || [1, 0];
    const tries = rule.n * (rule.tries ?? 12);
    for (let i = 0; i < tries && out.length < rule.n; i++) {
      const cx = x0 + rand() * (x1 - x0);
      const cz = z0 + rand() * (z1 - z0);
      for (let k = 0; k < cn && out.length < rule.n; k++) {
        const a = rand() * Math.PI * 2;
        const rr = Math.sqrt(rand()) * cr;
        const x = cx + Math.cos(a) * rr;
        const z = cz + Math.sin(a) * rr;
        const inf = info(x, z);
        if (!surf.includes(inf.s)) continue;
        // 경계 밖(OB)이라도 바다·호수 위에는 심지 않습니다(물을 허용한 규칙만 예외)
        if (inf.w !== null && !surf.includes('water')) continue;
        if (rule.cd && (inf.cd < rule.cd[0] || inf.cd > rule.cd[1])) continue;
        if (inf.gd < (rule.greenGap ?? 24)) continue;
        if (!rule.nearTee && !clearOfTee(x, z)) continue;
        if (rule.test && !rule.test(x, z, inf)) continue;
        const key = cellOf(x, z);
        const g = gap;
        let ok = true;
        if (g > 0) {
          for (let di = -1; di <= 1 && ok; di++) {
            for (let dj = -1; dj <= 1 && ok; dj++) {
              const list = taken.get(Math.floor(x / 4) + di + ',' + (Math.floor(z / 4) + dj));
              if (list) for (const p of list) if ((p[0] - x) ** 2 + (p[1] - z) ** 2 < Math.max(g, p[2]) ** 2) { ok = false; break; }
            }
          }
        }
        if (!ok) continue;
        if (g > 0) {
          if (!taken.has(key)) taken.set(key, []);
          taken.get(key).push([x, z, g]);
        }
        const [s0, s1] = rule.s || [0.8, 1.2];
        out.push({ kind: rule.kind, x, z, y: inf.y, s: s0 + rand() * (s1 - s0), r: rand() * Math.PI * 2, tint: rand() });
      }
    }
    return out;
  }
  scatter.rand = rand;
  scatter.info = info;
  return scatter;
}

// ---------- 미니맵 그리기 ----------
// ctx 에 홀 그림을 그립니다. 티가 아래, 그린이 위로 오게 돌리고(rotate), 세계 +x 는 왼쪽으로 그립니다.
// opts: { x, y, w, h, pad, rotate, palette, balls:[{x,z,color}], pin:{x,z}, trees, bg, route }
// 돌려준 값의 toScreen(x,z) 로 다른 표시를 더 얹을 수 있습니다.
export function drawMinimap(ctx, hole, opts = {}) {
  const m = hole.minimap;
  const P = { ...DEFAULT_PALETTE, ...(hole.palette || {}), ...(opts.palette || {}) };
  const X = opts.x || 0;
  const Y = opts.y || 0;
  const W = opts.w || ctx.canvas.width;
  const H = opts.h || ctx.canvas.height;
  const pad = opts.pad ?? 10;
  const rot = opts.rotate === false ? 0 : m.axis;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  // 세계 → 돌린 좌표(앞 = 위, 왼쪽(+x) = 왼쪽)
  const fwd = (x, z) => [-(x * c - z * s), x * s + z * c];
  // 그릴 범위: 러프·그린·티·물·경로
  let a0 = Infinity;
  let a1 = -Infinity;
  let b0 = Infinity;
  let b1 = -Infinity;
  const eat = (pts) => {
    if (!pts) return;
    for (const [x, z] of pts) {
      const [u, v] = fwd(x, z);
      a0 = Math.min(a0, u);
      a1 = Math.max(a1, u);
      b0 = Math.min(b0, v);
      b1 = Math.max(b1, v);
    }
  };
  m.rough.forEach(eat);
  eat(m.fringe);
  m.tees.forEach((t) => eat(t.pts));
  const cw = a1 - a0;
  const ch = b1 - b0;
  const sc = Math.min((W - pad * 2) / cw, (H - pad * 2) / ch);
  const ox = X + W / 2 - ((a0 + a1) / 2) * sc;
  const oy = Y + H / 2 + ((b0 + b1) / 2) * sc;
  const toScreen = (x, z) => {
    const [u, v] = fwd(x, z);
    return [ox + u * sc, oy - v * sc];
  };
  const path = (pts) => {
    ctx.beginPath();
    pts.forEach(([x, z], i) => {
      const [px, py] = toScreen(x, z);
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    });
    ctx.closePath();
  };
  ctx.save();
  if (opts.clip !== false) {
    ctx.beginPath();
    ctx.rect(X, Y, W, H);
    ctx.clip();
  }
  if (opts.bg !== false) {
    ctx.fillStyle = opts.bg || P.deep;
    ctx.fillRect(X, Y, W, H);
  }
  for (const w of m.water) {
    if (w.kind === 'sea' || w.kind === 'lake') {
      ctx.fillStyle = P.water;
      path(w.pts);
      ctx.fill();
    }
  }
  for (const pts of m.ob) {
    ctx.fillStyle = P.ob;
    path(pts);
    ctx.fill();
  }
  ctx.fillStyle = P.rough;
  m.rough.forEach((p) => {
    path(p);
    ctx.fill();
  });
  ctx.fillStyle = P.waste;
  m.waste.forEach((p) => {
    path(p);
    ctx.fill();
  });
  ctx.fillStyle = P.fairway;
  m.fairway.forEach((p) => {
    path(p);
    ctx.fill();
  });
  if (opts.trees !== false) {
    ctx.fillStyle = P.tree;
    for (const [x, z, r] of m.trees) {
      const [px, py] = toScreen(x, z);
      ctx.beginPath();
      ctx.arc(px, py, Math.max(1.2, r * sc * 0.8), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const w of m.water) {
    if (w.kind === 'sea' || w.kind === 'lake') continue;
    ctx.fillStyle = P.water;
    ctx.strokeStyle = P.water;
    if (w.line) {
      ctx.lineWidth = Math.max(2, w.hw * 2 * sc);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      w.line.forEach(([x, z], i) => {
        const [px, py] = toScreen(x, z);
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      });
      ctx.stroke();
    } else {
      path(w.pts);
      ctx.fill();
    }
  }
  // 섬(물 안의 땅)
  for (const w of m.water) {
    for (const h of w.holes) {
      ctx.fillStyle = P.rough;
      path(h);
      ctx.fill();
    }
  }
  ctx.strokeStyle = P.path;
  ctx.lineWidth = Math.max(1, 2.4 * sc);
  for (const pts of m.paths) {
    ctx.beginPath();
    pts.forEach(([x, z], i) => {
      const [px, py] = toScreen(x, z);
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    });
    ctx.stroke();
  }
  ctx.fillStyle = P.fringe;
  path(m.fringe);
  ctx.fill();
  ctx.fillStyle = P.green;
  path(m.green);
  ctx.fill();
  ctx.fillStyle = P.sand;
  m.bunkers.forEach((p) => {
    path(p);
    ctx.fill();
  });
  ctx.fillStyle = P.tee;
  m.tees.forEach((t) => {
    path(t.pts);
    ctx.fill();
  });
  if (opts.route) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    m.route.forEach(([x, z], i) => {
      const [px, py] = toScreen(x, z);
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // 핀
  const pin = opts.pin || hole.pin;
  if (pin) {
    const [px, py] = toScreen(pin.x, pin.z);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px, py - 14);
    ctx.stroke();
    ctx.fillStyle = opts.flag || '#ff3b3b';
    ctx.beginPath();
    ctx.moveTo(px, py - 14);
    ctx.lineTo(px + 9, py - 10.5);
    ctx.lineTo(px, py - 7);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(px, py, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const b of opts.balls || []) {
    const [px, py] = toScreen(b.x, b.z);
    ctx.fillStyle = b.color || '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(px, py, b.r || 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
  return { toScreen, scale: sc };
}

export const DEFAULT_PALETTE = {
  deep: '#3f6a30', rough: '#4f8a3a', fairway: '#74b452', green: '#8fd06a', fringe: '#7cc05c', tee: '#86c766',
  sand: '#ecdcae', waste: '#cfb58a', water: '#3c88b5', ob: '#6b4a3a', path: '#c9c3b6', tree: '#24451f'
};
