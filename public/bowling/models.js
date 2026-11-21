// 볼링장 모델: 핀(선반 가공 단면 + 목 부분 빨간 줄), 공(손가락 구멍·소용돌이 무늬), 레인(나무 결·기름 광택·화살표·점),
// 핀세터 하우징(스윕 바), 볼 리턴·볼 랙, 천장 점수 모니터, 옆 레인, 좌석, 카펫.
// 3D 좌표: x = 가로, y = 위, z = -(파울 라인에서 핀 쪽 거리). 물리 좌표 (x, y) → three (x, 0, -y).
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { C, PIN_SPOTS } from './physics.mjs';

export const PIN_H = 0.381;
export const LANE_LEN = C.PIT_Y; // 파울 라인에서 데크 끝까지
export const LANE_SPACING = 1.6;
export const APPROACH = 5.2;
const TAU = Math.PI * 2;

const rnd = (() => { let a = 12345; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; })();
const canvasTex = (w, h, draw, { repeat, srgb = true, aniso = 8 } = {}) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
};

// ---------- 핀 ----------
const PIN_PROFILE = [
  [0, 0], [0.0255, 0], [0.0287, 0.006], [0.0345, 0.025], [0.045, 0.055], [0.0545, 0.085], [0.060, 0.112], [0.0605, 0.125], [0.0575, 0.15],
  [0.05, 0.185], [0.04, 0.215], [0.03, 0.24], [0.0235, 0.262], [0.0228, 0.275], [0.0245, 0.292], [0.029, 0.312], [0.0318, 0.33], [0.0305, 0.352],
  [0.0245, 0.37], [0.012, 0.379], [0, 0.381]
];
let pinGeo = null;
export function pinGeometry() {
  if (pinGeo) return pinGeo;
  const curve = new THREE.SplineCurve(PIN_PROFILE.map(([r, h]) => new THREE.Vector2(r, h)));
  const pts = curve.getPoints(70).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
  pts[0].x = 0; pts[pts.length - 1].x = 0;
  const g = new THREE.LatheGeometry(pts, 40);
  // 높이에 따라 빨간 줄(목 부분 두 줄)과 밑동 살짝 어둡게
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i);
    let r = 0.97, gr = 0.96, b = 0.92;
    const stripe = (a, b2) => h > a && h < b2;
    if (stripe(0.2575, 0.2645) || stripe(0.2755, 0.2825)) { r = 0.78; gr = 0.06; b = 0.07; }
    if (h < 0.012) { r = gr = b = 0.55; }
    col[i * 3] = r; col[i * 3 + 1] = gr; col[i * 3 + 2] = b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  pinGeo = g;
  return g;
}
let pinMat = null;
export function pinMaterial() {
  if (!pinMat) {
    pinMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.28, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.1 });
  }
  return pinMat;
}
export function makePin() {
  const pivot = new THREE.Group(); // 핀 밑동 중심이 원점
  const m = new THREE.Mesh(pinGeometry(), pinMaterial());
  m.castShadow = true; m.receiveShadow = true;
  pivot.add(m);
  return pivot;
}

// ---------- 공 ----------
export function ballTexture(color) {
  const base = new THREE.Color(color);
  const hsl = {}; base.getHSL(hsl);
  const dark = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s + 0.1), hsl.l * 0.45);
  const light = new THREE.Color().setHSL((hsl.h + 0.05) % 1, hsl.s, Math.min(0.85, hsl.l * 1.35 + 0.1));
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = `#${dark.getHexString()}`; g.fillRect(0, 0, w, h);
    const r = (() => { let a = base.getHex(); return () => { a = (a * 1103515245 + 12345) >>> 0; return a / 4294967296; }; })();
    for (let k = 0; k < 26; k++) {
      const y0 = r() * h, amp = 12 + r() * 40, ph = r() * TAU, wd = 6 + r() * 26;
      g.strokeStyle = k % 3 === 0 ? `#${light.getHexString()}` : `#${base.getHexString()}`;
      g.globalAlpha = 0.28 + r() * 0.4; g.lineWidth = wd;
      g.beginPath();
      for (let x = 0; x <= w; x += 8) { const y = y0 + Math.sin(x / w * TAU * (1 + (k % 3)) + ph) * amp; if (x === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
    }
    g.globalAlpha = 1;
  });
}
const holeMat = new THREE.MeshStandardMaterial({ color: '#07080b', roughness: 0.9 });
export function makeBall(color = '#ff5a5f') {
  const g = new THREE.Group();
  const roll = new THREE.Group(); // 굴러가는 회전(구멍도 같이 돎)
  g.add(roll);
  const mat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: ballTexture(color), roughness: 0.16, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.3 });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(C.BALL_R, 56, 36), mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  roll.add(mesh);
  // 구멍 셋(엄지 하나·손가락 둘): 구면 위 한 점을 향해 놓습니다.
  const holes = new THREE.Group();
  const hole = (r, th, ph) => {
    const d = new THREE.Mesh(new THREE.CircleGeometry(r, 20), holeMat);
    const dir = new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
    d.position.copy(dir.clone().multiplyScalar(C.BALL_R * 1.001));
    d.lookAt(dir.clone().multiplyScalar(2));
    holes.add(d);
  };
  hole(0.0125, 0.5, 0.2); hole(0.0105, 0.34, 1.35); hole(0.0105, 0.34, 1.9);
  roll.add(holes);
  g.userData = { roll, mat, mesh, color };
  return g;
}
export function setBallColor(ball, color) {
  if (ball.userData.color === color) return;
  ball.userData.color = color;
  ball.userData.mat.map = ballTexture(color);
  ball.userData.mat.needsUpdate = true;
}

