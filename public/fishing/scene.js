// 배스 낚시 3D 장면: 노을 하늘, 반사하는 호수, 호숫가 지형·갈대·연잎·나무·먼 산·물안개,
// 선착장과 낚시꾼들, 물결·물보라, 물고기, 조과 카드용 작은 쇼케이스.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LAKE, LILY, DOCK, SUN_AZ_RAD, lakeQ, terrainH } from './logic.js';
import { makeDock, makeRig } from './props.js';
import { makeFish, fishShadowTexture } from './fish.js';

const RD = Math.PI / 180;
const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Y = V(0, 1, 0);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

const SUN_ELEV = 4.6;
const SUN_AZ = SUN_AZ_RAD / RD; // + 는 화면 왼쪽(세계 +x)
const LINE_PTS = 30; // 줄 꺾은선 점 개수(릴 → 가이드 → 초릿대 → 찌)

function cv(w, h, draw) {
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
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const std = (color, roughness = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });

// ---------- 물결 노멀맵(이음매 없이 반복) ----------
function waterNormals() {
  const N = 256;
  const r = rng(42);
  const waves = [];
  for (let i = 0; i < 34; i++) {
    let kx = 0;
    let ky = 0;
    while (kx === 0 && ky === 0) {
      kx = Math.round((r() - 0.5) * 2 * (3 + i * 0.6));
      ky = Math.round((r() - 0.5) * 2 * (3 + i * 0.6));
    }
    waves.push({ kx, ky, a: 1 / Math.pow(Math.hypot(kx, ky), 1.25), p: r() * TAU });
  }
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let v = 0;
      for (const w of waves) v += w.a * Math.sin(TAU * (w.kx * x + w.ky * y) / N + w.p);
      h[y * N + x] = v;
    }
  }
  const c = document.createElement('canvas');
  c.width = N;
  c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  const s = 6;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)];
      const dy = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
      let nx = -dx * s;
      let ny = -dy * s;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const k = (y * N + x) * 4;
      img.data[k] = (nx * 0.5 + 0.5) * 255;
      img.data[k + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[k + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// 물결 고리: 어두운 골과 밝은 마루를 함께 그려 밝은 수면에서도, 어두운 수면에서도 보이게
const ringTex = tex(cv(256, 256, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, 'rgba(20,30,34,0)');
  r.addColorStop(0.66, 'rgba(20,30,34,0)');
  r.addColorStop(0.77, 'rgba(20,30,34,0.55)');
  r.addColorStop(0.84, 'rgba(255,248,236,0.95)');
  r.addColorStop(0.89, 'rgba(255,248,236,0.25)');
  r.addColorStop(0.94, 'rgba(255,248,236,0.6)');
  r.addColorStop(1, 'rgba(255,248,236,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, w, h);
}));
const blobTex = tex(cv(128, 128, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, 'rgba(0,0,0,.55)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, w, h);
}));
const mistTex = (() => {
  const r = rng(5);
  const t = tex(cv(512, 128, (g, W, H) => {
    for (let i = 0; i < 70; i++) {
      const x = r() * W;
      const y = H * (0.45 + (r() - 0.5) * 0.35);
      const rad = 30 + r() * 70;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,.22)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      // 가로로 이어 붙여도 이음매가 없게 양쪽에 한 번 더
      g.save();
      g.translate(x < W / 2 ? W : -W, 0);
      g.fillStyle = gr;
      g.fillRect(-W, 0, 3 * W, H);
      g.restore();
    }
    // 위아래 가장자리는 투명하게
    g.globalCompositeOperation = 'destination-in';
    const fade = g.createLinearGradient(0, 0, 0, H);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(0.4, 'rgba(0,0,0,1)');
    fade.addColorStop(0.7, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, W, H);
  }));
  t.wrapS = THREE.RepeatWrapping;
  return t;
})();
// 갈대 한 포기: 가는 잎 여러 장과 부들 이삭
const reedTex = (() => {
  const r = rng(9);
  return tex(cv(256, 512, (g, W, H) => {
    for (let i = 0; i < 16; i++) {
      const x0 = W * (0.35 + r() * 0.3);
      const lean = (r() - 0.5) * W * 0.7;
      const top = H * (0.05 + r() * 0.35);
      const w0 = 3 + r() * 4;
      const gr = g.createLinearGradient(0, H, 0, top);
      gr.addColorStop(0, '#3f4a22');
      gr.addColorStop(0.6, `rgb(${110 + r() * 40},${120 + r() * 30},${50 + r() * 20})`);
      gr.addColorStop(1, '#c9b46a');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(x0 - w0, H);
      g.quadraticCurveTo(x0 + lean * 0.3, (H + top) / 2, x0 + lean, top);
      g.quadraticCurveTo(x0 + lean * 0.3 + w0 * 0.6, (H + top) / 2, x0 + w0, H);
      g.fill();
    }
    for (let i = 0; i < 3; i++) {
      const x = W * (0.4 + r() * 0.2) + (r() - 0.5) * 40;
      const top = H * (0.03 + r() * 0.12);
      g.strokeStyle = '#6a6a3a';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(W / 2, H);
      g.quadraticCurveTo(W / 2, H * 0.5, x, top + 70);
      g.stroke();
      g.fillStyle = '#5a3a20';
      g.beginPath();
      g.ellipse(x, top + 42, 9, 30, 0, 0, TAU);
      g.fill();
      g.strokeStyle = '#6a6a3a';
      g.beginPath();
      g.moveTo(x, top + 12);
      g.lineTo(x, top - 6);
      g.stroke();
    }
  }));
})();
const lilyTex = (() => tex(cv(256, 256, (g, W, H) => {
  const cx = W / 2;
  const cy = H / 2;
  const gr = g.createRadialGradient(cx, cy, 0, cx, cy, W / 2);
  gr.addColorStop(0, '#5f8a35');
  gr.addColorStop(0.75, '#3f6c28');
  gr.addColorStop(0.95, '#6a5a2c');
  gr.addColorStop(1, '#4a3a22');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(150,190,90,.45)';
  g.lineWidth = 2;
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * TAU;
    g.beginPath();
    g.moveTo(cx, cy);
    g.quadraticCurveTo(cx + Math.cos(a + 0.1) * W * 0.25, cy + Math.sin(a + 0.1) * H * 0.25, cx + Math.cos(a) * W * 0.48, cy + Math.sin(a) * H * 0.48);
    g.stroke();
  }
  g.fillStyle = 'rgba(255,240,200,.08)';
  for (let i = 0; i < 40; i++) {
    g.beginPath();
    g.arc(Math.random() * W, Math.random() * H, 2 + Math.random() * 6, 0, TAU);
    g.fill();
  }
})))();
const skyGradTex = tex(cv(64, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#1d2533');
  gr.addColorStop(0.55, '#2c2c3c');
  gr.addColorStop(1, '#4a3530');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
}));

