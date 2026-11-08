// 오케스트라 폰 악기 8가지: 화면·감지기·소리·튜토리얼 단계.
// 모든 소리는 이 폰 스피커에서 납니다(공용 synth.js). 판정은 큰 화면이 하고, 폰은 동작을 잡자마자 소리·진동을 냅니다.
//
// createInstrument(inst, env) → { el, kind, frame(now), tutorial(), destroy(), test }
// env: { inst, color(), synth, voice(name), part(), diff(), clock(), send(ev, data, vol), signal(name, data), noSensor(), rtt(),
//        dyn(), openMic(voice), debug(text), action(kind, data) }
//   clock() → { song: 곡 진행 중인지, beat, bpm, live: 판정 중인지 }
import {
  INSTRUMENTS, ICONS, targetAt, valvesFor, pitchForValves, valveLabel, FREE_VALVE_NOTE, STRINGS, OPEN_STRING, stringFor,
  solfa, noteName, patternOf, PATTERNS, DIR_ARROW, DIR_KO, VOICE_FIX, PITCH_TOL,
} from '/orchestra/parts.js';
import { createBreath, createPitch } from './audio-in.js';
import { sensors } from './sensors.js';
import { haptics } from '/common/haptics.js';

const DEBUG = new URLSearchParams(location.search).has('debug');
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const r2 = (x) => Math.round(x * 100) / 100;
const now = () => performance.now();
function div(cls, html) { const e = document.createElement('div'); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
const isBlack = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);

// 액션 공통 꼬리표: 감지한 뒤 지난 시간(ago), 폰 왕복 시간(rtt), 폰이 본 박(pb)
function stamp(env, t, extra) {
  const c = env.clock();
  return { ...extra, ago: Math.max(0, Math.round(now() - t)), rtt: Math.round(env.rtt()), pb: c.song ? r2(c.beat) : null };
}
// 곡 진행 중이면 그 시점 가까운 악보 음
function nearNote(env, sec = 0.3) {
  const c = env.clock(), p = env.part();
  if (!c.song || !p) return null;
  let best = null, bd = 1e9;
  for (const n of p.notes) {
    const dt = Math.abs((n.b - c.beat) * 60 / c.bpm);
    if (dt < bd) { bd = dt; best = n; }
    if (n.b > c.beat + 4) break;
  }
  return bd <= sec ? best : null;
}
function metronome(env, ms = 600) {
  const drums = env.voice('drums');
  const id = setInterval(() => { try { drums.play(37, { vel: 0.45 }); } catch (e) {} }, ms);
  return () => clearInterval(id);
}

// ═════════════════════ 드럼(막대기처럼 아래로 톡) ═════════════════════
function createDrum(env) {
  const el = div('ins drum', `
    <div class="drum-stage" id="drumStage">
      <div class="drum-shell"></div>
      <div class="drum-head"><i class="drum-logo">${ICONS.drum}</i></div>
      <div class="drum-ripple"></div>
      <div class="stick l"></div><div class="stick r"></div>
      <div class="drum-pow"></div>
    </div>
    <div class="ins-hint"><b>막대기처럼 쥐고 아래로 톡!</b><span>폰을 옆으로 눕혀 치면 낮은 북(탐) 소리</span></div>
    <div class="ins-note hidden" id="drumFb">동작 센서가 없어 화면을 눌러 쳐요</div>`);
  const stage = el.querySelector('.drum-stage');
  const TH = { easy: 9, normal: 11.5, hard: 13.5 };
  let inPeak = false, peak = 0, peakT = 0, lastHit = -1e9, peakGrav = null;
  const drums = env.voice('drums');
  const off = sensors.onMotion((d) => {
    const a = Math.hypot(d.lin[0], d.lin[1], d.lin[2]);
    const r = Math.hypot(d.rot[0], d.rot[1], d.rot[2]);
    const s = a + r * 0.01;
    const thr = TH[env.diff()] || 11.5;
    if (!inPeak) {
      if (s > thr && d.t - lastHit > 90) { inPeak = true; peak = s; peakT = d.t; peakGrav = d.grav; }
    } else if (s > peak) { peak = s; peakT = d.t; peakGrav = d.grav; }
    else if (s < peak * 0.6 || d.t - peakT > 70) {
      inPeak = false;
      lastHit = peakT;
      const vel = clamp((peak - thr) / 24 + 0.4, 0.3, 1);
      const gx = peakGrav ? peakGrav[0] / 9.8 : 0;
      hit(vel, Math.abs(gx) > 0.62 ? (gx > 0 ? 1 : 2) : 0, peakT);
    }
  });
  function hit(vel, tom, t = now()) {
    const near = !tom ? nearNote(env, 0.25) : null;
    let note = tom === 1 ? 45 : tom === 2 ? 48 : near ? near.m : 38;
    drums.play(note, { vel });
    // 폰 스피커는 킥(낮은 북)이 잘 안 들려서 낮은 탐을 살짝 겹칩니다.
    if (note === 36 || note === 35) drums.play(43, { vel: vel * 0.55 });
    if (note === 49) drums.play(38, { vel: vel * 0.6 });
    stage.classList.remove('hit', 'tom');
    void stage.offsetWidth;
    stage.classList.add('hit');
    if (tom) stage.classList.add('tom');
    stage.style.setProperty('--pow', vel.toFixed(2));
    haptics.hit(vel, { silent: true, noFlash: true });
    env.send('play', stamp(env, t, { k: 'hit', vel: r2(vel), tom }));
    env.action('hit', { vel });
    env.signal('hit', { vel, tom: Boolean(tom) });
  }
  stage.addEventListener('pointerdown', (e) => {
    if (!env.noSensor() && !DEBUG) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const side = (e.clientX - r.left) / r.width;
    hit(0.85, side < 0.18 ? 2 : side > 0.82 ? 1 : 0);
  });
  return {
    el, kind: 'strike',
    frame() { el.querySelector('#drumFb').classList.toggle('hidden', !env.noSensor()); },
    tutorial() {
      const fb = (stage2, api) => {
        if (!env.noSensor() && !DEBUG) return null;
        const b = document.createElement('button');
        b.className = 'tut-btn';
        b.textContent = env.noSensor() ? '센서가 없어요 · 눌러서 치기' : '시험: 치기';
        b.onclick = () => hit(0.8, 0);
        stage2.appendChild(b);
        const b2 = document.createElement('button');
        b2.className = 'tut-btn ghost';
        b2.textContent = '옆으로 치기(탐)';
        b2.onclick = () => hit(0.8, 1);
        stage2.appendChild(b2);
        return () => { b.remove(); b2.remove(); };
      };
      return [
        { title: '막대기처럼 쥐기', body: '폰 아래쪽을 드럼 스틱처럼 한 손으로 가볍게 쥐어요. 화면은 위를 봐도 괜찮아요.', svg: 'hold' },
        { title: '아래로 톡!', body: '손목을 써서 폰을 아래로 짧게 톡 내려쳐요. 떨어뜨리지 않게 꼭 쥐고요.', svg: 'strike', waitFor: 'hit', okText: '좋은 소리!', render: fb },
        { title: '딸깍에 맞춰 네 번', body: '딸깍 소리에 맞춰 네 번 쳐요. 세게 치면 소리도 커져요.', svg: 'strike', waitFor: 'hit', count: 4, hint: '네 번 쳐요',
          render: (s, api) => { const stop = metronome(env, 640); const c = fb(s, api); return () => { stop(); if (c) c(); }; } },
        { title: '옆으로 눕혀 치면 탐', body: '폰을 옆으로 눕힌 채 치면 낮은 북(탐) 소리가 나요.', svg: 'tilt', waitFor: 'hit',
          check: (d) => d.tom || '폰을 옆으로 더 눕혀서 쳐 봐요', render: fb },
      ];
    },
    destroy() { off(); },
    test: { hit },
  };
}

