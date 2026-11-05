// 퍼터 모델과 퍼팅 자세. 골퍼 몸은 골프 니어핀의 makeGolfer 를 그대로 빌려 쓰고,
// 팔과 퍼터를 어깨를 축으로 한 진자처럼 흔듭니다.
import * as THREE from 'three';
import { makeGolfer } from '/golf/scene.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Y = V(0, 1, 0);
export const BALL_R = 0.02135;

// ---------- 퍼터 ----------
// 헤드 좌표: X = 토(앞 끝), Y = 위, Z = 뒤(페이스 반대쪽). 페이스 가운데 바닥이 원점.
const DIR_H = V(-0.342, 0.94, -0.06).normalize(); // 헤드에서 그립 쪽(라이각 70°, 손이 살짝 앞)
const NECK = [V(-0.035, 0.019, 0.0045), V(-0.035, 0.033, 0.0045), V(-0.039, 0.041, 0.0), V(-0.046, 0.043, -0.004)];
const HOSEL_TOP = NECK[3].clone().addScaledVector(DIR_H, 0.016);
const SHAFT_LEN = 0.862;
export const GRIP_TOP = HOSEL_TOP.clone().addScaledVector(DIR_H, SHAFT_LEN);
export const HAND_L = GRIP_TOP.clone().addScaledVector(DIR_H, -0.035);

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function roundRect(s, x, y, w, h, r) {
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// 위에서 본 모양(x, z)을 높이 h 만큼 세웁니다. 모양 좌표의 y 는 -z 로 넣습니다.
function upExtrude(shape, h, bevel = 0.0009) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: h - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 14 });
  g.translate(0, 0, bevel);
  g.rotateX(-Math.PI / 2);
  return g;
}

const gripTexCache = new Map();
function gripTexture(color) {
  if (gripTexCache.has(color)) return gripTexCache.get(color);
  const t = canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#17191d';
    g.fillRect(0, 0, w, h);
    // 미끄럼 방지 무늬(가는 사선)
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 2;
    for (let x = -h; x < w + h; x += 7) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + h * 0.7, h);
      g.stroke();
    }
    // 플레이어 색 띠(그립 위아래)
    g.fillStyle = color;
    g.fillRect(0, h * 0.06, w, h * 0.06);
    g.fillRect(0, h * 0.86, w, h * 0.05);
    // 앞면 글자
    g.save();
    g.translate(w * 0.25, h * 0.5);
    g.rotate(-Math.PI / 2);
    g.fillStyle = '#f2f2ee';
    g.font = '900 30px "Pretendard Variable", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('PUTT', 0, 0);
    g.restore();
  });
  t.wrapS = THREE.RepeatWrapping;
  gripTexCache.set(color, t);
  return t;
}

const millTex = canvasTex(256, 64, (g, w, h) => {
  g.fillStyle = '#9aa0a8';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(40,44,52,0.55)';
  g.lineWidth = 1;
  for (let r = 6; r < 360; r += 5) {
    g.beginPath();
    g.arc(w / 2, h * 2.6, r, 0, Math.PI * 2);
    g.stroke();
  }
});

