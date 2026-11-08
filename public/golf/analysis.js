// 스윙 분석(큰 화면·폰 공용). 폰이 보낸 swing_data 로 수치·구질·점수·코칭 팁을 내고, 3D 다시보기와 분석 패널을 그립니다.
// three.js 는 createReplay 안에서만 불러오므로, 이 파일은 폰 페이지나 노드 시험에서도 그대로 import 할 수 있습니다.
//
// 좌표: 몸 좌표 B(x = 목표, y = 위, z = 공 쪽. 공이 원점, 땅이 y = 0). swing-capture.js 와 같습니다.
// 폰 방향만으로는 손의 위치를 알 수 없어서, 머리 궤적은 "리드 어깨를 중심으로 팔과 클럽이 도는" 스윙 모델로 그립니다.
// 샤프트 방향은 폰에서 잰 그대로 쓰고, 팔·몸통은 스윙 진행 각도로 풉니다.
//
// 쓰는 법(큰 화면):
//   const a = analyzeSwing(swingData, { club: '7I', handedness: 'right', impact });
//     impact(선택): 폰 impact 이벤트 { speed(°/s), face, path } 나, 게임이 공을 날린 값 { headKmh, ballKmh, face, path }.
//     주면 패널 숫자가 실제로 날아간 공과 같아집니다. club 은 clubs.js 아이디('7I')도 예전 아이디('7i')도 됩니다.
//   history[slot].push(a);                                      // 사람별 기록(오래된 것부터)
//   const replay = createReplay(document.createElement('div')); // 한 번 만들어 계속 다시 씀(WebGL 문맥 하나)
//   const h = renderPanel(overlay, a, history[slot], { player: { name: '1P', color: '#ff5a5f' }, hint: '<kbd>Space</kbd>건너뛰기', replay });
//   h.dispose();                                                // 닫기(넘겨 준 replay 는 멈추기만 함)
//   d2c analysis { slot, summary: summarize(a), score: a.score, tips: a.tips }
// 쓰는 법(폰): renderSummary(el, summary, { onDetails }) 로 요약 카드. 자세히 보기는 폰에 남은 swing_data 로 다시 계산해서
//   renderPanel(el, analyzeSwing(packet, { club, impact: { headKmh, ballKmh, face, path } ← summary 값 }), [], { compact: true }) (2D 다시보기).

import { CLUBS } from './clubs.js';

const RD = Math.PI / 180;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const g01 = (x, a, b) => clamp(1 - (x - a) / (b - a), 0, 1); // a 이하 1, b 이상 0

// ---------- 클럽 ----------
// lengthM 클럽 길이, plane 어드레스 샤프트 기울기(땅에서, 도) = 기준 스윙 플레인, smash 정타 스매시,
// attack 좋은 스윙의 어택 앵글(공 위치 기준), ballFwd 몸 가운데에서 공까지(목표 쪽, m), typicalKmh 아마추어 평균 헤드 스피드.
export const CLUB_SPECS = {
  '1w': { id: '1w', short: '1W', name: '드라이버', kind: 'wood', lengthM: 1.15, plane: 47, smash: 1.46, attack: 2.0, ballFwd: 0.16, typicalKmh: 150 },
  '3w': { id: '3w', short: '3W', name: '3번 우드', kind: 'wood', lengthM: 1.09, plane: 50, smash: 1.44, attack: -2.0, ballFwd: 0.12, typicalKmh: 143 },
  '5w': { id: '5w', short: '5W', name: '5번 우드', kind: 'wood', lengthM: 1.07, plane: 52, smash: 1.42, attack: -2.5, ballFwd: 0.1, typicalKmh: 139 },
  '4h': { id: '4h', short: '4H', name: '유틸리티', kind: 'hybrid', lengthM: 1.01, plane: 55, smash: 1.4, attack: -3.0, ballFwd: 0.07, typicalKmh: 134 },
  '5i': { id: '5i', short: '5I', name: '5번 아이언', kind: 'iron', lengthM: 0.965, plane: 57, smash: 1.36, attack: -3.4, ballFwd: 0.05, typicalKmh: 130 },
  '6i': { id: '6i', short: '6I', name: '6번 아이언', kind: 'iron', lengthM: 0.953, plane: 58, smash: 1.35, attack: -3.7, ballFwd: 0.04, typicalKmh: 127 },
  '7i': { id: '7i', short: '7I', name: '7번 아이언', kind: 'iron', lengthM: 0.94, plane: 59.5, smash: 1.33, attack: -4.0, ballFwd: 0.03, typicalKmh: 124 },
  '8i': { id: '8i', short: '8I', name: '8번 아이언', kind: 'iron', lengthM: 0.927, plane: 61, smash: 1.31, attack: -4.3, ballFwd: 0.02, typicalKmh: 120 },
  '9i': { id: '9i', short: '9I', name: '9번 아이언', kind: 'iron', lengthM: 0.915, plane: 62, smash: 1.28, attack: -4.6, ballFwd: 0.01, typicalKmh: 117 },
  pw: { id: 'pw', short: 'PW', name: '피칭 웨지', kind: 'wedge', lengthM: 0.905, plane: 63, smash: 1.24, attack: -5.0, ballFwd: 0, typicalKmh: 113 },
  sw: { id: 'sw', short: 'SW', name: '샌드 웨지', kind: 'wedge', lengthM: 0.89, plane: 64, smash: 1.18, attack: -5.5, ballFwd: 0, typicalKmh: 105 },
  pt: { id: 'pt', short: 'PT', name: '퍼터', kind: 'putter', lengthM: 0.86, plane: 72, smash: 1.0, attack: 1.0, ballFwd: 0.04, typicalKmh: 12 }
};
// 이름·길이·스매시·평균 헤드 스피드는 게임의 클럽 표(clubs.js)를 따라 공 날아가는 값과 맞춥니다.
for (const c of Array.isArray(CLUBS) ? CLUBS : []) {
  const k = String(c && c.id || '').toLowerCase();
  const s = CLUB_SPECS[k];
  if (!s) continue;
  if (c.name) s.name = c.name;
  if (c.short) s.short = c.short;
  if (c.lengthM > 0.5) s.lengthM = c.lengthM;
  if (c.smash >= 1) s.smash = c.smash;
  if (c.headKmh > 0) s.typicalKmh = c.headKmh;
}
const CLUB_ALIAS = { dr: '1w', driver: '1w', d: '1w', '1': '1w', ut: '4h', '4u': '4h', h: '4h', hy: '4h', hybrid: '4h', p: 'pw', s: 'sw', putter: 'pt', pu: 'pt' };
export function clubKey(id) {
  const k = String(id == null ? '' : id).trim().toLowerCase();
  if (CLUB_SPECS[k]) return k;
  if (CLUB_ALIAS[k]) return CLUB_ALIAS[k];
  return '7i';
}

// 폰 회전 속도(도/초) → 헤드 스피드(m/s). 지금 게임(game.js)의 7번 기준 1.55m 반지름을 클럽 길이에 맞춰 늘립니다.
export function headSpeedMs(dps, club) {
  const s = CLUB_SPECS[clubKey(club)];
  return clamp((Math.max(0, dps) * RD * 1.55 * s.lengthM) / 0.94, 0, 75);
}

// 테이크어웨이 = 어드레스에서 TAKE_DEG 넘게 움직인 순간, 톱 = 가장 높은 곳에서 TOP_BAND_DEG 안쪽에 머문 구간.
// 템포는 백스윙(테이크어웨이 → 톱) : 다운스윙(톱 → 임팩트)이고, 톱에서 TURN_SEC 보다 오래 멈춘 시간은 어느 쪽에도 넣지 않습니다.
export const TAKE_DEG = 1.5;
export const TOP_BAND_DEG = 1;
// 템포(백스윙 시간 : 다운스윙 시간)는 풀스윙에서 3 : 1 이 좋고, 이 범위를 벗어나면 빠름/느림입니다.
// 하프 스윙(어프로치)은 2 : 1 에 가까울수록 좋아서, 기준(2.5 : 1)과 빠름 경계를 백스윙 크기에 맞춰 줄입니다.
export const TEMPO_FAST = 2.3;
export const TEMPO_SLOW = 3.8;
export function idealTempo(backswingDeg) {
  return 2.5 + 0.5 * clamp((backswingDeg - 180) / 65, 0, 1);
}
// 톱에서 이보다 오래(초) 머물면 리듬이 끊긴 것으로 봅니다.
export const PAUSE_SEC = 0.25;
export const TURN_SEC = 0.1;

export const SHAPES = { straight: '스트레이트', draw: '드로우', fade: '페이드', hook: '훅', slice: '슬라이스', pull: '풀', push: '푸시' };

// ---------- 작은 벡터·사원수 ----------
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const lerp3 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
const angle = (a, b) => Math.acos(clamp(dot(norm(a), norm(b)), -1, 1));
function qRot(q, v) {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
function qAxis(axis, ang) {
  const n = norm(axis);
  const s = Math.sin(ang / 2);
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(ang / 2)];
}
function qBetween(a, b) {
  a = norm(a);
  b = norm(b);
  const d = dot(a, b);
  if (d < -0.999999) {
    let ax = cross([1, 0, 0], a);
    if (vlen(ax) < 1e-6) ax = cross([0, 1, 0], a);
    return qAxis(ax, Math.PI);
  }
  const c = cross(a, b);
  const q = [c[0], c[1], c[2], 1 + d];
  const l = Math.hypot(...q);
  return q.map((x) => x / l);
}
const rotAxis = (v, axis, ang) => qRot(qAxis(axis, ang), v);
const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

// 3x3 대칭 행렬의 가장 작은 고유벡터(야코비) — 방향들이 이루는 평면의 법선
function smallestEigenvector(M) {
  const a = M.map((r) => r.slice());
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
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let m = 0;
  for (let i = 1; i < 3; i++) if (a[i][i] < a[m][m]) m = i;
  return norm([v[0][m], v[1][m], v[2][m]]);
}
function fitPlane(dirs) {
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const d of dirs) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += d[i] * d[j];
  return smallestEigenvector(M);
}
const inclination = (n) => Math.acos(clamp(Math.abs(n[1]), 0, 1)) / RD;

// 임팩트 앞뒤 세 표본의 원에서 어드레스 방향에 가장 가까운 점(몸 좌표 B: r = z, f = x)
//   more: 앞뒤로 더 있는 표본들. 다섯 개 이상이면 원(평면)을 최소제곱으로 맞춰 센서 잡음에 덜 흔들립니다.
function impactB(p0, p1, p2, s0, yaw0, more = []) {
  const a = p0.top, b = p1.top, c = p2.top;
  let nn = cross(sub(b, a), sub(c, b));
  let h0 = null;
  if (more.length >= 2 && vlen(nn) > 1e-7) {
    const pts = [a, b, c, ...more.map((p) => p.top)];
    const ctr = scale(pts.reduce((acc, v) => add(acc, v), [0, 0, 0]), 1 / pts.length);
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const v of pts) { const d = sub(v, ctr); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += d[i] * d[j]; }
    const nf = smallestEigenvector(M);
    nn = dot(nf, nn) < 0 ? scale(nf, -1) : nf;
    h0 = dot(nn, ctr);
  }
  let u = 0, path, miss;
  if (vlen(nn) > 1e-7) {
    nn = norm(nn);
    const h = h0 != null ? h0 : dot(nn, a);
    const rho = Math.sqrt(Math.max(1e-9, 1 - h * h));
    const ctr = scale(nn, h);
    const e = (v) => norm(sub(sub(v, scale(nn, dot(nn, v) - h)), ctr));
    const cpt = add(ctr, scale(e(s0), rho));
    let tg = norm(cross(nn, e(s0)));
    if (dot(tg, sub(c, a)) < 0) tg = scale(tg, -1);
    path = Math.atan2(tg[2], Math.abs(tg[0]) + 1e-9) / RD;
    miss = angle(cpt, s0) / RD;
    const e1 = e(b);
    const pos = (v) => { const ev = e(v); return Math.atan2(dot(cross(e1, ev), nn), dot(e1, ev)); };
    const sa = pos(a), sc = pos(c), sx = pos(s0);
    u = sx >= 0 ? (sc > 1e-9 ? Math.min(1, sx / sc) : 0) : (sa < -1e-9 ? -Math.min(1, sx / sa) : 0);
  } else {
    const v = sub(c, a);
    path = Math.atan2(v[2], Math.abs(v[0]) + 1e-9) / RD;
    miss = angle(b, s0) / RD;
  }
  const f = u >= 0 ? lerp3(p1.face, p2.face, u) : lerp3(p0.face, p1.face, 1 + u);
  const face = wrap180((Math.atan2(f[2], f[0]) - yaw0) / RD);
  const t = u >= 0 ? p1.t + u * (p2.t - p1.t) : p1.t + u * (p1.t - p0.t);
  return { t, face, path, miss, u };
}

// ---------- 스윙 모델(머리 궤적) ----------
// 리드 어깨에서 팔이, 손에서 클럽이 나옵니다. 몸통은 척추 둘레로 돌고 팔은 손목 코킹만큼 클럽보다 덜 돕니다.
function bodyFor(spec) {
  const th = spec.plane * RD;
  const La = 0.62;
  const Lh = spec.lengthM - 0.09;
  const d0 = [0, -Math.sin(th), Math.cos(th)];
  const head0 = [0, 0.03, 0];
  const H0 = sub(head0, scale(d0, Lh));
  const xc = -spec.ballFwd;
  const a0 = norm(sub(H0, [xc + 0.18, H0[1] + 0.57, H0[2] - 0.19]));
  const S0 = sub(H0, scale(a0, La));
  const tilt = (spec.kind === 'wood' ? 7 : spec.kind === 'hybrid' ? 5 : 3) * RD;
  const sp = norm([-Math.sin(tilt), Math.cos(38 * RD), Math.sin(38 * RD)]);
  const sx = norm(sub([1, 0, 0], scale(sp, sp[0])));
  const C0 = sub(S0, scale(sx, 0.185));
  const T0 = sub(C0, scale(sx, 0.185));
  const P0 = sub(C0, scale(sp, 0.5));
  const nArm = norm(cross(a0, [1, 0, 0]));
  // 피니시 척추: 거의 서고, 목표 반대쪽으로 살짝 기댐
  const spFin = norm([-0.14, 1, 0.1]);
  const stance = spec.kind === 'wood' ? 0.25 : spec.kind === 'hybrid' ? 0.23 : spec.kind === 'iron' ? 0.21 : 0.17;
  const footZ = S0[2] + 0.02;
  return { th, La, Lh, d0, head0, H0, xc, a0, S0, sp, sx, C0, T0, P0, nArm, stance, footZ, spFin };
}

