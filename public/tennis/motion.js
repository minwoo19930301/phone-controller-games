// 선수 동작: 준비 자세, 포핸드(투핸드 아닌 한 손), 투핸드 백핸드, 서브, 달리기. 오른손잡이 기준.
// 몸 좌표: +x = 선수 왼쪽, +y = 위, +z = 앞(네트 쪽). 시각은 타점 기준 경기 초(타점 = 0).
// 라켓: 손(그립)에서 헤드 쪽 방향 dir, 줄 면의 법선 face. 손에서 헤드 가운데까지 HAND_TO_HEAD.

export const HAND_TO_HEAD = 0.46;

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const nrm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const mix = (a, b, t) => a + (b - a) * t;
const mixV = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const smooth = (t) => t * t * (3 - 2 * t);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export const READY = {
  hipY: 0.86, hipYaw: 0, torsoYaw: 0, lean: 0.3, bend: 0, headYaw: 0, headPitch: 0.05,
  footL: [0.3, 0.08, 0.06], footR: [-0.3, 0.08, 0.0],
  handR: [-0.1, 0.98, 0.38], dir: [0.22, 0.5, 0.84], face: [-0.97, 0.05, 0.24],
  handL: 'throat'
};

// 타점에서 라켓 헤드 가운데(몸 좌표). 공이 이 점에 오게 몸을 세웁니다.
function headAt(k) {
  return add(k.handR, sc(nrm(k.dir), HAND_TO_HEAD));
}

// ---------- 포핸드 ----------
function foreKeys(spin) {
  const top = spin === 'top';
  const slice = spin === 'slice';
  return fill([
    { t: -0.6, ...READY },
    { t: -0.28, hipY: 0.8, hipYaw: -0.55, torsoYaw: -1.05, lean: 0.24, headYaw: 0.95,
      footL: [0.38, 0.08, 0.3], footR: [-0.32, 0.08, -0.14],
      handR: top ? [-0.55, 0.78, -0.42] : slice ? [-0.5, 1.38, -0.32] : [-0.56, 1.05, -0.4],
      dir: top ? [-0.15, -0.25, -0.95] : slice ? [-0.2, 0.75, -0.6] : [-0.25, 0.5, -0.82],
      face: top ? [-0.95, 0.1, 0.25] : slice ? [-0.6, 0.6, 0.5] : [-0.9, 0.15, 0.4],
      handL: [0.3, 1.15, 0.5] },
    { t: -0.09, hipYaw: -0.15, torsoYaw: -0.45, headYaw: 0.5,
      handR: top ? [-0.55, 0.78, 0.0] : slice ? [-0.55, 1.12, 0.0] : [-0.56, 0.9, 0.0],
      dir: top ? [-0.7, -0.2, -0.68] : slice ? [-0.7, 0.35, -0.6] : [-0.68, 0.1, -0.72],
      face: [0.3, 0.1, 0.95], handL: [0.36, 1.1, 0.4] },
    { t: 0, hipY: 0.82, hipYaw: 0.2, torsoYaw: 0.12, lean: 0.26, headYaw: 0.35,
      handR: [-0.45, 0.97, 0.3], dir: [-0.92, 0.0, 0.38], face: slice ? [0.32, 0.35, 0.88] : top ? [0.38, -0.12, 0.92] : [0.38, 0, 0.92],
      handL: [0.38, 1.08, 0.3] },
    { t: 0.13, hipYaw: 0.5, torsoYaw: 0.6, headYaw: 0.1,
      handR: top ? [0.0, 1.38, 0.5] : slice ? [0.05, 0.98, 0.62] : [0.02, 1.22, 0.55],
      dir: top ? [0.15, 0.85, 0.5] : slice ? [0.35, 0.05, 0.94] : [0.4, 0.45, 0.8],
      face: [0.9, -0.1, -0.4], handL: [0.4, 1.1, 0.2] },
    { t: 0.32, hipY: 0.84, hipYaw: 0.75, torsoYaw: 1.0, lean: 0.22, headYaw: 0,
      footR: [-0.2, 0.12, 0.12],
      handR: top ? [0.32, 1.62, 0.12] : slice ? [0.3, 1.0, 0.5] : [0.36, 1.45, 0.1],
      dir: top ? [0.35, 0.65, -0.65] : slice ? [0.65, 0.1, 0.75] : [0.5, 0.25, -0.83],
      face: [0.3, -0.1, 0.95], handL: [0.32, 1.2, 0.18] },
    { t: 0.8, ...READY }
  ]);
}

