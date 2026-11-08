// 벚꽃 밸리: 봄날 낮은 언덕, 벚꽃길과 소나무, 연못가 정자. 바람이 약하고 꽃잎이 흩날립니다.
import { blob, capsule, strip, fbm } from './core.js';

const bk = (x, z, rx, rz, rot = 0, seed = 1, type) => ({ s: blob(x, z, rx, rz, rot, 0.13, seed), type });

export default {
  id: 'blossom',
  name: '벚꽃 밸리',
  en: 'Cherry Blossom Valley',
  theme: 'blossom',
  blurb: '벚꽃길 따라 완만한 언덕을 도는 봄 코스. 연못가 정자를 지나요.',
  rating: 1,
  surfaceNames: { deep: '언덕 풀밭' },
  env: {
    timeOfDay: '봄날 오후',
    sky: { turbidity: 5.5, rayleigh: 1.5, mie: 0.005, mieG: 0.82, elevation: 38, azimuth: 215 },
    sun: { color: '#fff0e6', intensity: 3.1 },
    hemi: { sky: '#e6e4f6', ground: '#5a6e3c', intensity: 0.92 },
    fog: { color: '#e4d6dc', near: 300, far: 1800 },
    exposure: 0.62,
    clouds: { n: 18, opacity: 0.85, y: [220, 420] },
    wind: { min: 0, max: 3, gust: 0.15, dir: 160 }
  },
  palette: {
    deep: '#5c8a3c', deep2: '#6c8f46', rough: '#5f9640', fairway: '#78b04e', fairway2: '#6ea646', fringe: '#72ae4c',
    green: '#7aba56', green2: '#72b24f', tee: '#74ad4c', tee2: '#6aa244', sand: '#f2e7d0', sandDark: '#cdbd9f',
    waste: '#b7a682', beach: '#d8ccb0', wetSand: '#8a7f5f', bed: '#3f5a46', water: '#3a7c8c', path: '#cdc2b2',
    ob: '#5a4a3a', tree: '#e7a9bf', petal: '#f6c9d6'
  },
  terrain: {
    roughMargin: 10,
    flatten: 0.8,
    bowl: 0.05,
    relief: (x, z, s) => 5 * fbm(x * 0.009, z * 0.009, 3, s) + 1.1 * fbm(x * 0.035, z * 0.035, 2, s + 4),
    micro: (x, z, s) => 0.48 * fbm(x * 0.03, z * 0.028, 3, s + 7)
  },
  far: { kind: 'hills' },
  dress(hole, sc) {
    const out = [];
    out.push(...sc({ kind: 'cherry', n: 240, cd: [2, 90], gap: 6.5, s: [0.75, 1.2], clump: [4, 16], margin: 70 }));
    out.push(...sc({ kind: 'redpine', n: 320, cd: [8, 400], gap: 5.5, s: [0.75, 1.25], clump: [6, 18], margin: 110 }));
    out.push(...sc({ kind: 'cherry', n: 120, cd: [20, 300], gap: 6, s: [0.8, 1.2], clump: [3, 14], margin: 100 }));
    out.push(...sc({ kind: 'shrub', n: 260, cd: [0.5, 60], gap: 1.6, s: [0.6, 1.2], clump: [6, 6], margin: 40 }));
    out.push(...sc({ kind: 'flower', n: 500, cd: [0.5, 80], gap: 1.1, s: [0.7, 1.3], clump: [8, 6], margin: 40 }));
    return out;
  },
  holes: [
    {
      name: '정자 연못',
      en: 'Pavilion Pond',
      sub: '연못을 넘기는 짧은 파3. 왼쪽 정자 쪽은 연못이 깊어요.',
      par: 3,
      tees: { hard: [0, -12], normal: [0, 0], easy: [-2, 26] },
      route: [[0, 0], [-4, 140]],
      fairway: [capsule(0, 33, -1, 68, 10, 11, 0.1, 1), capsule(-3, 119, -4, 126, 9, 9, 0.08, 2)],
      green: { at: [-4, 140], rx: 13, rz: 12, rot: -10, tilt: [0.007, 0.016], bumps: [[4, 3, 3.5, 0.1]] },
      pins: [[-6, 139], [-9, 144], [1, 137]],
      bunkers: [bk(-20, 143, 4.5, 3, -30, 1), bk(6, 155, 5, 2.6, 20, 2)],
      water: [{ shape: blob(8, 96, 23, 16, -20, 0.12, 4), y: -0.2, kind: 'pond', name: '연못', depth: 1.5, bank: 6, bankSlope: 0.16 }],
      paths: [[[10, -8], [28, 30], [50, 80], [54, 128], [34, 160], [10, 174]]],
      elev: [[0, 0, 3], [-4, 140, 2.6], [8, 96, 0.6], [60, 60, 6], [-60, 80, 5]],
      bounds: { x0: -60, x1: 72, z0: -30, z1: 188 },
      extras: [{ kind: 'pavilion', x: 40, z: 104, rot: -1.2 }, { kind: 'lantern', x: 9, z: -6 }, { kind: 'lantern', x: -9, z: -6 }, { kind: 'lantern', x: 44, z: 120 }]
    },
    {
      name: '구릉 언덕',
      en: 'Rolling Hills',
      sub: '그린까지 조금씩 오르는 파4. 그린 뒤 단이 높아요.',
      par: 4,
      tees: { hard: [0, -14], normal: [0, 0], easy: [2, 32] },
      route: [[0, 0], [2, 212], [-14, 318]],
      fairway: [capsule(0, 45, 2, 150, 13, 16, 0.1, 3), capsule(2, 150, 1, 240, 18, 17, 0.1, 4), capsule(1, 240, -12, 304, 15, 12, 0.12, 5)],
      green: { at: [-14, 318], rx: 13, rz: 14, rot: -15, lift: 0.5, tilt: [0.006, 0.02], tiers: [[0, 2.5, 0.26, 4.5]] },
      pins: [[-14, 312], [-12, 325], [-19, 314]],
      bunkers: [bk(23, 205, 6.5, 3.5, 15, 1), bk(-19, 231, 6, 3, -10, 2), bk(1, 307, 5, 3, 30, 3), bk(-29, 319, 4.5, 3, -20, 4)],
      paths: [[[-8, -8], [-28, 60], [-31, 200], [-37, 290], [-30, 345], [-10, 360]]],
      elev: [[0, 0, 2], [2, 212, 5.5], [-14, 318, 8.2], [50, 150, 7], [-60, 120, 6]],
      bounds: { x0: -70, x1: 72, z0: -35, z1: 362 },
      extras: [{ kind: 'lantern', x: 9, z: -7 }, { kind: 'lantern', x: -9, z: -7 }, { kind: 'bench', x: -12, z: -4, rot: 0.4 }]
    },
    {
      name: '벚꽃길',
      en: 'Blossom Lane',
      sub: 'S자로 휘는 파5. 그린 앞 개울을 넘겨야 해요.',
      par: 5,
      tees: { hard: [0, -15], normal: [0, 0], easy: [-2, 40] },
      route: [[0, 0], [-6, 222], [16, 382], [8, 452]],
      fairway: [capsule(0, 45, -4, 150, 13, 16, 0.1, 6), capsule(-4, 150, -6, 248, 18, 16, 0.1, 7), capsule(-4, 262, 14, 390, 15, 17, 0.12, 8), capsule(14, 390, 9, 438, 14, 12, 0.12, 9)],
      green: { at: [8, 452], rx: 14, rz: 13, rot: 10, tilt: [-0.005, 0.017], bumps: [[-3, 3, 3.4, 0.1]] },
      pins: [[10, 450], [12, 458], [4, 448]],
      bunkers: [bk(21, 236, 6, 3.4, 10, 1), bk(-12, 356, 5, 3, 0, 2), bk(24, 450, 5, 3, 30, 3), bk(-7, 459, 4.5, 3, -20, 4)],
      water: [{ shape: strip([[-100, 170], [-55, 245], [-36, 330], [-14, 404], [20, 417], [60, 411], [110, 420]], 2.1), y: 0.35, kind: 'creek', name: '개울', depth: 0.8, bank: 6, bankSlope: 0.2 }],
      paths: [[[-8, -8], [-30, 60], [-34, 200], [-52, 300], [-46, 380], [-22, 470], [4, 488]]],
      elev: [[0, 0, 4], [-6, 222, 3], [16, 382, 2.2], [8, 452, 2.8], [-14, 410, 1.0], [-40, 300, 1.4], [-60, 220, 1.5]],
      bounds: { x0: -76, x1: 82, z0: -35, z1: 495 },
      extras: [{ kind: 'lantern', x: -10, z: -7 }, { kind: 'lantern', x: 10, z: -7 }]
    }
  ]
};
