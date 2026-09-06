// TnD 결합 데모 검수용 봇 — 기획안 §10 플레이어 AI 재현:
// 그리디 재굴림, 이동 목적지 = 내 기물 > 빈 칸 > 타락(정화 가능 시) > 적 기물 회피,
// 건설 = 첨탑 > 성소 > 제단 중 예비금을 남기고 가능한 것, 밟은 내 기물은 예비금 한도까지 다단 업그레이드.
import { TndGame, mulberry32, makeInst } from '../js/tnd-game.js';
import { TND_SKILLS_BY_ID, PIECES_BY_ID, TND } from '../js/tnd-config.js';
import { OPPOSITE, FACE_COUNT } from '../js/config.js';

export const BUILDS = {
  empty: [],
  starter: [[0, 5, 'jungta'], [0, 0, 'janhyang'], [1, 5, 'gangta'], [1, 1, 'yeoun'], [2, 2, 'gyeotnal'], [2, 0, 'miyeol']],
  mid: [[0, 5, 'jungta'], [0, 0, 'janhyang'], [1, 5, 'gangta'], [1, 1, 'yeoun'], [2, 2, 'gyeotnal'], [2, 0, 'miyeol'],
        [2, 3, 'jjakgyul'], [3, 5, 'chimgang'], [3, 1, 'simcheung'], [3, 3, 'jeoryu'], [4, 5, 'jeungpok'], [4, 4, 'huwi']],
};
export const STARTER_DECK_IDS = ['altar', 'altar', 'sanctum', 'well', 'purifier'];

export function applyBuild(g, build) {
  for (const d of g.dice) for (const f of d.faces) f.skill = null;
  for (const [d, f, id] of build) g.dice[d].faces[f].skill = makeInst(id);
  g.deck = [...STARTER_DECK_IDS];
}

function faceValue(die, f) {
  const face = die.faces[f];
  let v = face.pip;
  const inst = face.skill;
  if (inst) {
    const s = TND_SKILLS_BY_ID[inst.id];
    if (s.layer === 'active') v += s.op === 'mul' ? 16 : (s.v ?? face.pip);
    if (s.layer === 'latent' || s.layer === 'side') v -= s.op === 'mul' ? 8 : 3;
  }
  const opp = die.faces[OPPOSITE[f]].skill;
  if (opp) { const os = TND_SKILLS_BY_ID[opp.id]; if (os.layer === 'opposite') v += os.op === 'mul' ? 14 : (os.v ?? 8); }
  return v;
}

const RESERVE = 2;
const BUILD_PRIORITY = ['spire', 'sanctum', 'altar', 'taxman', 'hall', 'reliquary', 'well', 'purifier', 'grave', 'beacon', 'road', 'bell', 'gate', 'offering'];

function cellScore(g, cell) {
  if (cell.piece && cell.piece.owner === 'E') return -50 - g.finalEnemyCost(cell);
  if (cell.piece && cell.piece.owner === 'P') return cell.corrupt ? 5 : 30 + cell.piece.grade;
  if (cell.corrupt) return g.player.faith >= g.player.purifyCost ? 10 : -5;
  if (cell.id === TND.START_CELL) return 8;
  return 20;
}

export function playTrial(g, { maxTurns = 80 } = {}) {
  if (!g.startTrial()) throw new Error('startTrial failed');
  let guard = 0;
  while (g.phase === 'trial' && g.turn <= maxTurns && guard++ < 100000) {
    if (g.sub === 'roll') {
      while (g.rollsLeft > 0) {
        g.dice.forEach((d, i) => {
          let mean = 0; for (let f = 0; f < FACE_COUNT; f++) mean += faceValue(d, f);
          const keep = faceValue(d, d.upIndex) >= mean / FACE_COUNT;
          if (d.locked !== keep) g.toggleLock(i);
        });
        if (g.dice.every(d => d.locked)) break;
        g.reroll();
      }
      g.confirm();
    } else if (g.sub === 'act') {
      const opts = g.reachable().map(r => ({ ...r, score: cellScore(g, g.board[r.cell]) }));
      opts.sort((a, b) => b.score - a.score);
      g.chooseMoveDie(opts[0].die);
    } else if (g.sub === 'dialog') {
      const p = g.pending;
      if (p.type === 'pay') {
        if (g.canPay()) g.payConfirm();
        else if (g.mustGiveUp()) g.giveUp();
        else { // 가장 싼 기물부터 판매
          const mine = g.myPieces().sort((a, b) => a.piece.grade - b.piece.grade);
          g.sellPiece(mine[0].id);
        }
      } else if (p.type === 'purify') {
        if (g.player.faith >= p.cost) g.purify(); else g.skipPurify();
      } else if (p.type === 'upgrade') {
        const budget = g.player.faith - RESERVE;
        const levels = Math.min(TND.MAX_GRADE - p.grade, Math.floor(budget / p.perLevel));
        if (levels >= 1) g.upgradeTo(p.grade + levels); else g.skipUpgrade();
      } else if (p.type === 'destroy') {
        g.skipDestroy();
      } else if (p.type === 'build') {
        const budget = g.player.faith - RESERVE;
        const choice = BUILD_PRIORITY.find(id => g.deck.includes(id) && PIECES_BY_ID[id].cost <= budget);
        if (choice) g.build(choice); else g.skipBuild();
      } else if (p.type === 'offering') {
        g.offeringPay(0);
      } else break;
    } else break;
  }
  return g.phase === 'end' ? g.result : 'timeout';
}

export function runBuild(buildName, seeds) {
  const out = { win: 0, defeat: 0, timeout: 0, winTurns: [], loseTurns: [] };
  for (const seed of seeds) {
    const g = new TndGame({ rng: mulberry32(seed) });
    applyBuild(g, BUILDS[buildName]);
    const r = playTrial(g);
    out[r === 'victory' ? 'win' : r === 'defeat' ? 'defeat' : 'timeout'] += 1;
    if (r === 'victory') out.winTurns.push(g.turn); else out.loseTurns.push(g.turn);
  }
  return out;
}
