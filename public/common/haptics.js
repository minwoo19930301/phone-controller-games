// 폰 진동·번쩍임·손전등 공통 모듈 (폰 쪽).
//
// - 안드로이드: navigator.vibrate 로 진동합니다.
// - iPhone(사파리에는 진동 API가 없음): 화면을 짧게 번쩍이고 아주 작은 '틱' 소리를 냅니다.
//   iOS 18+ 의 <input type="checkbox" switch> 라벨 클릭 햅틱도 시도합니다. 되든 안 되든 예외·화면 변화가 없게 막아 둡니다.
// - 터치가 없는 PC(시험용)도 화면 번쩍임으로 보여 줍니다.
// - 손전등(총 게임): 안드로이드 크롬 뒤 카메라 트랙의 torch 를 잠깐 켰다 끕니다. 카메라 권한이 필요해서
//   시작 화면의 켜기 스위치(torch.mountToggle)를 눌렀을 때만 요청합니다.
//
// 주소로 강제하기(시험용): ?haptics=vibrate|ios|visual|off, ?torch=sim (손전등 흉내)
// 큰 화면에서도 sendHaptic 만 가져다 쓸 수 있게, 불러오기만 해서는 아무것도 만들지 않습니다.

const W = typeof window !== 'undefined' ? window : null;
const NAV = typeof navigator !== 'undefined' ? navigator : {};
const params = W ? new URLSearchParams(W.location.search) : new URLSearchParams();
const FORCE = (params.get('haptics') || '').toLowerCase();
const TORCH_SIM = params.get('torch') === 'sim';
// iPadOS 사파리는 맥처럼 보이므로(UA 에 Macintosh) 터치 여부로 가립니다. 안드로이드 UA 는 절대 iOS 가 아닙니다.
const UA = NAV.userAgent || '';
const IS_IOS = !/Android/i.test(UA) && (/iP(hone|ad|od)/.test(UA) || (/Macintosh/.test(UA) && NAV.maxTouchPoints > 1));
const IS_TOUCH = (NAV.maxTouchPoints || 0) > 0 || (W && 'ontouchstart' in W);
const HAS_VIBRATE = typeof NAV.vibrate === 'function';
const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(+x) ? +x : 1));

// 어떤 방식으로 손에 느낌을 줄지
function decideMode() {
  if (['vibrate', 'ios', 'visual', 'off'].includes(FORCE)) return FORCE;
  if (IS_IOS) return 'ios';
  if (HAS_VIBRATE && IS_TOUCH) return 'vibrate';
  return 'visual';
}

// 종류별 진동 무늬(ms)와 진동이 없을 때의 번쩍임
// flash: [색(null = 내 색), 진하기, 길이 ms]
const KINDS = {
  tick: { pattern: [8], flash: null, tone: [2100, 0.012, 0.07] },
  hit: { pattern: (s) => [Math.round(12 + 38 * s)], flash: (s) => [null, 0.2 + 0.4 * s, 200], tone: [1500, 0.02, 0.12] },
  strong: { pattern: [55, 30, 30], flash: [null, 0.6, 260], tone: [900, 0.04, 0.16] },
  shot: { pattern: [24], flash: ['muzzle', 0.85, 150], tone: [700, 0.025, 0.12], torch: true },
  block: { pattern: [32], flash: ['#bfe6ff', 0.45, 180], tone: [1200, 0.03, 0.12] },
  clash: { pattern: [26, 34, 48], flash: ['#ffffff', 0.7, 260], tone: [1800, 0.03, 0.14] },
  success: { pattern: [28, 50, 60], flash: ['#5ee07a', 0.4, 320], tone: [[880, 1320], 0.05, 0.12] },
  fail: { pattern: [110], flash: ['#ff5a5f', 0.35, 300], tone: [210, 0.09, 0.14] },
  perfect: { pattern: [34], flash: ['#ffd23a', 0.5, 220], tone: [1760, 0.02, 0.1] },
  great: { pattern: [22], flash: [null, 0.38, 200], tone: [1480, 0.02, 0.09] },
  good: { pattern: [12], flash: [null, 0.2, 160], tone: [1240, 0.015, 0.07] },
  miss: { pattern: [], flash: null, tone: null },
  bite: { pattern: [70, 60, 70], flash: ['#8fd8ff', 0.5, 320], tone: [600, 0.05, 0.14] },
  warn: { pattern: [20, 60, 20], flash: ['#ffc93c', 0.35, 260], tone: [520, 0.04, 0.12] }
};
// 같은 '계열'은 화면 확인(d2c haptic)이 폰의 즉시 진동 바로 뒤에 오면 한 번만 울립니다.
const FAMILY = { hit: 'hit', strong: 'hit', block: 'hit', clash: 'hit', perfect: 'judge', great: 'judge', good: 'judge', miss: 'judge' };

