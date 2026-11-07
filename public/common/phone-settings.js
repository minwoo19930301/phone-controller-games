// 난이도·종목 옵션 공통 모듈 (폰 쪽).
//
// 큰 화면이 game_state.settings(또는 msg {type:'pcg-settings'})로 보낸 항목을 대기 화면에 알약 버튼·질문 카드로 그리고,
// 누르면 c2d settings {key: value} 를 보냅니다. 값의 주인은 큰 화면이라, 화면이 확인해 줄 때까지만 '보내는 중'으로 보입니다.
// 아직 안 정한 질문(슬로우 모드 등)이 있으면 isAnswered() 가 false 이고, bindReady(버튼) 로 준비 버튼을 막습니다.
//
//   const ps = createPhoneSettings({ socket });
//   ps.attach(socket);                       // game_state·msg·assigned 듣기
//   ps.mount($('settingsBox'));              // 대기 화면 안에 그리기
//   ps.bindReady($('btnGo'));                // 다 정하기 전에는 준비를 막음
//   const win = ps.pick({ easy: 0.3, normal: 0.2, hard: 0.12 });

import { haptics } from './haptics.js';

const DIFF_FALLBACK = 'normal';
const PENDING_MS = 2500; // 화면이 이 시간 안에 확인하지 않으면 원래 값으로 되돌립니다
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hasBatchim = (w) => {
  const c = String(w || '').trim().slice(-1).charCodeAt(0);
  return c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 !== 0 : false;
};
const rieul = (w) => {
  const c = String(w || '').trim().slice(-1).charCodeAt(0);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 === 8;
};
const eul = (w) => (hasBatchim(w) ? '을' : '를');
const euro = (w) => (hasBatchim(w) && !rieul(w) ? '으로' : '로');
const same = (a, b) => a === b || String(a) === String(b);

