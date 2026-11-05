// 테니스 장면: 늦은 오후 하늘(Sky), 해 그림자, 경기장 조명, 코트·네트·관중석, 선수들, 공(그림자·꼬리·타구 섬광·바운드 자국).
// 중계 카메라 하나로 한 화면에 그립니다.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { COURT } from './physics.js';
import { makeCourt, makeNet, makeStadium, makeAthlete, makeBall, makeBlob, makeTrail, layoutTrail, glowTex, BALL_VIS } from './models.js';

const RD = Math.PI / 180;

export function createScene(cv) {
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.64;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#c9b9a4', 90, 420);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 3000);

  // ---------- 하늘과 해(늦은 오후, 왼쪽 뒤에서 비스듬히) ----------
  const sun = new THREE.Vector3().setFromSphericalCoords(1, (90 - 27) * RD, 215 * RD);
  const sky = new Sky();
  sky.scale.setScalar(2500);
  const su = sky.material.uniforms;
  su.turbidity.value = 6.5;
  su.rayleigh.value = 1.6;
  su.mieCoefficient.value = 0.005;
  su.mieDirectionalG.value = 0.84;
  su.sunPosition.value.copy(sun);
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const sky2 = new Sky();
  sky2.scale.setScalar(2500);
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) sky2.material.uniforms[k].value = su[k].value;
  sky2.material.uniforms.sunPosition.value.copy(sun);
  envScene.add(sky2);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.7;

  const hemi = new THREE.HemisphereLight('#cfe0ff', '#4a5a48', 0.75);
  scene.add(hemi);
  const sunLight = new THREE.DirectionalLight('#ffe7c4', 3.0);
  sunLight.position.copy(sun).multiplyScalar(60);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(4096, 4096);
  sunLight.shadow.bias = -0.0002;
  sunLight.shadow.normalBias = 0.02;
  const sc = sunLight.shadow.camera;
  sc.left = -24;
  sc.right = 24;
  sc.top = 24;
  sc.bottom = -24;
  sc.near = 10;
  sc.far = 140;
  sc.updateProjectionMatrix();
  scene.add(sunLight, sunLight.target);
  // 경기장 조명(그림자 없이 코트를 고르게 밝힘)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const l = new THREE.SpotLight('#fff1dc', 520, 0, 0.42, 0.8, 2);
      l.position.set(sx * 19, 34, sz * 29);
      l.target.position.set(sx * 2, 0, sz * 4);
      scene.add(l, l.target);
    }
  }

  // ---------- 코트·네트·경기장 ----------
  scene.add(makeCourt());
  scene.add(makeNet());
  const stadium = makeStadium();
  scene.add(stadium.group);
  stadium.group.traverse((m) => {
    if (m.isMesh && !m.material.transparent) m.receiveShadow = true;
  });

  // ---------- 선수 ----------
  const athletes = new Map();
  function setAthletes(list) {
    const keep = new Set(list.map((p) => p.key));
    for (const [k, a] of athletes) {
      if (!keep.has(k)) {
        scene.remove(a.model.group);
        a.model.dispose();
        athletes.delete(k);
      }
    }
    for (const p of list) {
      const cur = athletes.get(p.key);
      if (cur && cur.color === p.color && cur.cpu === p.cpu) continue;
      if (cur) {
        scene.remove(cur.model.group);
        cur.model.dispose();
      }
      const model = makeAthlete(p);
      model.group.visible = false;
      scene.add(model.group);
      athletes.set(p.key, { model, color: p.color, cpu: p.cpu });
    }
  }
  function poseAthlete(key, x, z, yaw, pose, visible = true) {
    const a = athletes.get(key);
    if (!a) return;
    a.model.group.visible = visible;
    a.model.group.position.set(x, 0, z);
    a.model.group.rotation.y = yaw;
    if (pose) a.model.pose(pose);
  }

  // ---------- 공 ----------
  const ball = makeBall();
  ball.visible = false;
  const blob = makeBlob();
  blob.visible = false;
  const trail = makeTrail(16);
  trail.visible = false;
  const flashS = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff8d8', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  flashS.visible = false;
  let flashT = 0;
  scene.add(ball, blob, trail, flashS);
  const _q = new THREE.Quaternion();
  const _ax = new THREE.Vector3();
  function setBall(b) {
    if (!b) {
      ball.visible = false;
      blob.visible = false;
      trail.visible = false;
      trail.userData.pts = [];
      return;
    }
    const [x, y, z] = b.pos;
    ball.visible = true;
    ball.position.set(x, Math.max(BALL_VIS, y), z);
    if (b.spinAngle) {
      _ax.set(b.spinAxis[0], b.spinAxis[1], b.spinAxis[2]);
      if (_ax.lengthSq() > 1e-9) {
        _ax.normalize();
        _q.setFromAxisAngle(_ax, b.spinAngle);
        ball.quaternion.premultiply(_q);
      }
    }
    const h = Math.max(0, y - BALL_VIS);
    blob.visible = true;
    blob.position.set(x, 0.004, z);
    const s = BALL_VIS * 3 + h * 0.08;
    blob.scale.set(s, 1, s);
    blob.material.opacity = Math.max(0.15, 0.8 - h * 0.25);
    trail.userData.pts = b.trail || [];
  }
  function flash(pos, strong) {
    flashS.position.set(pos[0], pos[1], pos[2]);
    flashS.visible = true;
    flashT = strong ? 1.3 : 0.85;
  }

  // ---------- 바운드 자국(호크아이처럼 잠깐 남는 타원) ----------
  const marks = [];
  const markGeo = new THREE.RingGeometry(0.06, 0.1, 32).rotateX(-Math.PI / 2);
  const markFill = new THREE.CircleGeometry(0.06, 32).rotateX(-Math.PI / 2);
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8 }));
    const fill = new THREE.Mesh(markFill, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, opacity: 0.3, polygonOffset: true, polygonOffsetFactor: -8 }));
    g.add(ring, fill);
    g.visible = false;
    g.renderOrder = 4;
    g.scale.set(1.2, 1, 1.9);
    scene.add(g);
    marks.push({ g, ring, fill, t: 0, hold: 0 });
  }
  let markI = 0;
  function mark(x, z, color) {
    const mk = marks[markI++ % marks.length];
    mk.g.position.set(x, 0.006, z);
    mk.g.visible = true;
    mk.t = 1;
    mk.hold = color ? 1.8 : 0.5;
    const c = color || '#e9f7ff';
    mk.ring.material.color.set(c);
    mk.fill.material.color.set(c);
  }

  // ---------- 카메라·크기 ----------
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  function setCamera(v) {
    camera.position.set(v.pos[0], v.pos[1], v.pos[2]);
    camera.lookAt(v.look[0], v.look[1], v.look[2]);
    if (Math.abs(camera.fov - v.fov) > 0.01) {
      camera.fov = v.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }

  function render() {
    if (ball.visible) layoutTrail(trail, camera.position);
    else trail.visible = false;
    renderer.render(scene, camera);
  }

  const _p = new THREE.Vector3();
  const _r = new THREE.Vector3();
  /** 세계 좌표 p 가 화면(CSS px)에서 어디인지, 공 반지름(px) */
  function project(p) {
    _p.set(p[0], p[1], p[2]).project(camera);
    const behind = _p.z > 1;
    _r.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(BALL_VIS).add(new THREE.Vector3(p[0], p[1], p[2])).project(camera);
    const W = window.innerWidth;
    const H = window.innerHeight;
    const x = (_p.x * 0.5 + 0.5) * W;
    const y = (-_p.y * 0.5 + 0.5) * H;
    const rx = (_r.x * 0.5 + 0.5) * W;
    const ry = (-_r.y * 0.5 + 0.5) * H;
    return { x, y, r: Math.hypot(rx - x, ry - y), behind };
  }

  function update(dt, now) {
    stadium.update(now / 1000);
    if (flashS.visible) {
      flashT -= dt * 4.2;
      if (flashT <= 0) flashS.visible = false;
      else {
        flashS.material.opacity = Math.min(1, flashT);
        const s = 0.25 + (1.3 - flashT) * 0.9;
        flashS.scale.set(s, s, 1);
      }
    }
    for (const mk of marks) {
      if (!mk.g.visible) continue;
      if (mk.hold > 0) mk.hold -= dt;
      else mk.t -= dt * 1.4;
      if (mk.t <= 0) mk.g.visible = false;
      else {
        mk.ring.material.opacity = Math.min(1, mk.t) * 0.95;
        mk.fill.material.opacity = Math.min(1, mk.t) * 0.3;
      }
    }
  }

  return {
    renderer, scene, camera, setAthletes, poseAthlete, setBall, flash, mark, setCamera, render, project, update,
    setBoard: stadium.setBoard, COURT
  };
}
