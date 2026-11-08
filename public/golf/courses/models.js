// 코스 소품 모델(절차적으로 만듭니다, 바깥 파일 없음): 나무·선인장·덤불·풀·바위, 등대·정자·산장·다리 같은 장식.
// 나무는 크기 1 기준 치수가 core.js 의 KINDS 와 같습니다(물리 장애물과 그림이 맞도록).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// 씨앗 난수(모델 모양이 매번 같도록)
function srand(seed) {
  let a = seed | 0 || 7;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 합치기 전에 속성을 맞춥니다(색 있음, uv 없음, 인덱스 없음)
function prep(geo, color) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.color) {
    const c = new THREE.Color(color || '#ffffff');
    const arr = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] = c.r;
      arr[i + 1] = c.g;
      arr[i + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  return g;
}
const merge = (list) => mergeGeometries(list.map((g) => prep(g)), false);

// 정점마다 색 칠하기 fn(color, x, y, z, ny, i)
function paint(geo, fn) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position;
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.normal;
  const arr = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    fn(c, p.getX(i), p.getY(i), p.getZ(i), n.getY(i), i);
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// 울퉁불퉁한 덩어리(잎 뭉치·덤불). 법선은 덩어리 중심에서 바깥으로(둥글고 부드럽게 보이는 요령).
function lump(r, sx, sy, sz, seed, detail = 1, amp = 0.22) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  const nrm = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 1 + amp * Math.sin(x * 2.3 / r + seed) * Math.cos(y * 2.9 / r + seed * 1.3) * Math.sin(z * 2.1 / r + seed * 0.7) +
      amp * 0.4 * Math.sin(x * 5.1 / r + seed * 2.1);
    p.setXYZ(i, x * k * sx, y * k * sy, z * k * sz);
    const L = Math.hypot(x * sx, y * sy * 1.2, z * sz) || 1;
    nrm[i * 3] = (x * sx) / L;
    nrm[i * 3 + 1] = (y * sy * 1.2) / L;
    nrm[i * 3 + 2] = (z * sz) / L;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  // 면 법선을 30% 섞어 잎 결을 살립니다
  const face = g.clone();
  face.computeVertexNormals();
  const fn = face.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const a = V(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]).multiplyScalar(0.7).add(V(fn.getX(i), fn.getY(i), fn.getZ(i)).multiplyScalar(0.3)).normalize();
    g.attributes.normal.setXYZ(i, a.x, a.y, a.z);
  }
  face.dispose();
  return g;
}

