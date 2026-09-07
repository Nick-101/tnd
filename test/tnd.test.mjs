// TnD 결합 데모 headless 검수 (v2.2) — node test/tnd.test.mjs
import { TndGame, mulberry32, makeInst, calcFaithPoints, calcOrder, convert, resolveMove, resolveLap, cloneBoard, emptyCell, expireCorrupt, evalEffectTnd } from '../js/tnd-game.js';
import { TND, MONSTERS, WAVES, HP_RATIO, CORRUPT_TYPES, PIECE_DETAILS, TND_SKILLS, TND_SKILLS_BY_ID, TND_SKILL_DETAILS, ENGRAVINGS, ENGRAVING_DETAILS, PIECES, PIECES_BY_ID, ceil } from '../js/tnd-config.js';
import { runBuild, applyBuild, BUILDS, playTrial } from './tnd-bot.mjs';

let pass = 0, fail = 0; const failures = [];
function assert(c, name) { if (c) pass++; else { fail++; failures.push(name); console.error(`  ✗ FAIL: ${name}`); } }
const bare = (seed = 1, opts = {}) => { const g = new TndGame({ rng: mulberry32(seed), ...opts }); applyBuild(g, []); return g; };
const place = (g, d, f, id) => { g.dice[d].faces[f].skill = makeInst(id); return g.dice[d].faces[f].skill; };
const seq = (...vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; }; // 정해진 난수열
// 대화창 전부 건너뛰기 / 지불
function settleDialogs(g) { let k = 0; while (g.sub === 'dialog' && k++ < 30) { const t = g.pending.type; if (t === 'pay') g.canPay() ? g.payConfirm() : g.mustGiveUp() ? g.giveUp() : g.sellPiece(g.myPieces()[0].id); else if (t === 'purify') g.skipPurify(); else if (t === 'destroy') g.skipDestroy(); else if (t === 'build') g.skipBuild(); else if (t === 'passage') g.passageStay(); else if (t === 'release') g.releaseConfirm(); } }

console.log('시나리오 1 — 정비: 각인 · 면 스킬 · 눈 · 순서 · 덱');
{
  const g = new TndGame({ rng: mulberry32(1) });
  assert(g.dice.length === 3 && g.deck.length === 5 && g.phase === 'prep', '주사위 3개, 덱 5장, 정비에서 시작');
  assert(TND_SKILLS.length === 52 && ENGRAVINGS.length === 18 && PIECES.length === 11 && WAVES.length === 12, `데이터: 면 스킬 52 / 각인 18 / 기물 11 / 웨이브 12 (${TND_SKILLS.length}/${ENGRAVINGS.length}/${PIECES.length}/${WAVES.length})`);
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
  assert(g.startTrial() && g.phase === 'trial' && g.sub === 'roll' && g.turn === 1 && g.monsters.length === 1 && g.monsters[0].hp === WAVES[0].monsters[0].hp, '고행 시작: 턴 1 = 웨이브 1 순례자 대기');
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
  assert(evalEffectTnd(TND_SKILLS_BY_ID['gwihyang'], ctx).n === 12 && evalEffectTnd(TND_SKILLS_BY_ID['gwihyang'], { ...ctx, playerPos: 9 }) === null && evalEffectTnd(TND_SKILLS_BY_ID['gwihyang'], { ...ctx, playerPos: 25 }).n === 12, '귀향: 시작칸에서 8칸 이내(5, 25)만, 9는 아님');
  assert(evalEffectTnd(TND_SKILLS_BY_ID['yeonswae'], ctx).n === 18 && evalEffectTnd(TND_SKILLS_BY_ID['sangae'], ctx).n === 1.8, '연쇄·산개: 활성 눈 3개 기준');
}