export function makePutter(color) {
  const g = new THREE.Group();
  const steel = new THREE.MeshPhysicalMaterial({ color: '#c3c8cf', metalness: 1, roughness: 0.34, clearcoat: 0.3, clearcoatRoughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: '#2a2d33', metalness: 0.7, roughness: 0.45 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#e3e6ea', metalness: 1, roughness: 0.14 });
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1 });
  const white = new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.4 });
  const add = (geo, mat, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    g.add(m);
    return m;
  };

  // 페이스 판(앞 벽): 토~힐 104mm, 높이 21mm, 두께 9mm
  add(upExtrude(roundRect(new THREE.Shape(), -0.052, -0.009, 0.104, 0.009, 0.0035), 0.021), steel);
  // 뒤쪽 플랜지(바닥판): 뒤 가장자리가 살짝 둥근 모양
  {
    const s = new THREE.Shape();
    s.moveTo(-0.05, -0.006);
    s.lineTo(0.05, -0.006);
    s.lineTo(0.05, -0.024);
    s.quadraticCurveTo(0.049, -0.031, 0.042, -0.031);
    s.bezierCurveTo(0.02, -0.034, -0.02, -0.034, -0.042, -0.031);
    s.quadraticCurveTo(-0.049, -0.031, -0.05, -0.024);
    s.closePath();
    add(upExtrude(s, 0.0095), steel);
  }
  // 힐·토 무게추(가운데가 파인 캐비티를 만듭니다)
  for (const sx of [-1, 1]) {
    const s = roundRect(new THREE.Shape(), sx < 0 ? -0.0525 : 0.0395, -0.029, 0.013, 0.025, 0.004);
    add(upExtrude(s, 0.0195), steel);
  }
  // 캐비티 안쪽 색 띠(플레이어 색)
  {
    const m = add(new THREE.BoxGeometry(0.074, 0.008, 0.0012), paint, false);
    m.position.set(0, 0.0135, 0.0096);
  }
  // 정렬선: 플랜지 위 흰 선과 윗면 점
  {
    const line = add(new THREE.BoxGeometry(0.0016, 0.0006, 0.019), white, false);
    line.position.set(0, 0.0098, 0.02);
    const dot = add(new THREE.CylinderGeometry(0.0013, 0.0013, 0.0006, 12), white, false);
    dot.position.set(0, 0.0212, 0.0045);
  }
  // 페이스 밀링(가는 원호 무늬)
  {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.096, 0.017), new THREE.MeshStandardMaterial({ map: millTex, metalness: 0.9, roughness: 0.42 }));
    face.position.set(0, 0.0105, -0.0002);
    face.rotation.y = Math.PI;
    g.add(face);
  }
  // 플러머 넥: 세로 기둥 → 꺾임 → 샤프트로
  {
    const curve = new THREE.CatmullRomCurve3([...NECK, HOSEL_TOP], false, 'catmullrom', 0.2);
    add(new THREE.TubeGeometry(curve, 24, 0.0043, 12, false), steel);
    const cap = add(new THREE.SphereGeometry(0.0043, 12, 8), steel);
    cap.position.copy(NECK[0]);
  }
  const along = (mesh, from, len) => {
    mesh.quaternion.setFromUnitVectors(Y, DIR_H);
    mesh.position.copy(from).addScaledVector(DIR_H, len / 2);
    return mesh;
  };
  // 페룰과 샤프트
  along(add(new THREE.CylinderGeometry(0.0052, 0.0047, 0.014, 14), dark), HOSEL_TOP, 0.014);
  const shaftLen = SHAFT_LEN - 0.26;
  const shaftStart = HOSEL_TOP.clone().addScaledVector(DIR_H, 0.012);
  along(add(new THREE.CylinderGeometry(0.0058, 0.0044, shaftLen - 0.012, 14), chrome), shaftStart, shaftLen - 0.012);
  // 샤프트 단(스텝) 두 개
  for (const k of [0.32, 0.46]) {
    const ring = add(new THREE.TorusGeometry(0.0052, 0.0006, 6, 16), chrome, false);
    ring.quaternion.setFromUnitVectors(V(0, 0, 1), DIR_H);
    ring.position.copy(HOSEL_TOP).addScaledVector(DIR_H, k);
  }
  // 그립: 아래가 가늘고 위가 굵은 회전체, 앞쪽을 납작하게 눌러 퍼터 그립 모양으로
  {
    const prof = [];
    const L = 0.262;
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      prof.push(new THREE.Vector2(0.0098 + 0.0052 * Math.pow(t, 0.85), t * L));
    }
    prof.push(new THREE.Vector2(0.0145, L + 0.002), new THREE.Vector2(0.011, L + 0.006), new THREE.Vector2(0, L + 0.007));
    const geo = new THREE.LatheGeometry(prof, 28);
    geo.scale(1, 1, 0.84);
    const grip = add(geo, new THREE.MeshStandardMaterial({ map: gripTexture(color), roughness: 0.82 }));
    grip.quaternion.setFromUnitVectors(Y, DIR_H);
    grip.position.copy(GRIP_TOP).addScaledVector(DIR_H, -L - 0.004);
    // 그립 끝 캡(플레이어 색)
    const cap = add(new THREE.CylinderGeometry(0.0108, 0.0108, 0.0016, 20), paint, false);
    cap.quaternion.setFromUnitVectors(Y, DIR_H);
    cap.position.copy(GRIP_TOP).addScaledVector(DIR_H, 0.0035);
  }
  return g;
}

