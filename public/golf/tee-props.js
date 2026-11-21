// 티잉 구역 소품: 스탠드 골프백(클럽·헤드커버·수건), 골프 카트, 홀 안내판, 티 꽂이.
// 경기 화면(scene-round.js)이 티 옆에 놓아 스윙 화면 배경이 비어 보이지 않게 합니다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const S = THREE.MeshStandardMaterial, P = THREE.MeshPhysicalMaterial;

// 재질별로 지오메트리를 모아 메시 하나로 합칩니다
class Kit {
  constructor() { this.bins = new Map(); }
  add(mat, geo, p, r, s) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (p || r || s) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0));
      const sc = s == null ? V3(1, 1, 1) : typeof s === 'number' ? V3(s, s, s) : V3(s[0], s[1], s[2]);
      g.applyMatrix4(new THREE.Matrix4().compose(p ? V3(p[0], p[1], p[2]) : V3(), q, sc));
    }
    if (!this.bins.has(mat)) this.bins.set(mat, []);
    this.bins.get(mat).push(g);
    return this;
  }
  build(shadow = true) {
    const grp = new THREE.Group();
    for (const [mat, list] of this.bins) { const m = new THREE.Mesh(mergeGeometries(list, false), mat); m.castShadow = shadow; m.receiveShadow = true; grp.add(m); }
    return grp;
  }
}
const cyl = (r1, r2, h, n = 14, open = false) => new THREE.CylinderGeometry(r1, r2, h, n, 1, open);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const sph = (r, a = 14, b = 10) => new THREE.SphereGeometry(r, a, b);
function rod(a, b, r1, r2 = r1, n = 8) {
  const A = V3(...a), B = V3(...b), d = B.clone().sub(A);
  const g = cyl(r2, r1, d.length(), n);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone().normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
// 모서리가 둥근 상자(가방 주머니·카트 몸체)
function rbox(x, y, z, r = 0.03) {
  const sh = new THREE.Shape();
  const w = x / 2 - r, h = y / 2 - r;
  sh.absarc(w, h, r, 0, Math.PI / 2); sh.absarc(-w, h, r, Math.PI / 2, Math.PI); sh.absarc(-w, -h, r, Math.PI, Math.PI * 1.5); sh.absarc(w, -h, r, Math.PI * 1.5, Math.PI * 2);
  const g = new THREE.ExtrudeGeometry(sh, { depth: z - r * 2, bevelEnabled: true, bevelThickness: r, bevelSize: r * 0.9, bevelSegments: 3, curveSegments: 6 });
  g.translate(0, 0, -(z - r * 2) / 2);
  return g;
}

// ───────── 스탠드 골프백 ─────────
export function makeGolfBag(color = '#ff5a5f') {
  const M = {
    body: new S({ color: 0x1b2433, roughness: 0.8 }),
    accent: new S({ color, roughness: 0.6 }),
    trim: new S({ color: 0x0c0e12, roughness: 0.55 }),
    white: new S({ color: 0xf3f1ea, roughness: 0.85 }),
    steel: new S({ color: 0xcfd3d9, metalness: 1, roughness: 0.25 }),
    shaft: new S({ color: 0x9aa0a8, metalness: 1, roughness: 0.3 }),
    grip: new S({ color: 0x141414, roughness: 0.9 }),
    wood: new P({ color: 0x15171c, roughness: 0.2, clearcoat: 1 }),
    rubber: new S({ color: 0x101012, roughness: 0.9 }),
  };
  const K = new Kit();
  const H = 0.88;
  // 몸통: 위가 살짝 넓은 원통, 위 테(구획 칸막이), 아래 받침
  K.add(M.body, cyl(0.125, 0.108, H, 22), [0, H / 2 + 0.03, 0]);
  K.add(M.accent, cyl(0.127, 0.123, 0.22, 22, true), [0, H * 0.55, 0]);
  K.add(M.trim, new THREE.TorusGeometry(0.125, 0.018, 8, 26), [0, H + 0.03, 0], [Math.PI / 2, 0, 0]);
  K.add(M.trim, box(0.24, 0.02, 0.012), [0, H + 0.03, 0]);
  K.add(M.trim, box(0.012, 0.02, 0.24), [0, H + 0.03, 0]);
  K.add(M.rubber, cyl(0.112, 0.118, 0.04, 22), [0, 0.02, 0]);
  // 주머니: 앞 큰 주머니(색 포인트), 옆 공 주머니, 위 작은 주머니와 지퍼 줄
  K.add(M.accent, rbox(0.19, 0.4, 0.09, 0.03), [0, 0.3, 0.115]);
  K.add(M.trim, box(0.15, 0.008, 0.004), [0, 0.44, 0.165]);
  K.add(M.body, rbox(0.13, 0.2, 0.07, 0.025), [0, 0.68, 0.118]);
  K.add(M.white, box(0.1, 0.03, 0.004), [0, 0.7, 0.158]);
  K.add(M.body, rbox(0.07, 0.3, 0.14, 0.025), [0.12, 0.34, 0], [0, 0, 0]);
  K.add(M.body, rbox(0.07, 0.24, 0.13, 0.025), [-0.12, 0.3, 0]);
  // 멜빵과 손잡이
  {
    const c = new THREE.CatmullRomCurve3([V3(0.03, H - 0.02, -0.12), V3(0.06, H - 0.12, -0.22), V3(0.05, 0.5, -0.24), V3(0.03, 0.3, -0.13)]);
    K.add(M.trim, new THREE.TubeGeometry(c, 16, 0.017, 6), null, null, [1.6, 1, 0.6]);
    const h = new THREE.CatmullRomCurve3([V3(-0.04, H - 0.06, 0.12), V3(0, H + 0.0, 0.17), V3(0.04, H - 0.06, 0.12)]);
    K.add(M.trim, new THREE.TubeGeometry(h, 10, 0.011, 6));
  }
  // 수건(옆에 걸림)
  K.add(M.white, box(0.13, 0.32, 0.012), [-0.13, 0.62, 0.07], [0, 0.5, 0.06]);
  K.add(M.accent, box(0.13, 0.03, 0.013), [-0.13, 0.5, 0.07], [0, 0.5, 0.06]);
  // 클럽: 드라이버·우드(헤드커버), 아이언 여섯 자루, 퍼터
  const clubs = [
    { x: -0.06, z: -0.06, len: 0.34, kind: 'cover', tilt: [-0.1, 0, 0.12] },
    { x: 0.05, z: -0.07, len: 0.28, kind: 'cover', tilt: [-0.14, 0, -0.1] },
    { x: -0.07, z: 0.03, len: 0.2, kind: 'iron', tilt: [0.04, 0, 0.1] },
    { x: -0.02, z: 0.06, len: 0.18, kind: 'iron', tilt: [0.1, 0, 0.03] },
    { x: 0.04, z: 0.05, len: 0.17, kind: 'iron', tilt: [0.09, 0, -0.06] },
    { x: 0.08, z: 0.0, len: 0.15, kind: 'iron', tilt: [0.02, 0, -0.12] },
    { x: 0.0, z: -0.01, len: 0.14, kind: 'iron', tilt: [0, 0, 0] },
    { x: 0.02, z: 0.09, len: 0.1, kind: 'putter', tilt: [0.14, 0, -0.02] },
  ];
  for (const c of clubs) {
    const sub = new Kit(), top = c.len;
    sub.add(M.shaft, cyl(0.0045, 0.005, top + 0.25, 8), [0, (top - 0.25) / 2, 0]);
    if (c.kind === 'cover') {
      sub.add(M.accent, sph(1, 14, 10), [0, top + 0.02, 0.012], null, [0.05, 0.06, 0.062]);
      sub.add(M.white, cyl(0.03, 0.022, 0.09, 12), [0, top - 0.06, 0]);
      sub.add(M.white, sph(0.02, 8, 6), [0, top + 0.085, 0.012]);
    } else if (c.kind === 'putter') {
      sub.add(M.steel, box(0.1, 0.024, 0.03), [0.02, top + 0.012, 0]);
    } else {
      // 아이언 헤드: 호젤과 납작한 날
      sub.add(M.steel, cyl(0.007, 0.006, 0.04, 8), [0, top + 0.01, 0]);
      sub.add(M.steel, box(0.075, 0.042, 0.012), [0.03, top + 0.04, 0.004], [0.25, 0, -0.35]);
    }
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(c.tilt[0], c.tilt[1], c.tilt[2]));
    const m4 = new THREE.Matrix4().compose(V3(c.x, H + 0.03, c.z), q, V3(1, 1, 1));
    for (const [mat, list] of sub.bins) for (const g of list) { g.applyMatrix4(m4); if (!K.bins.has(mat)) K.bins.set(mat, []); K.bins.get(mat).push(g); }
  }
  const body = K.build();
  // 뒤로 기대어 두 다리로 섭니다(가방 좌표의 −z 가 다리 쪽)
  const tilt = 0.36;
  const pivot = new THREE.Group();
  body.rotation.x = -tilt;
  pivot.add(body);
  const L = new Kit();
  const topP = V3(0, (H - 0.08) * Math.cos(tilt), -(H - 0.08) * Math.sin(tilt) - 0.1);
  for (const sx of [-1, 1]) {
    L.add(M.steel, rod([sx * 0.06, topP.y, topP.z], [sx * 0.26, 0.01, topP.z - 0.42], 0.007));
    L.add(M.rubber, sph(0.014, 8, 6), [sx * 0.26, 0.012, topP.z - 0.42]);
  }
  pivot.add(L.build());
  pivot.userData.setColor = (c) => M.accent.color.set(c);
  pivot.userData.dispose = () => { pivot.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); Object.values(M).forEach((m) => m.dispose()); };
  return pivot;
}

