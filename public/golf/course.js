// 파3 한 홀의 지형과 표면. 그리기(scene.js)와 공 굴리기(game.js)가 같은 함수를 씁니다.
// 좌표: 티 = 원점, +z = 그린 쪽, +x = 왼쪽(티 뒤에서 그린을 볼 때), 단위 m.

export const PIN = { x: -4, z: 146 };
export const TEE_H = 2.4;
export const AREA = { x0: -110, x1: 110, z0: -40, z1: 200 };

const RD = Math.PI / 180;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (e0, e1, v) => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

// 타원 모양 영역. 가장자리를 살짝 울퉁불퉁하게 해서 손으로 깎은 느낌을 줍니다.
function blob(cx, cz, rx, rz, rot, wob, seed) {
  const c = Math.cos(rot * RD);
  const s = Math.sin(rot * RD);
  return (x, z) => {
    const dx = x - cx;
    const dz = z - cz;
    const u = (dx * c - dz * s) / rx;
    const v = (dx * s + dz * c) / rz;
    const th = Math.atan2(v, u);
    const k = 1 + wob * (Math.sin(3 * th + seed) * 0.6 + Math.sin(5 * th + seed * 2) * 0.4);
    return Math.hypot(u, v) / k; // 1 보다 작으면 안쪽
  };
}

const green = blob(-3, 145, 14, 10.5, 18, 0.07, 1.3);
const pond = blob(13, 100, 17, 13, -25, 0.1, 0.4);
const bunkers = [
  blob(-15, 135, 5.2, 3.2, 30, 0.12, 2.1),
  blob(11.5, 148, 3.6, 6.2, -10, 0.12, 0.7),
  blob(-6, 159.5, 6.5, 2.4, 5, 0.1, 3.3),
  blob(-14, 96, 3.8, 6.5, 12, 0.14, 1.9)
];
const fairwayCenter = (z) => -3 + 6 * Math.sin(z * 0.03);
const fairwayHalf = (z) => (13 + 4 * Math.sin(z * 0.05)) * smooth(52, 64, z) * (1 - smooth(132, 140, z));

export function inTee(x, z) {
  return Math.abs(x) < 5 && z > -6 && z < 7;
}

export function surface(x, z) {
  if (inTee(x, z)) return 'tee';
  if (pond(x, z) < 1) return 'water';
  for (const b of bunkers) if (b(x, z) < 1) return 'bunker';
  const g = green(x, z);
  if (g < 1) return 'green';
  if (g < 1.18) return 'fringe';
  if (Math.abs(x - fairwayCenter(z)) < fairwayHalf(z)) return 'fairway';
  if (Math.abs(x) > 62 || z > 190 || z < -30) return 'trees';
  return 'rough';
}

export function height(x, z) {
  let h = 0.55 * Math.sin(x * 0.045 + 0.5) * Math.cos(z * 0.03) + 0.35 * Math.sin(z * 0.07 + 1.1);
  // 홀을 둘러싼 언덕
  h += Math.max(0, Math.abs(x) - 42) * 0.09 + Math.max(0, z - 168) * 0.14 + Math.max(0, -z - 12) * 0.05;
  // 높인 티잉 그라운드
  const tx = 1 - smooth(5, 9, Math.abs(x));
  const tz = (1 - smooth(6, 11, z)) * smooth(-11, -6, z);
  h = h + (TEE_H - h) * tx * tz;
  // 그린은 평평하게, 뒤가 살짝 높게
  const g = green(x, z);
  const gw = 1 - smooth(1.0, 1.45, g);
  const gh = 0.45 + (z - 145) * 0.018 + (x + 3) * 0.006;
  h = h + (gh - h) * gw;
  // 벙커와 연못은 파냅니다
  for (const b of bunkers) h -= 0.5 * (1 - smooth(0.75, 1.08, b(x, z)));
  h -= 1.6 * (1 - smooth(0.7, 1.12, pond(x, z)));
  return h;
}

export const WATER_Y = -0.55;

export function slope(x, z) {
  const e = 0.25;
  return [(height(x + e, z) - height(x - e, z)) / (2 * e), (height(x, z + e) - height(x, z - e)) / (2 * e)];
}

export const pinHeight = () => height(PIN.x, PIN.z);

// 나무 위치(같은 씨앗이면 늘 같은 자리)
export function treeSpots() {
  let a = 1337;
  const rnd = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [];
  for (let i = 0; i < 3000 && out.length < 520; i++) {
    const x = AREA.x0 + rnd() * (AREA.x1 - AREA.x0);
    const z = -30 + rnd() * 225;
    const s = surface(x, z);
    const edge = Math.abs(x - fairwayCenter(z));
    // 페어웨이에서 떨어진 러프 바깥쪽과 숲에만 심습니다.
    const ok = s === 'trees' || (s === 'rough' && edge > 34 && green(x, z) > 2.2 && pond(x, z) > 1.5 && !(Math.abs(x) < 16 && z < 20));
    if (!ok) continue;
    const pine = rnd() < 0.45;
    out.push({ x, z, y: height(x, z), pine, s: 0.8 + rnd() * 0.6, r: rnd() * Math.PI * 2, tint: rnd() });
  }
  return out;
}