// ================================================================
export function createScene(cvEl) {
  const renderer = new THREE.WebGLRenderer({ canvas: cvEl, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.4;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const fogColor = new THREE.Color('#c98a66');
  scene.fog = new THREE.FogExp2(fogColor, 0.0019);
  const camera = new THREE.PerspectiveCamera(46, 1, 0.05, 6000);

  // ---------- 하늘과 해 ----------
  const sunDir = V().setFromSphericalCoords(1, (90 - SUN_ELEV) * RD, SUN_AZ * RD);
  const sky = new Sky();
  sky.scale.setScalar(5000);
  const su = sky.material.uniforms;
  su.turbidity.value = 3.6;
  su.rayleigh.value = 2.4;
  su.mieCoefficient.value = 0.004;
  su.mieDirectionalG.value = 0.84;
  su.sunPosition.value.copy(sunDir);
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const sky2 = new Sky();
  sky2.scale.setScalar(5000);
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) sky2.material.uniforms[k].value = su[k].value;
  sky2.material.uniforms.sunPosition.value.copy(sunDir);
  envScene.add(sky2);
  const env = pmrem.fromScene(envScene, 0.02).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.55;

  const hemi = new THREE.HemisphereLight('#a8b4e6', '#4a382a', 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffad6a', 2.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.target.position.set(0, DOCK.y, 0.4);
  sun.position.copy(sun.target.position).addScaledVector(sunDir, 40);
  {
    const c = sun.shadow.camera;
    c.left = -8;
    c.right = 8;
    c.top = 5;
    c.bottom = -5;
    c.near = 5;
    c.far = 80;
    c.updateProjectionMatrix();
  }
  scene.add(sun, sun.target);
  // 카메라 뒤 하늘에서 오는 차가운 보조광(뒷모습이 너무 검지 않게)
  const fill = new THREE.DirectionalLight('#8a9ad0', 0.55);
  fill.position.set(-6, 10, -20);
  scene.add(fill);

  // ---------- 호수 ----------
  const waterNormal = waterNormals();
  const water = new Water(new THREE.PlaneGeometry(2400, 2400), {
    textureWidth: 1024,
    textureHeight: 1024,
    waterNormals: waterNormal,
    sunDirection: sunDir.clone(),
    sunColor: '#d08a4a',
    waterColor: '#3a5a48',
    distortionScale: 1.8,
    fog: true,
    alpha: 1
  });
  // 가까운 물은 하늘을 덜 비추고 물빛이 보이게(호수의 깊이감). 먼 물은 프레넬로 여전히 하늘을 비춥니다.
  water.material.fragmentShader = water.material.fragmentShader.replace('float rf0 = 0.3;', 'float rf0 = 0.12;');
  water.material.needsUpdate = true;
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0, 200);
  water.material.uniforms.size.value = 4;
  scene.add(water);

  // ---------- 지형 ----------
  {
    const W = 1000;
    const D = 1000;
    const geo = new THREE.PlaneGeometry(W, D, 330, 330);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const r = rng(17);
    const mud = new THREE.Color('#3a3024');
    const sand = new THREE.Color('#7a6446');
    const grass = new THREE.Color('#5e6a2c');
    const grass2 = new THREE.Color('#3f5226');
    const far = new THREE.Color('#4c5634');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i) + 260;
      const h = terrainH(x, z);
      pos.setXYZ(i, x, h, z);
      const n = (Math.sin(x * 0.21) * Math.cos(z * 0.17) + Math.sin(x * 0.053 + z * 0.07)) * 0.5;
      if (h < -0.25) c.copy(mud);
      else if (h < 0.35) c.copy(mud).lerp(sand, clamp((h + 0.25) / 0.6, 0, 1));
      else if (h < 1.6) c.copy(sand).lerp(grass, clamp((h - 0.35) / 1.2, 0, 1));
      else c.copy(grass).lerp(grass2, clamp(0.5 + n * 0.6, 0, 1)).lerp(far, clamp((h - 6) / 20, 0, 0.7));
      const j = 0.92 + r() * 0.16;
      col[i * 3] = c.r * j;
      col[i * 3 + 1] = c.g * j;
      col[i * 3 + 2] = c.b * j;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, std('#ffffff', 0.96, { vertexColors: true }));
    ground.receiveShadow = true;
    scene.add(ground);
  }

  // ---------- 먼 산(두 겹 능선) ----------
  {
    const ridge = (z, base, amp, seed, color) => {
      const r = rng(seed);
      const N = 160;
      const width = 2600;
      const pts = [];
      const ph = [r() * 6, r() * 6, r() * 6];
      for (let i = 0; i <= N; i++) {
        const x = -width / 2 + (i / N) * width;
        const k = i / N;
        const hgt = base + amp * (0.55 + 0.25 * Math.sin(k * 9 + ph[0]) + 0.15 * Math.sin(k * 23 + ph[1]) + 0.07 * Math.sin(k * 61 + ph[2]));
        pts.push(x, hgt);
      }
      const pos = [];
      const idx = [];
      for (let i = 0; i <= N; i++) {
        pos.push(pts[i * 2], -20, z + Math.sin(i * 0.37) * 30, pts[i * 2], pts[i * 2 + 1], z + Math.sin(i * 0.37) * 30 + 40);
        if (i < N) {
          const a = i * 2;
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, std(color, 1, { side: THREE.DoubleSide, flatShading: true, fog: false }));
      scene.add(m);
    };
    ridge(820, 6, 42, 3, '#5a4555');
    ridge(1300, 16, 96, 8, '#6d5363');
  }

  // ---------- 나무 ----------
  {
    const r = rng(23);
    const spots = [];
    for (let i = 0; i < 9000 && spots.length < 950; i++) {
      const a = r() * TAU;
      const q = 1.05 + Math.pow(r(), 1.6) * 2.4;
      const x = LAKE.cx + Math.cos(a) * LAKE.ax * q * 1.02;
      const z = LAKE.cz + Math.sin(a) * LAKE.az * q * 1.02;
      if (lakeQ(x, z) < 1.05) continue;
      if (z < -14) continue; // 선착장 뒤(카메라 쪽)는 비워 둡니다
      const h = terrainH(x, z);
      if (h < 0.5) continue;
      // 해 지는 쪽은 나무를 낮고 듬성하게(해가 보이도록)
      const gapA = Math.abs(Math.atan2(x, z + 8) - SUN_AZ_RAD);
      let sc = 0.75 + r() * 0.9;
      if (z > 60 && gapA < 0.2) {
        if (r() < 0.75) continue;
        sc *= 0.55;
      }
      spots.push({ x, z, y: h, s: sc, pine: r() < 0.42, rot: r() * TAU, tint: r() });
    }
    const pineGeo = mergeGeometries([
      new THREE.ConeGeometry(2.4, 4.4, 9, 1).translate(0, 3.8, 0),
      new THREE.ConeGeometry(1.95, 3.8, 9, 1).translate(0, 5.9, 0),
      new THREE.ConeGeometry(1.4, 3.2, 9, 1).translate(0, 7.8, 0),
      new THREE.ConeGeometry(0.8, 2.2, 8, 1).translate(0, 9.4, 0)
    ]);
    const leafGeo = (() => {
      const parts = [];
      for (let k = 0; k < 4; k++) {
        const g = new THREE.IcosahedronGeometry(2.2 + k * 0.25, 1);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const v = V(p.getX(i), p.getY(i), p.getZ(i));
          const n = 1 + Math.sin(v.x * 2.1 + k) * Math.cos(v.y * 1.7) * Math.sin(v.z * 2.3) * 0.2;
          p.setXYZ(i, v.x * n, v.y * n * 0.85, v.z * n);
        }
        const off = [[0, 6.2, 0], [1.4, 5.2, 0.6], [-1.3, 5.4, -0.5], [0.2, 7.4, -0.3]][k];
        g.translate(off[0], off[1], off[2]);
        parts.push(g);
      }
      const m = mergeGeometries(parts);
      m.computeVertexNormals();
      return m;
    })();
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.34, 4, 7).translate(0, 2, 0);
    const mk = (geo, mat, list, colorFn) => {
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      const o = new THREE.Object3D();
      const c = new THREE.Color();
      list.forEach((t, i) => {
        o.position.set(t.x, t.y - 0.3, t.z);
        o.rotation.set(0, t.rot, 0);
        o.scale.setScalar(t.s);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
        if (colorFn) m.setColorAt(i, colorFn(t, c));
      });
      m.castShadow = false;
      m.receiveShadow = false;
      scene.add(m);
    };
    const leafMat = std('#ffffff', 0.92, { flatShading: true });
    mk(pineGeo, leafMat, spots.filter((t) => t.pine), (t, c) => c.setHSL(0.3 + t.tint * 0.05, 0.42, 0.1 + t.tint * 0.05));
    mk(leafGeo, leafMat.clone(), spots.filter((t) => !t.pine), (t, c) => c.setHSL(0.2 + t.tint * 0.08, 0.5, 0.13 + t.tint * 0.08));
    mk(trunkGeo, std('#4a3628', 0.9), spots, null);
  }

  // ---------- 갈대(바람에 흔들림) ----------
  const windU = { uTime: { value: 0 } };
  {
    const r = rng(31);
    const spots = [];
    for (let i = 0; i < 40000 && spots.length < 1500; i++) {
      const a = r() * TAU;
      const q = 0.93 + r() * 0.1;
      const x = LAKE.cx + Math.cos(a) * LAKE.ax * q * 1.06;
      const z = LAKE.cz + Math.sin(a) * LAKE.az * q * 1.06;
      const lq = lakeQ(x, z);
      if (lq < 0.955 || lq > 1.025) continue;
      if (z < -10 && Math.abs(x) < 14) continue;
      // 정면 먼 쪽은 듬성하게, 좌우 물가는 빽빽하게
      const sideW = Math.abs(Math.cos(a));
      if (r() > 0.35 + sideW * 0.65) continue;
      spots.push({ x, z, s: 0.8 + r() * 0.8, rot: r() * TAU, y: Math.min(0, terrainH(x, z)) });
    }
    // 연잎 군락 둘레에도 몇 포기
    const quad = new THREE.PlaneGeometry(1.1, 2.0).translate(0, 1.0, 0);
    const geo = mergeGeometries([quad.clone(), quad.clone().rotateY(Math.PI / 2), quad.clone().rotateY(Math.PI / 4)]);
    const mat = std('#ffffff', 0.85, { map: reedTex, alphaTest: 0.45, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = windU.uTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 wp = instanceMatrix[3].xz;
        #else
          vec2 wp = vec2(0.0);
        #endif
        float bend = position.y * position.y * 0.05;
        transformed.x += sin(uTime * 1.3 + wp.x * 0.21 + wp.y * 0.13) * bend + sin(uTime * 3.1 + wp.y) * bend * 0.25;
        transformed.z += cos(uTime * 1.1 + wp.y * 0.17) * bend * 0.6;`);
    };
    mat.customProgramCacheKey = () => 'reed-wind';
    const inst = new THREE.InstancedMesh(geo, mat, spots.length);
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    spots.forEach((t, i) => {
      o.position.set(t.x, t.y, t.z);
      o.rotation.set(0, t.rot, 0);
      o.scale.set(t.s, t.s * (0.8 + Math.random() * 0.5), t.s);
      o.updateMatrix();
      inst.setMatrixAt(i, o.matrix);
      inst.setColorAt(i, c.setHSL(0.16 + Math.random() * 0.05, 0.35, 0.55 + Math.random() * 0.25));
    });
    scene.add(inst);
  }

  // ---------- 연잎과 수련꽃 ----------
  {
    const r = rng(41);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.absarc(0, 0, 1, 0.18, TAU - 0.02, false);
    shape.lineTo(0, 0);
    const padGeo = new THREE.ShapeGeometry(shape, 28);
    padGeo.rotateX(-Math.PI / 2);
    // uv 를 원판 기준(-1~1 → 0~1)으로
    const uv = padGeo.attributes.uv;
    const p = padGeo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) * 0.5 + 0.5, -p.getZ(i) * 0.5 + 0.5);
    const pads = [];
    for (const cl of LILY) {
      const n = Math.round(cl.r * 11);
      for (let i = 0; i < n; i++) {
        const a = r() * TAU;
        const d = Math.sqrt(r()) * cl.r;
        pads.push({ x: cl.x + Math.cos(a) * d, z: cl.z + Math.sin(a) * d, s: 0.22 + r() * 0.36, rot: r() * TAU });
      }
    }
    const mat = std('#ffffff', 0.45, { map: lilyTex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    const inst = new THREE.InstancedMesh(padGeo, mat, pads.length);
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    pads.forEach((t, i) => {
      o.position.set(t.x, 0.03, t.z);
      o.rotation.set((r() - 0.5) * 0.04, t.rot, (r() - 0.5) * 0.04);
      o.scale.setScalar(t.s);
      o.updateMatrix();
      inst.setMatrixAt(i, o.matrix);
      inst.setColorAt(i, c.setHSL(0.24 + r() * 0.06, 0.4 + r() * 0.2, 0.5 + r() * 0.2));
    });
    inst.receiveShadow = true;
    scene.add(inst);
    // 꽃: 하얀 꽃잎이 겹겹이, 끝은 분홍
    const petalGeo = new THREE.SphereGeometry(1, 10, 6).scale(0.028, 0.012, 0.075).translate(0, 0, 0.07);
    const petalMat = new THREE.MeshPhysicalMaterial({ color: '#fff1f4', roughness: 0.5, sheen: 1, sheenColor: new THREE.Color('#ff9fc0') });
    const flowers = new THREE.Group();
    for (const cl of LILY) {
      const k = 2 + Math.floor(r() * 2);
      for (let f = 0; f < k; f++) {
        const fl = new THREE.Group();
        for (let layer = 0; layer < 2; layer++) {
          for (let i = 0; i < 9; i++) {
            const pm = new THREE.Mesh(petalGeo, petalMat);
            pm.rotation.set(0, (i / 9) * TAU + layer * 0.35, 0);
            pm.rotateX(-(0.35 + layer * 0.45));
            pm.scale.setScalar(1 - layer * 0.25);
            fl.add(pm);
          }
        }
        const heart = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), std('#f2c230', 0.6));
        heart.position.y = 0.02;
        fl.add(heart);
        const a = r() * TAU;
        const d = Math.sqrt(r()) * cl.r * 0.8;
        fl.position.set(cl.x + Math.cos(a) * d, 0.05, cl.z + Math.sin(a) * d);
        fl.scale.setScalar(1.4 + r() * 0.6);
        flowers.add(fl);
      }
    }
    scene.add(flowers);
  }

  // ---------- 물안개 ----------
  const mists = [];
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: mistTex.clone(), transparent: true, depthWrite: false, opacity: 0.1 + (i % 3) * 0.03, color: '#ffc9a0', fog: false, side: THREE.DoubleSide
    }));
    m.material.map.needsUpdate = true;
    const z = 60 + i * 12;
    const w = 140 + i * 26;
    m.scale.set(w, 4 + i * 0.5, 1);
    m.position.set((i % 2 ? -1 : 1) * i * 2, 1.2 + i * 0.2, z);
    m.userData.speed = (i % 2 ? -1 : 1) * (0.004 + i * 0.0008);
    m.renderOrder = 2;
    scene.add(m);
    mists.push(m);
  }

  // ---------- 선착장 ----------
  const dock = makeDock();
  scene.add(dock.group);

  // ---------- 물결 고리 ----------
  const ripples = [];
  {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (let i = 0; i < 64; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, opacity: 0, color: '#ffffff' }));
      m.visible = false;
      m.renderOrder = 1;
      scene.add(m);
      ripples.push({ m, t0: 0, life: 1.8, size: 1, str: 1 });
    }
  }
  let ripI = 0;
  function ripple(x, z, size = 1, str = 1) {
    const r = ripples[ripI++ % ripples.length];
    r.t0 = performance.now();
    r.life = 1.4 + size * 0.5;
    r.size = size;
    r.str = str;
    r.m.position.set(x, 0.02, z);
    r.m.visible = true;
  }

  // ---------- 물보라 ----------
  const MAXP = 900;
  const pPos = new Float32Array(MAXP * 3);
  const pVel = new Float32Array(MAXP * 3);
  const pLife = new Float32Array(MAXP);
  const pSize = new Float32Array(MAXP);
  const pAlpha = new Float32Array(MAXP);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('size', new THREE.BufferAttribute(pSize, 1));
  pGeo.setAttribute('alpha', new THREE.BufferAttribute(pAlpha, 1));
  const pMat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 }, uColor: { value: new THREE.Color('#fff2e0') } },
    vertexShader: `attribute float size; attribute float alpha; varying float vA; uniform float uScale;
      void main() { vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = max(0.1, -mv.z);
        gl_PointSize = size * uScale / d * max(1.0, d / 9.0);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; uniform vec3 uColor;
      void main() { vec2 c = gl_PointCoord - 0.5; float r = length(c); if (r > 0.5) discard;
        float a = smoothstep(0.5, 0.15, r) * vA; gl_FragColor = vec4(uColor * (1.0 + (0.3 - r)), a); }`,
    transparent: true,
    depthWrite: false
  });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  scene.add(points);
  let pI = 0;
  function splash(x, z, count = 16, power = 0.7) {
    for (let k = 0; k < count; k++) {
      const i = pI++ % MAXP;
      const a = Math.random() * TAU;
      const h = (0.3 + Math.random() * 1.2) * power;
      pPos[i * 3] = x + Math.cos(a) * 0.05;
      pPos[i * 3 + 1] = 0.03;
      pPos[i * 3 + 2] = z + Math.sin(a) * 0.05;
      pVel[i * 3] = Math.cos(a) * h * (0.8 + Math.random());
      pVel[i * 3 + 1] = (1.6 + Math.random() * 2.8) * power + 0.4;
      pVel[i * 3 + 2] = Math.sin(a) * h * (0.8 + Math.random());
      pLife[i] = 0.6 + Math.random() * 0.6;
      pSize[i] = 0.035 + Math.random() * 0.055 * (0.5 + power);
    }
  }

  // ---------- 사람별 장비 ----------
  const rigs = new Map(); // slot -> { rig, line, fish, fishSp, shadow, ... }
  const lineMats = [];
  const fishShadowMat = new THREE.MeshBasicMaterial({ map: fishShadowTexture(), transparent: true, depthWrite: false, opacity: 0 });
  function newLine(color) {
    const geo = new LineGeometry();
    geo.setPositions(new Array(LINE_PTS * 3).fill(0));
    const mat = new LineMaterial({ color: '#f3efe4', linewidth: 1.5, transparent: true, opacity: 0.85, worldUnits: false });
    lineMats.push(mat);
    const l = new Line2(geo, mat);
    l.frustumCulled = false;
    l.userData.color = color;
    return l;
  }
  // 빼낸 장비의 geometry·material 을 GPU 에서 내립니다. 텍스처는 여러 장비가 같이 쓰므로 건드리지 않습니다.
  function disposeTree(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const m = o.material;
      if (m) for (const x of Array.isArray(m) ? m : [m]) x.dispose();
    });
  }
  function setPlayers(list) {
    for (const [slot, r] of rigs) {
      if (!list.some((p) => p.slot === slot && p.color === r.color)) {
        scene.remove(r.rig.root, r.line, r.shadow);
        for (const f of r.fishes.values()) {
          scene.remove(f);
          disposeTree(f);
        }
        disposeTree(r.rig.root);
        disposeTree(r.line);
        disposeTree(r.shadow);
        const li = lineMats.indexOf(r.line.material);
        if (li >= 0) lineMats.splice(li, 1);
        rigs.delete(slot);
      }
    }
    for (const p of list) {
      if (rigs.has(p.slot)) continue;
      const rig = makeRig(p.color);
      scene.add(rig.root);
      const line = newLine(p.color);
      scene.add(line);
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5).rotateX(-Math.PI / 2), fishShadowMat.clone());
      shadow.visible = false;
      scene.add(shadow);
      rigs.set(p.slot, { slot: p.slot, color: p.color, rig, line, shadow, fish: null, fishSp: null, fishes: new Map(), mode: null, hasTip: false, bobVis: false });
    }
    resize();
  }

  // ---------- 쇼케이스(조과 카드 안의 물고기) ----------
  const show = new THREE.Scene();
  show.background = skyGradTex;
  show.environment = env;
  show.environmentIntensity = 0.9;
  const showCam = new THREE.PerspectiveCamera(26, 1.9, 0.05, 20);
  showCam.position.set(0, 0.08, 1.55);
  showCam.lookAt(0, 0, 0);
  {
    const key = new THREE.DirectionalLight('#ffd2a0', 3.2);
    key.position.set(1.5, 2, 2.2);
    const rim = new THREE.DirectionalLight('#9fc0ff', 2.6);
    rim.position.set(-2, 1.2, -2);
    show.add(key, rim, new THREE.HemisphereLight('#c8d8ff', '#3a2a20', 0.8));
    // 바닥 반사 느낌의 얕은 원판
    const disk = new THREE.Mesh(new THREE.CircleGeometry(0.7, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
    disk.position.y = -0.2;
    disk.scale.set(1.2, 1, 0.5);
    show.add(disk);
  }
  const showFish = {};
  let showcase = null;
  let showT0 = 0;
  function setShowcase(f) {
    for (const k of Object.keys(showFish)) showFish[k].visible = false;
    showcase = f;
    if (!f) return;
    if (!showFish[f.species]) {
      showFish[f.species] = makeFish(f.species);
      show.add(showFish[f.species]);
    }
    showFish[f.species].visible = true;
    showT0 = performance.now();
  }

  // ---------- 화면 효과 ----------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.5, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const m of lineMats) m.resolution.set(w, h);
    pMat.uniforms.uScale.value = h * 0.9;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- 카메라 ----------
  const camPos = V(0, 6, -10);
  const camLook = V(0, 1, 20);
  const tPos = V();
  const tLook = V();
  let lastMode = null;

  // ---------- 물 높이(찌 출렁임) ----------
  const waveY = (x, z, t) => 0.012 * Math.sin(x * 0.9 + t * 1.3) + 0.009 * Math.sin(z * 1.1 - t * 1.05 + x * 0.3) + 0.005 * Math.sin((x + z) * 2.3 + t * 2.2);

  const tmp = V();
  const tmp2 = V();
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const qc = new THREE.Quaternion();
  const Z = V(0, 0, 1);
  const X = V(1, 0, 0);

  // 장비마다 종별로 한 마리씩 만들어 두고 보이기만 바꿉니다(종이 바뀔 때마다 새로 만들면 GPU 메모리가 쌓임).
  function fishFor(R, species) {
    if (R.fish && R.fishSp === species) return R.fish;
    if (R.fish) R.fish.visible = false;
    let f = R.fishes.get(species);
    if (!f) {
      f = makeFish(species);
      f.traverse((m) => { if (m.isMesh) m.castShadow = true; });
      scene.add(f);
      R.fishes.set(species, f);
    }
    R.fish = f;
    R.fishSp = species;
    return f;
  }

  function updateRig(R, d, t, dt) {
    const rig = R.rig;
    const dir = V(d.rodDir[0], d.rodDir[1], d.rodDir[2]);
    const b = d.bob;
    // 줄이 당기는 방향(휘는 쪽)
    let pullTo = null;
    if (b && (b.mode === 'float' || b.mode === 'fly') && b.p) pullTo = V(b.p[0], b.mode === 'float' ? 0 : b.p[1], b.p[2]);
    if (d.fish && d.fish.hang) pullTo = rig.st.tip.clone().add(V(0, -1, 0));
    rig.pose({ x: d.x, dir, bend: d.bend || 0, pullTo, spin: d.spin || 0, cranking: d.cranking, t, lean: d.stage === 'fight' ? 0.35 : 0.1 });
    const tip = rig.st.tip;
    R.hasTip = true;

    // 찌
    let end = null; // 줄 끝
    let bobVis = Boolean(b);
    const st = rig.st;
    const pend = st.pend;
    if (b) {
      if (b.mode === 'tip' || b.mode === 'hang') {
        const hangLen = b.mode === 'hang' ? 0.3 : 0.55;
        const target = tmp.copy(tip).add(V(0, -hangLen, 0));
        if (!pend.init || R.mode !== b.mode) {
          pend.p.copy(target);
          pend.v.set(0, 0, 0);
          pend.init = true;
        }
        // 초릿대 끝에 매달린 진자
        const k = 70;
        const c = 7;
        tmp2.subVectors(target, pend.p).multiplyScalar(k).addScaledVector(pend.v, -c);
        pend.v.addScaledVector(tmp2, dt);
        pend.p.addScaledVector(pend.v, dt);
        const off = tmp2.subVectors(pend.p, tip);
        if (off.length() > hangLen) pend.p.copy(tip).addScaledVector(off.normalize(), hangLen);
        rig.setBobber(pend.p.clone().add(V(0, -0.05, 0)), 1, null);
        end = pend.p.clone();
      } else if (b.mode === 'fly') {
        pend.init = false;
        const p = V(b.p[0], b.p[1], b.p[2]);
        const k = clamp(camera.position.distanceTo(p) / 13, 1, 3.4);
        rig.setBobber(p, k, { x: 0.3, z: 0.2 });
        end = p.clone().add(V(0, 0.06 * k, 0));
      } else {
        pend.init = false;
        const p = V(b.p[0], 0, b.p[2]);
        const k = clamp(camera.position.distanceTo(p) / 11, 1.2, 3.8);
        const under = b.under || 0;
        const R0 = 0.042 * k;
        p.y = waveY(p.x, p.z, t) + R0 * 0.35 - under * R0 * 2.6;
        if (under > 1.2) p.y -= 0.3 * k; // 완전히 물속
        const tx = Math.sin(t * 1.7 + p.x) * 0.08 + (b.skate ? Math.sin(t * 12) * 0.12 * b.skate : 0);
        const tz = Math.cos(t * 1.3 + p.z) * 0.08;
        rig.setBobber(p, k, { x: tx, z: tz });
        end = p.clone().add(V(0, R0 * 1.2, 0));
        bobVis = under < 1.3;
      }
    }
    rig.bobber.visible = bobVis;

    // 물고기
    if (d.fish) {
      const f = d.fish;
      const fish = fishFor(R, f.species);
      fish.visible = true;
      const U = fish.userData.uniforms;
      U.uTime.value += dt;
      if (f.hang) {
        const exag = 1.75;
        const L = f.size * exag;
        fish.scale.setScalar(L);
        const mouth = (end || tip.clone().add(V(0, -0.3, 0))).clone().add(V(0, -0.08, 0));
        const hangC = mouth.clone().add(V(0, -0.5 * L, 0));
        // 물에서 끌어올리기
        const u = f.rise;
        const e = u * u * (3 - 2 * u);
        const from = V(f.from[0], 0.05, f.from[2]);
        fish.position.copy(from).lerp(hangC, e);
        fish.position.y += Math.sin(u * Math.PI) * 0.4;
        qa.setFromAxisAngle(Y, f.yaw + (1 - e) * Math.atan2(tip.x - from.x, tip.z - from.z));
        qb.setFromAxisAngle(Z, (Math.PI / 2) * e);
        qc.setFromAxisAngle(X, Math.sin(t * 7) * 0.2 * f.flap);
        fish.quaternion.copy(qa).multiply(qb).multiply(qc);
        U.uAmp.value = 0.03 + 0.05 * f.flap;
        U.uFreq.value = 15;
        U.uCurl.value = Math.sin(t * 10) * 0.3 * f.flap;
        end = mouth;
      } else {
        const p = V(f.p[0], f.p[1], f.p[2]);
        const exag = clamp(camera.position.distanceTo(p) / 11, 1.6, 3.2);
        fish.scale.setScalar(f.size * exag);
        fish.position.copy(p);
        qa.setFromAxisAngle(Y, f.yaw);
        qb.setFromAxisAngle(Z, f.pitch || 0);
        qc.setFromAxisAngle(X, f.roll || 0);
        fish.quaternion.copy(qa).multiply(qb).multiply(qc);
        U.uAmp.value = 0.07;
        U.uFreq.value = 16;
        U.uCurl.value = Math.sin(t * 9) * 0.25;
      }
    } else if (R.fish) R.fish.visible = false;

    // 물속 그림자
    if (d.shadow) {
      const s = d.shadow;
      R.shadow.visible = true;
      R.shadow.position.set(s.p[0], 0.015, s.p[1]);
      R.shadow.rotation.y = s.yaw - Math.PI / 2;
      R.shadow.scale.setScalar(Math.max(0.6, s.size * 2.2));
      R.shadow.material.opacity = s.alpha;
    } else R.shadow.visible = false;

    // 줄: 스풀 → 가이드 → 초릿대 → (늘어진 곡선) → 찌
    const arr = R.line.geometry.attributes.instanceStart.data.array;
    const pts = [];
    pts.push(st.spoolW.clone());
    for (const g of st.guideP) pts.push(g.clone());
    pts.push(tip.clone());
    const rest = LINE_PTS - pts.length;
    if (end) {
      const len = tip.distanceTo(end);
      const slack = clamp(d.slack == null ? 0.5 : d.slack, 0, 1);
      const mid = tmp.addVectors(tip, end).multiplyScalar(0.5);
      mid.y -= slack * (0.03 + len * 0.06) + 0.005 * len;
      for (let i = 1; i <= rest; i++) {
        const u = i / rest;
        const a = (1 - u) * (1 - u);
        const bb = 2 * (1 - u) * u;
        const c = u * u;
        const p = V(tip.x * a + mid.x * bb + end.x * c, tip.y * a + mid.y * bb + end.y * c, tip.z * a + mid.z * bb + end.z * c);
        // 물 위에 걸쳐 있는 부분은 수면에 눕습니다
        if (p.y < 0.006 && d.bob && d.bob.mode !== 'tip') p.y = 0.006;
        pts.push(p);
      }
    } else {
      // 끊어진 줄: 초릿대에서 조금 늘어진 끝
      for (let i = 1; i <= rest; i++) pts.push(tip.clone().add(V(0, -0.25 * (i / rest), 0)));
    }
    for (let i = 0; i < LINE_PTS - 1; i++) {
      const a = pts[i];
      const c = pts[i + 1];
      const k = i * 6;
      arr[k] = a.x;
      arr[k + 1] = a.y;
      arr[k + 2] = a.z;
      arr[k + 3] = c.x;
      arr[k + 4] = c.y;
      arr[k + 5] = c.z;
    }
    R.line.geometry.attributes.instanceStart.data.needsUpdate = true;
    R.mode = b ? b.mode : null;
    R.bobVis = bobVis;
  }

  let last = performance.now();
  function frame(now, dt, v) {
    const t = now / 1000;
    void last;
    last = now;
    water.material.uniforms.time.value += dt * 0.55;
    windU.uTime.value = t;
    for (const m of mists) m.material.map.offset.x += m.userData.speed * dt;
    // 등불이 살짝 일렁입니다
    dock.lantern.userData.light.intensity = 3.6 + Math.sin(t * 13) * 0.25 + Math.sin(t * 7.3) * 0.2;

    // 사람별 장비
    for (const d of v.players) {
      const R = rigs.get(d.slot);
      if (R) updateRig(R, d, t, dt);
    }

    // 물결
    for (const r of ripples) {
      if (!r.m.visible) continue;
      const u = (now - r.t0) / 1000 / r.life;
      if (u >= 1) {
        r.m.visible = false;
        continue;
      }
      const s = 0.15 + r.size * 2.2 * (1 - Math.pow(1 - u, 2.2));
      r.m.scale.set(s, 1, s);
      r.m.material.opacity = (1 - u) * (1 - u) * 0.75 * r.str;
    }
    // 물보라
    let live = 0;
    for (let i = 0; i < MAXP; i++) {
      if (pLife[i] <= 0) {
        pAlpha[i] = 0;
        continue;
      }
      live += 1;
      pLife[i] -= dt;
      pVel[i * 3 + 1] -= 9.8 * dt;
      pPos[i * 3] += pVel[i * 3] * dt;
      pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
      pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
      if (pPos[i * 3 + 1] < 0) pLife[i] = 0;
      pAlpha[i] = clamp(pLife[i] * 2.2, 0, 0.9);
    }
    if (live || pI) {
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.alpha.needsUpdate = true;
      pGeo.attributes.size.needsUpdate = true;
    }

    // 카메라
    const mode = v.mode;
    let k = 1.2;
    if (mode === 'play') {
      const n = v.players.length;
      const back = n > 2 ? 9.2 : 8.4;
      tPos.set(Math.sin(t * 0.11) * 0.25, 5.3 + Math.sin(t * 0.17) * 0.08, -back);
      tLook.set(Math.sin(t * 0.09) * 0.4, 0.7, 18);
      k = 1.6;
    } else if (mode === 'over') {
      const a = t * 0.05;
      tPos.set(Math.sin(a) * 9, 7.5, -11 + Math.cos(a) * 2);
      tLook.set(0, 1.5, 30);
      k = 0.8;
    } else {
      // 대기실: 물 위를 천천히 떠돌며 노을을 봅니다(오른쪽 절반이 보임)
      const a = t * 0.035;
      tPos.set(-9.5 + Math.sin(a) * 4, 2.6 + Math.sin(a * 1.7) * 0.6, -4 + Math.cos(a * 0.8) * 2.5);
      tLook.set(-24 + Math.sin(a * 0.6) * 8, 3.2, 70);
      k = 0.9;
    }
    if (lastMode !== mode) {
      // 대기실 ↔ 경기 전환은 바로 자릅니다
      camPos.copy(tPos);
      camLook.copy(tLook);
      lastMode = mode;
    }
    const e = 1 - Math.exp(-dt * k);
    camPos.lerp(tPos, e);
    camLook.lerp(tLook, e);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    composer.render();

    // 조과 카드 안의 물고기
    if (v.inset && showcase) {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const r = v.inset;
      const fish = showFish[showcase.species];
      const u = (now - showT0) / 1000;
      fish.position.set(0, Math.sin(u * 1.6) * 0.012, 0);
      fish.rotation.set(0, Math.sin(u * 0.7) * 0.5 - 0.25, Math.sin(u * 1.1) * 0.05);
      const U = fish.userData.uniforms;
      U.uTime.value = u;
      U.uAmp.value = 0.035;
      U.uFreq.value = 6;
      U.uCurl.value = u < 0.6 ? Math.sin(u * 30) * 0.2 * (1 - u / 0.6) : 0;
      showCam.aspect = r.w / r.h;
      showCam.updateProjectionMatrix();
      renderer.setScissorTest(true);
      renderer.setScissor(r.x, H - r.y - r.h, r.w, r.h);
      renderer.setViewport(r.x, H - r.y - r.h, r.w, r.h);
      renderer.render(show, showCam);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, W, H);
    }
  }

  function project(x, y, z) {
    const p = V(x, y, z).project(camera);
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight, on: p.z < 1 };
  }
  function tipOf(slot) {
    const R = rigs.get(slot);
    if (!R || !R.hasTip) return null;
    const t = R.rig.st.tip;
    return [t.x, t.y, t.z];
  }
  function bobberPos(slot) {
    const R = rigs.get(slot);
    if (!R || !R.bobVis) return null;
    const p = R.rig.bobber.position;
    return [p.x, p.y, p.z];
  }

  return { frame, setPlayers, ripple, splash, project, tipOf, bobberPos, setShowcase, renderer, camera, scene };
}
