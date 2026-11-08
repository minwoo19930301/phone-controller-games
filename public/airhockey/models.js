// 에어하키 3D 모델: 오락실 테이블(광택 판·공기 구멍·네온 레일·골문 홈·옆 점수판·캐비닛), 말렛, 퍽, 꼬리,
// 불꽃 입자, 오락실 방(카펫·네온 간판·게임기). 모두 코드로 만듭니다(이미지 파일 없음).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RINK } from './physics.js';

const { W, L, PR, MR, GOAL, TOP } = RINK;
export const RW = 0.075; // 레일 폭
export const RH = 0.05; // 판 위로 올라온 레일 높이
const FONT_D = 'Anton, Impact, "Pretendard Variable", sans-serif';
const FONT_S = '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", sans-serif';
const V2 = (x, y) => new THREE.Vector2(x, y);

// ---------- 텍스처 도구 ----------
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
function rand(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9;
    s ^= s >>> 13;
    return ((s >>> 0) % 100000) / 100000;
  };
}
export function shade(hex, k) {
  const c = new THREE.Color(hex);
  if (k >= 0) c.lerp(new THREE.Color('#ffffff'), k);
  else c.lerp(new THREE.Color('#000000'), -k);
  return `#${c.getHexString()}`;
}
function rgba(hex, a) {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
}

export const glowTex = tex(canvas(128, 128, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
}));
const ringTex = tex(canvas(256, 256, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.62, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.75, 'rgba(255,255,255,0.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
}));
// 레일 네온이 흰 판에 번지는 빛(가장자리 → 안쪽으로 옅어짐)
const spillTex = tex(canvas(8, 128, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
}));

const additive = (map, color, opacity = 1) => new THREE.MeshBasicMaterial({
  map, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
});
const neonMat = (color, k = 3) => new THREE.MeshStandardMaterial({ color: '#000000', emissive: color, emissiveIntensity: k, roughness: 0.4 });

