// TnD 결합 데모 — 순수 게임 로직 (DOM 의존 없음). 기획안 결합 v1.
import { OPPOSITE, FACE_COUNT, condAllows } from './config.js';
import { mulberry32, faceState, layerMatches } from './game.js';
import {
  TND, TND_SKILLS_BY_ID, PIECES_BY_ID, STARTER_BUILD, STARTER_DECK,
  ceil, upgradeCost, sellPrice, enemyPieceCost,
} from './tnd-config.js';

export { mulberry32 };

let uid = 1;
export function makeInst(skillId) { return { uid: uid++, id: skillId, growth: 0, count: 0 }; }

// ── 스킬 효과 평가 (결합판). 발동하지 않으면 null.
// ctx: { S, activePips, upPip, pip, orderIndex, orderCount, lockedCount, rerollsLeft,
//        pieces(N), corrupts, enemyPieces(M), playerPos, inst }
export function evalEffectTnd(skill, ctx) {
  const add = n => ({ op: 'add', n });
  const mul = n => ({ op: 'mul', n });
  const count = v => ctx.activePips.filter(p => p === v).length;
  switch (skill.kind) {
    case 'flat': return skill.op === 'add' ? add(skill.v) : mul(skill.v);
    case 'pip': return add(ctx.pip);
    case 'halfPip': return add(ceil(ctx.pip / 2));
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
    case 'noReroll': return ctx.rerollsLeft === 0 ? mul(skill.v) : null;
    case 'perFront': return add(skill.v * ctx.orderIndex);
    case 'first': return ctx.orderIndex === 0 ? add(skill.v) : null;
    case 'fuse': return ctx.S < 30 ? add(skill.v) : null;
    case 'inertia': return ctx.S >= 60 ? mul(skill.v) : null;
    case 'last': return ctx.orderIndex === ctx.orderCount - 1 ? mul(skill.v) : null;
    case 'growCount': return add(Math.min(TND.REPEAT_CAP, ctx.inst.count + 1));
    case 'growAdd': return add(skill.v + ctx.inst.growth);
    case 'growStage': return add(skill.v + ctx.inst.growth);
    case 'growMult': return mul(skill.v + ctx.inst.growth);
    case 'perPiece': return add(skill.v * ctx.pieces);
    case 'perCorrupt': return add(skill.v * ctx.corrupts);
    case 'perEnemyPieceMult': return ctx.enemyPieces > 0 ? mul(Math.pow(skill.v, ctx.enemyPieces)) : null;
    case 'homeNear': return Math.min(ctx.playerPos, TND.BOARD_SIZE - ctx.playerPos) <= TND.HOME_RANGE ? add(skill.v) : null;
    default: return null;
  }
}

// ── 신앙치 계산 (순수 함수). 매 단계 올림. 프리뷰와 정산이 공유한다.
export function calcFaithPoints(dice, ctx) {
  const activePips = dice.map(d => d.faces[d.upIndex].pip);
  let S = activePips.reduce((a, b) => a + b, 0) + (ctx.accBonus || 0);
  const lines = [{ text: `기본 눈합  ${S}${ctx.accBonus ? ` (회당 +${ctx.accBonus})` : ''}`, type: 'calc' }];
  const growthEvents = [];
  const lockedCount = dice.filter(d => d.locked).length;
  dice.forEach((die, orderIndex) => {
    const upPip = die.faces[die.upIndex].pip;
    const faceOrder = [die.upIndex, OPPOSITE[die.upIndex],
      ...die.faces.map((_, f) => f).filter(f => f !== die.upIndex && f !== OPPOSITE[die.upIndex])];
    for (const f of faceOrder) {
      const inst = die.faces[f].skill;
      if (!inst) continue;
      const skill = TND_SKILLS_BY_ID[inst.id];
      if (skill.layer === 'move') continue; // 이동 계층은 정산에서 발동하지 않음
      if (!layerMatches(skill.layer, faceState(f, die.upIndex))) continue;
      const eff = evalEffectTnd(skill, {
        S, activePips, upPip, pip: die.faces[f].pip, orderIndex, orderCount: dice.length,
        lockedCount, rerollsLeft: ctx.rerollsLeft, pieces: ctx.pieces, corrupts: ctx.corrupts,
        enemyPieces: ctx.enemyPieces, playerPos: ctx.playerPos, inst,
      });
      if (!eff) continue;
      S = ceil(eff.op === 'add' ? S + eff.n : S * eff.n);
      const opText = eff.op === 'add' ? `+${fmtNum(eff.n)}` : `×${fmtNum(eff.n)}`;
      lines.push({ text: `[${orderIndex + 1}번·F${f + 1}] ${skill.name}  ${opText}  →  ${S}`, type: eff.op });
      if (skill.kind === 'growCount') growthEvents.push({ uid: inst.uid, field: 'count', delta: 1 });
      if (skill.kind === 'growAdd' || skill.kind === 'growMult') growthEvents.push({ uid: inst.uid, field: 'growth', delta: skill.step });
    }
  });
  return { total: S, lines, growthEvents };
}
function fmtNum(n) { return Number.isInteger(n) ? String(n) : (Math.round(n * 100) / 100).toString(); }

