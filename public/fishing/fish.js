// 물고기 모델: 큰입배스·작은입배스·블루길. 몸통은 단면 타원을 길이 방향으로 이어 만든 곡면,
// 지느러미는 2D 외곽선을 판으로 만들고, 비늘·무늬는 캔버스에 그립니다.
// 모든 부품을 물고기 좌표(머리 = +x, 위 = +y, 옆 = z, 길이 1)에 굽고, 같은 꼬리치기 셰이더로 함께 휘게 합니다.
// 물속에서는 깊이만큼 물빛이 섞입니다(underwater.js). 모양(geometry)은 종마다 한 번만 만들어 함께 씁니다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { underwater } from './underwater.js';

const TAU = Math.PI * 2;

// 길이 방향(u: 0 = 주둥이, 1 = 꼬리 끝) 단면: h = 반높이, w = 반너비, c = 중심 높이
const SHAPES = {
  lmb: {
    u: [0, 0.025, 0.07, 0.14, 0.24, 0.36, 0.48, 0.6, 0.72, 0.82, 0.88],
    h: [0.004, 0.036, 0.068, 0.098, 0.118, 0.128, 0.124, 0.105, 0.077, 0.052, 0.044],
    w: [0.003, 0.026, 0.046, 0.06, 0.068, 0.07, 0.066, 0.053, 0.036, 0.022, 0.016],
    c: [-0.018, -0.012, -0.005, 0, 0.002, -0.002, -0.004, 0, 0.004, 0.005, 0.005],
    eye: 0.1, eyeR: 0.021, jaw: 0.016
  },
  smb: {
    u: [0, 0.025, 0.07, 0.14, 0.24, 0.36, 0.48, 0.6, 0.72, 0.82, 0.88],
    h: [0.004, 0.032, 0.062, 0.09, 0.108, 0.116, 0.114, 0.098, 0.072, 0.05, 0.042],
    w: [0.003, 0.024, 0.043, 0.056, 0.063, 0.065, 0.061, 0.05, 0.034, 0.021, 0.015],
    c: [-0.01, -0.007, -0.003, 0, 0.002, 0, -0.002, 0, 0.003, 0.004, 0.004],
    eye: 0.1, eyeR: 0.02, jaw: 0.008
  },
  blg: {
    u: [0, 0.03, 0.08, 0.16, 0.26, 0.38, 0.5, 0.62, 0.73, 0.82, 0.88],
    h: [0.006, 0.05, 0.1, 0.16, 0.2, 0.215, 0.205, 0.17, 0.11, 0.06, 0.05],
    w: [0.004, 0.022, 0.038, 0.05, 0.056, 0.057, 0.053, 0.044, 0.03, 0.018, 0.013],
    c: [0.0, 0.004, 0.006, 0.006, 0.004, 0.0, -0.004, -0.004, 0.0, 0.004, 0.004],
    eye: 0.11, eyeR: 0.026, jaw: 0.0
  }
};

const LOOK = {
  lmb: { back: '#34451c', side: '#8d9b4c', side2: '#b6b56a', belly: '#f2ecd8', mark: 'stripe', markC: 'rgba(28,36,14,', fin: '#7b7a45', eye: '#d9a520' },
  smb: { back: '#3f3117', side: '#9a7438', side2: '#c09a58', belly: '#ece0c2', mark: 'bars', markC: 'rgba(48,32,10,', fin: '#8a6a3a', eye: '#c8361d' },
  blg: { back: '#27443e', side: '#5d7a63', side2: '#8e9b6c', belly: '#f0c060', mark: 'bars', markC: 'rgba(20,32,30,', fin: '#3f4c40', eye: '#1c2030' }
};

