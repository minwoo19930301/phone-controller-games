// 코스 바닥 그림(캔버스 2D). 잔디 종류마다 색과 깎은 무늬를 칠하고, 물가·벙커·나무 그림자를 그립니다.
// 세계 좌표로 바로 그리도록 캔버스 변환을 걸어 둡니다: 캔버스 x = (x - x0)·sx, y = (z1 - z)·sz.
import { outline, fbm, vnoise, clamp01 } from './core.js';

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// 땅바탕 색(깊은 러프·모래언덕·바위 벽). 본 지형 그림과 먼 지형 정점 색이 같은 함수를 써서 경계가 티 나지 않습니다.
// h = 높이, sl = 경사 크기, lap = 오목(+)/볼록(-) 정도. 돌려주는 값은 0~255 RGB.
const palCache = new WeakMap();
function pal(course) {
  if (!palCache.has(course)) {
    const P = course.palette;
    palCache.set(course, {
      deep: hex(P.deep), deep2: hex(P.deep2 || P.deep), rock: hex(P.rock || P.ob), ob: hex(P.ob), sand: hex(P.beach || P.sand),
      soil: hex('#6b5a3c'), dry: hex('#8f7a52'), meadow: hex('#7c8f4c')
    });
  }
  return palCache.get(course);
}
export function groundColor(course, x, z, h, sl, lap) {
  const C = pal(course);
  const th = course.theme;
  const n1 = fbm(x * 0.018, z * 0.018, 3, 11) * 0.5 + 0.5;
  const n2 = vnoise(x * 0.09, z * 0.09, 13) * 0.5 + 0.5;
  const n3 = vnoise(x * 0.004, z * 0.004, 17) * 0.5 + 0.5;
  let c = mix(C.deep, C.deep2, clamp01(n1 * 1.5 - 0.25 + (n3 - 0.5) * 0.6));
  if (th === 'links') {
    // 모래언덕 가파른 면과 꼭대기는 모래가 드러납니다
    const bare = clamp01((sl - 0.3) * 2.4) + clamp01((n2 - 0.8) * 3) * 0.45 + clamp01(-lap * 6 - 0.1) * 0.4;
    c = mix(c, C.sand, clamp01(bare));
  } else if (th === 'desert') {
    const steep = clamp01((sl - 0.5) * 1.6);
    const band = Math.sin(h * 1.25 + n2 * 1.2) * 0.5 + 0.5;
    c = mix(c, mix(C.rock, C.ob, band), steep);
    c = mix(c, C.dry, clamp01((n2 - 0.65) * 2) * 0.4);
  } else if (th === 'alpine') {
    c = mix(c, C.rock, clamp01((sl - 0.45) * 1.8));
    c = mix(c, C.meadow, clamp01((n2 - 0.55) * 2) * 0.35);
  } else {
    c = mix(c, C.soil, clamp01((sl - 0.6) * 1.5) * 0.7);
  }
  // 오목한 곳은 어둡고 볼록한 곳은 밝게(바람·햇빛을 덜 받는 골)
  const ao = 1 + clamp01(-lap * 3) * 0.1 - clamp01(lap * 3) * 0.16;
  const s = (0.93 + n2 * 0.12) * ao;
  return [c[0] * s, c[1] * s, c[2] * s];
}

