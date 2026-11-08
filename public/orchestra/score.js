// 따라 하기 쉬운 단순 악보: 오선(또는 한 줄)에 음표 머리가 오른쪽에서 왼쪽으로 흘러와 판정선에 닿을 때 연주합니다.
// 큰 화면의 사람별 악보 칸과 폰 위쪽 악보 띠가 같이 씁니다. 캔버스 하나에 그립니다.
//
//   const sc = createScore(canvas, { compact: true });
//   sc.setPart(part, song, 'trumpet', '#ff5a5f', 'normal');
//   sc.mark(i, 'perfect');                 // 판정 표시
//   sc.draw(beat, { bpm, level, trace });  // 매 프레임
import { INSTRUMENTS, valveLabel, STRINGS, solfa, DIR_ARROW } from './parts.js';

const FLAT_KEYS = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm'];
const SHARP_MAP = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];
const FLAT_MAP = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];
const GOLD = '#ffd23a';
const SANS = '"Pretendard Variable", Pretendard, -apple-system, system-ui, sans-serif';

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function createScore(canvas, opts = {}) {
  const o = { compact: false, ahead: 3.4, behind: 0.7, ...opts };
  const g = canvas.getContext('2d');
  let part = null, inst = null, color = '#ff5a5f', diff = 'normal', kind = 'keys', flats = false, shift = 0, barLen = 4;
  const marks = new Map(); // i -> { kind, at }
  let W = 0, H = 0, dpr = 1;

  function resize() {
    dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    const w = Math.max(10, Math.round(r.width * dpr));
    const h = Math.max(10, Math.round(r.height * dpr));
    if (w !== canvas.width || h !== canvas.height) { canvas.width = w; canvas.height = h; }
    W = w; H = h;
  }

  function setPart(p, song, instKey, c, d) {
    part = p; inst = instKey; color = c || color; diff = d || (p && p.diff) || 'normal';
    kind = INSTRUMENTS[instKey] ? INSTRUMENTS[instKey].kind : 'keys';
    flats = Boolean(song && FLAT_KEYS.includes(song.key));
    barLen = (song && song.barLen) || 4;
    shift = 0;
    if (p && p.notes.length && ['keys', 'wind', 'bow', 'voice'].includes(kind)) {
      const ms = p.notes.filter((n) => n.m).map((n) => n.m).sort((a, b) => a - b);
      const med = ms[ms.length >> 1];
      if (med < 58) shift = 12;
      else if (med > 84) shift = -12;
    }
    marks.clear();
  }
  function mark(i, k) { marks.set(i, { kind: k, at: performance.now() }); }
  function clearMarks() { marks.clear(); }

  // 오선 위치: E4(아래 첫 줄) = 0, 한 칸(줄↔칸) = 1
  function stepOf(m) {
    const mm = Math.round(m) + shift;
    const pc = ((mm % 12) + 12) % 12;
    const [letter, acc] = (flats ? FLAT_MAP : SHARP_MAP)[pc];
    const oct = Math.floor(mm / 12) - 1;
    return { step: (oct - 4) * 7 + letter - 2, acc };
  }

  function draw(beat, d = {}) {
    if (!W) resize();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!part) return;
    const bpm = d.bpm || 100;
    const hitX = Math.round(W * (o.compact ? 0.15 : 0.17));
    const pxPerBeat = ((W - hitX) / o.ahead) * (60 / bpm);
    const xOf = (b) => hitX + (b - beat) * pxPerBeat;
    const pitched = ['keys', 'wind', 'bow', 'voice'].includes(kind);
    const u = H / 150; // 크기 단위(높이 150 기준)
    const s = Math.max(6, Math.min(H * (o.compact ? 0.11 : 0.1), 22 * dpr)); // 줄 간격
    const midY = H * (pitched ? 0.5 : 0.52);
    const bottom = midY + s * 2; // E4 줄
    const yStep = (st) => bottom - st * (s / 2);
    const now = performance.now();

    // 지나간 쪽은 흐리게
    const fade = g.createLinearGradient(0, 0, hitX, 0);
    fade.addColorStop(0, 'rgba(0,0,0,.35)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, hitX, H);

    // 줄
    g.lineWidth = Math.max(1, dpr * 1.1);
    g.strokeStyle = 'rgba(255,255,255,.26)';
    g.beginPath();
    if (pitched) for (let k = 0; k < 5; k++) { const y = bottom - k * s; g.moveTo(0, y); g.lineTo(W, y); }
    else { g.moveTo(0, midY); g.lineTo(W, midY); }
    g.stroke();
    if (pitched && shift) {
      g.fillStyle = 'rgba(255,255,255,.4)';
      g.font = `700 ${Math.round(11 * u)}px ${SANS}`;
      g.fillText(shift > 0 ? '8vb' : '8va', 6 * dpr, shift > 0 ? bottom + s * 1.6 : bottom - s * 5);
    }

    // 마디 줄
    const b0 = beat - o.behind * (bpm / 60) - 1;
    const b1 = beat + o.ahead * (bpm / 60) + 1;
    const top = pitched ? bottom - 4 * s : midY - s * 1.4;
    const bot = pitched ? bottom : midY + s * 1.4;
    g.strokeStyle = 'rgba(255,255,255,.2)';
    g.lineWidth = Math.max(1, dpr);
    g.beginPath();
    for (let b = Math.ceil(Math.max(0, b0) / barLen) * barLen; b <= b1; b += barLen) {
      const x = xOf(b);
      if (x < -5 || x > W + 5) continue;
      g.moveTo(x, top); g.lineTo(x, bot);
    }
    g.stroke();
    if (!o.compact) {
      g.fillStyle = 'rgba(255,255,255,.3)';
      g.font = `600 ${Math.round(10 * u)}px ${SANS}`;
      for (let b = Math.ceil(Math.max(0, b0) / barLen) * barLen; b <= b1; b += barLen) {
        const x = xOf(b);
        if (x > hitX && x < W - 10) g.fillText(String(Math.round(b / barLen) + 1), x + 3 * dpr, top - 5 * dpr);
      }
    }

    // 판정선
    const lv = Math.max(0, Math.min(1, d.level || 0));
    const glow = g.createLinearGradient(hitX - 18 * dpr, 0, hitX + 18 * dpr, 0);
    glow.addColorStop(0, hexA(color, 0));
    glow.addColorStop(0.5, hexA(color, 0.18 + lv * 0.4));
    glow.addColorStop(1, hexA(color, 0));
    g.fillStyle = glow;
    g.fillRect(hitX - 18 * dpr, top - s, 36 * dpr, bot - top + 2 * s);
    g.fillStyle = color;
    g.fillRect(hitX - dpr, top - s * 0.8, 2 * dpr, bot - top + s * 1.6);

    // 음표들
    const ns = part.notes;
    let i0 = 0;
    { let lo = 0, hi = ns.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ns[m].b + ns[m].d < b0) lo = m + 1; else hi = m; } i0 = lo; }
    const rx = s * 0.66, ry = s * 0.47;
    let nextShown = false;
    const ribbons = [];
    const heads = [];
    for (let i = i0; i < ns.length; i++) {
      const n = ns[i];
      if (n.b > b1) break;
      const x = xOf(n.b);
      const mk = marks.get(n.i);
      const state = mk ? mk.kind : null;
      let y, acc = 0, step = 0;
      if (pitched) { const st = stepOf(n.m); step = st.step; acc = st.acc; y = yStep(step); }
      else if (kind === 'strike') y = n.m === 36 || n.m === 35 ? midY + s * 0.9 : n.m === 49 || n.m === 57 ? midY - s * 1.6 : [41, 43, 45, 47, 48, 50].includes(n.m) ? midY - s * 0.8 : midY;
      else y = midY;
      const isNext = !state && !nextShown && n.b >= beat - 0.25;
      if (isNext) nextShown = true;
      if (pitched && (kind !== 'keys') && n.d > 0.4) ribbons.push({ x, x2: xOf(n.b + n.d), y, state });
      heads.push({ n, x, y, step, acc, state, mk, isNext });
    }
    // 길게 끄는 띠(관·현·성악)
    for (const r of ribbons) {
      const c = r.state === 'miss' ? 'rgba(120,128,145,.25)' : r.state === 'perfect' ? hexA(GOLD, 0.28) : hexA(color, 0.26);
      g.fillStyle = c;
      const hh = ry * 0.9;
      roundRect(g, r.x, r.y - hh, Math.max(4, r.x2 - r.x - 4 * dpr), hh * 2, hh);
      g.fill();
    }
    let labRight = -1e9; // 이름표가 겹치면 뒤엣것은 건너뜁니다(빠른 대목)
    for (const h of heads) drawHead(h);

    // 목소리 음높이 선(성악가)
    if (d.trace && d.trace.length > 1 && pitched) {
      g.lineWidth = 3 * dpr;
      g.lineJoin = 'round';
      g.strokeStyle = 'rgba(255,255,255,.85)';
      g.beginPath();
      let pen = false;
      for (const p of d.trace) {
        if (p.m == null) { pen = false; continue; }
        const x = xOf(p.b);
        if (x < 0 || x > hitX + 2) { pen = false; continue; }
        const y = yForMidi(p.m);
        if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y);
      }
      g.stroke();
    }
    // 판정 터짐
    for (const h of heads) {
      if (!h.mk || h.state === 'miss') continue;
      const t = (now - h.mk.at) / 380;
      if (t > 1) continue;
      g.strokeStyle = h.state === 'perfect' ? hexA(GOLD, 1 - t) : `rgba(255,255,255,${0.8 * (1 - t)})`;
      g.lineWidth = (3 - 2 * t) * dpr;
      g.beginPath();
      g.arc(hitX, h.y, rx * (1.2 + t * 2.4), 0, Math.PI * 2);
      g.stroke();
    }

    function yForMidi(m) {
      const a = Math.floor(m), f = m - a;
      const y1 = yStep(stepOf(a).step), y2 = yStep(stepOf(a + 1).step);
      return y1 + (y2 - y1) * f;
    }

    function drawHead(h) {
      const { n, x, y, state, isNext } = h;
      if (x < -40 || x > W + 40) return;
      const past = x < hitX - 2;
      let fill = color;
      if (state === 'perfect') fill = GOLD;
      else if (state === 'good') fill = '#eef3ff';
      else if (state === 'miss') fill = '#5d6577';
      const alpha = state === 'miss' ? 0.75 : past && !state ? 0.55 : 1;
      g.globalAlpha = alpha;
      // 덧줄
      if (pitched) {
        g.strokeStyle = 'rgba(255,255,255,.4)';
        g.lineWidth = Math.max(1, dpr * 1.1);
        g.beginPath();
        for (let st = -2; st >= h.step; st -= 2) { const yy = yStep(st); g.moveTo(x - rx * 1.6, yy); g.lineTo(x + rx * 1.6, yy); }
        for (let st = 10; st <= h.step; st += 2) { const yy = yStep(st); g.moveTo(x - rx * 1.6, yy); g.lineTo(x + rx * 1.6, yy); }
        g.stroke();
      }
      if (kind === 'baton') {
        const big = n.n === 1;
        const R = s * (big ? 1.25 : 0.95);
        g.fillStyle = state ? fill : hexA(color, 0.92);
        g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#0b1220';
        g.font = `400 ${Math.round(R * 1.2)}px Anton, Impact, sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(n.n), x, y + R * 0.05);
        g.fillStyle = state === 'miss' ? '#8a93a6' : '#fff';
        g.font = `800 ${Math.round(R * 1.15)}px ${SANS}`;
        g.fillText(DIR_ARROW[n.dir] || '', x, y - R * 2.1);
        g.textAlign = 'start'; g.textBaseline = 'alphabetic';
      } else if (kind === 'strike' && (n.m === 49 || n.m === 57)) {
        g.strokeStyle = fill; g.lineWidth = 2.6 * dpr;
        g.beginPath(); g.moveTo(x - rx, y - rx); g.lineTo(x + rx, y + rx); g.moveTo(x + rx, y - rx); g.lineTo(x - rx, y + rx); g.stroke();
      } else {
        const hollow = pitched && n.d >= 2 && kind !== 'keys';
        g.save();
        g.translate(x, y);
        g.rotate(-0.33);
        g.beginPath();
        g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        if (hollow) { g.lineWidth = s * 0.2; g.strokeStyle = fill; g.stroke(); }
        else { g.fillStyle = fill; g.fill(); }
        g.restore();
        // 기둥
        if (!(pitched && n.d >= 4)) {
          const up = !pitched || h.step < 4;
          g.strokeStyle = fill; g.lineWidth = Math.max(1.4, s * 0.12);
          g.beginPath();
          if (up) { g.moveTo(x + rx * 0.92, y - ry * 0.3); g.lineTo(x + rx * 0.92, y - s * 3.2); }
          else { g.moveTo(x - rx * 0.92, y + ry * 0.3); g.lineTo(x - rx * 0.92, y + s * 3.2); }
          g.stroke();
          if (n.roll) {
            g.lineWidth = s * 0.22;
            for (let k = 0; k < 3; k++) { const yy = y - s * (1.4 + k * 0.5); g.beginPath(); g.moveTo(x + rx * 0.4, yy + s * 0.25); g.lineTo(x + rx * 1.5, yy - s * 0.25); g.stroke(); }
          }
        }
        if (h.acc) {
          g.fillStyle = fill;
          g.font = `700 ${Math.round(s * 1.7)}px ${SANS}`;
          g.textAlign = 'right';
          g.fillText(h.acc > 0 ? '♯' : '♭', x - rx * 1.25, y + s * 0.55);
          g.textAlign = 'start';
        }
      }
      if (state === 'miss' && kind !== 'baton') {
        g.strokeStyle = '#ff5a5f'; g.lineWidth = 2 * dpr;
        const k = rx * 0.7;
        g.beginPath(); g.moveTo(x - k, y - k - s * 1.6); g.lineTo(x + k, y + k - s * 1.6); g.moveTo(x + k, y - k - s * 1.6); g.lineTo(x - k, y + k - s * 1.6); g.stroke();
      }
      // 이름표: 밸브·현·계이름
      const lab = labelOf(n);
      if (lab && x > hitX - 30 * dpr) {
        const fs = Math.round(Math.max(10 * dpr, s * (o.compact ? 0.95 : 0.9)));
        g.font = `800 ${fs}px ${SANS}`;
        const half = (g.measureText(lab.text).width + (lab.pill ? fs * 0.9 : 0)) / 2;
        if (x - half < labRight + 3 * dpr && !isNext) { g.globalAlpha = 1; return; }
        labRight = x + half;
        g.textAlign = 'center';
        const ty = pitched ? (lab.top ? Math.min(bottom - 4 * s - s * 1.2, y - s * 2) : Math.max(bottom + s * 1.9, y + s * 1.9)) : midY - s * 2.2;
        if (lab.pill) {
          const tw = g.measureText(lab.text).width + fs * 0.9;
          g.fillStyle = state ? 'rgba(255,255,255,.12)' : hexA(color, 0.22);
          roundRect(g, x - tw / 2, ty - fs * 0.95, tw, fs * 1.3, fs * 0.65);
          g.fill();
        }
        g.fillStyle = state === 'miss' ? '#8a93a6' : '#fff';
        g.fillText(lab.text, x, ty);
        g.textAlign = 'start';
      }
      // 다음 음 고리
      if (isNext && kind !== 'baton') {
        const pulse = 0.5 + 0.5 * Math.sin(now / 140);
        g.strokeStyle = hexA(color, 0.45 + 0.4 * pulse);
        g.lineWidth = 2 * dpr;
        g.beginPath(); g.arc(x, y, rx * (1.7 + pulse * 0.25), 0, Math.PI * 2); g.stroke();
      }
      g.globalAlpha = 1;
    }
  }

  function labelOf(n) {
    if (kind === 'wind' && diff !== 'easy' && n.valves != null) return { text: valveLabel(n.valves), top: true, pill: true };
    if (kind === 'bow' && diff === 'hard' && n.str != null) return { text: STRINGS[n.str], top: true, pill: true };
    if ((kind === 'keys' || kind === 'voice') && diff !== 'hard' && !n.chord && n.m) return { text: solfa(n.m), top: false };
    if (kind === 'tap' && n.roll) return { text: '드르륵', top: true, pill: true };
    return null;
  }

  return { canvas, resize, setPart, mark, clearMarks, draw, get part() { return part; } };
}

function roundRect(g, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}
