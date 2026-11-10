// 실제 악기 녹음 샘플과 WebAudio 대체 음색을 사용하는 악기 모음과 박자 스케줄러(Transport)입니다.
// 큰 화면(자동 반주·녹화 믹스)과 폰(내 악기 소리) 모두에서 씁니다. 필요한 악기 샘플만 불러옵니다.
//
//   const synth = createSynth();                 // 탭 안에서 await synth.resume() 으로 소리를 엽니다
//   const vio = synth.instrument('violin');      // 악기 하나
//   vio.play(76, { when: synth.now(), dur: 0.5, vel: 0.8 });   // 길이를 아는 음
//   const v = vio.noteOn(76); v.setLevel(0.6); v.off();        // 누르는 동안 이어지는 음(활 긋기·불기·노래)
//   const tr = createTransport(synth); tr.load(song); tr.start(); tr.setRate(1.1);  // 곡 재생·지휘 빠르기
//   const unplug = synth.renderTo(mediaStreamDestination);     // 녹화용 믹스로도 내보내기
//
// 소리 길: 악기 → (패닝) → 버스 → 저역 정리·고역 다듬기 → 부드러운 컴프레서 → 리미터 → 스피커.
// 잔향은 패닝 앞에서 보내 스테레오 홀 잔향(초기 반사 + 고역이 먼저 줄어드는 꼬리)으로 섞습니다.
// 반주(Transport·renderOffline)는 사람 손맛을 입힙니다: 박 위치·프레이즈에 따른 세기, 반주 파트의 작은 타이밍 흔들림,
// 화음 굴림, 이어지는 선율의 레가토. 판정에 쓰는 파트(melody·drums·perc)의 시각은 건드리지 않습니다.
// recordOnly 악기는 스피커로 나가지 않는 녹화 전용 길로만 갑니다(큰 화면이 폰 연주를 녹화에만 섞을 때).

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

export const INSTRUMENT_INFO = {
  piano: { label: '피아노', family: 'keys', range: [21, 108], sustain: false },
  strings: { label: '현악 합주', family: 'strings', range: [36, 96], sustain: true },
  violin: { label: '바이올린', family: 'strings', range: [55, 100], sustain: true },
  cello: { label: '첼로', family: 'strings', range: [36, 76], sustain: true },
  trumpet: { label: '트럼펫', family: 'brass', range: [52, 84], sustain: true },
  horn: { label: '호른', family: 'brass', range: [41, 77], sustain: true },
  flute: { label: '플루트', family: 'wind', range: [60, 98], sustain: true },
  choir: { label: '합창', family: 'voice', range: [40, 84], sustain: true },
  bass: { label: '베이스', family: 'bass', range: [28, 60], sustain: true },
  drums: { label: '드럼', family: 'perc', range: [35, 85], sustain: false },
  castanets: { label: '캐스터네츠', family: 'perc', range: [0, 127], sustain: false },
  glock: { label: '글로켄슈필', family: 'bells', range: [72, 108], sustain: false },
  celesta: { label: '첼레스타', family: 'bells', range: [60, 108], sustain: false },
  timpani: { label: '팀파니', family: 'perc', range: [36, 60], sustain: false },
};
export const INSTRUMENTS = Object.keys(INSTRUMENT_INFO);

// ───────────── 공용 재료 ─────────────
const noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const d = b.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x3fffffff) - 1; }
    noiseCache.set(ctx, b);
  }
  return b;
}
const waveCache = new WeakMap();
function periodic(ctx, key, amps) {
  let m = waveCache.get(ctx);
  if (!m) { m = new Map(); waveCache.set(ctx, m); }
  if (!m.has(key)) {
    const real = new Float32Array(amps.length + 1), imag = new Float32Array(amps.length + 1);
    amps.forEach((a, i) => (imag[i + 1] = a));
    m.set(key, ctx.createPeriodicWave(real, imag));
  }
  return m.get(key);
}
const PIANO_WAVE = [1, 0.62, 0.38, 0.22, 0.17, 0.1, 0.07, 0.05, 0.035, 0.022, 0.015, 0.01];
const BRASS_WAVE = [1, 0.85, 0.7, 0.55, 0.45, 0.36, 0.28, 0.22, 0.17, 0.13, 0.1, 0.08, 0.06];

// 공연장 잔향: 좌우가 서로 다른(비상관) 꼬리 + 초기 반사. 저역은 길게(약 2.3초), 고역은 짧게(약 1초) 줄어
// 실제 홀처럼 뒤로 갈수록 어두워집니다. 문맥(ctx)마다 한 번만 만듭니다(본 체인·녹화 체인이 같이 씀).
const irCache = new WeakMap();
function hallImpulse(ctx) {
  let b = irCache.get(ctx);
  if (b) return b;
  const sr = ctx.sampleRate;
  const len = 2.6, pre = 0.016;
  const n = Math.floor(sr * len);
  b = ctx.createBuffer(2, n, sr);
  const rtLow = 2.3, rtHigh = 0.95;
  const onePole = (fc) => 1 - Math.exp((-2 * Math.PI * fc) / sr);
  const aLow = onePole(3200), aMud = onePole(140);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let s = 9173 + c * 7919;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s / 0x3fffffff) - 1; };
    // 꼬리: 노이즈를 저역/고역으로 나눠 다른 빠르기로 줄입니다
    let lp = 0, mud = 0;
    const p0 = Math.floor(sr * pre);
    for (let i = p0; i < n; i++) {
      const t = (i - p0) / sr;
      const x = rnd();
      lp += (x - lp) * aLow;
      mud += (lp - mud) * aMud;
      const low = lp - mud * 0.55; // 너무 웅웅거리지 않게 아주 낮은 대역은 덜어 냅니다
      const high = x - lp;
      const envL = Math.exp((-6.9 * t) / rtLow), envH = Math.exp((-6.9 * t) / rtHigh);
      const fadeIn = t < 0.045 ? Math.pow(t / 0.045, 1.5) : 1; // 꼬리는 초기 반사 뒤에서 서서히 차오릅니다
      const fadeOut = i > n - sr * 0.15 ? (n - i) / (sr * 0.15) : 1;
      d[i] = (low * 1.6 * envL + high * 0.38 * envH) * fadeIn * fadeOut * 0.5;
    }
    // 초기 반사: 벽·천장에서 돌아오는 몇 개의 또렷한 반사(좌우 시각이 다름)
    for (let k = 0; k < 16; k++) {
      const at = pre + 0.004 + Math.pow((k + 0.5 + rnd() * 0.4) / 16, 1.6) * 0.085;
      const i = Math.floor(at * sr);
      const g = (0.55 - k * 0.025) * (rnd() > 0 ? 1 : -1) * (0.7 + 0.3 * Math.abs(rnd()));
      // 반사마다 조금 뭉툭하게(벽에 고역이 먹힘)
      for (let j = 0; j < 6 && i + j < n; j++) d[i + j] += g * [0.35, 0.6, 0.45, 0.25, 0.12, 0.05][j];
    }
  }
  irCache.set(ctx, b);
  return b;
}

