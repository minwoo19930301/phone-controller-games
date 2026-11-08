// 홀 한 개를 three.js 장면으로 만듭니다: 하늘·해·안개, 지형(칠한 바닥 + 잔디 결), 물, 나무·소품(인스턴스),
// 깃발·컵, 티 마커·안내판, 거리 말뚝, OB 말뚝, 장식(등대·정자·산장·다리), 먼 경치.
// buildHole(hole, course, scene, quality) → { group, update(dt, camera), dispose(), sun, setShadowFocus, setPin, setTee, setWind, exposure, stats }
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { outline, drawMinimap, vnoise, fbm } from './core.js';
import { fieldCanvas, paintRect, detailCanvas, waterNormalCanvas, cloudCanvas, groundColor } from './paint.js';
import * as M from './models.js';

const RD = Math.PI / 180;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const QUALITY = {
  high: { step: 2, sub: 8, tex: 4096, inset: 1024, shadow: 2048, far: 2800, ring: 320, ringStep: 8, density: 1, env: true },
  medium: { step: 3.2, sub: 8, tex: 2048, inset: 1024, shadow: 2048, far: 2400, ring: 256, ringStep: 8, density: 0.7, env: true },
  low: { step: 4, sub: 8, tex: 2048, inset: 512, shadow: 1024, far: 2000, ring: 192, ringStep: 16, density: 0.45, env: false }
};

const FLAG_COLORS = { links: '#f6c61c', pines: '#e23b3b', canyon: '#ff7a1a', alpine: '#1f7ae0', blossom: '#ff4f93' };
const TEE_COLORS = { easy: '#e8433b', normal: '#f4f4f0', hard: '#2a63d8' };

