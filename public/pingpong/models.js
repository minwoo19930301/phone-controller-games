// 탁구 3D 모델: 라켓(블레이드·러버·손잡이·엣지 테이프·배지), 공, 테이블·네트, 넘김식 점수판, 경기장.
// 라켓은 모든 화면에서 가까이 보이는 주인공 소품이라 겹판 나무 옆면, 러버 돌기 결, 스펀지 단면까지 만듭니다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TABLE, BALL_R } from './physics.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const FONT_D = 'Anton, Impact, "Pretendard Variable", sans-serif';
const FONT_S = '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", sans-serif';

// ---------- 텍스처 도구 ----------
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
function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// 값 잡음(px, py 는 주기 — 반복 텍스처가 이음매 없이 이어지게)
function vnoise(x, y, s, px = 1e9, py = 1e9) {
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
function fbm(x, y, s, oct = 4, px = 1e9, py = 1e9) {
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
const mix = (a, b, t) => a + (b - a) * t;
function pixels(w, h, fn) {
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
// 높이 함수 → 법선 맵
function normalMap(w, h, height, strength) {
  const H = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) H[y * w + x] = height(x, y);
  return pixels(w, h, (x, y, c) => {
    const l = H[y * w + ((x - 1 + w) % w)];
    const r = H[y * w + ((x + 1) % w)];
    const u = H[((y - 1 + h) % h) * w + x];
    const d = H[((y + 1) % h) * w + x];
    let nx = (l - r) * strength;
    let ny = (d - u) * strength;
    const nz = 1;
    const len = Math.hypot(nx, ny, nz);
    c[0] = ((nx / len) * 0.5 + 0.5) * 255;
    c[1] = ((ny / len) * 0.5 + 0.5) * 255;
    c[2] = ((nz / len) * 0.5 + 0.5) * 255;
    c[3] = 255;
  });
}

// 나뭇결(결 방향 = 세로)
function woodCanvas(w, h, light, dark, seed, rings = 9) {
  return pixels(w, h, (x, y, c) => {
    const n = fbm(x / 48, y / 260, seed, 4, w / 48, h / 260);
    const t = (x / w) * rings + n * 3.2 + Math.sin(y / 90 + seed) * 0.2;
    const ring = Math.pow(0.5 + 0.5 * Math.sin(t * Math.PI * 2), 3);
    const fine = vnoise(x / 1.6, y / 40, seed + 5, w / 1.6, h / 40);
    const k = ring * 0.42 + fine * 0.14;
    c[0] = mix(light[0], dark[0], k);
    c[1] = mix(light[1], dark[1], k);
    c[2] = mix(light[2], dark[2], k);
    c[3] = 255;
  });
}

// ---------- 공용 텍스처 ----------
const glowTex = tex(canvas(128, 128, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,255,255,.55)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, w, h);
}));
const blobTex = tex(canvas(128, 128, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, 'rgba(0,0,0,.85)');
  r.addColorStop(0.35, 'rgba(0,0,0,.5)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, w, h);
}));
export { glowTex };

// ================================================================
// 라켓
// ================================================================
// 블레이드 좌표: 손잡이와 만나는 목 아래가 원점, +y 가 블레이드 끝, +z 가 포핸드(빨강) 면.
const BLADE_T = 0.006;
const BLADE_BEVEL = 0.0004;
const RUB_T = 0.0019;
const RUB_BEVEL = 0.0003;
const SWEET_Y = 0.098; // 라켓 무리 중심(공이 맞는 곳)

function cleanPts(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || q.distanceTo(p) > 1e-6) out.push(p);
  }
  if (out.length > 2 && out[0].distanceTo(out[out.length - 1]) < 1e-6) out.pop();
  return out;
}

// 블레이드 윤곽: 폭 0.15, 머리 높이 약 0.158, 목은 손잡이 속으로 들어갑니다.
function bladePoints() {
  const s = new THREE.Shape();
  s.moveTo(0.0155, 0);
  s.lineTo(0.0155, 0.012);
  s.bezierCurveTo(0.0165, 0.024, 0.036, 0.027, 0.054, 0.037);
  s.bezierCurveTo(0.0665, 0.0442, 0.0752, 0.064, 0.0752, 0.091);
  s.bezierCurveTo(0.0752, 0.1395, 0.0448, 0.1705, 0, 0.1705);
  s.bezierCurveTo(-0.0448, 0.1705, -0.0752, 0.1395, -0.0752, 0.091);
  s.bezierCurveTo(-0.0752, 0.064, -0.0665, 0.0442, -0.054, 0.037);
  s.bezierCurveTo(-0.036, 0.027, -0.0165, 0.024, -0.0155, 0.012);
  s.lineTo(-0.0155, 0);
  s.lineTo(0.0155, 0);
  return cleanPts(s.getPoints(28));
}
const rubberCut = (x) => 0.0295 + 0.0065 * (x / 0.05) * (x / 0.05);

// 러버 윤곽: 블레이드 머리를 따라가다가 손잡이 쪽은 완만한 호로 잘립니다.
function rubberPoints(blade) {
  const c = V(0, 0.091, 0);
  const inset = (p) => {
    const d = new THREE.Vector2(p.x - c.x, p.y - c.y);
    const l = d.length();
    return new THREE.Vector2(p.x - (d.x / l) * 0.0001, p.y - (d.y / l) * 0.0001);
  };
  const keep = [];
  let started = false;
  for (const p of blade) {
    const ok = p.y >= rubberCut(p.x) && p.y > 0.02;
    if (ok) {
      keep.push(inset(p));
      started = true;
    } else if (started && keep.length > 10) break;
  }
  const xl = keep[keep.length - 1].x;
  const xr = keep[0].x;
  for (let i = 1; i < 24; i++) {
    const x = xl + ((xr - xl) * i) / 24;
    keep.push(new THREE.Vector2(x, rubberCut(x)));
  }
  return cleanPts(keep);
}

// ExtrudeGeometry 의 UV 는 모양 좌표(m) 그대로라서 직접 다시 매깁니다.
// 앞뒷면(그룹 0)은 윤곽 상자에 0~1, 옆면(그룹 1)은 v = 두께 방향 0~1, u = 둘레 방향 길이 × uScale.
function remapUV(geo, box, uScale) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  geo.computeBoundingBox();
  const zMin = geo.boundingBox.min.z;
  const zMax = geo.boundingBox.max.z;
  const [g0, g1] = geo.groups;
  for (let i = g0.start; i < g0.start + g0.count; i++) {
    uv.setXY(i, (pos.getX(i) - box.minX) / (box.maxX - box.minX), (pos.getY(i) - box.minY) / (box.maxY - box.minY));
  }
  if (g1) {
    for (let i = g1.start; i < g1.start + g1.count; i++) {
      uv.setXY(i, uv.getX(i) * uScale, (pos.getZ(i) - zMin) / (zMax - zMin));
    }
  }
  uv.needsUpdate = true;
}

