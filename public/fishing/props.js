// 선착장과 사람별 소품: 나무 선착장, 낚시꾼, 낚싯대(휘는 블랭크·가이드·스피닝 릴), 찌, 태클박스.
import * as THREE from 'three';
import { DOCK } from './logic.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Y = V(0, 1, 0);
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
    g.fillStyle = '#8a7660';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 140; i++) {
      const y = r() * H;
      g.strokeStyle = `rgba(${40 + r() * 40},${30 + r() * 25},${20 + r() * 20},${0.15 + r() * 0.25})`;
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
    // 바랜 회색기
    g.fillStyle = 'rgba(190,185,175,.12)';
    g.fillRect(0, 0, W, H);
    // 못
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
    // 코르크 링 이음매
    g.strokeStyle = 'rgba(80,55,30,.35)';
    for (let x = 0; x < W; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  }), true, [1, 1]);
})();

const std = (color, roughness = 0.7, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });

// ================================================================
// 선착장
// ================================================================
export function makeDock() {
  const g = new THREE.Group();
  const r = rng(11);
  const deckY = DOCK.y;
  const boardW = 0.142;
  const gap = 0.012;
  const thick = 0.045;
  const boards = [];
  // 끝 마루(사람이 서는 곳): 판은 x 방향, 이음매를 엇갈리게
  for (let z = DOCK.z0 + boardW / 2; z < DOCK.z1; z += boardW + gap) {
    const off = r() * 2.4;
    let x = DOCK.x0;
    let first = true;
    while (x < DOCK.x1 - 0.05) {
      const len = Math.min(DOCK.x1 - x, first ? 1.2 + off : 2.6 + r() * 0.6);
      boards.push({ x: x + len / 2, z, lx: len, lz: boardW, rot: 0 });
      x += len + 0.006;
      first = false;
    }
  }
  // 다리(물가로 이어지는 통로): 판은 x 방향 2m
  for (let z = DOCK.z0 - boardW / 2 - gap; z > DOCK.shoreZ; z -= boardW + gap) {
    boards.push({ x: 0, z, lx: DOCK.walkW, lz: boardW, rot: 0 });
  }
  const boardGeo = new THREE.BoxGeometry(1, thick, 1);
  // 판 길이에 맞춰 uv 를 늘리지 않도록 인스턴스마다 같은 무늬를 쓰되 색을 흔듭니다.
  const boardMat = std('#ffffff', 0.86, { map: woodTex });
  const inst = new THREE.InstancedMesh(boardGeo, boardMat, boards.length);
  const o = new THREE.Object3D();
  const col = new THREE.Color();
  boards.forEach((b, i) => {
    o.position.set(b.x, deckY - thick / 2 + (r() - 0.5) * 0.006, b.z);
    o.rotation.set((r() - 0.5) * 0.01, 0, (r() - 0.5) * 0.008);
    o.scale.set(b.lx, 1, b.lz);
    o.updateMatrix();
    inst.setMatrixAt(i, o.matrix);
    const k = 0.78 + r() * 0.3;
    inst.setColorAt(i, col.setRGB(k * (0.98 + r() * 0.06), k * (0.92 + r() * 0.05), k * (0.86 + r() * 0.06)));
  });
  inst.castShadow = true;
  inst.receiveShadow = true;
  g.add(inst);

  // 테두리 판과 장선
  const beamMat = std('#5e4c3c', 0.9, { map: woodTex });
  const beam = (x, y, z, lx, ly, lz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(lx, ly, lz), beamMat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const fy = deckY - thick - 0.11;
  beam(0, fy, DOCK.z1 + 0.03, DOCK.x1 - DOCK.x0 + 0.08, 0.22, 0.05);
  beam(DOCK.x0 - 0.03, fy, (DOCK.z0 + DOCK.z1) / 2, 0.05, 0.22, DOCK.z1 - DOCK.z0 + 0.1);
  beam(DOCK.x1 + 0.03, fy, (DOCK.z0 + DOCK.z1) / 2, 0.05, 0.22, DOCK.z1 - DOCK.z0 + 0.1);
  beam(DOCK.x0 / 2 - DOCK.walkW / 4, fy, DOCK.z0 - 0.03, -DOCK.x0 - DOCK.walkW / 2, 0.22, 0.05);
  beam(DOCK.x1 / 2 + DOCK.walkW / 4, fy, DOCK.z0 - 0.03, DOCK.x1 - DOCK.walkW / 2, 0.22, 0.05);
  for (const s of [-1, 1]) {
    beam(s * (DOCK.walkW / 2 + 0.03), fy, (DOCK.z0 + DOCK.shoreZ) / 2, 0.05, 0.22, DOCK.z0 - DOCK.shoreZ);
  }
  for (let x = DOCK.x0 + 0.6; x < DOCK.x1; x += 1.4) beam(x, fy - 0.02, (DOCK.z0 + DOCK.z1) / 2, 0.07, 0.18, DOCK.z1 - DOCK.z0);

  // 기둥: 물속까지 내려가고 모서리는 위로 조금 솟습니다
  const postMat = std('#4a3a2c', 0.95, { map: woodTex });
  const postGeo = new THREE.CylinderGeometry(0.1, 0.11, 1, 12);
  const post = (x, z, top) => {
    const m = new THREE.Mesh(postGeo, postMat);
    const bottom = -2.6;
    m.scale.set(1, top - bottom, 1);
    m.position.set(x, (top + bottom) / 2, z);
    m.rotation.y = r() * 6;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    if (top > deckY + 0.05) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.1, 0.03, 12), std('#3a2e24', 0.8));
      cap.position.set(x, top + 0.015, z);
      g.add(cap);
    }
    return m;
  };
  for (const [x, z] of [[DOCK.x0, DOCK.z1], [DOCK.x1, DOCK.z1], [DOCK.x0, DOCK.z0], [DOCK.x1, DOCK.z0]]) post(x - Math.sign(x) * 0.04, z + (z > 0 ? 0.04 : -0.04), deckY + 0.32);
  for (let x = DOCK.x0 + 2.8; x < DOCK.x1 - 1; x += 2.8) post(x, DOCK.z1 + 0.06, deckY - 0.06);
  for (let z = DOCK.z0 - 3; z > DOCK.shoreZ + 1; z -= 3) {
    post(-DOCK.walkW / 2 - 0.08, z, deckY + (Math.abs(z % 6) < 1 ? 0.28 : -0.06));
    post(DOCK.walkW / 2 + 0.08, z, deckY + (Math.abs(z % 6) < 1 ? 0.28 : -0.06));
  }

  // 밧줄 감긴 말뚝
  {
    const rope = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.022, 8, 26), std('#c9b48a', 0.95));
    for (let i = 0; i < 4; i++) {
      const m = rope.clone();
      m.rotation.x = Math.PI / 2;
      m.position.set(DOCK.x1 - 0.04, deckY + 0.08 + i * 0.045, DOCK.z1 + 0.04);
      m.castShadow = true;
      g.add(m);
    }
  }

  // 사다리(옆면)
  {
    const metal = new THREE.MeshStandardMaterial({ color: '#b9bfc5', metalness: 0.9, roughness: 0.35 });
    const lx = DOCK.x0 - 0.02;
    for (const dz of [-0.24, 0.24]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.8, 10), metal);
      rail.position.set(lx, deckY - 0.45, 0.6 + dz);
      g.add(rail);
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.02, 8, 16, Math.PI), metal);
      hook.position.set(lx + 0.16, deckY + 0.45, 0.6 + dz);
      hook.rotation.y = Math.PI / 2;
      hook.rotation.z = 0;
      g.add(hook);
    }
    for (let i = 0; i < 4; i++) {
      const step = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.48, 8), metal);
      step.rotation.x = Math.PI / 2;
      step.position.set(lx, deckY - 0.2 - i * 0.3, 0.6);
      g.add(step);
    }
  }

  // 등불 기둥: 노을 속에 켜 둔 따뜻한 등
  const lantern = new THREE.Group();
  {
    const lx = DOCK.x0 + 0.12;
    const lz = DOCK.z0 + 0.12;
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.7, 0.1), beamMat);
    pole.position.set(lx, deckY + 0.85, lz);
    pole.castShadow = true;
    lantern.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.42), beamMat);
    arm.position.set(lx, deckY + 1.62, lz + 0.18);
    lantern.add(arm);
    const iron = new THREE.MeshStandardMaterial({ color: '#23201c', metalness: 0.6, roughness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: '#ffd28a', emissive: '#ffb050', emissiveIntensity: 3.2, roughness: 0.2 });
    const lamp = new THREE.Group();
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.2, 6, 1, true), new THREE.MeshStandardMaterial({ color: '#2a2622', metalness: 0.6, roughness: 0.5, wireframe: true }));
    const bulb = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.18, 6), glass);
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.08, 6), iron);
    top.position.y = 0.14;
    const bot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.03, 6), iron);
    bot.position.y = -0.11;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 12), iron);
    ring.position.y = 0.2;
    lamp.add(cage, bulb, top, bot, ring);
    lamp.position.set(lx, deckY + 1.38, lz + 0.36);
    lantern.add(lamp);
    const light = new THREE.PointLight('#ffb15c', 4, 9, 2);
    light.position.copy(lamp.position);
    lantern.add(light);
    lantern.userData.lamp = lamp;
    lantern.userData.light = light;
  }
  g.add(lantern);

  // 양동이와 뜰채(분위기 소품)
  {
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.3, 20, 1, true), std('#cfd6db', 0.4, { metalness: 0.7, side: THREE.DoubleSide }));
    bucket.position.set(DOCK.x1 - 0.5, deckY + 0.15, DOCK.z0 + 0.35);
    bucket.castShadow = true;
    g.add(bucket);
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.15, 20).rotateX(-Math.PI / 2), std('#2e4a48', 0.1));
    water.position.set(bucket.position.x, deckY + 0.24, bucket.position.z);
    g.add(water);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.006, 6, 20, Math.PI), std('#9aa3a8', 0.4, { metalness: 0.8 }));
    handle.position.set(bucket.position.x, deckY + 0.3, bucket.position.z);
    handle.rotation.z = 0.4;
    g.add(handle);
    // 뜰채: 기대어 둔 손잡이 + 테 + 그물
    const net = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.6, 8), std('#2a2a2e', 0.4, { metalness: 0.5 }));
    pole.position.y = 0.8;
    net.add(pole);
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.01, 6, 28), std('#2a2a2e', 0.4, { metalness: 0.5 }));
    hoop.position.y = 1.82;
    net.add(hoop);
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.4, 16, 3, true), new THREE.MeshStandardMaterial({ color: '#2c3a34', wireframe: true }));
    mesh.position.y = 1.62;
    mesh.rotation.x = Math.PI;
    net.add(mesh);
    net.position.set(DOCK.x1 - 0.2, deckY, DOCK.z0 + 0.1);
    net.rotation.set(-0.25, 0.3, 0.18);
    g.add(net);
  }
  return { group: g, lantern };
}