function poseAt(B, phi, d, phase, phiTop, phiFin) {
  let tau, alpha, pel;
  const top = Math.min(-30, phiTop);
  if (phase === 'back') {
    tau = Math.max(-105, 0.33 * phi);
    alpha = 0.58 * phi;
    pel = 0.5 * tau;
  } else if (phase === 'down') {
    const k = clamp(phi / top, 0, 1);
    tau = Math.max(-105, 0.33 * top) * Math.pow(k, 1.5);
    // 손목 코킹을 유지하다가(래그) 클럽이 70% 내려온 뒤부터 부드럽게 풉니다.
    const hTop = 0.42 * top;
    const phiR = 0.7 * top;
    const r = clamp((phi - phiR) / -phiR, 0, 1);
    const h = hTop * (1 - r * r * (3 - 2 * r));
    alpha = phi - h;
    const u = clamp((phi - top) / -top, 0, 1);
    pel = 0.5 * Math.max(-105, 0.33 * top) * (1 - u) + 38 * u * u;
  } else {
    tau = Math.min(108, 0.42 * phi);
    alpha = Math.min(205, 0.62 * phi);
    pel = Math.min(92, 38 + 0.3 * phi);
  }
  // 팔로스루에서 피니시로 가며 허리를 펴고(척추가 거의 서고) 골반이 목표 쪽으로 옮겨 갑니다.
  const fin = phase === 'follow' ? clamp(phi / Math.max(90, phiFin * 0.85), 0, 1) : 0;
  const up = 0.9 * fin * fin * (3 - 2 * fin);
  const sp = up > 0 ? norm(lerp3(B.sp, B.spFin, up)) : B.sp;
  const P = add(B.P0, [0.08 * up, 0.03 * up, -0.03 * up]);
  const C = up > 0 ? add(P, scale(sp, 0.5)) : B.C0;
  const sx = up > 0 ? norm(sub([1, 0, 0], scale(sp, sp[0]))) : B.sx;
  const S = add(C, rotAxis(scale(sx, 0.185), sp, tau * RD));
  const T = add(C, rotAxis(scale(sx, -0.185), sp, tau * RD));
  const a = rotAxis(B.a0, B.nArm, alpha * RD);
  const H = add(S, scale(a, B.La));
  const head = add(H, scale(d, B.Lh));
  return { S, T, H, head, tau, alpha, pel, fin, sp, P, C };
}

// ---------- 분석 ----------
// data: swing_data { id, rate, samples: [[t, qx, qy, qz, qw, rx, ry, rz, ax, ay, az]], marks, peak?, shaft0? }
// opts: { club, handedness: 'right'|'left', impact?: { speed, face, path } }
//   impact 를 주면 실제로 공을 날린 값(폰의 impact 이벤트)과 패널 숫자가 같아지도록 스피드·페이스·궤도에 그 값을 씁니다.
export function analyzeSwing(data, opts = {}) {
  const club = clubKey(opts.club || (data && data.club) || '7i');
  const spec = CLUB_SPECS[club];
  const lefty = (opts.handedness || (data && data.hand)) === 'left';
  const out = { ok: false, id: data && data.id != null ? data.id : null, club, clubName: spec.name, clubShort: spec.short, kind: spec.kind, handedness: lefty ? 'left' : 'right' };
  const rows = data && Array.isArray(data.samples) ? data.samples : [];
  const R = [];
  rows.forEach((r, k) => {
    if (!Array.isArray(r) || r.length < 5 || !r.slice(0, 5).every(Number.isFinite)) return;
    const ql = Math.hypot(r[1], r[2], r[3], r[4]);
    if (ql < 0.5) return;
    const t = r[0] / 1000;
    if (R.length && t < R[R.length - 1].t) return;
    R.push({ k, t, q: [r[1] / ql, r[2] / ql, r[3] / ql, r[4] / ql], gy: r.length >= 8 ? Math.hypot(r[5] || 0, r[6] || 0, r[7] || 0) : 0 });
  });
  if (R.length < 10) return Object.assign(out, { reason: 'too_short' });
  // 시각 고르기: 센서는 일정한 간격으로 재는데 이벤트가 몇 ms 씩 흔들려 도착합니다.
  // 간격이 고른 구간에서만 앞뒤 두 표본과 평균을 내서 흔들림을 줄입니다(솎아 낸 구간은 그대로).
  const tS = R.map((r) => r.t);
  for (let i = 2; i < R.length - 2; i++) {
    let lo = Infinity, hi = 0;
    for (let k = i - 2; k < i + 2; k++) { const dt = R[k + 1].t - R[k].t; lo = Math.min(lo, dt); hi = Math.max(hi, dt); }
    if (lo > 0 && hi < 2 * lo) tS[i] = (R[i - 2].t + R[i - 1].t + R[i].t + R[i + 1].t + R[i + 2].t) / 5;
  }
  // 움직이는 중에 같은 값이 겹쳐 온 표본(아이폰)은 뺍니다. 그 자리는 앞뒤 표본 사이를 이어서 채웁니다.
  // 정말로 멈춰 있는 동안(톱에서 멈춤 등)의 같은 값은 시간 재기에 필요하므로 남깁니다.
  const sameQ = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
  const qAng = (a, b) => 2 * Math.acos(clamp(Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]), 0, 1)) / RD;
  const S = [];
  const rowToS = new Map();
  R.forEach((r, i) => {
    const p = S.length ? S[S.length - 1] : null;
    let stale = false;
    if (p && sameQ(p.q, r.q)) {
      let k = i + 1;
      while (k < R.length && sameQ(R[k].q, r.q)) k += 1;
      // 들어올 때와 나갈 때 모두 움직이고 있었으면 멈춘 게 아니라 값이 늦게 온 것입니다.
      const pp = S.length > 1 ? S[S.length - 2] : null;
      stale = k < R.length && pp != null && qAng(R[k].q, r.q) > 1 && qAng(pp.q, p.q) > 1;
    }
    if (stale) {
      p.gy = Math.max(p.gy, r.gy);
      rowToS.set(r.k, S.length - 1);
      return;
    }
    const top = qRot(r.q, [0, 1, 0]);
    const face = qRot(r.q, [0, 0, 1]);
    // 왼손잡이는 목표 방향(x)을 뒤집어 오른손잡이 스윙으로 바꿔 계산합니다.
    if (lefty) {
      top[0] = -top[0];
      face[0] = -face[0];
    }
    rowToS.set(r.k, S.length);
    S.push({ t: tS[i], q: r.q, top, face, gy: r.gy });
  });
  const n = S.length;
  if (n < 10) return Object.assign(out, { reason: 'too_short' });

  // 어드레스 기준 방향
  const mk0 = (data && data.marks) || {};
  const mk = {};
  for (const key of ['address', 'takeaway', 'top', 'impact', 'finish']) if (rowToS.has(mk0[key])) mk[key] = rowToS.get(mk0[key]);
  const okIdx = (i) => Number.isInteger(i) && i >= 0 && i < n;
  let take0 = okIdx(mk.takeaway) ? mk.takeaway : -1;
  // 기준은 백스윙 직전에 멈춰 있던 표본들의 평균입니다. 그런 표본이 모자라면 폰이 어드레스 때 잰 shaft0 를 씁니다.
  let d0u = null;
  const addrEnd = take0 > 0 ? take0 : okIdx(mk.address) ? mk.address + 1 : 4;
  const addrIdx = [];
  for (let i = Math.max(0, addrEnd - 8); i < Math.max(1, addrEnd); i++) addrIdx.push(i);
  if (addrIdx.length < 3 && Array.isArray(data.shaft0) && data.shaft0.length === 3 && data.shaft0.every(Number.isFinite)) {
    d0u = norm([data.shaft0[2], data.shaft0[1], data.shaft0[0]]);
    if (lefty) d0u[0] = -d0u[0];
  }
  if (!d0u) d0u = norm(addrIdx.reduce((acc, i) => add(acc, S[i].top), [0, 0, 0]));
  let cy = 0, cx = 0;
  for (const i of addrIdx) {
    cx += S[i].face[0];
    cy += S[i].face[2];
  }
  const yaw0 = Math.atan2(cy, cx) / RD;

  // 스윙 진행 각도(들어 올리면 음수): 어드레스 샤프트와 목표선이 이루는 면에 샤프트를 비춰 잰 각을 이어 붙입니다.
  // 한 표본씩 3D 각을 더하면 멈춰 있을 때 센서 잡음이 계속 쌓이지만, 이 방식은 잡음이 쌓이지 않습니다.
  const back = norm(cross(d0u, [-1, 0, 0]));
  const side = cross(back, d0u);
  const absPhi = (s) => -Math.atan2(dot(s, side), dot(s, d0u)) / RD;
  for (let i = 0; i < n; i++) S[i].d = angle(S[i].top, d0u) / RD;
  let phi = absPhi(S[0].top);
  S[0].phi = phi;
  for (let i = 1; i < n; i++) {
    phi += wrap180(absPhi(S[i].top) - absPhi(S[i - 1].top));
    S[i].phi = phi;
  }
  // 톱을 찾을 때 쓰는 살짝 고른 각도
  for (let i = 0; i < n; i++) S[i].ps = (S[Math.max(0, i - 1)].phi + S[i].phi + S[Math.min(n - 1, i + 1)].phi) / 3;

  // 표시점: 받은 값을 출발점으로 다시 찾습니다.
  let take = -1;
  for (let i = Math.max(0, take0 - 10); i < n; i++) if (S[i].phi < -8) { take = i; break; }
  if (take < 0) return Object.assign(out, { reason: 'no_backswing' });
  while (take > 0 && Math.abs(S[take - 1].phi) > TAKE_DEG) take -= 1;
  let impGuess = okIdx(mk.impact) && mk.impact > take ? mk.impact : -1;
  let top = take;
  const topEnd = impGuess > 0 ? impGuess : n - 1;
  for (let i = take; i <= topEnd; i++) {
    if (S[i].ps < S[top].ps) top = i;
    if (impGuess < 0 && S[i].phi > S[top].phi + 120) break;
  }
  const phiTop = Math.min(S[top].phi, S[top].ps);
  if (phiTop > -30) return Object.assign(out, { reason: 'no_backswing' });
  // 임팩트 = 톱 뒤에 어드레스 방향에 가장 가까웠던 표본(controller.js 와 같은 기준)
  let imp = -1;
  const impEnd = impGuess > 0 ? Math.min(n - 1, impGuess + 3) : n - 1;
  for (let i = top + 1; i <= impEnd; i++) {
    if (imp < 0 || S[i].d < S[imp].d) imp = i;
    if (impGuess < 0 && S[i].phi > 80) break;
  }
  if (imp < 0 || imp >= n - 1 || imp <= top) return Object.assign(out, { reason: 'no_impact' });
  let fin = okIdx(mk.finish) && mk.finish > imp ? mk.finish : -1;
  {
    let best = imp;
    for (let i = imp; i < n; i++) if (S[i].phi > S[best].phi) best = i;
    if (fin < 0 || S[best].phi > S[fin].phi + 5) fin = best;
  }
  const addr = okIdx(mk.address) && mk.address <= take ? mk.address : Math.max(0, take - 3);

  // 톱 시각: 가장 높이 올라간 곳에서 TOP_BAND_DEG 안쪽에 머문 구간(톱에서 멈춘 시간)의 가운데
  let tA = top, tB = top;
  const band = S[top].ps + TOP_BAND_DEG;
  while (tA > take && S[tA - 1].ps <= band && S[top].t - S[tA - 1].t < 0.8) tA -= 1;
  while (tB < imp - 1 && S[tB + 1].ps <= band && S[tB + 1].t - S[top].t < 0.8) tB += 1;
  // 머문 구간의 양 끝은 띠를 넘는 순간을 표본 사이에서 이어서 찾습니다(60Hz 계단 없이).
  const cut = (i, o) => {
    const a = S[i], b = S[o];
    if (!b || b.ps <= a.ps) return a.t;
    return a.t + clamp((band - a.ps) / (b.ps - a.ps), 0, 1) * (b.t - a.t);
  };
  const tA0 = tA > 0 ? cut(tA, tA - 1) : S[tA].t;
  const tB0 = cut(tB, tB + 1);
  const tTop = (tA0 + tB0) / 2;
  const pauseSec = Math.max(0, tB0 - tA0);
  // 방향을 바꾸는 0.1초까지는 백스윙과 다운스윙에 반씩 나누고, 그보다 오래 멈춘 시간은 템포에서 뺍니다.
  const turn = Math.min(pauseSec, TURN_SEC) / 2;
  const tTopEnd = tA0 + turn;
  const tDownStart = tB0 - turn;

  // 임팩트: 앞뒤 표본으로 원을 맞춰 표본 사이의 정확한 순간을 찾습니다(swing-capture.js 의 impactEstimate 와 같은 계산).
  // 아이폰처럼 같은 값이 겹쳐 오면 겹친 표본은 건너뜁니다.
  let i0 = imp - 1, i2 = imp + 1;
  while (i0 > top && angle(S[i0].top, S[imp].top) < 0.3 * RD) i0 -= 1;
  while (i2 < n - 1 && angle(S[i2].top, S[imp].top) < 0.3 * RD) i2 += 1;
  const more = [];
  if (i0 - 1 > top) more.push(S[i0 - 1]);
  if (i2 + 1 < n) more.push(S[i2 + 1]);
  const est = impactB(S[i0], S[imp], S[i2], d0u, yaw0 * RD, more);
  const tImp = est.t;
  const missDeg = est.miss;
  let faceDeg = est.face;
  let pathDeg = est.path;
  const imp0 = opts.impact || null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (imp0 && num(imp0.face) != null) faceDeg = imp0.face;
  if (imp0 && num(imp0.path) != null) pathDeg = imp0.path;

  // 템포
  // 테이크어웨이: 1.5도를 넘어선 순간(앞 표본과 사이를 이어서)
  let tTake = S[take].t;
  if (take > 0) {
    const p0 = Math.abs(S[take - 1].phi), p1 = Math.abs(S[take].phi);
    if (p1 > p0) tTake = S[take - 1].t + clamp((TAKE_DEG - p0) / (p1 - p0), 0, 1) * (S[take].t - S[take - 1].t);
  }
  const backswingSec = Math.max(0.01, tTopEnd - tTake);
  const downswingSec = Math.max(0.01, tImp - tDownStart);
  const tempoRatio = backswingSec / downswingSec;

  // 백스윙 크기
  const backswingDeg = -phiTop;
  const backswingKey = backswingDeg < 200 ? 'half' : backswingDeg < 245 ? 'three' : backswingDeg <= 300 ? 'full' : 'over';
  const backswingLabel = { half: '하프', three: '3/4', full: '풀', over: '오버' }[backswingKey];

  // 기준 클럽 자세로 맞춘 샤프트 방향
  const B = bodyFor(spec);
  const qa = qBetween(d0u, B.d0);
  for (const s of S) {
    s.da = qRot(qa, s.top);
    s.fa = qRot(qa, s.face);
  }
  // 스윙 플레인: 다운스윙 아래쪽(톱 직후 전환 구간은 빼고) 샤프트 방향들이 이루는 평면
  const loP = Math.max(phiTop * 0.65, -200);
  const downDirs = [];
  for (let i = top; i <= Math.min(n - 1, imp + 6); i++) if (S[i].phi >= loP && S[i].phi <= 30) downDirs.push(S[i].da);
  if (downDirs.length < 4) for (let i = top; i <= imp + 1; i++) downDirs.push(S[i].da);
  let nDown = fitPlane(downDirs);
  if (dot(cross(nDown, B.d0), [1, 0, 0]) < 0) nDown = scale(nDown, -1);
  const planeDeg = inclination(nDown);
  const backDirs = [];
  for (let i = take; i <= top; i++) if (S[i].phi <= -25 && S[i].phi >= phiTop * 0.9) backDirs.push(S[i].da);
  const backPlaneDeg = backDirs.length >= 4 ? inclination(fitPlane(backDirs)) : null;
  const idealPlaneDeg = spec.plane;
  const planeDevDeg = planeDeg - idealPlaneDeg;
  const planeKey = planeDevDeg > 4 ? 'upright' : planeDevDeg < -4 ? 'flat' : 'on';
  const planeLabel = { upright: '업라이트', flat: '플랫', on: '온 플레인' }[planeKey];

  // 어택 앵글: 폰 방향만으로는 손 높이를 알 수 없어 추정합니다.
  // 클럽마다 좋은 스윙의 값(공 위치)에서, 다운스윙이 가파를수록 더 내려 치고 누울수록 쓸어 친다고 봅니다.
  const attackDeg = clamp(spec.attack - 0.35 * planeDevDeg, spec.attack - 6, spec.attack + 6);
  const attackKey = attackDeg <= -1.5 ? 'down' : attackDeg >= 1.5 ? 'up' : 'level';
  const attackLabel = { down: '다운블로', up: '어퍼블로', level: '레벨' }[attackKey];

  // 스피드: 자이로 최댓값(도/초), 없으면 방향 변화로 잰 값
  let gyroPeak = 0;
  for (let i = top; i <= Math.min(n - 1, imp + 2); i++) gyroPeak = Math.max(gyroPeak, S[i].gy);
  if (data.peak && Number.isFinite(data.peak.gyro)) gyroPeak = Math.max(gyroPeak, data.peak.gyro);
  let oriRate = 0;
  for (let i = Math.max(1, imp - 2); i <= Math.min(n - 2, imp + 2); i++) {
    const dt = S[i + 1].t - S[i - 1].t;
    if (dt > 0.004) oriRate = Math.max(oriRate, (S[i + 1].phi - S[i - 1].phi) / dt);
  }
  // 오래된 브라우저는 rotationRate 를 라디안/초로 줍니다.
  if (gyroPeak > 0 && oriRate > 200 && gyroPeak < oriRate / 15) gyroPeak /= RD;
  let dps = gyroPeak > 30 ? gyroPeak : oriRate;
  let speedSource = imp0 && typeof imp0.speed === 'number' && imp0.speed > 0 ? 'impact' : gyroPeak > 30 ? 'gyro' : 'orientation';
  if (speedSource === 'impact') dps = Number(imp0.speed);
  const headMs = headSpeedMs(dps, club);
  const strike = clamp(1 - Math.max(0, missDeg - 8) / 40, 0.55, 1);
  let smash = spec.smash * (0.85 + 0.15 * strike);
  let headSpeedKmh = headMs * 3.6;
  let ballSpeedKmh = headSpeedKmh * smash;
  // 게임이 공을 날릴 때 쓴 헤드·볼 스피드(km/h)를 주면 패널 숫자를 그 값에 맞춥니다.
  if (imp0 && num(imp0.headKmh) > 0) {
    headSpeedKmh = imp0.headKmh;
    ballSpeedKmh = num(imp0.ballKmh) > 0 ? imp0.ballKmh : headSpeedKmh * smash;
    smash = ballSpeedKmh / headSpeedKmh;
    speedSource = 'game';
  }

  // 구질
  const faceToPathDeg = faceDeg - pathDeg;
  const wFace = spec.kind === 'wood' ? 0.85 : 0.75;
  const startDeg = wFace * faceDeg + (1 - wFace) * pathDeg;
  const sh = classify(faceToPathDeg, startDeg);
  const pathKey = pathDeg > 2 ? 'in-out' : pathDeg < -2 ? 'out-in' : 'square';
  const faceKey = faceDeg > 1.5 ? 'open' : faceDeg < -1.5 ? 'closed' : 'square';

  // 머리 궤적(촘촘하게)
  const tStart = Math.max(S[0].t, S[addr].t - 0.05);
  const tEnd = Math.min(S[n - 1].t, S[fin].t + 0.12);
  const phiFin = S[fin].phi;
  const phaseAt = (t) => (t <= tTop ? 'back' : t <= tImp ? 'down' : 'follow');
  const FS = 1 / 240;
  const tr = { t: [], head: [], hands: [], lead: [], trail: [], tau: [], pel: [], fin: [], phi: [], speed: [], shaft: [], face: [], spine: [], pelvis: [], chest: [] };
  // 표본 사이는 캣멀-롬 곡선으로 이어서(60Hz 꺾임 없이) 240Hz 로 촘촘하게 만듭니다.
  const crv = (p0, p1, p2, p3, w) => {
    const w2 = w * w, w3 = w2 * w;
    return [0, 1, 2].map((c) => 0.5 * (2 * p1[c] + (p2[c] - p0[c]) * w + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * w2 + (3 * p1[c] - p0[c] - 3 * p2[c] + p3[c]) * w3));
  };
  const crs = (p0, p1, p2, p3, w) => crv([p0, 0, 0], [p1, 0, 0], [p2, 0, 0], [p3, 0, 0], w)[0];
  let j = 0;
  for (let t = tStart; t <= tEnd + 1e-9; t += FS) {
    while (j < n - 2 && S[j + 1].t < t) j += 1;
    const a = S[Math.max(0, j - 1)], b = S[j], c = S[j + 1], e = S[Math.min(n - 1, j + 2)];
    const w = c.t > b.t ? clamp((t - b.t) / (c.t - b.t), 0, 1) : 0;
    const d = norm(crv(a.da, b.da, c.da, e.da, w));
    const ph = crs(a.phi, b.phi, c.phi, e.phi, w);
    const ps = poseAt(B, ph, d, phaseAt(t), phiTop, phiFin);
    tr.t.push(t - tStart);
    tr.head.push(ps.head);
    tr.hands.push(ps.H);
    tr.lead.push(ps.S);
    tr.trail.push(ps.T);
    tr.tau.push(ps.tau);
    tr.pel.push(ps.pel);
    tr.fin.push(ps.fin);
    tr.spine.push(ps.sp);
    tr.pelvis.push(ps.P);
    tr.chest.push(ps.C);
    tr.phi.push(ph);
    tr.shaft.push(d);
    tr.face.push(norm(crv(a.fa, b.fa, c.fa, e.fa, w)));
  }
  const m = tr.t.length;
  // 머리 속도: ±12ms 차분 → 가우스(σ 12ms)로 두 번 고르기. 맨 빠른 곳(톱~임팩트)을 잰 헤드 스피드에 맞춥니다.
  let raw = new Array(m).fill(0);
  for (let i = 0; i < m; i++) {
    const a = Math.max(0, i - 3), b = Math.min(m - 1, i + 3);
    const dt = tr.t[b] - tr.t[a];
    raw[i] = dt > 0 ? (vlen(sub(tr.head[b], tr.head[a])) / dt) * 3.6 : 0;
  }
  const G = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6].map((x) => [x, Math.exp(-(x * x) / 18)]);
  for (let pass = 0; pass < 2; pass++) {
    raw = raw.map((_, i) => {
      let sw = 0, sv = 0;
      for (const [o, wgt] of G) { const k = i + o; if (k >= 0 && k < m) { sw += wgt; sv += raw[k] * wgt; } }
      return sv / sw;
    });
  }
  let rawPeak = 1;
  for (let i = 0; i < m; i++) if (tr.t[i] + tStart >= tTop && tr.t[i] + tStart <= tImp + 0.03) rawPeak = Math.max(rawPeak, raw[i]);
  const k = clamp(headSpeedKmh / rawPeak, 0.25, 4);
  tr.speed = raw.map((v) => Math.round(v * k * 10) / 10);
  tr.speedMax = r1(headSpeedKmh);
  const atT = (tt) => clamp(Math.round((tt - tStart) / FS), 0, m - 1);
  const keyAt = (name, tt, si) => {
    const i = atT(tt);
    return { name, t: tr.t[i], i, head: tr.head[i], hands: tr.hands[i], lead: tr.lead[i], trail: tr.trail[i], shaft: tr.shaft[i], face: S[si].fa };
  };
  const keyframes = {
    address: keyAt('address', S[addr].t, addr),
    top: keyAt('top', tTop, top),
    impact: keyAt('impact', tImp, imp),
    finish: keyAt('finish', S[fin].t, fin)
  };
  const trail = {
    dt: FS, ...tr, keyframes,
    body: { C0: B.C0, P0: B.P0, sp: B.sp, sx: B.sx, S0: B.S0, T0: B.T0, H0: B.H0, xc: B.xc, stance: B.stance, footZ: B.footZ, Lh: B.Lh, La: B.La },
    idealPlane: { normal: norm(cross(B.d0, [1, 0, 0])), point: B.head0, deg: idealPlaneDeg, shaft: B.d0 },
    downPlane: { normal: nDown, point: B.head0, deg: planeDeg },
    ball: [0, 0.0214, 0],
    times: { address: S[addr].t - tStart, takeaway: tTake - tStart, top: tTop - tStart, impact: tImp - tStart, finish: S[fin].t - tStart, end: tEnd - tStart }
  };

  Object.assign(out, {
    ok: true,
    headSpeedKmh: r1(headSpeedKmh), ballSpeedKmh: r1(ballSpeedKmh), smash: r2(smash), strike: r2(strike), missDeg: r1(missDeg), speedSource, rotDps: Math.round(dps),
    tempoRatio: r2(tempoRatio), backswingSec: r2(backswingSec), downswingSec: r2(downswingSec), pauseSec: r2(pauseSec),
    idealTempo: r1(idealTempo(backswingDeg)),
    tempoKey: tempoRatio < (TEMPO_FAST * idealTempo(backswingDeg)) / 3 ? 'fast' : tempoRatio > TEMPO_SLOW ? 'slow' : 'good',
    backswingDeg: Math.round(backswingDeg), backswingKey, backswingLabel,
    planeDeg: r1(planeDeg), idealPlaneDeg, planeDevDeg: r1(planeDevDeg), backPlaneDeg: backPlaneDeg == null ? null : r1(backPlaneDeg), planeKey, planeLabel,
    pathDeg: r1(pathDeg), pathKey, faceDeg: r1(faceDeg), faceKey, faceToPathDeg: r1(faceToPathDeg), startDeg: r1(startDeg),
    shape: SHAPES[sh.key], shapeKey: sh.key, shapeDetail: sh.detail,
    attackDeg: r1(attackDeg), attackKey, attackLabel,
    marks: { address: addr, takeaway: take, top, impact: imp, finish: fin },
    times: { takeaway: r4(tTake), top: r4(tTop), impact: r4(tImp), finish: r4(S[fin].t) },
    trail
  });
  const sc = scoreSwing(out, spec);
  out.score = sc.score;
  out.grade = sc.grade;
  out.parts = sc.parts;
  out.tips = sc.tips;
  return out;
}
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;

