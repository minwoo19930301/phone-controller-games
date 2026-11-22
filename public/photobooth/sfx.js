// 네컷 사진관 큰 화면 소리: 실제 녹음(/common/samples.js)을 틀고, 못 받았을 때만 예전 합성음을 냅니다.
// 카운트다운 삐-삐-삐, 셔터 찰칵, 사진 내려앉는 소리, 완성 팡파르. 합성음은 대체용으로만 남겨 둡니다.
// 큰 화면은 클릭 없이 폰으로만 시작되는 일이 많아서, 어떤 키·포인터·터치 입력에도 소리를 켜고
// 대기실에는 "화면을 한 번 눌러 소리 켜기" 칩을 소리가 켜질 때까지 보여 줍니다.
import { bell, marimba, grit, modal } from '/common/voice.js';
import { createSamples } from '/common/samples.js';

let ctx = null;
let master = null;
let samples = null;
// 시험용: 어떤 녹음이 몇 번 불렸는지(합성 대체음은 fallback 에 셉니다)
const dbg = (window.__photoboothSfx = { played: {}, fallback: {} });
const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

function init() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { ctx = new AC(); } catch (e) { return null; }
  master = ctx.createDynamicsCompressor();
  master.threshold.value = -14;
  master.ratio.value = 5;
  const g = ctx.createGain();
  g.gain.value = 0.9;
  master.connect(g).connect(ctx.destination);
  samples = createSamples(ctx, master);
  // 대기실에서 이 종목이 쓰는 녹음만 미리 받습니다(디코딩은 소리가 잠겨 있어도 됩니다)
  samples.preload(PRELOAD);
  ctx.addEventListener('statechange', syncChip);
  return ctx;
}
// 쓰는 녹음 이름(앞머리). ui/beep 은 ui/beep-high 도 함께 받습니다.
const PRELOAD = ['ui/shutter', 'ui/beep', 'ui/whoosh-ui', 'ui/click', 'ui/ding', 'ui/success', 'ui/party-horn', 'ui/countdown-tick', 'kart/item-pickup', 'crowd/cheer-small'];

export function audio() {
  init();
  if (ctx && ctx.state === 'suspended') ctx.resume().then(syncChip, () => {});
  return ctx;
}
const on = () => ctx && ctx.state === 'running';
for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'click', 'mousedown']) {
  window.addEventListener(ev, () => { audio(); syncChip(); }, { capture: true, passive: true });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) audio(); });

// 소리가 잠겨 있는 동안 대기실에 작게 보이는 안내 칩
let chip = null;
function syncChip() {
  const locked = !ctx || ctx.state !== 'running';
  if (locked && !chip) {
    const host = document.getElementById('lobby');
    if (!host) return;
    chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'sound-chip';
    chip.textContent = '화면을 한 번 눌러 소리 켜기';
    chip.addEventListener('click', () => audio());
    host.appendChild(chip);
  } else if (!locked && chip) {
    chip.remove();
    chip = null;
  }
}
init();
syncChip();
setInterval(syncChip, 800); // 상태 변화 이벤트를 놓치는 브라우저 대비

/** 녹음을 틉니다. 못 틀었으면 false(→ 호출한 쪽이 합성음을 냄). */
function rec(name, opts) {
  if (!on() || !samples) return false;
  const ok = samples.play(name, opts);
  if (ok) bump(dbg.played, name);
  return ok;
}
const fb = (name) => bump(dbg.fallback, name);
// 소리 확인용: 이름이 받아졌는지
export const has = (name) => Boolean(samples && samples.has(name));
window.__photoboothSfx.has = has;
window.__photoboothSfx.ctx = () => ctx; // 시험용(소리 잠금 칩 확인)

const hz = (semi) => 440 * Math.pow(2, (semi - 9) / 12); // 0 = C4 근처

