// 물고기 무리: 눈에 보이는 물고기들이 호수를 헤엄치고, 물에 떠 있는 찌(미끼)에 반응합니다.
// 화면·DOM 과 상관없이 위치·속도·상태만 계산합니다(node 에서도 불러 시험할 수 있음).
//
// 한 마리의 하루: 헤엄(순항·어슬렁·멈춤·돌진) → 찌를 알아챔 → 다가가 살핌 → 톡톡(예신) → 덥석(본신)
// → 챔질이 맞으면 걸림(줄에 끌려옴) / 늦으면 미끼만 떼어 먹고 떠남 / 너무 일찍 채면 놀라 도망.
import {
  AREA, MIX, BIG_KG, BAIT_DEPTH, SPECIES, COVER, ASSIST, bedDepth, lakeQ, coverAt, rollWeight, fishInfo, bigness
} from './logic.js';

export const POP = 12; // 늘 살아 있는 물고기 수(쉽게 바꿀 수 있게 한곳에)
export const SPOOK_R = 1.5; // 찌가 떨어진 자리에서 이 안의 물고기는 놀라 달아납니다
export const NOTICE_R = { blg: 4, smb: 5.5, lmb: 6 }; // 찌를 알아채는 거리(배스는 ±1m 개체 차)
const CURIOUS = { blg: 0.72, smb: 0.6, lmb: 0.55 }; // 알아챘을 때 다가올 확률(큰 놈은 더 낮음)

const TAU = Math.PI * 2;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const wrap = (a) => {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
};

// 기본 시야(node 시험용): 선착장에서 앞쪽 부채꼴. 큰 화면은 실제 카메라 절두체를 넘겨 줍니다.
function defaultInView(x, y, z, r) {
  const dz = z + 1.85;
  return dz > 0.4 && Math.abs(x) - r < dz * 1.02 && z < 46;
}