function classify(ftp, start) {
  let key;
  if (ftp <= -6) key = 'hook';
  else if (ftp >= 6) key = 'slice';
  else if (ftp <= -2) key = 'draw';
  else if (ftp >= 2) key = 'fade';
  else if (start >= 3) key = 'push';
  else if (start <= -3) key = 'pull';
  else key = 'straight';
  let detail = SHAPES[key];
  if (key === 'hook' || key === 'slice' || key === 'draw' || key === 'fade') {
    if (start >= 3) detail = `푸시 ${detail}`;
    else if (start <= -3) detail = `풀 ${detail}`;
  }
  return { key, detail };
}

// ---------- 점수와 팁 ----------
const TIP = {
  tempoFast: '백스윙이 빨라요. 천천히 올려 보세요',
  tempoSlow: '백스윙이 너무 느려요. 리듬 있게 이어서 올려 보세요',
  topPause: '톱에서 오래 멈춰요. 끊지 말고 이어서 내려오세요',
  outInSlice: '아웃-인 궤도라 슬라이스가 나요. {R}발 쪽에서 안으로 내려오세요',
  outIn: '아웃-인 궤도예요. 팔보다 몸통을 먼저 돌리며 안쪽으로 내려오세요',
  inOutHook: '인-아웃이 심해서 훅이 나요. 몸통을 끝까지 돌려 {L}쪽으로 휘두르세요',
  inOut: '인-아웃이 커요. 임팩트 뒤에도 몸통을 계속 돌려 주세요',
  faceOpen: '페이스가 열려 맞아요. {L}손등을 목표 쪽으로 돌리며 치세요',
  faceClosed: '페이스가 닫혀 맞아요. 그립을 조금 느슨하게 쥐어 보세요',
  short: '백스윙이 짧아요. 어깨를 끝까지 돌려 더 올려 보세요',
  over: '오버스윙이에요. {L}팔을 펴고 톱을 조금 줄여 보세요',
  steep: '다운스윙이 가팔라요. 톱에서 팔을 떨어뜨리듯 내려오세요',
  flat: '스윙이 누워 있어요. 손을 조금 더 높이 올려 보세요',
  driverDown: '드라이버는 올려 쳐야 멀리 가요. 공을 {L}발 앞에 두세요',
  miss: '어드레스 자세로 돌아오지 못했어요. 머리를 공 뒤에 두고 치세요',
  slow: '스윙이 약해요. 피니시까지 끝까지 휘둘러 보세요',
  good: '좋은 스윙이에요. 이 템포를 기억하세요',
  great: '완벽해요. 지금 느낌 그대로 한 번 더'
};
function tipText(id, lefty) {
  return TIP[id].replace(/\{R\}/g, lefty ? '왼' : '오른').replace(/\{L\}/g, lefty ? '오른' : '왼');
}

