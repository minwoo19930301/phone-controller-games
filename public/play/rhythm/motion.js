// 모션 스텝 감지기(폰). 폰을 세워 든 채 위·아래·왼쪽·오른쪽으로 휙 움직이면 한 번의 스텝으로 셉니다.
// devicemotion 의 중력을 뺀 가속(acceleration)을 '지금 위쪽'과 '내 오른쪽' 두 축으로 바꿔 봅니다.
//   위쪽: deviceorientation 의 beta·gamma 로 구한 중력 반대 방향(없으면 accelerationIncludingGravity 를 천천히 평균)
//   오른쪽: 위쪽 × 화면 바깥(나를 보는 쪽). 세로로 들든 가로로 들든 사람 기준 오른쪽이 됩니다.
// 가속이 문턱을 넘는 순간부터 45ms 동안 쌓인 속도 변화의 큰 축으로 방향을 정합니다(방향 맞춤).
// 움직이면 반드시 멈추는 반대 가속이 따라오고, 제자리로 돌아오는 동작도 있으므로
//   - 한 번 센 뒤 230ms 는 쉬고(멈춤 가속 무시),
//   - 그 뒤 잠깐 동안 정반대 방향은 훨씬 세게 움직일 때만 셉니다(돌아오는 동작 무시).
// 다른 파일을 불러오지 않습니다. node 에서도 시험합니다.

export const DIRS = ['left', 'down', 'up', 'right']; // 레인 번호 순서(← ↓ ↑ →)
export const DIR_LANE = { left: 0, down: 1, up: 2, right: 3 };
export const DIR_KO = { left: '왼쪽', down: '아래', up: '위', right: '오른쪽' };
const OPP = { left: 'right', right: 'left', up: 'down', down: 'up' };
const G = 9.81;
const RD = Math.PI / 180;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** deviceorientation 의 beta·gamma(도)로 기기 좌표에서 본 '위쪽'(중력 반대) 단위 벡터 */
export function upFromOrientation(beta, gamma) {
  const b = beta * RD, g = gamma * RD;
  return [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)];
}

/** 위쪽 벡터에서 사람 기준 오른쪽(화면을 보고 있다고 봄) */
export function rightFromUp(up) {
  let r = [up[1], -up[0], 0]; // up × (0,0,1)
  if (Math.hypot(r[0], r[1]) < 0.35) {
    // 폰이 거의 누워 있으면 화면 오른쪽(x)을 수평으로 눕혀 씁니다.
    const k = up[0];
    r = [1 - k * up[0], -k * up[1], -k * up[2]];
  }
  return nrm(r);
}

/**
 * opts: { threshold = 7.5 (m/s²), refractoryMs = 230, oppositeMs = 420, oppositeK = 1.7, windowMs = 45, onStep(step) }
 * feed({ t(ms), a:[x,y,z]|null(중력 뺀 가속), ag:[x,y,z]|null(중력 포함), beta?, gamma? }) → step | null
 * step = { dir, lane, t(시작 시각 ms), peak(m/s²), r, u }
 */
