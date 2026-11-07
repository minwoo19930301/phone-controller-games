// 샘플 없이 WebAudio 로 합성하는 악기 모음과 박자 스케줄러(Transport)입니다.
// 큰 화면(자동 반주·녹화 믹스)과 폰(내 악기 소리) 모두에서 씁니다. 다른 파일을 불러오지 않습니다.
//
//   const synth = createSynth();                 // 탭 안에서 await synth.resume() 으로 소리를 엽니다
//   const vio = synth.instrument('violin');      // 악기 하나
//   vio.play(76, { when: synth.now(), dur: 0.5, vel: 0.8 });   // 길이를 아는 음
//   const v = vio.noteOn(76); v.setLevel(0.6); v.off();        // 누르는 동안 이어지는 음(활 긋기·불기·노래)
//   const tr = createTransport(synth); tr.load(song); tr.start(); tr.setRate(1.1);  // 곡 재생·지휘 빠르기
//   const unplug = synth.renderTo(mediaStreamDestination);     // 녹화용 믹스로도 내보내기
//
// 소리 길: 악기 → (패닝) → 버스 → 컴프레서 → 리미터 → 스피커. 잔향은 버스에 보내기로 섞습니다.
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

function impulse(ctx, sec, decay) {
  const n = Math.floor(ctx.sampleRate * sec);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let s = 777 + c * 991, lp = 0;
    for (let i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const x = (s / 0x3fffffff) - 1;
      const k = i / n;
      lp += (x - lp) * (0.55 - 0.4 * k); // 뒤로 갈수록 어두워지는 잔향
      d[i] = lp * Math.pow(1 - k, decay) * (i < ctx.sampleRate * 0.012 ? i / (ctx.sampleRate * 0.012) : 1);
    }
  }
  return b;
}

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

