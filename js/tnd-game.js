// TnD 결합 데모 — 순수 게임 로직 (DOM 의존 없음). 기획안 결합 v2.1.
import { OPPOSITE, FACE_COUNT, condAllows } from './config.js';
import { mulberry32, faceState, layerMatches } from './game.js';
import {
  TND, MONSTERS, actionLabel, ENGRAVINGS_BY_ID, MOVE_MODE_LABEL,
  TND_SKILLS_BY_ID, PIECES_BY_ID, STARTER_BUILD, STARTER_DECK,
  ceil, upgradeCost, sellPrice, enemyPieceCost,
} from './tnd-config.js';

export { mulberry32 };
const N = TND.BOARD_SIZE;
const wrap = c => ((c % N) + N) % N;

let uid = 1;
export function makeInst(skillId) { return { uid: uid++, id: skillId, growth: 0, count: 0 }; }

// ── 스킬 효과 평가 (결합판). 발동하지 않으면 null.
export function evalEffectTnd(skill, ctx) {
  const add = n => ({ op: 'add', n }); const mul = n => ({ op: 'mul', n });
  const count = v => ctx.activePips.filter(p => p === v).length;
  switch (skill.kind) {
    case 'flat': return skill.op === 'add' ? add(skill.v) : mul(skill.v);
    case 'pip': return add(ctx.pip);
    case 'halfPip': return add(ceil(ctx.pip / 2));
    case 'oppSum': return add(ctx.upPip + ctx.pip);
    case 'symMult': return ctx.upPip === ctx.pip ? mul(skill.v) : null;
    case 'parityAll': return ctx.activePips.every(p => p % 2 === ctx.activePips[0] % 2) ? add(skill.v) : null;
    case 'pairActive': return ctx.activePips.some(p => count(p) >= 2) ? add(skill.v) : null;
    case 'runActive': { const s = new Set(ctx.activePips); for (let k = 1; k <= 4; k++) if (s.has(k) && s.has(k + 1) && s.has(k + 2)) return add(skill.v); return null; }
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
    case 'growAdd': case 'growStage': return add(skill.v + ctx.inst.growth);
    case 'growMult': return mul(skill.v + ctx.inst.growth);
    case 'perPiece': return add(skill.v * ctx.pieces);
    case 'perCorrupt': return add(skill.v * ctx.corrupts);
    case 'perEnemyPieceMult': return ctx.enemyPieces > 0 ? mul(Math.pow(skill.v, ctx.enemyPieces)) : null;
    case 'safeZone': return ctx.playerPos >= 1 && ctx.playerPos <= 8 ? add(skill.v) : null;
    default: return null;
  }
}

export const effPip = die => Math.min(6, die.faces[die.upIndex].pip + (die.pipBonus || 0));
const engrOf = die => die.engraving ? ENGRAVINGS_BY_ID[die.engraving] : null;

// 계산 순서: 서장 → (나머지, 정비 순서) → 종장
export function calcOrder(dice) {
  const idx = dice.map((_, i) => i);
  const key = i => { const e = engrOf(dice[i]); return e?.id === 'seojang' ? -1 : e?.id === 'jongjang' ? 1 : 0; };
  return idx.sort((a, b) => key(a) - key(b) || a - b);
}

// ── 신앙치 계산 (순수 함수, 매 단계 올림). 프리뷰와 정산이 공유.
export function calcFaithPoints(dice, ctx) {
  const order = calcOrder(dice);
  const activePips = dice.map(effPip);
  const lines = []; const growthEvents = [];
  let S = ctx.accBonus || 0;
  dice.forEach((d, i) => {
    const e = engrOf(d);
    const noActiveSkill = !d.faces[d.upIndex].skill;
    if (e?.id === 'heonsin' && noActiveSkill) { S += activePips[i] * 3; lines.push({ text: `[${'①②③'[i]}] 헌신 · 눈 ${activePips[i]} ×3`, type: 'calc' }); }
    else S += activePips[i];
  });
  lines.unshift({ text: `기본 눈합  ${S}${ctx.accBonus ? ` (회당 +${ctx.accBonus})` : ''}`, type: 'calc' });
  const lockedCount = dice.filter(d => d.locked).length;
  order.forEach((di, orderIndex) => {
    const die = dice[di]; const e = engrOf(die);
    const upPip = activePips[di];
    const faceOrder = [die.upIndex, OPPOSITE[die.upIndex], ...die.faces.map((_, f) => f).filter(f => f !== die.upIndex && f !== OPPOSITE[die.upIndex])];
    for (const f of faceOrder) {
      const inst = die.faces[f].skill; if (!inst) continue;
      const skill = TND_SKILLS_BY_ID[inst.id];
      const st = faceState(f, die.upIndex);
      if (!layerMatches(skill.layer, st)) continue;
      let eff = evalEffectTnd(skill, { S, activePips, upPip, pip: die.faces[f].pip, orderIndex, orderCount: dice.length, lockedCount, rerollsLeft: ctx.rerollsLeft, pieces: ctx.pieces, corrupts: ctx.corrupts, enemyPieces: ctx.enemyPieces, playerPos: ctx.playerPos, inst });
      if (!eff) continue;
      let note = '';
      if (e?.id === 'gongheo' && st !== 'active') { eff = eff.op === 'add' ? { op: 'add', n: eff.n * 2 } : { op: 'mul', n: eff.n * eff.n }; note = ' (공허 ×2)'; }
      S = ceil(eff.op === 'add' ? S + eff.n : S * eff.n);
      lines.push({ text: `[${di + 1}번·F${f + 1}] ${skill.name}  ${eff.op === 'add' ? '+' : '×'}${fmtN(eff.n)}${note}  →  ${S}`, type: eff.op });
      if (skill.kind === 'growCount') growthEvents.push({ uid: inst.uid, field: 'count', delta: 1 });
      if (skill.kind === 'growAdd' || skill.kind === 'growMult') growthEvents.push({ uid: inst.uid, field: 'growth', delta: skill.step });
    }
    if (e?.id === 'jjakheart' && upPip % 2 === 0) { S = ceil(S * 1.2); lines.push({ text: `[${'①②③'[di]}] 짝의 심장  ×1.2  →  ${S}`, type: 'mul' }); }
  });
  return { total: S, lines, growthEvents };
}
function fmtN(n) { return Number.isInteger(n) ? String(n) : (Math.round(n * 1000) / 1000).toString(); }

