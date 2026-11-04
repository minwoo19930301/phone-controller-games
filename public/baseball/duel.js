// 투타 대결 규칙. 화면·소리 없이 숫자만 다룹니다(노드에서도 그대로 돌아갑니다).
// 좌표는 scene.js 와 같습니다: 홈플레이트가 원점, +x 가 3루(좌익수) 쪽, 단위는 m.

export const RULES = {
  INNINGS: 2, // 한 사람이 타자로 서는 이닝 수
  OUTS: 3, // 하프 이닝은 3아웃이면 끝
  MAX_PA: 6, // 아웃이 덜 나와도 6타석이면 공수 교대
  BALLS: 4,
  STRIKES: 3
};

// 스트라이크 존(m). 홈플레이트 폭 43cm 에 공 반지름을 더한 폭, 높이는 무릎~가슴.
export const ZONE = { x: 0.25, lo: 0.5, hi: 1.1 };
// 폰 조준판이 덮는 범위(m). 존보다 넓어서 일부러 볼을 던질 수 있습니다.
export const PAD = { x: 0.6, cy: 0.8, h: 0.6 };
// 존에서 이만큼(m) 넘게 벗어난 공은 방망이가 닿지 않습니다.
export const REACH = 0.3;
// 뜬공 잡기: 야수 달리기 속도(m/s), 반응 시간(초), 아무리 오래 떠 있어도 이보다 멀면 못 잡음(m), 글러브 높이(m)
export const CATCH = { speed: 6.5, react: 0.5, max: 16, glove: 1.2 };

// 구질. kmh 는 폰 없이 던질 때(P 키·봇·자동 투구) 쓰는 범위입니다.
// brk: 처음 날아가던 방향에서 끝에 얼마나 벗어나는지(m). x 는 장면 좌표(+x 가 3루 쪽), 슬라이더는 side 를 곱합니다.
// pow: 클수록 늦게 꺾입니다(2 = 고르게, 4 = 홈플레이트 앞에서 뚝).
// contact: 맞혔을 때 타구 질 보정, la: 발사각 보정(도). 늦게 꺾이는 공일수록 정타가 어렵고, 떨어지는 공은 땅볼이 많습니다.
export const PITCHES = {
  fastball: { name: '직구', kmh: [138, 152], brk: [0, 0.06], pow: 2, contact: 1, la: 2 },
  slider: { name: '슬라이더', kmh: [126, 138], brk: [-0.34, -0.1], pow: 3, contact: 0.9, la: 0 },
  curve: { name: '커브', kmh: [108, 120], brk: [-0.06, -0.6], pow: 2, contact: 0.92, la: -3 },
  fork: { name: '포크볼', kmh: [125, 136], brk: [0.03, -0.45], pow: 4, contact: 0.85, la: -7 }
};
export const PITCH_KEYS = Object.keys(PITCHES);

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 대략 표준정규분포(-3~3)
export function gauss(rand = Math.random) {
  return (rand() + rand() + rand() - 1.5) / 0.5;
}

// 폰 조준판 값(-1~1) → 홈플레이트를 지나는 위치(m).
// 조준판은 큰 화면(포수 뒤 카메라)과 같은 방향입니다. 오른쪽(+) 은 화면 오른쪽 = 1루 쪽 = 장면 -x.
export function aimToPlate(aimX, aimY) {
  const ax = clamp(Number(aimX) || 0, -1, 1);
  const ay = clamp(Number(aimY) || 0, -1, 1);
  return [-ax * PAD.x, PAD.cy + ay * PAD.h];
}
export function plateToAim(x, y) {
  return [-x / PAD.x, (y - PAD.cy) / PAD.h];
}

// 존 밖으로 벗어난 거리(m). 존 안이면 0.
export function zoneMiss(x, y) {
  const dx = Math.max(0, Math.abs(x) - ZONE.x);
  const dy = Math.max(0, ZONE.lo - y, y - ZONE.hi);
  return Math.hypot(dx, dy);
}
export const inZone = (x, y) => zoneMiss(x, y) === 0;

// 빠를수록, 커브일수록 제구가 흔들립니다(표준편차, m).
export function controlSigma(kmh, kind) {
  return 0.04 + 0.035 * clamp((kmh - 120) / 35, 0, 1) + (kind === 'curve' ? 0.015 : 0);
}

