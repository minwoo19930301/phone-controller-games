// 로봇 검투 모드: 선수마다 자기 칸(스테이션)에서 로봇 검객 한 대와 1:1 로 싸웁니다.
//
// 흐름: 로봇이 칼을 들어 올리며(예고) 어느 쪽으로 벨지 빛 줄과 화면 화살표·폰 글자로 보여 줍니다 → 휙 벱니다(슬로우)
//   → 맞는 쪽으로 칼을 대고 있었으면(막기) 칼끼리 부딪혀 불꽃·번쩍·진동, 로봇이 비틀거립니다(빈틈)
//   → 빈틈 동안 휘두르면(베기) 로봇 체력이 깎입니다. 못 막으면 내 체력이 깎입니다.
// 판정은 큰 방향만 봅니다(칼끝이 왼쪽/오른쪽으로 기울었나, 눕혔나, 세웠나, 휘둘렀나). 정확한 각도는 조금만 봅니다.
// 시간 창·로봇 속도·연속 공격·체력은 난이도(DUEL_LEVEL)로 정합니다. 로봇 동작은 경기 시간(슬로우 반영), 판정 창은 실제 시간(ms)입니다.
import * as THREE from 'three';
import { makeRobot, makeTelegraph, POSES, ROBOT_Z, R_BLADE, R_HILT, copyPose, mixPose, pose as mkPose } from './robot.js';
import { HILT, ENEMY } from './models.js';

// 난이도별 값. side/over/center = 칼 기울기(도) 기준, pre/post = 칠 때 앞뒤로 인정하는 시간(ms), hold = 그 안에서 버텨야 하는 시간(ms)
export const DUEL_LEVEL = {
  easy: {
    tel: 1.45, telCombo: 0.95, swing: 0.24, gap: [1.7, 2.6], combos: [1, 1, 1, 2], kinds: { left: 4, right: 4, overhead: 1, thrust: 0 },
    side: 6, over: 38, center: 52, hold: 0, pre: 600, post: 250, swingParry: 'any',
    open: 2.0, maxHits: 3, robotHp: 100, dmgIn: 8, dmgOut: 20, strikeMin: 200, slow: 0.4, botFail: 0.05
  },
  normal: {
    tel: 1.05, telCombo: 0.72, swing: 0.21, gap: [1.1, 1.8], combos: [1, 1, 2, 2], kinds: { left: 3, right: 3, overhead: 2, thrust: 1 },
    side: 15, over: 50, center: 38, hold: 45, pre: 400, post: 150, swingParry: 'zone',
    open: 1.45, maxHits: 3, robotHp: 100, dmgIn: 12, dmgOut: 15, strikeMin: 260, slow: 0.5, botFail: 0.1
  },
  hard: {
    tel: 0.74, telCombo: 0.48, swing: 0.18, gap: [0.6, 1.25], combos: [1, 2, 2, 3], kinds: { left: 3, right: 3, overhead: 2, thrust: 2 },
    side: 26, over: 60, center: 0, hold: 110, pre: 240, post: 90, swingParry: 'thrust', chainParry: true,
    open: 0.95, maxHits: 2, robotHp: 120, dmgIn: 16, dmgOut: 12, strikeMin: 320, slow: 0.62, botFail: 0.16
  }
};
export const KIND_TEXT = {
  left: { main: '왼쪽 막기', sub: '칼끝을 왼쪽으로' },
  right: { main: '오른쪽 막기', sub: '칼끝을 오른쪽으로' },
  overhead: { main: '위 막기', sub: '칼을 옆으로 눕혀요' },
  thrust: { main: '찌르기', sub: '칼을 세우거나 휘둘러 쳐내요' }
};
const ROBOT_NAMES = ['KR-07', 'KR-12', 'KR-21', 'KR-33'];
const PARRY_PTS = 20;
const STRIKE_PTS = 25;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const rand = (a, b) => a + Math.random() * (b - a);
const easeIO = (u) => u * u * (3 - 2 * u);
const easeOut = (u) => 1 - (1 - u) * (1 - u);
const easeIn = (u) => u * u * u;
const V = () => new THREE.Vector3();
const DEG = 180 / Math.PI;

// 선수 칼 방향(세계 단위 벡터) → 앞에서 본 기울기 th(도, 0 = 위, - 왼쪽, + 오른쪽)와 위쪽 성분 up
export function bladeAngles(s) {
  return { th: Math.atan2(s.x, s.y) * DEG, up: s.y };
}
/** 막기 자세가 맞는지. k(0~1)는 기준을 그만큼 느슨하게 */
export function zoneOk(kind, th, up, L, k = 1) {
  if (kind === 'left') return th <= -L.side * k;
  if (kind === 'right') return th >= L.side * k;
  if (kind === 'overhead') return Math.abs(th) >= L.over * k;
  if (kind === 'thrust') return L.center > 0 && Math.abs(th) <= L.center / k && up > 0.2;
  return false;
}
// 봇이 막을 때 칼 방향(세계)
const BOT_DIR = {
  left: new THREE.Vector3(-0.72, 0.68, -0.15).normalize(),
  right: new THREE.Vector3(0.72, 0.68, -0.15).normalize(),
  overhead: new THREE.Vector3(-0.96, 0.2, -0.2).normalize(),
  thrust: new THREE.Vector3(0.06, 0.92, -0.38).normalize(),
  idle: new THREE.Vector3(0.2, 0.86, -0.46).normalize()
};

