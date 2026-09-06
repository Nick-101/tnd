// TnD 결합 데모 headless 검수 — node test/tnd.test.mjs
// 완료 기준(기본 16 + 신규 14)을 테스트로 변환 + 변환표 전수 + 프리뷰 퍼즈 + 3개 빌드 봇 승률.
import { TndGame, mulberry32, makeInst, calcFaithPoints, convert, evalEffectTnd } from '../js/tnd-game.js';
import { TND, TND_SKILLS, TND_SKILLS_BY_ID, TND_SKILL_DETAILS, PIECES, PIECES_BY_ID, ceil } from '../js/tnd-config.js';
import { runBuild, applyBuild, BUILDS } from './tnd-bot.mjs';

let pass = 0, fail = 0; const failures = [];
function assert(c, name) { if (c) pass++; else { fail++; failures.push(name); console.error(`  ✗ FAIL: ${name}`); } }

function bare(seed = 1) {
  const g = new TndGame({ rng: mulberry32(seed) });
  for (const d of g.dice) for (const f of d.faces) f.skill = null;
  return g;
}
const place = (g, d, f, id) => { g.dice[d].faces[f].skill = makeInst(id); return g.dice[d].faces[f].skill; };
const pip1 = () => 0; // rng()=0 → 적 주사위 눈 1, 타락 위치 후보 첫 칸

// ---------------------------------------------------------------
console.log('시나리오 1 — 정비 화면');
// ---------------------------------------------------------------
{
  const g = new TndGame({ rng: mulberry32(1) });
  assert(g.phase === 'prep' && g.dice.length === 5 && g.deck.length === 5, '정비에서 시작: 주사위 5개, 입문 덱 5장 프리셋');
  assert(g.dice[0].faces[5].skill?.id === 'jungta', '입문 빌드 프리셋 장착 (정타)');
  assert(TND_SKILLS.length === 57, `스킬 57종 (기획안 표 합계, 현재 ${TND_SKILLS.length})`);
  assert(TND_SKILLS.every(s => typeof TND_SKILL_DETAILS[s.id] === 'string' && TND_SKILL_DETAILS[s.id].length >= 20), '전 스킬 상세 설명 존재');
  assert(!TND_SKILLS.some(s => s.id === 'yeoyu'), "'여유'는 결합판에서 제외 (신도로 대체)");
  assert(PIECES.length === 14, '기물 14종');

  // [기준] 같은 스킬은 두 면에 장착 불가
  assert(g.equip('jungta', 1, 5) === false, "이미 장착된 '정타'를 다른 면에 장착 → 거부");
  assert(g.unequip(0, 5) === true && g.equip('jungta', 1, 5) === true, '회수 후에는 다른 면에 장착 가능');
  // 장착 조건
  assert(g.equip('jeungpok', 3, 0) === false, "'증폭'(6만)을 눈 1 면에 → 거부");
  assert(g.equip('jeungpok', 3, 5) === true, "'증폭'을 눈 6 면에 → 장착");
  // 눈 증감 무제한, 범위 1~6, 조건 파괴 시 해제
  assert(g.changePip(3, 5, 1) === false, '눈 6에서 +1 거부');
  assert(g.changePip(3, 0, -1) === false, '눈 1에서 −1 거부');
  assert(g.changePip(3, 5, -1) === true && g.dice[3].faces[5].pip === 5, '눈 6 → 5 변경');
  assert(g.dice[3].faces[5].skill === null, "조건('6만') 파괴 → 스킬 해제");
  assert(g.changePip(3, 5, 1) === true && g.dice[3].faces[5].pip === 6, '변경권 없이 무제한 변경');
  // 순서 변경
  const first = g.dice[0];
  assert(g.moveDie(0, 1) === true && g.dice[1] === first, '주사위 순서 변경 (◀▶)');
  // 기물덱
  assert(g.deckAdd('spire') === false, '덱 5장일 때 추가 불가');
  assert(g.deckRemove(4) === true && g.deck.length === 4, '덱에서 제거');
  assert(g.canStart() === false, '덱 5장 미만이면 고행 시작 불가');
  assert(g.deckAdd('spire') === true && g.deck.length === 5 && g.canStart(), '덱에 추가 → 5장 → 시작 가능');
  // 고행 시작
  assert(g.startTrial() === true && g.phase === 'trial' && g.sub === 'roll' && g.turn === 1, '고행 시작 → 굴림 단계, 턴 1');
  assert(g.board.length === 32 && g.enemy.faith === 100 && g.player.pos === 0 && g.enemy.pos === 0, '보드 32칸, 적 신앙 100, 양측 시작칸');
  assert(g.moveDie(0, 1) === false && g.equip('gangta', 2, 5) === false, '고행 중에는 순서 변경·장착 불가');
}

