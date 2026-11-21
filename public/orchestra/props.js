// 오케스트라 악기·의자·보면대 3D 모형.
// 악기마다 실제 치수(미터)에 가깝게, 부품(현·줄감개·밸브·페달…)까지 절차적으로 만듭니다.
// 재질별로 지오메트리를 합쳐 악기 하나가 메시 3~6개가 되게 하고, 같은 악기는 한 번 만든 것을 clone() 해서 지오메트리를 같이 씁니다.
// 좌표 약속은 hall.js 의 자세·IK 코드와 맞춥니다(바이올린: 몸통이 XY 평면·목이 +y·앞판이 +z, 트럼펫: +z 가 벨 쪽 …).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const R = Math.PI / 180;
const V2 = (x, y) => new THREE.Vector2(x, y);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rnd = (() => { let s = 4711; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })();

// ───────── 지오메트리 모으기 ─────────
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
function xf(p, r, s) {
  _e.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0, 'XYZ');
  _q.setFromEuler(_e);
  const sc = s == null ? V3(1, 1, 1) : typeof s === 'number' ? V3(s, s, s) : V3(s[0], s[1], s[2]);
  return new THREE.Matrix4().compose(p ? V3(p[0], p[1], p[2]) : V3(), _q, sc);
}
class Kit {
  constructor() { this.bins = new Map(); }
  // geo 는 이 호출이 가져갑니다(다시 쓰지 마세요). o = { p:[x,y,z], r:[rx,ry,rz], s:숫자|[sx,sy,sz], m:Matrix4 }
  add(mat, geo, o) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.morphAttributes = {};
    if (o) g.applyMatrix4(o.m || xf(o.p, o.r, o.s));
    if (!this.bins.has(mat)) this.bins.set(mat, []);
    this.bins.get(mat).push(g);
    return this;
  }
  // 다른 Kit 을 통째로 옮겨 붙입니다
  merge(kit, o) {
    const m = o ? (o.m || xf(o.p, o.r, o.s)) : null;
    for (const [mat, list] of kit.bins) for (const g of list) { const c = g.clone(); if (m) c.applyMatrix4(m); if (!this.bins.has(mat)) this.bins.set(mat, []); this.bins.get(mat).push(c); }
    return this;
  }
  build({ shadow = true, receive = false } = {}) {
    const grp = new THREE.Group();
    for (const [mat, list] of this.bins) {
      const mesh = new THREE.Mesh(mergeGeometries(list, false), mat);
      mesh.castShadow = shadow;
      mesh.receiveShadow = receive;
      grp.add(mesh);
    }
    return grp;
  }
}
const cyl = (r1, r2, h, n = 12, open = false) => new THREE.CylinderGeometry(r1, r2, h, n, 1, open);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const sph = (r, a = 14, b = 10) => new THREE.SphereGeometry(r, a, b);
const torus = (r, t, a = 8, b = 28, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, a, b, arc);
const lathe = (pts, n = 24) => new THREE.LatheGeometry(pts.map(([r, y]) => V2(r, y)), n);
// 점들을 지나는 관. 호(arc)는 촘촘히 찍어 주면 둥글게 나옵니다
function tube(pts, radius, rs = 10, closed = false, per = 5) {
  const c = new THREE.CatmullRomCurve3(pts.map((p) => (p.isVector3 ? p : V3(p[0], p[1], p[2]))), closed, 'centripetal');
  return new THREE.TubeGeometry(c, Math.max(8, pts.length * per), radius, rs, closed);
}
// 평면 안의 호를 점으로: 중심 c, 두 축 u·v(단위 벡터 배열), 반지름, 각도(도)
function arcPts(c, u, v, r, a0, a1, n = 10) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = lerp(a0, a1, i / n) * R;
    out.push(V3(c[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * r, c[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * r, c[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * r));
  }
  return out;
}
// 두 점 사이 막대(원기둥)
function rod(a, b, r1, r2 = r1, n = 8) {
  const A = V3(a[0], a[1], a[2]), B = V3(b[0], b[1], b[2]);
  const d = B.clone().sub(A);
  const g = cyl(r2, r1, d.length(), n);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone().normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
// 축 방향이 dir 인 회전체(벨 등)를 start 에 세웁니다. 프로파일은 [반지름, 축 방향 거리]
function latheAlong(profile, start, dir, n = 28) {
  const g = lathe(profile, n);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), V3(dir[0], dir[1], dir[2]).normalize()));
  g.translate(start[0], start[1], start[2]);
  return g;
}

// 면 방향 맞추기: test(법선, 위치) 의 평균이 음수면 삼각형을 뒤집습니다(직접 만든 면은 감는 방향을 손으로 맞추지 않아도 되게)
const _n = new THREE.Vector3(), _p = new THREE.Vector3();
function orient(g, test) {
  g.computeVertexNormals();
  const P = g.attributes.position, N = g.attributes.normal;
  let acc = 0;
  for (let i = 0; i < P.count; i++) acc += test(_n.fromBufferAttribute(N, i), _p.fromBufferAttribute(P, i));
  if (acc < 0) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    g.index.needsUpdate = true;
    g.computeVertexNormals();
  }
  return g;
}

// ───────── 재질 ─────────
function canvasTex(w, h, draw, repeat) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
// 가문비나무 앞판: 길이 방향으로 곧게 뻗은 촘촘한 결
const spruceTex = () => canvasTex(256, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, w, 0);
  gr.addColorStop(0, '#b0561c'); gr.addColorStop(0.5, '#c8742c'); gr.addColorStop(1, '#b0561c');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 2) { g.fillStyle = `rgba(70,24,6,${0.1 + rnd() * 0.22})`; g.fillRect(x + rnd(), 0, 0.8 + rnd() * 0.6, h); }
  const sh = g.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, 170);
  sh.addColorStop(0, 'rgba(255,190,90,.22)'); sh.addColorStop(1, 'rgba(60,14,0,.38)');
  g.fillStyle = sh; g.fillRect(0, 0, w, h);
});
// 단풍나무 뒤판·옆판: 가로로 일렁이는 호랑이 무늬
const mapleTex = () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#a04a18'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 5) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '255,170,80' : '50,14,2'},${0.1 + rnd() * 0.2})`;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + y) * 2.2);
    g.lineTo(w, y + 3 + rnd() * 2); g.lineTo(0, y + 3 + rnd() * 2);
    g.fill();
  }
});
// 악보: 오선 네 단과 음표
const scoreTex = () => canvasTex(512, 360, (g, w, h) => {
  g.fillStyle = '#efe7d2'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(120,100,60,.10)'; g.fillRect(w / 2 - 3, 0, 6, h); // 가운데 접힌 자국
  for (const x0 of [22, w / 2 + 14]) {
    const pw = w / 2 - 36;
    g.fillStyle = '#2a2622'; g.fillRect(x0 + pw * 0.2, 16, pw * 0.6, 5);
    for (let s = 0; s < 5; s++) {
      const y0 = 46 + s * 62;
      g.strokeStyle = '#3b352e'; g.lineWidth = 1;
      for (let l = 0; l < 5; l++) { g.beginPath(); g.moveTo(x0, y0 + l * 7); g.lineTo(x0 + pw, y0 + l * 7); g.stroke(); }
      g.lineWidth = 1.4;
      for (const bx of [0, 0.27, 0.52, 0.76, 1]) { g.beginPath(); g.moveTo(x0 + pw * bx, y0); g.lineTo(x0 + pw * bx, y0 + 28); g.stroke(); }
      g.fillStyle = '#1d1a17';
      let x = x0 + 12;
      while (x < x0 + pw - 8) {
        const ny = y0 - 4 + Math.floor(rnd() * 10) * 3.5;
        g.beginPath(); g.ellipse(x, ny, 4.2, 3, -0.35, 0, Math.PI * 2); g.fill();
        const up = ny > y0 + 14;
        g.fillRect(up ? x + 3.2 : x - 4.2, up ? ny - 22 : ny, 1.3, 22);
        if (rnd() < 0.35) g.fillRect(up ? x + 3.2 : x - 4.2, up ? ny - 22 : ny + 20, 9, 2.4);
        x += 11 + rnd() * 12;
      }
    }
  }
});

