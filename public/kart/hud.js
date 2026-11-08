// 화면 분할 HUD: 칸마다 순위·랩·속도·미니맵·카운트다운·알림을 DOM 으로 얹습니다. 글자 크기는 칸 크기(container query)에 맞춰 줄어듭니다.
// 아이템전이면 위 가운데에 아이템 칸(룰렛), 뒤처지면 아래 가운데에 '추격 부스트', 맞으면 빨간 번쩍임, 무적이면 무지개 테두리.
import { ITEM_ICONS, ITEM_NAMES, CHASE_ICON } from './icons.js';

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ORD = ['', '1등', '2등', '3등', '4등'];

export function createHud(root, track) {
  let key = '';
  let cells = [];

  // 미니맵 바탕(도로 윤곽)을 한 번만 그려 둡니다.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < track.N; i++) {
    minX = Math.min(minX, track.x[i]); maxX = Math.max(maxX, track.x[i]);
    minZ = Math.min(minZ, track.z[i]); maxZ = Math.max(maxZ, track.z[i]);
  }
  const bw = maxX - minX;
  const bh = maxZ - minZ;
  const layerCache = new Map();
  function layer(w, h) {
    const k = `${w}x${h}`;
    if (layerCache.has(k)) return layerCache.get(k);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const pad = Math.round(Math.min(w, h) * 0.1);
    const s = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
    const ox = (w - bw * s) / 2 - minX * s;
    const oz = (h - bh * s) / 2 - minZ * s;
    const L = { c, s, ox, oz };
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const path = () => {
      g.beginPath();
      for (let i = 0; i <= track.N; i += 2) {
        const j = i % track.N;
        const px = track.x[j] * s + ox;
        const pz = track.z[j] * s + oz;
        if (i === 0) g.moveTo(px, pz);
        else g.lineTo(px, pz);
      }
      g.closePath();
    };
    g.strokeStyle = 'rgba(0,0,0,.55)';
    g.lineWidth = Math.max(5, track.halfW * 2 * s * 1.5);
    path();
    g.stroke();
    g.strokeStyle = 'rgba(235,238,246,.85)';
    g.lineWidth = Math.max(3, track.halfW * 2 * s);
    path();
    g.stroke();
    // 출발선
    const a = track.at(0);
    g.strokeStyle = '#111';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(a.x * s + ox + -Math.sin(a.th) * 12, a.z * s + oz + Math.cos(a.th) * 12);
    g.lineTo(a.x * s + ox + Math.sin(a.th) * 12, a.z * s + oz - Math.cos(a.th) * 12);
    g.stroke();
    layerCache.set(k, L);
    return L;
  }

  function drawMap(cell, karts, ownId, big) {
    const cv = cell.map;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(40, Math.round(cv.clientWidth * dpr));
    const h = Math.max(30, Math.round(cv.clientHeight * dpr));
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    const L = layer(w, h);
    const g = cell.mapCtx || (cell.mapCtx = cv.getContext('2d'));
    g.clearRect(0, 0, w, h);
    g.drawImage(L.c, 0, 0);
    const R = Math.max(3, Math.min(w, h) * (big ? 0.035 : 0.05));
    // 남의 카트를 먼저, 내 카트는 맨 위
    const order = karts.slice().sort((a, b) => (a.id === ownId) - (b.id === ownId));
    for (const k of order) {
      const px = k.x * L.s + L.ox;
      const pz = k.z * L.s + L.oz;
      const me = k.id === ownId;
      g.fillStyle = k.color;
      g.strokeStyle = '#0b0f17';
      g.lineWidth = Math.max(1.5, R * 0.3);
      g.beginPath();
      g.arc(px, pz, me ? R * 1.35 : R, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (me) {
        g.strokeStyle = '#fff';
        g.lineWidth = Math.max(1.5, R * 0.3);
        g.beginPath();
        g.arc(px, pz, R * 1.8, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }

  function playerCell(v) {
    const c = el('div', 'vp');
    c.style.setProperty('--c', v.color);
    c.innerHTML =
      '<div class="speedfx"></div>' +
      '<div class="rank"><b class="rk">1</b><span class="of">/ 4</span></div>' +
      `<div class="who">${esc(v.name)}</div>` +
      '<div class="lap"><span>랩</span><b class="lp">1</b><i>/ 3</i></div>' +
      '<div class="time">0:00.0</div>' +
      '<div class="speed"><b class="sp">0</b><span>km/h</span></div>' +
      '<canvas class="minimap"></canvas>' +
      '<div class="boost">부스트!</div>' +
      '<div class="wrong">역주행!</div>' +
      '<div class="center"><b></b><span></span></div>' +
      '<div class="toast"></div>' +
      '<div class="starfx"></div><div class="hitfx"></div><div class="boltfx"></div>' +
      '<div class="islot"><div class="ib"><div class="ico"></div></div><span class="iname"></span></div>' +
      `<div class="chase"><i>${CHASE_ICON}</i><span>추격 부스트</span><b>+0%</b></div>` +
      '<div class="fin"><div class="fin-r"></div><div class="fin-t"></div><div class="fin-s">다른 사람이 들어올 때까지 기다려요</div></div>';
    const q = (s) => c.querySelector(s);
    return {
      kind: 'player', root: c, map: q('.minimap'), cache: {},
      rank: q('.rk'), of: q('.of'), lap: q('.lp'), laps: q('.lap i'), time: q('.time'), speed: q('.sp'), speedfx: q('.speedfx'),
      boost: q('.boost'), wrong: q('.wrong'), center: q('.center'), cb: q('.center b'), cs: q('.center span'), toast: q('.toast'),
      fin: q('.fin'), finR: q('.fin-r'), finT: q('.fin-t'), toastTimer: null,
      islot: q('.islot'), ib: q('.ib'), ico: q('.ico'), iname: q('.iname'), chase: q('.chase'), chaseB: q('.chase b'),
      hitfx: q('.hitfx'), starfx: q('.starfx'), boltfx: q('.boltfx')
    };
  }
  function boardCell() {
    const c = el('div', 'vp board');
    c.innerHTML = '<div class="bd-head">순위판</div><canvas class="minimap big"></canvas><div class="bd-list"></div>';
    return { kind: 'board', root: c, map: c.querySelector('.minimap'), list: c.querySelector('.bd-list'), cache: {} };
  }

  function layout(views) {
    const k = views.map((v) => `${v.kind}:${v.slot || ''}:${v.x},${v.y},${v.w},${v.h}`).join('|');
    if (k === key) return;
    key = k;
    root.innerHTML = '';
    cells = views.map((v) => {
      const cell = v.kind === 'board' ? boardCell() : playerCell(v);
      cell.root.style.left = `${v.x}px`;
      cell.root.style.top = `${v.y}px`;
      cell.root.style.width = `${v.w}px`;
      cell.root.style.height = `${v.h}px`;
      if (views.length > 1) cell.root.classList.add('split');
      root.appendChild(cell.root);
      return cell;
    });
  }

  const setText = (cell, name, node, v) => {
    if (cell.cache[name] === v) return;
    cell.cache[name] = v;
    node.textContent = v;
  };

  /**
   * d: { rank, n, lap, laps, speed, time, boost, wrong, count, fin: { rank, time } | null, karts, ownId }
   * count: { text, cls } | null — 카운트다운·GO
   */
  function player(i, d) {
    const c = cells[i];
    if (!c || c.kind !== 'player') return;
    setText(c, 'rank', c.rank, d.rank);
    setText(c, 'of', c.of, `/ ${d.n}`);
    setText(c, 'lap', c.lap, d.lap);
    setText(c, 'laps', c.laps, `/ ${d.laps}`);
    setText(c, 'time', c.time, d.time);
    setText(c, 'speed', c.speed, d.speed);
    c.root.classList.toggle('first', d.rank === 1);
    c.boost.classList.toggle('on', Boolean(d.boost));
    c.wrong.classList.toggle('on', Boolean(d.wrong));
    c.speedfx.style.opacity = String(Math.max(0, Math.min(1, (d.speedN - 0.55) / 0.5)) * 0.8);
    const cnt = d.count;
    const ck = cnt ? cnt.text + cnt.cls : '';
    if (c.cache.cnt !== ck) {
      c.cache.cnt = ck;
      c.center.className = 'center' + (cnt ? ' on ' + cnt.cls : '');
      c.cb.textContent = cnt ? cnt.text : '';
      c.cs.textContent = cnt && cnt.sub ? cnt.sub : '';
    }
    const fk = d.fin ? `${d.fin.rank}${d.fin.time}` : '';
    if (c.cache.fin !== fk) {
      c.cache.fin = fk;
      c.fin.classList.toggle('on', Boolean(d.fin));
      if (d.fin) {
        c.finR.textContent = d.fin.rank ? `${ORD[d.fin.rank] || d.fin.rank + '등'}` : '완주 실패';
        c.finT.textContent = d.fin.time;
      }
    }
    // 아이템 칸: d.item = { on, state: 'none'|'roll'|'have', kind }
    const it = d.item || { on: false };
    c.islot.classList.toggle('on', Boolean(it.on));
    if (it.on) {
      const ik = `${it.state}|${it.kind || ''}`;
      if (c.cache.item !== ik) {
        const was = c.cache.item || '';
        c.cache.item = ik;
        c.ico.innerHTML = it.kind ? ITEM_ICONS[it.kind] || '' : '';
        c.ib.className = 'ib ' + it.state;
        c.iname.textContent = it.state === 'have' ? ITEM_NAMES[it.kind] || '' : it.state === 'roll' ? '' : '';
        if (it.state === 'have' && was.startsWith('roll')) { c.ib.classList.add('land'); }
      }
    }
    // 추격 부스트
    const ch = d.chase || 0;
    const chOn = ch >= 0.035;
    c.chase.classList.toggle('on', chOn);
    const pct = `+${Math.round(ch * 100)}%`;
    if (chOn) setText(c, 'chase', c.chaseB, pct);
    c.starfx.classList.toggle('on', Boolean(d.star));
    // 맞음·번개 번쩍임: 키가 바뀔 때마다 애니메이션을 다시 겁니다.
    if (d.hitKey && c.cache.hit !== d.hitKey) {
      c.cache.hit = d.hitKey;
      c.hitfx.classList.remove('go');
      void c.hitfx.offsetWidth;
      c.hitfx.classList.add('go');
    }
    if (d.boltKey && c.cache.bolt !== d.boltKey) {
      c.cache.bolt = d.boltKey;
      c.boltfx.classList.remove('go');
      void c.boltfx.offsetWidth;
      c.boltfx.classList.add('go');
    }
    drawMap(c, d.karts, d.ownId, false);
  }
  function toast(i, text, ms = 1500) {
    const c = cells[i];
    if (!c || c.kind !== 'player') return;
    c.toast.textContent = text;
    c.toast.classList.add('on');
    clearTimeout(c.toastTimer);
    c.toastTimer = setTimeout(() => c.toast.classList.remove('on'), ms);
  }
  /** 4번째 칸(3인일 때): 순위 목록 + 큰 미니맵 */
  function board(i, rows, karts) {
    const c = cells[i];
    if (!c || c.kind !== 'board') return;
    const k = rows.map((r) => `${r.id}${r.lap}${r.fin ? 1 : 0}`).join(',');
    if (c.cache.rows !== k) {
      c.cache.rows = k;
      c.list.innerHTML = rows.map((r, n) =>
        `<div class="bd-r${r.fin ? ' fin' : ''}" style="--c:${r.color}"><i>${n + 1}</i><b>${esc(r.name)}</b><span>${r.fin ? '완주' : `랩 ${r.lap}/${r.laps}`}</span></div>`).join('');
    }
    drawMap(c, karts, -1, true);
  }

  return { layout, player, toast, board };
}