// ---------- 레인 ----------
function laneTexture() {
  // 나무 판 39장: 앞 4.3m 는 소나무(진한 색), 뒤는 단풍나무(밝은 색). 세로 1024, 가로 512.
  return canvasTex(512, 2048, (g, w, h) => {
    const boards = 39, bw = w / boards;
    const pineEnd = h * (4.3 / LANE_LEN);
    for (let b = 0; b < boards; b++) {
      const tone = rnd();
      for (const [y0, y1, pine] of [[0, pineEnd, true], [pineEnd, h, false]]) {
        const hue = pine ? 30 : 34, sat = pine ? 58 : 66, lum = pine ? 38 + tone * 6 : 53 + tone * 7;
        g.fillStyle = `hsl(${hue + tone * 4},${sat}%,${lum}%)`;
        g.fillRect(b * bw, y0, bw, y1 - y0);
        // 나뭇결
        for (let k = 0; k < 14; k++) {
          g.strokeStyle = `hsla(${hue - 4},${sat}%,${lum - 14 + rnd() * 8}%,${0.12 + rnd() * 0.12})`;
          g.lineWidth = 0.6 + rnd() * 1.2;
          const x = b * bw + rnd() * bw;
          g.beginPath(); g.moveTo(x, y0); g.lineTo(x + (rnd() - 0.5) * 3, y1); g.stroke();
        }
      }
      // 판 사이 이음매
      g.fillStyle = 'rgba(70,40,15,.45)'; g.fillRect(b * bw, 0, 0.9, h);
    }
    // 판 끝 이음(옆으로 가는 선)
    for (let k = 0; k < 26; k++) {
      const x = Math.floor(rnd() * boards) * bw, y = rnd() * h;
      g.fillStyle = 'rgba(70,40,15,.35)'; g.fillRect(x, y, bw, 1.2);
    }
    // 소나무와 단풍나무 사이 이음
    g.fillStyle = 'rgba(60,35,10,.5)'; g.fillRect(0, pineEnd - 1, w, 2);
  });
}
function laneRoughness() {
  // 기름 칠한 앞 2/3 는 거울처럼, 뒤쪽은 거칠게(드라이)
  return canvasTex(8, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    const oil = C.OIL_END / LANE_LEN;
    const v = (r) => `rgb(${Math.round(r * 255)},${Math.round(r * 255)},${Math.round(r * 255)})`;
    grd.addColorStop(0, v(0.5)); grd.addColorStop(0.03, v(0.2)); grd.addColorStop(oil * 0.9, v(0.18)); grd.addColorStop(oil + 0.08, v(0.4)); grd.addColorStop(1, v(0.5));
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, { srgb: false });
}
const SHARED = {};
function shared() {
  if (SHARED.ok) return SHARED;
  SHARED.laneTex = laneTexture();
  SHARED.laneRough = laneRoughness();
  SHARED.laneMat = new THREE.MeshPhysicalMaterial({ map: SHARED.laneTex, roughnessMap: SHARED.laneRough, roughness: 1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.9 });
  SHARED.approachTex = canvasTex(1024, 512, (g, w, h) => {
    for (let b = 0; b < 48; b++) {
      const bw = w / 48, tone = rnd();
      g.fillStyle = `hsl(${34 + tone * 5},${55 + tone * 12}%,${50 + tone * 8}%)`; g.fillRect(b * bw, 0, bw, h);
      for (let k = 0; k < 6; k++) { g.strokeStyle = `hsla(30,60%,35%,${0.1 + rnd() * 0.1})`; g.lineWidth = 0.8; const x = b * bw + rnd() * bw; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 2, h); g.stroke(); }
      g.fillStyle = 'rgba(70,40,15,.4)'; g.fillRect(b * bw, 0, 0.9, h);
    }
  });
  SHARED.approachMat = new THREE.MeshPhysicalMaterial({ map: SHARED.approachTex, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 0.7 });
  SHARED.dark = new THREE.MeshStandardMaterial({ color: '#2a1a12', roughness: 0.5, metalness: 0.1 });
  SHARED.inlay = new THREE.MeshStandardMaterial({ color: '#2b1608', roughness: 0.45, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  SHARED.gutterMat = new THREE.MeshPhysicalMaterial({ color: '#1b1d24', roughness: 0.25, metalness: 0.6, clearcoat: 0.6, side: THREE.DoubleSide, envMapIntensity: 0.8 });
  SHARED.ok = true;
  return SHARED;
}

function arrowShape(len = 0.18, wid = 0.045) {
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(wid / 2, -len); s.lineTo(-wid / 2, -len); s.closePath();
  return new THREE.ShapeGeometry(s);
}

// 레인 하나(바닥·거터·핀 데크 가장자리·표식). 중심 x = cx.
export function makeLane(cx, { detailed = true, dim = false } = {}) {
  const S = shared();
  let laneMat = S.laneMat;
  if (dim) { if (!S.laneDim) { S.laneDim = S.laneMat.clone(); S.laneDim.color.set('#8a8a8a'); } laneMat = S.laneDim; }
  const g = new THREE.Group();
  g.position.x = cx;
  const lane = new THREE.Mesh(new THREE.PlaneGeometry(C.LANE_W, LANE_LEN), laneMat);
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(0, 0, -LANE_LEN / 2);
  lane.receiveShadow = true;
  g.add(lane);
  // 접근 구역(어프로치)
  const ap = new THREE.Mesh(new THREE.PlaneGeometry(LANE_SPACING, APPROACH), S.approachMat);
  ap.rotation.x = -Math.PI / 2;
  ap.position.set(0, -0.0005, APPROACH / 2);
  ap.receiveShadow = true;
  g.add(ap);
  // 파울 라인
  const foul = new THREE.Mesh(new THREE.PlaneGeometry(C.LANE_W + 0.5, 0.025), new THREE.MeshStandardMaterial({ color: '#1a0f08', roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  foul.rotation.x = -Math.PI / 2; foul.position.set(0, 0.001, 0.0125);
  g.add(foul);
  // 거터(반원통)
  for (const side of [-1, 1]) {
    // 아래 반쪽만 쓰는 원통(오목한 쪽이 위): y축이 길이 방향이므로 눕힘
    const geo = new THREE.CylinderGeometry(0.117, 0.117, LANE_LEN, 24, 1, true, -Math.PI / 2, Math.PI);
    geo.rotateX(Math.PI / 2);
    const gut = new THREE.Mesh(geo, S.gutterMat);
    gut.position.set(side * (C.HALF + 0.117), 0, -LANE_LEN / 2);
    gut.receiveShadow = true;
    g.add(gut);
    // 거터 바깥 덮개(카핑)
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, LANE_LEN + 0.4), S.dark);
    cap.position.set(side * (C.HALF + 0.235 + 0.0175), -0.002, -LANE_LEN / 2 + 0.2);
    g.add(cap);
  }
  if (detailed) {
    // 점(어프로치 앞 7개) · 화살표(파울 라인에서 4.5m 정도, 7개)
    const dotGeo = new THREE.CircleGeometry(0.0095, 14);
    for (let k = 0; k < 7; k++) {
      const x = (k - 3) * (C.LANE_W / 8.6);
      const d = new THREE.Mesh(dotGeo, S.inlay);
      d.rotation.x = -Math.PI / 2; d.position.set(x, 0.0015, 1.2);
      g.add(d);
      const d2 = d.clone(); d2.position.z = 1.55; if (k % 2 === 0) g.add(d2);
    }
    const arGeo = arrowShape(0.2, 0.05);
    const lens = [0.12, 0.17, 0.22, 0.27, 0.22, 0.17, 0.12];
    for (let k = 0; k < 7; k++) {
      const x = (k - 3) * (C.LANE_W / 8.6);
      const z = -4.32 - (3 - Math.abs(k - 3)) * 0.25 + 0.15 - 0.2;
      const a = new THREE.Mesh(arrowShape(lens[k] + 0.14, 0.05), S.inlay);
      a.rotation.x = -Math.PI / 2;
      a.position.set(x, 0.0015, -4.32 - (3 - Math.abs(k - 3)) * 0.22);
      void z; void arGeo;
      g.add(a);
    }
    // 레인 중간 근접 표식 (유도 점 2열)
    for (let k = 0; k < 5; k++) {
      const row = new THREE.Mesh(new THREE.CircleGeometry(0.008, 10), S.inlay);
      row.rotation.x = -Math.PI / 2; row.position.set((k - 2) * 0.09, 0.0015, -2.4 - (k % 2) * 0.12);
      g.add(row);
    }
  }
  return g;
}

// 핀세터 하우징 + 마스킹 유닛 + 피트 + 스윕 바
export function makePinsetter(cx, { logo = 'STRIKE\nCLUB', detailed = true } = {}) {
  const S = shared();
  const g = new THREE.Group();
  g.position.x = cx;
  const zb = -LANE_LEN;
  // 피트(데크 뒤 낮은 바닥)
  const pit = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 1.5), new THREE.MeshStandardMaterial({ color: '#0b0c10', roughness: 0.8 }));
  pit.position.set(0, -0.5, zb - 0.75);
  g.add(pit);
  const cushion = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.9, 0.12), new THREE.MeshStandardMaterial({ color: '#2a1610', roughness: 0.95 }));
  cushion.position.set(0, -0.1, zb - 1.45);
  cushion.receiveShadow = true;
  g.add(cushion);
  // 데크 끝 벽(피트 쪽 턱)
  const lip = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 0.04), new THREE.MeshStandardMaterial({ color: '#16110f', roughness: 0.6 }));
  lip.position.set(0, -0.25, zb - 0.02);
  g.add(lip);
  // 마스킹 유닛(핀 위를 덮는 상자) — 앞면에 로고 간판
  const housing = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: '#171b27', roughness: 0.42, metalness: 0.3, clearcoat: 0.5, envMapIntensity: 0.9 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.25, 1.6), bodyMat);
  box.position.set(0, 1.55, zb - 0.85);
  box.castShadow = detailed;
  housing.add(box);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.82), new THREE.MeshBasicMaterial({
    map: canvasTex(512, 280, (c, w, h) => {
      const gr = c.createLinearGradient(0, 0, w, h);
      gr.addColorStop(0, '#15203a'); gr.addColorStop(1, '#1f1536');
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#ff9a3c'; c.lineWidth = 5; c.strokeRect(10, 10, w - 20, h - 20);
      c.strokeStyle = '#3ee6d6'; c.lineWidth = 3; c.strokeRect(20, 20, w - 40, h - 40);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '900 84px Anton, Impact, sans-serif';
      const lines = logo.split('\n');
      lines.forEach((l, i) => {
        c.fillStyle = i ? '#3ee6d6' : '#ffd23a';
        c.shadowColor = i ? '#3ee6d6' : '#ff9a3c'; c.shadowBlur = 22;
        c.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 96);
      });
    }), toneMapped: false
  }));
  sign.position.set(0, 1.62, zb - 0.045 + 0.0);
  sign.position.z = zb - 0.05;
  housing.add(sign);
  // 앞쪽 처마(핀 위 어두운 영역)와 커튼 느낌의 줄무늬
  const eave = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.35), new THREE.MeshStandardMaterial({ color: '#0a0c12', roughness: 0.6 }));
  eave.position.set(0, 0.88, zb - 0.1);
  housing.add(eave);
  g.add(housing);
  // 스윕 바: 가로 막대 + 양쪽 끝 흰 캡 + 팔
  const sweep = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.62, 16), new THREE.MeshStandardMaterial({ color: '#b9bfcb', metalness: 0.8, roughness: 0.3 }));
  bar.rotation.z = Math.PI / 2;
  bar.castShadow = true;
  sweep.add(bar);
  for (const s of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 16), new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.4 }));
    cap.rotation.z = Math.PI / 2; cap.position.x = s * 0.82;
    sweep.add(cap);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.05), new THREE.MeshStandardMaterial({ color: '#4a4f5a', metalness: 0.6, roughness: 0.4 }));
    arm.position.set(s * 0.8, 0.27, 0);
    sweep.add(arm);
  }
  sweep.position.set(0, 0.9, zb + 0.5);
  g.add(sweep);
  g.userData.sweep = sweep;
  g.userData.zb = zb;
  void S;
  return g;
}

