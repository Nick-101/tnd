// TnD 결합 데모 headless 검수 (v2.1) — node test/tnd.test.mjs
import { TndGame, mulberry32, makeInst, calcFaithPoints, calcOrder, convert, resolveMove, resolveEnemyMove, evalEffectTnd } from '../js/tnd-game.js';
import { TND, MONSTERS, TND_SKILLS, TND_SKILLS_BY_ID, TND_SKILL_DETAILS, ENGRAVINGS, ENGRAVING_DETAILS, PIECES, PIECES_BY_ID, ceil } from '../js/tnd-config.js';
import { runBuild, applyBuild, BUILDS, playTrial } from './tnd-bot.mjs';

let pass = 0, fail = 0; const failures = [];
function assert(c, name) { if (c) pass++; else { fail++; failures.push(name); console.error(`  ✗ FAIL: ${name}`); } }
const bare = (seed = 1, opts = {}) => { const g = new TndGame({ rng: mulberry32(seed), ...opts }); applyBuild(g, []); return g; };
const place = (g, d, f, id) => { g.dice[d].faces[f].skill = makeInst(id); return g.dice[d].faces[f].skill; };
const seq = (...vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; }; // 정해진 난수열
// 대화창 전부 건너뛰기 / 지불
function settleDialogs(g) { let k = 0; while (g.sub === 'dialog' && k++ < 30) { const t = g.pending.type; if (t === 'pay' || t === 'assault') g.canPay() ? g.payConfirm() : g.mustGiveUp() ? g.giveUp() : g.sellPiece(g.myPieces()[0].id); else if (t === 'purify') g.skipPurify(); else if (t === 'destroy') g.skipDestroy(); else if (t === 'build') g.skipBuild(); } }

console.log('시나리오 1 — 정비: 각인 · 면 스킬 · 눈 · 순서 · 덱');
{
  const g = new TndGame({ rng: mulberry32(1) });
  assert(g.dice.length === 3 && g.deck.length === 5 && g.phase === 'prep', '주사위 3개, 덱 5장, 정비에서 시작');
  assert(TND_SKILLS.length === 52 && ENGRAVINGS.length === 18 && PIECES.length === 20, `데이터: 면 스킬 52 / 각인 18 / 기물 20 (${TND_SKILLS.length}/${ENGRAVINGS.length}/${PIECES.length})`);
  assert(TND_SKILLS.every(s => TND_SKILL_DETAILS[s.id]?.length >= 20) && ENGRAVINGS.every(e => ENGRAVING_DETAILS[e.id]?.length >= 20), '전 스킬·각인 상세 설명 존재');
  assert(!TND_SKILLS.some(s => s.layer === 'move'), '이동 계층 스킬은 각인으로 흡수되어 제외');
  // [기준] 각인 장착·회수, 중복 불가
  assert(g.engrave('doyak', 0) === true && g.dice[0].engraving === 'doyak', "각인 '도약' 장착");
  assert(g.engrave('doyak', 1) === false, '같은 각인 중복 장착 불가');
  assert(g.engrave('gongheo', 0) === true && g.dice[0].engraving === 'gongheo', '각인 교체 (도약 → 공허)');
  assert(g.engrave('doyak', 1) === true, '교체로 풀린 도약은 다른 주사위에 장착 가능');
  assert(g.unengrave(1) === true && g.dice[1].engraving === null, '각인 회수');
  // 면 스킬
  assert(g.equip('jungta', 1, 5) === false, "이미 장착된 '정타' 중복 불가");
  assert(g.equip('jeungpok', 1, 0) === false && g.equip('jeungpok', 2, 5) === true, "'증폭'(6만)은 눈 6 면에만");
  assert(g.changePip(2, 5, -1) === true && g.dice[2].faces[5].skill === null, '눈 변경으로 조건 파괴 → 스킬 해제');
  assert(g.changePip(2, 0, -1) === false && g.changePip(2, 5, 1) === true, '눈 1~6 범위');
  const first = g.dice[0]; assert(g.moveDie(0, 1) && g.dice[1] === first, '계산 순서 변경');
  assert(g.deckRemove(4) && !g.canStart() && g.deckAdd('spire') && g.canStart(), '덱 제거/추가, 5장이어야 시작');
  assert(g.startTrial() && g.phase === 'trial' && g.sub === 'roll' && g.monster.faith === 250, '고행 시작: 순례자 신앙 250');
  assert(g.moveDie(0, 1) === false && g.engrave('jaedo', 0) === false, '고행 중 순서·각인 변경 불가');
}

