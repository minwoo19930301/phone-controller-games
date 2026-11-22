// 다국어: 한국어 원문을 열쇠로 쓰는 번역 모듈(ko 원문 · en · ja · zh).
//
// 쓰는 법은 세 가지뿐입니다.
//  1. 사전 등록:   register({ en: { '준비': 'Ready', '준비 {a}/{b}': 'Ready {a}/{b}' }, ja: {...}, zh: {...} })
//  2. 화면 글자:   아무것도 안 해도 됩니다. DOM 에 들어가는 한국어 글자(텍스트·placeholder·title·aria-label·alt)를
//                  사전에서 찾아 자동으로 바꾸고, 나중에 바뀌는 글자도 MutationObserver 로 따라갑니다.
//                  숫자·이름이 섞인 문장은 '{이름}' 자리표시자가 든 열쇠로 등록하면 모양으로 맞춰 번역합니다.
//  3. 그 밖의 글자: 캔버스·three.js 텍스처·document.title 대입처럼 DOM 글자가 아닌 곳은 t('원문', { 값 }) 을 직접 부릅니다.
//
// 언어는 ?lang= → 저장된 선택(localStorage pcg-lang) → 브라우저 언어 순으로 정하고, 지원하지 않는 언어는 영어로 보여 줍니다.
// 큰 화면과 폰은 각자 자기 언어를 씁니다. 상대 기기가 보낸 한국어 문장도 DOM 에 들어가면 같은 사전으로 번역됩니다.
// 사전에 없는 한국어는 원문 그대로 보이고 missing() 에 모입니다(검사용).

export const LANGS = ['ko', 'en', 'ja', 'zh'];
export const LANG_NAMES = { ko: '한국어', en: 'English', ja: '日本語', zh: '中文' };
const STORE = 'pcg-lang';
const HANGUL = /[ㄱ-ㆎ가-힣]/;
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CANVAS', 'TEXTAREA', 'CODE', 'PRE']);

function normLang(l) {
  const s = String(l || '').toLowerCase();
  if (s.startsWith('ko')) return 'ko';
  if (s.startsWith('ja')) return 'ja';
  if (s.startsWith('zh')) return 'zh';
  if (s.startsWith('en')) return 'en';
  return '';
}
function detect() {
  try {
    const q = normLang(new URLSearchParams(location.search).get('lang'));
    if (q) { try { localStorage.setItem(STORE, q); } catch (e) {} return q; }
  } catch (e) {}
  try { const s = normLang(localStorage.getItem(STORE)); if (s) return s; } catch (e) {}
  const prefs = (typeof navigator !== 'undefined' && (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language])) || [];
  for (const l of prefs) { const n = normLang(l); if (n) return n; }
  return 'en';
}

let cur = typeof location === 'undefined' ? 'ko' : detect();
const exact = { en: new Map(), ja: new Map(), zh: new Map() };
const patterns = { en: [], ja: [], zh: [] };
const missed = new Set();
const cache = new Map(); // 원문 → 번역(또는 null). 언어가 바뀌거나 사전이 늘면 비웁니다
const listeners = new Set();

const normKey = (s) => String(s).replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 사전을 더합니다. { en: { 원문: 번역 }, ja: {...}, zh: {...} }. 열쇠에 {이름} 이 있으면 그 자리는 아무 글자나 받는 틀로 씁니다. */
export function register(dicts) {
  for (const lang of Object.keys(dicts || {})) {
    if (!exact[lang]) continue;
    for (const [k0, v] of Object.entries(dicts[lang])) {
      const k = normKey(k0);
      exact[lang].set(k, v);
      // 고정 글자가 하나도 없는 틀('{a} {b}')은 아무 문장에나 맞으므로 정규식으로 쓰지 않습니다(t(키, vars) 정확 일치로만 씁니다)
      if (k.includes('{') && k.replace(/\{\w+\}/g, '').replace(/\s/g, '')) {
        const names = [];
        const src = '^' + k.split(/(\{\w+\})/).map((part) => {
          const m = /^\{(\w+)\}$/.exec(part);
          if (!m) return esc(part);
          names.push(m[1]);
          return '(.+?)';
        }).join('') + '$';
        // 글자가 많이 고정된 틀을 먼저 봅니다(더 구체적인 문장이 이깁니다)
        patterns[lang].push({ re: new RegExp(src, 's'), names, out: v, fixed: k.replace(/\{\w+\}/g, '').length });
      }
    }
    patterns[lang].sort((a, b) => b.fixed - a.fixed);
  }
  cache.clear();
  if (booted) schedule();
}

