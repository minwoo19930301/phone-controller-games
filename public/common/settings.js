// 난이도·종목 옵션 공통 모듈 (큰 화면 쪽).
//
// 큰 화면이 값을 가지고(종목마다 localStorage 'pcg-settings-<game>' 에 기억), 대기실에 알약 버튼과 질문 카드를 그리고,
// 폰이 보내는 c2d settings 를 받아 바꾸고, game_state.settings 로 폰들에 알립니다. 경기 중에는 잠급니다.
//
//   const settings = createSettings({ game: 'pingpong', fields: [fields.difficulty(), fields.slow()], onChange: pushState });
//   settings.attach(socket);                 // 폰의 settings 받기 + 바뀌면 폰들에 바로 알림
//   settings.mount($('settingsBox'));        // 대기실 UI(알약·질문 카드). 키보드 D 는 난이도 순환
//   send('game_state', { phase, players, settings: settings.forState() });
//   settings.lock(phase === 'playing');
//   const win = settings.pick({ easy: 0.30, normal: 0.20, hard: 0.12 });
//
// 주소로 시험: ?difficulty=easy, ?slow=on (저장하지 않음), ?settings=reset (이 화면에 기억한 값 지우기)

export const DIFFICULTIES = ['easy', 'normal', 'hard'];
export const DIFF_LABEL = { easy: '쉬움', normal: '보통', hard: '어려움' };
export const PLAYER_COLORS = { 1: '#ff5a5f', 2: '#3ab4ff', 3: '#ffc93c', 4: '#5ee07a', 5: '#c77dff', 6: '#ff8fd1', 7: '#3ee6d6', 8: '#ff9b3d' };

/** 난이도별 값 고르기. table = { easy, normal, hard }. 없는 칸은 normal → hard 순으로 채웁니다. */
export function byDifficulty(level, table) {
  if (!table) return undefined;
  if (level in table) return table[level];
  return 'normal' in table ? table.normal : table.hard;
}

/** 자주 쓰는 항목 만들기 */
export const fields = {
  /** 난이도 3단계. hints 로 설명을 바꿀 수 있습니다: fields.difficulty({ hints: { easy: '타이밍 ±0.3초' } }) */
  difficulty(o = {}) {
    const hints = { easy: '아주 넉넉하게 봐줘요', normal: '적당히 봐줘요', hard: '봐주는 것 없이', ...(o.hints || {}) };
    const { hints: _h, ...rest } = o;
    return {
      key: 'difficulty', label: '난이도', type: 'pills', default: 'normal', hotkey: 'd',
      options: [
        { value: 'easy', label: '쉬움', hint: hints.easy, tone: '#5ee07a', level: 1 },
        { value: 'normal', label: '보통', hint: hints.normal, tone: '#8fd8ff', level: 2 },
        { value: 'hard', label: '어려움', hint: hints.hard, tone: '#ff7a59', level: 3 }
      ],
      ...rest
    };
  },
  /** 슬로우 모드: 처음엔 비어 있고, 누가 답하기 전까지 질문 카드가 뜹니다(준비 막힘). */
  slow(o = {}) {
    return {
      key: 'slow', label: '슬로우 모드', type: 'ask', hotkey: 'l',
      options: [
        { value: true, label: '켜기', short: '켜짐', said: '켰어요' },
        { value: false, label: '끄기', short: '꺼짐', said: '껐어요' }
      ],
      ask: { title: '슬로우 모드 켤까요?', body: '치기 직전에 느려져서 타이밍 맞추기 쉬워요' },
      ...o
    };
  },
  /** 켜기/끄기 두 칸. o.ask = true 면 slow 처럼 먼저 물어봅니다. */
  toggle(key, label, o = {}) {
    const on = o.on || '켜기';
    const off = o.off || '끄기';
    const { on: _a, off: _b, ask, ...rest } = o;
    return {
      key, label, type: ask ? 'ask' : 'pills', default: ask ? undefined : (o.default ?? true),
      options: [{ value: true, label: on, short: o.onShort || on }, { value: false, label: off, short: o.offShort || off }],
      ask: typeof ask === 'object' ? ask : ask ? { title: `${label} 켤까요?`, body: '' } : undefined,
      ...rest
    };
  },
  /** 여러 칸 중 하나. options: ['a','b'] 또는 [{ value, label, hint }] */
  choice(key, label, options, o = {}) {
    return { key, label, type: 'pills', options: options.map((x) => (typeof x === 'object' ? x : { value: x, label: String(x) })), default: o.default ?? (typeof options[0] === 'object' ? options[0].value : options[0]), ...o };
  }
};