// ═════════════════════ 캐스터네츠(톡 · 두 손가락 = 드르륵) ═════════════════════
function createCastanets(env) {
  const el = div('ins cast', `
    <div class="cast-stage">
      <div class="cast-glow"></div>
      <div class="shell top"><i></i></div><div class="shell bot"><i></i></div>
      <div class="cast-cord"></div>
    </div>
    <div class="ins-hint"><b>화면을 톡톡!</b><span>두 손가락으로 같이 두드리면 드르륵</span></div>`);
  const stage = el.querySelector('.cast-stage');
  const cast = env.voice('castanets');
  let lastRoll = -1e9;
  function anim(roll) {
    stage.classList.remove('clap', 'roll');
    void stage.offsetWidth;
    stage.classList.add(roll ? 'roll' : 'clap');
  }
  function tap(vel = 0.8, t = now()) {
    cast.play(85 + Math.round((Math.random() - 0.5) * 2), { vel });
    anim(false);
    haptics.play('tick', 1, { silent: true });
    env.send('play', stamp(env, t, { k: 'tap', vel: r2(vel) }));
    env.action('hit', { vel });
    env.signal('tap', { vel });
  }
  function roll(t = now()) {
    lastRoll = t;
    for (let k = 0; k < 6; k++) cast.play(85, { when: env.synth.now() + k * 0.032, vel: 0.85 - k * 0.07 });
    anim(true);
    haptics.buzz([12, 18, 12, 18, 12], { silent: true });
    env.send('play', stamp(env, t, { k: 'tap', vel: 0.8, roll: 1 }));
    env.action('roll', {});
    env.signal('roll', {});
  }
  function bindPad(pad) {
    const active = new Map();
    const down = (e) => {
      e.preventDefault();
      const t = now();
      let two = false;
      for (const [id, t0] of active) if (id !== e.pointerId && t - t0 < 120) two = true;
      active.set(e.pointerId, t);
      if (two && t - lastRoll > 200) roll(t);
      else if (!two) {
        const r = pad.getBoundingClientRect();
        const dy = (e.clientY - r.top) / r.height;
        tap(clamp(1.05 - dy * 0.4, 0.55, 1), t);
      }
    };
    const up = (e) => active.delete(e.pointerId);
    pad.addEventListener('pointerdown', down);
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    return () => { pad.removeEventListener('pointerdown', down); pad.removeEventListener('pointerup', up); pad.removeEventListener('pointercancel', up); };
  }
  const unbind = bindPad(el);
  const miniPad = (s) => {
    const p = div('tut-pad', `<div class="cast-stage mini"><div class="shell top"><i></i></div><div class="shell bot"><i></i></div></div><span>여기를 톡</span>`);
    s.appendChild(p);
    const u = bindPad(p);
    return () => { u(); p.remove(); };
  };
  return {
    el, kind: 'tap',
    frame() {},
    tutorial() {
      return [
        { title: '톡 두드리기', body: '손가락으로 톡 두드리면 딱! 소리가 나요.', waitFor: 'tap', count: 3, hint: '세 번 두드려요', render: miniPad },
        { title: '딸깍에 맞춰', body: '딸깍 소리에 맞춰 네 번 두드려요.', waitFor: 'tap', count: 4, render: (s) => { const stop = metronome(env, 600); const c = miniPad(s); return () => { stop(); c(); }; } },
        { title: '두 손가락 = 드르륵', body: '두 손가락으로 동시에 두드리면 드르륵 굴리기예요. 어려움 악보에 나와요.', waitFor: 'roll', render: miniPad },
      ];
    },
    destroy() { unbind(); },
    test: { tap, roll },
  };
}

// ═════════════════════ 피아노(진짜 건반) ═════════════════════
function mountKeyboard(host, { lo, hi, mini = false, onDown, onUp }) {
  // 흰 건반 경계(C·F)로 넓히고, 최소 1.5옥타브(18반음)를 보장합니다.
  let a = Math.floor(lo), b = Math.ceil(hi);
  while (b - a < 18) { a -= 1; b += 1; }
  while (isBlack(a) || ![0, 5].includes(((a % 12) + 12) % 12)) a--;
  while (isBlack(b) || ![4, 11].includes(((b % 12) + 12) % 12)) b++;
  const whites = [];
  for (let m = a; m <= b; m++) if (!isBlack(m)) whites.push(m);
  const root = div('kb' + (mini ? ' mini' : ''));
  const view = div('kb-view');
  const track = div('kb-track');
  view.appendChild(track);
  const bar = div('kb-bar', `<button type="button" class="kb-z" data-z="-1">－</button><div class="kb-map"><div class="kb-win"></div></div><button type="button" class="kb-z" data-z="1">＋</button>`);
  if (!mini) root.appendChild(bar);
  root.appendChild(view);
  host.appendChild(root);
  const keys = new Map();
  for (let m = a; m <= b; m++) {
    const k = div('key ' + (isBlack(m) ? 'blk' : 'wht'), isBlack(m) ? '' : `<span>${((m % 12) === 0) ? '도' + (Math.floor(m / 12) - 1) : ''}</span>`);
    k.dataset.m = m;
    track.appendChild(k);
    keys.set(m, k);
  }
  let vis = mini ? whites.length : Math.min(whites.length, window.innerWidth > window.innerHeight ? 17 : 10);
  let off = 0, ww = 40, userAt = 0;
  function layout() {
    const W = view.clientWidth || 360;
    ww = W / vis;
    const bw = ww * 0.6;
    track.style.width = `${whites.length * ww}px`;
    whites.forEach((m, i) => { const k = keys.get(m); k.style.left = `${i * ww}px`; k.style.width = `${ww}px`; });
    for (let m = a; m <= b; m++) {
      if (!isBlack(m)) continue;
      const i = whites.indexOf(m - 1);
      const k = keys.get(m);
      k.style.left = `${(i + 1) * ww - bw / 2}px`;
      k.style.width = `${bw}px`;
    }
    setOff(off);
  }
  function setOff(x) {
    off = clamp(x, 0, Math.max(0, whites.length - vis));
    track.style.transform = `translateX(${(-off * ww).toFixed(1)}px)`;
    const map = bar.querySelector('.kb-win');
    map.style.left = `${(off / whites.length) * 100}%`;
    map.style.width = `${(vis / whites.length) * 100}%`;
  }
  const whiteIdx = (m) => { const i = whites.indexOf(m); return i >= 0 ? i : whites.indexOf(m - 1) + 0.5; };
  /** 건반 가운데 x(보이는 칸 기준 px) */
  const keyX = (m) => (isBlack(m) ? whites.indexOf(m - 1) + 1 : whites.indexOf(m) + 0.5) * ww - off * ww;
  // 누르기: 손가락마다 지금 건반을 기억(미끄러지면 옆 건반으로)
  const held = new Map();
  function keyAt(x, y) {
    const e = document.elementFromPoint(x, y);
    const k = e && e.closest ? e.closest('.key') : null;
    return k && track.contains(k) ? Number(k.dataset.m) : null;
  }
  function velAt(m, y) {
    const k = keys.get(m);
    if (!k) return 0.75;
    const r = k.getBoundingClientRect();
    return clamp(0.45 + ((y - r.top) / r.height) * 0.55, 0.4, 1);
  }
  view.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { view.setPointerCapture(e.pointerId); } catch (err) {}
    const m = keyAt(e.clientX, e.clientY);
    if (m == null) return;
    held.set(e.pointerId, m);
    keys.get(m).classList.add('on');
    onDown(m, e.pointerId, velAt(m, e.clientY));
  });
  view.addEventListener('pointermove', (e) => {
    if (!held.has(e.pointerId)) return;
    const m = keyAt(e.clientX, e.clientY);
    const prev = held.get(e.pointerId);
    if (m == null || m === prev) return;
    keys.get(prev).classList.remove('on');
    onUp(prev, e.pointerId);
    held.set(e.pointerId, m);
    keys.get(m).classList.add('on');
    onDown(m, e.pointerId, velAt(m, e.clientY));
  });
  const up = (e) => {
    const m = held.get(e.pointerId);
    if (m == null) return;
    held.delete(e.pointerId);
    if (![...held.values()].includes(m)) keys.get(m).classList.remove('on');
    onUp(m, e.pointerId);
  };
  view.addEventListener('pointerup', up);
  view.addEventListener('pointercancel', up);
  // 위쪽 작은 지도: 끌어서 옮기기, －/＋ 로 보이는 건반 수
  const mapEl = bar.querySelector('.kb-map');
  let dragMap = false;
  const mapMove = (e) => {
    const r = mapEl.getBoundingClientRect();
    setOff(((e.clientX - r.left) / r.width) * whites.length - vis / 2);
    userAt = now();
  };
  mapEl.addEventListener('pointerdown', (e) => { e.preventDefault(); dragMap = true; try { mapEl.setPointerCapture(e.pointerId); } catch (err) {} mapMove(e); });
  mapEl.addEventListener('pointermove', (e) => { if (dragMap) mapMove(e); });
  mapEl.addEventListener('pointerup', () => { dragMap = false; });
  bar.querySelectorAll('.kb-z').forEach((btn) => btn.addEventListener('click', () => {
    const c = off + vis / 2;
    vis = clamp(vis - Number(btn.dataset.z) * 2, 7, Math.max(7, whites.length));
    layout();
    setOff(c - vis / 2);
    userAt = now();
  }));
  const ro = new ResizeObserver(() => layout());
  ro.observe(view);
  layout();
  return {
    root, keys, lo: a, hi: b,
    keyX, get ww() { return ww; }, get width() { return view.clientWidth; },
    highlight(map) {
      for (const [m, k] of keys) {
        const v = map.get(m);
        k.classList.toggle('next', v === 'next');
        k.classList.toggle('soon', v === 'soon');
        k.classList.toggle('tgt', v === 'tgt');
      }
    },
    flash(m) { const k = keys.get(m); if (!k) return; k.classList.remove('flash'); void k.offsetWidth; k.classList.add('flash'); },
    follow(m) {
      if (m == null || now() - userAt < 2500 || mini) return;
      const i = whiteIdx(m);
      if (i < off + 1.5 || i > off + vis - 2.5) setOff(off + ((i - vis / 2) - off) * 0.18);
    },
    centerOn(m) { setOff(whiteIdx(m) - vis / 2); },
    destroy() { ro.disconnect(); root.remove(); },
  };
}