// ---------- 백핸드(투핸드, 슬라이스는 한 손) ----------
function backKeys(spin) {
  const top = spin === 'top';
  const slice = spin === 'slice';
  return fill([
    { t: -0.6, ...READY },
    { t: -0.28, hipY: 0.8, hipYaw: 0.6, torsoYaw: 1.15, lean: 0.24, headYaw: -1.0,
      footL: [0.3, 0.08, -0.12], footR: [-0.36, 0.08, 0.3],
      handR: top ? [0.48, 0.8, -0.32] : slice ? [0.4, 1.38, -0.25] : [0.5, 1.0, -0.32],
      dir: top ? [0.2, -0.2, -0.95] : slice ? [0.25, 0.75, -0.6] : [0.3, 0.5, -0.8],
      face: [0.9, 0.2, 0.35], handL: slice ? 'throat' : 'grip' },
    { t: -0.09, hipYaw: 0.2, torsoYaw: 0.55, headYaw: -0.5,
      handR: top ? [0.5, 0.8, 0.02] : slice ? [0.48, 1.1, 0.0] : [0.5, 0.9, 0.02],
      dir: top ? [0.7, -0.2, -0.68] : slice ? [0.68, 0.35, -0.64] : [0.68, 0.1, -0.72],
      face: [-0.3, 0.1, 0.95], handL: slice ? [0.1, 1.15, -0.2] : 'grip' },
    { t: 0, hipY: 0.82, hipYaw: -0.15, torsoYaw: -0.12, lean: 0.26, headYaw: -0.35,
      handR: [0.38, 0.92, 0.32], dir: [0.92, 0.0, 0.42], face: slice ? [-0.35, 0.35, 0.87] : [-0.42, 0, 0.92],
      handL: slice ? [-0.15, 1.1, -0.25] : 'grip' },
    { t: 0.13, hipYaw: -0.45, torsoYaw: -0.55, headYaw: -0.1,
      handR: top ? [0.0, 1.35, 0.5] : slice ? [0.1, 1.0, 0.65] : [0.0, 1.2, 0.55],
      dir: top ? [-0.15, 0.85, 0.5] : slice ? [-0.3, 0.1, 0.95] : [-0.4, 0.45, 0.8],
      face: [-0.9, -0.1, -0.4], handL: slice ? [-0.3, 1.05, -0.35] : 'grip' },
    { t: 0.32, hipY: 0.84, hipYaw: -0.7, torsoYaw: -1.0, lean: 0.22, headYaw: 0,
      footL: [0.2, 0.12, 0.12],
      handR: top ? [-0.3, 1.6, 0.12] : slice ? [-0.2, 1.05, 0.55] : [-0.34, 1.45, 0.12],
      dir: top ? [-0.35, 0.65, -0.65] : slice ? [-0.6, 0.15, 0.78] : [-0.5, 0.25, -0.83],
      face: [-0.3, -0.1, 0.95], handL: slice ? [-0.35, 1.0, -0.3] : 'grip' },
    { t: 0.8, ...READY }
  ]);
}