// ================================================================
// 판(플레이필드): 광택 흰 판 + 공기 구멍 + 선. 팀 색이 바뀌면 다시 그립니다.
// 캔버스 가로 = x(폭), 세로 = z(길이), 캔버스 위쪽 = 먼 쪽(z = −L/2, 위쪽 팀)
// ================================================================
const PX = 1024; // 1m 당 픽셀
function drawField(g, cA, cB) {
  const w = W * PX;
  const h = L * PX;
  const k = PX;
  const X = (x) => (x + W / 2) * k;
  const Z = (z) => (z + L / 2) * k;
  g.fillStyle = '#f1f3f6';
  g.fillRect(0, 0, w, h);
  // 아주 옅은 결(밋밋하지 않게)
  const r = rand(7);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(120,130,150,0.035)';
    g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
  }
  // 골 크리스(반원)
  const crease = (z, dir, c) => {
    g.beginPath();
    g.arc(X(0), Z(z), 0.24 * k, dir > 0 ? Math.PI : 0, dir > 0 ? 2 * Math.PI : Math.PI);
    g.closePath();
    g.fillStyle = rgba(c, 0.11);
    g.fill();
    g.lineWidth = 9;
    g.strokeStyle = rgba(c, 0.9);
    g.beginPath();
    g.arc(X(0), Z(z), 0.24 * k, dir > 0 ? Math.PI : 0, dir > 0 ? 2 * Math.PI : Math.PI);
    g.stroke();
  };
  crease(L / 2, 1, cA);
  crease(-L / 2, -1, cB);
  // 공격선(팀 색)
  for (const [z, c] of [[0.5, cA], [-0.5, cB]]) {
    g.fillStyle = rgba(c, 0.55);
    g.fillRect(0, Z(z) - 4, w, 8);
    for (const x of [-0.27, 0.27]) {
      g.beginPath();
      g.arc(X(x), Z(z), 0.028 * k, 0, Math.PI * 2);
      g.fillStyle = rgba(c, 0.85);
      g.fill();
    }
  }
  // 가운데 선과 원
  g.fillStyle = '#e2323f';
  g.fillRect(0, Z(0) - 6, w, 12);
  g.beginPath();
  g.arc(X(0), Z(0), 0.165 * k, 0, Math.PI * 2);
  g.fillStyle = 'rgba(226,50,63,0.05)';
  g.fill();
  g.lineWidth = 9;
  g.strokeStyle = '#e2323f';
  g.stroke();
  g.beginPath();
  g.arc(X(0), Z(0), 0.03 * k, 0, Math.PI * 2);
  g.fillStyle = '#e2323f';
  g.fill();
  // 가운데 글자
  g.save();
  g.translate(X(0), Z(0));
  g.font = `400 ${0.05 * k}px ${FONT_D}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(40,48,66,0.28)';
  g.fillText('AIR HOCKEY', 0, -0.075 * k);
  g.font = `800 ${0.022 * k}px ${FONT_S}`;
  g.fillText('PHONE ARCADE', 0, 0.075 * k);
  g.restore();
  // 공기 구멍: 2.5cm 간격
  const step = 0.025 * k;
  for (let y = step / 2; y < h; y += step) {
    for (let x = step / 2; x < w; x += step) {
      g.beginPath();
      g.arc(x, y, 3.1, 0, Math.PI * 2);
      g.fillStyle = 'rgba(120,128,142,0.55)';
      g.fill();
      g.beginPath();
      g.arc(x + 0.4, y + 0.5, 1.9, 0, Math.PI * 2);
      g.fillStyle = 'rgba(46,52,64,0.85)';
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.fillRect(x - 2.4, y - 3.2, 2, 1);
    }
  }
  // 레일 아래 그늘(접촉 그림자)
  const edge = (x0, y0, x1, y1, gx0, gy0, gx1, gy1) => {
    const gr = g.createLinearGradient(gx0, gy0, gx1, gy1);
    gr.addColorStop(0, 'rgba(10,14,24,0.32)');
    gr.addColorStop(1, 'rgba(10,14,24,0)');
    g.fillStyle = gr;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
  };
  const s = 22;
  edge(0, 0, s, h, 0, 0, s, 0);
  edge(w - s, 0, w, h, w, 0, w - s, 0);
  edge(0, 0, w, s, 0, 0, 0, s);
  edge(0, h - s, w, h, 0, h, 0, h - s);
}

export function makePlayfield() {
  const c = canvas(W * PX, L * PX, (g) => drawField(g, '#ff5a5f', '#3ab4ff'));
  const map = tex(c);
  map.anisotropy = 16;
  const mat = new THREE.MeshPhysicalMaterial({ map, roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.035, envMapIntensity: 0.25 }); // RoomEnvironment 조명 상자가 판에 하얗게 비치지 않게
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, L), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = TOP;
  mesh.receiveShadow = true;
  return {
    mesh,
    setColors(cA, cB) {
      drawField(c.getContext('2d'), cA, cB);
      map.needsUpdate = true;
    }
  };
}

// ================================================================
// 레일과 네온, 골문 홈
// ================================================================
const railMat = new THREE.MeshPhysicalMaterial({ color: '#0e1117', roughness: 0.3, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 });
const chromeMat = new THREE.MeshStandardMaterial({ color: '#d9dee6', roughness: 0.18, metalness: 1 });
const darkMetal = new THREE.MeshStandardMaterial({ color: '#1b1f28', roughness: 0.42, metalness: 0.7 });
const blackMat = new THREE.MeshStandardMaterial({ color: '#06070a', roughness: 0.6 });
const slotMat = new THREE.MeshStandardMaterial({ color: '#06070a', roughness: 0.6, side: THREE.BackSide });
const SLOT_D = RW - 0.01; // 골문 홈 앞뒤 길이(판 끝 ~ 뒤 턱 안쪽 면 바로 앞)
const SLOT_H = 0.07; // 골문 홈 깊이(떨어지는 퍽 −0.06 이 바닥에 안 닿게)

// goal: 골문 폭(m). 난이도마다 달라서 대기실에서 바뀌면 scene.setGoal 이 레일을 새로 만듭니다.
export function makeRails(goalW = RINK.GOAL) {
  const GOAL = goalW; // 아래 코드는 이 판의 골문 폭을 씁니다
  const g = new THREE.Group();
  const yC = TOP + RH / 2 - 0.012;
  const hgt = RH + 0.024;
  const sideLen = L + 2 * RW;
  // 옆 레일(위·아래 반쪽으로 나눠서 팀마다 다른 네온)
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(new RoundedBoxGeometry(RW, hgt, sideLen, 4, 0.016), railMat);
    m.position.set(sx * (W / 2 + RW / 2), yC, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  const endLen = (W - GOAL) / 2;
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new RoundedBoxGeometry(endLen, hgt, RW, 4, 0.016), railMat);
      m.position.set(sx * (GOAL / 2 + endLen / 2), yC, sz * (L / 2 + RW / 2));
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    // 골문 홈: 레일 사이로 뚫린 검은 구멍과 크롬 테, 안쪽 골 램프
    // 안쪽 면만 그리는 상자(BackSide)라 위에서 보면 윗면·카메라 쪽 벽은 빠지고 바닥과 먼 벽이 보이는 진짜 홈이 됩니다.
    // 캐비닛 윗판은 이 자리를 비워 둡니다(makeCabinet). 뒤 턱(back) 안쪽 면 바로 앞까지, 옆은 레일 끝면보다 1mm 안쪽.
    const slot = new THREE.Mesh(new THREE.BoxGeometry(GOAL - 0.002, SLOT_H, SLOT_D), slotMat);
    slot.position.set(0, TOP - SLOT_H / 2, sz * (L / 2 + SLOT_D / 2));
    g.add(slot);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(GOAL + 0.01, 0.006, 0.008), chromeMat);
    lip.position.set(0, TOP - 0.001, sz * (L / 2 + 0.002));
    g.add(lip);
    const back = new THREE.Mesh(new RoundedBoxGeometry(GOAL + 0.02, hgt * 0.62, 0.03, 3, 0.01), railMat);
    back.position.set(0, TOP + 0.004, sz * (L / 2 + RW + 0.006));
    g.add(back);
  }
  // 네온 관: 레일 윗면 안쪽 모서리
  const tubes = { A: [], B: [] }; // A = 아래쪽 팀(z>0), B = 위쪽 팀
  const spills = { A: [], B: [] };
  const tubeGeoSide = new THREE.CapsuleGeometry(0.0055, L / 2 - 0.02, 4, 10);
  const tubeGeoEnd = new THREE.CapsuleGeometry(0.0055, endLen - 0.03, 4, 10);
  const matA = neonMat('#ff5a5f');
  const matB = neonMat('#3ab4ff');
  const spillA = additive(spillTex, '#ff5a5f', 0.34);
  const spillB = additive(spillTex, '#3ab4ff', 0.34);
  const yTube = TOP + RH + 0.004;
  for (const sx of [-1, 1]) {
    for (const [team, sz] of [['A', 1], ['B', -1]]) {
      const t = new THREE.Mesh(tubeGeoSide, team === 'A' ? matA : matB);
      t.rotation.x = Math.PI / 2;
      t.position.set(sx * (W / 2 + 0.014), yTube, sz * (L / 4));
      g.add(t);
      tubes[team].push(t);
      // 판 위로 번지는 빛
      // 평면의 가로 = 레일 길이(z), 세로 위쪽(진한 쪽) = 레일 쪽(바깥)
      const sp = new THREE.Mesh(new THREE.PlaneGeometry(L / 2 - 0.01, 0.09), team === 'A' ? spillA : spillB);
      sp.rotation.x = -Math.PI / 2;
      sp.rotation.z = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
      sp.position.set(sx * (W / 2 - 0.045), TOP + 0.0012, sz * (L / 4));
      sp.renderOrder = 2;
      g.add(sp);
      spills[team].push(sp);
    }
  }
  for (const [team, sz] of [['A', 1], ['B', -1]]) {
    for (const sx of [-1, 1]) {
      const t = new THREE.Mesh(tubeGeoEnd, team === 'A' ? matA : matB);
      t.rotation.z = Math.PI / 2;
      t.position.set(sx * (GOAL / 2 + endLen / 2), yTube, sz * (L / 2 + 0.014));
      g.add(t);
      tubes[team].push(t);
      const sp = new THREE.Mesh(new THREE.PlaneGeometry(endLen - 0.01, 0.09), team === 'A' ? spillA : spillB);
      sp.rotation.x = -Math.PI / 2;
      if (sz > 0) sp.rotation.z = Math.PI;
      sp.position.set(sx * (GOAL / 2 + endLen / 2), TOP + 0.0012, sz * (L / 2 - 0.045));
      sp.renderOrder = 2;
      g.add(sp);
      spills[team].push(sp);
    }
  }
  // 골 램프: 골문 홈 네 안쪽 벽을 두르는 띠(뚜껑 없는 네모 관). 어느 쪽 카메라에서든 먼 벽 쪽 띠가 보입니다.
  // 경기 카메라는 1P 쪽에 있어 가까운 골문은 판 쪽 벽, 먼 골문은 뒤 벽이 보이므로 한 벽에만 붙이면 한쪽이 안 보입니다.
  const goalLamps = {};
  const lampCol = { A: new THREE.Color('#ff5a5f'), B: new THREE.Color('#3ab4ff') };
  const lampGeo = new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2, 0.012, 4, 1, true);
  lampGeo.rotateY(Math.PI / 4); // 마름모 → 축에 맞춘 1×1 네모
  lampGeo.scale(GOAL - 0.008, 1, SLOT_D - 0.006);
  for (const [team, sz] of [['A', 1], ['B', -1]]) {
    const lm = neonMat(lampCol[team], 0.6);
    lm.side = THREE.BackSide;
    const lamp = new THREE.Mesh(lampGeo, lm);
    lamp.position.set(0, TOP - 0.012, sz * (L / 2 + SLOT_D / 2));
    g.add(lamp);
    goalLamps[team] = lamp;
  }
  const pulse = { A: 0, B: 0 };
  const base = { A: 3.2, B: 3.2 };
  return {
    group: g,
    goal: goalW,
    // 다시 만들 때 이 판에서만 쓴 모양·재질을 GPU 에서 내립니다(railMat·chromeMat·slotMat 같은 공용 재질은 그대로).
    dispose() {
      g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      for (const m of [matA, matB, spillA, spillB, goalLamps.A.material, goalLamps.B.material]) m.dispose();
    },
    setColors(cA, cB) {
      matA.emissive.set(cA);
      matB.emissive.set(cB);
      spillA.color.set(cA);
      spillB.color.set(cB);
      lampCol.A.set(cA);
      lampCol.B.set(cB);
      goalLamps.A.material.emissive.set(cA);
      goalLamps.B.material.emissive.set(cB);
    },
    // 팀 레일을 번쩍(골, 강타)
    flash(team, k = 1) {
      pulse[team] = Math.max(pulse[team], k);
    },
    goalLamp(team, color) {
      goalLamps[team].material.emissive.set(color);
      goalLamps[team].userData.t = 1;
    },
    update(dt, now) {
      for (const team of ['A', 'B']) {
        pulse[team] = Math.max(0, pulse[team] - dt * 1.6);
        const flick = 1 + Math.sin(now * 0.017 + (team === 'A' ? 0 : 2)) * 0.03;
        const p = pulse[team];
        const k = base[team] * flick + p * 7 * (0.6 + 0.4 * Math.abs(Math.sin(now * 0.03)));
        (team === 'A' ? matA : matB).emissiveIntensity = k;
        (team === 'A' ? spillA : spillB).opacity = 0.3 + p * 0.5;
        const lamp = goalLamps[team];
        const lt = lamp.userData.t || 0;
        lamp.userData.t = Math.max(0, lt - dt * 0.45);
        // 번쩍임이 끝나면 넣은 팀 색에서 이 골문 팀 색으로 되돌립니다.
        if (lt > 0 && lamp.userData.t === 0) lamp.material.emissive.copy(lampCol[team]);
        lamp.material.emissiveIntensity = 0.6 + lt * 9 * (0.5 + 0.5 * Math.sign(Math.sin(now * 0.04)));
      }
    }
  };
}

// ================================================================
// 캐비닛(받침): 앞판 그래픽, 크롬 띠, 받침대, 동전 투입구, 바닥 조명
// ================================================================
function drawEnd(g, w, h, color, label) {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#1d2230');
  gr.addColorStop(1, '#0a0c12');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  // 탄소 무늬
  for (let y = 0; y < h; y += 6) {
    for (let x = (y / 6) % 2 ? 0 : 6; x < w; x += 12) {
      g.fillStyle = 'rgba(255,255,255,0.025)';
      g.fillRect(x, y, 6, 3);
    }
  }
  // 속도감 줄무늬
  g.save();
  g.translate(w / 2, h / 2);
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      const x0 = sx * (w * 0.2 + i * 46);
      g.moveTo(x0, -h / 2);
      g.lineTo(x0 + sx * 26, -h / 2);
      g.lineTo(x0 + sx * 26 + sx * 60, h / 2);
      g.lineTo(x0 + sx * 60, h / 2);
      g.closePath();
      g.fillStyle = rgba(color, 0.75 - i * 0.22);
      g.fill();
    }
  }
  g.restore();
  g.font = `400 ${h * 0.42}px ${FONT_D}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 24;
  g.fillStyle = '#ffffff';
  g.fillText(label, w / 2, h * 0.5);
  g.shadowBlur = 0;
  g.fillStyle = rgba(color, 1);
  g.fillRect(0, h - 10, w, 10);
}
function drawSide(g, w, h, cA, cB) {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#1b2030');
  gr.addColorStop(1, '#08090e');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  // 양 끝에서 가운데로 뻗는 팀 색 줄
  for (const [c, dir] of [[cA, 1], [cB, -1]]) {
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      const x0 = dir > 0 ? w * 0.02 + i * 40 : w * 0.98 - i * 40;
      g.moveTo(x0, h * 0.25);
      g.lineTo(x0 + dir * (w * 0.32 - i * 60), h * 0.25);
      g.lineTo(x0 + dir * (w * 0.3 - i * 60), h * 0.36);
      g.lineTo(x0, h * 0.36);
      g.closePath();
      g.fillStyle = rgba(c, 0.8 - i * 0.22);
      g.fill();
    }
  }
  g.font = `400 ${h * 0.34}px ${FONT_D}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#f4f6fa';
  g.fillText('AIR HOCKEY', w / 2, h * 0.58);
  g.font = `800 ${h * 0.11}px ${FONT_S}`;
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillText('PRO  ·  ARCADE  SERIES', w / 2, h * 0.84);
}

export function makeCabinet(goalW = RINK.GOAL) {
  const g = new THREE.Group();
  const OW = W + 2 * RW + 0.03;
  const OL = L + 2 * RW + 0.03;
  const AH = 0.2; // 앞판 높이
  const aTop = TOP - 0.012;
  const endCanvas = [canvas(1024, 200, (c, w, h) => drawEnd(c, w, h, '#ff5a5f', '1P')), canvas(1024, 200, (c, w, h) => drawEnd(c, w, h, '#3ab4ff', '2P'))];
  // 옆면 두 장: 밖에서 볼 때 왼쪽 끝이 +x 면은 아래쪽 팀, −x 면은 위쪽 팀이라 색 순서를 바꿔 그립니다.
  const sideCanvas = [canvas(2048, 200, (c, w, h) => drawSide(c, w, h, '#ff5a5f', '#3ab4ff')), canvas(2048, 200, (c, w, h) => drawSide(c, w, h, '#3ab4ff', '#ff5a5f'))];
  const endTex = endCanvas.map((c) => tex(c));
  const sideTex = sideCanvas.map((c) => tex(c));
  const face = (map) => new THREE.MeshPhysicalMaterial({ map, roughness: 0.35, metalness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  // 상자 윗면(+y)은 그리지 않고, 골문 홈 두 자리를 비운 윗판으로 따로 덮습니다. 상자 윗면이 있으면 홈 바닥과 골 램프를 가립니다.
  const mats = [face(sideTex[0]), face(sideTex[1]), new THREE.MeshBasicMaterial({ visible: false }), darkMetal, face(endTex[0]), face(endTex[1])];
  const apron = new THREE.Mesh(new THREE.BoxGeometry(OW, AH, OL), mats);
  apron.position.y = aTop - AH / 2;
  apron.castShadow = true;
  apron.receiveShadow = true;
  g.add(apron);
  // 윗판: 골문 폭만큼 두 자리를 비웁니다. 골문 폭이 바뀌면(난이도) 이 모양만 다시 만듭니다.
  const topGeoFor = (gw) => {
    const topShape = new THREE.Shape();
    topShape.moveTo(-OW / 2, -OL / 2);
    topShape.lineTo(OW / 2, -OL / 2);
    topShape.lineTo(OW / 2, OL / 2);
    topShape.lineTo(-OW / 2, OL / 2);
    topShape.closePath();
    for (const sz of [-1, 1]) {
      const z0 = sz * (L / 2);
      const z1 = sz * (L / 2 + RW);
      const hole = new THREE.Path();
      hole.moveTo(-gw / 2, z0);
      hole.lineTo(gw / 2, z0);
      hole.lineTo(gw / 2, z1);
      hole.lineTo(-gw / 2, z1);
      hole.closePath();
      topShape.holes.push(hole);
    }
    const geo = new THREE.ShapeGeometry(topShape);
    geo.rotateX(-Math.PI / 2); // 모양 (x, y) → 바닥 (x, −z), 위를 봅니다. 구멍이 ±z 대칭이라 부호는 상관없음
    return geo;
  };
  const topPlate = new THREE.Mesh(topGeoFor(goalW), darkMetal);
  topPlate.position.y = aTop;
  topPlate.receiveShadow = true;
  g.add(topPlate);
  // 크롬 띠(앞판 위·아래)
  for (const y of [aTop - 0.004, aTop - AH + 0.004]) {
    for (const sx of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.008, OL + 0.012), chromeMat);
      b.position.set(sx * (OW / 2 + 0.002), y, 0);
      g.add(b);
    }
    for (const sz of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(OW + 0.012, 0.008, 0.012), chromeMat);
      b.position.set(0, y, sz * (OL / 2 + 0.002));
      g.add(b);
    }
  }
  // 아래 LED 띠(바닥 조명)
  const ledMat = neonMat('#b26bff', 2.4);
  for (const sx of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, OL - 0.06), ledMat);
    b.position.set(sx * (OW / 2 - 0.02), aTop - AH - 0.006, 0);
    g.add(b);
  }
  for (const sz of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(OW - 0.06, 0.01, 0.01), ledMat);
    b.position.set(0, aTop - AH - 0.006, sz * (OL / 2 - 0.02));
    g.add(b);
  }
  // 받침대: 사다리꼴 기둥 두 개 + 가운데 들보
  const pedH = aTop - AH;
  const shape = new THREE.Shape();
  shape.moveTo(-0.58, 0);
  shape.lineTo(0.58, 0);
  shape.lineTo(0.5, 0.06);
  shape.lineTo(0.36, pedH);
  shape.lineTo(-0.36, pedH);
  shape.lineTo(-0.5, 0.06);
  shape.closePath();
  const pedGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3 });
  pedGeo.translate(0, 0, -0.08);
  const pedMat = new THREE.MeshPhysicalMaterial({ color: '#141821', roughness: 0.4, metalness: 0.6, clearcoat: 0.6 });
  for (const sz of [-1, 1]) {
    const p = new THREE.Mesh(pedGeo, pedMat);
    p.position.set(0, 0, sz * 0.66);
    p.castShadow = true;
    p.receiveShadow = true;
    g.add(p);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.24), chromeMat);
    foot.position.set(0, 0.015, sz * 0.66);
    g.add(foot);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 1.2), pedMat);
  beam.position.set(0, 0.22, 0);
  g.add(beam);
  // 동전 투입구(가까운 받침대 앞)
  const door = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.2, 0.03, 3, 0.01), darkMetal);
  door.position.set(0, 0.3, 0.66 + 0.1);
  g.add(door);
  const coinTex = tex(canvas(256, 200, (c, w, h) => {
    c.fillStyle = '#0b0d12';
    c.fillRect(0, 0, w, h);
    for (const x of [w * 0.3, w * 0.7]) {
      c.fillStyle = '#ff3b3b';
      c.shadowColor = '#ff3b3b';
      c.shadowBlur = 16;
      c.fillRect(x - 10, h * 0.2, 20, h * 0.34);
      c.shadowBlur = 0;
      c.fillStyle = '#300';
      c.fillRect(x - 3, h * 0.24, 6, h * 0.26);
    }
    c.font = `800 ${h * 0.14}px ${FONT_S}`;
    c.textAlign = 'center';
    c.fillStyle = '#ffd23a';
    c.fillText('INSERT COIN', w / 2, h * 0.82);
  }));
  const coin = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.17), new THREE.MeshStandardMaterial({ map: coinTex, emissiveMap: coinTex, emissive: '#ffffff', emissiveIntensity: 1.2, roughness: 0.5 }));
  coin.position.set(0, 0.3, 0.66 + 0.116);
  g.add(coin);
  return {
    group: g,
    setGoal(gw) {
      topPlate.geometry.dispose();
      topPlate.geometry = topGeoFor(gw);
    },
    setColors(cA, cB, nameA, nameB) {
      drawEnd(endCanvas[0].getContext('2d'), 1024, 200, cA, nameA);
      drawEnd(endCanvas[1].getContext('2d'), 1024, 200, cB, nameB);
      endTex[0].needsUpdate = true;
      endTex[1].needsUpdate = true;
      drawSide(sideCanvas[0].getContext('2d'), 2048, 200, cA, cB);
      drawSide(sideCanvas[1].getContext('2d'), 2048, 200, cB, cA);
      sideTex[0].needsUpdate = true;
      sideTex[1].needsUpdate = true;
    }
  };
}

// ================================================================
// 옆 점수판: 긴 옆면 가운데에 붙은 7세그먼트 표시기. 위 = 위쪽 팀, 아래 = 아래쪽 팀
// ================================================================
const SEG = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg'
};
function seg7(g, x, y, w, h, d, on, off) {
  const t = w * 0.2;
  const lit = SEG[d] || '';
  const bar = (k, x0, y0, horiz, len) => {
    g.beginPath();
    if (horiz) {
      g.moveTo(x0, y0);
      g.lineTo(x0 + t / 2, y0 - t / 2);
      g.lineTo(x0 + len - t / 2, y0 - t / 2);
      g.lineTo(x0 + len, y0);
      g.lineTo(x0 + len - t / 2, y0 + t / 2);
      g.lineTo(x0 + t / 2, y0 + t / 2);
    } else {
      g.moveTo(x0, y0);
      g.lineTo(x0 + t / 2, y0 + t / 2);
      g.lineTo(x0 + t / 2, y0 + len - t / 2);
      g.lineTo(x0, y0 + len);
      g.lineTo(x0 - t / 2, y0 + len - t / 2);
      g.lineTo(x0 - t / 2, y0 + t / 2);
    }
    g.closePath();
    const isOn = lit.includes(k);
    g.fillStyle = isOn ? on : off;
    g.shadowColor = isOn ? on : 'transparent';
    g.shadowBlur = isOn ? 18 : 0;
    g.fill();
  };
  const g2 = 3;
  const hh = h / 2;
  bar('a', x + g2, y, true, w - 2 * g2);
  bar('g', x + g2, y + hh, true, w - 2 * g2);
  bar('d', x + g2, y + h, true, w - 2 * g2);
  bar('f', x, y + g2, false, hh - 2 * g2);
  bar('e', x, y + hh + g2, false, hh - 2 * g2);
  bar('b', x + w, y + g2, false, hh - 2 * g2);
  bar('c', x + w, y + hh + g2, false, hh - 2 * g2);
  g.shadowBlur = 0;
}
function drawBoard(g, w, h, a, b, cA, cB, nA, nB, hl) {
  g.fillStyle = '#05070b';
  g.fillRect(0, 0, w, h);
  // 격자(LED 판 느낌)
  g.fillStyle = 'rgba(255,255,255,0.025)';
  for (let y = 0; y < h; y += 8) g.fillRect(0, y, w, 1);
  const half = (score, c, name, y0, lit) => {
    const dw = w * 0.3;
    const dh = h * 0.27;
    const s = String(Math.min(99, score)).padStart(2, ' ');
    const off = 'rgba(255,255,255,0.05)';
    const on = lit ? '#ffffff' : c;
    seg7(g, w * 0.13, y0, dw, dh, s[0] === ' ' ? -1 : Number(s[0]), on, off);
    seg7(g, w * 0.57, y0, dw, dh, Number(s[1]), on, off);
    g.font = `800 ${h * 0.045}px ${FONT_S}`;
    g.textAlign = 'center';
    g.fillStyle = c;
    g.fillText(name, w / 2, y0 + dh + h * 0.07);
  };
  half(b, cB, nB, h * 0.05, hl === 'B');
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(w * 0.1, h * 0.5 - 2, w * 0.8, 4);
  half(a, cA, nA, h * 0.56, hl === 'A');
}
export function makeScoreConsole(sx) {
  const g = new THREE.Group();
  const len = 0.5;
  const housing = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.12, len, 4, 0.02), railMat);
  housing.castShadow = true;
  g.add(housing);
  const c = canvas(256, 512, (x, w, h) => drawBoard(x, w, h, 0, 0, '#ff5a5f', '#3ab4ff', '1P', '2P', null));
  const map = tex(c);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.115, len - 0.05),
    new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: map, emissiveIntensity: 1.6, roughness: 0.2 }));
  screen.rotation.x = -Math.PI / 2;
  screen.position.y = 0.0605;
  g.add(screen);
  // 유리 덮개
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.125, len - 0.04), new THREE.MeshPhysicalMaterial({
    color: '#ffffff', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.12, clearcoat: 1
  }));
  glass.rotation.x = -Math.PI / 2;
  glass.position.y = 0.062;
  g.add(glass);
  // 표시기가 판 안쪽(가운데)을 조금 향하게 기울입니다.
  g.rotation.z = sx * 0.22;
  g.position.set(sx * (W / 2 + RW + 0.08), TOP + 0.01, 0);
  return {
    group: g,
    draw(a, b, cA, cB, nA, nB, hl) {
      drawBoard(c.getContext('2d'), 256, 512, a, b, cA, cB, nA, nB, hl);
      map.needsUpdate = true;
    }
  };
}

// ================================================================
// 말렛: 회전체(넓은 받침 + 오목한 접시 + 목 + 손잡이)
// ================================================================
const malletBody = (() => {
  const r = MR;
  const pts = [
    [0, 0.0016], [r - 0.006, 0.0016], [r - 0.0018, 0.0032], [r, 0.0075], [r, 0.0165], [r - 0.0016, 0.0205], [r - 0.0052, 0.0222],
    [r - 0.0095, 0.0214], [r - 0.0145, 0.0188], [0.031, 0.0168], [0.0255, 0.0172], [0.0215, 0.0196], [0.0186, 0.0245],
    [0.0172, 0.031], [0.0167, 0.038], [0.0172, 0.0445], [0.019, 0.049], [0.0205, 0.051], [0, 0.051]
  ].map(([a, b]) => V2(a, b));
  const geo = new THREE.LatheGeometry(pts, 56);
  geo.computeVertexNormals();
  return geo;
})();
const malletKnob = (() => {
  const pts = [[0, 0.049], [0.0205, 0.0495], [0.0238, 0.0545], [0.0249, 0.0605], [0.0238, 0.0665], [0.0198, 0.0715], [0.0128, 0.0748], [0.005, 0.0759], [0, 0.076]]
    .map(([a, b]) => V2(a, b));
  return new THREE.LatheGeometry(pts, 48);
})();
const malletRing = new THREE.TorusGeometry(MR - 0.0035, 0.0016, 8, 56);
const felt = new THREE.CircleGeometry(MR - 0.004, 40);

export function makeMallet(color, label) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.09, sheen: 0.3, sheenColor: new THREE.Color(shade(color, 0.5)) });
  const knobMat = new THREE.MeshPhysicalMaterial({ color: shade(color, -0.25), roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 });
  const body = new THREE.Mesh(malletBody, bodyMat);
  body.castShadow = true;
  g.add(body);
  const knob = new THREE.Mesh(malletKnob, knobMat);
  knob.castShadow = true;
  g.add(knob);
  const ring = new THREE.Mesh(malletRing, chromeMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.0205;
  g.add(ring);
  const f = new THREE.Mesh(felt, new THREE.MeshStandardMaterial({ color: '#22252c', roughness: 1 }));
  f.rotation.x = Math.PI / 2;
  f.position.y = 0.0012;
  g.add(f);
  // 손잡이 위 번호 표시(자리 색 원 + 숫자)
  const decal = tex(canvas(128, 128, (c, w, h) => {
    c.fillStyle = '#0d0f14';
    c.beginPath();
    c.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
    c.fill();
    c.font = `400 ${h * 0.62}px ${FONT_D}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#ffffff';
    c.fillText(label, w / 2, h * 0.55);
  }));
  const top = new THREE.Mesh(new THREE.CircleGeometry(0.0125, 32), new THREE.MeshStandardMaterial({ map: decal, emissiveMap: decal, emissive: '#ffffff', emissiveIntensity: 0.35, roughness: 0.3 }));
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.0762;
  g.add(top);
  // 판 위에 번지는 자기 색 빛
  const puddle = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), additive(glowTex, color, 0.45));
  puddle.rotation.x = -Math.PI / 2;
  puddle.position.y = 0.0014;
  puddle.renderOrder = 2;
  g.add(puddle);
  g.userData = {
    puddle,
    dispose() {
      bodyMat.dispose();
      knobMat.dispose();
      decal.dispose();
      puddle.material.dispose();
    }
  };
  return g;
}