// ---------------------------------------------------------------
console.log('시나리오 2 — 굴림 · 정산 · 변환');
// ---------------------------------------------------------------
{
  // 변환표 (§3.3, 게이지 0 시작)
  const table = [[10, 1, 0], [20, 2, 1], [30, 3, 3], [40, 4, 6], [45, 5, 5], [50, 6, 5], [60, 8, 8], [65, 11, 9], [70, 16, 9], [80, 26, 9], [100, 46, 9], [150, 96, 9]];
  for (const [pts, faith, gauge] of table) {
    const c = convert(pts, 0);
    assert(c.faith === faith && c.gauge === gauge, `변환표: 신앙치 ${pts} → 신앙 ${faith}, 잔량 ${gauge} (실제 ${c.faith}/${c.gauge})`);
  }
  // [기준] 콤보는 정산 종료 시 초기화, 게이지 잔량만 이월
  const c1 = convert(20, 0);
  const c2 = convert(9, c1.gauge);
  assert(c1.combo === 1 && c1.gauge === 1 && c2.faith === 1 && c2.combo === 0 && c2.gauge === 0, '콤보 미이월: 잔량 1에서 9 → 신앙 1, 콤보 0');

  // 잠금/재굴림
  const g = bare(3);
  g.startTrial();
  assert(g.rollsLeft === 2, '턴 시작 자동 굴림 후 재굴림 2회');
  g.toggleLock(1);
  const up = g.dice[1].upIndex;
  g.reroll(); g.reroll();
  assert(g.dice[1].upIndex === up && g.rollsLeft === 0 && g.reroll() === false, '잠긴 주사위 제외 재굴림, 소진 후 불가');
  assert(g.log.some(l => l.type === 'action' && l.text.startsWith('잠금')), '잠금 변경 로그');

  // 정산 수식 (매 단계 올림) — 1번 주사위 F6 정타 / F1 잔향 / F2 미열
  const s = bare(5);
  place(s, 0, 5, 'jungta'); place(s, 0, 0, 'janhyang'); place(s, 0, 1, 'miyeol');
  s.startTrial();
  s._forceUp([5, 0, 0, 0, 0]); // 활성 눈 6,1,1,1,1 = 10
  // 10 → 정타 +6 = 16 → (맞은편 F1) 잔향 +2 = 18 → (측면 F2) 미열 ×1.25 = 22.5 → 올림 23
  const pv = s.preview();
  assert(pv.points === 23, `신앙치: 매 단계 올림 (22.5 → 23), 실제 ${pv.points}`);
  // 23 → 충전(10) 신앙1 → 충전(10) 신앙2·콤보1 → 잔량 1+3 = 4
  assert(pv.faith === 2 && pv.gauge === 4, `프리뷰 변환: 신앙 +2, 잔량 4 (실제 ${pv.faith}/${pv.gauge})`);
  const f0 = s.player.faith;
  s.confirm();
  assert(s.player.faith - f0 === 2 && s.player.gauge === 4 && s.sub === 'act', '확정: 프리뷰와 동일한 신앙·잔량, 행동 단계로');
  assert(s.log.some(l => l.type === 'mul' && l.text.includes('미열')) && s.log.some(l => l.type === 'add' && l.text.includes('정타')), '덧셈/곱셈 로그 타입 구분');
  assert(s.log.some(l => l.text.startsWith('신앙치 23')), '신앙치 확정 로그');

  // [기준] 프리뷰 = 실제 정산 (무작위 플레이 퍼즈)
  {
    const rng = mulberry32(77);
    let checks = 0, ok = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const f = new TndGame({ rng: mulberry32(seed) });
      f.startTrial();
      for (let t = 0; t < 5 && f.phase === 'trial'; t++) {
        if (rng() < 0.6) f.toggleLock(Math.floor(rng() * 5));
        if (rng() < 0.7 && f.rollsLeft > 0) f.reroll();
        const p = f.preview(); const before = f.player.faith;
        f.confirm();
        checks++; if (f.player.faith - before === p.faith && f.player.gauge === p.gauge) ok++;
        // 행동: 첫 주사위로 이동, 대화창은 전부 건너뜀
        f.chooseMoveDie(0);
        let guard = 0;
        while (f.sub === 'dialog' && guard++ < 20) {
          const ty = f.pending.type;
          if (ty === 'pay') f.mustGiveUp() ? f.giveUp() : (f.canPay() ? f.payConfirm() : f.sellPiece(f.myPieces()[0].id));
          else if (ty === 'purify') f.skipPurify(); else if (ty === 'upgrade') f.skipUpgrade();
          else if (ty === 'destroy') f.skipDestroy(); else if (ty === 'build') f.skipBuild(); else if (ty === 'offering') f.offeringPay(0);
        }
      }
    }
    assert(checks >= 50 && ok === checks, `프리뷰 = 정산 결과 (${ok}/${checks})`);
  }

  // 보드 참조 스킬 · 응징 · 귀향 · 반복 상한
  const ctx = (o = {}) => ({ S: 10, activePips: [1, 1, 1, 1, 1], upPip: 1, pip: 1, orderIndex: 0, orderCount: 5, lockedCount: 0, rerollsLeft: 0, pieces: 3, corrupts: 2, enemyPieces: 2, playerPos: 5, inst: { growth: 0, count: 0 }, ...o });
  const E = id => TND_SKILLS_BY_ID[id];
  assert(evalEffectTnd(E('shindo'), ctx()).n === 9 && evalEffectTnd(E('seongjeon'), ctx()).n === 9, '신도/성전: 내 기물 3개 → +9');
  assert(evalEffectTnd(E('sungyo'), ctx()).n === 4, '순교: 타락 2칸 → +4');
  assert(Math.abs(evalEffectTnd(E('eungjing'), ctx()).n - 1.15 * 1.15) < 1e-9 && evalEffectTnd(E('eungjing'), ctx({ enemyPieces: 0 })) === null, '응징: 적 기물 2개 → ×1.3225, 0개면 미발동');
  assert(evalEffectTnd(E('gwihyang'), ctx({ playerPos: 27 })).n === 12 && evalEffectTnd(E('gwihyang'), ctx({ playerPos: 16 })) === null, '귀향: 시작칸 8칸 이내(27) 발동, 16은 미발동');
  assert(evalEffectTnd(E('banbok'), ctx({ inst: { growth: 0, count: 30 } })).n === 15, '반복: 최대 +15 상한');
  assert(evalEffectTnd(E('chukjeok'), ctx({ pip: 5 })).n === 3, '축적: 절반 올림 (5 → 3)');
}

