// 볼링 점수 계산(순수 함수). 화면(game.js)과 시험(scripts/test-bowling-scoring.mjs)이 같이 씁니다.
// 투구 기록 rolls 는 쓰러뜨린 핀 수의 목록입니다. frames 는 판 길이(10 또는 5). 마지막 프레임만 보너스 투구를 받습니다.

/** 한 사람의 투구 기록을 프레임별로 풀어 줍니다. */
export function scoreGame(rolls, frames = 10) {
  const out = [];
  let i = 0;
  let current = null; // 다음에 던질 차례 { frame, ball, standing }
  let done = false;
  for (let f = 0; f < frames; f++) {
    const last = f === frames - 1;
    const fr = { rolls: [], marks: [], score: null, total: null, done: false };
    out.push(fr);
    if (current) continue; // 앞 프레임이 아직 안 끝났으면 뒤는 비어 있음
    const r1 = rolls[i];
    if (r1 === undefined) { if (!current) current = { frame: f, ball: 0, standing: 10 }; continue; }
    fr.rolls.push(r1);
    if (!last) {
      if (r1 === 10) { fr.marks = ['X']; fr.done = true; i += 1; fr.start = i - 1; continue; }
      const r2 = rolls[i + 1];
      if (r2 === undefined) { if (!current) current = { frame: f, ball: 1, standing: 10 - r1 }; fr.marks = [mark1(r1)]; continue; }
      fr.rolls.push(r2);
      fr.marks = [mark1(r1), r1 + r2 === 10 ? '/' : mark1(r2)];
      fr.done = true;
      i += 2;
      continue;
    }
    // 마지막 프레임: 스트라이크·스파는 3구까지
    const r2 = rolls[i + 1];
    const r3 = rolls[i + 2];
    fr.marks = [mark1(r1)];
    if (r2 === undefined) { current = current || { frame: f, ball: 1, standing: r1 === 10 ? 10 : 10 - r1 }; continue; }
    fr.rolls.push(r2);
    const m2 = r1 === 10 ? mark1(r2) : r1 + r2 === 10 ? '/' : mark1(r2);
    fr.marks.push(m2);
    const bonus = r1 === 10 || r1 + r2 === 10;
    if (!bonus) { fr.done = true; i += 2; continue; }
    if (r3 === undefined) {
      const standing = r1 === 10 ? (r2 === 10 ? 10 : 10 - r2) : 10;
      current = current || { frame: f, ball: 2, standing };
      continue;
    }
    fr.rolls.push(r3);
    let m3;
    if (r1 === 10 && r2 !== 10) m3 = r2 + r3 === 10 ? '/' : mark1(r3);
    else m3 = mark1(r3);
    fr.marks.push(m3);
    fr.done = true;
    i += 3;
  }
  if (!current) done = true;
  // 누적 점수: 보너스가 정해진 프레임까지만 채웁니다.
  let total = 0;
  let k = 0;
  for (let f = 0; f < frames; f++) {
    const last = f === frames - 1;
    const fr = out[f];
    if (!fr.done) break;
    let s;
    if (last) s = fr.rolls.reduce((a, b) => a + b, 0);
    else if (fr.rolls[0] === 10) {
      if (rolls[k + 1] === undefined || rolls[k + 2] === undefined) break;
      s = 10 + rolls[k + 1] + rolls[k + 2];
    } else if (fr.rolls[0] + fr.rolls[1] === 10) {
      if (rolls[k + 2] === undefined) break;
      s = 10 + rolls[k + 2];
    } else s = fr.rolls[0] + fr.rolls[1];
    k += fr.rolls.length;
    // 마지막이 아닌 프레임에서 k 는 그 프레임이 쓴 투구 수만큼만 전진
    total += s;
    fr.score = s;
    fr.total = total;
  }
  const lastDone = [...out].reverse().find((f) => f.total !== null);
  return { frames: out, total: lastDone ? lastDone.total : 0, done, current };
}
const mark1 = (n) => (n === 10 ? 'X' : n === 0 ? '-' : String(n));

/** 다음 투구가 설 자리: { over, frame, ball, standing } */
export function nextBall(rolls, frames = 10) {
  const g = scoreGame(rolls, frames);
  if (g.done) return { over: true, frame: frames - 1, ball: 0, standing: 10 };
  return { over: false, ...g.current };
}

/** 투구 하나를 더합니다(검증 포함). 새 배열을 돌려줍니다. */
export function addRoll(rolls, pins, frames = 10) {
  const nb = nextBall(rolls, frames);
  if (nb.over) throw new Error('이미 끝난 판입니다');
  if (!Number.isInteger(pins) || pins < 0 || pins > nb.standing) throw new Error(`핀 수가 맞지 않아요: ${pins} (서 있는 핀 ${nb.standing})`);
  return [...rolls, pins];
}

/** 이번 투구가 끝난 뒤 핀을 새로 세워야 하는지(새 프레임이거나 마지막 프레임 보너스) */
export function needsFreshRack(rolls, frames = 10) {
  const nb = nextBall(rolls, frames);
  return nb.over || nb.standing === 10;
}

/** 지금 점수로 낼 수 있는 가장 높은 점수(남은 투구를 전부 스트라이크라 보고) */
export function maxPossible(rolls, frames = 10) {
  let r = [...rolls];
  for (let guard = 0; guard < 60; guard++) {
    const nb = nextBall(r, frames);
    if (nb.over) break;
    r = [...r, nb.standing];
  }
  return scoreGame(r, frames).total;
}

/** 터키(스트라이크 3연속 이상)를 세어 줍니다: 지금까지 이어진 스트라이크 수 */
export function strikeStreak(rolls, frames = 10) {
  const g = scoreGame(rolls, frames);
  let n = 0;
  for (const f of g.frames) {
    if (!f.rolls.length) break;
    for (const m of f.marks) { if (m === 'X') n += 1; else n = 0; }
    if (f.marks.length > 1 && f.marks[0] !== 'X' && f.marks[1] !== 'X') n = 0;
  }
  // 마지막으로 던진 공이 스트라이크가 아니면 0
  const lastRoll = rolls[rolls.length - 1];
  return lastRoll === 10 ? n : 0;
}
