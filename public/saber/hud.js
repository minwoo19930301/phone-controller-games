// 화면 분할 HUD: 칸마다 선수 배지(점수·체력·연속 막기), 웨이브 표시, 판정 글자, 득점 알림, 피격 번쩍임,
// 슬로우 연출(비네트·채도), 화면 밖에서 충전 중인 드론 방향 화살표, 쓰러짐/끝 배너. 글자 크기는 칸 크기에 맞춰 줄어듭니다.

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HP_SEG = 10;

export function createHud(root) {
  let key = '';
  let cells = [];

  function playerCell(v) {
    const c = el('div', 'vp');
    c.style.setProperty('--c', v.color);
    const fx = el('div', 'fx');
    const hurt = el('div', 'hurt');
    const arrows = el('div', 'arrows');
    const arrowEls = [];
    for (let k = 0; k < 6; k++) {
      const a = el('div', 'arrow', '<i></i>');
      arrows.appendChild(a);
      arrowEls.push(a);
    }
    const badge = el('div', 'badge');
    let segs = '';
    for (let k = 0; k < HP_SEG; k++) segs += '<i></i>';
    badge.innerHTML =
      `<div class="who">${esc(v.name)}</div>` +
      '<div class="sc"><b class="score">0</b><span>점</span></div>' +
      `<div class="hp"><div class="hp-k">체력</div><div class="hp-bar">${segs}</div></div>` +
      '<div class="streak"><b>0</b><span>연속</span></div>';
    const wave = el('div', 'wave', '<span>WAVE <b class="wn">1</b></span><b class="tm">1:30</b>');
    const slow = el('div', 'slowtag', '<i></i>SLOW');
    const call = el('div', 'call', '<b></b><span></span>');
    const toast = el('div', 'toast', '<b></b><span></span>');
    const banner = el('div', 'banner', '<b></b><span></span><em></em>');
    const note = el('div', 'note');
    const hint = el('div', 'guide');
    c.append(fx, hurt, arrows, badge, wave, slow, call, toast, banner, note, hint);
    return {
      el: c, kind: 'player', fx, hurt, arrowEls, badge, wave, slow, call, toast, banner, note, hint,
      score: badge.querySelector('.score'), segs: [...badge.querySelectorAll('.hp-bar i')], streak: badge.querySelector('.streak'),
      timers: {}, last: {}
    };
  }
  function overviewCell() {
    const c = el('div', 'vp ov');
    const tag = el('div', 'ov-tag', '<i></i>TRAINING HALL');
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
  const isP = (c) => c && c.kind === 'player';
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
    /** s: { score, hp(0~100), streak, wave, time('1:23'), urgent, away, down } */
    player(i, s) {
      const c = cell(i);
      if (!isP(c)) return;
      const k = `${s.score}|${Math.ceil(s.hp)}|${s.streak}|${s.wave}|${s.time}|${s.urgent}|${s.away}|${s.down}`;
      if (c.last.k === k) return;
      const prev = c.last.s;
      c.last.k = k;
      c.last.s = { ...s };
      setText(c.score, s.score.toLocaleString('ko-KR'));
      if (prev && prev.score !== s.score) {
        c.score.classList.remove('bump');
        void c.score.offsetWidth;
        c.score.classList.add('bump');
      }
      const lit = Math.ceil((Math.max(0, s.hp) / 100) * HP_SEG);
      c.segs.forEach((e, n) => {
        e.className = n < lit ? (lit <= 3 ? 'on low' : 'on') : '';
      });
      if (prev && s.hp < prev.hp) {
        const bar = c.badge.querySelector('.hp');
        bar.classList.remove('shake');
        void bar.offsetWidth;
        bar.classList.add('shake');
      }
      c.streak.querySelector('b').textContent = String(s.streak);
      c.streak.classList.toggle('on', s.streak >= 3);
      setText(c.wave.querySelector('.wn'), String(s.wave));
      setText(c.wave.querySelector('.tm'), s.time || '');
      c.wave.classList.toggle('urgent', Boolean(s.urgent));
      c.badge.classList.toggle('away', Boolean(s.away));
      c.el.classList.toggle('down', Boolean(s.down));
    },
    callout(i, main, sub, cls, ms = 1100) {
      const c = cell(i);
      if (!isP(c)) return;
      c.call.className = `call ${cls || ''}`;
      c.call.querySelector('b').textContent = main;
      c.call.querySelector('span').textContent = sub || '';
      flashOn(c, 'call', ms);
    },
    toast(i, main, sub, cls, ms = 1500) {
      const c = cell(i);
      if (!isP(c)) return;
      c.toast.className = `toast ${cls || ''}`;
      c.toast.querySelector('b').textContent = main;
      c.toast.querySelector('span').textContent = sub || '';
      flashOn(c, 'toast', ms);
    },
    banner(i, main, sub, extra, cls) {
      const c = cell(i);
      if (!isP(c)) return;
      if (!main) {
        c.banner.classList.remove('on');
        return;
      }
      c.banner.className = `banner ${cls || ''}`;
      c.banner.querySelector('b').textContent = main;
      c.banner.querySelector('span').textContent = sub || '';
      c.banner.querySelector('em').textContent = extra || '';
      void c.banner.offsetWidth;
      c.banner.classList.add('on');
    },
    note(i, text, ms = 1800) {
      const c = cell(i);
      if (!isP(c) || !text) return;
      c.note.textContent = text;
      flashOn(c, 'note', ms);
    },
    // 계속 떠 있는 안내(빈 글자면 숨김)
    hint(i, text) {
      const c = cell(i);
      if (!isP(c) || c.last.hint === text) return;
      c.last.hint = text;
      if (text) c.hint.textContent = text;
      c.hint.classList.toggle('on', Boolean(text));
    },
    wave(i) {
      const c = cell(i);
      if (!isP(c)) return;
      flashOn(c, 'wave', 1600);
    },
    hurt(i) {
      const c = cell(i);
      if (!isP(c)) return;
      flashOn(c, 'hurt', 420);
    },
    // 슬로우 연출 세기(0~1)
    slow(i, amt) {
      const c = cell(i);
      if (!isP(c)) return;
      const a = Math.round(amt * 100) / 100;
      if (c.last.slow === a) return;
      c.last.slow = a;
      c.fx.style.opacity = String(a);
      c.slow.classList.toggle('on', a > 0.35);
    },
    /** list: [{ x, y, ang(라디안, 화면 기준), hot(0~1) }] — 칸 가장자리 위치 */
    arrows(i, list) {
      const c = cell(i);
      if (!isP(c)) return;
      c.arrowEls.forEach((a, n) => {
        const it = list[n];
        if (!it) {
          if (a.style.display !== 'none') a.style.display = 'none';
          return;
        }
        a.style.display = '';
        a.style.transform = `translate(${it.x.toFixed(0)}px, ${it.y.toFixed(0)}px) rotate(${it.ang.toFixed(3)}rad)`;
        a.classList.toggle('hot', it.hot > 0.6);
      });
    },
    overview(i, rows) {
      const c = cell(i);
      if (!c || c.kind !== 'overview') return;
      const html = rows
        .map((r) => `<div class="ovr${r.down ? ' down' : ''}"><i style="background:${r.color}"></i><span class="n" style="color:${r.color}">${esc(r.name)}</span>` +
          `<b>${r.score.toLocaleString('ko-KR')}</b><span class="hpm"><span style="width:${Math.max(0, r.hp)}%;background:${r.color}"></span></span></div>`)
        .join('');
      if (html !== c.last) {
        c.last = html;
        c.boards.innerHTML = html;
      }
    }
  };
}
