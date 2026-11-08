// 골퍼 모델과 스윙 자세 풀이(큰 화면 전용, three 필요). 외부 모델 파일 없이 모두 코드로 만듭니다.
// - makeGolfer(): 한 장으로 이어진 피부(SkinnedMesh)와 진짜 뼈대, 관절을 넘나드는 부드러운 가중치.
//   얼굴(코·귀·눈·눈썹·입), 머리카락과 모자, 클럽을 쥔 손(리드 손은 장갑), 선수 색 폴로, 벨트, 바지, 골프화.
// - poseFromClub(): 클럽 샤프트 방향(폰)에서 스윙 위치를 찾아 몸 전체를 풉니다
//   (어깨·골반 회전, 곧은 리드 팔, 손목 코킹, 체중 이동, 균형 잡힌 피니시).
// - makeClubMesh(): 드라이버·우드·유틸리티·아이언·웨지·퍼터 모델.
// 좌표(골퍼 root 안): +Z 공 쪽(골퍼가 보는 쪽), +X 목표 쪽(오른손잡이의 왼쪽), +Y 위, 원점은 두 발 가운데 바닥. 길이는 m.
import * as THREE from 'three';
import { CLUBS, clubById } from './clubs.js';

export { CLUBS, clubById, recommendClub } from './clubs.js';

const RD = Math.PI / 180;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const gauss = (x, w) => Math.exp(-(x * x) / (w * w));
const sgnpow = (x, p) => Math.sign(x) * Math.pow(Math.abs(x), p);
const X = V(1, 0, 0);
const Y = V(0, 1, 0);
const Z = V(0, 0, 1);
const qAxis = (axis, deg) => new THREE.Quaternion().setFromAxisAngle(axis, deg * RD);
const qMul = (...qs) => {
  const r = new THREE.Quaternion();
  for (const q of qs) r.multiply(q);
  return r;
};
const toV = (a) => (a == null ? null : a.isVector3 ? a.clone() : V(a[0], a[1], a[2]));

// 두 축(방향, 위)으로 직교 기저를 만듭니다.
function frame(dir, up) {
  const a = dir.clone().normalize();
  let b = up.clone().addScaledVector(a, -up.dot(a));
  if (b.lengthSq() < 1e-10) b = (Math.abs(a.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).addScaledVector(a, -(Math.abs(a.y) < 0.9 ? a.y : a.x));
  b.normalize();
  return [a, b, V().crossVectors(a, b)];
}
const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
// 쉬는 자세의 (방향, 위)를 새 (방향, 위)로 돌리는 회전
function aimQ(rDir, rUp, dir, up) {
  const [a1, b1, c1] = frame(rDir, rUp);
  const [a2, b2, c2] = frame(dir, up);
  _m1.makeBasis(a1, b1, c1).transpose();
  _m2.makeBasis(a2, b2, c2).multiply(_m1);
  return new THREE.Quaternion().setFromRotationMatrix(_m2);
}
// 두 마디 IK: 뿌리 A 에서 목표 T 로, 관절은 pole 쪽으로 튀어나옵니다.
function ik2(A, T, l1, l2, pole) {
  const d = V().subVectors(T, A);
  const len0 = d.length();
  const len = clamp(len0, Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.9995);
  d.multiplyScalar(1 / (len0 || 1));
  const x = (l1 * l1 - l2 * l2 + len * len) / (2 * len);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  let p = pole.clone().addScaledVector(d, -pole.dot(d));
  if (p.lengthSq() < 1e-8) p = V(0, -1, 0).addScaledVector(d, d.y);
  p.normalize();
  return { E: A.clone().addScaledVector(d, x).addScaledVector(p, h), T: A.clone().addScaledVector(d, len) };
}
// 쿼터니언에서 axis 둘레로 비튼 각(라디안)
function twistAngle(q, axis) {
  const p = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  let a = 2 * Math.atan2(p, q.w);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}
const crs = (p0, p1, p2, p3, t) => {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};
// 키 자세들을 u 로 부드럽게(캣멀-롬) 잇습니다. 숫자와 숫자 배열만 보간합니다.
function sampleKeys(keys, u) {
  u = clamp(u, keys[0].u, keys[keys.length - 1].u);
  let i = 0;
  while (i < keys.length - 2 && u > keys[i + 1].u) i++;
  const k0 = keys[Math.max(0, i - 1)];
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const k3 = keys[Math.min(keys.length - 1, i + 2)];
  const t = (u - k1.u) / (k2.u - k1.u || 1);
  const out = { u };
  for (const name in k1) {
    if (name === 'u') continue;
    const a = k1[name];
    if (typeof a === 'number') out[name] = crs(k0[name], a, k2[name], k3[name], t);
    else if (Array.isArray(a)) out[name] = a.map((_, j) => crs(k0[name][j], a[j], k2[name][j], k3[name][j], t));
  }
  return out;
}
function mixParams(a, b, t) {
  const out = {};
  for (const k in b) {
    const x = a[k];
    const y = b[k];
    if (typeof y === 'number' && typeof x === 'number') out[k] = lerp(x, y, t);
    else if (Array.isArray(y) && Array.isArray(x)) out[k] = y.map((v, i) => lerp(x[i], v, t));
    else out[k] = y;
  }
  return out;
}

// ---------- 뼈대(바인드 자세, 모든 뼈의 회전은 0) ----------
// 키 1.78m, 머리 0.237m(약 7.5등신). 팔은 아래로 40도 벌린 A 자세.
const SA = Math.sin(40 * RD);
const CA = Math.cos(40 * RD);
const L_UP = 0.315;
const L_FORE = 0.262;
// 팔 고리 표는 위팔 0.30·아래팔 0.26 기준으로 적었습니다. 실제 길이로 늘려 씁니다.
const armS = (s) => (s <= 0.3 ? (s * L_UP) / 0.3 : L_UP + ((s - 0.3) * L_FORE) / 0.26);
const BIND = (() => {
  const P = {
    root: V(0, 0, 0),
    hips: V(0, 0.965, -0.01),
    spine: V(0, 1.065, -0.015),
    chest: V(0, 1.245, -0.02),
    neck: V(0, 1.468, -0.026),
    head: V(0, 1.562, -0.01)
  };
  for (const [sd, s] of [['L', 1], ['R', -1]]) {
    const d = V(s * SA, -CA, 0);
    const sh = V(s * 0.172, 1.425, -0.022);
    P['clav' + sd] = V(s * 0.028, 1.418, -0.006);
    P['arm' + sd] = sh;
    P['delt' + sd] = sh.clone(); // 어깨 도우미 뼈: 쇄골과 위팔 사이 반쯤 돈 자세(어깨 살이 꺼지거나 부풀지 않게)
    P['fore' + sd] = sh.clone().addScaledVector(d, L_UP);
    P['twist' + sd] = sh.clone().addScaledVector(d, L_UP + L_FORE * 0.55);
    P['hand' + sd] = sh.clone().addScaledVector(d, L_UP + L_FORE);
    P['thigh' + sd] = V(s * 0.088, 0.905, -0.006);
    P['shin' + sd] = V(s * 0.088, 0.485, 0.0);
    P['foot' + sd] = V(s * 0.088, 0.083, -0.014);
    P['toe' + sd] = V(s * 0.088, 0.022, 0.128);
  }
  return P;
})();
const PARENT = {
  hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  clavL: 'chest', armL: 'clavL', foreL: 'armL', twistL: 'foreL', handL: 'foreL', deltL: 'clavL',
  clavR: 'chest', armR: 'clavR', foreR: 'armR', twistR: 'foreR', handR: 'foreR', deltR: 'clavR',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL', toeL: 'footL',
  thighR: 'hips', shinR: 'thighR', footR: 'shinR', toeR: 'footR'
};
const BONE_NAMES = ['root', ...Object.keys(PARENT)];
const BI = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));
const L_THIGH = BIND.thighL.distanceTo(BIND.shinL);
const L_SHIN = BIND.shinL.distanceTo(BIND.footL);
const HC = V(0, 1.668, 0.012); // 머리 가운데
const REST = {};
for (const [sd, s] of [['L', 1], ['R', -1]]) {
  const d = V(s * SA, -CA, 0);
  const up = V().crossVectors(d, Z).normalize();
  REST['arm' + sd] = { dir: d, up };
  REST['fore' + sd] = { dir: d, up };
  REST['thigh' + sd] = { dir: V().subVectors(BIND['shin' + sd], BIND['thigh' + sd]).normalize(), up: X };
  REST['shin' + sd] = { dir: V().subVectors(BIND['foot' + sd], BIND['shin' + sd]).normalize(), up: X };
}

// ---------- 손(쥔 손) 기준 좌표 ----------
// 손 기준틀(왼손): +Y 손가락 쪽, +X 엄지 쪽, +Z 손등. 오른손은 X 를 뒤집은 거울상입니다.
// 클럽 그립은 손바닥 쪽을 대각선으로 지납니다(새끼 손가락 쪽 손바닥 아래에서 검지 가운데 마디로).
const GRIP_R = 0.0123;
const HAND = {};
for (const [sd, s] of [['L', 1], ['R', -1]]) {
  const d = V(s * SA, -CA, 0);
  const dorsal = V(s * CA, SA, 0);
  // 바인드에서 손 기준틀 → 몸 좌표 회전
  const xb = s > 0 ? Z.clone() : Z.clone().negate();
  const Qb = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xb, d, dorsal));
  const sH = V(s * 0.78, 0.62, 0).normalize(); // 그립 축(헤드 쪽)
  const g0 = V(0, 0.066, -0.026); // 그립 축 위 한 점
  const rH = V(0, 0, s > 0 ? 1 : -1).applyAxisAngle(sH, (s > 0 ? 12 : -8) * RD); // 클럽 페이스 방향이 되는 손 방향
  const Rc = aimQ(sH, rH, Y, Z); // 손 기준틀 → 클럽 기준틀
  HAND[sd] = { Qb, QbInv: Qb.clone().invert(), sH, g0, rH, Rc, RcInv: Rc.clone().invert() };
}
const GRIP_AT = { L: 0.058, R: 0.131 }; // 그립 끝에서 두 손 가운데까지(m)

// ---------- 메시 쌓기 ----------
class Builder {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.si = [];
    this.sw = [];
    this.sg = [];
    this.groups = new Map();
  }
  v(p, u, v, w, sg) {
    const list = [];
    for (const k in w) if (w[k] > 1e-4) list.push([BI[k], w[k]]);
    if (!list.length) list.push([BI.root, 1]);
    list.sort((a, b) => b[1] - a[1]);
    if (list.length > 4) list.length = 4;
    let s = 0;
    for (const e of list) s += e[1];
    for (let i = 0; i < 4; i++) {
      const e = list[i];
      this.si.push(e ? e[0] : 0);
      this.sw.push(e ? e[1] / s : 0);
    }
    this.pos.push(p.x, p.y, p.z);
    this.uv.push(u, v);
    this.sg.push(sg);
    return this.sg.length - 1;
  }
  t(mat, a, b, c) {
    let g = this.groups.get(mat);
    if (!g) this.groups.set(mat, (g = []));
    g.push(a, b, c);
  }
  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    const idx = [];
    const mats = [];
    for (const [mat, list] of this.groups) {
      geo.addGroup(idx.length, list.length, mats.length);
      mats.push(mat);
      for (const i of list) idx.push(i);
    }
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // 이음매(UV 를 위해 겹친 점)의 법선을 같은 매끈함 묶음 안에서 평균
    const n = geo.attributes.normal;
    const map = new Map();
    for (let i = 0; i < this.sg.length; i++) {
      const key = `${Math.round(this.pos[i * 3] * 2e4)},${Math.round(this.pos[i * 3 + 1] * 2e4)},${Math.round(this.pos[i * 3 + 2] * 2e4)},${this.sg[i]}`;
      let e = map.get(key);
      if (!e) map.set(key, (e = { x: 0, y: 0, z: 0, ids: [] }));
      e.x += n.getX(i);
      e.y += n.getY(i);
      e.z += n.getZ(i);
      e.ids.push(i);
    }
    for (const e of map.values()) {
      if (e.ids.length < 2) continue;
      const l = Math.hypot(e.x, e.y, e.z) || 1;
      for (const i of e.ids) n.setXYZ(i, e.x / l, e.y / l, e.z / l);
    }
    return { geo, mats };
  }
}
let SG = 1;
const centroid = (pts) => pts.reduce((a, p) => a.add(p), V()).multiplyScalar(1 / pts.length);

// 고리(링)들을 이어 관을 만듭니다. rows[i] = { pts: [V3...], v, mat, split }. 띠 i→i+1 의 재질은 rows[i].mat.
function loft(B, rows, o) {
  const N = rows[0].pts.length;
  const uLen = o.uLen ?? 1;
  const weight = o.weight;
  const matOf = o.matOf || ((i) => rows[i].mat);
  // 방향: 가운데 띠 첫 사각형의 법선이 바깥(링 중심에서 멀어지는 쪽)이어야 합니다.
  const mid = Math.max(0, Math.min(rows.length - 2, Math.floor(rows.length / 2)));
  const c = centroid(rows[mid].pts);
  let flip = false;
  {
    const p0 = rows[mid].pts[0];
    const p1 = rows[mid].pts[1];
    const p2 = rows[mid + 1].pts[1];
    const nn = V().subVectors(p1, p0).cross(V().subVectors(p2, p0));
    flip = nn.dot(V().subVectors(p0, c)) < 0;
    if (o.inside) flip = !flip;
  }
  let sg = SG++;
  let prev = null;
  let first = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const make = (g) => {
      const ids = [];
      for (let j = 0; j <= N; j++) {
        const p = r.pts[j % N];
        ids.push(B.v(p, (j / N) * uLen, r.v, weight(p, i, j % N, r), g));
      }
      return ids;
    };
    let cur = make(sg);
    if (!first) first = cur;
    if (prev) {
      for (let j = 0; j < N; j++) {
        const mat = matOf(i - 1, j);
        const a = prev[j];
        const b = prev[j + 1];
        const cc = cur[j + 1];
        const d = cur[j];
        if (flip) {
          B.t(mat, a, cc, b);
          B.t(mat, a, d, cc);
        } else {
          B.t(mat, a, b, cc);
          B.t(mat, a, cc, d);
        }
      }
    }
    if (r.split && i < rows.length - 1) {
      sg = SG++;
      cur = make(sg);
    }
    prev = cur;
  }
  const cap = (row, ids, other, mat) => {
    const cc = centroid(row.pts);
    const away = V().subVectors(cc, centroid(other.pts));
    const gi = SG++;
    const ci = B.v(cc, 0.5 * uLen, row.v, weight(cc, -1, 0, row), gi);
    const cid = [];
    for (let j = 0; j <= N; j++) cid.push(B.v(row.pts[j % N], (j / N) * uLen, row.v, weight(row.pts[j % N], -1, j % N, row), gi));
    const nn = V().subVectors(row.pts[0], cc).cross(V().subVectors(row.pts[1], cc));
    const f = nn.dot(away) < 0;
    for (let j = 0; j < N; j++) {
      if (f) B.t(mat, ci, cid[j + 1], cid[j]);
      else B.t(mat, ci, cid[j], cid[j + 1]);
    }
  };
  if (o.capA) cap(rows[0], first, rows[1], o.capA);
  if (o.capB) cap(rows[rows.length - 1], prev, rows[rows.length - 2], o.capB);
}

// 매개변수 곡면 격자(u 는 돌아서 닫힘). fn(u,v) → V3. 방향은 center 에서 바깥을 보게 맞춥니다.
function grid(B, nu, nv, fn, o) {
  const sg = SG++;
  const ids = [];
  const pts = [];
  for (let j = 0; j <= nv; j++) {
    const row = [];
    const prow = [];
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const v = j / nv;
      const p = fn(o.closed && i === nu ? 0 : u, v);
      prow.push(p);
      row.push(B.v(p, (o.uv ? o.uv(u, v)[0] : u), (o.uv ? o.uv(u, v)[1] : v), o.weight(p, u, v), o.sg ?? sg));
    }
    ids.push(row);
    pts.push(prow);
  }
  // 방향 판정
  const jm = Math.floor(nv / 2);
  const im = Math.floor(nu / 3);
  const p0 = pts[jm][im];
  const nn = V().subVectors(pts[jm][im + 1], p0).cross(V().subVectors(pts[jm + 1][im], p0));
  const out = o.outward ? o.outward(p0) : V().subVectors(p0, o.center);
  const flip = nn.dot(out) < 0;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const mat = o.matOf ? o.matOf((i + 0.5) / nu, (j + 0.5) / nv) : o.mat;
      if (!mat) continue;
      const a = ids[j][i];
      const b = ids[j][i + 1];
      const c = ids[j + 1][i + 1];
      const d = ids[j + 1][i];
      if (flip) {
        B.t(mat, a, c, b);
        B.t(mat, a, d, c);
      } else {
        B.t(mat, a, b, c);
        B.t(mat, a, c, d);
      }
    }
  }
  return pts;
}

// 점들을 따라가는 관(손가락·눈썹·속눈썹). radius(t) 는 0..1 위치의 반지름, 끝은 둥글게 닫습니다.
function tube(B, mat, pts, radius, o = {}) {
  const N = o.N || 10;
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  const M = o.M || Math.max(6, pts.length * 4);
  const frames = curve.computeFrenetFrames(M, false);
  const rows = [];
  const flat = o.flat || 1;
  for (let k = 0; k <= M; k++) {
    const t = k / M;
    const c = curve.getPointAt(t);
    let n1 = frames.normals[k];
    let n2 = frames.binormals[k];
    if (o.up) {
      const tg = frames.tangents[k];
      n1 = o.up.clone().addScaledVector(tg, -o.up.dot(tg)).normalize();
      n2 = V().crossVectors(tg, n1);
    }
    const r = radius(t);
    const ring = [];
    for (let j = 0; j < N; j++) {
      const a = (j / N) * Math.PI * 2;
      ring.push(c.clone().addScaledVector(n1, Math.cos(a) * r * flat).addScaledVector(n2, Math.sin(a) * r));
    }
    rows.push({ pts: ring, v: t, mat });
  }
  // 둥근 끝
  const addEnd = (atEnd) => {
    const k = atEnd ? M : 0;
    const tg = frames.tangents[k].clone().multiplyScalar(atEnd ? 1 : -1);
    const c = curve.getPointAt(atEnd ? 1 : 0);
    const r = radius(atEnd ? 1 : 0);
    const base = rows[atEnd ? rows.length - 1 : 0].pts;
    const extra = [];
    for (const f of [0.5, 0.8, 0.95]) {
      const ang = (f * Math.PI) / 2;
      extra.push({ pts: base.map((p) => c.clone().add(V().subVectors(p, c).multiplyScalar(Math.cos(ang))).addScaledVector(tg, Math.sin(ang) * r)), v: atEnd ? 1 : 0, mat });
    }
    if (atEnd) rows.push(...extra);
    else rows.unshift(...extra.reverse());
  };
  if (o.roundEnd !== false) addEnd(true);
  if (o.roundStart) addEnd(false);
  loft(B, rows, { weight: o.weight, capA: o.roundStart ? mat : o.capStart, capB: mat, uLen: 1 });
}