function scoreSwing(a, spec) {
  const ftp = Math.abs(a.faceToPathDeg);
  const wedge = spec.kind === 'wedge';
  const wood = spec.kind === 'wood' || spec.kind === 'hybrid';
  // 웨지는 하프·3/4 스윙도 거리 맞추는 정상 스윙이고, 아이언 3/4 도 괜찮은 스윙입니다.
  let len;
  if (a.backswingKey === 'half') len = wedge ? 0.88 : 0.4;
  else if (a.backswingKey === 'three') len = wedge ? 1 : wood ? 0.8 : 0.9;
  else if (a.backswingKey === 'full') len = 1;
  else len = clamp(1 - (a.backswingDeg - 300) / 80, 0.4, 1);
  // 기대 헤드 스피드는 백스윙 크기만큼 줄여서 봅니다(하프 스윙에 "약해요" 하지 않게).
  const typical = spec.typicalKmh * clamp(a.backswingDeg / 265, 0.55, 1);
  const pauseK = clamp(1 - (a.pauseSec - PAUSE_SEC) / 0.5, 0.5, 1);
  const parts = {
    shape: 18 * g01(ftp, 1, 8) + 12 * g01(Math.abs(a.startDeg), 1, 9),
    path: 10 * g01(Math.abs(a.pathDeg - 1), 1, 8),
    tempo: 15 * g01(Math.abs(a.tempoRatio - a.idealTempo) * (3 / a.idealTempo), 0.35, 2) * pauseK,
    length: 10 * len,
    plane: 12 * g01(Math.abs(a.planeDevDeg), 3, 14),
    strike: 10 * clamp((a.strike - 0.55) / 0.45, 0, 1),
    speed: 8 * clamp((a.headSpeedKmh / typical - 0.5) / 0.5, 0, 1),
    attack: 5 * g01(Math.abs(a.attackDeg - spec.attack), 1.5, 6)
  };
  const max = { shape: 30, path: 10, tempo: 15, length: 10, plane: 12, strike: 10, speed: 8, attack: 5 };
  let score = 0;
  for (const k of Object.keys(parts)) {
    parts[k] = r1(parts[k]);
    score += parts[k];
  }
  score = Math.round(clamp(score, 0, 100));
  const lost = (k) => max[k] - parts[k];
  const issues = [];
  if (a.pauseSec > PAUSE_SEC && a.tempoKey !== 'fast') issues.push(['topPause', Math.max(3, lost('tempo'))]);
  else if (lost('tempo') > 3) issues.push([a.tempoRatio < a.idealTempo ? 'tempoFast' : 'tempoSlow', lost('tempo')]);
  const curveLost = lost('shape') + lost('path');
  // 궤도 팁: 슬라이스·훅이 실제로 날 때만 그 이름을 씁니다.
  const sliceOut = a.pathDeg <= -3 && a.shapeKey === 'slice';
  const hookIn = a.pathDeg >= 4 && a.shapeKey === 'hook';
  if (sliceOut) issues.push(['outInSlice', curveLost + 2]);
  else if (a.pathDeg <= -3) issues.push(['outIn', curveLost]);
  else if (hookIn) issues.push(['inOutHook', curveLost + 2]);
  // 드로우를 치는 4~5° 인-아웃은 좋은 궤도라 팁을 주지 않습니다.
  else if (a.pathDeg >= 5.5) issues.push(['inOut', curveLost]);
  const faceLost = 12 * (1 - g01(Math.abs(a.startDeg), 1, 9)) + 18 * (1 - g01(ftp, 1, 8)) * 0.5;
  if (a.faceDeg >= 3 && !sliceOut) issues.push(['faceOpen', faceLost]);
  if (a.faceDeg <= -3 && !hookIn) issues.push(['faceClosed', faceLost]);
  if (lost('length') > 1.9) issues.push([a.backswingKey === 'over' ? 'over' : 'short', lost('length')]);
  if (lost('plane') > 2.5) issues.push([a.planeDevDeg > 0 ? 'steep' : 'flat', lost('plane')]);
  if (spec.id === '1w' && a.attackDeg < -0.5) issues.push(['driverDown', 4]);
  if (lost('strike') > 3) issues.push(['miss', lost('strike')]);
  if (lost('speed') > 3) issues.push(['slow', lost('speed') * 0.8]);
  issues.sort((x, y) => y[1] - x[1]);
  const lefty = a.handedness === 'left';
  const tips = [];
  const notable = issues.filter((x) => x[1] >= 1.5);
  if (score >= 90 && !notable.length) tips.push(tipText('great', lefty));
  for (const [id] of notable) {
    if (tips.length >= 2) break;
    const t = tipText(id, lefty);
    if (!tips.includes(t)) tips.push(t);
  }
  if (!tips.length) tips.push(tipText('good', lefty));
  const grade = score >= 90 ? '완벽해요' : score >= 80 ? '아주 좋아요' : score >= 70 ? '좋아요' : score >= 55 ? '괜찮아요' : '다시 해 봐요';
  return { score, grade, parts, tips };
}

// 폰에 보낼 짧은 요약(d2c analysis 의 summary)
export function summarize(a) {
  if (!a || !a.ok) return { ok: false, reason: a ? a.reason : 'none' };
  const keys = ['id', 'club', 'clubName', 'clubShort', 'handedness', 'score', 'grade', 'shape', 'shapeKey', 'shapeDetail', 'headSpeedKmh', 'ballSpeedKmh', 'smash',
    'tempoRatio', 'idealTempo', 'tempoKey', 'backswingSec', 'downswingSec', 'pauseSec', 'backswingDeg', 'backswingLabel', 'planeDeg', 'idealPlaneDeg', 'planeLabel', 'planeKey', 'pathDeg', 'pathKey',
    'faceDeg', 'faceKey', 'faceToPathDeg', 'startDeg', 'attackDeg', 'attackLabel', 'tips'];
  const s = { ok: true };
  for (const k of keys) s[k] = a[k];
  return s;
}

// 한 사람의 스윙 기록 요약(라운드 결과의 "베스트 스윙" 등)
export function historyStats(list) {
  const L = (list || []).filter((a) => a && a.ok !== false && Number.isFinite(a.score));
  if (!L.length) return { count: 0 };
  const avg = (f) => L.reduce((s, a) => s + f(a), 0) / L.length;
  const best = L.reduce((b, a) => (a.score > b.score ? a : b), L[0]);
  const shapes = {};
  for (const a of L) shapes[a.shapeKey] = (shapes[a.shapeKey] || 0) + 1;
  const head = L.slice(0, 3), tail = L.slice(-3);
  const mean = (arr) => arr.reduce((s, a) => s + a.score, 0) / arr.length;
  return {
    count: L.length,
    avgScore: Math.round(avg((a) => a.score)),
    bestScore: best.score,
    best: summarize(best).ok ? summarize(best) : best,
    avgHeadSpeedKmh: Math.round(avg((a) => a.headSpeedKmh)),
    maxHeadSpeedKmh: Math.round(Math.max(...L.map((a) => a.headSpeedKmh))),
    avgTempo: r1(avg((a) => a.tempoRatio)),
    shapes,
    trend: L.length >= 4 ? Math.round(mean(tail) - mean(head)) : 0
  };
}

// ---------- 화면(패널) ----------
const STYLE = `
.ga-panel{--ga-good:#5ee07a;--ga-ok:#d4f36b;--ga-warn:#ffc93c;--ga-bad:#ff6b6b;--ga-fg:#f6f5ef;--ga-dim:#a6bcaf;--ga-line:rgba(255,255,255,.12);
  position:relative;box-sizing:border-box;width:min(1240px,94vw);display:grid;grid-template-columns:470px minmax(0,1fr);gap:20px;padding:20px;
  border-radius:26px;color:var(--ga-fg);font-family:"Pretendard Variable",Pretendard,-apple-system,"Apple SD Gothic Neo",system-ui,sans-serif;
  background:linear-gradient(155deg,rgba(18,40,30,.94),rgba(8,17,13,.95));border:1px solid var(--ga-line);box-shadow:0 30px 90px rgba(0,0,0,.5);
  backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);-webkit-font-smoothing:antialiased;text-align:left;line-height:1.3}
.ga-panel *{box-sizing:border-box}
.ga-panel.in{animation:ga-in .45s cubic-bezier(.2,1.1,.3,1) both}
.ga-panel.fit{transform-origin:0 0}
@keyframes ga-in{from{opacity:0;transform:translateY(18px) scale(.97)}}
.ga-num{font-family:Anton,Impact,"Pretendard Variable",sans-serif;font-weight:400;letter-spacing:.01em}
.ga-left{display:flex;flex-direction:column;min-height:0}
.ga-rp{position:relative;flex:1;min-height:560px;border-radius:18px;overflow:hidden;border:1px solid var(--ga-line);
  background:radial-gradient(130% 70% at 50% 0%,#1f4032 0%,#0d1c15 62%,#08120d 100%)}
.ga-rp canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.ga-rp .ga-vl{position:absolute;left:12px;padding:4px 10px;border-radius:999px;background:rgba(0,0,0,.42);color:#dfe9e3;font-size:12px;font-weight:800;letter-spacing:.04em}
.ga-rp .ga-vl b{color:var(--ga-ok);font-weight:800;margin-right:6px}
.ga-rp .ga-hr{position:absolute;left:10px;right:10px;height:1px;background:var(--ga-line)}
.ga-rp .ga-lab{position:absolute;transform:translate(-50%,-140%);padding:3px 8px;border-radius:8px;font-size:11px;font-weight:800;white-space:nowrap;
  background:rgba(8,16,12,.78);border:1px solid rgba(255,255,255,.18);color:#fff;opacity:0;transition:opacity .25s;pointer-events:none}
.ga-rp .ga-lab.on{opacity:1}
.ga-rp .ga-lab i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;vertical-align:1px}
.ga-rp .ga-live{position:absolute;right:12px;padding:4px 10px;border-radius:999px;background:rgba(0,0,0,.42);font-size:12px;font-weight:800;color:#dfe9e3}
.ga-rp .ga-live b{font-family:Anton,Impact,sans-serif;font-weight:400;font-size:16px;color:#fff;margin:0 3px 0 4px}
.ga-tl{position:absolute;left:14px;right:14px;bottom:12px;height:40px;pointer-events:none}
.ga-tl .bar{position:absolute;left:0;right:0;top:27px;height:5px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden}
.ga-tl .fill{height:100%;width:0;border-radius:3px;background:linear-gradient(90deg,rgba(212,243,107,.55),#d4f36b)}
.ga-tl .tick{position:absolute;top:22px;width:2px;height:15px;margin-left:-1px;background:rgba(255,255,255,.55);border-radius:1px}
.ga-tl .tk{position:absolute;top:4px;transform:translateX(-50%);font-size:11px;font-weight:800;color:var(--ga-dim);white-space:nowrap}
.ga-tl .tk.on{color:#fff}
.ga-tl .ph{position:absolute;left:0;top:-20px;font-size:13px;font-weight:900;color:#fff}
.ga-tl .sp{position:absolute;right:0;top:-20px;font-size:11px;font-weight:800;color:var(--ga-dim);display:flex;align-items:center;gap:6px}
.ga-tl .sp i{display:inline-block;width:64px;height:6px;border-radius:3px;background:linear-gradient(90deg,#3ab4ff,#45d6c4,#5ee07a,#ffd23a,#ff5a5f)}
.ga-tl .sp u{display:inline-block;width:14px;height:10px;border-radius:2px;border:1px solid rgba(212,243,107,.6);background:rgba(212,243,107,.14)}
.ga-right{display:flex;flex-direction:column;gap:14px;min-width:0}
.ga-head{display:flex;align-items:center;gap:12px;min-height:34px}
.ga-eyebrow{font-family:Anton,Impact,sans-serif;font-size:15px;letter-spacing:.16em;color:var(--ga-ok)}
.ga-who{font-family:Anton,Impact,sans-serif;font-size:20px;line-height:1;padding:6px 14px;border-radius:999px;background:var(--c,#ff5a5f);color:#0b0f17}
.ga-club{font-size:15px;font-weight:800;color:#e9efe9;padding:6px 12px;border-radius:999px;border:1px solid var(--ga-line);background:rgba(255,255,255,.05)}
.ga-skip{margin-left:auto;font-size:13px;font-weight:700;color:var(--ga-dim)}
.ga-skip kbd{font-family:inherit;font-size:12px;font-weight:800;padding:2px 8px;border-radius:6px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);margin-right:4px;color:#fff}
.ga-hero{display:grid;grid-template-columns:150px minmax(0,1fr) 196px;gap:18px;align-items:center;padding:14px 16px;border-radius:18px;
  background:linear-gradient(120deg,rgba(255,255,255,.07),rgba(255,255,255,.02));border:1px solid var(--ga-line)}
.ga-ring{position:relative;width:150px;height:150px}
.ga-ring svg{width:100%;height:100%;transform:rotate(-90deg)}
.ga-ring .arc{transition:stroke-dashoffset 1.1s cubic-bezier(.2,.9,.2,1) .15s}
.ga-ring .val{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ga-ring .val b{font-family:Anton,Impact,sans-serif;font-weight:400;font-size:58px;line-height:1}
.ga-ring .val span{font-size:12px;font-weight:800;color:var(--ga-dim);margin-top:4px;letter-spacing:.04em}
.ga-shape .k{font-size:13px;font-weight:800;color:var(--ga-dim);letter-spacing:.04em}
.ga-shape .nm{font-size:46px;font-weight:900;letter-spacing:-.03em;line-height:1.08;margin:2px 0 4px}
.ga-shape .gr{font-size:18px;font-weight:800}
.ga-shape .dt{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px}
.ga-chip{font-size:12.5px;font-weight:800;padding:4px 9px;border-radius:999px;background:rgba(255,255,255,.07);color:#dfe9e3;white-space:nowrap}
.ga-fl{width:196px;height:170px}
.ga-tips{display:grid;gap:8px}
.ga-tip{display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:14px;background:rgba(255,255,255,.055);border:1px solid var(--ga-line);font-size:17px;font-weight:800;line-height:1.35}
.ga-tip svg{flex:none;width:26px;height:26px}
.ga-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
.ga-m{position:relative;padding:10px 12px 9px;border-radius:14px;background:rgba(255,255,255,.045);border:1px solid var(--ga-line);overflow:hidden;min-height:96px}
.ga-m::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:0 3px 3px 0;background:var(--st,transparent)}
.ga-m .k{font-size:12px;font-weight:800;color:var(--ga-dim);letter-spacing:.02em;white-space:nowrap}
.ga-m .v{font-family:Anton,Impact,sans-serif;font-weight:400;font-size:29px;line-height:1.18;white-space:nowrap}
.ga-m .v small{font-family:"Pretendard Variable",Pretendard,sans-serif;font-size:12px;font-weight:700;color:var(--ga-dim);margin-left:3px}
.ga-m .s{font-size:12.5px;font-weight:800;color:var(--st,var(--ga-dim));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ga-m svg.mini{position:absolute;right:8px;top:9px;width:40px;height:28px;opacity:.95}
.ga-hist{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:16px;align-items:center;padding:10px 16px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid var(--ga-line)}
.ga-hist .k{font-size:12px;font-weight:800;color:var(--ga-dim)}
.ga-hist .n{font-size:16px;font-weight:900;white-space:nowrap}
.ga-hist svg{width:100%;height:48px;display:block}
.ga-hist .st{display:flex;gap:16px}
.ga-hist .st div{text-align:right}
.ga-hist .st b{display:block;font-family:Anton,Impact,sans-serif;font-weight:400;font-size:22px;line-height:1.1}
.ga-hist .st span{font-size:11.5px;font-weight:800;color:var(--ga-dim);white-space:nowrap}
.ga-hist .none{font-size:14px;font-weight:700;color:var(--ga-dim)}
.ga-fail{display:flex;align-items:center;gap:22px;padding:26px 30px;font-size:24px;font-weight:900}
.ga-fail svg{flex:none;width:76px;height:76px}
.ga-fail .ga-eyebrow{margin-bottom:6px}
.ga-fail .ttl{display:flex;align-items:center;gap:10px}
.ga-fail .sub{margin-top:6px;font-size:16px;color:var(--ga-dim);font-weight:700}
.ga-fail .ga-who{font-size:15px;padding:4px 10px}
/* 폰(작게) */
.ga-panel.compact{width:100%;grid-template-columns:1fr;gap:12px;padding:14px;border-radius:22px}
.ga-panel.compact .ga-rp{min-height:0;height:250px;flex:none}
.ga-panel.compact .ga-hero{grid-template-columns:104px minmax(0,1fr);gap:12px;padding:12px}
.ga-panel.compact .ga-ring{width:104px;height:104px}
.ga-panel.compact .ga-ring .val b{font-size:40px}
.ga-panel.compact .ga-shape .nm{font-size:30px}
.ga-panel.compact .ga-shape .gr{font-size:15px}
.ga-panel.compact .ga-fl{display:none}
.ga-panel.compact .ga-tip{font-size:15px;padding:10px 12px}
.ga-panel.compact .ga-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
.ga-panel.compact .ga-m{min-height:84px}
.ga-panel.compact .ga-hist{grid-template-columns:1fr;gap:8px}
.ga-panel.compact .ga-hist .st{justify-content:space-between}
.ga-panel.compact .ga-head .ga-skip{display:none}
.ga-c2d{position:absolute;inset:0;width:100%;height:100%}
/* 폰 요약 카드 */
.ga-card{--ga-good:#5ee07a;--ga-ok:#d4f36b;--ga-warn:#ffc93c;--ga-bad:#ff6b6b;--ga-dim:#a6bcaf;--ga-line:rgba(255,255,255,.12);box-sizing:border-box;width:100%;
  padding:14px;border-radius:20px;background:linear-gradient(155deg,rgba(255,255,255,.08),rgba(255,255,255,.03));border:1px solid var(--ga-line);color:#f6f5ef;
  font-family:"Pretendard Variable",Pretendard,-apple-system,system-ui,sans-serif;text-align:left;animation:ga-in .4s cubic-bezier(.2,1.1,.3,1) both}
.ga-card *{box-sizing:border-box}
.ga-card .top{display:flex;align-items:center;gap:14px}
.ga-card .ring{position:relative;width:84px;height:84px;flex:none}
.ga-card .ring svg{width:100%;height:100%;transform:rotate(-90deg)}
.ga-card .ring b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:Anton,Impact,sans-serif;font-weight:400;font-size:34px}
.ga-card .k{font-size:12px;font-weight:800;color:var(--ga-dim)}
.ga-card .nm{font-size:28px;font-weight:900;letter-spacing:-.03em;line-height:1.1}
.ga-card .gr{font-size:14px;font-weight:800}
.ga-card .chips{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:12px}
.ga-card .chips div{padding:8px 6px;border-radius:12px;background:rgba(255,255,255,.06);text-align:center}
.ga-card .chips span{display:block;font-size:11px;font-weight:800;color:var(--ga-dim)}
.ga-card .chips b{font-family:Anton,Impact,sans-serif;font-weight:400;font-size:20px}
.ga-card .chips small{font-size:10px;color:var(--ga-dim);margin-left:2px}
.ga-card .tip{margin-top:10px;font-size:15px;font-weight:800;line-height:1.4}
.ga-card .more{margin-top:12px;width:100%;padding:13px;border-radius:14px;border:1.5px solid var(--ga-line);background:transparent;color:#f6f5ef;font:inherit;font-size:15px;font-weight:800;cursor:pointer}
`;
function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById('ga-styles')) return;
  const st = document.createElement('style');
  st.id = 'ga-styles';
  st.textContent = STYLE;
  document.head.appendChild(st);
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sgn = (v, d = 1) => `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(v).toFixed(d)}`;
const scoreColor = (s) => (s >= 80 ? '#5ee07a' : s >= 65 ? '#d4f36b' : s >= 50 ? '#ffc93c' : '#ff6b6b');
const ST = { good: 'var(--ga-good)', ok: 'var(--ga-ok)', warn: 'var(--ga-warn)', bad: 'var(--ga-bad)' };

