// 네컷 사진관 프레임: 테마 5개(블랙·화이트·파스텔·필름·네온), 판 모양(세로 네컷 / 2×2), 판 그리기.
// 큰 화면(실시간 화면·최종 PNG)과 폰(프레임 고르기 견본)이 같이 씁니다. 좌표는 모두 판 단위(px)입니다.
//
//   const sheet = makeSheet('strip', { cutSlots: [[1], [2], [1], [2]] });
//   drawSheet(ctx, sheet, 'pastel', { cell: (ci, sub) => ({ src: img }), date: new Date() });

// 세로 네컷(인생 사진 띠)과 2×2(포즈 미션). 컷 비율: 세로 네컷 672×490(가로가 긴 사진), 2×2 530×726(세로 사진)
export const STRIP = { w: 800, h: 2400, side: 64, top: 64, gap: 26, foot: 300 };
export const GRID = { w: 1200, h: 1800, side: 56, top: 56, gap: 28, foot: 264 };

export const MODES = [
  { id: 'together', name: '모두 한 장 네컷', short: '모두 한 장', desc: '한 명씩 돌아가며 찍어 한 장으로', tiny: '돌아가며 한 장', kind: 'strip' },
  { id: 'each', name: '각자 네컷', short: '각자 네컷', desc: '모두 동시에 네 번, 사람마다 한 줄', tiny: '한 사람 한 줄씩', kind: 'strip' },
  { id: 'pose', name: '포즈 미션', short: '포즈 미션', desc: '미션 포즈 네 번, 컷마다 다 같이', tiny: '미션 포즈 네 번', kind: 'grid' }
];
export const MODE = Object.fromEntries(MODES.map((m) => [m.id, m]));

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const SANS = '"Pretendard Variable",Pretendard,-apple-system,"Apple SD Gothic Neo",system-ui,sans-serif';
const ANTON = 'Anton,Impact,"Pretendard Variable",sans-serif';

// ---------- 판 모양 ----------
function cutsOf(kind) {
  const L = kind === 'grid' ? GRID : STRIP;
  const out = [];
  if (kind === 'grid') {
    const cw = (L.w - L.side * 2 - L.gap) / 2;
    const ch = (L.h - L.top - L.foot - L.gap) / 2;
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) out.push({ x: L.side + c * (cw + L.gap), y: L.top + r * (ch + L.gap), w: cw, h: ch });
  } else {
    const cw = L.w - L.side * 2;
    const ch = (L.h - L.top - L.foot - L.gap * 3) / 4;
    for (let i = 0; i < 4; i++) out.push({ x: L.side, y: L.top + i * (ch + L.gap), w: cw, h: ch });
  }
  return out;
}

/** 한 컷을 n 칸으로 나눕니다(포즈 미션 콜라주). 세로 컷은 위아래, 가로 컷은 좌우가 먼저입니다. */
export function splitRect(r, n, gap = 10) {
  const R = (x, y, w, h) => ({ x, y, w, h });
  if (n <= 1) return [R(r.x, r.y, r.w, r.h)];
  const portrait = r.h >= r.w;
  const hw = (r.w - gap) / 2;
  const hh = (r.h - gap) / 2;
  if (n === 2) return portrait ? [R(r.x, r.y, r.w, hh), R(r.x, r.y + hh + gap, r.w, hh)] : [R(r.x, r.y, hw, r.h), R(r.x + hw + gap, r.y, hw, r.h)];
  if (n === 3) {
    return portrait
      ? [R(r.x, r.y, r.w, hh), R(r.x, r.y + hh + gap, hw, hh), R(r.x + hw + gap, r.y + hh + gap, hw, hh)]
      : [R(r.x, r.y, hw, r.h), R(r.x + hw + gap, r.y, hw, hh), R(r.x + hw + gap, r.y + hh + gap, hw, hh)];
  }
  return [R(r.x, r.y, hw, hh), R(r.x + hw + gap, r.y, hw, hh), R(r.x, r.y + hh + gap, hw, hh), R(r.x + hw + gap, r.y + hh + gap, hw, hh)];
}

