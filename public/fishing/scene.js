// 배스 낚시 3D 장면(1인칭): 선착장 끝에 선 사람의 눈으로 맑은 호수를 내려다봅니다.
// 맑은 늦은 아침 하늘과 구름, 비치는 수면(반사·프레넬·반짝임), 보이는 바닥(모래·자갈·수초·통나무·바위·물빛 무늬),
// 물속에서 헤엄치는 물고기와 바닥 그림자, 사람마다의 낚싯대·줄·찌·조준선, 물결·물보라, 조과 카드 속 물고기.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import {
  LAKE, LILY, DOCK, EYE, SUN, SHELF, LOG, ROCKS, AREA, CAST_MIN, CAST_MAX, BAIT_DEPTH,
  lakeQ, terrainH, bedDepth, laneFracs, coverAt
} from './logic.js';
import { makeDock, makeTackle, makeNet, makeRod, makeBobber, makeBait } from './props.js';
import { makeFish, fishShadowTexture } from './fish.js';
import { UW, underwater, UW_TRANSMIT_GLSL } from './underwater.js';

const RD = Math.PI / 180;
const TAU = Math.PI * 2;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const LINE_PTS = 30; // 줄 꺾은선 점 개수(릴 → 가이드 → 초릿대 → 찌 → 물고기 입)
const L_UNDER = 1; // 물속·수면 위 장식 레이어(반사에는 그리지 않음)
// 2.25m 높이 눈에서 10m 밖의 25cm 물고기는 몇 픽셀뿐이라, 물속 물고기는 조금 키우고(가까이 1.25배)
// 멀수록 더 키워(14m 밖 2.25배) 그립니다. 들어 올린 물고기는 실제 크기로 돌아옵니다.
const FISH_NEAR_SCALE = 1.25;
const FISH_FAR_BOOST = 1.0;

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
const under = (o) => {
  o.layers.set(L_UNDER);
  return o;
};