function canvasTex(cv, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// ---------- 지형 ----------
// 굵은 격자 위에 그린·티·벙커 둘레만 촘촘한 조각을 얹습니다. 조각 테두리는 굵은 격자 모서리에 맞춰 틈이 없습니다.
function buildTerrainGeometry(hole, Q) {
  const B = hole.bounds;
  const MG = 72;
  const R = {
    x0: Math.floor((B.x0 - MG) / 32) * 32,
    x1: Math.ceil((B.x1 + MG) / 32) * 32,
    z0: Math.floor((B.z0 - MG) / 32) * 32,
    z1: Math.ceil((B.z1 + MG) / 32) * 32
  };
  const st = Q.step;
  const nx = Math.round((R.x1 - R.x0) / st) + 1;
  const nz = Math.round((R.z1 - R.z0) / st) + 1;
  const H = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) H[j * nx + i] = hole.heightRaw(R.x0 + i * st, R.z0 + j * st);
  // 바깥 테두리는 먼 지형(32m 격자)과 맞춰 직선으로 잇습니다
  const per = Math.round(32 / st);
  const lerpEdge = (get, set, n) => {
    for (let a = 0; a < n; a++) {
      if (a % per === 0) continue;
      const a0 = a - (a % per);
      const a1 = Math.min(n - 1, a0 + per);
      const t = (a - a0) / (a1 - a0);
      set(a, get(a0) * (1 - t) + get(a1) * t);
    }
  };
  for (const j of [0, nz - 1]) lerpEdge((i) => H[j * nx + i], (i, v) => (H[j * nx + i] = v), nx);
  for (const i of [0, nx - 1]) lerpEdge((j) => H[j * nx + i], (j, v) => (H[j * nx + i] = v), nz);

  // 촘촘한 조각(격자 칸 번호)
  let patches = [];
  const add = (x0, x1, z0, z1, sub) => {
    patches.push({
      i0: Math.max(1, Math.floor((x0 - R.x0) / st)), i1: Math.min(nx - 2, Math.ceil((x1 - R.x0) / st)),
      j0: Math.max(1, Math.floor((z0 - R.z0) / st)), j1: Math.min(nz - 2, Math.ceil((z1 - R.z0) / st)), sub
    });
  };
  const gc = hole.greenCenter;
  const gr = Math.max(hole.green.rx, hole.green.rz) * 1.15 + 12;
  add(gc.x - gr, gc.x + gr, gc.z - gr, gc.z + gr, Q.sub);
  for (const t of hole.teeBoxes) add(t.x - 11, t.x + 11, t.z - 11, t.z + 11, Q.sub);
  for (const b of hole._.bunkers) {
    const r = b.s.R + 3;
    add(b.s.cx - r, b.s.cx + r, b.s.cz - r, b.s.cz + r, Math.max(2, Q.sub / 2));
  }
  // 겹치거나 맞닿은 조각은 합칩니다
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let a = 0; a < patches.length; a++) {
      for (let b = a + 1; b < patches.length; b++) {
        const p = patches[a];
        const q = patches[b];
        if (p.i0 <= q.i1 && q.i0 <= p.i1 && p.j0 <= q.j1 && q.j0 <= p.j1) {
          patches[a] = { i0: Math.min(p.i0, q.i0), i1: Math.max(p.i1, q.i1), j0: Math.min(p.j0, q.j0), j1: Math.max(p.j1, q.j1), sub: Math.max(p.sub, q.sub) };
          patches.splice(b, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  patches = patches.filter((p) => p.i1 > p.i0 && p.j1 > p.j0);

  const uvOf = (x, z) => [(x - R.x0) / (R.x1 - R.x0), (z - R.z0) / (R.z1 - R.z0)];
  // 굵은 격자 법선
  const N = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(nx - 1, i + 1);
      const j0 = Math.max(0, j - 1);
      const j1 = Math.min(nz - 1, j + 1);
      const gx = (H[j * nx + i1] - H[j * nx + i0]) / ((i1 - i0) * st);
      const gz = (H[j1 * nx + i] - H[j0 * nx + i]) / ((j1 - j0) * st);
      const L = Math.hypot(gx, 1, gz);
      const k = (j * nx + i) * 3;
      N[k] = -gx / L;
      N[k + 1] = 1 / L;
      N[k + 2] = -gz / L;
    }
  }
  const coarse = new THREE.BufferGeometry();
  {
    const pos = new Float32Array(nx * nz * 3);
    const uv = new Float32Array(nx * nz * 2);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const x = R.x0 + i * st;
        const z = R.z0 + j * st;
        pos[k * 3] = x;
        pos[k * 3 + 1] = H[k];
        pos[k * 3 + 2] = z;
        const [u, v] = uvOf(x, z);
        uv[k * 2] = u;
        uv[k * 2 + 1] = v;
      }
    }
    const idx = [];
    const inPatch = (i, j) => patches.some((p) => i >= p.i0 && i + 1 <= p.i1 && j >= p.j0 && j + 1 <= p.j1);
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        if (inPatch(i, j)) continue;
        const a = j * nx + i;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    coarse.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    coarse.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    coarse.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    coarse.setIndex(idx);
  }
  const fine = patches.map((p) => {
    const s = p.sub;
    const fs = st / s;
    const mx = (p.i1 - p.i0) * s + 1;
    const mz = (p.j1 - p.j0) * s + 1;
    const x0 = R.x0 + p.i0 * st;
    const z0 = R.z0 + p.j0 * st;
    // 한 줄 더 넓게 높이를 구해 법선을 매끈하게
    const ex = mx + 2;
    const ez = mz + 2;
    const E = new Float32Array(ex * ez);
    for (let b = 0; b < ez; b++) for (let a = 0; a < ex; a++) E[b * ex + a] = hole.heightRaw(x0 + (a - 1) * fs, z0 + (b - 1) * fs);
    const pos = new Float32Array(mx * mz * 3);
    const nrm = new Float32Array(mx * mz * 3);
    const uv = new Float32Array(mx * mz * 2);
    const coarseAt = (ci, cj) => cj * nx + ci;
    for (let b = 0; b < mz; b++) {
      for (let a = 0; a < mx; a++) {
        const k = b * mx + a;
        const x = x0 + a * fs;
        const z = z0 + b * fs;
        let h;
        let n;
        const onX = a === 0 || a === mx - 1;
        const onZ = b === 0 || b === mz - 1;
        if (onX || onZ) {
          // 테두리: 굵은 격자 모서리를 따라 직선 보간(높이·법선)
          let k0;
          let k1;
          let t;
          if (onX) {
            const ci = p.i0 + (a === 0 ? 0 : p.i1 - p.i0);
            const cj = p.j0 + Math.floor(b / s);
            t = (b % s) / s;
            k0 = coarseAt(ci, cj);
            k1 = coarseAt(ci, Math.min(nz - 1, cj + 1));
          } else {
            const cj = p.j0 + (b === 0 ? 0 : p.j1 - p.j0);
            const ci = p.i0 + Math.floor(a / s);
            t = (a % s) / s;
            k0 = coarseAt(ci, cj);
            k1 = coarseAt(Math.min(nx - 1, ci + 1), cj);
          }
          h = H[k0] * (1 - t) + H[k1] * t;
          n = [N[k0 * 3] * (1 - t) + N[k1 * 3] * t, N[k0 * 3 + 1] * (1 - t) + N[k1 * 3 + 1] * t, N[k0 * 3 + 2] * (1 - t) + N[k1 * 3 + 2] * t];
        } else {
          const e = (b + 1) * ex + (a + 1);
          h = E[e];
          const gx = (E[e + 1] - E[e - 1]) / (2 * fs);
          const gz = (E[e + ex] - E[e - ex]) / (2 * fs);
          n = [-gx, 1, -gz];
        }
        const L = Math.hypot(n[0], n[1], n[2]);
        pos[k * 3] = x;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = z;
        nrm[k * 3] = n[0] / L;
        nrm[k * 3 + 1] = n[1] / L;
        nrm[k * 3 + 2] = n[2] / L;
        const [u, v] = uvOf(x, z);
        uv[k * 2] = u;
        uv[k * 2 + 1] = v;
      }
    }
    const idx = [];
    for (let b = 0; b < mz - 1; b++) {
      for (let a = 0; a < mx - 1; a++) {
        const q = b * mx + a;
        idx.push(q, q + mx, q + 1, q + 1, q + mx, q + mx + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  });
  return { R, nx, nz, st, H, coarse, fine, grid: { nx, nz, x0: R.x0, z0: R.z0, step: st, H } };
}

// 먼 지형: 본 지형 둘레는 8m 격자 띠(물가·모래언덕 모양이 살아 있게), 그 바깥은 32m 격자. 색은 정점 색.
// 메시끼리 맞닿는 테두리는 32m 마디 사이를 직선으로 이어(본 지형 테두리와 같은 방식) 틈이 생기지 않습니다.
function gridPatch(hole, course, o) {
  const { x0, z0, x1, z1, st, skip, fine } = o;
  const nx = Math.round((x1 - x0) / st) + 1;
  const nz = Math.round((z1 - z0) / st) + 1;
  const H = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) H[j * nx + i] = hole.heightRaw(x0 + i * st, z0 + j * st);
  const per = Math.round(32 / st);
  if (per > 1) {
    // 세로선 x = X (z 구간 za..zb) 위 정점을 32m 마디 사이 직선으로
    const vline = (X, za, zb) => {
      const i = Math.round((X - x0) / st);
      if (i < 0 || i >= nx) return;
      const j0 = Math.max(0, Math.round((za - z0) / st));
      const j1 = Math.min(nz - 1, Math.round((zb - z0) / st));
      for (let j = j0; j <= j1; j++) {
        const r = j % per;
        if (!r) continue;
        const ja = j - r;
        const jb = Math.min(nz - 1, ja + per);
        const t = (j - ja) / (jb - ja);
        H[j * nx + i] = H[ja * nx + i] * (1 - t) + H[jb * nx + i] * t;
      }
    };
    const hline = (Z, xa, xb) => {
      const j = Math.round((Z - z0) / st);
      if (j < 0 || j >= nz) return;
      const i0 = Math.max(0, Math.round((xa - x0) / st));
      const i1 = Math.min(nx - 1, Math.round((xb - x0) / st));
      for (let i = i0; i <= i1; i++) {
        const r = i % per;
        if (!r) continue;
        const ia = i - r;
        const ib = Math.min(nx - 1, ia + per);
        const t = (i - ia) / (ib - ia);
        H[j * nx + i] = H[j * nx + ia] * (1 - t) + H[j * nx + ib] * t;
      }
    };
    vline(x0, z0, z1);
    vline(x1, z0, z1);
    hline(z0, x0, x1);
    hline(z1, x0, x1);
    if (skip) {
      vline(skip.x0, skip.z0, skip.z1);
      vline(skip.x1, skip.z0, skip.z1);
      hline(skip.z0, skip.x0, skip.x1);
      hline(skip.z1, skip.x0, skip.x1);
    }
  }
  const pos = new Float32Array(nx * nz * 3);
  const nrm = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const c = new THREE.Color();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = x0 + i * st;
      const z = z0 + j * st;
      const h = H[k];
      pos[k * 3] = x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z;
      const hl = H[j * nx + Math.max(0, i - 1)];
      const hr = H[j * nx + Math.min(nx - 1, i + 1)];
      const hd = H[Math.max(0, j - 1) * nx + i];
      const hu = H[Math.min(nz - 1, j + 1) * nx + i];
      const gx = (hr - hl) / ((Math.min(nx - 1, i + 1) - Math.max(0, i - 1)) * st);
      const gz = (hu - hd) / ((Math.min(nz - 1, j + 1) - Math.max(0, j - 1)) * st);
      const L = Math.hypot(gx, 1, gz);
      nrm[k * 3] = -gx / L;
      nrm[k * 3 + 1] = 1 / L;
      nrm[k * 3 + 2] = -gz / L;
      let sl;
      let lap;
      if (fine) {
        // 본 지형 그림과 같은 간격(2m·4m)으로 경사·오목함을 재서 색이 이어지게 합니다
        const hx0 = hole.heightRaw(x - 2, z);
        const hx1 = hole.heightRaw(x + 2, z);
        const hz0 = hole.heightRaw(x, z - 2);
        const hz1 = hole.heightRaw(x, z + 2);
        sl = Math.hypot((hx1 - hx0) / 4, (hz1 - hz0) / 4);
        lap = (hole.heightRaw(x - 4, z) + hole.heightRaw(x + 4, z) + hole.heightRaw(x, z - 4) + hole.heightRaw(x, z + 4) - 4 * hole.heightRaw(x, z)) / 16;
      } else {
        sl = Math.hypot(gx, gz);
        lap = (hl + hr + hd + hu - 4 * h) / (st * st);
      }
      const g = groundColor(course, x, z, h, sl, lap);
      // 정점 색은 선형 공간이라 sRGB 값을 바꿔 넣습니다
      c.setRGB(g[0] / 255, g[1] / 255, g[2] / 255, THREE.SRGBColorSpace);
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
    }
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      if (skip) {
        const xa = x0 + i * st;
        const za = z0 + j * st;
        if (xa >= skip.x0 - 1e-6 && xa + st <= skip.x1 + 1e-6 && za >= skip.z0 - 1e-6 && za + st <= skip.z1 + 1e-6) continue;
      }
      const a = j * nx + i;
      idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
function buildFarGeometry(hole, course, R, Q) {
  const E = Q.ring;
  const RR = { x0: R.x0 - E, x1: R.x1 + E, z0: R.z0 - E, z1: R.z1 + E };
  const ring = gridPatch(hole, course, { ...RR, st: Q.ringStep, skip: R, fine: true });
  const cx = Math.round((R.x0 + R.x1) / 2 / 32) * 32;
  const cz = Math.round((R.z0 + R.z1) / 2 / 32) * 32;
  const half = Math.ceil(Q.far / 32) * 32;
  const far = gridPatch(hole, course, { x0: cx - half, x1: cx + half, z0: cz - half, z1: cz + half, st: 32, skip: RR, fine: false });
  return { geos: [ring, far], center: [cx, cz], half };
}

// 먼 지형 재질: 정점 색 + 본 지형과 같은 잔 결(이음매가 덜 보이게)
function farMaterial(detailTex) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = { value: detailTex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform sampler2D uDetail;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  float fd1 = texture2D(uDetail, vWPos.xz * 0.31).r;
  float fd2 = texture2D(uDetail, vWPos.xz * 0.047 + 0.31).g;
  diffuseColor.rgb *= (0.86 + 0.28 * fd1) * (0.92 + 0.16 * fd2);`);
  };
  mat.customProgramCacheKey = () => 'golf-far-v1';
  return mat;
}

// 지형 재질: 칠한 바닥 + 그린·티 고해상도 덧그림 + 가까울수록 잔디 결
function terrainMaterial(mainTex, insets, detailTex) {
  const mat = new THREE.MeshStandardMaterial({ map: mainTex, roughness: 0.94, metalness: 0 });
  const U = {
    uDetail: { value: detailTex },
    uIn0: { value: insets[0]?.tex || mainTex },
    uIn0R: { value: insets[0] ? new THREE.Vector4(...insets[0].rect) : new THREE.Vector4(0, 0, -1, -1) },
    uIn1: { value: insets[1]?.tex || mainTex },
    uIn1R: { value: insets[1] ? new THREE.Vector4(...insets[1].rect) : new THREE.Vector4(0, 0, -1, -1) }
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
uniform sampler2D uDetail; uniform sampler2D uIn0; uniform sampler2D uIn1; uniform vec4 uIn0R; uniform vec4 uIn1R;
vec4 golfInset(sampler2D t, vec4 r, vec4 base) {
  if (r.z <= 0.0) return base;
  vec2 u = (vWPos.xz - r.xy) / r.zw;
  if (u.x <= 0.0 || u.x >= 1.0 || u.y <= 0.0 || u.y >= 1.0) return base;
  vec2 e = min(u, 1.0 - u);
  float w = clamp(min(e.x, e.y) * 28.0, 0.0, 1.0);
  return mix(base, texture2D(t, u), w);
}`)
      .replace('#include <map_fragment>', `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  sampledDiffuseColor = golfInset(uIn0, uIn0R, sampledDiffuseColor);
  sampledDiffuseColor = golfInset(uIn1, uIn1R, sampledDiffuseColor);
  float gDist = length(vWPos - cameraPosition);
  float d1 = texture2D(uDetail, vWPos.xz * 0.31).r;
  float d2 = texture2D(uDetail, vWPos.xz * 0.047 + 0.31).g;
  float d3 = texture2D(uDetail, vWPos.xz * 1.7).b;
  float fineW = 1.0 - smoothstep(18.0, 70.0, gDist);
  sampledDiffuseColor.rgb *= mix(1.0, 0.86 + 0.28 * d3, fineW * 0.7) * (0.86 + 0.28 * d1) * (0.92 + 0.16 * d2);
  diffuseColor *= sampledDiffuseColor;
#endif`);
  };
  mat.customProgramCacheKey = () => 'golf-terrain-v1';
  return mat;
}

