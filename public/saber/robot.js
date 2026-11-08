// 로봇 검객(로봇 검투 모드의 상대)과 공격 예고 빛 줄.
// 몸: 아이보리 장갑판 + 건메탈 골격 + 크롬 관절 + 적 색(마젠타) 빛(눈 띠·가슴 코어·팔다리 줄), 두 손으로 광선검을 쥡니다.
// 뼈대: 골반 → 허리 → 가슴 → 목 → 머리. 팔다리는 두 마디 IK 로 손(칼자루)과 발(바닥)에 맞춥니다.
// 자세(pose) = 골반 위치·회전, 허리·가슴·머리 회전, 칼자루 위치·칼날 방향, 두 발 위치. 모두 로봇 기준 좌표이고
// 로봇은 +Z(선수 쪽)를 봅니다. 로봇 오른손 쪽 = -X = 선수가 보기에 왼쪽입니다.
// 칼날·칼자루·잔상은 models.js 의 광선검을 그대로 쓰고 색만 적 색으로 바꿉니다(세계 좌표로 그림).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeHilt, makeBlade, makeTrail, smoothProfile, hdr, tex, pixels, fbm, hash2, glowTex, HILT, BLADE_LEN, ENEMY } from './models.js';

export const R_HILT = 1.3; // 로봇 손이 커서 칼자루도 크게
export const R_BLADE = BLADE_LEN * 1.08;
export const ROBOT_Z = -1.75; // 스테이션 원점에서 로봇이 서는 곳(선수 앞)
const L_UP = 0.3;
const L_FORE = 0.29;
const L_THIGH = 0.45;
const L_SHIN = 0.45;
const ANKLE_H = 0.085;
const SPINE_Y = 0.1;
const CHEST_Y = 0.2;
const NECK_Y = 0.335;
const HEAD_Y = 0.1;
const SHOULDER = [0.235, 0.27, 0]; // 가슴 기준(x 는 ±)
const HIP = [0.1, -0.06, 0]; // 골반 기준(x 는 ±)
const HAND_R = 0.028 * R_HILT; // 칼자루 원점에서 오른손(위 손)까지(칼날 방향)
const HAND_L = -0.078 * R_HILT; // 왼손(아래 손)

// ================================================================
// 지오메트리 도구
// ================================================================
const _e = new THREE.Euler();
const _mm = new THREE.Matrix4();
function place(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  if (rx || ry || rz) g.applyMatrix4(_mm.makeRotationFromEuler(_e.set(rx, ry, rz, 'YXZ')));
  g.translate(x, y, z);
  return g;
}
function rb(w, h, d, r, x, y, z, rx, ry, rz) {
  const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  return place(new RoundedBoxGeometry(w, h, d, 3, rr), x, y, z, rx, ry, rz);
}
function cyl(rt, rbm, h, seg, x, y, z, rx, ry, rz) {
  return place(new THREE.CylinderGeometry(rt, rbm, h, seg), x, y, z, rx, ry, rz);
}
function sph(r, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ws = 24, hs = 14) {
  const g = new THREE.SphereGeometry(r, ws, hs);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}
function lathe(pts, seg = 32, steps = 3) {
  return new THREE.LatheGeometry(smoothProfile(pts, steps), seg);
}
function extrude(points, depth, bevel = 0.01) {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 12 });
  g.translate(0, 0, -depth / 2);
  return g;
}
function torus(r, t, rs, ts, arc = Math.PI * 2) {
  return new THREE.TorusGeometry(r, t, rs, ts, arc);
}
// 재질별로 모아 하나로 합칩니다(그리기 호출 줄이기). 색인 있는 것·없는 것이 섞여 있어 모두 색인 없이 맞춥니다.
function merge(list) {
  const flat = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
    n.clearGroups();
    return n;
  });
  const m = mergeGeometries(flat, false);
  m.computeBoundingSphere();
  return m;
}
function part(spec) {
  const out = {};
  for (const [k, list] of Object.entries(spec)) if (list.length) out[k] = merge(list);
  return out;
}