console.log('시나리오 3 — 이동: 방식 · 구간 · 밟음/멈춤 · 경로 계획');
{
  const board = Array.from({ length: 32 }, (_, i) => emptyCell(i));
  const flags = r => r.path.map(p => `${p.cell}${p.pass ? 'p' : ''}${p.stop ? 's' : ''}`).join(' ');
  assert(flags(resolveMove(board, 0, 3, 'basic')) === '1p 2p 3ps', '기본: 경유 밟음, 도착 밟음+멈춤');
  assert(flags(resolveMove(board, 0, 3, 'teleport')) === '1 2 3ps', '순간이동: 도착만 밟음+멈춤');
  assert(flags(resolveMove(board, 0, 5, 'jump')) === '1 2p 3 4p 5ps', '점프(2): 2칸마다 밟음, 도착 밟음+멈춤');
  assert(flags(resolveMove(board, 0, 3, 'slow')) === '1ps 2ps 3ps', '서행: 경유 전부 밟음+멈춤');
  assert(flags(resolveMove(board, 0, 3, 'stealth')) === '1 2 3', '은밀: 아무 판정 없음');
  assert(resolveMove(board, 30, 4, 'basic').to === 2 && resolveMove(board, 30, 4, 'basic').crossings === 1, '시작칸 통과 → 바퀴 +1');
  assert(flags(resolveMove(board, 5, 3, 'basic', { dir: -1 })) === '4p 3p 2ps' && resolveMove(board, 2, 4, 'basic', { dir: -1 }).crossings === 0, '역방향 이동: 칸이 거꾸로, 시작칸 통과는 바퀴로 세지 않음');

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
  assert(a.player.stoppedAt.join(',') === '6,9,14' && a.player.passedAt.length === 14, '이번 턴 멈춘 칸 3곳 · 밟은 칸 14곳 기록');
  const a2 = bare(7); a2.startTrial(); a2._forceUp([2, 4, 5]); a2.confirm();
  a2.chooseMoveDie(0); settleDialogs(a2); a2.chooseMoveDie(1); settleDialogs(a2); a2.chooseMoveDie(2); settleDialogs(a2);
  assert(a2.player.pos === 14 && a2.player.stoppedAt.join(',') === '3,8,14', '다른 순서: 최종 칸 동일(14), 중간 멈춤만 다름');
  assert(a2.endTurn({ force: true }) === true && a2.turn === 2, '건설 단계에서 턴 종료 → 웨이브 해석 → 턴 2');

  // [기준] 강제지불은 멈춤에서만 / 은밀은 아무것도 발동 안 함 / 서행은 경유도 멈춤
  const p = bare(8); p.dice[0].engraving = 'sullye'; p.dice[1].engraving = 'eunsin'; p.startTrial(); p._forceUp([2, 2, 0]); p.confirm(); // 눈 3,3,1
  p.board[1].piece = { owner: 'E', grade: 1 }; p.board[4].piece = { owner: 'E', grade: 1 }; p.board[5].piece = { owner: 'P', defId: 'well', grade: 1 }; p.player.faith = 20;
  p.chooseMoveDie(2); // 기본 1칸 → 칸 1 적 기물에 멈춤
  assert(p.pending?.type === 'pay' && p.pending.cost === 2 * 1 + 1 * 2, '기본 이동 멈춤: 사악한 기물 강제지불 (2G+G×M = 4)');
  p.payConfirm(); settleDialogs(p);
  const f1 = p.player.faith; p.chooseMoveDie(1); settleDialogs(p); // 은밀 3칸: 1→4 (칸 4 적 기물)
  assert(p.player.pos === 4 && p.player.faith === f1 && !p.log.some(l => l.text.includes('칸 4 · 사악한')) && p.player.passedAt.length === 1, '은밀: 적 기물 칸에 도착해도 강제지불 없음, 밟은 칸으로 기록되지 않음');
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
  h.board[1].corrupt = { counter: 3, type: 'erode' }; h.chooseMoveDie(0);
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

console.log('시나리오 4 — 기물 11종 · 한 바퀴 해석(resolveLap) · 경로 조작 · 오라 · 밟음 한정 업그레이드 · 신앙 지불');
{
  assert(PIECES.every(p => PIECE_DETAILS[p.id]?.length >= 20 && p.verb), '기물 11종 전부 동사·상세 설명 존재');
  // 한 바퀴 해석 헬퍼: 빈 보드에 setup을 적용하고 시험 몬스터(pattern·mode·hp)를 시작칸에서 출발시킨다
  const lap = (setup, { pattern = [5], mode = 'basic', hp = 250 } = {}) => {
    const board = Array.from({ length: 32 }, (_, i) => emptyCell(i)); setup(board);
    const m = { name: '시험', mark: '①', hp, pos: 0, step: 0, dir: 1, nextMod: 0, passageUsed: false, def: { moveMode: mode, pattern, leak: { count: 1, type: 'erode', placement: 'emptyRandom' } } };
    return { r: resolveLap(board, m), m, board };
  };
  const P = (board, id, defId, grade = 1, extra = {}) => { board[id].piece = { owner: 'P', defId, grade, ...extra }; };
  let t = lap(b => P(b, 5, 'altar', 2));
  assert(t.r.damage === 2 + 6 && t.r.escaped && t.r.stops[0] === 5 && t.r.path.length === 31 && t.m.pos === 0, '제단 G2 (멈춤 칸): 적밟 −G(2) + 적멈 −3G(6) = −8, 31칸 뒤 시작칸 통과 = 탈출');
  t = lap(b => P(b, 3, 'spire', 3)); assert(t.r.damage === 9, '첨탑 G3 경유: 적밟 −G² = −9 (멈춤 아님)');
  t = lap(b => P(b, 5, 'spire', 2)); assert(t.r.damage === 4 + 12, '첨탑 G2 멈춤: −G² −3G² = −16');
  t = lap(b => P(b, 10, 'sanctum', 1)); assert(t.r.damage === 2 + 6, '성소 G1 멈춤 칸(10): −2G −6G = −8');
  t = lap(b => { P(b, 3, 'altar', 1); b[3].corrupt = { counter: 3, type: 'erode' }; P(b, 5, 'altar', 1); b[5].corrupt = { counter: 3, type: 'erode' }; });
  assert(t.r.damage === 0 && t.board[5].corrupt.counter === 2, '타락 칸의 내 기물은 효과 무효, 멈춘 타락 칸 카운터 −1');
  t = lap(b => { P(b, 5, 'altar', 1); P(b, 7, 'cathedral', 1); }); assert(t.r.damage === 2 + 6, '대성당 오라: 좌우 2칸 제단 효과 ×2 (−1−3 → −2−6)');
  t = lap(b => { P(b, 5, 'cathedral', 1); }); assert(t.r.damage === 10, '대성당 적멈: −10G');
  t = lap(b => { P(b, 1, 'altar', 1); P(b, 2, 'altar', 1); P(b, 3, 'altar', 1); P(b, 4, 'altar', 1); }, { mode: 'jump', pattern: [4] });
  assert(t.r.damage === 1 + (1 + 3) && t.r.path.filter(p => p.pass).slice(0, 2).map(p => p.cell).join(',') === '2,4', '점프(2) 몬스터: 칸 2·4만 밟음 (2 −1, 4 −1−3), 홀수 칸 제단 무력');
  t = lap(b => { for (const c of [1, 2, 3]) P(b, c, 'altar', 1); }, { mode: 'slow', pattern: [3] });
  assert(t.r.damage === 3 * 4 && t.r.stops.slice(0, 3).join(',') === '1,2,3', '서행 몬스터: 경유 칸 3곳 모두 밟음+멈춤 (제단 −G−3G ×3 = −12)');
  // [기준] 미끼 · 늪 · 성문 — 프리뷰 멈춤 칸이 §13.2 판정대로
  t = lap(b => P(b, 3, 'decoy', 2)); assert(t.r.stops[0] === 3 && t.r.stops[1] === 8 && t.r.path[2].cause === 'decoy' && t.r.events.some(e => e.text === '미끼 · 시험 도착 5→3'), '미끼 G2 (칸 3): 도착 5가 2칸 이내 → 3에서 멈춤, 남은 이동 소멸, 다음 이동은 3부터 (8)');
  t = lap(b => P(b, 3, 'decoy', 1)); assert(t.r.stops[0] === 5, '미끼 G1: 도착 5가 2칸 밖 → 유인 없음');
  t = lap(b => P(b, 3, 'swamp', 2)); assert(t.r.stops[0] === 5 && t.r.stops[1] === 8 && t.r.events.some(e => e.text.includes('이동 5 → 3')), '늪 G2: 밟은 몬스터의 다음 이동 5 → 3 (5 다음 멈춤이 8)');
  t = lap(b => { P(b, 3, 'swamp', 3); P(b, 4, 'swamp', 3); }); assert(t.r.stops[1] === 6, '늪 누적 −6 → 최소 1칸 (5 다음 멈춤이 6)');
  t = lap(b => P(b, 3, 'gate', 1, { charges: 1 }));
  assert(t.r.stops[0] === 3 && t.board[3].piece.charges === 0 && t.r.stops[1] === 8 && t.r.path[2].cause === 'gate', '성문 닫힘 1 (칸 3): 정지(멈춤 판정), 닫힘 0으로, 다음 이동은 3부터');
  t = lap(b => P(b, 3, 'gate', 1, { charges: 0 })); assert(t.r.stops[0] === 5, '열린 성문(닫힘 0): 통과');
  t = lap(b => { P(b, 3, 'gate', 1, { charges: 1 }); P(b, 4, 'decoy', 6); }); assert(t.r.stops[0] === 3, '성문이 미끼보다 먼저 판정');
  // 종탑 · 거울 · 통로
  t = lap(b => P(b, 5, 'bell', 1)); assert(t.r.stops[0] === 5 && t.r.stops[1] === 8 && t.r.path[5].cell === 4 && t.r.path[5].pass && t.r.events.some(e => e.text.includes('2칸 후퇴 → 칸 3')), '종탑 G1: 멈춘 몬스터 2칸 후퇴(5→3, 되돌아간 칸 4·3은 경로에 없음), 다음 이동은 3부터 4를 밟아 8에');
  t = lap(b => { P(b, 5, 'mirror', 1); P(b, 3, 'altar', 1); }, { hp: 8 });
  assert(t.r.killedAt !== null && !t.r.escaped && t.r.events.some(e => e.text.includes('역방향')) && t.r.path.some((p, i) => i > 0 && p.cell === 4 && t.r.path[i - 1].cell === 5), '거울: 다음 이동이 역방향(5→4→3…), 제단을 거꾸로 다시 밟아 처치, 역방향 시작칸 통과는 탈출 아님');
  t = lap(b => P(b, 5, 'mirror', 1)); assert(t.r.escaped && t.r.moves === TND.LAP_MOVE_CAP && t.r.events.some(e => e.text.includes('이동 한도')), '거울만 있으면 왕복 루프 → 이동 한도에서 탈출 처리 (교착 없음)');
  t = lap(b => { P(b, 5, 'passage', 1); P(b, 20, 'passage', 1); });
  assert(t.r.stops[0] === 5 && t.r.stops[1] === 20 && t.r.stops[2] === 25 && !t.r.path.some(p => p.cell === 10 && p.pass) && t.r.events.some(e => e.text === '통로 · 시험 칸 5→20'), '통로 쌍 (5↔20): 5에 멈추면 20으로, 사이 칸 안 밟음, 20에서 멈춤 판정 후 25');
  t = lap(b => { P(b, 5, 'passage', 1); P(b, 10, 'passage', 1); }); assert(t.r.stops.slice(0, 3).join(',') === '5,10,15', '통로는 바퀴당 1회 (10에 도착해도 다시 5로 돌아가지 않음)');
  t = lap(b => P(b, 5, 'passage', 1)); assert(t.r.stops[0] === 5 && t.r.stops[1] === 10, '통로 하나뿐이면 작동하지 않음');
  // [기준] 여러 마리: 소모성 기물(성문)은 첫 마리에 쓰인다 · 마리마다 독립 발동
  const two = bare(4, { waves: [{ monsters: [{ defId: 'raider', hp: 90 }, { defId: 'raider', hp: 90 }] }, { monsters: [{ defId: 'pilgrim', hp: 5 }] }] }); two.startTrial(); two.player.faith = 1000;
  two.board[3].piece = { owner: 'P', defId: 'gate', grade: 1, charges: 1 }; two.board[7].piece = { owner: 'P', defId: 'sanctum', grade: 2 };
  const pv2 = two.wavePreview();
  assert(pv2.rows[0].stops[0] === 3 && pv2.rows[0].damage === 4 && pv2.rows[1].stops[0] === 7 && pv2.rows[1].damage === 4 + 12, '프리뷰: 약탈자 ①은 성문에 정지(닫힘 소모)해 성소를 밟기만(−4), ②는 열린 문을 지나 7에 멈춤(−16) — 마리마다 독립');
  two._forceUp([0, 0, 0]); two.confirm(); for (let i = 0; i < 3; i++) { two.chooseMoveDie(i); settleDialogs(two); } two.endTurn(); settleDialogs(two);
  assert(two.turn === 2 && two.board[3].piece.charges === 0 && two.log.filter(l => l.text.includes('약탈자 ② 밟음  칸 7 성소') || l.text.includes('약탈자 ① 밟음  칸 7 성소')).length === 2, '실제 웨이브: 성문 닫힘 0, 두 마리 모두 성소를 밟음');
  // 내밟/내멈 · 통로 선택
  const m = bare(3); m.startTrial(); m._forceUp([1, 0, 0]); m.confirm(); m.board[1].piece = { owner: 'P', defId: 'well', grade: 2 }; m.board[2].piece = { owner: 'P', defId: 'altar', grade: 1 };
  const f0 = m.player.faith, g0 = m.player.gauge; m.chooseMoveDie(0); settleDialogs(m);
  assert(m.player.gauge === Math.min(10, g0 + 2) && m.player.faith === f0 + 1 && m.sub === 'act', '우물 G2 밟음 +2 게이지, 제단 멈춤 신앙 +1');
  const ps = bare(3); ps.startTrial(); ps._forceUp([0, 0, 0]); ps.confirm(); ps.board[1].piece = { owner: 'P', defId: 'passage', grade: 1 }; ps.board[20].piece = { owner: 'P', defId: 'passage', grade: 1 };
  ps.chooseMoveDie(0); assert(ps.pending?.type === 'passage' && ps.pending.to === 20, '통로에 멈춤 → 순간이동 선택 창');
  assert(ps.passageGo() && ps.player.pos === 20 && ps.player.stoppedAt.includes(20) && ps.previewSegment(1).to === 21, '이동 선택: 칸 20으로, 20은 멈춘 칸, 다음 구간은 20부터');
  const ps2 = bare(3); ps2.startTrial(); ps2._forceUp([0, 0, 0]); ps2.confirm(); ps2.board[1].piece = { owner: 'P', defId: 'passage', grade: 1 }; ps2.board[20].piece = { owner: 'P', defId: 'passage', grade: 1 };
  ps2.chooseMoveDie(0); assert(ps2.passageStay() && ps2.player.pos === 1, '머무름 선택: 위치 유지');
  // [기준] 업그레이드는 이번 턴 밟은 칸만 · 멈춘 칸 반값 · 방식별
  const u = bare(6); u.startTrial(); u._forceUp([2, 0, 0]); u.confirm(); u.player.faith = 500; // 눈 3,1,1
  for (const c of [1, 3, 20]) u.board[c].piece = { owner: 'P', defId: 'spire', grade: 1 };
  assert(u.upgradeInfo(1) === null && u.upgradeInfo(20) === null, '이동 전: 아직 아무 기물도 올릴 수 없음');
  u.chooseMoveDie(0); settleDialogs(u); // 0→3: 밟음 1,2 · 멈춤 3
  assert(u.upgradeInfo(1)?.perLevel === 30 && u.upgradeInfo(1).stopped === false && u.upgradeInfo(3)?.perLevel === 15 && u.upgradeInfo(3).stopped && u.upgradeInfo(20) === null, '기본 이동: 경유 칸 1은 등급당 30(정가), 멈춘 칸 3은 15(반값), 지나가지 않은 20은 불가');
  const fu = u.player.faith;
  assert(u.sub === 'act' && u.upgradePiece(1, 3) === true && u.player.faith === fu - 60, '행동 단계 중(구간 사이) 업그레이드 가능: G1→G3 = 2×30');
  assert(u.upgradePiece(20, 2) === false, '지나가지 않은 기물은 업그레이드 불가');
  u.chooseMoveDie(1); settleDialogs(u); u.chooseMoveDie(2); settleDialogs(u);
  assert(u.sub === 'build' && u.upgradePiece(3, 6) === true && u.player.faith === fu - 60 - 75, '건설 단계: 멈춘 칸 G1→G6 = 5×15 = 75');
  const tp = bare(6); tp.dice[0].engraving = 'doyak'; tp.dice[1].engraving = 'eunsin'; tp.dice[2].engraving = 'sullye'; tp.startTrial(); tp._forceUp([2, 2, 2]); tp.confirm();
  for (const c of [1, 2, 3, 4, 5, 6, 7, 8, 9]) tp.board[c].piece = { owner: 'P', defId: 'altar', grade: 1 };
  tp.chooseMoveDie(0); settleDialogs(tp); // 순간이동 3: 도착 3만
  assert(tp.upgradeInfo(1) === null && tp.upgradeInfo(3)?.stopped === true, '순간이동: 건너뛴 칸 불가, 도착 칸만(반값)');
  tp.chooseMoveDie(1); settleDialogs(tp); // 은밀 3: 4,5,6 아무것도
  assert([4, 5, 6].every(c => tp.upgradeInfo(c) === null), '은밀: 아무 기물도 올릴 수 없음');
  tp.chooseMoveDie(2); settleDialogs(tp); // 서행 3: 7,8,9 전부 멈춤
  assert([7, 8, 9].every(c => tp.upgradeInfo(c)?.stopped === true), '서행: 경유 칸 전부 반값');
  const jp = bare(6); jp.dice[0].engraving = 'biyak'; jp.startTrial(); jp._forceUp([3, 0, 0]); jp.confirm();
  for (const c of [1, 2, 3, 4]) jp.board[c].piece = { owner: 'P', defId: 'altar', grade: 1 };
  jp.chooseMoveDie(0); settleDialogs(jp);
  assert(jp.upgradeInfo(1) === null && jp.upgradeInfo(2)?.stopped === false && jp.upgradeInfo(3) === null && jp.upgradeInfo(4)?.stopped === true, '점프(2): 2칸마다 정가, 도착 반값, 홀수 칸 불가');
  const gt = bare(6); gt.startTrial(); gt._forceUp([0, 0, 0]); gt.confirm(); gt.player.faith = 100; gt.board[1].piece = { owner: 'P', defId: 'gate', grade: 1, charges: 0 };
  gt.chooseMoveDie(0); settleDialogs(gt);
  assert(gt.upgradePiece(1, 3) && gt.board[1].piece.charges === 3 && gt.log.some(l => l.text.includes('재장전')), '성문 업그레이드 = 닫힘 횟수 재장전 (0 → 3)');
  // 건설/정화/파괴 지불 · 판매 · 게임 포기
  const b = bare(6); b.startTrial(); b._forceUp([2, 0, 0]); b.confirm(); b.player.faith = 100; b.board[3].piece = { owner: 'E', grade: 1 };
  b.chooseMoveDie(0); assert(b.pending?.type === 'pay' && b.pending.cost === 3, '강제지불 창 (2G+G×M = 3)'); b.payConfirm();
  assert(b.player.faith === 97 && b.pending?.type === 'destroy' && b.pending.cost === ceil(3 * 1.5), '지불 97, 파괴 창 (3×1.5 → 5)');
  b.destroy(); assert(b.player.faith === 92 && b.pending?.type === 'build', '파괴 5 지불 → 건설 창');
  b.build('sanctum'); assert(b.player.faith === 82 && b.board[3].piece?.defId === 'sanctum', '성소 건설 10 지불');
  const bg = bare(6); bg.startTrial(); bg._forceUp([0, 0, 0]); bg.confirm(); bg.player.faith = 20; bg.chooseMoveDie(0); bg.build('gate');
  assert(bg.board[1].piece?.charges === 1 && bg.player.faith === 8, '성문 건설: 닫힘 1로 시작, 12 지불');
  const pf = bare(6); pf.startTrial(); pf._forceUp([0, 0, 0]); pf.confirm(); pf.player.faith = 10; pf.board[1].corrupt = { counter: 3, type: 'erode' };
  pf.chooseMoveDie(0); assert(pf.pending?.type === 'purify', '타락 칸 멈춤 → 정화 창'); pf.purify();
  assert(pf.player.faith === 9 && pf.player.purifyCost === 3 && pf.pending?.type === 'build', '정화 1 지불, 다음 3, 빈 칸 건설 창');
  const s = bare(6); s.startTrial(); s._forceUp([0, 0, 0]); s.confirm(); s.player.faith = 0; s.board[1].piece = { owner: 'E', grade: 3 }; s.board[20].piece = { owner: 'P', defId: 'sanctum', grade: 2 };
  s.chooseMoveDie(0); assert(s.pending?.type === 'pay' && !s.canPay() && !s.mustGiveUp(), '판매로 충당 가능');
  s.sellPiece(20); assert(s.player.faith === 10 && s.canPay(), '성소 G2 판매 +10'); s.payConfirm();
  const gu = bare(6); gu.startTrial(); gu._forceUp([0, 0, 0]); gu.confirm(); gu.player.faith = 0; gu.board[1].piece = { owner: 'E', grade: 6 };
  gu.chooseMoveDie(0); assert(gu.mustGiveUp() && gu.log.some(l => l.text.includes('지불 불가. 게임 포기 가능')) && gu.giveUp() && gu.result === 'defeat', '전부 팔아도 부족 → 게임 포기 노출(로그) → 패배');
  assert(gu.backToPrep() && gu.phase === 'prep' && gu.deck.length === 5, '정비 복귀, 구성 유지');
}

console.log('시나리오 5 — 웨이브 구조: 프리뷰 = 실제 · 탈출/타락 · 방출 확인 · 보스 · 데이터 교체');
{
  const finishTurn = (x) => { x._forceUp([0, 0, 0]); x.confirm(); for (let i = 0; i < 3; i++) { x.chooseMoveDie(i); settleDialogs(x); } if (x.sub === 'build') x.endTurn(); settleDialogs(x); };
  assert(WAVES.length === 12 && WAVES[11].monsters[0].boss && WAVES[11].monsters[0].hp === Math.round(155 * HP_RATIO) && WAVES.flatMap(w => w.monsters).length === 18 && WAVES[0].monsters[0].hp <= 4, '데모 웨이브 12: 마지막은 보스, 총 18마리, 첫 웨이브는 제단 하나로 잡히는 HP');
  // [기준] 턴 1: 웨이브 1 준비 · 프리뷰 · 제단 하나로 처치
  const g = bare(1); g.rng = () => 0.5; g.startTrial(); g.player.faith = 10;
  let pv = g.wavePreview();
  assert(pv.rows.length === 1 && pv.rows[0].hp === WAVES[0].monsters[0].hp && pv.rows[0].escaped && pv.rows[0].remaining === pv.rows[0].hp && pv.rows[0].stops.join(',') === '5,9,15,20,25,29' && pv.anyEscape, '프리뷰: 순례자, 빈 보드 → 탈출 예상 · 부족 = HP, 멈춤 칸 5·9·15·20·25·29');
  g._forceUp([4, 0, 0]); g.confirm(); g.chooseMoveDie(0); g.build('altar'); // 칸 5 제단
  pv = g.wavePreview(); assert(!pv.anyEscape && pv.rows[0].killedAt === 5 && pv.rows[0].damage === 4, '제단 G1을 멈춤 칸 5에 → 프리뷰 즉시 갱신: 처치 예상 (칸 5), 예상 피해 4');
  settleDialogs(g); g.chooseMoveDie(1); settleDialogs(g); g.chooseMoveDie(2); settleDialogs(g);
  const before = g.log.length; assert(g.endTurn() && g.turn === 2, '턴 종료 → 웨이브 해석(동기) → 즉시 턴 2 (로그 속도와 무관)');
  const seg = g.log.slice(before).map(l => l.text);
  assert(seg.includes(`── 웨이브 1 방출 · 순례자 (HP ${WAVES[0].monsters[0].hp}) ──`) && seg.includes('순례자 출발') && seg.includes('★ 순례자 처치 · 칸 5') && seg.includes('웨이브 1 종료 · 처치 1 탈출 0 → 내 턴'), '로그: 방출 · 출발 · 처치 · 웨이브 종료');
  assert(g.kills === 1 && g.escapes === 0 && g.monsters.length === 1 && g.monsters[0].hp === WAVES[1].monsters[0].hp, '처치 1, 턴 2에 웨이브 2 순례자 대기');
  // [기준] 탈출 → 타락, 방출 확인 창
  assert(g.wavePreview().anyEscape && g.endTurn() === false, '굴림 단계에서는 턴 종료 불가');
  finishTurn(g); // 헬퍼는 방출 확인을 승인
  assert(g.turn === 3 && g.escapes === 1 && g.corruptCount() === 1 && g.log.some(l => /^순례자 탈출 결과 · 잠식 1 → 칸/.test(l.text)), '웨이브 2 탈출 → 잠식 1 생성, 탈출 수 1, 턴 3');
  const rc = bare(2); rc.startTrial(); rc._forceUp([0, 0, 0]); rc.confirm(); for (let i = 0; i < 3; i++) { rc.chooseMoveDie(i); settleDialogs(rc); }
  assert(rc.endTurn() && rc.pending?.type === 'release' && rc.pending.names[0] === '순례자 ①' && rc.sub === 'dialog', '탈출 예상이면 턴 종료 시 방출 확인 창');
  assert(rc.releaseCancel() && rc.sub === 'build' && rc.turn === 1, '돌아가서 보강: 건설 단계로 복귀');
  assert(rc.endTurn() && rc.releaseConfirm() && rc.turn === 2, '그래도 방출: 웨이브 해석 후 턴 2');
  // [기준] 프리뷰 = 실제 (난수 기물 없음): 봇 플레이 전 웨이브에서 예상 피해·판정이 실제와 일치
  let checks = 0, ok = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const f = new TndGame({ rng: mulberry32(seed) }); applyBuild(f, seed % 2 ? BUILDS.mid : BUILDS.advanced);
    const orig = f._resolveWave.bind(f);
    f._resolveWave = function () { const p = this.wavePreview(); orig(); this.waveLast.forEach((w, i) => { checks++; const r = p.rows[i]; if (r && r.damage === w.damage && r.killedAt === w.killedAt && r.escaped === w.escaped && r.stops.join() === w.stops.join()) ok++; }); };
    playTrial(f);
  }
  assert(checks >= 40 && ok === checks, `웨이브 프리뷰 = 실제 결과 (피해·처치 칸·탈출·멈춤 칸) ${ok}/${checks}`);
  // 턴 종료 시 타락 카운터 −1 (웨이브마다 1) · 만료 처리는 프리뷰에도 반영
  const tk = bare(3); tk.startTrial(); tk.board[10].corrupt = { counter: 1, type: 'erode' }; tk.board[10].piece = { owner: 'P', defId: 'spire', grade: 6 };
  assert(tk.wavePreview().rows[0].damage === 0, '프리뷰: 턴 종료 시 만료될 타락 칸의 첨탑은 파괴되므로 피해 0으로 계산');
  finishTurn(tk); assert(tk.board[10].piece?.owner === 'E' && tk.board[10].piece.grade === 1, '턴 종료: 잠식 만료 → 첨탑 파괴, 사악한 기물 G1');
  // [기준] 잠식·부식·둥지 만료 처리
  const cell = (id, piece, corrupt) => { const c = { id, piece, corrupt }; expireCorrupt(c); return c; };
  let c = cell(10, { owner: 'P', defId: 'altar', grade: 2 }, { counter: 0, type: 'erode' }); assert(c.piece?.owner === 'E' && c.piece.grade === 1 && !c.corrupt, '잠식 만료 + 내 기물: 파괴 후 사악한 기물 G1');
  c = cell(11, { owner: 'E', grade: 2 }, { counter: 0, type: 'erode' }); assert(c.piece.grade === 3, '잠식 만료 + 사악한 기물: G +1');
  c = cell(12, { owner: 'P', defId: 'altar', grade: 2 }, { counter: 0, type: 'corrode' }); assert(c.piece === null, '부식 만료 + 내 기물: 파괴만, 사악한 기물 없음');
  c = cell(13, null, { counter: 0, type: 'corrode' }); assert(c.piece?.owner === 'E' && c.piece.grade === 1, '부식 만료 + 빈 칸: 잠식과 동일 (G1)');
  c = cell(14, null, { counter: 0, type: 'nest' }); assert(c.piece?.owner === 'E' && c.piece.grade === 2, '둥지 만료 + 빈 칸: 사악한 기물 G2');
  c = cell(15, { owner: 'E', grade: 1 }, { counter: 0, type: 'nest' }); assert(c.piece.grade === 3, '둥지 만료 + 사악한 기물: G +2');
  assert(CORRUPT_TYPES.erode.counter === 3 && CORRUPT_TYPES.corrode.counter === 2 && CORRUPT_TYPES.nest.counter === 4, '타락 유형 카운터 3/2/4');
  // 배치 규칙
  const pl = bare(3); pl.startTrial();
  pl.board[5].piece = { owner: 'P', defId: 'altar', grade: 1 }; pl.board[20].piece = { owner: 'P', defId: 'spire', grade: 4 }; pl.board[25].piece = { owner: 'P', defId: 'altar', grade: 2 };
  assert(pl._leakTargets({ count: 1, type: 'nest', placement: 'highestPiece' })[0].id === 20, '최고 등급 기물 칸: G4 첨탑(20)');
  assert(pl._leakTargets({ count: 2, type: 'corrode', placement: 'pieceFirst' }).every(c => c.piece), '기물 있는 칸 우선: 2곳 모두 기물 칸');
  let okNear = true; for (let k = 0; k < 20; k++) { const t = pl._leakTargets({ count: 2, type: 'erode', placement: 'nearStart' }); if (t.length !== 2 || !t.every(c => c.id >= 1 && c.id <= 8)) okNear = false; }
  assert(okNear, '시작칸 앞 8칸 이내: 20회 모두 1~8');
  let okEmpty = true; for (let k = 0; k < 20; k++) { const t = pl._leakTargets({ count: 3, type: 'erode', placement: 'emptyRandom' }); if (t.length !== 3 || t.some(c => c.piece || c.id === 0)) okEmpty = false; }
  assert(okEmpty, '빈 칸 무작위: 기물 칸·시작칸 제외');
  // [기준] 보스: 탈출 = 즉시 패배 / 전멸 = 즉시 승리 · 앞 웨이브 탈출은 패배 아님
  const bossW = [{ monsters: [{ defId: 'pilgrim', hp: 50 }] }, { monsters: [{ defId: 'pilgrim', hp: 6, boss: true, name: '보스' }] }];
  const bd = bare(5, { waves: bossW }); bd.startTrial(); finishTurn(bd);
  assert(bd.turn === 2 && bd.phase === 'trial' && bd.escapes === 1 && bd.isBossWave() && bd.monsters[0].name === '보스', '웨이브 1 탈출은 패배 아님 → 턴 2 보스 웨이브');
  finishTurn(bd); assert(bd.phase === 'end' && bd.result === 'defeat' && bd.log.some(l => l.text.includes('보스 탈출') || l.text.includes('보스를 놓쳤다')), '보스 탈출 → 즉시 패배');
  const bv = bare(5, { waves: bossW }); bv.startTrial(); bv.board[5].piece = { owner: 'P', defId: 'altar', grade: 2 }; finishTurn(bv); finishTurn(bv);
  assert(bv.phase === 'end' && bv.result === 'victory' && bv.log.some(l => l.text === '★ 마지막 웨이브 격파. 승리.'), '보스 처치 → 즉시 승리 (로그)');
  assert(bv.backToPrep() && bv.phase === 'prep', '승리 후 정비 복귀');
  // [기준] 몬스터·웨이브 데이터 교체 (도약자 포함)
  const custom = { monsters: { ...MONSTERS, blitz: { id: 'blitz', name: '질풍', icon: '▲', moveMode: 'jump', pattern: [8, 8], leak: { count: 2, type: 'nest', placement: 'consecutive' } } }, waves: [{ monsters: [{ defId: 'leaper', hp: 30 }, { defId: 'blitz', hp: 5 }] }, { monsters: [{ defId: 'colossus', hp: 9, boss: true }] }] };
  const cm = bare(7, custom); cm.startTrial(); cm.board[2].piece = { owner: 'P', defId: 'altar', grade: 1 }; cm.board[3].piece = { owner: 'P', defId: 'altar', grade: 1 };
  pv = cm.wavePreview();
  assert(pv.rows.length === 2 && pv.rows[0].name === '도약자' && pv.rows[0].damage === 1 && pv.rows[1].name === '질풍' && pv.rows[1].damage === 1 && pv.rows[1].escaped, '커스텀 웨이브: 도약자·질풍 모두 점프라 칸 2 제단만 밟음(−1), 홀수 칸 3 무력');
  finishTurn(cm);
  const nest = cm.board.filter(c => c.corrupt?.type === 'nest');
  assert(cm.turn === 2 && cm.escapes === 2 && nest.length === 2 && nest[1].id === nest[0].id + 1 && cm.monsters[0].def.id === 'colossus' && cm.monsters[0].boss, '질풍 탈출 → 둥지 2 연속 칸, 턴 2 = 커스텀 보스(거체)');
}