// 다각형을 바깥으로 d 만큼 밀어냅니다(물 메시를 물가보다 조금 크게)
function offsetPoly(pts, d) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const sgn = area > 0 ? -1 : 1;
  return pts.map((p, i) => {
    const a = pts[(i + pts.length - 1) % pts.length];
    const b = pts[(i + 1) % pts.length];
    const tx = b[0] - a[0];
    const tz = b[1] - a[1];
    const L = Math.hypot(tx, tz) || 1;
    return [p[0] + (sgn * tz / L) * d, p[1] - (sgn * tx / L) * d];
  });
}
function shapeGeo(pts, y) {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(shape, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}
function ribbonGeo(pts, hw, y) {
  const pos = [];
  const dense = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(L / 3));
    for (let k = 0; k < n; k++) dense.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  dense.push(pts[pts.length - 1]);
  const L = [];
  const R = [];
  dense.forEach((p, i) => {
    const a = dense[Math.max(0, i - 1)];
    const b = dense[Math.min(dense.length - 1, i + 1)];
    const tx = b[0] - a[0];
    const tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    L.push([p[0] - (tz / l) * hw, p[1] + (tx / l) * hw]);
    R.push([p[0] + (tz / l) * hw, p[1] - (tx / l) * hw]);
  });
  for (let i = 0; i < dense.length - 1; i++) {
    pos.push(L[i][0], y, L[i][1], R[i][0], y, R[i][1], L[i + 1][0], y, L[i + 1][1]);
    pos.push(R[i][0], y, R[i][1], R[i + 1][0], y, R[i + 1][1], L[i + 1][0], y, L[i + 1][1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}
function worldUV(g, scale) {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) / scale;
    uv[i * 2 + 1] = p.getZ(i) / scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// 깃발 천 그림(홀 번호)
function flagCanvas(color, num) {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 172;
  const g = cv.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 172);
  g.fillStyle = 'rgba(255,255,255,.95)';
  g.font = '900 120px Anton, Pretendard, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(num), 128, 92);
  return cv;
}
// 티 안내판(코스·홀 번호·파·거리·작은 지도)
function signCanvas(hole, course) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 384;
  const g = cv.getContext('2d');
  g.fillStyle = '#1d2a22';
  g.fillRect(0, 0, 512, 384);
  g.fillStyle = '#f3efe4';
  g.font = '700 26px Pretendard, sans-serif';
  g.fillText(course.name, 24, 44);
  g.font = '900 120px Anton, Pretendard, sans-serif';
  g.fillText(String(hole.number), 24, 180);
  g.font = '700 38px Anton, Pretendard, sans-serif';
  g.fillText(`PAR ${hole.par}`, 24, 240);
  g.font = '600 26px Pretendard, sans-serif';
  const L = hole.lengthByDifficulty;
  g.fillStyle = TEE_COLORS.hard;
  g.fillRect(24, 268, 16, 16);
  g.fillStyle = '#f3efe4';
  g.fillText(`${L.hard}m`, 48, 284);
  g.fillStyle = TEE_COLORS.normal;
  g.fillRect(24, 300, 16, 16);
  g.fillText(`${L.normal}m`, 48, 316);
  g.fillStyle = TEE_COLORS.easy;
  g.fillRect(24, 332, 16, 16);
  g.fillStyle = '#f3efe4';
  g.fillText(`${L.easy}m`, 48, 348);
  drawMinimap(g, hole, { x: 200, y: 20, w: 292, h: 344, pad: 14, bg: '#28392e', route: false });
  return cv;
}

// 인스턴스 메시를 땅 위 구역(150m)별로 나눠 만듭니다(그림자·시야 밖은 통째로 건너뜀)
function instanced(group, geo, mat, items, place, opts = {}) {
  const cell = opts.cell || 150;
  const buckets = new Map();
  for (const it of items) {
    const k = Math.floor(it.x / cell) + ',' + Math.floor(it.z / cell);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(it);
  }
  const o = new THREE.Object3D();
  const c = new THREE.Color();
  let tris = 0;
  for (const list of buckets.values()) {
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => {
      place(o, it);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (opts.color) m.setColorAt(i, opts.color(it, c));
    });
    m.castShadow = Boolean(opts.shadow);
    m.receiveShadow = opts.receive !== false;
    m.computeBoundingSphere();
    group.add(m);
    tris += ((geo.index ? geo.index.count : geo.attributes.position.count) / 3) * list.length;
  }
  return tris;
}