// 핀 랙(옆 레인 장식·본 레인 기본 위치 공용)
export function makePinRack(parent, cx) {
  const pins = [];
  for (let i = 0; i < 10; i++) {
    const p = makePin();
    p.position.set(cx + PIN_SPOTS[i].x, 0, -PIN_SPOTS[i].y);
    parent.add(p);
    pins.push(p);
  }
  return pins;
}

// ---------- 점수 모니터(천장) ----------
export function makeMonitor(w = 1.9, h = 1.1) {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, h + 0.12, 0.1), new THREE.MeshStandardMaterial({ color: '#0e1118', roughness: 0.4, metalness: 0.5 }));
  g.add(frame);
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = Math.round(1024 * h / w);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  screen.position.z = 0.052;
  g.add(screen);
  // 매다는 줄
  for (const s of [-1, 1]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 3, 6), new THREE.MeshStandardMaterial({ color: '#2a2f3a', metalness: 0.7, roughness: 0.4 }));
    rod.position.set(s * (w / 2 - 0.1), h / 2 + 1.5, -0.02);
    g.add(rod);
  }
  g.userData = { canvas, tex, ctx: canvas.getContext('2d') };
  return g;
}
// 모니터 그리기: 이름·프레임 점수 요약
export function drawMonitor(mon, rows, o = {}) {
  const { canvas, ctx: g, tex } = mon.userData;
  const w = canvas.width, h = canvas.height;
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#0b1230'); bg.addColorStop(1, '#190c2a');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.04)';
  for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
  g.textBaseline = 'middle';
  g.font = '800 44px "Pretendard Variable", sans-serif';
  g.fillStyle = '#9fb3d9'; g.textAlign = 'left';
  g.fillText(o.title || 'LANE', 36, 54);
  g.textAlign = 'right'; g.fillText(o.right || '', w - 36, 54);
  const n = Math.max(1, rows.length);
  const rh = Math.min(150, (h - 130) / n);
  rows.forEach((r, i) => {
    const y = 110 + i * rh;
    g.fillStyle = r.active ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.04)';
    g.fillRect(24, y, w - 48, rh - 8);
    g.fillStyle = r.color; g.fillRect(24, y, 10, rh - 8);
    g.font = `900 ${Math.min(64, rh * 0.5)}px Anton, Impact, sans-serif`;
    g.textAlign = 'left'; g.fillStyle = r.color; g.fillText(r.name, 54, y + (rh - 8) / 2);
    g.textAlign = 'right'; g.fillStyle = '#fff'; g.font = `900 ${Math.min(96, rh * 0.7)}px Anton, Impact, sans-serif`;
    g.fillText(String(r.score), w - 50, y + (rh - 8) / 2 + 2);
    g.font = `700 ${Math.min(40, rh * 0.32)}px "Pretendard Variable", sans-serif`;
    g.fillStyle = '#c3cce2'; g.fillText(r.marks || '', w - 250, y + (rh - 8) / 2);
  });
  tex.needsUpdate = true;
}

