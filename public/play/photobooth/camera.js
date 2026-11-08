// 네컷 사진관 폰 카메라: 앞 카메라 실시간 미리보기(거울처럼 좌우 반전), 찰칵(보이는 그대로 잘라 900px JPEG),
// 큰 화면용 작은 미리보기, 카메라가 안 되면 '직접 찍기'(폰 카메라 앱) 또는 시험 카메라(그림 얼굴).
//
//   const cam = createCamera({ onChange });
//   await cam.start();              // 탭 안에서 부르면 iPhone 도 잘 열립니다
//   cam.attach(boxEl);              // 미리보기를 이 상자에 꽉 차게(가운데 잘림)
//   const c = cam.grab(1.37);       // 지금 보이는 그대로(가로/세로 비율) 잘라 캔버스로
//   const url = encode(c);          // JPEG data URL(350KB 이하)
import { drawAvatar } from '/photobooth/avatar.js';

export const MAX_EDGE = 900;
export const MAX_BYTES = 350 * 1024;

/** 캔버스 → JPEG data URL. 350KB 를 넘으면 화질을 낮춰 다시 굽습니다. */
export function encode(canvas, maxBytes = MAX_BYTES) {
  let url = '';
  for (const q of [0.86, 0.78, 0.7, 0.6, 0.5, 0.4]) {
    url = canvas.toDataURL('image/jpeg', q);
    if (url.length * 0.75 <= maxBytes) return url;
  }
  return url;
}

/** 원본에서 aspect(가로/세로) 비율로 가운데를 잘라 maxEdge 이하 캔버스로. mirror 면 좌우 반전 */
export function cropTo(src, sw, sh, aspect, maxEdge = MAX_EDGE, mirror = false) {
  let cw = sw;
  let ch = sw / aspect;
  if (ch > sh) { ch = sh; cw = sh * aspect; }
  const sx = (sw - cw) / 2;
  const sy = (sh - ch) / 2;
  const k = Math.min(1, maxEdge / Math.max(cw, ch));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(cw * k));
  out.height = Math.max(1, Math.round(ch * k));
  const g = out.getContext('2d');
  if (mirror) { g.translate(out.width, 0); g.scale(-1, 1); }
  g.drawImage(src, sx, sy, cw, ch, 0, 0, out.width, out.height);
  return out;
}

