// 순수 게임 로직 — DOM/렌더 의존 없음. Node에서 headless로 실행 가능. (기획안 v2)
import {
  START_DICE, MAX_DICE, FACE_COUNT, FACE_MIN, FACE_MAX,
  TURNS_PER_STAGE, ROLLS_PER_TURN, REWARD_TICKET_COUNT, DICE_REWARD_STAGES,
  OPPOSITE, STAGE_TARGETS, draftSpec, GRADE_WEIGHTS,
  SKILLS, SKILLS_BY_ID, condAllows,
} from './config.js';

// 시드 고정 난수 (테스트/재현용)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let uidCounter = 1;
// 스킬 인스턴스: 성장형 스킬의 누적 상태를 개별 보유 (growth: 영구 누적, stageCount: 스테이지 내 발동 횟수)
export function makeInstance(skillId) {
  return { uid: uidCounter++, id: skillId, growth: 0, stageCount: 0 };
}

// 면 상태 판정: 윗면 슬롯 인덱스(upIndex) 기준
export function faceState(faceIdx, upIndex) {
  if (faceIdx === upIndex) return 'active';
  if (faceIdx === OPPOSITE[upIndex]) return 'opposite';
  return 'side';
}
// 발동 계층 일치: latent = 활성이 아닌 모든 면
export function layerMatches(layer, state) {
  if (layer === 'latent') return state !== 'active';
  return layer === state;
}

// 스킬 1개의 효과 평가. 발동하지 않으면 null.
// ctx: { S, activePips, upPip, pip, orderIndex, orderCount, lockedCount, rerollsLeft, turnsAfter, inst }
export function evalEffect(skill, ctx) {
  const add = n => ({ op: 'add', n });
  const mul = n => ({ op: 'mul', n });
  const count = v => ctx.activePips.filter(p => p === v).length;
  switch (skill.kind) {
    case 'flat': return skill.op === 'add' ? add(skill.v) : mul(skill.v);
    case 'pip': return add(ctx.pip);
    case 'halfPip': return add(Math.floor(ctx.pip / 2));
    case 'oppSum': return add(ctx.upPip + ctx.pip);
    case 'symMult': return ctx.upPip === ctx.pip ? mul(skill.v) : null;
    case 'parityAll': return ctx.activePips.every(p => p % 2 === ctx.activePips[0] % 2) ? add(skill.v) : null;
    case 'pairActive': return ctx.activePips.some(p => count(p) >= 2) ? add(skill.v) : null;
    case 'runActive': {
      const set = new Set(ctx.activePips);
      for (let s = 1; s <= 4; s++) if (set.has(s) && set.has(s + 1) && set.has(s + 2)) return add(skill.v);
      return null;
    }
    case 'distinctActive': return new Set(ctx.activePips).size === ctx.activePips.length ? mul(skill.v) : null;
    case 'tripleActive': return ctx.activePips.some(p => count(p) >= 3) ? mul(skill.v) : null;
    case 'perLocked': return add(skill.v * ctx.lockedCount);
    case 'perReroll': return add(skill.v * ctx.rerollsLeft);
    case 'perTurnAfter': return add(skill.v * ctx.turnsAfter);
    case 'noReroll': return ctx.rerollsLeft === 0 ? mul(skill.v) : null;
    case 'perFront': return add(skill.v * ctx.orderIndex);
    case 'first': return ctx.orderIndex === 0 ? add(skill.v) : null;
    case 'fuse': return ctx.S < 30 ? add(skill.v) : null;
    case 'inertia': return ctx.S >= 60 ? mul(skill.v) : null;
    case 'last': return ctx.orderIndex === ctx.orderCount - 1 ? mul(skill.v) : null;
    case 'growCount': return add(ctx.inst.stageCount + 1); // 이번 발동 포함
    case 'growAdd': return add(skill.v + ctx.inst.growth);
    case 'growStage': return add(skill.v + ctx.inst.growth);
    case 'growMult': return mul(skill.v + ctx.inst.growth);
    default: return null;
  }
}

