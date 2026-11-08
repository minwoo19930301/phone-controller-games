// 에어하키 장면: 오락실 방 + 테이블 + 말렛·퍽. 조명(위 갓 스포트라이트·색 테두리 조명), 블룸, 카메라.
// 경기 중 카메라는 1P 쪽 뒤 위에서 비스듬히 내려다보고, 화면 비율에 맞춰 테이블이 꽉 차게 거리를 잡습니다.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RINK } from './physics.js';
import { makePlayfield, makeRails, makeCabinet, makeScoreConsole, makeMallet, makePuck, makeTrail, makeTrailBuffer, pushTrail, clearTrail, layoutTrail, makeRings, makeSparks, makeRoom, RW } from './models.js';

const { W, L, TOP, GOAL } = RINK;

export function createScene(cv) {
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#06050d');
  scene.fog = new THREE.Fog('#06050d', 7, 17);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.32;

  // ---------- 조명 ----------
  scene.add(new THREE.HemisphereLight('#8f7cff', '#1a0f20', 0.35));
  // 위 갓 조명: 반사광(광택 판에 비친 램프)이 판 바깥 앞쪽에 떨어지게 조금 앞에서 비춥니다.
  const key = new THREE.SpotLight('#fff1dc', 11, 0, 0.5, 0.75, 2);
  key.position.set(0, 3.95, 0.85);
  key.target.position.set(0, TOP, -0.15);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 2.0;
  key.shadow.camera.far = 4.4;
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.006;
  key.shadow.radius = 3;
  scene.add(key, key.target);
  for (const z of [-0.75, 0.75]) {
    const s = new THREE.SpotLight('#ffeedd', 3, 0, 0.55, 0.85, 2);
    s.position.set(0, 3.95, z + 0.5);
    s.target.position.set(0, TOP, z * 1.2);
    scene.add(s, s.target);
  }
  // 색 테두리 조명(분홍·하늘)
  // 세기 2: 7 이면 캐비닛 크롬 띠·클리어코트 레일 정반사가 블룸 임계값을 넘어 하얀 덩어리로 번졌습니다.
  const rimL = new THREE.PointLight('#ff3fb4', 2, 7, 2);
  rimL.position.set(-1.6, 0.5, 0.7); // 판보다 낮게: 캐비닛 옆면·바닥만 물들이고 광택 판에 번쩍이지 않게
  const rimR = new THREE.PointLight('#29d7ff', 2, 7, 2);
  rimR.position.set(1.6, 0.5, -0.7);
  scene.add(rimL, rimR);
  const roomFill = new THREE.DirectionalLight('#7a68ff', 0.35);
  roomFill.position.set(1, 3, 4);
  scene.add(roomFill);
  // 팀 색 끝 조명(골 때 번쩍)
  const endA = new THREE.PointLight('#ff5a5f', 0, 2.6, 2);
  endA.position.set(0, TOP + 0.3, L / 2 + 0.35);
  const endB = new THREE.PointLight('#3ab4ff', 0, 2.6, 2);
  endB.position.set(0, TOP + 0.3, -L / 2 - 0.35);
  scene.add(endA, endB);

  // ---------- 물건 ----------
  scene.add(makeRoom());
  const cabinet = makeCabinet();
  scene.add(cabinet.group);
  const field = makePlayfield();
  scene.add(field.mesh);
  let rails = makeRails(GOAL);
  scene.add(rails.group);
  let goalW = GOAL;
  const teamCol = ['#ff5a5f', '#3ab4ff'];
  const consoles = [makeScoreConsole(-1), makeScoreConsole(1)];
  for (const c of consoles) scene.add(c.group);
  const puck = makePuck();
  scene.add(puck);
  const trail = makeTrail(30);
  scene.add(trail);
  const trailBuf = makeTrailBuffer(30, 200); // 꼬리 = 최근 0.2초(프레임 수가 아니라 시간)
  const rings = makeRings();
  scene.add(rings.group);
  const sparks = makeSparks();
  scene.add(sparks.points);

  // ---------- 말렛 ----------
  const mallets = new Map();
  function setMallets(list) {
    const keep = new Set(list.map((m) => m.id));
    for (const [id, m] of mallets) {
      if (!keep.has(id)) {
        scene.remove(m.group);
        m.group.userData.dispose();
        mallets.delete(id);
      }
    }
    for (const m of list) {
      const cur = mallets.get(m.id);
      if (cur && cur.color === m.color && cur.label === m.label) continue;
      if (cur) {
        scene.remove(cur.group);
        cur.group.userData.dispose();
      }
      const group = makeMallet(m.color, m.label);
      scene.add(group);
      mallets.set(m.id, { group, color: m.color, label: m.label, tilt: new THREE.Vector2() });
    }
  }
  function poseMallet(id, x, z, vx = 0, vz = 0, dim = false) {
    const m = mallets.get(id);
    if (!m) return;
    m.group.position.set(x, TOP, z);
    // 빨리 밀면 진행 방향으로 살짝 기울어집니다(손으로 누르는 느낌)
    const k = 0.02;
    m.tilt.x += (Math.max(-0.12, Math.min(0.12, vz * k)) - m.tilt.x) * 0.3;
    m.tilt.y += (Math.max(-0.12, Math.min(0.12, -vx * k)) - m.tilt.y) * 0.3;
    m.group.rotation.set(m.tilt.x, 0, m.tilt.y);
    m.group.userData.puddle.material.opacity = dim ? 0.12 : 0.45;
  }

  // ---------- 퍽 ----------
  const trailCol = new THREE.Color();
  const cyan = new THREE.Color('#7df3ff');
  const hot = new THREE.Color('#ff4fd8');
  const deep = new THREE.Color('#0fb4ff');
  const deepHot = new THREE.Color('#ff1fb0');
  const trailInk = new THREE.Color();
  let puckSpeed = 0;
  function setPuck(p) {
    if (!p || !p.visible) {
      puck.visible = false;
      clearTrail(trailBuf);
      trail.visible = false;
      return;
    }
    puck.visible = true;
    puck.position.set(p.x, TOP + (p.y || 0), p.z);
    puck.rotation.y = -(p.angle || 0);
    puck.scale.setScalar(p.scale == null ? 1 : p.scale);
    puckSpeed = p.speed || 0;
    if (p.jump || p.y) clearTrail(trailBuf);
    if (!p.y) pushTrail(trailBuf, p.x, p.z, performance.now()); // game.js 가 frame 에 넘기는 now 와 같은 시계
  }

  // ---------- 효과 ----------
  let shake = 0;
  const endPulse = { A: 0, B: 0 };
  function hitFx(x, z, color, q) {
    rings.spawn(x, z, color, 0.16 + q * 0.32);
    if (q > 0.35) sparks.burst(x, TOP + 0.03, z, color, Math.round(6 + q * 18), 0.6 + q * 1.4, 0.7);
    if (q > 0.7) shake = Math.max(shake, 0.25 * q);
  }
  function wallFx(x, z, q) {
    if (q > 0.25) rings.spawn(x, z, '#ffffff', 0.08 + q * 0.12);
  }
  // team: 골을 넣은 팀('A' 아래쪽 / 'B' 위쪽), intoSide: 퍽이 들어간 골문(+1 아래, −1 위)
  function goalFx(team, intoSide, color) {
    const z = intoSide * (L / 2 + RW / 2);
    sparks.burst(0, TOP + 0.02, z, color, 140, 2.2, 1.4);
    sparks.burst(0, TOP + 0.02, z, '#ffffff', 40, 1.6, 1.2);
    rails.flash(team, 1.4);
    rails.goalLamp(intoSide > 0 ? 'A' : 'B', color);
    endPulse[team] = 1;
    shake = 0.8;
  }
  // 골문 폭(난이도)이 바뀌면 레일·골문 홈과 캐비닛 윗판 구멍을 그 폭으로 다시 만듭니다. 대기실에서만 바뀝니다.
  function setGoal(w) {
    if (!Number.isFinite(w) || Math.abs(w - goalW) < 1e-4) return;
    goalW = w;
    scene.remove(rails.group);
    rails.dispose();
    rails = makeRails(w);
    rails.setColors(teamCol[0], teamCol[1]);
    scene.add(rails.group);
    cabinet.setGoal(w);
  }
  function setTeams(cA, cB, nA, nB) {
    teamCol[0] = cA;
    teamCol[1] = cB;
    field.setColors(cA, cB);
    rails.setColors(cA, cB);
    cabinet.setColors(cA, cB, nA, nB);
    endA.color.set(cA);
    endB.color.set(cB);
  }
  function setScore(a, b, cA, cB, nA, nB, hl) {
    for (const c of consoles) c.draw(a, b, cA, cB, nA, nB, hl);
  }

  // ---------- 카메라 ----------
  const cam = new THREE.PerspectiveCamera(34, 1, 0.05, 60);
  const camPos = new THREE.Vector3(0, 3, 4);
  const camLook = new THREE.Vector3(0, TOP, 0);
  const fit = { pos: new THREE.Vector3(), look: new THREE.Vector3(), aspect: 0 };
  const bounds = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      bounds.push(new THREE.Vector3(sx * (W / 2 + RW + 0.16), TOP + 0.07, sz * 0.25)); // 옆 점수판
      bounds.push(new THREE.Vector3(sx * (W / 2 + RW), TOP + 0.05, sz * (L / 2 + RW + 0.02)));
    }
  }
  const EL = (47 * Math.PI) / 180; // 내려다보는 각
  const _p = new THREE.Vector3();
  function placeFit(d, tz) {
    fit.look.set(0, TOP, tz);
    fit.pos.set(0, TOP + Math.sin(EL) * d, tz + Math.cos(EL) * d);
    cam.position.copy(fit.pos);
    cam.lookAt(fit.look);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    let x0 = 1e9;
    let x1 = -1e9;
    let y0 = 1e9;
    let y1 = -1e9;
    for (const b of bounds) {
      _p.copy(b).project(cam);
      x0 = Math.min(x0, _p.x);
      x1 = Math.max(x1, _p.x);
      y0 = Math.min(y0, _p.y);
      y1 = Math.max(y1, _p.y);
    }
    return { x0, x1, y0, y1 };
  }
  // 위쪽 13% 는 점수판(HUD) 자리, 아래쪽 5% 는 여백
  const YT = 0.66;
  const YB = -0.9;
  const XM = 0.9;
  function computeFit(aspect) {
    cam.aspect = aspect;
    cam.fov = 34;
    let tz = 0.02;
    let d = 3;
    for (let iter = 0; iter < 6; iter++) {
      let lo = 1;
      let hi = 14;
      for (let i = 0; i < 28; i++) {
        d = (lo + hi) / 2;
        const r = placeFit(d, tz);
        const ok = r.x0 >= -XM && r.x1 <= XM && r.y1 - r.y0 <= YT - YB;
        if (ok) hi = d;
        else lo = d;
      }
      d = hi;
      const r = placeFit(d, tz);
      // 위아래 가운데 맞추기: 화면에서 원하는 띠의 가운데로 옮깁니다.
      const want = (YT + YB) / 2;
      const have = (r.y0 + r.y1) / 2;
      tz -= (have - want) * 1.1; // NDC 1 ≈ 1.2~1.5m. 판이 너무 위에 있으면 시선을 더 멀리(−z) 둡니다.
    }
    placeFit(d, tz);
    fit.aspect = aspect;
  }

  const view = { mode: 'lobby', blend: 0 };
  let composer = null;
  let bloom = null;
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    cam.aspect = w / Math.max(1, h);
    cam.updateProjectionMatrix();
    if (composer) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
    }
    computeFit(w / Math.max(1, h));
  }
  // 장면은 컴포저 렌더 타깃에 그려지므로 renderer 의 antialias 가 안 먹습니다. 타깃 자체를 MSAA(4x)로 만듭니다.
  // 크기는 바로 아래 resize() 가 맞춥니다(clone 된 두 번째 타깃도 samples 를 물려받음).
  const pr0 = renderer.getPixelRatio();
  const msaa = Math.min(4, renderer.capabilities.maxSamples || 0);
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(Math.max(1, window.innerWidth * pr0), Math.max(1, window.innerHeight * pr0), { type: THREE.HalfFloatType, samples: msaa }));
  composer.addPass(new RenderPass(scene, cam));
  bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.5, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  window.addEventListener('resize', resize);
  resize();

  const tPos = new THREE.Vector3();
  const tLook = new THREE.Vector3();
  let first = true;
  /**
   * mode: 'play' | 'lobby' | 'over'
   */
  function frame(now, dt, mode) {
    const t = now / 1000;
    if (mode === 'play') {
      tPos.copy(fit.pos);
      tLook.copy(fit.look);
      // 아주 느린 숨쉬기(살아 있는 화면)
      tPos.x += Math.sin(t * 0.35) * 0.03;
      tPos.y += Math.sin(t * 0.27) * 0.015;
    } else {
      // 대기실·결과: 낮게 멀리 돌며 거의 수평으로 봅니다(내려다보는 각 약 10°). 테이블은 화면 아래쪽,
      // 위쪽엔 벽의 네온 간판(2.7~2.9m)과 게임기 화면·간판(1.3~1.7m)이 들어옵니다. 예전처럼 28° 내려다보면 위 끝이 먼 벽 0.5m 높이라 카펫만 보였습니다.
      const over = mode === 'over';
      const a = t * (over ? 0.12 : 0.07) + 0.6;
      const r = over ? 3.7 : 4.2;
      tPos.set(Math.sin(a) * r, TOP + (over ? 1.15 : 1.3), Math.cos(a) * r);
      tLook.set(0, TOP + (over ? 0.5 : 0.55), 0);
    }
    const k = first ? 1 : 1 - Math.exp(-dt / 0.55);
    first = false;
    camPos.lerp(tPos, k);
    camLook.lerp(tLook, k);
    shake = Math.max(0, shake - dt * 1.8);
    const j = shake * shake * 0.025;
    cam.position.set(camPos.x + (Math.random() - 0.5) * j, camPos.y + (Math.random() - 0.5) * j, camPos.z + (Math.random() - 0.5) * j);
    cam.fov = 34;
    cam.lookAt(camLook);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    rails.update(dt, now);
    rings.update(dt);
    sparks.update(dt);
    for (const team of ['A', 'B']) endPulse[team] = Math.max(0, endPulse[team] - dt * 0.9);
    endA.intensity = endPulse.A * 3 * (0.6 + 0.4 * Math.sin(now * 0.03));
    endB.intensity = endPulse.B * 3 * (0.6 + 0.4 * Math.sin(now * 0.03));
    // 퍽: 빠를수록 꼬리와 빛이 강하고 분홍으로
    const sp = Math.min(1, puckSpeed / 6);
    trailCol.copy(cyan).lerp(hot, Math.max(0, (sp - 0.55) / 0.45));
    puck.userData.band.emissive.copy(trailCol);
    puck.userData.band.emissiveIntensity = 2.2 + sp * 3;
    puck.userData.topMat.emissive.copy(trailCol);
    puck.userData.puddle.material.color.copy(trailCol);
    puck.userData.puddle.material.opacity = 0.3 + sp * 0.45;
    trailInk.copy(deep).lerp(deepHot, Math.max(0, (sp - 0.55) / 0.45));
    layoutTrail(trail, trailBuf, trailInk, puck.visible ? Math.min(1, puckSpeed / 1.4) : 0, now);
    composer.render(dt);
  }

  const _v = new THREE.Vector3();
  function project(x, y, z) {
    _v.set(x, y, z).project(cam);
    return { x: (_v.x * 0.5 + 0.5) * window.innerWidth, y: (-_v.y * 0.5 + 0.5) * window.innerHeight, behind: _v.z > 1 };
  }
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP);
  const _n = new THREE.Vector2();
  function pickTable(cx, cy) {
    _n.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
    ray.setFromCamera(_n, cam);
    const hit = ray.ray.intersectPlane(plane, _v);
    if (!hit) return null;
    return { x: hit.x, z: hit.z };
  }

  return { frame, setMallets, poseMallet, setPuck, hitFx, wallFx, goalFx, setTeams, setScore, setGoal, project, pickTable, renderer, scene, camera: cam, bloom, get goal() { return goalW; } };
}