export function convert(points, gauge, { minGauge = 0 } = {}) {
  let faith = 0, combo = 0, fills = 0, guard = 0;
  while (points > 0 && guard++ < 10000) {
    const need = TND.GAUGE - gauge;
    if (points >= need) { points -= need; faith += 1; fills += 1; if (fills >= 2) combo = Math.min(TND.COMBO_MAX, combo + 1); gauge = Math.max(combo, minGauge); }
    else { gauge += points; points = 0; }
  }
  return { faith, gauge, fills, combo };
}

// ── 이동 해석 (순수 함수): 방식에 따른 경유(밟음)/도착(멈춤) 집합. 프리뷰와 실제 이동이 공유.
// 반환 { path:[{cell, pass, stop}], to, crossings, extended }
export function resolveMove(board, from, n, mode, opts = {}) {
  const build = (dist) => {
    const path = [];
    for (let k = 1; k <= dist; k++) {
      const cell = wrap(from + k); const last = k === dist;
      let pass = false, stop = false;
      if (mode === 'basic') { pass = true; stop = last; }
      else if (mode === 'teleport') { pass = last; stop = last; }
      else if (mode === 'jump') { pass = k % 2 === 0 || last; stop = last; }
      else if (mode === 'slow') { pass = true; stop = true; }
      path.push({ cell, pass, stop });
    }
    return path;
  };
  let dist = n; let path = build(dist); let extended = false;
  if (opts.signpost && mode !== 'stealth') { // 이정표: 밟은 첫 이정표가 거리 +1 (이동당 1회)
    const hit = path.find(p => p.pass && board[p.cell].piece?.owner === 'P' && board[p.cell].piece.defId === 'signpost' && !board[p.cell].corrupt);
    if (hit) { dist += 1; path = build(dist); extended = true; }
  }
  return { path, to: wrap(from + dist), crossings: Math.floor((from + dist) / N), extended };
}

// 몬스터 이동 (기본 방식 + 비행 기믹): 시작칸에 닿는 걸음이 즉시 landAt 칸으로
export function resolveEnemyMove(from, n, monsterDef) {
  const fly = (monsterDef.gimmicks || []).find(g => g.t === 'flyover');
  const path = []; let cur = from;
  for (let k = 1; k <= n; k++) {
    let next = wrap(cur + 1); let assault = false;
    if (next === TND.START_CELL) { assault = true; if (fly) next = fly.landAt; }
    else if (fly && next >= fly.from && next <= fly.to) next = fly.landAt; // 비행 구간은 절대 밟지 않는다
    path.push({ cell: next, pass: true, stop: k === n, assault });
    cur = next;
  }
  return { path, to: cur };
}

const emptyCell = id => ({ id, piece: null, corrupt: null, safe: id >= 1 && id <= 8 });

export class TndGame {
  constructor({ rng, monster } = {}) {
    this.rng = rng || Math.random;
    // 몬스터는 데이터: 키(MONSTERS) 또는 정의 객체를 직접 넘길 수 있다
    this.monsterDef = typeof monster === 'object' && monster ? monster : MONSTERS[monster || TND.MONSTER];
    this.onChange = null; this.log = [];
    this.dice = Array.from({ length: TND.DICE }, () => ({
      faces: Array.from({ length: FACE_COUNT }, (_, f) => ({ pip: f + 1, skill: null })),
      engraving: null, upIndex: 0, locked: false, pipBonus: 0, lastUp: null,
    }));
    for (const [d, faces] of Object.entries(STARTER_BUILD)) for (const [f, id] of Object.entries(faces)) this.dice[d].faces[f].skill = makeInst(id);
    this.deck = [...STARTER_DECK];
    this.phase = 'prep'; this.sub = null; this.pending = null; this.result = null; this.queue = [];
    this.selectedDie = null; this.selectedFace = null; this.selectedSkill = null; this.selectedEngraving = null;
    this.board = []; this.player = null; this.monster = null; this.turn = 0;
  }
  _emit() { if (this.onChange) this.onChange(); }
  addLog(text, type = 'action') { this.log.push({ text, type }); if (this.log.length > 1500) this.log.splice(0, this.log.length - 1500); }

  // ───────── 조회 ─────────
  activePip(die) { return effPip(die); }
  currentPips() { return this.dice.map(effPip); }
  allInstances() { const a = []; for (const d of this.dice) for (const f of d.faces) if (f.skill) a.push(f.skill); return a; }
  equippedSkillIds() { return new Set(this.allInstances().map(i => i.id)); }
  equippedEngravingIds() { return new Set(this.dice.map(d => d.engraving).filter(Boolean)); }
  myPieces() { return this.board.filter(c => c.piece && c.piece.owner === 'P'); }
  myPieceCount() { return this.myPieces().length; }
  enemyPieceCount() { return this.board.filter(c => c.piece && c.piece.owner === 'E').length; }
  corruptCount() { return this.board.filter(c => c.corrupt).length; }
  cellAt(id) { return this.board[wrap(id)]; }
  finalEnemyCost(cell) { return enemyPieceCost(cell.piece.grade, this.enemyPieceCount()); }
  totalSellable() { return this.myPieces().reduce((s, c) => s + sellPrice(PIECES_BY_ID[c.piece.defId], c.piece.grade), 0); }
  hasAura(defId) { return this.myPieces().some(c => c.piece.defId === defId && !c.corrupt); }
  // 유효 등급: 신전 오라 +2, 축복(이번 구간) +1
  effGrade(cell, chukbok = false) {
    const t = this.myPieces().find(c => c.piece.defId === 'temple' && !c.corrupt);
    return Math.min(TND.MAX_GRADE, cell.piece.grade + (t && cell.piece.defId !== 'temple' ? 2 : 0) + (chukbok ? 1 : 0));
  }
  auraMult(cell) { // 대성당 오라: 좌우 2칸
    for (let d = -2; d <= 2; d++) { if (d === 0) continue; const c = this.cellAt(cell.id + d); if (c.piece?.owner === 'P' && c.piece.defId === 'cathedral' && !c.corrupt) return 2; }
    return 1;
  }
  nextAssaultCost() { const a = this.monsterDef.assault; return a[Math.min(this.monster.laps, a.length - 1)]; }
  nextAction() { const p = this.monsterDef.pattern; const s = this.monster.skipNext ? (this.monster.step + 1) % p.length : this.monster.step; return { step: s, action: p[s] }; }
  // 적 의도: 다음 행동과 (이동이면) 경유·도착 칸
  intent() {
    if (this.phase !== 'trial') return null;
    const { step, action } = this.nextAction();
    const after = this.monsterDef.pattern[(step + 1) % this.monsterDef.pattern.length];
    const r = action.t === 'move' ? resolveEnemyMove(this.monster.pos, action.n, this.monsterDef) : null;
    return { step, action, after, path: r ? r.path : [], to: r ? r.to : null, skipping: this.monster.skipNext };
  }