// ---------------------------------------------------------------
console.log('시나리오 3 — 이동 · 칸 상호작용 · 기물 효과');
// ---------------------------------------------------------------
{
  // [기준] 주사위 하나를 사용해 그 눈만큼 이동
  const g = bare(9);
  g.startTrial(); g._forceUp([3, 1, 0, 0, 0]); g.confirm();
  assert(g.reachable().map(r => r.cell).join(',') === '4,2,1,1,1', '도착 가능 칸 5곳 = 각 주사위 눈');
  g.chooseMoveDie(0);
  assert(g.player.pos === 4 && g.usedMove === 0, '4번 눈 주사위로 이동 → 칸 4');
  assert(g.pending?.type === 'build' && g.sub === 'dialog', '빈 칸 도착 → 건설 창');
  const faithBefore = g.player.faith;
  g.player.faith = 10;
  assert(g.build('altar') === true && g.player.faith === 7 && g.board[4].piece?.defId === 'altar', '건설 시 비용 3 정확히 지불');
  assert(g.phase === 'trial' && g.sub === 'roll' && g.turn === 2, '건설 후 턴 종료 → 적 턴 → 플레이어 턴 2');

  // [기준] 이동 계층은 이동에 쓴 주사위에서만 발동, 정산에는 미참여
  const m = bare(11);
  place(m, 0, 5, 'heonnap'); place(m, 1, 5, 'haenggun');
  m.startTrial(); m._forceUp([5, 5, 0, 0, 0]);
  assert(m.preview().points === 6 + 6 + 3, '정산에서 이동 계층 미발동 (기본 눈합만)');
  m.confirm();
  const f1 = m.player.faith;
  m.chooseMoveDie(1); // 행군: 6 + 1 = 7칸
  assert(m.player.pos === 7 && m.player.faith === f1, "행군으로 7칸 이동, 선택하지 않은 주사위의 '헌납'은 미발동");
  const m2 = bare(11); place(m2, 0, 5, 'heonnap'); m2.startTrial(); m2._forceUp([5, 0, 0, 0, 0]); m2.confirm();
  const f2 = m2.player.faith; m2.chooseMoveDie(0);
  assert(m2.player.faith === f2 + 1 && m2.player.pos === 6, "'헌납' 주사위로 이동 → 신앙 +1");

  // [기준] 타락 칸 → 정화 창, 정화 비용 1 → 3 증가, 성수
  const c = bare(13);
  c.startTrial(); c._forceUp([2, 0, 0, 0, 0]); c.confirm();
  c.board[3].corrupt = { counter: 3 }; c.player.faith = 5;
  c.chooseMoveDie(0);
  assert(c.pending?.type === 'purify' && c.pending.cost === 1, '타락 칸 도착 → 정화 창 (비용 1)');
  assert(c.purify() === true && c.board[3].corrupt === null && c.player.faith === 4 && c.player.purifyCost === 3, '정화: 비용 1 지불, 다음 비용 3');
  assert(c.pending?.type === 'build', '정화한 빈 칸 → 건설 창');
  c.skipBuild();

  // [기준] 내 기물 칸 → 효과 발동 + 업그레이드 창, 다단 업그레이드 총액
  const u = bare(15);
  u.startTrial(); u._forceUp([2, 0, 0, 0, 0]); u.confirm();
  u.board[3].piece = { owner: 'P', defId: 'altar', grade: 1 }; u.player.faith = 10;
  u.chooseMoveDie(0);
  assert(u.player.faith === 11, '제단 밟음: 신앙 +1');
  assert(u.pending?.type === 'upgrade' && u.pending.perLevel === 2, '내 기물 칸 → 업그레이드 창 (제단 등급당 2)');
  assert(u.upgradeTo(4) === true && u.board[3].piece.grade === 4 && u.player.faith === 11 - 6, '다단 업그레이드 G1→G4: 3등급 × 2 = 6 지불');
  // 순례: 내 기물 효과 2회
  const s2 = bare(16); place(s2, 0, 2, 'sullye');
  s2.startTrial(); s2._forceUp([2, 0, 0, 0, 0]); s2.confirm();
  s2.board[3].piece = { owner: 'P', defId: 'altar', grade: 1 }; const fb = s2.player.faith;
  s2.chooseMoveDie(0);
  assert(s2.player.faith === fb + 2, "'순례' 주사위로 제단 밟음 → 효과 2회 (+2)");

  // [기준] 적 기물 → 강제지불 창, 판매로 충당, 게임 포기
  const p = bare(17);
  p.startTrial(); p._forceUp([2, 0, 0, 0, 0]); p.confirm();
  p.board[3].piece = { owner: 'E', grade: 1 }; p.board[10].piece = { owner: 'E', grade: 1 }; // M = 2
  p.board[20].piece = { owner: 'P', defId: 'sanctum', grade: 2 };
  p.player.faith = 1;
  p.chooseMoveDie(0);
  assert(p.pending?.type === 'pay' && p.pending.cost === 2 * 1 + 1 * 2, '사악한 기물 G1, M=2 → 강제지불 4');
  assert(p.canPay() === false && p.mustGiveUp() === false, '신앙 부족하지만 판매로 충당 가능');
  assert(p.sellPiece(20) === true && p.player.faith === 1 + ceil(5 * 2 / 2), '판매: 성소 G2 = 5×2÷2 = 5 신앙');
  assert(p.payConfirm() === true && p.player.faith === 2, '강제지불 4 지불 후 잔여 2');
  assert(p.pending?.type === 'destroy' && p.pending.cost === ceil(4 * 1.5), '지불 후 파괴 창 (최종 비용 ×1.5 = 6)');
  p.skipDestroy();
  const d = bare(18);
  d.startTrial(); d._forceUp([2, 0, 0, 0, 0]); d.confirm();
  d.board[3].piece = { owner: 'E', grade: 3 }; d.player.faith = 0;
  d.chooseMoveDie(0);
  assert(d.mustGiveUp() === true, '기물 전부 팔아도 부족 → 게임 포기 노출');
  assert(d.giveUp() === true && d.phase === 'end' && d.result === 'defeat', '게임 포기 → 패배');
  assert(d.log.some(l => l.type === 'decision'), '패배 로그는 결정 등급');
  // 강행: 지불 면제
  const gh = bare(19); place(gh, 0, 5, 'ganghaeng');
  gh.startTrial(); gh._forceUp([5, 0, 0, 0, 0]); gh.confirm();
  gh.board[6].piece = { owner: 'E', grade: 2 };
  gh.chooseMoveDie(0);
  assert(gh.pending?.type === 'destroy', "'강행'으로 적 기물 칸 도착 → 강제지불 없이 파괴 창");
  assert(gh.player.faith >= 0 && !gh.log.some(l => l.text.startsWith('강제지불')), '강제지불 로그 없음');

  // [기준] 고행 종료 후 정비 복귀, 구성 유지
  const ids = gh.dice.map(dd => dd.faces.map(f => f.skill?.id ?? '-').join(',')).join('|');
  gh._finish('victory', '★ 테스트 승리');
  assert(gh.backToPrep() === true && gh.phase === 'prep', '고행 종료 → 정비 복귀');
  assert(gh.dice.map(dd => dd.faces.map(f => f.skill?.id ?? '-').join(',')).join('|') === ids && gh.deck.length === 5, '정비 복귀 시 주사위·기물덱 구성 유지');
  assert(gh.startTrial() === true && gh.turn === 1, '재도전 가능');
}