let MATS = null;
export function propMaterials() {
  if (MATS) return MATS;
  const P = THREE.MeshPhysicalMaterial, S = THREE.MeshStandardMaterial;
  MATS = {
    top: new P({ map: spruceTex(), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.18 }),
    back: new P({ map: mapleTex(), roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.2 }),
    varnish: new P({ color: 0x8a3a12, roughness: 0.34, clearcoat: 0.9, clearcoatRoughness: 0.22 }),
    maple: new S({ color: 0xc79a5c, roughness: 0.55 }),
    ebony: new S({ color: 0x0c0a0a, roughness: 0.3, envMapIntensity: 1.2 }),
    dark: new S({ color: 0x050404, roughness: 0.9 }),
    steel: new S({ color: 0xd6d9df, metalness: 1, roughness: 0.3, envMapIntensity: 1.5 }),
    gut: new S({ color: 0xe9d9b0, roughness: 0.5 }),
    pernambuco: new P({ color: 0x5a2410, roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.25 }),
    hair: new S({ color: 0xefe6cf, roughness: 0.8 }),
    pearl: new P({ color: 0xf2efe6, roughness: 0.18, clearcoat: 1, iridescence: 0.6, iridescenceIOR: 1.4 }),
    brass: new S({ color: 0xd8a437, metalness: 1, roughness: 0.2, envMapIntensity: 1.7 }),
    brassBell: new S({ color: 0xd8a437, metalness: 1, roughness: 0.2, envMapIntensity: 1.7, side: THREE.DoubleSide }),
    brassDark: new S({ color: 0xa87a22, metalness: 1, roughness: 0.34, envMapIntensity: 1.3 }),
    silver: new S({ color: 0xe2e6ec, metalness: 1, roughness: 0.16, envMapIntensity: 1.7 }),
    nickel: new S({ color: 0xb9bcc2, metalness: 1, roughness: 0.3, envMapIntensity: 1.4 }),
    copper: new P({ color: 0xd07a44, metalness: 1, roughness: 0.24, clearcoat: 0.5, clearcoatRoughness: 0.25, envMapIntensity: 2.4 }),
    chrome: new S({ color: 0xf0f2f5, metalness: 1, roughness: 0.1, envMapIntensity: 1.8 }),
    bronze: new S({ color: 0xc9a24a, metalness: 1, roughness: 0.32, envMapIntensity: 1.3 }),
    iron: new S({ color: 0xb98f3c, metalness: 0.9, roughness: 0.45 }),
    lacquer: new P({ color: 0x050506, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.6 }),
    satin: new S({ color: 0x121114, roughness: 0.55 }),
    ivory: new S({ color: 0xf5f1e6, roughness: 0.32 }),
    felt: new S({ color: 0x9a1420, roughness: 0.95 }),
    feltW: new S({ color: 0xe9e4d6, roughness: 1 }),
    head: new P({ color: 0xefe8d4, roughness: 0.55, sheen: 0.4, sheenRoughness: 0.6 }),
    shellRed: new P({ color: 0x5c0d16, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 }),
    shellWood: new P({ color: 0x6a3312, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
    gold: new S({ color: 0xcfa24a, metalness: 1, roughness: 0.3, envMapIntensity: 1.4 }),
    soundboard: new S({ color: 0xc89a55, roughness: 0.5 }),
    stringW: new S({ color: 0xf2ead6, roughness: 0.5 }),
    stringR: new S({ color: 0xb3261e, roughness: 0.5 }),
    stringB: new S({ color: 0x1c2a52, roughness: 0.5 }),
    wire: new S({ color: 0xb98a55, metalness: 1, roughness: 0.4 }),
    frame: new S({ color: 0x0e0e11, metalness: 0.7, roughness: 0.35 }),
    fabric: new S({ color: 0x15131a, roughness: 0.96 }),
    paper: new S({ map: scoreTex(), roughness: 0.95 }),
    cork: new S({ color: 0xb98958, roughness: 0.9 }),
    batonW: new S({ color: 0xfbf8ee, roughness: 0.35, emissive: 0x3a3833 }),
    rubber: new S({ color: 0x101012, roughness: 0.85 }),
    castanet: new P({ color: 0x3a1a0c, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
  };
  return MATS;
}

// ───────── 현악기 ─────────
// 바이올린 몸통 반쪽 윤곽(x ≥ 0, 위 → 아래). 위·아래 울림통 사이 C자 허리와 뾰족한 모서리가 있습니다.
function violinOutline(shoulder = 1) {
  const seg = (pts, n) => new THREE.SplineCurve(pts.map(([x, y]) => V2(x, y))).getPoints(n);
  const up = seg([[0, 0.181], [0.034 * shoulder, 0.179], [0.064 * shoulder, 0.166], [0.081, 0.142], [0.0855, 0.113], [0.081, 0.088], [0.0835, 0.07]], 18);
  const cb = seg([[0.0835, 0.07], [0.066, 0.056], [0.057, 0.026], [0.056, -0.006], [0.063, -0.038], [0.0905, -0.057]], 14);
  const lo = seg([[0.0905, -0.057], [0.0925, -0.076], [0.1, -0.1], [0.1035, -0.13], [0.096, -0.16], [0.071, -0.182], [0.036, -0.19], [0, -0.192]], 20);
  return [...up, ...cb.slice(1), ...lo.slice(1)];
}
// 볼록한 앞·뒤판: 윤곽을 가운데 축 쪽으로 좁혀 가며 격자를 만들고 가운데를 부풀립니다
function archedPlate(outline, z0, archH, sign, grow = 1.025) {
  const M = 9, cols = M * 2 + 1, n = outline.length;
  const pos = new Float32Array(n * cols * 3), uv = new Float32Array(n * cols * 2);
  for (let i = 0; i < n; i++) {
    const { x: xb, y } = outline[i];
    const endFall = clamp(xb / 0.05, 0, 1);
    for (let j = 0; j < cols; j++) {
      const s = (j - M) / M, a = Math.abs(s);
      const arch = archH * endFall * (a > 0.93 ? 0.06 * (1 - a) / 0.07 : 0.06 + 0.94 * Math.pow(Math.cos((a / 0.93) * Math.PI / 2), 1.5));
      const k = (i * cols + j) * 3;
      pos[k] = xb * grow * s; pos[k + 1] = y * (y > 0 ? 1 + (grow - 1) * 0.6 : 1 + (grow - 1) * 0.6); pos[k + 2] = z0 + sign * arch;
      uv[(i * cols + j) * 2] = 0.5 + (xb * s) / 0.22; uv[(i * cols + j) * 2 + 1] = (y + 0.2) / 0.4;
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < cols - 1; j++) {
    const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
    if (sign > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return orient(g, (nn) => nn.z * sign);
}
// 앞판 위 (x, y) 자리의 높이(브리지·f홀을 올려놓을 때)
function archAt(outline, x, y, z0, archH) {
  let best = outline[0];
  for (const p of outline) if (Math.abs(p.y - y) < Math.abs(best.y - y)) best = p;
  const a = clamp(Math.abs(x) / Math.max(1e-4, best.x), 0, 1);
  return z0 + archH * clamp(best.x / 0.05, 0, 1) * (a > 0.93 ? 0.06 * (1 - a) / 0.07 : 0.06 + 0.94 * Math.pow(Math.cos((a / 0.93) * Math.PI / 2), 1.5));
}
function ribStrip(outline, z0, z1) {
  // 닫힌 윤곽(오른쪽 반 + 왼쪽 반)을 따라 세운 옆판
  const loop = [...outline, ...outline.slice(1, -1).reverse().map((p) => V2(-p.x, p.y))];
  const n = loop.length, pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) { const p = loop[i % n]; pos.push(p.x, p.y, z0, p.x, p.y, z1); uv.push(i / n * 6, 0, i / n * 6, 1); }
  for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return orient(g, (nn, pp) => nn.x * pp.x + nn.y * (pp.y * 0.3));
}
const STRING_KINDS = {
  violin: { scale: 1, rib: 0.03, arch: 0.014, bridge: 0.032, chin: true, pin: 0, shoulder: 1 },
  viola: { scale: 1.14, rib: 0.033, arch: 0.014, bridge: 0.033, chin: true, pin: 0, shoulder: 1 },
  cello: { scale: 2.3, rib: 0.05, arch: 0.016, bridge: 0.04, chin: false, pin: 0.115, shoulder: 0.96 },
  bass: { scale: 2.9, rib: 0.066, arch: 0.015, bridge: 0.05, chin: false, pin: 0.05, shoulder: 0.8, gears: true },
};
function buildStringInstrument(kind) {
  const M = propMaterials(), K = new Kit(), c = STRING_KINDS[kind];
  const ol = violinOutline(c.shoulder);
  const zr = c.rib / 2, zt = zr, archH = c.arch;
  K.add(M.top, archedPlate(ol, zt, archH, 1));
  K.add(M.back, archedPlate(ol, -zt, archH * 0.9, -1));
  K.add(M.back, ribStrip(ol, -zr, zr));
  // 가장자리 테두리와 퍼플링(검은 줄)
  const loop = [...ol, ...ol.slice(1, -1).reverse().map((p) => V2(-p.x, p.y))];
  K.add(M.back, tube(loop.map((p) => V3(p.x * 1.025, p.y * 1.015, zt + 0.0006)), 0.0019, 4, true, 1));
  K.add(M.back, tube(loop.map((p) => V3(p.x * 1.025, p.y * 1.015, -zt - 0.0006)), 0.0019, 4, true, 1));
  K.add(M.ebony, tube(loop.map((p) => V3(p.x * 0.955, p.y * 0.972, zt + 0.0016)), 0.0007, 3, true, 1));
  // f홀: S자로 흐르는 얇은 구멍과 양 끝 동그란 눈
  for (const sd of [-1, 1]) {
    const pts = [[0.043, 0.03], [0.036, 0.022], [0.0345, 0.006], [0.0385, -0.012], [0.043, -0.03], [0.041, -0.045], [0.0335, -0.05]].map(([x, y]) => V3(sd * x, y, archAt(ol, x, y, zt, archH) + 0.0008));
    const f = tube(pts, 0.0026, 6, false, 6);
    K.add(M.ebony, f);
    for (const [x, y, r] of [[0.0445, 0.031, 0.0034], [0.0322, -0.0505, 0.0043]]) K.add(M.ebony, sph(r, 8, 6), { p: [sd * x, y, archAt(ol, x, y, zt, archH) + 0.0004], s: [1, 1, 0.3] });
  }
  // 브리지: 단풍나무 얇은 판(가운데가 높은 아치)
  const zb = archAt(ol, 0, -0.015, zt, archH) - 0.0005, hb = c.bridge;
  {
    const s = new THREE.Shape();
    s.moveTo(-0.021, 0); s.lineTo(-0.0205, 0.005); s.quadraticCurveTo(-0.012, 0.007, -0.0185, 0.014);
    s.quadraticCurveTo(-0.019, hb * 0.82, -0.0125, hb * 0.93); s.quadraticCurveTo(0, hb * 1.06, 0.0125, hb * 0.93);
    s.quadraticCurveTo(0.019, hb * 0.82, 0.0185, 0.014); s.quadraticCurveTo(0.012, 0.007, 0.0205, 0.005); s.lineTo(0.021, 0);
    s.lineTo(0.012, 0); s.quadraticCurveTo(0, 0.006, -0.012, 0); s.closePath();
    const hole = new THREE.Path(); hole.absellipse(0, hb * 0.52, 0.0055, 0.0045, 0, Math.PI * 2, true); s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.0032, bevelEnabled: false, curveSegments: 6 });
    g.translate(0, 0, -0.0016);
    K.add(M.maple, g, { p: [0, -0.015, zb], r: [Math.PI / 2, 0, 0] });
  }
  const zBridgeTop = zb + hb * 0.98;
  // 목·지판·줄감개집·소용돌이
  const yNut = 0.312, yHeel = 0.181, zNut = zt + 0.018, zFbEnd = zBridgeTop - 0.0095;
  K.add(M.back, rod([0, yHeel - 0.004, zt - 0.004], [0, yNut, zNut - 0.0115], 0.0125, 0.0105, 12), { s: [1, 1, 1] });
  K.add(M.back, box(0.03, 0.03, c.rib * 0.9), { p: [0, yHeel + 0.008, 0] }); // 목 뿌리(힐)
  {
    // 지판: 너트에서 몸통 쪽으로 넓어지는 흑단 판
    const len = yNut - 0.04, g = box(1, len, 0.0056, 1, 1, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = 0.5 - p.getY(i) / len; // 0 = 너트, 1 = 끝
      p.setX(i, p.getX(i) * lerp(0.0235, 0.042, t));
      p.setZ(i, p.getZ(i) + lerp(zNut, zFbEnd, t) - 0.0028 + (Math.abs(p.getX(i)) > 0.01 ? -0.0012 : 0));
    }
    g.translate(0, yNut - len / 2, 0);
    g.computeVertexNormals();
    K.add(M.ebony, g);
    K.add(M.maple, box(0.0245, 0.004, 0.0045), { p: [0, yNut + 0.002, zNut + 0.0005] }); // 너트
  }
  // 줄감개집: 뒤로 살짝 젖혀진 홈통
  const pegY0 = yNut + 0.006, pegY1 = yNut + 0.07;
  for (const sd of [-1, 1]) K.add(M.back, box(0.0045, pegY1 - pegY0 + 0.006, 0.02), { p: [sd * 0.0098, (pegY0 + pegY1) / 2, zNut - 0.014], r: [-0.12, 0, 0] });
  K.add(M.back, box(0.024, pegY1 - pegY0 + 0.006, 0.004), { p: [0, (pegY0 + pegY1) / 2, zNut - 0.024], r: [-0.12, 0, 0] });
  for (let i = 0; i < 4; i++) {
    const y = pegY0 + 0.007 + i * 0.0165, sd = i % 2 ? 1 : -1, z = zNut - 0.012 - i * 0.002;
    if (c.gears) {
      // 콘트라베이스: 놋쇠 기어와 나비 손잡이
      K.add(M.brass, cyl(0.0065, 0.0065, 0.004, 12), { p: [sd * 0.0135, y, z], r: [0, 0, Math.PI / 2] });
      K.add(M.brass, rod([sd * 0.0135, y, z], [sd * 0.0135, y, z - 0.022], 0.0016));
      K.add(M.brass, sph(1, 8, 6), { p: [sd * 0.0135, y, z - 0.026], s: [0.002, 0.007, 0.006] });
    } else {
      K.add(M.ebony, cyl(0.0026, 0.0034, 0.044, 8), { p: [sd * 0.008, y, z], r: [0, 0, Math.PI / 2] });
      K.add(M.ebony, sph(1, 10, 8), { p: [sd * 0.0325, y, z], s: [0.0035, 0.0105, 0.0078] });
    }
  }
  {
    // 소용돌이(스크롤): 안으로 말려 들어가는 나선 띠
    const pts = [];
    for (let i = 0; i <= 26; i++) { const a = -0.5 + (i / 26) * Math.PI * 3.4, r = lerp(0.0195, 0.004, Math.pow(i / 26, 0.8)); pts.push(V3(0, pegY1 + 0.014 + Math.sin(a) * r, zNut - 0.022 - Math.cos(a) * r)); }
    K.add(M.back, tube(pts, 0.0052, 8, false, 3), { s: [2.3, 1, 1] });
    K.add(M.back, cyl(0.0048, 0.0048, 0.031, 10), { p: [0, pegY1 + 0.0148, zNut - 0.0225], r: [0, 0, Math.PI / 2] });
  }
  // 줄걸이(테일피스)·턱받침·끝핀
  {
    const s = new THREE.Shape();
    s.moveTo(-0.0195, 0); s.quadraticCurveTo(0, 0.008, 0.0195, 0); s.lineTo(0.0085, -0.105); s.quadraticCurveTo(0, -0.112, -0.0085, -0.105); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.005, bevelEnabled: true, bevelThickness: 0.0018, bevelSize: 0.0018, bevelSegments: 2, curveSegments: 6 });
    K.add(M.ebony, g, { p: [0, -0.082, zb + hb * 0.5], r: [-0.06, 0, 0] });
    K.add(M.ebony, rod([0, -0.187, zb + hb * 0.5 - 0.004], [0, -0.196, zt * 0.2], 0.0012, 0.0012, 5));
    K.add(M.ebony, cyl(0.006, 0.004, 0.012, 10), { p: [0, -0.197, 0] });
    if (!c.gears) for (let i = 0; i < 4; i++) K.add(M.steel, cyl(0.0016, 0.0016, 0.007, 6), { p: [(i - 1.5) * 0.0088, -0.09, zb + hb * 0.5 + 0.0085], r: [Math.PI / 2, 0, 0] });
  }
  if (c.chin) {
    K.add(M.ebony, sph(1, 16, 10), { p: [-0.056, -0.152, zt + 0.013], s: [0.04, 0.034, 0.009] });
    for (const dz of [0]) K.add(M.steel, rod([-0.062, -0.189, zt + 0.008], [-0.062, -0.189, -zt - 0.004], 0.0014));
  }
  if (c.pin) {
    K.add(M.steel, rod([0, -0.198, 0], [0, -0.198 - c.pin, 0], 0.0022, 0.0016));
    K.add(M.rubber, sph(0.004, 8, 6), { p: [0, -0.198 - c.pin, 0] });
  }
  // 현 네 줄: 너트 → 브리지 → 줄걸이
  for (let i = 0; i < 4; i++) {
    const u = (i - 1.5) / 1.5, xN = u * 0.0085, xB = u * 0.017, crown = (1 - u * u) * 0.0022;
    const r = lerp(0.00085, 0.00045, i / 3) * (c.scale > 2 ? 0.75 : 1);
    K.add(M.steel, rod([xN, yNut + 0.003, zNut + 0.0036], [xB, -0.015, zBridgeTop + crown - 0.0005], r, r, 5));
    K.add(M.steel, rod([xB, -0.015, zBridgeTop + crown - 0.0005], [u * 0.013, -0.084, zb + hb * 0.5 + 0.007], r, r, 5));
    K.add(M.steel, rod([xN, yNut + 0.003, zNut + 0.0036], [(i % 2 ? 1 : -1) * 0.004, pegY0 + 0.007 + i * 0.0165, zNut - 0.011 - i * 0.002], r, r, 5));
  }
  const g = K.build({ shadow: c.scale > 2 }); // 손에 든 바이올린·비올라는 그림자를 따로 드리우지 않습니다(몸 그림자에 묻힘)
  g.scale.setScalar(c.scale);
  g.userData.contact = V3(0, 0.014, zBridgeTop + 0.002); // 활이 닿는 자리(지판 끝과 브리지 사이)
  g.userData.neck = V3(0, 0.24, zNut - 0.012);
  return g;
}
function buildBow(len = 0.72) {
  const M = propMaterials(), K = new Kit(), h = len / 2;
  // 활대: 가운데가 살짝 안으로 휜 팔각 막대, 끝(팁)과 손잡이(프로그)
  const pts = [];
  for (let i = 0; i <= 12; i++) { const u = i / 12; pts.push(V3(lerp(-h, h, u), -Math.sin(u * Math.PI) * 0.007, 0)); }
  K.add(M.pernambuco, tube(pts, 0.0036, 6, false, 3));
  K.add(M.pernambuco, box(0.022, 0.02, 0.008), { p: [h - 0.007, -0.011, 0], r: [0, 0, 0.25] }); // 팁
  K.add(M.ivory, box(0.02, 0.0025, 0.0085), { p: [h - 0.008, -0.0215, 0] });
  K.add(M.ebony, box(0.046, 0.019, 0.013), { p: [-h + 0.05, -0.0125, 0] }); // 프로그
  K.add(M.pearl, cyl(0.0042, 0.0042, 0.0135, 12), { p: [-h + 0.05, -0.012, 0], r: [Math.PI / 2, 0, 0] });
  K.add(M.silver, box(0.012, 0.008, 0.0135), { p: [-h + 0.031, -0.018, 0] }); // 페룰
  K.add(M.silver, cyl(0.0045, 0.0045, 0.016, 8), { p: [-h + 0.004, 0, 0], r: [0, 0, Math.PI / 2] }); // 나사
  K.add(M.silver, cyl(0.0041, 0.0041, 0.05, 8), { p: [-h + 0.105, 0, 0], r: [0, 0, Math.PI / 2] }); // 은선 감개
  K.add(M.hair, box(len - 0.062, 0.0012, 0.0092), { p: [0.012, -0.0225, 0] });
  const g = K.build({ shadow: false });
  g.userData.len = len;
  return g;
}

// ───────── 금관 ─────────
function mouthpiece(K, M, z0, mat = M.silver, s = 1) {
  K.add(mat, lathe([[0.0001, 0], [0.0088 * s, 0], [0.0135 * s, 0.002], [0.0142 * s, 0.006], [0.0128 * s, 0.012], [0.009 * s, 0.022], [0.006 * s, 0.032], [0.0052 * s, 0.05], [0.0056 * s, 0.078]], 16), { p: [0, 0, z0], r: [Math.PI / 2, 0, 0] });
}
function buildTrumpet() {
  const M = propMaterials(), K = new Kit();
  const y1 = 0.02, y2 = -0.075, xl = 0.018, xb = -0.018, rT = 0.0058;
  mouthpiece(K, M, -0.28);
  K.add(M.brass, cyl(0.0072, 0.0072, 0.03, 12), { p: [0.006, y1 * 0.6, -0.2], r: [Math.PI / 2, 0, 0] }); // 리시버
  // 리드파이프 → 앞쪽 주 조율관(U) → 아래 관 → 3번 밸브
  K.add(M.brass, tube([[0, 0.004, -0.215], [0.008, 0.012, -0.18], [xl, y1, -0.14], [xl, y1, 0.0], [xl, y1, 0.105],
    ...arcPts([xl, (y1 + y2) / 2, 0.105], [0, 0, 1], [0, 1, 0], (y1 - y2) / 2, 90, -90, 12),
    [xl, y2, 0.06], [0.01, y2 + 0.012, 0.03], [0, y2 + 0.02, 0.014]], rT, 10));
  K.add(M.silver, cyl(rT + 0.0012, rT + 0.0012, 0.05, 12), { p: [xl, y1, 0.078], r: [Math.PI / 2, 0, 0] });
  K.add(M.silver, cyl(rT + 0.0012, rT + 0.0012, 0.04, 12), { p: [xl, y2, 0.085], r: [Math.PI / 2, 0, 0] });
  // 밸브 3개: 몸통·위아래 뚜껑·누름대·자개 단추
  const vz = [-0.066, -0.028, 0.01];
  for (const z of vz) {
    K.add(M.brass, cyl(0.0098, 0.0098, 0.112, 14), { p: [0, -0.037, z] });
    K.add(M.silver, cyl(0.0108, 0.0108, 0.009, 14), { p: [0, 0.0235, z] });
    K.add(M.silver, cyl(0.0106, 0.0092, 0.011, 14), { p: [0, -0.0985, z] });
    K.add(M.silver, cyl(0.0022, 0.0022, 0.03, 6), { p: [0, 0.042, z] });
    K.add(M.silver, cyl(0.0076, 0.0076, 0.004, 14), { p: [0, 0.058, z] });
    K.add(M.pearl, cyl(0.0062, 0.0062, 0.0016, 14), { p: [0, 0.0608, z] });
  }
  for (const y of [-0.03, -0.062]) K.add(M.brass, cyl(0.0042, 0.0042, 0.076, 8), { p: [0, y, -0.028], r: [Math.PI / 2, 0, 0] });
  // 벨 관: 1번 밸브 → 뒤쪽 굽은 관 → 위로 올라와 앞으로 → 벨
  K.add(M.brass, tube([[0, y2 + 0.012, -0.076], [-0.008, y2, -0.1], [xb, y2, -0.13],
    ...arcPts([xb, (y1 + y2) / 2, -0.15], [0, 0, -1], [0, -1, 0], (y1 - y2) / 2, 90, -90, 12),
    [xb, y1, -0.08], [xb, y1, 0.06]], rT, 10));
  K.add(M.brassBell, latheAlong([[rT, 0], [0.0066, 0.05], [0.0082, 0.1], [0.011, 0.14], [0.016, 0.172], [0.025, 0.196], [0.039, 0.212], [0.054, 0.221], [0.063, 0.2245], [0.0645, 0.2262], [0.063, 0.2272]], [xb, y1, 0.054], [0, 0, 1], 32));
  // 밸브 조율관: 1번(뒤로), 3번(앞으로, 고리), 2번(옆으로)
  const slide = (z0, z1, x) => {
    const zc = z1 - Math.sign(z1 - z0) * 0.011;
    K.add(M.brass, tube([[x * 0.4, -0.022, z0], [x, -0.022, z0 + (z1 - z0) * 0.3], [x, -0.022, zc],
      ...arcPts([x, -0.033, zc], [0, 0, Math.sign(z1 - z0)], [0, 1, 0], 0.011, 90, -90, 8).slice(1),
      [x, -0.044, z0 + (z1 - z0) * 0.3], [x * 0.4, -0.044, z0]], 0.0044, 8));
  };
  slide(vz[0], -0.135, 0.02);
  slide(vz[2], 0.1, -0.021);
  K.add(M.brass, torus(0.0095, 0.0016, 6, 16), { p: [-0.021, -0.011, 0.07], r: [0, Math.PI / 2, 0] });
  K.add(M.brass, tube([[-0.006, -0.03, vz[1]], [-0.03, -0.03, vz[1]], ...arcPts([-0.03, -0.04, vz[1]], [-1, 0, 0], [0, 1, 0], 0.01, 90, -90, 6).slice(1), [-0.006, -0.05, vz[1]]], 0.004, 8));
  // 버팀대·새끼손가락 고리·엄지 고리·물빼기
  for (const z of [-0.125, 0.068]) K.add(M.brass, rod([xl, y1, z], [xb, y1, z], 0.0024));
  K.add(M.brass, torus(0.011, 0.0018, 6, 16, Math.PI * 1.3), { p: [xl + 0.004, y1 + 0.011, 0.045], r: [0, Math.PI / 2, 0.4] });
  K.add(M.brass, torus(0.01, 0.0018, 6, 16), { p: [0.02, -0.006, -0.1], r: [0, Math.PI / 2, 0] });
  K.add(M.silver, box(0.004, 0.004, 0.022), { p: [xl, (y1 + y2) / 2 - 0.052, 0.14], r: [0.5, 0, 0] });
  const g = K.build({ shadow: false });
  return g;
}
function buildTrombone() {
  const M = propMaterials();
  const g = new THREE.Group();
  const y1 = 0, y2 = -0.088, rT = 0.0068;
  // 고정부: 마우스피스·안쪽 슬라이드관·벨 부분(왼쪽 어깨 뒤로 넘어갔다 앞으로 나오는 관과 큰 벨)
  const K = new Kit();
  mouthpiece(K, M, -0.28, M.silver, 1.18);
  K.add(M.nickel, cyl(0.0056, 0.0056, 0.66, 10), { p: [0, y1, 0.13], r: [Math.PI / 2, 0, 0] });
  K.add(M.nickel, cyl(0.0056, 0.0056, 0.66, 10), { p: [0, y2, 0.13], r: [Math.PI / 2, 0, 0] });
  K.add(M.brass, rod([0, y1, -0.185], [0, y2, -0.185], 0.004)); // 안쪽 버팀대
  K.add(M.brass, cyl(0.0095, 0.0095, 0.03, 12), { p: [0, y2, -0.2], r: [Math.PI / 2, 0, 0] }); // 벨 잠금 고리
  const bx = 0.19, by = 0.035; // 벨은 연주자 왼쪽 볼 옆(얼굴을 가리지 않게 넉넉히 띄움)
  K.add(M.brass, tube([[0, y2, -0.2], [0.012, y2 + 0.005, -0.3], [0.03, y2 + 0.03, -0.44], [0.045, y2 + 0.05, -0.55],
    ...arcPts([(0.045 + bx) / 2, (y2 + 0.05 + by) / 2, -0.56], [(0.045 - bx) / 2 / Math.hypot((0.045 - bx) / 2, (y2 + 0.05 - by) / 2), (y2 + 0.05 - by) / 2 / Math.hypot((0.045 - bx) / 2, (y2 + 0.05 - by) / 2), 0], [0, 0, -1], Math.hypot((0.045 - bx) / 2, (y2 + 0.05 - by) / 2), 0, 180, 12),
    [bx, by, -0.5], [bx, by, -0.36]], 0.0078, 10));
  K.add(M.brassBell, latheAlong([[0.0078, 0], [0.0095, 0.1], [0.013, 0.2], [0.02, 0.28], [0.033, 0.335], [0.055, 0.372], [0.082, 0.392], [0.104, 0.401], [0.1085, 0.404], [0.107, 0.4055]], [bx, by, -0.37], [0, 0, 1], 36));
  K.add(M.brass, rod([0.03, y2 + 0.03, -0.44], [bx, by, -0.3], 0.0035)); // 벨 버팀대
  K.add(M.brass, rod([0.0, y1, -0.15], [bx, by, -0.16], 0.0035));
  K.add(M.brass, sph(0.012, 10, 8), { p: [(0.045 + bx) / 2, (y2 + 0.05 + by) / 2, -0.56 - Math.hypot((0.045 - bx) / 2, (y2 + 0.05 - by) / 2) - 0.012] }); // 균형추
  g.add(K.build({ shadow: false }));
  // 움직이는 부분: 바깥 슬라이드(두 관 + 끝 U자 + 손잡이 버팀대)
  const S = new Kit();
  S.add(M.brass, cyl(rT, rT, 0.62, 12), { p: [0, y1, 0.3], r: [Math.PI / 2, 0, 0] });
  S.add(M.brass, cyl(rT, rT, 0.62, 12), { p: [0, y2, 0.3], r: [Math.PI / 2, 0, 0] });
  S.add(M.brass, tube(arcPts([0, (y1 + y2) / 2, 0.61], [0, 1, 0], [0, 0, 1], (y1 - y2) / 2, 0, 180, 12), rT, 10));
  S.add(M.nickel, tube(arcPts([0, (y1 + y2) / 2, 0.61], [0, 1, 0], [0, 0, 1], (y1 - y2) / 2 + 0.004, 40, 140, 8), 0.004, 8));
  S.add(M.brass, rod([0, y1, 0.02], [0, y2, 0.02], 0.0045)); // 손으로 잡는 버팀대
  S.add(M.silver, cyl(rT + 0.0015, rT + 0.0015, 0.035, 12), { p: [0, y1, 0.005], r: [Math.PI / 2, 0, 0] });
  S.add(M.silver, cyl(rT + 0.0015, rT + 0.0015, 0.035, 12), { p: [0, y2, 0.005], r: [Math.PI / 2, 0, 0] });
  S.add(M.rubber, sph(0.006, 8, 6), { p: [0, (y1 + y2) / 2, 0.66] });
  const slide = S.build({ shadow: false });
  g.add(slide);
  g.userData.parts = { slide: g.children.indexOf(slide) };
  return g;
}
function buildHorn() {
  const M = propMaterials(), K = new Kit();
  // 감긴 관: 바깥에서 안으로 2.3바퀴 도는 나선(안으로 갈수록 가늘어짐 대신 반지름만 줄임)
  const turns = 2.35, a0 = -72 * R;
  const sp = [];
  for (let i = 0; i <= 90; i++) { const u = i / 90, a = a0 + u * turns * Math.PI * 2, r = lerp(0.168, 0.1, Math.pow(u, 0.9)); sp.push(V3(Math.cos(a) * r, Math.sin(a) * r, lerp(-0.014, 0.022, u))); }
  K.add(M.brass, tube(sp, 0.0078, 10, false, 2));
  // 벨: 나선 바깥 끝에서 뒤·오른쪽으로 벌어지는 큰 나팔
  const dir = V3(-0.74, -0.2, -0.64).normalize();
  const s0 = sp[0].clone(), t0 = V3(Math.sin(a0), -Math.cos(a0), 0); // 시계 방향 접선
  const b0 = s0.clone().addScaledVector(t0, 0.07).add(V3(0, 0, -0.02));
  K.add(M.brass, tube([s0, s0.clone().addScaledVector(t0, 0.035).add(V3(0, 0, -0.004)), b0, b0.clone().addScaledVector(dir, 0.05)], 0.0095, 10));
  const bs = b0.clone().addScaledVector(dir, 0.035);
  K.add(M.brassBell, latheAlong([[0.0095, 0], [0.013, 0.04], [0.019, 0.08], [0.03, 0.118], [0.05, 0.15], [0.083, 0.176], [0.122, 0.192], [0.147, 0.2], [0.153, 0.203], [0.151, 0.2046]], [bs.x, bs.y, bs.z], [dir.x, dir.y, dir.z], 40));
  K.add(M.brass, torus(0.152, 0.0026, 6, 40), { m: new THREE.Matrix4().compose(bs.clone().addScaledVector(dir, 0.2035), new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), dir), V3(1, 1, 1)) });
  // 리드파이프: 입술 자리에서 내려와 감긴 관 왼쪽으로 붙습니다
  const mp = V3(-0.085, 0.3, -0.085);
  const lp = [mp.clone().add(V3(-0.004, -0.05, 0.02)), V3(-0.12, 0.2, -0.03), V3(-0.158, 0.11, -0.012), V3(-0.172, 0.02, -0.012), V3(-0.158, -0.07, -0.012)];
  K.add(M.brass, tube(lp, 0.0058, 8));
  {
    const k2 = new Kit();
    mouthpiece(k2, M, 0, M.silver, 0.82);
    const d = lp[0].clone().sub(mp).normalize();
    K.merge(k2, { m: new THREE.Matrix4().compose(mp, new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), d), V3(1, 1, 1)) });
  }
  // 로터리 밸브 4개와 조율관(위쪽 U자들), 손가락 레버
  const end = sp[sp.length - 1];
  for (let i = 0; i < 4; i++) {
    const x = -0.045 + i * 0.034, y = 0.012 - i * 0.012;
    K.add(M.nickel, cyl(0.0145, 0.0145, 0.03, 16), { p: [x, y, 0.03], r: [Math.PI / 2, 0, 0] });
    K.add(M.silver, cyl(0.0125, 0.0125, 0.004, 16), { p: [x, y, 0.047], r: [Math.PI / 2, 0, 0] });
    K.add(M.silver, cyl(0.004, 0.004, 0.006, 8), { p: [x, y, 0.051], r: [Math.PI / 2, 0, 0] });
    const h = 0.045 + (i % 2) * 0.022;
    K.add(M.brass, tube([[x - 0.008, y + 0.012, 0.03], [x - 0.008, y + h, 0.03], ...arcPts([x, y + h, 0.03], [-1, 0, 0], [0, 1, 0], 0.008, 0, 180, 6).slice(1), [x + 0.008, y + 0.012, 0.03]], 0.0046, 8));
    if (i < 3) {
      // 레버: 밸브에서 왼손 쪽으로 뻗은 얇은 판
      K.add(M.silver, rod([x, y, 0.052], [-0.105 + i * 0.006, 0.055 - i * 0.026, 0.06], 0.0018));
      K.add(M.silver, sph(1, 10, 6), { p: [-0.115 + i * 0.006, 0.058 - i * 0.026, 0.06], s: [0.016, 0.006, 0.004] });
    }
    if (i < 3) K.add(M.brass, rod([x + 0.012, y - 0.004, 0.03], [x + 0.022, y - 0.008, 0.03], 0.0055));
  }
  K.add(M.brass, tube([end, V3(end.x * 0.6, end.y * 0.6, 0.028), V3(-0.045, 0.012, 0.03)], 0.007, 8));
  K.add(M.brass, torus(0.011, 0.0018, 6, 14, Math.PI), { p: [-0.168, -0.01, -0.004], r: [0, Math.PI / 2, 0] }); // 새끼손가락 걸이
  // 감긴 관을 묶는 버팀대
  for (const a of [20, 110, 200, 290]) K.add(M.brass, rod([Math.cos(a * R) * 0.165, Math.sin(a * R) * 0.165, -0.006], [Math.cos(a * R) * 0.108, Math.sin(a * R) * 0.108, 0.018], 0.0022));
  const g = K.build({ shadow: false });
  return g;
}
function buildFlute() {
  const M = propMaterials(), K = new Kit();
  // x 축으로 누운 관. 입술판(+x 쪽)에서 오른손 쪽(-x)으로 뻗습니다
  K.add(M.silver, cyl(0.0095, 0.0095, 0.6, 14), { p: [-0.03, 0, 0], r: [0, 0, Math.PI / 2] });
  K.add(M.silver, cyl(0.0098, 0.0086, 0.06, 14), { p: [0.3, 0, 0], r: [0, 0, -Math.PI / 2] }); // 머리관 끝(살짝 가늘어짐)
  K.add(M.silver, sph(0.0092, 12, 8), { p: [0.33, 0, 0], s: [0.55, 1, 1] }); // 크라운
  K.add(M.gold, sph(1, 16, 10), { p: [0.22, 0.0085, 0], s: [0.022, 0.006, 0.0135] }); // 입술판
  K.add(M.dark, cyl(0.0052, 0.0052, 0.004, 12), { p: [0.22, 0.0128, 0], s: [1.2, 1, 0.9] });
  for (const x of [0.135, -0.19]) K.add(M.silver, cyl(0.0108, 0.0108, 0.022, 14), { p: [x, 0, 0], r: [0, 0, Math.PI / 2] }); // 이음 고리
  // 키: 관 위에 줄지은 뚜껑과 옆으로 지나는 축
  const keys = [0.085, 0.052, 0.022, -0.008, -0.04, -0.075, -0.105, -0.135, -0.165, -0.215, -0.245, -0.275];
  keys.forEach((x, i) => {
    const big = i > 8;
    K.add(M.silver, cyl(big ? 0.0098 : 0.0086, big ? 0.0098 : 0.0086, 0.003, 14), { p: [x, 0.0118, big ? 0.004 : 0], r: [big ? 0.25 : 0, 0, 0] });
    K.add(M.silver, cyl(0.0074, 0.0092, 0.004, 14), { p: [x, 0.0088, big ? 0.004 : 0] });
    K.add(M.silver, rod([x, 0.0112, 0], [x, 0.0075, 0.0125], 0.0012));
  });
  K.add(M.silver, cyl(0.0017, 0.0017, 0.3, 6), { p: [-0.04, 0.0075, 0.0125], r: [0, 0, Math.PI / 2] });
  K.add(M.silver, cyl(0.0017, 0.0017, 0.085, 6), { p: [-0.245, 0.0075, 0.013], r: [0, 0, Math.PI / 2] });
  for (const x of [0.105, 0.0, -0.09, -0.185]) K.add(M.silver, sph(0.0028, 6, 5), { p: [x, 0.0075, 0.0125] });
  K.add(M.silver, sph(1, 10, 6), { p: [0.11, -0.004, 0.0125], s: [0.012, 0.0028, 0.006] }); // 엄지 키
  const g = K.build({ shadow: false });
  return g;
}

