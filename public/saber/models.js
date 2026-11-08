// 광선검 3D 모델: 칼자루(선반 단면·그립 홈·이미터 덮개·작동 버튼·선수 색 띠), 칼날(흰 심 + 선수 색 빛 + 바닥 반사),
// 휘두를 때 남는 잔상 리본, 훈련용 드론, 드론이 쏘는 광탄, 불꽃·섬광·파편, 훈련장(광택 바닥·벽·천장 조명·홀로그램 표시).
// 빛나는 것은 모두 HDR 값(1 보다 큼)으로 그려 블룸이 그 부분만 번지게 합니다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const V2 = (x, y) => new THREE.Vector2(x, y);
const FONT_D = 'Anton, Impact, "Pretendard Variable", sans-serif';
const FONT_S = '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", sans-serif';

// 훈련장의 자리(스테이션) x 좌표. 선수는 모두 -Z 쪽(드론 쪽)을 봅니다.
export const STATION_X = [-18, -6, 6, 18];
export const ENEMY = '#ff3ddf';

// ================================================================
// 텍스처 도구
// ================================================================
export function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}
export function tex(c, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
export function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x, y, s, px = 1e9, py = 1e9) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const m = (a, p) => ((a % p) + p) % p;
  const x0 = m(xi, px), x1 = m(xi + 1, px), y0 = m(yi, py), y1 = m(yi + 1, py);
  const a = hash2(x0, y0, s), b = hash2(x1, y0, s), c = hash2(x0, y1, s), d = hash2(x1, y1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, s, oct = 4, px = 1e9, py = 1e9) {
  let f = 0;
  let amp = 0.5;
  let k = 1;
  for (let o = 0; o < oct; o++) {
    f += vnoise(x * k, y * k, s + o * 17, px * k, py * k) * amp;
    amp *= 0.5;
    k *= 2;
  }
  return f;
}
export function pixels(w, h, fn) {
  return canvas(w, h, (g) => {
    const img = g.createImageData(w, h);
    const d = img.data;
    const c = [0, 0, 0, 255];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        fn(x, y, c);
        const k = (y * w + x) * 4;
        d[k] = c[0];
        d[k + 1] = c[1];
        d[k + 2] = c[2];
        d[k + 3] = c[3];
      }
    }
    g.putImageData(img, 0, 0);
  });
}
// 높이(0~1) 캔버스 → 법선 맵
function normalFromCanvas(src, strength) {
  const w = src.width;
  const h = src.height;
  const sd = src.getContext('2d').getImageData(0, 0, w, h).data;
  const H = (x, y) => sd[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  return pixels(w, h, (x, y, c) => {
    const nx = (H(x - 1, y) - H(x + 1, y)) * strength;
    const ny = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(nx, ny, 1);
    c[0] = ((nx / l) * 0.5 + 0.5) * 255;
    c[1] = ((ny / l) * 0.5 + 0.5) * 255;
    c[2] = ((1 / l) * 0.5 + 0.5) * 255;
    c[3] = 255;
  });
}
export const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

// ---------- 공용 빛 텍스처 ----------
export const glowTex = tex(canvas(128, 128, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.18, 'rgba(255,255,255,.6)');
  r.addColorStop(0.5, 'rgba(255,255,255,.12)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, w, h);
}));
const ringTex = tex(canvas(256, 256, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w / 2);
  r.addColorStop(0, 'rgba(255,255,255,0)');
  r.addColorStop(0.55, 'rgba(255,255,255,.9)');
  r.addColorStop(0.7, 'rgba(255,255,255,.25)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, w, h);
}));

// ================================================================
// 빛줄기(빔) 셰이더: 두 끝점 사이를 카메라를 향한 띠로 그리고, 가로로 가우스 감쇠, 끝은 둥글게.
// 칼날 바깥 빛, 광탄, 바닥 반사가 모두 이것을 씁니다. 뷰포트마다 카메라가 달라도 셰이더에서 맞춥니다.
// ================================================================
const BEAM_VS = /* glsl */`
attribute vec2 seg;
uniform vec3 uA;
uniform vec3 uB;
uniform float uWidth;
varying vec2 vSeg;
void main() {
  vec3 a = (viewMatrix * vec4(uA, 1.0)).xyz;
  vec3 b = (viewMatrix * vec4(uB, 1.0)).xyz;
  vec3 d = b - a;
  float len = length(d);
  vec3 dir = len > 1e-5 ? d / len : vec3(0.0, 1.0, 0.0);
  float t = clamp(seg.x, 0.0, 1.0);
  float ext = seg.x < 0.0 ? seg.x : (seg.x > 1.0 ? seg.x - 1.0 : 0.0);
  vec3 p = mix(a, b, t);
  vec3 toCam = normalize(-p);
  vec3 side = cross(dir, toCam);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  p += dir * ext * uWidth;
  p += side * seg.y * uWidth;
  vSeg = vec2(ext, seg.y);
  gl_Position = projectionMatrix * vec4(p, 1.0);
}`;
const BEAM_FS = /* glsl */`
uniform vec3 uColor;
uniform float uIntensity;
uniform float uSharp;
varying vec2 vSeg;
void main() {
  float r2 = vSeg.x * vSeg.x + vSeg.y * vSeg.y;
  float g = exp(-r2 * uSharp) - exp(-uSharp);
  if (g <= 0.0) discard;
  gl_FragColor = vec4(uColor * g * uIntensity, 1.0);
}`;
let beamGeo = null;
function beamGeometry() {
  if (beamGeo) return beamGeo;
  const rows = [-1, 0, 1, 2];
  const seg = [];
  const pos = [];
  for (const r of rows) {
    for (const s of [-1, 1]) {
      seg.push(r, s);
      pos.push(0, 0, 0);
    }
  }
  const idx = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('seg', new THREE.Float32BufferAttribute(seg, 2));
  g.setIndex(idx);
  // 정점이 셰이더에서 정해지므로 화면 밖으로 잘못 잘리지 않게 경계를 크게 둡니다.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  beamGeo = g;
  return g;
}
export function makeBeam({ color, width = 0.05, intensity = 1, sharp = 3.2, order = 0 }) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uA: { value: new THREE.Vector3() },
      uB: { value: new THREE.Vector3(0, 1, 0) },
      uWidth: { value: width },
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
      uSharp: { value: sharp }
    },
    vertexShader: BEAM_VS,
    fragmentShader: BEAM_FS,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(beamGeometry(), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  mesh.userData.u = mat.uniforms;
  return mesh;
}

