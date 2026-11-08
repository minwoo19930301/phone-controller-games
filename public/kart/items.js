// 아이템전 규칙: 아이템 상자, 아이템 뽑기(순위에 따라 확률이 달라짐), 바나나·유도탄·번개·무적·부스트 효과, CPU 의 아이템 쓰기.
// three 에 기대지 않는 계산만 합니다(그림은 scene.js). node 에서도 검사할 수 있습니다.
//
// 뽑기: q = 0(선두) … 1(꼴찌·크게 뒤처짐). 선두는 바나나·니트로 같은 약한 것, 뒤처질수록 슈퍼 터보·무적 질주·번개·유도탄이 잘 나옵니다.
// rb(추격 보정 세기, 난이도별)가 클수록 무적·번개가 더 잘 나옵니다.
import { clamp } from './physics.js';

export const ITEM_KINDS = ['banana', 'nitro', 'missile', 'turbo', 'star', 'bolt'];

/** 아이템별 무게. q: 0..1(뒤처진 정도), rb: 0..1(보정 세기) */
export function itemWeights(q, rb = 0.7) {
  q = clamp(q, 0, 1);
  const hi = (a) => Math.max(0, (q - a) / (1 - a));
  return {
    banana: 6 * (1 - q) * (1 - q),
    nitro: 4 * (1 - q) + 0.6,
    missile: 10 * q * (1 - q) + 2 * q + 0.4,
    turbo: 4.5 * Math.pow(q, 1.2),
    star: 5 * Math.pow(hi(0.45), 1.3) * (0.4 + 0.6 * rb),
    bolt: 3 * Math.pow(hi(0.7), 1.5) * (0.3 + 0.7 * rb)
  };
}

/** 뽑기 하나. rnd: 0..1 난수 함수 */
export function rollItem(q, rb, rnd = Math.random) {
  const w = itemWeights(q, rb);
  let sum = 0;
  for (const k of ITEM_KINDS) sum += w[k];
  let r = rnd() * sum;
  for (const k of ITEM_KINDS) {
    r -= w[k];
    if (r <= 0) return k;
  }
  return 'nitro';
}

/**
 * 뒤처진 정도 q. 순위(0=선두, 1=꼴찌)와 선두와의 거리 중 큰 쪽을 씁니다.
 * 꼴찌라도 선두와 붙어 있으면 조금 덜(0.85) 쳐 줍니다.
 */
export function behindness(rankIdx, n, gap) {
  const p = n > 1 ? rankIdx / (n - 1) : 0;
  return clamp(Math.max(p * 0.85, gap / 200), 0, 1);
}

const ROLL_SEC = 1.5; // 상자를 먹고 아이템이 정해지기까지(룰렛)
const BOX_RESPAWN = 2.6;
const MAX_BANANAS = 14;
const MISSILE_SPEED = 64;

/**
 * 아이템전 상태.
 * hooks: {
 *   q(k) → 0..1 뒤처진 정도(뽑기용), rb(k) → 보정 세기, hitScale(k) → 맞았을 때 도는 시간 배율,
 *   onPickup(k, box), onRoll(k), onItem(k), onUse(k, kind), onHit(victim, cause, by), onBolt(user, victims), onSmash(k, what), onBoom(x, z)
 * }
 */
