// 스윙 기록기(폰). 어드레스부터 피니시까지 센서 값을 그대로 모아서, 스윙이 끝나면 큰 화면에 swing_data 로 보냅니다.
//
// 받는 값: 컨트롤러가 이미 계산하는 기준축(r = 공 쪽, u = 위, f = 목표 쪽) 좌표의
//   s  = 폰 윗부분(샤프트) 방향, fc = 화면 바깥 방향. controller.js 의 onSample 에 있는 그 값입니다.
// 보내는 값: 몸 좌표 B(x = 목표, y = 위, z = 공 쪽. 오른손 좌표계)의 사원수.
//   사원수는 기기 좌표(W3C: x = 화면 오른쪽, y = 폰 윗부분, z = 화면 바깥)를 B 로 돌립니다.
//   그래서 윗부분 = q·(0,1,0), 화면 = q·(0,0,1) 입니다.
//   r,u,f 를 그대로 쓰지 않는 까닭: f = u × r 이라 (r,u,f) 는 왼손 좌표계여서 사원수로 나타낼 수 없습니다.
//
// 표본 한 줄: [t(ms, 첫 표본 기준), qx, qy, qz, qw, rx, ry, rz(도/초, 기기 좌표), ax, ay, az(m/s², 기기 좌표)]
//
// 쓰는 법(폰):
//   const cap = createSwingCapture({ send: (ev, data) => send(ev, data), club: () => club, hand: () => 'right' });
//   어드레스 끝(calibrate 직후): cap.begin({ shaft0: basis.shaft0 })   (club, hand 도 여기서 줄 수 있습니다)
//   onSample 안에서:               cap.sample(t, s, fc)   (임팩트 뒤에도 피니시까지 계속 넣어야 합니다. mode 검사보다 먼저 부르세요)
//   devicemotion 안에서:           cap.motion(e)
//   임팩트를 잡았을 때:            cap.impact(t)
//   다시 어드레스/취소:            cap.cancel()
//   피니시가 끝나면 스스로 send('swing_data', packet) 을 부르고 onDone(packet) 을 알립니다.
//   센서가 끊겨 피니시를 못 잡으면 컨트롤러가 cap.finish() 를 불러 지금까지 모은 것을 보냅니다.
//   왼손잡이(hand 'left')는 목표 쪽 축(f)을 뒤집어 단계를 잡고, 표본은 잰 그대로 보내며 packet.hand 로 알립니다.
//
// 일반 스크립트(IIFE)에서는 `const { createSwingCapture } = await import('/play/golf/swing-capture.js')` 로 부르거나,
// <script type="module" src="swing-capture.js"> 로 불러 window.PCGSwingCapture 를 씁니다.

const RD = Math.PI / 180;

// ---------- 작은 벡터·사원수 계산 ----------
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b)))));
// r,u,f 배열 → 몸 좌표 B(x = f, y = u, z = r)
const toB = (v) => [v[2], v[1], v[0]];
const fromB = (v) => [v[2], v[1], v[0]];

function qMul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
function qAxis(axis, ang) {
  const n = norm(axis);
  const s = Math.sin(ang / 2);
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(ang / 2)];
}
function qRot(q, v) {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
function qNorm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
// a 를 b 로 돌리는 가장 짧은 회전
function qBetween(a, b) {
  a = norm(a);
  b = norm(b);
  const d = dot(a, b);
  if (d < -0.999999) {
    let ax = cross([1, 0, 0], a);
    if (len(ax) < 1e-6) ax = cross([0, 1, 0], a);
    return qAxis(ax, Math.PI);
  }
  const c = cross(a, b);
  return qNorm([c[0], c[1], c[2], 1 + d]);
}
function qSlerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) { d = -d; bb = [-b[0], -b[1], -b[2], -b[3]]; }
  if (d > 0.9995) return qNorm([a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t]);
  const th = Math.acos(d);
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb];
}
// 열 벡터(오른쪽, 윗부분, 화면)로 만든 회전 행렬 → 사원수 (three.js 와 같은 방식)
function qFromBasis(X, Y, Z) {
  const m11 = X[0], m12 = Y[0], m13 = Z[0];
  const m21 = X[1], m22 = Y[1], m23 = Z[1];
  const m31 = X[2], m32 = Y[2], m33 = Z[2];
  const tr = m11 + m22 + m33;
  let x, y, z, w;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    w = 0.25 / s; x = (m32 - m23) * s; y = (m13 - m31) * s; z = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    w = (m32 - m23) / s; x = 0.25 * s; y = (m12 + m21) / s; z = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    w = (m13 - m31) / s; x = (m12 + m21) / s; y = 0.25 * s; z = (m23 + m32) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
    w = (m21 - m12) / s; x = (m13 + m31) / s; y = (m23 + m32) / s; z = 0.25 * s;
  }
  return qNorm([x, y, z, w]);
}