function ringSvg(score, r, w) {
  const c = 2 * Math.PI * r;
  const size = 2 * (r + w);
  return `<svg viewBox="0 0 ${size} ${size}"><circle cx="${r + w}" cy="${r + w}" r="${r}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="${w}"/>` +
    `<circle class="arc" cx="${r + w}" cy="${r + w}" r="${r}" fill="none" stroke="${scoreColor(score)}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${c.toFixed(1)}" data-to="${(c * (1 - score / 100)).toFixed(1)}"/></svg>`;
}

// 위에서 본 임팩트: 목표선, 클럽 궤도 화살표, 페이스, 예상 구질 곡선
function flightSvg(a) {
  const mir = a.handedness === 'left' ? -1 : 1;
  const W = 196, H = 170, bx = 98, by = 146;
  const amp = 2.2;
  const p = clamp(a.pathDeg * amp, -40, 40) * RD * mir;
  const f = clamp(a.faceDeg * amp, -40, 40) * RD * mir;
  const st = clamp(a.startDeg * amp, -40, 40) * RD * mir;
  const curve = clamp(a.faceToPathDeg, -14, 14) * mir;
  const L = 118;
  const ex = bx + Math.sin(st) * L + curve * 2.6, ey = by - Math.cos(st) * L + Math.abs(curve) * 0.4;
  const cx = bx + Math.sin(st) * L * 0.55, cy = by - Math.cos(st) * L * 0.55;
  const ax0 = bx - Math.sin(p) * 34, ay0 = by + Math.cos(p) * 34;
  const ax1 = bx + Math.sin(p) * 26, ay1 = by - Math.cos(p) * 26;
  const fx = Math.cos(f) * 20, fy = Math.sin(f) * 20;
  const nx = bx + Math.sin(f) * 16, ny = by - Math.cos(f) * 16;
  const ah = (x, y, ang) => `M${(x - Math.sin(ang - 0.45) * 9).toFixed(1)} ${(y + Math.cos(ang - 0.45) * 9).toFixed(1)}L${x.toFixed(1)} ${y.toFixed(1)}L${(x - Math.sin(ang + 0.45) * 9).toFixed(1)} ${(y + Math.cos(ang + 0.45) * 9).toFixed(1)}`;
  return `<svg class="ga-fl" viewBox="0 0 ${W} ${H}" aria-hidden="true">
  <defs><linearGradient id="ga-flg" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity=".35"/></linearGradient></defs>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="14" fill="rgba(0,0,0,.18)" stroke="rgba(255,255,255,.08)"/>
  <path d="M${bx} ${by + 14}V10" stroke="rgba(255,255,255,.28)" stroke-width="1.5" stroke-dasharray="4 5"/>
  <circle cx="${bx}" cy="12" r="5" fill="none" stroke="#d4f36b" stroke-width="2"/>
  <path d="M${bx} ${by}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none" stroke="url(#ga-flg)" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 6"/>
  <circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="4.5" fill="#fff"/>
  <path d="M${ax0.toFixed(1)} ${ay0.toFixed(1)}L${ax1.toFixed(1)} ${ay1.toFixed(1)}" stroke="#45d6f0" stroke-width="4" stroke-linecap="round"/>
  <path d="${ah(ax1, ay1, p)}" fill="none" stroke="#45d6f0" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M${(bx - fx).toFixed(1)} ${(by - fy).toFixed(1)}L${(bx + fx).toFixed(1)} ${(by + fy).toFixed(1)}" stroke="#ffd23a" stroke-width="5" stroke-linecap="round"/>
  <path d="M${bx} ${by}L${nx.toFixed(1)} ${ny.toFixed(1)}" stroke="#ffd23a" stroke-width="2" stroke-linecap="round" opacity=".8"/>
  <circle cx="${bx}" cy="${by}" r="5" fill="#fff" stroke="#0b1a14" stroke-width="1.5"/>
  <text x="10" y="${H - 12}" font-size="11.5" font-weight="800" fill="#45d6f0">궤도 ${sgn(a.pathDeg)}°</text>
  <text x="${W - 10}" y="${H - 12}" font-size="11.5" font-weight="800" fill="#ffd23a" text-anchor="end">페이스 ${sgn(a.faceDeg)}°</text>
</svg>`;
}

function tempoMini(a) {
  const ideal = a.idealTempo || 3;
  const tot = a.backswingSec + a.downswingSec;
  const w = 40;
  const b = (a.backswingSec / tot) * w;
  return `<svg class="mini" viewBox="0 0 40 28"><rect x="0" y="18" width="${b.toFixed(1)}" height="6" rx="3" fill="#3ab4ff"/><rect x="${(b + 1).toFixed(1)}" y="18" width="${Math.max(1, w - b - 1).toFixed(1)}" height="6" rx="3" fill="#ff5a5f"/><path d="M${((ideal / (ideal + 1)) * 40).toFixed(1)} 13v14" stroke="#fff" stroke-width="1.5" opacity=".7"/></svg>`;
}
function backMini(a) {
  const ang = clamp(a.backswingDeg, 0, 360) * RD;
  const r = 12, cx = 20, cy = 15;
  const ex = cx - Math.sin(ang) * r, ey = cy + Math.cos(ang) * r;
  const big = ang > Math.PI ? 1 : 0;
  return `<svg class="mini" viewBox="0 0 40 30"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="4"/>` +
    `<path d="M${cx} ${cy + r}A${r} ${r} 0 ${big} 1 ${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none" stroke="#45d6c4" stroke-width="4" stroke-linecap="round"/>` +
    `<path d="M${cx} ${cy}L${ex.toFixed(1)} ${ey.toFixed(1)}" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`;
}
function planeMini(a) {
  const line = (deg, dash, col) => {
    const t = deg * RD;
    return `<path d="M6 25L${(6 + Math.cos(t) * 30).toFixed(1)} ${(25 - Math.sin(t) * 30).toFixed(1)}" stroke="${col}" stroke-width="${dash ? 1.6 : 2.6}" ${dash ? 'stroke-dasharray="3 3"' : ''} stroke-linecap="round"/>`;
  };
  return `<svg class="mini" viewBox="0 0 40 28"><path d="M2 25H38" stroke="rgba(255,255,255,.25)" stroke-width="1"/>${line(a.idealPlaneDeg, true, '#d4f36b')}${line(a.planeDeg, false, '#fff')}</svg>`;
}

function metricTiles(a) {
  const tempoSt = a.tempoKey === 'good' ? 'good' : Math.abs(a.tempoRatio - (a.idealTempo || 3)) * (3 / (a.idealTempo || 3)) > 1.4 ? 'bad' : 'warn';
  const lenSt = a.backswingKey === 'full' || (a.kind === 'wedge' && a.backswingKey === 'three') ? 'good' : a.backswingKey === 'three' ? 'ok' : a.backswingKey === 'over' ? 'warn' : 'warn';
  const planeSt = a.planeKey === 'on' ? 'good' : Math.abs(a.planeDevDeg) > 9 ? 'bad' : 'warn';
  const pathSt = Math.abs(a.pathDeg - 1) <= 3 ? 'good' : Math.abs(a.pathDeg) <= 6 ? 'warn' : 'bad';
  const faceSt = Math.abs(a.faceDeg) <= 2 ? 'good' : Math.abs(a.faceDeg) <= 5 ? 'warn' : 'bad';
  const ftp = a.faceToPathDeg;
  const ftpSt = Math.abs(ftp) <= 2 ? 'good' : Math.abs(ftp) < 6 ? 'ok' : 'bad';
  const spec = CLUB_SPECS[a.club];
  const atkSt = Math.abs(a.attackDeg - spec.attack) <= 2 ? 'good' : 'warn';
  const rel = Math.round(a.headSpeedKmh - spec.typicalKmh);
  const spdSt = a.headSpeedKmh >= spec.typicalKmh * 0.92 ? 'good' : a.headSpeedKmh >= spec.typicalKmh * 0.7 ? 'ok' : 'warn';
  const strikeSt = a.strike >= 0.95 ? 'good' : a.strike >= 0.8 ? 'warn' : 'bad';
  const tiles = [
    ['헤드 스피드', `${Math.round(a.headSpeedKmh)}<small>km/h</small>`, rel >= 0 ? `평균보다 +${rel}` : `평균보다 ${rel}`, spdSt, ''],
    ['볼 스피드', `${Math.round(a.ballSpeedKmh)}<small>km/h</small>`, `헤드 × ${a.smash.toFixed(2)}`, 'ok', ''],
    ['스매시 팩터', a.smash.toFixed(2), a.strike >= 0.95 ? '정타' : a.strike >= 0.8 ? '조금 빗맞음' : '빗맞음', strikeSt, ''],
    ['템포', `${a.tempoRatio.toFixed(1)}<small>: 1</small>`, a.pauseSec > PAUSE_SEC ? `톱에서 ${a.pauseSec.toFixed(1)}초 멈춤` : a.idealTempo < 2.95 ? `짧은 스윙 기준 ${a.idealTempo.toFixed(1)} : 1` : `${a.backswingSec.toFixed(2)}초 · ${a.downswingSec.toFixed(2)}초`, a.pauseSec > PAUSE_SEC && tempoSt === 'good' ? 'warn' : tempoSt, tempoMini(a)],
    ['백스윙', `${a.backswingDeg}<small>°</small>`, `${a.backswingLabel} 스윙`, lenSt, backMini(a)],
    ['스윙 플레인', `${Math.round(a.planeDeg)}<small>°</small>`, `${a.planeLabel} · 기준 ${Math.round(a.idealPlaneDeg)}°`, planeSt, planeMini(a)],
    ['스윙 궤도', `${sgn(a.pathDeg)}<small>°</small>`, { 'in-out': '인-아웃', 'out-in': '아웃-인', square: '스퀘어' }[a.pathKey], pathSt, ''],
    ['페이스 각', `${sgn(a.faceDeg)}<small>°</small>`, { open: '열림', closed: '닫힘', square: '스퀘어' }[a.faceKey], faceSt, ''],
    ['페이스-궤도', `${sgn(ftp)}<small>°</small>`, Math.abs(ftp) <= 2 ? '곧게 날아가요' : ftp < 0 ? (a.handedness === 'left' ? '오른쪽으로 휨' : '왼쪽으로 휨') : (a.handedness === 'left' ? '왼쪽으로 휨' : '오른쪽으로 휨'), ftpSt, ''],
    ['어택 앵글', `${sgn(a.attackDeg)}<small>°</small>`, a.attackLabel, atkSt, '']
  ];
  return tiles.map(([k, v, s, st, mini]) => `<div class="ga-m" style="--st:${ST[st]}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${esc(s)}</div>${mini}</div>`).join('');
}

const TIP_ICON = '<svg viewBox="0 0 26 26"><circle cx="13" cy="13" r="12" fill="rgba(212,243,107,.16)"/><path d="M13 6.5a5 5 0 0 0-3 9v2.2h6v-2.2a5 5 0 0 0-3-9z" fill="none" stroke="#d4f36b" stroke-width="1.8" stroke-linejoin="round"/><path d="M10.8 20.2h4.4" stroke="#d4f36b" stroke-width="1.8" stroke-linecap="round"/></svg>';

