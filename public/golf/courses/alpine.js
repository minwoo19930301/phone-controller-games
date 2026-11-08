// 알파인 레이크: 눈 덮인 봉우리 아래 호숫가 코스. 높은 티에서 내려치고, 호수 위 섬 그린을 노립니다.
import { blob, capsule, poly, fbm, ridged } from './core.js';

const bk = (x, z, rx, rz, rot = 0, seed = 1, type) => ({ s: blob(x, z, rx, rz, rot, 0.13, seed), type });
const lake = (pts, holes = [], y = 0) => ({ shape: poly(pts, 6, 3), holes, y, kind: 'lake', name: '호수', depth: 2.4, bank: 9, bankSlope: 0.12 });

export default {
  id: 'alpine',
  name: '알파인 레이크',
  en: 'Alpine Lake',
  theme: 'alpine',
  blurb: '설산 아래 호숫가. 높은 티에서 내려치고 호수 위 섬 그린을 노려요.',
  rating: 2,
  surfaceNames: { deep: '고산 풀밭' },
  env: {
    timeOfDay: '맑은 아침',
    sky: { turbidity: 2.2, rayleigh: 2.0, mie: 0.003, mieG: 0.8, elevation: 27, azimuth: 135 },
    sun: { color: '#fff3e4', intensity: 3.2 },
    hemi: { sky: '#cfe3ff', ground: '#4a5f3a', intensity: 0.9 },
    fog: { color: '#b4c9de', near: 500, far: 3400 },
    exposure: 0.6,
    clouds: { n: 12, opacity: 0.75, y: [380, 620] },
    wind: { min: 1, max: 7, gust: 0.45, dir: 30 }
  },
  palette: {
    deep: '#5a8540', deep2: '#6f8a48', rough: '#4f8a3c', fairway: '#5e9f45', fairway2: '#55943e', fringe: '#5ea445',
    green: '#68b04d', green2: '#61a847', tee: '#62a347', tee2: '#58983f', sand: '#ebe2cc', sandDark: '#bdb29a',
    waste: '#9a9a8a', beach: '#b8b2a0', wetSand: '#7f7a68', bed: '#3a5450', water: '#2a6a7e', path: '#a9a69e',
    ob: '#5a5a55', tree: '#1d3a26', rock: '#8a8e92'
  },
  terrain: {
    roughMargin: 9,
    flatten: 0.86,
    bowl: 0.1,
    relief: (x, z, s) => 5.5 * fbm(x * 0.008, z * 0.008, 3, s) + 2.0 * ridged(x * 0.024, z * 0.024, 2, s + 3) - 1,
    micro: (x, z, s) => 0.42 * fbm(x * 0.034, z * 0.032, 3, s + 7)
  },
  far: { kind: 'mountains' },
  dress(hole, sc) {
    const out = [];
    out.push(...sc({ kind: 'fir', n: 900, cd: [3, 420], gap: 4.4, s: [0.65, 1.25], clump: [8, 18], margin: 120 }));
    out.push(...sc({ kind: 'boulder', n: 60, cd: [8, 420], gap: 7, s: [0.6, 1.8], clump: [2, 10], margin: 120 }));
    out.push(...sc({ kind: 'rock', n: 150, cd: [2, 400], gap: 2.4, s: [0.5, 1.6], clump: [4, 7], margin: 100 }));
    out.push(...sc({ kind: 'flower', n: 700, cd: [0.5, 140], gap: 1.2, s: [0.6, 1.3], clump: [8, 6], margin: 50 }));
    return out;
  },
  holes: [
    {
      name: '낙차 드라이브',
      en: 'The Drop',
      sub: '25m 아래 페어웨이로 내려치는 파4. 왼쪽 호수는 그린 근처에서 가까워져요.',
      par: 4,
      tees: { hard: [0, -14], normal: [0, 0], easy: [-2, 34] },
      route: [[0, 0], [-4, 232], [20, 377]],
      fairway: [capsule(0, 60, -3, 160, 13, 17, 0.1, 1), capsule(-3, 160, -4, 262, 19, 18, 0.1, 2), capsule(-4, 262, 16, 362, 15, 12, 0.12, 3)],
      green: { at: [20, 377], rx: 14, rz: 13, rot: 20, tilt: [-0.011, 0.01], bumps: [[-3, 3, 3.6, 0.08]] },
      pins: [[20, 378], [24, 384], [15, 372]],
      bunkers: [bk(-26, 241, 7, 3.6, -10, 1), bk(14, 266, 5, 3, 15, 2), bk(35, 369, 4.5, 3, 30, 3), bk(5, 383, 5, 3.4, -20, 4), bk(24, 396, 5, 2.5, 0, 5)],
      water: [lake([[50, 170], [72, 258], [64, 340], [72, 420], [140, 520], [700, 640], [700, 140], [130, 140]])],
      elev: [[0, 0, 30, 400], [0, 100, 17], [-4, 232, 6], [20, 377, 4], [-80, 160, 30], [0, -40, 32]],
      bounds: { x0: -76, x1: 78, z0: -35, z1: 422 },
      extras: []
    },
    {
      name: '호수 위 그린',
      en: 'Island Green',
      sub: '호수 한가운데 섬 그린. 그린 앞 작은 에이프런과 뒤쪽 좁은 둑만 땅이에요.',
      par: 3,
      tees: { hard: [0, -13], normal: [0, 0], easy: [2, 28] },
      route: [[0, 0], [4, 145]],
      fairway: [capsule(0, 18, 1, 34, 9, 10, 0.08, 4), capsule(3, 121, 4, 128, 8, 8, 0.08, 6)],
      rough: [capsule(0, 10, 1, 38, 18, 19, 0.06, 4), blob(4, 140, 22, 24, 0, 0.08, 3), capsule(16, 160, 40, 208, 6, 7, 0.1, 5)],
      green: { at: [4, 145], rx: 13, rz: 12, rot: 0, lift: 0.3, tilt: [0.005, 0.014], bumps: [[3, 2, 3, 0.07]] },
      pins: [[4, 146], [0, 150], [9, 141]],
      bunkers: [bk(-12, 140, 4, 2.6, -20, 1), bk(17, 160, 3.5, 2.5, 40, 2)],
      water: [lake([[-140, 40], [-50, 52], [0, 46], [60, 54], [150, 40], [230, 70], [210, 200], [100, 206], [0, 198], [-100, 212], [-220, 190], [-240, 70]],
        [blob(4, 140, 22, 24, 0, 0.08, 3), capsule(16, 160, 44, 215, 6, 7, 0.1, 5)])],
      elev: [[0, 0, 14], [4, 145, 1.5, 300], [40, 240, 7], [-60, 0, 17], [60, 0, 17], [0, 100, 2]],
      bounds: { x0: -62, x1: 72, z0: -30, z1: 218 },
      extras: []
    },
    {
      name: '호숫가 오르막',
      en: 'Lakeside Climb',
      sub: '왼쪽에 호수를 끼고 20m 올라가는 파5. 그린 뒤 산장이 보여요.',
      par: 5,
      tees: { hard: [0, -15], normal: [0, 0], easy: [-3, 45] },
      route: [[0, 0], [6, 236], [-8, 426], [-2, 514]],
      fairway: [capsule(0, 50, 5, 160, 13, 16, 0.1, 6), capsule(5, 160, 6, 262, 18, 17, 0.1, 7), capsule(4, 280, -8, 430, 15, 17, 0.12, 8), capsule(-8, 430, -3, 500, 14, 12, 0.12, 9)],
      green: { at: [-2, 514], rx: 15, rz: 13, rot: -10, lift: 0.5, tilt: [0.004, 0.026], tiers: [[0, 3, 0.26, 4.5]] },
      pins: [[-2, 508], [1, 522], [-8, 512]],
      bunkers: [bk(-23, 246, 7, 3.5, 0, 1), bk(25, 412, 6, 3.5, 20, 2), bk(13, 506, 5, 3, 30, 3), bk(-17, 519, 5, 3, -30, 4)],
      water: [lake([[56, -140], [66, 80], [60, 200], [70, 320], [62, 430], [112, 560], [700, 600], [700, -140]])],
      elev: [[0, 0, 1.6], [6, 236, 6], [-8, 426, 14], [-2, 514, 20], [-60, 300, 25], [-40, 560, 23]],
      bounds: { x0: -72, x1: 76, z0: -35, z1: 560 },
      extras: [{ kind: 'chalet', x: -46, z: 552, rot: 0.5 }]
    }
  ]
};