// 가장자리로 갈수록 옅어지는 원통 빛(칼날 안쪽 빛)
const FRES_VS = /* glsl */`
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const FRES_FS = /* glsl */`
uniform vec3 uColor;
uniform float uIntensity;
uniform float uPow;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = abs(dot(normalize(vN), normalize(vV)));
  gl_FragColor = vec4(uColor * pow(f, uPow) * uIntensity, 1.0);
}`;
function fresnelMat(color, intensity, pow) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: intensity }, uPow: { value: pow } },
    vertexShader: FRES_VS,
    fragmentShader: FRES_FS,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
}

// ================================================================
// 칼자루. 로컬 +Y = 칼날 방향, 원점 = 손으로 쥐는 곳, +Z = 작동 버튼 쪽(폰 화면 쪽).
// ================================================================
export const HILT = { bottom: -0.105, emitter: 0.159, top: 0.178 };

export const brushedTex = tex(pixels(64, 512, (x, y, c) => {
  // 둘레 방향 헤어라인: 줄(v)마다 거칠기가 조금씩 다릅니다. (lathe 의 v = 단면 위치)
  const line = hash2(0, y, 7) * 0.55 + hash2(1, y >> 1, 9) * 0.3 + vnoise(x / 9, y / 2, 3) * 0.15;
  const v = 120 + line * 90;
  c[0] = c[1] = c[2] = v;
  c[3] = 255;
}), false, true);

let hiltShared = null;
function hiltMaterials() {
  if (hiltShared) return hiltShared;
  hiltShared = {
    steel: new THREE.MeshPhysicalMaterial({ color: '#c7ccd4', metalness: 1, roughness: 0.42, roughnessMap: brushedTex, clearcoat: 0.35, clearcoatRoughness: 0.22 }),
    chrome: new THREE.MeshPhysicalMaterial({ color: '#eef2f8', metalness: 1, roughness: 0.1 }),
    dark: new THREE.MeshPhysicalMaterial({ color: '#23272e', metalness: 0.85, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.3 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#121316', metalness: 0, roughness: 0.82 }),
    black: new THREE.MeshStandardMaterial({ color: '#050608', metalness: 0.3, roughness: 0.6 })
  };
  return hiltShared;
}

export function smoothProfile(pts, steps = 3) {
  // 꺾인 점 사이를 캐트멀-롬으로 이어 매끈한 단면을 만듭니다(모서리는 점을 겹쳐 두면 날카롭게 남음).
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push(V2(Math.max(0, f(p0[0], p1[0], p2[0], p3[0])), f(p0[1], p1[1], p2[1], p3[1])));
    }
  }
  const l = pts[pts.length - 1];
  out.push(V2(l[0], l[1]));
  return out;
}

let hiltGeo = null;
function hiltGeometries() {
  if (hiltGeo) return hiltGeo;
  // 본체(강철): 폼멜 → 심 → 위 칼라 → 조작부 → 목 → 이미터 덮개(안쪽 벽까지)
  const body = new THREE.LatheGeometry(smoothProfile([
    [0, -0.105], [0.009, -0.105], [0.014, -0.1035], [0.0178, -0.1], [0.0192, -0.095], [0.0194, -0.089],
    [0.0186, -0.0855], [0.0176, -0.083], [0.0162, -0.079], [0.0159, -0.075], [0.0159, 0.05], [0.0164, 0.052],
    [0.0166, 0.068], [0.0172, 0.07], [0.0172, 0.072], [0.0167, 0.074], [0.0167, 0.114], [0.0174, 0.1165],
    [0.0176, 0.119], [0.0146, 0.1215], [0.0144, 0.127], [0.0168, 0.129], [0.0186, 0.1335], [0.0192, 0.148],
    [0.0204, 0.1585], [0.0218, 0.1665], [0.0224, 0.1705], [0.0221, 0.1722], [0.0204, 0.1722], [0.0188, 0.169],
    [0.0176, 0.162], [0.0174, 0.1585], [0.009, 0.1582], [0, 0.1582]
  ], 3), 56);
  // 고무 그립: 홈이 파인 슬리브
  const gp = [[0.0159, -0.075]];
  const per = 0.0074;
  for (let y = -0.0745; y < 0.047; y += per) {
    gp.push([0.0171, y], [0.0186, y + 0.0012], [0.0187, y + 0.0045], [0.0172, y + 0.0062]);
  }
  gp.push([0.0171, 0.0485], [0.0159, 0.049]);
  const grip = new THREE.LatheGeometry(gp.map(([r, y]) => V2(r, y)), 48);
  // 선수 색 띠(위 칼라)와 폼멜 띠
  const band = new THREE.LatheGeometry(smoothProfile([[0.0164, 0.0515], [0.0181, 0.053], [0.0188, 0.0555], [0.0189, 0.06], [0.0188, 0.0645], [0.0181, 0.067], [0.0165, 0.0685]], 3), 48);
  const band2 = new THREE.LatheGeometry(smoothProfile([[0.0186, -0.0858], [0.0197, -0.0848], [0.0198, -0.081], [0.0186, -0.0795]], 2), 48);
  // 크롬 고리
  const ringA = new THREE.TorusGeometry(0.0168, 0.0011, 8, 48);
  ringA.rotateX(Math.PI / 2);
  ringA.translate(0, 0.0712, 0);
  const ringB = ringA.clone();
  ringB.translate(0, 0.0435, 0);
  const ringC = new THREE.TorusGeometry(0.0161, 0.001, 8, 48);
  ringC.rotateX(Math.PI / 2);
  ringC.translate(0, -0.0765, 0);
  const rings = mergeGeometries([ringA, ringB, ringC]);
  // 이미터 덮개의 발톱 4개
  const claw = new THREE.Shape();
  claw.moveTo(0, 0);
  claw.lineTo(0.0032, 0);
  claw.quadraticCurveTo(0.0052, 0.022, 0.0036, 0.0425);
  claw.lineTo(0.0016, 0.046);
  claw.quadraticCurveTo(0.0008, 0.03, 0, 0.02);
  claw.closePath();
  const cg = new THREE.ExtrudeGeometry(claw, { depth: 0.0036, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0005, bevelSegments: 2, curveSegments: 10 });
  cg.translate(0, 0, -0.0018);
  const claws = [];
  for (let k = 0; k < 4; k++) {
    const g = cg.clone();
    g.translate(0.0186, 0.1305, 0);
    g.rotateY(Math.PI / 4 + (k * Math.PI) / 2);
    claws.push(g);
  }
  const clawGeo = mergeGeometries(claws);
  // 덮개 환기구(어두운 홈) 6개
  const vents = [];
  for (let k = 0; k < 6; k++) {
    const g = new THREE.BoxGeometry(0.0016, 0.011, 0.0034);
    g.translate(0.0191, 0.1445, 0);
    g.rotateY((k * Math.PI) / 3);
    vents.push(g);
  }
  const ventGeo = mergeGeometries(vents);
  // 조작부 판, 버튼, 슬라이더, 수정 창
  const plate = new RoundedBoxGeometry(0.0128, 0.037, 0.006, 2, 0.0014);
  plate.translate(0, 0.0935, 0.0164);
  const button = new THREE.CylinderGeometry(0.0034, 0.0039, 0.0042, 24);
  button.rotateX(Math.PI / 2);
  button.translate(0, 0.1025, 0.0212);
  const guard = new THREE.TorusGeometry(0.0046, 0.0008, 8, 24);
  guard.translate(0, 0.1025, 0.0196);
  const slider = new RoundedBoxGeometry(0.0042, 0.0085, 0.0034, 2, 0.0008);
  slider.translate(0, 0.0835, 0.0204);
  const slot = new THREE.BoxGeometry(0.003, 0.028, 0.0062);
  slot.translate(0.0158, 0.093, 0);
  const crystal = new THREE.BoxGeometry(0.0022, 0.022, 0.0036);
  crystal.translate(0.0168, 0.093, 0);
  const screws = [];
  for (const y of [0.0785, 0.1085]) {
    const s = new THREE.CylinderGeometry(0.0011, 0.0011, 0.0012, 10);
    s.rotateX(Math.PI / 2);
    s.translate(0.0038, y + 0.0004, 0.0196);
    screws.push(s);
  }
  // 이미터: 안쪽 원판 + 빛나는 원 + 렌즈
  const disc = new THREE.CircleGeometry(0.0175, 40);
  disc.rotateX(-Math.PI / 2);
  disc.translate(0, 0.1584, 0);
  const glow = new THREE.RingGeometry(0.0035, 0.0105, 40);
  glow.rotateX(-Math.PI / 2);
  glow.translate(0, 0.1588, 0);
  const lens = new THREE.SphereGeometry(0.0042, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  lens.translate(0, 0.1584, 0);
  hiltGeo = {
    body, grip, band, band2, rings, clawGeo, ventGeo, plate, button, guard, slider, slot, crystal,
    screws: mergeGeometries(screws), disc, glow, lens
  };
  return hiltGeo;
}

export function makeHilt(color) {
  const G = hiltGeometries();
  const M = hiltMaterials();
  const accent = new THREE.MeshPhysicalMaterial({ color, metalness: 0.7, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.08 });
  const lit = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.25), emissive: color, emissiveIntensity: 0.4, roughness: 0.3 });
  const emit = new THREE.MeshBasicMaterial({ color: hdr(color, 0.4) });
  const lensM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.4, 0.4) });
  const group = new THREE.Group();
  const add = (geo, mat, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow;
    group.add(m);
    return m;
  };
  add(G.body, M.steel);
  add(G.grip, M.rubber);
  add(G.band, accent);
  add(G.band2, accent);
  add(G.rings, M.chrome);
  add(G.clawGeo, M.steel);
  add(G.ventGeo, M.black, false);
  add(G.plate, M.dark);
  add(G.button, lit);
  add(G.guard, M.chrome);
  add(G.slider, M.chrome);
  add(G.slot, M.black, false);
  add(G.crystal, lit, false);
  add(G.screws, M.chrome, false);
  add(G.disc, M.dark, false);
  add(G.glow, emit, false);
  add(G.lens, lensM, false);
  group.userData.setPower = (k) => {
    // k: 0 = 꺼짐, 1 = 켜짐(칼날이 나와 있음)
    lit.emissiveIntensity = 0.4 + k * 3.2;
    emit.color.set(color).multiplyScalar(0.4 + k * 5);
    lensM.color.setScalar(0.4 + k * 7);
  };
  group.userData.dispose = () => {
    accent.dispose();
    lit.dispose();
    emit.dispose();
    lensM.dispose();
  };
  return group;
}

// ================================================================
// 칼날: 흰 심(HDR) + 안쪽 빛(프레넬 원통) + 바깥 빛(빔) + 넓은 아지랑이 + 끝/밑동 빛 + 바닥 반사 + 점광원
// ================================================================
export const BLADE_LEN = 1.02;
const CORE_R = 0.0108;
const INNER_R = 0.022;
let bladeGeo = null;
function bladeGeometries() {
  if (bladeGeo) return bladeGeo;
  const core = new THREE.CylinderGeometry(CORE_R, CORE_R, 1, 18, 1, true);
  core.translate(0, 0.5, 0);
  const coreTip = new THREE.SphereGeometry(CORE_R, 18, 10);
  const inner = new THREE.CylinderGeometry(INNER_R, INNER_R, 1, 24, 1, true);
  inner.translate(0, 0.5, 0);
  const innerTip = new THREE.SphereGeometry(INNER_R, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  bladeGeo = { core, coreTip, inner, innerTip };
  return bladeGeo;
}

const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export function makeBlade(color) {
  const G = bladeGeometries();
  const c = new THREE.Color(color);
  const white = new THREE.Color(1, 1, 1).lerp(c, 0.12);
  const group = new THREE.Group();
  const coreM = new THREE.MeshBasicMaterial({ color: white.clone().multiplyScalar(7) });
  const core = new THREE.Mesh(G.core, coreM);
  const coreTip = new THREE.Mesh(G.coreTip, coreM);
  const innerM = fresnelMat(c.clone().multiplyScalar(2.8), 1, 1.8);
  const inner = new THREE.Mesh(G.inner, innerM);
  const innerTip = new THREE.Mesh(G.innerTip, innerM);
  for (const m of [core, coreTip, inner, innerTip]) {
    m.frustumCulled = false;
    group.add(m);
  }
  const glow = makeBeam({ color: c.clone().multiplyScalar(1.6), width: 0.055, sharp: 3.4 });
  const haze = makeBeam({ color: c.clone().multiplyScalar(0.16), width: 0.15, sharp: 2.6 });
  group.add(glow, haze);
  const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: c.clone().multiplyScalar(3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  flare.scale.set(0.09, 0.09, 1);
  group.add(flare);
  const light = new THREE.PointLight(color, 0, 7, 2);
  group.add(light);

  // 바닥 반사(바닥 아래로 뒤집힌 빛). 반투명 바닥보다 먼저 그립니다.
  const refl = makeBeam({ color: c.clone().multiplyScalar(1.6), width: 0.16, sharp: 2.4, order: -2 });
  const reflCore = makeBeam({ color: white.clone().multiplyScalar(2.2), width: 0.035, sharp: 3, order: -2 });

  const base = new THREE.Vector3();
  const tip = new THREE.Vector3();
  let visible = true;

  function set(b, dir, len, power, flick) {
    // b: 밑동(이미터) 위치, dir: 칼날 방향(단위), len: 지금 길이(점화 중엔 짧음), power: 0~1 밝기, flick: 깜빡임 배율
    base.copy(b);
    tip.copy(b).addScaledVector(dir, Math.max(0.0001, len));
    const on = len > 0.004 && power > 0.01;
    for (const m of [core, coreTip, inner, innerTip, glow, haze, refl, reflCore]) m.visible = visible && on;
    flare.visible = visible && power > 0.01;
    _q.setFromUnitVectors(_up, dir);
    for (const m of [core, inner]) {
      m.position.copy(base);
      m.quaternion.copy(_q);
      m.scale.set(1, Math.max(0.0001, len), 1);
    }
    coreTip.position.copy(tip);
    innerTip.position.copy(tip);
    innerTip.quaternion.copy(_q);
    const k = power * flick;
    coreM.color.copy(white).multiplyScalar(7 * k);
    innerM.uniforms.uIntensity.value = k;
    glow.userData.u.uA.value.copy(base);
    glow.userData.u.uB.value.copy(tip);
    glow.userData.u.uIntensity.value = k;
    haze.userData.u.uA.value.copy(base);
    haze.userData.u.uB.value.copy(tip);
    haze.userData.u.uIntensity.value = k;
    flare.position.copy(base);
    flare.material.opacity = Math.min(1, 0.3 + power);
    const fs = 0.06 + 0.05 * power;
    flare.scale.set(fs, fs, 1);
    light.position.copy(base).addScaledVector(dir, len * 0.5);
    light.intensity = visible ? 2.6 * k * Math.min(1, len / 0.3) : 0;
    // 바닥(y=0)에 비친 모습: y 를 뒤집습니다.
    for (const r of [refl, reflCore]) {
      r.userData.u.uA.value.set(base.x, -base.y, base.z);
      r.userData.u.uB.value.set(tip.x, -tip.y, tip.z);
      // 바닥에서 멀수록 흐리게
      const h = Math.min(base.y, tip.y);
      r.userData.u.uIntensity.value = k * Math.max(0.15, 1 - h * 0.35);
    }
  }
  return {
    group, refl, reflCore, light, base, tip, set,
    setVisible(v) {
      visible = v;
      group.visible = v;
      refl.visible = v;
      reflCore.visible = v;
    },
    dispose() {
      coreM.dispose();
      innerM.dispose();
      glow.material.dispose();
      haze.material.dispose();
      flare.material.dispose();
      refl.material.dispose();
      reflCore.material.dispose();
    }
  };
}

// ================================================================
// 휘두를 때 칼날 뒤에 남는 잔상 리본
// ================================================================
const TRAIL_VS = /* glsl */`
attribute float alpha;
varying float vA;
void main() {
  vA = alpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const TRAIL_FS = /* glsl */`
uniform vec3 uColor;
varying float vA;
void main() {
  gl_FragColor = vec4(uColor * vA, 1.0);
}`;
export function makeTrail(color, n = 16) {
  const pos = new Float32Array(n * 2 * 3);
  const alpha = new Float32Array(n * 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(2.4) } },
    vertexShader: TRAIL_VS,
    fragmentShader: TRAIL_FS,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  const samples = [];
  function push(inner, outer, k) {
    samples.unshift({ i: inner.clone(), o: outer.clone(), k });
    if (samples.length > n) samples.pop();
    for (let s = 0; s < n; s++) {
      const S = samples[Math.min(s, samples.length - 1)];
      pos[s * 6] = S.i.x;
      pos[s * 6 + 1] = S.i.y;
      pos[s * 6 + 2] = S.i.z;
      pos[s * 6 + 3] = S.o.x;
      pos[s * 6 + 4] = S.o.y;
      pos[s * 6 + 5] = S.o.z;
      const age = s / (n - 1);
      const a = s < samples.length ? Math.pow(1 - age, 1.6) * S.k : 0;
      alpha[s * 2] = a * 0.05;
      alpha[s * 2 + 1] = a * 0.85;
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
  }
  return {
    mesh, push,
    clear() {
      samples.length = 0;
      alpha.fill(0);
      g.attributes.alpha.needsUpdate = true;
    },
    dispose() {
      g.dispose();
      mat.dispose();
    }
  };
}

// ================================================================
// 훈련 드론: 판넬 선이 있는 구형 몸체, 적도 고리와 추진기, 앞쪽 발사구(렌즈), 센서 눈, 안테나, 날개, 깜빡이는 표시등
// 로컬 +Z 가 앞(선수 쪽)입니다. lookAt 으로 선수를 보게 돌립니다.
// ================================================================
export const DRONE_R = 0.17;
let droneKit = null;
function droneTextures() {
  const W = 1024;
  const H = 512;
  // 높이(홈) 캔버스: 판넬 이음새
  const seamU = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
  const seamV = [0.2, 0.36, 0.5, 0.64, 0.8];
  const height = canvas(W, H, (g) => {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#000';
    g.lineWidth = 5;
    for (const u of seamU) {
      g.beginPath();
      g.moveTo(u * W, H * 0.1);
      g.lineTo(u * W, H * 0.9);
      g.stroke();
    }
    for (const v of seamV) {
      g.beginPath();
      g.moveTo(0, v * H);
      g.lineTo(W, v * H);
      g.stroke();
    }
    // 작은 정비용 뚜껑과 리벳
    g.lineWidth = 3;
    for (let k = 0; k < 8; k++) {
      const x = (k / 8 + 0.0625) * W;
      g.strokeRect(x - 22, H * 0.25, 44, 26);
      for (const dy of [0.42, 0.58]) {
        g.fillStyle = '#000';
        for (let r = -2; r <= 2; r++) {
          g.beginPath();
          g.arc(x + r * 16, dy * H, 2.6, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  });
  const map = canvas(W, H, (g) => {
    const img = g.createImageData(W, H);
    const d = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const v = y / H;
        const panel = Math.floor(u * 8) * 3 + Math.floor(v * 5);
        const tone = 0.86 + hash2(panel, 1, 3) * 0.2;
        const n = fbm(x / 60, y / 60, 5, 4, W / 60, H / 60);
        const grime = Math.pow(fbm(x / 22, y / 22, 11, 3, W / 22, H / 22), 2) * 0.35;
        let r = 62 * tone * (0.85 + n * 0.3) - grime * 40;
        let gg = 66 * tone * (0.85 + n * 0.3) - grime * 40;
        let b = 74 * tone * (0.85 + n * 0.3) - grime * 38;
        // 가로 띠(적도 아래위)는 조금 밝은 회색
        if (v > 0.36 && v < 0.64) {
          r += 22;
          gg += 22;
          b += 24;
        }
        const k = (y * W + x) * 4;
        d[k] = r;
        d[k + 1] = gg;
        d[k + 2] = b;
        d[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.drawImage(height, 0, 0);
    g.globalCompositeOperation = 'source-over';
    // 경고 띠와 일련번호
    for (let k = 0; k < 4; k++) {
      const x = (k / 4 + 0.19) * W;
      g.save();
      g.beginPath();
      g.rect(x, H * 0.66, 70, 14);
      g.clip();
      g.fillStyle = '#d8a52a';
      g.fillRect(x, H * 0.66, 70, 14);
      g.fillStyle = '#16181c';
      for (let s = -20; s < 90; s += 16) {
        g.beginPath();
        g.moveTo(x + s, H * 0.66 + 14);
        g.lineTo(x + s + 8, H * 0.66 + 14);
        g.lineTo(x + s + 22, H * 0.66);
        g.lineTo(x + s + 14, H * 0.66);
        g.fill();
      }
      g.restore();
      g.fillStyle = 'rgba(220,226,235,.75)';
      g.font = `700 18px ${FONT_S}`;
      g.fillText(`TD-${String(17 + k * 9).padStart(3, '0')}`, x, H * 0.33);
    }
  });
  const rough = canvas(W, H, (g) => {
    g.fillStyle = '#6a6a6a';
    g.fillRect(0, 0, W, H);
    for (let k = 0; k < 40; k++) {
      g.fillStyle = `rgba(${hash2(k, 2, 4) > 0.5 ? '255,255,255' : '40,40,40'},${0.05 + hash2(k, 3, 4) * 0.08})`;
      g.fillRect(hash2(k, 5, 4) * W, hash2(k, 6, 4) * H, 40 + hash2(k, 7, 4) * 120, 20 + hash2(k, 8, 4) * 60);
    }
    // 이음새는 거칠게(밝게)
    g.strokeStyle = 'rgba(255,255,255,.75)';
    g.lineWidth = 6;
    for (const u of seamU) {
      g.beginPath();
      g.moveTo(u * W, H * 0.1);
      g.lineTo(u * W, H * 0.9);
      g.stroke();
    }
    for (const v of seamV) {
      g.beginPath();
      g.moveTo(0, v * H);
      g.lineTo(W, v * H);
      g.stroke();
    }
  });
  return {
    map: tex(map),
    rough: tex(rough, false),
    normal: tex(normalFromCanvas(height, 2.2), false)
  };
}
function droneGeometries() {
  // 몸체: 살짝 눌린 구, 적도에 홈
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const a = -Math.PI / 2 + (i / 40) * Math.PI;
    let r = DRONE_R * Math.cos(a);
    const y = DRONE_R * 0.93 * Math.sin(a);
    if (Math.abs(y) < 0.016) r -= 0.011 * Math.cos((y / 0.016) * Math.PI * 0.5);
    pts.push(V2(Math.max(0, r), y));
  }
  const hull = new THREE.LatheGeometry(pts, 64);
  // 적도 고리
  const ring = new THREE.TorusGeometry(DRONE_R + 0.004, 0.014, 12, 72);
  ring.rotateX(Math.PI / 2);
  // 추진기 6개(고리 아래)
  const nozzle = new THREE.LatheGeometry(smoothProfile([[0, 0.012], [0.016, 0.012], [0.018, 0.004], [0.022, -0.016], [0.019, -0.018], [0.014, -0.006], [0, -0.006]], 2), 20);
  const noz = [];
  const glowDisc = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const g = nozzle.clone();
    g.rotateZ(0.5);
    g.translate(DRONE_R + 0.008, -0.03, 0);
    g.rotateY(a);
    noz.push(g);
    const d = new THREE.CircleGeometry(0.013, 16);
    d.rotateX(Math.PI / 2);
    d.rotateZ(0.5);
    d.translate(DRONE_R + 0.014, -0.047, 0);
    d.rotateY(a);
    glowDisc.push(d);
  }
  // 발사구: 하우징 고리 + 오목한 컵 + 짧은 총열 + 총구 고리
  const housing = new THREE.TorusGeometry(0.062, 0.013, 12, 48);
  housing.translate(0, -0.006, DRONE_R - 0.012);
  const cup = new THREE.CylinderGeometry(0.058, 0.05, 0.03, 40, 1, true);
  cup.rotateX(Math.PI / 2);
  cup.translate(0, -0.006, DRONE_R - 0.02);
  const barrel = new THREE.LatheGeometry(smoothProfile([[0.0, 0], [0.022, 0], [0.022, 0.02], [0.016, 0.026], [0.016, 0.07], [0.02, 0.074], [0.02, 0.086], [0.011, 0.086], [0.011, 0.05], [0, 0.05]], 2), 28);
  barrel.rotateX(Math.PI / 2);
  barrel.translate(0, -0.006, DRONE_R - 0.03);
  const lens = new THREE.SphereGeometry(0.044, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);
  lens.rotateX(Math.PI / 2);
  lens.scale(1, 1, 0.45);
  lens.translate(0, -0.006, DRONE_R - 0.028);
  const muzzleGlow = new THREE.CircleGeometry(0.0105, 20);
  muzzleGlow.translate(0, -0.006, DRONE_R + 0.057);
  // 센서 눈
  const eyeRing = new THREE.TorusGeometry(0.022, 0.006, 10, 32);
  eyeRing.translate(0, 0.082, DRONE_R * 0.86);
  eyeRing.rotateX(-0.45);
  const eye = new THREE.SphereGeometry(0.019, 20, 12);
  eye.translate(0, 0.082, DRONE_R * 0.86);
  eye.rotateX(-0.45);
  // 안테나 + 끝 표시등
  const ant = [];
  const tips = [];
  for (const s of [-1, 1]) {
    const a = new THREE.CylinderGeometry(0.0022, 0.003, 0.11, 8);
    a.translate(0, 0.055, 0);
    a.rotateX(-0.35);
    a.rotateZ(s * 0.32);
    a.translate(s * 0.05, DRONE_R * 0.8, -0.05);
    ant.push(a);
    const t = new THREE.SphereGeometry(0.0065, 10, 8);
    t.translate(0, 0.11, 0);
    t.rotateX(-0.35);
    t.rotateZ(s * 0.32);
    t.translate(s * 0.05, DRONE_R * 0.8, -0.05);
    tips.push(t);
  }
  // 위 해치
  const hatch = new THREE.CylinderGeometry(0.05, 0.056, 0.014, 32);
  hatch.translate(0, DRONE_R * 0.9, 0);
  // 옆 날개(안정판)
  const fin = new THREE.Shape();
  fin.moveTo(0, -0.03);
  fin.lineTo(0.11, -0.012);
  fin.quadraticCurveTo(0.14, 0.0, 0.11, 0.018);
  fin.lineTo(0, 0.04);
  fin.closePath();
  const fg = new THREE.ExtrudeGeometry(fin, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 8 });
  fg.translate(0, 0, -0.004);
  fg.rotateX(Math.PI / 2);
  const fins = [];
  const stripes = [];
  for (const s of [-1, 1]) {
    const g = fg.clone();
    if (s < 0) g.scale(-1, 1, 1);
    g.translate(s * (DRONE_R - 0.02), 0.03, -0.02);
    fins.push(g);
    const st = new THREE.BoxGeometry(0.075, 0.004, 0.006);
    st.translate(s * (DRONE_R + 0.05), 0.036, -0.004);
    stripes.push(st);
  }
  // 표시등(옆과 뒤)
  const leds = [];
  for (const [x, y, z] of [[0.11, 0.08, 0.09], [-0.11, 0.08, 0.09], [0, -0.09, -0.135], [0.12, -0.05, -0.08], [-0.12, -0.05, -0.08]]) {
    const l = new THREE.SphereGeometry(0.0075, 10, 8);
    l.translate(x, y, z);
    leds.push(l);
  }
  return {
    hull, ring, nozzles: mergeGeometries(noz), glowDiscs: mergeGeometries(glowDisc), housing, cup, barrel, lens, muzzleGlow,
    eyeRing, eye, ant: mergeGeometries(ant), tips: mergeGeometries(tips), hatch, fins: mergeGeometries(fins), stripes: mergeGeometries(stripes),
    leds: mergeGeometries(leds)
  };
}
function droneShared() {
  if (droneKit) return droneKit;
  const T = droneTextures();
  droneKit = {
    G: droneGeometries(),
    hull: new THREE.MeshPhysicalMaterial({ map: T.map, roughnessMap: T.rough, normalMap: T.normal, normalScale: new THREE.Vector2(0.9, 0.9), metalness: 0.82, roughness: 0.72, clearcoat: 0.45, clearcoatRoughness: 0.35 }),
    ring: new THREE.MeshPhysicalMaterial({ color: '#8d96a3', metalness: 1, roughness: 0.28, clearcoat: 0.5 }),
    dark: new THREE.MeshStandardMaterial({ color: '#15171c', metalness: 0.7, roughness: 0.45 }),
    black: new THREE.MeshStandardMaterial({ color: '#040406', metalness: 0.2, roughness: 0.7 }),
    thruster: new THREE.MeshBasicMaterial({ color: hdr('#7fd8ff', 3.2) }),
    debris: new THREE.MeshStandardMaterial({ color: '#4a4f58', metalness: 0.8, roughness: 0.5 })
  };
  return droneKit;
}
export function makeDrone() {
  const K = droneShared();
  const G = K.G;
  const enemy = new THREE.Color(ENEMY);
  const lensM = new THREE.MeshPhysicalMaterial({ color: '#1a0418', emissive: ENEMY, emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.08, clearcoat: 1 });
  const muzzleM = new THREE.MeshBasicMaterial({ color: enemy.clone().multiplyScalar(0.5) });
  const eyeM = new THREE.MeshBasicMaterial({ color: hdr('#ff5a3a', 2) });
  const ledM = new THREE.MeshBasicMaterial({ color: hdr('#7affd2', 2.5) });
  const tipM = new THREE.MeshBasicMaterial({ color: hdr('#ff3a3a', 3) });
  const stripeM = new THREE.MeshBasicMaterial({ color: enemy.clone().multiplyScalar(2.2) });
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const add = (geo, mat, shadow = true, parent = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow;
    parent.add(m);
    return m;
  };
  add(G.hull, K.hull);
  const ring = add(G.ring, K.ring);
  add(G.nozzles, K.dark);
  add(G.glowDiscs, K.thruster, false);
  add(G.housing, K.ring);
  add(G.cup, K.black, false);
  add(G.barrel, K.dark);
  add(G.lens, lensM, false);
  add(G.muzzleGlow, muzzleM, false);
  add(G.eyeRing, K.dark, false);
  add(G.eye, eyeM, false);
  add(G.ant, K.dark);
  add(G.tips, tipM, false);
  add(G.hatch, K.ring);
  add(G.fins, K.dark);
  add(G.stripes, stripeM, false);
  add(G.leds, ledM, false);
  // 아래 추진 빛과 충전 빛
  const under = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: hdr('#6fd0ff', 1.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  under.position.set(0, -0.1, 0);
  under.scale.set(0.55, 0.3, 1);
  body.add(under);
  const charge = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: enemy.clone().multiplyScalar(4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  charge.position.set(0, -0.006, DRONE_R + 0.07);
  charge.scale.set(0.001, 0.001, 1);
  body.add(charge);
  // 조준선: 충전 끝 무렵 목표 쪽으로 가는 가는 빛
  const aim = makeBeam({ color: enemy.clone().multiplyScalar(1.2), width: 0.008, sharp: 2.5 });
  aim.visible = false;
  const muzzle = new THREE.Vector3(0, -0.006, DRONE_R + 0.07);
  const phase = Math.random() * 10;
  let blink = 0;
  return {
    group, body, aim, muzzle,
    muzzleWorld(out) {
      return body.localToWorld(out.copy(muzzle));
    },
    // k: 충전 0~1
    setCharge(k) {
      lensM.emissiveIntensity = 0.6 + k * k * 9;
      muzzleM.color.copy(enemy).multiplyScalar(0.5 + k * k * 7);
      const s = 0.02 + k * k * 0.32;
      charge.scale.set(s, s, 1);
      charge.material.opacity = Math.min(1, k * 1.4);
      charge.visible = k > 0.01;
    },
    tick(t, alive = 1) {
      ring.rotation.y = t * 0.8 + phase;
      blink = (t * 1.7 + phase) % 1;
      ledM.color.set('#7affd2').multiplyScalar(blink < 0.12 ? 3.5 * alive : 0.25);
      tipM.color.set('#ff3a3a').multiplyScalar(((t * 0.9 + phase * 0.3) % 1) < 0.1 ? 4 * alive : 0.3);
      under.material.opacity = (0.55 + 0.15 * Math.sin(t * 23 + phase)) * alive;
      eyeM.color.set('#ff5a3a').multiplyScalar(1.4 + 0.6 * Math.sin(t * 5 + phase));
    },
    dispose() {
      for (const m of [lensM, muzzleM, eyeM, ledM, tipM, stripeM, under.material, charge.material, aim.material]) m.dispose();
    }
  };
}
export function debrisGeometries() {
  return [
    new THREE.DodecahedronGeometry(0.035, 0),
    new THREE.BoxGeometry(0.07, 0.012, 0.05),
    new THREE.TetrahedronGeometry(0.045, 0),
    new THREE.CylinderGeometry(0.02, 0.026, 0.03, 8),
    new THREE.TorusGeometry(0.04, 0.007, 6, 12, Math.PI * 0.8)
  ];
}
export function debrisMaterial() {
  return droneShared().debris;
}

// ================================================================
// 광탄: 흰 심 + 색 빛 + 머리 빛 + 바닥 반사
// ================================================================
let boltGeo = null;
export function makeBolt() {
  if (!boltGeo) {
    boltGeo = new THREE.CylinderGeometry(0.0085, 0.0085, 1, 10, 1, true);
    boltGeo.translate(0, 0.5, 0);
  }
  const color = new THREE.Color(ENEMY);
  const coreM = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5, 6) });
  const core = new THREE.Mesh(boltGeo, coreM);
  core.frustumCulled = false;
  const glow = makeBeam({ color: color.clone().multiplyScalar(2.4), width: 0.05, sharp: 3 });
  const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: color.clone().multiplyScalar(3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  head.scale.set(0.16, 0.16, 1);
  const refl = makeBeam({ color: color.clone().multiplyScalar(1.4), width: 0.1, sharp: 2.4, order: -2 });
  const group = new THREE.Group();
  group.add(core, glow, head);
  return {
    group, refl,
    set(tail, headP, c, k = 1) {
      _v.subVectors(headP, tail);
      const len = _v.length();
      if (len > 1e-5) {
        _w.copy(_v).divideScalar(len);
        _q.setFromUnitVectors(_up, _w);
        core.quaternion.copy(_q);
      }
      core.position.copy(tail);
      core.scale.set(1, Math.max(0.001, len), 1);
      glow.userData.u.uA.value.copy(tail);
      glow.userData.u.uB.value.copy(headP);
      glow.userData.u.uColor.value.copy(c).multiplyScalar(2.4 * k);
      head.position.copy(headP);
      head.material.color.copy(c).multiplyScalar(2.6 * k);
      refl.userData.u.uA.value.set(tail.x, -tail.y, tail.z);
      refl.userData.u.uB.value.set(headP.x, -headP.y, headP.z);
      refl.userData.u.uColor.value.copy(c).multiplyScalar(1.3 * k * Math.max(0.2, 1 - headP.y * 0.3));
    },
    show(v) {
      group.visible = v;
      refl.visible = v;
    },
    dispose() {
      coreM.dispose();
      glow.material.dispose();
      head.material.dispose();
      refl.material.dispose();
    }
  };
}

// ================================================================
// 불꽃 입자(점), 섬광 스프라이트, 충격파 고리, 파편 — 모두 미리 만든 풀에서 꺼내 씁니다.
// ================================================================
const SPARK_VS = /* glsl */`
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying float vA;
varying vec3 vC;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.05, -mv.z);
  gl_Position = projectionMatrix * mv;
  vA = aAlpha;
  vC = aColor;
}`;
const SPARK_FS = /* glsl */`
varying float vA;
varying vec3 vC;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  float g = exp(-d * 4.0) - exp(-4.0);
  if (g <= 0.0) discard;
  gl_FragColor = vec4(vC * g * vA, 1.0);
}`;
export function makeSparks(cap = 900) {
  const pos = new Float32Array(cap * 3);
  const col = new Float32Array(cap * 3);
  const size = new Float32Array(cap);
  const alpha = new Float32Array(cap);
  const vel = new Float32Array(cap * 3);
  const life = new Float32Array(cap);
  const age = new Float32Array(cap);
  const drag = new Float32Array(cap);
  const grav = new Float32Array(cap);
  const base = new Float32Array(cap * 3);
  const s0 = new Float32Array(cap);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 } },
    vertexShader: SPARK_VS,
    fragmentShader: SPARK_FS,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  let head = 0;
  const tmp = new THREE.Color();
  return {
    points,
    setScale(px) {
      mat.uniforms.uScale.value = px;
    },
    /**
     * p: 위치, n: 개수, o: { color, color2, speed, dir(선택, 단위 벡터), cone(0~1, 1 = 사방), life, size, gravity, drag, hot }
     */
    emit(p, n, o = {}) {
      const c1 = new THREE.Color(o.color || '#ffffff');
      const c2 = new THREE.Color(o.color2 || o.color || '#ffffff');
      const sp = o.speed ?? 3;
      const cone = o.cone ?? 1;
      for (let k = 0; k < n; k++) {
        const i = head;
        head = (head + 1) % cap;
        // 방향: dir 둘레 원뿔(cone) 안에서 무작위
        let x = Math.random() * 2 - 1;
        let y = Math.random() * 2 - 1;
        let z = Math.random() * 2 - 1;
        const l = Math.hypot(x, y, z) || 1;
        x /= l;
        y /= l;
        z /= l;
        if (o.dir) {
          x = o.dir.x + x * cone;
          y = o.dir.y + y * cone;
          z = o.dir.z + z * cone;
          const l2 = Math.hypot(x, y, z) || 1;
          x /= l2;
          y /= l2;
          z /= l2;
        }
        const s = sp * (0.35 + Math.random() * 0.9);
        pos[i * 3] = p.x;
        pos[i * 3 + 1] = p.y;
        pos[i * 3 + 2] = p.z;
        vel[i * 3] = x * s;
        vel[i * 3 + 1] = y * s;
        vel[i * 3 + 2] = z * s;
        tmp.copy(c1).lerp(c2, Math.random()).multiplyScalar(o.hot ?? 3);
        base[i * 3] = tmp.r;
        base[i * 3 + 1] = tmp.g;
        base[i * 3 + 2] = tmp.b;
        life[i] = (o.life ?? 0.45) * (0.5 + Math.random() * 0.8);
        age[i] = 0;
        s0[i] = (o.size ?? 0.025) * (0.6 + Math.random() * 0.8);
        drag[i] = o.drag ?? 2.2;
        grav[i] = o.gravity ?? 5;
      }
    },
    update(dt) {
      for (let i = 0; i < cap; i++) {
        if (age[i] >= life[i]) {
          if (alpha[i] !== 0) {
            alpha[i] = 0;
            size[i] = 0;
          }
          continue;
        }
        age[i] += dt;
        const f = Math.exp(-drag[i] * dt);
        vel[i * 3] *= f;
        vel[i * 3 + 1] = vel[i * 3 + 1] * f - grav[i] * dt;
        vel[i * 3 + 2] *= f;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (pos[i * 3 + 1] < 0.005) {
          pos[i * 3 + 1] = 0.005;
          vel[i * 3 + 1] *= -0.35;
          vel[i * 3] *= 0.6;
          vel[i * 3 + 2] *= 0.6;
        }
        const t = age[i] / life[i];
        alpha[i] = Math.max(0, 1 - t * t);
        size[i] = s0[i] * (1 - 0.5 * t);
        // 식으면서 주황 → 어두운 빨강
        col[i * 3] = base[i * 3] * (1 - t * 0.3);
        col[i * 3 + 1] = base[i * 3 + 1] * (1 - t * 0.7);
        col[i * 3 + 2] = base[i * 3 + 2] * (1 - t * 0.85);
      }
      g.attributes.position.needsUpdate = true;
      g.attributes.aColor.needsUpdate = true;
      g.attributes.aSize.needsUpdate = true;
      g.attributes.aAlpha.needsUpdate = true;
    }
  };
}

export function makeFlashes(n = 24) {
  const group = new THREE.Group();
  const pool = [];
  for (let i = 0; i < n; i++) {
    const ring = i % 3 === 2;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ring ? ringTex : glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.visible = false;
    group.add(s);
    pool.push({ s, ring, t: 0, life: 1, size: 1, grow: 1, color: new THREE.Color() });
  }
  return {
    group,
    // kind: 'glow' | 'ring'
    fire(p, color, size, life, kind = 'glow', k = 3) {
      const want = kind === 'ring';
      const f = pool.find((x) => !x.s.visible && x.ring === want) || pool.find((x) => x.ring === want);
      f.s.visible = true;
      f.s.position.copy(p);
      f.t = 0;
      f.life = life;
      f.size = size;
      f.grow = want ? 3.2 : 1.4;
      f.color.set(color).multiplyScalar(k);
      f.s.material.color.copy(f.color);
    },
    update(dt) {
      for (const f of pool) {
        if (!f.s.visible) continue;
        f.t += dt;
        const t = f.t / f.life;
        if (t >= 1) {
          f.s.visible = false;
          continue;
        }
        const sc = f.size * (1 + (f.grow - 1) * Math.pow(t, 0.5));
        f.s.scale.set(sc, sc, 1);
        f.s.material.opacity = Math.pow(1 - t, 1.6);
      }
    }
  };
}

// ================================================================
// 훈련장
// ================================================================
function floorTextures() {
  // 한 장 = 4m × 4m, 2m 타일 4장
  const S = 1024;
  const seam = (x) => {
    const m = x % 512;
    return Math.min(m, 512 - m);
  };
  const height = pixels(S, S, (x, y, c) => {
    const d = Math.min(seam(x), seam(y));
    const v = d < 2 ? 0 : d < 4 ? 0.45 : 1;
    // 타일 안쪽의 미세한 요철
    const n = vnoise(x / 6, y / 6, 21, S / 6, S / 6) * 0.04;
    c[0] = c[1] = c[2] = (v - n) * 255;
    c[3] = 255;
  });
  const map = pixels(S, S, (x, y, c) => {
    const tile = (x >> 9) + (y >> 9) * 2;
    const tone = 0.9 + hash2(tile, 4, 2) * 0.16;
    const n = fbm(x / 140, y / 140, 9, 4, S / 140, S / 140);
    const d = Math.min(seam(x), seam(y));
    const k = (d < 3 ? 0.35 : 1) * tone * (0.82 + n * 0.36);
    c[0] = 16 * k;
    c[1] = 19 * k;
    c[2] = 27 * k;
    c[3] = 255;
  });
  const rough = pixels(S, S, (x, y, c) => {
    const tile = (x >> 9) + (y >> 9) * 2;
    const d = Math.min(seam(x), seam(y));
    const smudge = Math.pow(fbm(x / 90, y / 90, 33, 4, S / 90, S / 90), 2) * 0.5;
    const v = d < 4 ? 0.7 : 0.12 + hash2(tile, 9, 1) * 0.06 + smudge * 0.35;
    c[0] = c[1] = c[2] = v * 255;
    c[3] = 255;
  });
  // 빛나는 선: 타일 모서리마다 짧은 유도등, 4m 마다 앞쪽(-Z)으로 뻗은 가는 선
  const emis = canvas(S, S, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(70,150,255,.55)';
    g.fillRect(S / 2 - 1.5, 0, 3, S);
    g.fillStyle = 'rgba(120,200,255,.9)';
    for (const cx of [0, 512, 1024]) {
      for (const cy of [0, 512, 1024]) {
        g.fillRect(cx - 26, cy - 2, 18, 4);
        g.fillRect(cx + 8, cy - 2, 18, 4);
      }
    }
  });
  const T = {
    map: tex(map, true, true),
    rough: tex(rough, false, true),
    normal: tex(normalFromCanvas(height, 3), false, true),
    emis: tex(emis, true, true)
  };
  return T;
}

