// 양궁 점수 계산(순수 모듈). 과녁 면은 지름 122cm, 링 10개(폭 6.1cm), 10점 안쪽에 X 링.
// 화살이 선에 걸치면 높은 점수(라인 커터 규칙): 화살 굵기의 절반만큼 중심 쪽으로 당겨서 잽니다.
export const FACE_R = 0.61; // 과녁 반지름(m)
export const RING_W = 0.061; // 링 폭(m)
export const X_R = 0.0305; // X 링 반지름(m)
export const ARROW_R = 0.0045; // 화살대 반지름(m, 지름 약 9mm 로 넉넉하게 잡음)

// 링 점수 → 바깥 반지름. 10점 = 6.1cm … 1점 = 61cm
export const RING_OUTER = Array.from({ length: 10 }, (_, i) => RING_W * (i + 1)); // 인덱스 0 = 10점
export const ringOuter = (score) => RING_W * (11 - score);

// 링 색(10·9 금, 8·7 빨강, 6·5 파랑, 4·3 검정, 2·1 흰색)
export const RING_COLORS = {
  10: '#f8d23a', 9: '#f8d23a', 8: '#d8332f', 7: '#d8332f', 6: '#2f83c9', 5: '#2f83c9', 4: '#1d1d22', 3: '#1d1d22', 2: '#f2f2ee', 1: '#f2f2ee'
};

// (x, y) = 과녁 중심에서 화살 중심까지(m). 반환: { score, label, isX, miss, dist }
export function scoreArrow(x, y, arrowR = ARROW_R) {
  const dist = Math.hypot(x, y);
  const d = Math.max(0, dist - arrowR); // 선에 닿으면 안쪽 링
  if (!(d <= FACE_R)) return { score: 0, label: 'M', isX: false, miss: true, dist };
  if (d <= X_R) return { score: 10, label: 'X', isX: true, miss: false, dist };
  const score = Math.max(1, 10 - Math.floor((d - 1e-12) / RING_W));
  return { score, label: String(score), isX: false, miss: false, dist };
}

// 순위: 총점 > X 개수 > 10점 개수(X 도 10점으로 셈). 셋 다 같으면 공동 순위.
// players: [{ slot, total, xs, tens }]. 반환: 순위 순으로 정렬한 복사본에 rank 를 붙임.
export function compareScores(a, b) {
  return (b.total - a.total) || (b.xs - a.xs) || (b.tens - a.tens);
}
export function rankPlayers(players) {
  const rows = players.map((p) => ({ ...p })).sort((a, b) => compareScores(a, b) || (a.slot - b.slot));
  rows.forEach((r, i) => { r.rank = i > 0 && compareScores(rows[i - 1], r) === 0 ? rows[i - 1].rank : i + 1; });
  return rows;
}
// 화살 목록([{score,isX}])의 합계
export function tally(arrows) {
  let total = 0, xs = 0, tens = 0;
  for (const a of arrows) {
    total += a.score;
    if (a.isX) xs += 1;
    if (a.score === 10) tens += 1;
  }
  return { total, xs, tens };
}