// ── 신앙치 → 신앙 변환 (순수 함수, 기획안 §3.3 의사코드)
export function convert(points, gauge) {
  let faith = 0, combo = 0, fills = 0;
  let guard = 0;
  while (points > 0 && guard++ < 10000) {
    const need = TND.GAUGE - gauge;
    if (points >= need) {
      points -= need; faith += 1; fills += 1;
      if (fills >= 2) combo = Math.min(TND.COMBO_MAX, combo + 1);
      gauge = combo;
    } else {
      gauge += points; points = 0;
    }
  }
  return { faith, gauge, fills, combo };
}

const emptyCell = id => ({ id, piece: null, corrupt: null });

export class TndGame {
  constructor({ rng } = {}) {
    this.rng = rng || Math.random;
    this.onChange = null;
    this.log = [];
    this.dice = Array.from({ length: TND.DICE }, () => ({
      faces: Array.from({ length: FACE_COUNT }, (_, f) => ({ pip: f + 1, skill: null })),
      upIndex: 0, locked: false,
    }));
    for (const [d, faces] of Object.entries(STARTER_BUILD)) {
      for (const [f, id] of Object.entries(faces)) this.dice[d].faces[f].skill = makeInst(id);
    }
    this.deck = [...STARTER_DECK];
    this.phase = 'prep'; // prep | trial | end
    this.sub = null;     // trial: roll | act | dialog | enemy
    this.pending = null;
    this.result = null;
    this.selectedDie = null; this.selectedFace = null; this.selectedSkill = null;
    this.board = []; this.player = null; this.enemy = null; this.turn = 0;
  }

  _emit() { if (this.onChange) this.onChange(); }
  addLog(text, type = 'action') {
    this.log.push({ text, type });
    if (this.log.length > 1000) this.log.splice(0, this.log.length - 1000);
  }

  // ───────── 조회 ─────────
  activePip(die) { return die.faces[die.upIndex].pip; }
  currentPips() { return this.dice.map(d => this.activePip(d)); }
  allInstances() { const a = []; for (const d of this.dice) for (const f of d.faces) if (f.skill) a.push(f.skill); return a; }
  equippedSkillIds() { return new Set(this.allInstances().map(i => i.id)); }
  myPieceCount() { return this.board.filter(c => c.piece && c.piece.owner === 'P').length; }
  enemyPieceCount() { return this.board.filter(c => c.piece && c.piece.owner === 'E').length; }
  corruptCount() { return this.board.filter(c => c.corrupt).length; }
  cellAt(id) { return this.board[((id % TND.BOARD_SIZE) + TND.BOARD_SIZE) % TND.BOARD_SIZE]; }
  finalEnemyCost(cell) { return enemyPieceCost(cell.piece.grade, this.enemyPieceCount()); }
  myPieces() { return this.board.filter(c => c.piece && c.piece.owner === 'P'); }
  totalSellable() { return this.myPieces().reduce((s, c) => s + sellPrice(PIECES_BY_ID[c.piece.defId], c.piece.grade), 0); }

  // ───────── 정비 ─────────
  selectDie(i) { if (this.phase !== 'prep') return false; this.selectedDie = i; this.selectedFace = null; this._emit(); return true; }
  selectFace(f) { if (this.phase !== 'prep' || this.selectedDie === null) return false; this.selectedFace = f; this._emit(); return true; }
  selectSkill(id) { if (this.phase !== 'prep') return false; this.selectedSkill = this.selectedSkill === id ? null : id; this._emit(); return true; }