// ================================================================
// 부위별 지오메트리(로봇마다 같은 것을 나눠 씁니다)
// ================================================================
let geoCache = null;
function robotGeometries() {
  if (geoCache) return geoCache;
  const P = Math.PI;

  // ---------- 골반 ----------
  const skirtF = extrude([[-0.115, 0.045], [0.115, 0.045], [0.08, -0.13], [-0.08, -0.13]], 0.022, 0.008);
  const skirtB = extrude([[-0.11, 0.045], [0.11, 0.045], [0.085, -0.12], [-0.085, -0.12]], 0.022, 0.008);
  const skirtS = () => extrude([[-0.06, 0.045], [0.06, 0.045], [0.048, -0.12], [-0.048, -0.12]], 0.02, 0.007);
  const ring = torus(0.1, 0.013, 10, 44);
  ring.rotateX(P / 2);
  ring.scale(1.25, 1, 0.86);
  ring.translate(0, 0.085, 0);
  const pelvis = part({
    frame: [rb(0.27, 0.13, 0.18, 0.04, 0, 0, 0)],
    chrome: [ring],
    armor: [place(skirtF, 0, -0.02, 0.105, -0.22), place(skirtB, 0, -0.02, -0.1, 0.22, P), place(skirtS(), 0.148, -0.02, 0, -0.2, P / 2), place(skirtS(), -0.148, -0.02, 0, -0.2, -P / 2)],
    dark: [rb(0.09, 0.09, 0.1, 0.03, 0, -0.07, 0)],
    glow: [rb(0.1, 0.012, 0.01, 0.004, 0, 0.032, 0.091)]
  });

  // ---------- 허리(배 장갑 세 겹) ----------
  const spine = part({
    dark: [cyl(0.075, 0.08, 0.2, 20, 0, 0.05, -0.01)],
    armor: [rb(0.2, 0.05, 0.15, 0.022, 0, -0.005, 0.02), rb(0.215, 0.05, 0.158, 0.022, 0, 0.05, 0.022), rb(0.232, 0.05, 0.166, 0.022, 0, 0.105, 0.024)],
    chrome: [cyl(0.009, 0.009, 0.16, 8, 0.118, 0.05, -0.03, 0, 0, 0.12), cyl(0.009, 0.009, 0.16, 8, -0.118, 0.05, -0.03, 0, 0, -0.12)]
  });

  // ---------- 가슴 ----------
  const body = extrude([[-0.19, -0.05], [-0.235, 0.1], [-0.215, 0.26], [-0.11, 0.315], [0.11, 0.315], [0.215, 0.26], [0.235, 0.1], [0.19, -0.05], [0.1, -0.085], [-0.1, -0.085]], 0.2, 0.025);
  const pecR = extrude([[0.02, 0.035], [0.165, 0.045], [0.195, 0.2], [0.105, 0.272], [0.02, 0.255]], 0.02, 0.008);
  const pecL = extrude([[-0.02, 0.035], [-0.02, 0.255], [-0.105, 0.272], [-0.195, 0.2], [-0.165, 0.045]], 0.02, 0.008);
  const coreRing = torus(0.052, 0.011, 12, 40);
  coreRing.translate(0, 0.14, 0.152);
  const coreCup = cyl(0.046, 0.046, 0.02, 32, 0, 0.14, 0.142, P / 2);
  const coreDisc = new THREE.CircleGeometry(0.037, 32);
  coreDisc.translate(0, 0.14, 0.154);
  const coreLens = sph(0.022, 0, 0.14, 0.152, 1, 1, 0.5, 20, 10);
  const pauldron = (s) => {
    const g = new THREE.SphereGeometry(0.1, 30, 14, 0, P * 2, 0, P * 0.5);
    g.scale(1.12, 0.78, 1.06);
    return place(g, s * 0.258, 0.3, 0, 0, 0, -s * 0.42);
  };
  const pauldronBase = (s) => {
    const g = new THREE.CircleGeometry(0.1, 30);
    g.rotateX(P / 2);
    g.scale(1.12, 1, 1.06);
    return place(g, s * 0.258, 0.3, 0, 0, 0, -s * 0.42);
  };
  const pauldronRim = (s) => {
    const g = torus(0.1, 0.009, 6, 36);
    g.rotateX(P / 2);
    g.scale(1.12, 1, 1.06);
    return place(g, s * 0.258, 0.3, 0, 0, 0, -s * 0.42);
  };
  const exhaust = (s) => cyl(0.026, 0.034, 0.06, 16, s * 0.075, -0.005, -0.2);
  const exhaustGlow = (s) => {
    const g = new THREE.CircleGeometry(0.022, 20);
    g.rotateX(P / 2);
    g.translate(s * 0.075, -0.037, -0.2);
    return g;
  };
  const chest = part({
    armor: [body, place(pecR, 0, 0, 0.137, -0.08), place(pecL, 0, 0, 0.137, -0.08), pauldron(1), pauldron(-1), rb(0.17, 0.045, 0.035, 0.014, 0, 0.012, 0.128, 0.15)],
    chrome: [coreRing, exhaust(1), exhaust(-1), ...[-1, 1].flatMap((sx) => [0, 1, 2].map((k) => rb(0.04, 0.008, 0.01, 0.003, sx * 0.176, 0.04 + k * 0.035, 0.136, 0, -sx * 0.35)))],
    dark: [coreCup, rb(0.26, 0.24, 0.1, 0.03, 0, 0.13, -0.155), sph(0.058, 0.235, 0.27, 0), sph(0.058, -0.235, 0.27, 0), pauldronBase(1), pauldronBase(-1)],
    frame: [rb(0.22, 0.05, 0.15, 0.02, 0, 0.318, -0.005), rb(0.05, 0.2, 0.05, 0.015, 0.14, 0.13, -0.2), rb(0.05, 0.2, 0.05, 0.015, -0.14, 0.13, -0.2),
      rb(0.05, 0.1, 0.026, 0.01, 0, 0.258, 0.146, -0.12), rb(0.045, 0.11, 0.024, 0.008, 0.172, 0.075, 0.122, 0, -0.35), rb(0.045, 0.11, 0.024, 0.008, -0.172, 0.075, 0.122, 0, 0.35)],

    stripe: [pauldronRim(1), pauldronRim(-1), rb(0.012, 0.16, 0.008, 0.004, 0.072, 0.2, 0.156, -0.08, 0, 0.5), rb(0.012, 0.16, 0.008, 0.004, -0.072, 0.2, 0.156, -0.08, 0, -0.5)],
    core: [coreDisc, coreLens],
    glow: [rb(0.008, 0.13, 0.012, 0.003, 0.212, 0.12, 0.118), rb(0.008, 0.13, 0.012, 0.003, -0.212, 0.12, 0.118), exhaustGlow(1), exhaustGlow(-1)]
  });

  // ---------- 목 ----------
  const neck = part({
    chrome: [cyl(0.036, 0.042, 0.1, 16, 0, 0.03, 0)],
    dark: [cyl(0.01, 0.01, 0.11, 6, 0.032, 0.03, -0.026), cyl(0.01, 0.01, 0.11, 6, -0.032, 0.03, -0.026)]
  });

  // ---------- 머리 ----------
  const helmet = new THREE.SphereGeometry(0.122, 36, 18, P / 2 + 0.78, P * 2 - 1.56, 0, P * 0.62);
  helmet.scale(1, 1.05, 1.08);
  helmet.translate(0, 0.015, -0.004);
  const visor = new THREE.SphereGeometry(0.113, 34, 8, P / 2 - 0.98, 1.96, P * 0.34, P * 0.24);
  visor.scale(1, 1.02, 1.1);
  const slit = new THREE.SphereGeometry(0.1145, 34, 2, P / 2 - 0.74, 1.48, P * 0.445, P * 0.05);
  slit.scale(1, 1.02, 1.1);
  const jaw = new THREE.SphereGeometry(0.116, 26, 6, P / 2 - 0.82, 1.64, P * 0.58, P * 0.2);
  jaw.scale(0.95, 1, 1.07);
  const crest = extrude([[0.07, 0.0], [-0.1, 0.0], [-0.14, 0.032], [-0.02, 0.045], [0.05, 0.018]], 0.016, 0.005);
  const antTip = new THREE.Vector3(0, 0.07, 0).applyEuler(new THREE.Euler(-0.55, 0, -0.32, 'YXZ')).add(new THREE.Vector3(0.08, 0.075, -0.05));
  const earGlow = (s) => {
    const g = torus(0.025, 0.004, 6, 24);
    g.rotateY(P / 2);
    g.translate(s * 0.138, 0, -0.006);
    return g;
  };
  const head = part({
    frame: [sph(0.104, 0, 0.005, 0, 0.95, 1.05, 1.0, 28, 16)],
    armor: [helmet, jaw, place(crest, 0, 0.122, 0, 0, -P / 2)],
    visor: [visor],
    eye: [slit],
    chrome: [cyl(0.038, 0.038, 0.034, 22, 0.12, 0, -0.006, 0, 0, P / 2), cyl(0.038, 0.038, 0.034, 22, -0.12, 0, -0.006, 0, 0, P / 2),
      place(new THREE.CylinderGeometry(0.004, 0.006, 0.14, 6), 0.08, 0.075, -0.05, -0.55, 0, -0.32)],
    glow: [earGlow(1), earGlow(-1), sph(0.009, antTip.x, antTip.y, antTip.z, 1, 1, 1, 10, 8)]
  });

  // ---------- 팔(위팔·아래팔·손). 뼈 원점에서 -Y 로 뻗고, +Z 가 팔꿈치 바깥 ----------
  const sleeve = lathe([[0, -0.225], [0.048, -0.22], [0.057, -0.17], [0.059, -0.08], [0.051, -0.04], [0, -0.035]], 28);
  const upper = part({
    chrome: [sph(0.05, 0, 0, 0, 1, 1, 1, 20, 12), sph(0.044, 0, -L_UP, 0, 1, 1, 1, 18, 12)],
    frame: [cyl(0.036, 0.032, L_UP, 16, 0, -L_UP / 2, 0)],
    armor: [sleeve],
    dark: [cyl(0.048, 0.048, 0.022, 20, 0, -L_UP + 0.04, 0)]
  });
  const gaunt = lathe([[0, -0.262], [0.047, -0.256], [0.063, -0.22], [0.061, -0.12], [0.047, -0.05], [0, -0.045]], 28);
  const wrist = torus(0.034, 0.007, 8, 24);
  wrist.rotateX(P / 2);
  wrist.translate(0, -L_FORE + 0.02, 0);
  const fore = part({
    frame: [cyl(0.03, 0.028, L_FORE, 14, 0, -L_FORE / 2, 0)],
    armor: [gaunt],
    chrome: [wrist],
    glow: [rb(0.009, 0.13, 0.012, 0.004, 0, -0.15, 0.062), rb(0.009, 0.13, 0.012, 0.004, 0, -0.15, -0.062)]
  });
  // 손: 원점 = 칼자루 쥔 곳, +Y = 칼날 방향, +Z = 손등
  const hand = part({
    frame: [rb(0.084, 0.098, 0.088, 0.026, 0, 0, 0)],
    armor: [rb(0.072, 0.086, 0.03, 0.011, 0, 0, 0.046)],
    dark: [0, 1, 2].map((k) => rb(0.09, 0.02, 0.022, 0.007, 0, -0.03 + k * 0.03, -0.044))
  });

  // ---------- 다리 ----------
  const thighA = lathe([[0, -0.4], [0.06, -0.39], [0.079, -0.3], [0.089, -0.14], [0.081, -0.06], [0, -0.05]], 30);
  const thigh = part({
    chrome: [sph(0.06, 0, 0, 0, 1, 1, 1, 20, 12), sph(0.05, 0, -L_THIGH, 0, 1, 1, 1, 18, 12)],
    frame: [cyl(0.048, 0.04, L_THIGH, 16, 0, -L_THIGH / 2, 0)],
    armor: [thighA, rb(0.096, 0.12, 0.05, 0.02, 0, -L_THIGH - 0.004, 0.056, -0.16)],
    stripe: [rb(0.012, 0.2, 0.03, 0.005, 0.087, -0.2, 0), rb(0.012, 0.2, 0.03, 0.005, -0.087, -0.2, 0)]
  });
  const calf = lathe([[0, -0.42], [0.05, -0.415], [0.058, -0.36], [0.082, -0.18], [0.075, -0.08], [0.055, -0.04], [0, -0.035]], 30);
  const shin = part({
    frame: [cyl(0.04, 0.034, L_SHIN, 14, 0, -L_SHIN / 2, 0)],
    armor: [calf, rb(0.072, 0.3, 0.04, 0.016, 0, -0.2, 0.062, 0.06)],
    chrome: [sph(0.04, 0, -L_SHIN, 0, 1, 1, 1, 16, 10)],
    glow: [rb(0.013, 0.16, 0.01, 0.004, 0, -0.2, 0.085, 0.06)]
  });
  // 발: 원점 = 발목, +Z = 앞
  const foot = part({
    frame: [rb(0.115, 0.07, 0.25, 0.028, 0, -0.045, 0.045)],
    armor: [rb(0.122, 0.052, 0.1, 0.02, 0, -0.034, 0.132, 0.12)],
    dark: [rb(0.122, 0.018, 0.262, 0.008, 0, -0.077, 0.045)]
  });

  geoCache = { pelvis, spine, chest, neck, head, upper, fore, hand, thigh, shin, foot };
  return geoCache;
}