console.log('시나리오 6 — 빌드별 봇 (기획안 §18 대조)');
{
  const seeds = Array.from({ length: 30 }, (_, i) => i + 1);
  const avg = a => a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) : '-';
  const r = {};
  for (const b of ['starter', 'plus', 'semimid', 'mid', 'advanced']) r[b] = runBuild(b, seeds);
  console.log('  ' + Object.entries(r).map(([k, v]) => `${k} ${v.win}/30 (탈출 ${avg(v.escapes)})`).join(' · '));
  assert(r.starter.win === 0 && r.plus.win <= 3, `입문·입문+: 무릎 아래 → 거의 전패 (${r.starter.win}, ${r.plus.win}/30)`);
  assert(r.semimid.win >= 9, `준중급(+침강·증폭): 부분 성공 (${r.semimid.win}/30)`);
  assert(r.mid.win >= 18 && r.mid.win > r.semimid.win, `중급: 준중급보다 높은 승률 (${r.mid.win}/30)`);
  assert(r.advanced.win >= 27 && avg(r.advanced.escapes) < avg(r.mid.escapes), `상급: 거의 전승, 탈출 최소 (${r.advanced.win}/30)`);
  assert(Object.values(r).every(v => v.timeout === 0), '전부 12웨이브 안에 종료 (교착 없음)');
  const lost = new TndGame({ rng: mulberry32(11) }); applyBuild(lost, BUILDS.empty); playTrial(lost);
  assert(lost.result === 'defeat' && (lost.log.some(l => l.text.startsWith('✕ 강제지불')) || lost.log.some(l => l.text.includes('보스'))), '무장착 빌드: 강제지불 불가 또는 보스 탈출로 패배');
  const g = new TndGame({ rng: mulberry32(3) }); applyBuild(g, BUILDS.mid, ['doyak', 'gongheo', 'jongjang']); playTrial(g);
  const types = new Set(g.log.map(l => l.type));
  assert(['decision', 'event', 'action', 'calc', 'add', 'mul'].every(t => types.has(t)), '로그 4등급 + 덧셈/곱셈 타입 사용');
  assert(g.log.some(l => l.text.includes('(효과 없음)')), '효과 없는 경유 밟음은 한 줄로 접힘');
}

console.log(''); console.log(`결과: ${pass + fail}개 단언 중 ${pass}개 통과, ${fail}개 실패`);
if (fail > 0) { console.log('실패 목록:'); failures.forEach(f => console.log(` - ${f}`)); process.exit(1); }
