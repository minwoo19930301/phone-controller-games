// 화면 분할 HUD: 뷰포트마다 점수 배지, 서브 표시, 타구 판정, 득점 알림, 슬로우 연출(비네트·채도), 타이밍 링.
// 뷰포트 하나 = DOM 칸 하나. 글자 크기는 칸 크기(container query)에 맞춰 줄어듭니다.

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createHud(root) {
  let key = '';
  let cells = [];

  function playerCell(v) {
    const c = el('div', 'vp');
    c.style.setProperty('--c', v.color);
    const fx = el('div', 'fx');
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'ring');
    const halo = document.createElementNS(svgNS, 'circle');
    halo.setAttribute('class', 'ring-halo');
    const outer = document.createElementNS(svgNS, 'circle');
    outer.setAttribute('class', 'ring-o');
    const inner = document.createElementNS(svgNS, 'circle');
    inner.setAttribute('class', 'ring-i');
    svg.append(halo, outer, inner);
    const badge = el('div', 'badge');
    badge.innerHTML =
      `<div class="who">${esc(v.name)}</div>` +
      '<div class="sc"><b class="me">0</b><i>:</i><b class="op">0</b></div>' +
      '<div class="opp"><span class="opn"></span><span class="tbl"></span></div>' +
      '<div class="srv"><i></i>서브</div>';
    const slow = el('div', 'slowtag', '<i></i>SLOW');
    const call = el('div', 'call', '<b></b><span></span>');
    const toast = el('div', 'toast', '<b></b><span></span>');
    const banner = el('div', 'banner', '<b></b><span></span>');
    const note = el('div', 'note');
    const handtag = el('div', 'handtag');
    c.append(fx, svg, handtag, badge, slow, call, toast, banner, note);
    return {
      el: c, kind: 'player', fx, svg, halo, outer, inner, handtag, badge, slow, call, toast, banner, note,
      me: badge.querySelector('.me'), op: badge.querySelector('.op'), opn: badge.querySelector('.opn'),
      tbl: badge.querySelector('.tbl'), srv: badge.querySelector('.srv'), timers: {}, last: {}
    };
  }
  function overviewCell() {
    const c = el('div', 'vp ov');
    const tag = el('div', 'ov-tag', '<i></i>ARENA VIEW');
    const boards = el('div', 'ov-boards');
    c.append(tag, boards);
    return { el: c, kind: 'overview', boards, last: '' };
  }

  function layout(views) {
    const k = views.map((v) => `${v.kind}:${v.slot ?? ''}:${v.color ?? ''}`).join('|');
    if (k !== key) {
      key = k;
      root.innerHTML = '';
      cells = views.map((v) => (v.kind === 'overview' ? overviewCell() : playerCell(v)));
      for (const c of cells) root.appendChild(c.el);
    }
    views.forEach((v, i) => {
      const s = cells[i].el.style;
      s.left = `${v.x}px`;
      s.top = `${v.y}px`;
      s.width = `${v.w}px`;
      s.height = `${v.h}px`;
      cells[i].el.classList.toggle('split', views.length > 1);
    });
  }

  const cell = (i) => cells[i];
  function setText(e, t) {
    if (e.textContent !== t) e.textContent = t;
  }
  function flashOn(c, part, ms) {
    const e = c[part];
    e.classList.remove('on');
    void e.offsetWidth;
    e.classList.add('on');
    clearTimeout(c.timers[part]);
    if (ms) c.timers[part] = setTimeout(() => e.classList.remove('on'), ms);
  }

  return {
    layout,
    clear() {
      key = '';
      cells = [];
      root.innerHTML = '';
    },
    score(i, s) {
      const c = cell(i);
      if (!c || c.kind !== 'player') return;
      const k = JSON.stringify(s);
      if (c.last.score === k) return;
      const prev = c.last.scoreObj;
      c.last.score = k;
      c.last.scoreObj = s;
      setText(c.me, String(s.me));
      setText(c.op, String(s.op));
      if (prev && prev.me !== s.me) flashOn(c, 'me', 700);
      if (prev && prev.op !== s.op) flashOn(c, 'op', 700);
      setText(c.opn, `vs ${s.oppName}`);
      c.opn.style.color = s.oppColor;
      setText(c.tbl, `TABLE ${s.table}`);
      c.srv.classList.toggle('on', Boolean(s.serving));
      c.badge.classList.toggle('away', Boolean(s.away));
    },
    callout(i, main, sub, cls, ms = 1400) {
      const c = cell(i);
      if (!c || c.kind !== 'player') return;
      c.call.className = `call ${cls || ''}`;
      c.call.querySelector('b').textContent = main;
      c.call.querySelector('span').textContent = sub || '';
      flashOn(c, 'call', ms);
      c.call.classList.add('on');
    },
    toast(i, main, sub, good, ms = 1700) {
      const c = cell(i);
      if (!c || c.kind !== 'player') return;
      c.toast.className = `toast ${good ? 'good' : 'bad'}`;
      c.toast.querySelector('b').textContent = main;
      c.toast.querySelector('span').textContent = sub || '';
      flashOn(c, 'toast', ms);
      c.toast.classList.add('on');
    },
    banner(i, main, sub, good) {
      const c = cell(i);
      if (!c || c.kind !== 'player') return;
      if (!main) {
        c.banner.classList.remove('on');
        return;
      }
      c.banner.className = `banner ${good ? 'good' : 'bad'}`;
      c.banner.querySelector('b').textContent = main;
      c.banner.querySelector('span').textContent = sub || '';
      void c.banner.offsetWidth;
      c.banner.classList.add('on');
    },
    note(i, text, ms = 1800) {
      const c = cell(i);
      if (!c || c.kind !== 'player') return;
      c.note.textContent = text;
      flashOn(c, 'note', ms);
      c.note.classList.add('on');
    },
    // 슬로우 연출 세기(0~1): 비네트, 채도 낮춤, SLOW 표시
    slow(i, amt) {
      const c = cell(i);
      if (!c || c.kind !== 'player') return;
      const a = Math.round(amt * 100) / 100;
      if (c.last.slow === a) return;
      c.last.slow = a;
      c.fx.style.opacity = String(a);
      c.slow.classList.toggle('on', a > 0.35);
    },
    /**
     * 타이밍 링: 공 둘레에서 줄어들다가 이상적인 타점에 공 크기와 같아집니다.
     * r = { x, y, ball(공 반지름 px), R(지금 링 반지름 px), p(남은 비율 0~1), after(타점 지남) } 또는 null
     */
    ring(i, r) {
      const c = cell(i);
      if (!c || c.kind !== 'player') return;
      if (!r) {
        if (c.last.ring) {
          c.svg.classList.remove('on');
          c.handtag.classList.remove('on');
        }
        c.last.ring = false;
        return;
      }
      c.last.ring = true;
      c.svg.classList.add('on');
      c.svg.classList.toggle('late', Boolean(r.after));
      c.svg.classList.toggle('close', r.p < 0.18);
      const set = (e, rad) => {
        e.setAttribute('cx', r.x.toFixed(1));
        e.setAttribute('cy', r.y.toFixed(1));
        e.setAttribute('r', Math.max(1, rad).toFixed(1));
      };
      set(c.outer, r.R);
      set(c.halo, r.R);
      set(c.inner, r.ball + 2);
      // 칠 손 글씨: 링 바로 아래(칸 아래쪽에 닿으면 링 위). side −1 = 왼쪽(백핸드) 화살표, +1 = 오른쪽
      if (r.label) {
        const html = r.side < 0 ? `<i>←</i>${esc(r.label)}` : r.side > 0 ? `${esc(r.label)}<i>→</i>` : esc(r.label);
        if (c.last.hand !== html) {
          c.last.hand = html;
          c.handtag.innerHTML = html;
        }
        const h = c.el.clientHeight;
        const below = r.y + r.R + 10;
        const y = below + 40 < h ? below : Math.max(4, r.y - r.R - 44);
        c.handtag.style.transform = `translate(${r.x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, 0)`;
        c.handtag.classList.add('on');
      } else c.handtag.classList.remove('on');
    },
    overview(i, rows) {
      const c = cell(i);
      if (!c || c.kind !== 'overview') return;
      const html = rows
        .map((r) => `<div class="ovr"><span class="t">${esc(r.table)}</span>` +
          `<span class="n" style="color:${r.c0}">${esc(r.n0)}</span><b>${r.s0}</b><i>:</i><b>${r.s1}</b>` +
          `<span class="n" style="color:${r.c1}">${esc(r.n1)}</span>${r.done ? '<em>끝</em>' : ''}</div>`)
        .join('');
      if (html !== c.last) {
        c.last = html;
        c.boards.innerHTML = html;
      }
    }
  };
}