// ================================================================
// 재질
// ================================================================
let kit = null;
function robotKit() {
  if (kit) return kit;
  // 도장 거칠기: 대체로 매끈하고 잔 얼룩·긁힘이 조금
  const S = 256;
  const rough = tex(pixels(S, S, (x, y, c) => {
    const n = fbm(x / 36, y / 36, 31, 4, S / 36, S / 36);
    let v = 80 + n * 80;
    if (hash2(x >> 1, y, 5) > 0.996) v += 80;
    c[0] = c[1] = c[2] = Math.min(255, v);
    c[3] = 255;
  }), false, true);
  kit = {
    armor: new THREE.MeshPhysicalMaterial({ color: '#ebe8e2', metalness: 0.1, roughness: 0.55, roughnessMap: rough, clearcoat: 1, clearcoatRoughness: 0.16 }),
    frame: new THREE.MeshPhysicalMaterial({ color: '#2a2f37', metalness: 0.9, roughness: 0.36, clearcoat: 0.35, clearcoatRoughness: 0.3 }),
    chrome: new THREE.MeshPhysicalMaterial({ color: '#e2e7ef', metalness: 1, roughness: 0.14 }),
    dark: new THREE.MeshStandardMaterial({ color: '#0d0f14', metalness: 0.45, roughness: 0.62 }),
    visor: new THREE.MeshPhysicalMaterial({ color: '#06070b', metalness: 0.7, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03 }),
    stripe: new THREE.MeshPhysicalMaterial({ color: '#b3197f', metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.1 })
  };
  return kit;
}

