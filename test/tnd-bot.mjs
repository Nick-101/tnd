// TnD 결합 데모 검수용 봇 (v2.2) — 기획안 §18 플레이어 AI 재현:
// 그리디 재굴림, 몬스터 멈춤 칸 우선 이동, 업그레이드는 이번 턴 밟은 기물 중 몬스터 멈춤 칸 > 나머지 순으로 예비금 4까지,
// 건설은 대성당 > 첨탑 > 성소 > 제단 중 살 수 있는 것. 각인·경로 조작 기물은 모델링하지 않는다 (탈출 예상 확인 창은 그대로 방출).
import { TndGame, mulberry32, makeInst, resolveMove } from '../js/tnd-game.js';
import { TND_SKILLS_BY_ID, PIECES_BY_ID, TND } from '../js/tnd-config.js';
import { OPPOSITE, FACE_COUNT } from '../js/config.js';

const STARTER = [[0, 5, 'jungta'], [0, 0, 'janhyang'], [1, 5, 'gangta'], [1, 1, 'yeoun'], [2, 2, 'gyeotnal'], [2, 0, 'miyeol']];
export const BUILDS = {
  empty: [],
  starter: STARTER,
  plus: [...STARTER, [0, 4, 'chimgang']],
  semimid: [...STARTER, [0, 4, 'chimgang'], [2, 5, 'jeungpok']],
  mid: [...STARTER, [0, 4, 'chimgang'], [2, 5, 'jeungpok'], [2, 4, 'huwi']],
  advanced: [...STARTER, [0, 4, 'chimgang'], [2, 5, 'jeungpok'], [2, 4, 'huwi'], [1, 0, 'silseon'], [0, 1, 'jeoeum'], [1, 2, 'banhyang']],
};
export const STARTER_DECK_IDS = ['altar', 'sanctum', 'decoy', 'gate', 'spire'];

export function applyBuild(g, build, engravings = []) {
  for (const d of g.dice) { for (const f of d.faces) f.skill = null; d.engraving = null; }
  for (const [d, f, id] of build) g.dice[d].faces[f].skill = makeInst(id);
  engravings.forEach((id, d) => { if (id) g.dice[d].engraving = id; });
  g.deck = [...STARTER_DECK_IDS];
}

function faceValue(die, f) {
  const face = die.faces[f]; let v = face.pip; const inst = face.skill;
  if (inst) { const s = TND_SKILLS_BY_ID[inst.id]; if (s.layer === 'active') v += s.op === 'mul' ? 16 : (s.v ?? face.pip); if (s.layer === 'latent' || s.layer === 'side') v -= s.op === 'mul' ? 8 : 3; }
  const opp = die.faces[OPPOSITE[f]].skill;
  if (opp) { const os = TND_SKILLS_BY_ID[opp.id]; if (os.layer === 'opposite') v += os.op === 'mul' ? 14 : (os.v ?? 8); }
  return v;
}
const RESERVE = 4;
const BUILD_PRIORITY = ['cathedral', 'spire', 'sanctum', 'altar'];
const targetsOf = g => { const pv = g.wavePreview(); const rows = pv ? pv.rows : []; return { stops: new Set(rows.flatMap(r => r.stops)), paths: new Set(rows.flatMap(r => r.path.filter(p => p.pass).map(p => p.cell))) }; };

function stopScore(g, cell, targets) {
  let v = 0;
  if (cell.piece?.owner === 'E') v = -50 - g.finalEnemyCost(cell);
  else if (cell.piece?.owner === 'P') v = cell.corrupt ? 5 : 25 + cell.piece.grade;
  else if (cell.corrupt) v = g.player.faith >= g.player.purifyCost ? 10 : -5;
  else if (cell.id === TND.START_CELL) v = 4;
  else v = 20;
  if (targets.stops.has(cell.id) && cell.piece?.owner !== 'E') v += 40; // 몬스터 멈춤 칸 우선 (멈춤 피해가 밟음의 3배)
  else if (targets.paths.has(cell.id) && cell.piece?.owner !== 'E') v += 5;
  return v;
}