// ---------- 볼 리턴 · 볼 랙 ----------
export function makeBallReturn(color = '#d8352f') {
  const g = new THREE.Group();
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.34, 40, 20, 0, TAU, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color, roughness: 0.2, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.2 }));
  hood.scale.set(1, 0.7, 1.35);
  hood.position.y = 0.47;
  hood.castShadow = true;
  g.add(hood);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 1.05), new THREE.MeshPhysicalMaterial({ color: '#1a1d26', roughness: 0.35, metalness: 0.5, clearcoat: 0.4 }));
  body.position.y = 0.25; body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  // 공이 나오는 입구(어두운 반원)
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.15, 24, 0, Math.PI), new THREE.MeshBasicMaterial({ color: '#030304' }));
  mouth.position.set(0, 0.5, 0.36);
  mouth.rotation.y = 0;
  g.add(mouth);
  // 손 말림용 송풍구 (손바닥 모양 원형 격자)
  const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 20), new THREE.MeshStandardMaterial({ color: '#8c93a3', metalness: 0.8, roughness: 0.3 }));
  vent.position.set(0, 0.505, -0.35);
  g.add(vent);
  return g;
}
export function makeBallRack(colors) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#2b3038', roughness: 0.4, metalness: 0.5 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.5), wood);
  base.position.y = 0.04; g.add(base);
  const balls = [];
  const tiers = [[0.0, 0.0, 6], [0.14, 0.18, 5]];
  void tiers;
  // 2단 선반: 아래 4개, 위 3개
  const rows = [{ y: 0.16, n: 4, off: 0 }, { y: 0.34, n: 3, off: 0.5 }];
  let k = 0;
  for (const r of rows) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.03, 0.4), wood);
    shelf.position.set(0, r.y - 0.12, 0);
    g.add(shelf);
    for (let i = 0; i < r.n; i++) {
      const b = makeBall(colors[k % colors.length]);
      b.position.set((i - (r.n - 1) / 2) * 0.3, r.y + 0.0, 0);
      b.scale.setScalar(1);
      b.rotation.y = rnd() * TAU;
      g.add(b); balls.push(b); k++;
    }
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 0.03), wood);
  back.position.set(0, 0.3, -0.2); g.add(back);
  g.userData.balls = balls;
  return g;
}