// 폰 윗부분(B)과 화면(B)으로 기기 방향 사원수를 만듭니다. 화면 벡터가 윗부분과 거의 겹치면 직전 화면 방향을 옮겨 씁니다.
function orientQ(topB, faceB, prevFace) {
  const Y = norm(topB);
  let Z = sub(faceB, scale(Y, dot(faceB, Y)));
  if (len(Z) < 0.2 && prevFace) Z = sub(prevFace, scale(Y, dot(prevFace, Y)));
  if (len(Z) < 1e-6) Z = Math.abs(Y[0]) < 0.9 ? cross(Y, [1, 0, 0]) : cross(Y, [0, 1, 0]);
  Z = norm(Z);
  const X = cross(Y, Z);
  return { q: qFromBasis(X, Y, Z), face: Z };
}

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;

let idSeq = 0;

// ---------- 기록기 ----------
export function createSwingCapture(opts = {}) {
  const maxSamples = Math.max(60, opts.maxSamples || 400);
  const preKeepMs = opts.preKeepMs || 500;
  let st = null;
  let lastMotion = null;
  let lastPacket = null;

  function fresh(extra) {
    st = {
      stage: 'idle', raw: [], s0: null, s0n: 0, back: null, phi: 0, prev: null,
      topI: -1, topPhi: 0, takeI: -1, impI: -1, impT: null, finI: -1, maxPhi: -1e9,
      peakRate: 0, gyroPeak: 0, prevFace: null, prevQ: null, id: '', gravity: false, lefty: false, side: null, ...extra
    };
  }
  fresh();

  function setStage(s) {
    if (st.stage === s) return;
    st.stage = s;
    if (opts.onStage) try { opts.onStage(s); } catch (e) {}
  }

  const pick = (v) => (typeof v === 'function' ? v() : v);
  // 왼손잡이는 목표 쪽 축(f)을 뒤집어 오른손잡이처럼 단계를 잡습니다.
  const mir = (v) => (st.lefty ? [v[0], v[1], -v[2]] : v);
  function setRef(s0) {
    st.s0 = norm(s0);
    st.back = norm(cross(st.s0, [0, 0, -1]));
    st.side = cross(st.back, st.s0);
  }
  // 어드레스 기준면에 비춘 샤프트 각(도). 들어 올리면 음수입니다.
  const projPhi = (s) => -Math.atan2(dot(s, st.side), dot(s, st.s0)) / RD;

  function begin(o = {}) {
    idSeq += 1;
    const hand = o.hand || pick(opts.hand) || 'right';
    fresh({ id: `${Date.now().toString(36)}${idSeq}`, club: o.club || pick(opts.club) || null, lefty: hand === 'left' });
    if (Array.isArray(o.shaft0)) {
      setRef(mir(o.shaft0));
      st.s0n = 99;
      st.shaft0 = norm(o.shaft0);
    }
    setStage('address');
  }

  function cancel() {
    fresh();
  }

  // devicemotion 값은 다음 방향 표본에 붙입니다.
  function motion(e) {
    if (!e) return;
    const r = e.rotationRate;
    const a = e.acceleration && e.acceleration.x != null ? e.acceleration : e.accelerationIncludingGravity;
    const rr = r && (r.alpha != null || r.beta != null || r.gamma != null) ? [r.beta || 0, r.gamma || 0, r.alpha || 0] : null;
    if (a && !(e.acceleration && e.acceleration.x != null)) st.gravity = true;
    lastMotion = { rr, acc: a ? [a.x || 0, a.y || 0, a.z || 0] : null };
    if (rr && (st.stage === 'down' || (st.stage === 'follow' && st.raw.length && st.raw.length - 1 - st.impI < 4))) {
      st.gyroPeak = Math.max(st.gyroPeak, Math.hypot(rr[0], rr[1], rr[2]));
    }
  }

  function sample(t, s, fc) {
    if (st.stage === 'idle' || st.stage === 'sent') return;
    if (!Array.isArray(s) || !Array.isArray(fc)) return;
    const sRaw = norm(s);
    s = mir(sRaw);
    // 어드레스 기준: 시작 때 받은 값이 없으면 처음 몇 표본의 평균
    if (st.s0n < 6) {
      setRef(st.s0 ? add(scale(st.s0, st.s0n), s) : s);
      st.s0n += 1;
    }
    const o = orientQ(toB(sRaw), toB(fc), st.prevFace);
    let q = o.q;
    if (st.prevQ && q[0] * st.prevQ[0] + q[1] * st.prevQ[1] + q[2] * st.prevQ[2] + q[3] * st.prevQ[3] < 0) q = q.map((x) => -x);
    st.prevQ = q;
    st.prevFace = o.face;
    // 스윙 진행 각도(들어 올리면 음수): 기준면에 비춘 각을 이어 붙입니다. 멈춰 있을 때 잡음이 쌓이지 않습니다.
    if (st.stage === 'address' || !st.prev) st.phi = projPhi(s);
    else st.phi += (((projPhi(s) - projPhi(st.prev) + 540) % 360) + 360) % 360 - 180;
    st.prev = s;
    const d = angle(s, st.s0) / RD;
    const m = lastMotion || {};
    st.raw.push({ t, q, rr: m.rr || [0, 0, 0], acc: m.acc || [0, 0, 0], phi: st.phi, d, s });
    const raw = st.raw;
    const n = raw.length - 1;
    // 진행 속도(도/초): 3표본 떨어진 두 점 사이
    const old = raw[Math.max(0, n - 3)];
    const rate = n > 0 ? (st.phi - old.phi) / Math.max(0.012, (t - old.t) / 1000) : 0;

    if (st.stage === 'address') {
      // 백스윙 전에는 최근 표본만 남깁니다.
      while (raw.length > 2 && t - raw[0].t > preKeepMs) raw.shift();
      if (st.phi < -8) {
        let k = raw.length - 1;
        while (k > 0 && Math.abs(raw[k - 1].phi) > 1.5) k -= 1;
        st.takeI = k;
        st.topI = raw.length - 1;
        st.topPhi = st.phi;
        setStage('back');
      }
      return;
    }
    if (st.stage === 'back') {
      if (st.phi < st.topPhi) {
        st.topPhi = st.phi;
        st.topI = n;
      }
      if (rate > 250 && st.phi > st.topPhi + 25) setStage('down');
      else if (st.phi > st.topPhi + 45) setStage('down');
      // 천천히 다시 내려놓으면 어드레스로
      else if (d < 6 && Math.abs(rate) < 120 && st.topPhi > -60) {
        st.takeI = -1;
        st.topI = -1;
        st.topPhi = 0;
        st.phi = 0;
        setStage('address');
      }
      return;
    }
    if (st.stage === 'down') {
      st.peakRate = Math.max(st.peakRate, rate);
      if (n >= 1 && ((raw[n - 1].d < 45 && d > raw[n - 1].d) || st.phi > 40)) impact(t, true);
      return;
    }
    if (st.stage === 'follow') {
      if (st.phi > st.maxPhi) {
        st.maxPhi = st.phi;
        st.finI = n;
      }
      const since = t - st.impT;
      const slow = rate < Math.max(60, st.peakRate * 0.12);
      if ((since > 300 && slow && st.phi > 60) || (since > 300 && st.phi < st.maxPhi - 10) || since > 1300 || st.phi > 420) finish();
    }
  }

  // 임팩트 순간: 톱 이후 어드레스 방향에 가장 가까웠던 표본을 씁니다.
  function impact(t, self) {
    if (st.stage !== 'down' && st.stage !== 'back') return;
    const raw = st.raw;
    if (!raw.length) return;
    const from = Math.max(0, st.topI);
    let best = raw.length - 1;
    for (let i = from; i < raw.length; i++) if (raw[i].d < raw[best].d) best = i;
    st.impI = best;
    st.impT = raw[best].t;
    st.maxPhi = raw[raw.length - 1].phi;
    st.finI = raw.length - 1;
    st.selfImpact = Boolean(self);
    setStage('follow');
  }

  function finish() {
    if (st.stage === 'idle' || st.stage === 'sent') return null;
    if (st.impI < 0) impact(null, true);
    if (st.impI < 0) return null;
    const packet = build();
    setStage('sent');
    lastPacket = packet;
    if (opts.send) try { opts.send('swing_data', packet); } catch (e) {}
    if (opts.onDone) try { opts.onDone(packet); } catch (e) {}
    return packet;
  }

  function build() {
    const raw = st.raw;
    const last = Math.min(raw.length - 1, st.finI + 3);
    let idx = [];
    for (let i = 0; i <= last; i++) idx.push(i);
    const takeI = Math.max(0, st.takeI);
    const topI = Math.max(takeI, st.topI);
    const impI = Math.max(topI, st.impI);
    const finI = Math.max(impI, Math.min(last, st.finI));
    // 주소(어드레스) 표시는 백스윙 시작 0.2초 전
    let addrI = takeI;
    while (addrI > 0 && raw[takeI].t - raw[addrI - 1].t <= 200) addrI -= 1;
    const keep = new Set([addrI, takeI, topI, impI, finI, 0, last]);
    if (idx.length > maxSamples) {
      // 톱~임팩트 근처는 모두 남기고 나머지를 고르게 솎습니다.
      const dense = [];
      for (let i = Math.max(0, topI - 6); i <= Math.min(last, impI + 8); i++) dense.push(i);
      dense.forEach((i) => keep.add(i));
      const rest = idx.filter((i) => !keep.has(i));
      const room = Math.max(0, maxSamples - keep.size);
      if (room < rest.length) {
        const step = rest.length / Math.max(1, room);
        for (let k = 0; k < room; k++) keep.add(rest[Math.floor(k * step)]);
      } else rest.forEach((i) => keep.add(i));
      idx = [...keep].filter((i) => i <= last).sort((a, b) => a - b);
    }
    const pos = new Map(idx.map((i, k) => [i, k]));
    const t0 = raw[idx[0]].t;
    const dur = raw[last].t - raw[0].t;
    const rate = dur > 0 ? Math.round((last / dur) * 1000) : 60;
    const samples = idx.map((i) => {
      const r = raw[i];
      return [r1(r.t - t0), r4(r.q[0]), r4(r.q[1]), r4(r.q[2]), r4(r.q[3]), r1(r.rr[0]), r1(r.rr[1]), r1(r.rr[2]), r2(r.acc[0]), r2(r.acc[1]), r2(r.acc[2])];
    });
    return {
      v: 1,
      id: st.id,
      rate,
      club: st.club,
      samples,
      marks: { address: pos.get(addrI), takeaway: pos.get(takeI), top: pos.get(topI), impact: pos.get(impI), finish: pos.get(finI) },
      peak: { gyro: Math.round(st.gyroPeak), rate: Math.round(st.peakRate) },
      shaft0: st.shaft0 ? st.shaft0.map(r4) : st.s0 ? mir(st.s0).map(r4) : null,
      hand: st.lefty ? 'left' : 'right',
      gravity: st.gravity ? 1 : 0
    };
  }

  return {
    begin, sample, motion, impact: (t) => impact(t, false), finish, cancel,
    get stage() { return st.stage; },
    get phi() { return st.phi; },
    get count() { return st.raw.length; },
    get lastPacket() { return lastPacket; }
  };
}