// ───────────── 사람 손맛(반주용) ─────────────
// 같은 곡·같은 파트면 언제나 같은 결과(결정적). 처음부터 다시 틀거나 중간부터 틀어도 똑같이 들립니다.
function hash01(a, b, c) {
  let h = 2166136261 ^ (a * 374761393) ^ (b * 668265263) ^ (c * 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296) * 2 - 1; // -1 ~ 1
}
const strHash = (s) => { let h = 7; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
// 판정(채보)에 쓰는 파트는 시각을 그대로 둡니다. charts.js 는 melody 와 drums 를 씁니다.
const JUDGED = new Set(['melody', 'drums', 'perc']);
// 굴림(아르페지오처럼 아래에서 위로 살짝 흩어 치기)이 어울리는 악기
const ROLL = { piano: 0.016, celesta: 0.012, glock: 0.01, strings: 0.005, choir: 0.006, horn: 0.006 };
/**
 * 파트의 각 음에 { dt: 시각 보정(초), v: 세기 배율, x: 길이 연장(초) } 를 만듭니다. notes 는 박 순서로 정렬된 상태.
 * 박 위치(강박·약박), 4마디 프레이즈의 크레셴도·디크레셴도, 선율 높낮이, 작은 무작위를 섞습니다.
 */
function makeFeel(notes, { part = '', inst = '', barLen = 4, seed = 0, timeSig = null } = {}) {
  const compound = !!(timeSig && timeSig[1] === 8 && timeSig[0] % 3 === 0); // 6/8·9/8: 셋잇단 묶음이 한 박
  const judged = JUDGED.has(part);
  const perc = inst === 'drums' || inst === 'castanets';
  const sustained = !!(INSTRUMENT_INFO[inst] && INSTRUMENT_INFO[inst].sustain);
  const roll = judged ? 0 : ROLL[inst] || 0;
  const bar = barLen > 0 ? barLen : 4;
  const phrase = bar * 4;
  const sd = seed ^ strHash(part);
  let mid = 0;
  for (const n of notes) mid += n[2];
  mid = notes.length ? mid / notes.length : 60;
  const out = new Array(notes.length);
  let drift = 0;
  for (let i = 0; i < notes.length; i++) {
    const [beat, dur, midi] = notes[i];
    const pos = ((beat % bar) + bar) % bar;
    const frac = pos - Math.floor(pos + 1e-6);
    // 박 위치: 마디 첫 박 > 가운데 박 > 정박 > 뒷박 > 16분
    let acc = 1;
    if (compound) {
      // 6/8: 첫째·넷째 8분음표가 박(점4분음표마다), 나머지 8분음표는 가볍게
      const pulse = Math.abs(pos / 1.5 - Math.round(pos / 1.5)) < 0.014;
      const eighth = Math.abs(pos * 2 - Math.round(pos * 2)) < 0.04;
      acc = pos < 0.02 ? 1.08 : pulse ? 1.03 : eighth ? 0.93 : 0.86;
    } else if (pos < 0.02) acc = 1.08;
    else if (bar % 2 === 0 && Math.abs(pos - bar / 2) < 0.02) acc = 1.03;
    else if (frac < 0.02 || frac > 0.98) acc = 1;
    else if (Math.abs(frac - 0.5) < 0.02) acc = 0.9;
    else acc = 0.86;
    // 프레이즈: 4마디 동안 3/5 지점까지 커졌다가 끝에서 가라앉습니다
    const ph = (((beat % phrase) + phrase) % phrase) / phrase;
    const shape = 0.9 + 0.14 * Math.sin(Math.PI * Math.pow(ph, 0.75));
    // 선율은 높은 음을 조금 더 노래하듯
    const contour = perc ? 0 : Math.max(-0.06, Math.min(0.06, (midi - mid) * 0.006));
    const r = hash01(sd, Math.round(beat * 96), midi);
    let v = acc * (perc ? 1 : shape) * (1 + contour) * (1 + r * (perc ? 0.07 : 0.06));
    // 타이밍: 반주만 ±약 10ms, 이웃 음과 이어지는 흔들림(사람이 밀고 당기는 느낌)
    let dt = 0;
    if (!judged) {
      drift = drift * 0.55 + hash01(sd + 17, Math.round(beat * 96), 3) * 0.45;
      dt = drift * (perc ? 0.004 : 0.011);
    }
    out[i] = { dt, v, x: 0 };
  }
  // 같은 박에 겹친 음(화음): 아래에서 위로 굴리고, 맨 윗음을 살짝 살립니다
  for (let i = 0; i < notes.length;) {
    let j = i + 1;
    while (j < notes.length && Math.abs(notes[j][0] - notes[i][0]) < 1e-3) j++;
    if (j - i > 1) {
      const idx = [];
      for (let k = i; k < j; k++) idx.push(k);
      idx.sort((a, b) => notes[a][2] - notes[b][2]);
      idx.forEach((k, rank) => {
        if (roll) out[k].dt += rank * roll * (0.8 + 0.4 * Math.abs(hash01(sd + 5, k, rank)));
        out[k].v *= rank === idx.length - 1 ? 1.05 : 0.93; // 화음은 윗소리가 들리게, 안쪽은 한 발 물러서게
      });
    }
    i = j;
  }
  // 길이: 이어지는 선율은 다음 음과 살짝 겹치게(레가토), 피아노 반주는 페달처럼 조금 더 울리게
  if (!perc) {
    for (let i = 0; i < notes.length; i++) {
      const end = notes[i][0] + notes[i][1];
      let joined = false, same = false;
      for (let k = i + 1; k < notes.length && notes[k][0] <= end + 0.02; k++) if (notes[k][0] >= end - 0.02) { joined = true; if (notes[k][2] === notes[i][2]) same = true; break; }
      // 같은 음을 다시 칠 때는 겹치지 않고 아주 살짝 끊어 새로 긋는 게 들리게
      if (sustained && same) out[i].x = -0.04;
      else if (sustained && joined) out[i].x = 0.07;
      else if (inst === 'piano' && !judged) out[i].x = 0.12;
      else if (inst === 'piano' && joined) out[i].x = 0.03;
    }
  }
  return out;
}

// 오케스트라 자리(무대 왼쪽 -1 ~ 오른쪽 +1): 바이올린 왼쪽, 첼로·베이스 오른쪽, 금관 뒤 가운데, 목관 가운데 살짝 왼쪽.
// 반주가 악기를 만들 때만 씁니다(폰이 내는 내 악기 소리는 가운데 그대로).
export const SEAT = { violin: -0.42, strings: -0.28, piano: -0.12, celesta: -0.3, glock: 0.28, flute: -0.08, choir: 0, trumpet: 0.12, horn: 0.22, cello: 0.34, bass: 0.45, timpani: 0.2, drums: 0.06, castanets: 0.15 };
const seatFor = (inst, part) => (SEAT[inst] ?? 0) * (part === 'melody' ? 0.45 : 1);

function osc(ctx, type, f) {
  const o = ctx.createOscillator();
  if (type === 'piano') o.setPeriodicWave(periodic(ctx, 'piano', PIANO_WAVE));
  else if (type === 'brass') o.setPeriodicWave(periodic(ctx, 'brass', BRASS_WAVE));
  else o.type = type;
  o.frequency.value = f;
  return o;
}
function holdAt(param, t) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else { param.cancelScheduledValues(t); }
}

// ───────────── 이어지는 음(현·관·목소리·베이스) ─────────────
const SUSTAIN = {
  violin: { oscs: [['sawtooth', -6, 0.5], ['sawtooth', 6, 0.5]], lp: (f, v) => Math.min(9000, f * 6 + 1800) * (0.6 + 0.4 * v), q: 0.9, peak: [2600, 3, 4], noise: [3200, 0.7, 0.045], a: 0.07, d: 0.2, s: 0.85, r: 0.16, vib: [5.6, 0.0045, 0.22], level: 0.32 },
  strings: { oscs: [['sawtooth', -11, 0.34], ['sawtooth', 0, 0.34], ['sawtooth', 12, 0.34]], lp: (f, v) => Math.min(6500, f * 4 + 1300) * (0.65 + 0.35 * v), q: 0.6, a: 0.16, d: 0.3, s: 0.9, r: 0.38, vib: [5, 0.003, 0.3], level: 0.3 },
  cello: { oscs: [['sawtooth', -5, 0.5], ['sawtooth', 5, 0.5]], lp: (f, v) => Math.min(4200, f * 5 + 700) * (0.6 + 0.4 * v), q: 0.8, peak: [900, 2, 3], noise: [1800, 0.8, 0.03], a: 0.08, d: 0.2, s: 0.85, r: 0.2, vib: [5.2, 0.004, 0.25], level: 0.38 },
  trumpet: { oscs: [['brass', 0, 1]], lp: (f, v) => Math.min(7500, f * 8) * (0.55 + 0.45 * v), lpEnv: 'brass', q: 1.4, shape: 1.6, scoop: -40, a: 0.025, d: 0.12, s: 0.82, r: 0.1, vib: [5.5, 0.003, 0.35], level: 0.3 },
  horn: { oscs: [['brass', 0, 0.75], ['sine', 0, 0.45]], lp: (f, v) => Math.min(2200, f * 3.2) * (0.6 + 0.4 * v), lpEnv: 'brass', q: 0.6, scoop: -25, a: 0.06, d: 0.15, s: 0.9, r: 0.2, vib: [5, 0.002, 0.4], level: 0.42 },
  flute: { oscs: [['sine', 0, 0.85], ['triangle', 0, 0.22], ['sine', 1200, 0.07]], lp: () => 6000, q: 0.5, noise: [2600, 0.5, 0.055], chiff: 0.12, a: 0.05, d: 0.15, s: 0.88, r: 0.12, vib: [5, 0.004, 0.22], level: 0.42 },
  choir: { oscs: [['sawtooth', -13, 0.34], ['sawtooth', 0, 0.34], ['sawtooth', 14, 0.34]], formants: true, lp: () => 3800, q: 0.5, a: 0.18, d: 0.3, s: 0.9, r: 0.4, vib: [5.3, 0.006, 0.2], level: 0.75 },
  bass: { oscs: [['triangle', 0, 0.65], ['sawtooth', 0, 0.28], ['sine', 0, 0.4]], lp: (f, v) => 600 + v * 700, lpEnv: 'pluck', q: 0.9, a: 0.008, d: 0.32, s: 0.55, r: 0.1, level: 0.55 },
};

