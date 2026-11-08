// 화면 분할 HUD: 칸마다 선수 배지(점수·체력·연속 막기), 웨이브 표시, 판정 글자, 득점 알림, 피격 번쩍임,
// 슬로우 연출(비네트·채도), 화면 밖에서 충전 중인 드론 방향 화살표, 쓰러짐/끝 배너. 글자 크기는 칸 크기에 맞춰 줄어듭니다.
// 로봇 검투에서는 로봇 체력 띠, 공격 예고(방향 화살표 + 남은 시간), 빈틈 시간, 칼 부딪힘 번쩍임, 피해 숫자를 더 그립니다.

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HP_SEG = 10;
// 로봇 공격 예고 그림: 왼쪽·오른쪽은 그쪽 가장자리를 가리키는 겹화살, 위는 위쪽 겹화살, 찌르기는 과녁
const WARN_ICON = {
  left: '<svg viewBox="0 0 64 64"><path d="M38 10L14 32l24 22"/><path d="M54 10L30 32l24 22"/></svg>',
  right: '<svg viewBox="0 0 64 64"><path d="M26 10l24 22-24 22"/><path d="M10 10l24 22-24 22"/></svg>',
  overhead: '<svg viewBox="0 0 64 64"><path d="M10 38L32 14l22 24"/><path d="M10 54L32 30l22 24"/></svg>',
  thrust: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="24"/><circle cx="32" cy="32" r="13"/><circle cx="32" cy="32" r="3.5" class="dot"/></svg>'
};

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
    // 로봇 검투: 로봇 체력, 공격 예고, 빈틈(베기) 시간, 칼 부딪힘 번쩍, 피해 숫자
    const rhp = el('div', 'rhp', '<div class="rhp-top"><span class="rhp-n"></span><span class="rhp-lv"></span><b class="rhp-v"></b></div>' +
      '<div class="rhp-bar"><i class="g"></i><i class="f"></i><s></s><s></s><s></s></div>');
    const warn = el('div', 'warn', '<div class="w-ic"></div><div class="w-tx"><b></b><span></span></div><div class="w-bar"><i></i></div><em class="w-cb"></em>');
    const open = el('div', 'openx', '<b>지금 베기!</b><span>휘두르세요</span><div class="o-bar"><i></i></div><div class="o-pips"></div>');
    const clash = el('div', 'clashfx');
    const dmg = el('div', 'dmgs');
    c.append(fx, hurt, clash, arrows, badge, wave, rhp, warn, open, dmg, slow, call, toast, banner, note, hint);
    return {
      el: c, kind: 'player', fx, hurt, arrowEls, badge, wave, slow, call, toast, banner, note, hint, rhp, warn, open, clash, dmg,
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
      cells[i].el.classList.toggle('duel', Boolean(v.duel));
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
    /** s: { score, hp(0~100), streak, wave, time('1:23'), urgent, away, down, tag?('DUEL' 처럼 WAVE 대신 쓸 글자) } */
    player(i, s) {
      const c = cell(i);
      if (!isP(c)) return;
      const k = `${s.score}|${Math.ceil(s.hp)}|${s.streak}|${s.wave}|${s.time}|${s.urgent}|${s.away}|${s.down}|${s.tag || ''}`;
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
      if (s.tag) setText(c.wave.querySelector('span'), s.tag);
      else if (!c.wave.querySelector('.wn')) c.wave.querySelector('span').innerHTML = 'WAVE <b class="wn">1</b>';
      if (c.wave.querySelector('.wn')) setText(c.wave.querySelector('.wn'), String(s.wave));
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
    /**
     * 로봇 검투 표시. st 가 없으면 모두 숨깁니다.
     * st: { name, hp, max, ghost, level('쉬움'…), warn(left|right|overhead|thrust|null), main, sub, prog(0~1), hitNow,
     *       comboN, combo, open(bool), openK(0~1), hits, maxHits }
     */
    duel(i, st) {
      const c = cell(i);
      if (!isP(c)) return;
      if (!st) {
        if (c.last.duel) {
          c.last.duel = null;
          c.rhp.classList.remove('on');
          c.warn.classList.remove('on');
          c.open.classList.remove('on');
        }
        return;
      }
      c.last.duel = st;
      c.rhp.classList.add('on');
      const pct = Math.max(0, st.hp / st.max) * 100;
      const g = Math.max(pct, Math.max(0, st.ghost / st.max) * 100);
      const L = c.last;
      if (L.rn !== st.name) {
        L.rn = st.name;
        c.rhp.querySelector('.rhp-n').textContent = st.name;
      }
      if (L.rlv !== st.level) {
        L.rlv = st.level;
        c.rhp.querySelector('.rhp-lv').textContent = st.level || '';
      }
      const v = String(Math.ceil(st.hp));
      if (L.rv !== v) {
        if (L.rv != null && Number(v) < Number(L.rv)) {
          c.rhp.classList.remove('hit');
          void c.rhp.offsetWidth;
          c.rhp.classList.add('hit');
        }
        L.rv = v;
        c.rhp.querySelector('.rhp-v').textContent = v;
        c.rhp.querySelector('.f').style.width = `${pct.toFixed(1)}%`;
        c.rhp.classList.toggle('low', pct <= 30);
      }
      c.rhp.querySelector('.g').style.width = `${g.toFixed(1)}%`;
      // 공격 예고
      const w = c.warn;
      if (st.warn) {
        if (L.wk !== st.warn || L.wid !== st.id) {
          L.wk = st.warn;
          L.wid = st.id;
          w.className = `warn on ${st.warn}`;
          w.querySelector('.w-ic').innerHTML = WARN_ICON[st.warn] || '';
          w.querySelector('b').textContent = st.main || '';
          w.querySelector('span').textContent = st.sub || '';
          void w.offsetWidth;
          w.classList.add('pop');
        }
        w.classList.toggle('now', Boolean(st.hitNow));
        w.querySelector('.w-bar i').style.transform = `scaleX(${Math.max(0, Math.min(1, st.prog)).toFixed(3)})`;
        const cb = st.combo > 1 ? `연속 ${st.comboN + 1}/${st.combo}` : '';
        if (L.cb !== cb) {
          L.cb = cb;
          w.querySelector('.w-cb').textContent = cb;
        }
      } else if (L.wk) {
        L.wk = null;
        w.classList.remove('on', 'pop', 'now');
      }
      // 빈틈(베기)
      const o = c.open;
      if (st.open) {
        if (!o.classList.contains('on')) {
          o.classList.add('on');
          L.pips = -1;
        }
        o.querySelector('.o-bar i').style.transform = `scaleX(${Math.max(0, Math.min(1, st.openK)).toFixed(3)})`;
        const pk = `${st.hits}/${st.maxHits}`;
        if (L.pips !== pk) {
          L.pips = pk;
          let h = '';
          for (let n = 0; n < st.maxHits; n++) h += `<i class="${n < st.hits ? 'on' : ''}"></i>`;
          o.querySelector('.o-pips').innerHTML = h;
        }
      } else if (o.classList.contains('on')) o.classList.remove('on');
    },
    /** 순간 효과: 'clash'(칼끼리 부딪힘 번쩍), 'dmg'(로봇 피해 숫자 {dmg, hits}) */
    fx(i, kind, data = {}) {
      const c = cell(i);
      if (!isP(c)) return;
      if (kind === 'clash') {
        flashOn(c, 'clash', 380);
        return;
      }
      if (kind === 'dmg') {
        const n = el('b', `dmg h${Math.min(3, data.hits || 1)}`, `-${Math.round(data.dmg || 0)}`);
        // 로봇 가슴 근처(칸 가운데 조금 위)에서 떠오릅니다.
        n.style.left = `${50 + (Math.random() - 0.5) * 16}%`;
        n.style.top = `${48 + (Math.random() - 0.5) * 8}%`;
        c.dmg.appendChild(n);
        setTimeout(() => n.remove(), 1000);
      }
    },
    overview(i, rows) {
      const c = cell(i);
      if (!c || c.kind !== 'overview') return;
      const html = rows
        .map((r) => `<div class="ovr${r.down ? ' down' : ''}"><i style="background:${r.color}"></i><span class="n" style="color:${r.color}">${esc(r.name)}</span>` +
          `<b>${r.score.toLocaleString('ko-KR')}</b><span class="hpm"><span style="width:${Math.max(0, r.hp)}%;background:${r.color}"></span></span>` +
          (r.rhp != null ? `<span class="hpm rob" title="로봇 체력"><span style="width:${Math.max(0, r.rhp)}%"></span></span>` : '') + '</div>')
        .join('');
      if (html !== c.last) {
        c.last = html;
        c.boards.innerHTML = html;
      }
    }
  };
}
