// 골프 라운드·니어핀 큰 화면의 실제 녹음 효과음. 공유 라이브러리(/common/samples.js)를 골프 이벤트 이름으로 감쌉니다.
// 못 받은 소리는 false 를 돌려주니, 부르는 쪽이 예전 합성음을 대신 내면 됩니다.
//   const real = createGolfSfx(ctx); real.preload();
//   const r = real.shot(q, clubKind);   // { strike, whoosh }
// window.__golfSfx = { played: {이름: 횟수}, missed: {이름: 횟수} } 로 실제 재생 횟수를 확인할 수 있습니다.
import { createSamples } from '/common/samples.js';

// 대기실에서 미리 받는 묶음(이름 앞머리). crowd/ 전체는 바탕 루프가 커서 쓰는 것만 고릅니다.
export const GOLF_PRELOAD = ['ball/golf-', 'ball/cup-drop', 'ball/tennis-bounce', 'swing/swoosh-', 'water/plop', 'crowd/applause', 'crowd/golf-clap', 'crowd/cheer', 'crowd/aww'];

// 세기(gain) 기준: 타구가 가장 크고, 박수·환호는 그 아래, 착지는 작게.
export const GOLF_GAIN = {
  strikeBase: 0.75, strikeQ: 0.35, // 아이언·웨지: 0.75 ~ 1.1
  woodBase: 1.0, woodQ: 0.5, // 우드·드라이버(golf-drive-1 은 녹음이 작아 더 키움)
  whooshBase: 0.3, whooshQ: 0.35,
  land: 0.45, splash: 0.9, cup: 0.9,
  clapGreen: 0.6, clapNear: 0.75, holeCheer: 0.6, holeClap: 0.65, hioLong: 0.75, hioCheer: 0.5, endLong: 0.65
};
// 휘두르는 소리는 앞쪽 0.05~0.1초에서 가장 큰데, 타구 소리는 이미 맞은 뒤에 도착하므로 휘두르는 소리를 먼저 틀고 타구를 이만큼 미룹니다.
export const STRIKE_DELAY = 0.07;

function makeMaster(ctx) {
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  return master;
}

export function createGolfSfx(ctx, { master = makeMaster(ctx) } = {}) {
  const sam = createSamples(ctx, master);
  const stat = (window.__golfSfx = window.__golfSfx || { played: {}, missed: {} });
  const run = () => ctx.state === 'running';
  function play(name, opts) {
    // 소리가 잠겨 있는 동안은 예약만 쌓이지 않도록 아예 틀지 않습니다(합성음도 같은 규칙).
    const ok = run() && sam.play(name, opts);
    const bucket = ok ? stat.played : stat.missed;
    bucket[name] = (bucket[name] || 0) + 1;
    return ok;
  }
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  return {
    sam,
    play,
    preload: () => sam.preload(GOLF_PRELOAD),
    has: (name) => sam.has(name),
    /** 스윙: 휘두르는 소리 → 0.07초 뒤 타구. q 는 클럽 속도 0~1, kind 는 clubs.js 의 kind. */
    shot(q, kind = 'iron') {
      q = clamp01(q);
      const wood = kind === 'wood';
      const whoosh = play(wood ? 'swing/swoosh-heavy' : 'swing/swoosh-light', { gain: GOLF_GAIN.whooshBase + q * GOLF_GAIN.whooshQ, rate: 0.9 + q * 0.25 });
      const strike = play(wood ? 'ball/golf-drive' : 'ball/golf-iron', {
        gain: wood ? GOLF_GAIN.woodBase + q * GOLF_GAIN.woodQ : GOLF_GAIN.strikeBase + q * GOLF_GAIN.strikeQ,
        rate: (wood ? 0.95 : kind === 'wedge' ? 1.06 : 1) + q * 0.06,
        when: whoosh ? STRIKE_DELAY : 0
      });
      return { strike, whoosh };
    },
    /** 공이 그린에 떨어질 때만 녹음이 있습니다(딱딱한 면에 튀는 소리). 페어웨이·러프·벙커·숲은 맞는 녹음이 없어 false. */
    land(surface) {
      if (surface !== 'green') return false;
      return play('ball/tennis-bounce', { gain: GOLF_GAIN.land, rate: 0.85 });
    },
    splash: () => play('water/plop', { gain: GOLF_GAIN.splash }),
    cup: () => play('ball/cup-drop', { gain: GOLF_GAIN.cup }),
    /** 박수·환호. kind: green 온 그린, near 3m 안, hole 홀인, hio 홀인원, end 경기 끝. 하나라도 틀었으면 true. */
    clap(kind) {
      const G = GOLF_GAIN;
      if (kind === 'hio') {
        const a = play('crowd/applause-long', { gain: G.hioLong, when: 0.5 });
        const b = play('crowd/cheer-big', { gain: G.hioCheer, when: 0.5 });
        return a || b;
      }
      if (kind === 'hole') {
        const a = play('crowd/cheer-small', { gain: G.holeCheer, when: 0.5 });
        const b = play('crowd/applause-short', { gain: G.holeClap, when: 0.65 });
        return a || b;
      }
      if (kind === 'near') return play('crowd/applause-short', { gain: G.clapNear, when: 0.25 });
      if (kind === 'end') return play('crowd/applause-long', { gain: G.endLong });
      return play('crowd/golf-clap', { gain: G.clapGreen, when: 0.25 });
    }
  };
}