// 잎 색: 아래는 어둡고(그늘) 위는 밝게, 면마다 살짝 다르게
function leafColor(geo, lo, hi, y0, y1, seed, speck) {
  const a = new THREE.Color(lo);
  const b = new THREE.Color(hi);
  const r = srand(seed);
  let faceJ = 0;
  let sp = false;
  return paint(geo, (c, x, y, z, ny, i) => {
    if (i % 3 === 0) {
      faceJ = (r() - 0.5) * 0.07;
      sp = Boolean(speck) && r() < speck.p;
    }
    const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0))) * 0.75 + Math.max(0, ny) * 0.25;
    c.copy(a).lerp(b, t);
    c.offsetHSL(0, 0, faceJ);
    if (sp) c.lerp(new THREE.Color(speck.c), 0.75);
  });
}
function barkColor(geo, lo, hi, y0, y1) {
  const a = new THREE.Color(lo);
  const b = new THREE.Color(hi);
  return paint(geo, (c, x, y) => c.copy(a).lerp(b, Math.min(1, Math.max(0, (y - y0) / (y1 - y0)))));
}
// 원기둥을 a→b 로 세웁니다
function limb(a, b, r0, r1, seg = 6) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r1, r0, d.length(), seg, 1, true);
  g.translate(0, d.length() / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

// ---------- 나무 ----------
// 돌려주는 값: [{ geo, shadow, tint }] (tint = 인스턴스 색을 받을 부분)
function tallpine() {
  const trunk = new THREE.CylinderGeometry(0.17, 0.32, 17, 7, 6);
  trunk.translate(0, 8.5, 0);
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + Math.sin(p.getY(i) * 0.16) * 0.28);
  trunk.computeVertexNormals();
  const parts = [barkColor(trunk, '#4f3d31', '#a5603a', 6, 14)];
  for (const [a, h, L] of [[0.4, 11.2, 2.6], [2.5, 12.6, 2.2], [4.3, 13.8, 2.0], [1.4, 9.9, 2.4]]) {
    parts.push(barkColor(limb(V(Math.sin(h * 0.16) * 0.28, h, 0), V(Math.cos(a) * L, h + 1.6, Math.sin(a) * L), 0.09, 0.05, 5), '#8a5233', '#8a5233', 0, 1));
  }
  const crowns = [];
  const spots = [[0, 17.4, 0, 2.5, 0.55], [1.7, 15.4, 0.6, 2.4, 0.6], [-1.5, 13.8, -0.8, 2.3, 0.6], [0.5, 12.2, 1.6, 2.0, 0.62], [-0.6, 18.6, -0.3, 1.5, 0.6], [-1.6, 16.2, 1.2, 1.9, 0.6]];
  spots.forEach(([x, y, z, r, sy], k) => crowns.push(lump(r, 1, sy, 1, k * 1.7 + 1).translate(x, y, z)));
  const crown = leafColor(merge(crowns), '#1f3a1c', '#4f7532', 11, 19, 3);
  return [{ geo: merge(parts), shadow: true }, { geo: crown, shadow: true, tint: true }];
}
function pine() {
  const trunk = barkColor(new THREE.CylinderGeometry(0.12, 0.26, 3.2, 6).translate(0, 1.6, 0), '#4a3a2c', '#5e4632', 0, 3);
  const cones = [];
  [[3.0, 4.2, 3.4], [2.4, 3.8, 5.6], [1.75, 3.2, 7.6], [1.05, 2.6, 9.4]].forEach(([r, h, y], k) => {
    const g = new THREE.ConeGeometry(r, h, 10, 2, true);
    const q = g.attributes.position;
    const rr = srand(k + 3);
    for (let i = 0; i < q.count; i++) {
      if (q.getY(i) < -h / 2 + 0.01) {
        const j = 0.85 + rr() * 0.3;
        q.setXYZ(i, q.getX(i) * j, q.getY(i) - 0.35 * rr(), q.getZ(i) * j);
      }
    }
    g.computeVertexNormals();
    cones.push(g.translate(0, y, 0));
  });
  const crown = leafColor(merge(cones), '#1d3820', '#3f6a36', 1.5, 11, 5);
  return [{ geo: trunk, shadow: true }, { geo: crown, shadow: true, tint: true }];
}
function fir() {
  const trunk = barkColor(new THREE.CylinderGeometry(0.1, 0.28, 3, 6).translate(0, 1.5, 0), '#3e3026', '#54402f', 0, 3);
  const cones = [];
  const layers = 7;
  for (let k = 0; k < layers; k++) {
    const t = k / (layers - 1);
    const r = 3.1 * (1 - t * 0.82);
    const h = 3.6 - t * 1.4;
    const y = 0.9 + t * 12.2 + h / 2;
    const g = new THREE.ConeGeometry(r, h, 11, 2, true);
    const q = g.attributes.position;
    const rr = srand(k * 7 + 11);
    for (let i = 0; i < q.count; i++) {
      if (q.getY(i) < -h / 2 + 0.01) {
        const j = 0.8 + rr() * 0.35;
        q.setXYZ(i, q.getX(i) * j, q.getY(i) - 0.5 * rr(), q.getZ(i) * j);
      }
    }
    g.computeVertexNormals();
    cones.push(g.translate(0, y, 0));
  }
  const crown = leafColor(merge(cones), '#15301f', '#33583a', 1, 15, 9);
  return [{ geo: trunk, shadow: true }, { geo: crown, shadow: true, tint: true }];
}
function oak() {
  const wood = [new THREE.CylinderGeometry(0.26, 0.42, 5.4, 7).translate(0, 2.7, 0)];
  for (const [a, L, h] of [[0.3, 3.0, 4.6], [2.4, 2.8, 4.9], [4.4, 2.6, 5.2]]) wood.push(limb(V(0, h, 0), V(Math.cos(a) * L, h + 2.4, Math.sin(a) * L), 0.2, 0.1, 6));
  const parts = [barkColor(merge(wood), '#4a3a2e', '#5b4636', 0, 8)];
  const crowns = [];
  const rr = srand(21);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * TAU + rr() * 0.5;
    const d = k === 0 ? 0 : 2.1 + rr() * 0.8;
    crowns.push(lump(2.5 + rr() * 0.8, 1, 0.78, 1, k * 2.3, 1).translate(Math.cos(a) * d, 7.4 + rr() * 1.6 + (k === 0 ? 1.4 : 0), Math.sin(a) * d));
  }
  parts.push(leafColor(merge(crowns), '#2c4d1f', '#6c9440', 4.5, 11, 7));
  return [{ geo: parts[0], shadow: true }, { geo: parts[1], shadow: true, tint: true }];
}
function cherry() {
  const wood = [new THREE.CylinderGeometry(0.2, 0.32, 2.4, 7).translate(0, 1.2, 0)];
  const ends = [];
  const rr = srand(41);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU + rr() * 0.6;
    const L = 2.2 + rr() * 1.2;
    const e = V(Math.cos(a) * L, 4.0 + rr() * 1.2, Math.sin(a) * L);
    wood.push(limb(V(0, 2.2, 0), e, 0.15, 0.07, 5));
    ends.push(e);
  }
  const parts = [barkColor(merge(wood), '#33241f', '#4a3530', 0, 5)];
  const crowns = [lump(2.2, 1.1, 0.62, 1.1, 3, 1).translate(0, 5.4, 0)];
  ends.forEach((e, k) => crowns.push(lump(1.6 + rr() * 0.6, 1, 0.7, 1, k * 1.9 + 4, 1).translate(e.x * 1.05, e.y + 0.5, e.z * 1.05)));
  for (let k = 0; k < 3; k++) {
    const a = rr() * TAU;
    crowns.push(lump(1.3, 1, 0.7, 1, k + 9, 1).translate(Math.cos(a) * 1.6, 6.4 + rr() * 0.6, Math.sin(a) * 1.6));
  }
  parts.push(leafColor(merge(crowns), '#e48aa6', '#fbe0e8', 3, 7.5, 13, { p: 0.12, c: '#ffffff' }));
  return [{ geo: parts[0], shadow: true }, { geo: parts[1], shadow: true, tint: true }];
}
function redpine() {
  const curve = new THREE.CatmullRomCurve3([V(0, 0, 0), V(0.5, 2.6, 0.3), V(0.1, 5.2, -0.3), V(0.9, 7.6, 0.2), V(1.3, 9.0, 0.1)]);
  const trunk = new THREE.TubeGeometry(curve, 18, 0.26, 7, false);
  const p = trunk.attributes.position;
  // 위로 갈수록 가늘게
  const pts = curve.getSpacedPoints(18);
  for (let i = 0; i < p.count; i++) {
    const ring = Math.floor(i / 8);
    const c = pts[Math.min(18, ring)];
    const t = ring / 18;
    const k = 1 - t * 0.55;
    p.setXYZ(i, c.x + (p.getX(i) - c.x) * k, p.getY(i), c.z + (p.getZ(i) - c.z) * k);
  }
  trunk.computeVertexNormals();
  const wood = [trunk];
  wood.push(limb(V(0.2, 5.6, -0.2), V(-1.4, 7.4, 0.9), 0.12, 0.06, 5), limb(V(0.7, 7.0, 0.1), V(2.5, 7.4, -1.0), 0.11, 0.05, 5));
  const parts = [barkColor(merge(wood), '#5a4436', '#b4583a', 2, 7)];
  const crowns = [];
  [[1.3, 9.4, 0.1, 2.6], [-1.3, 7.9, 0.9, 2.1], [2.5, 7.6, -1.1, 1.8], [0.2, 10.3, -0.7, 1.6], [-0.4, 8.8, -1.4, 1.5]].forEach(([x, y, z, r], k) => {
    crowns.push(lump(r, 1, 0.38, 1, k * 2.1 + 2, 1, 0.28).translate(x, y, z));
  });
  parts.push(leafColor(merge(crowns), '#223f22', '#4c6f3a', 7, 10.6, 17));
  return [{ geo: parts[0], shadow: true }, { geo: parts[1], shadow: true, tint: true }];
}
// 사와로 선인장(팔 개수 0~2 세 가지)
function saguaro(arms) {
  const ribbed = (r0, r1, h, seg = 24, rings = 6) => {
    const g = new THREE.CylinderGeometry(r1, r0, h, seg, rings, true);
    const q = g.attributes.position;
    for (let i = 0; i < q.count; i++) {
      const a = Math.atan2(q.getZ(i), q.getX(i));
      const k = 1 + 0.09 * Math.cos(a * 12);
      q.setX(i, q.getX(i) * k);
      q.setZ(i, q.getZ(i) * k);
    }
    g.computeVertexNormals();
    return g;
  };
  const cap = (r) => new THREE.SphereGeometry(r * 1.04, 24, 6, 0, TAU, 0, Math.PI / 2);
  const parts = [ribbed(0.34, 0.31, 6.4).translate(0, 3.2, 0), cap(0.31).translate(0, 6.4, 0)];
  const armAt = [[1, 2.6, 0.95, 4.9], [-1, 3.4, 0.8, 5.6]];
  for (let k = 0; k < arms; k++) {
    const [s, y0, L, y1] = armAt[k];
    const h = new THREE.CylinderGeometry(0.2, 0.22, L, 16, 1, true);
    h.rotateZ(Math.PI / 2);
    parts.push(h.translate((s * L) / 2, y0, 0));
    parts.push(new THREE.SphereGeometry(0.21, 16, 8).translate(s * L, y0, 0));
    parts.push(ribbed(0.21, 0.2, y1 - y0, 16, 3).translate(s * L, (y0 + y1) / 2, 0));
    parts.push(cap(0.2).translate(s * L, y1, 0));
  }
  const g = merge(parts);
  const a = new THREE.Color('#3f6a35');
  const b = new THREE.Color('#6f9450');
  return [{
    geo: paint(g, (c, x, y, z, ny) => {
      const ang = Math.atan2(z, x);
      c.copy(a).lerp(b, 0.5 + 0.5 * Math.cos(ang * 12));
      if (y > 6.3 || ny > 0.8) c.lerp(new THREE.Color('#a5a36a'), 0.3);
    }),
    shadow: true,
    tint: true
  }];
}
function barrel() {
  const g = new THREE.SphereGeometry(0.45, 20, 10);
  const q = g.attributes.position;
  for (let i = 0; i < q.count; i++) {
    const a = Math.atan2(q.getZ(i), q.getX(i));
    const k = 1 + 0.1 * Math.cos(a * 10);
    q.setXYZ(i, q.getX(i) * k, q.getY(i) * 0.85 + 0.36, q.getZ(i) * k);
  }
  g.computeVertexNormals();
  const flowers = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    flowers.push(new THREE.OctahedronGeometry(0.07, 0).translate(Math.cos(a) * 0.14, 0.76, Math.sin(a) * 0.14));
  }
  const body = paint(g, (c, x, y, z) => c.set('#557a3a').lerp(new THREE.Color('#7d9a55'), 0.5 + 0.5 * Math.cos(Math.atan2(z, x) * 10)));
  const fl = paint(merge(flowers), (c) => c.set('#ffb21f'));
  return [{ geo: merge([body, fl]), shadow: false, tint: false }];
}
function gorse() {
  const g = lump(1.5, 1, 0.68, 1, 3, 2, 0.2).translate(0, 0.7, 0);
  return [{ geo: leafColor(g, '#33492a', '#6a7c3c', 0, 1.6, 31), shadow: true, tint: true }];
}
function shrub() {
  const g = merge([lump(1.2, 1, 0.66, 1, 5, 1, 0.24).translate(0, 0.55, 0), lump(0.8, 1, 0.7, 1, 8, 1).translate(0.7, 0.45, 0.3)]);
  return [{ geo: leafColor(g, '#6e6e6e', '#ffffff', 0, 1.3, 37), shadow: false, tint: true }];
}
// 억센 풀 한 포기: 휘어진 잎 아홉 장
function tuft() {
  const blades = [];
  const rr = srand(51);
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * TAU + rr() * 0.5;
    const L = 0.55 + rr() * 0.45;
    const lean = 0.25 + rr() * 0.35;
    const w = 0.045;
    const pos = [];
    const seg = 3;
    for (let s = 0; s <= seg; s++) {
      const t = s / seg;
      const out = lean * t * t * L;
      const y = L * t * (1 - 0.15 * t);
      const ww = w * (1 - t * 0.9);
      const cx = Math.cos(a) * out;
      const cz = Math.sin(a) * out;
      const px = -Math.sin(a) * ww;
      const pz = Math.cos(a) * ww;
      pos.push([cx - px, y, cz - pz], [cx + px, y, cz + pz]);
    }
    const arr = [];
    for (let s = 0; s < seg; s++) {
      const [a0, a1, b0, b1] = [pos[s * 2], pos[s * 2 + 1], pos[s * 2 + 2], pos[s * 2 + 3]];
      arr.push(...a0, ...a1, ...b1, ...a0, ...b1, ...b0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    const n = g.attributes.normal;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.4, 0.9, n.getZ(i) * 0.4);
    blades.push(g);
  }
  const g = merge(blades);
  return [{ geo: paint(g, (c, x, y) => c.setScalar(0.45 + Math.min(1, y / 0.8) * 0.6)), shadow: false, tint: true, side: THREE.DoubleSide }];
}
function rock(seed = 3, detail = 1) {
  const g = new THREE.DodecahedronGeometry(1, detail);
  const q = g.attributes.position;
  const rr = srand(seed);
  const s = [1 + rr() * 0.4, 0.55 + rr() * 0.25, 0.8 + rr() * 0.4];
  for (let i = 0; i < q.count; i++) {
    const x = q.getX(i);
    const y = q.getY(i);
    const z = q.getZ(i);
    const k = 1 + 0.18 * Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7 + seed) + 0.1 * Math.sin(y * 4.2);
    q.setXYZ(i, x * k * s[0], (y * k + 0.35) * s[1], z * k * s[2]);
  }
  g.computeVertexNormals();
  const out = paint(g, (c, x, y, z, ny) => {
    c.setScalar(0.62 + 0.3 * Math.max(0, ny) + 0.06 * Math.sin(x * 7 + z * 5));
  });
  return [{ geo: out, shadow: true, tint: true, flat: true }];
}
function flower() {
  const stems = [];
  const heads = [];
  const rr = srand(61);
  for (let k = 0; k < 5; k++) {
    const a = rr() * TAU;
    const d = rr() * 0.22;
    const h = 0.22 + rr() * 0.18;
    stems.push(new THREE.BoxGeometry(0.012, h, 0.012).translate(Math.cos(a) * d, h / 2, Math.sin(a) * d));
    heads.push(new THREE.OctahedronGeometry(0.055, 0).scale(1, 0.6, 1).translate(Math.cos(a) * d, h, Math.sin(a) * d));
  }
  return [{ geo: paint(merge(stems), (c) => c.set('#4c7a34')), shadow: false }, { geo: paint(merge(heads), (c) => c.setScalar(1)), shadow: false, tint: true }];
}

