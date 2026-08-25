// 검수용 봇 (v2) — 기획안 8절의 플레이어 모델을 따른다:
// 그리디 재굴림(현재 면 추정치 < 6면 평균이면 재굴림), 곱셈 스킬 우선 드래프트,
// 곱셈 주사위를 뒤 순서로 배치, 변경권은 빈 면의 눈을 높이는 데 사용.
import { Game, mulberry32 } from '../js/game.js';
import { SKILLS_BY_ID, FACE_COUNT, OPPOSITE, condAllows } from '../js/config.js';

// 면 하나가 윗면이 됐을 때의 대략적 가치 (재굴림 판단용)
function faceValue(die, f) {
  const face = die.faces[f];
  let v = face.pip;
  const inst = face.skill;
  if (inst) {
    const s = SKILLS_BY_ID[inst.id];
    if (s.layer === 'active') v += s.op === 'mul' ? 16 : (s.v ?? face.pip);
  }
  // 이 면이 위면 맞은편 슬롯의 맞은편형 스킬이 발동한다
  const oppInst = die.faces[OPPOSITE[f]].skill;
  if (oppInst) {
    const os = SKILLS_BY_ID[oppInst.id];
    if (os.layer === 'opposite') v += os.op === 'mul' ? 14 : (os.v ?? 8);
  }
  // 이 면이 위면 이 면의 잠재/측면 스킬은 꺼진다 (기획안 0절의 상충)
  if (inst) {
    const s = SKILLS_BY_ID[inst.id];
    if (s.layer === 'latent' || s.layer === 'side') v -= s.op === 'mul' ? 8 : 3;
  }
  return v;
}

// 드래프트 선호도: 초반(누산기 작음)엔 덧셈, 중후반엔 가동률 높은 곱셈 (발라트로식 전환)
function draftScore(id, stageNumber = 5) {
  const s = SKILLS_BY_ID[id];
  const late = stageNumber >= 3;
  let v = 0;
  if (s.op === 'mul') {
    v = s.layer === 'latent' ? 60 : s.layer === 'side' ? 55 : s.layer === 'opposite' ? 45 : 40;
    if (late) v += 50; // 누산기가 커진 뒤에는 곱셈이 압도
  } else {
    const base = s.v ?? 6;
    v = base + (s.layer === 'latent' ? 20 : s.layer === 'side' ? 18 : s.layer === 'opposite' ? 12 : 8);
  }
  if (s.kind && s.kind.startsWith('grow')) v = Math.max(v, late ? 70 : 40);
  if (s.grade === 'rare') v += 6;
  else if (s.grade === 'advanced') v += 3;
  return v;
}

// 장착할 슬롯 선택: 계층별 선호 + 조건 충족 빈 면
// 핵심: 곱셈은 뒤 순서 주사위에(누산기 전체를 곱하도록), 덧셈은 앞 순서 주사위에.
function bestSlot(g, skill) {
  let best = null;
  for (let d = 0; d < g.dice.length; d++) {
    for (let f = 0; f < FACE_COUNT; f++) {
      const face = g.dice[d].faces[f];
      if (face.skill || !condAllows(skill.cond, face.pip)) continue;
      let v = 0;
      if (skill.layer === 'active') v = face.pip * 2;                    // 높은 눈을 노린다
      else if (skill.layer === 'opposite') v = g.dice[d].faces[OPPOSITE[f]].pip * 2; // 맞은편이 높은 눈일 때 발동
      else v = 12 - face.pip;                                            // 잠재/측면: 낮은 눈 면에 (높은 눈은 활성용으로 남김)
      if (skill.op === 'mul') v += d * 20;                               // 곱셈 → 뒤 주사위
      else v += (g.dice.length - 1 - d) * 6;                             // 덧셈 → 앞 주사위
      if (!best || v > best.v) best = { d, f, v };
    }
  }
  return best;
}

function doMaintain(g) {
  // 변경권: 빈 면 중 가장 높은 눈을 6까지 올린다
  while (g.inventory.tickets > 0) {
    let best = null;
    for (let d = 0; d < g.dice.length; d++) for (let f = 0; f < FACE_COUNT; f++) {
      const face = g.dice[d].faces[f];
      if (face.skill || face.pip >= 6) continue;
      if (!best || face.pip > best.pip) best = { d, f, pip: face.pip };
    }
    if (!best || !g.changeFace(best.d, best.f, 1)) break;
  }
  // 장착: 드래프트 선호도 순으로 최적 슬롯에
  let acted = true;
  while (acted && g.inventory.skills.length > 0) {
    acted = false;
    const order = g.inventory.skills
      .map((inst, k) => ({ k, score: draftScore(inst.id, g.stageNumber) }))
      .sort((a, b) => b.score - a.score);
    for (const { k } of order) {
      const slot = bestSlot(g, SKILLS_BY_ID[g.inventory.skills[k].id]);
      if (slot && g.equipSkill(k, slot.d, slot.f)) { acted = true; break; }
    }
  }
  // 순서: 곱셈 스킬 수가 많은 주사위를 뒤로 (버블 정렬, moveDie 사용)
  const mulCount = die => die.faces.filter(f => f.skill && SKILLS_BY_ID[f.skill.id].op === 'mul').length;
  for (let pass = 0; pass < g.dice.length; pass++) {
    for (let i = 0; i < g.dice.length - 1; i++) {
      if (mulCount(g.dice[i]) > mulCount(g.dice[i + 1])) g.moveDie(i, 1);
    }
  }
  g.nextStage();
}

export function playBot(seed, { collect = null } = {}) {
  const g = new Game({ rng: mulberry32(seed) });
  let guard = 0;
  while (g.phase !== 'victory' && g.phase !== 'gameover' && guard++ < 20000) {
    if (g.phase === 'stage') {
      const stageNo = g.stageNumber;
      while (g.rollsLeft > 0) {
        g.dice.forEach((d, i) => {
          const cur = faceValue(d, d.upIndex);
          let mean = 0;
          for (let f = 0; f < FACE_COUNT; f++) mean += faceValue(d, f);
          mean /= FACE_COUNT;
          const keep = cur >= mean;
          if (d.locked !== keep) g.toggleLock(i);
        });
        if (g.dice.every(d => d.locked)) break;
        g.reroll();
      }
      g.endTurn();
      if (g.phase !== 'stage' || g.stageNumber !== stageNo) {
        if (collect) collect(stageNo, g.score, g.phase);
      }
    } else if (g.phase === 'draft') {
      const ranked = g.draft.offer
        .map((id, i) => ({ i, score: draftScore(id, g.stageNumber) }))
        .sort((a, b) => b.score - a.score);
      for (let k = 0; k < g.draft.pick; k++) g.draftToggle(ranked[k].i);
      g.draftConfirm();
    } else if (g.phase === 'maintain') {
      doMaintain(g);
    }
  }
  return g;
}
