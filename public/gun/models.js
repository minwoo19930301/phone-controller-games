// 좀비 건 아케이드 모델: 좀비(걷는 사람·달리는 사람·덩치·변이체 보스)와 세 구역(폐허 거리 · 버려진 쇼핑몰 · 지하 주차장).
// 외부 파일 없이 전부 기본 도형과 캔버스 그림으로 만듭니다. 길(레일)은 -Z 방향으로 곧게 뻗어 있습니다.
import * as THREE from 'three';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ================================================================
// 캔버스 그림(질감)
// ================================================================
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function speckle(g, w, h, n, base, amp, size = 2) {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(base + (Math.random() - 0.5) * amp);
    g.fillStyle = `rgb(${v},${v},${v + 2})`;
    g.fillRect(Math.random() * w, Math.random() * h, size * Math.random() + 1, size * Math.random() + 1);
  }
}
function cracks(g, w, h, n, color = 'rgba(0,0,0,0.35)') {
  g.strokeStyle = color;
  g.lineWidth = 1.2;
  for (let i = 0; i < n; i++) {
    let x = Math.random() * w;
    let y = Math.random() * h;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 7; k++) {
      x += (Math.random() - 0.5) * 50;
      y += (Math.random() - 0.3) * 40;
      g.lineTo(x, y);
    }
    g.stroke();
  }
}
let TX = null;
function textures() {
  if (TX) return TX;
  TX = {};
  TX.asphalt = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#2b2d33';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 9000, 52, 40);
    cracks(g, w, h, 6);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i < 6; i++) g.fillRect(Math.random() * w, Math.random() * h, rnd(40, 160), rnd(20, 70));
  });
  TX.concrete = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#6c6e70';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 8000, 112, 40);
    cracks(g, w, h, 5, 'rgba(0,0,0,0.28)');
    g.strokeStyle = 'rgba(0,0,0,0.32)';
    g.lineWidth = 3;
    g.strokeRect(0, 0, w, h);
  });
  // 건물 겉면: 8m x 8m 한 칸에 창 4x4
  const facadeDraw = (lit) => (g, w, h) => {
    if (!lit) {
      g.fillStyle = '#3a3a44';
      g.fillRect(0, 0, w, h);
      speckle(g, w, h, 5000, 62, 30);
      cracks(g, w, h, 3);
    } else {
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
    }
    const cw = w / 4;
    const ch = h / 4;
    const seed = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) seed.push(Math.random());
    }
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const x = c * cw + cw * 0.18;
        const y = r * ch + ch * 0.2;
        const on = seed[r * 4 + c] < 0.13;
        if (!lit) {
          g.fillStyle = '#10131a';
          g.fillRect(x, y, cw * 0.64, ch * 0.58);
          g.fillStyle = 'rgba(120,140,170,0.14)';
          g.fillRect(x, y, cw * 0.64, ch * 0.12);
          g.strokeStyle = '#25252d';
          g.lineWidth = 3;
          g.strokeRect(x, y, cw * 0.64, ch * 0.58);
          g.beginPath();
          g.moveTo(x + cw * 0.32, y);
          g.lineTo(x + cw * 0.32, y + ch * 0.58);
          g.stroke();
        } else if (on) {
          g.fillStyle = Math.random() < 0.3 ? '#ff9a4d' : '#ffd88a';
          g.fillRect(x, y, cw * 0.64, ch * 0.58);
        }
      }
    }
  };
  TX.facade = canvasTex(512, 512, facadeDraw(false));
  TX.facadeLit = canvasTex(512, 512, facadeDraw(true));
  TX.tile = canvasTex(512, 512, (g, w, h) => {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const v = (r + c) % 2 ? 150 : 128;
        g.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
        g.fillRect((c * w) / 4, (r * h) / 4, w / 4, h / 4);
      }
    }
    speckle(g, w, h, 6000, 120, 50);
    g.strokeStyle = 'rgba(0,0,0,0.4)';
    g.lineWidth = 2;
    for (let i = 1; i < 4; i++) {
      g.beginPath(); g.moveTo((i * w) / 4, 0); g.lineTo((i * w) / 4, h); g.stroke();
      g.beginPath(); g.moveTo(0, (i * h) / 4); g.lineTo(w, (i * h) / 4); g.stroke();
    }
    cracks(g, w, h, 4);
    g.fillStyle = 'rgba(40,20,16,0.25)';
    for (let i = 0; i < 5; i++) g.fillRect(Math.random() * w, Math.random() * h, rnd(30, 120), rnd(20, 90));
  });
  TX.shutter = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#4e5358';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) {
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(0, y, w, 2);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(0, y + 5, w, 3);
    }
    speckle(g, w, h, 1500, 90, 40);
    g.fillStyle = 'rgba(110,30,20,0.35)';
    g.fillRect(rnd(0, 150), rnd(0, 150), rnd(30, 90), rnd(40, 120));
  });
  TX.stripe = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#e9b82e';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1b1b1b';
    for (let i = -2; i < 6; i++) {
      g.beginPath();
      g.moveTo(i * 32, 0); g.lineTo(i * 32 + 16, 0); g.lineTo(i * 32 + 16 + h, h); g.lineTo(i * 32 + h, h);
      g.fill();
    }
  });
  return TX;
}
// 네온 간판: 글자를 빛나게 그린 판
function signTex(text, color) {
  return canvasTex(512, 160, (g, w, h) => {
    g.fillStyle = '#07080c';
    g.fillRect(0, 0, w, h);
    g.font = '800 92px "Pretendard Variable", Pretendard, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    g.shadowBlur = 26;
    g.fillStyle = color;
    g.fillText(text, w / 2, h / 2 + 4);
    g.shadowBlur = 8;
    g.fillStyle = '#fff';
    g.globalAlpha = 0.8;
    g.fillText(text, w / 2, h / 2 + 4);
  });
}
export const blobTexture = () => canvasTex(128, 128, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
}, false);
export const splatTexture = () => canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#fff';
  const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w * 0.32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff';
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = rnd(18, 54);
    g.beginPath();
    g.arc(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r, rnd(2, 8), 0, Math.PI * 2);
    g.fill();
    // 튄 꼬리
    g.lineWidth = rnd(1.5, 4);
    g.strokeStyle = '#fff';
    g.beginPath();
    g.moveTo(w / 2 + Math.cos(a) * 14, h / 2 + Math.sin(a) * 14);
    g.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
    g.stroke();
  }
}, false);

