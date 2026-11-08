// 폰 동작 센서 모음(드럼 스틱·지휘봉). 권한은 시작 버튼 탭 안에서 requestPermission() 으로 받습니다.
// 움직임은 중력을 뺀 가속도(m/s²)와 회전 속도(도/초)로, 방향은 deviceorientation 각도로 알려 줍니다.
const motionSubs = new Set();
const orientSubs = new Set();
let started = false;
let gotMotion = false;
let gotOrient = false;
let denied = false;
const grav = [0, 0, 9.8];
let lastOrient = null;

function evTime(e) {
  const n = performance.now();
  const ts = e && e.timeStamp;
  return ts > 0 && Math.abs(n - ts) < 1000 ? ts : n;
}
function onMotion(e) {
  const ig = e.accelerationIncludingGravity;
  const ac = e.acceleration;
  const rr = e.rotationRate;
  if (!ig && !ac && !rr) return;
  const t = evTime(e);
  // 중력 추정(느린 저역 통과). 기울기(탐 판정)에도 씁니다.
  const g = ig ? [ig.x || 0, ig.y || 0, ig.z || 0] : null;
  if (g) for (let i = 0; i < 3; i++) grav[i] = grav[i] * 0.92 + g[i] * 0.08;
  let lin;
  if (ac && (ac.x || ac.y || ac.z)) lin = [ac.x || 0, ac.y || 0, ac.z || 0];
  else if (g) lin = [g[0] - grav[0], g[1] - grav[1], g[2] - grav[2]];
  else lin = [0, 0, 0];
  const rot = rr ? [rr.alpha || 0, rr.beta || 0, rr.gamma || 0] : [0, 0, 0];
  // PC·에뮬레이터는 0 만 담긴 이벤트를 보내기도 해서, 값이 실제로 있을 때만 센서가 있다고 봅니다.
  if (!gotMotion && (lin.some((v) => v) || rot.some((v) => v) || (g && Math.hypot(g[0], g[1], g[2]) > 1))) gotMotion = true;
  const d = { t, lin, rot, grav: grav.slice() };
  for (const f of motionSubs) { try { f(d); } catch (err) { console.error(err); } }
}
function onOrient(e) {
  if (e.alpha == null && e.beta == null) return;
  if (!gotOrient && !e.alpha && !e.beta && !e.gamma) return;
  gotOrient = true;
  const d = { t: evTime(e), alpha: e.alpha || 0, beta: e.beta || 0, gamma: e.gamma || 0 };
  lastOrient = d;
  for (const f of orientSubs) { try { f(d); } catch (err) { console.error(err); } }
}

export const sensors = {
  /** 시작 버튼 탭 안에서 부릅니다(iPhone 권한 창). await 전에 불러야 합니다. */
  async permission() {
    const asks = [];
    if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') asks.push(DeviceMotionEvent.requestPermission().catch(() => 'denied'));
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') asks.push(DeviceOrientationEvent.requestPermission().catch(() => 'denied'));
    const res = await Promise.all(asks);
    denied = res.some((x) => x !== 'granted');
    sensors.start();
    return !denied;
  },
  start() {
    if (started) return;
    started = true;
    window.addEventListener('devicemotion', onMotion);
    window.addEventListener('deviceorientation', onOrient);
  },
  onMotion(fn) { motionSubs.add(fn); return () => motionSubs.delete(fn); },
  onOrient(fn) { orientSubs.add(fn); return () => orientSubs.delete(fn); },
  get gotMotion() { return gotMotion; },
  get gotOrient() { return gotOrient; },
  get denied() { return denied; },
  get orient() { return lastOrient; },
  /** 시험용: 가짜 움직임 하나 흘려보내기 */
  inject(d) { for (const f of motionSubs) f({ t: performance.now(), lin: [0, 0, 0], rot: [0, 0, 0], grav: [0, 0, 9.8], ...d }); },
  injectOrient(d) { const x = { t: performance.now(), alpha: 0, beta: 0, gamma: 0, ...d }; lastOrient = x; for (const f of orientSubs) f(x); },
};
