// 카트 모델과 서킷 시각 요소: 외부에서 보이는 카트, 운전석(1인칭 후드·핸들), 도로·연석·벽, 출발 아치, 나무와 산, 하늘.
// 전부 코드로 만든 도형과 캔버스 텍스처입니다. 외부 에셋은 쓰지 않습니다.
import * as THREE from 'three';
import { HALF_W, CURB_W, WALL_D } from './track.js';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...o });
const rnd = (a, b) => a + Math.random() * (b - a);

function canvasTex(w, h, draw, opt = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (opt.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (opt.nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  return t;
}
function noiseFill(g, w, h, base, amp, n) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = Math.floor(rnd(-amp, amp));
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v / 255})` : `rgba(0,0,0,${-v / 255})`;
    g.fillRect(Math.random() * w, Math.random() * h, rnd(1, 3), rnd(1, 3));
  }
}

export const glowTex = canvasTex(64, 64, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
});

// ---------------------------------------------------------------
// 카트(바깥에서 보이는 모양). 앞 +X, 오른쪽 +Z, 위 +Y.
// ---------------------------------------------------------------
const tireMat = std('#15171c', { roughness: 0.9 });
const darkMat = std('#20242c', { roughness: 0.6, metalness: 0.3 });
const whiteMat = std('#f2f3f5', { roughness: 0.4 });
const rimMat = std('#c9ced8', { roughness: 0.3, metalness: 0.8 });

function numberTex(num, color) {
  return canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(w / 2, h / 2, 29, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = color;
    g.font = '400 42px Anton, Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(num), w / 2, h / 2 + 2);
  });
}

function wheelMesh(r, w, hubColor) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 20), tireMat);
  tire.rotation.x = Math.PI / 2;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w * 1.02, 14), hubColor);
  hub.rotation.x = Math.PI / 2;
  // 굴러가는 게 보이도록 바퀴 한쪽에 줄 하나
  const mark = new THREE.Mesh(new THREE.BoxGeometry(r * 0.9, r * 0.12, w * 1.04), whiteMat);
  const spin = new THREE.Group();
  spin.add(tire, hub, mark);
  g.add(spin);
  g.userData.spin = spin;
  return g;
}

export function makeKart(color, num) {
  const body = std(color, { roughness: 0.32, metalness: 0.25 });
  const light = std(new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.35), { roughness: 0.35, metalness: 0.2 });
  const hubM = std(color, { roughness: 0.4, metalness: 0.5 });
  const g = new THREE.Group();
  const box = (w, h, d, m, x, y, z) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    g.add(b);
    return b;
  };
  box(2.1, 0.1, 0.9, darkMat, 0, 0.2, 0); // 바닥판
  box(0.95, 0.22, 0.7, body, 0.72, 0.34, 0); // 노즈
  box(0.45, 0.16, 0.52, body, 1.18, 0.29, 0);
  box(0.14, 0.06, 1.2, whiteMat, 1.4, 0.24, 0); // 앞 윙
  box(0.9, 0.3, 0.72, body, -0.18, 0.42, 0); // 시트 몸체
  box(0.85, 0.22, 0.26, light, 0.12, 0.34, 0.56); // 사이드 포드
  box(0.85, 0.22, 0.26, light, 0.12, 0.34, -0.56);
  box(0.5, 0.36, 0.5, darkMat, -0.78, 0.46, 0); // 엔진
  const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.4, 10), rimMat);
  ex.rotation.z = Math.PI / 2;
  ex.position.set(-1.12, 0.34, 0.16);
  g.add(ex);
  box(0.3, 0.5, 0.04, body, -1.02, 0.72, 0.58); // 뒷 윙
  box(0.3, 0.5, 0.04, body, -1.02, 0.72, -0.58);
  box(0.36, 0.03, 1.2, whiteMat, -1.04, 0.92, 0);
  box(0.05, 0.4, 0.05, darkMat, -0.92, 0.7, 0);
  box(0.3, 0.3, 0.4, darkMat, -0.12, 0.64, 0); // 운전자
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), std(color, { roughness: 0.25, metalness: 0.3 }));
  helmet.position.set(-0.1, 0.9, 0);
  g.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI, 0, Math.PI * 0.6), std('#0b0f18', { roughness: 0.1, metalness: 0.6 }));
  visor.rotation.y = -Math.PI / 2;
  visor.position.set(-0.02, 0.92, 0);
  g.add(visor);
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.018, 6, 16), darkMat);
  sw.position.set(0.3, 0.66, 0);
  sw.rotation.y = Math.PI / 2;
  sw.rotation.x = 0.4;
  g.add(sw);
  // 번호판(양옆)
  const tex = numberTex(num, color);
  for (const sgn of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    p.position.set(0.14, 0.36, sgn * 0.7);
    p.rotation.y = sgn > 0 ? 0 : Math.PI;
    g.add(p);
  }
  // 바퀴
  const wheels = [];
  const wheelAt = (x, z, r, w, front) => {
    const wm = wheelMesh(r, w, hubM);
    const holder = new THREE.Group();
    holder.position.set(x, r, z);
    holder.add(wm);
    g.add(holder);
    wheels.push({ holder, spin: wm.userData.spin, front });
  };
  wheelAt(0.78, 0.68, 0.24, 0.2, true);
  wheelAt(0.78, -0.68, 0.24, 0.2, true);
  wheelAt(-0.7, 0.7, 0.29, 0.3, false);
  wheelAt(-0.7, -0.7, 0.29, 0.3, false);
  // 부스트 불꽃(뒤쪽)
  const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffb347', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  flame.position.set(-1.45, 0.34, 0);
  flame.scale.set(1.3, 1.3, 1);
  g.add(flame);
  // 추격 부스트 불꽃(파랑·보라): 뒤처진 카트 꽁무니에서 길게 흔들립니다. 바깥 불꽃 + 안쪽 흰 심지.
  const chase = new THREE.Group();
  chase.position.set(-1.2, 0.36, 0);
  const chaseMat = new THREE.MeshBasicMaterial({ map: flameTex, color: '#8a7dff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, side: THREE.DoubleSide });
  const chaseCore = new THREE.MeshBasicMaterial({ map: flameTex, color: '#d8f0ff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, side: THREE.DoubleSide });
  for (const [m, w, len] of [[chaseMat, 0.62, 1.7], [chaseCore, 0.3, 1.0]]) {
    for (const rot of [0, Math.PI / 2]) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(len, w), m);
      pl.position.x = -len / 2;
      pl.rotation.x = rot;
      chase.add(pl);
    }
  }
  chase.visible = false;
  g.add(chase);
  // 무적 질주: 카트를 감싸는 금빛 후광
  const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffe680', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  aura.position.set(0, 0.6, 0);
  aura.scale.set(4.2, 3.2, 1);
  g.add(aura);
  // 그림자 모양(바닥에 붙는 검은 원)
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.2), new THREE.MeshBasicMaterial({ map: glowTex, color: '#000', transparent: true, opacity: 0.55, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.set(0, 0.03, 0);
  g.add(blob);
  g.userData = { wheels, flame, helmet, chase, chaseMat, chaseCore, aura, bodyMat: body, lightMat: light };
  return g;
}

// 불꽃 텍스처: 왼쪽(뿌리)이 진하고 오른쪽 끝으로 가늘어지는 혀 모양. 추격 불꽃에 씁니다.
const flameTex = canvasTex(128, 32, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, w, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.18, 'rgba(255,255,255,.95)');
  gr.addColorStop(0.55, 'rgba(255,255,255,.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(0, h / 2);
  g.quadraticCurveTo(w * 0.2, 1, w * 0.45, h * 0.18);
  g.quadraticCurveTo(w * 0.8, h * 0.32, w, h / 2);
  g.quadraticCurveTo(w * 0.8, h * 0.68, w * 0.45, h * 0.82);
  g.quadraticCurveTo(w * 0.2, h - 1, 0, h / 2);
  g.fill();
});

// ---------------------------------------------------------------
// 아이템전 소품: 아이템 상자, 바나나 껍질, 유도탄, 번개
// ---------------------------------------------------------------
// 상자 면: 무지개 테두리 + 가운데 큰 물음표. 글꼴이 준비된 뒤(처음 상자를 만들 때) 그립니다.
const drawBox = (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, w, h);
  ['#ff5a5f', '#ffb347', '#ffe14a', '#5ee07a', '#3ab4ff', '#c77dff'].forEach((c, i, a) => gr.addColorStop(i / (a.length - 1), c));
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.18)';
  g.fillRect(18, 18, w - 36, h - 36);
  g.clearRect(30, 30, w - 60, h - 60);
  g.fillStyle = 'rgba(255,255,255,.14)';
  g.fillRect(30, 30, w - 60, h - 60);
  g.font = '400 176px Anton, Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 14;
  g.strokeStyle = 'rgba(40,20,80,.85)';
  g.strokeText('?', w / 2, h / 2 + 10);
  g.fillStyle = '#ffffff';
  g.fillText('?', w / 2, h / 2 + 10);
};
let boxMat = null;
const boxCoreMat = new THREE.MeshBasicMaterial({ color: '#fff6c9', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
const boxGeo = new THREE.BoxGeometry(1.25, 1.25, 1.25);
const boxCoreGeo = new THREE.OctahedronGeometry(0.34, 0);

export function makeItemBox() {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  if (!boxMat) {
    const tex = canvasTex(256, 256, drawBox);
    boxMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity: 0.82, roughness: 0.2, metalness: 0.1, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.35, depthWrite: false });
  }
  const cube = new THREE.Mesh(boxGeo, boxMat);
  cube.renderOrder = 2;
  const core = new THREE.Mesh(boxCoreGeo, boxCoreMat);
  spin.add(cube, core);
  spin.position.y = 1.15;
  g.add(spin);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff2b0', transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.position.y = 1.15;
  glow.scale.set(3, 3, 1);
  g.add(glow);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.7, 20), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.04;
  g.add(shadow);
  g.userData = { spin, core, glow, shadow };
  return g;
}

// 바나나 껍질: 가운데 속살 + 바닥으로 늘어진 껍질 네 갈래 + 갈색 꼭지
const peelMat = std('#ffd93b', { roughness: 0.45, side: THREE.DoubleSide });
const peelIn = std('#fff2b5', { roughness: 0.7, side: THREE.DoubleSide });
const peelTip = std('#5c3d00', { roughness: 0.8 });
export function makeBanana() {
  const g = new THREE.Group();
  // 껍질 한 갈래: 끝이 둥근 길쭉한 판을 바깥쪽으로 휘게 만든 것
  const petalGeo = new THREE.PlaneGeometry(0.34, 0.8, 1, 8);
  const pos = petalGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + 0.4; // 0..0.8
    const x = pos.getX(i) * (1 - Math.pow(y / 0.8, 3) * 0.75);
    pos.setXYZ(i, x, y, Math.sin((y / 0.8) * 1.6) * 0.22);
  }
  petalGeo.computeVertexNormals();
  for (let i = 0; i < 4; i++) {
    const holder = new THREE.Group();
    holder.rotation.y = (i * Math.PI) / 2 + 0.4;
    const petal = new THREE.Mesh(petalGeo, peelMat);
    petal.rotation.x = 1.75; // 바깥·아래로 늘어뜨리기
    petal.position.y = 0.42;
    holder.add(petal);
    const inner = new THREE.Mesh(petalGeo, peelIn);
    inner.rotation.x = 1.75;
    inner.position.set(0, 0.42, -0.012);
    inner.scale.setScalar(0.9);
    holder.add(inner);
    g.add(holder);
  }
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 0.42, 8), peelMat);
  stem.position.y = 0.55;
  g.add(stem);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.12, 8), peelTip);
  tip.position.y = 0.8;
  g.add(tip);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.75, 18), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.3, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  g.add(shadow);
  g.scale.setScalar(1.25);
  return g;
}

// 유도탄: 빨간 몸통 + 흰 머리 + 꼬리 날개 + 뒤쪽 불꽃. 앞 +X.
const misBody = std('#ff4040', { roughness: 0.35, metalness: 0.3 });
const misNose = std('#f6f6f2', { roughness: 0.3 });
const misFin = std('#c9ced8', { roughness: 0.4, metalness: 0.6 });
export function makeMissile() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.1, 14), misBody);
  body.rotation.z = Math.PI / 2;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 14), misNose);
  nose.rotation.z = -Math.PI / 2;
  nose.position.x = 0.77;
  g.add(nose);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.12, 14), misNose);
  band.rotation.z = Math.PI / 2;
  band.position.x = 0.25;
  g.add(band);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.5), misFin);
    fin.position.x = -0.42;
    fin.rotation.x = (i * Math.PI) / 2;
    g.add(fin);
  }
  const fire = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffb347', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.95 }));
  fire.position.x = -0.8;
  fire.scale.set(1.1, 1.1, 1);
  g.add(fire);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ff6a5a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.45 }));
  halo.scale.set(2.6, 2.6, 1);
  g.add(halo);
  g.userData = { fire };
  return g;
}

// 번개 줄기: 하늘에서 카트로 떨어지는 지그재그 띠(빛나는 판 두 장을 엇갈려 세움)
const boltTex = canvasTex(64, 512, (g, w, h) => {
  const pts = [[w / 2, 0]];
  for (let y = 40; y < h; y += 40 + Math.random() * 30) pts.push([w / 2 + (Math.random() - 0.5) * w * 0.7, y]);
  pts.push([w / 2, h]);
  for (const [lw, col] of [[22, 'rgba(160,140,255,.35)'], [10, 'rgba(220,220,255,.85)'], [4, '#ffffff']]) {
    g.strokeStyle = col;
    g.lineWidth = lw;
    g.lineJoin = 'round';
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  }
});
export function makeBolt() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ map: boltTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 0 });
  for (const r of [0, Math.PI / 2]) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 26), mat);
    pl.position.y = 13;
    pl.rotation.y = r;
    g.add(pl);
  }
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#cfc4ff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  flash.position.y = 0.8;
  flash.scale.set(7, 7, 1);
  g.add(flash);
  g.userData = { mat, flash };
  g.visible = false;
  return g;
}

// ---------------------------------------------------------------
// 운전석(1인칭): 후드, 양옆 카울, 앞바퀴, 핸들. 카메라 눈높이 0.92m 기준.
// ---------------------------------------------------------------
export function makeCockpit(color) {
  const g = new THREE.Group();
  const body = std(color, { roughness: 0.3, metalness: 0.3, side: THREE.DoubleSide });
  const trim = std('#101319', { roughness: 0.7 });
  // 후드: 위에서 본 윤곽을 뽑아 올린 모양
  const sh = new THREE.Shape();
  sh.moveTo(0.95, -0.36);
  sh.lineTo(1.75, -0.28);
  sh.quadraticCurveTo(2.1, -0.2, 2.12, 0);
  sh.quadraticCurveTo(2.1, 0.2, 1.75, 0.28);
  sh.lineTo(0.95, 0.36);
  sh.lineTo(0.95, -0.36);
  const hg = new THREE.ExtrudeGeometry(sh, { depth: 0.1, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 3, curveSegments: 10 });
  hg.rotateX(-Math.PI / 2);
  const hood = new THREE.Mesh(hg, body);
  hood.position.y = 0.34;
  g.add(hood);
  // 후드 가운데 줄무늬
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.012, 0.13), whiteMat);
  stripe.position.set(1.52, 0.505, 0);
  g.add(stripe);
  // 양옆 카울(콕핏 벽)
  for (const sgn of [1, -1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.26, 0.07), body);
    wall.position.set(0.25, 0.55, sgn * 0.44);
    g.add(wall);
    const pod = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.2, 0.28), body);
    pod.position.set(0.2, 0.36, sgn * 0.62);
    g.add(pod);
  }
  // 앞바퀴(조향 따라 돌아감)
  const wheels = [];
  const hubM = std(color, { roughness: 0.4, metalness: 0.5 });
  for (const sgn of [1, -1]) {
    const holder = new THREE.Group();
    holder.position.set(1.45, 0.25, sgn * 0.78);
    const wm = wheelMesh(0.25, 0.22, hubM);
    holder.add(wm);
    g.add(holder);
    wheels.push({ holder, spin: wm.userData.spin });
  }
  // 핸들: 림 + 스포크 + 맨 위 표시. 눈앞에서 비스듬히 선 모양
  const outer = new THREE.Group();
  outer.position.set(0.7, 0.66, 0);
  outer.rotation.z = -0.5;
  const pivot = new THREE.Group();
  pivot.rotation.y = Math.PI / 2;
  outer.add(pivot);
  const spin = new THREE.Group();
  pivot.add(spin);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.02, 10, 28), trim);
  spin.add(rim);
  for (let i = 0; i < 3; i++) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.026, 0.02), trim);
    sp.rotation.z = (i * Math.PI) / 3 + Math.PI / 2;
    spin.add(sp);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 12), body);
  hub.rotation.x = Math.PI / 2;
  spin.add(hub);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.04), std('#ffe14a', { emissive: '#ffcc00', emissiveIntensity: 0.6 }));
  top.position.set(0, 0.115, 0);
  spin.add(top);
  g.add(outer);
  g.userData = { wheels, wheel: spin, bodyMat: body };
  return g;
}

// ---------------------------------------------------------------
// 서킷
// ---------------------------------------------------------------
function ribbon(track, fn, { uv = (s, side) => [side, s / 8], y = 0, step = 1 } = {}) {
  const N = track.N;
  const pos = [];
  const uvs = [];
  const idx = [];
  const n = Math.floor(N / step);
  for (let q = 0; q <= n; q++) {
    const i = (q * step) % N;
    const px = track.x[i];
    const pz = track.z[i];
    const th = track.th[i];
    const rx = -Math.sin(th);
    const rz = Math.cos(th);
    const [d0, d1, h0 = 0, h1 = 0] = fn(i);
    const s = q * step * track.ds;
    pos.push(px + rx * d0, y + h0, pz + rz * d0, px + rx * d1, y + h1, pz + rz * d1);
    const a = uv(s, 0);
    const b = uv(s, 1);
    uvs.push(a[0], a[1], b[0], b[1]);
    if (q < n) {
      const a0 = q * 2;
      idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2); // 위에서 봤을 때 앞면이 위를 향하도록
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function chevronTex(color, bg, text) {
  return canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = color;
    g.lineWidth = 16;
    g.lineJoin = 'miter';
    for (let i = 0; i < 3; i++) {
      const x = 40 + i * 62;
      g.beginPath();
      g.moveTo(x, 20);
      g.lineTo(x + 40, h / 2);
      g.lineTo(x, h - 20);
      g.stroke();
    }
    if (text) {
      g.fillStyle = color;
      g.font = '800 22px "Pretendard Variable", sans-serif';
      g.fillText(text, 8, 18);
    }
  });
}

function bannerTex(lines, bg) {
  return canvasTex(2048, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, bg[0]);
    gr.addColorStop(1, bg[1]);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.12)';
    for (let x = -h; x < w; x += 64) {
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + 32, h);
      g.lineTo(x + 32 + h, 0);
      g.lineTo(x + h, 0);
      g.fill();
    }
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '400 84px Anton, Impact, "Pretendard Variable", sans-serif';
    g.fillText(lines, w / 2, h / 2 + 4);
  });
}

export function makeTrackMeshes(track) {
  const grp = new THREE.Group();
  const anis = 8;

  // 지면(잔디)
  const grassTex = canvasTex(256, 256, (g, w, h) => {
    noiseFill(g, w, h, '#3f7d3a', 40, 4000);
    for (let i = 0; i < 400; i++) {
      g.fillStyle = Math.random() > 0.5 ? 'rgba(90,160,70,.25)' : 'rgba(20,60,25,.22)';
      g.beginPath();
      g.arc(Math.random() * w, Math.random() * h, rnd(2, 9), 0, 7);
      g.fill();
    }
  }, { repeat: true });
  grassTex.repeat.set(130, 130);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), std('#ffffff', { map: grassTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.06;
  grp.add(ground);

  // 도로
  const roadTex = canvasTex(512, 512, (g, w, h) => {
    noiseFill(g, w, h, '#3b3e46', 34, 9000);
    // 타이어 자국(차선 따라 조금 어둡게)
    for (const u of [0.3, 0.7]) {
      const gr = g.createLinearGradient((u - 0.09) * w, 0, (u + 0.09) * w, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(0.5, 'rgba(0,0,0,.18)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }
    g.fillStyle = '#f1f1ea';
    g.fillRect(w * 0.012, 0, w * 0.02, h);
    g.fillRect(w * 0.968, 0, w * 0.02, h);
    g.fillStyle = '#f2d34a';
    g.fillRect(w * 0.5 - 3, 0, 6, h * 0.34);
  }, { repeat: true });
  roadTex.repeat.set(1, 1);
  const road = new THREE.Mesh(
    ribbon(track, () => [-HALF_W, HALF_W], { uv: (s, side) => [side, s / 12], y: 0.012 }),
    std('#ffffff', { map: roadTex, roughness: 0.85 })
  );
  grp.add(road);

  // 연석(빨강·흰색)
  const curbTex = canvasTex(4, 2, (g) => {
    g.fillStyle = '#e0343a';
    g.fillRect(0, 0, 4, 1);
    g.fillStyle = '#f6f6f2';
    g.fillRect(0, 1, 4, 1);
  }, { repeat: true, nearest: true });
  const curbMat = std('#ffffff', { map: curbTex, roughness: 0.7 });
  for (const sgn of [-1, 1]) {
    const a = sgn * HALF_W;
    const b = sgn * (HALF_W + CURB_W);
    grp.add(new THREE.Mesh(ribbon(track, () => [a, b], { uv: (s, side) => [side, s / 5], y: 0.03 }), curbMat));
  }

  // 모래(도로 밖~벽 사이)
  const sandTex = canvasTex(256, 256, (g, w, h) => noiseFill(g, w, h, '#d6b982', 38, 5000), { repeat: true });
  const sandMat = std('#ffffff', { map: sandTex, roughness: 1 });
  for (const sgn of [-1, 1]) {
    const a = sgn * (HALF_W + CURB_W);
    const b = sgn * (WALL_D + 1.2);
    const geo = ribbon(track, () => [a, b], { uv: (s, side) => [side * 2, s / 8], y: 0.006 });
    grp.add(new THREE.Mesh(geo, sandMat));
  }

  // 벽(안쪽 면)
  const wallTex = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#f4f4f0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#d93a3f';
    g.fillRect(0, 0, w / 2, h);
    g.fillStyle = 'rgba(0,0,0,.18)';
    g.fillRect(0, h - 10, w, 10);
  }, { repeat: true });
  const wallMat = std('#ffffff', { map: wallTex, roughness: 0.6, side: THREE.DoubleSide });
  for (const sgn of [-1, 1]) {
    const geo = ribbon(track, () => [sgn * WALL_D, sgn * WALL_D, 0, 1.0], { uv: (s, side) => [s / 8, side], y: 0 });
    grp.add(new THREE.Mesh(geo, wallMat));
    const cap = ribbon(track, () => [sgn * WALL_D, sgn * (WALL_D + 0.5), 1.0, 1.0], { uv: (s, side) => [side, s], y: 0 });
    grp.add(new THREE.Mesh(cap, std('#2a2d36', { side: THREE.DoubleSide })));
  }

  // 출발선(체커): 진행 방향 2.4m, 도로 폭 전체
  const checker = canvasTex(64, 256, (g, w, h) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 4; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      g.fillRect((x * w) / 4, (y * h) / 16, w / 4, h / 16);
    }
  }, { nearest: true });
  const lineGeo = new THREE.PlaneGeometry(2.4, HALF_W * 2);
  lineGeo.rotateX(-Math.PI / 2);
  const line = new THREE.Mesh(lineGeo, std('#ffffff', { map: checker, roughness: 0.7 }));
  const p0 = track.at(0);
  line.position.set(p0.x, 0.045, p0.z);
  line.rotation.y = -p0.th;
  grp.add(line);

  // 아치 구조물(출발선·중간·마지막 직선)
  const gantryMat = std('#262a33', { roughness: 0.5, metalness: 0.5 });
  const gantries = [
    { s: 0, text: '출발 START', bg: ['#e0343a', '#8f1f27'] },
    { s: track.L * 0.3, text: '노을 해안 서킷', bg: ['#ff8a3d', '#c4421c'] },
    { s: track.L * 0.62, text: '카트 레이스', bg: ['#3ab4ff', '#1b5fa8'] },
    { s: track.L * 0.88, text: '질주 SPEED', bg: ['#5ee07a', '#1f7a3c'] }
  ];
  for (const gi of gantries) {
    const p = track.at(gi.s);
    const g = new THREE.Group();
    const half = WALL_D + 1.4;
    for (const sgn of [-1, 1]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8.2, 0.7), gantryMat);
      pil.position.set(0, 4.1, sgn * half);
      g.add(pil);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, half * 2 + 0.7), gantryMat);
    beam.position.set(0, 8.1, 0);
    g.add(beam);
    // 현수막: 오는 쪽(-진행 방향)을 향합니다.
    const tex = bannerTex(gi.text, gi.bg);
    const bn = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 - 0.4, 1.7), new THREE.MeshBasicMaterial({ map: tex }));
    bn.position.set(-0.47, 8.1, 0);
    bn.rotation.y = -Math.PI / 2;
    g.add(bn);
    g.position.set(p.x, 0, p.z);
    g.rotation.y = -p.th;
    grp.add(g);
  }

  // 코너 화살표 표지(급한 코너 바깥쪽)
  const chevR = chevronTex('#ffd23a', '#16181e');
  const chevL = chevR.clone();
  chevL.repeat.x = -1;
  chevL.offset.x = 1;
  chevL.needsUpdate = true;
  const poleMat = std('#555a66');
  let lastSign = 0;
  let lastS = -999;
  for (let i = 0; i < track.N; i++) {
    const kp = track.kappa[i];
    if (Math.abs(kp) < 1 / 85) { lastSign = 0; continue; }
    const s = i * track.ds;
    const sign = Math.sign(kp);
    if (sign === lastSign && s - lastS < 22) continue;
    if (s < 12) continue;
    lastSign = sign;
    lastS = s;
    // 커지는 방향(오른쪽 커브)이면 바깥은 왼쪽(-)
    const side = -sign;
    const th = track.th[i];
    const rx = -Math.sin(th);
    const rz = Math.cos(th);
    const dd = side * (WALL_D + 1.6);
    const px = track.x[i] + rx * dd;
    const pz = track.z[i] + rz * dd;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.1), new THREE.MeshBasicMaterial({ map: sign > 0 ? chevR : chevL, side: THREE.DoubleSide }));
    board.position.set(px, 2.3, pz);
    board.rotation.y = Math.atan2(-side * rx, -side * rz); // 도로 안쪽을 봄
    grp.add(board);
    for (const o of [-1.4, 1.4]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.4, 6), poleMat);
      pole.position.set(px + Math.cos(th) * o, 1.2, pz + Math.sin(th) * o);
      grp.add(pole);
    }
  }

  // 부스트 패드
  const padTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#ff8a1f';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff3c4';
    g.lineWidth = 14;
    for (let i = 0; i < 3; i++) {
      const y = 10 + i * 42;
      g.beginPath();
      g.moveTo(14, y + 36);
      g.lineTo(w / 2, y);
      g.lineTo(w - 14, y + 36);
      g.stroke();
    }
  }, { repeat: true });
  const padMat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, opacity: 0.92 });
  for (const pad of track.pads) {
    const p = track.at(pad.s);
    // 화살표(텍스처 위쪽)가 진행 방향(+X)을 가리키도록 눕힌 뒤 돌립니다.
    const geo = new THREE.PlaneGeometry(pad.w, pad.len);
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(-Math.PI / 2);
    const m = new THREE.Mesh(geo, padMat);
    const rx = -Math.sin(p.th);
    const rz = Math.cos(p.th);
    m.position.set(p.x + rx * pad.d, 0.05, p.z + rz * pad.d);
    m.rotation.y = -p.th;
    grp.add(m);
  }

  // 관중석(출발 직선 바깥쪽)
  const crowdTex = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#2b2f3a';
    g.fillRect(0, 0, w, h);
    const cols = ['#ff5a5f', '#3ab4ff', '#ffc93c', '#5ee07a', '#f4f4f0', '#c77dff'];
    for (let i = 0; i < 900; i++) {
      g.fillStyle = cols[(Math.random() * cols.length) | 0];
      g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    }
  }, { repeat: true });
  crowdTex.repeat.set(4, 1);
  const stand = new THREE.Group();
  const sp = track.at(60);
  for (let r = 0; r < 4; r++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(64, 1.1, 2.4), std('#ffffff', { map: crowdTex, roughness: 0.9 }));
    step.position.set(0, 0.55 + r * 1.1, -(WALL_D + 5 + r * 2.4));
    stand.add(step);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(68, 0.4, 13), std('#e8e8ee'));
  roof.position.set(0, 7.2, -(WALL_D + 9.5));
  stand.add(roof);
  for (const x of [-32, 32]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), gantryMat);
    post.position.set(x, 3.5, -(WALL_D + 14));
    stand.add(post);
  }
  // 도로 왼쪽(-d) 바깥에 세웁니다
  stand.position.set(sp.x, 0, sp.z);
  stand.rotation.y = -sp.th;
  grp.add(stand);

  // 나무(InstancedMesh) — 도로에서 충분히 떨어진 곳에만
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.2, 6);
  const coneGeo = new THREE.ConeGeometry(2.0, 4.2, 7);
  const cone2Geo = new THREE.ConeGeometry(1.5, 3.4, 7);
  const COUNT = 520;
  const trunks = new THREE.InstancedMesh(trunkGeo, std('#5a3d28'), COUNT);
  const cones = new THREE.InstancedMesh(coneGeo, std('#ffffff', { roughness: 0.9, flatShading: true }), COUNT);
  const cones2 = new THREE.InstancedMesh(cone2Geo, std('#ffffff', { roughness: 0.9, flatShading: true }), COUNT);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const pp = new THREE.Vector3();
  const col = new THREE.Color();
  let placed = 0;
  let tries = 0;
  const near = {};
  while (placed < COUNT && tries < 20000) {
    tries++;
    const x = rnd(-420, 400);
    const z = rnd(-290, 330);
    const loc = track.locate(x, z, null, near);
    if (Math.abs(loc.d) < WALL_D + 9) continue;
    if (Math.hypot(x - loc.cx, z - loc.cz) < WALL_D + 9) continue;
    const s = rnd(0.8, 1.7);
    sc.set(s, s, s);
    pp.set(x, 1.1 * s, z);
    trunks.setMatrixAt(placed, m4.compose(pp, q, sc));
    pp.set(x, 3.6 * s, z);
    cones.setMatrixAt(placed, m4.compose(pp, q, sc));
    pp.set(x, 5.9 * s, z);
    cones2.setMatrixAt(placed, m4.compose(pp, q, sc));
    col.setHSL(rnd(0.27, 0.38), rnd(0.4, 0.6), rnd(0.2, 0.34));
    cones.setColorAt(placed, col);
    cones2.setColorAt(placed, col);
    placed++;
  }
  trunks.count = cones.count = cones2.count = placed;
  grp.add(trunks, cones, cones2);

  // 멀리 산
  const mtMat = std('#ffffff', { roughness: 1, flatShading: true });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rnd(-0.1, 0.1);
    const r = rnd(800, 980);
    const h = rnd(90, 230);
    const m = new THREE.Mesh(new THREE.ConeGeometry(rnd(120, 220), h, 6), mtMat.clone());
    m.material.color.setHSL(0.68 + rnd(-0.04, 0.04), 0.28, rnd(0.32, 0.46));
    m.position.set(Math.cos(a) * r - 10, h / 2 - 4, Math.sin(a) * r - 15);
    m.rotation.y = rnd(0, 6);
    grp.add(m);
  }

  const padTexRef = padTex;
  return {
    group: grp,
    update(t) {
      padTexRef.offset.y = -((t * 1.4) % 1);
    }
  };
}

// 하늘: 노을 그라데이션 돔 + 해
export function makeSky() {
  const g = new THREE.Group();
  const tex = canvasTex(8, 256, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#2a3f86');
    gr.addColorStop(0.38, '#7a68b8');
    gr.addColorStop(0.58, '#f09a7a');
    gr.addColorStop(0.68, '#ffc58a');
    gr.addColorStop(0.7, '#ffd9a6');
    gr.addColorStop(1, '#ffd9a6');
    c.fillStyle = gr;
    c.fillRect(0, 0, w, h);
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1800, 24, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.renderOrder = -10;
  g.add(dome);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff0c0', fog: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sun.scale.set(420, 420, 1);
  sun.position.set(-1100, 260, -900);
  g.add(sun);
  // 구름
  const cloudTex = canvasTex(128, 64, (c, w, h) => {
    for (let i = 0; i < 26; i++) {
      const gr = c.createRadialGradient(rnd(20, 108), rnd(20, 44), 0, 64, 32, rnd(14, 28));
      gr.addColorStop(0, 'rgba(255,236,220,.5)');
      gr.addColorStop(1, 'rgba(255,236,220,0)');
      c.fillStyle = gr;
      c.fillRect(0, 0, w, h);
    }
  });
  for (let i = 0; i < 18; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, fog: false, transparent: true, depthWrite: false, opacity: rnd(0.5, 0.9) }));
    const a = rnd(0, Math.PI * 2);
    s.scale.set(rnd(260, 520), rnd(90, 170), 1);
    s.position.set(Math.cos(a) * 1300, rnd(160, 420), Math.sin(a) * 1300);
    g.add(s);
  }
  return g;
}

// ---------------------------------------------------------------
// 먼지·불꽃 파티클 풀
// ---------------------------------------------------------------
export function makePuffs(scene, count = 160) {
  const items = [];
  const mat = (c) => new THREE.SpriteMaterial({ map: glowTex, color: c, transparent: true, depthWrite: false, opacity: 0 });
  for (let i = 0; i < count; i++) {
    const s = new THREE.Sprite(mat('#d9c59a'));
    s.visible = false;
    scene.add(s);
    items.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 1, grow: 1, a: 0.6 });
  }
  let cur = 0;
  return {
    spawn(x, y, z, vx, vy, vz, color, size, life, a = 0.6, grow = 2.2) {
      const p = items[cur++ % items.length];
      p.s.visible = true;
      p.s.position.set(x, y, z);
      p.s.material.color.set(color);
      p.vx = vx; p.vy = vy; p.vz = vz;
      p.size = size; p.life = life; p.max = life; p.a = a; p.grow = grow;
    },
    update(dt) {
      for (const p of items) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) { p.s.visible = false; continue; }
        const k = p.life / p.max;
        p.s.position.x += p.vx * dt;
        p.s.position.y += p.vy * dt;
        p.s.position.z += p.vz * dt;
        const sz = p.size * (1 + (1 - k) * p.grow);
        p.s.scale.set(sz, sz, 1);
        p.s.material.opacity = p.a * k;
      }
    }
  };
}
