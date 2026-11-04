// 홈런 더비 3D 경기장. 판정은 game.js 가 하고, 여기서는 그리기만 합니다.
// 좌표: 홈플레이트가 원점, +z 가 중견수 쪽, +x 가 좌익수 쪽(포수 뒤에서 보면 왼쪽), 단위는 m.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const RD = Math.PI / 180;
const Y = new THREE.Vector3(0, 1, 0);
export const fenceDist = (deg) => 98 + 24 * Math.cos(2 * deg * RD);
const onArc = (deg, r, y = 0) => new THREE.Vector3(r * Math.sin(deg * RD), y, r * Math.cos(deg * RD));

// ---------- 캔버스 텍스처 ----------
function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (opts.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  t.userData.canvas = c;
  return t;
}

function speckle(g, w, h, n, colors, size) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[(Math.random() * colors.length) | 0];
    const s = size * (0.5 + Math.random());
    g.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
}

const grassTex = canvasTex(512, 512, (g, w, h) => {
  // 바둑판 모양으로 깎은 잔디
  const a = '#3c8a44';
  const b = '#357b3d';
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      g.fillStyle = (i + j) % 2 ? a : b;
      g.fillRect(i * w / 2, j * h / 2, w / 2, h / 2);
    }
  }
  speckle(g, w, h, 14000, ['rgba(20,60,25,.35)', 'rgba(120,190,110,.18)', 'rgba(10,40,15,.25)'], 2);
}, { repeat: [100, 100] });
// 내야 잔디는 UV 가 m 단위라 따로 맞춥니다.
const infieldGrassTex = grassTex.clone();
infieldGrassTex.repeat.set(1 / 9, 1 / 9);
infieldGrassTex.needsUpdate = true;

const dirtTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#b57f4d';
  g.fillRect(0, 0, w, h);
  speckle(g, w, h, 22000, ['rgba(120,75,40,.35)', 'rgba(210,160,110,.3)', 'rgba(90,55,30,.25)'], 2.2);
}, { repeat: [0.12, 0.12] });

const trackTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#8a5a3a';
  g.fillRect(0, 0, w, h);
  speckle(g, w, h, 6000, ['rgba(60,35,20,.35)', 'rgba(170,120,80,.3)'], 2);
}, { repeat: [0.2, 0.2] });

const crowdTex = canvasTex(1024, 512, (g, w, h) => {
  g.fillStyle = '#141c2b';
  g.fillRect(0, 0, w, h);
  const rows = 36;
  const shirts = ['#d94b4b', '#f2f2f2', '#3a7bd5', '#f2c14e', '#1e3557', '#e86a3a', '#9ad1ff', '#2f2f38', '#c24b8e', '#58b368'];
  const skin = ['#f1c7a0', '#d9a77f', '#a8714f', '#7a4b33'];
  for (let r = 0; r < rows; r++) {
    const y = (r + 0.5) * (h / rows);
    g.fillStyle = r % 2 ? '#1a2333' : '#1d2738';
    g.fillRect(0, y - h / rows / 2, w, h / rows);
    for (let x = 4; x < w; x += 9 + Math.random() * 4) {
      if (Math.random() < 0.08) continue;
      g.fillStyle = shirts[(Math.random() * shirts.length) | 0];
      g.fillRect(x, y - 1, 7, 7);
      g.fillStyle = skin[(Math.random() * skin.length) | 0];
      g.beginPath();
      g.arc(x + 3.5, y - 3.5, 3, 0, Math.PI * 2);
      g.fill();
    }
  }
}, { repeat: [1, 1] });

const adTex = canvasTex(2048, 96, (g, w, h) => {
  const ads = [
    ['#0f2747', '#ffd23a', 'PHONE CONTROLLER GAMES'],
    ['#c8202f', '#ffffff', 'HOME RUN DERBY'],
    ['#f2efe6', '#0f2747', 'SWING YOUR PHONE'],
    ['#1f6f4a', '#ffffff', 'QR 찍고 바로 참가']
  ];
  const pw = w / ads.length;
  ads.forEach(([bg, fg, text], i) => {
    g.fillStyle = bg;
    g.fillRect(i * pw, 0, pw, h);
    g.fillStyle = fg;
    g.font = '800 46px "Pretendard Variable", Pretendard, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, i * pw + pw / 2, h / 2 + 2);
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.fillRect(i * pw, 0, 3, h);
  });
}, { repeat: [1, 1] });

const seamTex = canvasTex(256, 128, (g, w, h) => {
  g.fillStyle = '#f7f4ec';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#c8202f';
  g.lineWidth = 3;
  for (const off of [0, w / 2]) {
    g.beginPath();
    for (let x = 0; x <= w / 2; x += 2) {
      const y = h / 2 + Math.sin((x / (w / 2)) * Math.PI * 2) * h * 0.28 * (off ? -1 : 1);
      x ? g.lineTo(off + x, y) : g.moveTo(off + x, y);
    }
    g.stroke();
  }
});

const glowTex = canvasTex(128, 128, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,250,230,.55)');
  r.addColorStop(1, 'rgba(255,250,230,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, w, h);
});

const blobTex = canvasTex(128, 128, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, 'rgba(0,0,0,.55)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, w, h);
});

const lampTex = canvasTex(256, 128, (g, w, h) => {
  g.fillStyle = '#20252e';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 4; j++) {
      const x = 16 + i * 30;
      const y = 16 + j * 30;
      const r = g.createRadialGradient(x + 10, y + 10, 0, x + 10, y + 10, 13);
      r.addColorStop(0, '#ffffff');
      r.addColorStop(0.6, '#fff4cf');
      r.addColorStop(1, '#3a3a30');
      g.fillStyle = r;
      g.fillRect(x, y, 22, 22);
    }
  }
});

