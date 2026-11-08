// 사막 캐니언: 붉은 바위 협곡을 넘겨 치는 타깃 골프. 페어웨이 밖은 모래와 선인장, 해 질 녘 금빛.
import { blob, capsule, poly, fbm, ridged } from './core.js';

const bk = (x, z, rx, rz, rot = 0, seed = 1, type) => ({ s: blob(x, z, rx, rz, rot, 0.16, seed), type });
const canyon = (pts, floor, name = '협곡') => ({ shape: poly(pts, 4, 3), floor, kind: 'canyon', name, wall: 1 });

export default {
  id: 'canyon',
  name: '사막 캐니언',
  en: 'Desert Canyon',
  theme: 'desert',
  blurb: '협곡을 넘겨 페어웨이 섬에 올리는 타깃 골프. 빗나가면 모래밭이에요.',
  rating: 3,
  surfaceNames: { deep: '사막 모래밭', ob: '협곡(OB)' },
  env: {
    timeOfDay: '해 질 녘',
    sky: { turbidity: 9, rayleigh: 1.1, mie: 0.006, mieG: 0.86, elevation: 16, azimuth: 250 },
    sun: { color: '#ffd29a', intensity: 3.4 },
    hemi: { sky: '#e9d6c0', ground: '#8a5a38', intensity: 0.8 },
    fog: { color: '#e2c3a0', near: 380, far: 2600 },
    exposure: 0.58,
    clouds: { n: 10, opacity: 0.65, y: [260, 480] },
    wind: { min: 1, max: 6, gust: 0.3, dir: 300 }
  },
  palette: {
    deep: '#c99b67', deep2: '#b3814f', rough: '#8c9a50', fairway: '#74a948', fairway2: '#699d40', fringe: '#6ea746',
    green: '#68b24a', green2: '#61aa44', tee: '#70a646', tee2: '#669a3e', sand: '#f2e2bc', sandDark: '#cbb08a',
    waste: '#d8b483', beach: '#d8b483', wetSand: '#a57a50', bed: '#6b4a32', water: '#2f6f85', path: '#c7b49a',
    ob: '#9c5636', tree: '#4f6a2c', rock: '#b4643c'
  },
  terrain: {
    roughMargin: 3.5,
    flatten: 0.9,
    bowl: 0,
    relief: (x, z, s) => 2.6 * fbm(x * 0.014, z * 0.014, 3, s) + 1.6 * ridged(x * 0.03, z * 0.03, 2, s + 2) - 0.8,
    micro: (x, z, s) => 0.32 * fbm(x * 0.035, z * 0.035, 3, s + 7)
  },
  far: { kind: 'mesas' },
  dress(hole, sc) {
    const out = [];
    out.push(...sc({ kind: 'saguaro', n: 150, cd: [3, 320], gap: 7, s: [0.7, 1.25], clump: [2, 16], margin: 110 }));
    out.push(...sc({ kind: 'barrel', n: 260, cd: [1, 200], gap: 1.6, s: [0.6, 1.4], clump: [3, 3], margin: 60 }));
    out.push(...sc({ kind: 'shrub', n: 700, cd: [0.6, 300], gap: 2.2, s: [0.6, 1.4], clump: [5, 9], margin: 90 }));
    out.push(...sc({ kind: 'tuft', n: 900, cd: [0.5, 260], gap: 1.1, s: [0.6, 1.2], clump: [6, 6], margin: 70 }));
    out.push(...sc({ kind: 'rock', n: 170, cd: [2, 400], gap: 2.4, s: [0.5, 2.2], clump: [4, 7], margin: 110 }));
    out.push(...sc({ kind: 'boulder', n: 40, cd: [14, 420], gap: 7, s: [0.8, 2.2], clump: [2, 10], margin: 140 }));
    return out;
  },
  holes: [
    {
      name: '협곡 넘기',
      en: 'Canyon Carry',
      sub: '티 앞 협곡을 120m 넘겨야 하는 파4. 넘기면 넓은 페어웨이가 기다려요.',
      par: 4,
      tees: { hard: [0, -12], normal: [0, 0], easy: [1, 22] },
      route: [[0, 0], [4, 215], [-18, 332]],
      fairway: [capsule(4, 146, 4, 250, 16, 19, 0.12, 1), capsule(4, 250, -14, 318, 15, 12, 0.12, 2)],
      green: { at: [-18, 332], rx: 13, rz: 14, rot: -15, tilt: [0.008, 0.017], bumps: [[3, -3, 3.5, 0.09]] },
      pins: [[-18, 333], [-22, 340], [-13, 327]],
      bunkers: [bk(-20, 228, 8, 4, 10, 1), bk(23, 262, 6, 3.5, -15, 2), bk(-36, 331, 6, 3, 30, 3), bk(0, 324, 5, 3, -20, 4)],
      waste: [blob(28, 196, 13, 24, 8, 0.15, 3), blob(-34, 284, 10, 18, -20, 0.15, 5)],
      ob: [canyon([[-500, 46], [-120, 40], [-40, 54], [0, 45], [40, 50], [120, 38], [500, 46], [500, 118], [120, 128], [40, 114], [0, 124], [-40, 116], [-120, 128], [-500, 120]], -16)],
      elev: [[0, 0, 11], [4, 215, 9], [-18, 332, 11], [-150, 30, 12], [150, 30, 12], [0, 150, 9.5]],
      bounds: { x0: -72, x1: 78, z0: -30, z1: 378 },
      extras: []
    },
    {
      name: '메사 투 메사',
      en: 'Mesa to Mesa',
      sub: '협곡 건너 맞은편 바위 언덕 위 그린. 오른쪽에 피할 곳이 조금 있어요.',
      par: 3,
      tees: { hard: [0, -12], normal: [0, 0], easy: [-3, 24] },
      route: [[0, 0], [-8, 166]],
      fairway: [capsule(-1, 138, -6, 152, 10, 10, 0.08, 3)],
      green: { at: [-8, 166], rx: 14, rz: 12, rot: -5, tilt: [-0.005, 0.016], bumps: [[-4, 2, 3.4, 0.1]] },
      pins: [[-6, 164], [-14, 170], [-2, 160]],
      bunkers: [bk(14, 171, 5, 3, 30, 1), bk(-31, 175, 5.5, 3, -30, 2), bk(-8, 185, 7, 2.5, 0, 3)],
      waste: [blob(-50, 152, 12, 16, 10, 0.15, 2)],
      ob: [canyon([[-500, 38], [-60, 42], [-20, 35], [20, 39], [60, 34], [500, 40], [500, 146], [40, 133], [12, 131], [-24, 125], [-40, 116], [-58, 128], [-90, 142], [-500, 146]], -22)],
      elev: [[0, 0, 14], [-8, 166, 8], [0, -30, 15], [-8, 220, 10], [-50, 150, 8.5]],
      bounds: { x0: -72, x1: 62, z0: -30, z1: 215 },
      extras: []
    },
    {
      name: '사막 워시',
      en: 'Desert Wash',
      sub: '가운데 모래밭을 두고 갈라진 페어웨이. 280m 마른 개울을 지나 높은 그린으로.',
      par: 5,
      tees: { hard: [0, -15], normal: [0, 0], easy: [3, 42] },
      route: [[0, 0], [10, 232], [-8, 418], [-6, 500]],
      fairway: [capsule(0, 40, 6, 150, 13, 17, 0.12, 4), capsule(6, 150, 12, 262, 18, 16, 0.1, 5), capsule(28, 312, 4, 408, 13, 14, 0.12, 6), capsule(-24, 300, -12, 400, 13, 14, 0.12, 7), capsule(-8, 405, -6, 480, 15, 12, 0.12, 8)],
      green: { at: [-6, 502], rx: 15, rz: 13, rot: 10, lift: 1.2, tilt: [0.007, 0.022], tiers: [[-90, 5, 0.28, 4.5]] },
      pins: [[-1, 503], [0, 507], [-15, 500]],
      bunkers: [bk(34, 228, 6, 3.5, 20, 1), bk(8, 492, 5, 3, 20, 2), bk(-21, 498, 5, 3, -20, 3), bk(-6, 476, 11, 3.6, 0, 4)],
      waste: [capsule(-110, 285, 110, 278, 9, 9, 0.2, 2), blob(2, 352, 12, 34, 0, 0.12, 4)],
      elev: [[0, 0, 6], [10, 232, 4], [0, 282, 2.4], [-8, 418, 5], [-6, 502, 8.5], [-60, 380, 7]],
      bounds: { x0: -76, x1: 82, z0: -35, z1: 552 },
      extras: []
    }
  ]
};