// ───────── 타악기 ─────────
function buildTimpani() {
  const M = propMaterials(), K = new Kit();
  for (const [x, r] of [[-0.42, 0.36], [0.42, 0.32]]) {
    const top = 0.8, depth = r * 1.22, z = 0.35;
    // 구리 솥: 반구에 가까운 포물면
    const prof = [];
    for (let i = 0; i <= 14; i++) { const u = i / 14; prof.push([Math.max(0.0005, r * Math.sin(u * Math.PI / 2) ** 0.82), -depth * Math.cos(u * Math.PI / 2) ** 1.25]); }
    prof.push([r * 1.005, 0.006]);
    K.add(M.copper, lathe(prof, 40), { p: [x, top - 0.006, z] });
    K.add(M.head, new THREE.CircleGeometry(r * 1.0, 40), { p: [x, top + 0.002, z], r: [-Math.PI / 2, 0, 0] });
    K.add(M.feltW, new THREE.RingGeometry(r * 0.5, r * 0.56, 40), { p: [x, top + 0.0026, z], r: [-Math.PI / 2, 0, 0] });
    K.add(M.chrome, torus(r * 1.012, 0.0085, 8, 44), { p: [x, top + 0.002, z], r: [Math.PI / 2, 0, 0] }); // 조임테
    K.add(M.chrome, torus(r * 1.02, 0.0042, 6, 44), { p: [x, top - 0.02, z], r: [Math.PI / 2, 0, 0] });
    // 조율 나사 8개와 솥을 감싸 내려가는 버팀살
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2, cx = Math.cos(a), sz = Math.sin(a);
      K.add(M.chrome, box(0.022, 0.012, 0.03), { p: [x + cx * r * 1.05, top - 0.004, z + sz * r * 1.05], r: [0, -a + Math.PI / 2, 0] });
      K.add(M.chrome, cyl(0.004, 0.004, 0.075, 6), { p: [x + cx * r * 1.07, top - 0.035, z + sz * r * 1.07] });
      K.add(M.chrome, rod([x + cx * r * 1.07, top - 0.07, z + sz * r * 1.07], [x + cx * r * 0.5, top - depth * 0.98, z + sz * r * 0.5], 0.005));
    }
    // 받침: 가운데 기둥·삼발이·바퀴·페달
    K.add(M.chrome, cyl(0.03, 0.03, 0.06, 12), { p: [x, top - depth - 0.03, z] });
    K.add(M.frame, cyl(0.022, 0.022, top - depth - 0.1, 10), { p: [x, (top - depth - 0.06) / 2 + 0.02, z] });
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + Math.PI / 6, fx = x + Math.cos(a) * r * 0.9, fz = z + Math.sin(a) * r * 0.9;
      K.add(M.frame, rod([x, 0.1, z], [fx, 0.07, fz], 0.016));
      K.add(M.frame, rod([x, top - depth - 0.07, z], [fx, 0.09, fz], 0.011));
      K.add(M.rubber, cyl(0.035, 0.035, 0.03, 12), { p: [fx, 0.035, fz], r: [0, -a, Math.PI / 2] });
    }
    K.add(M.frame, box(0.09, 0.02, 0.2), { p: [x, 0.06, z - r * 0.78], r: [0.35, 0, 0] }); // 페달(연주자 쪽)
    K.add(M.chrome, box(0.05, 0.012, 0.13), { p: [x + r * 0.9, top - 0.01, z - r * 0.55], r: [0, 0.6, 0] }); // 음높이 눈금
  }
  return K.build();
}
function drumLugs(K, M, cx, cy, cz, r, len, n, axis) {
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + 0.3, u = Math.cos(a) * (r + 0.008), v = Math.sin(a) * (r + 0.008);
    const p = axis === 'y' ? [cx + u, cy, cz + v] : [cx + u, cy + v, cz];
    const rr = axis === 'y' ? [0, 0, 0] : [Math.PI / 2, 0, 0];
    K.add(M.chrome, box(0.014, len * 0.42, 0.014), { p, r: rr });
    K.add(M.chrome, cyl(0.0028, 0.0028, len * 1.04, 6), { p, r: rr });
  }
}
function cymbalGeo(r) {
  // 가운데 종(bell)이 솟고 가장자리로 얇게 퍼지는 접시
  return lathe([[0.004, 0.026 * r / 0.24], [r * 0.1, 0.026 * r / 0.24], [r * 0.2, 0.018 * r / 0.24], [r * 0.3, 0.012 * r / 0.24], [r * 0.7, 0.005], [r, 0], [r * 0.7, 0.003], [r * 0.3, 0.0095 * r / 0.24], [r * 0.2, 0.0155 * r / 0.24], [r * 0.1, 0.023 * r / 0.24], [0.004, 0.023 * r / 0.24]], 40);
}
function tripod(K, M, x, z, h, spread = 0.26) {
  K.add(M.chrome, cyl(0.011, 0.011, h * 0.55, 8), { p: [x, h * 0.275 + 0.12, z] });
  K.add(M.chrome, cyl(0.008, 0.008, h * 0.55, 8), { p: [x, h * 0.72, z] });
  K.add(M.chrome, cyl(0.015, 0.015, 0.03, 8), { p: [x, h * 0.55 + 0.1, z] });
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5, fx = x + Math.cos(a) * spread, fz = z + Math.sin(a) * spread;
    K.add(M.chrome, rod([x, 0.36, z], [fx, 0.012, fz], 0.0075));
    K.add(M.chrome, rod([x, 0.16, z], [x + Math.cos(a) * spread * 0.55, 0.19, z + Math.sin(a) * spread * 0.55], 0.005));
    K.add(M.rubber, sph(0.014, 8, 6), { p: [fx, 0.012, fz] });
  }
}
function buildKit() {
  const M = propMaterials(), K = new Kit();
  // 스네어: 받침 위 얕은 북(위아래 테·조임쇠·울림줄)
  K.add(M.shellWood, cyl(0.2, 0.2, 0.13, 36, true), { p: [0, 0.66, 0.36] });
  K.add(M.head, new THREE.CircleGeometry(0.198, 36), { p: [0, 0.727, 0.36], r: [-Math.PI / 2, 0, 0] });
  for (const y of [0.728, 0.594]) { K.add(M.chrome, torus(0.203, 0.006, 8, 36), { p: [0, y, 0.36], r: [Math.PI / 2, 0, 0] }); K.add(M.chrome, cyl(0.206, 0.206, 0.012, 36, true), { p: [0, y + (y > 0.7 ? -0.008 : 0.008), 0.36] }); }
  drumLugs(K, M, 0, 0.66, 0.36, 0.2, 0.13, 8, 'y');
  K.add(M.chrome, box(0.03, 0.05, 0.018), { p: [0.21, 0.66, 0.36] }); // 울림줄 레버
  tripod(K, M, 0, 0.36, 0.56, 0.22);
  for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + 0.5; K.add(M.chrome, rod([0, 0.55, 0.36], [Math.cos(a) * 0.19, 0.6, 0.36 + Math.sin(a) * 0.19], 0.006)); }
  // 큰북: 누운 통(광택 칠)·나무 테·조임쇠·다리·페달
  const bx = 0.45, by = 0.34, bz = 0.5;
  K.add(M.shellRed, cyl(0.32, 0.32, 0.36, 44, true), { p: [bx, by, bz], r: [Math.PI / 2, 0, 0] });
  for (const dz of [-0.185, 0.185]) {
    K.add(M.shellWood, torus(0.325, 0.016, 8, 44), { p: [bx, by, bz + dz] });
    K.add(M.head, new THREE.CircleGeometry(0.315, 44), { p: [bx, by, bz + dz * 1.02], r: [0, dz < 0 ? Math.PI : 0, 0] });
  }
  K.add(M.feltW, new THREE.CircleGeometry(0.07, 20), { p: [bx, by, bz + 0.1895] });
  drumLugs(K, M, bx, by, bz, 0.32, 0.36, 8, 'z');
  for (const sx of [-1, 1]) K.add(M.chrome, rod([bx + sx * 0.25, by - 0.16, bz + 0.12], [bx + sx * 0.36, 0.01, bz + 0.26], 0.008));
  K.add(M.frame, box(0.09, 0.012, 0.26), { p: [bx, 0.02, bz - 0.3], r: [0.12, 0, 0] });
  K.add(M.chrome, rod([bx, 0.05, bz - 0.2], [bx, 0.3, bz - 0.22], 0.005));
  K.add(M.feltW, cyl(0.026, 0.026, 0.04, 12), { p: [bx, 0.32, bz - 0.205], r: [Math.PI / 2, 0, 0] });
  // 심벌: 삼발이 받침 위 기울인 접시(따로 흔들리도록 그룹으로)
  tripod(K, M, -0.45, 0.4, 1.22, 0.28);
  K.add(M.feltW, cyl(0.018, 0.018, 0.012, 10), { p: [-0.45, 1.236, 0.4] });
  K.add(M.chrome, cyl(0.004, 0.004, 0.04, 6), { p: [-0.45, 1.27, 0.4] });
  K.add(M.chrome, sph(0.008, 8, 6), { p: [-0.45, 1.29, 0.4] });
  const g = K.build();
  const C = new Kit();
  C.add(M.bronze, cymbalGeo(0.24));
  const cym = C.build();
  cym.position.set(-0.45, 1.244, 0.4);
  g.add(cym);
  g.userData.parts = { cym: g.children.indexOf(cym) };
  return g;
}
// 큰북(콘서트 베이스 드럼): 기울인 틀에 매단 큰 북과 옆의 맞부딪치는 심벌
function buildBassDrum() {
  const M = propMaterials(), K = new Kit();
  const D = new Kit();
  D.add(M.shellWood, cyl(0.46, 0.46, 0.44, 48, true), { r: [Math.PI / 2, 0, 0] });
  for (const dz of [-0.225, 0.225]) {
    D.add(M.shellRed, torus(0.467, 0.02, 8, 48), { p: [0, 0, dz] });
    D.add(M.head, new THREE.CircleGeometry(0.452, 48), { p: [0, 0, dz * 1.01], r: [0, dz < 0 ? Math.PI : 0, 0] });
  }
  drumLugs(D, M, 0, 0, 0, 0.46, 0.44, 10, 'z');
  // 북면이 연주자 쪽 위를 보도록 기울입니다
  K.merge(D, { p: [0, 0.82, 0.62], r: [0.95, 0, 0] });
  for (const sx of [-1, 1]) {
    K.add(M.frame, rod([sx * 0.56, 0.02, 0.3], [sx * 0.56, 0.86, 0.6], 0.016));
    K.add(M.frame, rod([sx * 0.56, 0.02, 0.95], [sx * 0.56, 0.86, 0.6], 0.016));
    K.add(M.frame, rod([sx * 0.56, 0.03, 0.3], [sx * 0.56, 0.03, 0.95], 0.014));
    K.add(M.chrome, rod([sx * 0.56, 0.84, 0.6], [sx * 0.47, 0.83, 0.61], 0.012));
    for (const z of [0.3, 0.95]) K.add(M.rubber, cyl(0.04, 0.04, 0.03, 12), { p: [sx * 0.56, 0.04, z], r: [0, 0, Math.PI / 2] });
  }
  K.add(M.frame, rod([-0.56, 0.03, 0.62], [0.56, 0.03, 0.62], 0.014));
  // 심벌 한 쌍을 올려 둔 작은 받침
  tripod(K, M, -0.82, 0.3, 0.86, 0.22);
  K.add(M.fabric, box(0.4, 0.03, 0.4), { p: [-0.82, 0.88, 0.3] });
  const g = K.build();
  const C = new Kit();
  C.add(M.bronze, cymbalGeo(0.22));
  C.add(M.bronze, cymbalGeo(0.22), { p: [0.03, 0.02, 0.02], r: [0, 0, 0.12] });
  const cym = C.build();
  cym.position.set(-0.82, 0.9, 0.3);
  g.add(cym);
  g.userData.parts = { cym: g.children.indexOf(cym) };
  return g;
}
function buildStick(kind = 'stick') {
  const M = propMaterials(), K = new Kit();
  // 손 그룹 좌표: 손목이 원점, 손가락이 -y, 엄지가 +z. 채는 쥔 손에서 앞(+z)·아래(-y)로 뻗습니다
  if (kind === 'mallet') {
    K.add(M.maple, rod([0, 0.03, -0.05], [0, -0.16, 0.24], 0.005, 0.0042));
    K.add(M.feltW, sph(0.024, 12, 10), { p: [0, -0.168, 0.252], s: [1, 1, 1.15] });
  } else if (kind === 'beater') {
    K.add(M.maple, rod([0, 0.03, -0.05], [0, -0.17, 0.25], 0.0075, 0.006));
    K.add(M.feltW, sph(0.045, 14, 10), { p: [0, -0.185, 0.275], s: [1, 1, 1.2] });
  } else {
    K.add(M.maple, rod([0, 0.035, -0.06], [0, -0.17, 0.27], 0.0068, 0.0045));
    K.add(M.maple, sph(0.0068, 8, 6), { p: [0, -0.174, 0.277], s: [1, 1, 1.5] });
  }
  return K.build({ shadow: false });
}
function buildCastanet() {
  const M = propMaterials(), K = new Kit();
  // 조개 모양 두 짝이 끈으로 묶인 캐스터네츠(손바닥 안)
  for (const sd of [-1, 1]) K.add(M.castanet, sph(1, 16, 10), { p: [sd * 0.007, -0.05, 0.012], r: [0, 0, sd * 0.22], s: [0.0075, 0.03, 0.034] });
  K.add(M.felt, torus(0.012, 0.0018, 5, 12), { p: [0, -0.018, 0.012], r: [0, Math.PI / 2, 0] });
  return K.build({ shadow: false });
}

