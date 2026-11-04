// 골프 니어핀 3D 장면: 낮 하늘, 파3 코스, 골퍼와 아이언, 공, 깃발.
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
import { PIN, TEE_H, AREA, WATER_Y, height, surface, treeSpots, pinHeight } from './course.js';

const RD = Math.PI / 180;
const Y = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const CLUBS = {
  '5i': { name: '5번 아이언', len: 0.965, loft: 24, smash: 1.36 },
  '7i': { name: '7번 아이언', len: 0.94, loft: 32, smash: 1.33 },
  '9i': { name: '9번 아이언', len: 0.915, loft: 41, smash: 1.28 },
  pw: { name: '피칭 웨지', len: 0.905, loft: 46, smash: 1.24 }
};

// 어드레스 기준(골퍼 몸 좌표: +x 목표, +y 위, +z 공 쪽)
export const ADDR_SHAFT = V(0.06, -0.78, 0.62).normalize();
const ADDR_ARM = V(0.05, -0.93, 0.36).normalize();
const LEAN = 0.62;
const PELVIS = V(0, 0.88, -0.06);
const ARM_LEN = 0.6;
const BACK_AXIS = new THREE.Vector3().crossVectors(ADDR_SHAFT, V(-1, 0, 0)).normalize();
const ARM_AXIS = new THREE.Vector3().crossVectors(ADDR_ARM, V(-1, 0, 0)).normalize();

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

// 코스 바닥 그림. 표면 종류마다 색과 깎은 무늬를 칠하고 나무 그림자를 굽습니다.
function paintCourse(trees, sunDir) {
  const N = 2048;
  const c = document.createElement('canvas');
  c.width = N;
  c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  const d = img.data;
  const sx = (AREA.x1 - AREA.x0) / N;
  const sz = (AREA.z1 - AREA.z0) / N;
  const col = {
    rough: [72, 116, 48], trees: [58, 96, 40], fairway: [104, 168, 74], fairway2: [92, 156, 64],
    fringe: [100, 168, 72], green: [118, 190, 88], green2: [113, 185, 85], tee: [106, 172, 76], tee2: [96, 160, 68],
    bunker: [233, 215, 168], water: [40, 78, 66]
  };
  for (let j = 0; j < N; j++) {
    const z = AREA.z1 - (j + 0.5) * sz;
    for (let i = 0; i < N; i++) {
      const x = AREA.x0 + (i + 0.5) * sx;
      const s = surface(x, z);
      let c0;
      if (s === 'fairway') c0 = Math.floor(z / 6) % 2 ? col.fairway : col.fairway2;
      else if (s === 'green') c0 = (Math.floor(z / 2.5) + Math.floor(x / 2.5)) % 2 ? col.green : col.green2;
      else if (s === 'tee') c0 = Math.floor(z / 2) % 2 ? col.tee : col.tee2;
      else c0 = col[s];
      const n = hash(i, j);
      const amp = s === 'bunker' ? 16 : s === 'green' ? 6 : s === 'rough' || s === 'trees' ? 22 : 10;
      const k = (j * N + i) * 4;
      // 큰 얼룩 + 잔 노이즈
      const big = Math.sin(x * 0.11 + Math.sin(z * 0.07) * 2) * Math.cos(z * 0.09) * (s === 'rough' || s === 'trees' ? 10 : 4);
      d[k] = c0[0] + (n - 0.5) * amp + big;
      d[k + 1] = c0[1] + (n - 0.5) * amp + big;
      d[k + 2] = c0[2] + (n - 0.5) * amp * 0.6 + big * 0.5;
      d[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // 벙커 테두리를 어둡게(잔디 턱)
  // 나무 그림자: 해 반대 방향으로 비켜 난 부드러운 타원
  const toPx = (x, z) => [((x - AREA.x0) / (AREA.x1 - AREA.x0)) * N, ((AREA.z1 - z) / (AREA.z1 - AREA.z0)) * N];
  g.globalCompositeOperation = 'multiply';
  for (const t of trees) {
    const len = (t.pine ? 9 : 7) * t.s;
    const ox = -sunDir.x / Math.max(0.3, sunDir.y) * len * 0.5;
    const oz = -sunDir.z / Math.max(0.3, sunDir.y) * len * 0.5;
    const [px, pz] = toPx(t.x + ox, t.z + oz);
    const r = ((t.pine ? 2.6 : 3.6) * t.s) / sx;
    const gr = g.createRadialGradient(px, pz, 0, px, pz, r * 1.6);
    gr.addColorStop(0, 'rgba(40,60,40,0.6)');
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

const glowTex = tex(canvas(128, 128, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.3, 'rgba(255,255,255,.5)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, w, h);
}));
const blobTex = tex(canvas(128, 128, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, 'rgba(0,0,0,.5)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, w, h);
}));
const cloudTex = tex(canvas(512, 256, (g, w, h) => {
  for (let i = 0; i < 26; i++) {
    const x = w * (0.18 + Math.random() * 0.64);
    const y = h * (0.45 + Math.random() * 0.25);
    const r = 40 + Math.random() * 70;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }
}));
// 공 딤플
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

// ---------- 재질 ----------
const std = (color, roughness = 0.6, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });

// ---------- 골퍼 ----------
function ik(a, t, l1, l2, pole) {
  const d = new THREE.Vector3().subVectors(t, a);
  let len = d.length();
  len = Math.min((l1 + l2) * 0.999, Math.max(Math.abs(l1 - l2) + 0.01, len));
  d.normalize();
  const x = (l1 * l1 - l2 * l2 + len * len) / (2 * len);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const p = pole.clone().sub(d.clone().multiplyScalar(pole.dot(d))).normalize();
  return { joint: a.clone().addScaledVector(d, x).addScaledVector(p, h), end: a.clone().addScaledVector(d, len) };
}
function placeSeg(m, a, b) {
  m.position.addVectors(a, b).multiplyScalar(0.5);
  const dir = new THREE.Vector3().subVectors(b, a);
  if (dir.lengthSq() > 1e-8) m.quaternion.setFromUnitVectors(Y, dir.normalize());
}
// 위아래 굵기가 다른 팔다리 토막(길이 1을 늘려 씁니다)
function taper(r0, r1, mat, seg = 14) {
  const geo = new THREE.CylinderGeometry(r1, r0, 1, seg, 1);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}
function placeTaper(m, a, b) {
  placeSeg(m, a, b);
  m.scale.set(1, a.distanceTo(b), 1);
}

function makeIron(mat, accent) {
  // 머리: 힐에서 토 쪽으로 길쭉한 블레이드. 2D 옆모습을 두께만큼 밀어냅니다.
  const s = new THREE.Shape();
  s.moveTo(0, 0.004);
  s.bezierCurveTo(0.02, -0.002, 0.06, -0.002, 0.074, 0.006);
  s.bezierCurveTo(0.083, 0.014, 0.084, 0.036, 0.076, 0.046);
  s.bezierCurveTo(0.06, 0.05, 0.03, 0.04, 0.012, 0.034);
  s.lineTo(0.004, 0.03);
  s.bezierCurveTo(-0.004, 0.026, -0.006, 0.01, 0, 0.004);
  const blade = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.0025, bevelSegments: 3, curveSegments: 18 });
  blade.translate(0, 0, -0.012);
  const head = new THREE.Group();
  const bm = new THREE.Mesh(blade, mat);
  bm.castShadow = true;
  head.add(bm);
  // 뒷면 캐비티 배지
  const b2 = new THREE.Shape();
  b2.moveTo(0.016, 0.01);
  b2.lineTo(0.066, 0.012);
  b2.quadraticCurveTo(0.074, 0.024, 0.066, 0.036);
  b2.lineTo(0.018, 0.028);
  b2.closePath();
  const badge = new THREE.Mesh(new THREE.ExtrudeGeometry(b2, { depth: 0.004, bevelEnabled: false }), accent);
  badge.position.z = -0.0175;
  head.add(badge);
  // 페이스 홈(그루브)
  const grooveMat = std('#8d939b', 0.5, { metalness: 0.6 });
  for (let i = 0; i < 6; i++) {
    const gr = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.0012, 0.0008), grooveMat);
    gr.position.set(0.04, 0.01 + i * 0.0045, 0.0032);
    head.add(gr);
  }
  // 호젤
  const hosel = new THREE.Mesh(new THREE.CylinderGeometry(0.0062, 0.0075, 0.05, 14), mat);
  hosel.position.set(-0.004, 0.035, -0.004);
  hosel.rotation.z = 0.32;
  head.add(hosel);
  return head;
}