// ---------------------------------------------------------------
console.log('시나리오 4 — 적 턴 · 타락 · 승리');
// ---------------------------------------------------------------
{
  // [기준] 적이 기물을 밟으면 +N 포함 차감 (제단 G2, N=2 → 2·2+2 = 6)
  const g = new TndGame({ rng: pip1 });
  applyBuild(g, []);
  g.startTrial();
  g.board[1].piece = { owner: 'P', defId: 'altar', grade: 2 };
  g.board[9].piece = { owner: 'P', defId: 'well', grade: 1 };
  g.enemy.pos = 0; g.enemyRollsLeft = 1; g.sub = 'enemy'; g.pending = null;
  const ef = g.enemy.faith;
  g._enemyContinue();
  assert(g.enemy.faith === ef + 1 - 6, `적 밟음 제단 G2 (N=2): +1 −6 (실제 ${g.enemy.faith - ef})`);
  // 타락 칸의 내 기물 무효 (묘지 제외)
  const t = new TndGame({ rng: pip1 }); applyBuild(t, []); t.startTrial();
  t.board[1].piece = { owner: 'P', defId: 'altar', grade: 1 }; t.board[1].corrupt = { counter: 3 };
  t.enemy.pos = 0; t.enemyRollsLeft = 1; t.sub = 'enemy';
  const tf = t.enemy.faith; t._enemyContinue();
  assert(t.enemy.faith === tf + 1 && t.board[1].corrupt.counter === 2, '타락 칸의 제단은 미발동, 타락 카운터 −1');
  const gr = new TndGame({ rng: pip1 }); applyBuild(gr, []); gr.startTrial();
  gr.board[1].piece = { owner: 'P', defId: 'grave', grade: 1 }; gr.board[1].corrupt = { counter: 3 };
  gr.enemy.pos = 0; gr.enemyRollsLeft = 1; gr.sub = 'enemy';
  const gf = gr.enemy.faith; gr._enemyContinue();
  assert(gr.enemy.faith === gf + 1 - 2, '타락 칸의 묘지는 발동 (−(1+N) = −2)');
  // 종탑 후퇴 / 성문 굴림 취소
  const b = new TndGame({ rng: pip1 }); applyBuild(b, []); b.startTrial();
  b.board[1].piece = { owner: 'P', defId: 'bell', grade: 2 };
  b.enemy.pos = 0; b.enemyRollsLeft = 3; b.sub = 'enemy';
  b._enemyContinue();
  assert(b.log.some(l => l.text.includes('후퇴 → 칸 31')), '종탑 G2: 적 말 2칸 후퇴 (1 → 31)');
  const ga = new TndGame({ rng: pip1 }); applyBuild(ga, []); ga.startTrial();
  ga.board[1].piece = { owner: 'P', defId: 'gate', grade: 1 };
  ga.enemy.pos = 0; ga.enemyRollsLeft = 3; ga.sub = 'enemy';
  ga._enemyContinue();
  assert(ga.enemy.pos === 1 && ga.turn === 2, '성문: 남은 굴림 취소 (적 1칸만 이동 후 플레이어 턴)');
  // 헌금함 프롬프트
  const of = new TndGame({ rng: pip1 }); applyBuild(of, []); of.startTrial();
  of.board[1].piece = { owner: 'P', defId: 'offering', grade: 1 }; of.player.faith = 5;
  of.enemy.pos = 0; of.enemyRollsLeft = 1; of.sub = 'enemy';
  of._enemyContinue();
  assert(of.pending?.type === 'offering' && of.pending.max === 3, '헌금함: 최대 3G 헌납 프롬프트');
  const ofE = of.enemy.faith;
  of.offeringPay(3);
  assert(of.player.faith === 2 && of.enemy.faith === ofE - 6, '3 헌납 → 적 신앙 −6, 적 턴 재개');

  // [기준] 적 한 바퀴 → 바퀴 수만큼 타락 생성
  const c = new TndGame({ rng: pip1 }); applyBuild(c, []); c.startTrial();
  c.enemy.pos = 31; c.enemyRollsLeft = 1; c.sub = 'enemy'; c._enemyContinue();
  assert(c.enemy.laps === 1 && c.corruptCount() === 1, '1바퀴 → 타락 1개');
  c.enemy.pos = 31; c.enemyRollsLeft = 1; c.sub = 'enemy'; c._enemyContinue();
  assert(c.enemy.laps === 2 && c.corruptCount() === 3, '2바퀴 → 타락 2개 추가 (누적 3)');
  assert(c.log.some(l => l.type === 'event' && l.text.includes('타락 2개 생성')), '한 바퀴 로그는 사건 등급');
  assert(!c.board[0].corrupt, '시작칸에는 타락 생성 안 됨');

  // [기준] 타락 만료: 사악한 기물 건설 / 플레이어 기물 파괴 / 기존 사악한 기물 등급 +1
  const x = new TndGame({ rng: pip1 }); applyBuild(x, []); x.startTrial(); // 적은 눈 1로만 이동 → 칸 8 미간섭
  x.board[5].corrupt = { counter: 1 };
  x.board[6].corrupt = { counter: 1 }; x.board[6].piece = { owner: 'P', defId: 'altar', grade: 3 };
  x.board[7].corrupt = { counter: 1 }; x.board[7].piece = { owner: 'E', grade: 1 };
  x.board[8].corrupt = { counter: 2 };
  x._endPlayerTurn();
  assert(x.board[5].piece?.owner === 'E' && x.board[5].piece.grade === 1 && !x.board[5].corrupt, '카운터 0 → 사악한 기물 G1');
  assert(x.board[6].piece?.owner === 'E' && x.log.some(l => l.text.startsWith('파괴됨  칸 6')), '플레이어 기물 파괴 후 사악한 기물');
  assert(x.board[7].piece.grade === 2, '기존 사악한 기물 등급 +1');
  assert(x.board[8].corrupt?.counter === 1, '카운터 2 → 1 (유지)');

}
// [기준] 적이 지불 못하면 즉시 승리
{
  const v = new TndGame({ rng: pip1 }); applyBuild(v, []); v.startTrial();
  v.board[1].piece = { owner: 'P', defId: 'sanctum', grade: 2 };
  v.enemy.faith = 5; v.enemy.pos = 0; v.enemyRollsLeft = 3; v.sub = 'enemy';
  v._enemyContinue();
  assert(v.phase === 'end' && v.result === 'victory' && v.log.some(l => l.type === 'decision'), '적 신앙 6 < 차감 7 → 즉시 승리 (결정 로그)');
  const v2 = new TndGame({ rng: pip1 }); applyBuild(v2, []); v2.startTrial();
  v2.board[1].piece = { owner: 'P', defId: 'sanctum', grade: 2 };
  v2.enemy.faith = 6; v2.enemy.pos = 0; v2.enemyRollsLeft = 1; v2.sub = 'enemy';
  v2._enemyContinue();
  assert(v2.phase === 'trial' && v2.enemy.faith === 0, '적 신앙 7 = 차감 7 → 지불 가능 (잔량 0)');
}

