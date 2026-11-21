// 양궁 모델: 리커브 활(리저·림·시위·사이트·스태빌라이저·클리커), 화살, 손, 과녁, 풍향계·깃발, 관중석, 나무.
// 활 좌표(bow space): 그립 중앙이 원점, +Y 위, -Z 과녁 쪽, +Z 사수 쪽(시위가 있는 쪽), +X 오른쪽.
import * as THREE from 'three';
import { RING_COLORS, RING_W, FACE_R, X_R } from './scoring.mjs';

const V3 = THREE.Vector3;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- 재질 ----------
export function makeMats() {
  return {
    alu: new THREE.MeshStandardMaterial({ color: '#c3c9d2', metalness: 0.92, roughness: 0.3 }),
    riser: new THREE.MeshPhysicalMaterial({ color: '#d2412b', metalness: 0.85, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
    aluDark: new THREE.MeshStandardMaterial({ color: '#2a2f38', metalness: 0.85, roughness: 0.38 }),
    steel: new THREE.MeshStandardMaterial({ color: '#e5e8ee', metalness: 1, roughness: 0.18 }),
    brass: new THREE.MeshStandardMaterial({ color: '#d7a640', metalness: 1, roughness: 0.28 }),
    carbon: new THREE.MeshPhysicalMaterial({ color: '#16181d', metalness: 0.25, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.12 }),
    limbAccent: new THREE.MeshPhysicalMaterial({ color: '#e0432d', metalness: 0.1, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 }),
    wood: new THREE.MeshStandardMaterial({ color: '#7a4a28', roughness: 0.55, metalness: 0 }),
    woodLight: new THREE.MeshStandardMaterial({ color: '#b98a55', roughness: 0.7 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#17181b', roughness: 0.85 }),
    string: new THREE.MeshStandardMaterial({ color: '#efe4c4', roughness: 0.6, emissive: '#6a5a30', emissiveIntensity: 0.8 }),
    skin: new THREE.MeshStandardMaterial({ color: '#d99c76', roughness: 0.62 }),
    sleeve: new THREE.MeshStandardMaterial({ color: '#1d2a44', roughness: 0.9 }),
    leather: new THREE.MeshStandardMaterial({ color: '#4b3426', roughness: 0.7 }),
    shaft: new THREE.MeshStandardMaterial({ color: '#c9d0da', metalness: 0.9, roughness: 0.28 }),
    pinGlow: new THREE.MeshStandardMaterial({ color: '#7dff9a', emissive: '#4dff7a', emissiveIntensity: 2.2, roughness: 0.4 }),
    straw: new THREE.MeshStandardMaterial({ color: '#c8aa6a', roughness: 1 })
  };
}

// ---------- 림(휘어진 얇은 판): 점 목록을 따라 사각 단면을 쓸어 만듭니다. 시위를 당기면 점을 바꿔 다시 계산 ----------
const LIMB_N = 28;
function makeLimbGeometry() {
  const g = new THREE.BufferGeometry();
  const vcount = LIMB_N * 8; // 단면 4면 × (한 면당 점 2개/마디)
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vcount * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vcount * 3), 3));
  const idx = [];
  for (let f = 0; f < 4; f++) {
    for (let i = 0; i < LIMB_N - 1; i++) {
      const a = (f * LIMB_N + i) * 2;
      const b = (f * LIMB_N + i + 1) * 2;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  g.setIndex(idx);
  return g;
}
// 림 중심선(+위쪽 림 기준: s 0..1). draw 0..1 이면 끝이 사수 쪽으로 휨
const LIMB_PTS = [[0.0, -0.012], [0.07, 0.01], [0.17, 0.075], [0.3, 0.155], [0.43, 0.215], [0.5, 0.238], [0.57, 0.228], [0.61, 0.205]];
function limbCenterline(draw) {
  // CatmullRom 으로 곡선을 만들어 LIMB_N 개 점으로
  const pts = LIMB_PTS.map(([dy, z], i) => {
    const w = Math.pow(i / (LIMB_PTS.length - 1), 1.6);
    return new V3(0, 0.22 + dy - 0.045 * draw * w, z + 0.13 * draw * w);
  });
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  return curve.getSpacedPoints(LIMB_N - 1);
}
function updateLimb(geo, center, sign, scale = 1) {
  const pos = geo.attributes.position.array;
  const nor = geo.attributes.normal.array;
  const n = center.length;
  const t = new V3();
  const nrm = new V3();
  for (let i = 0; i < n; i++) {
    const c = center[i];
    const a = center[Math.max(0, i - 1)];
    const b = center[Math.min(n - 1, i + 1)];
    t.subVectors(b, a).normalize();
    // 단면 법선: 곡선이 휜 평면(yz) 안에서 접선에 수직
    nrm.set(0, -t.z, t.y).normalize();
    const u = i / (n - 1);
    const hw = lerp(0.034, 0.016, Math.pow(u, 1.2)) * scale; // 반폭(x)
    const ht = lerp(0.011, 0.0042, u) * scale; // 반두께
    // 4모서리: (+x,+n) (-x,+n) (-x,-n) (+x,-n)
    const corners = [[hw, ht], [-hw, ht], [-hw, -ht], [hw, -ht]];
    // 면 f: 모서리 f → f+1. 정점 2개/마디/면
    for (let f = 0; f < 4; f++) {
      const c0 = corners[f];
      const c1 = corners[(f + 1) % 4];
      let nx = 0, ny = 0, nz = 0;
      if (f === 0) { nx = nrm.x; ny = nrm.y; nz = nrm.z; }
      else if (f === 1) { nx = -1; }
      else if (f === 2) { nx = -nrm.x; ny = -nrm.y; nz = -nrm.z; }
      else { nx = 1; }
      const base = (f * n + i) * 2;
      const put = (k, cc) => {
        const o = (base + k) * 3;
        pos[o] = c.x + cc[0];
        pos[o + 1] = (c.y + nrm.y * cc[1]) * sign;
        pos[o + 2] = c.z + nrm.z * cc[1];
        nor[o] = nx;
        nor[o + 1] = ny * sign;
        nor[o + 2] = nz;
      };
      put(0, c0);
      put(1, c1);
    }
  }
  // sign=-1(아래 림)이면 y 가 뒤집혀 감기는 방향이 달라지므로 호출 쪽에서 side: DoubleSide 로 해결
  geo.attributes.position.needsUpdate = true;
  geo.attributes.normal.needsUpdate = true;
  geo.computeBoundingSphere();
}

function cylBetween(mesh, a, b, radius) {
  const d = new V3().subVectors(b, a);
  const len = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(new V3(0, 1, 0), d.normalize());
  mesh.scale.set(radius, len, radius);
}

// 화살(활에 메기는 것과 과녁에 꽂히는 것 둘 다). 길이 0.72m, 촉이 -Z 쪽 끝(원점 = 노크 쪽 끝).
export const ARROW_LEN = 0.72;
export function makeArrow(mats, color = '#ff5a5f') {
  const g = new THREE.Group();
  const segs = 18;
  const shaftGeo = new THREE.CylinderGeometry(0.0034, 0.0034, ARROW_LEN - 0.03, 8, segs, false);
  shaftGeo.rotateX(Math.PI / 2); // 축 = Z
  shaftGeo.translate(0, 0, -(ARROW_LEN - 0.03) / 2);
  const base = shaftGeo.attributes.position.array.slice();
  const shaft = new THREE.Mesh(shaftGeo, mats.shaft);
  shaft.castShadow = true;
  g.add(shaft);
  const c = new THREE.Color(color);
  const colMat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.05 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.4 });
  // 촉
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.0045, 0.03, 10), mats.steel);
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -(ARROW_LEN - 0.015);
  g.add(tip);
  // 노크(색 플라스틱)
  const nock = new THREE.Mesh(new THREE.CylinderGeometry(0.0052, 0.0044, 0.02, 10), colMat);
  nock.rotation.x = Math.PI / 2;
  nock.position.z = -0.002;
  g.add(nock);
  // 색 띠(랩)
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.0041, 0.0041, 0.05, 10, 1, true), colMat);
  wrap.rotation.x = Math.PI / 2;
  wrap.position.z = -0.1;
  g.add(wrap);
  // 깃 3장: 얇은 판, 120° 간격, 살짝 비틀림. 한 장은 흰색(콕 베인)
  const vanes = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0);
    sh.lineTo(0.052, 0);
    sh.quadraticCurveTo(0.062, 0.009, 0.05, 0.017);
    sh.lineTo(0.01, 0.017);
    sh.quadraticCurveTo(0.002, 0.012, 0, 0);
    const vg = new THREE.ShapeGeometry(sh, 6);
    // 도형은 xy 평면: x = 길이(→ -Z), y = 높이(→ 바깥)
    vg.rotateY(Math.PI / 2); // x → -z ... 아래에서 위치 맞춤
    const m = new THREE.Mesh(vg, k === 0 ? whiteMat : colMat);
    m.material = (k === 0 ? whiteMat : colMat).clone();
    m.material.side = THREE.DoubleSide;
    const holder = new THREE.Group();
    holder.rotation.z = (k * 2 * Math.PI) / 3;
    m.position.set(0, 0.0036, -0.018);
    m.rotation.z = 0;
    holder.add(m);
    holder.rotation.z += 0;
    vanes.add(holder);
  }
  g.add(vanes);
  // 비틀림(헬리컬) 흉내: 전체 깃 묶음을 약간 돌림
  vanes.rotation.z = 0.0;
  g.userData = {
    shaft,
    base,
    segs,
    // 축을 따라 휘는 정도(원 좌표 기준 x/y 오프셋). t = 시간, amp = 진폭(m)
    flex(t, amp, freq = 22, decay = 0) {
      const p = shaftGeo.attributes.position.array;
      const L = ARROW_LEN - 0.03;
      const k = Math.exp(-decay);
      for (let i = 0; i < p.length; i += 3) {
        const z = base[i + 2];
        const s = clamp(-z / L, 0, 1);
        const w = Math.sin(Math.PI * s);
        p[i] = base[i] + Math.sin(t * freq) * amp * k * w;
        p[i + 1] = base[i + 1] + Math.sin(t * freq * 0.83 + 1.1) * amp * 0.4 * k * w;
      }
      shaftGeo.attributes.position.needsUpdate = true;
    }
  };
  return g;
}

