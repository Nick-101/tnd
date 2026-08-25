// Headless 시뮬레이션 검수 (v2) — 브라우저 없이 Node로 실행: node test/sim.test.mjs
// 완료 기준(기본 11 + v2 신규 12)을 테스트로 변환 + 스킬 48종 수식 전수 + 프리뷰 일치 퍼즈 + 풀게임 봇.
import {
  Game, mulberry32, makeInstance, calcScore, evalEffect, faceState, layerMatches,
} from '../js/game.js';
import {
  SKILLS, SKILLS_BY_ID, SKILL_DETAILS, STAGE_TARGETS, TURNS_PER_STAGE, ROLLS_PER_TURN,
  FACE_COUNT, OPPOSITE, MAX_DICE, draftSpec, condAllows,
} from '../js/config.js';
import { playBot } from './bot.mjs';

let pass = 0, fail = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { pass += 1; }
  else { fail += 1; failures.push(name); console.error(`  ✗ FAIL: ${name}`); }
}
const approx = (a, b) => Math.abs(a - b) < 1e-9;

// 테스트 구성 헬퍼: 스타터 스킬 없는 맨 주사위 게임
function bareGame(seed, startDice = 1) {
  const g = new Game({ rng: mulberry32(seed), startDice });
  for (const d of g.dice) for (const f of d.faces) f.skill = null;
  return g;
}
function place(g, d, f, id) { g.dice[d].faces[f].skill = makeInstance(id); return g.dice[d].faces[f].skill; }