// ---------- 좌석 · 카펫 ----------
export function makeSeat(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.55, clearcoat: 0.3, sheen: 0.4 });
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.14, 28), mat);
  seat.position.y = 0.46; seat.castShadow = true; seat.receiveShadow = true;
  g.add(seat);
  const back = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.34, 28, 1, true, -Math.PI * 0.55, Math.PI * 1.1), mat);
  back.material = mat.clone(); back.material.side = THREE.DoubleSide;
  back.position.set(0, 0.74, 0.02); back.castShadow = true;
  g.add(back);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.42, 12), new THREE.MeshStandardMaterial({ color: '#c8cdd8', metalness: 0.9, roughness: 0.25 }));
  pole.position.y = 0.21; g.add(pole);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 20), new THREE.MeshStandardMaterial({ color: '#c8cdd8', metalness: 0.9, roughness: 0.25 }));
  foot.position.y = 0.015; g.add(foot);
  return g;
}
export function carpetTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#10142a'; g.fillRect(0, 0, w, h);
    const cols = ['#ff4f9a', '#3ee6d6', '#ffd23a', '#7a5cff', '#ff8a3c'];
    for (let k = 0; k < 46; k++) {
      g.fillStyle = cols[k % cols.length]; g.globalAlpha = 0.85;
      const x = rnd() * w, y = rnd() * h, s = 14 + rnd() * 26, a = rnd() * TAU;
      g.save(); g.translate(x, y); g.rotate(a);
      g.beginPath();
      if (k % 3 === 0) { g.moveTo(0, -s); g.lineTo(s, s); g.lineTo(-s, s); g.closePath(); g.fill(); }
      else if (k % 3 === 1) { g.arc(0, 0, s * 0.55, 0, TAU); g.fill(); }
      else { g.fillRect(-s * 1.2, -2.5, s * 2.4, 5); }
      g.restore();
    }
    g.globalAlpha = 1;
  }, { repeat: [5, 5] });
}