const BELLS = {
  glock: { parts: [[1, 1, 1.5], [2.76, 0.32, 0.45], [5.4, 0.12, 0.22], [8.93, 0.05, 0.1]], level: 0.32, click: 0.08 },
  celesta: { parts: [[1, 1, 1.0], [2, 0.22, 0.45], [3, 0.08, 0.28], [4.1, 0.04, 0.16]], level: 0.38, click: 0.03 },
  timpani: { parts: [[1, 1, 1.3], [1.5, 0.16, 0.8], [1.99, 0.3, 0.7], [2.44, 0.1, 0.45]], level: 0.7, click: 0, thump: true },
};
function bellVoice(inst, midi, t, vel) {
  const { ctx } = inst;
  const c = BELLS[inst.name];
  const f = midiToFreq(midi);
  const out = ctx.createGain();
  out.connect(inst.out);
  const srcs = [];
  let longest = 0;
  const scale = Math.max(0.35, Math.min(1.4, 1.5 - (midi - 60) * 0.02));
  for (const [ratio, g, dec] of c.parts) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * ratio, t);
    if (c.thump) o.frequency.exponentialRampToValueAtTime(f * ratio * 0.985, t + 0.4);
    const e = ctx.createGain();
    const d = dec * scale;
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(g * (0.2 + vel * 0.8), t + (c.thump ? 0.006 : 0.002));
    e.gain.setTargetAtTime(0, t + 0.01, d / 3);
    o.connect(e).connect(out);
    o.start(t);
    o.stop(t + d * 2.4 + 0.1);
    longest = Math.max(longest, d * 2.4 + 0.1);
    srcs.push(o);
  }
  if (c.click || c.thump) {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx);
    const fl = ctx.createBiquadFilter();
    fl.type = c.thump ? 'lowpass' : 'highpass';
    fl.frequency.value = c.thump ? 260 : 5000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime((c.thump ? 0.5 : c.click) * vel, t);
    ng.gain.exponentialRampToValueAtTime(0.0005, t + (c.thump ? 0.12 : 0.02));
    n.connect(fl).connect(ng).connect(out);
    n.start(t, Math.random());
    n.stop(t + 0.15);
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
const TOMS = { 41: 82, 43: 98, 45: 112, 47: 132, 48: 150, 50: 178 };
function drumHit(ctx, dst, note, t, vel) {
  const v = 0.25 + vel * 0.75;
  if (note === 35 || note === 36) {
    toneHit(ctx, dst, t, { f0: 150, f1: 44, sweep: 0.13, gain: 0.95 * v, dec: 0.38 });
    noiseHit(ctx, dst, t, { type: 'highpass', freq: 3000, gain: 0.12 * v, dec: 0.012 });
  } else if (note === 38 || note === 40) {
    noiseHit(ctx, dst, t, { type: 'highpass', freq: 1400, q: 0.6, gain: 0.5 * v, dec: 0.17 });
    noiseHit(ctx, dst, t, { type: 'bandpass', freq: 4200, q: 0.7, gain: 0.2 * v, dec: 0.1 });
    toneHit(ctx, dst, t, { f0: 200, f1: 165, sweep: 0.05, gain: 0.35 * v, dec: 0.09, type: 'triangle' });
  } else if (note === 37) {
    noiseHit(ctx, dst, t, { type: 'bandpass', freq: 1900, q: 4, gain: 0.35 * v, dec: 0.035 });
    toneHit(ctx, dst, t, { f0: 820, gain: 0.18 * v, dec: 0.04, type: 'triangle' });
  } else if (note === 42 || note === 44) {
    noiseHit(ctx, dst, t, { type: 'highpass', freq: 7800, q: 0.7, gain: 0.24 * v, dec: 0.045 });
  } else if (note === 46) {
    noiseHit(ctx, dst, t, { type: 'highpass', freq: 7200, q: 0.7, gain: 0.22 * v, dec: 0.3 });
  } else if (TOMS[note]) {
    const f = TOMS[note];
    toneHit(ctx, dst, t, { f0: f * 1.35, f1: f, sweep: 0.08, gain: 0.7 * v, dec: 0.32 });
    noiseHit(ctx, dst, t, { type: 'lowpass', freq: 1800, gain: 0.08 * v, dec: 0.05 });
  } else if (note === 49 || note === 57 || note === 55) {
    noiseHit(ctx, dst, t, { type: 'highpass', freq: 4200, q: 0.5, gain: 0.3 * v, dec: 1.3 });
    noiseHit(ctx, dst, t, { type: 'bandpass', freq: 6500, q: 0.6, gain: 0.14 * v, dec: 0.7 });
  } else if (note === 51 || note === 59) {
    noiseHit(ctx, dst, t, { type: 'highpass', freq: 6200, q: 0.6, gain: 0.13 * v, dec: 0.45 });
    toneHit(ctx, dst, t, { f0: 3150, gain: 0.04 * v, dec: 0.4 });
  } else if (note === 39) {
    for (const [o, g] of [[0, 0.32], [0.011, 0.28], [0.022, 0.3]]) noiseHit(ctx, dst, t, { freq: 1500, q: 1.4, gain: g * v, dec: 0.012, offset: o });
    noiseHit(ctx, dst, t, { freq: 1300, q: 1.1, gain: 0.22 * v, dec: 0.12, offset: 0.03 });
  } else if (note === 54) {
    noiseHit(ctx, dst, t, { type: 'highpass', freq: 6800, q: 0.8, gain: 0.2 * v, dec: 0.13 });
    noiseHit(ctx, dst, t, { freq: 9500, q: 3, gain: 0.12 * v, dec: 0.09, offset: 0.004 });
  } else if (note === 81 || note === 80) {
    const d = note === 81 ? 1.2 : 0.12;
    toneHit(ctx, dst, t, { f0: 4186, gain: 0.07 * v, dec: d });
    toneHit(ctx, dst, t, { f0: 5274, gain: 0.04 * v, dec: d * 0.8 });
  } else castanet(ctx, dst, t, vel, 0);
}
function castanet(ctx, dst, t, vel, tune) {
  const v = 0.3 + vel * 0.7;
  const k = Math.pow(2, tune / 24);
  noiseHit(ctx, dst, t, { freq: 2500 * k, q: 2.4, gain: 1.4 * v, dec: 0.02 });
  noiseHit(ctx, dst, t, { freq: 4300 * k, q: 3, gain: 0.9 * v, dec: 0.016, offset: 0.007 });
  toneHit(ctx, dst, t, { f0: 1750 * k, gain: 0.4 * v, dec: 0.035, type: 'triangle' });
}