// ================================================================
// 퍽: 짙은 원판 + 빛나는 옆띠 + 윗면 링
// ================================================================
export function makePuck() {
  const g = new THREE.Group();
  const H = 0.011;
  const pts = [[0, 0.0008], [PR - 0.0032, 0.0008], [PR - 0.0006, 0.0024], [PR, 0.0042], [PR, H - 0.0042], [PR - 0.0006, H - 0.0024], [PR - 0.0032, H - 0.0008], [0, H - 0.0008]]
    .map(([a, b]) => V2(a, b));
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 56), new THREE.MeshPhysicalMaterial({ color: '#16181e', roughness: 0.22, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 }));
  body.castShadow = true;
  g.add(body);
  const bandMat = neonMat('#7df3ff', 2.6);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(PR + 0.0004, PR + 0.0004, 0.0026, 56, 1, true), bandMat);
  band.position.y = H / 2;
  g.add(band);
  const topTex = tex(canvas(256, 256, (c, w, h) => {
    c.fillStyle = '#000';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#ffffff';
    c.lineWidth = 10;
    c.beginPath();
    c.arc(w / 2, h / 2, w * 0.4, 0, Math.PI * 2);
    c.stroke();
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    for (let r = 0.12; r < 0.34; r += 0.055) {
      c.beginPath();
      c.arc(w / 2, h / 2, w * r, 0, Math.PI * 2);
      c.stroke();
    }
    // 돌아가는 게 보이게 한쪽에 별
    c.fillStyle = '#ffffff';
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? w * 0.03 : w * 0.075;
      const x = w * 0.5 + Math.cos(a) * r;
      const y = h * 0.23 + Math.sin(a) * r;
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    }
    c.closePath();
    c.fill();
  }));
  const topMat = new THREE.MeshPhysicalMaterial({ color: '#191c23', emissive: '#7df3ff', emissiveMap: topTex, emissiveIntensity: 1.4, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04 });
  const top = new THREE.Mesh(new THREE.CircleGeometry(PR - 0.0028, 56), topMat);
  top.rotation.x = -Math.PI / 2;
  top.position.y = H - 0.0007;
  g.add(top);
  const puddle = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), additive(glowTex, '#7df3ff', 0.4));
  puddle.rotation.x = -Math.PI / 2;
  puddle.position.y = 0.0013;
  puddle.renderOrder = 2;
  g.add(puddle);
  g.userData = { band: bandMat, topMat, puddle, H };
  return g;
}