/**
 * 판 하나. kind = 'strip' | 'grid'. cutSlots[i] = 그 컷에 들어갈 자리 번호들(없으면 빈 칸 하나).
 * 반환: { id, kind, owner, w, h, cuts: [{ x, y, w, h, i, subs: [{ x, y, w, h, slot }] }], foot }
 */
export function makeSheet(kind, { id = 0, owner = null, cutSlots = [] } = {}) {
  const L = kind === 'grid' ? GRID : STRIP;
  const gap = kind === 'grid' ? 10 : 8;
  const cuts = cutsOf(kind).map((c, i) => {
    const slots = (cutSlots[i] || []).filter((s) => s != null);
    const rects = splitRect(c, Math.max(1, slots.length), gap);
    return { ...c, i, subs: rects.map((r, k) => ({ ...r, slot: slots[k] ?? null })) };
  });
  return { id, kind, owner, w: L.w, h: L.h, cuts, foot: { x: 0, y: L.h - L.foot, w: L.w, h: L.foot } };
}

/** 컷 비율(가로/세로) */
export const aspectOf = (r) => r.w / r.h;

// ---------- 그리기 도구 ----------
export function rrect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 원본 크기 */
export function srcSize(src) {
  if (!src) return [0, 0];
  return [src.videoWidth || src.naturalWidth || src.width || 0, src.videoHeight || src.naturalHeight || src.height || 0];
}