  // ───────── 정비 ─────────
  selectDie(i) { if (this.phase !== 'prep') return false; this.selectedDie = i; this.selectedFace = null; this._emit(); return true; }
  selectFace(f) { if (this.phase !== 'prep' || this.selectedDie === null) return false; this.selectedFace = f; this._emit(); return true; }
  selectSkill(id) { if (this.phase !== 'prep') return false; this.selectedSkill = this.selectedSkill === id ? null : id; this.selectedEngraving = null; this._emit(); return true; }
  selectEngraving(id) { if (this.phase !== 'prep') return false; this.selectedEngraving = this.selectedEngraving === id ? null : id; this.selectedSkill = null; this._emit(); return true; }
  canEquip(skillId, d, f) {
    const skill = TND_SKILLS_BY_ID[skillId];
    if (!skill || this.phase !== 'prep' || this.equippedSkillIds().has(skillId)) return false;
    return condAllows(skill.cond, this.dice[d].faces[f].pip);
  }
  equip(skillId, d, f) { if (!this.canEquip(skillId, d, f)) return false; this.dice[d].faces[f].skill = makeInst(skillId); this.selectedSkill = null; this._emit(); return true; }
  unequip(d, f) { if (this.phase !== 'prep' || !this.dice[d]?.faces[f]?.skill) return false; this.dice[d].faces[f].skill = null; this._emit(); return true; }
  canEngrave(id, d) { return this.phase === 'prep' && !!ENGRAVINGS_BY_ID[id] && !this.equippedEngravingIds().has(id) && !!this.dice[d]; }
  engrave(id, d) { if (!this.canEngrave(id, d)) return false; this.dice[d].engraving = id; this.selectedEngraving = null; this._emit(); return true; }
  unengrave(d) { if (this.phase !== 'prep' || !this.dice[d]?.engraving) return false; this.dice[d].engraving = null; this._emit(); return true; }
  changePip(d, f, delta) {
    if (this.phase !== 'prep' || Math.abs(delta) !== 1) return false;
    const face = this.dice[d].faces[f]; const next = face.pip + delta;
    if (next < 1 || next > 6) return false;
    face.pip = next;
    if (face.skill && !condAllows(TND_SKILLS_BY_ID[face.skill.id].cond, next)) face.skill = null;
    this._emit(); return true;
  }
  moveDie(i, delta) {
    if (this.phase !== 'prep') return false;
    const j = i + delta; if (j < 0 || j >= this.dice.length || Math.abs(delta) !== 1) return false;
    [this.dice[i], this.dice[j]] = [this.dice[j], this.dice[i]];
    if (this.selectedDie === i) this.selectedDie = j; else if (this.selectedDie === j) this.selectedDie = i;
    this._emit(); return true;
  }
  deckAdd(id) { if (this.phase !== 'prep' || !PIECES_BY_ID[id] || this.deck.length >= TND.DECK_SIZE) return false; this.deck.push(id); this._emit(); return true; }
  deckRemove(slot) { if (this.phase !== 'prep' || slot < 0 || slot >= this.deck.length) return false; this.deck.splice(slot, 1); this._emit(); return true; }
  canStart() { return this.phase === 'prep' && this.deck.length === TND.DECK_SIZE; }

  // ───────── 고행 시작/종료 ─────────
  startTrial() {
    if (!this.canStart()) return false;
    this.board = Array.from({ length: N }, (_, i) => emptyCell(i));
    this.player = { pos: 0, faith: TND.PLAYER_START_FAITH, gauge: 0, purifyCost: TND.PURIFY_START, laps: 0, stoppedAt: [] };
    this.monster = { pos: 0, faith: this.monsterDef.faith, laps: 0, step: 0, skipNext: false };
    for (const inst of this.allInstances()) { inst.growth = 0; inst.count = 0; }
    for (const d of this.dice) { d.locked = false; d.pipBonus = 0; d.lastUp = null; }
    this.turn = 0; this.result = null; this.pending = null; this.queue = []; this.log = [];
    this.rerollBonus = 0; this.accBonus = 0; this.usedDice = []; this.segment = null;
    this.phase = 'trial';
    this.addLog(`━━ 고행 시작 — ${this.monsterDef.name} (신앙 ${this.monsterDef.faith}) ━━`, 'event');
    this._startPlayerTurn(); this._emit(); return true;
  }
  backToPrep() {
    if (this.phase !== 'end') return false;
    this.phase = 'prep'; this.sub = null; this.pending = null;
    for (const d of this.dice) { d.locked = false; d.pipBonus = 0; }
    this.selectedDie = null; this.selectedFace = null; this.selectedSkill = null; this.selectedEngraving = null;
    this._emit(); return true;
  }
  _finish(result, text) { this.result = result; this.phase = 'end'; this.sub = null; this.pending = null; this.queue = []; this.addLog(text, 'decision'); }