// ================================================================
// 퍽 꼬리: 판 위에 눕힌 띠(가까울수록 굵고 밝게)
// ================================================================
export function makeTrail(n = 28) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 2 * 4), 4));
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geo.setIndex(idx);
  // 흰 판 위라 더하기 섞기로는 안 보입니다. 보통 섞기로 색 띠를 그립니다.
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.userData = { n };
  return mesh;
}
// 꼬리 표본 고리 버퍼: 미리 잡아 둔 배열에 {x, z, t(ms)} 를 돌려 씁니다. n 은 makeTrail 의 n 과 같게.
// 길이는 프레임 수가 아니라 시간(win ms)으로 자릅니다. 그래서 30Hz·60Hz·144Hz 화면에서 꼬리 길이가 같습니다.
export function makeTrailBuffer(n, win = 200) {
  return { n, win, minDt: win / (n - 4), x: new Float32Array(n), z: new Float32Array(n), t: new Float64Array(n), head: 0, count: 0 };
}
export function clearTrail(b) {
  b.head = 0;
  b.count = 0;
}
export function pushTrail(b, x, z, t) {
  const { n } = b;
  // 맨 앞 표본이 바로 앞 표본과 minDt 도 안 떨어져 있으면(주사율이 높은 화면) 새 칸을 쓰지 않고 맨 앞 표본만 지금 자리로 옮깁니다.
  // 그래서 굳어진 표본 사이 간격은 늘 minDt 이상이고, 창(win) 안 표본 수가 n 을 넘지 않습니다.
  let i;
  if (b.count >= 2 && b.t[(b.head + b.count - 1) % n] - b.t[(b.head + b.count - 2) % n] < b.minDt) {
    i = (b.head + b.count - 1) % n;
  } else if (b.count < n) {
    i = (b.head + b.count) % n;
    b.count++;
  } else {
    i = b.head;
    b.head = (b.head + 1) % n;
  }
  b.x[i] = x;
  b.z[i] = z;
  b.t[i] = t;
  // 창 밖 표본은 꼬리 끝 하나만 남기고 버립니다(끝이 투명하게 사라지도록 기준점으로 둠).
  while (b.count > 2 && t - b.t[(b.head + 1) % n] > b.win) {
    b.head = (b.head + 1) % n;
    b.count--;
  }
}
// b: makeTrailBuffer 고리 버퍼(오래된 것 → 최근), now: ms. color: THREE.Color, k: 밝기
export function layoutTrail(trail, b, color, k, now) {
  const { n } = trail.userData;
  const count = Math.min(n, b.count);
  const pos = trail.geometry.attributes.position;
  const col = trail.geometry.attributes.color;
  if (count < 2 || k <= 0.01) {
    trail.visible = false;
    return;
  }
  trail.visible = true;
  const y = TOP + 0.003;
  const at = (j) => (b.head + b.count - count + j) % b.n; // 최근 count 개 중 j 번째
  for (let i = 0; i < n; i++) {
    const kk = Math.min(i, count - 1);
    const p = at(kk);
    const q = at(Math.min(count - 1, kk + 1));
    const o = at(Math.max(0, kk - 1));
    let dx = b.x[q] - b.x[o];
    let dz = b.z[q] - b.z[o];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const f = Math.max(0, Math.min(1, 1 - (now - b.t[p]) / b.win)); // 1 = 방금, 0 = 창 끝
    const w = PR * (0.1 + 0.75 * f);
    pos.setXYZ(i * 2, b.x[p] - dz * w, y, b.z[p] + dx * w);
    pos.setXYZ(i * 2 + 1, b.x[p] + dz * w, y, b.z[p] - dx * w);
    const a = i < count ? f * f * 0.7 * k : 0;
    col.setXYZW(i * 2, color.r, color.g, color.b, a);
    col.setXYZW(i * 2 + 1, color.r, color.g, color.b, a);
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;
}

// ================================================================
// 효과: 타구 충격 링, 불꽃 입자
// ================================================================
export function makeRings(n = 8) {
  const g = new THREE.Group();
  const list = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive(ringTex, '#ffffff', 0));
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 4;
    m.visible = false;
    g.add(m);
    list.push({ m, t: 0, size: 0.2 });
  }
  let next = 0;
  return {
    group: g,
    spawn(x, z, color, size) {
      const r = list[next];
      next = (next + 1) % n;
      r.m.position.set(x, TOP + 0.004, z);
      r.m.material.color.set(color);
      r.t = 1;
      r.size = size;
      r.m.visible = true;
    },
    update(dt) {
      for (const r of list) {
        if (!r.visible && r.t <= 0) continue;
        r.t -= dt * 3.2;
        if (r.t <= 0) {
          r.m.visible = false;
          r.t = 0;
          continue;
        }
        const s = r.size * (1.25 - r.t);
        r.m.scale.set(s, s, 1);
        r.m.material.opacity = r.t * r.t * 1.4;
      }
    }
  };
}