const CSS = `
.pcgp{--_c:var(--pcgp-accent,var(--c,#8fd8ff));--_sans:"Pretendard Variable",Pretendard,-apple-system,system-ui,sans-serif;
  display:flex;flex-direction:column;gap:10px;width:100%;margin:0;padding:0;text-align:left;color:#f3f4f7;font-family:var(--_sans);
  font-size:15px;line-height:1.35;white-space:normal;box-sizing:border-box;}
.pcgp *{box-sizing:border-box;}
.pcgp[hidden],.pcgp-ask[hidden],.pcgp-row[hidden],.pcgp-note[hidden]{display:none;}
.pcgp-row{display:grid;grid-template-columns:72px minmax(0,1fr);align-items:center;column-gap:10px;row-gap:3px;margin:0;}
.pcgp-label{font-size:13px;font-weight:800;color:#c9d3e3;letter-spacing:-.01em;line-height:1.25;word-break:keep-all;}
.pcgp-label small{display:block;font-size:11px;font-weight:700;color:#8796ad;}
.pcgp-hint{grid-column:2;padding:0 6px;font-size:11.5px;font-weight:600;color:#9aa8bf;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}
.pcgp-hint:empty{display:none;}
.pcgp-seg{display:flex;gap:3px;padding:3px;border-radius:14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);}
.pcgp-pill{appearance:none;-webkit-appearance:none;flex:1 1 0;min-width:0;margin:0;border:0;min-height:42px;padding:6px 4px;border-radius:11px;
  display:flex;align-items:center;justify-content:center;gap:5px;background:transparent;color:#c9d3e3;
  font:800 15px/1.1 var(--_sans);letter-spacing:-.02em;cursor:pointer;white-space:nowrap;-webkit-tap-highlight-color:transparent;
  transition:background .2s,color .2s,box-shadow .2s,transform .12s;}
.pcgp-pill:active{transform:scale(.96);}
.pcgp-pill.on{background:var(--tone,var(--_c));color:#0b0f17;box-shadow:0 4px 16px color-mix(in srgb,var(--tone,var(--_c)) 40%,transparent);}
.pcgp-pill.pending{animation:pcgp-pend .7s ease-in-out infinite alternate;}
.pcgp-lv{display:inline-flex;gap:3px;}
.pcgp-lv b{display:block;width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.25;}
.pcgp-lv b.f{opacity:.9;}
.pcgp-ask{display:flex;flex-direction:column;gap:4px;padding:13px 14px 12px;border-radius:18px;
  background:linear-gradient(150deg,color-mix(in srgb,var(--_c) 24%,#0d1526),#0d1526 72%);border:1.5px solid var(--_c);
  box-shadow:0 10px 30px rgba(0,0,0,.35);animation:pcgp-in .35s cubic-bezier(.2,1.3,.4,1);}
.pcgp-ask.shake{animation:pcgp-shake .5s;}
.pcgp-eyebrow{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:800;letter-spacing:.14em;color:var(--_c);}
.pcgp-eyebrow i{width:7px;height:7px;border-radius:50%;background:var(--_c);box-shadow:0 0 8px var(--_c);animation:pcgp-blink .7s infinite alternate;}
.pcgp-title{font-size:20px;font-weight:900;letter-spacing:-.03em;line-height:1.25;color:#fff;}
.pcgp-body{font-size:13.5px;font-weight:600;color:#c9d3e3;line-height:1.4;}
.pcgp-btns{display:flex;gap:8px;margin-top:6px;}
.pcgp-btn{appearance:none;-webkit-appearance:none;flex:1;margin:0;min-height:48px;border-radius:13px;border:1.5px solid rgba(255,255,255,.22);
  background:rgba(255,255,255,.05);color:#f3f4f7;font:800 18px/1 var(--_sans);cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s;}
.pcgp-btn:active{transform:scale(.97);}
.pcgp-btn.yes{background:var(--_c);border-color:var(--_c);color:#0b0f17;}
.pcgp-foot{font-size:11.5px;font-weight:600;color:#9aa8bf;}
.pcgp-note{display:flex;align-items:center;justify-content:center;gap:6px;min-height:18px;font-size:12.5px;font-weight:700;color:#9aa8bf;text-align:center;}
.pcgp-note b{font-family:Anton,Impact,sans-serif;font-weight:400;padding:1px 7px;border-radius:999px;background:var(--pc,#fff);color:#0b0f17;}
.pcgp-note svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;}
.pcgp.locked .pcgp-pill{opacity:.42;pointer-events:none;}
.pcgp.locked .pcgp-pill.on{opacity:.75;}
.pcgp.compact{gap:7px;}
.pcgp.compact .pcgp-pill{min-height:36px;font-size:14px;}
.pcgp.compact .pcgp-hint{display:none;}
.pcgp.compact .pcgp-title{font-size:19px;}
.pcgp-blocked{opacity:.42 !important;filter:saturate(.4);}
.pcgp-readyhint{margin:6px 0 0;font-size:13px;font-weight:700;color:#ffcf8a;text-align:center;font-family:var(--_sans,"Pretendard Variable",Pretendard,system-ui,sans-serif);}
.pcgp-readyhint[hidden]{display:none;}
@keyframes pcgp-in{from{opacity:0;transform:translateY(8px) scale(.98);}}
@keyframes pcgp-pend{from{opacity:1;}to{opacity:.55;}}
@keyframes pcgp-blink{to{opacity:.25;}}
@keyframes pcgp-shake{0%,100%{transform:none;}20%{transform:translateX(-8px);}40%{transform:translateX(7px);}60%{transform:translateX(-5px);}80%{transform:translateX(3px);}}
`;
function injectCss() {
  if (document.getElementById('pcg-phone-settings-css')) return;
  const s = document.createElement('style');
  s.id = 'pcg-phone-settings-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}
const LOCK_SVG = '<svg viewBox="0 0 16 16"><rect x="3" y="7" width="10" height="7" rx="2"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>';
const CSS_ESCAPE = (s) => (window.CSS && window.CSS.escape ? window.CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
const COLORS = { 1: '#ff5a5f', 2: '#3ab4ff', 3: '#ffc93c', 4: '#5ee07a', 5: '#c77dff', 6: '#ff8fd1', 7: '#3ee6d6', 8: '#ff9b3d' };

/**
 * 폰 설정 만들기.
 * opts: { socket?, send?(event, data), slot?, onChange?(values, info), compact? }
 */
export function createPhoneSettings(opts = {}) {
  let socket = opts.socket || null;
  let slot = opts.slot != null ? Number(opts.slot) : null;
  let st = null; // 마지막으로 받은 큰 화면 상태(fields 포함)
  let fieldsCache = null; // lite 상태가 와도 그릴 수 있게 마지막 fields 를 기억
  const pending = new Map(); // key -> { value, at, timer }
  const subs = new Set();
  if (typeof opts.onChange === 'function') subs.add(opts.onChange);
  const mounts = new Set();
  const readyBtns = new Set();
  let lastSeenChange = 0;
  let seenFirst = false;
  let noteTimer = null;
  let noteMsg = null; // { html, until }

  const fieldsList = () => (fieldsCache || []);
  const field = (key) => fieldsList().find((f) => f.key === key) || null;
  const optOf = (f, v) => (f ? f.options.find((o) => same(o.value, v)) || null : null);

  function serverValue(key) {
    if (!st || !st.values) return undefined;
    const f = field(key);
    const v = st.values[key];
    if (f && f.perPlayer && v && typeof v === 'object') {
      if (slot != null && v[String(slot)] !== undefined) return v[String(slot)];
      return v['*'];
    }
    return v;
  }
  function get(key) {
    if (pending.has(key)) return pending.get(key).value;
    return serverValue(key);
  }
  const unanswered = () => fieldsList().filter((f) => f.type === 'ask' && get(f.key) === undefined).map((f) => f.key);

  function send(data) {
    if (typeof opts.send === 'function') { opts.send('settings', data); return; }
    if (socket && socket.connected) socket.emit('c2d', { event: 'settings', data });
  }

  /** 항목 값을 고릅니다(누르면 이걸 부름). 잠겨 있거나 같은 값이면 무시. */
  function choose(key, value) {
    const f = field(key);
    if (!f || (st && st.locked)) return false;
    const o = optOf(f, value);
    if (!o) return false;
    if (same(get(key), o.value) && !pending.has(key)) return false;
    const prev = pending.get(key);
    if (prev) clearTimeout(prev.timer);
    const p = { value: o.value, at: Date.now() };
    p.timer = setTimeout(() => {
      if (pending.get(key) === p) {
        pending.delete(key);
        setNote('큰 화면이 답하지 않아요. 다시 눌러 주세요', 2600);
        changed({ reverted: key });
      }
    }, PENDING_MS);
    pending.set(key, p);
    send({ [key]: o.value });
    try { haptics.tick({ noFlash: true }); } catch (e) {}
    changed({ chose: key });
    return true;
  }

  /** 큰 화면 상태 받기(game_state.settings 또는 msg 의 settings). 오래된 것은 버립니다. */
  function update(s) {
    if (!s || typeof s !== 'object' || !s.values) return;
    if (st && s.sid === st.sid && Number(s.rev) < Number(st.rev)) return;
    if (st && s.sid !== st.sid) seenFirst = false;
    st = s;
    if (Array.isArray(s.fields)) fieldsCache = s.fields;
    // 화면이 확인한 값이면 '보내는 중'을 풉니다.
    for (const [k, p] of [...pending]) {
      if (same(serverValue(k), p.value) || st.locked) {
        clearTimeout(p.timer);
        pending.delete(k);
      }
    }
    // 다른 사람이 바꿨으면 짧게 알려 줍니다.
    // 처음 받은 상태의 '마지막 변경'은 이미 지난 일이라 알리지 않습니다. 시계는 기기마다 달라 at 끼리만 비교합니다.
    const lc = s.last;
    const at = lc && lc.at ? Number(lc.at) : 0;
    if (!seenFirst) {
      seenFirst = true;
      lastSeenChange = at;
    } else if (at > lastSeenChange) {
      lastSeenChange = at;
      if (!(slot != null && Number(lc.by) === slot)) announce(lc);
    }
    changed({ update: true });
  }

  function announce(lc) {
    const f = field(lc.key);
    if (!f) return;
    const o = optOf(f, lc.value);
    if (!o) return;
    const by = Number(lc.by);
    const who = by ? `<b style="--pc:${COLORS[by] || '#fff'}">${by}P</b>가` : '큰 화면에서';
    let text;
    if (o.said) text = `${esc(f.label)}${eul(f.label)} ${esc(o.said)}`;
    else text = `${esc(f.label)}${eul(f.label)} ${esc(o.label)}${euro(o.label)} 바꿨어요`;
    if (f.perPlayer && by) return; // 각자 고르는 값은 남의 것을 알릴 필요가 없습니다
    setNote(`${who} ${text}`, 2800);
  }

  function setNote(html, ms) {
    noteMsg = { html, until: Date.now() + ms };
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { noteMsg = null; paintAll(); }, ms);
    paintAll();
  }

  function changed(info) {
    paintAll(info);
    paintReady();
    const vals = {};
    for (const f of fieldsList()) vals[f.key] = get(f.key);
    for (const fn of subs) {
      try { fn(vals, info || {}); } catch (e) { console.error('[phone-settings onChange]', e); }
    }
  }

  // ---------- 그리기 ----------
  function mount(el, mo = {}) {
    injectCss();
    const root = document.createElement('div');
    root.className = 'pcgp' + (mo.compact || opts.compact ? ' compact' : '');
    root.hidden = true;
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-key][data-i]');
      if (!b || !root.contains(b)) return;
      const f = field(b.dataset.key);
      if (f) choose(f.key, f.options[Number(b.dataset.i)].value);
    });
    const parts = { root, sig: '' };
    mounts.add(parts);
    paint(parts);
    if (el) el.appendChild(root);
    return root;
  }

  function structure(parts) {
    const list = fieldsList();
    const sig = JSON.stringify(list.map((f) => [f.key, f.type, f.perPlayer, f.options.map((o) => [o.value, o.label])]));
    if (sig === parts.sig) return;
    parts.sig = sig;
    const lv = (o) => (o.level ? `<i class="pcgp-lv">${[1, 2, 3].map((n) => `<b class="${n <= o.level ? 'f' : ''}"></b>`).join('')}</i>` : '');
    let html = '';
    for (const f of list) {
      if (f.type === 'ask' && f.ask) {
        html += `<div class="pcgp-ask" data-ask="${esc(f.key)}"><div class="pcgp-eyebrow"><i></i>모두에게 물어봐요</div>` +
          `<div class="pcgp-title">${esc(f.ask.title)}</div>${f.ask.body ? `<div class="pcgp-body">${esc(f.ask.body)}</div>` : ''}` +
          `<div class="pcgp-btns">${f.options.map((o, i) => `<button type="button" class="pcgp-btn${i === 0 ? ' yes' : ''}" data-key="${esc(f.key)}" data-i="${i}">${esc(o.label)}</button>`).join('')}</div>` +
          `<div class="pcgp-foot">누가 고르든 모두에게 적용돼요</div></div>`;
      }
    }
    for (const f of list) {
      html += `<div class="pcgp-row" data-row="${esc(f.key)}"><span class="pcgp-label">${esc(f.label)}${f.perPlayer ? '<small>나만</small>' : ''}</span>` +
        `<div class="pcgp-seg" role="radiogroup" aria-label="${esc(f.label)}">${f.options.map((o, i) => `<button type="button" class="pcgp-pill" role="radio" data-key="${esc(f.key)}" data-i="${i}"${o.tone ? ` style="--tone:${esc(o.tone)}"` : ''}>${esc(f.type === 'ask' && o.short ? o.short : o.label)}${lv(o)}</button>`).join('')}</div>` +
        `<span class="pcgp-hint"></span></div>`;
    }
    html += '<div class="pcgp-note" hidden></div>';
    parts.root.innerHTML = html;
  }

  function paint(parts) {
    const list = fieldsList();
    parts.root.hidden = !list.length;
    if (!list.length) return;
    structure(parts);
    const { root } = parts;
    const locked = Boolean(st && st.locked);
    root.classList.toggle('locked', locked);
    for (const f of list) {
      const v = get(f.key);
      const unans = f.type === 'ask' && v === undefined;
      const card = root.querySelector(`[data-ask="${CSS_ESCAPE(f.key)}"]`);
      if (card) card.hidden = !unans;
      const row = root.querySelector(`[data-row="${CSS_ESCAPE(f.key)}"]`);
      if (!row) continue;
      row.hidden = unans;
      const isPending = pending.has(f.key);
      row.querySelectorAll('.pcgp-pill').forEach((b) => {
        const on = same(f.options[Number(b.dataset.i)].value, v);
        b.classList.toggle('on', on);
        b.classList.toggle('pending', on && isPending);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      const o = optOf(f, v);
      row.querySelector('.pcgp-hint').textContent = o && o.hint ? o.hint : '';
    }
    const note = root.querySelector('.pcgp-note');
    if (note) {
      if (noteMsg && noteMsg.until > Date.now()) { note.innerHTML = noteMsg.html; note.hidden = false; }
      else if (locked) { note.innerHTML = `${LOCK_SVG}경기 중에는 바꿀 수 없어요`; note.hidden = false; }
      else { note.innerHTML = ''; note.hidden = true; }
    }
  }
  function paintAll() { for (const p of mounts) paint(p); }

  // ---------- 준비 버튼 막기 ----------
  function paintReady() {
    const left = unanswered();
    const blocked = left.length > 0;
    for (const r of readyBtns) {
      r.btn.classList.toggle('pcgp-blocked', blocked);
      r.btn.setAttribute('aria-disabled', blocked ? 'true' : 'false');
      if (r.hint) {
        const f = field(left[0]);
        r.hint.textContent = blocked ? (r.text || `${f ? f.label : '설정'}${f ? eul(f.label) : '을'} 먼저 골라 주세요`) : '';
        r.hint.hidden = !blocked;
      }
    }
  }
  function nudge() {
    for (const p of mounts) {
      for (const card of p.root.querySelectorAll('.pcgp-ask:not([hidden])')) {
        card.classList.remove('shake');
        void card.offsetWidth;
        card.classList.add('shake');
        setTimeout(() => card.classList.remove('shake'), 520);
        try { card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
      }
    }
    try { haptics.play('warn', 0.6); } catch (e) {}
  }
  // 버튼을 disabled 로 만들지 않고, 누르면 질문 카드를 흔들어 무엇을 해야 하는지 알려 줍니다.
  const guard = (e) => {
    if (!readyBtns.size || !unanswered().length) return;
    for (const r of readyBtns) {
      if (r.btn.contains(e.target)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        nudge();
        return;
      }
    }
  };
  let guardOn = false;

  /** 준비(게임 시작) 버튼을 질문에 답할 때까지 막습니다. opts.hint = false 면 안내 글을 붙이지 않습니다. */
  function bindReady(btn, bo = {}) {
    if (!btn) return () => {};
    injectCss();
    if (!guardOn) {
      document.addEventListener('click', guard, true);
      guardOn = true;
    }
    let hint = null;
    if (bo.hint !== false) {
      hint = document.createElement('div');
      hint.className = 'pcgp-readyhint';
      hint.hidden = true;
      btn.insertAdjacentElement('afterend', hint);
    }
    const r = { btn, hint, text: typeof bo.hint === 'string' ? bo.hint : null };
    readyBtns.add(r);
    paintReady();
    return () => {
      readyBtns.delete(r);
      btn.classList.remove('pcgp-blocked');
      btn.removeAttribute('aria-disabled');
      if (hint) hint.remove();
    };
  }

  /** game_state·msg·assigned 를 듣습니다. 반환: 듣기를 끄는 함수. */
  function attach(sock) {
    socket = sock;
    const onState = (s) => { if (s && s.settings) update(s.settings); };
    const onMsg = (m) => { if (m && m.type === 'pcg-settings' && m.settings) update(m.settings); };
    const onAssigned = (p) => { if (p && p.slot != null) { slot = Number(p.slot); changed({ slot: true }); } };
    sock.on('game_state', onState);
    sock.on('msg', onMsg);
    sock.on('assigned', onAssigned);
    return () => {
      sock.off('game_state', onState);
      sock.off('msg', onMsg);
      sock.off('assigned', onAssigned);
    };
  }

  const api = {
    attach,
    update,
    mount,
    choose,
    bindReady,
    get,
    /** 아직 안 정한 질문이 없으면 true(설정 정보를 아직 못 받았어도 true) */
    isAnswered: () => unanswered().length === 0,
    unanswered,
    isLocked: () => Boolean(st && st.locked),
    pick: (table) => {
      const lv = get('difficulty') || DIFF_FALLBACK;
      return lv in table ? table[lv] : 'normal' in table ? table.normal : table.hard;
    },
    difficulty: () => get('difficulty') || DIFF_FALLBACK,
    setSlot(s) { slot = s != null ? Number(s) : null; changed({ slot: true }); },
    onChange(fn) { subs.add(fn); return () => subs.delete(fn); },
    nudge,
    get state() { return st; },
    get values() { const v = {}; for (const f of fieldsList()) v[f.key] = get(f.key); return v; },
    destroy() {
      for (const p of mounts) p.root.remove();
      mounts.clear();
      if (guardOn) document.removeEventListener('click', guard, true);
      guardOn = false;
      readyBtns.clear();
      subs.clear();
    }
  };
  window.PCG = window.PCG || {};
  window.PCG.phoneSettings = api;
  return api;
}

export default createPhoneSettings;
