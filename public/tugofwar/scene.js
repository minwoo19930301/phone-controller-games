// 줄다리기 장면: 렌더러(ACES·PCF 그림자·환경 맵), 운동회 운동장, 밧줄과 양 팀 사람들의 몸짓, 먼지, 카메라 연출.
// game.js 가 매 프레임 update(dt, view) 로 지금 상태(깃발 위치·박자·모드)를 알려 주면 여기서 그립니다.
import * as THREE from 'three';
import {
  clamp, lerp, TEAM_COLOR, makeGround, makeChalk, makeSkyTexture, makeEnvScene, makeClouds, makeSchool, makeGym, makeTent, makeTree, makeFence,
  makeBunting, makeCrowd, makeRope, makeCenterFlag, makeRibbon, Puller, makeCaller
} from './models.js';

export const LINE_X = 3.2; // 가운데 선에서 각 팀 선까지(깃발이 이 선에 닿으면 이김)
const GRIP_Y = 1.03; // 밧줄 높이
const GAP = 1.45; // 깃발에서 첫 사람까지
const SPACING = 0.98;
const TAU = Math.PI * 2;
const ease = (t) => t * t * (3 - 2 * t);

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const skyTex = makeSkyTexture();
  scene.background = skyTex;
  scene.fog = new THREE.Fog(0xd5e8f6, 46, 150);
  // 환경 맵: 하늘 장면을 PMREM 으로 구워 재질 반사·간접광으로 씁니다
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(makeEnvScene(), 0.03).texture;
  scene.environmentIntensity = 0.65;
  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 400);
  camera.position.set(0, 2.6, 15);

  // ---------- 빛 ----------
  const sun = new THREE.DirectionalLight(0xfff0d8, 3.1);
  sun.position.set(-9, 15, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -17; sc.right = 17; sc.top = 10; sc.bottom = -7; sc.near = 1; sc.far = 50;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xbfdcff, 0x9c7a52, 0.7);
  scene.add(hemi);

  // ---------- 운동장 ----------
  scene.add(makeGround(), makeChalk(LINE_X), makeClouds());
  const school = makeSchool();
  school.position.set(0, 0, -58);
school.scale.setScalar(1.35);
  scene.add(school);
  const gym = makeGym();
  gym.position.set(38, 0, -30);
  gym.rotation.y = -0.45;
  scene.add(gym);
  const tent = makeTent();
  tent.position.set(-15, 0, -7.5);
  tent.rotation.y = 0.25;
  scene.add(tent);
  const bunting = makeBunting();
  scene.add(bunting);
  const crowd = makeCrowd();
  scene.add(crowd);
  const trees = [[-30, -18, 1.2], [-24, -14, 1], [-19.5, -20, 1.3], [20, -16, 1.1], [26, -12, 0.95], [-36, -10, 1.3], [38, -8, 1.2], [-12, -24, 1.4], [14, -26, 1.3], [-44, -22, 1.5], [46, -20, 1.4]];
  trees.forEach(([x, z, s], i) => {
    const t = makeTree(i + 1, s);
    t.position.set(x, 0, z);
    scene.add(t);
  });
  for (const x of [-19, 19]) {
    const f = makeFence(11);
    f.position.set(x, 0, -4.1);
    scene.add(f);
  }
  // 관중 앞 낮은 울타리
  const barrier = makeFence(46);
  barrier.position.set(0, 0, -4.1);
  barrier.visible = false;

  // ---------- 밧줄 · 깃발 · 리본 ----------
  const rope = makeRope(60);
  scene.add(rope);
  const flag = makeCenterFlag();
  scene.add(flag);
  const ribbons = { left: makeRibbon('blue'), right: makeRibbon('white') };
  scene.add(ribbons.left, ribbons.right);
  const knots = [0, 1].map(() => {
    const k = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), new THREE.MeshStandardMaterial({ color: 0xb48a50, roughness: 0.9 }));
    k.castShadow = true;
    scene.add(k);
    return k;
  });

  // ---------- 구령 담당 ----------
  const callerGroup = makeCaller();
  callerGroup.position.set(0, 0, -4.8);