// ───────────── 합성기 본체 ─────────────
const LEVEL = { piano: 0.55, glock: 1, celesta: 1, timpani: 1, drums: 0.9, castanets: 0.9 };
const VERB = { piano: 0.22, strings: 0.34, violin: 0.28, cello: 0.25, trumpet: 0.2, horn: 0.3, flute: 0.28, choir: 0.4, bass: 0.06, drums: 0.08, castanets: 0.12, glock: 0.3, celesta: 0.3, timpani: 0.18 };

export function createSynth({ ctx, destination, volume = 0.85, reverb = 0.9, silent = false } = {}) {
  const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
  ctx = ctx || new AC({ latencyHint: 'interactive' });
  const mkChain = () => {
    const bus = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 10; comp.ratio.value = 3.5; comp.attack.value = 0.006; comp.release.value = 0.22;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -2.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.09;
    const out = ctx.createGain();
    bus.connect(comp).connect(lim).connect(out);
    const vin = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, 2.1, 3.2);
    const vout = ctx.createGain();
    vout.gain.value = reverb;
    vin.connect(conv).connect(vout).connect(bus);
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
    setReverb(v) { main.vout.gain.value = v; if (rec) rec.vout.gain.value = v; },
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
  const send = ctx.createGain();
  send.gain.value = reverb ?? VERB[name] ?? 0.2;
  node.connect(send).connect(chain.vin);
  const voices = [];
  const inst = {
    name, ctx, out, info: INSTRUMENT_INFO[name],
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
      const v = SUSTAIN[name] ? sustainVoice(inst, midi, t, vel) : BELLS[name] ? bellVoice(inst, midi, t, vel) : pianoVoice(inst, midi, t, vel);
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
        if (!tr.mute && tr.inst) tr.inst.play(n[2], { when: Math.max(t, now), dur: d, vel: (n[3] ?? 0.8) * tr.gain });
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
    addTrack({ name, notes, inst, gain = 1, mute = false }) {
      const tr = { name, notes: notes.slice().sort((a, b) => a[0] - b[0]), inst, gain, mute, i: 0 };
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
      const orch = { ...defaultOrch(song), ...(opts.orch || {}) };
      const parts = opts.parts || Object.keys(song.parts);
      for (const p of parts) {
        if (!song.parts[p]) continue;
        let inst = opts.instruments && opts.instruments[p];
        if (inst === undefined) {
          inst = synth.instrument(orch[p] || 'piano', { recordOnly: !!(opts.recordOnly && opts.recordOnly[p]), dest: opts.dest || null });
          owned.push(inst);
        }
        tp.addTrack({ name: p, notes: song.parts[p], inst, gain: (opts.gains && opts.gains[p] != null ? opts.gains[p] : PART_GAIN[p] ?? 1) * (opts.gain ?? 1), mute: !!(opts.mute && opts.mute[p]) });
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
export async function renderOffline(song, { fromBeat = 0, seconds = 8, sampleRate = 44100, parts, orch, single } = {}) {
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
    inst.play(single.midi, { when: t0, dur: single.dur ?? 1, vel: single.vel ?? 0.8 });
  } else {
    for (const p of parts || Object.keys(song.parts)) {
      const inst = synth.instrument(o[p] || 'piano', { maxVoices: 1e9 });
      for (const n of song.parts[p]) {
        const s = sec(n[0]) - base;
        if (s < 0 || s > seconds) continue;
        inst.play(n[2], { when: t0 + s, dur: sec(n[0] + n[1]) - sec(n[0]), vel: n[3] * (PART_GAIN[p] ?? 1) });
      }
    }
  }
  return ctx.startRendering();
}
