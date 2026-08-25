// 순수 게임 로직 — DOM/렌더 의존 없음. Node에서 headless로 실행 가능.
import {
  DICE_COUNT, FACE_COUNT, FACE_MIN, FACE_MAX,
  TURNS_PER_STAGE, ROLLS_PER_TURN,
  REWARD_SKILL_COUNT, REWARD_TICKET_COUNT,
  STAGE_TARGETS, SKILLS, SKILLS_BY_ID, condAllows,
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

// 개별 주사위 효과 계산. ctx: { face, faces, index, lockedCount, stage, equippedCount, score }
// 반환: 이 주사위의 최종 기여 점수
export function applyEffect(effect, ctx) {
  const { face, faces, index } = ctx;
  const others = faces.filter((_, i) => i !== index);
  const count = (arr, fn) => arr.reduce((n, v) => n + (fn(v) ? 1 : 0), 0);
  switch (effect.type) {
    case 'flat': return face + effect.v;
    case 'mult': return face * effect.v;
    case 'perMatchOther': return face + effect.v * count(others, v => v === face);
    case 'perEvenAll': return face + effect.v * count(faces, v => v % 2 === 0);
    case 'perOddAll': return face + effect.v * count(faces, v => v % 2 === 1);
    case 'maxOtherX2': return face + 2 * Math.max(...others);
    case 'minOtherX3': return face + 3 * Math.min(...others);
    case 'sumAll': return face + faces.reduce((a, b) => a + b, 0);
    case 'uniqueMult': return others.every(v => v !== face) ? face * effect.v : face;
    case 'crowdMult': return count(others, v => v === face) >= 2 ? face * effect.v : face;
    case 'ladder': return others.some(v => v === face + 1) ? face + effect.v : face;
    case 'noOddMult': return faces.every(v => v % 2 === 0) ? face * effect.v : face;
    case 'noEvenMult': return faces.every(v => v % 2 === 1) ? face * effect.v : face;
    case 'perLocked': return face + effect.v * ctx.lockedCount;
    case 'noLockedMult': return ctx.lockedCount === 0 ? face * effect.v : face;
    case 'perSix': return face + effect.v * count(faces, v => v === 6);
    case 'perHigh': return face + effect.v * count(faces, v => v >= 4);
    case 'perLow': return face + effect.v * count(faces, v => v <= 3);
    case 'perEquipped': return face + effect.v * ctx.equippedCount;
    case 'perStage': return face + effect.v * ctx.stage;
    case 'fifthScore': return face + Math.floor(ctx.score / 5);
    default: return face;
  }
}

// 총점 계열 효과. subtotal에 적용된 결과를 반환 (변화 없으면 subtotal 그대로)
export function applyTotalEffect(effect, subtotal, faces) {
  const evens = faces.filter(v => v % 2 === 0).length;
  const maxSame = Math.max(...faces.map(v => faces.filter(w => w === v).length));
  switch (effect.type) {
    case 'totalFlat': return subtotal + effect.v;
    case 'totalMultEven4': return evens >= 4 ? subtotal * effect.v : subtotal;
    case 'totalMultOdd4': return faces.length - evens >= 4 ? subtotal * effect.v : subtotal;
    case 'totalMultTriple': return maxSame >= 3 ? subtotal * effect.v : subtotal;
    default: return subtotal;
  }
}

export function isTotalEffect(effect) {
  return effect.type.startsWith('total');
}

export class Game {
  constructor({ rng } = {}) {
    this.rng = rng || Math.random;
    this.onChange = null; // 렌더러가 구독
    this.reset();
  }

  reset() {
    this.dice = Array.from({ length: DICE_COUNT }, () => ({
      faces: [1, 2, 3, 4, 5, 6],
      skills: Array(FACE_COUNT).fill(null), // 스킬 id 또는 null
      faceIndex: 0,
      locked: false,
    }));
    this.inventory = { skills: [], tickets: 0 }; // skills: 스킬 id 배열
    this.stageIndex = 0;
    this.log = [];
    this.phase = 'stage'; // stage | maintain | gameover | victory
    this.selectedDie = null; // 정비 화면용
    this.selectedFace = null;
    this._startStage();
  }

  // ---------- 조회 ----------
  get target() { return STAGE_TARGETS[this.stageIndex]; }
  get stageNumber() { return this.stageIndex + 1; }
  faceValue(die) { return die.faces[die.faceIndex]; }
  faceSkill(die) { const id = die.skills[die.faceIndex]; return id ? SKILLS_BY_ID[id] : null; }
  currentFaces() { return this.dice.map(d => this.faceValue(d)); }
  get turnsLeft() { return TURNS_PER_STAGE - this.turn + 1; }

  // ---------- 로그 ----------
  addLog(text, type = 'info') {
    this.log.push({ text, type });
    if (this.log.length > 500) this.log.splice(0, this.log.length - 500);
  }

  _emit() { if (this.onChange) this.onChange(); }

  // ---------- 스테이지 / 턴 진행 ----------
  _startStage() {
    this.score = 0;
    this.turn = 1;
    this.addLog(`━━ 스테이지 ${this.stageNumber} 시작 — 목표 ${this.target}점 ━━`, 'stage');
    this._startTurn();
  }

  _startTurn() {
    this.rollsLeft = ROLLS_PER_TURN;
    for (const d of this.dice) d.locked = false;
    this.addLog(`[턴 ${this.turn}/${TURNS_PER_STAGE}] 시작 — 주사위를 굴립니다.`, 'turn');
    this._rollUnlocked();
    this.rollsLeft -= 1;
  }

  _rollUnlocked() {
    this.dice.forEach((d, i) => {
      if (!d.locked) d.faceIndex = Math.floor(this.rng() * FACE_COUNT);
    });
    this.addLog(`굴림 결과: [${this.currentFaces().join(', ')}]`, 'roll');
  }

  // 재굴림 버튼
  reroll() {
    if (this.phase !== 'stage' || this.rollsLeft <= 0) return false;
    if (this.dice.every(d => d.locked)) {
      this.addLog('모든 주사위가 잠겨 있어 굴릴 수 없습니다.', 'warn');
      return false;
    }
    this._rollUnlocked();
    this.rollsLeft -= 1;
    this._emit();
    return true;
  }

  toggleLock(i) {
    if (this.phase !== 'stage') return false;
    const d = this.dice[i];
    if (!d) return false;
    d.locked = !d.locked;
    this._emit();
    return true;
  }

  // 턴 종료: 스킬 발동 → 점수 가산 → 클리어/패배/다음 턴 판정
  endTurn() {
    if (this.phase !== 'stage') return false;
    const faces = this.currentFaces();
    const lockedCount = this.dice.reduce((n, d) => n + (d.locked ? 1 : 0), 0);
    const equippedCount = this.dice.reduce((n, d) => n + d.skills.filter(Boolean).length, 0);

    let subtotal = 0;
    const totalQueue = []; // { die 번호, skill }
    this.dice.forEach((die, i) => {
      const face = faces[i];
      const skill = this.faceSkill(die);
      if (!skill) { subtotal += face; return; }
      if (isTotalEffect(skill.effect)) {
        subtotal += face;
        totalQueue.push({ dieNo: i + 1, skill });
        return;
      }
      const value = applyEffect(skill.effect, {
        face, faces, index: i, lockedCount, equippedCount,
        stage: this.stageNumber, score: this.score,
      });
      this.addLog(`주사위 ${i + 1} · '${skill.name}' 발동: ${face} → ${value}`, 'skill');
      subtotal += value;
    });

    for (const { dieNo, skill } of totalQueue) {
      const after = applyTotalEffect(skill.effect, subtotal, faces);
      if (after !== subtotal) {
        this.addLog(`주사위 ${dieNo} · '${skill.name}' 발동: 총점 ${subtotal} → ${after}`, 'skill');
        subtotal = after;
      }
    }

    this.score += subtotal;
    this.addLog(`[턴 ${this.turn}] 종료 — 획득 ${subtotal}점 (누적 ${this.score}/${this.target})`, 'turn');
    for (const d of this.dice) d.locked = false;

    if (this.score >= this.target) {
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
    this.addLog(`★ 스테이지 ${this.stageNumber} 클리어! (${this.score}/${this.target})`, 'stage');
    // 보상: 무작위 스킬 3개 + 숫자 변경권 2개
    const gained = [];
    for (let k = 0; k < REWARD_SKILL_COUNT; k++) {
      const s = SKILLS[Math.floor(this.rng() * SKILLS.length)];
      this.inventory.skills.push(s.id);
      gained.push(s.name);
    }
    this.inventory.tickets += REWARD_TICKET_COUNT;
    this.addLog(`보상 획득 — 스킬: ${gained.join(', ')} / 숫자 변경권 +${REWARD_TICKET_COUNT}`, 'reward');

    if (this.stageIndex >= STAGE_TARGETS.length - 1) {
      this.phase = 'victory';
      this.addLog('모든 스테이지를 클리어했습니다. 승리!', 'stage');
    } else {
      this.phase = 'maintain';
      this.selectedDie = null;
      this.selectedFace = null;
    }
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

  // 인벤토리 invIndex의 스킬을 (dieIndex, faceIndex) 면에 장착
  equipSkill(invIndex, dieIndex, faceIndex) {
    if (this.phase !== 'maintain') return false;
    const skillId = this.inventory.skills[invIndex];
    if (skillId === undefined) return false;
    const die = this.dice[dieIndex];
    if (!die) return false;
    const value = die.faces[faceIndex];
    const skill = SKILLS_BY_ID[skillId];
    if (!condAllows(skill.cond, value)) {
      this.addLog(`'${skill.name}' 장착 불가 — 조건이 맞지 않습니다 (면: ${value}).`, 'warn');
      return false;
    }
    const prev = die.skills[faceIndex];
    if (prev) {
      this.inventory.skills.push(prev);
      this.addLog(`'${SKILLS_BY_ID[prev].name}' 해제 → 인벤토리로 반환.`, 'info');
    }
    this.inventory.skills.splice(invIndex, 1);
    die.skills[faceIndex] = skillId;
    this.addLog(`주사위 ${dieIndex + 1}의 ${value} 면에 '${skill.name}' 장착.`, 'info');
    this._emit();
    return true;
  }

  // 숫자 변경권으로 면의 눈을 ±1
  changeFace(dieIndex, faceIndex, delta) {
    if (this.phase !== 'maintain') return false;
    if (this.inventory.tickets <= 0) return false;
    if (delta !== 1 && delta !== -1) return false;
    const die = this.dice[dieIndex];
    if (!die) return false;
    const next = die.faces[faceIndex] + delta;
    if (next < FACE_MIN || next > FACE_MAX) {
      this.addLog(`숫자 변경 불가 — 눈은 ${FACE_MIN}~${FACE_MAX} 범위여야 합니다.`, 'warn');
      return false;
    }
    die.faces[faceIndex] = next;
    this.inventory.tickets -= 1;
    this.addLog(`주사위 ${dieIndex + 1}의 면 숫자 변경: ${next - delta} → ${next} (변경권 ${this.inventory.tickets}장 남음)`, 'info');
    // 변경으로 조건이 깨진 스킬은 인벤토리로 반환
    const equipped = die.skills[faceIndex];
    if (equipped && !condAllows(SKILLS_BY_ID[equipped].cond, next)) {
      die.skills[faceIndex] = null;
      this.inventory.skills.push(equipped);
      this.addLog(`'${SKILLS_BY_ID[equipped].name}'의 장착 조건이 깨져 인벤토리로 반환되었습니다.`, 'warn');
    }
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
  _forceFaces(indices) {
    indices.forEach((fi, i) => { this.dice[i].faceIndex = fi; });
  }
}