// 두 선분 사이 가장 가까운 두 점(불꽃 위치)
const _u = V();
const _v = V();
const _w = V();
function closest(p1, q1, p2, q2, c1, c2) {
  _u.subVectors(q1, p1);
  _v.subVectors(q2, p2);
  _w.subVectors(p1, p2);
  const a = _u.dot(_u);
  const b = _u.dot(_v);
  const c = _v.dot(_v);
  const d = _u.dot(_w);
  const e = _v.dot(_w);
  const den = a * c - b * b;
  let s = den > 1e-9 ? clamp((b * e - c * d) / den, 0, 1) : 0;
  const t = c > 1e-9 ? clamp((b * s + e) / c, 0, 1) : 0;
  s = a > 1e-9 ? clamp((b * t - d) / a, 0, 1) : 0;
  c1.copy(p1).addScaledVector(_u, s);
  c2.copy(p2).addScaledVector(_v, t);
  return c1.distanceTo(c2);
}

/**
 * ctx: {
 *   view, sfx, send(event, data, slot), level(P) → 'easy'|'normal'|'hard', elapsed() → 경기 초,
 *   hudCall(P, main, sub, cls, ms), hudToast(P, main, sub, cls), hudNote(P, text, ms), hudHurt(P), hudFx(P, kind, data),
 *   knockDown(P, now), pushState(force), poseLag(P) → ms, setBotDir(P, worldDir), botSwing(P, speed), live() → bool
 * }
 */
