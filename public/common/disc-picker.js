// CD 고르기 화면: 케이스에 든 CD 가 가로 선반에 줄지어 있고, 끌거나 튕겨서 넘기면 가운데 CD 가 케이스에서 빠져나와 돕니다.
// 마우스·터치·펜 끌기(관성·자리 맞춤), 휠, ← → 키, 폰에서 원격으로 움직이기(nudge / fling / select)를 지원합니다.
// 다른 파일을 불러오지 않습니다(다른 프로젝트에 그대로 복사해 씁니다). 미리듣기 소리는 preview 콜백으로 받습니다.
//
//   const picker = createDiscPicker(el, {
//     songs, difficulty: 'normal',
//     chartInfo: (song, diff) => ({ stars, count }),      // 난이도 칩의 별·노트 수 (없으면 이름만)
//     preview: (song) => playPreview(synth, song),        // 멈추는 함수를 돌려줍니다
//     onChange(song, i) {}, onSelect(song, diff) {}, onDifficulty(diff) {},
//   });
//   picker.nudge(1); picker.fling(-6); picker.select(); picker.setDifficulty('hard'); picker.setDriver({ label: '2P', color: '#3ab4ff' });
//
// 순서는 페이지를 열 때마다 섞이고, 처음 가운데에 오는 CD 는 직전 방문과 겹치지 않습니다(localStorage).

