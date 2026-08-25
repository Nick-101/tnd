// Headless 시뮬레이션 검수 — 브라우저 없이 Node로 실행: node test/sim.test.mjs
// 기획서(design/plan.md)의 완료 기준을 테스트로 1:1 변환 + 스킬 수식 전수 검증 + 풀게임 봇.
import {
  Game, mulberry32, applyEffect, applyTotalEffect,
} from '../js/game.js';
import {
  SKILLS, SKILLS_BY_ID, SKILL_DETAILS, STAGE_TARGETS, TURNS_PER_STAGE, ROLLS_PER_TURN,
  FACE_COUNT, condAllows,
} from '../js/config.js';
import { playBot } from './bot.mjs';

let pass = 0, fail = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { pass += 1; }
  else { fail += 1; failures.push(name); console.error(`  ✗ FAIL: ${name}`); }
}

// ---------------------------------------------------------------
console.log('시나리오 1 — 턴/굴림/잠금/점수/클리어/보상/정비/패배 (완료 기준 1:1)');
// ---------------------------------------------------------------
{
  const g = new Game({ rng: mulberry32(42) });

  // [기준] 턴이 시작되었을 때 주사위가 모두 굴려진다.
  assert(g.phase === 'stage' && g.turn === 1, '게임 시작 시 스테이지 1, 턴 1');
  assert(g.dice.every(d => d.faceIndex >= 0 && d.faceIndex < FACE_COUNT), '턴 시작 시 5개 주사위 모두 굴려짐');
  assert(g.rollsLeft === ROLLS_PER_TURN - 1, '턴 시작 자동 굴림이 굴림 기회 1회를 소모 (남은 2회)');
  assert(g.log.some(e => e.type === 'roll'), '굴림 결과가 로그에 남는다');

  // [기준] 주사위의 잠금 상태 토글이 잘 작동한다.
  assert(g.dice[0].locked === false, '초기 잠금 없음');
  g.toggleLock(0);
  assert(g.dice[0].locked === true, '잠금 토글 ON');
  g.toggleLock(0);
  assert(g.dice[0].locked === false, '잠금 토글 OFF');

  // [기준] 잠긴 주사위는 굴림에서 제외된다.
  g.toggleLock(1);
  g.toggleLock(3);
  const before = g.dice.map(d => d.faceIndex);
  for (let k = 0; k < 5 && g.rollsLeft > 0; k++) g.reroll();
  assert(g.dice[1].faceIndex === before[1] && g.dice[3].faceIndex === before[3],
    '잠긴 주사위는 재굴림에서 faceIndex가 변하지 않는다');
  assert(g.rollsLeft === 0, '굴림 기회 소진');
  assert(g.reroll() === false, '굴림 기회가 없으면 재굴림 불가');

  // [기준] 턴을 종료하면 주사위 눈과 스킬에 맞게 점수를 획득한다. (무스킬: 눈의 합)
  const faceSum = g.currentFaces().reduce((a, b) => a + b, 0);
  const prevScore = g.score;
  g.endTurn();
  assert(g.score === prevScore + faceSum, `무스킬 턴 종료: 점수 = 눈의 합 (${faceSum})`);
  assert(g.dice.every(d => !d.locked), '턴 종료 시 모든 잠금 해제');
  assert(g.turn === 2 && g.rollsLeft === ROLLS_PER_TURN - 1, '다음 턴 자동 시작 + 자동 굴림');

  // [기준] 목표 점수를 달성하면 스테이지가 클리어된다. (테스트 훅으로 최고 눈 강제)
  while (g.phase === 'stage' && g.score < g.target) {
    g._forceFaces([5, 5, 5, 5, 5]); // 모든 주사위 눈 6 (faceIndex 5)
    g.endTurn();
  }
  assert(g.phase === 'maintain', '목표 달성 → 스테이지 클리어 → 정비 화면 전환');
  assert(g.score >= STAGE_TARGETS[0], '클리어 시 점수가 목표 이상');

  // [기준] 스테이지 클리어 이후 보상이 주어진다.
  assert(g.inventory.skills.length === 3, '보상: 무작위 스킬 3개');
  assert(g.inventory.tickets === 2, '보상: 숫자 변경권 2개');
  assert(g.log.some(e => e.type === 'reward'), '보상이 로그에 남는다');

  // [기준] 정비 화면에서 스킬 장착 / 숫자 변경
  g.selectDie(0);
  g.selectFace(0); // 주사위 1의 눈 1 면
  const t0 = g.inventory.tickets;
  assert(g.changeFace(0, 0, -1) === false, '눈 1에서 -1은 거부 (하한)');
  assert(g.inventory.tickets === t0, '거부된 변경은 변경권을 소모하지 않는다');
  assert(g.changeFace(0, 0, 1) === true, '눈 1 → 2 변경 성공');
  assert(g.dice[0].faces[0] === 2, '면 숫자가 실제로 2로 변경됨');
  assert(g.inventory.tickets === t0 - 1, '변경권 1장 소모');

  // 장착: 조건 검사 포함 (조건이 맞는 스킬을 찾아 장착)
  const invIdx = g.inventory.skills.findIndex(id => condAllows(SKILLS_BY_ID[id].cond, g.dice[0].faces[1]));
  if (invIdx >= 0) {
    const skillId = g.inventory.skills[invIdx];
    const invLen = g.inventory.skills.length;
    assert(g.equipSkill(invIdx, 0, 1) === true, '조건에 맞는 면에 스킬 장착 성공');
    assert(g.dice[0].skills[1] === skillId, '장착된 스킬이 면에 기록됨');
    assert(g.inventory.skills.length === invLen - 1, '장착한 스킬은 인벤토리에서 제거');
  } else {
    assert(g.equipSkill(0, 0, 1) === false, '조건 불일치 스킬은 장착 거부');
  }
  g.inventory.skills.push('lotto'); // '6만' 조건 스킬로 거부 케이스 강제 검증
  assert(g.equipSkill(g.inventory.skills.length - 1, 0, 0) === false, "'로또'(6만)를 눈 2 면에 장착 시도 → 거부");

  // [기준] 다음 스테이지로 진행이 가능하다.
  g.nextStage();
  assert(g.phase === 'stage' && g.stageNumber === 2, '다음 스테이지(2)로 진행');
  assert(g.score === 0 && g.turn === 1, '스테이지 점수/턴 초기화');
  assert(g.target === STAGE_TARGETS[1], '스테이지 2 목표 점수 적용');

  // [기준] 턴을 모두 소모했을 때 목표 미달이면 패배.
  for (let t = 0; t < TURNS_PER_STAGE && g.phase === 'stage'; t++) {
    g._forceFaces([0, 0, 0, 0, 0]); // 모두 눈 1 → 4턴 합 20 < 100
    g.endTurn();
  }
  assert(g.phase === 'gameover', '4턴 소진 + 목표 미달 → 패배');

  g.reset();
  assert(g.phase === 'stage' && g.stageNumber === 1 && g.score === 0, 'reset으로 처음부터');

  // 스테이지 구성: 8개, 목표 점수는 단조 증가
  assert(STAGE_TARGETS.length === 8, '스테이지는 총 8개');
  assert(STAGE_TARGETS.every((t, i) => i === 0 || t > STAGE_TARGETS[i - 1]), '목표 점수는 스테이지마다 증가');
  assert(SKILLS.length >= 30, `스킬 풀 30개 이상 (현재 ${SKILLS.length}개)`);
  assert(SKILLS.every(sk => typeof SKILL_DETAILS[sk.id] === 'string' && SKILL_DETAILS[sk.id].length >= 20),
    '모든 스킬에 도감용 상세 설명이 있다');
}

