// 양궁 장면: 사격장(잔디·과녁·관중석·깃발·풍향계·나무·언덕·하늘), 1인칭 활 시점, 조준경(확대 렌즈), 비행 카메라, 과녁 클로즈업.
import * as THREE from 'three';
import {
  makeMats, makeBow, makeArrow, makeFaceTexture, makeTarget, makeStuckArrow, makeWindsock, makeFlag, makeStands, makeTrees,
  makeGrassTexture, makeSky, ARROW_LEN
} from './models.js';
import { FACE_R } from './scoring.mjs';
import { pathAt, SIGHT_GAIN } from './ballistics.mjs';

const V3 = THREE.Vector3;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
export const EYE = new V3(0, 1.55, 0);
export const TARGET_Y = 1.3;
const SUN_DIR = new V3(-0.45, 0.62, 0.55).normalize(); // 해: 왼쪽 뒤 위(사수 등 뒤 → 과녁 면이 환하게)
const BOW_AT = new V3(-0.088 * 0.88, -0.088 * 0.88, -1.0); // 카메라 좌표계에서 활 원점(그립). 링이 정면 중앙에 오게

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;

  const mats = makeMats();
  const scene = new THREE.Scene();
  const viewScene = new THREE.Scene();
  scene.fog = new THREE.Fog('#c9dcec', 160, 760);
  scene.background = new THREE.Color('#9fc3e6');

  // 하늘 + 환경맵
  const sky = makeSky(SUN_DIR);
  scene.add(sky);
  const envScene = new THREE.Scene();
  envScene.add(makeSky(SUN_DIR));
  const envGround = new THREE.Mesh(new THREE.CircleGeometry(800, 24), new THREE.MeshBasicMaterial({ color: '#9aa588' }));
  envGround.rotation.x = -Math.PI / 2;
  envGround.position.y = -2;
  envScene.add(envGround);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(envScene, 0.02).texture;
  scene.environment = envTex;
  viewScene.environment = envTex;

  // 빛
  const sun = new THREE.DirectionalLight('#fff1d6', 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight('#bcd8ff', '#4a6a3a', 0.55);
  scene.add(hemi);
  const vKey = new THREE.DirectionalLight('#fff1d6', 2.4);
  vKey.position.copy(SUN_DIR).multiplyScalar(5);
  const vHemi = new THREE.HemisphereLight('#bcd8ff', '#6a5a4a', 0.7);
  viewScene.add(vKey, vHemi);

  // 카메라
  const cam = new THREE.PerspectiveCamera(52, 16 / 9, 0.05, 2500);
  const viewCam = new THREE.PerspectiveCamera(52, 16 / 9, 0.02, 20);
  const lensCam = new THREE.PerspectiveCamera(3, 1, 0.5, 2500);
  const insetCam = new THREE.PerspectiveCamera(34, 1, 0.05, 80);
  const lensRT = new THREE.WebGLRenderTarget(1024, 1024, { samples: 4, colorSpace: THREE.SRGBColorSpace });
  lensRT.texture.generateMipmaps = false;
  lensRT.texture.minFilter = THREE.LinearFilter;

  // 활(뷰모델)
  const bow = makeBow(mats);
  const rig = new THREE.Group(); // 눈을 중심으로 조준에 따라 살짝 돌아감
  viewScene.add(rig);
  const bowHolder = new THREE.Group();
  bowHolder.position.copy(BOW_AT);
  bow.root.scale.setScalar(0.88);
  bowHolder.add(bow.root);
  rig.add(bowHolder);

  // 조준경 렌즈: 링 안에 비치는 확대 화면
  const lensMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    uniforms: { tMap: { value: lensRT.texture }, uGlow: { value: 0 }, uTone: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      varying vec2 vUv; uniform sampler2D tMap; uniform float uGlow;
      void main(){
        vec2 p = vUv - 0.5; float r = length(p) * 2.0;
        vec3 c = texture2D(tMap, vUv).rgb;
        float vig = smoothstep(1.0, 0.72, r);
        c *= mix(0.55, 1.0, vig);
        // 유리의 은은한 푸른 기
        c = mix(c, c * vec3(0.96, 1.0, 1.04), 0.6);
        // 가운데 십자선(가늘게): 핀이 있으니 아주 연하게
        float cross = 1.0 - smoothstep(0.0, 0.0035, min(abs(p.x), abs(p.y)));
        c = mix(c, vec3(0.1, 1.0, 0.45), cross * 0.35 * step(r, 0.92) * step(0.07, r));
        // 조준핀: 검은 테두리 + 초록 점
        c = mix(c, vec3(0.0), (1.0 - smoothstep(0.03, 0.036, r)) * 0.9);
        c = mix(c, vec3(0.45, 1.0, 0.55), 1.0 - smoothstep(0.02, 0.025, r));
        gl_FragColor = vec4(c, smoothstep(1.0, 0.985, r));
      }`
  });
  const lensDisc = new THREE.Mesh(new THREE.CircleGeometry(0.0165, 64), lensMat);
  lensDisc.position.z = -0.0006;
  bow.ringHolder.add(lensDisc);
  lensDisc.visible = false;

  // ---------- 세계 ----------
  const world = new THREE.Group();
  scene.add(world);
  const grassTex = makeGrassTexture();
  const faceTex = makeFaceTexture(2048);
  const flags = [];
  const socks = [];
  let mainTarget = null;
  let D = 50;
  const stuckList = [];
  let marker = null;
  const flightArrow = makeArrow(mats, '#ff5a5f');
  flightArrow.scale.set(2.6, 2.6, 1); // 날아가는 모습이 보이도록 굵게
  flightArrow.visible = false;
  scene.add(flightArrow);

  function disposeGroup(g) {
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
  }
  function buildWorld(distance) {
    while (world.children.length) { const c = world.children[0]; world.remove(c); disposeGroup(c); }
    flags.length = 0; socks.length = 0; stuckList.length = 0;
    D = distance;
    // 땅
    grassTex.repeat.set(60, 120);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, -D * 0.4);
    ground.receiveShadow = true;
    world.add(ground);
    // 사로(레인) 흙길 + 선들
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(1.6, D + 30), new THREE.MeshStandardMaterial({ color: '#7aa860', roughness: 1 }));
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(0, 0.004, -D / 2 + 5);
    lane.receiveShadow = true;
    world.add(lane);
    const lineMat = new THREE.MeshStandardMaterial({ color: '#f4f4ee', roughness: 0.9 });
    const shootLine = new THREE.Mesh(new THREE.PlaneGeometry(26, 0.1), lineMat);
    shootLine.rotation.x = -Math.PI / 2;
    shootLine.position.set(0, 0.008, 0.2);
    world.add(shootLine);
    for (const dd of [10, 20, 30, 40, 50, 60, 70, 90].filter((v) => v < D + 1)) {
      const w = dd === D ? 26 : 10;
      const l = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.07), lineMat);
      l.rotation.x = -Math.PI / 2;
      l.position.set(0, 0.008, -dd);
      world.add(l);
    }
    // 과녁: 가운데 + 옆 레인들
    const label = `${D}m`;
    mainTarget = makeTarget(mats, faceTex, label);
    mainTarget.group.position.set(0, 0, -D);
    world.add(mainTarget.group);
    for (const x of [-2.7, 2.7, -5.4, 5.4, -8.1, 8.1]) {
      const t = makeTarget(mats, faceTex, label);
      t.group.position.set(x, 0, -D);
      world.add(t.group);
    }
    // 옆 레인 사선 표시(사수 자리 표지)
    for (const x of [-2.7, 2.7, -5.4, 5.4]) {
      const mk = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshStandardMaterial({ color: '#e8e8e0', roughness: 1 }));
      mk.rotation.x = -Math.PI / 2;
      mk.position.set(x, 0.006, 1.5);
      world.add(mk);
    }
    // 관중석(양옆, 과녁 쪽)
    for (const s of [-1, 1]) {
      const st = makeStands(6, 22, 5 + s);
      st.position.set(s * 19, 0, -D * 0.55);
      st.rotation.y = -s * Math.PI / 2;
      world.add(st);
    }
    // 과녁 뒤 방호 울타리(짙은 초록 그물 + 덤불)
    const hedge = new THREE.Mesh(new THREE.BoxGeometry(70, 7, 1.2), new THREE.MeshStandardMaterial({ color: '#2d5a33', roughness: 1 }));
    hedge.position.set(0, 3.5, -D - 14);
    hedge.castShadow = true; hedge.receiveShadow = true;
    world.add(hedge);
    const hedgeTop = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 70, 12), new THREE.MeshStandardMaterial({ color: '#35683b', roughness: 1 }));
    hedgeTop.rotation.z = Math.PI / 2;
    hedgeTop.position.set(0, 7, -D - 14);
    world.add(hedgeTop);
    const back = makeStands(5, 30, 11);
    back.position.set(0, 0, -D - 42);
    world.add(back);
    // 깃발: 레인 옆으로 줄지어
    const palette = [['#d83a2f', '#f5f5f5'], ['#2f6fcb', '#f5f5f5'], ['#f2b632', '#222'], ['#3a9d63', '#f5f5f5']];
    let k = 0;
    for (let z = 4; z > -D - 8; z -= 12) {
      for (const sx of [-1, 1]) {
        const [a, b] = palette[k++ % palette.length];
        const f = makeFlag(a, b, 5);
        f.group.position.set(sx * 11.5, 0, z);
        world.add(f.group);
        flags.push(f);
      }
    }
    // 풍향계: 사선 가까이(오른쪽 앞), 과녁 쪽 두 곳
    const spots = [[4.6, -4], [-5.2, -D * 0.5], [6.4, -D + 3]];
    for (const [x, z] of spots) {
      const s = makeWindsock(mats);
      s.group.position.set(x, 0, z);
      world.add(s.group);
      socks.push(s);
    }
    // 나무(멀리 숲)
    world.add(makeTrees(90, (r) => {
      const side = r() < 0.5 ? -1 : 1;
      return r() < 0.5 ? [side * (34 + r() * 70), 20 - r() * (D + 130)] : [(r() - 0.5) * 260, -D - 40 - r() * 100];
    }, 13));
    // 가까운 나무 몇 그루(구도용)
    world.add(makeTrees(10, (r) => [(r() < 0.5 ? -1 : 1) * (26 + r() * 10), -D * (0.1 + r() * 0.9)], 5));
    // 언덕 두 겹
    world.add(makeHills(D));
    // 그림자 범위
    sun.position.set(SUN_DIR.x * 70, SUN_DIR.y * 70, -D / 2 + SUN_DIR.z * 70);
    sun.target.position.set(0, 0, -D / 2);
    const half = Math.max(D / 2 + 14, 30);
    sun.shadow.camera.left = -34; sun.shadow.camera.right = 34;
    sun.shadow.camera.top = half; sun.shadow.camera.bottom = -half;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 220;
    sun.shadow.camera.updateProjectionMatrix();
    // 예상 낙점 표시(쉬움)
    marker = new THREE.Group();
    const mr = new THREE.Mesh(new THREE.RingGeometry(0.045, 0.06, 40), new THREE.MeshBasicMaterial({ color: '#ffe14a', transparent: true, opacity: 0.95, depthTest: false }));
    const md = new THREE.Mesh(new THREE.CircleGeometry(0.012, 16), new THREE.MeshBasicMaterial({ color: '#ffe14a', depthTest: false }));
    marker.add(mr, md);
    marker.renderOrder = 20;
    marker.visible = false;
    marker.position.set(0, TARGET_Y, 0.02);
    mainTarget.group.add(marker);
    // 렌즈 시야: 과녁 면 지름이 렌즈의 약 60%가 되도록
    const fovRad = (2 * FACE_R / D) / 0.62;
    lensCam.fov = THREE.MathUtils.radToDeg(fovRad);
    lensCam.updateProjectionMatrix();
    // 닿는 거리: 하늘이 멀리서 잘리지 않게
    sky.position.set(0, 0, -D / 2);
  }
  function makeHills(distance) {
    const g = new THREE.Group();
    const layers = [{ z: -distance - 150, h: 34, col: '#4d7d52', w: 900, seed: 1 }, { z: -distance - 280, h: 60, col: '#7396a8', w: 1300, seed: 2 }];
    for (const L of layers) {
      const N = 90;
      const sh = new THREE.Shape();
      sh.moveTo(-L.w / 2, -2);
      for (let i = 0; i <= N; i++) {
        const x = -L.w / 2 + (i / N) * L.w;
        const y = 8 + L.h * (0.5 + 0.3 * Math.sin(x * 0.011 + L.seed) + 0.2 * Math.sin(x * 0.027 + L.seed * 3) + 0.1 * Math.sin(x * 0.07 + L.seed));
        sh.lineTo(x, y);
      }
      sh.lineTo(L.w / 2, -2);
      sh.closePath();
      const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshStandardMaterial({ color: L.col, roughness: 1, fog: true }));
      m.position.set(0, 0, L.z);
      g.add(m);
    }
    return g;
  }

  // ---------- 카메라 상태 ----------
  const state = {
    mode: 'fp', // fp(1인칭) | flight | idle(전경)
    pull: 0, // 0..1 당김(표시용)
    aimDeg: { x: 0, y: 0 }, // 흔들림 포함 조준(폰 도)
    gain: SIGHT_GAIN, // 폰 1° 가 움직이는 비율(난이도마다 다름, game.js 가 정함)
    lens: 0, // 0..1 조준경 열림 정도
    wind: { speed: 0, dir: 0 },
    t: 0,
    arrowColor: '#ff5a5f',
    wobble: 0, // 놓은 뒤 시위 떨림
    insetOn: false,
    insetRect: null, // { x, y, w, h } CSS px
    flight: null,
    handVisible: true,
    arrowOnBow: true,
    idleT: 0
  };
  const baseCamPos = EYE.clone();
  const tmpA = new V3();
  const tmpB = new V3();
  const tmpC = new V3();

  function worldAt(f, fl) {
    const p = pathAt(f, fl.pathArgs);
    const E = fl.start;
    return tmpA.set(lerp(E.x, 0, f) + p.x, lerp(E.y, TARGET_Y, f) + p.y, lerp(E.z, -D, f));
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    viewCam.aspect = w / h;
    cam.updateProjectionMatrix();
    viewCam.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // 바람
  function setWind(w) { state.wind = w || { speed: 0, dir: 0 }; }

  function setArrowColor(c) {
    state.arrowColor = c;
    bow.setArrowColor(c);
    flightArrow.traverse((o) => {
      if (o.material && o.material.color && o.material.color.getHex() !== 0xf4f4f0 && o.material !== mats.shaft && o.material !== mats.steel) o.material.color.set(c);
    });
  }

  // 한 프레임 갱신. 호출 쪽이 state 를 채워 줌
  function update(dt) {
    state.t += dt;
    const t = state.t;
    // 바람 → 깃발·풍향계
    for (const f of flags) f.update(state.wind, t);
    for (const s of socks) s.update(state.wind, t);

    const pull = clamp(state.pull, 0, 1);
    const open = ease(clamp(state.lens, 0, 1));
    if (state.mode === 'bowdbg') {
      // 시험용: 활 모델만 따로 돌려 봄(__archery.view.state.dbg = { pos:[x,y,z], look:[x,y,z], fov })
      const d = state.dbg || { pos: [1.4, 0.1, 0.9], look: [0, 0, 0.1], fov: 40 };
      viewScene.background = new THREE.Color('#5d7388');
      bowHolder.position.set(0, 0, 0);
      rig.rotation.set(0, 0, 0);
      bow.layout(pull, { showHand: true });
      bow.setArrowVisible(true);
      bow.ringHolder.scale.setScalar(1);
      lensDisc.visible = false;
      viewCam.fov = d.fov; viewCam.updateProjectionMatrix();
      viewCam.position.set(...d.pos);
      viewCam.lookAt(...d.look);
      return;
    }
    viewScene.background = null;
    bowHolder.position.copy(BOW_AT);
    if (state.mode === 'fp') {
      // 눈 위치: 미세한 숨쉬기
      cam.position.set(EYE.x + Math.sin(t * 0.9) * 0.0015, EYE.y + Math.sin(t * 1.3) * 0.002, EYE.z);
      const pitch0 = Math.atan2(TARGET_Y - EYE.y, D);
      cam.rotation.set(pitch0, 0, 0, 'YXZ');
      cam.fov = lerp(54, 40, ease(pull));
      cam.updateProjectionMatrix();
      viewCam.fov = cam.fov;
      viewCam.updateProjectionMatrix();
      // 활: 당길수록 시위·화살이 눈 쪽으로, 시선은 조준 각도만큼 돌아감
      const psi = (state.gain || SIGHT_GAIN) * Math.PI / 180;
      rig.rotation.set(state.aimDeg.y * psi * 0.4 + pitch0 * 0.0, -state.aimDeg.x * psi * 0.4, 0, 'YXZ');
      // 뷰모델을 카메라 좌표계에 그대로 두되(원점=눈) pitch0 만큼은 카메라에 맞춰 돌려 둠
      rig.rotation.x += 0;
      bow.layout(pull, { showHand: state.handVisible, wobble: state.wobble ? Math.sin(t * 90) * 0.01 * state.wobble : 0 });
      bow.setArrowVisible(state.arrowOnBow);
      // 조준경
      const sc = lerp(1, 10.5, open);
      bow.ringHolder.scale.setScalar(sc);
      lensDisc.visible = open > 0.02;
      const onTop = open > 0.2; // 열렸을 때는 조준경이 활 앞에 겹쳐 보이게
      for (const m of Object.values(bow.sightMats)) m.depthTest = !onTop;
      lensMat.depthTest = !onTop;
      bow.ringHolder.traverse((o) => { o.renderOrder = onTop ? 10 : 0; });
      // 렌즈 카메라: 시선 방향 + 조준 각도
      lensCam.position.copy(cam.position);
      lensCam.rotation.set(pitch0 + state.aimDeg.y * psi, -state.aimDeg.x * psi, 0, 'YXZ');
      // 렌즈 카메라가 활 쪽을 안 보게(월드만 렌더) → viewScene 은 따로
    } else if (state.mode === 'flight' && state.flight) {
      const fl = state.flight;
      const f = fl.f;
      const pos = worldAt(f, fl).clone();
      const pos2 = worldAt(Math.min(1, f + 0.01), fl).clone();
      const dir = pos2.clone().sub(pos);
      if (dir.lengthSq() < 1e-8) dir.set(0, 0, -1);
      dir.normalize();
      // 화살을 뒤에서 따라가다가, 마지막 몇 미터 전에서 멈추고 지켜봄
      const hold = Math.min(0.97, 1 - 5 / D);
      const fc = Math.min(f, hold);
      const pc = worldAt(fc, fl).clone();
      const pc2 = worldAt(Math.min(1, fc + 0.01), fl).clone();
      const dc = pc2.sub(pc).normalize();
      const side = new V3().crossVectors(dc, new V3(0, 1, 0)).normalize();
      const k = ease(clamp((fl.camBlend ?? 0), 0, 1));
      // 따라가기 위치(화살 뒤 위 옆) → 끝에서는 과녁 오른쪽 앞 비스듬한 자리로 이동
      const follow = pc.clone().addScaledVector(dc, -1.3).addScaledVector(side, 1.35).add(new V3(0, 0.45, 0));
      const finalPos = new V3(1.3, TARGET_Y + 0.25, -D + 2.4);
      cam.position.copy(follow).lerp(finalPos, fl.settle || 0);
      const look = pos.clone().addScaledVector(dir, 0.5);
      cam.lookAt(look);
      cam.fov = lerp(48, 34, k);
      cam.updateProjectionMatrix();
      // 날아가는 화살
      flightArrow.visible = f < 1.0 || fl.settle < 1;
      flightArrow.position.copy(pos);
      const m = new THREE.Matrix4().lookAt(new V3(0, 0, 0), dir, new V3(0, 1, 0));
      flightArrow.quaternion.setFromRotationMatrix(m);
      // 화살대 휨: 발사 직후 크게, 곧 잦아듦
      const age = fl.age || 0;
      flightArrow.userData.flex(t, 0.012 * Math.exp(-age * 3.2) + 0.0012, 38, 0);
      // 노크 쪽이 앞에 있으니 원점을 앞으로: 화살 머리가 pos 에 오도록 -Z 로 ARROW_LEN 만큼 이동
      flightArrow.position.copy(pos).addScaledVector(dir, ARROW_LEN * 0.55);
    } else if (state.mode === 'idle') {
      // 결과 화면 등: 과녁 쪽을 느리게 도는 전경
      state.idleT += dt;
      const a = state.idleT * 0.12;
      cam.position.set(Math.sin(a) * 5.5 + 1.2, 1.5, 3 + Math.cos(a) * 1.5);
      cam.lookAt(0, 1.4, -Math.min(D, 30));
      cam.fov = 52;
      cam.updateProjectionMatrix();
    }
    // 뷰모델용 카메라는 원점에서 앞을 봄(회전은 rig 에서)
    viewCam.position.set(0, 0, 0);
    viewCam.rotation.set(0, 0, 0);
  }

  // 활을 카메라 좌표(원점 = 눈) 기준으로 놓되, 월드 카메라가 pitch0 만큼 아래를 보므로 뷰카메라도 같이 숙임
  function render() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = renderer.getPixelRatio();
    renderer.shadowMap.autoUpdate = true;
    // 1) 조준경 렌더: 월드 → 렌즈 텍스처
    if (state.mode === 'fp' && lensDisc.visible) {
      renderer.setRenderTarget(lensRT);
      renderer.clear();
      renderer.render(scene, lensCam);
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(null);
    }
    // 2) 메인
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.clear();
    if (state.mode === 'bowdbg') {
      renderer.render(viewScene, viewCam);
      return;
    }
    renderer.render(scene, cam);
    renderer.shadowMap.autoUpdate = false;
    if (state.mode === 'fp') {
      renderer.clearDepth();
      renderer.render(viewScene, viewCam);
    }
    // 3) 클로즈업 인셋
    if (state.insetOn && state.insetRect && mainTarget) {
      const r = state.insetRect;
      const x = Math.round(r.x * pr), y = Math.round((h - r.y - r.h) * pr), ww = Math.round(r.w * pr), hh = Math.round(r.h * pr);
      renderer.setScissorTest(true);
      renderer.setViewport(x, y, ww, hh);
      renderer.setScissor(x, y, ww, hh);
      renderer.clear();
      const tp = mainTarget.group.position;
      insetCam.aspect = r.w / r.h;
      insetCam.position.set(tp.x + 0.62, tp.y + TARGET_Y + 0.34, tp.z + 1.55);
      insetCam.lookAt(tp.x + 0.0, tp.y + TARGET_Y - 0.02, tp.z - 0.1);
      insetCam.updateProjectionMatrix();
      const wasFlight = flightArrow.visible;
      renderer.render(scene, insetCam);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, w, h);
    }
    renderer.shadowMap.autoUpdate = true;
  }

  // 꽂기
  function addStuck(color, x, y, dir) {
    const a = makeStuckArrow(mats, color, x, y, dir);
    mainTarget.stuck.add(a);
    const rec = { obj: a, t0: state.t, x, y };
    stuckList.push(rec);
    return rec;
  }
  const groundList = [];
  function addGroundArrow(color, pos, dir) {
    const a = makeArrow(mats, color);
    const m = new THREE.Matrix4().lookAt(new V3(0, 0, 0), dir.clone().normalize(), new V3(0, 1, 0));
    a.quaternion.setFromRotationMatrix(m);
    const tipLocal = new V3(0, 0, -(ARROW_LEN - 0.015)).applyQuaternion(a.quaternion);
    a.position.set(pos.x - tipLocal.x, 0.03 - tipLocal.y, pos.z - tipLocal.z);
    a.traverse((o) => { o.castShadow = true; });
    scene.add(a);
    groundList.push(a);
  }
  function clearStuck() {
    for (const r of stuckList) { r.obj.parent && r.obj.parent.remove(r.obj); }
    stuckList.length = 0;
    for (const a of groundList) scene.remove(a);
    groundList.length = 0;
  }
  function setMarker(pt) {
    if (!marker) return;
    marker.visible = Boolean(pt);
    if (pt) marker.position.set(pt.x, TARGET_Y + pt.y, 0.025);
  }
  function stuckWobble() {
    // 꽂힌 직후 화살이 떨림
    for (const r of stuckList) {
      const age = state.t - r.t0;
      const a = Math.exp(-age * 4.5) * 0.02;
      r.obj.userData.flex(state.t, a, 50, 0);
      r.obj.rotation.z = Math.sin(age * 50) * a * 0.6;
    }
  }

  buildWorld(50);
  return {
    renderer, scene, cam, bow, state, mats,
    update, render, setWind, setArrowColor, setDistance: (d) => { if (d !== D) buildWorld(d); }, addStuck, addGroundArrow, clearStuck, setMarker, stuckWobble,
    get distance() { return D; },
    get mainTarget() { return mainTarget; },
    stuckCount: () => stuckList.length
  };
}