const MAKERS = {
  tallpine, pine, fir, oak, cherry, redpine, gorse, shrub, barrel, tuft, flower,
  saguaro0: () => saguaro(0), saguaro1: () => saguaro(1), saguaro2: () => saguaro(2),
  rock: () => rock(3, 0), boulder: () => rock(9, 1)
};
const cache = new Map();
const cachedGeos = new WeakSet();
// 종류 이름으로 부분 모델 목록을 줍니다(같은 이름은 한 번만 만들고 홀을 바꿔도 다시 씁니다)
export function treeParts(kind) {
  if (!cache.has(kind)) {
    const parts = MAKERS[kind]();
    for (const p of parts) cachedGeos.add(p.geo);
    cache.set(kind, parts);
  }
  return cache.get(kind);
}
export const isCached = (geo) => cachedGeos.has(geo);
export function clearModelCache() {
  for (const parts of cache.values()) for (const p of parts) p.geo.dispose();
  cache.clear();
}

// ---------- 장식(한 번만 놓는 큰 물건) ----------
const std = (color, roughness = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
const vc = (roughness = 0.85, extra = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0, ...extra });
function shadowAll(g, cast = true) {
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = cast;
      o.receiveShadow = true;
    }
  });
  return g;
}

// 등대: 빨강·하양 띠, 난간, 유리 등실, 지붕. 옆에 관리인 집.
export function lighthouse() {
  const g = new THREE.Group();
  const prof = [[3.4, 0], [3.25, 1.2], [2.95, 8], [2.65, 16], [2.45, 21.6], [3.25, 21.8], [3.25, 22.5], [0.01, 22.5]].map(([r, y]) => new THREE.Vector2(r, y));
  const tower = paint(new THREE.LatheGeometry(prof, 28), (c, x, y) => {
    const band = (y > 5 && y < 9) || (y > 13 && y < 17);
    c.set(band ? '#c8322b' : y > 21.5 ? '#2a2d31' : '#f2efe8');
  });
  g.add(new THREE.Mesh(tower, vc(0.6)));
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 2.6, 16, 1, true), std('#fff4c4', 0.2, { emissive: '#ffe9a0', emissiveIntensity: 0.9, transparent: true, opacity: 0.85 }));
  glass.position.y = 23.8;
  g.add(glass);
  const frame = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 2.6, 8, 1, true), std('#24272b', 0.5, { wireframe: true }));
  frame.position.y = 23.8;
  g.add(frame);
  const dome = new THREE.Mesh(new THREE.ConeGeometry(2.1, 1.9, 16), std('#b62f2a', 0.5));
  dome.position.y = 26.05;
  g.add(dome);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), std('#2a2d31', 0.4));
  tip.position.y = 27.1;
  g.add(tip);
  const rail = new THREE.Mesh(new THREE.TorusGeometry(3.15, 0.05, 6, 32), std('#2a2d31', 0.5));
  rail.rotation.x = Math.PI / 2;
  rail.position.y = 23.4;
  g.add(rail);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.2, 1.2, 20), std('#8a857a', 0.95));
  base.position.y = 0.2;
  g.add(base);
  // 관리인 집
  const house = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(7, 3.4, 5), std('#efece4', 0.85));
  body.position.y = 1.7;
  house.add(body);
  const roofShape = new THREE.Shape([new THREE.Vector2(-3.9, 0), new THREE.Vector2(3.9, 0), new THREE.Vector2(0, 2.2)]);
  const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape, { depth: 5.6, bevelEnabled: false }), std('#9a3a2c', 0.75));
  roof.position.set(0, 3.4, -2.8);
  house.add(roof);
  for (const s of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.1), std('#2f4a5c', 0.3));
    win.position.set(s * 1.8, 1.9, 2.51);
    house.add(win);
  }
  house.position.set(7.5, 0, 1.5);
  house.rotation.y = -0.4;
  g.add(house);
  return shadowAll(g);
}