// 종류별 인스턴스 색
function tintFor(course, kind) {
  const th = course.theme;
  const pick = (arr) => (it, c) => c.set(arr[Math.floor(it.tint * arr.length) % arr.length]).offsetHSL(0, 0, (it.tint * 7 % 1 - 0.5) * 0.06);
  const soft = (it, c) => c.setRGB(0.86 + it.tint * 0.16, 0.9 + ((it.tint * 3.7) % 1) * 0.12, 0.86 + ((it.tint * 5.3) % 1) * 0.14);
  if (kind === 'shrub') {
    if (th === 'desert') return pick(['#7f8650', '#8a8a5c', '#6f7a48']);
    if (th === 'blossom') return pick(['#e0508e', '#f07aa8', '#5b8a3e', '#c94a8a', '#f6a0c0']);
    if (th === 'links') return pick(['#5e6b38', '#6d7440']);
    return pick(['#4a7a33', '#3f6e2c', '#5a8a3c']);
  }
  if (kind === 'gorse') return pick(['#ffffff', '#f2f0d8', '#e9e27a', '#f4e070', '#ffffff']);
  if (kind === 'tuft') {
    if (th === 'links') return pick(['#cfc48c', '#bdb27a', '#d9cf9a', '#a9a36c']);
    if (th === 'desert') return pick(['#d2b77e', '#c4a46c', '#b8a070']);
    return pick(['#7fa45a', '#8db060']);
  }
  if (kind === 'rock' || kind === 'boulder') {
    if (th === 'desert') return pick(['#c0724a', '#b5653f', '#cf8a5c']);
    if (th === 'alpine') return pick(['#9a9ea2', '#8a8e92', '#a7a59f']);
    if (th === 'links') return pick(['#a29d92', '#8f8a80']);
    return pick(['#9a968c', '#8d8a82']);
  }
  if (kind === 'flower') {
    if (th === 'alpine') return pick(['#ffffff', '#ffe14a', '#a77bff', '#4f8cff', '#ff7aa8']);
    return pick(['#ffe03a', '#ffffff', '#ff9ec4', '#ffcc33']);
  }
  if (kind === 'cherry') return (it, c) => c.setRGB(1, 0.9 + it.tint * 0.1, 0.92 + it.tint * 0.08);
  return soft;
}

// ---------- 하늘·빛 ----------
function makeSky(env, scale) {
  const sky = new Sky();
  sky.scale.setScalar(scale);
  const u = sky.material.uniforms;
  u.turbidity.value = env.sky.turbidity;
  u.rayleigh.value = env.sky.rayleigh;
  u.mieCoefficient.value = env.sky.mie;
  u.mieDirectionalG.value = env.sky.mieG;
  u.sunPosition.value.set(...env.sunDir);
  return sky;
}

