// 리듬 스텝 큰 화면 배경: 클럽 무대(Three.js).
// 뒤 LED 벽(실제 소리의 주파수로 움직이는 이퀄라이저), 박자마다 물결이 퍼지는 LED 바닥, 트러스에 달린 무빙 라이트 8대(빛기둥),
// 양옆 LED 기둥, 앞쪽 관객 실루엣, 떠다니는 연기 입자. 박자 위치(beatPos)와 소리 크기(energy, bands)를 받아 움직입니다.
// 노트 길(하이웨이)은 이 위에 2D 캔버스로 따로 그립니다.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const BANDS = 32;
const HEADS = 8;
const TRUSS_Y = 10.4;
const TRUSS_Z = -1.5;

function hsl(h, s, l) { return new THREE.Color().setHSL(((h % 360) + 360) % 360 / 360, s, l); }

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020207);
  scene.fog = new THREE.FogExp2(0x05040b, 0.028);
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(0, 3.1, 17.5);
  const look = new THREE.Vector3(0, 4.4, -2);

  scene.add(new THREE.HemisphereLight(0x6a78a8, 0x0a0a14, 0.55));
  const rim = new THREE.DirectionalLight(0xa8c4ff, 0.9);
  rim.position.set(-6, 14, -10);
  scene.add(rim);

  // 공통 색(곡 표지 색에서 만듭니다)
  const colA = hsl(200, 0.9, 0.55);
  const colB = hsl(290, 0.85, 0.55);
  const colC = hsl(40, 0.95, 0.6);
  let playerCols = [];

  // ---------------- 주파수 띠 → 텍스처 ----------------
  const bandData = new Uint8Array(BANDS * 4);
  const bandTex = new THREE.DataTexture(bandData, BANDS, 1, THREE.RGBAFormat);
  bandTex.magFilter = THREE.LinearFilter;
  bandTex.minFilter = THREE.LinearFilter;
  bandTex.needsUpdate = true;
  const bandSmooth = new Float32Array(BANDS);

  // ---------------- LED 벽 ----------------
  const wallU = {
    uTime: { value: 0 }, uPulse: { value: 0 }, uEnergy: { value: 0 }, uBands: { value: bandTex },
    uColA: { value: colA.clone() }, uColB: { value: colB.clone() }, uColC: { value: colC.clone() }, uMood: { value: 0 }
  };
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 12.5),
    new THREE.ShaderMaterial({
      uniforms: wallU,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime, uPulse, uEnergy, uMood;
        uniform sampler2D uBands;
        uniform vec3 uColA, uColB, uColC;
        void main(){
          vec2 grid = vec2(150., 52.);
          vec2 cell = (floor(vUv * grid) + .5) / grid;
          // 바탕: 느리게 흐르는 물결
          float w1 = sin(cell.x * 7. + uTime * .55 + sin(cell.y * 4. + uTime * .3) * 1.6) * .5 + .5;
          float w2 = sin(cell.y * 9. - uTime * .7 + cell.x * 5.) * .5 + .5;
          vec3 col = mix(uColA, uColB, cell.x) * (.025 + .06 * w1 * w2) * (1. + uEnergy * .6);
          // 가운데에서 양쪽으로 펼친 이퀄라이저
          float x = abs(cell.x - .5) * 2.;
          float b = texture2D(uBands, vec2(x * .96 + .02, .5)).r;
          float colIdx = floor(cell.x * grid.x);
          float gap = step(.5, mod(colIdx, 4.));
          float base = .14;
          float top = base + b * .58;
          float inBar = step(base, cell.y) * step(cell.y, top) * gap;
          float k = clamp((cell.y - base) / .58, 0., 1.);
          vec3 barCol = mix(uColA, mix(uColB, uColC, smoothstep(.5, .95, k)), smoothstep(0., .55, k));
          float cap = step(top - .022, cell.y) * step(cell.y, top) * gap * step(.04, b);
          col += inBar * barCol * (.42 + uPulse * .38) + cap * vec3(1.) * .55;
          // 바닥 쪽 반사(아래로 비치는 막대)
          float refl = step(cell.y, base - .015) * step(base - .015 - b * .18, cell.y) * gap;
          col += refl * barCol * .12;
          // 박자마다 가운데서 퍼지는 고리
          float d = length((cell - vec2(.5, .55)) * vec2(2.9, 1.));
          col += uColC * smoothstep(.05, 0., abs(d - (1. - uPulse) * 1.7)) * uPulse * .45;
          // 위·아래 띠 조명
          col += uColB * smoothstep(.035, 0., abs(cell.y - .96)) * (.25 + uPulse * .45);
          col += uColA * smoothstep(.03, 0., abs(cell.y - .04)) * (.2 + uPulse * .3);
          // LED 알갱이
          vec2 g = fract(vUv * grid) - .5;
          float dotm = smoothstep(.5, .26, length(g));
          col = col * (dotm * 1.35 + .04);
          gl_FragColor = vec4(col * mix(.7, 1., uMood), 1.);
        }`
    })
  );
  wall.position.set(0, 6.6, -9.5);
  scene.add(wall);
  // 벽 테두리(검은 틀)
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x0b0c12, roughness: 0.6, metalness: 0.5 });
  for (const [w, h, x, y] of [[37, 0.5, 0, 12.95], [37, 0.5, 0, 0.25], [0.5, 13, -18.5, 6.6], [0.5, 13, 18.5, 6.6]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.6), frameMat);
    m.position.set(x, y, -9.45);
    scene.add(m);
  }

  // ---------------- LED 바닥 ----------------
  const MAXSPOT = HEADS;
  const floorU = {
    uTime: { value: 0 }, uPulse: { value: 0 }, uRing: { value: 0 }, uBeatN: { value: 0 }, uEnergy: { value: 0 },
    uColA: { value: colA.clone() }, uColB: { value: colB.clone() }, uColC: { value: colC.clone() },
    uSpots: { value: Array.from({ length: MAXSPOT }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uSpotCols: { value: Array.from({ length: MAXSPOT }, () => new THREE.Color(0, 0, 0)) },
    uFlash: { value: new THREE.Color(0, 0, 0) }
  };
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 60),
    new THREE.ShaderMaterial({
      uniforms: floorU,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `
        varying vec3 vW;
        uniform float uTime, uPulse, uRing, uBeatN, uEnergy;
        uniform vec3 uColA, uColB, uColC, uFlash;
        uniform vec4 uSpots[${MAXSPOT}];
        uniform vec3 uSpotCols[${MAXSPOT}];
        float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        void main(){
          vec2 g = vW.xz / 1.6;
          vec2 id = floor(g);
          vec2 f = fract(g);
          float edge = min(min(f.x, 1. - f.x), min(f.y, 1. - f.y));
          float line = smoothstep(.035, 0., edge);
          float tile = smoothstep(.0, .08, edge);
          vec3 col = vec3(.008, .009, .016);
          // 박자마다 몇 칸씩 켜짐
          float h = hash(id + vec2(uBeatN * 1.7, uBeatN * .3));
          float lit = step(.9, h) * uPulse;
          vec3 tc = mix(uColA, uColB, hash(id + 3.1));
          col += tc * lit * tile * .55;
          // 무대 쪽에서 퍼지는 고리
          float d = length(vW.xz - vec2(0., -8.5));
          float ring = exp(-pow((d - uRing) * .9, 2.)) * uPulse;
          col += uColC * ring * tile * .35;
          // 칸 경계선
          col += mix(uColA, uColB, .5) * line * (.05 + uEnergy * .08);
          // 무빙 라이트가 바닥에 닿은 자리
          for (int i = 0; i < ${MAXSPOT}; i++) {
            vec4 s = uSpots[i];
            if (s.w <= 0.) continue;
            float dd = length(vW.xz - s.xy);
            col += uSpotCols[i] * smoothstep(s.z, s.z * .15, dd) * s.w * .55;
          }
          // 뒤 LED 벽이 비치는 반사
          float back = smoothstep(4., -9., vW.z);
          col += mix(uColA, uColB, smoothstep(-14., 14., vW.x)) * back * (.05 + uEnergy * .12);
          col += uFlash * .25 * smoothstep(30., 0., d);
          gl_FragColor = vec4(col, 1.);
        }`
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -2);
  scene.add(floor);
  // 무대 단(바닥보다 조금 높은 검은 단과 앞 모서리 LED 줄)
  const deck = new THREE.Mesh(new THREE.BoxGeometry(34, 0.6, 7), new THREE.MeshStandardMaterial({ color: 0x0a0b12, roughness: 0.35, metalness: 0.6 }));
  deck.position.set(0, 0.3, -6.2);
  scene.add(deck);
  const edgeMat = new THREE.MeshBasicMaterial({ color: colA.clone().multiplyScalar(2.2) });
  const edge = new THREE.Mesh(new THREE.BoxGeometry(34, 0.06, 0.06), edgeMat);
  edge.position.set(0, 0.62, -2.7);
  scene.add(edge);

  // ---------------- 트러스 ----------------
  const trussMat = new THREE.MeshStandardMaterial({ color: 0x8b93a6, roughness: 0.35, metalness: 0.9 });
  const rods = [];
  const span = 34, seg = 0.85, half = 0.32;
  const corners = [[-half, -half], [half, -half], [-half, half], [half, half]];
  for (const [cy, cz] of corners) rods.push({ a: new THREE.Vector3(-span / 2, cy, cz), b: new THREE.Vector3(span / 2, cy, cz), r: 0.045 });
  for (let x = -span / 2; x < span / 2 - 0.01; x += seg) {
    const x2 = x + seg;
    for (const [c1, c2] of [[0, 1], [2, 3], [0, 2], [1, 3]]) {
      const [y1, z1] = corners[c1], [y2, z2] = corners[c2];
      rods.push({ a: new THREE.Vector3(x, y1, z1), b: new THREE.Vector3(x2, y2, z2), r: 0.022 });
    }
  }
  const rodGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
  const truss = new THREE.InstancedMesh(rodGeo, trussMat, rods.length);
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);
  rods.forEach((r, i) => {
    const d = r.b.clone().sub(r.a);
    tmpP.copy(r.a).add(r.b).multiplyScalar(0.5);
    tmpQ.setFromUnitVectors(yAxis, d.clone().normalize());
    tmpS.set(r.r, d.length(), r.r);
    tmpM.compose(tmpP, tmpQ, tmpS);
    truss.setMatrixAt(i, tmpM);
  });
  truss.position.set(0, TRUSS_Y, TRUSS_Z);
  scene.add(truss);

  // ---------------- 무빙 라이트 ----------------
  const BEAM_LEN = 24;
  const beamGeo = new THREE.CylinderGeometry(0.16, 3.1, BEAM_LEN, 40, 1, true);
  beamGeo.translate(0, -BEAM_LEN / 2, 0);
  const headMat = new THREE.MeshStandardMaterial({ color: 0x1a1c24, roughness: 0.45, metalness: 0.7 });
  const heads = [];
  for (let i = 0; i < HEADS; i++) {
    const x = -14 + (28 / (HEADS - 1)) * i;
    const base = new THREE.Group();
    base.position.set(x, TRUSS_Y - 0.45, TRUSS_Z);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.3, 0.5), headMat);
    box.position.y = 0.05;
    base.add(box);
    const pan = new THREE.Group();
    pan.position.y = -0.12;
    base.add(pan);
    for (const sx of [-0.3, 0.3]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.5, 0.18), headMat);
      arm.position.set(sx, -0.22, 0);
      pan.add(arm);
    }
    const tilt = new THREE.Group();
    tilt.position.y = -0.42;
    pan.add(tilt);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.62, 18), headMat);
    can.position.y = -0.05;
    tilt.add(can);
    const lensMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24), lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.y = -0.37;
    tilt.add(lens);
    const beamU = { uColor: { value: new THREE.Color(1, 1, 1) }, uIntensity: { value: 0.6 } };
    const beam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
      uniforms: beamU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `varying float vH; varying float vEdge;
        void main(){ vH = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.); vec3 n = normalize(normalMatrix * normal);
          vEdge = abs(dot(n, normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vH; varying float vEdge; uniform vec3 uColor; uniform float uIntensity;
        void main(){ float a = pow(vH, 1.7) * pow(vEdge, 1.5) * uIntensity * .9; gl_FragColor = vec4(uColor * a, a); }`
    }));
    beam.position.y = -0.36;
    tilt.add(beam);
    scene.add(base);
    heads.push({ base, pan, tilt, lens, lensMat, beam, beamU, x, color: new THREE.Color(1, 1, 1), hit: new THREE.Vector3() });
  }

  // ---------------- 양옆 LED 기둥 ----------------
  const pillarU = { uTime: { value: 0 }, uPulse: { value: 0 }, uColA: wallU.uColA, uColB: wallU.uColB };
  const pillarMat = new THREE.ShaderMaterial({
    uniforms: pillarU,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `varying vec2 vUv; uniform float uTime, uPulse; uniform vec3 uColA, uColB;
      void main(){ float band = smoothstep(.35, .5, sin(vUv.y * 26. - uTime * 5.) * .5 + .5);
        vec3 c = mix(uColA, uColB, vUv.y) * (.08 + band * (.35 + uPulse * .6));
        float seg = step(.12, fract(vUv.y * 40.));
        gl_FragColor = vec4(c * seg, 1.); }`
  });
  for (const x of [-21, -19.6, 19.6, 21]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.42, 11, 0.42), pillarMat);
    p.position.set(x, 5.5, -7.5);
    scene.add(p);
  }

  // ---------------- 관객 실루엣 ----------------
  const crowd = [];
  const R = (() => { let a = 7; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  // 카메라 바로 앞 두 줄: 화면 아래 끝에 머리·어깨·든 손만 보입니다
  for (let row = 0; row < 2; row++) {
    const z = 10.6 + row * 1.3;
    const n = 13 + row * 2;
    for (let i = 0; i < n; i++) {
      const x = -9.5 + (19 / (n - 1)) * i + (R() - 0.5) * 0.8 + (row ? 0.6 : 0);
      crowd.push({ x, z: z + (R() - 0.5) * 0.5, s: 0.82 + R() * 0.22, ph: R() * Math.PI * 2, hands: R() < 0.45, amp: 0.6 + R() * 0.6 });
    }
  }
  const silMat = new THREE.MeshBasicMaterial({ color: 0x030308 });
  const bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.26, 0.62, 4, 12), silMat, crowd.length);
  const headsM = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 14, 12), silMat, crowd.length);
  const nArms = crowd.filter((c) => c.hands).length * 2;
  const arms = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.055, 0.55, 3, 8), silMat, Math.max(1, nArms));
  for (const m of [bodies, headsM, arms]) { m.frustumCulled = false; scene.add(m); }

  // ---------------- 연기 입자 ----------------
  const HZ = 520;
  const hzPos = new Float32Array(HZ * 3);
  for (let i = 0; i < HZ; i++) { hzPos[i * 3] = (R() - 0.5) * 36; hzPos[i * 3 + 1] = R() * 11; hzPos[i * 3 + 2] = -9 + R() * 16; }
  const hzGeo = new THREE.BufferGeometry();
  hzGeo.setAttribute('position', new THREE.BufferAttribute(hzPos, 3));
  const haze = new THREE.Points(hzGeo, new THREE.PointsMaterial({ color: 0x9fb0d8, size: 0.07, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(haze);

  // ---------------- 후처리(빛 번짐) ----------------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.5, 0.7);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------------- 움직임 ----------------
  let time = 0, lastBeatN = -1, pulse = 0, ringR = 0, flashAmt = 0;
  const flashCol = new THREE.Color(0, 0, 0);
  let mood = 'select';
  let moodK = 0;
  const dir = new THREE.Vector3();
  const PATTERNS = ['fan', 'sweep', 'cross', 'swirl'];

  function aim(i, pattern, t, beatPos) {
    const h = heads[i];
    const k = i - (HEADS - 1) / 2;
    const sgn = i % 2 ? 1 : -1;
    let panA = 0, tiltA = 0.3;
    if (pattern === 'fan') { panA = 0; tiltA = k * 0.13 + Math.sin(t * 0.8) * 0.06; h.pan.rotation.y = 0; h.tilt.rotation.z = tiltA; h.tilt.rotation.x = -0.28 - 0.08 * Math.sin(beatPos * Math.PI * 0.5); return; }
    if (pattern === 'sweep') { panA = Math.sin(t * 0.9 + i * 0.42) * 0.55; tiltA = 0.42 + 0.16 * Math.sin(t * 1.25 + i); }
    else if (pattern === 'cross') { panA = sgn * (0.75 + Math.sin(t * 1.1) * 0.25); tiltA = 0.48 + 0.08 * Math.sin(beatPos * Math.PI); }
    else { panA = Math.sin(t * 1.6 + i * 1.1) * 0.8; tiltA = 0.32 + 0.22 * Math.sin(t * 2.1 + i * 0.7); }
    h.tilt.rotation.z = 0;
    h.pan.rotation.y = panA;
    h.tilt.rotation.x = -tiltA;
  }

  function update(dt, o = {}) {
    time += dt;
    const beatPos = o.beatPos ?? time * 1.6;
    const energy = Math.max(0, Math.min(1, o.energy ?? 0.3));
    const beatN = Math.floor(beatPos);
    if (beatN !== lastBeatN) {
      lastBeatN = beatN;
      const strong = o.barLen ? beatN % o.barLen === 0 : beatN % 4 === 0;
      pulse = Math.max(pulse, strong ? 1 : 0.7);
      ringR = 0;
    }
    pulse *= Math.exp(-dt * 4.2);
    ringR += dt * 16;
    flashAmt *= Math.exp(-dt * 5);
    moodK += ((mood === 'play' ? 1 : 0) - moodK) * Math.min(1, dt * 1.5);

    // 주파수 띠
    if (o.bands) {
      const n = o.bands.length;
      for (let i = 0; i < BANDS; i++) {
        // 낮은 음역을 더 넓게: 로그 비슷하게 묶습니다
        const a = Math.floor(Math.pow(i / BANDS, 1.7) * n * 0.7);
        const b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / BANDS, 1.7) * n * 0.7));
        let s = 0;
        for (let k = a; k < b; k++) s += o.bands[k];
        const raw = (s / (b - a)) / 255;
        const v = Math.min(1, Math.pow(Math.max(0, (raw - 0.3) / 0.62), 1.25) * (0.85 + i / BANDS * 0.5));
        bandSmooth[i] = v > bandSmooth[i] ? v : bandSmooth[i] + (v - bandSmooth[i]) * Math.min(1, dt * 7);
      }
    } else {
      for (let i = 0; i < BANDS; i++) {
        const v = (0.25 + 0.2 * Math.sin(time * 2 + i * 0.5)) * (0.5 + pulse * 0.5) * Math.exp(-i / 30);
        bandSmooth[i] += (v - bandSmooth[i]) * Math.min(1, dt * 5);
      }
    }
    for (let i = 0; i < BANDS; i++) { const v = Math.round(bandSmooth[i] * 255); bandData[i * 4] = v; bandData[i * 4 + 1] = v; bandData[i * 4 + 2] = v; bandData[i * 4 + 3] = 255; }
    bandTex.needsUpdate = true;

    wallU.uTime.value = time;
    wallU.uPulse.value = pulse;
    wallU.uEnergy.value = energy;
    wallU.uMood.value = 0.55 + moodK * 0.45;
    floorU.uTime.value = time;
    floorU.uPulse.value = pulse;
    floorU.uRing.value = ringR;
    floorU.uBeatN.value = beatN;
    floorU.uEnergy.value = energy;
    floorU.uFlash.value.copy(flashCol).multiplyScalar(flashAmt);
    pillarU.uTime.value = time;
    pillarU.uPulse.value = pulse;
    edgeMat.color.copy(colA).multiplyScalar(1.4 + pulse * 1.6);

    // 무빙 라이트
    const pattern = PATTERNS[((Math.floor(beatPos / 16) % PATTERNS.length) + PATTERNS.length) % PATTERNS.length];
    const palette = [colA, colB, colC, ...playerCols];
    for (let i = 0; i < HEADS; i++) {
      const h = heads[i];
      aim(i, pattern, time, beatPos);
      const pi = (((i + Math.floor(beatPos / 8)) % palette.length) + palette.length) % palette.length;
      const want = palette[pi];
      h.color.lerp(want, Math.min(1, dt * 3));
      const inten = (0.45 + 0.55 * pulse * (i % 2 === beatN % 2 ? 1 : 0.55)) * (0.55 + moodK * 0.45) * (0.7 + energy * 0.5);
      h.beamU.uColor.value.copy(h.color);
      h.beamU.uIntensity.value = inten;
      h.lensMat.color.copy(h.color).multiplyScalar(1.5 + inten * 2.2);
      // 바닥에 닿는 자리
      h.tilt.updateWorldMatrix(true, false);
      dir.set(0, -1, 0).transformDirection(h.tilt.matrixWorld);
      const p0 = tmpP.setFromMatrixPosition(h.tilt.matrixWorld);
      const s = floorU.uSpots.value[i];
      if (dir.y < -0.15) {
        const dist = p0.y / -dir.y;
        const hx = p0.x + dir.x * dist, hz = p0.z + dir.z * dist;
        const rad = 0.2 + 2.95 * Math.min(1, dist / BEAM_LEN);
        s.set(hx, hz, rad * 1.1, inten);
        floorU.uSpotCols.value[i].copy(h.color);
      } else s.set(0, 0, 0, 0);
    }

    // 관객
    let ai = 0;
    const bp = beatPos % 1;
    crowd.forEach((c, i) => {
      const bounce = Math.pow(Math.abs(Math.sin((bp + c.ph * 0.05) * Math.PI)), 2) * 0.16 * c.amp * (0.4 + energy * 0.9) * (0.35 + moodK * 0.65);
      const y = 0.78 * c.s + bounce;
      tmpQ.identity();
      tmpS.set(c.s, c.s, c.s);
      tmpP.set(c.x, y, c.z);
      tmpM.compose(tmpP, tmpQ, tmpS);
      bodies.setMatrixAt(i, tmpM);
      tmpP.set(c.x, y + 0.66 * c.s, c.z);
      tmpM.compose(tmpP, tmpQ, tmpS);
      headsM.setMatrixAt(i, tmpM);
      if (c.hands) {
        // 손 든 사람: 두 팔을 위로 뻗고 박자에 맞춰 살짝 흔듭니다
        for (const sd of [-1, 1]) {
          const wave = Math.sin(beatPos * Math.PI + c.ph) * 0.12 * (0.4 + moodK * 0.6);
          const ang = -sd * 0.22 + wave;
          const q = tmpQ.setFromAxisAngle(zAxis, ang);
          tmpP.set(c.x + sd * 0.2 * c.s - Math.sin(ang) * 0.3 * c.s, y + 0.62 * c.s + Math.cos(ang) * 0.3 * c.s, c.z);
          tmpM.compose(tmpP, q, tmpS);
          arms.setMatrixAt(ai++, tmpM);
        }
      }
    });
    bodies.instanceMatrix.needsUpdate = true;
    headsM.instanceMatrix.needsUpdate = true;
    arms.instanceMatrix.needsUpdate = true;

    // 연기
    const pa = hzGeo.attributes.position.array;
    for (let i = 0; i < HZ; i++) {
      pa[i * 3] += Math.sin(time * 0.2 + i) * dt * 0.08;
      pa[i * 3 + 1] += dt * (0.05 + (i % 7) * 0.01);
      if (pa[i * 3 + 1] > 11) pa[i * 3 + 1] = 0;
    }
    hzGeo.attributes.position.needsUpdate = true;
    haze.material.opacity = 0.1 + energy * 0.12;

    // 카메라: 천천히 흔들리고, 센 박에 살짝 들썩
    camera.position.x = Math.sin(time * 0.07) * 1.4;
    camera.position.y = 3.1 + Math.sin(time * 0.11) * 0.25 + pulse * 0.05 * moodK;
    camera.position.z = 17.5 - moodK * 0.8;
    camera.lookAt(look);
    bloom.strength = 0.55 + pulse * 0.18 + flashAmt * 0.35;
  }

  function render() { composer.render(); }
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  return {
    renderer, scene, camera,
    update, render, resize,
    /** 곡 표지 색으로 무대 색을 맞춥니다 */
    setHue(hue) {
      colA.copy(hsl(hue, 0.95, 0.55));
      colB.copy(hsl(hue + 165, 0.85, 0.58));
      colC.copy(hsl(hue + 60, 0.95, 0.62));
      wallU.uColA.value.copy(colA); wallU.uColB.value.copy(colB); wallU.uColC.value.copy(colC);
      floorU.uColA.value.copy(colA); floorU.uColB.value.copy(colB); floorU.uColC.value.copy(colC);
    },
    setPlayers(colors) { playerCols = (colors || []).map((c) => new THREE.Color(c)); },
    setMood(m) { mood = m; },
    flash(color, s = 1) { flashCol.set(color); flashAmt = Math.max(flashAmt, s); pulse = Math.max(pulse, 0.6 * s); },
    get pulse() { return pulse; }
  };
}