// ───────── 골프 카트 ─────────
export function makeGolfCart() {
  const M = {
    paint: new P({ color: 0xf2efe6, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
    trim: new S({ color: 0x1d3b2a, roughness: 0.5 }),
    seat: new S({ color: 0xd9c9a8, roughness: 0.85 }),
    dark: new S({ color: 0x15171a, roughness: 0.7 }),
    tire: new S({ color: 0x0c0c0d, roughness: 0.95 }),
    hub: new S({ color: 0xd8dade, metalness: 1, roughness: 0.3 }),
    glass: new P({ color: 0xcfe6f0, roughness: 0.05, transmission: 0.85, transparent: true, opacity: 0.35, thickness: 0.01 }),
    light: new S({ color: 0xfff6d8, emissive: 0x554a2a, roughness: 0.3 }),
    bag: new S({ color: 0x26314a, roughness: 0.8 }),
    steel: new S({ color: 0xcfd3d9, metalness: 1, roughness: 0.25 }),
  };
  const K = new Kit();
  // 좌표: +z 가 앞. 바닥판, 앞 덮개(둥근 코), 뒤 짐칸, 범퍼
  K.add(M.dark, box(1.1, 0.1, 2.2), [0, 0.3, 0]);
  K.add(M.paint, rbox(1.16, 0.42, 0.7, 0.12), [0, 0.6, 0.86]);
  K.add(M.paint, rbox(1.16, 0.34, 0.86, 0.1), [0, 0.52, -0.76]);
  K.add(M.trim, box(1.18, 0.05, 2.3), [0, 0.36, 0]);
  K.add(M.dark, rbox(1.2, 0.1, 0.08, 0.03), [0, 0.34, 1.2]);
  K.add(M.dark, rbox(1.2, 0.1, 0.08, 0.03), [0, 0.34, -1.2]);
  for (const sx of [-1, 1]) K.add(M.light, cyl(0.07, 0.07, 0.04, 14), [sx * 0.36, 0.66, 1.2], [Math.PI / 2, 0, 0]);
  // 좌석과 등받이
  K.add(M.seat, rbox(1.02, 0.14, 0.5, 0.05), [0, 0.76, -0.2]);
  K.add(M.seat, rbox(1.02, 0.42, 0.12, 0.05), [0, 1.04, -0.46], [-0.14, 0, 0]);
  K.add(M.dark, box(1.04, 0.3, 0.44), [0, 0.54, -0.2]);
  // 계기판·운전대
  K.add(M.dark, rbox(1.0, 0.16, 0.1, 0.04), [0, 0.86, 0.52]);
  K.add(M.dark, rod([-0.26, 0.86, 0.5], [-0.26, 1.06, 0.3], 0.016));
  K.add(M.dark, new THREE.TorusGeometry(0.15, 0.016, 8, 22), [-0.26, 1.08, 0.28], [0.9, 0, 0]);
  // 지붕과 기둥 넷, 앞 유리
  K.add(M.paint, rbox(1.24, 0.07, 1.7, 0.03), [0, 1.86, -0.05]);
  K.add(M.trim, box(1.26, 0.02, 1.72), [0, 1.82, -0.05]);
  for (const sx of [-1, 1]) {
    K.add(M.dark, rod([sx * 0.54, 0.8, 0.56], [sx * 0.56, 1.84, 0.66], 0.02));
    K.add(M.dark, rod([sx * 0.54, 0.7, -0.62], [sx * 0.56, 1.84, -0.82], 0.02));
  }
  K.add(M.glass, box(1.06, 0.92, 0.012), [0, 1.34, 0.62], [-0.1, 0, 0]);
  // 뒤 가방 걸이: 가방 두 개와 걸쇠
  K.add(M.steel, rod([-0.5, 1.02, -1.02], [0.5, 1.02, -1.02], 0.014));
  for (const sx of [-1, 1]) {
    K.add(M.bag, cyl(0.13, 0.115, 0.9, 16), [sx * 0.27, 0.98, -0.98], [-0.2, 0, 0]);
    K.add(M.dark, new THREE.TorusGeometry(0.13, 0.016, 6, 18), [sx * 0.27, 1.42, -1.07], [Math.PI / 2 - 0.2, 0, 0]);
    for (let i = 0; i < 4; i++) K.add(M.steel, cyl(0.005, 0.005, 0.3, 6), [sx * 0.27 + (i - 1.5) * 0.045, 1.55, -1.1 + (i % 2) * 0.04], [-0.2, 0, (i - 1.5) * 0.05]);
    K.add(M.steel, box(0.07, 0.04, 0.012), [sx * 0.27 + 0.02, 1.72, -1.13], [-0.2, 0, -0.3]);
  }
  // 바퀴 넷(타이어 + 휠)
  for (const sx of [-1, 1]) for (const z of [0.78, -0.78]) {
    K.add(M.tire, cyl(0.23, 0.23, 0.2, 22), [sx * 0.56, 0.23, z], [0, 0, Math.PI / 2]);
    K.add(M.hub, cyl(0.12, 0.12, 0.21, 14), [sx * 0.56, 0.23, z], [0, 0, Math.PI / 2]);
  }
  const g = K.build();
  g.userData.dispose = () => { g.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); Object.values(M).forEach((m) => m.dispose()); };
  return g;
}

// ───────── 홀 안내판 ─────────
export function makeHoleSign({ no = 1, par = 4, meters = 0, name = '' } = {}) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 384;
  const g = cv.getContext('2d');
  g.fillStyle = '#1f4a34'; g.fillRect(0, 0, 512, 384);
  g.strokeStyle = '#e9dfc0'; g.lineWidth = 8; g.strokeRect(14, 14, 484, 356);
  g.fillStyle = '#f3ecd2'; g.textAlign = 'center';
  g.font = '700 46px Pretendard, "Apple SD Gothic Neo", sans-serif';
  if (name) g.fillText(name, 256, 78);
  g.font = '400 200px Anton, Impact, sans-serif';
  g.fillText(String(no), 150, 300);
  g.font = '700 64px Pretendard, "Apple SD Gothic Neo", sans-serif';
  g.fillText(`PAR ${par}`, 366, 210);
  if (meters) { g.font = '700 54px Pretendard, "Apple SD Gothic Neo", sans-serif'; g.fillText(`${Math.round(meters)} m`, 366, 290); }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const wood = new S({ color: 0x6b4526, roughness: 0.8 });
  const K = new Kit();
  for (const sx of [-1, 1]) { K.add(wood, box(0.09, 1.5, 0.09), [sx * 0.52, 0.75, 0]); K.add(wood, cyl(0.07, 0.02, 0.1, 4), [sx * 0.52, 1.55, 0]); }
  K.add(wood, box(1.14, 0.84, 0.05), [0, 1.02, 0]);
  K.add(wood, box(1.3, 0.08, 0.16), [0, 1.48, 0], [0, 0, 0]);
  const grp = K.build();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 0.76), new S({ map: tex, roughness: 0.7 }));
  face.position.set(0, 1.02, 0.027);
  grp.add(face);
  grp.userData.dispose = () => { grp.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); tex.dispose(); wood.dispose(); face.material.dispose(); };
  return grp;
}

// ───────── 티 꽂이 ─────────
export function makeTeePeg() {
  const m = new THREE.Mesh(new THREE.LatheGeometry([[0.0001, 0], [0.002, 0.004], [0.0024, 0.03], [0.004, 0.04], [0.0085, 0.046], [0.0095, 0.05], [0.006, 0.0495]].map(([r, y]) => new THREE.Vector2(r, y)), 12),
    new S({ color: 0xf2e9d0, roughness: 0.6 }));
  m.castShadow = true;
  return m;
}
export const TEE_PEG_H = 0.05;