callerGroup.scale.setScalar(1.2);
  scene.add(callerGroup);
  const caller = callerGroup.userData.caller;
  const hit = { l: 0, r: 0 };

  // ---------- 먼지 ----------
  const dustTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    r.addColorStop(0, 'rgba(226,200,160,.85)');
    r.addColorStop(1, 'rgba(226,200,160,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const puffs = [];
  for (let i = 0; i < 80; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, transparent: true, depthWrite: false, opacity: 0 }));
    s.visible = false;
    scene.add(s);
    puffs.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 1 });
  }
  let puffHead = 0;
  function puff(x, y, z, n = 3, power = 1) {
    for (let i = 0; i < n; i++) {
      const p = puffs[puffHead++ % puffs.length];
      p.life = p.max = 0.7 + Math.random() * 0.6;
      p.vx = (Math.random() - 0.5) * 1.4 * power;
      p.vy = 0.35 + Math.random() * 0.7 * power;
      p.vz = 0.2 + Math.random() * 0.9;
      p.size = 0.45 + Math.random() * 0.5 * power;
      p.s.position.set(x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3);
      p.s.visible = true;
    }
  }
  // 종이 꽃가루(이긴 팀)
  const conf = [];
  const confGeo = new THREE.PlaneGeometry(0.12, 0.07);
  const confMesh = new THREE.InstancedMesh(confGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), 140);
  confMesh.frustumCulled = false;
  confMesh.count = 0;
  scene.add(confMesh);
  const confCols = ['#e0332c', '#ffd23a', '#2f6fe4', '#ffffff', '#4cc36a', '#ff8fd1'].map((c) => new THREE.Color(c));
  for (let i = 0; i < 140; i++) {
    confMesh.setColorAt(i, confCols[i % confCols.length]);
    conf.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), rv: new THREE.Vector3(), life: 0 });
  }
  function confetti(cx, n = 70) {
    for (let i = 0; i < n; i++) {
      const c = conf.find((q) => q.life <= 0);
      if (!c) break;
      c.life = 2.5 + Math.random() * 1.5;
      c.p.set(cx + (Math.random() - 0.5) * 7, 4 + Math.random() * 1.5, (Math.random() - 0.5) * 3);
      c.v.set((Math.random() - 0.5) * 1.5, -0.6 - Math.random() * 1.2, (Math.random() - 0.5) * 1);
      c.rv.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    }
  }

  // ---------- 사람들 ----------
  const members = new Map(); // id → state
  const teamGroup = new THREE.Group();
  scene.add(teamGroup);
  const layout = { left: { team: 'blue', ids: [] }, right: { team: 'white', ids: [] } };
  let size = 3;
  function clearTeams() {
    for (const m of members.values()) teamGroup.remove(m.puller.root);
    members.clear();
    layout.left.ids = [];
    layout.right.ids = [];
  }
  // def: { left:{team, members:[{id, slot, name, color, cpu}]}, right:{...} }
  function setTeams(def, seed = 1) {
    clearTeams();
    size = Math.max(def.left.members.length, def.right.members.length, 3);
    for (const side of ['left', 'right']) {
      layout[side].team = def[side].team;
      def[side].members.forEach((m, i) => {
        const puller = new Puller({ team: def[side].team, seed: seed * 31 + i * 7 + (side === 'left' ? 0 : 3) + (m.slot || 0) * 13, slot: m.slot, name: m.name, color: m.color, cpu: m.cpu });
        const dir = side === 'left' ? 1 : -1; // 바라보는 쪽(깃발 방향)
        puller.root.rotation.y = side === 'left' ? 0 : Math.PI;
        teamGroup.add(puller.root);
        members.set(m.id, {
          id: m.id, puller, side, idx: i, dir, def: m,
          heave: 0, heaveT: 9, pw: 0.7, stumble: 0, stumbleT: 9, tired: 0, mood: 'pull', fall: 0, fallV: 0, cheerT: 0, jump: 0,
          ph: Math.random() * 6, x: 0, z: (i % 2 ? 0.1 : -0.1), flash: 0
        });
        layout[side].ids.push(m.id);
      });
    }
  }
  // 왼팀은 깃발 왼쪽(-), 오른팀은 오른쪽(+)
  const rootX = (m, flagX) => flagX + (m.side === 'left' ? -1 : 1) * (GAP + m.idx * SPACING);

  // ---------- 상태 ----------
  const S = {
    flagX: 0, flagTarget: 0, camX: 0, dist: 15, punch: 0, shake: 0, slow: 0, time: 0, cheer: 0.2, mode: 'lobby', ropeDrop: 0, orbit: 0,
    toPull: 9, beatPulse: 0, winnerSide: null, ropeWave: 0, fov: 34, intro: 0
  };

  // 밧줄 높이(월드 좌표 x 에서)
  function ropeY(x, v = S) {
    const hw = 10;
    const sag = 0.1 * Math.max(0, 1 - Math.pow((x - v.flagX) / 1.8, 2));
    const wave = v.ropeWave * Math.sin((x - v.flagX) * 1.6 - v.time * 18) * 0.05;
    return GRIP_Y - sag + wave - v.ropeDrop * (GRIP_Y - 0.1);
  }

  function pose(m, dt, v) {
    const st = m;
    const p = st.puller;
    st.heaveT += dt;
    st.stumbleT += dt;
    // 당김 곡선: 0.09초 만에 올라가고 0.6초에 걸쳐 풀림
    const e = st.heaveT < 0.09 ? ease(st.heaveT / 0.09) : Math.exp(-(st.heaveT - 0.09) * 4.2);
    st.heave = st.heaveT < 3 ? e : 0;
    const w = v.mode === 'run' ? ease(clamp(1 - st.windupIn / 0.5, 0, 1)) * (st.windupIn > 0 ? 1 : 0) : 0; // 당기기 직전 웅크림
    const tired = st.tired;
    const t = S.time + st.ph;
    const sway = Math.sin(t * 1.7) * 0.012;
    const mode = st.mood;
    let P;
    const x0 = rootX(st, S.flagX);
    // 쓰러짐(진 팀) · 환호(이긴 팀)
    st.fall += (mode === 'fall' ? 1 - st.fall : -st.fall * 0) * Math.min(1, dt * 2.4);
    if (mode !== 'fall') st.fall = Math.max(0, st.fall - dt * 3);
    const ry = Math.max(0, S.ropeDrop);
    if (mode === 'cheer') {
      st.cheerT += dt;
      const hop = Math.abs(Math.sin(st.cheerT * 7 + st.ph)) * 0.22;
      st.jump = hop;
      const raise = 1.95 + Math.sin(st.cheerT * 9 + st.ph) * 0.08;
      P = {
        a: 0.0 + Math.sin(st.cheerT * 3.5 + st.ph) * 0.06, px: 0, py: 0.86 + 0.02, footF: [0.12, hop], footB: [-0.14, hop],
        handF: [0.28, raise], handB: [-0.1, raise - 0.05], mouth: 1, nod: 0, turn: 0.55, flutter: 0.3, elbowDir: 1, footAngle: 0
      };
    } else if (mode === 'idle') {
      const br = Math.sin(t * 1.9);
      P = {
        a: 0.12 + sway, px: -0.04, py: 0.84 + br * 0.006, footF: [0.12, 0], footB: [-0.2, 0],
        handF: [0.3, 0.72 + br * 0.01], handB: [0.16, 0.7], mouth: 0.15, nod: 0, turn: 0.5, flutter: 0, elbowDir: -1
      };
      if (v.hold) {
        P.a = 0.34;
        P.handF = [0.4, GRIP_Y];
        P.handB = [0.2, GRIP_Y];
        P.footF = [0.2, 0];
        P.footB = [-0.46, 0];
        P.py = 0.74;
      }
    } else {
      // 줄다리기 자세
      const sw = st.stumbleT < 1.1 ? Math.sin(st.stumbleT * 22) * Math.exp(-st.stumbleT * 3.2) : 0;
      const pw = st.pw;
      const a = 0.5 + (0.42 * st.heave * (0.55 + 0.45 * pw)) - 0.12 * w - 0.07 * tired + sway + sw * 0.28 + (mode === 'fall' ? 0 : 0);
      const px = -0.08 - 0.12 * st.heave - 0.04 * sw;
      const py = 0.74 - 0.07 * w - 0.05 * st.heave - 0.05 * tired + Math.abs(sw) * 0.03;
      const sx = px - 0.5 * Math.sin(a);
      const reach = 0.52 - 0.13 * st.heave + 0.06 * w + sw * 0.1;
      const ly = (ropeY(x0 + st.dir * 0.2) - 0 + Math.sin(t * 40) * 0.004 * st.heave);
      const gripY = v.hold ? GRIP_Y : ly;
      P = {
        a, px, py, footF: [0.26 + 0.07 * st.heave, 0], footB: [-0.56 - 0.1 * st.heave, 0],
        handF: [sx + reach + 0.1, gripY + 0.02 * sw], handB: [sx + reach - 0.1, gripY - 0.015],
        mouth: clamp(st.heave * 1.2 + (st.stumbleT < 0.9 ? 0.6 : 0) + 0.15, 0, 1), nod: 0.1 * w, turn: 0.5, flutter: 0.4 * st.heave + 0.1 * Math.sin(t * 9), elbowDir: -1
      };
      if (mode === 'fall') {
        // 엎어지는 중에도 팔은 줄을 향해 뻗음
        P.a = 0.1;
        P.handF = [0.75, ry > 0.5 ? 0.25 : 0.9];
        P.handB = [0.55, ry > 0.5 ? 0.2 : 0.85];
        P.mouth = 0.8;
        P.py = 0.7;
      }
    }
    p.pose(P);
    const r = p.root;
    // 쓰러짐: 발끝 기준으로 앞(깃발 쪽)으로 90도 가까이 엎어짐
    const f = ease(clamp(st.fall, 0, 1));
    r.rotation.z = -f * 1.42;
    r.position.set(x0, (mode === 'cheer' ? 0 : 0) + f * 0.08, st.z);
    if (mode === 'fall') r.position.x += st.dir * f * 0.9;
    r.visible = true;
    return P;
  }

  // ---------- 밧줄 그리기 ----------
  function drawRope(v) {
    const segs = rope.userData.segs;
    const n = segs.length;
    let xL = -4, xR = 4;
    for (const m of members.values()) {
      const x = rootX(m, S.flagX);
      xL = Math.min(xL, x - 0.4);
      xR = Math.max(xR, x + 0.4);
    }
    xL -= 0.9;
    xR += 0.9;
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const x0 = lerp(xL, xR, i / n), x1 = lerp(xL, xR, (i + 1) / n);
      a.set(x0, ropeY(x0), 0);
      b.set(x1, ropeY(x1), 0);
      const s = segs[i];
      const d = b.clone().sub(a);
      const len = d.length();
      s.position.copy(a).addScaledVector(d, 0.5);
      s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      s.scale.set(1, len * 1.04, 1);
      s.rotateY(i * 1.3);
    }
    knots[0].position.set(xL, ropeY(xL), 0);
    knots[1].position.set(xR, ropeY(xR), 0);
    flag.position.set(S.flagX, ropeY(S.flagX) + 0.02, 0);
    const cl = flag.userData.cloth;
    const pos = cl.geometry.attributes.position;
    const base = flag.userData.base;
    for (let i = 0; i < pos.count; i++) {
      const y = base[i * 3 + 1];
      const f = (0.39 - y) / 0.78; // 줄에 가까울수록 0
      pos.setZ(i, Math.sin(S.time * 4 + base[i * 3] * 5 + y * 3) * 0.06 * f * (1 + S.beatPulse));
    }
    pos.needsUpdate = true;
    const side = v.leftTeam === 'blue' ? 1 : 1;
    ribbons.left.position.set(S.flagX - 1.0, ropeY(S.flagX - 1.0) + 0.02, 0);
    ribbons.right.position.set(S.flagX + 1.0, ropeY(S.flagX + 1.0) + 0.02, 0);
  }

  function recolorRibbons(leftTeam) {
    for (const [r, tm] of [[ribbons.left, leftTeam], [ribbons.right, leftTeam === 'blue' ? 'white' : 'blue']]) {
      const col = tm === 'blue' ? '#2f6fe4' : '#e0332c';
      r.traverse((o) => { if (o.material && o.material.color) o.material.color.set(col); });
    }
  }

  // ---------- 카메라 ----------
  const look = new THREE.Vector3();
  function placeCamera(dt, v) {
    const aspect = camera.aspect;
    const vfov = S.fov * Math.PI / 180;
    const tanH = Math.tan(vfov / 2) * aspect;
    const need = 4.2 + size * 1.08 + (S.mode === 'lobby' ? 0.5 : 0);
    const baseDist = clamp(need / tanH, 9, 34);
    const target = S.mode === 'lobby' ? 0 : S.flagX;
    S.camX += (target - S.camX) * Math.min(1, dt * 3);
    S.punch = Math.max(0, S.punch - dt * 1.6);
    S.shake = Math.max(0, S.shake - dt * 3.2);
    const dist = baseDist * (1 - 0.2 * ease(clamp(S.punch, 0, 1)));
    S.dist += (dist - S.dist) * Math.min(1, dt * 6);
    let cx = S.camX - 1.4, cy = 2.05, cz = S.dist;
    let ly = 1.55;
    if (S.mode === 'over') S.orbit += dt * 0.12;
    if (S.mode === 'lobby') {
      S.orbit += dt * 0.12;
      cx = S.camX + Math.sin(S.orbit) * 4.5;
      cz = S.dist * (0.96 + Math.cos(S.orbit * 0.7) * 0.04);
      cy = 2.1 + Math.sin(S.orbit * 0.8) * 0.3;
    }
    if (S.mode === 'over') {
      // 결과 화면: 위쪽 카드를 피해 사람들이 아래쪽에 오도록 시선을 올림
      cx = S.camX + Math.sin(S.orbit * 0.5) * 1.6;
      cy = 1.5;
      cz = S.dist * 1.0;
      ly = 3.3;
    }
    const sh = S.shake;
    camera.position.set(cx + (Math.random() - 0.5) * sh * 0.25, cy + (Math.random() - 0.5) * sh * 0.18, cz);
    look.set(S.camX + (S.mode === 'lobby' ? Math.sin(S.orbit) * -1.5 : 0), ly + (S.mode === 'run' ? 0.05 : 0), 0);
    camera.lookAt(look);
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- 매 프레임 ----------
  const _p = new THREE.Vector3();
  function update(dt, v) {
    S.time += dt;
    Object.assign(S, { mode: v.mode, toPull: v.toPull ?? 9 });
    // 깃발 위치: 목표로 부드럽게(줄이 끌려오는 느낌)
    const target = v.flagX;
    const dx = target - S.flagX;
    S.flagX += dx * Math.min(1, dt * 5.5);
    S.beatPulse = Math.max(0, S.beatPulse - dt * 4);
    S.ropeWave = Math.max(0, S.ropeWave - dt * 1.6);
    S.cheer += ((v.cheer ?? 0.2) - S.cheer) * Math.min(1, dt * 2);
    S.ropeDrop += ((v.ropeDrop ?? 0) - S.ropeDrop) * Math.min(1, dt * 3.5);
    S.fov += ((v.fov ?? 34) - S.fov) * Math.min(1, dt * 5);
    if (Math.abs(camera.fov - S.fov) > 0.01) { camera.fov = S.fov; camera.updateProjectionMatrix(); }
    // 사람
    for (const m of members.values()) {
      m.windupIn = v.timeToPull - (v.braceTeam === layout[m.side].team ? 99 : 0);
      m.tired = clamp(1 - (v.stamina && v.stamina[m.id] != null ? v.stamina[m.id] : 1), 0, 1);
      if (v.mode === 'lobby' || v.mode === 'intro') m.mood = 'idle';
      else if (v.mode === 'run' && m.mood === 'idle') m.mood = 'pull';
      if (v.braceTeam && v.braceTeam === layout[m.side].team) m.windupIn = 99;
      pose(m, dt, v);
    }
    drawRope(v);
    // 먼지 · 꽃가루
    for (const p of puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      const k = 1 - p.life / p.max;
      p.s.position.x += p.vx * dt;
      p.s.position.y += p.vy * dt;
      p.s.position.z += p.vz * dt;
      p.vy *= 0.97;
      p.s.scale.setScalar(p.size * (1 + k * 1.8));
      p.s.material.opacity = 0.55 * (1 - k) * Math.min(1, k * 8);
    }
    let cn = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc1 = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < conf.length; i++) {
      const c = conf[i];
      if (c.life > 0) {
        c.life -= dt;
        c.p.addScaledVector(c.v, dt);
        c.v.y = Math.max(-1.1, c.v.y - dt * 0.3);
        c.v.x += Math.sin(S.time * 3 + i) * dt * 0.6;
        c.r.x += c.rv.x * dt; c.r.y += c.rv.y * dt; c.r.z += c.rv.z * dt;
        if (c.p.y < 0.03) c.life = 0;
        q.setFromEuler(c.r);
        m4.compose(c.p, q, sc1);
      } else m4.makeScale(0, 0, 0);
      confMesh.setMatrixAt(i, m4);
      cn = conf.length;
    }
    confMesh.count = cn;
    confMesh.instanceMatrix.needsUpdate = true;
    // 구령 담당
    hit.l = Math.max(0, hit.l - dt * 5);
    hit.r = Math.max(0, hit.r - dt * 5);
    const cp = caller;
    const bob = Math.sin(S.time * 2.2) * 0.01;
    cp.pose({
      a: 0.08, px: -0.02, py: 0.84 + bob, footF: [0.12, 0], footB: [-0.18, 0],
      handF: [0.78, 0.98 + 0.3 * hit.l], handB: [0.74, 0.98 + 0.3 * hit.r], mouth: hit.l > 0.5 || hit.r > 0.5 ? 0.9 : 0.25, nod: 0, turn: 0.2, elbowDir: -1
    });
    const sticks = callerGroup.userData.sticks;
    cp.rig.updateMatrixWorld(true);
    sticks.forEach((s, i) => {
      const hand = cp.arms[i].hand;
      s.position.copy(hand.position).add(new THREE.Vector3(0.05, 0.0, 0));
      s.rotation.set(0, 0, 1.2 + (i ? 0.1 : -0.1));
    });
    const drum = callerGroup.userData.drum;
    drum.scale.setScalar(1 + S.beatPulse * 0.04);
    // 환경 움직임
    bunting.userData.update(S.time);
    crowd.userData.update(S.time, S.cheer);
    school.userData.cloth.rotation.y = Math.sin(S.time * 2.4) * 0.35;
    for (const c of scene.children) if (c.isSprite && c.userData.v) c.position.x += c.userData.v * dt;
    placeCamera(dt, v);
  }

  // ---------- 바깥에서 부르는 것들 ----------
  function pull(id, power = 0.7, j = 'good') {
    const m = members.get(id);
    if (!m) return;
    m.heaveT = 0;
    m.pw = clamp(power, 0.2, 1);
    if (j === 'miss' || j === 'off') { if (j === 'miss') { m.stumbleT = 0; } }
    const x = rootX(m, S.flagX);
    const dust = j === 'perfect' ? 5 : j === 'good' ? 3 : 2;
    puff(x - m.dir * 0.5, 0.08, 0.3, dust, m.pw);
    if (m.def && !m.def.cpu) S.beatPulse = Math.max(S.beatPulse, 0.3);
  }
  function stumble(id) {
    const m = members.get(id);
    if (m) m.stumbleT = 0;
  }
  function teamRumble(team, k = 1) {
    for (const m of members.values()) if (layout[m.side].team === team) { m.heaveT = Math.min(m.heaveT, 0.0); m.pw = Math.max(m.pw, 0.9 * k); puff(rootX(m, S.flagX) - m.dir * 0.5, 0.08, 0.3, 3, 1); }
  }
  function callerBeat(kind) {
    if (kind === 'pull') { hit.l = 1; hit.r = 1; } else if (kind === 'one') hit.l = 0.8; else if (kind === 'two') hit.r = 0.8;
    S.beatPulse = 1;
  }
  function setMood(team, mood) {
    for (const m of members.values()) if (layout[m.side].team === team) { m.mood = mood; if (mood === 'cheer') m.cheerT = Math.random(); }
  }
  function celebrate(winnerTeam) {
    for (const m of members.values()) {
      const win = layout[m.side].team === winnerTeam;
      m.mood = win ? 'cheer' : 'fall';
      m.cheerT = Math.random() * 2;
    }
    const wm = [...members.values()].find((m) => layout[m.side].team === winnerTeam);
    confetti(wm ? rootX(wm, S.flagX) : 0, 120);
  }
  function resetMood() { for (const m of members.values()) { m.fall = 0; m.mood = 'pull'; } }
  function rootOf(id) {
    const m = members.get(id);
    return m ? rootX(m, S.flagX) : 0;
  }
  function headScreen(id, dy = 0.5) {
    const m = members.get(id);
    if (!m) return null;
    const pos = m.puller.headWorld(_p);
    _p.y += dy;
    _p.project(camera);
    return { x: (_p.x * 0.5 + 0.5) * window.innerWidth, y: (-_p.y * 0.5 + 0.5) * window.innerHeight, ok: _p.z < 1 };
  }
  function worldScreen(x, y, z = 0) {
    _p.set(x, y, z).project(camera);
    return { x: (_p.x * 0.5 + 0.5) * window.innerWidth, y: (-_p.y * 0.5 + 0.5) * window.innerHeight, ok: _p.z < 1 };
  }
  function render() { renderer.render(scene, camera); }
  function snapFlag(x) { S.flagX = x; S.flagTarget = x; }

  return {
    renderer, scene, camera, S, members, layout,
    setTeams, update, render, pull, stumble, teamRumble, callerBeat, celebrate, setMood, resetMood, recolorRibbons, puff, confetti,
    punch: (k = 1) => { S.punch = Math.max(S.punch, k); },
    shake: (k = 1) => { S.shake = Math.max(S.shake, k); },
    ropeWave: (k = 1) => { S.ropeWave = Math.max(S.ropeWave, k); },
    snapFlag, rootOf, headScreen, worldScreen, setScore: (b, w) => tent.userData.setScore(b, w),
    get size() { return size; }
  };
}
