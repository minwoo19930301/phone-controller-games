// 골프 코스 다섯 곳(코스마다 3홀). 게임은 COURSES 만 불러 쓰면 됩니다.
// 홀마다 height/surface/slope(물리), build(scene, quality)(그리기), minimap(작은 지도)을 줍니다. 자세한 약속은 README.md.
import { makeHole, drawMinimap, SURFACES, SURFACE_NAMES, DEFAULT_PALETTE } from './core.js';
import { buildHole } from './build.js';
import links from './links.js';
import pines from './pines.js';
import canyon from './canyon.js';
import alpine from './alpine.js';
import blossom from './blossom.js';

const RD = Math.PI / 180;

function prepare(def) {
  const e = def.env;
  const el = e.sky.elevation * RD;
  const az = e.sky.azimuth * RD;
  // 해 방향(세계 좌표, 해 쪽을 가리키는 단위 벡터). 방위 0 = +z(그린 쪽), 180 = 티 뒤.
  const sunDir = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)].map((v) => Math.round(v * 1e4) / 1e4);
  const course = {
    id: def.id,
    name: def.name,
    en: def.en,
    theme: def.theme,
    blurb: def.blurb,
    rating: def.rating,
    palette: { ...DEFAULT_PALETTE, ...def.palette },
    surfaceNames: { ...SURFACE_NAMES, ...(def.surfaceNames || {}) },
    env: { ...e, sunDir, wind: { ...e.wind } },
    terrain: def.terrain,
    far: def.far,
    dress: def.dress
  };
  course.holes = def.holes.map((h, i) => {
    const hole = makeHole(h, course, i);
    hole.palette = course.palette;
    hole.build = (scene, quality) => buildHole(hole, course, scene, quality);
    return hole;
  });
  course.par = course.holes.reduce((s, h) => s + h.par, 0);
  course.lengthM = course.holes.reduce((s, h) => s + h.lengthM, 0);
  return course;
}

export const COURSES = [links, pines, canyon, alpine, blossom].map(prepare);
export const getCourse = (id) => COURSES.find((c) => c.id === id) || COURSES[0];
export { drawMinimap, SURFACES, SURFACE_NAMES };