// 손잡이: 둥근 직사각형 단면을 위아래로 이어 붙인 플레어(FL) 손잡이. 위쪽은 얇아지며 블레이드에 붙습니다.
const HANDLE_PROFILE = [
  // y, 반폭(x), 반두께(z)
  [0.0345, 0.0157, 0.0030],
  [0.0265, 0.0166, 0.0052],
  [0.0165, 0.0172, 0.0082],
  [0.0040, 0.0168, 0.0104],
  [-0.0150, 0.0151, 0.0113],
  [-0.0350, 0.0139, 0.0116],
  [-0.0580, 0.0146, 0.0118],
  [-0.0780, 0.0163, 0.0120],
  [-0.0900, 0.0172, 0.0120],
  [-0.0960, 0.0168, 0.0113],
  [-0.0990, 0.0150, 0.0096],
  [-0.1005, 0.0112, 0.0066]
];
const HANDLE_N = 3.0;
function catmull(rows, t) {
  const n = rows.length - 1;
  const f = Math.min(n - 1e-9, Math.max(0, t * n));
  const i = Math.floor(f);
  const u = f - i;
  const p0 = rows[Math.max(0, i - 1)], p1 = rows[i], p2 = rows[Math.min(n, i + 1)], p3 = rows[Math.min(n, i + 2)];
  return p1.map((_, k) => {
    const a = p0[k], b = p1[k], c = p2[k], d = p3[k];
    return 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
  });
}
const superXZ = (phi, hw, hd) => {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  return [hw * Math.sign(c) * Math.pow(Math.abs(c), 2 / HANDLE_N), hd * Math.sign(s) * Math.pow(Math.abs(s), 2 / HANDLE_N)];
};
// 손잡이 단면 위의 겉면 높이(배지를 붙일 때 씁니다)
export function handleSurfaceZ(y, x) {
  const yTop = HANDLE_PROFILE[0][0];
  const yBot = HANDLE_PROFILE[HANDLE_PROFILE.length - 1][0];
  const [, hw, hd] = catmull(HANDLE_PROFILE, (yTop - y) / (yTop - yBot));
  const r = Math.min(0.999, Math.abs(x) / hw);
  return hd * Math.pow(1 - Math.pow(r, HANDLE_N), 1 / HANDLE_N);
}
function handleGeometry() {
  const M = 48;
  const S = 64;
  const pos = [];
  const uv = [];
  const idx = [];
  const yTop = HANDLE_PROFILE[0][0];
  const yBot = HANDLE_PROFILE[HANDLE_PROFILE.length - 1][0];
  for (let j = 0; j <= S; j++) {
    const [y, hw, hd] = catmull(HANDLE_PROFILE, j / S);
    for (let k = 0; k <= M; k++) {
      const [x, z] = superXZ((k / M) * Math.PI * 2, hw, hd);
      pos.push(x, y, z);
      uv.push(k / M, (y - yBot) / (yTop - yBot));
    }
  }
  for (let j = 0; j < S; j++) {
    for (let k = 0; k < M; k++) {
      const a = j * (M + 1) + k;
      const b = a + M + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  // 손잡이 끝을 막습니다.
  const center = pos.length / 3;
  pos.push(0, yBot - 0.0004, 0);
  uv.push(0.5, 0);
  const last = S * (M + 1);
  for (let k = 0; k < M; k++) idx.push(last + k, last + k + 1, center);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // UV 이음매 양쪽 법선을 맞춰 음영이 끊기지 않게 합니다.
  const n = geo.attributes.normal;
  for (let j = 0; j <= S; j++) {
    const a = j * (M + 1);
    const b = a + M;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l);
    n.setXYZ(b, x / l, y / l, z / l);
  }
  return geo;
}

// 엣지 테이프: 블레이드 위쪽 둘레를 감싸는 띠(양면 러버 가장자리까지 살짝 덮음)
function tapeGeometry(blade) {
  const pts = blade.filter((p) => p.y >= 0.074);
  // 윤곽은 반시계 방향: 오른쪽 아래 → 위 → 왼쪽. 위쪽 구간만 이어진 순서로 남깁니다.
  const prof = [[-0.0011, -0.0057], [0.0001, -0.0059], [0.00055, -0.0046], [0.00072, -0.0016], [0.00072, 0.0016], [0.00055, 0.0046], [0.0001, 0.0059], [-0.0011, 0.0057]];
  const pos = [];
  const uv = [];
  const idx = [];
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const tl = Math.hypot(tx, ty) || 1;
    const nx = ty / tl;
    const ny = -tx / tl;
    if (i > 0) len += p.distanceTo(pts[i - 1]);
    for (let k = 0; k < prof.length; k++) {
      const [o, z] = prof[k];
      pos.push(p.x + nx * (o + BLADE_BEVEL), p.y + ny * (o + BLADE_BEVEL), z);
      uv.push(len * 30, k / (prof.length - 1));
    }
  }
  const P = prof.length;
  for (let i = 0; i < pts.length - 1; i++) {
    for (let k = 0; k < P - 1; k++) {
      const a = i * P + k;
      const b = a + P;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// 라켓 재료(한 번만 만들어 모든 라켓이 같이 씁니다)
let paddleKit = null;
function buildPaddleKit() {
  const blade = bladePoints();
  const xs = blade.map((p) => p.x);
  const ys = blade.map((p) => p.y);
  const bbox = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const bladeGeo = new THREE.ExtrudeGeometry(new THREE.Shape(blade), {
    depth: BLADE_T - BLADE_BEVEL * 2, bevelEnabled: true, bevelThickness: BLADE_BEVEL, bevelSize: BLADE_BEVEL, bevelSegments: 2, curveSegments: 1
  });
  bladeGeo.translate(0, 0, -(BLADE_T - BLADE_BEVEL * 2) / 2);
  remapUV(bladeGeo, bbox, 22);

  const rub = rubberPoints(blade);
  const rxs = rub.map((p) => p.x);
  const rys = rub.map((p) => p.y);
  const rbox = { minX: Math.min(...rxs), maxX: Math.max(...rxs), minY: Math.min(...rys), maxY: Math.max(...rys) };
  const rubberGeo = new THREE.ExtrudeGeometry(new THREE.Shape(rub), {
    depth: RUB_T - RUB_BEVEL * 2, bevelEnabled: true, bevelThickness: RUB_BEVEL, bevelSize: RUB_BEVEL, bevelSegments: 3, curveSegments: 1
  });
  remapUV(rubberGeo, rbox, 26);
  rubberGeo.translate(0, 0, BLADE_T / 2 + RUB_BEVEL);

  // 겹판 옆면: 바깥 코토 / 접착선 / 림바 / 아유스 심재 / 림바 / 코토 (v = 두께 방향)
  const plies = [
    [0.0, 0.07, [236, 214, 166]], [0.07, 0.085, [92, 62, 34]], [0.085, 0.24, [214, 176, 118]], [0.24, 0.255, [96, 66, 36]],
    [0.255, 0.745, [228, 196, 140]], [0.745, 0.76, [96, 66, 36]], [0.76, 0.915, [214, 176, 118]], [0.915, 0.93, [92, 62, 34]], [0.93, 1.0, [236, 214, 166]]
  ];
  const plyTex = tex(pixels(256, 64, (x, y, c) => {
    const v = 1 - (y + 0.5) / 64;
    const ply = plies.find((p) => v >= p[0] && v <= p[1]) || plies[4];
    const g = vnoise(x / 3, y / 30, 3, 256 / 3, 64 / 30) * 0.18 + fbm(x / 20, y, 9, 2, 256 / 20, 64) * 0.08;
    c[0] = ply[2][0] * (0.88 + g);
    c[1] = ply[2][1] * (0.88 + g);
    c[2] = ply[2][2] * (0.88 + g);
    c[3] = 255;
  }), true, true);
  const faceWood = tex(woodCanvas(512, 512, [232, 206, 158], [180, 132, 80], 11, 7));
  const bladeMats = [
    new THREE.MeshStandardMaterial({ map: faceWood, roughness: 0.62 }),
    new THREE.MeshStandardMaterial({ map: plyTex, roughness: 0.7 })
  ];

  // 러버 표면: 아주 고운 결 + 안쪽 돌기가 비치는 육각 무늬(법선 맵)
  const grain = normalMap(512, 512, (x, y) => {
    const fine = vnoise(x / 1.3, y / 1.3, 21, 512 / 1.3, 512 / 1.3) * 0.5 + vnoise(x / 3.5, y / 3.5, 22, 512 / 3.5, 512 / 3.5) * 0.35;
    // 육각 배열 돌기(지름 약 1.5mm 가 512px 에 32개)
    const cs = 16;
    const row = Math.floor(y / (cs * 0.866));
    const ox = row % 2 ? cs / 2 : 0;
    const cx = (Math.floor((x - ox) / cs) + 0.5) * cs + ox;
    const cy = (row + 0.5) * cs * 0.866;
    const d = Math.hypot(x - cx, y - cy) / (cs * 0.5);
    const pip = d < 1 ? Math.cos(d * Math.PI * 0.5) * 0.12 : 0;
    return fine + pip;
  }, 2.2);
  const grainTex = tex(grain, false, true);
  grainTex.repeat.set(3, 3);
  function rubberFace(base, ink, gold, sheenColor) {
    const map = tex(canvas(1024, 1024, (g, w, h) => {
      g.fillStyle = base;
      g.fillRect(0, 0, w, h);
      // 아주 옅은 얼룩(고무 반죽 결)
      const img = g.getImageData(0, 0, w, h);
      const d = img.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const n = (fbm(x / 90, y / 90, 31, 3) - 0.5) * 14 + (hash2(x, y, 7) - 0.5) * 6;
          const k = (y * w + x) * 4;
          d[k] += n;
          d[k + 1] += n * 0.6;
          d[k + 2] += n * 0.6;
        }
      }
      g.putImageData(img, 0, 0);
      // 손잡이 쪽 상표 인쇄
      g.save();
      g.translate(w / 2, h * 0.86);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = ink;
      g.font = `400 86px ${FONT_D}`;
      g.fillText('PCG', 0, -40);
      g.font = `800 34px ${FONT_S}`;
      g.fillStyle = gold;
      g.fillText('TENSION  40+', 0, 26);
      g.strokeStyle = gold;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(-150, 56);
      g.lineTo(150, 56);
      g.stroke();
      g.restore();
    }));
    return new THREE.MeshPhysicalMaterial({
      map, normalMap: grainTex, normalScale: new THREE.Vector2(0.32, 0.32), roughness: 0.52,
      sheen: 0.55, sheenRoughness: 0.42, sheenColor: new THREE.Color(sheenColor),
      clearcoat: 0.22, clearcoatRoughness: 0.42
    });
  }
  // 러버 옆면: 스펀지(구멍 숭숭) + 윗시트
  function rubberEdge(sponge, top) {
    return new THREE.MeshStandardMaterial({
      roughness: 0.85,
      map: tex(pixels(256, 32, (x, y, c) => {
        const v = 1 - (y + 0.5) / 32;
        const isTop = v > 0.74;
        const base = isTop ? top : sponge;
        const pore = isTop ? 1 : 0.75 + vnoise(x / 1.5, y / 1.5, 41, 256 / 1.5, 32 / 1.5) * 0.4;
        c[0] = base[0] * pore;
        c[1] = base[1] * pore;
        c[2] = base[2] * pore;
        c[3] = 255;
      }), true, true)
    });
  }
  const red = [rubberFace('#c8141d', 'rgba(40,0,0,.55)', 'rgba(255,214,120,.8)', '#ff8a8a'), rubberEdge([238, 170, 58], [176, 16, 22])];
  const black = [rubberFace('#17181b', 'rgba(255,255,255,.18)', 'rgba(230,196,110,.75)', '#8890a0'), rubberEdge([230, 160, 50], [22, 22, 26])];

  // 손잡이 나무: 밝은 물푸레나무 + 좁은 옆면의 호두나무 띠
  const handleTex = tex(pixels(256, 1024, (x, y, c) => {
    const u = x / 256;
    const n = fbm(x / 40, y / 300, 51, 4, 256 / 40, 1024 / 300);
    const t = u * 10 + n * 3;
    const ring = Math.pow(0.5 + 0.5 * Math.sin(t * Math.PI * 2), 3);
    const fine = vnoise(x / 1.2, y / 50, 52, 256 / 1.2, 1024 / 50);
    let col = [226, 196, 146];
    let dark = [176, 130, 78];
    const du = Math.min(Math.abs(u - 0), Math.abs(u - 0.5), Math.abs(u - 1));
    if (du < 0.045) {
      col = [112, 70, 40];
      dark = [70, 40, 22];
    } else if (du < 0.055) {
      col = [240, 220, 180];
      dark = [210, 186, 140];
    }
    const k = ring * 0.4 + fine * 0.16;
    c[0] = mix(col[0], dark[0], k);
    c[1] = mix(col[1], dark[1], k);
    c[2] = mix(col[2], dark[2], k);
    c[3] = 255;
  }));
  const handleMat = new THREE.MeshPhysicalMaterial({ map: handleTex, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.5 });

  // 배지 모양(둥근 방패)
  const bs = new THREE.Shape();
  bs.moveTo(-0.0085, 0.012);
  bs.lineTo(0.0085, 0.012);
  bs.quadraticCurveTo(0.0095, 0.012, 0.0095, 0.009);
  bs.lineTo(0.0095, -0.004);
  bs.quadraticCurveTo(0.0095, -0.011, 0, -0.0145);
  bs.quadraticCurveTo(-0.0095, -0.011, -0.0095, -0.004);
  bs.lineTo(-0.0095, 0.009);
  bs.quadraticCurveTo(-0.0095, 0.012, -0.0085, 0.012);
  const badgeGeo = new THREE.ExtrudeGeometry(bs, { depth: 0.0004, bevelEnabled: true, bevelThickness: 0.00015, bevelSize: 0.0002, bevelSegments: 1, curveSegments: 10 });
  remapUV(badgeGeo, { minX: -0.0095, maxX: 0.0095, minY: -0.0145, maxY: 0.012 }, 1);
  // 손잡이 겉면 곡률을 따라 휘게
  const BADGE_Y = -0.046;
  {
    const p = badgeGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + handleSurfaceZ(BADGE_Y + p.getY(i), p.getX(i)) - 0.00005);
    badgeGeo.computeVertexNormals();
  }

  paddleKit = {
    bladeGeo, rubberGeo, red, black, bladeMats, handleGeo: handleGeometry(), handleMat,
    tapeGeo: tapeGeometry(blade), badgeGeo, BADGE_Y
  };
  return paddleKit;
}

