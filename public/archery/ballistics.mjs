// 양궁 화살 탄도·바람·흔들림(순수 모듈, three.js·DOM 없음). 같은 시드면 항상 같은 결과.
// 좌표: 과녁 면 위 (x 오른쪽 +, y 위 +) 미터, 과녁 중심이 (0,0). 거리 = 사선에서 과녁까지(m).
// 바람: { speed(m/s), dir(라디안) } dir 은 바람이 '불어 가는' 방향. 0 = 오른쪽, π/2 = 과녁 쪽(뒷바람), π = 왼쪽.
export const G = 9.80665;
export const DRAG_K = 0.0025; // 화살 속도 감쇠(1/m): v(x) = v0·exp(-k·x)
export const V_FULL = 58; // 만궁 초속(m/s)
export const FULL_PULL = 0.92; // 이 이상 당기면 만궁으로 봄(폰 당김 0..1)
export const SIGHT_GAIN = 0.28; // 폰 1° 가 과녁 면에서 움직이는 정도 = 거리·tan(1°)·SIGHT_GAIN (손맛 조정용)

// 난이도: 거리, 바람 세기 상한(m/s), 화살마다 바뀌는 폭, 돌풍 확률·세기, 화면 흔들림(도), 지칠 때까지(초), 예상 낙점 표시
export const DIFFICULTY = {
  easy: { distance: 30, windMax: 2.0, windStep: 0.35, gust: 0.0, gustMul: 1, sway: 0.1, steadySec: 2.6, marker: true },
  normal: { distance: 50, windMax: 4.2, windStep: 0.6, gust: 0.12, gustMul: 1.4, sway: 0.2, steadySec: 2.0, marker: false },
  hard: { distance: 70, windMax: 7.0, windStep: 1.0, gust: 0.3, gustMul: 1.9, sway: 0.34, steadySec: 1.6, marker: false }
};
export const diffOf = (level) => DIFFICULTY[level] || DIFFICULTY.normal;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const RD = Math.PI / 180;
const gauss = (rng) => Math.sqrt(-2 * Math.log(Math.max(1e-9, rng()))) * Math.cos(2 * Math.PI * rng());

// 당긴 정도(0..1) → 초속. 덜 당기면 짧게 날아갑니다.
export function launchSpeed(pull) {
  const p = clamp(Number.isFinite(pull) ? pull : 0, 0, 1);
  if (p >= FULL_PULL) return V_FULL;
  return V_FULL * (0.3 + 0.7 * (p / FULL_PULL));
}
// x(m) 지점까지 걸린 시간(초)
export function timeAt(x, v0) {
  return (Math.exp(DRAG_K * x) - 1) / (DRAG_K * v0);
}
// 중력으로 처진 정도(m): 발사 방향을 그대로 두었을 때 거리 x 에서 떨어진 높이
export function dropAt(x, v0) {
  const t = timeAt(x, v0);
  return 0.5 * G * t * t;
}
// 옆바람(오른쪽 +)과 뒷바람 성분
export const crossWind = (w) => (w ? w.speed * Math.cos(w.dir) : 0);
export const tailWind = (w) => (w ? w.speed * Math.sin(w.dir) : 0);
// 화살이 거리 x 까지 옆으로 밀린 정도(m): 바람 속도 × (실제 비행 시간 - 바람 없을 때 시간)
export function driftAt(x, v0, wind) {
  return crossWind(wind) * (timeAt(x, v0) - x / v0);
}
// 폰 각도(도) → 과녁 면 미터
export const metersPerDeg = (distance) => distance * Math.tan(RD) * SIGHT_GAIN;

// 한 발: aim = 폰 조준(도, 중앙 기준; 흔들림 포함), pull, steady 0..1(1 = 아주 안정)
// 반환: { x, y, drift, dropExtra, t, v0, sx, sy } — sx/sy = 바람·처짐 없이 조준한 곳(예상 낙점 계산용)
export function shoot({ distance, aimX = 0, aimY = 0, pull = 1, steady = 1, wind = null, seed = 1 }) {
  const rng = mulberry32(seed);
  const v0 = launchSpeed(pull);
  const mpd = metersPerDeg(distance);
  const sigmaDeg = 0.04 + 0.2 * (1 - clamp(steady, 0, 1));
  const sx = aimX * mpd;
  const sy = aimY * mpd;
  const tFull = timeAt(distance, V_FULL);
  const t = timeAt(distance, v0);
  const dropExtra = 0.5 * G * (t * t - tFull * tFull); // 사이트는 만궁 기준으로 영점이 잡혀 있음
  const drift = driftAt(distance, v0, wind);
  const x = sx + drift + gauss(rng) * sigmaDeg * mpd;
  const y = sy - dropExtra + gauss(rng) * sigmaDeg * mpd;
  return { x, y, drift, dropExtra, t, v0, sx, sy };
}
// 날아가는 중 위치: f = 0..1 (사선 진행 비율). 반환 { x, y, t } 과녁 좌표계(사수 기준 높이는 호출 쪽에서 더함)
export function pathAt(f, { distance, aimX = 0, aimY = 0, pull = 1, wind = null, impact }) {
  const v0 = launchSpeed(pull);
  const xd = clamp(f, 0, 1) * distance;
  const mpd = metersPerDeg(distance);
  const tFull = timeAt(distance, V_FULL);
  const tanTh = (0.5 * G * tFull * tFull) / distance;
  const lerpY = (aimY * mpd) * (xd / distance);
  const y = lerpY + xd * tanTh - dropAt(xd, v0);
  const lerpX = (aimX * mpd) * (xd / distance);
  const x = lerpX + driftAt(xd, v0, wind);
  // 흔들림·산포가 있는 실제 낙점으로 끝이 맞도록, 마지막 구간에서 보정을 섞습니다.
  if (impact) {
    const end = { x: aimX * mpd + driftAt(distance, v0, wind), y: aimY * mpd - 0.5 * G * (timeAt(distance, v0) ** 2 - tFull * tFull) };
    const k = xd / distance;
    return { x: x + (impact.x - end.x) * k, y: y + (impact.y - end.y) * k, t: timeAt(xd, v0) };
  }
  return { x, y, t: timeAt(xd, v0) };
}