console.log('시나리오 2 — 굴림형 · 정산형 각인, 변환');
{
  // 재도: 두 번 굴려 높은 쪽 (난수열 0→F1, 0.99→F6)
  const g = bare(1); g.dice[0].engraving = 'jaedo'; g.rng = seq(0, 0.99, 0, 0, 0, 0, 0, 0);
  g.startTrial();
  assert(g.dice[0].upIndex === 5, '재도: 0→F1, 0.99→F6 중 높은 F6');
  // 불굴: 1이면 한 번 더
  const b = bare(1); b.dice[0].engraving = 'bulgul'; b.rng = seq(0, 0.5, 0, 0, 0, 0, 0);
  b.startTrial(); assert(b.dice[0].upIndex === 3, '불굴: 1 → 재굴림 → F4');
  // 균형: 재굴림은 직전과 다른 면
  const y = bare(1); y.dice[0].engraving = 'gyunhyeong'; y.rng = seq(0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.5, 0.5, 0.5);
  y.startTrial(); const up0 = y.dice[0].upIndex; y.reroll();
  assert(y.dice[0].upIndex !== up0, '균형: 재굴림 결과가 직전과 다름');
  // 인내: 잠근 채 턴 종료 → 유지 + 눈 +1
  const n = bare(2); n.dice[0].engraving = 'innae'; n.startTrial();
  n._forceUp([2, 0, 0]); n.toggleLock(0); n.confirm();
  for (let i = 0; i < 3; i++) { n.chooseMoveDie(i); settleDialogs(n); }
  n.endTurn(); settleDialogs(n);
  assert(n.turn === 2 && n.dice[0].locked && n.activePip(n.dice[0]) === 4, `인내: 턴 2에도 잠김, 눈 3→4 (실제 잠김 ${n.dice[0].locked}, 눈 ${n.activePip(n.dice[0])})`);
  n.toggleLock(0); n.reroll();
  assert(n.dice[0].pipBonus === 0, '굴리면 인내 보너스 소멸');

  // 정산형: 공허(잠재 ×2/제곱), 짝의 심장, 헌신, 종장/서장
  const s = bare(3); place(s, 0, 0, 'janhyang'); place(s, 0, 1, 'miyeol'); s.dice[0].engraving = 'gongheo';
  s.startTrial(); s._forceUp([5, 0, 0]); // 활성 6,1,1 = 8
  // 잔향(F1 바닥면) +2×2=4 → 12, 미열(F2 측면) ×1.25² = 1.5625 → 18.75 → 19
  assert(s.preview().points === 19, `공허: 잠재 덧셈 2배·곱셈 제곱 (8+4=12, ×1.5625=18.75→19), 실제 ${s.preview().points}`);
  const h = bare(3); h.dice[0].engraving = 'heonsin'; h.startTrial(); h._forceUp([5, 0, 0]);
  assert(h.preview().points === 18 + 2, '헌신: 활성면 스킬 없음 → 눈 6을 18로 (18+1+1=20)');
  const j = bare(3); j.dice[0].engraving = 'jjakheart'; place(j, 0, 5, 'jungta'); j.startTrial(); j._forceUp([5, 0, 0]);
  assert(j.preview().points === ceil((8 + 6) * 1.2), '짝의 심장: 눈 6 짝수 → 이 주사위 계산 후 ×1.2 (14→17)');
  const o = bare(3); o.dice[0].engraving = 'jongjang'; o.dice[2].engraving = 'seojang';
  assert(calcOrder(o.dice).join(',') === '2,1,0', '계산 순서: 서장(③) → ② → 종장(①)');
  place(o, 0, 5, 'jeungpok'); place(o, 2, 5, 'jungta'); o.startTrial(); o._forceUp([5, 0, 5]);
  // 활성 6+1+6=13 → 서장 ③ 정타 +6 = 19 → 종장 ① 증폭 ×2.5 = 47.5 → 48 (순서가 반대면 (13×2.5=33)+6=39)
  assert(o.preview().points === 48, `종장/서장이 계산 순서를 덮어씀 (48, 실제 ${o.preview().points})`);
  // 변환표 (§4)
  for (const [pts, faith] of [[10, 1], [20, 2], [30, 3], [40, 4], [50, 6], [60, 8], [65, 11], [70, 16], [80, 26], [100, 46], [150, 96], [300, 246]]) {
    assert(convert(pts, 0).faith === faith, `변환표 ${pts} → ${faith}`);
  }
  assert(convert(9, convert(20, 0).gauge).combo === 0, '콤보는 정산 종료 시 초기화, 잔량만 이월');
  // 프리뷰 = 정산 (퍼즈)
  let checks = 0, ok = 0; const rng = mulberry32(5);
  for (let seed = 1; seed <= 10; seed++) {
    const f = new TndGame({ rng: mulberry32(seed) }); applyBuild(f, BUILDS.mid, ['gongheo', 'jjakheart', 'jongjang']); f.startTrial();
    for (let t = 0; t < 4 && f.phase === 'trial'; t++) {
      if (rng() < 0.5) f.toggleLock(Math.floor(rng() * 3)); if (rng() < 0.6 && f.rollsLeft > 0) f.reroll();
      const p = f.preview(); const before = f.player.faith; f.confirm(); checks++;
      if (f.player.faith - before === p.faith && f.player.gauge === p.gauge) ok++;
      for (let i = 0; i < 3 && f.sub !== 'end'; i++) { if (f.sub === 'act') f.chooseMoveDie(i); settleDialogs(f); }
      if (f.sub === 'build') f.endTurn(); settleDialogs(f);
    }
  }
  assert(checks >= 30 && ok === checks, `프리뷰 = 정산 결과 (${ok}/${checks})`);
  const ctx = { S: 10, activePips: [1, 2, 3], upPip: 1, pip: 1, orderIndex: 0, orderCount: 3, lockedCount: 0, rerollsLeft: 0, pieces: 2, corrupts: 1, enemyPieces: 2, playerPos: 5, inst: { growth: 0, count: 0 } };
  assert(evalEffectTnd(TND_SKILLS_BY_ID['gwihyang'], ctx).n === 12 && evalEffectTnd(TND_SKILLS_BY_ID['gwihyang'], { ...ctx, playerPos: 9 }) === null, '귀향: 안전지대(1~8)에서만');
  assert(evalEffectTnd(TND_SKILLS_BY_ID['yeonswae'], ctx).n === 18 && evalEffectTnd(TND_SKILLS_BY_ID['sangae'], ctx).n === 1.8, '연쇄·산개: 활성 눈 3개 기준');
}

