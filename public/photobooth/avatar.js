// 시험용 가짜 셀카: 캔버스로 그린 만화 얼굴입니다. 봇(?bots=N)과 카메라 없는 시험 폰(?fakecam=1)이 씁니다.
// 진짜 사진처럼 보이지 않게 일부러 단순한 그림체 + 'BOT'/'시험' 표시를 붙입니다.

import { SANS, ANTON, heartPath, rrect } from './frames.js';

// 포즈 미션 목록. 마지막 컷은 늘 '단체 손하트'로 끝냅니다.
export const POSES = [
  { k: 'cheek', text: '볼하트', e: '🥰', tip: '주먹 쥔 손을 볼에 대고 하트!' },
  { k: 'wow', text: '깜짝 놀란 얼굴', e: '😲', tip: '입을 크게 벌리고 눈을 동그랗게' },
  { k: 'v', text: '브이', e: '✌️', tip: '손가락 두 개로 브이!' },
  { k: 'flower', text: '꽃받침', e: '🌸', tip: '두 손으로 턱을 받쳐요' },
  { k: 'wink', text: '윙크', e: '😉', tip: '한쪽 눈을 찡긋' },
  { k: 'tongue', text: '메롱', e: '😛', tip: '혀를 살짝 내밀어요' },
  { k: 'thumbs', text: '엄지 척', e: '👍', tip: '엄지를 번쩍!' },
  { k: 'cool', text: '시크하게', e: '😎', tip: '웃지 말고 멋있게' },
  { k: 'fight', text: '파이팅!', e: '💪', tip: '주먹 쥐고 힘차게' }
];
export const GROUP_HEART = { k: 'heart', text: '단체 손하트', e: '💞', tip: '다 같이 손으로 큰 하트!' };
export const POSE = Object.fromEntries([...POSES, GROUP_HEART].map((p) => [p.k, p]));

// 자리마다 다른 생김새
const LOOKS = {
  1: { skin: '#ffd7bf', hair: '#3b2a24', style: 'bob', shirt: '#ff5a5f', bg: ['#ffe3e4', '#fff6f0'] },
  2: { skin: '#f6c9a6', hair: '#141418', style: 'spiky', shirt: '#3ab4ff', bg: ['#dcf1ff', '#f5fbff'] },
  3: { skin: '#ffdcc6', hair: '#a8562a', style: 'long', shirt: '#ffc93c', bg: ['#fff3cf', '#fffaf0'] },
  4: { skin: '#e9b48e', hair: '#2a1e1a', style: 'bun', shirt: '#5ee07a', bg: ['#dcf8e3', '#f4fff7'] }
};

/**
 * 가짜 셀카 한 장. (w, h) 캔버스 크기, o: { slot, t(초), pose, badge('BOT'|'시험'), color }
 * 얼굴은 짧은 변 기준으로 가운데에 그려서 가로·세로 어느 칸에 잘라 넣어도 보입니다.
 */