  canEquip(skillId, d, f) {
    const skill = TND_SKILLS_BY_ID[skillId];
    if (!skill || this.phase !== 'prep') return false;
    if (this.equippedSkillIds().has(skillId)) return false; // 같은 스킬 1개 제한
    return condAllows(skill.cond, this.dice[d].faces[f].pip);
  }
  equip(skillId, d, f) {
    if (!this.canEquip(skillId, d, f)) return false;
    this.dice[d].faces[f].skill = makeInst(skillId);
    this.selectedSkill = null;
    this._emit();
    return true;
  }
  unequip(d, f) {
    if (this.phase !== 'prep' || !this.dice[d]?.faces[f]?.skill) return false;
    this.dice[d].faces[f].skill = null;
    this._emit();
    return true;
  }
  changePip(d, f, delta) {
    if (this.phase !== 'prep' || (delta !== 1 && delta !== -1)) return false;
    const face = this.dice[d].faces[f];
    const next = face.pip + delta;
    if (next < 1 || next > 6) return false;
    face.pip = next;
    if (face.skill && !condAllows(TND_SKILLS_BY_ID[face.skill.id].cond, next)) face.skill = null; // 조건 파괴 → 해제
    this._emit();
    return true;
  }
  moveDie(i, delta) {
    if (this.phase !== 'prep') return false;
    const j = i + delta;
    if (j < 0 || j >= this.dice.length || Math.abs(delta) !== 1) return false;
    [this.dice[i], this.dice[j]] = [this.dice[j], this.dice[i]];
    if (this.selectedDie === i) this.selectedDie = j; else if (this.selectedDie === j) this.selectedDie = i;
    this._emit();
    return true;
  }
  deckAdd(pieceId) {
    if (this.phase !== 'prep' || !PIECES_BY_ID[pieceId] || this.deck.length >= TND.DECK_SIZE) return false;
    this.deck.push(pieceId); this._emit(); return true;
  }
  deckRemove(slot) {
    if (this.phase !== 'prep' || slot < 0 || slot >= this.deck.length) return false;
    this.deck.splice(slot, 1); this._emit(); return true;
  }
  canStart() { return this.phase === 'prep' && this.deck.length === TND.DECK_SIZE; }

  // ───────── 고행 시작/종료 ─────────
  startTrial() {
    if (!this.canStart()) return false;
    this.board = Array.from({ length: TND.BOARD_SIZE }, (_, i) => emptyCell(i));
    this.player = { pos: 0, faith: TND.PLAYER_START_FAITH, gauge: 0, purifyCost: TND.PURIFY_START, laps: 0 };
    this.enemy = { pos: 0, faith: TND.ENEMY_START_FAITH, laps: 0 };
    for (const inst of this.allInstances()) { inst.growth = 0; inst.count = 0; }
    this.turn = 0; this.result = null; this.pending = null; this.queue = [];
    this.rerollBonus = 0; this.accBonus = 0; this.usedMove = null; this.enemyRollsLeft = 0;
    this.log = [];
    this.phase = 'trial';
    this.addLog('━━ 고행 시작 — 적 신앙 100 ━━', 'event');
    this._startPlayerTurn();
    this._emit();
    return true;
  }
  backToPrep() {
    if (this.phase !== 'end') return false;
    this.phase = 'prep'; this.sub = null; this.pending = null;
    this.selectedDie = null; this.selectedFace = null; this.selectedSkill = null;
    this._emit();
    return true;
  }
  _finish(result, text) {
    this.result = result; this.phase = 'end'; this.sub = null; this.pending = null; this.queue = [];
    this.addLog(text, 'decision');
  }