function wallModuleTex() {
  // 벽 한 칸 = 6m × 12m
  const W = 512;
  const H = 1024;
  const map = canvas(W, H, (g) => {
    g.fillStyle = '#0d1018';
    g.fillRect(0, 0, W, H);
    const panel = (x, y, w, h, tone) => {
      const gr = g.createLinearGradient(x, y, x, y + h);
      gr.addColorStop(0, `rgb(${24 * tone},${28 * tone},${38 * tone})`);
      gr.addColorStop(1, `rgb(${14 * tone},${17 * tone},${24 * tone})`);
      g.fillStyle = gr;
      g.fillRect(x + 4, y + 4, w - 8, h - 8);
      g.strokeStyle = 'rgba(0,0,0,.8)';
      g.lineWidth = 3;
      g.strokeRect(x + 4, y + 4, w - 8, h - 8);
    };
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 2; c++) panel(c * 256, r * 170 + 2, 256, 170, 0.85 + hash2(r, c, 3) * 0.3);
    }
    g.fillStyle = '#05070b';
    g.fillRect(0, 300, W, 26);
    g.fillRect(0, 760, W, 22);
  });
  const emis = canvas(W, H, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(150,210,255,1)';
    g.fillRect(0, 309, W, 8);
    g.fillStyle = 'rgba(90,160,255,.8)';
    g.fillRect(0, 768, W, 5);
    // 상태등
    for (let k = 0; k < 6; k++) {
      g.fillStyle = k % 3 === 0 ? 'rgba(255,90,200,.9)' : 'rgba(120,255,200,.8)';
      g.fillRect(40 + k * 14, 360, 8, 8);
    }
  });
  return { map: tex(map, true, true), emis: tex(emis, true, true) };
}