// ── 점수 계산: 단일 누산기 순차 연산 (순수 함수) ──
// 예상 점수 프리뷰와 실제 턴 종료가 반드시 이 함수를 공유한다.
// 반환: { total(실수), lines[], growthEvents[] } — 상태를 변경하지 않는다.
export function calcScore(dice, ctx) {
  const activePips = dice.map(d => d.faces[d.upIndex].pip);
  let S = activePips.reduce((a, b) => a + b, 0);
  const lines = [{ text: `기본 눈합  ${fmt(S)}`, type: 'calc' }];
  const growthEvents = []; // { uid, field, delta } — endTurn에서만 적용
  const lockedCount = dice.filter(d => d.locked).length;

  dice.forEach((die, orderIndex) => {
    const upPip = die.faces[die.upIndex].pip;
    // 면 순회: 활성 → 맞은편 → 측면(F1→F6 순)
    const faceOrder = [die.upIndex, OPPOSITE[die.upIndex],
      ...die.faces.map((_, f) => f).filter(f => f !== die.upIndex && f !== OPPOSITE[die.upIndex])];
    for (const f of faceOrder) {
      const inst = die.faces[f].skill;
      if (!inst) continue;
      const skill = SKILLS_BY_ID[inst.id];
      if (!layerMatches(skill.layer, faceState(f, die.upIndex))) continue;
      const eff = evalEffect(skill, {
        S, activePips, upPip, pip: die.faces[f].pip,
        orderIndex, orderCount: dice.length,
        lockedCount, rerollsLeft: ctx.rerollsLeft, turnsAfter: ctx.turnsAfter,
        inst,
      });
      if (!eff) continue;
      S = eff.op === 'add' ? S + eff.n : S * eff.n;
      const opText = eff.op === 'add' ? `+${fmt(eff.n)}` : `×${fmt(eff.n)}`;
      lines.push({
        text: `[${orderIndex + 1}번·F${f + 1}] ${skill.name}  ${opText}  →  ${fmt(S)}`,
        type: eff.op === 'add' ? 'add' : 'mul',
      });
      // 성장형: 발동에 따른 영구/스테이지 누적 (적용은 endTurn에서)
      if (skill.kind === 'growCount') growthEvents.push({ uid: inst.uid, field: 'stageCount', delta: 1 });
      if (skill.kind === 'growAdd' || skill.kind === 'growMult') growthEvents.push({ uid: inst.uid, field: 'growth', delta: skill.step });
    }
  });
  return { total: S, lines, growthEvents };
}

