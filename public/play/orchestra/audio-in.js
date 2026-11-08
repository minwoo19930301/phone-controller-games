// 폰 마이크로 숨(트럼펫·호른의 "후")과 목소리 음높이(성악가)를 읽습니다.
//
// - 숨: 소리 크기(RMS)와 '잡음다움'(스펙트럼 평탄도), 낮은 대역 바람 소리 비율로 봅니다. 폰 스피커에서 나는 악기 소리(배음이 뚜렷함)는
//   평탄도가 낮아 숨으로 잡히지 않게 했습니다. 시작은 엄격하게(잡음다워야 함), 이어 불기는 크기만 봅니다.
// - 목소리: YIN 음높이 검출(2배 솎아 계산을 줄임). 메아리 제거·잡음 억제를 켠 마이크를 씁니다.
// 실폰 검증 전이라 문턱값은 바뀔 수 있습니다. 주소에 ?mic=sim 을 붙이면 마이크 없이 흉내 냅니다(시험용).

const params = new URLSearchParams(location.search);
export const MIC_SIM = params.get('mic') === 'sim';

/** 마이크 열기. 반환: { an, ctx, close() }. 실패하면 예외. */
export async function openMic(ctx, { voice = false } = {}) {
  if (MIC_SIM) return { sim: true, an: null, ctx, close() {} };
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no-mic-api');
  // iOS 17+: 녹음과 재생을 같이 하는 세션으로(스피커 소리가 수화기로 작아지지 않게)
  if (navigator.audioSession) { try { navigator.audioSession.type = 'play-and-record'; } catch (e) {} }
  const audio = voice
    ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
    : { echoCancellation: true, noiseSuppression: false, autoGainControl: false, channelCount: 1 };
  const stream = await navigator.mediaDevices.getUserMedia({ audio });
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  an.smoothingTimeConstant = 0;
  src.connect(an);
  // 어떤 브라우저는 출력에 이어지지 않은 분석기를 돌리지 않아서, 소리 0 으로 이어 둡니다.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  an.connect(mute).connect(ctx.destination);
  return {
    an, ctx, stream,
    close() {
      for (const t of stream.getTracks()) { try { t.stop(); } catch (e) {} }
      try { src.disconnect(); an.disconnect(); mute.disconnect(); } catch (e) {}
    },
  };
}

// ───────── 숨 ─────────
export function createBreath(mic) {
  const an = mic.an;
  const td = an ? new Float32Array(an.fftSize) : null;
  const fd = an ? new Float32Array(an.frequencyBinCount) : null;
  const binHz = an ? mic.ctx.sampleRate / an.fftSize : 1;
  let floor = 0.006; // 조용할 때 크기(천천히 따라감)
  let on = false, okFrames = 0, lowSince = 0, level = 0;
  const sim = { level: 0 };
  const st = { rms: 0, flat: 0, low: 0, thr: 0 };
  function read(now = performance.now()) {
    let onset = false;
    if (!an) {
      const want = sim.level > 0.05;
      if (want && !on) onset = true;
      on = want;
      level = sim.level;
      return { on, onset, level, ...st };
    }
    an.getFloatTimeDomainData(td);
    let sum = 0;
    for (let i = 0; i < td.length; i++) sum += td[i] * td[i];
    const rms = Math.sqrt(sum / td.length);
    an.getFloatFrequencyData(fd);
    const a = Math.max(1, Math.round(150 / binHz)), b = Math.min(fd.length - 1, Math.round(5000 / binHz));
    let lsum = 0, psum = 0, lowP = 0, allP = 0;
    for (let i = a; i <= b; i++) {
      const p = Math.pow(10, fd[i] / 10) + 1e-12;
      lsum += Math.log(p); psum += p;
    }
    for (let i = 1; i <= b; i++) { const p = Math.pow(10, fd[i] / 10); allP += p; if (i * binHz < 320) lowP += p; }
    const n = b - a + 1;
    const flat = Math.exp(lsum / n) / (psum / n);
    const low = allP > 0 ? lowP / allP : 0;
    // 조용할 때만 바닥 크기를 갱신합니다
    if (!on) floor = rms < floor ? floor * 0.9 + rms * 0.1 : floor * 0.997 + rms * 0.003;
    floor = Math.max(0.002, Math.min(0.05, floor));
    const thr = Math.max(0.012, floor * 4.2);
    st.rms = rms; st.flat = flat; st.low = low; st.thr = thr;
    const breathy = flat > 0.16 || low > 0.4;
    if (!on) {
      okFrames = rms > thr && breathy ? okFrames + 1 : 0;
      if (okFrames >= 2) { on = true; onset = true; lowSince = 0; }
    } else if (rms < thr * 0.55) {
      if (!lowSince) lowSince = now;
      if (now - lowSince > 90) { on = false; okFrames = 0; }
    } else lowSince = 0;
    const raw = on ? Math.min(1, Math.max(0.12, Math.sqrt(Math.max(0, rms - thr * 0.5) / (thr * 7)))) : 0;
    level += (raw - level) * (raw > level ? 0.6 : 0.3);
    return { on, onset, level, ...st };
  }
  return { read, sim, get floor() { return floor; } };
}