// ================================================================
// 2관절 IK
// ================================================================
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
function taper(r0, r1, mat, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 1, seg, 1), mat);
  m.castShadow = true;
  return m;
}
function placeTaper(m, a, b) {
  m.position.addVectors(a, b).multiplyScalar(0.5);
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len > 1e-6) m.quaternion.setFromUnitVectors(Y, dir.multiplyScalar(1 / len));
  m.scale.set(1, len, 1);
}

// ================================================================
// 낚시꾼(뒤에서 보는 모습). 모자 띠·조끼가 플레이어 색입니다.
// ================================================================
function makeAngler(color) {
  const g = new THREE.Group();
  const vest = std(color, 0.78);
  const shirt = std('#6b6a52', 0.85);
  const pants = std('#34404f', 0.9);
  const skin = std('#d39a72', 0.6);
  const boot = std('#3b2b1f', 0.7);
  const hatM = std('#cdbd92', 0.92);
  const hair = std('#2b221c', 0.9);
  const add = (m) => { m.castShadow = true; g.add(m); return m; };
  const P = {};
  P.pelvis = add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 18, 12).scale(1.08, 0.7, 0.8), pants));
  P.pelvis.position.set(0, 0.95, 0);
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    P['thigh' + side] = add(taper(0.08, 0.06, pants));
    P['shin' + side] = add(taper(0.058, 0.045, pants));
    P['knee' + side] = add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), pants));
    const b = new THREE.Group();
    const up = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.07, 0.16, 14), boot);
    up.position.y = 0.08;
    const toe = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8).scale(0.06, 0.05, 0.13), boot);
    toe.position.set(0, 0.04, 0.06);
    up.castShadow = toe.castShadow = true;
    b.add(up, toe);
    b.position.set(s * 0.15, 0, 0.02);
    b.rotation.y = s * 0.15;
    g.add(b);
  }
  // 상체: 셔츠 위에 조끼(등판 쪽이 덮이게)
  const prof = [[0, 0], [0.135, 0], [0.15, 0.1], [0.172, 0.25], [0.175, 0.35], [0.155, 0.43], [0.1, 0.48], [0.055, 0.5], [0, 0.5]].map(([x, y]) => new THREE.Vector2(x, y));
  P.torso = add(new THREE.Mesh(new THREE.LatheGeometry(prof, 26).scale(1.12, 1, 0.74), shirt));
  P.torso.position.set(0, 0.97, 0);
  const vprof = [[0.142, 0.02], [0.158, 0.1], [0.18, 0.25], [0.183, 0.35], [0.165, 0.43], [0.12, 0.47]].map(([x, y]) => new THREE.Vector2(x, y));
  P.vest = add(new THREE.Mesh(new THREE.LatheGeometry(vprof, 26, Math.PI * 0.62, Math.PI * 1.76).scale(1.12, 1, 0.74), vest));
  P.vest.position.copy(P.torso.position);
  // 조끼 주머니(등 쪽 아래)
  for (const s of [-1, 1]) {
    const pk = add(new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.03), std(new THREE.Color(color).multiplyScalar(0.75), 0.85)));
    pk.position.set(s * 0.08, 1.08, -0.13);
  }
  P.neck = add(new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.054, 0.1, 12), skin));
  P.neck.position.set(0, 1.5, 0.01);
  const head = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.1, 22, 16).scale(0.92, 1.05, 1), skin);
  skull.castShadow = true;
  head.add(skull);
  // 뒤통수(-z) 머리: phi 1.05π~1.95π 의 가운데(1.5π)가 -z 입니다. 회전 없이 두어야 scale 축이 두개골과 맞습니다.
  const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.104, 22, 12, Math.PI * 1.05, Math.PI * 0.9, Math.PI * 0.32, Math.PI * 0.38).scale(0.94, 1.05, 1.02), hair);
  head.add(hairM);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8).scale(0.5, 1, 0.8), skin);
    ear.position.set(s * 0.092, -0.005, -0.005);
    head.add(ear);
  }
  // 버킷햇: 크라운 + 아래로 처진 챙 + 색 띠
  // Lathe 프로필은 y 가 올라가는 순서여야 바깥면이 앞면입니다(반대면 FrontSide 에서 바깥이 컬링됨).
  const crownP = [[0.11, 0], [0.104, 0.04], [0.092, 0.085], [0.06, 0.098], [0, 0.1]].map(([x, y]) => new THREE.Vector2(x, y));
  const crown = new THREE.Mesh(new THREE.LatheGeometry(crownP, 28), hatM);
  crown.position.y = 0.035;
  crown.castShadow = true;
  head.add(crown);
  // 아랫면을 먼저(바깥으로), 윗면을 나중에(안으로) 그려야 윗면이 위를, 아랫면이 아래를 봅니다.
  const brimP = [[0.104, -0.006], [0.148, -0.024], [0.17, -0.04], [0.172, -0.035], [0.15, -0.018], [0.105, 0.002]].map(([x, y]) => new THREE.Vector2(x, y));
  const brim = new THREE.Mesh(new THREE.LatheGeometry(brimP, 32), hatM);
  brim.position.y = 0.035;
  brim.castShadow = true;
  head.add(brim);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.108, 0.111, 0.024, 28, 1, true), std(color, 0.7, { side: THREE.DoubleSide }));
  band.position.y = 0.05;
  head.add(band);
  head.position.set(0, 1.63, 0.02);
  g.add(head);
  P.head = head;
  for (const side of ['L', 'R']) {
    P['shoulder' + side] = add(new THREE.Mesh(new THREE.SphereGeometry(0.066, 12, 8), vest));
    P['upper' + side] = add(taper(0.058, 0.048, shirt));
    P['elbow' + side] = add(new THREE.Mesh(new THREE.SphereGeometry(0.046, 10, 8), shirt));
    P['fore' + side] = add(taper(0.046, 0.036, shirt));
    P['hand' + side] = add(new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8).scale(0.042, 0.05, 0.034), skin));
  }
  // 그림자 바닥 얼룩
  const legs = () => {
    for (const [side, s] of [['L', 1], ['R', -1]]) {
      const hip = V(s * 0.1, 0.92, 0);
      const foot = V(s * 0.15, 0.12, 0.03);
      const { joint, end } = ik(hip, foot, 0.42, 0.42, V(0, 0, 1));
      placeTaper(P['thigh' + side], hip, joint);
      P['knee' + side].position.copy(joint);
      placeTaper(P['shin' + side], joint, end);
    }
  };
  legs();
  // 팔: 손 목표(몸 좌표)로 IK
  function pose(handR, handL, t, lean, cranking) {
    const sway = Math.sin(t * 1.3) * 0.006;
    P.torso.rotation.set(lean * 0.25, 0, 0);
    P.vest.rotation.copy(P.torso.rotation);
    P.head.position.set(sway, 1.63 + sway * 0.5, 0.02 + lean * 0.08);
    P.head.rotation.set(0.15 - lean * 0.2, Math.sin(t * 0.4) * 0.08, 0);
    for (const [side, s, target] of [['R', -1, handR], ['L', 1, handL]]) {
      const sh = V(s * (side === 'L' && cranking ? 0.15 : 0.19), 1.43, 0.0 + lean * 0.05 + (side === 'L' && cranking ? 0.06 : 0));
      P['shoulder' + side].position.copy(sh);
      const pole = V(s * 0.8, -1, -0.4);
      const { joint, end } = ik(sh, target, 0.31, 0.29, pole);
      placeTaper(P['upper' + side], sh, joint);
      P['elbow' + side].position.copy(joint);
      placeTaper(P['fore' + side], joint, end);
      P['hand' + side].position.copy(end);
      P['hand' + side].quaternion.setFromUnitVectors(Y, end.clone().sub(joint).normalize());
    }
  }
  return { group: g, pose };
}