// ───────── 건반 ─────────
function keyboard(K, M, y, zFront, width = 1.224, depth = 0.15) {
  // 흰 건반 52개(사이 틈) + 검은 건반 36개. y = 흰 건반 윗면, zFront = 연주자 쪽 끝
  const w = width / 52;
  const whites = [], blacks = [];
  for (let i = 0; i < 52; i++) whites.push(box(w * 0.93, 0.022, depth).translate(-width / 2 + (i + 0.5) * w, y - 0.011, zFront - depth / 2));
  for (let i = 0; i < 51; i++) {
    const n = (i + 5) % 7; // A0 부터: A B | C D E F G …  검은 건반은 B–C, E–F 사이가 없음
    if (n === 2 || n === 6) continue;
    blacks.push(box(w * 0.56, 0.012, depth * 0.62).translate(-width / 2 + (i + 1) * w, y + 0.006, zFront - depth + depth * 0.31));
  }
  K.add(M.ivory, mergeGeometries(whites.map((g) => g.toNonIndexed()), false));
  K.add(M.ebony, mergeGeometries(blacks.map((g) => g.toNonIndexed()), false));
}
function grandShape() {
  const s = new THREE.Shape();
  s.moveTo(-0.72, 0); s.lineTo(0.72, 0); s.lineTo(0.72, -0.5);
  s.bezierCurveTo(0.72, -1.2, 0.2, -1.1, 0.12, -1.6);
  s.bezierCurveTo(0.05, -2.05, -0.3, -2.1, -0.55, -2.05);
  s.bezierCurveTo(-0.72, -2.0, -0.72, -1.8, -0.72, -1.6);
  s.closePath();
  return s;
}
function buildGrand() {
  const M = propMaterials(), K = new Kit();
  const top = 1.0, rimH = 0.3;
  const outline = grandShape().getPoints(18);
  // 테(옆판): 윤곽을 따라 세운 두꺼운 벽. 안쪽이 보이도록 바깥·안쪽 두 겹
  const wall = (pts, y0, y1, flip) => {
    const n = pts.length, pos = [], idx = [];
    for (let i = 0; i <= n; i++) { const p = pts[i % n]; pos.push(p.x, y0, p.y, p.x, y1, p.y); }
    for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    // 바깥벽은 바깥을, 안쪽 벽(flip)은 안쪽을 보게
    return orient(g, (nn, pp) => (nn.x * (pp.x - 0) + nn.z * (pp.z + 0.95)) * (flip ? -1 : 1));
  };
  // 중심 쪽으로 줄인 안쪽 윤곽
  const cx = 0, cz = -0.95;
  const inner = outline.map((p) => V2(cx + (p.x - cx) * 0.94, cz + (p.y - cz) * 0.955));
  K.add(M.lacquer, wall(outline, top - rimH, top, false));
  K.add(M.lacquer, wall(inner, top - rimH * 0.6, top, true));
  {
    // 테 윗면(바깥과 안쪽 사이 띠)과 바닥판
    const n = outline.length, pos = [], idx = [];
    for (let i = 0; i <= n; i++) { const a = outline[i % n], b = inner[i % n]; pos.push(a.x, top, a.y, b.x, top, b.y); }
    for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    K.add(M.lacquer, orient(g, (nn) => nn.y));
    const bottom = new THREE.ShapeGeometry(grandShape(), 18);
    K.add(M.satin, bottom, { p: [0, top - rimH, 0], r: [Math.PI / 2, 0, 0] });
    // 울림판(가문비)과 금빛 주철 프레임
    // 위를 보는 면은 (x, −z) 로 그려 −90° 눕힙니다(거울 뒤집기 없이 법선이 위로)
    const sb = new THREE.ShapeGeometry(new THREE.Shape(inner.map((p) => V2(p.x, -p.y))), 18);
    K.add(M.soundboard, sb, { p: [0, top - rimH * 0.56, 0], r: [-Math.PI / 2, 0, 0] });
    const plate = new THREE.Shape(inner.map((p) => V2(cx + (p.x - cx) * 0.97, -(cz + (p.y - cz) * 0.97))));
    for (const [hx, hz, hr] of [[-0.3, -1.55, 0.13], [0.0, -1.2, 0.11], [0.32, -0.75, 0.09], [-0.42, -1.05, 0.08]]) { const h = new THREE.Path(); h.absarc(hx, -hz, hr, 0, Math.PI * 2, true); plate.holes.push(h); }
    const pg = new THREE.ExtrudeGeometry(plate, { depth: 0.012, bevelEnabled: false, curveSegments: 14 });
    K.add(M.iron, pg, { p: [0, top - rimH * 0.36, 0], r: [-Math.PI / 2, 0, 0] });
    for (const [x0, z0, x1, z1] of [[-0.45, -0.2, -0.5, -1.95], [-0.1, -0.2, -0.15, -1.9], [0.25, -0.2, 0.1, -1.5]]) K.add(M.iron, rod([x0, top - rimH * 0.3, z0], [x1, top - rimH * 0.3, z1], 0.014)); // 프레임 버팀살
  }
  // 현: 조율핀(건반 쪽)에서 굽은 옆판 쪽으로 부채처럼
  {
    const pos = [], yS = top - rimH * 0.27;
    for (let i = 0; i < 70; i++) {
      const u = i / 69, x0 = lerp(-0.62, 0.62, u);
      const len = lerp(1.78, 0.42, Math.pow(u, 0.75));
      const x1 = x0 + lerp(0.18, -0.02, u);
      pos.push(x0, yS, -0.2, x1, yS - 0.004, -0.2 - len);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    K.strings = lg;
    K.add(M.felt, box(1.26, 0.012, 0.035), { p: [0, yS + 0.002, -0.3] }); // 댐퍼 줄
    K.add(M.ebony, box(1.28, 0.02, 0.05), { p: [0, yS + 0.012, -0.34] });
    K.add(M.iron, box(1.3, 0.016, 0.12), { p: [0, yS - 0.004, -0.13] }); // 핀 블록
  }
  // 건반부: 건반 받침·옆 볼·덮개판(브랜드 띠)·보면대
  K.add(M.lacquer, box(1.44, 0.07, 0.3), { p: [0, 0.8, 0.1] });
  for (const sx of [-1, 1]) K.add(M.lacquer, box(0.1, 0.16, 0.32), { p: [sx * 0.67, 0.88, 0.09] });
  K.add(M.lacquer, box(1.26, 0.13, 0.03), { p: [0, 0.925, -0.01], r: [-0.12, 0, 0] });
  K.add(M.gold, box(0.2, 0.012, 0.004), { p: [0, 0.93, 0.008], r: [-0.12, 0, 0] });
  keyboard(K, M, 0.872, 0.215, 1.224, 0.15);
  K.add(M.felt, box(1.23, 0.006, 0.012), { p: [0, 0.872, 0.06] });
  K.add(M.lacquer, box(0.78, 0.26, 0.016), { p: [0, 1.12, -0.09], r: [-0.3, 0, 0] });
  K.add(M.lacquer, box(0.8, 0.02, 0.07), { p: [0, 1.0, -0.06] });
  // 다리 3개(놋쇠 바퀴)와 페달 받침(리라)
  for (const [x, z] of [[-0.6, -0.12], [0.6, -0.12], [-0.42, -1.86]]) {
    K.add(M.lacquer, cyl(0.06, 0.045, 0.56, 14), { p: [x, 0.42, z] });
    K.add(M.lacquer, box(0.14, 0.05, 0.14), { p: [x, 0.69, z] });
    K.add(M.brass, cyl(0.03, 0.03, 0.05, 12), { p: [x, 0.11, z] });
    K.add(M.brass, cyl(0.04, 0.04, 0.03, 12), { p: [x, 0.04, z], r: [0, 0, Math.PI / 2] });
  }
  for (const sx of [-1, 1]) K.add(M.lacquer, rod([sx * 0.09, 0.72, 0.02], [sx * 0.07, 0.1, 0.06], 0.02));
  K.add(M.lacquer, box(0.3, 0.07, 0.12), { p: [0, 0.085, 0.07] });
  for (const x of [-0.08, 0, 0.08]) K.add(M.brass, box(0.036, 0.012, 0.13), { p: [x, 0.07, 0.17], r: [0.12, 0, 0] });
  // 뚜껑: 낮은음 쪽(−x)에 경첩, 버팀대로 받쳐 엽니다
  const lidK = new Kit();
  const lidG = new THREE.ExtrudeGeometry(grandShape(), { depth: 0.022, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 18 });
  lidK.add(M.lacquer, lidG, { p: [0.72, 0.022, 0], r: [Math.PI / 2, 0, 0] });
  const g = K.build();
  const lines = new THREE.LineSegments(K.strings, new THREE.LineBasicMaterial({ color: 0xd9c9a2, transparent: true, opacity: 0.75 }));
  g.add(lines);
  const lid = lidK.build();
  const pivot = new THREE.Group();
  pivot.position.set(-0.72, top + 0.004, 0);
  pivot.rotation.z = 0.62;
  pivot.add(lid);
  g.add(pivot);
  const P = new Kit();
  P.add(M.lacquer, rod([0.6, top, -0.55], [-0.72 + Math.cos(0.62) * 1.27, top + Math.sin(0.62) * 1.27 - 0.01, -0.6], 0.012));
  g.add(P.build());
  // 등받이 없는 의자(가죽 쿠션·단추)
  const B = new Kit();
  B.add(M.fabric, box(0.72, 0.07, 0.36), { p: [0, 0.475, 0.62] });
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) B.add(M.lacquer, sph(0.008, 6, 5), { p: [-0.24 + i * 0.16, 0.512, 0.54 + j * 0.16] });
  B.add(M.lacquer, box(0.74, 0.04, 0.38), { p: [0, 0.425, 0.62] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(M.lacquer, cyl(0.022, 0.018, 0.41, 10), { p: [sx * 0.32, 0.205, 0.62 + sz * 0.14] });
  g.add(B.build());
  return g;
}
function buildUpright() {
  const M = propMaterials(), K = new Kit();
  // 몸통(위·아래 판 사이 틈), 건반 턱, 다리, 페달, 보면대
  K.add(M.lacquer, box(1.46, 0.5, 0.3), { p: [0, 0.25, -0.2] });
  K.add(M.lacquer, box(1.46, 0.62, 0.32), { p: [0, 0.95, -0.2] });
  K.add(M.lacquer, box(1.5, 0.035, 0.38), { p: [0, 1.275, -0.2] });
  K.add(M.satin, box(1.3, 0.48, 0.012), { p: [0, 0.98, -0.036] });
  K.add(M.satin, box(1.3, 0.36, 0.012), { p: [0, 0.27, -0.046] });
  K.add(M.lacquer, box(1.46, 0.09, 0.34), { p: [0, 0.655, 0.02] });
  for (const sx of [-1, 1]) {
    K.add(M.lacquer, box(0.08, 0.14, 0.34), { p: [sx * 0.69, 0.75, 0.02] });
    K.add(M.lacquer, cyl(0.035, 0.028, 0.62, 12), { p: [sx * 0.66, 0.31, 0.15] });
    K.add(M.lacquer, box(0.1, 0.05, 0.5), { p: [sx * 0.66, 0.025, -0.05] });
  }
  keyboard(K, M, 0.725, 0.18, 1.224, 0.15);
  K.add(M.felt, box(1.23, 0.006, 0.012), { p: [0, 0.725, 0.028] });
  K.add(M.lacquer, box(1.26, 0.035, 0.05), { p: [0, 0.76, 0.0], r: [-0.3, 0, 0] });
  K.add(M.gold, box(0.18, 0.01, 0.004), { p: [0, 0.8, -0.028] });
  K.add(M.lacquer, box(0.7, 0.02, 0.06), { p: [0, 0.87, -0.01] });
  for (const x of [-0.09, 0, 0.09]) K.add(M.brass, box(0.036, 0.012, 0.11), { p: [x, 0.06, 0.0], r: [0.12, 0, 0] });
  const g = K.build();
  const B = new Kit();
  B.add(M.fabric, box(0.72, 0.07, 0.36), { p: [0, 0.475, 0.62] });
  B.add(M.lacquer, box(0.74, 0.04, 0.38), { p: [0, 0.425, 0.62] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(M.lacquer, cyl(0.022, 0.018, 0.41, 10), { p: [sx * 0.32, 0.205, 0.62 + sz * 0.14] });
  g.add(B.build());
  return g;
}

// ───────── 하프 ─────────
// 하프 평면이 XY. 기둥이 +x 쪽, 어깨(연주자 쪽)가 −x 쪽 위. 연주자는 x ≈ −0.8 에서 +x 를 보고 앉습니다.
function buildHarp() {
  const M = propMaterials(), K = new Kit();
  const colX = 0.46, baseY = 0.1, topY = 1.8;
  const shoulder = V3(-0.42, 1.42, 0), foot = V3(0.3, 0.13, 0);
  const boardY = (x) => foot.y + ((foot.x - x) / (foot.x - shoulder.x)) * (shoulder.y - foot.y);
  // 목: 기둥 꼭대기에서 어깨까지 S자로 흐르는 곡선
  const neck = new THREE.CatmullRomCurve3([V3(colX, topY - 0.04, 0), V3(0.3, 1.8, 0), V3(0.1, 1.7, 0), V3(-0.1, 1.535, 0), V3(-0.27, 1.46, 0), V3(-0.38, 1.47, 0), V3(-0.44, 1.44, 0)], false, 'centripetal');
  K.add(M.gold, new THREE.TubeGeometry(neck, 40, 0.03, 10, false), { s: [1, 1, 0.7] });
  K.add(M.brass, new THREE.TubeGeometry(neck, 40, 0.012, 6, false), { p: [0, -0.012, 0.024] }); // 디스크 판
  // 기둥: 세로 홈이 있는 금박 기둥, 왕관 장식과 받침
  {
    const g = cyl(0.036, 0.042, topY - baseY - 0.16, 16, false);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)); const k = 1 + 0.07 * Math.cos(a * 8); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
    g.computeVertexNormals();
    K.add(M.gold, g, { p: [colX, (topY + baseY) / 2 - 0.02, 0] });
    K.add(M.gold, lathe([[0.04, 0], [0.058, 0.02], [0.05, 0.05], [0.075, 0.1], [0.06, 0.13], [0.07, 0.16], [0.03, 0.2], [0.012, 0.23], [0.0001, 0.24]], 16), { p: [colX, topY - 0.11, 0] });
    K.add(M.gold, lathe([[0.075, 0], [0.07, 0.03], [0.05, 0.05], [0.055, 0.08], [0.042, 0.1]], 16), { p: [colX, baseY + 0.02, 0] });
  }
  // 울림통: 어깨에서 받침까지 내려오며 넓어지는 반원통
  {
    const n = 16, rs = 10, pos = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, c = shoulder.clone().lerp(foot, u), w = lerp(0.05, 0.2, Math.pow(u, 0.8)), d = lerp(0.05, 0.17, u);
      // 울림판 법선(현 쪽) = (+0.87, +0.49) 방향, 통은 그 반대쪽으로 불룩
      for (let j = 0; j <= rs; j++) { const a = (j / rs) * Math.PI; pos.push(c.x - Math.sin(a) * d * 0.87, c.y - Math.sin(a) * d * 0.49, Math.cos(a) * w); }
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < rs; j++) { const a = i * (rs + 1) + j, b = a + rs + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    K.add(M.back, orient(g, (nn) => -(nn.x * 0.87 + nn.y * 0.49) + 0.2));
    // 울림판(앞면)과 현이 꽂히는 가운데 띠
    const bp = [], bi = [];
    for (let i = 0; i <= n; i++) { const u = i / n, c = shoulder.clone().lerp(foot, u), w = lerp(0.05, 0.2, Math.pow(u, 0.8)); bp.push(c.x, c.y, -w, c.x, c.y, w); }
    for (let i = 0; i < n; i++) { const a = i * 2; bi.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    bg.setIndex(bi);
    K.add(M.soundboard, orient(bg, (nn) => nn.x * 0.87 + nn.y * 0.49));
    K.add(M.varnish, rod([shoulder.x + 0.004, shoulder.y + 0.002, 0], [foot.x + 0.004, foot.y + 0.002, 0], 0.009));
  }
  // 받침: 다리 네 개와 페달 일곱 개
  K.add(M.gold, box(0.5, 0.07, 0.4), { p: [0.34, 0.085, 0] });
  K.add(M.back, box(0.44, 0.03, 0.36), { p: [0.34, 0.13, 0] });
  for (const [x, z] of [[0.12, -0.17], [0.12, 0.17], [0.56, -0.17], [0.56, 0.17]]) K.add(M.gold, sph(0.035, 10, 8), { p: [x, 0.035, z], s: [1.2, 1, 1.2] });
  for (let i = 0; i < 7; i++) { const z = (i - 3) * 0.05 + (i > 2 ? 0.02 : -0.02); K.add(M.brass, box(0.1, 0.012, 0.022), { p: [0.05, 0.09, z], r: [0, 0, 0.25] }); }
  // 현 46줄: 도(C)는 붉은색, 파(F)는 검푸른색. 낮은 줄은 굵은 구리선
  const strings = { w: [], r: [], b: [], m: [] };
  const N = 46;
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1), x = lerp(0.275, -0.395, u);
    // 목 곡선에서 x 가 같은 자리 찾기
    let best = 0, bd = 9;
    for (let k = 0; k <= 60; k++) { const p = neck.getPoint(k / 60); const d = Math.abs(p.x - x); if (d < bd) { bd = d; best = p.y; } }
    const yb = boardY(x) + 0.004, yt = best - 0.028;
    const note = (i + 2) % 7; // 0 = 도, 3 = 파
    const rad = lerp(0.0019, 0.0007, Math.pow(u, 0.6));
    const key = u < 0.2 ? 'm' : note === 0 ? 'r' : note === 3 ? 'b' : 'w';
    strings[key].push(rod([x + 0.006, yt, 0.022], [x, yb, 0], rad, rad, 5));
    if (i % 2 === 0) K.add(M.brass, cyl(0.006, 0.006, 0.004, 8), { p: [x + 0.006, yt + 0.004, 0.026], r: [Math.PI / 2, 0, 0] });
  }
  K.add(M.stringW, mergeGeometries(strings.w.map((g) => g.toNonIndexed()), false));
  K.add(M.stringR, mergeGeometries(strings.r.map((g) => g.toNonIndexed()), false));
  K.add(M.stringB, mergeGeometries(strings.b.map((g) => g.toNonIndexed()), false));
  K.add(M.wire, mergeGeometries(strings.m.map((g) => g.toNonIndexed()), false));
  const g = K.build();
  g.userData.seat = V3(-0.82, 0, -0.1); // 연주자 자리(하프 좌표)
  g.userData.pluck = [V3(-0.16, 1.0, 0.06), V3(-0.02, 0.86, -0.06)]; // 오른손·왼손이 뜯는 자리
  return g;
}

// ───────── 의자·보면대·지휘봉 ─────────
function buildChair() {
  const M = propMaterials(), K = new Kit();
  // 쿠션 좌판·등받이와 휘어진 금속 다리
  const seat = box(0.44, 0.05, 0.42);
  K.add(M.fabric, seat, { p: [0, 0.455, 0.0] });
  K.add(M.frame, box(0.46, 0.014, 0.44), { p: [0, 0.426, 0] });
  const back = box(0.42, 0.3, 0.035);
  const bp = back.attributes.position;
  for (let i = 0; i < bp.count; i++) bp.setZ(i, bp.getZ(i) - Math.cos((bp.getX(i) / 0.21) * 1.2) * 0.02);
  back.computeVertexNormals();
  K.add(M.fabric, back, { p: [0, 0.78, -0.2], r: [-0.1, 0, 0] });
  for (const sx of [-1, 1]) {
    K.add(M.frame, tube([[sx * 0.2, 0.01, 0.19], [sx * 0.2, 0.42, 0.185], [sx * 0.2, 0.44, 0.1], [sx * 0.2, 0.44, -0.16]], 0.011, 8));
    K.add(M.frame, tube([[sx * 0.2, 0.01, -0.21], [sx * 0.2, 0.42, -0.2], [sx * 0.2, 0.62, -0.215], [sx * 0.2, 0.92, -0.25]], 0.011, 8));
    K.add(M.frame, cyl(0.014, 0.014, 0.012, 8), { p: [sx * 0.2, 0.006, 0.19] });
    K.add(M.frame, cyl(0.014, 0.014, 0.012, 8), { p: [sx * 0.2, 0.006, -0.21] });
  }
  K.add(M.frame, rod([-0.2, 0.2, 0.188], [0.2, 0.2, 0.188], 0.008));
  K.add(M.frame, rod([-0.2, 0.2, -0.205], [0.2, 0.2, -0.205], 0.008));
  return K.build();
}
function buildStand(h = 1.05) {
  const M = propMaterials(), K = new Kit();
  // 무거운 받침·2단 기둥·조임 고리·기울인 판(아래 턱)과 펼친 악보
  K.add(M.frame, lathe([[0.0001, 0], [0.17, 0], [0.175, 0.008], [0.14, 0.02], [0.03, 0.03], [0.02, 0.05], [0.0001, 0.05]], 20));
  K.add(M.frame, cyl(0.014, 0.014, h * 0.55, 10), { p: [0, h * 0.275 + 0.03, 0] });
  K.add(M.frame, cyl(0.009, 0.009, h * 0.5, 8), { p: [0, h * 0.75, 0] });
  K.add(M.frame, cyl(0.02, 0.02, 0.04, 10), { p: [0, h * 0.55 + 0.03, 0] });
  K.add(M.frame, sph(0.02, 10, 8), { p: [0, h + 0.03, -0.02] });
  const tilt = -0.42, cy = h + 0.13;
  const D = new Kit();
  D.add(M.frame, box(0.5, 0.32, 0.006));
  D.add(M.frame, box(0.52, 0.012, 0.05), { p: [0, -0.166, 0.025] });
  D.add(M.frame, box(0.52, 0.02, 0.008), { p: [0, -0.158, 0.052] });
  for (const sx of [-1, 1]) D.add(M.frame, box(0.008, 0.34, 0.018), { p: [sx * 0.258, 0, 0.006] });
  D.add(M.paper, new THREE.PlaneGeometry(0.46, 0.31), { p: [0, 0.0, 0.0045], r: [0, 0, 0] });
  K.merge(D, { p: [0, cy, 0], r: [tilt, 0, 0] });
  return K.build();
}
function buildBaton() {
  const M = propMaterials(), K = new Kit();
  K.add(M.batonW, cyl(0.0012, 0.0034, 0.36, 6), { p: [0, 0, 0.22], r: [Math.PI / 2, 0, 0] });
  K.add(M.cork, sph(1, 10, 8), { p: [0, 0, 0.025], s: [0.011, 0.011, 0.024] });
  return K.build({ shadow: false });
}

// ───────── 내보내기: 한 번 만들고 복제 ─────────
const cache = new Map();
// 움직이는 하위 그룹(심벌·슬라이드)은 userData.parts = { 이름: 자식 순번 } 으로 적어 두고, 복제한 뒤 순번으로 다시 찾습니다
function proto(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  const src = cache.get(key);
  const c = src.clone();
  c.userData = { ...src.userData };
  for (const [name, idx] of Object.entries(src.userData.parts || {})) c.userData[name] = c.children[idx];
  return c;
}
export const props = {
  violin: () => proto('violin', () => buildStringInstrument('violin')),
  viola: () => proto('viola', () => buildStringInstrument('viola')),
  cello: () => proto('cello', () => buildStringInstrument('cello')),
  bass: () => proto('bass', () => buildStringInstrument('bass')),
  bow: (len = 0.72) => proto('bow' + len, () => buildBow(len)),
  trumpet: () => proto('trumpet', buildTrumpet),
  trombone: () => proto('trombone', buildTrombone),
  horn: () => proto('horn', buildHorn),
  flute: () => proto('flute', buildFlute),
  timpani: () => proto('timpani', buildTimpani),
  kit: () => proto('kit', buildKit),
  bassDrum: () => proto('bassdrum', buildBassDrum),
  stick: (kind = 'stick') => proto('stick-' + kind, () => buildStick(kind)),
  castanet: () => proto('castanet', buildCastanet),
  grand: () => proto('grand', buildGrand),
  upright: () => proto('upright', buildUpright),
  harp: () => proto('harp', buildHarp),
  chair: () => proto('chair', buildChair),
  stand: (h = 1.05) => proto('stand' + h, () => buildStand(h)),
  baton: () => proto('baton', buildBaton),
};
export const STRING_SCALE = Object.fromEntries(Object.entries(STRING_KINDS).map(([k, v]) => [k, v.scale]));