function badgeMaterial(color, label) {
  const map = tex(canvas(160, 220, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, color);
    gr.addColorStop(1, shade(color, -0.35));
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.85)';
    g.lineWidth = 8;
    g.strokeRect(10, 10, w - 20, h - 20);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `400 ${label.length > 2 ? 58 : 84}px ${FONT_D}`;
    g.fillText(label, w / 2, h * 0.47);
  }));
  return new THREE.MeshPhysicalMaterial({ map, metalness: 0.35, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15 });
}

export function shade(hex, k) {
  const c = new THREE.Color(hex);
  if (k < 0) c.multiplyScalar(1 + k);
  else c.lerp(new THREE.Color('#ffffff'), k);
  return `#${c.getHexString()}`;
}

/**
 * 라켓 하나. 묶음의 원점이 무리 중심(공이 맞는 곳), +y = 블레이드 끝, +z = 빨강(포핸드) 면 법선.
 */
export function makePaddle(color, label) {
  const kit = paddleKit || buildPaddleKit();
  const group = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.y = -SWEET_Y;
  group.add(inner);
  const add = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    inner.add(m);
    return m;
  };
  add(kit.bladeGeo, kit.bladeMats);
  add(kit.rubberGeo, kit.red);
  const back = add(kit.rubberGeo, kit.black);
  back.rotation.y = Math.PI; // 좌우 대칭이라 뒤집으면 뒷면 러버가 됩니다.
  add(kit.handleGeo, kit.handleMat);
  const tapeMat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.2 });
  add(kit.tapeGeo, tapeMat);
  const badgeMat = badgeMaterial(color, label);
  const b1 = add(kit.badgeGeo, badgeMat);
  b1.position.y = kit.BADGE_Y;
  const b2 = add(kit.badgeGeo, badgeMat);
  b2.position.y = kit.BADGE_Y;
  b2.rotation.y = Math.PI;
  group.userData.dispose = () => {
    tapeMat.dispose();
    badgeMat.map.dispose();
    badgeMat.dispose();
  };
  return group;
}