// ---------- 재질 ----------
const std = (color, roughness = 0.7, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });

// 바닥에 겹쳐 까는 평면들이 깜빡이지 않게 순서를 줍니다.
function flat(mat, order) {
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -order;
  mat.polygonOffsetUnits = -order * 4;
  return mat;
}

function shapeXZ(points, holes = []) {
  const s = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
  const geo = new THREE.ShapeGeometry(s, 24);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function stripGeometry(cols, rows, fn) {
  // fn(i, j) -> [x, y, z, u, v]
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const p = fn(i, j);
      pos.push(p[0], p[1], p[2]);
      uv.push(p[3], p[4]);
    }
  }
  for (let i = 0; i < cols - 1; i++) {
    for (let j = 0; j < rows - 1; j++) {
      const a = i * rows + j;
      const b = (i + 1) * rows + j;
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

// ---------- 선수 ----------
function ik(a, t, l1, l2, pole) {
  const d = new THREE.Vector3().subVectors(t, a);
  let len = d.length();
  const max = (l1 + l2) * 0.999;
  const min = Math.abs(l1 - l2) + 0.01;
  len = Math.min(max, Math.max(min, len));
  d.normalize();
  const x = (l1 * l1 - l2 * l2 + len * len) / (2 * len);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const p = pole.clone().sub(d.clone().multiplyScalar(pole.dot(d))).normalize();
  const joint = a.clone().addScaledVector(d, x).addScaledVector(p, h);
  const end = a.clone().addScaledVector(d, len);
  return { joint, end };
}

function placeSeg(mesh, a, b) {
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  const dir = new THREE.Vector3().subVectors(b, a);
  if (dir.lengthSq() < 1e-8) return;
  mesh.quaternion.setFromUnitVectors(Y, dir.normalize());
}

function lerpPose(keys, t) {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  let u = (t - a.t) / (b.t - a.t);
  u = Math.max(0, Math.min(1, u));
  u = u * u * (3 - 2 * u);
  const out = {};
  for (const k of Object.keys(a)) {
    if (k === 't') continue;
    const va = a[k];
    const vb = b[k];
    out[k] = Array.isArray(va) ? va.map((x, j) => x + (vb[j] - x) * u) : va + (vb - va) * u;
  }
  return out;
}

function fillKeys(keys) {
  for (let i = 1; i < keys.length; i++) {
    for (const k of Object.keys(keys[i - 1])) if (!(k in keys[i])) keys[i][k] = keys[i - 1][k];
  }
  return keys;
}

// 우타자. 몸 앞(+z)이 홈플레이트, 왼쪽(+x)이 투수 쪽입니다.
const BAT_KEYS = fillKeys([
  { t: 0, hipY: 0.9, hipYaw: 0, torsoYaw: -0.2, lean: 0.16, headYaw: 1.35,
    footL: [0.38, 0.07, 0.04], footR: [-0.33, 0.07, 0], grip: [-0.2, 1.4, 0.16], dir: [-0.28, 0.88, -0.38] },
  { t: 0.3, hipYaw: -0.22, torsoYaw: -0.45, footL: [0.3, 0.2, 0.04], grip: [-0.3, 1.42, 0.06], dir: [-0.12, 0.72, -0.68] },
  { t: 0.5, hipY: 0.86, hipYaw: 0.95, torsoYaw: 0.8, lean: 0.24, headYaw: 0.9,
    footL: [0.5, 0.07, 0.06], grip: [0.04, 1.08, 0.36], dir: [-0.1, -0.16, 0.98] },
  { t: 0.66, hipYaw: 1.2, torsoYaw: 1.3, grip: [0.3, 1.14, 0.3], dir: [0.86, 0.02, 0.5] },
  { t: 1, hipY: 0.9, hipYaw: 1.35, torsoYaw: 1.75, lean: 0.06, headYaw: 0.6,
    footR: [-0.25, 0.12, 0.08], grip: [0.08, 1.55, -0.08], dir: [-0.55, 0.38, -0.74] }
]);

// 우완 투수. 몸 앞(+z)이 홈 쪽입니다.
const PITCH_KEYS = fillKeys([
  { t: 0, hipY: 0.95, hipYaw: 0, torsoYaw: 0, lean: 0.06, headYaw: 0,
    footL: [0.17, 0.07, 0.08], footR: [-0.15, 0.07, 0], handR: [-0.04, 1.22, 0.22], handL: [0.06, 1.22, 0.24] },
  { t: 0.35, hipYaw: -1.25, torsoYaw: -1.35, headYaw: 0,
    footL: [0.02, 0.62, 0.12], handR: [0.0, 1.38, 0.05], handL: [0.06, 1.38, 0.08] },
  { t: 0.65, hipY: 0.84, hipYaw: -0.9, torsoYaw: -1.3,
    footL: [0.05, 0.09, 0.85], footR: [-0.1, 0.07, -0.05], handR: [-0.18, 1.5, -0.62], handL: [0.12, 1.45, 0.55] },
  { t: 0.86, hipYaw: 0.15, torsoYaw: -0.35, lean: 0.18, handR: [-0.4, 1.85, -0.25], handL: [0.26, 1.3, 0.45] },
  { t: 1, hipY: 0.82, hipYaw: 0.4, torsoYaw: 0.5, lean: 0.45,
    footL: [0.05, 0.07, 0.95], footR: [-0.1, 0.24, -0.1], handR: [-0.25, 1.72, 0.62], handL: [0.3, 1.1, 0.15] },
  { t: 1.4, hipY: 0.8, hipYaw: 0.6, torsoYaw: 0.95, lean: 0.75,
    footR: [-0.05, 0.12, 0.35], handR: [0.35, 0.75, 0.55], handL: [0.3, 1.0, 0.0] }
]);

const READY = { hipY: 0.78, hipYaw: 0, torsoYaw: 0, lean: 0.42, headYaw: 0,
  footL: [0.3, 0.07, 0.02], footR: [-0.3, 0.07, 0], handR: [-0.16, 0.82, 0.38], handL: [0.16, 0.82, 0.38] };

function makePlayer(o) {
  const g = new THREE.Group();
  const jersey = std(o.jersey, 0.62);
  const pants = std(o.pants || '#efeee8', 0.8);
  const socks = std(o.socks || o.jersey, 0.7);
  const skin = std(o.skin || '#e2ae86', 0.65);
  const dark = std('#15171c', 0.5);
  const capMat = o.helmet
    ? new THREE.MeshPhysicalMaterial({ color: o.cap, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.15 })
    : std(o.cap, 0.6);
  const handMat = o.batGloves ? std('#f4f4f2', 0.6) : skin;
  const mk = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 6, 12);
  const P = {
    pelvis: mk(new THREE.CapsuleGeometry(0.13, 0.12, 6, 12).rotateZ(Math.PI / 2), pants),
    belt: mk(new THREE.CylinderGeometry(0.16, 0.16, 0.045, 18), dark),
    torso: mk(new THREE.CapsuleGeometry(0.175, 0.3, 8, 16).scale(1.12, 1, 0.72), jersey),
    neck: mk(new THREE.CylinderGeometry(0.055, 0.06, 0.1, 10), skin),
    thighL: mk(cap(0.082, 0.44), pants), thighR: mk(cap(0.082, 0.44), pants),
    shinL: mk(cap(0.062, 0.44), socks), shinR: mk(cap(0.062, 0.44), socks),
    shoeL: mk(new THREE.BoxGeometry(0.11, 0.075, 0.27), dark), shoeR: mk(new THREE.BoxGeometry(0.11, 0.075, 0.27), dark),
    upperL: mk(cap(0.06, 0.3), jersey), upperR: mk(cap(0.06, 0.3), jersey),
    foreL: mk(cap(0.048, 0.29), skin), foreR: mk(cap(0.048, 0.29), skin),
    handL: mk(o.glove ? new THREE.SphereGeometry(0.11, 14, 10).scale(1, 1.15, 0.55) : new THREE.SphereGeometry(0.052, 12, 8),
      o.glove ? std('#7a4520', 0.55) : handMat),
    handR: mk(new THREE.SphereGeometry(0.052, 12, 8), handMat)
  };
  // 머리
  const head = new THREE.Group();
  g.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 14), skin);
  skull.castShadow = true;
  head.add(skull);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(o.helmet ? 0.138 : 0.124, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), capMat);
  dome.position.y = 0.012;
  dome.castShadow = true;
  head.add(dome);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.012, 20, 1, false, -Math.PI / 2, Math.PI), capMat);
  brim.position.set(0, 0.012, 0.06);
  head.add(brim);
  if (o.helmet) {
    // 투수 쪽 귀 덮개
    const flap = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10, 0, Math.PI, 0, Math.PI * 0.6), capMat);
    flap.rotation.set(0, Math.PI / 2, 0);
    flap.position.set(0.09, -0.03, -0.01);
    head.add(flap);
  }
  P.head = head;

  // 방망이
  let bat = null;
  if (o.bat) {
    const prof = [[0, 0], [0.028, 0], [0.03, 0.012], [0.016, 0.03], [0.0135, 0.24], [0.018, 0.42], [0.029, 0.57],
      [0.0335, 0.71], [0.0335, 0.83], [0.028, 0.858], [0, 0.862]].map(([r, y]) => new THREE.Vector2(r, y));
    bat = new THREE.Mesh(new THREE.LatheGeometry(prof, 20),
      new THREE.MeshPhysicalMaterial({ color: '#d7aa70', roughness: 0.35, clearcoat: 0.6 }));
    bat.castShadow = true;
    g.add(bat);
  }

  // 발밑 그림자
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2),
    flat(new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }), 6));
  blob.position.y = 0.01;
  g.add(blob);

  const v = (a) => new THREE.Vector3(a[0], a[1], a[2]);

  function pose(p) {
    const pelvis = new THREE.Vector3(0, p.hipY, 0);
    P.pelvis.position.copy(pelvis);
    P.pelvis.rotation.set(0, p.hipYaw, 0);
    const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.lean, p.torsoYaw, 0, 'YXZ'));
    const up = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(tq).add(pelvis);
    P.belt.position.copy(up(0, 0.1, 0));
    P.belt.quaternion.copy(tq);
    P.torso.position.copy(up(0, 0.33, 0));
    P.torso.quaternion.copy(tq);
    const neck = up(0, 0.6, 0);
    P.neck.position.copy(neck);
    P.neck.quaternion.copy(tq);
    P.head.position.copy(up(0, 0.72, 0));
    P.head.rotation.set(p.lean * 0.4, p.headYaw, 0, 'YXZ');

    // 다리
    const hq = new THREE.Quaternion().setFromAxisAngle(Y, p.hipYaw);
    for (const [side, s] of [['L', 1], ['R', -1]]) {
      const hip = new THREE.Vector3(s * 0.1, -0.06, 0).applyQuaternion(hq).add(pelvis);
      const foot = v(p['foot' + side]);
      const pole = new THREE.Vector3(s * 0.15, 0, 1).applyQuaternion(hq);
      const { joint, end } = ik(hip, foot, 0.44, 0.44, pole);
      placeSeg(P['thigh' + side], hip, joint);
      placeSeg(P['shin' + side], joint, end);
      const shoe = P['shoe' + side];
      shoe.position.set(end.x, Math.max(0.04, end.y - 0.03), end.z).addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(hq), 0.05);
      shoe.quaternion.copy(hq);
    }

    // 팔
    let handL = p.handL && v(p.handL);
    let handR = p.handR && v(p.handR);
    let dir = null;
    if (p.grip) {
      dir = v(p.dir).normalize();
      handL = v(p.grip);
      handR = handL.clone().addScaledVector(dir, 0.1);
    }
    const reached = {};
    for (const [side, s, target] of [['L', 1, handL], ['R', -1, handR]]) {
      const sh = up(s * 0.2, 0.5, 0);
      const pole = new THREE.Vector3(s * 0.5, -1, -0.35).applyQuaternion(tq);
      const { joint, end } = ik(sh, target, 0.3, 0.29, pole);
      placeSeg(P['upper' + side], sh, joint);
      placeSeg(P['fore' + side], joint, end);
      P['hand' + side].position.copy(end);
      P['hand' + side].quaternion.copy(tq);
      reached[side] = end;
    }
    if (bat && dir) {
      bat.position.copy(reached.L).addScaledVector(dir, -0.05);
      bat.quaternion.setFromUnitVectors(Y, dir);
    }
    return reached;
  }

  return { group: g, pose, bat, parts: P };
}