// 투구 궤적 한 점. 처음엔 (끝 - 꺾임) 쪽으로 곧게 오다가 pow 에 따라 늦게 끝점으로 꺾입니다.
// p(u) = 직선(u) + brk·(u^pow - u). u=0 이면 놓은 곳, u=1 이면 끝점입니다.
export function pitchPoint(R, end, type, side, u) {
  const f = Math.pow(Math.max(0, u), type.pow) - u;
  const bx = type.brk[0] * (side < 0 ? -1 : 1);
  const by = type.brk[1];
  return [
    R[0] + (end[0] - R[0]) * u + bx * f,
    R[1] + (end[1] - R[1]) * u + by * f,
    R[2] + (0.1 - R[2]) * u
  ];
}

// 폰 없이 던지는 공(P 키·봇·자동 투구). 70% 는 존 안을 노립니다.
export function randomThrow(rand = Math.random) {
  const bag = ['fastball', 'fastball', 'fastball', 'slider', 'slider', 'curve', 'fork'];
  const type = bag[Math.floor(rand() * bag.length)];
  const t = PITCHES[type];
  const zx = ZONE.x / PAD.x;
  const zy = (ZONE.hi - ZONE.lo) / 2 / PAD.h;
  const inside = rand() < 0.7;
  return {
    type,
    side: 1,
    speed: Math.round(t.kmh[0] + rand() * (t.kmh[1] - t.kmh[0])),
    aimX: (rand() * 2 - 1) * (inside ? zx * 0.85 : 0.9),
    aimY: (rand() * 2 - 1) * (inside ? zy * 0.85 : 0.9)
  };
}

// ---------- 경기 순서 ----------
// 이닝 r 에서 i 번째 사람은 order[(i + 1 + r % (n-1)) % n] 의 공을 칩니다.
// 2명은 서로 번갈아, 3명은 두 이닝 동안 나머지 두 사람을 한 번씩 상대합니다(4명은 세 명 중 두 명).
export function makeSchedule(order, innings = RULES.INNINGS) {
  const n = order.length;
  const out = [];
  if (n < 2) return out;
  for (let r = 0; r < innings; r++) {
    const off = 1 + (r % (n - 1));
    order.forEach((bat, i) => out.push({ inning: r, bat, pit: order[(i + off) % n] }));
  }
  return out;
}

export function newDuel(order) {
  const stats = {};
  const line = {};
  for (const s of order) {
    stats[s] = { r: 0, h: 0, hr: 0, bb: 0, k: 0, so: 0, ra: 0 };
    line[s] = Array(RULES.INNINGS).fill(null);
  }
  const d = { order: [...order], schedule: makeSchedule(order), hi: 0, b: 0, s: 0, o: 0, pa: 0,
    bases: [false, false, false], stats, line, track: [], n: 0 };
  if (d.schedule.length) line[d.schedule[0].bat][0] = 0;
  return d;
}

export const half = (d) => d.schedule[d.hi];

// 다음 하프 이닝으로. 끝났으면 false.
export function nextHalf(d) {
  d.hi += 1;
  d.b = 0;
  d.s = 0;
  d.o = 0;
  d.pa = 0;
  d.bases = [false, false, false];
  d.track = [];
  const h = half(d);
  if (!h) return false;
  if (d.line[h.bat][h.inning] == null) d.line[h.bat][h.inning] = 0;
  return true;
}

// ---------- 주자 ----------
// 안타는 모든 주자가 친 만큼(1~4루) 나갑니다. 단타면 한 베이스씩, 2루타면 두 베이스씩.
export function advance(bases, n) {
  const nb = [false, false, false];
  let runs = 0;
  for (let i = 2; i >= 0; i--) {
    if (!bases[i]) continue;
    if (i + n >= 3) runs += 1;
    else nb[i + n] = true;
  }
  if (n >= 4) runs += 1;
  else nb[n - 1] = true;
  return { bases: nb, runs };
}

// 볼넷은 밀려나는 주자만 움직입니다.
export function walk(bases) {
  const [a, b, c] = bases;
  if (!a) return { bases: [true, b, c], runs: 0 };
  if (!b) return { bases: [true, true, c], runs: 0 };
  if (!c) return { bases: [true, true, true], runs: 0 };
  return { bases: [true, true, true], runs: 1 };
}