function lookup(k) {
  if (cur === 'ko') return k;
  if (cache.has(k)) return cache.get(k);
  let out = exact[cur].get(k);
  if (out == null) {
    for (const p of patterns[cur]) {
      const m = p.re.exec(k);
      if (!m) continue;
      out = p.out.replace(/\{(\w+)\}/g, (all, name) => {
        const i = p.names.indexOf(name);
        if (i < 0) return all;
        const v = m[i + 1];
        return HANGUL.test(v) ? (lookup(normKey(v)) ?? v) : v;
      });
      break;
    }
  }
  if (out == null) { out = null; if (HANGUL.test(k)) missed.add(k); }
  if (cache.size > 4000) cache.clear();
  cache.set(k, out);
  return out;
}

/** 원문을 지금 언어로. vars 를 주면 {이름} 자리를 채웁니다(값이 한국어면 그 값도 번역). 사전에 없으면 원문 그대로. */
export function t(ko, vars) {
  let s = String(ko);
  if (cur !== 'ko') {
    const hit = vars ? exact[cur].get(normKey(s)) : lookup(normKey(s));
    if (hit != null) s = hit;
    else if (vars && HANGUL.test(s)) missed.add(normKey(s));
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (all, name) => {
    if (!(name in vars)) return all;
    const v = vars[name];
    return typeof v === 'string' && cur !== 'ko' && HANGUL.test(v) ? (lookup(normKey(v)) ?? v) : String(v);
  });
  return s;
}
export const lang = () => cur;
export const missing = () => [...missed];

// ───────── DOM 자동 번역 ─────────
const textRec = new WeakMap(); // Text → { src, out, lang }
const attrRec = new WeakMap(); // Element → { attr: { src, out, lang } }
let booted = false, observer = null, pending = false;

function skipEl(el) {
  for (let e = el; e && e.nodeType === 1; e = e.parentNode) {
    if (SKIP_TAGS.has(e.tagName)) return true;
    if (e.getAttribute && (e.getAttribute('data-i18n') === 'off' || e.getAttribute('translate') === 'no')) return true;
  }
  return false;
}
function convert(src) {
  if (cur === 'ko') return src;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(src);
  const hit = lookup(normKey(m[2]));
  return hit == null ? src : m[1] + hit + m[3];
}
function doText(node) {
  const raw = node.nodeValue;
  const rec = textRec.get(node);
  if (rec && rec.out === raw) {
    if (rec.lang === cur) return;
    const out = convert(rec.src);
    rec.out = out; rec.lang = cur;
    if (out !== raw) node.nodeValue = out;
    return;
  }
  if (!HANGUL.test(raw)) { if (rec) textRec.delete(node); return; }
  if (!node.parentNode || skipEl(node.parentNode)) return;
  const out = convert(raw);
  textRec.set(node, { src: raw, out, lang: cur });
  if (out !== raw) node.nodeValue = out;
}
function doAttrs(el) {
  if (skipEl(el)) return;
  let recs = attrRec.get(el);
  for (const a of ATTRS) {
    if (!el.hasAttribute(a)) continue;
    const raw = el.getAttribute(a);
    const rec = recs && recs[a];
    if (rec && rec.out === raw) {
      if (rec.lang === cur) continue;
      const out = convert(rec.src);
      rec.out = out; rec.lang = cur;
      if (out !== raw) el.setAttribute(a, out);
      continue;
    }
    if (!HANGUL.test(raw)) continue;
    const out = convert(raw);
    if (!recs) { recs = {}; attrRec.set(el, recs); }
    recs[a] = { src: raw, out, lang: cur };
    if (out !== raw) el.setAttribute(a, out);
  }
}
function walk(root) {
  if (!root) return;
  if (root.nodeType === 3) { doText(root); return; }
  if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
  if (root.nodeType === 1) { if (SKIP_TAGS.has(root.tagName)) return; doAttrs(root); }
  const tw = document.createTreeWalker(root, 5 /* 요소 + 텍스트 */, {
    acceptNode: (n) => (n.nodeType === 1 && (SKIP_TAGS.has(n.tagName) || n.getAttribute('data-i18n') === 'off') ? 2 /* 건너뛰기(하위 포함) */ : 1),
  });
  for (let n = tw.nextNode(); n; n = tw.nextNode()) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
}
/** 지금 문서(또는 root 아래)를 다시 번역합니다. 보통은 직접 부를 일이 없습니다. */
export function translateDom(root) { walk(root || document.documentElement); }
function schedule() {
  if (pending) return;
  pending = true;
  Promise.resolve().then(() => { pending = false; translateDom(); });
}
function onMutations(list) {
  for (const m of list) {
    if (m.type === 'characterData') doText(m.target);
    else if (m.type === 'attributes') doAttrs(m.target);
    else for (const n of m.addedNodes) walk(n);
  }
}