// ---------- 임팩트 추정 ----------
// 임팩트 앞뒤 세 표본(p0, p1 = 어드레스에 가장 가까운 표본, p2)으로 그 구간의 원을 맞추고,
// 원 위에서 어드레스 방향 s0 에 가장 가까운 점을 임팩트로 봅니다. 60Hz 에서 표본 사이 어디서 맞았는지에 따라
// 궤도가 몇 도씩 흔들리던 것(가운데 차분)을 없앱니다.
//   p = { t, s, fc } (s, fc 는 r,u,f 배열), yaw0 = 어드레스 때 페이스 방향 atan2(fc[r], fc[f]) (라디안)
//   돌려주는 값: { t, face(+ 열림, 도), path(+ 인-아웃, 도), miss(도), u(-1..1, p1 기준 위치) }
//   ix 는 좌표 순서(기본 r = 0, f = 2). 몸 좌표 B 로 쓸 때는 { r: 2, f: 0 }.
//   more: 앞뒤로 더 있는 표본들({ s }). 하나라도 있으면 원(평면)을 최소제곱으로 맞춰 센서 잡음에 덜 흔들립니다.
export function impactEstimate(p0, p1, p2, s0, yaw0, ix = { r: 0, f: 2 }, more = []) {
  const a = norm(p0.s), b = norm(p1.s), c = norm(p2.s);
  const lerpV = (x, y, u) => [x[0] + (y[0] - x[0]) * u, x[1] + (y[1] - x[1]) * u, x[2] + (y[2] - x[2]) * u];
  let n = cross(sub(b, a), sub(c, b));
  let h0 = null;
  if (more && more.length && len(n) > 1e-7) {
    const pts = [a, b, c, ...more.map((p) => norm(p.s))];
    const ctr = scale(pts.reduce((acc, v) => add(acc, v), [0, 0, 0]), 1 / pts.length);
    const nf = smallestEigen(pts.map((v) => sub(v, ctr)));
    n = dot(nf, n) < 0 ? scale(nf, -1) : nf;
    h0 = dot(n, ctr);
  }
  let u = 0;
  let path;
  let miss;
  if (len(n) > 1e-7) {
    n = norm(n);
    const h = h0 != null ? h0 : dot(n, a);
    const rho = Math.sqrt(Math.max(1e-9, 1 - h * h));
    const ctr = scale(n, h);
    const e = (v) => norm(sub(sub(v, scale(n, dot(n, v) - h)), ctr));
    const cpt = add(ctr, scale(e(s0), rho));
    let tg = norm(cross(n, e(s0)));
    if (dot(tg, sub(c, a)) < 0) tg = scale(tg, -1);
    path = Math.atan2(tg[ix.r], Math.abs(tg[ix.f]) + 1e-9) / RD;
    miss = angle(cpt, s0) / RD;
    const e1 = e(b);
    const pos = (v) => { const ev = e(v); return Math.atan2(dot(cross(e1, ev), n), dot(e1, ev)); };
    const sa = pos(a), sc = pos(c), sx = pos(s0);
    u = sx >= 0 ? (sc > 1e-9 ? Math.min(1, sx / sc) : 0) : (sa < -1e-9 ? -Math.min(1, sx / sa) : 0);
  } else {
    // 세 표본이 한 줄이면 예전 방식(가운데 차분)
    const v = sub(c, a);
    path = Math.atan2(v[ix.r], Math.abs(v[ix.f]) + 1e-9) / RD;
    miss = angle(b, s0) / RD;
  }
  const fImp = u >= 0 ? lerpV(p1.fc, p2.fc, u) : lerpV(p0.fc, p1.fc, 1 + u);
  let face = (Math.atan2(fImp[ix.r], fImp[ix.f]) - yaw0) / RD;
  face = ((((face + 180) % 360) + 360) % 360) - 180;
  const t = u >= 0 ? p1.t + u * (p2.t - p1.t) : p1.t + u * (p1.t - p0.t);
  return { t, face, path, miss, u };
}