// 친 공의 결과. b = { foul, homer, la, ev, dist, fence, caught }
export function battedOutcome(b) {
  if (b.foul) return { kind: 'foul', text: '파울' };
  if (b.homer) return { kind: 'hit', bases: 4, text: '홈런' };
  if (b.la > 50 && b.dist < 60) return { kind: 'out', text: '내야 플라이' };
  if (b.la < 9) return b.ev > 150 ? { kind: 'hit', bases: 1, text: '안타' } : { kind: 'out', text: '땅볼 아웃' };
  if (b.caught) return { kind: 'out', text: b.la < 20 ? '직선타 아웃' : '뜬공 아웃' };
  if (b.dist > b.fence - 12) return { kind: 'hit', bases: 3, text: '3루타' };
  if (b.dist > 80) return { kind: 'hit', bases: 2, text: '2루타' };
  return { kind: 'hit', bases: 1, text: '안타' };
}

// 뜬공·직선타: 내려오다 글러브 높이를 지나는 점까지 가장 가까운 야수가 닿으면 잡습니다.
// path 는 1/120초 간격 점들, spots 는 야수 자리 [[x, z], ...].
export function catchPoint(path, spots) {
  let peak = 0;
  for (let i = 1; i < path.length; i++) if (path[i][1] > path[peak][1]) peak = i;
  let k = path.length - 1;
  for (let i = peak; i < path.length; i++) {
    if (path[i][1] <= CATCH.glove) {
      k = i;
      break;
    }
  }
  const p = path[k];
  let near = Infinity;
  for (const [x, z] of spots) near = Math.min(near, Math.hypot(p[0] - x, p[2] - z));
  const hang = k / 120;
  const reach = Math.min(CATCH.max, CATCH.speed * Math.max(0, hang - CATCH.react));
  return { index: k, caught: near <= reach, near, hang, reach };
}

// 공 하나의 결과를 볼카운트·주자·점수에 반영합니다.
// ev.kind: 'ball' | 'strike'(루킹) | 'whiff'(헛스윙) | 'foul' | 'out' | 'hit'(ev.bases)
export function applyPitch(d, ev) {
  const h = half(d);
  const bat = d.stats[h.bat];
  const pit = d.stats[h.pit];
  let text = ev.text || '';
  let tag = ev.kind;
  let paEnd = false;
  let runs = 0;
  if (ev.kind === 'ball') {
    d.b += 1;
    text = '볼';
    if (d.b >= RULES.BALLS) {
      const w = walk(d.bases);
      d.bases = w.bases;
      runs = w.runs;
      bat.bb += 1;
      text = '볼넷';
      tag = 'walk';
      paEnd = true;
    }
  } else if (ev.kind === 'strike' || ev.kind === 'whiff') {
    d.s += 1;
    text = ev.kind === 'strike' ? '스트라이크' : '헛스윙';
    if (d.s >= RULES.STRIKES) {
      d.o += 1;
      bat.k += 1;
      pit.so += 1;
      text = '삼진';
      tag = 'k';
      paEnd = true;
    }
  } else if (ev.kind === 'foul') {
    // 2스트라이크 뒤 파울은 볼카운트가 그대로입니다.
    if (d.s < RULES.STRIKES - 1) d.s += 1;
    text = '파울';
  } else if (ev.kind === 'out') {
    d.o += 1;
    paEnd = true;
  } else if (ev.kind === 'hit') {
    const a = advance(d.bases, ev.bases);
    d.bases = a.bases;
    runs = a.runs;
    bat.h += 1;
    if (ev.bases >= 4) bat.hr += 1;
    paEnd = true;
  }
  if (runs) {
    bat.r += runs;
    pit.ra += runs;
    d.line[h.bat][h.inning] = (d.line[h.bat][h.inning] || 0) + runs;
  }
  if (paEnd) {
    d.b = 0;
    d.s = 0;
    d.pa += 1;
  }
  const halfEnd = d.o >= RULES.OUTS || (paEnd && d.pa >= RULES.MAX_PA);
  return { text, tag, paEnd, halfEnd, runs };
}

// 순위: 득점, 같으면 안타, 홈런, 탈삼진 순.
export function ranking(d) {
  return [...d.order].sort((a, b) => {
    const x = d.stats[a];
    const y = d.stats[b];
    return y.r - x.r || y.h - x.h || y.hr - x.hr || y.so - x.so;
  });
}