export function createDuel(ctx) {
  const { view, sfx } = ctx;
  const robots = [];
  const tels = [];
  function acquire() {
    let R = robots.find((r) => !r.busy);
    if (!R) {
      R = makeRobot();
      R.addTo(view.scene);
      robots.push(R);
    }
    R.busy = true;
    R.setVisible(true);
    return R;
  }
  function acquireTel() {
    let T = tels.find((t) => !t.busy);
    if (!T) {
      T = makeTelegraph();
      view.scene.add(T.mesh);
      tels.push(T);
    }
    T.busy = true;
    return T;
  }

  const L = (P) => DUEL_LEVEL[P.duel ? P.duel.level : ctx.level(P)] || DUEL_LEVEL.normal;

  // ---------- 준비 ----------
  function setup(P, o = {}) {
    clear(P);
    const level = ctx.level(P);
    const lv = DUEL_LEVEL[level] || DUEL_LEVEL.normal;
    const R = acquire();
    const tel = acquireTel();
    R.state.power = 0;
    R.state.trailInit = false;
    R.root.position.set(P.sx, 0, ROBOT_Z - (o.walk === false ? 0 : 2.8));
    const D = {
      R, tel, level, hp: lv.robotHp, max: lv.robotHp, hpShown: lv.robotHp, name: ROBOT_NAMES[P.station] || 'KR-00',
      state: o.walk === false ? 'guard' : 'enter', t: 0, dur: o.walk === false ? 1.2 : 2.3, kind: null, attackId: 0, comboLeft: 0, comboN: 0,
      pose: copyPose(o.walk === false ? POSES.guard : POSES.carry), out: copyPose(POSES.guard), anim: null, impact: null,
      powerT: o.walk === false ? 1 : 0, hurtK: 0, hurtSide: 1, shake: 0, eyeFlash: 0, coreK: 0, stopUntil: 0,
      hist: [], lastPoseAt: 0, impactReal: 0, openStartReal: 0, openUntilG: 0, hits: 0, lastBlockAt: 0, blockHints: 0,
      lastKinds: [], telA: 0, telProg: 0, walkPh: 0, downAt: 0, downT: 0, result: null, botPlan: null, botSwings: 0, botNextSwing: 0,
      lastSpark: 0, stagger: 'left', strikeT: 0
    };
    P.duel = D;
    P.parries = 0;
    P.strikes = 0;
    R.apply(D.pose, 1 / 60);
    if (o.walk === false) R.state.power = 1;
    return D;
  }
  function clear(P) {
    const D = P.duel;
    if (!D) return;
    D.R.busy = false;
    D.R.setVisible(false);
    D.tel.busy = false;
    D.tel.hide();
    P.duel = null;
  }
  function to(D, target, dur, ease = easeIO) {
    D.anim = { from: copyPose(D.pose), to: target, t: 0, dur: Math.max(0.001, dur), ease };
  }

  // ---------- 공격 고르기 ----------
  function pickKind(D, lv) {
    const entries = Object.entries(lv.kinds).filter(([, w]) => w > 0);
    for (let tries = 0; tries < 6; tries++) {
      let r = Math.random() * entries.reduce((a, [, w]) => a + w, 0);
      let k = entries[0][0];
      for (const [name, w] of entries) {
        r -= w;
        if (r <= 0) {
          k = name;
          break;
        }
      }
      // 같은 쪽이 세 번 연속 나오지 않게
      const l = D.lastKinds;
      if (l.length >= 2 && l[l.length - 1] === k && l[l.length - 2] === k) continue;
      l.push(k);
      if (l.length > 4) l.shift();
      return k;
    }
    return 'left';
  }
  function startAttack(P, D, now, combo) {
    const lv = L(P);
    if (!combo) {
      const n = lv.combos[Math.floor(Math.random() * lv.combos.length)];
      // 체력이 반 아래로 떨어지면 연속 공격이 한 번 더 늘 수 있습니다.
      D.comboLeft = n - 1 + (D.hp < D.max * 0.5 && Math.random() < 0.35 && lv.combos[lv.combos.length - 1] > 1 ? 1 : 0);
      D.comboN = 0;
    } else {
      D.comboLeft -= 1;
      D.comboN += 1;
    }
    D.kind = pickKind(D, lv);
    D.attackId += 1;
    // 다칠수록 조금 빨라집니다.
    const speed = 0.84 + 0.16 * (D.hp / D.max);
    const dur = (combo ? lv.telCombo : lv.tel) * speed;
    D.state = 'windup';
    D.t = 0;
    D.dur = dur;
    to(D, POSES.wind[D.kind], dur * 0.72, easeOut);
    D.eyeFlash = 1;
    D.telA = 0;
    if (!P.demo) {
      sfx.windup(D.kind);
      const ms = Math.round((dur + lv.swing / lv.slow) * 1000);
      ctx.send('cue', { kind: 'duel', dir: D.kind, ms, n: D.comboN, of: D.comboN + D.comboLeft + 1 }, P.slot);
    }
  }

  // ---------- 판정 ----------
  function sampleAt(D, t) {
    let best = null;
    for (const s of D.hist) {
      if (s.t <= t) best = s;
      else break;
    }
    return best || D.hist[D.hist.length - 1] || null;
  }
  function parried(P, D) {
    const lv = L(P);
    const from = D.impactReal - lv.pre;
    const until = D.impactReal + lv.post;
    // 1) 막는 자세
    let run = 0;
    let best = -1;
    let prev = null;
    for (const s of D.hist) {
      if (s.t < from - 40 || s.t > until) {
        prev = null;
        continue;
      }
      if (zoneOk(D.kind, s.th, s.up, lv)) {
        run = prev ? run + (s.t - prev.t) : 0;
        best = Math.max(best, run);
        prev = s;
      } else {
        run = 0;
        prev = null;
      }
    }
    if (best >= lv.hold) return 'block';
    // 2) 휘둘러 쳐내기
    for (const sw of P.swings) {
      if (sw.used || sw.real < from || sw.real > until + 60 || sw.speed < lv.strikeMin * 0.8) continue;
      let ok = lv.swingParry === 'any' || D.kind === 'thrust';
      if (!ok && lv.swingParry === 'zone') {
        const s = sampleAt(D, sw.real + 110);
        ok = Boolean(s && zoneOk(D.kind, s.th, s.up, lv, 0.5));
      }
      if (ok) {
        sw.used = true;
        return 'swing';
      }
    }
    return null;
  }

  // 막을 때: 로봇 칼이 내 칼의 가운데쯤을 지나가게 칠 자세를 고칩니다(칼끼리 실제로 엇갈려 보이게).
  const _C = V();
  const _g = V();
  const _dd = V();
  function aimContact(P, D) {
    const lv = L(P);
    const s = D.hist[D.hist.length - 1];
    const base = POSES.hit[D.kind];
    const imp = D.impact;
    for (const k of ['pel', 'pr', 'sp', 'ch', 'hd', 'g', 'd', 'fl', 'fr']) for (let i = 0; i < base[k].length; i++) imp[k][i] = base[k][i];
    if (!s || !zoneOk(D.kind, s.th, s.up, lv, 0.6) || !P.tip || P.ign < 0.5) return;
    _C.lerpVectors(P.emitter, P.tip, D.kind === 'thrust' ? 0.42 : 0.55).sub(D.R.root.position);
    _C.x = clamp(_C.x, -0.75, 0.75);
    _C.y = clamp(_C.y, 1.0, 2.05);
    _C.z = clamp(_C.z, 0.62, 1.25);
    _dd.set(base.d[0], base.d[1], base.d[2]).normalize();
    const reach = HILT.emitter * R_HILT + R_BLADE * 0.5;
    _g.copy(_C).addScaledVector(_dd, -reach);
    _g.x = clamp(_g.x, -0.28, 0.28);
    _g.y = clamp(_g.y, 1.05, 1.62);
    _g.z = clamp(_g.z, 0.26, 0.6);
    _dd.subVectors(_C, _g).normalize();
    imp.g[0] = _g.x;
    imp.g[1] = _g.y;
    imp.g[2] = _g.z;
    imp.d[0] = _dd.x;
    imp.d[1] = _dd.y;
    imp.d[2] = _dd.z;
  }

  const _c1 = V();
  const _c2 = V();
  const _sp = V();
  function clashPoint(P, D, out) {
    const R = D.R;
    if (P.tip && P.ign > 0.5) {
      closest(R.w.emitter, R.w.tip, P.emitter, P.tip, _c1, _c2);
      return out.copy(_c1).lerp(_c2, 0.5);
    }
    return out.copy(R.w.emitter).lerp(R.w.tip, 0.6);
  }

  function onParry(P, D, now, how) {
    const lv = L(P);
    D.attackDone = true;
    const C = clashPoint(P, D, _sp);
    const big = !P.demo;
    view.sparks.emit(C, big ? 80 : 30, { color: '#ffffff', color2: ENEMY, speed: 4.6, life: 0.6, size: 0.032, hot: 3.6, gravity: 4 });
    view.sparks.emit(C, big ? 40 : 14, { color: '#ffffff', color2: P.color, speed: 3, life: 0.45, size: 0.026, hot: 3.2 });
    view.flash(C, '#ffffff', big ? 0.9 : 0.5, 0.18, 'glow', 5);
    view.flash(C, ENEMY, 0.35, 0.32, 'ring', 3);
    view.flash(C, P.color, 0.55, 0.42, 'ring', 2.6);
    D.shake = 1;
    D.telA = 0;
    if (P.demo) {
      D.stopUntil = now + 60;
    } else {
      D.stopUntil = now + 150;
      P.parries += 1;
      P.score += PARRY_PTS;
      P.streak += 1;
      P.bestStreak = Math.max(P.bestStreak, P.streak);
      P.shake = Math.max(P.shake, 0.5);
      sfx.clash(true);
      ctx.hudFx(P, 'clash');
      ctx.hudCall(P, how === 'swing' ? '쳐냈다!' : '막았다!', `+${PARRY_PTS}`, 'good', 700);
      ctx.send('hit', { kind: 'parry' }, P.slot);
      ctx.pushState();
    }
    // 어려움: 연속 공격 중에는 막아도 다음 공격이 이어집니다(마지막 것을 막아야 빈틈).
    if (lv.chainParry && D.comboLeft > 0) {
      D.state = 'recoil';
      D.t = 0;
      D.dur = 0.22;
      to(D, POSES.wind[D.kind], 0.2, easeOut);
      return;
    }
    // 비틀거림(빈틈)
    D.state = 'stagger';
    D.t = 0;
    D.stagger = D.kind === 'right' ? 'right' : D.kind === 'left' ? 'left' : Math.random() < 0.5 ? 'left' : 'right';
    to(D, POSES.stagger[D.stagger], 0.24, easeOut);
    D.openUntilG = P.clock.gt + lv.open;
    D.openStartReal = now;
    D.hits = 0;
    D.comboLeft = 0;
    // '지금 베기!' 는 HUD 의 빈틈 표시(hudState.openK)가 맡습니다. 폰에도 알립니다.
    if (!P.demo) ctx.send('cue', { kind: 'open', ms: Math.round(lv.open * 1000) }, P.slot);
  }

  function onHurt(P, D, now) {
    const lv = L(P);
    D.attackDone = true;
    D.state = 'follow';
    D.t = 0;
    D.dur = 0.34;
    to(D, POSES.follow[D.kind], 0.26, easeOut);
    D.telA = 0;
    if (P.demo) return;
    P.hp = Math.max(0, P.hp - lv.dmgIn);
    P.hurts += 1;
    P.streak = 0;
    P.shake = 1;
    sfx.hurt();
    ctx.hudHurt(P);
    ctx.send('hit', { kind: 'hurt' }, P.slot);
    if (P.hp <= 0 && !P.down) {
      ctx.knockDown(P, now);
      D.state = 'victory';
      D.comboLeft = 0;
      to(D, POSES.victory, 0.9);
      sfx.lose();
    } else {
      ctx.hudCall(P, '베였어요', `체력 ${Math.ceil(P.hp)}`, 'bad', 700);
    }
    ctx.pushState();
  }

  const _hp = V();
  function onStrike(P, D, sw, now) {
    const lv = L(P);
    D.hits += 1;
    const sp = clamp((sw.speed - 300) / 900, 0, 1);
    const mult = [1, 1.1, 1.25][Math.min(2, D.hits - 1)];
    const dmg = Math.round(lv.dmgOut * (0.85 + 0.3 * sp) * mult);
    D.hp = Math.max(0, D.hp - dmg);
    D.hurtK = 1;
    D.hurtSide = Math.random() < 0.5 ? -1 : 1;
    D.coreK = 1;
    // 맞은 곳: 가슴 앞, 휘두른 방향에 따라 조금씩 다르게
    D.R.bodyPoint(_hp.set(D.hurtSide * rand(0.03, 0.14), rand(0.05, 0.26), 0.16), _sp);
    const big = !P.demo;
    view.sparks.emit(_sp, big ? 70 : 24, { color: '#fff4d6', color2: '#ff7a2a', speed: 3.6, life: 0.7, size: 0.035, hot: 3.4, gravity: 5 });
    view.sparks.emit(_sp, big ? 30 : 10, { color: '#ffffff', color2: P.color, speed: 2.4, life: 0.5, size: 0.03, hot: 3 });
    view.flash(_sp, '#ffffff', 0.7, 0.16, 'glow', 4.5);
    view.flash(_sp, P.color, 0.5, 0.4, 'ring', 2.6);
    if (!P.demo) {
      P.strikes += 1;
      const pts = STRIKE_PTS + 10 * (D.hits - 1);
      P.score += pts;
      P.streak += 1;
      P.bestStreak = Math.max(P.bestStreak, P.streak);
      sfx.slash(D.hits);
      ctx.hudFx(P, 'dmg', { dmg, hits: D.hits });
      ctx.hudCall(P, D.hits >= 2 ? `${D.hits}연타!` : '베기!', `+${pts}`, D.hits >= 2 ? 'streak' : 'good', 650);
      ctx.send('hit', { kind: 'strike', n: D.hits }, P.slot);
    }
    if (D.hp <= 0) {
      defeat(P, D, now);
      return;
    }
    if (D.hits >= lv.maxHits) D.openUntilG = Math.min(D.openUntilG, P.clock.gt + 0.28);
    if (!P.demo) ctx.pushState();
  }

  function defeat(P, D, now) {
    D.state = 'down';
    D.t = 0;
    D.downAt = now;
    D.telA = 0;
    D.comboLeft = 0;
    to(D, POSES.down, 1.4, easeOut);
    if (P.demo) return;
    const left = Math.max(0, ctx.timeLeft());
    P.result = 'win';
    P.winAt = ctx.elapsed();
    const bonus = 300 + left * 4 + Math.ceil(P.hp) * 2;
    P.score += bonus;
    sfx.robotDown();
    ctx.onWin(P, bonus);
    ctx.send('hit', { kind: 'win' }, P.slot);
    ctx.pushState(true);
  }

  function robotBlocks(P, D, now) {
    D.lastBlockAt = now;
    const side = Math.random() < 0.5 ? 'left' : 'right';
    D.state = 'block';
    D.t = 0;
    D.dur = 0.36;
    to(D, POSES.block[side], 0.1, easeOut);
    const R = D.R;
    _sp.copy(R.w.emitter).lerp(R.w.tip, 0.35);
    view.sparks.emit(_sp, P.demo ? 10 : 26, { color: '#ffffff', color2: ENEMY, speed: 2.6, life: 0.4, size: 0.026, hot: 3 });
    view.flash(_sp, '#ffffff', 0.4, 0.12, 'glow', 3.5);
    if (P.demo) return;
    sfx.deflect(false);
    ctx.send('hit', { kind: 'blocked' }, P.slot);
    if (D.blockHints < 3) {
      D.blockHints += 1;
      ctx.hudNote(P, '로봇이 막았어요 · 먼저 막고, 비틀거릴 때 베요', 2200);
    } else ctx.hudCall(P, '막혔어요', '', 'bad', 500);
  }

  // ---------- 매 프레임 ----------
  function sample(P, D) {
    if (!P.pose || P.pose.at === D.lastPoseAt) return;
    D.lastPoseAt = P.pose.at;
    const a = bladeAngles(P.pose.s);
    D.hist.push({ t: P.pose.at - ctx.poseLag(P), th: a.th, up: a.up });
    while (D.hist.length > 140) D.hist.shift();
  }

  function update(P, dtG, dtR, now, active) {
    const D = P.duel;
    if (!D) return;
    const lv = L(P);
    sample(P, D);
    D.t += dtG;
    // 공통: 슬로우 중 칼 휘두름 처리
    const swings = P.swings;
    switch (D.state) {
      case 'enter': {
        // 격납구 쪽에서 걸어 들어와 자리에 섭니다.
        const u = clamp(D.t / D.dur, 0, 1);
        const e = easeIO(u);
        D.R.root.position.z = ROBOT_Z - 2.8 * (1 - e);
        D.walkPh += dtG * 7.2 * (u < 1 ? 1 : 0);
        const amp = u < 0.98 ? 1 : 0;
        D.R.w.lift[0] = Math.max(0, Math.sin(D.walkPh)) * 0.08 * amp;
        D.R.w.lift[1] = Math.max(0, -Math.sin(D.walkPh)) * 0.08 * amp;
        D.pose.fr[1] = 0.04 + Math.sin(D.walkPh) * 0.16 * amp;
        D.pose.fl[1] = 0.04 - Math.sin(D.walkPh) * 0.16 * amp;
        D.pose.pel[1] = 0.95 - Math.abs(Math.cos(D.walkPh)) * 0.025 * amp;
        if (u >= 1 && !D.saluted) {
          D.saluted = true;
          to(D, POSES.salute, 0.55);
          D.powerT = 1;
          D.eyeFlash = 1;
          if (!P.demo) sfx.robotIgnite();
        }
        if (D.saluted && ctx.live(P)) {
          D.state = 'guard';
          D.t = 0;
          D.dur = P.demo ? 0.8 : 1.3;
          to(D, POSES.guard, 0.5);
          D.R.w.lift[0] = D.R.w.lift[1] = 0;
        }
        break;
      }
      case 'guard': {
        // 빈틈이 아닐 때 휘두르면 로봇이 막습니다.
        for (const sw of swings) {
          if (sw.used || sw.real < now - 400 || sw.speed < lv.strikeMin) continue;
          sw.used = true;
          if (now - D.lastBlockAt > 450 && active) robotBlocks(P, D, now);
        }
        if (D.state === 'guard' && active && D.t >= D.dur && !P.down) startAttack(P, D, now, false);
        break;
      }
      case 'block':
        if (D.t >= D.dur) {
          D.state = 'guard';
          D.t = 0;
          D.dur = rand(lv.gap[0], lv.gap[1]) * 0.6;
          to(D, POSES.guard, 0.3);
        }
        break;
      case 'windup':
        D.telA = Math.min(1, D.telA + dtR * 6);
        D.telProg = clamp(D.t / D.dur, 0, 1);
        if (D.t >= D.dur) {
          D.state = 'strike';
          D.t = 0;
          D.dur = lv.swing;
          D.attackDone = false;
          D.impact = copyPose(POSES.hit[D.kind]);
          aimContact(P, D);
          D.anim = { from: copyPose(D.pose), to: D.impact, t: 0, dur: lv.swing, ease: easeIn };
          if (!P.demo) sfx.robotSwing(D.kind);
        }
        break;
      case 'strike':
        D.telProg = 1;
        aimContact(P, D);
        if (D.t >= D.dur) {
          D.state = 'contact';
          D.t = 0;
          D.impactReal = now;
        }
        break;
      case 'contact':
        // 칼이 닿은 채로 판정 창 끝까지 기다립니다(늦게 막은 것도 인정).
        D.telA = Math.max(0, D.telA - dtR * 4);
        aimContact(P, D);
        if (now >= D.impactReal + lv.post) {
          const how = parried(P, D);
          if (how) onParry(P, D, now, how);
          else onHurt(P, D, now);
        }
        break;
      case 'recoil':
        if (D.t >= D.dur) startAttack(P, D, now, true);
        break;
      case 'follow':
        if (D.t >= D.dur && !P.down) {
          if (D.comboLeft > 0) startAttack(P, D, now, true);
          else {
            D.state = 'recover';
            D.t = 0;
            D.dur = 0.5;
            to(D, POSES.guard, 0.5);
          }
        }
        break;
      case 'stagger': {
        D.coreK = Math.max(D.coreK, 0.6);
        for (const sw of swings) {
          if (sw.used || sw.real < D.openStartReal - 120 || sw.speed < lv.strikeMin) continue;
          sw.used = true;
          if (D.hits < lv.maxHits && D.state === 'stagger') onStrike(P, D, sw, now);
        }
        if (D.state === 'stagger' && P.clock.gt >= D.openUntilG) {
          D.state = 'recover';
          D.t = 0;
          D.dur = 0.5;
          to(D, POSES.guard, 0.5);
        }
        break;
      }
      case 'recover':
        if (D.t >= D.dur) {
          D.state = 'guard';
          D.t = 0;
          D.dur = rand(lv.gap[0], lv.gap[1]);
        }
        break;
      case 'down':
        D.powerT = D.t > 0.45 ? 0 : D.powerT;
        // 쓰러진 뒤 가슴에서 가끔 불꽃
        if (now - D.lastSpark > 380 && D.t < 6) {
          D.lastSpark = now;
          D.R.bodyPoint(_hp.set(rand(-0.12, 0.12), rand(0.02, 0.24), 0.15), _sp);
          view.sparks.emit(_sp, P.demo ? 6 : 16, { color: '#fff1c4', color2: '#ff7a2a', speed: 1.8, life: 0.5, size: 0.025, hot: 3, gravity: 6 });
        }
        // 대기실 시연은 잠시 뒤 새 로봇이 걸어 들어옵니다.
        if (P.demo && D.t > 4.5) setup(P);
        break;
      case 'victory':
      case 'end':
        break;
      default:
        break;
    }
    if (!P.duel) return;
    animate(P, P.duel, dtG, dtR, now);
  }

  // 자세 보간 + 숨쉬기·흔들림·맞은 반동을 더해 몸에 적용합니다.
  function animate(P, D, dtG, dtR, now) {
    const a = D.anim;
    if (a) {
      a.t += dtG;
      const u = clamp(a.t / a.dur, 0, 1);
      mixPose(a.from, a.to, a.ease(u), D.pose);
      if (u >= 1 && a.to !== D.impact) D.anim = null;
    }
    const o = copyPose(D.pose, D.out);
    const t = P.clock.gt;
    const calm = D.state === 'guard' || D.state === 'recover' || D.state === 'end' || D.state === 'block';
    if (D.state !== 'down') {
      o.pel[1] += Math.sin(t * 2.3) * 0.008;
      o.ch[0] += Math.sin(t * 2.3 + 0.6) * 0.014;
      if (calm) {
        // 경계 자세에서 천천히 무게를 옮기고 칼끝을 살짝 흔듭니다.
        o.pel[0] += Math.sin(t * 0.8 + P.station) * 0.035;
        o.pr[1] += Math.sin(t * 0.6) * 0.05;
        o.d[0] += Math.sin(t * 1.3) * 0.05;
        o.d[1] += Math.sin(t * 1.7 + 1) * 0.04;
      }
    }
    if (D.state === 'contact') {
      // 닿은 채로 조금 밀어 붙입니다.
      o.pel[2] += 0.02;
      o.g[2] += 0.02;
    }
    D.hurtK = Math.max(0, D.hurtK - dtG * 2.6);
    if (D.hurtK > 0) {
      const k = Math.sin(D.hurtK * Math.PI * 0.5);
      o.ch[0] -= 0.22 * k;
      o.ch[1] += D.hurtSide * 0.3 * k;
      o.hd[0] -= 0.3 * k;
      o.hd[1] -= D.hurtSide * 0.25 * k;
      o.pel[2] -= 0.08 * k;
      o.g[1] += 0.1 * k;
    }
    D.shake = Math.max(0, D.shake - dtR * 5);
    if (D.shake > 0) {
      const j = D.shake * 0.02;
      o.pel[0] += (Math.random() - 0.5) * j;
      o.g[0] += (Math.random() - 0.5) * j * 2;
      o.g[1] += (Math.random() - 0.5) * j * 2;
    }
    // 칼 켜기·끄기
    const R = D.R;
    const st = R.state;
    st.power += clamp(D.powerT - st.power, -dtR / 0.5, dtR / 0.3);
    const ft = now / 1000;
    st.flick = 1 + 0.04 * Math.sin(ft * 57 + P.station) * Math.sin(ft * 6.1) + 0.03 * Math.sin(ft * 131) + (Math.random() - 0.5) * 0.04;
    st.trailK = D.state === 'strike' ? 0.6 : 0;
    // 빛: 눈(예고 때 번쩍), 가슴 코어(빈틈일 때 크게 맥동), 팔다리 줄
    D.eyeFlash = Math.max(0, D.eyeFlash - dtR * 2.2);
    D.coreK = Math.max(0, D.coreK - dtR * 0.8);
    const dying = D.state === 'down' ? clamp(1 - D.t / 1.6, 0.06, 1) : 1;
    const open = D.state === 'stagger' ? 0.5 + 0.5 * Math.sin(now / 70) : 0;
    R.setGlow((4 + D.eyeFlash * 7) * dying, (3 + open * 9 + D.coreK * 6) * dying, (1.8 + D.eyeFlash * 2) * dying);
    R.apply(o, dtR);
    // 예고 빛 줄
    if (D.state === 'windup' || D.state === 'strike' || D.state === 'contact') {
      const prog = D.state === 'windup' ? easeIO(D.telProg) * 0.94 : 1;
      D.tel.set(D.kind, prog, D.telA * (P.demo ? 0.35 : 1), now / 1000, P.sx);
    } else if (D.telA > 0) {
      D.telA = Math.max(0, D.telA - dtR * 5);
      D.tel.set(D.kind, 1, D.telA, now / 1000, P.sx);
    } else D.tel.hide();
  }

  // 슬로우: 로봇이 휙 벨 때와 칼이 부딪힌 순간(잠깐 멈춤)
  function slowTarget(P, now) {
    const D = P.duel;
    if (!D || P.down) return 1;
    if (now < D.stopUntil) return 0.05;
    if (D.state === 'strike' || D.state === 'contact') return P.demo ? 0.6 : L(P).slow;
    return 1;
  }

  // ---------- 봇·대기실 시연 ----------
  const _want = V();
  function botThink(P, dtR, now) {
    const D = P.duel;
    if (!D) return;
    const lv = L(P);
    let want = BOT_DIR.idle;
    const threat = D.state === 'windup' || D.state === 'strike' || D.state === 'contact';
    if (threat) {
      if (!D.botPlan || D.botPlan.id !== D.attackId) {
        const fail = Math.random() < (P.demo ? 0.08 : lv.botFail);
        D.botPlan = { id: D.attackId, reactAt: now + rand(160, 420), fail, swung: false };
      }
      const plan = D.botPlan;
      if (now >= plan.reactAt) {
        const k = plan.fail ? (D.kind === 'left' ? 'right' : 'left') : D.kind;
        want = BOT_DIR[k];
        // 찌르기(어려움)는 휘둘러 쳐내야 합니다.
        if (D.kind === 'thrust' && !plan.fail && !plan.swung && (D.state === 'strike' || D.state === 'contact')) {
          plan.swung = true;
          ctx.botSwing(P, 700);
        }
      }
    } else if (D.state === 'stagger') {
      want = BOT_DIR.idle;
      if (now >= D.botNextSwing && D.botSwings < (P.demo ? 2 : 3)) {
        D.botNextSwing = now + rand(200, 320);
        D.botSwings += 1;
        ctx.botSwing(P, rand(500, 1100));
      }
    }
    if (D.state !== 'stagger') {
      D.botSwings = 0;
      if (D.state !== 'windup' || now > D.botNextSwing) D.botNextSwing = now + rand(220, 420);
    }
    _want.copy(want);
    ctx.setBotDir(P, _want, dtR);
  }

  // ---------- HUD 용 ----------
  function hudState(P) {
    const D = P.duel;
    if (!D) return null;
    D.hpShown += (D.hp - D.hpShown) * 0.08;
    const lv = L(P);
    const openK = D.state === 'stagger' ? clamp((D.openUntilG - P.clock.gt) / lv.open, 0, 1) : 0;
    return {
      name: D.name, hp: D.hp, max: D.max, ghost: D.hpShown, state: D.state, kind: D.kind,
      warn: D.state === 'windup' || D.state === 'strike' || D.state === 'contact' ? D.kind : null,
      prog: D.state === 'windup' ? D.telProg : 1, openK, hits: D.hits, combo: D.comboN + D.comboLeft + 1, comboN: D.comboN,
      level: D.level
    };
  }

  /** 시간이 다 됐을 때: 아직 결판이 안 난 사람은 남은 체력 비율로 판정합니다. */
  function timeUp(P) {
    const D = P.duel;
    if (!D) return;
    if (!P.result) P.result = P.down ? 'ko' : P.hp / 100 >= D.hp / D.max ? 'tw' : 'tl';
    if (D.state !== 'down' && D.state !== 'victory') {
      D.state = 'end';
      D.comboLeft = 0;
      to(D, P.result === 'tl' ? POSES.victory : POSES.salute, 0.7);
    }
    D.telA = 0;
  }
  /** 경기가 끝나 칼을 끕니다. */
  function retract(P) {
    const D = P.duel;
    if (D) D.powerT = 0;
  }

  return {
    setup, clear, update, slowTarget, botThink, hudState, timeUp, retract,
    robots, levels: DUEL_LEVEL,
    /** 시험용: 지금 바로 그 방향으로 공격 */
    force(P, kind) {
      const D = P && P.duel;
      if (!D || D.state === 'down' || D.state === 'victory') return false;
      D.lastKinds = [];
      startAttack(P, D, performance.now(), false);
      if (kind && POSES.wind[kind]) {
        D.kind = kind;
        to(D, POSES.wind[kind], D.dur * 0.72, easeOut);
        if (!P.demo) ctx.send('cue', { kind: 'duel', dir: kind, ms: Math.round((D.dur + L(P).swing / L(P).slow) * 1000), n: 0, of: 1 }, P.slot);
      }
      return true;
    },
    /** 시험용: 로봇 체력 */
    setHp(P, hp) {
      if (P && P.duel) P.duel.hp = clamp(hp, 0, P.duel.max);
    },
    /** 시험용: 고정 자세 보기 */
    pose(P, name) {
      const D = P && P.duel;
      if (!D) return;
      const [a, b] = String(name).split('.');
      const p = b ? POSES[a] && POSES[a][b] : POSES[a];
      if (!p) return;
      D.state = 'end';
      to(D, p, 0.3);
    },
    mkPose
  };
}