/** 번역을 시작합니다(문서가 준비되면 자동으로 한 번 불립니다). */
export function boot() {
  if (typeof document === 'undefined') return cur;
  document.documentElement.lang = cur === 'zh' ? 'zh-Hans' : cur;
  if (!booted) {
    booted = true;
    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  translateDom();
  document.documentElement.classList.remove('pcg-i18n-wait');
  return cur;
}

/** 언어를 바꿉니다. 화면 글자는 바로 바뀌고, 캔버스 글자처럼 직접 그린 것은 'pcg-langchange' 를 듣고 다시 그리거나 reload 로 새로 고칩니다. */
export function setLang(code, { reload = false } = {}) {
  const n = normLang(code);
  if (!n || n === cur) return cur;
  cur = n;
  try { localStorage.setItem(STORE, n); } catch (e) {}
  cache.clear();
  if (reload) {
    try { const u = new URL(location.href); u.searchParams.delete('lang'); location.replace(u.href); return cur; } catch (e) {}
    location.reload();
    return cur;
  }
  boot();
  for (const fn of listeners) { try { fn(cur); } catch (e) {} }
  try { window.dispatchEvent(new CustomEvent('pcg-langchange', { detail: { lang: cur } })); } catch (e) {}
  return cur;
}
export function onLangChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** 언어 고르기(작은 select)를 target 안에 넣습니다. reload: 바꾸면 페이지를 새로 고침(캔버스 글자가 많은 화면용). */
export function mountSwitcher(target, { reload = false, compact = false } = {}) {
  if (typeof document === 'undefined' || !target) return null;
  if (!document.getElementById('pcg-lang-style')) {
    const st = document.createElement('style');
    st.id = 'pcg-lang-style';
    st.textContent = '.pcg-lang{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:rgba(10,14,22,.55);border:1px solid rgba(255,255,255,.18);color:#fff;font:600 13px/1 Pretendard,system-ui,sans-serif;backdrop-filter:blur(6px)}' +
      '.pcg-lang svg{width:15px;height:15px;opacity:.85;flex:none}.pcg-lang select{appearance:none;-webkit-appearance:none;background:transparent;border:0;color:inherit;font:inherit;padding:2px 2px;cursor:pointer;outline:none}' +
      '.pcg-lang select option{color:#111}.pcg-lang.compact{padding:5px 8px;font-size:12px}';
    document.head.appendChild(st);
  }
  const box = document.createElement('label');
  box.className = 'pcg-lang' + (compact ? ' compact' : '');
  box.setAttribute('data-i18n', 'off');
  box.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/></svg>';
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', 'Language');
  for (const l of LANGS) { const o = document.createElement('option'); o.value = l; o.textContent = LANG_NAMES[l]; sel.appendChild(o); }
  sel.value = cur;
  sel.addEventListener('change', () => setLang(sel.value, { reload }));
  listeners.add(() => { sel.value = cur; });
  box.appendChild(sel);
  target.appendChild(box);
  return box;
}

if (typeof window !== 'undefined') {
  window.PCG = window.PCG || {};
  window.PCG.i18n = { t, lang, setLang, register, translateDom, missing, mountSwitcher, onLangChange, boot, LANGS, LANG_NAMES };
  window.PCG.t = t;
  // 모듈 스크립트(사전 등록)가 모두 실행된 뒤 한 번 번역합니다
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else Promise.resolve().then(boot);
}