console.log('시나리오 3 — 이동: 방식 · 구간 · 밟음/멈춤 · 경로 계획');
{
  const board = Array.from({ length: 32 }, (_, i) => ({ id: i, piece: null, corrupt: null }));
  const flags = r => r.path.map(p => `${p.cell}${p.pass ? 'p' : ''}${p.stop ? 's' : ''}`).join(' ');
  assert(flags(resolveMove(board, 0, 3, 'basic')) === '1p 2p 3ps', '기본: 경유 밟음, 도착 밟음+멈춤');
  assert(flags(resolveMove(board, 0, 3, 'teleport')) === '1 2 3ps', '순간이동: 도착만 밟음+멈춤');
  assert(flags(resolveMove(board, 0, 5, 'jump')) === '1 2p 3 4p 5ps', '점프(2): 2칸마다 밟음, 도착 밟음+멈춤');
  assert(flags(resolveMove(board, 0, 3, 'slow')) === '1ps 2ps 3ps', '서행: 경유 전부 밟음+멈춤');
  assert(flags(resolveMove(board, 0, 3, 'stealth')) === '1 2 3', '은밀: 아무 판정 없음');
  assert(resolveMove(board, 30, 4, 'basic').to === 2 && resolveMove(board, 30, 4, 'basic').crossings === 1, '시작칸 통과 → 바퀴 +1');
  board[2].piece = { owner: 'P', defId: 'signpost', grade: 1 };
  assert(resolveMove(board, 0, 3, 'basic', { signpost: true }).to === 4 && resolveMove(board, 0, 3, 'stealth', { signpost: true }).to === 3, '이정표: 밟으면 거리 +1 (은밀은 제외)');

  // [기준] 주사위 3개 전부 사용, 눈만큼 반드시, 최종 칸 = 시작 + 눈 합 (순서 무관)
  const a = bare(7); a.startTrial(); a._forceUp([2, 4, 5]); a.confirm(); // 눈 3,5,6
  assert(a.previewSegment(0).to === 3 && a.previewSegment(1).to === 5, '호버 프리뷰: 현재 위치 기준 도착 칸');
  const plan = a.routePlan().sort((x, y) => x - y).join(',');
  assert(plan === '3,5,6,8,9,11,14', `경로 계획: 눈 3·5·6 → 멈춤 후보 7곳 (${plan})`);
  a.chooseMoveDie(2); settleDialogs(a);
  assert(a.player.pos === 6 && a.usedDice.length === 1 && a.sub === 'act', '구간 1/3: ③ 6칸 → 칸 6, 다음 주사위 선택으로 복귀');
  assert(a.chooseMoveDie(2) === false, '사용한 주사위 재선택 불가');
  assert(a.previewSegment(0).to === 9, '프리뷰가 이동 후 위치를 기준으로 갱신');
  a.chooseMoveDie(0); settleDialogs(a); a.chooseMoveDie(1); settleDialogs(a);
  assert(a.player.pos === 14 && a.sub === 'build', '3개 모두 사용 → 최종 칸 14 = 0+3+5+6, 건설 단계');
  assert(a.player.stoppedAt.join(',') === '6,9,14', '이번 턴 멈춘 칸 3곳 기록');
  const a2 = bare(7); a2.startTrial(); a2._forceUp([2, 4, 5]); a2.confirm();
  a2.chooseMoveDie(0); settleDialogs(a2); a2.chooseMoveDie(1); settleDialogs(a2); a2.chooseMoveDie(2); settleDialogs(a2);
  assert(a2.player.pos === 14 && a2.player.stoppedAt.join(',') === '3,8,14', '다른 순서: 최종 칸 동일(14), 중간 멈춤만 다름');
  assert(a2.endTurn() === true && a2.turn === 2, '건설 단계에서 턴 종료 → 적 턴 → 턴 2');

  // [기준] 강제지불은 멈춤에서만 / 은밀은 아무것도 발동 안 함 / 서행은 경유도 멈춤
  const p = bare(8); p.dice[0].engraving = 'sullye'; p.dice[1].engraving = 'eunsin'; p.startTrial(); p._forceUp([2, 2, 0]); p.confirm(); // 눈 3,3,1
  p.board[1].piece = { owner: 'E', grade: 1 }; p.board[4].piece = { owner: 'E', grade: 1 }; p.board[5].piece = { owner: 'P', defId: 'well', grade: 1 }; p.player.faith = 20;
  p.chooseMoveDie(2); // 기본 1칸 → 칸 1 적 기물에 멈춤
  assert(p.pending?.type === 'pay' && p.pending.cost === 2 * 1 + 1 * 2, '기본 이동 멈춤: 사악한 기물 강제지불 (2G+G×M = 4)');
  p.payConfirm(); settleDialogs(p);
  const f1 = p.player.faith; p.chooseMoveDie(1); settleDialogs(p); // 은밀 3칸: 1→4 (칸 4 적 기물)
  assert(p.player.pos === 4 && p.player.faith === f1 && !p.log.some(l => l.text.includes('칸 4 · 사악한')), '은밀: 적 기물 칸에 도착해도 강제지불 없음');
  const g0 = p.player.gauge; p.chooseMoveDie(0); // 서행 3칸: 5,6,7 — 칸 5 우물 멈춤(+3G) 
  settleDialogs(p);
  assert(p.player.gauge === Math.min(10, g0 + 3) && p.player.stoppedAt.includes(5) && p.player.stoppedAt.includes(6), '서행: 경유 칸 5(우물 멈춤 +3G)·6도 멈춤 처리');
  const q = bare(9); q.startTrial(); q._forceUp([2, 0, 0]); q.confirm();
  q.board[1].piece = { owner: 'E', grade: 1 }; q.player.faith = 0;
  q.chooseMoveDie(0); // 기본 3칸: 칸1 경유(적 기물) → 밟음만
  assert(q.player.pos === 3 && q.pending?.type === 'build', '경유(밟음)한 적 기물은 강제지불 없음 → 빈 칸 3 건설 창');
  // 활보 +1
  const w = bare(9); w.dice[0].engraving = 'hwalbo'; w.startTrial(); w._forceUp([2, 0, 0]); w.confirm();
  assert(w.previewSegment(0).to === 4 && (w.chooseMoveDie(0), w.player.pos === 4), '활보: 거리 +1 (3 → 4칸)');
  // 보드형: 정화의 발걸음 / 개척 / 징수 / 축복
  const h = bare(10); h.dice[0].engraving = 'jeonghwabal'; h.dice[1].engraving = 'gaecheok'; h.dice[2].engraving = 'jingsu'; h.startTrial(); h._forceUp([0, 0, 0]); h.confirm(); h.player.faith = 30;
  h.board[1].corrupt = { counter: 3 }; h.chooseMoveDie(0);
  assert(h.board[1].corrupt.counter === 5 && h.pending?.type === 'purify', '정화의 발걸음: 멈춘 타락 칸 카운터 +2 → 5, 정화 창');
  h.skipPurify(); settleDialogs(h);
  h.chooseMoveDie(1);
  assert(h.pending?.type === 'build' && h.buildCost('spire') === ceil(60 * 0.7), '개척: 멈춘 빈 칸 건설 비용 −30% (첨탑 60 → 42)');
  h.skipBuild(); h.board[3].piece = { owner: 'E', grade: 2 };
  h.chooseMoveDie(2);
  assert(h.pending?.type === 'pay' && h.pending.cost === ceil((2 * 2 + 2 * 1) / 2), '징수: 강제지불 절반 (6 → 3)');
  const c = bare(11); c.dice[0].engraving = 'chukbok'; c.startTrial(); c._forceUp([1, 0, 0]); c.confirm();
  c.board[1].piece = { owner: 'P', defId: 'well', grade: 1 }; const cg = c.player.gauge; c.chooseMoveDie(0); settleDialogs(c);
  assert(c.player.gauge === Math.min(10, cg + 2), '축복: 밟은 우물을 G2로 취급 (게이지 +2)');
}