function makeClub(clubId, playerColor) {
  const club = CLUBS[clubId];
  const g = new THREE.Group(); // +y 가 그립 끝에서 헤드 쪽
  const chrome = new THREE.MeshStandardMaterial({ color: '#d9dde2', metalness: 1, roughness: 0.18 });
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.0118, 0.0102, 0.27, 16), std('#16181c', 0.85));
  grip.position.y = 0.135;
  grip.castShadow = true;
  g.add(grip);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0122, 0.0122, 0.006, 16), std('#f2f2f2', 0.5));
  cap.position.y = 0.003;
  g.add(cap);
  const shaftLen = club.len - 0.27 - 0.03;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0072, 0.0046, shaftLen, 12), new THREE.MeshStandardMaterial({ color: '#c8ccd2', metalness: 1, roughness: 0.28 }));
  shaft.position.y = 0.27 + shaftLen / 2;
  shaft.castShadow = true;
  g.add(shaft);
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.0062, 0.0062, 0.012, 12), std('#0e0f12', 0.4));
  ferrule.position.y = 0.27 + shaftLen;
  g.add(ferrule);
  // 헤드: 클럽 몸 좌표에서 토 방향은 (0.85, 0.52), 위는 (0.52, -0.85), 페이스는 +z
  const head = makeIron(chrome, std(playerColor, 0.35, { metalness: 0.4 }));
  const toe = V(0.85, 0.52, 0).normalize();
  const up = V(0.52, -0.85, 0).normalize();
  const face = V(0, 0, 1);
  const m = new THREE.Matrix4().makeBasis(toe, up, face);
  head.quaternion.setFromRotationMatrix(m);
  // 로프트: 페이스를 위쪽으로 젖힙니다(토 축을 중심으로)
  head.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(toe, -club.loft * RD * 0.6));
  head.position.set(0, club.len - 0.012, 0).addScaledVector(toe, -0.006);
  g.add(head);
  g.userData.len = club.len;
  return g;
}