// ---------- 본체 ----------
export function buildHole(hole, course, scene, quality = 'high') {
  const qobj = typeof quality === 'string' ? { level: quality } : { level: 'high', ...(quality || {}) };
  const Q = { ...QUALITY[qobj.level] || QUALITY.high, ...(qobj.overrides || {}) };
  const renderer = qobj.renderer || null;
  const t0 = performance.now();
  hole.prepare();
  const env = course.env;
  const P = course.palette;
  const group = new THREE.Group();
  group.name = `golf-${course.id}-${hole.number}`;
  group.userData.hole = hole;
  const textures = [];
  const extraDispose = [];
  const stats = { tris: 0, instances: 0, ms: 0 };
  const countMesh = (m) => {
    const g = m.geometry;
    stats.tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  };

  // 하늘·안개·빛
  const prevFog = scene.fog;
  const prevEnv = scene.environment;
  const prevEnvI = scene.environmentIntensity;
  scene.fog = new THREE.Fog(env.fog.color, env.fog.near, env.fog.far);
  const sky = makeSky(env, 4500);
  group.add(sky);
  let envRT = null;
  if (renderer && Q.env && qobj.environment !== false) {
    const pm = new THREE.PMREMGenerator(renderer);
    const es = new THREE.Scene();
    es.add(makeSky(env, 4500));
    envRT = pm.fromScene(es, 0.02);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.7;
    es.children[0].geometry.dispose();
    es.children[0].material.dispose();
    pm.dispose();
  }
  if (renderer && qobj.applyExposure !== false) renderer.toneMappingExposure = env.exposure;
  const sunDir = V(...env.sunDir);
  const hemi = new THREE.HemisphereLight(env.hemi.sky, env.hemi.ground, env.hemi.intensity);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(env.sun.color, env.sun.intensity);
  sun.castShadow = Q.shadow > 0;
  sun.shadow.mapSize.set(Q.shadow, Q.shadow);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  group.add(sun, sun.target);
  let autoShadow = true;
  function setShadowFocus(x, y, z, r) {
    if (x == null) {
      autoShadow = true;
      return;
    }
    if (typeof x === 'object') ({ x, y, z } = x);
    autoShadow = false;
    focus(x, y, z, r);
  }
  function focus(x, y, z, r = 30) {
    sun.target.position.set(x, y, z);
    sun.position.copy(sunDir).multiplyScalar(160).add(sun.target.position);
    const c = sun.shadow.camera;
    c.left = -r;
    c.right = r;
    c.top = r;
    c.bottom = -r;
    c.near = 1;
    c.far = 420;
    c.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
  }
  const teeN = hole.tee;
  focus(teeN.x, hole.teeHeight(), teeN.z, 30);

  // 구름
  const cloudTex = canvasTex(cloudCanvas(hole.seed));
  textures.push(cloudTex);
  const clouds = [];
  {
    const cl = env.clouds;
    const r = mulberry(hole.seed * 3 + 1);
    const cmat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: cl.opacity });
    for (let i = 0; i < cl.n; i++) {
      const s = new THREE.Sprite(cmat);
      const a = r() * Math.PI * 2;
      const d = 1300 + r() * 1500;
      s.position.set(teeN.x + Math.sin(a) * d, cl.y[0] + r() * (cl.y[1] - cl.y[0]), teeN.z + 200 + Math.cos(a) * d);
      const w = 600 + r() * 800;
      s.scale.set(w, w * 0.42, 1);
      group.add(s);
      clouds.push(s);
    }
  }

  // 지형
  const T = buildTerrainGeometry(hole, Q);
  const R = T.R;
  const field = fieldCanvas(course, T.grid);
  const W = R.x1 - R.x0;
  const D = R.z1 - R.z0;
  const ppm = Math.min(Q.tex / Math.max(W, D), 6);
  const mainCv = paintRect(hole, course, R, Math.round(W * ppm), Math.round(D * ppm), field, T.grid);
  const mainTex = canvasTex(mainCv);
  textures.push(mainTex);
  const insets = [];
  {
    const gc = hole.greenCenter;
    const r = Math.max(hole.green.rx, hole.green.rz) + 18;
    const rect = { x0: gc.x - r, x1: gc.x + r, z0: gc.z - r, z1: gc.z + r };
    const cv = paintRect(hole, course, rect, Q.inset, Q.inset, field, T.grid);
    const tex = canvasTex(cv);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    textures.push(tex);
    insets.push({ tex, rect: [rect.x0, rect.z0, rect.x1 - rect.x0, rect.z1 - rect.z0] });
  }
  {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const t of hole.teeBoxes) {
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = t.x + t.ux * a * t.hl - t.uz * b * t.hw;
        const z = t.z + t.uz * a * t.hl + t.ux * b * t.hw;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
    }
    const pad = 14;
    const rect = { x0: x0 - pad, x1: x1 + pad, z0: z0 - pad, z1: z1 + pad };
    const w = rect.x1 - rect.x0;
    const d = rect.z1 - rect.z0;
    const k = Q.inset / Math.max(w, d);
    const cv = paintRect(hole, course, rect, Math.round(w * k), Math.round(d * k), field, T.grid);
    const tex = canvasTex(cv);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    textures.push(tex);
    insets.push({ tex, rect: [rect.x0, rect.z0, w, d] });
  }
  const detailTex = canvasTex(detailCanvas(), false, true);
  textures.push(detailTex);
  const tmat = terrainMaterial(mainTex, insets, detailTex);
  const ground = new THREE.Group();
  ground.name = 'terrain';
  for (const geo of [T.coarse, ...T.fine]) {
    const m = new THREE.Mesh(geo, tmat);
    m.receiveShadow = true;
    m.castShadow = false;
    ground.add(m);
    countMesh(m);
  }
  group.add(ground);
  const far = buildFarGeometry(hole, course, R, Q);
  {
    const fmat = farMaterial(detailTex);
    far.geos.forEach((geo, i) => {
      const m = new THREE.Mesh(geo, fmat);
      m.name = i ? 'far-terrain' : 'ring-terrain';
      m.receiveShadow = i === 0;
      group.add(m);
      countMesh(m);
    });
  }

  // 물
  const wnTex = canvasTex(waterNormalCanvas(), false, true);
  textures.push(wnTex);
  const waterMats = [];
  for (const w of hole._.waters) {
    const s = w.shape;
    let geo;
    if (s.kind === 'strip') geo = ribbonGeo(s.pts, s.hw + 1.6, w.y);
    else if (s.kind === 'poly') geo = shapeGeo(offsetPoly(s.pts, 3), w.y);
    else geo = shapeGeo(outline(s.grow(2.5), 1, 128), w.y);
    worldUV(geo, w.kind === 'sea' ? 70 : 16);
    const mat = new THREE.MeshStandardMaterial({
      color: P.water, roughness: w.kind === 'sea' ? 0.12 : 0.05, metalness: 0.05, normalMap: wnTex,
      normalScale: new THREE.Vector2(w.kind === 'sea' ? 0.3 : 0.2, w.kind === 'sea' ? 0.3 : 0.2), transparent: true, opacity: w.kind === 'creek' ? 0.82 : 0.9,
      envMapIntensity: 1.1
    });
    mat.userData.speed = w.kind === 'creek' ? 0.06 : w.kind === 'sea' ? 0.02 : 0.008;
    waterMats.push(mat);
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    m.renderOrder = 1;
    group.add(m);
    countMesh(m);
  }

  // 나무·소품
  const dress = hole.dress().items;
  const keep = (it) => Q.density >= 1 || ['tallpine', 'oak', 'fir', 'cherry', 'redpine', 'saguaro', 'pine'].includes(it.kind) || ((it.tint * 997) % 1) < Q.density;
  const byKind = new Map();
  for (const it of dress) {
    if (!keep(it)) continue;
    let k = it.kind;
    if (k === 'saguaro') k = it.tint < 0.25 ? 'saguaro0' : it.tint < 0.65 ? 'saguaro1' : 'saguaro2';
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k).push(it);
  }
  const dressMats = [];
  for (const [kind, items] of byKind) {
    const base = kind.startsWith('saguaro') ? 'saguaro' : kind;
    const parts = M.treeParts(kind);
    const tint = tintFor(course, base);
    for (const part of parts) {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, side: part.side || THREE.FrontSide, flatShading: Boolean(part.flat) });
      dressMats.push(mat);
      stats.tris += instanced(group, part.geo, mat, items, (o, it) => {
        o.position.set(it.x, it.y - (base === 'rock' || base === 'boulder' ? 0.25 * it.s : 0.12), it.z);
        o.rotation.set(0, it.r, 0);
        o.scale.setScalar(it.s);
      }, { shadow: part.shadow, color: part.tint ? tint : null });
      stats.instances += items.length;
    }
  }

  // 깃발과 컵
  const flagColor = FLAG_COLORS[course.id] || '#e23b3b';
  const flagTex = canvasTex(flagCanvas(flagColor, hole.number));
  textures.push(flagTex);
  const pinG = new THREE.Group();
  pinG.name = 'pin';
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 2.3, 10), new THREE.MeshStandardMaterial({ color: '#f4f1e8', roughness: 0.4 }));
  pole.position.y = 1.15;
  pole.castShadow = true;
  pinG.add(pole);
  const clothGeo = new THREE.PlaneGeometry(0.62, 0.42, 14, 6).translate(0.31, 0, 0);
  const clothBase = clothGeo.attributes.position.array.slice();
  const flagPivot = new THREE.Group();
  flagPivot.position.y = 2.06;
  const cloth = new THREE.Mesh(clothGeo, new THREE.MeshStandardMaterial({ map: flagTex, roughness: 0.75, side: THREE.DoubleSide }));
  cloth.castShadow = true;
  flagPivot.add(cloth);
  pinG.add(flagPivot);
  const cup = new THREE.Mesh(new THREE.CircleGeometry(0.054, 28).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#0d0d0d', roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  cup.position.y = 0.004;
  pinG.add(cup);
  const liner = new THREE.Mesh(new THREE.RingGeometry(0.054, 0.061, 28).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  liner.position.y = 0.005;
  pinG.add(liner);
  group.add(pinG);
  let pinNow = { ...hole.pin };
  function setPin(p) {
    if (typeof p === 'number') p = hole.pins[p] || hole.pin;
    pinNow = { x: p.x, z: p.z };
    pinG.position.set(p.x, hole.height(p.x, p.z), p.z);
    return pinNow;
  }
  setPin(hole.pin);

  // 티 마커(난이도별 색)와 안내판
  const markerGeo = course.theme === 'links' || course.theme === 'alpine' ? new THREE.CylinderGeometry(0.09, 0.11, 0.2, 12).translate(0, 0.1, 0) : new THREE.SphereGeometry(0.1, 16, 12).translate(0, 0.08, 0);
  for (const t of hole.teeBoxes) {
    const mat = new THREE.MeshStandardMaterial({ color: TEE_COLORS[t.key], roughness: 0.35 });
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(markerGeo, mat);
      const lx = t.uz;
      const lz = -t.ux;
      m.position.set(t.x + t.ux * 1.2 + lx * s * 2.7, t.y, t.z + t.uz * 1.2 + lz * s * 2.7);
      m.castShadow = true;
      group.add(m);
    }
  }
  const signTex = canvasTex(signCanvas(hole, course));
  textures.push(signTex);
  {
    const t = hole.teeBoxes.find((b) => b.key === 'normal');
    const rx = -t.uz;
    const rz = t.ux;
    const sx = t.x + rx * (t.hw + 2.4) - t.ux * 3;
    const sz = t.z + rz * (t.hw + 2.4) - t.uz * 3;
    const sg = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: '#5a4030', roughness: 0.8 });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 0.08), wood);
      post.position.set(s * 0.52, 0.75, 0);
      post.castShadow = true;
      sg.add(post);
    }
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.06), [wood, wood, wood, wood, new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6 }), wood]);
    board.position.y = 1.15;
    board.castShadow = true;
    sg.add(board);
    sg.position.set(sx, hole.heightRaw(sx, sz), sz);
    // 판 앞면이 티 뒤(카메라) 쪽을 보도록
    sg.rotation.y = Math.atan2(-t.ux, -t.uz) + 0.5;
    group.add(sg);
  }

  // 거리 말뚝(그린 가운데까지 200·150·100m)
  if (hole.par >= 4) {
    const gc = hole.greenCenter;
    const pts = [];
    const rt = hole.route;
    for (let i = 0; i < rt.length - 1; i++) {
      const a = rt[i];
      const b = rt[i + 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      for (let s = 0; s < L; s += 1) pts.push([a.x + ((b.x - a.x) * s) / L, a.z + ((b.z - a.z) * s) / L, (b.x - a.x) / L, (b.z - a.z) / L]);
    }
    const postMat = { 200: '#2a63d8', 150: '#f4f4f0', 100: '#e8433b' };
    for (const Dm of [200, 150, 100]) {
      let best = null;
      for (let i = pts.length - 1; i >= 0; i--) {
        if (Math.hypot(pts[i][0] - gc.x, pts[i][1] - gc.z) >= Dm) {
          best = pts[i];
          break;
        }
      }
      if (!best || Math.hypot(best[0] - teeN.x, best[1] - teeN.z) < 60) continue;
      const [x, z, ux, uz] = best;
      let off = 0;
      for (; off < 40; off += 0.5) {
        const s = hole.surface(x - uz * off, z + ux * off);
        if (s !== 'fairway' && s !== 'bunker' && s !== 'water') break;
      }
      const px = x - uz * (off + 1.5);
      const pz = z + ux * (off + 1.5);
      if (hole.surface(px, pz) === 'water') continue;
      const post = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 10), new THREE.MeshStandardMaterial({ color: '#f4f1e8', roughness: 0.5 }));
      body.position.y = 0.45;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.22, 10), new THREE.MeshStandardMaterial({ color: postMat[Dm], roughness: 0.4 }));
      top.position.y = 0.92;
      post.add(body, top);
      post.traverse((o) => (o.castShadow = true));
      post.position.set(px, hole.heightRaw(px, pz), pz);
      group.add(post);
    }
  }

  // OB 말뚝(흰색): 경계선 중 코스와 가까운 곳에만
  {
    const B = hole.bounds;
    const spots = [];
    const edge = (x0, z0, x1, z1) => {
      const L = Math.hypot(x1 - x0, z1 - z0);
      for (let s = 0; s <= L; s += 14) {
        const x = x0 + ((x1 - x0) * s) / L;
        const z = z0 + ((z1 - z0) * s) / L;
        if (hole._.corr(x, z) > 70) continue;
        const ix = x + Math.sign((B.x0 + B.x1) / 2 - x) * 2 * (x0 === x1 ? 1 : 0);
        const iz = z + Math.sign((B.z0 + B.z1) / 2 - z) * 2 * (z0 === z1 ? 1 : 0);
        const s0 = hole.surface(ix, iz);
        if (s0 === 'water' || s0 === 'ob') continue;
        const wl = hole.waterY;
        const h = hole.heightRaw(x, z);
        if (wl != null && h < wl + 0.3) continue;
        spots.push({ x, z, y: h });
      }
    };
    edge(B.x0, B.z0, B.x0, B.z1);
    edge(B.x1, B.z0, B.x1, B.z1);
    edge(B.x0, B.z1, B.x1, B.z1);
    if (spots.length) {
      const geo = new THREE.BoxGeometry(0.07, 1.0, 0.07).translate(0, 0.5, 0);
      const mat = new THREE.MeshStandardMaterial({ color: '#f6f6f2', roughness: 0.5 });
      stats.tris += instanced(group, geo, mat, spots, (o, it) => {
        o.position.set(it.x, it.y, it.z);
        o.rotation.set(0, 0, 0);
        o.scale.setScalar(1);
      }, { shadow: true });
    }
  }

  // 장식
  let fountain = null;
  for (const e of hole._.def.extras || []) {
    const y = e.y ?? hole.heightRaw(e.x ?? 0, e.z ?? 0);
    let obj = null;
    if (e.kind === 'lighthouse') obj = M.lighthouse();
    else if (e.kind === 'islet') obj = M.islet();
    else if (e.kind === 'pavilion') obj = M.pavilion();
    else if (e.kind === 'lantern') obj = M.lantern();
    else if (e.kind === 'chalet') obj = M.chalet();
    else if (e.kind === 'bench') obj = M.bench();
    else if (e.kind === 'flowerbed') obj = M.flowerbed();
    else if (e.kind === 'wall') {
      const blocks = [];
      const pts = e.pts;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        for (let s = 0; s < L; s += 2) {
          const x = ax + ((bx - ax) * s) / L;
          const z = az + ((bz - az) * s) / L;
          blocks.push({ x, z, y: hole.heightRaw(x, z), r: Math.atan2(bx - ax, bz - az) + Math.PI / 2 });
        }
      }
      const geo = M.wallBlockGeo();
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
      stats.tris += instanced(group, geo, mat, blocks, (o, it) => {
        o.position.set(it.x, it.y - 0.15, it.z);
        o.rotation.set(0, it.r, 0);
        o.scale.setScalar(1);
      }, { shadow: true });
      continue;
    } else if (e.kind === 'fountain') {
      const wy = hole.waterLevel(e.x, e.z) ?? y;
      fountain = makeFountain(e.x, wy, e.z);
      group.add(fountain.obj);
      continue;
    }
    if (!obj) continue;
    obj.position.set(e.x, y, e.z);
    obj.rotation.y = e.rot || 0;
    if (e.s) obj.scale.setScalar(e.s);
    group.add(obj);
  }
  // 카트 도로가 개울을 건너는 곳에 다리
  for (const p of hole._.paths) {
    for (const w of hole._.waters) {
      if (w.shape.kind !== 'strip') continue;
      const cross = segCross(p.pts, w.shape.pts);
      for (const c of cross) {
        const span = w.shape.hw * 2 + 5;
        const br = M.bridge(span, course.theme === 'blossom');
        const ex = c.ux * span * 0.5;
        const ez = c.uz * span * 0.5;
        const y = Math.max(hole.heightRaw(c.x - ex, c.z - ez), hole.heightRaw(c.x + ex, c.z + ez)) - 0.2;
        br.position.set(c.x, y, c.z);
        br.rotation.y = Math.atan2(c.ux, c.uz);
        group.add(br);
      }
    }
  }

  // 먼 경치
  const farObj = buildFarScenery(hole, course, R, Q);
  if (farObj) group.add(farObj);

  // 꽃잎(벚꽃 코스)
  const petals = course.theme === 'blossom' ? makePetals(P.petal || '#f6c9d6') : null;
  if (petals) {
    group.add(petals.obj);
    textures.push(petals.tex);
  }

  scene.add(group);
  stats.ms = Math.round(performance.now() - t0);

  // 바람(깃발 방향·꽃잎 날림)
  let wind = { x: 0, z: 0 };
  function setWind(x, z) {
    if (typeof x === 'object') ({ x, z } = x);
    wind = { x: x || 0, z: z || 0 };
  }

  let time = 0;
  const camFwd = new THREE.Vector3();
  function update(dt, camera) {
    time += dt;
    // 깃발: 바람 부는 쪽으로 펄럭입니다
    const ws = Math.hypot(wind.x, wind.z);
    flagPivot.rotation.y = ws > 0.1 ? Math.atan2(-wind.z, wind.x) : 0.6;
    const pos = clothGeo.attributes.position;
    const amp = 0.035 + Math.min(0.09, ws * 0.012);
    for (let i = 0; i < pos.count; i++) {
      const x0 = clothBase[i * 3];
      const y0 = clothBase[i * 3 + 1];
      const k = x0 / 0.62;
      pos.setXYZ(i, x0 * (1 - 0.06 * k), y0 - k * k * Math.max(0, 0.12 - ws * 0.02), Math.sin(time * (5 + ws * 0.6) - x0 * 9) * amp * k);
    }
    pos.needsUpdate = true;
    clothGeo.computeVertexNormals();
    for (const m of waterMats) {
      m.normalMap.offset.x += dt * m.userData.speed;
      m.normalMap.offset.y += dt * m.userData.speed * 0.6;
    }
    for (const c of clouds) c.position.x += (wind.x * 0.6 + 0.6) * dt;
    if (fountain) fountain.update(dt);
    if (camera) {
      if (petals) petals.update(dt, camera, wind, time);
      if (autoShadow) {
        camera.getWorldDirection(camFwd);
        const h = camera.position.y - hole.heightRaw(camera.position.x, camera.position.z);
        const d = Math.min(80, 18 + Math.max(0, h) * 0.8);
        const tx = camera.position.x + camFwd.x * d;
        const tz = camera.position.z + camFwd.z * d;
        focus(tx, hole.heightRaw(tx, tz), tz, Math.min(140, 26 + Math.max(0, h) * 0.9));
      }
    }
  }

  function dispose() {
    scene.remove(group);
    group.traverse((o) => {
      if (o.geometry && !M.isCached(o.geometry)) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) m.dispose();
      if (o.isInstancedMesh) o.dispose();
    });
    for (const t of textures) t.dispose();
    for (const f of extraDispose) f();
    if (envRT) envRT.dispose();
    scene.fog = prevFog;
    scene.environment = prevEnv;
    scene.environmentIntensity = prevEnvI;
  }

  return {
    group, update, dispose, sun, hemi, sky, setShadowFocus, setPin, setWind,
    setTee: (key = 'normal') => {
      const t = hole.teeBoxes.find((b) => b.key === key) || hole.teeBoxes[1];
      focus(t.x, t.y, t.z, 30);
      return { x: t.x, z: t.z, y: t.y };
    },
    get pin() {
      return { ...pinNow };
    },
    exposure: env.exposure,
    // 카메라 far 는 이 값 이상으로(먼 지형 모서리·설산까지 보이게)
    viewFar: course.far?.kind === 'mountains' ? 6500 : 5000,
    stats
  };
}