// ---------------------------------------------------------------
console.log('시나리오 2 — 스킬 효과 수식 전수 검증 (35종)');
// ---------------------------------------------------------------
{
  const F = [4, 4, 2, 5, 1]; // 기준 보드 (index 0의 face=4)
  const base = { face: 4, faces: F, index: 0, lockedCount: 0, stage: 1, equippedCount: 0, score: 0 };
  const ctx = (over = {}) => ({ ...base, ...over });
  const E = id => SKILLS_BY_ID[id].effect;

  assert(applyEffect(E('coin'), ctx()) === 12, '잔돈 줍기: 4+8=12');
  assert(applyEffect(E('heavy'), ctx()) === 19, '묵직한 한 방: 4+15=19');
  assert(applyEffect(E('grit'), ctx({ face: 2, index: 2 })) === 20, '밑바닥 근성: 2+18=20');
  assert(applyEffect(E('evenx2'), ctx()) === 16, '짝수 예찬: 4×4=16');
  assert(applyEffect(E('oddx2'), ctx({ face: 5, index: 3 })) === 20, '홀수 반란: 5×4=20');
  assert(applyEffect(E('trinity'), ctx({ face: 3, faces: [3, 1, 1, 1, 1] })) === 18, '삼위일체: 3×6=18');
  assert(applyEffect(E('lotto'), ctx({ face: 6, faces: [6, 1, 1, 1, 1] })) === 36, '로또: 6×6=36');
  assert(applyEffect(E('ant'), ctx({ face: 1, index: 4 })) === 36, '개미 군단: 1+35=36');
  assert(applyEffect(E('twin'), ctx()) === 19, '쌍둥이 자석: 4 + 15×(같은 눈 1개) = 19');
  assert(applyEffect(E('evenally'), ctx()) === 40, '짝수 동맹: 4 + 12×(짝수 3개) = 40');
  assert(applyEffect(E('oddally'), ctx({ face: 5, index: 3 })) === 29, '홀수 동맹: 5 + 12×(홀수 2개) = 29');
  assert(applyEffect(E('freeride'), ctx()) === 14, '어부지리: 4 + 2×max(4,2,5,1) = 14');
  assert(applyEffect(E('hyena'), ctx({ face: 2, index: 2 })) === 5, '하이에나: 2 + 3×min(4,4,5,1) = 5');
  assert(applyEffect(E('blessing'), ctx()) === 20, '합의 축복: 4 + 16 = 20');
  assert(applyEffect(E('lonewolf'), ctx({ face: 5, index: 3 })) === 25, '외로운 늑대: 유일한 5 → 5×5=25');
  assert(applyEffect(E('lonewolf'), ctx()) === 4, '외로운 늑대: 4가 또 있으면 미발동 → 4');
  assert(applyEffect(E('crowd'), ctx({ face: 2, faces: [2, 2, 2, 5, 1] })) === 16, '군중 심리: 같은 눈 2개 이상 → 2×8=16');
  assert(applyEffect(E('crowd'), ctx()) === 4, '군중 심리: 같은 눈 1개뿐 → 미발동 4');
  assert(applyEffect(E('ladder'), ctx()) === 29, '계단 오르기: 5(=4+1) 존재 → 4+25=29');
  assert(applyEffect(E('ladder'), ctx({ face: 5, index: 3 })) === 5, '계단 오르기: 6 없음 → 미발동 5');
  assert(applyEffect(E('pureeven'), ctx({ faces: [4, 2, 6, 2, 4] })) === 20, '순혈 짝수: 전부 짝수 → 4×5=20');
  assert(applyEffect(E('pureeven'), ctx()) === 4, '순혈 짝수: 홀수 존재 → 미발동');
  assert(applyEffect(E('pureodd'), ctx({ face: 5, faces: [5, 1, 3, 1, 5] })) === 25, '순혈 홀수: 전부 홀수 → 5×5=25');
  assert(applyEffect(E('juggler'), ctx({ lockedCount: 3 })) === 40, '저글러: 4 + 12×3 = 40');
  assert(applyEffect(E('gambler'), ctx({ lockedCount: 0 })) === 16, '도박사: 잠금 0 → 4×4=16');
  assert(applyEffect(E('gambler'), ctx({ lockedCount: 1 })) === 4, '도박사: 잠금 있음 → 미발동');
  assert(applyEffect(E('sixbros'), ctx({ face: 6, faces: [6, 6, 1, 2, 6] })) === 60, '육형제: 6 + 18×3 = 60');
  assert(applyEffect(E('sniper'), ctx({ face: 5, faces: [5, 1, 1, 1, 1] })) === 40, '스나이퍼: 5×8=40');
  assert(applyEffect(E('objection'), ctx({ face: 2, faces: [2, 1, 1, 1, 1] })) === 18, '이의 있음: 2×9=18');
  assert(applyEffect(E('shooter'), ctx()) === 24, '사수: 4+20=24');
  assert(applyEffect(E('richer'), ctx()) === 34, '부익부: 4 + 10×(4이상 3개) = 34');
  assert(applyEffect(E('poorer'), ctx({ face: 2, index: 2 })) === 22, '빈익빈: 2 + 10×(3이하 2개) = 22');
  assert(applyEffect(E('hoarder'), ctx({ equippedCount: 4 })) === 16, '수집광: 4 + 3×4 = 16');
  assert(applyEffect(E('veteran'), ctx({ stage: 3 })) === 22, '베테랑: 4 + 6×3 = 22');
  assert(applyEffect(E('snowball'), ctx({ score: 100 })) === 24, '눈덩이: 4 + floor(100/5) = 24');
  // 총점 계열
  assert(applyTotalEffect(E('orchestra'), 30, [2, 4, 6, 2, 5]) === 60, '오케스트라: 짝수 4개 → 총점 ×2');
  assert(applyTotalEffect(E('orchestra'), 30, F) === 30, '오케스트라: 짝수 3개 → 미발동');
  assert(applyTotalEffect(E('shaman'), 25, [1, 3, 5, 1, 4]) === 50, '무당: 홀수 4개 → 총점 ×2');
  assert(applyTotalEffect(E('shaman'), 25, F) === 25, '무당: 홀수 2개 → 미발동');
  assert(applyTotalEffect(E('fivestar'), 40, [4, 4, 4, 2, 1]) === 120, '파이브 스타: 같은 눈 3개 → 총점 ×3');
  assert(applyTotalEffect(E('fivestar'), 40, F) === 40, '파이브 스타: 최대 2개 → 미발동');
  assert(applyTotalEffect(E('finale'), 40, F) === 100, '그랜드 피날레: 총점 +60');
  assert(applyTotalEffect(E('bastion'), 40, F) === 90, '최후의 보루: 총점 +50');

  // 통합: 게임 안에서 스킬 발동 → 로그 및 점수 반영
  const g = new Game({ rng: mulberry32(7) });
  g.dice[0].skills[5] = 'lotto';   // 눈 6 면에 로또
  g.dice[1].skills[0] = 'ant';     // 눈 1 면에 개미 군단
  g.dice[4].skills[5] = 'finale';  // 눈 6 면에 그랜드 피날레
  g._forceFaces([5, 0, 1, 1, 5]);  // 눈: 6,1,2,2,6
  const s0 = g.score;
  g.endTurn();
  // 로또 6×6=36, 개미 1+35=36, 2+2, 주사위5=6 → 소계 82, 피날레 +60 = 142
  assert(g.score - s0 === 142, `스킬 통합 발동 점수: 142 (실제 ${g.score - s0})`);
  assert(g.log.some(e => e.type === 'skill' && e.text.includes("주사위 1 · '로또' 발동: 6 → 36")), '스킬 발동 로그 형식 (주사위 번호 + 스킬명 + 결과값)');
  assert(g.log.some(e => e.text.includes("'그랜드 피날레' 발동: 총점 82 → 142")), '총점 스킬 발동 로그');

  // 정비: 숫자 변경으로 조건 깨짐 → 스킬 인벤토리 반환
  const g2 = new Game({ rng: mulberry32(9) });
  g2.phase = 'maintain';
  g2.inventory.tickets = 5;
  g2.dice[0].skills[5] = 'lotto'; // '6만' 조건
  const invBefore = g2.inventory.skills.length;
  g2.changeFace(0, 5, 1); // 6 → 7
  assert(g2.dice[0].faces[5] === 7, '눈 6 → 7 변경');
  assert(g2.dice[0].skills[5] === null, "조건('6만') 깨짐 → 스킬 해제");
  assert(g2.inventory.skills.length === invBefore + 1 && g2.inventory.skills.includes('lotto'), '해제된 스킬은 인벤토리로 반환');
  g2.dice[0].faces[5] = 9;
  assert(g2.changeFace(0, 5, 1) === false, '눈 9에서 +1은 거부 (상한)');
}