export function makeGolfer(color) {
  const g = new THREE.Group();
  const shirt = std(color, 0.7);
  const pants = std('#2c3442', 0.8);
  const skin = std('#e6b48e', 0.62);
  const white = std('#f3f3f0', 0.55);
  const dark = std('#15171c', 0.5);
  const hair = std('#2a211b', 0.9);
  const add = (m) => { m.castShadow = true; g.add(m); return m; };
  const P = {};
  // 하체
  P.pelvis = add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14).scale(1.05, 0.72, 0.82), pants));
  P.belt = add(new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.018, 8, 28).rotateX(Math.PI / 2).scale(1.05, 1, 0.82), dark));
  P.buckle = add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.012), std('#c9ccd1', 0.3, { metalness: 0.9 })));
  for (const side of ['L', 'R']) {
    P['thigh' + side] = add(taper(0.085, 0.062, pants));
    P['knee' + side] = add(new THREE.Mesh(new THREE.SphereGeometry(0.063, 14, 10), pants));
    P['shin' + side] = add(taper(0.06, 0.046, pants));
    const shoe = new THREE.Group();
    const upper = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12).scale(0.052, 0.045, 0.13), white);
    upper.position.set(0, 0.035, 0.035);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.018, 0.27), dark);
    sole.position.set(0, 0.009, 0.035);
    upper.castShadow = sole.castShadow = true;
    shoe.add(upper, sole);
    P['shoe' + side] = shoe;
    g.add(shoe);
  }
  // 상체: 허리에서 가슴으로 넓어졌다가 어깨로 좁아지는 옆모습을 돌립니다
  const prof = [[0.0, 0], [0.13, 0.0], [0.142, 0.08], [0.165, 0.22], [0.17, 0.32], [0.15, 0.4], [0.1, 0.45], [0.055, 0.47], [0, 0.47]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  P.torso = add(new THREE.Mesh(new THREE.LatheGeometry(prof, 28).scale(1.12, 1, 0.72), shirt));
  P.collar = add(new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.016, 8, 24, Math.PI * 1.6).rotateX(Math.PI / 2).rotateY(Math.PI * 0.7), white));
  P.neck = add(new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.055, 0.1, 14), skin));
  for (const side of ['L', 'R']) {
    P['shoulder' + side] = add(new THREE.Mesh(new THREE.SphereGeometry(0.068, 14, 10), shirt));
    P['upper' + side] = add(taper(0.05, 0.04, skin));
    P['sleeve' + side] = add(taper(0.064, 0.056, shirt));
    P['elbow' + side] = add(new THREE.Mesh(new THREE.SphereGeometry(0.041, 12, 8), skin));
    P['fore' + side] = add(taper(0.04, 0.031, skin));
  }
  // 왼손은 장갑
  P.handL = add(new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10).scale(0.045, 0.052, 0.032), white));
  P.handR = add(new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10).scale(0.043, 0.05, 0.03), skin));
  // 머리
  const head = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 18).scale(0.92, 1.06, 1), skin);
  skull.castShadow = true;
  head.add(skull);
  const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.104, 24, 14, Math.PI * 1.08, Math.PI * 0.84, Math.PI * 0.3, Math.PI * 0.3).scale(0.94, 1.06, 1.02), hair);
  head.add(hairM);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8).scale(0.5, 1, 0.8), skin);
    ear.position.set(s * 0.092, -0.005, -0.005);
    head.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), dark);
    eye.position.set(s * 0.032, 0.012, 0.088);
    head.add(eye);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8).scale(0.8, 1, 1.1), skin);
  nose.position.set(0, -0.012, 0.097);
  head.add(nose);
  // 모자: 둥근 크라운 + 앞으로 휜 챙
  const capMat = std(color, 0.75);
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.107, 26, 14, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(0.97, 0.88, 1.04), capMat);
  crown.position.y = 0.022;
  crown.castShadow = true;
  head.add(crown);
  const brimShape = new THREE.Shape();
  brimShape.absellipse(0, 0, 0.09, 0.085, Math.PI, 0, true);
  const brim = new THREE.Mesh(new THREE.ExtrudeGeometry(brimShape, { depth: 0.006, bevelEnabled: false, curveSegments: 20 }), capMat);
  brim.rotation.x = Math.PI / 2 - 0.18;
  brim.position.set(0, 0.03, 0.05);
  brim.castShadow = true;
  head.add(brim);
  const button = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), capMat);
  button.position.y = 0.116;
  head.add(button);
  g.add(head);
  P.head = head;

  // 발밑 그림자
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  blob.position.y = 0.012;
  g.add(blob);

  function pose(p) {
    // p: turn(어깨 회전), hip(골반 회전), shift(목표 쪽 체중 이동), head(고개), hands, shaft, footR(뒷발 들림)
    const pelvis = PELVIS.clone().add(V(p.shift, 0, 0));
    const hq = new THREE.Quaternion().setFromAxisAngle(Y, p.hip);
    P.pelvis.position.copy(pelvis);
    P.pelvis.quaternion.copy(hq);
    const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(LEAN, p.turn, 0, 'XYZ'));
    const up = (x, y, z) => V(x, y, z).applyQuaternion(tq).add(pelvis);
    P.belt.position.copy(up(0, 0.06, 0));
    P.belt.quaternion.copy(new THREE.Quaternion().setFromEuler(new THREE.Euler(LEAN * 0.4, p.hip, 0, 'XYZ')));
    P.buckle.position.copy(up(0, 0.06, 0.118));
    P.buckle.quaternion.copy(tq);
    P.torso.position.copy(up(0, 0.04, 0));
    P.torso.quaternion.copy(tq);
    P.collar.position.copy(up(0, 0.47, 0.005));
    P.collar.quaternion.copy(tq);
    P.neck.position.copy(up(0, 0.52, 0.01));
    P.neck.quaternion.copy(tq);
    P.head.position.copy(up(0, 0.64, 0.02));
    // 고개는 공을 내려다보다가 피니시에서 목표를 봅니다
    P.head.quaternion.setFromEuler(new THREE.Euler(LEAN + 0.25 - p.lookUp * 0.7, p.head, 0, 'XYZ'));

    // 다리
    for (const [side, s] of [['L', 1], ['R', -1]]) {
      const hip = V(s * 0.1, -0.04, 0).applyQuaternion(hq).add(pelvis);
      const foot = side === 'R' ? p.footR : V(0.25, 0.08, 0.02);
      const pole = V(s * 0.15, 0, 1).applyQuaternion(side === 'L' ? hq : new THREE.Quaternion().setFromAxisAngle(Y, p.hip * 0.6));
      const { joint, end } = ik(hip, foot, 0.44, 0.44, pole);
      placeTaper(P['thigh' + side], hip, joint);
      P['knee' + side].position.copy(joint);
      placeTaper(P['shin' + side], joint, end);
      const shoe = P['shoe' + side];
      shoe.position.set(end.x, end.y - 0.075, end.z - 0.035);
      shoe.rotation.set(side === 'R' ? p.heel : 0, s * 0.22 + (side === 'R' ? p.hip * 0.5 : 0), 0);
    }

    // 팔: 왼손이 그립 위, 오른손이 그 아래
    const shaft = p.shaft;
    const handL = p.hands.clone();
    const handR = handL.clone().addScaledVector(shaft, 0.085);
    const reached = {};
    for (const [side, s, target] of [['L', 1, handL], ['R', -1, handR]]) {
      const sh = up(s * 0.185, 0.43, 0.0);
      P['shoulder' + side].position.copy(sh);
      const pole = V(s * 0.7, -1, -0.15).applyQuaternion(tq);
      const { joint, end } = ik(sh, target, 0.29, 0.27, pole);
      placeTaper(P['upper' + side], sh, joint);
      const sleeveEnd = sh.clone().lerp(joint, 0.55);
      placeTaper(P['sleeve' + side], sh, sleeveEnd);
      P['elbow' + side].position.copy(joint);
      placeTaper(P['fore' + side], joint, end);
      reached[side] = end;
    }
    P.handL.position.copy(reached.L);
    P.handR.position.copy(reached.R);
    P.handL.quaternion.setFromUnitVectors(Y, shaft);
    P.handR.quaternion.setFromUnitVectors(Y, shaft);
    return reached;
  }
  return { group: g, pose };
}