// 점들(평균을 뺀 것)이 가장 덜 퍼진 방향 = 맞춘 평면의 법선(야코비 회전)
function smallestEigen(ds) {
  const a = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const d of ds) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) a[i][j] += d[i] * d[j];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q];
    if (off < 1e-14) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
        for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
        for (let k = 0; k < 3; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y; }
      }
    }
  }
  let m = 0;
  for (let i = 1; i < 3; i++) if (a[i][i] < a[m][m]) m = i;
  return norm([v[0][m], v[1][m], v[2][m]]);
}

// ---------- 시험용 스윙 만들기 ----------
// 센서 없는 PC 와 노드 시험에서 씁니다. 폰을 하나의 단단한 물체로 보고 큰 원(평면) 위로 돌려서,
// 컨트롤러가 받는 것과 같은 이벤트 목록을 만듭니다.
//   o: { rate, backswingDeg, backSec, pauseSec, downSec, followDeg, preSec, postSec, impactDps,
//        pathDeg(+ 인-아웃), faceDeg(+ 열림), planeDevDeg(+ 다운스윙이 더 가파름), backPlaneDevDeg,
//        shaft0(r,u,f), noiseDeg, jitterMs, dupProb, seed, gyro(false 면 자이로 없음), hand('left' 면 거울처럼 뒤집은 왼손 스윙) }
// 돌려주는 값: { events: [{type:'o', t, s, fc} | {type:'m', t, rotationRate, acceleration}], design }
//   design 은 같은 원에서 기하로 계산한 기대값(궤도·페이스·플레인)이라 분석 결과와 비교할 수 있습니다.
export function synthSwing(o = {}) {
  const rate = o.rate || 60;
  const A = (o.backswingDeg ?? 265) * RD;
  const backSec = o.backSec ?? 0.9;
  const pauseSec = o.pauseSec ?? 0.04;
  const downSec = o.downSec ?? 0.27;
  const preSec = o.preSec ?? 0.5;
  const postSec = o.postSec ?? 0.3;
  const followA = (o.followDeg ?? 250) * RD;
  const impactDps = o.impactDps ?? 1350;
  let seed = (o.seed ?? 7) >>> 0;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

  const X = [1, 0, 0];
  const Y = [0, 1, 0];
  const d0 = norm(o.shaft0 ? toB(o.shaft0) : [0, -0.83, 0.55]);
  const face0 = norm(sub(X, scale(d0, dot(X, d0))));
  const O0 = qFromBasis(cross(d0, face0), d0, face0);
  const n0 = norm(cross(d0, X)); // + 로 돌면 목표 쪽으로 내려옵니다.
  const incl = (n) => Math.acos(Math.min(1, Math.abs(n[1]))) / RD;
  // 평면을 목표선(x) 둘레로 기울여 기울기를 dev 만큼 바꿉니다.
  const tilt = (n, dev) => {
    if (!dev) return n;
    const want = incl(n) + dev;
    let a = qRot(qAxis(X, dev * RD), n);
    if (Math.abs(incl(a) - want) > Math.abs(incl(qRot(qAxis(X, -dev * RD), n)) - want)) a = qRot(qAxis(X, -dev * RD), n);
    return norm(a);
  };
  const closest = (n, v) => norm(sub(v, scale(n, dot(v, n))));
  const orientN = (n, p) => (dot(cross(n, p), X) < 0 ? scale(n, -1) : n);

  // 백스윙 평면
  const nb = orientN(tilt(n0, o.backPlaneDevDeg || 0), closest(tilt(n0, o.backPlaneDevDeg || 0), d0));
  const pb = closest(nb, d0);
  const Ob = qMul(qBetween(d0, pb), O0);
  // 다운스윙 평면: 기울기 → 방향(궤도) → 최저점 이동 순서로 돌립니다.
  let nd = tilt(n0, o.planeDevDeg || 0);
  if (o.pathDeg) {
    // 평면을 세로축 둘레로 돌립니다. 임팩트 지점 접선의 좌우 각(궤도)이 원하는 값이 되도록 이분 탐색합니다.
    const base = nd;
    const pathOf = (yaw) => {
      const n = orientN(norm(qRot(qAxis(Y, yaw * RD), base)), d0);
      const tn = norm(cross(n, closest(n, d0)));
      return Math.atan2(tn[2], Math.abs(tn[0])) / RD;
    };
    const sg = pathOf(5) > pathOf(-5) ? 1 : -1;
    let a = -45, b = 45;
    for (let k = 0; k < 60; k++) {
      const mid = (a + b) / 2;
      if ((pathOf(mid) - o.pathDeg) * sg > 0) b = mid; else a = mid;
    }
    nd = orientN(norm(qRot(qAxis(Y, ((a + b) / 2) * RD), base)), d0);
  }
  nd = orientN(nd, closest(nd, d0));
  const p = closest(nd, d0);
  // 임팩트 때의 폰 방향: 어드레스 방향을 p 로 옮기고, 샤프트 둘레로 돌려 페이스 각을 맞춥니다.
  const Op0 = qMul(qBetween(d0, p), O0);
  const yawOf = (q) => { const f = qRot(q, [0, 0, 1]); return Math.atan2(f[2], f[0]) / RD; };
  const yaw0 = yawOf(O0);
  const want = o.faceDeg || 0;
  let lo = -80, hi = 80;
  const faceAt = (dl) => { let y = yawOf(qMul(qAxis(p, dl * RD), Op0)) - yaw0; y = ((y + 540) % 360) - 180; return y; };
  const sgn = faceAt(10) > faceAt(-10) ? 1 : -1;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if ((faceAt(mid) - want) * sgn > 0) hi = mid; else lo = mid;
  }
  const Op = qMul(qAxis(p, ((lo + hi) / 2) * RD), Op0);

  // 시간에 따른 회전각
  const pDown = Math.max(1.05, Math.min(3, (impactDps * RD * downSec) / A));
  const followSec = Math.max(0.22, (2 * followA) / (impactDps * RD));
  const T1 = preSec, T2 = T1 + backSec, T3 = T2 + pauseSec, T4 = T3 + downSec, T5 = T4 + followSec, T6 = T5 + postSec;
  const phiAt = (t) => {
    if (t < T1) return { phi: 0, w: 0, ph: 'pre' };
    if (t < T2) { const u = (t - T1) / backSec; return { phi: -A * (0.5 - 0.5 * Math.cos(Math.PI * u)), w: (A * Math.PI * Math.sin(Math.PI * u)) / (2 * backSec) * -1, ph: 'back' }; }
    if (t < T3) return { phi: -A, w: 0, ph: 'top' };
    if (t < T4) { const u = (t - T3) / downSec; return { phi: -A + A * Math.pow(u, pDown), w: (A * pDown * Math.pow(u, pDown - 1)) / downSec, ph: 'down' }; }
    if (t < T5) { const u = (t - T4) / followSec; return { phi: followA * (1 - (1 - u) * (1 - u)), w: (2 * followA * (1 - u)) / followSec, ph: 'follow' }; }
    return { phi: followA, w: 0, ph: 'post' };
  };
  const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const orientAt = (t) => {
    const { phi, w, ph } = phiAt(t);
    let q;
    let axis = nd;
    if (ph === 'pre') q = O0;
    else if (ph === 'back' || ph === 'top') {
      // 백스윙 평면이 다르면 처음 20% 동안 어드레스에서 그 평면으로 옮겨 갑니다.
      const k = smooth(-phi / (0.2 * A));
      q = qSlerp(qMul(qAxis(n0, phi), O0), qMul(qAxis(nb, phi), Ob), k);
      axis = nb;
    } else if (ph === 'down') {
      const k = smooth((phi + A) / (0.3 * A));
      q = qSlerp(qMul(qAxis(nb, phi), Ob), qMul(qAxis(nd, phi), Op), k);
      axis = k < 0.5 ? nb : nd;
    } else q = qMul(qAxis(nd, phi), Op);
    return { q, w, axis, ph };
  };

  const events = [];
  let prevO = null;
  const noise = (o.noiseDeg || 0) * RD;
  for (let i = 0, t = 0; t <= T6; i++, t = i / rate) {
    let tt = t + (o.jitterMs ? (rnd() * 2 - 1) * o.jitterMs / 1000 : 0);
    tt = Math.max(0, tt);
    const { q: q0, w, axis } = orientAt(t);
    let q = q0;
    if (noise) q = qMul(qAxis(norm([gauss(), gauss(), gauss()]), gauss() * noise), q);
    const top = qRot(q, [0, 1, 0]);
    const face = qRot(q, [0, 0, 1]);
    // 각속도(기기 좌표, 도/초)
    const wB = scale(axis, w);
    const inv = [-q[0], -q[1], -q[2], q[3]];
    const wD = qRot(inv, wB).map((x) => x / RD);
    // 가속도: 손이 어깨 둘레 0.6m 를 돈다고 보고 원심 + 접선(8g 에서 잘림)
    const cen = Math.min(78, w * w * 0.6);
    const acc = { x: Math.max(-78, Math.min(78, gauss() * 0.3)), y: -cen + gauss() * 0.3, z: gauss() * 0.3 };
    events.push({ type: 'm', t: tt * 1000, rotationRate: o.gyro === false ? null : { beta: wD[0], gamma: wD[1], alpha: wD[2] }, acceleration: acc });
    if (prevO && o.dupProb && rnd() < o.dupProb) events.push({ type: 'o', t: tt * 1000, s: prevO.s, fc: prevO.fc });
    else {
      // 왼손잡이: 목표 쪽(f)만 뒤집으면 같은 스윙을 반대 손으로 한 것이 됩니다.
      const lm = (v) => (o.hand === 'left' ? [v[0], v[1], -v[2]] : v);
      const ev = { type: 'o', t: tt * 1000, s: lm(fromB(top)), fc: lm(fromB(face)) };
      events.push(ev);
      prevO = ev;
    }
  }
  // 기대값: 같은 원에서 기하로 계산
  const tan = norm(cross(nd, p));
  const design = {
    pathDeg: Math.atan2(tan[2], Math.abs(tan[0])) / RD,
    faceDeg: want,
    planeDeg: incl(nd),
    backPlaneDeg: incl(nb),
    addressPlaneDeg: incl(n0),
    missDeg: angle(p, d0) / RD,
    backswingDeg: A / RD,
    backSec, downSec, pauseSec, hand: o.hand === 'left' ? 'left' : 'right',
    tempoNominal: backSec / downSec,
    // 분석과 같은 정의의 템포: 1.5도 움직인 때부터 톱(가장 높은 곳에서 1도 안쪽에 머문 구간)까지, 톱에서 임팩트까지.
    // 톱에서 0.1초까지는 반씩 나누고 그보다 오래 멈춘 시간은 빼니다.
    ...(() => {
      let ts = null, a0 = null, a1 = null;
      for (let t = 0; t <= T4; t += 0.0005) {
        const ph = phiAt(t).phi / RD;
        if (ts == null && ph < -1.5) ts = t;
        if (ph <= -A / RD + 1) { if (a0 == null) a0 = t; a1 = t; }
      }
      const turn = Math.min(a1 - a0, 0.1) / 2;
      const back = a0 + turn - ts, down = T4 - (a1 - turn);
      return { tempo: back / down, backswingSec: back, downswingSec: down, pauseMeasured: a1 - a0 };
    })(),
    impactDps,
    times: { address: T1, top: T2 + pauseSec / 2, impact: T4, finish: T5 }
  };
  return { events, design };
}

// 이벤트 목록을 기록기에 그대로 흘려 넣습니다(시험용). onImpact 를 주면 컨트롤러처럼 임팩트를 알립니다.
export function feedSwing(cap, events, opts = {}) {
  cap.begin(opts.begin || (opts.hand ? { hand: opts.hand } : {}));
  for (const ev of events) {
    if (cap.stage === 'sent') break;
    if (ev.type === 'm') cap.motion(ev);
    else cap.sample(ev.t, ev.s, ev.fc);
  }
  if (cap.stage !== 'sent') cap.finish();
  return cap.lastPacket;
}

if (typeof window !== 'undefined') window.PCGSwingCapture = { createSwingCapture, synthSwing, feedSwing, impactEstimate };