// ───────── 목소리 음높이(YIN) ─────────
export function createPitch(mic) {
  const an = mic.an;
  const sr = an ? mic.ctx.sampleRate : 48000;
  const td = an ? new Float32Array(an.fftSize) : null;
  const dec = sr > 30000 ? 2 : 1;
  const N = an ? Math.floor(an.fftSize / dec) : 1024;
  const x = new Float32Array(N);
  const srD = sr / dec;
  const maxTau = Math.min(Math.floor(srD / 70), Math.floor(N / 2));
  const minTau = Math.max(2, Math.floor(srD / 1100));
  const d = new Float32Array(maxTau + 1);
  let floor = 0.004;
  const sim = { midi: null, level: 0 };
  const hist = [];
  function read() {
    if (!an) {
      if (sim.midi == null || sim.level <= 0.02) return { midi: null, rms: 0, level: 0 };
      return { midi: sim.midi + (Math.random() - 0.5) * 0.15, rms: sim.level * 0.1, level: sim.level, conf: 0.95 };
    }
    an.getFloatTimeDomainData(td);
    let sum = 0;
    for (let i = 0, j = 0; i < N; i++, j += dec) { const v = dec === 2 ? (td[j] + td[j + 1]) * 0.5 : td[j]; x[i] = v; sum += v * v; }
    const rms = Math.sqrt(sum / N);
    const gate = Math.max(0.01, floor * 3.2);
    if (rms < gate) {
      floor = floor * 0.98 + rms * 0.02;
      hist.length = 0;
      return { midi: null, rms, level: 0 };
    }
    const W = N - maxTau;
    d[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= maxTau; tau++) {
      let s = 0;
      for (let i = 0; i < W; i++) { const df = x[i] - x[i + tau]; s += df * df; }
      run += s;
      d[tau] = run > 0 ? (s * tau) / run : 1;
    }
    let tau = -1;
    for (let t = minTau; t <= maxTau; t++) {
      if (d[t] < 0.18) { while (t + 1 <= maxTau && d[t + 1] < d[t]) t++; tau = t; break; }
    }
    if (tau < 0) return { midi: null, rms, level: 0 };
    // 포물선 보간
    const a = d[tau - 1] ?? d[tau], b = d[tau], c = d[tau + 1] ?? d[tau];
    const den = a - 2 * b + c;
    const t2 = den ? tau + (a - c) / (2 * den) : tau;
    const f = srD / t2;
    let midi = 69 + 12 * Math.log2(f / 440);
    hist.push(midi);
    if (hist.length > 3) hist.shift();
    const sorted = hist.slice().sort((p, q) => p - q);
    midi = sorted[sorted.length >> 1];
    const level = Math.min(1, Math.max(0.15, (rms - gate) / (gate * 6) + 0.25));
    return { midi, rms, level, conf: 1 - b };
  }
  return { read, sim };
}
