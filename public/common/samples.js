// 실제 녹음 효과음 재생기. 종목의 AudioContext 와 마스터 노드를 받아 /common/sfx/ 의 녹음을 틀어 줍니다.
//
//   import { createSamples } from '/common/samples.js';
//   const sfx = createSamples(ctx, master);           // ctx 는 종목이 이미 만든 AudioContext
//   sfx.preload(['bowling/']);                         // 이름 앞머리로 미리 받기(대기실에서)
//   sfx.play('bowling/pins-strike', { gain: 0.9 });    // 못 받았으면 false → 예전 합성음을 대신 내면 됩니다
//   const roll = sfx.loop('bowling/roll', { gain: 0 }); roll.set({ gain: 0.6, rate: 1.1 }); roll.stop(0.2);
//
// 녹음 목록은 /common/sfx/manifest.js 에 있습니다(이름 → 파일·기본 세기·같은 소리의 여러 벌).
// 같은 이름에 여러 벌이 있으면 돌아가며 골라 틀고, rate·gain 을 조금씩 흔들어 매번 똑같이 들리지 않게 합니다.
import { SFX } from './sfx/manifest.js';

const decoded = new WeakMap(); // AudioContext → Map(url → Promise<AudioBuffer|null>)

function fetchBuffer(ctx, url) {
  let m = decoded.get(ctx);
  if (!m) { m = new Map(); decoded.set(ctx, m); }
  if (!m.has(url)) {
    m.set(url, fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
      .catch(() => null));
  }
  return m.get(url);
}

export function createSamples(ctx, out, { base = '/common/sfx/', manifest = SFX } = {}) {
  const ready = new Map(); // url → AudioBuffer
  const turn = new Map(); // 이름 → 다음에 틀 벌 번호
  const dst = out || ctx.destination;
  const files = (name) => {
    const e = manifest[name];
    if (!e) return [];
    return (e.files || [e.file]).map((f) => base + f);
  };
  function preload(prefixes) {
    const want = Object.keys(manifest).filter((n) => !prefixes || prefixes.some((p) => n.startsWith(p)));
    return Promise.all(want.flatMap((n) => files(n).map((u) => fetchBuffer(ctx, u).then((b) => { if (b) ready.set(u, b); return b; }))));
  }
  function pick(name) {
    const list = files(name).filter((u) => ready.has(u));
    if (!list.length) { for (const u of files(name)) fetchBuffer(ctx, u).then((b) => { if (b) ready.set(u, b); }); return null; }
    const i = (turn.get(name) || 0) % list.length;
    turn.set(name, i + 1 + (list.length > 2 && Math.random() < 0.5 ? 1 : 0));
    return ready.get(list[i]);
  }
  function chain(name, { gain = 1, pan = 0 } = {}) {
    const e = manifest[name] || {};
    const g = ctx.createGain();
    g.gain.value = Math.max(0, gain * (e.gain ?? 1));
    let tail = g;
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); tail = p; }
    tail.connect(dst);
    return g;
  }
  /** 한 번 틉니다. opts: gain 세기, rate 재생 속도(높이), pan −1~1, when 지금부터 초, offset 시작 지점 초, jitter 속도 흔들림(0.05 = ±5%). 틀었으면 true. */
  function play(name, opts = {}) {
    const buf = pick(name);
    if (!buf || ctx.state === 'closed') return false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const j = opts.jitter ?? (manifest[name] && manifest[name].jitter) ?? 0.04;
    src.playbackRate.value = Math.max(0.25, (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * j));
    src.connect(chain(name, opts));
    const t = ctx.currentTime + (opts.when || 0);
    if (opts.duration) src.start(t, opts.offset || 0, opts.duration); else src.start(t, opts.offset || 0);
    return true;
  }
  /** 이어서 도는 소리(굴러가는 공, 엔진, 환호 바탕). 돌려받은 것으로 set({gain, rate}) · stop(초) 합니다. 못 받았으면 null. */
  function loop(name, opts = {}) {
    const buf = pick(name);
    if (!buf || ctx.state === 'closed') return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = opts.rate ?? 1;
    const g = chain(name, opts);
    src.connect(g);
    src.start(ctx.currentTime + (opts.when || 0), opts.offset || 0);
    const scale = (manifest[name] && manifest[name].gain) ?? 1;
    let stopped = false;
    return {
      set({ gain, rate, glide = 0.08 } = {}) {
        if (stopped) return;
        if (gain != null) g.gain.setTargetAtTime(Math.max(0, gain * scale), ctx.currentTime, glide);
        if (rate != null) src.playbackRate.setTargetAtTime(Math.max(0.25, rate), ctx.currentTime, glide);
      },
      stop(fade = 0.15) {
        if (stopped) return;
        stopped = true;
        g.gain.setTargetAtTime(0, ctx.currentTime, Math.max(0.01, fade / 3));
        try { src.stop(ctx.currentTime + fade + 0.05); } catch (e) {}
      },
    };
  }
  const has = (name) => files(name).some((u) => ready.has(u));
  return { play, loop, preload, has, names: () => Object.keys(manifest) };
}