const CSS = `
.pcgh-flash{position:fixed;inset:0;pointer-events:none;opacity:0;z-index:2147483000;background:#fff;}
.pcgh-torchbadge{position:fixed;right:12px;top:calc(env(safe-area-inset-top) + 12px);z-index:2147483001;pointer-events:none;
  padding:6px 10px;border-radius:999px;background:#fff6c9;color:#2a2100;font:800 12px/1 "Pretendard Variable",Pretendard,system-ui,sans-serif;opacity:0;}
.pcgh-toggle{display:flex;align-items:center;gap:12px;width:100%;padding:12px 14px;border-radius:16px;text-align:left;cursor:pointer;
  background:rgba(255,255,255,.06);border:1.5px solid rgba(255,255,255,.12);color:#f3f4f7;margin:0;
  font:inherit;font-family:"Pretendard Variable",Pretendard,-apple-system,system-ui,sans-serif;-webkit-tap-highlight-color:transparent;}
.pcgh-toggle[hidden]{display:none;}
.pcgh-ico{flex:none;width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:rgba(255,255,255,.08);color:#ffe27a;}
.pcgh-ico svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}
.pcgh-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}
.pcgh-txt b{font-size:15px;font-weight:800;letter-spacing:-.01em;color:#f3f4f7;}
.pcgh-txt span{font-size:12px;font-weight:600;color:#9aa8bf;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pcgh-sw{flex:none;position:relative;width:50px;height:30px;border-radius:999px;background:rgba(255,255,255,.16);transition:background .2s;}
.pcgh-sw::after{content:"";position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:#fff;
  box-shadow:0 2px 6px rgba(0,0,0,.35);transition:transform .22s cubic-bezier(.3,1.4,.5,1);}
.pcgh-toggle.on .pcgh-sw{background:#ffd23a;}
.pcgh-toggle.on .pcgh-sw::after{transform:translateX(20px);}
.pcgh-toggle.on .pcgh-ico{background:#ffd23a;color:#2a2100;}
.pcgh-toggle.busy .pcgh-sw{opacity:.5;}
.pcgh-toggle.bad .pcgh-txt span{color:#ffb3b5;}
`;
let cssDone = false;
function injectCss() {
  if (cssDone || !W) return;
  cssDone = true;
  const s = document.createElement('style');
  s.id = 'pcg-haptics-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ---------- 소리(진동 대신 쓰는 아주 작은 틱) ----------
let actx = null;
function audio() {
  if (!W) return null;
  if (!actx) {
    const AC = W.AudioContext || W.webkitAudioContext;
    if (!AC) return null;
    try { actx = new AC(); } catch (e) { return null; }
  }
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}
function tone(spec, strength) {
  const a = audio();
  if (!a || a.state !== 'running' || !spec) return;
  const [f, dur, gain] = spec;
  const freqs = Array.isArray(f) ? f : [f];
  const t0 = a.currentTime + 0.002;
  freqs.forEach((fr, i) => {
    const o = a.createOscillator();
    const g = a.createGain();
    const t = t0 + i * dur * 1.1;
    o.type = fr < 400 ? 'triangle' : 'sine';
    o.frequency.setValueAtTime(fr, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain * (0.55 + 0.45 * strength), t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  });
}

// ---------- iOS 18+ 스위치 햅틱(되면 좋고, 안 돼도 아무 일 없음) ----------
let lastIos = 0;
function iosTap() {
  const now = performance.now();
  if (now - lastIos < 45) return;
  lastIos = now;
  try {
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.display = 'none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.appendChild(input);
    document.head.appendChild(label);
    label.click();
    label.remove();
  } catch (e) { /* 지원하지 않으면 그냥 넘어갑니다 */ }
}

// ---------- 화면 번쩍임 ----------
let flashEl = null;
function flashLayer() {
  injectCss();
  if (!flashEl || !flashEl.isConnected) {
    flashEl = document.createElement('div');
    flashEl.className = 'pcgh-flash';
    flashEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(flashEl);
  }
  return flashEl;
}
function myColor() {
  if (cfg.color) return cfg.color;
  try {
    const c = getComputedStyle(document.documentElement).getPropertyValue('--c').trim();
    if (c) return c;
  } catch (e) {}
  return '#ffffff';
}
function flash(color, opacity = 0.55, ms = 240) {
  if (!W || !document.body) return;
  const el = flashLayer();
  if (color === 'muzzle') {
    el.style.background = 'radial-gradient(circle at 50% 58%, #fff 0, #fff7d6 22%, rgba(255,214,120,.75) 48%, rgba(255,170,60,.25) 75%, transparent 100%)';
  } else {
    el.style.background = color || myColor();
  }
  try {
    el.animate([{ opacity: Math.max(0, Math.min(1, opacity)) }, { opacity: 0 }], { duration: ms, easing: 'cubic-bezier(.2,.7,.3,1)' });
  } catch (e) {
    el.style.opacity = '0';
  }
}

// ---------- 설정 ----------
const cfg = {
  mode: decideMode(), // vibrate | ios | visual | off
  sound: true, // 진동이 없을 때 틱 소리
  flash: true, // 진동이 없을 때 번쩍임
  color: null, // 번쩍임 기본 색(없으면 페이지의 --c)
  intensity: 1 // 진동 길이 배율(0.5~1.5)
};
const listeners = new Set();
const lastLocal = new Map(); // 계열 -> { at, strength }

function emitDebug(info) {
  for (const fn of listeners) {
    try { fn(info); } catch (e) {}
  }
}

function vibrate(pattern) {
  if (!HAS_VIBRATE || !pattern || !pattern.length) return false;
  // 화면을 한 번도 누르지 않은 페이지에서는 브라우저가 진동을 막고 콘솔에 경고를 남깁니다. 그때는 부르지 않습니다.
  const ua = NAV.userActivation;
  if (ua && ua.hasBeenActive === false) return null;
  const k = Math.max(0.3, Math.min(1.6, cfg.intensity));
  const p = pattern.map((v, i) => (i % 2 === 0 ? Math.max(1, Math.round(v * k)) : v));
  try { return NAV.vibrate(p.length === 1 ? p[0] : p); } catch (e) { return false; }
}

/** 종류별 느낌 하나. kind: tick|hit|strong|shot|block|clash|success|fail|perfect|great|good|miss|bite|warn */
function play(kind, strength = 1, opts = {}) {
  const k = KINDS[kind] ? kind : 'hit';
  const def = KINDS[k];
  const s = clamp01(strength);
  const fam = FAMILY[k] || k;
  const now = performance.now();
  // 화면에서 온 확인 신호가 방금 폰이 스스로 울린 것과 같은 계열이면 거릅니다.
  if (opts.remote) {
    const prev = lastLocal.get(fam);
    if (prev && now - prev.at < (opts.dedupeMs ?? 220) && prev.strength >= s - 0.15) {
      emitDebug({ kind: k, strength: s, mode: cfg.mode, skipped: 'dedupe', remote: true });
      return;
    }
  } else {
    lastLocal.set(fam, { at: now, strength: s });
  }
  const pattern = Array.isArray(opts.pattern) ? opts.pattern : typeof def.pattern === 'function' ? def.pattern(s) : def.pattern;
  const mode = cfg.mode;
  let did = 'none';
  if (mode === 'off') did = 'off';
  else if (mode === 'vibrate') {
    const r = vibrate(pattern);
    did = r ? 'vibrate' : r === null ? 'blocked' : 'vibrate?';
    // 아직 탭 전이라 막혔으면 화면 번쩍임으로 대신합니다.
    if (r === null && cfg.flash && !opts.noFlash) {
      const fl = typeof def.flash === 'function' ? def.flash(s) : def.flash;
      if (fl) flash(opts.color || fl[0], fl[1], fl[2]);
    }
  } else {
    // ios | visual: 번쩍 + 틱. iOS 는 스위치 햅틱도 한 번 시도합니다.
    if (mode === 'ios' && pattern && pattern.length) iosTap();
    const fl = typeof def.flash === 'function' ? def.flash(s) : def.flash;
    if (cfg.flash && fl && !opts.noFlash) flash(opts.color || fl[0], fl[1], fl[2]);
    if (cfg.sound && !opts.silent) tone(def.tone, s);
    did = mode;
  }
  // 총 쏘기는 진동이 있어도 화면을 번쩍입니다(총구 불꽃).
  if (k === 'shot' && mode === 'vibrate' && cfg.flash && !opts.noFlash) flash('muzzle', 0.7, 140);
  if (def.torch && torchState.enabled && !opts.noTorch) torch.pulse(opts.torchMs || 70);
  emitDebug({ kind: k, strength: s, mode, did, pattern, remote: Boolean(opts.remote) });
}

// ---------- 손전등 ----------
const TORCH_KEY = 'pcg-torch'; // on | off | no(이 폰은 안 됨)
const torchState = { enabled: false, stream: null, track: null, busy: false, lit: false, pref: null, wantRestore: false };
try { torchState.pref = W ? localStorage.getItem(TORCH_KEY) : null; } catch (e) {}
function savePref(v) {
  torchState.pref = v;
  try { localStorage.setItem(TORCH_KEY, v); } catch (e) {}
}
function releaseCamera() {
  const st = torchState;
  if (st.track) {
    try { st.track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {}); } catch (e) {}
  }
  if (st.stream) for (const t of st.stream.getTracks()) { try { t.stop(); } catch (e) {} }
  st.stream = null;
  st.track = null;
  st.lit = false;
}
async function openTorchTrack() {
  const md = NAV.mediaDevices;
  if (!md || !md.getUserMedia) throw new Error('no-media');
  let stream;
  try {
    stream = await md.getUserMedia({ audio: false, video: { facingMode: { exact: 'environment' }, width: { ideal: 640 }, frameRate: { ideal: 15 } } });
  } catch (e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;
    stream = await md.getUserMedia({ audio: false, video: { facingMode: 'environment' } });
  }
  const track = stream.getVideoTracks()[0];
  if (!track) { for (const t of stream.getTracks()) t.stop(); throw new Error('no-track'); }
  // 어떤 폰은 카메라가 켜지고 조금 뒤에야 torch 능력이 보입니다.
  let ok = false;
  for (let i = 0; i < 4 && !ok; i++) {
    const caps = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};
    if (caps && caps.torch) ok = true;
    else await new Promise((r) => setTimeout(r, 200));
  }
  if (!ok) {
    // 능력 표시가 없어도 실제로 켜지는 폰이 있어 한 번 켜 봅니다.
    try {
      await track.applyConstraints({ advanced: [{ torch: true }] });
      ok = Boolean(track.getSettings && track.getSettings().torch);
      await track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
    } catch (e) { ok = false; }
  }
  if (!ok) {
    for (const t of stream.getTracks()) t.stop();
    throw new Error('no-torch');
  }
  return { stream, track };
}
let torchBadge = null;
function simPulse(ms) {
  injectCss();
  if (!torchBadge || !torchBadge.isConnected) {
    torchBadge = document.createElement('div');
    torchBadge.className = 'pcgh-torchbadge';
    torchBadge.textContent = '손전등 번쩍';
    document.body.appendChild(torchBadge);
  }
  try { torchBadge.animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: Math.max(240, ms * 3) }); } catch (e) {}
}