const DIFF_LABEL = { easy: '쉬움', normal: '보통', hard: '어려움' };
const CSS_ID = 'disc-picker-css';
const CSS = `
.dp-root{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:340px;color:#f4f6fb;user-select:none;-webkit-user-select:none;
  font-family:var(--dp-font,Pretendard,'Pretendard Variable','Apple SD Gothic Neo','Noto Sans KR',system-ui,sans-serif);outline:none;--dp-accent:#7fd4ff;overflow:hidden}
.dp-head{display:flex;align-items:center;gap:14px;padding:6px 18px 0;min-height:34px;z-index:5}
.dp-title{font-weight:800;font-size:clamp(15px,1.6vw,22px);letter-spacing:-.01em}
.dp-hint{font-size:clamp(11px,1.05vw,14px);color:rgba(230,236,248,.6)}
.dp-driver{margin-left:auto;display:none;align-items:center;gap:8px;font-weight:700;font-size:clamp(12px,1.1vw,15px);padding:5px 12px 5px 6px;border-radius:999px;background:rgba(8,12,22,.62);box-shadow:inset 0 0 0 1.5px var(--dp-drv,#fff)}
.dp-driver b{display:inline-grid;place-items:center;min-width:26px;height:22px;border-radius:999px;background:var(--dp-drv,#fff);color:#0b1420;font-size:12px;padding:0 6px}
.dp-root.has-driver .dp-driver{display:flex}
.dp-stage{position:relative;flex:1 1 auto;min-height:160px;perspective:calc(var(--dp-w) * 4.2);perspective-origin:50% 42%;cursor:grab;touch-action:pan-y}
.dp-root.is-drag .dp-stage{cursor:grabbing}
.dp-floor{position:absolute;left:0;right:0;top:calc(47% + var(--dp-w) * .5);height:calc(var(--dp-w) * .8);
  background:radial-gradient(42% 62% at 50% 0%,rgba(150,195,255,.15),rgba(150,195,255,0) 72%);pointer-events:none}
.dp-floor::before{content:'';position:absolute;left:8%;right:8%;top:0;height:1px;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(200,225,255,.28),rgba(255,255,255,0))}
.dp-row{position:absolute;left:50%;top:47%;width:0;height:0;transform-style:preserve-3d}
.dp-item{position:absolute;left:calc(var(--dp-w) * -.5);top:calc(var(--dp-w) * -.5);width:var(--dp-w);height:var(--dp-w);transform-style:preserve-3d;will-change:transform}
.dp-case{position:absolute;inset:0;transform-style:preserve-3d;-webkit-box-reflect:below calc(var(--dp-w) * .03) linear-gradient(transparent 76%,rgba(255,255,255,.16))}
.dp-disc{position:absolute;inset:3.5%;border-radius:50%;transform:translateX(calc(var(--slide,0) * 54%)) translateZ(-2px);transition:filter .3s}
.dp-face{position:absolute;inset:0;border-radius:50%;animation:dp-spin 3.2s linear infinite;animation-play-state:paused;
  background:radial-gradient(circle,rgba(0,0,0,0) 0 6.8%,rgba(235,240,248,.95) 7% 8.4%,rgba(0,0,0,0) 8.6% 15.5%,rgba(255,255,255,.55) 15.7% 16.4%,rgba(0,0,0,0) 16.6% 96%,rgba(255,255,255,.7) 97% 98.5%,rgba(0,0,0,0) 99%),
  conic-gradient(from 20deg,#dfe6f0,#b8c6d8 8%,#f4e2ff 15%,#bfeaff 22%,#e9f3ff 28%,#fff 33%,#c7d2e0 41%,#ffe6cf 49%,#cdfcef 56%,#dce6f2 63%,#fff 70%,#bcc9da 78%,#f1ddff 86%,#c6efff 93%,#dfe6f0);
  box-shadow:0 calc(var(--dp-w) * .02) calc(var(--dp-w) * .08) rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,255,255,.4)}
.dp-label{position:absolute;inset:17%;border-radius:50%;background-size:cover;background-position:center;
  -webkit-mask:radial-gradient(circle,transparent 0 21%,#000 22%);mask:radial-gradient(circle,transparent 0 21%,#000 22%);box-shadow:inset 0 0 0 2px rgba(255,255,255,.35)}
.dp-shine{position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 200deg,rgba(255,255,255,0),rgba(255,255,255,.45) 6%,rgba(255,255,255,0) 14%,rgba(255,255,255,0) 50%,rgba(255,255,255,.35) 56%,rgba(255,255,255,0) 64%);mix-blend-mode:screen;pointer-events:none}
.dp-back{position:absolute;inset:0;border-radius:2px;background:linear-gradient(135deg,#1b2230,#0b0f17);box-shadow:0 calc(var(--dp-w) * .04) calc(var(--dp-w) * .12) rgba(0,0,0,.55)}
.dp-cover{position:absolute;top:2.5%;bottom:2.5%;left:8.5%;right:2.5%;background-size:cover;background-position:center;border-radius:1px}
.dp-spine{position:absolute;top:0;bottom:0;left:0;width:7%;border-radius:2px 0 0 2px;
  background:repeating-linear-gradient(180deg,rgba(255,255,255,.1) 0 2px,rgba(255,255,255,0) 2px 7px),linear-gradient(90deg,#232a36,#3a4352 40%,#151a22)}
.dp-glass{position:absolute;inset:0;border-radius:2px;pointer-events:none;
  background:linear-gradient(118deg,rgba(255,255,255,.32) 0%,rgba(255,255,255,.08) 22%,rgba(255,255,255,0) 40%,rgba(255,255,255,0) 64%,rgba(255,255,255,.1) 78%,rgba(255,255,255,.02) 100%);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.38),inset 0 1px 0 rgba(255,255,255,.6),inset calc(var(--dp-w) * .07) 0 0 -1px rgba(255,255,255,.12)}
.dp-item.is-center .dp-face{animation-play-state:running}
.dp-root.is-playing .dp-item.is-center .dp-face{animation-duration:1.6s}
.dp-item.is-picked .dp-case{animation:dp-pick .5s ease-out}
.dp-nav{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:64px;border:0;border-radius:14px;background:rgba(10,14,24,.45);color:#fff;font-size:30px;line-height:1;cursor:pointer;z-index:2000;opacity:.7;transition:opacity .2s,background .2s}
.dp-nav:hover{opacity:1;background:rgba(30,40,60,.7)}
.dp-prev{left:12px}.dp-next{right:12px}
.dp-root.is-touch .dp-nav{display:none}
.dp-info{position:relative;text-align:center;padding:4px 16px 14px;z-index:5}
.dp-name{font-weight:800;font-size:clamp(20px,2.6vw,38px);letter-spacing:-.02em;line-height:1.15;text-shadow:0 2px 18px rgba(0,0,0,.45)}
.dp-sub{margin-top:3px;font-size:clamp(12px,1.25vw,17px);color:rgba(232,238,250,.75)}
.dp-meta{margin-top:4px;font-size:clamp(11px,1.05vw,14px);color:rgba(232,238,250,.55);display:flex;gap:10px;justify-content:center;align-items:center}
.dp-meta i{width:3px;height:3px;border-radius:50%;background:currentColor;display:inline-block}
.dp-eq{display:inline-flex;gap:2px;align-items:flex-end;height:12px;margin-right:2px;opacity:0;transition:opacity .25s}
.dp-eq s{display:block;width:3px;background:var(--dp-accent);border-radius:1px;height:30%;animation:dp-eq .9s ease-in-out infinite;animation-play-state:paused}
.dp-eq s:nth-child(2){animation-delay:-.3s}.dp-eq s:nth-child(3){animation-delay:-.6s}.dp-eq s:nth-child(4){animation-delay:-.15s}
.dp-root.is-playing .dp-eq{opacity:1}.dp-root.is-playing .dp-eq s{animation-play-state:running}
.dp-chips{display:flex;gap:10px;justify-content:center;margin-top:10px;flex-wrap:wrap}
.dp-chip{appearance:none;border:0;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:clamp(84px,9vw,128px);padding:8px 14px 7px;border-radius:16px;
  background:rgba(12,18,30,.55);color:rgba(240,244,252,.8);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.14);font:inherit;transition:transform .15s,background .2s,box-shadow .2s,color .2s}
.dp-chip b{font-size:clamp(13px,1.25vw,17px);font-weight:800}
.dp-chip .dp-stars{font-size:clamp(10px,.95vw,13px);letter-spacing:1px;color:#ffd35c;white-space:nowrap}
.dp-chip .dp-stars em{font-style:normal;color:rgba(255,255,255,.18)}
.dp-chip small{font-size:clamp(10px,.9vw,12px);color:rgba(230,236,248,.55)}
.dp-chip.is-on{background:linear-gradient(180deg,rgba(255,255,255,.2),rgba(255,255,255,.07));color:#fff;box-shadow:inset 0 0 0 2px var(--dp-chip,#fff),0 6px 22px rgba(0,0,0,.35);transform:translateY(-2px)}
.dp-chip[data-d=easy]{--dp-chip:#5ee07a}.dp-chip[data-d=normal]{--dp-chip:#ffc93c}.dp-chip[data-d=hard]{--dp-chip:#ff5a5f}
.dp-root.is-disabled .dp-stage{cursor:default}
.dp-flash{position:absolute;inset:0;pointer-events:none;background:radial-gradient(40% 50% at 50% 45%,rgba(255,255,255,.35),rgba(255,255,255,0));opacity:0;z-index:3000}
.dp-root.is-select .dp-flash{animation:dp-flash .6s ease-out}
@keyframes dp-spin{to{transform:rotate(360deg)}}
@keyframes dp-eq{0%,100%{height:25%}50%{height:100%}}
@keyframes dp-pick{0%{transform:scale(1)}35%{transform:scale(1.07)}100%{transform:scale(1)}}
@keyframes dp-flash{0%{opacity:1}100%{opacity:0}}
`;

