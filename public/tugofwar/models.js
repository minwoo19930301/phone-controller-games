// 줄다리기 모델: 운동회 운동장(흙·분필선·학교·체육관·천막·나무·만국기 풍 깃발·관중), 밧줄, 사람(둥근 몸·머리카락·얼굴·조끼·머리띠).
// 전부 코드로 만든 도형 + 캔버스 무늬입니다(외부 파일 없음). 사람은 2뼈 IK 로 팔다리를 맞춥니다.
import * as THREE from 'three';

const TAU = Math.PI * 2;
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
// 모양이 매번 같도록 쓰는 가짜 난수(운동장 무늬·관중 배치)
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mat = (color, rough = 0.7, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
export const TEAM_COLOR = { blue: '#2f6fe4', white: '#fff3dc' };
export const TEAM_ACCENT = { blue: '#ffffff', white: '#e0332c' };
export const TEAM_NAME = { blue: '청팀', white: '백팀' };

function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (opts.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  return t;
}

// ===================== 바닥 · 분필선 =====================
export function makeGround() {
  const g = new THREE.Group();
  const R = seeded(11);
  const dirt = canvasTex(1024, 1024, (c, w, h) => {
    c.fillStyle = '#b8895a';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 26000; i++) {
      const v = R();
      c.fillStyle = v < 0.5 ? `rgba(120,80,45,${0.05 + R() * 0.16})` : `rgba(235,200,150,${0.04 + R() * 0.14})`;
      const s = 1 + R() * 3.2;
      c.fillRect(R() * w, R() * h, s, s * (0.6 + R()));
    }
    // 고무래 자국(가로줄)
    for (let i = 0; i < 90; i++) {
      c.strokeStyle = `rgba(110,72,40,${0.05 + R() * 0.07})`;
      c.lineWidth = 1 + R() * 2;
      const y = R() * h;
      c.beginPath();
      c.moveTo(0, y);
      c.bezierCurveTo(w * 0.3, y + R() * 8 - 4, w * 0.6, y + R() * 8 - 4, w, y + R() * 6 - 3);
      c.stroke();
    }
    // 작은 돌멩이
    for (let i = 0; i < 160; i++) {
      c.fillStyle = `rgba(${150 + R() * 70},${130 + R() * 50},${100 + R() * 40},.55)`;
      c.beginPath();
      c.ellipse(R() * w, R() * h, 1.5 + R() * 2.5, 1 + R() * 1.6, R() * 3, 0, TAU);
      c.fill();
    }
  }, { repeat: [10, 4] });
  const field = new THREE.Mesh(new THREE.PlaneGeometry(90, 36), mat(0xffffff, 0.96, 0, { map: dirt, bumpMap: dirt, bumpScale: 1.1 }));
  field.rotation.x = -Math.PI / 2;
  field.position.set(0, 0, 6);
  field.receiveShadow = true;
  g.add(field);

  const grassTex = canvasTex(512, 512, (c, w, h) => {
    c.fillStyle = '#5b9440';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 16000; i++) {
      c.fillStyle = R() < 0.5 ? `rgba(40,100,30,${0.08 + R() * 0.2})` : `rgba(160,210,90,${0.06 + R() * 0.16})`;
      c.fillRect(R() * w, R() * h, 1 + R() * 2, 2 + R() * 5);
    }
  }, { repeat: [24, 10] });
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(260, 110), mat(0xffffff, 1, 0, { map: grassTex }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(0, -0.012, -34);
  grass.receiveShadow = true;
  g.add(grass);
  // 흙 운동장과 잔디 사이의 풀 가장자리
  const edge = new THREE.Mesh(new THREE.PlaneGeometry(90, 1.6), mat(0x4d8236, 1));
  edge.rotation.x = -Math.PI / 2;
  edge.position.set(0, 0.004, -11.6);
  edge.receiveShadow = true;
  g.add(edge);
  return g;
}

// 분필 가루 무늬(거친 흰 선)
function chalkTexture() {
  const R = seeded(5);
  return canvasTex(512, 32, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      c.fillStyle = `rgba(255,255,255,${0.35 + R() * 0.65})`;
      const y = h * (0.1 + R() * 0.8);
      c.fillRect(R() * w, y, 1 + R() * 5, 1 + R() * 2.4);
    }
    c.fillStyle = 'rgba(255,255,255,.9)';
    c.fillRect(0, h * 0.34, w, h * 0.32);
  });
}
export function makeChalk(lineX = 3.2) {
  const g = new THREE.Group();
  const tex = chalkTexture();
  tex.wrapS = THREE.RepeatWrapping;
  const mk = (w, d, tint = 0xffffff, rep = 1) => {
    const t = tex.clone();
    t.needsUpdate = true;
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(rep, 1);
    return new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: t, color: tint, transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  };
  const place = (m, x, z, rot = 0) => {
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rot;
    m.position.set(x, 0.01, z);
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  // 가운데 선과 두 팀 선(세로), 줄 양쪽의 긴 레인 선
  place(mk(6.4, 0.2, 0xffffff, 3), 0, 0, Math.PI / 2);
  for (const sx of [-1, 1]) place(mk(6.4, 0.2, 0xfff6c8, 3), sx * lineX, 0, Math.PI / 2);
  for (const z of [-3.2, 3.2]) place(mk(46, 0.18, 0xffffff, 14), 0, z);
  // 시작선(발 놓는 자리)
  for (const sx of [-1, 1]) {
    const m = mk(5, 0.14, 0xffffff, 2);
    place(m, sx * (lineX + 7.8), 0, Math.PI / 2);
  }
  return g;
}

// ===================== 하늘 =====================
export function makeSkyTexture() {
  return canvasTex(8, 512, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2f78d2');
    g.addColorStop(0.45, '#6fb2ee');
    g.addColorStop(0.78, '#bfe2fb');
    g.addColorStop(1, '#eaf5ff');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  });
}
// 반사(환경 맵)용 작은 하늘 장면: 하늘색 반구 + 해 + 흙색 바닥
export function makeEnvScene() {
  const s = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide }));
  sky.rotation.y = 0;
  s.add(sky);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(50, 32), new THREE.MeshBasicMaterial({ color: 0x9a7b55, side: THREE.DoubleSide }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1;
  s.add(ground);
  const sun = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 12, 9) }));
  sun.position.set(-18, 30, 20);
  s.add(sun);
  return s;
}
export function makeClouds() {
  const g = new THREE.Group();
  const tex = canvasTex(256, 128, (c, w, h) => {
    for (let i = 0; i < 9; i++) {
      const x = w * (0.2 + Math.random() * 0.6), y = h * (0.45 + Math.random() * 0.2), r = 22 + Math.random() * 28;
      const rg = c.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, 'rgba(255,255,255,.95)');
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = rg;
      c.fillRect(0, 0, w, h);
    }
  });
  const R = seeded(77);
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
    m.scale.set(34 + R() * 20, 15 + R() * 8, 1);
    m.position.set(-90 + i * 24 + R() * 10, 32 + R() * 14, -95 - R() * 30);
    m.userData.v = 0.15 + R() * 0.25;
    g.add(m);
  }
  return g;
}