// ---------------------------------------------------------------
console.log('시나리오 1 — 기본 루프 (원 완료 기준 11개)');
// ---------------------------------------------------------------
{
  // 잠금 QA는 구현 노트대로 START_DICE를 올려서 수행
  const g = new Game({ rng: mulberry32(42), startDice: 3 });

  assert(g.phase === 'stage' && g.turn === 1, '게임 시작 시 스테이지 1, 턴 1');
  assert(g.dice.every(d => d.upIndex >= 0 && d.upIndex < FACE_COUNT), '턴 시작 시 주사위가 모두 굴려진다');
  assert(g.rollsLeft === ROLLS_PER_TURN - 1, '턴 시작 자동 굴림이 굴림 1회 소모 (재굴림 2회 남음)');
  assert(g.log.some(e => e.type === 'roll'), '굴림 결과가 로그에 남는다');

  assert(g.dice[0].locked === false, '초기 잠금 없음');
  g.toggleLock(0);
  assert(g.dice[0].locked === true, '잠금 토글 ON');
  assert(g.log.some(e => e.type === 'lock'), '잠금 변경이 로그에 남는다');
  g.toggleLock(0);
  assert(g.dice[0].locked === false, '잠금 토글 OFF');

  g.toggleLock(1);
  const before = g.dice[1].upIndex;
  for (let k = 0; k < 5 && g.rollsLeft > 0; k++) g.reroll();
  assert(g.dice[1].upIndex === before, '잠긴 주사위는 재굴림에서 제외된다');
  assert(g.rollsLeft === 0 && g.reroll() === false, '재굴림 소진 후 굴림 불가');

  // 스타터 스킬 점수 검증 (주사위 1개 게임, 윗면 강제)
  const g1 = new Game({ rng: mulberry32(7), startDice: 1 });
  g1._forceUp([3]); // F4 윗면: 4 + 잔향2 + 여운3 = 9
  assert(g1.preview() === 9, '스타터: F4 윗면 → 예상 9점 (잠재 잔향+여운만 발동)');
  let s0 = g1.score;
  g1.endTurn();
  assert(g1.score - s0 === 9, '턴 종료: 주사위 눈과 스킬에 맞게 점수 획득 (9점)');
  assert(g1.dice.every(d => !d.locked), '턴 종료 시 모든 잠금 해제');

  g1._forceUp([5]); // F6 윗면: 6 + 정타6 + 잔향2 + 여운3 = 17
  assert(g1.preview() === 17, '스타터: F6 윗면 → 예상 17점 (활성 정타 + 잠재 2종)');
  s0 = g1.score;
  g1.endTurn();
  assert(g1.score - s0 === 17, 'F6 윗면 턴 점수 17');

  // 목표 달성 → 클리어 (스테이지 1 목표 30, 9+17+17=43)
  g1._forceUp([5]);
  g1.endTurn();
  assert(g1.score >= STAGE_TARGETS[0], '클리어 시 점수가 목표 이상');
  assert(g1.phase === 'draft', '목표 달성 → 스테이지 클리어 → 보상 드래프트로 전환');

  // 보상: 주사위 +1(스테이지 1~4), 변경권 2, 드래프트 4택2
  assert(g1.dice.length === 2, '보상: 주사위 +1 (스테이지 1 클리어 → 2개)');
  assert(g1.inventory.tickets === 2, '보상: 숫자 변경권 2개');
  assert(g1.draft.offer.length === 4 && g1.draft.pick === 2, '보상: 스킬 4개 제시, 2개 선택');
  assert(g1.log.some(e => e.type === 'reward'), '보상이 로그에 남는다');

  g1.draftToggle(0); g1.draftToggle(1);
  assert(g1.draftConfirm() === true, '드래프트 확정');
  assert(g1.inventory.skills.length === 2, '선택한 2개가 인벤토리로');
  assert(g1.phase === 'maintain', '드래프트 후 정비 화면으로 전환');

  // 정비: 장착/회수/숫자 변경
  g1.inventory.skills.push(makeInstance('gangta')); // 조건 4~6
  const kGangta = g1.inventory.skills.length - 1;
  assert(g1.equipSkill(kGangta, 1, 0) === false, "조건 불충족 슬롯(F1 눈1)에 '강타'(4~6) 장착 거부");
  assert(g1.equipSkill(kGangta, 1, 4) === true, "조건 충족 슬롯(F5 눈5)에 '강타' 장착 성공");
  assert(g1.dice[1].faces[4].skill !== null, '장착된 스킬이 면에 기록됨');
  const invLen = g1.inventory.skills.length;
  assert(g1.unequipSkill(1, 4) === true, '장착 스킬 회수(우클릭 경로)');
  assert(g1.inventory.skills.length === invLen + 1, '회수한 스킬은 인벤토리로 반환');

  const t0 = g1.inventory.tickets;
  assert(g1.changeFace(1, 0, -1) === false, '눈 1에서 −1 거부 (하한)');
  assert(g1.changeFace(1, 5, 1) === false, '눈 6에서 +1 거부 (상한 6)');
  assert(g1.inventory.tickets === t0, '거부된 변경은 변경권을 소모하지 않는다');
  assert(g1.changeFace(1, 0, 1) === true && g1.dice[1].faces[0].pip === 2, '눈 1 → 2 변경 성공');
  assert(g1.inventory.tickets === t0 - 1, '변경권 1장 소모');
  // 숫자 변경으로 장착 조건이 깨지면 인벤토리로 반환
  place(g1, 1, 5, 'jeungpok'); // '증폭' = 6만
  g1.inventory.tickets += 1;
  g1.changeFace(1, 5, -1);
  assert(g1.dice[1].faces[5].skill === null && g1.inventory.skills.some(i => i.id === 'jeungpok'),
    "눈 변경으로 조건('6만') 깨짐 → 스킬 인벤토리 반환");

  // 다음 스테이지
  g1.nextStage();
  assert(g1.phase === 'stage' && g1.stageNumber === 2, '다음 스테이지(2)로 진행');
  assert(g1.score === 0 && g1.turn === 1, '스테이지 점수/턴 초기화');
  assert(g1.target === STAGE_TARGETS[1], '스테이지 2 목표 점수 적용');

  // 패배: 4턴 소진 + 목표 미달
  for (let t = 0; t < TURNS_PER_STAGE && g1.phase === 'stage'; t++) {
    g1._forceUp(g1.dice.map(() => 0)); // 전부 F1(낮은 눈)
    g1.endTurn();
  }
  assert(g1.phase === 'gameover', '4턴 소진 + 목표 미달 → 패배');

  g1.reset();
  assert(g1.phase === 'stage' && g1.stageNumber === 1 && g1.dice.length === 1, 'reset: 주사위 1개 + 스타터로 처음부터');
  assert(g1.dice[0].faces[5].skill && g1.dice[0].faces[5].skill.id === 'jungta', '스타터 정타(F6) 장착 상태로 시작');

  // 데이터 정합
  assert(STAGE_TARGETS.length === 8, '스테이지는 총 8개');
  assert(STAGE_TARGETS.every((t, i) => i === 0 || t > STAGE_TARGETS[i - 1]), '목표 점수는 스테이지마다 증가');
  assert(SKILLS.length === 48, `스킬 풀 48종 (기획안 표 기준, 현재 ${SKILLS.length})`);
  assert(SKILLS.every(sk => typeof SKILL_DETAILS[sk.id] === 'string' && SKILL_DETAILS[sk.id].length >= 20),
    '모든 스킬에 도감용 상세 설명이 있다');
}