  // ───────── 플레이어 턴: 굴림 ─────────
  _startPlayerTurn() {
    this.turn += 1; this.sub = 'roll'; this.usedDice = []; this.segment = null; this.player.stoppedAt = [];
    this.rollsLeft = TND.ROLLS_PER_TURN + this.rerollBonus;
    if (this.rerollBonus) this.addLog(`성물함 효과 — 이번 턴 재굴림 +${this.rerollBonus}`, 'calc');
    this.rerollBonus = 0; this.rollNo = 1;
    this.addLog(`── 턴 ${this.turn} · 플레이어 ──`, 'action');
    const temple = this.myPieces().find(c => c.piece.defId === 'temple' && !c.corrupt);
    if (temple) { const g = 10 * temple.piece.grade; this.player.faith += g; this.addLog(`신전 오라 · 턴 시작 신앙 +${g}`, 'calc'); }
    // 인내: 잠긴 채 넘어온 주사위는 굴리지 않고 눈 +1
    this.dice.forEach((d, i) => {
      if (d.locked && engrOf(d)?.id === 'innae') { d.pipBonus = Math.min(6 - d.faces[d.upIndex].pip, d.pipBonus + 1); this.addLog(`[${'①②③'[i]}] 인내 · 잠긴 채 유지, 눈 +${d.pipBonus} → ${effPip(d)}`, 'calc'); }
      else d.locked = false;
    });
    this._rollUnlocked(false);
    this.rollsLeft -= 1;
    const t = this.intent();
    this.addLog(`▶ ${this.monsterDef.name} 의도: ${actionLabel(t.action)}${t.to !== null ? ` → 도착 ${t.to}` : ''}`, 'event');
  }
  _rollDie(die, isReroll, idx) {
    const e = engrOf(die); const pick = () => Math.floor(this.rng() * FACE_COUNT);
    let up = pick(); let note = '';
    if (e?.id === 'jaedo') { const b = pick(); if (die.faces[b].pip > die.faces[up].pip) up = b; note = ' (재도)'; }
    if (e?.id === 'bulgul' && die.faces[up].pip === 1) { up = pick(); note = ' (불굴: 1 → 재굴림)'; }
    if (e?.id === 'gyunhyeong' && isReroll && die.lastUp !== null) { let g = 0; while (up === die.lastUp && g++ < 30) up = pick(); note = ' (균형)'; }
    die.upIndex = up; die.pipBonus = 0; die.lastUp = up;
    if (note) this.addLog(`[${'①②③'[idx]}] ${e.name}${note}`, 'calc');
  }
  _rollUnlocked(isReroll) {
    this.dice.forEach((d, i) => { if (!d.locked) this._rollDie(d, isReroll, i); });
    this.addLog(`굴림 ${this.rollNo}  [${this.currentPips().join('] [')}]`, 'action');
  }
  toggleLock(i) {
    if (this.phase !== 'trial' || this.sub !== 'roll' || !this.dice[i]) return false;
    this.dice[i].locked = !this.dice[i].locked;
    this.addLog(`${this.dice[i].locked ? '잠금' : '잠금 해제'}  ${'①②③'[i]}`, 'action'); this._emit(); return true;
  }
  reroll() {
    if (this.phase !== 'trial' || this.sub !== 'roll' || this.rollsLeft <= 0) return false;
    if (this.dice.every(d => d.locked)) { this.addLog('모든 주사위가 잠겨 있어 굴릴 수 없습니다.', 'calc'); return false; }
    this.rollNo += 1; this._rollUnlocked(true); this.rollsLeft -= 1; this._emit(); return true;
  }
  _calcCtx() { return { accBonus: this.accBonus, rerollsLeft: this.rollsLeft, pieces: this.myPieceCount(), corrupts: this.corruptCount(), enemyPieces: this.enemyPieceCount(), playerPos: this.player.pos }; }
  preview() {
    if (this.phase !== 'trial' || this.sub !== 'roll') return null;
    const r = calcFaithPoints(this.dice, this._calcCtx());
    const grail = this.hasAura('grail');
    const c = convert(r.total, grail ? 9 : this.player.gauge, { minGauge: grail ? 9 : 0 });
    return { points: r.total, faith: c.faith, gauge: c.gauge };
  }
  confirm() {
    if (this.phase !== 'trial' || this.sub !== 'roll') return false;
    const r = calcFaithPoints(this.dice, this._calcCtx());
    const byUid = new Map(this.allInstances().map(i => [i.uid, i]));
    for (const ev of r.growthEvents) { const inst = byUid.get(ev.uid); if (inst) inst[ev.field] = Math.round((inst[ev.field] + ev.delta) * 10) / 10; }
    this.accBonus = 0;
    this.addLog('── 정산 ──', 'action');
    for (const l of r.lines) this.addLog(l.text, l.type);
    this.addLog(`신앙치 ${r.total}`, 'calc');
    const grail = this.hasAura('grail');
    const c = convert(r.total, grail ? 9 : this.player.gauge, { minGauge: grail ? 9 : 0 });
    this.player.gauge = c.gauge;
    this.player.faith += c.faith;
    this.addLog(`게이지 충전 ×${c.fills} · 콤보 ${c.combo} · 신앙 +${c.faith}${grail ? ' (성배: 잔량 9 고정)' : ''}`, 'calc');
    this.addLog(`신앙 ${this.player.faith} (+${c.faith}) · 게이지 잔량 ${this.player.gauge}`, 'calc');
    this.sub = 'act'; this._emit(); return true;
  }