function sustainVoice(inst, midi, t, vel) {
  const { ctx } = inst;
  const c = SUSTAIN[inst.name];
  const f = midiToFreq(midi);
  const amp = ctx.createGain();
  const level = ctx.createGain();
  level.gain.value = 1;
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.Q.value = c.q;
  const top = c.lp(f, vel);
  if (c.lpEnv === 'brass') {
    filt.frequency.setValueAtTime(Math.max(200, f * 1.2), t);
    filt.frequency.linearRampToValueAtTime(top, t + c.a + 0.03);
    filt.frequency.setTargetAtTime(top * 0.68, t + c.a + 0.03, 0.12);
  } else if (c.lpEnv === 'pluck') {
    filt.frequency.setValueAtTime(top * 1.8, t);
    filt.frequency.setTargetAtTime(top * 0.6, t + 0.01, 0.12);
  } else filt.frequency.value = top;
  let head = filt;
  if (c.shape) {
    const ws = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * c.shape) / Math.tanh(c.shape); }
    ws.curve = curve;
    ws.connect(filt);
    head = ws;
  }
  let tail = filt;
  if (c.peak) {
    const pk = ctx.createBiquadFilter();
    pk.type = 'peaking';
    pk.frequency.value = c.peak[0];
    pk.Q.value = c.peak[1];
    pk.gain.value = c.peak[2];
    filt.connect(pk);
    tail = pk;
  }
  if (c.formants) {
    const low = f < 220;
    const F = low ? [[650, 7, 1], [1080, 9, 0.5], [2650, 11, 0.22]] : [[800, 6, 1], [1150, 8, 0.55], [2900, 10, 0.25], [3550, 12, 0.1]];
    const sum = ctx.createGain();
    for (const [fr, q, g] of F) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fr;
      bp.Q.value = q;
      const gg = ctx.createGain();
      gg.gain.value = g * 2.2;
      tail.connect(bp).connect(gg).connect(sum);
    }
    tail = sum;
  }
  tail.connect(amp).connect(level).connect(inst.out);

  const peak = 0.18 + vel * 0.82;
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + c.a);
  amp.gain.setTargetAtTime(peak * c.s, t + c.a, c.d / 3);

  const oscs = [];
  for (const [type, cents, g] of c.oscs) {
    const o = osc(ctx, type, f);
    o.detune.value = cents;
    if (c.scoop) { o.detune.setValueAtTime(cents + c.scoop, t); o.detune.linearRampToValueAtTime(cents, t + 0.06); }
    const og = ctx.createGain();
    og.gain.value = g;
    o.connect(og).connect(head);
    o.start(t);
    oscs.push({ o, cents });
  }
  let lfo = null;
  if (c.vib) {
    lfo = ctx.createOscillator();
    lfo.frequency.value = c.vib[0];
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(f * c.vib[1], t + c.vib[2] + 0.25);
    lfo.connect(depth);
    for (const { o } of oscs) depth.connect(o.frequency);
    lfo.start(t);
  }
  let nsrc = null;
  if (c.noise) {
    nsrc = ctx.createBufferSource();
    nsrc.buffer = noiseBuffer(ctx);
    nsrc.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = c.noise[0];
    bp.Q.value = c.noise[1];
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(c.noise[2] * (c.chiff ? 3 : 1.6) * (0.5 + vel), t + 0.02);
    ng.gain.setTargetAtTime(c.noise[2] * (0.5 + vel * 0.5), t + 0.03, c.chiff ? 0.04 : 0.1);
    nsrc.connect(bp).connect(ng).connect(amp);
    nsrc.start(t, Math.random() * 1.5);
  }
  let ended = false;
  const v = {
    midi,
    off(when) {
      if (ended) return;
      ended = true;
      const at = Math.max(when ?? ctx.currentTime, t + 0.01);
      holdAt(amp.gain, at);
      amp.gain.setTargetAtTime(0, at, c.r / 3);
      const stop = at + c.r * 2 + 0.05;
      for (const { o } of oscs) o.stop(stop);
      if (lfo) lfo.stop(stop);
      if (nsrc) nsrc.stop(stop);
      v.stopAt = stop;
    },
    setPitch(m, glide = 0.03) {
      const fr = midiToFreq(m);
      const now = ctx.currentTime;
      for (const { o } of oscs) { o.frequency.cancelScheduledValues(now); o.frequency.setTargetAtTime(fr, now, glide); }
      v.midi = m;
    },
    setBend(cents) { const now = ctx.currentTime; for (const { o, cents: c0 } of oscs) o.detune.setTargetAtTime(c0 + cents, now, 0.02); },
    setLevel(x, tc = 0.03) {
      const now = ctx.currentTime;
      level.gain.setTargetAtTime(Math.max(0, x), now, tc);
      if (c.lpEnv === 'brass') filt.frequency.setTargetAtTime(top * (0.35 + 0.5 * Math.min(1.4, x)), now, tc * 2);
    },
    stopAt: Infinity,
  };
  return v;
}

// ───────────── 합창(사람 목소리 '아') ─────────────
// 살짝 어긋난 톱니파 넷(여러 사람) → '아' 모음 포먼트 → 숨소리. 비브라토는 두 빠르기로 나눠 걸어 합창처럼 일렁이게 합니다.
const VOWEL_AH = { low: [[600, 60, 1], [1040, 70, 0.45], [2250, 110, 0.2], [2450, 120, 0.16], [2750, 130, 0.1]], high: [[800, 80, 1], [1150, 90, 0.5], [2900, 120, 0.25], [3550, 130, 0.12], [4950, 140, 0.05]] };
function choirVoice(inst, midi, t, vel) {
  const { ctx } = inst;
  const f = midiToFreq(midi);
  const amp = ctx.createGain();
  const level = ctx.createGain();
  const src = ctx.createGain(); // 성대(톱니파 합) + 숨
  const sum = ctx.createGain();
  src.gain.value = 1;
  // 포먼트(병렬 대역 통과) + 몸통 소리 조금
  const F = f < 230 ? VOWEL_AH.low : VOWEL_AH.high;
  for (const [fr, bw, g] of F) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = fr;
    bp.Q.value = fr / bw;
    const gg = ctx.createGain();
    gg.gain.value = g * 1.9;
    src.connect(bp).connect(gg).connect(sum);
  }
  const body = ctx.createBiquadFilter();
  body.type = 'lowpass';
  body.frequency.value = Math.min(1400, f * 3);
  const bg = ctx.createGain();
  bg.gain.value = 0.16;
  src.connect(body).connect(bg).connect(sum);
  const soft = ctx.createBiquadFilter();
  soft.type = 'lowpass';
  soft.frequency.value = 5200;
  soft.Q.value = 0.4;
  sum.connect(soft).connect(amp).connect(level).connect(inst.out);
  level.gain.value = 1;

  const atk = 0.14 + (1 - Math.min(1, vel)) * 0.14;
  const peak = (0.22 + Math.min(1, vel) * 0.7) * 2.2;
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak * 0.75, t + atk * 0.6);
  amp.gain.linearRampToValueAtTime(peak, t + atk);
  amp.gain.setTargetAtTime(peak * 0.92, t + atk, 0.4);

  const oscs = [];
  const lfoA = ctx.createOscillator(), lfoB = ctx.createOscillator();
  lfoA.frequency.value = 5.1; lfoB.frequency.value = 5.75;
  const dA = ctx.createGain(), dB = ctx.createGain();
  // 비브라토는 소리가 자리 잡은 뒤 천천히(센트 단위)
  for (const d of [dA, dB]) { d.gain.setValueAtTime(0, t); d.gain.linearRampToValueAtTime(13, t + 0.55); }
  lfoA.connect(dA); lfoB.connect(dB);
  [-15, -5, 6, 16].forEach((cents, k) => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.detune.value = cents;
    o.detune.setValueAtTime(cents - 18, t); // 사람 목소리는 살짝 아래에서 올라와 자리 잡습니다
    o.detune.linearRampToValueAtTime(cents, t + 0.09 + k * 0.02);
    (k % 2 ? dB : dA).connect(o.detune);
    const og = ctx.createGain();
    og.gain.value = 0.26;
    o.connect(og).connect(src);
    o.start(t);
    oscs.push({ o, cents });
  });
  lfoA.start(t); lfoB.start(t);
  // 숨소리: 포먼트를 통과하는 노이즈(‘하’ 하는 공기)
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx);
  n.loop = true;
  const nh = ctx.createBiquadFilter();
  nh.type = 'highpass';
  nh.frequency.value = 500;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0, t);
  ng.gain.linearRampToValueAtTime(0.22, t + atk * 0.5);
  ng.gain.setTargetAtTime(0.07, t + atk, 0.15);
  n.connect(nh).connect(ng).connect(src);
  n.start(t, Math.random() * 1.5);
  let ended = false;
  const v = {
    midi, stopAt: Infinity,
    off(when) {
      if (ended) return;
      ended = true;
      const at = Math.max(when ?? ctx.currentTime, t + 0.02);
      holdAt(amp.gain, at);
      amp.gain.setTargetAtTime(0, at, 0.16);
      const stop = at + 0.9;
      for (const { o } of oscs) o.stop(stop);
      lfoA.stop(stop); lfoB.stop(stop); n.stop(stop);
      v.stopAt = stop;
    },
    setPitch(m, glide = 0.03) {
      const fr = midiToFreq(m);
      const now = ctx.currentTime;
      for (const { o } of oscs) { o.frequency.cancelScheduledValues(now); o.frequency.setTargetAtTime(fr, now, glide); }
      v.midi = m;
    },
    setBend(cents) { const now = ctx.currentTime; for (const { o, cents: c0 } of oscs) { holdAt(o.detune, now); o.detune.setTargetAtTime(c0 + cents, now, 0.02); } },
    setLevel(x, tc = 0.03) { level.gain.setTargetAtTime(Math.max(0, x), ctx.currentTime, tc); },
  };
  return v;
}

