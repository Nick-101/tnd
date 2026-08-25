// 검수용 봇 — "짝수 빌드" 아키타입으로 플레이한다.
// 전략: 짝수 눈을 잠가 모으고, 정비에서 변경권으로 홀수 면을 짝수로 바꾸며,
// 총점 배율(오케스트라)과 짝수 시너지 스킬을 우선 장착해 곱연산 성장을 만든다.
import { Game, mulberry32, applyEffect } from '../js/game.js';
import { SKILLS_BY_ID, DICE_COUNT, FACE_COUNT, condAllows } from '../js/config.js';

const TOTAL_PRIORITY = { totalMultEven4: 200, totalMultTriple: 120, totalFlat: 60, totalMultOdd4: 0 };

function gameCtx(g) {
  return {
    stage: g.stageNumber,
    score: g.score,
    equippedCount: g.dice.reduce((n, d) => n + d.skills.filter(Boolean).length, 0),
  };
}

// 면 하나의 기대 기여도 (총점 계열은 우선순위 근사치)
export function estimate(g, dieIndex, faceIdx, boardFaces) {
  const die = g.dice[dieIndex];
  const v = die.faces[faceIdx];
  const skillId = die.skills[faceIdx];
  if (!skillId) return v;
  const s = SKILLS_BY_ID[skillId];
  if (s.effect.type.startsWith('total')) return v + 20; // 총점 배율 면은 잡히면 잠글 가치가 크다
  const faces = boardFaces.slice();
  faces[dieIndex] = v;
  return applyEffect(s.effect, { face: v, faces, index: dieIndex, lockedCount: 1, ...gameCtx(g) });
}

function playStageTurns(g) {
  while (g.rollsLeft > 0) {
    const board = g.currentFaces();
    g.dice.forEach((d, i) => {
      const v = g.faceValue(d);
      const contrib = estimate(g, i, d.faceIndex, board);
      // 이 주사위의 짝수 면 평균 기여도 (짝수 면이 없으면 전체 평균)
      let evenSum = 0, evenCnt = 0, allSum = 0;
      for (let f = 0; f < FACE_COUNT; f++) {
        const e = estimate(g, i, f, board);
        allSum += e;
        if (d.faces[f] % 2 === 0) { evenSum += e; evenCnt += 1; }
      }
      const mean = evenCnt > 0 ? evenSum / evenCnt : allSum / FACE_COUNT;
      const keep = v % 2 === 0 && contrib >= mean;
      if (d.locked !== keep) g.toggleLock(i);
    });
    if (g.dice.every(d => d.locked)) break;
    g.reroll();
  }
  g.endTurn();
}

function doMaintain(g) {
  // 변경권: 가장 높은 홀수 면을 짝수로 (9는 -1로 8, 나머지는 +1). 스킬 조건이 깨지는 면은 피한다.
  while (g.inventory.tickets > 0) {
    let best = null;
    for (let d = 0; d < DICE_COUNT; d++) for (let f = 0; f < FACE_COUNT; f++) {
      const v = g.dice[d].faces[f];
      if (v % 2 === 0) continue;
      const delta = v >= 9 ? -1 : 1;
      const skillId = g.dice[d].skills[f];
      if (skillId && !condAllows(SKILLS_BY_ID[skillId].cond, v + delta)) continue;
      if (!best || v > best.v) best = { d, f, v, delta };
    }
    if (!best || !g.changeFace(best.d, best.f, best.delta)) break;
  }
  // 장착: (기여도 증가분 + 총점 계열 우선순위)가 큰 조합부터
  let equipped = true;
  while (equipped && g.inventory.skills.length > 0) {
    equipped = false;
    let best = null;
    const neutral = Array(DICE_COUNT).fill(4);
    for (let k = 0; k < g.inventory.skills.length; k++) {
      const s = SKILLS_BY_ID[g.inventory.skills[k]];
      for (let d = 0; d < DICE_COUNT; d++) for (let f = 0; f < FACE_COUNT; f++) {
        if (g.dice[d].skills[f]) continue;
        const v = g.dice[d].faces[f];
        if (!condAllows(s.cond, v)) continue;
        let gain;
        if (s.effect.type.startsWith('total')) {
          gain = TOTAL_PRIORITY[s.effect.type] ?? 0;
        } else {
          const faces = neutral.slice(); faces[d] = v;
          gain = applyEffect(s.effect, { face: v, faces, index: d, lockedCount: 1, ...gameCtx(g) }) - v;
          if (v % 2 === 1) gain -= 3; // 짝수 빌드: 홀수 면 장착은 감점
          gain -= 2 * g.dice[d].skills.filter(Boolean).length; // 한 주사위 집중 방지 (분산 배치)
        }
        if (!best || gain > best.gain) best = { k, d, f, gain };
      }
    }
    if (best && g.equipSkill(best.k, best.d, best.f)) equipped = true;
  }
  g.nextStage();
}

// resurrect: 패배해도 보상만 받고 강제로 다음 스테이지 진행 (달성 가능 점수 측정용)
export function playBot(seed, { resurrect = false, collect = null } = {}) {
  const g = new Game({ rng: mulberry32(seed) });
  let guard = 0;
  while (g.phase !== 'victory' && g.phase !== 'gameover' && guard++ < 10000) {
    if (g.phase === 'stage') {
      const stageNo = g.stageNumber;
      playStageTurns(g);
      if (g.phase !== 'stage' || g.stageNumber !== stageNo) {
        if (collect) collect(stageNo, g.score, g.phase);
      }
      if (g.phase === 'gameover' && resurrect) {
        if (stageNo >= 8) break;
        g._clearStage(); // 보상 지급 + 정비 전환 (측정용 훅)
        g.phase = 'maintain';
      }
    } else if (g.phase === 'maintain') {
      doMaintain(g);
    }
  }
  return g;
}
