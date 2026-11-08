// 클럽 표(가방 순서). three 없이 쓰는 순수 데이터라 폰 컨트롤러도 그대로 불러 씁니다.
// 수치는 보통 아마추어 남성 기준(캐리 m, 스핀 rpm, 발사각 도, 헤드 속도 km/h)입니다.
// CLUBS 는 배열이면서 CLUBS['7I'] 처럼 아이디로도 찾을 수 있습니다.
export const CLUBS = [
  { id: '1W', short: '1W', name: '드라이버', kind: 'wood', loft: 10.5, lie: 58, lengthM: 1.143, carryM: 195, spin: 3300, launch: 12.6, smash: 1.42, headKmh: 150 },
  { id: '3W', short: '3W', name: '3번 우드', kind: 'wood', loft: 15, lie: 58.5, lengthM: 1.092, carryM: 175, spin: 3900, launch: 11.5, smash: 1.4, headKmh: 145 },
  { id: '5W', short: '5W', name: '5번 우드', kind: 'wood', loft: 18, lie: 59, lengthM: 1.067, carryM: 162, spin: 4500, launch: 12.5, smash: 1.38, headKmh: 141 },
  { id: '4H', short: '4H', name: '유틸리티', kind: 'hybrid', loft: 22, lie: 60, lengthM: 1.016, carryM: 152, spin: 4900, launch: 13.5, smash: 1.36, headKmh: 137 },
  { id: '5I', short: '5I', name: '5번 아이언', kind: 'iron', loft: 25, lie: 61, lengthM: 0.965, carryM: 145, spin: 5300, launch: 14, smash: 1.33, headKmh: 133 },
  { id: '6I', short: '6I', name: '6번 아이언', kind: 'iron', loft: 28, lie: 61.5, lengthM: 0.953, carryM: 136, spin: 6000, launch: 16, smash: 1.32, headKmh: 129 },
  { id: '7I', short: '7I', name: '7번 아이언', kind: 'iron', loft: 32, lie: 62, lengthM: 0.94, carryM: 127, spin: 6700, launch: 18, smash: 1.3, headKmh: 125 },
  { id: '8I', short: '8I', name: '8번 아이언', kind: 'iron', loft: 36, lie: 62.5, lengthM: 0.927, carryM: 117, spin: 7500, launch: 20, smash: 1.28, headKmh: 121 },
  { id: '9I', short: '9I', name: '9번 아이언', kind: 'iron', loft: 41, lie: 63, lengthM: 0.914, carryM: 107, spin: 8300, launch: 22, smash: 1.25, headKmh: 117 },
  { id: 'PW', short: 'PW', name: '피칭 웨지', kind: 'wedge', loft: 46, lie: 63.5, lengthM: 0.902, carryM: 97, spin: 9000, launch: 25, smash: 1.22, headKmh: 113 },
  { id: 'SW', short: 'SW', name: '샌드 웨지', kind: 'wedge', loft: 56, lie: 64, lengthM: 0.889, carryM: 75, spin: 9800, launch: 30, smash: 1.15, headKmh: 105 },
  { id: 'PT', short: 'PT', name: '퍼터', kind: 'putter', loft: 3, lie: 71, lengthM: 0.876, carryM: 0, spin: 0, launch: 2, smash: 1, headKmh: 0 }
];
for (const c of CLUBS) CLUBS[c.id] = c;

// 예전 아이디('7i', 'pw')도 받아 줍니다.
export function clubById(id) {
  if (!id) return CLUBS['7I'];
  return CLUBS[id] || CLUBS[String(id).toUpperCase()] || CLUBS['7I'];
}

// 남은 거리(m)에 맞는 클럽. 그린 위면 퍼터, 티샷이 아니면 드라이버는 빼고, 짧은 쪽부터 캐리가 거리에 닿는 첫 클럽을 고릅니다.
export function recommendClub(distM, { onGreen = false, tee = false } = {}) {
  if (onGreen) return 'PT';
  const bag = CLUBS.filter((c) => c.kind !== 'putter' && (tee || c.id !== '1W'));
  for (let i = bag.length - 1; i >= 0; i--) if (bag[i].carryM >= distM * 0.97) return bag[i].id;
  return bag[0].id;
}