console.log('시나리오 4 — 기물 훅 · 오라 · 원격 업그레이드 · 신앙 지불');
{
  const pip1 = () => 0;
  const foe = (setup, n = 1, faith = 250) => { const g = bare(1); g.rng = pip1; g.startTrial(); setup(g); g.monster.pos = 0; g.monster.faith = faith; g.enemyQueue = resolveEnemyMove(g.monster.pos, n, g.monsterDef).path.map(step => ({ step })); g.sub = 'enemy'; g.pending = null; g._enemyContinue(); return g; };
  // 순례자는 0 다음 걸음에 9로 도약 → 0에서 이동 1 = 칸 9 도착
  let g = foe(x => { x.board[9].piece = { owner: 'P', defId: 'altar', grade: 2 }; }, 1);
  assert(g.monster.faith === 250 - 2 - 6, '제단 G2: 적밟 −G(2) + 적멈 −3G(6) = −8');
  g = foe(x => { x.board[9].piece = { owner: 'P', defId: 'spire', grade: 3 }; }, 2);
  assert(g.monster.faith === 250 - 9, '첨탑 G3 경유: 적밟 −G² = −9 (멈춤 아님)');
  g = foe(x => { x.board[10].piece = { owner: 'P', defId: 'spire', grade: 2 }; }, 2);
  assert(g.monster.faith === 250 - 4 - 12, '첨탑 G2 멈춤: −G² −3G² = −16');
  g = foe(x => { x.board[9].piece = { owner: 'P', defId: 'grave', grade: 1 }; x.board[9].corrupt = { counter: 3 }; x.board[10].piece = { owner: 'P', defId: 'altar', grade: 1 }; x.board[10].corrupt = { counter: 3 }; }, 2);
  assert(g.monster.faith === 250 - 1 && g.board[10].corrupt.counter === 2, '타락 칸: 묘지만 발동(−1), 제단 무효, 멈춘 타락 카운터 −1');
  g = foe(x => { x.board[9].piece = { owner: 'P', defId: 'taxman', grade: 2 }; x.board[20].piece = { owner: 'P', defId: 'stake', grade: 1 }; x.board[21].piece = { owner: 'P', defId: 'stake', grade: 1 }; }, 1);
  assert(g.monster.faith === 250 - 2 * 3, '세리 G2, N=3 → −(G×N) = −6');
  g = foe(x => { x.board[11].piece = { owner: 'P', defId: 'bell', grade: 1 }; }, 3);
  assert(g.monster.pos === 9 && g.log.some(l => l.text.includes('후퇴')), '종탑 G1 멈춤: 적 2칸 후퇴 (11 → 9)');
  g = foe(x => { x.board[9].piece = { owner: 'P', defId: 'gate', grade: 1 }; }, 1);
  assert(g.monster.skipNext === true && g.intent().skipping, '성문 멈춤: 적의 다음 패턴 행동 건너뜀 (의도에 표시)');
  g = foe(x => { x.board[9].piece = { owner: 'P', defId: 'court', grade: 2 }; }, 1, 200);
  assert(g.monster.faith === 200 - 20, '심판소 G2 멈춤: 현재 신앙의 10% (200 → 180)');
  g = foe(x => { x.board[9].piece = { owner: 'P', defId: 'stake', grade: 1 }; x.board[11].piece = { owner: 'P', defId: 'cathedral', grade: 1 }; }, 1);
  assert(g.monster.faith === 250 - 2, '대성당 오라: 좌우 2칸 말뚝 효과 ×2 (−1 → −2)');
  g = foe(x => { x.board[9].piece = { owner: 'P', defId: 'altar', grade: 1 }; x.board[10].piece = { owner: 'P', defId: 'altar', grade: 1 }; x.board[25].piece = { owner: 'P', defId: 'constellation', grade: 1 }; }, 2);
  assert(g.monster.faith === 250 - (1 + 3) - (1 + 3), '성좌 오라: 경유 칸(9)도 멈춤 판정 → 제단 두 곳 모두 −G−3G');
  g = foe(x => { x.board[9].piece = { owner: 'P', defId: 'stake', grade: 1 }; x.board[20].piece = { owner: 'P', defId: 'temple', grade: 1 }; }, 1);
  assert(g.monster.faith === 250 - 3, '신전 오라: 말뚝 G1을 G3로 취급 (−3)');
  const t = bare(2); t.startTrial(); t.board[20].piece = { owner: 'P', defId: 'temple', grade: 2 }; t._forceUp([0, 0, 0]); t.confirm();
  for (let i = 0; i < 3; i++) { t.chooseMoveDie(i); settleDialogs(t); } const fb = t.player.faith; t.endTurn(); settleDialogs(t);
  assert(t.player.faith >= fb + 20, '신전 G2: 턴 시작 시 신앙 +10G');
  const gr = bare(2); gr.startTrial(); gr.board[20].piece = { owner: 'P', defId: 'grail', grade: 1 }; gr._forceUp([0, 0, 0]);
  assert(gr.preview().faith === 3 && gr.preview().gauge === 9, '성배 오라: 잔량 항상 9 → 신앙치 3이 1:1 (3 신앙)');
  // 내밟/내멈
  const m = bare(3); m.startTrial(); m._forceUp([1, 0, 0]); m.confirm(); m.board[1].piece = { owner: 'P', defId: 'well', grade: 2 }; m.board[2].piece = { owner: 'P', defId: 'altar', grade: 1 };
  const f0 = m.player.faith, g0 = m.player.gauge; m.chooseMoveDie(0); settleDialogs(m);
  assert(m.player.gauge === Math.min(10, g0 + 2) && m.player.faith === f0 + 1 && m.sub === 'act', '우물 G2 밟음 +2 게이지, 제단 멈춤 신앙 +1 (멈춤에서 업그레이드 창은 뜨지 않음)');
  const pu = bare(4); pu.startTrial(); pu._forceUp([0, 0, 0]); pu.confirm(); pu.board[1].piece = { owner: 'P', defId: 'purifier', grade: 1 }; pu.board[2].corrupt = { counter: 2 }; pu.player.purifyCost = 5;
  pu.chooseMoveDie(0); settleDialogs(pu);
  assert(pu.player.purifyCost === 1 && pu.board[2].corrupt === null, '정화소 멈춤: 정화 비용 1로, 좌우 G칸 타락 제거');
  const rd = bare(5); rd.startTrial(); rd._forceUp([0, 0, 0]); rd.confirm(); rd.board[1].piece = { owner: 'P', defId: 'road', grade: 2 };
  rd.chooseMoveDie(0); settleDialogs(rd);
  assert(rd.player.pos === 3 && rd.player.stoppedAt.join(',') === '1,3', '순례길 G2 멈춤: 즉시 2칸 추가 이동 후 멈춤 판정 (칸 3)');
  // [기준] 원격 업그레이드 · 멈춘 칸 반값 · 다단 총액 · 지불 정확
  const u = bare(6); u.startTrial(); u._forceUp([0, 0, 0]); u.confirm();
  u.board[1].piece = { owner: 'P', defId: 'spire', grade: 1 }; u.board[20].piece = { owner: 'P', defId: 'spire', grade: 1 }; u.player.faith = 500;
  assert(u.upgradePiece(20, 2) === false, '행동 단계에는 업그레이드 불가');
  for (let i = 0; i < 3; i++) { u.chooseMoveDie(i); settleDialogs(u); }
  assert(u.sub === 'build' && u.upgradeInfo(1).stopped === true && u.upgradeInfo(1).perLevel === 15 && u.upgradeInfo(20).perLevel === 30, '건설 단계: 멈춘 칸 1은 등급당 15(반값), 칸 20은 30');
  const fu = u.player.faith;
  assert(u.upgradePiece(20, 4) === true && u.player.faith === fu - 90 && u.board[20].piece.grade === 4, '원격 다단 업그레이드 G1→G4: 3×30 = 90 지불');
  assert(u.upgradePiece(1, 6) === true && u.player.faith === fu - 90 - 75, '멈춘 칸 G1→G6: 5×15 = 75 지불');
  // 건설/정화/파괴 지불
  const b = bare(6); b.startTrial(); b._forceUp([2, 0, 0]); b.confirm(); b.player.faith = 100; b.board[3].piece = { owner: 'E', grade: 1 };
  b.chooseMoveDie(0); assert(b.pending?.type === 'pay' && b.pending.cost === 3, '강제지불 창 (2G+G×M = 3)'); b.payConfirm();
  assert(b.player.faith === 97 && b.pending?.type === 'destroy' && b.pending.cost === ceil(3 * 1.5), '지불 97, 파괴 창 (3×1.5 → 5)');
  b.destroy(); assert(b.player.faith === 92 && b.pending?.type === 'build', '파괴 5 지불 → 건설 창');
  b.build('sanctum'); assert(b.player.faith === 82 && b.board[3].piece?.defId === 'sanctum', '성소 건설 10 지불');
  const pf = bare(6); pf.startTrial(); pf._forceUp([0, 0, 0]); pf.confirm(); pf.player.faith = 10; pf.board[1].corrupt = { counter: 3 };
  pf.chooseMoveDie(0); assert(pf.pending?.type === 'purify', '타락 칸 멈춤 → 정화 창'); pf.purify();
  assert(pf.player.faith === 9 && pf.player.purifyCost === 3 && pf.pending?.type === 'build', '정화 1 지불, 다음 3, 빈 칸 건설 창');
  // 판매·게임 포기
  const s = bare(6); s.startTrial(); s._forceUp([0, 0, 0]); s.confirm(); s.player.faith = 0; s.board[1].piece = { owner: 'E', grade: 3 }; s.board[20].piece = { owner: 'P', defId: 'sanctum', grade: 2 };
  s.chooseMoveDie(0); assert(s.pending?.type === 'pay' && !s.canPay() && !s.mustGiveUp(), '판매로 충당 가능');
  s.sellPiece(20); assert(s.player.faith === 10 && s.canPay(), '성소 G2 판매 +10'); s.payConfirm();
  const gu = bare(6); gu.startTrial(); gu._forceUp([0, 0, 0]); gu.confirm(); gu.player.faith = 0; gu.board[1].piece = { owner: 'E', grade: 6 };
  gu.chooseMoveDie(0); assert(gu.mustGiveUp() && gu.giveUp() && gu.result === 'defeat', '전부 팔아도 부족 → 게임 포기 → 패배');
  assert(gu.backToPrep() && gu.phase === 'prep' && gu.deck.length === 5, '정비 복귀, 구성 유지');
}