// ---------- 내부 도구 ----------
const params = new URLSearchParams(location.search);
const hasBatchim = (word) => {
  const ch = String(word || '').trim().slice(-1);
  const c = ch.charCodeAt(0);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 !== 0;
  return /[0-9lmnLMN]$/.test(ch); // 영문·숫자는 대충
};
const rieul = (word) => {
  const c = String(word || '').trim().slice(-1).charCodeAt(0);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 === 8;
};
export const josa = {
  eul: (w) => (hasBatchim(w) ? '을' : '를'),
  euro: (w) => (hasBatchim(w) && !rieul(w) ? '으로' : '로')
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function normalizeField(f) {
  if (!f || !f.key || !Array.isArray(f.options) || !f.options.length) throw new Error('settings: 항목에는 key 와 options 가 필요합니다');
  const type = f.type === 'ask' ? 'ask' : 'pills';
  const options = f.options.map((o) => (typeof o === 'object' ? { ...o } : { value: o, label: String(o) }));
  let hotkey = f.hotkey || null;
  if (hotkey && hotkey.length === 1) hotkey = 'Key' + hotkey.toUpperCase();
  return { ...f, type, options, hotkey, perPlayer: Boolean(f.perPlayer) && type === 'pills', default: type === 'ask' ? undefined : f.default ?? options[0].value };
}

/** 받은 값을 그 항목의 보기 값으로 맞춥니다(문자열 'true' → true 등). 맞는 보기가 없으면 undefined. */
function canon(f, v) {
  if (v === undefined || v === null) return undefined;
  for (const o of f.options) if (o.value === v) return o.value;
  for (const o of f.options) if (String(o.value) === String(v)) return o.value;
  if (typeof v === 'string') {
    const t = v.toLowerCase();
    const bool = ['on', 'yes', '1', 'true'].includes(t) ? true : ['off', 'no', '0', 'false'].includes(t) ? false : null;
    if (bool !== null) for (const o of f.options) if (o.value === bool) return o.value;
  }
  return undefined;
}
const optOf = (f, v) => f.options.find((o) => o.value === v) || null;

const CSS = `
.pcgs-panel{--_a:var(--pcgs-accent,var(--accent,#8fd8ff));--_sans:"Pretendard Variable",Pretendard,-apple-system,"Apple SD Gothic Neo",system-ui,sans-serif;
  display:flex;flex-direction:column;gap:10px;margin:0;padding:14px 16px;border-radius:18px;box-sizing:border-box;text-align:left;
  background:rgba(8,13,28,.72);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.14);
  box-shadow:0 10px 34px rgba(0,0,0,.28);color:#f5f4ee;font-family:var(--_sans);font-size:15px;line-height:1.35;white-space:normal;}
.pcgs-panel *{box-sizing:border-box;}
.pcgs-panel kbd{font-family:var(--_sans);font-size:11px;font-weight:800;line-height:1;padding:3px 6px;margin-left:7px;border-radius:6px;vertical-align:1px;
  background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-bottom-width:2px;color:#f5f4ee;}
.pcgs-row{display:flex;align-items:center;gap:14px;min-height:44px;margin:0;}
.pcgs-label{flex:none;width:118px;font-weight:800;font-size:15px;color:#f5f4ee;white-space:nowrap;}
.pcgs-seg{flex:none;display:inline-flex;gap:4px;padding:4px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);}
.pcgs-pill{appearance:none;-webkit-appearance:none;border:0;margin:0;display:inline-flex;align-items:center;gap:7px;padding:8px 16px;border-radius:999px;
  background:transparent;color:#cdd6e4;font:800 15px/1.1 var(--_sans);letter-spacing:-.01em;cursor:pointer;white-space:nowrap;
  transition:background .22s,color .22s,box-shadow .22s,transform .22s;}
.pcgs-pill:hover{background:rgba(255,255,255,.08);}
.pcgs-pill.on{background:var(--tone,var(--_a));color:#0b1220;box-shadow:0 4px 18px color-mix(in srgb,var(--tone,var(--_a)) 45%,transparent);}
.pcgs-pill.bump{animation:pcgs-bump .5s cubic-bezier(.2,1.6,.4,1);}
.pcgs-lv{display:inline-flex;gap:3px;}
.pcgs-lv b{display:block;width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.25;}
.pcgs-lv b.f{opacity:.95;}
.pcgs-hint{flex:1;min-width:0;font-size:13px;font-weight:600;color:#aab6cc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pcgs-chips{display:flex;flex-wrap:wrap;gap:6px;margin:-2px 0 0 132px;}
.pcgs-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px 4px 4px;border-radius:999px;background:rgba(255,255,255,.06);
  border:1px solid rgba(255,255,255,.1);font-size:13px;font-weight:700;color:#e6ecf4;}
.pcgs-chip b{font-family:Anton,Impact,sans-serif;font-weight:400;font-size:13px;padding:2px 8px;border-radius:999px;background:var(--pc);color:#0b1220;letter-spacing:.02em;}
.pcgs-ask{position:relative;display:flex;flex-direction:column;gap:6px;padding:16px 18px 14px;border-radius:16px;
  background:linear-gradient(135deg,color-mix(in srgb,var(--_a) 22%,rgba(10,16,32,.92)),rgba(10,16,32,.92) 70%);
  border:1.5px solid var(--_a);animation:pcgs-glow 1.9s ease-in-out infinite;}
.pcgs-ask[hidden],.pcgs-row[hidden],.pcgs-chips[hidden],.pcgs-foot[hidden]{display:none;}
.pcgs-ask-eyebrow{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:800;letter-spacing:.16em;color:var(--_a);}
.pcgs-ask-eyebrow i{width:8px;height:8px;border-radius:50%;background:var(--_a);box-shadow:0 0 10px var(--_a);animation:pcgs-blink .7s infinite alternate;}
.pcgs-ask-title{font-size:26px;font-weight:900;letter-spacing:-.03em;line-height:1.2;color:#fff;}
.pcgs-ask-body{font-size:15px;font-weight:600;color:#d6deea;}
.pcgs-ask-row{display:flex;align-items:center;gap:10px;margin-top:6px;flex-wrap:wrap;}
.pcgs-ask-btn{appearance:none;-webkit-appearance:none;margin:0;padding:10px 24px;border-radius:999px;border:1.5px solid rgba(255,255,255,.28);background:transparent;
  color:#f5f4ee;font:800 16px/1.1 var(--_sans);cursor:pointer;transition:transform .15s,background .2s;}
.pcgs-ask-btn:hover{transform:translateY(-1px);background:rgba(255,255,255,.08);}
.pcgs-ask-btn.yes{background:var(--_a);border-color:var(--_a);color:#0b1220;}
.pcgs-ask-foot{margin-left:auto;font-size:13px;font-weight:700;color:#aab6cc;}
.pcgs-ask.shake{animation:pcgs-shake .5s;}
.pcgs-foot{display:flex;align-items:center;gap:10px;min-height:22px;font-size:13px;font-weight:700;color:#aab6cc;}
.pcgs-lock{display:none;align-items:center;gap:6px;}
.pcgs-lock svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;}
.pcgs-panel.locked .pcgs-lock{display:inline-flex;}
.pcgs-panel.locked .pcgs-pill,.pcgs-panel.locked .pcgs-ask-btn{opacity:.45;cursor:default;pointer-events:none;}
.pcgs-toast{display:inline-flex;align-items:center;gap:7px;color:#f5f4ee;opacity:0;transform:translateY(4px);transition:opacity .25s,transform .3s;}
.pcgs-toast.on{opacity:1;transform:none;}
.pcgs-toast b{font-family:Anton,Impact,sans-serif;font-weight:400;padding:1px 8px;border-radius:999px;background:var(--pc,#fff);color:#0b1220;letter-spacing:.02em;}
.pcgs-panel.compact{gap:6px;padding:10px 12px;}
.pcgs-panel.compact .pcgs-hint{display:none;}
.pcgs-panel.compact .pcgs-label{width:auto;min-width:72px;}
.pcgs-panel.compact .pcgs-ask-title{font-size:20px;}
@keyframes pcgs-glow{0%,100%{box-shadow:0 0 0 0 transparent;}50%{box-shadow:0 0 0 5px color-mix(in srgb,var(--_a) 20%,transparent),0 12px 40px color-mix(in srgb,var(--_a) 22%,transparent);}}
@keyframes pcgs-blink{to{opacity:.25;}}
@keyframes pcgs-bump{0%{transform:scale(1.18);}100%{transform:none;}}
@keyframes pcgs-shake{0%,100%{transform:none;}20%{transform:translateX(-8px);}40%{transform:translateX(7px);}60%{transform:translateX(-5px);}80%{transform:translateX(3px);}}
`;
function injectCss() {
  if (document.getElementById('pcg-settings-css')) return;
  const s = document.createElement('style');
  s.id = 'pcg-settings-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}
const LOCK_SVG = '<svg viewBox="0 0 16 16"><rect x="3" y="7" width="10" height="7" rx="2"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>';

/**
 * 큰 화면 설정 만들기.
 * opts: { game, fields, onChange(values, change), keys = true, persist = true, players }
 */
export function createSettings(opts = {}) {
  const game = String(opts.game || 'game');
  const schema = (opts.fields || opts.schema || [fields.difficulty()]).map(normalizeField);
  const byKey = new Map(schema.map((f) => [f.key, f]));
  const STORE = `pcg-settings-${game}`;
  const persist = opts.persist !== false;
  const sid = Math.random().toString(36).slice(2, 8); // 이 화면(페이지) 구분. 폰은 같은 sid 의 rev 가 커질 때만 받아들입니다.
  let rev = 1;
  let locked = false;
  let last = null; // { key, value, by, at }
  let players = Array.isArray(opts.players) ? opts.players : [];
  let socket = null;
  const subs = new Set();
  if (typeof opts.onChange === 'function') subs.add(opts.onChange);
  const mounts = new Set();

  // ---------- 불러오기 ----------
  if (params.get('settings') === 'reset') { try { localStorage.removeItem(STORE); } catch (e) {} }
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { saved = {}; }
  const values = {};
  for (const f of schema) {
    let v = canon(f, saved[f.key]);
    if (v === undefined) v = f.default;
    const fromUrl = canon(f, params.get(f.key));
    if (fromUrl !== undefined) v = fromUrl;
    values[f.key] = f.perPlayer ? { '*': v } : v;
  }

  function save() {
    if (!persist) return;
    const out = {};
    for (const f of schema) {
      const v = f.perPlayer ? values[f.key]['*'] : values[f.key];
      if (v !== undefined) out[f.key] = v;
    }
    try { localStorage.setItem(STORE, JSON.stringify(out)); } catch (e) {}
  }

  function get(key, slot) {
    const f = byKey.get(key);
    if (!f) return undefined;
    const v = values[key];
    if (!f.perPlayer) return v;
    if (slot != null && v[String(slot)] !== undefined) return v[String(slot)];
    return v['*'];
  }

  function emit(change) {
    rev += 1;
    if (change) last = { ...change, at: Date.now() };
    save();
    refreshAll(change);
    broadcast();
    const snapshot = snapshotValues();
    for (const fn of subs) {
      try { fn(snapshot, change || null); } catch (e) { console.error('[settings onChange]', e); }
    }
  }

  function snapshotValues() {
    const out = {};
    for (const f of schema) out[f.key] = f.perPlayer ? { ...values[f.key] } : values[f.key];
    return out;
  }

  /** 값 바꾸기. by: 'display' 또는 자리 번호. 바뀌었으면 true. */
  function set(key, value, by = 'display') {
    const f = byKey.get(key);
    if (!f || locked) return false;
    const v = canon(f, value);
    if (v === undefined) return false;
    if (f.perPlayer) {
      const cur = values[key];
      if (typeof by === 'number' || /^\d+$/.test(String(by))) {
        if (cur[String(by)] === v) return false;
        cur[String(by)] = v;
      } else {
        // 큰 화면에서 바꾸면 모두에게 적용합니다.
        const had = Object.keys(cur).length > 1;
        if (cur['*'] === v && !had) return false;
        values[key] = { '*': v };
      }
    } else {
      if (values[key] === v) return false;
      values[key] = v;
    }
    emit({ key, value: v, by });
    return true;
  }

  function cycle(key, dir = 1) {
    const f = byKey.get(key);
    if (!f || locked) return false;
    const cur = f.perPlayer ? values[key]['*'] : values[key];
    const i = f.options.findIndex((o) => o.value === cur);
    const n = f.options.length;
    const next = i < 0 ? f.options[dir > 0 ? 0 : n - 1] : f.options[(i + dir + n) % n];
    return set(key, next.value, 'display');
  }

  /** 폰이 보낸 c2d settings 처리. data = { <key>: value, ..., slot } */
  function handle(data) {
    if (!data || typeof data !== 'object' || locked) return [];
    const slot = Number(data.slot) || null;
    const done = [];
    for (const [k, v] of Object.entries(data)) {
      if (k === 'slot' || !byKey.has(k)) continue;
      if (set(k, v, slot || 'phone')) done.push(k);
    }
    return done;
  }

  const unanswered = () => schema.filter((f) => f.type === 'ask' && values[f.key] === undefined).map((f) => f.key);

  function forState(o = {}) {
    const st = { v: 1, sid, rev, locked, values: snapshotValues(), answered: unanswered().length === 0, last };
    if (!o.lite) {
      st.fields = schema.map((f) => ({
        key: f.key, label: f.label || f.key, type: f.type, perPlayer: f.perPlayer || undefined,
        options: f.options.map((x) => ({ value: x.value, label: x.label, short: x.short, hint: x.hint, tone: x.tone, level: x.level, said: x.said })),
        ask: f.ask || undefined
      }));
    }
    return JSON.parse(JSON.stringify(st));
  }

  // ---------- 소켓 ----------
  let bcTimer = null;
  function broadcast() {
    if (!socket || !socket.connected) return;
    socket.emit('d2c', { event: 'msg', data: { type: 'pcg-settings', settings: forState() } });
  }
  function attach(sock) {
    socket = sock;
    const onSettings = (d) => handle(d);
    // 새 폰이 들어오면 최신 값을 한 번 더 알려 줍니다(종목이 game_state 를 늦게 보내도 폰이 바로 그리도록).
    const onPlayers = (p) => {
      if (p && Array.isArray(p.players)) setPlayers(p.players);
      clearTimeout(bcTimer);
      bcTimer = setTimeout(broadcast, 120);
    };
    sock.on('settings', onSettings);
    sock.on('players', onPlayers);
    sock.on('room', onPlayers); // 화면이 방을 받을 때(새로고침 포함) 들어와 있는 사람 목록이 여기 옵니다
    sock.on('connect', onPlayers);
    return () => {
      sock.off('settings', onSettings);
      sock.off('players', onPlayers);
      sock.off('room', onPlayers);
      sock.off('connect', onPlayers);
      if (socket === sock) socket = null;
    };
  }

  function setPlayers(list) {
    players = Array.isArray(list) ? list.filter((p) => p && p.slot != null) : [];
    // 나간 사람의 각자 값은 지웁니다.
    for (const f of schema) {
      if (!f.perPlayer) continue;
      for (const k of Object.keys(values[f.key])) if (k !== '*' && !players.some((p) => String(p.slot) === k)) delete values[f.key][k];
    }
    refreshAll();
  }

  function lock(on = true) {
    on = Boolean(on);
    if (locked === on) return;
    locked = on;
    rev += 1;
    refreshAll();
    broadcast();
  }

  // ---------- 키보드 ----------
  const onKey = (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const f = schema.find((x) => x.hotkey && x.hotkey === e.code);
    if (!f) return;
    if (locked) { flashLock(); return; }
    if (f.type === 'ask' && values[f.key] === undefined) set(f.key, f.options[0].value, 'display');
    else cycle(f.key, e.shiftKey ? -1 : 1);
  };
  if (opts.keys !== false) window.addEventListener('keydown', onKey);

  // ---------- 대기실 UI ----------
  function mount(el, mo = {}) {
    injectCss();
    const root = document.createElement('div');
    root.className = 'pcgs-panel' + (mo.compact ? ' compact' : '');
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', '게임 설정');
    const parts = { root, rows: new Map(), asks: new Map(), toastTimer: null };
    for (const f of schema) {
      if (f.type === 'ask' && f.ask) {
        const card = document.createElement('div');
        card.className = 'pcgs-ask';
        card.dataset.key = f.key;
        const kbd = f.hotkey ? `<kbd>${esc(f.hotkey.replace(/^Key/, ''))}</kbd>` : '';
        card.innerHTML = `<div class="pcgs-ask-eyebrow"><i></i>시작 전에 정해 주세요</div>` +
          `<div class="pcgs-ask-title">${esc(f.ask.title)}</div>` + (f.ask.body ? `<div class="pcgs-ask-body">${esc(f.ask.body)}</div>` : '') +
          `<div class="pcgs-ask-row">${f.options.map((o, i) => `<button type="button" class="pcgs-ask-btn${i === 0 ? ' yes' : ''}" data-i="${i}">${esc(o.label)}</button>`).join('')}` +
          `<span class="pcgs-ask-foot">폰에서 아무나 골라도 돼요${kbd}</span></div>`;
        card.addEventListener('click', (e) => {
          const b = e.target.closest('.pcgs-ask-btn');
          if (b) set(f.key, f.options[Number(b.dataset.i)].value, 'display');
        });
        root.appendChild(card);
        parts.asks.set(f.key, card);
      }
    }
    for (const f of schema) {
      const row = document.createElement('div');
      row.className = 'pcgs-row';
      row.dataset.key = f.key;
      const kbd = f.hotkey ? `<kbd>${esc(f.hotkey.replace(/^Key/, ''))}</kbd>` : '';
      const lv = (o) => (o.level ? `<i class="pcgs-lv">${[1, 2, 3].map((n) => `<b class="${n <= o.level ? 'f' : ''}"></b>`).join('')}</i>` : '');
      row.innerHTML = `<div class="pcgs-label">${esc(f.label || f.key)}${f.perPlayer ? ' · 모두' : ''}${kbd}</div>` +
        `<div class="pcgs-seg" role="radiogroup">${f.options.map((o, i) => `<button type="button" class="pcgs-pill" role="radio" data-i="${i}"${o.tone ? ` style="--tone:${esc(o.tone)}"` : ''}><span>${esc(o.short && f.type === 'ask' ? o.short : o.label)}</span>${lv(o)}</button>`).join('')}</div>` +
        `<div class="pcgs-hint"></div>`;
      row.addEventListener('click', (e) => {
        const b = e.target.closest('.pcgs-pill');
        if (b) set(f.key, f.options[Number(b.dataset.i)].value, 'display');
      });
      root.appendChild(row);
      let chips = null;
      if (f.perPlayer) {
        chips = document.createElement('div');
        chips.className = 'pcgs-chips';
        root.appendChild(chips);
      }
      parts.rows.set(f.key, { row, chips });
    }
    const foot = document.createElement('div');
    foot.className = 'pcgs-foot';
    foot.innerHTML = `<span class="pcgs-lock">${LOCK_SVG}경기 중에는 바꿀 수 없어요</span><span class="pcgs-toast"></span>`;
    root.appendChild(foot);
    parts.foot = foot;
    parts.toast = foot.querySelector('.pcgs-toast');
    mounts.add(parts);
    refresh(parts);
    if (el) el.appendChild(root);
    return root;
  }

  function refresh(parts, change) {
    const { root } = parts;
    root.classList.toggle('locked', locked);
    for (const f of schema) {
      const unans = f.type === 'ask' && values[f.key] === undefined;
      const card = parts.asks.get(f.key);
      if (card) card.hidden = !unans;
      const { row, chips } = parts.rows.get(f.key);
      row.hidden = unans;
      const cur = f.perPlayer ? values[f.key]['*'] : values[f.key];
      row.querySelectorAll('.pcgs-pill').forEach((b) => {
        const on = f.options[Number(b.dataset.i)].value === cur;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        if (on && change && change.key === f.key) {
          b.classList.remove('bump');
          void b.offsetWidth;
          b.classList.add('bump');
        }
      });
      const o = optOf(f, cur);
      row.querySelector('.pcgs-hint').textContent = o && o.hint ? o.hint : '';
      if (chips) {
        const list = players.filter((p) => p.connected !== false);
        chips.hidden = !list.length;
        chips.innerHTML = list.map((p) => {
          const v = get(f.key, p.slot);
          const oo = optOf(f, v);
          const col = p.color || PLAYER_COLORS[p.slot] || '#fff';
          return `<span class="pcgs-chip" style="--pc:${esc(col)}"><b>${esc(p.name || p.slot + 'P')}</b>${esc(oo ? oo.label : '')}</span>`;
        }).join('');
      }
    }
    if (change && change.by !== 'display') showToast(parts, change);
    parts.foot.hidden = !locked && !parts.toast.classList.contains('on');
  }

  function showToast(parts, change) {
    const f = byKey.get(change.key);
    if (!f) return;
    const o = optOf(f, change.value);
    const slot = Number(change.by);
    const p = players.find((x) => x.slot === slot);
    const col = (p && p.color) || PLAYER_COLORS[slot] || '#fff';
    const who = slot ? `<b style="--pc:${esc(col)}">${esc((p && p.name) || slot + 'P')}</b>` : '';
    const val = o ? (f.type === 'ask' ? o.short || o.label : o.label) : '';
    parts.toast.innerHTML = `${who}${esc(f.label || f.key)} → ${esc(val)}${f.perPlayer && slot ? ' (각자)' : ''}`;
    parts.toast.classList.add('on');
    parts.foot.hidden = false;
    clearTimeout(parts.toastTimer);
    parts.toastTimer = setTimeout(() => {
      parts.toast.classList.remove('on');
      parts.foot.hidden = !locked;
    }, 2800);
  }

  function refreshAll(change) {
    for (const p of mounts) refresh(p, change);
  }

  function flashLock() {
    for (const p of mounts) {
      p.foot.hidden = false;
      const l = p.foot.querySelector('.pcgs-lock');
      try { l.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 260 }); } catch (e) {}
    }
  }

  /** 아직 안 정한 질문이 있으면 카드를 흔들고 false. 시작 키(Enter) 처리 앞에 씁니다. */
  function requireAnswered() {
    const left = unanswered();
    if (!left.length) return true;
    for (const p of mounts) {
      for (const k of left) {
        const c = p.asks.get(k);
        if (!c) continue;
        c.classList.remove('shake');
        void c.offsetWidth;
        c.classList.add('shake');
        setTimeout(() => c.classList.remove('shake'), 520);
      }
    }
    return false;
  }

  /** 기억한 값을 지웁니다(key 없으면 전부). 질문 항목은 다시 물어봅니다. */
  function reset(key) {
    for (const f of schema) {
      if (key && f.key !== key) continue;
      const v = f.type === 'ask' ? undefined : f.default;
      values[f.key] = f.perPlayer ? { '*': v } : v;
    }
    emit(null);
  }

  const api = {
    game,
    schema,
    get,
    set,
    cycle,
    handle,
    attach,
    mount,
    lock,
    reset,
    setPlayers,
    forState,
    requireAnswered,
    broadcast,
    /** 질문 항목에 모두 답했는지(준비·시작을 막을 때) */
    isAnswered: () => unanswered().length === 0,
    unanswered,
    isLocked: () => locked,
    /** 난이도별 값: settings.pick({ easy, normal, hard }, slot?) */
    pick: (table, slot) => byDifficulty(get('difficulty', slot) || 'normal', table),
    difficulty: (slot) => get('difficulty', slot) || 'normal',
    get values() { return snapshotValues(); },
    onChange(fn) { subs.add(fn); return () => subs.delete(fn); },
    destroy() {
      window.removeEventListener('keydown', onKey);
      for (const p of mounts) p.root.remove();
      mounts.clear();
      subs.clear();
    }
  };
  window.PCG = window.PCG || {};
  window.PCG.settings = api;
  return api;
}

export default createSettings;