// ───────────── 때리는 음(피아노·종·팀파니) ─────────────
function pianoVoice(inst, midi, t, vel) {
  const { ctx } = inst;
  const f = midiToFreq(midi);
  const amp = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.5;
  const bright = Math.min(14000, f * (3 + vel * 9) + 900);
  lp.frequency.setValueAtTime(bright, t);
  lp.frequency.setTargetAtTime(Math.max(f * 2.2, 500), t + 0.01, 0.35 + (108 - midi) * 0.006);
  lp.connect(amp).connect(inst.out);
  const peak = 0.12 + vel * 0.6;
  const tc = Math.max(0.25, Math.min(2.4, 2.6 - (midi - 36) * 0.035));
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.004);
  amp.gain.setTargetAtTime(peak * 0.55, t + 0.004, 0.08);
  amp.gain.setTargetAtTime(0, t + 0.12, tc);
  const o1 = osc(ctx, 'piano', f), o2 = osc(ctx, 'piano', f);
  o2.detune.value = midi > 48 ? 3.5 : 1.5;
  const g2 = ctx.createGain();
  g2.gain.value = midi > 40 ? 0.7 : 0.3;
  o1.connect(lp);
  o2.connect(g2).connect(lp);
  o1.start(t); o2.start(t);
  // 망치 소리
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = Math.min(6000, 1400 + f * 2);
  bp.Q.value = 0.9;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(vel * 0.12, t);
  ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.035);
  n.connect(bp).connect(ng).connect(inst.out);
  n.start(t, Math.random());
  n.stop(t + 0.05);
  const natural = t + tc * 5 + 0.2;
  o1.stop(natural); o2.stop(natural);
  let ended = false;
  const v = {
    midi, stopAt: natural,
    off(when) {
      if (ended) return;
      ended = true;
      const at = Math.max(when ?? ctx.currentTime, t + 0.02);
      if (at >= natural) return;
      holdAt(amp.gain, at);
      amp.gain.setTargetAtTime(0, at, 0.05);
      const stop = Math.min(natural, at + 0.4);
      o1.stop(stop); o2.stop(stop);
      v.stopAt = stop;
    },
    setPitch() {}, setBend() {}, setLevel() {},
  };
  return v;
}

// 부분음 [진동수 배율, 세기, 울림 길이(초), 살짝 어긋남(센트)]. 실제 악기의 진동 모드를 따랐습니다.
//  글로켄슈필: 쇠막대(1 : 2.76 : 5.40 : 8.93), 첼레스타: 공명통이 있는 쇠판(배음이 고르고 바탕음이 길게),
//  팀파니: 조율된 막(주요 모드 1 : 1.5 : 2 : 2.44 : 2.9) + 금방 사라지는 낮은 '둥'(0,1 모드).
const BELLS = {
  glock: { parts: [[1, 1, 1.7, 0], [1, 0.25, 1.4, 2.5], [2.76, 0.3, 0.42, 0], [5.4, 0.12, 0.18, 0], [8.93, 0.05, 0.08, 0]], level: 0.32, mallet: [7000, 'highpass', 0.06, 0.012] },
  celesta: { parts: [[1, 1, 1.25, 0], [1, 0.3, 1.0, 1.8], [2, 0.16, 0.5, 0], [3, 0.06, 0.25, 0], [4.02, 0.035, 0.14, 0], [6.9, 0.03, 0.035, 0]], level: 0.4, mallet: [3200, 'bandpass', 0.05, 0.01] },
  timpani: { parts: [[0.62, 0.55, 0.22, 0], [1, 1, 1.9, 0], [1.504, 0.42, 1.15, 0], [1.742, 0.12, 0.6, 0], [2.0, 0.26, 0.8, 0], [2.44, 0.12, 0.5, 0], [2.9, 0.06, 0.35, 0]], level: 0.72, trim: 0.85, mallet: [900, 'lowpass', 0.45, 0.05], membrane: true },
};
function bellVoice(inst, midi, t, vel) {
  const { ctx } = inst;
  const c = BELLS[inst.name];
  const f = midiToFreq(midi);
  const out = ctx.createGain();
  out.gain.value = c.trim ?? 1;
  out.connect(inst.out);
  const srcs = [];
  let longest = 0;
  const vv = Math.min(1, Math.max(0, vel));
  // 높은 음일수록 짧게, 낮은 음일수록 길게
  const scale = Math.max(0.35, Math.min(1.4, 1.5 - (midi - 60) * 0.02));
  for (const [ratio, g, dec, cents] of c.parts) {
    const fr = f * ratio;
    if (fr > 16000) continue;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.detune.value = cents;
    if (c.membrane) {
      // 막을 치는 순간 장력이 올라 살짝 높게 시작해 제자리로
      o.frequency.setValueAtTime(fr * 1.018, t);
      o.frequency.setTargetAtTime(fr, t, 0.04);
    } else o.frequency.setValueAtTime(fr, t);
    const e = ctx.createGain();
    const d = dec * scale;
    // 세게 칠수록 윗 부분음이 더 많이 나옵니다(밝아짐)
    const bright = ratio > 1.2 ? 0.45 + vv * 0.75 : 1;
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(g * bright * (0.2 + vv * 0.8), t + (c.membrane ? 0.004 : 0.0015));
    e.gain.setTargetAtTime(0, t + 0.006, d / 3);
    o.connect(e).connect(out);
    o.start(t);
    o.stop(t + d * 2.6 + 0.1);
    longest = Math.max(longest, d * 2.6 + 0.1);
    srcs.push(o);
  }
  if (c.mallet) {
    // 채(말렛)가 닿는 소리
    const [fc, type, g, dec] = c.mallet;
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx);
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = c.membrane ? fc * (0.6 + vv * 0.8) : fc;
    fl.Q.value = type === 'bandpass' ? 1.2 : 0.7;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(g * (0.3 + vv * 0.7), t + 0.001);
    ng.gain.setTargetAtTime(0, t + 0.002, dec / 3);
    n.connect(fl).connect(ng).connect(out);
    n.start(t, Math.random());
    n.stop(t + dec * 3 + 0.02);
  }
  const v = {
    midi, stopAt: t + longest,
    off(when) {
      // 종은 손을 떼도 울리게 두되, 아주 길면 살짝 줄입니다.
      const at = Math.max(when ?? ctx.currentTime, t + 0.05);
      if (inst.name === 'timpani' || at > t + longest) return;
      holdAt(out.gain, at);
      out.gain.setTargetAtTime(0, at, 0.4);
    },
    setPitch() {}, setBend() {}, setLevel() {},
  };
  return v;
}