  // ───────── 플레이어 턴: 굴림 ─────────
  _startPlayerTurn() {
    this.turn += 1;
    this.sub = 'roll';
    this.usedMove = null;
    this.rollsLeft = TND.ROLLS_PER_TURN + this.rerollBonus;
    if (this.rerollBonus) this.addLog(`성물함 효과 — 이번 턴 재굴림 +${this.rerollBonus}`, 'calc');
    this.rerollBonus = 0;
    this.rollNo = 1;
    for (const d of this.dice) d.locked = false;
    this.addLog(`── 턴 ${this.turn} · 플레이어 ──`, 'action');
    this._rollUnlocked(1);
    this.rollsLeft -= 1;
  }
  _rollUnlocked(rollNo) {
    for (const d of this.dice) if (!d.locked) d.upIndex = Math.floor(this.rng() * FACE_COUNT);
    this.addLog(`굴림 ${rollNo}  [${this.currentPips().join('] [')}]`, 'action');
  }
  toggleLock(i) {
    if (this.phase !== 'trial' || this.sub !== 'roll' || !this.dice[i]) return false;
    this.dice[i].locked = !this.dice[i].locked;
    this.addLog(`${this.dice[i].locked ? '잠금' : '잠금 해제'}  ${i + 1}번`, 'action');
    this._emit(); return true;
  }
  reroll() {
    if (this.phase !== 'trial' || this.sub !== 'roll' || this.rollsLeft <= 0) return false;
    if (this.dice.every(d => d.locked)) { this.addLog('모든 주사위가 잠겨 있어 굴릴 수 없습니다.', 'calc'); return false; }
    this.rollNo += 1;
    this._rollUnlocked(this.rollNo);
    this.rollsLeft -= 1;
    this._emit(); return true;
  }
  _calcCtx() {
    return {
      accBonus: this.accBonus, rerollsLeft: this.rollsLeft,
      pieces: this.myPieceCount(), corrupts: this.corruptCount(), enemyPieces: this.enemyPieceCount(),
      playerPos: this.player.pos,
    };
  }
  // 프리뷰: 지금 확정하면 얻는 신앙치와 변환 후 신앙 (상태 비변경)
  preview() {
    if (this.phase !== 'trial' || this.sub !== 'roll') return null;
    const r = calcFaithPoints(this.dice, this._calcCtx());
    const c = convert(r.total, this.player.gauge);
    return { points: r.total, faith: c.faith, gauge: c.gauge };
  }
  // 확정 → 정산
  confirm() {
    if (this.phase !== 'trial' || this.sub !== 'roll') return false;
    const r = calcFaithPoints(this.dice, this._calcCtx());
    const byUid = new Map(this.allInstances().map(i => [i.uid, i]));
    for (const ev of r.growthEvents) { const inst = byUid.get(ev.uid); if (inst) inst[ev.field] = Math.round((inst[ev.field] + ev.delta) * 10) / 10; }
    this.accBonus = 0;
    this.addLog('── 정산 ──', 'action');
    for (const l of r.lines) this.addLog(l.text, l.type);
    this.addLog(`신앙치 ${r.total}`, 'calc');
    const c = convert(r.total, this.player.gauge);
    this.player.gauge = c.gauge;
    this.player.faith += c.faith;
    this.addLog(`게이지 충전 ×${c.fills} · 콤보 ${c.combo} · 신앙 +${c.faith}`, 'calc');
    this.addLog(`신앙 ${this.player.faith} (+${c.faith}) · 게이지 잔량 ${c.gauge}`, 'calc');
    this.sub = 'act';
    this._emit(); return true;
  }