export function createCamera(opts = {}) {
  const video = document.createElement('video');
  video.className = 'camv mirror';
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  let stream = null;
  let state = 'off'; // off | asking | live | denied | unsupported | file | fake
  let fake = null; // { cv, timer, slot, color, pose }
  let el = video;
  let box = null;
  const subs = new Set();
  if (opts.onChange) subs.add(opts.onChange);
  const emit = () => { for (const f of subs) { try { f(state); } catch (e) {} } };
  const setState = (s) => { if (state !== s) { state = s; emit(); } };

  const canGum = () => Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext);

  async function start() {
    if (state === 'live' && stream && stream.getVideoTracks().some((t) => t.readyState === 'live')) return true;
    if (!canGum()) { setState('unsupported'); return false; }
    setState('asking');
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false
      });
      stopFake();
      stream = s;
      video.srcObject = s;
      for (const t of s.getVideoTracks()) t.addEventListener('ended', () => { if (stream === s) setState('off'); });
      el = video;
      if (box) mount(box);
      await video.play().catch(() => {});
      // 첫 프레임까지 잠깐 기다림(크기를 알아야 자를 수 있음)
      for (let i = 0; i < 40 && !video.videoWidth; i++) await new Promise((r) => setTimeout(r, 50));
      setState('live');
      return true;
    } catch (e) {
      setState(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'unsupported');
      return false;
    }
  }
  function stop() {
    if (stream) for (const t of stream.getTracks()) { try { t.stop(); } catch (e) {} }
    stream = null;
    video.srcObject = null;
    if (state === 'live' || state === 'asking') setState('off');
  }
  /** 폰 카메라 앱으로 직접 찍기(카메라 권한이 없거나 http 일 때) */
  function useFile() {
    stop();
    stopFake();
    setState('file');
  }
  /** 시험 카메라: 그림 얼굴이 움직이는 캔버스 */
  function useFake(slot = 1, color = '#ff5a5f') {
    stop();
    if (!fake) {
      const cv = document.createElement('canvas');
      cv.className = 'camv';
      cv.width = 480;
      cv.height = 640;
      fake = { cv, slot, color, pose: 'smile', timer: null };
    }
    fake.slot = slot;
    fake.color = color;
    const draw = () => drawAvatar(fake.cv.getContext('2d'), fake.cv.width, fake.cv.height, { slot: fake.slot, t: performance.now() / 1000, pose: fake.pose, badge: '시험', color: fake.color });
    draw();
    clearInterval(fake.timer);
    fake.timer = setInterval(draw, 80);
    el = fake.cv;
    if (box) mount(box);
    setState('fake');
  }
  function stopFake() {
    if (!fake) return;
    clearInterval(fake.timer);
    fake.timer = null;
    if (fake.cv.parentNode) fake.cv.remove();
  }
  function setPose(p) { if (fake) fake.pose = p || 'smile'; }

  function mount(container) {
    if (!container) return;
    if (el.parentNode !== container) container.insertBefore(el, container.firstChild);
    if (el === video && stream) video.play().catch(() => {});
  }
  /** 미리보기를 이 상자로 옮깁니다(한 번에 한 곳만 보임). */
  function attach(container) {
    box = container;
    if (state === 'live' || state === 'fake' || state === 'asking') mount(container);
  }
  function size() {
    if (el === video) return [video.videoWidth || 0, video.videoHeight || 0];
    return [el.width, el.height];
  }
  const ready = () => (state === 'live' && video.videoWidth > 0) || state === 'fake';
  /** 지금 보이는 그대로(가운데 잘림, 거울 반전) aspect 비율로 */
  function grab(aspect, maxEdge = MAX_EDGE) {
    if (!ready()) return null;
    const [w, h] = size();
    return cropTo(el, w, h, aspect, maxEdge, el === video);
  }
  // 큰 화면용 작은 미리보기(하나를 계속 다시 씀)
  const small = document.createElement('canvas');
  function thumb(aspect, longEdge = 200, q = 0.6) {
    if (!ready()) return null;
    const [w, h] = size();
    let cw = w;
    let ch = w / aspect;
    if (ch > h) { ch = h; cw = h * aspect; }
    const k = longEdge / Math.max(cw, ch);
    const ow = Math.max(1, Math.round(cw * k));
    const oh = Math.max(1, Math.round(ch * k));
    if (small.width !== ow || small.height !== oh) { small.width = ow; small.height = oh; }
    const g = small.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (el === video) { g.translate(ow, 0); g.scale(-1, 1); }
    try { g.drawImage(el, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, ow, oh); } catch (e) { return null; }
    return small.toDataURL('image/jpeg', q);
  }

  // 직접 찍기: <input type=file capture=user>. 반드시 탭 안에서 불러야 열립니다.
  let fileInput = null;
  function pickFile(aspect) {
    if (!fileInput) {
      fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.setAttribute('capture', 'user');
      fileInput.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(fileInput);
    }
    fileInput.value = '';
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      fileInput.onchange = async () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f) { finish(null); return; }
        try {
          const url = URL.createObjectURL(f);
          const img = new Image();
          img.src = url;
          await img.decode();
          const c = cropTo(img, img.naturalWidth, img.naturalHeight, aspect, MAX_EDGE, false);
          URL.revokeObjectURL(url);
          finish(c);
        } catch (e) { finish(null); }
      };
      fileInput.oncancel = () => finish(null);
      fileInput.click();
    });
  }

  // 화면을 다시 켜면 끊긴 카메라를 다시 잡습니다(권한은 이미 있음).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (stream && !stream.getVideoTracks().some((t) => t.readyState === 'live')) { stream = null; start(); }
    else if (stream) video.play().catch(() => {});
  });

  return {
    start, stop, useFile, useFake, setPose, attach, grab, thumb, pickFile, size,
    get state() { return state; },
    get el() { return el; },
    get mirrored() { return el === video; },
    ready,
    canLive: canGum,
    onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
  };
}