// ---------------------------------------------------------------
console.log('시나리오 3 — 풀게임 봇: 8스테이지 완주 가능성 + 상태 불변식');
// ---------------------------------------------------------------
{
  const results = [];
  for (let seed = 1; seed <= 20; seed++) {
    const g = playBot(seed);
    results.push({ seed, phase: g.phase, stage: g.stageNumber, score: g.score });
    // 불변식: 어떤 시드에서도 상태가 망가지지 않아야 한다
    assert(g.phase === 'victory' || g.phase === 'gameover', `시드 ${seed}: 게임이 승리/패배로 종료 (${g.phase})`);
    assert(g.dice.every(d => d.faces.every(v => v >= 1 && v <= 9)), `시드 ${seed}: 모든 눈이 1~9 범위`);
    assert(g.dice.every(d => d.skills.every((s, f) => !s || condAllows(SKILLS_BY_ID[s].cond, d.faces[f]))),
      `시드 ${seed}: 장착된 모든 스킬이 조건을 만족`);
    assert(Number.isInteger(g.score) && g.score >= 0, `시드 ${seed}: 점수는 음이 아닌 정수`);
  }
  const wins = results.filter(r => r.phase === 'victory').length;
  const maxStage = Math.max(...results.map(r => r.stage));
  console.log(`  봇 20판: 승리 ${wins}판, 최고 도달 스테이지 ${maxStage}`);
  console.log('  ' + results.map(r => `s${r.seed}:${r.phase === 'victory' ? 'WIN' : `S${r.stage}`}`).join(' '));
  assert(wins >= 1, `봇이 8스테이지 완주 가능해야 한다 (승리 ${wins}/20)`);
  assert(maxStage >= 4, `봇이 최소 스테이지 4까지는 도달해야 한다 (최고 ${maxStage})`);
}

// ---------------------------------------------------------------
console.log('');
console.log(`결과: ${pass + fail}개 단언 중 ${pass}개 통과, ${fail}개 실패`);
if (fail > 0) { console.log('실패 목록:'); failures.forEach(f => console.log(` - ${f}`)); process.exit(1); }