// ---------- 퍼팅하는 골퍼 ----------
// 몸 좌표: +x 목표, +y 위, +z 공 쪽. root 의 원점이 공 밑 땅입니다.
export function createPuttingGolfer(color) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const golfer = makeGolfer(color);
  body.add(golfer.group);
  const pivot = new THREE.Group();
  const twist = new THREE.Group();
  const putter = makePutter(color);
  pivot.add(twist);
  twist.add(putter);
  body.add(pivot);
  putter.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  // 어드레스: 헤드 좌표(토, 위, 뒤) → 몸 좌표((0,0,1), (0,1,0), (-1,0,0))
  const R0 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 0, 1), Y, V(-1, 0, 0)));
  const toBody = (v) => v.clone().applyQuaternion(R0);
  // 왼손이 어깨 밑(살짝 목표 쪽)에 오도록 헤드 자리를 정합니다. 헤드 바닥은 땅(y=0)에.
  const HAND_TARGET = V(0.035, toBody(HAND_L).y, 0.165);
  const headPos = HAND_TARGET.clone().sub(toBody(HAND_L));
  headPos.y = 0;
  const ballBody = headPos.clone().add(toBody(V(0, BALL_R, -(BALL_R + 0.0012))));
  body.position.set(-ballBody.x, 0, -ballBody.z);
  const gripBody = headPos.clone().add(toBody(GRIP_TOP));
  // 진자 축: 어깨 가운데. golf/scene.js 의 PELVIS(0, .88, -.06), LEAN .62, 어깨 높이 .43 과 같습니다.
  const P = V(0, 0.88 + 0.43 * Math.cos(0.62), -0.06 + 0.43 * Math.sin(0.62));
  const D0 = toBody(DIR_H).negate().normalize(); // 그립 → 헤드
  const A = new THREE.Vector3().crossVectors(D0, V(1, 0, 0)).normalize(); // +각이면 헤드가 목표 쪽으로
  pivot.position.copy(P);
  twist.position.copy(gripBody).sub(P);
  putter.position.copy(headPos).sub(gripBody);
  putter.quaternion.copy(R0);

  const qa = new THREE.Quaternion();
  const qt = new THREE.Quaternion();
  const M = new THREE.Matrix4();
  const hand = new THREE.Vector3();
  const shaft = new THREE.Vector3();
  const footR = V(-0.24, 0.08, 0.02);
  const state = { theta: 0, face: 0, head: 0, lookUp: 0 };

  // theta: 진자 각(라디안, +면 헤드가 목표 쪽), face: 페이스 열림(라디안, +면 오른쪽)
  function pose(theta, face, head = 0, lookUp = 0) {
    state.theta = theta;
    state.face = face;
    state.head = head;
    state.lookUp = lookUp;
    pivot.quaternion.copy(qa.setFromAxisAngle(A, theta));
    twist.quaternion.copy(qt.setFromAxisAngle(D0, face));
    pivot.updateMatrix();
    twist.updateMatrix();
    putter.updateMatrix();
    M.copy(pivot.matrix).multiply(twist.matrix).multiply(putter.matrix);
    hand.copy(HAND_L).applyMatrix4(M);
    shaft.copy(D0).applyQuaternion(qt).applyQuaternion(qa).normalize();
    golfer.pose({
      turn: theta * 0.55,
      hip: theta * 0.08,
      shift: 0,
      head,
      lookUp,
      hands: hand.clone(),
      shaft: shaft.clone(),
      footR,
      heel: 0
    });
  }
  pose(0, 0);

  // 헤드 페이스 가운데의 몸 좌표(공 맞는 자리 확인용)
  function headWorld(target) {
    return target.copy(V(0, 0.011, 0)).applyMatrix4(M).add(body.position);
  }

  return { root, pose, state, headWorld, pivotRadius: P.distanceTo(headPos) };
}
