// 1인칭 소품: 선착장 끝(마지막 판자·기둥), 태클박스와 뜰채, 사람마다의 낚싯대(휘는 블랭크·가이드·스피닝 릴), 찌와 미끼.
// 몸과 손은 그리지 않습니다. 낚싯대는 화면 아래에서 올라옵니다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DOCK } from './logic.js';
import { underwater } from './underwater.js';

const TAU = Math.PI * 2;

// ---------- 캔버스 텍스처 ----------
function cv(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}
function tex(c, srgb = true, rep = null) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (rep) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rep[0], rep[1]);
  }
  return t;
}
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 비바람에 바랜 나무 판: 결, 옹이, 못 자국
const woodTex = (() => {
  const r = rng(7);
  const c = cv(1024, 128, (g, W, H) => {
    g.fillStyle = '#93806a';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 150; i++) {
      const y = r() * H;
      g.strokeStyle = `rgba(${40 + r() * 40},${30 + r() * 25},${20 + r() * 20},${0.14 + r() * 0.24})`;
      g.lineWidth = 0.6 + r() * 2.2;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= W; x += 32) g.lineTo(x, y + Math.sin(x * 0.01 + i) * (1 + r() * 2));
      g.stroke();
    }
    for (let i = 0; i < 5; i++) {
      const x = r() * W;
      const y = H * (0.2 + r() * 0.6);
      const gr = g.createRadialGradient(x, y, 0, x, y, 14);
      gr.addColorStop(0, 'rgba(50,32,20,.85)');
      gr.addColorStop(1, 'rgba(50,32,20,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(x, y, 16, 8, 0, 0, TAU);
      g.fill();
    }
    g.fillStyle = 'rgba(200,195,185,.14)';
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(30,26,22,.8)';
    for (const x of [18, W - 18]) for (const y of [H * 0.3, H * 0.7]) { g.beginPath(); g.arc(x, y, 3, 0, TAU); g.fill(); }
  });
  return tex(c);
})();
const corkTex = (() => {
  const r = rng(3);
  return tex(cv(256, 128, (g, W, H) => {
    g.fillStyle = '#c49a64';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${90 + r() * 60},${60 + r() * 40},${30 + r() * 20},${0.25 + r() * 0.4})`;
      g.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 2);
    }
    g.strokeStyle = 'rgba(80,55,30,.35)';
    for (let x = 0; x < W; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  }), true, [1, 1]);
})();

const std = (color, roughness = 0.7, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
// 여러 부품을 한 재질끼리 합쳐 그리기 횟수를 줄입니다. parts: [geometry, matrix?][]
function merged(parts) {
  const gs = parts.map(([g, m]) => {
    const x = g.index ? g.toNonIndexed() : g.clone();
    if (m) x.applyMatrix4(m);
    // 합치려면 속성이 같아야 합니다(위치·노멀·uv).
    for (const k of Object.keys(x.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') x.deleteAttribute(k);
    if (!x.attributes.uv) x.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2));
    return x;
  });
  return mergeGeometries(gs);
}
const M4 = () => new THREE.Matrix4();
// 사람 색과 상관없는 재질은 낚싯대 4벌이 한 개씩 같이 씁니다(재질 수·유니폼 올리기를 줄임). 지우지 않습니다.
const SHARED = new Map();
function shared(key, make) {
  let m = SHARED.get(key);
  if (!m) {
    m = make();
    m.userData.shared = true;
    SHARED.set(key, m);
  }
  return m;
}

// ================================================================
// 선착장 끝: 판자가 가로로 깔린 마루, 모서리 기둥(물속까지), 테두리 보
// ================================================================
export function makeDock() {
  const g = new THREE.Group();
  const r = rng(11);
  const deckY = DOCK.y;
  const boardW = 0.142;
  const gap = 0.012;
  const thick = 0.045;
  const boards = [];
  for (let z = DOCK.z1 - boardW / 2; z > DOCK.z0; z -= boardW + gap) {
    let x = DOCK.x0;
    let first = true;
    const off = r() * 1.6;
    while (x < DOCK.x1 - 0.05) {
      const len = Math.min(DOCK.x1 - x, first ? 0.8 + off : 2.2 + r() * 0.6);
      boards.push({ x: x + len / 2, z, lx: len, lz: boardW });
      x += len + 0.006;
      first = false;
    }
  }
  for (let z = DOCK.z0 - boardW / 2 - gap; z > DOCK.shoreZ; z -= boardW + gap) boards.push({ x: 0, z, lx: DOCK.walkW, lz: boardW });
  const boardMat = std('#ffffff', 0.86, { map: woodTex });
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, thick, 1), boardMat, boards.length);
  const o = new THREE.Object3D();
  const col = new THREE.Color();
  boards.forEach((b, i) => {
    o.position.set(b.x, deckY - thick / 2 + (r() - 0.5) * 0.006, b.z);
    o.rotation.set((r() - 0.5) * 0.01, 0, (r() - 0.5) * 0.008);
    o.scale.set(b.lx, 1, b.lz);
    o.updateMatrix();
    inst.setMatrixAt(i, o.matrix);
    const k = 0.8 + r() * 0.28;
    inst.setColorAt(i, col.setRGB(k * (0.98 + r() * 0.06), k * (0.92 + r() * 0.05), k * (0.86 + r() * 0.06)));
  });
  g.add(inst);

  // 테두리 보와 장선
  const beamMat = std('#6a5644', 0.9, { map: woodTex });
  const beams = [];
  const fy = deckY - thick - 0.11;
  const box = (x, y, z, lx, ly, lz) => beams.push([new THREE.BoxGeometry(lx, ly, lz), M4().makeTranslation(x, y, z)]);
  box(0, fy, DOCK.z1 + 0.03, DOCK.x1 - DOCK.x0 + 0.08, 0.22, 0.05);
  box(DOCK.x0 - 0.03, fy, (DOCK.z0 + DOCK.z1) / 2, 0.05, 0.22, DOCK.z1 - DOCK.z0 + 0.1);
  box(DOCK.x1 + 0.03, fy, (DOCK.z0 + DOCK.z1) / 2, 0.05, 0.22, DOCK.z1 - DOCK.z0 + 0.1);
  for (let x = DOCK.x0 + 0.5; x < DOCK.x1; x += 1.2) box(x, fy - 0.02, (DOCK.z0 + DOCK.z1) / 2, 0.07, 0.18, DOCK.z1 - DOCK.z0);
  for (const s of [-1, 1]) box(s * (DOCK.walkW / 2 + 0.03), fy, (DOCK.z0 + DOCK.shoreZ) / 2, 0.05, 0.22, DOCK.z0 - DOCK.shoreZ);
  g.add(new THREE.Mesh(merged(beams), beamMat));

  // 기둥: 물속 바닥까지. 물에 잠긴 부분은 물빛이 들고 이끼가 낍니다.
  const postMat = underwater(std('#ffffff', 0.95, { map: woodTex, vertexColors: true }), 'dock-post');
  const posts = [];
  const post = (x, z, top) => {
    const bottom = -2.2;
    const geo = new THREE.CylinderGeometry(0.1, 0.11, top - bottom, 12, 8).toNonIndexed();
    geo.translate(0, (top + bottom) / 2, 0);
    geo.rotateY(r() * 6);
    geo.translate(x, 0, z);
    const p = geo.attributes.position;
    const c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      // 물에 닿는 선 아래는 짙은 초록 이끼, 위는 바랜 나무
      const moss = y < 0.05 ? 1 : y < 0.2 ? (0.2 - y) / 0.15 : 0;
      c[i * 3] = 1 - 0.55 * moss;
      c[i * 3 + 1] = 1 - 0.3 * moss;
      c[i * 3 + 2] = 1 - 0.6 * moss;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    posts.push(geo);
    if (top > deckY + 0.05) {
      const cap = new THREE.CylinderGeometry(0.108, 0.1, 0.035, 12).toNonIndexed();
      cap.translate(x, top + 0.017, z);
      const cc = new Float32Array(cap.attributes.position.count * 3).fill(0.55);
      cap.setAttribute('color', new THREE.BufferAttribute(cc, 3));
      posts.push(cap);
    }
  };
  for (const s of [-1, 1]) post(s * (DOCK.x1 - 0.05), DOCK.z1 + 0.05, deckY + 0.3);
  post(0.7, DOCK.z1 + 0.06, deckY - 0.06);
  post(-0.7, DOCK.z1 + 0.06, deckY - 0.06);
  for (const s of [-1, 1]) post(s * (DOCK.x1 - 0.05), DOCK.z0 + 0.1, deckY - 0.06);
  for (const geo of posts) for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) geo.deleteAttribute(k);
  g.add(new THREE.Mesh(mergeGeometries(posts), postMat));

  // 밧줄 감긴 오른쪽 모서리 기둥
  {
    const ropes = [];
    for (let i = 0; i < 4; i++) {
      const tg = new THREE.TorusGeometry(0.125, 0.02, 8, 26);
      tg.rotateX(Math.PI / 2);
      tg.translate(DOCK.x0 + 0.05, deckY + 0.06 + i * 0.042, DOCK.z1 + 0.05);
      ropes.push(tg);
    }
    g.add(new THREE.Mesh(mergeGeometries(ropes), std('#cdb88c', 0.95)));
  }
  return g;
}

// ================================================================
// 화면 아래 구석 소품: 뚜껑 열린 태클박스(왼쪽), 기대 둔 뜰채(오른쪽)
// ================================================================
export function makeTackle() {
  const g = new THREE.Group();
  const shell = std('#2f6f73', 0.45);
  const dark = std('#1d2226', 0.5);
  const tray = std('#e9e3d6', 0.6);
  const W = 0.46;
  const D = 0.26;
  const H = 0.17;
  const parts = [];
  parts.push([new THREE.BoxGeometry(W, 0.012, D), M4().makeTranslation(0, 0.006, 0)]);
  for (const s of [-1, 1]) {
    parts.push([new THREE.BoxGeometry(W, H, 0.012), M4().makeTranslation(0, H / 2, s * (D / 2 - 0.006))]);
    parts.push([new THREE.BoxGeometry(0.012, H, D), M4().makeTranslation(s * (W / 2 - 0.006), H / 2, 0)]);
  }
  g.add(new THREE.Mesh(merged(parts), shell));
  // 칸막이 트레이
  const trayParts = [[new THREE.BoxGeometry(W - 0.03, 0.008, D - 0.03), M4().makeTranslation(0, H - 0.035, 0)]];
  for (let i = 1; i < 5; i++) trayParts.push([new THREE.BoxGeometry(0.006, 0.035, D - 0.03), M4().makeTranslation(-W / 2 + (i * W) / 5, H - 0.018, 0)]);
  trayParts.push([new THREE.BoxGeometry(W - 0.03, 0.035, 0.006), M4().makeTranslation(0, H - 0.018, 0)]);
  g.add(new THREE.Mesh(merged(trayParts), tray));
  // 칸마다 색 루어(작은 물고기 모양과 고무 웜)
  const lureCols = ['#ff6a3d', '#f6d743', '#7ad0ff', '#c0ff6a', '#ff8ad0', '#ffffff', '#e04040', '#5ee07a'];
  const r = rng(5);
  for (let i = 0; i < 9; i++) {
    const cx = -W / 2 + ((i % 5) + 0.5) * (W / 5);
    const cz = (i < 5 ? -1 : 1) * D * 0.23;
    const lg = new THREE.CapsuleGeometry(0.008, 0.035, 4, 8);
    lg.rotateZ(Math.PI / 2 + (r() - 0.5) * 0.8);
    lg.rotateY(r() * 3);
    const m = new THREE.Mesh(lg, new THREE.MeshPhysicalMaterial({ color: lureCols[i % lureCols.length], roughness: 0.3, clearcoat: 1 }));
    m.position.set(cx, H - 0.022, cz);
    g.add(m);
  }
  // 열린 뚜껑과 손잡이
  const lid = new THREE.Mesh(new THREE.BoxGeometry(W, 0.02, D), std('#3a8287', 0.45));
  lid.geometry.translate(0, 0, -D / 2);
  lid.position.set(0, H, -D / 2);
  lid.rotation.x = 1.9;
  g.add(lid);
  const latch = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.012), std('#c8ccd0', 0.3, { metalness: 0.9 }));
  latch.position.set(0, H - 0.02, D / 2 + 0.006);
  g.add(latch);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.009, 8, 18, Math.PI), dark);
  handle.position.set(0, H + 0.01, D / 2 - 0.02);
  handle.rotation.x = -1.2;
  g.add(handle);
  return g;
}

export function makeNet() {
  const g = new THREE.Group();
  const pole = std('#24262b', 0.4, { metalness: 0.5 });
  const pm = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 1.7, 10), pole);
  pm.position.y = 0.85;
  g.add(pm);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.32, 10), std('#3c3c3c', 0.9));
  grip.position.y = 0.2;
  g.add(grip);
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.011, 8, 32), pole);
  hoop.position.y = 1.96;
  g.add(hoop);
  // 그물: 끝이 처진 원뿔 + 격자 무늬
  const netTex = tex(cv(128, 128, (c, W, H) => {
    c.clearRect(0, 0, W, H);
    c.strokeStyle = 'rgba(210,214,200,.95)';
    c.lineWidth = 2;
    for (let i = 0; i <= 8; i++) {
      c.beginPath(); c.moveTo((i * W) / 8, 0); c.lineTo((i * W) / 8, H); c.stroke();
      c.beginPath(); c.moveTo(0, (i * H) / 8); c.lineTo(W, (i * H) / 8); c.stroke();
    }
  }), true, [6, 3]);
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.45, 20, 4, true), new THREE.MeshStandardMaterial({ map: netTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.9 }));
  mesh.position.y = 1.735;
  mesh.rotation.x = Math.PI;
  g.add(mesh);
  return g;
}

// ================================================================
// 낚싯대 + 릴 + 찌 (1인칭)
// ================================================================
export const ROD = { butt: -0.4, blank0: 0.15, tip: 1.85 };
const GUIDES = [0.04, 0.17, 0.32, 0.48, 0.64, 0.8, 0.92];
const GUIDE_R = [0.018, 0.012, 0.0085, 0.0068, 0.0056, 0.0048, 0.0042];
const NS = 40; // 블랭크 마디
const BLANK_R0 = 0.0095;
const BLANK_R1 = 0.003;
const NR = 8;

function makeReel(color) {
  const g = new THREE.Group(); // 로컬 z = 낚싯대 앞쪽, y = 위, x = 왼쪽
  const black = shared('reel-black', () => new THREE.MeshPhysicalMaterial({ color: '#1b1d21', metalness: 0.6, roughness: 0.35, clearcoat: 0.6 }));
  const accent = new THREE.MeshPhysicalMaterial({ color, metalness: 0.45, roughness: 0.3, clearcoat: 0.9 });
  const metal = shared('metal', () => new THREE.MeshStandardMaterial({ color: '#cfd4d9', metalness: 1, roughness: 0.22 }));
  const lathe = (pts) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 22).rotateX(Math.PI / 2);
  const T = (x, y, z) => M4().makeTranslation(x, y, z);
  g.add(new THREE.Mesh(merged([
    [new THREE.BoxGeometry(0.01, 0.065, 0.026), T(0, -0.04, 0)],
    [new THREE.BoxGeometry(0.012, 0.006, 0.07), T(0, -0.01, 0)],
    [lathe([[0, -0.03], [0.022, -0.028], [0.03, -0.012], [0.031, 0.01], [0.026, 0.026], [0.012, 0.034], [0, 0.035]]), T(0, -0.085, -0.005)],
    [lathe([[0.012, 0], [0.028, 0.004], [0.031, 0.02], [0.029, 0.03]]), T(0, -0.085, 0.028)]
  ]), black));
  g.add(new THREE.Mesh(merged([
    [new THREE.CylinderGeometry(0.025, 0.025, 0.026, 24).rotateX(Math.PI / 2), T(0, -0.085, 0.07)],
    [new THREE.CylinderGeometry(0.031, 0.031, 0.006, 24).rotateX(Math.PI / 2), T(0, -0.085, 0.056)]
  ]), accent));
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.0215, 0.0215, 0.02, 24).rotateX(Math.PI / 2).translate(0, -0.085, 0.07), shared('spool-line', () => std('#ece6d8', 0.6))));
  const bail = new THREE.TorusGeometry(0.034, 0.0018, 6, 24, Math.PI).rotateY(Math.PI / 2);
  g.add(new THREE.Mesh(merged([
    [new THREE.TorusGeometry(0.025, 0.002, 6, 24), T(0, -0.085, 0.083)],
    [bail, T(0, -0.085, 0.05).multiply(M4().makeRotationX(-0.4))]
  ]), metal));
  // 핸들: 왼쪽(+x)으로 나온 축에 팔과 손잡이
  const crank = new THREE.Group();
  crank.position.set(0.034, -0.085, -0.004);
  crank.add(new THREE.Mesh(merged([
    [new THREE.CylinderGeometry(0.004, 0.004, 0.02, 8).rotateZ(Math.PI / 2), T(0.006, 0, 0)],
    [new THREE.BoxGeometry(0.006, 0.062, 0.008), T(0.014, 0.028, 0)],
    [new THREE.CylinderGeometry(0.003, 0.003, 0.02, 6).rotateZ(Math.PI / 2), T(0.024, 0.056, 0)]
  ]), metal));
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.009, 0.026, 12).rotateZ(Math.PI / 2).translate(0.042, 0.056, 0), accent);
  crank.add(knob);
  g.add(crank);
  g.userData.crank = crank;
  g.userData.spoolFront = new THREE.Vector3(0, -0.085, 0.085);
  return g;
}

// 찌: 윗부분이 그 사람 색, 아랫부분 흰색, 가운데 검은 띠, 위로 솟은 안테나
export function makeBobber(color) {
  const g = new THREE.Group();
  const R = 0.042;
  const top = new THREE.MeshPhysicalMaterial({ color, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08, emissive: color, emissiveIntensity: 0.12 });
  const white = shared('bobber-white', () => new THREE.MeshPhysicalMaterial({ color: '#f6f3ee', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 }));
  g.add(new THREE.Mesh(merged([
    [new THREE.SphereGeometry(R, 22, 12, 0, TAU, 0, Math.PI / 2)],
    [new THREE.CylinderGeometry(0.0065, 0.0065, 0.04, 8), M4().makeTranslation(0, R + 0.12, 0)]
  ]), top));
  g.add(new THREE.Mesh(merged([
    [new THREE.SphereGeometry(R, 22, 12, 0, TAU, Math.PI / 2, Math.PI / 2)],
    [new THREE.CylinderGeometry(0.0045, 0.0045, 0.11, 8), M4().makeTranslation(0, R + 0.05, 0)],
    [new THREE.CylinderGeometry(0.004, 0.002, 0.05, 6), M4().makeTranslation(0, -R - 0.02, 0)]
  ]), white));
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(R * 1.012, R * 1.012, R * 0.16, 22, 1, true), shared('bobber-band', () => std('#151515', 0.4))));
  g.userData.R = R;
  return g;
}

// 미끼: 바늘에 꿴 지렁이(물속에서 물고기가 코를 대는 것)
export function makeBait() {
  const g = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.012, -0.018, 0.004), new THREE.Vector3(-0.004, -0.036, -0.006),
    new THREE.Vector3(0.014, -0.05, 0.002), new THREE.Vector3(0.004, -0.066, 0.01)
  ]);
  const worm = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.0042, 6, false), shared('bait', () => underwater(new THREE.MeshStandardMaterial({ color: '#b0473f', roughness: 0.45 }), 'bait')));
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0011, 5, 12, Math.PI * 1.3).rotateZ(-Math.PI * 0.8).translate(0, -0.03, 0),
    shared('bait-metal', () => underwater(new THREE.MeshStandardMaterial({ color: '#c9ced3', metalness: 1, roughness: 0.3 }), 'bait-metal')));
  g.add(worm, hook);
  return g;
}

// 한 사람 낚싯대. pose() 가 매 프레임 손 위치·방향·휨으로 블랭크를 다시 짓습니다(새 객체를 만들지 않음).
export function makeRod(color) {
  const root = new THREE.Group();
  const rod = new THREE.Group(); // 손잡이 쪽(곧은 부분). 로컬 z = 낚싯대 방향, x = 왼쪽, y = 위
  const accentC = new THREE.Color(color);
  const metal = shared('metal', () => new THREE.MeshStandardMaterial({ color: '#cfd4d9', metalness: 1, roughness: 0.22 }));
  const gunmetal = shared('gunmetal', () => new THREE.MeshStandardMaterial({ color: '#3d4148', metalness: 0.9, roughness: 0.3 }));
  const accent = new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, clearcoat: 1 });
  const cork = shared('cork', () => std('#ffffff', 0.85, { map: corkTex }));
  const lathe = (prof) => new THREE.LatheGeometry(prof.map(([rr, z]) => new THREE.Vector2(rr, z)), 18).rotateX(Math.PI / 2);
  rod.add(new THREE.Mesh(merged([
    [lathe([[0.0135, -0.392], [0.0145, -0.33], [0.0142, -0.2], [0.0128, -0.08], [0.0122, -0.045]])],
    [lathe([[0.0104, 0.065], [0.0112, 0.08], [0.0108, 0.14], [0.0085, 0.16]])]
  ]), cork));
  rod.add(new THREE.Mesh(merged([
    [lathe([[0, -0.4], [0.014, -0.4], [0.0145, -0.392]])],
    [lathe([[0.0118, -0.045], [0.0122, -0.03], [0.0122, 0.05], [0.0108, 0.065]])]
  ]), gunmetal));
  rod.add(new THREE.Mesh(merged([
    [lathe([[0.0124, -0.034], [0.0126, -0.024], [0.0124, -0.018]])],
    [lathe([[0.0082, 0.158], [0.0086, 0.168], [0.0075, 0.18]])],
    [lathe([[0.0146, -0.36], [0.015, -0.35], [0.0146, -0.34]])]
  ]), accent));
  const reel = makeReel(color);
  reel.position.z = 0.012;
  rod.add(reel);
  root.add(rod);

  // 블랭크: 휜 척추를 따라 다시 짓는 가는 관. 가이드 자리는 그 사람 색 실로 감겨 있습니다(정점 색).
  const blankGeo = new THREE.BufferGeometry();
  const bpos = new Float32Array((NS + 1) * NR * 3);
  const bnor = new Float32Array((NS + 1) * NR * 3);
  const bcol = new Float32Array((NS + 1) * NR * 3);
  const bidx = [];
  for (let i = 0; i < NS; i++) {
    for (let j = 0; j < NR; j++) {
      const a = i * NR + j;
      const b = i * NR + ((j + 1) % NR);
      const c = (i + 1) * NR + j;
      const d = (i + 1) * NR + ((j + 1) % NR);
      bidx.push(a, c, b, b, c, d);
    }
  }
  const base = new THREE.Color('#1f2330');
  const wrapC = accentC.clone().lerp(base, 0.35);
  for (let i = 0; i <= NS; i++) {
    const u = i / NS;
    const wrap = GUIDES.some((gu) => Math.abs(u - gu) < 0.5 / NS) || u < 1.2 / NS;
    const c = wrap ? wrapC : base;
    for (let j = 0; j < NR; j++) {
      const k = (i * NR + j) * 3;
      bcol[k] = c.r;
      bcol[k + 1] = c.g;
      bcol[k + 2] = c.b;
    }
  }
  blankGeo.setAttribute('position', new THREE.BufferAttribute(bpos, 3));
  blankGeo.setAttribute('normal', new THREE.BufferAttribute(bnor, 3));
  blankGeo.setAttribute('color', new THREE.BufferAttribute(bcol, 3));
  blankGeo.setIndex(bidx);
  const blank = new THREE.Mesh(blankGeo, shared('blank', () => new THREE.MeshPhysicalMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.28, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06 })));
  blank.frustumCulled = false;
  root.add(blank);
  const tipTop = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 8, 6), metal);
  root.add(tipTop);
  // 가이드: 고리 + 다리를 한 덩어리로
  const guides = GUIDES.map((u, gi) => {
    const gr = GUIDE_R[gi];
    const off = gr + 0.006;
    const geo = merged([
      [new THREE.TorusGeometry(gr, Math.max(0.0013, gr * 0.15), 6, 16), M4().makeTranslation(0, -off, 0)],
      [new THREE.CylinderGeometry(0.0012, 0.0012, off, 5), M4().makeTranslation(0, -off / 2, 0)]
    ]);
    const m = new THREE.Mesh(geo, metal);
    m.userData = { u, off };
    root.add(m);
    return m;
  });

  const st = {
    spine: Array.from({ length: NS + 1 }, () => new THREE.Vector3()),
    fr: Array.from({ length: NS + 1 }, () => ({ t: new THREE.Vector3(), n: new THREE.Vector3(), b: new THREE.Vector3() })),
    tip: new THREE.Vector3(),
    guideP: guides.map(() => new THREE.Vector3()),
    spoolW: new THREE.Vector3(),
    side: new THREE.Vector3(), up: new THREE.Vector3(), d: new THREE.Vector3(),
    pull: new THREE.Vector3(), perp: new THREE.Vector3(), tip0: new THREE.Vector3(),
    m: new THREE.Matrix4()
  };
  const Y = new THREE.Vector3(0, 1, 0);

  function setBasis(obj, x, y, z, pos) {
    st.m.makeBasis(x, y, z);
    obj.quaternion.setFromRotationMatrix(st.m);
    obj.position.copy(pos);
  }

  // hand: 손(릴 시트) 위치, dir: 낚싯대 방향(단위), bend: 휨(0~1.25), pullTo: 줄이 당기는 점(없으면 아래), spin: 릴 핸들 각
  function pose(hand, dir, bend, pullTo, spin) {
    const d = st.d.copy(dir).normalize();
    const side = st.side.crossVectors(Y, d);
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    side.normalize();
    const up = st.up.crossVectors(d, side).normalize();
    setBasis(rod, side, up, d, hand);
    const Lb = ROD.tip - ROD.blank0;
    const tip0 = st.tip0.copy(hand).addScaledVector(d, ROD.tip);
    if (pullTo) st.pull.subVectors(pullTo, tip0).normalize();
    else st.pull.set(0, -1, 0);
    const perp = st.perp.copy(st.pull).addScaledVector(d, -st.pull.dot(d));
    const amt = Math.min(1.25, Math.max(0, bend));
    for (let i = 0; i <= NS; i++) {
      const u = i / NS;
      const s = ROD.blank0 + Lb * u;
      const p = st.spine[i].copy(hand).addScaledVector(d, s);
      p.addScaledVector(perp, amt * 0.62 * u * u);
      p.addScaledVector(up, -0.02 * u * u);
      p.addScaledVector(d, -amt * amt * 0.1 * u * u * u);
    }
    for (let i = 0; i <= NS; i++) {
      const f = st.fr[i];
      f.t.subVectors(st.spine[Math.min(NS, i + 1)], st.spine[Math.max(0, i - 1)]).normalize();
      f.n.copy(up).addScaledVector(f.t, -up.dot(f.t)).normalize();
      f.b.crossVectors(f.n, f.t);
    }
    for (let i = 0; i <= NS; i++) {
      const u = i / NS;
      const rad = BLANK_R0 * (1 - u) + BLANK_R1 * u + (GUIDES.some((gu) => Math.abs(u - gu) < 0.75 / NS) ? 0.0009 : 0);
      const f = st.fr[i];
      const c = st.spine[i];
      for (let j = 0; j < NR; j++) {
        const a = (j / NR) * TAU;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const nx = f.n.x * ca + f.b.x * sa;
        const ny = f.n.y * ca + f.b.y * sa;
        const nz = f.n.z * ca + f.b.z * sa;
        const k = (i * NR + j) * 3;
        bpos[k] = c.x + nx * rad;
        bpos[k + 1] = c.y + ny * rad;
        bpos[k + 2] = c.z + nz * rad;
        bnor[k] = nx;
        bnor[k + 1] = ny;
        bnor[k + 2] = nz;
      }
    }
    blankGeo.attributes.position.needsUpdate = true;
    blankGeo.attributes.normal.needsUpdate = true;
    st.tip.copy(st.spine[NS]);
    tipTop.position.copy(st.tip);
    guides.forEach((g, gi) => {
      const fi = Math.round(g.userData.u * NS);
      const f = st.fr[fi];
      setBasis(g, f.b, f.n, f.t, st.spine[fi]);
      st.guideP[gi].copy(st.spine[fi]).addScaledVector(f.n, -g.userData.off);
    });
    reel.userData.crank.rotation.x = -spin;
    rod.updateMatrixWorld(true);
    st.spoolW.copy(reel.userData.spoolFront).applyMatrix4(reel.matrixWorld);
  }

  function dispose() {
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && !o.material.userData.shared) o.material.dispose();
    });
  }
  return { root, rod, reel, blank, st, pose, dispose };
}