function lerpTable(tab, key, u) {
  const us = tab.u;
  if (u <= us[0]) return tab[key][0];
  for (let i = 1; i < us.length; i++) {
    if (u <= us[i]) {
      // 매끈하게: 구간 안에서 smoothstep 대신 cosine 보간
      const t = (u - us[i - 1]) / (us[i] - us[i - 1]);
      const s = (1 - Math.cos(t * Math.PI)) / 2;
      return tab[key][i - 1] + (tab[key][i] - tab[key][i - 1]) * s;
    }
  }
  return tab[key][us.length - 1];
}
const xOf = (u) => 0.5 - u; // 물고기 좌표의 x(머리 +0.5, 꼬리 -0.5)

// ---------- 텍스처 ----------
function cv(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 몸통 무늬. 가로 = u(주둥이→꼬리), 세로 = 둘레(0 = 등, 0.5 = 배, 1 = 다시 등)
function paintSkin(id) {
  const L = LOOK[id];
  const r = rng(id.charCodeAt(0) * 977 + 13);
  return cv(1024, 512, (g, W, H) => {
    // 등 → 옆 → 배 → 옆 → 등
    const gr = g.createLinearGradient(0, 0, 0, H);
    const stops = [[0, L.back], [0.12, L.back], [0.24, L.side], [0.34, L.side2], [0.44, L.belly], [0.56, L.belly], [0.66, L.side2], [0.76, L.side], [0.88, L.back], [1, L.back]];
    for (const [t, c] of stops) gr.addColorStop(t, c);
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    // 블루길 가슴은 주황
    if (id === 'blg') {
      const bg = g.createRadialGradient(W * 0.3, H * 0.5, 0, W * 0.3, H * 0.5, W * 0.28);
      bg.addColorStop(0, 'rgba(240,140,40,.9)');
      bg.addColorStop(1, 'rgba(240,140,40,0)');
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      // 뺨의 푸른 빛
      for (const y of [0.32, 0.68]) {
        const cg = g.createRadialGradient(W * 0.12, H * y, 0, W * 0.12, H * y, W * 0.1);
        cg.addColorStop(0, 'rgba(70,120,200,.55)');
        cg.addColorStop(1, 'rgba(70,120,200,0)');
        g.fillStyle = cg;
        g.fillRect(0, 0, W, H);
      }
    }
    // 등쪽 얼룩
    for (let i = 0; i < 260; i++) {
      const x = r() * W;
      const yy = r() < 0.5 ? r() * H * 0.2 : H - r() * H * 0.2;
      const rad = 4 + r() * 14;
      g.fillStyle = `${L.markC}${(0.08 + r() * 0.12).toFixed(2)})`;
      g.beginPath();
      g.ellipse(x, yy, rad * 1.6, rad, 0, 0, TAU);
      g.fill();
    }
    // 옆줄 무늬
    for (const side of [0.25, 0.75]) {
      const y0 = H * side;
      if (L.mark === 'stripe') {
        // 큰입배스: 아가미 뒤에서 꼬리까지 이어지는 짙은 얼룩 띠
        for (let x = W * 0.12; x < W * 0.9; x += 7) {
          const k = x / W;
          const amp = 16 + 10 * Math.sin(k * 23) + r() * 8;
          g.fillStyle = `${L.markC}${(0.45 + r() * 0.25).toFixed(2)})`;
          g.beginPath();
          g.ellipse(x, y0 + Math.sin(k * 40) * 4, 9 + r() * 6, amp * 0.55, 0, 0, TAU);
          g.fill();
        }
        // 띠 위쪽 잔얼룩
        for (let i = 0; i < 60; i++) {
          const x = W * (0.15 + r() * 0.7);
          const dy = (side < 0.5 ? -1 : 1) * (18 + r() * 40);
          g.fillStyle = `${L.markC}${(0.2 + r() * 0.2).toFixed(2)})`;
          g.beginPath();
          g.ellipse(x, y0 + dy * (side < 0.5 ? 1 : -1) * -1, 6 + r() * 8, 5 + r() * 6, r() * 3, 0, TAU);
          g.fill();
        }
        // 눈에서 아가미로 가는 줄
        g.strokeStyle = `${L.markC}0.5)`;
        g.lineWidth = 7;
        g.beginPath();
        g.moveTo(W * 0.06, y0 + (side < 0.5 ? -4 : 4));
        g.quadraticCurveTo(W * 0.14, y0 + (side < 0.5 ? 6 : -6), W * 0.21, y0 + (side < 0.5 ? 14 : -14));
        g.stroke();
      } else {
        // 세로 띠
        const n = id === 'blg' ? 7 : 11;
        for (let i = 0; i < n; i++) {
          const x = W * (0.2 + (i / n) * 0.66) + r() * 8;
          const gg = g.createLinearGradient(x - 14, 0, x + 14, 0);
          const a = id === 'blg' ? 0.3 : 0.36;
          gg.addColorStop(0, `${L.markC}0)`);
          gg.addColorStop(0.5, `${L.markC}${a})`);
          gg.addColorStop(1, `${L.markC}0)`);
          g.fillStyle = gg;
          const ext = H * 0.16;
          g.fillRect(x - 14, y0 - ext * (side < 0.5 ? 1.3 : 0.7), 28, ext * 2);
        }
      }
    }
    // 아가미 뚜껑 선
    g.strokeStyle = 'rgba(30,30,20,0.45)';
    g.lineWidth = 3;
    for (const side of [0.25, 0.75]) {
      g.beginPath();
      const x = W * 0.235;
      g.moveTo(x - 30, H * (side - 0.13));
      g.quadraticCurveTo(x + 16, H * side, x - 30, H * (side + 0.13));
      g.stroke();
      if (id === 'blg') {
        // 블루길의 검은 귀(아가미 끝 점)
        g.fillStyle = 'rgba(10,12,20,.9)';
        g.beginPath();
        g.ellipse(x - 2, H * side + (side < 0.5 ? -10 : 10), 15, 11, 0, 0, TAU);
        g.fill();
      }
    }
    // 입선
    g.strokeStyle = 'rgba(25,20,15,.75)';
    g.lineWidth = 4;
    for (const side of [0.25, 0.75]) {
      const dy = side < 0.5 ? 1 : -1;
      const len = id === 'lmb' ? 0.12 : id === 'smb' ? 0.09 : 0.045;
      g.beginPath();
      g.moveTo(0, H * side + dy * 48);
      g.quadraticCurveTo(W * len * 0.6, H * side + dy * 40, W * len, H * side + dy * 28);
      g.stroke();
    }
    // 비늘 결
    g.globalAlpha = 0.07;
    g.strokeStyle = '#000';
    g.lineWidth = 1.2;
    for (let y = 6; y < H; y += 12) {
      for (let x = ((y / 12) % 2) * 7 + W * 0.2; x < W * 0.9; x += 14) {
        g.beginPath();
        g.arc(x, y, 7, -Math.PI / 2, Math.PI / 2);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  });
}
function paintScales() {
  return cv(512, 256, (g, W, H) => {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, W, H);
    for (let y = 3; y < H; y += 6) {
      for (let x = ((y / 6) % 2) * 3.5; x < W; x += 7) {
        const gr = g.createRadialGradient(x - 1, y, 0, x, y, 4.2);
        gr.addColorStop(0, '#a0a0a0');
        gr.addColorStop(0.75, '#808080');
        gr.addColorStop(1, '#5a5a5a');
        g.fillStyle = gr;
        g.beginPath();
        g.arc(x, y, 4.2, -Math.PI / 2, Math.PI / 2);
        g.fill();
      }
    }
  });
}
// 지느러미: 뿌리(v=0)에서 끝(v=1)으로 뻗는 가는 살과 반투명 막
function paintFin(color, spot) {
  return cv(256, 256, (g, W, H) => {
    const c = new THREE.Color(color);
    const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
    const gr = g.createLinearGradient(0, H, 0, 0);
    gr.addColorStop(0, `rgba(${rgb},0.95)`);
    gr.addColorStop(0.75, `rgba(${rgb},0.7)`);
    gr.addColorStop(1, `rgba(${rgb},0.35)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(20,18,10,0.55)';
    g.lineWidth = 2.2;
    for (let x = 6; x < W; x += 13) {
      g.beginPath();
      g.moveTo(x, H);
      g.lineTo(x + (x - W / 2) * 0.12, 0);
      g.stroke();
    }
    if (spot) {
      const sg = g.createRadialGradient(W * 0.8, H * 0.35, 0, W * 0.8, H * 0.35, W * 0.2);
      sg.addColorStop(0, 'rgba(10,10,15,.8)');
      sg.addColorStop(1, 'rgba(10,10,15,0)');
      g.fillStyle = sg;
      g.fillRect(0, 0, W, H);
    }
  });
}

const texCache = {};
function textures(id) {
  if (texCache[id]) return texCache[id];
  const skin = new THREE.CanvasTexture(paintSkin(id));
  skin.colorSpace = THREE.SRGBColorSpace;
  skin.anisotropy = 8;
  skin.wrapT = THREE.RepeatWrapping;
  if (!texCache.scales) {
    texCache.scales = new THREE.CanvasTexture(paintScales());
    texCache.scales.wrapS = texCache.scales.wrapT = THREE.RepeatWrapping;
    texCache.scales.repeat.set(1, 1);
  }
  const fin = new THREE.CanvasTexture(paintFin(LOOK[id].fin, id === 'blg'));
  fin.colorSpace = THREE.SRGBColorSpace;
  texCache[id] = { skin, fin, scales: texCache.scales };
  return texCache[id];
}

// ---------- 꼬리치기 셰이더 ----------
// 머리는 거의 그대로, 꼬리 쪽일수록 크게 옆(z)으로 흔듭니다. uCurl 은 몸 전체를 C 자로 휩니다(퍼덕임).
function bendify(mat, U, part) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uAmp = U.uAmp;
    sh.uniforms.uFreq = U.uFreq;
    sh.uniforms.uCurl = U.uCurl;
    const head = 'uniform float uTime;\nuniform float uAmp;\nuniform float uFreq;\nuniform float uCurl;\n';
    sh.vertexShader = head + sh.vertexShader
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        float fbT = clamp(0.42 - position.x, 0.0, 1.0);
        float fbPh = fbT * 6.0 - uTime * uFreq;
        float fbEnv = 0.15 + fbT * fbT * 1.6;
        float fbSlope = -(cos(fbPh) * 6.0 * uAmp * fbEnv + sin(fbPh) * uAmp * 3.2 * fbT) + uCurl * 3.6 * position.x;
        float fbA = atan(fbSlope);
        float fbC = cos(fbA);
        float fbS = sin(fbA);
        objectNormal = vec3(fbC * objectNormal.x - fbS * objectNormal.z, objectNormal.y, fbS * objectNormal.x + fbC * objectNormal.z);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.z += sin(fbPh) * uAmp * fbEnv + uCurl * (position.x * position.x * 1.8 - 0.06);`);
  };
  return underwater(mat, `fish-bend-v2-${part}`);
}

// ---------- 몸통 ----------
function bodyGeometry(id) {
  const S = SHAPES[id];
  const NU = 56;
  const NV = 36;
  const U_END = 0.89;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= NU; i++) {
    const t = i / NU;
    const u = Math.pow(t, 1.25) * U_END; // 머리 쪽에 점을 더 촘촘히
    const h = lerpTable(S, 'h', u);
    const w = lerpTable(S, 'w', u);
    const c = lerpTable(S, 'c', u);
    for (let j = 0; j <= NV; j++) {
      const v = (j / NV) * TAU;
      const cy = Math.cos(v);
      const sz = Math.sin(v);
      // 배는 조금 평평하게, 등은 둥글게
      const yy = cy >= 0 ? cy : -Math.pow(-cy, 1.15);
      let x = xOf(u);
      // 아래턱이 조금 앞으로 나옵니다(큰입배스)
      if (cy < 0 && u < 0.08) x += S.jaw * (1 - u / 0.08) * Math.pow(-cy, 2);
      pos.push(x, c + h * yy, w * sz * (1 - 0.08 * cy * cy));
      uv.push(u / U_END * 0.92, j / NV);
    }
  }
  const row = NV + 1;
  for (let i = 0; i < NU; i++) {
    for (let j = 0; j < NV; j++) {
      const a = i * row + j;
      const b = a + row;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // 꼬리자루 끝 마개
  const ci = pos.length / 3;
  const uE = U_END;
  pos.push(xOf(uE) - 0.004, lerpTable(S, 'c', uE), 0);
  uv.push(0.92, 0.5);
  const base = NU * row;
  for (let j = 0; j < NV; j++) idx.push(base + j, ci, base + j + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function topAt(S, u) {
  return lerpTable(S, 'c', u) + lerpTable(S, 'h', u);
}
function botAt(S, u) {
  return lerpTable(S, 'c', u) - lerpTable(S, 'h', u) * 0.98;
}

// 2D 외곽선 → 판. uv 는 뿌리(v=0)에서 끝(v=1)으로 갑니다.
function finFromShape(shape, rootAxis = 'y', flip = false) {
  const g = new THREE.ShapeGeometry(shape, 14);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const nx = (p.getX(i) - bb.min.x) / Math.max(1e-6, bb.max.x - bb.min.x);
    const ny = (p.getY(i) - bb.min.y) / Math.max(1e-6, bb.max.y - bb.min.y);
    if (rootAxis === 'y') uv.setXY(i, nx, flip ? 1 - ny : ny);
    else uv.setXY(i, ny, flip ? nx : 1 - nx);
  }
  return g;
}

function dorsalSpiny(S, id) {
  const u0 = id === 'blg' ? 0.26 : 0.3;
  const u1 = id === 'blg' ? 0.55 : 0.56;
  const n = id === 'blg' ? 10 : 9;
  const hMax = id === 'blg' ? 0.075 : 0.085;
  const sh = new THREE.Shape();
  sh.moveTo(xOf(u0), topAt(S, u0) - 0.012);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const u = u0 + (u1 - u0) * t;
    const prof = Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.55) * (1 - 0.45 * Math.max(0, t - 0.55) / 0.45);
    const hgt = hMax * (0.35 + 0.65 * prof);
    sh.lineTo(xOf(u) + 0.004, topAt(S, u) + hgt);
    const um = u0 + (u1 - u0) * Math.min(1, t + 0.5 / n);
    sh.quadraticCurveTo(xOf(um) + 0.01, topAt(S, um) + hgt * 0.45, xOf(um), topAt(S, um) + hgt * 0.5);
  }
  sh.lineTo(xOf(u1), topAt(S, u1) - 0.012);
  sh.closePath();
  return finFromShape(sh);
}
function dorsalSoft(S, id) {
  const u0 = id === 'blg' ? 0.55 : 0.57;
  const u1 = id === 'blg' ? 0.8 : 0.79;
  const hM = id === 'blg' ? 0.09 : 0.075;
  const sh = new THREE.Shape();
  sh.moveTo(xOf(u0), topAt(S, u0) - 0.012);
  sh.lineTo(xOf(u0) - 0.005, topAt(S, u0) + hM * 0.55);
  sh.bezierCurveTo(xOf(u0 + 0.05), topAt(S, u0) + hM * 1.2, xOf(u1 - 0.06), topAt(S, u1) + hM * 1.15, xOf(u1) - 0.01, topAt(S, u1) + hM * 0.25);
  sh.lineTo(xOf(u1), topAt(S, u1) - 0.01);
  sh.closePath();
  return finFromShape(sh);
}
function analFin(S, id) {
  const u0 = id === 'blg' ? 0.58 : 0.62;
  const u1 = id === 'blg' ? 0.8 : 0.78;
  const hM = id === 'blg' ? 0.075 : 0.055;
  const sh = new THREE.Shape();
  sh.moveTo(xOf(u0), botAt(S, u0) + 0.01);
  sh.lineTo(xOf(u0) - 0.008, botAt(S, u0) - hM * 0.7);
  sh.bezierCurveTo(xOf(u0 + 0.05), botAt(S, u0) - hM * 1.25, xOf(u1 - 0.05), botAt(S, u1) - hM * 1.1, xOf(u1) - 0.012, botAt(S, u1) - hM * 0.2);
  sh.lineTo(xOf(u1), botAt(S, u1) + 0.01);
  sh.closePath();
  return finFromShape(sh, 'y', true);
}
function caudalFin(S, id) {
  const ue = 0.86;
  const x0 = xOf(ue);
  const cy = lerpTable(S, 'c', ue);
  const hp = lerpTable(S, 'h', ue) * 0.85;
  const span = id === 'blg' ? 0.13 : 0.125;
  const fork = id === 'blg' ? 0.01 : id === 'smb' ? 0.035 : 0.025;
  const sh = new THREE.Shape();
  sh.moveTo(x0 + 0.02, cy + hp);
  sh.bezierCurveTo(x0 - 0.05, cy + hp + 0.03, x0 - 0.11, cy + span * 0.9, x0 - 0.155, cy + span);
  sh.quadraticCurveTo(x0 - 0.15 + fork, cy + span * 0.35, x0 - 0.15 + fork * 1.4, cy);
  sh.quadraticCurveTo(x0 - 0.15 + fork, cy - span * 0.35, x0 - 0.155, cy - span);
  sh.bezierCurveTo(x0 - 0.11, cy - span * 0.9, x0 - 0.05, cy - hp - 0.03, x0 + 0.02, cy - hp);
  sh.closePath();
  return finFromShape(sh, 'x');
}
function sideFin(len, wid) {
  // 뿌리가 원점, -x(꼬리 쪽)로 뻗는 부채꼴
  const sh = new THREE.Shape();
  sh.moveTo(0, wid * 0.45);
  sh.bezierCurveTo(-len * 0.4, wid * 0.9, -len * 0.95, wid * 0.55, -len, 0);
  sh.bezierCurveTo(-len * 0.9, -wid * 0.45, -len * 0.4, -wid * 0.5, 0, -wid * 0.4);
  sh.closePath();
  return finFromShape(sh, 'x');
}

// 종마다 한 번만 만드는 모양: 몸통, 지느러미 전부(한 덩어리), 홍채 둘, 동공 둘
const geoCache = {};
function fishGeometry(id) {
  if (geoCache[id]) return geoCache[id];
  const S = SHAPES[id];
  const fins = [dorsalSpiny(S, id), dorsalSoft(S, id), analFin(S, id), caudalFin(S, id)];
  // 가슴지느러미(양옆, 뒤로 비스듬히)와 배지느러미
  const uP = 0.25;
  for (const s of [-1, 1]) {
    const g = sideFin(id === 'blg' ? 0.12 : 0.1, 0.05);
    g.applyMatrix4(new THREE.Matrix4()
      .makeTranslation(xOf(uP), lerpTable(S, 'c', uP) - lerpTable(S, 'h', uP) * 0.25, s * lerpTable(S, 'w', uP) * 0.92)
      .multiply(new THREE.Matrix4().makeRotationY(s * 0.45))
      .multiply(new THREE.Matrix4().makeRotationX(s * 0.3)));
    fins.push(g);
    const uV = 0.31;
    const g2 = sideFin(0.075, 0.035);
    g2.applyMatrix4(new THREE.Matrix4()
      .makeTranslation(xOf(uV), botAt(S, uV) + 0.006, s * 0.012)
      .multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2 + s * 0.55))
      .multiply(new THREE.Matrix4().makeRotationZ(-0.35)));
    fins.push(g2);
  }
  const irises = [];
  const pupils = [];
  const ue = S.eye;
  for (const s of [-1, 1]) {
    const ex = xOf(ue);
    const ey = lerpTable(S, 'c', ue) + lerpTable(S, 'h', ue) * 0.38;
    const ez = s * lerpTable(S, 'w', ue) * 0.82;
    const eg = new THREE.SphereGeometry(S.eyeR, 18, 14);
    eg.scale(1, 1, 0.55);
    eg.translate(ex, ey, ez);
    irises.push(eg);
    const pg = new THREE.SphereGeometry(S.eyeR * 0.55, 14, 10);
    pg.scale(1, 1, 0.5);
    pg.translate(ex + 0.002, ey, ez + s * S.eyeR * 0.36);
    pupils.push(pg);
  }
  geoCache[id] = { body: bodyGeometry(id), fins: mergeGeometries(fins), iris: mergeGeometries(irises), pupil: mergeGeometries(pupils) };
  return geoCache[id];
}

// 한 마리 만들기. 돌려준 group 의 크기 1 = 몸길이 1m 입니다(바깥에서 길이만큼 키웁니다).
// 재질은 마리마다 따로(꼬리치기 값이 마리마다 다름), 모양은 종끼리 같이 씁니다. 그리기 4번.
export function makeFish(species) {
  const id = SHAPES[species] ? species : 'lmb';
  const L = LOOK[id];
  const T = textures(id);
  const G = fishGeometry(id);
  const U = { uTime: { value: 0 }, uAmp: { value: 0.02 }, uFreq: { value: 9 }, uCurl: { value: 0 } };
  const group = new THREE.Group();

  const skin = bendify(new THREE.MeshPhysicalMaterial({
    map: T.skin, roughness: 0.45, metalness: 0.05, clearcoat: 0.45, clearcoatRoughness: 0.25, envMapIntensity: 0.55,
    bumpMap: T.scales, bumpScale: 0.6, sheen: 0.18, sheenColor: new THREE.Color(id === 'blg' ? '#7aa0ff' : '#e8f0c0'), sheenRoughness: 0.5
  }), U, 'skin');
  const body = new THREE.Mesh(G.body, skin);
  group.add(body);
  const finMat = bendify(new THREE.MeshStandardMaterial({ map: T.fin, transparent: true, side: THREE.DoubleSide, roughness: 0.55, alphaTest: 0.05, depthWrite: true }), U, 'fin');
  group.add(new THREE.Mesh(G.fins, finMat));
  // 눈: 홍채(유광) + 동공
  const eyeMat = bendify(new THREE.MeshPhysicalMaterial({ color: L.eye, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 }), U, 'eye');
  const pupilMat = bendify(new THREE.MeshPhysicalMaterial({ color: '#050505', roughness: 0.1, clearcoat: 1 }), U, 'eye');
  group.add(new THREE.Mesh(G.iris, eyeMat), new THREE.Mesh(G.pupil, pupilMat));
  group.userData.uniforms = U;
  group.userData.species = id;
  // 버릴 때 재질만 내립니다(모양과 무늬는 같은 종이 같이 씁니다).
  group.userData.dispose = () => { for (const m of [skin, finMat, eyeMat, pupilMat]) m.dispose(); };
  return group;
}

// 물 위 그림자용 실루엣(위에서 본 모양)
export function fishShadowTexture() {
  const c = cv(256, 128, (g, W, H) => {
    g.filter = 'blur(6px)';
    g.fillStyle = 'rgba(8,14,12,0.9)';
    g.beginPath();
    g.moveTo(W * 0.96, H * 0.5);
    g.bezierCurveTo(W * 0.85, H * 0.18, W * 0.45, H * 0.2, W * 0.18, H * 0.42);
    g.lineTo(W * 0.04, H * 0.18);
    g.lineTo(W * 0.08, H * 0.5);
    g.lineTo(W * 0.04, H * 0.82);
    g.lineTo(W * 0.18, H * 0.58);
    g.bezierCurveTo(W * 0.45, H * 0.8, W * 0.85, H * 0.82, W * 0.96, H * 0.5);
    g.fill();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