const torch = {
  /** 손전등을 쓸 수 있을 것 같은지(동기, 추정). iOS·카메라 API 없음·http·이미 안 됐던 폰이면 false. */
  supported() {
    if (TORCH_SIM) return true;
    if (!W || IS_IOS || !W.isSecureContext) return false;
    if (!NAV.mediaDevices || !NAV.mediaDevices.getUserMedia) return false;
    if (torchState.pref === 'no') return false;
    return IS_TOUCH;
  },
  get enabled() { return torchState.enabled; },
  /** 화면 탭 안에서 부릅니다. 카메라 권한을 받고 torch 가 되는지 확인합니다. 되면 true. */
  async enable() {
    if (torchState.enabled) return true;
    if (TORCH_SIM) { torchState.enabled = true; savePref('on'); return true; }
    if (!torch.supported()) return false;
    torchState.busy = true;
    try {
      const { stream, track } = await openTorchTrack();
      torchState.stream = stream;
      torchState.track = track;
      torchState.enabled = true;
      savePref('on');
      return true;
    } catch (e) {
      releaseCamera();
      torchState.enabled = false;
      if (e && e.message === 'no-torch') savePref('no');
      else savePref('off');
      return false;
    } finally {
      torchState.busy = false;
    }
  },
  /** 끄고 카메라를 놓습니다. */
  disable() {
    torchState.enabled = false;
    releaseCamera();
    savePref('off');
  },
  /** 손전등을 ms 동안 켰다 끕니다(총구 불꽃). 켜지 않았으면 아무것도 안 합니다. */
  pulse(ms = 70) {
    const st = torchState;
    if (!st.enabled) return;
    if (TORCH_SIM) { simPulse(ms); return; }
    if (!st.track || st.track.readyState !== 'live') {
      // 화면을 껐다 켜서 카메라를 놓았으면 다시 잡습니다(권한은 이미 있음). 이번 발은 건너뜁니다.
      if (!st.busy) {
        st.busy = true;
        openTorchTrack().then(({ stream, track }) => { st.stream = stream; st.track = track; })
          .catch(() => {}).finally(() => { st.busy = false; });
      }
      return;
    }
    if (st.lit) return;
    st.lit = true;
    const tr = st.track;
    tr.applyConstraints({ advanced: [{ torch: true }] }).catch(() => {}).finally(() => {
      setTimeout(() => {
        tr.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {}).finally(() => { st.lit = false; });
      }, Math.max(30, Math.min(300, ms)));
    });
  },
  /** 지금 켜져 있으면 끕니다(카메라는 유지). */
  off() {
    const st = torchState;
    if (st.track) { try { st.track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {}); } catch (e) {} }
    st.lit = false;
  },
  /**
   * 시작 화면용 켜기 스위치. 안 되는 폰(iOS, 손전등 없음)에서는 숨깁니다.
   * 반환: 스위치 요소. opts.label / opts.sub 로 글을 바꿀 수 있습니다.
   */
  mountToggle(container, opts = {}) {
    injectCss();
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'pcgh-toggle';
    el.innerHTML = '<span class="pcgh-ico"><svg viewBox="0 0 24 24"><path d="M8 2h8l-1 5H9z"/><path d="M9 7h6v4l-1.5 2v8h-3v-8L9 11z"/><path d="M12 14v2"/></svg></span>' +
      '<span class="pcgh-txt"><b></b><span></span></span><span class="pcgh-sw" aria-hidden="true"></span>';
    const label = opts.label || '총 쏠 때 손전등 번쩍';
    const sub = opts.sub || '안드로이드 · 카메라 권한이 필요해요';
    el.querySelector('b').textContent = label;
    const subEl = el.querySelector('.pcgh-txt span');
    subEl.textContent = sub;
    let holdVisible = false; // '안 돼요' 안내를 잠깐 보여 주는 동안은 숨기지 않습니다
    const paint = () => {
      el.classList.toggle('on', torchState.enabled);
      el.setAttribute('aria-pressed', torchState.enabled ? 'true' : 'false');
      el.hidden = !holdVisible && !torch.supported() && !torchState.enabled;
    };
    el.addEventListener('click', async (e) => {
      e.preventDefault();
      if (torchState.busy) return;
      el.classList.remove('bad');
      if (torchState.enabled) {
        torch.disable();
        subEl.textContent = sub;
        paint();
        return;
      }
      el.classList.add('busy');
      subEl.textContent = '카메라 권한을 확인하는 중…';
      const ok = await torch.enable();
      el.classList.remove('busy');
      if (ok) {
        subEl.textContent = '켜짐 · 쏠 때마다 번쩍여요';
        torch.pulse(90);
        if (typeof opts.onChange === 'function') opts.onChange(true);
      } else {
        el.classList.add('bad');
        subEl.textContent = torchState.pref === 'no' ? '이 폰은 손전등을 켤 수 없어요' : '카메라 권한이 없어 켜지 못했어요';
        if (typeof opts.onChange === 'function') opts.onChange(false);
        if (torchState.pref === 'no') {
          holdVisible = true;
          setTimeout(() => { holdVisible = false; paint(); }, 2400);
        }
      }
      paint();
    });
    paint();
    // 예전에 켜 두었고 카메라 권한이 이미 있으면 조용히 다시 켭니다.
    if (torchState.pref === 'on' && !torchState.enabled && torch.supported()) {
      const tryRestore = () => torch.enable().then((ok) => { paint(); if (ok) subEl.textContent = '켜짐 · 쏠 때마다 번쩍여요'; });
      if (TORCH_SIM) tryRestore();
      else if (NAV.permissions && NAV.permissions.query) {
        NAV.permissions.query({ name: 'camera' }).then((p) => { if (p.state === 'granted') tryRestore(); }).catch(() => {});
      }
    }
    if (container) container.appendChild(el);
    return el;
  }
};