function mulberry(seed) {
  let a = seed | 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 두 꺾은선의 교차점(다리 자리)
function segCross(A, Bp) {
  const out = [];
  for (let i = 0; i < A.length - 1; i++) {
    for (let j = 0; j < Bp.length - 1; j++) {
      const [ax, az] = A[i];
      const [bx, bz] = A[i + 1];
      const [cx, cz] = Bp[j];
      const [dx, dz] = Bp[j + 1];
      const den = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
      if (Math.abs(den) < 1e-9) continue;
      const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / den;
      const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        const L = Math.hypot(bx - ax, bz - az) || 1;
        out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, ux: (bx - ax) / L, uz: (bz - az) / L });
      }
    }
  }
  return out;
}

// 연못 분수
function makeFountain(x, y, z) {
  const N = 260;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const life = new Float32Array(N);
  for (let i = 0; i < N; i++) life[i] = Math.random() * 1.6;
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: '#eef6ff', size: 0.16, transparent: true, opacity: 0.75, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 2.4, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.25, depthWrite: false }));
  ring.position.y = 0.02;
  const obj = new THREE.Group();
  obj.position.set(x, y, z);
  obj.add(pts, ring);
  const spawn = (i) => {
    pos[i * 3] = 0;
    pos[i * 3 + 1] = 0.1;
    pos[i * 3 + 2] = 0;
    const a = Math.random() * Math.PI * 2;
    const s = 0.4 + Math.random() * 0.5;
    vel[i * 3] = Math.cos(a) * s;
    vel[i * 3 + 1] = 6.2 + Math.random() * 0.8;
    vel[i * 3 + 2] = Math.sin(a) * s;
    life[i] = 0;
  };
  for (let i = 0; i < N; i++) spawn(i);
  return {
    obj,
    update(dt) {
      for (let i = 0; i < N; i++) {
        life[i] += dt;
        vel[i * 3 + 1] -= 9.8 * dt;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (pos[i * 3 + 1] < 0) spawn(i);
      }
      geo.attributes.position.needsUpdate = true;
    }
  };
}