// ---------- 장면 ----------
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#18284a', 170, 560);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 1500);

  // 하늘
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {},
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: `varying vec3 vP;
        void main(){
          float h = clamp(vP.y, -0.1, 1.0);
          vec3 top = vec3(0.012, 0.025, 0.07);
          vec3 mid = vec3(0.05, 0.09, 0.2);
          vec3 hor = vec3(0.16, 0.18, 0.34);
          vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, h));
          c = mix(c, top, smoothstep(0.18, 0.75, h));
          gl_FragColor = vec4(c, 1.0);
        }`
    })
  );
  scene.add(sky);
  {
    const n = 1400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(0.15 + Math.random() * 0.85);
      pos.set([Math.sin(ph) * Math.cos(th) * 850, Math.cos(ph) * 850, Math.sin(ph) * Math.sin(th) * 850], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: '#cfd8ff', size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.7 })));
  }

  // 빛
  scene.add(new THREE.HemisphereLight('#a9bfff', '#24432a', 0.7));
  const key = new THREE.DirectionalLight('#fff3dc', 2.6);
  key.position.set(-30, 70, -40);
  key.target.position.set(0, 0, 12);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -28;
  key.shadow.camera.right = 28;
  key.shadow.camera.top = 30;
  key.shadow.camera.bottom = -14;
  key.shadow.camera.near = 20;
  key.shadow.camera.far = 160;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight('#cfe0ff', 0.9);
  fill.position.set(40, 50, 80);
  scene.add(fill);

  // 바닥 잔디
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), std('#ffffff', 0.95, { map: grassTex }));
  grass.receiveShadow = true;
  scene.add(grass);

  // 펜스 앞 경고 트랙
  {
    const cols = 61;
    const geo = stripGeometry(cols, 2, (i, j) => {
      const deg = -46 + (92 * i) / (cols - 1);
      const r = fenceDist(deg) - (j ? 0 : 4.6);
      const p = onArc(deg, r, 0.02);
      return [p.x, p.y, p.z, p.x * 0.2, p.z * 0.2];
    });
    const m = new THREE.Mesh(geo, flat(std('#ffffff', 0.95, { map: trackTex }), 1));
    m.receiveShadow = true;
    scene.add(m);
  }

  // 내야 흙: 29m 부채꼴 + 홈 주변 원
  {
    const pts = [];
    for (let d = -45; d <= 45; d += 3) pts.push([29 * Math.sin(d * RD), 29 * Math.cos(d * RD)]);
    // 홈 쪽 둥근 끝
    for (let d = 135; d <= 225; d += 10) pts.push([5.2 * Math.sin(d * RD), 5.2 * Math.cos(d * RD)]);
    const m = new THREE.Mesh(shapeXZ(pts), flat(std('#ffffff', 0.95, { map: dirtTex }), 1));
    m.position.y = 0.02;
    m.receiveShadow = true;
    scene.add(m);
    // 내야 잔디 (모서리를 깎은 다이아몬드)
    const ig = shapeXZ([[0, 4.2], [-15.6, 19.4], [-14.2, 21.4], [0, 34.6], [14.2, 21.4], [15.6, 19.4]]);
    const im = new THREE.Mesh(ig, flat(std('#ffffff', 0.95, { map: infieldGrassTex }), 2));
    im.position.y = 0.03;
    im.receiveShadow = true;
    scene.add(im);
    // 베이스 주변 흙 원
    for (const [x, z] of [[-19.4, 19.4], [19.4, 19.4], [0, 38.8]]) {
      const c = new THREE.Mesh(new THREE.CircleGeometry(2.8, 28).rotateX(-Math.PI / 2), flat(std('#ffffff', 0.95, { map: dirtTex }), 3));
      c.position.set(x, 0.04, z);
      c.receiveShadow = true;
      scene.add(c);
    }
  }

  // 분필 선
  const chalk = std('#f4f2ea', 0.9, { emissive: '#404040' });
  const chalkLine = (a, b, w = 0.09) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len).rotateX(-Math.PI / 2), flat(chalk.clone(), 4));
    m.position.set((a.x + b.x) / 2, 0.05, (a.z + b.z) / 2);
    m.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    m.receiveShadow = true;
    scene.add(m);
  };
  chalkLine(new THREE.Vector3(0.25, 0, 0.25), onArc(45, fenceDist(45)));
  chalkLine(new THREE.Vector3(-0.25, 0, 0.25), onArc(-45, fenceDist(45)));
  for (const s of [1, -1]) {
    const x0 = s * 0.45;
    const x1 = s * 1.67;
    const V3 = (x, z) => new THREE.Vector3(x, 0, z);
    chalkLine(V3(x0, -0.92), V3(x0, 0.92), 0.07);
    chalkLine(V3(x1, -0.92), V3(x1, 0.92), 0.07);
    chalkLine(V3(x0, 0.92), V3(x1, 0.92), 0.07);
    chalkLine(V3(x0, -0.92), V3(x1, -0.92), 0.07);
  }

  // 홈플레이트, 베이스, 마운드
  {
    const plate = new THREE.Mesh(shapeXZ([[-0.216, 0.216], [0.216, 0.216], [0.216, 0], [0, -0.216], [-0.216, 0]]),
      flat(std('#ffffff', 0.6), 5));
    plate.position.y = 0.055;
    scene.add(plate);
    for (const [x, z] of [[-19.4, 19.4], [19.4, 19.4], [0, 38.8]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.09, 0.38), std('#ffffff', 0.6));
      b.position.set(x, 0.05, z);
      b.rotation.y = Math.PI / 4;
      b.castShadow = true;
      scene.add(b);
    }
    const mound = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.75, 0.25, 40), std('#ffffff', 0.95, { map: dirtTex }));
    mound.position.set(0, 0.125, 18.44);
    mound.receiveShadow = true;
    scene.add(mound);
    const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.61, 0.03, 0.15), std('#ffffff', 0.6));
    rubber.position.set(0, 0.26, 18.44);
    scene.add(rubber);
  }

  // 펜스
  {
    const cols = 91;
    const wall = stripGeometry(cols, 2, (i, j) => {
      const deg = -45 + (90 * i) / (cols - 1);
      const p = onArc(deg, fenceDist(deg), j ? 3.0 : 0);
      return [p.x, p.y, p.z, i / 6, j];
    });
    const wm = new THREE.Mesh(wall, std('#16422c', 0.85, { side: THREE.DoubleSide }));
    wm.receiveShadow = true;
    scene.add(wm);
    const curve = new THREE.CatmullRomCurve3(Array.from({ length: 31 }, (_, i) => onArc(-45 + i * 3, fenceDist(-45 + i * 3) - 0.05, 3.02)));
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.07, 6), std('#ffd23a', 0.5, { emissive: '#7a5a00' })));
    // 거리 표시
    for (const deg of [-45, -24, 0, 24, 45]) {
      const d = Math.round(fenceDist(deg));
      const tex = canvasTex(256, 128, (g, w, h) => {
        g.clearRect(0, 0, w, h);
        g.fillStyle = '#ffffff';
        g.font = '400 104px Anton, Impact, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(d), w / 2, h / 2 + 4);
      });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.7), new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: true }));
      const p = onArc(deg, fenceDist(deg) - 0.08, 1.6);
      sign.position.copy(p);
      sign.rotation.y = Math.atan2(-p.x, -p.z);
      scene.add(sign);
    }
    // 폴대
    for (const s of [1, -1]) {
      const p = onArc(45 * s, fenceDist(45));
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 26, 10), std('#ffd23a', 0.4, { emissive: '#8a6a00' }));
      pole.position.set(p.x, 13, p.z);
      scene.add(pole);
    }
  }

  // 관중석: 외야 펜스에서 시작해 파울 라인 뒤로 홈 근처까지 감싸는 그릇 모양
  const standRin = (deg) => {
    const a = Math.abs(deg);
    if (a <= 45) return fenceDist(deg) + 0.7;
    const u = (a - 45) / 37;
    return fenceDist(45) + 0.7 - (fenceDist(45) - 27) * (1 - Math.pow(1 - u, 1.6));
  };
  const BOWL_COLS = 83;
  const bowlDeg = (i) => -82 + (164 * i) / (BOWL_COLS - 1);
  function bowl(prof, uPerM, vAt, mat) {
    const geo = stripGeometry(BOWL_COLS, prof.length, (i, j) => {
      const deg = bowlDeg(i);
      const r = standRin(deg) + prof[j][0];
      const p = onArc(deg, r, prof[j][1]);
      const arc = deg * RD * (standRin(0) + 10);
      return [p.x, p.y, p.z, arc * uPerM, vAt[j]];
    });
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  {
    // 앞벽은 광고판, 그 위로 관중, 맨 뒤는 어두운 벽
    bowl([[0, 0.05], [0, 4.2]], 1 / 96, [0, 1], new THREE.MeshBasicMaterial({ map: adTex, side: THREE.DoubleSide, color: new THREE.Color(0.85, 0.85, 0.85) }));
    bowl([[0, 4.2], [1.4, 4.2]], 0, [0, 1], std('#1b2638', 0.8, { side: THREE.DoubleSide }));
    // 한 사람이 가로 0.55m 쯤 되게 맞춥니다.
    bowl([[1.4, 4.2], [26, 16.5]], 1 / 52, [0, 1], new THREE.MeshLambertMaterial({ map: crowdTex, emissive: '#ffffff', emissiveMap: crowdTex, emissiveIntensity: 0.32, side: THREE.DoubleSide }));
    bowl([[26, 16.5], [27.5, 16.5], [27.5, 24]], 0, [0, 0.5, 1], std('#121a28', 0.8, { side: THREE.DoubleSide }));
    // 관중석 앞 벽(파울 지역 쪽)
    const lip = new THREE.CatmullRomCurve3(Array.from({ length: 42 }, (_, i) => onArc(-82 + i * 4, standRin(-82 + i * 4) - 0.1, 4.25)));
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(lip, 200, 0.1, 6), std('#2b3a55', 0.6)));
    // 지붕 테두리 불빛
    const rim = new THREE.CatmullRomCurve3(Array.from({ length: 42 }, (_, i) => onArc(-82 + i * 4, standRin(-82 + i * 4) + 27.6, 24.1)));
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(rim, 240, 0.25, 6), new THREE.MeshBasicMaterial({ color: '#9fd0ff', toneMapped: false })));
  }

  // 조명탑
  for (const deg of [-62, -28, 28, 62]) {
    const base = onArc(deg, standRin(deg) + 31, 0);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 48, 10), std('#2a3140', 0.6));
    pole.position.set(base.x, 24, base.z);
    scene.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 0.8),
      [std('#20252e'), std('#20252e'), std('#20252e'), std('#20252e'),
        new THREE.MeshBasicMaterial({ map: lampTex, toneMapped: false, color: new THREE.Color(2.2, 2.1, 1.8) }), std('#20252e')]);
    head.position.set(base.x, 50, base.z);
    head.lookAt(0, 0, 30);
    scene.add(head);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff2cc', transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    glow.scale.set(34, 34, 1);
    glow.position.copy(head.position).add(new THREE.Vector3(-base.x, -50, 30 - base.z).normalize().multiplyScalar(1.2));
    scene.add(glow);
  }

  // 전광판
  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = 1024;
  boardCanvas.height = 448;
  const boardTex = new THREE.CanvasTexture(boardCanvas);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  {
    const z = standRin(0) + 31;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(36, 17, 1.2), std('#141922', 0.5));
    frame.position.set(0, 30, z);
    scene.add(frame);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(34, 14.9), new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false, color: new THREE.Color(1.25, 1.25, 1.25) }));
    screen.position.set(0, 30, z - 0.62);
    screen.rotation.y = Math.PI;
    scene.add(screen);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.4, 22, 1.4), std('#141922', 0.5));
      leg.position.set(s * 12, 11, z);
      scene.add(leg);
    }
  }
  function drawBoard(info) {
    const g = boardCanvas.getContext('2d');
    const w = boardCanvas.width;
    const h = boardCanvas.height;
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0b1426');
    bg.addColorStop(1, '#13233f');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    // LED 격자
    g.fillStyle = 'rgba(0,0,0,.18)';
    for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h);
    for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (info.big) {
      g.fillStyle = info.color || '#ffd23a';
      g.font = '400 190px Anton, Impact, sans-serif';
      g.fillText(info.big, w / 2, h * 0.42);
      g.fillStyle = '#ffffff';
      g.font = '400 70px Anton, Impact, sans-serif';
      g.fillText(info.sub || '', w / 2, h * 0.8);
    } else {
      g.fillStyle = '#ffd23a';
      g.font = '400 64px Anton, Impact, sans-serif';
      g.fillText('HOME RUN DERBY', w / 2, 70);
      g.fillStyle = info.color || '#ffffff';
      g.font = '800 150px "Pretendard Variable", Pretendard, sans-serif';
      g.fillText(info.name || 'PLAY BALL', w / 2, h * 0.52);
      g.fillStyle = '#c9d6ea';
      g.font = '600 52px "Pretendard Variable", Pretendard, sans-serif';
      g.fillText(info.sub || '', w / 2, h * 0.84);
    }
    boardTex.needsUpdate = true;
  }
  drawBoard({ name: 'PLAY BALL', sub: 'QR을 찍고 참가하세요' });

  // 선수들
  const pitcher = makePlayer({ jersey: '#b9bec7', cap: '#1d2e4f', socks: '#1d2e4f', glove: true });
  pitcher.group.position.set(0, 0.25, 18.6);
  pitcher.group.rotation.y = Math.PI;
  scene.add(pitcher.group);

  let batter = null;
  function setBatter(color) {
    if (batter) scene.remove(batter.group);
    const c = new THREE.Color(color);
    const sock = c.clone().multiplyScalar(0.55);
    batter = makePlayer({ jersey: color, cap: color, socks: `#${sock.getHexString()}`, helmet: true, bat: true, batGloves: true });
    batter.group.position.set(0.98, 0, 0.02);
    batter.group.rotation.y = -Math.PI / 2;
    scene.add(batter.group);
  }
  setBatter('#ff5a5f');

  const FIELD_SPOTS = [[-20, 25], [-8.5, 37], [8.5, 37], [20, 25], [42, 80], [0, 93], [-42, 80]];
  const fielders = FIELD_SPOTS.map(([x, z]) => {
    const f = makePlayer({ jersey: '#1f3a66', cap: '#1f3a66', socks: '#14284a', glove: true });
    f.home = new THREE.Vector3(x, 0, z);
    f.group.position.copy(f.home);
    f.group.rotation.y = Math.atan2(-x, -z);
    f.run = null;
    scene.add(f.group);
    return f;
  });

  // 공
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.05, 24, 16), std('#ffffff', 0.5, { map: seamTex }));
  ball.castShadow = true;
  scene.add(ball);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffffff', transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.set(0.32, 0.32, 1);
  ball.add(halo);
  const ballShadow = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3).rotateX(-Math.PI / 2),
    flat(new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }), 7));
  scene.add(ballShadow);

  // 타구 궤적
  const trailMat = new LineMaterial({ color: '#ffffff', linewidth: 5, transparent: true, opacity: 0.85, toneMapped: false });
  let trail = null;
  const landMark = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.3, 32).rotateX(-Math.PI / 2),
    flat(new THREE.MeshBasicMaterial({ color: '#ffd23a', transparent: true, opacity: 0.9, toneMapped: false }), 8));
  landMark.visible = false;
  scene.add(landMark);

  function startHit(path, opts) {
    if (trail) {
      scene.remove(trail);
      trail.geometry.dispose();
    }
    const flatPts = [];
    for (let i = 0; i < path.length; i += 2) flatPts.push(path[i][0], path[i][1], path[i][2]);
    const geo = new LineGeometry();
    geo.setPositions(flatPts);
    trailMat.color.set(opts.color || '#ffffff');
    trail = new Line2(geo, trailMat);
    trail.computeLineDistances();
    trail.geometry.instanceCount = 0;
    trail.userData.n = flatPts.length / 3;
    scene.add(trail);
    // 떨어질 곳에 가장 가까운 야수가 달려갑니다.
    const last = path[path.length - 1];
    const land = new THREE.Vector3(last[0], 0, last[2]);
    if (!opts.homer && !opts.foul) {
      let best = null;
      for (const f of fielders) {
        const d = f.home.distanceTo(land);
        if (!best || d < best.d) best = { f, d };
      }
      if (best) best.f.run = { to: land, t0: performance.now() };
    }
  }
  function clearHit() {
    if (trail) {
      scene.remove(trail);
      trail.geometry.dispose();
      trail = null;
    }
    landMark.visible = false;
    for (const f of fielders) {
      f.run = null;
      f.group.position.copy(f.home);
      f.group.rotation.y = Math.atan2(-f.home.x, -f.home.z);
    }
  }

  // 불꽃놀이
  const FW = 1600;
  const fwPos = new Float32Array(FW * 3);
  const fwCol = new Float32Array(FW * 3);
  const fwVel = new Float32Array(FW * 3);
  const fwLife = new Float32Array(FW);
  const fwGeo = new THREE.BufferGeometry();
  fwGeo.setAttribute('position', new THREE.BufferAttribute(fwPos, 3));
  fwGeo.setAttribute('color', new THREE.BufferAttribute(fwCol, 3));
  const fw = new THREE.Points(fwGeo, new THREE.PointsMaterial({ size: 1.4, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, map: glowTex, toneMapped: false, fog: false }));
  fw.frustumCulled = false;
  scene.add(fw);
  let fwNext = 0;
  const fwQueue = [];
  function fireworks(color) {
    const palette = [color || '#ffd23a', '#ffd23a', '#ffffff', '#ff5a5f', '#3ab4ff', '#5ee07a'];
    for (let b = 0; b < 7; b++) fwQueue.push({ at: performance.now() + b * 260, col: new THREE.Color(palette[b % palette.length]) });
  }
  function burst(col) {
    const c = new THREE.Vector3((Math.random() - 0.5) * 120, 45 + Math.random() * 35, 120 + Math.random() * 60);
    for (let i = 0; i < 180; i++) {
      const k = fwNext;
      fwNext = (fwNext + 1) % FW;
      const v = new THREE.Vector3().randomDirection().multiplyScalar(9 + Math.random() * 7);
      fwPos.set([c.x, c.y, c.z], k * 3);
      fwVel.set([v.x, v.y, v.z], k * 3);
      fwCol.set([col.r * 2, col.g * 2, col.b * 2], k * 3);
      fwLife[k] = 1;
    }
  }
  function updateFireworks(dt, now) {
    while (fwQueue.length && fwQueue[0].at <= now) burst(fwQueue.shift().col);
    for (let k = 0; k < FW; k++) {
      if (fwLife[k] <= 0) continue;
      fwLife[k] -= dt * 0.55;
      fwVel[k * 3 + 1] -= 6 * dt;
      for (let a = 0; a < 3; a++) {
        fwVel[k * 3 + a] *= 1 - 1.2 * dt;
        fwPos[k * 3 + a] += fwVel[k * 3 + a] * dt;
      }
      const l = Math.max(0, fwLife[k]);
      if (l <= 0) fwPos[k * 3 + 1] = -999;
      fwCol[k * 3] *= 0.995;
      fwCol[k * 3 + 1] *= 0.993;
      fwCol[k * 3 + 2] *= 0.993;
    }
    fwGeo.attributes.position.needsUpdate = true;
    fwGeo.attributes.color.needsUpdate = true;
  }

  // 화면 효과
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.55, 0.86);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    trailMat.resolution.set(w, h);
  }
  window.addEventListener('resize', resize);
  resize();

  // 카메라
  const camPos = new THREE.Vector3(60, 40, -40);
  const camLook = new THREE.Vector3(0, 0, 50);
  const tPos = new THREE.Vector3();
  const tLook = new THREE.Vector3();
  let tFov = 32;
  // 화면 비율이 좁으면 조금 물러납니다.
  const pitchPos = () => {
    const narrow = Math.max(0, 1.6 - camera.aspect);
    return new THREE.Vector3(-0.8 - narrow * 0.3, 2.7 + narrow * 0.5, -9.5 - narrow * 3);
  };
  const PITCH_LOOK = new THREE.Vector3(0.3, 1.2, 18);

  let last = performance.now();
  let followY = 0;

  function frame(now, v) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // 투수
    const pp = v.pitchP == null ? 0 : v.pitchP;
    const breath = Math.sin(now / 700) * 0.01;
    const ppose = lerpPose(PITCH_KEYS, pp);
    ppose.hipY += breath;
    const pr = pitcher.pose(ppose);
    pitcher.group.updateMatrixWorld();

    // 타자
    if (batter) {
      let bp;
      if (v.swingT == null) {
        bp = lerpPose(BAT_KEYS, 0);
        const wag = Math.sin(now / 260) * 0.08;
        bp.dir = [bp.dir[0] + wag, bp.dir[1], bp.dir[2] - wag * 0.6];
        bp.hipY += Math.sin(now / 520) * 0.006;
      } else {
        bp = lerpPose(BAT_KEYS, v.swingT);
      }
      batter.pose(bp);
    }

    // 야수
    for (const f of fielders) {
      let pose = { ...READY, hipY: READY.hipY + Math.sin(now / 600 + f.home.x) * 0.01 };
      if (f.run) {
        const to = f.run.to;
        const pos = f.group.position;
        const d = Math.hypot(to.x - pos.x, to.z - pos.z);
        if (d > 0.6) {
          const step = Math.min(d, 7.5 * dt);
          pos.x += ((to.x - pos.x) / d) * step;
          pos.z += ((to.z - pos.z) / d) * step;
          f.group.rotation.y = Math.atan2(to.x - pos.x, to.z - pos.z);
          const ph = now / 95;
          const s = Math.sin(ph);
          pose = { hipY: 0.92 + Math.abs(Math.cos(ph)) * 0.04, hipYaw: s * 0.15, torsoYaw: -s * 0.2, lean: 0.3, headYaw: 0,
            footL: [0.12, 0.08 + Math.max(0, s) * 0.3, s * 0.42], footR: [-0.12, 0.08 + Math.max(0, -s) * 0.3, -s * 0.42],
            handL: [0.22, 1.15 - s * 0.1, -s * 0.3 + 0.1], handR: [-0.22, 1.15 + s * 0.1, s * 0.3 + 0.1] };
        } else {
          f.group.rotation.y = Math.atan2(-pos.x, -pos.z);
          pose = { ...READY, hipY: 0.9, lean: 0.15, handL: [0.15, 1.95, 0.25], handR: [-0.05, 1.9, 0.3] };
        }
      }
      f.pose(pose);
    }

    // 공
    if (v.ball === 'hand') {
      const hp = pr.R.clone().applyMatrix4(pitcher.group.matrixWorld);
      ball.position.copy(hp);
      ball.visible = true;
    } else if (v.ball) {
      ball.position.set(v.ball[0], v.ball[1], v.ball[2]);
      ball.visible = true;
      ball.rotation.x += dt * 40;
    } else {
      ball.visible = false;
    }
    ballShadow.visible = ball.visible && ball.position.y > 0.06;
    ballShadow.position.set(ball.position.x, 0.03, ball.position.z);
    const sh = 1 + ball.position.y * 0.08;
    ballShadow.scale.set(sh, 1, sh);
    halo.material.opacity = v.mode === 'hit' ? 0.8 : 0.45;
    halo.scale.setScalar(v.mode === 'hit' ? 1.4 : 0.32);

    if (trail && v.hitI != null) {
      trail.geometry.instanceCount = Math.max(0, Math.min(trail.userData.n - 1, Math.floor(v.hitI / 2)));
    }
    if (v.landing) {
      landMark.visible = true;
      landMark.position.set(v.landing[0], 0.06, v.landing[1]);
      landMark.scale.setScalar(1 + Math.sin(now / 120) * 0.08);
    }

    // 카메라
    let k = 3;
    if (v.mode === 'pitch') {
      tPos.copy(pitchPos());
      tLook.copy(PITCH_LOOK);
      tFov = 26;
      k = 4;
    } else if (v.mode === 'hit') {
      const b = ball.position;
      followY += (b.y - followY) * Math.min(1, dt * 3);
      tLook.set(b.x * 0.95, Math.max(1, followY * 0.8), b.z + 4);
      tPos.set(b.x * 0.3, 14 + followY * 0.55, Math.min(b.z - 30, -12 + b.z * 0.4));
      tFov = 42;
      k = 2.2;
    } else {
      const a = now / 9000;
      tPos.set(Math.sin(a) * 52, 30 + Math.sin(a * 0.7) * 5, 48 - Math.cos(a) * 52);
      tLook.set(0, 2, 52);
      tFov = 42;
      k = 1.2;
    }
    if (v.cut) {
      camPos.copy(tPos);
      camLook.copy(tLook);
      camera.fov = tFov;
    }
    const e = 1 - Math.exp(-dt * k);
    camPos.lerp(tPos, e);
    camLook.lerp(tLook, e);
    camera.fov += (tFov - camera.fov) * e;
    camera.updateProjectionMatrix();
    camera.position.copy(camPos);
    camera.lookAt(camLook);

    updateFireworks(dt, now);
    composer.render();
  }

  return {
    frame,
    setBatter,
    startHit,
    clearHit,
    fireworks,
    drawBoard,
    resetFollow: () => { followY = 0; }
  };
}