// ───────────── 타악기 ─────────────
function noiseHit(ctx, dst, t, { type = 'bandpass', freq = 3000, q = 0.8, gain = 0.3, dec = 0.1, attack = 0.001, offset = 0 }) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const e = ctx.createGain();
  e.gain.setValueAtTime(0, t + offset);
  e.gain.linearRampToValueAtTime(gain, t + offset + attack);
  e.gain.setTargetAtTime(0, t + offset + attack, dec / 3);
  s.connect(f).connect(e).connect(dst);
  s.start(t + offset, Math.random() * 1.5);
  s.stop(t + offset + dec * 2.5 + 0.02);
}
function toneHit(ctx, dst, t, { f0, f1 = f0, sweep = 0.1, gain = 0.5, dec = 0.2, type = 'sine' }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + sweep);
  const e = ctx.createGain();
  e.gain.setValueAtTime(0, t);
  e.gain.linearRampToValueAtTime(gain, t + 0.002);
  e.gain.setTargetAtTime(0, t + 0.004, dec / 3);
  o.connect(e).connect(dst);
  o.start(t);
  o.stop(t + dec * 2.5 + 0.03);
}
// 쇠붙이(심벌·하이햇·라이드): 서로 배음이 맞지 않는 사각파 여섯 개를 섞어 '찰랑' 하는 금속성을 만듭니다.
const METAL = [1, 1.483, 1.932, 2.546, 2.63, 3.897];
function metalHit(ctx, dst, t, { base = 330, hp = 7000, bp = 10000, gain = 0.2, dec = 0.1, attack = 0.001 }) {
  const mix = ctx.createGain();
  mix.gain.value = 1 / 6;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = bp;
  band.Q.value = 0.7;
  const high = ctx.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = hp;
  const e = ctx.createGain();
  e.gain.setValueAtTime(0, t);
  e.gain.linearRampToValueAtTime(gain, t + attack);
  e.gain.setTargetAtTime(0, t + attack, dec / 3);
  mix.connect(band).connect(high).connect(e).connect(dst);
  const end = t + attack + dec * 2.6 + 0.02;
  for (const r of METAL) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = base * r;
    o.connect(mix);
    o.start(t);
    o.stop(end);
  }
}
const TOMS = { 41: 82, 43: 98, 45: 112, 47: 132, 48: 150, 50: 178 };
// 전자 드럼처럼 '뿅' 하지 않게: 큰북은 둥근 몸통, 작은북은 통 울림 + 스네어 줄, 심벌은 금속성 + 공기.
function drumHit(ctx, dst, note, t, vel) {
  const v = 0.25 + Math.min(1, vel) * 0.75;
  if (note === 35 || note === 36) {
    // 큰북: 낮게 떨어지는 몸통 + 펠트 채가 닿는 둔한 소리(높은 '틱' 없이)
    toneHit(ctx, dst, t, { f0: 120, f1: 50, sweep: 0.09, gain: 0.9 * v, dec: 0.42 });
    toneHit(ctx, dst, t, { f0: 190, f1: 92, sweep: 0.06, gain: 0.22 * v, dec: 0.12 });
    noiseHit(ctx, dst, t, { type: 'lowpass', freq: 1300, q: 0.6, gain: 0.16 * v, dec: 0.022 });
  } else if (note === 38 || note === 40) {
    // 작은북: 통(두 모드) + 스네어 줄(넓은 대역 노이즈) + 가볍게 남는 줄 울림
    toneHit(ctx, dst, t, { f0: 210, f1: 182, sweep: 0.04, gain: 0.3 * v, dec: 0.1 });
    toneHit(ctx, dst, t, { f0: 342, f1: 330, sweep: 0.03, gain: 0.13 * v, dec: 0.06 });
    noiseHit(ctx, dst, t, { type: 'bandpass', freq: 3600, q: 0.5, gain: 0.8 * v, dec: 0.16 });
    noiseHit(ctx, dst, t, { type: 'highpass', freq: 6500, q: 0.5, gain: 0.2 * v, dec: 0.09 });
  } else if (note === 37) {
    noiseHit(ctx, dst, t, { type: 'bandpass', freq: 1900, q: 4, gain: 0.32 * v, dec: 0.03 });
    toneHit(ctx, dst, t, { f0: 820, gain: 0.15 * v, dec: 0.035, type: 'triangle' });
  } else if (note === 42 || note === 44) {
    metalHit(ctx, dst, t, { gain: 2.2 * v, dec: 0.05 });
    noiseHit(ctx, dst, t, { type: 'highpass', freq: 9000, q: 0.6, gain: 0.12 * v, dec: 0.03 });
  } else if (note === 46) {
    metalHit(ctx, dst, t, { gain: 1.7 * v, dec: 0.32 });
    noiseHit(ctx, dst, t, { type: 'highpass', freq: 8500, q: 0.6, gain: 0.1 * v, dec: 0.25 });
  } else if (TOMS[note]) {
    const f = TOMS[note];
    toneHit(ctx, dst, t, { f0: f * 1.25, f1: f, sweep: 0.07, gain: 0.62 * v, dec: 0.34 });
    toneHit(ctx, dst, t, { f0: f * 1.6 * 1.15, f1: f * 1.6, sweep: 0.05, gain: 0.12 * v, dec: 0.14 });
    noiseHit(ctx, dst, t, { type: 'lowpass', freq: 1600, gain: 0.1 * v, dec: 0.04 });
  } else if (note === 49 || note === 57 || note === 55) {
    // 심벌: 짧게 부풀었다가 길게 사라지는 금속 + 공기
    metalHit(ctx, dst, t, { base: 280, hp: 4200, bp: 7500, gain: 1.3 * v, dec: 1.6, attack: 0.006 });
    noiseHit(ctx, dst, t, { type: 'highpass', freq: 5200, q: 0.5, gain: 0.26 * v, dec: 1.4, attack: 0.012 });
    noiseHit(ctx, dst, t, { type: 'bandpass', freq: 3000, q: 0.8, gain: 0.06 * v, dec: 0.3, attack: 0.004 });
  } else if (note === 51 || note === 59) {
    metalHit(ctx, dst, t, { base: 400, hp: 5000, bp: 8000, gain: 0.7 * v, dec: 0.7 });
    toneHit(ctx, dst, t, { f0: 2960, gain: 0.03 * v, dec: 0.6 });
  } else if (note === 39) {
    for (const [o, g] of [[0, 0.3], [0.009, 0.26], [0.019, 0.3]]) noiseHit(ctx, dst, t, { freq: 1500, q: 1.4, gain: g * v, dec: 0.011, offset: o });
    noiseHit(ctx, dst, t, { freq: 1250, q: 1.0, gain: 0.2 * v, dec: 0.14, offset: 0.026 });
  } else if (note === 54) {
    // 탬버린: 징글 여러 개가 조금씩 늦게 부딪힘
    for (const [o, g, fr] of [[0, 0.16, 7400], [0.006, 0.12, 9800], [0.015, 0.09, 8600], [0.027, 0.05, 10800]]) noiseHit(ctx, dst, t, { freq: fr, q: 3, gain: g * 4 * v, dec: 0.08, offset: o });
    metalHit(ctx, dst, t, { base: 520, hp: 6000, bp: 9000, gain: 0.8 * v, dec: 0.12 });
  } else if (note === 81 || note === 80) {
    // 트라이앵글: 배음이 맞지 않는 쇠막대 부분음 + 치는 소리
    const d = note === 81 ? 1.4 : 0.12;
    for (const [r, g, k] of [[1, 0.075, 1], [2.74, 0.05, 0.8], [4.9, 0.032, 0.6], [7.3, 0.02, 0.45]]) toneHit(ctx, dst, t, { f0: 1580 * r, gain: g * v, dec: d * k });
    noiseHit(ctx, dst, t, { type: 'highpass', freq: 8000, gain: 0.05 * v, dec: 0.008 });
  } else castanet(ctx, dst, t, vel, 0);
}
// 캐스터네츠: 단단한 나무 조개 두 짝이 '딱' 부딪치는 아주 짧은 순간음 + 나무 몸통 공명, 그리고 살짝 튕기는 두 번째 소리.
function castanet(ctx, dst, t, vel, tune) {
  const v = (0.3 + Math.min(1, vel) * 0.7) * 1.6;
  const k = Math.pow(2, tune / 24);
  noiseHit(ctx, dst, t, { type: 'highpass', freq: 3000, q: 0.5, gain: 0.9 * v, dec: 0.004 });
  noiseHit(ctx, dst, t, { freq: 2300 * k, q: 7, gain: 1.6 * v, dec: 0.028 });
  noiseHit(ctx, dst, t, { freq: 3700 * k, q: 8, gain: 1.0 * v, dec: 0.02 });
  toneHit(ctx, dst, t, { f0: 1900 * k, gain: 0.22 * v, dec: 0.03 });
  const b = 0.008 + (hash01(Math.round(t * 1000), 7, tune) + 1) * 0.002;
  noiseHit(ctx, dst, t, { type: 'highpass', freq: 3000, q: 0.5, gain: 0.35 * v, dec: 0.003, offset: b });
  noiseHit(ctx, dst, t, { freq: 2450 * k, q: 7, gain: 0.55 * v, dec: 0.018, offset: b });
}

