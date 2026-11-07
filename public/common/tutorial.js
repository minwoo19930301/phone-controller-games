// 처음 하는 사람을 위한 짧은 연습(튜토리얼) 공통 모듈 (폰 쪽).
//
// 폰마다 localStorage['pcg-tut-<key>'] 로 해 봤는지 기억합니다. 처음이면 권한·자세 맞추기 다음에 3~5단계 연습을 띄웁니다.
// 단계마다 큰 제목 + 한 줄 설명 + 동작 그림을 보여 주고, 종목의 감지기가 t.signal('swing', data) 처럼 알려 주면 ✓ 와 함께
// 진동·번쩍임·소리로 칭찬하고 다음 단계로 넘어갑니다. 건너뛰기는 언제나 있습니다.
// 진행 상황은 c2d tutorial {step, total, title, done} 으로 큰 화면에 보내, 대기실에 "2P 연습 중 2/4 · 휘둘러 보기" 가 뜹니다.
//
//   const tut = createTutorial({ key: 'pingpong', socket, steps: [
//     { title: '탁구채처럼 쥐기', body: '폰 아래쪽을 손잡이처럼 쥐어요', svg: 'hold' },                  // '다음' 버튼 단계
//     { title: '포핸드', body: '오른쪽에서 앞으로 휘둘러요', svg: 'swing', waitFor: 'swing', check: (d) => d.hand === 'fore' || '반대쪽이에요' },
//   ]});
//   if (tut.firstTime()) await tut.run();
//   // 감지기에서: tut.signal('swing', data)
//   tut.link($('waitBox'));   // "튜토리얼 다시 하기" 링크
//
// 주소로 시험: ?tut=1 (늘 처음처럼), ?tut=0 (안 띄움), &debug (단계마다 '시험: 성공 처리' 버튼)

import { haptics } from './haptics.js';

const params = new URLSearchParams(location.search);
const FORCE = params.get('tut');
const DEBUG = params.has('debug');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ================================================================
// 동작 그림(SVG). 모두 200×160, 내 색은 var(--pcgt-c).
// ================================================================
const PHONE = '<rect x="-17" y="-31" width="34" height="62" rx="7" class="pcgt-ph"/><rect x="-12.5" y="-24.5" width="25" height="46" rx="3" class="pcgt-scr"/><path d="M-5 -28h10" class="pcgt-spk"/>';
const FIST = '<rect x="-14" y="-6" width="28" height="22" rx="9" class="pcgt-hand"/><path d="M-10 2h20M-10 8h20" class="pcgt-handl"/>';
const svgWrap = (inner, cls = '') => `<svg class="pcgt-svg ${cls}" viewBox="0 0 200 160" aria-hidden="true">${inner}</svg>`;
const R = Math.PI / 180;
const f1 = (x) => Math.round(x * 10) / 10;
function arrowHead(x, y, dx, dy, size = 9) {
  const a = Math.atan2(dy, dx);
  const p1 = [x - size * Math.cos(a - 0.5), y - size * Math.sin(a - 0.5)];
  const p2 = [x - size * Math.cos(a + 0.5), y - size * Math.sin(a + 0.5)];
  return `<path class="pcgt-arrow" d="M${f1(p1[0])} ${f1(p1[1])} L${f1(x)} ${f1(y)} L${f1(p2[0])} ${f1(p2[1])}"/>`;
}
const loop = 'repeatCount="indefinite"';

