// 오션 링크스: 바닷가 모래언덕, 항아리 벙커, 센 바람. 나무 없이 억센 풀과 가시금작화 덤불.
import { blob, capsule, poly, strip, fbm, ridged, vnoise } from './core.js';

const pot = (x, z, r = 2.4, seed = 1) => ({ s: blob(x, z, r, r * 0.92, seed * 40, 0.05, seed), type: 'pot' });
const bk = (x, z, rx, rz, rot = 0, seed = 1, type) => ({ s: blob(x, z, rx, rz, rot, 0.12, seed), type });
const sea = (pts) => ({ shape: poly(pts, 6, 3), y: -1.2, kind: 'sea', name: '바다', depth: 3, bank: 46, bankSlope: 0.055 });

export default {
  id: 'links',
  name: '오션 링크스',
  en: 'Ocean Links',
  theme: 'links',
  blurb: '바닷가 모래언덕 사이로 치는 코스. 바람이 세고 항아리 벙커가 깊어요.',
  rating: 3,
  surfaceNames: { deep: '모래언덕 풀숲' },
  env: {
    timeOfDay: '아침',
    sky: { turbidity: 6.5, rayleigh: 1.25, mie: 0.005, mieG: 0.8, elevation: 30, azimuth: 160 },
    sun: { color: '#fff1dc', intensity: 3.1 },
    hemi: { sky: '#dbe7f0', ground: '#7d6c48', intensity: 0.85 },
    fog: { color: '#c6d3da', near: 240, far: 2300 },
    exposure: 0.6,
    clouds: { n: 26, opacity: 0.9, y: [200, 420] },
    wind: { min: 4, max: 10, gust: 0.35, dir: 70 }
  },
  palette: {
    deep: '#a69b63', deep2: '#76874a', rough: '#7f9149', fairway: '#8eb05a', fairway2: '#82a450', fringe: '#86b35a',
    green: '#79b250', green2: '#71aa49', tee: '#8bb45c', tee2: '#7fa851', sand: '#e6d6a8', sandDark: '#b9a378',
    waste: '#d9c99c', beach: '#dccb9c', wetSand: '#a99a72', bed: '#4f6b5c', water: '#2f6f85', path: '#c9bfa6',
    ob: '#6d5a44', tree: '#4c5a2a'
  },
  terrain: {
    roughMargin: 8,
    flatten: 0.82,
    bowl: 0.01,
    // 모래언덕: 능선 잡음 + 굵은 굴곡
    relief: (x, z, s) => 5.2 * ridged(x * 0.017, z * 0.019, 3, s) + 2.2 * fbm(x * 0.045, z * 0.04, 3, s + 3) - 2.4,
    // 링크스 페어웨이는 울퉁불퉁합니다
    micro: (x, z, s) => 0.6 * fbm(x * 0.055, z * 0.05, 3, s + 7) + 0.18 * vnoise(x * 0.2, z * 0.2, s + 9)
  },
  far: { kind: 'sea', side: 1 },
  dress(hole, sc) {
    const out = [];
    out.push(...sc({ kind: 'tuft', n: 4600, cd: [1.2, 320], gap: 0.8, s: [0.7, 1.5], clump: [9, 7], margin: 70 }));
    out.push(...sc({ kind: 'gorse', n: 420, cd: [6, 260], gap: 2.4, s: [0.7, 1.6], clump: [7, 10], margin: 80 }));
    out.push(...sc({ kind: 'rock', n: 110, cd: [10, 500], gap: 2, s: [0.5, 1.8], clump: [4, 6], margin: 120, surf: ['deep', 'ob', 'water'],
      test: (x, z, i) => { const w = hole.waterLevel(x, z); return w === null ? i.y < 1.5 : i.y > w - 0.6; } }));
    return out;
  },
  holes: [
    {
      name: '등대 가는 길',
      en: 'Lighthouse Road',
      sub: '오른쪽으로 살짝 휘는 파4. 착지 지점 오른쪽 항아리 벙커를 피하세요.',
      par: 4,
      tees: { hard: [2, -16], normal: [0, 0], easy: [-3, 40] },
      route: [[0, 0], [-6, 218], [-30, 362]],
      fairway: [capsule(-1, 55, -4, 150, 12, 16, 0.12, 1), capsule(-4, 150, -8, 258, 19, 17, 0.1, 2), capsule(-8, 258, -27, 345, 15, 12, 0.12, 3)],
      green: { at: [-30, 362], rx: 13, rz: 16, rot: 12, tilt: [0.006, 0.017], tiers: [[180, 10.5, -0.22, 4]], bumps: [[4, 3, 3.5, 0.08]] },
      pins: [[-30, 364], [-35, 370], [-26, 357]],
      bunkers: [pot(-26, 205, 2.6, 1), pot(-22, 230, 2.4, 2), pot(10, 240, 2.2, 3), pot(-9, 286, 2.2, 4), pot(-17, 348, 2.5, 5), pot(-45, 360, 2.6, 6), pot(-29, 382, 2.2, 7)],
      water: [sea([[105, -400], [112, 0], [124, 150], [110, 280], [94, 400], [110, 540], [180, 620], [3000, 700], [3000, -400]])],
      elev: [[0, 0, 4.6], [-6, 218, 1.2], [-30, 362, 2.4], [55, 120, 3.5], [-62, 230, 3.2], [-6, 100, 2.2]],
      bounds: { x0: -84, x1: 140, z0: -40, z1: 410 },
      extras: [{ kind: 'lighthouse', x: 62, z: 492, rot: 0, s: 1 }, { kind: 'wall', pts: [[-88, -40], [-86, 120], [-90, 260], [-87, 410]] }]
    },
    {
      name: '절벽 위 그린',
      en: 'Cliff Top',
      sub: '바다 쪽으로 기운 파3. 왼쪽은 바다, 짧으면 모래언덕이에요.',
      par: 3,
      tees: { hard: [0, -14], normal: [0, 0], easy: [-2, 26] },
      route: [[0, 0], [12, 165]],
      fairway: [capsule(5, 108, 10, 146, 9, 11, 0.12, 4)],
      green: { at: [12, 165], rx: 12, rz: 13.5, rot: -15, tilt: [-0.015, 0.008], bumps: [[-4, 4, 3.2, 0.1]] },
      pins: [[12, 165], [7, 171], [16, 158]],
      bunkers: [pot(-1, 152, 2.4, 1), pot(-4, 171, 2.3, 2), pot(27, 178, 2.2, 3), pot(23, 150, 2.4, 4)],
      water: [sea([[110, -300], [100, 40], [72, 108], [48, 150], [54, 200], [84, 262], [160, 330], [3000, 400], [3000, -300]])],
      elev: [[0, 0, 7.5], [12, 165, 3.4], [-50, 90, 5], [2, 85, 1.6], [-40, 190, 5]],
      bounds: { x0: -70, x1: 120, z0: -30, z1: 215 },
      extras: [{ kind: 'islet', x: 210, z: 330, s: 1.2 }, { kind: 'lighthouse', x: 210, z: 330, rot: 0.6, s: 0.9, y: 6 }]
    },
    {
      name: '번 건너 롱홀',
      en: 'The Burn',
      sub: '바다를 왼쪽에 끼고 도는 파5. 290m 쯤 개울(번)을 넘고, 365m 가로 벙커를 조심하세요.',
      par: 5,
      tees: { hard: [0, -15], normal: [0, 0], easy: [2, 45] },
      route: [[0, 0], [-4, 225], [14, 402], [42, 492]],
      fairway: [capsule(0, 50, -4, 160, 13, 16, 0.12, 5), capsule(-4, 160, -4, 270, 18, 17, 0.1, 6), capsule(2, 304, 14, 405, 15, 18, 0.12, 7), capsule(14, 405, 38, 478, 15, 12, 0.12, 8)],
      green: { at: [42, 492], rx: 16, rz: 14, rot: 30, tilt: [0.004, 0.012], tiers: [[90, 0, 0.32, 4.5]] },
      pins: [[48, 494], [35, 489], [36, 499]],
      bunkers: [bk(-8, 362, 5, 1.9, 8, 1, 'pot'), bk(6, 367, 5, 1.9, -6, 2, 'pot'), pot(28, 476, 2.5, 3), pot(59, 486, 2.4, 4), pot(39, 511, 2.3, 5), pot(-24, 196, 2.4, 6)],
      water: [
        sea([[118, -300], [120, 100], [110, 300], [98, 420], [106, 560], [150, 640], [3000, 700], [3000, -300]]),
        { shape: strip([[-100, 296], [-50, 290], [-12, 293], [20, 286], [60, 289], [100, 283]], 2.3), y: -0.15, kind: 'creek', name: '번(개울)', depth: 0.8, bank: 5, bankSlope: 0.22 }
      ],
      elev: [[0, 0, 3.2], [-4, 225, 1.4], [0, 290, 0.5], [14, 402, 1.6], [42, 492, 2.3], [-60, 380, 3]],
      bounds: { x0: -80, x1: 125, z0: -40, z1: 545 },
      extras: [{ kind: 'islet', x: 250, z: 660, s: 1.4 }, { kind: 'lighthouse', x: 250, z: 660, rot: 1.2, s: 1, y: 7 }, { kind: 'wall', pts: [[-84, -40], [-82, 200], [-86, 545]] }]
    }
  ]
};