// ================================================================
// 자세
// ================================================================
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
/** 자세 하나: pel 골반 위치, pr 골반 회전, sp 허리, ch 가슴, hd 머리, g 칼자루, d 칼날 방향, fl/fr 왼발·오른발 [x, z] */
export function pose(o) {
  return {
    pel: o.pel || [0, 0.94, 0], pr: o.pr || [0, 0, 0], sp: o.sp || [0, 0, 0], ch: o.ch || [0, 0, 0], hd: o.hd || [0, 0, 0],
    g: o.g || [0, 1.2, 0.35], d: o.d || [0, 1, 0], fl: o.fl || [0.16, -0.1], fr: o.fr || [-0.15, 0.14]
  };
}
export function copyPose(a, out = pose({})) {
  for (const k of ['pel', 'pr', 'sp', 'ch', 'hd', 'g', 'd', 'fl', 'fr']) out[k] = a[k].slice();
  return out;
}
const _da = V();
const _db = V();
function slerpDir(a, b, t, out) {
  _da.set(a[0], a[1], a[2]).normalize();
  _db.set(b[0], b[1], b[2]).normalize();
  const dot = Math.max(-1, Math.min(1, _da.dot(_db)));
  const ang = Math.acos(dot);
  if (ang < 1e-4) {
    out[0] = _db.x; out[1] = _db.y; out[2] = _db.z;
    return out;
  }
  const s = Math.sin(ang);
  const wa = Math.sin((1 - t) * ang) / s;
  const wb = Math.sin(t * ang) / s;
  out[0] = _da.x * wa + _db.x * wb;
  out[1] = _da.y * wa + _db.y * wb;
  out[2] = _da.z * wa + _db.z * wb;
  return out;
}
/** a → b 사이 t 만큼(칼날 방향은 구면 보간). out 에 씁니다. */
export function mixPose(a, b, t, out) {
  for (const k of ['pel', 'pr', 'sp', 'ch', 'hd', 'g', 'fl', 'fr']) {
    const x = a[k];
    const y = b[k];
    const o = out[k];
    for (let i = 0; i < x.length; i++) o[i] = x[i] + (y[i] - x[i]) * t;
  }
  slerpDir(a.d, b.d, t, out.d);
  return out;
}
const mirrorX = (p) => pose({
  pel: [-p.pel[0], p.pel[1], p.pel[2]], pr: [p.pr[0], -p.pr[1], -p.pr[2]], sp: [p.sp[0], -p.sp[1], -p.sp[2]], ch: [p.ch[0], -p.ch[1], -p.ch[2]],
  hd: [p.hd[0], -p.hd[1], -p.hd[2]], g: [-p.g[0], p.g[1], p.g[2]], d: [-p.d[0], p.d[1], p.d[2]], fl: [-p.fr[0], p.fr[1]], fr: [-p.fl[0], p.fl[1]]
});