// ================================================================
// 좀비
// ================================================================
const BOX = new THREE.BoxGeometry(1, 1, 1);
const SPH = new THREE.SphereGeometry(1, 14, 10);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 10);
const CONE = new THREE.ConeGeometry(1, 1, 8);
const SKIN = ['#8a9a78', '#7d8c7a', '#9aa58a', '#6f7d6b', '#a39b86', '#7b8f86', '#94a08f'];
const SHIRT = ['#6b3b34', '#2f4a5a', '#4b4f3a', '#5a5a60', '#7a6a3a', '#3a3447', '#8a8f93', '#5b2f2f'];
const PANTS = ['#262b3a', '#2f2a25', '#3b3f46', '#1f2a2a', '#3a3128'];
const SHARED = {
  dark: new THREE.MeshStandardMaterial({ color: '#17181c', roughness: 0.9 }),
  blood: new THREE.MeshStandardMaterial({ color: '#5a0d12', roughness: 0.35, metalness: 0.1 }),
  hair: new THREE.MeshStandardMaterial({ color: '#2a2018', roughness: 1 }),
  mouth: new THREE.MeshBasicMaterial({ color: '#150507' }),
  eye: new THREE.MeshBasicMaterial({ color: '#ffe27a' }),
  eyeRed: new THREE.MeshBasicMaterial({ color: '#ff3b2f' }),
  metal: new THREE.MeshStandardMaterial({ color: '#6a7078', roughness: 0.45, metalness: 0.8 }),
  rust: new THREE.MeshStandardMaterial({ color: '#6b3a22', roughness: 0.8, metalness: 0.4 }),
  bone: new THREE.MeshStandardMaterial({ color: '#cfc6b0', roughness: 0.7 })
};
let blobMat = null;

export const KINDS = {
  walker: { scale: 1, hp: 60, speed: [0.9, 1.5], dmg: 10, bite: 1.35, pts: 100, body: 20, head: 60, radius: 1 },
  runner: { scale: 0.96, hp: 40, speed: [2.8, 3.8], dmg: 8, bite: 1.0, pts: 150, body: 20, head: 60, radius: 1 },
  brute: { scale: 1.32, hp: 300, speed: [0.7, 0.95], dmg: 22, bite: 1.9, pts: 400, body: 12, head: 40, radius: 1.3 },
  boss: { scale: 3.1, hp: 1600, speed: [1.3, 1.3], dmg: 18, bite: 6, pts: 3000, body: 9, head: 34, radius: 3.1 }
};