// ================================================================
// 태클박스
// ================================================================
function makeTackleBox(color) {
  const g = new THREE.Group();
  const body = std(color, 0.45, { metalness: 0.05 });
  const dark = std('#1e2226', 0.5);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.2, 0.26), body);
  base.position.y = 0.1;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.06, 0.27), std(new THREE.Color(color).multiplyScalar(0.8), 0.45));
  lid.position.y = 0.23;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 8, 18, Math.PI), dark);
  handle.position.y = 0.26;
  const latch = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.012), std('#c8ccd0', 0.3, { metalness: 0.9 }));
  latch.position.set(0, 0.2, 0.137);
  for (const m of [base, lid, handle, latch]) {
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

// ================================================================
// 낚싯대 + 릴 + 찌
// ================================================================
export const ROD = { butt: -0.4, blank0: 0.15, tip: 1.85 };
const GUIDES = [
  { u: 0.04, r: 0.018 }, { u: 0.17, r: 0.012 }, { u: 0.32, r: 0.0085 }, { u: 0.48, r: 0.0068 }, { u: 0.64, r: 0.0056 }, { u: 0.8, r: 0.0048 }, { u: 0.92, r: 0.0042 }
];
const NS = 36; // 블랭크 마디
// 실제(6mm→1.7mm)보다 조금 굵게: TV 거리에서도 낚싯대가 보이도록
const BLANK_R0 = 0.0095;
const BLANK_R1 = 0.0032;
const NR = 8;

function makeReel(color, metal) {
  const g = new THREE.Group(); // 로컬 z = 낚싯대 앞쪽, y = 위, x = 왼쪽
  const black = new THREE.MeshPhysicalMaterial({ color: '#1b1d21', metalness: 0.6, roughness: 0.35, clearcoat: 0.6 });
  const accent = new THREE.MeshPhysicalMaterial({ color, metalness: 0.5, roughness: 0.3, clearcoat: 0.8 });
  // 다리(릴 시트에서 아래로)
  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.065, 0.026), black);
  stem.position.set(0, -0.04, 0.0);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, 0.07), black);
  foot.position.set(0, -0.01, 0);
  // 몸통: 옆으로 누운 회전체
  const bodyP = [[0, -0.03], [0.022, -0.028], [0.03, -0.012], [0.031, 0.01], [0.026, 0.026], [0.012, 0.034], [0, 0.035]].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(bodyP, 22).rotateX(Math.PI / 2), black);
  body.position.set(0, -0.085, -0.005);
  // 로터 컵과 스풀
  const rotorP = [[0.012, 0], [0.028, 0.004], [0.031, 0.02], [0.029, 0.03]].map(([x, y]) => new THREE.Vector2(x, y));
  const rotor = new THREE.Mesh(new THREE.LatheGeometry(rotorP, 22).rotateX(Math.PI / 2), black);
  rotor.position.set(0, -0.085, 0.028);
  const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.026, 24).rotateX(Math.PI / 2), accent);
  spool.position.set(0, -0.085, 0.07);
  const lineWrap = new THREE.Mesh(new THREE.CylinderGeometry(0.0215, 0.0215, 0.02, 24).rotateX(Math.PI / 2), std('#e8e2d4', 0.6));
  lineWrap.position.set(0, -0.085, 0.07);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.002, 6, 24), metal);
  lip.position.set(0, -0.085, 0.083);
  // 베일(반원 철사)
  const bail = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.0016, 6, 24, Math.PI).rotateY(Math.PI / 2), metal);
  bail.position.set(0, -0.085, 0.05);
  bail.rotation.x = -0.4;
  // 핸들: 왼쪽(+x)으로 나온 축에 팔과 손잡이(왼손으로 감습니다)
  const crank = new THREE.Group();
  crank.position.set(0.034, -0.085, -0.004);
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.02, 8).rotateZ(Math.PI / 2), metal);
  axle.position.x = 0.006;
  const armM = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.062, 0.008), metal);
  armM.position.set(0.014, 0.028, 0);
  const knobStem = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.02, 6).rotateZ(Math.PI / 2), metal);
  knobStem.position.set(0.024, 0.056, 0);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.009, 0.026, 12).rotateZ(Math.PI / 2), accent);
  knob.position.set(0.042, 0.056, 0);
  crank.add(axle, armM, knobStem, knob);
  for (const m of [stem, foot, body, rotor, spool, lineWrap, bail, armM, knob]) m.castShadow = true;
  g.add(stem, foot, body, rotor, spool, lineWrap, lip, bail, crank);
  g.userData.crank = crank;
  g.userData.knob = knob;
  g.userData.spoolFront = V(0, -0.085, 0.085);
  return g;
}

