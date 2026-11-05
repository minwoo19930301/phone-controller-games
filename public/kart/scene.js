// 카트 장면: 서킷과 하늘을 한 번 만들고, 화면 분할(뷰포트)마다 그 칸 주인의 운전석 카메라로 그립니다.
// 렌더러 하나로 setViewport/setScissor 를 바꿔 가며 그립니다. 칸 주인의 카트 몸통은 그 칸에서만 숨기고 운전석(후드·핸들)을 보여 줍니다.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { makeKart, makeCockpit, makeTrackMeshes, makeSky, makePuffs } from './models.js';

export function createScene(cv, track) {
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#ffd9a6');
  scene.fog = new THREE.Fog('#f4c79a', 160, 1100);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;

  // 노을 햇빛: 낮게 깔리는 따뜻한 직사광 + 하늘색 보조광
  scene.add(new THREE.HemisphereLight('#a9bde8', '#6b5a4a', 1.25));
  const sun = new THREE.DirectionalLight('#ffd2a0', 2.6);
  sun.position.set(-300, 160, -240);
  scene.add(sun);
  scene.add(makeSky());

  const trackMeshes = makeTrackMeshes(track);
  scene.add(trackMeshes.group);
  const puffs = makePuffs(scene);

  // ---------- 카트 모델(자리마다 하나씩) ----------
  const models = new Map(); // id -> { group, cockpit }
  let roster = [];
  function setRoster(list) {
    for (const m of models.values()) {
      scene.remove(m.group);
      scene.remove(m.cockpit);
    }
    models.clear();
    roster = list;
    list.forEach((k, i) => {
      const group = makeKart(k.color, k.num || i + 1);
      const cockpit = makeCockpit(k.color);
      cockpit.visible = false;
      group.rotation.order = 'YXZ'; // 먼저 앞 축 기울임(롤), 그다음 방향 회전
      cockpit.rotation.order = 'YXZ';
      scene.add(group, cockpit);
      models.set(k.id, { group, cockpit, k });
    });
  }

  function poseKart(m, k, now) {
    const g = m.group;
    g.position.set(k.x, 0, k.z);
    // 모델 앞이 +X 라 y 회전은 -h. 살짝 옆으로 기울이고(롤), 미끄러질 땐 뒤가 흐름
    g.rotation.set(0, -k.h, 0);
    g.rotation.x = -k.steer * Math.min(1, Math.abs(k.vf) / 30) * 0.05;
    g.position.y = Math.sin(now * 0.05 + k.id * 7) * 0.006 * Math.min(1, Math.abs(k.vf) / 10) + (k.offroad ? Math.sin(now * 0.04) * 0.02 : 0);
    const ud = g.userData;
    for (const w of ud.wheels) {
      w.spin.rotation.z = -k.wheelSpin;
      if (w.front) w.holder.rotation.y = -k.steer * 0.45;
    }
    ud.flame.material.opacity = k.boostT > 0 ? 0.6 + Math.sin(now * 0.05) * 0.25 : 0;
    ud.flame.scale.setScalar(k.boostT > 0 ? 1.3 + Math.sin(now * 0.07) * 0.25 : 1);
    const c = m.cockpit;
    c.position.set(k.x, 0, k.z);
    c.rotation.set(0, -k.h, 0);
    c.rotation.x = g.rotation.x;
    for (const w of c.userData.wheels) {
      w.spin.rotation.z = -k.wheelSpin;
      w.holder.rotation.y = -k.steer * 0.45;
    }
    c.userData.wheel.rotation.z = -k.steer * 1.25; // 핸들: 오른쪽 조향이면 시계 방향
  }

  // ---------- 카메라와 화면 분할 ----------
  const cams = [0, 1, 2, 3].map(() => new THREE.PerspectiveCamera(65, 1, 0.05, 2600));
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  }
  window.addEventListener('resize', resize);
  resize();

  /**
   * views: [{ x, y, w, h (CSS px, 왼쪽 위 기준), pos:[..], look:[..], fov, roll, own: 카트 id | null }]
   * own 이 있으면 그 카트의 몸통은 숨기고 운전석을 보여 줍니다.
   */
  function render(views) {
    const H = window.innerHeight;
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, window.innerWidth, H);
    renderer.setScissor(0, 0, window.innerWidth, H);
    renderer.setClearColor('#05070c', 1);
    renderer.clear();
    views.forEach((v, i) => {
      const cam = cams[i];
      cam.aspect = Math.max(0.1, v.w / Math.max(1, v.h));
      cam.fov = v.fov || 65;
      cam.position.set(v.pos[0], v.pos[1], v.pos[2]);
      cam.up.set(0, 1, 0);
      cam.lookAt(v.look[0], v.look[1], v.look[2]);
      if (v.roll) cam.rotateZ(v.roll);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      for (const m of models.values()) {
        const mine = m.k.id === v.own;
        m.group.visible = !mine;
        m.cockpit.visible = mine;
      }
      const y = H - v.y - v.h;
      renderer.setViewport(v.x, y, v.w, v.h);
      renderer.setScissor(v.x, y, v.w, v.h);
      renderer.render(scene, cam);
    });
    renderer.setScissorTest(false);
  }

  function update(dt, now, karts) {
    trackMeshes.update(now / 1000);
    for (const k of karts) {
      const m = models.get(k.id);
      if (m) poseKart(m, k, now);
    }
    puffs.update(dt);
  }

  return { render, update, setRoster, puffs, renderer, scene, THREE };
}