// 흩날리는 꽃잎(카메라 둘레 상자 안에서 돌고 돕니다)
function makePetals(color) {
  const N = 900;
  const box = 60;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(32, 32, 26, 15, 0.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,.55)';
  g.beginPath();
  g.ellipse(26, 28, 10, 5, 0.5, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const ph = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * box;
    pos[i * 3 + 1] = Math.random() * 18;
    pos[i * 3 + 2] = (Math.random() - 0.5) * box;
    ph[i] = Math.random() * 10;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ map: tex, size: 0.14, transparent: true, depthWrite: false, alphaTest: 0.2 });
  const obj = new THREE.Points(geo, mat);
  obj.frustumCulled = false;
  let cx = 0;
  let cz = 0;
  return {
    obj,
    tex,
    update(dt, camera, wind, time) {
      cx = camera.position.x;
      cz = camera.position.z;
      const cy = camera.position.y;
      for (let i = 0; i < N; i++) {
        const k = i * 3;
        pos[k] += (wind.x * 0.5 + 0.35 + Math.sin(time * 1.3 + ph[i]) * 0.5) * dt;
        pos[k + 1] -= (0.55 + Math.sin(time * 2 + ph[i]) * 0.25) * dt;
        pos[k + 2] += (wind.z * 0.5 + Math.cos(time * 1.1 + ph[i]) * 0.5) * dt;
        // 카메라 둘레 상자 밖으로 나가면 반대편으로
        let dx = pos[k] - cx;
        let dz = pos[k + 2] - cz;
        if (dx > box / 2) pos[k] -= box;
        if (dx < -box / 2) pos[k] += box;
        if (dz > box / 2) pos[k + 2] -= box;
        if (dz < -box / 2) pos[k + 2] += box;
        if (pos[k + 1] < cy - 8) pos[k + 1] += 22;
        if (pos[k + 1] > cy + 14) pos[k + 1] -= 22;
      }
      geo.attributes.position.needsUpdate = true;
    }
  };
}

