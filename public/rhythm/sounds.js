// 리듬 스텝 효과음: 공용 녹음 라이브러리(/common/samples.js)를 큰 화면에서만 틉니다.
// 노래(합성 연주)는 그대로 두고, 그 위에 얹는 짧은 소리만 다룹니다. 샘플이 아직 안 받아졌으면 조용히 건너뜁니다(박자 소리를 합성으로 대신 만들지 않음).
import { createSamples } from '/common/samples.js';

// 대기실에서 미리 받을 이름(정확히 이 파일들만)
export const PRELOAD = [
  'perc/woodblock', 'perc/snare-rim', 'ui/fail', 'ui/countdown-tick', 'ui/ding',
  'crowd/cheer-small', 'crowd/cheer-big', 'crowd/applause-short', 'crowd/applause-long',
  'ui/fanfare-win', 'ui/sting-lose', 'ui/click', 'ui/pop'
];

// 세기(상수). 노래가 주인공이라 박자 소리는 작게, 환호·결과는 그보다 크게.
export const GAIN = {
  perfect: 0.5, great: 0.38, good: 0.3, miss: 0.3,
  tick: 0.7, go: 0.55, cheer25: 0.45, cheer50: 0.6,
  fanfare: 0.7, applause: 0.6, sting: 0.7,
  cdTick: 0.35, cdPop: 0.6
};
const HIT_GAP_MS = 28; // 빠른 악보에서 소리가 뭉개지지 않게 전체 최소 간격
const MISS_GAP_MS = 140;

export function createRhythmSounds(ctx, analyser) {
  // 노래 마스터(끝날 때 볼륨을 0으로 내림)와 따로 흘려 결과 소리가 묻히지 않게 합니다. 무대 이퀄라이저는 분석기로 같이 받습니다.
  const bus = ctx.createGain();
  bus.gain.value = 1;
  bus.connect(ctx.destination);
  if (analyser) bus.connect(analyser);
  const sfx = createSamples(ctx, bus);
  const stat = { played: {}, missed: {} }; // 시험용: 이름별로 몇 번 틀었는지
  let lastHit = 0, lastMiss = 0, lastCd = 0;

  function play(name, opts) {
    const ok = sfx.play(name, opts);
    const m = ok ? stat.played : stat.missed;
    m[name] = (m[name] || 0) + 1;
    return ok;
  }

  return {
    sfx, stat,
    preload: () => sfx.preload(PRELOAD),
    has: (n) => sfx.has(n),
    /** 노트 판정 소리. pan: -1~1, scale: 사람이 여럿일 때 줄이는 비율 */
    judged(j, { pan = 0, scale = 1 } = {}) {
      const nowMs = performance.now();
      if (j === 'miss') {
        if (nowMs - lastMiss < MISS_GAP_MS) return;
        lastMiss = nowMs;
        play('ui/fail', { gain: GAIN.miss * scale, rate: 1.15, pan });
        return;
      }
      if (nowMs - lastHit < HIT_GAP_MS) return;
      lastHit = nowMs;
      if (j === 'perfect') play('perc/woodblock', { gain: GAIN.perfect * scale, rate: 1, pan });
      else if (j === 'great') play('perc/woodblock', { gain: GAIN.great * scale, rate: 0.88, pan });
      else play('perc/snare-rim', { gain: GAIN.good * scale, pan });
    },
    /** 콤보 25 마다 작은 환호, 100 마다 큰 환호 */
    combo(n) {
      if (n % 100 === 0) play('crowd/cheer-big', { gain: GAIN.cheer50 });
      else if (n % 25 === 0) play('crowd/cheer-small', { gain: GAIN.cheer25 });
    },
    /** 카운트다운: at = 곡 0초의 오디오 시각. 3·2·1 은 시계 소리, GO 는 맑은 종(곡 시작과 같은 순간) */
    countdown(at) {
      const base = ctx.currentTime;
      [3, 2, 1].forEach((k, i) => {
        play('ui/countdown-tick', { gain: GAIN.tick, rate: 0.95 + i * 0.05, jitter: 0, when: Math.max(0, at - k - base) });
      });
      play('ui/ding', { gain: GAIN.go, jitter: 0, when: Math.max(0, at - base) });
    },
    /** 결과: 실패면 아쉬운 소리, 아니면 팡파르 + 박수(전곡 퍼펙트·풀콤보면 긴 박수) */
    result({ failedAll, bestFull }) {
      if (failedAll) { play('ui/sting-lose', { gain: GAIN.sting, jitter: 0 }); return; }
      play('ui/fanfare-win', { gain: GAIN.fanfare, jitter: 0 });
      play(bestFull ? 'crowd/applause-long' : 'crowd/applause-short', { gain: GAIN.applause, jitter: 0, when: 0.5 });
    },
    /** CD 를 넘길 때 톡, 고를 때 퐁 (너무 자주 울리지 않게) */
    cdMove() {
      const nowMs = performance.now();
      if (nowMs - lastCd < 90) return;
      lastCd = nowMs;
      play('ui/click', { gain: GAIN.cdTick });
    },
    cdPick() { play('ui/pop', { gain: GAIN.cdPop }); },
    /** 이어 도는 소리는 쓰지 않지만, 페이지가 가려지면 남은 소리를 잠재웁니다 */
    mute(on) { bus.gain.setTargetAtTime(on ? 0 : 1, ctx.currentTime, 0.03); }
  };
}
