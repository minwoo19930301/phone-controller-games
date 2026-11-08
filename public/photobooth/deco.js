// 네컷 꾸미기: 펜 색·굵기, 스티커 목록, 낙서·스티커 그리기와 누르기 판정.
// 큰 화면과 폰이 같이 씁니다. 좌표는 판에 대한 비율(0~1)을 10000 배 한 정수로 주고받습니다(가볍고 기기마다 같음).
//
// 낙서  { t:'draw', id, sh, slot, c: 색, w: 굵기(판 너비 비율), b: 'pen'|'neon', p: [x0,y0,x1,y1,...] }
// 스티커 { t:'stk',  id, sh, slot, k: 스티커 키, x, y(중심, 0~1), s: 크기(판 너비 비율), r: 회전(라디안) }

import { EMOJI_FONT, SANS, ANTON, rrect } from './frames.js';

export const Q = 10000; // 좌표 정수 배율

export const PEN_COLORS = ['#ffffff', '#16161a', '#ff4f7b', '#ff9f1c', '#ffe14f', '#5ee07a', '#3ab4ff', '#a271ff'];
export const PEN_SIZES = [
  { id: 's', label: '가늘게', w: 0.0075 },
  { id: 'm', label: '보통', w: 0.015 },
  { id: 'l', label: '굵게', w: 0.028 }
];
export const BRUSHES = [
  { id: 'pen', label: '펜' },
  { id: 'neon', label: '네온' }
];

// 이모지는 기기 글꼴로, 글자 스티커는 직접 그려 어느 기기에서나 같은 모양이 되게 합니다.
export const STICKERS = [
  { k: 'heart', e: '❤️' }, { k: 'sparkle', e: '✨' }, { k: 'love', e: '🥰' }, { k: 'cool', e: '😎' },
  { k: 'lol', e: '🤣' }, { k: 'wow', e: '😲' }, { k: 'crown', e: '👑' }, { k: 'ribbon', e: '🎀' },
  { k: 'star', e: '⭐' }, { k: 'bunny', e: '🐰' }, { k: 'bear', e: '🐻' }, { k: 'cat', e: '🐱' },
  { k: 'flower', e: '🌸' }, { k: 'fire', e: '🔥' }, { k: 'party', e: '🎉' }, { k: 'v', e: '✌️' },
  { k: 'hearts', e: '💕' }, { k: 'hundred', e: '💯' }, { k: 'rainbow', e: '🌈' }, { k: 'clover', e: '🍀' },
  { k: 'w-bff', word: 'BFF', bg: '#ff4f7b', fg: '#ffffff', anton: true },
  { k: 'w-love', word: 'LOVE', bg: '#ffffff', fg: '#ff3d77', anton: true },
  { k: 'w-best', word: '최고!', bg: '#ffe14f', fg: '#1a1400' },
  { k: 'w-omg', word: 'OMG', bg: '#3ab4ff', fg: '#ffffff', anton: true },
  { k: 'w-cheese', word: '치즈~', bg: '#ffffff', fg: '#ff8a1f' },
  { k: 'w-us', word: '우리 사이', bg: '#a271ff', fg: '#ffffff' }
];
export const STICKER = Object.fromEntries(STICKERS.map((s) => [s.k, s]));

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** 정수 좌표 배열 → [[x,y], ...] (판 단위) */
function pointsOf(p, W, H) {
  const out = [];
  for (let i = 0; i + 1 < p.length; i += 2) out.push([(p[i] / Q) * W, (p[i + 1] / Q) * H]);
  return out;
}

function strokePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 2) { ctx.lineTo(pts[1][0], pts[1][1]); return; }
  // 가운데 점을 이어 부드럽게
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
}