// ---------- 서브 ----------
function serveKeys() {
  return fill([
    { t: -0.95, hipY: 0.9, hipYaw: 0.85, torsoYaw: 1.1, lean: 0.12, headYaw: -0.9, headPitch: 0,
      footL: [0.12, 0.08, 0.32], footR: [-0.2, 0.08, -0.25],
      handR: [-0.22, 1.0, 0.24], dir: [0.35, 0.35, 0.87], face: [-0.9, 0.2, 0.3], handL: [0.0, 1.05, 0.45] },
    { t: -0.72, handL: [-0.12, 1.5, 0.42], handR: [-0.4, 0.95, -0.15], dir: [-0.2, -0.3, -0.93] },
    { t: -0.5, hipY: 0.84, headPitch: -0.6, handL: [-0.12, 2.1, 0.42], handR: [-0.48, 1.2, -0.38], dir: [-0.25, 0.55, -0.8] },
    { t: -0.28, hipY: 0.74, lean: -0.22, torsoYaw: 0.95, headPitch: -0.75,
      handL: [-0.08, 2.05, 0.4], handR: [-0.46, 1.62, -0.3], dir: [-0.15, 0.92, -0.35], face: [-0.95, 0.1, -0.2] },
    { t: -0.12, hipY: 0.86, lean: -0.3, torsoYaw: 0.55,
      handL: [0.05, 1.7, 0.4], handR: [-0.36, 1.78, -0.16], dir: [-0.12, -0.85, -0.5], face: [-0.95, 0.1, 0.2] },
    { t: 0, hipY: 1.0, lean: 0.05, hipYaw: 0.25, torsoYaw: 0.1, headPitch: -0.7, headYaw: -0.1,
      footL: [0.1, 0.18, 0.4], footR: [-0.15, 0.22, -0.05],
      handL: [0.25, 1.35, 0.35], handR: [-0.12, 2.15, 0.25], dir: [-0.1, 0.94, 0.3], face: [0.05, -0.3, 0.95] },
    { t: 0.16, hipY: 0.9, lean: 0.4, hipYaw: -0.1, torsoYaw: -0.3, headPitch: 0.2,
      footL: [0.1, 0.08, 0.55], footR: [-0.2, 0.16, 0.2],
      handL: [0.3, 1.1, 0.25], handR: [0.1, 1.45, 0.62], dir: [0.25, -0.25, 0.94], face: [0.4, 0.8, -0.3] },
    { t: 0.42, hipY: 0.82, lean: 0.5, hipYaw: -0.3, torsoYaw: -0.55, headPitch: 0.1, headYaw: 0,
      footL: [0.18, 0.08, 0.6], footR: [-0.15, 0.08, 0.4],
      handL: [0.25, 1.05, 0.3], handR: [0.32, 0.86, 0.28], dir: [0.4, -0.85, -0.3], face: [0.9, 0.3, 0.2] },
    { t: 1.0, ...READY }
  ]);
}

function fill(keys) {
  for (let i = 1; i < keys.length; i++) {
    for (const k of Object.keys(keys[i - 1])) if (!(k in keys[i])) keys[i][k] = keys[i - 1][k];
  }
  return keys;
}

// 왼손 위치 확정: 'throat' = 라켓 목, 'grip' = 오른손 위(투핸드)
function leftHand(k) {
  if (Array.isArray(k.handL)) return k.handL;
  const d = nrm(k.dir);
  return add(k.handR, sc(d, k.handL === 'grip' ? 0.1 : 0.24));
}

const KEYS = {};
function keysFor(type, spin) {
  const id = `${type}:${spin || 'none'}`;
  if (!KEYS[id]) {
    const raw = type === 'serve' ? serveKeys() : type === 'back' ? backKeys(spin) : foreKeys(spin);
    // 왼손을 미리 좌표로 풀어 둡니다(보간이 매끄럽도록).
    KEYS[id] = raw.map((k) => ({ ...k, handL: leftHand(k) }));
  }
  return KEYS[id];
}

/** 타점에서 라켓 헤드 가운데(몸 좌표). type: 'fore'|'back'|'serve' */
export function contactOffset(type) {
  const k = keysFor(type, 'none').find((x) => x.t === 0);
  return headAt(k);
}
export const SERVE_TOSS_LEAD = 0.73; // 토스에서 타점까지(경기 초)

const VEC_KEYS = ['footL', 'footR', 'handR', 'handL', 'dir', 'face'];
function lerpKeys(keys, t) {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  let u = (t - a.t) / (b.t - a.t);
  u = smooth(clamp(u, 0, 1));
  const out = {};
  for (const k of Object.keys(a)) {
    if (k === 't') continue;
    const va = a[k];
    const vb = b[k];
    out[k] = Array.isArray(va) ? mixV(va, vb, u) : va + (vb - va) * u;
  }
  return out;
}

function readyPose(now, idle) {
  const k = { ...READY, handL: leftHand(READY) };
  // 제자리에서 가볍게 튀는 준비 동작
  const b = idle ? Math.sin(now * 7.5) * 0.018 : 0;
  k.hipY += b;
  k.handR = add(k.handR, [0, b * 0.6, 0]);
  k.handL = add(k.handL, [0, b * 0.6, 0]);
  return k;
}

/**
 * 한 선수의 지금 자세.
 * st: { stroke: { type, spin, tPrep, tFwd, tContact } | null, gt(경기 시각), now(실제 초),
 *       move: { lx, lz, speed, phase }(몸 좌표 이동), dy(타점 높이 보정 m), mirror: { dir, face } | null }
 */