// 바다 위 바위섬
export function islet() {
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const q = geo.attributes.position;
  for (let i = 0; i < q.count; i++) {
    const x = q.getX(i);
    const y = q.getY(i);
    const z = q.getZ(i);
    const k = 1 + 0.16 * Math.sin(x * 4 + 1) * Math.cos(z * 3.6) + 0.08 * Math.sin(y * 9);
    q.setXYZ(i, x * k * 26, Math.max(-0.4, y * k) * 10, z * k * 20);
  }
  geo.computeVertexNormals();
  const g = paint(geo, (c, x, y, z, ny) => {
    if (y > 5.5 && ny > 0.55) c.set('#6f7d45');
    else c.set('#7d7a72').offsetHSL(0, 0, Math.sin(y * 2.2) * 0.04);
  });
  const m = new THREE.Mesh(g, vc(0.95, { flatShading: true }));
  m.position.y = -2;
  return shadowAll(new THREE.Group().add(m));
}

// 정자(한국 전통 정자): 돌 기단, 붉은 기둥, 단청 들보, 끝이 들린 기와지붕
export function pavilion() {
  const g = new THREE.Group();
  const stone = std('#a7a49c', 0.95);
  const base = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.7, 6.6), stone);
  base.position.y = 0.35;
  g.add(base);
  const step = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 0.9), stone);
  step.position.set(0, 0.18, 3.7);
  g.add(step);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.22, 5.6), std('#8a5a36', 0.7));
  floor.position.y = 1.15;
  g.add(floor);
  const wood = std('#9b3b2a', 0.6);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 2.8, 10), wood);
      col.position.set(sx * 2.45, 2.5, sz * 2.45);
      g.add(col);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.45, 8), stone);
      foot.position.set(sx * 2.45, 0.9, sz * 2.45);
      g.add(foot);
    }
  }
  // 난간(정자 마루 둘레, 앞은 비움)
  const railMat = std('#7a3324', 0.6);
  for (const [x, z, w, d] of [[0, -2.7, 5.2, 0.08], [-2.7, 0, 0.08, 5.2], [2.7, 0, 0.08, 5.2], [-1.75, 2.7, 1.7, 0.08], [1.75, 2.7, 1.7, 0.08]]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), railMat);
    r.position.set(x, 1.85, z);
    g.add(r);
  }
  // 단청 들보: 초록 바탕에 붉은 띠
  const beamGeo = paint(new THREE.BoxGeometry(5.6, 0.34, 0.3, 24, 1, 1), (c, x) => {
    const t = (x + 2.8) / 5.6;
    const band = Math.abs(((t * 6) % 1) - 0.5) < 0.12;
    c.set(band ? '#c8432f' : Math.abs(t - 0.5) < 0.08 ? '#e8c35a' : '#2f7b6b');
  });
  for (const r of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const b = new THREE.Mesh(beamGeo, vc(0.6));
    b.position.set(Math.sin(r) * 2.45, 3.85, Math.cos(r) * 2.45);
    b.rotation.y = r;
    g.add(b);
  }
  // 지붕: 가운데가 오목하게 내려오고 네 귀가 들린 면
  const N = 28;
  const half = 4.3;
  const roofGeo = new THREE.PlaneGeometry(2, 2, N, N);
  roofGeo.rotateX(-Math.PI / 2);
  const q = roofGeo.attributes.position;
  for (let i = 0; i < q.count; i++) {
    const u = q.getX(i);
    const v = q.getZ(i);
    const r = Math.max(Math.abs(u), Math.abs(v));
    const corner = Math.pow(Math.abs(u * v), 3);
    const y = 2.4 * Math.pow(1 - r, 1.7) + 0.55 * corner + (r > 0.92 ? -0.06 : 0);
    const k = half * (1 + 0.06 * corner);
    q.setXYZ(i, u * k, y, v * k);
  }
  roofGeo.computeVertexNormals();
  const tiles = paint(roofGeo, (c, x, y, z) => {
    const r = Math.max(Math.abs(x), Math.abs(z)) / half;
    const row = Math.abs(Math.sin(r * 40)) > 0.85;
    c.set(row ? '#3b3e44' : '#55595f');
    if (r > 0.95) c.set('#e8e2d2');
  });
  const roof = new THREE.Mesh(tiles, vc(0.7, { side: THREE.DoubleSide }));
  roof.position.y = 4.05;
  g.add(roof);
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.28, 0.32), std('#3b3e44', 0.6));
  ridge.position.y = 6.45;
  g.add(ridge);
  return shadowAll(g);
}

