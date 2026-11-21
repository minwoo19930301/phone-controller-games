// 볼링 장면: 렌더러(ACES·PCF 부드러운 그림자·RoomEnvironment), 볼링장 건물(조명·벽·천장·카펫·좌석·옆 레인),
// 본 레인(핀 10개·공·핀세터·스윕 바·천장 모니터), 카메라 연출(뒤에서 겨누기 → 공 따라가기 → 핀 카메라 → 결과 → 히어로).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { C, PIN_SPOTS } from './physics.mjs';
import {
  makeLane, makePinsetter, makePin, makePinRack, makeBall, setBallColor, makeMonitor, drawMonitor, makeBallReturn, makeBallRack, makeSeat,
  carpetTexture, makeLaneMirror, LANE_LEN, LANE_SPACING, APPROACH
} from './models.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const lerp = (a, b, t) => a + (b - a) * t;
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _ax = new THREE.Vector3();

export function createScene(canvas, { low = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#07090f');
  scene.fog = new THREE.Fog('#0a0c14', 22, 46);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.42;

  const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.05, 80);
  camera.position.set(0, 1.5, 4.2);

  // ---------- 건물 ----------
  const room = new THREE.Group();
  scene.add(room);
  const W = 13, WALL_Z = -23.5, CEIL = 5.2;
  const wallMat = new THREE.MeshStandardMaterial({ color: '#141a2c', roughness: 0.85 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, CEIL + 1), wallMat);
  back.position.set(0, CEIL / 2 - 0.5, WALL_Z); room.add(back);
  for (const s of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, CEIL + 1), wallMat);
    wall.rotation.y = -s * Math.PI / 2; wall.position.set(s * W, CEIL / 2 - 0.5, -8); room.add(wall);
  }
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, 50), new THREE.MeshStandardMaterial({ color: '#0d1019', roughness: 0.9 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(0, CEIL, -8); room.add(ceil);
  // 바닥(카펫): 어프로치 뒤쪽과 레인 옆
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, 22), new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 0.9 }));
  carpet.rotation.x = -Math.PI / 2; carpet.position.set(0, -0.012, APPROACH + 11 - 0.01); carpet.receiveShadow = true; room.add(carpet);
  const tileTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#222a44'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#0c1020'; g.fillRect(0, 0, 128, 128); g.fillRect(128, 128, 128, 128);
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(W * 2 / 1.6, (LANE_LEN + 4) / 1.6); t.anisotropy = 8;
    return t;
  })();
  const floorSide = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, LANE_LEN + 4), new THREE.MeshPhysicalMaterial({ map: tileTex, roughness: 0.28, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.15, envMapIntensity: 0.8 }));
  floorSide.rotation.x = -Math.PI / 2; floorSide.position.set(0, -0.02, -LANE_LEN / 2 + 1); floorSide.receiveShadow = true; room.add(floorSide);
  // 벽 네온 띠
  const neonCols = ['#ff4f9a', '#3ee6d6', '#ffb13c'];
  neonCols.forEach((c, i) => {
    const m = new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
    for (const s of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 40), m);
      strip.position.set(s * (W - 0.05), 2.6 + i * 0.42, -8); room.add(strip);
    }
    const bs = new THREE.Mesh(new THREE.BoxGeometry(W * 2, 0.06, 0.06), m);
    bs.position.set(0, 3.4 + i * 0.4, WALL_Z + 0.1); room.add(bs);
  });
  // 천장 조명 띠(레인마다)
  const lightMat = new THREE.MeshBasicMaterial({ color: '#fff0cf', toneMapped: false });
  for (let k = -3; k <= 3; k++) {
    for (const z of [-2, -9, -16]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.28), lightMat);
      f.position.set(k * LANE_SPACING, CEIL - 0.1, z); room.add(f);
    }
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 40), new THREE.MeshStandardMaterial({ color: '#1b2030', roughness: 0.7 }));
    lamp.position.set(k * LANE_SPACING - 0.8, CEIL - 0.06, -8); room.add(lamp);
  }
  // 어프로치 뒤 칸막이(낮은 벽)와 좌석
  const seatCols = ['#ff7a3c', '#2fbfb4', '#ff4f9a', '#6a7cff'];
  for (let i = 0; i < 7; i++) {
    const s = makeSeat(seatCols[i % seatCols.length]);
    s.position.set((i - 3) * 1.15, 0, APPROACH + 1.9);
    s.rotation.y = Math.PI + ((i - 3) * 0.06);
    room.add(s);
  }
  const table = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.04, 32), new THREE.MeshPhysicalMaterial({ color: '#10141f', roughness: 0.25, metalness: 0.4, clearcoat: 1 }));
  table.position.set(0, 0.62, APPROACH + 0.95); table.castShadow = true; room.add(table);
  const tleg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 12), new THREE.MeshStandardMaterial({ color: '#aab0be', metalness: 0.9, roughness: 0.3 }));
  tleg.position.set(0, 0.3, APPROACH + 0.95); room.add(tleg);
  // 뒤쪽 바 카운터
  const bar = new THREE.Mesh(new THREE.BoxGeometry(9, 1.05, 0.7), new THREE.MeshPhysicalMaterial({ color: '#1b2236', roughness: 0.3, metalness: 0.2, clearcoat: 0.8 }));
  bar.position.set(0, 0.52, APPROACH + 8); bar.castShadow = true; room.add(bar);
  const barTop = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.06, 0.9), new THREE.MeshPhysicalMaterial({ color: '#3a2a1d', roughness: 0.2, clearcoat: 1 }));
  barTop.position.set(0, 1.07, APPROACH + 8); room.add(barTop);
  const barLight = new THREE.Mesh(new THREE.BoxGeometry(9, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: '#ff9a3c', toneMapped: false }));
  barLight.position.set(0, 1.9, APPROACH + 8.2); room.add(barLight);

  // ---------- 레인들 ----------
  const lanes = new THREE.Group();
  scene.add(lanes);
  const neighbors = [];
  for (const k of [-2, -1, 1, 2]) {
    const cx = k * LANE_SPACING;
    lanes.add(makeLane(cx, { detailed: false, dim: true }));
    lanes.add(makePinsetter(cx, { logo: k % 2 ? 'LANE\n' + (k < 0 ? 3 + k + 2 : k + 4) : 'LANE\n' + (k < 0 ? 1 : 6) }));
    const rack = new THREE.Group();
    lanes.add(rack);
    makePinRack(rack, cx);
    rack.children.forEach((p) => { p.traverse((o) => { if (o.isMesh) o.castShadow = false; }); });
    // 이웃 레인 모니터
    const mon = makeMonitor(1.7, 0.95);
    mon.position.set(cx, 3.35, -7.8 - (Math.abs(k) - 1) * 0.0);
    mon.rotation.x = 0.1;
    lanes.add(mon);
    neighbors.push({ cx, mon });
  }
  const mainLane = makeLane(0, { detailed: true });
  lanes.add(mainLane);
  const setter = makePinsetter(0, { logo: 'STRIKE\nCLUB' });
  lanes.add(setter);
  const sweep = setter.userData.sweep;
  const mirror = makeLaneMirror(C.LANE_W, LANE_LEN, { res: low ? 0.5 : 1 });
  mirror.position.set(0, 0.0012, -LANE_LEN / 2);
  scene.add(mirror);

  // 본 레인 핀 10개
  const pinGroup = new THREE.Group();
  scene.add(pinGroup);
  const pins = [];
  const pinPose = [];
  for (let i = 0; i < 10; i++) {
    const p = makePin();
    pinGroup.add(p);
    pins.push(p);
    pinPose.push({ pitT: -1, lift: 0, dropIn: 0 });
  }
  // 공
  const ball = makeBall('#ff5a5f');
  scene.add(ball);
  ball.visible = false;

  // 점수 모니터(본 레인)
  const monitor = makeMonitor(2.3, 1.25);
  monitor.position.set(0, 3.2, -6.5);
  monitor.rotation.x = 0.12;
  scene.add(monitor);
  // 이웃 모니터에 가짜 점수
  neighbors.forEach((n, i) => {
    drawMonitor(n.mon, [
      { name: 'ALEX', color: '#ff7a5c', score: 118 + i * 17, marks: 'X 7/ 9- X', active: false },
      { name: 'JIN', color: '#3ab4ff', score: 96 + i * 11, marks: '8/ X 6- 7/', active: i % 2 === 0 }
    ], { title: `LANE ${i < 2 ? i + 1 : i + 2}`, right: 'FRAME ' + (4 + i) });
  });

  // 볼 리턴(어프로치 오른쪽) · 볼 랙(왼쪽)
  const ret = makeBallReturn('#d8352f');
  ret.position.set(1.02, 0, 3.2);
  scene.add(ret);
  const rack = makeBallRack(['#ff5a5f', '#3ab4ff', '#ffc93c', '#5ee07a', '#c77dff', '#ff8fd1', '#3ee6d6', '#ff9b3d']);
  rack.position.set(-1.12, 0, 3.4);
  rack.rotation.y = 0.25;
  scene.add(rack);

  // 서는 자리 표시(발밑 링) · 안내선
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 40), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, toneMapped: false }));
  marker.rotation.x = -Math.PI / 2; marker.position.set(0, 0.004, 1.6);
  scene.add(marker);
  const markerGlow = new THREE.Mesh(new THREE.CircleGeometry(0.34, 32), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.22, toneMapped: false, depthWrite: false }));
  markerGlow.rotation.x = -Math.PI / 2; markerGlow.position.set(0, 0.003, 1.6);
  scene.add(markerGlow);
  const guide = new THREE.Group();
  scene.add(guide);
  const guideDots = [];
  const dotGeo = new THREE.CircleGeometry(0.03, 12);
  const guideMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, toneMapped: false, depthWrite: false });
  for (let i = 0; i < 38; i++) { const d = new THREE.Mesh(dotGeo, guideMat); d.rotation.x = -Math.PI / 2; guide.add(d); guideDots.push(d); }
  guide.visible = false;

  // ---------- 조명 ----------
  scene.add(new THREE.HemisphereLight('#ffe4bf', '#2a1a12', 0.55));
  const mkSpot = (x, y, z, tx, ty, tz, intensity, angle, shadow) => {
    const s = new THREE.SpotLight('#ffe2b8', intensity, 40, angle, 0.85, 1.6);
    s.position.set(x, y, z);
    s.target.position.set(tx, ty, tz);
    if (shadow) {
      s.castShadow = true;
      s.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
      s.shadow.bias = -0.00015; s.shadow.normalBias = 0.012; s.shadow.radius = 5;
      s.shadow.camera.near = 1; s.shadow.camera.far = 30;
    }
    scene.add(s, s.target);
    return s;
  };
  const spotA = mkSpot(0.0, 4.9, 2.0, 0, 0, -3, 200, 0.62, true); // 어프로치·공
  const spotB = mkSpot(0.0, 4.9, -8.0, 0, 0, -9, 240, 0.42, true); // 레인 가운데
  const spotC = mkSpot(0.0, 4.9, -15.0, 0, 0, -18.3, 420, 0.4, true); // 핀
  const pinFill = new THREE.PointLight('#fff0d8', 5, 6, 1.6);
  pinFill.position.set(0, 1.4, -17.0); scene.add(pinFill);
  const accent1 = new THREE.PointLight('#ff4f9a', 18, 10, 1.6); accent1.position.set(-3.2, 2.4, -19); scene.add(accent1);
  const accent2 = new THREE.PointLight('#3ee6d6', 18, 10, 1.6); accent2.position.set(3.2, 2.4, -19); scene.add(accent2);
  const houseLight = new THREE.PointLight('#ffb36a', 16, 9, 1.8); houseLight.position.set(0, 2.2, -19.8); scene.add(houseLight);

  // ---------- 핀·공 자세 ----------
  function posePin(i, x, y, z, tilt, yaw, state, dt = 0) {
    const g = pins[i];
    const pp = pinPose[i];
    if (state === 3) { g.visible = false; return; }
    g.visible = true;
    if (state === 2) {
      if (pp.pitT < 0) pp.pitT = 0;
      pp.pitT += dt;
      g.position.set(x, -pp.pitT * 2.2, -y);
      g.visible = pp.pitT < 0.7;
      return;
    }
    pp.pitT = -1;
    const s = Math.sin(tilt);
    _d.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const off = 0.17 * s;
    let h = z + 0.05 * s + pp.lift;
    if (Math.abs(x) > C.HALF + 0.02 && Math.abs(x) < C.HALF + 0.47) h -= 0.07 * s; // 거터에 누운 핀은 조금 가라앉음
    g.position.set(x - _d.x * off, h, -y - _d.z * off);
    _ax.set(_d.z, 0, -_d.x).normalize();
    g.quaternion.setFromAxisAngle(_ax, tilt);
    // 누워서 도는 핀은 길이 축을 따라 자전(수평 yaw 는 d 방향으로 이미 반영)
  }
  function setStanding(standing, o = {}) {
    for (let i = 0; i < 10; i++) {
      pinPose[i].pitT = -1; pinPose[i].lift = o.lift || 0;
      pins[i].quaternion.identity();
      if (standing[i]) { pins[i].visible = true; pins[i].position.set(PIN_SPOTS[i].x, o.lift || 0, -PIN_SPOTS[i].y); } else pins[i].visible = false;
    }
  }
  function applyFrame(sim, tp, dt = 0) {
    const f = clamp(tp / C.REC, 0, sim.n - 1);
    const i0 = Math.floor(f), i1 = Math.min(sim.n - 1, i0 + 1), u = f - i0;
    const P = sim.pins;
    for (let i = 0; i < 10; i++) {
      const a = i0 * 60 + i * 6, b = i1 * 60 + i * 6;
      const st = P[a + 5];
      posePin(i, lerp(P[a], P[b], u), lerp(P[a + 1], P[b + 1], u), lerp(P[a + 2], P[b + 2], u), lerp(P[a + 3], P[b + 3], u), lerp(P[a + 4], P[b + 4], u), st, dt);
    }
    const bi = i0 * 5, bj = i1 * 5;
    const bs = sim.ball[bi + 4];
    ball.visible = bs < 2 || sim.ball[bi + 3] > -0.8;
    const bx = lerp(sim.ball[bi], sim.ball[bj], u), by = lerp(sim.ball[bi + 1], sim.ball[bj + 1], u);
    const bz = lerp(sim.ball[bi + 3], sim.ball[bj + 3], u);
    ball.position.set(bx, C.BALL_R + bz + (bs === 2 ? -Math.max(0, (by - C.PIT_Y)) * 6 : 0), -by);
    ball.userData.roll.rotation.x = -lerp(sim.ball[bi + 2], sim.ball[bj + 2], u);
    if (bs === 2) ball.visible = false;
    return { x: bx, y: by };
  }

  // ---------- 스윕 / 새 랙 ----------
  const zb = -LANE_LEN;
  function sweepAt(t, sim, restStanding) {
    // 0~0.45 선 핀 들어올림 + 바 내림, 0.45~1.6 쓸기, 1.6~2.2 바 올림 + 선 핀 내림
    const lift = t < 0.45 ? t / 0.45 : t < 1.7 ? 1 : clamp(1 - (t - 1.7) / 0.5, 0, 1);
    const barDown = t < 0.4 ? t / 0.4 : t < 1.6 ? 1 : clamp(1 - (t - 1.6) / 0.5, 0, 1);
    const barZ = t < 0.45 ? -(C.HEAD_Y - 0.55) : t < 1.6 ? lerp(-(C.HEAD_Y - 0.55), zb - 0.25, (t - 0.45) / 1.15) : zb - 0.25;
    sweep.position.set(0, lerp(0.95, 0.06, barDown), barZ);
    for (let i = 0; i < 10; i++) {
      const pp = pinPose[i];
      if (!pins[i].visible) continue;
      if (restStanding[i]) {
        pins[i].position.y = 0.36 * lift;
      } else {
        // 누운 채 있던 핀: 바 앞으로 밀려 피트에 떨어짐
        const frontZ = barZ - 0.1;
        if (pins[i].position.z > frontZ) pins[i].position.z = frontZ;
        if (pins[i].position.z < zb - 0.05) { pp.pitT = (pp.pitT < 0 ? 0 : pp.pitT) + 0.016; pins[i].position.y = -pp.pitT * 2.4; if (pp.pitT > 0.6) pins[i].visible = false; }
      }
    }
  }
  function resetSweep() { sweep.position.set(0, 0.95, zb + 0.5); }
  function rackDrop(t) { // t 0..1: 새 핀 10개가 위에서 내려앉음
    const h = (1 - clamp(t, 0, 1)) ** 2 * 0.5;
    for (let i = 0; i < 10; i++) { pins[i].visible = true; pins[i].quaternion.identity(); pins[i].position.set(PIN_SPOTS[i].x, h, -PIN_SPOTS[i].y); pinPose[i].pitT = -1; pinPose[i].lift = 0; }
  }

  // ---------- 서는 자리 · 공 · 안내선 ----------
  const stand = { x: 0 };
  function setStand(x, color) {
    stand.x = x;
    marker.position.x = x; markerGlow.position.x = x;
    if (color) { marker.material.color.set(color); markerGlow.material.color.set(color); }
  }
  function ballAtLine(x, color, show = true) {
    setBallColor(ball, color);
    ball.visible = show;
    ball.position.set(x, C.BALL_R, -0.12);
    ball.userData.roll.rotation.set(0, 0, 0);
  }
  function setGuide(points, color) {
    if (!points || !points.length) { guide.visible = false; return; }
    guide.visible = true;
    guideMat.color.set(color || '#ffffff');
    // 점선: 곡선을 따라 일정 간격으로 점 배치
    let total = 0; const seg = [0];
    for (let i = 1; i < points.length; i++) { total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y); seg.push(total); }
    guideDots.forEach((d, k) => {
      const target = ((k + 0.5) / guideDots.length) * total;
      let j = 1; while (j < seg.length - 1 && seg[j] < target) j++;
      const u = (target - seg[j - 1]) / Math.max(1e-6, seg[j] - seg[j - 1]);
      d.position.set(lerp(points[j - 1].x, points[j].x, u), 0.004, -lerp(points[j - 1].y, points[j].y, u));
      d.scale.setScalar(0.7 + 0.5 * (1 - target / total));
    });
  }

  // ---------- 카메라 연출 ----------
  const cam = {
    shot: 'hero', pos: new THREE.Vector3(0, 2.1, 9.5), look: new THREE.Vector3(0, 1.0, -12), fov: 40, t: 0, shake: 0,
    tp: new THREE.Vector3(), tl: new THREE.Vector3(), tf: 40, k: 3, side: 1, ballX: 0, ballZ: 0, hold: 0
  };
  function setShot(name, o = {}) {
    if (cam.shot !== name) cam.t = 0;
    cam.shot = name;
    Object.assign(cam, o);
  }
  function cut() { cam.snap = true; }
  function updateCamera(dt, ctx = {}) {
    cam.t += dt;
    const sx = stand.x;
    switch (cam.shot) {
      case 'hero': {
        const a = Math.sin(cam.t * 0.12) * 0.5;
        cam.tp.set(a * 1.4 + 0.2, 2.1 + Math.sin(cam.t * 0.17) * 0.12, 6.0);
        cam.tl.set(-a * 0.6, 0.5, -12);
        cam.tf = 42; cam.k = 1.2;
        break;
      }
      case 'aim':
        cam.tp.set(sx * 0.5, 1.5, APPROACH + 0.1);
        cam.tl.set(sx * 0.15, -0.4, -8.5);
        cam.tf = 29; cam.k = 2.4;
        break;
      case 'follow': {
        const z = Math.max(cam.ballZ + 3.2, -8.5);
        cam.tp.set(cam.ballX * 0.55, 0.8 + Math.max(0, (cam.ballZ + 3) * 0.02), z);
        cam.tl.set(cam.ballX * 0.3, 0.18, Math.max(cam.ballZ - 9, -19));
        cam.tf = 38; cam.k = 5;
        break;
      }
      case 'pins': {
        const s = cam.side;
        const sw = Math.sin(cam.t * 0.5) * 0.18;
        cam.tp.set(s * (0.9 + sw), 0.95 + cam.t * 0.04, -(C.HEAD_Y - 4.8));
        cam.tl.set(0, 0.02, -(C.HEAD_Y - 0.2));
        cam.tf = 30; cam.k = 6;
        break;
      }
      case 'pins2': { // 결과: 핀 높은 쪽에서 바라보기
        cam.tp.set(cam.side * 0.4, 1.25, -(C.HEAD_Y - 5.6));
        cam.tl.set(0, 0.0, -(C.HEAD_Y - 0.3));
        cam.tf = 30; cam.k = 2.5;
        break;
      }
      case 'celebrate': {
        const a = cam.t * 0.35;
        cam.tp.set(Math.sin(a) * 1.5, 1.2 + 0.3 * Math.sin(a * 1.3), -(C.HEAD_Y - 5.0) + Math.cos(a) * 0.8);
        cam.tl.set(0, 0.0, -(C.HEAD_Y - 0.3));
        cam.tf = 34; cam.k = 2.2;
        break;
      }
      default: break;
    }
    const kk = cam.snap ? 1 : 1 - Math.exp(-dt * cam.k);
    cam.snap = false;
    cam.pos.lerp(cam.tp, kk);
    cam.look.lerp(cam.tl, kk);
    cam.fov = lerp(cam.fov, cam.tf, 1 - Math.exp(-dt * 4));
    camera.fov = cam.fov;
    camera.updateProjectionMatrix();
    cam.shake = Math.max(0, cam.shake - dt * 2.5);
    const sh = cam.shake * cam.shake * 0.05;
    camera.position.set(cam.pos.x + (Math.random() - 0.5) * sh, cam.pos.y + (Math.random() - 0.5) * sh, cam.pos.z);
    camera.lookAt(cam.look);
    void ctx;
  }

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);

  // 점광 깜박임(네온 느낌) 등 아주 작은 움직임
  let tAmb = 0;
  function update(dt) {
    tAmb += dt;
    marker.material.opacity = 0.7 + 0.25 * Math.sin(tAmb * 4);
    markerGlow.material.opacity = 0.18 + 0.08 * Math.sin(tAmb * 4);
  }
  function render() { renderer.render(scene, camera); }

  return {
    renderer, scene, camera, pins, ball, monitor, sweep, cam, marker, markerGlow, guide, ret, rack, pinPose,
    posePin, setStanding, applyFrame, sweepAt, resetSweep, rackDrop, setStand, ballAtLine, setGuide, setShot, cut, updateCamera, update, render, resize,
    drawMonitor: (rows, o) => drawMonitor(monitor, rows, o),
    setMarkerVisible(v) { marker.visible = v; markerGlow.visible = v; },
    shake(a) { cam.shake = Math.min(1.4, cam.shake + a); }
  };
}