// 공격 방향 이름은 선수 기준입니다: left = 선수의 왼쪽으로 들어오는 베기(로봇 오른손 쪽에서 출발).
export const POSES = (() => {
  const guard = pose({ pel: [0, 0.92, 0], sp: [0.06, 0, 0], ch: [0.02, -0.08, 0], hd: [0.1, 0.06, 0], g: [-0.06, 1.18, 0.33], d: [0.3, 0.4, 0.87], fl: [0.17, -0.12], fr: [-0.15, 0.17] });
  const windLeft = pose({ pel: [0.03, 0.9, -0.05], pr: [0, -0.32, 0], sp: [0, -0.14, 0.04], ch: [-0.05, -0.3, 0.06], hd: [0.1, 0.5, -0.04], g: [-0.3, 1.72, 0.1], d: [-0.3, 0.85, -0.43], fl: [0.19, -0.1], fr: [-0.17, 0.15] });
  const hitLeft = pose({ pel: [-0.04, 0.87, 0.14], pr: [0, 0.22, 0], sp: [0.1, 0.12, 0], ch: [0.08, 0.3, -0.05], hd: [0.1, -0.45, 0], g: [-0.02, 1.3, 0.42], d: [-0.6, 0.08, 0.8], fl: [0.19, -0.12], fr: [-0.15, 0.3] });
  const followLeft = pose({ pel: [-0.02, 0.86, 0.16], pr: [0, 0.36, 0], sp: [0.12, 0.16, 0], ch: [0.08, 0.5, -0.06], hd: [0.1, -0.6, 0], g: [0.16, 1.12, 0.36], d: [0.55, -0.12, 0.82], fl: [0.19, -0.12], fr: [-0.15, 0.32] });
  const windOver = pose({ pel: [0, 0.93, -0.07], sp: [-0.12, 0, 0], ch: [-0.14, 0, 0], hd: [0.22, 0, 0], g: [0.01, 1.98, 0.04], d: [0, 0.55, -0.84], fl: [0.18, -0.14], fr: [-0.17, 0.12] });
  const hitOver = pose({ pel: [0, 0.83, 0.18], sp: [0.2, 0, 0], ch: [0.18, 0, 0], hd: [-0.05, 0, 0], g: [0.02, 1.42, 0.46], d: [0, -0.2, 0.98], fl: [0.18, -0.14], fr: [-0.16, 0.36] });
  const followOver = pose({ pel: [0, 0.8, 0.2], sp: [0.28, 0, 0], ch: [0.24, 0, 0], hd: [-0.1, 0, 0], g: [0.02, 1.06, 0.42], d: [0, -0.74, 0.67], fl: [0.18, -0.14], fr: [-0.16, 0.38] });
  const windThrust = pose({ pel: [0.02, 0.86, -0.12], pr: [0, -0.34, 0], sp: [0.04, -0.1, 0], ch: [0, -0.22, 0], hd: [0.1, 0.5, 0], g: [-0.22, 1.24, -0.04], d: [0.12, 0.12, 0.98], fl: [0.2, -0.12], fr: [-0.17, 0.1] });
  const hitThrust = pose({ pel: [0, 0.85, 0.32], pr: [0, 0.08, 0], sp: [0.1, 0.06, 0], ch: [0.1, 0.1, 0], hd: [0.05, -0.1, 0], g: [-0.03, 1.33, 0.66], d: [0.02, 0.03, 1], fl: [0.18, -0.08], fr: [-0.15, 0.5] });
  const followThrust = pose({ pel: [0, 0.84, 0.36], pr: [0, 0.1, 0], sp: [0.12, 0.08, 0], ch: [0.12, 0.12, 0], hd: [0.05, -0.12, 0], g: [-0.03, 1.33, 0.76], d: [0.02, 0.0, 1], fl: [0.18, -0.08], fr: [-0.15, 0.52] });
  const staggerL = pose({ pel: [0.04, 0.9, -0.22], sp: [-0.22, 0.05, 0], ch: [-0.26, -0.22, 0.08], hd: [-0.25, 0.18, 0.1], g: [-0.44, 1.7, -0.06], d: [-0.68, 0.68, -0.26], fl: [0.18, -0.3], fr: [-0.16, -0.02] });
  const salute = pose({ pel: [0, 0.95, 0], hd: [0.08, 0, 0], g: [0, 1.48, 0.28], d: [0, 1, 0.08], fl: [0.14, 0], fr: [-0.14, 0] });
  const victory = pose({ pel: [0, 0.96, 0], sp: [-0.06, 0, 0], ch: [-0.08, -0.12, 0], hd: [-0.12, 0.1, 0], g: [-0.24, 1.96, 0.06], d: [-0.12, 0.98, 0.12], fl: [0.17, -0.06], fr: [-0.17, 0.06] });
  const down = pose({ pel: [0.02, 0.5, -0.08], sp: [0.36, 0.05, 0], ch: [0.32, 0.1, 0.12], hd: [0.55, 0.25, 0.1], g: [-0.32, 0.52, 0.22], d: [-0.25, -0.94, 0.22], fl: [0.18, -0.36], fr: [-0.16, 0.24] });
  const carry = pose({ pel: [0, 0.95, 0], hd: [0.05, 0, 0], g: [-0.26, 0.9, 0.12], d: [0.1, -0.5, 0.86], fl: [0.13, 0], fr: [-0.13, 0] });
  const blockL = pose({ pel: [0, 0.9, -0.04], sp: [0.04, 0, 0], ch: [0, 0.12, 0], hd: [0.1, -0.1, 0], g: [0.0, 1.36, 0.36], d: [-0.9, 0.36, 0.24], fl: [0.17, -0.14], fr: [-0.15, 0.14] });
  return {
    guard, salute, victory, down, carry,
    wind: { left: windLeft, right: mirrorX(windLeft), overhead: windOver, thrust: windThrust },
    hit: { left: hitLeft, right: mirrorX(hitLeft), overhead: hitOver, thrust: hitThrust },
    follow: { left: followLeft, right: mirrorX(followLeft), overhead: followOver, thrust: followThrust },
    stagger: { left: staggerL, right: mirrorX(staggerL) },
    block: { left: blockL, right: mirrorX(blockL) }
  };
})();