// 석등
export function lantern() {
  const g = new THREE.Group();
  const s = std('#9c988e', 0.95);
  const add = (geo, y) => {
    const m = new THREE.Mesh(geo, s);
    m.position.y = y;
    g.add(m);
    return m;
  };
  add(new THREE.CylinderGeometry(0.42, 0.48, 0.24, 8), 0.12);
  add(new THREE.CylinderGeometry(0.11, 0.13, 0.75, 8), 0.6);
  add(new THREE.CylinderGeometry(0.34, 0.3, 0.14, 8), 1.03);
  const box = add(new THREE.BoxGeometry(0.42, 0.42, 0.42), 1.31);
  box.material = std('#8f8b82', 0.95);
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.2, 0.2), std('#3a2f22', 0.9, { emissive: '#ffb860', emissiveIntensity: 0.6 }));
  glow.position.y = 1.31;
  g.add(glow);
  const glow2 = glow.clone();
  glow2.rotation.y = Math.PI / 2;
  g.add(glow2);
  add(new THREE.ConeGeometry(0.55, 0.36, 4), 1.7).rotation.y = Math.PI / 4;
  add(new THREE.SphereGeometry(0.1, 10, 8), 1.92);
  return shadowAll(g);
}

// 산장: 돌 아래층, 나무 위층, 가파른 박공지붕, 발코니
export function chalet() {
  const g = new THREE.Group();
  const low = new THREE.Mesh(new THREE.BoxGeometry(10, 3, 7.5), std('#8c8a84', 0.95));
  low.position.y = 1.5;
  g.add(low);
  const up = new THREE.Mesh(new THREE.BoxGeometry(10, 3, 7.5), std('#7a5032', 0.85));
  up.position.y = 4.5;
  g.add(up);
  const shape = new THREE.Shape([new THREE.Vector2(-6.2, 0), new THREE.Vector2(6.2, 0), new THREE.Vector2(0, 4.6)]);
  const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 8.8, bevelEnabled: false }), std('#3d3532', 0.8));
  roof.position.set(0, 6, -4.4);
  g.add(roof);
  const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-5, 0), new THREE.Vector2(5, 0), new THREE.Vector2(0, 3.7)]), { depth: 7.4, bevelEnabled: false }), std('#7a5032', 0.85));
  gable.position.set(0, 6, -3.7);
  g.add(gable);
  const win = std('#ffd890', 0.4, { emissive: '#ffb34a', emissiveIntensity: 0.35 });
  for (const x of [-3, 0, 3]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.3), win);
    w.position.set(x, 4.6, 3.76);
    g.add(w);
    const w2 = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.1), win);
    w2.position.set(x, 1.6, 3.76);
    g.add(w2);
  }
  const balc = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.2, 1.6), std('#6a4428', 0.8));
  balc.position.set(0, 3.1, 4.5);
  g.add(balc);
  const railG = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.9, 0.08), std('#6a4428', 0.8));
  railG.position.set(0, 3.6, 5.25);
  g.add(railG);
  const chim = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.4, 0.9), std('#8c8a84', 0.95));
  chim.position.set(2.6, 9.2, -1.5);
  g.add(chim);
  return shadowAll(g);
}