export const illustrations = {
  /** 쥐고 가만히(자세 맞추기) */
  hold() {
    return svgWrap(
      `<circle cx="100" cy="72" r="40" class="pcgt-ring"><animate attributeName="r" values="38;62" dur="2.2s" ${loop}/><animate attributeName="opacity" values=".7;0" dur="2.2s" ${loop}/></circle>` +
      `<circle cx="100" cy="72" r="40" class="pcgt-ring"><animate attributeName="r" values="38;62" dur="2.2s" begin="1.1s" ${loop}/><animate attributeName="opacity" values=".7;0" dur="2.2s" begin="1.1s" ${loop}/></circle>` +
      `<g transform="translate(100 66) scale(1.25)">${PHONE}</g>` +
      `<rect x="88" y="112" width="24" height="40" rx="9" class="pcgt-hand"/>` +
      `<g transform="translate(100 100) scale(1.15)">${FIST}</g><rect x="113" y="88" width="10" height="22" rx="5" class="pcgt-hand"/>`
    );
  },
  /** 휘두르기. o.dir = 1(오른쪽으로) | -1(왼쪽으로), o.from/o.to = 각도(위가 0, 시계 방향 +) */
  swing(o = {}) {
    const dir = o.dir === -1 || o.dir === 'left' ? -1 : 1;
    const from = o.from ?? -62;
    const to = o.to ?? 42;
    const cx = 100, cy = 150, r = 100;
    const pt = (a) => [cx + r * Math.sin(a * R), cy - r * Math.cos(a * R)];
    const [x0, y0] = pt(from);
    const [x1, y1] = pt(to);
    const large = Math.abs(to - from) > 180 ? 1 : 0;
    const sweep = to > from ? 1 : 0;
    const s = to > from ? 1 : -1;
    const head = arrowHead(x1, y1, s * Math.cos(to * R), s * Math.sin(to * R), 11);
    const inner =
      `<path class="pcgt-arc" d="M${f1(x0)} ${f1(y0)} A${r} ${r} 0 ${large} ${sweep} ${f1(x1)} ${f1(y1)}"/>${head}` +
      `<g transform="translate(${cx} ${cy})"><g>` +
      `<animateTransform attributeName="transform" type="rotate" values="${from};${to};${to};${from}" keyTimes="0;.3;.62;1" calcMode="spline" keySplines=".55 0 .25 1;0 0 1 1;.45 0 .45 1" dur="1.9s" ${loop}/>` +
      `<g transform="translate(0 -66)">${PHONE}</g><g transform="translate(0 -40)">${FIST}</g></g></g>`;
    return svgWrap(dir < 0 ? `<g transform="translate(200 0) scale(-1 1)">${inner}</g>` : inner);
  },
  /** 낚싯대 던지기(뒤에서 앞으로) */
  cast() { return illustrations.swing({ from: -88, to: 28 }); },
  /** 핸들처럼 기울이기(가로로 쥔 폰을 좌우로) */
  tilt() {
    return svgWrap(
      `<path class="pcgt-arc" d="M52 40 A62 62 0 0 1 148 40"/>${arrowHead(148, 40, 0.7, 0.75)}${arrowHead(52, 40, -0.7, 0.75)}` +
      `<g transform="translate(100 92)"><g>` +
      `<animateTransform attributeName="transform" type="rotate" values="-24;24;-24" keyTimes="0;.5;1" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1" dur="2.6s" ${loop}/>` +
      `<g transform="rotate(90) scale(1.3)">${PHONE}</g>` +
      `<rect x="-60" y="-14" width="20" height="30" rx="9" class="pcgt-hand"/><rect x="40" y="-14" width="20" height="30" rx="9" class="pcgt-hand"/></g></g>`
    );
  },
  /** 화면 톡 누르기 */
  tap() {
    return svgWrap(
      `<g transform="translate(100 74) scale(1.5)">${PHONE}</g>` +
      `<circle cx="100" cy="80" r="6" class="pcgt-ripple"><animate attributeName="r" values="4;30" keyTimes="0;1" dur="1.2s" begin=".34s" ${loop}/><animate attributeName="opacity" values=".95;0" dur="1.2s" begin=".34s" ${loop}/></circle>` +
      `<g><animateTransform attributeName="transform" type="translate" values="10 -10;0 0;0 0;10 -10" keyTimes="0;.28;.5;1" dur="1.2s" ${loop}/>` +
      `<g transform="translate(100 80) rotate(-28)"><rect x="-9" y="0" width="18" height="78" rx="9" class="pcgt-hand"/><rect x="-6" y="3" width="12" height="12" rx="5" class="pcgt-nail"/></g></g>`
    );
  },
  /** 화면을 좌우로 쓸기(활 긋기 등) */
  swipe() {
    return svgWrap(
      `<g transform="translate(100 72) rotate(90) scale(1.6)">${PHONE}</g>` +
      `<path class="pcgt-trail" d="M64 72H136"/>${arrowHead(142, 72, 1, 0, 8)}${arrowHead(58, 72, -1, 0, 8)}` +
      `<g><animateTransform attributeName="transform" type="translate" values="-30 0;30 0;-30 0" keyTimes="0;.5;1" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1" dur="1.5s" ${loop}/>` +
      `<g transform="translate(100 74) rotate(-18)"><rect x="-9" y="0" width="18" height="78" rx="9" class="pcgt-hand"/><rect x="-6" y="3" width="12" height="12" rx="5" class="pcgt-nail"/></g></g>`
    );
  },
  /** 한 방향으로 휙(o.dir = up|down|left|right). 폰은 세워 쥔 그대로 움직입니다. 드럼·챔질·스텝 */
  flick(o = {}) {
    const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[o.dir || 'up'] || [0, -1];
    const [dx, dy] = d;
    const cx = 100, cy = 76; // 폰 가운데(주먹은 아래 26)
    const mv = 14;
    // 화살표: 움직이는 쪽 끝, 속도선: 반대쪽
    const ax = cx + dx * 64, ay = cy + 6 + dy * 76;
    const arrow = `<path class="pcgt-arrow" d="M${ax - dx * 18} ${ay - dy * 18}L${ax} ${ay}"/>${arrowHead(ax + dx * 2, ay + dy * 2, dx, dy, 10)}`;
    const sx = cx - dx * 58, sy = cy + 6 - dy * 64;
    const speed = dy !== 0
      ? `M${sx - 14} ${sy - 9}v18M${sx} ${sy - 13}v26M${sx + 14} ${sy - 9}v18`
      : `M${sx - 9} ${sy - 14}h18M${sx - 13} ${sy}h26M${sx - 9} ${sy + 14}h18`;
    return svgWrap(
      arrow +
      `<path class="pcgt-speed" d="${speed}"><animate attributeName="opacity" values="0;1;0;0" keyTimes="0;.14;.4;1" dur="1.3s" ${loop}/></path>` +
      `<g transform="translate(${cx} ${cy})"><g><animateTransform attributeName="transform" type="translate" values="${-dx * mv * 0.6} ${-dy * mv * 0.6};${dx * mv} ${dy * mv};${dx * mv} ${dy * mv};${-dx * mv * 0.6} ${-dy * mv * 0.6}" keyTimes="0;.14;.5;1" calcMode="spline" keySplines=".2 0 .2 1;0 0 1 1;.5 0 .5 1" dur="1.3s" ${loop}/>` +
      `${PHONE}<g transform="translate(0 26)">${FIST}</g></g></g>`
    );
  },
  /** 손목 비틀기(긴 축으로 돌리기) */
  twist() {
    return svgWrap(
      `<path class="pcgt-arc" d="M54 78 A46 13 0 0 1 146 78"/>` +
      `<g transform="translate(100 74)"><g><animateTransform attributeName="transform" type="scale" values="1 1;.18 1;1 1" keyTimes="0;.5;1" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1" dur="1.6s" ${loop}/>` +
      `<g transform="scale(1.3)">${PHONE}</g></g></g><g transform="translate(100 124)">${FIST}</g>` +
      `<path class="pcgt-arrow" d="M146 78 A46 13 0 0 1 58 84"/>${arrowHead(56, 82, -0.95, -0.3, 10)}`
    );
  },
  /** 큰 화면(TV)을 겨누기 */
  point() {
    return svgWrap(
      `<rect x="126" y="26" width="64" height="44" rx="5" class="pcgt-tv"/><path d="M158 70v10M145 82h26" class="pcgt-tvs"/>` +
      `<circle cx="158" cy="48" r="8" class="pcgt-arrow"><animate attributeName="r" values="7;10;7" dur="1.4s" ${loop}/></circle><path d="M158 36v6M158 54v6M146 48h6M164 48h6" class="pcgt-arrow"/>` +
      `<path class="pcgt-beam" d="M78 88L150 52"/>` +
      `<g transform="translate(50 104) rotate(64)">${PHONE}<g transform="translate(0 26)">${FIST}</g></g>`
    );
  },
  /** 폰 아래쪽(마이크)에 '후' 불기 */
  blow() {
    const wave = (y, d) => `<path class="pcgt-air" d="M86 ${y} q8 -6 16 0 t16 0 t16 0"><animate attributeName="stroke-dashoffset" values="40;0" dur="${d}s" ${loop}/></path>`;
    return svgWrap(
      `<circle cx="52" cy="78" r="30" class="pcgt-hand"/><ellipse cx="80" cy="84" rx="6" ry="7" class="pcgt-mouth"/><circle cx="58" cy="68" r="3" class="pcgt-eye"/>` +
      wave(72, 0.9) + wave(84, 0.75) + wave(96, 1.05) +
      `<g transform="translate(166 84) rotate(-90)">${PHONE}</g><circle cx="136" cy="84" r="3" class="pcgt-mic"/>`
    );
  },
  /** 4/4 지휘(아래·왼쪽·오른쪽·위) */
  conduct() {
    const path = 'M100 26 L100 118 L52 92 L150 92 L100 26';
    return svgWrap(
      `<path class="pcgt-trail" d="${path}"/>` +
      [[100, 132, '1'], [38, 96, '2'], [164, 96, '3'], [100, 16, '4']].map(([x, y, n]) => `<text x="${x}" y="${y}" class="pcgt-num" text-anchor="middle">${n}</text>`).join('') +
      `<circle r="7" class="pcgt-dot"><animateMotion dur="2.4s" ${loop} path="${path}" keyPoints="0;.281;.448;.747;1" keyTimes="0;.25;.5;.75;1" calcMode="linear"/></circle>`
    );
  },
  /** 큰 ✓ (마지막 화면) */
  check() {
    return svgWrap(`<circle cx="100" cy="80" r="52" class="pcgt-okc"/><path class="pcgt-okp" d="M76 82l16 16 34-36"/>`, 'pcgt-ok');
  }
};
// 다른 이름으로도
illustrations.still = illustrations.hold;
illustrations.grip = illustrations.hold;
illustrations.steer = illustrations.tilt;
illustrations.aim = illustrations.point;
illustrations.bow = illustrations.swipe;
illustrations.strike = (o) => illustrations.flick({ dir: 'down', ...o });
illustrations.lift = (o) => illustrations.flick({ dir: 'up', ...o });