function mesh(geo, mat, sx, sy, sz, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  return m;
}
function pivot(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

export function makeZombie(kind = 'walker') {
  const cfg = KINDS[kind];
  const root = new THREE.Group();
  const body = new THREE.Group();
  const s = cfg.scale * rnd(0.95, 1.05);
  const wide = kind === 'brute' ? 1.28 : kind === 'boss' ? 1.15 : kind === 'runner' ? 0.9 : 1;
  body.scale.set(s * wide, s, s * wide);
  root.add(body);

  const skinCol = new THREE.Color(pick(SKIN)).multiplyScalar(rnd(0.85, 1.05));
  const skin = new THREE.MeshStandardMaterial({ color: skinCol, roughness: 0.85 });
  const shirtCol = kind === 'runner' ? skinCol.clone().multiplyScalar(0.92) : new THREE.Color(pick(SHIRT));
  const shirt = new THREE.MeshStandardMaterial({ color: kind === 'boss' ? '#3a2a38' : shirtCol, roughness: 0.95 });
  const pants = new THREE.MeshStandardMaterial({ color: kind === 'boss' ? '#2a2530' : pick(PANTS), roughness: 0.95 });
  const mats = [skin, shirt, pants];
  const parts = {};

  // 엉덩이·다리
  const hips = pivot(body, 0, 0.93, 0);
  hips.add(mesh(BOX, pants, 0.34, 0.2, 0.2));
  parts.hips = hips;
  for (const sx of [-1, 1]) {
    const leg = pivot(hips, sx * 0.1, -0.02, 0);
    leg.add(mesh(BOX, pants, 0.15, 0.46, 0.17, 0, -0.23, 0));
    const knee = pivot(leg, 0, -0.46, 0);
    const shortsRunner = kind === 'runner';
    knee.add(mesh(BOX, shortsRunner ? skin : pants, 0.12, 0.44, 0.14, 0, -0.22, 0));
    knee.add(mesh(BOX, SHARED.dark, 0.13, 0.07, 0.27, 0, -0.455, 0.06));
    parts[sx < 0 ? 'legL' : 'legR'] = leg;
    parts[sx < 0 ? 'kneeL' : 'kneeR'] = knee;
  }
  // 몸통
  const spine = pivot(hips, 0, 0.08, 0);
  parts.spine = spine;
  spine.add(mesh(BOX, shirt, 0.4, 0.52, 0.23, 0, 0.28, 0));
  spine.add(mesh(BOX, skin, 0.26, 0.12, 0.02, 0, 0.12, 0.118)); // 찢어진 옷 사이 배
  spine.add(mesh(BOX, SHARED.blood, 0.14, 0.2, 0.015, 0.07, 0.32, 0.121));
  if (Math.random() < 0.5) spine.add(mesh(BOX, SHARED.blood, 0.12, 0.1, 0.015, -0.1, 0.1, 0.122));
  spine.add(mesh(CYL, skin, 0.05, 0.1, 0.05, 0, 0.58, 0));
  // 머리
  const head = pivot(spine, 0, 0.64, 0);
  parts.head = head;
  head.add(mesh(SPH, skin, 0.125, 0.145, 0.135, 0, 0.1, 0));
  const jaw = pivot(head, 0, 0.03, 0.035);
  jaw.add(mesh(BOX, skin, 0.13, 0.04, 0.11, 0, -0.02, 0.02));
  jaw.add(mesh(BOX, SHARED.mouth, 0.1, 0.03, 0.09, 0, 0.015, 0.02));
  parts.jaw = jaw;
  const eyeMat = kind === 'boss' ? SHARED.eyeRed : SHARED.eye;
  for (const ex of [-1, 1]) head.add(mesh(SPH, eyeMat, 0.02, 0.016, 0.01, ex * 0.05, 0.13, 0.126));
  if (kind !== 'runner' && Math.random() < 0.6) head.add(mesh(BOX, SHARED.hair, 0.27, 0.07, 0.26, 0, 0.21, -0.015));
  if (Math.random() < 0.55) head.add(mesh(BOX, SHARED.blood, 0.05, 0.08, 0.02, rnd(-0.07, 0.07) , 0.17, 0.128));
  if (kind === 'brute') {
    // 철제 마스크
    head.add(mesh(BOX, SHARED.metal, 0.25, 0.14, 0.03, 0, 0.1, 0.13));
    for (const ex of [-1, 1]) head.add(mesh(BOX, SHARED.eye, 0.04, 0.012, 0.01, ex * 0.05, 0.12, 0.147));
    head.scale.setScalar(0.85);
  }
  if (kind === 'boss') {
    head.scale.setScalar(0.8);
    for (const ex of [-1, 1]) {
      const horn = mesh(CONE, SHARED.bone, 0.04, 0.2, 0.04, ex * 0.1, 0.27, -0.02);
      horn.rotation.z = -ex * 0.5;
      head.add(horn);
    }
  }
  // 팔
  const armCfg = { x: 0.26, y: 0.5 };
  const missing = Math.random() < (kind === 'walker' ? 0.18 : 0);
  for (const sx of [-1, 1]) {
    const sh = pivot(spine, sx * armCfg.x, armCfg.y, 0);
    const sleeve = kind === 'runner' ? skin : shirt;
    const big = kind === 'boss' && sx > 0 ? 1.55 : 1;
    sh.add(mesh(BOX, sleeve, 0.09 * big, 0.28, 0.09 * big, 0, -0.14, 0));
    const el = pivot(sh, 0, -0.28, 0);
    const lost = missing && sx < 0;
    if (!lost) {
      el.add(mesh(BOX, skin, 0.08 * big, 0.26, 0.08 * big, 0, -0.13, 0));
      el.add(mesh(BOX, skin, 0.09 * big, 0.1, 0.05 * big, 0, -0.3, 0));
      for (let f = -1; f <= 1; f++) el.add(mesh(BOX, skin, 0.018, 0.07, 0.02, f * 0.03 * big, -0.37, 0));
    } else {
      el.add(mesh(BOX, SHARED.blood, 0.08, 0.07, 0.08, 0, -0.04, 0));
      el.add(mesh(CYL, SHARED.bone, 0.018, 0.12, 0.018, 0, -0.1, 0));
    }
    parts[sx < 0 ? 'armL' : 'armR'] = sh;
    parts[sx < 0 ? 'foreL' : 'foreR'] = el;
  }
  if (kind === 'brute') {
    spine.add(mesh(BOX, SHARED.metal, 0.46, 0.3, 0.05, 0, 0.34, 0.13));
    spine.add(mesh(BOX, SHARED.rust, 0.4, 0.04, 0.06, 0, 0.5, 0.13));
    parts.spine.scale.set(1.0, 1.05, 1.1);
    // 어깨 보호대
    for (const sx of [-1, 1]) spine.add(mesh(BOX, SHARED.metal, 0.16, 0.06, 0.18, sx * 0.3, 0.54, 0));
  }
  const anchors = {};
  anchors.head = new THREE.Object3D();
  anchors.head.position.set(0, 0.1, 0.02);
  head.add(anchors.head);
  anchors.chest = new THREE.Object3D();
  anchors.chest.position.set(0, 0.3, 0.05);
  spine.add(anchors.chest);
  anchors.hip = new THREE.Object3D();
  anchors.hip.position.set(0, 0, 0);
  hips.add(anchors.hip);
  let coreMat = null;
  if (kind === 'boss') {
    // 가슴의 약점 코어와 등의 가시
    coreMat = new THREE.MeshStandardMaterial({ color: '#ff7a2a', emissive: '#ff5a10', emissiveIntensity: 1.6, roughness: 0.3 });
    const core = mesh(SPH, coreMat, 0.1, 0.1, 0.07, 0, 0.32, 0.13);
    spine.add(core);
    anchors.core = new THREE.Object3D();
    anchors.core.position.set(0, 0.32, 0.16);
    spine.add(anchors.core);
    for (let k = 0; k < 6; k++) {
      const sp = mesh(CONE, SHARED.bone, 0.035, 0.18, 0.035, rnd(-0.14, 0.14), 0.15 + k * 0.07, -0.16);
      sp.rotation.x = -0.7;
      spine.add(sp);
    }
  }

  // 발밑 그림자(바닥에 붙은 어두운 얼룩)
  if (!blobMat) blobMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false });
  const blob = mesh(new THREE.PlaneGeometry(1, 1), blobMat, 1.05 * s * wide, 1.05 * s, 1);
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  root.add(blob);

  const z = {
    kind, root, body, parts, mats, anchors, coreMat, cfg, scale: s,
    radii: { head: 0.17 * s * (kind === 'brute' ? 0.9 : kind === 'boss' ? 0.9 : 1), chest: 0.3 * s * wide, hip: 0.27 * s * wide },
    height: 1.78 * s, phase: Math.random() * 10, blob,
    limp: Math.random() < 0.3 ? rnd(0.15, 0.35) : 0,
    armPose: kind === 'runner' ? rnd(-0.3, 0.2) : rnd(-1.55, -1.1),
    sway: rnd(0.8, 1.3),
    headGone: false
  };

  // 눈에 띄는 번쩍임(맞았을 때 쏜 사람 색)
  z.flash = (color, k) => {
    for (const m of mats) {
      m.emissive.set(color);
      m.emissiveIntensity = k;
    }
  };
  z.hideHead = () => {
    head.scale.setScalar(0.001);
    z.headGone = true;
  };

  // 걷기·물기·쓰러짐 동작. st: { speed(0~1), atk(물기 진행 0~1, <0 이면 안 함), flinch(0~1), dead(0~1) }
  z.animate = (dt, st) => {
    const p = parts;
    if (st.dead > 0) {
      // 팔다리가 축 늘어짐
      const k = Math.min(1, st.dead * 3);
      p.armL.rotation.x += (0.3 - p.armL.rotation.x) * k * 0.2;
      p.armR.rotation.x += (0.2 - p.armR.rotation.x) * k * 0.2;
      p.foreL.rotation.x += (-0.3 - p.foreL.rotation.x) * 0.2;
      p.foreR.rotation.x += (-0.3 - p.foreR.rotation.x) * 0.2;
      p.jaw.rotation.x = 0.5;
      return;
    }
    const sp = st.speed;
    z.phase += dt * (1.6 + sp * 9) * z.sway;
    const w = Math.sin(z.phase);
    const w2 = Math.sin(z.phase + Math.PI);
    const stride = 0.25 + sp * 0.35;
    p.legL.rotation.x = w * stride - z.limp * 0.3;
    p.legR.rotation.x = w2 * stride;
    p.kneeL.rotation.x = Math.max(0, -w) * (0.5 + z.limp);
    p.kneeR.rotation.x = Math.max(0, -w2) * 0.5;
    p.hips.position.y = 0.93 + Math.abs(Math.cos(z.phase)) * 0.025 * (1 + sp);
    p.hips.rotation.y = w * 0.1;
    const lean = (kind === 'runner' ? 0.38 : kind === 'brute' ? 0.14 : 0.2) + st.flinch * -0.55;
    p.spine.rotation.x = lean;
    p.spine.rotation.z = w * 0.07;
    p.spine.rotation.y = -w * 0.12;
    p.head.rotation.x = -lean * 0.6 + Math.sin(z.phase * 0.5) * 0.08 + st.flinch * 0.7;
    p.head.rotation.z = Math.sin(z.phase * 0.7 + 1) * 0.16;
    p.jaw.rotation.x = 0.2 + Math.max(0, Math.sin(z.phase * 0.9)) * 0.3 + (st.atk >= 0 ? 0.3 : 0);
    let bob = Math.sin(z.phase * 0.5) * 0.12;
    let armX = z.armPose + bob;
    if (kind === 'runner') armX = -0.5 + w * 0.9;
    if (st.atk >= 0) {
      // 물기: 앞으로 달려들며 팔을 휘두름
      const a = Math.sin(st.atk * Math.PI);
      armX = -1.45 + a * 0.9;
      p.spine.rotation.x = lean + a * 0.35;
      p.head.rotation.x = a * 0.5;
      p.jaw.rotation.x = 0.55 + a * 0.4;
    }
    p.armL.rotation.x = armX;
    p.armR.rotation.x = armX + (kind === 'runner' ? -w * 1.8 : 0.08);
    p.armL.rotation.z = 0.12;
    p.armR.rotation.z = -0.12;
    p.foreL.rotation.x = -0.3 + Math.sin(z.phase * 0.6) * 0.15;
    p.foreR.rotation.x = -0.3 - Math.sin(z.phase * 0.6) * 0.15;
    if (kind === 'boss' && coreMat) coreMat.emissiveIntensity = 1.2 + (st.charge || 0) * 4 + Math.sin(z.phase * 3) * 0.3;
  };
  z.animate(0, { speed: 0.5, atk: -1, flinch: 0, dead: 0 });
  return z;
}

