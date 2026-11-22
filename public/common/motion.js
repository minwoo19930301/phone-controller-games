// 폰 센서 시작 공통 도우미 (폰 쪽, 아주 작게).
//
//   import { requestMotionPermission, waitForSensor } from '/common/motion.js';
//   startBtn.onclick = async () => {                       // 반드시 탭(사용자 동작) 안에서 부르세요
//     const perm = await requestMotionPermission();        // 'granted' | 'denied' | 'unsupported'
//     const ok = perm === 'granted' && (await waitForSensor(1500));
//     ...ok 가 false 면 화면 버튼으로 하는 방식으로 넘어갑니다
//   };
//
// iOS 13+ 는 움직임(devicemotion)과 방향(deviceorientation)을 각각 허락받아야 해서 두 요청을 한 번의 탭에서 같이 보냅니다.
// 안드로이드·데스크톱처럼 허락창이 없는 곳은 센서 이벤트가 있으면 바로 'granted' 입니다.

let seen = false; // 센서 값을 한 번이라도 받았는지

const hasValue = (e) => {
  if (!e) return false;
  if (e.type === 'devicemotion') {
    const a = e.accelerationIncludingGravity || e.acceleration || {};
    const r = e.rotationRate || {};
    return [a.x, a.y, a.z, r.alpha, r.beta, r.gamma].some((v) => typeof v === 'number');
  }
  return [e.alpha, e.beta, e.gamma].some((v) => typeof v === 'number');
};

/** 움직임·방향 허락을 한 번에 묻습니다. 탭 안에서 불러야 합니다. */
export async function requestMotionPermission() {
  if (typeof window === 'undefined') return 'unsupported';
  const M = window.DeviceMotionEvent;
  const O = window.DeviceOrientationEvent;
  if (!M && !O) return 'unsupported';
  const asks = [M, O].filter((C) => C && typeof C.requestPermission === 'function');
  if (!asks.length) return 'granted'; // 허락창이 없는 환경
  try {
    // 두 요청을 같은 탭 안에서 동시에 보냅니다(await 를 사이에 두면 iOS 가 사용자 동작으로 보지 않을 수 있음).
    const results = await Promise.all(asks.map((C) => C.requestPermission().catch(() => 'denied')));
    return results.every((r) => r === 'granted') ? 'granted' : 'denied';
  } catch (e) {
    return 'denied';
  }
}

/** ms 안에 센서 값이 하나라도 오면 true, 안 오면 false. 이미 받은 적이 있으면 바로 true. */
export function waitForSensor(ms = 1500) {
  if (seen) return Promise.resolve(true);
  if (typeof window === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      window.removeEventListener('devicemotion', onEv);
      window.removeEventListener('deviceorientation', onEv);
      resolve(ok);
    };
    const onEv = (e) => { if (hasValue(e)) { seen = true; finish(true); } };
    const timer = setTimeout(() => finish(false), ms);
    window.addEventListener('devicemotion', onEv);
    window.addEventListener('deviceorientation', onEv);
  });
}

export default { requestMotionPermission, waitForSensor };