  // ───────── 행동 단계: 구간 이동 ─────────
  moveModeOf(die) { const e = engrOf(die); return { mode: e?.moveMode || 'basic', extra: e?.extra || 0 }; }
  // 프리뷰: 현재 위치 기준 이 주사위 구간의 경유/도착 (실제 이동과 같은 함수)
  previewSegment(i) {
    if (this.phase !== 'trial' || this.sub !== 'act' || this.usedDice.includes(i)) return null;
    const die = this.dice[i]; const { mode, extra } = this.moveModeOf(die);
    return { die: i, mode, ...resolveMove(this.board, this.player.pos, effPip(die) + extra, mode, { signpost: true }) };
  }
  // 경로 계획: 남은 주사위의 모든 순열로 도달 가능한 멈춤 칸
  routePlan() {
    if (this.phase !== 'trial' || this.sub !== 'act') return [];
    const rest = this.dice.map((_, i) => i).filter(i => !this.usedDice.includes(i));
    const stops = new Set();
    const rec = (pos, remaining) => {
      for (const i of remaining) {
        const { mode, extra } = this.moveModeOf(this.dice[i]);
        const r = resolveMove(this.board, pos, effPip(this.dice[i]) + extra, mode, { signpost: true });
        for (const p of r.path) if (p.stop) stops.add(p.cell);
        rec(r.to, remaining.filter(x => x !== i));
      }
    };
    rec(this.player.pos, rest);
    return [...stops];
  }
  chooseMoveDie(i) {
    if (this.phase !== 'trial' || this.sub !== 'act' || !this.dice[i] || this.usedDice.includes(i)) return false;
    const die = this.dice[i]; const e = engrOf(die); const { mode, extra } = this.moveModeOf(die);
    const r = resolveMove(this.board, this.player.pos, effPip(die) + extra, mode, { signpost: true });
    this.usedDice.push(i);
    const segNo = this.usedDice.length;
    this.segment = { die: i, mode, chukbok: e?.id === 'chukbok', holy: e?.id === 'jeonghwabal', gaecheok: e?.id === 'gaecheok', jingsu: e?.id === 'jingsu', fold: [], no: segNo };
    this.addLog(`이동 ${segNo}/3  ${'①②③'[i]}${e ? e.name : ''}(${MOVE_MODE_LABEL[mode]}) [${effPip(die)}${extra ? `+${extra}` : ''}]${r.extended ? ' · 이정표 +1' : ''} → 칸 ${r.to}`, 'action');
    if (r.crossings > 0) this._playerLaps(r.crossings);
    this.queue = [...r.path.map(step => ({ t: 'step', step })), { t: 'segEnd' }];
    this._next(); this._emit(); return true;
  }
  _playerLaps(k) {
    for (let n = 0; n < k; n++) {
      this.player.laps += 1;
      for (const inst of this.allInstances()) { const s = TND_SKILLS_BY_ID[inst.id]; if (s.kind === 'growStage') inst.growth += s.step; }
      this.addLog(`내 말 한 바퀴 (${this.player.laps}회)`, 'event');
    }
  }
  _flushFold() {
    const f = this.segment?.fold; if (!f || f.length === 0) return;
    this.addLog(`밟음  칸 ${f.length === 1 ? f[0] : `${f[0]}~${f[f.length - 1]}`} (효과 없음)`, 'calc');
    this.segment.fold = [];
  }
  // 상호작용 큐. 대화창이 필요하면 pending을 세우고 멈춘다.
  _next() {
    while (this.queue.length > 0 && this.phase === 'trial') {
      const item = this.queue.shift();
      const cell = item.pos !== undefined ? this.board[item.pos] : item.step ? this.board[item.step.cell] : null;
      switch (item.t) {
        case 'step': {
          const { step } = item; this.player.pos = step.cell;
          if (step.pass) {
            const effect = this._myPass(cell);
            if (!effect) this.segment.fold.push(step.cell); else this._flushFold();
          }
          if (step.stop) {
            this._flushFold();
            this.player.stoppedAt.push(step.cell);
            const items = [];
            if (cell.piece?.owner === 'E') items.push({ t: 'pay', pos: cell.id });
            if (cell.corrupt) items.push({ t: 'purify', pos: cell.id });
            if (cell.piece?.owner === 'P') items.push({ t: 'myStop', pos: cell.id });
            if (cell.piece?.owner === 'E') items.push({ t: 'destroy', pos: cell.id });
            if (!cell.piece && cell.id !== TND.START_CELL) items.push({ t: 'build', pos: cell.id });
            if (!cell.piece && !cell.corrupt) this.addLog(`멈춤 ${this.segment.no}/3  칸 ${cell.id} · ${cell.id === 0 ? '시작칸' : '빈 칸'}`, 'action');
            this.queue.unshift(...items);
          }
          break;
        }
        case 'pay': {
          if (cell.piece?.owner !== 'E') break;
          let cost = this.finalEnemyCost(cell); let note = '';
          if (this.segment?.jingsu) { cost = ceil(cost / 2); note = ' (징수: 절반)'; }
          this.addLog(`멈춤 ${this.segment.no}/3  칸 ${cell.id} · 사악한 기물 G${cell.piece.grade} · 강제지불 ${cost}${note}`, 'event');
          this.pending = { type: 'pay', pos: cell.id, cost }; this.sub = 'dialog'; return;
        }
        case 'purify': {
          if (!cell.corrupt) break;
          if (this.segment?.holy) { cell.corrupt.counter += 2; this.addLog(`[${'①②③'[this.segment.die]}] 정화의 발걸음 · 칸 ${cell.id} 타락 카운터 +2 → ${cell.corrupt.counter}`, 'calc'); }
          this.addLog(`멈춤 ${this.segment.no}/3  칸 ${cell.id} · 타락 (카운터 ${cell.corrupt.counter})`, 'action');
          this.pending = { type: 'purify', pos: cell.id, cost: this.player.purifyCost }; this.sub = 'dialog'; return;
        }
        case 'myStop': {
          if (cell.piece?.owner !== 'P') break;
          const def = PIECES_BY_ID[cell.piece.defId];
          this.addLog(`멈춤 ${this.segment.no}/3  칸 ${cell.id} · 내 기물 ${def.name} G${cell.piece.grade}`, 'action');
          if (cell.corrupt) { this.addLog(`${def.name} 효과 무효 (타락 칸)`, 'calc'); break; }
          this._myStop(cell); break;
        }
        case 'destroy': {
          if (cell.piece?.owner !== 'E') break;
          this.pending = { type: 'destroy', pos: cell.id, cost: ceil(this.finalEnemyCost(cell) * TND.DESTROY_MULT), grade: cell.piece.grade }; this.sub = 'dialog'; return;
        }
        case 'build': {
          if (cell.piece || cell.corrupt || cell.id === TND.START_CELL) break;
          this.pending = { type: 'build', pos: cell.id, discount: this.segment?.gaecheok ? 0.3 : 0 }; this.sub = 'dialog'; return;
        }
        case 'chain': { // 순례길: 기본 방식으로 G칸 추가 이동
          const r = resolveMove(this.board, this.player.pos, item.n, 'basic', { signpost: true });
          this.addLog(`순례길  +${item.n}칸 → 칸 ${r.to}`, 'action');
          if (r.crossings > 0) this._playerLaps(r.crossings);
          this.queue.unshift(...r.path.map(step => ({ t: 'step', step })));
          break;
        }
        case 'segEnd': {
          this._flushFold();
          if (this.usedDice.length >= this.dice.length) {
            const total = this.dice.reduce((s, d, i) => s + effPip(d) + (this.moveModeOf(d).extra || 0), 0);
            this.addLog(`이동 완료 · 턴 이동 합 ${total} · 현재 칸 ${this.player.pos}`, 'action');
            this.sub = 'build'; this.segment = null;
          } else { this.sub = 'act'; this.segment = null; }
          return;
        }
      }
    }
  }