// 가운데 조각이 길 위에 떠 있는 구급 상자(쏘면 체력 회복)
export function makeMedkit() {
  const g = new THREE.Group();
  const box = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: '#e8ecef', roughness: 0.5, emissive: '#2a6a3a', emissiveIntensity: 0.4 }));
  box.scale.set(0.52, 0.38, 0.3);
  g.add(box);
  const red = new THREE.MeshBasicMaterial({ color: '#2fe07a' });
  g.add(mesh(BOX, red, 0.26, 0.08, 0.02, 0, 0, 0.16));
  g.add(mesh(BOX, red, 0.08, 0.26, 0.02, 0, 0, 0.16));
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 28), new THREE.MeshBasicMaterial({ color: '#7dffb0', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
  halo.position.z = 0.01;
  g.add(halo);
  g.userData.halo = halo;
  return g;
}

// ================================================================
// 세계: 거리 → 쇼핑몰 → 주차장 (z 는 앞으로 갈수록 작아집니다)
// ================================================================
export const STAGE_Z = [10, -88, -156, -222]; // 구역 경계
export const HALF_W = [5.4, 4.6, 4.4]; // 구역별 좀비가 설 수 있는 좌우 폭(기둥·차를 피함)

function uvBox(w, h, d, tile, mat, ox = 0) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * dims[f][0]) / tile + ox, (uv.getY(k) * dims[f][1]) / tile);
    }
  }
  return new THREE.Mesh(geo, mat);
}