// ================================================================
// 공
// ================================================================
export function makeBall() {
  const map = tex(canvas(512, 256, (g, w, h) => {
    g.fillStyle = '#f6f5f0';
    g.fillRect(0, 0, w, h);
    // 반구 이음선
    g.strokeStyle = 'rgba(190,190,180,.55)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2);
    g.stroke();
    // 옅게 인쇄된 상표: 별 세 개와 40+
    g.save();
    g.translate(w * 0.25, h * 0.5);
    g.fillStyle = 'rgba(232,120,40,.62)';
    for (let i = -1; i <= 1; i++) star(g, i * 26, -20, 11);
    g.font = `400 30px ${FONT_D}`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(60,60,60,.45)';
    g.fillText('40+', 0, 26);
    g.restore();
    g.save();
    g.translate(w * 0.75, h * 0.5);
    g.font = `800 20px ${FONT_S}`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(60,60,60,.32)';
    g.fillText('PCG', 0, 8);
    g.restore();
  }));
  const mat = new THREE.MeshPhysicalMaterial({
    map, color: '#ffffff', roughness: 0.38, clearcoat: 0.55, clearcoatRoughness: 0.28,
    emissive: '#ffffff', emissiveIntensity: 0.06
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 40, 28), mat);
  mesh.castShadow = false;
  return mesh;
}
function star(g, x, y, r) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

// 공 그림자(바로 아래로 떨어지는 동그란 그림자)
export function makeBlob() {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  return m;
}

// 공 꼬리(카메라를 향하는 띠, 뒤로 갈수록 흐려짐). 화면마다 카메라 쪽으로 다시 펼칩니다.
export function makeTrail(n = 18) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
  const col = new Float32Array(n * 2 * 4);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.userData = { n, pts: [], count: 0 };
  return mesh;
}
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _t3 = new THREE.Vector3();
export function layoutTrail(trail, camPos) {
  const { n, pts } = trail.userData;
  const count = Math.min(n, pts.length);
  const pos = trail.geometry.attributes.position;
  const col = trail.geometry.attributes.color;
  if (count < 2) {
    trail.visible = false;
    return;
  }
  trail.visible = true;
  for (let i = 0; i < n; i++) {
    const k = Math.min(i, count - 1);
    const p = pts[k];
    const q = pts[Math.min(count - 1, k + 1)];
    const o = pts[Math.max(0, k - 1)];
    _t1.set(q[0] - o[0], q[1] - o[1], q[2] - o[2]);
    _t2.set(p[0] - camPos.x, p[1] - camPos.y, p[2] - camPos.z);
    _t3.crossVectors(_t1, _t2).normalize();
    const f = k / (count - 1); // 0 = 가장 오래된 점, 1 = 공
    const w = BALL_R * (0.25 + 0.75 * f);
    pos.setXYZ(i * 2, p[0] + _t3.x * w, p[1] + _t3.y * w, p[2] + _t3.z * w);
    pos.setXYZ(i * 2 + 1, p[0] - _t3.x * w, p[1] - _t3.y * w, p[2] - _t3.z * w);
    const a = i < count ? f * f * 0.55 : 0;
    col.setXYZW(i * 2, 1, 1, 1, a);
    col.setXYZW(i * 2 + 1, 1, 1, 1, a);
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;
}

// ================================================================
// 테이블과 네트
// ================================================================
const metal = (color, r = 0.42, m = 0.6) => new THREE.MeshStandardMaterial({ color, roughness: r, metalness: m });

// 윗면 재질은 테이블 A·B 가 함께 씁니다. 픽셀마다 잡음을 그리는 큰 캔버스라 한 번만 만듭니다.
let tableTopMat = null;
function tableTopMaterial() {
  if (tableTopMat) return tableTopMat;
  const L = TABLE.halfL * 2;
  const W = TABLE.halfW * 2;
  // 윗면: 파란 바탕 + 2cm 흰 선(가장자리) + 3mm 가운데 선. 캔버스 가로 = x(폭), 세로 = z(길이)
  const topTex = tex(canvas(1024, 1840, (c, w, h) => {
    c.fillStyle = '#1f4fa3';
    c.fillRect(0, 0, w, h);
    const img = c.getImageData(0, 0, w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = (fbm(x / 140, y / 140, 61, 3) - 0.5) * 9 + (hash2(x, y, 62) - 0.5) * 5;
        const k = (y * w + x) * 4;
        d[k] += n * 0.5;
        d[k + 1] += n * 0.7;
        d[k + 2] += n;
      }
    }
    c.putImageData(img, 0, 0);
    const ex = (0.02 / W) * w;
    const ey = (0.02 / L) * h;
    c.fillStyle = '#f4f6f8';
    c.fillRect(0, 0, ex, h);
    c.fillRect(w - ex, 0, ex, h);
    c.fillRect(0, 0, w, ey);
    c.fillRect(0, h - ey, w, ey);
    c.fillRect(w / 2 - 1.1, 0, 2.2, h);
    // 두 쪽 테이블이 만나는 이음매(네트 아래)
    c.fillStyle = 'rgba(8,20,48,.55)';
    c.fillRect(0, h / 2 - 1, w, 2);
  }));
  topTex.anisotropy = 16;
  tableTopMat = new THREE.MeshPhysicalMaterial({ map: topTex, roughness: 0.48, clearcoat: 0.18, clearcoatRoughness: 0.32 });
  return tableTopMat;
}