// ───────────── 실악기 녹음 샘플 ─────────────
// Versilian Studios VSCO 2 Community Edition (CC0). 녹음 출처와 변환 방법은 samples/README.md.
// 악기별로 필요할 때만 불러오며, 느린 연결이나 로드 실패 때에는 기존 합성 음색을 유지합니다.
const SAMPLE_NOTES = {
  piano: [29, 41, 53, 65, 77, 89, 101], violin: [60, 72, 84, 96],
  strings: [57, 60, 67, 74], cello: [45, 48, 55, 62], bass: [24, 33, 47],
  flute: [60, 72, 84], trumpet: [58, 62, 69, 72], horn: [45, 48, 62, 65], glock: [72, 84, 96],
};
const SAMPLE_BASE = new URL('./samples/', import.meta.url);
const sampleContexts = new WeakMap();
function sampleBank(ctx, name) {
  if (!SAMPLE_NOTES[name] || typeof fetch !== 'function') return null;
  let banks = sampleContexts.get(ctx);
  if (!banks) { banks = new Map(); sampleContexts.set(ctx, banks); }
  if (banks.has(name)) return banks.get(name);
  const bank = { notes: [], promise: null };
  banks.set(name, bank);
  bank.promise = Promise.all(SAMPLE_NOTES[name].map(async (midi) => {
    const response = await fetch(new URL(`${name}-${midi}.mp3`, SAMPLE_BASE));
    if (!response.ok) throw new Error(`sample ${name}-${midi}: ${response.status}`);
    return { midi, buffer: await ctx.decodeAudioData(await response.arrayBuffer()) };
  })).then((notes) => { bank.notes = notes; }).catch(() => {
    // Failed loads never silence the game: use the existing synthesis instead.
    bank.notes = [];
  });
  return bank;
}
// 악기별 샘플 다듬기
//  atk: 부드럽게 여는 시간(여린 음일수록 조금 더 길게), rel: 손을 뗀 뒤 남는 울림(초), top: 가장 밝을 때 고역 한계(Hz),
//  vib: 녹음에 떨림이 없는 악기에 늦게 들어오는 비브라토 [빠르기 Hz, 깊이 센트, 시작까지 초],
//  layer: 현악 합주를 두 겹으로(살짝 다른 음높이·시각·좌우) 겹쳐 합주 폭을 넓힙니다.
const SAMPLE_FX = {
  piano: { atk: 0.003, softAtk: 0, rel: 0.32, top: 12000 },
  violin: { atk: 0.025, softAtk: 0.07, rel: 0.32, top: 11000 },
  strings: { atk: 0.04, softAtk: 0.1, rel: 0.5, top: 9500, layer: true },
  cello: { atk: 0.03, softAtk: 0.08, rel: 0.4, top: 7000 },
  bass: { atk: 0.012, softAtk: 0.03, rel: 0.28, top: 3600 },
  flute: { atk: 0.02, softAtk: 0.05, rel: 0.2, top: 10000, vib: [5.0, 11, 0.32] },
  trumpet: { atk: 0.01, softAtk: 0.03, rel: 0.17, top: 10500, vib: [5.4, 6, 0.45] },
  horn: { atk: 0.025, softAtk: 0.05, rel: 0.32, top: 5500 },
  glock: { atk: 0.001, softAtk: 0, rel: 0.9, top: 16000 },
};
// 가장 가까운 샘플. 같은 거리면 올려 쓰기보다 내려 쓰는 쪽(올리면 '다람쥐' 소리가 남)을 고릅니다.
function nearestSample(notes, midi) {
  let best = null, bc = Infinity;
  for (const it of notes) {
    const d = midi - it.midi;
    const cost = d > 0 ? d * 1.3 : -d;
    if (cost < bc) { bc = cost; best = it; }
  }
  return best;
}
function sampleVoice(inst, midi, t, vel, bank) {
  const { ctx, name } = inst;
  const sample = nearestSample(bank.notes, midi);
  const fx = SAMPLE_FX[name] || SAMPLE_FX.piano;
  const sustained = !!SUSTAIN[name];
  const vv = Math.min(1, Math.max(0, vel));
  const amp = ctx.createGain(), level = ctx.createGain();
  // 세기에 따라 살짝 밝기를 바꿉니다(여리면 부드럽게). 반주는 세기가 이미 작게 들어오므로 아주 순하게만.
  const shift = midi - sample.midi;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.Q.value = 0.5;
  tone.frequency.value = Math.min(18000, fx.top * (0.62 + 0.38 * Math.min(1, vv * 1.4)) * (shift > 3 ? Math.pow(2, -(shift - 3) / 24) : 1));
  tone.connect(amp).connect(level).connect(inst.out);
  level.gain.value = 1;
  const rate = (pitch) => Math.pow(2, (pitch - sample.midi) / 12);
  // 겹: [음높이 어긋남(센트), 늦게 시작(초), 좌우, 세기]
  // 두 번째 겹은 녹음의 조금 뒤 지점에서 시작해(같은 소리의 복사가 아니게) 맥놀이·코러스 느낌을 줄입니다.
  const layers = fx.layer ? [[-3, 0, -0.45, 0.64, 0], [3, 0.012, 0.45, 0.6, 0.11]] : [[0, 0, 0, 1, 0]];
  const srcs = [];
  let vib = null;
  if (fx.vib) {
    vib = { o: ctx.createOscillator(), g: ctx.createGain() };
    vib.o.frequency.value = fx.vib[0] * (0.96 + 0.08 * Math.abs(hash01(midi, Math.round(t * 100), 1)));
    vib.g.gain.setValueAtTime(0, t);
    vib.g.gain.setValueAtTime(0, t + fx.vib[2]);
    vib.g.gain.linearRampToValueAtTime(fx.vib[1], t + fx.vib[2] + 0.4);
    vib.o.connect(vib.g);
    vib.o.start(t);
  }
  for (const [cents, delay, pan, g, offset] of layers) {
    const source = ctx.createBufferSource();
    source.buffer = sample.buffer;
    // 반복 구간의 끝은 샘플을 만들 때 시작과 겹쳐(크로스페이드) 이어 두었습니다.
    if (sustained && sample.buffer.duration >= 4.59) { source.loop = true; source.loopStart = 1.4; source.loopEnd = 4.6; }
    source.playbackRate.value = rate(midi);
    source.detune.value = cents;
    if (vib) vib.g.connect(source.detune);
    const lg = ctx.createGain();
    lg.gain.value = g;
    source.connect(lg);
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; lg.connect(p).connect(tone); } else lg.connect(tone);
    source.start(t + delay, offset);
    srcs.push({ source, cents });
  }
  const atk = fx.atk + (1 - vv) * fx.softAtk;
  const peak = (0.25 + vv * 0.75) * (sustained ? 0.7 : 0.9);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + atk);
  let ended = false;
  const first = srcs[0].source;
  const natural = first.loop ? Infinity : t + sample.buffer.duration / rate(midi);
  const stopAll = (at) => { for (const { source } of srcs) { try { source.stop(at); } catch (e) {} } if (vib) { try { vib.o.stop(at); } catch (e) {} } };
  if (!first.loop && vib) vib.o.stop(natural + 0.05);
  const v = {
    midi, stopAt: natural,
    off(when) {
      if (ended) return;
      ended = true;
      const at = Math.max(when ?? ctx.currentTime, t + 0.02);
      if (at >= natural) return;
      holdAt(amp.gain, at);
      // 피아노는 낮은 음일수록 댐퍼가 늦게 먹고, 높은 음은 빨리 멎습니다
      const release = name === 'piano' ? fx.rel * Math.max(0.45, Math.min(1.4, 1.4 - (midi - 40) * 0.016)) : fx.rel;
      amp.gain.setTargetAtTime(0, at, release / 3);
      v.stopAt = Math.min(natural, at + release * 2.2 + 0.03);
      stopAll(v.stopAt);
    },
    setPitch(pitch, glide = 0.03) {
      const now = ctx.currentTime;
      for (const { source } of srcs) { source.playbackRate.cancelScheduledValues(now); source.playbackRate.setTargetAtTime(rate(pitch), now, glide); }
      v.midi = pitch;
    },
    setBend(cents) { const now = ctx.currentTime; for (const { source, cents: c0 } of srcs) source.detune.setTargetAtTime(c0 + cents, now, 0.02); },
    setLevel(x, tc = 0.03) { level.gain.setTargetAtTime(Math.max(0, x), ctx.currentTime, tc); },
  };
  return v;
}

// ───────────── 합성기 본체 ─────────────
const LEVEL = { piano: 0.55, glock: 1, celesta: 1, timpani: 1, drums: 0.9, castanets: 0.9 };
const VERB = { piano: 0.24, strings: 0.36, violin: 0.3, cello: 0.27, trumpet: 0.22, horn: 0.34, flute: 0.3, choir: 0.42, bass: 0.1, drums: 0.12, castanets: 0.14, glock: 0.3, celesta: 0.32, timpani: 0.24 };
// 새 잔향·마스터에 맞춘 레벨 보정(측정으로 맞춤)
const MASTER_TRIM = 1;
const VERB_TRIM = 1.5; // 잔향이 직접음보다 약 9~17dB 아래(곡마다)에 오도록 측정해 맞춤

export function createSynth({ ctx, destination, volume = 0.85, reverb = 0.9, silent = false } = {}) {
  const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
  ctx = ctx || new AC({ latencyHint: 'interactive' });
  const mkChain = () => {
    const bus = ctx.createGain();
    // 다듬기: 쓸데없는 초저역 덜기 → 귀를 찌르는 고역 살짝 낮추기 → 천천히 붙는 부드러운 압축(펌핑 없이) → 끝단 리미터
    const lowCut = ctx.createBiquadFilter();
    lowCut.type = 'highpass'; lowCut.frequency.value = 30; lowCut.Q.value = 0.6;
    const air = ctx.createBiquadFilter();
    air.type = 'highshelf'; air.frequency.value = 7500; air.gain.value = -2.5;
    const warm = ctx.createBiquadFilter();
    warm.type = 'peaking'; warm.frequency.value = 3200; warm.Q.value = 0.9; warm.gain.value = -1.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 14; comp.ratio.value = 2.2; comp.attack.value = 0.025; comp.release.value = 0.3;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 1.5; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.22;
    const trim = ctx.createGain();
    trim.gain.value = MASTER_TRIM;
    const out = ctx.createGain();
    bus.connect(lowCut).connect(air).connect(warm).connect(trim).connect(comp).connect(lim).connect(out);
    const vin = ctx.createGain();
    // 잔향 앞의 작은 지연(소리가 먼저, 홀이 뒤에) 과 잔향 안의 저역 정리
    const pre = ctx.createDelay(0.1);
    pre.delayTime.value = 0.012;
    const vhp = ctx.createBiquadFilter();
    vhp.type = 'highpass'; vhp.frequency.value = 180; vhp.Q.value = 0.5;
    const conv = ctx.createConvolver();
    conv.buffer = hallImpulse(ctx);
    const vout = ctx.createGain();
    vout.gain.value = reverb * VERB_TRIM;
    vin.connect(pre).connect(vhp).connect(conv).connect(vout).connect(bus);
    return { bus, out, vin, vout };
  };
  const main = mkChain();
  main.out.gain.value = volume;
  if (!silent) main.out.connect(destination || ctx.destination);
  let rec = null;
  const recChain = () => { if (!rec) { rec = mkChain(); rec.out.gain.value = volume; for (const d of taps) rec.out.connect(d); } return rec; };
  const taps = new Set();
  const instruments = new Set();

  const synth = {
    ctx,
    bus: main.bus,
    output: main.out,
    now: () => ctx.currentTime,
    /** 탭(클릭) 안에서 불러 소리를 엽니다. iOS 무음 스위치 우회용 짧은 무음도 한 번 틉니다. */
    async resume() {
      if (ctx.state !== 'running' && ctx.resume) { try { await ctx.resume(); } catch (e) {} }
      try {
        const b = ctx.createBuffer(1, 1, ctx.sampleRate);
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(ctx.destination);
        s.start();
      } catch (e) {}
      return ctx.state;
    },
    setVolume(v, tc = 0.05) { main.out.gain.setTargetAtTime(v, ctx.currentTime, tc); if (rec) rec.out.gain.setTargetAtTime(v, ctx.currentTime, tc); },
    setReverb(v) { main.vout.gain.value = v * VERB_TRIM; if (rec) rec.vout.gain.value = v * VERB_TRIM; },
    /** 전체 믹스(스피커 길 + 녹화 전용 길)를 다른 노드로도 보냅니다. 돌려받은 함수로 끊습니다. */
    renderTo(dest) {
      main.out.connect(dest);
      taps.add(dest);
      if (rec) rec.out.connect(dest);
      return () => {
        try { main.out.disconnect(dest); } catch (e) {}
        try { if (rec) rec.out.disconnect(dest); } catch (e) {}
        taps.delete(dest);
      };
    },
    instrument(name, opts = {}) {
      const inst = makeInstrument(synth, INSTRUMENT_INFO[name] ? name : 'piano', opts, opts.recordOnly ? recChain() : main);
      instruments.add(inst);
      inst._unlist = () => instruments.delete(inst);
      return inst;
    },
    allOff() { for (const i of instruments) i.allOff(); },
    dispose() { for (const i of [...instruments]) i.dispose(); try { main.out.disconnect(); } catch (e) {} },
  };
  return synth;
}