// ---------- 물결 노멀맵(이음매 없이 반복) ----------
function waterNormals() {
  const N = 256;
  const r = rng(42);
  const waves = [];
  for (let i = 0; i < 40; i++) {
    let kx = 0;
    let ky = 0;
    while (kx === 0 && ky === 0) {
      kx = Math.round((r() - 0.5) * 2 * (2 + i * 0.55));
      ky = Math.round((r() - 0.5) * 2 * (2 + i * 0.55));
    }
    waves.push({ kx, ky, a: 1 / Math.pow(Math.hypot(kx, ky), 1.3), p: r() * TAU });
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
  const s = 7;
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
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// 물결 고리: 어두운 골과 밝은 마루를 함께 그려 밝은 수면에서도 보이게
const ringTex = tex(cv(256, 256, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, 'rgba(20,40,44,0)');
  r.addColorStop(0.64, 'rgba(20,40,44,0)');
  r.addColorStop(0.76, 'rgba(20,40,44,0.5)');
  r.addColorStop(0.84, 'rgba(255,255,250,0.95)');
  r.addColorStop(0.9, 'rgba(255,255,250,0.25)');
  r.addColorStop(0.95, 'rgba(255,255,250,0.6)');
  r.addColorStop(1, 'rgba(255,255,250,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, w, h);
}));
// 모래·자갈 바닥 무늬(이음매 없이 반복). 땅 위에서는 풀빛 정점 색과 곱해집니다.
const bedTex = (() => {
  const r = rng(77);
  const t = tex(cv(512, 512, (g, W, H) => {
    g.fillStyle = '#dadada';
    g.fillRect(0, 0, W, H);
    // 모래 잔결
    for (let i = 0; i < 9000; i++) {
      const v = 150 + r() * 90;
      g.fillStyle = `rgba(${v},${v},${v},${0.25 + r() * 0.35})`;
      g.fillRect(r() * W, r() * H, 1 + r() * 1.5, 1 + r() * 1.5);
    }
    // 물결 자국
    g.strokeStyle = 'rgba(120,120,120,.18)';
    g.lineWidth = 3;
    for (let k = 0; k < 14; k++) {
      const y0 = (k / 14) * H;
      g.beginPath();
      for (let x = -10; x <= W + 10; x += 8) g.lineTo(x, y0 + Math.sin(x * 0.045 + k) * 6 + Math.sin(x * 0.11) * 2);
      g.stroke();
    }
    // 자갈(이음매를 넘는 것은 반대편에도)
    const pebble = (x, y, rx, ry, a, v) => {
      for (const ox of [-W, 0, W]) {
        for (const oy of [-H, 0, H]) {
          const gr = g.createRadialGradient(x + ox - rx * 0.3, y + oy - ry * 0.3, 0, x + ox, y + oy, Math.max(rx, ry));
          gr.addColorStop(0, `rgb(${v + 40},${v + 38},${v + 34})`);
          gr.addColorStop(0.7, `rgb(${v},${v - 2},${v - 6})`);
          gr.addColorStop(1, `rgba(${v - 50},${v - 52},${v - 56},0.9)`);
          g.fillStyle = gr;
          g.beginPath();
          g.ellipse(x + ox, y + oy, rx, ry, a, 0, TAU);
          g.fill();
        }
      }
    };
    for (let i = 0; i < 260; i++) {
      const rr = 2 + Math.pow(r(), 2.2) * 9;
      pebble(r() * W, r() * H, rr, rr * (0.6 + r() * 0.35), r() * 3, 110 + r() * 90);
    }
  }));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();
// 갈대 한 포기: 가는 잎 여러 장과 부들 이삭
const reedTex = (() => {
  const r = rng(9);
  return tex(cv(256, 512, (g, W, H) => {
    for (let i = 0; i < 18; i++) {
      const x0 = W * (0.35 + r() * 0.3);
      const lean = (r() - 0.5) * W * 0.7;
      const top = H * (0.05 + r() * 0.35);
      const w0 = 3 + r() * 4;
      const gr = g.createLinearGradient(0, H, 0, top);
      gr.addColorStop(0, '#46602a');
      gr.addColorStop(0.6, `rgb(${105 + r() * 35},${140 + r() * 30},${55 + r() * 20})`);
      gr.addColorStop(1, '#d6cf86');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(x0 - w0, H);
      g.quadraticCurveTo(x0 + lean * 0.3, (H + top) / 2, x0 + lean, top);
      g.quadraticCurveTo(x0 + lean * 0.3 + w0 * 0.6, (H + top) / 2, x0 + w0, H);
      g.fill();
    }
    for (let i = 0; i < 2; i++) {
      const x = W * (0.4 + r() * 0.2) + (r() - 0.5) * 40;
      const top = H * (0.03 + r() * 0.12);
      g.strokeStyle = '#6f7a3c';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(W / 2, H);
      g.quadraticCurveTo(W / 2, H * 0.5, x, top + 70);
      g.stroke();
      g.fillStyle = '#5a3a20';
      g.beginPath();
      g.ellipse(x, top + 42, 7, 24, 0, 0, TAU);
      g.fill();
      g.strokeStyle = '#6f7a3c';
      g.beginPath();
      g.moveTo(x, top + 12);
      g.lineTo(x, top - 6);
      g.stroke();
    }
  }));
})();
const lilyTex = (() => {
  const r = rng(13);
  return tex(cv(256, 256, (g, W, H) => {
    const cx = W / 2;
    const cy = H / 2;
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, W / 2);
    gr.addColorStop(0, '#79a23e');
    gr.addColorStop(0.75, '#4f8a2e');
    gr.addColorStop(0.95, '#6c7a30');
    gr.addColorStop(1, '#4a4a22');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(170,210,110,.5)';
    g.lineWidth = 2;
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU;
      g.beginPath();
      g.moveTo(cx, cy);
      g.quadraticCurveTo(cx + Math.cos(a + 0.1) * W * 0.25, cy + Math.sin(a + 0.1) * H * 0.25, cx + Math.cos(a) * W * 0.48, cy + Math.sin(a) * H * 0.48);
      g.stroke();
    }
    g.fillStyle = 'rgba(255,250,220,.1)';
    for (let i = 0; i < 40; i++) {
      g.beginPath();
      g.arc(r() * W, r() * H, 2 + r() * 6, 0, TAU);
      g.fill();
    }
  }));
})();
// 나무껍질(가라앉은 통나무)
const barkTex = (() => {
  const r = rng(21);
  const t = tex(cv(256, 512, (g, W, H) => {
    g.fillStyle = '#6e5a44';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) {
      const x = r() * W;
      g.strokeStyle = `rgba(${30 + r() * 30},${22 + r() * 20},${14 + r() * 14},${0.35 + r() * 0.4})`;
      g.lineWidth = 2 + r() * 5;
      g.beginPath();
      g.moveTo(x, 0);
      for (let y = 0; y <= H; y += 24) g.lineTo(x + Math.sin(y * 0.03 + i) * 6, y);
      g.stroke();
    }
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(150,140,110,${0.1 + r() * 0.2})`;
      g.fillRect(r() * W, r() * H, 8 + r() * 20, 3 + r() * 6);
    }
  }));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();
// 하늘 띠 구름(뭉게구름 무리). 원통 안쪽에 붙여 지평선 위에 띄웁니다.
const cloudTex = (() => {
  const r = rng(99);
  const t = tex(cv(2048, 512, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    const puff = (x, y, rad, shade) => {
      for (const ox of [-W, 0, W]) {
        const gr = g.createRadialGradient(x + ox, y - rad * 0.25, rad * 0.1, x + ox, y, rad);
        gr.addColorStop(0, `rgba(255,255,255,${0.95 * shade})`);
        gr.addColorStop(0.55, `rgba(246,248,252,${0.75 * shade})`);
        gr.addColorStop(1, 'rgba(230,236,245,0)');
        g.fillStyle = gr;
        g.beginPath();
        g.arc(x + ox, y, rad, 0, TAU);
        g.fill();
      }
    };
    for (let c = 0; c < 15; c++) {
      const cx = r() * W;
      const base = H * (0.55 + r() * 0.3);
      const width = 90 + r() * 260;
      const tall = 40 + r() * 110;
      for (let i = 0; i < 26; i++) {
        const u = r();
        const x = cx + (u - 0.5) * width;
        const hump = Math.sin(u * Math.PI);
        const y = base - hump * tall * (0.4 + r() * 0.6);
        puff(x, y, 18 + hump * (20 + r() * 40), 0.75 + r() * 0.25);
      }
      // 아랫면은 평평하고 조금 어둡게
      const sh = g.createLinearGradient(0, base - 20, 0, base + 18);
      sh.addColorStop(0, 'rgba(170,185,205,0)');
      sh.addColorStop(1, 'rgba(170,185,205,0.35)');
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = sh;
      g.fillRect(cx - width, base - 20, width * 2, 38);
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = 'rgba(0,0,0,1)';
      g.fillRect(cx - width, base + 14, width * 2, 60);
      g.globalCompositeOperation = 'source-over';
    }
    // 아주 얇은 새털구름
    for (let i = 0; i < 40; i++) {
      const x = r() * W;
      const y = H * (0.1 + r() * 0.35);
      const gr = g.createRadialGradient(x, y, 0, x, y, 120);
      gr.addColorStop(0, 'rgba(255,255,255,.12)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.save();
      g.translate(x, y);
      g.scale(3, 0.25);
      g.translate(-x, -y);
      g.fillRect(x - 120, y - 120, 240, 240);
      g.restore();
    }
  }));
  t.wrapS = THREE.RepeatWrapping;
  return t;
})();
// 바닥 쪽 판(조과 카드 배경)
const skyGradTex = tex(cv(64, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#1b3a4a');
  gr.addColorStop(0.55, '#24505c');
  gr.addColorStop(1, '#3d6e6a');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
}));
const blobTex = tex(cv(128, 128, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, 'rgba(0,0,0,.55)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, w, h);
}));

// 찌 위 표시(그 사람 색 핀 + 번호). 멀리서도 같은 크기로 보입니다.
function markerTexture(color, name) {
  return tex(cv(128, 160, (g, W) => {
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.beginPath();
    g.ellipse(W / 2, 150, 16, 5, 0, 0, TAU);
    g.fill();
    g.fillStyle = color;
    g.strokeStyle = '#0b0f17';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(W / 2, 146);
    g.lineTo(W / 2 - 22, 104);
    g.arc(W / 2, 60, 50, Math.PI * 0.72, Math.PI * 2.28);
    g.closePath();
    g.stroke();
    g.fill();
    g.fillStyle = '#0b0f17';
    g.font = '400 52px Anton, Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(name, W / 2, 62);
  }));
}

// ================================================================
export function createScene(cvEl) {
  const renderer = new THREE.WebGLRenderer({ canvas: cvEl, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.62;
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  const hazeColor = new THREE.Color('#c4d6e2');
  scene.fog = new THREE.FogExp2(hazeColor, 0.0016);
  const camera = new THREE.PerspectiveCamera(EYE.fov, 16 / 9, 0.08, 6000);
  camera.rotation.order = 'YXZ';
  camera.layers.enable(L_UNDER);
  // 흔들림 없는 기준 카메라(낚싯대 자리·시야 판정용)
  const baseCam = new THREE.PerspectiveCamera(EYE.fov, 16 / 9, 0.08, 6000);
  baseCam.rotation.order = 'YXZ';
  baseCam.position.set(EYE.x, EYE.y, EYE.z);
  baseCam.rotation.set(-EYE.pitch * RD, Math.PI, 0);

  // ---------- 하늘·해·빛 ----------
  const sunDir = new THREE.Vector3(SUN.dir[0], SUN.dir[1], SUN.dir[2]).normalize();
  UW.uSunDir.value.copy(sunDir);
  const skyParams = { turbidity: 2.2, rayleigh: 1.05, mieCoefficient: 0.0035, mieDirectionalG: 0.82 };
  const sky = new Sky();
  sky.scale.setScalar(4000);
  for (const k of Object.keys(skyParams)) sky.material.uniforms[k].value = skyParams[k];
  sky.material.uniforms.sunPosition.value.copy(sunDir);
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const sky2 = new Sky();
  sky2.scale.setScalar(4000);
  for (const k of Object.keys(skyParams)) sky2.material.uniforms[k].value = skyParams[k];
  sky2.material.uniforms.sunPosition.value.copy(sunDir);
  envScene.add(sky2);
  const env = pmrem.fromScene(envScene, 0.02).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.55;

  const hemi = new THREE.HemisphereLight('#cfe2ff', '#6f6a4c', 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff0d8', 2.7);
  sun.position.copy(sunDir).multiplyScalar(60);
  sun.target.position.set(0, 0, 12);
  scene.add(sun, sun.target);
  // 눈 뒤쪽 위에서 오는 약한 보조광: 낚싯대와 들어 올린 물고기의 카메라 쪽 면이 어둡게 죽지 않게
  const fill = new THREE.DirectionalLight('#fff3e2', 0.6);
  fill.position.set(EYE.x - 2, EYE.y + 4, EYE.z - 6);
  fill.target.position.set(0, 1.2, 2);
  scene.add(fill, fill.target);

  // 지평선 위 뭉게구름 띠
  {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(2600, 2600, 820, 72, 1, true),
      new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, side: THREE.BackSide, fog: false, color: '#ffffff' }));
    cloudTex.repeat.set(3, 1);
    m.position.set(0, 330, 0);
    m.renderOrder = -1;
    // 물에는 비추지 않습니다(흰 구름이 잔물결에 번져 거품처럼 보이지 않게).
    scene.add(under(m));
  }

  // ---------- 지형(호수 바닥 + 둑 + 언덕) ----------
  // 가까운 곳은 촘촘하게(35cm), 먼 곳은 성기게 나눈 격자 하나.
  const ground = (() => {
    const axis = (lo, hi, step, outLo, outHi) => {
      const out = [];
      for (let v = lo; v <= hi + 1e-6; v += step) out.push(v);
      let s = step;
      let v = lo;
      while (v > outLo) {
        s *= 1.14;
        v -= s;
        out.unshift(Math.max(v, outLo));
      }
      s = step;
      v = hi;
      while (v < outHi) {
        s *= 1.14;
        v += s;
        out.push(Math.min(v, outHi));
      }
      return out;
    };
    const xs = axis(-30, 30, 0.35, -900, 900);
    const zs = axis(-9, 68, 0.35, -120, 1100);
    const nx = xs.length;
    const nz = zs.length;
    const pos = new Float32Array(nx * nz * 3);
    const uv = new Float32Array(nx * nz * 2);
    const col = new Float32Array(nx * nz * 3);
    const c = new THREE.Color();
    const sand = new THREE.Color('#e6d4a8');
    const sand2 = new THREE.Color('#c7b48c');
    const mud = new THREE.Color('#8a8466');
    const weedy = new THREE.Color('#8f9560');
    const wet = new THREE.Color('#8a7656');
    const grass = new THREE.Color('#79923f');
    const grass2 = new THREE.Color('#58782f');
    const far = new THREE.Color('#6a8650');
    const r = rng(17);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = xs[i];
        const z = zs[j];
        const h = terrainH(x, z);
        const k = j * nx + i;
        pos[k * 3] = x;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = z;
        uv[k * 2] = x / 2.4;
        uv[k * 2 + 1] = z / 2.4;
        const n = 0.5 + 0.5 * Math.sin(x * 0.37 + Math.sin(z * 0.23) * 2) * Math.cos(z * 0.29 - x * 0.11);
        if (h < -0.12) {
          const d = -h;
          c.copy(sand).lerp(sand2, clamp(n * 0.8, 0, 1)).lerp(mud, clamp((d - 2.2) / 2.5, 0, 0.75));
          const shelf = Math.exp(-(((x - SHELF.x) / SHELF.rx) ** 2) - (((z - SHELF.z) / SHELF.rz) ** 2));
          c.lerp(weedy, clamp(shelf * 0.8 + coverAt(x, z) * 0.15, 0, 0.8));
        } else if (h < 0.45) c.copy(wet).lerp(sand, clamp((h + 0.12) / 0.57, 0, 1) * 0.5);
        else if (h < 1.6) c.copy(sand).lerp(grass, clamp((h - 0.45) / 1.0, 0, 1));
        else c.copy(grass).lerp(grass2, clamp(0.5 + (n - 0.5) * 1.2, 0, 1)).lerp(far, clamp((h - 6) / 20, 0, 0.7));
        const jj = 0.93 + r() * 0.14;
        col[k * 3] = c.r * jj;
        col[k * 3 + 1] = c.g * jj;
        col[k * 3 + 2] = c.b * jj;
      }
    }
    const idx = [];
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const d = a + nx;
        const e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = underwater(std('#ffffff', 0.95, { vertexColors: true, map: bedTex, bumpMap: bedTex, bumpScale: 1.2 }), 'ground', { caustics: true });
    const m = new THREE.Mesh(geo, mat);
    scene.add(m);
    return m;
  })();
  void ground;

  // ---------- 먼 산(두 겹 능선) ----------
  {
    const ridge = (z, base, amp, seed, color) => {
      const r = rng(seed);
      const N = 160;
      const width = 2800;
      const ph = [r() * 6, r() * 6, r() * 6];
      const pos = [];
      const idx = [];
      for (let i = 0; i <= N; i++) {
        const x = -width / 2 + (i / N) * width;
        const k = i / N;
        const hgt = base + amp * (0.55 + 0.25 * Math.sin(k * 9 + ph[0]) + 0.15 * Math.sin(k * 23 + ph[1]) + 0.07 * Math.sin(k * 61 + ph[2]));
        const zz = z + Math.sin(i * 0.37) * 30;
        pos.push(x, -20, zz, x, hgt, zz + 40);
        if (i < N) {
          const a = i * 2;
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      scene.add(new THREE.Mesh(geo, std(color, 1, { side: THREE.DoubleSide, flatShading: true })));
    };
    ridge(700, 10, 50, 3, '#5f7f74');
    ridge(1150, 24, 110, 8, '#7e9aa6');
  }

  // ---------- 나무 ----------
  {
    const r = rng(23);
    const spots = [];
    for (let i = 0; i < 12000 && spots.length < 900; i++) {
      const a = r() * TAU;
      const q = 1.1 + Math.pow(r(), 1.4) * 2.4;
      const x = LAKE.cx + Math.cos(a) * LAKE.ax * q;
      const z = LAKE.cz + Math.sin(a) * LAKE.az * q;
      if (lakeQ(x, z) < 1.09) continue;
      if (z < -6) continue;
      const h = terrainH(x, z);
      if (h < 0.5) continue;
      // 먼 물가(정면)는 키 작은 나무로: 하늘과 먼 산이 보이게
      const front = z > 45 && Math.abs(x) < 40 ? 0.7 : 1;
      spots.push({ x, z, y: h, s: (0.55 + r() * 0.6) * front, pine: r() < 0.38, rot: r() * TAU, tint: r() });
    }
    const pineGeo = mergeGeometries([
      new THREE.ConeGeometry(2.4, 4.4, 9, 1).translate(0, 3.8, 0),
      new THREE.ConeGeometry(1.95, 3.8, 9, 1).translate(0, 5.9, 0),
      new THREE.ConeGeometry(1.4, 3.2, 9, 1).translate(0, 7.8, 0),
      new THREE.ConeGeometry(0.8, 2.2, 8, 1).translate(0, 9.4, 0)
    ]);
    const leafGeo = (() => {
      const parts = [];
      const v = new THREE.Vector3();
      for (let k = 0; k < 4; k++) {
        const g = new THREE.IcosahedronGeometry(2.2 + k * 0.25, 1);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
          v.set(p.getX(i), p.getY(i), p.getZ(i));
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
      scene.add(m);
    };
    const leafMat = std('#ffffff', 0.9, { flatShading: true });
    mk(pineGeo, leafMat, spots.filter((t) => t.pine), (t, c) => c.setHSL(0.33 + t.tint * 0.04, 0.42, 0.13 + t.tint * 0.06));
    mk(leafGeo, leafMat.clone(), spots.filter((t) => !t.pine), (t, c) => c.setHSL(0.22 + t.tint * 0.07, 0.5, 0.2 + t.tint * 0.1));
    mk(trunkGeo, std('#5a4532', 0.9), spots, null);
  }

  // ---------- 갈대(바람에 흔들림) ----------
  const windU = { uTime: { value: 0 } };
  {
    const r = rng(31);
    const spots = [];
    for (let i = 0; i < 60000 && spots.length < 1300; i++) {
      const x = (r() - 0.5) * 70;
      const z = -4 + r() * 62;
      const lq = lakeQ(x, z);
      if (lq < 0.93 || lq > 1.035) continue;
      if (z < 2 && Math.abs(x) < 10) continue;
      spots.push({ x, z, s: 0.8 + r() * 0.8, rot: r() * TAU, y: Math.min(0, terrainH(x, z)) });
    }
    // 연잎 군락 바깥쪽 가장자리에도 몇 포기
    for (const cl of LILY) {
      for (let i = 0; i < 26; i++) {
        const a = r() * TAU;
        const d = cl.r * (0.9 + r() * 0.5);
        const x = cl.x + Math.cos(a) * d * 0.6 + Math.sign(cl.x) * cl.r * 0.6;
        const z = cl.z + Math.sin(a) * d;
        spots.push({ x, z, s: 0.7 + r() * 0.6, rot: r() * TAU, y: -0.4 });
      }
    }
    const quad = new THREE.PlaneGeometry(1.1, 2.0).translate(0, 1.0, 0);
    const geo = mergeGeometries([quad.clone(), quad.clone().rotateY(Math.PI / 2), quad.clone().rotateY(Math.PI / 4)]);
    const mat = std('#ffffff', 0.85, { map: reedTex, alphaTest: 0.45, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = windU.uTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec2 wp = instanceMatrix[3].xz;
        float bend = position.y * position.y * 0.05;
        transformed.x += sin(uTime * 1.3 + wp.x * 0.21 + wp.y * 0.13) * bend + sin(uTime * 3.1 + wp.y) * bend * 0.25;
        transformed.z += cos(uTime * 1.1 + wp.y * 0.17) * bend * 0.6;`);
    };
    mat.customProgramCacheKey = () => 'reed-wind-v2';
    const inst = new THREE.InstancedMesh(geo, mat, spots.length);
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    spots.forEach((t, i) => {
      o.position.set(t.x, t.y, t.z);
      o.rotation.set(0, t.rot, 0);
      o.scale.set(t.s, t.s * (0.8 + r() * 0.5), t.s);
      o.updateMatrix();
      inst.setMatrixAt(i, o.matrix);
      inst.setColorAt(i, c.setHSL(0.2 + r() * 0.06, 0.35, 0.62 + r() * 0.25));
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
    const uv = padGeo.attributes.uv;
    const p = padGeo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) * 0.5 + 0.5, -p.getZ(i) * 0.5 + 0.5);
    const pads = [];
    for (const cl of LILY) {
      const n = Math.round(cl.r * 13);
      for (let i = 0; i < n; i++) {
        const a = r() * TAU;
        const d = Math.sqrt(r()) * cl.r;
        pads.push({ x: cl.x + Math.cos(a) * d, z: cl.z + Math.sin(a) * d, s: 0.2 + r() * 0.32, rot: r() * TAU });
      }
    }
    const mat = std('#ffffff', 0.45, { map: lilyTex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    const inst = new THREE.InstancedMesh(padGeo, mat, pads.length);
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    pads.forEach((t, i) => {
      o.position.set(t.x, 0.025, t.z);
      o.rotation.set((r() - 0.5) * 0.04, t.rot, (r() - 0.5) * 0.04);
      o.scale.setScalar(t.s);
      o.updateMatrix();
      inst.setMatrixAt(i, o.matrix);
      inst.setColorAt(i, c.setHSL(0.24 + r() * 0.06, 0.4 + r() * 0.2, 0.55 + r() * 0.2));
    });
    scene.add(inst);
    // 꽃: 하얀 꽃잎이 겹겹이, 끝은 분홍(꽃잎을 한 덩어리로 합칩니다)
    const petals = [];
    const hearts = [];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (const cl of LILY) {
      const k = 2 + Math.floor(r() * 2);
      for (let f = 0; f < k; f++) {
        const a = r() * TAU;
        const d = Math.sqrt(r()) * cl.r * 0.8;
        const fx = cl.x + Math.cos(a) * d;
        const fz = cl.z + Math.sin(a) * d;
        const fs = 1.4 + r() * 0.6;
        for (let layer = 0; layer < 2; layer++) {
          for (let i = 0; i < 9; i++) {
            const g = new THREE.SphereGeometry(1, 10, 6).scale(0.028, 0.012, 0.075).translate(0, 0, 0.07);
            e.set(-(0.35 + layer * 0.45), (i / 9) * TAU + layer * 0.35, 0, 'YXZ');
            q.setFromEuler(e);
            m4.compose(new THREE.Vector3(fx, 0.05, fz), q, new THREE.Vector3(fs * (1 - layer * 0.25), fs * (1 - layer * 0.25), fs * (1 - layer * 0.25)));
            g.applyMatrix4(m4);
            petals.push(g);
          }
        }
        hearts.push(new THREE.SphereGeometry(0.03 * fs, 10, 8).translate(fx, 0.07, fz));
      }
    }
    scene.add(new THREE.Mesh(mergeGeometries(petals), new THREE.MeshPhysicalMaterial({ color: '#fff3f6', roughness: 0.5, sheen: 1, sheenColor: new THREE.Color('#ff9fc0') })));
    scene.add(new THREE.Mesh(mergeGeometries(hearts), std('#f2c230', 0.6)));
  }

  // ---------- 물속: 수초(흔들림), 자갈, 바위, 가라앉은 통나무 ----------
  {
    // 수초 한 포기: 가늘고 긴 잎 7장(높이 1 기준, 인스턴스마다 키를 늘립니다)
    const r = rng(51);
    const ribbons = [];
    for (let k = 0; k < 7; k++) {
      const seg = 7;
      const w0 = 0.02 + r() * 0.018;
      const ang = r() * TAU;
      const lean = 0.08 + r() * 0.18;
      const hk = 0.6 + r() * 0.4;
      const pos = [];
      const idx = [];
      for (let i = 0; i <= seg; i++) {
        const u = i / seg;
        const w = w0 * (1 - u * 0.75);
        const cx = Math.cos(ang) * lean * u * u;
        const cz = Math.sin(ang) * lean * u * u;
        const px = -Math.sin(ang) * w;
        const pz = Math.cos(ang) * w;
        pos.push(cx - px, u * hk, cz - pz, cx + px, u * hk, cz + pz);
        if (i < seg) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.translate((r() - 0.5) * 0.08, 0, (r() - 0.5) * 0.08);
      ribbons.push(g);
    }
    const clump = mergeGeometries(ribbons);
    clump.computeVertexNormals();
    const spots = [];
    const tryAdd = (x, z, hMax) => {
      const d = bedDepth(x, z);
      if (d < 0.5 || lakeQ(x, z) > 0.86) return;
      spots.push({ x, z, y: -d, h: Math.min(hMax, d - 0.2) * (0.55 + r() * 0.45), rot: r() * TAU });
    };
    for (let i = 0; i < 70; i++) tryAdd(SHELF.x + (r() - 0.5) * SHELF.rx * 2.2, SHELF.z + (r() - 0.5) * SHELF.rz * 2.2, 1.0);
    for (let i = 0; i < 40; i++) tryAdd((r() < 0.5 ? 1 : -1) * (11 + r() * 5), 3 + r() * 26, 1.3);
    for (let i = 0; i < 14; i++) tryAdd(LOG.x + (r() - 0.5) * 5, LOG.z + (r() - 0.5) * 4, 1.2);
    for (let i = 0; i < 26; i++) tryAdd((r() - 0.5) * 24, 3 + r() * 28, 1.4);
    const mat = std('#ffffff', 0.7, { side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = windU.uTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec2 wp = instanceMatrix[3].xz;
        float hb = position.y * position.y;
        transformed.x += (sin(uTime * 0.9 + wp.x * 0.7 + position.y * 2.2) * 0.16 + sin(uTime * 1.7 + wp.y) * 0.04) * hb;
        transformed.z += (cos(uTime * 0.75 + wp.y * 0.6 + position.y * 1.8) * 0.12) * hb;`);
    };
    underwater(mat, 'weed');
    const inst = new THREE.InstancedMesh(clump, mat, spots.length);
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    spots.forEach((t, i) => {
      o.position.set(t.x, t.y - 0.02, t.z);
      o.rotation.set(0, t.rot, 0);
      o.scale.set(1 + r() * 0.6, t.h, 1 + r() * 0.6);
      o.updateMatrix();
      inst.setMatrixAt(i, o.matrix);
      inst.setColorAt(i, c.setHSL(0.2 + r() * 0.1, 0.45 + r() * 0.2, 0.22 + r() * 0.14));
    });
    scene.add(under(inst));
  }
  {
    // 자갈: 가까운 바닥에 흩어진 작은 돌
    const r = rng(61);
    const base = new THREE.IcosahedronGeometry(1, 1);
    const p = base.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 0.85 + 0.3 * Math.abs(Math.sin(p.getX(i) * 5.1 + p.getY(i) * 3.3 + p.getZ(i) * 4.7));
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    base.computeVertexNormals();
    const list = [];
    for (let i = 0; i < 4000 && list.length < 1100; i++) {
      const x = (r() - 0.5) * 30;
      const z = 0.4 + Math.pow(r(), 1.3) * 22;
      const d = bedDepth(x, z);
      if (d < 0.3) continue;
      list.push({ x, z, y: -d, s: 0.02 + Math.pow(r(), 2.6) * 0.085 });
    }
    const mat = underwater(std('#ffffff', 0.75), 'pebble', { caustics: true });
    const inst = new THREE.InstancedMesh(base, mat, list.length);
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    const pal = ['#9a8f7c', '#b3a68c', '#7a7062', '#cbbd9e', '#8a7a64', '#a8a091', '#6b6255', '#c9b28a'];
    list.forEach((t, i) => {
      o.position.set(t.x, t.y + t.s * 0.25, t.z);
      o.rotation.set(r() * 3, r() * 3, r() * 3);
      o.scale.set(t.s * (0.9 + r() * 0.5), t.s * (0.45 + r() * 0.3), t.s * (0.8 + r() * 0.4));
      o.updateMatrix();
      inst.setMatrixAt(i, o.matrix);
      inst.setColorAt(i, c.set(pal[Math.floor(r() * pal.length)]).multiplyScalar(0.85 + r() * 0.3));
    });
    scene.add(under(inst));
  }
  {
    // 바위: 울퉁불퉁한 덩어리, 윗면에 이끼
    const r = rng(71);
    const parts = [];
    for (const rk of ROCKS) {
      const g = new THREE.IcosahedronGeometry(rk.r, 3);
      const p = g.attributes.position;
      const colA = new Float32Array(p.count * 3);
      const seed = r() * 10;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i);
        let y = p.getY(i);
        let z = p.getZ(i);
        const n = 1 + 0.2 * Math.sin(x * 4.1 / rk.r + seed) * Math.cos(z * 3.7 / rk.r + seed) + 0.1 * Math.sin(y * 9 / rk.r + x * 7 / rk.r) + 0.05 * Math.sin(z * 17 / rk.r + y * 13 / rk.r);
        x *= n * 1.15;
        z *= n;
        y = y * n * 0.62;
        if (y < -rk.r * 0.2) y = -rk.r * 0.2 + (y + rk.r * 0.2) * 0.2;
        p.setXYZ(i, x, y, z);
        const top = clamp(y / (rk.r * 0.6), 0, 1);
        const v = 0.3 + 0.1 * Math.sin(x * 13 + z * 11) + 0.06 * Math.sin(y * 21);
        colA[i * 3] = v * (1 - top * 0.55) + 0.02;
        colA[i * 3 + 1] = v * (1 - top * 0.08) + 0.03;
        colA[i * 3 + 2] = v * (1 - top * 0.7);
      }
      g.setAttribute('color', new THREE.BufferAttribute(colA, 3));
      g.computeVertexNormals();
      g.rotateY(r() * TAU);
      g.translate(rk.x, -bedDepth(rk.x, rk.z) + rk.r * 0.18, rk.z);
      parts.push(g);
    }
    const mat = underwater(std('#ffffff', 0.95, { vertexColors: true, flatShading: true, map: bedTex }), 'rock', { caustics: true });
    scene.add(under(new THREE.Mesh(mergeGeometries(parts), mat)));
  }
  {
    // 가라앉은 통나무: 껍질 무늬, 윗면 이끼, 부러진 가지 두 개
    const g = new THREE.CylinderGeometry(LOG.r, LOG.r * 1.12, LOG.len, 20, 14).toNonIndexed();
    const p = g.attributes.position;
    const colA = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const wob = 1 + 0.05 * Math.sin(y * 3.1) + 0.04 * Math.sin(Math.atan2(z, x) * 5 + y);
      p.setXYZ(i, x * wob, y, z * wob);
      const top = clamp(x / LOG.r, 0, 1);
      colA[i * 3] = 1 - top * 0.45;
      colA[i * 3 + 1] = 1 - top * 0.12;
      colA[i * 3 + 2] = 1 - top * 0.55;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colA, 3));
    g.computeVertexNormals();
    const stubs = [];
    for (const [y, a, l] of [[0.9, 0.5, 0.6], [-1.3, -0.7, 0.45]]) {
      const s = new THREE.CylinderGeometry(0.035, 0.07, l, 10).toNonIndexed();
      s.translate(0, l / 2, 0);
      s.rotateZ(-Math.PI / 2 + a);
      s.translate(LOG.r * 0.6, y, 0);
      const cc = new Float32Array(s.attributes.position.count * 3).fill(0.85);
      s.setAttribute('color', new THREE.BufferAttribute(cc, 3));
      stubs.push(s);
    }
    const all = mergeGeometries([g, ...stubs]);
    barkTex.repeat.set(1, 3);
    const mat = underwater(std('#ffffff', 0.95, { map: barkTex, vertexColors: true }), 'log', { caustics: true });
    const m = new THREE.Mesh(all, mat);
    // 눕히기: 원통 y 축 → 바닥 방향(LOG.yaw), 윗면(x+) → 위
    m.rotation.set(0, LOG.yaw, Math.PI / 2, 'YXZ');
    const bed0 = -bedDepth(LOG.x - Math.sin(LOG.yaw) * LOG.len * 0.4, LOG.z - Math.cos(LOG.yaw) * LOG.len * 0.4);
    const bed1 = -bedDepth(LOG.x + Math.sin(LOG.yaw) * LOG.len * 0.4, LOG.z + Math.cos(LOG.yaw) * LOG.len * 0.4);
    m.position.set(LOG.x, (bed0 + bed1) / 2 + LOG.r * 0.55, LOG.z);
    m.rotation.x = Math.atan2(bed1 - bed0, LOG.len * 0.8) * 0.8;
    scene.add(under(m));
  }

  // ---------- 선착장 끝과 구석 소품 ----------
  scene.add(makeDock());
  {
    const tb = makeTackle();
    tb.position.set(DOCK.x1 - 0.4, DOCK.y, DOCK.z1 - 0.3);
    tb.rotation.y = Math.PI + 0.45;
    scene.add(tb);
    const net = makeNet();
    net.position.set(DOCK.x0 + 0.16, DOCK.y, DOCK.z1 - 0.18);
    net.rotation.set(-0.08, 0.4, -0.13);
    scene.add(net);
  }

  // ---------- 수면(반사 + 비침 + 반짝임) ----------
  const waterNormal = waterNormals();
  const WaterShader = {
    name: 'LakeWater',
    uniforms: {
      color: { value: null },
      tDiffuse: { value: null },
      textureMatrix: { value: null },
      uNormals: { value: waterNormal },
      uTime: { value: 0 },
      uSunDir: { value: sunDir.clone() },
      uSunCol: { value: new THREE.Color('#fff4e0').multiplyScalar(5) },
      uTint: { value: new THREE.Color('#5d9a8f') },
      uTintA: { value: 0.085 },
      uReflK: { value: 0.66 },
      uFogColor: { value: hazeColor },
      uFogDensity: { value: 0.0016 }
    },
    vertexShader: `
      uniform mat4 textureMatrix;
      varying vec4 vRUv;
      varying vec3 vW;
      void main() {
        vRUv = textureMatrix * vec4(position, 1.0);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform sampler2D uNormals;
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunCol;
      uniform vec3 uTint;
      uniform float uTintA;
      uniform float uReflK;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      varying vec4 vRUv;
      varying vec3 vW;
      vec3 outTone(vec3 c) {
        #ifdef TONE_MAPPING
          c = toneMapping(c);
        #endif
        return linearToOutputTexel(vec4(c, 1.0)).rgb;
      }
      void main() {
        vec3 toC = cameraPosition - vW;
        float dist = length(toC);
        vec3 V = toC / dist;
        vec2 p = vW.xz;
        vec3 a = texture2D(uNormals, p * 0.07 + uTime * vec2(0.010, 0.007)).xyz * 2.0 - 1.0;
        vec3 b = texture2D(uNormals, p * 0.19 + uTime * vec2(-0.016, 0.012)).xyz * 2.0 - 1.0;
        vec3 c = texture2D(uNormals, p * 0.47 + uTime * vec2(0.022, -0.026)).xyz * 2.0 - 1.0;
        vec2 g = a.xy * 0.5 + b.xy * 0.38 + c.xy * 0.3;
        float far = smoothstep(18.0, 70.0, dist);
        g *= mix(1.0, 0.45, far);
        vec3 n = normalize(vec3(g.x, 1.0 / 0.32, g.y));
        float cosT = clamp(dot(n, V), 0.0, 1.0);
        float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
        // 잔물결 비탈이 하늘을 조금 더 비춥니다(가까운 물에서도 수면이 느껴지게).
        F = min(F * uReflK + smoothstep(0.16, 0.5, length(g)) * 0.085 * (1.0 - far), 0.78);
        // 반사: 잔물결로 흔들고, 세 점을 섞어 하늘·숲 경계가 거품처럼 번쩍이지 않게 부드럽게
        vec2 dv = n.xz * 0.022 / (1.0 + dist * 0.06);
        vec2 ruv = vRUv.xy / vRUv.w + dv;
        vec3 refl = (texture2D(tDiffuse, ruv).rgb * 2.0 + texture2D(tDiffuse, ruv + dv * 0.7 + vec2(0.0, 0.004)).rgb + texture2D(tDiffuse, ruv - dv * 0.7 - vec2(0.0, 0.004)).rgb) * 0.25 * 0.84;
        // 해 반짝임: 넓은 윤기 + 가는 반짝이(잔물결이 해를 비출 때)
        vec3 R = reflect(-V, n);
        float sd = max(dot(R, uSunDir), 0.0);
        vec3 nh = normalize(vec3(c.x * 2.6 + b.x, 1.0, c.y * 2.6 + b.y));
        vec3 H = normalize(V + uSunDir);
        float glit = pow(max(dot(nh, H), 0.0), 1600.0) * smoothstep(9.0, 22.0, dist) * (1.0 - far * 0.5);
        vec3 spec = uSunCol * (pow(sd, 700.0) * 4.0 + pow(sd, 60.0) * 0.05 + glit * 0.7);
        // 비치는 물: 가까이·내려다볼수록 맑고, 멀수록 조금 더 물빛
        float tintA = uTintA * (0.7 + 0.6 * smoothstep(3.0, 30.0, dist));
        vec3 col = outTone(refl) * F + outTone(uTint) * tintA * (1.0 - F) + outTone(spec);
        float alpha = F + tintA * (1.0 - F);
        float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
        col = mix(col, outTone(uFogColor) * alpha, fogF);
        gl_FragColor = vec4(col, alpha);
      }`
  };
  const water = new Reflector(new THREE.PlaneGeometry(420, 420), {
    shader: WaterShader,
    textureWidth: 960,
    textureHeight: 540,
    clipBias: 0.002,
    multisample: 0,
    color: '#ffffff'
  });
  // 복제된 유니폼 대신 원본을 씁니다(노멀맵 텍스처를 두 번 올리지 않게).
  water.material.uniforms.uNormals.value = waterNormal;
  water.material.transparent = true;
  water.material.depthWrite = false;
  water.material.blending = THREE.CustomBlending;
  water.material.blendSrc = THREE.OneFactor;
  water.material.blendDst = THREE.OneMinusSrcAlphaFactor;
  water.material.blendSrcAlpha = THREE.OneFactor;
  water.material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0, 120);
  water.renderOrder = 5;
  scene.add(water);
  const wU = water.material.uniforms;

  // ---------- 물결 고리 ----------
  const ripples = [];
  {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (let i = 0; i < 72; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, opacity: 0, fog: false }));
      m.visible = false;
      m.renderOrder = 7;
      scene.add(under(m));
      ripples.push({ m, t0: 0, life: 1.8, size: 1, str: 1 });
    }
  }
  let ripI = 0;
  function ripple(x, z, size = 1, str = 1) {
    const r = ripples[ripI++ % ripples.length];
    r.t0 = performance.now();
    r.life = 1.3 + size * 0.55;
    r.size = size;
    r.str = str;
    r.m.position.set(x, 0.012, z);
    r.m.visible = true;
  }

  // ---------- 물보라 ----------
  const MAXP = 1000;
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
    uniforms: { uScale: { value: 600 }, uColor: { value: new THREE.Color('#ffffff') } },
    vertexShader: `attribute float size; attribute float alpha; varying float vA; uniform float uScale;
      void main() { vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = max(0.1, -mv.z);
        gl_PointSize = size * uScale / d * max(1.0, d / 9.0);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; uniform vec3 uColor;
      void main() { vec2 c = gl_PointCoord - 0.5; float r = length(c); if (r > 0.5) discard;
        float a = smoothstep(0.5, 0.12, r) * vA; gl_FragColor = vec4(uColor * (0.92 + (0.3 - r) * 0.4), a); }`,
    transparent: true,
    depthWrite: false
  });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  points.renderOrder = 8;
  scene.add(under(points));
  let pI = 0;
  function splash(x, z, count = 16, power = 0.7, y = 0.03) {
    for (let k = 0; k < count; k++) {
      const i = pI++ % MAXP;
      const a = Math.random() * TAU;
      const h = (0.3 + Math.random() * 1.2) * power;
      pPos[i * 3] = x + Math.cos(a) * 0.05;
      pPos[i * 3 + 1] = y;
      pPos[i * 3 + 2] = z + Math.sin(a) * 0.05;
      pVel[i * 3] = Math.cos(a) * h * (0.8 + Math.random());
      pVel[i * 3 + 1] = (1.6 + Math.random() * 2.8) * power + 0.4;
      pVel[i * 3 + 2] = Math.sin(a) * h * (0.8 + Math.random());
      pLife[i] = 0.6 + Math.random() * 0.6;
      pSize[i] = 0.03 + Math.random() * 0.05 * (0.5 + power);
    }
  }

  // ---------- 물고기와 바닥 그림자 ----------
  const fishVis = new Map(); // fish id -> { g, sp }
  const fishPool = { lmb: [], smb: [], blg: [] };
  function fishFor(f) {
    let v = fishVis.get(f.id);
    if (v) return v;
    const pool = fishPool[f.sp];
    const g = pool.length ? pool.pop() : under(makeFish(f.sp));
    if (!g.parent) {
      g.traverse((m) => { if (m.isMesh) m.layers.set(L_UNDER); });
      scene.add(g);
    }
    g.visible = true;
    v = { g, sp: f.sp, seen: 0 };
    fishVis.set(f.id, v);
    return v;
  }
  const MAX_BLOBS = 48;
  const blobMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: fishShadowTexture() }, uWaterY: UW.uWaterY, uExt: UW.uExt, uPathMax: UW.uPathMax },
    vertexShader: `
      attribute float aAlpha;
      varying vec2 vUv;
      varying float vA;
      varying vec3 vW;
      void main() {
        vUv = uv;
        vA = aAlpha;
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform float uWaterY;
      uniform vec3 uExt;
      uniform float uPathMax;
      varying vec2 vUv;
      varying float vA;
      varying vec3 vW;
      ${UW_TRANSMIT_GLSL}
      void main() {
        float a = texture2D(uMap, vUv).a * vA * uwTransmit(vW);
        gl_FragColor = vec4(0.0, 0.03, 0.03, a);
      }`,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4
  });
  const blobGeo = new THREE.PlaneGeometry(1, 0.44).rotateX(-Math.PI / 2);
  const blobAlpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLOBS), 1);
  blobAlpha.setUsage(THREE.DynamicDrawUsage);
  blobGeo.setAttribute('aAlpha', blobAlpha);
  const blobs = new THREE.InstancedMesh(blobGeo, blobMat, MAX_BLOBS);
  blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  blobs.frustumCulled = false;
  blobs.renderOrder = 2;
  scene.add(under(blobs));
  // 물속에서 꺾인 햇빛이 바닥에 닿는 방향(스넬): 그림자는 해 반대쪽으로 높이 × 이만큼 밀립니다.
  const shadowOff = (() => {
    const sinA = Math.sqrt(1 - SUN.dir[1] * SUN.dir[1]);
    const sinW = sinA / 1.33;
    const tanW = sinW / Math.sqrt(1 - sinW * sinW);
    const hx = -SUN.dir[0];
    const hz = -SUN.dir[2];
    const l = Math.hypot(hx, hz) || 1;
    return { x: (hx / l) * tanW, z: (hz / l) * tanW };
  })();

  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const qc = new THREE.Quaternion();
  const AX = new THREE.Vector3(1, 0, 0);
  const AY = new THREE.Vector3(0, 1, 0);
  const AZ = new THREE.Vector3(0, 0, 1);
  const o3 = new THREE.Object3D();
  let frameNo = 0;
  function fishOrient(g, yaw, pitch, roll) {
    qa.setFromAxisAngle(AY, yaw - Math.PI / 2);
    qb.setFromAxisAngle(AZ, pitch);
    qc.setFromAxisAngle(AX, roll);
    g.quaternion.copy(qa).multiply(qb).multiply(qc);
  }
  function updateFish(list, fdt) {
    frameNo += 1;
    let nb = 0;
    for (const f of list) {
      const v = fishFor(f);
      v.seen = frameNo;
      const g = v.g;
      g.position.set(f.x, f.y, f.z);
      // 멀리 있는 물고기는 조금 키워 그립니다(가까이·들어 올리면 실제 크기). 같은 거리에서는 큰 놈이 그대로 커 보입니다.
      const dist = Math.hypot(f.x - EYE.x, f.z - EYE.z);
      const want = f.mode === 'landed' ? 1 : FISH_NEAR_SCALE + FISH_FAR_BOOST * clamp((dist - 3.5) / 11, 0, 1);
      f.vis = f.vis > 0 ? f.vis + (want - f.vis) * Math.min(1, fdt * 3) : want;
      const vl = f.len * f.vis;
      g.scale.setScalar(vl);
      fishOrient(g, f.yaw, f.pitch, f.roll);
      const U = g.userData.uniforms;
      U.uTime.value = f.phase;
      U.uFreq.value = 1;
      U.uAmp.value = f.tailAmp;
      U.uCurl.value = f.curl + (f.thrash ? Math.sin(f.phase * 0.9) * 0.28 * f.thrash : 0);
      // 바닥 그림자
      if (nb < MAX_BLOBS && f.mode !== 'landed') {
        let bx = f.x;
        let bz = f.z;
        let bed = -bedDepth(bx, bz);
        const h = Math.max(0, f.y - bed);
        bx += shadowOff.x * h;
        bz += shadowOff.z * h;
        bed = -bedDepth(bx, bz);
        o3.position.set(bx, bed + 0.025, bz);
        o3.rotation.set(0, f.yaw - Math.PI / 2, 0);
        const sx = vl * (1.15 + h * 0.3);
        o3.scale.set(sx, 1, vl * (1.25 + h * 0.5));
        o3.updateMatrix();
        blobs.setMatrixAt(nb, o3.matrix);
        blobAlpha.array[nb] = clamp(0.78 - h * 0.14, 0.24, 0.78);
        nb += 1;
      }
    }
    blobs.count = nb;
    blobs.instanceMatrix.needsUpdate = true;
    blobAlpha.needsUpdate = true;
    for (const [id, v] of fishVis) {
      if (v.seen === frameNo) continue;
      v.g.visible = false;
      fishPool[v.sp].push(v.g);
      fishVis.delete(id);
    }
  }

  // ---------- 사람별 장비 ----------
  const rigs = new Map(); // slot -> rig
  const lineMats = [];
  let lanes = new Map(); // slot -> { ndc, hand: Vector3 }
  function newLine() {
    const geo = new LineGeometry();
    geo.setPositions(new Array(LINE_PTS * 3).fill(0));
    const mat = new LineMaterial({ color: '#f4f1ea', linewidth: 1.6, transparent: true, opacity: 0.9, worldUnits: false });
    mat.resolution.set(window.innerWidth, window.innerHeight);
    lineMats.push(mat);
    const l = new Line2(geo, mat);
    l.frustumCulled = false;
    l.renderOrder = 9;
    return under(l);
  }
  // 조준선: 물 위에 그 사람 색 점선 + 던질 수 있는 거리 띠
  const AIM_N = 48;
  function newAim(color) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array((AIM_N + 1) * 2 * 3);
    const dd = new Float32Array((AIM_N + 1) * 2);
    const ss = new Float32Array((AIM_N + 1) * 2);
    const idx = [];
    for (let i = 0; i <= AIM_N; i++) {
      ss[i * 2] = -1;
      ss[i * 2 + 1] = 1;
      if (i < AIM_N) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aD', new THREE.BufferAttribute(dd, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aS', new THREE.BufferAttribute(ss, 1));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uMin: { value: CAST_MIN }, uMax: { value: CAST_MAX }, uEnd: { value: CAST_MAX }, uTime: { value: 0 }, uOp: { value: 0 } },
      vertexShader: `attribute float aD; attribute float aS; varying float vD; varying float vS;
        void main() { vD = aD; vS = aS; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uMin; uniform float uMax; uniform float uEnd; uniform float uTime; uniform float uOp;
        varying float vD; varying float vS;
        void main() {
          float s = abs(vS);
          // 동글동글한 점선(천천히 바깥으로 흐름). 멀수록 점이 크고 성깁니다.
          float w = 0.1 + 0.024 * vD;
          float period = 0.5 + 0.035 * vD;
          float along = (fract((vD - uTime * 0.9) / period) - 0.5) * period;
          float rad = 0.04 + 0.0065 * vD;
          float dots = 1.0 - smoothstep(rad * 0.6, rad, length(vec2(along, vS * w)));
          // 던져서 닿을 수 있는 거리(살짝 ~ 힘껏) 띠. 선착장 바로 앞(uMin)부터 물가 앞(uEnd)까지
          float band = smoothstep(uMin - 0.5, uMin + 0.4, vD) * (1.0 - smoothstep(uEnd - 1.2, uEnd, vD));
          float glow = band * pow(max(0.0, 1.0 - s), 1.2) * (0.18 + 0.12 * smoothstep(uMin, uMax, vD));
          float edges = band * smoothstep(0.76, 0.93, s) * (1.0 - smoothstep(0.93, 1.0, s)) * 0.32;
          // 5m 마다 가로 눈금(얼마나 세게 던질지 가늠). 가운데 점선은 비워 둡니다.
          float m5 = abs(mod(vD + 2.5, 5.0) - 2.5);
          float tick = band * (1.0 - smoothstep(0.035, 0.07 + 0.005 * vD, m5)) * smoothstep(0.22, 0.5, s) * step(4.0, vD) * 0.5;
          // 살짝 던지면 떨어지는 가까운 물(선착장 바로 앞)은 조금 밝게
          float nearZ = band * (1.0 - smoothstep(4.6, 6.4, vD)) * pow(max(0.0, 1.0 - s), 0.7) * 0.16;
          float near = smoothstep(0.6, 2.2, vD);
          float a = (dots * 0.7 + glow + edges + tick + nearZ) * near * uOp;
          if (a < 0.003) discard;
          gl_FragColor = vec4(mix(uColor, vec3(1.0), dots * 0.3), a);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = 6;
    return under(m);
  }
  function makeLeader() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage));
    const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#e8f4f0', transparent: true, opacity: 0.35 }));
    l.frustumCulled = false;
    l.renderOrder = 4;
    return under(l);
  }
  function disposeObj(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const m = o.material;
      if (m) for (const x of Array.isArray(m) ? m : [m]) {
        if (x.userData && x.userData.shared) continue;
        if (x.map && x.map !== ringTex) x.map.dispose();
        x.dispose();
      }
    });
  }
  // 들어오고 나갈 때마다 장비를 새로 만들고 지우면(예전 방식) 지울 때 셰이더 프로그램도 같이 내려가서,
  // 다음 사람이 들어올 때 반사용 프로그램을 다시 컴파일합니다. 느린 PC·TV 에서는 그때마다 화면이 멈칫했습니다.
  // 그래서 자리 4개 분을 처음에 다 만들어 두고(반사용까지 미리 컴파일) 보이기/숨기기만 합니다.
  const POOL = [
    { slot: 1, color: '#ff5a5f', name: '1P' }, { slot: 2, color: '#3ab4ff', name: '2P' },
    { slot: 3, color: '#ffc93c', name: '3P' }, { slot: 4, color: '#5ee07a', name: '4P' }
  ];
  function makeRig(p) {
    const rod = makeRod(p.color);
    scene.add(rod.root);
    const line = newLine();
    scene.add(line);
    const bobber = makeBobber(p.color);
    scene.add(bobber);
    const bait = under(makeBait());
    bait.traverse((m) => m.layers.set(L_UNDER));
    scene.add(bait);
    const leader = makeLeader();
    scene.add(leader);
    const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture(p.color, p.name), depthTest: false, transparent: true, sizeAttenuation: false, fog: false }));
    marker.center.set(0.5, 0);
    marker.renderOrder = 20;
    scene.add(under(marker));
    const aim = newAim(p.color);
    scene.add(aim);
    const R = {
      slot: p.slot, color: p.color, name: p.name, rod, line, bobber, bait, leader, marker, aim, on: true,
      pend: { p: new THREE.Vector3(), v: new THREE.Vector3(), init: false, mode: null },
      aimOp: 0, hasTip: false, bobVis: false, end: new THREE.Vector3(), bobP: new THREE.Vector3()
    };
    setRigOn(R, false);
    return R;
  }
  function rigParts(R) {
    return [R.rod.root, R.line, R.bobber, R.bait, R.leader, R.marker, R.aim];
  }
  function setRigOn(R, on) {
    R.on = on;
    for (const o of rigParts(R)) o.visible = on;
    if (!on) {
      // 다음 사람이 처음부터 시작하게 비웁니다.
      R.pend.init = false;
      R.aimOp = 0;
      R.hasTip = false;
      R.bobVis = false;
      R.bobber.visible = false;
      R.bait.visible = false;
      R.leader.visible = false;
      R.marker.visible = false;
      R.aim.visible = false;
    }
  }
  function dropRig(R) {
    for (const o of rigParts(R)) scene.remove(o);
    R.rod.dispose();
    for (const o of [R.line, R.bobber, R.bait, R.leader, R.marker, R.aim]) disposeObj(o);
    const li = lineMats.indexOf(R.line.material);
    if (li >= 0) lineMats.splice(li, 1);
  }
  for (const p of POOL) rigs.set(p.slot, makeRig(p));
  const poolStats = { made: POOL.length, rebuilt: 0 };
  function setPlayers(list) {
    const want = new Map(list.map((p) => [p.slot, p]));
    for (const [slot, R] of rigs) {
      const p = want.get(slot);
      if (!p) {
        if (R.on) setRigOn(R, false);
        continue;
      }
      if (p.color !== R.color || (p.name && p.name !== R.name)) {
        // 자리 색이 바뀌는 일은 없지만(서버가 정함), 혹시 바뀌면 그 자리 장비만 새로 만듭니다.
        // 다른 자리 장비가 같은 프로그램을 쓰고 있어 다시 컴파일하지 않습니다.
        dropRig(R);
        const N = makeRig({ slot, color: p.color, name: p.name || R.name });
        rigs.set(slot, N);
        poolStats.rebuilt += 1;
        setRigOn(N, true);
      } else if (!R.on) setRigOn(R, true);
    }
    // 4자리 밖(있을 수 없지만)은 새로 만듭니다.
    for (const [slot, p] of want) {
      if (rigs.has(slot)) continue;
      const N = makeRig(p);
      rigs.set(slot, N);
      poolStats.rebuilt += 1;
      setRigOn(N, true);
    }
    layoutLanes();
  }

  // 낚싯대 자리: 화면 가로 비율 → 손(릴) 위치. 화면 아래 가장자리 조금 위에 릴이 보이게 둡니다.
  const HAND_UP = 0.62; // 눈보다 아래(m)
  const HAND_FWD = 0.85; // 눈보다 앞(m)
  function layoutLanes() {
    const slots = [...rigs.values()].filter((R) => R.on).map((R) => R.slot).sort((a, b) => a - b);
    const fr = laneFracs(slots.length);
    const tanH = Math.tan((EYE.fov / 2) * RD) * baseCam.aspect;
    const depth = HAND_FWD * Math.cos(EYE.pitch * RD) + HAND_UP * Math.sin(EYE.pitch * RD);
    const next = new Map();
    slots.forEach((slot, i) => {
      const ndc = fr[i] * 2 - 1;
      const x = -ndc * depth * tanH * 0.96;
      const prev = lanes.get(slot);
      const hand = prev ? prev.hand : new THREE.Vector3(x, EYE.y - HAND_UP, EYE.z + HAND_FWD);
      next.set(slot, { ndc, x, hand, lean: ndc * 20 });
    });
    lanes = next;
  }
  function laneOf(slot) {
    return lanes.get(slot) || null;
  }
  // 판정용 초릿대 끝(흔들림 없는 정면 자세): [x, z]
  function nominalTip(slot) {
    const L = lanes.get(slot);
    const x = L ? L.x : 0;
    const e = 22 * RD;
    return [x - Math.sin((L ? L.lean : 0) * RD) * 1.85 * Math.cos(e), EYE.z + HAND_FWD + 1.85 * Math.cos(e)];
  }

  // ---------- 쇼케이스(조과 카드 안의 물고기) ----------
  const show = new THREE.Scene();
  show.background = skyGradTex;
  show.environment = env;
  show.environmentIntensity = 0.9;
  const showCam = new THREE.PerspectiveCamera(26, 1.9, 0.05, 20);
  showCam.position.set(0, 10.08, 1.55);
  showCam.lookAt(0, 10, 0);
  {
    const key = new THREE.DirectionalLight('#fff0dc', 3.2);
    key.position.set(1.5, 12, 2.2);
    const rim = new THREE.DirectionalLight('#9fd0ff', 2.6);
    rim.position.set(-2, 11.2, -2);
    show.add(key, rim, new THREE.HemisphereLight('#d8ecff', '#2a3a30', 0.9));
    const disk = new THREE.Mesh(new THREE.CircleGeometry(0.7, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
    disk.position.y = 9.8;
    disk.scale.set(1.2, 1, 0.5);
    show.add(disk);
  }
  const showFish = {};
  for (const sp of ['lmb', 'smb', 'blg']) {
    showFish[sp] = makeFish(sp);
    show.add(showFish[sp]);
  }
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

  // ---------- 크기 ----------
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    baseCam.aspect = w / h;
    baseCam.updateProjectionMatrix();
    for (const m of lineMats) m.resolution.set(w, h);
    pMat.uniforms.uScale.value = h * 0.9;
    const pr = renderer.getPixelRatio();
    water.getRenderTarget().setSize(Math.round(w * pr * 0.5), Math.round(h * pr * 0.5));
    layoutLanes();
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- 수면 높이(찌 출렁임) ----------
  const waveY = (x, z, t) => 0.01 * Math.sin(x * 0.9 + t * 1.3) + 0.008 * Math.sin(z * 1.1 - t * 1.05 + x * 0.3) + 0.004 * Math.sin((x + z) * 2.3 + t * 2.2);

  // ---------- 시야 ----------
  const frustum = new THREE.Frustum();
  const projM = new THREE.Matrix4();
  const sph = new THREE.Sphere();
  function updateFrustum() {
    baseCam.updateMatrixWorld();
    projM.multiplyMatrices(baseCam.projectionMatrix, baseCam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projM);
  }
  updateFrustum();
  function inView(x, y, z, r = 0) {
    sph.center.set(x, y, z);
    sph.radius = r;
    return frustum.intersectsSphere(sph);
  }

  // ---------- 장비 그리기 ----------
  const tv = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), mid: new THREE.Vector3(), dir: new THREE.Vector3(), pull: new THREE.Vector3() };
  const pts = Array.from({ length: LINE_PTS }, () => new THREE.Vector3());
  function updateRig(R, d, t, dt) {
    const L = lanes.get(R.slot);
    if (!L) return;
    // 손은 자리 사이를 부드럽게 옮겨 갑니다(사람이 들어오고 나갈 때).
    tv.a.set(L.x, EYE.y - HAND_UP, EYE.z + HAND_FWD);
    L.hand.lerp(tv.a, Math.min(1, dt * 4));
    const e = d.elev * RD;
    const y = (d.yawV != null ? d.yawV : d.yaw + L.lean) * RD;
    tv.dir.set(-Math.sin(y) * Math.cos(e), Math.sin(e), Math.cos(y) * Math.cos(e));
    const lure = d.lure;
    let pullTo = null;
    if (d.pull) pullTo = tv.pull.set(d.pull[0], d.pull[1], d.pull[2]);
    R.rod.pose(L.hand, tv.dir, d.bend || 0, pullTo, d.spin || 0);
    const st = R.rod.st;
    const tip = st.tip;
    R.hasTip = true;

    // 찌·미끼
    let bobVis = false;
    let end = null;
    const pend = R.pend;
    let baitAt = null;
    const B = R.bobber;
    if (lure && lure.mode === 'hang' && lure.mouth) {
      // 들어 올린 물고기: 줄은 초릿대에서 물고기 입으로 곧게(찌는 숨김)
      pend.init = false;
      end = R.end.set(lure.mouth[0], lure.mouth[1], lure.mouth[2]);
    } else if (lure && (lure.mode === 'tip' || lure.mode === 'hang')) {
      const hangLen = lure.mode === 'hang' ? 0.25 : 0.42;
      tv.b.copy(tip);
      tv.b.y -= hangLen;
      if (!pend.init || pend.mode !== lure.mode) {
        pend.p.copy(tv.b);
        pend.v.set(0, 0, 0);
        pend.init = true;
        pend.mode = lure.mode;
      }
      tv.c.subVectors(tv.b, pend.p).multiplyScalar(70).addScaledVector(pend.v, -7);
      pend.v.addScaledVector(tv.c, dt);
      pend.p.addScaledVector(pend.v, dt);
      tv.c.subVectors(pend.p, tip);
      if (tv.c.length() > hangLen) pend.p.copy(tip).addScaledVector(tv.c.normalize(), hangLen);
      B.position.copy(pend.p);
      B.position.y -= 0.05;
      B.scale.setScalar(1);
      B.rotation.set(0, 0, 0);
      bobVis = lure.mode === 'tip';
      end = R.end.copy(pend.p);
      if (lure.mode === 'tip') {
        baitAt = tv.d.copy(pend.p);
        baitAt.y -= 0.32;
      }
    } else if (lure && lure.mode === 'fly') {
      pend.init = false;
      B.position.set(lure.p[0], lure.p[1], lure.p[2]);
      const k = clamp(camera.position.distanceTo(B.position) / 9, 1, 3);
      B.scale.setScalar(k);
      B.rotation.set(0.5, 0, 0.3);
      bobVis = true;
      end = R.end.copy(B.position);
      baitAt = tv.d.copy(B.position);
      baitAt.y -= 0.25;
    } else if (lure && (lure.mode === 'float' || lure.mode === 'fish')) {
      pend.init = false;
      const px = lure.p[0];
      const pz = lure.p[2];
      const k = clamp(camera.position.distanceTo(tv.a.set(px, 0, pz)) / 8, 1.15, 3.4);
      const R0 = 0.042 * k;
      const sink = lure.under || 0;
      let py = waveY(px, pz, t) + R0 * 0.32 - sink * R0 * 2.4;
      if (sink > 1.2) py -= 0.25 * k;
      const tx = Math.sin(t * 1.7 + px) * 0.07 + (lure.skate ? Math.sin(t * 13) * 0.14 * lure.skate : 0) + (lure.tilt || 0);
      const tz = Math.cos(t * 1.3 + pz) * 0.07;
      B.position.set(px, py, pz);
      B.scale.setScalar(k);
      B.rotation.set(tx, 0, tz);
      bobVis = sink < 1.25;
      end = R.end.set(px, py + R0 * 1.1, pz);
      if (lure.bait) baitAt = tv.d.set(lure.bait[0], lure.bait[1], lure.bait[2]);
      else {
        baitAt = tv.d.set(px + Math.sin(t * 0.7 + pz) * 0.04, -BAIT_DEPTH, pz + Math.cos(t * 0.6) * 0.04);
      }
    } else pend.init = false;
    B.visible = bobVis;
    R.bobVis = bobVis;
    R.bobP.copy(B.position);

    // 미끼와 목줄(찌 → 미끼)
    if (baitAt && lure && lure.mode !== 'hang' && !lure.mouth) {
      R.bait.visible = true;
      R.bait.position.copy(baitAt);
      R.bait.rotation.set(Math.sin(t * 2.1) * 0.3, t * 0.5, 0);
      R.leader.visible = true;
      const a = R.leader.geometry.attributes.position.array;
      a[0] = B.position.x;
      a[1] = B.position.y - 0.04 * B.scale.x;
      a[2] = B.position.z;
      a[3] = baitAt.x;
      a[4] = baitAt.y;
      a[5] = baitAt.z;
      R.leader.geometry.attributes.position.needsUpdate = true;
    } else {
      R.bait.visible = false;
      R.leader.visible = false;
    }

    // 찌 위 표시
    const showMarker = bobVis && lure && !lure.hideMarker && (lure.mode === 'float' || lure.mode === 'fly' || lure.mode === 'fish');
    R.marker.visible = Boolean(showMarker || (lure && lure.mode === 'float' && lure.under > 1.2 && !lure.hideMarker));
    if (R.marker.visible) {
      const dist = camera.position.distanceTo(B.position);
      R.marker.position.set(B.position.x, Math.max(B.position.y, 0) + 0.32 + dist * 0.018, B.position.z);
      const pulse = lure.alert ? 1 + 0.25 * Math.abs(Math.sin(t * 9)) : 1;
      R.marker.scale.set(0.034 * pulse, 0.0425 * pulse, 1);
    }

    // 줄: 스풀 → 가이드 → 초릿대 → (늘어진 곡선) → 찌 → (물고기 입)
    let n = 0;
    pts[n++].copy(st.spoolW);
    for (const g of st.guideP) pts[n++].copy(g);
    pts[n++].copy(tip);
    const mouth = lure && lure.mouth && lure.mode !== 'hang' ? tv.c.set(lure.mouth[0], lure.mouth[1], lure.mouth[2]) : null;
    const tail = mouth ? 3 : 0;
    const rest = LINE_PTS - n - tail;
    if (end) {
      const len = tip.distanceTo(end);
      const slack = clamp(d.slack == null ? 0.5 : d.slack, 0, 1);
      tv.mid.addVectors(tip, end).multiplyScalar(0.5);
      tv.mid.y -= slack * (0.03 + len * 0.055) + 0.004 * len;
      for (let i = 1; i <= rest; i++) {
        const u = i / rest;
        const a = (1 - u) * (1 - u);
        const bb = 2 * (1 - u) * u;
        const c = u * u;
        const p = pts[n++];
        p.set(tip.x * a + tv.mid.x * bb + end.x * c, tip.y * a + tv.mid.y * bb + end.y * c, tip.z * a + tv.mid.z * bb + end.z * c);
        if (p.y < 0.005 && lure && lure.mode !== 'tip' && lure.mode !== 'hang') p.y = 0.005;
      }
      if (mouth) for (let i = 1; i <= tail; i++) pts[n++].lerpVectors(end, mouth, i / tail);
    } else {
      // 끊어진 줄: 초릿대에서 조금 늘어진 끝
      for (let i = 1; i <= rest + tail; i++) {
        pts[n].copy(tip);
        pts[n].y -= 0.3 * (i / (rest + tail));
        pts[n].x += Math.sin(t * 2 + i) * 0.01;
        n += 1;
      }
    }
    const arr = R.line.geometry.attributes.instanceStart.data.array;
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

    // 조준선
    const aimOn = Boolean(d.aim && d.aim.on);
    R.aimOp += ((aimOn ? 1 : 0) - R.aimOp) * Math.min(1, dt * 6);
    R.aim.visible = R.aimOp > 0.01;
    if (R.aim.visible && d.aim) {
      const U = R.aim.material.uniforms;
      U.uOp.value = R.aimOp;
      U.uTime.value = t;
      U.uEnd.value = d.aim.end;
      const ay = d.aim.yaw * RD;
      const dx = -Math.sin(ay);
      const dz = Math.cos(ay);
      const ox = d.aim.x;
      const oz = d.aim.z;
      const pos = R.aim.geometry.attributes.position.array;
      const dd = R.aim.geometry.attributes.aD.array;
      const start = 0.4;
      for (let i = 0; i <= AIM_N; i++) {
        const dist = start + (d.aim.end - start) * (i / AIM_N);
        const w = 0.1 + 0.024 * dist;
        const cx = ox + dx * dist;
        const cz = oz + dz * dist;
        const k = i * 6;
        pos[k] = cx - dz * w;
        pos[k + 1] = 0.02;
        pos[k + 2] = cz + dx * w;
        pos[k + 3] = cx + dz * w;
        pos[k + 4] = 0.02;
        pos[k + 5] = cz - dx * w;
        dd[i * 2] = dist;
        dd[i * 2 + 1] = dist;
      }
      R.aim.geometry.attributes.position.needsUpdate = true;
      R.aim.geometry.attributes.aD.needsUpdate = true;
    }
  }

  // 낚싯대가 서로 엇갈리지 않게: 여럿일 때는 좌우로 겨누는 각도를 줄여 그리고(조준선은 실제 방향 그대로),
  // 그래도 초릿대 순서가 뒤집히면 이웃끼리 조금씩 벌립니다.
  const fanList = [];
  function fanRods(players) {
    fanList.length = 0;
    for (const d of players) if (lanes.has(d.slot)) fanList.push(d);
    fanList.sort((a, b) => lanes.get(a.slot).ndc - lanes.get(b.slot).ndc);
    const n = fanList.length;
    const k = n <= 1 ? 1 : n === 2 ? 0.65 : 0.5;
    for (const d of fanList) d.yawV = lanes.get(d.slot).lean + d.yaw * k;
    if (n < 2) return;
    const tipX = (d) => lanes.get(d.slot).x - Math.sin(d.yawV * RD) * 1.85 * Math.cos(d.elev * RD);
    const gap = 0.32;
    for (let it = 0; it < 3; it++) {
      for (let i = 1; i < n; i++) {
        const a = fanList[i - 1];
        const b = fanList[i];
        const over = tipX(b) - (tipX(a) - gap);
        if (over <= 0) continue;
        // 화면 왼쪽(세계 +x)이 a. b 는 오른쪽으로, a 는 왼쪽으로 반씩 비킵니다.
        for (const [d, s] of [[b, 1], [a, -1]]) {
          const ce = Math.cos(d.elev * RD);
          if (ce < 0.3) continue;
          const dy = Math.asin(clamp((over / 2) / (1.85 * ce), -0.5, 0.5)) / RD;
          d.yawV += s * dy;
        }
      }
    }
  }

  // ---------- 매 프레임 ----------
  function frame(now, dt, v) {
    const t = now / 1000;
    wU.uTime.value += dt;
    UW.uTime.value += dt;
    windU.uTime.value = t;
    // 숨 쉬듯 아주 조금 흔들리는 시선
    camera.position.set(EYE.x + Math.sin(t * 0.23) * 0.006, EYE.y + Math.sin(t * 0.85) * 0.005, EYE.z);
    camera.rotation.set(-EYE.pitch * RD + Math.sin(t * 0.85 + 0.6) * 0.0022 + Math.sin(t * 0.31) * 0.0015, Math.PI + Math.sin(t * 0.27) * 0.0024, Math.sin(t * 0.19) * 0.0012);
    camera.updateMatrixWorld();

    if (v.fish) updateFish(v.fish, dt);
    fanRods(v.players);
    for (const d of v.players) {
      const R = rigs.get(d.slot);
      if (R && R.on) updateRig(R, d, t, dt);
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
      r.m.material.opacity = (1 - u) * (1 - u) * 0.8 * r.str;
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
    renderer.render(scene, camera);

    // 조과 카드 안의 물고기
    if (v.inset && showcase) {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const r = v.inset;
      const fish = showFish[showcase.species];
      const u = (now - showT0) / 1000;
      fish.position.set(0, 10 + Math.sin(u * 1.6) * 0.012, 0);
      fish.scale.setScalar(0.62);
      fish.rotation.set(0, Math.sin(u * 0.7) * 0.5 - 0.25, Math.sin(u * 1.1) * 0.05);
      const U = fish.userData.uniforms;
      U.uTime.value = u * 6;
      U.uAmp.value = 0.035;
      U.uFreq.value = 1;
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

  const pv = new THREE.Vector3();
  function project(x, y, z) {
    pv.set(x, y, z).project(camera);
    return { x: (pv.x * 0.5 + 0.5) * window.innerWidth, y: (-pv.y * 0.5 + 0.5) * window.innerHeight, on: pv.z < 1 && pv.z > -1 };
  }
  function tipOf(slot) {
    const R = rigs.get(slot);
    if (!R || !R.on || !R.hasTip) return null;
    const t = R.rod.st.tip;
    return [t.x, t.y, t.z];
  }
  function reelOf(slot) {
    const R = rigs.get(slot);
    if (!R || !R.on || !R.hasTip) return null;
    const p = R.rod.st.spoolW;
    return [p.x, p.y, p.z];
  }
  function bobberPos(slot) {
    const R = rigs.get(slot);
    if (!R || !R.on || !R.bobVis) return null;
    return [R.bobP.x, R.bobP.y, R.bobP.z];
  }
  // 이 방향으로 던질 수 있는 가장 먼 거리(물가에 닿기 전)
  function reachAlong(x, z, yawDeg) {
    const a = yawDeg * RD;
    const dx = -Math.sin(a);
    const dz = Math.cos(a);
    let end = CAST_MAX;
    for (let dd = CAST_MIN; dd <= CAST_MAX; dd += 0.5) {
      const px = x + dx * dd;
      const pz = z + dz * dd;
      if (lakeQ(px, pz) >= 0.86 || bedDepth(px, pz) <= 0.8) {
        end = dd - 0.5;
        break;
      }
    }
    return Math.max(CAST_MIN, end);
  }

  // 셰이더를 미리 컴파일해 둡니다(첫 사람이 들어오거나 첫 조과 카드가 뜰 때 화면이 멈칫하지 않게).
  // 미리 만든 4벌의 장비는 숨겨 둔 채로도 컴파일됩니다(compile 은 숨긴 물체도 훑음). 물고기도 종마다 한 마리씩 미리 둡니다.
  // 수면 반사는 다른 출력(렌더 타깃: 톤매핑 없음·선형 색)으로 그려서 프로그램이 따로 있습니다.
  // 예전에는 화면용만 미리 만들어, 처음 들어온 사람의 낚싯대·찌가 반사에 비칠 때 그 자리에서 컴파일했습니다.
  {
    for (const sp of ['lmb', 'smb', 'blg']) {
      const g = under(makeFish(sp));
      g.traverse((m) => { if (m.isMesh) m.layers.set(L_UNDER); });
      g.visible = false;
      scene.add(g);
      fishPool[sp].push(g);
    }
    for (const k of Object.keys(showFish)) showFish[k].visible = true;
    renderer.compile(scene, camera);
    renderer.compile(show, showCam);
    for (const k of Object.keys(showFish)) showFish[k].visible = false;
    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(water.getRenderTarget());
    for (const R of rigs.values()) {
      renderer.compile(R.rod.root, camera, scene);
      renderer.compile(R.bobber, camera, scene);
    }
    renderer.setRenderTarget(prevRT);
    // 사람 이름표(찌 위 핀) 텍스처도 미리 GPU 에 올려 둡니다.
    for (const R of rigs.values()) if (R.marker.material.map) renderer.initTexture(R.marker.material.map);
  }

  return {
    frame, setPlayers, ripple, splash, project, tipOf, reelOf, bobberPos, setShowcase, inView, laneOf, nominalTip, reachAlong,
    renderer, camera, scene, AREA,
    get pool() { return { ...poolStats, on: [...rigs.values()].filter((R) => R.on).map((R) => R.slot) }; }
  };
}