// ---------- 바람 ----------
// 이번 엔드의 처음 바람. endIdx 가 바뀌면 방향도 크게 바뀜
export function initialWind(seed, endIdx, level) {
  const d = diffOf(level);
  const rng = mulberry32((seed * 7919 + endIdx * 104729 + 13) >>> 0);
  const speed = d.windMax * (0.35 + 0.5 * rng());
  const side = rng() < 0.5 ? 0 : Math.PI; // 왼쪽/오른쪽에서 불어 옴(옆바람 위주)
  const dir = side + (rng() - 0.5) * 0.9;
  return { speed: Math.round(speed * 10) / 10, dir: normAngle(dir) };
}
const normAngle = (a) => { let r = a % (2 * Math.PI); if (r > Math.PI) r -= 2 * Math.PI; if (r < -Math.PI) r += 2 * Math.PI; return r; };
// 화살 한 발 뒤 살짝 바뀐 바람(돌풍이면 크게)
export function nextWind(prev, seed, level) {
  const d = diffOf(level);
  const rng = mulberry32(seed >>> 0);
  const gust = rng() < d.gust;
  const step = d.windStep * (gust ? d.gustMul : 1);
  // 벡터 합으로 바꿔서 방향·세기가 함께 자연스럽게 움직임
  let vx = Math.cos(prev.dir) * prev.speed + gauss(rng) * step * 0.7;
  let vy = Math.sin(prev.dir) * prev.speed + gauss(rng) * step * 0.35;
  let sp = Math.hypot(vx, vy);
  const cap = d.windMax * (gust ? 1.15 : 1);
  if (sp > cap) { vx *= cap / sp; vy *= cap / sp; sp = cap; }
  return { speed: Math.round(sp * 10) / 10, dir: normAngle(Math.atan2(vy, vx)) };
}

// ---------- 흔들림(피로) ----------
// 만궁을 잡은 뒤 holdSec 초. steadySec 까지는 안정 → 이후 점점 떨림(최대 FATIGUE_MAX 도).
export const FATIGUE_MAX = 1.1;
export const BEAT_PERIOD = 0.95; // 지친 뒤 심박 간격(초)
export const BREATH_WINDOW = 0.28; // 심박 직후 '숨 고르기' 구간(초): 이때 가장 안정
export function fatigue(holdSec, level) {
  const d = diffOf(level);
  return clamp((holdSec - d.steadySec) / 3.2, 0, 1);
}
// 흔들림 크기(도)와 방향. t = 시계(초), 시드로 각 사람마다 달라짐.
export function tremble(holdSec, t, level, seed = 1) {
  const d = diffOf(level);
  const f = fatigue(holdSec, level);
  // 기본 미세 흔들림 + 피로 흔들림
  const base = d.sway;
  const amp = base * (1 - f * 0.3) + FATIGUE_MAX * f * f * (0.4 + 0.6 * d.sway / 0.34);
  const ph = (seed % 97) * 0.37;
  let k = 1;
  if (f > 0) {
    const since = beatPhase(holdSec, level);
    if (since >= 0 && since < BREATH_WINDOW) k = 0.22; // 숨 고르기
  }
  return {
    x: k * amp * (Math.sin(t * 2.3 + ph) * 0.6 + Math.sin(t * 5.1 + ph * 2.1) * 0.4),
    y: k * amp * (Math.sin(t * 1.9 + ph * 1.3) * 0.6 + Math.sin(t * 4.3 + ph) * 0.4),
    amp: k * amp, f, breath: k < 1
  };
}
// 마지막 심박 이후 흐른 시간(초). 지치기 전이면 -1
export function beatPhase(holdSec, level) {
  const d = diffOf(level);
  if (holdSec < d.steadySec) return -1;
  return (holdSec - d.steadySec) % BEAT_PERIOD;
}
// holdSec → 몇 번째 심박(1부터). 지치기 전 0
export function beatIndex(holdSec, level) {
  const d = diffOf(level);
  if (holdSec < d.steadySec) return 0;
  return 1 + Math.floor((holdSec - d.steadySec) / BEAT_PERIOD);
}