// 다리: span 길이만큼 살짝 둥글게 솟은 다리. stone 이면 돌다리.
export function bridge(span, stone = false) {
  const g = new THREE.Group();
  const deckMat = std(stone ? '#a19d94' : '#8a6440', 0.85);
  const railMat = std(stone ? '#8f8b82' : '#6f4e30', 0.8);
  const N = 12;
  const rise = Math.min(1.2, span * 0.08);
  const yAt = (t) => rise * Math.sin(Math.PI * t);
  for (let i = 0; i < N; i++) {
    const t0 = i / N;
    const t1 = (i + 1) / N;
    const z0 = (t0 - 0.5) * span;
    const z1 = (t1 - 0.5) * span;
    const y0 = yAt(t0);
    const y1 = yAt(t1);
    const L = Math.hypot(z1 - z0, y1 - y0);
    const plank = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, L + 0.02), deckMat);
    plank.position.set(0, (y0 + y1) / 2 + 0.25, (z0 + z1) / 2);
    plank.rotation.x = -Math.atan2(y1 - y0, z1 - z0);
    g.add(plank);
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, L + 0.02), railMat);
      rail.position.set(s * 1.25, (y0 + y1) / 2 + 1.15, (z0 + z1) / 2);
      rail.rotation.x = plank.rotation.x;
      g.add(rail);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.95, 0.12), railMat);
      post.position.set(s * 1.25, y0 + 0.75, z0);
      g.add(post);
    }
  }
  if (stone) {
    const arch = new THREE.Mesh(new THREE.TorusGeometry(span * 0.42, 0.35, 6, 18, Math.PI), deckMat);
    arch.rotation.y = Math.PI / 2;
    arch.position.y = -span * 0.3;
    arch.scale.set(1, 0.7, 1);
    g.add(arch);
  }
  return shadowAll(g);
}

