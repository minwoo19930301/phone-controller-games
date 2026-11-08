// 네컷 사진관 큰 화면 소리: 카운트다운 삐-삐-삐, 셔터 찰칵, 사진 내려앉는 소리, 완성 종소리.
// 성격: 맑은 종(글로켄)과 기계식 셔터. 첫 클릭·키 입력 때 소리가 열립니다.
import { bell, marimba, grit, modal } from '/common/voice.js';

let ctx = null;
let master = null;
export function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createDynamicsCompressor();
    master.threshold.value = -14;
    master.ratio.value = 5;
    const g = ctx.createGain();
    g.gain.value = 0.9;
    master.connect(g).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
const on = () => ctx && ctx.state === 'running';
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => audio(), { capture: true, passive: true });

const hz = (semi) => 440 * Math.pow(2, (semi - 9) / 12); // 0 = C4 근처

export const sfx = {
  /** 3·2·1 (n=3,2,1). 마지막은 한 음 높게 */
  count(n) {
    if (!on()) return;
    const f = n <= 1 ? 1318.5 : 987.8;
    bell(ctx, master, f, { gain: 0.16, sec: 0.5, ratio: 2, depth: 0.8 });
    modal(ctx, master, [[f / 2, 0.4, 0.12]], { gain: 0.25 });
  },
  /** 찰칵: 날카로운 셔터 + 거울 올라가는 소리 + 낮은 쿵 */
  shutter() {
    if (!on()) return;
    grit(ctx, master, { sec: 0.025, freq: 4200, q: 0.9, gain: 0.55 });
    grit(ctx, master, { sec: 0.05, freq: 1800, q: 1.4, gain: 0.35, when: 0.055 });
    modal(ctx, master, [[150, 1, 0.09], [420, 0.3, 0.05]], { gain: 0.35, when: 0.01 });
    grit(ctx, master, { sec: 0.14, freq: 900, q: 0.6, type: 'lowpass', gain: 0.12, when: 0.08, sweep: 3000 });
  },
  /** 사진이 칸에 내려앉음 */
  land(i = 0) {
    if (!on()) return;
    grit(ctx, master, { sec: 0.12, freq: 2400, q: 0.5, gain: 0.12, sweep: 800 });
    marimba(ctx, master, hz(12 + [0, 4, 7, 12][i % 4]), { gain: 0.22, when: 0.04 });
  },
  /** 누가 들어옴 */
  join() {
    if (!on()) return;
    marimba(ctx, master, hz(19), { gain: 0.18 });
    marimba(ctx, master, hz(24), { gain: 0.18, when: 0.09 });
  },
  /** 컷·미션 알림 */
  cue() {
    if (!on()) return;
    bell(ctx, master, hz(16), { gain: 0.09, sec: 0.8 });
    bell(ctx, master, hz(23), { gain: 0.07, sec: 0.9, when: 0.07 });
  },
  /** 스티커 톡 */
  pop() {
    if (!on()) return;
    modal(ctx, master, [[880, 0.6, 0.07], [1760, 0.2, 0.04]], { gain: 0.12, drop: 0.25 });
  },
  /** 다 찍음·완성 */
  done() {
    if (!on()) return;
    [0, 4, 7, 12, 16].forEach((s, i) => bell(ctx, master, hz(12 + s), { gain: 0.1, sec: 1.4, when: i * 0.08 }));
  },
  /** 시간 끝 다가옴 */
  tick() {
    if (!on()) return;
    modal(ctx, master, [[1500, 0.5, 0.04]], { gain: 0.12 });
  }
};