export function makeTable() {
  const g = new THREE.Group();
  const L = TABLE.halfL * 2;
  const W = TABLE.halfW * 2;
  const T = TABLE.thick;
  const topMat = tableTopMaterial();
  const edgeMat = new THREE.MeshStandardMaterial({ color: '#173c80', roughness: 0.5 });
  const underMat = new THREE.MeshStandardMaterial({ color: '#2a2e36', roughness: 0.85 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(W, T, L), [edgeMat, edgeMat, topMat, underMat, edgeMat, edgeMat]);
  top.position.y = TABLE.y - T / 2;
  top.castShadow = true;
  top.receiveShadow = true;
  g.add(top);

  // 다리와 틀: 짙은 회색 철제. 반쪽마다 다리틀 하나, 가운데 긴 들보, 바퀴.
  const steel = metal('#262a31', 0.38, 0.65);
  const darkSteel = metal('#17191d', 0.5, 0.5);
  const rubber = new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: 0.9 });
  const hub = metal('#8b929c', 0.3, 0.9);
  const parts = [];
  const box = (w, h, d, x, y, z, mat = steel) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    parts.push(m);
    return m;
  };
  const yUnder = TABLE.y - T;
  // 윗판 아래 테두리 틀
  box(W - 0.16, 0.05, 0.03, 0, yUnder - 0.025, TABLE.halfL - 0.1, darkSteel);
  box(W - 0.16, 0.05, 0.03, 0, yUnder - 0.025, -TABLE.halfL + 0.1, darkSteel);
  box(0.03, 0.05, L - 0.2, TABLE.halfW - 0.08, yUnder - 0.025, 0, darkSteel);
  box(0.03, 0.05, L - 0.2, -TABLE.halfW + 0.08, yUnder - 0.025, 0, darkSteel);
  for (const sz of [-1, 1]) {
    const z = sz * 0.92;
    // 기울어진 다리 두 개 + 가로대
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.055, yUnder - 0.08, 0.055), steel);
      leg.position.set(sx * 0.58, (yUnder - 0.08) / 2 + 0.08, z);
      leg.rotation.z = sx * 0.06;
      leg.castShadow = true;
      g.add(leg);
      // 바퀴
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.032, 24), rubber);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx * 0.62, 0.048, z + sz * 0.05);
      wheel.castShadow = true;
      g.add(wheel);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.036, 16), hub);
      cap.rotation.z = Math.PI / 2;
      cap.position.copy(wheel.position);
      g.add(cap);
      box(0.06, 0.03, 0.12, sx * 0.62, 0.1, z + sz * 0.03, darkSteel);
      // 수평 맞추는 발
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.02, 16), rubber);
      foot.position.set(sx * 0.58, 0.01, z - sz * 0.05);
      g.add(foot);
    }
    box(1.2, 0.05, 0.05, 0, 0.16, z);
    box(1.12, 0.04, 0.04, 0, yUnder - 0.07, z);
    // 상표 판
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.09), new THREE.MeshStandardMaterial({ map: brandPlate(), roughness: 0.4, metalness: 0.3 }));
    plate.position.set(0, 0.16, z + sz * 0.026);
    if (sz < 0) plate.rotation.y = Math.PI;
    g.add(plate);
  }
  // 가운데 긴 들보
  box(0.07, 0.07, 1.9, 0, 0.36, 0);
  box(0.05, 0.05, 1.84, 0, yUnder - 0.07, 0, darkSteel);

  g.add(makeNet());
  return g;
}
function brandPlate() {
  return tex(canvas(512, 128, (g, w, h) => {
    g.fillStyle = '#101317';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8ecf2';
    g.font = `400 64px ${FONT_D}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('PCG  TOURNAMENT 25', w / 2, h / 2 + 4);
  }));
}

function makeNet() {
  const g = new THREE.Group();
  const span = (TABLE.halfW + TABLE.netOver) * 2;
  const tapeH = 0.015;
  const meshH = TABLE.netH - tapeH;
  // 그물: 한 칸(약 14mm)짜리 무늬를 반복합니다.
  const cell = canvas(64, 64, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.strokeStyle = 'rgba(14,22,46,1)';
    c.lineWidth = 7;
    c.beginPath();
    c.moveTo(0, 3.5);
    c.lineTo(w, 3.5);
    c.moveTo(3.5, 0);
    c.lineTo(3.5, h);
    c.stroke();
  });
  const netTex = tex(cell, true, true);
  netTex.repeat.set(span / 0.014, meshH / 0.014);
  const netMat = new THREE.MeshStandardMaterial({ map: netTex, transparent: true, alphaTest: 0.04, side: THREE.DoubleSide, roughness: 0.9, depthWrite: true });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(span, meshH), netMat);
  mesh.position.y = TABLE.y + meshH / 2;
  mesh.castShadow = true;
  g.add(mesh);
  // 흰 윗줄 테이프
  const tapeMat = new THREE.MeshStandardMaterial({ color: '#f3f3ef', roughness: 0.55 });
  const tape = new THREE.Mesh(new THREE.BoxGeometry(span, tapeH, 0.004), tapeMat);
  tape.position.y = TABLE.y + TABLE.netH - tapeH / 2;
  tape.castShadow = true;
  g.add(tape);
  // 아래 줄과 양끝 세로 줄
  const cordMat = new THREE.MeshStandardMaterial({ color: '#0e1630', roughness: 0.8 });
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(span, 0.004, 0.003), cordMat);
  bottom.position.y = TABLE.y + 0.003;
  g.add(bottom);
  // 지주와 죔쇠
  const postMat = metal('#1a1d22', 0.35, 0.7);
  const accent = new THREE.MeshStandardMaterial({ color: '#2d5fc4', roughness: 0.35, metalness: 0.3 });
  for (const s of [-1, 1]) {
    const x = s * span / 2;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0065, TABLE.netH + 0.012, 14), postMat);
    post.position.set(x + s * 0.004, TABLE.y + (TABLE.netH + 0.012) / 2, 0);
    post.castShadow = true;
    g.add(post);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.009, 14, 10), accent);
    cap.position.set(x + s * 0.004, TABLE.y + TABLE.netH + 0.014, 0);
    g.add(cap);
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.003, TABLE.netH, 0.003), tapeMat);
    side.position.set(x - s * 0.002, TABLE.y + TABLE.netH / 2, 0);
    g.add(side);
    // 테이블 가장자리를 위아래로 무는 죔쇠
    const armLen = span / 2 - TABLE.halfW + 0.035;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(armLen, 0.012, 0.03), postMat);
    arm.position.set(s * (TABLE.halfW - 0.035 + armLen / 2), TABLE.y + 0.006, 0);
    arm.castShadow = true;
    g.add(arm);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.012, 0.034), postMat);
    jaw.position.set(s * (TABLE.halfW - 0.02), TABLE.y - TABLE.thick - 0.006, 0);
    g.add(jaw);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.012, TABLE.thick + 0.024, 0.032), postMat);
    spine.position.set(s * (TABLE.halfW + 0.012), TABLE.y - TABLE.thick / 2, 0);
    g.add(spine);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 18), accent);
    knob.position.set(s * (TABLE.halfW - 0.03), TABLE.y - TABLE.thick - 0.024, 0);
    g.add(knob);
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.03, 8), metal('#9aa3ad', 0.3, 0.9));
    screw.position.set(s * (TABLE.halfW - 0.03), TABLE.y - TABLE.thick - 0.012, 0);
    g.add(screw);
  }
  return g;
}

// ================================================================
// 넘김식 점수판(심판석 위). 양면이라 양쪽 선수가 각자 자기 점수를 왼쪽에서 봅니다.
// ================================================================
const digitCache = new Map();
function digitTex(n) {
  if (digitCache.has(n)) return digitCache.get(n);
  const c = canvas(256, 320, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#1b2a52');
    gr.addColorStop(0.5, '#111c3a');
    gr.addColorStop(1, '#0c1530');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#f7f6f0';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `400 ${n >= 10 ? 210 : 250}px ${FONT_D}`;
    g.fillText(String(n), w / 2, h / 2 + 14);
    // 위아래 반쪽이 갈라지는 틈
    g.fillStyle = 'rgba(0,0,0,.65)';
    g.fillRect(0, h / 2 - 3, w, 6);
    g.fillStyle = 'rgba(255,255,255,.08)';
    g.fillRect(0, h / 2 + 3, w, 2);
  });
  const top = tex(c);
  top.repeat.set(1, 0.5);
  top.offset.set(0, 0.5);
  const bot = tex(c);
  bot.repeat.set(1, 0.5);
  bot.offset.set(0, 0);
  const r = { top, bot };
  digitCache.set(n, r);
  return r;
}
function labelTex(name, color) {
  return tex(canvas(256, 56, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#0b0f17';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `400 40px ${FONT_D}`;
    g.fillText(name, w / 2, h / 2 + 2);
  }));
}
function flipCard(w, h) {
  const g = new THREE.Group();
  const halfGeo = new THREE.PlaneGeometry(w, h / 2);
  const mk = () => new THREE.MeshStandardMaterial({ roughness: 0.42, emissive: '#ffffff', emissiveIntensity: 0.22 });
  const top = new THREE.Mesh(halfGeo, mk());
  top.position.y = h / 4;
  const bot = new THREE.Mesh(halfGeo, mk());
  bot.position.y = -h / 4;
  const leaf = new THREE.Group();
  const front = new THREE.Mesh(halfGeo, mk());
  front.position.set(0, h / 4, 0.002);
  const backGeo = halfGeo.clone().rotateX(Math.PI).translate(0, h / 4, -0.002);
  const backM = new THREE.Mesh(backGeo, mk());
  leaf.add(front, backM);
  leaf.visible = false;
  g.add(top, bot, leaf);
  let value = null;
  let flip = null;
  function show(n) {
    const d = digitTex(n);
    top.material.map = d.top;
    top.material.emissiveMap = d.top;
    bot.material.map = d.bot;
    bot.material.emissiveMap = d.bot;
    top.material.needsUpdate = true;
    bot.material.needsUpdate = true;
  }
  return {
    group: g,
    set(n, animate) {
      if (n === value) return;
      const old = value;
      value = n;
      if (!animate || old == null) {
        show(n);
        leaf.visible = false;
        flip = null;
        return;
      }
      const o = digitTex(old);
      const d = digitTex(n);
      top.material.map = d.top;
      top.material.emissiveMap = d.top;
      top.material.needsUpdate = true;
      front.material.map = o.top;
      front.material.emissiveMap = o.top;
      backM.material.map = d.bot;
      backM.material.emissiveMap = d.bot;
      front.material.needsUpdate = true;
      backM.material.needsUpdate = true;
      leaf.rotation.x = 0;
      leaf.visible = true;
      flip = { t: 0, n };
    },
    update(dt) {
      if (!flip) return;
      flip.t += dt / 0.36;
      const t = Math.min(1, flip.t);
      leaf.rotation.x = Math.PI * t * t; // 떨어지듯 빨라짐
      if (t >= 1) {
        show(flip.n);
        leaf.visible = false;
        flip = null;
      }
    }
  };
}
export function makeScoreboard() {
  const g = new THREE.Group();
  // 심판석 탁자
  const wood = new THREE.MeshStandardMaterial({ color: '#1d2433', roughness: 0.6 });
  const legM = metal('#3a404a', 0.4, 0.7);
  const deskTop = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.035, 0.46), wood);
  deskTop.position.y = 0.72;
  deskTop.castShadow = true;
  deskTop.receiveShadow = true;
  g.add(deskTop);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.32, 0.02), new THREE.MeshStandardMaterial({ map: skirtTex(), roughness: 0.6 }));
  for (const s of [-1, 1]) {
    const k = skirt.clone();
    k.position.set(0, 0.54, s * 0.22);
    if (s < 0) k.rotation.y = Math.PI;
    g.add(k);
    for (const t of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.7, 10), legM);
      leg.position.set(t * 0.27, 0.35, s * 0.19);
      g.add(leg);
    }
  }
  // 점수판 몸통
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#0d1426', roughness: 0.5, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.38, 0.06), bodyMat);
  body.position.y = 0.96;
  body.castShadow = true;
  g.add(body);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.03, 0.2), bodyMat);
  base.position.y = 0.752;
  g.add(base);
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), bodyMat);
  stand.position.y = 0.78;
  g.add(stand);
  // 위쪽 고리(넘김 축)
  const ringM = metal('#c9ced6', 0.25, 0.95);
  for (let i = 0; i < 6; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0025, 8, 16), ringM);
    r.position.set(-0.2 + i * 0.08, 1.15, 0);
    r.rotation.y = Math.PI / 2;
    g.add(r);
  }
  const faces = [];
  for (const s of [-1, 1]) {
    const face = new THREE.Group();
    face.position.set(0, 0.95, s * 0.031);
    if (s < 0) face.rotation.y = Math.PI;
    const cards = [];
    const labels = [];
    for (const x of [-0.12, 0.12]) {
      const card = flipCard(0.2, 0.26);
      card.group.position.set(x, -0.01, 0.002);
      face.add(card.group);
      cards.push(card);
      const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.044), new THREE.MeshStandardMaterial({ roughness: 0.5, emissive: '#ffffff', emissiveIntensity: 0.25 }));
      lab.position.set(x, 0.155, 0.003);
      face.add(lab);
      labels.push(lab);
    }
    g.add(face);
    faces.push({ cards, labels });
  }
  // faces[0] 은 −z(0번 자리 선수 쪽), faces[1] 은 +z(1번 자리 선수 쪽)
  let names = null;
  return {
    group: g,
    setNames(n0, c0, n1, c1) {
      const key = `${n0}${c0}${n1}${c1}`;
      if (names === key) return;
      names = key;
      const t0 = labelTex(n0, c0);
      const t1 = labelTex(n1, c1);
      const put = (m, t) => {
        if (m.material.map) m.material.map.dispose();
        m.material.map = t;
        m.material.emissiveMap = t;
        m.material.needsUpdate = true;
      };
      put(faces[0].labels[0], t0);
      put(faces[0].labels[1], t1);
      put(faces[1].labels[0], t1);
      put(faces[1].labels[1], t0);
    },
    setScore(s0, s1, animate) {
      faces[0].cards[0].set(s0, animate);
      faces[0].cards[1].set(s1, animate);
      faces[1].cards[0].set(s1, animate);
      faces[1].cards[1].set(s0, animate);
    },
    update(dt) {
      for (const f of faces) for (const c of f.cards) c.update(dt);
    }
  };
}
function skirtTex() {
  return tex(canvas(512, 256, (g, w, h) => {
    g.fillStyle = '#13204a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.font = `400 70px ${FONT_D}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('UMPIRE', w / 2, h / 2);
    stripes(g, w, h - 18, 10);
  }));
}
const PLAYER_COLORS = ['#ff5a5f', '#3ab4ff', '#ffc93c', '#5ee07a'];
function stripes(g, w, y, hgt) {
  const sw = w / 4;
  PLAYER_COLORS.forEach((c, i) => {
    g.fillStyle = c;
    g.fillRect(i * sw, y, sw, hgt);
  });
}