  // ───────── 대화창 응답 ─────────
  _resume() { if (this.pending) return; if (this.sub === 'enemy') this._enemyContinue(); else { this.sub = 'act'; this._next(); } }
  canPay() { return !!this.pending && (this.pending.type === 'pay' || this.pending.type === 'assault') && this.player.faith >= this.pending.cost; }
  mustGiveUp() { return !!this.pending && (this.pending.type === 'pay' || this.pending.type === 'assault') && this.player.faith + this.totalSellable() < this.pending.cost; }
  payConfirm() {
    const p = this.pending; if (!p || (p.type !== 'pay' && p.type !== 'assault') || this.player.faith < p.cost) return false;
    this.player.faith -= p.cost;
    if (p.type === 'assault') { this.addLog(`강습!  바퀴 ${this.monster.laps} · ${p.cost} 신앙 지불 (잔여 ${this.player.faith})`, 'event'); this.pending = null; this.sub = 'enemy'; this._enemyContinue(); }
    else { this.addLog(`강제지불  사악한 기물 G${this.board[p.pos].piece.grade} · ${p.cost} 신앙 (잔여 ${this.player.faith})`, 'event'); this.pending = null; this._resume(); }
    this._emit(); return true;
  }
  sellPiece(pos) {
    const cell = this.board[pos];
    if (!this.pending || (this.pending.type !== 'pay' && this.pending.type !== 'assault') || cell.piece?.owner !== 'P') return false;
    const def = PIECES_BY_ID[cell.piece.defId]; const grade = cell.piece.grade; const price = sellPrice(def, grade);
    this.player.faith += price; cell.piece = null;
    this.addLog(`판매  칸 ${pos} ${def.name} G${grade} · +${price} 신앙`, 'action');
    this._emit(); return true;
  }
  giveUp() {
    const p = this.pending; if (!p || (p.type !== 'pay' && p.type !== 'assault')) return false;
    this._finish('defeat', p.type === 'assault' ? `✕ 강습 비용 ${p.cost} · 지불 불가. 패배.` : '✕ 강제지불 불가. 패배.');
    this._emit(); return true;
  }
  purify() {
    const p = this.pending; if (!p || p.type !== 'purify' || this.player.faith < p.cost) return false;
    this.player.faith -= p.cost; this.board[p.pos].corrupt = null; this.player.purifyCost += TND.PURIFY_STEP;
    this.addLog(`정화  칸 ${p.pos} · ${p.cost} 신앙 (다음 정화 비용 ${this.player.purifyCost})`, 'action');
    this.pending = null;
    const cell = this.board[p.pos];
    if (!cell.piece && !this.queue.some(q => q.t === 'build' && q.pos === p.pos)) this.queue.unshift({ t: 'build', pos: p.pos });
    this._resume(); this._emit(); return true;
  }
  skipPurify() { if (!this.pending || this.pending.type !== 'purify') return false; this.pending = null; this._resume(); this._emit(); return true; }
  destroy() {
    const p = this.pending; if (!p || p.type !== 'destroy' || this.player.faith < p.cost) return false;
    this.player.faith -= p.cost; this.board[p.pos].piece = null;
    this.addLog(`파괴  칸 ${p.pos} 사악한 기물 G${p.grade} · ${p.cost} 신앙`, 'action');
    this.pending = null; this.queue.unshift({ t: 'build', pos: p.pos }); this._resume(); this._emit(); return true;
  }
  skipDestroy() { if (!this.pending || this.pending.type !== 'destroy') return false; this.pending = null; this._resume(); this._emit(); return true; }
  buildCost(pieceId) { const d = this.pending?.discount || 0; return ceil(PIECES_BY_ID[pieceId].cost * (1 - d)); }
  build(pieceId) {
    const p = this.pending; if (!p || p.type !== 'build' || !this.deck.includes(pieceId)) return false;
    const cost = this.buildCost(pieceId); if (this.player.faith < cost) return false;
    this.player.faith -= cost; this.board[p.pos].piece = { owner: 'P', defId: pieceId, grade: 1 };
    this.addLog(`건설  칸 ${p.pos} ${PIECES_BY_ID[pieceId].name} G1 · ${cost} 신앙${p.discount ? ' (개척 −30%)' : ''}`, 'action');
    this.pending = null; this._resume(); this._emit(); return true;
  }
  skipBuild() { if (!this.pending || this.pending.type !== 'build') return false; this.pending = null; this._resume(); this._emit(); return true; }

  // ───────── 건설 단계: 원격 업그레이드 · 턴 종료 ─────────
  upgradeInfo(pos) {
    const cell = this.board[pos]; if (cell?.piece?.owner !== 'P') return null;
    const def = PIECES_BY_ID[cell.piece.defId]; const stopped = this.player.stoppedAt.includes(pos);
    return { pos, name: def.name, grade: cell.piece.grade, perLevel: upgradeCost(def, stopped), stopped };
  }
  upgradePiece(pos, target) {
    if (this.phase !== 'trial' || this.sub !== 'build') return false;
    const info = this.upgradeInfo(pos); if (!info) return false;
    const levels = target - info.grade; if (levels < 1 || target > TND.MAX_GRADE) return false;
    const total = levels * info.perLevel; if (this.player.faith < total) return false;
    this.player.faith -= total; this.board[pos].piece.grade = target;
    this.addLog(`업그레이드  칸 ${pos} ${info.name} G${info.grade} → G${target} · ${total} 신앙${info.stopped ? ' (멈춘 칸 반값)' : ''}`, 'action');
    this._emit(); return true;
  }
  endTurn() {
    if (this.phase !== 'trial' || this.sub !== 'build') return false;
    this._endPlayerTurn(); this._emit(); return true;
  }
  _endPlayerTurn() {
    for (const cell of this.board) {
      if (!cell.corrupt) continue;
      cell.corrupt.counter -= 1;
      this.addLog(`타락  칸 ${cell.id} 카운터 ${cell.corrupt.counter + 1} → ${cell.corrupt.counter}`, 'action');
      if (cell.corrupt.counter <= 0) this._expireCorrupt(cell);
    }
    for (const d of this.dice) if (!(d.locked && engrOf(d)?.id === 'innae')) d.locked = false; // 인내: 잠금 유지
    this._enemyTurn();
  }