// ===================== 학교 · 체육관 · 천막 · 나무 =====================
function facadeTexture(rows, cols, wall = '#eadfc6', frame = '#7d8a99') {
  return canvasTex(1024, 256 * rows, (c, w, h) => {
    c.fillStyle = wall;
    c.fillRect(0, 0, w, h);
    // 벽돌 결
    for (let y = 0; y < h; y += 14) {
      c.fillStyle = 'rgba(0,0,0,.035)';
      c.fillRect(0, y, w, 1);
    }
    const cw = w / cols, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        const x = k * cw + cw * 0.14, y = r * rh + rh * 0.2, ww = cw * 0.72, hh = rh * 0.56;
        c.fillStyle = frame;
        c.fillRect(x - 5, y - 5, ww + 10, hh + 10);
        const gr = c.createLinearGradient(0, y, 0, y + hh);
        gr.addColorStop(0, '#9fd0f2');
        gr.addColorStop(1, '#5d86b5');
        c.fillStyle = gr;
        c.fillRect(x, y, ww, hh);
        c.fillStyle = 'rgba(255,255,255,.5)';
        c.beginPath();
        c.moveTo(x + 4, y + hh - 4);
        c.lineTo(x + ww * 0.45, y + 4);
        c.lineTo(x + ww * 0.62, y + 4);
        c.lineTo(x + 18, y + hh - 4);
        c.fill();
        c.fillStyle = frame;
        c.fillRect(x + ww / 2 - 2, y, 4, hh);
        c.fillRect(x, y + hh * 0.46, ww, 4);
      }
      c.fillStyle = 'rgba(0,0,0,.08)';
      c.fillRect(0, (r + 1) * rh - 7, w, 7);
    }
  });
}
function bannerTexture(text, bg, fg, w = 1024, h = 160) {
  return canvasTex(w, h, (c) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(255,255,255,.7)';
    c.lineWidth = 6;
    c.strokeRect(8, 8, w - 16, h - 16);
    c.fillStyle = fg;
    c.font = `800 ${Math.floor(h * 0.56)}px "Pretendard Variable", Pretendard, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, w / 2, h / 2 + 4);
  });
}
export function makeSchool() {
  const g = new THREE.Group();
  const wing = (w, h, d, x, rows, cols) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [
      mat(0xe6dbc2, 0.9), mat(0xe6dbc2, 0.9), mat(0x6f7b8a, 0.8), mat(0x6f7b8a, 0.8),
      mat(0xffffff, 0.85, 0, { map: facadeTexture(rows, cols) }), mat(0xe6dbc2, 0.9)
    ]);
    m.position.set(x, h / 2, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    // 처마
    const eave = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.45, d + 0.8), mat(0x56626f, 0.7));
    eave.position.set(x, h + 0.2, 0);
    eave.castShadow = true;
    g.add(eave);
    return m;
  };
  wing(26, 11, 9, -17, 3, 9);
  wing(26, 11, 9, 17, 3, 9);
  // 가운데 현관 탑
  const tower = new THREE.Mesh(new THREE.BoxGeometry(10, 16, 10), [
    mat(0xefe5cd, 0.9), mat(0xefe5cd, 0.9), mat(0x6f7b8a, 0.8), mat(0x6f7b8a, 0.8), mat(0xefe5cd, 0.9), mat(0xefe5cd, 0.9)
  ]);
  tower.position.set(0, 8, 1.6);
  tower.castShadow = true;
  tower.receiveShadow = true;
  g.add(tower);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(8, 3.4, 4), mat(0x3d6a9c, 0.6));
  roof.rotation.y = Math.PI / 4;
  roof.position.set(0, 17.7, 1.6);
  roof.castShadow = true;
  g.add(roof);
  // 현관
  const door = new THREE.Mesh(new THREE.BoxGeometry(5.4, 4.2, 0.3), mat(0x4b5f78, 0.5, 0.2));
  door.position.set(0, 2.1, 6.7);
  g.add(door);
  const porch = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.5, 2.4), mat(0x6f7b8a, 0.8));
  porch.position.set(0, 4.5, 7.4);
  porch.castShadow = true;
  g.add(porch);
  for (const sx of [-3.3, 3.3]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 4.5, 12), mat(0xf2ebdc, 0.7));
    p.position.set(sx, 2.25, 8.4);
    p.castShadow = true;
    g.add(p);
  }
  // 시계
  const clock = new THREE.Mesh(new THREE.CircleGeometry(1.5, 32), new THREE.MeshStandardMaterial({
    map: canvasTex(128, 128, (c) => {
      c.fillStyle = '#fffdf4'; c.beginPath(); c.arc(64, 64, 62, 0, TAU); c.fill();
      c.strokeStyle = '#2b3442'; c.lineWidth = 5; c.stroke();
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; c.beginPath(); c.moveTo(64 + Math.sin(a) * 50, 64 - Math.cos(a) * 50); c.lineTo(64 + Math.sin(a) * 58, 64 - Math.cos(a) * 58); c.stroke(); }
      c.lineWidth = 6; c.beginPath(); c.moveTo(64, 64); c.lineTo(64, 24); c.stroke();
      c.lineWidth = 4; c.beginPath(); c.moveTo(64, 64); c.lineTo(92, 78); c.stroke();
    }), roughness: 0.4
  }));
  clock.position.set(0, 13.2, 6.65);
  g.add(clock);
  // 현수막
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(15, 2.3), new THREE.MeshStandardMaterial({ map: bannerTexture('가을 대운동회 · 청백 대항전', '#1f4fa8', '#fff6dc', 1536, 236), roughness: 0.9 }));
  banner.position.set(0, 9.2, 6.75);
  g.add(banner);
  // 국기 게양대(기둥만, 천은 추상 무늬)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 15, 8), mat(0xdedede, 0.4, 0.6));
  pole.position.set(-8.5, 7.5, 9);
  pole.castShadow = true;
  g.add(pole);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5), new THREE.MeshStandardMaterial({
    map: canvasTex(64, 40, (c) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, 64, 40); c.fillStyle = '#e0332c'; c.fillRect(0, 0, 64, 13); c.fillStyle = '#2f6fe4'; c.fillRect(0, 27, 64, 13); }),
    side: THREE.DoubleSide, roughness: 0.9
  }));
  cloth.position.set(-7.2, 13.6, 9);
  cloth.userData.flutter = true;
  g.add(cloth);
  g.userData.cloth = cloth;
  return g;
}
export function makeGym() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(16, 7, 11), mat(0xd9d2c0, 0.85));
  body.position.y = 3.5;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  const arch = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.6, 16, 28, 1, false, 0, Math.PI), mat(0x8e9ca9, 0.4, 0.65, { side: THREE.DoubleSide }));
  arch.rotation.z = Math.PI / 2;
  arch.rotation.x = Math.PI / 2;
  arch.rotation.y = 0;
  arch.position.set(0, 7, 0);
  arch.scale.set(1, 1, 0.8);
  arch.castShadow = true;
  g.add(arch);
  // 무대(앞면이 열린 단): 붉은 커튼과 현수막
  const stage = new THREE.Mesh(new THREE.BoxGeometry(11, 1.1, 4), mat(0x8a5b3a, 0.8));
  stage.position.set(0, 0.55, 7.6);
  stage.castShadow = true;
  stage.receiveShadow = true;
  g.add(stage);
  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(11, 5.6), new THREE.MeshStandardMaterial({
    map: canvasTex(256, 128, (c, w, h) => { for (let i = 0; i < 32; i++) { c.fillStyle = i % 2 ? '#a3222c' : '#c42f38'; c.fillRect((i * w) / 32, 0, w / 32, h); } }), roughness: 0.9
  }));
  curtain.position.set(0, 3.9, 5.7);
  g.add(curtain);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.0), new THREE.MeshStandardMaterial({ map: bannerTexture('체육관 무대', '#f4e6bc', '#6b2a1a', 1024, 150), roughness: 0.9 }));
  sign.position.set(0, 6.1, 5.75);
  g.add(sign);
  for (const sx of [-5.8, 5.8]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 4.2), mat(0xcfc7b3, 0.85));
    side.position.set(sx, 3, 7.5);
    side.castShadow = true;
    g.add(side);
  }
  return g;
}
export function makeTent() {
  const g = new THREE.Group();
  const stripe = canvasTex(256, 64, (c, w, h) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#ffffff' : '#2f6fe4'; c.fillRect((i * w) / 8, 0, w / 8, h); } });
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.9, 1.5, 4, 1, true), new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.85, side: THREE.DoubleSide }));
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 3.4;
  roof.castShadow = true;
  g.add(roof);
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.5, 4, 1, true), new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.85, side: THREE.DoubleSide }));
  skirt.rotation.y = Math.PI / 4;
  skirt.scale.set(1.45, 1, 1.45);
  skirt.position.y = 2.9;
  g.add(skirt);
  for (const [x, z] of [[-1.95, -1.95], [1.95, -1.95], [-1.95, 1.95], [1.95, 1.95]]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.9, 8), mat(0xd9dde2, 0.3, 0.8));
    p.position.set(x, 1.45, z);
    p.castShadow = true;
    g.add(p);
  }
  const table = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.9), mat(0xf0f0ea, 0.6));
  table.position.set(0, 0.8, 0.4);
  table.castShadow = true;
  g.add(table);
  for (const sx of [-1.1, 1.1]) for (const sz of [0.05, 0.75]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.8, 6), mat(0x888888, 0.4, 0.7));
    l.position.set(sx, 0.4, sz);
    g.add(l);
  }
  // 점수판(두 면, 글자는 setScore 로 바꿈)
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 256;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.9), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
  board.position.set(0, 1.4, 0.88);
  board.rotation.x = -0.22;
  g.add(board);
  g.userData.setScore = (b, w) => {
    const c = cv.getContext('2d');
    c.fillStyle = '#fbf4de';
    c.fillRect(0, 0, 512, 256);
    c.fillStyle = '#2f6fe4';
    c.fillRect(0, 0, 256, 256);
    c.fillStyle = '#e0332c';
    c.fillRect(256, 0, 256, 40);
    c.fillStyle = '#fff';
    c.font = '800 40px "Pretendard Variable", Pretendard, sans-serif';
    c.textAlign = 'center';
    c.fillText('청', 128, 40);
    c.fillStyle = '#fff';
    c.fillText('백', 384, 34);
    c.fillStyle = '#fff';
    c.font = '400 150px Anton, Impact, sans-serif';
    c.fillText(String(b), 128, 200);
    c.fillStyle = '#c92a22';
    c.fillText(String(w), 384, 200);
    tex.needsUpdate = true;
  };
  g.userData.setScore(0, 0);
  return g;
}
export function makeTree(seed = 1, s = 1) {
  const R = seeded(seed * 97 + 3);
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * s, 0.42 * s, 3.2 * s, 10), mat(0x6b4a2e, 0.95));
  trunk.position.y = 1.6 * s;
  trunk.castShadow = true;
  g.add(trunk);
  const greens = [0x4e8f3a, 0x5aa044, 0x3f7f35, 0x68ad4a];
  const n = 5 + Math.floor(R() * 3);
  for (let i = 0; i < n; i++) {
    const r = (1.25 + R() * 0.9) * s;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), mat(greens[Math.floor(R() * greens.length)], 0.9));
    m.position.set((R() - 0.5) * 2.4 * s, (3.4 + R() * 2.2) * s, (R() - 0.5) * 2.4 * s);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}
export function makeFence(len) {
  const g = new THREE.Group();
  const n = Math.round(len / 1.6);
  const pg = new THREE.CylinderGeometry(0.05, 0.05, 1, 6);
  const pm = mat(0xf2f2f2, 0.5, 0.2);
  for (let i = 0; i <= n; i++) {
    const p = new THREE.Mesh(pg, pm);
    p.scale.y = 1.05;
    p.position.set(-len / 2 + (i * len) / n, 0.52, 0);
    p.castShadow = true;
    g.add(p);
  }
  for (const y of [0.55, 0.95]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 6), mat(0xe0332c, 0.6));
    r.rotation.z = Math.PI / 2;
    r.position.y = y;
    g.add(r);
  }
  return g;
}

// ===================== 만국기 풍 깃발 줄(추상 색 삼각 깃발) =====================
export function makeBunting() {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-0.26, 0);
  shape.lineTo(0.26, 0);
  shape.lineTo(0, -0.62);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  const palette = ['#e0332c', '#ffd23a', '#2f6fe4', '#4cc36a', '#ffffff', '#ff8f3a', '#ff7fb5', '#7a5cff'];
  const strings = [
    { a: [-24, 6.4, -4.6], b: [24, 6.4, -4.6], sag: 1.0, n: 58 },
    { a: [-24, 8.0, -10], b: [24, 8.4, -10], sag: 1.3, n: 58 },
    { a: [-24, 5.4, 6.6], b: [-6, 7.1, 6.6], sag: 0.6, n: 20 },
    { a: [24, 5.4, 6.6], b: [6, 7.1, 6.6], sag: 0.6, n: 20 }
  ];
  const total = strings.reduce((s, x) => s + x.n, 0);
  const inst = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.85 }), total);
  inst.castShadow = true;
  const flags = [];
  const col = new THREE.Color();
  let k = 0;
  for (const s of strings) {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      pts.push(new THREE.Vector3(lerp(s.a[0], s.b[0], t), lerp(s.a[1], s.b[1], t) - Math.sin(t * Math.PI) * s.sag, lerp(s.a[2], s.b[2], t)));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.018, 4, false), mat(0x4a4a4a, 0.8)));
    for (let i = 0; i < s.n; i++) {
      const t = (i + 0.5) / s.n;
      const p = curve.getPoint(t);
      flags.push({ p, ph: Math.random() * 6, idx: k });
      inst.setColorAt(k++, col.set(palette[(i * 3 + Math.floor(i / 5)) % palette.length]));
    }
  }
  g.add(inst);
  g.userData.inst = inst;
  g.userData.flags = flags;
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _s = new THREE.Vector3(1, 1, 1);
  g.userData.update = (t) => {
    for (const f of flags) {
      _e.set(Math.sin(t * 2.1 + f.ph) * 0.12, Math.sin(t * 0.7 + f.ph) * 0.1, Math.sin(t * 2.6 + f.ph * 1.3) * 0.09);
      _q.setFromEuler(_e);
      _m.compose(f.p, _q, _s);
      inst.setMatrixAt(f.idx, _m);
    }
    inst.instanceMatrix.needsUpdate = true;
  };
  g.userData.update(0);
  // 기둥
  for (const [x, z] of [[-24, -4.6], [24, -4.6], [-24, -10], [24, -10]]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 9, 8), mat(0xdedede, 0.4, 0.6));
    p.position.set(x, 4.5, z);
    p.castShadow = true;
    g.add(p);
  }
  return g;
}

// ===================== 관중(InstancedMesh) =====================
export function makeCrowd() {
  const R = seeded(31);
  const spots = [];
  for (const side of [-1, 1]) {
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 12; i++) {
        spots.push({ x: side * (9.6 + i * 0.78 + row * 0.2 + R() * 0.25), z: -5.2 - row * 1.15 + R() * 0.2, y: row * 0.28, ph: R() * 6, sp: 3 + R() * 3, h: 0.9 + R() * 0.2 });
      }
    }
  }
  const n = spots.length;
  const g = new THREE.Group();
  const shirts = ['#e0332c', '#2f6fe4', '#ffd23a', '#fffaf0', '#4cc36a', '#ff8f3a', '#ff7fb5', '#7a5cff'];
  const skins = ['#f5d2b3', '#e8b98f', '#d9a074', '#f0c8a6', '#c88b62'];
  const hairs = ['#1c1410', '#2a1d14', '#3b2a1c', '#111111', '#5a3b22'];
  const body = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.2, 0.32, 4, 10), mat(0xffffff, 0.8), n);
  const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.19, 14, 12), mat(0xffffff, 0.75), n);
  const hair = new THREE.InstancedMesh(new THREE.SphereGeometry(0.205, 14, 10, 0, TAU, 0, Math.PI * 0.55), mat(0xffffff, 0.8), n);
  const arms = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.06, 0.34, 3, 8), mat(0xffffff, 0.8), n * 2);
  for (const m of [body, head, hair, arms]) { m.castShadow = true; g.add(m); }
  const c = new THREE.Color();
  spots.forEach((s, i) => {
    body.setColorAt(i, c.set(shirts[Math.floor(R() * shirts.length)]));
    head.setColorAt(i, c.set(skins[Math.floor(R() * skins.length)]));
    hair.setColorAt(i, c.set(hairs[Math.floor(R() * hairs.length)]));
    arms.setColorAt(i * 2, c.set(skins[Math.floor(R() * skins.length)]));
    arms.setColorAt(i * 2 + 1, c.set(skins[Math.floor(R() * skins.length)]));
  });
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3(1, 1, 1);
  g.userData.update = (t, cheer) => {
    spots.forEach((s, i) => {
      const hop = Math.max(0, Math.sin(t * s.sp + s.ph)) * (0.04 + cheer * 0.2);
      const y = s.y + hop;
      const face = s.x > 0 ? -0.5 : 0.5;
      e.set(0, face, Math.sin(t * s.sp * 0.5 + s.ph) * 0.05 * (1 + cheer));
      q.setFromEuler(e);
      sc.setScalar(s.h);
      m4.compose(p.set(s.x, y + 0.45 * s.h, s.z), q, sc);
      body.setMatrixAt(i, m4);
      m4.compose(p.set(s.x, y + 0.96 * s.h, s.z), q, sc);
      head.setMatrixAt(i, m4);
      m4.compose(p.set(s.x, y + 0.99 * s.h, s.z - Math.sin(face) * -0.02), q, sc);
      hair.setMatrixAt(i, m4);
      for (let k = 0; k < 2; k++) {
        const side = k ? 1 : -1;
        const up = cheer > 0.15 ? 1.25 + Math.sin(t * s.sp * 1.6 + s.ph + k) * 0.35 * cheer : 0.2;
        e.set(0, face, side * (0.35 + up * 0.5));
        q.setFromEuler(e);
        const ox = Math.cos(face) * 0.0;
        m4.compose(p.set(s.x + ox, y + 0.62 * s.h + (up > 1 ? 0.15 : 0), s.z + side * 0.24), q, sc);
        arms.setMatrixAt(i * 2 + k, m4);
      }
    });
    for (const m of [body, head, hair, arms]) m.instanceMatrix.needsUpdate = true;
  };
  g.userData.update(0, 0);
  return g;
}

// ===================== 밧줄 · 깃발 =====================
function braidTexture() {
  return canvasTex(64, 128, (c, w, h) => {
    c.fillStyle = '#c9a56a';
    c.fillRect(0, 0, w, h);
    for (let k = -2; k < 5; k++) {
      c.strokeStyle = k % 2 ? '#8a6a3a' : '#e6c98e';
      c.lineWidth = 9;
      c.beginPath();
      c.moveTo(-10, k * 32 + 20);
      c.lineTo(w + 10, k * 32 - 20 + 64);
      c.stroke();
      c.strokeStyle = 'rgba(60,40,20,.55)';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(-10, k * 32 + 28);
      c.lineTo(w + 10, k * 32 - 12 + 64);
      c.stroke();
    }
  }, { repeat: [1, 1] });
}
export function makeRope(segments = 56, radius = 0.075) {
  const g = new THREE.Group();
  const tex = braidTexture();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const m = mat(0xffffff, 0.9, 0, { map: tex, bumpMap: tex, bumpScale: 1.2 });
  const geo = new THREE.CylinderGeometry(radius, radius, 1, 12, 1, false);
  const segs = [];
  for (let i = 0; i < segments; i++) {
    const s = new THREE.Mesh(geo, m);
    s.castShadow = true;
    s.receiveShadow = true;
    g.add(s);
    segs.push(s);
  }
  // 줄 끝 매듭
  g.userData.segs = segs;
  return g;
}
// 줄 위에 매다는 천(깃발·리본). 가운데는 빨간 큰 깃발.
export function makeCenterFlag() {
  const g = new THREE.Group();
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.78, 8, 6), new THREE.MeshStandardMaterial({
    map: canvasTex(128, 160, (c, w, h) => {
      c.fillStyle = '#e0332c'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#fff'; c.fillRect(0, h * 0.42, w, h * 0.16);
      c.fillStyle = '#ffd23a'; c.beginPath(); c.arc(w / 2, h * 0.5, 15, 0, TAU); c.fill();
    }), roughness: 0.85, side: THREE.DoubleSide
  }));
  cloth.position.y = -0.42;
  cloth.castShadow = true;
  g.add(cloth);
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), mat(0xe0332c, 0.7));
  knot.scale.set(1.2, 1, 1.4);
  g.add(knot);
  g.userData.cloth = cloth;
  g.userData.base = cloth.geometry.attributes.position.array.slice();
  return g;
}
export function makeRibbon(team) {
  const g = new THREE.Group();
  const col = team === 'blue' ? '#2f6fe4' : '#e0332c';
  const knot = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.03, 8, 16), mat(col, 0.7));
  knot.rotation.y = Math.PI / 2;
  g.add(knot);
  for (const sx of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.55), new THREE.MeshStandardMaterial({ color: col, roughness: 0.8, side: THREE.DoubleSide }));
    t.position.set(sx * 0.06, -0.32, 0);
    t.rotation.z = sx * 0.12;
    t.castShadow = true;
    g.add(t);
  }
  return g;
}

// ===================== 사람 =====================
const L = { thigh: 0.4, shin: 0.4, torso: 0.5, uarm: 0.29, farm: 0.29 };
const SKINS = ['#f6d4b6', '#eabd94', '#dca67a', '#f1c9a5', '#cf9468', '#e4b48a'];
const HAIRS = ['#17110d', '#2a1c12', '#3c2a1b', '#0e0e0e', '#5a3b22', '#241811'];
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _y = new THREE.Vector3(0, 1, 0);

// 2뼈 IK(평면). root→target, 길이 l1, l2, 꺾이는 쪽 s(±1). 관절 위치를 돌려줌.
function ik2(rx, ry, tx, ty, l1, l2, s) {
  let dx = tx - rx, dy = ty - ry;
  let d = Math.hypot(dx, dy);
  const reach = l1 + l2 - 0.002;
  if (d > reach) { dx *= reach / d; dy *= reach / d; d = reach; }
  d = Math.max(d, Math.abs(l1 - l2) + 0.01);
  const a = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const th = Math.atan2(dy, dx) + s * a;
  return { jx: rx + l1 * Math.cos(th), jy: ry + l1 * Math.sin(th), ex: rx + dx, ey: ry + dy };
}
function limb(mesh, a, b) {
  _v.subVectors(b, a);
  const len = _v.length();
  if (len < 1e-5) return;
  mesh.position.copy(a).addScaledVector(_v, 0.5);
  mesh.quaternion.copy(_q.setFromUnitVectors(_y, _v.multiplyScalar(1 / len)));
  mesh.scale.y = len;
}

const sharedGeo = {
  cyl: new THREE.CylinderGeometry(1, 1, 1, 12, 1),
  sph: new THREE.SphereGeometry(1, 20, 14),
  torso: new THREE.CapsuleGeometry(0.2, 0.3, 6, 16)
};
export function numberPlateTexture(label, color) {
  return canvasTex(128, 96, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = color;
    c.beginPath();
    c.roundRect(4, 6, w - 8, h - 12, 18);
    c.fill();
    c.lineWidth = 7;
    c.strokeStyle = '#ffffff';
    c.stroke();
    c.fillStyle = '#0b0f17';
    c.font = '400 58px Anton, Impact, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(label, w / 2, h / 2 + 4);
  });
}
export function nameSpriteTexture(label, color) {
  return canvasTex(256, 112, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(8,12,22,.55)';
    c.beginPath();
    c.roundRect(24, 6, w - 48, 64, 30);
    c.fill();
    c.fillStyle = color;
    c.beginPath();
    c.roundRect(28, 10, w - 56, 56, 27);
    c.fill();
    c.lineWidth = 5;
    c.strokeStyle = '#ffffff';
    c.stroke();
    c.beginPath();
    c.moveTo(w / 2 - 14, 70);
    c.lineTo(w / 2 + 14, 70);
    c.lineTo(w / 2, 98);
    c.closePath();
    c.fillStyle = color;
    c.fill();
    c.fillStyle = '#0b0f17';
    c.font = '400 46px Anton, Impact, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(label, w / 2, 40);
  });
}

export class Puller {
  // o: { team, seed, slot?, name?, color?, cpu }
  constructor(o) {
    this.o = o;
    this.team = o.team;
    const R = seeded((o.seed || 1) * 7919);
    const skin = SKINS[Math.floor(R() * SKINS.length)];
    const hairC = HAIRS[Math.floor(R() * HAIRS.length)];
    this.hairStyle = Math.floor(R() * 4);
    this.scale = 0.94 + R() * 0.12;
    const teamCol = TEAM_COLOR[o.team];
    const accent = TEAM_ACCENT[o.team];
    const root = (this.root = new THREE.Group());
    const rig = (this.rig = new THREE.Group());
    root.add(rig);
    const M = {
      skin: mat(skin, 0.62),
      vest: mat(teamCol, 0.72),
      shirt: mat(o.team === 'blue' ? '#f3f6ff' : '#ffffff', 0.78),
      pants: mat(o.team === 'blue' ? '#1c3d8f' : '#2b2f3a', 0.8),
      shoe: mat('#f4f4f4', 0.6),
      sole: mat('#2b2b2b', 0.8),
      sock: mat('#ffffff', 0.85),
      hair: mat(hairC, 0.55),
      band: mat(accent === '#ffffff' ? '#ffffff' : accent, 0.7),
      dark: mat('#161212', 0.4),
      mouth: mat('#8a2a2a', 0.5),
      cheek: mat('#ff9a9a', 0.9, 0, { transparent: true, opacity: 0.5 }),
      white: mat('#ffffff', 0.3)
    };
    this.M = M;
    const mk = (geo, m, shadow = true) => {
      const x = new THREE.Mesh(geo, m);
      x.castShadow = shadow;
      x.receiveShadow = true;
      rig.add(x);
      return x;
    };
    const ball = (m, r, sx = 1, sy = 1, sz = 1) => {
      const x = mk(sharedGeo.sph, m);
      x.scale.set(r * sx, r * sy, r * sz);
      return x;
    };
    // 몸통(조끼 입은 윗몸) + 허리 + 엉덩이
    this.torso = mk(sharedGeo.torso, M.vest);
    this.torso.scale.set(0.82, 1, 1.28);
    this.pelvis = ball(M.pants, 0.2, 1.05, 0.85, 1.2);
    this.neck = mk(sharedGeo.cyl, M.skin);
    // 번호표(양쪽 면)
    this.plates = [];
    const label = o.cpu ? '' : o.name || '';
    if (label) {
      const pt = numberPlateTexture(label, o.color || '#fff');
      for (const sz of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.225), new THREE.MeshStandardMaterial({ map: pt, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
        p.rotation.y = sz > 0 ? 0 : Math.PI;
        rig.add(p);
        this.plates.push({ m: p, sz });
      }
    }
    // 머리
    const head = (this.head = new THREE.Group());
    rig.add(head);
    const hm = new THREE.Mesh(sharedGeo.sph, M.skin);
    hm.scale.set(0.205, 0.215, 0.2);
    hm.castShadow = true;
    head.add(hm);
    const add = (geo, m, x, y, z, sx = 1, sy = 1, sz = 1) => {
      const q = new THREE.Mesh(geo, m);
      q.position.set(x, y, z);
      q.scale.set(sx, sy, sz);
      q.castShadow = false;
      head.add(q);
      return q;
    };
    // 머리카락
    const hs = this.hairStyle;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14, 0, TAU, 0, Math.PI * (hs === 3 ? 0.62 : 0.56)), M.hair);
    cap.scale.set(0.222, 0.232, 0.22);
    cap.rotation.z = 0.5; // 앞이 이마, 뒤가 더 내려옴
    cap.castShadow = true;
    head.add(cap);
    if (hs === 1) { // 말총머리
      add(sharedGeo.sph, M.hair, -0.23, 0.0, 0, 0.09, 0.1, 0.09);
      const tail = add(sharedGeo.sph, M.hair, -0.33, -0.1, 0, 0.07, 0.2, 0.07);
      tail.rotation.z = 0.5;
      this.tail = tail;
    } else if (hs === 2) { // 올림머리
      add(sharedGeo.sph, M.hair, -0.04, 0.25, 0, 0.1, 0.1, 0.1);
    } else if (hs === 3) { // 단발
      add(sharedGeo.sph, M.hair, -0.1, -0.06, 0, 0.17, 0.19, 0.2);
    }
    // 이마·귀·볼
    for (const sz of [-1, 1]) {
      add(sharedGeo.sph, M.skin, -0.02, -0.01, sz * 0.2, 0.05, 0.065, 0.025); // 귀
      add(sharedGeo.sph, M.cheek, 0.155, -0.065, sz * 0.12, 0.04, 0.03, 0.02); // 볼터치
      add(sharedGeo.sph, M.dark, 0.178, 0.02, sz * 0.085, 0.026, 0.036, 0.022); // 눈
      add(sharedGeo.sph, M.white, 0.185, 0.032, sz * 0.092, 0.009, 0.011, 0.009); // 눈빛
      const brow = add(new THREE.BoxGeometry(0.05, 0.012, 0.03), M.hair, 0.172, 0.075, sz * 0.085);
      brow.rotation.y = sz * 0.3;
      brow.rotation.z = -0.1;
    }
    add(sharedGeo.sph, M.skin, 0.205, -0.02, 0, 0.035, 0.03, 0.03); // 코
    this.mouth = add(sharedGeo.sph, M.mouth, 0.185, -0.085, 0, 0.02, 0.016, 0.05);
    // 머리띠 + 매듭 끝자락
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.028, 8, 32), M.band);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.075;
    band.scale.set(1, 1, 1.05);
    head.add(band);
    this.bandTails = [];
    for (const sz of [-1, 1]) {
      const t = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.26), new THREE.MeshStandardMaterial({ color: M.band.color, side: THREE.DoubleSide, roughness: 0.7 }));
      t.position.set(-0.22, 0.04, sz * 0.03);
      t.geometry.translate(0, -0.12, 0);
      head.add(t);
      this.bandTails.push(t);
    }
    // 팔다리
    this.limbs = {};
    const mkLimb = (name, m, r) => {
      const x = mk(sharedGeo.cyl, m);
      x.userData.r = r;
      this.limbs[name] = x;
      return x;
    };
    const joint = (m, r) => ball(m, r);
    this.legs = [];
    for (const side of [-1, 1]) {
      const thigh = mkLimb('thigh' + side, M.pants, 0.092);
      const shin = mkLimb('shin' + side, M.skin, 0.062);
      const sock = mkLimb('sock' + side, M.sock, 0.07);
      const knee = joint(M.skin, 0.068);
      const kneeP = joint(M.pants, 0.094);
      const shoe = ball(M.shoe, 0.12, 1.45, 0.7, 0.75);
      const sole = ball(M.sole, 0.12, 1.5, 0.28, 0.78);
      thigh.scale.x = thigh.scale.z = 0.092;
      shin.scale.x = shin.scale.z = 0.062;
      sock.scale.x = sock.scale.z = 0.07;
      this.legs.push({ side, thigh, shin, sock, knee, kneeP, shoe, sole });
    }
    this.arms = [];
    for (const side of [-1, 1]) {
      const uarm = mkLimb('uarm' + side, M.shirt, 0.07);
      const farm = mkLimb('farm' + side, M.skin, 0.052);
      const elbow = joint(M.skin, 0.056);
      const shoulder = joint(M.shirt, 0.082);
      const hand = joint(M.skin, 0.068);
      // 슬롯 색 팔띠
      let tag = null;
      if (o.color && !o.cpu) {
        tag = mk(sharedGeo.cyl, mat(o.color, 0.6));
        tag.userData.r = 0.078;
      }
      uarm.scale.x = uarm.scale.z = 0.07;
      farm.scale.x = farm.scale.z = 0.052;
      this.arms.push({ side, uarm, farm, elbow, shoulder, hand, tag });
    }
    // 이름표(머리 위, 항상 보임)
    if (!o.cpu && o.name) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameSpriteTexture(o.name, o.color || '#fff'), transparent: true, depthTest: false, fog: false }));
      sp.scale.set(0.82, 0.36, 1);
      sp.renderOrder = 20;
      root.add(sp);
      this.tag = sp;
    } else if (o.cpu) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameSpriteTexture('CPU', 'rgba(210,214,222,1)'), transparent: true, depthTest: false, fog: false, opacity: 0.8 }));
      sp.scale.set(0.5, 0.22, 1);
      sp.renderOrder = 20;
      root.add(sp);
      this.tag = sp;
    }
    root.scale.setScalar(this.scale);
    this.P = {};
    this.pose({ a: 0.4, px: -0.1, py: 0.62, footF: [0.28, 0], footB: [-0.46, 0], handF: [0.5, 1.0], handB: [0.3, 1.0], mouth: 0.3, nod: 0 });
  }

  // P: { a, px, py, footF:[x,y], footB:[x,y], handF:[x,y], handB:[x,y], mouth, nod, shoulderZ?, kneeBias?, elbowBias? } (몸 기준 좌표: 앞이 +x)
  pose(P) {
    this.P = P;
    const a = P.a;
    const sa = Math.sin(a), ca = Math.cos(a);
    const pel = new THREE.Vector3(P.px, P.py, 0);
    const sh = new THREE.Vector3(P.px - L.torso * sa, P.py + L.torso * ca, 0);
    // 몸통
    this.pelvis.position.set(P.px, P.py - 0.02, 0);
    this.torso.position.set(P.px - 0.27 * sa, P.py + 0.27 * ca, 0);
    this.torso.rotation.z = a;
    for (const p of this.plates) {
      p.m.position.set(this.torso.position.x + 0.0 - 0.02 * sa, this.torso.position.y + 0.02, p.sz * 0.262);
      p.m.rotation.z = a;
    }
    this.neck.position.set(sh.x - 0.07 * sa, sh.y + 0.07 * ca, 0);
    this.neck.scale.set(0.055, 0.1, 0.055);
    this.neck.rotation.z = a;
    const headY = sh.y + 0.26 * ca - (a < 0 ? 0 : 0);
    const hx = sh.x - 0.26 * sa + 0.03;
    this.head.position.set(hx, headY, 0);
    this.head.rotation.z = a * 0.35 - (P.nod || 0);
    this.head.rotation.y = P.turn ?? 0.45;
    this.mouth.scale.set(0.02, 0.014 + 0.05 * (P.mouth ?? 0.3), 0.05);
    for (let i = 0; i < 2; i++) {
      const t = this.bandTails[i];
      t.rotation.z = 0.5 + (P.flutter ?? 0);
      t.rotation.x = (i ? 1 : -1) * 0.25;
    }
    if (this.tail) this.tail.rotation.z = 0.5 - (P.flutter ?? 0) * 0.8;
    const A = new THREE.Vector3(), B = new THREE.Vector3();
    // 다리: 앞발/뒷발(깊이 ±0.13)
    for (const lg of this.legs) {
      const foot = lg.side > 0 ? P.footF : P.footB;
      const z = lg.side * 0.13;
      const hip = ik2(P.px - 0.02, P.py - 0.04, foot[0] - 0.02, foot[1] + 0.1, L.thigh, L.shin, 1);
      A.set(P.px - 0.02, P.py - 0.04, z);
      B.set(hip.jx, hip.jy, z);
      limb(lg.thigh, A, B);
      lg.thigh.scale.x = lg.thigh.scale.z = 0.092;
      lg.kneeP.position.copy(B);
      lg.kneeP.scale.setScalar(0.094);
      A.copy(B);
      B.set(hip.ex, hip.ey, z);
      limb(lg.shin, A, B);
      lg.shin.scale.x = lg.shin.scale.z = 0.062;
      // 양말(정강이 아랫쪽 40%)
      const s0 = new THREE.Vector3().lerpVectors(A, B, 0.55);
      limb(lg.sock, s0, B);
      lg.sock.scale.x = lg.sock.scale.z = 0.068;
      lg.knee.position.copy(A);
      lg.knee.scale.setScalar(0.066);
      lg.shoe.position.set(foot[0] + 0.06, foot[1] + 0.07, z);
      lg.sole.position.set(foot[0] + 0.06, foot[1] + 0.02, z);
      lg.shoe.rotation.z = P.footAngle ?? 0;
    }
    // 팔: 어깨(깊이 ±0.2) → 손(깊이 ±0.07)
    for (const ar of this.arms) {
      const hnd = ar.side > 0 ? P.handF : P.handB;
      const sz = ar.side * 0.215;
      const shx = sh.x + 0.0, shy = sh.y - 0.04;
      const r = ik2(shx, shy, hnd[0], hnd[1], L.uarm, L.farm, P.elbowDir ?? -1);
      const hz = ar.side * 0.075;
      A.set(shx, shy, sz);
      B.set(r.jx, r.jy, lerp(sz, hz, 0.5));
      limb(ar.uarm, A, B);
      ar.uarm.scale.x = ar.uarm.scale.z = 0.07;
      ar.shoulder.position.copy(A);
      ar.shoulder.scale.setScalar(0.082);
      ar.elbow.position.copy(B);
      ar.elbow.scale.setScalar(0.056);
      A.copy(B);
      B.set(r.ex, r.ey, hz);
      limb(ar.farm, A, B);
      ar.farm.scale.x = ar.farm.scale.z = 0.052;
      ar.hand.position.copy(B);
      ar.hand.scale.set(0.07, 0.062, 0.07);
      if (ar.tag) {
        const t0 = new THREE.Vector3().lerpVectors(A.set(shx, shy, sz), new THREE.Vector3(r.jx, r.jy, lerp(sz, hz, 0.5)), 0.5);
        const t1 = new THREE.Vector3().lerpVectors(A, new THREE.Vector3(r.jx, r.jy, lerp(sz, hz, 0.5)), 0.78);
        limb(ar.tag, t0, t1);
        ar.tag.scale.x = ar.tag.scale.z = 0.078;
      }
    }
    if (this.tag) this.tag.position.set(hx, headY + 0.52, 0);
  }
  headWorld(target = new THREE.Vector3()) {
    this.head.getWorldPosition(target);
    return target;
  }
  dispose() {
    this.root.traverse((o) => { if (o.material && o.material.map && o.userData.own) o.material.map.dispose(); });
  }
}

// ===================== 구령 담당(큰북 + 흰 옷) =====================
export function makeCaller() {
  const g = new THREE.Group();
  const stand = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 1.6), mat(0x9b6b3d, 0.8));
  stand.position.y = 0.3;
  stand.castShadow = true;
  stand.receiveShadow = true;
  g.add(stand);
  const drumSkin = canvasTex(128, 128, (c) => {
    const r = c.createRadialGradient(64, 64, 4, 64, 64, 62);
    r.addColorStop(0, '#f7e8c8'); r.addColorStop(0.7, '#ead6a8'); r.addColorStop(1, '#c9a96a');
    c.fillStyle = r; c.fillRect(0, 0, 128, 128);
    c.strokeStyle = '#b9283a'; c.lineWidth = 10; c.beginPath(); c.arc(64, 64, 54, 0, TAU); c.stroke();
  });
  const drumBody = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.42, 36), [mat(0xb9283a, 0.5), mat(0xffffff, 0.5, 0, { map: drumSkin }), mat(0xffffff, 0.5, 0, { map: drumSkin })]);
  drumBody.rotation.x = 0.95;
  drumBody.position.set(0.0, 1.32, 0.1);
  drumBody.castShadow = true;
  g.add(drumBody);
  for (const sx of [-0.45, 0.45]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.95, 8), mat(0x6b4426, 0.8));
    leg.position.set(sx, 0.95, 0.05);
    leg.rotation.z = sx * 0.4;
    leg.castShadow = true;
    g.add(leg);
  }
  const caller = new Puller({ team: 'white', seed: 91, cpu: true });
  caller.root.remove(caller.tag);
  caller.tag = null;
  caller.root.position.set(0, 0.6, -0.9);
  caller.root.rotation.y = -0.2 + Math.PI / 2 * 0;
  g.add(caller.root);
  // 뒤쪽을 보고 서서 박자를 치는 모습: 카메라 쪽(+z) 으로 몸을 틂
  caller.root.rotation.y = -Math.PI / 2 + 0.5;
  // 호루라기 줄 없이 깔끔하게
  const sticks = [];
  for (let i = 0; i < 2; i++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 6), mat(0xe9d7ad, 0.6));
    s.castShadow = true;
    caller.rig.add(s);
    sticks.push(s);
  }
  g.userData.caller = caller;
  g.userData.drum = drumBody;
  g.userData.sticks = sticks;
  return g;
}