// ---------- 활 ----------
export function makeBow(mats) {
  const root = new THREE.Group(); // 활 전체(bow space)
  const add = (m, parent = root) => { m.castShadow = true; parent.add(m); return m; };

  // 리저: 알루미늄 판을 깎아 낸 모양(창문 = 왼쪽이 터진 사이트 윈도우)
  const sh = new THREE.Shape();
  sh.moveTo(0.022, 0.265);
  sh.lineTo(-0.022, 0.265);
  sh.bezierCurveTo(-0.03, 0.22, -0.066, 0.19, -0.072, 0.15);
  sh.lineTo(-0.06, 0.128);
  sh.lineTo(0.0, 0.122); // 창문 위 모서리(중앙 쪽)
  sh.lineTo(0.0, 0.02); // 창문 오른쪽 벽 = 화살 레스트가 붙는 곳
  sh.lineTo(-0.058, 0.012);
  sh.bezierCurveTo(-0.075, -0.01, -0.062, -0.05, -0.042, -0.07); // 그립 쪽으로 이어지는 배
  sh.bezierCurveTo(-0.04, -0.14, -0.034, -0.2, -0.026, -0.265);
  sh.lineTo(0.026, -0.265);
  sh.bezierCurveTo(0.036, -0.2, 0.046, -0.12, 0.044, -0.06);
  sh.bezierCurveTo(0.044, 0.0, 0.034, 0.1, 0.03, 0.17);
  sh.bezierCurveTo(0.03, 0.2, 0.028, 0.24, 0.022, 0.265);
  const risGeo = new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 3, curveSegments: 18 });
  risGeo.translate(0, 0, -0.02);
  const riser = add(new THREE.Mesh(risGeo, mats.riser));
  // 리저 위 장식 홈(어두운 줄)
  const stripe = add(new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.18, 0.042), mats.aluDark));
  stripe.position.set(0.012, 0.07, 0);
  // 림 포켓 + 볼트
  for (const s of [1, -1]) {
    const pocket = add(new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.05, 0.05), mats.aluDark));
    pocket.position.set(0, 0.255 * s, 0);
    const bolt = add(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.062, 16), mats.steel));
    bolt.rotation.z = Math.PI / 2;
    bolt.position.set(0, 0.248 * s, 0.0);
  }
  // 그립(호두나무)
  const grip = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.11, 8, 16), mats.wood));
  grip.scale.set(1.25, 1, 1.5);
  grip.position.set(0.0, -0.085, 0.012);
  // 레스트 + 플런저 + 클리커
  const shelf = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, 0.05), mats.aluDark));
  shelf.position.set(-0.012, 0.012, -0.008);
  const plunger = add(new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.03, 12), mats.brass));
  plunger.rotation.z = Math.PI / 2;
  plunger.position.set(-0.002, 0.026, -0.016);
  const clickerBase = add(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, 0.014), mats.aluDark));
  clickerBase.position.set(-0.036, 0.1, 0.004);
  const clickerBlade = add(new THREE.Mesh(new THREE.BoxGeometry(0.0012, 0.08, 0.008), mats.steel));
  clickerBlade.position.set(-0.03, 0.062, 0.0);
  clickerBlade.rotation.z = -0.22;

  // 림
  const limbUpGeo = makeLimbGeometry();
  const limbDnGeo = makeLimbGeometry();
  const limbMatSide = mats.carbon.clone();
  limbMatSide.side = THREE.DoubleSide;
  const limbUp = add(new THREE.Mesh(limbUpGeo, limbMatSide));
  const limbDn = add(new THREE.Mesh(limbDnGeo, limbMatSide));
  // 림 위 색 띠(얇은 판): 같은 곡선을 따라가진 않고, 두 림 안쪽 면에 길게 붙임
  const accGeoUp = makeLimbGeometry();
  const accGeoDn = makeLimbGeometry();
  const accSide = mats.limbAccent.clone();
  accSide.side = THREE.DoubleSide;
  const accUp = add(new THREE.Mesh(accGeoUp, accSide));
  const accDn = add(new THREE.Mesh(accGeoDn, accSide));
  // 림 끝(팁) 캡 + 시위 홈
  const tipUp = add(new THREE.Mesh(new THREE.SphereGeometry(0.0095, 14, 10), mats.steel));
  const tipDn = add(new THREE.Mesh(new THREE.SphereGeometry(0.0095, 14, 10), mats.steel));

  // 시위: 위·아래 두 줄 + 서빙(노킹 포인트 둘, 황동)
  const strUp = add(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1), mats.string));
  const strDn = add(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1), mats.string));
  const knotA = add(new THREE.Mesh(new THREE.SphereGeometry(0.0042, 10, 8), mats.brass));
  const knotB = add(new THREE.Mesh(new THREE.SphereGeometry(0.0042, 10, 8), mats.brass));
  // 시위 뒷줄 두께 다발(서빙): 노크 주변만 조금 굵게
  const serving = add(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1), new THREE.MeshStandardMaterial({ color: '#2a2a30', roughness: 0.7 })));

  // 사이트: 확장대 + 블록 + 링(원환) + 핀. 링은 리저 오른쪽 바깥(시선이 지나는 자리)에 둠
  const sight = new THREE.Group();
  root.add(sight);
  const SX = 0.088;
  const bracket = add(new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.04, 0.03), mats.aluDark), sight);
  bracket.position.set(0.05, 0.085, -0.004);
  const ext = add(new THREE.Mesh(new THREE.CylinderGeometry(0.0052, 0.0052, 0.16, 12), mats.alu), sight);
  ext.rotation.x = Math.PI / 2;
  ext.position.set(SX - 0.012, 0.085, -0.08);
  const block = add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.034, 0.03), mats.aluDark), sight);
  block.position.set(SX - 0.012, 0.085, -0.16);
  const dial = add(new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.006, 20), mats.steel), sight);
  dial.rotation.z = Math.PI / 2;
  dial.position.set(SX + 0.004, 0.085, -0.16);
  const ringHolder = new THREE.Group();
  ringHolder.position.set(SX, 0.088, -0.17);
  sight.add(ringHolder);
  const sightMats = { ring: mats.alu.clone(), ring2: mats.aluDark.clone(), pin: mats.pinGlow.clone() };
  const ring = add(new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.0028, 12, 48), sightMats.ring), ringHolder);
  const ring2 = add(new THREE.Mesh(new THREE.TorusGeometry(0.0225, 0.0016, 10, 48), sightMats.ring2), ringHolder);
  ring2.position.z = -0.003;
  const arm = add(new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.03, 0.003), sightMats.ring), ringHolder);
  arm.position.set(0, -0.034, 0);
  const pinDot = add(new THREE.Mesh(new THREE.SphereGeometry(0.0016, 10, 8), sightMats.pin), ringHolder);
  pinDot.position.z = 0.0005;

  // 스태빌라이저: 리저 앞면에서 과녁 쪽으로 긴 막대 + 추 + 댐퍼, 옆으로 V 막대 한 쌍
  const stab = new THREE.Group();
  root.add(stab);
  const rod = add(new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.6, 14), mats.carbon), stab);
  rod.rotation.x = Math.PI / 2;
  rod.position.set(-0.012, -0.06, -0.33);
  const wBase = add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.08, 18), mats.aluDark), stab);
  wBase.rotation.x = Math.PI / 2;
  wBase.position.set(-0.012, -0.06, -0.64);
  const wRing = add(new THREE.Mesh(new THREE.CylinderGeometry(0.0155, 0.0155, 0.006, 18), mats.limbAccent), stab);
  wRing.rotation.x = Math.PI / 2;
  wRing.position.set(-0.012, -0.06, -0.605);
  const damper = add(new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.02, 14), mats.rubber), stab);
  damper.rotation.x = Math.PI / 2;
  damper.position.set(-0.012, -0.06, -0.05);
  const vbStart = new V3(-0.012, -0.075, -0.07);
  for (const sx of [-1, 1]) {
    const end = new V3(-0.012 + sx * 0.21, -0.19, -0.3);
    const vb = add(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1), mats.carbon), stab);
    cylBetween(vb, vbStart, end, 0.0055);
    const dirv = new V3().subVectors(end, vbStart).normalize();
    const vw = add(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 14, 1), mats.aluDark), stab);
    cylBetween(vw, end.clone().addScaledVector(dirv, -0.01), end.clone().addScaledVector(dirv, 0.045), 0.0105);
  }

  // 손(활 잡은 손): 손바닥 덩어리 + 엄지 + 손가락
  const hand = new THREE.Group();
  root.add(hand);
  const palm = add(new THREE.Mesh(new THREE.SphereGeometry(0.043, 20, 16), mats.skin), hand);
  palm.scale.set(1.05, 1.15, 0.9);
  palm.position.set(0.004, -0.085, 0.052);
  const thumb = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.0125, 0.06, 6, 12), mats.skin), hand);
  thumb.position.set(-0.026, -0.03, 0.036);
  thumb.rotation.set(0.1, 0, 0.35);
  for (let k = 0; k < 4; k++) {
    const f = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.0095, 0.03, 6, 10), mats.skin), hand);
    f.position.set(0.048 + k * 0.0025, -0.128 + k * 0.026, 0.02);
    f.rotation.set(0.0, 0.0, Math.PI / 2 + 0.2);
  }
  // 소매 + 팔(카메라 쪽 왼아래로)
  const arm1 = add(new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.5, 20), mats.sleeve), hand);
  arm1.position.set(-0.13, -0.24, 0.36);
  arm1.rotation.set(Math.PI / 2 + 0.28, 0, 0.32);
  const wrist = add(new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.034, 0.1, 18), mats.skin), hand);
  wrist.position.set(-0.04, -0.14, 0.13);
  wrist.rotation.set(Math.PI / 2 + 0.55, 0, 0.35);
  const guard = add(new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.041, 0.09, 20), mats.leather), hand);
  guard.position.set(-0.075, -0.18, 0.2);
  guard.rotation.set(Math.PI / 2 + 0.5, 0, 0.34);

  // 당기는 손: 시위에 건 세 손가락(검지 위, 중지·약지 아래) + 손바닥 + 팔
  const dhand = new THREE.Group();
  root.add(dhand);
  const fingerMat = mats.skin;
  const fingers = [];
  for (let k = 0; k < 3; k++) {
    const f1 = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.0062, 0.026, 6, 10), fingerMat), dhand);
    const f2 = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.0058, 0.02, 6, 10), fingerMat), dhand);
    fingers.push([f1, f2]);
  }
  const dpalm = add(new THREE.Mesh(new THREE.SphereGeometry(0.04, 18, 14), mats.skin), dhand);
  dpalm.scale.set(1.0, 0.9, 1.1);
  const darm = add(new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.3, 18), mats.sleeve), dhand);
  const tab = add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.045, 0.004), mats.leather), dhand);

  // 메겨진 화살
  const arrow = makeArrow(mats, '#ff5a5f');
  arrow.traverse((o) => { o.castShadow = false; });
  root.add(arrow);

  // 상태 갱신
  const state = { draw: 0, hasArrow: true, loosed: 0 };
  const tipUpPos = new V3();
  const tipDnPos = new V3();
  const nockPos = new V3();
  const upPts = [];
  const dnPts = [];
  function layout(draw, opts = {}) {
    state.draw = draw;
    // 림
    const cUp = limbCenterline(draw);
    updateLimb(limbUpGeo, cUp, 1);
    updateLimb(limbDnGeo, cUp, -1);
    const cAcc = cUp.map((p) => p.clone());
    updateLimb(accGeoUp, cAcc, 1, 0.55);
    updateLimb(accGeoDn, cAcc, -1, 0.55);
    // 색띠는 림 표면보다 살짝 앞
    accUp.position.z = 0.0013; accDn.position.z = 0.0013;
    const last = cUp[cUp.length - 1];
    tipUpPos.set(0, last.y, last.z);
    tipDnPos.set(0, -last.y, last.z);
    tipUp.position.copy(tipUpPos);
    tipDn.position.copy(tipDnPos);
    // 시위: 놓았을 때(loosed>0)는 잠깐 떨림
    const brace = last.z;
    const nockZ = brace + draw * 0.64 * 1.0;
    const wob = opts.wobble || 0;
    nockPos.set(0.0, 0.018, nockZ + wob);
    cylBetween(strUp, tipUpPos, new V3(nockPos.x, nockPos.y + 0.012, nockPos.z), 0.003);
    cylBetween(strDn, tipDnPos, new V3(nockPos.x, nockPos.y - 0.012, nockPos.z), 0.003);
    cylBetween(serving, new V3(nockPos.x, nockPos.y - 0.045, nockPos.z), new V3(nockPos.x, nockPos.y + 0.045, nockPos.z), 0.0036);
    knotA.position.set(nockPos.x, nockPos.y + 0.014, nockPos.z);
    knotB.position.set(nockPos.x, nockPos.y - 0.014, nockPos.z);
    // 화살: 노크는 시위에, 촉은 레스트 위를 지나 앞으로
    arrow.visible = state.hasArrow;
    arrow.position.set(nockPos.x, nockPos.y, nockPos.z - 0.0);
    // 화살이 레스트(0,0.018)를 지나도록 아주 살짝 기울임(노크가 낮고 레스트가 높음 정도는 무시)
    // 당기는 손
    const hx = nockPos.x;
    const hy = nockPos.y;
    const away = clamp((draw - 0.55) / 0.4, 0, 1);
    const hz = nockPos.z + 0.3 * away * away; // 만궁에서는 손이 눈 뒤로 빠짐
    const curl = lerp(0.2, 1, clamp(draw * 1.6, 0, 1));
    fingers.forEach(([f1, f2], k) => {
      const dy = k === 0 ? 0.018 : -0.003 - (k - 1) * 0.017;
      f1.position.set(hx + 0.004, hy + dy, hz + 0.015);
      f1.rotation.set(Math.PI / 2 - 0.2, 0, Math.PI / 2 + 0.05);
      f2.position.set(hx + 0.012, hy + dy, hz + 0.043);
      f2.rotation.set(Math.PI / 2 + 0.9 * curl, 0, Math.PI / 2);
    });
    tab.position.set(hx + 0.002, hy - 0.006, hz + 0.01);
    dpalm.position.set(hx + 0.028, hy - 0.015, hz + 0.085);
    dpalm.visible = false; darm.visible = false;
    darm.position.set(hx + 0.18, hy - 0.11, hz + 0.31);
    darm.rotation.set(Math.PI / 2 - 0.1, 0, Math.PI / 2 - 1.05);
    darm.rotation.order = 'YXZ';
    darm.quaternion.setFromUnitVectors(new V3(0, 1, 0), new V3(0.34, -0.22, 0.9).normalize());
    dhand.visible = opts.showHand !== false;
  }
  layout(0);
  return {
    root,
    layout,
    state,
    sightPoint: new V3(0.088, 0.088, -0.17), // 시선이 지나는 활 좌표(링 중앙)
    sightMats,
    ringHolder,
    nockPos,
    arrow,
    dhand,
    setArrowColor(c) {
      arrow.traverse((o) => {
        if (o.material && o.material.color && o.material !== mats.shaft && o.material !== mats.steel) {
          const hex = o.material.color.getHex();
          if (hex !== 0xf4f4f0) o.material.color.set(c);
        }
      });
    },
    setArrowVisible(v) { state.hasArrow = v; arrow.visible = v; }
  };
}