  // ───────── 기물 효과 ─────────
  _myPass(cell) { // 반환: 효과가 있었는가
    if (cell.piece?.owner !== 'P' || cell.corrupt) return false;
    const def = PIECES_BY_ID[cell.piece.defId]; const g = this.effGrade(cell, this.segment?.chukbok); const m = this.auraMult(cell);
    switch (def.id) {
      case 'well': { const n = g * m; this.player.gauge = Math.min(TND.GAUGE, this.player.gauge + n); this.addLog(`밟음  칸 ${cell.id} ${def.name} G${g} · 게이지 +${n} → ${this.player.gauge}`, 'calc'); return true; }
      case 'signpost': { this.addLog(`밟음  칸 ${cell.id} ${def.name} G${g} · 이번 이동 거리 +1`, 'calc'); return true; }
      case 'beacon': { let n = 0; for (let d = -g; d <= g; d++) { if (d === 0) continue; const c = this.cellAt(cell.id + d); if (c.corrupt) { c.corrupt.counter += 1 * m; n++; } } this.addLog(`밟음  칸 ${cell.id} ${def.name} G${g} · 좌우 ${g}칸 타락 ${n}곳 카운터 +${m}`, 'calc'); return true; }
      default: return false;
    }
  }
  _myStop(cell) {
    const def = PIECES_BY_ID[cell.piece.defId]; const g = this.effGrade(cell, this.segment?.chukbok); const m = this.auraMult(cell);
    switch (def.id) {
      case 'altar': { this.player.faith += m; this.addLog(`${def.name} G${g} · 신앙 +${m}`, 'calc'); break; }
      case 'well': { const n = 3 * g * m; this.player.gauge = Math.min(TND.GAUGE, this.player.gauge + n); this.addLog(`${def.name} G${g} · 게이지 +${n} → ${this.player.gauge}`, 'calc'); break; }
      case 'purifier': { this.player.purifyCost = TND.PURIFY_START; let n = 0; for (let d = -g; d <= g; d++) { const c = this.cellAt(cell.id + d); if (c.corrupt) { c.corrupt = null; n++; } } this.addLog(`${def.name} G${g} · 정화 비용 1로 초기화, 좌우 ${g}칸 타락 ${n}곳 제거`, 'calc'); break; }
      case 'hall': { const n = 5 * g * m; this.accBonus += n; this.addLog(`${def.name} G${g} · 다음 정산 누산기 +${n}`, 'calc'); break; }
      case 'reliquary': { const n = g * m; this.rerollBonus += n; this.addLog(`${def.name} G${g} · 다음 턴 재굴림 +${n}`, 'calc'); break; }
      case 'road': { this.addLog(`${def.name} G${g} · 즉시 ${g}칸 추가 이동`, 'calc'); const k = this.queue.findIndex(q => q.t === 'build' || q.t === 'segEnd' || q.t === 'step'); this.queue.splice(k >= 0 ? k : 0, 0, { t: 'chain', n: g }); break; }
      default: this.addLog(`${def.name} G${g} · 멈춤 효과 없음`, 'calc');
    }
  }
  // 적이 밟음 (foePass). 타락 칸은 묘지만.
  _foePass(cell) {
    if (cell.piece?.owner !== 'P') return true;
    const def = PIECES_BY_ID[cell.piece.defId];
    if (cell.corrupt && def.id !== 'grave') return true;
    const g = this.effGrade(cell); const m = this.auraMult(cell); const Nn = this.myPieceCount();
    const x = { stake: g, altar: g, grave: g, sanctum: 2 * g, hall: g, beacon: 2 * g, taxman: g * Nn, reliquary: 2 * g, spire: g * g, road: 2 * g, gate: 2 * g, constellation: 3 * g, temple: 50 }[def.id] || 0;
    return this._hit(x * m, `${this.monsterDef.name} 밟음  칸 ${cell.id} ${def.name} G${g}${m > 1 ? ' (대성당 ×2)' : ''}`);
  }
  _foeStop(cell) {
    if (cell.piece?.owner !== 'P' || cell.corrupt) return true;
    const def = PIECES_BY_ID[cell.piece.defId]; const g = this.effGrade(cell); const m = this.auraMult(cell);
    const pre = `${this.monsterDef.name} 멈춤  칸 ${cell.id} ${def.name} G${g}${m > 1 ? ' (대성당 ×2)' : ''}`;
    switch (def.id) {
      case 'altar': return this._hit(3 * g * m, pre);
      case 'sanctum': return this._hit(6 * g * m, pre);
      case 'spire': return this._hit(3 * g * g * m, pre);
      case 'cathedral': return this._hit(10 * g * m, pre);
      case 'grail': return this._hit(100 * m, pre);
      case 'court': return this._hit(ceil(this.monster.faith * Math.min(100, 5 * g * m) / 100), `${pre} · 현재 신앙의 ${5 * g * m}%`);
      case 'bell': { const back = 2 * g * m; this.monster.pos = Math.max(9, this.monster.pos - back); this.addLog(`${pre} · 적 ${back}칸 후퇴 → 칸 ${this.monster.pos}`, 'calc'); return true; }
      case 'gate': { this.monster.skipNext = true; this.addLog(`${pre} · 적의 다음 패턴 행동 건너뜀`, 'calc'); return true; }
      default: return true;
    }
  }
  _hit(x, prefix) {
    if (x <= 0) return true;
    this.monster.faith -= x;
    this.addLog(`${prefix} · −${x} (잔량 ${Math.max(0, this.monster.faith)})`, 'calc');
    if (this.monster.faith <= 0) { this._finish('victory', `★ ${this.monsterDef.name}의 신앙이 바닥났다. 승리.`); return false; }
    return true;
  }