function createPiano(env) {
  const el = div('ins piano', `<canvas class="fall" id="fallCv"></canvas><div class="kb-host"></div><div class="ins-mini-hint" id="pianoHint"></div>`);
  const piano = env.voice('piano');
  const voices = new Map(); // pointerId -> { v, m }
  const played = new Set();
  let partRef = null;
  let kb = null;
  const fall = el.querySelector('#fallCv');
  const fg = fall.getContext('2d');
  function rebuild() {
    const p = env.part();
    partRef = p;
    played.clear();
    if (kb) kb.destroy();
    const lo = p && p.notes.length ? p.lo : 60;
    const hi = p && p.notes.length ? p.hi : 76;
    kb = mountKeyboard(el.querySelector('.kb-host'), { lo, hi, onDown: (m, id, vel) => down(m, id, vel), onUp: (m, id) => up(m, id) });
    const first = p && p.notes[0] ? p.notes[0].m : 64;
    kb.centerOn(first);
  }
  function target(beat, bpm) {
    const p = env.part();
    if (!p) return null;
    const win = env.diff() === 'easy' ? 0.45 : 0.32;
    for (const n of p.notes) {
      if (played.has(n.i) || n.chord) continue;
      const dt = (n.b - beat) * 60 / bpm;
      if (dt < -win) { played.add(n.i); continue; }
      if (dt <= (env.diff() === 'easy' ? 1.1 : win)) return n;
      return null;
    }
    return null;
  }
  function down(key, id, vel = 0.8, t = now()) {
    const c = env.clock();
    const diff = env.diff();
    let m = key, tgt = null;
    if (c.song && env.part()) {
      tgt = target(c.beat, c.bpm);
      if (tgt && (diff === 'easy' || (diff === 'normal' && key === tgt.m))) {
        if (diff === 'easy') m = tgt.m;
        played.add(tgt.i);
        // 묶인 음을 이어서 칩니다(빠른 대목을 한 번에)
        const spb = 60 / c.bpm;
        for (const f of tgt.fill) piano.play(f[2], { when: env.synth.now() + f[0] * spb, dur: Math.max(0.12, f[1] * spb * 0.95), vel: vel * (f[3] || 0.8) });
      } else if (tgt && diff === 'hard') {
        const chord = env.part().notes.filter((n) => Math.abs(n.b - tgt.b) < 0.01 && n.m === key);
        if (chord.length) played.add(chord[0].i);
      }
    }
    const v = piano.noteOn(m, { vel: vel * env.dyn() });
    const prev = voices.get(id);
    if (prev) prev.v.off();
    voices.set(id, { v, m });
    if (m !== key && kb) kb.flash(m);
    haptics.play('tick', 1, { silent: true });
    env.send('play', stamp(env, t, { k: 'key', m, km: key, vel: r2(vel), fi: tgt && m === tgt.m && diff !== 'hard' ? tgt.i : undefined }));
    env.action('key', { m });
    env.signal('key', { m, key });
    if (voices.size >= 2) env.signal('chord', { ms: [...voices.values()].map((x) => x.m) });
  }
  function up(key, id) {
    const h = voices.get(id);
    if (!h) return;
    voices.delete(id);
    h.v.off();
    env.send('release', { m: h.m });
  }
  rebuild();
  let partSeen = env.part();
  function frame() {
    if (env.part() !== partSeen) { partSeen = env.part(); rebuild(); }
    const c = env.clock();
    const p = env.part();
    const diff = env.diff();
    const map = new Map();
    // 떨어지는 막대(쉬움·보통)
    const r = fall.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (fall.width !== W || fall.height !== H) { fall.width = W; fall.height = H; }
    fg.clearRect(0, 0, W, H);
    const showFall = c.song && p && diff !== 'hard';
    el.classList.toggle('hard', diff === 'hard' || !c.song);
    el.querySelector('#pianoHint').textContent = !c.song ? '자유 연습 · 마음껏 쳐 보세요' : diff === 'easy' ? '쉬움 · 막대가 닿을 때 아무 건반이나 눌러도 맞는 음' : diff === 'normal' ? '보통 · 빛나는 건반을 눌러요' : '어려움 · 악보를 보고 쳐요';
    if (showFall) {
      const ahead = 2.4;
      const col = env.color();
      let nextDone = false;
      for (const n of p.notes) {
        const dt = (n.b - c.beat) * 60 / c.bpm;
        if (dt < -0.3) continue;
        if (dt > ahead) break;
        const x = kb.keyX(n.m) * dpr;
        const w = (isBlack(n.m) ? kb.ww * 0.5 : kb.ww * 0.78) * dpr;
        const y = H - (dt / ahead) * H;
        const h = Math.max(8 * dpr, (n.d * 60 / c.bpm / ahead) * H * 0.9);
        const done = played.has(n.i);
        fg.globalAlpha = done ? 0.25 : 1;
        fg.fillStyle = col;
        fg.shadowColor = col;
        fg.shadowBlur = done ? 0 : 12 * dpr;
        rr(fg, x - w / 2, y - h, w, h, 6 * dpr);
        fg.fill();
        fg.shadowBlur = 0;
        fg.globalAlpha = 1;
        if (!done && !n.chord) {
          if (!nextDone) { map.set(n.m, 'next'); nextDone = true; kb.follow(n.m); }
          else if (!map.has(n.m) && dt < 1.4) map.set(n.m, 'soon');
        }
      }
      // 판정선
      fg.fillStyle = 'rgba(255,255,255,.35)';
      fg.fillRect(0, H - 2 * dpr, W, 2 * dpr);
    }
    if (kb) kb.highlight(map);
  }
  return {
    el, kind: 'keys', frame,
    tutorial() {
      const seq = [60, 64, 67];
      let k = 0;
      return [
        { title: '빛나는 건반 누르기', body: '반짝이는 건반을 차례로 눌러요. 도 · 미 · 솔', waitFor: 'key', count: 3, hint: '빛나는 건반을 눌러요',
          check: (d) => (d.key === seq[k] ? (k++, true) : `${solfa(seq[k])} 건반이 빛나요`),
          render: (s) => {
            k = 0;
            const box = div('tut-kb');
            s.appendChild(box);
            const mk = mountKeyboard(box, { lo: 60, hi: 72, mini: true, onDown: (m, id, vel) => down(m, 'tut' + id, vel), onUp: (m, id) => up(m, 'tut' + id) });
            const tm = setInterval(() => mk.highlight(new Map([[seq[Math.min(k, 2)], 'next']])), 120);
            return () => { clearInterval(tm); mk.destroy(); box.remove(); };
          } },
        { title: '내려오는 막대 보기', body: '연주할 때는 위에서 막대가 내려와요. 건반에 닿을 때 누르면 돼요. 쉬움은 아무 건반이나 눌러도 맞는 음이 나요.',
          svg: '<svg class="pcgt-svg" viewBox="0 0 200 160"><rect x="30" y="112" width="140" height="40" rx="5" fill="#f4f1e8"/><g fill="#1a1d26"><rect x="52" y="112" width="12" height="24"/><rect x="80" y="112" width="12" height="24"/><rect x="122" y="112" width="12" height="24"/></g><rect x="96" y="20" width="18" height="30" rx="5" fill="var(--pcgt-c)"><animate attributeName="y" values="10;80;10" dur="1.6s" repeatCount="indefinite"/></rect><path d="M30 110h140" stroke="#fff" stroke-opacity=".5" stroke-width="2"/></svg>' },
        { title: '두 건반 같이', body: '어려움에서는 화음이 나와요. 두 건반을 동시에 눌러 봐요.', waitFor: 'chord',
          render: (s) => {
            const box = div('tut-kb');
            s.appendChild(box);
            const mk = mountKeyboard(box, { lo: 60, hi: 72, mini: true, onDown: (m, id, vel) => down(m, 'tut' + id, vel), onUp: (m, id) => up(m, 'tut' + id) });
            mk.highlight(new Map([[60, 'next'], [64, 'next']]));
            return () => { mk.destroy(); box.remove(); };
          } },
      ];
    },
    destroy() { for (const h of voices.values()) h.v.off(); if (kb) kb.destroy(); },
    test: { down: (m) => { down(m, 'test', 0.8); setTimeout(() => up(m, 'test'), 220); }, get kb() { return kb; } },
  };
}
function rr(g, x, y, w, h, r) {
  const q = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + q, y); g.arcTo(x + w, y, x + w, y + h, q); g.arcTo(x + w, y + h, x, y + h, q); g.arcTo(x, y + h, x, y, q); g.arcTo(x, y, x + w, y, q);
  g.closePath();
}