// 상자(평면 법선)
function box(B, mat, center, size, q, w) {
  const hx = size[0] / 2;
  const hy = size[1] / 2;
  const hz = size[2] / 2;
  const faces = [
    [X, Y, Z], [X.clone().negate(), Y, Z.clone().negate()], [Y, Z, X], [Y.clone().negate(), Z, X.clone().negate()], [Z, X, Y], [Z.clone().negate(), X, Y.clone().negate()]
  ];
  const half = { x: hx, y: hy, z: hz };
  for (const [n, a, b] of faces) {
    const sg = SG++;
    const ext = (vv) => Math.abs(vv.x) * half.x + Math.abs(vv.y) * half.y + Math.abs(vv.z) * half.z;
    const en = ext(n);
    const ea = ext(a);
    const eb = ext(b);
    const ids = [];
    for (const [sa, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = V().addScaledVector(n, en).addScaledVector(a, sa * ea).addScaledVector(b, sb * eb).applyQuaternion(q).add(center);
      ids.push(B.v(p, (sa + 1) / 2, (sb + 1) / 2, w, sg));
    }
    // a × b = n 방향이 바깥
    const crossAB = V().crossVectors(a, b);
    if (crossAB.dot(n) > 0) {
      B.t(mat, ids[0], ids[1], ids[2]);
      B.t(mat, ids[0], ids[2], ids[3]);
    } else {
      B.t(mat, ids[0], ids[2], ids[1]);
      B.t(mat, ids[0], ids[3], ids[2]);
    }
  }
}

// ---------- 몸통 ----------
// y, 반폭, 앞 깊이, 뒤 깊이, 모서리 지수, 중심 z
const TORSO = [
  [0.8, 0.04, 0.035, 0.035, 2.0, -0.012],
  [0.835, 0.118, 0.07, 0.085, 2.2, -0.014],
  [0.875, 0.152, 0.083, 0.104, 2.3, -0.016],
  [0.925, 0.165, 0.089, 0.112, 2.4, -0.018],
  [0.975, 0.161, 0.09, 0.103, 2.4, -0.016],
  [1.02, 0.152, 0.092, 0.094, 2.4, -0.012],
  [1.075, 0.147, 0.096, 0.088, 2.4, -0.008],
  [1.14, 0.151, 0.101, 0.09, 2.5, -0.006],
  [1.21, 0.159, 0.109, 0.095, 2.5, -0.006],
  [1.28, 0.167, 0.115, 0.1, 2.6, -0.008],
  [1.345, 0.172, 0.112, 0.1, 2.7, -0.012],
  [1.395, 0.173, 0.099, 0.096, 2.8, -0.016],
  [1.43, 0.167, 0.083, 0.088, 2.7, -0.02],
  [1.452, 0.148, 0.07, 0.078, 2.5, -0.024],
  [1.468, 0.114, 0.062, 0.07, 2.3, -0.026],
  [1.48, 0.078, 0.056, 0.063, 2.1, -0.027],
  [1.505, 0.059, 0.053, 0.058, 2.0, -0.025],
  [1.545, 0.055, 0.051, 0.056, 2.0, -0.021],
  [1.585, 0.055, 0.047, 0.061, 2.1, -0.017],
  [1.625, 0.054, 0.036, 0.07, 2.1, -0.014]
];
function torsoAt(y) {
  const T = TORSO;
  let i = 0;
  while (i < T.length - 2 && y > T[i + 1][0]) i++;
  const k0 = T[Math.max(0, i - 1)];
  const k1 = T[i];
  const k2 = T[i + 1];
  const k3 = T[Math.min(T.length - 1, i + 2)];
  const t = clamp((y - k1[0]) / (k2[0] - k1[0]), 0, 1);
  const out = [];
  for (let c = 1; c < 6; c++) out.push(crs(k0[c], k1[c], k2[c], k3[c], t));
  return out;
}
function torsoPt(y, th, extra = 0) {
  const [a, bf, bb, n, cz] = torsoAt(y);
  const s = Math.sin(th);
  const c = Math.cos(th);
  const e = 2 / n;
  const x = a * sgnpow(s, e);
  const z = (c >= 0 ? bf : bb) * sgnpow(c, e);
  const r = Math.hypot(x / a, z / (c >= 0 ? bf : bb)) || 1;
  // 대략의 바깥 방향
  const nx = x / (a * a);
  const nz = z / Math.pow(c >= 0 ? bf : bb, 2);
  const nl = Math.hypot(nx, nz) || 1;
  const ax = Math.abs(x);
  let d = extra;
  if (c > 0) d += 0.011 * gauss(y - 1.31, 0.045) * gauss(ax - 0.075, 0.05) * c; // 가슴
  if (c < 0) d += 0.008 * gauss(y - 1.36, 0.05) * gauss(ax - 0.08, 0.045) * -c; // 날개뼈
  if (c < 0) d -= 0.005 * gauss(y - 1.2, 0.17) * gauss(x, 0.02) * -c; // 등골
  if (c < 0) d += 0.022 * gauss(y - 0.905, 0.05) * gauss(ax - 0.07, 0.06) * -c; // 엉덩이
  d += 0.004 * gauss(y - 1.05, 0.02) * (y > 1.01 ? 1 : 0); // 셔츠가 벨트 위로 살짝 부풂
  void r;
  return V(x + (nx / nl) * d, y, z + (nz / nl) * d + cz);
}
function torsoW(p) {
  const y = p.y;
  const ax = Math.abs(p.x);
  const sd = p.x >= 0 ? 'L' : 'R';
  const a1 = smooth(0.985, 1.13, y);
  const a2 = smooth(1.13, 1.3, y);
  const a3 = smooth(1.45, 1.515, y);
  const a4 = smooth(1.55, 1.605, y);
  const w = { hips: 1 - a1, spine: a1 * (1 - a2), chest: a2 * (1 - a3), neck: a3 * (1 - a4), head: a4 };
  const sh = smooth(0.08, 0.165, ax) * smooth(1.26, 1.42, y) * (1 - a3);
  if (sh > 0) {
    const k = w.chest;
    w.chest = k * (1 - 0.65 * sh);
    w['clav' + sd] = k * 0.4 * sh;
    w['delt' + sd] = k * 0.3 * sh * smooth(0.12, 0.175, ax);
  }
  const th = smooth(0.95, 0.82, y) * smooth(0.02, 0.11, ax);
  if (th > 0) {
    const k = w.hips;
    w.hips = k * (1 - 0.55 * th);
    w['thigh' + sd] = k * 0.55 * th;
  }
  return w;
}
function buildTorso(B) {
  const ys = [];
  for (let y = 0.8; y <= 1.625 + 1e-6; y += 0.0155) ys.push(y);
  ys.push(1.625);
  const bounds = [1.005, 1.478];
  const list = ys.filter((y) => bounds.every((b) => Math.abs(y - b) > 0.006)).concat(bounds).sort((a, b) => a - b);
  const N = 56;
  const rows = list.map((y) => ({
    pts: Array.from({ length: N }, (_, j) => torsoPt(y, (j / N) * Math.PI * 2)),
    v: y,
    mat: y < 1.005 - 1e-6 ? 'pants' : y < 1.478 - 1e-6 ? 'shirt' : 'skin'
  }));
  loft(B, rows, { weight: (p) => torsoW(p), capA: 'pants', capB: 'skin', uLen: 1.0 });
}
// 몸통 겉면 위의 한 점과 바깥 방향(장식 붙이기용)
function torsoSurface(y, th, off = 0) {
  const p = torsoPt(y, th, off);
  const e = 0.004;
  const a = torsoPt(y, th + e, off);
  const b = torsoPt(y + e, th, off);
  const n = V().subVectors(a, p).cross(V().subVectors(b, p)).normalize();
  if (n.dot(V(p.x, 0, p.z - torsoAt(y)[4])) < 0) n.negate();
  return { p, n };
}

// 폴로 깃, 앞섶 단추, 가슴 로고, 벨트
function buildShirtBits(B) {
  // 깃 세움(목둘레 띠)
  const N = 40;
  const gap = 0.36; // 앞쪽 벌어진 각(라디안, 반)
  const angs = [];
  for (let j = 0; j <= N; j++) angs.push(gap + (j / N) * (Math.PI * 2 - gap * 2));
  const collarW = (p) => ({ chest: 0.6, neck: 0.4 });
  const neckR = (y, th) => {
    const p = torsoPt(y, th);
    return p;
  };
  const standRows = [];
  for (const [y, off] of [[1.468, 0.004], [1.476, 0.009], [1.502, 0.0095], [1.506, 0.006]]) {
    standRows.push(angs.map((th) => {
      const p = neckR(y, th);
      const c = V(0, y, torsoAt(y)[4]);
      return p.add(V().subVectors(p, c).setY(0).normalize().multiplyScalar(off));
    }));
  }
  // 깃(접혀 내려온 부분): 띠 위에서 바깥 아래로
  const fall = [];
  for (let k = 0; k <= 4; k++) {
    const f = k / 4;
    fall.push(angs.map((th) => {
      const a = Math.abs(((th + Math.PI) % (Math.PI * 2)) - Math.PI); // 앞에서 떨어진 각
      const front = smooth(1.3, 0.38, a);
      // 목에서 어깨 비탈을 따라 내려오며 셔츠 위에 눕습니다(접힌 쪽은 도톰하게).
      const y = lerp(1.508, 1.472 - 0.034 * front, Math.pow(f, 0.85));
      const off = lerp(0.0115, 0.0042, Math.pow(f, 0.6));
      return torsoPt(Math.min(1.505, y), th, off).add(V(0, lerp(0.002, 0.0035, f), 0));
    }));
  }
  const toRows = (arr, mat) => arr.map((pts) => ({ pts, v: 0, mat }));
  openStrip(B, standRows, 'shirt', collarW);
  openStrip(B, fall, 'collar', collarW);
  // 앞섶과 단추
  for (const [y, k] of [[1.445, 0], [1.412, 1]]) {
    const { p, n } = torsoSurface(y, 0, 0.002);
    const q = new THREE.Quaternion().setFromUnitVectors(Y, n);
    disc(B, 'white', p.addScaledVector(n, 0.002), 0.0055, 0.003, q, { chest: 1 });
    void k;
  }
  {
    // 앞섶 띠
    const rows = [];
    for (const y of [1.395, 1.42, 1.45, 1.475]) {
      rows.push([-0.016, 0.016].map((x) => {
        const th = Math.asin(clamp(x / torsoAt(y)[0], -1, 1));
        const { p, n } = torsoSurface(y, th, 0.0018);
        return p.addScaledVector(n, 0.0005);
      }));
    }
    openStrip(B, rows, 'shirt', () => ({ chest: 1 }));
  }
  // 가슴 로고(왼가슴)
  {
    const th = 0.62;
    const { p, n } = torsoSurface(1.345, th, 0.0015);
    const q = new THREE.Quaternion().setFromUnitVectors(Y, n);
    disc(B, 'white', p, 0.011, 0.0015, q, { chest: 1 });
    const { p: p2, n: n2 } = torsoSurface(1.345, th, 0.003);
    disc(B, 'accent', p2, 0.0055, 0.0012, new THREE.Quaternion().setFromUnitVectors(Y, n2), { chest: 1 });
  }
  // 벨트
  {
    const N2 = 56;
    const mk = (y, off) => Array.from({ length: N2 }, (_, j) => torsoPt(y, (j / N2) * Math.PI * 2, off));
    const rows = [
      { pts: mk(0.983, 0.0), v: 0, mat: 'belt', split: true },
      { pts: mk(0.983, 0.006), v: 0.006, mat: 'belt', split: true },
      { pts: mk(1.024, 0.006), v: 0.047, mat: 'belt', split: true },
      { pts: mk(1.024, 0.0), v: 0.053, mat: 'belt' }
    ];
    loft(B, rows, { weight: (p) => ({ hips: 0.85, spine: 0.15 }), uLen: 1 });
    // 버클
    const { p, n } = torsoSurface(1.0035, 0, 0.006);
    const q = new THREE.Quaternion().setFromUnitVectors(Z, n);
    box(B, 'metal', p.clone().addScaledVector(n, 0.003), [0.05, 0.034, 0.006], q, { hips: 1 });
    box(B, 'belt', p.clone().addScaledVector(n, 0.0062), [0.032, 0.018, 0.002], q, { hips: 1 });
  }
}
// 닫히지 않은 띠(행렬)를 면으로. 양면 재질이면 한 장, 아니면 바깥 방향은 그대로 둡니다.
function openStrip(B, rows, mat, wfn) {
  const sg = SG++;
  const ids = rows.map((r, i) => r.map((p, j) => B.v(p, j / (r.length - 1), i / (rows.length - 1), wfn(p), sg)));
  for (let i = 0; i < rows.length - 1; i++) {
    for (let j = 0; j < rows[i].length - 1; j++) {
      const a = ids[i][j];
      const b = ids[i][j + 1];
      const c = ids[i + 1][j + 1];
      const d = ids[i + 1][j];
      // 바깥 방향: 몸통 중심에서 멀어지게
      const p0 = rows[i][j];
      const nn = V().subVectors(rows[i][j + 1], p0).cross(V().subVectors(rows[i + 1][j], p0));
      const out = V(p0.x, 0, p0.z + 0.02);
      if (nn.dot(out) >= 0) {
        B.t(mat, a, b, c);
        B.t(mat, a, c, d);
      } else {
        B.t(mat, a, c, b);
        B.t(mat, a, d, c);
      }
    }
  }
}
// 얇은 원판(단추·로고). q 는 +Y 를 원판 법선으로 돌리는 회전
function disc(B, mat, center, r, h, q, w) {
  const N = 16;
  const rows = [];
  for (const [yy, rr] of [[0, r], [h, r], [h, r * 0.6]]) {
    rows.push({ pts: Array.from({ length: N }, (_, j) => { const a = (j / N) * Math.PI * 2; return V(Math.cos(a) * rr, yy, Math.sin(a) * rr).applyQuaternion(q).add(center); }), v: yy, mat, split: yy === h && rr === r });
  }
  loft(B, rows, { weight: () => w, capB: mat });
}

// ---------- 팔 ----------
// s(어깨에서 거리), 앞 반지름, 옆 반지름, 재질, 끊음(이음매 각)
const ARM_RINGS = [
  [0.02, 0.0585, 0.0595, 'shirt'],
  [0.06, 0.0585, 0.059, 'shirt'],
  [0.1, 0.0565, 0.0565, 'shirt'],
  [0.14, 0.054, 0.054, 'shirt'],
  [0.16, 0.0532, 0.0532, 'shirt', true],
  [0.1635, 0.0505, 0.0505, 'shirtIn', true],
  [0.1635, 0.0455, 0.0445, 'skin'],
  [0.2, 0.0465, 0.0435, 'skin'],
  [0.245, 0.0425, 0.0402, 'skin'],
  [0.285, 0.0388, 0.0398, 'skin'],
  [0.315, 0.0408, 0.0402, 'skin'],
  [0.36, 0.0405, 0.0365, 'skin'],
  [0.42, 0.0355, 0.031, 'skin'],
  [0.48, 0.0298, 0.0248, 'skin'],
  [0.525, 0.0268, 0.0208, 'skin'],
  [0.56, 0.025, 0.0195, 'skin']
];
function armW(s, sd) {
  const c = 1 - smooth(-0.075, 0.0, s);
  const a = smooth(-0.01, 0.1, s);
  const dl = (1 - c) * (1 - a);
  const e = smooth(L_UP - 0.055, L_UP + 0.035, s);
  const t = smooth(L_UP + 0.045, L_UP + 0.2, s);
  const h = smooth(L_UP + L_FORE - 0.025, L_UP + L_FORE, s) * 0.5;
  return {
    ['clav' + sd]: c * 0.65,
    chest: c * 0.35,
    ['delt' + sd]: dl,
    ['arm' + sd]: (1 - c - dl) * (1 - e),
    ['fore' + sd]: e * (1 - t),
    ['twist' + sd]: e * t * (1 - h),
    ['hand' + sd]: e * t * h
  };
}
function buildArm(B, sd) {
  const s = sd === 'L' ? 1 : -1;
  const S = BIND['arm' + sd];
  const d = V(s * SA, -CA, 0);
  const N = 26;
  const ringAt = (c, n, rf, rs, ss) => {
    const e1 = Z.clone().addScaledVector(n, -Z.dot(n)).normalize();
    const e2 = V().crossVectors(n, e1);
    const pts = [];
    for (let j = 0; j < N; j++) {
      const a = (j / N) * Math.PI * 2;
      const back = Math.max(0, -Math.cos(a));
      const bump = 0.006 * gauss(ss - L_UP + 0.008, 0.022) * Math.pow(back, 3);
      // e2 의 음수 쪽이 어깨 꼭대기(삼각근)입니다: 어깨에 가까울수록 눌러 둥근 어깨선으로
      const top = Math.max(0, -s * Math.sin(a));
      const squash = 1 - 0.42 * smooth(0.15, -0.02, ss) * top * top;
      pts.push(c.clone().addScaledVector(e1, Math.cos(a) * (rf + bump)).addScaledVector(e2, Math.sin(a) * (rs + bump) * squash));
    }
    return pts;
  };
  const rows = [];
  // 몸통 안에서 시작해 어깨로 휘어 나오는 첫 고리들
  const n0 = V(s, -0.25, 0).normalize();
  const n1 = V(s, 0, 0).add(d).normalize();
  rows.push({ pts: ringAt(V(s * 0.112, 1.398, -0.022), n0, 0.046, 0.04, -0.07), v: -0.07, mat: 'shirt', s: -0.07 });
  rows.push({ pts: ringAt(V(s * 0.148, 1.418, -0.022), n1, 0.056, 0.056, -0.03), v: -0.03, mat: 'shirt', s: -0.03 });
  for (const [s0, rf, rs, mat, split] of ARM_RINGS) {
    const ss = armS(s0);
    rows.push({ pts: ringAt(S.clone().addScaledVector(d, ss), d, rf, rs, ss), v: ss, mat, split, s: ss });
  }
  loft(B, rows, { weight: (p, i, j, r) => armW(r.s, sd), capA: 'shirt', uLen: 0.36 });
  return rows[rows.length - 1].pts;
}

// ---------- 다리 ----------
const LEG_RINGS = [
  [-0.06, 0.07, 0.07, 'pants'],
  [-0.02, 0.087, 0.089, 'pants'],
  [0.04, 0.092, 0.093, 'pants'],
  [0.12, 0.086, 0.087, 'pants'],
  [0.22, 0.075, 0.077, 'pants'],
  [0.33, 0.064, 0.066, 'pants'],
  [0.4, 0.06, 0.061, 'pants'],
  [0.455, 0.0585, 0.06, 'pants'],
  [0.52, 0.0592, 0.058, 'pants'],
  [0.6, 0.0572, 0.0552, 'pants'],
  [0.69, 0.0535, 0.0525, 'pants'],
  [0.76, 0.053, 0.0522, 'pants'],
  [0.792, 0.0545, 0.0538, 'pants', true],
  [0.797, 0.051, 0.05, 'pantsIn', true],
  [0.797, 0.033, 0.031, 'pantsIn']
];
function legW(s, sd) {
  const h = 1 - smooth(-0.07, 0.11, s);
  const k = smooth(0.36, 0.48, s);
  return { hips: h * 0.6, ['thigh' + sd]: (1 - h * 0.6) * (1 - k), ['shin' + sd]: k };
}
function buildLeg(B, sd) {
  const s = sd === 'L' ? 1 : -1;
  const H = BIND['thigh' + sd];
  const d = V().subVectors(BIND['foot' + sd], H).normalize();
  const e1 = Z.clone().addScaledVector(d, -Z.dot(d)).normalize();
  const e2 = V().crossVectors(d, e1);
  const N = 28;
  const rows = LEG_RINGS.map(([ss, rf, rs, mat, split]) => {
    const pts = [];
    for (let j = 0; j < N; j++) {
      const a = (j / N) * Math.PI * 2;
      // 바지 앞 주름
      const crease = 0.0035 * gauss(Math.atan2(Math.sin(a), Math.cos(a)), 0.22) * smooth(0.1, 0.25, ss) * (ss < 0.79 ? 1 : 0);
      // 허벅지 안쪽은 살짝 납작하게
      const inner = Math.max(0, -Math.sin(a) * s) * 0.006 * smooth(0.25, 0.0, ss);
      pts.push(H.clone().addScaledVector(d, ss).addScaledVector(e1, Math.cos(a) * (rf + crease)).addScaledVector(e2, Math.sin(a) * (rs - inner)));
    }
    return { pts, v: ss, mat, split, s: ss };
  });
  loft(B, rows, { weight: (p, i, j, r) => legW(r.s, sd), capA: 'pants', capB: 'pantsIn', uLen: 0.36 });
}

// ---------- 골프화 ----------
const SHOE_W = [[-0.083, 0.008], [-0.08, 0.02], [-0.074, 0.029], [-0.05, 0.036], [0, 0.041], [0.06, 0.047], [0.12, 0.0525], [0.16, 0.05], [0.19, 0.043], [0.21, 0.031], [0.219, 0.017], [0.222, 0.006]];
const SHOE_H = [[-0.083, 0.036], [-0.08, 0.046], [-0.074, 0.056], [-0.05, 0.076], [-0.02, 0.082], [0.02, 0.09], [0.06, 0.082], [0.1, 0.066], [0.14, 0.055], [0.18, 0.046], [0.21, 0.035], [0.219, 0.026], [0.222, 0.018]];
function pl(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 0; i < table.length - 1; i++) {
    if (x <= table[i + 1][0]) {
      const t = (x - table[i][0]) / (table[i + 1][0] - table[i][0]);
      return lerp(table[i][1], table[i + 1][1], t * t * (3 - 2 * t));
    }
  }
  return table[table.length - 1][1];
}
function buildShoe(B, sd) {
  const A = BIND['foot' + sd];
  const s = sd === 'L' ? 1 : -1;
  const zs = [-0.083, -0.081, -0.078, -0.074, -0.066, -0.055, -0.04, -0.02, 0, 0.02, 0.04, 0.06, 0.08, 0.1, 0.12, 0.14, 0.16, 0.175, 0.19, 0.2, 0.208, 0.214, 0.218, 0.221, 0.2225];
  const M = 30;
  const ground = -A.y;
  const rows = zs.map((zr) => {
    const w = pl(SHOE_W, zr);
    const h = pl(SHOE_H, zr);
    const pts = [];
    for (let j = 0; j < M; j++) {
      const psi = (j / M) * Math.PI * 2;
      const sn = Math.sin(psi);
      const cs = Math.cos(psi);
      const lower = cs > 0;
      const x = w * sgnpow(sn, lower ? 0.3 : 0.75);
      const yy = h * 0.5 * (1 - sgnpow(cs, lower ? 0.25 : 0.9));
      // 발 안쪽(엄지 쪽)이 조금 더 길게 휘어짐
      const zz = zr + (zr > 0.15 ? -0.012 * smooth(0.15, 0.222, zr) * (1 + x * s * 18) : 0);
      pts.push(V(A.x + x + s * 0.004, A.y + ground + yy, A.z + zz));
    }
    return { pts, v: zr, mat: 'shoe', zr };
  });
  const matOf = (i, j) => {
    const p = rows[i].pts[j];
    const yy = p.y - (A.y + ground);
    if (yy < 0.014) return 'sole';
    if (yy < 0.02 && rows[i].zr > -0.07 && rows[i].zr < 0.2) return 'accent';
    return 'shoe';
  };
  const w = (zr) => {
    const t = smooth(0.09, 0.16, zr);
    return { ['foot' + sd]: 1 - t, ['toe' + sd]: t };
  };
  loft(B, rows, { weight: (p, i, j, r) => w(r ? r.zr ?? 0 : 0), matOf, capA: 'shoe', capB: 'shoe', uLen: 0.3 });
  // 신발 끈
  for (let k = 0; k < 4; k++) {
    const zr = 0.012 + k * 0.022;
    const h = pl(SHOE_H, zr);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.32, 0, 0));
    box(B, 'white', V(A.x + s * 0.004, A.y + ground + h + 0.0015, A.z + zr), [0.034, 0.003, 0.006], q, w(zr));
  }
}