// 먼 경치: 바다는 지형으로 이미 있고, 숲·메사·설산·언덕을 더합니다
function buildFarScenery(hole, course, R, Q) {
  const g = new THREE.Group();
  g.name = 'far-scenery';
  const cx = (R.x0 + R.x1) / 2;
  const cz = (R.z0 + R.z1) / 2;
  const r = mulberry(hole.seed * 5 + 9);
  const kind = course.far?.kind;
  const insideMain = (x, z, pad = 0) => x > R.x0 - pad && x < R.x1 + pad && z > R.z0 - pad && z < R.z1 + pad;
  const farTreeRing = (n, color, minD, maxD, scale = [0.9, 1.8], shape = 'cone') => {
    const items = [];
    for (let i = 0; i < n * 3 && items.length < n; i++) {
      const x = cx + (r() - 0.5) * 2 * maxD;
      const z = cz + (r() - 0.5) * 2 * maxD;
      if (insideMain(x, z, 6)) continue;
      const d = Math.hypot(x - cx, z - cz);
      if (d > maxD || d < minD) continue;
      const y = hole.heightRaw(x, z);
      const wl = hole.waterLevel(x, z);
      if (wl != null) continue;
      items.push({ x, z, y, s: scale[0] + r() * (scale[1] - scale[0]), r: r() * 6, tint: r() });
    }
    const geo = M.farTreeGeo(shape);
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 });
    const base = new THREE.Color(color);
    instanced(g, geo, mat, items, (o, it) => {
      o.position.set(it.x, it.y - 0.3, it.z);
      o.rotation.set(0, it.r, 0);
      o.scale.set(it.s, it.s * (0.9 + it.tint * 0.5), it.s);
    }, { shadow: false, receive: false, color: (it, c) => c.copy(base).offsetHSL(0.02 * (it.tint - 0.5), 0, (it.tint - 0.5) * 0.08), cell: 400 });
    return items.length;
  };
  if (kind === 'forest') {
    farTreeRing(3400, '#2c4f26', 0, 900);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + r() * 0.3;
      const d = 1500 + r() * 700;
      const m = new THREE.Mesh(M.hillGeo(i + 3, 380 + r() * 300, 140 + r() * 120, 300 + r() * 200), new THREE.MeshStandardMaterial({ color: '#4c6e58', roughness: 1, flatShading: true }));
      m.position.set(cx + Math.sin(a) * d, hole.heightRaw(cx + Math.sin(a) * d, cz + Math.cos(a) * d) - 20, cz + Math.cos(a) * d);
      g.add(m);
    }
  } else if (kind === 'mesas') {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + r() * 0.3;
      const d = 750 + r() * 1300;
      const x = cx + Math.sin(a) * d;
      const z = cz + Math.cos(a) * d;
      const big = r() < 0.6;
      const geo = M.mesaGeo(i * 7 + 1, big ? 120 + r() * 220 : 40 + r() * 50, big ? 70 + r() * 110 : 90 + r() * 80);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
      m.position.set(x, hole.heightRaw(x, z) - 4, z);
      m.rotation.y = r() * 6;
      g.add(m);
    }
    farTreeRing(500, '#6f7a44', 0, 700, [0.35, 0.6], 'round');
  } else if (kind === 'mountains') {
    // 설산은 먼 지형 너머(2.6~3.5km)에 세우고, 안개 대신 미리 옅게 바랜 색을 칠해 또렷한 배경이 되게 합니다
    const haze = new THREE.Color(course.env.fog.color);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + r() * 0.25;
      const d = 2900 + r() * 800;
      const x = cx + Math.sin(a) * d;
      const z = cz + Math.cos(a) * d;
      const h = 520 + r() * 620;
      const rad = h * (1.1 + r() * 0.5);
      const geo = M.mountainGeo(i * 13 + 2, rad, h);
      const col = geo.attributes.color;
      const k = 0.3 + ((d - 2900) / 800) * 0.16;
      const cc = new THREE.Color();
      for (let v = 0; v < col.count; v++) {
        cc.setRGB(col.getX(v), col.getY(v), col.getZ(v)).lerp(haze, k);
        col.setXYZ(v, cc.r, cc.g, cc.b);
      }
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true, fog: false }));
      // 밑동은 코스 쪽 가장자리 땅보다 낮게 묻습니다(떠 보이지 않게)
      const ex = cx + Math.sin(a) * (d - rad * 0.85);
      const ez = cz + Math.cos(a) * (d - rad * 0.85);
      m.position.set(x, Math.min(hole.heightRaw(x, z), hole.heightRaw(ex, ez)) - 60, z);
      m.rotation.y = r() * 6;
      g.add(m);
    }
    farTreeRing(3800, '#1f3a2a', 0, 1100, [0.8, 1.7]);
  } else if (kind === 'hills') {
    const layers = [[900, '#5f8a4a', 10], [1400, '#6f9478', 12], [2100, '#8aa3a8', 14]];
    layers.forEach(([d0, col, n], li) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r() * 0.4 + li;
        const d = d0 + r() * 300;
        const x = cx + Math.sin(a) * d;
        const z = cz + Math.cos(a) * d;
        const m = new THREE.Mesh(M.hillGeo(i + li * 20, 300 + r() * 260, 110 + r() * 90 + li * 60, 220 + r() * 160), new THREE.MeshStandardMaterial({ color: col, roughness: 1 }));
        m.position.set(x, hole.heightRaw(x, z) - 15, z);
        m.rotation.y = r() * 6;
        g.add(m);
      }
    });
    farTreeRing(1400, '#2f5a2a', 0, 800, [0.8, 1.4], 'round');
    farTreeRing(700, '#f2b8ca', 0, 700, [0.7, 1.2], 'round');
  }
  return g;
}