export function createItems(track, hooks = {}) {
  const call = (name, ...a) => { if (typeof hooks[name] === 'function') return hooks[name](...a); return undefined; };
  const boxes = [];
  let nid = 1;
  for (const row of track.itemRows || []) {
    const p = track.at(row.s);
    for (const d of row.ds) {
      boxes.push({ id: nid++, s: row.s, d, x: p.x - Math.sin(p.th) * d, z: p.z + Math.cos(p.th) * d, alive: true, t: 0, grow: 1 });
    }
  }
  const st = { on: true, boxes, bananas: [], missiles: [], fx: [] };

  function reset(on) {
    st.on = Boolean(on);
    st.bananas.length = 0;
    st.missiles.length = 0;
    st.fx.length = 0;
    for (const b of boxes) { b.alive = true; b.t = 0; b.grow = 1; }
  }

  function clearKart(k) {
    k.item = null;
    k.itemRoll = 0;
    k.itemPending = null;
    k.itemUseAt = 0;
  }

  /** 맞아서 돌기. 무적이면 안 됨. 반환: 돌았으면 true */
  function spinOut(k, dur, cause, by) {
    if (k.starT > 0 || k.finished) return false;
    const s = call('hitScale', k) ?? 1;
    k.spinDur = dur * s;
    k.spinT = k.spinDur;
    k.spinDir = Math.random() < 0.5 ? -1 : 1;
    k.boostT = 0;
    call('onHit', k, cause, by);
    return true;
  }

  function startRoll(k) {
    const q = call('q', k) ?? 0.5;
    const rb = call('rb', k) ?? 0.7;
    k.itemPending = rollItem(q, rb);
    k.itemRoll = ROLL_SEC;
    call('onRoll', k);
  }

  /** 아이템 쓰기. 반환: 쓴 아이템 이름 또는 null */
  function use(k, karts) {
    if (!st.on || !k.item || k.itemRoll > 0 || k.finished) return null;
    const kind = k.item;
    k.item = null;
    k.itemPending = null;
    const fx = Math.cos(k.h);
    const fz = Math.sin(k.h);
    if (kind === 'banana') {
      st.bananas.push({ id: nid++, x: k.x - fx * 2.9, z: k.z - fz * 2.9, h: k.h, owner: k, age: 0 });
      if (st.bananas.length > MAX_BANANAS) st.bananas.shift();
    } else if (kind === 'nitro') {
      k.boostMul = Math.max(k.boostT > 0 ? k.boostMul : 0, 1.3);
      k.boostT = Math.max(k.boostT, 1.3);
    } else if (kind === 'turbo') {
      k.boostMul = 1.45;
      k.boostT = Math.max(k.boostT, 2.9);
      k.vx += fx * 6;
      k.vz += fz * 6;
    } else if (kind === 'star') {
      k.starT = 5.5;
      k.spinT = 0;
      k.shrinkT = 0;
    } else if (kind === 'missile') {
      // 바로 앞(진행 거리 기준) 카트를 노립니다. 400m 안에 없으면 앞으로 날아가다 터집니다.
      let target = null;
      for (const o of karts) {
        if (o === k || o.finished) continue;
        const g = o.dist - k.dist;
        if (g > 0 && g < 400 && (!target || g < target.dist - k.dist)) target = o;
      }
      st.missiles.push({ id: nid++, owner: k, target, dist: k.dist + 2.5, d: k.d, x: k.x, z: k.z, h: k.h, life: 7, age: 0, y: 0.7 });
    } else if (kind === 'bolt') {
      const victims = [];
      for (const o of karts) {
        if (o === k || o.finished || o.dist <= k.dist) continue;
        if (o.starT > 0) continue;
        const s = call('hitScale', o) ?? 1;
        o.shrinkT = 3.4 * s;
        spinOut(o, 0.7, 'bolt', k);
        victims.push(o);
      }
      st.fx.push({ kind: 'bolt', t: 0, max: 0.9, by: k, victims });
      call('onBolt', k, victims);
    }
    call('onUse', k, kind);
    return kind;
  }

  function update(dt, now, karts) {
    if (!st.on) return;
    // 상자: 먹으면 사라졌다가 다시 자라납니다.
    for (const b of boxes) {
      if (!b.alive) {
        b.t -= dt;
        if (b.t <= 0) { b.alive = true; b.grow = 0; }
      } else if (b.grow < 1) b.grow = Math.min(1, b.grow + dt * 2.5);
    }
    for (const k of karts) {
      // 상자 먹기
      if (!k.finished) {
        for (const b of boxes) {
          if (!b.alive || b.grow < 0.6) continue;
          const dx = k.x - b.x;
          const dz = k.z - b.z;
          if (dx * dx + dz * dz > 1.9 * 1.9) continue;
          b.alive = false;
          b.t = BOX_RESPAWN;
          call('onPickup', k, b);
          if (!k.item && !(k.itemRoll > 0)) startRoll(k);
        }
      }
      // 룰렛
      if (k.itemRoll > 0) {
        k.itemRoll -= dt;
        if (k.itemRoll <= 0) {
          k.itemRoll = 0;
          k.item = k.itemPending;
          k.itemPending = null;
          k.itemUseAt = now + 900 + Math.random() * 2600;
          call('onItem', k);
        }
      }
    }
    // 바나나
    for (let i = st.bananas.length - 1; i >= 0; i--) {
      const bn = st.bananas[i];
      bn.age += dt;
      for (const k of karts) {
        if (k === bn.owner && bn.age < 0.6) continue;
        const dx = k.x - bn.x;
        const dz = k.z - bn.z;
        if (dx * dx + dz * dz > 1.5 * 1.5) continue;
        st.bananas.splice(i, 1);
        if (k.starT > 0) call('onSmash', k, 'banana');
        else spinOut(k, 1.15, 'banana', bn.owner);
        break;
      }
    }
    // 유도탄: 도로를 따라 날아가다 목표 가까이에서 그 가로 위치로 붙습니다.
    for (let i = st.missiles.length - 1; i >= 0; i--) {
      const m = st.missiles[i];
      m.age += dt;
      m.life -= dt;
      if (m.target && (m.target.finished || m.target.dist < m.dist - 6)) m.target = null;
      m.dist += MISSILE_SPEED * dt;
      const tgt = m.target;
      const want = tgt && tgt.dist - m.dist < 60 ? tgt.d : m.d * 0.98;
      m.d += (want - m.d) * Math.min(1, dt * (tgt && tgt.dist - m.dist < 25 ? 9 : 3));
      const p = track.at(m.dist);
      const nx = p.x - Math.sin(p.th) * m.d;
      const nz = p.z + Math.cos(p.th) * m.d;
      m.h = Math.atan2(nz - m.z, nx - m.x) || p.th;
      m.x = nx;
      m.z = nz;
      let hit = null;
      if (tgt && Math.abs(tgt.dist - m.dist) < 2 && Math.abs(tgt.d - m.d) < 2.4) hit = tgt;
      if (!hit) {
        for (const k of karts) {
          if (k === m.owner && m.age < 0.8) continue;
          const dx = k.x - m.x;
          const dz = k.z - m.z;
          if (dx * dx + dz * dz < 1.8 * 1.8) { hit = k; break; }
        }
      }
      if (hit) {
        st.missiles.splice(i, 1);
        call('onBoom', m.x, m.z);
        if (hit.starT > 0) call('onSmash', hit, 'missile');
        else spinOut(hit, 1.3, 'missile', m.owner);
        continue;
      }
      if (m.life <= 0) {
        st.missiles.splice(i, 1);
        call('onBoom', m.x, m.z);
      }
    }
    for (let i = st.fx.length - 1; i >= 0; i--) {
      st.fx[i].t += dt;
      if (st.fx[i].t > st.fx[i].max) st.fx.splice(i, 1);
    }
  }

  /** CPU·시험용 봇의 아이템 쓰기: 받은 뒤 조금 있다가, 상황에 맞을 때 씁니다. */
  function ai(k, now, karts) {
    if (!st.on || !k.item || k.itemRoll > 0 || k.finished || now < k.itemUseAt) return null;
    const kind = k.item;
    let go = false;
    const wait = now - k.itemUseAt;
    if (kind === 'banana') {
      go = wait > 6000 || karts.some((o) => o !== k && k.dist - o.dist > 2 && k.dist - o.dist < 26);
    } else if (kind === 'missile') {
      go = wait > 5000 || karts.some((o) => o !== k && !o.finished && o.dist - k.dist > 4 && o.dist - k.dist < 130);
    } else if (kind === 'nitro' || kind === 'turbo') {
      go = wait > 3000 || (Math.abs(k.kappaAhead || 0) < 1 / 160 && k.vf > 14);
    } else go = true;
    return go ? use(k, karts) : null;
  }

  return { st, boxes, reset, update, use, ai, clearKart, spinOut };
}