// ═════════════════════ 관악기(트럼펫·호른): 마이크에 "후" + 밸브 ═════════════════════
function ringMeter(cls = '') {
  const e = div('ring ' + cls, `<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="ring-bg"/><circle cx="60" cy="60" r="52" class="ring-fg" pathLength="100"/></svg><div class="ring-txt"><b></b><span></span></div>`);
  return {
    el: e,
    set(level, big, small) {
      e.style.setProperty('--lv', clamp(level, 0, 1).toFixed(3));
      e.classList.toggle('on', level > 0.04);
      if (big != null) e.querySelector('b').textContent = big;
      if (small != null) e.querySelector('span').textContent = small;
    },
  };
}
function mountValves(host, onChange, cls = '') {
  const box = div('valves ' + cls, [1, 2, 3].map((k) => `<button type="button" class="valve" data-v="${k}"><i></i><b>${k}</b></button>`).join(''));
  host.appendChild(box);
  const press = new Map(); // pointerId -> valve
  const btns = [...box.querySelectorAll('.valve')];
  const mask = () => { let m = 0; for (const v of press.values()) m |= 1 << (v - 1); return m; };
  const paint = () => { const m = mask(); btns.forEach((b, i) => b.classList.toggle('on', Boolean(m & (1 << i)))); onChange(m); };
  btns.forEach((b) => {
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); try { b.releasePointerCapture(e.pointerId); } catch (err) {} press.set(e.pointerId, Number(b.dataset.v)); paint(); });
  });
  const up = (e) => { if (press.delete(e.pointerId)) paint(); };
  box.addEventListener('pointerup', up);
  box.addEventListener('pointercancel', up);
  box.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') up(e); });
  return {
    el: box,
    hint(m) { btns.forEach((b, i) => b.classList.toggle('want', m != null && Boolean(m & (1 << i)))); },
    set(m) { press.clear(); [1, 2, 3].forEach((v) => { if (m & (1 << (v - 1))) press.set('k' + v, v); }); paint(); },
    destroy() { box.remove(); },
  };
}
function createWind(env) {
  const horn = env.inst === 'horn';
  const el = div('ins wind' + (horn ? ' horn' : ''), `
    <div class="wind-top"><div class="wind-meter"></div><div class="wind-side"><div class="wind-now" id="windNow"></div><div class="wind-next" id="windNext"></div></div></div>
    <div class="valve-host"></div>
    <button type="button" class="blowbtn hidden" id="blowBtn">누르는 동안 불기</button>
    <div class="ins-hint" id="windHint"><b>마이크에 후~ 불어요</b><span>${horn ? '호른은 둘째 성부(화음)를 맡아요' : '폰 아래쪽 마이크를 입 가까이'}</span></div>
    <div class="ins-note hidden" id="micNote"></div>`);
  const synthInst = env.voice(horn ? 'horn' : 'trumpet');
  const meter = ringMeter();
  el.querySelector('.wind-meter').appendChild(meter.el);
  let mask = 0, lastMask = 0, voice = null, curM = null, lastSend = 0, button = false;
  const valveSrc = { main: 0, tut: 0 };
  const setMask = (src, m) => { valveSrc[src] = m; mask = valveSrc.main | valveSrc.tut; };
  const valves = mountValves(el.querySelector('.valve-host'), (m) => setMask('main', m));
  let breath = null, micState = 'opening';
  const meters = new Set();
  env.openMic(false).then((mic) => {
    if (!mic) { micState = 'denied'; return; }
    breath = createBreath(mic);
    micState = mic.sim ? 'sim' : 'on';
  });
  const blowBtn = el.querySelector('#blowBtn');
  blowBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); button = true; blowBtn.classList.add('on'); });
  const bUp = () => { button = false; blowBtn.classList.remove('on'); };
  blowBtn.addEventListener('pointerup', bUp);
  blowBtn.addEventListener('pointercancel', bUp);
  blowBtn.addEventListener('pointerleave', bUp);
  let wasOn = false;
  function pitchNow() {
    const c = env.clock();
    const p = env.part();
    if (c.song && p && p.notes.length) {
      const tg = targetAt(p, c.beat);
      const t = tg ? tg.m : 67;
      return { m: env.diff() === 'easy' ? t : pitchForValves(mask, t), want: tg ? valvesFor(tg.m) : null, tg };
    }
    const base = FREE_VALVE_NOTE[mask] ?? 67;
    return { m: horn ? base - 7 : base, want: null, tg: null };
  }
  function frame(t = now()) {
    let st;
    if (breath) st = breath.read(t);
    else st = { on: button, onset: button && !wasOn, level: button ? 0.8 : 0 };
    if (button && breath && !st.on) st = { on: true, onset: !wasOn, level: 0.8 };
    blowBtn.classList.toggle('hidden', micState === 'on' || micState === 'sim');
    const note = el.querySelector('#micNote');
    note.classList.toggle('hidden', micState !== 'denied');
    note.textContent = '마이크를 못 써서 버튼으로 불어요';
    const pn = pitchNow();
    const lv = st.level;
    const d = env.diff();
    // 밸브 안내: 보통은 눌러야 할 밸브를 밝혀 주고, 어려움은 악보 숫자만
    valves.hint(env.clock().song && d === 'normal' && pn.want != null ? pn.want : null);
    el.querySelector('#windNow').innerHTML = `<b>${solfa(pn.m)}</b><span>${noteName(pn.m)}</span>`;
    const nx = pn.tg && pn.tg.next;
    el.querySelector('#windNext').textContent = env.clock().song && nx ? (d === 'easy' ? `다음 ${solfa(nx.m)}` : `다음 ${solfa(nx.m)} · 밸브 ${valveLabel(valvesFor(nx.m))}`) : env.clock().song ? '' : '밸브를 바꿔 누르면 음이 바뀌어요';
    meter.set(lv, st.on ? '후~' : '', st.on ? '' : '불어요');
    for (const f of meters) f(lv, st.on, pn.m);
    if (st.on) {
      if (!voice || st.onset) {
        if (voice) voice.off();
        voice = synthInst.noteOn(pn.m, { vel: 0.5 + lv * 0.4 });
        curM = pn.m;
        env.send('play', stamp(env, t, { k: 'blow', m: pn.m, vl: mask, vel: r2(lv) }));
        env.action('blow', { lv });
        env.signal('blow', { mask });
        lastMask = mask;
      } else if (pn.m !== curM || mask !== lastMask) {
        voice.setPitch(pn.m, 0.025);
        const art = mask !== lastMask;
        curM = pn.m;
        env.send('play', stamp(env, t, { k: 'slur', m: pn.m, vl: mask, art: art ? 1 : 0 }));
        if (art) env.signal('valve', { mask });
        lastMask = mask;
      }
      voice.setLevel((0.35 + lv * 0.85) * env.dyn());
      if (t - lastSend > 80) { lastSend = t; env.send('level', { lv: r2(lv), m: curM, vl: mask }, true); }
    } else if (voice) {
      voice.off();
      voice = null;
      env.send('release', {});
      env.action('rest', {});
    }
    wasOn = st.on;
    el.classList.toggle('blowing', st.on);
  }
  return {
    el, kind: 'wind', frame,
    tutorial() {
      const meterStage = (s, withValves) => {
        const box = div('tut-wind');
        const m2 = ringMeter('mini');
        box.appendChild(m2.el);
        let v2 = null;
        if (withValves) v2 = mountValves(box, (m) => setMask('tut', m), 'mini');
        const st = div('tut-mic');
        box.appendChild(st);
        const b2 = document.createElement('button');
        b2.className = 'tut-btn ghost';
        b2.textContent = '마이크 없이: 누르는 동안 불기';
        b2.addEventListener('pointerdown', (e) => { e.preventDefault(); button = true; });
        b2.addEventListener('pointerup', () => { button = false; });
        b2.addEventListener('pointerleave', () => { button = false; });
        box.appendChild(b2);
        s.appendChild(box);
        const f = (lv, on, m) => {
          m2.set(lv, on ? solfa(m) : '', on ? noteName(m) : '후~');
          st.textContent = micState === 'on' ? '마이크 켜짐 · 숨소리를 듣는 중' : micState === 'sim' ? '마이크 흉내(시험)' : micState === 'opening' ? '마이크 여는 중…' : '마이크를 못 써요 · 아래 버튼으로 해요';
        };
        meters.add(f);
        return () => { meters.delete(f); setMask('tut', 0); button = false; if (v2) v2.destroy(); box.remove(); };
      };
      return [
        { title: horn ? '호른처럼 들기' : '트럼펫처럼 들기', body: '폰 아래쪽(마이크)을 입 가까이 대고, 폰을 옆으로 눕혀 앞으로 쭉 들어요.', svg: 'blow' },
        { title: '후~ 불어 보기', body: '목소리 말고 숨만 마이크에 후~ 불어요. 부는 동안 소리가 나요.', waitFor: 'blow', okText: '소리가 났어요!', render: (s) => meterStage(s, false) },
        { title: '밸브 누르며 불기', body: '1번 밸브를 누른 채 불면 음이 바뀌어요. 보통·어려움에서는 악보 위 숫자대로 눌러요.', waitFor: ['valve', 'blow'],
          check: (d) => (d.mask === 1 ? true : '1번 밸브만 누른 채 불어요'), render: (s) => meterStage(s, true) },
        { title: '끊어서 세 번', body: '후, 후, 후 — 숨을 끊어서 세 번 불어요. 끊을 때마다 새 음이에요.', waitFor: 'blow', count: 3, render: (s) => meterStage(s, false) },
      ];
    },
    destroy() { if (voice) voice.off(); valves.destroy(); },
    test: { blow(level = 0.8) { if (breath) breath.sim.level = level; else button = level > 0; }, valves: (m) => valves.set(m), get mic() { return micState; } },
  };
}