export function createStepDetector(opts = {}) {
  const o = { threshold: 7.5, refractoryMs: 230, oppositeMs: 420, oppositeK: 1.7, windowMs: 45, ...opts };
  let up = [0, 1, 0];
  let haveUp = false;
  let gLP = null; // 방향 센서가 없을 때 중력 평균
  let sign = 1; // 가속 부호가 반대로 나오는 기기 보정
  let signAcc = 0;
  let last = { t: -1e9, dir: null };
  let win = null;
  let lastT = 0;
  let quietSince = 0;
  const peaks = []; // 최근 스텝 세기(튜토리얼에서 문턱을 맞출 때 씀)
  let rejected = 0; // 돌아오는 동작이라 버린 수(디버그)
  const live = { r: 0, u: 0, m: 0, upright: 0, quietMs: 0 };

  function feed(s) {
    const t = s.t;
    const dt = lastT ? Math.max(0.001, Math.min(0.05, (t - lastT) / 1000)) : 1 / 60;
    lastT = t;
    const ag = s.ag && s.ag.every((v) => Number.isFinite(v)) ? s.ag : null;
    const a = s.a && s.a.every((v) => Number.isFinite(v)) ? s.a : null;
    // 1) 위쪽
    if (Number.isFinite(s.beta) && Number.isFinite(s.gamma)) {
      up = upFromOrientation(s.beta, s.gamma);
      haveUp = true;
      // 가만히 있을 때 중력 포함 가속은 위쪽을 향해야 정상입니다. 반대면 이 기기는 부호가 뒤집혀 있습니다.
      if (ag && (!a || len(a) < 1.5)) {
        signAcc += (dot(ag, up) - signAcc) * 0.08;
        if (Math.abs(signAcc) > 5) sign = signAcc > 0 ? 1 : -1;
      }
    } else if (ag) {
      gLP = gLP ? gLP.map((v, i) => v + (ag[i] - v) * Math.min(1, dt / 0.45)) : ag.slice();
      let u = nrm(gLP);
      // 세워 든 폰이면 윗부분(y)이 위입니다. 거꾸로 나오면 부호가 뒤집힌 기기로 봅니다.
      if (u[1] < -0.5) { sign = -1; u = [-u[0], -u[1], -u[2]]; } else if (u[1] > 0.5) sign = 1;
      up = u;
      haveUp = true;
    }
    // 2) 중력 뺀 가속
    let lin = null;
    if (a) lin = [a[0] * sign, a[1] * sign, a[2] * sign];
    else if (ag && haveUp) lin = [ag[0] * sign - G * up[0], ag[1] * sign - G * up[1], ag[2] * sign - G * up[2]];
    if (!lin) return null;
    const right = rightFromUp(up);
    const r = dot(lin, right);
    const u = dot(lin, up);
    const m = Math.hypot(r, u);
    live.r = r; live.u = u; live.m = m; live.upright = up[1];
    if (m < 1.2) { if (!quietSince) quietSince = t; } else quietSince = 0;
    live.quietMs = quietSince ? t - quietSince : 0;

    // 3) 스텝 찾기
    if (win) {
      win.r += r * dt;
      win.u += u * dt;
      win.peak = Math.max(win.peak, m);
      if (t - win.t0 >= o.windowMs) return finish();
      return null;
    }
    if (m >= o.threshold && t - last.t >= o.refractoryMs) {
      win = { t0: t, r: r * dt, u: u * dt, peak: m };
    }
    return null;
  }

  function finish() {
    const w = win;
    win = null;
    const dir = Math.abs(w.r) > Math.abs(w.u) ? (w.r > 0 ? 'right' : 'left') : (w.u > 0 ? 'up' : 'down');
    // 방금 센 것과 정반대 방향이 곧바로 오면 제자리로 돌아오는 동작입니다. 아주 세게 움직였을 때만 셉니다.
    // 돌아오는 동작의 멈춤 가속(처음 방향과 같음)도 세지 않도록, 버린 순간부터 다시 쉬는 시간을 둡니다.
    if (last.dir && dir === OPP[last.dir] && w.t0 - last.t < o.oppositeMs && w.peak < o.threshold * o.oppositeK) {
      last = { t: w.t0, dir: last.dir, rejected: true };
      rejected += 1;
      return null;
    }
    last = { t: w.t0, dir };
    peaks.push(w.peak);
    if (peaks.length > 24) peaks.shift();
    const step = { dir, lane: DIR_LANE[dir], t: w.t0, peak: Math.round(w.peak * 10) / 10, r: w.r, u: w.u };
    if (typeof o.onStep === 'function') o.onStep(step);
    return step;
  }

  return {
    feed,
    get up() { return up; },
    get sign() { return sign; },
    get live() { return live; },
    get peaks() { return peaks.slice(); },
    get rejected() { return rejected; },
    get threshold() { return o.threshold; },
    setThreshold(v) { o.threshold = Math.max(3, Math.min(16, v)); },
    setOpposite(ms) { o.oppositeMs = ms; },
    /** 센서가 없을 때 시험 버튼으로 스텝을 흉내 냅니다 */
    emit(dir, t = 0) {
      const step = { dir, lane: DIR_LANE[dir], t, peak: o.threshold * 1.4, r: 0, u: 0, sim: true };
      last = { t, dir };
      if (typeof o.onStep === 'function') o.onStep(step);
      return step;
    },
    reset() { win = null; last = { t: -1e9, dir: null }; }
  };
}