/** 칸을 꽉 채우게(가운데를 잘라) 그립니다. */
export function drawCover(ctx, src, r) {
  const [iw, ih] = srcSize(src);
  if (!iw || !ih) return false;
  const s = Math.max(r.w / iw, r.h / ih);
  const w = iw * s;
  const h = ih * s;
  try { ctx.drawImage(src, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h); } catch (e) { return false; }
  return true;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function text(ctx, str, x, y, o = {}) {
  ctx.save();
  ctx.font = o.font;
  ctx.textAlign = o.align || 'center';
  ctx.textBaseline = o.base || 'alphabetic';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${o.spacing || 0}px`;
  if (o.glow) {
    ctx.shadowColor = o.glow;
    ctx.shadowBlur = o.glowBlur || 18;
  }
  if (o.stroke) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = o.strokeW || 3;
    ctx.strokeStyle = o.stroke;
    ctx.strokeText(str, x, y);
  }
  if (o.color) {
    ctx.fillStyle = o.color;
    ctx.fillText(str, x, y);
  }
  ctx.restore();
}

function heartPath(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.32);
  ctx.bezierCurveTo(x - s * 0.62, y - s * 0.12, x - s * 0.34, y - s * 0.62, x, y - s * 0.26);
  ctx.bezierCurveTo(x + s * 0.34, y - s * 0.62, x + s * 0.62, y - s * 0.12, x, y + s * 0.32);
  ctx.closePath();
}
function starPath(ctx, x, y, r, inner = 0.45, n = 5, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const rr = i % 2 ? r * inner : r;
    const a = rot + (i * Math.PI) / n;
    ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}
function sparkPath(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.closePath();
}

export function fmtDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}
function stampDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `'${p(d.getFullYear() % 100)} ${p(d.getMonth() + 1)} ${p(d.getDate())}`;
}

// ---------- 테마 ----------
// 각 테마: bg(배경) · under(사진 칸 밑) · empty(빈 칸) · over(사진 위 장식) · 글자 색 · 사진 톤(filter)
const NEON = ['#3ee6ff', '#ff4fd8', '#ffe14f', '#7cff6b'];

export const THEMES = [
  {
    id: 'classic', name: '클래식 블랙', short: '블랙', swatch: ['#121214', '#f4f4f6'],
    radius: 6, ink: '#ffffff', sub: '#9d9da8', mark: '#62626c', emptyBg: '#1c1c21', emptyInk: '#3a3a42', title: '오늘, 우리',
    bg(ctx, s) {
      const g = ctx.createLinearGradient(0, 0, 0, s.h);
      g.addColorStop(0, '#17171a');
      g.addColorStop(1, '#0c0c0e');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s.w, s.h);
    }
  },
  {
    id: 'white', name: '화이트', short: '화이트', swatch: ['#fbfaf6', '#18181b'],
    radius: 8, ink: '#18181b', sub: '#8b877d', mark: '#b0aca1', emptyBg: '#ecebe5', emptyInk: '#cbc8be', title: '오늘, 우리',
    bg(ctx, s) {
      ctx.fillStyle = '#fbfaf6';
      ctx.fillRect(0, 0, s.w, s.h);
      // 종이결: 아주 옅은 점
      const r = rng(77 + s.id * 13);
      ctx.fillStyle = 'rgba(120,110,90,.05)';
      for (let i = 0; i < 260; i++) ctx.fillRect(r() * s.w, r() * s.h, 2, 2);
    },
    under(ctx, sub) {
      ctx.save();
      ctx.shadowColor = 'rgba(40,30,10,.18)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = '#ecebe5';
      rrect(ctx, sub.x, sub.y, sub.w, sub.h, 8);
      ctx.fill();
      ctx.restore();
    }
  },
  {
    id: 'pastel', name: '파스텔', short: '파스텔', swatch: ['#ffd9ea', '#b79bff'],
    radius: 24, ink: '#7a52ee', sub: '#ff5f9e', mark: '#a48bd8', emptyBg: 'rgba(255,255,255,.55)', emptyInk: '#cdb4ff', title: '♡ 오늘, 우리 ♡',
    bg(ctx, s) {
      const g = ctx.createLinearGradient(0, 0, s.w * 0.6, s.h);
      g.addColorStop(0, '#ffd6e8');
      g.addColorStop(0.5, '#e7dcff');
      g.addColorStop(1, '#cff3e6');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s.w, s.h);
      const r = rng(11 + s.id * 31);
      const u = s.w / 800;
      for (let i = 0; i < 70; i++) {
        const x = r() * s.w;
        const y = r() * s.h;
        const k = r();
        const size = (10 + r() * 22) * u;
        ctx.fillStyle = k < 0.4 ? 'rgba(255,255,255,.75)' : k < 0.7 ? 'rgba(255,143,190,.45)' : 'rgba(170,140,255,.42)';
        if (k < 0.45) heartPath(ctx, x, y, size);
        else if (k < 0.75) starPath(ctx, x, y, size * 0.5);
        else sparkPath(ctx, x, y, size * 0.5);
        ctx.fill();
      }
    },
    under(ctx, sub) {
      ctx.save();
      ctx.shadowColor = 'rgba(150,100,200,.25)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 5;
      ctx.fillStyle = '#ffffff';
      rrect(ctx, sub.x - 9, sub.y - 9, sub.w + 18, sub.h + 18, 30);
      ctx.fill();
      ctx.restore();
    },
    filter: 'brightness(1.05) saturate(.94)'
  },
  {
    id: 'film', name: '필름', short: '필름', swatch: ['#1a130e', '#ff8a2a'],
    radius: 3, ink: '#ff8a2a', sub: '#ffb070', mark: '#7d6a56', emptyBg: '#241b15', emptyInk: '#4c3b2d', title: 'PCG FILM 400', titleAnton: true,
    bg(ctx, s) {
      ctx.fillStyle = '#17110d';
      ctx.fillRect(0, 0, s.w, s.h);
      // 양옆 필름 구멍
      const u = s.w / 800;
      const hw = 26 * u;
      const hh = 18 * u;
      const pitch = 46 * u;
      const xs = s.kind === 'grid' ? [16 * u, s.w - 16 * u - hw] : [19 * u, s.w - 19 * u - hw];
      ctx.fillStyle = '#efe6d4';
      for (let y = 18 * u; y < s.h - hh; y += pitch) {
        for (const x of xs) {
          rrect(ctx, x, y, hw, hh, 4 * u);
          ctx.fill();
        }
      }
    },
    over(ctx, cut, ci, s) {
      // 필름 가장자리 인쇄: 프레임 번호
      const u = s.w / 800;
      const x = s.kind === 'grid' ? cut.x + (ci % 2 ? cut.w + 4 * u : -4 * u) : cut.x - 4 * u;
      ctx.save();
      ctx.translate(x + (s.kind === 'grid' && ci % 2 ? 9 * u : -9 * u), cut.y + cut.h / 2);
      ctx.rotate(-Math.PI / 2);
      text(ctx, `${ci + 1}  ▸ ${ci + 1}A`, 0, 0, { font: `400 ${14 * u}px ${ANTON}`, color: 'rgba(255,138,42,.85)', spacing: 3 * u, base: 'middle' });
      ctx.restore();
    },
    filter: 'sepia(.22) saturate(1.12) contrast(1.05)',
    grain: true
  },
  {
    id: 'neon', name: '네온', short: '네온', swatch: ['#0b0620', '#ff4fd8'],
    radius: 16, ink: '#ff6be0', sub: '#3ee6ff', mark: '#8f7cc8', emptyBg: '#140b2a', emptyInk: '#3b2a6a', title: 'FOUR CUTS', titleAnton: true, neon: true,
    bg(ctx, s) {
      ctx.fillStyle = '#0a0619';
      ctx.fillRect(0, 0, s.w, s.h);
      const g = ctx.createRadialGradient(s.w / 2, s.h * 0.45, 0, s.w / 2, s.h * 0.45, s.h * 0.7);
      g.addColorStop(0, 'rgba(120,40,200,.35)');
      g.addColorStop(1, 'rgba(10,6,25,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s.w, s.h);
      const u = s.w / 800;
      ctx.strokeStyle = 'rgba(140,90,255,.12)';
      ctx.lineWidth = 1.5 * u;
      ctx.beginPath();
      for (let x = 0; x <= s.w; x += 40 * u) { ctx.moveTo(x, 0); ctx.lineTo(x, s.h); }
      for (let y = 0; y <= s.h; y += 40 * u) { ctx.moveTo(0, y); ctx.lineTo(s.w, y); }
      ctx.stroke();
    },
    over(ctx, cut, ci, s, o) {
      const u = s.w / 800;
      const c = NEON[ci % NEON.length];
      const flick = o.t ? 0.85 + 0.15 * Math.sin(o.t * 7 + ci * 2.1) * Math.sin(o.t * 2.3 + ci) : 1;
      ctx.save();
      ctx.globalAlpha = flick;
      ctx.shadowColor = c;
      ctx.shadowBlur = 26 * u;
      ctx.strokeStyle = c;
      ctx.lineWidth = 5 * u;
      rrect(ctx, cut.x - 7 * u, cut.y - 7 * u, cut.w + 14 * u, cut.h + 14 * u, 20 * u);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,.8)';
      ctx.lineWidth = 1.6 * u;
      ctx.stroke();
      ctx.restore();
    },
    filter: 'saturate(1.22) contrast(1.06)'
  }
];
export const THEME = Object.fromEntries(THEMES.map((t) => [t.id, t]));