  // ───────── 행동 단계: 이동 ─────────
  reachable() {
    if (this.phase !== 'trial' || this.sub !== 'act') return [];
    return this.dice.map((d, i) => {
      let steps = this.activePip(d);
      const inst = d.faces[d.upIndex].skill;
      if (inst && TND_SKILLS_BY_ID[inst.id].kind === 'moveExtra') steps += TND_SKILLS_BY_ID[inst.id].v;
      return { die: i, cell: (this.player.pos + steps) % TND.BOARD_SIZE, steps };
    });
  }
  chooseMoveDie(i) {
    if (this.phase !== 'trial' || this.sub !== 'act' || !this.dice[i]) return false;
    const die = this.dice[i];
    let steps = this.activePip(die);
    const opts = { skipPay: false, mult: 1, holy: 0 };
    const inst = die.faces[die.upIndex].skill;
    const ms = inst ? TND_SKILLS_BY_ID[inst.id] : null;
    this.usedMove = i;
    if (ms && ms.layer === 'move') {
      if (ms.kind === 'moveFaith') { this.player.faith += ms.v; this.addLog(`[${i + 1}번·F${die.upIndex + 1}] ${ms.name}  신앙 +${ms.v}`, 'add'); }
      if (ms.kind === 'moveDouble') { opts.mult = 2; this.addLog(`[${i + 1}번·F${die.upIndex + 1}] ${ms.name}  도착 칸 내 기물 효과 2회`, 'calc'); }
      if (ms.kind === 'moveExtra') { steps += ms.v; this.addLog(`[${i + 1}번·F${die.upIndex + 1}] ${ms.name}  +${ms.v}칸`, 'calc'); }
      if (ms.kind === 'moveHoly') opts.holy = ms.v;
      if (ms.kind === 'moveSkipPay') { opts.skipPay = true; this.addLog(`[${i + 1}번·F${die.upIndex + 1}] ${ms.name}  강제지불 면제`, 'calc'); }
    }
    const to = this._movePlayer(steps);
    this.addLog(`이동  ${i + 1}번 주사위 [${this.activePip(die)}] → 칸 ${to}`, 'action');
    const cell = this.board[to];
    if (opts.holy && cell.corrupt) { cell.corrupt.counter += opts.holy; this.addLog(`[${i + 1}번] 성수  칸 ${to} 타락 카운터 +${opts.holy} → ${cell.corrupt.counter}`, 'calc'); }
    this.queue = this._arrivalQueue(to, opts);
    this.queue.push({ t: 'endTurn' });
    this._next();
    this._emit(); return true;
  }
  _movePlayer(steps) {
    const raw = this.player.pos + steps;
    if (raw >= TND.BOARD_SIZE) {
      this.player.laps += 1;
      for (const inst of this.allInstances()) { const s = TND_SKILLS_BY_ID[inst.id]; if (s.kind === 'growStage') inst.growth += s.step; }
      this.addLog(`내 말 한 바퀴 (${this.player.laps}회)`, 'event');
    }
    this.player.pos = raw % TND.BOARD_SIZE;
    return this.player.pos;
  }
  _arrivalQueue(pos, opts) {
    const cell = this.board[pos];
    const q = [];
    if (cell.piece && cell.piece.owner === 'E') {
      if (opts.skipPay) this.addLog(`밟음  칸 ${pos} · 사악한 기물 G${cell.piece.grade} (강행: 지불 면제)`, 'action');
      else q.push({ t: 'pay', pos });
    }
    if (cell.corrupt) q.push({ t: 'purify', pos });
    if (cell.piece && cell.piece.owner === 'P') { q.push({ t: 'ownStep', pos, mult: opts.mult }); q.push({ t: 'upgrade', pos }); }
    if (cell.piece && cell.piece.owner === 'E') q.push({ t: 'destroy', pos });
    if (!cell.piece && pos !== TND.START_CELL) q.push({ t: 'build', pos });
    if (!cell.piece && !cell.corrupt) this.addLog(`밟음  칸 ${pos} · ${pos === 0 ? '시작칸' : '빈 칸'}`, 'action');
    return q;
  }
  // 상호작용 큐 진행. 대화창이 필요하면 pending을 세우고 멈춘다.
  _next() {
    while (this.queue.length > 0 && this.phase === 'trial') {
      const item = this.queue.shift();
      const cell = item.pos !== undefined ? this.board[item.pos] : null;
      switch (item.t) {
        case 'pay': {
          if (!cell.piece || cell.piece.owner !== 'E') break;
          const cost = this.finalEnemyCost(cell);
          this.addLog(`밟음  칸 ${item.pos} · 사악한 기물 G${cell.piece.grade} · 강제지불 ${cost}`, 'event');
          this.pending = { type: 'pay', pos: item.pos, cost }; this.sub = 'dialog'; return;
        }
        case 'purify': {
          if (!cell.corrupt) break;
          this.addLog(`밟음  칸 ${item.pos} · 타락 (카운터 ${cell.corrupt.counter})`, 'action');
          this.pending = { type: 'purify', pos: item.pos, cost: this.player.purifyCost }; this.sub = 'dialog'; return;
        }
        case 'ownStep': {
          if (!cell.piece || cell.piece.owner !== 'P') break;
          const def = PIECES_BY_ID[cell.piece.defId];
          this.addLog(`밟음  칸 ${item.pos} · 내 기물 ${def.name} G${cell.piece.grade}`, 'action');
          if (cell.corrupt) { this.addLog(`${def.name} 효과 무효 (타락 칸)`, 'calc'); break; }
          for (let k = 0; k < item.mult; k++) this._pieceOnPlayerStep(cell);
          break;
        }
        case 'upgrade': {
          if (!cell.piece || cell.piece.owner !== 'P' || cell.corrupt || cell.piece.grade >= TND.MAX_GRADE) break;
          const def = PIECES_BY_ID[cell.piece.defId];
          this.pending = { type: 'upgrade', pos: item.pos, grade: cell.piece.grade, perLevel: upgradeCost(def), name: def.name };
          this.sub = 'dialog'; return;
        }
        case 'destroy': {
          if (!cell.piece || cell.piece.owner !== 'E') break;
          const cost = ceil(this.finalEnemyCost(cell) * TND.DESTROY_MULT);
          this.pending = { type: 'destroy', pos: item.pos, cost, grade: cell.piece.grade }; this.sub = 'dialog'; return;
        }
        case 'build': {
          if (cell.piece || cell.corrupt || item.pos === TND.START_CELL) break;
          this.pending = { type: 'build', pos: item.pos }; this.sub = 'dialog'; return;
        }
        case 'chain': {
          const to = this._movePlayer(item.n);
          this.addLog(`순례길  +${item.n}칸 → 칸 ${to}`, 'action');
          const extra = this._arrivalQueue(to, { skipPay: false, mult: 1, holy: 0 });
          this.queue = [...extra, ...this.queue];
          break;
        }
        case 'endTurn': this._endPlayerTurn(); return;
      }
    }
  }