function makeInstrument(synth, name, { gain = 1, pan = 0, dest = null, reverb = null, maxVoices = 32 } = {}, chain) {
  const ctx = synth.ctx;
  const out = ctx.createGain();
  out.gain.value = gain * (LEVEL[name] ?? 1);
  let node = out;
  let panner = null;
  if (ctx.createStereoPanner) { panner = ctx.createStereoPanner(); panner.pan.value = pan; out.connect(panner); node = panner; }
  node.connect(dest || chain.bus);
  // 잔향은 패닝 앞에서 보냅니다: 홀 잔향은 좌우 고르게 퍼지고, 악기 자리는 직접음이 정합니다.
  const send = ctx.createGain();
  send.gain.value = reverb ?? VERB[name] ?? 0.2;
  out.connect(send).connect(chain.vin);
  const voices = [];
  const samples = sampleBank(ctx, name);
  const inst = {
    name, ctx, out, info: INSTRUMENT_INFO[name],
    /** 녹음 샘플을 다 불러오면(또는 실패해 합성 음색으로 정해지면) 풀리는 약속 */
    ready: samples ? samples.promise : Promise.resolve(),
    /** 길이를 아는 음. 타악기(drums)는 midi 가 GM 타악기 번호입니다. */
    play(midi, { when, dur = 0.4, vel = 0.8 } = {}) {
      const t = Math.max(when ?? ctx.currentTime, ctx.currentTime);
      if (name === 'drums') { drumHit(ctx, out, midi, t, vel); return null; }
      if (name === 'castanets') { castanet(ctx, out, t, vel, (midi % 12) - 6); return null; }
      const v = inst.noteOn(midi, { when: t, vel });
      v.off(t + Math.max(0.03, dur));
      return v;
    },
    /** 누르고 있는 동안 이어지는 음. 돌려받은 v 로 off / setPitch / setLevel / setBend */
    noteOn(midi, { when, vel = 0.8 } = {}) {
      const t = Math.max(when ?? ctx.currentTime, ctx.currentTime);
      if (name === 'drums' || name === 'castanets') { inst.play(midi, { when: t, vel }); return { midi, off() {}, setPitch() {}, setBend() {}, setLevel() {}, stopAt: t }; }
      const now = ctx.currentTime;
      for (let i = voices.length - 1; i >= 0; i--) if (voices[i].stopAt < now) voices.splice(i, 1);
      if (voices.length >= maxVoices) { const old = voices.shift(); old.off(t); }
      const v = samples && samples.notes.length ? sampleVoice(inst, midi, t, vel, samples) : name === 'choir' ? choirVoice(inst, midi, t, vel) : SUSTAIN[name] ? sustainVoice(inst, midi, t, vel) : BELLS[name] ? bellVoice(inst, midi, t, vel) : pianoVoice(inst, midi, t, vel);
      voices.push(v);
      return v;
    },
    hit(note = 38, opts = {}) { return inst.play(typeof note === 'string' ? DRUM_NAMES[note] ?? 38 : note, opts); },
    allOff(when) { for (const v of voices) v.off(when ?? ctx.currentTime); },
    setGain(g, tc = 0.03) { out.gain.setTargetAtTime(g * (LEVEL[name] ?? 1), ctx.currentTime, tc); },
    setPan(p) { if (panner) panner.pan.value = p; },
    dispose() {
      inst.allOff();
      setTimeout(() => { try { node.disconnect(); out.disconnect(); } catch (e) {} }, 1500);
      if (inst._unlist) inst._unlist();
    },
  };
  return inst;
}
const DRUM_NAMES = { kick: 36, stick: 37, snare: 38, clap: 39, hat: 42, hatOpen: 46, tomLow: 45, tomMid: 47, tomHigh: 48, crash: 49, ride: 51, tamb: 54, triangle: 81, castanet: 85 };

// ───────────── 파트 → 악기 ─────────────
export const PART_GAIN = { melody: 1, harmony: 0.62, bass: 0.8, chords: 0.5, drums: 0.62, perc: 0.55 };
export function defaultOrch(song) {
  return { melody: 'piano', harmony: 'strings', bass: 'bass', chords: 'piano', drums: 'drums', perc: 'drums', ...(song && song.orch) };
}

// ───────────── 박자 스케줄러 ─────────────
/**
 * 곡을 미리보기 창(lookahead)만큼 앞서 예약해 재생합니다. 빠르기 지도(song.tempos)를 따르고 setRate 로 전체를 빠르게/느리게 합니다(지휘).
 * on('beat'|'note'|'end', fn) — note 는 { track, note:[박,길이,midi,세기], time, dur } (time 은 오디오 시계).
 */