  // ───────── 타락 · 소환 ─────────
  _expireCorrupt(cell) {
    cell.corrupt = null;
    if (cell.piece?.owner === 'P') { const def = PIECES_BY_ID[cell.piece.defId]; this.addLog(`파괴됨  칸 ${cell.id} ${def.name} G${cell.piece.grade} (타락 만료)`, 'event'); cell.piece = null; }
    if (cell.piece?.owner === 'E') { const b = cell.piece.grade; cell.piece.grade = Math.min(TND.MAX_GRADE, b + 1); this.addLog(`타락 만료  칸 ${cell.id} · 사악한 기물 G${b} → G${cell.piece.grade}`, 'event'); }
    else { cell.piece = { owner: 'E', grade: 1 }; this.addLog(`타락 만료  칸 ${cell.id} · 사악한 기물 G1 건설`, 'event'); }
  }
  _defenseCells(pred) { return this.board.filter(c => c.id >= 9 && c.id <= 31 && pred(c)); }
  _spawnCorruption(k) {
    const cands = this._defenseCells(c => !c.corrupt); const placed = [];
    for (let i = 0; i < k && cands.length; i++) { const c = cands.splice(Math.floor(this.rng() * cands.length), 1)[0]; c.corrupt = { counter: TND.CORRUPT_COUNTER }; placed.push(c.id); }
    return placed;
  }
  _summon(k) {
    const cands = this._defenseCells(c => !c.piece && !c.corrupt); const placed = [];
    for (let i = 0; i < k && cands.length; i++) { const c = cands.splice(Math.floor(this.rng() * cands.length), 1)[0]; c.piece = { owner: 'E', grade: 1 }; placed.push(c.id); }
    return placed;
  }

  // ───────── 적 턴: 패턴 1행동 ─────────
  _enemyTurn() {
    if (this.phase !== 'trial') return;
    this.sub = 'enemy'; this.enemyQueue = [];
    const m = this.monster; const P = this.monsterDef.pattern;
    this.addLog(`── 턴 ${this.turn} · ${this.monsterDef.name} ──`, 'action');
    if (m.skipNext) { this.addLog(`${this.monsterDef.name} ${'①②③④⑤⑥'[m.step]} ${actionLabel(P[m.step])} — 성문 효과로 건너뜀`, 'event'); m.skipNext = false; m.step = (m.step + 1) % P.length; }
    const a = P[m.step]; const mark = '①②③④⑤⑥'[m.step] || `${m.step + 1}`;
    m.step = (m.step + 1) % P.length;
    if (a.t === 'move') {
      const r = resolveEnemyMove(m.pos, a.n, this.monsterDef);
      this.addLog(`${this.monsterDef.name} ${mark} 이동 ${a.n} → 칸 ${r.to}`, 'action');
      this.enemyQueue = r.path.map(step => ({ step }));
    } else if (a.t === 'corrupt') { const p = this._spawnCorruption(a.k); this.addLog(`${this.monsterDef.name} ${mark} 타락 ${a.k} → ${p.map(c => `칸 ${c}`).join(', ') || '자리 없음'}`, 'event'); }
    else if (a.t === 'summon') { const p = this._summon(a.k); this.addLog(`${this.monsterDef.name} ${mark} 소환 ${a.k} → ${p.map(c => `칸 ${c} 사악한 기물 G1`).join(', ') || '자리 없음'}`, 'event'); }
    else if (a.t === 'empower') { let n = 0; for (const c of this.board) if (c.piece?.owner === 'E' && c.piece.grade < TND.MAX_GRADE) { c.piece.grade++; n++; } this.addLog(`${this.monsterDef.name} ${mark} 강화 · 사악한 기물 ${n}개 등급 +1`, 'event'); }
    else if (a.t === 'heal') { m.faith += a.n; this.addLog(`${this.monsterDef.name} ${mark} 회복 +${a.n} (신앙 ${m.faith})`, 'event'); }
    else this.addLog(`${this.monsterDef.name} ${mark} 대기`, 'action');
    this._enemyContinue();
  }
  _enemyContinue() {
    const m = this.monster; const constellation = this.hasAura('constellation');
    while (this.enemyQueue.length > 0 && this.phase === 'trial' && !this.pending) {
      const { step } = this.enemyQueue.shift();
      if (step.assault) {
        m.laps += 1; const cost = this.monsterDef.assault[Math.min(m.laps - 1, this.monsterDef.assault.length - 1)];
        m.pos = step.cell;
        this.addLog(`${this.monsterDef.name} 도약 · 시작칸을 지나 칸 ${step.cell}로 (바퀴 ${m.laps})`, 'event');
        this.addLog(`강습!  바퀴 ${m.laps} · ${cost} 신앙 청구`, 'event');
        this.enemyQueue.unshift({ step: { ...step, assault: false, moved: true } });
        this.pending = { type: 'assault', cost }; this.sub = 'dialog'; return;
      }
      m.pos = step.cell;
      const cell = this.board[step.cell];
      const stopsHere = step.stop || constellation;
      if (!this._foePass(cell)) return;
      if (stopsHere) {
        if (cell.corrupt) { cell.corrupt.counter -= 1; this.addLog(`${this.monsterDef.name} 멈춤  칸 ${cell.id} 타락 · 카운터 −1 → ${cell.corrupt.counter}`, 'action'); if (cell.corrupt.counter <= 0) this._expireCorrupt(cell); }
        else if (!this._foeStop(cell)) return;
        if (constellation && !step.stop && cell.piece?.owner === 'P') this.addLog('성좌 오라 · 밟음을 멈춤으로 판정', 'calc');
      }
    }
    if (this.phase === 'trial' && !this.pending && this.enemyQueue.length === 0) this._startPlayerTurn();
  }

  // ───────── 테스트 훅 ─────────
  _forceUp(indices) { indices.forEach((up, i) => { if (this.dice[i]) { this.dice[i].upIndex = up; this.dice[i].pipBonus = 0; } }); }
}