// 화면이 꺼지거나 페이지를 떠나면 손전등을 끄고 카메라를 놓습니다.
if (W) {
  const away = () => { if (document.hidden) releaseCamera(); };
  document.addEventListener('visibilitychange', away);
  W.addEventListener('pagehide', releaseCamera);
}

/** 화면 탭 안에서 한 번 부르면 소리(틱)가 바로 나도록 오디오를 엽니다. */
function unlock() {
  if (cfg.mode === 'ios' || cfg.mode === 'visual') audio();
  return cfg.mode;
}
// 첫 터치 때 저절로 열어 둡니다(폰 페이지에서 haptics 를 처음 쓸 때 한 번 설치).
let autoUnlock = false;
function installAutoUnlock() {
  if (autoUnlock || !W) return;
  autoUnlock = true;
  const go = () => {
    unlock();
    W.removeEventListener('pointerdown', go, true);
    W.removeEventListener('touchend', go, true);
  };
  W.addEventListener('pointerdown', go, { capture: true, passive: true });
  W.addEventListener('touchend', go, { capture: true, passive: true });
}

/**
 * 큰 화면이 보내는 d2c haptic {kind, strength, pattern?, color?} 을 받아 울립니다.
 * opts.slot: 내 자리(숫자나 함수). 메시지에 slot 이 있고 내 자리와 다르면 무시합니다.
 * opts.dedupeMs: 폰이 방금 스스로 울린 같은 계열은 이 시간 안이면 거릅니다(기본 220ms).
 * 반환: 듣기를 끄는 함수.
 */