  // ───────── 대화창 응답 ─────────
  payConfirm() {
    const p = this.pending; if (!p || p.type !== 'pay') return false;
    if (this.player.faith < p.cost) return false;
    this.player.faith -= p.cost;
    this.addLog(`강제지불  사악한 기물 G${this.board[p.pos].piece.grade} · ${p.cost} 신앙 (잔여 ${this.player.faith})`, 'event');
    this.pending = null; this.sub = 'act'; this._next(); this._emit(); return true;
  }
  sellPiece(pos) {
    const cell = this.board[pos];
    if (!this.pending || this.pending.type !== 'pay' || !cell.piece || cell.piece.owner !== 'P') return false;
    const def = PIECES_BY_ID[cell.piece.defId];
    const price = sellPrice(def, cell.piece.grade);
    this.player.faith += price;
    this.addLog(`판매  칸 ${pos} ${def.name} G${cell.piece.grade} · +${price} 신앙`, 'action');
    cell.piece = null;
    this._emit(); return true;
  }
  canPay() { return !!this.pending && this.pending.type === 'pay' && this.player.faith >= this.pending.cost; }
  mustGiveUp() { return !!this.pending && this.pending.type === 'pay' && this.player.faith + this.totalSellable() < this.pending.cost; }
  giveUp() {
    if (!this.pending || this.pending.type !== 'pay') return false;
    this._finish('defeat', '✕ 강제지불 불가. 패배 (게임 포기).');
    this._emit(); return true;
  }
  purify() {
    const p = this.pending; if (!p || p.type !== 'purify') return false;
    if (this.player.faith < p.cost) return false;
    this.player.faith -= p.cost;
    this.board[p.pos].corrupt = null;
    this.player.purifyCost += TND.PURIFY_STEP;
    this.addLog(`정화  칸 ${p.pos} · ${p.cost} 신앙 (다음 정화 비용 ${this.player.purifyCost})`, 'action');
    this.pending = null; this.sub = 'act';
    // 정화 후 빈 칸이면 건설 가능해진다
    const cell = this.board[p.pos];
    if (!cell.piece && !this.queue.some(q => q.t === 'build')) this.queue.unshift({ t: 'build', pos: p.pos });
    this._next(); this._emit(); return true;
  }
  skipPurify() {
    if (!this.pending || this.pending.type !== 'purify') return false;
    this.pending = null; this.sub = 'act'; this._next(); this._emit(); return true;
  }
  upgradeTo(target) {
    const p = this.pending; if (!p || p.type !== 'upgrade') return false;
    const cell = this.board[p.pos];
    const levels = target - cell.piece.grade;
    if (levels < 1 || target > TND.MAX_GRADE) return false;
    const total = levels * p.perLevel;
    if (this.player.faith < total) return false;
    this.player.faith -= total;
    this.addLog(`업그레이드  칸 ${p.pos} ${p.name} G${cell.piece.grade} → G${target} · ${total} 신앙`, 'action');
    cell.piece.grade = target;
    this.pending = null; this.sub = 'act'; this._next(); this._emit(); return true;
  }
  skipUpgrade() {
    if (!this.pending || this.pending.type !== 'upgrade') return false;
    this.pending = null; this.sub = 'act'; this._next(); this._emit(); return true;
  }
  destroy() {
    const p = this.pending; if (!p || p.type !== 'destroy') return false;
    if (this.player.faith < p.cost) return false;
    this.player.faith -= p.cost;
    this.addLog(`파괴  칸 ${p.pos} 사악한 기물 G${p.grade} · ${p.cost} 신앙`, 'action');
    this.board[p.pos].piece = null;
    this.pending = null; this.sub = 'act';
    this.queue.unshift({ t: 'build', pos: p.pos });
    this._next(); this._emit(); return true;
  }
  skipDestroy() {
    if (!this.pending || this.pending.type !== 'destroy') return false;
    this.pending = null; this.sub = 'act'; this._next(); this._emit(); return true;
  }
  build(pieceId) {
    const p = this.pending; if (!p || p.type !== 'build') return false;
    if (!this.deck.includes(pieceId)) return false;
    const def = PIECES_BY_ID[pieceId];
    if (this.player.faith < def.cost) return false;
    this.player.faith -= def.cost;
    this.board[p.pos].piece = { owner: 'P', defId: pieceId, grade: 1 };
    this.addLog(`건설  칸 ${p.pos} ${def.name} G1 · ${def.cost} 신앙`, 'action');
    this.pending = null; this.sub = 'act'; this._next(); this._emit(); return true;
  }
  skipBuild() {
    if (!this.pending || this.pending.type !== 'build') return false;
    this.pending = null; this.sub = 'act'; this._next(); this._emit(); return true;
  }

