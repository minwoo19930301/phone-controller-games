// 퍼팅 챌린지 3D 장면: 맑은 하늘, 조각한 그린(잔디 줄무늬·프린지·벙커), 컵과 깃대, 퍼팅하는 골퍼, 공, 경사 보기.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FRINGE } from './greens.js';
import { BALL_R, CUP_R, CUP_DEPTH } from './physics.js';
import { createPuttingGolfer } from './rig.js';

const RD = Math.PI / 180;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Y = V(0, 1, 0);
const IN_HALF = 24; // 고해상도 바닥(그린 둘레) 반폭
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// ---------- 텍스처 ----------
function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}
function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 부드러운 값 노이즈(얼룩 무늬용)
function vnoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi + seed, yi);
  const b = hash(xi + 1 + seed, yi);
  const c = hash(xi + seed, yi + 1);
  const d = hash(xi + 1 + seed, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const glowTex = tex(canvas(128, 128, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.3, 'rgba(255,255,255,.45)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, w, h);
}));
const blobTex = tex(canvas(128, 128, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, 'rgba(0,0,0,.55)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, w, h);
}));
const cloudTex = tex(canvas(512, 256, (g, w, h) => {
  for (let i = 0; i < 28; i++) {
    const x = w * (0.16 + Math.random() * 0.68);
    const y = h * (0.42 + Math.random() * 0.28);
    const r = 36 + Math.random() * 72;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }
}));
// 잔디 결(가까이서 보이는 잔결). 범프로만 씁니다.
const grainTex = (() => {
  const t = tex(canvas(512, 512, (g, w, h) => {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, w, h);
    const r = rng(7);
    for (let i = 0; i < 9000; i++) {
      const x = r() * w;
      const y = r() * h;
      const l = 3 + r() * 6;
      const a = -Math.PI / 2 + (r() - 0.5) * 0.9;
      const v = Math.floor(70 + r() * 120);
      g.strokeStyle = `rgb(${v},${v},${v})`;
      g.lineWidth = 1 + r() * 0.8;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
  }), false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();
// 바깥 러프(멀리 반복해서 까는 무늬)
const roughTile = (() => {
  const t = tex(canvas(512, 512, (g, w, h) => {
    const img = g.createImageData(w, h);
    const d = img.data;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const n = hash(i, j) - 0.5;
        const m = vnoise(i / 48, j / 48, 3) - 0.5;
        const k = (j * w + i) * 4;
        d[k] = 66 + n * 22 + m * 16;
        d[k + 1] = 110 + n * 22 + m * 18;
        d[k + 2] = 43 + n * 12 + m * 8;
        d[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();
const dimpleTex = tex(canvas(256, 128, (g, w, h) => {
  g.fillStyle = '#808080';
  g.fillRect(0, 0, w, h);
  for (let y = 4; y < h; y += 8) {
    for (let x = (y / 8) % 2 ? 4 : 8; x < w; x += 8) {
      const gr = g.createRadialGradient(x, y, 0, x, y, 3.6);
      gr.addColorStop(0, '#404040');
      gr.addColorStop(1, '#808080');
      g.fillStyle = gr;
      g.fillRect(x - 4, y - 4, 8, 8);
    }
  }
}), false);
const ballTexCache = new Map();
// 공: 하얀 공에 플레이어 색 정렬선(퍼팅 라인 맞추기용)과 작은 글자
function ballTex(color) {
  if (ballTexCache.has(color)) return ballTexCache.get(color);
  const t = tex(canvas(512, 256, (g, w, h) => {
    g.fillStyle = '#fbfbf8';
    g.fillRect(0, 0, w, h);
    g.fillStyle = color;
    g.fillRect(0, h / 2 - 5, w, 10);
    g.fillStyle = '#20242c';
    g.font = '800 26px "Pretendard Variable", sans-serif';
    g.textAlign = 'center';
    g.fillText('PCG', w * 0.25, h / 2 - 18);
    g.fillText('PCG', w * 0.75, h / 2 + 38);
  }));
  ballTexCache.set(color, t);
  return t;
}
function flagTex(n) {
  return tex(canvas(256, 180, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#f2453c');
    gr.addColorStop(1, '#c92b2b');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(w * 0.52, h * 0.5, 56, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#c92b2b';
    g.font = '400 92px Anton, Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), w * 0.52, h * 0.53);
  }));
}
const cupWallTex = tex(canvas(16, 256, (g, w, h) => {
  // 위에서부터: 흙 2.5cm, 흰 컵 라이너, 바닥으로 갈수록 어둡게
  const soil = Math.round(h * 0.25);
  const gr = g.createLinearGradient(0, 0, 0, soil);
  gr.addColorStop(0, '#5d4630');
  gr.addColorStop(1, '#3b2c1f');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, soil);
  const g2 = g.createLinearGradient(0, soil, 0, h);
  g2.addColorStop(0, '#d9dbd8');
  g2.addColorStop(0.5, '#8d908e');
  g2.addColorStop(1, '#333534');
  g.fillStyle = g2;
  g.fillRect(0, soil, w, h - soil);
  g.fillStyle = 'rgba(0,0,0,.35)';
  g.fillRect(0, soil, w, 2);
}));

const std = (color, roughness = 0.6, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });

// ---------- 컵 자리 오려내기 / 등고선 ----------
// 바닥과 경사 보기 면에서 컵 원 안쪽 조각을 버려 진짜 구멍처럼 보이게 합니다.
const cupUniform = { value: new THREE.Vector3(0, 0, CUP_R) };
function patch(mat, contour) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uCup = cupUniform;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCutW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    let fs = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutW;\nuniform vec3 uCup;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (distance(vCutW.xz, uCup.xy) < uCup.z) discard;');
    if (contour) {
      // 높이 2.5cm 마다 흰 등고선
      fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
        float hq = vCutW.y / 0.025;
        float fw = max(fwidth(hq), 1e-4);
        float ln = clamp(1.0 - abs(fract(hq + 0.5) - 0.5) / (fw * 1.1), 0.0, 1.0);
        float m = clamp(diffuseColor.a / 0.34, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), ln * 0.7 * m);
        diffuseColor.a = max(diffuseColor.a, ln * 0.55 * m);`);
    }
    sh.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => (contour ? 'cut-contour' : 'cut');
  return mat;
}

// ---------- 바닥 그림 ----------
function paintGround(hole, trees, sunDir) {
  const N = 2048;
  const c = document.createElement('canvas');
  c.width = N;
  c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  const d = img.data;
  const cx = hole.center.x;
  const cz = hole.center.z;
  const sx = (2 * IN_HALF) / N;
  const gv = hole.greenValue;
  const gR2 = (hole.greenR * 1.9) ** 2;
  const bunkers = hole.bunkerInfo.map((b, i) => ({ ...b, f: hole.bunkerFns[i], r2: (Math.max(b.rx, b.rz) * 1.5) ** 2 }));
  // 깎은 줄무늬 방향: 퍼팅 라인과 비스듬히(주 방향) + 엇갈려 깎은 옅은 줄
  const a1 = hole.axis + 35 * RD;
  const a2 = hole.axis - 55 * RD;
  const s1 = [Math.cos(a1), -Math.sin(a1)];
  const s2 = [Math.cos(a2), -Math.sin(a2)];
  for (let j = 0; j < N; j++) {
    const z = cz + IN_HALF - (j + 0.5) * sx;
    for (let i = 0; i < N; i++) {
      const x = cx - IN_HALF + (i + 0.5) * sx;
      const k = (j * N + i) * 4;
      const n = hash(i, j) - 0.5;
      const dx = x - cx;
      const dz = z - cz;
      let r;
      let gg;
      let b;
      let bunk = 9;
      for (const bk of bunkers) {
        const ex = x - bk.x;
        const ez = z - bk.z;
        if (ex * ex + ez * ez < bk.r2) bunk = Math.min(bunk, bk.f(x, z));
      }
      const v = dx * dx + dz * dz < gR2 ? gv(x, z) : 9;
      if (bunk < 1) {
        // 모래: 잔물결 갈퀴 자국 + 가장자리 그늘
        const rake = Math.sin((x * 0.9 + z * 0.4) * 9 + Math.sin(z * 2.1) * 1.4) * 4;
        const lip = 1 - Math.min(1, (1 - bunk) / 0.12);
        r = 226 + n * 18 + rake - lip * 46;
        gg = 207 + n * 16 + rake - lip * 50;
        b = 158 + n * 14 + rake * 0.6 - lip * 48;
      } else if (v < 1) {
        // 그린: 비스듬한 깎은 줄 + 엇갈린 옅은 줄 + 잔결
        const p1 = (x * s1[0] + z * s1[1]) / 0.95;
        const p2 = (x * s2[0] + z * s2[1]) / 0.95;
        const st = (Math.floor(p1) & 1 ? 6 : -6) + (Math.floor(p2) & 1 ? 2.2 : -2.2);
        const m = (vnoise(x * 0.6, z * 0.6, 11) - 0.5) * 6;
        r = 104 + st + n * 7 + m;
        gg = 178 + st * 1.25 + n * 8 + m;
        b = 78 + st * 0.6 + n * 5 + m * 0.5;
        // 그린 가장자리 깎은 선(살짝 밝게)
        if (v > 0.985) {
          r += 6;
          gg += 8;
        }
      } else if (v < FRINGE) {
        // 프린지(칼라): 그린 둘레를 따라 도는 줄
        const ring = Math.floor((v - 1) / 0.04) & 1 ? 4 : -4;
        r = 88 + ring + n * 10;
        gg = 156 + ring * 1.2 + n * 10;
        b = 62 + ring * 0.5 + n * 6;
      } else {
        // 러프: 큰 얼룩 + 잔 노이즈. 벙커 턱은 짙게
        const m = (vnoise(x * 0.18, z * 0.18, 5) - 0.5) * 18 + (vnoise(x * 0.9, z * 0.9, 9) - 0.5) * 8;
        const near = v < 9 ? Math.max(0, 1 - (v - FRINGE) / 0.5) : 0; // 프린지 바로 바깥은 조금 밝게(짧게 깎음)
        r = 68 + n * 24 + m + near * 10;
        gg = 112 + n * 24 + m + near * 18;
        b = 44 + n * 13 + m * 0.5 + near * 5;
        if (bunk < 1.12) {
          const t = 1 - (bunk - 1) / 0.12;
          r -= t * 16;
          gg -= t * 20;
          b -= t * 8;
        }
      }
      d[k] = r;
      d[k + 1] = gg;
      d[k + 2] = b;
      d[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // 나무 그림자: 해 반대쪽으로 비켜 난 부드러운 타원
  const toPx = (x, z) => [((x - (cx - IN_HALF)) / (2 * IN_HALF)) * N, ((cz + IN_HALF - z) / (2 * IN_HALF)) * N];
  g.globalCompositeOperation = 'multiply';
  for (const t of trees) {
    const len = (t.pine ? 9 : 7) * t.s;
    const ox = (-sunDir.x / Math.max(0.3, sunDir.y)) * len * 0.5;
    const oz = (-sunDir.z / Math.max(0.3, sunDir.y)) * len * 0.5;
    const [px, pz] = toPx(t.x + ox, t.z + oz);
    if (px < -200 || pz < -200 || px > N + 200 || pz > N + 200) continue;
    const r = ((t.pine ? 2.6 : 3.6) * t.s) / sx;
    const gr = g.createRadialGradient(px, pz, 0, px, pz, r * 1.6);
    gr.addColorStop(0, 'rgba(60,80,60,0.65)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(px, pz, r * 1.6, r * 1.3, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  const t = tex(c);
  t.generateMipmaps = true;
  return t;
}

// 나무 자리(홀마다 씨앗이 달라 모양이 바뀝니다)
function treeSpots(hole) {
  const r = rng(hole.seed * 97 + 5);
  const out = [];
  const cx = hole.center.x;
  const cz = hole.center.z;
  for (let i = 0; i < 4000 && out.length < 360; i++) {
    const a = r() * Math.PI * 2;
    const d = 24 + Math.pow(r(), 0.8) * 60;
    const x = cx + Math.sin(a) * d;
    const z = cz + Math.cos(a) * d;
    // 출발점 뒤쪽 카메라 길목은 조금 비웁니다
    const bx = x - hole.start.x;
    const bz = z - hole.start.z;
    const back = -(bx * Math.sin(hole.axis) + bz * Math.cos(hole.axis));
    const side = Math.abs(bx * Math.cos(hole.axis) - bz * Math.sin(hole.axis));
    if (back > 0 && side < 9 && back < 40) continue;
    if (hole.greenValue(x, z) < 2.4) continue;
    out.push({ x, z, y: hole.height(x, z), pine: r() < 0.42, s: 0.85 + r() * 0.65, rot: r() * Math.PI * 2, tint: r() });
  }
  return out;
}

// 잔디 포기(러프 가까이에서 낮은 카메라에 보이는 풀잎)
function tuftGeometry() {
  const pos = [];
  const col = [];
  const blades = 6;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + i * 0.7;
    const lean = 0.25 + (i % 3) * 0.12;
    const h = 0.07 + (i % 4) * 0.022;
    const w = 0.008;
    const ox = Math.cos(a) * 0.012;
    const oz = Math.sin(a) * 0.012;
    const tx = ox + Math.cos(a) * lean * h;
    const tz = oz + Math.sin(a) * lean * h;
    const px = -Math.sin(a) * w;
    const pz = Math.cos(a) * w;
    pos.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, tx, h, tz);
    col.push(0.45, 0.55, 0.45, 0.45, 0.55, 0.45, 1.15, 1.2, 1.05);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// 경사 보기 화살표(꺾쇠)
function chevronGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.075, -0.025);
  s.lineTo(0, 0.05);
  s.lineTo(0.075, -0.025);
  s.lineTo(0.075, -0.06);
  s.lineTo(0, 0.015);
  s.lineTo(-0.075, -0.06);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(Math.PI / 2); // 모양의 위(+y) → +z
  return g;
}

function heatColor(pct, out) {
  const stops = [
    [0, 0.15, 0.4, 1.0],
    [1, 0.1, 0.78, 0.95],
    [2, 0.3, 0.92, 0.35],
    [3, 1.0, 0.86, 0.15],
    [4.5, 1.0, 0.32, 0.15]
  ];
  if (pct <= 0) return out.setRGB(stops[0][1], stops[0][2], stops[0][3]);
  for (let i = 1; i < stops.length; i++) {
    if (pct <= stops[i][0]) {
      const a = stops[i - 1];
      const b = stops[i];
      const t = (pct - a[0]) / (b[0] - a[0]);
      return out.setRGB(a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t);
    }
  }
  const l = stops[stops.length - 1];
  return out.setRGB(l[1], l[2], l[3]);
}

// ---------- 소품 ----------
function makeRake() {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.5, 10), std('#e8c35a', 0.45));
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0.75, 0.016, 0);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.035, 0.52), std('#1d1f22', 0.6));
  head.position.set(0, 0.02, 0);
  g.add(handle, head);
  const tine = new THREE.CylinderGeometry(0.004, 0.003, 0.05, 6);
  const tines = [];
  for (let i = 0; i < 16; i++) {
    const t = tine.clone();
    t.rotateZ(Math.PI / 2 + 0.3);
    t.translate(-0.03, 0.012, -0.24 + i * 0.032);
    tines.push(t);
  }
  const tm = new THREE.Mesh(mergeGeometries(tines), std('#1d1f22', 0.6));
  g.add(tm);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function makeBag(color) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const bagTex = tex(canvas(256, 256, (c, w, h) => {
    c.fillStyle = '#f3f1ea';
    c.fillRect(0, 0, w, h);
    c.fillStyle = color;
    c.fillRect(0, h * 0.18, w, h * 0.16);
    c.fillRect(0, h * 0.72, w, h * 0.06);
    c.fillStyle = '#1f232b';
    c.fillRect(0, h * 0.34, w, h * 0.03);
    c.font = '400 40px Anton, Impact, sans-serif';
    c.textAlign = 'center';
    c.fillText('PCG', w * 0.25, h * 0.58);
  }));
  const prof = [[0, 0], [0.11, 0], [0.125, 0.03], [0.12, 0.6], [0.13, 0.78], [0.14, 0.84], [0.12, 0.86]].map(([r, y]) => new THREE.Vector2(r, y));
  const shell = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), new THREE.MeshStandardMaterial({ map: bagTex, roughness: 0.6 }));
  shell.castShadow = true;
  body.add(shell);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.018, 10, 28).rotateX(Math.PI / 2), std('#1f232b', 0.5));
  collar.position.y = 0.85;
  body.add(collar);
  const pocket = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12).scale(0.09, 0.2, 0.05), std(color, 0.55));
  pocket.position.set(0, 0.42, 0.12);
  body.add(pocket);
  // 헤드커버 씌운 우드 셋과 아이언 몇 자루
  const coverMat = std(color, 0.7);
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1;
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.25, 8), std('#2a2d33', 0.4));
    sh.position.set(Math.cos(a) * 0.06, 0.95, Math.sin(a) * 0.06);
    const cover = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12).scale(1, 0.8, 1.2), coverMat);
    cover.position.set(Math.cos(a) * 0.06, 1.1, Math.sin(a) * 0.06);
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), std('#ffffff', 0.9));
    pom.position.set(Math.cos(a) * 0.06, 1.15, Math.sin(a) * 0.06);
    body.add(sh, cover, pom);
  }
  const chrome = new THREE.MeshStandardMaterial({ color: '#d8dbe0', metalness: 1, roughness: 0.2 });
  for (let i = 0; i < 4; i++) {
    const a = 0.6 + i * 0.5;
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.3, 8), chrome);
    sh.position.set(-Math.cos(a) * 0.07, 0.97, -Math.sin(a) * 0.05);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.03, 0.012), chrome);
    head.position.set(-Math.cos(a) * 0.07 + 0.02, 1.12, -Math.sin(a) * 0.05);
    head.rotation.z = 0.3;
    body.add(sh, head);
  }
  body.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  // 받침 다리 두 개
  const legMat = std('#1f232b', 0.5);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.82, 8), legMat);
    leg.position.set(s * 0.09, 0.4, -0.2);
    leg.rotation.x = 0.42;
    leg.rotation.z = s * 0.1;
    leg.castShadow = true;
    g.add(leg);
  }
  body.rotation.x = 0.32; // 다리에 기대어 뒤로 기울어진 모습
  return g;
}

// ================================================================
export function createScene(cv) {
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.6;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#bcd2e4', 140, 1100);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.03, 6000);

  // 하늘과 해(뒤 왼쪽 위에서 비춰 그림자가 홀 쪽으로 비스듬히 떨어집니다)
  const sun = V().setFromSphericalCoords(1, (90 - 38) * RD, 145 * RD);
  const sky = new Sky();
  sky.scale.setScalar(5000);
  const su = sky.material.uniforms;
  su.turbidity.value = 4.5;
  su.rayleigh.value = 1.3;
  su.mieCoefficient.value = 0.004;
  su.mieDirectionalG.value = 0.82;
  su.sunPosition.value.copy(sun);
  scene.add(sky);
  {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const sky2 = new Sky();
    sky2.scale.setScalar(5000);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) sky2.material.uniforms[k].value = su[k].value;
    sky2.material.uniforms.sunPosition.value.copy(sun);
    envScene.add(sky2);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(4000, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#3f6b33' }));
    ground.position.y = -5;
    envScene.add(ground);
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    scene.environmentIntensity = 0.7;
  }
  const hemi = new THREE.HemisphereLight('#d8ecff', '#4d6b35', 0.85);
  scene.add(hemi);
  const sunLight = new THREE.DirectionalLight('#fff0d4', 3.1);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.bias = -0.00025;
  sunLight.shadow.normalBias = 0.008;
  scene.add(sunLight, sunLight.target);
  const shadowAt = V();
  let shadowR = 0;
  function shadowFocus(x, y, z, r) {
    // 그림자 상자를 지금 보는 곳 둘레만 덮게 해서 공 그림자까지 또렷하게 둡니다.
    if (shadowAt.distanceToSquared(V(x, y, z)) < 0.0004 && Math.abs(r - shadowR) < 0.05) return;
    shadowAt.set(x, y, z);
    shadowR = r;
    sunLight.target.position.set(x, y, z);
    sunLight.position.copy(sun).multiplyScalar(60).add(sunLight.target.position);
    const c = sunLight.shadow.camera;
    c.left = -r;
    c.right = r;
    c.top = r;
    c.bottom = -r;
    c.near = 1;
    c.far = 140;
    c.updateProjectionMatrix();
  }

  // 구름
  for (let i = 0; i < 16; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.7 + Math.random() * 0.25, depthWrite: false, fog: false }));
    const a = Math.random() * Math.PI * 2;
    const r = 900 + Math.random() * 900;
    s.position.set(Math.sin(a) * r, 200 + Math.random() * 260, Math.cos(a) * r);
    const w = 500 + Math.random() * 700;
    s.scale.set(w, w * 0.45, 1);
    scene.add(s);
  }
  // 먼 산
  {
    const mats = [std('#7393a4', 1, { flatShading: true }), std('#809dab', 1, { flatShading: true }), std('#62849a', 1, { flatShading: true })];
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
      const r = 800 + Math.random() * 500;
      const geo = new THREE.ConeGeometry(150 + Math.random() * 220, 80 + Math.random() * 160, 7, 3);
      const pos = geo.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        if (pos.getY(k) > -geo.parameters.height / 2 + 1) pos.setX(k, pos.getX(k) * (0.85 + Math.random() * 0.3));
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mats[i % 3]);
      m.position.set(Math.sin(a) * r, geo.parameters.height / 2 - 12, Math.cos(a) * r);
      scene.add(m);
    }
  }

  // 홀마다 다시 만드는 것들
  const holeGroup = new THREE.Group();
  scene.add(holeGroup);
  const disposeList = [];
  let hole = null;

  // 컵
  const cupGroup = new THREE.Group();
  scene.add(cupGroup);
  // 깃대
  const flag = new THREE.Group();
  scene.add(flag);
  const flagCloth = new THREE.PlaneGeometry(0.5, 0.36, 16, 8).translate(0.25, 0, 0);
  const flagBase = flagCloth.attributes.position.array.slice();
  const flagMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75, side: THREE.DoubleSide });
  {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 2.13, 12), new THREE.MeshPhysicalMaterial({ color: '#f7f4ea', roughness: 0.25, clearcoat: 0.6 }));
    pole.position.y = 2.13 / 2;
    pole.castShadow = true;
    const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.0065, 0.07, 12), new THREE.MeshStandardMaterial({ color: '#c9ccd1', metalness: 1, roughness: 0.3 }));
    ferrule.position.y = 0.035;
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 8), new THREE.MeshStandardMaterial({ color: '#f7f4ea', roughness: 0.3 }));
    top.position.y = 2.13;
    const cloth = new THREE.Mesh(flagCloth, flagMat);
    cloth.position.y = 1.92;
    cloth.castShadow = true;
    flag.add(pole, ferrule, top, cloth);
  }
  const flagState = { mode: 'in', t: 0, from: { p: V(), q: new THREE.Quaternion() }, inP: V(), outP: V(), outQ: new THREE.Quaternion(), wave: 1 };

  // 공
  const ballMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: ballTex('#ff5a5f'), roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.25, bumpMap: dimpleTex, bumpScale: 0.6 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 24), ballMat);
  ball.castShadow = true;
  scene.add(ball);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.setScalar(0.3);
  ball.add(halo);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.07).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 }));
  scene.add(contact);

  // 다른 사람 공 자리(볼 마커: 플레이어 색 동전 + 바닥 빛)
  const markers = new THREE.Group();
  scene.add(markers);
  const coinGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.002, 24);
  const ringGeo = new THREE.RingGeometry(0.05, 0.12, 32).rotateX(-Math.PI / 2);
  function setMarkers(list) {
    for (const m of markers.children) m.children.forEach((c) => c.material.dispose());
    markers.clear();
    for (const m of list) {
      const gp = new THREE.Group();
      const y = hole ? hole.heightAt(m.x, m.z) : 0;
      gp.position.set(m.x, y, m.z);
      const coin = new THREE.Mesh(coinGeo, new THREE.MeshStandardMaterial({ color: m.color, metalness: 0.6, roughness: 0.3 }));
      coin.position.y = 0.0015;
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: m.color, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
      ring.position.y = 0.004;
      gp.add(coin, ring);
      markers.add(gp);
    }
  }

  // 조준선(점선) + 홀 거리에 놓는 표적 고리
  const aimMat = new LineMaterial({ color: '#ffffff', linewidth: 3, transparent: true, opacity: 0.9, dashed: true, dashSize: 0.18, gapSize: 0.12, worldUnits: false, depthTest: true });
  const aimGeo = new LineGeometry();
  aimGeo.setPositions([0, 0, 0, 0, 0, 1]);
  const aimLine = new Line2(aimGeo, aimMat);
  aimLine.renderOrder = 3;
  scene.add(aimLine);
  // 조준선이 홀 거리에 닿는 자리: 가는 고리(홀을 정확히 겨누면 컵을 둘러쌉니다)
  const target = new THREE.Mesh(new THREE.RingGeometry(0.105, 0.118, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false }));
  target.renderOrder = 3;
  scene.add(target);
  let aimKey = '';
  function setAim(on, from, heading, dist) {
    aimLine.visible = on;
    target.visible = on;
    if (!on || !hole) return;
    const key = `${from.x.toFixed(3)},${from.z.toFixed(3)},${heading.toFixed(5)},${dist.toFixed(2)},${hole.id}`;
    if (key === aimKey) return;
    aimKey = key;
    const dx = Math.sin(heading);
    const dz = Math.cos(heading);
    const L = dist + 0.5;
    const pts = [];
    const n = Math.max(8, Math.ceil(L / 0.12));
    for (let i = 0; i <= n; i++) {
      const t = 0.06 + (i / n) * L;
      const x = from.x + dx * t;
      const z = from.z + dz * t;
      pts.push(x, hole.heightAt(x, z) + 0.008, z);
    }
    // three 는 그릴 개수 상한(_maxInstanceCount)을 처음 그릴 때 한 번만 정하고 dispose 때만 지웁니다.
    // 지우지 않으면 첫 조준선보다 긴 조준선이 그 길이에서 잘립니다.
    aimGeo.dispose();
    aimGeo.setPositions(pts);
    aimLine.computeLineDistances();
    const tx = from.x + dx * dist;
    const tz = from.z + dz * dist;
    target.position.set(tx, hole.heightAt(tx, tz) + 0.006, tz);
  }

  // 경사 보기: 경사 크기 색칠 + 등고선 + 내리막으로 흐르는 꺾쇠
  let heat = null;
  let chev = null;
  let chevData = [];
  let overlayAmt = 0;
  let overlayOn = false;
  const heatMat = patch(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), true);
  const chevMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });

  function buildOverlay() {
    const gcx = hole.center.x;
    const gcz = hole.center.z;
    const R = hole.greenR * 1.25;
    const step = 0.2;
    const n = Math.ceil((2 * R) / step);
    const geo = new THREE.PlaneGeometry(2 * R, 2 * R, n, n).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const cols = new Float32Array(pos.count * 4);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + gcx;
      const z = pos.getZ(i) + gcz;
      pos.setXYZ(i, x, hole.heightAt(x, z) + 0.004, z);
      const [gx, gz] = hole.gradAt(x, z);
      const pct = Math.hypot(gx, gz) * 100;
      heatColor(pct, c);
      const v = hole.greenValue(x, z);
      const a = 0.34 * (1 - Math.min(1, Math.max(0, (v - 0.97) / (FRINGE - 0.97))));
      cols.set([c.r, c.g, c.b, a], i * 4);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 4));
    // 전부 투명한 삼각형은 버립니다
    const idx = geo.index.array;
    const keep = [];
    for (let k = 0; k < idx.length; k += 3) {
      if (cols[idx[k] * 4 + 3] > 0 || cols[idx[k + 1] * 4 + 3] > 0 || cols[idx[k + 2] * 4 + 3] > 0) keep.push(idx[k], idx[k + 1], idx[k + 2]);
    }
    geo.setIndex(keep);
    heat = new THREE.Mesh(geo, heatMat);
    heat.renderOrder = 2;
    holeGroup.add(heat);
    disposeList.push(geo);

    // 꺾쇠: 0.75m 간격, 그린 안쪽만
    chevData = [];
    const sp = 0.75;
    const r0 = rng(hole.seed);
    for (let x = gcx - R; x <= gcx + R; x += sp) {
      for (let z = gcz - R; z <= gcz + R; z += sp) {
        const jx = x + (r0() - 0.5) * 0.12;
        const jz = z + (r0() - 0.5) * 0.12;
        if (hole.greenValue(jx, jz) > 0.96) continue;
        if (Math.hypot(jx - hole.cup.x, jz - hole.cup.z) < 0.25) continue;
        const [gx, gz] = hole.gradAt(jx, jz);
        const s = Math.hypot(gx, gz);
        chevData.push({ x: jx, z: jz, dx: -gx / (s || 1), dz: -gz / (s || 1), pct: s * 100, ph: r0() });
      }
    }
    chev = new THREE.InstancedMesh(chevronGeometry(), chevMat, chevData.length);
    chev.renderOrder = 4;
    chev.frustumCulled = false;
    holeGroup.add(chev);
    disposeList.push(chev.geometry);
  }
  const o3 = new THREE.Object3D();
  const cTmp = new THREE.Color();
  const WHITE = new THREE.Color(1, 1, 1);
  function updateOverlay(now, dt) {
    overlayAmt += ((overlayOn ? 1 : 0) - overlayAmt) * (1 - Math.exp(-dt * 7));
    const vis = overlayAmt > 0.01;
    if (heat) {
      heat.visible = vis;
      heatMat.opacity = overlayAmt;
    }
    if (!chev) return;
    chev.visible = vis;
    if (!vis) return;
    const t = now / 1000;
    for (let i = 0; i < chevData.length; i++) {
      const d = chevData[i];
      const speed = 0.25 + Math.min(4, d.pct) * 0.12;
      const ph = (t * speed + d.ph) % 1;
      const off = (ph - 0.5) * 0.55;
      const x = d.x + d.dx * off;
      const z = d.z + d.dz * off;
      o3.position.set(x, hole.heightAt(x, z) + 0.012, z);
      o3.rotation.set(0, Math.atan2(d.dx, d.dz), 0);
      const sc = 0.75 + Math.min(1, d.pct / 3) * 0.6;
      o3.scale.set(sc, 1, sc);
      o3.updateMatrix();
      chev.setMatrixAt(i, o3.matrix);
      const b = Math.sin(Math.PI * ph) * (0.18 + 0.82 * Math.min(1, d.pct / 2.5)) * overlayAmt;
      heatColor(d.pct, cTmp).lerp(WHITE, 0.55).multiplyScalar(b);
      chev.setColorAt(i, cTmp);
    }
    chev.instanceMatrix.needsUpdate = true;
    if (chev.instanceColor) chev.instanceColor.needsUpdate = true;
  }

  // 퍼팅하는 골퍼(플레이어 색마다 하나씩 만들어 둡니다)
  const stance = new THREE.Group();
  scene.add(stance);
  const rigs = new Map();
  let rig = null;
  function setGolfer(color) {
    if (!rigs.has(color)) {
      const r = createPuttingGolfer(color);
      rigs.set(color, r);
      stance.add(r.root);
    }
    for (const [c, r] of rigs) r.root.visible = c === color;
    rig = rigs.get(color);
    ballMat.map = ballTex(color);
    ballMat.needsUpdate = true;
  }
  function placeGolfer(x, z, heading) {
    stance.position.set(x, hole ? hole.heightAt(x, z) : 0, z);
    stance.rotation.y = heading - Math.PI / 2;
  }
  function setGolferVisible(on) {
    stance.visible = on;
  }
  function golferPose(theta, face, head, lookUp) {
    if (rig) rig.pose(theta, face, head, lookUp);
  }

  // 공 방향(정렬선을 퍼팅 라인에 맞춤)과 구르기
  const qTmp = new THREE.Quaternion();
  function orientBall(heading) {
    const n = V(Math.cos(heading), 0, -Math.sin(heading));
    ball.quaternion.setFromUnitVectors(Y, n);
  }
  function rollBall(dx, dz) {
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) return;
    const axis = V(dz, 0, -dx).normalize(); // 위 × 진행 방향
    qTmp.setFromAxisAngle(axis, d / BALL_R);
    ball.quaternion.premultiply(qTmp);
  }

  // ---------- 홀 만들기 ----------
  function setHole(h) {
    hole = h;
    for (const g of disposeList) g.dispose();
    disposeList.length = 0;
    holeGroup.traverse((o) => {
      if (o.material && o.material !== heatMat && o.material !== chevMat) {
        if (o.material.map && o.material.map !== roughTile) o.material.map.dispose();
        o.material.dispose();
      }
    });
    holeGroup.clear();
    heat = null;
    chev = null;
    cupUniform.value.set(h.cup.x, h.cup.z, CUP_R);
    const gcx = h.center.x;
    const gcz = h.center.z;

    const trees = treeSpots(h);
    // 안쪽 바닥(그린 둘레 48m)
    {
      const groundTex = paintGround(h, trees, sun);
      const seg = 240;
      const geo = new THREE.PlaneGeometry(2 * IN_HALF, 2 * IN_HALF, seg, seg).rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const uv = geo.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) + gcx;
        const z = pos.getZ(i) + gcz;
        pos.setXYZ(i, x, h.heightAt(x, z), z);
        uv.setXY(i, (x - (gcx - IN_HALF)) / (2 * IN_HALF), (z - (gcz - IN_HALF)) / (2 * IN_HALF));
      }
      geo.computeVertexNormals();
      const grain = grainTex.clone();
      grain.repeat.set(2 * IN_HALF * 1.6, 2 * IN_HALF * 1.6);
      grain.needsUpdate = true;
      const mat = patch(new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.9, bumpMap: grain, bumpScale: 1.2 }), false);
      const ground = new THREE.Mesh(geo, mat);
      ground.receiveShadow = true;
      holeGroup.add(ground);
      disposeList.push(geo, grain);
    }
    // 바깥 땅(성긴 격자, 안쪽과 겹치는 칸은 버림)
    {
      const W = 420;
      const seg = 168;
      const geo = new THREE.PlaneGeometry(W, W, seg, seg).rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const uv = geo.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) + gcx;
        const z = pos.getZ(i) + gcz;
        const r = Math.hypot(x - gcx, z - gcz);
        pos.setXYZ(i, x, h.base(x, z) + Math.max(0, r - 90) * 0.12, z);
        uv.setXY(i, x / 7, z / 7);
      }
      const idx = geo.index.array;
      const keep = [];
      const lim = IN_HALF - 1.0;
      for (let k = 0; k < idx.length; k += 3) {
        let inside = true;
        for (let m = 0; m < 3; m++) {
          const x = pos.getX(idx[k + m]) - gcx;
          const z = pos.getZ(idx[k + m]) - gcz;
          if (Math.abs(x) > lim || Math.abs(z) > lim) inside = false;
        }
        if (!inside) keep.push(idx[k], idx[k + 1], idx[k + 2]);
      }
      geo.setIndex(keep);
      geo.computeVertexNormals();
      const outer = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: roughTile, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
      outer.receiveShadow = true;
      holeGroup.add(outer);
      disposeList.push(geo);
    }
    // 나무
    {
      const pineGeo = mergeGeometries([
        new THREE.ConeGeometry(2.6, 4.2, 9, 1).translate(0, 3.6, 0),
        new THREE.ConeGeometry(2.1, 3.6, 9, 1).translate(0, 5.6, 0),
        new THREE.ConeGeometry(1.5, 3.0, 9, 1).translate(0, 7.4, 0)
      ]);
      const leafGeo = new THREE.IcosahedronGeometry(3.2, 1);
      const lp = leafGeo.attributes.position;
      for (let i = 0; i < lp.count; i++) {
        const v = V(lp.getX(i), lp.getY(i), lp.getZ(i));
        const n = 1 + Math.sin(v.x * 2.1) * Math.cos(v.y * 1.7) * Math.sin(v.z * 2.3) * 0.18;
        lp.setXYZ(i, v.x * n, v.y * n * 0.85 + 5.6, v.z * n);
      }
      leafGeo.computeVertexNormals();
      const trunkGeo = new THREE.CylinderGeometry(0.18, 0.32, 3.4, 7).translate(0, 1.7, 0);
      const mk = (geo, mat, list, colorFn) => {
        const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
        m.count = list.length;
        const o = new THREE.Object3D();
        const c = new THREE.Color();
        list.forEach((t, i) => {
          o.position.set(t.x, t.y - 0.2, t.z);
          o.rotation.set(0, t.rot, 0);
          o.scale.setScalar(t.s);
          o.updateMatrix();
          m.setMatrixAt(i, o.matrix);
          if (colorFn) m.setColorAt(i, colorFn(t, c));
        });
        m.castShadow = true;
        m.receiveShadow = true;
        holeGroup.add(m);
        disposeList.push(geo);
      };
      const leafMat = std('#ffffff', 0.9, { flatShading: true });
      mk(pineGeo, leafMat, trees.filter((t) => t.pine), (t, c) => c.setHSL(0.33 + t.tint * 0.04, 0.5, 0.11 + t.tint * 0.06));
      mk(leafGeo, leafMat.clone(), trees.filter((t) => !t.pine), (t, c) => c.setHSL(0.24 + t.tint * 0.07, 0.55, 0.15 + t.tint * 0.08));
      mk(trunkGeo, std('#5a4030', 0.9), trees, null);
      // 지평선까지 이어지는 숲 띠
      const n = 1100;
      const far = new THREE.InstancedMesh(new THREE.ConeGeometry(4, 13, 7).translate(0, 6.5, 0), std('#ffffff', 0.95, { flatShading: true }), n);
      const o = new THREE.Object3D();
      const c = new THREE.Color();
      const r = rng(h.seed + 101);
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2;
        const d = 95 + Math.pow(r(), 0.7) * 260;
        const x = gcx + Math.sin(a) * d;
        const z = gcz + Math.cos(a) * d;
        o.position.set(x, h.base(x, z) + Math.max(0, d - 90) * 0.12 - 0.5, z);
        o.scale.setScalar(0.8 + r() * 1.1);
        o.rotation.y = r() * 6;
        o.updateMatrix();
        far.setMatrixAt(i, o.matrix);
        far.setColorAt(i, c.setHSL(0.3 + r() * 0.06, 0.45, 0.1 + r() * 0.07));
      }
      holeGroup.add(far);
      disposeList.push(far.geometry);
    }
    // 잔디 포기
    {
      const list = [];
      const r = rng(h.seed + 3);
      for (let i = 0; i < 40000 && list.length < 7000; i++) {
        const x = gcx + (r() - 0.5) * 2 * (IN_HALF - 1);
        const z = gcz + (r() - 0.5) * 2 * (IN_HALF - 1);
        const v = h.greenValue(x, z);
        if (v < FRINGE + 0.08 || v > 2.6) continue;
        if (h.surface(x, z) === 'bunker') continue;
        if (r() > 1.25 - (v - FRINGE) * 0.4) continue;
        list.push({ x, z, s: 0.7 + r() * 0.8, rot: r() * 6.28, tint: r() });
      }
      const m = new THREE.InstancedMesh(tuftGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, color: '#ffffff' }), list.length);
      const o = new THREE.Object3D();
      const c = new THREE.Color();
      list.forEach((t, i) => {
        o.position.set(t.x, h.heightAt(t.x, t.z) - 0.005, t.z);
        o.rotation.set(0, t.rot, 0);
        o.scale.set(t.s, t.s * (0.8 + t.tint * 0.5), t.s);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
        m.setColorAt(i, c.setRGB(0.28 + t.tint * 0.08, 0.46 + t.tint * 0.1, 0.18));
      });
      m.receiveShadow = true;
      holeGroup.add(m);
      disposeList.push(m.geometry);
    }
    // 벙커 갈퀴
    if (h.bunkerInfo.length) {
      const b = h.bunkerInfo[0];
      const rake = makeRake();
      const x = b.x + b.rx * 0.35;
      const z = b.z - b.rz * 0.2;
      rake.position.set(x, h.heightAt(x, z), z);
      rake.rotation.y = 0.6 + h.seed;
      holeGroup.add(rake);
    }
    // 골프 가방: 출발점 왼쪽 그린 밖
    {
      const lx = Math.cos(h.axis);
      const lz = -Math.sin(h.axis);
      let x = h.start.x;
      let z = h.start.z;
      for (let k = 0; k < 80 && h.greenValue(x, z) < 1.3; k++) {
        x += lx * 0.25;
        z += lz * 0.25;
      }
      x += Math.sin(h.axis) * 1.5;
      z += Math.cos(h.axis) * 1.5;
      bagSpot.set(x, h.heightAt(x, z), z);
      bagAngle = h.axis + 2.2;
      placeBag();
    }

    // 컵: 벽(평면에 맞춰 윗면을 기울임) + 흰 라이너 테 + 바닥
    cupGroup.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    cupGroup.clear();
    {
      const { px, pz } = h.cupPlane;
      const wall = new THREE.CylinderGeometry(CUP_R, CUP_R, CUP_DEPTH, 48, 1, true);
      const wp = wall.attributes.position;
      for (let i = 0; i < wp.count; i++) {
        if (wp.getY(i) > 0) wp.setY(i, CUP_DEPTH / 2 + px * wp.getX(i) + pz * wp.getZ(i) + 0.0005);
      }
      const wallM = new THREE.Mesh(wall, new THREE.MeshStandardMaterial({ map: cupWallTex, roughness: 0.8, side: THREE.BackSide }));
      wallM.position.y = -CUP_DEPTH / 2;
      const liner = new THREE.Mesh(new THREE.TorusGeometry(CUP_R - 0.0015, 0.0015, 6, 48).rotateX(Math.PI / 2), std('#f4f4f2', 0.4));
      liner.position.y = -0.025;
      const bottom = new THREE.Mesh(new THREE.CircleGeometry(CUP_R, 36).rotateX(-Math.PI / 2), std('#2b2c2b', 0.9));
      bottom.position.y = -CUP_DEPTH + 0.001;
      cupGroup.add(wallM, liner, bottom);
      cupGroup.position.set(h.cup.x, h.cupY, h.cup.z);
    }
    // 깃대: 꽂힌 자리와 뽑아서 눕혀 둘 자리(홀 옆 프린지)
    {
      flagMat.map?.dispose();
      flagMat.map = flagTex(h.id);
      flagMat.needsUpdate = true;
      flagState.inP.set(h.cup.x, h.cupY - CUP_DEPTH, h.cup.z);
      const sx = Math.cos(h.axis);
      const sz = -Math.sin(h.axis);
      const fx = Math.sin(h.axis);
      const fz = Math.cos(h.axis);
      let x = h.cup.x - fx * 1.0;
      let z = h.cup.z - fz * 1.0;
      for (let k = 0; k < 120 && h.greenValue(x, z) < 1.04; k++) {
        x -= sx * 0.2;
        z -= sz * 0.2;
      }
      x -= sx * 0.3;
      z -= sz * 0.3;
      // 눕힌 모습: 프린지를 따라 앞쪽으로 눕히고 땅 기울기에 맞춥니다. 깃발은 바깥쪽으로 납작하게.
      const y0 = h.heightAt(x, z) + 0.0068;
      const y1 = h.heightAt(x + fx * 2.1, z + fz * 2.1) + 0.0068;
      flagState.outP.set(x, y0, z);
      const py = V(fx * 2.1, y1 - y0, fz * 2.1).normalize();
      const px = new THREE.Vector3().crossVectors(py, Y).normalize();
      const pz = new THREE.Vector3().crossVectors(px, py);
      flagState.outQ.setFromRotationMatrix(new THREE.Matrix4().makeBasis(px, py, pz));
      replaceFlag(true);
    }
    buildOverlay();
    overlayAmt = overlayOn ? 1 : 0;
  }

  // 가방은 홀마다 위치만 바꿉니다(색은 지금 차례 사람)
  const bagSpot = V();
  let bagAngle = 0;
  let bag = null;
  const bags = new Map();
  function placeBag() {
    if (!bag) return;
    bag.position.copy(bagSpot);
    bag.rotation.y = bagAngle;
  }
  function setBagColor(color) {
    if (!bags.has(color)) {
      const b = makeBag(color);
      bags.set(color, b);
      scene.add(b);
    }
    for (const [c, b] of bags) b.visible = c === color;
    bag = bags.get(color);
    placeBag();
  }

  // ---------- 깃대 뽑기/꽂기 ----------
  function pullFlag() {
    if (flagState.mode === 'out' || flagState.mode === 'pulling') return false;
    flagState.mode = 'pulling';
    flagState.t = 0;
    flagState.from.p.copy(flag.position);
    flagState.from.q.copy(flag.quaternion);
    return true;
  }
  function replaceFlag(instant) {
    if (instant) {
      flagState.mode = 'in';
      flag.position.copy(flagState.inP);
      flag.quaternion.identity();
      flagState.wave = 1;
      return;
    }
    if (flagState.mode === 'in' || flagState.mode === 'replacing') return;
    flagState.mode = 'replacing';
    flagState.t = 0;
    flagState.from.p.copy(flag.position);
    flagState.from.q.copy(flag.quaternion);
  }
  const flagIsIn = () => flagState.mode === 'in' || flagState.mode === 'replacing';
  function updateFlag(now, dt) {
    const f = flagState;
    if (f.mode === 'pulling' || f.mode === 'replacing') {
      f.t += dt;
      const lift = V(0, 0.55, 0);
      const up = f.mode === 'pulling';
      const T1 = 0.45;
      const T2 = 1.0;
      if (up) {
        if (f.t < T1) {
          flag.position.lerpVectors(f.inP, f.inP.clone().add(lift), ease(f.t / T1));
        } else {
          const k = ease(Math.min(1, (f.t - T1) / T2));
          const a = f.inP.clone().add(lift);
          flag.position.lerpVectors(a, f.outP, k);
          flag.position.y += Math.sin(k * Math.PI) * 0.4;
          flag.quaternion.slerpQuaternions(f.from.q, f.outQ, k);
          f.wave = 1 - k;
          if (k >= 1) f.mode = 'out';
        }
      } else {
        const k = ease(Math.min(1, f.t / T2));
        if (f.t < T2) {
          flag.position.lerpVectors(f.from.p, f.inP.clone().add(lift), k);
          flag.position.y += Math.sin(k * Math.PI) * 0.4;
          flag.quaternion.slerpQuaternions(f.from.q, new THREE.Quaternion(), k);
          f.wave = k;
        } else {
          const k2 = ease(Math.min(1, (f.t - T2) / T1));
          flag.position.lerpVectors(f.inP.clone().add(lift), f.inP, k2);
          if (k2 >= 1) f.mode = 'in';
        }
      }
    }
    // 깃발 펄럭임
    const fp = flagCloth.attributes.position;
    const amp = f.wave;
    for (let i = 0; i < fp.count; i++) {
      const x = flagBase[i * 3];
      fp.setZ(i, Math.sin(now / 240 + x * 10) * 0.045 * x * 2.4 * amp);
      fp.setY(i, flagBase[i * 3 + 1] - x * x * 0.07 * amp);
    }
    fp.needsUpdate = true;
  }

  // ---------- 화면 효과 ----------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.4, 0.96);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    aimMat.resolution.set(w, h);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- 카메라 ----------
  const camPos = V(0, 12, -20);
  const camLook = V(0, 0, 6);
  const tPos = V();
  const tLook = V();
  let tFov = 42;
  let last = performance.now();

  function camTarget(c, now) {
    const gc = hole ? V(hole.center.x, hole.heightAt(hole.center.x, hole.center.z), hole.center.z) : V();
    let k = 2.5;
    if (c.mode === 'orbit') {
      const a = now / 17000 + (c.phase || 0);
      tPos.set(gc.x + Math.sin(a) * 20, gc.y + 7.5 + Math.sin(a * 0.7) * 1.5, gc.z + Math.cos(a) * 20);
      tLook.set(gc.x, gc.y + 0.3, gc.z);
      tFov = 42;
      k = 1.2;
    } else if (c.mode === 'overview') {
      const ax = hole ? hole.axis : 0;
      tPos.set(gc.x - Math.sin(ax) * 15 + Math.cos(ax) * 7, gc.y + 13, gc.z - Math.cos(ax) * 15 - Math.sin(ax) * 7);
      tLook.set(gc.x, gc.y, gc.z);
      tFov = 44;
      k = 1.4;
    } else if (c.mode === 'aim' || c.mode === 'stroke' || c.mode === 'intro') {
      const b = c.ball;
      const dx = Math.sin(c.heading);
      const dz = Math.cos(c.heading);
      const by = hole.heightAt(b.x, b.z);
      const dist = c.dist || 5;
      if (c.mode === 'stroke') {
        // TV 퍼팅 캠: 공 뒤 낮게
        tPos.set(b.x - dx * 2.15, by + 0.62, b.z - dz * 2.15);
        tLook.set(b.x + dx * 3.2, by + 0.05, b.z + dz * 3.2);
        tFov = 40;
        k = 2.2;
      } else {
        // 공 뒤에서 라인을 따라 홀을 봅니다. 골퍼(왼쪽)를 피해 살짝 오른쪽으로.
        const back = 3.7 + dist * 0.12;
        const up = 1.4 + dist * 0.065;
        tPos.set(b.x - dx * back - dz * 0.45, by + up, b.z - dz * back + dx * 0.45);
        const ahead = Math.min(dist * 0.62, 8);
        tLook.set(b.x + dx * ahead, by - 0.15, b.z + dz * ahead);
        tFov = 40;
        k = 2.6;
      }
      if (c.mode === 'intro') {
        // 홀 위 높은 곳에서 공 뒤로 내려오기
        const t = ease(clamp(c.t, 0, 1));
        const hx = hole.cup.x + Math.sin(hole.axis) * 6;
        const hz = hole.cup.z + Math.cos(hole.axis) * 6;
        const hi = V(hx + Math.cos(hole.axis) * 3, gc.y + 16, hz - Math.sin(hole.axis) * 3);
        tPos.lerpVectors(hi, tPos.clone(), t);
        tLook.lerpVectors(V(hole.cup.x, hole.cupY, hole.cup.z).lerp(V(b.x, by, b.z), 0.4), tLook.clone(), t);
        k = 10;
      }
    } else if (c.mode === 'track') {
      // 중계 카메라: 친 자리 뒤에 서서 굴러가는 공을 따라 돌리고 당겨 잡습니다.
      const f = c.from;
      const dx = Math.sin(c.heading);
      const dz = Math.cos(c.heading);
      const fy = hole.heightAt(f.x, f.z);
      tPos.set(f.x - dx * 2.3 - dz * 0.3, fy + 0.85, f.z - dz * 2.3 + dx * 0.3);
      tLook.set(c.ball.x, c.ball.y - 0.03, c.ball.z);
      tFov = clamp(44 - tPos.distanceTo(tLook) * 2.1, 16, 40);
      k = 5;
    } else if (c.mode === 'hole') {
      // 홀 옆 낮은 카메라: 공이 홀로 들어오는 모습
      const d = c.dir;
      const lx = d.z;
      const lz = -d.x;
      tPos.set(hole.cup.x + lx * 1.75 + d.x * 0.35, hole.cupY + 0.5, hole.cup.z + lz * 1.75 + d.z * 0.35);
      tLook.set(hole.cup.x - d.x * 0.7, hole.cupY - 0.02, hole.cup.z - d.z * 0.7);
      tFov = 40;
      k = 3;
    } else if (c.mode === 'cup') {
      const d = c.dir;
      tPos.set(hole.cup.x - d.x * 1.05 + d.z * 0.35, hole.cupY + 0.38, hole.cup.z - d.z * 1.05 - d.x * 0.35);
      tLook.set(hole.cup.x, hole.cupY - 0.01, hole.cup.z);
      tFov = 36;
      k = 1.8;
    }
    return k;
  }

  // ---------- 매 프레임 ----------
  // v: { cam, ball:{x,y,z}|null, halo, overlay, aim:{from,heading,dist}|null }
  function frame(now, v) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!hole) return;
    overlayOn = Boolean(v.overlay);
    updateOverlay(now, dt);
    updateFlag(now, dt);

    if (v.ball) {
      ball.visible = true;
      ball.position.set(v.ball.x, v.ball.y, v.ball.z);
      const gy = hole.heightAt(v.ball.x, v.ball.z);
      contact.visible = v.ball.y > gy - 0.01;
      contact.position.set(v.ball.x, gy + 0.002, v.ball.z);
    } else {
      ball.visible = false;
      contact.visible = false;
    }
    halo.material.opacity = v.halo ? Math.min(0.55, camera.position.distanceTo(ball.position) * 0.05) : 0;
    halo.scale.setScalar(0.06 + camera.position.distanceTo(ball.position) * 0.012);

    const k = camTarget(v.cam, now);
    if (v.cut) {
      camPos.copy(tPos);
      camLook.copy(tLook);
      camera.fov = tFov;
    }
    const e = 1 - Math.exp(-dt * k);
    camPos.lerp(tPos, e);
    camLook.lerp(tLook, e);
    camera.fov += (tFov - camera.fov) * e;
    camPos.y = Math.max(camPos.y, hole.heightAt(camPos.x, camPos.z) + 0.25);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    // 디버그: 콘솔에서 view.debugCam = { pos:[x,y,z], look:[x,y,z], fov } 로 카메라를 고정해 볼 수 있습니다.
    if (api.debugCam) {
      camera.position.fromArray(api.debugCam.pos);
      camera.lookAt(V(...api.debugCam.look));
      if (api.debugCam.fov) camera.fov = api.debugCam.fov;
    }
    camera.updateProjectionMatrix();

    // 그림자 상자: 공 둘레(가까운 장면) 또는 그린 전체
    const wide = v.cam.mode === 'orbit' || v.cam.mode === 'overview' || (v.cam.mode === 'intro' && v.cam.t < 0.6);
    if (wide) shadowFocus(hole.center.x, hole.cupY, hole.center.z, hole.greenR + 4);
    else {
      let f = stance.position;
      let r = 4.5;
      if (v.cam.mode === 'hole' || v.cam.mode === 'cup') {
        f = camLook;
        r = 4;
      } else if (v.cam.mode === 'track') {
        // 골퍼와 공이 함께 들어오게
        f = stance.position.clone().lerp(camLook, 0.5);
        r = Math.max(4.5, stance.position.distanceTo(camLook) / 2 + 3);
      }
      shadowFocus(Math.round(f.x * 4) / 4, f.y, Math.round(f.z * 4) / 4, Math.round(r));
    }
    composer.render();
  }

  function project(x, y, z) {
    const p = V(x, y, z).project(camera);
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight, on: p.z < 1 && p.z > -1 };
  }

  const api = {
    setHole, setGolfer, placeGolfer, setGolferVisible, golferPose, setBagColor,
    orientBall, rollBall, setMarkers, setAim, pullFlag, replaceFlag, flagIsIn,
    frame, project, camera, renderer,
    getHole: () => hole,
    debugCam: null
  };
  return api;
}