// 한 순간의 클럽 방향(shaft, face)으로 골퍼 전체 자세를 만듭니다.
export function swingPose(shaft, phi) {
  // 팔은 클럽보다 덜 돕니다(손목 코킹). phi 는 들어 올리면 음수.
  const alpha = phi < 0 ? phi * 0.58 : phi * 0.78;
  const arm = ADDR_ARM.clone().applyAxisAngle(ARM_AXIS, -alpha * RD);
  const turn = Math.max(-1.6, Math.min(1.75, alpha * RD * 0.62));
  const sc = PELVIS.clone().add(V(0, 0.43, 0).applyEuler(new THREE.Euler(LEAN, 0, 0)));
  const follow = Math.max(0, Math.min(1, phi / 160));
  const back = Math.max(0, Math.min(1, -phi / 200));
  sc.x += follow * 0.06 - back * 0.03;
  const hands = sc.addScaledVector(arm, ARM_LEN);
  return {
    turn,
    hip: turn * (phi < 0 ? 0.45 : 0.72),
    shift: follow * 0.07 - back * 0.03,
    head: phi > 60 ? Math.min(1.3, (phi - 60) / 90) : -turn * 0.75,
    lookUp: phi > 60 ? Math.min(1, (phi - 60) / 100) : 0,
    hands,
    shaft,
    footR: V(-0.25 + follow * 0.08, 0.08 + follow * 0.07, 0.02 + follow * 0.05),
    heel: -follow * 0.7
  };
}