export function makeSparks(n = 360) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 0.035, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, sizeAttenuation: true });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  const P = [];
  for (let i = 0; i < n; i++) P.push({ x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, c: new THREE.Color() });
  let next = 0;
  const tmp = new THREE.Color();
  return {
    points: pts,
    burst(x, y, z, color, count, speed, up = 1) {
      for (let i = 0; i < count; i++) {
        const p = P[next];
        next = (next + 1) % n;
        const a = Math.random() * Math.PI * 2;
        const s = speed * (0.3 + Math.random() * 0.7);
        p.x = x;
        p.y = y;
        p.z = z;
        p.vx = Math.cos(a) * s;
        p.vz = Math.sin(a) * s;
        p.vy = up * (0.4 + Math.random()) * speed * 0.9;
        p.max = 0.5 + Math.random() * 0.7;
        p.life = p.max;
        p.c.set(color).lerp(tmp.set('#ffffff'), Math.random() * 0.5);
      }
    },
    update(dt) {
      for (let i = 0; i < n; i++) {
        const p = P[i];
        if (p.life > 0) {
          p.life -= dt;
          p.vy -= 3.2 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          p.vx *= 0.985;
          p.vz *= 0.985;
          if (p.y < TOP + 0.004 && Math.abs(p.x) < W / 2 && Math.abs(p.z) < L / 2) {
            p.y = TOP + 0.004;
            p.vy = Math.abs(p.vy) * 0.35;
          }
        }
        const k = p.life > 0 ? Math.min(1, (p.life / p.max) * 1.6) : 0;
        pos[i * 3] = p.x;
        pos[i * 3 + 1] = p.life > 0 ? p.y : -50;
        pos[i * 3 + 2] = p.z;
        col[i * 3] = p.c.r * k * 1.6;
        col[i * 3 + 1] = p.c.g * k * 1.6;
        col[i * 3 + 2] = p.c.b * k * 1.6;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    }
  };
}

