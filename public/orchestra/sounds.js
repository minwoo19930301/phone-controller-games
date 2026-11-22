// 오케스트라 실제 녹음 소리: 공용 라이브러리(/common/sfx)의 타악기·박수 녹음을 틀고, 못 받았으면 예전 합성음으로 되돌아갑니다.
// 큰 화면(game.js)과 폰(controller.js)이 같이 씁니다. 악기 하나를 감싸 play(midi) 가 녹음을 먼저 시도하게 만듭니다.
import { createSamples } from '/common/samples.js';
import { SFX } from '/common/sfx/manifest.js';

// 시험용 카운터: window.__orchestraSfx.played[이름] = 튼 횟수, missed[이름] = 못 받아서 합성음으로 넘긴 횟수
const G = typeof window !== 'undefined' ? window : globalThis;
export const stats = (G.__orchestraSfx = G.__orchestraSfx || { played: {}, missed: {} });
const bump = (k, n) => { stats[k][n] = (stats[k][n] || 0) + 1; };

// GM 타악기 번호 → [녹음 이름, 속도(음높이), 기본 세기]. 녹음은 모두 거의 꽉 찬 크기라 종류마다 낮춰 곡 소리 위에 얹습니다.
export const KIT = {
  35: ['perc/kick', 1, 0.8], 36: ['perc/kick', 1, 0.8],
  37: ['perc/snare-rim', 1, 0.55],
  38: ['perc/snare', 1, 0.6], 40: ['perc/snare', 1.06, 0.6],
  39: ['perc/clap', 1, 0.5],
  42: ['perc/hat-closed', 1, 0.35], 44: ['perc/hat-closed', 0.94, 0.3],
  46: ['perc/hat-open', 1, 0.3],
  41: ['perc/tom-low', 0.85, 0.55], 43: ['perc/tom-low', 0.95, 0.55], 45: ['perc/tom-low', 1.05, 0.55],
  47: ['perc/tom-high', 0.85, 0.55], 48: ['perc/tom-high', 1, 0.55], 50: ['perc/tom-high', 1.15, 0.55],
  49: ['perc/crash', 1, 0.35], 55: ['perc/crash', 1.1, 0.3], 57: ['perc/crash', 0.92, 0.35],
  51: ['perc/ride', 1, 0.5], 59: ['perc/ride', 0.92, 0.5],
  54: ['perc/tambourine', 1, 0.4],
  80: ['perc/triangle', 1.12, 0.3], 81: ['perc/triangle', 1, 0.3],
  76: ['perc/woodblock', 1.12, 0.7], 77: ['perc/woodblock', 1, 0.6],
  85: ['perc/castanet', 1, 0.55],
};
const CAST_GAIN = 0.55;

// 큰 화면이 미리 받아 둘 것(대기실에서). 폰은 고른 악기에 따라 1~3개만.
export const BIG_NAMES = [...new Set([...Object.values(KIT).map((k) => k[0]), 'crowd/applause-long', 'crowd/cheer-small'])];
export const PHONE_NAMES = {
  drum: ['perc/snare', 'perc/kick', 'perc/crash'],
  castanets: ['perc/castanet'],
  conductor: ['perc/woodblock'],
};

const subset = (names) => Object.fromEntries(names.filter((n) => SFX[n]).map((n) => [n, SFX[n]]));

/** 이름 목록만 아는 재생기(그 밖의 이름은 못 튼 것으로 쳐서 합성음으로 넘어감). 만들자마자 미리 받기 시작합니다. */
export function makeSfx(ctx, dest, names) {
  const sfx = createSamples(ctx, dest, { manifest: subset(names) });
  const loading = sfx.preload();
  return Object.assign(sfx, { loading });
}

const velGain = (vel) => Math.pow(0.25 + 0.75 * Math.min(1, Math.max(0, vel)), 1.3);

/**
 * 타악기(drums)·캐스터네츠 악기의 play 를 녹음 우선으로 바꿉니다. 악기를 만든 곳(큰 화면 반주·폰·녹화 길)이 그대로 쓰면 됩니다.
 * 녹음은 악기의 출력 노드로 들어가므로 악기 크기·자리(좌우)·잔향이 합성음과 똑같이 따라옵니다.
 * names: 이 악기가 쓸 녹음 이름(폰은 일부만). 없으면 가능한 전부.
 */
export function sampleKit(inst, names = BIG_NAMES) {
  if (!inst || (inst.name !== 'drums' && inst.name !== 'castanets')) return inst;
  const sfx = makeSfx(inst.ctx, inst.out, names);
  const base = inst.play;
  const isCast = inst.name === 'castanets';
  inst.play = function play(midi, o = {}) {
    let name, rate, g;
    if (isCast) { name = 'perc/castanet'; rate = Math.pow(2, (((midi % 12) + 12) % 12 - 6) / 48); g = CAST_GAIN; }
    else { const k = KIT[midi]; if (k) [name, rate, g] = k; }
    if (name) {
      const delay = o.when != null ? Math.max(0, o.when - inst.ctx.currentTime) : 0;
      if (sfx.play(name, { gain: g * velGain(o.vel ?? 0.8), rate, when: delay })) { bump('played', name); return null; }
      bump('missed', name);
    }
    return base.call(inst, midi, o);
  };
  inst.sfx = sfx;
  return inst;
}

/** 소리 켜기 칩에 쓸 글(영어·일본어·중국어). 이 영역 사전(i18n.js)과 따로 있어도 같은 키면 같은 번역이라 겹쳐도 됩니다. */
export function registerChipText() {
  import('/common/i18n.js').then((m) => m.register({
    en: { '화면을 한 번 눌러 소리 켜기': 'Tap the screen once to turn on sound' },
    ja: { '화면을 한 번 눌러 소리 켜기': '画面を一度タップして音を出す' },
    zh: { '화면을 한 번 눌러 소리 켜기': '点一下屏幕打开声音' },
  })).catch(() => {});
}
