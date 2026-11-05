// 테니스 3D 모델: 하드 코트(선 표시), 네트, 경기장(벽·광고 없는 보드·관중석·조명탑·심판석·벤치·전광판),
// 선수(캡슐 + IK 리그, 셔츠는 선수 색), 라켓, 공(보송한 노란 공 + 솔기), 그림자, 꼬리.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COURT, BALL_R, netH } from './physics.js';
import { HAND_TO_HEAD } from './motion.js';

const Y = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const BALL_VIS = BALL_R * 1.7; // 중계 화면에서 잘 보이게 조금 키워 그립니다

// ---------- 텍스처 도우미 ----------
export function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}
export function tex(c, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function hash(x, y, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const std = (color, roughness = 0.6, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
export function shade(hex, k) {
  const c = new THREE.Color(hex);
  if (k >= 0) c.lerp(new THREE.Color('#ffffff'), k);
  else c.lerp(new THREE.Color('#000000'), -k);
  return `#${c.getHexString()}`;
}

export const glowTex = tex(canvas(128, 128, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,255,255,.55)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, w, h);
}));
const blobTex = tex(canvas(128, 128, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, 'rgba(0,0,0,.6)');
  r.addColorStop(0.5, 'rgba(0,0,0,.3)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, w, h);
}));