export function athletePose(st) {
  let k;
  const s = st.stroke;
  if (s) {
    const keys = keysFor(s.type, s.spin);
    // 타점까지: 준비 → 백스윙(멈춤) → 앞스윙. 앞스윙 시작(tFwd)이 늦으면 백스윙에서 기다립니다.
    const backT = keys[1].t; // 백스윙 끝(키 시각)
    let kt;
    // tHold: 사람이 아직 안 휘둘렀으면 이 시각부터 백스윙 끝 자세로 기다립니다(tFwd = Infinity).
    const tHold = Math.min(s.tFwd, s.tHold ?? s.tFwd);
    if (st.gt < s.tFwd) {
      const prep = clamp((st.gt - s.tPrep) / Math.max(0.05, tHold - s.tPrep), 0, 1);
      // 서브는 토스부터 정해진 시간대로, 스트로크는 백스윙까지 가서 기다립니다.
      if (s.type === 'serve') kt = mix(keys[0].t, -0.12, prep);
      else kt = mix(keys[0].t, backT, smooth(prep));
    } else if (st.gt < s.tContact) {
      const fwdFrom = s.type === 'serve' ? -0.12 : backT;
      const u = clamp((st.gt - s.tFwd) / Math.max(0.03, s.tContact - s.tFwd), 0, 1);
      kt = mix(fwdFrom, 0, u * u);
    } else {
      kt = st.gt - s.tContact;
    }
    k = lerpKeys(keys, kt);
    // 타점 높이에 맞춰 손과 무릎을 조정합니다(백스윙~팔로우 구간에서 서서히).
    if (st.dy && s.type !== 'serve') {
      const w = clamp(1 - Math.abs(kt) / 0.45, 0, 1);
      const dy = clamp(st.dy, -0.45, 0.6) * w;
      k.handR = add(k.handR, [0, dy, 0]);
      k.handL = add(k.handL, [0, dy, 0]);
      k.hipY += Math.min(0, dy) * 0.55;
      k.lean += Math.min(0, dy) * -0.25;
    }
  } else {
    k = readyPose(st.now, !st.move || st.move.speed < 0.4);
    if (st.mirror) {
      // 폰 자세를 그대로 라켓에(손은 준비 위치)
      k.dir = st.mirror.dir;
      k.face = st.mirror.face;
      k.handL = st.mirror.dir[1] > 0.2 && st.mirror.dir[2] > 0.2 ? leftHand({ ...k, handL: 'throat' }) : [0.28, 1.0, 0.25];
    }
  }
  // 달리기: 다리만 번갈아 내딛고 몸을 이동 방향으로 기울입니다.
  const mv = st.move;
  if (mv && mv.speed > 0.25) {
    const w = clamp((mv.speed - 0.25) / 2.5, 0, 1) * (s && Math.abs(st.gt - s.tContact) < 0.18 ? 0.35 : 1);
    const ph = mv.phase;
    const dl = [mv.lx, 0, mv.lz];
    const stride = 0.36 * w;
    const lift = 0.16 * w;
    const fl = add(add(k.footL, sc(dl, stride * Math.cos(ph))), [0, lift * Math.max(0, Math.sin(ph)), 0]);
    const fr = add(add(k.footR, sc(dl, -stride * Math.cos(ph))), [0, lift * Math.max(0, -Math.sin(ph)), 0]);
    // 옆으로 달릴 때 두 발이 겹치지 않게 벌립니다.
    k.footL = [Math.max(fl[0], 0.1), fl[1], fl[2]];
    k.footR = [Math.min(fr[0], -0.1), fr[1], fr[2]];
    k.hipY -= 0.04 * w - 0.025 * w * Math.abs(Math.sin(ph));
    k.lean += 0.12 * w * mv.lz;
    k.bend = (k.bend || 0) + 0.1 * w * mv.lx;
    if (!s) {
      // 팔 흔들기
      k.handR = add(k.handR, [0, 0.05 * w * Math.sin(ph), 0.12 * w * Math.sin(ph)]);
    }
  }
  k.face = k.face || READY.face;
  return k;
}

/** 두 자세 사이를 섞습니다(u = 0 → a, 1 → b). */
export function blendPose(a, b, u) {
  const out = {};
  for (const k of Object.keys(b)) {
    const va = a[k];
    const vb = b[k];
    if (va == null) out[k] = vb;
    else if (Array.isArray(vb)) out[k] = mixV(va, vb, u);
    else if (typeof vb === 'number') out[k] = va + (vb - va) * u;
    else out[k] = vb;
  }
  return out;
}