export function drawAvatar(ctx, w, h, o = {}) {
  const L = LOOKS[((o.slot || 1) - 1) % 4 + 1];
  const t = o.t || 0;
  const pose = o.pose || 'smile';
  const m = Math.min(w, h);
  // 배경: 방 벽 + 흐린 조명
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, L.bg[0]);
  bg.addColorStop(1, L.bg[1]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) {
    const x = ((i * 0.37 + 0.13) % 1) * w;
    const y = ((i * 0.53 + 0.21) % 1) * h * 0.6;
    const r = m * (0.05 + (i % 3) * 0.03);
    ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.15 * Math.sin(t * 0.8 + i)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const bob = Math.sin(t * 1.6 + (o.slot || 1)) * m * 0.012;
  const tilt = (pose === 'cool' ? -0.08 : pose === 'wink' ? 0.1 : Math.sin(t * 0.9 + (o.slot || 0)) * 0.04);
  const cx = w / 2;
  const cy = h * 0.5 + bob;
  const R = m * 0.27; // 얼굴 반지름
  // 몸
  ctx.fillStyle = L.shirt;
  ctx.beginPath();
  ctx.ellipse(cx, cy + R * 2.25, R * 1.75, R * 1.15, 0, Math.PI, 0);
  ctx.lineTo(cx + R * 1.75, h + 2);
  ctx.lineTo(cx - R * 1.75, h + 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = L.skin;
  ctx.fillRect(cx - R * 0.28, cy + R * 0.7, R * 0.56, R * 0.6);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  // 뒷머리
  ctx.fillStyle = L.hair;
  if (L.style === 'long') {
    rrect(ctx, -R * 1.12, -R * 0.7, R * 2.24, R * 2.05, R * 0.6);
    ctx.fill();
  } else if (L.style === 'bob') {
    rrect(ctx, -R * 1.1, -R * 0.75, R * 2.2, R * 1.55, R * 0.5);
    ctx.fill();
  } else if (L.style === 'bun') {
    ctx.beginPath();
    ctx.arc(0, -R * 1.18, R * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }
  // 얼굴
  ctx.fillStyle = L.skin;
  ctx.beginPath();
  ctx.ellipse(0, 0, R * 0.95, R * 1.04, 0, 0, Math.PI * 2);
  ctx.fill();
  // 귀
  ctx.beginPath();
  ctx.ellipse(-R * 0.95, R * 0.08, R * 0.14, R * 0.2, 0, 0, Math.PI * 2);
  ctx.ellipse(R * 0.95, R * 0.08, R * 0.14, R * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  // 앞머리
  ctx.fillStyle = L.hair;
  ctx.beginPath();
  if (L.style === 'spiky') {
    ctx.moveTo(-R * 1.0, -R * 0.2);
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI + (i / 6) * Math.PI;
      const rr = i % 2 ? R * 1.28 : R * 1.06;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr - R * 0.1);
    }
    ctx.lineTo(R * 1.0, -R * 0.2);
    ctx.quadraticCurveTo(0, -R * 0.62, -R * 1.0, -R * 0.2);
  } else {
    ctx.ellipse(0, -R * 0.42, R * 1.02, R * 0.72, 0, Math.PI * 1.02, Math.PI * 1.98);
    ctx.quadraticCurveTo(R * 0.3, -R * 0.5, -R * 0.1, -R * 0.34);
    ctx.quadraticCurveTo(-R * 0.6, -R * 0.22, -R * 1.0, -R * 0.36);
  }
  ctx.fill();
  // 볼터치
  ctx.fillStyle = 'rgba(255,110,130,.32)';
  ctx.beginPath();
  ctx.ellipse(-R * 0.55, R * 0.3, R * 0.2, R * 0.12, 0, 0, Math.PI * 2);
  ctx.ellipse(R * 0.55, R * 0.3, R * 0.2, R * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  // 눈
  const blink = !o.still && ((t + (o.slot || 0) * 0.7) % 3.4) < 0.13;
  const eye = (x, closed, big) => {
    ctx.fillStyle = '#1d1b22';
    ctx.strokeStyle = '#1d1b22';
    ctx.lineCap = 'round';
    ctx.lineWidth = R * 0.07;
    if (closed) {
      ctx.beginPath();
      ctx.arc(x, R * 0.0, R * 0.12, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      return;
    }
    const r = big ? R * 0.15 : R * 0.1;
    ctx.beginPath();
    ctx.ellipse(x, -R * 0.02, r, r * 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x + r * 0.35, -R * 0.02 - r * 0.45, r * 0.33, 0, Math.PI * 2);
    ctx.fill();
  };
  if (pose === 'cool') {
    // 선글라스
    ctx.fillStyle = '#121216';
    rrect(ctx, -R * 0.72, -R * 0.2, R * 0.6, R * 0.36, R * 0.14);
    ctx.fill();
    rrect(ctx, R * 0.12, -R * 0.2, R * 0.6, R * 0.36, R * 0.14);
    ctx.fill();
    ctx.fillRect(-R * 0.14, -R * 0.12, R * 0.28, R * 0.06);
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.fillRect(-R * 0.6, -R * 0.14, R * 0.18, R * 0.05);
  } else {
    eye(-R * 0.38, blink, pose === 'wow');
    if (pose === 'wink') {
      ctx.strokeStyle = '#1d1b22';
      ctx.lineWidth = R * 0.07;
      ctx.beginPath();
      ctx.moveTo(R * 0.26, -R * 0.06);
      ctx.lineTo(R * 0.48, R * 0.02);
      ctx.lineTo(R * 0.26, R * 0.08);
      ctx.stroke();
    } else eye(R * 0.38, blink, pose === 'wow');
  }
  // 입
  ctx.lineCap = 'round';
  ctx.lineWidth = R * 0.07;
  ctx.strokeStyle = '#7a2b35';
  ctx.fillStyle = '#7a2b35';
  if (pose === 'wow') {
    ctx.beginPath();
    ctx.ellipse(0, R * 0.48, R * 0.17, R * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (pose === 'tongue') {
    ctx.beginPath();
    ctx.arc(0, R * 0.36, R * 0.24, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = '#ff7a8a';
    ctx.beginPath();
    ctx.ellipse(R * 0.04, R * 0.62, R * 0.12, R * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (pose === 'cool') {
    ctx.beginPath();
    ctx.moveTo(-R * 0.16, R * 0.5);
    ctx.lineTo(R * 0.2, R * 0.46);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(-R * 0.3, R * 0.38);
    ctx.quadraticCurveTo(0, R * 0.78, R * 0.3, R * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(-R * 0.2, R * 0.38, R * 0.4, R * 0.08);
  }
  ctx.restore();

  // 손 포즈
  const fist = (x, y, r) => {
    ctx.fillStyle = L.skin;
    ctx.strokeStyle = 'rgba(120,60,40,.35)';
    ctx.lineWidth = r * 0.12;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.86, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };
  const finger = (x, y, len, ang, r) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = L.skin;
    ctx.strokeStyle = 'rgba(120,60,40,.35)';
    ctx.lineWidth = r * 0.25;
    rrect(ctx, -r / 2, -len, r, len, r / 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
  const hr = R * 0.32;
  if (pose === 'v') {
    fist(cx + R * 1.25, cy + R * 0.75, hr);
    finger(cx + R * 1.15, cy + R * 0.55, R * 0.7, -0.25, hr * 0.42);
    finger(cx + R * 1.38, cy + R * 0.55, R * 0.7, 0.2, hr * 0.42);
  } else if (pose === 'cheek') {
    fist(cx - R * 0.95, cy + R * 0.45, hr);
    fist(cx + R * 0.95, cy + R * 0.45, hr);
    ctx.fillStyle = '#ff3d6e';
    heartPath(ctx, cx + R * 1.35, cy - R * 0.55, R * 0.5);
    ctx.fill();
  } else if (pose === 'flower') {
    for (let i = -2; i <= 2; i++) finger(cx + i * R * 0.24, cy + R * 1.25, R * 0.36, i * 0.35, hr * 0.5);
    fist(cx - R * 0.55, cy + R * 1.3, hr);
    fist(cx + R * 0.55, cy + R * 1.3, hr);
  } else if (pose === 'thumbs') {
    fist(cx + R * 1.25, cy + R * 0.95, hr);
    finger(cx + R * 1.25, cy + R * 0.75, R * 0.45, 0, hr * 0.5);
  } else if (pose === 'fight') {
    fist(cx - R * 1.25, cy + R * 0.7, hr * 1.1);
    fist(cx + R * 1.25, cy + R * 0.7, hr * 1.1);
  } else if (pose === 'heart') {
    ctx.save();
    ctx.lineWidth = R * 0.28;
    ctx.strokeStyle = L.skin;
    ctx.lineCap = 'round';
    heartPath(ctx, cx, cy - R * 1.6, R * 1.6);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,61,110,.85)';
    heartPath(ctx, cx, cy - R * 1.65, R * 0.7);
    ctx.fill();
  }

  // 가짜 표시
  if (o.badge) {
    const fs = Math.max(10, m * 0.07);
    ctx.font = `400 ${fs}px ${ANTON}`;
    const tw = ctx.measureText(o.badge).width + fs * 1.0;
    ctx.fillStyle = 'rgba(15,15,22,.72)';
    rrect(ctx, w - tw - fs * 0.6, fs * 0.6, tw, fs * 1.5, fs * 0.75);
    ctx.fill();
    ctx.fillStyle = o.color || '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(o.badge, w - tw / 2 - fs * 0.6, fs * 1.38);
  }
}

/** 큰 해상도 한 장(사진 대신 보낼 것). 반환: 캔버스 */
export function avatarCanvas(w, h, o) {
  const c = document.createElement('canvas');
  c.width = Math.round(w);
  c.height = Math.round(h);
  drawAvatar(c.getContext('2d'), c.width, c.height, { ...o, still: true });
  return c;
}

export { SANS };