function listen(socket, opts = {}) {
  installAutoUnlock();
  const h = (d) => {
    if (!d || typeof d !== 'object') return;
    const mine = typeof opts.slot === 'function' ? opts.slot() : opts.slot;
    if (d.slot != null && mine != null && Number(d.slot) !== Number(mine)) return;
    if (d.kind === 'flash') { flash(d.color || null, d.opacity ?? 0.55, d.ms ?? 240); return; }
    play(String(d.kind || 'hit'), d.strength ?? 1, { remote: true, dedupeMs: opts.dedupeMs, pattern: d.pattern, color: d.color });
  };
  socket.on('haptic', h);
  return () => socket.off('haptic', h);
}

export const haptics = {
  /** 공을 쳤을 때. strength 0~1 이 진동 길이(12~50ms)가 됩니다. */
  hit(strength = 0.7, opts) { installAutoUnlock(); play('hit', strength, opts); },
  /** 총 한 발. 진동 + 총구 번쩍 + (켰으면) 손전등. */
  shot(opts) { installAutoUnlock(); play('shot', 1, opts); },
  success(opts) { installAutoUnlock(); play('success', 1, opts); },
  fail(opts) { installAutoUnlock(); play('fail', 1, opts); },
  tick(opts) { installAutoUnlock(); play('tick', 1, opts); },
  /** 아무 종류나: tick|hit|strong|shot|block|clash|success|fail|perfect|great|good|miss|bite|warn */
  play(kind, strength = 1, opts) { installAutoUnlock(); play(kind, strength, opts); },
  /** 화면 전체를 한 번 번쩍입니다(진동과 상관없이). color 없으면 내 색. */
  flash(color, opts = {}) { flash(color, opts.opacity ?? 0.55, opts.ms ?? 240); },
  /** 진동 무늬를 그대로(진동이 없는 폰은 번쩍+틱으로 바꿈). */
  buzz(pattern, opts = {}) { installAutoUnlock(); play('hit', 0.8, { ...opts, pattern: Array.isArray(pattern) ? pattern : [pattern] }); },
  unlock() { installAutoUnlock(); return unlock(); },
  listen,
  torch,
  /** cfg: { mode, sound, flash, color, intensity } 일부만 줘도 됩니다. */
  config(next = {}) {
    if (next.mode && ['vibrate', 'ios', 'visual', 'off'].includes(next.mode)) cfg.mode = next.mode;
    for (const k of ['sound', 'flash', 'color', 'intensity']) if (k in next) cfg[k] = next[k];
    return { ...cfg };
  },
  /** 디버그용: 울릴 때마다 {kind, strength, mode, did, pattern, remote} 를 받습니다. 끄는 함수를 돌려줍니다. */
  onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  get mode() { return cfg.mode; },
  get canVibrate() { return HAS_VIBRATE && cfg.mode === 'vibrate'; },
  isIOS: IS_IOS
};

/** 큰 화면 쪽: 한 폰(slot) 또는 모든 폰(slot = null)에 느낌을 보냅니다. */
export function sendHaptic(socket, slot, kind = 'hit', strength = 1, extra = {}) {
  if (!socket || !socket.connected) return;
  const data = { kind, strength: Math.round(clamp01(strength) * 100) / 100, ...extra };
  socket.emit('d2c', slot != null ? { event: 'haptic', slot, data } : { event: 'haptic', data });
}

export default haptics;
if (W) {
  W.PCG = W.PCG || {};
  W.PCG.haptics = haptics;
}