// ================================================================
// 오락실 방: 카펫, 벽, 네온 간판, 게임기, 테이블 위 조명 갓
// ================================================================
function carpetTex() {
  return tex(canvas(512, 512, (g, w, h) => {
    g.fillStyle = '#0c0b1d';
    g.fillRect(0, 0, w, h);
    const r = rand(42);
    const cols = ['#ff3fb4', '#29d7ff', '#ffd23a', '#7c5cff', '#36f0a0'];
    // 이음매 없이 반복되게 가장자리를 넘는 도형은 반대편에도 그립니다.
    const draw = (fn) => {
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { g.save(); g.translate(ox, oy); fn(); g.restore(); }
    };
    for (let i = 0; i < 70; i++) {
      const x = r() * w;
      const y = r() * h;
      const c = cols[Math.floor(r() * cols.length)];
      const kind = Math.floor(r() * 4);
      const s = 8 + r() * 16;
      const a = r() * Math.PI * 2;
      draw(() => {
        g.save();
        g.translate(x, y);
        g.rotate(a);
        g.globalAlpha = 0.3;
        g.strokeStyle = c;
        g.fillStyle = c;
        g.lineWidth = 3;
        if (kind === 0) {
          g.beginPath();
          g.moveTo(0, -s);
          g.lineTo(s * 0.9, s * 0.6);
          g.lineTo(-s * 0.9, s * 0.6);
          g.closePath();
          g.stroke();
        } else if (kind === 1) {
          g.beginPath();
          g.arc(0, 0, s * 0.55, 0, Math.PI * 2);
          g.stroke();
        } else if (kind === 2) {
          g.beginPath();
          g.moveTo(-s, 0);
          for (let k = 1; k <= 4; k++) g.lineTo(-s + (k * s) / 2, k % 2 ? -s * 0.4 : s * 0.4);
          g.stroke();
        } else {
          g.fillRect(-s * 0.15, -s * 0.15, s * 0.3, s * 0.3);
        }
        g.restore();
      });
    }
    // 카펫 결
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (r() - 0.5) * 18;
      d[i] = Math.max(0, d[i] + n);
      d[i + 1] = Math.max(0, d[i + 1] + n);
      d[i + 2] = Math.max(0, d[i + 2] + n);
    }
    g.putImageData(img, 0, 0);
  }), true, true);
}
function wallTex() {
  return tex(canvas(512, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#120f22');
    gr.addColorStop(1, '#1b1630');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.lineWidth = 3;
    for (let x = 0; x <= w; x += 128) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, h * 0.82, w, h * 0.18);
  }), true, true);
}
function neonSign(text, color, w, h, font) {
  const c = canvas(1024, Math.round((1024 * h) / w), (g, cw, ch) => {
    g.clearRect(0, 0, cw, ch);
    g.font = font.replace('{s}', `${ch * 0.62}`);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    for (const [blur, lw, a] of [[40, 16, 0.6], [16, 8, 0.9], [0, 3.5, 1]]) {
      g.shadowColor = color;
      g.shadowBlur = blur;
      g.strokeStyle = a < 1 ? color : '#ffffff';
      g.globalAlpha = a;
      g.lineWidth = lw;
      g.strokeText(text, cw / 2, ch * 0.54);
    }
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), additive(tex(c), '#ffffff', 1));
  m.material.color.setScalar(1.6);
  return m;
}
function gameScreen(kind, seed) {
  return tex(canvas(256, 320, (g, w, h) => {
    const r = rand(seed);
    g.fillStyle = '#04030c';
    g.fillRect(0, 0, w, h);
    if (kind === 0) {
      // 우주 슈팅
      for (let i = 0; i < 80; i++) {
        g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`;
        g.fillRect(r() * w, r() * h, 2, 2);
      }
      const cols = ['#ff4fd8', '#39e6ff', '#ffe14a'];
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i < 6; i++) {
          g.fillStyle = cols[row];
          const x = 30 + i * 36;
          const y = 40 + row * 34;
          g.fillRect(x, y, 22, 10);
          g.fillRect(x + 4, y + 10, 4, 6);
          g.fillRect(x + 14, y + 10, 4, 6);
        }
      }
      g.fillStyle = '#7dff7a';
      g.fillRect(w / 2 - 16, h - 40, 32, 10);
      g.fillRect(w / 2 - 4, h - 50, 8, 10);
    } else if (kind === 1) {
      // 미로
      g.strokeStyle = '#3d6bff';
      g.lineWidth = 6;
      for (let i = 0; i < 14; i++) {
        g.beginPath();
        const x = Math.floor(r() * 8) * 32;
        const y = Math.floor(r() * 10) * 32;
        g.moveTo(x, y);
        if (r() < 0.5) g.lineTo(x + 64, y);
        else g.lineTo(x, y + 64);
        g.stroke();
      }
      g.fillStyle = '#ffd23a';
      for (let i = 0; i < 40; i++) g.fillRect(16 + Math.floor(r() * 7) * 32, 16 + Math.floor(r() * 9) * 32, 4, 4);
      g.beginPath();
      g.arc(120, 160, 14, 0.4, Math.PI * 2 - 0.4);
      g.lineTo(120, 160);
      g.fill();
    } else if (kind === 2) {
      // 레이싱
      g.fillStyle = '#1a0b3a';
      g.fillRect(0, 0, w, h * 0.45);
      const sun = g.createLinearGradient(0, h * 0.15, 0, h * 0.45);
      sun.addColorStop(0, '#ffd23a');
      sun.addColorStop(1, '#ff3fb4');
      g.fillStyle = sun;
      g.beginPath();
      g.arc(w / 2, h * 0.45, 60, Math.PI, 0);
      g.fill();
      g.strokeStyle = '#ff3fb4';
      g.lineWidth = 2;
      for (let i = 0; i < 9; i++) {
        const y = h * 0.45 + Math.pow(i / 8, 2) * h * 0.55;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
      }
      for (let i = -5; i <= 5; i++) {
        g.beginPath();
        g.moveTo(w / 2 + i * 6, h * 0.45);
        g.lineTo(w / 2 + i * 60, h);
        g.stroke();
      }
      g.fillStyle = '#39e6ff';
      g.fillRect(w / 2 - 20, h - 50, 40, 22);
    } else {
      // 블록 쌓기
      const cols = ['#ff4f6a', '#39e6ff', '#ffe14a', '#7dff7a', '#b26bff'];
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 8; x++) {
          if (y < 4 + r() * 3) continue;
          g.fillStyle = cols[Math.floor(r() * cols.length)];
          g.fillRect(16 + x * 28, 20 + y * 28, 26, 26);
        }
      }
    }
    // 화면 주사선
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  }));
}
function marquee(title, color) {
  return tex(canvas(512, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, shade(color, -0.6));
    gr.addColorStop(0.5, color);
    gr.addColorStop(1, shade(color, -0.6));
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.font = `400 ${h * 0.62}px ${FONT_D}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 6;
    g.strokeStyle = '#0b0b16';
    g.strokeText(title, w / 2, h * 0.54);
    g.fillStyle = '#ffffff';
    g.fillText(title, w / 2, h * 0.54);
  }));
}
// 게임기 옆모양(깊이 z, 높이 y): 앞쪽이 z = 0
const cabShape = (() => {
  const s = new THREE.Shape();
  const P = [[0, 0], [0, 0.86], [0.15, 0.92], [0.12, 0.99], [-0.1, 1.04], [-0.2, 1.52], [-0.05, 1.6], [-0.05, 1.88], [-0.72, 1.88], [-0.72, 0]];
  s.moveTo(P[0][0], P[0][1]);
  for (const p of P.slice(1)) s.lineTo(p[0], p[1]);
  s.closePath();
  return s;
})();
let cabGeo = null;
function arcadeMachine(color, title, kind, seed) {
  if (!cabGeo) {
    cabGeo = new THREE.ExtrudeGeometry(cabShape, { depth: 0.62, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2 });
    // 모양의 (x, y) = (깊이, 높이), 밀어낸 방향 = 폭. 폭이 x 축이 되게 돌립니다.
    cabGeo.rotateY(-Math.PI / 2);
    cabGeo.translate(0.31, 0, 0);
  }
  const g = new THREE.Group();
  const side = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.2 });
  const body = new THREE.Mesh(cabGeo, [side, new THREE.MeshStandardMaterial({ color: '#0b0c12', roughness: 0.6 })]);
  g.add(body);
  // 화면(기울어진 면)
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.46), new THREE.MeshBasicMaterial({ map: gameScreen(kind, seed) }));
  scr.material.color.setScalar(1.25);
  const a = Math.atan2(0.48, 0.1);
  scr.position.set(0, 1.28, -0.15 + 0.012);
  scr.rotation.x = -(Math.PI / 2 - a);
  g.add(scr);
  const mq = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.24), new THREE.MeshBasicMaterial({ map: marquee(title, color) }));
  mq.material.color.setScalar(1.35);
  mq.position.set(0, 1.74, -0.05 + 0.006);
  g.add(mq);
  // 조작판: 조이스틱 + 버튼
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 8), chromeMat);
  stick.position.set(-0.14, 0.99, 0.05);
  g.add(stick);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), new THREE.MeshStandardMaterial({ color: '#ff3b3b', roughness: 0.3 }));
  ball.position.set(-0.14, 1.03, 0.05);
  g.add(ball);
  ['#ffd23a', '#39e6ff', '#ff4fd8'].forEach((c, i) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 16), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.6 }));
    b.position.set(0.02 + i * 0.06, 0.985, 0.04);
    b.rotation.x = 0.22;
    g.add(b);
  });
  return g;
}