export function createPond({ rand = Math.random, inView = defaultInView, count = POP, now = 0, assist = ASSIST.hard } = {}) {
  const fish = [];
  // 난이도별 도움(logic.js ASSIST). 알아채는 거리·다가올 확률·망설이는 시간·물기 전 톡톡 횟수에 씁니다.
  let A = assist || ASSIST.hard;
  const events = [];
  let nextId = 1;
  let nextSchool = 1;
  let target = count;
  const spawnAt = []; // 들어올 예정 시각들
  const lureSeen = new Map(); // slot -> { land, twitch }
  let lureList = [];
  let t = now;
  let nextRise = now + 4 + rand() * 6;

  const R = (a, b) => a + (b - a) * rand();
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  // ---------- 개체 만들기 ----------
  function make(species, weight) {
    const info = fishInfo(species, weight);
    const big = bigness(species, weight);
    const len = info.length;
    const f = {
      id: nextId++,
      sp: species, w: weight, len, info, big, power: info.power,
      x: 0, y: -1, z: 10, yaw: 0, pitch: 0, roll: 0, speed: 0, tgtSpeed: 0, yawRate: 0, vy: 0,
      // 좋아하는 깊이(수면 아래 m): 0.3~1.6, 큰 놈일수록 깊게
      depth: clamp(0.3 + 1.3 * (species === 'blg' ? R(0.0, 0.35) : 0.12 + 0.55 * big + R(0, 0.3)), 0.3, 1.6),
      noticeR: species === 'blg' ? NOTICE_R.blg : NOTICE_R[species] + R(-0.8, 1.0) - big * 0.6,
      mode: 'roam', act: 'cruise', actEnd: 0, tx: 0, tz: 0,
      school: null, leader: false,
      lure: null, noticeAt: 0, noticeBoost: 0, nextScan: t + R(1, 3), nextEval: 0, ignoreUntil: 0, ignoreLure: {},
      inspEnd: 0, nibLeft: 0, nextNib: 0, nibAt: -9, orbit: 1, orbitA: 0, approachT0: 0,
      biteT0: 0, spookEnd: 0, leaveT0: 0, exitX: 0, exitZ: 0, hookSlot: null,
      // 그리기용: 꼬리 위상·진폭, 몸 휨
      phase: R(0, 10), tailFreq: 6, tailAmp: 0.02, curl: 0, thrash: 0, seen: 0, vis: 0
    };
    return f;
  }

  function prefDepth(f, x, z) {
    const bed = bedDepth(x, z);
    return clamp(f.depth, 0.25, Math.max(0.25, bed - f.len * 0.16 - 0.1));
  }

  // 화면에 보이는 부채꼴 안(선착장 눈에서 좌우 ±0.8 배)
  const VIEW_K = 0.8;
  const inWedge = (x, z, m = 0) => Math.abs(x) < (z + 1.85) * VIEW_K - m;
  function validSpot(f, x, z) {
    return lakeQ(x, z) < 0.84 && bedDepth(x, z) > f.depth + 0.45 && x > AREA.x0 + 0.8 && x < AREA.x1 - 0.8 && z > AREA.z0 + 0.8 && z < AREA.z1 - 0.5 &&
      inWedge(x, z, 0.6);
  }

  // 갈 곳 고르기. 큰 놈은 통나무·바위·수초 턱 근처나 먼 곳을 좋아합니다.
  function pickSpot(f, near = null, radius = 6) {
    for (let i = 0; i < 30; i++) {
      let x;
      let z;
      if (near) {
        const a = R(0, TAU);
        const d = R(radius * 0.4, radius);
        x = near.x + Math.sin(a) * d;
        z = near.z + Math.cos(a) * d;
      } else if (f.big > 0.3 && rand() < 0.65) {
        if (rand() < 0.6) {
          const c = pick(COVER);
          const a = R(0, TAU);
          x = c.x + Math.sin(a) * R(0.5, c.r);
          z = c.z + Math.cos(a) * R(0.5, c.r);
        } else {
          x = R(AREA.x0 + 1, AREA.x1 - 1);
          z = R(14, 26);
        }
      } else if (f.sp === 'blg') {
        x = R(AREA.x0 + 1, AREA.x1 - 1);
        z = AREA.z0 + 0.8 + 10 * Math.pow(rand(), 1.2);
      } else {
        // 보통 크기는 가까운 물(선착장에서 4~16m)에 많이 삽니다.
        x = R(AREA.x0 + 1, AREA.x1 - 1);
        z = AREA.z0 + 0.8 + (AREA.z1 - AREA.z0 - 2.2) * Math.pow(rand(), 2.5);
      }
      if (validSpot(f, x, z)) return { x, z };
    }
    return { x: R(-6, 6), z: R(8, 18) };
  }

  // ---------- 개체 수 유지 ----------
  function aliveCount() {
    let n = 0;
    for (const f of fish) if (f.mode !== 'leave' && f.mode !== 'release' && f.mode !== 'landed') n += 1;
    return n;
  }
  function bigCount() {
    let n = 0;
    for (const f of fish) if (f.w >= BIG_KG && f.mode !== 'leave' && f.mode !== 'release' && f.mode !== 'landed') n += 1;
    return n;
  }
  function chooseSpecies() {
    const cnt = { lmb: 0, smb: 0, blg: 0 };
    for (const f of fish) if (f.mode !== 'leave' && f.mode !== 'release' && f.mode !== 'landed') cnt[f.sp] += 1;
    let best = 'lmb';
    let bestD = -1e9;
    for (const sp of Object.keys(MIX)) {
      const d = MIX[sp] * target - cnt[sp] + rand() * 0.6;
      if (d > bestD) {
        bestD = d;
        best = sp;
      }
    }
    return best;
  }

  // 화면 밖(양옆, 또는 먼 깊은 물)에서 들어올 자리
  function entryPoint() {
    for (let i = 0; i < 20; i++) {
      const side = rand();
      let x;
      let z;
      let y;
      if (side < 0.82) {
        x = (rand() < 0.5 ? 1 : -1) * R(16.5, 18);
        z = R(4.5, 12);
        y = -R(0.6, 1.1);
      } else {
        x = R(-10, 10);
        z = R(39, 41);
        y = -R(2.2, 2.8);
      }
      if (lakeQ(x, z) < 0.88 && bedDepth(x, z) > -y + 0.3 && !inView(x, y, z, 1.2)) return { x, y, z };
    }
    return { x: 17, y: -0.8, z: 6 };
  }

  function place(f, initial, at) {
    if (initial) {
      const s = at || pickSpot(f);
      f.x = s.x;
      f.z = s.z;
      f.y = -prefDepth(f, s.x, s.z);
      f.yaw = R(-Math.PI, Math.PI);
      f.mode = 'roam';
      f.actEnd = 0;
    } else {
      const e = at || entryPoint();
      f.x = e.x;
      f.z = e.z;
      f.y = e.y;
      const home = pickSpot(f);
      f.tx = home.x;
      f.tz = home.z;
      f.yaw = Math.atan2(home.x - e.x, home.z - e.z);
      f.speed = f.len * 0.8;
      f.mode = 'enter';
    }
  }

  function spawn(initial, species, weight, at) {
    const sp = species || chooseSpecies();
    if (sp === 'blg' && weight == null) {
      // 블루길은 3~5마리가 함께 다닙니다.
      const room = target + 2 - aliveCount();
      const n = clamp(3 + Math.floor(rand() * 3), 1, Math.max(1, room));
      const sid = nextSchool++;
      const lead = make('blg', rollWeight('blg', rand));
      place(lead, initial, at);
      lead.school = sid;
      lead.leader = true;
      fish.push(lead);
      for (let i = 1; i < n; i++) {
        const g = make('blg', rollWeight('blg', rand));
        g.school = sid;
        g.x = lead.x + R(-0.7, 0.7);
        g.z = lead.z + R(-0.7, 0.7);
        g.y = lead.y + R(-0.15, 0.15);
        g.yaw = lead.yaw + R(-0.3, 0.3);
        g.mode = lead.mode;
        g.tx = lead.tx;
        g.tz = lead.tz;
        g.speed = lead.speed;
        fish.push(g);
      }
      return lead;
    }
    const w = weight != null ? weight : rollWeight(sp, rand, bigCount() < 2);
    const f = make(sp, w);
    place(f, initial, at);
    fish.push(f);
    return f;
  }

  function upkeep() {
    const have = aliveCount() + spawnAt.length * 1.5;
    if (have < target - 0.5) spawnAt.push(t + R(3, 6.5));
    for (let i = spawnAt.length - 1; i >= 0; i--) {
      if (t >= spawnAt[i]) {
        spawnAt.splice(i, 1);
        if (aliveCount() < target) spawn(false);
      }
    }
  }

  // ---------- 찌(미끼) ----------
  const lureOf = (slot) => lureList.find((l) => l.slot === slot && l.active) || null;
  const ignoring = (f, slot) => t < f.ignoreUntil || t < (f.ignoreLure[slot] || 0);
  const d2 = (f, l) => Math.hypot(f.x - l.x, f.z - l.z);

  function releaseClaim(f) {
    for (const l of lureList) if (l.fishId === f.id) l.fishId = null;
  }
  function toRoam(f, ignoreSlot, ignoreFor) {
    releaseClaim(f);
    if (ignoreSlot != null) f.ignoreLure[ignoreSlot] = t + ignoreFor;
    f.mode = 'roam';
    f.lure = null;
    f.actEnd = 0;
    f.noticeAt = 0;
  }
  function spook(f, fromX, fromZ, dur, ignoreFor) {
    if (f.mode === 'hooked' || f.mode === 'landed' || f.mode === 'release' || f.mode === 'leave') return;
    releaseClaim(f);
    f.mode = 'spook';
    f.lure = null;
    f.noticeAt = 0;
    f.spookEnd = t + dur;
    let a = Math.atan2(f.x - fromX, f.z - fromZ);
    if (!Number.isFinite(a) || (Math.abs(f.x - fromX) < 1e-3 && Math.abs(f.z - fromZ) < 1e-3)) a = f.yaw + Math.PI;
    f.tx = f.x + Math.sin(a + R(-0.4, 0.4)) * 6;
    f.tz = f.z + Math.cos(a + R(-0.4, 0.4)) * 6;
    f.tgtSpeed = f.len * 5.5 + 0.9;
    f.ignoreUntil = Math.max(f.ignoreUntil, t + ignoreFor);
  }

  const noticeOf = (f) => f.noticeR * A.notice;
  function lureScore(f, l) {
    const d = d2(f, l);
    const recentTwitch = t - (l.twitchAt || -99) < 2.5;
    const reach = noticeOf(f) + (recentTwitch ? 1.5 : 0);
    if (d > reach) return -1e9;
    let s = 1 - d / reach + (recentTwitch ? 0.6 : 0) + (t - (l.landAt || -99) < 3 ? 0.15 : 0) - (l.moving ? 0.2 : 0);
    if (l.fishId && l.fishId !== f.id) s -= 0.3;
    return s;
  }
  function bestLure(f) {
    let best = null;
    let bs = -1e9;
    for (const l of lureList) {
      if (!l.active || ignoring(f, l.slot)) continue;
      const s = lureScore(f, l);
      if (s > bs) {
        bs = s;
        best = l;
      }
    }
    return best ? { l: best, s: bs } : null;
  }

  function startApproach(f, l) {
    releaseClaim(f);
    f.mode = 'approach';
    f.lure = l.slot;
    f.approachT0 = t;
    f.nextEval = t + 0.5;
    f.orbit = rand() < 0.5 ? -1 : 1;
  }

  function onLand(l) {
    for (const f of fish) {
      if (f.mode === 'hooked' || f.mode === 'landed' || f.mode === 'release' || f.mode === 'leave' || f.mode === 'bite') continue;
      // 이 찌를 노리던 물고기는 새 찌로 다시 봅니다.
      if (f.lure === l.slot) toRoam(f, null, 0);
      const d = d2(f, l);
      if (d < SPOOK_R) {
        spook(f, l.x, l.z, R(1, 2), 2.5);
        continue;
      }
      if (d < noticeOf(f) && !ignoring(f, l.slot) && (f.mode === 'roam' || f.mode === 'enter')) {
        const at = t + R(0.4, 1.8) * (1 + f.big * 0.5) * A.commit;
        if (!f.noticeAt || at < f.noticeAt) {
          f.noticeAt = at;
          f.noticeBoost = 0;
        }
      }
    }
  }
  function onTwitch(l) {
    for (const f of fish) {
      if (f.mode === 'inspect' && f.lure === l.slot) {
        // 살피던 물고기: 큰 놈은 톡 건드리면 덥석 무는 일이 많고, 작은 놈은 가끔 놀랍니다.
        // 쉬운 난이도에서는 물기 전에 톡톡을 꼭 정한 횟수만큼 하므로, 아직이면 톡톡을 앞당깁니다.
        const r = rand();
        if (l.fishId === f.id || !l.fishId) {
          if ((f.nibsDone || 0) < A.nibMin) {
            f.nibLeft = Math.max(f.nibLeft, A.nibMin - (f.nibsDone || 0));
            f.nextNib = Math.min(f.nextNib, t + R(0.15, 0.4));
          } else if (r < 0.22 + 0.4 * f.big) startBite(f, l);
          else if (f.big < 0.2 && r > 0.88 && !f.guided) toRoam(f, l.slot, 5);
          else f.inspEnd = Math.min(f.inspEnd, t + R(0.4, 1.4));
        }
        continue;
      }
      if (f.mode !== 'roam' && f.mode !== 'approach' && f.mode !== 'enter') continue;
      const d = d2(f, l);
      if (d < 0.45 && f.mode === 'roam') {
        spook(f, l.x, l.z, R(0.6, 1.2), 1.5);
        continue;
      }
      if (d < noticeOf(f) + 1.5 && t >= f.ignoreUntil) {
        // 다른 찌를 노리던 물고기도 톡 건드린 찌 쪽이 더 끌리면 갈아탑니다(곧 다시 견줘 봅니다).
        if (f.mode === 'approach') f.nextEval = t;
        else {
          f.ignoreLure[l.slot] = 0;
          const at = t + R(0.2, 1.1);
          if (!f.noticeAt || at < f.noticeAt) f.noticeAt = at;
          f.noticeBoost = 0.5;
        }
      }
    }
  }

  function startBite(f, l) {
    f.guided = false;
    f.mode = 'bite';
    f.lure = l.slot;
    l.fishId = f.id;
    f.biteT0 = t;
    // 물고 선착장 반대쪽(먼 쪽)으로 조금씩 끌고 갑니다.
    const out = Math.atan2(l.x * 0.15, 1) + R(-0.9, 0.9);
    f.tx = l.x + Math.sin(out) * 4;
    f.tz = l.z + Math.cos(out) * 4;
    f.tgtSpeed = 0.45 + f.len * 0.5;
    events.push({ type: 'bite', fish: f, slot: l.slot });
  }

  // ---------- 매 프레임 ----------
  const steer = { x: 0, z: 0 };
  function update(dt, now, lures) {
    t = now;
    events.length = 0;
    lureList = lures || [];
    // 찌가 떨어지거나 톡 움직였는지
    for (const l of lureList) {
      let s = lureSeen.get(l.slot);
      if (!s) {
        s = { land: l.land, twitch: l.twitch };
        lureSeen.set(l.slot, s);
        if (l.active) onLand(l);
      }
      if (!l.active) {
        if (l.fishId) {
          const f = byId(l.fishId);
          if (f && (f.mode === 'inspect' || f.mode === 'approach')) toRoam(f, null, 0);
        }
        l.fishId = null;
        s.land = l.land;
        s.twitch = l.twitch;
        continue;
      }
      if (l.land !== s.land) {
        s.land = l.land;
        onLand(l);
      }
      if (l.twitch !== s.twitch) {
        s.twitch = l.twitch;
        onTwitch(l);
      }
    }
    upkeep();
    if (t >= nextRise) {
      nextRise = t + R(5, 11);
      const cands = fish.filter((f) => f.mode === 'roam' && f.act !== 'rise' && (f.sp === 'blg' || f.len < 0.38) && inView(f.x, 0, f.z, 0) && f.z > 9);
      if (cands.length) {
        const f = pick(cands);
        f.act = 'rise';
        f.actEnd = t + 6;
        f.tx = f.x + Math.sin(f.yaw) * 1.5;
        f.tz = f.z + Math.cos(f.yaw) * 1.5;
        f.tgtSpeed = f.len * 0.6;
      }
    }
    for (let i = fish.length - 1; i >= 0; i--) {
      const f = fish[i];
      think(f);
      if (f.gone) {
        releaseClaim(f);
        fish.splice(i, 1);
        events.push({ type: 'despawn', fish: f });
        continue;
      }
      move(f, dt);
    }
    return events;
  }

  function think(f) {
    const m = f.mode;
    if (m === 'hooked' || m === 'landed') return;
    if (m === 'enter') {
      if (Math.hypot(f.tx - f.x, f.tz - f.z) < 2.5 || (f.x > AREA.x0 + 1.5 && f.x < AREA.x1 - 1.5 && f.z > AREA.z0 + 1 && f.z < AREA.z1 - 1 && inView(f.x, f.y, f.z, 0))) {
        f.mode = 'roam';
        f.actEnd = 0;
      }
      f.tgtSpeed = f.len * 1.0 + 0.1;
      return;
    }
    if (m === 'leave' || m === 'release') {
      const age = t - f.leaveT0;
      if (age > 0.9) {
        f.tx = f.exitX;
        f.tz = f.exitZ;
        f.tgtSpeed = f.len * 2.2 + 0.4;
      }
      const out = !inView(f.x, f.y, f.z, f.len) || (f.z > 37 && f.y < -1.8);
      if ((age > 1.2 && out) || age > 28) f.gone = true;
      return;
    }
    if (m === 'spook') {
      if (t >= f.spookEnd) toRoam(f, null, 0);
      return;
    }
    if (m === 'bite') {
      if (t - f.biteT0 > 4) {
        // 아무도 챔질하지 않으면 미끼만 떼어 먹고 갑니다(바깥에서 steal 을 먼저 부르는 게 보통).
        steal(f);
      }
      return;
    }
    if (m === 'approach' || m === 'inspect') {
      const l = lureOf(f.lure);
      if (!l || (ignoring(f, l.slot) && !f.guided)) {
        f.guided = false;
        toRoam(f, null, 0);
        return;
      }
      // 견주기: 다른 찌가 훨씬 끌리면(가깝거나 방금 톡 움직였으면) 그쪽으로 갑니다.
      if (t >= f.nextEval && !f.guided) {
        f.nextEval = t + 0.5;
        const b = bestLure(f);
        if (b && b.l !== l && b.s > lureScore(f, l) + 0.35 && l.fishId !== f.id) {
          startApproach(f, b.l);
          return;
        }
      }
      if (m === 'approach') thinkApproach(f, l);
      else thinkInspect(f, l);
      return;
    }
    // 헤엄치기
    if (f.noticeAt && t >= f.noticeAt) {
      f.noticeAt = 0;
      const b = bestLure(f);
      if (b) {
        const p = CURIOUS[f.sp] * (1 - 0.5 * f.big) * (1 + f.noticeBoost) + A.curious;
        if (rand() < p) {
          startApproach(f, b.l);
          return;
        }
        f.ignoreLure[b.l.slot] = t + R(4, 8);
      }
    }
    if (t >= f.nextScan) {
      // 지나가다 근처의 찌를 보는 경우(떨어질 때 못 본 물고기)
      f.nextScan = t + R(1.6, 3.2);
      if (!f.noticeAt) {
        const b = bestLure(f);
        if (b && rand() < 0.42 + A.curious) {
          f.noticeAt = t + R(0.2, 0.9) * A.commit;
          f.noticeBoost = -0.35;
        }
      }
    }
    roam(f);
  }

  function thinkApproach(f, l) {
    const d = d2(f, l);
    if (t - f.approachT0 > (f.guided ? 40 : A.approach)) {
      f.guided = false;
      toRoam(f, l.slot, 10 * A.ignore);
      return;
    }
    f.tx = l.x;
    f.tz = l.z;
    // 안내받는 물고기(튜토리얼)는 조금 서둘러 옵니다.
    const hurry = f.guided ? 1.8 : 1;
    f.tgtSpeed = d > 2 ? (f.len * 1.5 + 0.18) * hurry : clamp(f.len * 0.3 + (d - 0.4) * 0.35, 0.05, f.len * 1.5);
    if (d < f.len * 0.5 + 0.38) {
      f.mode = 'inspect';
      f.orbitA = Math.atan2(f.x - l.x, f.z - l.z);
      f.inspEnd = t + R(0.8, 1.8) * (1 + 1.4 * f.big) * A.commit;
      f.nibsDone = 0;
      f.nibLeft = f.guided ? Math.max(2, A.nibMin) : Math.max(A.nibMin, Math.floor(R(0, 3.99)));
      f.nextNib = t + R(0.35, 0.8);
    }
  }

  function thinkInspect(f, l) {
    if (!l.fishId) l.fishId = f.id;
    const owner = l.fishId === f.id;
    f.tgtSpeed = 0.03;
    if (l.moving) {
      // 감아 들이는 찌를 따라옵니다. 오래 끌면 흥미를 잃습니다.
      f.inspEnd = Math.max(f.inspEnd, t + 0.6);
      if (rand() < 0.004) toRoam(f, l.slot, 6);
      return;
    }
    if (!owner) {
      // 다른 물고기가 먼저 건드리는 중: 한 발 뒤에서 기다리다 지치면 갑니다.
      if (t > f.inspEnd + 4) toRoam(f, l.slot, 8);
      return;
    }
    if (f.nibLeft > 0 && t >= f.nextNib) {
      f.nibLeft -= 1;
      f.nibsDone = (f.nibsDone || 0) + 1;
      f.nibAt = t;
      f.nextNib = t + R(0.6, 1.4);
      if (f.nibLeft === 0) f.inspEnd = Math.max(f.inspEnd, t + R(0.5, 1.2) * Math.max(0.6, A.commit));
      // last: 이 톡톡 다음에는 곧 물 차례(폰에 "곧 쑥 들어가요"를 띄웁니다)
      events.push({ type: 'nibble', fish: f, slot: l.slot, last: f.nibLeft === 0 && A.nibMin > 0 });
      return;
    }
    if (f.nibLeft === 0 && t >= f.inspEnd) {
      const twitched = t - (l.twitchAt || -99) < 2;
      const p = f.guided ? 1 : 0.82 - 0.42 * f.big + (twitched ? 0.3 : 0) + A.biteP;
      if (rand() < p) startBite(f, l);
      else toRoam(f, l.slot, R(8, 14) * A.ignore);
    }
  }

  function roam(f) {
    // 무리(블루길)의 졸개는 대장을 따라갑니다.
    if (f.school && !f.leader) {
      const lead = fish.find((g) => g.school === f.school && g.leader && g.mode !== 'leave');
      if (lead) {
        f.act = 'follow';
        f.tx = lead.x - Math.sin(lead.yaw) * 0.6;
        f.tz = lead.z - Math.cos(lead.yaw) * 0.6;
        const d = Math.hypot(f.tx - f.x, f.tz - f.z);
        f.tgtSpeed = clamp(lead.speed * (0.8 + d * 0.35), 0.02, f.len * 3);
        return;
      }
      f.leader = true;
    }
    if (f.act === 'rise') {
      if (f.y > -0.16 || t > f.actEnd) {
        events.push({ type: 'rise', fish: f, x: f.x + Math.sin(f.yaw) * f.len * 0.45, z: f.z + Math.cos(f.yaw) * f.len * 0.45 });
        f.act = 'wander';
        f.actEnd = t + R(2, 4);
      }
      return;
    }
    const arrived = Math.hypot(f.tx - f.x, f.tz - f.z) < 0.9;
    if (t >= f.actEnd || (arrived && f.act !== 'hover')) {
      const nearCover = coverAt(f.x, f.z);
      const r = rand();
      const pHover = f.sp === 'blg' && f.school ? 0.12 : 0.2 + 0.25 * nearCover + 0.15 * f.big;
      if (r < pHover) {
        f.act = 'hover';
        f.actEnd = t + R(2.5, 7) * (1 + f.big);
        f.tgtSpeed = f.len * 0.04;
        f.tx = f.x + Math.sin(f.yaw) * 0.3;
        f.tz = f.z + Math.cos(f.yaw) * 0.3;
      } else if (r < pHover + 0.05) {
        f.act = 'dart';
        f.actEnd = t + R(0.35, 0.7);
        const a = f.yaw + R(-1.4, 1.4);
        f.tx = f.x + Math.sin(a) * 4;
        f.tz = f.z + Math.cos(a) * 4;
        f.tgtSpeed = f.len * 5 + 0.5;
      } else if (r < pHover + 0.45) {
        f.act = 'wander';
        f.actEnd = t + R(3, 6.5);
        const s = pickSpot(f, f, 4.5);
        f.tx = s.x;
        f.tz = s.z;
        f.tgtSpeed = f.len * R(0.3, 0.5);
      } else {
        f.act = 'cruise';
        f.actEnd = t + R(4, 9);
        const s = pickSpot(f);
        f.tx = s.x;
        f.tz = s.z;
        f.tgtSpeed = f.len * R(0.55, 0.95);
      }
    } else if (f.act === 'dart' && t > f.actEnd - 0.1) f.tgtSpeed = f.len * 0.5;
  }

  // ---------- 움직이기 ----------
  function move(f, dt) {
    const m = f.mode;
    if (m === 'hooked' || m === 'landed') {
      f.phase += dt * f.tailFreq;
      return;
    }
    const free = m === 'enter' || m === 'leave' || m === 'release';
    // 원하는 방향
    let sx = f.tx - f.x;
    let sz = f.tz - f.z;
    let l = null;
    if (m === 'approach' || m === 'inspect') {
      l = lureOf(f.lure);
      if (m === 'inspect' && l) {
        // 미끼 둘레를 천천히 돌며 코를 들이댑니다(주인이 아니면 한 발 뒤에서).
        const owner = l.fishId === f.id;
        f.orbitA += f.orbit * dt * (owner ? 0.28 + 0.25 * f.big : 0.15);
        const nose = f.len * 0.5 + (owner ? 0.1 : 0.55);
        const lunge = owner ? Math.max(0, 1 - Math.abs(t - f.nibAt - 0.12) / 0.14) : 0;
        const r = nose - lunge * 0.12;
        const px = l.x + Math.sin(f.orbitA) * r;
        const pz = l.z + Math.cos(f.orbitA) * r;
        const k = Math.min(1, dt * (lunge > 0 ? 9 : 1.4));
        f.x += (px - f.x) * k;
        f.z += (pz - f.z) * k;
        sx = l.x - f.x;
        sz = l.z - f.z;
      }
    }
    let dl = Math.hypot(sx, sz);
    if (dl > 1e-4) {
      sx /= dl;
      sz /= dl;
    }
    let wx = sx;
    let wz = sz;
    // 앞을 내다보고 물가·얕은 곳·구역 밖을 피합니다.
    const look = 0.8 + f.speed * 1.8;
    const px = f.x + Math.sin(f.yaw) * look;
    const pz = f.z + Math.cos(f.yaw) * look;
    if (!free) {
      if (px < AREA.x0) wx += 1.6;
      if (px > AREA.x1) wx -= 1.6;
      if (pz < AREA.z0) wz += 2.4;
      if (pz > AREA.z1) wz -= 1.6;
      // 화면 양옆 밖으로 나가지 않게(보이는 곳에서 헤엄치게)
      if (!inWedge(px, pz)) wx += px > 0 ? -1.4 : 1.4;
    } else if (pz < AREA.z0) wz += 2.4;
    if (lakeQ(px, pz) > 0.84 || bedDepth(px, pz) < Math.min(f.depth, 1.2) + 0.35) {
      const cx = 0 - f.x;
      const cz = 16 - f.z;
      const cl = Math.hypot(cx, cz) || 1;
      wx += (cx / cl) * 1.8;
      wz += (cz / cl) * 1.8;
    }
    // 서로 부딪히지 않게
    if (m !== 'inspect') {
      for (const g of fish) {
        if (g === f || g.mode === 'landed' || g.mode === 'hooked') continue;
        const dx = f.x - g.x;
        const dz = f.z - g.z;
        const rr = (f.len + g.len) * 1.05 + (f.school && f.school === g.school ? 0.08 : 0.3);
        const dd = dx * dx + dz * dz;
        if (dd < rr * rr && dd > 1e-6) {
          const d = Math.sqrt(dd);
          const k = (1 - d / rr) * 2;
          wx += (dx / d) * k;
          wz += (dz / d) * k;
        }
      }
    }
    steer.x = wx;
    steer.z = wz;
    if (Math.hypot(wx, wz) > 1e-3 && (dl > 0.05 || m !== 'roam' || f.act !== 'hover')) {
      const want = Math.atan2(wx, wz);
      const dy = wrap(want - f.yaw);
      const bl = f.speed / f.len;
      const maxTurn = (m === 'spook' || f.act === 'dart' ? 5 : 0.8 + 1.6 * Math.min(1, bl)) * (m === 'inspect' ? 1.4 : 1);
      const targetRate = clamp(dy * 2.6, -maxTurn, maxTurn);
      f.yawRate += (targetRate - f.yawRate) * Math.min(1, dt * 5);
    } else f.yawRate *= Math.exp(-dt * 3);
    f.yaw = wrap(f.yaw + f.yawRate * dt);
    // 속도(부드럽게)
    const fast = m === 'spook' || f.act === 'dart' || m === 'leave';
    const acc = (fast ? 7 : 0.7) * Math.max(0.5, f.len / 0.35);
    const dv = f.tgtSpeed - f.speed;
    f.speed += clamp(dv, -acc * dt * 1.5, acc * dt);
    if (m === 'spook' && t > f.spookEnd - 0.5) f.tgtSpeed = f.len * 0.8;
    // 앞으로
    const nx = f.x + Math.sin(f.yaw) * f.speed * dt;
    const nz = f.z + Math.cos(f.yaw) * f.speed * dt;
    const minBed = free ? 0.4 : 0.3;
    if (lakeQ(nx, nz) < 0.9 && bedDepth(nx, nz) > minBed && (nz > AREA.z0 - 0.6 || free)) {
      f.x = nx;
      f.z = nz;
    } else {
      f.yawRate += (f.yawRate >= 0 ? 1 : -1) * dt * 6;
      f.speed *= 0.9;
    }
    // 깊이
    let want = prefDepth(f, f.x, f.z);
    if (m === 'approach' || m === 'inspect') want = Math.min(prefDepth(f, f.x, f.z) + 0.6, BAIT_DEPTH + 0.05);
    else if (m === 'bite') want = BAIT_DEPTH + 0.35;
    else if (m === 'spook') want = Math.min(bedDepth(f.x, f.z) - 0.2, f.depth + 0.4);
    else if (m === 'release' || m === 'leave') want = Math.max(0.6, bedDepth(f.x, f.z) - 0.4);
    else if (f.act === 'rise') want = 0.05;
    else want += 0.08 * Math.sin(f.phase * 0.05 + f.id);
    want = clamp(want, 0.05, Math.max(0.1, bedDepth(f.x, f.z) - f.len * 0.14 - 0.05));
    const vy = clamp((-want - f.y) * 1.3, -0.4, 0.4);
    f.vy += (vy - f.vy) * Math.min(1, dt * 4);
    f.y += f.vy * dt;
    f.pitch = Math.atan2(f.vy, Math.max(0.12, f.speed)) * 0.6;
    f.roll += (clamp(-f.yawRate * 0.12, -0.3, 0.3) - f.roll) * Math.min(1, dt * 3);
    // 꼬리: 빠를수록 빨리, 크게. 돌 때는 몸이 휩니다.
    const bl = f.speed / f.len;
    f.tailFreq = 3 + 8 * Math.min(bl, 3.5);
    f.tailAmp = 0.012 + 0.03 * Math.min(1, bl / 2.5);
    f.curl = clamp(-f.yawRate * 0.08, -0.22, 0.22);
    f.phase += dt * f.tailFreq;
  }

  // ---------- 바깥(게임)에서 부르는 것 ----------
  function byId(id) {
    for (const f of fish) if (f.id === id) return f;
    return null;
  }
  function exitFor(f) {
    const side = f.x >= 0 ? 1 : -1;
    if (f.z > 24) return { x: f.x * 0.3, z: 40 };
    return { x: side * 18.5, z: clamp(f.z, 5, 11) };
  }
  function steal(f) {
    if (!f || f.mode !== 'bite') return;
    const slot = f.lure;
    releaseClaim(f);
    events.push({ type: 'steal', fish: f, slot });
    const l = lureList.find((x) => x.slot === slot);
    spook(f, l ? l.x : f.x - Math.sin(f.yaw), l ? l.z : f.z - Math.cos(f.yaw), R(1.2, 2), 6 * A.ignore);
    f.ignoreLure[slot] = t + 22 * A.ignore;
  }
  function hook(f, slot) {
    releaseClaim(f);
    f.mode = 'hooked';
    f.hookSlot = slot;
    f.lure = null;
  }
  // 걸린 물고기·들어 올린 물고기는 게임이 위치를 정합니다.
  function drive(f, x, y, z, yaw, pitch, roll, thrash) {
    const dt = 1 / 60;
    const sp = Math.hypot(x - f.x, z - f.z) / dt;
    f.speed += (Math.min(sp, 4) - f.speed) * 0.2;
    f.x = x;
    f.y = y;
    f.z = z;
    f.yaw = yaw;
    f.pitch = pitch;
    f.roll = roll;
    f.thrash = thrash;
    f.tailFreq = 10 + 14 * thrash;
    f.tailAmp = 0.03 + 0.05 * thrash;
  }
  function land(f) {
    f.mode = 'landed';
    releaseClaim(f);
  }
  function startLeave(f, mode) {
    releaseClaim(f);
    f.mode = mode;
    f.lure = null;
    f.hookSlot = null;
    f.leaveT0 = t;
    const e = exitFor(f);
    f.exitX = e.x;
    f.exitZ = e.z;
  }
  // 놓아주기: (x, z) 에 떨어뜨리면 깊이 내려가며 헤엄쳐 나갑니다.
  function release(f, x, z) {
    startLeave(f, 'release');
    f.x = x;
    f.z = z;
    f.y = -0.12;
    f.yaw = Math.atan2(f.x >= 0 ? 0.6 : -0.6, 1) + R(-0.4, 0.4);
    f.tx = f.x + Math.sin(f.yaw) * 5;
    f.tz = f.z + Math.cos(f.yaw) * 5;
    f.speed = f.len * 2;
    f.tgtSpeed = f.len * 3 + 0.4;
    f.pitch = -0.4;
    f.roll = 0;
  }
  // 줄이 끊기거나 바늘이 빠진 물고기: 물보라와 함께 달아나 화면 밖으로 나갑니다.
  function lose(f, fromX, fromZ) {
    startLeave(f, 'leave');
    const a = Math.atan2(f.x - fromX, Math.max(0.5, f.z - fromZ)) + R(-0.5, 0.5);
    f.tx = f.x + Math.sin(a) * 6;
    f.tz = f.z + Math.cos(a) * 6;
    f.yaw = a;
    f.speed = f.len * 4;
    f.tgtSpeed = f.len * 5.5 + 0.8;
  }
  // 너무 일찍 챘을 때: 그 물고기는 한동안 어떤 찌에도 오지 않습니다.
  function scare(f, fromX, fromZ) {
    spook(f, fromX, fromZ, R(1.2, 2), R(25, 40) * A.ignore);
  }
  // 일찍 챘지만 놀라지 않은 경우(쉬운 난이도): 잠깐 물러섰다가 다시 살핍니다.
  function startle(f) {
    if (!f || f.mode !== 'inspect') return;
    f.orbitA += R(-0.6, 0.6);
    f.nibAt = t - 1;
    f.nextNib = Math.max(f.nextNib, t + R(0.7, 1.2));
    f.nibLeft = Math.max(f.nibLeft, 1);
  }
  // 튜토리얼: 이 찌로 물고기 한 마리를 데려와 톡톡 두 번 뒤 꼭 물게 합니다.
  // 가까이 헤엄치는 물고기를 먼저 고르고, 없으면 작은 물고기를 조금 떨어진 깊은 곳에 내보냅니다.
  function guide(l, { maxW = 1.4 } = {}) {
    if (!l || !l.active) return null;
    let best = null;
    let bd = 1e9;
    for (const f of fish) {
      if (f.mode !== 'roam' && f.mode !== 'approach' && f.mode !== 'inspect' && f.mode !== 'enter') continue;
      if (f.w > maxW || (f.lure != null && f.lure !== l.slot && f.mode !== 'roam')) continue;
      const d = d2(f, l);
      if (d < bd && d < 8) {
        bd = d;
        best = f;
      }
    }
    if (!best) {
      for (let i = 0; i < 12 && !best; i++) {
        const a = R(0, Math.PI * 2);
        const x = l.x + Math.sin(a) * 3.2;
        const z = l.z + Math.cos(a) * 3.2;
        if (lakeQ(x, z) > 0.84 || bedDepth(x, z) < 1.1 || z < AREA.z0 + 0.6) continue;
        best = spawn(true, rand() < 0.5 ? 'blg' : 'lmb', rand() < 0.5 ? 0.22 : 0.7, { x, z });
        if (best) best.y = -Math.min(1.2, bedDepth(x, z) - 0.2);
      }
      if (!best) return null;
    }
    releaseClaim(best);
    best.ignoreUntil = 0;
    best.ignoreLure = {};
    best.noticeAt = 0;
    best.guided = true;
    startApproach(best, l);
    return best;
  }
  function setAssist(a) {
    A = a || ASSIST.hard;
  }
  // 자리를 비운 사람: 그 자리 번호에 남은 물고기 기억(외면 시간·다가가던 찌)을 지웁니다.
  // 들락날락이 잦으면 새로 들어온 사람이 앞사람이 놓친 물고기들의 '외면'을 물려받아 한동안 아무것도 안 무는 일이 있었습니다.
  function forgetSlot(slot) {
    for (const f of fish) {
      if (f.ignoreLure[slot]) delete f.ignoreLure[slot];
      if (f.lure === slot && (f.mode === 'approach' || f.mode === 'inspect' || f.mode === 'bite')) {
        f.guided = false;
        toRoam(f, null, 0);
      }
    }
    for (const l of lureList) if (l.slot === slot) l.fishId = null;
  }
  // 시험용: 이 찌를 바로 물게 합니다.
  function forceBite(f, l) {
    if (!f || !l) return false;
    releaseClaim(f);
    const a = Math.atan2(f.x - l.x, f.z - l.z) || 0;
    f.x = l.x + Math.sin(a) * (f.len * 0.5 + 0.1);
    f.z = l.z + Math.cos(a) * (f.len * 0.5 + 0.1);
    f.y = -BAIT_DEPTH - 0.05;
    f.yaw = a + Math.PI;
    f.ignoreUntil = 0;
    f.ignoreLure = {};
    startBite(f, l);
    return true;
  }
  // 입 위치(줄이 닿는 곳). f.vis 는 화면이 그리는 크기 배율입니다.
  function mouth(f, out) {
    const h = f.len * (f.vis || 1) * 0.5;
    const cp = Math.cos(f.pitch);
    out.x = f.x + Math.sin(f.yaw) * cp * h;
    out.y = f.y + Math.sin(f.pitch) * h;
    out.z = f.z + Math.cos(f.yaw) * cp * h;
    return out;
  }
  function setTarget(n) {
    target = clamp(Math.round(n), 1, 40);
  }

  // 처음에는 화면 안에 바로 깔아 둡니다(첫 화면부터 물고기가 보이게).
  {
    let guard = 0;
    while (aliveCount() < target && guard++ < 60) spawn(true);
  }

  return {
    fish, update, byId, steal, hook, drive, land, release, lose, scare, startle, guide, setAssist, forgetSlot, forceBite, mouth, setTarget,
    get assist() { return A; },
    spawn: (species, weight, at) => spawn(!!at, species, weight, at),
    aliveCount, get target() { return target; }, get time() { return t; }
  };
}

export { SPECIES };