export function drawStroke(ctx, it, W, H) {
  if (!it.p || it.p.length < 2) return;
  const pts = pointsOf(it.p, W, H);
  const lw = Math.max(1, (it.w || 0.015) * W);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (pts.length === 1) {
    // 콕 찍은 점
    const [x, y] = pts[0];
    if (it.b === 'neon') { ctx.shadowColor = it.c; ctx.shadowBlur = lw * 1.4; }
    ctx.fillStyle = it.c || '#fff';
    ctx.beginPath();
    ctx.arc(x, y, lw / 2, 0, Math.PI * 2);
    ctx.fill();
    if (it.b === 'neon') {
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.beginPath();
      ctx.arc(x, y, lw * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  strokePath(ctx, pts);
  if (it.b === 'neon') {
    ctx.shadowColor = it.c;
    ctx.shadowBlur = lw * 1.5;
    ctx.strokeStyle = it.c;
    ctx.lineWidth = lw;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = lw * 0.38;
    ctx.stroke();
  } else {
    ctx.strokeStyle = it.c || '#fff';
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  ctx.restore();
}

/** 글자 스티커 크기(가로, 세로) — 판 단위 */
function wordBox(ctx, st, size) {
  const fs = size * 0.36;
  ctx.font = st.anton ? `400 ${fs}px ${ANTON}` : `900 ${fs}px ${SANS}`;
  const tw = ctx.measureText(st.word).width;
  return { fs, w: tw + fs * 1.15, h: fs * 1.55 };
}

export function drawSticker(ctx, it, W, H, o = {}) {
  const st = STICKER[it.k];
  if (!st) return;
  const size = (it.s || 0.2) * W;
  ctx.save();
  ctx.translate((it.x / Q) * W, (it.y / Q) * H);
  ctx.rotate(it.r || 0);
  if (st.e) {
    ctx.font = `${size * 0.82}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,.28)';
    ctx.shadowBlur = size * 0.06;
    ctx.shadowOffsetY = size * 0.02;
    ctx.fillText(st.e, 0, size * 0.04);
  } else {
    const b = wordBox(ctx, st, size);
    ctx.shadowColor = 'rgba(0,0,0,.3)';
    ctx.shadowBlur = size * 0.07;
    ctx.shadowOffsetY = size * 0.025;
    ctx.fillStyle = st.bg;
    rrect(ctx, -b.w / 2, -b.h / 2, b.w, b.h, b.h / 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = Math.max(2, size * 0.035);
    ctx.strokeStyle = st.bg === '#ffffff' ? st.fg : '#ffffff';
    rrect(ctx, -b.w / 2 + ctx.lineWidth / 2, -b.h / 2 + ctx.lineWidth / 2, b.w - ctx.lineWidth, b.h - ctx.lineWidth, b.h / 2);
    ctx.stroke();
    ctx.fillStyle = st.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(st.word, 0, b.fs * (st.anton ? 0.06 : 0.04));
  }
  if (o.selected) {
    const half = stickerHalf(ctx, it, W);
    ctx.shadowColor = 'transparent';
    ctx.setLineDash([size * 0.06, size * 0.05]);
    ctx.lineWidth = Math.max(1.5, size * 0.018);
    ctx.strokeStyle = o.color || '#ffffff';
    ctx.strokeRect(-half.w - size * 0.05, -half.h - size * 0.05, (half.w + size * 0.05) * 2, (half.h + size * 0.05) * 2);
  }
  ctx.restore();
}

/** 스티커의 반폭·반높이(회전 전, 판 단위) */
export function stickerHalf(ctx, it, W) {
  const st = STICKER[it.k];
  const size = (it.s || 0.2) * W;
  if (!st || st.e) return { w: size * 0.48, h: size * 0.48 };
  const b = wordBox(ctx, st, size);
  return { w: b.w / 2, h: b.h / 2 };
}

/** (x, y) 판 단위 점이 스티커 안인지 */
export function hitSticker(ctx, it, x, y, W, H, pad = 0) {
  const cx = (it.x / Q) * W;
  const cy = (it.y / Q) * H;
  const a = -(it.r || 0);
  const dx = x - cx;
  const dy = y - cy;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  const h = stickerHalf(ctx, it, W);
  return Math.abs(lx) <= h.w + pad && Math.abs(ly) <= h.h + pad;
}

/** 꾸미기 하나 그리기 */
export function drawItem(ctx, it, W, H, o) {
  if (it.t === 'draw') drawStroke(ctx, it, W, H);
  else if (it.t === 'stk') drawSticker(ctx, it, W, H, o);
}

/** 판 하나의 꾸미기 전부(들어온 순서대로) */
export function drawItems(ctx, items, W, H, o = {}) {
  for (const it of items) drawItem(ctx, it, W, H, o.selected && o.selected === it.id ? { selected: true, color: o.color } : undefined);
}

/** 받은 꾸미기 값을 안전한 모양으로 다듬습니다(화면이 폰 값을 믿지 않도록). */
export function cleanItem(d, slot) {
  if (!d || typeof d !== 'object') return null;
  const id = String(d.id || '').slice(0, 40);
  if (!id) return null;
  const sh = Number(d.sh) || 0;
  if (d.t === 'stk' || d.k != null) {
    if (!STICKER[d.k]) return null;
    return {
      t: 'stk', id, sh, slot, k: d.k,
      x: clamp(Math.round(Number(d.x) || 0), -2000, Q + 2000),
      y: clamp(Math.round(Number(d.y) || 0), -2000, Q + 2000),
      s: clamp(Number(d.s) || 0.2, 0.04, 1.2),
      r: clamp(Number(d.r) || 0, -20, 20)
    };
  }
  const c = /^#[0-9a-f]{3,8}$/i.test(String(d.c || '')) ? d.c : '#ffffff';
  return { t: 'draw', id, sh, slot, c, w: clamp(Number(d.w) || 0.015, 0.002, 0.08), b: d.b === 'neon' ? 'neon' : 'pen', p: [] };
}

/** 점 묶음을 정수 배열로 다듬기 */
export function cleanPoints(p, max = 4000) {
  if (!Array.isArray(p)) return [];
  const out = [];
  for (let i = 0; i + 1 < p.length && out.length < max; i += 2) {
    const x = Math.round(Number(p[i]));
    const y = Math.round(Number(p[i + 1]));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push(clamp(x, -1000, Q + 1000), clamp(y, -1000, Q + 1000));
  }
  return out;
}