// ---------- 판 그리기 ----------
/**
 * o: {
 *   cell(ci, sub) → { src, alpha?, zoom?, rot?, develop?, flash?, live? } | null  — 칸에 그릴 사진(또는 실시간 미리보기)
 *   label(ci, sub) → { text, color } | null — 빈 칸 이름표
 *   highlight: 지금 찍는 컷 번호(빛나는 테두리), t: 초(움직이는 장식), date: Date,
 *   players: [{ color }] 바닥 점, owner: { name, color } 각자 네컷 주인, final: true 면 화면용 표시(LIVE 등) 없음
 * }
 */
export function drawSheet(ctx, sheet, themeId, o = {}) {
  const th = THEME[themeId] || THEMES[0];
  const u = sheet.w / 800;
  ctx.save();
  th.bg(ctx, sheet, o);
  sheet.cuts.forEach((cut, ci) => {
    for (const sub of cut.subs) {
      if (th.under) th.under(ctx, sub, ci, sheet, o);
      ctx.save();
      rrect(ctx, sub.x, sub.y, sub.w, sub.h, th.radius * u);
      ctx.clip();
      ctx.fillStyle = th.emptyBg;
      ctx.fillRect(sub.x, sub.y, sub.w, sub.h);
      const cell = o.cell ? o.cell(ci, sub) : null;
      if (cell && cell.src) drawCell(ctx, cell, sub, th, u, o);
      else drawEmpty(ctx, sub, ci, th, u, o.label ? o.label(ci, sub) : null, cut.subs.length);
      ctx.restore();
    }
    if (th.over) th.over(ctx, cut, ci, sheet, o);
    if (o.highlight === ci && !o.final) {
      const pulse = 0.55 + 0.45 * Math.sin((o.t || 0) * 6);
      ctx.save();
      ctx.strokeStyle = `rgba(255,255,255,${0.5 + 0.5 * pulse})`;
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 20 * u;
      ctx.lineWidth = 6 * u;
      rrect(ctx, cut.x - 3 * u, cut.y - 3 * u, cut.w + 6 * u, cut.h + 6 * u, (th.radius + 3) * u);
      ctx.stroke();
      ctx.restore();
    }
  });
  if (th.id === 'film') filmStamp(ctx, sheet, u, o.date);
  drawFoot(ctx, sheet, th, u, o);
  ctx.restore();
}