  // ───────── 기물 효과 ─────────
  _pieceOnPlayerStep(cell) {
    const g = cell.piece.grade; const def = PIECES_BY_ID[cell.piece.defId];
    switch (def.id) {
      case 'well': { this.player.gauge = Math.min(TND.GAUGE, this.player.gauge + 2 * g); this.addLog(`${def.name} G${g} · 게이지 +${2 * g}칸 → ${this.player.gauge}`, 'calc'); break; }
      case 'altar': { this.player.faith += 1; this.addLog(`${def.name} G${g} · 신앙 +1`, 'calc'); break; }
      case 'beacon': {
        let n = 0;
        for (let d = -g; d <= g; d++) { if (d === 0) continue; const c = this.cellAt(cell.id + d); if (c.corrupt) { c.corrupt.counter += 2; n++; } }
        this.addLog(`${def.name} G${g} · 좌우 ${g}칸 타락 ${n}곳 카운터 +2`, 'calc'); break;
      }
      case 'purifier': { this.player.purifyCost = TND.PURIFY_START; this.addLog(`${def.name} G${g} · 정화 비용 1로 초기화`, 'calc'); break; }
      case 'road': { this.addLog(`${def.name} G${g} · 추가 ${g}칸 이동`, 'calc'); const up = this.queue.findIndex(q => q.t === 'upgrade'); this.queue.splice(up >= 0 ? up + 1 : 0, 0, { t: 'chain', n: g }); break; }
      case 'hall': { this.accBonus += 3 * g; this.addLog(`${def.name} G${g} · 다음 정산 누산기 +${3 * g}`, 'calc'); break; }
      case 'reliquary': { const b = g >= 4 ? 2 : 1; this.rerollBonus += b; this.addLog(`${def.name} G${g} · 다음 턴 재굴림 +${b}`, 'calc'); break; }
      default: this.addLog(`${def.name} G${g} · 플레이어 효과 없음`, 'calc');
    }
  }
  // 적이 내 기물을 밟음. 반환: 계속 진행 가능 여부
  _pieceOnEnemyStep(cell) {
    const g = cell.piece.grade; const N = this.myPieceCount(); const def = PIECES_BY_ID[cell.piece.defId];
    let x = 0;
    switch (def.id) {
      case 'well': case 'beacon': case 'purifier': case 'road': x = g; break;
      case 'grave': x = 1 + N; break;
      case 'altar': x = 2 * g + N; break;
      case 'hall': case 'reliquary': x = g + N; break;
      case 'sanctum': x = 3 * g + N; break;
      case 'taxman': x = g * N; break;
      case 'spire': x = g * g + N; break;
      case 'bell': { x = g; this.enemy.pos = ((this.enemy.pos - g) % TND.BOARD_SIZE + TND.BOARD_SIZE) % TND.BOARD_SIZE; this.addLog(`${def.name} G${g} · 적 말 ${g}칸 후퇴 → 칸 ${this.enemy.pos}`, 'calc'); break; }
      case 'gate': { x = g; this.enemyRollsLeft = 0; this.addLog(`${def.name} G${g} · 적의 남은 굴림 취소`, 'calc'); break; }
      case 'offering': {
        const max = Math.min(3 * g, this.player.faith);
        this.pending = { type: 'offering', pos: cell.id, max, grade: g }; this.sub = 'dialog';
        this.addLog(`적 밟음  칸 ${cell.id} ${def.name} G${g} · 최대 ${3 * g} 신앙 헌납 가능`, 'calc');
        return false;
      }
    }
    return this._deductEnemy(x, `적 밟음  칸 ${cell.id} ${def.name} G${g}`);
  }
  _deductEnemy(x, prefix) {
    if (x <= 0) return true;
    if (this.enemy.faith < x) {
      this.addLog(`${prefix} · 적 신앙 −${x} 필요, 잔량 ${this.enemy.faith}`, 'calc');
      this._finish('victory', '★ 적이 신앙을 지불하지 못했습니다. 승리.');
      return false;
    }
    this.enemy.faith -= x;
    this.addLog(`${prefix} · 적 신앙 −${x} (잔량 ${this.enemy.faith})`, 'calc');
    return true;
  }
  offeringPay(amount) {
    const p = this.pending; if (!p || p.type !== 'offering') return false;
    amount = Math.max(0, Math.min(p.max, Math.floor(amount)));
    this.pending = null; this.sub = 'enemy';
    if (amount > 0) {
      this.player.faith -= amount;
      this.addLog(`헌금함  ${amount} 신앙 헌납`, 'action');
      if (!this._deductEnemy(2 * amount, `헌금함 G${p.grade}`)) { this._emit(); return true; }
    } else this.addLog('헌금함  건너뜀', 'action');
    this._enemyContinue(); this._emit(); return true;
  }