// ---------------------------------------------------------------
console.log('시나리오 2 — v2 신규 시스템: 계층/누산기/순서/프리뷰/성장/드래프트');
// ---------------------------------------------------------------
{
  // [기준] 면 상태 판정과 계층 매칭
  assert(faceState(0, 0) === 'active' && faceState(5, 0) === 'opposite' && faceState(2, 0) === 'side',
    '면 상태: 윗면=활성, OPPOSITE=맞은편, 나머지=측면');
  assert(layerMatches('latent', 'opposite') && layerMatches('latent', 'side') && !layerMatches('latent', 'active'),
    '잠재 계층 = 활성이 아닌 모든 면');

  // [기준] 네 계층이 올바른 면 상태에서만 발동 (한 주사위에 4계층 배치)
  const gl = bareGame(11);
  place(gl, 0, 0, 'jungta');   // F1: 활성형 +6
  place(gl, 0, 1, 'mugechu');  // F2: 맞은편형 +13 (짝수 조건, 눈2)
  place(gl, 0, 2, 'gyeotnal'); // F3: 측면형 +3
  place(gl, 0, 3, 'janhyang'); // F4: 잠재형 +2
  const cases = [
    [0, 1 + 6 + 3 + 2],  // F1 윗면: 활성O / F2측면(맞은편형X) / F3측면O / F4잠재O
    [4, 5 + 13 + 3 + 2], // F5 윗면: F2가 바닥면 → 맞은편형O, F1 활성형 꺼짐(측면)
    [2, 3 + 2],          // F3 윗면: 측면형 꺼짐(활성), F4는 바닥면 → 잠재O, F1X F2X
    [3, 4],              // F4 윗면: 잠재형 꺼짐(활성), F3 바닥면(측면형은 측면만) X
  ];
  for (const [up, expected] of cases) {
    gl._forceUp([up]);
    assert(gl.preview() === expected, `계층 발동 매트릭스: F${up + 1} 윗면 → ${expected}점`);
  }

  // 전 효과 kind 단위 검증
  const ctx = (over = {}) => ({
    S: 10, activePips: [4, 6, 2], upPip: 4, pip: 3, orderIndex: 1, orderCount: 3,
    lockedCount: 2, rerollsLeft: 1, turnsAfter: 2, inst: { growth: 0, stageCount: 0 }, ...over,
  });
  const E = id => SKILLS_BY_ID[id];
  const eq = (r, op, n) => r !== null && r.op === op && approx(r.n, n);
  assert(eq(evalEffect(E('jungta'), ctx()), 'add', 6), '정타: +6');
  assert(eq(evalEffect(E('payeol'), ctx()), 'mul', 2.0), '파열: ×2.0');
  assert(eq(evalEffect(E('baega'), ctx({ pip: 5 })), 'add', 5), '배가: 이 면의 눈만큼 +');
  assert(eq(evalEffect(E('chukjeok'), ctx({ pip: 5 })), 'add', 2), '축적: 눈 절반 내림 (5→2)');
  assert(eq(evalEffect(E('daeching'), ctx({ upPip: 6, pip: 5 })), 'add', 11), '대칭: 윗면+이 면 눈 (6+5=11)');
  assert(eq(evalEffect(E('wanjeon'), ctx({ upPip: 4, pip: 4 })), 'mul', 3.0), '완전대칭: 눈 일치 → ×3.0');
  assert(evalEffect(E('wanjeon'), ctx({ upPip: 4, pip: 3 })) === null, '완전대칭: 불일치 → 미발동');
  assert(eq(evalEffect(E('tongil'), ctx({ activePips: [4, 6, 2] })), 'add', 7), '통일: 활성 눈 전부 짝수 → +7');
  assert(evalEffect(E('tongil'), ctx({ activePips: [4, 5, 2] })) === null, '통일: 홀짝 혼합 → 미발동');
  assert(eq(evalEffect(E('ssang'), ctx({ activePips: [4, 4, 2] })), 'add', 12), '쌍: 같은 활성 눈 2개 → +12');
  assert(evalEffect(E('ssang'), ctx()) === null, '쌍: 페어 없음 → 미발동');
  assert(eq(evalEffect(E('yeonswae'), ctx({ activePips: [2, 4, 3] })), 'add', 18), '연쇄: 2·3·4 연속 → +18');
  assert(evalEffect(E('yeonswae'), ctx({ activePips: [1, 3, 5] })) === null, '연쇄: 연속 없음 → 미발동');
  assert(eq(evalEffect(E('sangae'), ctx()), 'mul', 1.8), '산개: 전부 다른 눈 → ×1.8');
  assert(evalEffect(E('sangae'), ctx({ activePips: [4, 4, 2] })) === null, '산개: 중복 존재 → 미발동');
  assert(eq(evalEffect(E('samjung'), ctx({ activePips: [4, 4, 4] })), 'mul', 2.2), '삼중: 같은 눈 3개 → ×2.2');
  assert(eq(evalEffect(E('gyeolsok'), ctx()), 'add', 6), '결속: 잠긴 주사위 2개 → +6');
  assert(eq(evalEffect(E('jeolje'), ctx({ rerollsLeft: 2 })), 'add', 14), '절제: 남은 재굴림 2회 → +14');
  assert(eq(evalEffect(E('yeoyu'), ctx()), 'add', 12), '여유: 남은 턴 2회 → +12');
  assert(eq(evalEffect(E('jogeup'), ctx({ rerollsLeft: 0 })), 'mul', 1.9), '조급: 재굴림 소진 → ×1.9');
  assert(evalEffect(E('jogeup'), ctx()) === null, '조급: 재굴림 남음 → 미발동');
  assert(eq(evalEffect(E('gyedan'), ctx({ orderIndex: 3 })), 'add', 6), '계단: 앞 주사위 3개 → +6');
  assert(eq(evalEffect(E('seonbong'), ctx({ orderIndex: 0 })), 'add', 16), '선봉: 첫 번째 → +16');
  assert(evalEffect(E('seonbong'), ctx()) === null, '선봉: 첫 번째 아님 → 미발동');
  assert(eq(evalEffect(E('dohwaseon'), ctx({ S: 29 })), 'add', 20), '도화선: 누적 30 미만 → +20');
  assert(evalEffect(E('dohwaseon'), ctx({ S: 30 })) === null, '도화선: 30 이상 → 미발동');
  assert(eq(evalEffect(E('gwanseong'), ctx({ S: 60 })), 'mul', 1.7), '관성: 누적 60 이상 → ×1.7');
  assert(evalEffect(E('gwanseong'), ctx({ S: 59 })) === null, '관성: 60 미만 → 미발동');
  assert(eq(evalEffect(E('huwi'), ctx({ orderIndex: 2 })), 'mul', 2.2), '후위: 마지막 주사위 → ×2.2');
  assert(evalEffect(E('huwi'), ctx({ orderIndex: 1 })) === null, '후위: 마지막 아님 → 미발동');
  assert(eq(evalEffect(E('banbok'), ctx({ inst: { growth: 0, stageCount: 2 } })), 'add', 3), '반복: 3번째 발동 → +3');
  assert(eq(evalEffect(E('seongjang'), ctx({ inst: { growth: 4, stageCount: 0 } })), 'add', 7), '성장: +3+누적4 = +7');
  assert(eq(evalEffect(E('gagin'), ctx({ inst: { growth: 10, stageCount: 0 } })), 'add', 15), '각인: +5+누적10 = +15');
  assert(eq(evalEffect(E('yeonma'), ctx({ inst: { growth: 0.2, stageCount: 0 } })), 'mul', 1.7), '연마: ×1.5+0.2 = ×1.7');

  // [기준] 단일 누산기 순차 연산 — 통합 예시 (면 순회: 활성 → 맞은편 → 측면)
  const gc = bareGame(13, 3);
  place(gc, 0, 3, 'gangta');   // D1 F4 강타 (활성 +9)
  place(gc, 0, 2, 'janhyang'); // D1 F3 잔향 (잠재 +2)
  place(gc, 1, 5, 'jeungpok'); // D2 F6 증폭 (활성 ×2.5)
  place(gc, 1, 0, 'miyeol');   // D2 F1 미열 (잠재 ×1.2)
  place(gc, 2, 1, 'simcheung');// D3 F2 심층 (맞은편 +12, 눈2)
  place(gc, 2, 4, 'huwi');     // D3 F5 후위 (활성 마지막 ×2.2)
  gc._forceUp([3, 5, 4]); // 활성 눈 4 / 6 / 5, 합 15
  const r = calcScore(gc.dice, { rerollsLeft: 0, turnsAfter: 0 });
  // 15 → 강타 24 → 잔향 26 → 증폭 65 → 미열 81.25 → (D3: 활성 후위 먼저) 178.75 → 심층 190.75
  assert(approx(r.total, 190.75), `누산기 순차 연산 통합: 190.75 (실제 ${r.total})`);
  assert(Math.floor(r.total) === 190, '최종 점수만 내림 (190)');
  assert(r.lines.some(l => l.text.includes('178.8')), '중간 누산값은 소수점 1자리로 표기');
  const huwiIdx = r.lines.findIndex(l => l.text.includes('후위'));
  const simIdx = r.lines.findIndex(l => l.text.includes('심층'));
  assert(huwiIdx >= 0 && simIdx > huwiIdx, '면 순회 규칙: 활성(후위) → 맞은편(심층) 순으로 적용');
  assert(r.lines.filter(l => l.type === 'mul').length === 3 && r.lines.filter(l => l.type === 'add').length === 3,
    '로그 줄에 덧셈/곱셈 타입이 구분되어 남는다');
  // [기준] 로그 누산값 = 최종 점수 일치
  const lastLine = r.lines[r.lines.length - 1];
  assert(lastLine.text.endsWith('190.8'), '로그의 마지막 누산값이 최종 점수와 일치 (190.75 → 표기 190.8)');

  // [기준] 주사위 순서가 계산에 반영된다 (곱셈은 뒤가 유리)
  const go = bareGame(17, 2);
  place(go, 0, 5, 'jungta');   // D1 F6 정타 +6
  place(go, 1, 5, 'jeungpok'); // D2 F6 증폭 ×2.5
  go._forceUp([5, 5]);
  const addFirst = calcScore(go.dice, { rerollsLeft: 0, turnsAfter: 0 }).total; // (12+6)×2.5 = 45
  assert(approx(addFirst, 45), '덧셈 먼저 → (12+6)×2.5 = 45');
  go.phase = 'maintain';
  assert(go.moveDie(0, 1) === true, '정비 화면에서 주사위 순서 변경 가능');
  go.phase = 'stage';
  assert(go.moveDie(0, 1) === false, '스테이지 진행 중에는 순서 변경 불가');
  go._forceUp([5, 5]);
  const mulFirst = calcScore(go.dice, { rerollsLeft: 0, turnsAfter: 0 }).total; // 12×2.5+6 = 36
  assert(approx(mulFirst, 36), '순서 변경 반영: 곱셈 먼저 → 12×2.5+6 = 36');

  // [기준] 예상 점수 프리뷰 = 실제 턴 종료 점수 (무작위 플레이 퍼즈)
  {
    const rng = mulberry32(99);
    let checks = 0, ok = 0;
    const g = new Game({ rng: mulberry32(1234), startDice: 3 });
    let guard = 0;
    while (checks < 60 && guard++ < 3000) {
      if (g.phase === 'stage') {
        if (rng() < 0.5) g.toggleLock(Math.floor(rng() * g.dice.length));
        if (rng() < 0.5 && g.rollsLeft > 0 && !g.dice.every(d => d.locked)) g.reroll();
        if (rng() < 0.4 || g.rollsLeft === 0) {
          const p = g.preview();
          const before = g.score;
          g.endTurn();
          checks += 1;
          if (g.score - before === p) ok += 1;
        }
      } else if (g.phase === 'draft') {
        for (let k = 0; k < g.draft.pick; k++) g.draftToggle(k);
        g.draftConfirm();
      } else if (g.phase === 'maintain') {
        g.nextStage();
      } else {
        g.reset();
      }
    }
    assert(checks >= 60 && ok === checks, `프리뷰 = 실제 턴 점수 (${ok}/${checks} 일치)`);
  }

  // [기준] 성장형 누적이 스테이지를 넘어 유지 + '반복'은 스테이지마다 초기화
  const gg = bareGame(21);
  const instGrow = place(gg, 0, 5, 'seongjang'); // F6 활성 성장
  const instRep = place(gg, 0, 0, 'banbok');     // F1 잠재 반복
  // 3턴 연속 F6 윗면: 성장 3→5→7, 반복 1→2→3 / 점수 6+3+1, 6+5+2, 6+7+3
  const expect = [10, 13, 16];
  for (let t = 0; t < 3; t++) {
    gg._forceUp([5]);
    const before = gg.score;
    gg.endTurn();
    assert(gg.score - before === expect[t], `성장/반복 ${t + 1}번째 발동: ${expect[t]}점`);
  }
  assert(gg.phase === 'draft' && instGrow.growth === 6, '성장: 발동 3회 → 영구 누적 +6 (스테이지 클리어 후 유지)');
  for (let k = 0; k < gg.draft.pick; k++) gg.draftToggle(k);
  gg.draftConfirm();
  gg.nextStage();
  assert(instGrow.growth === 6 && instRep.stageCount === 0, '스테이지 이월: 성장 누적 유지, 반복 카운터 초기화');
  // 각인: 스테이지 클리어마다 +5
  const gk = bareGame(23);
  const instGagin = place(gk, 0, 0, 'gagin');
  gk.score = gk.target; gk._forceUp([5]); gk.endTurn();
  assert(instGagin.growth === 5, '각인: 스테이지 클리어 → 영구 +5');

  // [기준] 드래프트 규칙: 제시/선택 수, 초과 선택 방지
  assert(JSON.stringify(draftSpec(1)) === '{"offer":4,"pick":2}' && JSON.stringify(draftSpec(4)) === '{"offer":4,"pick":2}',
    '드래프트: 스테이지 1~4는 4택2');
  assert(JSON.stringify(draftSpec(5)) === '{"offer":5,"pick":3}' && JSON.stringify(draftSpec(7)) === '{"offer":5,"pick":3}',
    '드래프트: 스테이지 5~7은 5택3');
  assert(draftSpec(8) === null, '스테이지 8 클리어는 드래프트 없이 게임 클리어');
  {
    const gd = bareGame(31);
    gd.score = gd.target; gd._forceUp([0]); gd.endTurn();
    assert(gd.phase === 'draft', '클리어 → 드래프트');
    assert(gd.draftConfirm() === false, '선택 수 미달 시 확정 불가');
    gd.draftToggle(0); gd.draftToggle(1);
    assert(gd.draftToggle(2) === false, '선택 수 초과 방지 (2개 초과 선택 불가)');
    assert(new Set(gd.draft.offer).size === gd.draft.offer.length, '한 제시 안에 중복 스킬 없음');
    assert(gd.draftConfirm() === true, '정확히 2개 선택 시 확정');
  }

  // [기준] 주사위 1개 시작 → 스테이지 1~4 클리어마다 +1, 최대 5개
  {
    const gs = new Game({ rng: mulberry32(41), startDice: 1 });
    const counts = [];
    for (let stage = 1; stage <= 6 && gs.phase !== 'victory'; stage++) {
      gs.score = gs.target;
      gs._forceUp(gs.dice.map(() => 0));
      gs.endTurn();
      if (gs.phase === 'draft') {
        counts.push(gs.dice.length);
        for (let k = 0; k < gs.draft.pick; k++) gs.draftToggle(k);
        gs.draftConfirm();
        gs.nextStage();
      }
    }
    assert(JSON.stringify(counts) === '[2,3,4,5,5,5]', `주사위 확장: 1 → 2,3,4,5 이후 고정 (실제 ${JSON.stringify(counts)})`);
    assert(gs.dice.length === MAX_DICE, '주사위 최대 5개');
  }

  // [기준] 8스테이지 클리어 → 승리 화면
  {
    const gv = new Game({ rng: mulberry32(43), startDice: 1 });
    gv.stageIndex = 7;
    gv._startStage();
    gv.score = gv.target;
    gv._forceUp([0]);
    gv.endTurn();
    assert(gv.phase === 'victory', '스테이지 8 클리어 → 승리');
  }

  // 맞은편 관계 데이터 자체 검증
  assert(OPPOSITE[0] === 5 && OPPOSITE[1] === 4 && OPPOSITE[2] === 3, '맞은편 관계 F1↔F6, F2↔F5, F3↔F4');
  assert(OPPOSITE.every((o, f) => OPPOSITE[o] === f), '맞은편 관계는 대합 (양방향 일치)');
}