function drawCell(ctx, cell, sub, th, u, o) {
  ctx.save();
  if (cell.alpha != null) ctx.globalAlpha = Math.max(0, Math.min(1, cell.alpha));
  const z = cell.zoom || 1;
  const rot = cell.rot || 0;
  if (z !== 1 || rot) {
    const cx = sub.x + sub.w / 2;
    const cy = sub.y + sub.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.scale(z, z);
    ctx.translate(-cx, -cy);
  }
  if (th.filter && 'filter' in ctx && !cell.live && !cell.baked) ctx.filter = th.filter;
  drawCover(ctx, cell.src, sub);
  if ('filter' in ctx) ctx.filter = 'none';
  ctx.restore();
  if (th.grain && !cell.live) grain(ctx, sub, u);
  if (cell.develop > 0) {
    ctx.fillStyle = `rgba(255,251,244,${Math.min(1, cell.develop) * 0.92})`;
    ctx.fillRect(sub.x, sub.y, sub.w, sub.h);
  }
  if (cell.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, cell.flash)})`;
    ctx.fillRect(sub.x, sub.y, sub.w, sub.h);
  }
  if (cell.live && !o.final) {
    // 실시간 표시
    const s = Math.max(0.7, Math.min(1.6, sub.w / 300)) * u;
    const bx = sub.x + 12 * s;
    const by = sub.y + 12 * s;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    rrect(ctx, bx, by, 64 * s, 24 * s, 12 * s);
    ctx.fill();
    const on = Math.sin((o.t || 0) * 5) > -0.3;
    ctx.fillStyle = on ? '#ff3b4d' : 'rgba(255,59,77,.35)';
    ctx.beginPath();
    ctx.arc(bx + 13 * s, by + 12 * s, 5 * s, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, 'LIVE', bx + 40 * s, by + 17 * s, { font: `400 ${14 * s}px ${ANTON}`, color: '#fff', spacing: 1.5 * s });
    ctx.restore();
  }
}

const grainCache = new Map();
function grain(ctx, sub, u) {
  // 필름 입자: 작은 무늬 하나를 반복
  const k = Math.round(64 * u);
  let pat = grainCache.get(k);
  if (!pat) {
    const c = document.createElement('canvas');
    c.width = c.height = k;
    const g = c.getContext('2d');
    const r = rng(5);
    for (let i = 0; i < k * k * 0.18; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(255,240,220,.08)' : 'rgba(0,0,0,.1)';
      g.fillRect(r() * k, r() * k, 1.4 * u, 1.4 * u);
    }
    pat = c;
    grainCache.set(k, pat);
  }
  ctx.save();
  ctx.fillStyle = ctx.createPattern(pat, 'repeat');
  ctx.fillRect(sub.x, sub.y, sub.w, sub.h);
  // 가장자리 어둡게(비네팅)
  const g = ctx.createRadialGradient(sub.x + sub.w / 2, sub.y + sub.h / 2, Math.min(sub.w, sub.h) * 0.35, sub.x + sub.w / 2, sub.y + sub.h / 2, Math.max(sub.w, sub.h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(20,8,0,.32)');
  ctx.fillStyle = g;
  ctx.fillRect(sub.x, sub.y, sub.w, sub.h);
  ctx.restore();
}

function drawEmpty(ctx, sub, ci, th, u, label, n) {
  // 빈 칸: 컷 번호 + 카메라 그림 + (누구 차례인지)
  const s = Math.min(sub.w, sub.h);
  const cx = sub.x + sub.w / 2;
  const cy = sub.y + sub.h / 2;
  ctx.save();
  if (th.neon) {
    ctx.strokeStyle = NEON[ci % NEON.length];
    ctx.globalAlpha = 0.28;
  } else ctx.strokeStyle = th.emptyInk;
  ctx.lineWidth = Math.max(2, s * 0.018);
  ctx.lineJoin = 'round';
  const w = s * 0.34;
  const h = w * 0.68;
  const y0 = cy - h * 0.62;
  rrect(ctx, cx - w / 2, y0, w, h, w * 0.12);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, y0 + h / 2, h * 0.28, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.18, y0);
  ctx.lineTo(cx - w * 0.12, y0 - h * 0.14);
  ctx.lineTo(cx + w * 0.12, y0 - h * 0.14);
  ctx.lineTo(cx + w * 0.18, y0);
  ctx.stroke();
  ctx.globalAlpha = 1;
  if (label && label.text) {
    const fs = Math.max(14, s * 0.13);
    ctx.font = `400 ${fs}px ${ANTON}`;
    const tw = ctx.measureText(label.text).width + fs * 0.9;
    const by = y0 + h + s * 0.07;
    ctx.fillStyle = label.color || '#fff';
    rrect(ctx, cx - tw / 2, by, tw, fs * 1.35, fs * 0.68);
    ctx.fill();
    text(ctx, label.text, cx, by + fs * 1.03, { font: `400 ${fs}px ${ANTON}`, color: '#0b0f17', spacing: fs * 0.04 });
    if (label.sub) text(ctx, label.sub, cx, by + fs * 1.35 + s * 0.09, { font: `700 ${Math.max(11, s * 0.065)}px ${SANS}`, color: th.neon ? '#bfb0ee' : th.emptyInk });
  } else if (n <= 1) {
    text(ctx, String(ci + 1), cx, y0 + h + s * 0.2, { font: `400 ${s * 0.15}px ${ANTON}`, color: th.neon ? NEON[ci % NEON.length] : th.emptyInk, spacing: 2 });
  }
  ctx.restore();
}

function filmStamp(ctx, sheet, u, date) {
  // 옛날 필름 카메라 날짜 찍힘(마지막 컷 오른쪽 아래)
  const cut = sheet.cuts[sheet.cuts.length - 1];
  const sub = cut.subs[cut.subs.length - 1];
  const fs = Math.max(16, Math.min(sub.w, sub.h) * 0.075);
  text(ctx, stampDate(date), sub.x + sub.w - fs * 0.7, sub.y + sub.h - fs * 0.7, {
    font: `400 ${fs}px ${ANTON}`, color: '#ff8a1f', align: 'right', spacing: fs * 0.12, glow: 'rgba(255,120,20,.9)', glowBlur: fs * 0.5
  });
}

function drawFoot(ctx, sheet, th, u, o) {
  const f = sheet.foot;
  const date = fmtDate(o.date || new Date());
  const players = (o.players || []).filter(Boolean);
  const titleFont = th.titleAnton ? `400 ${74 * u}px ${ANTON}` : `900 ${62 * u}px ${SANS}`;
  const neonTitle = th.neon ? { glow: th.ink, glowBlur: 26 * u, stroke: 'rgba(255,255,255,.85)', strokeW: 1.5 * u } : {};
  const markFont = `800 ${15 * u}px ${SANS}`;
  if (sheet.kind === 'grid') {
    // 2×2: 왼쪽 제목, 오른쪽 날짜·표시
    const k = sheet.w / 1200;
    const y = f.y + f.h * 0.5;
    const tf = th.titleAnton ? `400 ${84 * k}px ${ANTON}` : `900 ${70 * k}px ${SANS}`;
    text(ctx, th.title, 70 * k, y + 26 * k, { font: tf, color: th.ink, align: 'left', spacing: th.titleAnton ? 4 * k : -1 * k, ...(th.neon ? { glow: th.ink, glowBlur: 26 * k, stroke: 'rgba(255,255,255,.85)', strokeW: 1.5 * k } : {}) });
    text(ctx, date, sheet.w - 70 * k, y - 4 * k, { font: `400 ${40 * k}px ${ANTON}`, color: th.sub, align: 'right', spacing: 6 * k, ...(th.neon ? { glow: th.sub, glowBlur: 16 * k } : {}) });
    text(ctx, 'PHONE CONTROLLER GAMES', sheet.w - 70 * k, y + 40 * k, { font: `800 ${17 * k}px ${SANS}`, color: th.mark, align: 'right', spacing: 5 * k });
    dots(ctx, players, sheet.w - 70 * k, y - 68 * k, 9 * k, 'right');
    return;
  }
  const cx = sheet.w / 2;
  let y = f.y + 108 * u;
  if (o.owner) {
    // 각자 네컷: 주인 표시
    const fs = 30 * u;
    ctx.font = `400 ${fs}px ${ANTON}`;
    const tw = ctx.measureText(o.owner.name).width + fs * 1.1;
    ctx.fillStyle = o.owner.color || '#fff';
    rrect(ctx, cx - tw / 2, f.y + 16 * u, tw, fs * 1.4, fs * 0.7);
    ctx.fill();
    text(ctx, o.owner.name, cx, f.y + 16 * u + fs * 1.08, { font: `400 ${fs}px ${ANTON}`, color: '#0b0f17', spacing: 2 * u });
    y += 30 * u;
  }
  text(ctx, th.title, cx, y, { font: titleFont, color: th.ink, spacing: th.titleAnton ? 5 * u : -1 * u, ...neonTitle });
  text(ctx, date, cx, y + 58 * u, { font: `400 ${30 * u}px ${ANTON}`, color: th.sub, spacing: 6 * u, ...(th.neon ? { glow: th.sub, glowBlur: 14 * u } : {}) });
  text(ctx, 'PHONE CONTROLLER GAMES', cx, y + 100 * u, { font: markFont, color: th.mark, spacing: 5 * u });
  if (!o.owner) dots(ctx, players, cx, f.y + 30 * u, 8 * u, 'center');
}

function dots(ctx, players, x, y, r, align) {
  if (!players.length) return;
  const gap = r * 3;
  const total = (players.length - 1) * gap;
  const x0 = align === 'right' ? x - total : x - total / 2;
  players.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(x0 + i * gap, y, r, 0, Math.PI * 2);
    ctx.fillStyle = p.color || '#fff';
    ctx.fill();
  });
}

/** 프레임 고르기 견본(작은 판). 사진 대신 테마 색 실루엣을 그립니다. */
export function drawSwatch(ctx, themeId, kind, w, h) {
  const sheet = makeSheet(kind, { cutSlots: [[1], [2], [3], [4]] });
  const s = Math.min(w / sheet.w, h / sheet.h);
  ctx.save();
  ctx.translate((w - sheet.w * s) / 2, (h - sheet.h * s) / 2);
  ctx.scale(s, s);
  drawSheet(ctx, sheet, themeId, { cell: (ci, sub) => ({ src: silhouette(ci), live: false }), final: true, date: new Date() });
  ctx.restore();
}

const silCache = new Map();
/** 견본용 사람 실루엣 그림(컷마다 색이 다름) */
export function silhouette(i) {
  if (silCache.has(i)) return silCache.get(i);
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 160;
  const g = c.getContext('2d');
  const cols = [['#ffb3c1', '#ff5a5f'], ['#b3e1ff', '#3ab4ff'], ['#ffe9a8', '#ffc93c'], ['#c4f5cf', '#5ee07a']][i % 4];
  const bg = g.createLinearGradient(0, 0, 0, 160);
  bg.addColorStop(0, cols[0]);
  bg.addColorStop(1, '#ffffff');
  g.fillStyle = bg;
  g.fillRect(0, 0, 160, 160);
  g.fillStyle = cols[1];
  g.beginPath();
  g.arc(80, 70, 30, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(80, 168, 60, 52, 0, Math.PI, 0);
  g.fill();
  silCache.set(i, c);
  return c;
}

export { EMOJI_FONT, SANS, ANTON, heartPath, starPath, sparkPath, rng };