// 업그레이드: 이번 턴 밟은 기물 중 몬스터 멈춤 칸 > 경로 > 나머지, 등급 높은 순. 예비금 4
function upgradePassed(g) {
  const targets = targetsOf(g);
  const prio = c => (targets.stops.has(c.id) ? 0 : targets.paths.has(c.id) ? 1 : 2);
  const mine = g.passedPieces().filter(c => !c.corrupt && c.piece.grade < TND.MAX_GRADE).sort((a, b) => prio(a) - prio(b) || b.piece.grade - a.piece.grade);
  for (const c of mine) {
    const info = g.upgradeInfo(c.id); const budget = g.player.faith - RESERVE;
    const levels = Math.min(TND.MAX_GRADE - info.grade, Math.floor(budget / info.perLevel));
    if (levels >= 1) g.upgradePiece(c.id, info.grade + levels);
  }
}

export function playTrial(g, { maxTurns = 60 } = {}) {
  if (!g.startTrial()) throw new Error('startTrial failed');
  let guard = 0;
  while (g.phase === 'trial' && g.turn <= maxTurns && guard++ < 200000) {
    if (g.sub === 'roll') {
      while (g.rollsLeft > 0) {
        g.dice.forEach((d, i) => { let mean = 0; for (let f = 0; f < FACE_COUNT; f++) mean += faceValue(d, f); const keep = faceValue(d, d.upIndex) >= mean / FACE_COUNT; if (d.locked !== keep) g.toggleLock(i); });
        if (g.dice.every(d => d.locked)) break;
        g.reroll();
      }
      g.confirm();
    } else if (g.sub === 'act') {
      // §18: 3주사위 순열 6가지 중 멈춤 3칸의 가치 합이 최대인 이동 순서 (구간 시작 시 한 번 정한다)
      if (g.usedDice.length === 0) {
        const targets = targetsOf(g); const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
        let best = null;
        for (const perm of perms) {
          let pos = g.player.pos, v = 0;
          for (const i of perm) {
            const { mode, extra } = g.moveModeOf(g.dice[i]); const r = resolveMove(g.board, pos, g.activePip(g.dice[i]) + extra, mode);
            for (const p of r.path) { const c = g.board[p.cell]; if (p.stop) v += stopScore(g, c, targets); else if (p.pass && c.piece?.owner === 'P' && !c.corrupt) v += 2; }
            pos = r.to;
          }
          if (!best || v > best.v) best = { perm, v };
        }
        g._botOrder = best.perm;
      }
      upgradePassed(g); // 구간 사이에도 밟은 기물을 먼저 올린다 (등급당 비용이 신축보다 싸다)
      const next = g._botOrder.find(i => !g.usedDice.includes(i));
      g.chooseMoveDie(next);
    } else if (g.sub === 'dialog') {
      const p = g.pending; const reserve = RESERVE;
      if (p.type === 'pay') {
        if (g.canPay()) g.payConfirm(); else if (g.mustGiveUp()) g.giveUp();
        else { const mine = g.myPieces().sort((a, b) => a.piece.grade - b.piece.grade); g.sellPiece(mine[0].id); }
      } else if (p.type === 'purify') { if (g.player.faith >= p.cost) g.purify(); else g.skipPurify(); }
      else if (p.type === 'destroy') g.skipDestroy();
      else if (p.type === 'passage') g.passageStay();
      else if (p.type === 'release') g.releaseConfirm();
      else if (p.type === 'build') {
        const choice = BUILD_PRIORITY.find(id => g.deck.includes(id) && g.buildCost(id) <= g.player.faith); // 건설은 예비금 없이 (예비금 4는 업그레이드에만)
        if (choice) g.build(choice); else g.skipBuild();
      } else break;
    } else if (g.sub === 'build') {
      upgradePassed(g);
      g.endTurn();
    } else break;
  }
  return g.phase === 'end' ? g.result : 'timeout';
}

export function runBuild(buildName, seeds, engravings = [], gameOpts = {}) {
  const out = { win: 0, defeat: 0, timeout: 0, winTurns: [], loseTurns: [], kills: [], escapes: [], reasons: {} };
  for (const seed of seeds) {
    const g = new TndGame({ rng: mulberry32(seed), ...gameOpts });
    applyBuild(g, BUILDS[buildName], engravings);
    const r = playTrial(g);
    out[r === 'victory' ? 'win' : r === 'defeat' ? 'defeat' : 'timeout'] += 1;
    out.kills.push(g.kills); out.escapes.push(g.escapes);
    if (r === 'defeat') { const k = g.log[g.log.length - 1].text.includes('탈출') ? 'boss' : 'pay'; out.reasons[k] = (out.reasons[k] || 0) + 1; }
    if (r === 'victory') out.winTurns.push(g.turn); else out.loseTurns.push(g.turn);
  }
  return out;
}