// 작은 잡음 타일(아크릴 코트 표면의 미세한 알갱이)로 노멀맵을 만듭니다.
function grainNormal(size, strength, seed) {
  const hgt = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) hgt[j * size + i] = hash(i, j, seed);
  // 살짝 흐리게
  const blur = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let s = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) s += hgt[((j + dj + size) % size) * size + ((i + di + size) % size)];
      blur[j * size + i] = s / 9;
    }
  }
  const c = canvas(size, size, (g) => {
    const img = g.createImageData(size, size);
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const h = (x, y) => blur[((y + size) % size) * size + ((x + size) % size)];
        const dx = (h(i + 1, j) - h(i - 1, j)) * strength;
        const dy = (h(i, j + 1) - h(i, j - 1)) * strength;
        const l = Math.hypot(dx, dy, 1);
        const k = (j * size + i) * 4;
        img.data[k] = ((-dx / l) * 0.5 + 0.5) * 255;
        img.data[k + 1] = ((dy / l) * 0.5 + 0.5) * 255;
        img.data[k + 2] = ((1 / l) * 0.5 + 0.5) * 255;
        img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
  return tex(c, false, true);
}

// ================================================================
// 코트
// ================================================================
const PX = 100; // 1m = 100px
export const GROUND = { w: 20.48, l: 40.96 }; // 옆벽~옆벽, 뒷벽~뒷벽

function paintCourt() {
  const W = Math.round(GROUND.w * PX);
  const H = Math.round(GROUND.l * PX);
  return canvas(W, H, (g) => {
    const X = (x) => (x + GROUND.w / 2) * PX;
    const Z = (z) => (z + GROUND.l / 2) * PX;
    // 바깥(초록)
    const out = g.createLinearGradient(0, 0, W, 0);
    out.addColorStop(0, '#3b6f49');
    out.addColorStop(0.5, '#437a51');
    out.addColorStop(1, '#3b6f49');
    g.fillStyle = out;
    g.fillRect(0, 0, W, H);
    // 안쪽(파랑): 복식 사이드라인 바깥 가장자리까지
    const hwD = COURT.halfWD;
    const hl = COURT.halfL;
    const inG = g.createLinearGradient(X(-hwD), 0, X(hwD), 0);
    inG.addColorStop(0, '#2c5a93');
    inG.addColorStop(0.5, '#3163a0');
    inG.addColorStop(1, '#2c5a93');
    g.fillStyle = inG;
    g.fillRect(X(-hwD), Z(-hl), hwD * 2 * PX, hl * 2 * PX);
    // 잔 알갱이와 롤러 자국
    const r = rng(7);
    for (let i = 0; i < 26000; i++) {
      const x = r() * W;
      const y = r() * H;
      const a = 0.025 + r() * 0.05;
      g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
      g.fillRect(x, y, 1 + r() * 2, 1 + r() * 2);
    }
    g.globalAlpha = 0.014;
    for (let i = 0; i < 70; i++) {
      g.fillStyle = r() < 0.5 ? '#ffffff' : '#000000';
      g.fillRect(r() * W, 0, 18 + r() * 60, H);
    }
    g.globalAlpha = 1;
    // 많이 밟는 곳(베이스라인 뒤 가운데)은 조금 밝게 닳았습니다.
    for (const z of [hl + 1.0, -hl - 1.0]) {
      const gr = g.createRadialGradient(X(0), Z(z), 0, X(0), Z(z), 3.4 * PX);
      gr.addColorStop(0, 'rgba(255,255,255,0.07)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(X(-5), Z(z - 4), 10 * PX, 8 * PX);
    }
    // 선(바깥 가장자리가 코트 경계): 사이드·서비스 5cm, 베이스라인 10cm
    g.fillStyle = '#f4f6f2';
    const lw = 0.05 * PX;
    const bw = 0.1 * PX;
    const vline = (x, z0, z1, w = lw) => g.fillRect(X(x) - (x > 0 ? w : x < 0 ? 0 : w / 2), Z(z0), w, (z1 - z0) * PX);
    const hline = (z, x0, x1, w = lw) => g.fillRect(X(x0), Z(z) - (z > 0 ? w : 0), (x1 - x0) * PX, w);
    for (const s of [-1, 1]) {
      vline(s * COURT.halfWD, -hl, hl);
      vline(s * COURT.halfWS, -hl, hl);
      hline(s * hl, -hwD, hwD, bw);
      // 서비스 라인(바깥 가장자리가 6.40m)
      const sz = s * COURT.svc;
      g.fillRect(X(-COURT.halfWS), Z(sz) - (s > 0 ? lw : 0), COURT.halfWS * 2 * PX, lw);
      // 센터 마크(베이스라인에서 안쪽으로 10cm)
      g.fillRect(X(0) - lw / 2, s > 0 ? Z(hl) - bw - 0.1 * PX : Z(-hl) + bw, lw, 0.1 * PX);
    }
    // 센터 서비스 라인
    g.fillRect(X(0) - lw / 2, Z(-COURT.svc), lw, COURT.svc * 2 * PX);
    // 베이스라인 뒤 대회 표시(광고 없음)
    g.save();
    g.fillStyle = 'rgba(255,255,255,0.13)';
    g.font = `400 ${Math.round(1.25 * PX)}px Anton, Impact, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const s of [-1, 1]) {
      g.save();
      g.translate(X(0), Z(s * (hl + 4.6)));
      g.fillText('PCG OPEN', 0, 0);
      g.restore();
    }
    g.restore();
  });
}

export function makeCourt() {
  const group = new THREE.Group();
  const map = tex(paintCourt());
  map.anisotropy = 16;
  const normalMap = grainNormal(256, 2.2, 3);
  normalMap.repeat.set(GROUND.w / 2.5, GROUND.l / 2.5);
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.82, metalness: 0, normalMap, normalScale: new THREE.Vector2(0.35, 0.35) });
  const geo = new THREE.PlaneGeometry(GROUND.w, GROUND.l, 1, 1).rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(geo, mat);
  ground.receiveShadow = true;
  group.add(ground);
  return group;
}

// ================================================================
// 네트
// ================================================================
const netTex = (() => {
  const t = tex(canvas(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(24,26,28,0.95)';
    g.lineWidth = 5;
    g.strokeRect(0, 0, w, h);
    // 매듭
    g.fillStyle = 'rgba(14,16,18,1)';
    for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      g.beginPath();
      g.arc(x, y, 4.5, 0, Math.PI * 2);
      g.fill();
    }
  }), true, true);
  return t;
})();

export function makeNet() {
  const group = new THREE.Group();
  const span = COURT.postX + 0.03;
  // 그물: 위 가장자리가 네트 높이 곡선을 따라가는 띠
  const seg = 80;
  const pos = [];
  const uv = [];
  const idx = [];
  const cell = 0.045;
  for (let i = 0; i <= seg; i++) {
    const x = -span + (2 * span * i) / seg;
    const top = netH(x) - 0.035;
    pos.push(x, 0.03, 0, x, top, 0);
    uv.push((x + span) / cell, 0.03 / cell, (x + span) / cell, top / cell);
    if (i < seg) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const ngeo = new THREE.BufferGeometry();
  ngeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  ngeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  ngeo.setIndex(idx);
  ngeo.computeVertexNormals();
  const mesh = new THREE.Mesh(ngeo, new THREE.MeshStandardMaterial({
    map: netTex, transparent: true, side: THREE.DoubleSide, roughness: 0.9, depthWrite: false, alphaTest: 0.02
  }));
  mesh.renderOrder = 2;
  group.add(mesh);
  // 윗 테이프(흰 띠, 앞뒤로 감쌈)와 아래 끈
  const band = (y0f, y1f, color, thick, rough) => {
    const p = [];
    const ix = [];
    const n = [];
    for (let i = 0; i <= seg; i++) {
      const x = -span + (2 * span * i) / seg;
      const y0 = y0f(x);
      const y1 = y1f(x);
      for (const z of [thick, -thick]) {
        p.push(x, y0, z, x, y1, z);
        n.push(0, 0, Math.sign(z), 0, 0, Math.sign(z));
      }
    }
    for (let i = 0; i < seg; i++) {
      const a = i * 4;
      const b = a + 4;
      ix.push(a, b, a + 1, a + 1, b, b + 1);
      ix.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
      ix.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    geo.setIndex(ix);
    const m = new THREE.Mesh(geo, std(color, rough));
    m.castShadow = true;
    return m;
  };
  group.add(band((x) => netH(x) - 0.06, (x) => netH(x) + 0.006, '#f5f5f0', 0.012, 0.6));
  group.add(band(() => 0.0, () => 0.035, '#20262c', 0.008, 0.9));
  // 센터 스트랩
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, COURT.netC, 0.03), std('#f5f5f0', 0.6));
  strap.position.set(0, COURT.netC / 2, 0);
  strap.castShadow = true;
  group.add(strap);
  const anchor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.12), std('#30353a', 0.5, { metalness: 0.6 }));
  anchor.position.set(0, 0.01, 0);
  group.add(anchor);
  // 포스트: 둥근 기둥 + 윗마개 + 줄감개
  const postMat = new THREE.MeshPhysicalMaterial({ color: '#1f4a35', roughness: 0.35, metalness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.3 });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.042, COURT.netP + 0.02, 18), postMat);
    post.position.set(s * (COURT.postX + 0.04), (COURT.netP + 0.02) / 2, 0);
    post.castShadow = true;
    group.add(post);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.044, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), postMat);
    cap.position.set(post.position.x, COURT.netP + 0.02, 0);
    group.add(cap);
    if (s > 0) {
      const wind = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.07), std('#b8bcc2', 0.3, { metalness: 0.9 }));
      wind.position.set(post.position.x + 0.05, 0.75, 0);
      group.add(wind);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 8).rotateZ(Math.PI / 2), std('#b8bcc2', 0.3, { metalness: 0.9 }));
      handle.position.set(post.position.x + 0.12, 0.75, 0.03);
      group.add(handle);
    }
  }
  // 네트 줄(케이블)
  const cablePts = [];
  for (let i = 0; i <= 40; i++) {
    const x = -span + (2 * span * i) / 40;
    cablePts.push(V(x, netH(x) - 0.012, 0));
  }
  const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cablePts), 80, 0.0045, 6), std('#d7d9dc', 0.4, { metalness: 0.7 }));
  group.add(cable);
  return group;
}

// ================================================================
// 경기장
// ================================================================
// 글자 네 개(글자 + 50px + 점 + 50px 씩)를 먼저 재서 캔버스 폭을 그 길이에 맞춥니다.
// 반복해서 흐를 때 이음매에서 단어가 잘리지 않고, 마지막 점 뒤 간격도 다른 곳과 같습니다.
// 폭이 2048 이 아니므로 쓰는 쪽은 image.width 로 반복 수를 맞춥니다(mkBoard).
const BOARD_FONT = '400 74px Anton, Impact, sans-serif';
function boardTex(text, sub, hue) {
  const items = [text, sub, text, sub];
  const mg = document.createElement('canvas').getContext('2d');
  mg.font = BOARD_FONT;
  const widths = items.map((t) => mg.measureText(t).width);
  const W = Math.ceil(widths.reduce((a, w) => a + w + 100, 0));
  const c = canvas(W, 128, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, `hsl(${hue},55%,16%)`);
    bg.addColorStop(1, `hsl(${hue},60%,9%)`);
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    // LED 점
    g.fillStyle = 'rgba(255,255,255,0.03)';
    for (let y = 2; y < h; y += 5) for (let x = 2; x < w; x += 5) g.fillRect(x, y, 2, 2);
    g.textBaseline = 'middle';
    g.font = BOARD_FONT;
    let x = 0;
    items.forEach((t, i) => {
      g.fillStyle = i % 2 ? `hsl(${hue},80%,70%)` : '#f4f6fb';
      g.fillText(t, x, h / 2 + 4);
      x += widths[i] + 50;
      g.fillStyle = `hsl(${(hue + 40) % 360},90%,62%)`;
      g.beginPath();
      g.arc(x, h / 2, 9, 0, Math.PI * 2);
      g.fill();
      x += 50;
    });
  });
  const t = tex(c, true, true);
  return t;
}

// 관중 한 줄(앉은 사람들, 군데군데 빈자리). 알파로 사람 모양만 남깁니다.
function crowdTex(seed) {
  const r = rng(seed);
  const shirts = ['#e8e4dc', '#2d3e66', '#c43d3d', '#f2c14e', '#3f8f5b', '#1e1f24', '#7b4ea3', '#e07b39', '#9fc4e8', '#f5f5f5', '#5a6b7d', '#d95f8e'];
  const skins = ['#f1c9a5', '#e0ac85', '#c68d63', '#8d5a3b', '#f6d7bd'];
  const hairs = ['#2a1d14', '#4b3020', '#141414', '#7a5230', '#c9a25f', '#8a8a8a'];
  const c = canvas(2048, 160, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    // 좌석 등받이
    g.fillStyle = '#26324a';
    for (let x = 0; x < w; x += 34) g.fillRect(x + 3, 96, 28, 64);
    let x = 4;
    while (x < w - 20) {
      if (r() < 0.12) {
        x += 34;
        continue;
      }
      const cx = x + 17 + (r() - 0.5) * 4;
      const sh = shirts[Math.floor(r() * shirts.length)];
      const sk = skins[Math.floor(r() * skins.length)];
      const hr = hairs[Math.floor(r() * hairs.length)];
      const lean = (r() - 0.5) * 6;
      // 몸통
      g.fillStyle = sh;
      g.beginPath();
      g.moveTo(cx - 15, 160);
      g.quadraticCurveTo(cx - 16, 92, cx + lean, 88);
      g.quadraticCurveTo(cx + 16, 92, cx + 15, 160);
      g.fill();
      // 팔(가끔 박수·손 흔들기)
      if (r() < 0.15) {
        g.strokeStyle = sk;
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(cx + 10, 104);
        g.lineTo(cx + 18, 66 + r() * 10);
        g.stroke();
      }
      // 머리
      g.fillStyle = sk;
      g.beginPath();
      g.ellipse(cx + lean, 70, 11, 13, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = hr;
      g.beginPath();
      g.ellipse(cx + lean, 64, 11.5, 9, 0, Math.PI, Math.PI * 2);
      g.fill();
      if (r() < 0.18) {
        // 모자
        g.fillStyle = shirts[Math.floor(r() * shirts.length)];
        g.fillRect(cx + lean - 12, 56, 24, 8);
        g.fillRect(cx + lean - 2, 60, 18, 4);
      }
      x += 34;
    }
  });
  return tex(c, true, true);
}

function scoreboardCanvas() {
  return canvas(1024, 512, () => {});
}
function drawScoreboard(c, info) {
  const g = c.getContext('2d');
  const w = c.width;
  const h = c.height;
  g.fillStyle = '#05070c';
  g.fillRect(0, 0, w, h);
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#0d1424');
  grad.addColorStop(1, '#070a12');
  g.fillStyle = grad;
  g.fillRect(12, 12, w - 24, h - 24);
  g.fillStyle = '#c9f24a';
  g.font = '400 54px Anton, Impact, sans-serif';
  g.textBaseline = 'middle';
  g.fillText('PCG OPEN', 44, 70);
  g.fillStyle = '#7d8aa6';
  g.font = '800 34px "Pretendard Variable", sans-serif';
  g.textAlign = 'right';
  g.fillText(info && info.status ? info.status : 'TENNIS', w - 44, 70);
  g.textAlign = 'left';
  // 두 팀 줄
  const rows = info ? [0, 1] : [];
  g.font = '400 30px Anton, Impact, sans-serif';
  g.fillStyle = '#7d8aa6';
  g.textAlign = 'center';
  g.fillText('GAMES', w - 290, 132);
  g.fillText('POINTS', w - 120, 132);
  g.textAlign = 'left';
  for (const t of rows) {
    const y = 210 + t * 150;
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(30, y - 62, w - 60, 124);
    g.fillStyle = info.colors[t];
    g.fillRect(30, y - 62, 14, 124);
    if (info.serve === t) {
      g.fillStyle = '#d9f24a';
      g.beginPath();
      g.arc(84, y, 15, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#f4f6fb';
    g.font = '400 76px Anton, Impact, sans-serif';
    g.fillText(info.names[t], 120, y + 4);
    g.textAlign = 'center';
    g.fillText(String(info.games[t]), w - 290, y + 4);
    g.fillStyle = '#ffd23a';
    g.fillText(String(info.points[t]), w - 120, y + 4);
    g.textAlign = 'left';
  }
  if (!info) {
    g.fillStyle = '#f4f6fb';
    g.textAlign = 'center';
    g.font = '400 120px Anton, Impact, sans-serif';
    g.fillText('TENNIS', w / 2, h / 2 + 40);
    g.textAlign = 'left';
  }
}

function makeStands(len, rows, seed) {
  // 길이 len(m) 의 계단식 관중석. 로컬 좌표: x 를 따라 늘어서고, +z 가 코트 쪽, 위로 올라갈수록 −z 로 물러납니다.
  const group = new THREE.Group();
  const stepD = 0.9;
  const stepH = 0.46;
  const steps = [];
  const crowds = [];
  for (let i = 0; i < rows; i++) {
    const g = new THREE.BoxGeometry(len, stepH * (i + 1), stepD);
    g.translate(0, (stepH * (i + 1)) / 2, -i * stepD - stepD / 2);
    steps.push(g);
    const cg = new THREE.PlaneGeometry(len, 0.86);
    const off = (seed * 0.137 + i * 0.311) % 1;
    const uvs = cg.attributes.uv;
    for (let k = 0; k < uvs.count; k++) uvs.setX(k, uvs.getX(k) * (len / 30) + off);
    cg.translate(0, stepH * (i + 1) + 0.38, -i * stepD - stepD * 0.55);
    crowds.push(cg);
  }
  const stepMat = std('#3a4152', 0.85);
  const stepMesh = new THREE.Mesh(mergeGeometries(steps), stepMat);
  stepMesh.receiveShadow = true;
  group.add(stepMesh);
  const crowdMat = new THREE.MeshStandardMaterial({ map: crowdTex(seed), alphaTest: 0.5, roughness: 0.9, side: THREE.DoubleSide });
  const crowdMesh = new THREE.Mesh(mergeGeometries(crowds), crowdMat);
  group.add(crowdMesh);
  // 맨 뒤 벽과 지붕 테두리
  const back = new THREE.Mesh(new THREE.BoxGeometry(len, 2.6, 0.4), std('#1c2232', 0.8));
  back.position.set(0, stepH * rows + 1.3, -rows * stepD - 0.2);
  group.add(back);
  return { group, height: stepH * rows, depth: rows * stepD };
}

function makeUmpireChair() {
  const g = new THREE.Group();
  const frame = new THREE.MeshPhysicalMaterial({ color: '#1f4a35', roughness: 0.4, metalness: 0.4, clearcoat: 0.4 });
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.CylinderGeometry(0.03, 0.035, 2.0, 10), frame, sx * 0.38, 1.0, sz * 0.38);
  for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(0.04, 0.03, 0.82), frame, -0.42, 0.3 + i * 0.3, 0);
  add(new THREE.BoxGeometry(0.9, 0.06, 0.9), frame, 0, 2.0, 0);
  add(new THREE.BoxGeometry(0.62, 0.08, 0.55), std('#e8e9ec', 0.6), 0.05, 2.36, 0);
  add(new THREE.BoxGeometry(0.06, 0.65, 0.55), std('#e8e9ec', 0.6), 0.36, 2.66, 0);
  add(new THREE.BoxGeometry(0.06, 0.32, 0.9), frame, -0.44, 2.2, 0);
  for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.9, 0.32, 0.06), frame, 0, 2.2, sz * 0.44);
  // 앉은 심판(간단한 모양)
  const suit = std('#1e2a44', 0.75);
  const skin = std('#e0ae87', 0.65);
  add(new THREE.CapsuleGeometry(0.17, 0.32, 6, 12), suit, 0.08, 2.75, 0);
  add(new THREE.SphereGeometry(0.11, 16, 12), skin, 0.02, 3.18, 0);
  const cap = add(new THREE.SphereGeometry(0.115, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), std('#f2f2f2', 0.6), 0.02, 3.2, 0);
  cap.scale.y = 0.8;
  for (const sz of [-1, 1]) {
    const th = add(new THREE.CapsuleGeometry(0.07, 0.32, 4, 8), suit, -0.15, 2.48, sz * 0.1);
    th.rotation.z = Math.PI / 2;
    add(new THREE.CapsuleGeometry(0.055, 0.36, 4, 8), suit, -0.34, 2.2, sz * 0.1);
  }
  return g;
}

function makeBench(color) {
  const g = new THREE.Group();
  const frame = std('#2b3240', 0.6, { metalness: 0.5 });
  const seat = std('#eef0f3', 0.5);
  const towelMat = std(color, 0.95);
  for (let i = 0; i < 2; i++) {
    const z = (i - 0.5) * 0.7;
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), seat);
    s.position.set(0, 0.46, z);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.5), seat);
    b.position.set(0.24, 0.72, z);
    s.castShadow = b.castShadow = true;
    g.add(s, b);
    for (const dx of [-0.2, 0.2]) for (const dz of [-0.2, 0.2]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.46, 6), frame);
      leg.position.set(dx, 0.23, z + dz);
      g.add(leg);
    }
    // 팀 색 수건
    const towel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.42), towelMat);
    towel.position.set(0.28, 0.72, z);
    g.add(towel);
  }
  const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.7, 6, 12).rotateX(Math.PI / 2), std(shade(color, -0.35), 0.7));
  bag.position.set(-0.1, 0.14, 0.9);
  bag.castShadow = true;
  g.add(bag);
  return { group: g, towelMats: [towelMat] };
}

function makeLightTower(h) {
  const g = new THREE.Group();
  const steel = std('#5b6474', 0.5, { metalness: 0.7 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.38, h, 12), steel);
  pole.position.y = h / 2;
  g.add(pole);
  const head = new THREE.Group();
  head.position.y = h;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.4, 0.3), steel);
  head.add(frame);
  const lampMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4dc', emissiveIntensity: 2.4, roughness: 0.3 });
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 6; c++) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.12, 14).rotateX(Math.PI / 2), lampMat);
      l.position.set(-1.7 + c * 0.68, -0.75 + r * 0.75, 0.18);
      head.add(l);
    }
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff2d6', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.scale.set(9, 6, 1);
  glow.position.z = 0.6;
  head.add(glow);
  g.add(head);
  g.userData.head = head;
  return g;
}

export function makeStadium() {
  const group = new THREE.Group();
  const wz = COURT.wallZ;
  const wx = COURT.wallX;
  // 뒷벽(3m)과 옆 보드(1m): 짙은 남색 + LED 띠(광고 없이 대회 이름)
  const wallMat = std('#152238', 0.75);
  const boards = [];
  const mkBoard = (len, h, hue, text, sub) => {
    const t = boardTex(text, sub, hue);
    // 2048px 가 22m 이던 글자 크기를 그대로 둡니다.
    t.repeat.set(len / (22 * (t.image.width / 2048)), 1);
    const m = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.55, roughness: 0.5 });
    boards.push(t);
    return new THREE.Mesh(new THREE.PlaneGeometry(len, h), m);
  };
  for (const s of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(wx * 2 + 0.6, 3.2, 0.3), wallMat);
    wall.position.set(0, 1.6, s * (wz + 0.15));
    wall.receiveShadow = true;
    group.add(wall);
    const b = mkBoard(wx * 2, 1.05, 212, 'PHONE CONTROLLER GAMES', 'TENNIS');
    b.position.set(0, 0.62, s * (wz - 0.012));
    b.rotation.y = s > 0 ? Math.PI : 0;
    group.add(b);
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, wz * 2), wallMat);
    side.position.set(s * (wx + 0.15), 0.6, 0);
    side.receiveShadow = true;
    group.add(side);
    const sb = mkBoard(wz * 2, 0.9, 150, 'PCG OPEN', 'SMASH · SLICE · TOPSPIN');
    sb.position.set(s * (wx - 0.012), 0.55, 0);
    sb.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(sb);
  }
  // 관중석: 옆 두 곳(길게)과 뒤 두 곳
  const sideStand = (s, seed) => {
    const st = makeStands(wz * 2 - 2, 16, seed);
    st.group.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    st.group.position.set(s * (wx + 0.3), 1.2, 0);
    group.add(st.group);
  };
  sideStand(1, 11);
  sideStand(-1, 23);
  for (const s of [-1, 1]) {
    const st = makeStands(wx * 2 + 0.6, 14, s > 0 ? 37 : 41);
    st.group.rotation.y = s > 0 ? Math.PI : 0;
    st.group.position.set(0, 3.2, s * (wz + 0.3));
    group.add(st.group);
  }
  // 모서리 받침 구조물(관중석 사이 빈 곳)
  const cornerMat = std('#1a2030', 0.85);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(16, 10, 16), cornerMat);
      c.position.set(sx * (wx + 8.3), 5, sz * (wz + 8.3));
      group.add(c);
    }
  }
  // 조명탑 네 개
  const towers = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const t = makeLightTower(24);
      t.position.set(sx * (wx + 9), 10, sz * (wz + 9));
      t.userData.head.rotation.set(0, Math.atan2(-t.position.x, -t.position.z), 0);
      t.userData.head.rotateX(0.45);
      group.add(t);
      towers.push(t);
    }
  }
  // 심판석과 벤치(오른쪽 포스트 옆)
  const chair = makeUmpireChair();
  chair.position.set(COURT.postX + 1.0, 0, 0);
  group.add(chair);
  const benches = [];
  for (const s of [-1, 1]) {
    const b = makeBench('#ffffff');
    b.group.position.set(wx - 0.75, 0, s * 2.2);
    group.add(b.group);
    benches.push(b);
  }
  // 전광판(먼 쪽 관중석 위)
  const sbCanvas = scoreboardCanvas();
  drawScoreboard(sbCanvas, null);
  const sbTex = tex(sbCanvas);
  const sb = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(10.6, 5.6, 0.6), std('#0b0f18', 0.6, { metalness: 0.4 }));
  sb.add(frame);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), new THREE.MeshBasicMaterial({ map: sbTex, toneMapped: false }));
  screen.position.z = 0.31;
  sb.add(screen);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 0.4), std('#2a3140', 0.6, { metalness: 0.5 }));
    leg.position.set(sx * 3.5, -5.5, -0.2);
    sb.add(leg);
  }
  sb.position.set(0, 14.2, -(wz + 12.4));
  group.add(sb);

  function setBoard(info) {
    drawScoreboard(sbCanvas, info);
    sbTex.needsUpdate = true;
    if (info) {
      benches[0].towelMats.forEach((m) => m.color.set(info.colors[0]));
      benches[1].towelMats.forEach((m) => m.color.set(info.colors[1]));
    }
  }
  function update(t) {
    for (const b of boards) b.offset.x = (t * 0.035) % 1;
  }
  return { group, update, setBoard };
}

// ================================================================
// 라켓: 손(그립) 원점, +y = 헤드 쪽, +z = 줄 면 법선
// ================================================================
const stringTex = (() => {
  const t = tex(canvas(256, 320, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(245,245,238,0.95)';
    g.lineWidth = 3;
    for (let i = 1; i < 16; i++) {
      const x = (i / 16) * w;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    for (let i = 1; i < 19; i++) {
      const y = (i / 19) * h;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
  }));
  return t;
})();
const gripTex = (color) => {
  const t = tex(canvas(64, 256, (g, w, h) => {
    g.fillStyle = '#f4f4f0';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = 3;
    for (let y = -h; y < h * 2; y += 22) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y + 30);
      g.stroke();
    }
    g.fillStyle = color;
    g.fillRect(0, h - 26, w, 26);
  }));
  return t;
};

export function makeRacket(color) {
  const g = new THREE.Group();
  const frameMat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.12 });
  const carbon = new THREE.MeshPhysicalMaterial({ color: '#15171c', roughness: 0.4, metalness: 0.3, clearcoat: 0.8 });
  const ax = 0.132; // 헤드 반폭
  const ay = 0.17; // 헤드 반길이
  const cy = HAND_TO_HEAD;
  // 헤드 테: 타원 고리(TorusGeometry 를 타원으로 늘리고 앞뒤로 두껍게)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(ay, 0.0095, 10, 72), frameMat);
  ring.scale.set(ax / ay, 1, 1.6);
  ring.position.y = cy;
  ring.castShadow = true;
  g.add(ring);
  // 범퍼 가드(헤드 끝). 45° 회전은 지오메트리에 굽습니다. mesh.rotation 으로 돌리면 크기(타원)가 회전보다
  // 먼저 걸려 압축 축이 45° 돌아가고, 범퍼가 테 안쪽 줄 위로 비뚤게 들어갑니다.
  const bumper = new THREE.Mesh(new THREE.TorusGeometry(ay + 0.004, 0.0085, 8, 36, Math.PI * 0.5).rotateZ(Math.PI * 0.25), carbon);
  bumper.scale.set(ax / ay, 1, 1.75);
  bumper.position.y = cy;
  g.add(bumper);
  // 줄
  const stringMat = new THREE.MeshStandardMaterial({
    map: stringTex, transparent: true, side: THREE.DoubleSide, roughness: 0.6, depthWrite: false
  });
  const strings = new THREE.Mesh(new THREE.CircleGeometry(1, 48), stringMat);
  strings.scale.set(ax - 0.008, ay - 0.008, 1);
  strings.position.y = cy;
  g.add(strings);
  // 목(두 갈래)과 브리지
  const throatY0 = 0.13;
  const yBot = cy - ay;
  for (const s of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([V(s * 0.012, throatY0, 0), V(s * 0.03, throatY0 + 0.07, 0), V(s * 0.07, yBot + 0.025, 0), V(s * 0.1, yBot + 0.07, 0)]);
    const arm = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.009, 8), carbon);
    arm.scale.z = 1.5;
    arm.castShadow = true;
    g.add(arm);
  }
  const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 8).rotateZ(Math.PI / 2), frameMat);
  bridge.position.y = yBot + 0.004;
  g.add(bridge);
  // 손잡이: 팔각 기둥 + 오버그립 + 끝마개
  const gripMat = new THREE.MeshStandardMaterial({ map: gripTex(color), roughness: 0.85 });
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.0155, 0.0145, 0.19, 8), gripMat);
  grip.position.y = 0.025;
  grip.castShadow = true;
  g.add(grip);
  const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.016, 0.018, 8), carbon);
  butt.position.y = -0.075;
  g.add(butt);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.0128, 0.0155, 0.03, 8), frameMat);
  collar.position.y = 0.13;
  g.add(collar);
  // 선수 dispose() 가 함께 풀 재질(줄 텍스처 stringTex 는 공유라 남깁니다)
  g.userData.mats = [frameMat, carbon, stringMat, gripMat];
  return g;
}

// ================================================================
// 선수
// ================================================================
const SKINS = ['#d39a72', '#b9805a', '#e0ad86', '#8f5d3e', '#c48a62'];
const HAIRS = ['#2a1d14', '#5a3a22', '#141210', '#8a5a2e', '#1d1a18'];

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
function placeLimb(m, a, b) {
  m.position.addVectors(a, b).multiplyScalar(0.5);
  const dir = new THREE.Vector3().subVectors(b, a);
  const l = dir.length();
  if (l > 1e-6) m.quaternion.setFromUnitVectors(Y, dir.multiplyScalar(1 / l));
  m.scale.set(1, l, 1);
}
// 길이 1 짜리 둥근 팔다리 토막(아래 굵기 r0, 위 굵기 r1, 양 끝 둥근 마개). 실제 길이 len 으로 늘려 쓰므로
// 마개 높이는 len 으로 나눠 둡니다(늘린 뒤 반구 모양).
function limbGeo(r0, r1, len, seg = 14) {
  const pts = [];
  const n = 5;
  const c0 = (r0 * 0.85) / len;
  const c1 = (r1 * 0.85) / len;
  pts.push(new THREE.Vector2(0, -0.5));
  for (let i = 1; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.sin(a) * r0, -0.5 + (1 - Math.cos(a)) * c0));
  }
  // 근육처럼 가운데가 살짝 볼록
  for (let i = 1; i < 4; i++) {
    const t = i / 4;
    const r = r0 + (r1 - r0) * t + Math.sin(t * Math.PI) * 0.06 * Math.max(r0, r1);
    pts.push(new THREE.Vector2(r, -0.5 + c0 + (1 - c0 - c1) * t));
  }
  for (let i = n; i >= 1; i--) {
    const a = (i / n) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.sin(a) * r1, 0.5 - (1 - Math.cos(a)) * c1));
  }
  pts.push(new THREE.Vector2(0, 0.5));
  return new THREE.LatheGeometry(pts, seg);
}

function shirtTex(color) {
  return tex(canvas(256, 256, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    // 옆선 그러데이션과 가슴 줄무늬
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0.18)');
    gr.addColorStop(0.2, 'rgba(0,0,0,0)');
    gr.addColorStop(0.8, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(0,0,0,0.18)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(0, h * 0.34, w, h * 0.035);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, h * 0.385, w, h * 0.012);
    // 원단 결
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},0.04)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }));
}

export function makeAthlete(o) {
  const g = new THREE.Group();
  const color = o.color;
  const seed = o.slot || 0;
  const skinC = o.cpu ? '#c99470' : SKINS[(seed + 1) % SKINS.length];
  const hairC = HAIRS[(seed + 2) % HAIRS.length];
  const shirt = new THREE.MeshStandardMaterial({ color: '#ffffff', map: shirtTex(color), roughness: 0.72 });
  const shorts = std(o.cpu ? '#2b3445' : shade(color, -0.72), 0.78);
  const skin = new THREE.MeshPhysicalMaterial({ color: skinC, roughness: 0.55, sheen: 0.4, sheenColor: new THREE.Color('#ffb48a'), sheenRoughness: 0.6 });
  const sock = std('#ecece6', 0.85);
  const shoeUp = std('#e9eaec', 0.55);
  const shoeSole = std('#c9cacc', 0.75);
  const accent = std(color, 0.5);
  const hair = std(hairC, 0.9);
  const white = std('#f6f6f2', 0.6);
  const mats = [shirt, shorts, skin, sock, shoeUp, shoeSole, accent, hair, white];
  const add = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  const P = {};
  // 골반·반바지
  const hipProf = [[0.0, -0.12], [0.13, -0.12], [0.165, -0.06], [0.17, 0.04], [0.155, 0.1], [0.0, 0.1]].map(([r, y]) => new THREE.Vector2(r, y));
  P.pelvis = add(new THREE.LatheGeometry(hipProf, 22).scale(1.1, 1, 0.78), shorts);
  for (const s of ['L', 'R']) {
    P['shortsLeg' + s] = add(limbGeo(0.088, 0.1, 0.22), shorts);
    P['thigh' + s] = add(limbGeo(0.064, 0.08, 0.45), skin);
    P['knee' + s] = add(new THREE.SphereGeometry(0.058, 12, 10), skin);
    P['shin' + s] = add(limbGeo(0.042, 0.058, 0.44), skin);
    P['sock' + s] = add(limbGeo(0.046, 0.05, 0.14), sock);
    // 신발: 밑창(옆모습을 밀어냄) + 갑피 + 줄무늬
    const shoe = new THREE.Group();
    const sp = new THREE.Shape();
    sp.moveTo(-0.075, 0);
    sp.lineTo(0.17, 0);
    sp.quadraticCurveTo(0.215, 0.0, 0.205, 0.035);
    sp.lineTo(-0.08, 0.035);
    sp.quadraticCurveTo(-0.1, 0.02, -0.075, 0);
    const sole = new THREE.Mesh(new THREE.ExtrudeGeometry(sp, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2 }), shoeSole);
    sole.rotation.y = -Math.PI / 2;
    sole.position.set(0.05, 0, 0);
    const upper = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12).scale(0.055, 0.05, 0.135), shoeUp);
    upper.position.set(0, 0.05, 0.05);
    const stripe = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.25).scale(0.057, 0.052, 0.12), accent);
    stripe.position.copy(upper.position);
    for (const m of [sole, upper, stripe]) {
      m.castShadow = true;
      shoe.add(m);
    }
    P['shoe' + s] = shoe;
    g.add(shoe);
  }
  // 상체: 허리에서 가슴으로 넓어졌다가 어깨로 좁아지는 옆모습을 돌립니다.
  const prof = [[0.0, 0], [0.15, 0.0], [0.155, 0.08], [0.175, 0.22], [0.18, 0.33], [0.16, 0.43], [0.11, 0.49], [0.06, 0.51], [0, 0.51]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  P.torso = add(new THREE.LatheGeometry(prof, 28).scale(1.14, 1, 0.7), shirt);
  P.collar = add(new THREE.TorusGeometry(0.06, 0.014, 8, 24).rotateX(Math.PI / 2), shirt);
  P.neck = add(new THREE.CylinderGeometry(0.048, 0.056, 0.1, 14), skin);
  for (const s of ['L', 'R']) {
    P['shoulder' + s] = add(new THREE.SphereGeometry(0.07, 14, 10), shirt);
    P['sleeve' + s] = add(limbGeo(0.06, 0.066, 0.145), shirt);
    P['upper' + s] = add(limbGeo(0.043, 0.05, 0.29), skin);
    P['elbow' + s] = add(new THREE.SphereGeometry(0.042, 12, 8), skin);
    P['fore' + s] = add(limbGeo(0.032, 0.043, 0.28), skin);
    P['hand' + s] = add(new THREE.SphereGeometry(1, 14, 10).scale(0.042, 0.05, 0.03), skin);
  }
  P.wrist = add(new THREE.CylinderGeometry(0.043, 0.043, 0.06, 14), accent);
  // 머리: 두상, 머리카락, 머리띠, 귀, 코, 눈
  const head = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 18).scale(0.92, 1.08, 1), skin);
  skull.castShadow = true;
  head.add(skull);
  // 머리카락: 정수리는 이마 위까지만, 뒤통수는 귀 높이까지(얼굴은 드러나게)
  const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.36).scale(0.95, 1.06, 1.04), hair);
  hairM.position.set(0, 0.006, -0.008);
  hairM.castShadow = true;
  head.add(hairM);
  const back = new THREE.Mesh(new THREE.SphereGeometry(0.108, 20, 12, Math.PI * 0.75, Math.PI * 1.5, Math.PI * 0.3, Math.PI * 0.32).scale(0.95, 1.05, 1.05), hair);
  head.add(back);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.103, 0.017, 8, 30).rotateX(Math.PI / 2).scale(0.93, 1, 1.02), o.cpu ? white : accent);
  band.position.y = 0.04;
  band.rotation.x = -0.12;
  head.add(band);
  const eyeMat = std('#1a1a1e', 0.3);
  mats.push(eyeMat);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8).scale(0.5, 1, 0.8), skin);
    ear.position.set(s * 0.095, -0.005, -0.005);
    head.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), eyeMat);
    eye.position.set(s * 0.033, 0.01, 0.092);
    head.add(eye);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8).scale(0.8, 1, 1.1), skin);
  nose.position.set(0, -0.014, 0.1);
  head.add(nose);
  g.add(head);
  P.head = head;
  // 라켓
  const racket = makeRacket(color);
  g.add(racket);
  mats.push(...racket.userData.mats);
  // 발밑 그림자(해 그림자를 보조)
  const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, opacity: 0.55 });
  mats.push(blobMat);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2).rotateX(-Math.PI / 2), blobMat);
  blob.position.y = 0.012;
  blob.renderOrder = 1;
  g.add(blob);

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _x = new THREE.Vector3();
  const _y = new THREE.Vector3();
  const _z = new THREE.Vector3();
  const v = (a) => vA.set(a[0], a[1], a[2]).clone();

  function pose(p) {
    const pelvis = V(0, p.hipY, 0);
    const hq = new THREE.Quaternion().setFromAxisAngle(Y, p.hipYaw);
    P.pelvis.position.copy(pelvis);
    P.pelvis.quaternion.copy(hq);
    const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.lean, p.torsoYaw, p.bend || 0, 'YXZ'));
    const up = (x, y, z) => V(x, y, z).applyQuaternion(tq).add(pelvis);
    P.torso.position.copy(up(0, 0.06, 0));
    P.torso.quaternion.copy(tq);
    P.collar.position.copy(up(0, 0.565, 0.0));
    P.collar.quaternion.copy(tq);
    P.neck.position.copy(up(0, 0.6, 0.0));
    P.neck.quaternion.copy(tq);
    P.head.position.copy(up(0, 0.75, 0.02));
    P.head.quaternion.setFromEuler(new THREE.Euler(p.lean * 0.5 + (p.headPitch || 0), p.torsoYaw + (p.headYaw || 0), 0, 'YXZ'));

    // 다리
    for (const [side, s] of [['L', 1], ['R', -1]]) {
      const hip = V(s * 0.095, -0.06, 0).applyQuaternion(hq).add(pelvis);
      const foot = v(p['foot' + side]);
      const pole = V(s * 0.12, 0, 1).applyQuaternion(hq);
      const { joint, end } = ik(hip, foot, 0.45, 0.44, pole);
      placeLimb(P['thigh' + side], hip, joint);
      P['knee' + side].position.copy(joint);
      placeLimb(P['shin' + side], joint, end);
      placeLimb(P['shortsLeg' + side], hip, vB.copy(hip).lerp(joint, 0.48));
      placeLimb(P['sock' + side], vB.copy(joint).lerp(end, 0.68), end);
      const shoe = P['shoe' + side];
      shoe.position.set(end.x, Math.max(0, end.y - 0.07), end.z);
      shoe.rotation.set(0, p.hipYaw * 0.6 + s * 0.12, 0);
    }

    // 팔: 오른손은 라켓 그립, 왼손은 정해진 위치(목·그립·토스)
    const targets = { R: v(p.handR), L: v(p.handL) };
    const reached = {};
    for (const [side, s] of [['L', 1], ['R', -1]]) {
      const sh = up(s * 0.19, 0.46, 0);
      P['shoulder' + side].position.copy(sh);
      const pole = V(s * 0.55, -1, -0.35).applyQuaternion(tq);
      const { joint, end } = ik(sh, targets[side], 0.29, 0.28, pole);
      placeLimb(P['upper' + side], sh, joint);
      placeLimb(P['sleeve' + side], sh, vB.copy(sh).lerp(joint, 0.5));
      P['elbow' + side].position.copy(joint);
      placeLimb(P['fore' + side], joint, end);
      P['hand' + side].position.copy(end);
      reached[side] = end;
    }
    // 라켓 방향
    _y.set(p.dir[0], p.dir[1], p.dir[2]).normalize();
    _z.set(p.face[0], p.face[1], p.face[2]);
    _z.addScaledVector(_y, -_z.dot(_y));
    if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
    _z.normalize();
    _x.crossVectors(_y, _z);
    racket.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
    racket.position.copy(reached.R);
    P.handR.quaternion.copy(racket.quaternion);
    P.handL.quaternion.setFromUnitVectors(Y, vB.subVectors(reached.L, P.elbowL.position).normalize());
    P.wrist.position.copy(reached.R).addScaledVector(vB.subVectors(P.elbowR.position, reached.R).normalize(), 0.06);
    P.wrist.quaternion.setFromUnitVectors(Y, vB);
  }

  function dispose() {
    g.traverse((m) => {
      if (m.geometry) m.geometry.dispose();
    });
    for (const m of mats) {
      // 줄·발밑 그림자 텍스처는 모든 선수가 같이 쓰므로 풀지 않습니다.
      if (m.map && m.map !== stringTex && m.map !== blobTex) m.map.dispose();
      m.dispose();
    }
  }
  return { group: g, pose, racket, dispose };
}

// ================================================================
// 공
// ================================================================
const ballTex = (() => {
  const W = 512;
  const H = 256;
  const c = canvas(W, H, (g) => {
    g.fillStyle = '#d8ef3a';
    g.fillRect(0, 0, W, H);
    // 보송한 털: 밝고 어두운 잔점
    for (let i = 0; i < 9000; i++) {
      const a = 0.05 + Math.random() * 0.12;
      g.fillStyle = Math.random() < 0.5 ? `rgba(255,255,200,${a})` : `rgba(110,130,10,${a})`;
      g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    // 솔기: 구 위의 테니스공 곡선을 경위도 그림으로 옮겨 그립니다(three SphereGeometry UV 와 같은 방식).
    const a = 0.72;
    const b = 0.28;
    const cz = 2 * Math.sqrt(a * b);
    g.fillStyle = '#f7f9ee';
    const N = 2400;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      const x = a * Math.cos(t) + b * Math.cos(3 * t);
      const y = a * Math.sin(t) - b * Math.sin(3 * t);
      const z = cz * Math.sin(2 * t);
      // 공의 위(+y)를 곡선의 z 로 돌려 솔기가 적도를 감싸게 합니다.
      const px = x;
      const py = z;
      const pz = y;
      const th = Math.acos(Math.max(-1, Math.min(1, py)));
      let ph = Math.atan2(pz, -px);
      if (ph < 0) ph += Math.PI * 2;
      const u = ph / (Math.PI * 2);
      const cx = u * W;
      const cy = (th / Math.PI) * H;
      const rr = 3.2 / Math.max(0.35, Math.sin(th));
      g.beginPath();
      g.ellipse(cx, cy, rr, 3.2, 0, 0, Math.PI * 2);
      g.fill();
      if (cx < rr) {
        g.beginPath();
        g.ellipse(cx + W, cy, rr, 3.2, 0, 0, Math.PI * 2);
        g.fill();
      }
      if (cx > W - rr) {
        g.beginPath();
        g.ellipse(cx - W, cy, rr, 3.2, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  });
  return tex(c);
})();

export function makeBall() {
  const m = new THREE.Mesh(new THREE.SphereGeometry(BALL_VIS, 28, 18), new THREE.MeshPhysicalMaterial({
    map: ballTex, roughness: 0.92, sheen: 1, sheenColor: new THREE.Color('#f6ff9e'), sheenRoughness: 0.45,
    emissive: '#3a4400', emissiveIntensity: 0.25
  }));
  m.castShadow = true;
  return m;
}
export function makeBlob() {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 }));
  m.renderOrder = 2;
  return m;
}

// 꼬리: 카메라를 향하는 띠
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _t3 = new THREE.Vector3();
export function makeTrail(n = 16) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 2 * 4), 4));
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.userData = { n, pts: [] };
  return mesh;
}
export function layoutTrail(trail, camPos) {
  const { n, pts } = trail.userData;
  const count = Math.min(n, pts.length);
  const pos = trail.geometry.attributes.position;
  const col = trail.geometry.attributes.color;
  if (count < 2) {
    trail.visible = false;
    return;
  }
  trail.visible = true;
  for (let i = 0; i < n; i++) {
    const k = Math.min(i, count - 1);
    const p = pts[k];
    const q = pts[Math.min(count - 1, k + 1)];
    const o = pts[Math.max(0, k - 1)];
    _t1.set(q[0] - o[0], q[1] - o[1], q[2] - o[2]);
    _t2.set(p[0] - camPos.x, p[1] - camPos.y, p[2] - camPos.z);
    _t3.crossVectors(_t1, _t2);
    if (_t3.lengthSq() < 1e-12) _t3.set(0, 1, 0);
    _t3.normalize();
    const f = k / (count - 1);
    const w = BALL_VIS * (0.2 + 0.8 * f);
    pos.setXYZ(i * 2, p[0] + _t3.x * w, p[1] + _t3.y * w, p[2] + _t3.z * w);
    pos.setXYZ(i * 2 + 1, p[0] - _t3.x * w, p[1] - _t3.y * w, p[2] - _t3.z * w);
    const a = i < count ? f * f * 0.6 : 0;
    col.setXYZW(i * 2, 1, 1, 0.75, a);
    col.setXYZW(i * 2 + 1, 1, 1, 0.75, a);
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;
}