// ---------- 머리 ----------
function headLocal(th, ph) {
  const st = Math.sin(th);
  const dy = Math.cos(th);
  const dx = st * Math.sin(ph);
  const dz = st * Math.cos(ph);
  // 정수리 쪽은 달걀처럼 좁아지지 않게 조금 더 둥글고 넓게
  const full = smooth(0.0, 0.55, dy);
  const stF = st + 0.32 * full * st * (1 - st);
  let x = stF * Math.sin(ph) * 0.0745;
  let y = dy * (dy > 0 ? 0.116 : 0.106);
  let z = stF * Math.cos(ph) * (dz > 0 ? 0.094 : 0.104);
  // 뒤통수 볼륨
  if (z < 0) z -= 0.006 * gauss(y - 0.02, 0.045) * -dz;
  // 아래턱: 앞 아래쪽을 좁히고, 턱 밑을 목 쪽으로 올립니다
  const low = smooth(0.0, -0.1, y);
  x *= 1 - 0.27 * low * smooth(-0.02, 0.07, z) - 0.12 * low * smooth(0.0, -0.06, z);
  if (y < -0.045) {
    const jaw = lerp(-0.108, -0.075, smooth(0.07, 0.0, z)) + 0.022 * smooth(0.0, -0.03, z) + 0.008 * smooth(0.03, 0.065, Math.abs(x)) * smooth(0.06, 0.0, z);
    const k = 0.006;
    y = 0.5 * (y + jaw + Math.sqrt((y - jaw) * (y - jaw) + k * k)); // 부드러운 max
  }
  // 얼굴 앞면을 평평하게
  if (z > 0) {
    const zf = pl([[-0.112, 0.058], [-0.102, 0.08], [-0.089, 0.089], [-0.07, 0.091], [-0.051, 0.094], [-0.03, 0.092], [0.0, 0.088], [0.012, 0.086], [0.03, 0.092], [0.05, 0.09], [0.075, 0.078], [0.1, 0.05]], y) - x * x * 6.2;
    const k = 0.007;
    z = 0.5 * (z + zf - Math.sqrt((z - zf) * (z - zf) + k * k)); // 부드러운 min
    const f = smooth(0.02, 0.07, z);
    const ax = Math.abs(x);
    let dzf = 0;
    dzf += 0.0055 * gauss(y - 0.028, 0.011) * gauss(x, 0.055); // 눈썹뼈
    dzf -= 0.0105 * gauss(y - 0.013, 0.0125) * gauss(ax - 0.031, 0.0165); // 눈구멍
    // 코
    const nb = smooth(0.022, -0.03, y);
    let np = lerp(0.002, 0.0175, nb);
    np *= 1 - 0.86 * smooth(-0.029, -0.043, y);
    const nw = lerp(0.008, 0.0135, nb);
    dzf += np * gauss(x, nw) * (y < 0.03 ? 1 : 0) * smooth(-0.05, -0.04, y);
    dzf += 0.0065 * gauss(y + 0.034, 0.0075) * gauss(ax - 0.0135, 0.0068); // 콧방울
    dzf += 0.0042 * gauss(y + 0.0465, 0.006) * gauss(x, 0.02); // 윗입술
    dzf += 0.0048 * gauss(y + 0.0605, 0.0056) * gauss(x, 0.019); // 아랫입술
    dzf -= 0.0032 * gauss(y + 0.0537, 0.0022) * gauss(x, 0.024); // 입술 사이
    dzf -= 0.0022 * gauss(y + 0.054, 0.006) * gauss(ax - 0.026, 0.005); // 입꼬리
    dzf -= 0.0022 * gauss(y + 0.072, 0.006) * gauss(x, 0.025); // 입술 아래 오목
    dzf += 0.0085 * gauss(y + 0.089, 0.012) * gauss(x, 0.026); // 턱끝
    dzf += 0.0055 * gauss(y + 0.002, 0.018) * gauss(ax - 0.052, 0.018); // 광대
    z += dzf * f;
    x += Math.sign(x) * 0.004 * gauss(y + 0.002, 0.02) * gauss(z - 0.055, 0.03); // 광대 옆
  }
  return V(x, y, z);
}
function headPoint(th, ph, off = 0) {
  const p = headLocal(th, ph);
  if (off) {
    const e = 0.003;
    const a = headLocal(th + e, ph);
    const b = headLocal(th, ph + e);
    const n = V().subVectors(a, p).cross(V().subVectors(b, p)).normalize();
    if (n.dot(p) < 0) n.negate();
    p.addScaledVector(n, off);
  }
  return p.add(HC);
}
const headW = (p) => {
  const ly = p.y - HC.y;
  const lz = p.z - HC.z;
  const nape = smooth(-0.05, -0.085, ly) * smooth(-0.02, -0.06, lz);
  return { head: 1 - 0.45 * nape, neck: 0.45 * nape };
};
const azim = (ph) => Math.abs(((((ph + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI); // 앞에서 떨어진 각
const capBand = (ph) => {
  const a = azim(ph);
  return (0.33 + 0.13 * (1 - Math.cos(a)) * 0.5) * Math.PI;
};
const hairLine = (ph) => {
  const a = azim(ph);
  return pl([[0.8, 0.4], [1.0, 0.545], [1.14, 0.55], [1.3, 0.44], [1.72, 0.455], [2.1, 0.57], [Math.PI, 0.635]], a) * Math.PI;
};
function buildHead(B) {
  // 머리통(얼굴 텍스처를 쓰는 피부)
  grid(B, 96, 72, (u, v) => headPoint(v * Math.PI, u * Math.PI * 2), { closed: true, mat: 'face', weight: headW, center: HC, uv: (u, v) => [u, 1 - v] });
  // 귀
  for (const s of [1, -1]) {
    const c = HC.clone().add(V(s * 0.0738, -0.001, -0.008));
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, s * 0.32, s * 0.06, 'YXZ'));
    grid(B, 28, 20, (u, v) => {
      const th = v * Math.PI;
      const ph = u * Math.PI * 2;
      const dy = Math.cos(th);
      const dz = Math.sin(th) * Math.cos(ph);
      const dx = Math.sin(th) * Math.sin(ph);
      let y = dy * 0.031;
      let zz = dz * 0.0185 * (1 - 0.35 * smooth(0, -1, dy)) * (1 + 0.1 * smooth(0, 1, dy));
      let x = dx * 0.0085;
      const r2 = (y / 0.025) ** 2 + (zz / 0.0145) ** 2;
      if (dx > 0) x -= 0.0092 * Math.max(0, 1 - r2) * (dx > 0 ? 1 : 0);
      return V(s * x, y, zz).applyQuaternion(q).add(c);
    }, { closed: true, mat: 'skin', weight: () => ({ head: 1 }), outward: (p) => V().subVectors(p, c) });
  }
  // 눈
  for (const s of [1, -1]) {
    const c = HC.clone().add(V(s * 0.031, 0.0135, 0.0655));
    grid(B, 24, 16, (u, v) => {
      const th = v * Math.PI;
      const ph = u * Math.PI * 2;
      return c.clone().add(V(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)).multiplyScalar(0.0118));
    }, { closed: true, mat: 'eye', weight: () => ({ head: 1 }), center: c, uv: (u, v) => [u, 1 - v] });
    // 눈꺼풀(위·아래)
    const rl = 0.0128;
    const lid = (upper) => {
      const pts = grid(B, 18, 7, (u, v) => {
        const b = (u - 0.5) * 2 * 1.92;
        const edge = (upper ? 60 : 70) + (upper ? 16 : 10) * (b / 1.92) ** 2;
        const a = v * edge * RD;
        const r = v > 0.99 ? rl - 0.0008 : rl;
        const yy = Math.cos(a) * (upper ? 1 : -1);
        return c.clone().add(V(Math.sin(a) * Math.sin(b), yy, Math.sin(a) * Math.cos(b)).multiplyScalar(r));
      }, { mat: 'skin', weight: () => ({ head: 1 }), center: c });
      return pts[pts.length - 1];
    };
    const edgeU = lid(true);
    lid(false);
    // 속눈썹 선
    tube(B, 'lash', edgeU.filter((_, i) => i % 2 === 0).map((p) => p.clone().addScaledVector(V().subVectors(p, c).normalize(), 0.0005)), () => 0.00075, { N: 5, weight: () => ({ head: 1 }), roundEnd: false });
    // 눈썹
    const brow = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const xx = s * lerp(0.013, 0.054, t);
      const yy = 0.031 + 0.007 * Math.sin(t * Math.PI * 0.9) - 0.004 * t;
      const th = Math.acos(clamp(yy / 0.116, -1, 1));
      const ph = Math.asin(clamp(xx / (0.0745 * Math.sin(th)), -1, 1));
      brow.push(headPoint(th, ph, 0.0015));
    }
    tube(B, 'brow', brow, (t) => lerp(0.0036, 0.0016, t), { N: 6, flat: 0.45, up: V(0, 0, 1), weight: () => ({ head: 1 }), roundStart: true });
  }
  // 머리카락(모자 밑 옆·뒤)
  {
    const a0 = 0.8;
    grid(B, 56, 14, (u, v) => {
      const ph = a0 + u * (Math.PI * 2 - a0 * 2);
      const tb = hairLine(ph);
      const th = lerp(0.1 * Math.PI, tb, v);
      const off = 0.0048 * (1 - smooth(0.7, 1.0, v)) + 0.0008;
      return headPoint(th, ph, off);
    }, { mat: 'hair', weight: headW, outward: (p) => V().subVectors(p, HC), uv: (u, v) => [u * 6, v] });
  }
  // 모자
  {
    const crown = (u, v, extra = 0) => {
      const ph = u * Math.PI * 2;
      const tc = capBand(ph);
      const th = v * tc;
      const a = azim(ph);
      const off = 0.0085 + 0.0085 * (1 - v * v) * (1 + 0.35 * ((1 + Math.cos(a)) / 2) ** 2 * Math.sin((v * Math.PI) / 2)) + extra;
      return headPoint(th, ph, off);
    };
    grid(B, 64, 18, (u, v) => crown(u, v), { closed: true, mat: 'cap', weight: () => ({ head: 1 }), center: HC, uv: (u, v) => [u, 1 - v] });
    // 아래 테(안쪽으로 접힘)
    const rows = [];
    for (const [off, inward] of [[0.009, 0], [0.0045, 0.001], [0.0005, 0.002]]) {
      rows.push({ pts: Array.from({ length: 64 }, (_, i) => { const ph = (i / 64) * Math.PI * 2; return headPoint(capBand(ph) + inward, ph, off); }), v: 0, mat: 'capUnder' });
    }
    loft(B, rows, { weight: () => ({ head: 1 }), inside: false });
    // 단추
    const top = headPoint(0, 0, 0.0185);
    disc(B, 'cap', top.clone().add(V(0, -0.002, 0)), 0.0085, 0.004, new THREE.Quaternion(), { head: 1 });
    // 챙
    const NB = 26;
    const inner = [];
    const outer = [];
    for (let i = 0; i <= NB; i++) {
      const ph = (-1 + (2 * i) / NB) * 1.04;
      const I = headPoint(capBand(ph) + 0.01, ph, 0.006);
      const rad = V(I.x - HC.x, 0, I.z - HC.z).normalize();
      const len = 0.07 * Math.pow(Math.cos(ph * 0.95), 0.75) + 0.005;
      const droop = 0.009 + 0.022 * Math.sin(ph) ** 2;
      inner.push(I);
      outer.push(I.clone().addScaledVector(rad, len).add(V(0, -droop, 0)));
    }
    const brimRows = (dy) => {
      const out = [];
      for (let k = 0; k <= 4; k++) {
        const f = k / 4;
        out.push(inner.map((p, i) => p.clone().lerp(outer[i], f).add(V(0, dy - 0.006 * Math.sin(f * Math.PI) * 0.6, 0))));
      }
      return out;
    };
    const topR = brimRows(0.0025);
    const botR = brimRows(-0.0025);
    const sgT = SG++;
    const sgB = SG++;
    const idsT = topR.map((r) => r.map((p) => B.v(p, 0.09, 0.5, { head: 1 }, sgT)));
    const idsB = botR.map((r) => r.map((p, i) => B.v(p, i / NB, 0, { head: 1 }, sgB)));
    for (let k = 0; k < 4; k++) {
      for (let i = 0; i < NB; i++) {
        // 위면은 위를, 아랫면은 아래를 보게
        const p0 = topR[k][i];
        const nn = V().subVectors(topR[k][i + 1], p0).cross(V().subVectors(topR[k + 1][i], p0));
        const up = nn.y > 0;
        const a = idsT[k][i];
        const b = idsT[k][i + 1];
        const c = idsT[k + 1][i + 1];
        const d = idsT[k + 1][i];
        if (up) {
          B.t('cap', a, b, c);
          B.t('cap', a, c, d);
        } else {
          B.t('cap', a, c, b);
          B.t('cap', a, d, c);
        }
        const a2 = idsB[k][i];
        const b2 = idsB[k][i + 1];
        const c2 = idsB[k + 1][i + 1];
        const d2 = idsB[k + 1][i];
        if (!up) {
          B.t('capUnder', a2, b2, c2);
          B.t('capUnder', a2, c2, d2);
        } else {
          B.t('capUnder', a2, c2, b2);
          B.t('capUnder', a2, d2, c2);
        }
      }
    }
    // 챙 가장자리
    const edge = [topR[4], botR[4]];
    const sgE = SG++;
    const ie = edge.map((r) => r.map((p) => B.v(p, 0, 0, { head: 1 }, sgE)));
    for (let i = 0; i < NB; i++) {
      const p0 = edge[0][i];
      const nn = V().subVectors(edge[0][i + 1], p0).cross(V().subVectors(edge[1][i], p0));
      const out = V().subVectors(p0, HC).setY(0);
      if (nn.dot(out) > 0) {
        B.t('cap', ie[0][i], ie[0][i + 1], ie[1][i + 1]);
        B.t('cap', ie[0][i], ie[1][i + 1], ie[1][i]);
      } else {
        B.t('cap', ie[0][i], ie[1][i + 1], ie[0][i + 1]);
        B.t('cap', ie[0][i], ie[1][i], ie[1][i + 1]);
      }
    }
  }
}

