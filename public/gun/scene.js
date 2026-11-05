// 좀비 건 아케이드 장면: 렌더러·안개·조명, 카메라(1인칭, 레일 위), 파티클(피·불꽃), 바닥/벽에 남는 얼룩.
// 구역마다 안개 색과 조명 분위기가 카메라 위치에 따라 부드럽게 바뀝니다.
import * as THREE from 'three';
import { makeWorld, STAGE_Z, splatTexture, makeZombie, makeMedkit } from './models.js';

export { STAGE_Z };

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// 구역별 분위기(구역 이름 순서: 거리, 쇼핑몰, 주차장)
const MOODS = [
  { fog: '#0a1124', dens: 0.034, hemiSky: '#5a78b8', hemiGround: '#12161e', hemi: 0.55, moon: 0.45, spot: 14, exp: 1.0 },
  { fog: '#0c1518', dens: 0.044, hemiSky: '#5f8088', hemiGround: '#1a1812', hemi: 0.5, moon: 0.0, spot: 15, exp: 1.05 },
  { fog: '#17100a', dens: 0.046, hemiSky: '#8a6a4a', hemiGround: '#1a120c', hemi: 0.5, moon: 0.0, spot: 15, exp: 1.05 }
];
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();

// 점 하나짜리 파티클 묶음(색·크기·투명도가 입자마다 다름)
function makeParticles(max, additive) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3);
  const col = new Float32Array(max * 4);
  const size = new Float32Array(max);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('pcol', new THREE.BufferAttribute(col, 4));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uScale: { value: 600 } },
    vertexShader: `
      attribute vec4 pcol; attribute float size; varying vec4 vC; uniform float uScale;
      void main() {
        vC = pcol;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * uScale / max(0.1, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec4 vC;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float a = smoothstep(1.0, 0.35, d) * vC.a;
        gl_FragColor = vec4(vC.rgb, a);
      }`
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  const vel = new Float32Array(max * 3);
  const life = new Float32Array(max);
  const maxLife = new Float32Array(max);
  const grav = new Float32Array(max);
  const base = new Float32Array(max * 3);
  const sz0 = new Float32Array(max);
  let head = 0;
  const _col = new THREE.Color();
  return {
    points, mat,
    emit(p, n, o = {}) {
      const c1 = new THREE.Color(o.color || '#ffffff');
      const c2 = new THREE.Color(o.color2 || o.color || '#ffffff');
      for (let k = 0; k < n; k++) {
        const i = head;
        head = (head + 1) % max;
        pos[i * 3] = p.x;
        pos[i * 3 + 1] = p.y;
        pos[i * 3 + 2] = p.z;
        // 방향 + 퍼짐
        let dx = Math.random() * 2 - 1;
        let dy = Math.random() * 2 - 1;
        let dz = Math.random() * 2 - 1;
        const l = Math.hypot(dx, dy, dz) || 1;
        dx /= l; dy /= l; dz /= l;
        if (o.dir) {
          const cone = o.cone ?? 0.6;
          dx = o.dir.x + dx * cone;
          dy = o.dir.y + dy * cone;
          dz = o.dir.z + dz * cone;
        }
        const sp = (o.speed || 3) * (0.4 + Math.random() * 0.8);
        vel[i * 3] = dx * sp;
        vel[i * 3 + 1] = dy * sp + (o.up || 0);
        vel[i * 3 + 2] = dz * sp;
        life[i] = maxLife[i] = (o.life || 0.6) * (0.6 + Math.random() * 0.7);
        grav[i] = o.gravity ?? 6;
        sz0[i] = (o.size || 0.06) * (0.6 + Math.random() * 0.8);
        _col.copy(c1).lerp(c2, Math.random()).multiplyScalar(o.hot || 1);
        base[i * 3] = _col.r; base[i * 3 + 1] = _col.g; base[i * 3 + 2] = _col.b;
      }
    },
    update(dt) {
      for (let i = 0; i < max; i++) {
        if (life[i] <= 0) {
          size[i] = 0;
          col[i * 4 + 3] = 0;
          continue;
        }
        life[i] -= dt;
        vel[i * 3 + 1] -= grav[i] * dt;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (pos[i * 3 + 1] < 0.03) {
          pos[i * 3 + 1] = 0.03;
          vel[i * 3 + 1] *= -0.2;
          vel[i * 3] *= 0.6;
          vel[i * 3 + 2] *= 0.6;
        }
        const u = clamp(life[i] / maxLife[i], 0, 1);
        col[i * 4] = base[i * 3];
        col[i * 4 + 1] = base[i * 3 + 1];
        col[i * 4 + 2] = base[i * 3 + 2];
        col[i * 4 + 3] = Math.min(1, u * 1.6);
        size[i] = sz0[i] * (additive ? u : 0.5 + 0.5 * u);
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.pcol.needsUpdate = true;
      geo.attributes.size.needsUpdate = true;
    }
  };
}

