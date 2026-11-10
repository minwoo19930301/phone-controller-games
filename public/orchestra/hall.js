// 3D 공연장: 나무 무대·반원 단(라이저)·뒤 음향판과 파이프 오르간·붉은 막·객석 실루엣, 절차적으로 만든 단원과 악기.
// 연주를 시작하면 지휘자가 걸어 들어와 관객에게 인사하고, 카메라가 줌아웃하며 관현악단 전체가 드러납니다.
// 1~4P 가 맡은 단원은 그 사람 색 조명·바닥 고리·이름표로 표시되고, 폰 동작에 맞춰 움직입니다.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { INSTRUMENTS, patternOf } from './parts.js';

const STAGE_Y = 1.0;
const CZ = 1.05; // 지휘자 자리 z
const PODIUM_H = 0.24;
const R = Math.PI / 180;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
const easeIO = (t) => (t < 0 ? 0 : t > 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const rand = (() => { let s = 20251108; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })();

export function createHall(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060407);
  scene.fog = new THREE.Fog(0x060407, 34, 80);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.28;
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
  camera.position.set(0, 7.4, 21.5);
  const camLook = new THREE.Vector3(0, 2.7, -3.6);

  // ───────── 재질 ─────────
  const M = {
    suit: new THREE.MeshStandardMaterial({ color: 0x17151b, roughness: 0.72 }),
    suit2: new THREE.MeshStandardMaterial({ color: 0x1f1a22, roughness: 0.78 }),
    satin: new THREE.MeshStandardMaterial({ color: 0x141317, roughness: 0.32, envMapIntensity: 1.3 }), // 깃·나비넥타이·구두
    shirt: new THREE.MeshStandardMaterial({ color: 0xc4beb2, roughness: 0.75 }),
    dressR: new THREE.MeshStandardMaterial({ color: 0x6d1023, roughness: 0.55 }),
    dressB: new THREE.MeshStandardMaterial({ color: 0x14243f, roughness: 0.55 }),
    wood: new THREE.MeshPhysicalMaterial({ color: 0x8e3b12, roughness: 0.34, clearcoat: 0.8, clearcoatRoughness: 0.25 }),
    woodDark: new THREE.MeshStandardMaterial({ color: 0x3a1d0c, roughness: 0.6 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xd9a63c, metalness: 1, roughness: 0.26, envMapIntensity: 1.6 }),
    silver: new THREE.MeshStandardMaterial({ color: 0xdfe3ea, metalness: 1, roughness: 0.22, envMapIntensity: 1.4 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xb8673a, metalness: 1, roughness: 0.32, envMapIntensity: 1.4 }),
    black: new THREE.MeshPhysicalMaterial({ color: 0x08080a, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08 }),
    ivory: new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.4 }),
    head: new THREE.MeshStandardMaterial({ color: 0xf1ead8, roughness: 0.5 }),
    chair: new THREE.MeshStandardMaterial({ color: 0x1b1210, roughness: 0.7 }),
    stand: new THREE.MeshStandardMaterial({ color: 0x0f0f12, metalness: 0.6, roughness: 0.4 }),
    paper: new THREE.MeshStandardMaterial({ color: 0xa79d88, roughness: 0.95 }),
    string: new THREE.MeshBasicMaterial({ color: 0xe8e2cf }),
    baton: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, emissive: 0x333333 }),
    velvet: new THREE.MeshStandardMaterial({ color: 0x7a0f1c, roughness: 0.92, side: THREE.DoubleSide }),
    carpet: new THREE.MeshStandardMaterial({ color: 0x5e0d18, roughness: 0.95 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xc89b45, metalness: 0.9, roughness: 0.35, envMapIntensity: 1.2 }),
    wall: new THREE.MeshStandardMaterial({ color: 0x2a1016, roughness: 0.85 }),
    audience: new THREE.MeshStandardMaterial({ color: 0x141016, roughness: 0.9 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x4a0c16, roughness: 0.9 }),
    mouth: new THREE.MeshBasicMaterial({ color: 0x2a0a0a }),
  };
  const SKIN = [0xf1c7a5, 0xe3b08a, 0xcf9670, 0xa9724f, 0x7f5338].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.62 }));
  const HAIR = [0x1d1512, 0x3a2618, 0x5e3a1e, 0x2a2a2e, 0xd2b06a, 0x5a1f12, 0xc9c6c0].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.72, side: THREE.DoubleSide }));

  // ───────── 무대 ─────────
  const plank = makePlankTexture();
  plank.wrapS = plank.wrapT = THREE.RepeatWrapping;
  plank.repeat.set(0.09, 0.09);
  plank.colorSpace = THREE.SRGBColorSpace;
  const stageTop = new THREE.MeshStandardMaterial({ map: plank, roughness: 0.42, metalness: 0, envMapIntensity: 0.5 });
  const stageSide = new THREE.MeshStandardMaterial({ color: 0x2b1408, roughness: 0.7 });
  {
    const sh = new THREE.Shape();
    sh.moveTo(-13.5, -1.6);
    sh.quadraticCurveTo(0, -3.3, 13.5, -1.6);
    sh.lineTo(13.5, 13);
    sh.lineTo(-13.5, 13);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: STAGE_Y, bevelEnabled: false, curveSegments: 40 });
    g.rotateX(-Math.PI / 2);
    const stage = new THREE.Mesh(g, [stageTop, stageSide]);
    stage.receiveShadow = true;
    scene.add(stage);
    // 앞쪽 금색 띠
    const lip = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(-13.5, STAGE_Y - 0.05, 1.6), new THREE.Vector3(0, STAGE_Y - 0.05, 3.3), new THREE.Vector3(13.5, STAGE_Y - 0.05, 1.6)), 60, 0.04, 6), M.gold);
    scene.add(lip);
  }
  // 반원 단(라이저)
  for (const [r1, r2, h] of [[4.9, 6.9, 0.28], [6.9, 8.8, 0.56], [8.8, 11.2, 0.84]]) {
    const sh = new THREE.Shape();
    const a0 = -98, a1 = 98;
    for (let a = a0; a <= a1; a += 4) { const x = r2 * Math.sin(a * R), y = r2 * Math.cos(a * R) - CZ; if (a === a0) sh.moveTo(x, y); else sh.lineTo(x, y); }
    for (let a = a1; a >= a0; a -= 4) sh.lineTo(r1 * Math.sin(a * R), r1 * Math.cos(a * R) - CZ);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, STAGE_Y, 0);
    const m = new THREE.Mesh(g, [stageTop, stageSide]);
    m.receiveShadow = true;
    m.castShadow = true;
    scene.add(m);
  }
  // 지휘대
  const podium = new THREE.Group();
  {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, PODIUM_H, 40), M.woodDark);
    base.position.y = STAGE_Y + PODIUM_H / 2;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.02, 40), M.carpet);
    top.position.y = STAGE_Y + PODIUM_H + 0.01;
    const rail = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.022, 8, 40, Math.PI), M.gold);
    rail.rotation.x = Math.PI / 2;
    rail.position.y = STAGE_Y + PODIUM_H + 0.92;
    for (const a of [0, 45, 90, 135, 180]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.92, 6), M.gold);
      post.position.set(Math.cos(a * R) * 0.58, STAGE_Y + PODIUM_H + 0.46, Math.sin(a * R) * 0.58);
      podium.add(post);
    }
    podium.add(base, top, rail);
    base.castShadow = true;
    podium.position.set(0, 0, CZ);
    scene.add(podium);
    // 지휘 보면대
    const st = makeStand(1.25);
    st.position.set(0, STAGE_Y + PODIUM_H, CZ - 0.55);
    st.rotation.y = Math.PI;
    scene.add(st);
  }

  // ───────── 뒤 음향판·오르간 ─────────
  {
    const n = 36;
    const geo = new THREE.BoxGeometry(1.0, 8.2, 0.2);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, envMapIntensity: 0.4 }), n);
    const m4 = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = lerp(-80, 80, i / (n - 1)) * R;
      const r = 12.6;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      m4.compose(new THREE.Vector3(r * Math.sin(a), STAGE_Y + 4.1, CZ - r * Math.cos(a)), q, new THREE.Vector3(1, 1, 1));
      im.setMatrixAt(i, m4);
      c.setHSL(0.065 + rand() * 0.02, 0.5, 0.3 + rand() * 0.07, THREE.SRGBColorSpace); // 나무 음향판(판마다 결이 조금씩 다름)
      im.setColorAt(i, c);
    }
    im.receiveShadow = true;
    scene.add(im);
    for (const y of [STAGE_Y + 0.35, STAGE_Y + 8.15, STAGE_Y + 4.4]) {
      const pts = [];
      for (let a = -80; a <= 80; a += 4) pts.push(new THREE.Vector3(12.45 * Math.sin(a * R), y, CZ - 12.45 * Math.cos(a * R)));
      scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, y > STAGE_Y + 5 ? 0.09 : 0.05, 8), M.gold));
    }
    // 아래 따뜻한 빛줄
    const strip = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 41 }, (_, i) => { const a = lerp(-80, 80, i / 40) * R; return new THREE.Vector3(12.3 * Math.sin(a), STAGE_Y + 0.12, CZ - 12.3 * Math.cos(a)); })), 80, 0.035, 6),
      new THREE.MeshBasicMaterial({ color: 0xffb066 }));
    scene.add(strip);
    // 파이프 오르간
    const pipes = 47;
    const pg = new THREE.CylinderGeometry(0.13, 0.13, 1, 16, 1, true);
    const pm = new THREE.InstancedMesh(pg, M.brass, pipes);
    for (let i = 0; i < pipes; i++) {
      const u = i / (pipes - 1) - 0.5;
      const h = 2.2 + 5.2 * Math.pow(Math.cos(u * Math.PI * 1.9), 2) * (1 - Math.abs(u) * 0.6) + (Math.abs(u) > 0.42 ? 1.6 : 0);
      const x = u * 11.5;
      m4.compose(new THREE.Vector3(x, STAGE_Y + 8.4 + h / 2, CZ - 13.0 + Math.abs(u) * 1.2), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
      pm.setMatrixAt(i, m4);
    }
    scene.add(pm);
    const pcase = new THREE.Mesh(new THREE.BoxGeometry(13.5, 9, 1.2), M.woodDark);
    pcase.position.set(0, STAGE_Y + 12.8, CZ - 13.9);
    scene.add(pcase);
  }
  // 옆벽·발코니·막
  for (const sx of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1.2, 18, 26), M.wall);
    wall.position.set(sx * 15.2, 8, -4);
    scene.add(wall);
    for (let k = 0; k < 4; k++) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.3, 16, 0.5), M.gold);
      pil.position.set(sx * 14.55, 8, -14 + k * 5.5);
      scene.add(pil);
    }
    for (const y of [5.4, 8.8]) {
      const bal = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.9, 24, 1, true, sx > 0 ? Math.PI : 0, Math.PI), M.wall);
      bal.material = M.wall;
      bal.position.set(sx * 14.6, y, 6);
      bal.scale.set(0.45, 1, 1.4);
      scene.add(bal);
      const trim = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.05, 6, 30, Math.PI), M.gold);
      trim.rotation.x = Math.PI / 2;
      trim.rotation.z = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
      trim.position.set(sx * 14.6, y + 0.45, 6);
      trim.scale.set(0.45, 1.4, 1);
      scene.add(trim);
      for (const dz of [4.6, 7.4]) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd79a }));
        lamp.position.set(sx * 13.9, y + 0.9, dz);
        scene.add(lamp);
      }
    }
    // 막(주름)
    const cg = new THREE.PlaneGeometry(3.6, 15, 60, 1);
    const pos = cg.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); pos.setZ(i, Math.sin(x * 7.5) * 0.16 + Math.sin(x * 2.3) * 0.08); }
    cg.computeVertexNormals();
    const cur = new THREE.Mesh(cg, M.velvet);
    cur.position.set(sx * 12.6, 7.5, 3.4);
    scene.add(cur);
  }
  {
    const vg = new THREE.PlaneGeometry(30, 2.6, 160, 6);
    const pos = vg.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      pos.setZ(i, Math.sin(x * 6) * 0.12);
      if (y < -1.2) pos.setY(i, y + Math.abs(Math.sin(x * 0.75)) * 0.55);
    }
    vg.computeVertexNormals();
    const val = new THREE.Mesh(vg, M.velvet);
    val.position.set(0, 14.6, 3.4);
    scene.add(val);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(31, 0.4, 0.5), M.gold);
    beam.position.set(0, 15.9, 3.5);
    scene.add(beam);
  }
  // 샹들리에
  const chandeliers = [];
  for (const [x, y, z] of [[-7.5, 14.2, 10], [0, 15, 13], [7.5, 14.2, 10]]) {
    const g = new THREE.Group();
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe2b0 }), 36);
    const m4 = new THREE.Matrix4();
    let k = 0;
    for (const [rr, yy, n] of [[1.0, 0, 16], [0.65, -0.45, 12], [0.32, -0.85, 8]]) for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; m4.makeTranslation(Math.cos(a) * rr, yy, Math.sin(a) * rr); bulbs.setMatrixAt(k++, m4); }
    g.add(bulbs);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.03, 6, 40), M.gold);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 3, 6), M.gold);
    chain.position.y = 1.5;
    g.add(chain);
    g.position.set(x, y, z);
    scene.add(g);
    chandeliers.push(bulbs);
  }

  // ───────── 객석(실루엣) ─────────
  {
    const rows = 17;
    const people = [];
    for (let r = 0; r < rows; r++) {
      const z = 4.6 + r * 1.05;
      const y = Math.max(0, (z - 5) * 0.3);
      const half = 11 + r * 0.25;
      for (let x = -half; x <= half; x += 0.64) {
        if (Math.abs(x) < 0.7) continue;
        people.push({ x: x + (rand() - 0.5) * 0.08, y, z, sit: rand() < 0.86 });
      }
    }
    const n = people.length;
    const seatBack = new THREE.InstancedMesh(new THREE.BoxGeometry(0.52, 0.62, 0.1), M.seat, n);
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 12, 8), M.audience, n);
    const bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.19, 0.32, 4, 10), M.audience, n);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    let k = 0;
    people.forEach((p, i) => {
      m4.compose(new THREE.Vector3(p.x, p.y + 0.62, p.z + 0.32), q, one);
      seatBack.setMatrixAt(i, m4);
      if (!p.sit) return;
      const h = 1.12 + (rand() - 0.5) * 0.14;
      m4.compose(new THREE.Vector3(p.x + (rand() - 0.5) * 0.05, p.y + h, p.z + 0.08), q, new THREE.Vector3(1, 1.08, 1));
      heads.setMatrixAt(k, m4);
      m4.compose(new THREE.Vector3(p.x, p.y + h - 0.38, p.z + 0.12), q, new THREE.Vector3(1.15, 1, 0.75));
      bodies.setMatrixAt(k, m4);
      k++;
    });
    heads.count = k;
    bodies.count = k;
    scene.add(seatBack, heads, bodies);
    // 객석 바닥(계단)
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(34, 24), new THREE.MeshStandardMaterial({ color: 0x120a0c, roughness: 1 }));
    fl.rotation.x = -Math.PI / 2 - Math.atan(0.3); // 무대 쪽으로 내려가는 계단식 객석
    fl.position.set(0, 2.6, 14);
    scene.add(fl);
  }

  // ───────── 사람 ─────────
  // 단원 몸은 사람마다 SkinnedMesh 하나(옷·피부·셔츠·광택 네 묶음)에 머리카락·얼굴·입 메시를 더한 것입니다.
  // 뼈는 예전 관절 Group(hips·torso·head·어깨·팔꿈치·손·다리·무릎)을 그대로 써서 악기 자세·IK·인사가 그대로 붙습니다.
  // 같은 자세·옷·체형이면 지오메트리를 같이 쓰고, 다른 사람과는 머리 모양·피부·머리색·체형으로 달라집니다.
  const BN = { hips: 0, torso: 1, head: 2, shR: 3, elR: 4, handR: 5, shL: 6, elL: 7, handL: 8, legR: 9, kneeR: 10, legL: 11, kneeL: 12 };
  const SL = { cloth: 0, skin: 1, shirt: 2, satin: 3 };
  const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const sstep = (a, b, x) => ease((x - a) / (b - a));
  const spow = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);
  const gauss = (x, w) => Math.exp(-(x * x) / (w * w));
  const blend = (a, b, t) => (t <= 0 ? [[a, 1]] : t >= 1 ? [[b, 1]] : [[a, 1 - t], [b, t]]);
  // 사람 모양 고르기는 따로 굴리는 난수(무대 배치 난수 순서를 흐트리지 않게)
  const rand2 = (() => { let s = 77031; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })();
  // 표 보간(캣멀롬). rows = [[y, 값1, 값2, ...]] (y 오름차순)
  function tableAt(rows, y) {
    const n = rows.length;
    if (y <= rows[0][0]) return rows[0].slice(1);
    if (y >= rows[n - 1][0]) return rows[n - 1].slice(1);
    let i = 0;
    while (i < n - 2 && y > rows[i + 1][0]) i++;
    const p0 = rows[Math.max(0, i - 1)], p1 = rows[i], p2 = rows[i + 1], p3 = rows[Math.min(n - 1, i + 2)];
    const t = (y - p1[0]) / (p2[0] - p1[0]), t2 = t * t, t3 = t2 * t;
    return p1.slice(1).map((_, k) => {
      const a = p0[k + 1], b = p1[k + 1], c = p2[k + 1], d = p3[k + 1];
      return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    });
  }

  // 지오메트리 조립기: 재질 칸(slot)마다 점·법선·뼈 가중치·면을 모읍니다.
  const newB = () => [0, 1, 2, 3].map(() => ({ pos: [], nor: [], sk: [], sw: [], col: [], idx: [] }));
  function vert(s, p, n, w, c) {
    s.pos.push(p.x, p.y, p.z);
    s.nor.push(n.x, n.y, n.z);
    s.sk.push(w[0][0], w[1] ? w[1][0] : 0, 0, 0);
    s.sw.push(w[0][1], w[1] ? w[1][1] : 0, 0, 0);
    if (c) s.col.push(c.r, c.g, c.b);
    return s.pos.length / 3 - 1;
  }
  // 격자 면. rows[i][j] 는 점, closed 면 둘레가 이어집니다(이음매 열을 겹치지 않아 법선이 안 꺾임).
  // slotOf(i, j) → 그 칸의 재질(-1 이면 뺌), wOf(p, i, j) → 뼈 가중치, center(i) → 바깥 방향 판정 기준점.
  function surface(B, rows, { closed = true, slotOf = () => 0, wOf = () => [[0, 1]], center = null, col = null } = {}) {
    const R = rows.length, N = rows[0].length, NC = closed ? N : N - 1;
    const nor = rows.map((r) => r.map(() => V3()));
    const e1 = V3(), e2 = V3(), fn = V3();
    for (let i = 0; i < R - 1; i++) for (let j = 0; j < NC; j++) {
      const j2 = (j + 1) % N;
      const a = rows[i][j], b = rows[i][j2], c = rows[i + 1][j2], d = rows[i + 1][j];
      e1.subVectors(c, a); e2.subVectors(d, b); fn.crossVectors(e1, e2);
      nor[i][j].add(fn); nor[i][j2].add(fn); nor[i + 1][j2].add(fn); nor[i + 1][j].add(fn);
    }
    const cen = (i) => (center ? center(i) : rows[i].reduce((s, p) => s.add(p), V3()).multiplyScalar(1 / N));
    let sum = 0;
    for (let i = 0; i < R; i++) { const c = cen(i); for (let j = 0; j < N; j++) sum += nor[i][j].dot(fn.subVectors(rows[i][j], c)); }
    const flip = sum < 0;
    for (let i = 0; i < R; i++) for (let j = 0; j < N; j++) {
      const n = nor[i][j];
      if (n.lengthSq() < 1e-14) n.subVectors(rows[i][j], cen(i));
      n.normalize();
      if (flip) n.negate();
    }
    const maps = [new Map(), new Map(), new Map(), new Map()];
    const at = (slot, i, j) => {
      const k = i * N + j, m = maps[slot];
      if (!m.has(k)) m.set(k, vert(B[slot], rows[i][j], nor[i][j], wOf(rows[i][j], i, j), col));
      return m.get(k);
    };
    for (let i = 0; i < R - 1; i++) for (let j = 0; j < NC; j++) {
      const slot = slotOf(i, j);
      if (slot < 0) continue;
      const j2 = (j + 1) % N;
      const a = at(slot, i, j), b = at(slot, i, j2), c = at(slot, i + 1, j2), d = at(slot, i + 1, j);
      if (flip) B[slot].idx.push(a, c, b, a, d, c);
      else B[slot].idx.push(a, b, c, a, c, d);
    }
  }
  // 기본 도형(구·원기둥 등)을 그대로 넣기
  function addGeo(B, geo, slot, w, m4, col) {
    if (m4) geo.applyMatrix4(m4);
    const s = B[slot], base = s.pos.length / 3, P = geo.attributes.position, Nn = geo.attributes.normal;
    const p = V3(), n = V3();
    for (let k = 0; k < P.count; k++) { p.fromBufferAttribute(P, k); n.fromBufferAttribute(Nn, k); vert(s, p, n, typeof w === 'function' ? w(p) : w, col); }
    if (geo.index) for (const k of geo.index.array) s.idx.push(base + k);
    else for (let k = 0; k < P.count; k++) s.idx.push(base + k);
    geo.dispose();
  }
  function finish(B, { skin = true, color = false } = {}) {
    const pos = [], nor = [], sk = [], sw = [], col = [], idx = [];
    const g = new THREE.BufferGeometry();
    B.forEach((s, slot) => {
      if (!s.idx.length) return;
      const base = pos.length / 3;
      g.addGroup(idx.length, s.idx.length, slot);
      for (const k of s.idx) idx.push(base + k);
      for (let k = 0; k < s.pos.length; k++) { pos.push(s.pos[k]); nor.push(s.nor[k]); }
      for (let k = 0; k < s.sk.length; k++) { sk.push(s.sk[k]); sw.push(s.sw[k]); }
      for (let k = 0; k < s.col.length; k++) col.push(s.col[k]);
    });
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    if (skin) {
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(sk, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    }
    if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }
  // 경로를 따라가는 관(팔·다리·연미복 꼬리). side 축(기본 x)을 기준으로 단면을 세웁니다.
  function tubeRows(centers, radius, N = 14, side = V3(1, 0, 0)) {
    const rows = [], t = V3(), s = V3(), u = V3();
    for (let i = 0; i < centers.length; i++) {
      t.subVectors(centers[Math.min(centers.length - 1, i + 1)], centers[Math.max(0, i - 1)]).normalize();
      s.copy(side).addScaledVector(t, -side.dot(t)).normalize();
      u.crossVectors(t, s).normalize();
      const [rx, rz, shape] = radius(i);
      const row = [];
      for (let j = 0; j < N; j++) {
        const a = (j / N) * Math.PI * 2;
        const k = shape ? shape(a) : 1;
        row.push(centers[i].clone().addScaledVector(s, Math.cos(a) * rx * k).addScaledVector(u, Math.sin(a) * rz * k));
      }
      rows.push(row);
    }
    return rows;
  }

  // ── 머리 ── 머리 Group 기준(목 위 0.73). 앞이 +z.
  const HD = { top: 0.124, chin: 0.128, a: 0.086, bf: 0.094, bb: 0.104, z0: 0.012 };
  function headPoint(th, ph) {
    const s = Math.sin(ph), c = Math.cos(ph);
    const lower = Math.max(0, -c), upper = Math.max(0, c);
    const st = Math.sin(th), ct = Math.cos(th), fr = Math.max(0, ct);
    const y = c >= 0 ? c * HD.top : c * HD.chin;
    // 아래로 갈수록 턱이 좁아지고, 뒤통수 아래는 목 쪽으로 들어갑니다
    const jaw = 1 - 0.36 * sstep(0.15, 1, lower) * (0.5 + 0.5 * fr);
    const x = HD.a * Math.pow(s, 0.85) * spow(st, 0.8) * jaw * (1 - 0.08 * upper * upper);
    let z;
    if (ct >= 0) {
      z = HD.bf * Math.pow(s, 0.9) * Math.pow(ct, 0.7) * (1 - 0.12 * sstep(0.45, 1, lower));
      z += 0.016 * gauss(lower - 0.82, 0.14) * fr * fr; // 턱끝
      z += 0.006 * gauss(c - 0.33, 0.12) * fr * fr; // 눈썹뼈
    } else {
      z = HD.bb * Math.pow(s, 0.9) * spow(ct, 0.8) * (1 - 0.4 * sstep(0.05, 0.85, lower)) * (1 + 0.05 * upper);
    }
    return V3(x, y, z + HD.z0);
  }
  const headAt = (th, y) => headPoint(th, Math.acos(clamp(y >= 0 ? y / HD.top : y / HD.chin, -1, 1)));
  function headInto(B, m4, w) {
    const rows = [];
    const RW = 20, N = 30;
    for (let i = 0; i <= RW; i++) {
      const ph = (i / RW) * Math.PI;
      const row = [];
      for (let j = 0; j < N; j++) row.push(headPoint((j / N) * Math.PI * 2, ph).applyMatrix4(m4));
      rows.push(row);
    }
    const c0 = V3(0, 0, HD.z0).applyMatrix4(m4);
    surface(B, rows, { slotOf: () => SL.skin, wOf: () => w, center: () => c0 });
    // 코: 콧등과 코끝
    const nose = new THREE.SphereGeometry(1, 10, 8);
    nose.scale(0.0105, 0.021, 0.013);
    nose.rotateX(-0.25);
    const np = headAt(0, -0.016);
    nose.translate(0, np.y, np.z - 0.002);
    addGeo(B, nose, SL.skin, w, m4);
    const tip = new THREE.SphereGeometry(0.0095, 10, 8);
    tip.scale(1.25, 0.9, 1);
    const tp = headAt(0, -0.034);
    tip.translate(0, tp.y, tp.z + 0.008);
    addGeo(B, tip, SL.skin, w, m4);
    // 귀
    for (const sd of [-1, 1]) {
      const ear = new THREE.SphereGeometry(1, 10, 8);
      ear.scale(0.009, 0.024, 0.017);
      ear.rotateY(sd * 0.35);
      const ep = headAt(sd * Math.PI / 2, -0.004);
      ear.translate(ep.x + sd * 0.003, ep.y, ep.z - 0.008);
      addGeo(B, ear, SL.skin, w, m4);
    }
  }
  // 얼굴(눈·눈썹): 정점 색 하나로 묶어 그리기 한 번
  const FACE_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 });
  const faceGeos = [0x2a1c14, 0x8f7a62].map((brow) => {
    const B = newB();
    const cEye = new THREE.Color(0x15100e), cHi = new THREE.Color(0xffffff), cBrow = new THREE.Color(brow);
    for (const sd of [-1, 1]) {
      const p = headAt(sd * 0.37, 0.01);
      const eye = new THREE.SphereGeometry(1, 12, 10);
      eye.scale(0.0098, 0.0128, 0.006);
      eye.rotateY(sd * 0.36);
      eye.translate(p.x, p.y, p.z - 0.001);
      addGeo(B, eye, 0, [[0, 1]], null, cEye);
      const hi = new THREE.SphereGeometry(0.0027, 6, 5);
      hi.translate(p.x + 0.003, p.y + 0.0045, p.z + 0.0045);
      addGeo(B, hi, 0, [[0, 1]], null, cHi);
      // 눈썹: 살짝 휜 띠
      const pts = [-1, -0.33, 0.33, 1].map((u) => { const q = headAt(sd * (0.37 + u * 0.15), 0.037 + 0.004 * (1 - u * u) - sd * u * 0.002); q.z += 0.002; return q; });
      const br = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 6, 0.0033, 5, false);
      br.scale(1, 0.75, 1);
      br.translate(0, 0.009, 0);
      addGeo(B, br, 0, [[0, 1]], null, cBrow);
    }
    return finish(B, { skin: false, color: true });
  });
  const mouthGeo = (() => { const g = new THREE.CircleGeometry(0.0145, 16); const p = headAt(0, -0.064); g.translate(0, 0, 0); g.userData.pos = V3(0, p.y, p.z + 0.0015); return g; })();

  // ── 머리카락 ── 머리 표면에서 두께만큼 띄운 껍데기 + 스타일별 덧붙임(긴 머리 커튼, 올림머리 똬리)
  function hairGeo(style) {
    const B = newB();
    const N = 48, RW = 18;
    const fr = (th) => (1 + Math.cos(th)) / 2; // 1 이마 쪽, 0 뒤통수
    const sideK = (th) => Math.pow(Math.abs(Math.sin(th)), 4);
    let lim, thick, hang = 0.4;
    const sgn = (th) => Math.atan2(Math.sin(th), Math.cos(th)); // -π..π, 0 이 이마
    const up = (ph) => Math.max(0, Math.cos(ph));
    // 남자 머리선: 이마 가운데 → 관자놀이에서 살짝 올라감 → 귀 앞 구레나룻 → 귀 위 → 뒤통수 아래
    const menLim = (th, d = 0) => tableAt([[0, 0.98 + d], [0.45, 0.9 + d], [0.9, 1.1], [1.12, 1.6], [1.28, 1.58], [1.38, 1.35], [1.72, 1.33], [1.86, 1.8], [2.5, 2.06], [Math.PI, 2.12]], Math.abs(sgn(th)))[0];
    if (style === 'short' || style === 'crew') {
      const crew = style === 'crew';
      lim = (th) => menLim(th, crew ? -0.1 : 0);
      thick = (th, ph) => (crew ? 0.006 : 0.01) + (crew ? 0.005 : 0.013) * up(ph) + (crew ? 0 : 0.012) * Math.pow(fr(th), 4) * gauss(ph - 0.85, 0.32);
    } else if (style === 'part') {
      // 오른쪽 가르마, 반대쪽으로 넘긴 앞머리
      lim = (th) => menLim(th, -0.04);
      thick = (th, ph) => (0.011 + 0.018 * up(ph) + 0.026 * gauss(ph - 0.8, 0.38) * gauss(sgn(th) + 0.25, 0.75))
        * (1 - 0.55 * gauss(sgn(th) - 0.5, 0.09) * sstep(1.3, 0.6, ph));
    } else if (style === 'bun') {
      // 가운데 가르마로 귀를 덮으며 뒤로 넘겨 묶은 머리
      lim = (th) => lerp(2.12, 0.98, fr(th)) + 0.18 * sideK(th);
      thick = (th, ph) => (0.009 + 0.006 * up(ph) + 0.01 * sideK(th) * sstep(0.9, 1.5, ph)) * (1 - 0.5 * gauss(sgn(th), 0.08) * sstep(1.2, 0.5, ph));
    } else if (style === 'bob') {
      lim = (th) => lerp(2.18, 1.2, sstep(0.6, 0.86, fr(th))) + 0.03 * Math.sin(th * 11) * (1 - fr(th));
      thick = (th, ph) => 0.012 + 0.008 * up(ph) + 0.018 * sstep(1.3, 2.1, ph);
      hang = 1;
    } else { // long: 가운데 가르마 + 어깨까지 내려오는 커튼
      lim = (th) => lerp(2.0, 0.96, sstep(0.55, 0.9, fr(th)));
      thick = (th, ph) => (0.012 + 0.007 * up(ph) + 0.01 * sstep(1.4, 2.0, ph)) * (1 - 0.5 * gauss(sgn(th), 0.08) * sstep(1.2, 0.5, ph));
      hang = 1;
    }
    const c0 = V3(0, 0, HD.z0);
    const at = (th, ph, d) => {
      let p = headPoint(th, ph);
      if (ph > Math.PI / 2) { // 귀 아래로는 머리를 따라 안으로 말리지 않고 곧게 떨어짐
        const eq = headPoint(th, Math.PI / 2);
        p = V3(lerp(p.x, eq.x, hang), p.y, lerp(p.z, eq.z, hang));
      }
      const n = V3(p.x, p.y * 0.6, p.z - HD.z0).normalize();
      return p.addScaledVector(n, d);
    };
    const rows = [];
    for (let i = 0; i <= RW + 1; i++) {
      const v = Math.min(1, i / RW), row = [];
      for (let j = 0; j < N; j++) {
        const th = (j / N) * Math.PI * 2;
        const ph = v * lim(th);
        // 마지막 줄은 두피 쪽으로 접어 넣어 머리 끝에 두께가 보이게
        row.push(at(th, ph, i > RW ? -0.002 : thick(th, ph) * (1 - 0.3 * sstep(0.85, 1, v))));
      }
      rows.push(row);
    }
    surface(B, rows, { center: () => c0 });
    if (style === 'long') {
      const CR = 10, CN = 24, rws = [];
      for (let i = 0; i <= CR; i++) {
        const u = i / CR, y = lerp(0.03, -0.29, u);
        const th0 = lerp(1.25, 1.95, sstep(0.25, 1, u));
        const row = [];
        for (let j = 0; j <= CN; j++) {
          const th = lerp(th0, Math.PI * 2 - th0, j / CN);
          const eq = headPoint(th, Math.PI / 2);
          const k = 1.17 + 0.1 * u;
          row.push(V3(eq.x * k, y + (u > 0.95 ? 0.012 * Math.sin(j * 1.9) : 0), (eq.z - HD.z0) * k + HD.z0 - 0.02 * u));
        }
        rws.push(row);
      }
      surface(B, rws, { closed: false, center: (i) => V3(0, rws[i][0].y, HD.z0) });
    }
    if (style === 'bun') {
      const bun = new THREE.SphereGeometry(0.043, 16, 12);
      bun.scale(1, 0.92, 0.85);
      bun.translate(0, 0.058, -0.112 + HD.z0);
      addGeo(B, bun, 0, [[0, 1]]);
    }
    return finish(B, { skin: false });
  }
  const HAIR_GEO = {};
  const hairOf = (style) => HAIR_GEO[style] || (HAIR_GEO[style] = hairGeo(style));

  // ── 몸통 단면 ── hips 기준 높이 y: [반폭, 앞깊이, 뒤깊이]
  const TORSO = [
    [-0.15, 0.03, 0.03, 0.03], [-0.14, 0.1, 0.07, 0.075], [-0.115, 0.14, 0.09, 0.098], [-0.07, 0.157, 0.1, 0.108], [0.0, 0.158, 0.1, 0.104],
    [0.08, 0.151, 0.094, 0.094], [0.16, 0.147, 0.096, 0.09], [0.24, 0.153, 0.106, 0.093], [0.32, 0.165, 0.115, 0.098], [0.39, 0.178, 0.116, 0.1],
    [0.445, 0.192, 0.108, 0.1], [0.49, 0.2, 0.095, 0.094], [0.522, 0.198, 0.08, 0.083], [0.548, 0.176, 0.068, 0.07], [0.568, 0.128, 0.06, 0.06],
    [0.585, 0.082, 0.055, 0.055], [0.6, 0.055, 0.05, 0.05], [0.612, 0.02, 0.02, 0.02],
  ];
  const TORSO_F = [
    [-0.15, 0.03, 0.03, 0.03], [-0.14, 0.1, 0.07, 0.08], [-0.115, 0.148, 0.09, 0.1], [-0.07, 0.168, 0.1, 0.112], [0.0, 0.165, 0.098, 0.106],
    [0.08, 0.146, 0.088, 0.09], [0.16, 0.13, 0.084, 0.083], [0.24, 0.136, 0.094, 0.084], [0.32, 0.148, 0.122, 0.088], [0.39, 0.158, 0.124, 0.09],
    [0.445, 0.168, 0.1, 0.09], [0.49, 0.178, 0.086, 0.086], [0.522, 0.177, 0.074, 0.076], [0.548, 0.158, 0.064, 0.066], [0.568, 0.12, 0.056, 0.056],
    [0.585, 0.076, 0.05, 0.05], [0.6, 0.05, 0.046, 0.046], [0.612, 0.02, 0.02, 0.02],
  ];
  const TORSO_Y = (() => { const ys = []; for (let i = 0; i < TORSO.length; i++) { ys.push(TORSO[i][0]); if (i < TORSO.length - 1 && i > 0) ys.push((TORSO[i][0] + TORSO[i + 1][0]) / 2); } return ys; })();
  const BUILDS = [{ k: 0.93, belly: 0 }, { k: 1, belly: 0.006 }, { k: 1.06, belly: 0.022 }];
  function torsoSec(y, bd) {
    const [a, bf, bb] = tableAt(bd.T || TORSO, y);
    const kz = Math.sqrt(bd.k);
    return { a: a * bd.k, bf: bf * kz + bd.belly * gauss(y - 0.13, 0.12), bb: bb * kz, e: lerp(0.78, 1, sstep(0.5, 0.6, y)) };
  }
  // 단면 위 점(θ=0 이 앞 가운데, +x 쪽으로 돎). off 만큼 바깥으로 띄움.
  function torsoPt(y, th, bd, off = 0, y0 = 0) {
    const t = torsoSec(y, bd);
    const s = Math.sin(th), c = Math.cos(th);
    const x = t.a * spow(s, t.e), z = (c >= 0 ? t.bf : t.bb) * spow(c, t.e);
    const n = V3(x / (t.a * t.a), 0, z / ((c >= 0 ? t.bf : t.bb) ** 2));
    if (n.lengthSq() > 0) n.normalize();
    return V3(x + n.x * off, y + y0, z + n.z * off);
  }
  // 앞 x 가 v 인 θ
  const thetaAtX = (y, v, bd) => { const t = torsoSec(y, bd); return Math.asin(Math.pow(clamp(v / t.a, 0, 0.97), 1 / t.e)); };

  // ── 몸 지오메트리 ── outfit: tux(남자 정장)·tails(지휘자 연미복)·blouse(여자 검은 정장)·dress(드레스)
  const BODY_GEO = new Map();
  function bodyGeo(stand, outfit, bi) {
    const key = `${stand ? 1 : 0}-${outfit}-${bi}`;
    if (BODY_GEO.has(key)) return BODY_GEO.get(key);
    const female = outfit === 'blouse' || outfit === 'dress';
    const bd = { ...BUILDS[bi], T: female ? TORSO_F : TORSO };
    if (female) bd.belly = 0;
    const B = newB();
    const Y0 = stand ? 0.95 : 0.5; // 엉덩이 높이
    const dress = outfit === 'dress', tux = outfit === 'tux' || outfit === 'tails';
    const wTorso = (p) => blend(BN.hips, BN.torso, sstep(-0.02, 0.28, p.y - Y0));
    // 몸통: 앞가슴 V(셔츠) 경계가 정확히 열 위에 오도록 열 각도를 줄마다 정합니다.
    const HN = 18, KV = 3;
    const vOf = (y) => {
      if (tux) return y < 0.3 ? 0 : 0.078 * clamp((y - 0.3) / 0.27, 0, 1);
      if (outfit === 'blouse') return y < 0.455 ? 0 : torsoSec(y, bd).a * 0.5 * Math.sqrt(clamp((y - 0.455) / 0.11, 0, 1));
      return 0;
    };
    const cols = (y) => {
      const v = Math.min(vOf(y), torsoSec(y, bd).a * 0.8);
      const thV = v > 0 ? thetaAtX(y, v, bd) : 0;
      const half = [];
      for (let j = 0; j <= HN; j++) half.push(j <= KV ? (thV * j) / KV : thV + ((Math.PI - thV) * (j - KV)) / (HN - KV));
      const all = half.slice();
      for (let j = HN + 1; j < HN * 2; j++) all.push(-half[HN * 2 - j]);
      return all;
    };
    const ys = TORSO_Y;
    const rows = ys.map((y) => cols(y).map((th) => torsoPt(y, th, bd, 0, Y0)));
    const front = (j) => j < KV || j >= HN * 2 - KV;
    surface(B, rows, {
      slotOf: (i, j) => {
        const yA = ys[i], yB = ys[i + 1];
        if (tux && front(j) && yB > 0.3) return SL.shirt;
        if (outfit === 'blouse' && front(j) && yB > 0.455) return SL.skin;
        if (dress && yA >= 0.467) return SL.skin;
        if (dress && yB < 0.1) return -1; // 치마 속
        return SL.cloth;
      },
      wOf: wTorso,
      center: (i) => V3(0, ys[i] + Y0, 0),
    });
    if (tux) {
      // 깃(라펠): V 가장자리를 따라 바깥으로 펼친 광택 띠, 위쪽에서 칼라로 꺾임
      for (const sd of [-1, 1]) {
        const lr = [];
        for (let y = 0.31; y <= 0.565; y += 0.015) {
          const v = vOf(y), w = lerp(0.012, 0.045, sstep(0.31, 0.47, y)) - 0.016 * sstep(0.5, 0.565, y);
          const notch = y > 0.49 && y < 0.51 ? 0.4 : 1;
          const th1 = thetaAtX(y, Math.min(v, torsoSec(y, bd).a * 0.8), bd), th2 = thetaAtX(y, Math.min(v + w * notch, torsoSec(y, bd).a * 0.9), bd);
          lr.push([torsoPt(y, sd * th1, bd, 0.003, Y0), torsoPt(y, sd * th2, bd, 0.0045, Y0)]);
        }
        surface(B, lr, { closed: false, slotOf: () => SL.satin, wOf: wTorso, center: (i) => V3(0, lr[i][0].y, 0) });
      }
      // 나비넥타이
      const ty = 0.583, tz = torsoSec(ty, bd).bf + 0.012;
      for (const sd of [-1, 1]) {
        const wing = new THREE.ConeGeometry(0.017, 0.034, 4);
        wing.rotateZ(sd * Math.PI / 2);
        wing.scale(1, 1, 0.5);
        wing.translate(sd * 0.017, ty + Y0, tz);
        addGeo(B, wing, SL.satin, [[BN.torso, 1]]);
      }
      const knot = new THREE.SphereGeometry(0.008, 8, 6);
      knot.translate(0, ty + Y0, tz + 0.002);
      addGeo(B, knot, SL.satin, [[BN.torso, 1]]);
      // 셔츠 칼라
      const cr = tubeRows([0.572, 0.588, 0.604, 0.618].map((y) => V3(0, y + Y0, -0.006)), (i) => [0.056 - i * 0.0012, 0.058 - i * 0.0012], 20);
      surface(B, cr, { closed: true, slotOf: () => SL.shirt, wOf: () => [[BN.torso, 1]] });
    }
    // 목
    const nk = tubeRows([0.54, 0.6, 0.65, 0.7].map((y) => V3(0, y + Y0, -0.008)), () => [0.05, 0.048], 16);
    surface(B, nk, { slotOf: () => SL.skin, wOf: (p) => blend(BN.torso, BN.head, sstep(0.61, 0.69, p.y - Y0)) });
    // 머리
    headInto(B, new THREE.Matrix4().makeTranslation(0, Y0 + 0.73, 0), [[BN.head, 1]]);
    // 연미복 꼬리(지휘자): 허리 뒤에서 무릎 위까지
    if (outfit === 'tails') {
      for (const sd of [-1, 1]) {
        const ys2 = [0.14, 0.06, -0.04, -0.14, -0.26, -0.38, -0.47, -0.52, -0.545];
        const cs = ys2.map((y) => V3(sd * (0.062 - 0.006 * (y < 0 ? -y : 0)), y + Y0, y > -0.06 ? -torsoSec(y, bd).bb - 0.006 : -0.112 - 0.012 * (-y - 0.06)));
        const wd = [0.05, 0.05, 0.047, 0.045, 0.042, 0.038, 0.032, 0.02, 0.006];
        const tr = tubeRows(cs, (i) => [wd[i], 0.006], 12);
        surface(B, tr, { slotOf: () => SL.cloth, wOf: (p) => blend(BN.hips, BN.torso, sstep(0.03, 0.14, p.y - Y0)) });
      }
    }
    // 팔: 어깨 Group(±0.21, 0.5) 에서 곧게 내린 자세로 만들고, 어깨·팔꿈치에서 뼈 가중치를 섞어 관절이 안 보이게
    for (const sd of [-1, 1]) {
      const bSh = sd < 0 ? BN.shR : BN.shL, bEl = sd < 0 ? BN.elR : BN.elL, bHa = sd < 0 ? BN.handR : BN.handL;
      const sx = sd * 0.21, sy = Y0 + 0.5;
      const thin = female ? 0.88 : 1;
      // s: 어깨 축에서 아래로 잰 거리. 어깨 위쪽은 공처럼 닫지 않고 몸통 어깨선을 따라 목 쪽으로 휘어 들어갑니다(래글런처럼).
      const TOP = [[0.118, 0.551, 0.004], [0.13, 0.549, 0.02], [0.15, 0.538, 0.034], [0.172, 0.526, 0.044], [0.194, 0.513, 0.052]]; // [x, y, 반지름]
      const S = [0.0, 0.03, 0.08, 0.14, 0.2, 0.25, 0.285, 0.31, 0.335, 0.37, 0.42, 0.47, 0.51, 0.54, 0.548];
      const rad = (s) => tableAt([[0, 0.057], [0.05, 0.056], [0.14, 0.051], [0.25, 0.047], [0.31, 0.045], [0.37, 0.043], [0.45, 0.04], [0.52, 0.037], [0.548, 0.0372]], s)[0];
      const rowS = [...TOP.map((_, k) => -0.06 + k * 0.011), ...S];
      const cs = [...TOP.map(([x, y]) => V3(sd * x, Y0 + y, -0.004)), ...S.map((s) => V3(sx - sd * 0.006 * sstep(0.1, 0.5, s), sy - s, -0.004 + 0.006 * sstep(0.3, 0.5, s)))];
      const ar = tubeRows(cs, (i) => {
        if (i < TOP.length) { const r = TOP[i][2] * thin; return [r, r * 1.05]; }
        const s = S[i - TOP.length], r = (i === cs.length - 1 ? 0.6 : 1) * rad(s) * thin;
        return [r * (s > 0.3 ? 0.92 : 1), r * (s < 0.2 ? 1.05 : 1)];
      }, 16);
      const wArm = (p, i) => {
        const s = rowS[i];
        if (s < 0.24) return blend(BN.torso, bSh, sstep(-0.03, 0.07, s));
        return blend(bSh, bEl, sstep(0.27, 0.33, s));
      };
      surface(B, ar, { slotOf: () => (dress ? SL.skin : SL.cloth), wOf: wArm });
      if (tux) { // 셔츠 소매 끝
        const cu = tubeRows([0.522, 0.535, 0.552, 0.562, 0.566].map((s) => V3(sx - sd * 0.006, sy - s, 0.002)), (i) => [i === 4 ? 0.018 : 0.035, i === 4 ? 0.018 : 0.0355], 14);
        surface(B, cu, { slotOf: () => SL.shirt, wOf: () => [[bEl, 1]] });
      }
      // 손: 손목이 손 Group 원점, 손가락이 -y, 엄지가 앞(+z), 손바닥이 몸 쪽
      const hm = new THREE.Matrix4().makeTranslation(sx, sy - 0.57, 0).multiply(new THREE.Matrix4().makeScale(female ? 0.82 : 0.88, female ? 0.82 : 0.88, female ? 0.82 : 0.88));
      const wH = [[bHa, 1]];
      const wrist = new THREE.CylinderGeometry(0.024, 0.026, 0.06, 10);
      wrist.translate(0, 0.012, 0);
      addGeo(B, wrist, SL.skin, [[bEl, 1]], hm);
      const palm = new THREE.SphereGeometry(1, 14, 10);
      palm.scale(0.02, 0.043, 0.039);
      palm.translate(-sd * 0.002, -0.036, 0.002);
      addGeo(B, palm, SL.skin, wH, hm);
      const fl = [0.046, 0.052, 0.049, 0.04];
      for (let f = 0; f < 4; f++) {
        const len = fl[f], z = 0.027 - f * 0.018;
        const fg = new THREE.CapsuleGeometry(0.0082 - f * 0.0005, len, 3, 8);
        fg.translate(0, -len / 2, 0);
        fg.rotateZ(-sd * (0.22 + f * 0.04));
        fg.rotateX(-0.06 * (f - 1.5));
        fg.translate(-sd * 0.003, -0.07, z);
        addGeo(B, fg, SL.skin, wH, hm);
      }
      const th = new THREE.CapsuleGeometry(0.0098, 0.036, 3, 8);
      th.translate(0, -0.018, 0);
      th.rotateX(-0.75);
      th.rotateZ(-sd * 0.35);
      th.translate(-sd * 0.006, -0.028, 0.03);
      addGeo(B, th, SL.skin, wH, hm);
    }
    // 다리
    if (dress) {
      // 치마: 허리에서 바닥까지 퍼지는 주름 치마
      const sy = [0.14, 0.06, -0.04, -0.18, -0.36, -0.56, -0.76, -0.9, -0.945, -0.95];
      const rx = [0.148, 0.16, 0.175, 0.205, 0.255, 0.31, 0.37, 0.41, 0.425, 0.0];
      const N = 40, rows2 = sy.map((y, i) => {
        const row = [];
        const fold = sstep(-0.05, -0.6, y) * 0.05;
        for (let j = 0; j < N; j++) {
          const a = (j / N) * Math.PI * 2;
          const r = rx[i] * (1 + fold * Math.sin(a * 9 + 0.5));
          const rz = r * lerp(0.72, 0.92, sstep(0.1, -0.6, y));
          row.push(V3(Math.sin(a) * r, y + Y0, Math.cos(a) * rz + 0.02 * sstep(0, -0.9, y)));
        }
        return row;
      });
      surface(B, rows2, { slotOf: () => SL.cloth, wOf: () => [[BN.hips, 1]], center: (i) => V3(0, sy[i] + Y0, 0) });
    } else {
      for (const sd of [-1, 1]) {
        const bLeg = sd < 0 ? BN.legR : BN.legL, bKn = sd < 0 ? BN.kneeR : BN.kneeL;
        let cs, rr, wLeg, foot;
        if (stand) {
          const ys2 = [0.07, 0.05, 0.0, -0.08, -0.18, -0.3, -0.4, -0.46, -0.52, -0.6, -0.7, -0.8, -0.86, -0.875];
          cs = ys2.map((y) => V3(sd * (0.096 - 0.012 * sstep(0, -0.45, y)), y + Y0, 0.004 - 0.01 * sstep(-0.45, -0.65, y)));
          const r = [0.03, 0.065, 0.086, 0.084, 0.078, 0.07, 0.063, 0.058, 0.058, 0.057, 0.052, 0.048, 0.049, 0.03];
          rr = (i) => [r[i], r[i] * 1.04];
          wLeg = (p) => { const y = p.y - Y0; return y > -0.3 ? blend(BN.hips, bLeg, sstep(0.0, -0.12, y)) : blend(bLeg, bKn, sstep(-0.42, -0.5, y)); };
          foot = { at: V3(sd * 0.084, 0, -0.065), w: [[bKn, 1]], m: null };
        } else {
          // 앉은 다리: 허벅지가 앞으로 나갔다가 무릎에서 둥글게 꺾여 내려옵니다(무릎 Group: 다리 + (0,0,0.42))
          const curve = new THREE.CatmullRomCurve3([
            V3(sd * 0.095, 0.075, -0.07), V3(sd * 0.1, 0.06, 0.12), V3(sd * 0.104, 0.045, 0.33), V3(sd * 0.105, 0.0, 0.43),
            V3(sd * 0.1, -0.09, 0.46), V3(sd * 0.098, -0.25, 0.455), V3(sd * 0.098, -0.42, 0.445),
          ], false, 'centripetal');
          const n = 26;
          cs = []; for (let i = 0; i <= n; i++) cs.push(curve.getPointAt(i / n).add(V3(0, Y0, 0)));
          const rt = [[0, 0.08], [0.15, 0.079], [0.4, 0.068], [0.52, 0.062], [0.62, 0.058], [0.72, 0.057], [0.85, 0.05], [0.97, 0.048], [1, 0.049]];
          rr = (i) => { const r = tableAt(rt, i / n)[0] * (i === n ? 0.6 : 1); return [r, r * (i / n < 0.5 ? 0.92 : 1.03)]; };
          wLeg = (p) => (p.z < 0.4 || p.y - Y0 > -0.02 ? [[bLeg, 1]] : [[bKn, 1]]);
          foot = { at: V3(sd * 0.098, 0, 0.385), w: [[bKn, 1]] };
        }
        surface(B, tubeRows(cs, rr, 18), { slotOf: () => SL.cloth, wOf: wLeg });
        // 구두: 굽 쪽이 높고 앞코가 둥근 광택 구두
        const zs = [-0.008, 0.0, 0.03, 0.07, 0.11, 0.15, 0.185, 0.205, 0.215];
        const ws = [0.02, 0.036, 0.042, 0.045, 0.046, 0.042, 0.034, 0.024, 0.008];
        const hs = [0.05, 0.07, 0.078, 0.07, 0.05, 0.04, 0.035, 0.028, 0.012];
        const SN = 16, srows = zs.map((z, i) => {
          const row = [];
          for (let j = 0; j < SN; j++) {
            const a = (j / SN) * Math.PI * 2;
            const x = ws[i] * spow(Math.cos(a), 0.7), y = hs[i] * (0.5 + 0.5 * spow(Math.sin(a), 0.55));
            row.push(V3(foot.at.x + x, foot.at.y + y, foot.at.z + z));
          }
          return row;
        });
        surface(B, srows, { slotOf: () => SL.satin, wOf: () => foot.w });
      }
    }
    const g = finish(B);
    BODY_GEO.set(key, g);
    return g;
  }

  function makePerson({ stand = false, dress = null, skin = 0, hair = 0, suit = M.suit, long = false, tails = false } = {}) {
    const outfit = dress ? 'dress' : tails ? 'tails' : long ? 'blouse' : 'tux';
    const build = Math.floor(rand2() * BUILDS.length);
    const styles = long ? ['long', 'bun', 'bob', 'long'] : ['short', 'part', 'crew', 'part'];
    const style = tails && !long ? 'part' : styles[Math.floor(rand2() * styles.length)];
    const root = new THREE.Group();
    const hipY = stand ? 0.95 : 0.5;
    const hips = new THREE.Group();
    hips.position.y = hipY;
    root.add(hips);
    const torso = new THREE.Group();
    hips.add(torso);
    const head = new THREE.Group();
    head.position.y = 0.73;
    torso.add(head);
    const hr = new THREE.Mesh(hairOf(style), HAIR[hair]);
    hr.castShadow = true;
    const face = new THREE.Mesh(faceGeos[hair === 4 ? 1 : 0], FACE_MAT);
    const mouth = new THREE.Mesh(mouthGeo, M.mouth);
    mouth.position.copy(mouthGeo.userData.pos);
    mouth.scale.set(1, 0.16, 1);
    head.add(hr, face, mouth);
    head.scale.setScalar(0.97 + rand2() * 0.06);
    const arm = (side) => {
      const sh = new THREE.Group();
      sh.position.set(side * 0.21, 0.5, 0);
      torso.add(sh);
      const el = new THREE.Group();
      el.position.y = -0.3;
      sh.add(el);
      const hand = new THREE.Group();
      hand.position.y = -0.27;
      el.add(hand);
      return { sh, el, hand };
    };
    // 오른쪽 = -x (앞이 +z 일 때)
    const armR = arm(-1), armL = arm(1);
    const legG = [-1, 1].map((side) => {
      const leg = new THREE.Group();
      leg.position.set(side * 0.1, 0, 0);
      hips.add(leg);
      const knee = new THREE.Group();
      if (stand) knee.position.y = -0.45;
      else knee.position.set(0, 0, 0.42);
      leg.add(knee);
      return { leg, knee };
    });
    const legs = dress ? [] : legG;
    // 뼈 = 위 Group 들. 만든 자세(팔 내림·다리 기본)가 바인드 자세입니다.
    root.updateMatrixWorld(true);
    const skel = new THREE.Skeleton([hips, torso, head, armR.sh, armR.el, armR.hand, armL.sh, armL.el, armL.hand, legG[0].leg, legG[0].knee, legG[1].leg, legG[1].knee]);
    const body = new THREE.SkinnedMesh(bodyGeo(stand, outfit, build), [dress || suit, SKIN[skin], M.shirt, M.satin]);
    body.bind(skel, new THREE.Matrix4());
    body.frustumCulled = false; // 스킨 메시 경계 구는 바인드 자세 기준이라 끔
    body.castShadow = true;
    root.add(body);
    return { root, hips, torso, head, hairMesh: hr, mouth, armR, armL, legs, stand };
  }
  const setArm = (a, x = 0, y = 0, z = 0, ex = 0) => { a.sh.rotation.set(x, y, z); a.el.rotation.set(ex, 0, 0); };
  // Two-bone reach in torso coordinates. The elbow bends toward a stable pole,
  // so the instrument stays connected to the moving hands during bow strokes.
  const ik = { axis: new THREE.Vector3(), pole: new THREE.Vector3(), elbow: new THREE.Vector3(), fore: new THREE.Vector3(), q: new THREE.Quaternion() };
  const down = new THREE.Vector3(0,-1,0);
  const violinPose = {
    neck: new THREE.Vector3(), contact: new THREE.Vector3(), across: new THREE.Vector3(), grip: new THREE.Vector3(),
    leftPole: new THREE.Vector3(.5,-1,.6), rightPole: new THREE.Vector3(-.6,-1,.5), xAxis: new THREE.Vector3(1,0,0),
    parent: new THREE.Quaternion(), inv: new THREE.Quaternion(), bow: new THREE.Quaternion()
  };
  function reachArm(arm, target, pole) {
    const a = .30, b = .27;
    ik.axis.subVectors(target, arm.sh.position);
    const distance = Math.max(Math.abs(a-b)+.0001, Math.min(a+b-.0001, ik.axis.length()));
    ik.axis.normalize();
    const along = (a*a-b*b+distance*distance)/(2*distance);
    const bend = Math.sqrt(Math.max(0, a*a-along*along));
    ik.pole.copy(pole).addScaledVector(ik.axis, -pole.dot(ik.axis)).normalize();
    ik.elbow.copy(ik.axis).multiplyScalar(along).addScaledVector(ik.pole, bend);
    arm.sh.quaternion.setFromUnitVectors(down, ik.fore.copy(ik.elbow).normalize());
    ik.fore.copy(target).sub(arm.sh.position).sub(ik.elbow).normalize();
    ik.q.copy(arm.sh.quaternion).invert();
    ik.fore.applyQuaternion(ik.q).normalize();
    arm.el.quaternion.setFromUnitVectors(down, ik.fore);
  }

  function makeChair() {
    const g = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.05, 0.44), M.chair);
    seat.position.y = 0.46;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.48, 0.04), M.chair);
    back.position.set(0, 0.72, -0.21);
    g.add(seat, back);
    for (const [x, z] of [[-0.2, -0.19], [0.2, -0.19], [-0.2, 0.19], [0.2, 0.19]]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.46, 6), M.stand);
      l.position.set(x, 0.23, z);
      g.add(l);
    }
    return g;
  }
  function makeStand(h = 1.05) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, h, 6), M.stand);
    pole.position.y = h / 2;
    const desk = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.015), M.stand);
    desk.position.y = h + 0.12;
    desk.rotation.x = -0.45;
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.3), M.paper);
    paper.position.set(0, h + 0.12, 0.012);
    paper.rotation.x = -0.45;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.02, 12), M.stand);
    foot.position.y = 0.01;
    g.add(pole, desk, paper, foot);
    return g;
  }

  // ───────── 악기 ─────────
  const violinShape = (() => {
    const s = new THREE.Shape();
    const pts = [[0, 0.18], [0.07, 0.17], [0.1, 0.12], [0.085, 0.06], [0.06, 0.02], [0.065, -0.02], [0.105, -0.07], [0.11, -0.13], [0.07, -0.18], [0, -0.19]];
    s.moveTo(pts[0][0], pts[0][1]);
    const right = pts.map(([x, y]) => new THREE.Vector2(x, y));
    const left = pts.slice().reverse().map(([x, y]) => new THREE.Vector2(-x, y));
    s.setFromPoints([...right, ...left.slice(1)]);
    return s;
  })();
  const violinGeo = new THREE.ExtrudeGeometry(violinShape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 3, curveSegments: 8 });
  violinGeo.translate(0, 0, -0.02);
  function makeViolin(scale = 1) {
    const g = new THREE.Group();
    const b = new THREE.Mesh(violinGeo, M.wood);
    g.add(b);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.24, 0.02), M.woodDark);
    neck.position.set(0, 0.29, 0.02);
    const scroll = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.008, 6, 12), M.woodDark);
    scroll.position.set(0, 0.42, 0.02);
    scroll.rotation.y = Math.PI / 2;
    const fb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.006), M.black);
    fb.position.set(0, 0.2, 0.04);
    g.add(neck, scroll, fb);
    g.scale.setScalar(scale);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  function makeBow(len = 0.72) {
    const g = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.006, len, 5), M.woodDark);
    stick.rotation.z = Math.PI / 2;
    const hair = new THREE.Mesh(new THREE.BoxGeometry(len * 0.92, 0.008, 0.003), M.string);
    hair.position.y = -0.025;
    g.add(stick, hair);
    return g;
  }
  function makeTrumpet() {
    const g = new THREE.Group();
    const curve = new THREE.CatmullRomCurve3([[0, 0, -0.26], [0, 0, 0.08], [0, -0.05, 0.13], [0, -0.09, 0.06], [0, -0.09, -0.12], [0, -0.04, -0.18], [0, 0, -0.1], [0, 0.02, 0.0]].map((p) => new THREE.Vector3(...p)));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.011, 8), M.brass));
    const bell = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.012, 0), new THREE.Vector2(0.016, 0.08), new THREE.Vector2(0.03, 0.15), new THREE.Vector2(0.06, 0.19), new THREE.Vector2(0.065, 0.2)], 20), M.brass);
    bell.rotation.x = Math.PI / 2;
    bell.position.z = 0.08;
    g.add(bell);
    for (let i = 0; i < 3; i++) {
      const v = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.12, 10), M.brass);
      v.position.set(0, -0.03, -0.06 + i * 0.035);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 10), M.ivory);
      cap.position.set(0, 0.04, -0.06 + i * 0.035);
      g.add(v, cap);
    }
    const mp = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.05, 10), M.silver);
    mp.rotation.x = -Math.PI / 2;
    mp.position.z = -0.28;
    g.add(mp);
    g.userData.bell = bell;
    return g;
  }
  function makeHorn() {
    const g = new THREE.Group();
    const c1 = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.014, 8, 36), M.brass);
    const c2 = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 8, 30), M.brass);
    c2.position.z = 0.02;
    g.add(c1, c2);
    const bell = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.02, 0), new THREE.Vector2(0.03, 0.1), new THREE.Vector2(0.06, 0.2), new THREE.Vector2(0.13, 0.27), new THREE.Vector2(0.14, 0.28)], 22), M.brass);
    bell.position.set(0.14, -0.08, 0);
    bell.rotation.z = -0.9;
    g.add(bell);
    g.userData.bell = bell;
    return g;
  }
  function makeFlute() {
    const g = new THREE.Group();
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.66, 10), M.silver);
    t.rotation.z = Math.PI / 2;
    g.add(t);
    return g;
  }
  function makeTimpani() {
    const g = new THREE.Group();
    for (const [x, r] of [[-0.42, 0.36], [0.42, 0.32]]) {
      const k = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.001, -0.32), new THREE.Vector2(r * 0.6, -0.3), new THREE.Vector2(r * 0.95, -0.1), new THREE.Vector2(r, 0.05), new THREE.Vector2(r * 1.02, 0.08)], 28), M.copper);
      k.position.set(x, 0.72, 0.35);
      const headM = new THREE.Mesh(new THREE.CircleGeometry(r * 0.98, 28), M.head);
      headM.rotation.x = -Math.PI / 2;
      headM.position.set(x, 0.81, 0.35);
      g.add(k, headM);
      for (const a of [0, 120, 240]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 6), M.silver);
        leg.position.set(x + Math.cos(a * R) * r * 0.6, 0.21, 0.35 + Math.sin(a * R) * r * 0.6);
        g.add(leg);
      }
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  function makeKit() {
    const g = new THREE.Group();
    const snare = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 28), M.ivory);
    snare.position.set(0, 0.66, 0.36);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 6, 28), M.silver);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, 0.73, 0.36);
    const bd = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.36, 28), M.dressR);
    bd.rotation.x = Math.PI / 2;
    bd.position.set(0.45, 0.34, 0.5);
    const bdh = new THREE.Mesh(new THREE.CircleGeometry(0.3, 28), M.head);
    bdh.position.set(0.45, 0.34, 0.69);
    const cym = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.04, 28, 1, true), M.brass);
    cym.position.set(-0.45, 1.25, 0.4);
    const cst = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.2, 6), M.silver);
    cst.position.set(-0.45, 0.62, 0.4);
    const sst = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.6, 6), M.silver);
    sst.position.set(0, 0.3, 0.36);
    g.add(snare, rim, bd, bdh, cym, cst, sst);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.userData.cym = cym;
    return g;
  }
  function makeGrand() {
    const g = new THREE.Group();
    const s = new THREE.Shape();
    s.moveTo(-0.72, 0);
    s.lineTo(0.72, 0);
    s.lineTo(0.72, -0.5);
    s.bezierCurveTo(0.72, -1.2, 0.2, -1.1, 0.12, -1.6);
    s.bezierCurveTo(0.05, -2.05, -0.3, -2.1, -0.55, -2.05);
    s.bezierCurveTo(-0.72, -2.0, -0.72, -1.8, -0.72, -1.6);
    s.closePath();
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 }), M.black);
    body.rotation.x = Math.PI / 2;
    body.position.y = 1.0;
    const lid = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false }), M.black);
    const lidPivot = new THREE.Group();
    lidPivot.position.set(-0.72, 1.0, 0);
    lid.rotation.x = Math.PI / 2;
    lid.position.x = 0.72;
    lidPivot.add(lid);
    lidPivot.rotation.z = 0.62;
    const keys = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.04, 0.18), M.ivory);
    keys.position.set(0, 0.86, 0.12);
    const keybed = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.08, 0.26), M.black);
    keybed.position.set(0, 0.8, 0.1);
    const blacks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.014, 0.03, 0.1), M.black, 36);
    const m4 = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i < 52 && k < 36; i++) { if ([0, 1, 3, 4, 5].includes(i % 7)) { m4.makeTranslation(-0.68 + (i + 1) * 0.026, 0.89, 0.08); blacks.setMatrixAt(k++, m4); } }
    const desk = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.24, 0.02), M.black);
    desk.position.set(0, 1.1, -0.1);
    desk.rotation.x = -0.25;
    g.add(body, lidPivot, keys, keybed, blacks, desk);
    for (const [x, z] of [[-0.62, -0.1], [0.62, -0.1], [-0.4, -1.9]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.72, 10), M.black);
      leg.position.set(x, 0.36, z);
      g.add(leg);
    }
    const bench = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.34), M.black);
    bench.position.set(0, 0.48, 0.62);
    g.add(bench);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  function makeUpright() {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 0.5), M.black);
    b.position.set(0, 0.62, -0.15);
    const keys = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 0.16), M.ivory);
    keys.position.set(0, 0.74, 0.16);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.34), M.black);
    bench.position.set(0, 0.48, 0.62);
    g.add(b, keys, bench);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  function makeHarp() {
    const g = new THREE.Group();
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.75, 10), M.gold);
    col.position.set(0.4, 0.9, 0);
    const neck = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.4, 1.78, 0), new THREE.Vector3(0.1, 1.72, 0), new THREE.Vector3(-0.2, 1.5, 0), new THREE.Vector3(-0.42, 1.2, 0)]), 20, 0.03, 8), M.gold);
    const sb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2, 0.18), M.wood);
    sb.position.set(-0.2, 0.62, 0);
    sb.rotation.z = -0.68;
    g.add(col, neck, sb);
    const pts = [];
    for (let i = 0; i < 18; i++) { const u = i / 17; const x0 = lerp(-0.6, 0.25, u); pts.push(new THREE.Vector3(x0, lerp(0.2, 0.95, u), 0), new THREE.Vector3(x0 + 0.05, lerp(1.25, 1.74, u), 0)); }
    g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xf6e8c8 })));
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  // ───────── 단원 배치 ─────────
  const musicians = [];
  const polar = (r, deg, riser) => ({ x: r * Math.sin(deg * R), y: STAGE_Y + riser, z: CZ - r * Math.cos(deg * R) });
  function seat(kind, pos, opts = {}) {
    const stand = Boolean(opts.stand);
    const skin = Math.floor(rand() * SKIN.length), hair = Math.floor(rand() * 6); // 6번(은발)은 지휘자 몫
    const woman = opts.woman ?? rand() < 0.45;
    const dress = opts.dress || (stand && woman && kind !== 'conductor' ? M.dressR : null);
    const p = makePerson({ stand, dress, skin, hair, suit: woman ? M.suit2 : M.suit, long: woman, tails: kind === 'conductor' });
    const g = new THREE.Group();
    g.position.set(pos.x, pos.y, pos.z);
    // 지휘자 쪽(또는 opts.face)을 봅니다
    const fx = opts.faceX ?? 0, fz = opts.faceZ ?? CZ + 1.2;
    g.rotation.y = opts.rotY ?? Math.atan2(fx - pos.x, fz - pos.z);
    if (!stand && !opts.noChair) g.add(makeChair());
    g.add(p.root);
    if (opts.stand2 !== false && !stand && !['piano', 'timpani', 'kit', 'harp', 'bassdrum'].includes(kind)) {
      const st = makeStand();
      st.position.set(0, 0, 0.7);
      st.rotation.y = Math.PI;
      g.add(st);
    }
    const m = { kind, g, p, pos, section: opts.section || null, level: 0, lvT: 0, hitT: -9, hitArm: 1, bowDir: 1, bowPh: rand() * 6, ready: 0, slot: null, phase: rand() * 6, extra: {} };
    attachInstrument(m, opts);
    scene.add(g);
    musicians.push(m);
    return m;
  }
  function attachInstrument(m, opts) {
    const p = m.p;
    if (m.kind === 'violin' || m.kind === 'viola') {
      const v = makeViolin(m.kind === 'viola' ? 1.12 : 1);
      v.position.set(0.17, 0.5, 0.2);
      v.rotation.set(-1.1, 0.25, 0.9);
      p.torso.add(v);
      v.updateMatrix();
      m.extra.violin = v;
      const bow = makeBow();
      bow.position.set(0, -0.02, 0.05);
      p.armR.hand.add(bow);
      m.extra.bow = bow;
    } else if (m.kind === 'cello') {
      const v = makeViolin(2.3);
      v.position.set(0, 0.62, 0.38);
      v.rotation.set(-0.25, 0, 0.12);
      m.g.add(v);
      const bow = makeBow(0.72);
      p.armR.hand.add(bow);
      m.extra.bow = bow;
    } else if (m.kind === 'trumpet' || m.kind === 'trombone') {
      const t = makeTrumpet();
      if (m.kind === 'trombone') t.scale.set(1.3, 1.3, 2.1);
      const holder = new THREE.Group();
      holder.position.set(0, 0.68, 0.14);
      holder.add(t);
      t.position.z = 0.22;
      p.torso.add(holder);
      m.extra.horn = holder;
      m.extra.bell = t.userData.bell;
    } else if (m.kind === 'horn') {
      const h = makeHorn();
      const holder = new THREE.Group();
      holder.position.set(0.1, 0.38, 0.18);
      holder.rotation.y = 0.3;
      holder.add(h);
      p.torso.add(holder);
      m.extra.horn = holder;
      m.extra.bell = h.userData.bell;
    } else if (m.kind === 'flute') {
      const f = makeFlute();
      f.position.set(-0.22, 0.66, 0.14);
      f.rotation.y = 0.2;
      p.torso.add(f);
      m.extra.horn = f;
    } else if (m.kind === 'timpani') { m.g.add(makeTimpani()); }
    else if (m.kind === 'kit') { const k = makeKit(); m.g.add(k); m.extra.cym = k.userData.cym; }
    else if (m.kind === 'piano') { /* 피아노는 따로 */ }
    else if (m.kind === 'castanets') {
      for (const a of [p.armR, p.armL]) { const c = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.woodDark); c.position.y = -0.03; a.hand.add(c); }
    } else if (m.kind === 'conductor') {
      if (!opts.woman) p.hairMesh.material = HAIR[6]; // 은발
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.007, 0.42, 6), M.baton);
      b.rotation.x = Math.PI / 2;
      b.position.z = 0.2;
      const holder = new THREE.Group();
      holder.add(b);
      p.armR.hand.add(holder);
      m.extra.baton = holder;
    }
  }
  // 1열: 제1바이올린(왼쪽) · 첼로(오른쪽)
  const S = {};
  S.vio1 = [-32, -48, -64, -80].map((a, i) => seat('violin', polar(2.9, a, 0), { section: 'melody', woman: i % 2 === 0 }));
  S.cello = [34, 50, 66, 82].map((a) => seat('cello', polar(2.9, a, 0), { section: 'bass' }));
  // 2열: 제2바이올린 · 플루트 · 비올라
  S.vio2 = [-28, -42, -56, -70].map((a) => seat('violin', polar(5.6, a, 0.28), { section: 'harmony' }));
  S.flute = [-9, 9].map((a) => seat('flute', polar(5.6, a, 0.28), { section: 'melody' }));
  S.viola = [28, 42, 56, 70].map((a) => seat('viola', polar(5.6, a, 0.28), { section: 'harmony' }));
  // 3열: 호른 · 트럼펫 · 트롬본
  S.horn = [-36, -28, -20].map((a) => seat('horn', polar(7.8, a, 0.56), { section: 'harmony' }));
  S.trumpet = [-8, 0, 8].map((a) => seat('trumpet', polar(7.8, a, 0.56), { section: 'melody' }));
  S.trombone = [20, 28].map((a) => seat('trombone', polar(7.8, a, 0.56), { section: 'bass' }));
  // 4열: 타악기
  S.timp = [seat('timpani', polar(10.0, 4, 0.84), { section: 'drums', noChair: true, stand: true })];
  S.kit = [seat('kit', polar(10.0, 22, 0.84), { section: 'drums' })];
  S.bass = [seat('kit', polar(10.0, -16, 0.84), { section: 'drums' })];
  S.cast = [seat('castanets', polar(9.6, 36, 0.84), { section: 'perc', stand: true }), seat('castanets', polar(9.6, -30, 0.84), { section: 'perc', stand: true })];
  // 피아노(왼쪽 앞)·업라이트(오른쪽 뒤)·하프(오른쪽 앞)
  const grand = makeGrand();
  grand.position.set(-6.0, STAGE_Y, 0.2);
  grand.rotation.y = 0.55;
  scene.add(grand);
  S.piano = [seat('piano', { x: -6.0 + Math.sin(0.55) * 0.66, y: STAGE_Y, z: 0.2 + Math.cos(0.55) * 0.66 }, { rotY: 0.55 + Math.PI, noChair: true, stand2: false, section: 'chords' })];
  const upright = makeUpright();
  upright.position.set(7.2, STAGE_Y + 0.28, -4.7);
  upright.rotation.y = -0.9;
  scene.add(upright);
  S.piano.push(seat('piano', { x: 7.2 + Math.sin(-0.9) * 0.66, y: STAGE_Y + 0.28, z: -4.7 + Math.cos(-0.9) * 0.66 }, { rotY: -0.9 + Math.PI, noChair: true, stand2: false, section: 'chords' }));
  const harp = makeHarp();
  harp.position.set(6.3, STAGE_Y, -0.6);
  harp.rotation.y = -0.6;
  scene.add(harp);
  S.harpist = [seat('violin', { x: 5.8, y: STAGE_Y, z: -0.2 }, { section: 'chords', stand2: false })];
  S.harpist[0].p.root.visible = true;
  // 독창자(서서 관객을 봄)
  S.voice = [[2.5, 1.9], [3.5, 1.7], [-2.5, 1.9], [-3.5, 1.7]].map(([x, z], i) => seat('voice', { x, y: STAGE_Y, z }, { stand: true, woman: i % 2 === 0, dress: i % 2 === 0 ? M.dressR : null, faceX: x * 0.3, faceZ: 20, section: 'melody' }));
  S.voice.forEach((m, i) => { if (i > 0) m.g.visible = false; });
  // 지휘자(입장 전에는 숨김)
  const conductor = seat('conductor', { x: 0, y: STAGE_Y + PODIUM_H, z: CZ }, { stand: true, woman: false, rotY: Math.PI });
  conductor.g.visible = false;
  const conductor2 = seat('conductor', { x: -3.4, y: STAGE_Y + PODIUM_H * 0.7, z: 2.2 }, { stand: true, woman: true, rotY: Math.PI * 0.85 });
  conductor2.g.visible = false;
  const assistantPodium = podium.clone();
  assistantPodium.scale.setScalar(0.7);
  assistantPodium.position.set(-3.4, STAGE_Y * 0.3, 2.2); // 0.7배로 줄인 지휘대 바닥이 무대 위에 오게
  assistantPodium.visible = false;
  scene.add(assistantPodium);

  // 사람(1~4P)이 맡을 자리: 악기마다 우선순위
  const SEATS = {
    violin: [S.vio1[0], S.vio1[1], S.vio2[0], S.vio1[2]],
    piano: [S.piano[0], S.piano[1]],
    voice: S.voice,
    trumpet: [S.trumpet[1], S.trumpet[0], S.trumpet[2], S.trombone[0]],
    horn: [S.horn[1], S.horn[0], S.horn[2], S.trombone[1]],
    drum: [S.kit[0], S.timp[0], S.bass[0]],
    castanets: [S.cast[0], S.cast[1]],
    conductor: [conductor, conductor2],
  };

  // ───────── 조명 ─────────
  const hemi = new THREE.HemisphereLight(0x8090b0, 0x1a0c0c, 0.35);
  scene.add(hemi);
  const keys = [];
  for (const [x, y, z, c] of [[-9, 17, 11, 0xffd6a0], [0, 19, 13, 0xffe6c2], [9, 17, 11, 0xffd6a0]]) {
    const s = new THREE.SpotLight(c, 0, 0, 0.62, 0.65, 0.9);
    s.position.set(x, y, z);
    s.target.position.set(x * 0.25, STAGE_Y, -3.5);
    scene.add(s, s.target);
    keys.push(s);
  }
  keys[1].castShadow = true;
  keys[1].shadow.mapSize.set(2048, 2048);
  keys[1].shadow.bias = -0.0004;
  keys[1].shadow.camera.near = 6;
  keys[1].shadow.camera.far = 50;
  const rim = new THREE.SpotLight(0x8fb2ff, 0, 0, 0.75, 0.7, 0.9);
  rim.position.set(0, 15, -16);
  rim.target.position.set(0, STAGE_Y, 0);
  scene.add(rim, rim.target);
  const follow = new THREE.SpotLight(0xfff4e0, 0, 0, 0.13, 0.55, 0.8);
  follow.position.set(0, 16, 14);
  scene.add(follow, follow.target);
  const organGlow = new THREE.PointLight(0xffa860, 0, 18, 1.6);
  organGlow.position.set(0, STAGE_Y + 9, CZ - 10.5);
  scene.add(organGlow);
  // 사람 자리 조명(미리 4개 만들어 두고 세기만 바꿈 → 셰이더 다시 만들지 않음)
  const pSpots = [1, 2, 3, 4].map(() => {
    const s = new THREE.SpotLight(0xffffff, 0, 16, 0.3, 0.55, 1.1);
    scene.add(s, s.target);
    return s;
  });
  const rings = [1, 2, 3, 4].map(() => {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.7, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    r.rotation.x = -Math.PI / 2;
    scene.add(r);
    return r;
  });
  // 사람 자리 빛기둥: 위에서 떨어지는 그 사람 색 조명 줄기(아래로 갈수록 진함)
  const beamTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = 4; cv.height = 128;
    const g = cv.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.55, 'rgba(255,255,255,.35)');
    gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 128);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const BEAM_H = 6.5;
  const beams = [1, 2, 3, 4].map(() => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.85, BEAM_H, 32, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffffff, map: beamTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    b.visible = false;
    b.renderOrder = 5;
    scene.add(b);
    return b;
  });
  const tags = [1, 2, 3, 4].map(() => {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 96;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(2.1, 0.79, 1);
    sp.visible = false;
    sp.renderOrder = 10;
    scene.add(sp);
    return { sp, cv, tex, key: '' };
  });
  // 반짝(PERFECT)
  const sparks = [1, 2, 3, 4].map(() => {
    const n = 40;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffd23a, size: 0.09, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(pts);
    return { pts, vel: new Float32Array(n * 3), t: 9, origin: new THREE.Vector3() };
  });

  // ───────── 후처리(은은한 빛 번짐) ─────────
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.36, 0.5, 0.93);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ───────── 상태 ─────────
  let mode = 'lobby';
  let playersBySlot = new Map(); // slot -> musician
  const sect = { melody: 0, harmony: 0, bass: 0, chords: 0, drums: 0, perc: 0 };
  let intro = null; // { t0, resolve }
  let outro = null;
  let beatPos = 0, songRef = null, humanLeader = false;
  const batonPose = new Map(); // slot -> { x, y, t }
  let lightMix = { key: 0.6, house: 1, rim: 0.4 };
  let t0 = performance.now();
  const camState = { pos: camera.position.clone(), look: camLook.clone() };
  let countPrep = 0;

  function setPlayers(list) {
    // 이전 표시 지우기
    for (const m of musicians) m.slot = null;
    playersBySlot = new Map();
    const used = new Map();
    for (const p of list) {
      if (!p.inst || !SEATS[p.inst]) continue;
      const k = used.get(p.inst) || 0;
      used.set(p.inst, k + 1);
      const m = SEATS[p.inst][k];
      if (!m) continue;
      m.slot = p.slot;
      m.color = p.color;
      playersBySlot.set(p.slot, m);
      if (p.inst === 'voice') m.g.visible = true;
      updateTag(p.slot - 1, p);
    }
    // 독창자는 맡은 사람이 없으면 첫 사람만 보입니다
    S.voice.forEach((m, i) => { m.g.visible = i === 0 || m.slot != null; });
    conductor2.g.visible = conductor2.slot != null && (mode === 'perform' || mode === 'over');
    assistantPodium.visible = conductor2.g.visible;
    for (let i = 0; i < 4; i++) {
      const slot = i + 1;
      const m = playersBySlot.get(slot);
      const p = list.find((x) => x.slot === slot);
      const sp = pSpots[i], ring = rings[i], tag = tags[i], beam = beams[i];
      if (!m || !p) { sp.intensity = 0; ring.material.opacity = 0; tag.sp.visible = false; beam.visible = false; continue; }
      const c = new THREE.Color(p.color);
      sp.color.copy(c);
      ring.material.color.copy(c);
      beam.material.color.copy(c);
      const wp = new THREE.Vector3();
      m.g.getWorldPosition(wp);
      sp.position.set(wp.x, wp.y + 6.5, wp.z + 2.6);
      sp.target.position.copy(wp);
      ring.position.set(wp.x, wp.y + 0.02, wp.z);
      ring.userData.base = 1;
      tag.sp.visible = true;
      tag.sp.position.set(wp.x, wp.y + (m.p.stand ? 2.55 : 2.15), wp.z);
      beam.position.set(wp.x, wp.y + BEAM_H / 2, wp.z);
      beam.visible = true;
    }
  }
  function updateTag(i, p) {
    const t = tags[i];
    const key = `${p.name}|${p.inst}|${p.color}`;
    if (t.key === key) return;
    t.key = key;
    const g = t.cv.getContext('2d');
    g.clearRect(0, 0, 256, 96);
    g.fillStyle = 'rgba(10,8,14,.82)';
    rr(g, 4, 18, 248, 62, 30);
    g.fill();
    g.fillStyle = p.color;
    rr(g, 10, 24, 70, 50, 25);
    g.fill();
    g.fillStyle = '#0b0f17';
    g.font = '400 34px Anton, Impact, sans-serif';
    g.textAlign = 'center';
    g.fillText(p.name, 45, 62);
    g.fillStyle = '#fff';
    g.font = '800 30px "Pretendard Variable", Pretendard, sans-serif';
    g.fillText(INSTRUMENTS[p.inst].label, 165, 61);
    t.tex.needsUpdate = true;
  }

  function setMode(m) {
    mode = m;
    if (m !== 'perform') { intro = null; }
    if (m === 'lobby' || m === 'practice' || m === 'select') { conductor.g.visible = false; outro = null; }
    conductor2.g.visible = conductor2.slot != null && (m === 'perform' || m === 'over');
    assistantPodium.visible = conductor2.g.visible;
  }
  function introP() {
    return new Promise((resolve) => {
      conductor.g.visible = true;
      intro = { t0: performance.now(), resolve };
    });
  }
  function skipIntro() {
    conductor.g.visible = true;
    if (intro) { const r = intro.resolve; intro = null; r(); }
    conductor.g.position.set(0, STAGE_Y + PODIUM_H, CZ);
    conductor.g.rotation.y = Math.PI;
    for (const m of musicians) m.ready = 1;
  }
  function outroP() { outro = { t0: performance.now() }; }

  // ───────── 움직임 ─────────
  const WALK = 2.9, TURN1 = 0.45, BOW = 1.7, TURN2 = 0.55;
  const WALK_Z = 1.5; // 앞줄 보면대보다 앞
  const INTRO_T = WALK + TURN1 + BOW + TURN2 + 2.3; // 줌아웃 마무리까지
  function animConductor(m, t, dt) {
    const p = m.p;
    const g = m.g;
    // 인사 전 입장
    if (intro) {
      const e = (performance.now() - intro.t0) / 1000;
      const sx = -9.5;
      if (e < WALK) {
        const u = e / WALK;
        g.position.set(lerp(sx, 0, easeIO(u)), STAGE_Y + (u > 0.88 ? PODIUM_H * ease((u - 0.88) / 0.12) : 0), lerp(WALK_Z, CZ, ease((u - 0.74) / 0.24)));
        g.rotation.y = Math.PI / 2;
        walkPose(p, e * 2.1, 1 - ease((u - 0.9) / 0.1));
      } else if (e < WALK + TURN1) {
        const u = (e - WALK) / TURN1;
        g.position.set(0, STAGE_Y + PODIUM_H, CZ);
        g.rotation.y = lerp(Math.PI / 2, 0, easeIO(u));
        standPose(p);
      } else if (e < WALK + TURN1 + BOW) {
        const u = (e - WALK - TURN1) / BOW;
        g.rotation.y = 0;
        const b = Math.sin(clamp(u * 1.25, 0, 1) * Math.PI);
        standPose(p);
        p.torso.rotation.x = b * 0.78;
        p.head.rotation.x = b * 0.25;
        setArm(p.armR, -0.5 * b, 0, 0.05, -1.6 * b); // 오른손은 가슴에
        setArm(p.armL, 0.05, 0, 0.25 + 0.25 * b, 0);
      } else if (e < WALK + TURN1 + BOW + TURN2) {
        const u = (e - WALK - TURN1 - BOW) / TURN2;
        g.rotation.y = lerp(0, Math.PI, easeIO(u));
        standPose(p);
        readyPose(p, ease(u));
      } else {
        g.rotation.y = Math.PI;
        readyPose(p, 1);
        if (e > INTRO_T) { const r = intro.resolve; intro = null; r(); }
      }
      return;
    }
    if (outro) {
      const e = (performance.now() - outro.t0) / 1000;
      if (e < 0.6) g.rotation.y = lerp(Math.PI, 0, easeIO(e / 0.6));
      else {
        g.rotation.y = 0;
        const b = Math.sin(clamp((e - 0.6) / 1.6, 0, 1) * Math.PI);
        standPose(p);
        p.torso.rotation.x = b * 0.7;
        p.head.rotation.x = b * 0.25;
        setArm(p.armR, 0.1, 0, -0.5 - 0.6 * (1 - b), 0);
        setArm(p.armL, 0.1, 0, 0.5 + 0.6 * (1 - b), 0);
      }
      return;
    }
    if (!g.visible) return;
    // 지휘: 사람이 하면 그 사람 지휘봉, 아니면 박에 맞춘 무늬
    const pose = m.slot != null ? batonPose.get(m.slot) : null;
    let bx, by;
    if (pose && performance.now() - pose.t < 600) { bx = clamp(pose.x / 45, -1, 1); by = clamp(pose.y / 45, -1, 1); }
    else if (songRef && mode === 'perform') { [bx, by] = patternPoint(beatPos, songRef); }
    else { bx = Math.sin(t * 0.8) * 0.1; by = 0.3 + countPrep * 0.4; }
    m.extra.bx = lerp(m.extra.bx ?? 0, bx, clamp(dt * 14, 0, 1));
    m.extra.by = lerp(m.extra.by ?? 0, by, clamp(dt * 14, 0, 1));
    standPose(p);
    // 지휘봉 팔(오른쪽): 위아래 = 어깨 앞뒤, 좌우 = 어깨 옆
    setArm(p.armR, -1.15 - m.extra.by * 0.55, 0, -0.35 - m.extra.bx * 0.55, -0.55 + m.extra.by * 0.2);
    setArm(p.armL, -0.75 - m.extra.by * 0.25 - m.level * 0.3, 0, 0.35 + m.extra.bx * 0.2, -0.6);
    p.torso.rotation.y = -m.extra.bx * 0.12;
    p.head.rotation.x = -0.1;
    m.level *= Math.exp(-dt * 3);
  }
  function walkPose(p, ph, k) {
    const s = Math.sin(ph * Math.PI);
    for (let i = 0; i < p.legs.length; i++) { p.legs[i].leg.rotation.x = (i ? 1 : -1) * s * 0.45 * k; p.legs[i].knee.rotation.x = Math.max(0, (i ? -1 : 1) * s) * 0.5 * k; }
    setArm(p.armR, s * 0.35 * k, 0, 0.06, -0.2);
    setArm(p.armL, -s * 0.35 * k, 0, -0.06, -0.2);
    p.hips.position.y = 0.95 + Math.abs(Math.cos(ph * Math.PI)) * 0.03 * k;
    p.torso.rotation.x = 0.04;
  }
  function standPose(p) {
    for (const l of p.legs) { l.leg.rotation.x = 0; l.knee.rotation.x = 0; }
    p.hips.position.y = 0.95;
    p.torso.rotation.set(0, 0, 0);
    p.head.rotation.set(0, 0, 0);
    setArm(p.armR, 0, 0, 0.08, -0.1);
    setArm(p.armL, 0, 0, -0.08, -0.1);
  }
  function readyPose(p, k) {
    setArm(p.armR, -1.15 * k, 0, -0.35 * k, -0.55 * k);
    setArm(p.armL, -0.75 * k, 0, 0.35 * k, -0.6 * k);
  }
  // 박 위치 → 지휘봉 끝(무늬). x 오른쪽, y 위(-1~1)
  const PATH = {
    4: [[0, 0.75], [0, -0.75], [-0.75, -0.35], [0.85, -0.4], [0.05, 0.8]],
    3: [[0, 0.75], [0, -0.75], [0.8, -0.38], [0.05, 0.8]],
    2: [[0, 0.75], [0, -0.75], [0.05, 0.8]],
  };
  function patternPoint(beat, song) {
    const pat = patternOf(song);
    const n = pat.length;
    const pos = ((beat % song.barLen) + song.barLen) % song.barLen;
    let k = 0;
    for (let i = 0; i < n; i++) if (pos >= pat[i][0]) k = i;
    const a = pat[k][0], b = k + 1 < n ? pat[k + 1][0] : song.barLen;
    const u = clamp((pos - a) / (b - a), 0, 1);
    const P = PATH[n] || PATH[4];
    // 박점(k+1) → 다음 박점: 튀어 올랐다 떨어지는 곡선
    const from = P[k + 1], to = P[(k + 1) % n + 1] || P[1];
    const x = lerp(from[0], to[0], easeIO(u));
    const y = lerp(from[1], to[1], u) + Math.sin(u * Math.PI) * 0.45;
    return [x, y];
  }

  function animMusician(m, t, dt) {
    const p = m.p;
    const isP = m.slot != null;
    const target = isP ? (performance.now() - m.lvT < 450 ? m.level : m.level * 0.94) : sect[m.section] || 0;
    m.act = lerp(m.act || 0, target, clamp(dt * 10, 0, 1));
    const a = m.act * m.ready;
    const hitAge = (performance.now() - m.hitT) / 1000;
    const hit = hitAge < 0.25 ? Math.sin((hitAge / 0.25) * Math.PI) : 0;
    const sway = Math.sin(t * 1.6 + m.phase) * 0.04 * (0.3 + a);
    p.torso.rotation.z = sway;
    switch (m.kind) {
      case 'violin': case 'viola': {
        m.bowPh += dt * (1.2 + a * 3.2) * m.bowDir;
        const b = Math.sin(m.bowPh);
        const violin = m.extra.violin;
        const V = violinPose;
        V.neck.set(0,.23,.025).applyMatrix4(violin.matrix);
        reachArm(p.armL, V.neck, V.leftPole);
        V.contact.set(0,.10+b*.035,.045).applyMatrix4(violin.matrix);
        V.across.copy(V.xAxis).applyQuaternion(violin.quaternion).normalize();
        V.grip.copy(V.contact).addScaledVector(V.across,-.30);
        reachArm(p.armR, V.grip, V.rightPole);
        p.head.rotation.set(0.15, 0.3, 0.25);
        if (m.extra.bow) {
          V.parent.copy(p.armR.sh.quaternion).multiply(p.armR.el.quaternion);
          V.inv.copy(V.parent).invert();
          V.bow.setFromUnitVectors(V.xAxis, V.across);
          m.extra.bow.quaternion.copy(V.inv).multiply(V.bow);
          m.extra.bow.position.copy(V.across).applyQuaternion(V.inv).multiplyScalar(.30);
        }
        break;
      }
      case 'cello': {
        m.bowPh += dt * (1 + a * 2.5) * m.bowDir;
        const b = Math.sin(m.bowPh);
        setArm(p.armL, -0.9, 0, 0.3, -1.2);
        setArm(p.armR, -0.7, 0, -0.35 - b * 0.4 * (0.25 + a), -0.6);
        p.head.rotation.set(0.25, 0, 0);
        break;
      }
      case 'trumpet': case 'trombone': case 'horn': case 'flute': {
        const lift = m.ready * (0.6 + 0.4 * Math.min(1, a * 2));
        if (m.kind === 'horn') { setArm(p.armL, -0.8 * lift, 0, 0.45, -1.4 * lift); setArm(p.armR, -0.6 * lift, 0, -0.5, -1.2 * lift); }
        else if (m.kind === 'flute') { setArm(p.armR, -1.1 * lift, 0, -0.4, -1.7 * lift); setArm(p.armL, -1.25 * lift, 0, 0.75, -1.7 * lift); }
        else { setArm(p.armR, -1.2 * lift, 0, -0.18, -1.55 * lift); setArm(p.armL, -1.25 * lift, 0, 0.18, -1.6 * lift); }
        if (m.extra.horn) { m.extra.horn.visible = true; m.extra.horn.rotation.x = -0.15 * lift - a * 0.12 + (m.kind === 'flute' ? 0 : -0.2); }
        if (m.extra.bell && m.extra.bell.material) { /* 공유 재질이라 색은 안 바꿉니다 */ }
        p.torso.rotation.x = -a * 0.06;
        p.head.rotation.x = 0.05;
        break;
      }
      case 'timpani': case 'kit': {
        const up = m.ready;
        const r = m.hitArm > 0 ? hit : 0, l = m.hitArm < 0 ? hit : 0;
        setArm(p.armR, (-0.7 - 0.55 * r + 0.35 * (1 - r) * a) * up, 0, -0.25, -0.9 + 0.5 * r);
        setArm(p.armL, (-0.7 - 0.55 * l + 0.35 * (1 - l) * a) * up, 0, 0.25, -0.9 + 0.5 * l);
        p.torso.rotation.x = 0.12;
        if (m.extra.cym) m.extra.cym.rotation.z = hit * 0.08;
        break;
      }
      case 'piano': {
        const b1 = m.hitArm > 0 ? hit : 0, b2 = m.hitArm < 0 ? hit : 0;
        setArm(p.armR, -0.85 + b1 * 0.15, 0.1, -0.12, -0.75 - b1 * 0.25);
        setArm(p.armL, -0.85 + b2 * 0.15, -0.1, 0.12, -0.75 - b2 * 0.25);
        p.torso.rotation.x = 0.1 + a * 0.06;
        p.head.rotation.x = 0.15;
        break;
      }
      case 'castanets': {
        const c = hit;
        setArm(p.armR, -2.4 * m.ready, 0, -0.5 + c * 0.35, -0.9);
        setArm(p.armL, -2.4 * m.ready, 0, 0.5 - c * 0.35, -0.9);
        p.torso.rotation.x = -0.05;
        p.hips.position.y = 0.95 + hit * 0.04;
        break;
      }
      case 'voice': {
        const open = clamp(a * 1.4, 0, 1);
        setArm(p.armR, -0.35 - open * 0.5, 0, -0.35 - open * 0.45, -0.7);
        setArm(p.armL, -0.35 - open * 0.5, 0, 0.35 + open * 0.45, -0.7);
        p.mouth.scale.set(1, 0.2 + open * 1.4, 1);
        p.torso.rotation.x = -open * 0.08;
        p.head.rotation.x = -open * 0.15;
        break;
      }
      default: break;
    }
  }

  // ───────── 카메라 ─────────
  // 연주 화면: 위 막대와 아래 악보 칸 사이에 악단이 꽉 차게(객석 가운데 높은 자리에서)
  const WIDE = { pos: new THREE.Vector3(0, 6.0, 16.2), look: new THREE.Vector3(0, 1.55, -3.2) };
  const _p = new THREE.Vector3(), _l = new THREE.Vector3();
  function closePlayerFor(t) {
    if (mode !== 'perform' || intro || outro || t % 28 < 14 || t % 28 >= 22) return null;
    const players = [...playersBySlot.values()].filter((m) => m && m.g.visible);
    return players.length ? players[Math.floor(t / 28) % players.length] : null;
  }
  function cameraFor(t) {
    if (intro) {
      const e = (performance.now() - intro.t0) / 1000;
      const cp = conductor.g.position;
      const zoomStart = WALK + TURN1 + BOW * 0.55;
      const close = { pos: new THREE.Vector3(cp.x * 0.85 + 1.1, STAGE_Y + 1.75, cp.z + 4.4), look: new THREE.Vector3(cp.x + 0.15, STAGE_Y + 1.25, cp.z) };
      if (e < zoomStart) { _p.copy(close.pos); _l.copy(close.look); }
      else {
        const u = easeIO((e - zoomStart) / (INTRO_T - zoomStart));
        _p.lerpVectors(close.pos, WIDE.pos, u);
        _p.y += Math.sin(u * Math.PI) * 1.4;
        _l.lerpVectors(close.look, WIDE.look, u);
      }
      return;
    }
    if (mode === 'perform') {
      _p.set(WIDE.pos.x + Math.sin(t * 0.07) * 1.6, WIDE.pos.y + Math.sin(t * 0.05) * 0.3, WIDE.pos.z - 0.8);
      _l.copy(WIDE.look);
      // Brief, gentle cutaways show the active player's performance; the score
      // HUD stays in its fixed screen-space position and keeps animating.
      const m = closePlayerFor(t);
      if (m) {
        const facing = m.g.rotation.y;
        const side = 1.6, front = 3.25;
        _p.set(m.g.position.x + side*Math.cos(facing) + front*Math.sin(facing),
          m.g.position.y + (m.p.stand ? 1.75 : 1.45),
          m.g.position.z - side*Math.sin(facing) + front*Math.cos(facing));
        _l.set(m.g.position.x, m.g.position.y + (m.p.stand ? 1.25 : .95), m.g.position.z);
      }
      return;
    }
    if (mode === 'over') {
      _p.set(Math.sin(t * 0.1) * 3, 5.2, 15.5);
      _l.set(0, 2.6, -1.5);
      return;
    }
    // 대기실: 천천히 돌아보기
    const a = Math.sin(t * 0.05) * 0.32;
    _p.set(Math.sin(a) * 23 + 3, 8.6, Math.cos(a) * 23 - 2);
    _l.set(mode === 'lobby' ? -4.6 : 0, 2.4, -3.2);
  }

  // ───────── 그리기 ─────────
  function render(dt, now) {
    const t = (now - t0) / 1000;
    // 조명 분위기
    const want = mode === 'perform' ? { key: 1, house: 0.18, rim: 1 } : mode === 'over' ? { key: 1.05, house: 0.55, rim: 0.9 } : { key: 0.62, house: 1, rim: 0.5 };
    for (const k of Object.keys(lightMix)) lightMix[k] = lerp(lightMix[k], want[k], clamp(dt * 1.6, 0, 1));
    keys.forEach((s, i) => { s.intensity = (i === 1 ? 58 : 46) * lightMix.key; });
    rim.intensity = 34 * lightMix.rim;
    hemi.intensity = 0.12 + 0.3 * lightMix.house;
    organGlow.intensity = 10 + 30 * lightMix.key;
    for (const c of chandeliers) c.material.color.setScalar(0.35 + 0.65 * lightMix.house);
    // 입장 때 따라가는 조명
    if (intro || outro) {
      follow.intensity = lerp(follow.intensity, 42, clamp(dt * 3, 0, 1));
      follow.target.position.copy(conductor.g.position);
    } else follow.intensity = lerp(follow.intensity, 0, clamp(dt * 2, 0, 1));
    // 구역 소리 세기 줄이기
    for (const k of Object.keys(sect)) sect[k] *= Math.exp(-dt * 2.4);
    // 단원 준비 자세(연주 시작 전엔 악기를 내리고 있음)
    const ready = mode === 'perform' ? (intro ? ease(((performance.now() - intro.t0) / 1000 - (WALK + TURN1 + BOW)) / 1.5) : 1) : mode === 'over' ? 0.4 : 0.15;
    for (const m of musicians) {
      if (m.kind === 'conductor') { animConductor(m, t, dt); continue; }
      m.ready = lerp(m.ready, ready, clamp(dt * 3, 0, 1));
      animMusician(m, t, dt);
    }
    // 사람 자리 조명·고리
    const closePlayer = closePlayerFor(t);
    for (let i = 0; i < 4; i++) {
      const m = playersBySlot.get(i + 1);
      const sp = pSpots[i], ring = rings[i];
      if (!m) continue;
      const lv = clamp(m.act || 0, 0, 1);
      const show = mode === 'lobby' || mode === 'practice' || mode === 'select' || (m.g.visible && (!intro || ready > 0.3));
      sp.intensity = show ? (m === closePlayer ? 4 + 8 * lv : 14 + 22 * lv) : 0;
      ring.material.opacity = show ? 0.45 + 0.45 * lv : 0;
      ring.scale.setScalar(1 + lv * 0.25);
      // 이름표는 줌아웃이 거의 끝난 뒤에(가까이 지나갈 때 화면을 가리지 않게)
      const introLeft = intro ? INTRO_T - (performance.now() - intro.t0) / 1000 : 0;
      tags[i].sp.visible = show && m.g.visible && introLeft < 0.7 && !closePlayer;
      beams[i].material.opacity = show && m.g.visible ? 0.1 + 0.2 * lv : 0;
      beams[i].visible = beams[i].material.opacity > 0.001 && m !== closePlayer;
      if (m.kind === 'conductor') { const wp = m.g.position; ring.position.set(wp.x, wp.y + 0.03, wp.z); tags[i].sp.position.set(wp.x, wp.y + 2.55, wp.z); sp.target.position.copy(wp); beams[i].position.set(wp.x, wp.y + BEAM_H / 2, wp.z); }
    }
    // 반짝
    for (const s of sparks) {
      s.t += dt;
      const a = s.pts.geometry.attributes.position;
      if (s.t > 1.2) { s.pts.material.opacity = 0; continue; }
      for (let k = 0; k < a.count; k++) {
        a.array[k * 3] += s.vel[k * 3] * dt;
        a.array[k * 3 + 1] += s.vel[k * 3 + 1] * dt;
        a.array[k * 3 + 2] += s.vel[k * 3 + 2] * dt;
        s.vel[k * 3 + 1] -= dt * 1.2;
      }
      a.needsUpdate = true;
      s.pts.material.opacity = 1 - s.t / 1.2;
    }
    cameraFor(t);
    const k = intro ? 1 : clamp(dt * 1.6, 0, 1);
    camState.pos.lerp(_p, k);
    camState.look.lerp(_l, k);
    camera.position.copy(camState.pos);
    camera.lookAt(camState.look);
    composer.render(dt);
  }

  // ───────── 바깥에서 부르는 것 ─────────
  function playerAct(slot, kind, d) {
    const m = playersBySlot.get(slot);
    if (!m) return;
    if (kind === 'release') { m.level = 0; m.lvT = 0; return; }
    if (kind === 'beat') { m.level = Math.min(1, (d && d.size ? d.size / 40 : 0.6)); m.lvT = performance.now(); return; }
    m.hitT = performance.now();
    m.hitArm = kind === 'key' ? (d && d.m >= 60 ? 1 : -1) : -m.hitArm;
    if (kind === 'bow' && d && d.dir) m.bowDir = d.dir;
    m.level = Math.max(m.level || 0, d && d.vel ? clamp(d.vel, 0.3, 1) : 0.7);
    m.lvT = performance.now();
  }
  function playerLevel(slot, lv) {
    const m = playersBySlot.get(slot);
    if (!m) return;
    m.level = clamp(lv, 0, 1);
    m.lvT = performance.now();
  }
  function judgeFx(slot, j) {
    if (j !== 'perfect') return;
    const m = playersBySlot.get(slot);
    if (!m) return;
    const s = sparks[slot - 1];
    if (s.t < 0.15) return;
    s.t = 0;
    const wp = new THREE.Vector3();
    m.g.getWorldPosition(wp);
    const a = s.pts.geometry.attributes.position;
    for (let k = 0; k < a.count; k++) {
      a.array[k * 3] = wp.x; a.array[k * 3 + 1] = wp.y + 1.5; a.array[k * 3 + 2] = wp.z;
      const th = rand() * Math.PI * 2, sp = 0.6 + rand() * 1.4;
      s.vel[k * 3] = Math.cos(th) * sp; s.vel[k * 3 + 1] = 1 + rand() * 1.6; s.vel[k * 3 + 2] = Math.sin(th) * sp;
    }
    s.pts.material.color.set(m.color || 0xffd23a).lerp(new THREE.Color(0xffd23a), 0.5);
  }
  function section(track, vel = 0.8) {
    if (!(track in sect)) return;
    sect[track] = Math.max(sect[track], 0.35 + vel * 0.65);
    // 북 소리에 맞춰 타악기 단원 팔
    if (track === 'drums' || track === 'perc') for (const m of musicians) if (m.section === track && m.slot == null && rand() < 0.6) { m.hitT = performance.now(); m.hitArm = -m.hitArm; }
    if (track === 'chords') for (const m of S.piano) if (m.slot == null) { m.hitT = performance.now(); m.hitArm = -m.hitArm; }
    if (track === 'melody' || track === 'harmony' || track === 'bass') for (const m of musicians) if (m.section === track && m.slot == null && rand() < 0.3) m.bowDir = -m.bowDir;
  }

  return {
    canvas,
    renderer,
    resize,
    render,
    setMode,
    setPlayers,
    intro: introP,
    skipIntro,
    outro: outroP,
    beat() {},
    countBeat(i) { countPrep = 1; conductor.level = 0.6 + (i === 0 ? 0.3 : 0); },
    section,
    playerAct,
    playerLevel,
    baton(slot, x, y) { batonPose.set(slot, { x, y, t: performance.now() }); },
    judge: judgeFx,
    setTempo(b, song, lead) { beatPos = b; songRef = song; humanLeader = lead; },
    get musicians() { return musicians; },
    get introLength() { return INTRO_T; },
  };
}

function rr(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// 무대 나무 판자 무늬(캔버스)
function makePlankTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1024;
  const g = cv.getContext('2d');
  const n = 24;
  const w = 1024 / n;
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    let y = -r() * 400;
    while (y < 1024) {
      const len = 260 + r() * 420;
      const l = 30 + r() * 10;
      g.fillStyle = `hsl(${24 + r() * 8}, ${48 + r() * 12}%, ${l}%)`;
      g.fillRect(i * w, y, w, len);
      g.strokeStyle = 'rgba(0,0,0,.25)';
      g.lineWidth = 2;
      g.strokeRect(i * w + 1, y, w - 2, len);
      for (let k = 0; k < 6; k++) {
        g.strokeStyle = `rgba(40,18,6,${0.08 + r() * 0.1})`;
        g.lineWidth = 1;
        g.beginPath();
        const x = i * w + 4 + r() * (w - 8);
        g.moveTo(x, y);
        g.bezierCurveTo(x + (r() - 0.5) * 6, y + len * 0.3, x + (r() - 0.5) * 6, y + len * 0.6, x + (r() - 0.5) * 4, y + len);
        g.stroke();
      }
      y += len;
    }
  }
  return new THREE.CanvasTexture(cv);
}