// ================================================================
// 경기장: 바닥, 코트, 펜스, 관중석, LED 띠, 천장 조명틀
// ================================================================
export function makeArena(tableXs) {
  const g = new THREE.Group();
  const cx = (tableXs[0] + tableXs[tableXs.length - 1]) / 2;
  const courtW = 5.9;
  const courtL = 12;
  // 홀 바닥(코트 바깥): 어두운 회청색
  const hallTex = tex(pixels(512, 512, (x, y, c) => {
    const n = fbm(x / 60, y / 60, 71, 4, 512 / 60, 512 / 60);
    const v = 26 + n * 18 + (hash2(x, y, 72) - 0.5) * 6;
    c[0] = v;
    c[1] = v + 3;
    c[2] = v + 9;
    c[3] = 255;
  }), true, true);
  hallTex.repeat.set(14, 10);
  const hall = new THREE.Mesh(new THREE.PlaneGeometry(70, 52), new THREE.MeshStandardMaterial({ map: hallTex, roughness: 0.75 }));
  hall.rotation.x = -Math.PI / 2;
  hall.position.set(cx, 0, 0);
  hall.receiveShadow = true;
  g.add(hall);
  // 코트: 적갈색 스포츠 바닥(고운 알갱이 무늬, 은은한 광택)
  const courtTex = tex(pixels(512, 512, (x, y, c) => {
    const n = fbm(x / 70, y / 70, 81, 4, 512 / 70, 512 / 70);
    const fleck = hash2(x, y, 82);
    let r = 112 + (n - 0.5) * 16;
    let gg = 38 + (n - 0.5) * 7;
    let b = 31 + (n - 0.5) * 5;
    if (fleck > 0.985) {
      r += 30;
      gg += 18;
      b += 14;
    } else if (fleck < 0.015) {
      r -= 30;
      gg -= 12;
      b -= 10;
    }
    c[0] = r;
    c[1] = gg;
    c[2] = b;
    c[3] = 255;
  }), true, true);
  courtTex.repeat.set(4, 8);
  const courtMat = new THREE.MeshPhysicalMaterial({ map: courtTex, roughness: 0.62, clearcoat: 0.3, clearcoatRoughness: 0.38 });
  for (const tx of tableXs) {
    const court = new THREE.Mesh(new THREE.PlaneGeometry(courtW, courtL), courtMat);
    court.rotation.x = -Math.PI / 2;
    court.position.set(tx, 0.002, 0);
    court.receiveShadow = true;
    g.add(court);
  }
  // 펜스: 남색 낮은 칸막이에 글자 인쇄
  const fenceTexA = fenceTex('PHONE CONTROLLER GAMES');
  const fenceTexB = fenceTex('TABLE TENNIS · 탁구');
  const fenceMats = [fenceTexA, fenceTexB].map((t) => new THREE.MeshStandardMaterial({ map: t, roughness: 0.55 }));
  const edgeM = new THREE.MeshStandardMaterial({ color: '#0e1838', roughness: 0.6 });
  const footM = metal('#20242b', 0.5, 0.5);
  const panelGeo = new THREE.BoxGeometry(1.98, 0.7, 0.025);
  let k = 0;
  const placed = new Set();
  const panel = (x, z, rotY) => {
    const key = `${x.toFixed(2)},${z.toFixed(2)}`;
    if (placed.has(key)) return;
    placed.add(key);
    const m = fenceMats[k++ % 2];
    const p = new THREE.Mesh(panelGeo, [edgeM, edgeM, edgeM, edgeM, m, m]);
    p.position.set(x, 0.37, z);
    p.rotation.y = rotY;
    p.castShadow = true;
    p.receiveShadow = true;
    g.add(p);
    for (const s of [-0.75, 0.75]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.34), footM);
      f.position.set(x + Math.cos(rotY) * s, 0.015, z - Math.sin(rotY) * s);
      f.rotation.y = rotY;
      g.add(f);
    }
  };
  for (const tx of tableXs) {
    for (let i = 0; i < 3; i++) {
      const x = tx - 2 + i * 2;
      panel(x, courtL / 2, 0);
      panel(x, -courtL / 2, Math.PI);
    }
    for (let i = 0; i < 6; i++) {
      const z = -5 + i * 2;
      panel(tx - courtW / 2 - 0.05, z, -Math.PI / 2);
      panel(tx + courtW / 2 + 0.05, z, Math.PI / 2);
    }
  }
  // 관중석: 계단식 단 + 의자 + 사람 실루엣(인스턴스)
  const standMat = new THREE.MeshStandardMaterial({ color: '#141a26', roughness: 0.9 });
  const seats = [];
  const xMin = tableXs[0] - 9;
  const xMax = tableXs[tableXs.length - 1] + 9;
  const tiers = 8;
  for (const sz of [-1, 1]) {
    for (let i = 0; i < tiers; i++) {
      const z = sz * (8.9 + i * 0.85);
      const h = 0.45 + i * 0.42;
      const step = new THREE.Mesh(new THREE.BoxGeometry(xMax - xMin, h, 0.86), standMat);
      step.position.set((xMin + xMax) / 2, h / 2, z);
      step.receiveShadow = true;
      g.add(step);
      for (let x = xMin + 0.4; x < xMax - 0.3; x += 0.56) seats.push({ x: x + (hash2(i, Math.round(x * 10), 5) - 0.5) * 0.04, y: h, z: z + sz * 0.1, rot: sz > 0 ? 0 : Math.PI });
    }
  }
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? xMin - 0.2 : xMax + 0.2;
    for (let i = 0; i < tiers - 2; i++) {
      const x = x0 + sx * i * 0.85;
      const h = 0.45 + i * 0.42;
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.86, h, 16.6), standMat);
      step.position.set(x, h / 2, 0);
      g.add(step);
      for (let z = -7.6; z < 7.7; z += 0.56) seats.push({ x: x + sx * 0.1, y: h, z, rot: sx > 0 ? Math.PI / 2 : -Math.PI / 2 });
    }
  }
  // 의자
  const seatGeo = mergeGeometries([
    new THREE.BoxGeometry(0.44, 0.06, 0.4).translate(0, 0.28, 0),
    new THREE.BoxGeometry(0.44, 0.42, 0.05).translate(0, 0.48, 0.2)
  ]);
  const seatMesh = new THREE.InstancedMesh(seatGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 }), seats.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const seatCols = ['#1d2f6a', '#22367a', '#5a1d26'].map((c) => new THREE.Color(c));
  seats.forEach((s, i) => {
    q.setFromAxisAngle(V(0, 1, 0), s.rot);
    m4.compose(V(s.x, s.y, s.z), q, one);
    seatMesh.setMatrixAt(i, m4);
    seatMesh.setColorAt(i, seatCols[Math.abs(Math.round(s.x * 3 + s.z)) % 7 === 0 ? 2 : i % 2]);
  });
  g.add(seatMesh);
  // 사람: 몸통(캡슐) + 머리
  const personGeo = mergeGeometries([
    new THREE.CapsuleGeometry(0.17, 0.36, 4, 10).scale(1, 1, 0.7).translate(0, 0.62, 0.02),
    new THREE.SphereGeometry(0.105, 12, 10).translate(0, 1.04, 0)
  ]);
  const people = seats.filter((s, i) => hash2(i, 3, 9) < 0.68);
  const crowd = new THREE.InstancedMesh(personGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }), people.length);
  const shirt = ['#2b3346', '#3a2c33', '#23303a', '#444a56', '#5b2930', '#1f3a5c', '#6b5a3a', '#9aa0a8', '#2e4a2e', '#a8443f', '#3a6fb0', '#b8954a'];
  const base = [];
  people.forEach((s, i) => {
    const h = hash2(i, 11, 13);
    const ci = h < 0.82 ? Math.floor(h * 8.5) % 7 : 7 + Math.floor((h - 0.82) * 27);
    const col = new THREE.Color(shirt[Math.min(shirt.length - 1, ci)]).multiplyScalar(0.32 + hash2(i, 2, 3) * 0.3);
    crowd.setColorAt(i, col);
    const sc = 0.9 + hash2(i, 5, 7) * 0.2;
    base.push({ x: s.x - Math.sin(s.rot) * 0.05, y: s.y + 0.02, z: s.z - Math.cos(s.rot) * 0.05, rot: s.rot + (hash2(i, 8, 1) - 0.5) * 0.5, sc, ph: hash2(i, 4, 4) * 6.28 });
  });
  const crowdUpdate = (t) => {
    base.forEach((b, i) => {
      const bob = Math.max(0, Math.sin(t * 1.3 + b.ph)) * 0.012;
      q.setFromAxisAngle(V(0, 1, 0), b.rot + Math.sin(t * 0.4 + b.ph) * 0.12);
      m4.compose(V(b.x, b.y + bob, b.z), q, V(b.sc, b.sc, b.sc));
      crowd.setMatrixAt(i, m4);
    });
    crowd.instanceMatrix.needsUpdate = true;
  };
  crowdUpdate(0);
  g.add(crowd);
  // 관중석 앞 LED 띠(빛나는 광고판)
  const ledTex = tex(canvas(2048, 128, (c, w, h) => {
    c.fillStyle = '#05070c';
    c.fillRect(0, 0, w, h);
    const items = [['PHONE CONTROLLER GAMES', '#ffffff'], ['TABLE TENNIS', '#3ab4ff'], ['탁구 · 1~4인', '#ffc93c'], ['SLOW · TIMING · SPIN', '#ff5a5f'], ['PCG ARENA', '#5ee07a']];
    c.textBaseline = 'middle';
    let x = 30;
    let i = 0;
    while (x < w) {
      const [t, col] = items[i++ % items.length];
      c.font = `400 76px ${FONT_D}`;
      c.fillStyle = col;
      c.fillText(t, x, h / 2 + 4);
      x += c.measureText(t).width + 70;
      c.fillStyle = 'rgba(255,255,255,.4)';
      c.fillRect(x - 42, h / 2 - 6, 12, 12);
    }
    // LED 점 격자
    c.fillStyle = 'rgba(0,0,0,.35)';
    for (let y = 0; y < h; y += 4) c.fillRect(0, y, w, 1);
    for (let xx = 0; xx < w; xx += 4) c.fillRect(xx, 0, 1, h);
  }), true, true);
  const ledMat = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: ledTex, emissiveIntensity: 1.35, roughness: 0.4 });
  for (const sz of [-1, 1]) {
    const len = xMax - xMin;
    const t = ledTex.clone();
    t.repeat.set(len / 9, 1);
    const mat = ledMat.clone();
    mat.emissiveMap = t;
    const led = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.62), mat);
    led.position.set((xMin + xMax) / 2, 0.36, sz * 8.44);
    led.rotation.y = sz > 0 ? Math.PI : 0;
    g.add(led);
  }
  // 벽과 천장
  const wallMat = new THREE.MeshStandardMaterial({ color: '#0a0f1a', roughness: 1, side: THREE.BackSide });
  // 상자 바닥 면이 홀 바닥(y = 0)과 겹치면 바닥을 덮고 깜박이므로(z-fighting) 바닥 아래로 20cm 내립니다.
  const walls = new THREE.Mesh(new THREE.BoxGeometry(72, 20.2, 54), wallMat);
  walls.position.set(cx, 9.9, 0);
  g.add(walls);
  // 위쪽 벽에 걸린 대형 현수막
  const banTex = bannerTex();
  const banMat = new THREE.MeshStandardMaterial({ map: banTex, roughness: 0.8, emissive: '#ffffff', emissiveMap: banTex, emissiveIntensity: 0.25 });
  for (const sz of [-1, 1]) {
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.6), banMat);
    ban.position.set(cx, 8.6, sz * 26.8);
    ban.rotation.y = sz > 0 ? Math.PI : 0;
    g.add(ban);
  }
  // 천장 조명틀(트러스)과 등기구
  const trussM = metal('#15181e', 0.6, 0.5);
  const lensM = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#fff6e8', emissiveIntensity: 3 });
  for (const tx of tableXs) {
    for (const sz of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.12, 0.12), trussM);
      bar.position.set(tx, 7.6, sz * 1.1);
      g.add(bar);
      for (const sx of [-1, 1]) {
        const can = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.42, 20, 1, true), trussM);
        can.position.set(tx + sx * 0.9, 7.36, sz * 1.1);
        g.add(can);
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24), lensM);
        lens.rotation.x = Math.PI / 2;
        lens.position.set(tx + sx * 0.9, 7.15, sz * 1.1);
        g.add(lens);
      }
    }
    // 빛기둥(아주 옅은 가산 원뿔)
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 3.2, 6.6, 40, 1, true), new THREE.MeshBasicMaterial({
      map: shaftTex(), transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: '#fff3dd'
    }));
    shaft.position.set(tx, 3.95, 0);
    g.add(shaft);
  }
  // 천장의 작은 조명 점들
  const dotGeo = new THREE.CircleGeometry(0.16, 12);
  const dotMat = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#cfe0ff', emissiveIntensity: 1.6 });
  const dots = new THREE.InstancedMesh(dotGeo, dotMat, 60);
  let di = 0;
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 6; j++) {
      q.setFromAxisAngle(V(1, 0, 0), Math.PI / 2);
      m4.compose(V(cx - 27 + i * 6, 15.5, -20 + j * 8), q, one);
      dots.setMatrixAt(di++, m4);
    }
  }
  g.add(dots);
  return { group: g, update: crowdUpdate, courtW, courtL };
}
function fenceTex(text) {
  return tex(canvas(1024, 362, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#1a2a5e');
    gr.addColorStop(1, '#101b42');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 120;
    g.font = `400 ${size}px ${FONT_D}`;
    while (g.measureText(text).width > w * 0.86 && size > 40) {
      size -= 4;
      g.font = `400 ${size}px ${FONT_D}`;
    }
    g.fillText(text, w / 2, h / 2 + 6);
    stripes(g, w, h - 22, 12);
    g.fillStyle = 'rgba(255,255,255,.12)';
    g.fillRect(0, 10, w, 3);
  }));
}
function bannerTex() {
  return tex(canvas(1400, 260, (g, w, h) => {
    g.fillStyle = '#0f1b40';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `400 150px ${FONT_D}`;
    g.fillText('PCG TABLE TENNIS OPEN', w / 2, h / 2 + 8);
    stripes(g, w, h - 20, 12);
  }));
}
let _shaft = null;
function shaftTex() {
  if (_shaft) return _shaft;
  _shaft = tex(canvas(16, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }));
  return _shaft;
}