// ───────────── 무작위(씨앗) ─────────────
function rngOf(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ───────────── 표지 그리기 ─────────────
const coverCache = new Map();
const FONT = "Pretendard, 'Pretendard Variable', 'Apple SD Gothic Neo', 'Noto Sans KR', system-ui, sans-serif";
function motif(g, kind, S, R, hue) {
  const W = (a) => `rgba(255,255,255,${a})`;
  g.save();
  if (kind === 'rays') {
    g.translate(S * 0.72, S * 0.3);
    for (let i = 0; i < 18; i++) { g.rotate((Math.PI * 2) / 18); g.fillStyle = W(i % 2 ? 0.05 : 0.12); g.beginPath(); g.moveTo(0, 0); g.lineTo(S * 1.2, -S * 0.09); g.lineTo(S * 1.2, S * 0.09); g.fill(); }
    g.fillStyle = W(0.85); g.beginPath(); g.arc(0, 0, S * 0.1, 0, 7); g.fill();
    g.fillStyle = W(0.2); g.beginPath(); g.arc(0, 0, S * 0.17, 0, 7); g.fill();
  } else if (kind === 'rings') {
    for (let i = 0; i < 9; i++) { g.strokeStyle = W(0.07 + (i % 3) * 0.05); g.lineWidth = S * (0.008 + R() * 0.02); g.beginPath(); g.arc(S * 0.66, S * 0.36, S * (0.08 + i * 0.07), 0, 7); g.stroke(); }
  } else if (kind === 'stars') {
    for (let i = 0; i < 70; i++) { const r = R() * S * 0.006 + 0.6; g.fillStyle = W(0.25 + R() * 0.6); g.beginPath(); g.arc(R() * S, R() * S * 0.68, r, 0, 7); g.fill(); }
    const star = (x, y, r) => { g.beginPath(); for (let k = 0; k < 10; k++) { const a = (k * Math.PI) / 5 - Math.PI / 2; const rr = k % 2 ? r * 0.42 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.fill(); };
    g.fillStyle = W(0.9); star(S * 0.72, S * 0.26, S * 0.085); g.fillStyle = W(0.5); star(S * 0.3, S * 0.18, S * 0.04); star(S * 0.86, S * 0.52, S * 0.03);
  } else if (kind === 'petals') {
    for (let i = 0; i < 14; i++) {
      g.save(); g.translate(R() * S, R() * S * 0.7); g.rotate(R() * 6.3); g.fillStyle = W(0.12 + R() * 0.25);
      g.beginPath(); g.ellipse(0, 0, S * (0.02 + R() * 0.03), S * (0.045 + R() * 0.04), 0, 0, 7); g.fill(); g.restore();
    }
    g.translate(S * 0.68, S * 0.32); g.fillStyle = W(0.8);
    for (let k = 0; k < 5; k++) { g.rotate((Math.PI * 2) / 5); g.beginPath(); g.ellipse(0, -S * 0.07, S * 0.045, S * 0.075, 0, 0, 7); g.fill(); }
    g.fillStyle = `hsla(${hue + 40},90%,70%,.95)`; g.beginPath(); g.arc(0, 0, S * 0.035, 0, 7); g.fill();
  } else if (kind === 'stripes') {
    g.rotate(-0.5); for (let i = -6; i < 14; i++) { g.fillStyle = W(i % 2 ? 0.05 : 0.13); g.fillRect(i * S * 0.09, -S, S * 0.045, S * 3); }
  } else if (kind === 'waves') {
    for (let k = 0; k < 7; k++) {
      g.strokeStyle = W(0.1 + k * 0.05); g.lineWidth = S * 0.012; g.beginPath();
      for (let x = 0; x <= S; x += 6) g.lineTo(x, S * (0.18 + k * 0.07) + Math.sin(x / S * 9 + k * 0.8) * S * 0.025);
      g.stroke();
    }
  } else if (kind === 'mountains') {
    const layer = (y, a, amp) => { g.fillStyle = W(a); g.beginPath(); g.moveTo(0, S); let x = 0; g.lineTo(0, y); while (x < S) { x += S * (0.08 + R() * 0.12); g.lineTo(x, y - R() * amp); x += S * (0.06 + R() * 0.1); g.lineTo(x, y + R() * amp * 0.3); } g.lineTo(S, S); g.fill(); };
    g.fillStyle = W(0.85); g.beginPath(); g.arc(S * 0.75, S * 0.2, S * 0.06, 0, 7); g.fill();
    layer(S * 0.48, 0.12, S * 0.2); layer(S * 0.58, 0.18, S * 0.14); layer(S * 0.68, 0.26, S * 0.08);
  } else if (kind === 'leaves') {
    for (let i = 0; i < 16; i++) {
      g.save(); g.translate(R() * S, R() * S * 0.68); g.rotate(R() * 6.3); const L = S * (0.04 + R() * 0.06); g.fillStyle = W(0.12 + R() * 0.3);
      g.beginPath(); g.moveTo(0, -L); g.quadraticCurveTo(L * 0.7, 0, 0, L); g.quadraticCurveTo(-L * 0.7, 0, 0, -L); g.fill();
      g.strokeStyle = W(0.25); g.lineWidth = 1; g.beginPath(); g.moveTo(0, -L); g.lineTo(0, L); g.stroke(); g.restore();
    }
  } else if (kind === 'dots') {
    for (let i = 0; i < 40; i++) { g.fillStyle = i % 5 === 0 ? `hsla(${hue + 160},90%,70%,.6)` : W(0.08 + R() * 0.25); g.beginPath(); g.arc(R() * S, R() * S * 0.7, S * (0.01 + R() * 0.045), 0, 7); g.fill(); }
  } else if (kind === 'moon') {
    g.fillStyle = W(0.92); g.beginPath(); g.arc(S * 0.68, S * 0.3, S * 0.13, 0, 7); g.fill();
    g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(S * 0.74, S * 0.26, S * 0.12, 0, 7); g.fill();
    g.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 40; i++) { g.fillStyle = W(0.2 + R() * 0.5); g.beginPath(); g.arc(R() * S, R() * S * 0.62, R() * 1.6 + 0.4, 0, 7); g.fill(); }
  } else if (kind === 'snow') {
    for (let i = 0; i < 26; i++) {
      const x = R() * S, y = R() * S * 0.7, r = S * (0.012 + R() * 0.03);
      g.strokeStyle = W(0.25 + R() * 0.5); g.lineWidth = Math.max(1, r * 0.18); g.beginPath();
      for (let k = 0; k < 3; k++) { const a = (k * Math.PI) / 3; g.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r); g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
      g.stroke();
    }
  } else if (kind === 'notes') {
    for (let i = 0; i < 9; i++) {
      const x = S * (0.1 + R() * 0.8), y = S * (0.12 + R() * 0.5), r = S * (0.025 + R() * 0.025);
      g.fillStyle = W(0.25 + R() * 0.55); g.beginPath(); g.ellipse(x, y, r * 1.25, r, -0.4, 0, 7); g.fill();
      g.fillRect(x + r * 1.05, y - r * 4, Math.max(1.5, r * 0.22), r * 4);
    }
  } else if (kind === 'blocks') {
    const u = S * 0.075;
    const shapes = [[[0, 0], [1, 0], [2, 0], [1, 1]], [[0, 0], [0, 1], [1, 1], [2, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [1, 1], [2, 1]], [[0, 0], [1, 0], [2, 0], [3, 0]]];
    for (let i = 0; i < 9; i++) {
      const sh = shapes[Math.floor(R() * shapes.length)], ox = Math.floor(R() * 11) * u, oy = Math.floor(R() * 7) * u;
      g.fillStyle = `hsla(${hue + i * 47},85%,${60 + R() * 15}%,.7)`;
      for (const [a, b] of sh) { g.fillRect(ox + a * u + 1, oy + b * u + 1, u - 2, u - 2); }
    }
  } else if (kind === 'burst') {
    for (let k = 0; k < 4; k++) {
      const cx = S * (0.2 + R() * 0.65), cy = S * (0.15 + R() * 0.4), n = 14 + Math.floor(R() * 8), rr = S * (0.07 + R() * 0.09);
      g.strokeStyle = k % 2 ? `hsla(${hue + 60},95%,75%,.7)` : W(0.6); g.lineWidth = S * 0.006;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * rr * 0.35, cy + Math.sin(a) * rr * 0.35); g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); g.stroke(); }
    }
  } else if (kind === 'diamonds') {
    const u = S * 0.12;
    for (let y = 0; y < 7; y++) for (let x = 0; x < 10; x++) {
      if ((x + y) % 2) continue;
      g.fillStyle = W(0.04 + ((x * 7 + y * 3) % 5) * 0.03); g.beginPath();
      const cx = x * u * 0.75, cy = y * u * 0.75; g.moveTo(cx, cy - u / 2); g.lineTo(cx + u / 2, cy); g.lineTo(cx, cy + u / 2); g.lineTo(cx - u / 2, cy); g.fill();
    }
  } else if (kind === 'hearts') {
    for (let i = 0; i < 12; i++) {
      const x = R() * S, y = R() * S * 0.65, r = S * (0.02 + R() * 0.045);
      g.fillStyle = i % 3 ? W(0.15 + R() * 0.4) : `hsla(${hue + 30},95%,75%,.8)`;
      g.beginPath(); g.moveTo(x, y + r * 0.9); g.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.6, y - r * 1.4, x, y - r * 0.45); g.bezierCurveTo(x + r * 0.6, y - r * 1.4, x + r * 1.6, y - r * 0.2, x, y + r * 0.9); g.fill();
    }
  }
  g.restore();
}
function wrapText(g, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (g.measureText(t).width <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  // 한 단어가 너무 길면 글자 단위로 자릅니다.
  const out = [];
  for (const l of lines) {
    if (g.measureText(l).width <= maxW) { out.push(l); continue; }
    let s = '';
    for (const ch of l) { if (g.measureText(s + ch).width > maxW && s) { out.push(s); s = ch; } else s += ch; }
    if (s) out.push(s);
  }
  return out;
}
export function drawCover(song, size = 360, { text = true } = {}) {
  const key = song.id + '|' + size + (text ? '' : '|art');
  if (coverCache.has(key)) return coverCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const hue = song.cover && song.cover.hue != null ? song.cover.hue : hashStr(song.id) % 360;
  const R = rngOf(hashStr(song.id));
  const bg = g.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, `hsl(${hue},72%,52%)`);
  bg.addColorStop(0.55, `hsl(${hue + 28},70%,34%)`);
  bg.addColorStop(1, `hsl(${hue + 50},65%,16%)`);
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);
  const glow = g.createRadialGradient(size * 0.7, size * 0.25, 0, size * 0.7, size * 0.25, size * 0.7);
  glow.addColorStop(0, `hsla(${hue - 20},100%,75%,.45)`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);
  motif(g, (song.cover && song.cover.motif) || 'rings', size, R, hue);
  if (!text) { const u = c.toDataURL('image/jpeg', 0.85); coverCache.set(key, u); return u; }
  const shade = g.createLinearGradient(0, size * 0.45, 0, size);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,.62)');
  g.fillStyle = shade;
  g.fillRect(0, 0, size, size);
  const pad = size * 0.07;
  g.textBaseline = 'alphabetic';
  g.fillStyle = 'rgba(255,255,255,.8)';
  g.font = `700 ${Math.round(size * 0.04)}px ${FONT}`;
  g.fillText((song.genre || '').toUpperCase(), pad, pad + size * 0.04);
  let fs = size * 0.105;
  g.font = `800 ${Math.round(fs)}px ${FONT}`;
  let lines = wrapText(g, song.title, size - pad * 2);
  if (lines.length > 2) { fs = size * 0.082; g.font = `800 ${Math.round(fs)}px ${FONT}`; lines = wrapText(g, song.title, size - pad * 2).slice(0, 3); }
  const small = size * 0.042;
  let y = size - pad - small * 2.6 - (lines.length - 1) * fs * 1.12;
  g.fillStyle = '#fff';
  g.shadowColor = 'rgba(0,0,0,.35)';
  g.shadowBlur = size * 0.02;
  for (const l of lines) { g.fillText(l, pad, y); y += fs * 1.12; }
  g.shadowBlur = 0;
  g.font = `600 ${Math.round(small)}px ${FONT}`;
  g.fillStyle = 'rgba(255,255,255,.88)';
  g.fillText(song.composer || '', pad, size - pad - small * 1.25);
  g.fillStyle = 'rgba(255,255,255,.55)';
  g.font = `500 ${Math.round(small * 0.85)}px ${FONT}`;
  const en = song.en || '';
  g.fillText(g.measureText(en).width > size - pad * 2 ? en.slice(0, 34) + '…' : en, pad, size - pad);
  const url = c.toDataURL('image/jpeg', 0.88);
  coverCache.set(key, url);
  return url;
}