// ---------------------------------------------------------------
console.log('시나리오 5 — 빌드별 봇 승률 (기획안 §10 대조)');
// ---------------------------------------------------------------
{
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
  const r = {};
  for (const b of ['empty', 'starter', 'mid']) r[b] = runBuild(b, seeds);
  const med = a => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : '-';
  console.log(`  무장착 ${r.empty.win}/20 (승리 턴 중앙 ${med(r.empty.winTurns)}) · 입문 ${r.starter.win}/20 (${med(r.starter.winTurns)}) · 중급 ${r.mid.win}/20 (${med(r.mid.winTurns)})`);
  assert(r.starter.win >= 14, `입문 빌드 승률 70% 이상 (${r.starter.win}/20)`);
  assert(r.mid.win >= 18, `중급 빌드 승률 90% 이상 (${r.mid.win}/20)`);
  assert(r.empty.win < r.starter.win, '무장착 < 입문 (스킬을 장착하지 않은 주사위는 패배한다)');
  assert(r.empty.timeout + r.starter.timeout + r.mid.timeout === 0, '80턴 내에 전부 종료 (교착 없음)');
  const g = new TndGame({ rng: mulberry32(2) }); applyBuild(g, BUILDS.starter);
  const { playTrial } = await import('./tnd-bot.mjs'); playTrial(g);
  const types = new Set(g.log.map(l => l.type));
  assert(['decision', 'event', 'action', 'calc', 'add', 'mul'].every(t => types.has(t)), '로그 4등급 + 덧셈/곱셈 타입이 모두 사용됨');
  assert(g.board.every(c => !c.piece || c.piece.grade >= 1 && c.piece.grade <= 6), '기물 등급 1~6 불변식');
}

console.log('');
console.log(`결과: ${pass + fail}개 단언 중 ${pass}개 통과, ${fail}개 실패`);
if (fail > 0) { console.log('실패 목록:'); failures.forEach(f => console.log(` - ${f}`)); process.exit(1); }