export function createTransport(synth, { bpm = 120, lookahead = 0.12, interval = 25 } = {}) {
  const ctx = synth.ctx;
  const EPS = 1e-6;
  let tempos = [[0, bpm]];
  let rate = 1, anchorT = 0, anchorB = 0, playing = false, timer = null, endBeat = Infinity, nextBeat = 0, startBeat = 0;
  const tracks = [];
  const owned = [];
  let meta = { barLen: 4, seed: 0 };
  const L = { beat: new Set(), note: new Set(), end: new Set(), tempo: new Set() };
  const emit = (k, d) => { for (const f of L[k]) { try { f(d); } catch (e) { console.error(e); } } };
  const segs = () => tempos;

  function timeAt(beat) {
    let t = anchorT, b = anchorB;
    const T = segs();
    if (beat >= b) {
      for (let i = 0; i < T.length; i++) {
        const a = T[i][0], z = i + 1 < T.length ? T[i + 1][0] : Infinity;
        if (z <= b) continue;
        const from = Math.max(a, b), to = Math.min(z, beat);
        if (to > from) t += ((to - from) * 60) / (T[i][1] * rate);
        if (beat <= z) break;
      }
    } else {
      for (let i = T.length - 1; i >= 0; i--) {
        const a = T[i][0], z = i + 1 < T.length ? T[i + 1][0] : Infinity;
        if (a >= b) continue;
        const from = Math.max(a, beat), to = Math.min(z, b);
        if (to > from) t -= ((to - from) * 60) / (T[i][1] * rate);
        if (beat >= a) break;
      }
    }
    return t;
  }
  function beatAt(time) {
    const T = segs();
    let t = anchorT, b = anchorB;
    if (time >= t) {
      for (let i = 0; i < T.length; i++) {
        const a = T[i][0], z = i + 1 < T.length ? T[i + 1][0] : Infinity;
        if (z <= b) continue;
        const bpmR = T[i][1] * rate;
        const segEnd = z === Infinity ? Infinity : t + ((z - Math.max(a, b)) * 60) / bpmR;
        if (time <= segEnd) return Math.max(a, b) + ((time - t) * bpmR) / 60;
        t = segEnd;
        b = z;
      }
      return b;
    }
    let i = T.length - 1;
    while (i > 0 && T[i][0] > b) i--;
    return b - ((t - time) * T[i][1] * rate) / 60;
  }
  function seek(fromBeat) {
    for (const tr of tracks) {
      let lo = 0, hi = tr.notes.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (tr.notes[m][0] < fromBeat - EPS) lo = m + 1; else hi = m; }
      tr.i = lo;
    }
    nextBeat = Math.ceil(fromBeat - EPS);
  }
  function tick() {
    if (!playing) return;
    const now = ctx.currentTime;
    const ub = beatAt(now + lookahead);
    for (const tr of tracks) {
      while (tr.i < tr.notes.length && tr.notes[tr.i][0] < ub) {
        const n = tr.notes[tr.i++];
        if (n[0] >= endBeat) continue;
        const t = timeAt(n[0]);
        if (t < now - 0.04) continue;
        const d = timeAt(n[0] + n[1]) - t;
        // 손맛은 소리에만: 알리는 시각(time)은 악보 그대로라 화면·판정은 흔들리지 않습니다
        const f = tr.feel && tr.feel[tr.i - 1];
        if (!tr.mute && tr.inst) {
          const vel = Math.min(1, (n[3] ?? 0.8) * tr.gain * (f ? f.v : 1));
          tr.inst.play(n[2], { when: Math.max(t + (f ? f.dt : 0), now), dur: d + (f ? f.x : 0), vel });
        }
        if (L.note.size) emit('note', { track: tr.name, note: n, time: t, dur: d });
      }
    }
    while (nextBeat < ub && nextBeat <= endBeat) { emit('beat', { beat: nextBeat, time: timeAt(nextBeat) }); nextBeat++; }
    if (beatAt(now) >= endBeat + 0.5) { tp.stop(); emit('end', {}); }
  }

  const tp = {
    get playing() { return playing; },
    get rate() { return rate; },
    get beat() { return playing ? beatAt(ctx.currentTime) : anchorB; },
    get bpm() { let v = tempos[0][1]; const b = tp.beat; for (const [x, y] of tempos) if (x <= b + EPS) v = y; return v * rate; },
    get endBeat() { return endBeat; },
    tracks,
    timeAt, beatAt,
    on(k, fn) { L[k].add(fn); return () => L[k].delete(fn); },
    setTempoMap(map) { const b = tp.beat; anchorT = playing ? ctx.currentTime : anchorT; anchorB = b; tempos = map && map.length ? map : [[0, bpm]]; },
    setBpm(v) { tp.setTempoMap([[0, v]]); },
    /** 지휘용: 곡 빠르기에 곱하는 배율(0.5~2). 바로 지금 박을 기준으로 이어 붙입니다. */
    setRate(r) {
      const now = ctx.currentTime;
      if (playing) { anchorB = beatAt(now); anchorT = now; }
      rate = Math.max(0.5, Math.min(2, r));
      emit('tempo', { rate, bpm: tp.bpm });
    },
    addTrack({ name, notes, inst, gain = 1, mute = false, feel = true, instName }) {
      const sorted = notes.slice().sort((a, b) => a[0] - b[0]);
      const tr = { name, notes: sorted, inst, gain, mute, i: 0 };
      if (feel) tr.feel = makeFeel(sorted, { part: name, inst: instName || (inst && inst.name) || '', barLen: meta.barLen, seed: meta.seed, timeSig: meta.timeSig });
      tracks.push(tr);
      return tr;
    },
    track(name) { return tracks.find((t) => t.name === name) || null; },
    setMute(name, m = true) { const t = tp.track(name); if (t) { t.mute = m; if (m && t.inst) t.inst.allOff(); } },
    setGain(name, g) { const t = tp.track(name); if (t) t.gain = g; },
    /**
     * 곡 하나를 파트별 악기로 싣습니다. opts: { orch:{파트:악기}, parts:[...], gains:{}, mute:{}, gain, recordOnly, instruments:{파트:만든 악기} }
     */
    load(song, opts = {}) {
      tp.unload();
      tempos = song.tempos && song.tempos.length ? song.tempos.map((x) => x.slice()) : [[0, song.bpm]];
      endBeat = song.beats;
      meta = { barLen: song.barLen || (song.timeSig ? (song.timeSig[0] * 4) / song.timeSig[1] : 4), seed: strHash(String(song.id || song.title || '')), timeSig: song.timeSig || null };
      const orch = { ...defaultOrch(song), ...(opts.orch || {}) };
      const parts = opts.parts || Object.keys(song.parts);
      for (const p of parts) {
        if (!song.parts[p]) continue;
        let inst = opts.instruments && opts.instruments[p];
        if (inst === undefined) {
          const nm = orch[p] || 'piano';
          inst = synth.instrument(nm, { recordOnly: !!(opts.recordOnly && opts.recordOnly[p]), dest: opts.dest || null, pan: seatFor(nm, p) });
          owned.push(inst);
        }
        tp.addTrack({ name: p, notes: song.parts[p], inst, instName: (inst && inst.name) || orch[p], gain: (opts.gains && opts.gains[p] != null ? opts.gains[p] : PART_GAIN[p] ?? 1) * (opts.gain ?? 1), mute: !!(opts.mute && opts.mute[p]) });
      }
      return tp;
    },
    unload() { tp.stop(); for (const i of owned) i.dispose(); owned.length = 0; tracks.length = 0; },
    start({ fromBeat = 0, at } = {}) {
      if (playing) tp.stop();
      anchorT = at ?? ctx.currentTime + 0.08;
      anchorB = fromBeat;
      startBeat = fromBeat;
      seek(fromBeat);
      playing = true;
      timer = setInterval(tick, interval);
      tick();
      return anchorT;
    },
    stop() {
      if (!playing) return;
      anchorB = beatAt(ctx.currentTime);
      playing = false;
      clearInterval(timer);
      timer = null;
      for (const tr of tracks) if (tr.inst) tr.inst.allOff();
    },
    get startBeat() { return startBeat; },
  };
  return tp;
}

/**
 * 미리듣기: 곡의 한 대목을 seconds 초 동안 틀고 부드럽게 줄입니다. 돌려받은 함수로 언제든 멈춥니다.
 */
export function playPreview(synth, song, { fromBeat, seconds = 12, gain = 0.85, onEnd } = {}) {
  const tr = createTransport(synth);
  tr.load(song, { gain });
  const from = fromBeat ?? song.previewBeat ?? 0;
  tr.start({ fromBeat: from });
  const insts = tr.tracks.map((t) => t.inst).filter(Boolean);
  let done = false;
  const fade = (sec) => { const now = synth.ctx.currentTime; for (const i of insts) { holdAt(i.out.gain, now); i.out.gain.setTargetAtTime(0, now, sec / 3); } };
  const t1 = setTimeout(() => fade(1.4), Math.max(0, seconds - 1.5) * 1000);
  const t2 = setTimeout(() => stop(), seconds * 1000);
  const offEnd = tr.on('end', () => stop());
  function stop() {
    if (done) return;
    done = true;
    clearTimeout(t1); clearTimeout(t2); offEnd();
    fade(0.15);
    setTimeout(() => tr.unload(), 260);
    if (onEnd) onEnd();
  }
  return stop;
}

/**
 * 오프라인 렌더(검사·내려받기용): 곡의 구간을 AudioBuffer 로 만듭니다. 브라우저 전용.
 */
export async function renderOffline(song, { fromBeat = 0, seconds = 8, sampleRate = 44100, parts, orch, single, noSamples = false } = {}) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(2, Math.ceil(sampleRate * (seconds + 1.5)), sampleRate);
  const synth = createSynth({ ctx });
  const o = { ...defaultOrch(song), ...(orch || {}) };
  const t0 = 0.05;
  const sec = (b) => {
    const T = song.tempos;
    let s = 0;
    for (let i = 0; i < T.length; i++) {
      const a = T[i][0], z = i + 1 < T.length ? T[i + 1][0] : Infinity;
      if (b <= a) break;
      s += ((Math.min(b, z) - a) * 60) / T[i][1];
    }
    return s;
  };
  const base = sec(fromBeat);
  if (single) {
    const inst = synth.instrument(single.instrument, { maxVoices: 1e9 });
    if (!noSamples) await inst.ready;
    inst.play(single.midi, { when: t0, dur: single.dur ?? 1, vel: single.vel ?? 0.8 });
  } else {
    const barLen = song.barLen || (song.timeSig ? (song.timeSig[0] * 4) / song.timeSig[1] : 4);
    const seed = strHash(String(song.id || song.title || ''));
    const list = (parts || Object.keys(song.parts)).filter((p) => song.parts[p]).map((p) => ({ p, nm: o[p] || 'piano' }));
    for (const it of list) it.inst = synth.instrument(it.nm, { maxVoices: 1e9, pan: seatFor(it.nm, it.p) });
    // 실제 게임처럼 녹음 샘플을 다 불러온 뒤 예약합니다(안 그러면 합성 대체 음색으로 렌더됨)
    if (!noSamples) await Promise.all(list.map((it) => it.inst.ready));
    for (const { p, nm, inst } of list) {
      const notes = song.parts[p].slice().sort((a, b) => a[0] - b[0]);
      const feel = makeFeel(notes, { part: p, inst: nm, barLen, seed, timeSig: song.timeSig });
      notes.forEach((n, i) => {
        const s = sec(n[0]) - base;
        if (s < 0 || s > seconds) return;
        const f = feel[i];
        inst.play(n[2], { when: Math.max(0, t0 + s + f.dt), dur: sec(n[0] + n[1]) - sec(n[0]) + f.x, vel: Math.min(1, (n[3] ?? 0.8) * (PART_GAIN[p] ?? 1) * f.v) });
      });
    }
  }
  return ctx.startRendering();
}