// ---------- 손 ----------
const FINGERS = [
  // 이름, 마디 시작(왼손 기준), 길이, 굵기
  { k: V(0.026, 0.09, 0.0), len: 0.094, r: 0.0098 },
  { k: V(0.008, 0.094, 0.0), len: 0.102, r: 0.0101 },
  { k: V(-0.01, 0.09, -0.001), len: 0.096, r: 0.0096 },
  { k: V(-0.026, 0.08, -0.002), len: 0.076, r: 0.0086 }
];
function palmRing(y, N, s, cuff) {
  const wx = pl([[-0.03, 0.03], [-0.005, 0.0275], [0, 0.025], [0.02, 0.033], [0.045, 0.0375], [0.07, 0.0398], [0.09, 0.0405]], y) + (cuff ? 0.004 : 0);
  const tz = pl([[-0.03, 0.024], [-0.005, 0.0215], [0, 0.0195], [0.02, 0.0172], [0.045, 0.0148], [0.07, 0.0136], [0.09, 0.0128]], y) + (cuff ? 0.0035 : 0);
  const sq = smooth(0.0, 0.025, y); // 손목은 타원, 손바닥은 둥근 사각
  const pts = [];
  for (let j = 0; j < N; j++) {
    const a = (j / N) * Math.PI * 2;
    const e = lerp(1, 2 / 3, sq);
    let x = wx * sgnpow(Math.cos(a), e);
    let z = -tz * sgnpow(Math.sin(a), e);
    // 엄지 두덩(손바닥 쪽, 엄지 쪽)
    if (z < 0) z -= 0.0075 * gauss(y - 0.026, 0.02) * gauss(x - 0.02, 0.015);
    // 손등은 살짝 볼록
    if (z > 0) z += 0.002 * Math.cos(a * 0.5) ** 2 * sq;
    pts.push(V(s * x, y, z));
  }
  return pts;
}
function buildHand(B, sd, gloved) {
  const s = sd === 'L' ? 1 : -1;
  const H = HAND[sd];
  const wrist = BIND['hand' + sd];
  const toBind = (p) => p.clone().applyQuaternion(H.Qb).add(wrist);
  const mat = gloved ? 'glove' : 'skin';
  const handW = (yc) => {
    if (yc >= 0.02) return { ['hand' + sd]: 1 };
    const base = armW(L_UP + L_FORE + Math.min(0, yc), sd);
    const k = smooth(0, 0.02, yc);
    const out = {};
    for (const key in base) out[key] = base[key] * (1 - k);
    out['hand' + sd] = (out['hand' + sd] || 0) + k;
    return out;
  };
  const N = 26;
  const ys = gloved ? [-0.034, -0.03, -0.012, -0.008, 0.0, 0.01, 0.02, 0.035, 0.05, 0.065, 0.078, 0.088, 0.094] : [0, 0.01, 0.02, 0.035, 0.05, 0.065, 0.078, 0.088, 0.094];
  const rows = ys.map((y, i) => {
    const cuff = gloved && y <= -0.008;
    let pts = palmRing(y, N, s, cuff);
    if (y > 0.088) pts = pts.map((p) => V(p.x * 0.92, p.y, p.z * 0.75));
    return { pts: pts.map(toBind), v: y, mat: gloved && y >= -0.012 && y < -0.008 ? 'glove' : mat, split: gloved && (y === -0.012 || y === -0.008), yc: y };
  });
  loft(B, rows, { weight: (p, i, j, r) => handW(r ? r.yc : 0.09), capB: mat, capA: gloved ? mat : undefined, uLen: 0.12 });
  // 손가락: 그립 축을 감싸며 말립니다
  const sH = H.sH;
  const g0 = H.g0;
  for (const f of FINGERS) {
    const K = V(s * f.k.x, f.k.y, f.k.z);
    const along = V().subVectors(K, g0).dot(sH);
    const C = g0.clone().addScaledVector(sH, along);
    const r0 = V().subVectors(K, C);
    const rho0 = r0.length();
    r0.normalize();
    const R = GRIP_R + f.r * 0.92;
    // 감는 방향: 처음에 손가락 끝 쪽(+Y)으로 나아가야 합니다
    const t0 = V().crossVectors(sH, r0);
    const sign = t0.y > 0 ? 1 : -1;
    const pts = [K.clone().addScaledVector(V(0, -1, 0), 0.012)];
    let acc = 0;
    let ang = 0;
    const step = 0.08;
    let prev = K.clone();
    pts.push(K.clone());
    while (acc < f.len) {
      ang += step;
      const rho = lerp(rho0, R, smooth(0, 1.1, ang));
      const p = C.clone().add(r0.clone().applyAxisAngle(sH, sign * ang).multiplyScalar(rho));
      acc += p.distanceTo(prev);
      prev = p;
      if (Math.round(ang / step) % 3 === 0) pts.push(p);
    }
    pts.push(prev);
    const fr = f.r * (gloved ? 1.06 : 1);
    tube(B, mat, pts.map(toBind), (t) => fr * lerp(1, 0.8, t) * (1 + 0.06 * gauss(t - 0.42, 0.06) + 0.05 * gauss(t - 0.7, 0.05)), { N: 12, weight: () => ({ ['hand' + sd]: 1 }) });
  }
  // 엄지: 그립 윗면을 따라 헤드 쪽으로
  {
    const top = V(s * 0.62, -0.78, 0).normalize();
    const qt = top.clone().multiplyScalar(Math.cos(25 * RD)).add(V(0, 0, -Math.sin(25 * RD))).normalize();
    const line = (tau) => g0.clone().addScaledVector(sH, tau).addScaledVector(qt, GRIP_R + 0.0098);
    const T0 = V(s * 0.022, 0.006, -0.008);
    const T1 = V(s * 0.04, 0.036, -0.018);
    const pts = [T0, T1, line(0.03), line(0.045), line(0.056)];
    tube(B, mat, pts.map(toBind), (t) => (gloved ? 1.06 : 1) * lerp(0.0135, 0.0088, t) * (1 + 0.05 * gauss(t - 0.55, 0.08)), { N: 12, weight: () => ({ ['hand' + sd]: 1 }), roundStart: true });
    if (!gloved) {
      // 엄지 손톱
      const tip = line(0.05);
      const nrm = qt.clone();
      const q = new THREE.Quaternion().setFromUnitVectors(Y, nrm.clone().applyQuaternion(H.Qb));
      disc(B, 'nail', toBind(tip.clone().addScaledVector(nrm, 0.0082)), 0.0052, 0.0008, q, { ['hand' + sd]: 1 });
    }
  }
  if (gloved) {
    // 장갑 손등 벨크로 탭과 점
    const q = new THREE.Quaternion().setFromUnitVectors(Y, Z.clone().applyQuaternion(H.Qb));
    disc(B, 'glove', toBind(V(s * -0.004, 0.012, 0.0215)), 0.016, 0.0022, q, { ['hand' + sd]: 1 });
    disc(B, 'accent', toBind(V(s * -0.004, 0.012, 0.0238)), 0.006, 0.0008, q, { ['hand' + sd]: 1 });
  }
}

