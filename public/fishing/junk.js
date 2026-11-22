// 꽝: 가까이 던졌다 감아 올릴 때 가끔 딸려 오는 물건(낡은 장화·빈 깡통·거북이).
// 모양은 three.js 기본 도형으로 만들고, 크기는 m 단위입니다(원점 = 줄에 매달린 곳).
import * as THREE from 'three';

export const JUNK = {
  boot: { name: '낡은 장화', sub: '꽝! 물에 빠진 장화가 올라왔어요', keep: true },
  can: { name: '빈 깡통', sub: '꽝! 누가 버린 깡통이에요', keep: true },
  turtle: { name: '거북이', sub: '거북이가 올라왔어요! 살살 놓아 줄게요', keep: false }
};
const KINDS = Object.keys(JUNK);
export const pickJunk = (rand = Math.random) => KINDS[Math.floor(rand() * KINDS.length) % KINDS.length];

function std(color, rough = 0.7, metal = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function boot() {
  const g = new THREE.Group();
  const rubber = std('#3b3f2a', 0.85);
  const sole = std('#1d1d1b', 0.9);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.065, 0.3, 16), rubber);
  shaft.position.set(0, -0.17, 0);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.24), rubber);
  foot.position.set(0, -0.33, 0.06);
  const toe = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), rubber);
  toe.scale.set(0.95, 0.75, 1);
  toe.position.set(0, -0.33, 0.18);
  const s = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 0.28), sole);
  s.position.set(0, -0.385, 0.07);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 8, 20), rubber);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -0.02;
  g.add(shaft, foot, toe, s, rim);
  return g;
}

function can() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 20), std('#b8322a', 0.45, 0.4));
  body.position.y = -0.08;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.01, 20), std('#c9ccd1', 0.3, 0.9));
  lid.position.y = -0.015;
  const base = lid.clone();
  base.position.y = -0.145;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0355, 0.0355, 0.03, 20), std('#f2f2f2', 0.5, 0.2));
  band.position.y = -0.08;
  g.add(body, lid, base, band);
  g.rotation.z = 0.5;
  return g;
}

function turtle() {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), std('#4f6b2e', 0.6));
  shell.scale.set(1, 0.55, 1.2);
  const under = new THREE.Mesh(new THREE.CircleGeometry(0.14, 20), std('#c9b77a', 0.8));
  under.rotation.x = Math.PI / 2;
  under.scale.set(1, 1.2, 1);
  const skin = std('#7c8a4a', 0.75);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), skin);
  head.position.set(0, 0.01, 0.19);
  const eyeMat = std('#111111', 0.2);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), eyeMat);
    eye.position.set(sx * 0.022, 0.025, 0.225);
    g.add(eye);
  }
  for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const leg = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), skin);
    leg.scale.set(1.4, 0.4, 0.8);
    leg.position.set(x * 0.13, -0.01, z * 0.11);
    g.add(leg);
  }
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.06, 8), skin);
  tail.rotation.x = -Math.PI / 2;
  tail.position.set(0, 0, -0.19);
  g.add(shell, under, head, tail);
  // 줄에 매달린 모습: 등껍질이 화면을 보게 세웁니다
  const holder = new THREE.Group();
  g.rotation.x = -1.2;
  g.position.y = -0.18;
  holder.add(g);
  return holder;
}

export function makeJunk(kind) {
  const obj = kind === 'boot' ? boot() : kind === 'can' ? can() : turtle();
  obj.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  obj.userData.dispose = () => obj.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return obj;
}