export function makeWorld() {
  const T = textures();
  const g = new THREE.Group();
  const lights = []; // { x, y, z, color, intensity, flicker, dead }
  const std = (map, o = {}) => new THREE.MeshStandardMaterial({ map, roughness: 0.9, ...o });
  const asphaltMat = std(T.asphalt);
  const concreteMat = std(T.concrete);
  const facadeMat = std(T.facade, { emissiveMap: T.facadeLit, emissive: '#ffffff', emissiveIntensity: 0.9 });
  const tileMat = std(T.tile, { roughness: 0.55 });
  const shutterMat = std(T.shutter, { metalness: 0.5, roughness: 0.55 });
  const stripeMat = std(T.stripe);
  const darkMat = new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.85 });
  const wallMat = std(T.concrete, { color: '#8a8c90' });
  const emitWhite = new THREE.MeshBasicMaterial({ color: '#dff0ff' });
  const emitDim = new THREE.MeshBasicMaterial({ color: '#2a3138' });
  const emitWarm = new THREE.MeshBasicMaterial({ color: '#ffb766' });
  const emitSodium = new THREE.MeshBasicMaterial({ color: '#ffa04d' });
  const emitRed = new THREE.MeshBasicMaterial({ color: '#ff3030' });

  const add = (m, x, y, z, ry = 0) => {
    m.position.set(x, y, z);
    m.rotation.y = ry;
    g.add(m);
    return m;
  };
  const rep = (tex, rx, ry) => {
    const t = tex.clone();
    t.needsUpdate = true;
    t.repeat.set(rx, ry);
    return t;
  };
  const car = (x, z, ry, color) => {
    const c = new THREE.Group();
    const bodyM = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.5 });
    c.add(mesh(BOX, bodyM, 1.9, 0.62, 4.3, 0, 0.55, 0));
    c.add(mesh(BOX, new THREE.MeshStandardMaterial({ color: '#0e1118', roughness: 0.2, metalness: 0.6 }), 1.7, 0.5, 2.1, 0, 1.05, -0.2));
    c.add(mesh(BOX, bodyM, 1.74, 0.08, 2.2, 0, 1.33, -0.2));
    for (const wx of [-0.95, 0.95]) {
      for (const wz of [-1.4, 1.4]) {
        const wh = mesh(CYL, darkMat, 0.34, 0.24, 0.34, wx, 0.34, wz);
        wh.rotation.z = Math.PI / 2;
        c.add(wh);
      }
    }
    c.add(mesh(BOX, emitDim, 1.5, 0.12, 0.05, 0, 0.62, 2.16));
    c.position.set(x, 0, z);
    c.rotation.y = ry;
    g.add(c);
    return c;
  };

  // ---------- 1구역: 폐허가 된 거리 (z 10 ~ -88) ----------
  const sLen = STAGE_Z[0] - STAGE_Z[1];
  const road = new THREE.Mesh(new THREE.PlaneGeometry(10, sLen), std(rep(T.asphalt, 2.5, sLen / 4)));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, (STAGE_Z[0] + STAGE_Z[1]) / 2);
  g.add(road);
  for (const sx of [-1, 1]) {
    const walk = uvBox(3.2, 0.16, sLen, 4, std(rep(T.concrete, 1, 1)));
    add(walk, sx * 6.6, 0.08, (STAGE_Z[0] + STAGE_Z[1]) / 2);
    // 건물
    let zc = STAGE_Z[0] + 4;
    while (zc > STAGE_Z[1] - 6) {
      const bw = rnd(8, 14);
      const bh = rnd(11, 24);
      const b = uvBox(9, bh, bw, 8, facadeMat, Math.random());
      add(b, sx * (8.2 + 4.5), bh / 2, zc - bw / 2);
      // 건물 앞 간판·차양
      if (Math.random() < 0.6) {
        const awn = mesh(BOX, std(null, { color: pick(['#5b2f2f', '#2f4a5a', '#4b4f3a']) }), 2.2, 0.12, bw * 0.6, sx * 7.3, 3.6, zc - bw / 2);
        awn.rotation.z = -sx * 0.12;
        g.add(awn);
      }
      zc -= bw + rnd(0, 1.2);
    }
  }
  // 차선(끊긴 노란 선)
  const dashes = new THREE.InstancedMesh(BOX, new THREE.MeshStandardMaterial({ color: '#c9a432', roughness: 0.8 }), 24);
  const _m = new THREE.Matrix4();
  for (let i = 0; i < 24; i++) {
    _m.compose(new THREE.Vector3(0, 0.012, 8 - i * 3.9), new THREE.Quaternion(), new THREE.Vector3(0.16, 0.01, 1.8));
    dashes.setMatrixAt(i, _m);
  }
  g.add(dashes);
  // 가로등(일부는 꺼짐), 깜빡이는 등
  for (let i = 0; i < 8; i++) {
    const sx = i % 2 ? 1 : -1;
    const z = 4 - i * 12;
    const x = sx * 5.3;
    add(mesh(CYL, darkMat, 0.07, 6, 0.07), x, 3, z);
    const arm = mesh(BOX, darkMat, 1.5, 0.08, 0.08, -sx * 0.7, 6, 0);
    const head = mesh(BOX, i === 3 || i === 6 ? emitDim : emitWarm, 0.5, 0.1, 0.24, -sx * 1.4, 5.95, 0);
    const lamp = new THREE.Group();
    lamp.add(arm, head);
    add(lamp, x, 0, z);
    if (i !== 3 && i !== 6) lights.push({ x: x - sx * 1.4, y: 5.4, z, color: '#ffb872', intensity: 60, flicker: i === 2 || i === 5 ? 0.6 : 0.08 });
  }
  // 드럼통 불
  for (const [bx, bz] of [[-3.6, -22], [3.6, -64]]) {
    const barrel = mesh(CYL, SHARED.rust, 0.32, 0.9, 0.32, bx, 0.45, bz);
    g.add(barrel);
    const fire = mesh(CONE, new THREE.MeshBasicMaterial({ color: '#ff8a2a' }), 0.26, 0.6, 0.26, bx, 1.2, bz);
    fire.userData.fire = true;
    g.add(fire);
    lights.push({ x: bx, y: 1.8, z: bz, color: '#ff7a2a', intensity: 55, flicker: 0.5 });
  }
  // 버려진 차들과 장애물
  const carCols = ['#7a2a2a', '#2c4a63', '#8a8a8e', '#3b4a38', '#6d5a2c'];
  [[-3.4, -4, 0.3], [3.8, -16, -0.4], [-4, -36, 0.1], [3.4, -42, 2.9], [-3.8, -58, -0.2], [4, -76, 0.5], [-3.2, -84, 3.0], [3.9, 2, 0.1]].forEach(([x, z, r], i) => car(x, z, r, carCols[i % carCols.length]));
  for (const [x, z, r] of [[-2.2, -12, 0.3], [2.6, -30, -0.2], [-2.6, -48, 0.5], [2.4, -70, 0.1]]) {
    // 모래주머니 더미
    for (let k = 0; k < 6; k++) {
      const sb = mesh(BOX, std(null, { color: '#7d7660' }), 0.6, 0.22, 0.34, x + (k % 3) * 0.62 - 0.6, 0.12 + Math.floor(k / 3) * 0.22, z);
      sb.rotation.y = r + rnd(-0.1, 0.1);
      g.add(sb);
    }
  }
  // 줄무늬 바리케이드
  for (const [x, z] of [[-1.6, -26], [1.8, -54], [-1.0, -80]]) {
    const b = mesh(BOX, stripeMat, 1.8, 0.3, 0.12, x, 0.8, z);
    g.add(b);
    g.add(mesh(BOX, darkMat, 0.08, 0.8, 0.08, x - 0.8, 0.4, z));
    g.add(mesh(BOX, darkMat, 0.08, 0.8, 0.08, x + 0.8, 0.4, z));
  }
  // 쓰레기 더미
  for (let i = 0; i < 40; i++) {
    const m = mesh(BOX, std(null, { color: pick(['#3a3a3a', '#5a4a38', '#2a3a4a', '#4a2a2a']) }), rnd(0.15, 0.5), rnd(0.05, 0.3), rnd(0.15, 0.4), rnd(-5, 5), 0.08, rnd(8, -86));
    m.rotation.y = rnd(0, 3);
    g.add(m);
  }

  // ---------- 쇼핑몰 입구 (z -88) ----------
  const doorW = 11;
  for (const sx of [-1, 1]) {
    const w = uvBox(8, 14, 3, 6, wallMat);
    add(w, sx * (doorW / 2 + 4), 7, STAGE_Z[1]);
  }
  add(uvBox(doorW + 0.2, 8.5, 3, 6, wallMat), 0, 4.5 + 5, STAGE_Z[1]);
  // 입구 위 간판
  const mallSign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.8), new THREE.MeshBasicMaterial({ map: signTex('드림 몰', '#ff4fa0') }));
  mallSign.position.set(0, 10.8, STAGE_Z[1] + 1.52);
  g.add(mallSign);
  lights.push({ x: 0, y: 8, z: STAGE_Z[1] + 5, color: '#ff4fa0', intensity: 40, flicker: 0.3 });

  // ---------- 2구역: 버려진 쇼핑몰 (z -88 ~ -156) ----------
  const mLen = STAGE_Z[1] - STAGE_Z[2];
  const mHalf = 9.4;
  const mallFloor = new THREE.Mesh(new THREE.PlaneGeometry(mHalf * 2, mLen), std(rep(T.tile, 5, mLen / 4), { roughness: 0.5 }));
  mallFloor.rotation.x = -Math.PI / 2;
  mallFloor.position.set(0, 0, (STAGE_Z[1] + STAGE_Z[2]) / 2);
  g.add(mallFloor);
  const mallCeil = new THREE.Mesh(new THREE.PlaneGeometry(mHalf * 2, mLen), std(rep(T.concrete, 4, mLen / 4), { color: '#5a5c60' }));
  mallCeil.rotation.x = Math.PI / 2;
  mallCeil.position.set(0, 7.2, (STAGE_Z[1] + STAGE_Z[2]) / 2);
  g.add(mallCeil);
  const shopNames = ['카페', '약국', '오락실', '의류', '서점', '푸드', '마트', '신발'];
  const neon = ['#46e0ff', '#ff6a8a', '#ffd23a', '#8aff7a', '#c77dff', '#ff9b3d'];
  for (const sx of [-1, 1]) {
    add(uvBox(1, 7.2, mLen, 6, wallMat), sx * (mHalf + 0.5), 3.6, (STAGE_Z[1] + STAGE_Z[2]) / 2);
    for (let i = 0; i < 8; i++) {
      const z = STAGE_Z[1] - 5 - i * 8.2;
      // 셔터(반쯤 내려옴)
      const sh = mesh(BOX, shutterMat, 0.12, 2.4 + rnd(0, 1.2), 5.6, sx * (mHalf - 0.1), 3.4 - rnd(0, 0.6), z);
      g.add(sh);
      // 쇼윈도 틀
      g.add(mesh(BOX, darkMat, 0.2, 0.3, 6.2, sx * (mHalf - 0.2), 4.7, z));
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.25), new THREE.MeshBasicMaterial({ map: signTex(shopNames[(i + (sx > 0 ? 3 : 0)) % 8], pick(neon)) }));
      sign.position.set(sx * (mHalf - 0.27), 5.5, z);
      sign.rotation.y = -sx * Math.PI / 2;
      g.add(sign);
    }
  }
  for (let i = 0; i < 8; i++) {
    const z = STAGE_Z[1] - 6 - i * 8.6;
    for (const sx of [-1, 1]) {
      const p = uvBox(0.9, 7.2, 0.9, 4, wallMat);
      add(p, sx * 5.4, 3.6, z);
    }
    // 천장 형광등(몇 개는 꺼짐)
    for (const sx of [-1, 1]) {
      const on = !((i + (sx > 0 ? 1 : 0)) % 3 === 0);
      add(mesh(BOX, on ? emitWhite : emitDim, 0.3, 0.06, 2.6, sx * 2.6, 7.12, z + 2));
    }
    if (i % 1 === 0) lights.push({ x: 0, y: 6.4, z: z + 2, color: i % 3 === 0 ? '#9fb8d8' : '#cfe8ff', intensity: i % 3 === 0 ? 22 : 38, flicker: i % 3 === 0 ? 0.7 : 0.1 });
  }
  // 죽은 분수, 벤치, 화분, 뒤집힌 카트
  const fountain = new THREE.Group();
  fountain.add(mesh(CYL, std(T.concrete), 2.2, 0.5, 2.2, 0, 0.25, 0));
  fountain.add(mesh(CYL, new THREE.MeshStandardMaterial({ color: '#10261f', roughness: 0.2, metalness: 0.3 }), 1.9, 0.52, 1.9, 0, 0.27, 0));
  fountain.add(mesh(CYL, std(T.concrete), 0.3, 1.8, 0.3, 0, 1.0, 0));
  add(fountain, 5.4, 0, -134);
  for (let i = 0; i < 7; i++) {
    const z = STAGE_Z[1] - 12 - i * 8;
    const sx = i % 2 ? 1 : -1;
    const bench = new THREE.Group();
    bench.add(mesh(BOX, std(null, { color: '#5a4630' }), 1.6, 0.08, 0.45, 0, 0.45, 0));
    bench.add(mesh(BOX, std(null, { color: '#5a4630' }), 1.6, 0.4, 0.06, 0, 0.7, -0.2));
    bench.add(mesh(BOX, darkMat, 0.08, 0.45, 0.4, -0.7, 0.22, 0), mesh(BOX, darkMat, 0.08, 0.45, 0.4, 0.7, 0.22, 0));
    add(bench, sx * 7.2, 0, z, sx * -Math.PI / 2);
    const planter = new THREE.Group();
    planter.add(mesh(BOX, std(T.concrete), 1.1, 0.7, 1.1, 0, 0.35, 0));
    planter.add(mesh(SPH, std(null, { color: '#2e4a2a' }), 0.5, 0.45, 0.5, 0, 1.0, 0));
    add(planter, sx * 3.9, 0, z + 3);
  }
  // 위쪽에서 비치는 달빛 기둥
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 3.4, 7, 20, 1, true), new THREE.MeshBasicMaterial({ color: '#9ab7ff', transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  shaft.position.set(0, 3.6, -120);
  g.add(shaft);
  lights.push({ x: 0, y: 6, z: -120, color: '#8aa8ff', intensity: 55, flicker: 0 });
  // 몰 끝: 롤 셔터 문
  add(uvBox(mHalf * 2, 7.2, 1, 6, shutterMat), 0, 3.6, STAGE_Z[2] + 0.5);

  // ---------- 3구역: 지하 주차장 (z -156 ~ -222) ----------
  const gLen = STAGE_Z[2] - STAGE_Z[3];
  const gHalf = 11;
  const gFloor = new THREE.Mesh(new THREE.PlaneGeometry(gHalf * 2, gLen), std(rep(T.concrete, 5, gLen / 4), { color: '#8a8c8f' }));
  gFloor.rotation.x = -Math.PI / 2;
  gFloor.position.set(0, 0, (STAGE_Z[2] + STAGE_Z[3]) / 2);
  g.add(gFloor);
  const gCeil = new THREE.Mesh(new THREE.PlaneGeometry(gHalf * 2, gLen), std(rep(T.concrete, 5, gLen / 4), { color: '#4a4c50' }));
  gCeil.rotation.x = Math.PI / 2;
  gCeil.position.set(0, 4.6, (STAGE_Z[2] + STAGE_Z[3]) / 2);
  g.add(gCeil);
  for (const sx of [-1, 1]) add(uvBox(1, 4.6, gLen, 6, wallMat), sx * (gHalf + 0.5), 2.3, (STAGE_Z[2] + STAGE_Z[3]) / 2);
  add(uvBox(gHalf * 2 + 2, 4.6, 1, 6, wallMat), 0, 2.3, STAGE_Z[3] - 0.5);
  // 안쪽 큰 셔터와 비상등
  add(mesh(BOX, shutterMat, 9, 3.8, 0.2, 0, 1.9, STAGE_Z[3] + 0.2), 0, 1.9, STAGE_Z[3] + 0.2);
  add(mesh(BOX, stripeMat, 9.4, 0.3, 0.3, 0, 3.9, STAGE_Z[3] + 0.3), 0, 3.9, STAGE_Z[3] + 0.3);
  for (const sx of [-1, 1]) add(mesh(BOX, emitRed, 0.5, 0.2, 0.2, sx * 5.4, 3.5, STAGE_Z[3] + 0.4), sx * 5.4, 3.5, STAGE_Z[3] + 0.4);
  lights.push({ x: 0, y: 3.4, z: STAGE_Z[3] + 3, color: '#ff3a2a', intensity: 60, flicker: 0.35 });
  for (let i = 0; i < 7; i++) {
    const z = STAGE_Z[2] - 6 - i * 9;
    for (const x of [-4.8, 4.8, -10, 10]) add(uvBox(0.8, 4.6, 0.8, 4, wallMat), x, 2.3, z);
    // 주차선
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 4; k++) g.add(mesh(BOX, new THREE.MeshBasicMaterial({ color: '#bdb79a' }), 0.12, 0.01, 4.5, sx * (6.6 + k * 1.2 - 0.2), 0.02, z + 2.2));
    }
    // 천장 배관·조명
    for (const x of [-7.5, 7.5]) {
      const pipe = mesh(CYL, std(null, { color: '#4a5058', metalness: 0.6 }), 0.14, 9, 0.14, x, 4.2, z + 4.5);
      pipe.rotation.x = Math.PI / 2;
      g.add(pipe);
    }
    add(mesh(BOX, i % 4 === 1 ? emitDim : emitSodium, 0.4, 0.07, 2.2, 0, 4.5, z));
    if (i % 4 !== 1) lights.push({ x: 0, y: 4, z, color: '#ffa04d', intensity: 40, flicker: i % 3 === 0 ? 0.5 : 0.06 });
  }
  [[-8, -166, 0.1], [8.4, -172, 3.0], [-8.2, -184, -0.1], [7.6, -190, 0.2], [-7.6, -204, 3.1], [8.2, -210, 0]].forEach(([x, z, r], i) => car(x, z, r, carCols[(i + 2) % carCols.length]));
  for (const [x, z] of [[-3.2, -176], [3.0, -186], [-2.6, -200]]) {
    g.add(mesh(BOX, stripeMat, 2.2, 0.35, 0.14, x, 0.7, z));
    g.add(mesh(BOX, darkMat, 0.1, 0.7, 0.1, x - 1, 0.35, z));
    g.add(mesh(BOX, darkMat, 0.1, 0.7, 0.1, x + 1, 0.35, z));
  }

  // 입구 틀(구역 경계 장식): 쇼핑몰→주차장 사이 천장이 낮아지는 곳
  g.userData.fireCones = g.children.filter((c) => c.userData.fire);
  return { group: g, lights };
}