// ---------- 텍스처 ----------
let SHARED = null;
function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}
function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// 높이 함수로 노멀 맵(반복)
function normalTex(size, hfn, strength) {
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) H[y * size + x] = hfn(x / size, y / size, x, y);
  const c = canvas(size, size, (g) => {
    const img = g.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = H[y * size + ((x + 1) % size)] - H[y * size + ((x - 1 + size) % size)];
        const dy = H[((y + 1) % size) * size + x] - H[((y - 1 + size) % size) * size + x];
        const nx = -dx * strength;
        const ny = dy * strength;
        const l = Math.hypot(nx, ny, 1);
        const k = (y * size + x) * 4;
        img.data[k] = ((nx / l) * 0.5 + 0.5) * 255;
        img.data[k + 1] = ((ny / l) * 0.5 + 0.5) * 255;
        img.data[k + 2] = ((1 / l) * 0.5 + 0.5) * 255;
        img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function sharedTextures() {
  if (SHARED) return SHARED;
  // 폴로 피케 조직: 작은 벌집 돌기
  const knit = normalTex(128, (u, v) => {
    const a = Math.cos(u * Math.PI * 2 * 16) * Math.cos(v * Math.PI * 2 * 16);
    const b = Math.cos((u + 1 / 32) * Math.PI * 2 * 16) * Math.cos((v + 1 / 32) * Math.PI * 2 * 16);
    return Math.max(a, b * 0.8);
  }, 1.6);
  knit.repeat.set(30, 30);
  // 바지 능직: 사선 골
  const twill = normalTex(128, (u, v, x, y) => Math.sin((u + v) * Math.PI * 2 * 24) * 0.6 + (hash(x, y) - 0.5) * 0.25, 1.2);
  twill.repeat.set(18, 18);
  // 가죽: 잔 오돌토돌
  const leather = normalTex(128, (u, v, x, y) => {
    let s = 0;
    for (const k of [1, 2, 4]) s += (hash(Math.floor(x / k), Math.floor(y / k)) - 0.5) / k;
    return s;
  }, 0.9);
  leather.repeat.set(30, 30);
  // 머리카락 결
  const hairN = normalTex(128, (u, v, x, y) => Math.sin(u * Math.PI * 2 * 40 + Math.sin(v * 9) * 2) * 0.5 + (hash(x, 0) - 0.5) * 0.8, 1.4);
  hairN.repeat.set(1, 1);
  // 얼굴 색(피부색에 곱하는 색조)
  const face = new THREE.CanvasTexture(canvas(1024, 640, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let j = 0; j < h; j++) {
      const th = ((j + 0.5) / h) * Math.PI;
      for (let i = 0; i < w; i++) {
        const u = (i + 0.5) / w;
        const p = headLocal(th, u * Math.PI * 2);
        const ax = Math.abs(p.x);
        let r = 1;
        let gg = 1;
        let b = 1;
        if (p.z > 0.04) {
          // 입술: 경계가 또렷한 붉은 입술(윗입술은 큐피드 활 모양), 입술 사이는 어두운 선
          const yy = p.y + 0.0537;
          const bow = 0.0016 * gauss(ax - 0.006, 0.004) - 0.0012 * gauss(ax, 0.0025);
          const halfW = 0.0245;
          const sideU = smooth(halfW, halfW - 0.006, ax);
          const upTop = 0.0072 * sideU + bow;
          const lowBot = 0.0095 * smooth(halfW - 0.002, halfW - 0.01, ax);
          const upper = smooth(upTop + 0.0007, upTop - 0.0007, yy) * smooth(-0.0004, 0.0006, yy) * smooth(halfW + 0.0005, halfW - 0.001, ax);
          const lower = smooth(-lowBot - 0.0008, -lowBot + 0.0008, yy) * smooth(0.0004, -0.0006, yy) * smooth(halfW + 0.0005, halfW - 0.001, ax);
          const lip = Math.min(1, upper * 0.9 + lower);
          r -= 0.07 * lip;
          gg -= 0.24 * lip;
          b -= 0.2 * lip;
          const line = gauss(yy, 0.00065) * smooth(halfW + 0.002, halfW - 0.004, ax);
          r -= 0.32 * line;
          gg -= 0.36 * line;
          b -= 0.34 * line;
          // 볼 홍조, 코끝
          const blush = gauss(p.y + 0.012, 0.022) * gauss(ax - 0.047, 0.022) + 0.6 * gauss(p.y + 0.028, 0.01) * gauss(p.x, 0.012);
          gg -= 0.06 * blush;
          b -= 0.05 * blush;
          // 눈두덩 그늘
          const lidS = gauss(p.y - 0.022, 0.009) * gauss(ax - 0.031, 0.02);
          r -= 0.08 * lidS;
          gg -= 0.1 * lidS;
          b -= 0.08 * lidS;
        }
        // 면도 자국(턱·윗입술)
        const beard = smooth(-0.035, -0.06, p.y) * smooth(-0.02, 0.03, p.z) * (1 - smooth(-0.075, -0.1, p.y) * 0.3);
        const lipMask = gauss(p.y + 0.054, 0.014) * smooth(0.03, 0.02, ax);
        const bd = beard * (1 - lipMask) * 0.6;
        r -= 0.035 * bd;
        gg -= 0.03 * bd;
        b -= 0.012 * bd;
        const n = (hash(i, j) - 0.5) * 0.025;
        const k = (j * w + i) * 4;
        img.data[k] = clamp(r + n, 0, 1) * 255;
        img.data[k + 1] = clamp(gg + n, 0, 1) * 255;
        img.data[k + 2] = clamp(b + n, 0, 1) * 255;
        img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }));
  face.colorSpace = THREE.SRGBColorSpace;
  face.anisotropy = 4;
  // 눈알: 앞쪽 극에 동공·홍채
  const eye = new THREE.CanvasTexture(canvas(512, 256, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let j = 0; j < h; j++) {
      const v = (j + 0.5) / h; // 0 = 앞
      for (let i = 0; i < w; i++) {
        const u = (i + 0.5) / w;
        let c;
        if (v < 0.062) c = [12, 10, 9];
        else if (v < 0.175) {
          const t = (v - 0.062) / 0.113;
          const streak = 0.85 + 0.3 * hash(Math.floor(u * 90), 3);
          c = [lerp(58, 96, t) * streak, lerp(38, 62, t) * streak, lerp(22, 34, t) * streak];
        } else if (v < 0.19) c = [40, 30, 24];
        else {
          const t = smooth(0.19, 0.5, v);
          c = [lerp(236, 214, t), lerp(230, 196, t), lerp(222, 190, t)];
        }
        const k = (j * w + i) * 4;
        img.data[k] = c[0];
        img.data[k + 1] = c[1];
        img.data[k + 2] = c[2];
        img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }));
  eye.colorSpace = THREE.SRGBColorSpace;
  SHARED = { knit, twill, leather, hairN, face, eye };
  return SHARED;
}
// 모자 무늬(선수 색 바탕, 이음 바늘땀, 앞 로고)
function capTexture(color) {
  const c = new THREE.Color(color);
  const css = (k) => `rgb(${Math.round(Math.min(1, c.r * k) * 255)},${Math.round(Math.min(1, c.g * k) * 255)},${Math.round(Math.min(1, c.b * k) * 255)})`;
  const t = new THREE.CanvasTexture(canvas(1024, 256, (g, w, h) => {
    g.fillStyle = css(1);
    g.fillRect(0, 0, w, h);
    // 이음선(앞 가운데 빼고)
    g.lineWidth = 3;
    for (const k of [1, 2, 3, 4, 5]) {
      const x = (k / 6) * w;
      g.strokeStyle = css(0.6);
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
      g.strokeStyle = css(1.35);
      g.setLineDash([5, 5]);
      g.lineWidth = 1.5;
      for (const o of [-7, 7]) {
        g.beginPath();
        g.moveTo(x + o, 20);
        g.lineTo(x + o, h);
        g.stroke();
      }
      g.setLineDash([]);
      g.lineWidth = 3;
    }
    // 아래 테 바늘땀
    g.strokeStyle = css(1.4);
    g.setLineDash([6, 5]);
    g.lineWidth = 1.5;
    for (const y of [h * 0.86, h * 0.9]) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    g.setLineDash([]);
    // 앞 로고: 흰 깃발과 공
    const cx = 0;
    const cy = h * 0.6;
    for (const ox of [cx, w]) {
      g.save();
      g.translate(ox, cy);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(0, 18, 13, 0, Math.PI * 2);
      g.fill();
      g.fillRect(-2, -40, 4, 52);
      g.beginPath();
      g.moveTo(2, -40);
      g.lineTo(34, -30);
      g.lineTo(2, -18);
      g.closePath();
      g.fill();
      g.restore();
    }
  }));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------- 재질 ----------
function makeMaterials(o) {
  const T = sharedTextures();
  const pc = new THREE.Color(o.color);
  const lighten = (c, k) => new THREE.Color(c).lerp(new THREE.Color('#ffffff'), k);
  const darken = (c, k) => new THREE.Color(c).multiplyScalar(k);
  const N2 = (k) => new THREE.Vector2(k, k);
  const skinP = { color: o.skin, roughness: 0.5, sheen: 0.35, sheenColor: new THREE.Color('#ff8a6c'), sheenRoughness: 0.5, clearcoat: 0.04, clearcoatRoughness: 0.6 };
  const capTex = capTexture(o.color);
  const M = {
    skin: new THREE.MeshPhysicalMaterial(skinP),
    face: new THREE.MeshPhysicalMaterial({ ...skinP, map: T.face }),
    nail: new THREE.MeshStandardMaterial({ color: lighten(o.skin, 0.35), roughness: 0.3 }),
    shirt: new THREE.MeshPhysicalMaterial({ color: pc, roughness: 0.78, sheen: 0.7, sheenColor: lighten(pc, 0.5), sheenRoughness: 0.45, normalMap: T.knit, normalScale: N2(0.55) }),
    shirtIn: new THREE.MeshStandardMaterial({ color: darken(pc, 0.55), roughness: 0.9 }),
    collar: new THREE.MeshPhysicalMaterial({ color: pc, roughness: 0.78, sheen: 0.7, sheenColor: lighten(pc, 0.5), sheenRoughness: 0.45, normalMap: T.knit, normalScale: N2(0.4), side: THREE.DoubleSide }),
    pants: new THREE.MeshPhysicalMaterial({ color: o.pants, roughness: 0.72, sheen: 0.45, sheenColor: lighten(o.pants, 0.35), sheenRoughness: 0.5, normalMap: T.twill, normalScale: N2(0.35) }),
    pantsIn: new THREE.MeshStandardMaterial({ color: darken(o.pants, 0.5), roughness: 0.9 }),
    belt: new THREE.MeshStandardMaterial({ color: '#17181b', roughness: 0.38, normalMap: T.leather, normalScale: N2(0.3) }),
    metal: new THREE.MeshStandardMaterial({ color: '#dfe2e6', roughness: 0.2, metalness: 1 }),
    shoe: new THREE.MeshPhysicalMaterial({ color: '#f3f3f1', roughness: 0.36, clearcoat: 0.45, clearcoatRoughness: 0.3, normalMap: T.leather, normalScale: N2(0.2) }),
    sole: new THREE.MeshStandardMaterial({ color: '#2b2e33', roughness: 0.62 }),
    accent: new THREE.MeshStandardMaterial({ color: pc, roughness: 0.45 }),
    white: new THREE.MeshStandardMaterial({ color: '#fafafa', roughness: 0.55 }),
    glove: new THREE.MeshPhysicalMaterial({ color: '#f6f6f2', roughness: 0.55, sheen: 0.4, sheenColor: new THREE.Color('#ffffff'), sheenRoughness: 0.6, normalMap: T.leather, normalScale: N2(0.35) }),
    hair: new THREE.MeshStandardMaterial({ color: o.hair, roughness: 0.72, normalMap: T.hairN, normalScale: N2(0.6) }),
    brow: new THREE.MeshStandardMaterial({ color: darken(o.hair, 0.85), roughness: 0.85 }),
    lash: new THREE.MeshStandardMaterial({ color: '#16100c', roughness: 0.9 }),
    eye: new THREE.MeshPhysicalMaterial({ map: T.eye, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05 }),
    cap: new THREE.MeshPhysicalMaterial({ map: capTex, roughness: 0.82, sheen: 0.5, sheenColor: lighten(pc, 0.4), sheenRoughness: 0.5, normalMap: T.twill, normalScale: N2(0.25) }),
    capUnder: new THREE.MeshStandardMaterial({ color: darken(pc, 0.35), roughness: 0.85 })
  };
  for (const k in M) M[k].name = k;
  return { M, own: [capTex] };
}

// ---------- 클럽 모델 ----------
// 클럽 좌표: 원점은 그립 끝, +Y 가 샤프트를 따라 헤드 쪽, +Z 가 페이스 정면(로프트 전), +X = Y × Z.
// 어드레스에서 헤드 바닥이 땅에 닿을 때 샤프트 축이 땅을 만나는 점이 (0, lengthM, 0) 입니다.
const clubMatCache = new Map();
function clubMats(color) {
  const key = String(color);
  if (clubMatCache.has(key)) return clubMatCache.get(key);
  const pc = new THREE.Color(color);
  const M = {
    chrome: new THREE.MeshStandardMaterial({ color: '#dde1e6', metalness: 1, roughness: 0.16 }),
    satin: new THREE.MeshStandardMaterial({ color: '#c3c8cf', metalness: 1, roughness: 0.34 }),
    face: new THREE.MeshStandardMaterial({ color: '#9da3ab', metalness: 0.9, roughness: 0.4 }),
    dark: new THREE.MeshStandardMaterial({ color: '#2a2d33', metalness: 0.6, roughness: 0.35 }),
    crown: new THREE.MeshPhysicalMaterial({ color: '#141518', metalness: 0.3, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 }),
    groove: new THREE.MeshStandardMaterial({ color: '#4a4f57', metalness: 0.7, roughness: 0.5 }),
    grip: new THREE.MeshStandardMaterial({ color: '#1a1b1f', roughness: 0.88 }),
    gripBand: new THREE.MeshStandardMaterial({ color: '#4c5058', roughness: 0.8 }),
    graphite: new THREE.MeshPhysicalMaterial({ color: '#1d1f24', metalness: 0.2, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
    steel: new THREE.MeshStandardMaterial({ color: '#cfd3d9', metalness: 1, roughness: 0.22 }),
    ferrule: new THREE.MeshStandardMaterial({ color: '#0f1013', roughness: 0.35 }),
    accent: new THREE.MeshStandardMaterial({ color: pc, roughness: 0.38, metalness: 0.2 }),
    white: new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.4 })
  };
  clubMatCache.set(key, M);
  return M;
}
const mesh = (geo, mat) => {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
};
// 헤드 좌표: +X 힐(골퍼 쪽), +Y 위(땅 법선), +Z 목표. 원점은 샤프트 축이 땅에 닿는 점. 토는 -X 쪽.
function headFrameQ(lie) {
  const l = lie * RD;
  const toe = V(Math.sin(l), Math.cos(l), 0);
  const up = V(Math.cos(l), -Math.sin(l), 0);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(toe.clone().negate(), up, Z));
}
function hosel(M, lie, from, to, r0, r1) {
  const l = lie * RD;
  const ax = V(Math.cos(l), Math.sin(l), 0);
  const geo = new THREE.CylinderGeometry(r1, r0, to - from, 16);
  const m = mesh(geo, M.chrome);
  m.position.copy(ax.clone().multiplyScalar((from + to) / 2));
  m.quaternion.setFromUnitVectors(Y, ax);
  return m;
}
function ironHead(c, M) {
  const g = new THREE.Group();
  const wedge = c.kind === 'wedge';
  const toeH = wedge ? 0.056 : lerp(0.045, 0.051, (c.loft - 25) / 16);
  const heelH = toeH * 0.66;
  const len = wedge ? 0.074 : 0.077;
  // 앞에서 본 날 모양(힐 x=0, 토 x=-len)
  const s = new THREE.Shape();
  s.moveTo(0.004, 0.012);
  s.bezierCurveTo(0.0, 0.002, -0.01, 0.0, -0.02, 0.0);
  s.lineTo(-len + 0.012, 0.002);
  s.bezierCurveTo(-len - 0.003, 0.004, -len - 0.006, toeH * 0.6, -len + 0.004, toeH);
  s.bezierCurveTo(-len + 0.012, toeH + 0.004, -len * 0.55, toeH * 0.92, -0.012, heelH + 0.006);
  s.bezierCurveTo(-0.004, heelH + 0.002, 0.006, heelH * 0.7, 0.004, 0.012);
  const faceT = 0.0052;
  const blade = new THREE.ExtrudeGeometry(s, { depth: faceT, bevelEnabled: true, bevelThickness: 0.0016, bevelSize: 0.0015, bevelSegments: 3, curveSegments: 24 });
  blade.translate(0, 0, -faceT - 0.0016);
  const bl = new THREE.Group();
  bl.add(mesh(blade, M.chrome));
  // 뒷면 둘레 무게(캐비티)와 두꺼운 바닥
  const rim = new THREE.Shape();
  rim.moveTo(-0.004, 0.0);
  rim.lineTo(-len + 0.01, 0.002);
  rim.bezierCurveTo(-len - 0.002, 0.006, -len - 0.003, toeH * 0.55, -len + 0.006, toeH * 0.86);
  rim.lineTo(-len + 0.014, toeH * 0.78);
  rim.bezierCurveTo(-len + 0.008, toeH * 0.5, -len + 0.01, 0.018, -len + 0.02, 0.016);
  rim.lineTo(-0.012, 0.014);
  rim.bezierCurveTo(-0.006, 0.014, -0.004, 0.02, -0.002, 0.026);
  rim.lineTo(0.004, 0.02);
  rim.closePath();
  const rimDepth = wedge ? 0.012 : 0.0115;
  const rimGeo = new THREE.ExtrudeGeometry(rim, { depth: rimDepth, bevelEnabled: true, bevelThickness: 0.0025, bevelSize: 0.002, bevelSegments: 3, curveSegments: 16 });
  rimGeo.translate(0, 0, -faceT - rimDepth - 0.004);
  bl.add(mesh(rimGeo, M.satin));
  // 캐비티 배지(선수 색)
  const badge = new THREE.Shape();
  badge.moveTo(-0.016, 0.017);
  badge.lineTo(-len + 0.022, 0.019);
  badge.quadraticCurveTo(-len + 0.016, toeH * 0.5, -len + 0.02, toeH * 0.66);
  badge.lineTo(-0.02, heelH * 0.9);
  badge.closePath();
  const bg = new THREE.ExtrudeGeometry(badge, { depth: 0.0014, bevelEnabled: false, curveSegments: 10 });
  bg.translate(0, 0, -faceT - 0.0045);
  bl.add(mesh(bg, M.accent));
  // 페이스 홈
  const nG = wedge ? 12 : 9;
  for (let i = 0; i < nG; i++) {
    const y = 0.008 + i * ((toeH * 0.8 - 0.008) / nG);
    const w = len * (0.62 + 0.18 * (i / nG));
    const gr = new THREE.Mesh(new THREE.BoxGeometry(w, 0.0009, 0.0006), M.groove);
    gr.position.set(-len * 0.52, y, 0.0003);
    bl.add(gr);
  }
  // 로프트: 앞날(바닥 앞) 둘레로 뒤로 눕힙니다
  bl.rotation.x = -c.loft * RD;
  g.add(bl);
  g.add(hosel(M, c.lie, 0.012, 0.068, 0.0078, 0.0068));
  // 공이 맞는 자리(페이스 가운데)
  g.userData.sweet = V(-len * 0.5, toeH * 0.45, 0.0).applyAxisAngle(X, -c.loft * RD);
  return g;
}
function woodHead(c, M) {
  const g = new THREE.Group();
  const hybrid = c.kind === 'hybrid';
  const dims = c.id === '1W' ? [0.122, 0.116, 0.061] : c.id === '3W' ? [0.104, 0.09, 0.043] : c.id === '5W' ? [0.098, 0.084, 0.04] : [0.094, 0.068, 0.04];
  const [L, D, H] = dims;
  const loft = c.loft * RD;
  const nf = V(0, Math.sin(loft), Math.cos(loft)); // 페이스 법선
  const cx = -L * 0.5;
  const cy = H * 0.5;
  const cz = -D * 0.4;
  const nu = 72;
  const nv = 40;
  const pos = [];
  const onFace = [];
  for (let j = 0; j <= nv; j++) {
    const th = (j / nv) * Math.PI;
    for (let i = 0; i <= nu; i++) {
      const ph = (i / nu) * Math.PI * 2;
      const dx = Math.sin(th) * Math.sin(ph);
      const dy = Math.cos(th);
      const dz = Math.sin(th) * Math.cos(ph);
      const back = smooth(0.1, -1, dz);
      let x = cx + sgnpow(dx, 0.78) * L * 0.52 * (1 - 0.3 * back * (hybrid ? 0.6 : 1));
      let y = cy + (dy > 0 ? sgnpow(dy, 0.8) * H * 0.58 * lerp(1, 0.55, back) : sgnpow(dy, 0.45) * H * 0.5);
      let z = cz + sgnpow(dz, 0.8) * (dz > 0 ? D * 0.62 : D * 0.6);
      // 힐 쪽 목(호젤 자리)을 둥글게 세웁니다
      y += 0.006 * gauss(x - (-0.008), 0.012) * gauss(z + 0.012, 0.014) * (dy > 0 ? 1 : 0);
      const p = V(x, Math.max(y, 0.0008 + 0.0 * x), z);
      const dist = p.dot(nf);
      let f = false;
      if (dist > 0) {
        p.addScaledVector(nf, -dist);
        f = true;
      }
      pos.push(p);
      onFace.push(f);
    }
  }
  const geoC = [];
  const geoB = [];
  const geoF = [];
  const id = (i, j) => j * (nu + 1) + i;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = id(i, j);
      const b = id(i + 1, j);
      const cc = id(i + 1, j + 1);
      const d = id(i, j + 1);
      const quad = [a, b, cc, d];
      const allFace = quad.every((k) => onFace[k]);
      const cen = quad.reduce((s, k) => s.add(pos[k]), V()).multiplyScalar(0.25);
      const list = allFace ? geoF : cen.y > lerp(H * 0.56, H * 0.36, smooth(0, -D, cen.z)) ? geoC : geoB;
      list.push(a, d, cc, a, cc, b);
    }
  }
  const flat = new Float32Array(pos.length * 3);
  pos.forEach((p, k) => p.toArray(flat, k * 3));
  const mk = (index, mat) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(flat, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    return mesh(geo, mat);
  };
  g.add(mk(geoC, M.crown), mk(geoB, M.satin), mk(geoF, M.face));
  // 페이스 줄(가운데)
  const faceC = V(-L * 0.5, H * 0.46, 0);
  faceC.addScaledVector(nf, -faceC.dot(nf));
  const fq = new THREE.Quaternion().setFromUnitVectors(Z, nf);
  for (let i = 0; i < 7; i++) {
    const gr = new THREE.Mesh(new THREE.BoxGeometry(L * 0.42, 0.0008, 0.0005), M.groove);
    gr.position.copy(faceC).add(V(0, (i - 3) * H * 0.075, 0).applyQuaternion(fq));
    gr.quaternion.copy(fq);
    g.add(gr);
  }
  // 크라운 정렬 표시(선수 색), 바닥 무게추
  const mark = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.0012, 3), M.accent);
  mark.position.set(cx, H * 0.58 + cy - 0.002, -0.012);
  mark.rotation.y = Math.PI / 2;
  g.add(mark);
  const port = mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.003, 18), M.accent);
  port.position.set(cx + L * 0.12, 0.0015, cz - D * 0.3);
  g.add(port);
  // 호젤(어댑터 고리 포함)
  g.add(hosel(M, c.lie, 0.03, hybrid ? 0.068 : 0.075, 0.0085, 0.0074));
  const ring = hosel(M, c.lie, 0.062, 0.07, 0.0082, 0.0079);
  ring.material = M.dark;
  g.add(ring);
  g.userData.sweet = V(-L * 0.5, H * 0.48, 0).addScaledVector(nf, -V(-L * 0.5, H * 0.48, 0).dot(nf));
  return g;
}
function putterHead(c, M) {
  const g = new THREE.Group();
  // 반달 말렛: 위에서 본 모양을 높이만큼 밀어냅니다
  const s = new THREE.Shape();
  s.moveTo(-0.003, 0);
  s.lineTo(-0.107, 0);
  s.bezierCurveTo(-0.112, -0.03, -0.09, -0.07, -0.055, -0.072);
  s.bezierCurveTo(-0.02, -0.07, 0.002, -0.03, -0.003, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 4, curveSegments: 28 });
  // 모양은 XY 평면 → (x, z) 로 눕히고 높이를 +Y 로
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0.025, 0);
  const body = mesh(geo, M.satin);
  g.add(body);
  // 윗면 검은 칠과 흰 정렬선
  const topS = new THREE.Shape();
  topS.moveTo(-0.01, 0.006);
  topS.lineTo(-0.1, 0.006);
  topS.bezierCurveTo(-0.104, 0.03, -0.086, 0.062, -0.055, 0.064);
  topS.bezierCurveTo(-0.024, 0.062, -0.006, 0.03, -0.01, 0.006);
  const tg = new THREE.ShapeGeometry(topS, 24);
  tg.rotateX(-Math.PI / 2);
  tg.translate(0, 0.0254, 0);
  g.add(new THREE.Mesh(tg, M.dark));
  for (const dx of [-0.006, 0.006]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.0012, 0.05), M.white);
    line.position.set(-0.055 + dx, 0.0258, -0.032);
    g.add(line);
  }
  const dot = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.0012, 0.006), M.accent);
  dot.position.set(-0.055, 0.0259, -0.004);
  g.add(dot);
  // 페이스 인서트
  const ins = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.016, 0.002), M.dark);
  ins.position.set(-0.055, 0.0125, 0.0018);
  g.add(ins);
  // 꺾인 목(플러머 넥)
  const l = c.lie * RD;
  const ax = V(Math.cos(l), Math.sin(l), 0);
  const top = ax.clone().multiplyScalar(0.085);
  const path = new THREE.CatmullRomCurve3([V(-0.016, 0.026, -0.006), V(-0.016, 0.042, -0.006), V(-0.004, 0.05, -0.004), top.clone().addScaledVector(ax, -0.02), top]);
  g.add(mesh(new THREE.TubeGeometry(path, 20, 0.0046, 12, false), M.chrome));
  g.userData.sweet = V(-0.055, 0.013, 0.004);
  return g;
}
export function makeClubMesh(clubId = '7I', color = '#ff5a5f') {
  const c = clubById(clubId);
  const M = clubMats(color);
  const g = new THREE.Group();
  g.name = 'club-' + c.id;
  const putter = c.kind === 'putter';
  const woodish = c.kind === 'wood' || c.kind === 'hybrid';
  // 그립(위가 굵음)
  const gripLen = putter ? 0.26 : 0.27;
  const gripGeo = new THREE.CylinderGeometry(putter ? 0.0145 : 0.0124, putter ? 0.0112 : 0.0099, gripLen, 20, 8);
  if (putter) {
    // 퍼터 그립은 앞이 평평합니다
    const p = gripGeo.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getZ(i) > 0.006) p.setZ(i, 0.006 + (p.getZ(i) - 0.006) * 0.3);
    gripGeo.computeVertexNormals();
  }
  const grip = mesh(gripGeo, M.grip);
  grip.position.y = gripLen / 2;
  g.add(grip);
  for (const [y, h] of [[0.03, 0.006], [gripLen - 0.012, 0.012]]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(putter ? 0.0135 : 0.0117, putter ? 0.0135 : 0.0115, h, 20), M.gripBand);
    band.position.y = y;
    g.add(band);
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(putter ? 0.0148 : 0.0127, putter ? 0.0148 : 0.0127, 0.004, 20), M.grip);
  cap.position.y = 0.002;
  g.add(cap);
  const capDot = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.0008, 16), M.accent);
  capDot.position.y = -0.0002;
  g.add(capDot);
  // 샤프트
  const hoselTop = putter ? 0.085 : woodish ? (c.kind === 'hybrid' ? 0.068 : 0.075) : 0.068;
  const shaftEnd = c.lengthM - hoselTop;
  const shaftLen = shaftEnd - gripLen + 0.01;
  const shaft = mesh(new THREE.CylinderGeometry(0.0074, woodish ? 0.0046 : 0.0045, shaftLen, 14), woodish ? M.graphite : M.steel);
  shaft.position.y = gripLen - 0.01 + shaftLen / 2;
  g.add(shaft);
  if (woodish) {
    // 그래파이트 샤프트 무늬(선수 색 띠)
    const band = mesh(new THREE.CylinderGeometry(0.0071, 0.0068, 0.12, 14), M.accent);
    band.position.y = gripLen + 0.09;
    g.add(band);
  } else {
    // 스틸 샤프트 단(step)
    for (let k = 0; k < 6; k++) {
      const y = gripLen + 0.06 + k * 0.055;
      const t = (y - gripLen) / shaftLen;
      const r = lerp(0.0074, 0.0045, t) + 0.0004;
      const st = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.004, 14), M.steel);
      st.position.y = y;
      g.add(st);
    }
  }
  const fer = new THREE.Mesh(new THREE.CylinderGeometry(woodish ? 0.0062 : 0.0063, 0.0068, 0.016, 14), M.ferrule);
  fer.position.y = shaftEnd - 0.006;
  g.add(fer);
  // 헤드
  const head = putter ? putterHead(c, M) : woodish ? woodHead(c, M) : ironHead(c, M);
  head.position.set(0, c.lengthM, 0);
  head.quaternion.copy(headFrameQ(c.lie));
  g.add(head);
  head.updateMatrix();
  const sweet = head.userData.sweet.clone().applyMatrix4(head.matrix);
  g.userData = { id: c.id, lengthM: c.lengthM, lie: c.lie, loft: c.loft, kind: c.kind, sweet, club: c };
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return g;
}