// ================================================================
// 두 마디 IK 와 뼈 방향 맞추기
// ================================================================
const _d = V();
const _p = V();
const _n = V();
/** 어깨 S 에서 목표 T 로 두 마디(L1, L2). 팔꿈치는 pole 쪽으로 굽습니다. outE: 팔꿈치, outT: 실제로 닿은 끝 */
function ik(S, T, L1, L2, pole, outE, outT) {
  _d.subVectors(T, S);
  let d = _d.length();
  const maxD = L1 + L2 - 1e-3;
  const minD = Math.abs(L1 - L2) + 0.02;
  if (d < 1e-5) {
    _d.set(0, -1, 0);
    d = 1e-5;
  }
  _n.copy(_d).divideScalar(d);
  d = Math.max(minD, Math.min(maxD, d));
  outT.copy(S).addScaledVector(_n, d);
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  _p.subVectors(pole, S);
  _p.addScaledVector(_n, -_p.dot(_n));
  if (_p.lengthSq() < 1e-8) _p.set(0, 0, 1).addScaledVector(_n, -_n.z);
  _p.normalize();
  outE.copy(S).addScaledVector(_n, a).addScaledVector(_p, h);
}
const _bx = V();
const _by = V();
const _bz = V();
const _bm = new THREE.Matrix4();
/** 뼈 obj 를 from 에 두고 로컬 -Y 가 to 를 향하게, 로컬 +Z 는 front 쪽으로 */
function orientBone(obj, from, to, front) {
  _by.subVectors(from, to);
  if (_by.lengthSq() < 1e-10) _by.set(0, 1, 0);
  _by.normalize();
  _bz.copy(front).addScaledVector(_by, -front.dot(_by));
  if (_bz.lengthSq() < 1e-8) _bz.set(0, 0, 1).addScaledVector(_by, -_by.z);
  if (_bz.lengthSq() < 1e-8) _bz.set(1, 0, 0);
  _bz.normalize();
  _bx.crossVectors(_by, _bz);
  obj.position.copy(from);
  obj.quaternion.setFromRotationMatrix(_bm.makeBasis(_bx, _by, _bz));
}