// ---------- 장면 ----------
export function createScene(cv) {
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.62;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#b9cfe2', 380, 1600);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 6000);

  // 하늘과 해
  const sun = V().setFromSphericalCoords(1, (90 - 32) * RD, 205 * RD);
  const sky = new Sky();
  sky.scale.setScalar(5000);
  const su = sky.material.uniforms;
  su.turbidity.value = 5.5;
  su.rayleigh.value = 1.4;
  su.mieCoefficient.value = 0.004;
  su.mieDirectionalG.value = 0.82;
  su.sunPosition.value.copy(sun);
  scene.add(sky);
  // 하늘로 주변광(반사) 만들기
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const sky2 = new Sky();
  sky2.scale.setScalar(5000);
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) sky2.material.uniforms[k].value = su[k].value;
  sky2.material.uniforms.sunPosition.value.copy(sun);
  envScene.add(sky2);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.75;

  const hemi = new THREE.HemisphereLight('#d8ecff', '#4d6b35', 0.9);
  scene.add(hemi);
  const sunLight = new THREE.DirectionalLight('#fff1d6', 3.2);
  sunLight.position.copy(sun).multiplyScalar(80);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.bias = -0.0003;
  sunLight.shadow.normalBias = 0.015;
  scene.add(sunLight, sunLight.target);
  // 그림자 상자는 지금 보는 곳(티 또는 그린) 둘레만 덮어 선명하게 둡니다.
  function shadowFocus(x, y, z, r) {
    sunLight.target.position.set(x, y, z);
    sunLight.position.copy(sun).multiplyScalar(80).add(sunLight.target.position);
    const c = sunLight.shadow.camera;
    c.left = -r;
    c.right = r;
    c.top = r;
    c.bottom = -r;
    c.near = 1;
    c.far = 220;
    c.updateProjectionMatrix();
  }
  shadowFocus(0, TEE_H, 0, 6);

  // 구름
  for (let i = 0; i < 16; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.75 + Math.random() * 0.2, depthWrite: false, fog: false }));
    const a = (Math.random() * 1.4 - 0.7) + (Math.random() < 0.2 ? Math.PI : 0);
    const r = 900 + Math.random() * 900;
    s.position.set(Math.sin(a) * r, 220 + Math.random() * 260, Math.cos(a) * r + 150);
    const w = 500 + Math.random() * 700;
    s.scale.set(w, w * 0.45, 1);
    scene.add(s);
  }

  // 먼 산
  {
    const mats = [std('#6f8fa0', 1, { flatShading: true }), std('#7d9aa8', 1, { flatShading: true }), std('#5f8193', 1, { flatShading: true })];
    for (let i = 0; i < 18; i++) {
      const a = -1.2 + (i / 17) * 2.4 + (Math.random() - 0.5) * 0.12;
      const r = 900 + Math.random() * 500;
      const geo = new THREE.ConeGeometry(160 + Math.random() * 220, 90 + Math.random() * 170, 7, 3);
      const pos = geo.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        if (pos.getY(k) > -geo.parameters.height / 2 + 1) pos.setX(k, pos.getX(k) * (0.85 + Math.random() * 0.3));
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mats[i % 3]);
      m.position.set(Math.sin(a) * r, geo.parameters.height / 2 - 10, Math.cos(a) * r + 120);
      scene.add(m);
    }
  }

  // 코스
  const trees = treeSpots();
  const courseTex = paintCourse(trees, sun);
  {
    const W = AREA.x1 - AREA.x0;
    const D = AREA.z1 - AREA.z0;
    const geo = new THREE.PlaneGeometry(W, D, 220, 240);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + (AREA.x0 + AREA.x1) / 2;
      const z = pos.getZ(i) + (AREA.z0 + AREA.z1) / 2;
      pos.setXYZ(i, x, height(x, z), z);
      uv.setXY(i, (x - AREA.x0) / W, (z - AREA.z0) / D);
    }
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, std('#ffffff', 0.95, { map: courseTex }));
    ground.receiveShadow = true;
    scene.add(ground);
    // 바깥 들판
    const outer = new THREE.Mesh(new THREE.RingGeometry(150, 3000, 64, 1).rotateX(-Math.PI / 2), std('#355f2c', 1));
    outer.position.set(0, 4, 80);
    scene.add(outer);
    // 코스 바깥 숲: 지평선까지 나무 띠를 채웁니다
    const n = 1400;
    const far = new THREE.InstancedMesh(new THREE.ConeGeometry(4, 13, 7).translate(0, 6.5, 0), std('#ffffff', 0.95, { flatShading: true }), n);
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    let k = 0;
    for (let i = 0; i < n * 3 && k < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 150 + Math.pow(Math.random(), 0.7) * 380;
      const x = Math.sin(a) * r;
      const z = 80 + Math.cos(a) * r;
      if (z < -60 && Math.abs(x) < 120) continue; // 티 뒤쪽은 비워 둡니다
      o.position.set(x, 3.5, z);
      o.scale.setScalar(0.8 + Math.random() * 1.1);
      o.rotation.y = Math.random() * 6;
      o.updateMatrix();
      far.setMatrixAt(k, o.matrix);
      far.setColorAt(k, c.setHSL(0.3 + Math.random() * 0.06, 0.45, 0.1 + Math.random() * 0.07));
      k += 1;
    }
    far.count = k;
    scene.add(far);
  }

  // 연못
  {
    const water = new THREE.Mesh(new THREE.CircleGeometry(30, 48).rotateX(-Math.PI / 2),
      new THREE.MeshPhysicalMaterial({ color: '#2b6f86', roughness: 0.06, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.92 }));
    water.position.set(13, WATER_Y, 100);
    scene.add(water);
  }

  // 나무: 침엽수와 활엽수 두 종류를 인스턴스로 뿌립니다
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
      const n = 1 + (Math.sin(v.x * 2.1) * Math.cos(v.y * 1.7) * Math.sin(v.z * 2.3)) * 0.18;
      lp.setXYZ(i, v.x * n, v.y * n * 0.85 + 5.6, v.z * n);
    }
    leafGeo.computeVertexNormals();
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.32, 3.4, 7).translate(0, 1.7, 0);
    const pines = trees.filter((t) => t.pine);
    const leafs = trees.filter((t) => !t.pine);
    const mk = (geo, mat, list, colorFn) => {
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      const o = new THREE.Object3D();
      const c = new THREE.Color();
      list.forEach((t, i) => {
        o.position.set(t.x, t.y - 0.2, t.z);
        o.rotation.set(0, t.r, 0);
        o.scale.setScalar(t.s);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
        if (colorFn) m.setColorAt(i, colorFn(t, c));
      });
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
    };
    const leafMat = std('#ffffff', 0.9, { flatShading: true });
    mk(pineGeo, leafMat, pines, (t, c) => c.setHSL(0.33 + t.tint * 0.04, 0.5, 0.11 + t.tint * 0.06));
    mk(leafGeo, leafMat.clone(), leafs, (t, c) => c.setHSL(0.25 + t.tint * 0.07, 0.55, 0.15 + t.tint * 0.08));
    mk(trunkGeo, std('#5a4030', 0.9), trees, null);
  }

  // 티 마커와 티
  const teeGroup = new THREE.Group();
  scene.add(teeGroup);
  for (const s of [-1, 1]) {
    const mk = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), std('#1f6fd1', 0.3, { clearcoat: 1 }));
    mk.position.set(s * 2.4, TEE_H + 0.08, 1.2);
    mk.castShadow = true;
    scene.add(mk);
  }
  const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.004, 0.05, 10), std('#f5f5f0', 0.5));
  peg.position.set(0, TEE_H + 0.004, 0);
  scene.add(peg);

  // 깃발
  const pinY = pinHeight();
  const flagCloth = new THREE.PlaneGeometry(0.62, 0.42, 14, 6).translate(0.31, 0, 0);
  const flagBase = flagCloth.attributes.position.array.slice();
  {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 2.3, 10), std('#f6f2e8', 0.4));
    pole.position.set(PIN.x, pinY + 1.15, PIN.z);
    pole.castShadow = true;
    scene.add(pole);
    const flag = new THREE.Mesh(flagCloth, std('#e23b3b', 0.7, { side: THREE.DoubleSide }));
    flag.position.set(PIN.x, pinY + 2.05, PIN.z);
    flag.castShadow = true;
    scene.add(flag);
    const cup = new THREE.Mesh(new THREE.CircleGeometry(0.054, 24).rotateX(-Math.PI / 2), std('#121212', 0.9));
    cup.position.set(PIN.x, pinY + 0.012, PIN.z);
    scene.add(cup);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.054, 0.062, 24).rotateX(-Math.PI / 2), std('#ffffff', 0.5));
    ring.position.set(PIN.x, pinY + 0.013, PIN.z);
    scene.add(ring);
  }

  // 조준선
  const aimMat = new LineMaterial({ color: '#ffffff', linewidth: 3, transparent: true, opacity: 0.85, dashed: true, dashSize: 1.2, gapSize: 0.9, worldUnits: false });
  const aimGeo = new LineGeometry();
  aimGeo.setPositions([0, 0, 0, 0, 0, 1]);
  const aimLine = new Line2(aimGeo, aimMat);
  scene.add(aimLine);

  // 골퍼(조준에 따라 공을 중심으로 함께 돕니다)
  const stance = new THREE.Group();
  stance.position.set(0, TEE_H, 0);
  scene.add(stance);
  let golfer = null;
  let club = null;
  let clubId = '7i';
  let golferColor = '#ff5a5f';
  const bodyRoot = new THREE.Group(); // 골퍼 몸 좌표
  bodyRoot.rotation.y = -Math.PI / 2; // 몸의 +x(목표) → 세계 +z
  stance.add(bodyRoot);

  function setGolfer(color, id) {
    golferColor = color || golferColor;
    clubId = id || clubId;
    if (golfer) bodyRoot.remove(golfer.group);
    if (club) bodyRoot.remove(club);
    golfer = makeGolfer(golferColor);
    club = makeClub(clubId, golferColor);
    bodyRoot.add(golfer.group, club);
    // 어드레스 때 클럽 헤드가 공 자리에 오도록 몸을 옮깁니다.
    const p = swingPose(ADDR_SHAFT, 0);
    const head = p.hands.clone().addScaledVector(ADDR_SHAFT, club.userData.len);
    bodyRoot.position.set(0, 0, 0);
    // bodyRoot 안의 좌표(head)가 stance 원점(공)에 오도록
    const off = V(-head.x, 0.02 - head.y, -head.z).applyAxisAngle(Y, bodyRoot.rotation.y);
    bodyRoot.position.copy(off);
  }
  setGolfer();

  // 공
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.0214, 28, 20), new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.35, clearcoat: 0.6, bumpMap: dimpleTex, bumpScale: 0.6 }));
  ball.castShadow = true;
  scene.add(ball);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.setScalar(0.5);
  ball.add(halo);
  const ballShadow = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 }));
  scene.add(ballShadow);

  // 궤적
  const trailMat = new LineMaterial({ color: '#ffffff', linewidth: 4, transparent: true, opacity: 0.9, toneMapped: false });
  let trail = null;
  function setTrail(path, color) {
    if (trail) {
      scene.remove(trail);
      trail.geometry.dispose();
      trail = null;
    }
    if (!path) return;
    const pts = [];
    for (let i = 0; i < path.length; i += 2) pts.push(path[i][0], path[i][1], path[i][2]);
    const geo = new LineGeometry();
    geo.setPositions(pts);
    trailMat.color.set(color || '#ffffff');
    trail = new Line2(geo, trailMat);
    trail.geometry.instanceCount = 0;
    trail.userData.n = pts.length / 3;
    scene.add(trail);
  }

  // 공이 멈춘 자리 표시(사람마다 색)
  const markers = new THREE.Group();
  scene.add(markers);
  function setMarkers(list) {
    markers.clear();
    for (const m of list) {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.03, 24), new THREE.MeshBasicMaterial({ color: m.color, toneMapped: false }));
      disc.position.set(m.x, height(m.x, m.z) + 0.03, m.z);
      markers.add(disc);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 8), new THREE.MeshBasicMaterial({ color: m.color, toneMapped: false }));
      pin.position.set(m.x, height(m.x, m.z) + 0.6, m.z);
      markers.add(pin);
    }
  }

  // 화면 효과(약하게)
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.25, 0.4, 0.95));
  composer.addPass(new OutputPass());

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    trailMat.resolution.set(w, h);
    aimMat.resolution.set(w, h);
  }
  window.addEventListener('resize', resize);
  resize();

  // 카메라
  const camPos = V(0, 30, -40);
  const camLook = V(0, 0, 80);
  const tPos = V();
  const tLook = V();
  let tFov = 40;
  let last = performance.now();
  let follow = V();

  // 스윙 표시용 상태
  let shaftNow = ADDR_SHAFT.clone();
  let faceNow = V(1, 0, 0);
  const shaftTarget = ADDR_SHAFT.clone();
  const faceTarget = V(1, 0, 0);
  let phi = 0;
  let prevShaft = null;
  let align = new THREE.Quaternion();

  function address(shaft0) {
    // 폰을 쥔 각도가 사람마다 달라서, 어드레스 방향을 기준 어드레스로 돌려 맞춥니다.
    const s0 = V(shaft0[2], shaft0[1], shaft0[0]).normalize();
    align = new THREE.Quaternion().setFromUnitVectors(s0, ADDR_SHAFT);
    phi = 0;
    prevShaft = null;
    shaftTarget.copy(ADDR_SHAFT);
    faceTarget.set(1, 0, 0);
  }
  // 폰 기준축(r, u, f) → 몸 좌표(x=f, y=u, z=r)
  function pose(s, fc) {
    const sv = V(s[2], s[1], s[0]).normalize().applyQuaternion(align);
    const fv = V(fc[2], fc[1], fc[0]).normalize().applyQuaternion(align);
    if (prevShaft) {
      const step = prevShaft.angleTo(sv) / RD;
      const dir = Math.sign(new THREE.Vector3().crossVectors(prevShaft, sv).dot(BACK_AXIS)) || 0;
      phi -= dir * step;
    }
    prevShaft = sv.clone();
    shaftTarget.copy(sv);
    faceTarget.copy(fv);
  }
  function resetSwing() {
    phi = 0;
    prevShaft = null;
    shaftTarget.copy(ADDR_SHAFT);
    faceTarget.set(1, 0, 0);
  }

  function setAim(yawDeg, dist) {
    // + 는 오른쪽(세계 -x 쪽)
    stance.rotation.y = -yawDeg * RD;
    const d = V(Math.sin(-yawDeg * RD), 0, Math.cos(-yawDeg * RD));
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * dist;
      const x = d.x * t;
      const z = d.z * t;
      pts.push(x, Math.max(height(x, z), i < 3 ? TEE_H : -10) + 0.15, z);
    }
    aimGeo.setPositions(pts);
    aimLine.computeLineDistances();
  }

  function frame(now, v) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // 깃발 펄럭임
    const fp = flagCloth.attributes.position;
    for (let i = 0; i < fp.count; i++) {
      const x = flagBase[i * 3];
      fp.setZ(i, Math.sin(now / 260 + x * 9) * 0.05 * x * 2.2);
      fp.setY(i, flagBase[i * 3 + 1] - x * x * 0.08);
    }
    fp.needsUpdate = true;

    // 클럽 방향을 부드럽게 따라갑니다(빠른 다운스윙은 거의 그대로)
    const k = 1 - Math.exp(-dt * 40);
    shaftNow.lerp(shaftTarget, k).normalize();
    faceNow.lerp(faceTarget, k).normalize();
    if (v.waggle) {
      const w = Math.sin(now / 420) * 0.04;
      shaftNow.copy(ADDR_SHAFT).applyAxisAngle(BACK_AXIS, w);
    }
    const p = swingPose(shaftNow, v.waggle ? 0 : phi);
    golfer.pose(p);
    // 클럽: y 축 = 샤프트, z 축 = 페이스
    const yAxis = shaftNow.clone();
    const zAxis = faceNow.clone().addScaledVector(yAxis, -faceNow.dot(yAxis)).normalize();
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis);
    club.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
    club.position.copy(p.hands).addScaledVector(yAxis, -0.03);

    aimLine.visible = v.mode === 'aim';

    // 공
    if (v.ball) {
      ball.position.set(v.ball[0], v.ball[1], v.ball[2]);
      ball.visible = true;
    } else {
      ball.position.set(0, TEE_H + 0.05 + 0.0214, 0);
      ball.visible = true;
    }
    peg.visible = !v.ball;
    const flying = v.mode === 'flight';
    halo.material.opacity = flying ? 0.7 : 0;
    halo.scale.setScalar(flying ? 0.5 + camera.position.distanceTo(ball.position) * 0.008 : 0.5);
    const gy = height(ball.position.x, ball.position.z);
    ballShadow.position.set(ball.position.x, gy + 0.02, ball.position.z);
    ballShadow.scale.setScalar(1 + Math.max(0, ball.position.y - gy) * 0.05);
    if (trail && v.trailI != null) trail.geometry.instanceCount = Math.max(0, Math.min(trail.userData.n - 1, Math.floor(v.trailI / 2)));

    // 카메라
    let kc = 3;
    const aimYaw = stance.rotation.y;
    const rot = (x, y, z) => V(x, y, z).applyAxisAngle(Y, aimYaw);
    if (v.mode === 'aim') {
      // 뒤에서 목표를 봅니다
      tPos.copy(rot(-1.3, TEE_H + 2.5, -7.4));
      tLook.copy(rot(-2.5, TEE_H - 1.5, 90));
      tFov = 34;
      shadowFocus(0, TEE_H, 0, 6);
    } else if (v.mode === 'swing') {
      // 정면(공 너머)에서 골퍼 전체를 봅니다. 목표는 화면 오른쪽.
      tPos.copy(rot(-3.5, TEE_H + 1.0, 0.05));
      tLook.copy(rot(0.9, TEE_H + 0.92, 0.05));
      tFov = 36;
      kc = 5;
      shadowFocus(0, TEE_H, 0, 6);
    } else if (v.mode === 'flight') {
      const b = ball.position;
      follow.lerp(b, Math.min(1, dt * 4));
      const dir = V(b.x, 0, b.z).normalize();
      if (!isFinite(dir.x)) dir.set(0, 0, 1);
      const back = Math.min(28, 8 + b.z * 0.25);
      tPos.set(follow.x - dir.x * back, Math.max(TEE_H + 2.5, follow.y + 4 + b.z * 0.02), follow.z - dir.z * back);
      tLook.copy(b);
      tFov = 42;
      kc = 3.2;
      if (b.z > 60) shadowFocus(b.x, height(b.x, b.z), b.z, 14);
    } else if (v.mode === 'land') {
      const b = ball.position;
      // 공과 핀이 함께 보이게
      const mid = V((b.x + PIN.x) / 2, pinY, (b.z + PIN.z) / 2);
      const span = Math.max(8, Math.hypot(b.x - PIN.x, b.z - PIN.z));
      tPos.set(mid.x + span * 0.35, pinY + 4 + span * 0.55, mid.z - 8 - span * 0.9);
      tLook.copy(mid);
      tFov = 40;
      kc = 1.6;
      shadowFocus(mid.x, pinY, mid.z, Math.max(10, span));
    } else if (v.mode === 'green') {
      tPos.set(PIN.x + 14, pinY + 22, PIN.z - 30);
      tLook.set(PIN.x, pinY, PIN.z - 2);
      tFov = 38;
      kc = 1.5;
      shadowFocus(PIN.x, pinY, PIN.z, 18);
    } else {
      const a = now / 14000;
      tPos.set(Math.sin(a) * 60 - 10, 32 + Math.sin(a * 0.7) * 6, 70 - Math.cos(a) * 80);
      tLook.set(-3, 2, 120);
      tFov = 45;
      kc = 1;
      shadowFocus(-3, 0, 120, 40);
    }
    if (v.cut) {
      camPos.copy(tPos);
      camLook.copy(tLook);
      camera.fov = tFov;
      follow.copy(ball.position);
    }
    const e = 1 - Math.exp(-dt * kc);
    camPos.lerp(tPos, e);
    camLook.lerp(tLook, e);
    camera.fov += (tFov - camera.fov) * e;
    // 카메라가 땅속으로 들어가지 않게
    camPos.y = Math.max(camPos.y, height(camPos.x, camPos.z) + 1.2);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    camera.updateProjectionMatrix();
    composer.render();
  }

  function project(x, y, z) {
    const p = V(x, y, z).project(camera);
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight, on: p.z < 1 };
  }

  return { frame, setGolfer, address, pose, resetSwing, setAim, setTrail, setMarkers, project, getPhi: () => phi, pinY };
}
