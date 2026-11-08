// 파인 파크랜드: 키 큰 소나무 숲 사이 잘 다듬은 잔디, 개울과 연못, 하얀 모래 벙커. 한낮의 맑은 날씨.
import { blob, capsule, strip, fbm } from './core.js';

const bk = (x, z, rx, rz, rot = 0, seed = 1, type) => ({ s: blob(x, z, rx, rz, rot, 0.14, seed), type });

export default {
  id: 'pines',
  name: '파인 파크랜드',
  en: 'Pine Parkland',
  theme: 'parkland',
  blurb: '키 큰 소나무 숲 사이 넓은 페어웨이. 개울과 연못을 넘겨야 해요.',
  rating: 1,
  surfaceNames: { deep: '숲 언저리' },
  env: {
    timeOfDay: '한낮',
    sky: { turbidity: 3.2, rayleigh: 1.6, mie: 0.004, mieG: 0.82, elevation: 52, azimuth: 205 },
    sun: { color: '#fff4e2', intensity: 3.3 },
    hemi: { sky: '#d6e9ff', ground: '#4b6a33', intensity: 0.9 },
    fog: { color: '#bcd2e4', near: 320, far: 1900 },
    exposure: 0.6,
    clouds: { n: 14, opacity: 0.8, y: [240, 460] },
    wind: { min: 0, max: 4, gust: 0.2, dir: 200 }
  },
  palette: {
    deep: '#3f6e2c', deep2: '#5a5232', rough: '#4f8634', fairway: '#62a43e', fairway2: '#589a37', fringe: '#5fa640',
    green: '#6db84c', green2: '#66b046', tee: '#64a843', tee2: '#5a9d3b', sand: '#f1ead6', sandDark: '#c9bd9c',
    waste: '#a89a74', beach: '#d8cfb2', wetSand: '#8a7f5f', bed: '#3e5440', water: '#2d6c80', path: '#b9b5ab',
    ob: '#4a3a2a', tree: '#1f3d1a', straw: '#7a5d3a'
  },
  terrain: {
    roughMargin: 10,
    flatten: 0.85,
    bowl: 0.045,
    relief: (x, z, s) => 3.2 * fbm(x * 0.011, z * 0.011, 3, s) + 1.0 * fbm(x * 0.04, z * 0.04, 2, s + 4),
    micro: (x, z, s) => 0.38 * fbm(x * 0.032, z * 0.03, 3, s + 7)
  },
  far: { kind: 'forest' },
  dress(hole, sc) {
    const out = [];
    out.push(...sc({ kind: 'tallpine', n: 620, cd: [2.5, 400], gap: 5.2, s: [0.8, 1.2], clump: [7, 18], margin: 110 }));
    out.push(...sc({ kind: 'oak', n: 90, cd: [4, 300], gap: 7, s: [0.75, 1.15], clump: [2, 14], margin: 90 }));
    out.push(...sc({ kind: 'pine', n: 160, cd: [2, 200], gap: 4, s: [0.6, 1.0], clump: [4, 12], margin: 60 }));
    out.push(...sc({ kind: 'shrub', n: 260, cd: [0.5, 60], gap: 1.6, s: [0.6, 1.3], clump: [5, 5], margin: 40 }));
    return out;
  },
  holes: [
    {
      name: '솔숲 도그레그',
      en: 'Pine Corner',
      sub: '왼쪽으로 꺾이는 파4. 모퉁이 소나무를 넘기면 그린이 가까워져요.',
      par: 4,
      tees: { hard: [0, -14], normal: [0, 0], easy: [0, 32] },
      route: [[0, 0], [-3, 222], [52, 336]],
      fairway: [capsule(0, 45, -3, 150, 13, 15, 0.1, 1), capsule(-3, 150, -1, 238, 17, 18, 0.1, 2), capsule(-1, 238, 46, 322, 15, 13, 0.12, 3)],
      green: { at: [52, 336], rx: 14, rz: 13, rot: 35, tilt: [0.004, 0.021], bumps: [[-3, 2, 4, 0.12]] },
      pins: [[52, 337], [57, 343], [47, 330]],
      bunkers: [bk(-24, 236, 7.5, 4, 20, 1), bk(-16, 258, 4, 3, 0, 2), bk(67, 324, 6, 3.4, 40, 3), bk(38, 349, 5, 3.2, -30, 4), bk(61, 353, 4, 2.8, 10, 5)],
      paths: [[[-8, -10], [-30, 40], [-35, 150], [-37, 240], [-14, 300], [26, 364], [74, 374], [100, 380]]],
      elev: [[0, 0, 2.5], [-3, 222, 0.6], [52, 336, 2.2], [80, 180, 6], [-60, 200, 4]],
      bounds: { x0: -75, x1: 112, z0: -35, z1: 400 },
      extras: [{ kind: 'bench', x: -9, z: -9, rot: 0.3 }, { kind: 'flowerbed', x: 8, z: -11, rot: 0 }]
    },
    {
      name: '개울 건너',
      en: 'Creek Crossing',
      sub: '가운데 개울이 가로지르는 파5. 티샷은 개울 앞에 두고, 두 번째에 넘기세요.',
      par: 5,
      tees: { hard: [0, -16], normal: [0, 0], easy: [-2, 42] },
      route: [[0, 0], [2, 228], [-16, 405], [-24, 468]],
      fairway: [capsule(0, 50, 2, 160, 13, 16, 0.1, 4), capsule(2, 160, 3, 252, 18, 16, 0.1, 5), capsule(-2, 304, -14, 405, 16, 18, 0.1, 6), capsule(-14, 405, -22, 455, 15, 12, 0.12, 7)],
      green: { at: [-24, 468], rx: 13, rz: 15, rot: -10, tilt: [-0.008, 0.016], tiers: [[0, 4, 0.28, 4.5]] },
      pins: [[-24, 461], [-22, 478], [-30, 466]],
      bunkers: [bk(17, 385, 6, 3.5, -20, 1), bk(-35, 413, 5, 3, 10, 2), bk(-7, 456, 5, 3, 30, 3), bk(-39, 471, 4.5, 3.2, -10, 4), bk(-21, 488, 6, 2.6, 0, 5)],
      water: [{ shape: strip([[-110, 300], [-50, 291], [-10, 284], [30, 278], [70, 268], [120, 264]], 2.5), y: -0.55, kind: 'creek', name: '개울', depth: 0.9, bank: 6, bankSlope: 0.2 }],
      paths: [[[-8, -8], [-26, 60], [-30, 200], [-36, 289], [-40, 360], [-50, 440], [-36, 494], [-10, 505]]],
      elev: [[0, 0, 1.5], [2, 228, 1.0], [0, 282, 0.1], [-16, 405, 1.8], [-24, 468, 3.0], [60, 300, 4], [-70, 200, 5]],
      bounds: { x0: -82, x1: 85, z0: -35, z1: 520 },
      extras: [{ kind: 'bench', x: 10, z: -10, rot: -0.3 }]
    },
    {
      name: '연못 앞 그린',
      en: 'Pond Carry',
      sub: '연못을 넘겨 치는 파3. 그린 앞이 연못 쪽으로 기울어 있어요.',
      par: 3,
      tees: { hard: [0, -14], normal: [0, 0], easy: [1, 28] },
      route: [[0, 0], [-6, 150]],
      fairway: [capsule(0, 34, -2, 74, 10, 12, 0.1, 8), capsule(-3, 124, -5, 133, 10, 10, 0.08, 9)],
      green: { at: [-6, 150], rx: 14, rz: 12, rot: 8, tilt: [0.005, 0.019], bumps: [[5, 3, 3, 0.1]] },
      pins: [[-6, 151], [-1, 155], [-11, 147]],
      bunkers: [bk(-21, 156, 5, 3, -20, 1), bk(10, 161, 4.5, 3, 20, 2)],
      water: [{ shape: blob(-2, 104, 24, 14, 10, 0.1, 2), y: -0.45, kind: 'pond', name: '연못', depth: 1.4, bank: 6, bankSlope: 0.16 }],
      paths: [[[9, -7], [24, 40], [34, 110], [22, 172], [2, 186]]],
      elev: [[0, 0, 6.0], [0, 40, 3.2], [-6, 150, 1.8], [-2, 104, 0.4], [50, 80, 5], [-50, 90, 4]],
      bounds: { x0: -62, x1: 64, z0: -30, z1: 200 },
      extras: [{ kind: 'fountain', x: -2, z: 104 }, { kind: 'flowerbed', x: -9, z: -10, rot: 0.2 }, { kind: 'bench', x: 10, z: -8, rot: -0.2 }]
    }
  ]
};