// 땅바탕을 지형 격자 한 칸 = 한 픽셀로 칠합니다.
export function fieldCanvas(course, grid) {
  const { nx, nz, x0, z0, step, H } = grid;
  const cv = document.createElement('canvas');
  cv.width = nx;
  cv.height = nz;
  const g = cv.getContext('2d');
  const img = g.createImageData(nx, nz);
  const d = img.data;
  for (let j = 0; j < nz; j++) {
    const z = z0 + j * step;
    const row = nz - 1 - j; // 캔버스 위쪽 = z 큰 쪽
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step;
      const k = j * nx + i;
      const h = H[k];
      const hl = H[j * nx + Math.max(0, i - 1)];
      const hr = H[j * nx + Math.min(nx - 1, i + 1)];
      const hd = H[Math.max(0, j - 1) * nx + i];
      const hu = H[Math.min(nz - 1, j + 1) * nx + i];
      const gx = (hr - hl) / (2 * step);
      const gz = (hu - hd) / (2 * step);
      // 오목함은 4m 넘게 떨어진 이웃으로 재서 큰 굴곡만 봅니다
      const e = Math.max(1, Math.round(4 / step));
      const lap = (H[j * nx + Math.min(nx - 1, i + e)] + H[j * nx + Math.max(0, i - e)] + H[Math.min(nz - 1, j + e) * nx + i] + H[Math.max(0, j - e) * nx + i] - 4 * h) / ((e * step) ** 2);
      const c = groundColor(course, x, z, h, Math.sqrt(gx * gx + gz * gz), lap);
      const o = (row * nx + i) * 4;
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}

// 나무 그늘·잔디 결에 쓰는 무늬 캔버스(한 번만 만듭니다)
let speckCv = null;
function speckles() {
  if (speckCv) return speckCv;
  speckCv = document.createElement('canvas');
  speckCv.width = speckCv.height = 128;
  const g = speckCv.getContext('2d');
  for (let i = 0; i < 700; i++) {
    g.fillStyle = `rgba(0,0,0,${0.08 + Math.random() * 0.18})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5);
  }
  return speckCv;
}

// rect 영역을 W×H 캔버스에 그립니다. field 는 fieldCanvas 결과(같은 격자 영역 grid 를 같이 줍니다).
export function paintRect(hole, course, rect, W, H, field, grid, opts = {}) {
  const P = course.palette;
  const C = {};
  for (const k of Object.keys(P)) if (typeof P[k] === 'string' && P[k][0] === '#') C[k] = hex(P[k]);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  const sx = W / (rect.x1 - rect.x0);
  const sz = H / (rect.z1 - rect.z0);
  const ppm = Math.min(sx, sz);
  const world = () => g.setTransform(sx, 0, 0, -sz, -rect.x0 * sx, rect.z1 * sz);
  world();
  const _ = hole._;
  const path = (pts, close = true) => {
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
    if (close) g.closePath();
  };
  const fill = (pts, color) => {
    g.fillStyle = color;
    path(pts);
    g.fill();
  };
  const line = (pts, w, color) => {
    g.strokeStyle = color;
    g.lineWidth = w;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    path(pts, false);
    g.stroke();
  };
  const ring = (pts, w, color) => {
    g.strokeStyle = color;
    g.lineWidth = w;
    g.lineJoin = 'round';
    path(pts);
    g.stroke();
  };
  const out = (s, thr = 1) => outline(s, thr, 160);
  const inRect = (s, pad = 40) => s.cx + s.R + pad > rect.x0 && s.cx - s.R - pad < rect.x1 && s.cz + s.R + pad > rect.z0 && s.cz - s.R - pad < rect.z1;

  // 1. 땅바탕
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  const drawField = () => {
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    // field 픽셀 (i, nz-1-j) 은 세계 (x0 + i·step, z0 + j·step) 의 점입니다(픽셀 가운데가 격자점).
    const fx = (rect.x0 - grid.x0) / grid.step + 0.5;
    const fz = (grid.z0 + (grid.nz - 1) * grid.step - rect.z1) / grid.step + 0.5;
    const fw = (rect.x1 - rect.x0) / grid.step;
    const fh = (rect.z1 - rect.z0) / grid.step;
    g.drawImage(field, fx, fz, fw, fh, 0, 0, W, H);
    g.restore();
  };
  drawField();

  const dress = hole.dress().items;
  const sun = course.env.sunDir;
  // 2. 나무 밑 바닥(솔잎·꽃잎)
  for (const t of dress) {
    if (t.x < rect.x0 - 10 || t.x > rect.x1 + 10 || t.z < rect.z0 - 10 || t.z > rect.z1 + 10) continue;
    let col = null;
    let r = 0;
    if ((t.kind === 'tallpine' || t.kind === 'pine' || t.kind === 'redpine') && C.straw) {
      col = C.straw;
      r = 4.2 * t.s;
    } else if (t.kind === 'cherry' && C.petal) {
      col = C.petal;
      r = 5.2 * t.s;
    } else if (t.kind === 'fir') {
      col = [70, 66, 46];
      r = 3.4 * t.s;
    }
    if (!col) continue;
    const gr = g.createRadialGradient(t.x, t.z, 0, t.x, t.z, r);
    gr.addColorStop(0, css(col, 0.75));
    gr.addColorStop(0.6, css(col, 0.4));
    gr.addColorStop(1, css(col, 0));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(t.x, t.z, r, 0, Math.PI * 2);
    g.fill();
  }

  // 3. 러프(가장자리를 부드럽게)
  const roughs = _.rough.filter((s) => inRect(s)).map((s) => out(s));
  for (const p of roughs) ring(p, 4, css(C.rough, 0.25));
  for (const p of roughs) ring(p, 2, css(C.rough, 0.45));
  for (const p of roughs) fill(p, css(C.rough));
  // 러프 결(잔 얼룩)
  g.save();
  roughs.forEach((p) => {
    path(p);
  });
  g.beginPath();
  for (const p of roughs) {
    p.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
    g.closePath();
  }
  g.clip();
  const sp = g.createPattern(speckles(), 'repeat');
  sp.setTransform(new DOMMatrix().scale(0.12));
  g.globalAlpha = 0.5;
  g.fillStyle = sp;
  g.fillRect(rect.x0, rect.z0, rect.x1 - rect.x0, rect.z1 - rect.z0);
  g.globalAlpha = 1;
  g.restore();

  // 4. 웨이스트(모래·자갈 바닥)
  for (const s of _.waste) {
    if (!inRect(s)) continue;
    const p = out(s);
    ring(p, 1.6, css(mix(C.waste, C.deep, 0.5), 0.6));
    fill(p, css(C.waste));
    g.save();
    path(p);
    g.clip();
    const rr = mulberry(hole.seed + 5);
    for (let i = 0; i < s.R * s.R * 0.8; i++) {
      const a = rr() * Math.PI * 2;
      const d = Math.sqrt(rr()) * s.R;
      g.fillStyle = rr() < 0.5 ? 'rgba(90,70,40,.35)' : 'rgba(255,245,220,.35)';
      g.beginPath();
      g.arc(s.cx + Math.cos(a) * d, s.cz + Math.sin(a) * d, 0.12 + rr() * 0.3, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  // 5. 페어웨이: 퍼스트 컷 테두리 → 잔디 → 깎은 줄무늬(캡슐 방향과 수직)
  const fairs = _.fair.map((s) => ({ s, p: out(s) }));
  const cut = mix(C.rough, C.fairway, 0.55);
  for (const f of fairs) ring(f.p, 3.2, css(cut));
  for (const f of fairs) fill(f.p, css(C.fairway));
  const stripeW = opts.stripe ?? 7;
  for (const f of fairs) {
    const s = f.s;
    let ux = 0;
    let uz = 1;
    if (s.kind === 'capsule') {
      const L = Math.hypot(s.bx - s.ax, s.bz - s.az) || 1;
      ux = (s.bx - s.ax) / L;
      uz = (s.bz - s.az) / L;
    }
    g.save();
    path(f.p);
    g.clip();
    g.fillStyle = css(C.fairway2);
    const span = s.R + 10;
    for (let k = -Math.ceil(span / stripeW); k <= Math.ceil(span / stripeW); k += 2) {
      // 띠 하나: 축 방향 k·W ~ (k+1)·W, 옆으로 넉넉히
      const a0 = k * stripeW;
      const a1 = a0 + stripeW;
      const px = -uz;
      const pz = ux;
      g.beginPath();
      g.moveTo(s.cx + ux * a0 + px * span, s.cz + uz * a0 + pz * span);
      g.lineTo(s.cx + ux * a1 + px * span, s.cz + uz * a1 + pz * span);
      g.lineTo(s.cx + ux * a1 - px * span, s.cz + uz * a1 - pz * span);
      g.lineTo(s.cx + ux * a0 - px * span, s.cz + uz * a0 - pz * span);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  // 6. 카트 도로
  for (const p of _.paths) {
    line(p.pts, p.hw * 2 + 0.5, css(mix(C.path, [60, 60, 60], 0.35)));
    line(p.pts, p.hw * 2, css(C.path));
  }

  // 7. 물: 모래 해변·물가 흙 → 물 바닥
  for (const w of _.waters) {
    const s = w.shape;
    if (s.kind === 'strip') {
      line(s.pts, s.hw * 2 + 3.2, css(mix(C.deep, C.bed, 0.45)));
      line(s.pts, s.hw * 2 + 1.2, css(C.wetSand || C.bed));
      line(s.pts, s.hw * 2, css(C.bed));
      continue;
    }
    const p = s.kind === 'poly' ? s.pts : out(s);
    g.save();
    // 섬(물 안의 땅)은 빼고 칠합니다
    g.beginPath();
    p.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
    g.closePath();
    const holes = w.holes.map((h) => out(h));
    if (w.kind === 'sea') {
      // 모래사장: 바다 둘레를 넓게
      g.strokeStyle = css(C.beach, 0.45);
      g.lineWidth = 46;
      g.lineJoin = 'round';
      g.stroke();
      g.strokeStyle = css(C.beach);
      g.lineWidth = 30;
      g.stroke();
    } else {
      g.strokeStyle = css(mix(C.deep, C.bed, 0.5), 0.8);
      g.lineWidth = w.kind === 'lake' ? 5 : 3.2;
      g.lineJoin = 'round';
      g.stroke();
    }
    g.strokeStyle = css(C.wetSand || C.bed);
    g.lineWidth = w.kind === 'sea' ? 7 : 1.6;
    g.stroke();
    // 물 바닥은 물 모양 안에만(섬·둑이 물 밖으로 삐져나간 부분이 물빛으로 칠해지지 않게)
    g.clip();
    g.beginPath();
    p.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
    g.closePath();
    for (const h of holes) {
      h.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
      g.closePath();
    }
    g.fillStyle = css(C.bed);
    g.fill('evenodd');
    // 섬 가장자리 흙(물 안쪽만)
    for (const h of holes) ring(h, 1.4, css(C.wetSand || C.bed));
    g.restore();
  }

  // 8. 협곡(OB 깊은 곳)은 땅바탕(바위 지층)을 다시 깝니다
  for (const o of _.obs) {
    if (o.floor == null) continue;
    g.save();
    path(o.shape.pts);
    g.clip();
    drawField();
    g.restore();
    ring(o.shape.pts, 1.2, 'rgba(90,50,30,.45)');
  }

  // 9. 그린: 프린지 → 그린 → 바둑판 무늬
  const fr = out(_.gShape, _.FR);
  const gp = out(_.gShape, 1);
  ring(fr, 0.8, css(mix(C.rough, C.fringe, 0.5)));
  fill(fr, css(C.fringe));
  fill(gp, css(C.green));
  g.save();
  path(gp);
  g.clip();
  const ga = (hole.green.rot || 0) * (Math.PI / 180) + 0.5;
  const gc = hole.greenCenter;
  const cs = 2.4;
  g.translate(gc.x, gc.z);
  g.rotate(ga);
  // 그린 깎은 자국: 옅은 줄무늬 두 방향
  g.fillStyle = css(C.green2, 0.75);
  for (let i = -24; i < 24; i += 2) g.fillRect(i * 1.6, -40, 1.6, 80);
  g.rotate(Math.PI / 2);
  g.fillStyle = css(C.green2, 0.3);
  for (let i = -24; i < 24; i += 2) g.fillRect(i * 1.6, -40, 1.6, 80);
  g.restore();
  world();
  ring(gp, 0.25, css(mix(C.green, C.fringe, 0.5), 0.8));

  // 10. 벙커: 잔디 턱 → 모래(턱 쪽이 그늘져 어둡게)
  for (const b of _.bunkers) {
    if (!inRect(b.s, 10)) continue;
    const p = out(b.s);
    ring(p, b.type === 'pot' ? 0.9 : 0.7, css(mix(C.rough, [50, 40, 25], 0.45)));
    fill(p, css(C.sand));
    g.save();
    path(p);
    g.clip();
    const R = b.s.R;
    const fx = b.s.cx + b.fx * R * 0.9;
    const fz = b.s.cz + b.fz * R * 0.9;
    const gr = g.createRadialGradient(fx, fz, 0, fx, fz, R * 1.6);
    gr.addColorStop(0, css(C.sandDark, b.type === 'pot' ? 0.95 : 0.75));
    gr.addColorStop(0.45, css(C.sandDark, 0.25));
    gr.addColorStop(1, css(C.sandDark, 0));
    g.fillStyle = gr;
    g.fillRect(b.s.cx - R * 2, b.s.cz - R * 2, R * 4, R * 4);
    // 고무래 자국
    g.strokeStyle = 'rgba(255,255,255,.18)';
    g.lineWidth = 0.12;
    for (let k = -R; k < R; k += 0.55) {
      g.beginPath();
      g.moveTo(b.s.cx - R, b.s.cz + k + Math.sin(k) * 0.3);
      g.bezierCurveTo(b.s.cx - R * 0.3, b.s.cz + k + 0.4, b.s.cx + R * 0.3, b.s.cz + k - 0.4, b.s.cx + R, b.s.cz + k);
      g.stroke();
    }
    if (b.type === 'pot') {
      // 쌓아 올린 잔디 벽(그린 쪽)
      g.strokeStyle = css(mix(C.rough, [40, 50, 20], 0.5), 0.9);
      g.lineWidth = 0.5;
      g.beginPath();
      g.arc(b.s.cx, b.s.cz, R * 0.92, Math.atan2(b.fz, b.fx) - 1.2, Math.atan2(b.fz, b.fx) + 1.2);
      g.stroke();
    }
    g.restore();
  }

  // 11. 티잉 그라운드
  for (const t of hole.teeBoxes) {
    const ang = Math.atan2(t.uz, t.ux);
    g.save();
    g.translate(t.x, t.z);
    g.rotate(ang);
    g.fillStyle = css(mix(C.rough, [40, 40, 20], 0.25));
    g.fillRect(-t.hl - 0.5, -t.hw - 0.5, t.hl * 2 + 1, t.hw * 2 + 1);
    g.fillStyle = css(C.tee);
    g.fillRect(-t.hl, -t.hw, t.hl * 2, t.hw * 2);
    g.fillStyle = css(C.tee2);
    for (let k = -t.hl; k < t.hl; k += 3) g.fillRect(k, -t.hw, 1.5, t.hw * 2);
    // 디봇 자국
    const rr = mulberry(Math.round(t.x * 13 + t.z * 7));
    g.fillStyle = 'rgba(110,80,50,.55)';
    for (let i = 0; i < 26; i++) g.fillRect(-t.hl * 0.2 + rr() * t.hl * 1.0, -t.hw * 0.8 + rr() * t.hw * 1.6, 0.18 + rr() * 0.12, 0.08);
    g.restore();
  }

  // 12. 나무 그림자(해 반대쪽으로 비켜 난 부드러운 타원)
  g.globalCompositeOperation = 'multiply';
  const sy = Math.max(0.3, sun[1]);
  for (const t of dress) {
    if (t.kind === 'tuft' || t.kind === 'flower' || t.kind === 'barrel') continue;
    if (t.x < rect.x0 - 30 || t.x > rect.x1 + 30 || t.z < rect.z0 - 30 || t.z > rect.z1 + 30) continue;
    const big = t.kind === 'tallpine' ? 14 : t.kind === 'fir' ? 8 : t.kind === 'oak' ? 7 : t.kind === 'redpine' ? 7.5 : t.kind === 'cherry' ? 4.6 : t.kind === 'saguaro' ? 3 : 0.8;
    const r = (t.kind === 'tallpine' ? 3.4 : t.kind === 'fir' ? 2.8 : t.kind === 'oak' ? 4.6 : t.kind === 'cherry' ? 4.0 : t.kind === 'redpine' ? 3.6 : t.kind === 'saguaro' ? 0.8 : t.kind === 'gorse' ? 1.5 : 1.2) * t.s;
    const ox = (-sun[0] / sy) * big * t.s;
    const oz = (-sun[2] / sy) * big * t.s;
    const cx = t.x + ox;
    const cz = t.z + oz;
    const gr = g.createRadialGradient(cx, cz, 0, cx, cz, r * 1.5);
    gr.addColorStop(0, 'rgba(60,70,55,0.55)');
    gr.addColorStop(0.6, 'rgba(120,130,115,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(cx, cz, r * 1.5, 0, Math.PI * 2);
    g.fill();
    // 줄기 그림자
    if (big > 4) {
      g.strokeStyle = 'rgba(90,95,85,0.35)';
      g.lineWidth = 0.6 * t.s;
      g.beginPath();
      g.moveTo(t.x, t.z);
      g.lineTo(cx, cz);
      g.stroke();
    }
  }
  g.globalCompositeOperation = 'source-over';
  return cv;
}

function mulberry(seed) {
  let a = seed | 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 잔디 결 텍스처(바둑판처럼 반복): R = 잔 결, G = 중간 얼룩, B = 아주 잔 점
// 격자를 주기로 감싸는 값 잡음이라 이어 붙여도 이음매가 없습니다.
function tileNoise(N, cells, seed) {
  const h = (i, j) => {
    i = ((i % cells) + cells) % cells;
    j = ((j % cells) + cells) % cells;
    let v = (i * 374761393 + j * 668265263 + seed * 982451653) | 0;
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  };
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const fx = (x / N) * cells;
      const fy = (y / N) * cells;
      const i = Math.floor(fx);
      const j = Math.floor(fy);
      let u = fx - i;
      let v = fy - j;
      u = u * u * (3 - 2 * u);
      v = v * v * (3 - 2 * v);
      const a = h(i, j);
      const b = h(i + 1, j);
      const c = h(i, j + 1);
      const d = h(i + 1, j + 1);
      out[y * N + x] = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
  }
  return out;
}
export function detailCanvas() {
  const N = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const img = g.createImageData(N, N);
  const d = img.data;
  const a1 = tileNoise(N, 32, 1);
  const a2 = tileNoise(N, 64, 2);
  const b1 = tileNoise(N, 4, 3);
  const b2 = tileNoise(N, 8, 4);
  const c1 = tileNoise(N, 128, 5);
  for (let i = 0; i < N * N; i++) {
    const k = i * 4;
    d[k] = (a1[i] * 0.6 + a2[i] * 0.4) * 255;
    d[k + 1] = (b1[i] * 0.65 + b2[i] * 0.35) * 255;
    d[k + 2] = c1[i] * 255;
    d[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return cv;
}

// 물결 법선 텍스처(반복): 주기 잡음 세 겹을 높이로 보고 법선을 구합니다
export function waterNormalCanvas() {
  const N = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const img = g.createImageData(N, N);
  const d = img.data;
  const a = tileNoise(N, 8, 21);
  const b = tileNoise(N, 16, 22);
  const c = tileNoise(N, 32, 23);
  const H = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) H[i] = a[i] * 0.55 + b[i] * 0.3 + c[i] * 0.15;
  const at = (x, y) => H[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const nx = -(at(x + 1, y) - at(x - 1, y)) * 22;
      const ny = -(at(x, y + 1) - at(x, y - 1)) * 22;
      const L = Math.hypot(nx, ny, 1);
      const k = (y * N + x) * 4;
      d[k] = (nx / L * 0.5 + 0.5) * 255;
      d[k + 1] = (ny / L * 0.5 + 0.5) * 255;
      d[k + 2] = (1 / L * 0.5 + 0.5) * 255;
      d[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}

// 구름 한 장
export function cloudCanvas(seed) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 256;
  const g = cv.getContext('2d');
  const r = mulberry(seed);
  for (let i = 0; i < 30; i++) {
    const x = 512 * (0.16 + r() * 0.68);
    const y = 256 * (0.42 + r() * 0.26);
    const rr = 36 + r() * 70;
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, 'rgba(255,255,255,.5)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 512, 256);
  }
  return cv;
}