export function bench() {
  const g = new THREE.Group();
  const wood = std('#8a6440', 0.8);
  const metal = std('#2b2e33', 0.5, { metalness: 0.6 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.07, 0.45), wood);
  seat.position.y = 0.45;
  g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.35, 0.05), wood);
  back.position.set(0, 0.75, -0.22);
  back.rotation.x = -0.15;
  g.add(back);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.45), metal);
    leg.position.set(s * 0.8, 0.22, 0);
    g.add(leg);
  }
  return shadowAll(g);
}

export function flowerbed() {
  const g = new THREE.Group();
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 0.3, 28), std('#4a3426', 1));
  soil.scale.set(1.4, 1, 0.8);
  soil.position.y = 0.1;
  g.add(soil);
  const heads = [];
  const rr = srand(71);
  const cols = ['#ff5a6e', '#ffd23f', '#ffffff', '#c86bff', '#ff8f3f'];
  for (let k = 0; k < 160; k++) {
    const a = rr() * TAU;
    const d = Math.sqrt(rr()) * 2.4;
    const geo = new THREE.IcosahedronGeometry(0.12 + rr() * 0.06, 0).translate(Math.cos(a) * d * 1.4, 0.32 + rr() * 0.12, Math.sin(a) * d * 0.8);
    const c = cols[Math.floor(rr() * cols.length)];
    heads.push(paint(geo, (cc) => cc.set(c)));
  }
  const leaves = lump(2.2, 1.4, 0.18, 0.8, 4, 2).translate(0, 0.3, 0);
  g.add(new THREE.Mesh(leafColor(leaves, '#2f5a26', '#4f8a3a', 0, 0.5, 5), vc(0.8)));
  g.add(new THREE.Mesh(merge(heads), vc(0.7)));
  return shadowAll(g, false);
}

// 이어 붙인 돌담 블록 하나(인스턴스로 길게 늘어놓습니다)
export function wallBlockGeo() {
  const g = new THREE.BoxGeometry(2.1, 1, 0.75, 6, 3, 2);
  const q = g.attributes.position;
  for (let i = 0; i < q.count; i++) {
    const x = q.getX(i);
    const y = q.getY(i);
    const z = q.getZ(i);
    q.setXYZ(i, x, y + 0.5 + Math.sin(x * 5.3) * 0.05 * (y > 0.4 ? 1 : 0), z * (1 - (y + 0.5) * 0.18) + Math.sin(x * 7 + y * 9) * 0.04);
  }
  g.computeVertexNormals();
  return paint(g, (c, x, y, z) => c.set('#8d8a82').offsetHSL(0, 0, Math.sin(x * 9.1 + y * 13.7 + z * 3) * 0.08));
}