function historyHtml(a, history, color) {
  const prev = (history || []).filter((h) => h && h.ok !== false && Number.isFinite(h.score) && h !== a && (a.id == null || h.id !== a.id));
  const list = [...prev, a];
  if (list.length < 2) {
    return `<div class="ga-hist"><div><div class="k">스윙 기록</div><div class="n">첫 스윙</div></div><div class="none">스윙할 때마다 점수와 템포가 여기 쌓여요</div><div></div></div>`;
  }
  const st = historyStats(list);
  const W = 400, H = 48, pad = 6;
  const last = list.slice(-14);
  const xs = (i) => pad + (i / Math.max(1, last.length - 1)) * (W - pad * 2);
  const ys = (s) => H - pad - (clamp(s, 0, 100) / 100) * (H - pad * 2);
  const pts = last.map((h, i) => `${xs(i).toFixed(1)},${ys(h.score).toFixed(1)}`).join(' ');
  const area = `M${xs(0).toFixed(1)} ${H}L${pts.split(' ').join('L')}L${xs(last.length - 1).toFixed(1)} ${H}Z`;
  const dots = last.map((h, i) => `<circle cx="${xs(i).toFixed(1)}" cy="${ys(h.score).toFixed(1)}" r="${i === last.length - 1 ? 5 : 3}" fill="${i === last.length - 1 ? color : '#fff'}" stroke="${i === last.length - 1 ? '#fff' : 'none'}" stroke-width="2"/>`).join('');
  const trend = st.trend;
  return `<div class="ga-hist"><div><div class="k">스윙 기록</div><div class="n">${list.length}번째 스윙</div></div>
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="ga-hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
  <path d="M0 ${ys(80).toFixed(1)}H${W}" stroke="rgba(255,255,255,.1)" stroke-dasharray="3 5"/><path d="${area}" fill="url(#ga-hg)"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>${dots}</svg>
  <div class="st"><div><b>${st.avgScore}</b><span>평균 점수</span></div><div><b>${st.bestScore}</b><span>최고</span></div><div><b>${st.avgHeadSpeedKmh}</b><span>평균 헤드 km/h</span></div><div><b>${st.avgTempo.toFixed(1)}</b><span>평균 템포</span></div>${list.length >= 4 ? `<div><b style="color:${trend >= 0 ? '#5ee07a' : '#ff6b6b'}">${trend >= 0 ? '+' : ''}${trend}</b><span>처음보다</span></div>` : ''}</div></div>`;
}

// 분석 패널을 el 안에 그립니다.
//   history: 같은 사람의 이전 분석들(오래된 것부터). 이번 것이 들어 있어도 됩니다.
//   opts: { player: {name, color}, hint: '건너뛰기 안내', compact: 폰용, replay: true | createReplay() 결과 | false }
//   돌려주는 값: { el, replay, dispose() }
export function renderPanel(el, a, history, opts = {}) {
  ensureStyles();
  const color = (opts.player && opts.player.color) || '#ff5a5f';
  const panel = document.createElement('div');
  panel.className = `ga-panel in${opts.compact ? ' compact' : ''}`;
  panel.style.setProperty('--c', color);
  if (!a || !a.ok) {
    panel.style.gridTemplateColumns = '1fr';
    panel.style.width = 'min(640px, 92vw)';
    const who = opts.player && opts.player.name ? `<span class="ga-who">${esc(opts.player.name)}</span>` : '';
    panel.innerHTML = `<div class="ga-fail"><svg viewBox="0 0 76 76" aria-hidden="true"><circle cx="38" cy="38" r="36" fill="rgba(255,201,60,.12)" stroke="rgba(255,201,60,.4)" stroke-width="2"/>` +
      `<path d="M20 52A22 22 0 1 1 56 52" fill="none" stroke="#ffc93c" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="5 6"/><circle cx="56" cy="52" r="4.5" fill="#fff"/><path d="M38 26v14" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="38" cy="48" r="2.6" fill="#fff"/></svg>` +
      `<div><div class="ga-eyebrow">SWING ANALYSIS</div><div class="ttl">스윙을 읽지 못했어요${who}</div><div class="sub">어드레스에서 잠깐 멈춘 뒤, 피니시까지 끝까지 휘둘러 주세요</div></div></div>`;
    el.replaceChildren(panel);
    return { el: panel, replay: null, dispose() { panel.remove(); } };
  }
  const who = opts.player && opts.player.name ? `<span class="ga-who">${esc(opts.player.name)}</span>` : '';
  panel.innerHTML = `
  <div class="ga-left"><div class="ga-slot" style="flex:1;display:flex;flex-direction:column;min-height:0"></div></div>
  <div class="ga-right">
    <div class="ga-head"><span class="ga-eyebrow">SWING ANALYSIS</span>${who}<span class="ga-club">${esc(a.clubName)}</span>${opts.hint ? `<span class="ga-skip">${opts.hint}</span>` : ''}</div>
    <div class="ga-hero">
      <div class="ga-ring">${ringSvg(a.score, 62, 10)}<div class="val"><b>${a.score}</b><span>스윙 점수</span></div></div>
      <div class="ga-shape"><div class="k">구질</div><div class="nm">${esc(a.shapeDetail)}</div><div class="gr" style="color:${scoreColor(a.score)}">${esc(a.grade)}</div>
        <div class="dt"><span class="ga-chip">출발 ${a.startDeg >= 0 ? (a.handedness === 'left' ? '왼쪽' : '오른쪽') : (a.handedness === 'left' ? '오른쪽' : '왼쪽')} ${Math.abs(a.startDeg).toFixed(1)}°</span><span class="ga-chip">${a.backswingLabel} 스윙</span><span class="ga-chip">템포 ${a.tempoRatio.toFixed(1)} : 1</span></div></div>
      ${flightSvg(a)}
    </div>
    <div class="ga-tips">${a.tips.map((t) => `<div class="ga-tip">${TIP_ICON}<span>${esc(t)}</span></div>`).join('')}</div>
    <div class="ga-grid">${metricTiles(a)}</div>
    ${historyHtml(a, history, color)}
  </div>`;
  el.replaceChildren(panel);
  // 점수 고리 채우기
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const arc of panel.querySelectorAll('.arc')) arc.style.strokeDashoffset = arc.dataset.to;
  }));
  // 화면 크기에 맞춰 패널 전체를 줄이거나(노트북) 키웁니다(TV, 최대 1.3배). 3D 다시보기는 키운 만큼 더 촘촘히 그립니다.
  let replay = null;
  const fit = () => {
    if (opts.compact || !panel.isConnected) return;
    const box = el.getBoundingClientRect();
    const W = box.width > 300 ? box.width : window.innerWidth;
    const H = box.height > 300 ? box.height : window.innerHeight;
    const pw = panel.offsetWidth, ph = panel.offsetHeight;
    let k = Math.min(opts.maxScale || 1.3, (H * 0.92) / ph, (W * 0.94) / pw);
    if (Math.abs(k - 1) < 0.02) k = 1;
    // 바뀐 크기만큼 바깥 여백을 조정해서, 부모가 가운데 정렬하면 패널이 그대로 가운데 오게 합니다.
    const on = k !== 1;
    panel.classList.toggle('fit', on);
    panel.style.scale = on ? k.toFixed(3) : '';
    panel.style.marginRight = on ? `${(-(1 - k) * pw).toFixed(1)}px` : '';
    panel.style.marginBottom = on ? `${(-(1 - k) * ph).toFixed(1)}px` : '';
    if (replay && replay.setPixelScale) replay.setPixelScale(Math.max(1, k));
  };
  fit();
  if (!opts.compact) window.addEventListener('resize', fit);
  const slot = panel.querySelector('.ga-slot');
  let own = false;
  if (opts.compact && opts.replay !== false && !(opts.replay && typeof opts.replay === 'object')) {
    // 폰은 WebGL 없이 2D 로 그립니다.
    const box = document.createElement('div');
    box.className = 'ga-rp';
    box.innerHTML = `<canvas class="ga-c2d"></canvas><div class="ga-vl" style="top:10px"><b>후방</b>다운 더 라인</div><div class="ga-vl" style="top:10px;left:auto;right:12px"><b>정면</b>${a.handedness === 'left' ? '← 목표' : '목표 →'}</div>`;
    slot.appendChild(box);
    replay = drawTrail2D(box.querySelector('canvas'), a, { color, animate: true });
    own = true;
  } else if (opts.replay && typeof opts.replay === 'object') {
    replay = opts.replay;
    replay.mount(slot);
    replay.load(a, { color });
    replay.play();
  } else if (opts.replay !== false) {
    replay = createReplay(slot, { color });
    replay.load(a, { color });
    replay.play();
    own = true;
  }
  fit();
  return {
    el: panel,
    replay,
    dispose() {
      window.removeEventListener('resize', fit);
      if (replay && own) replay.dispose();
      else if (replay && replay.pause) replay.pause();
      panel.remove();
    }
  };
}

// 폰의 짧은 요약 카드(summarize 결과나 분석 전체를 받습니다). opts.onDetails 를 주면 "자세히 보기" 버튼이 생깁니다.
export function renderSummary(el, s, opts = {}) {
  ensureStyles();
  const card = document.createElement('div');
  card.className = 'ga-card';
  if (!s || s.ok === false) {
    card.innerHTML = '<div class="nm" style="font-size:20px">스윙을 읽지 못했어요</div><div class="tip" style="color:var(--ga-dim)">어드레스에서 잠깐 멈춘 뒤 끝까지 휘둘러 주세요</div>';
    el.replaceChildren(card);
    return card;
  }
  card.innerHTML = `<div class="top"><div class="ring">${ringSvg(s.score, 34, 7)}<b>${s.score}</b></div>
    <div><div class="k">스윙 분석 · ${esc(s.clubShort || s.club || '')}</div><div class="nm">${esc(s.shapeDetail || s.shape)}</div><div class="gr" style="color:${scoreColor(s.score)}">${esc(s.grade)}</div></div></div>
    <div class="chips"><div><span>헤드</span><b>${Math.round(s.headSpeedKmh)}</b><small>km/h</small></div><div><span>템포</span><b>${Number(s.tempoRatio).toFixed(1)}</b><small>: 1</small></div><div><span>궤도</span><b>${sgn(s.pathDeg)}</b><small>°</small></div></div>
    ${(s.tips || []).slice(0, 1).map((t) => `<div class="tip">${esc(t)}</div>`).join('')}
    ${opts.onDetails ? '<button class="more" type="button">자세히 보기</button>' : ''}`;
  el.replaceChildren(card);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const arc of card.querySelectorAll('.arc')) arc.style.strokeDashoffset = arc.dataset.to;
  }));
  const b = card.querySelector('.more');
  if (b) b.addEventListener('click', () => opts.onDetails());
  return card;
}

// ---------- 속도 색 ----------
const SPEED_STOPS = [[0, [58, 180, 255]], [0.3, [69, 214, 196]], [0.55, [94, 224, 122]], [0.78, [255, 210, 58]], [1, [255, 90, 95]]];
export function speedColor(u) {
  u = clamp(u, 0, 1);
  for (let i = 1; i < SPEED_STOPS.length; i++) {
    const [b, cb] = SPEED_STOPS[i];
    if (u <= b) {
      const [a, ca] = SPEED_STOPS[i - 1];
      const k = (u - a) / (b - a);
      return [0, 1, 2].map((c) => (ca[c] + (cb[c] - ca[c]) * k) / 255);
    }
  }
  return SPEED_STOPS[SPEED_STOPS.length - 1][1].map((c) => c / 255);
}

// 다시보기 시간: 백스윙은 조금, 다운스윙은 많이 느리게
function playbackMap(times) {
  const T = times;
  const pts = [[0, 0]];
  const segs = [[T.takeaway, 0.9], [T.top, 0.55], [Math.min(T.end, T.impact + 0.06), 0.16], [T.end, 0.42]];
  let p = 0, r = 0;
  for (const [rt, sp] of segs) {
    const dr = Math.max(0, rt - r);
    p += dr / sp;
    r = rt;
    pts.push([p, r]);
  }
  const toReal = (pt) => {
    for (let i = 1; i < pts.length; i++) {
      if (pt <= pts[i][0]) {
        const [p0, r0] = pts[i - 1];
        const [p1, r1] = pts[i];
        return r0 + ((pt - p0) / Math.max(1e-6, p1 - p0)) * (r1 - r0);
      }
    }
    return pts[pts.length - 1][1];
  };
  const toPlay = (rt) => {
    for (let i = 1; i < pts.length; i++) {
      if (rt <= pts[i][1]) {
        const [p0, r0] = pts[i - 1];
        const [p1, r1] = pts[i];
        return p0 + ((rt - r0) / Math.max(1e-6, r1 - r0)) * (p1 - p0);
      }
    }
    return pts[pts.length - 1][0];
  };
  return { length: p, toReal, toPlay };
}
function phaseName(tt, T) {
  if (tt < T.takeaway) return '어드레스';
  if (tt < T.top) return '백스윙';
  if (tt < T.impact) return '다운스윙';
  if (tt < T.finish - 0.02) return '팔로스루';
  return '피니시';
}