function fmt(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export class Game {
  constructor({ rng, startDice } = {}) {
    this.rng = rng || Math.random;
    this.startDice = startDice ?? START_DICE;
    this.onChange = null; // 렌더러가 구독
    this.reset();
  }

  _newDie() {
    return {
      faces: Array.from({ length: FACE_COUNT }, (_, f) => ({ pip: f + 1, skill: null })),
      upIndex: 0,
      locked: false,
    };
  }

  reset() {
    this.dice = Array.from({ length: this.startDice }, () => this._newDie());
    // 스타터 스킬 (1번 주사위 고정 장착): F6 정타 / F1 잔향 / F2 여운
    this.dice[0].faces[5].skill = makeInstance('jungta');
    this.dice[0].faces[0].skill = makeInstance('janhyang');
    this.dice[0].faces[1].skill = makeInstance('yeoun');
    this.inventory = { skills: [], tickets: 0 }; // skills: 스킬 인스턴스 배열
    this.stageIndex = 0;
    this.log = [];
    this.phase = 'stage'; // stage | draft | maintain | gameover | victory
    this.draft = null;    // { offer: [skillId], picked: [bool], pick: n }
    this.selectedDie = null;
    this.selectedFace = null;
    this._startStage();
  }

  // ---------- 조회 ----------
  get target() { return STAGE_TARGETS[this.stageIndex]; }
  get stageNumber() { return this.stageIndex + 1; }
  get turnsLeft() { return TURNS_PER_STAGE - this.turn + 1; }
  get rerollsLeft() { return this.rollsLeft; }
  activePip(die) { return die.faces[die.upIndex].pip; }
  activeSkill(die) { const inst = die.faces[die.upIndex].skill; return inst ? SKILLS_BY_ID[inst.id] : null; }
  currentPips() { return this.dice.map(d => this.activePip(d)); }
  allInstances() {
    const list = [...this.inventory.skills];
    for (const d of this.dice) for (const f of d.faces) if (f.skill) list.push(f.skill);
    return list;
  }
  equippedCount() { return this.dice.reduce((n, d) => n + d.faces.filter(f => f.skill).length, 0); }

  // ---------- 로그 ----------
  addLog(text, type = 'info') {
    this.log.push({ text, type });
    if (this.log.length > 800) this.log.splice(0, this.log.length - 800);
  }

  _emit() { if (this.onChange) this.onChange(); }

  // ---------- 스테이지 / 턴 진행 ----------
  _startStage() {
    this.score = 0;
    this.turn = 1;
    for (const inst of this.allInstances()) inst.stageCount = 0; // '반복' 카운터 초기화
    this.addLog(`━━ 스테이지 ${this.stageNumber} — 목표 ${this.target}점 ━━`, 'stage');
    this._startTurn();
  }

  _startTurn() {
    this.rollsLeft = ROLLS_PER_TURN;
    for (const d of this.dice) d.locked = false;
    this.addLog(`[턴 ${this.turn}/${TURNS_PER_STAGE}] 시작`, 'turn');
    this._rollUnlocked(1);
    this.rollsLeft -= 1;
  }

  _rollUnlocked(rollNo) {
    for (const d of this.dice) {
      if (!d.locked) d.upIndex = Math.floor(this.rng() * FACE_COUNT);
    }
    this.addLog(`굴림 ${rollNo}  [${this.currentPips().join('] [')}]`, 'roll');
  }

  reroll() {
    if (this.phase !== 'stage' || this.rollsLeft <= 0) return false;
    if (this.dice.every(d => d.locked)) {
      this.addLog('모든 주사위가 잠겨 있어 굴릴 수 없습니다.', 'warn');
      return false;
    }
    this._rollUnlocked(ROLLS_PER_TURN - this.rollsLeft + 1);
    this.rollsLeft -= 1;
    this._emit();
    return true;
  }

  toggleLock(i) {
    if (this.phase !== 'stage') return false;
    const d = this.dice[i];
    if (!d) return false;
    d.locked = !d.locked;
    this.addLog(`주사위 ${i + 1} ${d.locked ? '잠금' : '잠금 해제'}`, 'lock');
    this._emit();
    return true;
  }

  _calcNow() {
    return calcScore(this.dice, {
      rerollsLeft: this.rollsLeft,
      turnsAfter: TURNS_PER_STAGE - this.turn,
    });
  }

  // 실시간 예상 점수 (턴 종료와 동일한 calcScore 사용, 상태 비변경)
  preview() {
    if (this.phase !== 'stage') return 0;
    return Math.floor(this._calcNow().total);
  }

  endTurn() {
    if (this.phase !== 'stage') return false;
    const r = this._calcNow();
    // 성장형 누적 적용
    const instById = new Map(this.allInstances().map(i => [i.uid, i]));
    for (const ev of r.growthEvents) {
      const inst = instById.get(ev.uid);
      if (inst) inst[ev.field] = Math.round((inst[ev.field] + ev.delta) * 10) / 10;
    }
    const turnScore = Math.floor(r.total);
    this.addLog('── 턴 종료 · 점수 계산 ──', 'turn');
    for (const line of r.lines) this.addLog(line.text, line.type);
    this.score += turnScore;
    for (const d of this.dice) d.locked = false;

    const cleared = this.score >= this.target;
    this.addLog(`턴 점수 ${turnScore}   누적 ${this.score} / 목표 ${this.target}${cleared ? '  ★클리어' : ''}`,
      cleared ? 'gold' : 'score');

    if (cleared) {
      this._clearStage();
    } else if (this.turn >= TURNS_PER_STAGE) {
      this.phase = 'gameover';
      this.addLog(`턴을 모두 소모했습니다. 목표 미달 — 패배 (${this.score}/${this.target})`, 'stage');
    } else {
      this.turn += 1;
      this._startTurn();
    }
    this._emit();
    return true;
  }

  _clearStage() {
    // '각인': 스테이지 클리어마다 영구 +step
    for (const inst of this.allInstances()) {
      const sk = SKILLS_BY_ID[inst.id];
      if (sk.kind === 'growStage') inst.growth += sk.step;
    }
    if (this.stageNumber >= STAGE_TARGETS.length) {
      this.phase = 'victory';
      this.addLog('8개 스테이지를 모두 클리어했습니다. 승리!', 'gold');
      return;
    }
    // 주사위 지급 (스테이지 1~4, 고정)
    if (this.stageNumber <= DICE_REWARD_STAGES && this.dice.length < MAX_DICE) {
      this.dice.push(this._newDie());
      this.addLog(`보상 — 주사위 +1 (현재 ${this.dice.length}개)`, 'reward');
    }
    this.inventory.tickets += REWARD_TICKET_COUNT;
    this.addLog(`보상 — 숫자 변경권 +${REWARD_TICKET_COUNT}`, 'reward');
    // 스킬 드래프트 제시
    const spec = draftSpec(this.stageNumber);
    const offer = this._drawOffer(spec.offer);
    this.draft = { offer, picked: offer.map(() => false), pick: spec.pick };
    this.phase = 'draft';
    this.selectedDie = null;
    this.selectedFace = null;
  }

  // 등급 가중(60/30/10) 추첨, 한 제시 안에서는 중복 없음
  _drawOffer(n) {
    const offer = [];
    let guard = 0;
    while (offer.length < n && guard++ < 500) {
      const roll = this.rng();
      const grade = roll < GRADE_WEIGHTS.common ? 'common'
        : roll < GRADE_WEIGHTS.common + GRADE_WEIGHTS.advanced ? 'advanced' : 'rare';
      const pool = SKILLS.filter(s => s.grade === grade && !offer.includes(s.id));
      if (pool.length === 0) continue;
      offer.push(pool[Math.floor(this.rng() * pool.length)].id);
    }
    return offer;
  }

  draftToggle(i) {
    if (this.phase !== 'draft' || !this.draft || this.draft.offer[i] === undefined) return false;
    const pickedCount = this.draft.picked.filter(Boolean).length;
    if (!this.draft.picked[i] && pickedCount >= this.draft.pick) return false; // 초과 선택 방지
    this.draft.picked[i] = !this.draft.picked[i];
    this._emit();
    return true;
  }

  draftConfirm() {
    if (this.phase !== 'draft' || !this.draft) return false;
    const chosen = this.draft.offer.filter((_, i) => this.draft.picked[i]);
    if (chosen.length !== this.draft.pick) return false;
    for (const id of chosen) this.inventory.skills.push(makeInstance(id));
    this.addLog(`보상 드래프트 — 선택: ${chosen.map(id => SKILLS_BY_ID[id].name).join(', ')}`, 'reward');
    this.draft = null;
    this.phase = 'maintain';
    this._emit();
    return true;
  }

  // ---------- 정비 ----------
  selectDie(i) {
    if (this.phase !== 'maintain') return false;
    this.selectedDie = i;
    this.selectedFace = null;
    this._emit();
    return true;
  }

  selectFace(f) {
    if (this.phase !== 'maintain' || this.selectedDie === null) return false;
    this.selectedFace = f;
    this._emit();
    return true;
  }

  equipSkill(invIndex, dieIndex, faceIndex) {
    if (this.phase !== 'maintain') return false;
    const inst = this.inventory.skills[invIndex];
    const die = this.dice[dieIndex];
    if (!inst || !die) return false;
    const face = die.faces[faceIndex];
    const skill = SKILLS_BY_ID[inst.id];
    if (!condAllows(skill.cond, face.pip)) {
      this.addLog(`'${skill.name}' 장착 불가 — 장착 조건(${skill.cond.kind === 'any' ? '' : '눈 '}조건)이 맞지 않습니다 (면 눈: ${face.pip}).`, 'warn');
      return false;
    }
    if (face.skill) {
      this.inventory.skills.push(face.skill);
      this.addLog(`'${SKILLS_BY_ID[face.skill.id].name}' 해제 → 인벤토리로 반환.`, 'info');
    }
    this.inventory.skills.splice(invIndex, 1);
    face.skill = inst;
    this.addLog(`주사위 ${dieIndex + 1} · F${faceIndex + 1}(눈 ${face.pip})에 '${skill.name}' 장착.`, 'info');
    this._emit();
    return true;
  }

  // 장착된 스킬 회수 (정비 화면 · 우클릭)
  unequipSkill(dieIndex, faceIndex) {
    if (this.phase !== 'maintain') return false;
    const die = this.dice[dieIndex];
    if (!die || !die.faces[faceIndex].skill) return false;
    const inst = die.faces[faceIndex].skill;
    die.faces[faceIndex].skill = null;
    this.inventory.skills.push(inst);
    this.addLog(`주사위 ${dieIndex + 1} · F${faceIndex + 1}의 '${SKILLS_BY_ID[inst.id].name}' 회수.`, 'info');
    this._emit();
    return true;
  }

  changeFace(dieIndex, faceIndex, delta) {
    if (this.phase !== 'maintain') return false;
    if (this.inventory.tickets <= 0) return false;
    if (delta !== 1 && delta !== -1) return false;
    const die = this.dice[dieIndex];
    if (!die) return false;
    const face = die.faces[faceIndex];
    const next = face.pip + delta;
    if (next < FACE_MIN || next > FACE_MAX) {
      this.addLog(`숫자 변경 불가 — 눈은 ${FACE_MIN}~${FACE_MAX} 범위여야 합니다.`, 'warn');
      return false;
    }
    face.pip = next;
    this.inventory.tickets -= 1;
    this.addLog(`주사위 ${dieIndex + 1} · F${faceIndex + 1} 눈 변경: ${next - delta} → ${next} (변경권 ${this.inventory.tickets}장 남음)`, 'info');
    if (face.skill && !condAllows(SKILLS_BY_ID[face.skill.id].cond, next)) {
      const inst = face.skill;
      face.skill = null;
      this.inventory.skills.push(inst);
      this.addLog(`'${SKILLS_BY_ID[inst.id].name}'의 장착 조건이 깨져 인벤토리로 반환되었습니다.`, 'warn');
    }
    this._emit();
    return true;
  }

  // 주사위 계산 순서 변경 (정비 화면 전용 — 스테이지 진입 시 고정)
  moveDie(i, delta) {
    if (this.phase !== 'maintain') return false;
    const j = i + delta;
    if (j < 0 || j >= this.dice.length || (delta !== 1 && delta !== -1)) return false;
    [this.dice[i], this.dice[j]] = [this.dice[j], this.dice[i]];
    if (this.selectedDie === i) this.selectedDie = j;
    else if (this.selectedDie === j) this.selectedDie = i;
    this.addLog(`주사위 순서 변경: ${i + 1}번 ↔ ${j + 1}번`, 'info');
    this._emit();
    return true;
  }

  nextStage() {
    if (this.phase !== 'maintain') return false;
    this.stageIndex += 1;
    this.phase = 'stage';
    this._startStage();
    this._emit();
    return true;
  }

  // ---------- 테스트 훅 ----------
  _forceUp(indices) {
    indices.forEach((up, i) => { if (this.dice[i]) this.dice[i].upIndex = up; });
  }
}
