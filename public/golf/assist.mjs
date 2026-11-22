// 골프·니어핀·퍼팅 난이도 보정표와 순수 계산 함수. 큰 화면과 폰이 같은 값을 씁니다.
// easy 가 기본이고 아주 넉넉합니다. normal 은 예전 쉬움 정도, hard 는 예전 그대로입니다.

export const LEVELS = ['easy', 'normal', 'hard'];
export const levelOf = (v) => (LEVELS.includes(v) ? v : 'easy');

// ---------- 골프 / 니어핀: 큰 화면 보정 ----------
// 페이스·궤도 영향 배율(hard = 예전 값 그대로). 시뮬레이터의 0.8·0.2·0.16 계수에 곱해집니다.
export const FACE_SCALE = { easy: 0.375, normal: 0.625, hard: 1 };
// 이 각도(도) 안쪽의 페이스·궤도는 0 으로 봅니다.
export const FACE_DEAD = { easy: 3, normal: 2, hard: 0 };
// 페이스·궤도 최대값(도)
export const FACE_MAX = { easy: 10, normal: 15, hard: 25 };
// 샷 세기 하한 비율: 약한 스윙도 이 비율만큼은 나갑니다(hard 는 보정 없음).
export const POWER_FLOOR = { easy: 0.55, normal: 0.35, hard: 0 };
export const POWER_CAP = 1.15; // 이 비율보다 세게 휘둘러도 더 늘어나지 않습니다(easy·normal)
// 바람 세기 상한(m/s)
export const WIND_MAX = { easy: 1.5, normal: 3, hard: 4.5 };

// 클럽의 보통 스윙 속도(도/초). 골프 코스는 클럽 길이 × 1.65, 니어핀은 1.55 로 헤드 속도를 계산합니다.
export function nominalSwing(club, near = false) {
  const head = club.headKmh / 3.6;
  const arm = near ? 1.55 : club.lengthM * 1.65;
  return head / arm / (Math.PI / 180);
}

/** 샷 세기 보정: nominal 에 가까워지도록 끌어올립니다. hard 는 그대로. */
export function shapePower(raw, nominal, level) {
  const f = POWER_FLOOR[levelOf(level)];
  if (!f || !(nominal > 0)) return raw;
  const ratio = Math.min(POWER_CAP, Math.max(0, raw) / nominal);
  return nominal * (f + (1 - f) * ratio);
}

// 백스윙 크기(도)에 따른 세기 상한(모든 난이도). 웨지를 손목만 탁 꺾어 치면 회전 속도는 높게 나와도
// 백스윙이 작으니 멀리 가지 않게 합니다. short 이하 백스윙은 보통 세기의 lo 배까지, full 이상은 hi 배까지.
export const BACKSWING = { short: 60, full: 150, lo: 0.5, hi: 1.1 };
// 보통 세기보다 센 부분은 이만큼만 반영합니다(스냅으로 회전이 튀어도 덜 나가게).
export const OVER_GAIN = 0.3;

/** 세기 보정(모든 난이도): 보통 세기를 넘는 부분은 줄이고, 백스윙(back, 도)이 작을수록 상한을 낮춥니다. back 이 없으면 백스윙 상한은 건너뜁니다. */
export function limitPower(speed, nominal, back) {
  if (!(nominal > 0) || !(speed > 0)) return speed;
  let r = speed / nominal;
  if (r > 1) r = Math.min(BACKSWING.hi, 1 + (r - 1) * OVER_GAIN);
  if (back > 0) {
    const u = Math.max(0, Math.min(1, (back - BACKSWING.short) / (BACKSWING.full - BACKSWING.short)));
    r = Math.min(r, BACKSWING.lo + (BACKSWING.hi - BACKSWING.lo) * u);
  }
  return nominal * r;
}

/** 페이스·궤도(도) 한 값: 작은 값은 0, 큰 값은 상한으로 자르고 배율을 곱합니다. */
export function shapeAngle(deg, level) {
  const l = levelOf(level);
  let v = Number(deg) || 0;
  if (Math.abs(v) < FACE_DEAD[l]) return 0;
  v = Math.max(-FACE_MAX[l], Math.min(FACE_MAX[l], v));
  return v * FACE_SCALE[l];
}