// ---------------------------------------------------------------
console.log('시나리오 3 — 풀게임 봇: 8스테이지 완주 + 상태 불변식');
// ---------------------------------------------------------------
{
  const results = [];
  for (let seed = 1; seed <= 20; seed++) {
    const g = playBot(seed);
    results.push({ seed, phase: g.phase, stage: g.stageNumber, score: g.score });
    assert(g.phase === 'victory' || g.phase === 'gameover', `시드 ${seed}: 게임이 승리/패배로 종료 (${g.phase})`);
    assert(g.dice.length <= MAX_DICE, `시드 ${seed}: 주사위 5개 이하`);
    assert(g.dice.every(d => d.faces.every(f => f.pip >= 1 && f.pip <= 6)), `시드 ${seed}: 모든 눈이 1~6 범위`);
    assert(g.dice.every(d => d.faces.every(f => !f.skill || condAllows(SKILLS_BY_ID[f.skill.id].cond, f.pip))),
      `시드 ${seed}: 장착된 모든 스킬이 장착 조건을 만족`);
    assert(Number.isInteger(g.score) && g.score >= 0, `시드 ${seed}: 점수는 음이 아닌 정수`);
  }
  const wins = results.filter(r => r.phase === 'victory').length;
  const maxStage = Math.max(...results.map(r => r.stage));
  console.log(`  봇 20판: 승리 ${wins}판, 최고 도달 스테이지 ${maxStage}`);
  console.log('  ' + results.map(r => `s${r.seed}:${r.phase === 'victory' ? 'WIN' : `S${r.stage}`}`).join(' '));
  assert(wins >= 3, `봇이 8스테이지를 충분히 완주할 수 있어야 한다 (승리 ${wins}/20)`);
  assert(maxStage >= 5, `봇이 최소 스테이지 5까지는 도달해야 한다 (최고 ${maxStage})`);
}

// ---------------------------------------------------------------
console.log('');
console.log(`결과: ${pass + fail}개 단언 중 ${pass}개 통과, ${fail}개 실패`);
if (fail > 0) { console.log('실패 목록:'); failures.forEach(f => console.log(` - ${f}`)); process.exit(1); }