export function createScene(cv) {
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
  const maxPr = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(maxPr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(MOODS[0].fog);
  scene.fog = new THREE.FogExp2(MOODS[0].fog, MOODS[0].dens);

  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 140);
  scene.add(camera);

  // ---------- 조명 ----------
  const hemi = new THREE.HemisphereLight(MOODS[0].hemiSky, MOODS[0].hemiGround, MOODS[0].hemi);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight('#7f9cff', MOODS[0].moon);
  moon.position.set(-8, 20, 6);
  scene.add(moon);
  // 카메라에 붙은 손전등: 정면의 좀비가 어둠 속에서도 보이게
  const flash = new THREE.SpotLight('#fff1d6', MOODS[0].spot, 40, 0.6, 0.65, 1.0);
  flash.position.set(0.15, -0.1, 0);
  flash.target.position.set(0, 0.1, -10);
  camera.add(flash, flash.target);
  // 총구 불빛(쏜 사람의 색으로 번쩍)
  const muzzle = new THREE.PointLight('#ffffff', 0, 16, 2);
  muzzle.position.set(0, -0.2, -1.2);
  camera.add(muzzle);

  const world = makeWorld();
  scene.add(world.group);
  // 길가 조명은 점광원 몇 개를 돌려 씁니다(셰이더가 다시 만들어지지 않게 개수를 고정).
  const POOL = 6;
  const lightPool = [];
  for (let i = 0; i < POOL; i++) {
    const l = new THREE.PointLight('#ffffff', 0, 20, 2);
    scene.add(l);
    lightPool.push(l);
  }
  const srcs = world.lights.sort((a, b) => b.z - a.z);
  srcs.forEach((s, i) => { s.slot = i % POOL; s.cur = 0; s.ph = Math.random() * 100; });

  // ---------- 효과 ----------
  const blood = makeParticles(1400, false);
  const sparks = makeParticles(700, true);
  scene.add(blood.points, sparks.points);

  // 얼룩: 맞은 자리(쏜 사람 색)와 쓰러진 자리 바닥
  const splatTex = splatTexture();
  const splatGeo = new THREE.PlaneGeometry(1, 1);
  const splats = [];
  for (let i = 0; i < 90; i++) {
    const m = new THREE.Mesh(splatGeo, new THREE.MeshBasicMaterial({ map: splatTex, transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.visible = false;
    scene.add(m);
    splats.push({ m, life: 0, max: 1 });
  }
  let splatHead = 0;
  function splat(pos, color, size, flat, life = 1.6) {
    const s = splats[splatHead];
    splatHead = (splatHead + 1) % splats.length;
    s.life = s.max = life;
    s.m.visible = true;
    s.m.material.color.set(color).lerp(_c2.set('#6a0a10'), 0.18);
    s.m.scale.setScalar(size);
    s.m.position.copy(pos);
    if (flat) {
      s.m.rotation.set(-Math.PI / 2, 0, Math.random() * 6.28);
      s.m.position.y = 0.035;
    } else {
      s.m.lookAt(camera.position);
      s.m.rotateZ(Math.random() * 6.28);
      s.m.position.lerp(camera.position, 0.03);
    }
  }

  const fires = world.group.userData.fireCones || [];
  const mood = { i: 0 };

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    blood.mat.uniforms.uScale.value = sparks.mat.uniforms.uScale.value = (h * renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }
  window.addEventListener('resize', resize);
  resize();

  let muzzleT = 0;
  function muzzleFlash(color, k = 1) {
    muzzle.color.set(color);
    muzzle.intensity = 40 * k;
    muzzleT = 0.07;
  }

  // 카메라 z 로 분위기를 섞습니다.
  function applyMood(z) {
    let a = 0;
    if (z > STAGE_Z[1] + 4) a = 0;
    else if (z > STAGE_Z[2] + 4) a = 1;
    else a = 2;
    mood.i = a;
    // 경계 근처에서 섞기
    const blendLen = 10;
    let m0 = MOODS[a];
    let m1 = MOODS[a];
    let t = 0;
    if (a === 0 && z < STAGE_Z[1] + blendLen) {
      m1 = MOODS[1]; t = clamp((STAGE_Z[1] + blendLen - z) / blendLen, 0, 1);
    } else if (a === 1 && z < STAGE_Z[2] + blendLen) {
      m1 = MOODS[2]; t = clamp((STAGE_Z[2] + blendLen - z) / blendLen, 0, 1);
    }
    _c1.set(m0.fog).lerp(_c2.set(m1.fog), t);
    scene.fog.color.copy(_c1);
    scene.background.copy(_c1);
    scene.fog.density = m0.dens + (m1.dens - m0.dens) * t;
    hemi.color.set(m0.hemiSky).lerp(_c2.set(m1.hemiSky), t);
    hemi.groundColor.set(m0.hemiGround).lerp(_c2.set(m1.hemiGround), t);
    hemi.intensity = m0.hemi + (m1.hemi - m0.hemi) * t;
    moon.intensity = m0.moon + (m1.moon - m0.moon) * t;
    flash.intensity = m0.spot + (m1.spot - m0.spot) * t;
    renderer.toneMappingExposure = m0.exp + (m1.exp - m0.exp) * t;
  }

  let clock = 0;
  function update(dt, camZ) {
    clock += dt;
    applyMood(camZ);
    // 길가 조명 배정
    for (const s of srcs) {
      const inRange = s.z < camZ + 8 && s.z > camZ - 46;
      const f = 1 - s.flicker * (0.5 + 0.5 * Math.sin(clock * 17 + s.ph) * Math.sin(clock * 5.3 + s.ph * 2)) * (Math.sin(clock * 3.1 + s.ph) > 0.5 ? 1 : 0.25);
      const target = inRange ? s.intensity * Math.max(0.05, f) : 0;
      s.cur += (target - s.cur) * Math.min(1, dt * 8);
      const l = lightPool[s.slot];
      if (inRange || s.cur > 0.5) {
        // 같은 슬롯을 쓰는 다른 광원이 이미 켜져 있으면 가까운 쪽이 이깁니다.
        if (!l.userData.src || l.userData.src === s || Math.abs(l.userData.src.z - camZ) > Math.abs(s.z - camZ) || l.userData.src.cur < 1) {
          l.userData.src = s;
          l.position.set(s.x, s.y, s.z);
          l.color.set(s.color);
          l.intensity = s.cur;
        }
      } else if (l.userData.src === s) {
        l.intensity = 0;
        l.userData.src = null;
      }
    }
    for (const f of fires) {
      f.scale.y = 0.55 + 0.25 * Math.sin(clock * 14 + f.position.x) + Math.random() * 0.1;
      f.scale.x = f.scale.z = 0.24 + Math.random() * 0.05;
    }
    if (muzzleT > 0) {
      muzzleT -= dt;
      if (muzzleT <= 0) muzzle.intensity = 0;
      else muzzle.intensity *= 0.8;
    }
    blood.update(dt);
    sparks.update(dt);
    for (const s of splats) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.m.visible = false;
        continue;
      }
      const u = s.life / s.max;
      s.m.material.opacity = Math.min(1, u * 2.2) * 0.9;
    }
  }

  return {
    renderer, scene, camera, world, blood, sparks, splat, muzzleFlash, update, resize,
    render: () => renderer.render(scene, camera),
    makeZombie, makeMedkit,
    add: (o) => scene.add(o),
    remove: (o) => scene.remove(o)
  };
}