// ═════════════════════ 바이올린(옆으로 들고 활 긋기) ═════════════════════
function mountBowPad(host, { onStroke, onMove, onStop }, cls = '') {
  const pad = div('bowpad ' + cls, `<div class="bow"><i class="bow-stick"></i><i class="bow-hair"></i></div><div class="bowpad-hint">← 좌우로 쓱쓱 →</div>`);
  host.appendChild(pad);
  const bow = pad.querySelector('.bow');
  let id = null, lx = 0, ly = 0, lt = 0, vx = 0, vy = 0, dir = 0, axis = null, moved = 0, speed = 0, stopTimer = null;
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (id != null) return;
    id = e.pointerId;
    try { pad.setPointerCapture(id); } catch (err) {}
    lx = e.clientX; ly = e.clientY; lt = e.timeStamp || now(); vx = vy = 0; dir = 0; axis = null; moved = 0;
  });
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const t = e.timeStamp || now();
    const dt = Math.max(4, t - lt);
    const dx = e.clientX - lx, dy = e.clientY - ly;
    lx = e.clientX; ly = e.clientY; lt = t;
    vx = vx * 0.5 + (dx / dt) * 1000 * 0.5;
    vy = vy * 0.5 + (dy / dt) * 1000 * 0.5;
    moved += Math.hypot(dx, dy);
    if (!axis && moved > 14) axis = Math.abs(vx) >= Math.abs(vy) ? 'x' : 'y';
    const r = pad.getBoundingClientRect();
    bow.style.setProperty('--bx', `${(((e.clientX - r.left) / r.width) - 0.5) * 100}%`);
    if (!axis) return;
    const v = axis === 'x' ? vx : vy;
    speed = Math.hypot(vx, vy);
    const sgn = Math.sign(v);
    if (speed > 140 && sgn && sgn !== dir) {
      dir = sgn;
      onStroke(dir, clamp(speed / 1600, 0.25, 1), t);
    }
    if (dir) onMove(clamp(speed / 1500, 0.12, 1));
    clearTimeout(stopTimer);
    stopTimer = setTimeout(() => { if (dir) { dir = 0; onStop(); } }, 160);
  });
  const up = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    clearTimeout(stopTimer);
    if (dir) { dir = 0; onStop(); }
  };
  pad.addEventListener('pointerup', up);
  pad.addEventListener('pointercancel', up);
  return { el: pad, destroy() { clearTimeout(stopTimer); pad.remove(); } };
}
function createViolin(env) {
  const el = div('ins violin', `
    <div class="vio-top">
      <div class="vio-body"><i class="vio-f l"></i><i class="vio-f r"></i><div class="vio-strings">${STRINGS.map((s) => `<i data-s="${s}"></i>`).join('')}</div><i class="vio-bridge"></i></div>
      <div class="vio-info"><div class="wind-now" id="vioNow"></div><div class="wind-next" id="vioNext"></div></div>
    </div>
    <div class="vio-strbtns">${STRINGS.map((s, i) => `<button type="button" class="strbtn" data-i="${i}">${s}</button>`).join('')}</div>
    <div class="bow-host"></div>`);
  const vio = env.voice('violin');
  let voice = null, curM = null, level = 0, strHeld = null, scaleI = 4, lastSend = 0, bowing = false;
  const SCALE = [62, 64, 66, 67, 69, 71, 73, 74, 76, 78, 79];
  const strBtns = [...el.querySelectorAll('.strbtn')];
  const strSrc = new Map();
  const strPaint = () => { const v = [...strSrc.values()]; strHeld = v.length ? v[v.length - 1] : null; strBtns.forEach((b, i) => b.classList.toggle('on', strHeld === i)); };
  strBtns.forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); try { b.releasePointerCapture(e.pointerId); } catch (err) {} strSrc.set(e.pointerId, Number(b.dataset.i)); strPaint(); }));
  const strUp = (e) => { if (strSrc.delete(e.pointerId)) strPaint(); };
  el.querySelector('.vio-strbtns').addEventListener('pointerup', strUp);
  el.querySelector('.vio-strbtns').addEventListener('pointercancel', strUp);
  function pitchNow(newStroke, dir) {
    const c = env.clock(), p = env.part();
    if (c.song && p && p.notes.length) {
      const tg = targetAt(p, c.beat);
      const t = tg ? tg.m : 69;
      if (env.diff() !== 'hard') return { m: t, tg };
      // 어려움: 고른 현이 맞아야 그 음. 틀린 현이면 같은 손가락 자리로 다른 현 음(5도 어긋남)
      const want = stringFor(t);
      if (strHeld == null) return { m: OPEN_STRING[want] === t ? t : OPEN_STRING[want], tg };
      return { m: strHeld === want ? t : t + (OPEN_STRING[strHeld] - OPEN_STRING[want]), tg };
    }
    if (strHeld != null) return { m: OPEN_STRING[strHeld], tg: null };
    if (newStroke) scaleI = clamp(scaleI + (dir > 0 ? 1 : -1), 0, SCALE.length - 1);
    return { m: SCALE[scaleI], tg: null };
  }
  function stroke(dir, vel, t = now()) {
    const pn = pitchNow(true, dir);
    if (voice) voice.off(env.synth.now() + 0.02);
    voice = vio.noteOn(pn.m, { vel: 0.4 + vel * 0.5 });
    curM = pn.m;
    level = vel;
    bowing = true;
    el.classList.add('bowing');
    el.classList.toggle('up', dir < 0);
    env.send('play', stamp(env, t, { k: 'bow', m: pn.m, dir, str: strHeld, vel: r2(vel) }));
    env.action('bow', { dir });
    env.signal('stroke', { dir, str: strHeld });
    if (strHeld != null) env.signal('string', { str: strHeld });
    strokeAt = t;
  }
  let strokeAt = 0;
  function move(lv) { level = level * 0.6 + lv * 0.4; }
  function stop() {
    bowing = false;
    el.classList.remove('bowing');
    if (voice) { voice.off(); voice = null; env.send('release', {}); env.action('rest', {}); }
    if (strokeAt && now() - strokeAt > 900) env.signal('long', {});
  }
  const pad = mountBowPad(el.querySelector('.bow-host'), { onStroke: stroke, onMove: move, onStop: stop });
  function frame(t = now()) {
    const c = env.clock();
    const hard = env.diff() === 'hard';
    el.classList.toggle('hard', hard || !c.song);
    if (voice && bowing) {
      const pn = pitchNow(false);
      if (pn.m !== curM) { voice.setPitch(pn.m, 0.03); curM = pn.m; env.send('play', stamp(env, t, { k: 'slur', m: pn.m, str: strHeld })); }
      voice.setLevel((0.3 + level * 0.9) * env.dyn());
      if (strokeAt && t - strokeAt > 1000) env.signal('long', {});
      if (t - lastSend > 80) { lastSend = t; env.send('level', { lv: r2(level), m: curM, str: strHeld }, true); }
    }
    const pn = c.song && env.part() ? targetAt(env.part(), c.beat) : null;
    const showM = voice ? curM : pn ? pn.m : SCALE[scaleI];
    el.querySelector('#vioNow').innerHTML = `<b>${solfa(showM)}</b><span>${noteName(showM)}${hard && pn ? ` · ${STRINGS[stringFor(pn.m)]}현` : ''}</span>`;
    el.querySelector('#vioNext').textContent = !c.song ? '현 버튼을 누르고 그으면 그 현 소리' : pn && pn.next ? `다음 ${solfa(pn.next.m)}${hard ? ` · ${STRINGS[stringFor(pn.next.m)]}현` : ''}` : '';
  }
  return {
    el, kind: 'bow', frame,
    tutorial() {
      const mini = (s) => {
        const box = div('tut-bow');
        s.appendChild(box);
        const pp = mountBowPad(box, { onStroke: stroke, onMove: move, onStop: stop }, 'mini');
        return () => { pp.destroy(); box.remove(); };
      };
      return [
        { title: '바이올린처럼 들기', body: '폰을 옆으로 눕혀 한 손으로 받쳐요. 다른 손 손가락이 활이에요.', svg: 'bow' },
        { title: '활 긋기', body: '화면을 좌우로 쓱쓱 문질러요. 방향을 바꿀 때마다 새 음이에요.', waitFor: 'stroke', count: 4, hint: '네 번 그어요', render: mini },
        { title: '길게 끌기', body: '한 방향으로 천천히 1초 넘게 끌면 음이 길게 이어져요.', waitFor: 'long', render: mini },
        { title: '현 고르기 (어려움)', body: '어려움에서는 악보 위 글자(G·D·A·E) 현 버튼을 엄지로 누른 채 그어요. A 현을 누르고 그어 봐요.', waitFor: 'string',
          check: (d) => (d.str === 2 ? true : 'A 현 버튼을 누른 채 그어요'),
          render: (s) => {
            const box = div('tut-bow');
            const sb = div('vio-strbtns mini', STRINGS.map((x, i) => `<button type="button" class="strbtn${i === 2 ? ' want' : ''}" data-i="${i}">${x}</button>`).join(''));
            box.appendChild(sb);
            s.appendChild(box);
            sb.querySelectorAll('.strbtn').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); try { b.releasePointerCapture(e.pointerId); } catch (err) {} strSrc.set('t' + e.pointerId, Number(b.dataset.i)); strPaint(); sb.querySelectorAll('.strbtn').forEach((x) => x.classList.toggle('on', x === b)); }));
            const u = () => { for (const k of [...strSrc.keys()]) if (String(k).startsWith('t')) strSrc.delete(k); strPaint(); sb.querySelectorAll('.strbtn').forEach((x) => x.classList.remove('on')); };
            sb.addEventListener('pointerup', u);
            sb.addEventListener('pointercancel', u);
            const pp = mountBowPad(box, { onStroke: stroke, onMove: move, onStop: stop }, 'mini');
            return () => { u(); pp.destroy(); box.remove(); };
          } },
      ];
    },
    destroy() { if (voice) voice.off(); pad.destroy(); },
    test: {
      stroke: (dir = 1, ms = 600) => { stroke(dir, 0.8); const iv = setInterval(() => move(0.7), 50); setTimeout(() => { clearInterval(iv); stop(); }, ms); },
      string(i) { strSrc.clear(); if (i != null) strSrc.set('test', i); strPaint(); },
    },
  };
}