function makeBobber(color) {
  const g = new THREE.Group();
  const R = 0.042;
  const red = new THREE.MeshPhysicalMaterial({ color: '#e0242c', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 });
  const white = new THREE.MeshPhysicalMaterial({ color: '#f6f3ee', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 });
  const top = new THREE.Mesh(new THREE.SphereGeometry(R, 22, 12, 0, TAU, 0, Math.PI / 2), red);
  const bot = new THREE.Mesh(new THREE.SphereGeometry(R, 22, 12, 0, TAU, Math.PI / 2, Math.PI / 2), white);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.01, R * 1.01, R * 0.16, 22, 1, true), std('#151515', 0.4));
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.11, 8), white);
  stick.position.y = R + 0.05;
  const tipM = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.4 });
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0062, 0.0062, 0.04, 8), tipM);
  tip.position.y = R + 0.12;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.002, 0.05, 6), white);
  stem.position.y = -R - 0.02;
  for (const m of [top, bot, band, stick, tip, stem]) {
    m.castShadow = true;
    g.add(m);
  }
  g.userData.R = R;
  return g;
}

function setBasis(obj, x, y, z, pos) {
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  obj.quaternion.setFromRotationMatrix(m);
  obj.position.copy(pos);
}

export function makeRig(color) {
  const root = new THREE.Group();
  const angler = makeAngler(color);
  root.add(angler.group);
  const box = makeTackleBox(color);
  box.position.set(0.5, DOCK.y, -0.42);
  box.rotation.y = 0.35;
  root.add(box);

  // 손잡이 쪽(곧은 부분): 로드 좌표 그룹. z = 낚싯대 방향
  const rod = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: '#c9ced3', metalness: 1, roughness: 0.25 });
  const gunmetal = new THREE.MeshStandardMaterial({ color: '#3d4148', metalness: 0.9, roughness: 0.3 });
  const accent = new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, clearcoat: 1 });
  const cork = std('#ffffff', 0.85, { map: corkTex });
  const lathe = (prof, mat, z0) => {
    const m = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r, z)), 18).rotateX(Math.PI / 2), mat);
    m.position.z = z0;
    m.castShadow = true;
    rod.add(m);
    return m;
  };
  // 뒤 손잡이(코르크), 엉덩이 마개, 릴 시트, 앞 손잡이
  lathe([[0, -0.4], [0.014, -0.4], [0.0145, -0.392]], std('#202226', 0.5), 0);
  lathe([[0.0135, -0.392], [0.0145, -0.33], [0.0142, -0.2], [0.0128, -0.08], [0.0122, -0.045]], cork, 0);
  lathe([[0.0118, -0.045], [0.0122, -0.03], [0.0122, 0.05], [0.0108, 0.065]], gunmetal, 0);
  lathe([[0.0124, -0.034], [0.0126, -0.024], [0.0124, -0.018]], accent, 0);
  lathe([[0.0104, 0.065], [0.0112, 0.08], [0.0108, 0.14], [0.0085, 0.16]], cork, 0);
  lathe([[0.0082, 0.158], [0.0086, 0.168], [0.0075, 0.18]], accent, 0);
  const reel = makeReel(color, metal);
  reel.position.z = 0.012;
  rod.add(reel);
  root.add(rod);

  // 블랭크: 매 프레임 휜 척추를 따라 다시 짓는 가는 관
  const blankGeo = new THREE.BufferGeometry();
  const bpos = new Float32Array((NS + 1) * NR * 3);
  const bnor = new Float32Array((NS + 1) * NR * 3);
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
  blankGeo.setAttribute('position', new THREE.BufferAttribute(bpos, 3));
  blankGeo.setAttribute('normal', new THREE.BufferAttribute(bnor, 3));
  blankGeo.setIndex(bidx);
  const blankMat = new THREE.MeshPhysicalMaterial({ color: '#1d2027', roughness: 0.28, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06 });
  const blank = new THREE.Mesh(blankGeo, blankMat);
  blank.castShadow = true;
  blank.frustumCulled = false;
  root.add(blank);
  const tipTop = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 6), metal);
  root.add(tipTop);

  const guides = GUIDES.map((gd) => {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(gd.r, Math.max(0.0012, gd.r * 0.14), 6, 16), metal);
    const insert = new THREE.Mesh(new THREE.TorusGeometry(gd.r * 0.85, gd.r * 0.12, 5, 14), std('#2a2c30', 0.2));
    const off = gd.r + 0.006;
    ring.position.y = -off;
    insert.position.y = -off;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.0011, 0.0011, off, 5), metal);
    leg.position.y = -off / 2;
    leg.rotation.x = 0.25;
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.024, 10, 1, true).rotateX(Math.PI / 2), accent);
    g.add(ring, insert, leg, wrap);
    g.userData = { wrap, off, u: gd.u };
    root.add(g);
    return g;
  });

  const bobber = makeBobber(color);
  root.add(bobber);

  const st = {
    spine: Array.from({ length: NS + 1 }, () => V()),
    frames: Array.from({ length: NS + 1 }, () => ({ t: V(), n: V(), b: V() })),
    tip: V(),
    guideP: guides.map(() => V()),
    spoolW: V(),
    knobW: V(),
    pend: { p: V(), v: V(), init: false },
    bobP: V(),
    side: V(), up: V(), d: V()
  };

  // 한 프레임 자세 잡기
  // x: 사람 위치, dir: 낚싯대 방향(세계), bend: 장력(0~1.2), pullTo: 줄이 당기는 점, spin: 핸들 각, cranking: 왼손이 핸들을 잡는지
  function pose({ x, dir, bend, pullTo, spin, cranking, t, lean }) {
    root.position.set(0, 0, 0);
    angler.group.position.set(x, DOCK.y, 0.18);
    box.position.set(x + 0.55, DOCK.y, -0.45);
    // 오른손 좌표계: side(왼쪽) × up = d
    const d = st.d.copy(dir).normalize();
    const side = st.side.crossVectors(Y, d);
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    side.normalize();
    const up = st.up.crossVectors(d, side).normalize();
    // 손(축)은 낚싯대 방향을 따라 조금 움직입니다(손목 느낌)
    const hand = V(x - 0.2, DOCK.y + 1.08, 0.52).addScaledVector(d, 0.05);
    setBasis(rod, side, up, d, hand);
    // 척추
    const Lb = ROD.tip - ROD.blank0;
    const tip0 = hand.clone().addScaledVector(d, ROD.tip);
    const pull = pullTo ? new THREE.Vector3().subVectors(pullTo, tip0).normalize() : V(0, -1, 0);
    const perp = pull.clone().addScaledVector(d, -pull.dot(d));
    const amt = Math.min(1.25, Math.max(0, bend));
    for (let i = 0; i <= NS; i++) {
      const u = i / NS;
      const s = ROD.blank0 + Lb * u;
      const p = st.spine[i].copy(hand).addScaledVector(d, s);
      p.addScaledVector(perp, amt * 0.62 * u * u);
      p.addScaledVector(up, -0.018 * u * u);
      // 휜 만큼 길이를 줄여 끝이 늘어나 보이지 않게
      p.addScaledVector(d, -amt * amt * 0.1 * u * u * u);
    }
    for (let i = 0; i <= NS; i++) {
      const f = st.frames[i];
      const a = st.spine[Math.max(0, i - 1)];
      const b = st.spine[Math.min(NS, i + 1)];
      f.t.subVectors(b, a).normalize();
      f.n.copy(up).addScaledVector(f.t, -up.dot(f.t)).normalize();
      f.b.crossVectors(f.n, f.t);
    }
    // 관 정점
    for (let i = 0; i <= NS; i++) {
      const u = i / NS;
      const rad = BLANK_R0 * (1 - u) + BLANK_R1 * u;
      const f = st.frames[i];
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
    blankGeo.computeBoundingSphere();
    st.tip.copy(st.spine[NS]);
    tipTop.position.copy(st.tip);
    // 가이드(블랭크 아래쪽에 매달림)
    guides.forEach((g, gi) => {
      const fi = Math.round(g.userData.u * NS);
      const f = st.frames[fi];
      setBasis(g, f.b, f.n, f.t, st.spine[fi]);
      const rad = BLANK_R0 * (1 - g.userData.u) + BLANK_R1 * g.userData.u;
      g.userData.wrap.scale.set(rad + 0.0012, rad + 0.0012, 1);
      st.guideP[gi].copy(st.spine[fi]).addScaledVector(f.n, -g.userData.off);
    });
    // 릴 핸들
    const crank = reel.userData.crank;
    crank.rotation.x = -spin;
    rod.updateMatrixWorld(true);
    st.spoolW.copy(reel.userData.spoolFront).applyMatrix4(reel.matrixWorld);
    reel.userData.knob.getWorldPosition(st.knobW);
    // 손: 오른손은 릴 시트, 왼손은 핸들 또는 앞 손잡이
    const base = angler.group.position;
    const hr = hand.clone().addScaledVector(up, 0.012).sub(base);
    const hl = cranking ? st.knobW.clone().addScaledVector(side, 0.025).sub(base) : hand.clone().addScaledVector(d, 0.11).addScaledVector(side, 0.02).sub(base);
    angler.pose(hr, hl, t, lean || 0, cranking);
  }

  function setBobber(p, scale, tilt) {
    bobber.position.copy(p);
    bobber.scale.setScalar(scale);
    bobber.rotation.set(tilt ? tilt.x : 0, 0, tilt ? tilt.z : 0);
    st.bobP.copy(p);
  }

  return { root, rod, blank, bobber, guides, st, pose, setBobber, angler };
}
