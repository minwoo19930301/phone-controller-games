// 탁구 장면: 경기장과 테이블 두 개(A·B)를 한 번 만들고, 화면 분할(뷰포트)마다 다른 카메라로 그립니다.
// 렌더러 하나로 setViewport/setScissor 를 바꿔 가며 그립니다. 그림자는 프레임마다 한 번만 계산합니다.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TABLE, BALL_R } from './physics.js';
import { makePaddle, makeBall, makeBlob, makeTrail, layoutTrail, makeTable, makeScoreboard, makeArena, glowTex } from './models.js';

export const TABLE_X = { A: 0, B: 6 };
export const ARENA_CX = (TABLE_X.A + TABLE_X.B) / 2;

export function createScene(cv) {
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#04060b');
  scene.fog = new THREE.Fog('#05080f', 20, 52);
  // 반짝임(공·러버·테이블 광택)용 주변 반사. 실내라 아주 약하게.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.16;

  const arena = makeArena([TABLE_X.A, TABLE_X.B]);
  scene.add(arena.group);

  // ---------- 조명: 테이블마다 위에서 내리꽂는 스포트라이트(그림자) + 넓게 퍼지는 보조광 ----------
  scene.add(new THREE.HemisphereLight('#8ea3c8', '#2a1712', 0.32));
  for (const tx of Object.values(TABLE_X)) {
    const key = new THREE.SpotLight('#fff2df', 230, 0, 0.5, 0.75, 2);
    key.position.set(tx, 7.2, 0);
    key.target.position.set(tx, TABLE.y, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 3.5;
    key.shadow.camera.far = 9;
    key.shadow.bias = -0.00015;
    key.shadow.normalBias = 0.012;
    scene.add(key, key.target);
    const fill = new THREE.SpotLight('#dfe8ff', 70, 0, 0.95, 1, 2);
    fill.position.set(tx, 9.5, 0.5);
    fill.target.position.set(tx, 0, 0);
    scene.add(fill, fill.target);
  }
  // 관중석을 은은하게
  for (const sz of [-1, 1]) {
    const s = new THREE.SpotLight('#b9c8ff', 40, 0, 0.75, 1, 2);
    s.position.set(ARENA_CX, 11, sz * 6);
    s.target.position.set(ARENA_CX, 1.5, sz * 12);
    scene.add(s, s.target);
  }

  // ---------- 테이블, 점수판, 공 ----------
  const tables = {};
  for (const [id, tx] of Object.entries(TABLE_X)) {
    const tg = makeTable();
    tg.position.x = tx;
    scene.add(tg);
    const board = makeScoreboard();
    board.group.position.set(tx - 1.62, 0, 0);
    scene.add(board.group);
    board.setNames('1P', '#ff5a5f', '2P', '#3ab4ff');
    board.setScore(0, 0, false);
    const ball = makeBall();
    ball.visible = false;
    const blob = makeBlob();
    blob.visible = false;
    const trail = makeTrail(18);
    trail.visible = false;
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    flash.visible = false;
    scene.add(ball, blob, trail, flash);
    tables[id] = { group: tg, board, ball, blob, trail, flash, flashT: 0, tx };
  }

  // ---------- 라켓 ----------
  const paddles = new Map();
  function setPaddles(list) {
    const keep = new Set(list.map((p) => p.key));
    for (const [k, p] of paddles) {
      if (!keep.has(k)) {
        scene.remove(p.group);
        p.group.userData.dispose();
        paddles.delete(k);
      }
    }
    for (const p of list) {
      const cur = paddles.get(p.key);
      if (cur && cur.color === p.color && cur.label === p.label) continue;
      if (cur) {
        scene.remove(cur.group);
        cur.group.userData.dispose();
      }
      const group = makePaddle(p.color, p.label);
      group.visible = false;
      scene.add(group);
      paddles.set(p.key, { group, color: p.color, label: p.label });
    }
  }
  function posePaddle(key, pos, quat, visible = true) {
    const p = paddles.get(key);
    if (!p) return;
    p.group.visible = visible;
    p.group.position.set(pos[0], pos[1], pos[2]);
    p.group.quaternion.copy(quat);
  }

  // ---------- 공 ----------
  const _q = new THREE.Quaternion();
  const _ax = new THREE.Vector3();
  function setBall(id, b) {
    const t = tables[id];
    if (!b || !b.visible) {
      t.ball.visible = false;
      t.blob.visible = false;
      t.trail.userData.pts = [];
      t.trail.visible = false;
      return;
    }
    const [x, y, z] = b.pos;
    t.ball.visible = true;
    t.ball.position.set(x, y, z);
    // 회전: 축과 이번 프레임에 돈 각도
    if (b.spinAngle) {
      _ax.set(b.spinAxis[0], b.spinAxis[1], b.spinAxis[2]);
      if (_ax.lengthSq() > 1e-9) {
        _ax.normalize();
        _q.setFromAxisAngle(_ax, b.spinAngle);
        t.ball.quaternion.premultiply(_q);
      }
    }
    // 바로 아래 그림자: 테이블 위면 테이블에, 아니면 바닥에
    const lx = x - t.tx;
    const onTable = Math.abs(lx) <= TABLE.halfW && Math.abs(z) <= TABLE.halfL && y >= TABLE.y;
    const gy = onTable ? TABLE.y : 0;
    const h = Math.max(0, y - BALL_R - gy);
    t.blob.visible = true;
    t.blob.position.set(x, gy + 0.0015, z);
    const s = BALL_R * 2.3 + h * 0.06;
    t.blob.scale.set(s, s, 1);
    t.blob.material.opacity = Math.max(0.12, 0.85 - h * 0.9);
    t.trail.userData.pts = b.trail || [];
  }

  function flash(id, pos, strong) {
    const t = tables[id];
    t.flash.position.set(pos[0], pos[1], pos[2]);
    t.flash.visible = true;
    t.flashT = strong ? 1.25 : 0.8;
  }

  function setScore(id, s0, s1, animate) {
    tables[id].board.setScore(s0, s1, animate);
  }
  function setNames(id, n0, c0, n1, c1) {
    tables[id].board.setNames(n0, c0, n1, c1);
  }

  // ---------- 카메라와 화면 분할 ----------
  const cams = [0, 1, 2, 3, 4].map(() => new THREE.PerspectiveCamera(55, 1, 0.03, 140));
  const rects = [];
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  }
  window.addEventListener('resize', resize);
  resize();

  /**
   * views: [{ x, y, w, h (CSS px, 왼쪽 위 기준), pos:[..], look:[..], fov, roll }]
   */
  function render(views) {
    const H = window.innerHeight;
    renderer.shadowMap.needsUpdate = true;
    renderer.setScissorTest(true);
    rects.length = 0;
    views.forEach((v, i) => {
      const cam = cams[i];
      cam.aspect = Math.max(0.1, v.w / Math.max(1, v.h));
      cam.fov = v.fov || 55;
      cam.position.set(v.pos[0], v.pos[1], v.pos[2]);
      cam.up.set(Math.sin(v.roll || 0), Math.cos(v.roll || 0), 0);
      cam.lookAt(v.look[0], v.look[1], v.look[2]);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      for (const t of Object.values(tables)) if (t.ball.visible) layoutTrail(t.trail, cam.position);
      const y = H - v.y - v.h;
      renderer.setViewport(v.x, y, v.w, v.h);
      renderer.setScissor(v.x, y, v.w, v.h);
      renderer.render(scene, cam);
      rects[i] = v;
    });
    renderer.setScissorTest(false);
  }

  const _p = new THREE.Vector3();
  const _r = new THREE.Vector3();
  /** 뷰포트 i 에서 세계 좌표 p 가 보이는 곳(뷰포트 안 CSS px)과 공 반지름(px) */
  function project(i, p) {
    const cam = cams[i];
    const v = rects[i];
    if (!v) return null;
    _p.set(p[0], p[1], p[2]).project(cam);
    const behind = _p.z > 1;
    _r.setFromMatrixColumn(cam.matrixWorld, 0).multiplyScalar(BALL_R).add(new THREE.Vector3(p[0], p[1], p[2])).project(cam);
    const x = (_p.x * 0.5 + 0.5) * v.w;
    const y = (-_p.y * 0.5 + 0.5) * v.h;
    const rx = (_r.x * 0.5 + 0.5) * v.w;
    const ry = (-_r.y * 0.5 + 0.5) * v.h;
    return { x, y, r: Math.hypot(rx - x, ry - y), behind };
  }

  function update(dt, now) {
    arena.update(now / 1000);
    for (const t of Object.values(tables)) {
      t.board.update(dt);
      if (t.flash.visible) {
        t.flashT -= dt * 4.5;
        if (t.flashT <= 0) {
          t.flash.visible = false;
        } else {
          t.flash.material.opacity = Math.min(1, t.flashT);
          const s = 0.06 + (1.3 - t.flashT) * 0.22;
          t.flash.scale.set(s, s, 1);
        }
      }
    }
  }

  return { render, project, update, setPaddles, posePaddle, setBall, flash, setScore, setNames, renderer, scene };
}