function fmtTime(sec) { const s = Math.round(sec); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/**
 * @param {HTMLElement} container
 * @param {object} opts songs, difficulty, difficulties, chartInfo, preview, previewDelay, previewSeconds, autoPreview,
 *   keyboard, wheel, shuffle, seed, storageKey, title, hint, accent, stopOnSelect, onChange, onSettle, onSelect, onDifficulty, onGesture
 */
export function createDiscPicker(container, opts = {}) {
  if (!document.getElementById(CSS_ID)) { const st = document.createElement('style'); st.id = CSS_ID; st.textContent = CSS; document.head.appendChild(st); }
  const o = { difficulties: ['easy', 'normal', 'hard'], difficulty: 'normal', previewDelay: 550, previewSeconds: 12, autoPreview: true, keyboard: true, wheel: true, shuffle: true, storageKey: 'disc-picker', stopOnSelect: true, title: '노래 고르기', hint: '끌어서 넘기기 · ← → · 가운데를 누르면 선택', ...opts };
  const seed = o.seed ?? ((typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 2 ** 32)) >>> 0);
  let songs = o.songs.slice();
  if (o.shuffle) {
    const R = rngOf(seed);
    for (let i = songs.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [songs[i], songs[j]] = [songs[j], songs[i]]; }
  }
  const n = songs.length;
  let start = o.startId ? Math.max(0, songs.findIndex((s) => s.id === o.startId)) : Math.floor((n - 1) / 2);
  const firstKey = o.storageKey + ':first';
  if (o.shuffle && !o.startId && n > 1) {
    let last = null;
    try { last = localStorage.getItem(firstKey); } catch (e) {}
    if (songs[start].id === last) { const k = start + 1 < n ? start + 1 : start - 1; [songs[start], songs[k]] = [songs[k], songs[start]]; }
    try { localStorage.setItem(firstKey, songs[start].id); } catch (e) {}
  }

  // ── DOM ──
  const root = el('div', 'dp-root');
  root.tabIndex = 0;
  if (o.accent) root.style.setProperty('--dp-accent', o.accent);
  if (matchMedia && matchMedia('(pointer: coarse)').matches) root.classList.add('is-touch');
  const head = el('div', 'dp-head', `<div class="dp-title">${esc(o.title)}</div><div class="dp-hint">${esc(o.hint)}</div><div class="dp-driver"><b></b><span></span></div>`);
  const stage = el('div', 'dp-stage');
  const floor = el('div', 'dp-floor');
  const row = el('div', 'dp-row');
  const prev = el('button', 'dp-nav dp-prev', '‹');
  const next = el('button', 'dp-nav dp-next', '›');
  prev.type = next.type = 'button';
  prev.setAttribute('aria-label', '이전 곡');
  next.setAttribute('aria-label', '다음 곡');
  stage.append(floor, row, prev, next);
  const info = el('div', 'dp-info', `<div class="dp-name"></div><div class="dp-sub"></div><div class="dp-meta"></div><div class="dp-chips"></div>`);
  const flash = el('div', 'dp-flash');
  root.append(head, stage, info, flash);
  container.appendChild(root);
  const $ = (s) => root.querySelector(s);

  const items = songs.map((s, i) => {
    const it = el('div', 'dp-item');
    it.dataset.i = i;
    it.innerHTML = `<div class="dp-case"><div class="dp-disc"><div class="dp-face"><div class="dp-label"></div><div class="dp-shine"></div></div></div><div class="dp-back"></div><div class="dp-cover"></div><div class="dp-spine"></div><div class="dp-glass"></div></div>`;
    row.appendChild(it);
    return it;
  });
  const paintCovers = () => songs.forEach((s, i) => {
    items[i].querySelector('.dp-cover').style.backgroundImage = `url(${drawCover(s)})`;
    items[i].querySelector('.dp-label').style.backgroundImage = `url(${drawCover(s, 200, { text: false })})`;
  });
  paintCovers();
  if (document.fonts && document.fonts.status !== 'loaded') {
    document.fonts.ready.then(() => { for (const s of songs) coverCache.delete(s.id + '|360'); paintCovers(); });
  }

  const chipsEl = $('.dp-chips');
  const chips = o.difficulties.map((d) => {
    const b = el('button', 'dp-chip', `<b>${DIFF_LABEL[d] || d}</b><span class="dp-stars"></span><small></small>`);
    b.type = 'button';
    b.dataset.d = d;
    b.addEventListener('click', (e) => { e.stopPropagation(); gesture(); if (enabled) api.setDifficulty(d); });
    chipsEl.appendChild(b);
    return b;
  });

  // ── 상태 ──
  let W = 240, pos = start, vel = 0, target = start, dragging = false, raf = 0, last = 0;
  let open = 0, liveIndex = -1, settledIndex = -1, enabled = true, difficulty = o.difficulty;
  let stopPrev = null, prevTimer = 0, playTimer = 0, gestured = false;

  function gesture() { if (!gestured) { gestured = true; if (o.onGesture) o.onGesture(); } }
  function measure() {
    const r = stage.getBoundingClientRect();
    const rw = root.getBoundingClientRect().width || 800;
    W = Math.round(Math.max(110, Math.min(380, Math.min(r.height * 0.66, rw * (rw < 640 ? 0.4 : 0.235)))));
    root.style.setProperty('--dp-w', W + 'px');
    layout();
  }
  function layout() {
    const center = Math.round(pos);
    for (let i = 0; i < n; i++) {
      const d = i - pos;
      const ad = Math.abs(d);
      const it = items[i];
      if (ad > 7.5) { if (it.style.visibility !== 'hidden') it.style.visibility = 'hidden'; continue; }
      it.style.visibility = '';
      const s = Math.max(-1, Math.min(1, d));
      const as = Math.abs(s);
      const sign = d < 0 ? -1 : 1;
      const x = s * W * 0.82 + (d - s) * W * 0.32 + sign * as * open * W * 0.3 - (1 - as) * open * W * 0.24;
      const z = -as * W * 0.6 - Math.max(0, ad - 1) * W * 0.05 + (1 - as) * W * 0.08;
      const ry = -s * 64;
      it.style.transform = `translate3d(${x.toFixed(1)}px,0,${z.toFixed(1)}px) rotateY(${ry.toFixed(2)}deg)`;
      it.style.zIndex = String(1000 - Math.round(ad * 10));
      it.style.opacity = ad > 5 ? String(Math.max(0, 1 - (ad - 5) * 0.4)) : '1';
      it.style.setProperty('--slide', i === center ? (open * Math.max(0, 1 - ad * 2)).toFixed(3) : '0');
      it.classList.toggle('is-center', i === center && ad < 0.5);
    }
    if (center !== liveIndex && center >= 0 && center < n) {
      liveIndex = center;
      renderInfo();
      if (o.onChange) o.onChange(songs[center], center);
    }
  }
  function renderInfo() {
    const s = songs[liveIndex];
    if (!s) return;
    $('.dp-name').textContent = s.title;
    $('.dp-sub').textContent = `${s.en} · ${s.composer}`;
    $('.dp-meta').innerHTML = `<span class="dp-eq"><s></s><s></s><s></s><s></s></span><span>${esc(s.genre || '')}</span><i></i><span>${s.bpm} BPM</span><i></i><span>${fmtTime(s.lengthSec || 0)}</span>${s.mood ? `<i></i><span>${esc(s.mood)}</span>` : ''}`;
    chips.forEach((b) => {
      const d = b.dataset.d;
      b.classList.toggle('is-on', d === difficulty);
      const ci = o.chartInfo ? o.chartInfo(s, d) : null;
      const st = b.querySelector('.dp-stars'), sm = b.querySelector('small');
      if (ci) {
        const k = Math.max(1, Math.min(10, ci.stars | 0));
        st.innerHTML = '★'.repeat(Math.min(k, 10)) + (k < 10 ? `<em>${'★'.repeat(Math.max(0, (k <= 5 ? 5 : 10) - k))}</em>` : '');
        sm.textContent = `노트 ${ci.count}`;
      } else { st.textContent = ''; sm.textContent = ''; }
    });
  }

  function kick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    let moving = false;
    if (!dragging) {
      const k = 110, c = 2 * Math.sqrt(k) * 0.92;
      const acc = -k * (pos - target) - c * vel;
      vel += acc * dt;
      pos += vel * dt;
      if (Math.abs(pos - target) < 0.0015 && Math.abs(vel) < 0.02) { pos = target; vel = 0; } else moving = true;
    } else moving = true;
    const settled = !moving && !dragging;
    const want = settled ? 1 : 0;
    const prevOpen = open;
    open += (want - open) * Math.min(1, dt * (want ? 7 : 14));
    if (Math.abs(open - want) < 0.002) open = want;
    if (open !== want) moving = true;
    layout();
    if (settled && settledIndex !== Math.round(pos)) onSettled();
    if (moving || prevOpen !== open) raf = requestAnimationFrame(frame);
  }
  function onSettled() {
    settledIndex = Math.round(pos);
    if (o.onSettle) o.onSettle(songs[settledIndex], settledIndex);
    schedulePreview();
  }
  function schedulePreview() {
    clearTimeout(prevTimer);
    if (!o.preview || !o.autoPreview || !enabled) return;
    const i = settledIndex;
    prevTimer = setTimeout(() => { if (i === settledIndex && !dragging) startPreview(songs[i]); }, o.previewDelay);
  }
  function startPreview(song) {
    stopPreview();
    try { stopPrev = o.preview(song) || null; } catch (e) { console.error(e); stopPrev = null; }
    if (!stopPrev) return;
    root.classList.add('is-playing');
    clearTimeout(playTimer);
    playTimer = setTimeout(() => root.classList.remove('is-playing'), o.previewSeconds * 1000);
  }
  function stopPreview() {
    clearTimeout(prevTimer);
    clearTimeout(playTimer);
    root.classList.remove('is-playing');
    if (stopPrev) { try { const f = stopPrev; stopPrev = null; if (typeof f === 'function') f(); else if (f.then) f.then((g) => typeof g === 'function' && g()); } catch (e) {} }
  }
  const clampI = (i) => Math.max(0, Math.min(n - 1, i));
  function moved() { if (settledIndex !== -1 && Math.round(target) !== settledIndex) { stopPreview(); settledIndex = -1; } }

  // ── 입력 ──
  let down = null;
  stage.addEventListener('pointerdown', (e) => {
    gesture();
    if (!enabled || e.target.closest('.dp-nav') || (e.button != null && e.button > 0)) return;
    if (e.pointerType === 'touch') root.classList.add('is-touch');
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, pos, samples: [{ t: performance.now(), x: e.clientX }], moved: false, target: e.target };
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
  });
  stage.addEventListener('pointermove', (e) => {
    if (!down || e.pointerId !== down.id) return;
    const dx = e.clientX - down.x;
    if (!down.moved && Math.abs(dx) > 6) { down.moved = true; dragging = true; root.classList.add('is-drag'); stopPreview(); settledIndex = -1; }
    if (!down.moved) return;
    let p = down.pos - dx / (W * 0.55);
    if (p < 0) p = p * 0.35;
    if (p > n - 1) p = n - 1 + (p - n + 1) * 0.35;
    pos = p;
    down.samples.push({ t: performance.now(), x: e.clientX });
    if (down.samples.length > 6) down.samples.shift();
    kick();
  });
  const up = (e) => {
    if (!down || e.pointerId !== down.id) return;
    const d = down;
    down = null;
    try { stage.releasePointerCapture(e.pointerId); } catch (err) {}
    if (!d.moved) {
      const it = d.target.closest && d.target.closest('.dp-item');
      if (it) {
        const i = Number(it.dataset.i);
        if (i === Math.round(pos)) api.select();
        else api.goTo(i);
      }
      return;
    }
    dragging = false;
    root.classList.remove('is-drag');
    // 놓기 직전 잠깐 멈췄으면 튕기지 않고 그 자리에 맞춥니다.
    const s = d.samples;
    const a = s[0], b = s[s.length - 1];
    const idle = performance.now() - b.t > 90;
    const vx = !idle && b.t - a.t > 5 ? ((b.x - a.x) / (b.t - a.t)) * 1000 : 0;
    api.fling(-vx / (W * 0.55));
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  prev.addEventListener('click', (e) => { e.stopPropagation(); gesture(); api.nudge(-1); });
  next.addEventListener('click', (e) => { e.stopPropagation(); gesture(); api.nudge(1); });
  let wheelAcc = 0, wheelT = 0;
  if (o.wheel) stage.addEventListener('wheel', (e) => {
    if (!enabled) return;
    e.preventDefault();
    const dlt = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const now = performance.now();
    if (now - wheelT > 300) wheelAcc = 0;
    wheelT = now;
    wheelAcc += dlt;
    while (Math.abs(wheelAcc) >= 100) { api.nudge(wheelAcc > 0 ? 1 : -1); wheelAcc -= Math.sign(wheelAcc) * 100; }
  }, { passive: false });
  const onKey = (e) => {
    if (!enabled || !root.isConnected || root.offsetParent === null) return;
    const tg = e.target;
    if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return;
    let used = true;
    if (e.key === 'ArrowLeft') api.nudge(-1);
    else if (e.key === 'ArrowRight') api.nudge(1);
    else if (e.key === 'Enter' || e.key === ' ') api.select();
    else if (e.key === 'ArrowUp') api.cycleDifficulty(-1);
    else if (e.key === 'ArrowDown') api.cycleDifficulty(1);
    else used = false;
    if (used) { gesture(); e.preventDefault(); }
  };
  if (o.keyboard) window.addEventListener('keydown', onKey);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null;
  if (ro) ro.observe(root); else window.addEventListener('resize', measure);

  const api = {
    el: root,
    seed,
    get songs() { return songs; },
    get index() { return Math.round(dragging ? pos : target); },
    get song() { return songs[Math.round(target)]; },
    get position() { return pos; },
    get difficulty() { return difficulty; },
    get enabled() { return enabled; },
    /** 한 칸씩 넘기기(폰 스와이프·화살표) */
    nudge(d = 1) { if (!enabled) return; target = clampI(Math.round(target) + Math.sign(d) * Math.max(1, Math.abs(Math.round(d)))); moved(); kick(); },
    /** 튕기기: 속도는 초당 CD 개수(+ 는 오른쪽 곡으로) */
    fling(v = 0) {
      if (!enabled) return;
      vel = Math.max(-30, Math.min(30, v));
      target = clampI(Math.round(pos + vel * 0.26));
      moved();
      kick();
    },
    goTo(i, { instant = false } = {}) {
      target = clampI(i);
      if (instant) { pos = target; vel = 0; }
      moved();
      kick();
    },
    goToId(id, o2) { const i = songs.findIndex((s) => s.id === id); if (i >= 0) api.goTo(i, o2); },
    select() {
      if (!enabled) return;
      const i = Math.round(target);
      if (Math.abs(pos - i) > 0.02) { api.goTo(i); }
      const it = items[i];
      it.classList.remove('is-picked');
      void it.offsetWidth;
      it.classList.add('is-picked');
      root.classList.remove('is-select');
      void root.offsetWidth;
      root.classList.add('is-select');
      if (o.stopOnSelect) stopPreview();
      if (o.onSelect) o.onSelect(songs[i], difficulty, i);
    },
    setDifficulty(d) {
      if (!o.difficulties.includes(d)) return;
      if (d !== difficulty) { difficulty = d; renderInfo(); if (o.onDifficulty) o.onDifficulty(d); } else renderInfo();
    },
    cycleDifficulty(step = 1) { const L = o.difficulties; api.setDifficulty(L[(L.indexOf(difficulty) + step + L.length) % L.length]); },
    /** 누가 고르는 중인지 표시. null 이면 숨깁니다. */
    setDriver(d) {
      root.classList.toggle('has-driver', !!d);
      if (!d) return;
      root.style.setProperty('--dp-drv', d.color || '#fff');
      $('.dp-driver b').textContent = d.label || '';
      $('.dp-driver span').textContent = d.text || '고르는 중';
    },
    setEnabled(v) { enabled = !!v; root.classList.toggle('is-disabled', !enabled); if (!enabled) stopPreview(); else if (settledIndex >= 0) schedulePreview(); },
    setChartInfo(fn) { o.chartInfo = fn; renderInfo(); },
    refresh() { renderInfo(); },
    preview() { if (o.preview) startPreview(songs[Math.round(target)]); },
    stopPreview,
    destroy() {
      stopPreview();
      cancelAnimationFrame(raf);
      if (o.keyboard) window.removeEventListener('keydown', onKey);
      if (ro) ro.disconnect(); else window.removeEventListener('resize', measure);
      root.remove();
    },
    set onChange(f) { o.onChange = f; }, get onChange() { return o.onChange; },
    set onSelect(f) { o.onSelect = f; }, get onSelect() { return o.onSelect; },
    set onDifficulty(f) { o.onDifficulty = f; }, get onDifficulty() { return o.onDifficulty; },
  };
  measure();
  kick();
  return api;
}