// ═════════════════════ 성악가(진짜 목소리 + 음정 보정) ═════════════════════
// 보정 방식: 마이크로 들은 음높이를 목표 음 쪽으로 끌어당긴 '합창 아~' 소리를 폰 스피커로 냅니다(목소리 크기를 그대로 따라감).
// 날목소리를 스피커로 다시 내보내지 않는 까닭: 폰 마이크와 스피커가 붙어 있어 되울림(하울링)이 납니다.
// 방 안 사람들은 노래하는 사람의 진짜 목소리와, 그 목소리를 따라 맞는 음으로 부르는 합창을 함께 듣습니다.
function createVoice(env) {
  const el = div('ins voice', `
    <canvas class="pitch-cv"></canvas>
    <div class="voice-top"><div class="wind-now" id="voNow"></div><div class="fixbadge" id="voFix"></div></div>
    <div class="voice-lv"><i></i></div>
    <button type="button" class="blowbtn hidden" id="humBtn">누르는 동안 노래(마이크 없음)</button>
    <div class="ins-hint"><b>마이크에 노래해요</b><span id="voHint">음정이 조금 틀려도 맞게 고쳐서 불러 줘요</span></div>`);
  const choir = env.voice('choir');
  const cv = el.querySelector('.pitch-cv');
  const g = cv.getContext('2d');
  let pitch = null, micState = 'opening', voice = null, curM = null, unv = 0, lastSend = 0, hum = false;
  const trace = []; // { t, raw, fix, target }
  const meters = new Set();
  env.openMic(true).then((mic) => {
    if (!mic) { micState = 'denied'; return; }
    pitch = createPitch(mic);
    micState = mic.sim ? 'sim' : 'on';
  });
  const humBtn = el.querySelector('#humBtn');
  humBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); hum = true; humBtn.classList.add('on'); });
  const hUp = () => { hum = false; humBtn.classList.remove('on'); };
  humBtn.addEventListener('pointerup', hUp);
  humBtn.addEventListener('pointercancel', hUp);
  humBtn.addEventListener('pointerleave', hUp);
  let matchSince = 0, voicedSince = 0;
  let tutTarget = null;
  function correct(raw, target, diff) {
    if (target == null) return Math.round(raw);
    const tOct = target + 12 * Math.round((raw - target) / 12);
    const dev = raw - tOct;
    const tol = PITCH_TOL[diff] || 1.6;
    if (Math.abs(dev) > tol * 2.4) return Math.round(raw); // 너무 멀면 가까운 반음으로만
    const fix = VOICE_FIX[diff] ?? 0.75;
    return raw - dev * fix;
  }
  const C_MAJOR = [0, 2, 4, 5, 7, 9, 11];
  function snapScale(raw) {
    let best = Math.round(raw), bd = 99;
    for (let m = Math.floor(raw) - 2; m <= Math.ceil(raw) + 2; m++) if (C_MAJOR.includes(((m % 12) + 12) % 12) && Math.abs(m - raw) < bd) { bd = Math.abs(m - raw); best = m; }
    return best;
  }
  function frame(t = now()) {
    const c = env.clock(), p = env.part(), diff = env.diff();
    let rd = pitch ? pitch.read() : { midi: null, level: 0 };
    const tg = c.song && p && p.notes.length ? targetAt(p, c.beat) : null;
    const target = tutTarget != null ? tutTarget : tg ? tg.m : null;
    if (hum && rd.midi == null) rd = { midi: target != null ? target : 67, level: 0.75 };
    humBtn.classList.toggle('hidden', micState === 'on' || micState === 'sim');
    const voiced = rd.midi != null && rd.midi > 35 && rd.midi < 96;
    let fix = null;
    if (voiced) {
      unv = 0;
      fix = target != null ? correct(rd.midi, target, tutTarget != null ? 'normal' : diff) : snapScale(rd.midi);
      if (!voice) {
        voice = choir.noteOn(fix, { vel: 0.5 + rd.level * 0.4 });
        curM = fix;
        env.send('play', stamp(env, t, { k: 'sing', m: Math.round(fix), raw: r2(rd.midi), vel: r2(rd.level) }));
        env.action('sing', {});
        voicedSince = t;
      } else {
        voice.setPitch(fix, 0.04);
        if (Math.round(fix) !== Math.round(curM)) env.send('play', stamp(env, t, { k: 'slur', m: Math.round(fix), raw: r2(rd.midi) }));
        curM = fix;
      }
      voice.setLevel((0.3 + rd.level * 0.9) * env.dyn());
      if (t - lastSend > 80) { lastSend = t; env.send('level', { lv: r2(rd.level), m: r2(fix), raw: r2(rd.midi) }, true); }
      if (t - voicedSince > 1200) env.signal('voiced', { m: rd.midi });
      if (target != null) {
        const tOct = target + 12 * Math.round((rd.midi - target) / 12);
        if (Math.abs(rd.midi - tOct) <= 1.6) { if (!matchSince) matchSince = t; if (t - matchSince > 700) env.signal('match', {}); }
        else matchSince = 0;
      }
    } else if (voice) {
      if (!unv) unv = t;
      if (t - unv > 160) { voice.off(); voice = null; env.send('release', {}); env.action('rest', {}); matchSince = 0; }
    }
    trace.push({ t, raw: voiced ? rd.midi : null, fix: voiced ? fix : null, target });
    while (trace.length && trace[0].t < t - 4200) trace.shift();
    el.style.setProperty('--lv', (voiced ? rd.level : 0).toFixed(2));
    for (const f of meters) f(voiced ? rd.midi : null, fix, target);
    el.querySelector('#voNow').innerHTML = target != null ? `<b>${solfa(target)}</b><span>${noteName(target)}</span>` : `<b>${voiced ? solfa(fix) : '아~'}</b><span>${voiced ? noteName(fix) : '편하게 불러 봐요'}</span>`;
    el.querySelector('#voFix').textContent = c.song ? `보정 ${Math.round((VOICE_FIX[diff] ?? 0.75) * 100)}%` : '보정 켜짐';
    el.querySelector('#voHint').textContent = micState === 'denied' ? '마이크를 못 써서 버튼을 누르는 동안 노래로 쳐요' : micState === 'opening' ? '마이크 여는 중…' : '음정이 조금 틀려도 맞게 고쳐서 불러 줘요';
    drawPitch(cv, g, trace, t, env.color());
  }
  return {
    el, kind: 'voice', frame,
    tutorial() {
      const meterStage = (s, tgt) => {
        tutTarget = tgt;
        const box = div('tut-voice', `<div class="tv-row"><div class="tv-k">내 목소리</div><b class="tv-raw">–</b></div><div class="tv-row"><div class="tv-k">맞춘 음</div><b class="tv-fix">–</b></div>${tgt != null ? `<div class="tv-row"><div class="tv-k">목표</div><b class="tv-tgt">${solfa(tgt)} · ${noteName(tgt)}</b></div><div class="tv-bar"><i></i><em></em></div>` : ''}<div class="tut-mic"></div>`);
        const b2 = document.createElement('button');
        b2.className = 'tut-btn ghost';
        b2.textContent = '마이크 없이: 누르는 동안 노래';
        b2.addEventListener('pointerdown', (e) => { e.preventDefault(); hum = true; });
        b2.addEventListener('pointerup', () => { hum = false; });
        b2.addEventListener('pointerleave', () => { hum = false; });
        box.appendChild(b2);
        s.appendChild(box);
        const f = (raw, fix, target) => {
          box.querySelector('.tv-raw').textContent = raw != null ? `${solfa(raw)} ${noteName(raw)}` : '–';
          box.querySelector('.tv-fix').textContent = fix != null ? `${solfa(fix)} ${noteName(fix)}` : '–';
          box.querySelector('.tut-mic').textContent = micState === 'on' ? '마이크 켜짐 · 듣는 중' : micState === 'sim' ? '마이크 흉내(시험)' : micState === 'opening' ? '마이크 여는 중…' : '마이크를 못 써요 · 버튼으로 해요';
          if (tgt != null) {
            const bar = box.querySelector('.tv-bar em');
            const dev = raw != null ? clamp(raw - (tgt + 12 * Math.round((raw - tgt) / 12)), -4, 4) : null;
            bar.style.left = dev == null ? '50%' : `${50 + dev * 11}%`;
            bar.style.opacity = dev == null ? '0.25' : '1';
            box.classList.toggle('near', dev != null && Math.abs(dev) <= 1.6);
          }
        };
        meters.add(f);
        return () => { meters.delete(f); tutTarget = null; hum = false; box.remove(); };
      };
      return [
        { title: '아~ 소리 내기', body: '폰을 입 앞 한 뼘에 두고, 편한 높이로 "아~" 하고 1초 넘게 불러요.', waitFor: 'voiced', okText: '잘 들려요!', render: (s) => meterStage(s, null) },
        { title: '솔 음에 맞추기', body: '"솔~" 하고 불러요. 남자는 한 옥타브 낮아도 괜찮아요. 가까우면 맞춰 줘요.', waitFor: 'match', okText: '딱 맞았어요!', render: (s) => meterStage(s, 67) },
        { title: '보정이 도와줘요', body: '조금 틀려도 폰이 맞는 음의 합창 소리로 같이 불러 줘요. 쉬움일수록 많이 도와줘요. 큰 소리로 자신 있게!', svg: 'check' },
      ];
    },
    destroy() { if (voice) voice.off(); },
    test: { sing(midi, level = 0.7) { if (pitch) { pitch.sim.midi = midi; pitch.sim.level = midi == null ? 0 : level; } else hum = midi != null; }, get mic() { return micState; } },
  };
}
function drawPitch(cv, g, trace, t, color) {
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
  if (!W || !H) return;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  g.clearRect(0, 0, W, H);
  const last = trace[trace.length - 1];
  const center = last && last.target != null ? last.target : last && last.fix != null ? last.fix : 67;
  const span = 14;
  const yOf = (m) => H / 2 - ((m - center) / span) * H;
  // 반음 줄
  for (let m = Math.floor(center - span / 2); m <= center + span / 2; m++) {
    const y = yOf(m);
    const white = ![1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
    g.fillStyle = white ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.18)';
    g.fillRect(0, y - H / span / 2, W, H / span);
    if (white) { g.fillStyle = 'rgba(255,255,255,.35)'; g.font = `600 ${11 * dpr}px Pretendard, system-ui`; g.fillText(solfa(m), 6 * dpr, y + 4 * dpr); }
  }
  const xOf = (tt) => W - ((t - tt) / 4200) * W * 0.8 - W * 0.2;
  // 목표 띠
  g.fillStyle = color;
  g.globalAlpha = 0.35;
  for (const p of trace) if (p.target != null) { const y = yOf(p.target); g.fillRect(xOf(p.t), y - H / span / 2 + 2 * dpr, 3 * dpr, H / span - 4 * dpr); }
  g.globalAlpha = 1;
  // 내 목소리(흰 선, 목표와 같은 옥타브로 옮겨 그림)와 맞춘 음(내 색)
  const line = (key, style, w) => {
    g.strokeStyle = style; g.lineWidth = w * dpr; g.lineJoin = 'round';
    g.beginPath();
    let pen = false;
    for (const p of trace) {
      if (p[key] == null) { pen = false; continue; }
      let m = p[key];
      const ref = p.target != null ? p.target : center;
      m = m + 12 * Math.round((ref - m) / 12);
      const x = xOf(p.t), y = yOf(m);
      if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y);
    }
    g.stroke();
  };
  line('raw', 'rgba(255,255,255,.75)', 2.5);
  line('fix', color, 4);
  g.fillStyle = 'rgba(255,255,255,.5)';
  g.fillRect(W * 0.8, 0, 2 * dpr, H);
}