// ---------- 먼 경치 ----------
// 탁자 모양 바위산(메사): 아래는 무너진 비탈, 위는 수직 벽, 꼭대기는 평평. 높이에 따라 붉은 지층 색.
export function mesaGeo(seed, radius, height) {
  const rr = srand(seed);
  const n = 40;
  const noise = [];
  for (let i = 0; i < n; i++) noise.push(0.78 + rr() * 0.36);
  // 부드럽게
  const rad = noise.map((v, i) => (noise[(i + n - 1) % n] + v * 2 + noise[(i + 1) % n]) / 4);
  const rings = [[1.55, 0], [1.22, 0.24], [1.06, 0.36], [1.0, 0.4], [0.985, 0.97], [0.95, 1.0]];
  const pos = [];
  const col = [];
  const cA = new THREE.Color('#b7653d');
  const cB = new THREE.Color('#d39463');
  const cC = new THREE.Color('#9c4c2e');
  const cT = new THREE.Color('#a98a5a');
  const colAt = (y, top) => {
    if (top) return cT;
    const band = Math.sin(y * 0.11 + seed) * 0.5 + 0.5;
    const c = cA.clone().lerp(cB, band);
    if (Math.sin(y * 0.37 + seed * 2) > 0.7) c.lerp(cC, 0.6);
    return c;
  };
  const P = (ri, i) => {
    const [s, t] = rings[ri];
    const a = (i / n) * TAU;
    const r = radius * rad[i % n] * s;
    return [Math.cos(a) * r, t * height, Math.sin(a) * r];
  };
  for (let ri = 0; ri < rings.length - 1; ri++) {
    for (let i = 0; i < n; i++) {
      const a0 = P(ri, i);
      const a1 = P(ri, i + 1);
      const b0 = P(ri + 1, i);
      const b1 = P(ri + 1, i + 1);
      pos.push(...a0, ...b1, ...a1, ...a0, ...b0, ...b1);
      for (const p of [a0, b1, a1, a0, b0, b1]) {
        const c = colAt(p[1], false);
        col.push(c.r, c.g, c.b);
      }
    }
  }
  const top = rings.length - 1;
  for (let i = 0; i < n; i++) {
    const a0 = P(top, i);
    const a1 = P(top, i + 1);
    pos.push(0, height, 0, ...a1, ...a0);
    for (let k = 0; k < 3; k++) col.push(cT.r, cT.g, cT.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// 눈 덮인 봉우리
export function mountainGeo(seed, radius, height) {
  const geo = new THREE.ConeGeometry(radius, height, 64, 18, true);
  const q = geo.attributes.position;
  const rr = srand(seed);
  const ph = [rr() * 6, rr() * 6, rr() * 6, rr() * 6];
  for (let i = 0; i < q.count; i++) {
    const x = q.getX(i);
    const y = q.getY(i) + height / 2;
    const z = q.getZ(i);
    const r0 = Math.hypot(x, z);
    const a0 = Math.atan2(z, x);
    const t = y / height;
    // 능선이 꼭대기까지 곧게 모이지 않도록 높이에 따라 살짝 비틀고 울퉁불퉁하게
    const a = a0 + 0.09 * Math.sin(t * 7 + ph[3]) * (1 - t) + 0.05 * Math.sin(a0 * 5 + t * 11 + ph[1]);
    const ridge = 1 + 0.22 * Math.sin(a * 3 + ph[0]) + 0.12 * Math.sin(a * 7 + ph[1]) + 0.07 * Math.sin(a * 13 + ph[2]);
    const crag = 1 + 0.08 * Math.sin(a0 * 17 + t * 23 + ph[0]) * Math.sin(a0 * 11 - t * 31 + ph[1]) * (1 - t * 0.6);
    const k = ridge * crag * (1 - 0.15 * Math.sin(t * 9 + a * 2 + ph[3]) * t);
    q.setXYZ(i, Math.cos(a) * r0 * k, y * (0.92 + 0.16 * Math.sin(a0 * 2 + ph[2])), Math.sin(a) * r0 * k);
  }
  geo.computeVertexNormals();
  const snow = new THREE.Color('#f4f7fb');
  const rock = new THREE.Color('#6d7680');
  const forest = new THREE.Color('#2f4a3a');
  return paint(geo, (c, x, y, z, ny) => {
    const t = y / height;
    const sl = 0.5 + 0.1 * Math.sin(Math.atan2(z, x) * 5 + seed) + 0.05 * Math.sin(Math.atan2(z, x) * 23 + y * 0.02);
    if (t > sl && ny > 0.25) c.copy(snow);
    else if (t < 0.22) c.copy(forest).lerp(rock, t / 0.22 * 0.5);
    else c.copy(rock).offsetHSL(0, 0, Math.sin(y * 0.05) * 0.05);
  });
}

// 둥근 언덕(벚꽃 코스 먼 산)
export function hillGeo(seed, rx, h, rz) {
  const g = lump(1, 1, 1, 1, seed, 3, 0.12);
  const q = g.attributes.position;
  for (let i = 0; i < q.count; i++) q.setXYZ(i, q.getX(i) * rx, Math.max(-0.05, q.getY(i)) * h, q.getZ(i) * rz);
  g.computeVertexNormals();
  return g;
}

// 먼 숲 나무: 침엽수(원뿔 두 겹)와 활엽수(둥근 덩어리) 두 가지
export function farTreeGeo(kind = 'cone') {
  if (kind === 'round') return merge([lump(3.2, 1, 0.85, 1, 7, 1, 0.18).translate(0, 5.6, 0), new THREE.CylinderGeometry(0.3, 0.4, 3, 5).translate(0, 1.5, 0)]);
  return merge([new THREE.ConeGeometry(3.0, 7, 8).translate(0, 6.0, 0), new THREE.ConeGeometry(2.2, 6, 8).translate(0, 9.2, 0), new THREE.CylinderGeometry(0.3, 0.4, 2.6, 5).translate(0, 1.3, 0)]);
}