// ---------- 폰: 스윙 감지 문턱값 ----------
// back: 이 각도(도)보다 더 뒤로 들면 백스윙, rate/over: 내려오는 속도(도/초)와 그 지점 위로 올라온 각,
// resetD/resetRate: 이만큼 제자리로 돌아오면 처음부터, fidgetMs: 백스윙 상태로 이만큼 머물면 처음부터,
// burst: 방향이 안 잡혀도 회전 속도가 이 이상 튀면 한 번 친 것으로 봅니다(0 이면 끔).
// 11/22: 문턱을 낮췄더니 흔들기만 해도 스윙으로 잡혀 더 어려워졌다는 피드백이 있어 모든 난이도를 예전 값으로 되돌렸습니다.
export const SWING_DETECT = {
  easy: { back: -60, rate: 250, over: 25, resetD: 20, resetRate: 250, fidgetMs: 0, burst: 0 },
  normal: { back: -60, rate: 250, over: 25, resetD: 20, resetRate: 250, fidgetMs: 0, burst: 0 },
  hard: { back: -60, rate: 250, over: 25, resetD: 20, resetRate: 250, fidgetMs: 0, burst: 0 }
};
export const PUTTER_DETECT = {
  easy: { back: -5, rate: 18, over: 2, resetD: 2, resetRate: 18, fidgetMs: 5000, burst: 0 },
  normal: { back: -6, rate: 24, over: 2.5, resetD: 2.5, resetRate: 24, fidgetMs: 4000, burst: 0 },
  hard: { back: -8, rate: 30, over: 3, resetD: 3, resetRate: 30, fidgetMs: 0, burst: 0 }
};
export const swingDetect = (level, putter) => (putter ? PUTTER_DETECT : SWING_DETECT)[levelOf(level)];

// 어드레스: 폰이 이만큼(도) 안에서 STILL_MS 동안 가만히 있으면 그 자세를 기준으로 잡습니다. FALLBACK_MS 가 지나면 그냥 잡습니다.
export const STILL_DEG = 4;
export const STILL_MS = 300;
export const FALLBACK_MS = 1500;
// 스윙 화면에서 아무것도 감지되지 않으면 이 시간 뒤에 힌트를 보여 줍니다.
export const HINT_AFTER_MS = 6000;

// ---------- 퍼팅 ----------
// aim: 자동 조준 비율(0~1), magnet: 세기 자석 비율, lo/hi: 자석이 걸리는 세기 범위(이상적인 세기의 배수),
// cup: 컵 크기 배율(판정만), faceK: 페이스가 출발 방향에 주는 계수, dead/faceMax: 페이스 무시 각도·상한(도)
export const PUTT = {
  easy: { aim: 1, magnet: 0.5, lo: 0.35, hi: 1.8, cup: 1.35, faceK: 0.15, dead: 2, faceMax: 6 },
  normal: { aim: 0.6, magnet: 0.3, lo: 0.5, hi: 1.5, cup: 1.15, faceK: 0.4, dead: 1.5, faceMax: 10 },
  hard: { aim: 0, magnet: 0, lo: 0, hi: 0, cup: 1, faceK: 0.88, dead: 0, faceMax: 15 }
};
export const putt = (level) => PUTT[levelOf(level)];
// 폰 스트로크 감지 문턱값: 시작 속도(도/초), 손떨림으로 볼 최대 속도, 최소 이동 각, 백스윙 기준에서 올라와야 할 각
export const STROKE_DETECT = {
  easy: { fwdRate: 12, minPeak: 8, travel: 0.6, rise: 0.4 },
  normal: { fwdRate: 18, minPeak: 14, travel: 1.0, rise: 0.6 },
  hard: { fwdRate: 25, minPeak: 20, travel: 1.5, rise: 0.8 }
};
export const strokeDetect = (level) => STROKE_DETECT[levelOf(level)];

/** 퍼터 세기 자석: raw 가 ideal 의 lo~hi 배 안이면 ideal 쪽으로 끌어당깁니다. */
export function shapePutterSpeed(raw, ideal, level) {
  const p = putt(level);
  if (!p.magnet || !(ideal > 0)) return raw;
  const r = raw / ideal;
  if (r < p.lo || r > p.hi) return raw;
  return raw * (1 - p.magnet) + ideal * p.magnet;
}
/** 퍼팅 페이스(도): 작으면 0, 큰 값은 상한. 출발 방향에 주는 영향은 putt(level).faceK. */
export function shapePutterFace(face, level) {
  const p = putt(level);
  const v = Number(face) || 0;
  if (Math.abs(v) < p.dead) return 0;
  return Math.max(-p.faceMax, Math.min(p.faceMax, v));
}
/** 자동 조준: 계획한 조준(도)에 비율을 곱해 씁니다. */
export function assistAim(planYaw, level) {
  return Math.round(Math.max(-25, Math.min(25, planYaw * putt(level).aim)) * 10) / 10;
}