// ═════════════════════ 지휘자(폰 = 지휘봉) ═════════════════════
// deviceorientation 으로 폰 윗부분(지휘봉 끝)이 가리키는 방향을 좌우·위아래 각도로 바꾸고, 빠르게 움직이다 멈칫하는 순간(박점)을 잡습니다.
// 박점 직전 움직임 방향으로 아래(1)·왼쪽(2)·오른쪽(3)·위(4)를 가립니다.
const RD = Math.PI / 180;
function qFromEuler(x, y, z) {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
}
function qRot(q, v) {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
function topVector(o) { return qRot(qFromEuler(o.beta * RD, o.alpha * RD, -o.gamma * RD), [0, 0, -1]); }

function createBaton(env) {
  const el = div('ins baton', `
    <canvas class="bat-cv"></canvas>
    <div class="bat-info"><div><span>빠르기</span><b id="batTempo">–</b></div><div><span>셈여림</span><b id="batDyn">mf</b></div><div><span>박</span><b id="batBeat">–</b></div></div>
    <button type="button" class="recal" id="batRecal">기준 다시 맞추기</button>
    <div class="ins-hint"><b>지휘봉처럼 박자를 저어요</b><span id="batHint">크게 저으면 크게, 빨리 저으면 빨라져요</span></div>`);
  const cv = el.querySelector('.bat-cv');
  const g = cv.getContext('2d');
  let yaw0 = null;
  let last = null; // { t, x, y }
  let vx = 0, vy = 0, sp = 0;
  let inStroke = false, peak = 0, peakV = [0, 0], lastIctus = -1e9, recent = [], strokeLen = 0;
  const trail = []; // { t, x, y }
  const hits = []; // { t, dir, n }
  let lastPose = 0, beatInBar = 0, dynWord = 'mf', tempoPct = null;
  const tick = env.voice('drums');
  function pos(o) {
    const top = topVector(o);
    const yaw = Math.atan2(top[0], -top[2]) / RD;
    const pitch = Math.asin(clamp(top[1], -1, 1)) / RD;
    if (yaw0 == null) yaw0 = yaw;
    let x = yaw - yaw0;
    if (x > 180) x -= 360;
    if (x < -180) x += 360;
    // 기준 방향이 아주 천천히 따라오게(오래 지휘하면 몸이 조금씩 돌아가므로)
    yaw0 += x * 0.0015;
    return { x: -x, y: pitch };
  }
  const offO = sensors.onOrient((o) => {
    const p = pos(o);
    const t = o.t;
    if (last && p.x === last.x && p.y === last.y) return; // 같은 값이 겹쳐 오는 폰
    if (last) {
      const dt = Math.max(8, t - last.t) / 1000;
      vx = vx * 0.45 + ((p.x - last.x) / dt) * 0.55;
      vy = vy * 0.45 + ((p.y - last.y) / dt) * 0.55;
      strokeLen += Math.hypot(p.x - last.x, p.y - last.y);
    }
    last = { t, ...p };
    trail.push({ t, x: p.x, y: p.y });
    while (trail.length && trail[0].t < t - 1400) trail.shift();
    feed(t);
    if (t - lastPose > 50) { lastPose = t; env.send('pose', { x: r2(p.x), y: r2(p.y) }, true); }
  });
  function feed(t) {
    sp = Math.hypot(vx, vy);
    const c = env.clock();
    const beatMs = c.song ? (60000 / c.bpm) : 600;
    const refr = Math.max(170, beatMs * 0.42);
    if (!inStroke) {
      if (sp > 55 && t - lastIctus > refr * 0.6) { inStroke = true; peak = sp; peakV = [vx, vy]; strokeLen = 0; }
    } else {
      if (sp > peak) { peak = sp; peakV = [vx, vy]; }
      else if (sp < peak * 0.38 && peak > 85) {
        inStroke = false;
        if (t - lastIctus < refr) return;
        const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : peak;
        if (peak < avg * 0.42) return; // 작은 되튐은 박이 아님
        lastIctus = t;
        recent.push(peak);
        if (recent.length > 6) recent.shift();
        ictus(t, dirOf(peakV), strokeLen);
      } else if (sp < 25) inStroke = false;
    }
  }
  function dirOf([x, y]) {
    const a = Math.atan2(y, x) / RD; // 0 오른쪽, 90 위
    if (a > 45 && a < 135) return 'up';
    if (a < -45 && a > -135) return 'down';
    return Math.abs(a) <= 45 ? 'right' : 'left';
  }
  function ictus(t, dir, size) {
    const c = env.clock();
    hits.push({ t, dir });
    while (hits.length > 8) hits.shift();
    const sz = clamp(size, 2, 120);
    dynWord = sz < 10 ? 'pp' : sz < 18 ? 'p' : sz < 28 ? 'mp' : sz < 40 ? 'mf' : sz < 56 ? 'f' : 'ff';
    if (!c.song) { tick.play(dir === 'down' ? 76 : 77, { vel: dir === 'down' ? 0.75 : 0.45 }); }
    haptics.hit(dir === 'down' ? 0.55 : 0.3, { silent: true, noFlash: true });
    env.send('beat', stamp(env, t, { dir, size: Math.round(sz) }));
    env.action('beat', { dir });
    env.signal('beat', { dir, size: sz });
    // 한 마디(무늬 순서대로 4번)
    const pat = PATTERNS['4/4'].map((x) => x[1]);
    const seq = hits.slice(-4).map((h) => h.dir);
    if (seq.length === 4 && seq.every((d2, i) => d2 === pat[i])) env.signal('bar', {});
  }
  // 센서 없는 폰·PC: 화면을 밀면 그 방향 박
  let sw = null;
  cv.addEventListener('pointerdown', (e) => { e.preventDefault(); sw = { x: e.clientX, y: e.clientY, t: now() }; });
  cv.addEventListener('pointerup', (e) => {
    if (!sw) return;
    const dx = e.clientX - sw.x, dy = sw.y - e.clientY;
    const len = Math.hypot(dx, dy);
    sw = null;
    if (len < 18) return;
    const d = dirOf([dx, dy]);
    trail.push({ t: now(), x: dx / 6, y: dy / 6 });
    ictus(now(), d, len / 5);
  });
  el.querySelector('#batRecal').addEventListener('click', () => { yaw0 = null; trail.length = 0; });
  function frame(t = now()) {
    const c = env.clock();
    const song = env.song && env.song();
    const pat = c.song && song ? patternOf(song) : PATTERNS['4/4'];
    if (c.song) {
      const barLen = song ? song.barLen : 4;
      const pos = ((c.beat % barLen) + barLen) % barLen;
      let k = 0;
      pat.forEach(([off], i) => { if (pos + 0.5 >= off) k = i; });
      beatInBar = k + 1;
    }
    el.querySelector('#batTempo').textContent = tempoPct == null ? (c.song ? `${Math.round(c.bpm)}` : '–') : `${tempoPct > 0 ? '+' : ''}${tempoPct}%`;
    el.querySelector('#batDyn').textContent = dynWord;
    el.querySelector('#batBeat').textContent = c.song ? `${beatInBar}/${pat.length}` : hits.length ? DIR_ARROW[hits[hits.length - 1].dir] : '–';
    el.querySelector('#batHint').textContent = env.noSensor() ? '센서가 없어 화면을 그 방향으로 밀면 박이에요' : '크게 저으면 크게, 빨리 저으면 빨라져요';
    drawBaton(cv, g, pat, trail, hits, t, env.color(), c.song ? beatInBar : null);
  }
  return {
    el, kind: 'baton', frame,
    setTempo(pct) { tempoPct = pct; },
    calibrate() { yaw0 = null; trail.length = 0; },
    tutorial() {
      let want = ['left', 'right'];
      const swipe = (s) => {
        if (!env.noSensor() && !DEBUG) return null;
        const p = div('tut-swipe', '<span>센서가 없으면 여기를 그 방향으로 밀어요</span>');
        s.appendChild(p);
        let st = null;
        p.addEventListener('pointerdown', (e) => { e.preventDefault(); st = { x: e.clientX, y: e.clientY }; });
        p.addEventListener('pointerup', (e) => { if (!st) return; const dx = e.clientX - st.x, dy = st.y - e.clientY; st = null; if (Math.hypot(dx, dy) > 18) ictus(now(), dirOf([dx, dy]), Math.hypot(dx, dy) / 5); });
        return () => p.remove();
      };
      return [
        { title: '지휘봉 쥐는 법', body: '엄지와 검지로 폰 아래쪽을 잡고 나머지 손가락은 가볍게 받쳐요. 폰 윗부분이 지휘봉 끝이에요. 끝을 큰 화면 쪽으로 향하고 다음을 눌러요.', svg: 'point' },
        { title: '1박: 아래로', body: '지휘봉 끝을 위에서 아래로 툭 떨어뜨렸다 살짝 튕겨요.', svg: 'conduct', waitFor: 'beat', check: (d) => (d.dir === 'down' ? true : `${DIR_KO[d.dir]} 움직였어요. 아래로 툭!`), render: swipe },
        { title: '2박 왼쪽, 3박 오른쪽', body: '왼쪽으로 한 번, 이어서 오른쪽으로 크게 한 번 저어요.', svg: 'conduct', waitFor: 'beat', count: 2, hint: '왼쪽 → 오른쪽',
          check: (d) => { if (d.dir === want[0]) { want = want.slice(1).concat(want[0]); return true; } return `이번엔 ${DIR_KO[want[0]]}`; },
          render: (s) => { want = ['left', 'right']; return swipe(s); } },
        { title: '4박: 위로', body: '위로 올려 다시 1박 자리로 돌아가요.', svg: 'conduct', waitFor: 'beat', check: (d) => (d.dir === 'up' ? true : '위로 올려요'), render: swipe },
        { title: '이어서 한 마디', body: '아래 → 왼쪽 → 오른쪽 → 위. 크게 저으면 소리가 커지고, 빨리 저으면 빨라져요.', svg: 'conduct', waitFor: 'bar', okText: '멋진 지휘!', render: swipe },
      ];
    },
    onTutStep(i) { if (i === 1) this.calibrate(); },
    destroy() { offO(); },
    test: { beat: (dir, size = 30) => ictus(now(), dir, size), get trail() { return trail; } },
  };
}
const PAT_POS = {
  4: { down: [0, -0.62], left: [-0.62, -0.25], right: [0.66, -0.28], up: [0.02, 0.62] },
  3: { down: [0, -0.62], right: [0.62, -0.3], up: [0.02, 0.62] },
  2: { down: [0, -0.62], up: [0.02, 0.6] },
};
function drawBaton(cv, g, pat, trail, hits, t, color, beatNow) {
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
  if (!W || !H) return;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  g.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H * 0.5, R = Math.min(W, H) * 0.4;
  const P = PAT_POS[pat.length] || PAT_POS[4];
  const pts = pat.map(([, d]) => [cx + P[d][0] * R, cy - P[d][1] * R]);
  // 무늬 길(점선)
  g.setLineDash([4 * dpr, 7 * dpr]);
  g.strokeStyle = 'rgba(255,255,255,.28)';
  g.lineWidth = 2.5 * dpr;
  g.beginPath();
  pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2 - R * 0.28; g.moveTo(p[0], p[1]); g.quadraticCurveTo(mx, my, q[0], q[1]); });
  g.stroke();
  g.setLineDash([]);
  pts.forEach((p, i) => {
    const on = beatNow === i + 1;
    g.fillStyle = on ? color : 'rgba(255,255,255,.12)';
    g.beginPath(); g.arc(p[0], p[1], (on ? 26 : 20) * dpr, 0, Math.PI * 2); g.fill();
    g.fillStyle = on ? '#0b1220' : 'rgba(255,255,255,.75)';
    g.font = `400 ${(on ? 24 : 19) * dpr}px Anton, Impact, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(i + 1), p[0], p[1] + dpr);
  });
  g.textAlign = 'start'; g.textBaseline = 'alphabetic';
  // 지휘봉 자국
  if (trail.length > 1) {
    const last = trail[trail.length - 1];
    const k = R / 45;
    g.lineCap = 'round';
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1], b = trail[i];
      const age = (t - b.t) / 1400;
      g.strokeStyle = color;
      g.globalAlpha = Math.max(0, 1 - age);
      g.lineWidth = (2 + 7 * (1 - age)) * dpr;
      g.beginPath();
      g.moveTo(cx + (a.x - last.x * 0.3) * k, cy - (a.y - last.y * 0.3) * k);
      g.lineTo(cx + (b.x - last.x * 0.3) * k, cy - (b.y - last.y * 0.3) * k);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  // 최근 박점
  const h = hits[hits.length - 1];
  if (h && t - h.t < 500) {
    const a = 1 - (t - h.t) / 500;
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.font = `800 ${Math.round(44 * dpr)}px Pretendard, system-ui`;
    g.textAlign = 'center';
    g.fillText(DIR_ARROW[h.dir], cx, cy + 14 * dpr);
    g.textAlign = 'start';
  }
}

export function createInstrument(inst, env) {
  switch (INSTRUMENTS[inst] ? INSTRUMENTS[inst].kind : '') {
    case 'strike': return createDrum(env);
    case 'tap': return createCastanets(env);
    case 'keys': return createPiano(env);
    case 'wind': return createWind(env);
    case 'bow': return createViolin(env);
    case 'voice': return createVoice(env);
    case 'baton': return createBaton(env);
    default: return createCastanets(env);
  }
}