// ---------- 반사: 레인 위에 덧씌우는 거울(밝기만 더함) ----------
export function makeLaneMirror(w, len, { res = 1 } = {}) {
  const shader = {
    name: 'LaneMirror',
    uniforms: { color: { value: new THREE.Color(0xffffff) }, tDiffuse: { value: null }, textureMatrix: { value: null }, oilEnd: { value: C.OIL_END } },
    vertexShader: `
      uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vW;
      void main() { vUv = textureMatrix * vec4(position, 1.0); vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 color; uniform sampler2D tDiffuse; uniform float oilEnd; varying vec4 vUv; varying vec3 vW;
      void main() {
        vec4 base = texture2DProj(tDiffuse, vUv);
        vec3 v = normalize(cameraPosition - vW);
        float fres = 0.22 + 0.9 * pow(1.0 - clamp(v.y, 0.0, 1.0), 2.0);
        float oil = 1.0 - smoothstep(oilEnd - 1.0, oilEnd + 3.5, -vW.z) * 0.75;
        gl_FragColor = vec4(base.rgb * fres * oil * 1.1 * color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  };
  const geo = new THREE.PlaneGeometry(w, len);
  const mir = new Reflector(geo, { textureWidth: Math.round(1024 * res), textureHeight: Math.round(1024 * res), clipBias: 0.002, shader, multisample: 2 });
  mir.rotation.x = -Math.PI / 2;
  mir.material.transparent = true;
  mir.material.blending = THREE.AdditiveBlending;
  mir.material.depthWrite = false;
  mir.renderOrder = 2;
  return mir;
}