const HOLO_VS = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const HOLO_FS = /* glsl */`
uniform sampler2D map;
uniform vec3 uColor;
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(map, vUv);
  float scan = 0.78 + 0.22 * sin(vUv.y * 340.0 - uTime * 6.0);
  float band = smoothstep(0.0, 0.08, fract(vUv.y * 0.6 - uTime * 0.18)) * 0.25 + 0.75;
  float flick = 0.92 + 0.08 * sin(uTime * 37.0) * sin(uTime * 13.0);
  float edge = smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.96, vUv.x) * smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
  vec3 c = uColor * t.rgb * scan * band * flick * edge * uAlpha;
  gl_FragColor = vec4(c, 1.0);
}`;
function holoMat(map, color, alpha = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uAlpha: { value: alpha } },
    vertexShader: HOLO_VS,
    fragmentShader: HOLO_FS,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
}
const BARRIER_FS = /* glsl */`
uniform vec3 uColor;
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 p = vUv * vec2(26.0, 7.0);
  vec2 g = abs(fract(p) - 0.5);
  float line = smoothstep(0.47, 0.5, max(g.x, g.y));
  float fade = pow(1.0 - vUv.y, 1.6) * 0.8 + 0.08;
  float sweep = smoothstep(0.06, 0.0, abs(fract(vUv.x * 0.5 - uTime * 0.12) - 0.5) - 0.44);
  float ends = smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x);
  float a = (0.05 + line * 0.35 + sweep * 0.25) * fade * ends;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

function textCanvas(w, h, draw) {
  return tex(canvas(w, h, draw));
}

export function makeHall() {
  const group = new THREE.Group();
  const anim = [];
  // ---------- 바닥 ----------
  const FT = floorTextures();
  const FW = 80;
  const FD = 34;
  for (const t of Object.values(FT)) t.repeat.set(FW / 4, FD / 4);
  const floorM = new THREE.MeshPhysicalMaterial({
    color: '#ffffff', map: FT.map, roughness: 1, roughnessMap: FT.rough, metalness: 0.3,
    normalMap: FT.normal, normalScale: new THREE.Vector2(0.6, 0.6),
    clearcoat: 1, clearcoatRoughness: 0.05, emissive: '#ffffff', emissiveMap: FT.emis, emissiveIntensity: 0.55,
    transparent: true, opacity: 0.86, envMapIntensity: 0.7
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FW, FD), floorM);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -FD / 2 + 9);
  floor.receiveShadow = true;
  floor.renderOrder = -1;
  group.add(floor);
  // 바닥 아래(반사가 비치는 어두운 바탕)
  const under = new THREE.Mesh(new THREE.PlaneGeometry(FW, FD), new THREE.MeshBasicMaterial({ color: '#020306' }));
  under.rotation.x = -Math.PI / 2;
  under.position.set(0, -6, -FD / 2 + 9);
  group.add(under);

  // ---------- 벽 ----------
  const WT = wallModuleTex();
  const wallMat = (repeatX) => {
    const map = WT.map.clone();
    const em = WT.emis.clone();
    map.repeat.set(repeatX, 1);
    em.repeat.set(repeatX, 1);
    map.needsUpdate = true;
    em.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map, emissiveMap: em, emissive: '#ffffff', emissiveIntensity: 0.9, roughness: 0.55, metalness: 0.4 });
  };
  const far = new THREE.Mesh(new THREE.PlaneGeometry(FW, 12), wallMat(FW / 6));
  far.position.set(0, 6, -24.5);
  group.add(far);
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(FD, 12), wallMat(FD / 6));
    side.position.set(s * FW / 2, 6, -FD / 2 + 9);
    side.rotation.y = -s * Math.PI / 2;
    group.add(side);
  }
  const back = new THREE.Mesh(new THREE.PlaneGeometry(FW, 12), wallMat(FW / 6));
  back.position.set(0, 6, 9);
  back.rotation.y = Math.PI;
  group.add(back);
  // 천장 + 줄 조명
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(FW, FD), new THREE.MeshStandardMaterial({ color: '#07090e', roughness: 0.9 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, 12, -FD / 2 + 9);
  group.add(ceil);
  const strips = [];
  for (let x = -33; x <= 33; x += 6) {
    const b = new THREE.BoxGeometry(0.42, 0.06, 28);
    b.translate(x, 11.9, -9);
    strips.push(b);
  }
  group.add(new THREE.Mesh(mergeGeometries(strips), new THREE.MeshBasicMaterial({ color: hdr('#dfe9ff', 2.2) })));
  // 기둥(먼 벽, 칸막이 줄과 맞춤) + 세로 빛줄
  const pil = [];
  const pilLight = [];
  for (const x of [-36, -24, -12, 0, 12, 24, 36]) {
    const b = new THREE.BoxGeometry(1.3, 12, 1.1);
    b.translate(x, 6, -23.9);
    pil.push(b);
    const l = new THREE.BoxGeometry(0.1, 10.5, 0.06);
    l.translate(x, 6, -23.32);
    pilLight.push(l);
  }
  const pillarMat = new THREE.MeshPhysicalMaterial({ color: '#1a1e27', metalness: 0.7, roughness: 0.35, clearcoat: 0.6 });
  const pillars = new THREE.Mesh(mergeGeometries(pil), pillarMat);
  pillars.receiveShadow = true;
  group.add(pillars);
  group.add(new THREE.Mesh(mergeGeometries(pilLight), new THREE.MeshBasicMaterial({ color: hdr('#6fc4ff', 2.6) })));
  // 먼 벽의 큰 홀로그램 글자
  const titleTex = textCanvas(2048, 256, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    g.font = `400 150px ${FONT_D}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('BEAM BLADE  ·  TRAINING HALL', w / 2, h / 2 + 8);
  });
  const title = new THREE.Mesh(new THREE.PlaneGeometry(26, 3.25), holoMat(titleTex, hdr('#8fd8ff', 1.4)));
  title.position.set(0, 9.2, -23.2);
  group.add(title);
  anim.push(title.material);

  // ---------- 스테이션 ----------
  const padTex = (() => {
    const S = 1024;
    const c = canvas(S, S, (g) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, S, S);
      g.translate(S / 2, S / 2);
      // 육각 격자
      const R = 34;
      g.strokeStyle = 'rgba(255,255,255,.55)';
      g.lineWidth = 2;
      for (let q = -16; q <= 16; q++) {
        for (let r = -16; r <= 16; r++) {
          const x = R * 1.5 * q;
          const y = R * Math.sqrt(3) * (r + q / 2);
          const d = Math.hypot(x, y);
          if (d > S * 0.47) continue;
          g.globalAlpha = 0.25 + 0.75 * (1 - d / (S * 0.47));
          g.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2;
            const px = x + Math.cos(a) * (R - 3);
            const py = y + Math.sin(a) * (R - 3);
            if (k === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
          }
          g.closePath();
          g.stroke();
        }
      }
      g.globalAlpha = 1;
      g.lineWidth = 6;
      g.strokeStyle = '#fff';
      g.beginPath();
      g.arc(0, 0, S * 0.18, 0, Math.PI * 2);
      g.stroke();
      // 발 위치 표시
      g.fillStyle = 'rgba(255,255,255,.8)';
      for (const s of [-1, 1]) {
        g.save();
        g.translate(s * 70, 0);
        g.beginPath();
        g.ellipse(0, 0, 26, 62, 0, 0, Math.PI * 2);
        g.globalAlpha = 0.35;
        g.fill();
        g.restore();
      }
    });
    return tex(c);
  })();
  const padBase = new THREE.LatheGeometry(smoothProfile([[0, 0.04], [1.24, 0.04], [1.29, 0.034], [1.33, 0.012], [1.34, 0]], 2), 96);
  const padM = new THREE.MeshPhysicalMaterial({ color: '#141821', metalness: 0.8, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 });
  const stations = STATION_X.map((x, i) => {
    const g = new THREE.Group();
    g.position.set(x, 0, 0);
    const pad = new THREE.Mesh(padBase, padM);
    pad.receiveShadow = true;
    g.add(pad);
    const topM = new THREE.MeshBasicMaterial({ map: padTex, color: hdr('#5aa8ff', 0.35), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const top = new THREE.Mesh(new THREE.CircleGeometry(1.2, 64), topM);
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.041;
    g.add(top);
    const ringM = new THREE.MeshBasicMaterial({ color: hdr('#4a6a9a', 1) });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.19, 1.235, 128), ringM);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.042;
    g.add(ring);
    // 바깥 호(천천히 도는 눈금)
    const arcsM = new THREE.MeshBasicMaterial({ color: hdr('#4a6a9a', 1.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const arcs = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const a = new THREE.Mesh(new THREE.RingGeometry(1.42, 1.47, 48, 1, (k / 3) * Math.PI * 2, Math.PI * 0.42), arcsM);
      a.rotation.x = -Math.PI / 2;
      arcs.add(a);
    }
    arcs.position.y = 0.01;
    g.add(arcs);
    // 앞쪽 거리 표시(3m, 6m) 호와 글자
    const markM = new THREE.MeshBasicMaterial({ color: hdr('#5ab4ff', 0.9), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (const r of [3, 6]) {
      const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.015, r + 0.015, 96, 1, Math.PI / 2 - 0.75, 1.5), markM);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.006;
      g.add(m);
      const lt = textCanvas(256, 128, (c, w, h) => {
        c.fillStyle = '#000';
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#fff';
        c.font = `400 84px ${FONT_D}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(`${r}M`, w / 2, h / 2 + 4);
      });
      const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), new THREE.MeshBasicMaterial({ map: lt, color: hdr('#5ab4ff', 0.9), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      lab.rotation.x = -Math.PI / 2;
      lab.position.set(0.95, 0.007, -r + 0.25);
      g.add(lab);
    }
    // 스테이션 홀로그램 간판
    const signC = canvas(1024, 384, () => {});
    const signT = tex(signC);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.2), holoMat(signT, hdr('#8fd8ff', 1.2), 0.9));
    sign.position.set(0, 4.3, -11);
    g.add(sign);
    anim.push(sign.material);
    // 드론이 나오는 먼 벽의 격납구
    const bay = new THREE.Group();
    const frameM = new THREE.MeshBasicMaterial({ color: new THREE.Color(ENEMY).multiplyScalar(2.2) });
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), new THREE.MeshBasicMaterial({ color: '#020205' }));
    bay.add(hole);
    for (const [w, h, x, y] of [[2.6, 0.06, 0, 0.83], [2.6, 0.06, 0, -0.83], [0.06, 1.72, 1.27, 0], [0.06, 1.72, -1.27, 0]]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), frameM);
      f.position.set(x, y, 0.02);
      bay.add(f);
    }
    bay.position.set(0, 4.2, -24.4);
    g.add(bay);
    group.add(g);
    return { g, x, i, ringM, arcsM, arcs, topM, markM, sign, signC, signT, active: false };
  });
  // 스테이션 사이 에너지 칸막이
  const barM = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: hdr('#6fc4ff', 1.05) }, uTime: { value: 0 } },
    vertexShader: HOLO_VS,
    fragmentShader: BARRIER_FS,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  const railM = new THREE.MeshPhysicalMaterial({ color: '#1a1e27', metalness: 0.8, roughness: 0.3, clearcoat: 1 });
  const railLight = new THREE.MeshBasicMaterial({ color: hdr('#6fc4ff', 2.4) });
  for (const x of [-12, 0, 12]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(13, 3.4), barM);
    b.rotation.y = Math.PI / 2;
    b.position.set(x, 1.7, -7.6);
    group.add(b);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 13), railM);
    rail.position.set(x, 0.05, -7.6);
    rail.castShadow = true;
    group.add(rail);
    const rl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 13), railLight);
    rl.position.set(x, 0.104, -7.6);
    group.add(rl);
  }
  anim.push(barM);

  function drawSign(st, label, color, sub) {
    const g = st.signC.getContext('2d');
    const w = st.signC.width;
    const h = st.signC.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff';
    g.lineWidth = 6;
    g.strokeRect(18, 18, w - 36, h - 36);
    g.fillStyle = '#fff';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = `700 44px ${FONT_S}`;
    g.globalAlpha = 0.7;
    g.fillText(`STATION 0${st.i + 1}`, 60, 92);
    g.globalAlpha = 1;
    g.font = `400 180px ${FONT_D}`;
    g.fillText(label, 60, 232);
    if (sub) {
      g.font = `800 52px ${FONT_S}`;
      g.textAlign = 'right';
      g.globalAlpha = 0.85;
      g.fillText(sub, w - 60, 252);
    }
    st.signT.needsUpdate = true;
    st.sign.material.uniforms.uColor.value.copy(new THREE.Color(color)).multiplyScalar(1.3);
  }
  for (const st of stations) drawSign(st, 'READY', '#8fd8ff', '');

  return {
    group, floor, stations,
    // list: [{ i(스테이션 번호), color, label, sub }] — 쓰는 스테이션만 선수 색으로 밝힙니다.
    setStations(list) {
      for (const st of stations) {
        const on = list.find((x) => x.i === st.i);
        st.active = Boolean(on);
        const col = on ? on.color : '#4a6a9a';
        st.ringM.color.set(col).multiplyScalar(on ? 2.6 : 0.8);
        st.arcsM.color.set(col).multiplyScalar(on ? 1.8 : 0.6);
        st.topM.color.set(on ? col : '#5aa8ff').multiplyScalar(on ? 0.5 : 0.25);
        drawSign(st, on ? on.label : 'STANDBY', on ? on.color : '#5a7aa8', on ? on.sub || '' : '');
      }
    },
    update(t) {
      for (const m of anim) m.uniforms.uTime.value = t;
      for (const st of stations) st.arcs.rotation.y = t * (st.active ? 0.35 : 0.1) + st.i;
    }
  };
}

// ================================================================
// 주변 반사용 환경(금속 칼자루·광택 바닥이 비출 장면): 어두운 방 + 천장 줄 조명 + 벽 띠
// ================================================================
export function makeEnvScene() {
  const s = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(40, 14, 40), new THREE.MeshBasicMaterial({ color: '#0b0e15', side: THREE.BackSide }));
  room.position.y = 5;
  s.add(room);
  const white = new THREE.MeshBasicMaterial({ color: hdr('#e8f0ff', 5) });
  for (let x = -15; x <= 15; x += 5) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 30), white);
    b.position.set(x, 11.8, 0);
    s.add(b);
  }
  const cyan = new THREE.MeshBasicMaterial({ color: hdr('#5ab4ff', 4) });
  for (const z of [-19.8, 19.8]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(40, 0.25, 0.1), cyan);
    b.position.set(0, 3, z);
    s.add(b);
  }
  for (const x of [-19.8, 19.8]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.25, 40), cyan);
    b.position.set(x, 3, 0);
    s.add(b);
  }
  const warm = new THREE.MeshBasicMaterial({ color: hdr('#ffd9b0', 3) });
  const p = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 0.1), warm);
  p.position.set(6, 6, 19.8);
  s.add(p);
  return s;
}
