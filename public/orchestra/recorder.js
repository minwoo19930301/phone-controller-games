// 연주 녹화: 큰 화면 그림(1280×720, 30fps)과 전체 소리를 MediaRecorder 로 담습니다.
// 소리 = 큰 화면 반주(스피커로 나가는 것) + 사람 파트(폰에서 온 동작을 녹화에만 다시 연주, 스피커로는 안 나감).
// 폰 동작은 네트워크를 거쳐 늦게 오므로, 반주를 delay 초만큼 늦춰 섞어 둘이 맞게 합니다.
// 파일은 이 화면 메모리(Blob)에만 있고, 다음 곡을 시작하거나 페이지를 닫으면 지웁니다.
const TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

export function pickType() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of TYPES) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) {} }
  return '';
}

export function createRecorder({ synth, recSynth, delay = 0.08, draw, width = 1280, height = 720, fps = 30 }) {
  const type = pickType();
  if (type === null) throw new Error('MediaRecorder 없음');
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const g = cv.getContext('2d', { alpha: false });
  const ctx = synth.ctx;
  const dest = ctx.createMediaStreamDestination();
  const dl = ctx.createDelay(1);
  dl.delayTime.value = delay;
  dl.connect(dest);
  const unplugA = synth.renderTo(dl);
  const unplugB = recSynth ? recSynth.renderTo(dest) : () => {};
  const vstream = cv.captureStream(fps);
  const stream = new MediaStream([...vstream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const opts = { videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 };
  if (type) opts.mimeType = type;
  const mr = new MediaRecorder(stream, opts);
  const chunks = [];
  mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  let lastDraw = 0;
  let done = false;
  function cleanup() {
    try { unplugA(); } catch (e) {}
    try { unplugB(); } catch (e) {}
    try { dl.disconnect(); } catch (e) {}
    for (const t of stream.getTracks()) { try { t.stop(); } catch (e) {} }
  }
  return {
    type: type || mr.mimeType,
    start() { g.fillStyle = '#000'; g.fillRect(0, 0, width, height); mr.start(1000); },
    /** 매 프레임(3D 그림을 그린 직후) 부릅니다. 30fps 로 솎습니다. */
    frame() {
      if (done) return;
      const now = performance.now();
      if (now - lastDraw < 1000 / fps - 2) return;
      lastDraw = now;
      try { draw(g, width, height); } catch (e) { console.error('[recorder]', e); }
    },
    stop() {
      if (done) return Promise.resolve(null);
      done = true;
      return new Promise((resolve) => {
        mr.onstop = () => { cleanup(); resolve(new Blob(chunks, { type: (mr.mimeType || type || 'video/webm').split(';')[0] })); };
        try { mr.stop(); } catch (e) { cleanup(); resolve(null); }
      });
    },
    cancel() { if (done) return; done = true; mr.onstop = () => cleanup(); try { mr.stop(); } catch (e) { cleanup(); } chunks.length = 0; },
  };
}