let lastPop = 0;
export const sfx = {
  /** 3·2·1 (n=3,2,1). 마지막은 더 높은 삐 */
  count(n) {
    if (!on()) return;
    if (rec(n <= 1 ? 'ui/beep-high' : 'ui/beep', { gain: n <= 1 ? 1 : 0.9, jitter: 0.01 })) return;
    fb('count');
    const f = n <= 1 ? 1318.5 : 987.8;
    bell(ctx, master, f, { gain: 0.16, sec: 0.5, ratio: 2, depth: 0.8 });
    modal(ctx, master, [[f / 2, 0.4, 0.12]], { gain: 0.25 });
  },
  /** 찰칵: 실제 셔터 두 벌을 돌아가며 */
  shutter() {
    if (!on()) return;
    if (rec('ui/shutter', { gain: 1, jitter: 0.03 })) return;
    fb('shutter');
    grit(ctx, master, { sec: 0.025, freq: 4200, q: 0.9, gain: 0.55 });
    grit(ctx, master, { sec: 0.05, freq: 1800, q: 1.4, gain: 0.35, when: 0.055 });
    modal(ctx, master, [[150, 1, 0.09], [420, 0.3, 0.05]], { gain: 0.35, when: 0.01 });
    grit(ctx, master, { sec: 0.14, freq: 900, q: 0.6, type: 'lowpass', gain: 0.12, when: 0.08, sweep: 3000 });
  },
  /** 사진이 칸에 내려앉음: 가벼운 휙 + 톡. 칸마다 조금씩 높아짐 */
  land(i = 0) {
    if (!on()) return;
    const up = 1 + 0.05 * (i % 4);
    if (rec('ui/whoosh-ui', { gain: 0.55, rate: up })) { rec('ui/click', { gain: 0.5, rate: up, when: 0.12 }); return; }
    fb('land');
    grit(ctx, master, { sec: 0.12, freq: 2400, q: 0.5, gain: 0.12, sweep: 800 });
    marimba(ctx, master, hz(12 + [0, 4, 7, 12][i % 4]), { gain: 0.22, when: 0.04 });
  },
  /** 누가 들어옴: 작은 딩 */
  join() {
    if (!on()) return;
    if (rec('ui/ding', { gain: 0.45, rate: 1.25 })) return;
    fb('join');
    marimba(ctx, master, hz(19), { gain: 0.18 });
    marimba(ctx, master, hz(24), { gain: 0.18, when: 0.09 });
  },
  /** 컷·미션 알림: 휙 + 딩 */
  cue() {
    if (!on()) return;
    if (rec('ui/whoosh-ui', { gain: 0.4 })) { rec('ui/ding', { gain: 0.3, rate: 1.5, when: 0.1 }); return; }
    fb('cue');
    bell(ctx, master, hz(16), { gain: 0.09, sec: 0.8 });
    bell(ctx, master, hz(23), { gain: 0.07, sec: 0.9, when: 0.07 });
  },
  /** 스티커 톡: 봇·폰이 한꺼번에 붙여도 시끄럽지 않게 60ms 이내 중복은 건너뜀 */
  pop() {
    if (!on()) return;
    const now = performance.now();
    if (now - lastPop < 60) return;
    lastPop = now;
    if (rec('kart/item-pickup', { gain: 0.6, rate: 0.9 + Math.random() * 0.3 })) return;
    fb('pop');
    modal(ctx, master, [[880, 0.6, 0.07], [1760, 0.2, 0.04]], { gain: 0.12, drop: 0.25 });
  },
  /** 다 찍음(final=false): 가벼운 차임 / 최종 완성(final=true): 차임 + 환호 + 파티 나팔 */
  done(final = false) {
    if (!on()) return;
    if (rec('ui/success', { gain: final ? 1 : 0.8, jitter: 0.01 })) {
      if (final) {
        rec('crowd/cheer-small', { gain: 0.55, when: 0.25 });
        rec('ui/party-horn', { gain: 0.35, when: 0.1 });
      }
      return;
    }
    fb('done');
    [0, 4, 7, 12, 16].forEach((s, i) => bell(ctx, master, hz(12 + s), { gain: 0.1, sec: 1.4, when: i * 0.08 }));
  },
  /** 시간 끝 다가옴: 시계 똑 */
  tick() {
    if (!on()) return;
    if (rec('ui/countdown-tick', { gain: 0.7, jitter: 0.02 })) return;
    fb('tick');
    modal(ctx, master, [[1500, 0.5, 0.04]], { gain: 0.12 });
  }
};