console.log('시나리오 5 — 몬스터: 패턴 · 의도 · 도약 · 강습 · 타락/소환 · 승리');
{
  const g = bare(1); g.rng = () => 0.5; g.startTrial(); g.player.faith = 100;
  const P = MONSTERS.pilgrim.pattern;
  // 시작칸 0에서 첫 걸음은 비행 구간(1~8)을 건너 9로: 이동 6 → 9,10,11,12,13,14
  assert(g.intent().action === P[0] && g.intent().to === 14 && !g.intent().path.some(p => p.cell >= 1 && p.cell <= 8), '의도: ① 이동 6 → 1~8 없이 도착 14');
  const finishTurn = (x, resolveAfter = true) => { x._forceUp([0, 0, 0]); x.confirm(); for (let i = 0; i < 3; i++) { x.chooseMoveDie(i); settleDialogs(x); } if (x.sub === 'build') x.endTurn(); if (resolveAfter) settleDialogs(x); };
  finishTurn(g); assert(g.monster.pos === 14 && g.monster.step === 1, '적 턴: 의도대로 이동 6 → 칸 14, 패턴 ②로');
  finishTurn(g); assert(g.monster.pos === 19, '② 이동 5 → 칸 19');
  finishTurn(g); assert(g.corruptCount() === 1 && g.board.filter(c => c.corrupt).every(c => c.id >= 9), '③ 타락 1 → 방어선(9~31)에 생성');
  finishTurn(g); assert(g.monster.pos === 26, '④ 이동 7 → 칸 26');
  finishTurn(g); assert(g.monster.pos === 9 && g.monster.laps === 1 && g.player.faith < 100, '⑤ 이동 6 → 시작칸 통과(강습 5 지불) → 도약 → 칸 9');
  // ③의 타락은 턴 6 종료 시 만료되어 이미 사악한 기물이 하나 생겼다 → 소환으로 하나 더
  finishTurn(g); assert(g.enemyPieceCount() === 2 && g.board.filter(c => c.piece?.owner === 'E').every(c => c.id >= 9) && g.log.some(l => l.text.includes('소환 1 →')), '⑥ 소환 1 → 방어선에 사악한 기물 G1 (타락 만료분 포함 2개)');
  assert(g.monster.step === 0 && g.intent().action === P[0], '패턴 순환: ⑥ 다음은 ①');
  // 도약 + 강습: 칸 30에서 이동 6 → 31, (0→9 도약), 10, 11, 12, 13
  const a = bare(2); a.rng = () => 0.5; a.startTrial(); a.monster.pos = 30; a.player.faith = 3;
  assert(a.intent().to === 13 && !a.intent().path.some(p => p.cell >= 1 && p.cell <= 8) && a.intent().path.some(p => p.assault), '의도 경로: 30 → 도약 → 13, 1~8 미포함, 강습 표시');
  finishTurn(a, false);
  assert(a.pending?.type === 'assault' && a.pending.cost === 5 && a.monster.laps === 1, '시작칸 통과 → 바퀴 1 강습 5 청구 (적 턴 일시 정지)');
  assert(a.mustGiveUp() && a.giveUp() && a.result === 'defeat', '강습 지불 불가 → 게임 포기 → 패배');
  const a2 = bare(2); a2.rng = () => 0.5; a2.startTrial(); a2.monster.pos = 30; a2.player.faith = 8;
  finishTurn(a2, false); assert(a2.pending?.type === 'assault' && a2.payConfirm() && a2.player.faith === 3 && a2.monster.pos === 13 && a2.turn === 2, '강습 5 지불 후 적 이동 재개 → 칸 13, 플레이어 턴 2');
  assert(a2.nextAssaultCost() === 10, '다음 강습 10 (바퀴마다 2배)');
  // 승리: 적 신앙 0 이하
  const v = bare(3); v.rng = () => 0.5; v.startTrial(); v.monster.faith = 5; v.board[14].piece = { owner: 'P', defId: 'sanctum', grade: 1 };
  finishTurn(v); assert(v.phase === 'end' && v.result === 'victory' && v.log.some(l => l.type === 'decision'), '성소 멈춤 −6·−2 → 적 신앙 0 이하 → 즉시 승리');
  // [기준] 몬스터 정의 교체 (데이터)
  const custom = { id: 'test', name: '시험관', faith: 30, moveMode: 'basic', pattern: [{ t: 'heal', n: 7 }, { t: 'empower' }, { t: 'move', n: 3 }, { t: 'wait' }], gimmicks: [], assault: [1] };
  const cm = bare(4, { monster: custom }); cm.rng = () => 0.5; cm.startTrial(); cm.player.faith = 50; cm.board[15].piece = { owner: 'E', grade: 1 };
  assert(cm.monster.faith === 30 && cm.intent().action.t === 'heal', '커스텀 몬스터: 신앙 30, 첫 의도 회복');
  finishTurn(cm); assert(cm.monster.faith === 37, '회복 +7');
  finishTurn(cm); assert(cm.board[15].piece.grade === 2, '강화: 사악한 기물 등급 +1');
  finishTurn(cm); assert(cm.monster.pos === 3, '기믹 없는 이동 3 → 칸 3 (도약 없음)');
  finishTurn(cm); assert(cm.monster.pos === 3 && cm.turn === 5, '대기: 위치 유지');
}