// ---------- 스윙 키 자세(7번 아이언 기준) ----------
// u: 0 어드레스, 0.33 테이크어웨이(샤프트 수평), 0.67 리드 팔 수평, 1 탑, 1.3 다운(팔 수평), 1.6 다운(샤프트 수평·래그), 2 임팩트, 2.3 릴리스, 2.6 팔로스루, 3 피니시
// 각은 도. hip 골반 회전(+ 목표 쪽 열림), sh 어깨 회전(척추 축 둘레), tilt 척추 앞숙임, side 옆 기울기(+ 목표 반대),
// ptilt 골반 앞기울기, pside 골반 옆기울기(+ 리드 골반 위로), hx/hy/hz 골반 이동(m), clavL/clavR [앞으로, 위로],
// hands 리드 손 그립 위치(몸 좌표), shaft/face 기대 샤프트·페이스 방향, poleL/poleR 팔꿈치 방향, kneeL/kneeR 무릎 방향,
// look 0=공, 1=목표, tHeel 뒷발 뒤꿈치 들기, tYaw 뒷발 돌기, lHeel 앞발 뒤꿈치, lRoll 앞발 바깥으로 구르기
const KEYS_BASE = [
  { u: 0.0, lb: 9, hip: 0, sh: 0, tilt: 34, side: 12, ptilt: 20, pside: 0, hx: 0, hy: -0.052, hz: -0.075, clavL: [3, -2], clavR: [10, -6], hands: [0.03, 0.79, 0.33], shaft: [0, -1, 0.5], face: [1, 0, 0], poleL: [0.25, -0.2, -1], poleR: [-0.3, -0.45, -1], kneeL: [-0.08, 0, 1], kneeR: [0.08, 0, 1], look: 0, tHeel: 0, tYaw: 0, lHeel: 0, lRoll: 0 },
  { u: 0.33, lb: 4, hip: -13, sh: -40, tilt: 34, side: 10, ptilt: 20, pside: -2, hx: -0.012, hy: -0.052, hz: -0.072, clavL: [8, 0], clavR: [4, -2], hands: [-0.28, 0.94, 0.33], shaft: [-0.98, 0.08, 0.14], face: [0, 0.1, 1], poleL: [0.1, -0.6, -0.8], poleR: [-0.3, -1, -0.4], kneeL: [-0.2, 0, 1], kneeR: [0.05, 0, 1], look: 0, tHeel: 0, tYaw: 0, lHeel: 0, lRoll: 0 },
  { u: 0.67, lb: 5, hip: -32, sh: -74, tilt: 33, side: 6, ptilt: 19, pside: -4, hx: -0.015, hy: -0.053, hz: -0.07, clavL: [15, 4], clavR: [-2, 2], hands: [-0.4, 1.3, 0.17], shaft: [-0.25, 0.86, -0.44], face: [0.35, 0.45, 0.8], poleL: [0, -1, -0.3], poleR: [-0.1, -1, -0.1], kneeL: [-0.35, 0, 1], kneeR: [0.05, 0, 1], look: 0, tHeel: 0, tYaw: 0, lHeel: 2, lRoll: 0 },
  { u: 1.0, lb: 10, rb: 92, hip: -45, sh: -92, tilt: 33, side: 2, ptilt: 19, pside: -5, hx: -0.012, hy: -0.054, hz: -0.068, clavL: [18, 8], clavR: [-6, 6], hands: [-0.24, 1.58, -0.02], shaft: [0.97, -0.15, -0.1], face: [-0.05, 0.7, 0.7], poleL: [0, -1, 0.2], poleR: [0.1, -1, 0.2], kneeL: [-0.45, 0, 1], kneeR: [0.05, 0, 1], look: 0, tHeel: 0, tYaw: 0, lHeel: 4, lRoll: 0 },
  { u: 1.3, lb: 7, hip: -18, sh: -62, tilt: 34, side: 14, ptilt: 19, pside: -1, hx: 0.05, hy: -0.06, hz: -0.07, clavL: [12, 4], clavR: [2, -2], hands: [-0.36, 1.24, 0.14], shaft: [-0.08, 0.8, -0.6], face: [0.3, 0.35, 0.85], poleL: [0, -1, -0.2], poleR: [0, -1, -0.1], kneeL: [-0.15, 0, 1], kneeR: [0.2, 0, 1], look: 0, tHeel: 0, tYaw: 0, lHeel: 0, lRoll: 0 },
  { u: 1.6, lb: 5, hip: 12, sh: -28, tilt: 34, side: 20, ptilt: 18, pside: 3, hx: 0.08, hy: -0.058, hz: -0.07, clavL: [6, 0], clavR: [8, -4], hands: [-0.2, 0.94, 0.3], shaft: [-0.96, 0.2, 0.06], face: [0.1, 0.15, 1], poleL: [0.2, -0.5, -0.9], poleR: [0, -1, -0.3], kneeL: [0.05, 0, 1], kneeR: [0.35, 0, 1], look: 0, tHeel: 4, tYaw: 0, lHeel: 0, lRoll: 0 },
  { u: 2.0, lb: 3, hip: 40, sh: 14, tilt: 33, side: 23, ptilt: 17, pside: 8, hx: 0.1, hy: -0.044, hz: -0.065, clavL: [2, 0], clavR: [2, -1], hands: [0.09, 0.82, 0.35], shaft: [0, -1, 0.5], face: [1, 0, 0], poleL: [0.4, -0.2, -1], poleR: [-0.2, -0.6, -1], kneeL: [0.15, 0, 1], kneeR: [0.55, 0, 1], look: 0, tHeel: 14, tYaw: 4, lHeel: 0, lRoll: -3 },
  { u: 2.3, lb: 4, rb: 8, hip: 60, sh: 55, tilt: 29, side: 25, ptilt: 15, pside: 8, hx: 0.12, hy: -0.04, hz: -0.06, clavL: [4, 4], clavR: [18, -2], hands: [0.36, 0.96, 0.3], shaft: [0.97, 0.12, 0.18], face: [0, 0.2, -1], poleL: [0.5, -0.8, -0.3], poleR: [0.2, -0.4, -1], kneeL: [0.3, 0, 1], kneeR: [0.75, 0, 0.8], look: 0.12, tHeel: 32, tYaw: 18, lHeel: 0, lRoll: -6 },
  { u: 2.6, rb: 16, hip: 78, sh: 85, tilt: 19, side: 18, ptilt: 12, pside: 6, hx: 0.135, hy: -0.03, hz: -0.045, clavL: [2, 10], clavR: [20, 4], hands: [0.4, 1.32, 0.1], shaft: [0.3, 0.86, -0.4], face: [-0.4, 0.3, -0.85], poleL: [0.2, -1, 0], poleR: [0.6, -0.6, -0.4], kneeL: [0.5, 0, 0.9], kneeR: [0.95, 0, 0.5], look: 0.7, tHeel: 55, tYaw: 45, lHeel: 0, lRoll: -9 },
  { u: 3.0, lb: 95, hip: 90, sh: 106, tilt: 7, side: 10, ptilt: 8, pside: 4, hx: 0.15, hy: -0.016, hz: -0.025, clavL: [-4, 18], clavR: [18, 8], hands: [0.12, 1.62, -0.14], shaft: [-0.45, -0.4, -0.8], face: [-0.8, 0.3, 0.5], poleL: [0, -1, 0.3], poleR: [0.5, -1, 0], kneeL: [0.7, 0, 0.7], kneeR: [1, -0.1, 0.3], look: 1, tHeel: 72, tYaw: 68, lHeel: 0, lRoll: -12 }
];

// 클럽마다 서는 법(발 너비, 숙임, 손 위치, 공 위치)을 바꿔 키를 다시 만듭니다.
function stanceFor(club) {
  const c = club;
  if (c.kind === 'putter') return { putter: true, half: 0.15, leadYaw: 10, trailYaw: -6 };
  const k = clamp((c.lengthM - 0.889) / (1.143 - 0.889), 0, 1);
  return {
    k,
    half: lerp(0.17, 0.255, k),
    leadYaw: lerp(18, 24, k),
    trailYaw: lerp(-6, -10, k),
    dTilt: lerp(3, -4.5, k),
    dSide: lerp(-2, 3.5, k),
    hands: [lerp(0.035, -0.005, k), lerp(0.78, 0.855, k), lerp(0.32, 0.37, k)],
    lean: lerp(-0.11, 0.035, k),
    impLean: lerp(-0.2, -0.02, k)
  };
}