// ---------- 과녁 면 텍스처 ----------
export function makeFaceTexture(size = 2048) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const R = size / 2;
  g.fillStyle = '#efefe8';
  g.fillRect(0, 0, size, size);
  const per = R / 10; // 링 폭(px) = 반지름 / 10
  for (let s = 1; s <= 10; s++) {
    g.beginPath();
    g.arc(R, R, per * (11 - s), 0, Math.PI * 2);
    g.fillStyle = RING_COLORS[s];
    g.fill();
    g.lineWidth = Math.max(2, size / 700);
    g.strokeStyle = s <= 2 || s === 5 || s === 6 ? '#1a1a1a' : s === 3 || s === 4 ? '#e8e8e8' : '#222';
    g.stroke();
  }
  // X 링
  g.beginPath();
  g.arc(R, R, per * 0.5, 0, Math.PI * 2);
  g.lineWidth = Math.max(2, size / 900);
  g.strokeStyle = '#3a3000';
  g.stroke();
  // 십자 중심
  g.strokeStyle = '#2a2300';
  g.lineWidth = Math.max(2, size / 1100);
  g.beginPath();
  g.moveTo(R - per * 0.18, R); g.lineTo(R + per * 0.18, R);
  g.moveTo(R, R - per * 0.18); g.lineTo(R, R + per * 0.18);
  g.stroke();
  // 점수 숫자(가로축 위): 읽기 쉬운 링 번호
  g.font = `700 ${Math.round(per * 0.34)}px "Pretendard Variable", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let s = 1; s <= 9; s++) {
    g.fillStyle = s >= 5 && s <= 6 ? '#fff' : s >= 3 && s <= 4 ? '#ddd' : '#333';
    g.fillStyle = s === 3 || s === 4 ? '#f2f2f2' : s === 7 || s === 8 ? '#ffe3dd' : s === 5 || s === 6 ? '#e8f3ff' : '#2a2a2a';
    const rr = per * (10.5 - s);
    g.fillText(String(s), R + rr, R - per * 0.001);
    g.fillText(String(s), R - rr, R);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

// 과녁(받침대 + 짚 + 면). 면 앞쪽 평면 z=0, 중심 (0,0) 이 면 중심. 반환 { group, face(꽂힌 화살 그룹의 부모) }
export function makeTarget(mats, faceTex, label) {
  const g = new THREE.Group();
  const cy = 1.3;
  // 짚 과녁 본체(두껍게) + 면
  const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.67, 0.67, 0.14, 48), mats.straw);
  butt.rotation.x = Math.PI / 2;
  butt.position.set(0, cy, -0.07);
  butt.castShadow = true; butt.receiveShadow = true;
  g.add(butt);
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.9, metalness: 0 });
  const face = new THREE.Mesh(new THREE.CircleGeometry(FACE_R, 96), faceMat);
  face.position.set(0, cy, 0.002);
  face.receiveShadow = true;
  g.add(face);
  // 테두리 천(가장자리를 감싼 띠)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.665, 0.012, 8, 64), new THREE.MeshStandardMaterial({ color: '#8a6a3a', roughness: 0.9 }));
  rim.position.set(0, cy, 0.004);
  g.add(rim);
  // 나무 받침대: 다리 두 개 + 가로대 + 뒤 버팀대
  const legM = mats.wood;
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.65, 0.06), legM);
    leg.position.set(sx * 0.46, 0.8, -0.18);
    leg.rotation.z = -sx * 0.08;
    leg.castShadow = true;
    g.add(leg);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.07, 0.07), legM);
  bar.position.set(0, 0.55, -0.18);
  bar.castShadow = true;
  g.add(bar);
  const brace = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.7, 0.05), legM);
  brace.position.set(0, 0.8, -0.62);
  brace.rotation.x = 0.42;
  brace.castShadow = true;
  g.add(brace);
  // 거리 표지판
  if (label) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    const c = cv.getContext('2d');
    c.fillStyle = '#f4f1e6'; c.fillRect(0, 0, 256, 128);
    c.fillStyle = '#18202e'; c.font = '700 70px Anton, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(label, 128, 66);
    c.strokeStyle = '#d33'; c.lineWidth = 8; c.strokeRect(4, 4, 248, 120);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.35), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    sign.position.set(0, 0.26, 0.0);
    sign.castShadow = true;
    g.add(sign);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.04), legM);
    post.position.set(0, 0.2, -0.1);
    g.add(post);
  }
  // 꽂힌 화살: 면 좌표계(원점 = 면 중심, y 위)
  const stuck = new THREE.Group();
  stuck.position.set(0, cy, 0);
  g.add(stuck);
  return { group: g, stuck, cy };
}

// 꽂힌 화살 하나(촉이 면에 10cm 박힌 모양). dir = 날아온 방향(과녁 안쪽으로 향하는 단위 벡터)
export function makeStuckArrow(mats, color, x, y, dir) {
  const a = makeArrow(mats, color);
  a.position.set(x, y, 0.0);
  // 화살의 -Z 가 날아가는 방향(= dir). 촉 끝이 박힌 곳이므로 위치를 그만큼 뒤로(사수 쪽)
  const target = new V3().copy(dir).normalize();
  const m = new THREE.Matrix4().lookAt(new V3(0, 0, 0), target, new V3(0, 1, 0));
  // lookAt 은 -Z 가 바라보는 쪽(target)을 향하므로, 화살 -Z = 날아간 방향
  a.quaternion.setFromRotationMatrix(m);
  // 촉 위치 = 원점에서 -Z 로 ARROW_LEN → 박힌 깊이 0.08 만큼만 면 안쪽: 촉이 (x,y,-0.08) 에 오도록 노크 쪽을 뒤로
  const tipLocal = new V3(0, 0, -(ARROW_LEN - 0.015)).applyQuaternion(a.quaternion);
  a.position.set(x - tipLocal.x, y - tipLocal.y, -0.08 - tipLocal.z);
  a.traverse((o) => { o.castShadow = true; });
  return a;
}

// ---------- 풍향계(윈드삭) ----------
export function makeWindsock(mats) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 6.2, 12), mats.alu);
  pole.position.y = 3.1;
  pole.castShadow = true;
  g.add(pole);
  const ringTop = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.025, 8, 24), mats.steel);
  ringTop.position.y = 6.2;
  g.add(ringTop);
  const swivel = new THREE.Group(); // 바람 방향으로 돌아가는 부분
  swivel.position.y = 6.2;
  g.add(swivel);
  const segs = [];
  const cols = ['#ff6a2a', '#f6f3ea'];
  const N = 6;
  let parent = swivel;
  for (let i = 0; i < N; i++) {
    const r0 = 0.34 * (1 - i * 0.1);
    const r1 = 0.34 * (1 - (i + 1) * 0.1);
    const pivot = new THREE.Group();
    pivot.position.x = i ? 0.42 : 0.0;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 0.42, 16, 1, true),
      new THREE.MeshStandardMaterial({ color: cols[i % 2], roughness: 0.8, side: THREE.DoubleSide }));
    m.rotation.z = Math.PI / 2;
    m.position.x = 0.21;
    m.castShadow = true;
    pivot.add(m);
    parent.add(pivot);
    parent = pivot;
    segs.push(pivot);
  }
  // wind: 월드 방향 벡터(바람이 불어가는 쪽), speed m/s
  function update(wind, t) {
    const sp = wind ? wind.speed : 0;
    const dirx = wind ? Math.cos(wind.dir) : 1;
    const dirz = wind ? -Math.sin(wind.dir) : 0;
    // 삭은 바람이 불어 가는 방향(+X 가 열린 입구→꼬리)으로 향함
    swivel.rotation.y = Math.atan2(-dirz, dirx);
    const lift = clamp(sp / 6.5, 0, 1); // 1 이면 수평
    segs.forEach((s, i) => {
      const droop = (1 - lift) * 1.0;
      s.rotation.z = -droop * (i === 0 ? 0.5 : 0.3) * (1 - lift * 0.0);
      s.rotation.y = Math.sin(t * (3 + sp * 0.5) + i * 0.9) * 0.06 * (0.3 + lift);
      s.rotation.x = Math.cos(t * (2.2 + sp * 0.4) + i) * 0.05 * (0.3 + lift);
    });
  }
  return { group: g, update };
}

// ---------- 깃발(바람에 펄럭) ----------
export function makeFlag(color = '#d33', color2 = '#f5f5f5', height = 5) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, height, 10), new THREE.MeshStandardMaterial({ color: '#d7dbe2', metalness: 0.8, roughness: 0.3 }));
  pole.position.y = height / 2;
  pole.castShadow = true;
  g.add(pole);
  const W = 1.5, H = 0.95, SX = 14, SY = 6;
  const geo = new THREE.PlaneGeometry(W, H, SX, SY);
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 80;
  const c = cv.getContext('2d');
  c.fillStyle = color; c.fillRect(0, 0, 128, 80);
  c.fillStyle = color2; c.fillRect(0, 26, 128, 28);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide });
  const cloth = new THREE.Mesh(geo, mat);
  cloth.castShadow = true;
  const holder = new THREE.Group();
  holder.position.y = height - H / 2 - 0.05;
  holder.add(cloth);
  g.add(holder);
  const base = geo.attributes.position.array.slice();
  const phase = Math.random() * 6;
  function update(wind, t) {
    const sp = wind ? wind.speed : 0;
    const dirx = wind ? Math.cos(wind.dir) : 1;
    const dirz = wind ? -Math.sin(wind.dir) : 0;
    holder.rotation.y = Math.atan2(-dirz, dirx);
    const amp = 0.05 + sp * 0.03;
    const droop = clamp(1 - sp / 6, 0, 1) * 0.7;
    const p = geo.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      const u = (base[i] + W / 2) / W; // 0 = 기둥 쪽, 1 = 끝
      const x = base[i] + W / 2;
      p[i] = x * (1 - droop * u * 0.4) + 0;
      p[i + 1] = base[i + 1] - droop * u * u * 0.6;
      p[i + 2] = Math.sin(u * 7 - t * (4 + sp * 0.9) + phase + base[i + 1] * 2) * amp * u;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return { group: g, update };
}

// ---------- 관중석 ----------
export function makeStands(rows = 6, len = 18, seed = 3) {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: '#8d96a4', metalness: 0.6, roughness: 0.5 });
  const seatCols = ['#2c6fb7', '#e0a526', '#d24a3b', '#3a9d63'];
  let r = seed;
  const rnd = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
  for (let i = 0; i < rows; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(len, 0.35, 0.9), steel);
    step.position.set(0, 0.2 + i * 0.5, -i * 0.8);
    step.castShadow = true; step.receiveShadow = true;
    g.add(step);
  }
  // 관중: 색 덩어리(몸 + 머리) 인스턴스
  const N = rows * 16;
  const bodyG = new THREE.CapsuleGeometry(0.2, 0.35, 4, 8);
  const headG = new THREE.SphereGeometry(0.13, 10, 8);
  const bodies = new THREE.InstancedMesh(bodyG, new THREE.MeshStandardMaterial({ roughness: 0.85 }), N);
  const heads = new THREE.InstancedMesh(headG, new THREE.MeshStandardMaterial({ color: '#d9a584', roughness: 0.7 }), N);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  let n = 0;
  for (let i = 0; i < rows; i++) {
    for (let k = 0; k < 16; k++) {
      if (rnd() < 0.32) continue;
      const x = (k / 15 - 0.5) * (len - 1) + (rnd() - 0.5) * 0.3;
      const y = 0.38 + i * 0.5;
      const z = -i * 0.8 + (rnd() - 0.5) * 0.1;
      m.makeTranslation(x, y + 0.42, z);
      bodies.setMatrixAt(n, m);
      col.set(seatCols[Math.floor(rnd() * seatCols.length)]).offsetHSL(0, 0, (rnd() - 0.5) * 0.1);
      bodies.setColorAt(n, col);
      m.makeTranslation(x, y + 0.9, z);
      heads.setMatrixAt(n, m);
      n++;
    }
  }
  bodies.count = n; heads.count = n;
  bodies.castShadow = true; heads.castShadow = true;
  g.add(bodies, heads);
  // 지붕
  const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 1, 0.12, rows * 0.8 + 1.8), new THREE.MeshStandardMaterial({ color: '#e8ebf0', roughness: 0.6 }));
  roof.position.set(0, rows * 0.5 + 2.4, -rows * 0.4 + 0.2);
  roof.castShadow = true;
  g.add(roof);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, rows * 0.5 + 2.3, 8), steel);
    post.position.set(sx * (len / 2), (rows * 0.5 + 2.3) / 2, 0.3);
    post.castShadow = true;
    g.add(post);
  }
  return g;
}

// ---------- 나무 ----------
export function makeTrees(count, rangeFn, seed = 7) {
  const g = new THREE.Group();
  let r = seed;
  const rnd = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
  const trunkG = new THREE.CylinderGeometry(0.25, 0.4, 4, 7);
  trunkG.translate(0, 2, 0);
  const crownG = new THREE.IcosahedronGeometry(1, 1);
  const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: '#4a3524', roughness: 1 }), count);
  const crowns = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), count * 3);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  let ci = 0;
  for (let i = 0; i < count; i++) {
    const [x, z] = rangeFn(rnd);
    const s = 0.8 + rnd() * 1.6;
    m.compose(new V3(x, 0, z), q, new V3(s, s, s));
    trunks.setMatrixAt(i, m);
    for (let k = 0; k < 3; k++) {
      const cs = (2.1 + rnd() * 1.2) * s;
      m.compose(new V3(x + (rnd() - 0.5) * 1.6 * s, (3.8 + k * 1.1 + rnd()) * s, z + (rnd() - 0.5) * 1.6 * s), q, new V3(cs, cs * 0.85, cs));
      crowns.setMatrixAt(ci, m);
      col.setHSL(0.27 + rnd() * 0.06, 0.45 + rnd() * 0.2, 0.2 + rnd() * 0.1);
      crowns.setColorAt(ci, col);
      ci++;
    }
  }
  trunks.castShadow = true; crowns.castShadow = true;
  g.add(trunks, crowns);
  return g;
}

// ---------- 잔디 텍스처(깎은 줄무늬) ----------
export function makeGrassTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 512;
  const g = cv.getContext('2d');
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#4f8a3a' : '#5a9843';
    g.fillRect(0, (i * 512) / 8, 512, 512 / 8);
  }
  // 잔디 결 잡음
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(${20 + Math.random() * 60},${70 + Math.random() * 90},${20 + Math.random() * 40},${0.05 + Math.random() * 0.08})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 2, 3 + Math.random() * 6);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// ---------- 하늘 돔(그라데이션 + 해) ----------
export function makeSky(sunDir) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uSun: { value: sunDir.clone().normalize() } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      varying vec3 vP; uniform vec3 uSun;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      void main(){
        vec3 d = normalize(vP);
        float h = clamp(d.y, -0.2, 1.0);
        vec3 horizon = vec3(0.80, 0.88, 0.96);
        vec3 zenith = vec3(0.16, 0.42, 0.82);
        vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.55));
        float s = max(dot(d, normalize(uSun)), 0.0);
        col += vec3(1.0, 0.92, 0.75) * (pow(s, 600.0) * 3.0 + pow(s, 28.0) * 0.38 + pow(s, 6.0) * 0.12);
        // 구름: 위쪽 평면에 투영한 잡음
        if (d.y > 0.02) {
          vec2 uv = d.xz / (d.y + 0.25) * 1.5;
          float n = noise(uv * 1.6) * 0.55 + noise(uv * 3.4) * 0.3 + noise(uv * 7.0) * 0.15;
          float c = smoothstep(0.52, 0.78, n);
          col = mix(col, vec3(1.0), c * 0.82 * smoothstep(0.02, 0.2, d.y));
        }
        col = mix(col, vec3(0.7, 0.8, 0.7), smoothstep(0.0, -0.2, d.y));
        gl_FragColor = vec4(col, 1.0);
      }`
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
  mesh.renderOrder = -10;
  return mesh;
}

export { RING_W, X_R };