console.log('시나리오 6 — 빌드별 봇 (기획안 §18 대조)');
{
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
  const med = a => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : '-';
  const r = {};
  for (const b of ['starter', 'plus', 'semimid', 'mid', 'advanced']) r[b] = runBuild(b, seeds);
  console.log('  ' + Object.entries(r).map(([k, v]) => `${k} ${v.win}/20 (승리 턴 ${med(v.winTurns)}, 패배 턴 ${med(v.loseTurns)})`).join(' · '));
  assert(r.starter.win <= 4, `입문(6스킬): 무릎 아래 → 거의 전패 (${r.starter.win}/20)`);
  assert(r.semimid.win >= 14, `준중급(+침강·증폭): 무릎 통과 → 대부분 승리 (${r.semimid.win}/20)`);
  assert(r.mid.win >= 16, `중급: 승률 80% 이상 (${r.mid.win}/20)`);
  assert(r.advanced.win >= 18 && med(r.advanced.winTurns) <= 16, `상급: 거의 전승, 빠른 승리 (${r.advanced.win}/20, 중앙 ${med(r.advanced.winTurns)}턴)`);
  assert(Object.values(r).every(v => v.timeout === 0), '60턴 내 전부 종료');
  const g = new TndGame({ rng: mulberry32(3) }); applyBuild(g, BUILDS.mid, ['doyak', 'gongheo', 'jongjang']); playTrial(g);
  const types = new Set(g.log.map(l => l.type));
  assert(['decision', 'event', 'action', 'calc', 'add', 'mul'].every(t => types.has(t)), '로그 4등급 + 덧셈/곱셈 타입 사용');
  assert(g.log.some(l => l.text.includes('(효과 없음)')), '효과 없는 경유 밟음은 한 줄로 접힘');
}

console.log(''); console.log(`결과: ${pass + fail}개 단언 중 ${pass}개 통과, ${fail}개 실패`);
if (fail > 0) { console.log('실패 목록:'); failures.forEach(f => console.log(` - ${f}`)); process.exit(1); }