// ---------- 골퍼 ----------
const SKIN_TONES = ['#e8b996', '#d9a47f', '#c08a64', '#9c6a48', '#f0c8a8'];
export function makeGolfer(opts = {}) {
  const o = {
    color: opts.color || '#ff5a5f',
    skin: opts.skin || SKIN_TONES[0],
    hair: opts.hair || '#2b1d14',
    pants: opts.pants || '#2c3441',
    hand: opts.hand === 'left' ? 'left' : 'right'
  };
  const root = new THREE.Group();
  root.name = 'golfer';
  const body = new THREE.Group(); // 왼손잡이는 이 그룹을 X 로 뒤집습니다
  root.add(body);

  // 뼈
  const bones = {};
  for (const n of BONE_NAMES) {
    const b = new THREE.Bone();
    b.name = n;
    bones[n] = b;
  }
  for (const n of BONE_NAMES) {
    if (n === 'root') continue;
    const p = PARENT[n];
    bones[p].add(bones[n]);
    bones[n].position.subVectors(BIND[n], BIND[p]);
  }
  const boneList = BONE_NAMES.map((n) => bones[n]);
  const inverses = BONE_NAMES.map((n) => new THREE.Matrix4().makeTranslation(-BIND[n].x, -BIND[n].y, -BIND[n].z));
  const skeleton = new THREE.Skeleton(boneList, inverses);

  // 피부
  const B = new Builder();
  buildTorso(B);
  buildShirtBits(B);
  buildArm(B, 'L');
  buildArm(B, 'R');
  buildHand(B, 'L', true);
  buildHand(B, 'R', false);
  buildLeg(B, 'L');
  buildLeg(B, 'R');
  buildShoe(B, 'L');
  buildShoe(B, 'R');
  buildHead(B);
  const { geo, mats } = B.build();
  const { M, own } = makeMaterials(o);
  const skin = new THREE.SkinnedMesh(geo, mats.map((m) => M[m]));
  skin.name = 'golfer-skin';
  skin.castShadow = true;
  skin.receiveShadow = true;
  skin.frustumCulled = false;
  skin.add(bones.root);
  skin.bind(skeleton, new THREE.Matrix4());
  body.add(skin);
  if (o.hand === 'left') body.scale.x = -1;

  // 클럽을 다는 자리: 리드 손 뼈 아래, 손 기준틀에서 계산한 그립 위치
  const club = new THREE.Group();
  club.name = 'club-attach';
  {
    const Hd = HAND.L;
    club.quaternion.copy(Hd.Qb).multiply(Hd.RcInv);
    club.position.copy(V(0, -GRIP_AT.L, 0).applyQuaternion(Hd.RcInv).add(Hd.g0).applyQuaternion(Hd.Qb));
  }
  bones.handL.add(club);
  let clubMesh = null;
  let clubData = clubById('7I');

  // 발밑 그림자 원(그림자 맵이 꺼져 있어도 땅에 붙어 보이게)
  const blobCv = canvas(64, 64, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(0,0,0,.32)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);
  });
  const blobTex = new THREE.CanvasTexture(blobCv);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.0).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  blob.position.y = 0.004;
  blob.renderOrder = -1;
  body.add(blob);

  // ----- 클럽별 준비(키 자세를 가슴 기준으로 바꿔 두기) -----
  const prepCache = new Map();
  function prep(c) {
    if (prepCache.has(c.id)) return prepCache.get(c.id);
    const st = stanceFor(c);
    const len = c.lengthM;
    let keys;
    let ballLocal;
    let addrShaft;
    let addrFace;
    if (st.putter) {
      keys = null;
      const hands = V(0.0, 0.762, 0.27);
      const Lg = len - GRIP_AT.L;
      const sy = -hands.y / Lg;
      const sx = -0.04;
      addrShaft = V(sx, sy, Math.sqrt(Math.max(0, 1 - sx * sx - sy * sy))).normalize();
      addrFace = X.clone().addScaledVector(addrShaft, -addrShaft.x).normalize();
      const res = { st, keys, ball: null, shaft: addrShaft, face: addrFace, hands, table: null };
      prepCache.set(c.id, res);
      const W = composePutt(c, res, 0);
      ballLocal = W.sweet.clone().addScaledVector(W.faceN, 0.0214).setY(0.0214);
      res.ball = ballLocal;
      return res;
    }
    const base = stanceFor(clubById('7I'));
    const dH = V(...st.hands).sub(V(...base.hands));
    const Lg = len - GRIP_AT.L;
    const shaftFrom = (h, lean) => {
      const sy = -h.y / Lg;
      return V(lean, sy, Math.sqrt(Math.max(0.01, 1 - lean * lean - sy * sy))).normalize();
    };
    keys = KEYS_BASE.map((k) => {
      const fin = 1 - smooth(2.3, 3, k.u);
      const nk = JSON.parse(JSON.stringify(k));
      nk.tilt += st.dTilt * fin;
      nk.side += st.dSide * fin;
      const lowKey = k.u === 0 || k.u === 2 ? 1 : k.u === 0.33 || k.u === 1.6 || k.u === 2.3 ? 0.5 : 0.2;
      nk.hands = V(...k.hands).addScaledVector(dH, lowKey).toArray();
      if (k.u === 0) {
        nk.hands = st.hands.slice();
        nk.shaft = shaftFrom(V(...nk.hands), st.lean).toArray();
      }
      if (k.u === 2) {
        nk.hands = [st.hands[0] + lerp(0.065, 0.035, st.k), st.hands[1] + 0.028, st.hands[2] + 0.018];
        nk.shaft = shaftFrom(V(...nk.hands), st.impLean).toArray();
      }
      const s = V(...nk.shaft).normalize();
      const f = V(...nk.face);
      f.addScaledVector(s, -f.dot(s)).normalize();
      nk.shaft = s.toArray();
      nk.face = f.toArray();
      return nk;
    });
    // 리드 팔을 키마다 정한 굽힘만큼 펴지게 손을 어깨에서 밀거나 당깁니다(탑에서도 곧은 리드 팔).
    // 어드레스·임팩트는 손이 움직이면 헤드가 땅에 닿도록 샤프트 기울기도 다시 맞춥니다.
    // 릴리스·팔로스루는 뒷팔(rb)이 곧게 뻗는 쪽으로 맞춥니다.
    // 두 팔을 다 정하면(lb, rb) 두 구의 교점을 번갈아 투영으로 찾습니다.
    const reachOf = (bend) => Math.sqrt(L_UP * L_UP + L_FORE * L_FORE + 2 * L_UP * L_FORE * Math.cos(bend * RD));
    for (const k of keys) {
      if (k.lb == null && k.rb == null) continue;
      const both = k.lb != null && k.rb != null;
      const W = torsoFK(k, st);
      const ground = k.u === 0 || k.u === 2;
      for (let it = 0; it < (ground ? 4 : both ? 16 : 1); it++) {
        const sd = both ? (it % 2 ? 'R' : 'L') : k.lb == null ? 'R' : 'L';
        const S = W['arm' + sd].p;
        const R = reachOf(sd === 'L' ? k.lb : k.rb);
        const sv = V(...k.shaft).normalize();
        const qC = clubQ(sv, V(...k.face));
        const H = V(...k.hands);
        const wrist = handOnClub(sd, H.clone().addScaledVector(sv, -GRIP_AT.L), qC).wrist;
        const d = V().subVectors(wrist, H);
        const w2 = S.clone().add(V().subVectors(wrist, S).setLength(R));
        k.hands = w2.sub(d).toArray();
        if (ground) {
          const s2 = shaftFrom(V(...k.hands), k.u === 0 ? st.lean : st.impLean);
          const f2 = V(...k.face);
          f2.addScaledVector(s2, -f2.dot(s2)).normalize();
          k.shaft = s2.toArray();
          k.face = f2.toArray();
        }
      }
    }
    // 손 위치를 가슴 기준(방향 + 거리)으로 바꿉니다: 키 사이를 이을 때 손이 몸을 따라 호를 그리게.
    const relOf = (k) => {
      const W = torsoFK(k, st);
      const inv = W.chest.q.clone().invert();
      const rel = V(...k.hands).sub(W.armL.p).applyQuaternion(inv);
      k.hd = rel.clone().normalize().toArray();
      k.hr = rel.length();
      k.pl = V(...k.poleL).normalize().applyQuaternion(inv).toArray();
      k.pr = V(...k.poleR).normalize().applyQuaternion(inv).toArray();
    };
    keys.forEach(relOf);
    addrShaft = V(...keys[0].shaft);
    addrFace = V(...keys[0].face);
    const res = { st, keys, ball: null, shaft: addrShaft, face: addrFace, hands: V(...keys[0].hands), table: null };
    prepCache.set(c.id, res);
    const P0 = sampleKeys(keys, 0);
    const W0 = composeSwing(P0, c, res, addrShaft, addrFace, { noBall: true });
    res.ball = W0.sweet.clone().addScaledVector(W0.faceN, 0.0214).setY(c.id === '1W' ? W0.sweet.y + 0.006 : 0.0214);
    // 임팩트 키를 공에 맞춥니다: 리드 팔을 곧게 둔 채 헤드가 공을 지나도록 샤프트 세움을 고릅니다(손은 공보다 앞).
    {
      const ki = keys.find((k) => k.u === 2);
      const R = Math.sqrt(L_UP * L_UP + L_FORE * L_FORE + 2 * L_UP * L_FORE * Math.cos(ki.lb * RD));
      const face0 = V(...ki.face);
      // 공이 리드 팔 길이 밖이면 몸을 조금 더 숙이고 무릎을 굽혀(다운스윙의 주저앉음) 닿게 합니다.
      for (let pass = 0; pass < 10; pass++) {
        // 실제 합성에서 어깨 자리(다리 맞춤으로 골반이 내려간 뒤)
        const Wk = composeSwing(sampleKeys(keys, 2), c, res, null, null, { noBall: true });
        const S = Wk.reach.shL;
        let best = null;
        for (let deg = 30; deg <= 82; deg += 0.25) {
          const ph = deg * RD;
          const sv = V(st.impLean, -Math.sin(ph), Math.cos(ph)).normalize();
          const fv = face0.clone().addScaledVector(sv, -face0.dot(sv)).normalize();
          const qC = clubQ(sv, fv);
          const want = res.ball.clone().addScaledVector(faceNormalOf(qC), -0.0214);
          const H = want.sub(sweetOf(V(), qC, c));
          const wrist = handOnClub('L', H.clone().addScaledVector(sv, -GRIP_AT.L), qC).wrist;
          const e = Math.abs(wrist.distanceTo(S) - R);
          if (!best || e < best.e) best = { e, H, sv, fv };
        }
        ki.hands = best.H.toArray();
        ki.shaft = best.sv.toArray();
        ki.face = best.fv.toArray();
        relOf(ki);
        if (best.e < 0.004 || pass === 9) break;
        ki.tilt += 1.1;
        ki.hy -= 0.005;
        ki.hz += 0.003;
      }
    }
    // u 에 따른 기대 샤프트 표(문자 단계에서 u 찾기용)
    const table = [];
    for (let i = 0; i <= 600; i++) {
      const P = sampleKeys(keys, (i / 600) * 3);
      table.push(V(...P.shaft).normalize());
    }
    res.table = table;
    return res;
  }

  // ----- 몸통 정운동학 -----
  function place(W, name, q) {
    const par = W[PARENT[name]];
    const p = V().subVectors(BIND[name], BIND[PARENT[name]]).applyQuaternion(par.q).add(par.p);
    W[name] = { p, q };
    return W[name];
  }
  function torsoFK(P, st) {
    const W = { root: { p: V(), q: new THREE.Quaternion() } };
    const hipsQ = qMul(qAxis(Y, P.hip), qAxis(X, P.ptilt), qAxis(Z, P.pside));
    W.hips = { p: V(BIND.hips.x + P.hx, BIND.hips.y + P.hy, BIND.hips.z + P.hz), q: hipsQ };
    let chestQ = qMul(qAxis(Z, P.side), qAxis(X, P.tilt), qAxis(Y, P.sh));
    if (P.rock) chestQ = qMul(new THREE.Quaternion().setFromAxisAngle(Z.clone().applyQuaternion(chestQ), P.rock * RD), chestQ);
    if (P.breath) chestQ = qMul(chestQ, qAxis(X, P.breath));
    place(W, 'spine', hipsQ.clone().slerp(chestQ, 0.45));
    place(W, 'chest', chestQ);
    place(W, 'clavL', qMul(chestQ, qAxis(Y, -P.clavL[0]), qAxis(Z, P.clavL[1])));
    place(W, 'clavR', qMul(chestQ, qAxis(Y, P.clavR[0]), qAxis(Z, -P.clavR[1])));
    place(W, 'armL', null);
    place(W, 'armR', null);
    place(W, 'neck', chestQ);
    void st;
    return W;
  }
  // 발: 공 쪽 발가락 관절(볼)을 땅에 고정하고 뒤꿈치를 들거나 돌립니다.
  function footSpec(sd, st, yawAdd, heel, roll) {
    const s = sd === 'L' ? 1 : -1;
    const yaw0 = sd === 'L' ? st.leadYaw : st.trailYaw;
    const ankle0 = V(s * st.half, BIND.footL.y, -0.01);
    const toe = ankle0.clone().add(V().subVectors(BIND['toe' + sd], BIND['foot' + sd]).applyAxisAngle(Y, yaw0 * RD));
    return { toe, yaw: yaw0 + yawAdd, heel, roll };
  }
  function legs(W, P, st) {
    const feet = {
      L: footSpec('L', st, P.lYaw || 0, P.lHeel, P.lRoll),
      R: footSpec('R', st, P.tYaw, P.tHeel, P.tRoll || 0)
    };
    const ankles = {};
    for (const sd of ['L', 'R']) {
      const f = feet[sd];
      f.q = qMul(qAxis(Y, f.yaw), qAxis(X, f.heel), qAxis(Z, f.roll));
      ankles[sd] = f.toe.clone().sub(V().subVectors(BIND['toe' + sd], BIND['foot' + sd]).applyQuaternion(f.q));
    }
    // 다리가 닿도록 골반을 낮춥니다
    for (let it = 0; it < 4; it++) {
      let worst = 0;
      for (const sd of ['L', 'R']) {
        const hj = V().subVectors(BIND['thigh' + sd], BIND.hips).applyQuaternion(W.hips.q).add(W.hips.p);
        const dist = hj.distanceTo(ankles[sd]);
        worst = Math.max(worst, dist - (L_THIGH + L_SHIN) * 0.985);
      }
      if (worst <= 0) break;
      W.hips.p.y -= worst * 1.05;
    }
    return { feet, ankles };
  }
  function solveLeg(W, sd, foot, ankle, pole) {
    place(W, 'thigh' + sd, null);
    const Hj = W['thigh' + sd].p;
    const pl = toV(pole).normalize();
    const { E, T } = ik2(Hj, ankle, L_THIGH, L_SHIN, pl);
    const a = V().subVectors(E, Hj).normalize();
    const f = V().subVectors(T, E).normalize();
    let h = V().crossVectors(a, f);
    if (h.lengthSq() < 1e-7) h = V().crossVectors(a, pl.clone().negate());
    h.normalize();
    W['thigh' + sd].q = aimQ(REST['thigh' + sd].dir, REST['thigh' + sd].up, a, h);
    place(W, 'shin' + sd, aimQ(REST['shin' + sd].dir, REST['shin' + sd].up, f, h));
    place(W, 'foot' + sd, foot.q);
    place(W, 'toe' + sd, qAxis(Y, foot.yaw));
  }
  // 팔: 어깨에서 손목까지 IK. 리드 팔은 손 방향에서 팔꿈치 방향을 정해 팔뚝이 비틀리지 않게 합니다.
  function solveArm(W, sd, wrist, qHand, pole, fromHand) {
    const S = W['arm' + sd].p;
    const pl = toV(pole).normalize();
    const sw = V().subVectors(wrist, S).normalize();
    if (fromHand > 0) {
      const hH = REST['fore' + sd].up.clone().applyQuaternion(qHand);
      const ph = V().crossVectors(sw, hH);
      if (ph.lengthSq() > 1e-6) pl.lerp(ph.normalize(), fromHand).normalize();
    }
    const { E, T } = ik2(S, wrist, L_UP, L_FORE, pl);
    const a = V().subVectors(E, S).normalize();
    const f = V().subVectors(T, E).normalize();
    let h = V().crossVectors(a, f);
    if (h.lengthSq() < 1e-7) h = V().crossVectors(a, pl.clone().negate());
    h.normalize();
    W['arm' + sd].q = aimQ(REST['arm' + sd].dir, REST['arm' + sd].up, a, h);
    place(W, 'fore' + sd, aimQ(REST['fore' + sd].dir, REST['fore' + sd].up, f, h));
    place(W, 'hand' + sd, qHand);
    const rel = W['fore' + sd].q.clone().invert().multiply(qHand);
    const tw = twistAngle(rel, REST['fore' + sd].dir);
    place(W, 'twist' + sd, W['fore' + sd].q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(REST['fore' + sd].dir, tw * 0.62)));
    place(W, 'delt' + sd, W['clav' + sd].q.clone().slerp(W['arm' + sd].q, 0.5));
  }
  // 쇄골을 손목 쪽으로 돌려 어깨를 최대 18도까지 내밀기
  function clavReach(W, sd, wrist, need) {
    const C = W['clav' + sd].p;
    const v1 = V().subVectors(W['arm' + sd].p, C);
    const v2 = V().subVectors(wrist, C);
    const ax = V().crossVectors(v1, v2);
    if (ax.lengthSq() < 1e-10) return false;
    ax.normalize();
    const ang = Math.min(v1.angleTo(v2), 18 * RD, (need / v1.length()) * 1.15);
    W['clav' + sd].q = new THREE.Quaternion().setFromAxisAngle(ax, ang).multiply(W['clav' + sd].q);
    place(W, 'arm' + sd, null);
    return true;
  }
  // 클럽 틀(원점 = 그립 끝)에서 손 뼈의 월드 자세
  function handOnClub(sd, O, qC) {
    const Hd = HAND[sd];
    const qH = qC.clone().multiply(Hd.Rc);
    const Gp = O.clone().add(V(0, GRIP_AT[sd], 0).applyQuaternion(qC));
    const wrist = Gp.clone().sub(Hd.g0.clone().applyQuaternion(qH));
    return { wrist, q: qH.clone().multiply(Hd.QbInv) };
  }
  // 손 기준틀 방향(손가락, 손등)으로 손 뼈 자세
  function handFree(sd, fingers, dorsal) {
    const Hd = HAND[sd];
    const s = sd === 'L' ? 1 : -1;
    const f = fingers.clone().normalize();
    const dd = dorsal.clone().addScaledVector(f, -dorsal.dot(f)).normalize();
    const xx = V().crossVectors(f, dd).multiplyScalar(1);
    void s;
    const qH = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xx, f, dd));
    return qH.multiply(Hd.QbInv);
  }
  function clubQ(s, f) {
    const yy = s.clone().normalize();
    const zz = f.clone().addScaledVector(yy, -f.dot(yy));
    if (zz.lengthSq() < 1e-8) zz.copy(X).addScaledVector(yy, -yy.x);
    zz.normalize();
    const xx = V().crossVectors(yy, zz);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xx, yy, zz));
  }
  // 머리: 가슴 위에서 목표점을 봅니다(눈이 더 내려다보므로 머리는 조금 덜 숙임).
  function headLook(W, target, extraYaw = 0, extraPitch = 0) {
    const cq = W.chest.q;
    const eye = W.neck.p.clone().add(V(0, 0.2, 0.085).applyQuaternion(cq));
    const g = V().subVectors(target, eye).normalize();
    const upRef = V(0, 1, 0).applyQuaternion(cq).lerp(Y, 0.55).normalize();
    const ax = V().crossVectors(g, upRef);
    let f = g.clone();
    if (ax.lengthSq() > 1e-6) f.applyAxisAngle(ax.normalize(), 20 * RD * smooth(0, -0.9, g.y));
    if (extraYaw) f.applyAxisAngle(Y, extraYaw * RD);
    if (extraPitch) f.applyAxisAngle(V().crossVectors(f, Y).normalize(), extraPitch * RD);
    let qHead = aimQ(Z, Y, f, upRef);
    // 가슴에 대해 너무 돌지 않게(목 한계)
    const rel = cq.clone().invert().multiply(qHead);
    const ang = 2 * Math.acos(clamp(Math.abs(rel.w), 0, 1));
    const lim = 95 * RD;
    if (ang > lim) qHead = cq.clone().slerp(qHead, lim / ang);
    place(W, 'neck', cq.clone().slerp(qHead, 0.45));
    place(W, 'head', qHead);
  }

  // 공통 합성: 몸통·다리·손·머리
  function composeBase(P, c, hands) {
    const st = P.st;
    const W = torsoFK(P, st);
    const { feet, ankles } = legs(W, P, st);
    // 골반이 내려갔으면 몸통 다시
    const W2 = torsoFK({ ...P, hy: W.hips.p.y - BIND.hips.y }, st);
    Object.assign(W, W2);
    // 손과 클럽
    const s = P.shaft.clone().normalize();
    const qC = clubQ(s, P.face);
    let H = P.grip.clone();
    // 공 맞추기(어드레스·임팩트 근처는 헤드가 공을 지나게)
    if (P.ball && P.ballW > 0) {
      const head = sweetOf(H, qC, c);
      const want = P.ball.clone().addScaledVector(faceNormalOf(qC), -0.0214);
      const dd = V().subVectors(want, head);
      if (dd.length() > 0.2) dd.setLength(0.2);
      H.addScaledVector(dd, P.ballW);
    }
    const reachMax = (L_UP + L_FORE) * 0.997;
    let L;
    let R;
    const moved = V();
    let eL0 = 0;
    let eR0 = 0;
    for (let it = 0; it < 4; it++) {
      const O = H.clone().addScaledVector(s, -GRIP_AT.L);
      L = handOnClub('L', O, qC);
      R = P.trail ? P.trail : handOnClub('R', O, qC);
      const eL = L.wrist.distanceTo(W.armL.p) - reachMax;
      const eR = P.trail ? 0 : R.wrist.distanceTo(W.armR.p) - reachMax;
      if (it === 0) {
        eL0 = eL;
        eR0 = eR;
      }
      if (eL <= 0.0005 && eR <= 0.0005) break;
      // 먼저 어깨뼈(쇄골)를 손 쪽으로 내밀고, 그래도 모자라면 손을 어깨 쪽으로 당깁니다
      if (it === 0) {
        let again = false;
        if (eL > 0) again = clavReach(W, 'L', L.wrist, eL) || again;
        if (eR > 0) again = clavReach(W, 'R', R.wrist, eR) || again;
        if (again) continue;
      }
      const mv = V();
      if (eR > 0) mv.addScaledVector(V().subVectors(W.armR.p, R.wrist).normalize(), eR);
      if (eL > 0) mv.addScaledVector(V().subVectors(W.armL.p, L.wrist).normalize(), eL);
      H.add(mv);
      moved.add(mv);
    }
    W.reach = { eL: eL0, eR: eR0, moved: moved.length(), shL: W.armL.p.clone(), shR: W.armR.p.clone() };
    solveArm(W, 'L', L.wrist, L.q, P.poleL, P.leadFromHand ?? 0.75);
    solveArm(W, 'R', R.wrist, R.q, P.poleR, P.trail ? 0 : 0.2);
    headLook(W, P.look, P.headYaw || 0, P.headPitch || 0);
    solveLeg(W, 'L', feet.L, ankles.L, P.kneeL);
    solveLeg(W, 'R', feet.R, ankles.R, P.kneeR);
    W.sweet = sweetOf(H, qC, c);
    W.faceN = faceNormalOf(qC);
    W.grip = H;
    W.qC = qC;
    W.clubO = H.clone().addScaledVector(s, -GRIP_AT.L);
    return W;
  }
  function sweetOf(H, qC, c) {
    const O = H.clone().addScaledVector(Y.clone().applyQuaternion(qC), -GRIP_AT.L);
    const sw = clubMesh && clubMesh.userData.id === c.id ? clubMesh.userData.sweet : sweetCache(c);
    return sw.clone().applyQuaternion(qC).add(O);
  }
  function faceNormalOf(qC) {
    return Z.clone().applyQuaternion(qC);
  }
  const sweetMap = new Map();
  function sweetCache(c) {
    if (!sweetMap.has(c.id)) {
      const m = makeClubMesh(c.id, o.color);
      sweetMap.set(c.id, m.userData.sweet.clone());
      disposeObject(m, true);
    }
    return sweetMap.get(c.id);
  }

  // 스윙 키 → 합성
  function composeSwing(P, c, pr, shaft, face, opt = {}) {
    const W0 = torsoFK(P, pr.st);
    const cq = W0.chest.q;
    const grip = W0.armL.p.clone().addScaledVector(V(...P.hd).normalize().applyQuaternion(cq), Math.min(P.hr, 0.72));
    const ballW = opt.noBall || !pr.ball ? 0 : Math.max(1 - smooth(0, 0.14, P.u), 1 - smooth(0, 0.16, Math.abs(P.u - 2)));
    const lookT = V(...(pr.ball ? pr.ball.toArray() : [0.02, 0, 0.75])).lerp(V(28, 3, 1.5), smooth(0, 1, P.look));
    return composeBase({
      ...P,
      st: pr.st,
      shaft: shaft || V(...P.shaft),
      face: face || V(...P.face),
      grip,
      ball: pr.ball,
      ballW,
      poleL: V(...P.pl).applyQuaternion(cq),
      poleR: V(...P.pr).applyQuaternion(cq),
      look: lookT
    }, c);
  }

  // 퍼팅 자세: t 는 -1(백스트로크) ~ 1(팔로스루). 어깨가 시소처럼 흔들리고 손목은 쓰지 않습니다.
  function puttParams(st, hands, shaft, face, t) {
    const rock = t < 0 ? t * 10 : t * 12;
    return {
      st,
      u: 0,
      hip: 0, sh: 0, tilt: 41, side: 4, ptilt: 22, pside: 0, hx: 0, hy: -0.04, hz: -0.075,
      clavL: [8, -3], clavR: [12, -4], rock,
      tHeel: 0, tYaw: 0, lHeel: 0, lRoll: 0,
      kneeL: V(-0.05, 0, 1), kneeR: V(0.05, 0, 1),
      poleL: V(0.55, -0.15, -1), poleR: V(-0.55, -0.15, -1),
      leadFromHand: 0.35,
      _hands: hands, _shaft: shaft, _face: face
    };
  }
  function composePutt(c, pr, t) {
    const P = puttParams(pr.st, pr.hands, pr.shaft, pr.face, t);
    const W0 = torsoFK({ ...P, rock: 0 }, pr.st);
    const W1 = torsoFK(P, pr.st);
    // 손·퍼터는 어깨와 함께 돕니다(흔들리는 각만큼 가슴 중심 둘레로)
    const pivot = W0.armL.p.clone().add(W0.armR.p).multiplyScalar(0.5);
    const dq = W1.chest.q.clone().multiply(W0.chest.q.clone().invert());
    const grip = pr.hands.clone().sub(pivot).applyQuaternion(dq).add(pivot);
    const ball = pr.ball || V(0, 0.0214, 0.56);
    return composeBase({ ...P, grip, shaft: pr.shaft.clone().applyQuaternion(dq), face: pr.face.clone().applyQuaternion(dq), look: ball.clone().add(V(0, 0, 0)) }, c);
  }

  // 서 있는 자세(대기·기쁨·아쉬움): 클럽은 리드 손으로 지팡이처럼 짚습니다.
  function standParams(kind, time) {
    const st = { half: 0.14, leadYaw: 12, trailYaw: -10 };
    const P = {
      st, u: 0,
      hip: 0, sh: 0, tilt: 4, side: 0, ptilt: 6, pside: 0, hx: 0, hy: -0.012, hz: -0.02,
      clavL: [0, 0], clavR: [0, 0],
      tHeel: 0, tYaw: 0, lHeel: 0, lRoll: 0,
      kneeL: V(0.05, 0, 1), kneeR: V(-0.05, 0, 1),
      poleL: V(0.3, -0.2, -1), poleR: V(-0.6, -0.2, -0.5),
      leadFromHand: 0.5
    };
    const len = clubData.lengthM;
    const ground = V(0.33, 0.0, 0.3);
    let grip = V(0.24, 0.87, 0.12);
    const s = V().subVectors(ground, grip).normalize();
    grip = ground.clone().addScaledVector(s, -(len - GRIP_AT.L));
    P.grip = grip;
    P.shaft = s;
    P.face = V(0.6, 0, 1);
    P.look = V(0, 1.55, 8);
    const sway = Math.sin(time * 1.3);
    if (kind === 'idle') {
      P.hx = 0.012 * sway;
      P.hip = 3 * sway;
      P.sh = 2 * Math.sin(time * 1.3 + 0.4);
      P.breath = 1.2 * Math.sin(time * 2.1);
      P.trail = { wrist: V(-0.215, 0.885, 0.0), q: handFree('R', V(0.05, -1, 0.15), V(-1, 0, 0.1)) };
      P.headYaw = 8 * Math.sin(time * 0.37);
    } else if (kind === 'celebrate') {
      const pump = Math.abs(Math.sin(time * 6.5)) * Math.exp(-((time % 2.4) * 0.6));
      P.tilt = 12;
      P.hy = -0.05 + 0.02 * pump;
      P.sh = -8;
      P.hip = -4;
      P.side = -3;
      P.clavR = [10, 14];
      const w = V(-0.12, 1.28 + 0.13 * pump, 0.24);
      P.trail = { wrist: w, q: handFree('R', V(0.15, 1, 0.25), V(-0.2, 0.2, 1)) };
      P.poleR = V(-0.6, -1, 0.1);
      P.look = V(2, 1.7, 8);
    } else if (kind === 'disappoint') {
      P.tilt = 10;
      P.side = -2;
      P.clavR = [-6, 16];
      P.trail = { wrist: V(-0.06, 1.68, -0.11), q: handFree('R', V(0.2, 0.55, 0.9), V(0.15, 0.85, -0.5)) };
      P.poleR = V(-1, 0.2, 0.35);
      P.look = V(0.3, 0, 1.6);
      P.headYaw = 12 * Math.sin(time * 2.4) * Math.exp(-((time % 4) * 0.5));
    }
    return P;
  }

  // ----- 적용과 섞기 -----
  const cur = { q: BONE_NAMES.map(() => new THREE.Quaternion()), hips: V() };
  let from = null;
  let blendT = 1;
  const BLEND = 0.28;
  let target = null;
  function writeBones(W) {
    const t = { q: [], hips: W.hips.p.clone() };
    for (let i = 0; i < BONE_NAMES.length; i++) {
      const n = BONE_NAMES[i];
      if (n === 'root') {
        t.q.push(new THREE.Quaternion());
        continue;
      }
      const w = W[n];
      const pw = W[PARENT[n]];
      t.q.push(pw.q.clone().invert().multiply(w.q));
    }
    target = t;
    render();
  }
  function render() {
    if (!target) return;
    const e = blendT >= 1 || !from ? 1 : smooth(0, 1, blendT);
    for (let i = 1; i < BONE_NAMES.length; i++) {
      const b = bones[BONE_NAMES[i]];
      if (e >= 1) b.quaternion.copy(target.q[i]);
      else b.quaternion.copy(from.q[i]).slerp(target.q[i], e);
      cur.q[i].copy(b.quaternion);
    }
    if (e >= 1) bones.hips.position.copy(target.hips);
    else bones.hips.position.copy(from.hips).lerp(target.hips, e);
    cur.hips.copy(bones.hips.position);
  }
  let family = null;
  function setFamily(f) {
    if (f === family) return;
    if (family !== null) {
      from = { q: cur.q.map((q) => q.clone()), hips: cur.hips.clone() };
      blendT = 0;
    }
    family = f;
  }

  // ----- 스윙 추적(단계를 주지 않을 때) -----
  // 어드레스 샤프트와 목표선이 만드는 평면에서 샤프트가 돈 각(θ, 백스윙이 음수)을 이어 붙여 u 를 정합니다.
  const TOP = 245;
  const FIN = 290;
  const tr = { seg: 'address', theta: 0, prevRaw: null, min: 0, uTop: 0, u: 0, a0: null, n: null, maxFollow: 0 };
  function resetTracker(addr) {
    const a = (addr || prep(clubData).shaft).clone().normalize();
    tr.n = V().crossVectors(a, X).normalize();
    tr.a0 = a.clone().addScaledVector(tr.n, -a.dot(tr.n)).normalize();
    tr.seg = 'address';
    tr.theta = 0;
    tr.prevRaw = null;
    tr.min = 0;
    tr.uTop = 0;
    tr.u = 0;
    tr.maxFollow = 0;
  }
  function track(s) {
    if (!tr.n) resetTracker();
    const p = s.clone().addScaledVector(tr.n, -s.dot(tr.n));
    if (p.lengthSq() > 1e-6) {
      p.normalize();
      const raw = Math.atan2(V().crossVectors(tr.a0, p).dot(tr.n), tr.a0.dot(p)) / RD;
      if (tr.prevRaw == null) tr.theta = raw;
      else {
        let d = raw - tr.prevRaw;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        tr.theta += d;
      }
      tr.prevRaw = raw;
    }
    const th = tr.theta;
    if (tr.seg === 'address' && th < -8) tr.seg = 'back';
    if (tr.seg === 'address' && th > 25) tr.seg = 'follow';
    if (tr.seg === 'back') {
      tr.min = Math.min(tr.min, th);
      if (th > tr.min + 12 && tr.min < -35) {
        tr.seg = 'down';
        tr.uTop = clamp(-tr.min / TOP, 0, 1.06);
      } else if (th > 4 && tr.min > -35) tr.seg = 'follow';
    }
    if (tr.seg === 'down' && th > 0) tr.seg = 'follow';
    let u;
    let f = 0;
    if (tr.seg === 'address') u = 0;
    else if (tr.seg === 'back') u = clamp(-th / TOP, 0, 1.06);
    else if (tr.seg === 'down') {
      f = clamp((th - tr.min) / (0 - tr.min), 0, 1);
      u = 1 + f;
    } else {
      tr.maxFollow = Math.max(tr.maxFollow, th);
      u = 2 + clamp(tr.maxFollow / FIN, 0, 1);
    }
    tr.u = u;
    return { u, seg: tr.seg, f, uTop: tr.uTop, theta: th };
  }
  // 문자 단계: 그 구간 안에서 샤프트가 가장 비슷한 u
  const SEG = { address: [0, 0], back: [0, 1.05], top: [1, 1], down: [1, 2], impact: [2, 2], follow: [2, 3], finish: [3, 3] };
  let lastSeg = null;
  let lastU = 0;
  let segTop = 1;
  function bestU(table, s, a, b) {
    let best = a;
    let bd = -2;
    for (let i = Math.round((a / 3) * 600); i <= Math.round((b / 3) * 600); i++) {
      const d = table[i].dot(s);
      if (d > bd) {
        bd = d;
        best = (i / 600) * 3;
      }
    }
    return best;
  }

  const api = {
    root,
    skeleton,
    skin,
    bones,
    club,
    get clubMesh() {
      return clubMesh;
    },
    get clubId() {
      return clubData.id;
    },
    hand: o.hand,
    targetLocal: V(o.hand === 'left' ? -1 : 1, 0, 0),
    // 클럽 바꾸기: makeClubMesh 결과나 아이디('7I')를 받습니다.
    setClub(m) {
      const owned = typeof m === 'string';
      if (owned) m = makeClubMesh(m, o.color);
      if (clubMesh) {
        club.remove(clubMesh);
        if (clubMesh.userData.ownedByGolfer) disposeObject(clubMesh, true);
      }
      clubMesh = m || null;
      if (clubMesh) {
        if (owned) clubMesh.userData.ownedByGolfer = true;
        club.add(clubMesh);
        clubData = clubById(clubMesh.userData.id || '7I');
      }
      resetTracker();
      if (family === 'swing' || family === null) api.pose('address');
      return clubMesh;
    },
    // 어드레스 정보(몸 좌표): 공 자리, 샤프트·페이스 방향, 손 위치, 발 너비
    addressFor(id) {
      const c = clubById(id || clubData.id);
      const pr = prep(c);
      return { ball: pr.ball.clone(), shaft: pr.shaft.clone(), face: pr.face.clone(), hands: pr.hands.clone(), stanceHalf: pr.st.half, club: c };
    },
    // 공(월드 좌표)과 목표 방향(월드)에 맞춰 root 를 놓습니다. y 는 공 아래 땅 높이로.
    placeAtBall(ballWorld, targetDirWorld, groundY) {
      const pr = prep(clubData);
      const t = toV(targetDirWorld).setY(0).normalize();
      const yaw = Math.atan2(t.x, t.z) - Math.atan2(api.targetLocal.x, api.targetLocal.z);
      root.quaternion.setFromAxisAngle(Y, yaw);
      const bl = pr.ball.clone();
      if (o.hand === 'left') bl.x = -bl.x;
      const off = V(bl.x, 0, bl.z).applyAxisAngle(Y, yaw);
      const b = toV(ballWorld);
      root.position.set(b.x - off.x, groundY ?? b.y - 0.0214, b.z - off.z);
      root.updateMatrixWorld(true);
    },
    // 클럽(샤프트 방향 월드, 그립 → 헤드)에서 몸을 풉니다. phase: 문자 단계, 0..3 숫자(u), 또는 생략(스스로 추적).
    poseFromClub(shaftDirWorld, phase, opt = {}) {
      named = null;
      const c = clubData;
      if (c.kind !== 'putter') setFamily('swing');
      if (c.kind === 'putter') {
        // 퍼터는 퍼팅 스트로크로(샤프트가 목표 쪽으로 기운 정도로 t)
        const pr = prep(c);
        const sL = shaftDirWorld ? toLocalDir(shaftDirWorld, opt.local) : pr.shaft.clone();
        const t = clamp(Math.asin(clamp(sL.x - pr.shaft.x, -1, 1)) / (20 * RD), -1.4, 1.4);
        setFamily('putt');
        const W = composePutt(c, pr, typeof phase === 'number' ? phase : t);
        writeBones(W);
        return info(W, t, 'putt');
      }
      const pr = prep(c);
      let sL = shaftDirWorld ? toLocalDir(shaftDirWorld, opt.local) : null;
      const fL = opt.face ? toLocalDir(opt.face, opt.local) : null;
      let u;
      let seg;
      let f = 0;
      let uTop = 1;
      if (typeof phase === 'number') {
        u = clamp(phase, 0, 3);
        seg = u <= 0 ? 'address' : u < 1 ? 'back' : u < 2 ? 'down' : 'follow';
      } else if (typeof phase === 'string' && SEG[phase]) {
        const [a, b] = SEG[phase];
        u = sL && a !== b ? bestU(pr.table, sL, a, b) : a;
        seg = phase === 'top' ? 'down' : phase === 'impact' ? 'follow' : phase === 'finish' ? 'follow' : phase;
        if (phase === 'back' || phase === 'address') segTop = u;
        if (seg === 'down' && lastSeg === 'back') segTop = lastU;
        if (seg === 'down') {
          uTop = segTop;
          f = u - 1;
        }
      } else {
        if (!sL) sL = pr.shaft.clone();
        const r = track(sL);
        u = r.u;
        seg = r.seg;
        f = r.f;
        uTop = r.uTop;
      }
      lastSeg = seg;
      lastU = u;
      let P = sampleKeys(pr.keys, u);
      // 짧은 백스윙에서 내려올 때: 실제 탑 자세에서 다운스윙 자세로 이어 줍니다
      if (seg === 'down' && uTop < 0.985) {
        const Ptop = sampleKeys(pr.keys, uTop);
        P = mixParams(Ptop, P, smooth(0, 0.6, f));
        P.u = u;
      }
      P.tHeel = Math.max(0, P.tHeel);
      P.lHeel = Math.max(0, P.lHeel);
      const W = composeSwing(P, c, pr, sL, fL);
      writeBones(W);
      return info(W, u, seg);
    },
    // 이름 자세: 'address' | 'waggle' | 'putt_address' | 'putt_stroke'(t -1..1) | 'celebrate' | 'disappoint' | 'idle'
    pose(name, t) {
      named = { name, t };
      clock = t != null && name !== 'putt_stroke' ? t : clock;
      return solveNamed();
    },
    // 단계를 주지 않는 스윙 추적을 처음부터(어드레스 샤프트 방향, 몸 좌표 또는 월드)
    resetSwing(addrShaftWorld) {
      resetTracker(addrShaftWorld ? toLocalDir(addrShaftWorld) : null);
      lastSeg = null;
      segTop = 1;
    },
    get swingU() {
      return tr.u;
    },
    // u(0..3)에서 기대 샤프트 방향(몸 좌표). 합성 스윙·시험용.
    expectedShaft(u, id) {
      const pr = prep(clubById(id || clubData.id));
      if (!pr.table) return pr.shaft.clone();
      return pr.table[Math.round((clamp(u, 0, 3) / 3) * 600)].clone();
    },
    expectedFace(u, id) {
      const pr = prep(clubById(id || clubData.id));
      if (!pr.keys) return pr.face.clone();
      return V(...sampleKeys(pr.keys, u).face).normalize();
    },
    clubHeadWorld(out = V()) {
      if (!clubMesh) return out.set(0, 0, 0);
      return out.copy(clubMesh.userData.sweet).applyMatrix4(clubMesh.matrixWorld);
    },
    update(dt) {
      clock += dt;
      if (blendT < 1) blendT = Math.min(1, blendT + dt / BLEND);
      if (named && (family !== 'swing' || named.name === 'waggle')) solveNamed();
      else render();
    },
    dispose() {
      geo.dispose();
      for (const k in M) M[k].dispose();
      for (const t of own) t.dispose();
      blobTex.dispose();
      blob.geometry.dispose();
      blob.material.dispose();
      if (clubMesh && clubMesh.userData.ownedByGolfer) disposeObject(clubMesh, true);
      root.removeFromParent();
    }
  };
  function toLocalDir(v, isLocal) {
    const d = toV(v).normalize();
    if (isLocal) return d;
    body.updateWorldMatrix(true, false);
    const m = new THREE.Matrix3().setFromMatrix4(body.matrixWorld).invert();
    return d.applyMatrix3(m).normalize();
  }
  function info(W, u, seg) {
    body.updateWorldMatrix(true, false);
    lastReach = W.reach;
    return { u, phase: seg, reach: W.reach, gripLocal: W.grip.clone(), headLocal: W.sweet.clone(), grip: body.localToWorld(W.grip.clone()), head: body.localToWorld(W.sweet.clone()) };
  }
  let named = null;
  let clock = 0;
  let lastReach = null;
  function solveNamed() {
    if (!named) return null;
    const { name } = named;
    const c = clubData;
    const pr = prep(c);
    if (name === 'putt_address' || name === 'putt_stroke' || (c.kind === 'putter' && (name === 'address' || name === 'waggle'))) {
      setFamily('putt');
      const pp = c.kind === 'putter' ? pr : prep(CLUBS.PT);
      const W = composePutt(c, pp, name === 'putt_stroke' ? clamp(named.t || 0, -1.5, 1.5) : 0);
      writeBones(W);
      return info(W, 0, 'putt');
    }
    if (name === 'address' || name === 'waggle') {
      setFamily('swing');
      const P = sampleKeys(pr.keys, 0);
      let s = pr.shaft.clone();
      let fc = pr.face.clone();
      if (name === 'waggle') {
        const w = Math.sin(clock * 5.2) * 0.5 + Math.sin(clock * 2.1) * 0.5;
        const ax = V().crossVectors(s, X).normalize();
        s.applyAxisAngle(ax, w * 9 * RD);
        fc.applyAxisAngle(ax, w * 9 * RD);
        P.hands = V(...P.hands).add(V(-0.012 * w, 0.006 * Math.abs(w), 0)).toArray();
        P.hy -= 0.004 * Math.abs(Math.sin(clock * 2.6));
        P.hip += 1.5 * w;
      }
      const W = composeSwing(P, c, pr, s, fc, { noBall: name === 'waggle' });
      writeBones(W);
      resetTracker();
      return info(W, 0, 'address');
    }
    if (name === 'idle' || name === 'celebrate' || name === 'disappoint') {
      setFamily(name);
      const P = standParams(name, clock);
      const W = composeBase(P, c);
      writeBones(W);
      return info(W, 0, name);
    }
    return null;
  }

  api.setClub(makeClubMesh('7I', o.color));
  clubMesh.userData.ownedByGolfer = true;
  api.pose('address');
  return api;
}

function disposeObject(obj, keepShared) {
  obj.traverse((n) => {
    if (n.geometry) n.geometry.dispose();
    if (!keepShared && n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach((m) => m.dispose());
  });
  obj.removeFromParent();
}