// ---------- 2D 다시보기(폰) ----------
// 캔버스 왼쪽 = 후방(다운 더 라인), 오른쪽 = 정면. 돌려주는 값은 createReplay 와 같은 모양의 작은 객체입니다.
export function drawTrail2D(canvas, a, opts = {}) {
  const tr = a.trail;
  const T = tr.times;
  const lefty = a.handedness === 'left';
  const map = playbackMap(T);
  const hold = 1.2;
  let raf = 0, t0 = performance.now(), alive = true, playing = opts.animate !== false;
  const maxSpd = Math.max(1, tr.speedMax || Math.max(...tr.speed));
  const views = [
    { name: 'dtl', h: (p) => (lefty ? -1 : 1) * p[2], v: (p) => p[1] },
    { name: 'face', h: (p) => (lefty ? -1 : 1) * p[0], v: (p) => p[1] }
  ];
  function frame(now) {
    if (!alive) return;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) { raf = requestAnimationFrame(frame); return; }
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const pt = playing ? ((now - t0) / 1000) % (map.length + hold) : map.length;
    const rt = map.toReal(Math.min(pt, map.length));
    const upto = clamp(Math.round(rt / tr.dt), 0, tr.t.length - 1);
    views.forEach((vw, vi) => {
      const x0 = vi * (W / 2), w = W / 2, top = 34, bot = 14;
      const pts = [...tr.head, ...tr.hands, tr.body.C0, [tr.body.xc, 0, tr.body.footZ], [0, 0, 0.1]];
      let minH = Infinity, maxH = -Infinity, minV = 0, maxV = -Infinity;
      for (const p of pts) { const h = vw.h(p), v = vw.v(p); minH = Math.min(minH, h); maxH = Math.max(maxH, h); maxV = Math.max(maxV, v); }
      maxV = Math.max(maxV, 1.9);
      const s = Math.min((w - 20) / (maxH - minH), (H - top - bot) / (maxV - minV));
      const cxm = (minH + maxH) / 2;
      const P = (p) => [x0 + w / 2 + (vw.h(p) - cxm) * s, H - bot - (vw.v(p) - minV) * s];
      // 땅과 공
      ctx.strokeStyle = 'rgba(255,255,255,.18)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0 + 8, H - bot); ctx.lineTo(x0 + w - 8, H - bot); ctx.stroke();
      // 기준 플레인 선(후방)
      if (vw.name === 'dtl') {
        const sh = tr.idealPlane.shaft;
        const a0 = P([0, 0, 0]), a1 = P(scale(sh, -2.1));
        ctx.strokeStyle = 'rgba(212,243,107,.35)';
        ctx.setLineDash([4, 5]);
        ctx.beginPath(); ctx.moveTo(a0[0], a0[1]); ctx.lineTo(a1[0], a1[1]); ctx.stroke();
        ctx.setLineDash([]);
      }
      // 골퍼 윤곽(지금 자세): 몸통·어깨·두 팔·다리
      const ghost = (p, q, wd) => { const A = P(p), Bq = P(q); ctx.lineWidth = wd; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(Bq[0], Bq[1]); ctx.stroke(); };
      ctx.strokeStyle = 'rgba(190,225,255,.26)';
      ctx.lineCap = 'round';
      const b = tr.body;
      const sp = tr.spine ? tr.spine[upto] : b.sp;
      const pc = tr.pelvis ? tr.pelvis[upto] : b.P0;
      const ch = tr.chest ? tr.chest[upto] : b.C0;
      const fin = tr.fin[upto] || 0;
      ghost(pc, ch, 0.2 * s);
      ghost(tr.lead[upto], tr.trail[upto], 0.1 * s);
      ghost(tr.lead[upto], tr.hands[upto], 0.075 * s);
      ghost(tr.trail[upto], tr.hands[upto], 0.075 * s);
      ghost(pc, [b.xc + b.stance, 0.02, b.footZ], 0.11 * s);
      ghost(pc, [b.xc - b.stance + 0.1 * fin, 0.02 + 0.08 * fin, b.footZ], 0.11 * s);
      const hp = P(add(ch, scale(sp, 0.3)));
      ctx.fillStyle = 'rgba(190,225,255,.26)';
      ctx.beginPath(); ctx.arc(hp[0], hp[1], 0.105 * s, 0, Math.PI * 2); ctx.fill();
      // 손 궤적
      ctx.strokeStyle = 'rgba(255,255,255,.28)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i <= upto; i += 2) { const q = P(tr.hands[i]); if (i === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]); }
      ctx.stroke();
      // 머리 궤적(속도 색)
      ctx.lineWidth = 3;
      for (let i = 1; i <= upto; i++) {
        const A = P(tr.head[i - 1]), Bq = P(tr.head[i]);
        const c = speedColor(tr.speed[i] / maxSpd);
        ctx.strokeStyle = `rgb(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0})`;
        ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(Bq[0], Bq[1]); ctx.stroke();
      }
      // 공
      const bp = P([0, 0.0214, 0]);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(bp[0], bp[1], 3.5, 0, Math.PI * 2); ctx.fill();
      // 클럽(지금)
      const hd = P(tr.head[upto]), hn = P(tr.hands[upto]);
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(hn[0], hn[1]); ctx.lineTo(hd[0], hd[1]); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(hd[0], hd[1], 4, 0, Math.PI * 2); ctx.fill();
      // 표시점
      ctx.font = '800 10px "Pretendard Variable", Pretendard, sans-serif';
      for (const [key, lab, col] of [['top', '톱', '#45d6c4'], ['impact', '임팩트', '#ff5a5f'], ['finish', '피니시', '#ffd23a']]) {
        const kf = tr.keyframes[key];
        if (kf.i > upto) continue;
        const q = P(kf.head);
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(q[0], q[1], 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        ctx.fillText(lab, q[0] + 6, q[1] - 5);
      }
    });
    ctx.fillStyle = 'rgba(255,255,255,.1)';
    ctx.fillRect(W / 2, 30, 1, H - 44);
    if (playing) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return {
    play() { if (!playing) { playing = true; t0 = performance.now(); raf = requestAnimationFrame(frame); } },
    pause() { playing = false; },
    dispose() { alive = false; cancelAnimationFrame(raf); }
  };
}

// ---------- 3D 다시보기(큰 화면) ----------
// const rp = createReplay(container, { color }); rp.load(analysis); rp.play();
// 한 캔버스에 위 = 후방(다운 더 라인), 아래 = 정면을 그립니다. 다시 쓰려면 rp.mount(새 부모) 후 rp.load(...).
// setView('both' | 'dtl' | 'face'), pause(), dispose(). ready 는 three.js 를 다 불러오면 풀립니다.
export function createReplay(container, opts = {}) {
  ensureStyles();
  const root = document.createElement('div');
  root.className = 'ga-rp';
  root.innerHTML = `<canvas></canvas>
    <div class="ga-vl" data-v="dtl"><b>후방</b>다운 더 라인</div><div class="ga-live" data-v="dtl">헤드<b>0</b>km/h</div>
    <div class="ga-hr"></div>
    <div class="ga-vl" data-v="face"><b>정면</b>페이스 온</div>
    <div class="ga-tl"><div class="ph">어드레스</div><div class="sp"><u></u>기준 플레인<span style="width:8px"></span>느림<i></i>빠름</div><div class="bar"><div class="fill"></div></div></div>`;
  container.appendChild(root);
  const canvas = root.querySelector('canvas');
  const tl = root.querySelector('.ga-tl');
  const fillEl = tl.querySelector('.fill');
  const phEl = tl.querySelector('.ph');
  const liveEl = root.querySelector('.ga-live b');
  let view = opts.view || 'both';
  let THREE = null;
  let three = null;
  let A = null;
  let color = opts.color || '#ff5a5f';
  let playing = false;
  let raf = 0;
  let t0 = 0;
  let disposed = false;
  let pending = null;
  let lieDeg = 60;
  let pixelScale = 1;
  let lastPt = 0;
  const labels = [];

  function layoutOverlay() {
    const H = root.clientHeight;
    const vls = root.querySelectorAll('.ga-vl');
    const hr = root.querySelector('.ga-hr');
    const live = root.querySelector('.ga-live');
    const tlH = 58;
    const area = H - tlH;
    if (view === 'both') {
      vls[0].style.display = '';
      vls[1].style.display = '';
      vls[0].style.top = '10px';
      vls[1].style.top = `${area / 2 + 8}px`;
      hr.style.display = '';
      hr.style.top = `${area / 2}px`;
    } else {
      vls[0].style.display = view === 'dtl' ? '' : 'none';
      vls[1].style.display = view === 'face' ? '' : 'none';
      vls[0].style.top = '10px';
      vls[1].style.top = '10px';
      hr.style.display = 'none';
    }
    live.style.top = '10px';
  }

  const ready = (async () => {
    THREE = await import('three');
    const { Line2 } = await import('three/addons/lines/Line2.js');
    const { LineGeometry } = await import('three/addons/lines/LineGeometry.js');
    const { LineMaterial } = await import('three/addons/lines/LineMaterial.js');
    if (disposed) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2.6, (window.devicePixelRatio || 1) * pixelScale));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const world = new THREE.Group();
    scene.add(world);
    scene.add(new THREE.HemisphereLight('#d9f0ff', '#1f3a2a', 1.4));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(-2, 5, 3);
    scene.add(sun);

    // 바닥: 잔디 원판 + 25cm 격자 + 가장자리 흐림
    const gc = document.createElement('canvas');
    gc.width = gc.height = 1024;
    {
      const g = gc.getContext('2d');
      const rg = g.createRadialGradient(512, 512, 0, 512, 512, 512);
      rg.addColorStop(0, 'rgba(58,118,72,1)');
      rg.addColorStop(0.55, 'rgba(36,82,52,.92)');
      rg.addColorStop(1, 'rgba(20,48,32,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, 1024, 1024);
      g.globalCompositeOperation = 'source-atop';
      g.strokeStyle = 'rgba(255,255,255,.07)';
      g.lineWidth = 2;
      const step = 1024 / 16; // 4m 지름 → 25cm
      for (let i = 0; i <= 16; i++) {
        g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, 1024); g.stroke();
        g.beginPath(); g.moveTo(0, i * step); g.lineTo(1024, i * step); g.stroke();
      }
      for (let i = 0; i < 2500; i++) {
        g.fillStyle = `rgba(${Math.random() < 0.5 ? '120,190,110' : '20,60,30'},${0.08 + Math.random() * 0.1})`;
        g.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 6);
      }
    }
    const gtex = new THREE.CanvasTexture(gc);
    gtex.colorSpace = THREE.SRGBColorSpace;
    gtex.anisotropy = 8;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshStandardMaterial({ map: gtex, transparent: true, roughness: 1, depthWrite: false }));
    ground.rotation.x = -Math.PI / 2;
    world.add(ground);
    // 목표선
    const tline = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.012), new THREE.MeshBasicMaterial({ color: '#d4f36b', transparent: true, opacity: 0.75, depthWrite: false }));
    tline.rotation.x = -Math.PI / 2;
    tline.position.set(0.95 + 0.06, 0.002, 0);
    world.add(tline);
    const chev = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 3), new THREE.MeshBasicMaterial({ color: '#d4f36b' }));
    chev.rotation.z = -Math.PI / 2;
    chev.position.set(1.96, 0.01, 0);
    world.add(chev);
    // 공
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.028, 24, 16), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, emissive: '#ffffff', emissiveIntensity: 0.25 }));
    ball.position.set(0, 0.028, 0);
    world.add(ball);

    // 홀로그램 재질(가장자리가 밝은 반투명)
    const holo = (col, base = 0.12, rim = 0.75) => new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(col) }, uBase: { value: base }, uRim: { value: rim } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 uColor; uniform float uBase; uniform float uRim; varying vec3 vN; varying vec3 vV; void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); float a = uBase + uRim * pow(f, 2.2); gl_FragColor = vec4(uColor * (0.55 + 0.9 * pow(f, 1.5)), a); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide
    });
    const bodyMat = holo('#9fd8ff', 0.1, 0.8);
    const bodyGroup = new THREE.Group();
    world.add(bodyGroup);
    const Yv = new THREE.Vector3(0, 1, 0);
    const limb = (r, L) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, L), 6, 14), bodyMat);
      m.userData.L = L;
      bodyGroup.add(m);
      return m;
    };
    const placeLimb = (m, p, q) => {
      const a = new THREE.Vector3(...p);
      const b = new THREE.Vector3(...q);
      const dir = b.clone().sub(a);
      const L = dir.length();
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(Yv, dir.normalize());
      m.scale.set(1, L > 1e-4 ? L / (m.userData.L + 1e-6) : 1, 1);
    };
    const ball3 = (r) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), bodyMat);
      bodyGroup.add(m);
      return m;
    };
    const parts = {
      torso: limb(0.12, 0.5), shoulders: limb(0.055, 0.37), hips: limb(0.08, 0.2), neck: limb(0.045, 0.18), head: ball3(0.105),
      leadArm: limb(0.042, 0.62), trailUp: limb(0.044, 0.3), trailLo: limb(0.04, 0.28), hands: ball3(0.045),
      thighL: limb(0.07, 0.48), shinL: limb(0.055, 0.48), thighR: limb(0.07, 0.48), shinR: limb(0.055, 0.48), footL: limb(0.045, 0.19), footR: limb(0.045, 0.19)
    };
    // 클럽
    const clubMat = new THREE.MeshStandardMaterial({ color: '#e8eef2', metalness: 0.7, roughness: 0.3, emissive: '#ffffff', emissiveIntensity: 0.15 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 10), clubMat);
    world.add(shaft);
    const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.045, 0.02), clubMat);
    world.add(headMesh);
    // 임팩트 순간의 클럽 고스트
    const ghostMat = new THREE.MeshBasicMaterial({ color: '#ff5a5f', transparent: true, opacity: 0.55, depthWrite: false });
    const gShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 1, 8), ghostMat);
    const gHead = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.045, 0.02), ghostMat);
    world.add(gShaft, gHead);
    // 나머지 표시점(어드레스·톱·피니시)의 클럽도 흐린 잔상으로 남깁니다.
    const keyClubs = {};
    for (const [k, c, op] of [['address', '#ffffff', 0.3], ['top', '#45d6c4', 0.42], ['finish', '#ffd23a', 0.42]]) {
      const m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, depthWrite: false });
      keyClubs[k] = { shaft: new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 8), m), head: new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.045, 0.02), m) };
      world.add(keyClubs[k].shaft, keyClubs[k].head);
    }
    // 머리 위치 표시
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    world.add(tip);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }));
    world.add(glow);
    // 기준 플레인
    const planeMat = new THREE.MeshBasicMaterial({ color: '#d4f36b', transparent: true, opacity: 0.075, side: THREE.DoubleSide, depthWrite: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), planeMat);
    world.add(plane);
    const planeEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: '#d4f36b', transparent: true, opacity: 0.22 }));
    plane.add(planeEdge);
    // 표시점 구
    const keyMats = { top: '#45d6c4', impact: '#ff5a5f', finish: '#ffd23a' };
    const keyDots = {};
    for (const [k, c] of Object.entries(keyMats)) {
      keyDots[k] = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshBasicMaterial({ color: c }));
      world.add(keyDots[k]);
    }
    // 궤적 선
    // 왼손잡이는 장면을 거울(scale.x = -1)로 뒤집는데, 굵은 선은 그러면 뒷면이 되어 사라지므로 양면으로 그립니다.
    const trailMat = new LineMaterial({ vertexColors: true, linewidth: 4.5, transparent: true, opacity: 0.98, worldUnits: false, toneMapped: false, side: THREE.DoubleSide });
    const handMat = new LineMaterial({ color: '#ffffff', linewidth: 1.6, transparent: true, opacity: 0.32, worldUnits: false, toneMapped: false, side: THREE.DoubleSide });
    let trailLine = null;
    let handLine = null;
    const cams = { dtl: new THREE.PerspectiveCamera(30, 1, 0.05, 50), face: new THREE.PerspectiveCamera(30, 1, 0.05, 50) };

    // HTML 표시 이름(두 화면 x 세 점)
    for (const v of ['dtl', 'face']) {
      for (const [k, lab, c] of [['top', '톱', '#45d6c4'], ['impact', '임팩트', '#ff5a5f'], ['finish', '피니시', '#ffd23a']]) {
        const d = document.createElement('div');
        d.className = 'ga-lab';
        d.innerHTML = `<i style="background:${c}"></i>${lab}`;
        root.appendChild(d);
        labels.push({ v, k, el: d });
      }
    }

    three = {
      renderer, scene, world, parts, placeLimb, shaft, headMesh, gShaft, gHead, keyClubs, tip, glow, plane, keyDots, cams, trailMat, handMat,
      setTrail(a) {
        if (trailLine) { world.remove(trailLine); trailLine.geometry.dispose(); }
        if (handLine) { world.remove(handLine); handLine.geometry.dispose(); }
        const tr = a.trail;
        const pos = [], col = [], hp = [];
        const maxSpd = Math.max(1, tr.speedMax || Math.max(...tr.speed));
        for (let i = 0; i < tr.head.length; i++) {
          pos.push(...tr.head[i]);
          col.push(...speedColor(tr.speed[i] / maxSpd));
          hp.push(...tr.hands[i]);
        }
        const g = new LineGeometry();
        g.setPositions(pos);
        g.setColors(col);
        trailLine = new Line2(g, trailMat);
        trailLine.renderOrder = 5;
        world.add(trailLine);
        const h = new LineGeometry();
        h.setPositions(hp);
        handLine = new Line2(h, handMat);
        world.add(handLine);
        return { trailLine, handLine };
      },
      get trailLine() { return trailLine; },
      get handLine() { return handLine; }
    };
    root.classList.add('ready');
    if (pending) {
      const p = pending;
      pending = null;
      load(p.a, p.o);
    }
  })().catch((e) => { console.warn('스윙 다시보기를 만들지 못했어요', e); });

  function fitCameras() {
    if (!three || !A) return;
    const tr = A.trail;
    const W = root.clientWidth, H = root.clientHeight;
    const tlH = 58;
    const area = Math.max(10, H - tlH);
    const vh = view === 'both' ? area / 2 : area;
    const aspect = W / vh;
    const pts = [...tr.head, ...tr.hands, tr.body.C0, [tr.body.xc + 0.3, 0, tr.body.footZ], [tr.body.xc - 0.3, 0, tr.body.footZ - 0.1], add(tr.body.C0, scale(tr.body.sp, 0.45))];
    const fit = (cam, hAxis, dirSign) => {
      let minH = Infinity, maxH = -Infinity, minV = 0, maxV = -Infinity;
      for (const p of pts) {
        const h = p[hAxis];
        minH = Math.min(minH, h); maxH = Math.max(maxH, h);
        maxV = Math.max(maxV, p[1]);
      }
      const ch = (minH + maxH) / 2, cv = (minV + maxV) / 2;
      const halfH = (maxV - minV) / 2 * 1.16 + 0.12, halfW = (maxH - minH) / 2 * 1.1 + 0.05;
      const t = Math.tan((cam.fov / 2) * RD);
      const dist = Math.max(halfH / t, halfW / (t * aspect));
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
      return { ch, cv, dist, dirSign };
    };
    // 후방: 목표 반대쪽(-x)에서 +x 를 봅니다(왼손잡이는 거울이라 +x 쪽에서).
    const mir = A.handedness === 'left' ? -1 : 1;
    // 카메라를 손 높이보다 조금 위, 공 쪽으로 조금 비켜 두면 플레인이 얇은 면으로 보여 궤적의 안팎이 드러납니다.
    const fd = fit(three.cams.dtl, 2);
    const depthD = tr.body.xc;
    three.cams.dtl.position.set(mir * (depthD - fd.dist - 0.6), fd.cv + 0.32, fd.ch + 0.42);
    three.cams.dtl.lookAt(mir * depthD, fd.cv + 0.06, fd.ch);
    // 정면: 공 쪽(+z)에서 골퍼를 봅니다.
    const ff = fit(three.cams.face, 0);
    const zc = tr.body.C0[2] * 0.5;
    three.cams.face.position.set(mir * ff.ch, ff.cv + 0.05, zc + ff.dist + 0.5);
    three.cams.face.lookAt(mir * ff.ch, ff.cv, zc);
  }

  function resize() {
    if (!three) return;
    const W = root.clientWidth, H = root.clientHeight;
    if (!W || !H) return;
    three.renderer.setSize(W, H, false);
    layoutOverlay();
    fitCameras();
    // 멈춰 있을 때는 크기를 바꾸면 그림이 지워지므로 마지막 장면을 다시 그립니다.
    if (!playing && A) renderAt(lastPt);
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  if (ro) ro.observe(root);

  function load(a, o = {}) {
    if (!a || !a.ok) return;
    if (o.color) color = o.color;
    if (!three) {
      pending = { a, o };
      A = a;
      return;
    }
    A = a;
    const tr = a.trail;
    lieDeg = (CLUB_SPECS[a.club] || CLUB_SPECS['7i']).plane + 2;
    three.world.scale.x = a.handedness === 'left' ? -1 : 1;
    three.setTrail(a);
    // 기준 플레인 사각형: 공에서 목표선 방향 ±1.5m, 샤프트를 따라 위로 2m
    const ip = tr.idealPlane;
    const up = scale(ip.shaft, -1);
    const X = [1, 0, 0];
    const nrm = norm(cross(X, up));
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...X), new THREE.Vector3(...up), new THREE.Vector3(...nrm));
    three.plane.quaternion.setFromRotationMatrix(m);
    three.plane.scale.set(3.0, 2.1, 1);
    three.plane.position.set(...add([0.2, 0.0, 0], scale(up, 1.05)));
    // 클럽 머리 모양
    const wood = a.kind === 'wood' || a.kind === 'hybrid';
    for (const h of [three.headMesh, three.gHead, ...Object.values(three.keyClubs).map((c) => c.head)]) {
      h.geometry.dispose();
      h.geometry = wood ? new THREE.SphereGeometry(1, 20, 12) : new THREE.BoxGeometry(0.08, 0.045, 0.02);
      h.scale.set(...(wood ? (a.kind === 'wood' && a.club === '1w' ? [0.06, 0.03, 0.055] : [0.05, 0.025, 0.045]) : [1, 1, 1]));
    }
    for (const [k, d] of Object.entries(three.keyDots)) d.position.set(...tr.keyframes[k].head);
    placeClub(three.gShaft, three.gHead, tr.keyframes.impact.hands, tr.keyframes.impact.head, tr.keyframes.impact.face);
    for (const [k, c] of Object.entries(three.keyClubs)) {
      const kf = tr.keyframes[k];
      placeClub(c.shaft, c.head, kf.hands, kf.head, tr.face[kf.i]);
    }
    t0 = performance.now();
    resize();
    renderAt(0);
  }

  function placeClub(sh, hd, hands, head, face) {
    const a = new THREE.Vector3(...hands);
    const b = new THREE.Vector3(...head);
    const dir = b.clone().sub(a);
    const L = dir.length();
    sh.position.copy(a).add(b).multiplyScalar(0.5);
    sh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    sh.scale.set(1, L, 1);
    // 머리: z = 페이스 방향, x = 힐→토(샤프트를 라이각만큼 페이스 둘레로 눕힌 방향), y = 위
    const s = dir.clone().normalize();
    const z = new THREE.Vector3(...(face || [1, 0, 0]));
    z.addScaledVector(s, -z.dot(s)).normalize();
    const lie = lieDeg * RD;
    const toe = s.clone().multiplyScalar(Math.cos(lie)).addScaledVector(new THREE.Vector3().crossVectors(z, s), -Math.sin(lie)).normalize();
    const x = toe.clone().negate();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    hd.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    hd.position.copy(b).addScaledVector(toe, 0.025);
  }

  // 두 뼈 IK: 시작 a, 끝 c, 길이 l1·l2, 굽는 쪽 pole
  function ik(a, c, l1, l2, pole) {
    const ac = sub(c, a);
    const d = clamp(vlen(ac), 0.05, l1 + l2 - 1e-4);
    const dir = norm(ac);
    const x = (d * d + l1 * l1 - l2 * l2) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    let pv = sub(pole, scale(dir, dot(pole, dir)));
    if (vlen(pv) < 1e-6) pv = [0, -1, 0];
    pv = norm(pv);
    return add(add(a, scale(dir, x)), scale(pv, h));
  }

  function poseBody(i) {
    const tr = A.trail;
    const b = tr.body;
    const P = three.parts;
    const tau = tr.tau[i] * RD;
    const pel = tr.pel[i] * RD;
    const fin = tr.fin[i];
    const S = tr.lead[i], Tt = tr.trail[i], H = tr.hands[i];
    // 골반·가슴·척추는 분석 모델 값(피니시로 가며 허리를 폄)을 그대로 씁니다.
    const sp = tr.spine ? tr.spine[i] : b.sp;
    const pc = tr.pelvis ? tr.pelvis[i] : b.P0;
    const chest = tr.chest ? tr.chest[i] : b.C0;
    const hipAxis = rotAxis(norm(sub([1, 0, 0], scale(sp, sp[0]))), sp, pel);
    const hipL = add(pc, scale(hipAxis, 0.1));
    const hipR = add(pc, scale(hipAxis, -0.1));
    P.torso && three.placeLimb(P.torso, pc, chest);
    three.placeLimb(P.hips, hipL, hipR);
    three.placeLimb(P.shoulders, S, Tt);
    const neckB = add(chest, scale(sp, 0.12));
    // 머리는 공을 보다가, 피니시에서 목표 쪽으로 돌아봅니다.
    const headC = add(chest, add(scale(sp, 0.3), [0.03 * fin, 0, -0.04 * fin]));
    three.placeLimb(P.neck, neckB, headC);
    P.head.position.set(...headC);
    three.placeLimb(P.leadArm, S, H);
    const elbow = ik(Tt, H, 0.3, 0.28, rotAxis([-0.15, -0.8, -0.35], sp, tau));
    three.placeLimb(P.trailUp, Tt, elbow);
    three.placeLimb(P.trailLo, elbow, H);
    P.hands.position.set(...H);
    // 다리: 발은 그대로, 피니시에서 오른발 뒤꿈치가 들립니다.
    const footL = [b.xc + b.stance, 0.07, b.footZ];
    const footR = [b.xc - b.stance + 0.1 * fin, 0.07 + 0.09 * fin, b.footZ + 0.02 * fin];
    const kneeL = ik(hipL, footL, 0.48, 0.48, [0.05, 0, 1]);
    const kneeR = ik(hipR, footR, 0.48, 0.48, [0.2 + 0.6 * fin, 0, 1]);
    three.placeLimb(P.thighL, hipL, kneeL);
    three.placeLimb(P.shinL, kneeL, footL);
    three.placeLimb(P.thighR, hipR, kneeR);
    three.placeLimb(P.shinR, kneeR, footR);
    three.placeLimb(P.footL, add(footL, [0, -0.04, -0.03]), add(footL, [0.03, -0.04, 0.15]));
    three.placeLimb(P.footR, add(footR, [0, -0.04 - 0.05 * fin, -0.03]), add(footR, [0.03 + 0.04 * fin, -0.06 - 0.03 * fin, 0.15 - 0.03 * fin]));
  }

  function renderAt(pt) {
    if (!three || !A) return;
    lastPt = pt;
    const tr = A.trail;
    const T = tr.times;
    const map = playbackMap(T);
    const rt = map.toReal(Math.min(pt, map.length));
    const i = clamp(Math.round(rt / tr.dt), 0, tr.t.length - 1);
    poseBody(i);
    placeClub(three.shaft, three.headMesh, tr.hands[i], tr.head[i], tr.face[i]);
    three.tip.position.set(...tr.head[i]);
    three.glow.position.set(...tr.head[i]);
    if (three.trailLine) three.trailLine.geometry.instanceCount = Math.max(0, i);
    if (three.handLine) three.handLine.geometry.instanceCount = Math.max(0, i);
    const after = (k) => i >= tr.keyframes[k].i;
    for (const k of ['top', 'impact', 'finish']) three.keyDots[k].visible = after(k);
    three.gShaft.visible = three.gHead.visible = after('impact');
    // 잔상은 그 순간을 지난 뒤에만(지금 클럽과 겹치는 바로 그 순간은 빼고)
    for (const [k, c] of Object.entries(three.keyClubs)) c.shaft.visible = c.head.visible = i > tr.keyframes[k].i + 6 && !(k === 'finish' && i >= tr.t.length - 1);
    const maxSpd = Math.max(1, tr.speedMax || Math.max(...tr.speed));
    const c = speedColor(tr.speed[i] / maxSpd);
    three.glow.material.color.setRGB(c[0], c[1], c[2]);
    // 타임라인
    fillEl.style.width = `${((pt / map.length) * 100).toFixed(1)}%`;
    phEl.textContent = phaseName(rt, T);
    liveEl.textContent = Math.round(tr.speed[i]);
    if (tl.dataset.for !== String(A.id) + A.score) {
      tl.dataset.for = String(A.id) + A.score;
      for (const e of tl.querySelectorAll('.tick,.tk')) e.remove();
      for (const [k, lab] of [['address', '어드레스'], ['top', '톱'], ['impact', '임팩트'], ['finish', '피니시']]) {
        const x = (map.toPlay(T[k]) / map.length) * 100;
        const tk = document.createElement('div');
        tk.className = 'tick';
        tk.style.left = `${x}%`;
        const tx = document.createElement('div');
        tx.className = 'tk';
        tx.dataset.k = k;
        tx.style.left = `${clamp(x, 4, 95)}%`;
        tx.textContent = lab;
        tl.append(tk, tx);
      }
    }
    for (const tx of tl.querySelectorAll('.tk')) tx.classList.toggle('on', rt >= T[tx.dataset.k] - 0.001);
    // 그리기(두 화면)
    const r = three.renderer;
    const W = root.clientWidth, H = root.clientHeight;
    if (!W || !H) return;
    const area = H - 58;
    const vp = view === 'both'
      ? [['dtl', 0, area / 2, area / 2], ['face', 0, 0, area / 2]]
      : [[view, 0, 0, area]];
    r.setScissorTest(true);
    r.setViewport(0, 0, W, H);
    r.setScissor(0, 0, W, H);
    r.clear();
    for (const [name, x, yBottom, h] of vp) {
      const y = yBottom + 58;
      r.setViewport(x, y, W, h);
      r.setScissor(x, y, W, h);
      three.trailMat.resolution.set(W, h);
      three.handMat.resolution.set(W, h);
      // 기준 플레인은 옆에서 얇게 보이는 후방에서만 보여 줍니다.
      three.plane.visible = name === 'dtl';
      r.render(three.scene, three.cams[name]);
      // 표시 이름 위치
      for (const L of labels) {
        if (L.v !== name) continue;
        const kf = tr.keyframes[L.k];
        const v = new THREE.Vector3(...kf.head);
        if (A.handedness === 'left') v.x = -v.x;
        v.project(three.cams[name]);
        const sx = ((v.x + 1) / 2) * W;
        const sy = H - (y + ((v.y + 1) / 2) * h);
        L.el.style.left = `${sx.toFixed(1)}px`;
        L.el.style.top = `${sy.toFixed(1)}px`;
        L.el.classList.toggle('on', after(L.k) && sx > 10 && sx < W - 10 && sy > H - y - h + 8);
      }
    }
    for (const L of labels) if (!vp.some(([n]) => n === L.v)) L.el.classList.remove('on');
    r.setScissorTest(false);
  }

  function loop(now) {
    if (disposed || !playing) return;
    if (root.isConnected && A && three) {
      const map = playbackMap(A.trail.times);
      const hold = 1.6;
      const pt = ((now - t0) / 1000) % (map.length + hold);
      renderAt(Math.min(pt, map.length));
    }
    raf = requestAnimationFrame(loop);
  }

  const api = {
    root,
    ready,
    get canvas() { return canvas; },
    load,
    play() {
      if (playing) return;
      playing = true;
      t0 = performance.now();
      raf = requestAnimationFrame(loop);
    },
    pause() {
      playing = false;
      cancelAnimationFrame(raf);
    },
    // 고정 장면(스크린샷·시험): 0..1 사이 진행 정도
    seek(frac) {
      if (!A) return;
      const map = playbackMap(A.trail.times);
      renderAt(clamp(frac, 0, 1) * map.length);
    },
    // 'address' | 'top' | 'impact' | 'finish' 순간으로
    seekTo(key) {
      if (!A) return;
      const map = playbackMap(A.trail.times);
      renderAt(map.toPlay(A.trail.times[key] ?? 0) + 1e-4);
    },
    setView(v) {
      view = v === 'dtl' || v === 'face' ? v : 'both';
      layoutOverlay();
      fitCameras();
    },
    mount(parent) {
      parent.appendChild(root);
      requestAnimationFrame(resize);
    },
    resize,
    // 패널을 CSS 로 키웠을 때 흐려지지 않게 그리는 배율을 올립니다.
    setPixelScale(k) {
      pixelScale = clamp(k || 1, 1, 2);
      if (three) {
        three.renderer.setPixelRatio(Math.min(2.6, (window.devicePixelRatio || 1) * pixelScale));
        resize();
      }
    },
    dispose() {
      disposed = true;
      playing = false;
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      if (three) {
        three.scene.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
        });
        three.trailMat.dispose();
        three.handMat.dispose();
        three.renderer.dispose();
        three.renderer.forceContextLoss();
      }
      root.remove();
    }
  };
  layoutOverlay();
  return api;
}