  // ───────── 턴 종료 / 타락 ─────────
  _endPlayerTurn() {
    for (const cell of this.board) {
      if (!cell.corrupt) continue;
      cell.corrupt.counter -= 1;
      this.addLog(`타락  칸 ${cell.id} 카운터 ${cell.corrupt.counter + 1} → ${cell.corrupt.counter}`, 'action');
      if (cell.corrupt.counter <= 0) this._expireCorrupt(cell);
    }
    for (const d of this.dice) d.locked = false;
    this._enemyTurn();
  }
  _expireCorrupt(cell) {
    cell.corrupt = null;
    if (cell.piece && cell.piece.owner === 'P') {
      const def = PIECES_BY_ID[cell.piece.defId];
      this.addLog(`파괴됨  칸 ${cell.id} ${def.name} G${cell.piece.grade} (타락 만료)`, 'event');
      cell.piece = null;
    }
    if (cell.piece && cell.piece.owner === 'E') {
      const before = cell.piece.grade;
      cell.piece.grade = Math.min(TND.MAX_GRADE, before + 1);
      this.addLog(`타락 만료  칸 ${cell.id} · 사악한 기물 G${before} → G${cell.piece.grade}`, 'event');
    } else {
      cell.piece = { owner: 'E', grade: 1 };
      this.addLog(`타락 만료  칸 ${cell.id} · 사악한 기물 G1 건설`, 'event');
    }
  }
  _spawnCorruption(n) {
    const cands = this.board.filter(c => c.id !== TND.START_CELL && !c.corrupt);
    const placed = [];
    for (let k = 0; k < n && cands.length > 0; k++) {
      const idx = Math.floor(this.rng() * cands.length);
      const c = cands.splice(idx, 1)[0];
      c.corrupt = { counter: TND.CORRUPT_COUNTER };
      placed.push(c.id);
    }
    return placed;
  }

  // ───────── 적 턴 ─────────
  _enemyTurn() {
    if (this.phase !== 'trial') return;
    this.sub = 'enemy';
    this.enemyRollsLeft = TND.ENEMY_ROLLS;
    this.addLog(`── 턴 ${this.turn} · 적 ──`, 'action');
    this._enemyContinue();
  }
  _enemyContinue() {
    while (this.enemyRollsLeft > 0 && this.phase === 'trial' && !this.pending) {
      const pip = TND.ENEMY_DIE[Math.floor(this.rng() * TND.ENEMY_DIE.length)];
      this.enemy.faith += pip;
      const raw = this.enemy.pos + pip;
      this.enemy.pos = raw % TND.BOARD_SIZE;
      this.enemyRollsLeft -= 1;
      this.addLog(`적 굴림 [${pip}] · 신앙 +${pip} → 칸 ${this.enemy.pos} (적 신앙 ${this.enemy.faith})`, 'action');
      if (raw >= TND.BOARD_SIZE) {
        this.enemy.laps += 1;
        const n = TND.CORRUPT_PER_LAP === 'laps' ? this.enemy.laps : TND.CORRUPT_PER_LAP;
        const placed = this._spawnCorruption(n);
        this.addLog(`적 한 바퀴 (${this.enemy.laps}회) · 타락 ${placed.length}개 생성 → ${placed.map(c => `칸 ${c}`).join(', ') || '없음'}`, 'event');
      }
      const cell = this.board[this.enemy.pos];
      if (cell.corrupt) {
        cell.corrupt.counter -= 1;
        this.addLog(`적 밟음  칸 ${cell.id} 타락 · 카운터 −1 → ${cell.corrupt.counter}`, 'action');
        if (cell.corrupt.counter <= 0) this._expireCorrupt(cell);
        // 타락 칸의 내 기물은 무효 (묘지 제외)
        if (cell.piece && cell.piece.owner === 'P' && cell.piece.defId === 'grave') this._pieceOnEnemyStep(cell);
      } else if (cell.piece && cell.piece.owner === 'P') {
        this._pieceOnEnemyStep(cell);
      }
    }
    if (this.phase === 'trial' && !this.pending && this.enemyRollsLeft <= 0) this._startPlayerTurn();
  }

  // ───────── 테스트 훅 ─────────
  _forceUp(indices) { indices.forEach((up, i) => { if (this.dice[i]) this.dice[i].upIndex = up; }); }
}