export function makeRoom() {
  const g = new THREE.Group();
  const carpet = carpetTex();
  carpet.repeat.set(9, 9);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), new THREE.MeshStandardMaterial({ map: carpet, color: '#8a86a0', roughness: 0.95, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  g.add(floor);
  const wt = wallTex();
  wt.repeat.set(4, 1);
  const wallMat = new THREE.MeshStandardMaterial({ map: wt, roughness: 0.85 });
  const WALL = 7;
  const HGT = 4.6;
  for (const [x, z, ry] of [[0, -WALL, 0], [-WALL, 0, Math.PI / 2], [WALL, 0, -Math.PI / 2], [0, WALL, Math.PI]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(WALL * 2, HGT), wallMat);
    m.position.set(x, HGT / 2, z);
    m.rotation.y = ry;
    g.add(m);
  }
  // 벽 아래·위 네온 띠
  const tubeMat = (c) => neonMat(c, 2.2);
  for (const [x, z, ry, c] of [[0, -WALL + 0.03, 0, '#ff3fb4'], [-WALL + 0.03, 0, Math.PI / 2, '#29d7ff'], [WALL - 0.03, 0, -Math.PI / 2, '#29d7ff']]) {
    for (const y of [0.32, 3.9]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(WALL * 2 - 0.2, 0.025, 0.025), tubeMat(y > 1 ? '#7c5cff' : c));
      t.position.set(x, y, z);
      t.rotation.y = ry;
      g.add(t);
    }
  }
  // 네온 간판
  const s1 = neonSign('AIR HOCKEY', '#ff3fb4', 4.2, 1.0, `400 {s}px ${FONT_D}`);
  s1.position.set(0, 2.85, -WALL + 0.05);
  g.add(s1);
  const s2 = neonSign('GAME ZONE', '#29d7ff', 2.8, 0.7, `400 {s}px ${FONT_D}`);
  s2.position.set(-WALL + 0.05, 2.9, -2.2);
  s2.rotation.y = Math.PI / 2;
  g.add(s2);
  const s3 = neonSign('★ HIGH SCORE ★', '#ffd23a', 3.0, 0.6, `900 {s}px ${FONT_S}`);
  s3.position.set(WALL - 0.05, 2.9, -1.6);
  s3.rotation.y = -Math.PI / 2;
  g.add(s3);
  const s4 = neonSign('PLAY!', '#36f0a0', 1.6, 0.6, `400 {s}px ${FONT_D}`);
  s4.position.set(-WALL + 0.05, 2.7, 2.6);
  s4.rotation.y = Math.PI / 2;
  g.add(s4);
  // 게임기: 뒷벽에 줄지어, 옆벽에도 몇 대
  const titles = [['GALAXY RAID', '#7c5cff', 0], ['TURBO LANE', '#ff3fb4', 2], ['MAZE RUN', '#29a8ff', 1], ['BLOCK DROP', '#ff8a3d', 3], ['STAR SHOT', '#36c27a', 0], ['NEON DRIFT', '#e23b6e', 2]];
  titles.forEach(([t, c, k], i) => {
    const m = arcadeMachine(c, t, k, 11 + i * 7);
    m.position.set(-2.6 + i * 1.04, 0, -WALL + 0.78);
    g.add(m);
  });
  for (const [x, ry, list] of [[-WALL + 0.78, Math.PI / 2, [[0.4, 'SKY ACE', '#29d7ff', 0], [1.45, 'PIXEL CAT', '#ffd23a', 1]]], [WALL - 0.78, -Math.PI / 2, [[0.6, 'ROCK BLAST', '#ff4f6a', 3], [1.65, 'NITRO', '#7c5cff', 2]]]]) {
    for (const [z, t, c, k] of list) {
      const m = arcadeMachine(c, t, k, Math.round(z * 100) + 3);
      m.position.set(x, 0, z);
      m.rotation.y = ry;
      g.add(m);
    }
  }
  // 테이블 위 조명 갓(긴 상자 + 빛나는 아랫면 + 매단 줄)
  const lampY = 4.12; // 천장 가까이(경기 카메라보다 위라 화면을 가리지 않음)
  const hood = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.14, 2.1, 3, 0.03), darkMetal);
  hood.position.set(0, lampY, 0);
  g.add(hood);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 2.0), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff6e8').multiplyScalar(2.4) }));
  panel.rotation.x = Math.PI / 2;
  panel.position.set(0, lampY - 0.071, 0);
  g.add(panel);
  for (const z of [-0.8, 0.8]) {
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, HGT - lampY, 6), blackMat);
    cable.position.set(0, lampY + (HGT - lampY) / 2, z);
    g.add(cable);
  }
  // 테이블 아래 바닥 빛(보라·하늘 섞임)
  const under = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.6), additive(glowTex, '#9a5cff', 0.55));
  under.rotation.x = -Math.PI / 2;
  under.position.y = 0.004;
  g.add(under);
  return g;
}
