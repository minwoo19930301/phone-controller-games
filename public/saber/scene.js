// 광선검 장면: 훈련장 하나를 만들고, 화면 칸(뷰포트)마다 다른 카메라로 그립니다.
// 칸마다 같은 합성기(렌더 → 블룸 → 톤매핑)를 써서, 칼날·광탄·조명처럼 HDR 로 빛나는 것만 번지게 합니다.
// 합성기의 마지막 단계는 캔버스에 직접 그리므로, 그 전에 맞춰 둔 뷰포트·시저가 그 칸에만 그리게 합니다.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import {
  makeHall, makeEnvScene, makeHilt, makeBlade, makeTrail, makeDrone, makeBolt, makeSparks, makeFlashes,
  debrisGeometries, debrisMaterial, STATION_X
} from './models.js';

export { STATION_X };

export function createScene(cv) {
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false, powerPreference: 'high-performance' });
  const maxPr = Math.min(window.devicePixelRatio || 1, 1.5);
  let pr = maxPr;
  renderer.setPixelRatio(pr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#04060b');
  scene.fog = new THREE.FogExp2('#070a12', 0.021);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(makeEnvScene(), 0.035).texture;
  scene.environmentIntensity = 0.38;
  pmrem.dispose();

  // ---------- 조명 ----------
  scene.add(new THREE.HemisphereLight('#8fb0ff', '#140c1c', 0.45));
  const key = new THREE.DirectionalLight('#e8f0ff', 1.7);
  key.position.set(2, 20, 4);
  key.target.position.set(0, 0, -6);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 2048);
  key.shadow.camera.left = -27;
  key.shadow.camera.right = 27;
  key.shadow.camera.top = 15;
  key.shadow.camera.bottom = -13;
  key.shadow.camera.near = 4;
  key.shadow.camera.far = 40;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 3;
  scene.add(key, key.target);

  const hall = makeHall();
  scene.add(hall.group);

  // ---------- 효과 ----------
  const sparks = makeSparks(1400);
  scene.add(sparks.points);
  const flashes = makeFlashes(36);
  scene.add(flashes.group);
  const dGeos = debrisGeometries();
  const dMat = debrisMaterial();
  const debris = [];
  for (let i = 0; i < 48; i++) {
    const m = new THREE.Mesh(dGeos[i % dGeos.length], dMat);
    m.castShadow = true;
    m.visible = false;
    scene.add(m);
    debris.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(), t: 0, life: 2 });
  }
  let debrisHead = 0;
  function burstDebris(p, n, speed = 3) {
    for (let k = 0; k < n; k++) {
      const d = debris[debrisHead];
      debrisHead = (debrisHead + 1) % debris.length;
      d.m.visible = true;
      d.m.position.copy(p);
      d.m.scale.setScalar(0.7 + Math.random() * 0.8);
      d.v.set(Math.random() * 2 - 1, Math.random() * 1.2 + 0.2, Math.random() * 2 - 1).normalize().multiplyScalar(speed * (0.5 + Math.random()));
      d.w.set(Math.random() * 20 - 10, Math.random() * 20 - 10, Math.random() * 20 - 10);
      d.t = 0;
      d.life = 1.6 + Math.random() * 1.2;
    }
  }
  function updateDebris(dt) {
    for (const d of debris) {
      if (!d.m.visible) continue;
      d.t += dt;
      d.v.y -= 9.8 * dt;
      d.m.position.addScaledVector(d.v, dt);
      d.m.rotation.x += d.w.x * dt;
      d.m.rotation.y += d.w.y * dt;
      d.m.rotation.z += d.w.z * dt;
      if (d.m.position.y < 0.03) {
        d.m.position.y = 0.03;
        d.v.y *= -0.35;
        d.v.x *= 0.6;
        d.v.z *= 0.6;
        d.w.multiplyScalar(0.6);
      }
      const left = d.life - d.t;
      if (left < 0.5) d.m.scale.multiplyScalar(Math.max(0.5, 1 - dt * 6));
      if (left <= 0) d.m.visible = false;
    }
  }

  // ---------- 칼(칼자루 + 칼날 + 잔상) ----------
  const sabers = new Map();
  function setSabers(list) {
    const keep = new Set(list.map((x) => x.key));
    for (const [k, s] of sabers) {
      if (keep.has(k)) continue;
      scene.remove(s.hilt, s.blade.group, s.blade.refl, s.blade.reflCore, s.trail.mesh);
      s.hilt.userData.dispose();
      s.blade.dispose();
      s.trail.dispose();
      sabers.delete(k);
    }
    for (const x of list) {
      const cur = sabers.get(x.key);
      if (cur && cur.color === x.color) continue;
      if (cur) {
        scene.remove(cur.hilt, cur.blade.group, cur.blade.refl, cur.blade.reflCore, cur.trail.mesh);
        cur.hilt.userData.dispose();
        cur.blade.dispose();
        cur.trail.dispose();
      }
      const hilt = makeHilt(x.color);
      const blade = makeBlade(x.color);
      const trail = makeTrail(x.color);
      scene.add(hilt, blade.group, blade.refl, blade.reflCore, trail.mesh);
      sabers.set(x.key, { key: x.key, color: x.color, hilt, blade, trail });
    }
  }
  const _in = new THREE.Vector3();
  const _out = new THREE.Vector3();
  /**
   * s: { grip(Vector3), quat(Quaternion), dir(Vector3), emitter(Vector3), len, power(0~1), flick, trailK(0~1), visible }
   */
  function poseSaber(k, s) {
    const x = sabers.get(k);
    if (!x) return;
    x.hilt.visible = s.visible !== false;
    x.hilt.position.copy(s.grip);
    x.hilt.quaternion.copy(s.quat);
    x.hilt.userData.setPower(s.power);
    x.blade.setVisible(s.visible !== false);
    x.blade.set(s.emitter, s.dir, s.len, s.power, s.flick);
    _in.copy(s.emitter).addScaledVector(s.dir, s.len * 0.28);
    _out.copy(s.emitter).addScaledVector(s.dir, s.len);
    x.trail.push(_in, _out, s.visible === false ? 0 : s.trailK);
  }

  // ---------- 드론·광탄 풀 ----------
  const dronePool = [];
  function newDrone() {
    const d = dronePool.pop() || makeDrone();
    d.group.visible = true;
    d.aim.visible = false;
    d.setCharge(0);
    scene.add(d.group, d.aim);
    return d;
  }
  function freeDrone(d) {
    scene.remove(d.group, d.aim);
    dronePool.push(d);
  }
  const boltPool = [];
  function newBolt() {
    const b = boltPool.pop() || makeBolt();
    b.show(true);
    scene.add(b.group, b.refl);
    return b;
  }
  function freeBolt(b) {
    scene.remove(b.group, b.refl);
    boltPool.push(b);
  }

  // ---------- 합성기 ----------
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(pr);
  const renderPass = new RenderPass(scene, new THREE.PerspectiveCamera());
  // 광택 금속에 칼날 빛이 아주 가까이 비치면 반사 하이라이트가 half-float 범위를 넘어(Inf) 블룸 전체를 검게 만듭니다.
  // 블룸 전에 NaN 은 0, 너무 큰 값은 상한으로 자릅니다.
  const sanitize = new ShaderPass({
    name: 'SanitizeShader',
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
      float fix(float v) { return isnan(v) ? 0.0 : clamp(v, 0.0, 40.0); }
      void main() { vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = vec4(fix(c.r), fix(c.g), fix(c.b), 1.0); }`
  });
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.4, 1.35);
  const output = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(sanitize);
  composer.addPass(bloom);
  composer.addPass(output);
  let cw = 0;
  let ch = 0;

  const cams = [0, 1, 2, 3, 4].map(() => new THREE.PerspectiveCamera(70, 1, 0.03, 120));
  const rects = [];
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  }
  window.addEventListener('resize', resize);
  resize();

  // 느린 화면이면 해상도를 조금씩 낮춥니다(빠르면 다시 올림).
  // 60Hz 화면은 한 프레임이 약 16.7ms 라, 평균이 18.5ms 아래면 제때 그리는 것으로 봅니다.
  // 프레임마다 생기는 작은 흔들림은 평균으로 걸러 내고, 실제로 한 프레임을 놓친 경우(31ms 넘음)만 조금 깎습니다.
  let slowFrames = 0;
  let fastFrames = 0;
  let avgDt = 1 / 60;
  let fastNeed = 400; // 올리기까지 제때 그린 프레임 수
  let upAt = -1e9;
  function adapt(dt) {
    if (dt > 0.031) slowFrames += 1;
    else slowFrames = Math.max(0, slowFrames - 1);
    avgDt += (dt - avgDt) * 0.05;
    if (avgDt < 0.0185) fastFrames += 1;
    else if (dt > 0.031) fastFrames = Math.max(0, fastFrames - 20);
    let next = pr;
    if (slowFrames > 90 && pr > 0.75) {
      next = Math.max(0.75, pr * 0.82);
      // 올린 지 얼마 안 돼 다시 느려지면, 다음엔 더 오래 지켜본 뒤 올립니다(오르내림 반복 방지).
      if (performance.now() - upAt < 20000) fastNeed = Math.min(fastNeed * 2, 7200);
    } else if (fastFrames > fastNeed && pr < maxPr) {
      next = Math.min(maxPr, pr * 1.15);
      upAt = performance.now();
    }
    if (next !== pr) {
      pr = next;
      slowFrames = 0;
      fastFrames = 0;
      renderer.setPixelRatio(pr);
      composer.setPixelRatio(pr);
      cw = 0;
      resize();
    }
  }

  const _look = new THREE.Vector3();
  /**
   * views: [{ x, y, w, h (CSS px, 왼쪽 위 기준), pos:[..], look:[..], fov, roll }]
   */
  function render(views, dt) {
    adapt(dt);
    const H = window.innerHeight;
    renderer.shadowMap.needsUpdate = true;
    rects.length = 0;
    views.forEach((v, i) => {
      const cam = cams[i];
      cam.aspect = Math.max(0.1, v.w / Math.max(1, v.h));
      cam.fov = v.fov || 70;
      cam.position.set(v.pos[0], v.pos[1], v.pos[2]);
      cam.up.set(Math.sin(v.roll || 0), Math.cos(v.roll || 0), 0);
      _look.set(v.look[0], v.look[1], v.look[2]);
      cam.lookAt(_look);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      if (Math.abs(v.w - cw) > 1 || Math.abs(v.h - ch) > 1) {
        cw = v.w;
        ch = v.h;
        composer.setSize(cw, ch);
      }
      sparks.setScale((v.h * pr) / (2 * Math.tan((cam.fov * Math.PI) / 360)));
      const y = H - v.y - v.h;
      renderer.setViewport(v.x, y, v.w, v.h);
      renderer.setScissor(v.x, y, v.w, v.h);
      renderer.setScissorTest(true);
      renderPass.camera = cam;
      composer.render(dt);
      rects[i] = v;
    });
    renderer.setScissorTest(false);
  }

  const _p = new THREE.Vector3();
  /** 뷰포트 i 에서 세계 좌표 p 가 보이는 곳(칸 안 CSS px). behind: 카메라 뒤, inside: 칸 안 */
  function project(i, p) {
    const cam = cams[i];
    const v = rects[i];
    if (!v) return null;
    _p.copy(p).applyMatrix4(cam.matrixWorldInverse);
    const behind = _p.z > -0.01;
    _p.copy(p).project(cam);
    let nx = _p.x;
    let ny = _p.y;
    if (behind) {
      nx = -nx;
      ny = -ny;
    }
    const x = (nx * 0.5 + 0.5) * v.w;
    const y = (-ny * 0.5 + 0.5) * v.h;
    return { x, y, nx, ny, behind, inside: !behind && Math.abs(nx) <= 1 && Math.abs(ny) <= 1 };
  }

  let hallT = 0;
  function update(dt, now) {
    hallT = now / 1000;
    hall.update(hallT);
    sparks.update(dt);
    flashes.update(dt);
    updateDebris(dt);
  }

  return {
    renderer, scene, hall, render, project, update, cams, composer, bloom,
    setStations: (l) => hall.setStations(l),
    setSabers, poseSaber, newDrone, freeDrone, newBolt, freeBolt,
    sparks, flash: (p, color, size, life, kind, k) => flashes.fire(p, color, size, life, kind, k), burstDebris,
    quality: () => pr
  };
}