// ================================================================
// 로봇 한 대
// ================================================================
const UP = V(0, 1, 0);
export function makeRobot() {
  const K = robotKit();
  const G = robotGeometries();
  const glowM = new THREE.MeshBasicMaterial({ color: hdr(ENEMY, 1.8) });
  const coreM = new THREE.MeshBasicMaterial({ color: hdr(ENEMY, 3) });
  const eyeM = new THREE.MeshBasicMaterial({ color: hdr(ENEMY, 4) });
  const mats = { ...K, glow: glowM, core: coreM, eye: eyeM };
  const glowKinds = new Set(['glow', 'core', 'eye']);
  const root = new THREE.Group();
  root.name = 'robot';
  function build(name) {
    const g = new THREE.Group();
    for (const [m, geo] of Object.entries(G[name])) {
      const mesh = new THREE.Mesh(geo, mats[m]);
      mesh.castShadow = !glowKinds.has(m);
      mesh.receiveShadow = m === 'armor';
      g.add(mesh);
    }
    return g;
  }
  const pelvis = build('pelvis');
  root.add(pelvis);
  const spine = build('spine');
  spine.position.y = SPINE_Y;
  pelvis.add(spine);
  const chest = build('chest');
  chest.position.y = CHEST_Y;
  spine.add(chest);
  const neck = build('neck');
  neck.position.y = NECK_Y;
  chest.add(neck);
  const head = build('head');
  head.position.y = HEAD_Y;
  head.scale.setScalar(1.12);
  neck.add(head);
  // 0 = 로봇 오른쪽(-X), 1 = 왼쪽(+X)
  const sh = [-1, 1].map((s) => {
    const o = new THREE.Object3D();
    o.position.set(s * SHOULDER[0], SHOULDER[1], SHOULDER[2]);
    chest.add(o);
    return o;
  });
  const hips = [-1, 1].map((s) => {
    const o = new THREE.Object3D();
    o.position.set(s * HIP[0], HIP[1], HIP[2]);
    pelvis.add(o);
    return o;
  });
  const limbs = (name) => [build(name), build(name)];
  const upper = limbs('upper');
  const fore = limbs('fore');
  const hand = limbs('hand');
  const thigh = limbs('thigh');
  const shin = limbs('shin');
  const foot = limbs('foot');
  for (const list of [upper, fore, hand, thigh, shin, foot]) for (const o of list) root.add(o);

  // 칼(세계 좌표에 직접 그림)
  const hilt = makeHilt(ENEMY);
  hilt.scale.setScalar(R_HILT);
  const blade = makeBlade(ENEMY);
  const trail = makeTrail(ENEMY, 18);
  // 가슴 코어 빛(약점이 드러날 때 크게)
  const coreFlare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: hdr(ENEMY, 2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  coreFlare.scale.set(0.2, 0.2, 1);
  coreFlare.position.set(0, 0.14, 0.17);
  chest.add(coreFlare);
  const eyeFlare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: hdr(ENEMY, 2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  eyeFlare.scale.set(0.001, 0.001, 1);
  eyeFlare.position.set(0, 0.005, 0.13);
  head.add(eyeFlare);

  const cur = copyPose(POSES.guard);
  const w = {
    S: V(), T: V(), E: V(), R: V(), pole: V(), front: V(), grip: V(), dir: V(0, 1, 0), handR: V(), handL: V(),
    emitter: V(), tip: V(), prevTip: V(), prevIn: V(), wpos: V(), lift: [0, 0]
  };
  const state = { power: 0, flick: 1, trailK: 0, visible: true, trailInit: false };
  const _q = new THREE.Quaternion();
  const _hz = V();
  const _tmp = V();

  /** 자세를 몸에 적용합니다. now(초)는 깜빡임용. */
  function apply(p, dt = 1 / 60) {
    copyPose(p, cur);
    pelvis.position.set(p.pel[0], p.pel[1], p.pel[2]);
    pelvis.rotation.set(p.pr[0], p.pr[1], p.pr[2], 'YXZ');
    spine.rotation.set(p.sp[0], p.sp[1], p.sp[2], 'YXZ');
    chest.rotation.set(p.ch[0], p.ch[1], p.ch[2], 'YXZ');
    head.rotation.set(p.hd[0], p.hd[1], p.hd[2], 'YXZ');
    neck.rotation.set(p.hd[0] * 0.3, p.hd[1] * 0.3, 0, 'YXZ');
    root.updateMatrixWorld(true);
    const rp = root.position;

    // 칼자루·칼날 방향
    w.dir.set(p.d[0], p.d[1], p.d[2]).normalize();
    w.grip.set(p.g[0], p.g[1], p.g[2]);
    // 오른손(위 손) 먼저: 닿지 않으면 칼자루를 손이 닿은 곳으로 옮깁니다(손과 칼이 떨어져 보이지 않게).
    for (let s = 0; s < 2; s++) {
      const sx = s === 0 ? -1 : 1;
      sh[s].getWorldPosition(w.S).sub(rp);
      if (s === 0) w.T.copy(w.grip).addScaledVector(w.dir, HAND_R);
      else w.T.copy(w.grip).addScaledVector(w.dir, HAND_L);
      w.pole.copy(w.S).add(_tmp.set(sx * 0.6, -0.9, -0.55));
      ik(w.S, w.T, L_UP, L_FORE, w.pole, w.E, w.R);
      if (s === 0) {
        // 칼자루 위치를 오른손이 실제로 닿은 곳에 맞춤
        w.grip.copy(w.R).addScaledVector(w.dir, -HAND_R);
      }
      // 팔꿈치 바깥 방향 = 어깨-손 선분에서 팔꿈치 쪽
      w.front.addVectors(w.S, w.R).multiplyScalar(0.5);
      w.front.subVectors(w.E, w.front);
      if (w.front.lengthSq() < 1e-6) w.front.set(sx, -0.3, -0.3);
      orientBone(upper[s], w.S, w.E, w.front);
      orientBone(fore[s], w.E, w.R, w.front);
      // 손: +Y = 칼날 방향, +Z(손등) = 아래팔에서 바깥쪽
      _hz.subVectors(w.R, w.E).normalize();
      _hz.addScaledVector(w.dir, -_hz.dot(w.dir));
      if (_hz.lengthSq() < 1e-6) _hz.set(sx, 0, 0);
      _hz.normalize();
      _bx.crossVectors(w.dir, _hz);
      hand[s].position.copy(w.R);
      hand[s].quaternion.setFromRotationMatrix(_bm.makeBasis(_bx, w.dir, _hz));
    }
    // 다리
    for (let s = 0; s < 2; s++) {
      const sx = s === 0 ? -1 : 1;
      hips[s].getWorldPosition(w.S).sub(rp);
      const f = s === 0 ? p.fr : p.fl;
      w.T.set(f[0], ANKLE_H + w.lift[s], f[1]);
      w.pole.copy(w.S).add(_tmp.set(sx * 0.18, -0.2, 1));
      ik(w.S, w.T, L_THIGH, L_SHIN, w.pole, w.E, w.R);
      w.front.set(sx * 0.12, 0, 1);
      orientBone(thigh[s], w.S, w.E, w.front);
      orientBone(shin[s], w.E, w.R, w.front);
      foot[s].position.copy(w.R);
      foot[s].rotation.set(0, p.pr[1] * 0.4 + sx * 0.14, 0);
    }

    // 칼(세계 좌표)
    w.wpos.copy(w.grip).add(rp);
    hilt.position.copy(w.wpos);
    _hz.set(0, 0, 1).addScaledVector(w.dir, -w.dir.z);
    if (_hz.lengthSq() < 1e-6) _hz.set(1, 0, 0);
    _hz.normalize();
    _bx.crossVectors(w.dir, _hz);
    hilt.quaternion.setFromRotationMatrix(_bm.makeBasis(_bx, w.dir, _hz));
    hilt.visible = state.visible;
    hilt.userData.setPower(state.power);
    w.prevTip.copy(w.tip);
    w.emitter.copy(w.wpos).addScaledVector(w.dir, HILT.emitter * R_HILT);
    const e = state.power;
    const len = R_BLADE * (e < 1 ? 1 - Math.pow(1 - e, 3) : 1);
    w.tip.copy(w.emitter).addScaledVector(w.dir, Math.max(0.0001, len));
    blade.setVisible(state.visible);
    blade.set(w.emitter, w.dir, len, e, state.flick);
    // 로봇 칼빛은 몸(아이보리 장갑)을 너무 물들이지 않게 약하게
    blade.light.intensity *= 0.22;
    // 잔상: 칼끝이 빠르게 움직일 때. 순간 이동(자리 옮김)은 잔상을 지웁니다.
    const jump = w.tip.distanceTo(w.prevTip);
    if (jump > 0.9 || !state.trailInit) {
      trail.clear();
      state.trailInit = true;
      return;
    }
    const sp = jump / Math.max(0.008, dt);
    const k = Math.min(1, Math.max(0, (sp - 2) / 6)) * (e > 0.5 ? 1 : 0) + state.trailK;
    w.prevIn.copy(w.emitter).addScaledVector(w.dir, len * 0.3);
    trail.push(w.prevIn, w.tip, state.visible ? Math.min(1, k) : 0);
  }

  function setGlow(eye, core, strips) {
    eyeM.color.set(ENEMY).multiplyScalar(eye);
    coreM.color.set(ENEMY).multiplyScalar(core);
    glowM.color.set(ENEMY).multiplyScalar(strips);
    coreFlare.material.opacity = Math.min(1, Math.max(0, (core - 1.5) / 6));
    const cs = 0.12 + Math.max(0, core - 2) * 0.05;
    coreFlare.scale.set(cs, cs, 1);
    const es = 0.02 + Math.max(0, eye - 4) * 0.02;
    eyeFlare.scale.set(es * 2.4, es, 1);
    eyeFlare.material.opacity = Math.min(1, Math.max(0, (eye - 3.5) / 5));
  }

  function addTo(scene) {
    scene.add(root, hilt, blade.group, blade.refl, blade.reflCore, trail.mesh);
  }
  function setVisible(v) {
    state.visible = v;
    root.visible = v;
    hilt.visible = v;
    // 칼날 묶음(점광원 포함)은 장면에 그대로 두고 빛만 끕니다(빛 개수가 바뀌면 셰이더를 다시 만듦).
    if (!v) {
      blade.set(w.emitter, w.dir, 0.0001, 0, 1);
      trail.clear();
    }
  }
  apply(cur);
  return {
    root, pelvis, chest, head, hilt, blade, trail, w, state, cur,
    apply, setGlow, addTo, setVisible,
    /** 몸통 표면 근처 점(로봇 기준 → 세계). 맞은 곳 불꽃용 */
    bodyPoint(local, out) {
      return chest.localToWorld(out.copy(local));
    },
    headPos(out) { return head.getWorldPosition(out); }
  };
}

// ================================================================
// 공격 예고 빛 줄: 선수 앞에 칼이 들어올 길을 곡선 띠로 그리고, 칠 때까지 남은 시간만큼 앞에서부터 차오릅니다.
// 찌르기는 가슴 앞에 좁아지는 고리 셋으로 보여 줍니다. 좌표는 스테이션 원점 기준(선수는 -Z 를 봄).
// ================================================================
const TEL_VS = /* glsl */`
attribute float aT;
attribute float aS;
varying float vT;
varying float vS;
void main() {
  vT = aT;
  vS = aS;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const TEL_FS = /* glsl */`
uniform vec3 uColor;
uniform float uProg;
uniform float uAlpha;
uniform float uTime;
varying float vT;
varying float vS;
void main() {
  float core = exp(-vS * vS * 5.0);
  float edge = smoothstep(1.0, 0.55, abs(vS));
  float filled = smoothstep(uProg + 0.025, uProg - 0.025, vT);
  float dash = 0.45 + 0.55 * step(0.5, fract(vT * 8.0 - uTime * 2.2));
  float head = exp(-pow((vT - uProg) * 12.0, 2.0)) * 1.4;
  float a = (0.22 * dash * edge + filled * (0.8 * core + 0.3 * edge) + head * core) * uAlpha;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;
const TEL_PATHS = {
  left: [[-1.12, 2.02, -1.24], [-0.94, 1.74, -1.05], [-0.62, 1.5, -0.9], [-0.24, 1.36, -0.82]],
  right: [[1.12, 2.02, -1.24], [0.94, 1.74, -1.05], [0.62, 1.5, -0.9], [0.24, 1.36, -0.82]],
  overhead: [[0.02, 2.06, -1.18], [0.02, 1.86, -1.02], [0.01, 1.64, -0.9], [0, 1.44, -0.82]]
};
let telGeo = null;
function ribbon(points, w0, w1) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => V(...p)));
  const N = 56;
  const pos = [];
  const aT = [];
  const aS = [];
  const view = V(0, 0, 1);
  const side = V();
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    side.crossVectors(tan, view).normalize();
    const wd = w0 + (w1 - w0) * t;
    for (const s of [-1, 1]) {
      pos.push(p.x + side.x * wd * s, p.y + side.y * wd * s, p.z + side.z * wd * s);
      aT.push(t);
      aS.push(s);
    }
  }
  const idx = [];
  for (let i = 0; i < N; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  // 화살촉
  const end = curve.getPointAt(1);
  const tan = curve.getTangentAt(1);
  side.crossVectors(tan, view).normalize();
  const base = pos.length / 3;
  const hw = w1 * 2.6;
  pos.push(end.x + side.x * hw, end.y + side.y * hw, end.z + side.z * hw);
  pos.push(end.x - side.x * hw, end.y - side.y * hw, end.z - side.z * hw);
  pos.push(end.x + tan.x * 0.16, end.y + tan.y * 0.16, end.z + tan.z * 0.16);
  aT.push(0.985, 0.985, 0.985);
  aS.push(-0.4, 0.4, 0);
  idx.push(base, base + 1, base + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
function rings() {
  // 찌르기: 바깥에서 안으로 좁아지는 고리 셋(aT 0, .5, 1)
  const pos = [];
  const aT = [];
  const aS = [];
  const idx = [];
  const c = V(0, 1.38, -1.2);
  const R = [0.25, 0.16, 0.075];
  const N = 48;
  R.forEach((r, k) => {
    const base = pos.length / 3;
    const wd = 0.02 - k * 0.003;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      for (const s of [-1, 1]) {
        const rr = r + wd * s;
        pos.push(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr, c.z);
        aT.push(k / 2);
        aS.push(s);
      }
    }
    for (let i = 0; i < N; i++) {
      const a = base + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
function telGeometries() {
  if (telGeo) return telGeo;
  telGeo = {
    left: ribbon(TEL_PATHS.left, 0.035, 0.05),
    right: ribbon(TEL_PATHS.right, 0.035, 0.05),
    overhead: ribbon(TEL_PATHS.overhead, 0.035, 0.05),
    thrust: rings()
  };
  return telGeo;
}
export function makeTelegraph() {
  const G = telGeometries();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: hdr(ENEMY, 2.4) }, uProg: { value: 0 }, uAlpha: { value: 0 }, uTime: { value: 0 } },
    vertexShader: TEL_VS,
    fragmentShader: TEL_FS,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(G.left, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.visible = false;
  return {
    mesh,
    /** kind: left|right|overhead|thrust, prog 0~1(찰수록 칠 때가 가까움), alpha 0~1 */
    set(kind, prog, alpha, t, x) {
      if (!kind || alpha <= 0.001) {
        mesh.visible = false;
        return;
      }
      mesh.visible = true;
      mesh.geometry = G[kind] || G.left;
      mesh.position.set(x, 0, 0);
      mat.uniforms.uProg.value = prog;
      mat.uniforms.uAlpha.value = alpha;
      mat.uniforms.uTime.value = t;
    },
    hide() { mesh.visible = false; }
  };
}