function artFor(step) {
  const a = step.svg ?? step.art;
  if (!a) return '';
  if (typeof a === 'function') return a();
  const s = String(a).trim();
  if (s.startsWith('<')) return s;
  const fn = illustrations[s];
  return fn ? fn(step.svgOpts || {}) : '';
}

// ================================================================
// 화면
// ================================================================
const CSS = `
.pcgt{--pcgt-c:var(--c,#ff5a5f);--_sans:"Pretendard Variable",Pretendard,-apple-system,system-ui,sans-serif;
  position:fixed;inset:0;z-index:10050;display:flex;flex-direction:column;box-sizing:border-box;margin:0;
  padding:calc(env(safe-area-inset-top) + 12px) 20px calc(env(safe-area-inset-bottom) + 18px);overflow:hidden;
  background:radial-gradient(120% 55% at 50% 0%,color-mix(in srgb,var(--pcgt-c) 26%,transparent),transparent 70%),
    radial-gradient(90% 40% at 50% 100%,rgba(40,70,140,.28),transparent 70%),#0a1120;
  color:#f3f4f7;font-family:var(--_sans);font-size:16px;line-height:1.45;text-align:center;white-space:normal;
  -webkit-user-select:none;user-select:none;touch-action:manipulation;animation:pcgt-fade .3s ease-out;}
.pcgt.inline{position:absolute;}
.pcgt *{box-sizing:border-box;}
.pcgt [hidden]{display:none !important;}
.pcgt button{-webkit-tap-highlight-color:transparent;font-family:var(--_sans);}
.pcgt-top{flex:none;display:flex;align-items:center;gap:10px;height:40px;}
.pcgt-eyebrow{flex:1;text-align:left;font-size:12px;font-weight:800;letter-spacing:.16em;color:var(--pcgt-c);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pcgt-skip{appearance:none;margin:0;padding:8px 14px;border-radius:999px;border:1.5px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);
  color:#dfe6f0;font-size:14px;font-weight:800;cursor:pointer;}
.pcgt-dots{flex:none;display:flex;gap:6px;justify-content:center;margin:6px 0 0;}
.pcgt-dots i{display:block;width:22px;height:5px;border-radius:3px;background:rgba(255,255,255,.14);transition:background .3s,width .3s;}
.pcgt-dots i.d{background:color-mix(in srgb,var(--pcgt-c) 60%,transparent);}
.pcgt-dots i.c{background:var(--pcgt-c);width:34px;}
.pcgt-card{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:6px 0;}
.pcgt-card.enter{animation:pcgt-in .42s cubic-bezier(.2,1.2,.4,1);}
.pcgt-art{position:relative;flex:none;width:min(74vw,300px,34vh);aspect-ratio:200/160;display:grid;place-items:center;}
.pcgt-art::before{content:"";position:absolute;inset:6% 10%;border-radius:50%;background:radial-gradient(closest-side,color-mix(in srgb,var(--pcgt-c) 22%,transparent),transparent);}
.pcgt-svg{position:relative;width:100%;height:100%;overflow:visible;}
.pcgt-art.tappable{cursor:pointer;}
.pcgt-art.bad{animation:pcgt-shake .45s;}
.pcgt-ph{fill:#0b0f17;stroke:#fff;stroke-width:3;}
.pcgt-scr{fill:var(--pcgt-c);opacity:.42;}
.pcgt-spk{stroke:#fff;stroke-width:2;stroke-linecap:round;fill:none;}
.pcgt-hand{fill:#e2ae86;}
.pcgt-handl{stroke:#b9825c;stroke-width:1.6;stroke-linecap:round;fill:none;}
.pcgt-nail{fill:#f6d3b8;}
.pcgt-arc{fill:none;stroke:var(--pcgt-c);stroke-width:3.5;stroke-linecap:round;stroke-dasharray:3 9;}
.pcgt-arrow{fill:none;stroke:var(--pcgt-c);stroke-width:3.5;stroke-linecap:round;stroke-linejoin:round;}
.pcgt-ring{fill:none;stroke:var(--pcgt-c);stroke-width:2.5;}
.pcgt-ripple{fill:none;stroke:#fff;stroke-width:3;}
.pcgt-trail{fill:none;stroke:var(--pcgt-c);stroke-width:4;stroke-linecap:round;stroke-linejoin:round;opacity:.55;stroke-dasharray:2 10;}
.pcgt-speed{fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;opacity:.8;}
.pcgt-tv{fill:#141c2e;stroke:#fff;stroke-width:3;}
.pcgt-tvs{fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;}
.pcgt-beam{fill:none;stroke:var(--pcgt-c);stroke-width:3;stroke-linecap:round;stroke-dasharray:6 8;animation:pcgt-dash .8s linear infinite;}
.pcgt-air{fill:none;stroke:#bfe6ff;stroke-width:3;stroke-linecap:round;stroke-dasharray:14 6;}
.pcgt-mouth{fill:#5a2630;}
.pcgt-eye{fill:#2a1c18;}
.pcgt-mic{fill:var(--pcgt-c);}
.pcgt-num{fill:#cfd8e6;font:900 15px var(--_sans);}
.pcgt-dot{fill:var(--pcgt-c);}
.pcgt-okc{fill:var(--pcgt-c);opacity:.95;}
.pcgt-okp{fill:none;stroke:#0b0f17;stroke-width:11;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:80;stroke-dashoffset:80;animation:pcgt-draw .45s .12s ease-out forwards;}
.pcgt-ok{animation:pcgt-pop .5s cubic-bezier(.2,1.6,.4,1);}
.pcgt-burst{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;opacity:0;}
.pcgt-burst span{width:42%;aspect-ratio:1;border-radius:50%;display:grid;place-items:center;background:var(--pcgt-c);
  box-shadow:0 0 0 10px color-mix(in srgb,var(--pcgt-c) 25%,transparent),0 0 60px color-mix(in srgb,var(--pcgt-c) 60%,transparent);}
.pcgt-burst svg{width:58%;height:58%;fill:none;stroke:#0b0f17;stroke-width:5;stroke-linecap:round;stroke-linejoin:round;}
.pcgt-art.ok .pcgt-burst{animation:pcgt-burst 1s cubic-bezier(.2,1.4,.4,1) forwards;}
.pcgt-art.ok .pcgt-svg{opacity:.25;transition:opacity .2s;}
.pcgt-art.pip .pcgt-burst{animation:pcgt-pip .6s ease-out;}
.pcgt-num-step{font-family:Anton,Impact,sans-serif;font-size:14px;letter-spacing:.2em;color:#9aa8bf;margin:4px 0 0;}
.pcgt-title{margin:0;font-size:clamp(24px,7.6vw,32px);font-weight:900;letter-spacing:-.03em;line-height:1.2;color:#fff;}
.pcgt-body{margin:0;max-width:30em;font-size:16px;font-weight:600;color:#b9c4d6;line-height:1.5;white-space:pre-line;}
.pcgt-stage{width:100%;}
.pcgt-stage:empty{display:none;}
.pcgt-status{display:flex;align-items:center;justify-content:center;gap:10px;min-height:44px;margin-top:4px;}
.pcgt-wait{display:inline-flex;align-items:center;gap:9px;padding:9px 16px;border-radius:999px;background:rgba(255,255,255,.07);
  border:1.5px solid color-mix(in srgb,var(--pcgt-c) 55%,transparent);font-size:15px;font-weight:800;color:#fff;}
.pcgt-wait i{width:9px;height:9px;border-radius:50%;background:var(--pcgt-c);box-shadow:0 0 0 0 var(--pcgt-c);animation:pcgt-ping 1.2s infinite;}
.pcgt-cnt{font-family:Anton,Impact,sans-serif;font-size:18px;letter-spacing:.06em;color:var(--pcgt-c);}
.pcgt-good{display:inline-flex;align-items:center;gap:8px;font-size:20px;font-weight:900;color:#7ef0a0;animation:pcgt-pop .4s cubic-bezier(.2,1.6,.4,1);}
.pcgt-msg{min-height:22px;font-size:14.5px;font-weight:700;color:#ffcf8a;}
.pcgt-msg.ok{color:#7ef0a0;}
.pcgt-bottom{flex:none;display:flex;flex-direction:column;align-items:center;gap:8px;min-height:56px;justify-content:flex-end;}
.pcgt-next{appearance:none;width:100%;max-width:420px;margin:0;padding:18px;border:0;border-radius:18px;background:var(--pcgt-c);color:#0b0f17;
  font-size:20px;font-weight:900;cursor:pointer;box-shadow:0 10px 30px color-mix(in srgb,var(--pcgt-c) 30%,transparent);}
.pcgt-next:active{transform:scale(.98);}
.pcgt-help{appearance:none;margin:0;padding:8px 12px;border:0;background:none;color:#9aa8bf;font-size:14px;font-weight:700;text-decoration:underline;text-underline-offset:3px;cursor:pointer;}
.pcgt-help.show{animation:pcgt-fade .4s;}
.pcgt-sim{appearance:none;margin:0;padding:6px 12px;border-radius:10px;border:1px dashed rgba(255,255,255,.3);background:none;color:#9aa8bf;font:700 12px ui-monospace,monospace;cursor:pointer;}
.pcgt-link{appearance:none;display:inline-flex;align-items:center;gap:6px;margin:4px auto 0;padding:8px 12px;border:0;background:none;
  color:#9aa8bf;font:700 14px/1.2 "Pretendard Variable",Pretendard,system-ui,sans-serif;text-decoration:underline;text-underline-offset:3px;cursor:pointer;-webkit-tap-highlight-color:transparent;}
.pcgt-link svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;}
.pcgt-link[hidden]{display:none;}
@media (orientation:landscape) and (max-height:540px){
  .pcgt{padding:calc(env(safe-area-inset-top) + 8px) calc(env(safe-area-inset-right) + 22px) calc(env(safe-area-inset-bottom) + 10px) calc(env(safe-area-inset-left) + 22px);}
  .pcgt-card{display:grid;grid-template-columns:auto 1fr;grid-auto-rows:min-content;align-content:center;column-gap:26px;row-gap:6px;text-align:left;}
  .pcgt-art{grid-row:1/span 6;width:min(40vw,46vh*1.25,300px);}
  .pcgt-card > :not(.pcgt-art){grid-column:2;}
  .pcgt-status{justify-content:flex-start;}
  .pcgt-bottom{flex-direction:row;justify-content:flex-end;min-height:0;}
  .pcgt-next{width:auto;padding:12px 30px;font-size:17px;}
}
@keyframes pcgt-fade{from{opacity:0;}}
@keyframes pcgt-in{from{opacity:0;transform:translateX(26px);}}
@keyframes pcgt-pop{0%{transform:scale(.6);opacity:0;}100%{transform:none;opacity:1;}}
@keyframes pcgt-burst{0%{opacity:0;transform:scale(.4);}35%{opacity:1;transform:scale(1.08);}55%{transform:none;}100%{opacity:1;}}
@keyframes pcgt-pip{0%{opacity:0;transform:scale(.5);}40%{opacity:.9;transform:scale(1);}100%{opacity:0;transform:scale(1.15);}}
@keyframes pcgt-ping{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--pcgt-c) 70%,transparent);}100%{box-shadow:0 0 0 12px transparent;}}
@keyframes pcgt-shake{0%,100%{transform:none;}20%{transform:translateX(-9px);}40%{transform:translateX(8px);}60%{transform:translateX(-5px);}80%{transform:translateX(3px);}}
@keyframes pcgt-dash{to{stroke-dashoffset:-28;}}
@keyframes pcgt-draw{to{stroke-dashoffset:0;}}
`;
function injectCss() {
  if (document.getElementById('pcg-tutorial-css')) return;
  const s = document.createElement('style');
  s.id = 'pcg-tutorial-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}
const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const REDO_SVG = '<svg viewBox="0 0 20 20"><path d="M4 10a6 6 0 1 0 2-4.5"/><path d="M4 3v3.5h3.5"/></svg>';

/**
 * 튜토리얼 만들기.
 * opts: { key, steps, socket?, send?(event, data), color?, title?, onStep?(i, step), onDone?(result), helpAfterMs = 9000,
 *         finish?: { title, body, button } }
 * step: { title, body?, svg?: 이름|SVG문자열|함수, svgOpts?, waitFor?: '이름'|['이름',..]|'tap'|null, check?(data) → true|false|'안내'|{ok,msg},
 *         count? = 1, hint? = '해 보세요' 대신 쓸 말, okText? = '좋아요!', render?(stageEl, api) → 정리 함수, next? = '다음' }
 */
export function createTutorial(opts = {}) {
  const key = String(opts.key || 'game');
  const STORE = `pcg-tut-${key}`;
  const steps = (opts.steps || []).filter(Boolean);
  const helpAfter = opts.helpAfterMs ?? 9000;
  let socket = opts.socket || null;
  let color = opts.color || null;
  let running = null; // { i, root, resolve, step, need, got, busy, timers[] , cleanup }
  const links = new Set();

  // 진행 상황 보내기. 아직 자리를 못 받았거나(시작하자마자 연습) 다시 붙은 경우를 위해 마지막 것을 기억했다가
  // 'assigned' 때 다시 보냅니다.
  let lastReport = null;
  function sendReport(d) {
    if (typeof opts.send === 'function') { try { opts.send('tutorial', d); } catch (e) {} return; }
    if (socket && socket.connected) socket.emit('c2d', { event: 'tutorial', data: d });
  }
  function report(data) {
    const d = { key, total: steps.length, ...data };
    lastReport = d;
    sendReport(d);
  }
  let hooked = null;
  function hook(sock) {
    if (!sock || hooked === sock || typeof sock.on !== 'function') return;
    hooked = sock;
    const again = () => { if (running && lastReport) setTimeout(() => running && sendReport(lastReport), 60); };
    sock.on('assigned', again);
    // 큰 화면이 새로고침되면 판이 비므로 지금 단계를 다시 알려 줍니다.
    sock.on('display_status', (d) => { if (d && d.connected) again(); });
  }
  hook(socket);

  function firstTime() {
    if (FORCE === '1') return true;
    if (FORCE === '0') return false;
    try { return !localStorage.getItem(STORE); } catch (e) { return false; }
  }
  function markDone(skipped = false) {
    try { localStorage.setItem(STORE, JSON.stringify({ at: Date.now(), skipped: Boolean(skipped) })); } catch (e) {}
  }
  function reset() { try { localStorage.removeItem(STORE); } catch (e) {} }

  // ---------- 진행 ----------
  function run(el, ro = {}) {
    if (running) return running.promise;
    injectCss();
    try { haptics.unlock(); } catch (e) {}
    const root = document.createElement('div');
    root.className = 'pcgt' + (ro.inline ? ' inline' : '');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', '튜토리얼');
    if (color) root.style.setProperty('--pcgt-c', color);
    root.innerHTML =
      `<div class="pcgt-top"><div class="pcgt-eyebrow">${esc(opts.title || '처음이라 연습해 봐요')}</div><button type="button" class="pcgt-skip">건너뛰기</button></div>` +
      `<div class="pcgt-dots">${steps.map(() => '<i></i>').join('')}</div>` +
      `<div class="pcgt-card"></div><div class="pcgt-bottom"></div>`;
    (el || document.body).appendChild(root);
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    running = { i: -1, root, resolve, promise, timers: [], cleanup: null, step: null };
    root.querySelector('.pcgt-skip').addEventListener('click', () => finish(true));
    if (!steps.length) finish(false);
    else go(0);
    paintLinks();
    return promise;
  }

  function clearTimers() {
    if (!running) return;
    for (const t of running.timers) clearTimeout(t);
    running.timers = [];
    if (typeof running.cleanup === 'function') { try { running.cleanup(); } catch (e) {} }
    running.cleanup = null;
  }
  function later(fn, ms) { if (running) running.timers.push(setTimeout(fn, ms)); }

  function go(i) {
    const r = running;
    if (!r) return;
    clearTimers();
    if (i >= steps.length) { showFinish(); return; }
    const step = steps[i];
    r.i = i;
    r.step = step;
    r.need = Math.max(1, step.count || 1);
    r.got = 0;
    r.busy = false;
    const waits = step.waitFor == null || step.waitFor === 'next' ? [] : [].concat(step.waitFor);
    r.waits = waits;
    r.dots = [...r.root.querySelectorAll('.pcgt-dots i')];
    r.dots.forEach((d, k) => { d.className = k < i ? 'd' : k === i ? 'c' : ''; });
    const card = r.root.querySelector('.pcgt-card');
    const art = artFor(step);
    const manual = !waits.length;
    card.className = 'pcgt-card';
    void card.offsetWidth;
    card.classList.add('enter');
    card.innerHTML =
      (art ? `<div class="pcgt-art${waits.includes('tap') ? ' tappable' : ''}">${art}<div class="pcgt-burst"><span>${CHECK_SVG}</span></div></div>` : '') +
      `<div class="pcgt-num-step">STEP ${i + 1} / ${steps.length}</div>` +
      `<h2 class="pcgt-title">${esc(step.title)}</h2>` + (step.body ? `<p class="pcgt-body">${esc(step.body)}</p>` : '') +
      `<div class="pcgt-stage"></div>` +
      (manual ? '' : `<div class="pcgt-status"><span class="pcgt-wait"><i></i>${esc(step.hint || '해 보세요')}</span>${r.need > 1 ? `<span class="pcgt-cnt">0/${r.need}</span>` : ''}</div>`) +
      `<div class="pcgt-msg"></div>`;
    const bottom = r.root.querySelector('.pcgt-bottom');
    bottom.innerHTML = (manual ? `<button type="button" class="pcgt-next">${esc(step.next || '다음')}</button>` : '') +
      (!manual ? `<button type="button" class="pcgt-help" hidden>잘 안 되면 넘어가기 →</button>` : '') +
      (DEBUG && !manual ? '<button type="button" class="pcgt-sim">시험: 성공 처리</button>' : '');
    const next = bottom.querySelector('.pcgt-next');
    if (next) next.addEventListener('click', () => { try { haptics.tick({ noFlash: true }); } catch (e) {} go(i + 1); });
    const help = bottom.querySelector('.pcgt-help');
    if (help) {
      help.addEventListener('click', () => go(i + 1));
      if (helpAfter > 0) later(() => { help.hidden = false; help.classList.add('show'); }, helpAfter);
    }
    const sim = bottom.querySelector('.pcgt-sim');
    if (sim) sim.addEventListener('click', () => succeed(null, true));
    if (waits.includes('tap')) {
      const tapTarget = card.querySelector('.pcgt-art') || card;
      tapTarget.addEventListener('pointerdown', (e) => { e.preventDefault(); signal('tap', { x: e.clientX, y: e.clientY }); });
    }
    if (typeof step.render === 'function') {
      try {
        r.cleanup = step.render(card.querySelector('.pcgt-stage'), {
          ok: (msg) => succeed(msg == null ? null : { ok: true, msg }),
          fail: (msg) => failed(msg),
          signal,
          step: i,
          root: r.root
        }) || null;
      } catch (e) { console.error('[tutorial render]', e); }
    }
    report({ step: i + 1, title: step.title, done: false });
    if (typeof opts.onStep === 'function') { try { opts.onStep(i, step); } catch (e) {} }
  }

  function setMsg(text, ok) {
    const m = running && running.root.querySelector('.pcgt-msg');
    if (!m) return;
    m.textContent = text || '';
    m.classList.toggle('ok', Boolean(ok));
  }

  function failed(msg) {
    const r = running;
    if (!r || r.busy) return;
    setMsg(msg || '조금만 다르게 해 볼까요?', false);
    const art = r.root.querySelector('.pcgt-art');
    if (art) {
      art.classList.remove('bad');
      void art.offsetWidth;
      art.classList.add('bad');
    }
    try { haptics.play('warn', 0.5); } catch (e) {}
  }

  function succeed(res, forced) {
    const r = running;
    if (!r || r.busy || r.i < 0) return;
    const msg = res && typeof res === 'object' ? res.msg : typeof res === 'string' ? res : null;
    r.got += 1;
    const art = r.root.querySelector('.pcgt-art');
    const cnt = r.root.querySelector('.pcgt-cnt');
    if (cnt) cnt.textContent = `${Math.min(r.got, r.need)}/${r.need}`;
    if (r.got < r.need && !forced) {
      // 여러 번 해야 하는 단계: 작은 ✓ 만
      if (art) { art.classList.remove('pip'); void art.offsetWidth; art.classList.add('pip'); }
      setMsg(msg || `좋아요! ${r.need - r.got}번 더`, true);
      try { haptics.hit(0.6); } catch (e) {}
      return;
    }
    r.busy = true;
    if (art) art.classList.add('ok');
    const st = r.root.querySelector('.pcgt-status');
    if (st) st.innerHTML = `<span class="pcgt-good">✓ ${esc(r.step.okText || '좋아요!')}</span>`;
    setMsg(msg || '', true);
    const help = r.root.querySelector('.pcgt-help');
    if (help) help.hidden = true;
    try { haptics.success(); } catch (e) {}
    const i = r.i;
    later(() => go(i + 1), opts.advanceMs ?? 1100);
  }

  /** 종목 감지기가 부릅니다. 지금 단계가 이 신호를 기다리면 판정하고 true 를 돌려줍니다. */
  function signal(name, data) {
    const r = running;
    if (!r || r.busy || !r.step || !r.waits || !r.waits.includes(name)) return false;
    let res = true;
    if (typeof r.step.check === 'function') {
      try { res = r.step.check(data, name); } catch (e) { res = false; }
    }
    if (res === true || (res && typeof res === 'object' && res.ok)) succeed(res);
    else if (typeof res === 'string') failed(res);
    else if (res && typeof res === 'object') failed(res.msg);
    else failed(null);
    return true;
  }

  function showFinish() {
    const r = running;
    if (!r) return;
    clearTimers();
    r.i = steps.length;
    r.step = null;
    r.busy = false;
    r.dots.forEach((d) => { d.className = 'd'; });
    const f = opts.finish || {};
    const card = r.root.querySelector('.pcgt-card');
    card.className = 'pcgt-card';
    void card.offsetWidth;
    card.classList.add('enter');
    card.innerHTML = `<div class="pcgt-art">${illustrations.check()}</div>` +
      `<div class="pcgt-num-step">DONE</div><h2 class="pcgt-title">${esc(f.title || '연습 끝!')}</h2>` +
      `<p class="pcgt-body">${esc(f.body || '이제 준비를 누르면 돼요.\n다시 하고 싶으면 ‘튜토리얼 다시 하기’를 눌러요.')}</p>`;
    r.root.querySelector('.pcgt-bottom').innerHTML = `<button type="button" class="pcgt-next">${esc(f.button || '좋아요')}</button>`;
    r.root.querySelector('.pcgt-next').addEventListener('click', () => finish(false));
    r.root.querySelector('.pcgt-skip').hidden = true;
    markDone(false);
    report({ step: steps.length, title: '연습 끝', done: true });
    try { haptics.success(); } catch (e) {}
  }

  function finish(skipped) {
    const r = running;
    if (!r) return;
    clearTimers();
    const completed = r.i >= steps.length;
    if (skipped && !completed) {
      markDone(true);
      report({ step: Math.max(1, r.i + 1), title: '건너뜀', done: true, skipped: true });
    }
    running = null;
    r.root.style.transition = 'opacity .22s';
    r.root.style.opacity = '0';
    setTimeout(() => r.root.remove(), 230);
    const result = { completed, skipped: Boolean(skipped) && !completed };
    paintLinks();
    if (typeof opts.onDone === 'function') { try { opts.onDone(result); } catch (e) {} }
    r.resolve(result);
  }

  /** 연습 중이면 닫습니다(기록하지 않음). */
  function cancel() {
    const r = running;
    if (!r) return;
    clearTimers();
    running = null;
    r.root.remove();
    report({ step: Math.max(1, r.i + 1), title: '그만둠', done: true, skipped: true });
    paintLinks();
    r.resolve({ completed: false, skipped: true, cancelled: true });
  }

  // ---------- "튜토리얼 다시 하기" ----------
  function paintLinks() { for (const l of links) l.hidden = Boolean(running) || l.dataset.off === '1'; }
  /** 대기 화면에 붙이는 작은 링크. 누르면 run() 합니다. 반환: 링크 요소(setVisible 로 숨기기) */
  function link(container, lo = {}) {
    injectCss();
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pcgt-link';
    b.innerHTML = `${REDO_SVG}<span>${esc(lo.label || '튜토리얼 다시 하기')}</span>`;
    b.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof lo.before === 'function' && lo.before() === false) return;
      run(lo.mount || null, lo);
    });
    links.add(b);
    paintLinks();
    if (container) container.appendChild(b);
    return b;
  }

  const api = {
    key,
    steps,
    firstTime,
    run,
    signal,
    /** 지금 단계를 성공으로(종목이 직접 판정했을 때) */
    ok: (msg) => succeed(msg == null ? null : { ok: true, msg }),
    /** 지금 단계 실패 안내 */
    fail: (msg) => failed(msg),
    /** 시험용: 지금 단계를 성공 처리 */
    simulate: () => succeed(null, true),
    next: () => running && running.i < steps.length && go(running.i + 1),
    skip: () => finish(true),
    cancel,
    reset,
    markDone,
    link,
    setLinkVisible(on) { for (const l of links) l.dataset.off = on ? '0' : '1'; paintLinks(); },
    isRunning: () => Boolean(running),
    current: () => (running && running.step ? { index: running.i, ...running.step } : null),
    setSocket(s) { socket = s; hook(s); },
    /** 마지막 진행 상황을 다시 보냅니다(종목이 send 를 직접 줄 때 다시 연결된 뒤 부르면 됨) */
    resend() { if (running && lastReport) sendReport(lastReport); },
    setColor(c) { color = c; if (running && c) running.root.style.setProperty('--pcgt-c', c); }
  };
  window.PCG = window.PCG || {};
  window.PCG.tutorials = window.PCG.tutorials || {};
  window.PCG.tutorials[key] = api;
  return api;
}

export default createTutorial;
